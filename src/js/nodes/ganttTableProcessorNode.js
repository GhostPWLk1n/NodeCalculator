/**
 * SPDX-License-Identifier: MIT
 * SPDX-FileCopyrightText: 2024 NodeCalculate Team
 * SPDX-FileCopyrightText: 2024 Pavel Fomin
 *
 * @file    ganttTableProcessorNode.js
 * @brief   Разбор сырой Гант-подобной таблицы (заголовок/разделы/задачи) на три отдельных выхода
 * @author  Pavel Fomin
 * @version 1.8.46
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
        this.tableData = new TableData();   // выход 2 - ПРОИЗВОДНАЯ от дерева (Раунд 132), обратная совместимость
        // Раунд 132 - канонiчная структура данных, "классический
        // словарь" ({roots: [...]}, каждый узел - {name, type, ...,
        // children}) - см. calculate()/_flattenTreeToTable().
        this.treeData = { roots: [] };
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
    // Раунд 134 (по решению Mr.D: "добавим проверку колонок, на всякий
    // случай, вдруг будет сдвиг. Ищем названия в строке, в которой
    // должны быть заглавия колонок") - раньше строка заголовков
    // искалась ТОЛЬКО в колонке с ФИКСИРОВАННЫМ индексом 0 (t.columns[0]),
    // а №/Вид работ/Ответственный тоже читались по фиксированным
    // индексам 0/1/2 - если реальный порядок столбцов в источнике
    // отличался (другой набор колонок выбран при импорте, другой
    // исходный файл), всё распознавание тихо ломалось. Теперь ищем
    // строку, где хоть в какой-то колонке есть "№ п/п"-подобный текст -
    // ЭТА строка и есть заголовок, а индексы Вид работ/Ответственный
    // определяются ПО ИХ СОБСТВЕННЫМ именам заголовков В ТОЙ ЖЕ строке
    // (не по смещению от № п/п) - с запасным вариантом (числ+1/+2),
    // если имя не нашлось (нестандартный файл), чтобы не отказывать
    // совсем.
    _findHeaderRowAndColumns(t) {
        const rowCount = t.columns[0]?.values.length || 0;
        for (let r = 0; r < rowCount; r++) {
            for (let c = 0; c < t.columns.length; c++) {
                const v = t.columns[c].values[r];
                if (v === null || v === undefined) continue;
                if (!/№.{0,3}п.{0,2}п/i.test(String(v).replace(/\s/g, ''))) continue;

                let workColIdx = null;
                let respColIdx = null;
                for (let c2 = 0; c2 < t.columns.length; c2++) {
                    const hv = String(t.columns[c2].values[r] ?? '').toLowerCase();
                    if (workColIdx === null && c2 !== c && (hv.includes('вид работ') || hv.includes('наименование'))) workColIdx = c2;
                    if (respColIdx === null && c2 !== c && hv.includes('ответствен')) respColIdx = c2;
                }
                const numColIdx = c;
                // Запасной вариант - следующие две колонки ПОСЛЕ №,
                // если имя заголовка не нашлось буквально (нестандартный
                // файл) - та же относительная раскладка, что была
                // раньше зашита жёстко.
                if (workColIdx === null) workColIdx = numColIdx + 1;
                if (respColIdx === null) respColIdx = numColIdx + 2;

                return { headerRowIdx: r, numColIdx, workColIdx, respColIdx };
            }
        }
        return null;
    }

    // Первая строка ПОСЛЕ строки заголовков, где непуста колонка "Вид
    // работ" - пропускает шапку года/месяца/недели (у неё заполнена
    // только область дат, "Вид работ" пуста), приземляется ровно на
    // первую строку-раздел или строку-задачу.
    _detectDataStartIndex(headerInfo, workCol) {
        if (!headerInfo) return null;
        for (let i = headerInfo.headerRowIdx + 1; i < workCol.length; i++) {
            const b = workCol[i];
            if (b !== null && b !== undefined && String(b).trim() !== '') {
                return i;
            }
        }
        return null;
    }

    // Раунд 97 - сопоставляет КАЖДУЮ колонку области дат (начиная с
    // dateStartCol - Раунд 134, теперь ВЫЧИСЛЯЕТСЯ по реальному
    // расположению №/Вид работ/Ответственный, не жёстко "индекс 3") с
    // {year, month, week}. Строка headerRowIdx несёт год (значение
    // ТОЛЬКО в первой колонке каждого года - объединённая ячейка,
    // остальные в XML физически пустые - "вперёд-заполняем"), строка
    // headerRowIdx+1 - месяц (тот же принцип объединения), строка
    // headerRowIdx+2 - номер недели ВНУТРИ месяца (1-4, заполнена в
    // КАЖДОЙ колонке отдельно, объединения нет). Именно такая структура
    // (год/месяц/неделя, 3 строки подряд) подтверждена на реальном
    // файле Mr.D - для другого шаблона может не подойти без ручной
    // подстройки this.dataStartRowOverride (сдвигает headerRowIdx).
    _buildDateColumnMap(t, headerRowIdx, dateStartCol) {
        const map = [];
        if (headerRowIdx === null) return map;
        const yearRowIdx = headerRowIdx;
        const monthRowIdx = headerRowIdx + 1;
        const weekRowIdx = headerRowIdx + 2;

        let lastYear = null;
        let lastMonth = null;

        for (let c = dateStartCol; c < t.columns.length; c++) {
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

    // Раунд 131 (по прямому указанию Mr.D после разбора реального файла
    // с его же примечаниями-аннотациями - "нужно улучшить распознавание
    // задач и дат... цвета могут быть случайными... основной ориентир
    // цифры в клетках") - три находки, подтверждённые на конкретных
    // строках файла:
    //
    // 1) ЧИСЛО В ЯЧЕЙКЕ - главный ориентир, читается НЕЗАВИСИМО от того,
    //    назначена ли роль цвету этой ячейки - раньше `if (!role ||
    //    role === 'ignore') continue;` молча выбрасывал число, если
    //    цвет ячейки не был явно размечен пользователем (например, "5"
    //    в серой FFB7B7B7 - той же серой, что 2051 раз встречается БЕЗ
    //    числа как обычная заливка выходных - но САМО число в ней
    //    достоверно, серый цвет здесь просто "какой был под рукой").
    //    Единственное исключение - явный 'ignore' (осознанный выбор
    //    пользователя "эту ячейку не читать вообще").
    //
    // 2) Числовые точки И протяжённая заливка (роль 'duration', без
    //    чисел) МОГУТ сосуществовать в ОДНОЙ строке и должны
    //    ОБЪЕДИНЯТЬСЯ в единый диапазон - раньше это были ВЗАИМО-
    //    ИСКЛЮЧАЮЩИЕ альтернативы (`if (points.length>0) return
    //    points...; else if (duration...) return duration...`) - реальный
    //    пример: "Аванс 1 стадии работ" - декабрь закрашен ПРОТЯЖЁННО
    //    (без чисел, роль duration), январь несёт число "5" (роль не
    //    назначена/не важна) - раньше duration-часть терялась бы
    //    полностью, если бы "5" удалось прочитать по правилу (1), или
    //    наоборот - "5" терялся бы, а diapазон брался ТОЛЬКО по декабрю.
    //    Теперь - единый диапазон от начала декабря до 5 января.
    // Раунд 135 - смотрит на СТРОКУ-КАНДИДАТА В РАЗДЕЛЫ (rowIdx) и до
    // GROUP_LOOKAHEAD следующих строк - есть ли ХОТЬ ГДЕ-ТО номер в №
    // п/п ИЛИ ЧИСЛО в области дат. Настоящий раздел ("График
    // финансирования" и т.п.) ВСЕГДА за собой ведёт пронумерованные/
    // раскрашенные задачи - легенда/сноска в конце файла ("Примечания:")
    // не ведёт НИЧЕГО подобного.
    //
    // Багфикс (по жалобе Mr.D: "вновь остался хвост таблицы", реальная
    // причина найдена на самом файле) - раньше проверялось наличие
    // ЛЮБОГО ЦВЕТА в области дат - но серая заливка "выходного дня"
    // (FFB7B7B7) в РЕАЛЬНОМ файле тянется на СОТНИ строк ЗА ПРЕДЕЛАМИ
    // настоящих данных (пустая формат-заливка колонок, унаследованная
    // от соседних ячеек, без единого числа внутри) - именно она
    // обманывала эту проверку, заставляя "Примечания:" выглядеть так,
    // будто впереди ещё есть настоящие данные. Раунд 131 уже установил
    // принцип "число - главный ориентир, не цвет" для самих дат -
    // применяем его и здесь: смотрим на ЗНАЧЕНИЕ ячейки (число 1-31),
    // не на цвет.
    _hasRealDataAhead(rowIdx, colA, t, dateStartCol) {
        const GROUP_LOOKAHEAD = 5;
        for (let j = rowIdx; j < Math.min(rowIdx + 1 + GROUP_LOOKAHEAD, colA.length); j++) {
            const aj = colA[j];
            if (aj !== null && aj !== undefined && String(aj).trim() !== '') return true;
            for (let c = dateStartCol; c < t.columns.length; c++) {
                const v = t.columns[c].values[j];
                const n = (v !== null && v !== undefined && v !== '' && !isNaN(parseFloat(v))) ? Math.round(parseFloat(v)) : null;
                if (n !== null && n >= 1 && n <= 31) return true;
            }
        }
        return false;
    }

    // Раунд 135 (по разбору реального файла - "2.1.1" использует точку
    // как разделитель уровня, но "2.2,18" использует ЗАПЯТУЮ - тот же
    // файл смешивает оба варианта для соседних Этапов) - единая функция
    // подсчёта глубины, используется И здесь, И в основном цикле
    // calculate() - чтобы обе стороны (наследование дат и вставка в
    // дерево) всегда считали ОДНУ И ТУ ЖЕ глубину для одного и того же
    // номера, не расходясь.
    _numberDepth(rawNumber) {
        return (String(rawNumber).match(/[.,]/g) || []).length;
    }

    // Раунд 131 (правило 3, по указанию Mr.D: "Ситуационный план - это
    // задача подгруппы, формируем задачи на основе данных группы") -
    // ЕСЛИ у строки нет собственных разобранных дат (decoded===null) -
    // наследует их от БЛИЖАЙШЕГО предка по номеру (depth-1, а если и
    // там нет - поднимается выше). depth - число точек/запятых в номере
    // (см. _numberDepth()). lastDecodedByDepth - МУТИРУЕТСЯ (тот же
    // объект, что живёт в calculate() между итерациями цикла) - если
    // ЭТА строка разобралась сама, записывает себя как "последний
    // известный предок" на СВОЕЙ глубине, и стирает более глубокие
    // уровни (у новой ветки на этой глубине ещё не было потомков).
    _resolveInheritedDates(colAValue, hasA, decoded, lastDecodedByDepth) {
        const depth = hasA ? this._numberDepth(colAValue) : 0;
        if (decoded) {
            lastDecodedByDepth[depth] = decoded;
            Object.keys(lastDecodedByDepth).forEach(d => { if (Number(d) > depth) delete lastDecodedByDepth[d]; });
            return decoded;
        }
        for (let d = depth - 1; d >= 0; d--) {
            if (lastDecodedByDepth[d]) return lastDecodedByDepth[d];
        }
        return null;
    }

    _decodeTaskDates(rowIdx, t, dateColumnMap, cellColors) {
        const points = [];
        const durationCols = [];

        for (let c = 3; c < t.columns.length; c++) {
            const mapping = dateColumnMap[c];
            if (!mapping) continue;
            const color = cellColors[rowIdx]?.[c] || null;
            const role = color ? this.colorRoles[color.toUpperCase()] : null;
            if (role === 'ignore') continue; // единственное исключение - явный выбор пользователя

            // Число в ЭТОЙ ЖЕ ячейке - читаем ВСЕГДА (правило 1 выше),
            // роль цвета для чисел значения не имеет.
            const cellValue = t.columns[c].values[rowIdx];
            const dayNum = (cellValue !== null && cellValue !== undefined && cellValue !== '' && !isNaN(parseFloat(cellValue)))
                ? Math.round(parseFloat(cellValue))
                : null;
            if (dayNum && dayNum >= 1 && dayNum <= 31) {
                const date = this._safeDate(mapping.year, mapping.month, dayNum);
                if (date) points.push(date);
                continue; // число прочитано - для ЭТОЙ ячейки достаточно
            }

            // Ячейка БЕЗ числа - протяжённая заливка, но ТОЛЬКО если её
            // цвету явно назначена роль 'duration' - тут роль цвета
            // по-прежнему важна (нет числа - нечем подтвердить точку).
            if (role === 'duration') {
                durationCols.push({ colIdx: c, mapping });
            }
        }

        if (points.length > 0 && durationCols.length > 0) {
            // Правило 2 выше - объединяем оба сигнала в один диапазон.
            durationCols.sort((a, b) => a.colIdx - b.colIdx);
            const durStart = this._weekApproxStart(durationCols[0].mapping.year, durationCols[0].mapping.month, durationCols[0].mapping.week);
            const durEnd = this._weekApproxEnd(durationCols[durationCols.length - 1].mapping.year, durationCols[durationCols.length - 1].mapping.month, durationCols[durationCols.length - 1].mapping.week);
            const allDates = [...points, durStart, durEnd].filter(Boolean);
            allDates.sort((a, b) => a - b);
            return { start: allDates[0], end: allDates[allDates.length - 1] };
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
            this.treeData = { roots: [] };
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

        // Раунд 134 - колонки №/Вид работ/Ответственный ищутся ПО ИМЕНИ
        // заголовка (см. _findHeaderRowAndColumns()), не по жёсткому
        // индексу 0/1/2 - защита от сдвига столбцов при другом наборе
        // выбранных при импорте колонок.
        const headerInfo = this._findHeaderRowAndColumns(t);
        const colA = headerInfo ? (t.columns[headerInfo.numColIdx]?.values || []) : [];
        const colB = headerInfo ? (t.columns[headerInfo.workColIdx]?.values || []) : [];
        const colC = headerInfo ? (t.columns[headerInfo.respColIdx]?.values || []) : [];
        // Даты начинаются сразу ПОСЛЕ самой правой из трёх основных
        // колонок - вычисляется, а не жёстко "индекс 3", по тем же
        // причинам (сдвиг колонок).
        const dateStartCol = headerInfo ? (Math.max(headerInfo.numColIdx, headerInfo.workColIdx, headerInfo.respColIdx) + 1) : 3;

        let startIdx;
        if (this.dataStartRowOverride) {
            startIdx = Math.max(0, this.dataStartRowOverride - 1);
            this._detectedStartIndex = null;
            this.clearBadge('gtp-no-header-row');
        } else {
            const detected = this._detectDataStartIndex(headerInfo, colB);
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
        // Раунд 134 - курсив каждой ячейки (см. XlsxImportNode,
        // this.cellItalics) - нужен для критерия 3 (см. цикл ниже).
        const cellItalics = (src && Array.isArray(src.cellItalics)) ? src.cellItalics : null;

        // Раунд 97 - автообнаружение ВСЕХ цветов, встреченных в области
        // дат (не назначаем роль автоматически - только заводим запись
        // '' в colorRoles, если её ещё нет, чтобы цвет появился в панели
        // для явного выбора пользователем).
        if (cellColors) {
            const found = new Set();
            for (let r = 0; r < cellColors.length; r++) {
                const row = cellColors[r] || [];
                for (let c = dateStartCol; c < row.length; c++) {
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
        // headerRowIdx переиспользуется для обоих целей. Раунд 134 -
        // headerInfo уже вычислен выше (поиск по имени), dateStartCol -
        // тоже.
        const headerRowIdx = headerInfo ? headerInfo.headerRowIdx : null;
        const dateColumnMap = this._buildDateColumnMap(t, headerRowIdx, dateStartCol);

        // Раунд 132 (по решению Mr.D: "трактовать графики внутри
        // программы не как двумерные таблицы, а как классические
        // словари. И только выводить их через экспорт как таблицы") -
        // главная структура ТЕПЕРЬ - вложенное дерево (обычные
        // JS-объекты с полем children, "классический словарь", не
        // формальный класс) - см. докстринг класса про форму узла.
        // Плоская таблица (this.tableData) строится ИЗ дерева отдельным
        // методом (_flattenTreeToTable()), ТОЛЬКО для узлов, которым
        // всё ещё нужна именно таблица (обратная совместимость -
        // TableViewer и т.п.) - дерево при этом остаётся канонiчным
        // источником истины, таблица никогда не читается обратно.
        const roots = [];
        // "Путь" от текущего корня-блока до последней вставленной
        // строки - stack[d] = узел на глубине d - определяет, куда
        // (в чьи children) попадёт СЛЕДУЮЩАЯ строка, и служит "цепочкой
        // предков" для наследования дат (см. _resolveInheritedDates()).
        let currentBlockNode = null;
        const stack = [];
        let decodedCount = 0;
        let taskCount = 0;
        // Раунд 131 (правило 3) - см. докстринг _resolveInheritedDates().
        const lastDecodedByDepth = {};
        // Раунд 134 (критерий 2, по решению Mr.D: "как вспомогательный,
        // в конце по нему можно проверять ошибки") - НЕ участвует в
        // определении глубины (критерий 1 - точки в № п/п - для этого
        // достаточен и надёжен сам по себе, см. критерий 3 ниже для
        // единственного законного исключения) - только копит подозрения
        // "локальный номер пошёл не по порядку" для итогового
        // предупреждения.
        const lastLocalNumberByDepth = {};
        const sequenceWarnings = [];
        // Раунд 134 (п.1.4, определение конца таблицы) - "хвостовые"
        // пустые/неполные строки подряд - если после ТЕКУЩЕЙ пустой
        // строки следующие TAIL_LOOKAHEAD тоже пусты (по №/Вид работ) -
        // считаем это КОНЦОМ таблицы и останавливаем разбор целиком (не
        // просто пропускаем одну строку - см. разницу со "просто
        // пустая строка внутри данных" ниже).
        const TAIL_LOOKAHEAD = 3;
        let tableEndRow = null;
        let tableEndAmbiguous = false;

        // Раунд 134 (критерий 3) - "точка отсчёта" для курсивных строк
        // БЕЗ номера - глубина ПОСЛЕДНЕЙ номерованной строки (не просто
        // stack.length - тот растёт с КАЖДОЙ вставкой, из-за чего
        // несколько подряд идущих курсивных строк "а)", "б)", "в)"
        // ошибочно вкладывались бы друг в друга, а не оставались
        // СОСЕДЯМИ на одной глубине под одним и тем же номерованным
        // родителем - см. багфикс, найденный исполняемым тестом на
        // реальном паттерне файла).
        let lastNumberedDepth = 0;

        for (let i = startIdx; i < t.rowCount; i++) {
            const a = colA[i];
            const b = colB[i];
            const c = colC[i];
            const bStr = (b !== null && b !== undefined) ? String(b).trim() : '';
            const hasA = a !== null && a !== undefined && String(a).trim() !== '';
            const hasC = c !== null && c !== undefined && String(c).trim() !== '';

            // Раунд 134 (п.1.4) - НЕОДНОЗНАЧНЫЙ признак конца ПРОВЕРЯЕТСЯ
            // ПЕРВЫМ (до "полностью пусто" ниже) - заполнена ТОЛЬКО
            // одна из основных колонок не в "штатной" комбинации
            // (например, есть Ответственный, но нет ни №, ни Вид работ -
            // такое не бывает у настоящей строки-задачи или строки-
            // раздела) - похоже на конец таблицы (нестандартный
            // "хвост"), но не так однозначно, как полностью пустая
            // строка - помечаем предупреждением на ноде (п.1.5 - "как
            // предупреждение на ноде", не диалог) И консервативно
            // останавливаемся - лучше недобрать хвостовые строки, чем
            // намешать в иерархию мусор. Багфикс, найденный тестом -
            // случай "!hasA && !bStr && hasC" (только Ответственный
            // заполнен) раньше НЕ ДОХОДИЛ до этой проверки вообще - его
            // перехватывала более ранняя "полностью пусто" проверка
            // ниже (та тоже совпадает с !hasA && !bStr, независимо от
            // hasC) - порядок проверок был неверным.
            if (!bStr && (hasA || hasC)) {
                tableEndRow = i;
                tableEndAmbiguous = true;
                break;
            }

            // Раунд 134 (п.1.4) - "конец таблицы": оба ОСНОВНЫХ столбца
            // (№ п/п, Вид работ) пусты у этой строки - проверяем, не
            // единичный ли это разрыв (внутри данных, скажем, пустая
            // строка-разделитель), заглянув на TAIL_LOOKAHEAD строк
            // вперёд - если ХОТЬ ОДНА из них несёт данные в № или Вид
            // работ - это НЕ конец, просто пропускаем текущую пустую
            // строку как раньше (continue ниже). Если ни одна из них
            // тоже пуста - это ХВОСТ (подписи/легенда/пустой остаток
            // листа) - останавливаем разбор здесь целиком.
            if (!hasA && !bStr) {
                let lookaheadHasData = false;
                for (let j = i + 1; j < Math.min(i + 1 + TAIL_LOOKAHEAD, t.rowCount); j++) {
                    const aj = colA[j], bj = colB[j];
                    if ((aj !== null && aj !== undefined && String(aj).trim() !== '') ||
                        (bj !== null && bj !== undefined && String(bj).trim() !== '')) {
                        lookaheadHasData = true;
                        break;
                    }
                }
                if (!lookaheadHasData) {
                    tableEndRow = i;
                    break;
                }
                continue; // единичный разрыв - просто пропускаем строку, разбор продолжается
            }

            // Раунд 134 (багфикс, найден исполняемым тестом на реальном
            // паттерне файла - "а)"/"б)" без номера, курсивом) - курсив
            // нужен ДО проверки на "строка-раздел": то же условие
            // (!hasA && !hasC && bStr), что определяет раздел, ИНАЧЕ
            // ошибочно совпадает с курсивным подпунктом без номера (та
            // же комбинация пустых колонок) - без исключения курсивные
            // "а)"/"б)" открывали бы НОВЫЙ раздел вместо того, чтобы
            // стать детьми предыдущей строки.
            const isItalicWork = cellItalics ? !!cellItalics[i]?.[headerInfo.workColIdx] : false;

            if (!hasA && !hasC && bStr && !isItalicWork) {
                // Раунд 135 (по жалобе Mr.D: "остались хвосты начиная со
                // строки 'Примечание:'") - строка "Примечания:" (и
                // подобные легенды/сноски в конце реального файла)
                // ИДЕАЛЬНО совпадает с условием "это заголовок нового
                // раздела" (номер и Ответственный пусты, текст есть) -
                // но раздел БЕЗ единой пронумерованной/раскрашенной
                // задачи внутри - на самом деле уже не раздел, а хвост.
                // Настоящий раздел ВСЕГДА либо сам пронумерован, либо
                // содержит пронумерованные/раскрашенные задачи в
                // ближайших следующих строках - проверяем это ПЕРЕД тем,
                // как считать строку разделом.
                if (!this._hasRealDataAhead(i, colA, t, dateStartCol)) {
                    tableEndRow = i;
                    tableEndAmbiguous = true;
                    break;
                }
                // Строка-заголовок раздела - новый КОРНЕВОЙ узел дерева
                // (тип 'block') - собственных дат не несёт (наследование
                // дат от блока к его прямым детям не применяется - блок
                // это чисто структурный ярлык, не "предок с датами").
                currentBlockNode = { name: bStr, type: 'block', responsible: '', sectionNumber: null, start: null, rawWorkDays: null, children: [] };
                roots.push(currentBlockNode);
                stack.length = 0;
                continue;
            }

            if (!currentBlockNode) {
                // Строка задачи встретилась РАНЬШЕ первого блока-
                // заголовка - синтетический "безымянный" корень, чтобы
                // не терять задачи молча (тот же принцип, что
                // "🗂 Без блока" в GanttNode._buildHierarchyTree(),
                // Раунд 130).
                currentBlockNode = { name: '(без раздела)', type: 'block', responsible: '', sectionNumber: null, start: null, rawWorkDays: null, children: [] };
                roots.push(currentBlockNode);
            }

            taskCount++;

            // Раунд 134 (критерий 3, по решению Mr.D: "пустое значение
            // всегда глубина 0, кроме исключения когда шрифт курсивом") -
            // основное правило - критерий 1 (точки в № п/п). Пустое №
            // п/п - глубина 0, ЕСЛИ ТОЛЬКО "Вид работ" этой строки не
            // выделен курсивом - курсив делает её ребёнком САМОЙ
            // ПОСЛЕДНЕЙ вставленной строки (lastNumberedDepth+1) - см.
            // реальный пример файла Mr.D: "2.2,24 Инженерная концепция:"
            // (обычная строка с номером, ЗАПЯТАЯ как разделитель - см.
            // _numberDepth()) -> "а) Расчёт нагрузок..." (№ пусто,
            // курсив, глубже).
            //
            // Раунд 135 (по разбору реального файла) - _numberDepth()
            // считает И точки, И запятые как разделители уровня - тот
            // же файл использует ТОЧКУ для "Этап 1" ("2.1.1") и ЗАПЯТУЮ
            // для "Этап 2" ("2.2,18") - оба должны давать ОДИНАКОВУЮ
            // семантику глубины (запятая здесь - не иной смысл, а
            // просто опечатка/непоследовательность заполнения самого
            // файла), иначе задачи "Этапа 2" ошибочно оказывались бы на
            // ОДНОМ уровне со своим же "Этап 2", а не его детьми.
            const depth = hasA
                ? this._numberDepth(a)
                : (isItalicWork ? lastNumberedDepth + 1 : 0);
            if (hasA) lastNumberedDepth = depth;

            // Раунд 136 (по уточнению Mr.D после проверки Раунда 135:
            // "не нужно переназначать разделы, мы просто берём их как
            // есть из исходной таблицы из колонки № п/п... разделы есть
            // и у задач, и у подзадач, а корневые разделы чаще всего
            // остаются без номера") - "Раздел" ПРОСТО = сырое значение
            // № п/п ЭТОЙ строки, БЕЗ вычислений/наследования от предков
            // (Раунд 135 пытался вычислять "номер верхнеуровневого
            // предка" - оказалось лишним усложнением, не тем, что
            // просили). Пустое № п/п -> null (пустая ячейка на экране) -
            // корневые строки-разделы (блоки) действительно почти
            // всегда без номера, это ожидаемо, не ошибка.
            const sectionNumber = hasA ? String(a).trim() : null;

            // Раунд 134 (критерий 2, вспомогательная проверка - НЕ
            // влияет на depth выше, только копит предупреждения).
            if (hasA) {
                const parts = String(a).split(/[.,]/);
                const localNum = parseFloat(parts[parts.length - 1].replace(',', '.'));
                if (!Number.isNaN(localNum)) {
                    const prevLocal = lastLocalNumberByDepth[depth];
                    if (prevLocal !== undefined && localNum <= prevLocal) {
                        sequenceWarnings.push(`строка ${i + 1} (№${a}): номер не больше предыдущего на этом уровне (${prevLocal})`);
                    }
                    lastLocalNumberByDepth[depth] = localNum;
                    Object.keys(lastLocalNumberByDepth).forEach(d => { if (Number(d) > depth) delete lastLocalNumberByDepth[d]; });
                }
            }

            const decoded = cellColors ? this._decodeTaskDates(i, t, dateColumnMap, cellColors) : null;
            const effectiveDecoded = this._resolveInheritedDates(a, hasA, decoded, lastDecodedByDepth);
            if (effectiveDecoded) decodedCount++;

            const node = {
                name: bStr,
                // Узел без children (пока) считается 'task' - если у
                // него ПОЗЖЕ появится дочерняя строка (depth+1), при
                // вставке ребёнка тип родителя пересматривается на
                // 'stage' (см. ниже) - листовой/структурный статус
                // определяется ФАКТОМ наличия детей, а не заранее
                // угаданной глубиной (реальные файлы Mr.D показали, что
                // "плоский" номер типа "1" может быть и простой задачей,
                // и Стадией с вложенными "1.1" - см. разбор Раунда 131).
                type: 'task',
                responsible: hasC ? String(c).trim() : '',
                // Раунд 135 - номер раздела (см. докстринг выше) -
                // отдельно от name/type - это НЕ структурное поле дерева
                // (не влияет на вложенность), просто данные,
                // сопровождающие узел до самого экрана.
                sectionNumber,
                start: effectiveDecoded ? effectiveDecoded.start : null,
                rawWorkDays: effectiveDecoded ? Math.max(0, Math.round((effectiveDecoded.end - effectiveDecoded.start) / 86400000)) : null,
                children: []
            };

            stack.length = depth; // обрезаем "хвост" глубже текущей строки
            const parent = depth === 0 ? currentBlockNode : stack[depth - 1]?.node;
            if (parent) {
                if (parent.children.length === 0 && parent.type === 'task') parent.type = 'stage';
                parent.children.push(node);
            } else {
                // Защита от "осиротевшей" глубины (например, файл
                // начинается сразу с "1.1" без предшествующего "1") -
                // не теряем строку, кладём в корень блока как есть.
                currentBlockNode.children.push(node);
            }
            stack[depth] = { depth, node };
        }

        this.treeData = { roots };

        // Раунд 134 (п.1.4/1.5, по решению Mr.D: "неоднозначность не
        // как диалог, а как предупреждение на ноде") - конец таблицы:
        // однозначный (несколько пустых строк подряд) - просто тихо
        // останавливаем разбор, без шума на ноде (это ОЖИДАЕМЫЙ,
        // штатный случай - у любой таблицы есть конец). Неоднозначный
        // (странная неполная строка, не похожая ни на задачу, ни на
        // раздел) - предупреждение, чтобы Mr.D мог проверить вручную,
        // не потеряны ли настоящие данные строкой ниже.
        if (tableEndRow !== null && tableEndAmbiguous) {
            this.addBadge('gtp-ambiguous-end', {
                type: 'warning',
                text: `Конец таблицы определён неоднозначно на строке ${tableEndRow + 1} (неполное заполнение колонок) - проверьте, не обрезаны ли настоящие данные`
            });
        } else {
            this.clearBadge('gtp-ambiguous-end');
        }

        // Раунд 134 (критерий 2, вспомогательная проверка) - показываем
        // ПЕРВЫЕ несколько подозрений, не все скопом (список мог бы
        // быть длинным на файле с реально нестандартной нумерацией).
        if (sequenceWarnings.length > 0) {
            const preview = sequenceWarnings.slice(0, 3).join('; ');
            const more = sequenceWarnings.length > 3 ? ` (и ещё ${sequenceWarnings.length - 3})` : '';
            this.addBadge('gtp-sequence-warning', {
                type: 'warning',
                text: `Возможные ошибки нумерации: ${preview}${more}`
            });
        } else {
            this.clearBadge('gtp-sequence-warning');
        }

        if (!headerInfo) {
            this.addBadge('gtp-columns-not-found', {
                type: 'error',
                text: 'Заголовки колонок "№ п/п"/"Вид работ"/"Ответственный" не найдены по именам - проверьте исходную таблицу'
            });
        } else {
            this.clearBadge('gtp-columns-not-found');
        }

        if (cellColors && decodedCount > 0) {
            this.addBadge('gtp-dates-decoded', { type: 'info', text: `Даты распознаны по цвету: ${decodedCount} из ${taskCount} задач` });
        } else {
            this.clearBadge('gtp-dates-decoded');
        }

        // Раунд 132 - плоская таблица ТЕПЕРЬ производная (см. докстринг
        // выше) - строится единым методом _flattenTreeToTable(), общим
        // и для this.tableData (превью/обратная совместимость), и для
        // getOutputBySocket() (Раунд 84, честные разные данные по
        // разным сокетам).
        this.tableData = this._flattenTreeToTable(this.treeData);

        const flatNames = this._flattenTreeNames(this.treeData);
        this.listData = new ListData(
            flatNames.map(name => ({ name, value: 1 })),
            { title: 'Задачи' }
        );

        this.value = taskCount;
        return this.value;
    }

    // Раунд 132 - строит ПЛОСКУЮ TableData ИЗ дерева (обход в глубину,
    // родительский Блок становится "Группой" - та же семантика, что
    // была у плоской модели, для обратной совместимости с любым узлом,
    // который читает именно таблицу). Даты БЕЗ decoded (start === null)
    // получают "сегодня" по умолчанию - тот же принцип, что был раньше
    // (GanttNode всё равно пересчитает при подключении своей логикой
    // авто-расстановки).
    _flattenTreeToTable(treeData) {
        const groups = [];
        const tasks = [];
        const responsibles = [];
        const starts = [];
        const ends = [];
        const workdays = [];
        const factDays = [];

        const today = new Date();
        const defaultDate = `${String(today.getDate()).padStart(2, '0')}.${String(today.getMonth() + 1).padStart(2, '0')}.${today.getFullYear()}`;

        const walk = (node, groupLabel) => {
            if (node.type === 'block') {
                node.children.forEach(child => walk(child, node.name));
                return;
            }
            if (node.children.length > 0) {
                // 'stage' - сама строка Стадии тоже попадает в таблицу
                // (как обычная строка с её собственными/унаследованными
                // датами), ЗАТЕМ её дети - тот же порядок, что видит
                // пользователь в исходном файле сверху вниз.
                pushRow(node, groupLabel);
                node.children.forEach(child => walk(child, groupLabel));
                return;
            }
            pushRow(node, groupLabel);
        };

        const pushRow = (node, groupLabel) => {
            groups.push(groupLabel || '');
            tasks.push(node.name);
            responsibles.push(node.responsible || '');
            if (node.start && node.rawWorkDays !== null) {
                const start = node.start;
                const end = new Date(start.getTime() + node.rawWorkDays * 86400000);
                starts.push(formatDdMmYyyy(start));
                ends.push(formatDdMmYyyy(end));
                workdays.push(node.rawWorkDays);
                factDays.push(node.rawWorkDays);
            } else {
                starts.push(defaultDate);
                ends.push(defaultDate);
                workdays.push(0);
                factDays.push(0);
            }
        };

        (treeData?.roots || []).forEach(root => walk(root, null));

        // Раунд 85 - структура один-в-один с GanttNode.buildOutputTable()
        // (Группа/Задача/Начало/Раб.дни/Окончание/Факт.дни/Ответственный) -
        // без изменений, ОБРАТНАЯ СОВМЕСТИМОСТЬ - любой уже существующий
        // потребитель этой таблицы (включая саму Диаграмму Ганта в
        // режиме "просто таблица", если дерево почему-то не передалось)
        // продолжает работать как раньше.
        return new TableData([
            { header: 'Группа', values: groups, format: 'text' },
            { header: 'Задача', values: tasks, format: 'text' },
            { header: 'Начало', values: starts, format: 'text' },
            { header: 'Раб.дни', values: workdays, format: 'number' },
            { header: 'Окончание', values: ends, format: 'text' },
            { header: 'Факт.дни', values: factDays, format: 'number' },
            { header: 'Ответственный', values: responsibles, format: 'text' }
        ], { title: this.customName || this.getDisplayName() });
    }

    // Раунд 132 - плоский список ИМЁН задач (для this.listData) - тот
    // же обход, что _flattenTreeToTable(), но только имена, без дат.
    _flattenTreeNames(treeData) {
        const names = [];
        const walk = (node) => {
            if (node.type !== 'block') names.push(node.name);
            node.children.forEach(walk);
        };
        (treeData?.roots || []).forEach(walk);
        return names;
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
        // Раунд 132 (по решению Mr.D: "выходной сокет между ними тоже
        // перестаёт быть таблицей") - treeData ТЕПЕРЬ основная полезная
        // нагрузка этого сокета - GanttNode читает именно её в
        // приоритете (см. её calculate()). tableData ОСТАЁТСЯ в ответе
        // (произведена из того же дерева, см. _flattenTreeToTable()) -
        // ради обратной совместимости с любым узлом, который умеет
        // читать только таблицу (TableViewer и т.п.) - сокет физически
        // остался тем же (isData) намеренно, чтобы не рвать уже
        // существующие соединения в сохранённых проектах.
        return { value: this.value, tableData: this.tableData, treeData: this.treeData, listData: this.listData, resultListData: this.resultListData };
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
