/**
 * SPDX-License-Identifier: MIT
 * SPDX-FileCopyrightText: 2024 NodeCalculate Team
 * SPDX-FileCopyrightText: 2024 Pavel Fomin
 *
 * @file    listViewerNode.js
 * @brief   Нода только для просмотра списка (LIST), без выхода
 * @author  Pavel Fomin
 * @version 1.8.20
 * @see     https://github.com/GhostPWLk1n/NodeCalculator.git
 */

import { BaseNode } from './baseNode.js';
import { Helpers } from '../utils/helpers.js';
import { ListData } from '../utils/dataTypes.js';
import { SocketFactory } from '../utils/socketFactory.js';

/**
 * ListViewerNode — только просмотр: один вход LIST, без выходов.
 * Требование: заголовок ноды должен сам меняться на имя подключённого узла
 * (если пользователь не переименовал viewer вручную — тогда его выбор в приоритете).
 * Список отображается зеброй: колонки "Имя | Значение".
 */
export class ListViewerNode extends BaseNode {
    constructor(id, type, x, y, config = {}) {
        super(id, type, x, y, config);
        this.outputs = 0;
        this.inputs = 1;
        this.inputSockets = [0];
        this.width = config.width || 260;
        this.listData = new ListData();
        this.sourceName = null;
    }

    getDisplayName() {
        // Ручное переименование пользователем всегда в приоритете.
        if (this.customName) return this.customName;
        // Иначе — имя подключённого источника (обновляется в calculate()).
        if (this.sourceName) return this.sourceName;
        return 'List Viewer';
    }

    createContent() {
        const content = document.createElement('div');
        content.className = 'node-content';
        content.style.cssText = 'width: 100%; min-width: 150px;';

        const topRow = document.createElement('div');
        topRow.style.cssText = `
            display:flex; align-items:center; gap:8px;
            padding-bottom:6px; margin-bottom:6px;
            border-bottom:1px solid var(--md-divider);
        `;

        const socket = SocketFactory.createSocket({
            nodeId: this.id,
            socketType: 'input',
            index: 0,
            isList: true,
            title: 'Входной список (LIST)'
        });
        topRow.appendChild(socket);

        const countLabel = document.createElement('span');
        countLabel.className = 'list-viewer-count';
        countLabel.style.cssText = 'color:var(--md-text-secondary); font-size:11px; flex:1;';
        countLabel.textContent = `${this.listData.items.length} эл.`;
        topRow.appendChild(countLabel);

        content.appendChild(topRow);

        const table = document.createElement('div');
        table.className = 'list-viewer-table';
        this.renderRows(table);
        content.appendChild(table);

        return content;
    }

    renderRows(table) {
        table.innerHTML = '';

        if (this.listData.items.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'list-viewer-empty';
            empty.textContent = 'Нет данных';
            table.appendChild(empty);
            return;
        }

        const header = document.createElement('div');
        header.className = 'list-viewer-row list-viewer-header';
        const hName = document.createElement('span');
        hName.className = 'list-viewer-cell-name';
        hName.textContent = 'Имя';
        const hValue = document.createElement('span');
        hValue.className = 'list-viewer-cell-value';
        hValue.textContent = 'Значение';
        header.appendChild(hName);
        header.appendChild(hValue);
        table.appendChild(header);

        this.listData.items.forEach((item, idx) => {
            const row = document.createElement('div');
            row.className = `list-viewer-row ${idx % 2 === 0 ? 'even' : 'odd'}`;

            const name = document.createElement('span');
            name.className = 'list-viewer-cell-name';
            name.textContent = item.name || 'unknown';
            name.title = item.name || 'unknown';

            const value = document.createElement('span');
            value.className = 'list-viewer-cell-value';
            value.textContent = Helpers.formatNumber(item.value);

            row.appendChild(name);
            row.appendChild(value);
            table.appendChild(row);
        });
    }

    calculate(nodeManager) {
        const connections = window.connectionManager?.getConnections() || [];
        const input = connections.find(c => c.targetNodeId === this.id);

        if (!input) {
            this.listData = new ListData();
            this.sourceName = null;
            return null;
        }

        const srcNode = nodeManager.getNode(input.sourceNodeId);
        if (!srcNode) {
            this.listData = new ListData();
            this.sourceName = null;
            return null;
        }

        // Требование: название виджета подхватывает имя подключённого узла.
        this.sourceName = srcNode.customName
            || srcNode.displayName
            || srcNode.listData?.metadata?.title
            || srcNode.type;

        this.listData = (srcNode.listData && srcNode.listData.items) ? srcNode.listData : new ListData();

        return this.listData.total;
    }

    updateDisplay(element) {
        const countEl = element.querySelector('.list-viewer-count');
        if (countEl) countEl.textContent = `${this.listData.items.length} эл.`;

        const table = element.querySelector('.list-viewer-table');
        if (table) {
            this.renderRows(table);
        }

        // Заголовок ноды обновляется на лету, если пользователь его не переименовывал.
        const titleText = element.querySelector('.title-text');
        if (titleText && !this.customName) {
            titleText.textContent = this.getDisplayName();
        }
    }
}
