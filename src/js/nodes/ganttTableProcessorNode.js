/**
 * SPDX-License-Identifier: MIT
 * SPDX-FileCopyrightText: 2024 NodeCalculate Team
 * SPDX-FileCopyrightText: 2024 Pavel Fomin
 *
 * @file    ganttTableProcessorNode.js
 * @brief   Разбор сырой Гант-подобной таблицы (заголовок/разделы/задачи) на три отдельных выхода
 * @author  Pavel Fomin
 * @version 1.7.24
 * @see     https://github.com/GhostPWLk1n/NodeCalculator.git
 */

import { BaseNode } from './baseNode.js';
import { TableData, ListData } from '../utils/dataTypes.js';
import { SocketFactory } from '../utils/socketFactory.js';
import { TableWidgetRenderer } from '../utils/tableWidgetRenderer.js';

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
        this.width = config.width || 230;

        // Раунд 84 (компромисс по итогам обсуждения с Mr.D) - null =
        // автоопределение по тексту "№ п/п" в колонке A + первая
        // непустая строка колонки B ПОСЛЕ неё (пропускает шапку года/
        // месяца/недели - см. _detectDataStartIndex()). Число - ручное
        // переопределение (1-based, СЧИТАЯ ОТ ПЕРВОЙ СТРОКИ ДАННЫХ
        // XlsxImportNode, т.е. БЕЗ строки, которую тот сам считает
        // заголовком) - на случай, если автопоиск ошибся на нетиповом
        // шаблоне.
        this.dataStartRowOverride = config.dataStartRowOverride ?? null;
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
        content.style.cssText = 'width:100%; min-width:210px; display:flex; flex-direction:column; gap:4px;';

        const inRow = document.createElement('div');
        inRow.style.cssText = 'display:flex; align-items:center; gap:6px;';
        const inSocket = SocketFactory.createSocket({
            nodeId: this.id, socketType: 'input', index: 0, isAny: true,
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
    // варианты написания вроде "№п/п", "№ п / п") в колонке A, затем
    // первую строку ПОСЛЕ неё, где непуста колонка B - пропускает шапку
    // года/месяца/недели (у неё заполнена только область дат, колонка B
    // пуста), приземляется ровно на первую строку-раздел или строку-
    // задачу.
    _detectDataStartIndex(colA, colB) {
        let headerRowIdx = null;
        for (let i = 0; i < colA.length; i++) {
            const v = colA[i];
            if (v !== null && v !== undefined && /№.{0,3}п.{0,2}п/i.test(String(v).replace(/\s/g, ''))) {
                headerRowIdx = i;
                break;
            }
        }
        if (headerRowIdx === null) return null;
        for (let i = headerRowIdx + 1; i < colB.length; i++) {
            const b = colB[i];
            if (b !== null && b !== undefined && String(b).trim() !== '') {
                return i;
            }
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
        const groups = [];
        const tasks = [];
        const responsibles = [];
        let currentGroup = '';

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
        }

        // Раунд 85 - структура один-в-один с GanttNode.buildOutputTable()
        // (Группа/Задача/Начало/Раб.дни/Окончание/Факт.дни/Ответственный) -
        // чтобы результат уже сейчас можно было подключить напрямую к
        // Диаграмме Ганта как совместимую таблицу (isCompatibleTable()
        // проверяет только наличие "начал"/"оконч" в заголовках, они
        // есть). Дат/длительностей у нас пока нет (разбор цвета/чисел в
        // ячейках - предмет отдельного будущего раунда) - дефолтные
        // значения, которые диаграмма Ганта всё равно ПЕРЕСЧИТАЕТ при
        // подключении (своя логика авто-расстановки задач по курсору,
        // см. её calculate()) - лишь бы формат не ломал парсинг:
        // "сегодня" для Начало/Окончание (parseDateRu() ожидает именно
        // dd.mm.yyyy), 0 для обеих длительностей.
        const today = new Date();
        const defaultDate = `${String(today.getDate()).padStart(2, '0')}.${String(today.getMonth() + 1).padStart(2, '0')}.${today.getFullYear()}`;
        const n = tasks.length;

        this.tableData = new TableData([
            { header: 'Группа', values: groups, format: 'text' },
            { header: 'Задача', values: tasks, format: 'text' },
            { header: 'Начало', values: new Array(n).fill(defaultDate), format: 'text' },
            { header: 'Раб.дни', values: new Array(n).fill(0), format: 'number' },
            { header: 'Окончание', values: new Array(n).fill(defaultDate), format: 'text' },
            { header: 'Факт.дни', values: new Array(n).fill(0), format: 'number' },
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
