/**
 * SPDX-License-Identifier: MIT
 * SPDX-FileCopyrightText: 2024 NodeCalculate Team
 * SPDX-FileCopyrightText: 2024 Pavel Fomin
 *
 * @file    ganttTableProcessorNode.js
 * @brief   Разбор сырой Гант-подобной таблицы (заголовок/разделы/задачи) на три отдельных выхода
 * @author  Pavel Fomin
 * @version 1.8.9
 * @see     https://github.com/GhostPWLk1n/NodeCalculator.git
 */

import { BaseNode } from './baseNode.js';
import { TableData, ListData } from '../utils/dataTypes.js';
import { SocketFactory } from '../utils/socketFactory.js';
import { TableWidgetRenderer } from '../utils/tableWidgetRenderer.js';

// Раунд 105 (уточнение Mr.D: "для Обработки таблиц Ганта слот с
// праздниками не нужен") - HOLIDAY_SOCKET_INDEX и связанные с ним
// isNonWorkingDay()/countWorkingDaysInRange() (Раунд 101) убраны -
// календарная корректировка целиком на стороне GanttNode, у процессора
// своего календаря нет и не должно быть.

// Раунд 97 - справочник русских названий месяцев (регистронезависимо -
// в реальных файлах встречается разный регистр, см. calendar_2026.json
// от Mr.D и сам разбираемый файл: "Декабрь" и "февраль" в одной строке).
const RU_MONTHS = {
    'январь': 1, 'февраль': 2, 'март': 3, 'апрель': 4, 'май': 5, 'июнь': 6,
    'июль': 7, 'август': 8, 'сентябрь': 9, 'октябрь': 10, 'ноябрь': 11, 'декабрь': 12
};

function formatDdMmYyyy(date) {
    return `${String(date.getDate()).padStart(2, '0')}.${String(date.getMonth() + 1).padStart(2, '0')}.${date.getFullYear()}`;
}

/**
 * GanttTableProcessorNode ("Обработка таблиц Ганта") - Раунд 84, первый
 * шаг (по прямому запросу Mr.D, разобрана СТРУКТУРНАЯ часть; разбор
 * дат по цвету/числам в ячейках - предмет отдельного будущего раунда,
 * см. CHANGES.md).
 *
 * Рассчитан на сырые таблицы вроде типового Гант-плана проектных работ
 * (образец - файл Mr.D "...График проектирования АГК.xlsx"):
 *   строка 1 - общий заголовок листа (объединённая ячейка)
 *   строка 2 - подзаголовок/название графика (тоже объединённая)
 *   строка 3+ - шапка таблицы (№ п/п / Вид работ / Ответственный / года-
 *              месяцы-недели), затем чередование строк-РАЗДЕЛОВ (заполнена
 *              только колонка B, например "Список ИРД") и обычных строк
 *              задач (№ в колонке A, задача в B, ответственный в C).
 *
 * ВХОД (1 сокет, `any`) - таблица ИЗ `XlsxImportNode` (или совместимая) -
 * "первая строка листа всегда заголовки" (см. докстринг xlsxReader.js) -
 * поэтому заголовок листа читается из `column.header` (не из values), а
 * подзаголовок - из первой строки values.
 *
 * ВЫХОД - три ЧЕСТНЫХ разных сокета (Раунд 84, фундамент
 * `BaseNode.getOutputBySocket()`/`nodeManager.getSourceOutput()`, без
 * него это были бы три одинаковых сокета, отдающих одно и то же):
 *   0 - Заголовок (строка 1 листа)
 *   1 - Подзаголовок (строка 2 листа)
 *   2 - Таблица: Раздел (из строк-разделов, вперёд-заполнено на все
 *       задачи до следующего раздела) / № / Задача / Ответственный
 */
