/**
 * SPDX-License-Identifier: MIT
 * SPDX-FileCopyrightText: 2024 NodeCalculate Team
 * SPDX-FileCopyrightText: 2024 Pavel Fomin
 *
 * @file    stringNode.js
 * @brief   Компактная нода ввода текста (по образцу NumberNode)
 * @author  Pavel Fomin
 * @version 1.7.15
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

    // Виджет для Доски (см. dashboardNode.js/boardManager.js) - РЕДАКТИРУЕМОЕ
    // поле (input, не текст, Раунд 37) - тот же приём, что у NumberNode:
    // правки сразу пишутся в this.value через тот же setValue(), которым
    // пользуется поле ввода самой ноды в графе. mousedown/click
    // останавливают всплытие - иначе клик в поле триггерил бы
    // selectWidget() -> пересборку Доски прямо в момент получения фокуса
    // (см. подробный комментарий в numberNode.js).
    // Виджет для Доски (см. dashboardNode.js/boardManager.js) - РЕДАКТИРУЕМОЕ
    // поле, правки через ctx.onEdit пишут в DashboardNode, а не в эту
    // ноду (Раунд 38, см. докстринг DashboardNode - раньше правки шли
    // напрямую в this.setValue(), меняя ноду и всё, куда она ещё
    // подключена в обход Доски).
    getDashboardWidget(ctx = {}) {
        const node = this;
        const displayValue = ctx.overrideValue !== undefined ? ctx.overrideValue : node.value;
        return {
            type: 'string',
            title: this.customName || null,
            render: (container) => {
                if (ctx.readOnly) {
                    const el = document.createElement('div');
                    el.className = 'board-widget-string';
                    el.textContent = displayValue || '—';
                    container.appendChild(el);
                    return;
                }

                const input = document.createElement('input');
                input.type = 'text';
                input.className = 'board-widget-string board-widget-string-input';
                input.value = displayValue || '';
                input.placeholder = 'Текст…';

                input.addEventListener('focus', () => input.select());
                input.addEventListener('input', (e) => {
                    if (ctx.onEdit) ctx.onEdit(e.target.value);
                    else node.setValue(e.target.value);
                });
                input.addEventListener('mousedown', (e) => e.stopPropagation());
                input.addEventListener('click', (e) => e.stopPropagation());

                container.appendChild(input);
            }
        };
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
