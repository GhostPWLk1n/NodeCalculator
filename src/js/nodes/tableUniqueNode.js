/**
 * SPDX-License-Identifier: MIT
 * SPDX-FileCopyrightText: 2024 NodeCalculate Team
 * SPDX-FileCopyrightText: 2024 Pavel Fomin
 *
 * @file    tableUniqueNode.js
 * @brief   Обработчик: находит уникальные значения столбца, схлопывая или исключая остальные
 * @author  Pavel Fomin
 * @version 1.8.69
 * @see     https://github.com/GhostPWLk1n/NodeCalculator.git
 */

import { BaseNode } from './baseNode.js';
import { TableData, ListData } from '../utils/dataTypes.js';
import { SocketFactory } from '../utils/socketFactory.js';
import { TableWidgetRenderer } from '../utils/tableWidgetRenderer.js';

/**
 * TableUniqueNode ("Найти уникальные") - Data → (Data, LIST). Находит
 * уникальные значения в выбранном КЛЮЧЕВОМ столбце (this.keyColumn) -
 * по сути GROUP BY по этому столбцу. Для каждого ОСТАЛЬНОГО столбца
 * пользователь выбирает - "схлопнуть с условием" (агрегировать все
 * значения этого столбца в группе одной операцией: сумма/максимум/
 * минимум/среднее/первое значение/перечислить одинаковые) или
 * "отключить" (исключить столбец из результата целиком) - тот же
 * принцип, что уже есть у `TableJoinNode` (Раунд 46), но по индексу
 * столбца ВНУТРИ ОДНОЙ таблицы, а не между двумя.
 *
 * Порядок уникальных значений - по первому появлению в исходной таблице
 * (не пересортировывается).
 *
 * Два выхода:
 *   - "Таблица" (Data) - одна строка на уникальное значение ключа,
 *     ключевой столбец как есть + агрегированные/оставшиеся столбцы;
 *   - "Список уникальных" (LIST) - сами уникальные значения ключа, как
 *     `ListData` (полезно, если нужен именно ПЕРЕЧЕНЬ, а не таблица -
 *     например, для дальнейшей фильтрации или построения диаграммы).
 */
export class TableUniqueNode extends BaseNode {
    constructor(id, type, x, y, config = {}) {
        super(id, type, x, y, config);
        this.inputs = 1;
        this.inputSockets = [0];
        this.outputs = 2; // 0: таблица, 1: список уникальных
        this.width = config.width || 220;

        this.keyColumn = config.keyColumn ?? 0;
        // Индекс = индекс столбца В ИСХОДНОЙ таблице (кроме ключевого) -
        // {include, aggregation} - тот же принцип, что columnConfigB у
        // TableJoinNode (Раунд 46)
        this.columnConfig = Array.isArray(config.columnConfig) ? config.columnConfig : [];

        this._sourceName = null;
        this._inputHeaders = [];
        this.tableData = new TableData();
        this.listData = new ListData();

        // Виджет Доски (см. utils/tableWidgetRenderer.js) - показывает
        // ВЫХОД "Таблица" (не список) - только номера строк/сортировка,
        // оформление - через TableFormatNode (Раунд 44)
        this.boardShowRowNumbers = config.boardShowRowNumbers ?? true;
        // Раунд 93 (чек-лист, п.4.1) - ручная ширина столбцов на Доске
        this.boardColumnWidths = config.boardColumnWidths ? { ...config.boardColumnWidths } : {};
        this.boardSortColumn = config.boardSortColumn ?? null;
        this.boardSortDirection = config.boardSortDirection ?? null;
    }

