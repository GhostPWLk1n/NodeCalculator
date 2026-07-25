/**
 * SPDX-License-Identifier: MIT
 * SPDX-FileCopyrightText: 2024 NodeCalculate Team
 * SPDX-FileCopyrightText: 2024 Pavel Fomin
 *
 * @file    operationNode.js
 * @brief   Операционные ноды (сложение, вычитание, умножение, деление)
 * @author  Pavel Fomin
 * @version 1.4.0
 * @see     https://github.com/GhostPWLk1n/NodeCalculator.git
 */

import { BaseNode } from './baseNode.js';
import { Constants } from '../utils/constants.js';
import { Helpers } from '../utils/helpers.js';
import { ListData } from '../utils/dataTypes.js';
import { SocketFactory } from '../utils/socketFactory.js';

export class OperationNode extends BaseNode {
    constructor(id, type, x, y, config = {}) {
        super(id, type, x, y, config);
        this.outputs = 3;
        this.inputs = config.inputs || 2;
        this.maxInputs = 20; // Увеличим максимальное количество входов
        this.inputSockets = Array.from({ length: this.inputs }, (_, i) => i);
        this.value = null;
        this.argCount = 0;
        this.listData = new ListData();
        this.resultListData = new ListData();
        this._isRerendering = false;
    }
    
    createContent() {
        const content = document.createElement('div');
        content.className = 'node-content';
        
        // Входные сокеты
        const inputsContainer = document.createElement('div');
        inputsContainer.className = 'node-inputs-container';
        inputsContainer.style.cssText = `
            display: flex;
            flex-direction: column;
            gap: 4px;
            margin-bottom: 8px;
            max-height: 300px;
            overflow-y: auto;
            overflow-x: visible;
            padding-left: 21px;
            padding-right: 4px;
            margin-left: -21px;
        `;
        
        this.inputSockets.forEach((index) => {
            const inputRow = this.createInputSocket(index);
            inputsContainer.appendChild(inputRow);
        });
        
        content.appendChild(inputsContainer);
        
        // Выходные сокеты
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
        
        // Выход 0: Результат
        const resultOutput = this.createOutputSocket('result', 'Результат', this.value, false);
        outputsContainer.appendChild(resultOutput);
        
        // Выход 1: Количество аргументов
        const countOutput = this.createOutputSocket('count', 'Кол-во', this.argCount, false);
        outputsContainer.appendChild(countOutput);
        
        // Выход 2: Список (LIST)
        const listOutput = this.createOutputSocket('list', 'Список (LIST)', this.listData.items.length, true);
        outputsContainer.appendChild(listOutput);
        
        content.appendChild(outputsContainer);
        
        // Проверяем, нужно ли добавить новый слот
        this.checkAndAddEmptySlot();
        
        return content;
    }
    
