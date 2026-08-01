/**
 * SPDX-License-Identifier: MIT
 * SPDX-FileCopyrightText: 2024 NodeCalculate Team
 * SPDX-FileCopyrightText: 2024 Pavel Fomin
 *
 * @file    ganttNode.js
 * @brief   Обработчик: список задач (имя+длительность) -> календарный план с диаграммой Ганта (выход Data)
 * @author  Pavel Fomin
 * @version 1.7.15
 * @see     https://github.com/GhostPWLk1n/NodeCalculator.git
 */

import { BaseNode } from './baseNode.js';
import { Helpers } from '../utils/helpers.js';
import { TableData } from '../utils/dataTypes.js';
import { SocketFactory } from '../utils/socketFactory.js';
import { HolidayParser } from '../utils/holidayParser.js';

const ROW_HEIGHT = 26;      // px на строку задачи
const MAX_VISIBLE_ROWS = 6; // после скольки задач включается вертикальный скролл
const LABEL_WIDTH = 84;     // px, колонка с названиями задач
const HOURS_COL_WIDTH = 34; // px, колонка "ч.ч." (Раунд 78)
const WORKDAYS_COL_WIDTH = 34; // px, колонка "Раб.дн." (Раунд 81)
// Багфикс (Раунд 81, по замечанию Mr.D): пересчёт дни<->часы вёлся
// через КАЛЕНДАРНЫЕ 24ч/сутки - для рабочего планирования это неверно,
// нужен человеко-день (стандартный рабочий день, 8ч). Единая константа
// вместо магического числа 24 в пяти разных местах файла.
const HOURS_PER_WORKDAY = 8;

// Раунд 78 - "Праздники" переехал на ФИКСИРОВАННЫЙ индекс сокета,
// отдельно от растущего диапазона источников задач (см. this.inputSockets
// в конструкторе - теперь их может быть несколько, для группировки
// нескольких источников/других диаграмм Ганта). Если бы индекс праздников
// оставался "следующим свободным" после источников задач, он бы
// сдвигался при каждом добавлении нового слота источника - и тихо
// разрывал уже сохранённое соединение при следующей загрузке проекта.
// 50 - заведомо выше любого реалистичного числа источников (maxInputs),
// коллизия исключена.
const HOLIDAY_SOCKET_INDEX = 50;

// Масштаб линейки: и ширина одного дня в px (плотность), и шаг делений.
// Данные внутри по-прежнему считаются в днях (см. calculate()) - режим
// "Часы" не хранит время суток отдельно, а просто даёт более широкий,
// "растянутый" масштаб для точной расстановки коротких задач; деления
// у него всё равно по дням, но каждый день шире и заметнее.
const RULER_SCALES = {
    hours: { label: 'Часы', dayWidth: 48, tickStepDays: 1 },
    days: { label: 'Дни', dayWidth: 22, tickStepDays: 1 },
    weeks: { label: 'Недели', dayWidth: 10, tickStepDays: 7 }
};

const PERIOD_PRESETS = {
    month: { label: 'Месяц', days: 30 },
    quarter: { label: 'Квартал', days: 90 },
    halfyear: { label: 'Полгода', days: 182 },
    year: { label: 'Год', days: 365 }
};

// Date.getDay(): 0=вс, 1=пн, ... 6=сб
const WEEKDAY_LABELS = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
const MONTH_LABELS = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
const HEADER_ROW_HEIGHT = 15; // px на каждую из строк шапки (год/месяц/число/день недели)

// === Даты - без внешних библиотек, простые хелперы ===

function parseISODate(str) {
    if (!str) return null;
    const d = new Date(str + 'T00:00:00');
    return isNaN(d.getTime()) ? null : d;
}

function addDays(date, days) {
    const d = new Date(date.getTime());
    d.setDate(d.getDate() + Math.round(days));
    return d;
}

function formatISODate(date) {
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}

function formatDateRu(date) {
    const dd = String(date.getDate()).padStart(2, '0');
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    return `${dd}.${mm}.${date.getFullYear()}`;
}

function parseDateRu(str) {
    const m = String(str ?? '').match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
    if (!m) return null;
    const d = new Date(`${m[3]}-${m[2]}-${m[1]}T00:00:00`);
    return isNaN(d.getTime()) ? null : d;
}

function daysBetween(a, b) {
    return Math.round((b.getTime() - a.getTime()) / 86400000);
}

// Date.getDay(): 0=вс, 6=сб
function isWeekend(date) {
    const day = date.getDay();
    return day === 0 || day === 6;
}

// Раунд 73 - выходной ИЛИ праздник (holidaySet - Set<string> ISO-дат
// 'YYYY-MM-DD' из HolidayParser.extract(), может быть undefined/пустым -
// тогда ведёт себя как обычный isWeekend). Единая точка входа для всех
// мест, которые раньше проверяли только isWeekend() - подсветка на
// диаграмме, автоматический пропуск при расстановке задач.
function isNonWorkingDay(date, holidaySet) {
    if (isWeekend(date)) return true;
    return !!(holidaySet && holidaySet.size > 0 && holidaySet.has(formatISODate(date)));
}

// Если calendar-смещение offsetDays (от anchor) попадает на выходной -
// сдвигает его вперёд до ближайшего рабочего дня. Используется и для
// автоматической расстановки (курсор), и для перетащенных мышью задач
// (см. attachBarDrag) - там raw-смещение хранится как есть в taskDates,
// а "прилипание" к рабочему дню происходит здесь, при каждом calculate().
function nextWorkingOffset(anchor, offsetDays, holidaySet) {
    let offset = offsetDays;
    while (isNonWorkingDay(addDays(anchor, offset), holidaySet)) {
        offset += 1;
    }
    return offset;
}

// Считает calendar-смещение КОНЦА задачи (от anchor), если начать в
// startOffsetDays (уже гарантированно рабочий день, см. nextWorkingOffset
// выше) и "расходовать" durationDays РАБОЧИХ дней подряд, пропуская
// выходные (время на них не тратится, но они остаются внутри итогового
// календарного диапазона - задача просто визуально "перепрыгивает" через
// уик-энд, как в большинстве Gantt-инструментов). Дробный последний день
// (например, 4 часа = 1/6 дня) учитывается частично, без округления.
function spanWorkingDays(anchor, startOffsetDays, durationDays, holidaySet) {
    if (durationDays <= 0) return startOffsetDays;
    let offset = startOffsetDays;
    let remaining = durationDays;
    while (remaining > 0) {
        if (isNonWorkingDay(addDays(anchor, offset), holidaySet)) {
            offset += 1;
            continue;
        }
        const consume = Math.min(1, remaining);
        remaining -= consume;
        offset += consume;
    }
    return offset;
}

/**
 * GanttNode - обработчик LIST -> Data: список задач (имя = задача,
 * значение = длительность в часах или днях) превращается в календарный
 * план с интерактивной диаграммой Ганта прямо в теле ноды.
 *
 * По умолчанию задачи ставятся последовательно друг за другом от даты
 * начала плана. Полосу любой задачи можно перетащить мышью по
 * горизонтали - новая дата начала запоминается (this.taskDates, по
 * имени задачи) и переживает пересчёт графа и сохранение проекта.
 *
 * Единственный вход - универсальный (any): подойдёт и список задач
 * (имя/значение), и готовая таблица (Data) с колонками "Начало"/
 * "Окончание" - если подключённый источник даёт такую таблицу И она
 * подходит по структуре, нода использует её НАПРЯМУЮ для отрисовки
 * (пересчёт из списка не нужен) - так можно скормить назад её же
 * собственный выход, отредактированный где-то ещё, или таблицу из
 * TableNode с такими же колонками.
 *
 * Календарный период (Месяц/Квартал/Полгода/Год), единица длительности
 * (часы/дни), масштаб линейки (Часы/Дни/Недели - плотность и шаг делений),
 * вертикальные линии-разделители дат и дедлайн плана (красная линия,
 * перетаскивается за треугольную ручку над шапкой) - всё в боковой
 * панели (getInspectorSchema()).
 *
 * В масштабе "Дни" шапка - четыре независимо переключаемые строки
 * сверху вниз: год / месяц / число / день недели; столбцы выходных
 * (сб/вс) подсвечены на всю высоту диаграммы.
 *
 * Выход - Data с колонками "Задача"/"Начало"/"Окончание"/"Длительность, дн."
 */
export class GanttNode extends BaseNode {
    constructor(id, type, x, y, config = {}) {
        super(id, type, x, y, config);
        // Раунд 78 - несколько источников задач одновременно (по запросу
        // Mr.D: "подключить в одну диаграмму Ганта несколько других") -
        // тот же паттерн авто-роста слотов, что у OperationNode/
        // CalendarNode. "Праздники" НЕ входит в этот список - у него
        // фиксированный HOLIDAY_SOCKET_INDEX, не зависящий от их числа
        // (см. константу выше).
        this.maxInputs = 6;
        this.inputs = config.inputs || 1;
        this.inputSockets = Array.from({ length: this.inputs }, (_, i) => i);
        this._isRerendering = false;
        this.outputs = 1;
        this.width = config.width || 320;

        this.startDate = config.startDate || new Date().toISOString().slice(0, 10);
        this.periodPreset = PERIOD_PRESETS[config.periodPreset] ? config.periodPreset : 'custom';
        // Раунд 77 - "Своя" протяжённость в календарных днях (по прямому
        // запросу Mr.D, по умолчанию 60 - ни один из готовых пресетов
        // (30/90/182/365) этому не соответствует). Используется, когда
        // periodPreset === 'custom' - см. totalDays в createGanttArea().
        this.customPeriodDays = Math.max(1, config.customPeriodDays ?? 60);
        this.durationUnit = config.durationUnit === 'hours' ? 'hours' : 'days';
        // Режим расчёта длительности: 'calendar' (как раньше - длительность
        // это просто N календарных дней подряд, включая выходные) или
        // 'working' (N РАБОЧИХ дней - выходные внутри диапазона пропускаются
        // "бесплатно", см. spanWorkingDays/nextWorkingOffset выше и их
        // применение в calculate())
        this.scheduleMode = config.scheduleMode === 'working' ? 'working' : 'calendar';
        // Масштаб линейки (плотность/шаг делений) - отдельно от периода
        // отображения (period определяет ОБЩУЮ ширину шкалы в днях,
        // rulerScale - насколько "растянут" каждый день)
        this.rulerScale = RULER_SCALES[config.rulerScale] ? config.rulerScale : 'days';
        // Вертикальные линии-разделители дат через все строки задач
        this.showGridLines = config.showGridLines ?? false;
        // Дедлайн плана - красная вертикальная линия на диаграмме, null = не задан
        this.deadlineDate = config.deadlineDate || null;
        // Строки многоуровневой шапки (только при rulerScale === 'days') -
        // каждая включается/выключается независимо
        this.showYearRow = config.showYearRow ?? true;
        this.showMonthRow = config.showMonthRow ?? true;
        this.showDayRow = config.showDayRow ?? true;
        this.showWeekdayRow = config.showWeekdayRow ?? true;
        // Ручные сдвиги начала задачи от даты начала плана (дни), по
        // имени задачи - заполняется автоматически (последовательная
        // расстановка) и/или перетаскиванием полосы мышью
        this.taskDates = config.taskDates ? { ...config.taskDates } : {};
        // Раунд 81 - ручное растягивание полосы мышью (не только
        // перетаскивание позиции) переопределяет ДЛИТЕЛЬНОСТЬ задачи, по
        // тому же ключу taskKey, что и позицию (this.taskDates выше).
        // Без этого поля растянуть полосу было бы нечем - длительность
        // всегда пересчитывалась бы заново из источника на каждый
        // calculateAll(), стирая только что сделанное изменение.
        this.taskDurationOverrides = config.taskDurationOverrides ? { ...config.taskDurationOverrides } : {};
        // Раунд 83 (по запросу Mr.D, п.3) - задел на будущее: столбец
        // "Ответственный" уже есть в выходной таблице (buildOutputTable()),
        // но UI для его редактирования и раскраска по ответственному
        // (обсуждается отдельным раундом) - ещё нет. Ключ - taskKey, тот
        // же, что у taskDates/taskDurationOverrides.
        this.taskResponsible = config.taskResponsible ? { ...config.taskResponsible } : {};
        // Раунд 81 (по запросу Mr.D) - независимые флаги видимости двух
        // колонок слева от шкалы. По умолчанию обе включены (как уже
        // было раньше для "ч.ч." - ничего не ломаем для существующих
        // проектов).
        this.showDurationColumn = config.showDurationColumn ?? true;
        this.showWorkingDaysColumn = config.showWorkingDaysColumn ?? true;

        this.tasks = [];               // вычисленные задачи для рендера (плоский список, groupIndex/taskKey у каждой при группировке)
        // Раунд 78 - null, если подключён ровно один источник (обычное
        // поведение, как раньше) | массив {name, tasks} при 2+ источниках -
        // см. calculate()/createGanttArea(). Раунд 79 - заливка всей
        // строки цветом группы убрана (по замечанию Mr.D "не то, что я
        // имел в виду") - см. buildGroupHeaderRow().
        this.taskGroups = null;
        // Раунд 79 - какие группы свёрнуты (скрыты их строки задач) -
        // ключ: groupIndex (строкой, т.к. ключи объектов в JS всегда
        // строки). Чисто визуальное состояние - не влияет на расчёт/
        // расстановку задач внутри свёрнутой группы, только на рендер.
        this.collapsedGroups = config.collapsedGroups && typeof config.collapsedGroups === 'object'
            ? { ...config.collapsedGroups }
            : {};
        this.tableData = new TableData();
        this.sourceMode = 'list';      // 'list' | 'table' - откуда взялись данные в последнем calculate()
        this._sourceName = null;
        // Высота видимой области строк, если пользователь тянул общую
        // ручку ноды по вертикали (см. beginFreeResize/applyFreeResize) -
        // null = высота подбирается автоматически по числу задач
        this.wrapHeight = config.wrapHeight ?? null;
        // Раунд 73 - набор дат-праздников из подключённого сокета 1 (см.
        // calculate()) - Set<string> ISO-дат, пустой до первого пересчёта
        this.holidaySet = new Set();
        this._holidaySourceName = null;
    }

