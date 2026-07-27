/**
 * SPDX-License-Identifier: MIT
 * SPDX-FileCopyrightText: 2024 NodeCalculate Team
 * SPDX-FileCopyrightText: 2024 Pavel Fomin
 *
 * @file    tableRemoveNode.js
 * @brief   Обработчик: удаляет строки из таблицы (по номеру строки или диапазону)
 * @author  Pavel Fomin
 * @version 1.5.0
 * @see     https://github.com/GhostPWLk1n/NodeCalculator.git
 */

import { BaseNode } from './baseNode.js';
import { TableData } from '../utils/dataTypes.js';
import { SocketFactory } from '../utils/socketFactory.js';
import { TableWidgetRenderer } from '../utils/tableWidgetRenderer.js';

/**
 * TableRemoveNode - обработчик Data → Data (Раунд 42), "изъятие" -
 * зеркальная нода к TableInjectNode (вставка). Один вход (таблица),
 * один выход (та же таблица без удалённых строк).
 *
 * Режим удаления выбирается в боковой панели:
 *   - по номеру строки - одна конкретная строка;
 *   - диапазон строк - от и до (включительно);
 *   - первые N строк;
 *   - последние N строк.
 *
 * Заголовки/форматы столбцов не меняются - меняется только набор строк.
 * Выход - Data (ромб, оранжевый), та же порода, что у TableNode/
 * TableInjectNode - подключается куда угодно, что понимает Data.
 */
export class TableRemoveNode extends BaseNode {
    constructor(id, type, x, y, config = {}) {
        super(id, type, x, y, config);
        this.inputs = 1;
        this.inputSockets = [0];
        this.outputs = 1;
        this.width = config.width || 210;

        this.operation = config.operation || 'index'; // 'index'|'range'|'first'|'last'
        this.rowIndex = config.rowIndex ?? 0;       // 0-based, для 'index'
        this.rangeStart = config.rangeStart ?? 0;   // 0-based, для 'range'
        this.rangeEnd = config.rangeEnd ?? 0;       // 0-based, включительно, для 'range'
        this.count = config.count ?? 1;             // для 'first'/'last'

        this._sourceName = null;
        this.tableData = new TableData();

        // Виджет Доски (Раунд 35, см. TableWidgetRenderer) - номера строк
        // и сортировка. Оформление (формат/ширина/знаки/итог/цвет столбца,
        // зебра, линии) - НЕ здесь (Раунд 44): чтобы не захламлять эту
        // ноду настройками, не относящимися к её основной задаче
        // (удаление строк), подключите после неё TableFormatNode
        // ("Оформление таблицы", tableFormatNode.js).
        this.boardShowRowNumbers = config.boardShowRowNumbers ?? true;
        this.boardSortColumn = config.boardSortColumn ?? null;
        this.boardSortDirection = config.boardSortDirection ?? null;
    }

