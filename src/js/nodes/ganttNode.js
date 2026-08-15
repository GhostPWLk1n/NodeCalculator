/**
 * SPDX-License-Identifier: MIT
 * SPDX-FileCopyrightText: 2024 NodeCalculate Team
 * SPDX-FileCopyrightText: 2024 Pavel Fomin
 *
 * @file    ganttNode.js
 * @brief   Обработчик: список задач (имя+длительность) -> календарный план с диаграммой Ганта (выход Data)
 * @author  Pavel Fomin
 * @version 1.8.69
 * @see     https://github.com/GhostPWLk1n/NodeCalculator.git
 */

import { BaseNode } from './baseNode.js';
import { Helpers } from '../utils/helpers.js';
import { TableData, ListData } from '../utils/dataTypes.js';
import { SocketFactory } from '../utils/socketFactory.js';
import { HolidayParser } from '../utils/holidayParser.js';
import { attachColumnResizeHandle } from '../utils/columnResize.js';
import { COLOR_PALETTE } from '../utils/columnFormatting.js';
import { initBoardPublishFields, syncNodeToBoards, buildBoardInspectorFields } from '../utils/boardPublish.js';

const ROW_HEIGHT = 26;      // px на строку задачи
const MAX_VISIBLE_ROWS = 6; // после скольки задач включается вертикальный скролл
const LABEL_WIDTH = 84;     // px, колонка с названиями задач
const HOURS_COL_WIDTH = 34; // px, колонка "ч.ч." (Раунд 78)
const WORKDAYS_COL_WIDTH = 34; // px, колонка "Раб.дн." (Раунд 81)
const DATE_COL_WIDTH = 84; // px, колонки "Дата начала"/"Дата окончания" (Раунд 187) - под формат ДД.ММ.ГГГГ
const RESPONSIBLE_COL_WIDTH = 70; // px, колонка "Ответственный" (Раунд 88, чек-лист 1.7.21)
const CALDAYS_COL_WIDTH = 40; // px, колонка "Кал. дни" (Раунд 101, чек-лист)
const SUM_WORKDAYS_COL_WIDTH = 44; // px, колонка "Сум.раб.дн." (Раунд 157)
const SUM_HOURS_COL_WIDTH = 44; // px, колонка "Сум.ч.ч." (Раунд 157)
// Раунд 133 (по запросу Mr.D: "нужно добавить столбик 'Раздел' сразу
// после № п/п. Туда нужно будет перенести разделы из таблицы как есть") -
// на самой диаграмме, рядом с уже существующим экранным "№ п/п".
const SECTION_COL_WIDTH = 100;
// Раунд 116 (уточнение Mr.D по механике строк: "сделать строку перед
// № п/п для того чтобы в ней появлялись + и -, заодно расширит поле
// для активации фокуса") - узкая колонка ПЕРЕД "№ п/п", ВСЕГДА
// присутствует (не toggle-able, как остальные - это часть самого
// механизма фокуса/редактирования, не опциональное отображение данных).
const FOCUS_COL_WIDTH = 16;
// Раунд 130/151 - отступ на КАЖДЫЙ уровень вложенности (иерархия Блок/
// Стадия, ИЛИ произвольная вложенность Раздел/Подраздел) - единая
// константа на уровне модуля (не внутри createGanttArea()) - нужна и
// buildTaskRow()/buildGroupHeaderRow() для перевода indentPx обратно в
// "сколько линий-проводников рисовать" (см. Раунд 151).
const GROUP_INDENT_PX_CONST = 16;
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
// Раунд 95 (чек-лист 1.7.21, п.2.1) - входные сокеты "Заголовок"/
// "Подзаголовок", тем же приёмом, что HOLIDAY_SOCKET_INDEX - фиксированные,
// не зависят от растущего диапазона источников задач.
const TITLE_INPUT_SOCKET_INDEX = 51;
const SUBTITLE_INPUT_SOCKET_INDEX = 52;

// Масштаб линейки: и ширина одного дня в px (плотность), и шаг делений.
// Данные внутри по-прежнему считаются в днях (см. calculate()) - режим
// "Часы" не хранит время суток отдельно, а просто даёт более широкий,
// "растянутый" масштаб для точной расстановки коротких задач; деления
// у него всё равно по дням, но каждый день шире и заметнее.
const RULER_SCALES = {
    hours: { label: 'Часы', dayWidth: 48, tickStepDays: 1 },
    days: { label: 'Дни', dayWidth: 22, tickStepDays: 1 },
    weeks: { label: 'Недели', dayWidth: 10, tickStepDays: 7 },
    // Раунд 100 (по запросу Mr.D: "для протяжённых работ не хватает
    // масштаба месяц") - настоящая календарная группировка через
    // buildGroupedRow() (та же функция, что уже строит строки года/
    // месяца в масштабе "Дни"), не примитивные тики через 30 дней -
    // границы месяцев показываются РЕАЛЬНЫЕ (1 января, не "через 30
    // дней от старта"), см. createGanttArea().
    months: { label: 'Месяцы', dayWidth: 4, tickStepDays: 30 }
};

const PERIOD_PRESETS = {
    month: { label: 'Месяц', days: 30 },
    quarter: { label: 'Квартал', days: 90 },
    halfyear: { label: 'Полгода', days: 182 },
    year: { label: 'Год', days: 365 }
};
// Раунд 183 (по запросу Mr.D: "Период отображения давай сделаем по
// умолчанию Авто (берёт начальную и конечную дату, и к конечной
// прибавляет ещё месяц для отображения)") - НЕ входит в PERIOD_PRESETS
// (у него нет ФИКСИРОВАННОГО числа дней - вычисляется динамически по
// фактическим датам задач, см. _computeAutoPeriodDays()) - список
// "разрешённых" значений periodPreset (конструктор, ниже) собирается
// отдельно, включая и 'auto', и 'custom' (та тоже вне PERIOD_PRESETS).
const AUTO_PERIOD_EXTRA_DAYS = 30; // "ещё месяц для отображения" - тот же гранularity, что у пресета "Месяц"

// Date.getDay(): 0=вс, 1=пн, ... 6=сб
const WEEKDAY_LABELS = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
const MONTH_LABELS = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
const HEADER_ROW_HEIGHT = 15; // px на каждую из строк шапки (год/месяц/число/день недели)