export class GanttTableProcessorNode extends BaseNode {
    constructor(id, type, x, y, config = {}) {
        super(id, type, x, y, config);
        this.inputs = 1;
        this.inputSockets = [0];
        this.outputs = 3;
        // Раунд 106 (чек-лист, раздел 2) - минимальная ширина 232px.
        this.width = Math.max(config.width || 230, 232);
        this.minWidth = 232; // Раунд 106 - применяется и при ручном растягивании через UI

        // Раунд 84 (компромисс по итогам обсуждения с Mr.D) - null =
        // автоопределение по тексту "№ п/п" в колонке A + первая
        // непустая строка колонки B ПОСЛЕ неё (пропускает шапку года/
        // месяца/недели - см. _detectDataStartIndex()). Число - ручное
        // переопределение (1-based, СЧИТАЯ ОТ ПЕРВОЙ СТРОКИ ДАННЫХ
        // XlsxImportNode, т.е. БЕЗ строки, которую тот сам считает
        // заголовком) - на случай, если автопоиск ошибся на нетиповом
        // шаблоне.
        this.dataStartRowOverride = config.dataStartRowOverride ?? null;
        // Раунд 97 - сопоставление ЦВЕТ (HEX, верхний регистр) -> РОЛЬ
        // ('point'/'start'/'end'/'duration'/'ignore') - НАСТРАИВАЕТСЯ
        // пользователем в панели инспектора, НИЧЕГО не назначается
        // автоматически по умолчанию (см. calculate() - только
        // автообнаружение САМИХ цветов, присутствующих в файле, роль -
        // всегда явный выбор). См. докстринг _decodeTaskDates().
        this.colorRoles = config.colorRoles ? { ...config.colorRoles } : {};
        this._detectedColors = []; // для статуса в панели - что вообще нашли в файле
        this._detectedStartIndex = null; // для статуса в панели - что нашёл автопоиск

        this.titleText = '';
        this.subtitleText = '';
        this._titleTableData = new TableData();
        this._subtitleTableData = new TableData();
        this.tableData = new TableData();   // выход 2
        this.listData = new ListData();
        this._sourceName = null;
    }

    createContent() {
        const content = document.createElement('div');
        content.className = 'node-content';
        content.style.cssText = 'width:100%; min-width:200px; display:flex; flex-direction:column; gap:4px;';

        const inRow = document.createElement('div');
        inRow.style.cssText = 'display:flex; align-items:center; gap:6px;';
        const inSocket = SocketFactory.createSocket({
            // Раунд 98 (замечание Mr.D: "принимает по факту таблицы") -
            // Data-сокет (оранжевый ромб), не any - вход реально ожидает
            // именно таблицу (output.tableData, см. calculate()), не
            // произвольный тип данных.
            nodeId: this.id, socketType: 'input', index: 0, isData: true,
            title: 'Сырая таблица из Импорта Excel/JSON'
        });
        inRow.appendChild(inSocket);
        const inLabel = document.createElement('span');
        inLabel.className = 'gtp-source-label';
        inLabel.style.cssText = 'color:var(--md-text-secondary); font-size:11px; flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;';
        inLabel.textContent = this._statusText();
        inRow.appendChild(inLabel);
        content.appendChild(inRow);

        const statusRow = document.createElement('div');
        statusRow.className = 'gtp-detect-status';
        statusRow.style.cssText = 'color:var(--md-text-disabled); font-size:10px; padding-left:20px;';
        statusRow.textContent = this._detectStatusText();
        content.appendChild(statusRow);

        // Три выходных ряда - каждый свой сокет и своя метка (Раунд 84,
        // честные разные выходы через getOutputBySocket())
        const outputs = [
            { index: 0, label: 'Заголовок', hint: () => this.titleText || '—' },
            { index: 1, label: 'Подзаголовок', hint: () => this.subtitleText || '—' },
            { index: 2, label: 'Таблица', hint: () => `${this.tableData.rowCount} стр.` }
        ];
        outputs.forEach(o => {
            const row = document.createElement('div');
            row.className = 'gtp-output-row';
            row.style.cssText = `
                display: flex;
                align-items: center;
                gap: 8px;
                padding-top: 4px;
                margin-top: 2px;
                border-top: 1px solid var(--md-divider);
            `;
            const label = document.createElement('label');
            label.textContent = `${o.label}:`;
            label.style.cssText = 'color:var(--md-text-secondary); font-size:11px; flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;';
            row.appendChild(label);
            const hint = document.createElement('span');
            hint.className = `gtp-hint-${o.index}`;
            hint.style.cssText = 'color:var(--md-text-disabled); font-size:10px; max-width:90px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;';
            hint.textContent = o.hint();
            row.appendChild(hint);
            const socket = SocketFactory.createSocket({
                nodeId: this.id, socketType: 'output', index: o.index,
                // Раунд 85 (по запросу Mr.D) - "Заголовок"/"Подзаголовок"
                // (index 0/1) - синий круглый сокет строкового рода
                // (isString), не Data - это одиночная строка текста, не
                // таблица. "Таблица" (index 2) остаётся Data, как была.
                isString: o.index < 2,
                isData: o.index === 2,
                title: o.label
            });
            row.appendChild(socket);
            content.appendChild(row);
        });

        return content;
    }

