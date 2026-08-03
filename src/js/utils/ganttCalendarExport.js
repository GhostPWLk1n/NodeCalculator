/**
 * SPDX-License-Identifier: MIT
 * SPDX-FileCopyrightText: 2024 NodeCalculate Team
 * SPDX-FileCopyrightText: 2024 Pavel Fomin
 *
 * @file    ganttCalendarExport.js
 * @brief   Сборка сетки {value,color,border} для экспорта GanttNode в Excel-календарь - обратный механизм к GanttTableProcessorNode
 * @author  Pavel Fomin
 * @version 1.8.4
 * @see     https://github.com/GhostPWLk1n/NodeCalculator.git
 */

/**
 * ganttCalendarExport.js - Раунд 110 (по запросу Mr.D: "у нас уже есть
 * механизм Обработки диаграммы Ганта загруженных из excel, теперь нужен
 * обратный механизм - выгрузить в такую раскрашенную нашими цветами
 * диаграмму обратно"). Раунд 111 - ширина столбцов, объединение ячеек
 * по месяцам/годам, границы ("разлиновка"). Раунд 112 - реальный
 * коэффициент px->Excel-units. Раунд 113 (по жалобе Mr.D: "потерялись
 * столбики ч.ч/Раб.дни/Кал.дни") - те же ДОПОЛНИТЕЛЬНЫЕ колонки, что
 * видны на самой диаграмме (см. buildTaskRow() в ganttNode.js),
 * добавлены в экспорт - условно, по тем же флагам видимости
 * (showDurationColumn/showWorkingDaysColumn/showCalDaysColumn), в ТОМ
 * ЖЕ порядке (№ п/п -> Вид работ -> ч.ч. -> Раб.дн. -> Ответственный ->
 * Кал.дни - Ответственный остаётся ВСЕГДА, это часть базовой схемы
 * исходного импорта, см. ниже).
 *
 * Строит СЕТКУ (не TableData - структура нерегулярная, см.
 * utils/xlsxWriter.js::buildFromGrid()) в ТОЙ ЖЕ структуре, что читает
 * GanttTableProcessorNode при разборе (Раунд 97):
 *   строка 1 - заголовок, строка 2 - подзаголовок,
 *   строка 3 - базовые колонки (№ п/п/Вид работ/[ч.ч.]/[Раб.дн.]/
 *              Ответственный/[Кал.дни]) + год,
 *   строка 4 - месяц, строка 5 - неделя внутри месяца (1-4, ровно 4
 *              колонки на месяц),
 *   строки 6+ - задачи: начало/конец красятся цветом, назначенным
 *              ответственному/группе задачи (Раунд 109) - число в
 *              ячейке = день месяца (тот же "точечный маркер", что
 *              разбирает _decodeTaskDates(), роль 'point').
 */

const RU_MONTHS = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
const DEFAULT_COLOR = '90CAF9'; // var(--md-primary) эквивалент - когда ни ответственному, ни группе цвет не назначен
const DAY_WIDTH_PX = 22; // тот же "22", что RULER_SCALES.days.dayWidth в ganttNode.js - желаемая ВИЗУАЛЬНАЯ ширина в пикселях
// Раунд 113 - тот же HOURS_PER_WORKDAY, что в ganttNode.js (не
// импортирован оттуда напрямую - утилита сознательно не зависит от
// самого класса GanttNode, только от его публичных полей/методов, см.
// докстринг ниже - значение стабильно, дублирование безопаснее связи).
const HOURS_PER_WORKDAY = 8;

// Раунд 112 (по замеру Mr.D: "сейчас ширина колонки даты 153, должна
// быть 22" - Excel-атрибут width задаётся не в пикселях, а в
// "символьных единицах" ширины символа шрифта по умолчанию (Calibri
// 11 ~7px/единица - тот же формат, что и MDW в спецификации OOXML) -
// 1:1 (Раунд 111) поэтому давал видимую ширину в ~7 раз больше
// желаемой. Коэффициент - НЕ теоретическая формула, а ОБРАТНЫЙ пересчёт
// от РЕАЛЬНОГО замера Mr.D: 22 "старых" единицы отрисовались как 153px,
// значит 1px желаемой ширины = 22/153 Excel-единицы.
const PX_TO_EXCEL_UNITS = 22 / 153;

function pxToExcelUnits(px) {
    return Math.round(px * PX_TO_EXCEL_UNITS * 100) / 100; // округление до 2 знаков - Excel всё равно не показывает точнее
}