// === Даты/планирование - вынесены в отдельный модуль (Раунд 141, по
// запросу Mr.D: "модуль узла gantt_node_js получился очень громоздким,
// надо его разбить, разнести логику, вынести математику отдельно") -
// см. ganttMath.js, там же докстринг про единый принцип хранения дат
// (рабочие дни для хранения, календарные - только для отрисовки).
import {
    parseISODate, addDays, formatISODate, formatDateRu, parseDateRu,
    daysBetween, isWeekend, isNonWorkingDay, nextWorkingOffset,
    spanWorkingDays
} from '../utils/ganttMath.js';

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
        this.outputs = 3;
        this.width = config.width || 320;

        this.startDate = config.startDate || new Date().toISOString().slice(0, 10);
        // Раунд 99 (по запросу Mr.D: "если диаграмма Ганта видит дату
        // начала работ, она должна строить график сразу от неё") - в
        // режиме 'table' (источник несёт РЕАЛЬНЫЕ даты, не просто
        // список для авто-расстановки) this.startDate автоматически
        // подтягивается к САМОЙ РАННЕЙ дате "Начало" среди задач - иначе
        // при подключении данных с реальными датами (например, от
        // "Обработки таблиц Ганта" после разбора цвета) диаграмма
        // осталась бы заякорена на "сегодня" по умолчанию, и задачи с
        // датами РАНЬШЕ сегодня оказались бы со отрицательным смещением
        // (визуально обрезаны/не видны). Флаг - явно можно отключить,
        // если нужно зафиксировать якорь вручную. По умолчанию включено
        // (см. обсуждение с Mr.D - "должна строить сразу").
        this.autoAnchorFromData = config.autoAnchorFromData ?? true;
        // Раунд 183 (по запросу Mr.D: "Период отображения давай сделаем
        // по умолчанию Авто") - 'custom' и 'auto' оба ВНЕ PERIOD_PRESETS
        // (у 'custom' число дней приходит от отдельного поля
        // customPeriodDays, у 'auto' - вычисляется динамически, см.
        // _computeAutoPeriodDays()) - оба явно перечислены в списке
        // допустимых значений отдельно от Object.keys(PERIOD_PRESETS).
        const validPeriodPresets = ['auto', 'custom', ...Object.keys(PERIOD_PRESETS)];
        this.periodPreset = validPeriodPresets.includes(config.periodPreset) ? config.periodPreset : 'auto';
        // Раунд 77 - "Своя" протяжённость в календарных днях (по прямому
        // запросу Mr.D, по умолчанию 60 - ни один из готовых пресетов
        // (30/90/182/365) этому не соответствует). Используется, когда
        // periodPreset === 'custom' - см. totalDays в createGanttArea().
        this.customPeriodDays = Math.max(1, config.customPeriodDays ?? 60);
        this.durationUnit = config.durationUnit === 'hours' ? 'hours' : 'days';
        // Раунд 141 (по решению Mr.D: "переключение типа расчёта не
        // нужно, все расчёты ведутся в рабочих днях, выходные и
        // праздники подаются календарём отдельно") - переключаемый
        // "Расчёт длительности" (calendar/working, this.scheduleMode)
        // УБРАН ЦЕЛИКОМ - раньше он давал ДВЕ РАЗНЫЕ единицы измерения
        // длительности в разных ветках кода (календарные ИЛИ рабочие
        // дни) - именно смешение этих единиц было причиной нескольких
        // найденных багов ("застывшая" длительность при ручном вводе в
        // календарном режиме, см. _applyWorkDaysEdit() в старой
        // редакции). Теперь ЕДИНОЕ правило (см. докстринг ganttMath.js):
        // хранение - ВСЕГДА рабочие дни, календарная ширина - ТОЛЬКО
        // производная для отрисовки, вычисляется spanWorkingDays()
        // внутри calculate(), нигде больше не хранится напрямую.
        // Масштаб линейки (плотность/шаг делений) - отдельно от периода
        // отображения (period определяет ОБЩУЮ ширину шкалы в днях,
        // rulerScale - насколько "растянут" каждый день)
        this.rulerScale = RULER_SCALES[config.rulerScale] ? config.rulerScale : 'days';
        // Вертикальные линии-разделители дат через все строки задач
        this.showGridLines = config.showGridLines ?? false;
        // Раунд 144 (чек-лист "Недельный вид" - "подписи дат на
        // полосах") - особенно полезно в масштабе "Недели"/"Месяцы", где
        // сама полоса слишком узкая, чтобы прочитать длительность по
        // ширине - по умолчанию выключено (тот же принцип, что у
        // остальных опциональных элементов - не захламляет существующие
        // диаграммы без явного запроса).
        this.showBarDateLabels = config.showBarDateLabels ?? false;
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
        // Раунд 88 (чек-лист 1.7.21, п.4) - колонка "Ответственный" в
        // самом теле диаграммы (не только в выходной таблице) - по
        // умолчанию выключена, чтобы не загромождать существующие
        // диаграммы новым столбцом без явного запроса.
        this.showResponsibleColumn = config.showResponsibleColumn ?? false;
        // Раунд 101 (чек-лист, п.2.2) - "Кал. дни" - календарные дни
        // (весь диапазон, включая выходные/праздники - в отличие от
        // "Раб.дн.", которая их исключает). По умолчанию выключена, тот
        // же принцип, что showResponsibleColumn - не захламляет
        // существующие диаграммы новым столбцом без явного запроса.
        this.showCalDaysColumn = config.showCalDaysColumn ?? false;
        // Раунд 187 (по запросу Mr.D: "Ручной ввод дат в Диаграмме
        // Ганта - поля для начала и конца задачи с синхронизацией с
        // графическим редактором") - тот же принцип, что у остальных
        // необязательных столбцов - по умолчанию выключены. Правка
        // "Дата начала" - СДВИГ (та же семантика, что у перетаскивания
        // тела полосы мышью - длительность НЕ меняется, конец сдвигается
        // на ту же дельту). Правка "Дата окончания" - РАСТЯГИВАНИЕ (та
        // же семантика, что у перетаскивания правой ручки - начало НЕ
        // меняется, меняется только длительность).
        this.showStartDateColumn = config.showStartDateColumn ?? false;
        this.showEndDateColumn = config.showEndDateColumn ?? false;
        // Раунд 157 (по запросу Mr.D: "нужны ещё колонки 'сум. раб.
        // дней', 'сум. ч.ч.' - показывают суммарно отработанные дни по
        // всем работам, а не по дате начала и конца в разделе") - ИСТИННАЯ
        // сумма (не диапазон начало-конец, как у "Раб.дн."/"Кал.дни") -
        // отдельная метрика: "Раб.дн." отвечает на вопрос "сколько
        // календарного времени займёт раздел", "Сум.раб.дн." - "сколько
        // РЕАЛЬНОГО труда вложено суммарно во все его задачи" (у задач с
        // параллельным выполнением внутри раздела эти две величины
        // РАЗЛИЧАЮТСЯ). По умолчанию выключены - тот же принцип, что у
        // остальных опциональных колонок.
        this.showSumWorkingDaysColumn = config.showSumWorkingDaysColumn ?? false;
        this.showSumHoursColumn = config.showSumHoursColumn ?? false;
        // Раунд 133 (по запросу Mr.D: "нужно добавить столбик 'Раздел'
        // сразу после № п/п") - показывает имя Блока/раздела задачи
        // прямо на диаграмме (task.blockName, см. buildTaskRow()) - по
        // умолчанию ВКЛЮЧЕНА (в отличие от остальных опциональных
        // столбцов выше) - это активно тестируемая функция прямо
        // сейчас, не давно устоявшаяся - неочевидно было бы прятать её
        // по умолчанию.
        this.showSectionColumn = config.showSectionColumn ?? true;
        // Раунд 88 (чек-лист 1.7.21, п.4) - "Заголовок" уже есть
        // естественно (customName/getDisplayName()) - подзаголовок
        // отдельного поля не имел, добавлен для симметрии с "Обработкой
        // таблиц Ганта" (см. её getOutputBySocket()) - оба выводятся
        // отдельными строковыми выходами, см. getOutputBySocket() ниже.
        this.subtitleText = config.subtitleText || '';
        // Раунд 94 (чек-лист 1.7.21, п.4.1) - ручное растягивание ширины
        // ЛЕВЫХ колонок (не клеток календарной сетки - там растягивание
        // одной клетки лишено смысла, ширина дня задаётся масштабом
        // линейки на всю диаграмму разом, см. обсуждение с Mr.D). null =
        // используется дефолт (константа модуля) - см. _labelW()/
        // _hoursW()/_workdaysW()/_respW() ниже.
        this.numColWidthOverride = config.numColWidthOverride || null;
        this.labelColWidthOverride = config.labelColWidthOverride || null;
        this.hoursColWidthOverride = config.hoursColWidthOverride || null;
        this.workdaysColWidthOverride = config.workdaysColWidthOverride || null;
        // Раунд 187 - ширина новых колонок дат, тот же принцип
        this.startDateColWidthOverride = config.startDateColWidthOverride || null;
        this.endDateColWidthOverride = config.endDateColWidthOverride || null;
        this.responsibleColWidthOverride = config.responsibleColWidthOverride || null;
        this.calDaysColWidthOverride = config.calDaysColWidthOverride || null;
        this.sectionColWidthOverride = config.sectionColWidthOverride || null;
        // Раунд 109 (по запросу Mr.D: "пользовательские цвета для
        // Ответственных... и для групп... готовая палитра материал
        // дизайн и кастомный вариант, как уже обсуждали") - тот же
        // принцип, что роли цветов у "Обработки таблиц Ганта" (Раунд
        // 97) - сопоставление ИМЯ (ответственного/группы) -> HEX-цвет,
        // НИЧЕГО не назначается автоматически - только сам факт "это
        // имя встречается в данных" определяется автоматически (см.
        // calculate()), роль/цвет - всегда явный выбор в панели.
        this.responsibleColors = config.responsibleColors ? { ...config.responsibleColors } : {};
        this.groupColors = config.groupColors ? { ...config.groupColors } : {};
        this._detectedResponsibles = [];
        this._detectedGroups = [];
        // Раунд 115 (чек-лист 1.7.21, раздел 4 - механика добавления/
        // удаления строк) - задачи из ИСТОЧНИКА (список/таблица/группы)
        // остаются производными от calculate(), как и раньше - ручное
        // добавление/удаление накладывается ПОВЕРХ них отдельным слоем
        // (тот же принцип, что this.taskDurationOverrides/taskDates -
        // "переопределения", не замена самого источника):
        //   - manualTasks - задачи, добавленные ВРУЧНУЮ прямо на
        //     диаграмме (не пришли ни из какого источника) - переживают
        //     пересчёт, потому что это НЕЗАВИСИМОЕ состояние самой
        //     ноды, не производное.
        //   - deletedTaskKeys - имена задач ИЗ ИСТОЧНИКА, которые
        //     пользователь удалил вручную - "мягкое" удаление (сам
        //     источник ничего не теряет, просто эта конкретная задача
        //     скрывается из ЭТОЙ диаграммы) - если источник когда-нибудь
        //     перестанет её присылать, запись просто больше ни на что
        //     не влияет (безопасно оставлять "мусор" в списке).
        this.manualTasks = Array.isArray(config.manualTasks) ? config.manualTasks.map(t => ({ ...t })) : [];
        // Раунд 146 (по запросу Mr.D: "добавим инструмент add_sub чтобы
        // можно было любую строку превратить в раздел или подраздел") -
        // множество taskKey строк, превращённых в раздел - строка при
        // этом ПЕРЕСТАЁТ быть задачей (не несёт даты/длительность),
        // становится заголовком группы для ВСЕХ СЛЕДУЮЩИХ задач до
        // следующего раздела - см. _applyPromotedSections().
        this.promotedSectionKeys = new Set(Array.isArray(config.promotedSectionKeys) ? config.promotedSectionKeys : []);
        // Раунд 150 (по запросу Mr.D: "у нас ещё была возможность
        // создавать подразделы") - taskKey -> 1 ("Раздел", верхний
        // уровень) | 'sub' ("Подраздел", СТЕКОВАЯ семантика - на один
        // глубже ближайшего открытого раздела, см. _applyPromotedSections()).
        // Сериализуется как массив пар [key, level] (Map несериализуем
        // напрямую в JSON).
        this.sectionLevels = new Map(Array.isArray(config.sectionLevels) ? config.sectionLevels : []);
        // Раунд 147 - см. докстринг _applyPromotedSections() - пересобирается
        // при каждом calculate(), инициализация здесь просто на случай
        // обращения ДО первого пересчёта.
        this.promotedNameToKey = new Map();
        // Раунд 116 (уточнение Mr.D по механике строк): "фокус по клику
        // фиксируется" - в отличие от подсветки при наведении (Раунд
        // 115, остаётся отдельно), клик по номеру строки/новой колонке
        // делает её "текущей" ДО следующего клика (не сбрасывается сама
        // по себе) - показывает +/- в отдельной колонке ПЕРЕД "№ п/п" и
        // делает "Вид работ" редактируемым прямо на месте. Транзитное
        // состояние UI - НЕ сериализуется (сбрасывается при каждой новой
        // сессии, как this._detectedResponsibles и подобные).
        this._focusedTaskKey = null;
        // Раунд 174 (по запросу Mr.D: "мультивыделение для одновременного
        // редактирования. С зажатым Ctrl можно выделить несколько строк,
        // и если изменить свойство в одной, это свойство распространится
        // на остальные") - набор ключей строк, добавленных через
        // Shift+клик (Раунд 175 - Ctrl оказался уже занят горячей
        // клавишей "Обрезать связи") - ОТДЕЛЬНО от _focusedTaskKey (та
        // по-прежнему решает, какая ИМЕННО строка сейчас показывает
        // редактируемые поля - "активная для ввода" строка мультивыбора).
        // Не сохраняется в .ncp (сессионное UI-состояние, как и
        // _focusedTaskKey).
        this.multiSelectedKeys = new Set();
        // Раунд 180 (по запросу Mr.D: "у строки была заготовлена ручка,
        // надо её задействовать, чтобы строку можно было перетащить
        // схватившись за ручку") - {[taskKey]: afterKey | '__start__'} -
        // ЕДИНЫЙ override порядка, работающий одинаково И для вручную
        // добавленных задач (у тех УЖЕ есть свой insertAfterKey, см.
        // manualTasks), И для задач ИЗ ИСТОЧНИКА (у тех порядок иначе
        // взять неоткуда - только естественный порядок строк таблицы) -
        // применяется В КОНЦЕ _applyManualRowEdits(), ПОСЛЕ того как
        // все задачи (источник + вручную добавленные) уже собраны в
        // this.tasks, но ДО группировки по разделам (см.
        // _applyTaskOrderOverrides() дальше по файлу).
        this.taskOrderOverrides = config.taskOrderOverrides ? { ...config.taskOrderOverrides } : {};
        // Переименование задачи ПРЯМО на диаграмме - тот же принцип, что
        // taskDurationOverrides/taskDates (переопределение поверх
        // значения из источника, по taskKey - стабильному идентификатору,
        // не меняющемуся при самом переименовании).
        this.taskNameOverrides = config.taskNameOverrides ? { ...config.taskNameOverrides } : {};
        // Раунд 136 (по запросу Mr.D: "ручное редактирование нужно
        // сохранить" - для колонки "Раздел", особенно для корневых
        // строк-разделов, у которых почти всегда нет своего № п/п) -
        // тот же принцип, что taskNameOverrides/taskResponsible - по
        // taskKey, поверх значения из источника (sectionNumber).
        this.taskSectionOverrides = config.taskSectionOverrides ? { ...config.taskSectionOverrides } : {};
        // Раунд 137 (чек-лист "Диаграмма Ганта - связи между задачами",
        // следующий пункт после иерархии) - связи (зависимости) между
        // задачами, "Finish-to-Start" (конец одной задачи -> начало
        // другой) - самый распространённый и однозначный тип связи в
        // Гант-диаграммах, единственный, что просит чек-лист (без
        // разделения на Start-to-Start/Finish-to-Finish и т.п. - не
        // усложняем сверх запрошенного). Массив {from, to} - taskKey
        // обеих задач. Хранится НЕЗАВИСИМО от построения дерева/задач
        // из источника - переживает пересчёт (тот же принцип, что
        // manualTasks/taskDurationOverrides и другие "надстройки поверх
        // источника").
        this.dependencies = Array.isArray(config.dependencies)
            ? config.dependencies.filter(d => d && d.from && d.to).map(d => ({ from: d.from, to: d.to }))
            : [];
        this.deletedTaskKeys = Array.isArray(config.deletedTaskKeys) ? [...config.deletedTaskKeys] : [];
        // Раунд 126 (релиз 1.8.0, механика Досок) - см. utils/boardPublish.js.
        initBoardPublishFields(this, config);

        this.tasks = [];               // вычисленные задачи для рендера (плоский список, groupIndex/taskKey у каждой при группировке)
        // Раунд 78 - null, если подключён ровно один источник (обычное
        // поведение, как раньше) | массив {name, tasks} при 2+ источниках -
        // см. calculate()/createGanttArea(). Раунд 79 - заливка всей
        // строки цветом группы убрана (по замечанию Mr.D "не то, что я
        // имел в виду") - см. buildGroupHeaderRow().
        this.taskGroups = null;
        // Раунд 130 (иерархия Ганта, чек-лист) - null, если иерархия
        // (маркеры #/## в названиях задач, см. tasksFromTable()) не
        // обнаружена - иначе массив {name, stages, directTasks}, см.
        // _buildHierarchyTree()/createGanttArea().
        // Раунд 79 - какие группы свёрнуты (скрыты их строки задач) -
        // ключ: groupIndex (строкой, т.к. ключи объектов в JS всегда
        // строки). Чисто визуальное состояние - не влияет на расчёт/
        // расстановку задач внутри свёрнутой группы, только на рендер.
        this.collapsedGroups = config.collapsedGroups && typeof config.collapsedGroups === 'object'
            ? { ...config.collapsedGroups }
            : {};
        // Раунд 130 - независимое состояние сворачивания для Блоков
        // (ключ - имя блока, не индекс - индекс мог бы "прыгать" между
        // пересчётами, если порядок блоков в источнике изменился, имя -
        // стабильный идентификатор) и Стадий (ключ - "имяБлока␟имяСтадии",
        // составной - одно и то же имя Стадии могло встретиться в
        // РАЗНЫХ Блоках, должны сворачиваться независимо).
        this.collapsedBlocks = config.collapsedBlocks && typeof config.collapsedBlocks === 'object'
            ? { ...config.collapsedBlocks }
            : {};
        this.collapsedStages = config.collapsedStages && typeof config.collapsedStages === 'object'
            ? { ...config.collapsedStages }
            : {};
        this.tableData = new TableData();
        // Багфикс (Раунд 86) - раньше не инициализировались вовсе
        // (оставались undefined) - любой потребитель, читающий
        // output.listData.items через getSourceOutput()/getOutputBySocket()
        // (см. baseNode.js), упал бы с TypeError вместо получения пустого
        // списка. GanttNode сам их не заполняет (нет естественного listData-
        // представления для расписания задач), но ДОЛЖНЫ хотя бы
        // существовать как пустые объекты - тот же контракт, что у всех
        // остальных нод проекта.
        this.listData = new ListData();
        this.resultListData = new ListData();
        this.sourceMode = 'list';      // 'list' | 'table' - откуда взялись данные в последнем calculate()
        this._sourceName = null;
        // Высота видимой области строк, если пользователь тянул общую
        // ручку ноды по вертикали (см. beginFreeResize/applyFreeResize) -
        // null = высота подбирается автоматически по числу задач
        this.wrapHeight = config.wrapHeight ?? null;
        // Раунд 166 (по жалобе Mr.D: "получились связаны высота
        // виджета и высота узла, нужно разделить, чтобы виджет
        // диаграммы можно было подстраивать вручную под нужную высоту") -
        // отдельное поле высоты ДЛЯ ВИДЖЕТА на Доске, независимое от
        // this.wrapHeight холстовой ноды - та же семантика (null =
        // автоматически по числу задач), но НЕ разделяемая с ней.
        this.widgetWrapHeight = config.widgetWrapHeight ?? null;
        // Раунд 73 - набор дат-праздников из подключённого сокета 1 (см.
        // calculate()) - Set<string> ISO-дат, пустой до первого пересчёта
        this.holidaySet = new Set();
        this._holidaySourceName = null;
    }

    // Раунд 190 (по запросу Mr.D: "разворачивание нод на весь экран -
    // начинаем с Диаграммы Ганта") - первый тип ноды, получивший эту
    // возможность - остальная механика (BaseNode.createTitle()/
    // window.expandNodeFullscreen()) уже была общей, здесь только
    // "включаем" кнопку для этого конкретного типа.
    supportsFullscreen() {
        return true;
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

        // Раунд 88 (чек-лист 1.7.21, п.4) - Заголовок/Подзаголовок,
        // отдельными строковыми выходами (isString, синий кружок) - тот
        // же приём, что уже опробован в GanttTableProcessorNode
        // (getOutputBySocket(), см. baseNode.js/nodeManager.js). Раунд 95
        // (чек-лист, п.2.1) - в ТОМ ЖЕ ряду добавлен входной сокет
        // (INPUT, слева) - приоритет сокет -> метаданные -> ручной ввод
        // в инспекторе (см. calculate()/_resolvedTitle/_resolvedSubtitle).
        const titleSubtitleDefs = [
            { index: 1, label: 'Заголовок', inSocketIndex: TITLE_INPUT_SOCKET_INDEX, get: () => this._resolvedTitle ?? (this.customName || this.getDisplayName()) },
            { index: 2, label: 'Подзаголовок', inSocketIndex: SUBTITLE_INPUT_SOCKET_INDEX, get: () => this._resolvedSubtitle ?? this.subtitleText }
        ];
        titleSubtitleDefs.forEach(d => {
            const row = document.createElement('div');
            row.style.cssText = 'display:flex; align-items:center; gap:8px; padding-top:2px;';
            const inSocket = SocketFactory.createSocket({
                nodeId: this.id, socketType: 'input', index: d.inSocketIndex, isString: true,
                title: `${d.label} (необязательно) - если подключено, в приоритете над метаданными источника задач и ручным вводом в инспекторе`
            });
            row.appendChild(inSocket);
            const label = document.createElement('label');
            label.textContent = `${d.label}:`;
            label.style.cssText = 'color:var(--md-text-secondary); font-size:10px; flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;';
            row.appendChild(label);
            const hint = document.createElement('span');
            hint.className = `gantt-titlesub-hint-${d.index}`;
            hint.style.cssText = 'color:var(--md-text-disabled); font-size:9px; max-width:70px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;';
            hint.textContent = d.get() || '—';
            row.appendChild(hint);
            const socket = SocketFactory.createSocket({
                nodeId: this.id, socketType: 'output', index: d.index, isString: true,
                title: d.label
            });
            row.appendChild(socket);
            content.appendChild(row);
        });

        return content;
    }

    // Раунд 88 - см. подробности в докстринге BaseNode.getOutputBySocket()
    // и GanttTableProcessorNode (первая нода, где это реально
    // использовано) - 0 остаётся Data (план, как и было всегда), 1/2 -
    // честные строковые выходы. Раунд 95 - значения теперь берутся из
    // this._resolvedTitle/this._resolvedSubtitle (посчитаны в calculate()
    // с приоритетом сокет -> метаданные -> ручной ввод, см. её докстринг),
    // а не напрямую из customName/subtitleText.
    getOutputBySocket(index) {
        if (index === 1) {
            const title = this._resolvedTitle ?? (this.customName || this.getDisplayName());
            return { value: title, tableData: new TableData([{ header: 'Заголовок', format: 'text', values: [title] }]), listData: new ListData(), resultListData: null };
        }
        if (index === 2) {
            const subtitle = this._resolvedSubtitle ?? this.subtitleText;
            return { value: subtitle, tableData: new TableData([{ header: 'Подзаголовок', format: 'text', values: [subtitle] }]), listData: new ListData(), resultListData: null };
        }
        return { value: this.value, tableData: this.tableData, treeData: this.treeData, listData: this.listData, resultListData: this.resultListData };
    }

    // === Диаграмма: линейка дат + строки задач с перетаскиваемыми полосами ===

    // Раунд 166 (по жалобе Mr.D: "связаны высота виджета и высота узла,
    // нужно разделить") - isWidget переключает, ИЗ КАКОГО поля брать
    // высоту тела (this.widgetWrapHeight для Доски, this.wrapHeight для
    // холстовой ноды - см. ниже) и добавляет СОБСТВЕННУЮ ручку
    // растягивания для контекста Доски (у холстовой ноды растягивание
    // идёт через общий механизм nodeManager.js, см.
    // beginFreeResize()/applyFreeResize() - виджет Доски с ним не
    // связан, у него своя, отдельная).
    createGanttArea(isWidget = false) {
        const totalDays = this.periodPreset === 'custom'
            ? this.customPeriodDays
            : this.periodPreset === 'auto'
                ? this._computeAutoPeriodDays()
                : (PERIOD_PRESETS[this.periodPreset]?.days || 30);
        const dayWidth = RULER_SCALES[this.rulerScale]?.dayWidth || RULER_SCALES.days.dayWidth;
        const timelineWidth = totalDays * dayWidth;
        const anchor = parseISODate(this.startDate) || new Date();

        // Столбец номеров строк - фиксированной ширины под самое крупное
        // число (как в Excel, тот же приём, что в tableViewerNode.js).
        // leftWidth - суммарный отступ ДО начала временной шкалы (номер +
        // имя задачи) - используется везде, где раньше стоял голый LABEL_WIDTH.
        const numColWidth = this.numColWidthOverride || Math.max(20, String(Math.max(this.tasks.length, 1)).length * 7 + 12);
        const leftWidth = FOCUS_COL_WIDTH + numColWidth + (this.showSectionColumn ? this._sectionW() : 0) + this._labelW()
            + (this.showDurationColumn ? this._hoursW() : 0)
            + (this.showWorkingDaysColumn ? this._workdaysW() : 0)
            + (this.showResponsibleColumn ? this._respW() : 0)
            + (this.showCalDaysColumn ? this._calDaysW() : 0)
            + (this.showSumWorkingDaysColumn ? this._sumWorkdaysW() : 0)
            + (this.showSumHoursColumn ? this._sumHoursW() : 0);

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
        // масштабе "Дни", в масштабе "Месяцы" - год+месяц (Раунд 100,
        // те же календарно-осознанные группировки, что уже есть для
        // масштаба "Дни" - buildGroupedRow()), иначе - обычная линейка
        // с делениями через равные интервалы.
        if (this.rulerScale === 'days') {
            inner.appendChild(this.buildDaysHeader(leftWidth, totalDays, timelineWidth, dayWidth, anchor));
        } else if (this.rulerScale === 'months') {
            inner.appendChild(this.buildGroupedRow(
                leftWidth, totalDays, timelineWidth, dayWidth, anchor,
                (date) => date.getFullYear(),
                (date) => String(date.getFullYear())
            ));
            inner.appendChild(this.buildGroupedRow(
                leftWidth, totalDays, timelineWidth, dayWidth, anchor,
                (date) => date.getFullYear() * 12 + date.getMonth(),
                (date) => MONTH_LABELS[date.getMonth()]
            ));
        } else if (this.rulerScale === 'weeks') {
            // Раунд 144 (чек-лист "Недельный вид" - Год/Месяц/Неделя в
            // шапке) - та же buildGroupedRow(), что уже строит Год/Месяц
            // для масштабов "Дни"/"Месяцы" (Раунд 100) - переиспользована
            // без изменений, только третья строка добавляет номер недели
            // (см. _weekOfYear() ниже - простая нумерация "неделя N с
            // начала года", не строгий ISO-8601 - для визуальной шапки
            // разница не принципиальна, а простая формула надёжнее
            // граничных случаев ISO-недель на стыке лет).
            inner.appendChild(this.buildGroupedRow(
                leftWidth, totalDays, timelineWidth, dayWidth, anchor,
                (date) => date.getFullYear(),
                (date) => String(date.getFullYear())
            ));
            inner.appendChild(this.buildGroupedRow(
                leftWidth, totalDays, timelineWidth, dayWidth, anchor,
                (date) => date.getFullYear() * 12 + date.getMonth(),
                (date) => MONTH_LABELS[date.getMonth()]
            ));
            inner.appendChild(this.buildGroupedRow(
                leftWidth, totalDays, timelineWidth, dayWidth, anchor,
                (date) => date.getFullYear() * 100 + this._weekOfYear(date),
                (date) => `Нед ${this._weekOfYear(date)}`
            ));
        } else {
            inner.appendChild(this.buildRuler(leftWidth, totalDays, timelineWidth, dayWidth, anchor));
        }

        // Раунд 94 - постоянная строка заголовков левых колонок (№ п/п/
        // Вид работ/ч.ч./Раб.дн./Ответственный), с ручками растягивания -
        // последняя ФИКСИРОВАННАЯ (не прокручивающаяся) строка перед
        // телом.
        inner.appendChild(this.buildColumnLabelsRow(numColWidth, timelineWidth));

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
        // Багфикс (Раунд 101, по жалобе Mr.D: "закрепляется только шапка,
        // содержимое строк - нет") - overflow-x: hidden ЯВНО задаёт
        // ненулевое значение overflow-x, а по спецификации CSS ЛЮБОЕ
        // такое значение (не 'visible') превращает элемент в "скролл-
        // контейнер" для целей position:sticky - все sticky-потомки
        // внутри rowsWrap (см. buildTaskRow()/buildGroupHeaderRow()/
        // buildTotalRow()) начинали искать ближайшего скроллящегося
        // предка и находили САМ rowsWrap (который сам никогда не
        // скроллится горизонтально - вся реальная горизонтальная
        // прокрутка происходит на уровень выше, у .gantt-outer-scroll) -
        // sticky "прилипал" к неподвижной точке внутри rowsWrap, что
        // визуально выглядело как "не прилипает вообще" при скролле
        // внешнего контейнера. overflow-x: clip - НЕ создаёт скролл-
        // контейнер (обрезает содержимое, но не участвует в резолюции
        // sticky-якоря), решает и исходную проблему двойного скролла
        // (см. комментарий выше), и не ломает sticky.
        rowsWrap.style.cssText = 'overflow-y: auto; overflow-x: clip; scrollbar-gutter: stable;';

        // Раунд 152 (по жалобе Mr.D: "создана только 1 задача, превращаю
        // в раздел - раздел не отрисован, хотя уже существует в
        // иерархии") - "Нет задач" показывался ЧИСТО по this.tasks.length,
        // не учитывая this.taskGroups - если ВСЕ задачи превращены в
        // разделы (this.tasks становится пуст), но сами разделы (пусть
        // даже пустые) есть в this.taskGroups, диаграмма ошибочно
        // считалась "пустой" целиком и уходила в ветку "Нет задач",
        // полностью пропуская отрисовку групп.
        const hasNothingToRender = this.tasks.length === 0 && (!Array.isArray(this.taskGroups) || this.taskGroups.length === 0);
        if (hasNothingToRender) {
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

            // Раунд 158 (по запросу Mr.D: "лишние старые обработчики
            // удалить, чтобы не мешались") - отдельная ветка рендера
            // this.hierarchyBlocks (Блок->Стадия, Раунд 130) убрана
            // целиком - Блок/Стадия теперь строятся СРАЗУ в формате
            // this.taskGroups (с subgroups, см. _groupsFromTreeData()/
            // _groupsFromNameMarkers()) и рендерятся ТЕМ ЖЕ рекурсивным
            // путём, что и произвольная вложенность Раздел/Подраздел
            // (Раунд 150) - единая система вместо двух параллельных.
            if (this.taskGroups) {
                // Раунд 150 (по запросу Mr.D: "у нас ещё была возможность
                // создавать подразделы... произвольная вложенность") -
                // рекурсивный обход - каждая группа может нести
                // group.subgroups (массив вложенных разделов, см.
                // _applyPromotedSections()) - индент растёт НА КАЖДЫЙ
                // уровень вложенности (тот же приём, что уже применён к
                // иерархии Блок/Стадия чуть выше, HIERARCHY_INDENT_PX).
                // collapsedGroups индексируется по originKey (стабильный
                // ключ раздела), НЕ по позиционному индексу - позиция
                // вложенной группы в общем порядке отрисовки "плавает"
                // при сворачивании/разворачивании СОСЕДНИХ разделов,
                // числовой индекс путал бы состояние сворачивания между
                // РАЗНЫМИ разделами.
                const GROUP_INDENT_PX = 16;
                let taskNumber = 1; // сквозная нумерация ЗАДАЧ через ВСЮ вложенность
                let groupIndex = 0;

                const renderGroupRecursive = (group, indentPx) => {
                    const myIndex = groupIndex++;
                    // Раунд 151 (по жалобе Mr.D: "строки с одинаковым
                    // именем иногда вызывают непредвиденное поведение") -
                    // originKey теперь хранится НАПРЯМУЮ на самой группе
                    // (group.originKey, см. _applyPromotedSections()), а
                    // не ищется через promotedNameToKey.get(group.name) -
                    // тот поиск по ИМЕНИ ломался при совпадении имён двух
                    // разных разделов (Map перезаписывала запись).
                    const originKey = group.originKey;
                    // Раунд 158 - group.collapseKey (Блок/Стадия, Раунд
                    // 130 - стабильный ключ вида "block:Имя"/"stage:Блок\x1fСтадия",
                    // см. _groupsFromTreeData()/_groupsFromNameMarkers())
                    // в приоритете над originKey (тот - ТОЛЬКО у
                    // promoted-разделов) - и над позиционным myIndex
                    // (тот "плавает" при сворачивании соседей).
                    const collapseKey = group.collapseKey || originKey || myIndex;
                    const collapsed = !!this.collapsedGroups[collapseKey];
                    // Раунд 151 (багфикс: "не работает кнопка
                    // сворачивания подразделов") - hierarchyOpts ОБЯЗАН
                    // нести setCollapsed(), если он вообще передан (см.
                    // buildGroupHeaderRow() - toggle-обработчик вызывает
                    // hierarchyOpts.setCollapsed(), только если
                    // hierarchyOpts truthy) - раньше здесь передавался
                    // ГОЛЫЙ {indentPx} без setCollapsed - клик по
                    // стрелке вложенного раздела падал с ошибкой
                    // (setCollapsed не функция), молча "не работая".
                    const hierarchyOpts = indentPx ? {
                        indentPx,
                        setCollapsed: (val) => { this.collapsedGroups[collapseKey] = val; }
                    } : null;
                    rowsInner.appendChild(this.buildGroupHeaderRow(
                        group, collapseKey, numColWidth, timelineWidth, dayWidth, collapsed, anchor,
                        hierarchyOpts
                    ));
                    if (!collapsed) {
                        group.tasks.forEach(task => {
                            rowsInner.appendChild(this.buildTaskRow(task, numColWidth, timelineWidth, dayWidth, taskNumber, null, anchor, indentPx));
                            taskNumber++;
                        });
                        (group.subgroups || []).forEach(sub => renderGroupRecursive(sub, indentPx + GROUP_INDENT_PX));
                    } else {
                        // Свёрнута - задачи (и вложенные подразделы) по-
                        // прежнему расписаны и есть в this.tasks/выходной
                        // таблице, просто не рисуются - сквозную
                        // нумерацию всё равно продолжаем, чтобы номера
                        // видимых задач не "прыгали" при разворачивании.
                        const countRecursive = (g) => g.tasks.length + (g.subgroups || []).reduce((sum, sg) => sum + countRecursive(sg), 0);
                        taskNumber += countRecursive(group);
                    }
                };

                this.taskGroups.forEach(group => renderGroupRecursive(group, 0));
            } else {
                this.tasks.forEach((task, i) => {
                    rowsInner.appendChild(this.buildTaskRow(task, numColWidth, timelineWidth, dayWidth, i + 1, null, anchor));
                });
            }

            // Раунд 137 (связи между задачами) - строится ПОСЛЕДНИМ,
            // когда ВСЕ строки (любой из веток выше - иерархия/группы/
            // плоский список) уже реально в rowsInner - позиции строк
            // читаются из уже готового DOM (см. buildDependencyLines()).
            const depSvg = this.buildDependencyLines(leftWidth, dayWidth, rowsInner);
            if (depSvg) rowsInner.appendChild(depSvg);

            rowsWrap.appendChild(rowsInner);
        }

        // Высота ТОЛЬКО тела - шапка и ручка дедлайна физически вне этой
        // области. Раунд 166 - какое ИМЕННО поле читать, зависит от
        // контекста (isWidget) - холстовая нода и виджет Доски больше
        // НЕ делят одно и то же состояние (см. докстринг widgetWrapHeight
        // в конструкторе).
        const effectiveWrapHeight = isWidget ? this.widgetWrapHeight : this.wrapHeight;
        if (effectiveWrapHeight) {
            rowsWrap.style.maxHeight = 'none';
            rowsWrap.style.height = effectiveWrapHeight + 'px';
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

        // Раунд 166 (по жалобе Mr.D: "нужно разделить, чтобы виджет
        // диаграммы можно было подстраивать вручную под нужную высоту") -
        // собственная ручка растягивания ТОЛЬКО для контекста Доски - у
        // холстовой ноды растягивание идёт через ОБЩИЙ механизм
        // nodeManager.js (ручка в углу самой ноды, см.
        // beginFreeResize()/applyFreeResize() ниже) - виджет на Доске с
        // этим механизмом не связан (там своя, отдельная система
        // resize по колонкам/строкам сетки, boardManager.js), поэтому
        // растягивание ВНУТРЕННЕЙ области строк требует своей ручки.
        if (isWidget) {
            const widgetResizeHandle = document.createElement('div');
            widgetResizeHandle.className = 'gantt-widget-resize-handle';
            widgetResizeHandle.title = 'Потяните, чтобы изменить высоту диаграммы';
            widgetResizeHandle.addEventListener('mousedown', (e) => {
                e.stopPropagation();
                e.preventDefault();
                const startY = e.clientY;
                const startHeight = rowsWrap.offsetHeight;
                const onMove = (moveEvt) => {
                    const newHeight = Math.max(ROW_HEIGHT, startHeight + (moveEvt.clientY - startY));
                    rowsWrap.style.maxHeight = 'none';
                    rowsWrap.style.height = newHeight + 'px';
                    this.widgetWrapHeight = newHeight;
                };
                const onUp = () => {
                    document.removeEventListener('mousemove', onMove);
                    document.removeEventListener('mouseup', onUp);
                    if (window.nodeManager) window.nodeManager.calculateAll();
                };
                document.addEventListener('mousemove', onMove);
                document.addEventListener('mouseup', onUp);
            });
            outer.appendChild(widgetResizeHandle);
        }

        // Багфикс (Раунд 104, по жалобе Mr.D: "столбцы так и не
        // фиксируются") - CSS position:sticky НЕ может работать для
        // элементов внутри rowsWrap: тот сам ОБЯЗАН иметь non-visible
        // overflow-y (нужен для вертикального скролла) - а по
        // спецификации CSS ЛЮБОЕ non-visible значение overflow (auto/
        // hidden/clip - без разницы) формально делает элемент "скролл-
        // контейнером" для целей резолюции position:sticky, даже если
        // он сам никогда не двигается по ГОРИЗОНТАЛИ и никакого
        // реального overflow там нет. sticky-потомки rowsWrap находят
        // ЕГО как ближайшего "скроллящегося" предка вместо настоящего
        // (outer, где и происходит горизонтальная прокрутка) - отсюда
        // "не фиксируется". Единственный надёжный выход - без CSS
        // sticky вообще для этих элементов, вместо этого JS слушает
        // scroll именно у outer и двигает их transform:translateX()
        // вручную. Строка заголовков колонок (Раунд 94, СНАРУЖИ
        // rowsWrap, между ней и outer нет non-visible overflow) - её
        // CSS sticky работает верно и без этого, трогать не нужно.
        outer.addEventListener('scroll', () => {
            const offset = outer.scrollLeft;
            inner.querySelectorAll('.gantt-left-sticky-js').forEach(el => {
                el.style.transform = `translateX(${offset}px)`;
            });
        });

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

    // Раунд 144 (чек-лист "Недельный вид") - простая нумерация "неделя N
    // с начала года" (1 января - всегда начало недели 1, дальше каждые
    // 7 дней - следующая неделя) - НЕ строгий ISO-8601 (тот считает
    // недели с понедельника и особым образом обрабатывает недели на
    // стыке лет) - для визуальной шапки диаграммы разница не
    // принципиальна, а простая формула не имеет граничных случаев.
    _weekOfYear(date) {
        const startOfYear = new Date(date.getFullYear(), 0, 1);
        return Math.floor(daysBetween(startOfYear, date) / 7) + 1;
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
            // Раунд 92 (чек-лист, п.2.2) - календарь (this.holidaySet) -
            // ЕДИНСТВЕННЫЙ источник истины насчёт того, нерабочий ли день.
            // День недели (сб/вс) сам по себе больше НИЧЕГО не красит -
            // используется только как косметическая подсказка ЦВЕТА среди
            // уже подтверждённых календарём дат (см. isWeekend() докстринг
            // выше): "похоже на обычный выходной" (красный) отличаем от
            // "будний день, отмеченный отдельно" (янтарный).
            const nonWorking = isNonWorkingDay(date, this.holidaySet);
            const looksLikeWeekend = nonWorking && isWeekend(date);
            const looksLikeHoliday = nonWorking && !looksLikeWeekend;
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
                color: ${looksLikeWeekend ? 'var(--md-error, #ef5350)' : (looksLikeHoliday ? 'var(--md-warning, #ffb74d)' : 'var(--md-text-secondary)')};
                font-weight: ${nonWorking ? '600' : '400'};
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
            // Раунд 92 (чек-лист, п.2.2) - та же логика, что в
            // buildWeekdayRow() выше: календарь решает, рисовать ли
            // подложку ВООБЩЕ; день недели - только подсказка цвета.
            const nonWorking = isNonWorkingDay(date, this.holidaySet);
            const looksLikeWeekend = nonWorking && isWeekend(date);
            if (nonWorking) {
                const seg = document.createElement('div');
                seg.style.cssText = `
                    position: absolute;
                    left: ${d * dayWidth}px;
                    top: 0; bottom: 0;
                    width: ${dayWidth}px;
                    background: ${looksLikeWeekend ? 'var(--gantt-weekend-tint, rgba(239, 83, 80, 0.06))' : 'var(--gantt-holiday-tint, rgba(255, 183, 77, 0.08))'};
                `;
                overlay.appendChild(seg);
            }
        }
        return overlay;
    }

    // Вертикальные линии-разделители дат через все строки задач сразу -
    // тот же шаг, что и у делений линейки (buildRuler), чтобы совпадали.
    // Раунд 137 (чек-лист "Связи между задачами") - SVG-слой поверх УЖЕ
    // отрисованных строк (rowsInner передан ГОТОВЫМ - позиции читаются
    // из реального DOM, не пересчитываются вручную - строка-заголовок
    // Блока/Стадии тоже занимает место в вертикальном стеке, дублировать
    // эту бухгалтерию было бы избыточно и хрупко). "Создание сплайн-
    // линии между связанными задачами" - кубическая кривая Безье
    // (классический вид Гант-стрелки - плавный S-изгиб, не прямая
    // линия). "Цвет линии соответствует цвету диаграммы" -
    // this.color (акцентный цвет самой ноды, BaseNode) - тот же цвет,
    // что пользователь уже видит в заголовке ноды на графе.
    buildDependencyLines(leftWidth, dayWidth, rowsInner) {
        if (!this.dependencies || this.dependencies.length === 0) return null;

        // Индекс строки каждой задачи - по порядку появления в уже
        // построенном DOM (rowsInner.children), не все children несут
        // taskKey (строки-заголовки Блока/Стадии/"Итого" - нет) - это
        // ОЖИДАЕМО, просто занимают место в стеке, как и должны.
        const rowIndexByKey = new Map();
        [...rowsInner.children].forEach((child, idx) => {
            if (child.dataset && child.dataset.taskKey) rowIndexByKey.set(child.dataset.taskKey, idx);
        });

        const totalHeight = rowsInner.children.length * ROW_HEIGHT;
        const lineColor = this.color || 'var(--md-primary)';

        const svgNS = 'http://www.w3.org/2000/svg';
        const svg = document.createElementNS(svgNS, 'svg');
        svg.setAttribute('class', 'gantt-dependency-lines');
        svg.style.cssText = `position:absolute; left:${leftWidth}px; top:0; width:${rowsInner.offsetWidth || 2000}px; height:${totalHeight}px; pointer-events:none; overflow:visible; z-index:3;`;

        // Стрелка на конце линии - тот же цвет, что сама линия (marker
        // не наследует currentColor автоматически для fill - красим явно).
        const defs = document.createElementNS(svgNS, 'defs');
        const marker = document.createElementNS(svgNS, 'marker');
        const markerId = `gantt-dep-arrow-${this.id}`;
        marker.setAttribute('id', markerId);
        marker.setAttribute('viewBox', '0 0 8 8');
        marker.setAttribute('refX', '7');
        marker.setAttribute('refY', '4');
        // Раунд 139 (по жалобе Mr.D: "стрелочку надо сделать поменьше,
        // очень крупная") - markerUnits="userSpaceOnUse" (по умолчанию
        // 'strokeWidth' - размер маркера МАСШТАБИРУЕТСЯ толщиной самой
        // линии, отсюда неожиданно большой итоговый размер) - даёт
        // предсказуемый АБСОЛЮТНЫЙ размер в пикселях, не зависящий от
        // stroke-width. Сами markerWidth/Height тоже уменьшены (было 6).
        marker.setAttribute('markerUnits', 'userSpaceOnUse');
        marker.setAttribute('markerWidth', '4');
        marker.setAttribute('markerHeight', '4');
        marker.setAttribute('orient', 'auto-start-reverse');
        const arrowPath = document.createElementNS(svgNS, 'path');
        arrowPath.setAttribute('d', 'M0,0 L8,4 L0,8 Z');
        arrowPath.setAttribute('fill', lineColor);
        marker.appendChild(arrowPath);
        defs.appendChild(marker);
        svg.appendChild(defs);

        let drawnAny = false;
        this.dependencies.forEach(dep => {
            const fromIdx = rowIndexByKey.get(dep.from);
            const toIdx = rowIndexByKey.get(dep.to);
            // Раунд 138 (связи между разделами) - _resolveEndpointTask()
            // разворачивает И обычный taskKey, И "group:Имя" в единый
            // вид {startOffsetDays, durationDays} - откуда рисовать
            // линию раздела, ровно тем же способом, что и для одной
            // задачи (от края агрегированного диапазона).
            const fromTask = this._resolveEndpointTask(dep.from);
            const toTask = this._resolveEndpointTask(dep.to);
            // Задача могла исчезнуть из источника (переименована/
            // удалена) - связь на нЕё просто не рисуется, но НЕ
            // удаляется сама - вдруг задача вернётся при следующем
            // пересчёте (тот же принцип терпимости, что у остальных
            // override-словарей).
            if (fromIdx === undefined || toIdx === undefined || !fromTask || !toTask) return;

            const x1 = (fromTask.startOffsetDays + fromTask.durationDays) * dayWidth;
            const y1 = fromIdx * ROW_HEIGHT + ROW_HEIGHT / 2;
            const x2 = toTask.startOffsetDays * dayWidth;
            const y2 = toIdx * ROW_HEIGHT + ROW_HEIGHT / 2;
            // Контрольные точки кривой - горизонтальный "вылет" от каждого
            // конца, глубина зависит от расстояния (короткие связи -
            // более плавный, компактный изгиб).
            const bend = Math.max(16, Math.min(40, Math.abs(x2 - x1) / 3));

            const path = document.createElementNS(svgNS, 'path');
            path.setAttribute('d', `M ${x1},${y1} C ${x1 + bend},${y1} ${x2 - bend},${y2} ${x2},${y2}`);
            path.setAttribute('fill', 'none');
            path.setAttribute('stroke', lineColor);
            path.setAttribute('stroke-width', '1');
            path.setAttribute('marker-end', `url(#${markerId})`);
            path.style.pointerEvents = 'stroke';
            path.style.cursor = 'pointer';
            path.dataset.depFrom = dep.from;
            path.dataset.depTo = dep.to;
            path.addEventListener('mousedown', (e) => e.stopPropagation());
            path.addEventListener('click', (e) => {
                e.stopPropagation();
                // Раунд 138 (по запросу Mr.D: "подтверждение удаление
                // связи не нужно") - удаление сразу по клику, без
                // confirm() (в отличие от удаления Раздела/Стадии).
                this.removeDependency(dep.from, dep.to);
            });
            svg.appendChild(path);
            drawnAny = true;
        });

        return drawnAny ? svg : null;
    }

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
    // Раунд 130 (иерархия Ганта) - indentPx (необязательный, 8-й
    // параметр) - дополнительный отступ метки задачи, для задач,
    // вложенных под Блок (indentPx как у Стадии) или Стадию (indentPx
    // побольше) - визуально показывает уровень вложенности. Для
    // обычных (не иерархических) задач - 0, без изменений.
    buildTaskRow(task, numColWidth, timelineWidth, dayWidth, taskNumber, rowBackground, anchor, indentPx = 0) {
        const row = document.createElement('div');
        row.className = 'gantt-task-row';
        // Раунд 137 (связи между задачами) - taskKey на самой строке -
        // после того, как ВСЕ строки уже отрисованы, buildDependencyLines()
        // проходит по rowsInner.children ОДИН раз и вычисляет реальную
        // вертикальную позицию (индекс среди children) каждой задачи по
        // этому атрибуту - проще и куда менее инвазивно, чем передавать
        // счётчик индекса через КАЖДУЮ из веток отрисовки (иерархия/
        // группы/плоский список - у каждой свой цикл, свой набор
        // промежуточных строк-заголовков).
        row.dataset.taskKey = task.taskKey || task.name;
        // Багфикс (Раунд 101, по жалобе Mr.D: "слетело оформление зебры,
        // строки стали чёрными") - причина: rowBg по ошибке использовал
        // var(--md-surface) (#121212/#f5f5f5 - ДРУГОЙ токен) вместо
        // var(--md-surface-variant) (#1e1e1e/#ffffff - РЕАЛЬНЫЙ фон тела
        // ноды, см. .node в styles.css) - несовпадение цвета выглядело
        // как "зебра сломалась, всё стало чёрным". Строка САМА снова
        // прозрачна для нечётных (как было ДО Раунда 100 - пусть
        // просвечивает настоящий фон ноды), непрозрачность нужна ТОЛЬКО
        // sticky-блоку (см. ниже) - она и была источником бага.
        const rowBg = rowBackground || (taskNumber % 2 === 0 ? 'rgba(255,255,255,0.02)' : '');
        row.style.cssText = `
            display: flex;
            align-items: center;
            height: ${ROW_HEIGHT}px;
            background: ${rowBg};
        `;

        // Раунд 100 (по запросу Mr.D: "не хватает закрепления столбца
        // заголовков") - все левые колонки (№/Задача/ч.ч./Раб.дн./
        // Ответственный) собираются в ОДИН sticky-контейнер вместо
        // добавления по отдельности в row - при горизонтальном скролле
        // таймлайна (актуально особенно с новым масштабом "Месяцы",
        // см. RULER_SCALES) остаются на месте. В отличие от самой
        // строки, sticky-блок ОБЯЗАН быть непрозрачным (иначе сквозь
        // него просвечивали бы полосы задач ДРУГИХ строк во время
        // скролла) - составной фон: та же зебра-подсветка (rowBg) через
        // linear-gradient ПОВЕРХ непрозрачной ОСНОВЫ
        // var(--md-surface-variant) - визуально идентично прозрачной
        // строке поверх настоящего фона ноды, но фактически непрозрачно.
        // Багфикс (Раунд 106, по жалобе Mr.D: "фон не полностью
        // перекрывает график") - без явного height:100% блок высотой
        // подстраивался под СВОЙ контент (высота строки текста,
        // ~14-16px), а не под ROW_HEIGHT (26px) самой строки - сверху и
        // снизу оставались зазоры, сквозь которые была видна полоса
        // задачи при горизонтальном скролле.
        const leftGroup = document.createElement('div');
        leftGroup.className = 'gantt-left-sticky gantt-left-sticky-js';
        leftGroup.style.cssText = `display:flex; align-items:center; height:100%; position:relative; left:0; z-index:5; will-change: transform; background: linear-gradient(${rowBg || 'transparent'}, ${rowBg || 'transparent'}), var(--md-surface-variant);`;
        row.appendChild(leftGroup);

        // Столбец номера строки (как в Excel/tableViewerNode.js) - чисто
        // навигационный ориентир, не связан с датами/сортировкой.
        // Раунд 115 (чек-лист, раздел 4 - механика добавления/удаления
        // строк) - обёрнут в numWrap: при наведении показывает значки
        // +/- (добавить строку под этой / удалить эту) и подсвечивает
        // всю строку - подсветка/фон восстанавливаются по СОХРАНЁННЫМ
        // исходным значениям (не через CSS-класс - у row/leftGroup уже
        // есть свой инлайновый фон - zebra/sticky-градиент, см. выше -
        // проще временно ПОДМЕНИТЬ его и вернуть обратно, чем воевать
        // со specificity через !important).
        // Раунд 116 (уточнение Mr.D по механике строк) - ФОКУС (клик,
        // фиксируется до следующего клика) - отдельно от НАВЕДЕНИЯ
        // (Раунд 115, лёгкая подсветка, остаётся). Колонка фокуса ПЕРЕД
        // "№ п/п" - в ней живут +/-, показываются ТОЛЬКО когда строка в
        // фокусе (не при наведении - наведение теперь просто подсвечивает,
        // без кнопок, чтобы не мешать быстрому скроллу мышью по строкам).
        const taskKey = task.taskKey || task.name;
        const isFocused = this._focusedTaskKey === taskKey;

        const focusCol = document.createElement('div');
        focusCol.className = 'gantt-row-focus-col';
        focusCol.style.cssText = `position: relative; width: ${FOCUS_COL_WIDTH}px; flex-shrink: 0; height: 100%; display: flex; align-items: center; justify-content: center; cursor: pointer;`;
        focusCol.title = 'Клик - выделить строку (правка названия, +/-). Shift+клик - мультивыделение';
        focusCol.addEventListener('mousedown', (e) => {
            e.stopPropagation();
            // Раунд 176 (по жалобе Mr.D: "не выделяет строки") - см.
            // докстринг у leftGroup.addEventListener('mousedown', ...)
            // ниже про то, почему именно mousedown, а не click.
            if (!e.shiftKey) return;
            e.preventDefault();
            if (this.multiSelectedKeys.has(taskKey)) {
                this.multiSelectedKeys.delete(taskKey);
            } else {
                this.multiSelectedKeys.add(taskKey);
            }
            this._focusedTaskKey = taskKey;
            this._rerenderGanttSlot();
        });
        focusCol.addEventListener('click', (e) => {
            e.stopPropagation();
            // Раунд 175 (по жалобе Mr.D: "могла возникнуть накладка на
            // ctrl - была зарезервирована горячая клавиша разрезать
            // связь") - Ctrl уже занят (временное включение инструмента
            // "✂️ Обрезать связи", canvasToolbar/main.js) - мультивыбор
            // строк переведён на Shift+ЛКМ (свободная, нигде в
            // диаграмме/канвасе не занятая комбинация).
            // Раунд 176 - сама обработка Shift+клика теперь на
            // mousedown выше - здесь просто выходим, чтобы не сработать
            // ВТОРОЙ раз на том же физическом клике.
            if (e.shiftKey) return;
            if (this.multiSelectedKeys.size > 0) this.multiSelectedKeys.clear();
            this._focusedTaskKey = isFocused ? null : taskKey;
            this._rerenderGanttSlot();
        });

        if (isFocused) {
            // Раунд 147 (по запросу Mr.D: "получилось слишком много
            // кнопок, и они очень мелкие. Вместо кнопок поставим ручку,
            // а на строке в фокусе сделаем контекстное меню по ПКМ") -
            // одна ручка (⠿, тот же символ, что уже используют ручки
            // виджетов Досок, Раунд 124 - визуально узнаваемо) вместо
            // трёх отдельных кнопок (+/-/⇥, Раунд 115/146) - клик ПКМ по
            // самой ручке ИЛИ по ЛЮБОЙ ячейке шапки строки (та же
            // область, что уже устанавливает фокус - см. leftGroup
            // ниже) открывает меню.
            const handle = document.createElement('div');
            handle.className = 'gantt-row-handle';
            handle.textContent = '⠿';
            handle.title = 'ПКМ - меню строки (добавить/раздел/удалить). Перетащите - изменить порядок';
            handle.addEventListener('click', (e) => e.stopPropagation());
            // Раунд 180 (по запросу Mr.D: "у строки была заготовлена
            // ручка, надо её задействовать, чтобы строку можно было
            // перетащить схватившись за ручку") - mousedown на ручке
            // запускает drag, а не просто "проглатывает" клик, как
            // раньше (e.stopPropagation() без дальнейших действий).
            // rowsWrap (родитель ВСЕХ строк, включая заголовки групп) -
            // ищем среди СОСЕДЕЙ по data-task-key (проставлен на КАЖДОЙ
            // строке - и задачи, и раздела, см. buildGroupHeaderRow()) -
            // перетаскивание "поверх" строки-раздела вставляет ПОСЛЕ
            // НЕЁ (в тот же плоский список - раздел сам физически не
            // двигается, это отдельная структура, taskGroups).
            handle.addEventListener('mousedown', (e) => {
                e.stopPropagation();
                // Раунд 180 (багфикс сразу же по факту реализации) -
                // ТОЛЬКО левая кнопка мыши (button===0) запускает сам
                // drag - ПКМ (button===2) тоже порождает mousedown
                // ПЕРЕД событием 'contextmenu' (leftGroup.addEventListener
                // ('contextmenu', ...) ниже) - без этой проверки правый
                // клик по ручке начинал бы визуальное перетаскивание
                // (класс gantt-row-dragging, слушатели на document) и
                // мешал открытию контекстного меню. stopPropagation()
                // выше остаётся БЕЗУСЛОВНОЙ (как было раньше) - и для
                // ПКМ тоже, просто без запуска drag-последовательности.
                if (e.button !== 0) return;
                e.preventDefault();
                const rowsWrap = row.parentElement;
                if (!rowsWrap) return;
                row.classList.add('gantt-row-dragging');
                let dropTargetKey = null; // afterKey для _applyTaskOrderOverrides() - null = без изменений
                let lastMarkedEl = null;

                const clearMark = () => {
                    if (lastMarkedEl) {
                        lastMarkedEl.classList.remove('gantt-row-drop-before', 'gantt-row-drop-after');
                        lastMarkedEl = null;
                    }
                };

                const onMove = (moveEvt) => {
                    const siblingRows = Array.from(rowsWrap.children).filter(el => el.dataset && el.dataset.taskKey);
                    let insertBeforeEl = null;
                    for (const sib of siblingRows) {
                        if (sib === row) continue;
                        const rect = sib.getBoundingClientRect();
                        if (moveEvt.clientY < rect.top + rect.height / 2) { insertBeforeEl = sib; break; }
                    }
                    clearMark();
                    if (insertBeforeEl) {
                        const idx = siblingRows.indexOf(insertBeforeEl);
                        const prevEl = siblingRows[idx - 1];
                        dropTargetKey = (prevEl && prevEl !== row) ? this._resolveDropTargetKey(prevEl.dataset.taskKey) : '__start__';
                        insertBeforeEl.classList.add('gantt-row-drop-before');
                        lastMarkedEl = insertBeforeEl;
                    } else {
                        const lastEl = siblingRows[siblingRows.length - 1];
                        dropTargetKey = (lastEl && lastEl !== row) ? this._resolveDropTargetKey(lastEl.dataset.taskKey) : null;
                        if (lastEl && lastEl !== row) {
                            lastEl.classList.add('gantt-row-drop-after');
                            lastMarkedEl = lastEl;
                        }
                    }
                };
                const onUp = () => {
                    document.removeEventListener('mousemove', onMove);
                    document.removeEventListener('mouseup', onUp);
                    row.classList.remove('gantt-row-dragging');
                    clearMark();
                    if (dropTargetKey !== null && dropTargetKey !== taskKey) {
                        // Раунд 187 (по запросу Mr.D: "Перетаскивание
                        // группы строк в Диаграмме Ганта - возможность
                        // перетаскивать несколько выделенных строк
                        // одновременно") - если перетаскиваемая строка
                        // входит в мультивыбор из 2+ строк (Shift+ЛКМ,
                        // Раунд 174/175) - двигаем ВСЕ выделенные
                        // строки разом, а не только ту, за ручку
                        // которой тащили. ЦЕПОЧКА overrides
                        // (afterKey каждой СЛЕДУЮЩЕЙ выделенной строки -
                        // ключ ПРЕДЫДУЩЕЙ) - сохраняет их взаимный
                        // порядок (по текущей позиции в this.tasks, не
                        // по порядку Shift-кликов) и ставит их
                        // ПОСЛЕДОВАТЕЛЬНО сразу после точки вставки -
                        // тот же алгоритм _applyTaskOrderOverrides()
                        // (Раунд 180) корректно разворачивает цепочку
                        // без каких-либо изменений в нём самом.
                        if (this.multiSelectedKeys.size > 1 && this.multiSelectedKeys.has(taskKey) && !this.multiSelectedKeys.has(dropTargetKey)) {
                            // dropTargetKey исключён из мультивыбора (см.
                            // условие выше) - иначе точка вставки сама
                            // оказалась бы ВНУТРИ перемещаемой группы,
                            // порождая циклическую цепочку overrides
                            // (K1->K2->K1) - в таком случае просто
                            // откатываемся на перетаскивание одной строки
                            // (ветка else ниже), не пытаясь угадать
                            // "правильное" поведение для этого редкого
                            // случая.
                            const orderedSelected = this.tasks
                                .map(t => t.taskKey || t.name)
                                .filter(k => this.multiSelectedKeys.has(k));
                            let afterKey = dropTargetKey;
                            orderedSelected.forEach(k => {
                                this.taskOrderOverrides[k] = afterKey;
                                afterKey = k;
                            });
                        } else {
                            this.taskOrderOverrides[taskKey] = dropTargetKey;
                        }
                        if (window.nodeManager) window.nodeManager.calculateAll();
                        if (window.renderer) window.renderer.updateAllDisplays();
                    }
                };
                document.addEventListener('mousemove', onMove);
                document.addEventListener('mouseup', onUp);
            });
            focusCol.appendChild(handle);
        }
        leftGroup.appendChild(focusCol);

        // Раунд 115 - подсветка по НАВЕДЕНИЮ (мышь над областью номера
        // строки ИЛИ новой колонкой фокуса) - независима от фокуса
        // (клика), временная подмена inline-фона (не CSS-класс - у row/
        // leftGroup уже есть свой инлайновый фон - zebra/sticky-
        // градиент - проще временно подменить и вернуть, чем воевать со
        // specificity через !important).
        const numWrap = document.createElement('div');
        numWrap.className = 'gantt-row-num-wrap';
        numWrap.style.cssText = `position: relative; width: ${numColWidth}px; flex-shrink: 0; height: 100%; display: flex; align-items: center; cursor: pointer;`;
        numWrap.title = focusCol.title;

        const numCell = document.createElement('div');
        numCell.className = 'gantt-row-num';
        numCell.style.cssText = `
            width: 100%;
            font-size: 10px;
            color: ${isFocused ? 'var(--md-accent)' : 'var(--md-text-disabled)'};
            text-align: right;
            padding-right: 4px;
            font-variant-numeric: tabular-nums;
        `;
        numCell.textContent = String(taskNumber);
        numWrap.appendChild(numCell);

        numWrap.addEventListener('mousedown', (e) => e.stopPropagation());
        numWrap.addEventListener('click', (e) => {
            e.stopPropagation();
            this._focusedTaskKey = isFocused ? null : taskKey;
            this._rerenderGanttSlot();
        });

        // Раунд 174/177 (по запросу Mr.D: "мультивыделение для
        // одновременного редактирования... работает, но нет явного
        // выделения, нужна подсветка выделенных строк") - строки
        // мультивыбора получают ПОЛНОЦЕННЫЙ фон (не тонкую рамку -
        // Раунд 174 пробовал `box-shadow: inset 3px 0 0`, но та
        // физически СКРЫТА за липкой leftGroup, у которой свой
        // непрозрачный фон поверх - никогда не была видна), другого
        // цвета, чем подсветка фокуса (var(--md-surface-3)) - иначе не
        // отличить "эта строка сейчас редактируется" от "эта строка
        // просто выделена вместе с другими". color-mix() - оттенок
        // акцентного цвета темы с прозрачностью (тот же акцент, что уже
        // используют другие элементы подсветки диаграммы, просто
        // разбавленный) - работает одинаково хорошо в обеих темах
        // (день/ночь) без отдельного вычисления под каждую.
        const isMultiSelected = this.multiSelectedKeys.has(taskKey);
        const multiSelectBg = 'color-mix(in srgb, var(--md-accent) 22%, transparent)';

        const originalRowBg = isMultiSelected && !isFocused ? multiSelectBg : row.style.background;
        const originalLeftBg = isMultiSelected && !isFocused ? multiSelectBg : leftGroup.style.background;
        const highlightOn = () => {
            row.style.background = 'var(--md-surface-3)';
            leftGroup.style.background = 'var(--md-surface-3)';
        };
        // Раунд 177 - "выключение" подсветки (уход мыши) теперь
        // возвращает к originalRowBg/originalLeftBg - для строки
        // мультивыбора это УЖЕ multiSelectBg (см. выше), не пустой фон -
        // наведение временно "перекрывает" его цветом фокуса, но при
        // уходе мыши акцентная подсветка выделения корректно
        // возвращается, а не пропадает совсем.
        const highlightOff = () => {
            row.style.background = originalRowBg;
            leftGroup.style.background = originalLeftBg;
        };
        // Раунд 146 (по запросу Mr.D: "фокус не должен спадать сам,
        // включая подсветку строки целиком") - раньше подсветка была
        // ЧИСТО по наведению (mouseenter/mouseleave), полностью
        // независимо от isFocused - уводишь мышь в сторону, подсветка
        // пропадает, хотя строка ВСЁ ЕЩЁ в фокусе (поля редактирования
        // видны). Теперь: если строка в фокусе - подсветка включается
        // СРАЗУ (не ждёт наведения) и НЕ гаснет при уходе мыши -
        // наведение по-прежнему даёт временную подсветку для ОСТАЛЬНЫХ
        // (не сфокусированных) строк, как и раньше.
        if (isFocused) {
            highlightOn();
        } else if (isMultiSelected) {
            // Раунд 177 - применяем СРАЗУ, не дожидаясь наведения - та
            // же логика, что уже применена к фокусу (иначе выделенные
            // строки были бы подсвечены ТОЛЬКО пока над ними курсор,
            // что и означало "нет явного выделения" в жалобе Mr.D).
            row.style.background = multiSelectBg;
            leftGroup.style.background = multiSelectBg;
        }
        numWrap.addEventListener('mouseenter', highlightOn);
        numWrap.addEventListener('mouseleave', () => { if (!isFocused) highlightOff(); });
        focusCol.addEventListener('mouseenter', highlightOn);
        focusCol.addEventListener('mouseleave', () => { if (!isFocused) highlightOff(); });

        // Раунд 146 (по запросу Mr.D: "фокусировка должна срабатывать
        // при нажатии на любой элемент заголовка (только не на самом
        // графике, это будет мешать редактированию)") - один обработчик
        // на ВЕСЬ leftGroup (не на каждую ячейку отдельно) - клик по
        // ЛЮБОЙ ячейке шапки строки (метка/раздел/ответственный/итд),
        // у которой НЕТ своего stopPropagation() (те есть только у полей
        // редактирования, когда строка УЖЕ в фокусе - см. sectionCell/
        // label ниже, у них 'mousedown'/'click' уже перехвачены),
        // устанавливает фокус на эту строку. track (полоса на самой
        // диаграмме) - ОТДЕЛЬНЫЙ элемент, вне leftGroup, сюда не
        // попадает - клики по ней не трогают фокус (не мешают
        // перетаскиванию/растягиванию).
        // Раунд 176 (по жалобе Mr.D: "не выделяет строки, где-то
        // ошибка") - обработка Shift+клика перенесена с 'click' на
        // 'mousedown' - подозрение (наиболее вероятное объяснение):
        // Shift+клик по умолчанию запускает НАТИВНОЕ выделение
        // ДИАПАЗОНА ТЕКСТА браузером (расширение выделения от
        // предыдущей точки клика) - это может мешать корректному
        // срабатыванию/распространению именно события 'click' в
        // некоторых сценариях. 'mousedown' с explicit preventDefault()
        // перехватывает ДО того, как у браузера появляется шанс начать
        // нативное выделение - тот же самый приём, что УЖЕ используют
        // ВСЕ drag-взаимодействия диаграммы (растягивание полосы,
        // ручка ширины виджета и т.п. - ни один из них не полагается
        // на 'click').
        leftGroup.addEventListener('mousedown', (e) => {
            if (!e.shiftKey) return;
            e.preventDefault();
            e.stopPropagation();
            if (this.multiSelectedKeys.has(taskKey)) {
                this.multiSelectedKeys.delete(taskKey);
            } else {
                this.multiSelectedKeys.add(taskKey);
            }
            this._focusedTaskKey = taskKey;
            this._rerenderGanttSlot();
        });

        leftGroup.addEventListener('click', (e) => {
            // Shift-клик уже обработан на mousedown выше (см. её
            // докстринг) - здесь просто выходим, чтобы не сработать
            // ВТОРОЙ раз (mousedown + click - оба события физически
            // происходят на одном и том же клике) и не "отменить"
            // только что сделанное переключение строки в наборе.
            if (e.shiftKey) return;
            if (!isFocused) {
                // Обычный клик (без Shift) - сбрасывает мультивыделение,
                // если оно было (обычное поведение "клик мимо снимает
                // множественный выбор", как в файловых менеджерах).
                if (this.multiSelectedKeys.size > 0) this.multiSelectedKeys.clear();
                this._focusedTaskKey = taskKey;
                this._rerenderGanttSlot();
            }
        });

        // Раунд 147 (по запросу Mr.D: "на строке в фокусе сделаем
        // контекстное меню по нажатию на ПКМ") - меню открывается ТОЛЬКО
        // когда строка УЖЕ в фокусе (сначала ЛКМ - фокус, потом ПКМ -
        // меню - тот же порядок действий, что подразумевает сама
        // формулировка запроса) - на НЕ сфокусированной строке ПКМ не
        // делает ничего особенного (обычное системное меню браузера,
        // если оно вообще доступно в Electron-окне).
        leftGroup.addEventListener('contextmenu', (e) => {
            if (!isFocused) return;
            e.preventDefault();
            e.stopPropagation();
            this._showRowContextMenu(e.clientX, e.clientY, taskKey, false);
        });

        leftGroup.appendChild(numWrap);

        // Раунд 133 (по запросу Mr.D: "нужно добавить столбик 'Раздел'
        // сразу после № п/п") - Раунд 136 (по уточнению после Раунда
        // 135: "не нужно переназначать разделы, берём как есть из № п/п...
        // разделы есть и у задач, и у подзадач, а корневые разделы чаще
        // всего остаются без номера, но нужно оставить возможность
        // поставить его вручную. Ручное редактирование нужно сохранить") -
        // значение = _effectiveSection(task) (ручное переопределение в
        // приоритете, иначе сырое sectionNumber строки "как есть", БЕЗ
        // вычислений/наследования - см. GanttTableProcessorNode). Пустая
        // ячейка - ожидаемо для корневых строк-разделов (у них обычно
        // нет своего № п/п) - тем и нужно ручное редактирование, тот же
        // принцип, что уже есть у "Вид работ"/"Ответственный" (Раунд
        // 116/117) - редактируемое поле, пока строка в фокусе.
        // "Разделы могут повторяться - подсвечиваем красным" -
        // см. _isDuplicateSectionNumber()/_isDuplicateSectionName().
        if (this.showSectionColumn) {
            const sectionValue = this._effectiveSection(task);
            const isDuplicate = sectionValue && (task.sectionNumber
                ? this._isDuplicateSectionNumber(task.sectionNumber)
                : this._isDuplicateSectionName(sectionValue));
            let sectionCell;
            if (isFocused) {
                sectionCell = document.createElement('input');
                sectionCell.type = 'text';
                sectionCell.className = 'gantt-section-cell gantt-section-input';
                sectionCell.value = sectionValue;
                sectionCell.style.cssText = `
                    width: ${this._sectionW()}px;
                    flex-shrink: 0;
                    font-size: 10px;
                    color: ${isDuplicate ? 'var(--md-error)' : 'var(--md-text-secondary)'};
                    padding-right: 6px;
                    background: transparent;
                    border: none;
                    border-bottom: 1px solid var(--md-accent);
                    font-family: inherit;
                `;
                sectionCell.addEventListener('mousedown', (e) => e.stopPropagation());
                sectionCell.addEventListener('click', (e) => e.stopPropagation());
                sectionCell.addEventListener('change', (e) => {
                    const newSection = e.target.value.trim();
                    this.taskSectionOverrides[taskKey] = newSection;
                    this._propagateToMultiSelection(taskKey, (otherTask) => {
                        this.taskSectionOverrides[otherTask.taskKey || otherTask.name] = newSection;
                    });
                    if (window.nodeManager) window.nodeManager.calculateAll();
                    if (window.renderer) window.renderer.updateAllDisplays();
                });
                this._attachFieldNavigation(sectionCell, taskKey, 'section');
            } else {
                sectionCell = document.createElement('div');
                sectionCell.className = 'gantt-section-cell';
                sectionCell.style.cssText = `
                    width: ${this._sectionW()}px;
                    flex-shrink: 0;
                    font-size: 10px;
                    color: ${isDuplicate ? 'var(--md-error)' : 'var(--md-text-secondary)'};
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                    padding-right: 6px;
                `;
                sectionCell.textContent = sectionValue;
                sectionCell.title = isDuplicate
                    ? `${sectionValue} - раздел встречается несколько раз в источнике (возможно, случайный повтор)`
                    : sectionValue;
            }
            leftGroup.appendChild(sectionCell);
        }

        // Раунд 130/151 (иерархия Ганта, по запросу Mr.D: "добавить
        // полосы для отслеживания разделов, мы это уже делали в ноде
        // 'просмотр дерева'") - вместо одного пустого спейсера - линии-
        // проводники (по одной НА КАЖДЫЙ уровень вложенности) - тот же
        // визуальный приём, что уже есть у TreeViewerNode
        // (.board-widget-tree-guide, см. treeWidgetRenderer.js) -
        // переиспользован класс 1-в-1 (тот же CSS уже есть в проекте).
        if (indentPx) {
            const depth = Math.round(indentPx / GROUP_INDENT_PX_CONST);
            for (let d = 0; d < depth; d++) {
                const guide = document.createElement('span');
                guide.className = 'board-widget-tree-guide';
                guide.style.cssText = 'align-self: stretch;';
                leftGroup.appendChild(guide);
            }
        }

        // Раунд 116 - "Вид работ" РЕДАКТИРУЕМО, пока строка в фокусе
        // (переопределение поверх значения из источника - taskNameOverrides,
        // тот же принцип, что taskDurationOverrides/taskDates, см. её
        // докстринг в конструкторе). Вне фокуса - обычный текстовый
        // ярлык, как и раньше (не превращать КАЖДУЮ строку в <input> -
        // ни к чему лишний DOM/фокус-ловушки там, где не нужно).
        let label;
        if (isFocused) {
            label = document.createElement('input');
            label.type = 'text';
            label.className = 'gantt-task-label gantt-task-label-input';
            label.value = task.name;
            label.style.cssText = `
                width: ${this._labelW() - indentPx}px;
                flex-shrink: 0;
                font-size: 11px;
                color: var(--md-text);
                padding-right: 6px;
                background: transparent;
                border: none;
                border-bottom: 1px solid var(--md-accent);
                font-family: inherit;
            `;
            label.addEventListener('mousedown', (e) => e.stopPropagation());
            label.addEventListener('click', (e) => e.stopPropagation());
            label.addEventListener('change', (e) => {
                const rawNewName = e.target.value.trim();
                if (!rawNewName || rawNewName === task.name) return;
                const newName = this._uniqueTaskName(rawNewName);
                const manualTask = this.manualTasks.find(t => t.key === taskKey);
                if (manualTask) {
                    manualTask.name = newName;
                } else {
                    this.taskNameOverrides[taskKey] = newName;
                }
                // Раунд 174 - каждая строка мультивыбора получает СВОЮ
                // проверку через _uniqueTaskName() (не буквально ОДНО и
                // то же имя всем сразу) - иначе N выделенных строк с
                // одинаковым именем немедленно столкнулись бы друг с
                // другом (та же логика уникальности, что уже применяется
                // при обычном переименовании/создании строки).
                this._propagateToMultiSelection(taskKey, (otherTask) => {
                    const otherKey = otherTask.taskKey || otherTask.name;
                    const uniqueForOther = this._uniqueTaskName(rawNewName);
                    const otherManualTask = this.manualTasks.find(t => t.key === otherKey);
                    if (otherManualTask) {
                        otherManualTask.name = uniqueForOther;
                    } else {
                        this.taskNameOverrides[otherKey] = uniqueForOther;
                    }
                });
                if (window.nodeManager) window.nodeManager.calculateAll();
                if (window.renderer) window.renderer.updateAllDisplays();
            });
            // Раунд 159 (по запросу Mr.D: "вставка многострочного текста -
            // если текст разделён на строки, то под каждую новую строку
            // запускаем макрос на создание новой строки, чтобы при
            // копировании из таблиц каждая новая строка вставала на своё
            // место сразу при Ctrl+C Ctrl+V") - перехватываем ДО того,
            // как браузер вставит текст как есть в это ОДНО поле (иначе
            // многострочный текст просто "склеился" бы в одну строку с
            // символами переноса внутри).
            label.addEventListener('paste', (e) => {
                const text = e.clipboardData?.getData('text');
                if (!text || !/\r\n|\r|\n/.test(text)) return; // одна строка - обычная вставка, ничего не перехватываем
                e.preventDefault();
                this._pasteMultilineIntoTask(taskKey, text);
            });
            this._attachFieldNavigation(label, taskKey, 'name');
        } else {
            label = document.createElement('div');
            label.className = 'gantt-task-label';
            // Раунд 187 (по запросу Mr.D: "Автоперенос текста в
            // Диаграмме Ганта - если текст длинный, переносится, но
            // если строк слишком много - не переносим") - раньше
            // ЛЮБОЙ длинный текст сразу обрезался многоточием на ОДНОЙ
            // строке (white-space:nowrap). -webkit-line-clamp: 2 -
            // переносит текст до ДВУХ строк (line-height 13px × 2 =
            // 26px, ровно ROW_HEIGHT - высота строки НЕ меняется,
            // подпись просто использует уже имеющееся место вертикально
            // вместо того, чтобы обрезать сразу) - если текст НЕ
            // уместился бы даже в 2 строки, дальше - снова многоточие
            // ("если строк слишком много - не переносим" ЕЩЁ БОЛЬШЕ, а
            // обрезаем).
            label.style.cssText = `
                width: ${this._labelW() - indentPx}px;
                flex-shrink: 0;
                font-size: 11px;
                line-height: 13px;
                max-height: ${ROW_HEIGHT}px;
                color: var(--md-text);
                overflow: hidden;
                display: -webkit-box;
                -webkit-line-clamp: 2;
                -webkit-box-orient: vertical;
                white-space: normal;
                word-break: break-word;
                padding-right: 6px;
            `;
            label.textContent = task.name;
            label.title = task.name;
        }
        leftGroup.appendChild(label);

        // Столбец "ч.ч." (Раунд 78, по запросу Mr.D) - длительность
        // задачи в ЧАСАХ, независимо от this.durationUnit (тот влияет
        // только на то, как ЧИТАЕТСЯ входной список - durationDays уже
        // всегда в днях внутри, см. calculate()). Раунд 81 - теперь
        // можно скрыть флагом this.showDurationColumn.
        if (this.showDurationColumn) {
            const hoursCell = document.createElement('div');
            hoursCell.className = 'gantt-hours-cell';
            hoursCell.style.cssText = `
                width: ${this._hoursW()}px;
                flex-shrink: 0;
                font-size: 10px;
                color: var(--md-text-secondary);
                text-align: right;
                padding-right: 6px;
                font-variant-numeric: tabular-nums;
            `;
            hoursCell.textContent = Helpers.formatNumber(task.durationDays * HOURS_PER_WORKDAY);
            leftGroup.appendChild(hoursCell);
        }

        // Столбец "Раб.дн." (Раунд 81, п.3) - рабочих дней ВНУТРИ
        // диапазона именно этой задачи (не общего диапазона проекта -
        // та величина для "Итого"/группы, см. buildTotalRow()/
        // buildGroupHeaderRow()). Раунд 88 (чек-лист 1.7.21, п.5) -
        // теперь РЕДАКТИРУЕМОЕ поле, не просто текст.
        if (this.showWorkingDaysColumn) {
            const workdaysInput = document.createElement('input');
            workdaysInput.type = 'number';
            workdaysInput.className = 'gantt-workdays-cell gantt-workdays-input';
            workdaysInput.min = '0';
            workdaysInput.step = '1';
            workdaysInput.style.cssText = `
                width: ${this._workdaysW()}px;
                flex-shrink: 0;
                font-size: 10px;
                color: var(--md-text-secondary);
                text-align: right;
                padding-right: 6px;
                font-variant-numeric: tabular-nums;
                background: transparent;
                border: none;
                font-family: inherit;
            `;
            workdaysInput.value = this._countWorkingDaysInRange(anchor, task.startOffsetDays, task.durationDays);
            workdaysInput.dataset.taskKey = task.taskKey || task.name;
            workdaysInput.addEventListener('mousedown', (e) => e.stopPropagation());
            workdaysInput.addEventListener('click', (e) => e.stopPropagation());
            workdaysInput.addEventListener('change', (e) => {
                const newWorkDays = Math.max(0, parseInt(e.target.value, 10) || 0);
                this._applyWorkDaysEdit(task, newWorkDays, anchor);
                this._propagateToMultiSelection(taskKey, (otherTask) => this._applyWorkDaysEdit(otherTask, newWorkDays, anchor));
            });
            this._attachFieldNavigation(workdaysInput, taskKey, 'workdays');
            leftGroup.appendChild(workdaysInput);
        }

        // Раунд 187 (по запросу Mr.D: "Ручной ввод дат в Диаграмме
        // Ганта - поля для начала и конца задачи с синхронизацией с
        // графическим редактором") - "Дата начала": та же семантика,
        // что у перетаскивания ТЕЛА полосы мышью - СДВИГ (длительность
        // не меняется, конец смещается на ту же дельту) - см.
        // _applyStartDateEdit() дальше по файлу.
        if (this.showStartDateColumn) {
            const startDateInput = document.createElement('input');
            startDateInput.type = 'date';
            startDateInput.className = 'gantt-startdate-cell gantt-startdate-input';
            startDateInput.style.cssText = `
                width: ${this._startDateW()}px;
                flex-shrink: 0;
                font-size: 10px;
                color: var(--md-text-secondary);
                background: transparent;
                border: none;
                font-family: inherit;
                padding: 0 4px;
            `;
            startDateInput.value = formatISODate(addDays(anchor, task.startOffsetDays));
            startDateInput.dataset.taskKey = taskKey;
            startDateInput.addEventListener('mousedown', (e) => e.stopPropagation());
            startDateInput.addEventListener('click', (e) => e.stopPropagation());
            startDateInput.addEventListener('change', (e) => {
                const picked = parseISODate(e.target.value);
                if (!picked) return;
                const newOffset = Math.round((picked - anchor) / 86400000);
                if (newOffset === task.startOffsetDays) return;
                const deltaDays = newOffset - task.startOffsetDays;
                this._applyStartDateEdit(task, newOffset);
                // Та же дельта-логика мультивыбора, что уже применена
                // к графическому перетаскиванию (Раунд 178) - сохраняет
                // относительные расстояния между выделенными задачами.
                this._propagateToMultiSelection(taskKey, (otherTask) => {
                    this._applyStartDateEdit(otherTask, Math.max(0, otherTask.startOffsetDays + deltaDays));
                });
            });
            this._attachFieldNavigation(startDateInput, taskKey, 'startDate');
            leftGroup.appendChild(startDateInput);
        }

        // "Дата окончания" - та же семантика, что у перетаскивания
        // ПРАВОЙ ручки изменения размера - РАСТЯГИВАНИЕ (начало не
        // меняется, меняется только длительность) - переиспользует
        // _applyWorkDaysEdit() (Раунд 178), не дублирует логику.
        if (this.showEndDateColumn) {
            const endDateInput = document.createElement('input');
            endDateInput.type = 'date';
            endDateInput.className = 'gantt-enddate-cell gantt-enddate-input';
            endDateInput.style.cssText = `
                width: ${this._endDateW()}px;
                flex-shrink: 0;
                font-size: 10px;
                color: var(--md-text-secondary);
                background: transparent;
                border: none;
                font-family: inherit;
                padding: 0 4px;
            `;
            endDateInput.value = formatISODate(addDays(anchor, task.startOffsetDays + task.durationDays));
            endDateInput.dataset.taskKey = taskKey;
            endDateInput.addEventListener('mousedown', (e) => e.stopPropagation());
            endDateInput.addEventListener('click', (e) => e.stopPropagation());
            endDateInput.addEventListener('change', (e) => {
                const picked = parseISODate(e.target.value);
                if (!picked) return;
                const taskStart = addDays(anchor, task.startOffsetDays);
                const newCalendarSpan = Math.round((picked - taskStart) / 86400000);
                if (newCalendarSpan <= 0) return; // конец раньше начала - бессмысленно, игнорируем
                const newWorkDays = this._countWorkingDaysInRange(anchor, task.startOffsetDays, newCalendarSpan);
                this._applyWorkDaysEdit(task, newWorkDays, anchor);
                this._propagateToMultiSelection(taskKey, (otherTask) => this._applyWorkDaysEdit(otherTask, newWorkDays, anchor));
            });
            this._attachFieldNavigation(endDateInput, taskKey, 'endDate');
            leftGroup.appendChild(endDateInput);
        }

        // Столбец "Ответственный" (Раунд 88, чек-лист 1.7.21, п.4).
        // Раунд 117 (по запросу Mr.D: "добавить возможность вводить
        // Ответственного, сейчас заблокировано") - редактируемо, пока
        // строка в фокусе - тот же принцип, что "Вид работ" (Раунд 116) -
        // пишет в УЖЕ СУЩЕСТВУЮЩИЙ this.taskResponsible (Раунд 83) -
        // тот самый override-словарь, который уже читает
        // _effectiveResponsible()/выходная таблица/цвет полосы (Раунд
        // 109) - никакого нового механизма не потребовалось, только
        // сама возможность ввода.
        if (this.showResponsibleColumn) {
            const respValue = this._effectiveResponsible(task);
            let responsibleCell;
            if (isFocused) {
                responsibleCell = document.createElement('input');
                responsibleCell.type = 'text';
                responsibleCell.className = 'gantt-responsible-cell gantt-responsible-input';
                responsibleCell.value = respValue;
                responsibleCell.style.cssText = `
                    width: ${this._respW()}px;
                    flex-shrink: 0;
                    font-size: 10px;
                    color: var(--md-text-secondary);
                    padding-right: 6px;
                    background: transparent;
                    border: none;
                    border-bottom: 1px solid var(--md-accent);
                    font-family: inherit;
                `;
                responsibleCell.addEventListener('mousedown', (e) => e.stopPropagation());
                responsibleCell.addEventListener('click', (e) => e.stopPropagation());
                responsibleCell.addEventListener('change', (e) => {
                    const newValue = e.target.value.trim();
                    this.taskResponsible[taskKey] = newValue;
                    this._propagateToMultiSelection(taskKey, (otherTask) => {
                        this.taskResponsible[otherTask.taskKey || otherTask.name] = newValue;
                    });
                    if (window.nodeManager) window.nodeManager.calculateAll();
                    if (window.renderer) window.renderer.updateAllDisplays();
                });
                this._attachFieldNavigation(responsibleCell, taskKey, 'responsible');
            } else {
                responsibleCell = document.createElement('div');
                responsibleCell.className = 'gantt-responsible-cell';
                responsibleCell.style.cssText = `
                    width: ${this._respW()}px;
                    flex-shrink: 0;
                    font-size: 10px;
                    color: var(--md-text-secondary);
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                    padding-right: 6px;
                `;
                responsibleCell.textContent = respValue;
                responsibleCell.title = respValue;
            }
            leftGroup.appendChild(responsibleCell);
        }

        // Столбец "Кал. дни" (Раунд 101, чек-лист п.2.2) - календарные
        // дни ЭТОЙ задачи, включая выходные/праздники (в отличие от
        // "Раб.дн." - та их исключает) - тот же смысл, что task.durationDays
        // (календарная ширина полосы), просто отдельная видимая колонка.
        if (this.showCalDaysColumn) {
            const calDaysCell = document.createElement('div');
            calDaysCell.className = 'gantt-caldays-cell';
            calDaysCell.style.cssText = `
                width: ${this._calDaysW()}px;
                flex-shrink: 0;
                font-size: 10px;
                color: var(--md-text-secondary);
                text-align: right;
                padding-right: 6px;
                font-variant-numeric: tabular-nums;
            `;
            calDaysCell.textContent = String(task.durationDays);
            leftGroup.appendChild(calDaysCell);
        }

        // Раунд 157 - "Сум.раб.дн."/"Сум.ч.ч." - у ОДНОЙ задачи это
        // истинное число реально отработанных дней/часов (может
        // отличаться от "Раб.дн."/"ч.ч." выше, если сама задача
        // перескакивает через выходной внутри своего диапазона).
        if (this.showSumWorkingDaysColumn) {
            const sumWdCell = document.createElement('div');
            sumWdCell.style.cssText = `width:${this._sumWorkdaysW()}px; flex-shrink:0; font-size:10px; color:var(--md-text-secondary); text-align:right; padding-right:6px; font-variant-numeric:tabular-nums;`;
            sumWdCell.textContent = String(this._sumWorkdaysForTasks([task]));
            sumWdCell.title = 'Сумма реально отработанных рабочих дней';
            leftGroup.appendChild(sumWdCell);
        }
        if (this.showSumHoursColumn) {
            const sumHCell = document.createElement('div');
            sumHCell.style.cssText = `width:${this._sumHoursW()}px; flex-shrink:0; font-size:10px; color:var(--md-text-secondary); text-align:right; padding-right:6px; font-variant-numeric:tabular-nums;`;
            sumHCell.textContent = Helpers.formatNumber(this._sumHoursForTasks([task]));
            sumHCell.title = 'Сумма реально отработанных человеко-часов';
            leftGroup.appendChild(sumHCell);
        }

        const track = document.createElement('div');
        track.style.cssText = `position: relative; width: ${timelineWidth}px; height: 100%; flex-shrink: 0;`;

        const bar = document.createElement('div');
        bar.className = 'gantt-bar';
        bar.dataset.taskName = task.taskKey || task.name;
        // Раунд 109 (по запросу Mr.D: "пользовательские цвета для
        // Ответственных - на каждый тип ответственного свой цвет
        // диаграммы") - если у task.responsible назначен цвет в
        // this.responsibleColors - красим полосу им, иначе - прежний
        // единый var(--md-primary).
        const barColor = this._colorForTask(task) || 'var(--md-primary)';
        bar.style.cssText = `
            position: absolute;
            top: 4px; bottom: 4px;
            left: ${task.startOffsetDays * dayWidth}px;
            width: ${Math.max(4, task.durationDays * dayWidth)}px;
            background: ${barColor};
            border-radius: 3px;
            cursor: grab;
        `;
        bar.title = `${task.name}: ${task.durationDays} дн. (${Helpers.formatNumber(task.durationDays * HOURS_PER_WORKDAY)} ч.) - потяните за края, чтобы растянуть`;
        this.attachBarDrag(bar, task, dayWidth);

        // Раунд 144 (чек-лист "Недельный вид" - "подписи дат на
        // полосах") - особенно нужно в масштабах "Недели"/"Месяцы" (там
        // сама ширина полосы не даёт прочитать длительность на глаз) -
        // текст СПРАВА от полосы (не внутри - полоса часто слишком
        // узкая для текста), не мешает ручке соединения (та тоже справа,
        // но БЛИЖЕ - см. right:-10px ниже - подпись дальше).
        if (this.showBarDateLabels) {
            const startDate = addDays(anchor, task.startOffsetDays);
            const endDate = addDays(anchor, task.startOffsetDays + task.durationDays);
            const dateLabel = document.createElement('div');
            dateLabel.className = 'gantt-bar-date-label';
            dateLabel.style.cssText = `
                position: absolute;
                left: calc(100% + 14px);
                top: 50%;
                transform: translateY(-50%);
                font-size: 9px;
                color: var(--md-text-secondary);
                white-space: nowrap;
                pointer-events: none;
                z-index: 2;
            `;
            dateLabel.textContent = `${formatDateRu(startDate)} — ${formatDateRu(endDate)}`;
            bar.appendChild(dateLabel);
        }

        // Раунд 137 (чек-лист "Связи между задачами") - "Механика:
        // перетаскивание мышкой от одной задачи к другой" + "визуальный
        // индикатор при наведении" - ручка (кружок) на ПРАВОМ краю
        // полосы, скрыта по умолчанию (CSS :hover, см. day_styles.css/
        // styles.css), появляется при наведении на саму полосу.
        // Нативный HTML5 Drag&Drop (не mousedown/mousemove) - тот же
        // приём, что уже используется для перетаскивания виджетов на
        // Доске (Раунд 124) - dragover/drop сам определяет "над какой
        // именно полосой сейчас курсор", без ручного hit-testing.
        // taskKey - уже объявлена выше в этой же функции (Раунд 116).
        const connectHandle = document.createElement('div');
        connectHandle.className = 'gantt-connect-handle';
        connectHandle.title = 'Перетащите на другую задачу, чтобы создать связь';
        connectHandle.draggable = true;
        connectHandle.addEventListener('mousedown', (e) => e.stopPropagation());
        connectHandle.addEventListener('click', (e) => e.stopPropagation());
        connectHandle.addEventListener('dragstart', (e) => {
            e.stopPropagation();
            e.dataTransfer.effectAllowed = 'link';
            e.dataTransfer.setData('text/plain', taskKey);
        });
        bar.appendChild(connectHandle);

        bar.addEventListener('dragover', (e) => {
            if (!e.dataTransfer.types.includes('text/plain')) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'link';
            bar.classList.add('gantt-bar-drop-target');
        });
        bar.addEventListener('dragleave', () => bar.classList.remove('gantt-bar-drop-target'));
        bar.addEventListener('drop', (e) => {
            e.preventDefault();
            e.stopPropagation();
            bar.classList.remove('gantt-bar-drop-target');
            const fromKey = e.dataTransfer.getData('text/plain');
            if (fromKey && fromKey !== taskKey) this.addDependency(fromKey, taskKey);
        });

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
    // Раунд 130 (иерархия Ганта) - hierarchyOpts (опционально, 8-й
    // параметр) - переиспользует ЭТУ ЖЕ функцию для строк Блока/Стадии
    // (вместо дублирования сотен строк с drag/цветами/итогами в двух
    // новых функциях) - без hierarchyOpts поведение ПОЛНОСТЬЮ прежнее
    // (обычная одноуровневая группа, как было). Форма hierarchyOpts:
    // { getCollapsed, setCollapsed, indentPx, levelLabel, background,
    //   fontWeight, allowRemove }.
    buildGroupHeaderRow(group, groupIndex, numColWidth, timelineWidth, dayWidth, collapsed, anchor, hierarchyOpts = null) {
        const row = document.createElement('div');
        row.className = 'gantt-group-header-row';
        // Раунд 138 (связи между разделами) - тот же приём, что у
        // buildTaskRow() (Раунд 137) - buildDependencyLines() читает
        // ЭТОТ атрибут, чтобы найти вертикальную позицию раздела в уже
        // отрисованном DOM.
        row.dataset.taskKey = `group:${group.name}`;
        row.style.cssText = `
            display: flex;
            align-items: center;
            height: ${ROW_HEIGHT}px;
            border-top: 1px solid var(--md-divider);
            border-bottom: 1px solid var(--md-divider);
            font-weight: ${hierarchyOpts?.fontWeight || 600};
            background: ${hierarchyOpts?.background || 'var(--md-surface-variant)'};
        `;

        // Раунд 100 - тот же sticky-контейнер, что в buildTaskRow().
        // Багфикс (Раунд 101) - var(--md-surface-variant), не
        // var(--md-surface) (см. подробный докстринг в buildTaskRow()).
        const leftGroup = document.createElement('div');
        leftGroup.className = 'gantt-left-sticky gantt-left-sticky-js';
        leftGroup.style.cssText = `display:flex; align-items:center; height:100%; position:relative; left:0; z-index:5; will-change: transform; background:${hierarchyOpts?.background || 'var(--md-surface-variant)'};`;
        row.appendChild(leftGroup);

        // Раунд 147 (по запросу Mr.D: "на строке в фокусе сделаем
        // контекстное меню... Раздел в строку") - строки-группы не
        // имеют собственного понятия "фокус" (в отличие от задач) - ПКМ
        // работает СРАЗУ, но ТОЛЬКО для разделов, полученных ИМЕННО
        // через promoteToSection() (this.promotedNameToKey) - у
        // естественно образовавшихся групп (из нескольких источников
        // или колонки "Группа") нет исходной строки, разворачивать
        // некуда.
        const originKey = group.originKey;
        // Раунд 148 (по жалобе Mr.D: "раздел не может быть в фокусе,
        // чтобы можно было редактировать его колонки") - тот же
        // this._focusedTaskKey, что у задач (единое поле - раздел и
        // задача никогда не фокусируются одновременно) - сравнивается с
        // originKey (НЕ с именем группы - имя может измениться при
        // переименовании, ключ - стабилен).
        const isGroupFocused = originKey && this._focusedTaskKey === originKey;
        if (originKey) {
            leftGroup.addEventListener('click', () => {
                if (!isGroupFocused) {
                    this._focusedTaskKey = originKey;
                    this._rerenderGanttSlot();
                }
            });
            leftGroup.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this._showRowContextMenu(e.clientX, e.clientY, originKey, true);
            });
        }

        // Раунд 116 - спейсер под колонку фокуса (см. buildTaskRow()) -
        // строки групп её не используют, но должны занимать то же место
        // для выравнивания столбцов.
        const focusSpacerG = document.createElement('div');
        focusSpacerG.style.cssText = `width:${FOCUS_COL_WIDTH}px; flex-shrink:0; position:relative; height:100%;`;
        // Раунд 149 (по запросу Mr.D: "давай доделаем строки разделов") -
        // та же ручка, что у сфокусированной строки задачи (Раунд 147) -
        // визуальная согласованность (иначе непонятно, что раздел вообще
        // "в фокусе" - у него нет собственного оформления, кроме
        // редактируемых полей).
        if (isGroupFocused) {
            const handle = document.createElement('div');
            handle.className = 'gantt-row-handle';
            handle.textContent = '⠿';
            handle.title = 'ПКМ - меню раздела (добавить/раздел в строку/удалить). Перетащите - переместить раздел целиком';
            handle.addEventListener('click', (e) => e.stopPropagation());
            // Раунд 188 (по жалобе Mr.D: "перетаскиванию группы не
            // сработало") - НАЙДЕНА причина: у ручки строки задачи
            // (buildTaskRow) drag реализован в Раунде 180, но у ручки
            // ЗАГОЛОВКА РАЗДЕЛА (эта, buildGroupHeaderRow) - НЕТ, она
            // ВСЕГДА была только "глотающей клик" заглушкой
            // (mousedown -> stopPropagation(), без единой строчки
            // логики перетаскивания). Реализовано ТЕМ ЖЕ алгоритмом
            // (поиск точки вставки среди строк-соседей по вертикали,
            // визуальный индикатор), но группа двигается ЦЕЛИКОМ -
            // originKey группы + ключи ВСЕХ вложенных задач рекурсивно
            // (_allTasksRecursive(group), уже в правильном порядке -
            // this.tasks строится обходом дерева в глубину, см.
            // _applyPromotedSections()) - цепочкой overrides, тем же
            // приёмом, что уже применён к перетаскиванию мультивыбора
            // (Раунд 187) - _applyTaskOrderOverrides() (Раунд 180)
            // корректно разворачивает такую цепочку без изменений в
            // самом алгоритме.
            handle.addEventListener('mousedown', (e) => {
                e.stopPropagation();
                if (e.button !== 0) return;
                e.preventDefault();
                const rowsWrap = row.parentElement;
                if (!rowsWrap) return;
                row.classList.add('gantt-row-dragging');
                let dropTargetKey = null;
                let lastMarkedEl = null;

                const clearMark = () => {
                    if (lastMarkedEl) {
                        lastMarkedEl.classList.remove('gantt-row-drop-before', 'gantt-row-drop-after');
                        lastMarkedEl = null;
                    }
                };
                const onMove = (moveEvt) => {
                    const siblingRows = Array.from(rowsWrap.children).filter(el => el.dataset && el.dataset.taskKey);
                    let insertBeforeEl = null;
                    for (const sib of siblingRows) {
                        if (sib === row) continue;
                        const rect = sib.getBoundingClientRect();
                        if (moveEvt.clientY < rect.top + rect.height / 2) { insertBeforeEl = sib; break; }
                    }
                    clearMark();
                    if (insertBeforeEl) {
                        const idx = siblingRows.indexOf(insertBeforeEl);
                        const prevEl = siblingRows[idx - 1];
                        dropTargetKey = (prevEl && prevEl !== row) ? this._resolveDropTargetKey(prevEl.dataset.taskKey) : '__start__';
                        insertBeforeEl.classList.add('gantt-row-drop-before');
                        lastMarkedEl = insertBeforeEl;
                    } else {
                        const lastEl = siblingRows[siblingRows.length - 1];
                        dropTargetKey = (lastEl && lastEl !== row) ? this._resolveDropTargetKey(lastEl.dataset.taskKey) : null;
                        if (lastEl && lastEl !== row) {
                            lastEl.classList.add('gantt-row-drop-after');
                            lastMarkedEl = lastEl;
                        }
                    }
                };
                const onUp = () => {
                    document.removeEventListener('mousemove', onMove);
                    document.removeEventListener('mouseup', onUp);
                    row.classList.remove('gantt-row-dragging');
                    clearMark();
                    const originKey = group.originKey;
                    if (dropTargetKey !== null && dropTargetKey !== originKey) {
                        // Ключи ВСЕЙ группы (заголовок + вложенные
                        // задачи рекурсивно) - точка вставки ВНУТРИ
                        // ЭТОЙ ЖЕ группы (сброс "внутрь себя") -
                        // защита той же формы, что уже применена к
                        // мультивыбору (Раунд 187) - откат без действия,
                        // не пытаемся угадать поведение для этого
                        // случая.
                        const nestedKeys = this._allTasksRecursive(group).map(t => t.taskKey || t.name);
                        const groupKeys = [originKey, ...nestedKeys];
                        // Раунд 189 (по жалобе Mr.D: "перетаскивание
                        // группы не хватает вложенные в группу строки") -
                        // вторая защита - точка вставки НЕ должна
                        // "поглотить" соседнюю обычную задачу или
                        // расщепить ЧУЖУЮ группу (см. докстринг
                        // _wouldGroupDropAbsorb()) - тот же откат без
                        // действия, что и при вставке внутрь себя.
                        if (!groupKeys.includes(dropTargetKey) && !this._wouldGroupDropAbsorb(dropTargetKey, groupKeys)) {
                            let afterKey = dropTargetKey;
                            groupKeys.forEach(k => {
                                this.taskOrderOverrides[k] = afterKey;
                                afterKey = k;
                            });
                            if (window.nodeManager) window.nodeManager.calculateAll();
                            if (window.renderer) window.renderer.updateAllDisplays();
                        }
                    }
                };
                document.addEventListener('mousemove', onMove);
                document.addEventListener('mouseup', onUp);
            });
            focusSpacerG.appendChild(handle);
        }
        leftGroup.appendChild(focusSpacerG);

        // Раунд 130/151 - линии-проводники под уровень вложенности
        // (Блок/Стадия, ИЛИ Раздел/Подраздел) - та же логика, что у
        // buildTaskRow() выше.
        if (hierarchyOpts?.indentPx) {
            const depth = Math.round(hierarchyOpts.indentPx / GROUP_INDENT_PX_CONST);
            for (let d = 0; d < depth; d++) {
                const guide = document.createElement('span');
                guide.className = 'board-widget-tree-guide';
                guide.style.cssText = 'align-self: stretch;';
                leftGroup.appendChild(guide);
            }
        }

        // Стрелка сворачивания - делит место со столбцом номера строки.
        // Раунд 115 (чек-лист, раздел 4) - обёрнута в toggleWrap: при
        // наведении показывает значок удаления ВСЕЙ группы (с
        // подтверждением - см. removeGroup()) - добавления для групп
        // нет (новые группы создаются иначе - переносом задачи в
        // существующую/новую через groupName, не отдельной кнопкой).
        const toggleWrap = document.createElement('div');
        toggleWrap.style.cssText = `position: relative; width: ${numColWidth}px; flex-shrink: 0; height: 100%; display: flex; align-items: center;`;

        const toggle = document.createElement('div');
        toggle.className = 'gantt-group-toggle';
        toggle.style.cssText = `
            width: 100%;
            text-align: center;
            font-size: 10px;
            color: var(--md-text-secondary);
            cursor: pointer;
            user-select: none;
        `;
        toggle.textContent = collapsed ? '▸' : '▾';
        toggle.title = collapsed ? 'Развернуть' : 'Свернуть';
        toggle.addEventListener('mousedown', (e) => e.stopPropagation());
        toggle.addEventListener('click', (e) => {
            e.stopPropagation();
            if (hierarchyOpts) {
                hierarchyOpts.setCollapsed(!collapsed);
            } else {
                this.collapsedGroups[groupIndex] = !collapsed;
            }
            this._rerenderGanttSlot();
        });
        toggleWrap.appendChild(toggle);

        // Раунд 130 - удаление ЦЕЛИКОМ (кнопка "-") для строк Блока/
        // Стадии пока не предлагаем (allowRemove===false) - семантика
        // "удалить целый Блок с вложенными Стадиями" требует отдельного
        // продумывания (чек-лист явно про это не просил) - не
        // усложняем раньше времени, обычные группы это по-прежнему
        // умеют без изменений.
        if (hierarchyOpts?.allowRemove !== false) {
            const removeGroupBtn = document.createElement('button');
            removeGroupBtn.className = 'gantt-small-btn';
            removeGroupBtn.textContent = '−';
            removeGroupBtn.title = 'Удалить группу целиком';
            removeGroupBtn.style.cssText = 'display:none; left:-13px; top:1px;';
            removeGroupBtn.addEventListener('mousedown', (e) => e.stopPropagation());
            removeGroupBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.removeGroup(group);
            });
            toggleWrap.appendChild(removeGroupBtn);
            toggleWrap.addEventListener('mouseenter', () => { removeGroupBtn.style.display = 'flex'; });
            toggleWrap.addEventListener('mouseleave', () => { removeGroupBtn.style.display = 'none'; });
        }

        leftGroup.appendChild(toggleWrap);

        // Раунд 133/148 - колонка "Раздел". Раунд 149 (по запросу Mr.D:
        // "давай доделаем строки разделов") - для разделов, полученных
        // ИМЕННО через promoteToSection() (originKey), теперь
        // редактируема при фокусе - та же логика, что у имени (Раунд
        // 148) - у естественно образовавшихся групп нет исходной строки
        // для хранения override, остаётся простым спейсером.
        if (this.showSectionColumn) {
            if (isGroupFocused && originKey) {
                const sectionInput = document.createElement('input');
                sectionInput.type = 'text';
                sectionInput.className = 'gantt-section-cell gantt-section-input';
                sectionInput.value = this.taskSectionOverrides[originKey] || '';
                sectionInput.style.cssText = `
                    width: ${this._sectionW()}px;
                    flex-shrink: 0;
                    font-size: 10px;
                    color: var(--md-text-secondary);
                    padding-right: 6px;
                    background: transparent;
                    border: none;
                    border-bottom: 1px solid var(--md-accent);
                    font-family: inherit;
                `;
                sectionInput.addEventListener('mousedown', (e) => e.stopPropagation());
                sectionInput.addEventListener('click', (e) => e.stopPropagation());
                sectionInput.addEventListener('change', (e) => {
                    this.taskSectionOverrides[originKey] = e.target.value.trim();
                    if (window.nodeManager) window.nodeManager.calculateAll();
                    if (window.renderer) window.renderer.updateAllDisplays();
                });
                leftGroup.appendChild(sectionInput);
            } else {
                const sectionSpacer = document.createElement('div');
                sectionSpacer.style.cssText = `width:${this._sectionW()}px; flex-shrink:0;`;
                if (originKey && this.taskSectionOverrides[originKey]) {
                    sectionSpacer.textContent = this.taskSectionOverrides[originKey];
                    sectionSpacer.style.cssText += 'font-size:10px; color:var(--md-text-secondary); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; padding-right:6px;';
                }
                leftGroup.appendChild(sectionSpacer);
            }
        }

        const label = (() => {
            // Раунд 148 (по жалобе Mr.D: "раздел не может быть в фокусе,
            // чтобы можно было редактировать его колонки - расчётные
            // колонки редактировать вручную у раздела нельзя") -
            // редактируемое имя раздела при фокусе - ТОЛЬКО для
            // разделов, полученных ИМЕННО через promoteToSection()
            // (originKey существует) - у естественно образовавшихся
            // групп (из нескольких источников/колонки "Группа") нет
            // исходной строки, переименовывать нечего - остаются
            // read-only, как и раньше.
            if (isGroupFocused && originKey) {
                const input = document.createElement('input');
                input.type = 'text';
                input.className = 'gantt-group-header-label gantt-group-header-label-input';
                input.value = group.name;
                input.style.cssText = `
                    width: ${this._labelW() - (hierarchyOpts?.indentPx || 0)}px;
                    flex-shrink: 0;
                    font-size: 11px;
                    color: var(--md-text);
                    padding-right: 6px;
                    background: transparent;
                    border: none;
                    border-bottom: 1px solid var(--md-accent);
                    font-family: inherit;
                `;
                input.addEventListener('mousedown', (e) => e.stopPropagation());
                input.addEventListener('click', (e) => e.stopPropagation());
                input.addEventListener('change', (e) => {
                    const rawNewName = e.target.value.trim();
                    if (!rawNewName || rawNewName === group.name) return;
                    const newName = this._uniqueTaskName(rawNewName);
                    // Та же логика, что переименование задачи (Раунд 116) -
                    // если раздел пришёл из вручную добавленной строки
                    // (manualTasks), пишем напрямую, иначе - в
                    // taskNameOverrides (строка ИЗ источника).
                    const manualTask = this.manualTasks.find(t => t.key === originKey);
                    if (manualTask) {
                        manualTask.name = newName;
                    } else {
                        this.taskNameOverrides[originKey] = newName;
                    }
                    if (window.nodeManager) window.nodeManager.calculateAll();
                    if (window.renderer) window.renderer.updateAllDisplays();
                });
                return input;
            }
            const div = document.createElement('div');
            div.className = 'gantt-group-header-label';
            div.style.cssText = `
                width: ${this._labelW() - (hierarchyOpts?.indentPx || 0)}px;
                flex-shrink: 0;
                font-size: 11px;
                color: var(--md-text);
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
                padding-right: 6px;
            `;
            div.textContent = (hierarchyOpts?.levelLabel ? `${hierarchyOpts.levelLabel} ` : '') + group.name;
            div.title = group.name;
            return div;
        })();
        leftGroup.appendChild(label);

        if (this.showDurationColumn) {
            const totalCell = document.createElement('div');
            totalCell.style.cssText = `
                width: ${this._hoursW()}px;
                flex-shrink: 0;
                font-size: 10px;
                color: var(--md-text-secondary);
                text-align: right;
                padding-right: 6px;
                font-variant-numeric: tabular-nums;
            `;
            totalCell.textContent = this._formatTotalCell(this._allTasksRecursive(group));
            leftGroup.appendChild(totalCell);
        }

        if (this.showWorkingDaysColumn) {
            const workdaysCell = document.createElement('div');
            workdaysCell.style.cssText = `
                width: ${this._workdaysW()}px;
                flex-shrink: 0;
                font-size: 10px;
                color: var(--md-text-secondary);
                text-align: right;
                padding-right: 6px;
                font-variant-numeric: tabular-nums;
            `;
            let workdaysTotal = 0;
            const gTasksWD = this._allTasksRecursive(group);
            if (gTasksWD.length > 0) {
                const gMinStart = Math.min(...gTasksWD.map(t => t.startOffsetDays));
                const gMaxEnd = Math.max(...gTasksWD.map(t => t.startOffsetDays + t.durationDays));
                workdaysTotal = this._countWorkingDaysInRange(anchor, gMinStart, gMaxEnd - gMinStart);
            }
            workdaysCell.textContent = `${Helpers.formatNumber(workdaysTotal)}рд`;
            workdaysCell.title = 'Рабочих дней в диапазоне группы';
            leftGroup.appendChild(workdaysCell);
        }

        // Раунд 187 (по запросу Mr.D: "Ручной ввод дат в Диаграмме
        // Ганта") - для группы это НЕ редактируемое поле (у группы нет
        // единой "своей" даты - только диапазон вложенных задач) -
        // самая РАННЯЯ дата начала/самая ПОЗДНЯЯ дата окончания среди
        // ВСЕХ задач группы, рекурсивно (та же _allTasksRecursive(),
        // что уже использует "Раб.дн." выше).
        if (this.showStartDateColumn) {
            const startDateCell = document.createElement('div');
            startDateCell.style.cssText = `
                width: ${this._startDateW()}px;
                flex-shrink: 0;
                font-size: 10px;
                color: var(--md-text-secondary);
                padding: 0 4px;
                font-variant-numeric: tabular-nums;
            `;
            const gTasksSD = this._allTasksRecursive(group);
            if (gTasksSD.length > 0) {
                const gMinStart = Math.min(...gTasksSD.map(t => t.startOffsetDays));
                startDateCell.textContent = formatISODate(addDays(anchor, gMinStart));
            }
            leftGroup.appendChild(startDateCell);
        }
        if (this.showEndDateColumn) {
            const endDateCell = document.createElement('div');
            endDateCell.style.cssText = `
                width: ${this._endDateW()}px;
                flex-shrink: 0;
                font-size: 10px;
                color: var(--md-text-secondary);
                padding: 0 4px;
                font-variant-numeric: tabular-nums;
            `;
            const gTasksED = this._allTasksRecursive(group);
            if (gTasksED.length > 0) {
                const gMaxEnd = Math.max(...gTasksED.map(t => t.startOffsetDays + t.durationDays));
                endDateCell.textContent = formatISODate(addDays(anchor, gMaxEnd));
            }
            leftGroup.appendChild(endDateCell);
        }

        if (this.showResponsibleColumn) {
            if (isGroupFocused && originKey) {
                const respInput = document.createElement('input');
                respInput.type = 'text';
                respInput.className = 'gantt-responsible-cell gantt-responsible-input';
                respInput.value = this.taskResponsible[originKey] || '';
                respInput.style.cssText = `
                    width: ${this._respW()}px;
                    flex-shrink: 0;
                    font-size: 10px;
                    color: var(--md-text-secondary);
                    padding-right: 6px;
                    background: transparent;
                    border: none;
                    border-bottom: 1px solid var(--md-accent);
                    font-family: inherit;
                `;
                respInput.addEventListener('mousedown', (e) => e.stopPropagation());
                respInput.addEventListener('click', (e) => e.stopPropagation());
                respInput.addEventListener('change', (e) => {
                    this.taskResponsible[originKey] = e.target.value.trim();
                    if (window.nodeManager) window.nodeManager.calculateAll();
                    if (window.renderer) window.renderer.updateAllDisplays();
                });
                leftGroup.appendChild(respInput);
            } else {
                const respSpacer = document.createElement('div');
                respSpacer.style.cssText = `width:${this._respW()}px; flex-shrink:0;`;
                if (originKey && this.taskResponsible[originKey]) {
                    respSpacer.textContent = this.taskResponsible[originKey];
                    respSpacer.style.cssText += 'font-size:10px; color:var(--md-text-secondary); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; padding-right:6px;';
                }
                leftGroup.appendChild(respSpacer);
            }
        }

        if (this.showCalDaysColumn) {
            const calDaysCell = document.createElement('div');
            calDaysCell.style.cssText = `
                width: ${this._calDaysW()}px;
                flex-shrink: 0;
                font-size: 10px;
                color: var(--md-text-secondary);
                text-align: right;
                padding-right: 6px;
                font-variant-numeric: tabular-nums;
            `;
            let calDaysTotal = 0;
            const gTasksCD = this._allTasksRecursive(group);
            if (gTasksCD.length > 0) {
                const gMinStart = Math.min(...gTasksCD.map(t => t.startOffsetDays));
                const gMaxEnd = Math.max(...gTasksCD.map(t => t.startOffsetDays + t.durationDays));
                calDaysTotal = gMaxEnd - gMinStart;
            }
            calDaysCell.textContent = `${Helpers.formatNumber(calDaysTotal)}кд`;
            calDaysCell.title = 'Календарных дней в диапазоне группы';
            leftGroup.appendChild(calDaysCell);
        }

        // Раунд 157 (по запросу Mr.D: "показывают суммарно отработанные
        // дни по всем работам, а не по дате начала и конца в разделе") -
        // ИСТИННАЯ сумма по ВСЕМ задачам раздела, включая вложенные
        // подразделы (_allTasksRecursive()) - в отличие от "Раб.дн."/
        // "Кал.дни" выше (те считают ДИАПАЗОН - от начала самой ранней
        // задачи до конца самой поздней) - у раздела с параллельно
        // идущими задачами эти две величины ЗАМЕТНО различаются.
        if (this.showSumWorkingDaysColumn) {
            const sumWdCell = document.createElement('div');
            sumWdCell.style.cssText = `width:${this._sumWorkdaysW()}px; flex-shrink:0; font-size:10px; color:var(--md-text); text-align:right; padding-right:6px; font-variant-numeric:tabular-nums;`;
            sumWdCell.textContent = String(this._sumWorkdaysForTasks(this._allTasksRecursive(group)));
            sumWdCell.title = 'Сумма реально отработанных рабочих дней по всем задачам раздела';
            leftGroup.appendChild(sumWdCell);
        }
        if (this.showSumHoursColumn) {
            const sumHCell = document.createElement('div');
            sumHCell.style.cssText = `width:${this._sumHoursW()}px; flex-shrink:0; font-size:10px; color:var(--md-text); text-align:right; padding-right:6px; font-variant-numeric:tabular-nums;`;
            sumHCell.textContent = Helpers.formatNumber(this._sumHoursForTasks(this._allTasksRecursive(group)));
            sumHCell.title = 'Сумма реально отработанных человеко-часов по всем задачам раздела';
            leftGroup.appendChild(sumHCell);
        }

        const track = document.createElement('div');
        track.style.cssText = `position: relative; width: ${timelineWidth}px; height: 100%; flex-shrink: 0;`;

        const groupTasksForIndicator = this._allTasksRecursive(group);
        if (groupTasksForIndicator.length > 0) {
            const minStart = Math.min(...groupTasksForIndicator.map(t => t.startOffsetDays));
            const maxEnd = Math.max(...groupTasksForIndicator.map(t => t.startOffsetDays + t.durationDays));
            const indicator = document.createElement('div');
            indicator.className = 'gantt-group-indicator';
            // Багфикс по замечанию Mr.D: раньше каждая группа красилась
            // СВОИМ оттенком (groupTint(), цикл по hue) - "разными
            // цветами", хотя нужен был один нейтральный вид, отличный от
            // цвета САМИХ задач (--md-primary, сплошная заливка) и
            // одновременно похожий по почерку на общее "Итого" (контур +
            // лёгкая заливка), но не сливающийся с ним визуально. Один
            // и тот же голубой контур+заливка для ВСЕХ групп
            // (--gantt-group-indicator-border/-fill) остаётся ДЕФОЛТОМ.
            // Раунд 109 (по запросу Mr.D: "пользовательские цвета для
            // групп... готовая палитра + свой цвет") - если у ЭТОЙ
            // группы назначен цвет в this.groupColors, используем его
            // (контур - сплошной цвет, заливка - его же полупрозрачная
            // версия через _hexToRgba()) вместо дефолтного голубого.
            const groupColor = this.groupColors[group.name];
            const indicatorBorder = groupColor || 'var(--gantt-group-indicator-border, var(--md-primary))';
            const indicatorFill = (groupColor && this._hexToRgba(groupColor, 0.18)) || 'var(--gantt-group-indicator-fill, rgba(144, 202, 249, 0.18))';
            indicator.style.cssText = `
                position: absolute;
                top: 5px; bottom: 5px;
                left: ${minStart * dayWidth}px;
                width: ${Math.max(4, (maxEnd - minStart) * dayWidth)}px;
                background: ${indicatorFill};
                border: 1px solid ${indicatorBorder};
                border-radius: 3px;
                cursor: grab;
            `;
            indicator.title = `${group.name}: ${this._formatTotalCell(this._allTasksRecursive(group))} - перетащите, чтобы сдвинуть всю группу`;
            this.attachGroupDrag(indicator, group, dayWidth);

            // Раунд 138 (по запросу Mr.D: "связи должны работать и
            // между разделами") - тот же приём, что у полосы отдельной
            // задачи (Раунд 137) - "groupKey" (`group:` + имя) как
            // стабильный идентификатор ЦЕЛОЙ группы/Блока/Стадии для
            // связи - см. _resolveEndpointTask() (умеет разворачивать
            // такой ключ обратно в список задач-участников).
            const groupKey = `group:${group.name}`;
            const groupConnectHandle = document.createElement('div');
            groupConnectHandle.className = 'gantt-connect-handle';
            groupConnectHandle.title = 'Перетащите на другую задачу/раздел, чтобы создать связь';
            groupConnectHandle.draggable = true;
            groupConnectHandle.addEventListener('mousedown', (e) => e.stopPropagation());
            groupConnectHandle.addEventListener('click', (e) => e.stopPropagation());
            groupConnectHandle.addEventListener('dragstart', (e) => {
                e.stopPropagation();
                e.dataTransfer.effectAllowed = 'link';
                e.dataTransfer.setData('text/plain', groupKey);
            });
            indicator.appendChild(groupConnectHandle);

            indicator.addEventListener('dragover', (e) => {
                if (!e.dataTransfer.types.includes('text/plain')) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = 'link';
                indicator.classList.add('gantt-bar-drop-target');
            });
            indicator.addEventListener('dragleave', () => indicator.classList.remove('gantt-bar-drop-target'));
            indicator.addEventListener('drop', (e) => {
                e.preventDefault();
                e.stopPropagation();
                indicator.classList.remove('gantt-bar-drop-target');
                const fromKey = e.dataTransfer.getData('text/plain');
                if (fromKey && fromKey !== groupKey) this.addDependency(fromKey, groupKey);
            });

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
                    // Раунд 149 (по жалобе Mr.D: "не работает
                    // перемещение раздела, если он был создан в
                    // диаграмме Ганта, а не подключён к слоту") - тот же
                    // класс бага, что уже чинил для attachBarDrag()/
                    // attachBarResize() (Раунд 145/146/148) - каждая
                    // задача ВНУТРИ раздела могла быть создана вручную
                    // (manualTasks) - если так, пишем НАПРЯМУЮ в
                    // manualTask.startOffsetDays, иначе - как раньше, в
                    // общий this.taskDates (для задач ИЗ источника).
                    // Раунд 151 (по запросу Mr.D: "родительский список
                    // это иерархическая сумма всех дочерних") -
                    // перетаскивание РОДИТЕЛЬСКОГО раздела ОБЯЗАНО
                    // сдвигать задачи ВСЕХ вложенных подразделов
                    // (_allTasksRecursive), не только его СОБСТВЕННЫЕ
                    // прямые group.tasks - иначе вложенные подразделы
                    // "отставали бы", визуально разваливая структуру.
                    this._allTasksRecursive(group).forEach(task => {
                        const current = this.taskDates[task.taskKey] ?? task.startOffsetDays;
                        const newStart = Math.max(0, current + deltaDays);
                        const manualTask = this.manualTasks.find(t => t.key === task.taskKey);
                        if (manualTask) {
                            manualTask.startOffsetDays = newStart;
                        } else {
                            this.taskDates[task.taskKey] = newStart;
                        }
                    });
                    // Раунд 139 - тот же принцип, что у attachBarDrag() -
                    // если ЭТОТ раздел ("group:Имя") - цель какой-то
                    // связи, пересчитываем её gap под новую позицию,
                    // вместо того чтобы _applyDependencyConstraints()
                    // тут же вернул раздел на старое место.
                    const groupAllTasksForDrag = this._allTasksRecursive(group);
                    const newMinStart = Math.min(...groupAllTasksForDrag.map(t => this.taskDates[t.taskKey] ?? t.startOffsetDays));
                    this._rebaseDependencyGapsForTarget(`group:${group.name}`, newMinStart);
                    if (window.nodeManager) window.nodeManager.calculateAll();
                    if (window.renderer) window.renderer.updateAllDisplays();
                }
            };
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        });
    }

    // Раунд 147 (по запросу Mr.D: "на строке в фокусе сделаем
    // контекстное меню по нажатию на ПКМ - [Добавить строку, Строку в
    // раздел, Раздел в строку, удалить]") - самодостаточное меню, НЕ
    // переиспользует глобальный #contextMenu (тот жёстко привязан к
    // операциям над самими нодами графа - свернуть/удалить/дублировать
    // ноду, см. main.js/nodeManager.js - GanttNode строит СВОЙ,
    // изолированный DOM-элемент). Пункты подбираются ПО КОНТЕКСТУ: у
    // обычной задачи - "Строку в раздел" (не "Раздел в строку" - она не
    // раздел); у РАЗДЕЛА, полученного ИМЕННО через promoteToSection()
    // (не у естественно образовавшейся группы из нескольких источников -
    // у той нет исходной "строки", в которую разворачивать назад) -
    // "Раздел в строку" вместо "Строку в раздел".
    _showRowContextMenu(clientX, clientY, taskKey, isPromotedSection) {
        this._closeRowContextMenu();

        const menu = document.createElement('div');
        menu.className = 'gantt-row-context-menu';
        menu.style.cssText = `position: fixed; left: ${clientX}px; top: ${clientY}px; z-index: 10000;`;

        const addItem = (label, handler) => {
            const item = document.createElement('div');
            item.className = 'gantt-row-context-menu-item';
            item.textContent = label;
            item.addEventListener('mousedown', (e) => e.stopPropagation());
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                this._closeRowContextMenu();
                handler();
            });
            menu.appendChild(item);
        };

        addItem('➕ Добавить строку', () => this.addTaskAfter(taskKey));
        if (isPromotedSection) {
            // Раунд 150 - "Подраздел" на УЖЕ существующем разделе
            // (promoteToSubsection на его же ключе) означает "углубить
            // ещё на 1 уровень" (см. докстринг promoteToSubsection()).
            addItem('📂 Углубить (сделать подразделом)', () => this.promoteToSubsection(taskKey));
            addItem('📤 Раздел в строку', () => this.demoteFromSection(taskKey));
        } else {
            addItem('📁 Строку в раздел', () => this.promoteToSection(taskKey));
            addItem('📂 Строку в подраздел', () => this.promoteToSubsection(taskKey));
        }
        addItem('🗑️ Удалить', () => {
            if (isPromotedSection) this.demoteFromSection(taskKey);
            this.removeTask(taskKey);
        });
        // Раунд 188 (по запросу Mr.D: "удалить группу со всеми
        // вложениями") - только для раздела (isPromotedSection) - для
        // обычной строки задачи "вложений" не существует, пункт был бы
        // бессмысленным дублем обычного "Удалить" выше.
        if (isPromotedSection) {
            addItem('🗑️📦 Удалить раздел со всеми вложениями', () => this._deleteGroupWithContents(taskKey));
        }
        // Раунд 188 (по запросу Mr.D: "свернуть все группы и
        // развернуть все группы добавим в контекстное меню") -
        // глобальные действия (не привязаны к КОНКРЕТНОЙ строке/группе,
        // на которой открыто меню) - доступны из ОБОИХ контекстов
        // (обычная строка и раздел) одинаково, раз действие всё равно
        // применяется ко всей диаграмме целиком.
        addItem('📖 Развернуть все группы', () => {
            this._expandAllGroups();
            this._rerenderGanttSlot();
        });
        addItem('📕 Свернуть все группы', () => {
            this._collapseAllGroups();
            this._rerenderGanttSlot();
        });

        document.body.appendChild(menu);
        this._rowContextMenuEl = menu;

        // Закрытие по клику мимо - тот же приём, что у глобального
        // #contextMenu (см. main.js). Раунд 188 (по жалобе Mr.D:
        // "контекстное меню не закрывается при клике вне") - CAPTURE-
        // фаза ({capture: true}), не всплытие - множество элементов
        // диаграммы (ручки, поля ввода других строк) сами вызывают
        // stopPropagation() на СВОЁМ mousedown, что раньше не давало
        // событию дойти до document на фазе всплытия вовсе - на фазе
        // перехвата это уже не имеет значения (та срабатывает РАНЬШЕ).
        const closeOnOutsideClick = (e) => {
            if (!menu.contains(e.target)) this._closeRowContextMenu();
        };
        setTimeout(() => document.addEventListener('mousedown', closeOnOutsideClick, { once: true, capture: true }), 0);
    }

    _closeRowContextMenu() {
        if (this._rowContextMenuEl) {
            this._rowContextMenuEl.remove();
            this._rowContextMenuEl = null;
        }
    }

    // Лёгкая перерисовка ТОЛЬКО области диаграммы (не всей ноды и не
    // пересчёт графа) - для чисто визуальных переключений вроде
    // сворачивания группы/фокуса строки, где данные не меняются. Тот же
    // приём, что _rebuildGrid() у CalendarNode.
    //
    // Раунд 170 (по жалобе Mr.D: "навигация теперь работает на Доске, но
    // по-прежнему не получается выделять строку мышкой. Срабатывает
    // только 1 раз при первой инициации, потом выделение курсором не
    // работает") - причина ТОГО ЖЕ семейства, что чинил в Раунде 169
    // для клавиатурной навигации, но здесь ПРОЩЕ: клик по строке (как и
    // сворачивание группы, кнопки +/- и т.п. - ВСЕГО 15 мест вызова
    // этого метода) НЕ меняет данные и НЕ вызывает calculateAll() -
    // только это метод и должен был обновить экран. Раньше он трогал
    // ИСКЛЮЧИТЕЛЬНО холстовую ноду (`[data-node-id=...]`) - для виджета
    // на Доске эффекта не было ВООБЩЕ (не единожды, а НИКОГДА - "сработал
    // 1 раз" объясняется тем, что САМЫЙ первый клик обычно СОВПАДАЕТ с
    // каким-то ДРУГИМ, уже отложенным рендером Доски, случайно
    // подхватившим новое состояние). Фикс - тот же приём, что уже
    // применён к CalendarNode._rebuildGrid() (Раунд 164) - обновляем
    // ОБА места разом, если они есть в DOM: и холстовую ноду (как
    // раньше), и видимый ПРЯМО СЕЙЧАС виджет на Доске (СИНХРОННО, не
    // через setTimeout - здесь, в отличие от Раунда 169, НЕТ гонки с
    // отложенным flush(), потому что flush() тут просто НЕ УЧАСТВУЕТ:
    // ни один из 15 вызовов не меняет данные).
    _rerenderGanttSlot() {
        const el = document.querySelector(`[data-node-id="${this.id}"] .gantt-container-slot`);
        if (el) this._replaceGanttSlot(el, false);

        const widgetBodyEl = document.querySelector(`.board-widget[data-widget-id="${this.id}"] .board-widget-body`);
        if (widgetBodyEl) this._replaceGanttSlot(widgetBodyEl, true);
    }

    // Раунд 107 (по жалобе Mr.D: "после изменения элемента позиция
    // внутри графика сбрасывается в начало") - createGanttArea()
    // полностью пересоздаёт DOM при КАЖДОМ пересчёте (перетаскивание/
    // растягивание задачи, редактирование "Раб.дн." и т.п. - любое
    // изменение, вызывающее calculateAll()) - .gantt-outer-scroll
    // (горизонтальный скролл)/.gantt-rows-scroll (вертикальный) каждый
    // раз оказываются НОВЫМИ DOM-элементами, чей scrollLeft/scrollTop
    // по умолчанию 0 - пользовательская позиция просмотра (например,
    // прокрутка к нужному месяцу) терялась при любом изменении. Общий
    // хелпер - запоминает позицию из СТАРОГО DOM перед пересборкой,
    // восстанавливает в НОВОМ после - используется и здесь
    // (_rerenderGanttSlot(), лёгкая перерисовка), и в updateDisplay()
    // (после полного пересчёта).
    _replaceGanttSlot(slotEl, isWidget = false) {
        const oldOuter = slotEl.querySelector('.gantt-outer-scroll');
        const oldRowsWrap = slotEl.querySelector('.gantt-rows-scroll');
        const scrollLeft = oldOuter ? oldOuter.scrollLeft : 0;
        const scrollTop = oldRowsWrap ? oldRowsWrap.scrollTop : 0;

        slotEl.innerHTML = '';
        // createGanttArea() возвращает САМ .gantt-outer-scroll (не
        // обёртку вокруг него) - см. её докстринг. isWidget передаётся
        // дальше - виджет несёт СВОЮ ручку растягивания (Раунд 166) и
        // читает this.widgetWrapHeight, а не this.wrapHeight.
        const newOuter = this.createGanttArea(isWidget);
        slotEl.appendChild(newOuter);

        if (scrollLeft) newOuter.scrollLeft = scrollLeft;
        if (scrollTop) {
            const newRowsWrap = newOuter.querySelector('.gantt-rows-scroll');
            if (newRowsWrap) newRowsWrap.scrollTop = scrollTop;
        }
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
    // Багфикс (Раунд 101, по жалобе Mr.D: "в строке Итого столбец ч.ч.
    // отображает 'дн' вместо 'ч'"). Раньше здесь была развилка по
    // this.durationUnit (Раунд 79) - при 'days' показывала "дн", что
    // противоречило самому названию столбца ("ч.ч." - часы, не дни) и
    // сбивало с толку. Столбец ВСЕГДА в часах, без исключений - для
    // ОБЫЧНЫХ строк задач так было и раньше (Раунд 78), теперь и здесь
    // (используется и в buildTotalRow(), и в buildGroupHeaderRow() -
    // единая точка, фикс применяется сразу везде).
    // Раунд 109 - автообнаружение ВСЕХ имён ответственных/групп,
    // встреченных в this.tasks/this.taskGroups - НЕ назначает цвет
    // автоматически, только заводит запись '' в responsibleColors/
    // groupColors, если её ещё нет (чтобы имя появилось в панели для
    // явного выбора пользователем) - тот же принцип, что автообнаружение
    // цветов в GanttTableProcessorNode (Раунд 97).
    _detectResponsiblesAndGroups() {
        const responsibles = new Set();
        (this.tasks || []).forEach(t => { const r = this._effectiveResponsible(t); if (r) responsibles.add(r); });
        this._detectedResponsibles = [...responsibles].sort();
        this._detectedResponsibles.forEach(name => {
            if (!(name in this.responsibleColors)) this.responsibleColors[name] = '';
        });

        // Раунд 152 (по жалобе Mr.D: "окрашивается только корневой
        // раздел, нужно чтобы окрашивались все разделы в иерархии") -
        // раньше обход был ТОЛЬКО по верхнему уровню this.taskGroups -
        // вложенные подразделы (group.subgroups) никогда не попадали в
        // groups, значит никогда не появлялись в панели выбора цвета
        // инспектора - рекурсивный обход собирает имена ВСЕХ уровней
        // вложенности разом.
        const groups = new Set();
        const collectGroupNames = (list) => {
            (list || []).forEach(g => {
                if (g.name) groups.add(g.name);
                collectGroupNames(g.subgroups);
            });
        };
        collectGroupNames(this.taskGroups);
        this._detectedGroups = [...groups].sort();
        this._detectedGroups.forEach(name => {
            if (!(name in this.groupColors)) this.groupColors[name] = '';
        });
    }

    // Раунд 109 - HEX ("#RRGGBB") -> "rgba(r,g,b,alpha)". Нужен для
    // заливки индикатора группы (полупрозрачная версия пользовательского
    // цвета, не сплошная - тот же почерк, что был у дефолтного голубого).
    _hexToRgba(hex, alpha) {
        const clean = (hex || '').replace('#', '');
        if (clean.length !== 6) return null;
        const r = parseInt(clean.slice(0, 2), 16);
        const g = parseInt(clean.slice(2, 4), 16);
        const b = parseInt(clean.slice(4, 6), 16);
        if ([r, g, b].some(Number.isNaN)) return null;
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }

    // Багфикс (Раунд 101, по жалобе Mr.D: "в строке Итого столбец ч.ч.
    // отображает 'дн' вместо 'ч'"). Столбец ВСЕГДА в часах, без
    // исключений - используется и в buildTotalRow(), и в
    // buildGroupHeaderRow() - единая точка.
    // Раунд 115 (чек-лист, раздел 4: "если это группа с дочерними
    // элементами -> запрос подтверждения") - удаляет ВСЕ задачи группы
    // (каждую - тем же путём, что removeTask(): вручную добавленные
    // убираются из manualTasks, пришедшие из источника - в
    // deletedTaskKeys). confirm() уже используется в проекте (main.js/
    // layoutManager.js) - тот же приём.
    // Раунд 137 (чек-лист "Связи между задачами") - добавляет связь
    // (from заканчивается -> to начинается). Не даёт создать дубликат
    // (та же пара уже есть) и петлю "сама на себя" (проверка fromKey!==
    // toKey - уже на стороне вызова, в обработчике drop, но проверяем и
    // здесь на случай будущих других вызывающих мест).
    // Раунд 138 (по запросу Mr.D: "связи должны работать и между
    // разделами") - разворачивает ЛЮБОЙ ключ конца связи (обычный
    // taskKey ОДНОЙ задачи, ИЛИ "group:ИмяРаздела" - ЦЕЛОГО раздела) в
    // единый вид: {startOffsetDays, durationDays, memberTasks} -
    // memberTasks - массив ССЫЛОК на реальные объекты задач (для
    // одиночной задачи - массив из одного элемента, для раздела - ВСЕ
    // задачи внутри него, включая вложенные Стадии - см.
    // _tasksInSection()) - и для отрисовки линии (нужны только даты),
    // и для распространения сдвига (нужны сами объекты, чтобы сдвинуть
    // ВЕСЬ раздел разом).
    _resolveEndpointTask(key) {
        if (key.startsWith('group:')) {
            const sectionName = key.slice('group:'.length);
            const members = this._tasksInSection(sectionName);
            if (members.length === 0) return null;
            const minStart = Math.min(...members.map(t => t.startOffsetDays));
            const maxEnd = Math.max(...members.map(t => t.startOffsetDays + t.durationDays));
            return { startOffsetDays: minStart, durationDays: maxEnd - minStart, memberTasks: members };
        }
        const task = (this.tasks || []).find(t => (t.taskKey || t.name) === key);
        if (!task) return null;
        return { startOffsetDays: task.startOffsetDays, durationDays: task.durationDays, memberTasks: [task] };
    }

    // Раунд 138 - все задачи, чьё groupName/blockName/stageName
    // совпадает с sectionName (покрывает И обычную одноуровневую
    // группировку - Раунд 78, И иерархию Блок/Стадия - Раунд 130/132 -
    // единая функция вместо трёх похожих проверок в разных местах).
    _tasksInSection(sectionName) {
        return (this.tasks || []).filter(t =>
            t.groupName === sectionName || t.blockName === sectionName || t.stageName === sectionName
        );
    }

    // Раунд 138 (по прямому уточнению Mr.D: "главная задача связи, что
    // диаграмма в которую пришла связь двигается вместе с той откуда
    // связь пришла, подстраиваясь под её конечную дату - расстояние
    // между конечной датой откуда пришла связь и датой начала куда
    // пришла связь должно сохраняться") - после того, как ВСЕ обычные
    // пересчёты (даты/override/ручные правки) уже применены, проходит
    // по this.dependencies и СДВИГАЕТ startOffsetDays цели так, чтобы
    // расстояние (dep.gap - зафиксировано в МОМЕНТ создания связи, см.
    // addDependency()) между концом источника и началом цели
    // сохранялось. Несколько проходов подряд - для распространения по
    // ЦЕПОЧКАМ (А->Б->В - сдвиг А должен докатиться до В через Б, даже
    // если connections перечислены не по порядку цепочки).
    // Раунд 139 (по уточнению Mr.D: "зависимость в одну сторону, по
    // направлению стрелки") - при РУЧНОМ перемещении задачи/раздела,
    // которые являются ЦЕЛЬЮ хотя бы одной связи, пересчитывает gap
    // ДЛЯ ЭТИХ связей под НОВУЮ позицию (вместо того, чтобы
    // _applyDependencyConstraints() на следующем пересчёте жёстко
    // вернул её на старое место, "блокируя" ручное перемещение).
    // targetKey - taskKey ОБЫЧНОЙ задачи ИЛИ "group:Имя" раздела -
    // должен буквально совпадать с dep.to (сравнение строк).
    _rebaseDependencyGapsForTarget(targetKey, newStartOffset) {
        this.dependencies.forEach(dep => {
            if (dep.to !== targetKey) return;
            const from = this._resolveEndpointTask(dep.from);
            if (!from) return;
            dep.gap = newStartOffset - (from.startOffsetDays + from.durationDays);
        });
    }

    _applyDependencyConstraints() {
        if (!this.dependencies || this.dependencies.length === 0) return;
        // Раунд 140 (по жалобе Mr.D: "при расчёте по рабочим дням,
        // когда устанавливаем зависимость у дочернего элемента, теряется
        // приоритет переноса даты с выходного дня") - обычное
        // планирование (см. calculate() ниже, `startOffsetDays =
        // nextWorkingOffset(...)`) ВСЕГДА "прилипает" к ближайшему
        // рабочему дню - но связь двигает задачу ЧИСТОЙ АРИФМЕТИКОЙ
        // (start += delta) уже ПОСЛЕ этого шага, теряя правило.
        // Применяем ТО ЖЕ nextWorkingOffset() к вычисленной позиции цели.
        const anchor = parseISODate(this.startDate) || new Date();
        const passes = this.dependencies.length + 1;
        for (let pass = 0; pass < passes; pass++) {
            this.dependencies.forEach(dep => {
                const from = this._resolveEndpointTask(dep.from);
                const to = this._resolveEndpointTask(dep.to);
                if (!from || !to) return;
                let desiredStart = from.startOffsetDays + from.durationDays + (dep.gap ?? 0);
                desiredStart = nextWorkingOffset(anchor, desiredStart, this.holidaySet);
                const delta = desiredStart - to.startOffsetDays;
                if (delta === 0) return;
                // Раунд 143 (по жалобе Mr.D: "растягивание дочерних
                // задач - корректировка длины происходит только у
                // родителя, дочерние элементы могут закончиться в
                // нерабочий день") - раньше здесь ТОЛЬКО сдвигался
                // startOffsetDays (чистая арифметика), а durationDays
                // (календарная ширина) оставалась ЗАСТЫВШЕЙ от СТАРОЙ
                // позиции - на новом месте те же выходные/праздники
                // могут падать СОВСЕМ на другие дни недели относительно
                // задачи, из-за чего конец мог оказаться прямо на
                // выходном - ровно та же корректировка (nextWorkingOffset
                // -> spanWorkingDays), что обычное планирование ВСЕГДА
                // делает для родителя, здесь применяется К КАЖДОЙ
                // дочерней задаче ЗАНОВО, а не наследуется "как было".
                //
                // "Сколько РАБОЧИХ дней задача реально занимает" не
                // хранится на самом объекте задачи универсально для всех
                // трёх режимов (список/таблица/дерево) - вместо этого
                // ВЫЧИСЛЯЕМ его из уже известной (пока ещё старой)
                // календарной ширины через _countWorkingDaysInRange() -
                // работает одинаково независимо от режима-источника.
                to.memberTasks.forEach(t => {
                    const workDays = this._countWorkingDaysInRange(anchor, t.startOffsetDays, t.durationDays);
                    const newStart = nextWorkingOffset(anchor, t.startOffsetDays + delta, this.holidaySet);
                    const newEnd = spanWorkingDays(anchor, newStart, workDays, this.holidaySet);
                    t.startOffsetDays = newStart;
                    t.durationDays = Math.max(0, newEnd - newStart);
                });
            });
        }
    }

    addDependency(fromKey, toKey) {
        if (!fromKey || !toKey || fromKey === toKey) return;
        const exists = this.dependencies.some(d => d.from === fromKey && d.to === toKey);
        if (exists) return;
        // Раунд 138 - зазор фиксируется В МОМЕНТ создания связи (текущее
        // расстояние между концом источника и началом цели) - именно
        // ЕГО _applyDependencyConstraints() будет сохранять при каждом
        // следующем пересчёте, что бы ни случилось с датами источника.
        const from = this._resolveEndpointTask(fromKey);
        const to = this._resolveEndpointTask(toKey);
        const gap = (from && to) ? (to.startOffsetDays - (from.startOffsetDays + from.durationDays)) : 0;
        this.dependencies.push({ from: fromKey, to: toKey, gap });
        if (window.nodeManager) window.nodeManager.calculateAll();
        if (window.renderer) window.renderer.updateAllDisplays();
    }

    removeDependency(fromKey, toKey) {
        const idx = this.dependencies.findIndex(d => d.from === fromKey && d.to === toKey);
        if (idx === -1) return;
        this.dependencies.splice(idx, 1);
        if (window.nodeManager) window.nodeManager.calculateAll();
        if (window.renderer) window.renderer.updateAllDisplays();
    }

    removeGroup(group) {
        const count = group.tasks.length;
        if (count > 0 && !confirm(`Удалить группу "${group.name}" вместе со всеми задачами (${count} шт.)?`)) return;
        group.tasks.forEach(t => {
            const key = t.taskKey || t.name;
            const manualIdx = this.manualTasks.findIndex(m => m.key === key);
            if (manualIdx >= 0) {
                this.manualTasks.splice(manualIdx, 1);
            } else if (!this.deletedTaskKeys.includes(key)) {
                this.deletedTaskKeys.push(key);
            }
        });
        if (window.nodeManager) window.nodeManager.calculateAll();
        if (window.renderer) window.renderer.updateAllDisplays();
    }

    // Раунд 151 (по запросу Mr.D: "родительский список это иерархическая
    // сумма всех дочерних... начало подзадачи 1 и конец подзадачи 2, и
    // так по всей иерархии потомков") - собирает задачи группы, включая
    // ВСЕ вложенные подразделы любой глубины (не только прямые
    // group.tasks) - используется везде, где считается диапазон/итог
    // раздела (индикатор-полоса, ч.ч./Раб.дн., перетаскивание целиком).
    _allTasksRecursive(group) {
        return [...group.tasks, ...(group.subgroups || []).flatMap(sg => this._allTasksRecursive(sg))];
    }

    // Раунд 188 (багфикс, найден при реализации перетаскивания группы
    // за ручку) - data-task-key у строки-заголовка ГРУППЫ хранит
    // `group:Имя` (Раунд 137/149, формат ОТДЕЛЬНОГО, более старого
    // механизма - связи-зависимости между задачами/разделами, см.
    // _resolveEndpointTask() - ищет ПО ИМЕНИ, не по originKey - трогать
    // этот формат нельзя, он используется широко). Но
    // _applyTaskOrderOverrides() (Раунд 180) оперирует РЕАЛЬНЫМИ
    // ключами задач (originKey группы, не "group:Имя") - без этой
    // трансляции точка вставки, вычисленная РЯДОМ С ДРУГИМ заголовком
    // группы, указывала бы на несуществующий в this.tasks ключ, и
    // override молча проваливался бы (см. fallback "в конец" в
    // _applyTaskOrderOverrides()). Используется В ОБОИХ обработчиках
    // перетаскивания (строка задачи, Раунд 180 - и заголовок группы,
    // Раунд 188), раз оба могут оказаться рядом с ЛЮБЫМ типом строки.
    _resolveDropTargetKey(rawKey) {
        if (rawKey && rawKey.startsWith('group:')) {
            const sectionName = rawKey.slice('group:'.length);
            return this.promotedNameToKey.get(sectionName) || rawKey;
        }
        return rawKey;
    }

    // Раунд 189 (по жалобе Mr.D: "перетаскивание группы не хватает
    // вложенные в группу строки") - НАЙДЕНА причина при тестировании:
    // раздел в этой системе "открыт" (поглощает ВСЕ последующие задачи),
    // пока не встретит СЛЕДУЮЩИЙ маркер раздела - явной "границы конца"
    // не существует (см. докстринг _applyPromotedSections()). Если
    // после переноса группы прямо ЗА её последней вложенной задачей
    // оказывается ОБЫЧНАЯ задача (не заголовок ДРУГОГО раздела) - та
    // задача молча становится частью перенесённой группы, хотя
    // должна была остаться отдельной строкой. ТА ЖЕ проблема грозит и
    // при попытке бросить группу ПОСРЕДИ списка задач ДРУГОЙ группы -
    // это "расщепило" бы чужую группу, а хвост её задач так же молча
    // поглотился бы перенесённой. Обе ситуации сводятся к ОДНОЙ
    // проверке: что идёт СРАЗУ ПОСЛЕ точки вставки, если пропустить
    // ключи САМОЙ перемещаемой группы (та физически ещё стоит на
    // старом месте, могла случайно оказаться "соседом" точки вставки) -
    // если это ОБЫЧНАЯ задача (не сама точка входа в другой раздел) -
    // вставка небезопасна.
    _wouldGroupDropAbsorb(dropTargetKey, groupKeys) {
        let startIdx;
        if (dropTargetKey === '__start__') {
            startIdx = 0;
        } else {
            const idx = this.tasks.findIndex(t => (t.taskKey || t.name) === dropTargetKey);
            if (idx === -1) return false; // цель не найдена - решать нечего, пусть остальная логика сама разберётся
            startIdx = idx + 1;
        }
        for (let i = startIdx; i < this.tasks.length; i++) {
            const key = this.tasks[i].taskKey || this.tasks[i].name;
            if (groupKeys.includes(key)) continue; // сама перемещаемая группа - не считается "соседом"
            return !this.promotedSectionKeys.has(key);
        }
        return false; // дальше по списку ничего нет - конец, безопасно
    }

    // Раунд 187 (по запросу Mr.D: "Кнопка 'Раскрыть всё' в Диаграмме
    // Ганта - раскрывает все дочерние элементы строк") - обходит
    // дерево групп/подгрупп РЕКУРСИВНО (та же структура, что уже
    // проходит _allTasksRecursive() выше) - выставляет
    // collapsedGroups[collapseKey]=false КАЖДОЙ группе на любой
    // глубине вложенности, не только верхнего уровня.
    // Раунд 188 (по запросу Mr.D: "свернуть все группы и развернуть все
    // группы добавим в контекстное меню") - обходит дерево групп/
    // подгрупп РЕКУРСИВНО (та же структура, что уже проходит
    // _allTasksRecursive() выше) - выставляет
    // collapsedGroups[collapseKey]=false КАЖДОЙ группе на любой
    // глубине вложенности, не только верхнего уровня.
    //
    // Багфикс (сразу по факту первого теста) - реальный ключ,
    // используемый ОТРИСОВКОЙ (см. renderGroupRecursive() выше по
    // файлу), - ЦЕПОЧКА `group.collapseKey || group.originKey ||
    // позиционный индекс`, а НЕ ТОЛЬКО collapseKey - то поле есть
    // ИСКЛЮЧИТЕЛЬНО у групп, построенных через _groupsFromTreeData()/
    // _groupsFromNameMarkers() (иерархия Блок/Стадия) - у групп из
    // системы "Раздел"/"Подраздел" (promoteToSection(), САМЫЙ частый
    // способ создать группу вручную) этого поля просто НЕТ - раньше
    // проверка `if (g.collapseKey)` тихо ПРОПУСКАЛА такие группы
    // целиком, кнопка/пункты меню не действовали на них вообще.
    // Позиционный индекс - ОБЩИЙ счётчик на ВЕСЬ обход дерева (не
    // сбрасывается на каждом уровне) - та же семантика, что у
    // groupIndex++ в самой отрисовке.
    _expandAllGroups() {
        let index = 0;
        const walk = (groups) => {
            (groups || []).forEach(g => {
                const collapseKey = g.collapseKey || g.originKey || (index++);
                this.collapsedGroups[collapseKey] = false;
                walk(g.subgroups);
            });
        };
        walk(this.taskGroups);
    }

    // Раунд 188 (по запросу Mr.D: "свернуть все группы и развернуть все
    // группы добавим в контекстное меню") - зеркало _expandAllGroups()
    // выше, тот же обход и та же цепочка ключа, только
    // collapsedGroups=true.
    _collapseAllGroups() {
        let index = 0;
        const walk = (groups) => {
            (groups || []).forEach(g => {
                const collapseKey = g.collapseKey || g.originKey || (index++);
                this.collapsedGroups[collapseKey] = true;
                walk(g.subgroups);
            });
        };
        walk(this.taskGroups);
    }

    // Раунд 188 (по запросу Mr.D: "удалить группу со всеми
    // вложениями") - находит группу ПО ЕЁ originKey (та же
    // идентификация, что использует остальной код группировки, см.
    // докстринг _applyPromotedSections()), собирает ключи ВСЕХ
    // вложенных задач РЕКУРСИВНО (та же _allTasksRecursive(), что уже
    // применяют "Раб.дн."/агрегаты колонок дат) - удаляет каждую ТОЙ ЖЕ
    // логикой, что и removeTask() (manualTasks.splice или
    // deletedTaskKeys.push), но БЕЗ отдельного calculateAll() на
    // КАЖДУЮ (removeTask() сам его вызывает - здесь один общий
    // пересчёт в конце, не N). Сам заголовок раздела - тоже задача
    // (просто визуально изъятая из this.tasks через promotedSectionKeys,
    // физически всё ещё существует как строка) - удаляется той же
    // логикой + выходит из promotedSectionKeys/sectionLevels.
    _deleteGroupWithContents(groupKey) {
        const findGroup = (groups) => {
            for (const g of groups || []) {
                if (g.originKey === groupKey) return g;
                const found = findGroup(g.subgroups);
                if (found) return found;
            }
            return null;
        };
        const group = findGroup(this.taskGroups);
        if (!group) return;

        const removeByKey = (key) => {
            const manualIdx = this.manualTasks.findIndex(t => t.key === key);
            if (manualIdx >= 0) {
                this.manualTasks.splice(manualIdx, 1);
            } else if (!this.deletedTaskKeys.includes(key)) {
                this.deletedTaskKeys.push(key);
            }
        };

        this._allTasksRecursive(group).forEach(t => removeByKey(t.taskKey || t.name));
        removeByKey(groupKey);
        this.promotedSectionKeys.delete(groupKey);
        this.sectionLevels.delete(groupKey);

        if (window.nodeManager) window.nodeManager.calculateAll();
        if (window.renderer) window.renderer.updateAllDisplays();
    }

    _formatTotalCell(tasks) {
        const hours = tasks.reduce((sum, t) => sum + t.durationDays * HOURS_PER_WORKDAY, 0);
        return `${Helpers.formatNumber(hours)}ч`;
    }

    // Раунд 109 - "эффективный" ответственный задачи: ручное
    // переопределение (this.taskResponsible, Раунд 83) в приоритете,
    // иначе - значение из данных источника (task.responsible) - тот же
    // принцип, что уже применён в ячейке "Ответственный" и выходной
    // таблице (buildOutputTable()) - переиспользуется здесь, чтобы цвет
    // полосы совпадал с тем, что реально показано в колонке.
    _effectiveResponsible(task) {
        return this.taskResponsible[task.taskKey] || task.responsible || '';
    }

    // Раунд 136 - тот же принцип, что _effectiveResponsible(), для
    // колонки "Раздел": ручное переопределение (this.taskSectionOverrides)
    // в приоритете, иначе - sectionNumber из данных источника (сырое
    // значение № п/п строки, см. GanttTableProcessorNode).
    _effectiveSection(task) {
        return this.taskSectionOverrides[task.taskKey] || task.sectionNumber || '';
    }

    // Раунд 153 (по запросу Mr.D: "строки с задачами должны окрашиваться
    // в цвет раздела. Сейчас разделы меняют цвет а задачи остаются по
    // умолчанию") - единая точка поиска цвета задачи (используется и
    // самой полосой на диаграмме - buildTaskRow() ниже, и экспортом в
    // Excel - ganttCalendarExport.js). Приоритет: цвет ОТВЕТСТВЕННОГО
    // (если назначен) -> цвет БЛИЖАЙШЕГО ПОКРАШЕННОГО раздела в цепочке
    // предков (от самого глубокого К КОРНЮ, не наоборот - "наследование
    // сверху вниз" по умолчанию, но явно покрашенный БЛИЖНИЙ уровень
    // важнее дальнего) -> null (вызывающий код сам решает дефолт - CSS-
    // переменная для полосы на экране, HEX-константа для экспорта).
    _colorForTask(task) {
        const responsible = this._effectiveResponsible(task);
        if (responsible && this.responsibleColors[responsible]) return this.responsibleColors[responsible];
        const chain = task.groupChain || (task.groupName ? [task.groupName] : []);
        for (let i = chain.length - 1; i >= 0; i--) {
            if (this.groupColors[chain[i]]) return this.groupColors[chain[i]];
        }
        return null;
    }

    // Раунд 115 (чек-лист, раздел 4) - применяет ручные правки
    // (manualTasks/deletedTaskKeys) ПОВЕРХ уже построенных this.tasks
    // (не важно, из какого источника - список/таблица/группы) - единая
    // точка, вызывается перед _detectResponsiblesAndGroups() во ВСЕХ 4
    // точках завершения calculate() (см. её же комментарии).
    _applyManualRowEdits() {
        if (this.deletedTaskKeys.length > 0) {
            const deletedSet = new Set(this.deletedTaskKeys);
            this.tasks = this.tasks.filter(t => !deletedSet.has(t.taskKey || t.name));
        }

        // Раунд 116 - переименование ПРЯМО на диаграмме, для задач ИЗ
        // ИСТОЧНИКА (у вручную добавленных - имя уже своё состояние,
        // см. manualTasks.forEach() ниже, переопределение не нужно).
        Object.keys(this.taskNameOverrides).forEach(key => {
            const t = this.tasks.find(t => (t.taskKey || t.name) === key);
            if (t) t.name = this.taskNameOverrides[key];
        });

        // Раунд 145 (по жалобе Mr.D + единый принцип хранения дат,
        // Раунд 141) - mt.durationDays (как и taskDurationOverrides
        // везде в проекте) хранит ЧИСЛО РАБОЧИХ ДНЕЙ, не готовую
        // календарную ширину - раньше здесь durationDays бралась
        // НАПРЯМУЮ (`mt.durationDays ?? 0`), без применения
        // nextWorkingOffset()/spanWorkingDays() - вручную добавленные
        // задачи не "прилипали" к рабочим дням и не растягивались через
        // выходные, в отличие от ЛЮБЫХ других задач на диаграмме.
        const anchor = parseISODate(this.startDate) || new Date();
        this.manualTasks.forEach(mt => {
            const afterIdx = this.tasks.findIndex(t => (t.taskKey || t.name) === mt.insertAfterKey);
            const anchorTask = afterIdx >= 0 ? this.tasks[afterIdx] : null;
            const rawStart = mt.startOffsetDays ?? (anchorTask ? anchorTask.startOffsetDays : 0);
            const startOffsetDays = nextWorkingOffset(anchor, rawStart, this.holidaySet);
            const workDays = mt.durationDays ?? 0;
            const endOffset = spanWorkingDays(anchor, startOffsetDays, workDays, this.holidaySet);
            const newTask = {
                name: mt.name || 'Новая задача',
                taskKey: mt.key,
                durationDays: Math.max(0, endOffset - startOffsetDays),
                startOffsetDays,
                groupName: mt.groupName ?? (anchorTask ? anchorTask.groupName : null),
                responsible: mt.responsible || ''
            };
            if (mt.insertAtStart) {
                this.tasks.unshift(newTask);
            } else if (afterIdx >= 0) {
                this.tasks.splice(afterIdx + 1, 0, newTask);
            } else {
                this.tasks.push(newTask);
            }
        });

        // Раунд 180 (по запросу Mr.D: "задействовать ручку, чтобы строку
        // можно было перетащить") - применяем ПОСЛЕ того, как все
        // задачи (источник + вручную добавленные, только что вставлены
        // выше) собраны в this.tasks, но ДО группировки по разделам
        // (_applyPromotedSections() ниже читает this.tasks В ТОМ
        // ПОРЯДКЕ, В КОТОРОМ задачи распределяются по разделам - важно,
        // чтобы перетаскивание уже подействовало к этому моменту).
        this.tasks = this._applyTaskOrderOverrides(this.tasks);

        // Раунд 146 - строки, превращённые в раздел, убираются из
        // this.tasks и становятся именем группы для следующих задач.
        // Раунд 148 (по жалобе Mr.D: "раздел не может существовать без
        // задачи") - если хотя бы один раздел есть, _applyPromotedSections()
        // строит this.taskGroups НАПРЯМУЮ и ПОЛНОСТЬЮ сама (включая
        // разделы без единой задачи) - блок ниже (перестройка byName ИЗ
        // фактически присутствующих задач) в этом случае пропускается
        // целиком (_skipTaskGroupsRebuild) - иначе он бы "стёр" пустые
        // разделы, которых byName просто не видит.
        //
        // Раунд 158 (багфикс) - сброс в false БЕЗУСЛОВНО был неверен: если
        // this.taskGroups УЖЕ пришёл готовым из иерархического источника
        // (treeData от GanttTableProcessorNode, или #/##-маркеры -
        // this._taskGroupsIsHierarchical, выставляется в calculate() ДО
        // вызова этого метода), а пользовательских Раздел/Подраздел при
        // этом НЕТ - _applyPromotedSections() вернулась бы РАНО, оставив
        // флаг false, и перестройка byName ниже СПЛЮЩИЛА бы только что
        // построенную вложенность Блок->Стадия в один плоский уровень
        // (byName группирует по t.groupName - одному значению, не по
        // дереву). Начинаем со значения this._taskGroupsIsHierarchical,
        // не с жёсткого false.
        this._skipTaskGroupsRebuild = !!this._taskGroupsIsHierarchical;
        this._applyPromotedSections();

        // Если диаграмма в групповом режиме - перестраиваем корзины
        // групп из уже обновлённого this.tasks (проще, чем вручную
        // синхронизировать splice() с this.taskGroups отдельно).
        if (Array.isArray(this.taskGroups) && !this._skipTaskGroupsRebuild) {
            const byName = new Map();
            this.tasks.forEach(t => {
                const key = t.groupName || '';
                if (!byName.has(key)) byName.set(key, []);
                byName.get(key).push(t);
            });
            this.taskGroups = [...byName.entries()].map(([name, tasks]) => ({ name, tasks }));
        }
    }

    // Раунд 146/150 (по запросу Mr.D: "добавим инструмент add, и add_sub
    // чтобы можно было любую строку превратить в раздел или подраздел...
    // у нас ещё была возможность создавать подразделы - произвольная
    // вложенность") - строка с ключом в promotedSectionKeys ИЗЫМАЕТСЯ из
    // this.tasks (перестаёт быть задачей) и становится ЗАГОЛОВКОМ
    // раздела/подраздела - глубина вложенности ("уровень") хранится в
    // this.sectionLevels: 1 = "Раздел" (всегда верхний уровень, сбрасывает
    // вложенность), 'sub' = "Подраздел" (СТЕКОВАЯ семантика - на ОДИН
    // уровень глубже, чем БЛИЖАЙШИЙ ОТКРЫТЫЙ на этот момент раздел, в
    // порядке строк - см. алгоритм ниже). Именно эта стековая семантика
    // даёт ПРОИЗВОЛЬНУЮ вложенность двумя простыми действиями:
    // "Подраздел", применённый к строке ПОСЛЕ уже созданного "Подраздел 2"
    // (который сам - уровень 2), автоматически становится уровнем 3
    // ("ПодПодраздел") - вложенность определяется НЕ явным числом,
    // выбираемым пользователем, а СТРУКТУРОЙ (что было открыто последним).
    _applyPromotedSections() {
        this.promotedNameToKey = new Map();
        if (!this.promotedSectionKeys || this.promotedSectionKeys.size === 0) return;

        // stack[i] - раздел, ОТКРЫТЫЙ на уровне i+1, в который сейчас
        // попадают и задачи, и следующие "Подраздел"-строки (пока не
        // встретится либо новый "Раздел" уровня 1, либо конец списка).
        const stack = [];
        const rootGroups = [];
        const ungroupedBefore = [];
        this.tasks.forEach(t => {
            const key = t.taskKey || t.name;
            if (this.promotedSectionKeys.has(key)) {
                // Раунд 150 (уточнение по итогам обсуждения с Mr.D) -
                // this.sectionLevels теперь хранит ЯВНОЕ число (не
                // относительный маркер 'sub') - "Раздел" всегда пишет 1,
                // "Подраздел" на СВЕЖЕЙ строке пишет 2 (сосед ближайшего
                // "Раздела"), повторный клик "Подраздел" на УЖЕ
                // существующем разделе/подразделе - increment (+1) -
                // см. promoteToSubsection() ниже. Здесь просто читаем
                // готовое число - никакой стековой арифметики на этом
                // шаге больше не нужно, только truncation (закрытие
                // более глубоких разделов) ниже.
                const newLevel = this.sectionLevels.get(key) ?? 1;
                // "Раздел" (level=1) закрывает ВСЕ текущие открытые
                // разделы (stack становится пустым). "Подраздел"
                // закрывает только те, что ГЛУБЖЕ нового уровня (стек
                // обрезается до newLevel-1 элементов) - те, что
                // МЕЛЬЧЕ/РАВНЫ, остаются открытыми как родители.
                stack.length = Math.min(stack.length, newLevel - 1);
                // Раунд 151 (по жалобе Mr.D: "строки с одинаковым
                // именем иногда вызывают непредвиденное поведение") -
                // originKey хранится НАПРЯМУЮ на объекте группы (не
                // только в promotedNameToKey - та карта индексирована по
                // ИМЕНИ и ломается, если два раздела совпадают по имени,
                // вторая запись тихо перезаписывает первую) - все места,
                // которым нужен originKey группы, теперь читают
                // group.originKey напрямую, без поиска.
                const newGroup = { name: t.name, level: newLevel, tasks: [], subgroups: [], originKey: key };
                this.promotedNameToKey.set(t.name, key);
                if (stack.length === 0) {
                    rootGroups.push(newGroup);
                } else {
                    stack[stack.length - 1].subgroups.push(newGroup);
                }
                stack.push(newGroup);
                return; // строка-раздел сама не остаётся задачей
            }
            if (stack.length > 0) {
                const deepest = stack[stack.length - 1];
                t.groupName = deepest.name;
                // Раунд 153 (по запросу Mr.D: "строки с задачами должны
                // окрашиваться в цвет раздела... разделы меняют цвет, а
                // задачи остаются по умолчанию") - причина: цвет искался
                // ТОЛЬКО по имени САМОГО ГЛУБОКОГО раздела (t.groupName) -
                // если пользователь покрасил ВЕРХНИЙ "Раздел 1", а
                // задача лежит во вложенном "Подраздел 1" (у которого
                // своего цвета нет), цвет не находился вообще. groupChain -
                // ПОЛНАЯ цепочка предков (от корня до самого глубокого) -
                // позволяет искать цвет СНИЗУ ВВЕРХ, наследуя от
                // ближайшего ПОКРАШЕННОГО предка (см. _colorForTask()
                // ниже и ganttCalendarExport.js).
                t.groupChain = stack.map(g => g.name);
                deepest.tasks.push(t);
            } else {
                // Задачи ДО первого раздела (в порядке this.tasks) -
                // остаются без группы, попадают в отдельную "безымянную"
                // корзину (та же семантика, что у обычной, не
                // иерархической группировки, Раунд 78, для задач без
                // заполненной колонки "Группа").
                t.groupName = null;
                t.groupChain = [];
                ungroupedBefore.push(t);
            }
        });

        // Плоский список ВСЕХ задач (для this.tasks/выходной таблицы) -
        // обход дерева в глубину, в порядке появления разделов/подразделов.
        const flattenTasks = (groups) => groups.flatMap(g => [...g.tasks, ...flattenTasks(g.subgroups)]);
        this.tasks = [...ungroupedBefore, ...flattenTasks(rootGroups)];
        this.taskGroups = ungroupedBefore.length > 0
            ? [{ name: '', level: 1, tasks: ungroupedBefore, subgroups: [] }, ...rootGroups]
            : rootGroups;
        this._skipTaskGroupsRebuild = true;
    }

    // Превращает СУЩЕСТВУЮЩУЮ задачу в раздел ВЕРХНЕГО уровня (см.
    // _applyPromotedSections() выше). Всегда level=1 - сбрасывает
    // текущую вложенность (новый "Раздел" НЕ может оказаться внутри
    // предыдущего - это, по определению, отдельный, соседний раздел).
    promoteToSection(taskKey) {
        this.promotedSectionKeys.add(taskKey);
        this.sectionLevels.set(taskKey, 1);
        if (window.nodeManager) window.nodeManager.calculateAll();
        if (window.renderer) window.renderer.updateAllDisplays();
    }

    // Раунд 150 (по запросу Mr.D: "у нас ещё была возможность создавать
    // подразделы... произвольная вложенность") - тот самый "add_sub" из
    // изначального запроса (Раунд 146). По итогам обсуждения (row-order
    // и тип действия сами по себе НЕ различают "сосед" от "вложить" -
    // доказано разбором на примере Mr.D: Подраздел1/Подраздел2 - соседи,
    // но ПодПодраздел1 - вложен, хотя обе ситуации выглядят структурно
    // одинаково без третьего сигнала) - решение: СВЕЖАЯ строка (ещё не
    // раздел) всегда становится СОСЕДОМ ближайшего "Раздела" (level=2) -
    // повторный клик "Подраздел" на УЖЕ существующем разделе/подразделе
    // (эта же строка, любой текущий уровень) - УГЛУБЛЯЕТ его ещё на 1 -
    // так "ПодПодраздел1" получается ДВУМЯ кликами на одной строке (1-й
    // делает её level=2, сосед Подраздела1/2; 2-й - level=3, вложена в
    // ближайший ОТКРЫТЫЙ на момент её строки раздел, т.е. в Подраздел2 -
    // порядок строк здесь по-прежнему решает, КУДА именно она вложится
    // на level=3, просто САМ level теперь явный, не выводится из стека).
    promoteToSubsection(taskKey) {
        this.promotedSectionKeys.add(taskKey);
        const currentLevel = this.sectionLevels.get(taskKey);
        this.sectionLevels.set(taskKey, currentLevel ? currentLevel + 1 : 2);
        if (window.nodeManager) window.nodeManager.calculateAll();
        if (window.renderer) window.renderer.updateAllDisplays();
    }

    demoteFromSection(taskKey) {
        this.promotedSectionKeys.delete(taskKey);
        this.sectionLevels.delete(taskKey);
        if (window.nodeManager) window.nodeManager.calculateAll();
        if (window.renderer) window.renderer.updateAllDisplays();
    }

    // Раунд 115 - добавляет новую задачу СРАЗУ ПОСЛЕ указанной (по
    // taskKey/name) - дефолтные значения по чек-листу: "Новая задача",
    // 0 длительности, даты не заданы (наследует позицию соседа - см.
    // _applyManualRowEdits()), та же группа, что у соседа.
    // Раунд 146 (по запросу Mr.D: "[+] нужно добавить такую в шапку,
    // чтобы можно было добавить первой строку из шапки") - тот же
    // механизм, что addTaskAfter(), но с флагом insertAtStart - строка
    // встаёт ПЕРЕД всеми остальными (см. _applyManualRowEdits() -
    // unshift() вместо push() для этой строки). Работает и когда
    // диаграмма ПОЛНОСТЬЮ пуста (нет ни одной задачи - самодостаточное
    // построение списка с нуля, по запросу Mr.D: "можно полностью
    // создать список в диаграмме с 0").
    // Раунд 151 (по жалобе Mr.D: "строки с одинаковым именем иногда
    // вызывают непредвиденное поведение... давай добавим автоинкремент") -
    // проверяет имя на совпадение с ЛЮБОЙ уже существующей задачей
    // (это же поле taskKey у большинства структур строится ИЗ имени -
    // list-режим, например, - совпадение имён там означало бы совпадение
    // ключей!) - при коллизии добавляет " (2)", " (3)" и т.д., пока имя
    // не станет уникальным. baseName без изменений, если коллизий нет.
    // Раунд 163 (по запросу Mr.D: "добавим навигацию в диаграмму, Enter
    // переходит на ввод следующей ячейки по смыслу, все вводимые поля
    // строки потом следующая строка. Стрелочки вперёд назад вверх вниз") -
    // порядок редактируемых полей строки задачи слева направо, ТОЛЬКО
    // реально видимые (по тем же флагам, что решают, показывать ли саму
    // колонку) - тот же порядок, что в buildTaskRow() физически строит
    // ячейки (Раздел -> Вид работ -> Раб.дни -> Ответственный).
    _editableFieldOrder() {
        const order = [];
        if (this.showSectionColumn) order.push('section');
        order.push('name');
        if (this.showWorkingDaysColumn) order.push('workdays');
        // Раунд 187 (по запросу Mr.D: "Ручной ввод дат в Диаграмме
        // Ганта") - тот же порядок, что у самих колонок в строке
        // (Раб.дн. -> Начало -> Окончание -> Ответственный).
        if (this.showStartDateColumn) order.push('startDate');
        if (this.showEndDateColumn) order.push('endDate');
        if (this.showResponsibleColumn) order.push('responsible');
        return order;
    }

    // Раунд 163 - переводит фокус НА КОНКРЕТНОЕ поле КОНКРЕТНОЙ строки:
    // 'next'/'prev' - следующее/предыдущее поле ПО ПОРЯДКУ (Enter/стрелки
    // вправо-влево у края текста), переходя на первое/последнее поле
    // соседней строки, если текущее поле - крайнее в своей строке;
    // 'up'/'down' - ТО ЖЕ САМОЕ поле в предыдущей/следующей строке
    // (стрелки вверх-вниз). За пределами списка (первая/последняя
    // строка) - никуда не переходим, просто ничего не происходит (не
    // закольцовываем на противоположный конец - неожиданно для
    // пользователя при быстром наборе).
    _navigateGanttField(taskKey, fieldType, direction) {
        const fields = this._editableFieldOrder();
        const fieldIdx = fields.indexOf(fieldType);
        const rowIdx = this.tasks.findIndex(t => (t.taskKey || t.name) === taskKey);
        if (fieldIdx === -1 || rowIdx === -1) return;

        let targetRowIdx = rowIdx;
        let targetFieldIdx = fieldIdx;

        if (direction === 'next') {
            targetFieldIdx++;
            if (targetFieldIdx >= fields.length) { targetFieldIdx = 0; targetRowIdx++; }
        } else if (direction === 'prev') {
            targetFieldIdx--;
            if (targetFieldIdx < 0) { targetFieldIdx = fields.length - 1; targetRowIdx--; }
        } else if (direction === 'up') {
            targetRowIdx--;
        } else if (direction === 'down') {
            targetRowIdx++;
        }

        if (targetRowIdx < 0 || targetRowIdx >= this.tasks.length) return;
        const targetTask = this.tasks[targetRowIdx];
        const targetKey = targetTask.taskKey || targetTask.name;
        const targetField = fields[targetFieldIdx];

        this._focusedTaskKey = targetKey;
        this._rerenderGanttSlot();

        // _rerenderGanttSlot() пересобирает DOM СИНХРОННО (innerHTML +
        // немедленная сборка, см. _replaceGanttSlot()) - искать целевое
        // поле можно сразу, без ожидания следующего кадра.
        const slotEl = document.querySelector(`[data-node-id="${this.id}"] .gantt-container-slot`);
        if (!slotEl) return;
        const targetRowEl = slotEl.querySelector(`[data-task-key="${CSS.escape(targetKey)}"]`);
        if (!targetRowEl) return;
        const fieldSelector = {
            section: '.gantt-section-input',
            name: '.gantt-task-label-input',
            workdays: '.gantt-workdays-input',
            startDate: '.gantt-startdate-input',
            endDate: '.gantt-enddate-input',
            responsible: '.gantt-responsible-input'
        }[targetField];
        const input = fieldSelector ? targetRowEl.querySelector(fieldSelector) : null;
        if (input) {
            input.focus();
            if (typeof input.select === 'function') input.select();
        }
    }

    // Раунд 163 - единый обработчик клавиш, навешивается на КАЖДОЕ из 4
    // редактируемых полей строки задачи. Стрелки влево/вправо уважают
    // ПОЗИЦИЮ КУРСОРА внутри текста - переход на соседнее поле только
    // когда курсор УЖЕ у соответствующего края (иначе стрелки продолжают
    // просто двигать курсор внутри поля, как обычно) - number-input
    // (Раб.дни) не всегда поддерживает selectionStart одинаково во всех
    // браузерах, поэтому там перескок срабатывает всегда (спорный, но
    // осознанный компромисс - штатный "инкремент по стрелкам" у
    // number-полей приносится в жертву единообразной навигации, которую
    // явно попросил Mr.D).
    _attachFieldNavigation(inputEl, taskKey, fieldType) {
        inputEl.addEventListener('keydown', (e) => {
            const isNumberInput = inputEl.type === 'number';
            const atStart = isNumberInput || inputEl.selectionStart === 0;
            const atEnd = isNumberInput || inputEl.selectionStart === inputEl.value.length;

            let direction = null;
            if (e.key === 'Enter') direction = 'next';
            else if (e.key === 'ArrowRight' && atEnd) direction = 'next';
            else if (e.key === 'ArrowLeft' && atStart) direction = 'prev';
            else if (e.key === 'ArrowUp') direction = 'up';
            else if (e.key === 'ArrowDown') direction = 'down';

            if (!direction) return;
            e.preventDefault();
            // Зафиксировать текущее значение (тот же 'change', что уже
            // срабатывает по blur) ПЕРЕД тем, как фокус уйдёт на другое
            // поле - иначе правка потерялась бы, если пользователь
            // просто "пролистал" клавишами, не дожидаясь blur.
            inputEl.dispatchEvent(new Event('change'));
            this._navigateGanttField(taskKey, fieldType, direction);
        });
    }

    _uniqueTaskName(baseName) {
        const existingNames = new Set([
            ...(this.tasks || []).map(t => t.name),
            ...(this.manualTasks || []).map(t => t.name)
        ]);
        if (!existingNames.has(baseName)) return baseName;
        let n = 2;
        while (existingNames.has(`${baseName} (${n})`)) n++;
        return `${baseName} (${n})`;
    }

    // Раунд 159 (по запросу Mr.D: "вставка многострочного текста - если
    // текст разделён на строки, то под каждую новую строку запускаем
    // макрос на создание новой строки, чтобы при копировании из таблиц
    // каждая новая строка вставала на своё место сразу при Ctrl+C
    // Ctrl+V") - первая строка ПЕРЕИМЕНОВЫВАЕТ текущую (уже
    // сфокусированную) задачу той же логикой, что обычное
    // переименование (проверка manualTasks/taskNameOverrides) -
    // остальные строки создают НОВЫЕ вручную-добавленные задачи, КАЖДАЯ
    // сразу после ПРЕДЫДУЩЕЙ (insertAfterKey - цепочка, сохраняет
    // порядок строк как в исходном тексте) - одним пересчётом в конце,
    // не по одному на строку (иначе N строк дали бы N лишних
    // перерисовок).
    _pasteMultilineIntoTask(taskKey, text) {
        const lines = text.split(/\r\n|\r|\n/).map(l => l.trim()).filter(l => l.length > 0);
        if (lines.length === 0) return;

        const firstName = this._uniqueTaskName(lines[0]);
        const currentTask = (this.tasks || []).find(t => t.taskKey === taskKey);
        const manualTask = this.manualTasks.find(t => t.key === taskKey);
        if (manualTask) {
            manualTask.name = firstName;
        } else if (!currentTask || firstName !== currentTask.name) {
            this.taskNameOverrides[taskKey] = firstName;
        }

        let afterKey = taskKey;
        for (let i = 1; i < lines.length; i++) {
            const key = `manual_${Date.now()}_${Math.random().toString(36).slice(2, 7)}_${i}`;
            const name = this._uniqueTaskName(lines[i]);
            this.manualTasks.push({ key, name, durationDays: 0, insertAfterKey: afterKey });
            afterKey = key;
        }

        if (window.nodeManager) window.nodeManager.calculateAll();
        if (window.renderer) window.renderer.updateAllDisplays();
    }

    addTaskAtStart() {
        const key = `manual_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        this.manualTasks.push({ key, name: this._uniqueTaskName('Новая задача'), durationDays: 0, insertAfterKey: null, insertAtStart: true });
        if (window.nodeManager) window.nodeManager.calculateAll();
        if (window.renderer) window.renderer.updateAllDisplays();
    }

    addTaskAfter(afterTaskKey) {
        const key = `manual_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        this.manualTasks.push({ key, name: this._uniqueTaskName('Новая задача'), durationDays: 0, insertAfterKey: afterTaskKey });
        if (window.nodeManager) window.nodeManager.calculateAll();
        if (window.renderer) window.renderer.updateAllDisplays();
    }

    // Раунд 115 - "удаляет" задачу (мягко - см. докстринг
    // deletedTaskKeys выше). Если taskKey принадлежит ДОБАВЛЕННОЙ вручную
    // задаче (manualTasks) - убирается из самого manualTasks целиком
    // (не нужен deletedTaskKeys - она и так не пришла бы из источника).
    removeTask(taskKey) {
        const manualIdx = this.manualTasks.findIndex(t => t.key === taskKey);
        if (manualIdx >= 0) {
            this.manualTasks.splice(manualIdx, 1);
        } else if (!this.deletedTaskKeys.includes(taskKey)) {
            this.deletedTaskKeys.push(taskKey);
        }
        if (window.nodeManager) window.nodeManager.calculateAll();
        if (window.renderer) window.renderer.updateAllDisplays();
    }

    // Раунд 88 (чек-лист 1.7.21, п.5) - ручной ввод числа в столбец
    // "Раб.дн.". Раунд 118/141 (багфикс, по жалобе Mr.D: "меняю
    // протяжённость рабочих дней, график перестаёт прибавлять
    // выходные" / "есть ошибка с фиксацией диаграммы при вводе числа
    // вручную, перестаёт подстраиваться под выходные") - ВСЕГДА
    // хранится ЧИСЛО РАБОЧИХ ДНЕЙ как есть (единый принцип хранения
    // дат, см. докстринг ganttMath.js) - раньше существовавшая ветка
    // "calendar-режима" здесь хранила уже ГОТОВУЮ календарную ширину
    // (результат spanWorkingDays() НА МОМЕНТ редактирования) - именно
    // она "замерзала", если календарь (список праздников) менялся
    // ПОЗЖЕ: сохранённое число было уже НЕ рабочими днями, а
    // конкретной, устаревшей календарной шириной, которая никогда не
    // пересчитывалась заново. Переключаемого scheduleMode/calendar-
    // режима больше не существует - ветка с багом ушла вместе с ним.
    // Раунд 174 (по запросу Mr.D: "мультивыделение для одновременного
    // редактирования... выделил 3 произвольные строки, поменял
    // продолжительность, в остальных выделенных строках продолжительность
    // перезаписалась") - применяет applyFn(otherTask) КО ВСЕМ ОСТАЛЬНЫМ
    // строкам мультивыбора, ЕСЛИ редактируемая строка (taskKey) сама
    // входит в набор из 2+ строк (одиночное выделение/фокус без Shift -
    // multiSelectedKeys пуст, ничего не разлетается, обычное поведение
    // без изменений). Каждый из 4 обработчиков полей вызывает это ПОСЛЕ
    // применения правки к САМОЙ редактируемой строке.
    _propagateToMultiSelection(taskKey, applyFn) {
        if (this.multiSelectedKeys.size <= 1 || !this.multiSelectedKeys.has(taskKey)) return;
        this.multiSelectedKeys.forEach(key => {
            if (key === taskKey) return;
            const otherTask = this.tasks.find(t => (t.taskKey || t.name) === key);
            if (otherTask) applyFn(otherTask);
        });
    }

    _applyWorkDaysEdit(task, newWorkDays, anchor) {
        const key = task.taskKey || task.name;
        // Раунд 145 (по жалобе Mr.D: "пытаюсь добавить дни элементу,
        // созданному в диаграмме, но не могу, они всегда 0") - для
        // вручную добавленной задачи (manualTasks) пишем НАПРЯМУЮ в
        // mt.durationDays - той же логикой, что уже применена для
        // переименования (см. label.addEventListener('change') выше в
        // этом же файле - "если manualTask найдена, пишем в неё
        // напрямую, иначе - в taskNameOverrides"). Без этой ветки правка
        // уходила ТОЛЬКО в this.taskDurationOverrides[key], который
        // _applyManualRowEdits() для вручную добавленных задач ВООБЩЕ НЕ
        // ЧИТАЕТ (строит durationDays только из mt.durationDays,
        // застывшего на 0 с момента создания строки) - правка молча
        // терялась.
        const manualTask = this.manualTasks.find(t => t.key === key);
        if (manualTask) {
            manualTask.durationDays = Math.max(0.5, newWorkDays);
        } else {
            this.taskDurationOverrides[key] = Math.max(0.5, newWorkDays);
        }
        if (window.nodeManager) window.nodeManager.calculateAll();
        if (window.renderer) window.renderer.updateAllDisplays();
    }

    // Раунд 187 (по запросу Mr.D: "Ручной ввод дат в Диаграмме Ганта -
    // поля для начала и конца задачи с синхронизацией с графическим
    // редактором") - та же семантика, что у перетаскивания ТЕЛА полосы
    // мышью (attachBarDrag()) - СДВИГ (длительность не меняется) - та
    // же запись (manualTask.startOffsetDays или taskDates[key]) +
    // _rebaseDependencyGapsForTarget(), что уже применяет графическое
    // перетаскивание (Раунд 139/178) - не дублирует логику отдельно.
    _applyStartDateEdit(task, newStartOffsetDays) {
        const key = task.taskKey || task.name;
        const clamped = Math.max(0, newStartOffsetDays);
        const manualTask = this.manualTasks.find(t => t.key === key);
        if (manualTask) {
            manualTask.startOffsetDays = clamped;
        } else {
            this.taskDates[key] = clamped;
        }
        this._rebaseDependencyGapsForTarget(key, clamped);
        if (window.nodeManager) window.nodeManager.calculateAll();
        if (window.renderer) window.renderer.updateAllDisplays();
    }

    // выходные/праздники, см. isNonWorkingDay()/this.holidaySet) внутри
    // календарного диапазона [startOffsetDays, startOffsetDays+durationDays).
    // Используется и на уровне отдельной задачи (её собственный диапазон),
    // и на уровне "Итого"/группы (диапазон ОТ самого раннего старта ДО
    // самого позднего конца - тот же диапазон, что уже рисует полоса-обзор).
    // Раунд 94 - эффективная ширина каждой левой колонки (ручное
    // переопределение, если есть - см. attachColumnResizeHandle() в
    // buildColumnLabelsRow() - иначе дефолтная константа модуля).
    _labelW() { return this.labelColWidthOverride || LABEL_WIDTH; }
    _hoursW() { return this.hoursColWidthOverride || HOURS_COL_WIDTH; }
    _workdaysW() { return this.workdaysColWidthOverride || WORKDAYS_COL_WIDTH; }
    _startDateW() { return this.startDateColWidthOverride || DATE_COL_WIDTH; }
    _endDateW() { return this.endDateColWidthOverride || DATE_COL_WIDTH; }
    _respW() { return this.responsibleColWidthOverride || RESPONSIBLE_COL_WIDTH; }
    // Раунд 135 - "номер раздела повторяется", если ОДИН И ТОТ ЖЕ
    // sectionNumber встречается у задач из РАЗНЫХ Блоков (this.tasks -
    // не hierarchyBlocks, т.к. номер живёт на задаче, не на блоке) -
    // такое обычно означает опечатку/повторное использование номера в
    // исходном файле. Считает заново при каждом вызове (не кэширует) -
    // список задач невелик, лишний проход не критичен для одной строки.
    _isDuplicateSectionNumber(sectionNumber) {
        const blockNames = new Set();
        for (const t of this.tasks || []) {
            if (t.sectionNumber === sectionNumber) blockNames.add(t.blockName || '');
            if (blockNames.size >= 2) return true;
        }
        return false;
    }

    // Раунд 133 - "раздел повторяется", если ОДНО и то же имя блока
    // встречается КАК ОТДЕЛЬНАЯ ЗАПИСЬ 2+ раза в this.hierarchyBlocks -
    // тот самый сценарий, что чаще всего означает случайную ошибку в
    // исходном файле (раздел набран заново вместо продолжения
    // существующего, вместо того чтобы просто дописать в него новые
    // задачи).
    // Раунд 133 - "раздел повторяется", если ОДНО и то же имя раздела
    // встречается КАК ОТДЕЛЬНАЯ ЗАПИСЬ 2+ раза в this.taskGroups - тот
    // самый сценарий, что чаще всего означает случайную ошибку в
    // исходном файле (раздел набран заново вместо продолжения
    // существующего, вместо того чтобы просто дописать в него новые
    // задачи). Раунд 158 (багфикс) - раньше проверяла this.hierarchyBlocks
    // (тот теперь никогда не устанавливается - структура унифицирована
    // под taskGroups/subgroups, см. _groupsFromTreeData()) - функция
    // молча ВСЕГДА возвращала false. Теперь - рекурсивный обход
    // taskGroups (любой уровень вложенности), не только верхний.
    // Раунд 180 (по запросу Mr.D: "задействовать ручку, чтобы строку
    // можно было перетащить схватившись за ручку") - переупорядочивает
    // ПЛОСКИЙ список задач по накопленным перетаскиваниям
    // (this.taskOrderOverrides) - для КАЖДОЙ задачи с override сначала
    // убирает её с исходного места, затем вставляет СРАЗУ ПОСЛЕ
    // задачи-ключа afterKey (или в самое начало, если afterKey ===
    // '__start__'). Несколько независимых перетаскиваний за один
    // пересчёт применяются последовательно, в порядке, в котором
    // добавлялись в объект (обычный порядок ключей JS-объекта).
    _applyTaskOrderOverrides(tasks) {
        if (!this.taskOrderOverrides || Object.keys(this.taskOrderOverrides).length === 0) return tasks;
        let result = [...tasks];
        Object.entries(this.taskOrderOverrides).forEach(([key, afterKey]) => {
            const idx = result.findIndex(t => (t.taskKey || t.name) === key);
            if (idx === -1) return; // задача с этим ключом больше не существует (удалена/переименована)
            const [task] = result.splice(idx, 1);
            if (afterKey === '__start__') {
                result.unshift(task);
            } else {
                const afterIdx = result.findIndex(t => (t.taskKey || t.name) === afterKey);
                if (afterIdx === -1) {
                    result.push(task); // задача-ориентир пропала - в конец, не теряем совсем
                } else {
                    result.splice(afterIdx + 1, 0, task);
                }
            }
        });
        return result;
    }

    _isDuplicateSectionName(name) {
        if (!Array.isArray(this.taskGroups)) return false;
        let count = 0;
        const walk = (groups) => {
            groups.forEach(g => {
                if (g.name === name) count++;
                walk(g.subgroups || []);
            });
        };
        walk(this.taskGroups);
        return count >= 2;
    }

    // Раунд 157 (по запросу Mr.D: "нужны колонки 'сум. раб. дней',
    // 'сум. ч.ч.' - показывают суммарно отработанные дни по всем
    // работам, а не по дате начала и конца в разделе") - ИСТИННАЯ сумма
    // РЕАЛЬНО отработанных рабочих дней (через _countWorkingDaysInRange()
    // для КАЖДОЙ задачи по отдельности, не диапазон "от начала до
    // конца"). Отличается даже от существующей "ч.ч." для ОДНОЙ задачи:
    // та считает часы через task.durationDays (КАЛЕНДАРНУЮ ширину) - если
    // задача сама перескакивает через выходной внутри своего диапазона,
    // "ч.ч." завышает результат (считает и выходной день тоже), эта
    // сумма - нет.
    _sumWorkdaysForTasks(tasks) {
        const anchor = parseISODate(this.startDate) || new Date();
        return tasks.reduce((sum, t) => sum + this._countWorkingDaysInRange(anchor, t.startOffsetDays, t.durationDays), 0);
    }

    _sumHoursForTasks(tasks) {
        return this._sumWorkdaysForTasks(tasks) * HOURS_PER_WORKDAY;
    }

    // Раунд 183 (по запросу Mr.D: "Период отображения давай сделаем по
    // умолчанию Авто (берёт начальную и конечную дату, и к конечной
    // прибавляет ещё месяц для отображения)") - максимальный
    // startOffsetDays+durationDays среди ВСЕХ задач (самая поздняя дата
    // окончания относительно anchor) + AUTO_PERIOD_EXTRA_DAYS "про
    // запас" - минимальная дата НЕ учитывается отдельно (шкала и так
    // всегда начинается от anchor/дня 0 - см. createGanttArea()) - если
    // задач ещё нет, показываем месяц по умолчанию (тот же результат,
    // что раньше давал fallback "30" в totalDays).
    _computeAutoPeriodDays() {
        if (!this.tasks || this.tasks.length === 0) return PERIOD_PRESETS.month.days;
        const maxEnd = Math.max(...this.tasks.map(t => t.startOffsetDays + t.durationDays));
        return Math.max(1, maxEnd) + AUTO_PERIOD_EXTRA_DAYS;
    }

    _calDaysW() { return this.calDaysColWidthOverride || CALDAYS_COL_WIDTH; }
    _sumWorkdaysW() { return this.sumWorkdaysColWidthOverride || SUM_WORKDAYS_COL_WIDTH; }
    _sumHoursW() { return this.sumHoursColWidthOverride || SUM_HOURS_COL_WIDTH; }
    _sectionW() { return this.sectionColWidthOverride || SECTION_COL_WIDTH; }

    // Раунд 94 (по предложению Mr.D: "универсальное решение - всегда
    // отображать сепараторы для заглавных строк") - постоянная строка
    // заголовков левых колонок, с ВСЕГДА видимыми разделителями между
    // ними (не только при наведении) - даёт естественное место и для
    // подписи столбца, и для ручки растягивания (attachColumnResizeHandle,
    // Раунд 93). Подписи "№ п/п"/"Вид работ"/"Ответственный" - те же
    // слова, что в исходном Excel-файле Mr.D (см. "...График
    // проектирования АГК.xlsx", строка 3) - остальные два столбца
    // ("ч.ч."/"Раб.дн.") специфичны для этой диаграммы, в Excel таких
    // не было. Область календарной сетки - ПУСТОЙ спейсер без подписи и
    // БЕЗ ручки (растягивание одной клетки сетки лишено смысла, см.
    // докстринг конструктора).
    buildColumnLabelsRow(numColWidth, timelineWidth) {
        const row = document.createElement('div');
        row.className = 'gantt-column-labels-row';
        row.style.cssText = `
            display: flex;
            align-items: center;
            height: ${ROW_HEIGHT}px;
            border-bottom: 2px solid var(--md-divider);
            background: var(--md-surface-variant);
            font-size: 10px;
            font-weight: 600;
            color: var(--md-text-secondary);
        `;

        const makeHeaderCell = (widthPx, label, onResize) => {
            const cell = document.createElement('div');
            cell.className = 'gantt-column-label-cell';
            cell.style.cssText = `
                width: ${widthPx}px;
                flex-shrink: 0;
                padding: 0 6px;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
                border-right: 1px solid var(--md-divider);
                display: flex;
                align-items: center;
            `;
            cell.textContent = label;
            cell.title = label;
            if (onResize) {
                attachColumnResizeHandle(cell, widthPx, onResize);
            }
            return cell;
        };

        // Раунд 100 - тот же sticky-контейнер, что в остальных строках -
        // самая важная строка для закрепления, здесь сами подписи
        // столбцов.
        const leftGroup = document.createElement('div');
        leftGroup.className = 'gantt-left-sticky';
        leftGroup.style.cssText = 'display:flex; align-items:center; height:100%; position:sticky; left:0; z-index:6; background:var(--md-surface-variant);';
        row.appendChild(leftGroup);

        // Раунд 116 - спейсер под колонку фокуса (см. buildTaskRow()).
        // Раунд 146 (по запросу Mr.D: "[+] нужно добавить такую в
        // шапку, чтобы можно было добавить первой строку из шапки") -
        // вместо пустого спейсера - кнопка "+" (тот же класс
        // .gantt-row-add-btn, что у кнопки добавления под фокусной
        // строкой - визуально узнаваемая) - вставляет строку В САМОЕ
        // НАЧАЛО списка, работает и на полностью пустой диаграмме.
        const focusSpacerH = document.createElement('div');
        focusSpacerH.style.cssText = `width:${FOCUS_COL_WIDTH}px; flex-shrink:0; position:relative; height:100%;`;
        const addFirstBtn = document.createElement('button');
        addFirstBtn.className = 'gantt-small-btn';
        addFirstBtn.textContent = '+';
        addFirstBtn.title = 'Добавить строку в начало списка';
        addFirstBtn.style.cssText = 'display:flex; left:2px; top:50%; transform:translateY(-50%);';
        addFirstBtn.addEventListener('mousedown', (e) => e.stopPropagation());
        addFirstBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.addTaskAtStart();
        });
        focusSpacerH.appendChild(addFirstBtn);
        leftGroup.appendChild(focusSpacerH);

        const numHeaderCell = makeHeaderCell(numColWidth, '№ п/п', (w) => {
            this.numColWidthOverride = w;
            this._rerenderGanttSlot();
        });
        // Раунд 187 (по запросу Mr.D: "Кнопка 'Раскрыть всё' в
        // Диаграмме Ганта - раскрывает все дочерние элементы строк") -
        // в ту же ячейку, что и подпись "№ п/п" (та уже flex - кнопка
        // после textContent просто встаёт следующим flex-элементом) -
        // если групп/подгрупп в диаграмме вообще нет, кнопка ничего не
        // ломает (_expandAllGroups() просто пройдёт по пустому/
        // отсутствующему дереву и ничего не изменит).
        const expandAllBtn = document.createElement('button');
        expandAllBtn.className = 'gantt-small-btn';
        expandAllBtn.textContent = '⊞';
        expandAllBtn.title = 'Раскрыть все группы';
        expandAllBtn.style.cssText = 'position:static; margin-left:4px; flex-shrink:0;';
        expandAllBtn.addEventListener('mousedown', (e) => e.stopPropagation());
        expandAllBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this._expandAllGroups();
            this._rerenderGanttSlot();
        });
        numHeaderCell.appendChild(expandAllBtn);
        leftGroup.appendChild(numHeaderCell);
        if (this.showSectionColumn) {
            leftGroup.appendChild(makeHeaderCell(this._sectionW(), 'Раздел', (w) => {
                this.sectionColWidthOverride = w;
                this._rerenderGanttSlot();
            }));
        }
        leftGroup.appendChild(makeHeaderCell(this._labelW(), 'Вид работ', (w) => {
            this.labelColWidthOverride = w;
            this._rerenderGanttSlot();
        }));
        if (this.showDurationColumn) {
            leftGroup.appendChild(makeHeaderCell(this._hoursW(), 'ч.ч.', (w) => {
                this.hoursColWidthOverride = w;
                this._rerenderGanttSlot();
            }));
        }
        if (this.showWorkingDaysColumn) {
            leftGroup.appendChild(makeHeaderCell(this._workdaysW(), 'Раб.дн.', (w) => {
                this.workdaysColWidthOverride = w;
                this._rerenderGanttSlot();
            }));
        }
        // Раунд 187 (по запросу Mr.D: "Ручной ввод дат в Диаграмме
        // Ганта - поля для начала и конца задачи")
        if (this.showStartDateColumn) {
            leftGroup.appendChild(makeHeaderCell(this._startDateW(), 'Начало', (w) => {
                this.startDateColWidthOverride = w;
                this._rerenderGanttSlot();
            }));
        }
        if (this.showEndDateColumn) {
            leftGroup.appendChild(makeHeaderCell(this._endDateW(), 'Окончание', (w) => {
                this.endDateColWidthOverride = w;
                this._rerenderGanttSlot();
            }));
        }
        if (this.showResponsibleColumn) {
            leftGroup.appendChild(makeHeaderCell(this._respW(), 'Ответственный', (w) => {
                this.responsibleColWidthOverride = w;
                this._rerenderGanttSlot();
            }));
        }
        if (this.showCalDaysColumn) {
            leftGroup.appendChild(makeHeaderCell(this._calDaysW(), 'Кал. дни', (w) => {
                this.calDaysColWidthOverride = w;
                this._rerenderGanttSlot();
            }));
        }
        if (this.showSumWorkingDaysColumn) {
            leftGroup.appendChild(makeHeaderCell(this._sumWorkdaysW(), 'Сум.раб.дн.', (w) => {
                this.sumWorkdaysColWidthOverride = w;
                this._rerenderGanttSlot();
            }));
        }
        if (this.showSumHoursColumn) {
            leftGroup.appendChild(makeHeaderCell(this._sumHoursW(), 'Сум.ч.ч.', (w) => {
                this.sumHoursColWidthOverride = w;
                this._rerenderGanttSlot();
            }));
        }

        // Область календарной сетки - пустой спейсер, без подписи и без
        // ручки (см. докстринг метода про то, почему).
        const gridSpacer = document.createElement('div');
        gridSpacer.style.cssText = `width:${timelineWidth}px; flex-shrink:0;`;
        row.appendChild(gridSpacer);

        return row;
    }

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
            background: var(--gantt-total-row-bg, rgba(255,255,255,0.06));
            border-bottom: 2px solid var(--md-divider);
            font-weight: 600;
        `;

        // Раунд 100 - тот же sticky-контейнер, что в buildTaskRow().
        // Багфикс (Раунд 101, тот же класс бага, что в buildTaskRow()) -
        // раньше был отдельный несовпадающий токен var(--md-surface-2) -
        // теперь составной фон: полупрозрачная подсветка "Итого"
        // (Раунд 88) ЧЕРЕЗ linear-gradient ПОВЕРХ непрозрачной ОСНОВЫ
        // var(--md-surface-variant) - визуально идентично самой строке,
        // но непрозрачно (обязательно для sticky).
        const leftGroup = document.createElement('div');
        leftGroup.className = 'gantt-left-sticky gantt-left-sticky-js';
        leftGroup.style.cssText = 'display:flex; align-items:center; height:100%; position:relative; left:0; z-index:5; will-change: transform; background: linear-gradient(var(--gantt-total-row-bg, rgba(255,255,255,0.06)), var(--gantt-total-row-bg, rgba(255,255,255,0.06))), var(--md-surface-variant);';
        row.appendChild(leftGroup);

        // Раунд 116 - спейсер под колонку фокуса (см. buildTaskRow()).
        const focusSpacerT = document.createElement('div');
        focusSpacerT.style.cssText = `width:${FOCUS_COL_WIDTH}px; flex-shrink:0;`;
        leftGroup.appendChild(focusSpacerT);

        const spacer = document.createElement('div');
        spacer.style.cssText = `width:${numColWidth}px; flex-shrink:0;`;
        leftGroup.appendChild(spacer);

        if (this.showSectionColumn) {
            const sectionSpacerTotal = document.createElement('div');
            sectionSpacerTotal.style.cssText = `width:${this._sectionW()}px; flex-shrink:0;`;
            leftGroup.appendChild(sectionSpacerTotal);
        }

        const label = document.createElement('div');
        label.style.cssText = `
            width: ${this._labelW()}px;
            flex-shrink: 0;
            font-size: 11px;
            color: var(--md-text);
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            padding-right: 6px;
        `;
        label.textContent = 'Итого';
        leftGroup.appendChild(label);

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
                width: ${this._hoursW()}px;
                flex-shrink: 0;
                font-size: 10px;
                color: var(--md-text);
                text-align: right;
                padding-right: 6px;
                font-variant-numeric: tabular-nums;
            `;
            hoursCell.textContent = totalCell;
            leftGroup.appendChild(hoursCell);
        }

        // Раунд 81 (п.3) - "Итого рабочих дней": рабочих дней в ОБЩЕМ
        // диапазоне от самого раннего старта до самого позднего конца
        // (тот же диапазон, что уже занимает полоса-обзор ниже) - не
        // сумма по каждой задаче отдельно (та величина - для колонки у
        // ОБЫЧНЫХ строк задач, см. buildTaskRow()).
        if (this.showWorkingDaysColumn) {
            const workdaysCell = document.createElement('div');
            workdaysCell.style.cssText = `
                width: ${this._workdaysW()}px;
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
            leftGroup.appendChild(workdaysCell);
        }

        // Раунд 187 (по запросу Mr.D: "Ручной ввод дат в Диаграмме
        // Ганта") - для строки "Итого" - самая ранняя дата начала/
        // самая поздняя дата окончания по ВСЕМУ проекту (не
        // редактируемое поле, тот же принцип, что уже применён к
        // "Раб.дн." строки "Итого" чуть выше).
        if (this.showStartDateColumn) {
            const startDateCell = document.createElement('div');
            startDateCell.style.cssText = `
                width: ${this._startDateW()}px;
                flex-shrink: 0;
                font-size: 10px;
                color: var(--md-text);
                padding: 0 4px;
                font-variant-numeric: tabular-nums;
            `;
            if (this.tasks.length > 0) {
                const minStart = Math.min(...this.tasks.map(t => t.startOffsetDays));
                startDateCell.textContent = formatISODate(addDays(anchor, minStart));
            }
            leftGroup.appendChild(startDateCell);
        }
        if (this.showEndDateColumn) {
            const endDateCell = document.createElement('div');
            endDateCell.style.cssText = `
                width: ${this._endDateW()}px;
                flex-shrink: 0;
                font-size: 10px;
                color: var(--md-text);
                padding: 0 4px;
                font-variant-numeric: tabular-nums;
            `;
            if (this.tasks.length > 0) {
                const maxEnd = Math.max(...this.tasks.map(t => t.startOffsetDays + t.durationDays));
                endDateCell.textContent = formatISODate(addDays(anchor, maxEnd));
            }
            leftGroup.appendChild(endDateCell);
        }

        if (this.showResponsibleColumn) {
            const respSpacer = document.createElement('div');
            respSpacer.style.cssText = `width:${this._respW()}px; flex-shrink:0;`;
            leftGroup.appendChild(respSpacer);
        }

        if (this.showCalDaysColumn) {
            const calDaysCell = document.createElement('div');
            calDaysCell.style.cssText = `
                width: ${this._calDaysW()}px;
                flex-shrink: 0;
                font-size: 10px;
                color: var(--md-text);
                text-align: right;
                padding-right: 6px;
                font-variant-numeric: tabular-nums;
            `;
            let calDaysTotal = 0;
            if (this.tasks.length > 0) {
                const minStart = Math.min(...this.tasks.map(t => t.startOffsetDays));
                const maxEnd = Math.max(...this.tasks.map(t => t.startOffsetDays + t.durationDays));
                calDaysTotal = maxEnd - minStart;
            }
            calDaysCell.textContent = `${Helpers.formatNumber(calDaysTotal)}кд`;
            calDaysCell.title = 'Календарных дней в общем диапазоне проекта';
            leftGroup.appendChild(calDaysCell);
        }

        if (this.showSumWorkingDaysColumn) {
            const sumWdCell = document.createElement('div');
            sumWdCell.style.cssText = `width:${this._sumWorkdaysW()}px; flex-shrink:0; font-size:10px; color:var(--md-text); text-align:right; padding-right:6px; font-variant-numeric:tabular-nums;`;
            sumWdCell.textContent = String(this._sumWorkdaysForTasks(this.tasks));
            sumWdCell.title = 'Сумма реально отработанных рабочих дней по всему проекту';
            leftGroup.appendChild(sumWdCell);
        }
        if (this.showSumHoursColumn) {
            const sumHCell = document.createElement('div');
            sumHCell.style.cssText = `width:${this._sumHoursW()}px; flex-shrink:0; font-size:10px; color:var(--md-text); text-align:right; padding-right:6px; font-variant-numeric:tabular-nums;`;
            sumHCell.textContent = Helpers.formatNumber(this._sumHoursForTasks(this.tasks));
            sumHCell.title = 'Сумма реально отработанных человеко-часов по всему проекту';
            leftGroup.appendChild(sumHCell);
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
                    const newOffset = parseInt(barEl.dataset.pendingOffset, 10);
                    const taskKey = task.taskKey || task.name;
                    // Раунд 148 (по жалобе Mr.D: "не могу редактировать
                    // графически протяжённость и начало работ у строк,
                    // созданных внутри диаграммы") - тот же класс бага,
                    // что уже чинил для текстового ввода Раб.дни/
                    // переименования (Раунд 145/146) - для вручную
                    // добавленной задачи (manualTasks) пишем НАПРЯМУЮ в
                    // manualTask.startOffsetDays - иначе правка уходит в
                    // this.taskDates, который _applyManualRowEdits() для
                    // вручную добавленных задач ВООБЩЕ НЕ ЧИТАЕТ (строит
                    // startOffsetDays только из mt.startOffsetDays).
                    const manualTask = this.manualTasks.find(t => t.key === taskKey);
                    if (manualTask) {
                        manualTask.startOffsetDays = newOffset;
                    } else {
                        this.taskDates[taskKey] = newOffset;
                    }
                    delete barEl.dataset.pendingOffset;
                    // Раунд 178 (по запросу Mr.D: "распространить такое
                    // же правило для графического редактирования, на
                    // перемещение по датам") - сдвиг ДЕЛЬТОЙ (разницей
                    // дней), не абсолютной новой датой - у остальных
                    // выделенных задач своё, ОТЛИЧНОЕ исходное
                    // положение, "поставить всех на ОДНУ дату" сломало
                    // бы их относительное расположение друг относительно
                    // друга - "подвинуть каждую на СТОЛЬКО ЖЕ дней,
                    // сколько подвинули эту" сохраняет расстояния между
                    // ними, как при перетаскивании группы объектов
                    // вместе в любом графическом редакторе.
                    const deltaDays = newOffset - startOffset;
                    this._propagateToMultiSelection(taskKey, (otherTask) => {
                        const otherKey = otherTask.taskKey || otherTask.name;
                        const otherNewOffset = Math.max(0, otherTask.startOffsetDays + deltaDays);
                        const otherManualTask = this.manualTasks.find(t => t.key === otherKey);
                        if (otherManualTask) {
                            otherManualTask.startOffsetDays = otherNewOffset;
                        } else {
                            this.taskDates[otherKey] = otherNewOffset;
                        }
                        this._rebaseDependencyGapsForTarget(otherKey, otherNewOffset);
                    });
                    // Раунд 139 (по уточнению Mr.D: "зависимость в одну
                    // сторону, по направлению стрелки - перемещение
                    // ЗАВИСИМОЙ [задачи-цели] не должно блокироваться") -
                    // если ЭТА задача - ЦЕЛЬ какой-то связи,
                    // _applyDependencyConstraints() на следующем
                    // пересчёте иначе тут же вернул бы её на старое
                    // место (жёстко удерживая СТАРЫЙ gap) - вместо этого
                    // ПЕРЕСЧИТЫВАЕМ gap под НОВУЮ позицию, куда только
                    // что перетащил пользователь - связь остаётся
                    // односторонней (источник по-прежнему двигает цель),
                    // но цель свободно перемещаема вручную, а не
                    // "заблокирована" старым зазором.
                    this._rebaseDependencyGapsForTarget(taskKey, newOffset);
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
                    const anchor = parseISODate(this.startDate) || new Date();
                    const workDays = Math.max(0.5, this._countWorkingDaysInRange(anchor, newOffset, newDuration));
                    // Раунд 148 (по жалобе Mr.D: "не могу редактировать
                    // графически протяжённость и начало работ у строк,
                    // созданных внутри диаграммы") - тот же класс бага,
                    // что уже чинил для перетаскивания/текстового ввода
                    // (Раунд 145/146/148) - для вручную добавленной
                    // задачи пишем НАПРЯМУЮ в manualTask, а не в общие
                    // override-словари (те для manualTasks не читаются).
                    const manualTask = this.manualTasks.find(t => t.key === key);
                    if (manualTask) {
                        manualTask.startOffsetDays = newOffset;
                        manualTask.durationDays = workDays;
                    } else {
                        this.taskDates[key] = newOffset;
                        // Багфикс (Раунд 83/118/141, по жалобе Mr.D: "к
                        // дню опять прибавляются праздники") -
                        // newDuration ниже - ВИЗУАЛЬНАЯ (календарная)
                        // ширина полосы после растягивания, но
                        // taskDurationOverrides хранит РАБОЧИЕ дни
                        // (единый принцип, ganttMath.js) - конвертируем
                        // через _countWorkingDaysInRange(), иначе
                        // spanWorkingDays() на следующем пересчёте
                        // пропустит выходные ВНУТРИ уже растянутого
                        // диапазона ЕЩЁ РАЗ, раздувая ширину на каждое
                        // редактирование.
                        this.taskDurationOverrides[key] = workDays;
                    }
                    // Раунд 178 (по запросу Mr.D: "распространить такое
                    // же правило для графического редактирования... на
                    // растягивание по срокам") - ТА ЖЕ итоговая
                    // длительность (в рабочих днях) на все остальные
                    // выделенные строки - собственный старт КАЖДОЙ
                    // задачи при этом не трогается (растягивание меняет
                    // ДЛИТЕЛЬНОСТЬ, не положение) - переиспользует
                    // _applyWorkDaysEdit(), ТУ ЖЕ логику, что уже
                    // применена к текстовому полю "Раб.дни" (единая
                    // точка правды, не дублирование).
                    this._propagateToMultiSelection(key, (otherTask) => this._applyWorkDaysEdit(otherTask, workDays, anchor));
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
                container.appendChild(this.createGanttArea(true));
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
        // Раунд 105 - "раб" (Раб.дни) тоже обязателен теперь (см.
        // tasksFromTable() - без него метод вернёт пустой список задач
        // молча) - "оконч" оставлен как структурный признак "это таблица
        // Гант-формата" (сама колонка в схеме buildOutputTable() всегда
        // есть), хотя больше не читается для расчёта.
        return headers.some(h => h.includes('начал')) && headers.some(h => h.includes('оконч')) && headers.some(h => h.includes('раб'));
    }

    // Раунд 130 (иерархия Ганта, чек-лист) - строит дерево Блок ->
    // Стадия -> Задача из ПЛОСКОГО списка задач (каждая уже несёт
    // blockName/stageName, см. tasksFromTable()). Порядок блоков/стадий -
    // по ПЕРВОМУ появлению в данных (не алфавитный) - совпадает с
    // порядком строк в исходной таблице, как и ожидает пользователь.
    //
    // Двухуровневый Блок (чек-лист, п.1.1: "# Блок, ### Задача,
    // пропуская уровень 2") - блок, в котором НИ У ОДНОЙ задачи нет
    // stageName - "stages" для него - null, задачи рендерятся ПРЯМО
    // под блоком (см. createGanttArea()). Смешанный случай (часть
    // задач блока со Стадией, часть - без) - задачи без Стадии просто
    // добавляются в "directTasks" блока (рендерятся до/после стадийных
    // строк, без собственного заголовка) - не идеальный, но
    // предсказуемый случай для нестрогих исходных данных.
    // Раунд 132 (по решению Mr.D: "трактовать графики внутри программы
    // не как таблицы, а как классические словари") - строит СТРУКТУРУ
    // ДЛЯ РЕНДЕРА (тот же вид {name, stages, directTasks}, что уже
    // понимает createGanttArea() с Раунда 130) НАПРЯМУЮ из дерева
    // GanttTableProcessorNode (this.treeData оттуда, см. её calculate()) -
    // БЕЗ прохода через плоскую таблицу с #/## маркерами в именах (тот
    // путь остаётся РАБОЧИМ для источников БЕЗ дерева - см.
    // tasksFromTable()/_buildHierarchyTree(), Раунд 130 - но теперь это
    // ЗАПАСНОЙ вариант, не единственный).
    //
    // Дерево-источник может быть ГЛУБЖЕ двух уровней (реальные файлы
    // Mr.D показали вложенность до "2.1.1" и глубже) - рендер Раунда
    // 130 поддерживает РОВНО два (Стадия/Задача) - более глубокие
    // "внучатые" узлы СПЛЮЩИВАЮТСЯ в задачи БЛИЖАЙШЕЙ вмещающей Стадии
    // (сама структура treeData при этом НЕ теряет вложенность - это
    // упрощение только для ОТРИСОВКИ, не для данных).
    // Раунд 158 (по запросу Mr.D: "данные, которые выдаёт
    // GanttTableProcessorNode, рассчитаны на старый обработчик... лишние
    // старые обработчики удалить, чтобы не мешались, и подогнать вывод
    // под существующую иерархию") - заменяет прежний
    // _hierarchyBlocksFromTreeData() - СРАЗУ строит массив в формате
    // taskGroups (с subgroups), а не отдельную структуру {stages,
    // directTasks}, которую раньше требовала ОТДЕЛЬНАЯ, дублирующая
    // ветка рендера (createGanttArea(), if (this.hierarchyBlocks)).
    // Блок (верхний уровень treeData) -> группа верхнего уровня, Стадия
    // (child.type==='stage' ИЛИ есть свои дети) -> вложенная подгруппа,
    // задача напрямую под Блоком (лист без вложенности) -> tasks самого
    // Блока. collapseKey - СТАБИЛЬНЫЙ ключ состояния сворачивания (не
    // позиционный индекс - тот "плавает" при сворачивании соседей, та
    // же проблема уже решалась для Раздел/Подраздел, Раунд 151).
    _groupsFromTreeData(treeData, anchor) {
        const toTask = (node, blockName, stageName) => {
            const startOffsetDays = node.start ? daysBetween(anchor, node.start) : 0;
            return {
                name: node.name,
                taskKey: node.name,
                startOffsetDays,
                rawWorkDays: node.rawWorkDays ?? 0,
                responsible: node.responsible || '',
                groupName: stageName || blockName,
                blockName,
                stageName,
                // Раунд 135 - сквозь дерево от GanttTableProcessorNode
                // (см. её calculate(), sectionNumber на узле).
                sectionNumber: node.sectionNumber ?? null
            };
        };

        // Раунд 158 (уточнение, по итогам честной оговорки в Раунде 152 -
        // "потребитель дерева понимает только 2 уровня, вложенность
        // глубже будет сплющена") - ПОЛНОСТЬЮ рекурсивная конвертация
        // ЛЮБОЙ глубины дерева (не только Блок->Стадия) - convertNode()
        // вызывает САМА СЕБЯ для КАЖДОГО непустого child, вместо
        // collectLeafTasks() (та СПЛЮЩИВАЛА всё глубже одного уровня
        // Стадии в плоский список). blockName - имя САМОГО ВЕРХНЕГО
        // предка (не меняется вглубь дерева - нужен для колонки "Блок"
        // в buildOutputTable(), там всего 2 текстовых столбца на всю
        // иерархию, произвольную глубину туда не уместить построчно) -
        // immediateParentName - имя НЕПОСРЕДСТВЕННОГО родителя (то же,
        // что раньше называлось "Стадия", теперь может быть ЛЮБЫМ
        // уровнем вложенности, не только вторым).
        const convertNode = (node, blockName, immediateParentName) => {
            const subgroups = [];
            const tasks = [];
            node.children.forEach(child => {
                if (child.children.length > 0) {
                    subgroups.push(convertNode(child, blockName ?? node.name, node.name));
                } else {
                    tasks.push(toTask(child, blockName ?? node.name, blockName != null ? node.name : null));
                }
            });
            return {
                name: node.name,
                tasks,
                subgroups,
                collapseKey: `node:${blockName ?? node.name}\u001f${node.name}`
            };
        };

        return (treeData?.roots || []).map(root => convertNode(root, null, null));
    }

    // Раунд 158 - заменяет прежний _buildHierarchyTree() - та же
    // конвертация в формат taskGroups, но источник - маркеры "#"/"##" в
    // НАЗВАНИЯХ задач ПЛОСКОЙ таблицы (Раунд 130), не дерево от
    // GanttTableProcessorNode.
    _groupsFromNameMarkers(tasks) {
        const blockOrder = [];
        const blockMap = new Map();
        const unblocked = [];

        tasks.forEach(t => {
            if (!t.blockName) { unblocked.push(t); return; }
            if (!blockMap.has(t.blockName)) {
                blockMap.set(t.blockName, { name: t.blockName, stageOrder: [], stageMap: new Map(), tasks: [] });
                blockOrder.push(t.blockName);
            }
            const block = blockMap.get(t.blockName);
            if (t.stageName) {
                if (!block.stageMap.has(t.stageName)) {
                    block.stageMap.set(t.stageName, { name: t.stageName, tasks: [], subgroups: [], collapseKey: `stage:${t.blockName}\u001f${t.stageName}` });
                    block.stageOrder.push(t.stageName);
                }
                block.stageMap.get(t.stageName).tasks.push(t);
            } else {
                block.tasks.push(t);
            }
        });

        const blocks = blockOrder.map(bName => {
            const b = blockMap.get(bName);
            return { name: b.name, tasks: b.tasks, subgroups: b.stageOrder.map(sName => b.stageMap.get(sName)), collapseKey: `block:${b.name}` };
        });

        // Задачи без блока вообще (обычно - строки ДО самого первого
        // маркера "#" в исходных данных) - отдельной синтетической
        // группой в конце, чтобы они не потерялись молча.
        if (unblocked.length > 0) {
            blocks.push({ name: '🗂 Без блока', tasks: unblocked, subgroups: [], collapseKey: 'block:__unblocked__' });
        }
        return blocks;
    }

    // Раунд 158 - рекурсивно переустанавливает ссылки на объекты задач
    // ВНУТРИ taskGroups/subgroups по свежепересчитанным (durationDays/
    // startOffsetDays) значениям из this.tasks - та же необходимость,
    // что решал прежний код для hierarchyBlocks (единая точка правды по
    // датам между плоским this.tasks и деревом taskGroups).
    _resyncGroupsTasks(groups, byKey) {
        groups.forEach(g => {
            g.tasks = g.tasks.map(t => byKey.get(t.taskKey) || t);
            this._resyncGroupsTasks(g.subgroups || [], byKey);
        });
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
        // Раунд 105 (уточнение Mr.D после Раунда 104 - предыдущая версия
        // была неверной в другую сторону): "Начало" и "Раб.дни" -
        // ЕДИНСТВЕННЫЕ авторитетные входы для расчёта. "Окончание"/
        // "Факт.дни" НЕ ЧИТАЮТСЯ здесь вообще - конечная позиция задачи
        // всегда пересчитывается САМИМ GanttNode через spanWorkingDays()
        // (Начало + Раб.дни -> Окончание, с учётом this.holidaySet) -
        // см. calculate(), однократный источник истины, тот же принцип,
        // что уже верно работает для задач из простого списка. Раньше
        // источник (например, "Обработка таблиц Ганта") мог "подсунуть"
        // уже готовую дату окончания, которая перекрывала бы этот
        // внутренний пересчёт - именно это Mr.D описал как "подключённые
        // данные перекрывают вычисления внутри диаграммы".
        const startCol = tableData.columns.find(c => (c.header || '').toLowerCase().includes('начал'));
        const workdaysCol = tableData.columns.find(c => (c.header || '').toLowerCase().includes('раб'));
        // Багфикс (Раунд 87, по жалобе Mr.D: "генерация группы полностью
        // завязано на сокеты, и не передаётся... группы должны
        // распознаваться из переданных data") - раньше столбец "Группа"
        // вообще не читался здесь: единственный способ сгруппировать
        // задачи был подключить НЕСКОЛЬКО источников на разные сокеты
        // (см. calculate() ниже) - если один-единственный источник УЖЕ
        // нёс готовые группы в данных (например, "Обработка таблиц
        // Ганта" со своими разделами), эта информация просто терялась.
        // Теперь читаем "Группа" из самих данных - см. calculate() про
        // то, как это используется для построения this.taskGroups.
        const groupCol = tableData.columns.find(c => (c.header || '').toLowerCase().includes('групп'));
        // Раунд 88 (чек-лист 1.7.21) - "Ответственный" из данных, тем же
        // приёмом, что "Группа" в Раунде 87 - авторитетное значение из
        // исходной таблицы, не дефолт.
        const responsibleCol = tableData.columns.find(c => (c.header || '').toLowerCase().includes('ответствен'));
        if (!startCol || !workdaysCol) return [];

        const anchor = parseISODate(this.startDate) || new Date();
        const tasks = [];
        // Раунд 130 (чек-лист, "Диаграмма Ганта - улучшение иерархии") -
        // маркеры Блок (#)/Стадия (##) распознаются ПРЯМО В НАЗВАНИИ
        // задачи - та же нотация, что в самом чек-листе ("# Блок",
        // "## Стадия", "### Задача"). currentBlock/currentStage -
        // "текущий контекст" по мере чтения строк сверху вниз (тот же
        // принцип, что у обычных Excel-таблиц с "шапками разделов" -
        // разметочная строка задаёт контекст для ВСЕХ следующих строк,
        // пока не встретится следующая разметочная). КРИТИЧНО - маркеры
        // распознаются ДО проверки на дату ("Начало") ниже: у
        // строки-маркера даты нет и не может быть по своей природе
        // (это не задача, а заголовок раздела) - если бы проверка шла
        // раньше, такая строка молча пропадала бы, а "текущий контекст"
        // никогда бы не обновился.
        let currentBlock = null;
        let currentStage = null;
        let hierarchyDetected = false;

        for (let i = 0; i < tableData.rowCount; i++) {
            const rawName = nameCol ? String(nameCol.values[i] ?? '') : '';

            const blockMatch = rawName.match(/^#\s+(.+)$/);
            const stageMatch = !blockMatch && rawName.match(/^##\s+(.+)$/);
            if (blockMatch) {
                currentBlock = blockMatch[1].trim();
                currentStage = null; // новый Блок - контекст Стадии сбрасывается
                hierarchyDetected = true;
                continue;
            }
            if (stageMatch) {
                currentStage = stageMatch[1].trim();
                hierarchyDetected = true;
                continue;
            }

            // Обычная задача - "###" перед ней (явный маркер уровня 3,
            // необязательный - задача без ЛЮБОГО префикса тоже
            // прекрасно распознаётся как задача) просто убирается из
            // отображаемого имени.
            const name = (rawName.replace(/^###\s+/, '').trim() || `Задача ${i + 1}`);
            const startD = parseDateRu(startCol.values[i]) || parseISODate(startCol.values[i]);
            if (!startD) continue;
            const rawWorkDays = Math.max(0, Number(workdaysCol.values[i]) || 0);
            const groupNameRaw = groupCol ? groupCol.values[i] : null;
            const responsibleRaw = responsibleCol ? responsibleCol.values[i] : null;
            tasks.push({
                name,
                startOffsetDays: daysBetween(anchor, startD),
                groupName: (groupNameRaw !== null && groupNameRaw !== undefined && String(groupNameRaw).trim())
                    ? String(groupNameRaw).trim()
                    : null,
                // Раунд 130 - иерархия Блок/Стадия, независимо от
                // groupName (старый однoуровневый механизм - остаётся
                // рабочим как есть для таблиц БЕЗ #/## маркеров).
                blockName: currentBlock,
                stageName: currentStage,
                responsible: (responsibleRaw !== null && responsibleRaw !== undefined && String(responsibleRaw).trim())
                    ? String(responsibleRaw).trim()
                    : '',
                // Раунд 105 - сырое число рабочих дней из источника, ЕЩЁ
                // БЕЗ учёта выходных/праздников (см. calculate() - там
                // это число идёт в spanWorkingDays() с this.holidaySet,
                // и в single-режиме, и в групповом - единая точка правды).
                rawWorkDays
            });
        }
        // Раунд 130 - флаг "иерархия обнаружена" прикреплён К САМОМУ
        // МАССИВУ (не меняем сигнатуру функции - другие места кода уже
        // ожидают простой массив в возврате) - calculate() читает его
        // сразу после вызова, решает, строить ли this.hierarchyBlocks.
        tasks.hierarchyDetected = hierarchyDetected;
        return tasks;
    }

    // Раунд 152 (по запросу Mr.D: "выходной сокет диаграммы... в теории
    // диаграмма на выходе должна иметь стерилизованный [сериализованный]
    // словарь, а просмотр дерева был создан как раз для просмотра
    // различных словарей") - строит древовидный словарь ИЗ ТЕКУЩЕГО
    // состояния диаграммы (this.taskGroups с subgroups, ЛЮБАЯ глубина
    // вложенности) - формат УЖЕ совместим с тем, что производит
    // GanttTableProcessorNode.treeData (см. её calculate()) и что УЖЕ
    // умеет читать ЭТА ЖЕ нода на входе (см. calculate() выше,
    // `if (output?.treeData...)`), а также TreeViewerNode (та "была
    // создана как раз для просмотра различных словарей" - подключение
    // ЭТОГО выхода к ней покажет структуру диаграммы как дерево).
    //
    // ВАЖНАЯ ОГОВОРКА (сообщаю честно, не молчу) - потребитель дерева
    // на СТОРОНЕ ДРУГОЙ Диаграммы Ганта (_hierarchyBlocksFromTreeData(),
    // построена в Раунде 130 ДО того, как появилась произвольная
    // вложенность Раздел/Подраздел, Раунд 150) понимает ТОЛЬКО ДВА
    // уровня (Блок -> Стадия -> сплющенные задачи) - если ЭТА диаграмма
    // подключается к ДРУГОЙ Диаграмме Ганта, вложенность ГЛУБЖЕ второго
    // уровня (Подраздел -> ПодПодраздел) будет сплющена на приёмнике
    // (тот СПЛОЩИВАЕТ всё глубже Стадии в единый список задач). Через
    // TreeViewerNode - произвольная глубина сохраняется ПОЛНОСТЬЮ (тот
    // не имеет такого ограничения). Полное устранение ограничения
    // потребует отдельной, более крупной доработки
    // _hierarchyBlocksFromTreeData() под произвольную глубину.
    _buildTreeDataOutput() {
        const anchor = parseISODate(this.startDate) || new Date();
        const taskToNode = (t) => ({
            name: t.name,
            type: 'task',
            responsible: this._effectiveResponsible(t) || '',
            start: addDays(anchor, t.startOffsetDays),
            rawWorkDays: this._countWorkingDaysInRange(anchor, t.startOffsetDays, t.durationDays),
            sectionNumber: this._effectiveSection(t) || null,
            children: []
        });
        // Раунд 158 (косметика, для консистентности с самой
        // GanttTableProcessorNode.calculate() - та метит КОРЕНЬ 'block',
        // вложенные узлы - 'stage') - isRoot параметризует метку типа;
        // потребитель (_groupsFromTreeData() выше) уже НЕ различает эти
        // метки функционально (смотрит только на children.length > 0),
        // но для единообразия самих данных на выходе лучше совпадать.
        const groupToNode = (g, isRoot) => ({
            name: g.name,
            type: isRoot ? 'block' : 'stage',
            responsible: '',
            start: null,
            rawWorkDays: 0,
            sectionNumber: null,
            children: [
                ...g.tasks.map(taskToNode),
                ...(g.subgroups || []).map(sg => groupToNode(sg, false))
            ]
        });

        if (Array.isArray(this.taskGroups) && this.taskGroups.length > 0) {
            return { roots: this.taskGroups.map(g => groupToNode(g, true)) };
        }
        // Без разделов (плоский список задач) - один синтетический
        // корень с именем ноды, дети - все задачи напрямую (тот же
        // приём, что "безымянная" группа для задач без раздела внутри
        // _applyPromotedSections()).
        return { roots: [{ name: this.customName || this.getDisplayName(), type: 'block', responsible: '', start: null, rawWorkDays: 0, sectionNumber: null, children: this.tasks.map(taskToNode) }] };
    }

    buildOutputTable() {
        const anchor = parseISODate(this.startDate) || new Date();
        const blocks = [];
        const stages = [];
        const groups = [];
        const names = [];
        const starts = [];
        const workdays = [];
        const ends = [];
        const factDays = [];
        const responsible = [];

        this.tasks.forEach(t => {
            blocks.push(t.blockName || '');
            stages.push(t.stageName || '');
            groups.push(t.groupName || '');
            names.push(t.name);
            starts.push(formatDateRu(addDays(anchor, t.startOffsetDays)));
            workdays.push(this._countWorkingDaysInRange(anchor, t.startOffsetDays, t.durationDays));
            ends.push(formatDateRu(addDays(anchor, t.startOffsetDays + t.durationDays)));
            factDays.push(t.durationDays);
            // Раунд 88 - ручное переопределение (this.taskResponsible,
            // Раунд 83) в приоритете, иначе - значение из данных
            // источника (t.responsible, читается tasksFromTable() из
            // столбца "Ответственный" - тот же принцип, что уже
            // применён к "Группе" в Раунде 87).
            responsible.push(this.taskResponsible[t.taskKey] || t.responsible || '');
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
        //
        // Раунд 130 (иерархия Ганта, чек-лист - "Экспорт в Excel с
        // уровнями в отдельных столбцах") - "Блок"/"Стадия" добавляются
        // ПЕРЕД "Группа" ТОЛЬКО когда иерархия реально обнаружена
        // (this._taskGroupsIsHierarchical) - для обычных (не
        // иерархических) диаграмм схема остаётся РОВНО семиколоночной,
        // как зафиксировано в Раунде 83 - никого не ломаем. Раунд 158
        // (багфикс) - условие раньше ссылалось на this.hierarchyBlocks
        // (тот теперь всегда null - структура унифицирована под
        // taskGroups) - колонки молча переставали добавляться даже для
        // РЕАЛЬНО иерархических диаграмм.
        const columns = [];
        if (this._taskGroupsIsHierarchical) {
            columns.push({ header: 'Блок', values: blocks, format: 'text' });
            columns.push({ header: 'Стадия', values: stages, format: 'text' });
        }
        columns.push(
            { header: 'Группа', values: groups, format: 'text' },
            { header: 'Задача', values: names, format: 'text' },
            { header: 'Начало', values: starts, format: 'text' },
            { header: 'Раб.дни', values: workdays, format: 'number' },
            { header: 'Окончание', values: ends, format: 'text' },
            { header: 'Факт.дни', values: factDays, format: 'number' },
            { header: 'Ответственный', values: responsible, format: 'text' }
        );

        return new TableData(columns, { title: this.customName || this.getDisplayName() });
    }

    calculate(nodeManager) {
        this.checkAndAddEmptySlot();
        // Раунд 158 - сбрасывается КАЖДЫЙ пересчёт (не "протекает" из
        // предыдущего цикла) - true устанавливается ТОЛЬКО в ветках,
        // где this.taskGroups строится ИЗ иерархического источника
        // (treeData/#-маркеры, см. _applyManualRowEdits() выше про то,
        // зачем это нужно).
        this._taskGroupsIsHierarchical = false;

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
        // сокет 0) - см. конструктор про this.inputSockets. Раунд 84 -
        // вместе с узлом-источником сразу читаем его output через
        // getSourceOutput(conn) - учитывает конкретный сокет источника у
        // многовыходных нод (см. baseNode.js/nodeManager.js), а не
        // node.tableData/node.listData напрямую (та схема не различала
        // сокеты одного рода данных).
        const sourceConns = this.inputSockets
            .map(idx => connections.find(c => c.targetNodeId === this.id && c.targetSocket === idx))
            .filter(Boolean);
        const sources = sourceConns
            .map(conn => {
                const node = nodeManager.getNode(conn.sourceNodeId);
                if (!node) return null;
                return { node, output: nodeManager.getSourceOutput(conn) };
            })
            .filter(Boolean);

        this._sourceStatuses = this.inputSockets.map(idx => {
            const conn = connections.find(c => c.targetNodeId === this.id && c.targetSocket === idx);
            const node = conn ? nodeManager.getNode(conn.sourceNodeId) : null;
            if (!node) return { socketIndex: idx, name: null };
            const output = nodeManager.getSourceOutput(conn);
            const isTable = output?.tableData && output.tableData.columns.length > 0 && this.isCompatibleTable(output.tableData);
            return {
                socketIndex: idx,
                name: node.customName || node.getDisplayName?.() || 'источник',
                mode: Array.isArray(node.tasks) ? 'gantt' : (isTable ? 'table' : 'list'),
                count: Array.isArray(node.tasks) ? node.tasks.length : undefined
            };
        });

        // Раунд 95 (чек-лист, п.2.1) - Заголовок/Подзаголовок: приоритет
        // ЯВНО заданный порядком в задаче - сокет (если что-то подключено
        // к TITLE_INPUT_SOCKET_INDEX/SUBTITLE_INPUT_SOCKET_INDEX) ->
        // метаданные (tableData.metadata.title у ПЕРВОГО источника задач -
        // например, если подключена "Обработка таблиц Ганта", там уже
        // есть настоящий заголовок листа) -> ручной ввод в инспекторе
        // (this.customName/this.subtitleText, прежнее поведение).
        const titleConn = connections.find(c => c.targetNodeId === this.id && c.targetSocket === TITLE_INPUT_SOCKET_INDEX);
        const subtitleConn = connections.find(c => c.targetNodeId === this.id && c.targetSocket === SUBTITLE_INPUT_SOCKET_INDEX);

        const resolveTextInput = (conn, metadataFallback, manualFallback) => {
            if (conn) {
                const out = nodeManager.getSourceOutput(conn);
                const fromSocket = (typeof out?.value === 'string' && out.value.trim())
                    ? out.value.trim()
                    : (out?.tableData?.columns?.[0]?.values?.[0] ?? null);
                if (fromSocket !== null && fromSocket !== undefined && String(fromSocket).trim()) {
                    return String(fromSocket).trim();
                }
            }
            if (metadataFallback && String(metadataFallback).trim()) return String(metadataFallback).trim();
            return manualFallback;
        };

        const firstSourceMetaTitle = sources[0]?.output?.tableData?.metadata?.title || null;
        this._resolvedTitle = resolveTextInput(titleConn, firstSourceMetaTitle, this.customName || this.getDisplayName());
        this._resolvedSubtitle = resolveTextInput(subtitleConn, null, this.subtitleText);

        if (sources.length === 0) {
            this.sourceMode = 'list';
            this.taskGroups = null;
            this.tasks = [];
            this._applyManualRowEdits();
            this._applyDependencyConstraints();
            this._detectResponsiblesAndGroups();
            this.tableData = this.buildOutputTable();
            this.treeData = this._buildTreeDataOutput();
            this.value = 0;
            syncNodeToBoards(this);
            return this.value;
        }

        // Ровно ОДИН источник - прежнее поведение без единого изменения
        // (совместимо с проектами, сохранёнными до Раунда 78). Группировка
        // (полупрозрачная подложка + строка-заголовок группы) появляется
        // ТОЛЬКО когда источников 2 или больше - см. докстринг класса.
        if (sources.length === 1) {
            const { node: src, output } = sources[0];
            this.taskGroups = null;

            // Раунд 132 (по решению Mr.D: "трактовать графики внутри
            // программы не как таблицы, а как классические словари") -
            // ЕСЛИ источник несёт дерево (GanttTableProcessorNode,
            // Раунд 132) - используем ЕГО НАПРЯМУЮ, в ПРИОРИТЕТЕ над
            // табличным путём ниже (тот остаётся для источников БЕЗ
            // дерева - прямой импорт Excel/JSON, другие узлы,
            // передающие обычную таблицу).
            if (output?.treeData && output.treeData.roots?.length > 0) {
                this.sourceMode = 'table'; // та же семантика override-механизма (Раунд 118), что у обычной таблицы

                if (this.autoAnchorFromData) {
                    const allDates = [];
                    const collectDates = (node) => {
                        if (node.start) allDates.push(node.start);
                        node.children.forEach(collectDates);
                    };
                    output.treeData.roots.forEach(collectDates);
                    if (allDates.length > 0) {
                        const minDate = new Date(Math.min(...allDates.map(d => d.getTime())));
                        const minIso = minDate.toISOString().slice(0, 10);
                        if (minIso !== this.startDate) this.startDate = minIso;
                    }
                }

                const anchor = parseISODate(this.startDate) || new Date();
                // Раунд 158 (по запросу Mr.D: "лишние старые обработчики
                // удалить, чтобы не мешались, и подогнать вывод под
                // существующую иерархию") - _groupsFromTreeData() строит
                // СРАЗУ this.taskGroups (с subgroups) - единая система
                // рендера (createGanttArea(), ветка this.taskGroups,
                // рекурсивный обход - Раунд 150) вместо отдельной,
                // дублирующей ветки this.hierarchyBlocks (убрана целиком).
                this.taskGroups = this._groupsFromTreeData(output.treeData, anchor);
                this._skipTaskGroupsRebuild = true;
                this._taskGroupsIsHierarchical = true;

                // Раунд 132 - плоский this.tasks (нужен ОСТАЛЬНОМУ коду -
                // итоги/цвета/экспорт/drag) - собирается ИЗ только что
                // построенного taskGroups, с ТЕМ ЖЕ применением overrides/
                // spanWorkingDays(), что у табличного пути ниже (единая
                // точка правды по датам).
                const flatFromTree = this.taskGroups.flatMap(g => this._allTasksRecursive(g));
                this.tasks = flatFromTree.map(t => {
                    // Раунд 141 (по решению Mr.D: "перепроверить
                    // математический узел и обращения к нему - есть
                    // ошибка с фиксацией диаграммы, перестаёт
                    // подстраиваться под выходные") - найденный пробел:
                    // в отличие от списочного режима, эта ветка НЕ
                    // применяла nextWorkingOffset() к старту ПЕРЕД
                    // spanWorkingDays() - если сама дата старта (из
                    // декодированного Excel, или из ручного
                    // перетаскивания) попадала на выходной/праздник, он
                    // не переносился - расхождение с остальными ветками
                    // устранено, тот же порядок действий везде.
                    const rawStartOffsetDays = this.taskDates[t.taskKey] ?? t.startOffsetDays;
                    const startOffsetDays = nextWorkingOffset(anchor, rawStartOffsetDays, this.holidaySet);
                    const workDaysForSpan = this.taskDurationOverrides[t.taskKey] ?? t.rawWorkDays;
                    const computedEndOffset = spanWorkingDays(anchor, startOffsetDays, workDaysForSpan, this.holidaySet);
                    const durationDays = Math.max(0, computedEndOffset - startOffsetDays);
                    return { ...t, durationDays, startOffsetDays };
                });
                // taskGroups сам по себе хранит "сырые" (ДО override/
                // spanWorkingDays) задачи - createGanttArea() читает
                // durationDays/startOffsetDays именно из НЕГО при отрисовке -
                // синхронизируем те же пересчитанные значения обратно в
                // объекты дерева (рекурсивно, включая subgroups), чтобы
                // оба представления (плоское/иерархическое) не разошлись.
                const byKey = new Map(this.tasks.map(t => [t.taskKey, t]));
                this._resyncGroupsTasks(this.taskGroups, byKey);

                this._applyManualRowEdits();
                this._applyDependencyConstraints();
                this._detectResponsiblesAndGroups();
                this.tableData = this.buildOutputTable();
                this.treeData = this._buildTreeDataOutput();
                this.value = this.tasks.length;
                syncNodeToBoards(this);
                return this.value;
            }

            if (output?.tableData && output.tableData.columns.length > 0 && this.isCompatibleTable(output.tableData)) {
                this.sourceMode = 'table';

                // Раунд 99 - автопривязка this.startDate к самой ранней
                // дате "Начало" в источнике, ДО вызова tasksFromTable()
                // (та использует this.startDate как anchor для смещений -
                // если поправить якорь ПОСЛЕ, пришлось бы пересчитывать
                // все смещения задним числом; так - смещения сразу
                // считаются от правильного anchor, без лишней работы).
                if (this.autoAnchorFromData) {
                    const startCol = output.tableData.columns.find(c => (c.header || '').toLowerCase().includes('начал'));
                    if (startCol) {
                        const parsedDates = startCol.values
                            .map(v => parseDateRu(v) || parseISODate(v))
                            .filter(Boolean);
                        if (parsedDates.length > 0) {
                            const minDate = new Date(Math.min(...parsedDates.map(d => d.getTime())));
                            const minIso = minDate.toISOString().slice(0, 10);
                            if (minIso !== this.startDate) this.startDate = minIso;
                        }
                    }
                }

                // Раунд 105 - anchor считается ЗДЕСЬ, ПОСЛЕ возможного
                // автообновления this.startDate выше - иначе
                // spanWorkingDays() ниже использовал бы устаревший якорь.
                const anchor = parseISODate(this.startDate) || new Date();

                // Раунд 130 - hierarchyDetected прикреплён к МАССИВУ, а
                // не к каждой задаче - .map() ниже создаёт НОВЫЙ массив,
                // теряя это свойство - забираем его ДО .map().
                const rawTableTasks = this.tasksFromTable(output.tableData);
                const hierarchyDetected = !!rawTableTasks.hierarchyDetected;

                this.tasks = rawTableTasks.map(t => {
                    // Багфикс (Раунд 86, по жалобе Mr.D: "могу
                    // растягивать графики, но не могу двигать") -
                    // durationDays уже читал taskDurationOverrides (её
                    // ставит и растягивание, и обычное перетаскивание не
                    // трогает), а startOffsetDays ВСЕГДА брался заново из
                    // столбца "Начало" исходной таблицы - taskDates
                    // (куда пишет обычное перетаскивание позиции,
                    // attachBarDrag()) тут просто не читался. Обычное
                    // перетаскивание визуально двигало полосу во время
                    // драга, но на следующем пересчёте позиция снова
                    // бралась из таблицы - drag НИКОГДА не сохранялся в
                    // этом режиме. Теперь симметрично: startOffsetDays
                    // тоже читает override, если он есть.
                    const startOffsetDaysRaw = this.taskDates[t.name] ?? t.startOffsetDays;
                    // Раунд 141 (по решению Mr.D: "перепроверить
                    // математический узел и обращения к нему - есть
                    // ошибка с фиксацией диаграммы, перестаёт
                    // подстраиваться под выходные") - добавлен
                    // nextWorkingOffset() ПЕРЕД spanWorkingDays() (тот же
                    // порядок, что в списочном режиме) - без него старт,
                    // попавший на выходной/праздник (из самих данных
                    // источника, или из ручного перетаскивания), не
                    // переносился на ближайший рабочий день.
                    const startOffsetDays = nextWorkingOffset(anchor, startOffsetDaysRaw, this.holidaySet);
                    // Раунд 105 (по прямому уточнению Mr.D: "внутренний
                    // механизм ноды Диаграмма Ганта должен ВСЕГДА верно
                    // пересчитывать кол-во дней" - источник больше не
                    // может "перекрыть" этот расчёт готовой датой
                    // окончания) - дефолтная длительность ВСЕГДА через
                    // spanWorkingDays() (Начало+Раб.дни -> Окончание, с
                    // учётом this.holidaySet) - тот же самый механизм,
                    // что уже верно работает для задач из простого
                    // списка (см. её же использование чуть ниже, в ветке
                    // sourceMode==='list').
                    //
                    // Раунд 118 (багфикс, по жалобе Mr.D: "меняю
                    // протяжённость рабочих дней, график перестаёт
                    // прибавлять выходные") - taskDurationOverrides
                    // теперь ТОЖЕ число РАБОЧИХ дней (не готовая
                    // календарная ширина, см. _applyWorkDaysEdit()/
                    // attachBarResize()) - ОБЯЗАТЕЛЬНО тоже проходит
                    // через spanWorkingDays() с ТЕКУЩИМ this.holidaySet -
                    // иначе однажды отредактированная задача "замерзала"
                    // на старой ширине и переставала реагировать на
                    // изменения календаря/праздников после редактирования.
                    const workDaysForSpan = this.taskDurationOverrides[t.name] ?? t.rawWorkDays;
                    const computedEndOffset = spanWorkingDays(anchor, startOffsetDays, workDaysForSpan, this.holidaySet);
                    const durationDays = Math.max(0, computedEndOffset - startOffsetDays);
                    return { ...t, taskKey: t.name, durationDays, startOffsetDays };
                });

                // Багфикс (Раунд 87, по жалобе Mr.D: "генерация группы
                // полностью завязано на сокеты, и не передаётся... группы
                // должны распознаваться из переданных data") - если сама
                // таблица уже несёт готовые группы (столбец "Группа" с
                // 2+ разными непустыми значениями - например, от
                // "Обработки таблиц Ганта" со своими разделами), строим
                // this.taskGroups ИЗ НИХ, даже когда источник ровно один
                // (раньше группировка появлялась ТОЛЬКО при нескольких
                // источниках на разных сокетах - данные внутри
                // единственного источника игнорировались полностью).
                // Порядок групп - по первому появлению в данных, порядок
                // задач внутри группы - как в исходной таблице.
                const distinctGroups = [...new Set(this.tasks.map(t => t.groupName).filter(Boolean))];
                this.taskGroups = distinctGroups.length >= 2
                    ? distinctGroups.map(gName => ({
                        name: gName,
                        tasks: this.tasks.filter(t => t.groupName === gName)
                    }))
                    : null;

                // Раунд 130 (иерархия Ганта, чек-лист) - строится ТОЛЬКО
                // если реально были найдены маркеры #/## в названиях
                // задач - иначе оставляем this.taskGroups как есть (уже
                // установлен чуть выше - либо одноуровневая группировка,
                // либо null для одиночного, негруппированного источника).
                // Раунд 158 - _groupsFromNameMarkers() строит СРАЗУ
                // taskGroups (с subgroups), ПЕРЕЗАПИСЫВАЯ более простую
                // одноуровневую группировку выше, когда маркеры найдены -
                // та же единая система рендера, что и у остальных путей
                // (this.hierarchyBlocks убран целиком).
                if (hierarchyDetected) {
                    this.taskGroups = this._groupsFromNameMarkers(this.tasks);
                    this._skipTaskGroupsRebuild = true;
                    this._taskGroupsIsHierarchical = true;
                }

                this._applyManualRowEdits();
                this._applyDependencyConstraints();
                this._detectResponsiblesAndGroups();
                this.tableData = this.buildOutputTable();
                this.treeData = this._buildTreeDataOutput();
                this.value = this.tasks.length;
                syncNodeToBoards(this);
                return this.value;
            }

            this.sourceMode = 'list';
            const items = output?.listData?.items || [];
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

                // Раунд 141 (по решению Mr.D: "все расчёты ведутся в
                // рабочих днях") - переключаемого scheduleMode больше
                // нет - планирование ВСЕГДА идёт через nextWorkingOffset()/
                // spanWorkingDays() (единый принцип хранения дат, см.
                // докстринг ganttMath.js).
                let startOffsetDaysWorking = nextWorkingOffset(anchor, startOffsetDays, this.holidaySet);
                const endOffsetDays = spanWorkingDays(anchor, startOffsetDaysWorking, duration, this.holidaySet);
                startOffsetDays = startOffsetDaysWorking;

                cursor = Math.max(cursor, endOffsetDays);
                return { name, taskKey: name, durationDays: endOffsetDays - startOffsetDays, startOffsetDays, responsible: '' };
            });

            this._applyManualRowEdits();
            this._applyDependencyConstraints();
            this._detectResponsiblesAndGroups();
            this.tableData = this.buildOutputTable();
            this.treeData = this._buildTreeDataOutput();
            this.value = this.tasks.length;
            syncNodeToBoards(this);
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

        // Багфикс (Раунд 87) - тот же принцип, что и в однослойном
        // режиме выше: если сырые задачи источника уже несут СВОЮ группу
        // (данные, столбец "Группа" - см. tasksFromTable()), она
        // используется вместо имени сокета-источника - тот остаётся
        // только запасным вариантом для источников БЕЗ собственного
        // понятия группы (обычный список). Один источник теперь МОЖЕТ
        // дать несколько итоговых групп (если несёт свою "Группу"),
        // несколько источников без своих групп по-прежнему сольются
        // каждый в одну группу (имя источника) - прежнее поведение.
        //
        // Ключ в this.taskDates/taskDurationOverrides по-прежнему
        // учитывает исходный ИНДЕКС СОКЕТА (не имя итоговой группы) -
        // имена групп из разных источников МОГУТ совпадать, а сокеты -
        // нет; это гарантирует уникальность ключа независимо от того,
        // как задачи потом сгруппируются по данным.
        const tasksBySocket = sources.map(({ node: src, output }, socketIndex) => {
            const fallbackName = src.customName || src.getDisplayName?.() || `Источник ${socketIndex + 1}`;
            const rawTasks = this._extractRawTasks(src, output);

            let cursor = 0;
            return rawTasks.map(rt => {
                const key = `${socketIndex}:${rt.name}`;
                const duration = this.taskDurationOverrides[key] ?? rt.durationDays;
                let startOffsetDays = this.taskDates[key];
                if (startOffsetDays === undefined) {
                    startOffsetDays = cursor;
                    this.taskDates[key] = startOffsetDays;
                }

                // Раунд 141 (по решению Mr.D: "все расчёты ведутся в
                // рабочих днях") - переключаемого scheduleMode больше
                // нет - планирование ВСЕГДА идёт через nextWorkingOffset()/
                // spanWorkingDays() (единый принцип хранения дат, см.
                // докстринг ganttMath.js).
                let startOffsetDaysWorking = nextWorkingOffset(anchor, startOffsetDays, this.holidaySet);
                const endOffsetDays = spanWorkingDays(anchor, startOffsetDaysWorking, duration, this.holidaySet);
                startOffsetDays = startOffsetDaysWorking;

                cursor = Math.max(cursor, endOffsetDays);
                return {
                    name: rt.name,
                    taskKey: key,
                    durationDays: endOffsetDays - startOffsetDays,
                    startOffsetDays,
                    groupName: rt.groupName || fallbackName,
                    responsible: rt.responsible || ''
                };
            });
        });

        // "Расплющиваем" задачи ВСЕХ источников и группируем по их
        // ИТОГОВОЙ groupName (данные, если есть, иначе имя источника) -
        // не по индексу сокета напрямую. Порядок групп - по первому
        // появлению.
        const flatTasks = tasksBySocket.flat();
        const distinctGroupNames = [...new Set(flatTasks.map(t => t.groupName))];
        this.taskGroups = distinctGroupNames.map(gName => ({
            name: gName,
            tasks: flatTasks.filter(t => t.groupName === gName)
        }));
        // Раунд 130 - иерархия Блок/Стадия пока распознаётся ТОЛЬКО из
        // единственного табличного источника (см. sources.length===1
        // выше) - при 2+ источниках сбрасываем в null явно (защита от
        // "залипания" значения, оставшегося от предыдущего пересчёта,
        // если пользователь только что переключился с одного источника
        // на несколько).

        this.tasks = flatTasks;
        this._applyManualRowEdits();
        this._applyDependencyConstraints();
        this._detectResponsiblesAndGroups();
        this.tableData = this.buildOutputTable();
        this.treeData = this._buildTreeDataOutput();
        this.value = this.tasks.length;
        syncNodeToBoards(this);
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
    // Раунд 84 - принимает node (сама нода-источник, для .tasks и имени)
    // и output (результат getSourceOutput(conn) - учитывает конкретный
    // выходной сокет многовыходных источников) РАЗДЕЛЬНО - .tasks не
    // входит в стандартный набор getOutputBySocket() (это специфичное
    // для GanttNode поле, не часть общего контракта), поэтому его
    // проверяем прямо на node, а table/list - через output.
    _extractRawTasks(node, output) {
        if (output?.tableData && output.tableData.columns.length > 0 && this.isCompatibleTable(output.tableData)) {
            return this.tasksFromTable(output.tableData).map(t => ({ name: t.name, durationDays: t.rawWorkDays, groupName: t.groupName, responsible: t.responsible }));
        }
        if (Array.isArray(node.tasks) && node.tasks.length > 0) {
            return node.tasks.map(t => ({ name: t.name, durationDays: t.durationDays, groupName: t.groupName || null, responsible: t.responsible || '' }));
        }
        const items = output?.listData?.items || [];
        return items.map(item => ({
            name: item.name || 'Задача',
            durationDays: Math.max(0, this.durationUnit === 'hours' ? (item.value || 0) / HOURS_PER_WORKDAY : (item.value || 0)),
            groupName: null,
            responsible: ''
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
            this._replaceGanttSlot(slot);
        }

        const outputCount = element.querySelector('.gantt-output-count');
        if (outputCount) outputCount.textContent = `${this.tasks.length} задач`;

        const titleHint = element.querySelector('.gantt-titlesub-hint-1');
        if (titleHint) titleHint.textContent = (this._resolvedTitle ?? (this.customName || this.getDisplayName())) || '—';
        const subtitleHint = element.querySelector('.gantt-titlesub-hint-2');
        if (subtitleHint) subtitleHint.textContent = (this._resolvedSubtitle ?? this.subtitleText) || '—';
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

    // Раунд 88 - плашка "beta" снята (чек-лист 1.7.21, п.4) - нода
    // прошла достаточно раундов доработки/проверки (Раунды 73-87) и
    // больше не является экспериментальной в том смысле, в каком была
    // изначально помечена (Раунд 44).
    getStaticBadges() {
        return [];
    }

    // Боковая панель: календарь плана (дата начала/период отображения/
    // единица длительности)
    getInspectorSchema() {
        const fields = super.getInspectorSchema();

        // Раунд 108 (последняя задача для Ганта из чек-листа) - панель
        // разбита на два сворачиваемых блока (field.collapsible,
        // Раунд 90) - "Настройки" (логика/параметры вычислений, ВСЕГДА
        // развёрнут по умолчанию - то, что чаще всего меняют) и
        // "Отображение" (чисто визуальные настройки, свёрнут по
        // умолчанию - реже нужны, не должны загромождать панель).
        fields.push({ type: 'section', label: '⚙️ Настройки', collapsible: true, collapsed: false });

        fields.push({
            key: 'startDate',
            label: 'Дата начала плана',
            type: 'date',
            get: () => this.startDate,
            set: (v) => { this.startDate = v || this.startDate; }
        });

        fields.push({
            key: 'autoAnchorFromData',
            label: 'Автопривязка к самой ранней дате в источнике',
            type: 'checkbox',
            get: () => this.autoAnchorFromData,
            set: (v) => { this.autoAnchorFromData = !!v; }
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

        // Раунд 141 (по решению Mr.D: "переключение типа расчёта не
        // нужно, все расчёты ведутся в рабочих днях") - поле "Расчёт
        // длительности" (scheduleMode) убрано целиком.

        fields.push({ type: 'section', label: '📊 Отображение', collapsible: true, collapsed: true });

        fields.push({
            key: 'periodPreset',
            label: 'Период отображения',
            type: 'select',
            options: [
                // Раунд 183 (по запросу Mr.D: "Период отображения давай
                // сделаем по умолчанию Авто") - первым в списке, как
                // рекомендуемый/дефолтный режим.
                { value: 'auto', label: 'Авто (по датам задач + месяц)' },
                { value: 'custom', label: 'Своя протяжённость (см. поле ниже)' },
                ...Object.entries(PERIOD_PRESETS).map(([value, cfg]) => ({ value, label: cfg.label }))
            ],
            get: () => this.periodPreset,
            set: (v) => { this.periodPreset = v; }
        });

        // Раунд 183 (по запросу Mr.D: "Панель для ввода должна
        // появляться только если выбран соответствующий пункт") -
        // раньше поле было ВСЕГДА видимо, даже когда periodPreset был
        // ЛЮБЫМ ДРУГИМ пресетом (Авто/Месяц/Квартал/...) - значение
        // этого поля в такие моменты попросту НЕ ИСПОЛЬЗУЕТСЯ (см.
        // totalDays в createGanttArea()), поэтому и показывать его
        // незачем. getInspectorSchema() вызывается ЗАНОВО при каждом
        // render() инспектора - простое условие push() достаточно, без
        // отдельного механизма "скрытых" полей.
        if (this.periodPreset === 'custom') {
            fields.push({
                key: 'customPeriodDays',
                label: 'Протяжённость, дней',
                type: 'number',
                min: 1, step: 1,
                get: () => this.customPeriodDays,
                set: (v) => { this.customPeriodDays = Math.max(1, parseInt(v, 10) || 60); }
            });
        }

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

        fields.push({
            key: 'showBarDateLabels',
            label: 'Подписи дат на полосах',
            type: 'checkbox',
            get: () => this.showBarDateLabels,
            set: (v) => { this.showBarDateLabels = !!v; }
        });

        fields.push({
            key: 'subtitleText',
            label: 'Подзаголовок (выход 2)',
            type: 'text',
            get: () => this.subtitleText,
            set: (v) => { this.subtitleText = v || ''; }
        });

        fields.push({
            key: 'deadlineDate',
            label: 'Дедлайн (красная линия)',
            type: 'date',
            get: () => this.deadlineDate || '',
            set: (v) => { this.deadlineDate = v || null; }
        });

        // Раунд 81 (п.4, по прямому запросу Mr.D) - независимые флаги
        // видимости двух колонок слева от шкалы (см. buildTaskRow()/
        // buildTotalRow()/buildGroupHeaderRow()).
        //
        // Раунд 181 (по запросу Mr.D: "у нас есть блоки 'колонка' и
        // 'шапка', но они не выделены в отдельный блок - создадим для
        // них блоки и перенесём туда соответствующие пункты. А название
        // строк упростим убрав в начале слово 'колонка' и 'шапка'") -
        // все поля видимости колонок собраны в один визуальный под-блок
        // (subsection, см. inspectorManager.js) - подписи больше НЕ
        // повторяют слово "Колонка" (и так ясно из заголовка блока).
        // ПЕРЕНЕСЕНО перед этим блоком (было МЕЖДУ "Колонки" и "Шапка") -
        // subsection не сбрасывается автоматически на "постороннем"
        // поле, оба под-блока теперь идут ПОДРЯД, ничего между ними не
        // "проваливается" внутрь первого по ошибке.
        fields.push({ type: 'subsection', label: 'Колонки' });
        fields.push({
            key: 'showDurationColumn',
            label: '"ч.ч." / Итого дней',
            type: 'checkbox',
            get: () => this.showDurationColumn,
            set: (v) => { this.showDurationColumn = !!v; }
        });

        fields.push({
            key: 'showWorkingDaysColumn',
            label: '"Раб.дн." / Итого рабочих дней',
            type: 'checkbox',
            get: () => this.showWorkingDaysColumn,
            set: (v) => { this.showWorkingDaysColumn = !!v; }
        });

        fields.push({
            key: 'showResponsibleColumn',
            label: '"Ответственный"',
            type: 'checkbox',
            get: () => this.showResponsibleColumn,
            set: (v) => { this.showResponsibleColumn = !!v; }
        });

        fields.push({
            key: 'showCalDaysColumn',
            label: '"Кал. дни"',
            type: 'checkbox',
            get: () => this.showCalDaysColumn,
            set: (v) => { this.showCalDaysColumn = !!v; }
        });

        // Раунд 157 (по запросу Mr.D: "нужны ещё колонки 'сум. раб.
        // дней', 'сум. ч.ч.'")
        fields.push({
            key: 'showSumWorkingDaysColumn',
            label: '"Сум.раб.дн."',
            type: 'checkbox',
            get: () => this.showSumWorkingDaysColumn,
            set: (v) => { this.showSumWorkingDaysColumn = !!v; }
        });
        fields.push({
            key: 'showSumHoursColumn',
            label: '"Сум.ч.ч."',
            type: 'checkbox',
            get: () => this.showSumHoursColumn,
            set: (v) => { this.showSumHoursColumn = !!v; }
        });

        fields.push({
            key: 'showSectionColumn',
            label: '"Раздел"',
            type: 'checkbox',
            get: () => this.showSectionColumn,
            set: (v) => { this.showSectionColumn = !!v; }
        });

        // Раунд 187 (по запросу Mr.D: "Ручной ввод дат в Диаграмме
        // Ганта - поля для начала и конца задачи с синхронизацией с
        // графическим редактором") - тот же подраздел "Колонки", что и
        // остальные необязательные столбцы выше.
        fields.push({
            key: 'showStartDateColumn',
            label: '"Начало"',
            type: 'checkbox',
            get: () => this.showStartDateColumn,
            set: (v) => { this.showStartDateColumn = !!v; }
        });
        fields.push({
            key: 'showEndDateColumn',
            label: '"Окончание"',
            type: 'checkbox',
            get: () => this.showEndDateColumn,
            set: (v) => { this.showEndDateColumn = !!v; }
        });

        // Строки многоуровневой шапки видны и настраиваются только в
        // масштабе "Дни" - в других масштабах у шапки одна строка-линейка,
        // переключателям просто нечего было бы показывать.
        //
        // Раунд 181 (по запросу Mr.D: "создадим блоки для колонка/шапка
        // и перенесём туда соответствующие пункты, название строк
        // упростим убрав в начале слово 'шапка'") - собственный
        // визуальный под-блок (subsection), подписи без повторяющегося
        // "Шапка:" (и так ясно из заголовка блока). В отличие от
        // Раунда 108 обычная 'section' здесь больше НЕ страшна для
        // группировки - subsection не сбрасывает внешнюю сворачиваемую
        // секцию "Отображение" (см. inspectorManager.js).
        if (this.rulerScale === 'days') {
            fields.push({ type: 'subsection', label: 'Шапка' });
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

        // Раунд 109 (по запросу Mr.D: "пользовательские цвета для
        // Ответственных на каждый тип свой цвет диаграммы, и
        // пользовательские цвета для групп - готовая палитра материал
        // дизайн и кастомный вариант") - отдельные сворачиваемые блоки,
        // свёрнуты по умолчанию (та же логика, что "Отображение" -
        // редко нужны, не должны загромождать панель). Список имён -
        // автообнаруженный (см. _detectResponsiblesAndGroups()), НИЧЕГО
        // не назначается автоматически - только явный выбор.
        if (this._detectedResponsibles.length > 0) {
            fields.push({ type: 'section', label: `🎨 Цвета ответственных (${this._detectedResponsibles.length})`, collapsible: true, collapsed: true });
            this._detectedResponsibles.forEach(name => {
                // Раунд 180 (по запросу Mr.D: "цветов тоже касается,
                // пусть порядок будет таким [селектор цвета][пресет
                // цвета][пользователь][сброс] в одну строку") - раньше
                // ДВА отдельных поля инспектора (пресет на одной строке,
                // произвольный цвет+сброс на следующей) - теперь один
                // объединённый ряд (см. inspectorManager.js,
                // type==='colorRole'). Пресет и произвольный цвет пишут
                // в ОДНО И ТО ЖЕ значение напрямую - какой виджет
                // пользователь тронул последним, тот и победил, без
                // промежуточного "выберите Свой цвет... в списке".
                fields.push({
                    key: `respColor_${name}`,
                    label: name,
                    swatchColor: this.responsibleColors[name] || 'transparent',
                    type: 'colorRole',
                    presetOptions: COLOR_PALETTE,
                    getPreset: () => {
                        const cur = this.responsibleColors[name];
                        if (!cur) return '';
                        return COLOR_PALETTE.some(p => p.value === cur) ? cur : '__custom__';
                    },
                    setPreset: (v) => { this.responsibleColors[name] = v || ''; },
                    getCustom: () => this.responsibleColors[name] || '#90caf9',
                    setCustom: (v) => { this.responsibleColors[name] = v || ''; }
                });
            });
        }

        if (this._detectedGroups.length > 0) {
            fields.push({ type: 'section', label: `🎨 Цвета групп (${this._detectedGroups.length})`, collapsible: true, collapsed: true });
            this._detectedGroups.forEach(name => {
                fields.push({
                    key: `groupColor_${name}`,
                    label: name,
                    swatchColor: this.groupColors[name] || 'transparent',
                    type: 'colorRole',
                    presetOptions: COLOR_PALETTE,
                    getPreset: () => {
                        const cur = this.groupColors[name];
                        if (!cur) return '';
                        return COLOR_PALETTE.some(p => p.value === cur) ? cur : '__custom__';
                    },
                    setPreset: (v) => { this.groupColors[name] = v || ''; },
                    getCustom: () => this.groupColors[name] || '#90caf9',
                    setCustom: (v) => { this.groupColors[name] = v || ''; }
                });
            });
        }

        // Раунд 126 (релиз 1.8.0, механика Досок).
        fields.push(...buildBoardInspectorFields(this));

        return fields;
    }
}