    _statusText() {
        if (!this._sourceName) return 'не подключено';
        return `${this._sourceName} — ${this.tableData.rowCount} стр.`;
    }

    _detectStatusText() {
        if (this.dataStartRowOverride) return `строка начала данных: ${this.dataStartRowOverride} (вручную)`;
        if (this._detectedStartIndex === null) return 'строка "№ п/п" не найдена - см. настройки';
        return `строка "№ п/п" найдена, данные с позиции ${this._detectedStartIndex + 1}`;
    }

    // Ищет строку с текстом "№ п/п" (после удаления пробелов - учитывает
    // варианты написания вроде "№п/п", "№ п / п") в колонке A - это же
    // строка несёт ГОД в области дат (см. _buildDateColumnMap() ниже,
    // Раунд 97) - переиспользуется и для определения начала данных, и
    // для разбора сетки года/месяца/недели.
    _findHeaderRowIndex(colA) {
        for (let i = 0; i < colA.length; i++) {
            const v = colA[i];
            if (v !== null && v !== undefined && /№.{0,3}п.{0,2}п/i.test(String(v).replace(/\s/g, ''))) {
                return i;
            }
        }
        return null;
    }

    // Первая строка ПОСЛЕ строки "№ п/п", где непуста колонка B -
    // пропускает шапку года/месяца/недели (у неё заполнена только
    // область дат, колонка B пуста), приземляется ровно на первую
    // строку-раздел или строку-задачу.
    _detectDataStartIndex(colA, colB) {
        const headerRowIdx = this._findHeaderRowIndex(colA);
        if (headerRowIdx === null) return null;
        for (let i = headerRowIdx + 1; i < colB.length; i++) {
            const b = colB[i];
            if (b !== null && b !== undefined && String(b).trim() !== '') {
                return i;
            }
        }
        return null;
    }

    // Раунд 97 - сопоставляет КАЖДУЮ колонку области дат (начиная с
    // индекса 3 - первая колонка ПОСЛЕ №/Задача/Ответственный) с
    // {year, month, week}. Строка headerRowIdx несёт год (значение
    // ТОЛЬКО в первой колонке каждого года - объединённая ячейка,
    // остальные в XML физически пустые - "вперёд-заполняем"), строка
    // headerRowIdx+1 - месяц (тот же принцип объединения), строка
    // headerRowIdx+2 - номер недели ВНУТРИ месяца (1-4, заполнена в
    // КАЖДОЙ колонке отдельно, объединения нет). Именно такая структура
    // (год/месяц/неделя, 3 строки подряд) подтверждена на реальном
    // файле Mr.D - для другого шаблона может не подойти без ручной
    // подстройки this.dataStartRowOverride (сдвигает headerRowIdx).
    _buildDateColumnMap(t, headerRowIdx) {
        const map = [];
        if (headerRowIdx === null) return map;
        const yearRowIdx = headerRowIdx;
        const monthRowIdx = headerRowIdx + 1;
        const weekRowIdx = headerRowIdx + 2;

        let lastYear = null;
        let lastMonth = null;

        for (let c = 3; c < t.columns.length; c++) {
            const col = t.columns[c];
            const rawYear = col.values[yearRowIdx];
            const rawMonth = col.values[monthRowIdx];
            const rawWeek = col.values[weekRowIdx];

            if (rawYear !== null && rawYear !== undefined && String(rawYear).trim() !== '') {
                const y = parseInt(rawYear, 10);
                if (!isNaN(y)) lastYear = y;
            }
            if (rawMonth !== null && rawMonth !== undefined && String(rawMonth).trim() !== '') {
                const m = RU_MONTHS[String(rawMonth).trim().toLowerCase()];
                if (m) lastMonth = m;
            }
            const week = (rawWeek !== null && rawWeek !== undefined) ? parseInt(rawWeek, 10) : null;

            map[c] = (lastYear && lastMonth)
                ? { year: lastYear, month: lastMonth, week: (week && !isNaN(week)) ? week : null }
                : null;
        }
        return map;
    }