    createInputSocket(index) {
        const inputRow = document.createElement('div');
        inputRow.className = 'node-input';
        inputRow.style.cssText = `
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 2px 0;
        `;
        
        // Определяем, занят ли сокет
        const isConnected = this.isSocketConnected(index);
        
        const socket = SocketFactory.createSocket({
            nodeId: this.id,
            socketType: 'input',
            index: index,
            isList: false
        });
        
        // Если сокет занят - закрашиваем его сразу (чтобы не было
        // мигания "пустой" точки до первого вызова drawAllConnections)
        if (isConnected) {
            socket.classList.add('socket-connected');
            socket.style.background = '#ffb74d';
            socket.style.borderColor = '#ffb74d';
            socket.style.boxShadow = '0 0 12px rgba(255, 183, 77, 0.3)';
        }
        
        inputRow.appendChild(socket);
        
        const label = document.createElement('label');
        label.textContent = `вход ${index + 1}`;
        label.style.cssText = `
            color: ${isConnected ? 'var(--md-text)' : 'var(--md-text-secondary)'};
            font-size: 11px;
            font-weight: ${isConnected ? '500' : '400'};
            flex: 1;
            transition: all 0.2s ease;
        `;
        inputRow.appendChild(label);
        
        // Кнопка удаления
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'delete-input-btn';
        deleteBtn.textContent = '✕';
        deleteBtn.style.cssText = `
            display: ${this.inputSockets.length > 2 ? 'inline-block' : 'none'};
            background: transparent;
            border: none;
            color: var(--md-text-disabled);
            cursor: pointer;
            font-size: 12px;
            padding: 0 4px;
            transition: all 0.2s ease;
            line-height: 1;
        `;
        
        deleteBtn.addEventListener('mouseenter', () => {
            deleteBtn.style.color = 'var(--md-error)';
            deleteBtn.style.transform = 'scale(1.2)';
        });
        deleteBtn.addEventListener('mouseleave', () => {
            deleteBtn.style.color = 'var(--md-text-disabled)';
            deleteBtn.style.transform = 'scale(1)';
        });
        
        deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            // Проверяем, не занят ли сокет
            if (this.isSocketConnected(index)) {
                // Если занят - сначала удаляем соединение
                if (window.connectionManager) {
                    const connections = window.connectionManager.getConnections();
                    const toRemove = connections.filter(c => 
                        c.targetNodeId === this.id && c.targetSocket === index
                    );
                    toRemove.forEach(conn => {
                        window.connectionManager.removeConnection(
                            conn.sourceNodeId,
                            conn.targetNodeId,
                            conn.targetSocket
                        );
                    });
                }
            }
            this.removeInputSocket(index);
        });
        
        inputRow.appendChild(deleteBtn);
        
        return inputRow;
    }
    
    createOutputSocket(outputType, labelText, value, isList) {
        const outputRow = document.createElement('div');
        outputRow.className = 'node-output';
        outputRow.style.cssText = `
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 2px 0;
        `;
        
        const label = document.createElement('label');
        label.textContent = labelText + ':';
        label.style.cssText = `
            color: var(--md-text-secondary);
            font-size: 11px;
            font-weight: 400;
            flex: 1;
            min-width: 40px;
        `;
        outputRow.appendChild(label);
        
        const valueDisplay = document.createElement('span');
        valueDisplay.className = `node-value-display node-value-${outputType}`;
        valueDisplay.textContent = isList ? `${value} эл.` : Helpers.formatNumber(value);
        valueDisplay.style.cssText = `
            color: ${isList ? '#4fc3f7' : 'var(--md-accent)'};
            font-weight: 500;
            font-size: 12px;
            min-width: 40px;
            text-align: center;
        `;
        outputRow.appendChild(valueDisplay);
        
        const socket = SocketFactory.createSocket({
            nodeId: this.id,
            socketType: 'output',
            index: outputType === 'result' ? 0 : outputType === 'count' ? 1 : 2,
            isList: isList,
            outputType: outputType
        });
        outputRow.appendChild(socket);
        
        return outputRow;
    }
    
    isSocketConnected(index) {
        const connections = window.connectionManager?.getConnections() || [];
        return connections.some(c => 
            c.targetNodeId === this.id && c.targetSocket === index
        );
    }
    
    checkAndAddEmptySlot() {
        // Пока нода свёрнута, пользователь всё равно не видит и не может
        // взаимодействовать со входами - управлять слотами (а значит и
        // пересоздавать DOM через rerender()) в этот момент бессмысленно
        // и рискованно: именно асинхронный rerender() "не вовремя" (пока
        // пользователь только что свернул ноду) был причиной того, что
        // свёрнутая нода иногда теряла кнопку разворачивания. При
        // разворачивании checkAndAddEmptySlot() всё равно отработает на
        // следующем calculateAll() и добавит слот, если он нужен.
        if (this.collapsed) return;
        
        // Если достигнут максимум - не добавляем
        if (this.inputSockets.length >= this.maxInputs) return;
        
        // Проверяем, есть ли свободные слоты
        const connections = window.connectionManager?.getConnections() || [];
        const usedSockets = connections
            .filter(c => c.targetNodeId === this.id)
            .map(c => c.targetSocket);
        
        // Находим все занятые слоты
        const allSockets = this.inputSockets;
        const freeSockets = allSockets.filter(idx => !usedSockets.includes(idx));
        
        // Если свободных слотов нет - добавляем новый
        if (freeSockets.length === 0 && allSockets.length < this.maxInputs) {
            // Добавляем новый слот
            const newIndex = allSockets.length;
            this.inputSockets.push(newIndex);
            this.inputs = this.inputSockets.length;
            
            // Не перерисовываем сразу, чтобы избежать цикла
            setTimeout(() => {
                if (!this._isRerendering && !this.collapsed) {
                    this.rerender();
                }
            }, 50);
        }
    }
    
    addInputSocket() {
        if (this.inputSockets.length >= this.maxInputs) return;
        
        const newIndex = this.inputSockets.length;
        this.inputSockets.push(newIndex);
        this.inputs = this.inputSockets.length;
        
        this.rerender();
        
        document.getElementById('status').textContent = `➕ Добавлен вход #${this.inputs}`;
        setTimeout(() => {
            document.getElementById('status').textContent = 'Готово';
        }, 1500);
    }
    
    removeInputSocket(index) {
        if (this.inputSockets.length <= 2) {
            document.getElementById('status').textContent = '⚠️ Минимум 2 входа';
            setTimeout(() => {
                document.getElementById('status').textContent = 'Готово';
            }, 1500);
            return;
        }
        
        const idx = this.inputSockets.indexOf(index);
        if (idx !== -1) {
            this.inputSockets.splice(idx, 1);
            this.inputs = this.inputSockets.length;
            
            // Удаляем соединения
            if (window.connectionManager) {
                const connections = window.connectionManager.getConnections();
                const filtered = connections.filter(c => 
                    !(c.targetNodeId === this.id && c.targetSocket === index)
                );
                window.connectionManager.connections = filtered;
                if (window.renderer) {
                    window.renderer.drawAllConnections(filtered);
                }
            }
            
            this.rerender();
            
            if (window.nodeManager) {
                window.nodeManager.calculateAll();
                if (window.renderer) {
                    window.renderer.updateAllDisplays();
                }
            }
            
            document.getElementById('status').textContent = `🗑️ Вход #${index + 1} удален`;
            setTimeout(() => {
                document.getElementById('status').textContent = 'Готово';
            }, 1500);
        }
    }
    
    rerender() {
        if (this._isRerendering) return;
        this._isRerendering = true;
        
        const el = document.querySelector(`[data-node-id="${this.id}"]`);
        if (el) {
            // ВАЖНО: раньше здесь позиция пересчитывалась через
            // getBoundingClientRect() (не учитывало zoom - давало сдвиг
            // при масштабе != 100%, и было избыточно: this.x/this.y и так
            // корректно хранят текущую позицию ноды). Просто убираем
            // старый элемент и рендерим заново на тех же координатах.
            el.remove();
            
            if (window.nodeManager) {
                window.nodeManager.renderNode(this);
                if (window.renderer) {
                    window.renderer.drawAllConnections(window.connectionManager?.getConnections() || []);
                }
            }
        }
        
        setTimeout(() => {
            this._isRerendering = false;
        }, 100);
    }
    
    calculate(nodeManager) {
        const connections = window.connectionManager?.getConnections() || [];
        const inputs = connections.filter(c => c.targetNodeId === this.id);
        inputs.sort((a, b) => (a.targetSocket || 0) - (b.targetSocket || 0));
        
        const inputData = inputs.map(c => {
            const srcNode = nodeManager.getNode(c.sourceNodeId);
            if (!srcNode) return null;
            
            let value = srcNode.value;
            let name = srcNode.customName || srcNode.displayName || srcNode.type || 'unknown';
            
            // Если у источника есть resultListData (числовой вывод с именем)
            if (srcNode.resultListData && srcNode.resultListData.items && srcNode.resultListData.items.length > 0) {
                return srcNode.resultListData.items.map(item => ({
                    name: item.name || name,
                    value: typeof item.value === 'number' ? item.value : 0
                }));
            }
            
            // Если источник - список
            if (srcNode.listData && srcNode.listData.items && srcNode.listData.items.length > 0) {
                return srcNode.listData.items.map(item => ({
                    name: item.name || 'unknown',
                    value: typeof item.value === 'number' ? item.value : 0
                }));
            }
            
            // Если источник - число
            if (srcNode.type === 'number') {
                name = srcNode.customName || srcNode.displayName || 'Число';
            }
            
            return {
                name: name,
                value: typeof value === 'number' ? value : 0
            };
        }).filter(item => item !== null);
        
        // Разворачиваем все данные в плоский список
        let flatData = [];
        inputData.forEach(item => {
            if (Array.isArray(item)) {
                flatData = flatData.concat(item);
            } else {
                flatData.push(item);
            }
        });
        
        // Если данных нет
        if (flatData.length === 0) {
            this.value = 'Ошибка';
            this.argCount = 0;
            this.listData = new ListData();
            this.resultListData = new ListData();
            setTimeout(() => this.checkAndAddEmptySlot(), 100);
            return null;
        }
        
        // Извлекаем значения для вычислений
        const values = flatData.map(item => typeof item.value === 'number' ? item.value : 0);
        this.argCount = values.length;
        
        // Вычисляем результат
        let result;
        switch (this.type) {
            case 'add': result = values.reduce((a, b) => a + b, 0); break;
            case 'subtract': result = values.reduce((a, b) => a - b); break;
            case 'multiply': result = values.reduce((a, b) => a * b, 1); break;
            case 'divide':
                if (values.some(v => v === 0)) {
                    result = 'Деление на 0';
                } else {
                    result = values.reduce((a, b) => a / b);
                }
                break;
            default: result = null;
        }
        
        this.value = result;
        
        // === ВАЖНО: СОХРАНЯЕМ ВЕСЬ СПИСОК ДЛЯ ВЫХОДНОГО СОКЕТА LIST ===
        this.listData = new ListData(
            flatData.map(item => ({ 
                name: item.name || 'unknown', 
                value: typeof item.value === 'number' ? item.value : 0 
            })),
            { 
                title: this.customName || this.type || 'Операция',
                total: typeof result === 'number' ? result : 0,
                operationType: this.type,
                argCount: this.argCount,
                isFullList: true  // Маркер, что это полный список
            }
        );
        
        // === resultListData - только для числового вывода (один элемент) ===
        const resultName = this.customName || this.displayName || this.type || 'Операция';
        this.resultListData = new ListData(
            [{ name: resultName, value: typeof result === 'number' ? result : 0 }],
            { 
                title: resultName,
                total: typeof result === 'number' ? result : 0,
                operationType: this.type,
                argCount: this.argCount,
                isResult: true  // Маркер, что это результат операции
            }
        );
        
        // Проверяем, нужно ли добавить новый слот
        setTimeout(() => this.checkAndAddEmptySlot(), 100);
        
        return result;
    }
    
    updateDisplay(element) {
        const resultDisplay = element.querySelector('.node-value-result');
        if (resultDisplay) {
            resultDisplay.textContent = Helpers.formatNumber(this.value);
        }
        
        const countDisplay = element.querySelector('.node-value-count');
        if (countDisplay) {
            countDisplay.textContent = this.argCount || 0;
        }
        
        const listDisplay = element.querySelector('.node-value-list');
        if (listDisplay) {
            listDisplay.textContent = `${this.listData.items.length} эл.`;
        }
        
        // Обновляем состояние сокетов
        const sockets = element.querySelectorAll('.socket.input-socket');
        sockets.forEach(socket => {
            const index = parseInt(socket.dataset.index);
            const isConnected = this.isSocketConnected(index);
            
            if (isConnected) {
                socket.classList.add('socket-connected');
                socket.style.background = '#ffb74d';
                socket.style.borderColor = '#ffb74d';
                socket.style.boxShadow = '0 0 12px rgba(255, 183, 77, 0.3)';
            } else {
                socket.classList.remove('socket-connected');
                socket.style.background = '';
                socket.style.borderColor = '';
                socket.style.boxShadow = '';
            }
        });
    }
}
