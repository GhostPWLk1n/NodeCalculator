/**
 * SPDX-License-Identifier: MIT
 * SPDX-FileCopyrightText: 2024 NodeCalculate Team
 * SPDX-FileCopyrightText: 2024 Pavel Fomin
 *
 * @file    booleanOperationNode.js
 * @brief   Логическая операция (И/ИЛИ/НЕ/искл.ИЛИ) над несколькими Bool-входами
 * @author  Pavel Fomin
 * @version 1.8.4
 * @see     https://github.com/GhostPWLk1n/NodeCalculator.git
 */

import { BaseNode } from './baseNode.js';
import { SocketFactory } from '../utils/socketFactory.js';
import { ListData } from '../utils/dataTypes.js';

/**
 * BooleanOperationNode ("Логическая операция") - по образцу
 * `operationNode.js` (динамические входы, checkAndAddEmptySlot()/
 * removeInputSocket()/rerender() - тот же паттерн, см. docs/NODE_API.md
 * раздел 9), но сильно проще: один Bool-выход, без побочных LIST/count
 * выходов (арифметике они были нужны, логике - нет).
 *
 * Каждый вход при чтении приводится к bool через `!!srcNode.value`
 * (0/''/null/undefined/false -> ложь, всё остальное -> истина) - поэтому
 * ко входу можно подключить не только BooleanNode, но и Число/Строку и
 * т.п., получив разумную интерпретацию "пусто/ноль = ложь".
 *
 * Операции (this.operation):
 *   - and  - истина, только если ВСЕ входы истинны (и хотя бы один есть)
 *   - or   - истина, если истинен ХОТЯ БЫ ОДИН вход
 *   - xor  - истина, если истинных входов НЕЧЁТНОЕ количество
 *   - not  - отрицание ПЕРВОГО подключённого входа, остальные игнорируются
 *     (у отрицания по определению один операнд - лишние входы можно
 *     создать через "+", но реально участвует только первый)
 */
export class BooleanOperationNode extends BaseNode {
    constructor(id, type, x, y, config = {}) {
        super(id, type, x, y, config);
        this.outputs = 2;
        this.inputs = config.inputs || 2;
        this.maxInputs = 12;
        this.inputSockets = Array.from({ length: this.inputs }, (_, i) => i);
        this.operation = config.operation || 'and'; // 'and'|'or'|'xor'|'not'
        this.value = false;
        // LIST-выход (Раунд 56) - результат, обёрнутый в один элемент
        // списка, чтобы можно было подключить к TableNode/ListInputNode
        // и т.п. - тот же приём, что "Список (LIST)" у OperationNode, но
        // с ОДНИМ элементом (сам результат), а не входными значениями
        this.listData = new ListData();
        this._isRerendering = false;
    }