    _safeDate(year, month, day) {
        const d = new Date(year, month - 1, day);
        return isNaN(d.getTime()) ? null : d;
    }

    // Приблизительная граница недели ВНУТРИ месяца (у исходного файла
    // "неделя" - это просто 1-4 доля месяца, не настоящий календарный
    // номер недели года) - используется ТОЛЬКО для роли 'duration'
    // (сплошная полоса без чисел внутри - нет точного дня, только
    // "эта неделя месяца целиком").
    _weekApproxStart(year, month, week) {
        if (!week) return this._safeDate(year, month, 1);
        return this._safeDate(year, month, (week - 1) * 7 + 1);
    }

    _weekApproxEnd(year, month, week) {
        const daysInMonth = new Date(year, month, 0).getDate();
        if (!week) return this._safeDate(year, month, daysInMonth);
        return this._safeDate(year, month, Math.min(week * 7, daysInMonth));
    }

    // Раунд 97 - разбирает даты ОДНОЙ строки-задачи по цвету+числам её
    // ячеек в области дат. this.colorRoles - настраиваемое (Инспектор)
    // сопоставление ЦВЕТ -> РОЛЬ:
    //   'point'/'start'/'end' - ячейка с ЧИСЛОМ внутри = конкретный день
    //     месяца (число из самой ячейки, месяц/год - из dateColumnMap
    //     этой колонки). Несколько таких ячеек в строке - самая ранняя
    //     дата становится началом, самая поздняя - концом.
    //   'duration' - сплошная заливка БЕЗ чисел, растянутая на
    //     несколько колонок - начало/конец берутся ПРИБЛИЗИТЕЛЬНО, по
    //     границам недель первой/последней закрашенной колонки (нет
    //     точного дня для такой заливки в принципе - в файле не записан).
    //   без роли (не назначено пользователем) / 'ignore' - ячейка
    //     игнорируется целиком (например, серая заливка выходных/
    //     праздников, если Mr.D назначит ей 'ignore' явно - по
    //     умолчанию НИЧЕГО не назначено автоматически, см. calculate()
    //     про автоопределение цветов с ролью '' до explicit выбора).
    _decodeTaskDates(rowIdx, t, dateColumnMap, cellColors) {
        const points = [];
        const durationCols = [];

        for (let c = 3; c < t.columns.length; c++) {
            const mapping = dateColumnMap[c];
            if (!mapping) continue;
            const color = cellColors[rowIdx]?.[c] || null;
            if (!color) continue;
            const role = this.colorRoles[color.toUpperCase()];
            if (!role || role === 'ignore') continue;

            if (role === 'duration') {
                durationCols.push({ colIdx: c, mapping });
                continue;
            }

            // 'point'/'start'/'end' - число ВНУТРИ этой же ячейки = день месяца
            const cellValue = t.columns[c].values[rowIdx];
            const dayNum = (cellValue !== null && cellValue !== undefined && cellValue !== '' && !isNaN(parseFloat(cellValue)))
                ? Math.round(parseFloat(cellValue))
                : null;
            if (dayNum && dayNum >= 1 && dayNum <= 31) {
                const date = this._safeDate(mapping.year, mapping.month, dayNum);
                if (date) points.push(date);
            }
        }

        if (points.length > 0) {
            points.sort((a, b) => a - b);
            return { start: points[0], end: points[points.length - 1] };
        }

        if (durationCols.length > 0) {
            durationCols.sort((a, b) => a.colIdx - b.colIdx);
            const first = durationCols[0].mapping;
            const last = durationCols[durationCols.length - 1].mapping;
            const start = this._weekApproxStart(first.year, first.month, first.week);
            const end = this._weekApproxEnd(last.year, last.month, last.week);
            if (start && end) return { start, end };
        }

        return null;
    }