    createContent() {
        const content = document.createElement('div');
        content.className = 'node-content';
        content.style.cssText = 'width: 100%; min-width: 150px;';

        // --- источники задач (Раунд 78, несколько одновременно - см.
        // конструктор про авто-рост слотов). Один ряд на сокет; при 2+
        // подключённых источниках диаграмма разбивает задачи на группы,
        // см. calculate()/createGanttArea() ---
        const sourcesWrap = document.createElement('div');
        sourcesWrap.className = 'gantt-sources-wrap';
        sourcesWrap.style.cssText = 'display:flex; flex-direction:column; gap:2px;';
        this.inputSockets.forEach(socketIndex => {
            const sourceRow = document.createElement('div');
            sourceRow.className = 'gantt-source-row';
            sourceRow.style.cssText = 'display:flex; align-items:center; gap:6px;';
            const sourceSocket = SocketFactory.createSocket({
                nodeId: this.id, socketType: 'input', index: socketIndex, isAny: true,
                title: 'Список задач (имя = задача, значение = длительность), готовая таблица плана (столбцы "Начало"/"Окончание") или другая Диаграмма Ганта - при нескольких подключённых источниках разобьются на группы'
            });
            sourceRow.appendChild(sourceSocket);
            const sourceLabel = document.createElement('span');
            sourceLabel.className = 'gantt-source-label';
            sourceLabel.dataset.socketIndex = String(socketIndex);
            sourceLabel.style.cssText = `
                color: var(--md-text-secondary);
                font-size: 11px;
                flex: 1;
                min-width: 0;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            `;
            sourceLabel.textContent = this._sourceStatusText(socketIndex);
            sourceRow.appendChild(sourceLabel);
            sourcesWrap.appendChild(sourceRow);
        });
        content.appendChild(sourcesWrap);

        // --- праздники, необязательный сокет на фиксированном индексе
        // (Раунд 73, индекс переехал на фиксированный в Раунде 78) ---
        // Подключается CalendarNode ИЛИ JsonImportNode с производственным
        // календарём напрямую (без промежуточных нод) - см. докстринг
        // utils/holidayParser.js о том, как распознаётся формат.
        const holidayRow = document.createElement('div');
        holidayRow.style.cssText = 'display:flex; align-items:center; gap:6px; margin-top:2px;';
        const holidaySocket = SocketFactory.createSocket({
            nodeId: this.id, socketType: 'input', index: HOLIDAY_SOCKET_INDEX, isAny: true,
            title: 'Праздники (необязательно) - CalendarNode или Импорт JSON с производственным календарём'
        });
        holidayRow.appendChild(holidaySocket);
        const holidayLabel = document.createElement('span');
        holidayLabel.className = 'gantt-holiday-label';
        holidayLabel.style.cssText = `
            color: var(--md-text-disabled);
            font-size: 10px;
            flex: 1;
            min-width: 0;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        `;
        holidayLabel.textContent = this._holidayStatusText();
        holidayRow.appendChild(holidayLabel);
        content.appendChild(holidayRow);

        // --- диаграмма ---
        const ganttSlot = document.createElement('div');
        ganttSlot.className = 'gantt-container-slot';
        ganttSlot.style.cssText = 'margin: 4px 0;';
        ganttSlot.appendChild(this.createGanttArea());
        content.appendChild(ganttSlot);

        // --- выход ---
        const outputRow = document.createElement('div');
        outputRow.style.cssText = `
            display: flex;
            align-items: center;
            gap: 8px;
            padding-top: 6px;
            margin-top: 2px;
            border-top: 1px solid var(--md-divider);
        `;
        const outputLabel = document.createElement('label');
        outputLabel.textContent = 'План (DATA):';
        outputLabel.style.cssText = 'color:var(--md-text-secondary); font-size:11px; flex:1;';
        outputRow.appendChild(outputLabel);
        const outputCount = document.createElement('span');
        outputCount.className = 'gantt-output-count';
        outputCount.style.cssText = 'color:#ff8a65; font-size:12px; font-weight:500;';
        outputCount.textContent = `${this.tasks.length} задач`;
        outputRow.appendChild(outputCount);
        const outputSocket = SocketFactory.createSocket({
            nodeId: this.id, socketType: 'output', index: 0, isData: true,
            title: 'План (DATA)'
        });
        outputRow.appendChild(outputSocket);
        content.appendChild(outputRow);

        return content;
    }

    // === Диаграмма: линейка дат + строки задач с перетаскиваемыми полосами ===

    createGanttArea() {
        const totalDays = this.periodPreset === 'custom'
            ? this.customPeriodDays
            : (PERIOD_PRESETS[this.periodPreset]?.days || 30);
        const dayWidth = RULER_SCALES[this.rulerScale]?.dayWidth || RULER_SCALES.days.dayWidth;
        const timelineWidth = totalDays * dayWidth;
        const anchor = parseISODate(this.startDate) || new Date();

        // Столбец номеров строк - фиксированной ширины под самое крупное
        // число (как в Excel, тот же приём, что в tableViewerNode.js).
        // leftWidth - суммарный отступ ДО начала временной шкалы (номер +
        // имя задачи) - используется везде, где раньше стоял голый LABEL_WIDTH.
        const numColWidth = Math.max(20, String(Math.max(this.tasks.length, 1)).length * 7 + 12);
        const leftWidth = numColWidth + LABEL_WIDTH
            + (this.showDurationColumn ? HOURS_COL_WIDTH : 0)
            + (this.showWorkingDaysColumn ? WORKDAYS_COL_WIDTH : 0);

        const outer = document.createElement('div');
        outer.className = 'gantt-outer-scroll';
        // Только горизонтальный скролл - вертикальный целиком у rowsWrap
        // ниже (своя, отдельная область). Раньше в tableViewerNode.js была
        // обратная ошибка - overflow:auto (обе оси) на внешней обёртке
        // ПЛЮС свой overflow-y:auto у внутренней - получалось два вложенных
        // скролла (один двигал шапку целиком, другой - только строки).
        // Здесь сразу делаем правильно: overflow-x/overflow-y раздельно.
        outer.style.cssText = 'overflow-x: auto; overflow-y: hidden;';
        outer.addEventListener('mousedown', (e) => e.stopPropagation());

        const inner = document.createElement('div');
        inner.className = 'gantt-inner';
        inner.style.cssText = `position: relative; width: ${leftWidth + timelineWidth}px; min-width: 100%;`;

        // Треугольная ручка дедлайна - отдельная узкая строка НАД шапкой
        // дат, в обычном потоке (не абсолютно с отрицательным top), иначе
        // её обрезал бы overflow-y:hidden внешней обёртки
        const deadlineHandleRow = this.buildDeadlineHandle(leftWidth, timelineWidth, dayWidth);
        if (deadlineHandleRow) inner.appendChild(deadlineHandleRow);

        // Подложка выходных - только в масштабе "Дни" вместе со строкой
        // дня недели (это одна связанная фича, см. описание задачи)
        if (this.rulerScale === 'days' && this.showWeekdayRow) {
            inner.appendChild(this.buildWeekendHighlights(leftWidth, totalDays, timelineWidth, dayWidth, anchor));
        }

        // Шапка: многоуровневая (год/месяц/число/день недели) только в
        // масштабе "Дни", иначе - обычная линейка с делениями
        if (this.rulerScale === 'days') {
            inner.appendChild(this.buildDaysHeader(leftWidth, totalDays, timelineWidth, dayWidth, anchor));
        } else {
            inner.appendChild(this.buildRuler(leftWidth, totalDays, timelineWidth, dayWidth, anchor));
        }

        // === ТЕЛО - единственная часть с собственным вертикальным скроллом ===
        const rowsWrap = document.createElement('div');
        rowsWrap.className = 'gantt-rows-scroll';
        // Багфикс (та же причина "двойного скролла", что уже чинили в
        // tableViewerNode.js, Раунд 47 - см. докстринг там): если
        // overflow-y задан (auto), а overflow-x НЕ задан явно, спека CSS
        // обязывает браузер трактовать overflow-x тоже как 'auto', а не
        // как молчаливый 'visible'. Ширина .gantt-inner (родителя) задаётся
        // явным пикселем (leftWidth + timelineWidth) ВЫШЕ - и rowsWrap как
        // обычный блочный потомок обычно наследует ровно эту же ширину,
        // но стоило контенту хоть на пиксель вылезти (длинные подписи,
        // сетка, полоса выходных) - у rowsWrap САМОГО появлялся свой
        // горизонтальный скролл, вторая полоса поверх внешней у
        // .gantt-outer-scroll. overflow-x: hidden - явно, а не "молчание" -
        // закрывает эту лазейку: горизонтальный вылет теперь ловит ТОЛЬКО
        // внешняя обёртка, один скроллбар на всю диаграмму.
        // scrollbar-gutter: stable - для консистентности с TableViewer,
        // резервирует место под вертикальный скроллбар, чтобы он не
        // сдвигал последний столбец временной шкалы.
        rowsWrap.style.cssText = 'overflow-y: auto; overflow-x: hidden; scrollbar-gutter: stable;';

        if (this.tasks.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'gantt-empty';
            empty.style.cssText = `
                color: var(--md-text-disabled);
                font-size: 11px;
                text-align: center;
                padding: 8px 0;
            `;
            empty.textContent = 'Нет задач';
            rowsWrap.appendChild(empty);
        } else {
            // Обёртка строк - position:relative, чтобы вертикальные линии
            // сетки (абсолютные потомки) растянулись ровно на высоту всех
            // строк (задаётся обычным потоком самих строк), а не только
            // на видимую часть при скролле
            const rowsInner = document.createElement('div');
            rowsInner.className = 'gantt-rows-inner';
            rowsInner.style.cssText = 'position: relative;';

            if (this.showGridLines) {
                rowsInner.appendChild(this.buildGridLines(leftWidth, totalDays, timelineWidth, dayWidth));
            }

            // Раунд 78 - строка "Итого" всегда первая: суммарная
            // протяжённость (часы) всех задач + общая полоса-обзор от
            // самого раннего старта до самого позднего конца.
            rowsInner.appendChild(this.buildTotalRow(numColWidth, timelineWidth, dayWidth, anchor));

            if (this.taskGroups) {
                let taskNumber = 1; // сквозная нумерация ЗАДАЧ (не строк) через все группы
                this.taskGroups.forEach((group, groupIndex) => {
                    const collapsed = !!this.collapsedGroups[groupIndex];
                    rowsInner.appendChild(this.buildGroupHeaderRow(group, groupIndex, numColWidth, timelineWidth, dayWidth, collapsed, anchor));
                    if (!collapsed) {
                        group.tasks.forEach(task => {
                            rowsInner.appendChild(this.buildTaskRow(task, numColWidth, timelineWidth, dayWidth, taskNumber, null, anchor));
                            taskNumber++;
                        });
                    } else {
                        // Свёрнута - задачи по-прежнему расписаны и есть в
                        // this.tasks/выходной таблице, просто не рисуются -
                        // но сквозную нумерацию всё равно продолжаем, чтобы
                        // номера видимых задач не "прыгали" при разворачивании
                        taskNumber += group.tasks.length;
                    }
                });
            } else {
                this.tasks.forEach((task, i) => {
                    rowsInner.appendChild(this.buildTaskRow(task, numColWidth, timelineWidth, dayWidth, i + 1, null, anchor));
                });
            }

            rowsWrap.appendChild(rowsInner);
        }

        // Высота ТОЛЬКО тела - шапка и ручка дедлайна физически вне этой
        // области. this.wrapHeight - JS-свойство (см. beginFreeResize/
        // applyFreeResize ниже), а не инспекция инлайн-стилей DOM.
        if (this.wrapHeight) {
            rowsWrap.style.maxHeight = 'none';
            rowsWrap.style.height = this.wrapHeight + 'px';
        } else {
            const visibleRows = Math.min(Math.max(this.tasks.length, 1), MAX_VISIBLE_ROWS);
            rowsWrap.style.maxHeight = `${visibleRows * ROW_HEIGHT}px`;
        }

        inner.appendChild(rowsWrap);

        // Линия дедлайна - поверх и шапки, и строк, не участвует в
        // вертикальном скролле строк (остаётся видна всегда, пока не
        // проскроллили по горизонтали мимо неё)
        const deadlineLine = this.buildDeadlineLine(leftWidth, dayWidth);
        if (deadlineLine) inner.appendChild(deadlineLine);

        outer.appendChild(inner);
        return outer;
    }

