/**
 * SPDX-License-Identifier: MIT
 * SPDX-FileCopyrightText: 2024 NodeCalculate Team
 * SPDX-FileCopyrightText: 2024 Pavel Fomin
 *
 * @file    exampleNode.js
 * @brief   Эталонный пример реализации ноды по docs/NODE_API.md
 * @author  Pavel Fomin
 * @version 1.7.24
 * @see     https://github.com/GhostPWLk1n/NodeCalculator.git
 */

// ============================================
// ПРИМЕР НОДЫ — эталонная реализация по docs/NODE_API.md
// ============================================
// Умножает сумму входящих чисел на коэффициент, заданный пользователем.
// Демонстрирует: один динамический список входов, один числовой выход,
// поле настройки, сохраняемое в проект, корректную работу updateDisplay
// и resultListData для передачи имени дальше по графу.
//
// Не зарегистрирована в main.js по умолчанию - подключайте по образцу:
//   import { ExampleNode } from './nodes/exampleNode.js';
//   nodeManager.registerNodeType('example', ExampleNode);
// и добавьте пункт в сайдбар src/index.html.

import { BaseNode } from './baseNode.js';
import { Helpers } from '../utils/helpers.js';
import { ListData } from '../utils/dataTypes.js';
import { SocketFactory } from '../utils/socketFactory.js';

export class ExampleNode extends BaseNode {
    constructor(id, type, x, y, config = {}) {
        super(id, type, x, y, config);

        this.outputs = 1;
        this.inputs = 1;
        this.inputSockets = [0]; // один вход; при желании расширяется по
                                  // паттерну OperationNode (docs, раздел 9)

        // Настройка, специфичная для этой ноды. ВАЖНО: чтобы пережить
        // сохранение/загрузку, поле должно быть добавлено в
        // layoutManager.serialize() (см. docs/NODE_API.md, раздел 11).
        this.multiplier = config.multiplier ?? 2;

        this.value = 0;
        this.resultListData = new ListData();
    }

    createContent() {
        const content = document.createElement('div');
        content.className = 'node-content';
        content.style.cssText = `
            gap: 8px;
            min-width: 150px;
        `;

        // === СТРОКА ВХОДА ===
        const inputRow = document.createElement('div');
        inputRow.style.cssText = 'display:flex; align-items:center; gap:8px;';

        const inputSocket = SocketFactory.createSocket({
            nodeId: this.id,
            socketType: 'input',
            index: 0,
            isList: false,
            title: 'Число или список чисел'
        });
        inputRow.appendChild(inputSocket);

        const inputLabel = document.createElement('label');
        inputLabel.textContent = 'Сумма входов';
        inputLabel.style.cssText = `
            color: var(--md-text-secondary);
            font-size: 11px;
            flex: 1;
        `;
        inputRow.appendChild(inputLabel);

        content.appendChild(inputRow);

        // === НАСТРОЙКА: КОЭФФИЦИЕНТ ===
        const multRow = document.createElement('div');
        multRow.style.cssText = 'display:flex; align-items:center; gap:8px;';

        const multLabel = document.createElement('label');
        multLabel.textContent = 'Коэффициент:';
        multLabel.style.cssText = `
            color: var(--md-text-secondary);
            font-size: 11px;
            flex: 1;
        `;
        multRow.appendChild(multLabel);

        const multInput = document.createElement('input');
        multInput.type = 'number';
        multInput.className = 'number-input-compact';
        multInput.value = this.multiplier;
        multInput.step = '0.1';
        multInput.addEventListener('input', (e) => {
            const val = parseFloat(e.target.value);
            if (!isNaN(val)) {
                this.multiplier = val;
                // Настройка меняется вручную пользователем, а не входящим
                // соединением - пересчитываем сразу, как это делает NumberNode
                if (window.nodeManager) {
                    window.nodeManager.calculateAll();
                }
            }
        });
        multRow.appendChild(multInput);

        content.appendChild(multRow);

        // === СТРОКА ВЫХОДА ===
        const outputRow = document.createElement('div');
        outputRow.style.cssText = `
            display: flex;
            align-items: center;
            gap: 8px;
            padding-top: 6px;
            border-top: 1px solid var(--md-divider);
        `;

        const outputLabel = document.createElement('label');
        outputLabel.textContent = 'Результат:';
        outputLabel.style.cssText = `
            color: var(--md-text-secondary);
            font-size: 11px;
            flex: 1;
        `;
        outputRow.appendChild(outputLabel);

        const valueDisplay = document.createElement('span');
        valueDisplay.className = 'node-value-display';
        valueDisplay.textContent = Helpers.formatNumber(this.value);
        valueDisplay.style.cssText = `
            color: var(--md-accent);
            font-weight: 500;
            font-size: 13px;
        `;
        outputRow.appendChild(valueDisplay);

        const outputSocket = SocketFactory.createSocket({
            nodeId: this.id,
            socketType: 'output',
            index: 0,
            isList: false,
            title: 'Результат умножения'
        });
        outputRow.appendChild(outputSocket);

        content.appendChild(outputRow);

        return content;
    }

    calculate(nodeManager) {
        const connections = window.connectionManager?.getConnections() || [];
        const inputs = connections.filter(c => c.targetNodeId === this.id);

        // Суммируем все входящие значения (по образцу OperationNode:
        // источник может быть числом, списком или resultListData)
        let sum = 0;
        inputs.forEach(c => {
            const src = nodeManager.getNode(c.sourceNodeId);
            if (!src) return;

            if (src.listData && src.listData.items && src.listData.items.length > 0) {
                sum += src.listData.total;
            } else if (typeof src.value === 'number') {
                sum += src.value;
            }
        });

        this.value = sum * this.multiplier;

        // resultListData - "число с именем" для нод, которым важна подпись
        const displayName = this.customName || this.getDisplayName();
        this.resultListData = new ListData(
            [{ name: displayName, value: this.value }],
            { title: displayName }
        );

        return this.value;
    }

    updateDisplay(element) {
        const display = element.querySelector('.node-value-display');
        if (display) {
            display.textContent = Helpers.formatNumber(this.value);
        }

        // Поле коэффициента не перезаписываем, пока оно в фокусе -
        // иначе пользователь не сможет дописать число до конца
        const multInput = element.querySelector('input[type="number"]');
        if (multInput && document.activeElement !== multInput) {
            multInput.value = this.multiplier;
        }
    }
}