    createContent() {
        const content = document.createElement('div');
        content.className = 'node-content';

        // === ВЫБОР ОПЕРАЦИИ ===
        const opRow = document.createElement('div');
        opRow.style.cssText = 'display:flex; align-items:center; gap:6px; margin-bottom:6px;';
        const opSelect = document.createElement('select');
        opSelect.className = 'boolean-op-select';
        opSelect.style.cssText = `
            background: rgba(0, 0, 0, 0.3);
            border: 1px solid var(--md-divider);
            border-radius: 4px;
            color: var(--md-text);
            font-size: 11px;
            padding: 3px 6px;
            font-family: inherit;
            cursor: pointer;
            outline: none;
            flex: 1;
        `;
        [
            { value: 'and', label: 'И (AND)' },
            { value: 'or', label: 'ИЛИ (OR)' },
            { value: 'xor', label: 'Искл. ИЛИ (XOR)' },
            { value: 'not', label: 'НЕ (NOT, первый вход)' }
        ].forEach(op => {
            const option = document.createElement('option');
            option.value = op.value;
            option.textContent = op.label;
            if (op.value === this.operation) option.selected = true;
            opSelect.appendChild(option);
        });
        opSelect.addEventListener('mousedown', (e) => e.stopPropagation());
        opSelect.addEventListener('change', (e) => {
            this.operation = e.target.value;
            if (window.nodeManager) window.nodeManager.calculateAll();
        });
        opRow.appendChild(opSelect);
        content.appendChild(opRow);

        // === ВХОДНЫЕ СОКЕТЫ (динамические, по образцу OperationNode) ===
        const inputsContainer = document.createElement('div');
        inputsContainer.className = 'node-inputs-container';
        inputsContainer.style.cssText = `
            display: flex;
            flex-direction: column;
            gap: 4px;
            margin-bottom: 8px;
            padding-left: 21px;
            padding-right: 4px;
            margin-left: -21px;
        `;

        this.inputSockets.forEach((index) => {
            inputsContainer.appendChild(this.createInputSocket(index));
        });
        content.appendChild(inputsContainer);

        // === ВЫХОД ===
        const outRow = document.createElement('div');
        outRow.className = 'node-output';
        outRow.style.cssText = `
            display: flex;
            align-items: center;
            gap: 8px;
            padding-top: 6px;
            margin-top: 2px;
            border-top: 1px solid var(--md-divider);
        `;
        const outLabel = document.createElement('label');
        outLabel.textContent = 'Результат:';
        outLabel.style.cssText = 'color:var(--md-text-secondary); font-size:11px; flex:1;';
        outRow.appendChild(outLabel);

        const valueDisplay = document.createElement('span');
        valueDisplay.className = 'node-value-display node-value-result';
        valueDisplay.textContent = this.value ? 'ИСТИНА' : 'ЛОЖЬ';
        valueDisplay.style.cssText = `
            color: ${this.value ? 'var(--md-secondary)' : 'var(--md-error)'};
            font-weight: 600;
            font-size: 11px;
        `;
        outRow.appendChild(valueDisplay);

        const socket = SocketFactory.createSocket({
            nodeId: this.id,
            socketType: 'output',
            index: 0,
            isBool: true,
            title: 'Bool (истина/ложь)'
        });
        outRow.appendChild(socket);
        content.appendChild(outRow);

        // === LIST-ВЫХОД (Раунд 56) - для подключения к таблицам ===
        const listRow = document.createElement('div');
        listRow.className = 'node-output';
        listRow.style.cssText = `
            display: flex;
            align-items: center;
            gap: 8px;
            padding-top: 2px;
        `;
        const listLabel = document.createElement('label');
        listLabel.textContent = 'Список (LIST):';
        listLabel.style.cssText = 'color:var(--md-text-secondary); font-size:11px; flex:1;';
        listRow.appendChild(listLabel);

        const listSocket = SocketFactory.createSocket({
            nodeId: this.id,
            socketType: 'output',
            index: 1,
            isList: true,
            title: 'Результат одним элементом списка - для подключения к столбцу таблицы'
        });
        listRow.appendChild(listSocket);
        content.appendChild(listRow);

        this.checkAndAddEmptySlot();

        return content;
    }

