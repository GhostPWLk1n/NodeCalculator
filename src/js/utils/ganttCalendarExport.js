/**
 * SPDX-License-Identifier: MIT
 * SPDX-FileCopyrightText: 2024 NodeCalculate Team
 * SPDX-FileCopyrightText: 2024 Pavel Fomin
 *
 * @file    ganttCalendarExport.js
 * @brief   Сборка сетки {value,color,border} для экспорта GanttNode в Excel-календарь - обратный механизм к GanttTableProcessorNode
 * @author  Pavel Fomin
 * @version 1.8.58
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

// Раунд 156 (по запросу Mr.D: "цвета подзадач пусть задаются немного
// бледнее") - смешивает HEX-цвет с белым на долю amount (0..1) -
// применяется к ЗАДАЧАМ (не к самим разделам - те сохраняют "полный"
// цвет, чтобы визуально оставаться "главнее" своих подзадач в списке).
const SUBTASK_LIGHTEN_AMOUNT = 0.35;
function lightenHex(hex, amount) {
    const clean = hex.replace('#', '');
    const r = parseInt(clean.slice(0, 2), 16);
    const g = parseInt(clean.slice(2, 4), 16);
    const b = parseInt(clean.slice(4, 6), 16);
    const mix = (c) => Math.round(c + (255 - c) * amount);
    return [mix(r), mix(g), mix(b)].map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase();
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
    if (ganttNode.showSumWorkingDaysColumn) {
        cols.push({ key: 'sumworkdays', header: 'Сум.раб.дн.', width: typeof ganttNode._sumWorkdaysW === 'function' ? ganttNode._sumWorkdaysW() : 44 });
    }
    if (ganttNode.showSumHoursColumn) {
        cols.push({ key: 'sumhours', header: 'Сум.ч.ч.', width: typeof ganttNode._sumHoursW === 'function' ? ganttNode._sumHoursW() : 44 });
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

    // Раунд 155 (по запросу Mr.D: "нету строки общего 'Итого'. Должна
    // быть жирной светло-серой, так же с днём начала и конца") - та же
    // семантика, что buildTotalRow() на самой диаграмме (см.
    // ganttNode.js) - идёт СРАЗУ после заголовков, ДО первой задачи
    // (тот же порядок, что и в приложении). Считается по ВСЕМ задачам
    // (ganttNode.tasks - уже плоский, полный список после
    // _applyPromotedSections(), включает вложенные подразделы).
    const LIGHT_GRAY = 'D9D9D9';
    if (tasks.length > 0) {
        const totalRow = new Array(baseColCount + dateColumns.length).fill(null).map(() => ({ value: null, border: true, bold: true, color: LIGHT_GRAY }));
        const nameColIdx = baseCols.findIndex(c => c.key === 'name');
        if (nameColIdx >= 0) totalRow[nameColIdx].value = 'Итого';

        const tMinStart = Math.min(...tasks.map(t => t.startOffsetDays));
        const tMaxEnd = Math.max(...tasks.map(t => t.startOffsetDays + t.durationDays));
        const tHours = tasks.reduce((sum, t) => sum + t.durationDays * HOURS_PER_WORKDAY, 0);
        const tWorkdays = typeof ganttNode._countWorkingDaysInRange === 'function'
            ? ganttNode._countWorkingDaysInRange(anchor, tMinStart, tMaxEnd - tMinStart)
            : (tMaxEnd - tMinStart);
        baseCols.forEach((col, ci) => {
            switch (col.key) {
                case 'hours': totalRow[ci].value = Math.round(tHours); break;
                case 'workdays': totalRow[ci].value = tWorkdays; break;
                case 'caldays': totalRow[ci].value = tMaxEnd - tMinStart; break;
                case 'sumworkdays': totalRow[ci].value = typeof ganttNode._sumWorkdaysForTasks === 'function' ? ganttNode._sumWorkdaysForTasks(tasks) : null; break;
                case 'sumhours': totalRow[ci].value = typeof ganttNode._sumHoursForTasks === 'function' ? Math.round(ganttNode._sumHoursForTasks(tasks)) : null; break;
            }
        });

        const tStartDate = addDays(anchor, tMinStart);
        const tEndDate = addDays(anchor, tMaxEnd);
        const tStartColIdx = findColIndex(dateColumns, tStartDate);
        const tEndColIdx = findColIndex(dateColumns, tEndDate);
        if (tStartColIdx >= 0) totalRow[baseColCount + tStartColIdx].value = tStartDate.getDate();
        if (tEndColIdx >= 0 && tEndColIdx !== tStartColIdx) totalRow[baseColCount + tEndColIdx].value = tEndDate.getDate();

        grid.push(totalRow);
    }

    // Раунд 153 (по запросу Mr.D: "пропадает иерархия... В файл excel в
    // столбик № п/п записываем то что находится в столбце Раздел...
    // чтобы показать иерархию в xlsx мы не будем делать отступы, просто
    // строки групп должны быть жирными") - обход ДЕРЕВА (this.taskGroups
    // с subgroups, любая глубина - Раунд 150), не плоского this.tasks -
    // строка-заголовок раздела (bold:true, без отступа - плоская, но
    // визуально отличимая структура) чередуется с задачами В ТОМ ЖЕ
    // порядке, что на самой диаграмме.
    const pushTaskRow = (task) => {
        const row = new Array(baseColCount + dateColumns.length).fill(null).map(() => ({ value: null, border: true }));
        const responsible = typeof ganttNode._effectiveResponsible === 'function'
            ? ganttNode._effectiveResponsible(task)
            : (task.responsible || '');
        // Раунд 153 - "№ п/п" теперь = значение колонки "Раздел" (не
        // сквозной порядковый номер, как было раньше) - тот же принцип,
        // что уже применён на самой диаграмме (см. _effectiveSection()
        // в ganttNode.js) - пусто, если разделу задача не назначена.
        const sectionValue = typeof ganttNode._effectiveSection === 'function' ? ganttNode._effectiveSection(task) : '';
        baseCols.forEach((col, ci) => {
            switch (col.key) {
                case 'num': row[ci].value = sectionValue || null; break;
                case 'name': row[ci].value = task.name; break;
                case 'hours': row[ci].value = Math.round(task.durationDays * HOURS_PER_WORKDAY); break;
                case 'workdays': row[ci].value = typeof ganttNode._countWorkingDaysInRange === 'function'
                    ? ganttNode._countWorkingDaysInRange(anchor, task.startOffsetDays, task.durationDays)
                    : task.durationDays;
                    break;
                case 'responsible': row[ci].value = responsible; break;
                case 'caldays': row[ci].value = task.durationDays; break;
                case 'sumworkdays': row[ci].value = typeof ganttNode._sumWorkdaysForTasks === 'function' ? ganttNode._sumWorkdaysForTasks([task]) : null; break;
                case 'sumhours': row[ci].value = typeof ganttNode._sumHoursForTasks === 'function' ? Math.round(ganttNode._sumHoursForTasks([task])) : null; break;
            }
        });

        // Раунд 153 (по запросу Mr.D: "строки с задачами должны
        // окрашиваться в цвет раздела... разделы меняют цвет, а задачи
        // остаются по умолчанию") - _colorForTask() (единая точка,
        // ganttNode.js) - цвет ответственного в приоритете, иначе цвет
        // БЛИЖАЙШЕГО ПОКРАШЕННОГО раздела в цепочке предков (не только
        // самого глубокого, как было раньше - наследование сверху вниз).
        const color = (typeof ganttNode._colorForTask === 'function' ? ganttNode._colorForTask(task) : null) || DEFAULT_COLOR;
        const cleanColor = lightenHex(color.replace('#', ''), SUBTASK_LIGHTEN_AMOUNT);

        const startDate = addDays(anchor, task.startOffsetDays);
        const endDate = addDays(anchor, task.startOffsetDays + task.durationDays);
        const startColIdx = findColIndex(dateColumns, startDate);
        const endColIdx = findColIndex(dateColumns, endDate);
        // Раунд 155 (по запросу Mr.D: "протяжённые задачи должны быть
        // полностью залиты цветом. Все клеточки. От даты начала задачи,
        // до её конца") - раньше цветом красились ТОЛЬКО две крайние
        // ячейки (точки начала/конца - тот же "точечный маркер", что
        // разбирает _decodeTaskDates() при обратном чтении) - теперь
        // ВСЕ ячейки диапазона [startColIdx, endColIdx] заливаются
        // цветом, значение (число дня) остаётся ТОЛЬКО в двух крайних -
        // промежуточные несут цвет, но без числа (визуально сплошная
        // цветная полоса, как на самой диаграмме).
        if (startColIdx >= 0 && endColIdx >= 0) {
            const lo = Math.min(startColIdx, endColIdx);
            const hi = Math.max(startColIdx, endColIdx);
            for (let i = lo; i <= hi; i++) row[baseColCount + i].color = cleanColor;
            row[baseColCount + startColIdx].value = startDate.getDate();
            if (endColIdx !== startColIdx) row[baseColCount + endColIdx].value = endDate.getDate();
        } else if (startColIdx >= 0) {
            row[baseColCount + startColIdx].value = startDate.getDate();
            row[baseColCount + startColIdx].color = cleanColor;
        }

        grid.push(row);
    };

    const pushGroupHeaderRow = (group) => {
        const row = new Array(baseColCount + dateColumns.length).fill(null).map(() => ({ value: null, border: true, bold: true }));
        // Имя раздела - в колонку "Вид работ" (та же колонка, что имя
        // задачи - раздел визуально "занимает" всю строку своим
        // названием, без отступа, только жирным начертанием).
        const nameColIdx = baseCols.findIndex(c => c.key === 'name');
        if (nameColIdx >= 0) row[nameColIdx].value = group.name;

        // Раунд 154 (по жалобе Mr.D: "заголовки появились, но данные
        // заголовков пустые. Надо их заполнить как и данные задач") -
        // ТА ЖЕ агрегация, что уже показывает строка-заголовок раздела
        // НА САМОЙ диаграмме (см. buildGroupHeaderRow() в ganttNode.js) -
        // часы = ПРЯМАЯ сумма по всем задачам раздела (включая вложенные
        // подразделы - _allTasksRecursive()), раб.дни/кал.дни = по
        // ДИАПАЗОНУ (от начала самой ранней задачи до конца самой
        // поздней), не сумма - та же семантика, что "Итого"/группа на
        // экране.
        const groupTasks = typeof ganttNode._allTasksRecursive === 'function' ? ganttNode._allTasksRecursive(group) : (group.tasks || []);
        if (groupTasks.length > 0) {
            const gMinStart = Math.min(...groupTasks.map(t => t.startOffsetDays));
            const gMaxEnd = Math.max(...groupTasks.map(t => t.startOffsetDays + t.durationDays));
            const hoursTotal = groupTasks.reduce((sum, t) => sum + t.durationDays * HOURS_PER_WORKDAY, 0);
            const workdaysTotal = typeof ganttNode._countWorkingDaysInRange === 'function'
                ? ganttNode._countWorkingDaysInRange(anchor, gMinStart, gMaxEnd - gMinStart)
                : (gMaxEnd - gMinStart);

            baseCols.forEach((col, ci) => {
                switch (col.key) {
                    case 'hours': row[ci].value = Math.round(hoursTotal); break;
                    case 'workdays': row[ci].value = workdaysTotal; break;
                    case 'caldays': row[ci].value = gMaxEnd - gMinStart; break;
                    case 'sumworkdays': row[ci].value = typeof ganttNode._sumWorkdaysForTasks === 'function' ? ganttNode._sumWorkdaysForTasks(groupTasks) : null; break;
                    case 'sumhours': row[ci].value = typeof ganttNode._sumHoursForTasks === 'function' ? Math.round(ganttNode._sumHoursForTasks(groupTasks)) : null; break;
                }
            });

            // Раунд 156 (по жалобе Mr.D: "диапазоны групп не заливаются
            // цветом" - обнаружено в прикреплённом файле-результате) -
            // тот же класс недоделки, что чинил для задач в Раунде 155 -
            // тогда сплошную заливку применил ТОЛЬКО к pushTaskRow(),
            // забыв про pushGroupHeaderRow() - здесь была ещё старая
            // "точечная" раскраска (только начало/конец). Теперь ВСЕ
            // ячейки диапазона заливаются собственным цветом раздела.
            const ownColor = (ganttNode.groupColors && ganttNode.groupColors[group.name]) || DEFAULT_COLOR;
            const cleanOwnColor = ownColor.replace('#', '').toUpperCase();
            const startDate = addDays(anchor, gMinStart);
            const endDate = addDays(anchor, gMaxEnd);
            const startColIdx = findColIndex(dateColumns, startDate);
            const endColIdx = findColIndex(dateColumns, endDate);
            if (startColIdx >= 0 && endColIdx >= 0) {
                const lo = Math.min(startColIdx, endColIdx);
                const hi = Math.max(startColIdx, endColIdx);
                for (let i = lo; i <= hi; i++) row[baseColCount + i].color = cleanOwnColor;
                row[baseColCount + startColIdx].value = startDate.getDate();
                if (endColIdx !== startColIdx) row[baseColCount + endColIdx].value = endDate.getDate();
            } else if (startColIdx >= 0) {
                row[baseColCount + startColIdx].value = startDate.getDate();
                row[baseColCount + startColIdx].color = cleanOwnColor;
            }
        }

        // "Раздел"/"Ответственный" раздела - только если назначены явно
        // через инспектор (Раунд 149, taskSectionOverrides/taskResponsible
        // по originKey) - иначе пусто (расчётные величины уже заполнены
        // выше, эти два поля - НЕ агрегат, ручной ввод).
        if (group.originKey) {
            const sectionVal = ganttNode.taskSectionOverrides && ganttNode.taskSectionOverrides[group.originKey];
            const respVal = ganttNode.taskResponsible && ganttNode.taskResponsible[group.originKey];
            baseCols.forEach((col, ci) => {
                if (col.key === 'num' && sectionVal) row[ci].value = sectionVal;
                if (col.key === 'responsible' && respVal) row[ci].value = respVal;
            });
        }

        grid.push(row);
    };

    const walkGroup = (group) => {
        // "" - синтетическая безымянная корзина для задач ДО первого
        // раздела (см. _applyPromotedSections() в ganttNode.js) - у неё
        // самой заголовка не показываем, только её задачи.
        if (group.name) pushGroupHeaderRow(group);
        group.tasks.forEach(pushTaskRow);
        (group.subgroups || []).forEach(walkGroup);
    };

    if (Array.isArray(ganttNode.taskGroups) && ganttNode.taskGroups.length > 0) {
        ganttNode.taskGroups.forEach(walkGroup);
    } else {
        tasks.forEach(pushTaskRow);
    }

    // Раунд 111 (по запросу Mr.D: "остальные столбики тоже") + Раунд 112
    // (реальный коэффициент px->units, см. pxToExcelUnits()) - ширина
    // каждого столбца сетки в Excel-"units", пересчитанная из ширины
    // того же столбца на экране в пикселях.
    const colWidths = [...baseCols.map(c => c.width), ...dateColumns.map(() => DAY_WIDTH_PX)].map(pxToExcelUnits);

    return { grid, colWidths, merges };
}