    // === Свободный ресайз через общую ручку ноды (nodeManager.js) - тот
    // же паттерн, что в tableViewerNode.js. Дополнительная высота идёт в
    // .gantt-rows-scroll (единственную часть со своим вертикальным
    // скроллом), а НЕ в .gantt-outer-scroll - именно смешение этих двух
    // ролей на одном элементе создавало "двойной скролл" в tableViewerNode.js. ===

    beginFreeResize(el) {
        const rowsWrap = el.querySelector('.gantt-rows-scroll');
        this._resizeStartRowsHeight = rowsWrap ? rowsWrap.offsetHeight : ROW_HEIGHT * 2;
    }

    applyFreeResize(el, deltaY) {
        const rowsWrap = el.querySelector('.gantt-rows-scroll');
        if (!rowsWrap) return;
        const newHeight = Math.max(ROW_HEIGHT, (this._resizeStartRowsHeight || ROW_HEIGHT) + deltaY);
        rowsWrap.style.maxHeight = 'none';
        rowsWrap.style.height = newHeight + 'px';
        this.wrapHeight = newHeight;
    }

    // Треугольная ручка над шапкой дат - тянет дедлайн мышью по
    // горизонтали. Отдельная строка в обычном потоке (не абсолютный
    // элемент с отрицательным top) - иначе торчащий вверх треугольник
    // обрезал бы overflow-y:hidden внешней прокручиваемой обёртки.
    buildDeadlineHandle(leftWidth, timelineWidth, dayWidth) {
        if (!this.deadlineDate) return null;
        const deadline = parseISODate(this.deadlineDate);
        if (!deadline) return null;

        const anchor = parseISODate(this.startDate) || new Date();
        const offsetDays = daysBetween(anchor, deadline);

        const handleRow = document.createElement('div');
        handleRow.className = 'gantt-deadline-handle-row';
        handleRow.style.cssText = 'display:flex; height:9px;';

        const spacer = document.createElement('div');
        spacer.style.cssText = 'width:' + leftWidth + 'px; flex-shrink:0;';
        handleRow.appendChild(spacer);

        const track = document.createElement('div');
        track.style.cssText = `position:relative; height:100%; width:${timelineWidth}px; flex-shrink:0;`;

        const triangle = document.createElement('div');
        triangle.className = 'gantt-deadline-handle';
        triangle.title = `Дедлайн: ${formatDateRu(deadline)} — перетащите, чтобы изменить`;
        triangle.style.cssText = `
            position: absolute;
            left: ${offsetDays * dayWidth - 5}px;
            top: 0;
            width: 0; height: 0;
            border-left: 5px solid transparent;
            border-right: 5px solid transparent;
            border-top: 8px solid var(--md-error, #ef5350);
            cursor: ew-resize;
        `;
        this.attachDeadlineDrag(triangle, dayWidth);
        track.appendChild(triangle);
        handleRow.appendChild(track);
        return handleRow;
    }

    // Перетаскивание треугольной ручки - меняет дату дедлайна. Дедлайн
    // разрешено перетащить и раньше даты начала плана (отрицательный
    // сдвиг) - это осмысленное состояние ("план уже сорван"), а не ошибка.
    attachDeadlineDrag(triangleEl, dayWidth) {
        triangleEl.addEventListener('mousedown', (e) => {
            e.stopPropagation();
            e.preventDefault();
            const zoom = window.getZoomLevel ? window.getZoomLevel() : 1;
            const startX = e.clientX;
            const anchor = parseISODate(this.startDate) || new Date();
            const currentDeadline = parseISODate(this.deadlineDate) || anchor;
            const startOffset = daysBetween(anchor, currentDeadline);

            const onMove = (ev) => {
                const deltaPx = (ev.clientX - startX) / zoom;
                const deltaDays = Math.round(deltaPx / dayWidth);
                const newOffset = startOffset + deltaDays;
                triangleEl.style.left = (newOffset * dayWidth - 5) + 'px';
                triangleEl.dataset.pendingOffset = String(newOffset);
            };
            const onUp = () => {
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
                if (triangleEl.dataset.pendingOffset !== undefined) {
                    const newOffset = parseInt(triangleEl.dataset.pendingOffset, 10);
                    this.deadlineDate = formatISODate(addDays(anchor, newOffset));
                    delete triangleEl.dataset.pendingOffset;
                    if (window.nodeManager) window.nodeManager.calculateAll();
                    if (window.renderer) window.renderer.updateAllDisplays();
                    if (window.inspectorManager?.isOpenFor(this.id)) window.inspectorManager.refresh();
                }
            };
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        });
    }

    // Красная вертикальная линия дедлайна плана (если задан в панели)
    buildDeadlineLine(leftWidth, dayWidth) {
        if (!this.deadlineDate) return null;
        const deadline = parseISODate(this.deadlineDate);
        if (!deadline) return null;

        const anchor = parseISODate(this.startDate) || new Date();
        const offsetDays = daysBetween(anchor, deadline);

        const line = document.createElement('div');
        line.className = 'gantt-deadline-line';
        line.style.cssText = `
            position: absolute;
            left: ${leftWidth + offsetDays * dayWidth}px;
            top: 0; bottom: 0;
            width: 2px;
            background: var(--md-error, #ef5350);
            z-index: 4;
            pointer-events: none;
        `;
        line.title = `Дедлайн: ${formatDateRu(deadline)}`;
        return line;
    }

    buildRuler(leftWidth, totalDays, timelineWidth, dayWidth, anchor) {
        const ruler = document.createElement('div');
        ruler.className = 'gantt-ruler';
        ruler.style.cssText = 'display:flex; height:18px; border-bottom:1px solid var(--md-divider);';

        const spacer = document.createElement('div');
        spacer.style.cssText = `width: ${leftWidth}px; flex-shrink: 0;`;
        ruler.appendChild(spacer);

        const track = document.createElement('div');
        track.style.cssText = `position: relative; width: ${timelineWidth}px; flex-shrink: 0;`;

        const step = RULER_SCALES[this.rulerScale]?.tickStepDays || 1;
        for (let d = 0; d < totalDays; d += step) {
            const mark = document.createElement('div');
            mark.style.cssText = `
                position: absolute;
                left: ${d * dayWidth}px;
                top: 0; bottom: 0;
                border-left: 1px solid var(--md-divider);
                font-size: 9px;
                color: var(--md-text-disabled);
                padding-left: 2px;
                white-space: nowrap;
            `;
            mark.textContent = formatDateRu(addDays(anchor, d));
            track.appendChild(mark);
        }
        ruler.appendChild(track);
        return ruler;
    }

    // === Многоуровневая шапка для масштаба "Дни": год / месяц / число /
    // день недели, каждая строка включается независимо (getInspectorSchema) ===

    buildDaysHeader(leftWidth, totalDays, timelineWidth, dayWidth, anchor) {
        const header = document.createElement('div');
        header.className = 'gantt-days-header';

        if (this.showYearRow) {
            header.appendChild(this.buildGroupedRow(
                leftWidth, totalDays, timelineWidth, dayWidth, anchor,
                (date) => date.getFullYear(),
                (date) => String(date.getFullYear())
            ));
        }
        if (this.showMonthRow) {
            header.appendChild(this.buildGroupedRow(
                leftWidth, totalDays, timelineWidth, dayWidth, anchor,
                (date) => date.getFullYear() * 12 + date.getMonth(),
                (date) => MONTH_LABELS[date.getMonth()]
            ));
        }
        if (this.showDayRow) {
            header.appendChild(this.buildDayNumberRow(leftWidth, totalDays, timelineWidth, dayWidth, anchor));
        }
        if (this.showWeekdayRow) {
            header.appendChild(this.buildWeekdayRow(leftWidth, totalDays, timelineWidth, dayWidth, anchor));
        }

        // Если все 4 строки отключены - оставляем тонкий разделитель,
        // чтобы граница между шапкой и строками задач не пропадала совсем
        if (!this.showYearRow && !this.showMonthRow && !this.showDayRow && !this.showWeekdayRow) {
            header.style.cssText = 'height:1px; border-bottom:1px solid var(--md-divider);';
        }

        return header;
    }

