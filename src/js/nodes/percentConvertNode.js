/**
 * SPDX-License-Identifier: MIT
 * SPDX-FileCopyrightText: 2024 NodeCalculate Team
 * SPDX-FileCopyrightText: 2024 Pavel Fomin
 *
 * @file    percentConvertNode.js
 * @brief   Нода-преобразователь: список чисел -> список процентных долей от суммы
 * @author  Pavel Fomin
 * @version 1.7.50
 * @see     https://github.com/GhostPWLk1n/NodeCalculator.git
 */

import { BaseNode } from './baseNode.js';
import { Helpers } from '../utils/helpers.js';
import { ListData } from '../utils/dataTypes.js';
import { SocketFactory } from '../utils/socketFactory.js';

/**
 * PercentConvertNode - обработчик LIST -> LIST: каждый элемент входного
 * списка заменяется на его долю (в процентах) от суммы всех элементов,
 * имена элементов сохраняются. Не путать с PercentageNode - та рисует
 * диаграмму, эта только преобразует данные, чтобы результат можно было
 * подключить куда угодно (например, в столбец TableNode).
 *
 * Метаданные формата: нода переопределяет getValueFormat() -> 'percent'
 * (см. BaseNode.getValueFormat, docs/NODE_API.md), поэтому любой
 * потребитель, который умеет спрашивать формат у источника (TableNode
 * с форматом столбца "Авто" и т.п.), сразу понимает, что на выходе -
 * процентные значения, без ручной настройки.
 */
export class PercentConvertNode extends BaseNode {
    constructor(id, type, x, y, config = {}) {
        super(id, type, x, y, config);
        this.inputs = 1;
        this.outputs = 1;
        this.inputSockets = [0];
        this.width = config.width || 220;

        this.inputListData = new ListData();
        this.listData = new ListData(); // выходной список (проценты) - его же читают потребители LIST
    }

    // Источник значения-формата для потребителей (TableNode и т.п.)
    getValueFormat() {
        return 'percent';
    }

    createContent() {
        const content = document.createElement('div');
        content.className = 'node-content';
        content.style.cssText = `
            display: flex;
            flex-direction: column;
            gap: 6px;
            width: 100%;
            min-width: 150px;
        `;

        // === ВХОД: список ===
        const inputRow = document.createElement('div');
        inputRow.style.cssText = 'display:flex; align-items:center; gap:8px;';

        const inputSocket = SocketFactory.createSocket({
            nodeId: this.id,
            socketType: 'input',
            index: 0,
            isList: true,
            title: 'Входной список (LIST)'
        });
        inputRow.appendChild(inputSocket);

        const inputLabel = document.createElement('label');
        inputLabel.textContent = 'список:';
        inputLabel.style.cssText = 'color:var(--md-text-secondary); font-size:11px; flex:1;';
        inputRow.appendChild(inputLabel);

        const inputCount = document.createElement('span');
        inputCount.className = 'percent-convert-input-count';
        inputCount.style.cssText = 'color:var(--md-text-secondary); font-size:12px;';
        inputCount.textContent = `${this.inputListData.items.length} эл.`;
        inputRow.appendChild(inputCount);

        content.appendChild(inputRow);

        // Разделитель со стрелкой - визуально подчёркивает "это преобразование"
        const arrowRow = document.createElement('div');
        arrowRow.style.cssText = `
            text-align: center;
            color: var(--md-text-disabled);
            font-size: 11px;
            padding: 2px 0;
            border-top: 1px dashed var(--md-divider);
            border-bottom: 1px dashed var(--md-divider);
        `;
        arrowRow.textContent = '↓ % от суммы';
        content.appendChild(arrowRow);

        // === ВЫХОД: список процентов ===
        const outputRow = document.createElement('div');
        outputRow.style.cssText = 'display:flex; align-items:center; gap:8px;';

        const outputLabel = document.createElement('label');
        outputLabel.textContent = 'проценты:';
        outputLabel.style.cssText = 'color:var(--md-text-secondary); font-size:11px; flex:1;';
        outputRow.appendChild(outputLabel);

        const outputCount = document.createElement('span');
        outputCount.className = 'percent-convert-output-count';
        outputCount.style.cssText = 'color:#4fc3f7; font-size:12px; font-weight:500;';
        outputCount.textContent = `${this.listData.items.length} эл.`;
        outputRow.appendChild(outputCount);

        const outputSocket = SocketFactory.createSocket({
            nodeId: this.id,
            socketType: 'output',
            index: 0,
            isList: true,
            title: 'Выходной список долей, % (LIST)'
        });
        outputRow.appendChild(outputSocket);

        content.appendChild(outputRow);

        return content;
    }

    calculate(nodeManager) {
        const connections = window.connectionManager?.getConnections() || [];
        const input = connections.find(c => c.targetNodeId === this.id && c.targetSocket === 0);

        let inputList = new ListData();
        if (input) {
            const src = nodeManager.getNode(input.sourceNodeId);
            if (src) {
                if (src.listData && src.listData.items && src.listData.items.length > 0) {
                    inputList = src.listData;
                } else if (src.resultListData && src.resultListData.items && src.resultListData.items.length > 0) {
                    inputList = src.resultListData;
                } else if (typeof src.value === 'number') {
                    const name = src.customName || src.getDisplayName?.() || 'value';
                    inputList = new ListData([{ name, value: src.value }]);
                }
            }
        }

        this.inputListData = inputList;

        // ListData.percentages уже реализует "доля от суммы, %" - переиспользуем
        const pcts = inputList.percentages;
        const percentItems = inputList.items.map((item, i) => ({
            name: item.name || 'unknown',
            value: pcts[i] ?? 0,
            format: 'percent'
        }));

        const displayName = this.customName || this.getDisplayName();
        this.listData = new ListData(percentItems, {
            title: displayName,
            total: 100,
            format: 'percent'
        });

        // this.value - сумма исходных значений (единственная осмысленная
        // "числовая" сводка для этой ноды; не для отображения как проценты)
        this.value = inputList.total;

        return this.value;
    }

    updateDisplay(element) {
        const inputCount = element.querySelector('.percent-convert-input-count');
        if (inputCount) inputCount.textContent = `${this.inputListData.items.length} эл.`;

        const outputCount = element.querySelector('.percent-convert-output-count');
        if (outputCount) outputCount.textContent = `${this.listData.items.length} эл.`;
    }
}
