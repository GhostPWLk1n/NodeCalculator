/**
 * SPDX-License-Identifier: MIT
 * SPDX-FileCopyrightText: 2024 NodeCalculate Team
 * SPDX-FileCopyrightText: 2024 Pavel Fomin
 *
 * @file    tableFilterNode.js
 * @brief   Обработчик: отсеивает строки таблицы по условиям на столбцы (список значений или сравнение)
 * @author  Pavel Fomin
 * @version 1.5.0
 * @see     https://github.com/GhostPWLk1n/NodeCalculator.git
 */

import { BaseNode } from './baseNode.js';
import { TableData } from '../utils/dataTypes.js';
import { SocketFactory } from '../utils/socketFactory.js';
import { TableWidgetRenderer } from '../utils/tableWidgetRenderer.js';

/**
 * TableFilterNode ("Отсеять") - Data → Data. Формирует новую таблицу,
 * оставляя только строки, которые проходят условие ПО КАЖДОМУ столбцу
 * (this.columnFilters[i] - строка-условие для столбца i, пустая строка =
 * без условия, этот столбец не ограничивает выборку). Строка проходит,
 * только если она подходит ПОД ВСЕ заданные условия одновременно (AND).
 *
 * Каждое условие - обычный текст, ФОРМАТ условия определяется
 * автоматически по его виду (_matchesFilter() ниже):
 *
 *   - Если строка начинается с оператора сравнения (>, <, >=, <=, =, !=,
 *     <>) - "сравнение": остаток строки - число или текст, с которым
 *     сравнивается значение ячейки (пример из ТЗ: "третий[>30]").
 *   - Иначе - "перечень": строка через запятую задаёт СПИСОК допустимых
 *     значений, строка проходит, если значение ячейки совпадает с ЛЮБЫМ
 *     из них (пример из ТЗ: "первый столбец - [0, 1, 5]",
 *     "второй[Вася, Лена]").
 *
 * Сравнение чисел - как чисел, если ячейка - число и правая часть
 * условия распознаётся как число; иначе - как текст (регистронезависимо).
 * this.columnFilters синхронизируется по длине с текущим набором
 * столбцов на каждый calculate() - лишние условия обрезаются,
 * недостающие столбцы получают условие "" (без ограничения).
 */
export class TableFilterNode extends BaseNode {
    constructor(id, type, x, y, config = {}) {
        super(id, type, x, y, config);
        this.inputs = 1;
        this.inputSockets = [0];
        this.outputs = 1;
        this.width = config.width || 200;

        // Условие для каждого столбца входной таблицы - см. докстринг класса
        this.columnFilters = Array.isArray(config.columnFilters) ? config.columnFilters : [];

        this._sourceName = null;
        this.tableData = new TableData();

        // Виджет Доски (см. utils/tableWidgetRenderer.js) - только номера
        // строк/сортировка, оформление - через TableFormatNode (Раунд 44)
        this.boardShowRowNumbers = config.boardShowRowNumbers ?? true;
        this.boardSortColumn = config.boardSortColumn ?? null;
        this.boardSortDirection = config.boardSortDirection ?? null;
    }

    createContent() {
        const content = document.createElement('div');
        content.className = 'node-content';
        content.style.cssText = 'width: 100%; min-width: 170px;';

        const inRow = document.createElement('div');
        inRow.style.cssText = 'display:flex; align-items:center; gap:6px;';
        const inSocket = SocketFactory.createSocket({
            nodeId: this.id, socketType: 'input', index: 0, isData: true,
            title: 'Таблица, которую отсеиваем'
        });
        inRow.appendChild(inSocket);
        const sourceLabel = document.createElement('span');
        sourceLabel.className = 'table-filter-source-label';
        sourceLabel.style.cssText = 'color:var(--md-text-secondary); font-size:11px; flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;';
        sourceLabel.textContent = this._sourceName || 'не подключено';
        inRow.appendChild(sourceLabel);
        content.appendChild(inRow);

        const statusRow = document.createElement('div');
        statusRow.style.cssText = 'padding-left:20px;';
        const statusLabel = document.createElement('span');
        statusLabel.className = 'table-filter-status-label';
        statusLabel.style.cssText = 'color:var(--md-text-disabled); font-size:10px;';
        statusLabel.textContent = this._statusText();
        statusRow.appendChild(statusLabel);
        content.appendChild(statusRow);

        const outRow = document.createElement('div');
        outRow.style.cssText = `
            display: flex;
            align-items: center;
            gap: 8px;
            padding-top: 6px;
            margin-top: 2px;
            border-top: 1px solid var(--md-divider);
        `;
        const outLabel = document.createElement('label');
        outLabel.textContent = 'Результат (DATA):';
        outLabel.style.cssText = 'color:var(--md-text-secondary); font-size:11px; flex:1;';
        outRow.appendChild(outLabel);
        const outSocket = SocketFactory.createSocket({
            nodeId: this.id, socketType: 'output', index: 0, isData: true,
            title: 'Отфильтрованная таблица'
        });
        outRow.appendChild(outSocket);
        content.appendChild(outRow);

        return content;
    }