function parseISODate(s) {
    if (!s) return null;
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
    if (!m) return null;
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function addDays(date, days) {
    const d = new Date(date.getTime());
    d.setDate(d.getDate() + days);
    return d;
}

// Раунд 110 - строит список колонок (год/месяц/неделя), РОВНО 4 недели
// на месяц (тот же принцип, что в исходных файлах Mr.D, см. разведку
// Раунда 84) - от месяца самой ранней даты до месяца самой поздней.
function buildDateColumns(minDate, maxDate) {
    const cols = [];
    let cursor = new Date(minDate.getFullYear(), minDate.getMonth(), 1);
    const endCursor = new Date(maxDate.getFullYear(), maxDate.getMonth(), 1);
    while (cursor <= endCursor) {
        const year = cursor.getFullYear();
        const month = cursor.getMonth();
        for (let week = 1; week <= 4; week++) {
            cols.push({ year, month, week });
        }
        cursor = new Date(year, month + 1, 1);
    }
    return cols;
}

function findColIndex(dateColumns, date) {
    const year = date.getFullYear();
    const month = date.getMonth();
    const week = Math.min(4, Math.ceil(date.getDate() / 7));
    return dateColumns.findIndex(c => c.year === year && c.month === month && c.week === week);
}

// Раунд 111 - группирует ПОСЛЕДОВАТЕЛЬНЫЕ индексы колонок дат (0-based
// внутри dateColumns) с одинаковым значением keyFn(col) в диапазоны для
// объединения ячеек - возвращает [{startIdx, endIdx}] (endIdx
// включительно), ТОЛЬКО группы из 2+ колонок (объединять одну ячейку
// саму с собой не нужно).
function groupConsecutive(dateColumns, keyFn) {
    const groups = [];
    let start = 0;
    for (let i = 1; i <= dateColumns.length; i++) {
        if (i === dateColumns.length || keyFn(dateColumns[i]) !== keyFn(dateColumns[start])) {
            if (i - start > 1) groups.push({ startIdx: start, endIdx: i - 1 });
            start = i;
        }
    }
    return groups;
}

// Раунд 113 - список БАЗОВЫХ (не датных) колонок - динамический, в
// ТОМ ЖЕ порядке и с ТОЙ ЖЕ условностью показа, что на самой диаграмме
// (см. buildTaskRow() в ganttNode.js). "№ п/п"/"Вид работ"/
// "Ответственный" - ВСЕГДА (базовая схема исходного импорта, три
// фиксированные колонки A:C) - "ч.ч."/"Раб.дн."/"Кал.дни" - условно.
function buildBaseColumns(ganttNode) {
    const cols = [
        { key: 'num', header: '№ п/п', width: ganttNode.numColWidthOverride || Math.max(20, String(Math.max((ganttNode.tasks || []).length, 1)).length * 7 + 12) },
        { key: 'name', header: 'Вид работ', width: typeof ganttNode._labelW === 'function' ? ganttNode._labelW() : 84 }
    ];
    if (ganttNode.showDurationColumn) {
        cols.push({ key: 'hours', header: 'ч.ч.', width: typeof ganttNode._hoursW === 'function' ? ganttNode._hoursW() : 34 });
    }
    if (ganttNode.showWorkingDaysColumn) {
        cols.push({ key: 'workdays', header: 'Раб.дн.', width: typeof ganttNode._workdaysW === 'function' ? ganttNode._workdaysW() : 34 });
    }
    cols.push({ key: 'responsible', header: 'Ответственный', width: typeof ganttNode._respW === 'function' ? ganttNode._respW() : 70 });
    if (ganttNode.showCalDaysColumn) {
        cols.push({ key: 'caldays', header: 'Кал. дни', width: typeof ganttNode._calDaysW === 'function' ? ganttNode._calDaysW() : 40 });
    }
    return cols;
}

// ganttNode - экземпляр GanttNode (nodes/ganttNode.js) - используем ТОЛЬКО
// уже публичные поля/методы (this.tasks/this.taskGroups/this.startDate/
// this.responsibleColors/this.groupColors/this._effectiveResponsible()/
// this._labelW()/this._respW()/this._hoursW()/this._workdaysW()/
// this._calDaysW()/this._countWorkingDaysInRange()/show*Column) - без
// изменений в самом GanttNode. Возвращает {grid, colWidths, merges}
// или null, если у диаграммы нет задач.
export function buildGanttCalendarGrid(ganttNode) {
    const tasks = ganttNode.tasks || [];
    if (tasks.length === 0) return null;

    const anchor = parseISODate(ganttNode.startDate) || new Date();
    const allDates = [];
    tasks.forEach(t => {
        allDates.push(addDays(anchor, t.startOffsetDays));
        allDates.push(addDays(anchor, t.startOffsetDays + t.durationDays));
    });
    const minDate = new Date(Math.min(...allDates.map(d => d.getTime())));
    const maxDate = new Date(Math.max(...allDates.map(d => d.getTime())));
    const dateColumns = buildDateColumns(minDate, maxDate);

    const baseCols = buildBaseColumns(ganttNode);
    const baseColCount = baseCols.length;

    const grid = [];
    grid.push([{ value: ganttNode._resolvedTitle || ganttNode.customName || ganttNode.getDisplayName() }]);
    grid.push([{ value: ganttNode._resolvedSubtitle || ganttNode.subtitleText || '' }]);

    // Раунд 111 - border:true равномерно по ВСЕЙ области заголовка/
    // данных (строки 3+, все колонки) - "разлиновка".
    const row3 = baseCols.map(c => ({ value: c.header, border: true }));
    dateColumns.forEach(c => row3.push({ value: c.year, border: true }));
    grid.push(row3);

    const row4 = baseCols.map(() => ({ value: null, border: true }));
    dateColumns.forEach(c => row4.push({ value: RU_MONTHS[c.month], border: true }));
    grid.push(row4);

    const row5 = baseCols.map(() => ({ value: null, border: true }));
    dateColumns.forEach(c => row5.push({ value: c.week, border: true }));
    grid.push(row5);

    // Раунд 111 - объединение года (строка 3) и месяца (строка 4) по
    // ПОСЛЕДОВАТЕЛЬНЫМ колонкам с одинаковым значением - значение
    // остаётся ТОЛЬКО в первой ячейке диапазона (Excel-конвенция для
    // объединённых ячеек), граница уже проставлена равномерно выше.
    const merges = [];
    const yearGroups = groupConsecutive(dateColumns, c => c.year);
    yearGroups.forEach(g => {
        for (let i = g.startIdx + 1; i <= g.endIdx; i++) row3[baseColCount + i].value = null;
        merges.push({ r1: 2, c1: baseColCount + g.startIdx, r2: 2, c2: baseColCount + g.endIdx });
    });
    const monthGroups = groupConsecutive(dateColumns, c => `${c.year}-${c.month}`);
    monthGroups.forEach(g => {
        for (let i = g.startIdx + 1; i <= g.endIdx; i++) row4[baseColCount + i].value = null;
        merges.push({ r1: 3, c1: baseColCount + g.startIdx, r2: 3, c2: baseColCount + g.endIdx });
    });

    tasks.forEach((task, i) => {
        const row = new Array(baseColCount + dateColumns.length).fill(null).map(() => ({ value: null, border: true }));
        const responsible = typeof ganttNode._effectiveResponsible === 'function'
            ? ganttNode._effectiveResponsible(task)
            : (task.responsible || '');
        // Раунд 113 - значения базовых колонок по их key (тот же набор
        // и порядок, что buildBaseColumns() выше).
        baseCols.forEach((col, ci) => {
            switch (col.key) {
                case 'num': row[ci].value = i + 1; break;
                case 'name': row[ci].value = task.name; break;
                case 'hours': row[ci].value = Math.round(task.durationDays * HOURS_PER_WORKDAY); break;
                case 'workdays': row[ci].value = typeof ganttNode._countWorkingDaysInRange === 'function'
                    ? ganttNode._countWorkingDaysInRange(anchor, task.startOffsetDays, task.durationDays)
                    : task.durationDays;
                    break;
                case 'responsible': row[ci].value = responsible; break;
                case 'caldays': row[ci].value = task.durationDays; break;
            }
        });

        // Раунд 109 - цвет ответственного в приоритете, иначе цвет
        // группы задачи, иначе цвет по умолчанию (тот же принцип
        // приоритета, что уже применён к самой полосе на диаграмме,
        // см. buildTaskRow() в ganttNode.js).
        const color = (responsible && ganttNode.responsibleColors[responsible])
            || (task.groupName && ganttNode.groupColors[task.groupName])
            || DEFAULT_COLOR;
        const cleanColor = color.replace('#', '').toUpperCase();

        const startDate = addDays(anchor, task.startOffsetDays);
        const endDate = addDays(anchor, task.startOffsetDays + task.durationDays);
        const startColIdx = findColIndex(dateColumns, startDate);
        const endColIdx = findColIndex(dateColumns, endDate);
        if (startColIdx >= 0) { row[baseColCount + startColIdx].value = startDate.getDate(); row[baseColCount + startColIdx].color = cleanColor; }
        if (endColIdx >= 0 && endColIdx !== startColIdx) { row[baseColCount + endColIdx].value = endDate.getDate(); row[baseColCount + endColIdx].color = cleanColor; }

        grid.push(row);
    });

    // Раунд 111 (по запросу Mr.D: "остальные столбики тоже") + Раунд 112
    // (реальный коэффициент px->units, см. pxToExcelUnits()) - ширина
    // каждого столбца сетки в Excel-"units", пересчитанная из ширины
    // того же столбца на экране в пикселях.
    const colWidths = [...baseCols.map(c => c.width), ...dateColumns.map(() => DAY_WIDTH_PX)].map(pxToExcelUnits);

    return { grid, colWidths, merges };
}
