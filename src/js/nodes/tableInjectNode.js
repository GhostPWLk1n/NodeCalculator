/**
 * SPDX-License-Identifier: MIT
 * SPDX-FileCopyrightText: 2024 NodeCalculate Team
 * SPDX-FileCopyrightText: 2024 Pavel Fomin
 *
 * @file    tableInjectNode.js
 * @brief   Обработчик: вставляет строки из одной таблицы в другую (в конец/начало/по номеру строки)
 * @author  Pavel Fomin
 * @version 1.8.58
 * @see     https://github.com/GhostPWLk1n/NodeCalculator.git
 */

import { BaseNode } from './baseNode.js';
import { TableData } from '../utils/dataTypes.js';
import { SocketFactory } from '../utils/socketFactory.js';
import { TableWidgetRenderer } from '../utils/tableWidgetRenderer.js';

/**
 * TableInjectNode - обработчик Data → Data (Раунд 42): единственный
 * способ в проекте МОДИФИЦИРОВАТЬ уже готовую таблицу, а не построить
 * новую с нуля из списков (как TableNode). Два входа:
 *
 *   - вход 0 ("Базовая таблица") - таблица, которую меняем;
 *   - вход 1 ("Инъекция") - таблица, строки которой добавляются/заменяют
 *     строки базовой. Необязательный - если не подключён, нода просто
 *     пропускает базовую таблицу насквозь без изменений.
 *
 * Операция выбирается в боковой панели: в конец / в начало / вставить по
 * номеру строки / заменить по номеру строки (см. getInspectorSchema()).
 *
 * СОПОСТАВЛЕНИЕ СТОЛБЦОВ - ПО ПОЗИЦИИ, НЕ ПО ЗАГОЛОВКУ. Заголовки и
 * форматы столбцов ВСЕГДА берутся из базовой таблицы - у инъекции важны
 * только сами значения, по порядку столбцов. Если у инъекции столбцов
 * меньше - недостающие заполняются null; если больше - лишние
 * отбрасываются. Это осознанное упрощение ("попытаться сделать
 * вставку", а не требовать идеального совпадения структуры) - см.
 * докстринг calculate() про то, как именно это устроено.
 *
 * Выход - Data (ромб, оранжевый), та же порода, что у TableNode/ChartNode -
 * подключается куда угодно, что понимает Data.
 */
export class TableInjectNode extends BaseNode {
    constructor(id, type, x, y, config = {}) {
        super(id, type, x, y, config);
        this.inputs = 2;
        this.inputSockets = [0, 1];
        this.outputs = 1;
        this.width = config.width || 220;

        this.operation = config.operation || 'append'; // 'append'|'prepend'|'insert'|'replace'
        // 0-based номер строки БАЗОВОЙ таблицы - используется только для
        // insert/replace, для append/prepend игнорируется
        this.rowIndex = config.rowIndex ?? 0;

        this._baseSourceName = null;
        this._injectSourceName = null;
        this.tableData = new TableData();

        // Виджет Доски (Раунд 35, см. TableWidgetRenderer) - номера строк
        // и сортировка. Оформление (формат/ширина/знаки/итог/цвет столбца,
        // зебра, линии) - НЕ здесь (Раунд 44): чтобы не захламлять эту
        // ноду настройками, не относящимися к её основной задаче
        // (вставка строк), подключите после неё TableFormatNode
        // ("Оформление таблицы", tableFormatNode.js).
        this.boardShowRowNumbers = config.boardShowRowNumbers ?? true;
        // Раунд 93 (чек-лист, п.4.1) - ручная ширина столбцов на Доске
        this.boardColumnWidths = config.boardColumnWidths ? { ...config.boardColumnWidths } : {};
        this.boardSortColumn = config.boardSortColumn ?? null;
        this.boardSortDirection = config.boardSortDirection ?? null;
    }

