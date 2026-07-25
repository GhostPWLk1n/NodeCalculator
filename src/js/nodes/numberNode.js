/**
 * SPDX-License-Identifier: MIT
 * SPDX-FileCopyrightText: 2024 NodeCalculate Team
 * SPDX-FileCopyrightText: 2024 Pavel Fomin
 *
 * @file    numberNode.js
 * @brief   Компактная нода с ручным вводом числа и одним выходом
 * @author  Pavel Fomin
 * @version 1.4.0
 * @see     https://github.com/GhostPWLk1n/NodeCalculator.git
 */

import { BaseNode } from './baseNode.js';
import { Helpers } from '../utils/helpers.js';
import { ListData } from '../utils/dataTypes.js';
import { SocketFactory } from '../utils/socketFactory.js';

const STEP = 0.5;

export class NumberNode extends BaseNode {
    constructor(id, type, x, y, config = {}) {
        super(id, type, x, y, config);
        this.outputs = 1;
        this.value = config.value !== undefined ? config.value : 0;
        this.displayName = config.displayName || config.customName || 'Число';
        this.listData = new ListData();
        // Важно: при создании ноды она не должна быть свернутой по умолчанию
        this.collapsed = config.collapsed || false;
    }
    
    createContent() {
        const content = document.createElement('div');
        content.className = 'node-content';

        // Если нода свернута - контент пустой (скрывается через CSS)
        // Но структура должна оставаться, чтобы при разворачивании все восстановилось
        
        // === КНОПКА "-" ===
        const minusBtn = document.createElement('button');
        minusBtn.textContent = '−';
        minusBtn.className = 'number-btn-compact minus';
        minusBtn.title = `-${STEP}`;
        
        // === ПОЛЕ ВВОДА ===
        // ВАЖНО: нативные стрелочки браузера у input[type=number] скрыты
        // через CSS (см. styles.css, .number-input-compact::-webkit-*).
        // Раньше они дублировали функциональность кастомных кнопок -+
        // (два разных способа изменить значение в одном и том же месте,
        // с разным и не очевидным шагом). Теперь единственный способ
        // менять значение стрелками - кастомные кнопки с шагом 0.5;
        // прямой ввод с клавиатуры по-прежнему работает как раньше.
        const input = document.createElement('input');
        input.className = 'number-input-compact';
        input.type = 'number';
        input.value = this.value || 0;
        input.step = String(STEP);
        input.placeholder = '0';
        
        input.addEventListener('focus', () => input.select());
        
        input.addEventListener('input', (e) => {
            const val = parseFloat(e.target.value);
            if (!isNaN(val)) {
                this.setValue(val);
            }
        });
        
        // === КНОПКА "+" ===
        const plusBtn = document.createElement('button');
        plusBtn.textContent = '+';
        plusBtn.className = 'number-btn-compact plus';
        plusBtn.title = `+${STEP}`;
        
        // === ЛОГИКА КНОПОК (шаг 0.5) ===
        minusBtn.addEventListener('click', () => {
            const current = parseFloat(input.value) || 0;
            const newVal = this.roundStep(current - STEP);
            input.value = newVal;
            this.setValue(newVal);
        });
        
        plusBtn.addEventListener('click', () => {
            const current = parseFloat(input.value) || 0;
            const newVal = this.roundStep(current + STEP);
            input.value = newVal;
            this.setValue(newVal);
        });
        
        // Поддержка колесика мыши для изменения значения (тот же шаг 0.5)
        input.addEventListener('wheel', (e) => {
            e.preventDefault();
            const delta = e.deltaY > 0 ? -STEP : STEP;
            const current = parseFloat(input.value) || 0;
            const newVal = this.roundStep(current + delta);
            input.value = newVal;
            this.setValue(newVal);
        });
        
        // === СБОРКА ===
        content.appendChild(minusBtn);
        content.appendChild(input);
        content.appendChild(plusBtn);
        
        // === ВЫХОДНОЙ СОКЕТ ===
        const socketContainer = document.createElement('div');
        socketContainer.className = 'number-node-socket-container';
        
        const socket = SocketFactory.createSocket({
            nodeId: this.id,
            socketType: 'output',
            index: 0,
            isList: false
        });
        
        socketContainer.appendChild(socket);
        content.appendChild(socketContainer);
        
        // Сохраняем ссылку на input для updateDisplay
        this._inputElement = input;
        
        // Инициализируем listData
        this.updateListData();
        
        return content;
    }
    