    // Общий строитель для "Год"/"Месяц" - группирует ПОСЛЕДОВАТЕЛЬНЫЕ дни
    // с одинаковым ключом (getKey) в один сегмент с одной подписью (getLabel).
    buildGroupedRow(leftWidth, totalDays, timelineWidth, dayWidth, anchor, getKey, getLabel) {
        const row = document.createElement('div');
        row.style.cssText = `display:flex; height:${HEADER_ROW_HEIGHT}px; border-bottom:1px solid var(--md-divider);`;

        const spacer = document.createElement('div');
        spacer.style.cssText = `width:${leftWidth}px; flex-shrink:0;`;
        row.appendChild(spacer);

        const track = document.createElement('div');
        track.style.cssText = `position:relative; width:${timelineWidth}px; flex-shrink:0;`;

        let segStart = 0;
        let segKey = getKey(addDays(anchor, 0));
        for (let d = 1; d <= totalDays; d++) {
            const key = d < totalDays ? getKey(addDays(anchor, d)) : null;
            if (key !== segKey) {
                const seg = document.createElement('div');
                seg.style.cssText = `
                    position: absolute;
                    left: ${segStart * dayWidth}px;
                    top: 0; bottom: 0;
                    width: ${(d - segStart) * dayWidth}px;
                    border-left: 1px solid var(--md-divider);
                    font-size: 9px;
                    color: var(--md-text-disabled);
                    padding-left: 3px;
                    display: flex;
                    align-items: center;
                    overflow: hidden;
                    white-space: nowrap;
                `;
                seg.textContent = getLabel(addDays(anchor, segStart));
                track.appendChild(seg);
                segStart = d;
                segKey = key;
            }
        }
        row.appendChild(track);
        return row;
    }

    // "Число" - календарный день месяца (1,2,3...), своя ячейка на каждый день
    buildDayNumberRow(leftWidth, totalDays, timelineWidth, dayWidth, anchor) {
        const row = document.createElement('div');
        row.style.cssText = `display:flex; height:${HEADER_ROW_HEIGHT}px; border-bottom:1px solid var(--md-divider);`;

        const spacer = document.createElement('div');
        spacer.style.cssText = `width:${leftWidth}px; flex-shrink:0;`;
        row.appendChild(spacer);

        const track = document.createElement('div');
        track.style.cssText = `position:relative; width:${timelineWidth}px; flex-shrink:0;`;

        for (let d = 0; d < totalDays; d++) {
            const date = addDays(anchor, d);
            const cell = document.createElement('div');
            cell.style.cssText = `
                position: absolute;
                left: ${d * dayWidth}px;
                top: 0; bottom: 0;
                width: ${dayWidth}px;
                font-size: 9px;
                color: var(--md-text-secondary);
                text-align: center;
                display: flex;
                align-items: center;
                justify-content: center;
            `;
            cell.textContent = String(date.getDate());
            track.appendChild(cell);
        }
        row.appendChild(track);
        return row;
    }

    // "День недели" - пн/вт/ср/.../вс, выходные (сб/вс) заметно окрашены
    buildWeekdayRow(leftWidth, totalDays, timelineWidth, dayWidth, anchor) {
        const row = document.createElement('div');
        row.style.cssText = `display:flex; height:${HEADER_ROW_HEIGHT}px; border-bottom:1px solid var(--md-divider);`;

        const spacer = document.createElement('div');
        spacer.style.cssText = `width:${leftWidth}px; flex-shrink:0;`;
        row.appendChild(spacer);

        const track = document.createElement('div');
        track.style.cssText = `position:relative; width:${timelineWidth}px; flex-shrink:0;`;

        for (let d = 0; d < totalDays; d++) {
            const date = addDays(anchor, d);
            const dow = date.getDay();
            const isWeekend = dow === 0 || dow === 6;
            // Раунд 73 - праздник, который сам по себе НЕ выходной (будни,
            // отмеченные в подключённом календаре) - отдельный цвет
            // (янтарный), чтобы отличать от обычных выходных (красный)
            const isHoliday = !isWeekend && this.holidaySet && this.holidaySet.has(formatISODate(date));
            const cell = document.createElement('div');
            cell.style.cssText = `
                position: absolute;
                left: ${d * dayWidth}px;
                top: 0; bottom: 0;
                width: ${dayWidth}px;
                font-size: 9px;
                text-align: center;
                display: flex;
                align-items: center;
                justify-content: center;
                color: ${isWeekend ? 'var(--md-error, #ef5350)' : (isHoliday ? 'var(--md-warning, #ffb74d)' : 'var(--md-text-secondary)')};
                font-weight: ${(isWeekend || isHoliday) ? '600' : '400'};
            `;
            cell.textContent = WEEKDAY_LABELS[dow];
            track.appendChild(cell);
        }
        row.appendChild(track);
        return row;
    }

    // Подложка нерабочих дней - выходные (красный) И праздники из
    // подключённого календаря (янтарный, Раунд 73) - не ярко, но заметно
    // (та же плотность прозрачности, что и у зебры строк) - растягивается
    // через ВСЮ высоту диаграммы (шапка + строки задач), а не только шапку.
    // Имя метода осталось прежним (buildWeekendHighlights) - переименование
    // потребовало бы правки всех вызовов ради чисто косметической точности.
    buildWeekendHighlights(leftWidth, totalDays, timelineWidth, dayWidth, anchor) {
        const overlay = document.createElement('div');
        overlay.className = 'gantt-weekend-highlights';
        overlay.style.cssText = `position:absolute; left:${leftWidth}px; top:0; bottom:0; width:${timelineWidth}px; pointer-events:none;`;

        for (let d = 0; d < totalDays; d++) {
            const date = addDays(anchor, d);
            const dow = date.getDay();
            const isWeekendDay = dow === 0 || dow === 6;
            const isHoliday = !isWeekendDay && this.holidaySet && this.holidaySet.has(formatISODate(date));
            if (isWeekendDay || isHoliday) {
                const seg = document.createElement('div');
                seg.style.cssText = `
                    position: absolute;
                    left: ${d * dayWidth}px;
                    top: 0; bottom: 0;
                    width: ${dayWidth}px;
                    background: ${isWeekendDay ? 'var(--gantt-weekend-tint, rgba(239, 83, 80, 0.06))' : 'var(--gantt-holiday-tint, rgba(255, 183, 77, 0.08))'};
                `;
                overlay.appendChild(seg);
            }
        }
        return overlay;
    }

    // Вертикальные линии-разделители дат через все строки задач сразу -
    // тот же шаг, что и у делений линейки (buildRuler), чтобы совпадали.
    buildGridLines(leftWidth, totalDays, timelineWidth, dayWidth) {
        const step = RULER_SCALES[this.rulerScale]?.tickStepDays || 1;
        const lines = document.createElement('div');
        lines.className = 'gantt-gridlines';
        lines.style.cssText = `position:absolute; left:${leftWidth}px; top:0; bottom:0; width:${timelineWidth}px; pointer-events:none;`;

        for (let d = 0; d < totalDays; d += step) {
            const line = document.createElement('div');
            line.style.cssText = `
                position: absolute;
                left: ${d * dayWidth}px;
                top: 0; bottom: 0;
                width: 1px;
                background: var(--md-divider);
                opacity: 0.6;
            `;
            lines.appendChild(line);
        }
        return lines;
    }

    // taskNumber - 1-based номер ЗАДАЧИ (сквозной через все группы, не
    // "номер строки" - строки-заголовки групп/"Итого" не в счёт, см.
    // createGanttArea()). rowBackground - раньше (Раунд 78) сюда
    // передавался цвет подложки группы; убран по замечанию Mr.D в
    // Раунде 79 ("заливка цветом всей строки как сейчас не нужна") -
    // параметр остался (всегда null на практике) просто как задел на
    // случай будущей потребности в переопределении фона строки, сейчас
    // везде работает обычная зебра.
    buildTaskRow(task, numColWidth, timelineWidth, dayWidth, taskNumber, rowBackground, anchor) {
        const row = document.createElement('div');
        row.className = 'gantt-task-row';
        row.style.cssText = `
            display: flex;
            align-items: center;
            height: ${ROW_HEIGHT}px;
            background: ${rowBackground || (taskNumber % 2 === 0 ? 'rgba(255,255,255,0.02)' : '')};
        `;

        // Столбец номера строки (как в Excel/tableViewerNode.js) - чисто
        // навигационный ориентир, не связан с датами/сортировкой
        const numCell = document.createElement('div');
        numCell.className = 'gantt-row-num';
        numCell.style.cssText = `
            width: ${numColWidth}px;
            flex-shrink: 0;
            font-size: 10px;
            color: var(--md-text-disabled);
            text-align: right;
            padding-right: 4px;
            font-variant-numeric: tabular-nums;
        `;
        numCell.textContent = String(taskNumber);
        row.appendChild(numCell);

        const label = document.createElement('div');
        label.className = 'gantt-task-label';
        label.style.cssText = `
            width: ${LABEL_WIDTH}px;
            flex-shrink: 0;
            font-size: 11px;
            color: var(--md-text);
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            padding-right: 6px;
        `;
        label.textContent = task.name;
        label.title = task.name;
        row.appendChild(label);

        // Столбец "ч.ч." (Раунд 78, по запросу Mr.D) - длительность
        // задачи в ЧАСАХ, независимо от this.durationUnit (тот влияет
        // только на то, как ЧИТАЕТСЯ входной список - durationDays уже
        // всегда в днях внутри, см. calculate()). Раунд 81 - теперь
        // можно скрыть флагом this.showDurationColumn.
        if (this.showDurationColumn) {
            const hoursCell = document.createElement('div');
            hoursCell.className = 'gantt-hours-cell';
            hoursCell.style.cssText = `
                width: ${HOURS_COL_WIDTH}px;
                flex-shrink: 0;
                font-size: 10px;
                color: var(--md-text-secondary);
                text-align: right;
                padding-right: 6px;
                font-variant-numeric: tabular-nums;
            `;
            hoursCell.textContent = Helpers.formatNumber(task.durationDays * HOURS_PER_WORKDAY);
            row.appendChild(hoursCell);
        }

        // Столбец "Раб.дн." (Раунд 81, п.3) - рабочих дней ВНУТРИ
        // диапазона именно этой задачи (не общего диапазона проекта -
        // та величина для "Итого"/группы, см. buildTotalRow()/
        // buildGroupHeaderRow()).
        if (this.showWorkingDaysColumn) {
            const workdaysCell = document.createElement('div');
            workdaysCell.className = 'gantt-workdays-cell';
            workdaysCell.style.cssText = `
                width: ${WORKDAYS_COL_WIDTH}px;
                flex-shrink: 0;
                font-size: 10px;
                color: var(--md-text-secondary);
                text-align: right;
                padding-right: 6px;
                font-variant-numeric: tabular-nums;
            `;
            workdaysCell.textContent = String(this._countWorkingDaysInRange(anchor, task.startOffsetDays, task.durationDays));
            row.appendChild(workdaysCell);
        }

        const track = document.createElement('div');
        track.style.cssText = `position: relative; width: ${timelineWidth}px; height: 100%; flex-shrink: 0;`;

        const bar = document.createElement('div');
        bar.className = 'gantt-bar';
        bar.dataset.taskName = task.taskKey || task.name;
        bar.style.cssText = `
            position: absolute;
            top: 4px; bottom: 4px;
            left: ${task.startOffsetDays * dayWidth}px;
            width: ${Math.max(4, task.durationDays * dayWidth)}px;
            background: var(--md-primary);
            border-radius: 3px;
            cursor: grab;
        `;
        bar.title = `${task.name}: ${task.durationDays} дн. (${Helpers.formatNumber(task.durationDays * HOURS_PER_WORKDAY)} ч.) - потяните за края, чтобы растянуть`;
        this.attachBarDrag(bar, task, dayWidth);

        // Раунд 81 (по запросу Mr.D: "нужна возможность их графического
        // редактирования (растягивания)") - узкие ручки по краям полосы,
        // тянут ДЛИТЕЛЬНОСТЬ (и, для левого края, заодно и старт) - см.
        // attachBarResize(). mousedown на ручке ОБЯЗАН звать
        // stopPropagation() - иначе всплыл бы и до обработчика самого
        // bar (attachBarDrag выше), и одно и то же нажатие запустило бы
        // сразу оба жеста (сдвиг + растягивание) одновременно.
        const leftHandle = document.createElement('div');
        leftHandle.className = 'gantt-bar-resize-handle gantt-bar-resize-left';
        leftHandle.style.cssText = 'position:absolute; left:0; top:0; bottom:0; width:6px; cursor:ew-resize;';
        this.attachBarResize(leftHandle, task, dayWidth, 'left');
        bar.appendChild(leftHandle);

        const rightHandle = document.createElement('div');
        rightHandle.className = 'gantt-bar-resize-handle gantt-bar-resize-right';
        rightHandle.style.cssText = 'position:absolute; right:0; top:0; bottom:0; width:6px; cursor:ew-resize;';
        this.attachBarResize(rightHandle, task, dayWidth, 'right');
        bar.appendChild(rightHandle);

        track.appendChild(bar);

        row.appendChild(track);
        return row;
    }

