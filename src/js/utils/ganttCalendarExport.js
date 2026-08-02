/**
 * SPDX-License-Identifier: MIT
 * SPDX-FileCopyrightText: 2024 NodeCalculate Team
 * SPDX-FileCopyrightText: 2024 Pavel Fomin
 *
 * @file    ganttCalendarExport.js
 * @brief   Сборка сетки {value,color,border} для экспорта GanttNode в Excel-календарь - обратный механизм к GanttTableProcessorNode
 * @author  Pavel Fomin
 * @version 1.7.45
 * @see     https://github.com/GhostPWLk1n/NodeCalculator.git
 */

/**
 * ganttCalendarExport.js - Раунд 110 (по запросу Mr.D: "у нас уже есть
 * механизм Обработки диаграммы Ганта загруженных из excel, теперь нужен
 * обратный механизм - выгрузить в такую раскрашенную нашими цветами
 * диаграмму обратно"). Раунд 111 - ширина столбцов, объединение ячеек
 * по месяцам/годам, границы ("разлиновка").
 *
 * Строит СЕТКУ (не TableData - структура нерегулярная, см.
 * utils/xlsxWriter.js::buildFromGrid()) в ТОЙ ЖЕ структуре, что читает
 * GanttTableProcessorNode при разборе (Раунд 97):
 *   строка 1 - заголовок, строка 2 - подзаголовок,
 *   строка 3 - "№ п/п"/"Вид работ"/"Ответственный" + год,
 *   строка 4 - месяц, строка 5 - неделя внутри месяца (1-4, ровно 4
 *              колонки на месяц),
 *   строки 6+ - задачи: начало/конец красятся цветом, назначенным
 *              ответственному/группе задачи (Раунд 109) - число в
 *              ячейке = день месяца (тот же "точечный маркер", что
 *              разбирает _decodeTaskDates(), роль 'point').
 *
 * Раунд 111 - год/месяц ТЕПЕРЬ объединяются (Excel merge) через
 * ПОСЛЕДОВАТЕЛЬНЫЕ колонки с одинаковым значением - значение пишется
 * ТОЛЬКО в первую ячейку диапазона (остальные - null), сама сетка ещё
 * ПОЛУЧАЕТ границу (border:true) равномерно по ВСЕЙ области заголовка/
 * данных (не только у объединяемых) - "разлиновка", по прямому запросу
 * Mr.D. Ширина столбцов - ПРЯМАЯ конвертация 1:1 px->units (по
 * собственному замеру Mr.D: 22px на экране ~ 20 units в Excel для той
 * же по смыслу ячейки - "будем считать, что 22 в 22 и обойдёмся" - его
 * решение, не формула пересчёта шрифта).
 */

const RU_MONTHS = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
const DEFAULT_COLOR = '90CAF9'; // var(--md-primary) эквивалент - когда ни ответственному, ни группе цвет не назначен
const DAY_WIDTH_PX = 22; // тот же "22", что RULER_SCALES.days.dayWidth в ganttNode.js - желаемая ВИЗУАЛЬНАЯ ширина в пикселях

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

// ganttNode - экземпляр GanttNode (nodes/ganttNode.js) - используем ТОЛЬКО
// уже публичные поля/методы (this.tasks/this.taskGroups/this.startDate/
// this.responsibleColors/this.groupColors/this._effectiveResponsible()/
// this._labelW()/this._respW()/this.numColWidthOverride) - без изменений
// в самом GanttNode. Возвращает {grid, colWidths, merges} или null, если
// у диаграммы нет задач.
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

    const grid = [];
    grid.push([{ value: ganttNode._resolvedTitle || ganttNode.customName || ganttNode.getDisplayName() }]);
    grid.push([{ value: ganttNode._resolvedSubtitle || ganttNode.subtitleText || '' }]);

    // Раунд 111 - border:true равномерно по ВСЕЙ области заголовка/
    // данных (строки 3+, все колонки) - "разлиновка".
    const row3 = [{ value: '№ п/п', border: true }, { value: 'Вид работ', border: true }, { value: 'Ответственный', border: true }];
    dateColumns.forEach(c => row3.push({ value: c.year, border: true }));
    grid.push(row3);

    const row4 = [{ value: null, border: true }, { value: null, border: true }, { value: null, border: true }];
    dateColumns.forEach(c => row4.push({ value: RU_MONTHS[c.month], border: true }));
    grid.push(row4);

    const row5 = [{ value: null, border: true }, { value: null, border: true }, { value: null, border: true }];
    dateColumns.forEach(c => row5.push({ value: c.week, border: true }));
    grid.push(row5);

    // Раунд 111 - объединение года (строка 3) и месяца (строка 4) по
    // ПОСЛЕДОВАТЕЛЬНЫМ колонкам с одинаковым значением - значение
    // остаётся ТОЛЬКО в первой ячейке диапазона (Excel-конвенция для
    // объединённых ячеек), граница уже проставлена равномерно выше.
    const merges = [];
    const yearGroups = groupConsecutive(dateColumns, c => c.year);
    yearGroups.forEach(g => {
        for (let i = g.startIdx + 1; i <= g.endIdx; i++) row3[3 + i].value = null;
        merges.push({ r1: 2, c1: 3 + g.startIdx, r2: 2, c2: 3 + g.endIdx });
    });
    const monthGroups = groupConsecutive(dateColumns, c => `${c.year}-${c.month}`);
    monthGroups.forEach(g => {
        for (let i = g.startIdx + 1; i <= g.endIdx; i++) row4[3 + i].value = null;
        merges.push({ r1: 3, c1: 3 + g.startIdx, r2: 3, c2: 3 + g.endIdx });
    });

    tasks.forEach((task, i) => {
        const row = new Array(3 + dateColumns.length).fill(null).map(() => ({ value: null, border: true }));
        row[0].value = i + 1;
        row[1].value = task.name;
        const responsible = typeof ganttNode._effectiveResponsible === 'function'
            ? ganttNode._effectiveResponsible(task)
            : (task.responsible || '');
        row[2].value = responsible;

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
        if (startColIdx >= 0) { row[3 + startColIdx].value = startDate.getDate(); row[3 + startColIdx].color = cleanColor; }
        if (endColIdx >= 0 && endColIdx !== startColIdx) { row[3 + endColIdx].value = endDate.getDate(); row[3 + endColIdx].color = cleanColor; }

        grid.push(row);
    });

    // Раунд 111 (по запросу Mr.D: "остальные столбики тоже") + Раунд 112
    // (реальный коэффициент px->units, не 1:1, см. pxToExcelUnits()) -
    // ширина каждого столбца сетки в Excel-"units", пересчитанная из
    // ширины того же столбца на экране в пикселях (см. её же
    // LABEL_WIDTH/RESPONSIBLE_COL_WIDTH/dayWidth в ganttNode.js).
    const numColWidth = ganttNode.numColWidthOverride
        || Math.max(20, String(Math.max(tasks.length, 1)).length * 7 + 12);
    const labelWidth = typeof ganttNode._labelW === 'function' ? ganttNode._labelW() : 84;
    const respWidth = typeof ganttNode._respW === 'function' ? ganttNode._respW() : 70;
    const colWidths = [numColWidth, labelWidth, respWidth, ...dateColumns.map(() => DAY_WIDTH_PX)].map(pxToExcelUnits);

    return { grid, colWidths, merges };
}
