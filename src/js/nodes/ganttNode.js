/**
 * SPDX-License-Identifier: MIT
 * SPDX-FileCopyrightText: 2024 NodeCalculate Team
 * SPDX-FileCopyrightText: 2024 Pavel Fomin
 *
 * @file    ganttNode.js
 * @brief   Обработчик: список задач (имя+длительность) -> календарный план с диаграммой Ганта (выход Data)
 * @author  Pavel Fomin
 * @version 1.4.0
 * @see     https://github.com/GhostPWLk1n/NodeCalculator.git
 */

import { BaseNode } from './baseNode.js';
import { TableData } from '../utils/dataTypes.js';
import { SocketFactory } from '../utils/socketFactory.js';

const ROW_HEIGHT = 26;      // px на строку задачи
const MAX_VISIBLE_ROWS = 6; // после скольки задач включается вертикальный скролл
const LABEL_WIDTH = 84;     // px, колонка с названиями задач

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
 * Второй, альтернативный вход - готовая таблица (Data) с колонками
 * "Начало"/"Окончание": если она подключена И подходит по структуре,
 * нода использует её НАПРЯМУЮ для отрисовки (пересчёт из списка не
 * нужен) - так можно скормить назад её же собственный выход, отредактированный
 * где-то ещё, или таблицу из TableNode с такими же колонками.
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
        this.inputs = 2;
        this.inputSockets = [0, 1];
        this.outputs = 1;
        this.width = config.width || 320;

        this.startDate = config.startDate || new Date().toISOString().slice(0, 10);
        this.periodPreset = PERIOD_PRESETS[config.periodPreset] ? config.periodPreset : 'month';
        this.durationUnit = config.durationUnit === 'hours' ? 'hours' : 'days';
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

        this.tasks = [];               // вычисленные задачи для рендера
        this.tableData = new TableData();
        this.sourceMode = 'list';      // 'list' | 'table' - откуда взялись данные в последнем calculate()
        this._listSourceName = null;
        this._tableSourceName = null;
    }

    createContent() {
        const content = document.createElement('div');
        content.className = 'node-content';
        content.style.cssText = 'width: 100%; min-width: 150px;';

        // --- строка 1: список задач ---
        const listRow = document.createElement('div');
        listRow.style.cssText = 'display:flex; align-items:center; gap:6px;';
        const listSocket = SocketFactory.createSocket({
            nodeId: this.id, socketType: 'input', index: 0, isList: true,
            title: 'Список задач (имя = задача, значение = длительность)'
        });
        listRow.appendChild(listSocket);
        const listLabel = document.createElement('span');
        listLabel.className = 'gantt-source-label';
        listLabel.style.cssText = `
            color: var(--md-text-secondary);
            font-size: 11px;
            flex: 1;
            min-width: 0;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        `;
        listLabel.textContent = this._listSourceName || 'не подключено';
        listRow.appendChild(listLabel);
        content.appendChild(listRow);

        // --- строка 2: альтернативная готовая таблица плана ---
        const tableRow = document.createElement('div');
        tableRow.style.cssText = 'display:flex; align-items:center; gap:6px;';
        const tableSocket = SocketFactory.createSocket({
            nodeId: this.id, socketType: 'input', index: 1, isData: true,
            title: 'Готовая таблица плана (столбцы "Начало"/"Окончание") - приоритетнее списка'
        });
        tableRow.appendChild(tableSocket);
        const tableLabel = document.createElement('span');
        tableLabel.className = 'gantt-table-source-label';
        tableLabel.style.cssText = `
            color: var(--md-text-disabled);
            font-size: 10px;
            flex: 1;
            min-width: 0;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        `;
        tableLabel.textContent = this.sourceMode === 'table' && this._tableSourceName
            ? `из таблицы: ${this._tableSourceName}`
            : 'или таблица (DATA)';
        tableRow.appendChild(tableLabel);
        content.appendChild(tableRow);

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
        const totalDays = PERIOD_PRESETS[this.periodPreset]?.days || 30;
        const dayWidth = RULER_SCALES[this.rulerScale]?.dayWidth || RULER_SCALES.days.dayWidth;
        const timelineWidth = totalDays * dayWidth;
        const anchor = parseISODate(this.startDate) || new Date();

        const outer = document.createElement('div');
        outer.className = 'gantt-outer-scroll';
        outer.style.cssText = 'overflow-x: auto; overflow-y: hidden;';
        outer.addEventListener('mousedown', (e) => e.stopPropagation());

        const inner = document.createElement('div');
        inner.className = 'gantt-inner';
        inner.style.cssText = `position: relative; width: ${LABEL_WIDTH + timelineWidth}px; min-width: 100%;`;

        // Треугольная ручка дедлайна - отдельная узкая строка НАД шапкой
        // дат, в обычном потоке (не абсолютно с отрицательным top), иначе
        // её обрезал бы overflow-y:hidden внешней обёртки
        const deadlineHandleRow = this.buildDeadlineHandle(timelineWidth, dayWidth);
        if (deadlineHandleRow) inner.appendChild(deadlineHandleRow);

        // Подложка выходных - только в масштабе "Дни" вместе со строкой
        // дня недели (это одна связанная фича, см. описание задачи)
        if (this.rulerScale === 'days' && this.showWeekdayRow) {
            inner.appendChild(this.buildWeekendHighlights(totalDays, timelineWidth, dayWidth, anchor));
        }

        // Шапка: многоуровневая (год/месяц/число/день недели) только в
        // масштабе "Дни", иначе - обычная линейка с делениями
        if (this.rulerScale === 'days') {
            inner.appendChild(this.buildDaysHeader(totalDays, timelineWidth, dayWidth, anchor));
        } else {
            inner.appendChild(this.buildRuler(totalDays, timelineWidth, dayWidth));
        }

        const rowsWrap = document.createElement('div');
        rowsWrap.className = 'gantt-rows-scroll';
        const visibleRows = Math.min(Math.max(this.tasks.length, 1), MAX_VISIBLE_ROWS);
        rowsWrap.style.cssText = `overflow-y: auto; max-height: ${visibleRows * ROW_HEIGHT}px;`;

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
                rowsInner.appendChild(this.buildGridLines(totalDays, timelineWidth, dayWidth));
            }

            this.tasks.forEach((task, i) => {
                rowsInner.appendChild(this.buildTaskRow(task, timelineWidth, dayWidth, i));
            });

            rowsWrap.appendChild(rowsInner);
        }

        inner.appendChild(rowsWrap);

        // Линия дедлайна - поверх и шапки, и строк, не участвует в
        // вертикальном скролле строк (остаётся видна всегда, пока не
        // проскроллили по горизонтали мимо неё)
        const deadlineLine = this.buildDeadlineLine(dayWidth);
        if (deadlineLine) inner.appendChild(deadlineLine);

        outer.appendChild(inner);
        return outer;
    }

    // Вертикальные линии-разделители дат через все строки задач сразу -
    // тот же шаг, что и у делений линейки (buildRuler), чтобы совпадали.
    buildGridLines(totalDays, timelineWidth, dayWidth) {
        const step = RULER_SCALES[this.rulerScale]?.tickStepDays || 1;
        const lines = document.createElement('div');
        lines.className = 'gantt-gridlines';
        lines.style.cssText = `position:absolute; left:${LABEL_WIDTH}px; top:0; bottom:0; width:${timelineWidth}px; pointer-events:none;`;

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

    // Красная вертикальная линия дедлайна плана (если задан в панели)
    buildDeadlineLine(dayWidth) {
        if (!this.deadlineDate) return null;
        const deadline = parseISODate(this.deadlineDate);
        if (!deadline) return null;

        const anchor = parseISODate(this.startDate) || new Date();
        const offsetDays = daysBetween(anchor, deadline);

        const line = document.createElement('div');
        line.className = 'gantt-deadline-line';
        line.style.cssText = `
            position: absolute;
            left: ${LABEL_WIDTH + offsetDays * dayWidth}px;
            top: 0; bottom: 0;
            width: 2px;
            background: var(--md-error, #ef5350);
            z-index: 4;
            pointer-events: none;
        `;
        line.title = `Дедлайн: ${formatDateRu(deadline)}`;
        return line;
    }

    // Треугольная ручка над шапкой дат - тянет дедлайн мышью по
    // горизонтали. Отдельная строка в обычном потоке (не абсолютный
    // элемент с отрицательным top) - иначе торчащий вверх треугольник
    // обрезал бы overflow-y:hidden внешней прокручиваемой обёртки.
    buildDeadlineHandle(timelineWidth, dayWidth) {
        if (!this.deadlineDate) return null;
        const deadline = parseISODate(this.deadlineDate);
        if (!deadline) return null;

        const anchor = parseISODate(this.startDate) || new Date();
        const offsetDays = daysBetween(anchor, deadline);

        const handleRow = document.createElement('div');
        handleRow.className = 'gantt-deadline-handle-row';
        handleRow.style.cssText = 'display:flex; height:9px;';

        const spacer = document.createElement('div');
        spacer.style.cssText = 'width:' + LABEL_WIDTH + 'px; flex-shrink:0;';
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

    buildRuler(totalDays, timelineWidth, dayWidth) {
        const ruler = document.createElement('div');
        ruler.className = 'gantt-ruler';
        ruler.style.cssText = 'display:flex; height:18px; border-bottom:1px solid var(--md-divider);';

        const spacer = document.createElement('div');
        spacer.style.cssText = `width: ${LABEL_WIDTH}px; flex-shrink: 0;`;
        ruler.appendChild(spacer);

        const track = document.createElement('div');
        track.style.cssText = `position: relative; width: ${timelineWidth}px; flex-shrink: 0;`;

        const step = RULER_SCALES[this.rulerScale]?.tickStepDays || 1;
        const anchor = parseISODate(this.startDate) || new Date();
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

    buildDaysHeader(totalDays, timelineWidth, dayWidth, anchor) {
        const header = document.createElement('div');
        header.className = 'gantt-days-header';

        if (this.showYearRow) {
            header.appendChild(this.buildGroupedRow(
                totalDays, timelineWidth, dayWidth, anchor,
                (date) => date.getFullYear(),
                (date) => String(date.getFullYear())
            ));
        }
        if (this.showMonthRow) {
            header.appendChild(this.buildGroupedRow(
                totalDays, timelineWidth, dayWidth, anchor,
                (date) => date.getFullYear() * 12 + date.getMonth(),
                (date) => MONTH_LABELS[date.getMonth()]
            ));
        }
        if (this.showDayRow) {
            header.appendChild(this.buildDayNumberRow(totalDays, timelineWidth, dayWidth, anchor));
        }
        if (this.showWeekdayRow) {
            header.appendChild(this.buildWeekdayRow(totalDays, timelineWidth, dayWidth, anchor));
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
    buildGroupedRow(totalDays, timelineWidth, dayWidth, anchor, getKey, getLabel) {
        const row = document.createElement('div');
        row.style.cssText = `display:flex; height:${HEADER_ROW_HEIGHT}px; border-bottom:1px solid var(--md-divider);`;

        const spacer = document.createElement('div');
        spacer.style.cssText = `width:${LABEL_WIDTH}px; flex-shrink:0;`;
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
    buildDayNumberRow(totalDays, timelineWidth, dayWidth, anchor) {
        const row = document.createElement('div');
        row.style.cssText = `display:flex; height:${HEADER_ROW_HEIGHT}px; border-bottom:1px solid var(--md-divider);`;

        const spacer = document.createElement('div');
        spacer.style.cssText = `width:${LABEL_WIDTH}px; flex-shrink:0;`;
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
    buildWeekdayRow(totalDays, timelineWidth, dayWidth, anchor) {
        const row = document.createElement('div');
        row.style.cssText = `display:flex; height:${HEADER_ROW_HEIGHT}px; border-bottom:1px solid var(--md-divider);`;

        const spacer = document.createElement('div');
        spacer.style.cssText = `width:${LABEL_WIDTH}px; flex-shrink:0;`;
        row.appendChild(spacer);

        const track = document.createElement('div');
        track.style.cssText = `position:relative; width:${timelineWidth}px; flex-shrink:0;`;

        for (let d = 0; d < totalDays; d++) {
            const date = addDays(anchor, d);
            const dow = date.getDay();
            const isWeekend = dow === 0 || dow === 6;
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
                color: ${isWeekend ? 'var(--md-error, #ef5350)' : 'var(--md-text-secondary)'};
                font-weight: ${isWeekend ? '600' : '400'};
            `;
            cell.textContent = WEEKDAY_LABELS[dow];
            track.appendChild(cell);
        }
        row.appendChild(track);
        return row;
    }

    // Подложка выходных дней - не ярко, но заметно (та же плотность
    // прозрачности, что и у зебры строк) - растягивается через ВСЮ
    // высоту диаграммы (шапка + строки задач), а не только шапку
    buildWeekendHighlights(totalDays, timelineWidth, dayWidth, anchor) {
        const overlay = document.createElement('div');
        overlay.className = 'gantt-weekend-highlights';
        overlay.style.cssText = `position:absolute; left:${LABEL_WIDTH}px; top:0; bottom:0; width:${timelineWidth}px; pointer-events:none;`;

        for (let d = 0; d < totalDays; d++) {
            const dow = addDays(anchor, d).getDay();
            if (dow === 0 || dow === 6) {
                const seg = document.createElement('div');
                seg.style.cssText = `
                    position: absolute;
                    left: ${d * dayWidth}px;
                    top: 0; bottom: 0;
                    width: ${dayWidth}px;
                    background: rgba(239, 83, 80, 0.06);
                `;
                overlay.appendChild(seg);
            }
        }
        return overlay;
    }

    buildTaskRow(task, timelineWidth, dayWidth, index) {
        const row = document.createElement('div');
        row.className = 'gantt-task-row';
        row.style.cssText = `
            display: flex;
            align-items: center;
            height: ${ROW_HEIGHT}px;
            ${index % 2 === 0 ? 'background: rgba(255,255,255,0.02);' : ''}
        `;

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

        const track = document.createElement('div');
        track.style.cssText = `position: relative; width: ${timelineWidth}px; height: 100%; flex-shrink: 0;`;

        const bar = document.createElement('div');
        bar.className = 'gantt-bar';
        bar.dataset.taskName = task.name;
        bar.style.cssText = `
            position: absolute;
            top: 4px; bottom: 4px;
            left: ${task.startOffsetDays * dayWidth}px;
            width: ${Math.max(4, task.durationDays * dayWidth)}px;
            background: var(--md-primary);
            border-radius: 3px;
            cursor: grab;
        `;
        bar.title = `${task.name}: ${task.durationDays} дн.`;
        this.attachBarDrag(bar, task, dayWidth);
        track.appendChild(bar);

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
                    this.taskDates[task.name] = parseInt(barEl.dataset.pendingOffset, 10);
                    delete barEl.dataset.pendingOffset;
                    if (window.nodeManager) window.nodeManager.calculateAll();
                    if (window.renderer) window.renderer.updateAllDisplays();
                }
            };
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        });
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
        const nameCol = tableData.columns.find(c => c.format === 'text') || tableData.columns[0];
        const startCol = tableData.columns.find(c => (c.header || '').toLowerCase().includes('начал'));
        const endCol = tableData.columns.find(c => (c.header || '').toLowerCase().includes('оконч'));
        if (!startCol || !endCol) return [];

        const anchor = parseISODate(this.startDate) || new Date();
        const tasks = [];
        for (let i = 0; i < tableData.rowCount; i++) {
            const name = nameCol ? String(nameCol.values[i] ?? `Задача ${i + 1}`) : `Задача ${i + 1}`;
            const startD = parseDateRu(startCol.values[i]) || parseISODate(startCol.values[i]);
            const endD = parseDateRu(endCol.values[i]) || parseISODate(endCol.values[i]);
            if (!startD || !endD) continue;
            tasks.push({
                name,
                startOffsetDays: daysBetween(anchor, startD),
                durationDays: Math.max(0, daysBetween(startD, endD))
            });
        }
        return tasks;
    }

    buildOutputTable() {
        const anchor = parseISODate(this.startDate) || new Date();
        const names = [];
        const starts = [];
        const ends = [];
        const durations = [];

        this.tasks.forEach(t => {
            names.push(t.name);
            starts.push(formatDateRu(addDays(anchor, t.startOffsetDays)));
            ends.push(formatDateRu(addDays(anchor, t.startOffsetDays + t.durationDays)));
            durations.push(t.durationDays);
        });

        return new TableData([
            { header: 'Задача', values: names, format: 'text' },
            { header: 'Начало', values: starts, format: 'text' },
            { header: 'Окончание', values: ends, format: 'text' },
            { header: 'Длительность, дн.', values: durations, format: 'number' }
        ], { title: this.customName || this.getDisplayName() });
    }

    calculate(nodeManager) {
        const connections = window.connectionManager?.getConnections() || [];
        const listConn = connections.find(c => c.targetNodeId === this.id && c.targetSocket === 0);
        const tableConn = connections.find(c => c.targetNodeId === this.id && c.targetSocket === 1);

        this._tableSourceName = null;

        // Приоритет: готовая совместимая таблица - используем напрямую,
        // без пересчёта из списка (см. докстринг класса)
        if (tableConn) {
            const src = nodeManager.getNode(tableConn.sourceNodeId);
            this._tableSourceName = src ? (src.customName || src.getDisplayName?.() || 'таблица') : null;
            if (src?.tableData && src.tableData.columns.length > 0 && this.isCompatibleTable(src.tableData)) {
                this.sourceMode = 'table';
                this.tasks = this.tasksFromTable(src.tableData);
                this.tableData = src.tableData;
                this.value = this.tasks.length;
                return this.value;
            }
        }

        this.sourceMode = 'list';
        const listSrc = listConn ? nodeManager.getNode(listConn.sourceNodeId) : null;
        this._listSourceName = listSrc ? (listSrc.customName || listSrc.getDisplayName?.() || 'список') : null;
        const items = listSrc?.listData?.items || [];

        let cursor = 0;
        this.tasks = items.map(item => {
            const duration = Math.max(0, this.durationUnit === 'hours' ? (item.value || 0) / 24 : (item.value || 0));
            const name = item.name || 'Задача';
            let startOffsetDays = this.taskDates[name];
            if (startOffsetDays === undefined) {
                startOffsetDays = cursor;
                this.taskDates[name] = startOffsetDays;
            }
            cursor = Math.max(cursor, startOffsetDays + duration);
            return { name, durationDays: duration, startOffsetDays };
        });

        this.tableData = this.buildOutputTable();
        this.value = this.tasks.length;
        return this.value;
    }

    updateDisplay(element) {
        const listLabel = element.querySelector('.gantt-source-label');
        if (listLabel) listLabel.textContent = this._listSourceName || 'не подключено';

        const tableLabel = element.querySelector('.gantt-table-source-label');
        if (tableLabel) {
            tableLabel.textContent = (this.sourceMode === 'table' && this._tableSourceName)
                ? `из таблицы: ${this._tableSourceName}`
                : 'или таблица (DATA)';
        }

        const slot = element.querySelector('.gantt-container-slot');
        if (slot) {
            slot.innerHTML = '';
            slot.appendChild(this.createGanttArea());
        }

        const outputCount = element.querySelector('.gantt-output-count');
        if (outputCount) outputCount.textContent = `${this.tasks.length} задач`;
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
            options: Object.entries(PERIOD_PRESETS).map(([value, cfg]) => ({ value, label: cfg.label })),
            get: () => this.periodPreset,
            set: (v) => { this.periodPreset = v; }
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