    _statusText() {
        const activeCount = this.columnFilters.filter(f => (f || '').trim()).length;
        return activeCount
            ? `→ ${this.value ?? 0} строк прошло (условий: ${activeCount})`
            : '→ без условий - пропускает всё';
    }

    // Сравнение "ячейка ОПЕРАТОР правая_часть" - числами, если можно,
    // иначе текстом (регистронезависимо)
    static _compareValue(cellValue, operator, rhsStr) {
        const rhsNum = parseFloat(rhsStr);
        const useNumeric = typeof cellValue === 'number' && !Number.isNaN(rhsNum);
        const a = useNumeric ? cellValue : String(cellValue ?? '').toLowerCase();
        const b = useNumeric ? rhsNum : rhsStr.trim().toLowerCase();
        switch (operator) {
            case '>': return a > b;
            case '<': return a < b;
            case '>=': return a >= b;
            case '<=': return a <= b;
            case '=':
            case '==': return a === b;
            case '!=':
            case '<>': return a !== b;
            default: return true;
        }
    }

    // "Ячейка равна одному из значений перечня" - числом, если ячейка
    // число и элемент перечня им распознаётся, иначе текстом
    static _valueEquals(cellValue, filterItem) {
        const trimmed = filterItem.trim();
        if (typeof cellValue === 'number') {
            const asNum = parseFloat(trimmed);
            if (!Number.isNaN(asNum)) return cellValue === asNum;
        }
        return String(cellValue ?? '').trim().toLowerCase() === trimmed.toLowerCase();
    }

    // Авто-определение вида условия - сравнение (по оператору в начале
    // строки) или перечень значений через запятую - см. докстринг класса
    static _matchesFilter(cellValue, filterStr) {
        const compMatch = /^(>=|<=|!=|<>|>|<|={1,2})\s*(.+)$/.exec(filterStr.trim());
        if (compMatch) {
            return TableFilterNode._compareValue(cellValue, compMatch[1], compMatch[2]);
        }
        const list = filterStr.split(',').map(s => s.trim()).filter(s => s.length > 0);
        if (list.length === 0) return true;
        return list.some(item => TableFilterNode._valueEquals(cellValue, item));
    }

    calculate(nodeManager) {
        const connections = window.connectionManager?.getConnections() || [];
        const conn = connections.find(c => c.targetNodeId === this.id && c.targetSocket === 0);
        const srcNode = conn ? nodeManager.getNode(conn.sourceNodeId) : null;

        this._sourceName = srcNode ? (srcNode.customName || srcNode.getDisplayName?.() || 'источник') : null;

        const baseTable = (srcNode && srcNode.tableData && srcNode.tableData.columns.length > 0)
            ? srcNode.tableData
            : new TableData();

        // Синхронизация условий по длине с текущим набором столбцов -
        // тот же приём, что у columnStyles в TableFormatNode (Раунд 44)
        while (this.columnFilters.length < baseTable.columns.length) this.columnFilters.push('');
        this.columnFilters.length = baseTable.columns.length;

        if (baseTable.columns.length === 0) {
            this.tableData = baseTable;
            this.value = 0;
            return this.value;
        }

        const rowCount = baseTable.rowCount;
        const keepIndexes = [];
        for (let r = 0; r < rowCount; r++) {
            let passes = true;
            for (let c = 0; c < baseTable.columns.length; c++) {
                const filterStr = (this.columnFilters[c] || '').trim();
                if (!filterStr) continue;
                if (!TableFilterNode._matchesFilter(baseTable.columns[c].values[r], filterStr)) {
                    passes = false;
                    break;
                }
            }
            if (passes) keepIndexes.push(r);
        }

        const columns = baseTable.columns.map(col => ({
            header: col.header,
            format: col.format,
            values: keepIndexes.map(i => col.values[i] ?? null)
        }));

        this.tableData = new TableData(columns, { ...baseTable.metadata });
        this.value = this.tableData.rowCount;
        return this.value;
    }

    // Виджет Доски (см. dashboardNode.js/boardManager.js) - код общий, см.
    // utils/tableWidgetRenderer.js.
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

    updateDisplay(element) {
        const sourceLabel = element.querySelector('.table-filter-source-label');
        if (sourceLabel) sourceLabel.textContent = this._sourceName || 'не подключено';

        const statusLabel = element.querySelector('.table-filter-status-label');
        if (statusLabel) statusLabel.textContent = this._statusText();
    }

    getInspectorSchema() {
        const fields = super.getInspectorSchema();

        fields.push({ type: 'section', label: 'Условия по столбцам' });
        fields.push({
            type: 'section',
            label: 'Список через запятую ("0, 1, 5") или сравнение (">30", "!=0") - пусто = без условия'
        });

        this.columnFilters.forEach((filterStr, i) => {
            const header = this.tableData.columns[i]?.header;
            fields.push({
                key: `filterCol${i}`,
                label: header || `Столбец ${i + 1}`,
                type: 'text',
                get: () => this.columnFilters[i] || '',
                set: (v) => { this.columnFilters[i] = v || ''; }
            });
        });

        return fields;
    }
}