    createContent() {
        const content = document.createElement('div');
        content.className = 'node-content';
        content.style.cssText = 'width: 100%; min-width: 190px;';

        const inRow = document.createElement('div');
        inRow.style.cssText = 'display:flex; align-items:center; gap:6px;';
        const inSocket = SocketFactory.createSocket({
            nodeId: this.id, socketType: 'input', index: 0, isData: true,
            title: 'Таблица, в которой ищем уникальные значения'
        });
        inRow.appendChild(inSocket);
        const sourceLabel = document.createElement('span');
        sourceLabel.className = 'table-unique-source-label';
        sourceLabel.style.cssText = 'color:var(--md-text-secondary); font-size:11px; flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;';
        sourceLabel.textContent = this._sourceName || 'не подключено';
        inRow.appendChild(sourceLabel);
        content.appendChild(inRow);

        const statusRow = document.createElement('div');
        statusRow.style.cssText = 'padding-left:20px;';
        const statusLabel = document.createElement('span');
        statusLabel.className = 'table-unique-status-label';
        statusLabel.style.cssText = 'color:var(--md-text-disabled); font-size:10px;';
        statusLabel.textContent = this._statusText();
        statusRow.appendChild(statusLabel);
        content.appendChild(statusRow);

        const tableOutRow = document.createElement('div');
        tableOutRow.style.cssText = `
            display: flex;
            align-items: center;
            gap: 8px;
            padding-top: 6px;
            margin-top: 2px;
            border-top: 1px solid var(--md-divider);
        `;
        const tableOutLabel = document.createElement('label');
        tableOutLabel.textContent = 'Таблица (DATA):';
        tableOutLabel.style.cssText = 'color:var(--md-text-secondary); font-size:11px; flex:1;';
        tableOutRow.appendChild(tableOutLabel);
        const tableOutSocket = SocketFactory.createSocket({
            nodeId: this.id, socketType: 'output', index: 0, isData: true,
            title: 'Сгруппированная таблица - строка на уникальное значение'
        });
        tableOutRow.appendChild(tableOutSocket);
        content.appendChild(tableOutRow);

        const listOutRow = document.createElement('div');
        listOutRow.style.cssText = 'display:flex; align-items:center; gap:8px; padding-top:2px;';
        const listOutLabel = document.createElement('label');
        listOutLabel.textContent = 'Список уникальных (LIST):';
        listOutLabel.style.cssText = 'color:var(--md-text-secondary); font-size:11px; flex:1;';
        listOutRow.appendChild(listOutLabel);
        const listOutSocket = SocketFactory.createSocket({
            nodeId: this.id, socketType: 'output', index: 1, isList: true,
            title: 'Сами уникальные значения ключевого столбца'
        });
        listOutRow.appendChild(listOutSocket);
        content.appendChild(listOutRow);

        return content;
    }

    _statusText() {
        const keyHeader = this._inputHeaders[this.keyColumn] || `столбец ${this.keyColumn + 1}`;
        return `→ ключ: «${keyHeader}» · уникальных: ${this.value ?? 0}`;
    }

