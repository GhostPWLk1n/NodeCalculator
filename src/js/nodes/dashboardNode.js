/**
 * SPDX-License-Identifier: MIT
 * SPDX-FileCopyrightText: 2024 NodeCalculate Team
 * SPDX-FileCopyrightText: 2024 Pavel Fomin
 *
 * @file    dashboardNode.js
 * @brief   Нода-мост: подключает источник данных к виджету на конкретной Доске
 * @author  Pavel Fomin
 * @version 1.4.0
 * @see     https://github.com/GhostPWLk1n/NodeCalculator.git
 */

import { BaseNode } from './baseNode.js';
import { SocketFactory } from '../utils/socketFactory.js';

/**
 * DashboardNode - живёт на обычном Листе (как любая другая нода), но
 * фактически передаёт данные не по графу вычислений, а на Доску
 * (см. boardManager.js) - отдельный холст для визуализации,
 * подготовленный под экспорт (PDF и т.п.).
 *
 * Вход и выход - универсальные (any): подключается к чему угодно, и
 * пробрасывает то же самое насквозь (value/listData/tableData
 * зеркалятся от источника) - ноду можно поставить посередине цепочки,
 * не обрывая граф.
 *
 * Совместимость с Доской определяется не типом сокета (any пропускает
 * всё), а тем, реализует ли ПОДКЛЮЧЁННЫЙ ИСТОЧНИК метод
 * getDashboardWidget() (см. numberNode.js/stringNode.js/listInputNode.js
 * за примерами). Если нет - нода вешает на себя error-бейдж (см.
 * baseNode.js) и красит входящую связь в красный
 * (connectionManager.setConnectionError) - оба сигнала независимы от
 * системы типов сокетов, ровно на этот случай их и строили.
 *
 * targetBoardId (какая Доска получает виджет) и dashboardOrder (порядок
 * виджета на странице) - в боковой панели.
 */
export class DashboardNode extends BaseNode {
    constructor(id, type, x, y, config = {}) {
        super(id, type, x, y, config);
        this.inputs = 1;
        this.inputSockets = [0];
        this.outputs = 1;
        this.width = config.width || 220;

        this.targetBoardId = config.targetBoardId ?? null;
        // null = автопорядок (следующий свободный номер на доске)
        this.dashboardOrder = config.dashboardOrder ?? null;

        this._sourceName = null;
        this._widgetType = null;
    }

    createContent() {
        const content = document.createElement('div');
        content.className = 'node-content';
        content.style.cssText = 'width: 100%; min-width: 150px;';

        // --- строка 1: источник данных (any) ---
        const inRow = document.createElement('div');
        inRow.style.cssText = 'display:flex; align-items:center; gap:6px;';
        const inSocket = SocketFactory.createSocket({
            nodeId: this.id, socketType: 'input', index: 0, isAny: true,
            title: 'Источник данных - любой тип, поддерживающий виджет Доски'
        });
        inRow.appendChild(inSocket);
        const sourceLabel = document.createElement('span');
        sourceLabel.className = 'dashboard-source-label';
        sourceLabel.style.cssText = `
            color: var(--md-text-secondary);
            font-size: 11px;
            flex: 1;
            min-width: 0;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        `;
        sourceLabel.textContent = this._sourceName || 'не подключено';
        inRow.appendChild(sourceLabel);
        content.appendChild(inRow);

        // --- строка 2: целевая доска (только для чтения тут - выбор в панели) ---
        const boardRow = document.createElement('div');
        boardRow.style.cssText = 'display:flex; align-items:center; gap:6px;';
        const boardLabel = document.createElement('span');
        boardLabel.className = 'dashboard-board-label';
        boardLabel.style.cssText = `
            color: var(--md-text-disabled);
            font-size: 10px;
            flex: 1;
            min-width: 0;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            padding-left: 20px;
        `;
        boardLabel.textContent = this._boardLabelText();
        boardRow.appendChild(boardLabel);
        content.appendChild(boardRow);

        // --- строка 3: выход (проброс насквозь) ---
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
        outLabel.textContent = 'Проброс:';
        outLabel.style.cssText = 'color:var(--md-text-secondary); font-size:11px; flex:1;';
        outRow.appendChild(outLabel);
        const outSocket = SocketFactory.createSocket({
            nodeId: this.id, socketType: 'output', index: 0, isAny: true,
            title: 'То же самое, что пришло на вход - нода не обрывает граф'
        });
        outRow.appendChild(outSocket);
        content.appendChild(outRow);

        return content;
    }

