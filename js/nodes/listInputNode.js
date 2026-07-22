import { BaseNode } from './baseNode.js';
import { Helpers } from '../utils/helpers.js';
import { ListData } from '../utils/dataTypes.js';
import { SocketFactory } from '../utils/socketFactory.js';

/**
 * ListInputNode - ручной ввод списка пар "Имя - Аргумент".
 * Источник данных (как NumberNode, но сразу целый список), без входов.
 * Единственный выход - LIST сокет с готовым ListData.
 */
export class ListInputNode extends BaseNode {
    constructor(id, type, x, y, config = {}) {
        super(id, type, x, y, config);
        this.outputs = 1;
        this.inputs = 0;
        this.width = config.width || 240;
        this.items = config.items && config.items.length
            ? config.items.map(item => ({ id: Helpers.generateId(), name: item.name, value: item.value }))
            : [{ id: Helpers.generateId(), name: 'Элемент 1', value: 0 }];
        this.listData = new ListData();
        this.updateListData();
    }

    createContent() {
        const content = document.createElement('div');
        content.className = 'node-content';
        content.style.minWidth = this.width + 'px';

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
        `;
        outputRow.appendChild(label);

        const countDisplay = document.createElement('span');
        countDisplay.className = 'list-input-count';
        countDisplay.style.cssText = `
            color: #4fc3f7;
            font-size: 12px;
            font-weight: 500;
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
        this.listData = new ListData(
            this.items.map(item => ({
                name: item.name || 'unknown',
                value: typeof item.value === 'number' ? item.value : 0
            })),
            {
                title: this.customName || 'Список',
                total: this.items.reduce((sum, item) => sum + (item.value || 0), 0),
                isFullList: true
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
}
