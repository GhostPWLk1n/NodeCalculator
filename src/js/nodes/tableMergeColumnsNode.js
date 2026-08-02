/**
 * SPDX-License-Identifier: MIT
 * SPDX-FileCopyrightText: 2024 NodeCalculate Team
 * SPDX-FileCopyrightText: 2024 Pavel Fomin
 *
 * @file    tableMergeColumnsNode.js
 * @brief   Обработчик: объединяет несколько столбцов таблицы в один (сумма/конкатенация)
 * @author  Pavel Fomin
 * @version 1.7.50
 * @see     https://github.com/GhostPWLk1n/NodeCalculator.git
 */

import { BaseNode } from './baseNode.js';
import { TableData } from '../utils/dataTypes.js';
import { SocketFactory } from '../utils/socketFactory.js';
import { TableWidgetRenderer } from '../utils/tableWidgetRenderer.js';

/**
 * TableMergeColumnsNode ("Объединение столбцов") - Data → Data. Берёт
 * НЕСКОЛЬКО столбцов входной таблицы и схлопывает их в ОДИН результирующий
 * столбец, вставленный на указанную позицию среди ОСТАВШИХСЯ столбцов
 * (после удаления объединённых - см. calculate()).
 *
 * Две операции:
 *   - "Объединить" (concat) - конкатенация значений строки через
 *     разделитель (this.separator, по умолчанию "."), результат - текст;
 *   - "Сумма" (sum) - арифметическая сумма значений строки, результат -
 *     число (нечисловые значения считаются как 0).
 *
 * this.sourceColumns - индексы столбцов ВХОДНОЙ таблицы (синхронизируются
 * с ней через чекбоксы в панели, см. getInspectorSchema() и
 * this._inputHeaders - снимок заголовков входа, сделанный в НАЧАЛЕ
 * calculate(), до объединения, специально для этих чекбоксов: после
 * объединения в this.tableData уже МЕНЬШЕ столбцов, чем было на входе).
 */
export class TableMergeColumnsNode extends BaseNode {
    constructor(id, type, x, y, config = {}) {
        super(id, type, x, y, config);
        this.inputs = 1;
        this.inputSockets = [0];
        this.outputs = 1;
        this.width = config.width || 210;

        this.sourceColumns = Array.isArray(config.sourceColumns) ? config.sourceColumns : [];
        this.operation = config.operation || 'concat'; // 'concat'|'sum'
        this.separator = config.separator ?? '.';
        // 0-based позиция результата СРЕДИ ОСТАВШИХСЯ (не объединённых) столбцов
        this.targetPosition = config.targetPosition ?? 0;
        this.resultHeader = config.resultHeader || null;

        this._sourceName = null;
        this._inputHeaders = [];
        this.tableData = new TableData();

        // Виджет Доски (см. utils/tableWidgetRenderer.js) - только номера
        // строк/сортировка, оформление - через TableFormatNode (Раунд 44)
        this.boardShowRowNumbers = config.boardShowRowNumbers ?? true;
        // Раунд 93 (чек-лист, п.4.1) - ручная ширина столбцов на Доске
        this.boardColumnWidths = config.boardColumnWidths ? { ...config.boardColumnWidths } : {};
        this.boardSortColumn = config.boardSortColumn ?? null;
        this.boardSortDirection = config.boardSortDirection ?? null;
    }

