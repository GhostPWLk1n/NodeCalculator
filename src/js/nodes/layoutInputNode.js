/**
 * SPDX-License-Identifier: MIT
 * SPDX-FileCopyrightText: 2024 NodeCalculate Team
 * SPDX-FileCopyrightText: 2024 Pavel Fomin
 *
 * @file    layoutInputNode.js
 * @brief   Нода-мост между листами проекта (вход)
 * @author  Pavel Fomin
 * @version 1.7.15
 * @see     https://github.com/GhostPWLk1n/NodeCalculator.git
 */

import { BaseNode } from './baseNode.js';
import { Helpers } from '../utils/helpers.js';

export class LayoutInputNode extends BaseNode {
    constructor(id, type, x, y, config = {}) {
        super(id, type, x, y, config);
        this.inputs = 0;
        this.outputs = 1;
        this.value = 0;
        this.sourceLayoutId = config.sourceLayoutId ?? null;
        this.sourceNodeId = config.sourceNodeId ?? null;
    }

    createContent() {
        const content = document.createElement('div');
        content.className = 'node-content';
        content.style.cssText = 'width: 100%; min-width: 150px;';

        const selectStyle = `
            width: 100%;
            margin-bottom: 4px;
            background: rgba(0, 0, 0, 0.3);
            border: 1px solid var(--md-divider);
            border-radius: 4px;
            color: var(--md-text);
            font-size: 11px;
            padding: 4px 6px;
            font-family: inherit;
            cursor: pointer;
            outline: none;
        `;

        const layoutSelect = document.createElement('select');
        layoutSelect.className = 'layout-input-select-layout';
        layoutSelect.style.cssText = selectStyle;
        content.appendChild(layoutSelect);

        const outputSelect = document.createElement('select');
        outputSelect.className = 'layout-input-select-output';
        outputSelect.style.cssText = selectStyle;
        content.appendChild(outputSelect);

        const populateLayouts = () => {
            const currentValue = this.sourceLayoutId;
            layoutSelect.innerHTML = '';
            const layouts = window.layoutManager?.getAllLayouts() || [];
            const otherLayouts = layouts.filter(l => l.id !== window.layoutManager?.activeLayoutId);

            if (otherLayouts.length === 0) {
                const opt = document.createElement('option');
                opt.value = '';
                opt.textContent = 'нет других листов';
                layoutSelect.appendChild(opt);
                return;
            }

            otherLayouts.forEach(l => {
                const opt = document.createElement('option');
                opt.value = l.id;
                opt.textContent = l.name;
                if (l.id === currentValue) opt.selected = true;
                layoutSelect.appendChild(opt);
            });

            if (currentValue === null || !otherLayouts.some(l => l.id === currentValue)) {
                this.sourceLayoutId = parseInt(layoutSelect.value);
            }
        };

        const populateOutputs = () => {
            outputSelect.innerHTML = '';
            const outputs = window.layoutManager?.getOutputsForLayout(this.sourceLayoutId) || [];

            if (outputs.length === 0) {
                const opt = document.createElement('option');
                opt.value = '';
                opt.textContent = 'нет нод "Выход листа"';
                outputSelect.appendChild(opt);
                this.sourceNodeId = null;
                return;
            }

            outputs.forEach(o => {
                const opt = document.createElement('option');
                opt.value = o.id;
                opt.textContent = o.name;
                if (o.id === this.sourceNodeId) opt.selected = true;
                outputSelect.appendChild(opt);
            });

            if (this.sourceNodeId === null || !outputs.some(o => o.id === this.sourceNodeId)) {
                this.sourceNodeId = parseInt(outputSelect.value) || null;
            }
        };

        populateLayouts();
        populateOutputs();

        layoutSelect.addEventListener('change', (e) => {
            e.stopPropagation();
            this.sourceLayoutId = layoutSelect.value ? parseInt(layoutSelect.value) : null;
            this.sourceNodeId = null;
            populateOutputs();
            if (window.nodeManager) window.nodeManager.calculateAll();
        });

        outputSelect.addEventListener('change', (e) => {
            e.stopPropagation();
            this.sourceNodeId = outputSelect.value ? parseInt(outputSelect.value) : null;
            if (window.nodeManager) window.nodeManager.calculateAll();
        });

        // Клики по select не должны запускать перетаскивание ноды
        [layoutSelect, outputSelect].forEach(el => {
            el.addEventListener('mousedown', (e) => e.stopPropagation());
        });

        // === ВЫХОДНОЙ СОКЕТ ===
        const outputRow = document.createElement('div');
        outputRow.className = 'node-output';
        outputRow.style.cssText = `
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 6px 0 2px 0;
            margin-top: 6px;
            border-top: 1px solid var(--md-divider);
        `;

        const label = document.createElement('label');
        label.textContent = 'значение:';
        label.style.cssText = `
            color: var(--md-text-secondary);
            font-size: 11px;
            flex: 1;
        `;
        outputRow.appendChild(label);

        const valueDisplay = document.createElement('span');
        valueDisplay.className = 'node-value-display';
        valueDisplay.textContent = Helpers.formatNumber(this.value);
        outputRow.appendChild(valueDisplay);

        const socket = document.createElement('div');
        socket.className = 'socket output-socket socket-number';
        socket.dataset.nodeId = this.id;
        socket.dataset.socketType = 'output';
        socket.dataset.index = 0;
        socket.dataset.isList = 'false';
        socket.style.cssText = `
            width: 12px;
            height: 12px;
            border-radius: 50%;
            flex-shrink: 0;
        `;
        outputRow.appendChild(socket);

        socket.addEventListener('mousedown', (e) => {
            e.stopPropagation();
            e.preventDefault();
            if (window.connectionManager) {
                window.connectionManager.startConnection(e, this.id, 'output');
            }
        });

        content.appendChild(outputRow);

        const hint = document.createElement('div');
        hint.className = 'layout-node-hint';
        hint.style.cssText = `
            font-size: 10px;
            color: var(--md-text-disabled);
            margin-top: 6px;
        `;
        hint.textContent = '📥 Тянет значение с "Выхода листа" другого листа';
        content.appendChild(hint);

        return content;
    }

    calculate(nodeManager) {
        if (this.sourceLayoutId === null || this.sourceNodeId === null) {
            this.value = 0;
            return this.value;
        }

        const outputNode = window.layoutManager?.getOutputNode(this.sourceLayoutId, this.sourceNodeId);
        this.value = outputNode && typeof outputNode.value === 'number' ? outputNode.value : 0;
        return this.value;
    }

    updateDisplay(element) {
        const valueDisplay = element.querySelector('.node-value-display');
        if (valueDisplay) {
            valueDisplay.textContent = Helpers.formatNumber(this.value);
        }
    }
}