    // Строка-заголовок группы (Раунд 78, переработано в Раунде 79 по
    // замечаниям Mr.D):
    //   - НЕТ заливки цветом всей строки/подложки под задачи - только
    //     нейтральный (не цветной) разделитель сверху/снизу строки
    //     заголовка, как и был.
    //   - Стрелка ▾/▸ - сворачивает/разворачивает группу (только визуально,
    //     на расчёт задач внутри не влияет - см. collapsedGroups).
    //   - Итог по группе (та же _formatTotalCell(), что и у общего
    //     "Итого") - в столбце ч.ч./дн., как у обычных строк.
    //   - "Цветовая индексация" - ОДНА полоса в области шкалы, СТРОГО от
    //     начала первой задачи группы до конца последней (не через весь
    //     таймлайн) - и она же перетаскиваемая: схватить и потянуть эту
    //     полосу двигает ВСЮ группу целиком (см. attachGroupDrag()).
    //     Отдельные задачи внутри группы остаются перетаскиваемыми по
    //     отдельности - это СОВСЕМ ДРУГОЙ DOM-элемент (полоса задачи в
    //     buildTaskRow), конфликта между "потащить группу" и "потащить
    //     задачу" нет чисто механически - мышь всегда попадает только в
    //     ОДИН из двух элементов одновременно.
    buildGroupHeaderRow(group, groupIndex, numColWidth, timelineWidth, dayWidth, collapsed, anchor) {
        const row = document.createElement('div');
        row.className = 'gantt-group-header-row';
        row.style.cssText = `
            display: flex;
            align-items: center;
            height: ${ROW_HEIGHT}px;
            border-top: 1px solid var(--md-divider);
            border-bottom: 1px solid var(--md-divider);
            font-weight: 600;
        `;

        // Стрелка сворачивания - делит место со столбцом номера строки
        const toggle = document.createElement('div');
        toggle.className = 'gantt-group-toggle';
        toggle.style.cssText = `
            width: ${numColWidth}px;
            flex-shrink: 0;
            text-align: center;
            font-size: 10px;
            color: var(--md-text-secondary);
            cursor: pointer;
            user-select: none;
        `;
        toggle.textContent = collapsed ? '▸' : '▾';
        toggle.title = collapsed ? 'Развернуть группу' : 'Свернуть группу';
        toggle.addEventListener('mousedown', (e) => e.stopPropagation());
        toggle.addEventListener('click', (e) => {
            e.stopPropagation();
            this.collapsedGroups[groupIndex] = !collapsed;
            this._rerenderGanttSlot();
        });
        row.appendChild(toggle);

        const label = document.createElement('div');
        label.className = 'gantt-group-header-label';
        label.style.cssText = `
            width: ${LABEL_WIDTH}px;
            flex-shrink: 0;
            font-size: 11px;
            color: var(--md-text);
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            padding-right: 6px;
        `;
        label.textContent = group.name;
        label.title = group.name;
        row.appendChild(label);

        if (this.showDurationColumn) {
            const totalCell = document.createElement('div');
            totalCell.style.cssText = `
                width: ${HOURS_COL_WIDTH}px;
                flex-shrink: 0;
                font-size: 10px;
                color: var(--md-text-secondary);
                text-align: right;
                padding-right: 6px;
                font-variant-numeric: tabular-nums;
            `;
            totalCell.textContent = this._formatTotalCell(group.tasks);
            row.appendChild(totalCell);
        }

        if (this.showWorkingDaysColumn) {
            const workdaysCell = document.createElement('div');
            workdaysCell.style.cssText = `
                width: ${WORKDAYS_COL_WIDTH}px;
                flex-shrink: 0;
                font-size: 10px;
                color: var(--md-text-secondary);
                text-align: right;
                padding-right: 6px;
                font-variant-numeric: tabular-nums;
            `;
            let workdaysTotal = 0;
            if (group.tasks.length > 0) {
                const gMinStart = Math.min(...group.tasks.map(t => t.startOffsetDays));
                const gMaxEnd = Math.max(...group.tasks.map(t => t.startOffsetDays + t.durationDays));
                workdaysTotal = this._countWorkingDaysInRange(anchor, gMinStart, gMaxEnd - gMinStart);
            }
            workdaysCell.textContent = `${Helpers.formatNumber(workdaysTotal)}рд`;
            workdaysCell.title = 'Рабочих дней в диапазоне группы';
            row.appendChild(workdaysCell);
        }

        const track = document.createElement('div');
        track.style.cssText = `position: relative; width: ${timelineWidth}px; height: 100%; flex-shrink: 0;`;

        if (group.tasks.length > 0) {
            const minStart = Math.min(...group.tasks.map(t => t.startOffsetDays));
            const maxEnd = Math.max(...group.tasks.map(t => t.startOffsetDays + t.durationDays));
            const indicator = document.createElement('div');
            indicator.className = 'gantt-group-indicator';
            // Багфикс по замечанию Mr.D: раньше каждая группа красилась
            // СВОИМ оттенком (groupTint(), цикл по hue) - "разными
            // цветами", хотя нужен был один нейтральный вид, отличный от
            // цвета САМИХ задач (--md-primary, сплошная заливка) и
            // одновременно похожий по почерку на общее "Итого" (контур +
            // лёгкая заливка), но не сливающийся с ним визуально. Теперь -
            // ОДИН и тот же голубой контур+заливка для ВСЕХ групп
            // (--gantt-group-indicator-border/-fill, theme-aware
            // переменные в styles.css/day_styles.css) - "Итого" остаётся
            // серым (нейтральным), группа - голубая (тоже нейтральная по
            // смыслу, не "цветовая метка конкретной группы").
            indicator.style.cssText = `
                position: absolute;
                top: 5px; bottom: 5px;
                left: ${minStart * dayWidth}px;
                width: ${Math.max(4, (maxEnd - minStart) * dayWidth)}px;
                background: var(--gantt-group-indicator-fill, rgba(144, 202, 249, 0.18));
                border: 1px solid var(--gantt-group-indicator-border, var(--md-primary));
                border-radius: 3px;
                cursor: grab;
            `;
            indicator.title = `${group.name}: ${this._formatTotalCell(group.tasks)} - перетащите, чтобы сдвинуть всю группу`;
            this.attachGroupDrag(indicator, group, dayWidth);
            track.appendChild(indicator);
        }

        row.appendChild(track);
        return row;
    }

    // Перетаскивание ПОЛОСЫ ГРУППЫ (indicator в buildGroupHeaderRow) -
    // сдвигает КАЖДУЮ задачу группы на одну и ту же дельту разом. Та же
    // механика, что и attachBarDrag() у отдельной задачи (собственные
    // document-level слушатели на время драга), только в конце пишет
    // дельту сразу во все taskKey группы, а не в один.
    attachGroupDrag(indicatorEl, group, dayWidth) {
        indicatorEl.addEventListener('mousedown', (e) => {
            e.stopPropagation();
            e.preventDefault();
            const zoom = window.getZoomLevel ? window.getZoomLevel() : 1;
            const startX = e.clientX;
            const startLeft = parseFloat(indicatorEl.style.left) || 0;
            indicatorEl.style.cursor = 'grabbing';

            const onMove = (ev) => {
                const deltaPx = (ev.clientX - startX) / zoom;
                const deltaDays = Math.round(deltaPx / dayWidth);
                indicatorEl.style.left = (startLeft + deltaDays * dayWidth) + 'px';
                indicatorEl.dataset.pendingDeltaDays = String(deltaDays);
            };
            const onUp = () => {
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
                indicatorEl.style.cursor = 'grab';
                const deltaDays = parseInt(indicatorEl.dataset.pendingDeltaDays || '0', 10);
                delete indicatorEl.dataset.pendingDeltaDays;
                if (deltaDays !== 0) {
                    group.tasks.forEach(task => {
                        const current = this.taskDates[task.taskKey] ?? task.startOffsetDays;
                        this.taskDates[task.taskKey] = Math.max(0, current + deltaDays);
                    });
                    if (window.nodeManager) window.nodeManager.calculateAll();
                    if (window.renderer) window.renderer.updateAllDisplays();
                }
            };
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        });
    }

    // Лёгкая перерисовка ТОЛЬКО области диаграммы (не всей ноды и не
    // пересчёт графа) - для чисто визуальных переключений вроде
    // сворачивания группы, где данные не меняются. Тот же приём, что
    // _rebuildGrid() у CalendarNode.
    _rerenderGanttSlot() {
        const el = document.querySelector(`[data-node-id="${this.id}"] .gantt-container-slot`);
        if (!el) return;
        el.innerHTML = '';
        el.appendChild(this.createGanttArea());
    }

    // Строка "Итого" (Раунд 78, по запросу Mr.D) - всегда первая, вне
    // групп. ч.ч. - сумма длительности ВСЕХ задач (во всех группах, если
    // группировка активна). Полоса - лёгкий контур от самого раннего
    // старта до самого позднего конца (общая протяжённость проекта на
    // временной шкале), не заливка - чтобы не путать с настоящей
    // задачей визуально.
    // Раунд 79 - сумма длительности списка задач, в единице, заданной
    // this.durationUnit ('days' -> дн., 'hours' -> ч. - по прямому
    // запросу Mr.D: "если Единица Длительности стоит как Дни, то Итого
    // тоже должно отображаться в днях"). Используется и для общего
    // "Итого" (buildTotalRow), и для итога по каждой группе
    // (buildGroupHeaderRow) - единая точка форматирования.
    _formatTotalCell(tasks) {
        if (this.durationUnit === 'hours') {
            const hours = tasks.reduce((sum, t) => sum + t.durationDays * HOURS_PER_WORKDAY, 0);
            return `${Helpers.formatNumber(hours)}ч`;
        }
        const days = tasks.reduce((sum, t) => sum + t.durationDays, 0);
        return `${Helpers.formatNumber(days)}дн`;
    }

    // Раунд 81 (по запросу Mr.D, п.3-4) - число РАБОЧИХ дней (не
    // выходные/праздники, см. isNonWorkingDay()/this.holidaySet) внутри
    // календарного диапазона [startOffsetDays, startOffsetDays+durationDays).
    // Используется и на уровне отдельной задачи (её собственный диапазон),
    // и на уровне "Итого"/группы (диапазон ОТ самого раннего старта ДО
    // самого позднего конца - тот же диапазон, что уже рисует полоса-обзор).
    _countWorkingDaysInRange(anchor, startOffsetDays, durationDays) {
        let count = 0;
        const wholeDays = Math.ceil(durationDays);
        for (let d = 0; d < wholeDays; d++) {
            if (!isNonWorkingDay(addDays(anchor, startOffsetDays + d), this.holidaySet)) count++;
        }
        return count;
    }

    // Рабочих дней суммарно по списку задач - каждая задача СВОИМ
    // диапазоном (не общим "от первой до последней" - см. докстринг
    // выше про разницу между уровнем задачи и уровнем Итого/группы).
    _countWorkingDaysForTasks(anchor, tasks) {
        return tasks.reduce((sum, t) => sum + this._countWorkingDaysInRange(anchor, t.startOffsetDays, t.durationDays), 0);
    }

