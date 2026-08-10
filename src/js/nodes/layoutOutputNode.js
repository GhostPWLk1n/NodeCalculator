/**
 * SPDX-License-Identifier: MIT
 * SPDX-FileCopyrightText: 2024 NodeCalculate Team
 * SPDX-FileCopyrightText: 2024 Pavel Fomin
 *
 * @file    layoutOutputNode.js
 * @brief   Нода-мост между листами проекта (выход)
 * @author  Pavel Fomin
 * @version 1.8.42
 * @see     https://github.com/GhostPWLk1n/NodeCalculator.git
 */

import { BaseNode } from './baseNode.js';
import { Helpers } from '../utils/helpers.js';

export class LayoutOutputNode extends BaseNode {
    constructor(id, type, x, y, config = {}) {
        super(id, type, x, y, config);
        this.inputs = 1;
        this.outputs = 0;
        this.inputSockets = [0];
        this.value = null;
    }

    createContent() {
        const content = document.createElement('div');
        content.className = 'node-content';
        content.style.cssText = 'width: 100%; min-width: 150px;';

        const row = document.createElement('div');
        row.className = 'node-input';
        row.style.cssText = `
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 2px 0;
        `;

        const socket = document.createElement('div');
        socket.className = 'socket input-socket socket-number';
        socket.dataset.nodeId = this.id;
        socket.dataset.socketType = 'input';
        socket.dataset.index = 0;
        socket.dataset.isList = 'false';
        socket.style.cssText = `
            width: 12px;
            height: 12px;
            border-radius: 50%;
            flex-shrink: 0;
        `;
        row.appendChild(socket);

        socket.addEventListener('mousedown', (e) => {
            e.stopPropagation();
            e.preventDefault();
            if (window.connectionManager) {
                window.connectionManager.startConnection(e, this.id, 'input');
            }
        });

        const label = document.createElement('label');
        label.textContent = 'значение:';
        label.style.cssText = `
            color: var(--md-text-secondary);
            font-size: 11px;
            flex: 1;
        `;
        row.appendChild(label);

        const valueDisplay = document.createElement('span');
        valueDisplay.className = 'node-value-display';
        valueDisplay.textContent = Helpers.formatNumber(this.value);
        row.appendChild(valueDisplay);

        content.appendChild(row);

        const hint = document.createElement('div');
        hint.className = 'layout-node-hint';
        hint.style.cssText = `
            font-size: 10px;
            color: var(--md-text-disabled);
            margin-top: 6px;
        `;
        hint.textContent = '📤 Доступно другим листам через "Вход листа"';
        content.appendChild(hint);

        return content;
    }

    calculate(nodeManager) {
        const connections = window.connectionManager?.getConnections() || [];
        const input = connections.find(c => c.targetNodeId === this.id && c.targetSocket === 0);

        if (input) {
            const srcNode = nodeManager.getNode(input.sourceNodeId);
            this.value = srcNode && typeof srcNode.value === 'number' ? srcNode.value : null;
        } else {
            this.value = null;
        }

        return this.value;
    }

    updateDisplay(element) {
        const valueDisplay = element.querySelector('.node-value-display');
        if (valueDisplay) {
            valueDisplay.textContent = Helpers.formatNumber(this.value);
        }

        const socket = element.querySelector('.input-socket');
        if (socket) {
            const connections = window.connectionManager?.getConnections() || [];
            const isConnected = connections.some(c => c.targetNodeId === this.id && c.targetSocket === 0);
            socket.classList.toggle('socket-connected', isConnected);
        }
    }
}