    createContent() {
        const content = document.createElement('div');
        content.className = 'node-content';
        content.style.cssText = 'width: 100%; min-width: 160px;';

        const inRow = document.createElement('div');
        inRow.style.cssText = 'display:flex; align-items:center; gap:6px;';
        const inSocket = SocketFactory.createSocket({
            nodeId: this.id, socketType: 'input', index: 0, isData: true,
            title: 'Таблица, из которой удаляем строки'
        });
        inRow.appendChild(inSocket);
        const sourceLabel = document.createElement('span');
        sourceLabel.className = 'table-remove-source-label';
        sourceLabel.style.cssText = 'color:var(--md-text-secondary); font-size:11px; flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;';
        sourceLabel.textContent = this._sourceName || 'не подключено';
        inRow.appendChild(sourceLabel);
        content.appendChild(inRow);

        const opRow = document.createElement('div');
        opRow.style.cssText = 'padding-left:20px;';
        const opLabel = document.createElement('span');
        opLabel.className = 'table-remove-op-label';
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
            title: 'Таблица без удалённых строк'
        });
        outRow.appendChild(outSocket);
        content.appendChild(outRow);

        return content;
    }

    _operationText() {
        switch (this.operation) {
            case 'range': return `→ удалить строки №${this.rangeStart + 1}–${this.rangeEnd + 1}`;
            case 'first': return `→ удалить первые ${this.count}`;
            case 'last': return `→ удалить последние ${this.count}`;
            case 'index':
            default: return `→ удалить строку №${this.rowIndex + 1}`;
        }
    }

    calculate(nodeManager) {
        const connections = window.connectionManager?.getConnections() || [];
        const conn = connections.find(c => c.targetNodeId === this.id && c.targetSocket === 0);
        const srcNode = conn ? nodeManager.getNode(conn.sourceNodeId) : null;

        this._sourceName = srcNode ? (srcNode.customName || srcNode.getDisplayName?.() || 'источник') : null;

        const baseTable = (srcNode && srcNode.tableData && srcNode.tableData.columns.length > 0)
            ? srcNode.tableData
            : new TableData();

        if (baseTable.columns.length === 0) {
            this.tableData = baseTable;
            this.value = 0;
            return this.value;
        }

        const rowCount = baseTable.rowCount;
        const allIndexes = Array.from({ length: rowCount }, (_, i) => i);

        let keepIndexes;
        switch (this.operation) {
            case 'range': {
                const start = Math.max(0, Math.min(rowCount, this.rangeStart));
                const end = Math.max(start, Math.min(rowCount - 1, this.rangeEnd)) + 1; // включительно -> exclusive-конец
                keepIndexes = allIndexes.filter(i => i < start || i >= end);
                break;
            }
            case 'first': {
                const n = Math.max(0, this.count);
                keepIndexes = allIndexes.filter(i => i >= n);
                break;
            }
            case 'last': {
                const n = Math.max(0, this.count);
                keepIndexes = allIndexes.filter(i => i < rowCount - n);
                break;
            }
            case 'index':
            default: {
                const idx = this.rowIndex;
                keepIndexes = allIndexes.filter(i => i !== idx);
                break;
            }
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

    // Виджет Доски (Раунд 42, см. dashboardNode.js/boardManager.js) -
    // та же интерактивная таблица, что у TableNode/TableInjectNode - код
    // общий, см. utils/tableWidgetRenderer.js. Оформление (зебра/линии/
    // цвет столбца) недоступно на ЭТОЙ ноде - см. TableFormatNode (Раунд 44).
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
        const sourceLabel = element.querySelector('.table-remove-source-label');
        if (sourceLabel) sourceLabel.textContent = this._sourceName || 'не подключено';

        const opLabel = element.querySelector('.table-remove-op-label');
        if (opLabel) opLabel.textContent = this._operationText();
    }

    getInspectorSchema() {
        const fields = super.getInspectorSchema();

        fields.push({ type: 'section', label: 'Что удалить' });

        fields.push({
            key: 'operation',
            label: 'Режим',
            type: 'select',
            options: [
                { value: 'index', label: 'По номеру строки' },
                { value: 'range', label: 'Диапазон строк' },
                { value: 'first', label: 'Первые N строк' },
                { value: 'last', label: 'Последние N строк' }
            ],
            get: () => this.operation,
            set: (v) => { this.operation = v; }
        });

        fields.push({
            key: 'rowIndex',
            label: 'Номер строки (с 1) - для режима "По номеру строки"',
            type: 'number',
            min: 1, step: 1,
            get: () => this.rowIndex + 1,
            set: (v) => { this.rowIndex = Math.max(0, (v || 1) - 1); }
        });

        fields.push({
            key: 'rangeStart',
            label: 'С номера строки - для режима "Диапазон"',
            type: 'number',
            min: 1, step: 1,
            get: () => this.rangeStart + 1,
            set: (v) => { this.rangeStart = Math.max(0, (v || 1) - 1); }
        });

        fields.push({
            key: 'rangeEnd',
            label: 'По номер строки (включительно) - для режима "Диапазон"',
            type: 'number',
            min: 1, step: 1,
            get: () => this.rangeEnd + 1,
            set: (v) => { this.rangeEnd = Math.max(0, (v || 1) - 1); }
        });

        fields.push({
            key: 'count',
            label: 'Сколько строк - для режимов "Первые N"/"Последние N"',
            type: 'number',
            min: 0, step: 1,
            get: () => this.count,
            set: (v) => { this.count = Math.max(0, v || 0); }
        });

        // Оформление (формат/ширина/знаки/итог/цвет столбца, зебра,
        // линии) - см. TableFormatNode ("Оформление таблицы", Раунд 44) -
        // отдельная нода, подключается ПОСЛЕ этой, чтобы не захламлять
        // удаление строк настройками оформления.

        return fields;
    }
}