    buildTotalRow(numColWidth, timelineWidth, dayWidth, anchor) {
        const row = document.createElement('div');
        row.className = 'gantt-total-row';
        row.style.cssText = `
            display: flex;
            align-items: center;
            height: ${ROW_HEIGHT}px;
            background: var(--md-surface-2);
            border-bottom: 2px solid var(--md-divider);
            font-weight: 600;
        `;

        const spacer = document.createElement('div');
        spacer.style.cssText = `width:${numColWidth}px; flex-shrink:0;`;
        row.appendChild(spacer);

        const label = document.createElement('div');
        label.style.cssText = `
            width: ${LABEL_WIDTH}px;
            flex-shrink: 0;
            font-size: 11px;
            color: var(--md-text);
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            padding-right: 6px;
        `;
        label.textContent = 'Итого';
        row.appendChild(label);

        // Раунд 79 - если Единица длительности стоит "Дни", "Итого"
        // тоже в днях, не в часах (по прямому запросу Mr.D) - обычный
        // столбец задач (ч.ч.) остаётся ВСЕГДА в часах (так и просили в
        // Раунде 78), эта развилка касается только строки "Итого".
        //
        // Багфикс (Раунд 82): totalCell считается ЗДЕСЬ, ДО if - нужна
        // ещё и подсказке полосы-обзора ниже по функции, вне этого
        // блока. Раньше была объявлена ВНУТРИ if(this.showDurationColumn)
        // как const - недоступна за пределами своего блока (block scope),
        // из-за чего сразу же после подключения источника с реальными
        // задачами createGanttArea() падал с ReferenceError - а поскольку
        // это происходило прямо в момент повторной отрисовки ноды
        // (см. rerender() - старый DOM-элемент уже удалён к этому
        // моменту, новый из-за исключения так и не создавался), нода
        // визуально исчезала с холста целиком.
        const totalCell = this._formatTotalCell(this.tasks);
        if (this.showDurationColumn) {
            const hoursCell = document.createElement('div');
            hoursCell.style.cssText = `
                width: ${HOURS_COL_WIDTH}px;
                flex-shrink: 0;
                font-size: 10px;
                color: var(--md-text);
                text-align: right;
                padding-right: 6px;
                font-variant-numeric: tabular-nums;
            `;
            hoursCell.textContent = totalCell;
            row.appendChild(hoursCell);
        }

        // Раунд 81 (п.3) - "Итого рабочих дней": рабочих дней в ОБЩЕМ
        // диапазоне от самого раннего старта до самого позднего конца
        // (тот же диапазон, что уже занимает полоса-обзор ниже) - не
        // сумма по каждой задаче отдельно (та величина - для колонки у
        // ОБЫЧНЫХ строк задач, см. buildTaskRow()).
        if (this.showWorkingDaysColumn) {
            const workdaysCell = document.createElement('div');
            workdaysCell.style.cssText = `
                width: ${WORKDAYS_COL_WIDTH}px;
                flex-shrink: 0;
                font-size: 10px;
                color: var(--md-text);
                text-align: right;
                padding-right: 6px;
                font-variant-numeric: tabular-nums;
            `;
            let workdaysTotal = 0;
            if (this.tasks.length > 0) {
                const minStart = Math.min(...this.tasks.map(t => t.startOffsetDays));
                const maxEnd = Math.max(...this.tasks.map(t => t.startOffsetDays + t.durationDays));
                workdaysTotal = this._countWorkingDaysInRange(anchor, minStart, maxEnd - minStart);
            }
            workdaysCell.textContent = `${Helpers.formatNumber(workdaysTotal)}рд`;
            workdaysCell.title = 'Рабочих дней в общем диапазоне проекта';
            row.appendChild(workdaysCell);
        }

        const track = document.createElement('div');
        track.style.cssText = `position: relative; width: ${timelineWidth}px; height: 100%; flex-shrink: 0;`;

        if (this.tasks.length > 0) {
            const minStart = Math.min(...this.tasks.map(t => t.startOffsetDays));
            const maxEnd = Math.max(...this.tasks.map(t => t.startOffsetDays + t.durationDays));
            const overview = document.createElement('div');
            overview.style.cssText = `
                position: absolute;
                top: 7px; bottom: 7px;
                left: ${minStart * dayWidth}px;
                width: ${Math.max(4, (maxEnd - minStart) * dayWidth)}px;
                border: 1px solid var(--md-text-secondary);
                border-radius: 3px;
                background: rgba(255,255,255,0.05);
            `;
            overview.title = `Общая протяжённость: ${Helpers.formatNumber(maxEnd - minStart)} дн. (суммарно задач: ${totalCell})`;
            track.appendChild(overview);
        }

        row.appendChild(track);
        return row;
    }

    // Перетаскивание полосы мышью - меняет только дату начала (сдвиг
    // целиком, без изменения длительности). Используются собственные
    // document-level слушатели на время драга (как и в остальном UI),
    // чтобы движение мыши ловилось даже за пределами самой полосы.
    // dayWidth - актуальный масштаб линейки на момент начала драга (см.
    // RULER_SCALES) - без него перетаскивание "убегало" бы от курсора
    // после переключения масштаба в панели.
    attachBarDrag(barEl, task, dayWidth) {
        barEl.addEventListener('mousedown', (e) => {
            e.stopPropagation();
            e.preventDefault();
            const zoom = window.getZoomLevel ? window.getZoomLevel() : 1;
            const startX = e.clientX;
            const startOffset = task.startOffsetDays;
            barEl.style.cursor = 'grabbing';

            const onMove = (ev) => {
                const deltaPx = (ev.clientX - startX) / zoom;
                const deltaDays = Math.round(deltaPx / dayWidth);
                const newOffset = Math.max(0, startOffset + deltaDays);
                barEl.style.left = (newOffset * dayWidth) + 'px';
                barEl.dataset.pendingOffset = String(newOffset);
            };
            const onUp = () => {
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
                barEl.style.cursor = 'grab';
                if (barEl.dataset.pendingOffset !== undefined) {
                    this.taskDates[task.taskKey || task.name] = parseInt(barEl.dataset.pendingOffset, 10);
                    delete barEl.dataset.pendingOffset;
                    if (window.nodeManager) window.nodeManager.calculateAll();
                    if (window.renderer) window.renderer.updateAllDisplays();
                }
            };
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        });
    }

    // Растягивание полосы мышью за левый/правый край (Раунд 81, по
    // запросу Mr.D: "нужна возможность их графического редактирования").
    // side='right' - меняет ТОЛЬКО длительность (старт неподвижен).
    // side='left' - двигает старт И меняет длительность в обратную
    // сторону, чтобы конец задачи оставался на месте (обычное поведение
    // "растянуть за левый край" в любом Gantt-инструменте). Минимум
    // длительности - 0.5 дня (не даём схлопнуть полосу в ничто через
    // перетаскивание за противоположный край).
    attachBarResize(handleEl, task, dayWidth, side) {
        handleEl.addEventListener('mousedown', (e) => {
            e.stopPropagation(); // не даём событию всплыть до attachBarDrag на самой полосе
            e.preventDefault();
            const barEl = handleEl.parentElement;
            const zoom = window.getZoomLevel ? window.getZoomLevel() : 1;
            const startX = e.clientX;
            const startOffset = task.startOffsetDays;
            const startDuration = task.durationDays;
            handleEl.style.cursor = 'ew-resize';

            const onMove = (ev) => {
                const deltaPx = (ev.clientX - startX) / zoom;
                const deltaDays = Math.round(deltaPx / dayWidth);
                let newOffset = startOffset;
                let newDuration = startDuration;

                if (side === 'right') {
                    newDuration = Math.max(0.5, startDuration + deltaDays);
                } else {
                    // левый край не может уйти дальше конца задачи (тот
                    // же Math.max(0.5, ...) на длительность гарантирует это)
                    const maxDelta = startDuration - 0.5;
                    const clampedDelta = Math.min(Math.max(deltaDays, -startOffset), maxDelta);
                    newOffset = startOffset + clampedDelta;
                    newDuration = startDuration - clampedDelta;
                }

                barEl.style.left = (newOffset * dayWidth) + 'px';
                barEl.style.width = Math.max(4, newDuration * dayWidth) + 'px';
                handleEl.dataset.pendingOffset = String(newOffset);
                handleEl.dataset.pendingDuration = String(newDuration);
            };
            const onUp = () => {
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
                const pendingOffset = handleEl.dataset.pendingOffset;
                const pendingDuration = handleEl.dataset.pendingDuration;
                delete handleEl.dataset.pendingOffset;
                delete handleEl.dataset.pendingDuration;
                if (pendingOffset !== undefined && pendingDuration !== undefined) {
                    const key = task.taskKey || task.name;
                    const newOffset = parseFloat(pendingOffset);
                    const newDuration = parseFloat(pendingDuration);
                    this.taskDates[key] = newOffset;
                    // Багфикс (Раунд 83, по жалобе Mr.D: "перемешались
                    // фактические и рабочие дни... к дню опять
                    // прибавляются праздники"). newDuration - это
                    // ВИЗУАЛЬНАЯ (календарная) ширина полосы после
                    // растягивания - то, что фактически показывает bar на
                    // экране. Но this.taskDurationOverrides читается на
                    // следующем calculate() как "сколько РАБОЧИХ дней
                    // отработать" (аргумент spanWorkingDays(), которая
                    // САМА пропускает выходные/праздники внутри диапазона).
                    // Если положить туда календарную ширину как есть,
                    // spanWorkingDays() пропустит выходные ВНУТРИ уже
                    // растянутого диапазона ЕЩЁ РАЗ - календарная ширина
                    // раздувается на каждое редактирование ("опять
                    // прибавляются праздники"). В режиме 'working'
                    // сохраняем не календарную ширину, а число РАБОЧИХ
                    // дней внутри неё (_countWorkingDaysInRange) - тогда
                    // spanWorkingDays() на следующем пересчёте
                    // восстановит РОВНО ТОТ ЖЕ календарный диапазон, а не
                    // расширит его. В режиме 'calendar' пропуска выходных
                    // нет вообще - календарная ширина и есть исходная
                    // длительность, конвертировать нечего.
                    //
                    // ВАЖНО: конвертация нужна, только если override
                    // потом СНОВА пройдёт через spanWorkingDays() - это
                    // 'list' и групповой режимы (см. calculate()). В
                    // sourceMode==='table' override используется
                    // НАПРЯМУЮ как календарная ширина (таблица просто
                    // читает свои даты как есть, без пересборки через
                    // spanWorkingDays) - конвертация там дала бы
                    // ОБРАТНЫЙ эффект: бар визуально сжался бы до числа
                    // рабочих дней вместо запрошенной календарной ширины.
                    if (this.scheduleMode === 'working' && this.sourceMode !== 'table') {
                        const anchor = parseISODate(this.startDate) || new Date();
                        this.taskDurationOverrides[key] = Math.max(0.5, this._countWorkingDaysInRange(anchor, newOffset, newDuration));
                    } else {
                        this.taskDurationOverrides[key] = newDuration;
                    }
                    if (window.nodeManager) window.nodeManager.calculateAll();
                    if (window.renderer) window.renderer.updateAllDisplays();
                }
            };
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        });
    }


