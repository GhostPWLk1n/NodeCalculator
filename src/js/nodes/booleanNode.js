/**
 * SPDX-License-Identifier: MIT
 * SPDX-FileCopyrightText: 2024 NodeCalculate Team
 * SPDX-FileCopyrightText: 2024 Pavel Fomin
 *
 * @file    booleanNode.js
 * @brief   Компактная нода ввода истина/ложь (по образцу NumberNode/StringNode)
 * @author  Pavel Fomin
 * @version 1.8.64
 * @see     https://github.com/GhostPWLk1n/NodeCalculator.git
 */

import { BaseNode } from './baseNode.js';
import { SocketFactory } from '../utils/socketFactory.js';

/**
 * BooleanNode - ввод истина/ложь (по аналогии с NumberNode/StringNode).
 * Один переключатель-пилюля, один выход типа Bool (ромб, розовый сокет,
 * Раунд 48). Используется как источник логического значения - например,
 * условие для BooleanOperationNode или флаг для TableFilterNode.
 */
export class BooleanNode extends BaseNode {
    constructor(id, type, x, y, config = {}) {
        super(id, type, x, y, config);
        this.outputs = 1;
        this.value = config.value !== undefined ? !!config.value : false;
        this.displayName = config.displayName || config.customName || 'Булево';
        this.collapsed = config.collapsed || false;
    }

    createContent() {
        const content = document.createElement('div');
        content.className = 'node-content';

        // === ПЕРЕКЛЮЧАТЕЛЬ ===
        const toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.className = 'boolean-toggle-compact';
        toggle.setAttribute('aria-pressed', String(this.value));
        toggle.title = 'Переключить истина/ложь';

        const knob = document.createElement('span');
        knob.className = 'boolean-toggle-knob';
        toggle.appendChild(knob);

        // Клик по кнопке не должен таскать ноду мышью (та же ловушка,
        // что и у полей ввода Числа/Строки - без stopPropagation клик
        // по переключателю запустил бы drag самой ноды)
        toggle.addEventListener('mousedown', (e) => e.stopPropagation());
        toggle.addEventListener('click', (e) => {
            e.stopPropagation();
            this.setValue(!this.value);
        });

        content.appendChild(toggle);

        // === ПОДПИСЬ ТЕКУЩЕГО ЗНАЧЕНИЯ ===
        const label = document.createElement('span');
        label.className = 'boolean-toggle-label';
        label.textContent = this.value ? 'ИСТИНА' : 'ЛОЖЬ';
        content.appendChild(label);

        // === ВЫХОДНОЙ СОКЕТ ===
        const socketContainer = document.createElement('div');
        socketContainer.className = 'boolean-node-socket-container';

        const socket = SocketFactory.createSocket({
            nodeId: this.id,
            socketType: 'output',
            index: 0,
            isBool: true,
            title: 'Bool (истина/ложь)'
        });

        socketContainer.appendChild(socket);
        content.appendChild(socketContainer);

        this._toggleElement = toggle;
        this._labelElement = label;

        return content;
    }

    setValue(val) {
        this.value = !!val;

        if (window.nodeManager) {
            window.nodeManager.calculateAll();
        }
    }

    calculate() {
        // Булево значение - конечный продукт, никаких listData/resultListData не нужно
        return this.value;
    }

    // Виджет для Доски (см. dashboardNode.js/boardManager.js) - тот же
    // переключатель-пилюля, что и в теле ноды графа, только крупнее -
    // РЕДАКТИРУЕМЫЙ, правки идут через ctx.onEdit в DashboardNode, а не
    // напрямую в эту ноду (тот же принцип, что у NumberNode/StringNode
    // с Раунда 38 - см. докстринг DashboardNode про то, почему).
    getDashboardWidget(ctx = {}) {
        const node = this;
        const displayValue = ctx.overrideValue !== undefined ? !!ctx.overrideValue : node.value;
        return {
            type: 'boolean',
            title: this.customName || null,
            render: (container) => {
                const wrap = document.createElement('div');
                wrap.className = 'board-widget-boolean';

                const toggle = document.createElement('button');
                toggle.type = 'button';
                toggle.className = 'board-widget-boolean-toggle';
                toggle.setAttribute('aria-pressed', String(displayValue));
                if (ctx.readOnly) toggle.disabled = true;

                const knob = document.createElement('span');
                knob.className = 'board-widget-boolean-knob';
                toggle.appendChild(knob);

                toggle.addEventListener('mousedown', (e) => e.stopPropagation());
                toggle.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (ctx.readOnly) return;
                    const next = !displayValue;
                    if (ctx.onEdit) ctx.onEdit(next);
                    else node.setValue(next);
                });

                const label = document.createElement('span');
                label.className = 'board-widget-boolean-label';
                label.textContent = displayValue ? 'ИСТИНА' : 'ЛОЖЬ';

                wrap.appendChild(toggle);
                wrap.appendChild(label);
                container.appendChild(wrap);
            }
        };
    }

    updateDisplay(element) {
        const toggle = element.querySelector('.boolean-toggle-compact');
        if (toggle) toggle.setAttribute('aria-pressed', String(this.value));

        const label = element.querySelector('.boolean-toggle-label');
        if (label) label.textContent = this.value ? 'ИСТИНА' : 'ЛОЖЬ';
    }

    // Переопределяем toggleCollapse по образцу NumberNode/StringNode -
    // чтобы компактный вид корректно восстанавливался при разворачивании
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

            if (!this.collapsed && this.type === 'boolean') {
                el.classList.add('boolean-node-compact');
            }
        }

        if (window.renderer) {
            window.renderer.drawAllConnections(window.connectionManager?.getConnections() || []);
            window.renderer.updateAllDisplays();
        }
    }
}