    createInputSocket(index) {
        const inputRow = document.createElement('div');
        inputRow.className = 'node-input';
        inputRow.style.cssText = 'display:flex; align-items:center; gap:8px; padding:2px 0;';

        const isConnected = this.isSocketConnected(index);

        const socket = SocketFactory.createSocket({
            nodeId: this.id,
            socketType: 'input',
            index: index,
            isBool: true,
            title: 'Bool (истина/ложь) - подойдёт и Число/Строка (0/пусто = ложь)'
        });

        if (isConnected) {
            socket.classList.add('socket-connected');
            socket.style.background = '#f06292';
            socket.style.borderColor = '#f06292';
            socket.style.boxShadow = '0 0 12px rgba(240, 98, 146, 0.3)';
        }

        inputRow.appendChild(socket);

        const label = document.createElement('label');
        label.textContent = `вход ${index + 1}`;
        label.style.cssText = `
            color: ${isConnected ? 'var(--md-text)' : 'var(--md-text-secondary)'};
            font-size: 11px;
            font-weight: ${isConnected ? '500' : '400'};
            flex: 1;
        `;
        inputRow.appendChild(label);

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
            line-height: 1;
        `;
        deleteBtn.addEventListener('mousedown', (e) => e.stopPropagation());
        deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (this.isSocketConnected(index) && window.connectionManager) {
                const toRemove = window.connectionManager.getConnections()
                    .filter(c => c.targetNodeId === this.id && c.targetSocket === index);
                toRemove.forEach(conn => {
                    window.connectionManager.removeConnection(conn.sourceNodeId, conn.targetNodeId, conn.targetSocket);
                });
            }
            this.removeInputSocket(index);
        });
        inputRow.appendChild(deleteBtn);

        return inputRow;
    }

    isSocketConnected(index) {
        const connections = window.connectionManager?.getConnections() || [];
        return connections.some(c => c.targetNodeId === this.id && c.targetSocket === index);
    }

    // Автодобавление свободного слота при подключении - вызывается
    // connectionManager.addConnection() после создания соединения, если
    // у ноды есть этот метод (см. docs/NODE_API.md раздел 9)
    checkAndAddEmptySlot() {
        if (this.inputSockets.length >= this.maxInputs) return;
        const allConnected = this.inputSockets.every(i => this.isSocketConnected(i));
        if (!allConnected) return;

        const nextIndex = Math.max(-1, ...this.inputSockets) + 1;
        this.inputSockets.push(nextIndex);
        this.inputs = this.inputSockets.length;
        this.rerender();
    }

    removeInputSocket(index) {
        if (this.inputSockets.length <= 2) {
            const statusEl = document.getElementById('status');
            if (statusEl) {
                statusEl.textContent = '⚠️ Минимум 2 входа';
                setTimeout(() => { statusEl.textContent = 'Готово'; }, 1500);
            }
            return;
        }

        const idx = this.inputSockets.indexOf(index);
        if (idx === -1) return;
        this.inputSockets.splice(idx, 1);
        this.inputs = this.inputSockets.length;

        if (window.connectionManager) {
            const filtered = window.connectionManager.getConnections()
                .filter(c => !(c.targetNodeId === this.id && c.targetSocket === index));
            window.connectionManager.connections = filtered;
            if (window.renderer) window.renderer.drawAllConnections(filtered);
        }

        this.rerender();

        if (window.nodeManager) {
            window.nodeManager.calculateAll();
            if (window.renderer) window.renderer.updateAllDisplays();
        }
    }

    rerender() {
        if (this._isRerendering) return;
        this._isRerendering = true;

        const el = document.querySelector(`[data-node-id="${this.id}"]`);
        if (el) {
            el.remove();
            if (window.nodeManager) {
                window.nodeManager.renderNode(this);
                if (window.renderer) {
                    window.renderer.drawAllConnections(window.connectionManager?.getConnections() || []);
                }
            }
        }

        setTimeout(() => { this._isRerendering = false; }, 100);
    }

    // Читается TableNode.calculate() при построении столбца из LIST-выхода
    // этой ноды (см. this.listData выше) - без этого TableNode унаследовал
    // бы формат 'number' по умолчанию, и итоговый столбец показывал бы
    // 1/0 текстом, а не чекбоксом
    getValueFormat() {
        return 'boolean';
    }

    calculate(nodeManager) {
        const connections = window.connectionManager?.getConnections() || [];
        const inputs = connections
            .filter(c => c.targetNodeId === this.id)
            .sort((a, b) => (a.targetSocket || 0) - (b.targetSocket || 0));

        const values = inputs.map(c => {
            const src = nodeManager.getNode(c.sourceNodeId);
            return src ? !!src.value : false;
        });

        let result;
        switch (this.operation) {
            case 'or':
                result = values.some(v => v);
                break;
            case 'xor':
                result = values.filter(v => v).length % 2 === 1;
                break;
            case 'not':
                result = values.length > 0 ? !values[0] : false;
                break;
            case 'and':
            default:
                result = values.length > 0 && values.every(v => v);
                break;
        }

        this.value = result;

        // LIST-выход (Раунд 56) - результат ОДНИМ элементом, как булево
        // значение (не 0/1) - так столбец, построенный из этого списка,
        // получает format:'boolean' автоматически (см. TableNode.calculate())
        // и рисуется чекбоксом ниже по цепочке, а не текстом "true"/"false"
        this.listData = new ListData(
            [{ name: this.customName || this.getDisplayName(), value: this.value, format: 'boolean' }],
            { title: this.customName || this.getDisplayName(), format: 'boolean' }
        );

        setTimeout(() => this.checkAndAddEmptySlot(), 100);

        return result;
    }

    updateDisplay(element) {
        const resultDisplay = element.querySelector('.node-value-result');
        if (resultDisplay) {
            resultDisplay.textContent = this.value ? 'ИСТИНА' : 'ЛОЖЬ';
            resultDisplay.style.color = this.value ? 'var(--md-secondary)' : 'var(--md-error)';
        }

        const sockets = element.querySelectorAll('.socket.input-socket');
        sockets.forEach(socket => {
            const index = parseInt(socket.dataset.index, 10);
            const isConnected = this.isSocketConnected(index);
            if (isConnected) {
                socket.classList.add('socket-connected');
                socket.style.background = '#f06292';
                socket.style.borderColor = '#f06292';
                socket.style.boxShadow = '0 0 12px rgba(240, 98, 146, 0.3)';
            } else {
                socket.classList.remove('socket-connected');
                socket.style.background = '';
                socket.style.borderColor = '';
                socket.style.boxShadow = '';
            }
        });
    }
}