    // createGanttArea() КАК ЕСТЬ: та же интерактивная диаграмма
    // (перетаскивание полос мышью/ручки дедлайна), что и в теле ноды
    // графа - метод самодостаточен (никаких обращений к data-node-id
    // ноды или чему-то ещё специфичному для графа) и НЕ зависит от того,
    // где именно окажется в DOM. Обработчики drag сами вызывают
    // nodeManager.calculateAll()/renderer.updateAllDisplays() при
    // отпускании мыши - это пересчитывает ноду "Дашборд" (если она на
    // активном Листе) и обновляет Доску тем же путём, что уже работает у
    // TableNode/ChartNode - отдельная связка с boardManager тут не нужна.
    //
    // Известное ограничение: ширина диаграммы считается от периода/
    // масштаба линейки, а не от ширины виджета на странице (totalDays *
    // dayWidth может быть заметно шире 730px страницы A4, особенно в
    // масштабе "Дни" с периодом "Год") - тогда виджет скроллится по
    // горизонтали внутри себя (.board-widget-body, см. styles.css),
    // как и в узле графа. Для печати/PDF стоит выбирать масштаб
    // "Недели" или сжимать период - подгонка под ширину страницы
    // осталась за рамками этого раунда.
    getDashboardWidget() {
        return {
            type: 'gantt',
            title: this.customName || null,
            render: (container) => {
                container.appendChild(this.createGanttArea());
            }
        };
    }

    // === Данные ===

    // Таблица считается совместимой, если среди столбцов есть и
    // "начало", и "окончание" (по вхождению в заголовок, без учёта
    // регистра) - тогда её можно использовать напрямую, без пересчёта
    // из списка.
    isCompatibleTable(tableData) {
        const headers = tableData.columns.map(c => (c.header || '').toLowerCase());
        return headers.some(h => h.includes('начал')) && headers.some(h => h.includes('оконч'));
    }

    tasksFromTable(tableData) {
        // Багфикс (Раунд 83): раньше брался ПЕРВЫЙ текстовый столбец -
        // работало, пока "Задача" была единственным текстовым столбцом.
        // Теперь перед ней в схеме buildOutputTable() стоит "Группа"
        // (тоже текст) - без явного поиска по имени "Группа" ошибочно
        // подхватывалась бы как имя задачи. Ищем именно "задач" в
        // заголовке, с тем же запасным вариантом (первый текстовый), что
        // и раньше - для таблиц НЕ от GanttNode, где столбец может
        // называться иначе.
        const nameCol = tableData.columns.find(c => (c.header || '').toLowerCase().includes('задач'))
            || tableData.columns.find(c => c.format === 'text')
            || tableData.columns[0];
        const startCol = tableData.columns.find(c => (c.header || '').toLowerCase().includes('начал'));
        const endCol = tableData.columns.find(c => (c.header || '').toLowerCase().includes('оконч'));
        // "Раб.дни" - авторитетное число РАБОЧИХ дней, если источник -
        // другая Диаграмма Ганта (её buildOutputTable() всегда пишет
        // этот столбец) - см. докстринг _extractRawTasks() про то, зачем
        // это нужно (баг двойного применения праздников при цепочке
        // Гант -> Гант, Раунд 83).
        const workdaysCol = tableData.columns.find(c => (c.header || '').toLowerCase().includes('раб'));
        if (!startCol || !endCol) return [];

        const anchor = parseISODate(this.startDate) || new Date();
        const tasks = [];
        for (let i = 0; i < tableData.rowCount; i++) {
            const name = nameCol ? String(nameCol.values[i] ?? `Задача ${i + 1}`) : `Задача ${i + 1}`;
            const startD = parseDateRu(startCol.values[i]) || parseISODate(startCol.values[i]);
            const endD = parseDateRu(endCol.values[i]) || parseISODate(endCol.values[i]);
            if (!startD || !endD) continue;
            const durationDays = Math.max(0, daysBetween(startD, endD));
            const rawFromCol = workdaysCol ? Number(workdaysCol.values[i]) : NaN;
            tasks.push({
                name,
                startOffsetDays: daysBetween(anchor, startD),
                durationDays,
                // Если столбца "Раб.дни" нет (обычная таблица, не от
                // GanttNode) - лучшее, что можно сделать без доступа к
                // календарю источника - взять ту же календарную
                // длительность (прежнее поведение, тот же риск
                // задвоения праздников при цепочке, что был всегда для
                // таких таблиц - не хуже, чем раньше).
                rawDurationDays: !isNaN(rawFromCol) ? rawFromCol : durationDays
            });
        }
        return tasks;
    }

    buildOutputTable() {
        const anchor = parseISODate(this.startDate) || new Date();
        const groups = [];
        const names = [];
        const starts = [];
        const workdays = [];
        const ends = [];
        const factDays = [];
        const responsible = [];

        this.tasks.forEach(t => {
            groups.push(t.groupName || '');
            names.push(t.name);
            starts.push(formatDateRu(addDays(anchor, t.startOffsetDays)));
            workdays.push(this._countWorkingDaysInRange(anchor, t.startOffsetDays, t.durationDays));
            ends.push(formatDateRu(addDays(anchor, t.startOffsetDays + t.durationDays)));
            factDays.push(t.durationDays);
            responsible.push(this.taskResponsible[t.taskKey] || '');
        });

        // Раунд 83 (по прямому запросу Mr.D) - фиксированная схема,
        // всегда все семь столбцов, "Группа" больше не условна (пустая
        // строка, если группировка не активна - стабильный контракт для
        // downstream-потребителей независимо от режима). Порядок задан
        // явно: Группа, Задача, Начало, Раб.дни, Окончание, Факт.дни,
        // Ответственный.
        //
        // "Раб.дни" - АВТОРИТЕТНОЕ число рабочих дней (без выходных/
        // праздников) внутри диапазона [Начало, Окончание) - именно ЕГО,
        // а не "Факт.дни", читает следующая Диаграмма Ганта при цепочке
        // Гант -> Гант (см. tasksFromTable()/_extractRawTasks()) - иначе
        // календарная ширина (уже включающая пропущенные выходные)
        // подавалась бы на вход ещё раз, и праздники накладывались бы
        // повторно (тот же класс бага, что чинили для растягивания
        // мышью в этом раунде - см. attachBarResize()).
        //
        // "Ответственный" - пока пустой задел (this.taskResponsible,
        // Раунд 83) - реализация (цвет по ответственному и т.п.)
        // обсуждается отдельным раундом, сама колонка нужна уже сейчас,
        // чтобы формат данных был стабилен для тех, кто уже строит
        // цепочки поверх вывода Ганта.
        const columns = [
            { header: 'Группа', values: groups, format: 'text' },
            { header: 'Задача', values: names, format: 'text' },
            { header: 'Начало', values: starts, format: 'text' },
            { header: 'Раб.дни', values: workdays, format: 'number' },
            { header: 'Окончание', values: ends, format: 'text' },
            { header: 'Факт.дни', values: factDays, format: 'number' },
            { header: 'Ответственный', values: responsible, format: 'text' }
        ];

        return new TableData(columns, { title: this.customName || this.getDisplayName() });
    }

    calculate(nodeManager) {
        this.checkAndAddEmptySlot();

        const connections = window.connectionManager?.getConnections() || [];

        // Раунд 73/78 - "Праздники" на фиксированном индексе, не зависит
        // от числа источников задач (см. HOLIDAY_SOCKET_INDEX). Любая
        // нода, которая понимает HolidayParser.extract() - CalendarNode
        // ИЛИ JsonImportNode с производственным календарём (см. докстринг
        // holidayParser.js). Пустой Set, если сокет не подключён - тогда
        // весь код ниже ведёт себя ровно как раньше (только выходные).
        const holidayConn = connections.find(c => c.targetNodeId === this.id && c.targetSocket === HOLIDAY_SOCKET_INDEX);
        const holidaySrc = holidayConn ? nodeManager.getNode(holidayConn.sourceNodeId) : null;
        this.holidaySet = HolidayParser.extract(holidaySrc);
        this._holidaySourceName = holidaySrc ? (holidaySrc.customName || holidaySrc.getDisplayName?.() || 'источник') : null;
        if (holidayConn && this.holidaySet.size === 0) {
            this.addBadge('gantt-holidays-empty', { type: 'warning', text: 'Праздники подключены, но не распознаны (0 дат)' });
        } else {
            this.clearBadge('gantt-holidays-empty');
        }

        // Раунд 78 - собираем ВСЕ подключённые источники задач (не только
        // сокет 0) - см. конструктор про this.inputSockets.
        const sources = this.inputSockets
            .map(idx => connections.find(c => c.targetNodeId === this.id && c.targetSocket === idx))
            .filter(Boolean)
            .map(c => nodeManager.getNode(c.sourceNodeId))
            .filter(Boolean);

        this._sourceStatuses = this.inputSockets.map(idx => {
            const conn = connections.find(c => c.targetNodeId === this.id && c.targetSocket === idx);
            const src = conn ? nodeManager.getNode(conn.sourceNodeId) : null;
            if (!src) return { socketIndex: idx, name: null };
            const isTable = src.tableData && src.tableData.columns.length > 0 && this.isCompatibleTable(src.tableData);
            return {
                socketIndex: idx,
                name: src.customName || src.getDisplayName?.() || 'источник',
                mode: Array.isArray(src.tasks) ? 'gantt' : (isTable ? 'table' : 'list'),
                count: Array.isArray(src.tasks) ? src.tasks.length : undefined
            };
        });

        if (sources.length === 0) {
            this.sourceMode = 'list';
            this.taskGroups = null;
            this.tasks = [];
            this.tableData = this.buildOutputTable();
            this.value = 0;
            return this.value;
        }

        // Ровно ОДИН источник - прежнее поведение без единого изменения
        // (совместимо с проектами, сохранёнными до Раунда 78). Группировка
        // (полупрозрачная подложка + строка-заголовок группы) появляется
        // ТОЛЬКО когда источников 2 или больше - см. докстринг класса.
        if (sources.length === 1) {
            const src = sources[0];
            this.taskGroups = null;

            if (src.tableData && src.tableData.columns.length > 0 && this.isCompatibleTable(src.tableData)) {
                this.sourceMode = 'table';
                this.tasks = this.tasksFromTable(src.tableData).map(t => {
                    const durationDays = this.taskDurationOverrides[t.name] ?? t.durationDays;
                    return { ...t, taskKey: t.name, durationDays };
                });
                this.tableData = this.buildOutputTable();
                this.value = this.tasks.length;
                return this.value;
            }

            this.sourceMode = 'list';
            const items = src.listData?.items || [];
            const anchor = parseISODate(this.startDate) || new Date();

            let cursor = 0;
            this.tasks = items.map(item => {
                const rawDuration = Math.max(0, this.durationUnit === 'hours' ? (item.value || 0) / HOURS_PER_WORKDAY : (item.value || 0));
                const name = item.name || 'Задача';
                // Раунд 81 - если полосу растягивали мышью, this.taskDurationOverrides
                // хранит длительность, ЗАДАННУЮ ПОЛЬЗОВАТЕЛЕМ - она заменяет
                // ту, что пришла бы из источника (item.value), иначе
                // растягивание "отменялось" бы на следующем же пересчёте.
                const duration = this.taskDurationOverrides[name] ?? rawDuration;
                let startOffsetDays = this.taskDates[name];
                if (startOffsetDays === undefined) {
                    startOffsetDays = cursor;
                    this.taskDates[name] = startOffsetDays;
                }

                let endOffsetDays;
                if (this.scheduleMode === 'working') {
                    startOffsetDays = nextWorkingOffset(anchor, startOffsetDays, this.holidaySet);
                    endOffsetDays = spanWorkingDays(anchor, startOffsetDays, duration, this.holidaySet);
                } else {
                    endOffsetDays = startOffsetDays + duration;
                }

                cursor = Math.max(cursor, endOffsetDays);
                return { name, taskKey: name, durationDays: endOffsetDays - startOffsetDays, startOffsetDays };
            });

            this.tableData = this.buildOutputTable();
            this.value = this.tasks.length;
            return this.value;
        }

        // 2+ источника - ГРУППИРОВКА (Раунд 78, по прямому запросу Mr.D:
        // "подключить в одну диаграмму Ганта несколько других"). Каждый
        // источник = своя группа, расписывается НЕЗАВИСИМО от остальных
        // (свой курсор, старт с anchor - как отдельная "дорожка"), но на
        // общей временной шкале. Ключ в this.taskDates - "групппа:имя",
        // не голое имя - иначе задачи с одинаковым именем в разных
        // группах перетирали бы сохранённую позицию друг друга.
        this.sourceMode = 'groups';
        const anchor = parseISODate(this.startDate) || new Date();

        this.taskGroups = sources.map((src, groupIndex) => {
            const groupName = src.customName || src.getDisplayName?.() || `Группа ${groupIndex + 1}`;
            const rawTasks = this._extractRawTasks(src);

            let cursor = 0;
            const tasks = rawTasks.map(rt => {
                const key = `${groupIndex}:${rt.name}`;
                const duration = this.taskDurationOverrides[key] ?? rt.durationDays;
                let startOffsetDays = this.taskDates[key];
                if (startOffsetDays === undefined) {
                    startOffsetDays = cursor;
                    this.taskDates[key] = startOffsetDays;
                }

                let endOffsetDays;
                if (this.scheduleMode === 'working') {
                    startOffsetDays = nextWorkingOffset(anchor, startOffsetDays, this.holidaySet);
                    endOffsetDays = spanWorkingDays(anchor, startOffsetDays, duration, this.holidaySet);
                } else {
                    endOffsetDays = startOffsetDays + duration;
                }

                cursor = Math.max(cursor, endOffsetDays);
                return {
                    name: rt.name,
                    taskKey: key,
                    durationDays: endOffsetDays - startOffsetDays,
                    startOffsetDays,
                    groupIndex,
                    groupName
                };
            });

            return { name: groupName, tasks };
        });

        this.tasks = this.taskGroups.flatMap(g => g.tasks);
        this.tableData = this.buildOutputTable();
        this.value = this.tasks.length;
        return this.value;
    }