    roundStep(value) {
        // Округляем до сотых, чтобы избежать артефактов плавающей точки
        // (0.1 + 0.2 и т.п.) при многократном шаге 0.5
        return Math.round(value * 100) / 100;
    }
    
    setValue(val) {
        this.value = val;
        this.updateListData();
        
        const valueDisplay = document.querySelector(`[data-node-id="${this.id}"] .node-value-display`);
        if (valueDisplay) {
            valueDisplay.textContent = Helpers.formatNumber(val);
        }
        
        if (window.nodeManager) {
            window.nodeManager.calculateAll();
        }
    }
    
    updateListData() {
        // Получаем имя для отображения
        const name = this.customName || this.displayName || 'Число';
        this.listData = new ListData(
            [{ name: name, value: this.value || 0 }],
            { 
                title: name,
                total: this.value || 0
            }
        );
    }
    
    calculate(nodeManager) {
        // Обновляем listData при вычислении
        this.updateListData();
        return this.value;
    }

    // Дополняем базовую схему боковой панели (имя, цвет) полем формата
    // значения - именно та "тонкая настройка", которую решили не
    // выносить в саму ноду, а держать в боковой панели (см.
    // docs/NODE_API.md, раздел про BaseNode.getValueFormat()).
    getInspectorSchema() {
        const fields = super.getInspectorSchema();
        fields.push({
            key: 'valueFormat',
            label: 'Формат значения',
            type: 'select',
            options: [
                { value: '', label: 'Число' },
                { value: 'currency', label: 'Деньги' },
                { value: 'percent', label: 'Проценты' }
            ],
            get: () => this.valueFormat || '',
            set: (v) => { this.valueFormat = v || null; }
        });
        return fields;
    }

    // Виджет для Доски (см. dashboardNode.js/boardManager.js) - крупное
    // число, отформатированное согласно getValueFormat() (та же логика,
    // что уже применяют TableNode-столбцы с форматом "Авто")
    getDashboardWidget() {
        const value = this.value;
        return {
            type: 'number',
            title: this.customName || null,
            render: (container) => {
                const el = document.createElement('div');
                el.className = 'board-widget-number';
                el.textContent = typeof value === 'number'
                    ? Helpers.formatByType(value, this.getValueFormat())
                    : '—';
                container.appendChild(el);
            }
        };
    }
    
    updateDisplay(element) {
        // Обновляем поле ввода только если оно существует и не в фокусе
        const input = element.querySelector('.number-input-compact');
        if (input && this.value !== undefined && this.value !== null) {
            if (document.activeElement !== input) {
                input.value = this.value;
            }
        }
        
        // Обновляем отображение значения
        const valueDisplay = element.querySelector('.node-value-display');
        if (valueDisplay) {
            valueDisplay.textContent = Helpers.formatNumber(this.value);
        }
    }
    
    updateValueFromInput() {
        const el = document.querySelector(`[data-node-id="${this.id}"]`);
        if (el) {
            const input = el.querySelector('.number-input-compact');
            if (input) {
                const val = parseFloat(input.value);
                if (!isNaN(val)) {
                    this.value = val;
                    this.updateListData();
                    return val;
                }
            }
        }
        return this.value;
    }

    // Переопределяем toggleCollapse для корректной работы с компактной нодой
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
            
            // Для NumberNode важно сохранить компактность при разворачивании
            if (!this.collapsed && this.type === 'number') {
                el.classList.add('number-node-compact');
            }
        }
        
        // Пересчитываем линии
        if (window.renderer) {
            window.renderer.drawAllConnections(window.connectionManager?.getConnections() || []);
        }
        
        // Обновляем отображение (чтобы восстановить содержимое)
        if (window.renderer) {
            window.renderer.updateAllDisplays();
        }
    }
}