    _boardLabelText() {
        if (this.targetBoardId === null) return '→ доска не выбрана';
        const board = window.boardManager?.getBoard(this.targetBoardId);
        return `→ ${board ? board.name : 'доска не найдена'}`;
    }

    calculate(nodeManager) {
        const connections = window.connectionManager?.getConnections() || [];
        const conn = connections.find(c => c.targetNodeId === this.id && c.targetSocket === 0);
        const src = conn ? nodeManager.getNode(conn.sourceNodeId) : null;

        // Проброс насквозь - с выхода этой ноды можно читать те же поля,
        // что были бы доступны при подключении напрямую к источнику
        this.value = src?.value ?? null;
        this.listData = src?.listData;
        this.tableData = src?.tableData;

        this._sourceName = src ? (src.customName || src.getDisplayName?.() || 'источник') : null;

        const hasWidget = !!(src && typeof src.getDashboardWidget === 'function');

        if (src && !hasWidget) {
            const sourceLabel = src.customName || src.getDisplayName?.() || src.type;
            this.addBadge('dashboard-compat', {
                type: 'error',
                text: `«${sourceLabel}» не поддерживает отображение на Доске`
            });
            if (conn) {
                window.connectionManager?.setConnectionError(
                    conn.sourceNodeId, conn.targetNodeId, conn.targetSocket,
                    true, 'Источник не поддерживает Доску'
                );
            }
        } else {
            this.clearBadge('dashboard-compat');
            if (conn) {
                window.connectionManager?.setConnectionError(
                    conn.sourceNodeId, conn.targetNodeId, conn.targetSocket, false
                );
            }
        }

        if (window.boardManager) {
            if (this.targetBoardId !== null && hasWidget) {
                const widget = src.getDashboardWidget();
                this._widgetType = widget.type;
                window.boardManager.registerWidget(this.targetBoardId, this.id, {
                    order: this.dashboardOrder,
                    type: widget.type,
                    title: widget.title,
                    render: widget.render
                });
            } else {
                this._widgetType = null;
                window.boardManager.unregisterWidgetEverywhere(this.id);
            }
        }

        return this.value;
    }

    updateDisplay(element) {
        const sourceLabel = element.querySelector('.dashboard-source-label');
        if (sourceLabel) sourceLabel.textContent = this._sourceName || 'не подключено';

        const boardLabel = element.querySelector('.dashboard-board-label');
        if (boardLabel) boardLabel.textContent = this._boardLabelText();
    }

    // Боковая панель: какая Доска получает виджет + порядок на странице.
    // Список досок читается из window.boardManager - тот же паттерн, что
    // у layoutInputNode.js со списком Листов.
    getInspectorSchema() {
        const fields = super.getInspectorSchema();

        fields.push({ type: 'section', label: 'Доска' });

        const boards = window.boardManager?.getAllBoards() || [];
        fields.push({
            key: 'targetBoardId',
            label: 'Целевая доска',
            type: 'select',
            options: [
                { value: '', label: '— не выбрана —' },
                ...boards.map(b => ({ value: String(b.id), label: b.name }))
            ],
            get: () => (this.targetBoardId === null ? '' : String(this.targetBoardId)),
            set: (v) => {
                this.targetBoardId = v === '' ? null : parseInt(v, 10);
                if (window.nodeManager) window.nodeManager.calculateAll();
            }
        });

        fields.push({
            key: 'dashboardOrder',
            label: 'Порядок на странице (пусто = авто)',
            type: 'number',
            min: 0, step: 1,
            get: () => this.dashboardOrder,
            set: (v) => {
                this.dashboardOrder = v;
                if (window.nodeManager) window.nodeManager.calculateAll();
            }
        });

        return fields;
    }
}