    static _aggregate(values, mode) {
        const nums = values.filter(v => typeof v === 'number');
        switch (mode) {
            case 'sum': return nums.reduce((a, b) => a + b, 0);
            case 'max': return nums.length ? Math.max(...nums) : null;
            case 'min': return nums.length ? Math.min(...nums) : null;
            case 'avg': return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
            case 'distinct': {
                const uniq = [...new Set(values.map(v => String(v ?? '')))];
                return uniq.join(', ');
            }
            case 'first':
            default:
                return values.length ? values[0] : null;
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

        this._inputHeaders = baseTable.columns.map(c => c.header);

        if (baseTable.columns.length === 0) {
            this.tableData = baseTable;
            this.listData = new ListData();
            this.value = 0;
            return this.value;
        }

        // Синхронизация columnConfig по длине - см. докстринг класса
        while (this.columnConfig.length < baseTable.columns.length) {
            this.columnConfig.push({ include: true, aggregation: 'first' });
        }
        this.columnConfig.length = baseTable.columns.length;

        const keyCol = Math.max(0, Math.min(baseTable.columns.length - 1, this.keyColumn));
        const keyValues = baseTable.columns[keyCol].values;

        // Уникальные значения ключа, по порядку первого появления
        const uniqueKeys = [];
        const seen = new Set();
        keyValues.forEach(v => {
            const k = String(v);
            if (!seen.has(k)) { seen.add(k); uniqueKeys.push(v); }
        });

        // Индексы строк исходной таблицы для каждого уникального значения
        const groups = uniqueKeys.map(uk => {
            const ukKey = String(uk);
            return keyValues.reduce((acc, v, i) => {
                if (String(v) === ukKey) acc.push(i);
                return acc;
            }, []);
        });

        const keyResultCol = {
            header: baseTable.columns[keyCol].header,
            values: uniqueKeys,
            format: baseTable.columns[keyCol].format
        };

        const otherCols = baseTable.columns
            .map((col, i) => ({ col, i }))
            .filter(({ i }) => i !== keyCol && this.columnConfig[i]?.include !== false)
            .map(({ col, i }) => {
                const mode = this.columnConfig[i]?.aggregation || 'first';
                const values = groups.map(idxs => TableUniqueNode._aggregate(idxs.map(gi => col.values[gi]), mode));
                const format = ['sum', 'max', 'min', 'avg'].includes(mode)
                    ? 'number'
                    : (mode === 'distinct' ? 'text' : col.format);
                return { header: col.header, values, format };
            });

        this.tableData = new TableData([keyResultCol, ...otherCols], { ...baseTable.metadata });

        this.listData = new ListData(
            uniqueKeys.map(v => ({
                name: String(v ?? ''),
                value: typeof v === 'number' ? v : 0
            })),
            { title: `Уникальные: ${keyResultCol.header}`, isFullList: true }
        );

        this.value = uniqueKeys.length;
        return this.value;
    }

    // Виджет Доски (см. dashboardNode.js/boardManager.js) - показывает
    // выход "Таблица" - код общий, см. utils/tableWidgetRenderer.js.
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
        const sourceLabel = element.querySelector('.table-unique-source-label');
        if (sourceLabel) sourceLabel.textContent = this._sourceName || 'не подключено';

        const statusLabel = element.querySelector('.table-unique-status-label');
        if (statusLabel) statusLabel.textContent = this._statusText();
    }

    getInspectorSchema() {
        const fields = super.getInspectorSchema();

        fields.push({ type: 'section', label: 'Ключевой столбец' });
        fields.push({
            key: 'keyColumn',
            label: 'Искать уникальные значения в',
            type: 'select',
            options: this._inputHeaders.map((h, i) => ({ value: String(i), label: h || `Столбец ${i + 1}` })),
            get: () => String(this.keyColumn),
            set: (v) => { this.keyColumn = parseInt(v, 10) || 0; }
        });

        fields.push({ type: 'section', label: 'Остальные столбцы' });
        this._inputHeaders.forEach((header, i) => {
            if (i === this.keyColumn) return; // ключ - не показываем, он всегда в результате как есть
            const cfg = this.columnConfig[i] || {};
            const label = header || `Столбец ${i + 1}`;

            fields.push({ type: 'section', label });

            fields.push({
                key: `uniqueCol${i}_include`,
                label: 'Включить в результат',
                type: 'checkbox',
                get: () => cfg.include !== false,
                set: (v) => { this.columnConfig[i] = { ...cfg, include: !!v }; }
            });

            fields.push({
                key: `uniqueCol${i}_agg`,
                label: 'Схлопнуть с условием',
                type: 'select',
                options: [
                    { value: 'first', label: 'Первое значение' },
                    { value: 'sum', label: 'Сумма' },
                    { value: 'max', label: 'Максимум' },
                    { value: 'min', label: 'Минимум' },
                    { value: 'avg', label: 'Среднее' },
                    { value: 'distinct', label: 'Перечислить одинаковые' }
                ],
                get: () => cfg.aggregation || 'first',
                set: (v) => { this.columnConfig[i] = { ...cfg, aggregation: v }; }
            });
        });

        return fields;
    }
}
