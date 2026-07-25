/**
 * SPDX-License-Identifier: MIT
 * SPDX-FileCopyrightText: 2024 NodeCalculate Team
 * SPDX-FileCopyrightText: 2024 Pavel Fomin
 *
 * @file    listInputNode.js
 * @brief   Нода ручного ввода списка пар «имя — значение»
 * @author  Pavel Fomin
 * @version 1.4.0
 * @see     https://github.com/GhostPWLk1n/NodeCalculator.git
 */

import { BaseNode } from './baseNode.js';
import { Helpers } from '../utils/helpers.js';
import { ListData } from '../utils/dataTypes.js';
import { SocketFactory } from '../utils/socketFactory.js';

/**
 * ListInputNode - ручной ввод списка пар "Имя - Аргумент".
 * Источник данных (как NumberNode, но сразу целый список), без входов.
 * Единственный выход - LIST сокет с готовым ListData.
 *
 * Оформление (формат значений, ширина полей имени/значения) - в боковой
 * панели (getInspectorSchema()), не в теле ноды. Формат прокидывается в
 * каждый элемент ListData и в саму ноду через getValueFormat() (см.
 * baseNode.js) - потребители с форматом "Авто" (TableNode-столбец и
 * т.п.) подхватывают его сами.
 *
 * Тело ноды не задаёт своего искусственного min-width - подстраивается
 * под любую ширину ноды вплоть до общего минимума 200px (см.
 * docs/NODE_API.md).
 */
export class ListInputNode extends BaseNode {
    constructor(id, type, x, y, config = {}) {
        super(id, type, x, y, config);
        this.outputs = 1;
        this.inputs = 0;
        this.width = config.width || 220;
        this.items = config.items && config.items.length
            ? config.items.map(item => ({ id: Helpers.generateId(), name: item.name, value: item.value }))
            : [{ id: Helpers.generateId(), name: 'Элемент 1', value: 0 }];

        // Ширина полей имени/значения в строках ввода, px - null = авто
        // (стандартное соотношение flex 1.4/1 из CSS). Настраивается из
        // боковой панели - см. getInspectorSchema()/applyColumnWidths().
        this.nameColumnWidth = config.nameColumnWidth ?? null;
        this.valueColumnWidth = config.valueColumnWidth ?? null;

        this.listData = new ListData();
        this.updateListData();
    }