    createContent() {
        const content = document.createElement('div');
        content.className = 'node-content';
        content.style.cssText = 'width: 100%; min-width: 180px;';

        const inRow = document.createElement('div');
        inRow.style.cssText = 'display:flex; align-items:center; gap:6px;';
        const inSocket = SocketFactory.createSocket({
            nodeId: this.id, socketType: 'input', index: 0, isData: true,
            title: 'Таблица, чьи столбцы объединяем'
        });
        inRow.appendChild(inSocket);
        const sourceLabel = document.createElement('span');
        sourceLabel.className = 'table-merge-source-label';
        sourceLabel.style.cssText = 'color:var(--md-text-secondary); font-size:11px; flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;';
        sourceLabel.textContent = this._sourceName || 'не подключено';
        inRow.appendChild(sourceLabel);
        content.appendChild(inRow);

        const opRow = document.createElement('div');
        opRow.style.cssText = 'padding-left:20px;';
        const opLabel = document.createElement('span');
        opLabel.className = 'table-merge-op-label';
        opLabel.style.cssText = 'color:var(--md-text-disabled); font-size:10px;';
        opLabel.textContent = this._operationText();
        opRow.appendChild(opLabel);
        content.appendChild(opRow);

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
            title: 'Таблица с объединённым столбцом'
        });
        outRow.appendChild(outSocket);
        content.appendChild(outRow);

        return content;
    }

    _operationText() {
        const cols = this.sourceColumns.map(i => i + 1).join(', ') || '—';
        const opLabel = this.operation === 'sum' ? 'сумма' : `объединение через "${this.separator}"`;
        return `→ ${opLabel} столбцов [${cols}] → позиция ${this.targetPosition + 1}`;
    }

    calculate(nodeManager) {
        const connections = window.connectionManager?.getConnections() || [];
        const conn = connections.find(c => c.targetNodeId === this.id && c.targetSocket === 0);
        const srcNode = conn ? nodeManager.getNode(conn.sourceNodeId) : null;

        this._sourceName = srcNode ? (srcNode.customName || srcNode.getDisplayName?.() || 'источник') : null;

        const baseTable = (srcNode && srcNode.tableData && srcNode.tableData.columns.length > 0)
            ? srcNode.tableData
            : new TableData();

        // Снимок заголовков ВХОДА - до объединения, для чекбоксов в панели
        // (см. докстринг класса)
        this._inputHeaders = baseTable.columns.map(c => c.header);

        if (baseTable.columns.length === 0) {
            this.tableData = baseTable;
            this.value = 0;
            return this.value;
        }

        const valid = this.sourceColumns.filter(i => i >= 0 && i < baseTable.columns.length);
        if (valid.length === 0) {
            // Нечего объединять (ничего не выбрано в панели) - пропускаем
            // таблицу насквозь без изменений
            this.tableData = baseTable;
            this.value = this.tableData.rowCount;
            return this.value;
        }

        const remaining = baseTable.columns.filter((_, i) => !valid.includes(i));
        const rowCount = baseTable.rowCount;

        const mergedValues = [];
        for (let r = 0; r < rowCount; r++) {
            const rowVals = valid.map(i => baseTable.columns[i].values[r]);
            if (this.operation === 'sum') {
                mergedValues.push(rowVals.reduce((a, b) => a + (typeof b === 'number' ? b : 0), 0));
            } else {
                mergedValues.push(rowVals.map(v => (v ?? '')).join(this.separator));
            }
        }

        const autoHeader = valid.map(i => baseTable.columns[i].header)
            .join(this.operation === 'sum' ? ' + ' : this.separator);
        const mergedCol = {
            header: this.resultHeader || autoHeader,
            values: mergedValues,
            format: this.operation === 'sum' ? 'number' : 'text'
        };

        const insertAt = Math.max(0, Math.min(remaining.length, this.targetPosition));
        const finalColumns = [...remaining.slice(0, insertAt), mergedCol, ...remaining.slice(insertAt)];

        this.tableData = new TableData(finalColumns, { ...baseTable.metadata });
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
        const sourceLabel = element.querySelector('.table-merge-source-label');
        if (sourceLabel) sourceLabel.textContent = this._sourceName || 'не подключено';

        const opLabel = element.querySelector('.table-merge-op-label');
        if (opLabel) opLabel.textContent = this._operationText();
    }

    getInspectorSchema() {
        const fields = super.getInspectorSchema();

        fields.push({ type: 'section', label: 'Столбцы для объединения' });
        this._inputHeaders.forEach((header, i) => {
            fields.push({
                key: `mergeCol${i}`,
                label: header || `Столбец ${i + 1}`,
                type: 'checkbox',
                get: () => this.sourceColumns.includes(i),
                set: (v) => {
                    if (v) {
                        if (!this.sourceColumns.includes(i)) this.sourceColumns.push(i);
                    } else {
                        this.sourceColumns = this.sourceColumns.filter(idx => idx !== i);
                    }
                }
            });
        });

        fields.push({ type: 'section', label: 'Операция' });

        fields.push({
            key: 'operation',
            label: 'Тип объединения',
            type: 'select',
            options: [
                { value: 'concat', label: 'Объединить (текст)' },
                { value: 'sum', label: 'Сумма (числа)' }
            ],
            get: () => this.operation,
            set: (v) => { this.operation = v; }
        });

        fields.push({
            key: 'separator',
            label: 'Разделитель (для объединения текстом)',
            type: 'text',
            get: () => this.separator,
            set: (v) => { this.separator = v ?? '.'; }
        });

        fields.push({
            key: 'targetPosition',
            label: 'Позиция результата (с 1)',
            type: 'number',
            min: 1, step: 1,
            get: () => this.targetPosition + 1,
            set: (v) => { this.targetPosition = Math.max(0, (v || 1) - 1); }
        });

        fields.push({
            key: 'resultHeader',
            label: 'Название столбца (пусто = авто)',
            type: 'text',
            get: () => this.resultHeader || '',
            set: (v) => { this.resultHeader = (v && v.trim()) ? v.trim() : null; }
        });

        return fields;
    }
}