    // Достаёт "сырые" задачи (имя + РАБОЧАЯ длительность в днях, БЕЗ дат)
    // из источника - будь то другая Диаграмма Ганта, совместимая таблица
    // (Начало/Окончание) или обычный список. Эта диаграмма расписывает
    // группу ЗАНОВО, со своим anchor/курсором - принципиально важно
    // взять именно РАБОЧУЮ длительность (rawDurationDays - число рабочих
    // дней, без выходных/праздников), а не календарную ширину исходной
    // задачи (durationDays - та УЖЕ включает пропущенные внутри выходные,
    // см. столбец "Раб.дни" в buildOutputTable()). Если бы сюда попадала
    // календарная ширина, spanWorkingDays() на следующем пересчёте
    // пропустила бы выходные ВНУТРИ уже растянутого диапазона ЕЩЁ РАЗ -
    // тот же класс бага, что чинили для растягивания мышью в этом же
    // раунде (см. attachBarResize()), только на уровне цепочки нод, а не
    // одной ноды.
    //
    // Таблица - В ПРИОРИТЕТЕ над сырыми this.tasks: buildOutputTable()
    // всегда пишет столбец "Раб.дни" (авторитетную цифру), а голые
    // объекты в src.tasks - нет (там только календарная durationDays).
    _extractRawTasks(src) {
        if (src.tableData && src.tableData.columns.length > 0 && this.isCompatibleTable(src.tableData)) {
            return this.tasksFromTable(src.tableData).map(t => ({ name: t.name, durationDays: t.rawDurationDays }));
        }
        if (Array.isArray(src.tasks) && src.tasks.length > 0) {
            // Запасной путь для источников без tableData вообще (не
            // должно случаться для настоящей GanttNode - у неё tableData
            // есть всегда, см. calculate()) - лучшее, что можно сделать
            // без доступа к столбцу "Раб.дни" источника, календарная
            // ширина как есть, тот же риск, что был всегда для таких
            // источников.
            return src.tasks.map(t => ({ name: t.name, durationDays: t.durationDays }));
        }
        const items = src.listData?.items || [];
        return items.map(item => ({
            name: item.name || 'Задача',
            durationDays: Math.max(0, this.durationUnit === 'hours' ? (item.value || 0) / HOURS_PER_WORKDAY : (item.value || 0))
        }));
    }

    updateDisplay(element) {
        element.querySelectorAll('.gantt-source-label').forEach(label => {
            const idx = Number(label.dataset.socketIndex);
            label.textContent = this._sourceStatusText(idx);
        });

        const holidayLabel = element.querySelector('.gantt-holiday-label');
        if (holidayLabel) holidayLabel.textContent = this._holidayStatusText();

        const slot = element.querySelector('.gantt-container-slot');
        if (slot) {
            slot.innerHTML = '';
            slot.appendChild(this.createGanttArea());
        }

        const outputCount = element.querySelector('.gantt-output-count');
        if (outputCount) outputCount.textContent = `${this.tasks.length} задач`;
    }

    _sourceStatusText(socketIndex) {
        const status = (this._sourceStatuses || []).find(s => s.socketIndex === socketIndex);
        if (!status || !status.name) return 'не подключено';
        if (status.mode === 'table') return `таблица: ${status.name}`;
        if (status.mode === 'gantt') return `Гант: ${status.name} (${status.count} задач)`;
        return status.name;
    }

    _holidayStatusText() {
        if (!this._holidaySourceName) return 'праздники: не подключено';
        return `праздники: ${this._holidaySourceName} — ${this.holidaySet.size} дат`;
    }

    // Раунд 78 - те же три метода, что уже отлажены в OperationNode/
    // CalendarNode (см. их докстринги) - тот же принцип авто-роста
    // слотов, ничего не переизобретаем.
    isSocketConnected(index) {
        const connections = window.connectionManager?.getConnections() || [];
        return connections.some(c => c.targetNodeId === this.id && c.targetSocket === index);
    }

    checkAndAddEmptySlot() {
        if (this.collapsed) return;
        if (this.inputSockets.length >= this.maxInputs) return;

        const connections = window.connectionManager?.getConnections() || [];
        const usedSockets = connections.filter(c => c.targetNodeId === this.id).map(c => c.targetSocket);
        const freeSockets = this.inputSockets.filter(idx => !usedSockets.includes(idx));

        if (freeSockets.length === 0) {
            const newIndex = this.inputSockets.length;
            this.inputSockets.push(newIndex);
            this.inputs = this.inputSockets.length;
            setTimeout(() => {
                if (!this._isRerendering && !this.collapsed) this.rerender();
            }, 50);
        }
    }

    rerender() {
        if (this._isRerendering) return;
        this._isRerendering = true;
        const el = document.querySelector(`[data-node-id="${this.id}"]`);
        if (el) {
            el.remove();
            if (window.nodeManager) {
                window.nodeManager.renderNode(this);
                if (window.renderer) {
                    window.renderer.drawAllConnections(window.connectionManager?.getConnections() || []);
                }
            }
        }
        setTimeout(() => { this._isRerendering = false; }, 100);
    }

    // Первая нода, помеченная новой системой бейджей (см. baseNode.js) -
    // самая свежая и всё ещё меняющаяся часть проекта на данный момент
    getStaticBadges() {
        return [{ type: 'beta', text: 'Экспериментальная нода - интерфейс и поведение могут ещё измениться' }];
    }

    // Боковая панель: календарь плана (дата начала/период отображения/
    // единица длительности)
    getInspectorSchema() {
        const fields = super.getInspectorSchema();

        fields.push({ type: 'section', label: 'Календарь' });

        fields.push({
            key: 'startDate',
            label: 'Дата начала плана',
            type: 'date',
            get: () => this.startDate,
            set: (v) => { this.startDate = v || this.startDate; }
        });

        fields.push({
            key: 'periodPreset',
            label: 'Период отображения',
            type: 'select',
            options: [
                { value: 'custom', label: 'Своя протяжённость (см. поле ниже)' },
                ...Object.entries(PERIOD_PRESETS).map(([value, cfg]) => ({ value, label: cfg.label }))
            ],
            get: () => this.periodPreset,
            set: (v) => { this.periodPreset = v; }
        });

        fields.push({
            key: 'customPeriodDays',
            label: 'Протяжённость, дней (при "Своя")',
            type: 'number',
            min: 1, step: 1,
            get: () => this.customPeriodDays,
            set: (v) => { this.customPeriodDays = Math.max(1, parseInt(v, 10) || 60); }
        });

        fields.push({
            key: 'durationUnit',
            label: 'Единица длительности',
            type: 'select',
            options: [
                { value: 'days', label: 'Дни' },
                { value: 'hours', label: 'Часы' }
            ],
            get: () => this.durationUnit,
            set: (v) => { this.durationUnit = v; }
        });

        fields.push({
            key: 'scheduleMode',
            label: 'Расчёт длительности',
            type: 'select',
            options: [
                { value: 'calendar', label: 'Календарные дни' },
                { value: 'working', label: 'Рабочие дни (искл. выходные)' }
            ],
            get: () => this.scheduleMode,
            set: (v) => { this.scheduleMode = v === 'working' ? 'working' : 'calendar'; }
        });

        fields.push({
            key: 'rulerScale',
            label: 'Масштаб линейки',
            type: 'select',
            options: Object.entries(RULER_SCALES).map(([value, cfg]) => ({ value, label: cfg.label })),
            get: () => this.rulerScale,
            set: (v) => { this.rulerScale = v; }
        });

        fields.push({
            key: 'showGridLines',
            label: 'Вертикальные линии',
            type: 'checkbox',
            get: () => this.showGridLines,
            set: (v) => { this.showGridLines = !!v; }
        });

        // Раунд 81 (п.4, по прямому запросу Mr.D) - независимые флаги
        // видимости двух колонок слева от шкалы (см. buildTaskRow()/
        // buildTotalRow()/buildGroupHeaderRow()).
        fields.push({
            key: 'showDurationColumn',
            label: 'Колонка "ч.ч." / Итого дней',
            type: 'checkbox',
            get: () => this.showDurationColumn,
            set: (v) => { this.showDurationColumn = !!v; }
        });

        fields.push({
            key: 'showWorkingDaysColumn',
            label: 'Колонка "Раб.дн." / Итого рабочих дней',
            type: 'checkbox',
            get: () => this.showWorkingDaysColumn,
            set: (v) => { this.showWorkingDaysColumn = !!v; }
        });

        fields.push({
            key: 'deadlineDate',
            label: 'Дедлайн (красная линия)',
            type: 'date',
            get: () => this.deadlineDate || '',
            set: (v) => { this.deadlineDate = v || null; }
        });

        // Строки многоуровневой шапки видны и настраиваются только в
        // масштабе "Дни" - в других масштабах у шапки одна строка-линейка,
        // переключателям просто нечего было бы показывать
        if (this.rulerScale === 'days') {
            fields.push({ type: 'section', label: 'Строки шапки (масштаб "Дни")' });

            fields.push({
                key: 'showYearRow', label: 'Показывать год', type: 'checkbox',
                get: () => this.showYearRow,
                set: (v) => { this.showYearRow = !!v; }
            });
            fields.push({
                key: 'showMonthRow', label: 'Показывать месяц', type: 'checkbox',
                get: () => this.showMonthRow,
                set: (v) => { this.showMonthRow = !!v; }
            });
            fields.push({
                key: 'showDayRow', label: 'Показывать число', type: 'checkbox',
                get: () => this.showDayRow,
                set: (v) => { this.showDayRow = !!v; }
            });
            fields.push({
                key: 'showWeekdayRow', label: 'Показывать день недели', type: 'checkbox',
                get: () => this.showWeekdayRow,
                set: (v) => { this.showWeekdayRow = !!v; }
            });
        }

        return fields;
    }
}