    createContent() {
        const content = document.createElement('div');
        content.className = 'node-content';
        content.style.cssText = 'width: 100%; min-width: 170px;';

        const baseRow = document.createElement('div');
        baseRow.style.cssText = 'display:flex; align-items:center; gap:6px;';
        const baseSocket = SocketFactory.createSocket({
            nodeId: this.id, socketType: 'input', index: 0, isData: true,
            title: 'Базовая таблица - её и модифицируем'
        });
        baseRow.appendChild(baseSocket);
        const baseLabel = document.createElement('span');
        baseLabel.className = 'table-inject-base-label';
        baseLabel.style.cssText = 'color:var(--md-text-secondary); font-size:11px; flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;';
        baseLabel.textContent = this._baseSourceName || 'база: не подключена';
        baseRow.appendChild(baseLabel);
        content.appendChild(baseRow);

        const injectRow = document.createElement('div');
        injectRow.style.cssText = 'display:flex; align-items:center; gap:6px;';
        const injectSocket = SocketFactory.createSocket({
            nodeId: this.id, socketType: 'input', index: 1, isData: true,
            title: 'Инъекция - таблица, строки которой добавляются/заменяют (необязательно)'
        });
        injectRow.appendChild(injectSocket);
        const injectLabel = document.createElement('span');
        injectLabel.className = 'table-inject-source-label';
        injectLabel.style.cssText = 'color:var(--md-text-secondary); font-size:11px; flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;';
        injectLabel.textContent = this._injectSourceName || 'инъекция: не подключена';
        injectRow.appendChild(injectLabel);
        content.appendChild(injectRow);

        const opRow = document.createElement('div');
        opRow.style.cssText = 'padding-left:20px;';
        const opLabel = document.createElement('span');
        opLabel.className = 'table-inject-op-label';
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
            title: 'Базовая таблица с внесённой инъекцией'
        });
        outRow.appendChild(outSocket);
        content.appendChild(outRow);

        return content;
    }

    _operationText() {
        const labels = {
            append: '→ добавить в конец',
            prepend: '→ добавить в начало',
            insert: `→ вставить перед строкой №${this.rowIndex + 1}`,
            replace: `→ заменить строку №${this.rowIndex + 1}`
        };
        return labels[this.operation] || labels.append;
    }

    // Разбирает таблицу в массив "строк" (массив массивов значений по
    // столбцам) - удобный промежуточный формат для вставки/удаления,
    // раз TableData сама по себе хранит данные ПО СТОЛБЦАМ
    static _tableToRows(table, colCount) {
        const rowCount = table.rowCount;
        const rows = [];
        for (let r = 0; r < rowCount; r++) {
            const row = [];
            for (let c = 0; c < colCount; c++) {
                row.push(table.columns[c] ? (table.columns[c].values[r] ?? null) : null);
            }
            rows.push(row);
        }
        return rows;
    }

    calculate(nodeManager) {
        const connections = window.connectionManager?.getConnections() || [];
        const baseConn = connections.find(c => c.targetNodeId === this.id && c.targetSocket === 0);
        const injectConn = connections.find(c => c.targetNodeId === this.id && c.targetSocket === 1);
        const baseSrc = baseConn ? nodeManager.getNode(baseConn.sourceNodeId) : null;
        const injectSrc = injectConn ? nodeManager.getNode(injectConn.sourceNodeId) : null;

        this._baseSourceName = baseSrc ? (baseSrc.customName || baseSrc.getDisplayName?.() || 'источник') : null;
        this._injectSourceName = injectSrc ? (injectSrc.customName || injectSrc.getDisplayName?.() || 'источник') : null;

        const baseTable = (baseSrc && baseSrc.tableData && baseSrc.tableData.columns.length > 0)
            ? baseSrc.tableData
            : new TableData();
        const injectTable = (injectSrc && injectSrc.tableData && injectSrc.tableData.columns.length > 0)
            ? injectSrc.tableData
            : null;

        // Нечего вставлять (инъекция не подключена/пустая) ИЛИ база пуста
        // (столбцов нет вовсе, вставлять некуда по позициям) - пропускаем
        // базовую таблицу насквозь без изменений
        if (!injectTable || baseTable.columns.length === 0) {
            this.tableData = baseTable;
            this.value = this.tableData.rowCount;
            return this.value;
        }

        const colCount = baseTable.columns.length;
        const baseRows = TableInjectNode._tableToRows(baseTable, colCount);
        const injectRows = TableInjectNode._tableToRows(injectTable, colCount);

        let resultRows;
        switch (this.operation) {
            case 'prepend':
                resultRows = [...injectRows, ...baseRows];
                break;
            case 'insert': {
                const idx = Math.max(0, Math.min(baseRows.length, this.rowIndex));
                resultRows = [...baseRows.slice(0, idx), ...injectRows, ...baseRows.slice(idx)];
                break;
            }
            case 'replace': {
                // Заменяем ОДНУ строку базовой таблицы на ВСЕ строки
                // инъекции (их может быть больше или меньше одной)
                const idx = baseRows.length > 0
                    ? Math.max(0, Math.min(baseRows.length - 1, this.rowIndex))
                    : 0;
                resultRows = baseRows.length > 0
                    ? [...baseRows.slice(0, idx), ...injectRows, ...baseRows.slice(idx + 1)]
                    : [...injectRows];
                break;
            }
            case 'append':
            default:
                resultRows = [...baseRows, ...injectRows];
                break;
        }

        // Заголовки/форматы столбцов - ВСЕГДА от базовой таблицы (см.
        // докстринг класса про сопоставление по позиции)
        const columns = baseTable.columns.map((col, c) => ({
            header: col.header,
            format: col.format,
            values: resultRows.map(row => row[c])
        }));

        this.tableData = new TableData(columns, { ...baseTable.metadata });
        this.value = this.tableData.rowCount;
        return this.value;
    }

    // Виджет Доски (Раунд 42, см. dashboardNode.js/boardManager.js) -
    // та же интерактивная таблица, что у TableNode (номера строк,
    // сортировка, итоги) - код общий, см. utils/tableWidgetRenderer.js.
    // Оформление (зебра/линии/цвет столбца) недоступно на ЭТОЙ ноде -
    // см. TableFormatNode (Раунд 44).
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
        const baseLabel = element.querySelector('.table-inject-base-label');
        if (baseLabel) baseLabel.textContent = this._baseSourceName || 'база: не подключена';

        const injectLabel = element.querySelector('.table-inject-source-label');
        if (injectLabel) injectLabel.textContent = this._injectSourceName || 'инъекция: не подключена';

        const opLabel = element.querySelector('.table-inject-op-label');
        if (opLabel) opLabel.textContent = this._operationText();
    }

    getInspectorSchema() {
        const fields = super.getInspectorSchema();

        fields.push({ type: 'section', label: 'Операция вставки' });

        fields.push({
            key: 'operation',
            label: 'Что делать',
            type: 'select',
            options: [
                { value: 'append', label: 'Добавить в конец' },
                { value: 'prepend', label: 'Добавить в начало' },
                { value: 'insert', label: 'Вставить по номеру строки' },
                { value: 'replace', label: 'Заменить по номеру строки' }
            ],
            get: () => this.operation,
            set: (v) => { this.operation = v; }
        });

        fields.push({
            key: 'rowIndex',
            label: 'Номер строки (с 1), для вставки/замены',
            type: 'number',
            min: 1, step: 1,
            get: () => this.rowIndex + 1,
            set: (v) => { this.rowIndex = Math.max(0, (v || 1) - 1); }
        });

        // Оформление (формат/ширина/знаки/итог/цвет столбца, зебра,
        // линии) - см. TableFormatNode ("Оформление таблицы", Раунд 44) -
        // отдельная нода, подключается ПОСЛЕ этой, чтобы не захламлять
        // вставку строк настройками оформления.

        return fields;
    }
}
