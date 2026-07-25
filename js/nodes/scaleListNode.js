/**
 * SPDX-License-Identifier: MIT
 * SPDX-FileCopyrightText: 2024 NodeCalculate Team
 * SPDX-FileCopyrightText: 2024 Pavel Fomin
 *
 * @file    scaleListNode.js
 * @brief   Нода умножения списка на число (LIST → LIST)
 * @author  Pavel Fomin
 * @version 1.4.0
 * @see     https://github.com/GhostPWLk1n/NodeCalculator.git
 */

import { BaseNode } from './baseNode.js';
import { Helpers } from '../utils/helpers.js';
import { ListData } from '../utils/dataTypes.js';
import { SocketFactory } from '../utils/socketFactory.js';

export class ScaleListNode extends BaseNode {
    constructor(id, type, x, y, config = {}) {
        super(id, type, x, y, config);
        this.outputs = 3;
        this.inputs = 2;
        this.inputSockets = [0, 1];
        this.value = null;
        this.listData = new ListData();
        this.outputListData = new ListData();
        this.argCount = 0;
        this.scaleValue = config.scaleValue || 1;
        this.resultSum = 0;
        // Добавляем listData для числового вывода
        this.resultListData = new ListData();
        this.width = config.width || 220;
    }
    
    createContent() {
        const content = document.createElement('div');
        content.className = 'node-content';
        content.style.cssText = 'width: 100%; min-width: 150px;';
        
        // Входные сокеты
        const inputsContainer = document.createElement('div');
        inputsContainer.className = 'node-inputs-container';
        inputsContainer.style.cssText = `
            display: flex;
            flex-direction: column;
            gap: 4px;
            margin-bottom: 8px;
        `;
        
        // Вход 0: Число (множитель)
        const numberRow = document.createElement('div');
        numberRow.className = 'node-input';
        numberRow.style.cssText = `
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 2px 0;
        `;
        
        const numberSocket = SocketFactory.createSocket({
            nodeId: this.id,
            socketType: 'input',
            index: 0,
            isList: false
        });
        numberRow.appendChild(numberSocket);
        
        const numberLabel = document.createElement('label');
        numberLabel.textContent = 'множитель:';
        numberLabel.style.cssText = `
            color: var(--md-text-secondary);
            font-size: 11px;
            font-weight: 400;
            flex: 1;
            min-width: 0;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        `;
        numberRow.appendChild(numberLabel);
        
        const scaleDisplay = document.createElement('span');
        scaleDisplay.className = 'scale-value-display';
        scaleDisplay.style.cssText = `
            color: var(--md-accent);
            font-size: 14px;
            font-weight: 700;
            min-width: 40px;
            text-align: right;
        `;
        scaleDisplay.textContent = this.scaleValue !== null ? this.scaleValue.toFixed(2) : '—';
        numberRow.appendChild(scaleDisplay);
        
        inputsContainer.appendChild(numberRow);
        
        // Вход 1: Список
        const listRow = document.createElement('div');
        listRow.className = 'node-input';
        listRow.style.cssText = `
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 2px 0;
        `;
        
        const listSocket = SocketFactory.createSocket({
            nodeId: this.id,
            socketType: 'input',
            index: 1,
            isList: true
        });
        listRow.appendChild(listSocket);
        
        const listLabel = document.createElement('label');
        listLabel.textContent = 'список:';
        listLabel.style.cssText = `
            color: var(--md-text-secondary);
            font-size: 11px;
            font-weight: 400;
            flex: 1;
            min-width: 0;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        `;
        listRow.appendChild(listLabel);
        
        const listCount = document.createElement('span');
        listCount.className = 'list-count-display';
        listCount.style.cssText = `
            color: var(--md-text-secondary);
            font-size: 12px;
        `;
        listCount.textContent = `${this.listData.items.length} эл.`;
        listRow.appendChild(listCount);
        
        inputsContainer.appendChild(listRow);
        content.appendChild(inputsContainer);
        
        // === ВЫХОДНЫЕ СОКЕТЫ ===
        const outputsContainer = document.createElement('div');
        outputsContainer.className = 'node-outputs-container';
        outputsContainer.style.cssText = `
            display: flex;
            flex-direction: column;
            gap: 4px;
            margin-top: 8px;
            padding-top: 8px;
            border-top: 1px solid var(--md-divider);
        `;
        
        // Выход 0: Результат (число) - сумма всех умноженных значений
        const resultRow = document.createElement('div');
        resultRow.className = 'node-output';
        resultRow.style.cssText = `
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 2px 0;
        `;
        
        const resultLabel = document.createElement('label');
        resultLabel.textContent = 'сумма:';
        resultLabel.style.cssText = `
            color: var(--md-text-secondary);
            font-size: 11px;
            font-weight: 400;
            flex: 1;
            min-width: 0;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        `;
        resultRow.appendChild(resultLabel);
        
        const resultValue = document.createElement('span');
        resultValue.className = 'result-value-display';
        resultValue.style.cssText = `
            color: var(--md-accent);
            font-size: 14px;
            font-weight: 700;
            min-width: 50px;
            text-align: right;
            font-variant-numeric: tabular-nums;
        `;
        resultValue.textContent = this.resultSum !== 0 ? this.resultSum.toFixed(2) : '0';
        resultRow.appendChild(resultValue);
        
        const resultSocket = SocketFactory.createSocket({
            nodeId: this.id,
            socketType: 'output',
            index: 0,
            isList: false,
            outputType: 'result'
        });
        resultRow.appendChild(resultSocket);
        
        outputsContainer.appendChild(resultRow);
        
        // Выход 1: Список (результат)
        const listResultRow = document.createElement('div');
        listResultRow.className = 'node-output';
        listResultRow.style.cssText = `
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 2px 0;
        `;
        
        const listResultLabel = document.createElement('label');
        listResultLabel.textContent = 'список:';
        listResultLabel.style.cssText = `
            color: var(--md-text-secondary);
            font-size: 11px;
            font-weight: 400;
            flex: 1;
            min-width: 0;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        `;
        listResultRow.appendChild(listResultLabel);
        
        const listResultCount = document.createElement('span');
        listResultCount.className = 'list-result-count-display';
        listResultCount.style.cssText = `
            color: #4fc3f7;
            font-size: 12px;
            font-weight: 500;
        `;
        listResultCount.textContent = `${this.outputListData.items.length} эл.`;
        listResultRow.appendChild(listResultCount);
        
        const listResultSocket = SocketFactory.createSocket({
            nodeId: this.id,
            socketType: 'output',
            index: 1,
            isList: true,
            outputType: 'list',
            title: 'Выходной список (LIST)'
        });
        listResultRow.appendChild(listResultSocket);
        
        outputsContainer.appendChild(listResultRow);
        
        // Выход 2: Количество элементов
        const countRow = document.createElement('div');
        countRow.className = 'node-output';
        countRow.style.cssText = `
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 2px 0;
        `;
        
        const countLabel = document.createElement('label');
        countLabel.textContent = 'кол-во:';
        countLabel.style.cssText = `
            color: var(--md-text-secondary);
            font-size: 11px;
            font-weight: 400;
            flex: 1;
            min-width: 0;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        `;
        countRow.appendChild(countLabel);
        
        const countValue = document.createElement('span');
        countValue.className = 'count-value-display';
        countValue.style.cssText = `
            color: #ce93d8;
            font-size: 12px;
            font-weight: 500;
            min-width: 30px;
            text-align: right;
        `;
        countValue.textContent = this.argCount || 0;
        countRow.appendChild(countValue);
        
        const countSocket = SocketFactory.createSocket({
            nodeId: this.id,
            socketType: 'output',
            index: 2,
            isList: false,
            outputType: 'count'
        });
        countRow.appendChild(countSocket);
        
        outputsContainer.appendChild(countRow);
        content.appendChild(outputsContainer);
        
        return content;
    }
    