    calculate(nodeManager) {
        const connections = window.connectionManager?.getConnections() || [];
        const conn = connections.find(c => c.targetNodeId === this.id && c.targetSocket === 0);
        const src = conn ? nodeManager.getNode(conn.sourceNodeId) : null;
        // Раунд 84 - через getSourceOutput() (учитывает конкретный
        // выходной сокет источника, если тот тоже многовыходный)
        const output = conn ? nodeManager.getSourceOutput(conn) : null;
        this._sourceName = src ? (src.customName || src.getDisplayName?.() || 'источник') : null;

        const t = output?.tableData;
        if (!t || t.columns.length === 0) {
            this.titleText = '';
            this.subtitleText = '';
            this._titleTableData = new TableData();
            this._subtitleTableData = new TableData();
            this.tableData = new TableData();
            this.listData = new ListData();
            this._detectedStartIndex = null;
            this.clearBadge('gtp-no-header-row');
            this.value = 0;
            return 0;
        }

        // Заголовок - из .header столбца, у которого он реально текстом
        // задан (обычно только колонка A - строка 1 листа "съедена" в
        // заголовки самим XlsxImportNode, см. её headerRow).
        const titleCol = t.columns.find(c => c.header && String(c.header).trim());
        this.titleText = titleCol ? String(titleCol.header).trim() : '';

        // Подзаголовок - первая строка ДАННЫХ (values[0]) - первое
        // непустое значение по всем столбцам.
        this.subtitleText = '';
        for (const col of t.columns) {
            const v = col.values[0];
            if (v !== null && v !== undefined && String(v).trim()) {
                this.subtitleText = String(v).trim();
                break;
            }
        }

        this._titleTableData = new TableData(
            [{ header: 'Заголовок', format: 'text', values: [this.titleText] }],
            { title: 'Заголовок' }
        );
        this._subtitleTableData = new TableData(
            [{ header: 'Подзаголовок', format: 'text', values: [this.subtitleText] }],
            { title: 'Подзаголовок' }
        );

        const colA = t.columns[0]?.values || [];
        const colB = t.columns[1]?.values || [];
        const colC = t.columns[2]?.values || [];

        let startIdx;
        if (this.dataStartRowOverride) {
            startIdx = Math.max(0, this.dataStartRowOverride - 1);
            this._detectedStartIndex = null;
            this.clearBadge('gtp-no-header-row');
        } else {
            const detected = this._detectDataStartIndex(colA, colB);
            this._detectedStartIndex = detected;
            startIdx = detected ?? 0;
            if (detected === null) {
                this.addBadge('gtp-no-header-row', { type: 'warning', text: 'Строка "№ п/п" не найдена - данные читаются с самого начала, задайте строку вручную' });
            } else {
                this.clearBadge('gtp-no-header-row');
            }
        }

        // Раздел (Раунд 84) -> Группа (Раунд 85, переименовано под
        // структуру GanttNode.buildOutputTable() - см. ниже) - строка,
        // где заполнена ТОЛЬКО колонка B (А и C пусты) - берётся как
        // ярлык группы для ВСЕХ последующих строк-задач, пока не
        // встретится следующий раздел ("вперёд-заполнение", тот же
        // принцип, что уже применён в TreeToTableNode). Сама строка-
        // раздел в итоговую таблицу не попадает - это заголовок, не
        // задача.
        //
        // "№" (Раунд 84) сознательно отброшен (Раунд 85, по решению
        // Mr.D) - структура выхода теперь ДОЛЖНА один-в-один совпадать
        // с тем, что сама Диаграмма Ганта отдаёт на своём выходе
        // (buildOutputTable() в ganttNode.js) - если "№" туда когда-то
        // добавят, вернём и сюда, отдельным решением.
        const cellColors = (src && Array.isArray(src.cellColors)) ? src.cellColors : null;

        // Раунд 97 - автообнаружение ВСЕХ цветов, встреченных в области
        // дат (не назначаем роль автоматически - только заводим запись
        // '' в colorRoles, если её ещё нет, чтобы цвет появился в панели
        // для явного выбора пользователем).
        if (cellColors) {
            const found = new Set();
            for (let r = 0; r < cellColors.length; r++) {
                const row = cellColors[r] || [];
                for (let c = 3; c < row.length; c++) {
                    if (row[c]) found.add(String(row[c]).toUpperCase());
                }
            }
            this._detectedColors = [...found].sort();
            this._detectedColors.forEach(color => {
                if (!(color in this.colorRoles)) this.colorRoles[color] = '';
            });
        } else {
            this._detectedColors = [];
        }

        // Раунд 97 - сопоставление КАЖДОЙ колонки области дат (D+) с
        // годом/месяцем/неделей - см. _buildDateColumnMap(). Строка "№
        // п/п" несёт ЕЩЁ и год в этой же строке (см. её докстринг) -
        // headerRowIdx переиспользуется для обоих целей.
        const headerRowIdx = this._findHeaderRowIndex(colA);
        const dateColumnMap = this._buildDateColumnMap(t, headerRowIdx);

        const groups = [];
        const tasks = [];
        const responsibles = [];
        const starts = [];
        const ends = [];
        const workdays = [];
        const factDays = [];
        let currentGroup = '';
        let decodedCount = 0;

        for (let i = startIdx; i < t.rowCount; i++) {
            const a = colA[i];
            const b = colB[i];
            const c = colC[i];
            const bStr = (b !== null && b !== undefined) ? String(b).trim() : '';
            const hasA = a !== null && a !== undefined && String(a).trim() !== '';
            const hasC = c !== null && c !== undefined && String(c).trim() !== '';

            if (!hasA && !hasC && bStr) {
                currentGroup = bStr;
                continue;
            }
            if (!hasA && !bStr) continue; // полностью пустая строка

            groups.push(currentGroup);
            tasks.push(bStr);
            responsibles.push(hasC ? String(c).trim() : '');

            // Раунд 97 - пробуем разобрать РЕАЛЬНЫЕ даты из цвета+чисел
            // этой строки (см. _decodeTaskDates()) - получится только
            // если источник вообще несёт cellColors (см. XlsxImportNode,
            // Раунд 96) И хотя бы один цвет в этой строке уже назначен
            // какой-то ролью (this.colorRoles, настраивается в
            // инспекторе) - иначе, как и раньше, дефолт.
            const decoded = cellColors ? this._decodeTaskDates(i, t, dateColumnMap, cellColors) : null;
            if (decoded) {
                decodedCount++;
                starts.push(formatDdMmYyyy(decoded.start));
                ends.push(formatDdMmYyyy(decoded.end));
                const calDays = Math.max(0, Math.round((decoded.end - decoded.start) / 86400000));
                // Раунд 105 (уточнение Mr.D после Раунда 101: "для
                // Обработки таблиц Ганта слот с праздниками не нужен, мы
                // ровно так же берём для расчёта столбец 'Начало' и
                // 'Раб.дни'") - откат к простому calDays. Реальная
                // календарная корректировка (выходные/праздники) теперь
                // ЦЕЛИКОМ на стороне GanttNode - её собственный
                // spanWorkingDays() с ЕЁ собственным this.holidaySet
                // пересчитывает "Начало"+"Раб.дни" в итоговое положение
                // на диаграмме (см. её tasksFromTable(), Раунд 105) - у
                // процессора нет и не должно быть своего календаря,
                // "Раб.дни" здесь - просто сырое число, отправная точка.
                workdays.push(calDays);
                factDays.push(calDays);
            } else {
                starts.push(null); // заполняется дефолтом ниже, после цикла (нужно знать today один раз)
                ends.push(null);
                workdays.push(0);
                factDays.push(0);
            }
        }

        // Раунд 85 - структура один-в-один с GanttNode.buildOutputTable()
        // (Группа/Задача/Начало/Раб.дни/Окончание/Факт.дни/Ответственный) -
        // чтобы результат уже сейчас можно было подключить напрямую к
        // Диаграмме Ганта как совместимую таблицу (isCompatibleTable()
        // проверяет только наличие "начал"/"оконч" в заголовках, они
        // есть). Раунд 97 - там, где даты УДАЛОСЬ разобрать по цвету -
        // они настоящие; там, где нет (нет cellColors у источника, или
        // ни один цвет в этой строке ещё не назначен ролью) - дефолт
        // "сегодня", как и раньше (диаграмма Ганта всё равно
        // ПЕРЕСЧИТАЕТ при подключении своей логикой авто-расстановки).
        const today = new Date();
        const defaultDate = `${String(today.getDate()).padStart(2, '0')}.${String(today.getMonth() + 1).padStart(2, '0')}.${today.getFullYear()}`;
        const n = tasks.length;
        for (let i = 0; i < n; i++) {
            if (starts[i] === null) starts[i] = defaultDate;
            if (ends[i] === null) ends[i] = defaultDate;
        }

        if (cellColors && decodedCount > 0) {
            this.addBadge('gtp-dates-decoded', { type: 'info', text: `Даты распознаны по цвету: ${decodedCount} из ${n} задач` });
        } else {
            this.clearBadge('gtp-dates-decoded');
        }

        this.tableData = new TableData([
            { header: 'Группа', values: groups, format: 'text' },
            { header: 'Задача', values: tasks, format: 'text' },
            { header: 'Начало', values: starts, format: 'text' },
            { header: 'Раб.дни', values: workdays, format: 'number' },
            { header: 'Окончание', values: ends, format: 'text' },
            { header: 'Факт.дни', values: factDays, format: 'number' },
            { header: 'Ответственный', values: responsibles, format: 'text' }
        ], { title: this.customName || this.getDisplayName() });

        this.listData = new ListData(
            tasks.map(name => ({ name, value: 1 })),
            { title: 'Задачи' }
        );

        this.value = tasks.length;
        return this.value;
    }