    createContent() {
        const content = document.createElement('div');
        content.className = 'node-content';
        content.style.cssText = `
            width: 100%;
            min-width: 150px;
        `;

        const rowsContainer = document.createElement('div');
        rowsContainer.className = 'list-input-rows';
        this.renderRows(rowsContainer);
        content.appendChild(rowsContainer);

        const addBtn = document.createElement('button');
        addBtn.className = 'add-input-btn';
        addBtn.textContent = '➕ Добавить строку';
        addBtn.addEventListener('mousedown', (e) => e.stopPropagation());
        addBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.addRow(rowsContainer);
        });
        content.appendChild(addBtn);

        // === ВЫХОДНОЙ СОКЕТ ===
        const outputRow = document.createElement('div');
        outputRow.className = 'node-output';
        outputRow.style.cssText = `
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 6px 0 2px 0;
            margin-top: 8px;
            border-top: 1px solid var(--md-divider);
        `;

        const label = document.createElement('label');
        label.textContent = 'Список (LIST):';
        label.style.cssText = `
            color: var(--md-text-secondary);
            font-size: 11px;
            flex: 1;
            min-width: 0;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        `;
        outputRow.appendChild(label);

        const countDisplay = document.createElement('span');
        countDisplay.className = 'list-input-count';
        countDisplay.style.cssText = `
            color: #4fc3f7;
            font-size: 12px;
            font-weight: 500;
            flex-shrink: 0;
        `;
        countDisplay.textContent = `${this.items.length} эл.`;
        outputRow.appendChild(countDisplay);

        const socket = SocketFactory.createSocket({
            nodeId: this.id,
            socketType: 'output',
            index: 0,
            isList: true,
            title: 'Выходной список (LIST)'
        });
        outputRow.appendChild(socket);

        content.appendChild(outputRow);

        return content;
    }

    renderRows(container) {
        container.innerHTML = '';

        this.items.forEach((item) => {
            const row = document.createElement('div');
            row.className = 'list-input-row';
            row.dataset.rowId = item.id;

            const nameInput = document.createElement('input');
            nameInput.type = 'text';
            nameInput.className = 'list-input-name';
            nameInput.value = item.name;
            nameInput.placeholder = 'Имя';
            if (this.nameColumnWidth) nameInput.style.flex = `0 0 ${this.nameColumnWidth}px`;
            nameInput.addEventListener('mousedown', (e) => e.stopPropagation());
            nameInput.addEventListener('input', (e) => {
                item.name = e.target.value;
                this.recalculate();
            });

            const valueInput = document.createElement('input');
            valueInput.type = 'number';
            valueInput.step = 'any';
            valueInput.className = 'list-input-value';
            valueInput.value = item.value;
            valueInput.placeholder = '0';
            if (this.valueColumnWidth) valueInput.style.flex = `0 0 ${this.valueColumnWidth}px`;
            valueInput.addEventListener('mousedown', (e) => e.stopPropagation());
            valueInput.addEventListener('input', (e) => {
                const val = parseFloat(e.target.value);
                item.value = isNaN(val) ? 0 : val;
                this.recalculate();
            });

            row.appendChild(nameInput);
            row.appendChild(valueInput);

            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'delete-input-btn';
            deleteBtn.textContent = '✕';
            deleteBtn.style.display = this.items.length > 1 ? 'inline-block' : 'none';
            deleteBtn.addEventListener('mousedown', (e) => e.stopPropagation());
            deleteBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.removeRow(item.id, container);
            });
            row.appendChild(deleteBtn);

            container.appendChild(row);
        });
    }

    // Применяет текущую ширину полей имени/значения к УЖЕ отрисованным
    // строкам без пересоздания DOM - вызывается из боковой панели, чтобы
    // изменение ширины было видно сразу.
    applyColumnWidths() {
        const el = document.querySelector(`[data-node-id="${this.id}"]`);
        if (!el) return;
        el.querySelectorAll('.list-input-name').forEach(input => {
            input.style.flex = this.nameColumnWidth ? `0 0 ${this.nameColumnWidth}px` : '';
        });
        el.querySelectorAll('.list-input-value').forEach(input => {
            input.style.flex = this.valueColumnWidth ? `0 0 ${this.valueColumnWidth}px` : '';
        });
    }

    addRow(container) {
        this.items.push({
            id: Helpers.generateId(),
            name: `Элемент ${this.items.length + 1}`,
            value: 0
        });
        this.renderRows(container);
        this.recalculate();
    }

    removeRow(rowId, container) {
        if (this.items.length <= 1) return;
        this.items = this.items.filter(item => item.id !== rowId);
        this.renderRows(container);
        this.recalculate();
    }

    recalculate() {
        this.updateListData();
        if (window.nodeManager) {
            window.nodeManager.calculateAll();
        }
    }

    updateListData() {
        const format = this.getValueFormat();
        this.listData = new ListData(
            this.items.map(item => ({
                name: item.name || 'unknown',
                value: typeof item.value === 'number' ? item.value : 0,
                format
            })),
            {
                title: this.customName || 'Список',
                total: this.items.reduce((sum, item) => sum + (item.value || 0), 0),
                isFullList: true,
                format
            }
        );
    }

    calculate(nodeManager) {
        this.updateListData();
        return this.listData.total;
    }

    updateDisplay(element) {
        const countDisplay = element.querySelector('.list-input-count');
        if (countDisplay) {
            countDisplay.textContent = `${this.items.length} эл.`;
        }
    }

    // Виджет для Доски (см. dashboardNode.js/boardManager.js) - простая
    // таблица "имя - значение", формат ячеек значения - по getValueFormat()
    getDashboardWidget() {
        const items = this.items.map(i => ({ name: i.name, value: i.value }));
        const format = this.getValueFormat();
        return {
            type: 'list',
            title: this.customName || 'Список',
            render: (container) => {
                const table = document.createElement('table');
                table.className = 'board-widget-list';
                items.forEach(item => {
                    const row = document.createElement('tr');
                    const nameCell = document.createElement('td');
                    nameCell.textContent = item.name || '';
                    const valueCell = document.createElement('td');
                    valueCell.textContent = typeof item.value === 'number'
                        ? Helpers.formatByType(item.value, format)
                        : String(item.value ?? '');
                    row.appendChild(nameCell);
                    row.appendChild(valueCell);
                    table.appendChild(row);
                });
                container.appendChild(table);
            }
        };
    }

    // Боковая панель: формат значений (прокидывается в getValueFormat() и
    // в каждый элемент ListData) + настраиваемая ширина полей имени/значения.
    getInspectorSchema() {
        const fields = super.getInspectorSchema();

        fields.push({
            key: 'valueFormat',
            label: 'Формат значений',
            type: 'select',
            options: [
                { value: '', label: 'Число' },
                { value: 'currency', label: 'Деньги' },
                { value: 'percent', label: 'Проценты' }
            ],
            get: () => this.valueFormat || '',
            set: (v) => { this.valueFormat = v || null; this.updateListData(); }
        });

        fields.push({ type: 'section', label: 'Размер ячеек' });

        fields.push({
            key: 'nameColumnWidth',
            label: 'Ширина поля имени, px (пусто = авто)',
            type: 'number',
            min: 40, step: 5,
            get: () => this.nameColumnWidth,
            set: (v) => { this.nameColumnWidth = v; this.applyColumnWidths(); }
        });

        fields.push({
            key: 'valueColumnWidth',
            label: 'Ширина поля значения, px (пусто = авто)',
            type: 'number',
            min: 30, step: 5,
            get: () => this.valueColumnWidth,
            set: (v) => { this.valueColumnWidth = v; this.applyColumnWidths(); }
        });

        return fields;
    }
}