    calculate(nodeManager) {
        const connections = window.connectionManager?.getConnections() || [];
        const inputs = connections.filter(c => c.targetNodeId === this.id);
        
        // Находим множитель (вход 0)
        let scaleValue = this.scaleValue || 1;
        const scaleInput = inputs.find(c => c.targetSocket === 0);
        if (scaleInput) {
            const srcNode = nodeManager.getNode(scaleInput.sourceNodeId);
            if (srcNode && typeof srcNode.value === 'number') {
                scaleValue = srcNode.value;
            } else if (srcNode && srcNode.listData && srcNode.listData.items && srcNode.listData.items.length > 0) {
                const firstItem = srcNode.listData.items[0];
                if (firstItem && typeof firstItem.value === 'number') {
                    scaleValue = firstItem.value;
                }
            }
        }
        this.scaleValue = scaleValue;
        
        // Находим список (вход 1)
        let inputList = new ListData();
        const listInput = inputs.find(c => c.targetSocket === 1);
        if (listInput) {
            const srcNode = nodeManager.getNode(listInput.sourceNodeId);
            if (srcNode && srcNode.listData && srcNode.listData.items) {
                inputList = srcNode.listData;
            } else if (srcNode && typeof srcNode.value === 'number') {
                const name = srcNode.customName || srcNode.displayName || srcNode.type || 'value';
                inputList = new ListData([{ name: name, value: srcNode.value }]);
            }
        }
        
        this.listData = inputList;
        
        // Умножаем все элементы списка на множитель
        const scaledItems = this.listData.items.map(item => ({
            name: item.name || 'unknown',
            value: typeof item.value === 'number' ? item.value * scaleValue : 0
        }));
        
        // Создаем выходной список
        this.outputListData = new ListData(scaledItems, {
            title: this.customName || 'Умножение списка',
            total: scaledItems.reduce((sum, item) => sum + item.value, 0),
            scale: scaleValue,
            originalCount: this.listData.items.length
        });
        
        // Вычисляем сумму результата
        this.resultSum = scaledItems.reduce((sum, item) => sum + item.value, 0);
        this.argCount = scaledItems.length;
        this.value = this.resultSum;
        
        // Создаем listData для числового вывода (чтобы имя передавалось дальше)
        const resultName = this.customName || this.displayName || 'Умножение списка';
        this.resultListData = new ListData(
            [{ name: resultName, value: this.resultSum }],
            { 
                title: resultName,
                total: this.resultSum,
                isScaled: true,
                scale: scaleValue
            }
        );
        
        // Копируем outputListData в listData для передачи дальше
        this.listData = this.outputListData;
        
        return this.resultSum;
    }
    
    updateDisplay(element) {
        // Обновляем отображение множителя
        const scaleDisplay = element.querySelector('.scale-value-display');
        if (scaleDisplay) {
            scaleDisplay.textContent = this.scaleValue !== null ? this.scaleValue.toFixed(2) : '—';
        }
        
        // Обновляем сумму результата
        const resultDisplay = element.querySelector('.result-value-display');
        if (resultDisplay) {
            resultDisplay.textContent = this.resultSum !== 0 ? this.resultSum.toFixed(2) : '0';
        }
        
        // Обновляем количество элементов во входном списке
        const listCount = element.querySelector('.list-count-display');
        if (listCount) {
            listCount.textContent = `${this.listData.items.length} эл.`;
        }
        
        // Обновляем количество элементов в результате (список)
        const listResultCount = element.querySelector('.list-result-count-display');
        if (listResultCount) {
            listResultCount.textContent = `${this.outputListData.items.length} эл.`;
        }
        
        // Обновляем количество элементов
        const countValue = element.querySelector('.count-value-display');
        if (countValue) {
            countValue.textContent = this.argCount || 0;
        }
    }
}
