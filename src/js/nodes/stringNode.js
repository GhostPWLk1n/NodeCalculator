/**
 * SPDX-License-Identifier: MIT
 * SPDX-FileCopyrightText: 2024 NodeCalculate Team
 * SPDX-FileCopyrightText: 2024 Pavel Fomin
 *
 * @file    stringNode.js
 * @brief   Компактная нода ввода текста (по образцу NumberNode)
 * @author  Pavel Fomin
 * @version 1.4.0
 * @see     https://github.com/GhostPWLk1n/NodeCalculator.git
 */

import { BaseNode } from './baseNode.js';
import { SocketFactory } from '../utils/socketFactory.js';

/**
 * StringNode - ввод текста (по аналогии с NumberNode, но для строк).
 * Один input, один выход типа String (круглый синий сокет). Используется
 * как источник текста - например, заголовков столбцов таблицы.
 */
export class StringNode extends BaseNode {
    constructor(id, type, x, y, config = {}) {
        super(id, type, x, y, config);
        this.outputs = 1;
        // Строка - единственный "слой" данных этой ноды, хранится в
        // this.value по аналогии с числовыми нодами (BaseNode ожидает
        // именно value как основной результат calculate())
        this.value = config.value !== undefined ? config.value : '';
        this.displayName = config.displayName || config.customName || 'Строка';
        // Важно: как и у NumberNode, нода не должна быть свёрнутой по умолчанию
        this.collapsed = config.collapsed || false;
    }

    createContent() {
        const content = document.createElement('div');
        content.className = 'node-content';

        // === ПОЛЕ ВВОДА ===
        const input = document.createElement('input');
        input.className = 'string-input-compact';
        input.type = 'text';
        input.value = this.value || '';
        input.placeholder = 'Текст…';

        input.addEventListener('focus', () => input.select());

        input.addEventListener('input', (e) => {
            this.setValue(e.target.value);
        });

        content.appendChild(input);

        // === ВЫХОДНОЙ СОКЕТ ===
        const socketContainer = document.createElement('div');
        socketContainer.className = 'string-node-socket-container';

        const socket = SocketFactory.createSocket({
            nodeId: this.id,
            socketType: 'output',
            index: 0,
            isString: true,
            title: 'Строка'
        });

        socketContainer.appendChild(socket);
        content.appendChild(socketContainer);

        this._inputElement = input;

        return content;
    }

    setValue(val) {
        this.value = val;

        if (window.nodeManager) {
            window.nodeManager.calculateAll();
        }
    }

    calculate() {
        // Строка - конечный продукт, никаких resultListData/listData не нужно
        return this.value;
    }

    updateDisplay(element) {
        const input = element.querySelector('.string-input-compact');
        // Не перезаписываем поле, пока пользователь в нём печатает
        if (input && document.activeElement !== input) {
            input.value = this.value || '';
        }
    }

    // Переопределяем toggleCollapse по образцу NumberNode - чтобы
    // компактный вид корректно восстанавливался при разворачивании
    toggleCollapse() {
        this.collapsed = !this.collapsed;

        const el = document.querySelector(`[data-node-id="${this.id}"]`);
        if (el) {
            el.classList.toggle('collapsed', this.collapsed);

            const icon = el.querySelector('.collapse-icon');
            if (icon) {
                icon.textContent = this.collapsed ? '▸' : '▾';
                icon.title = this.collapsed ? 'Развернуть ноду' : 'Свернуть ноду';
            }

            if (!this.collapsed && this.type === 'string') {
                el.classList.add('string-node-compact');
            }
        }

        if (window.renderer) {
            window.renderer.drawAllConnections(window.connectionManager?.getConnections() || []);
            window.renderer.updateAllDisplays();
        }
    }
}