    // Раунд 84 - ЧЕСТНЫЕ разные данные по разным выходным сокетам (см.
    // докстринг BaseNode.getOutputBySocket()). Потребитель, читающий
    // через nodeManager.getSourceOutput(conn), получит именно то, к
    // какому сокету подключился - потребитель, ЕЩЁ не переведённый на
    // getSourceOutput() (читающий node.tableData напрямую), по-прежнему
    // получит третий выход (основную таблицу) - разумный запасной
    // вариант, а не пустое значение.
    getOutputBySocket(index) {
        if (index === 0) {
            return { value: this.titleText, tableData: this._titleTableData, listData: new ListData(), resultListData: null };
        }
        if (index === 1) {
            return { value: this.subtitleText, tableData: this._subtitleTableData, listData: new ListData(), resultListData: null };
        }
        return { value: this.value, tableData: this.tableData, listData: this.listData, resultListData: this.resultListData };
    }

    getDashboardWidget() {
        const node = this;
        return {
            type: 'table',
            title: this.customName || null,
            render: (container) => {
                container.appendChild(TableWidgetRenderer.build(node));
            }
        };
    }

    getInspectorSchema() {
        const fields = super.getInspectorSchema();

        fields.push({ type: 'section', label: 'Разбор таблицы' });

        fields.push({
            key: 'dataStartRowOverride',
            label: 'Строка начала данных (0 = автопоиск по "№ п/п")',
            type: 'number',
            min: 0, step: 1,
            get: () => this.dataStartRowOverride ?? 0,
            set: (v) => {
                const n = parseInt(v, 10);
                this.dataStartRowOverride = (!n || n <= 0) ? null : n;
            }
        });

        // Раунд 97 - роли цветов (разбор дат по заливке ячеек) - только
        // если источник вообще несёт cellColors и хоть один цвет найден.
        // Сворачиваемый блок (может быть длинным - десятки оттенков в
        // реальном файле) - по умолчанию свёрнут, чтобы не загромождать
        // панель для тех, кто цвета не использует вовсе.
        if (this._detectedColors.length > 0) {
            fields.push({ type: 'section', label: `Роли цветов (${this._detectedColors.length})`, collapsible: true, collapsed: true });

            this._detectedColors.forEach(color => {
                fields.push({
                    key: `colorRole_${color}`,
                    label: color,
                    swatchColor: color,
                    type: 'select',
                    options: [
                        { value: '', label: '— не назначено (игнорировать) —' },
                        { value: 'point', label: 'Точка - число внутри = день месяца' },
                        { value: 'duration', label: 'Полоса - протяжённая работа (без чисел)' },
                        { value: 'ignore', label: 'Игнорировать явно (например, фон выходных)' }
                    ],
                    get: () => this.colorRoles[color] || '',
                    set: (v) => { this.colorRoles[color] = v || ''; }
                });
            });
        }

        return fields;
    }

    updateDisplay(element) {
        const label = element.querySelector('.gtp-source-label');
        if (label) label.textContent = this._statusText();

        const status = element.querySelector('.gtp-detect-status');
        if (status) status.textContent = this._detectStatusText();

        const hint0 = element.querySelector('.gtp-hint-0');
        if (hint0) hint0.textContent = this.titleText || '—';
        const hint1 = element.querySelector('.gtp-hint-1');
        if (hint1) hint1.textContent = this.subtitleText || '—';
        const hint2 = element.querySelector('.gtp-hint-2');
        if (hint2) hint2.textContent = `${this.tableData.rowCount} стр.`;
    }
}
