/**
 * SPDX-License-Identifier: MIT
 * SPDX-FileCopyrightText: 2024 NodeCalculate Team
 * SPDX-FileCopyrightText: 2024 Pavel Fomin
 *
 * @file    listInputNode.js
 * @brief   Нода ручного ввода списка пар «имя — значение»
 * @author  Pavel Fomin
 * @version 1.8.94
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

        // Тип данных значения (Раунд 56) - 'number'|'string'|'boolean' -
        // меняет ТИП поля ввода в строке (число/текст/чекбокс) и формат
        // столбца, если этот список попадёт в TableNode - см.
        // getValueFormat()/renderRows()/getDashboardWidget() ниже. Формат
        // деньги/проценты (valueFormat) имеет смысл ТОЛЬКО при
        // dataType==='number' - для строки/булева просто игнорируется.
        this.dataType = config.dataType || 'number';

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

            const valueInput = this.buildValueInput(item, (newValue) => {
                item.value = newValue;
                this.recalculate();
            });
            if (this.valueColumnWidth && valueInput.tagName === 'INPUT') {
                valueInput.style.flex = `0 0 ${this.valueColumnWidth}px`;
            }

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

    // Строит поле ввода значения ПОД ТЕКУЩИЙ this.dataType - число/текст/
    // чекбокс (Раунд 56). onChange получает уже ПРИВЕДЁННОЕ к нужному типу
    // значение - вызывающий код (renderRows()/getDashboardWidget()) просто
    // присваивает его как есть, без разбора типа на своей стороне.
    buildValueInput(item, onChange) {
        if (this.dataType === 'boolean') {
            const wrap = document.createElement('label');
            wrap.className = 'list-input-value list-input-value-boolean';
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.checked = Helpers.coerceBool(item.value);
            checkbox.addEventListener('mousedown', (e) => e.stopPropagation());
            checkbox.addEventListener('change', (e) => onChange(e.target.checked));
            wrap.appendChild(checkbox);
            return wrap;
        }

        if (this.dataType === 'string') {
            const input = document.createElement('input');
            input.type = 'text';
            input.className = 'list-input-value';
            input.value = typeof item.value === 'string' ? item.value : String(item.value ?? '');
            input.placeholder = 'Значение';
            input.addEventListener('mousedown', (e) => e.stopPropagation());
            input.addEventListener('input', (e) => onChange(e.target.value));
            return input;
        }

        // 'number' - по умолчанию, как и было раньше
        const input = document.createElement('input');
        input.type = 'number';
        input.step = 'any';
        input.className = 'list-input-value';
        input.value = typeof item.value === 'number' ? item.value : 0;
        input.placeholder = '0';
        input.addEventListener('mousedown', (e) => e.stopPropagation());
        input.addEventListener('input', (e) => {
            const val = parseFloat(e.target.value);
            onChange(isNaN(val) ? 0 : val);
        });
        return input;
    }

    // Приводит ВСЕ уже введённые значения к новому типу при смене
    // dataType в панели - иначе, скажем, переключение с "Число" на
    // "Логическое" оставило бы в this.items сырые числа, а тело/виджет
    // ноды уже рисовали бы чекбоксы поверх них без пересчёта
    coerceItemsToDataType() {
        this.items.forEach(item => {
            if (this.dataType === 'boolean') {
                item.value = Helpers.coerceBool(item.value);
            } else if (this.dataType === 'string') {
                item.value = typeof item.value === 'string' ? item.value : String(item.value ?? '');
            } else {
                const num = typeof item.value === 'number' ? item.value : parseFloat(item.value);
                item.value = isNaN(num) ? 0 : num;
            }
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
        const defaultValue = this.dataType === 'boolean' ? false : (this.dataType === 'string' ? '' : 0);
        this.items.push({
            id: Helpers.generateId(),
            name: `Элемент ${this.items.length + 1}`,
            value: defaultValue
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

    // Формат для чисел (деньги/проценты/авто) выбирается в панели
    // (this.valueFormat) и имеет смысл ТОЛЬКО при dataType==='number' -
    // для текста/булевых значений формат жёстко следует из dataType,
    // выбор в панели для них скрыт (см. getInspectorSchema())
    getValueFormat() {
        if (this.dataType === 'string') return 'text';
        if (this.dataType === 'boolean') return 'boolean';
        return this.valueFormat || 'number';
    }

    updateListData() {
        const format = this.getValueFormat();
        this.listData = new ListData(
            this.items.map(item => ({
                name: item.name || 'unknown',
                value: item.value,
                format
            })),
            {
                title: this.customName || 'Список',
                // "Итого" имеет смысл только для чисел - для текста/
                // булевых значений суммировать нечего (Раунд 56)
                total: this.dataType === 'number'
                    ? this.items.reduce((sum, item) => sum + (typeof item.value === 'number' ? item.value : 0), 0)
                    : 0,
                isFullList: true,
                format
            }
        );
    }

    calculate(nodeManager) {
        this.updateListData();
        // Для чисел - сумма (как и раньше); для текста/булевых значений
        // сумма бессмысленна - отдаём количество элементов (Раунд 56)
        return this.dataType === 'number' ? this.listData.total : this.items.length;
    }

    updateDisplay(element) {
        const countDisplay = element.querySelector('.list-input-count');
        if (countDisplay) {
            countDisplay.textContent = `${this.items.length} эл.`;
        }
    }

    // Виджет для Доски (см. dashboardNode.js/boardManager.js) - РЕДАКТИРУЕМАЯ
    // таблица "имя - значение" (Раунд 37): те же два input на строку, что
    // и в теле самой ноды (renderRows выше), правки сразу пишут в
    // this.items и вызывают recalculate() (updateListData +
    // nodeManager.calculateAll(), тот же путь, что и в графе). mousedown/
    // click на каждом поле останавливают всплытие - иначе клик триггерил
    // бы selectWidget() -> пересборку Доски прямо в момент получения
    // фокуса (см. подробный комментарий в numberNode.js).
    //
    // Добавление/удаление строк прямо с Доски - осознанно не в этом
    // раунде (см. "Заметки на будущее" в CHANGES.md), сейчас можно менять
    // только значения уже существующих строк.
    // Виджет для Доски (см. dashboardNode.js/boardManager.js) - таблица с
    // ДВУМЯ input на строку (имя + значение), правки через ctx.onEdit
    // пишут в DashboardNode (передаётся ПОЛНЫЙ обновлённый массив), а не
    // в this.items (Раунд 38, см. докстринг DashboardNode - раньше
    // правки шли напрямую в саму ноду, меняя её и всё, куда она ещё
    // подключена в обход Доски). ctx.overrideValue, если задан - это
    // массив {name,value}, переопределённый на Доске, вместо this.items.
    //
    // Добавление/удаление строк прямо с Доски - осознанно не в этом
    // раунде (см. "Заметки на будущее" в CHANGES.md), сейчас можно менять
    // только значения уже существующих строк.
    getDashboardWidget(ctx = {}) {
        const node = this;
        const format = this.getValueFormat();
        const sourceItems = Array.isArray(ctx.overrideValue) ? ctx.overrideValue : node.items;

        return {
            type: 'list',
            title: this.customName || 'Список',
            render: (container) => {
                const table = document.createElement('table');
                table.className = 'board-widget-list';

                if (ctx.readOnly) {
                    sourceItems.forEach(item => {
                        const row = document.createElement('tr');
                        const nameCell = document.createElement('td');
                        nameCell.textContent = item.name || '';
                        const valueCell = document.createElement('td');

                        // Раунд 56 - вид значения зависит от dataType, а не
                        // просто от того, число это или нет
                        if (node.dataType === 'boolean') {
                            const checkbox = document.createElement('input');
                            checkbox.type = 'checkbox';
                            checkbox.className = 'table-cell-checkbox';
                            checkbox.checked = Helpers.coerceBool(item.value);
                            checkbox.disabled = true;
                            valueCell.appendChild(checkbox);
                        } else if (node.dataType === 'string') {
                            valueCell.textContent = String(item.value ?? '');
                        } else {
                            valueCell.textContent = typeof item.value === 'number'
                                ? Helpers.formatByType(item.value, format)
                                : String(item.value ?? '');
                        }

                        row.appendChild(nameCell);
                        row.appendChild(valueCell);
                        table.appendChild(row);
                    });
                    container.appendChild(table);
                    return;
                }

                // Рабочая копия строк - каждая правка шлёт ПОЛНЫЙ массив
                // через ctx.onEdit (DashboardNode сам решает, что с ним
                // делать - см. calculate() там), this.items не трогаем
                const workingItems = sourceItems.map(i => ({ name: i.name, value: i.value }));
                const emitChange = () => {
                    if (ctx.onEdit) ctx.onEdit(workingItems.map(i => ({ ...i })));
                    else node.recalculate();
                };

                workingItems.forEach((item, idx) => {
                    const row = document.createElement('tr');

                    const nameCell = document.createElement('td');
                    const nameInput = document.createElement('input');
                    nameInput.type = 'text';
                    nameInput.className = 'board-widget-list-input';
                    nameInput.value = item.name || '';
                    nameInput.addEventListener('mousedown', (e) => e.stopPropagation());
                    nameInput.addEventListener('click', (e) => e.stopPropagation());
                    nameInput.addEventListener('input', (e) => {
                        item.name = e.target.value;
                        if (ctx.onEdit) emitChange();
                        else { node.items[idx].name = e.target.value; node.recalculate(); }
                    });
                    nameCell.appendChild(nameInput);

                    const valueCell = document.createElement('td');
                    const applyValueChange = (newValue) => {
                        item.value = newValue;
                        if (ctx.onEdit) emitChange();
                        else { node.items[idx].value = newValue; node.recalculate(); }
                    };

                    // Раунд 56 - тип поля редактирования зависит от dataType
                    if (node.dataType === 'boolean') {
                        const checkbox = document.createElement('input');
                        checkbox.type = 'checkbox';
                        checkbox.className = 'board-widget-list-input-value';
                        checkbox.checked = Helpers.coerceBool(item.value);
                        checkbox.addEventListener('mousedown', (e) => e.stopPropagation());
                        checkbox.addEventListener('click', (e) => e.stopPropagation());
                        checkbox.addEventListener('change', (e) => applyValueChange(e.target.checked));
                        valueCell.appendChild(checkbox);
                    } else if (node.dataType === 'string') {
                        const valueInput = document.createElement('input');
                        valueInput.type = 'text';
                        valueInput.className = 'board-widget-list-input board-widget-list-input-value';
                        valueInput.value = typeof item.value === 'string' ? item.value : String(item.value ?? '');
                        valueInput.addEventListener('mousedown', (e) => e.stopPropagation());
                        valueInput.addEventListener('click', (e) => e.stopPropagation());
                        valueInput.addEventListener('input', (e) => applyValueChange(e.target.value));
                        valueCell.appendChild(valueInput);
                    } else {
                        const valueInput = document.createElement('input');
                        valueInput.type = 'number';
                        valueInput.step = 'any';
                        valueInput.className = 'board-widget-list-input board-widget-list-input-value';
                        valueInput.value = typeof item.value === 'number' ? item.value : 0;
                        valueInput.addEventListener('mousedown', (e) => e.stopPropagation());
                        valueInput.addEventListener('click', (e) => e.stopPropagation());
                        valueInput.addEventListener('input', (e) => {
                            const val = parseFloat(e.target.value);
                            applyValueChange(isNaN(val) ? 0 : val);
                        });
                        valueCell.appendChild(valueInput);
                    }

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
            key: 'dataType',
            label: 'Тип данных значения',
            type: 'select',
            options: [
                { value: 'number', label: 'Число' },
                { value: 'string', label: 'Строка' },
                { value: 'boolean', label: 'Логическое' }
            ],
            get: () => this.dataType,
            set: (v) => {
                this.dataType = v;
                this.coerceItemsToDataType();
                this.updateListData();
                const el = document.querySelector(`[data-node-id="${this.id}"]`);
                const rowsContainer = el?.querySelector('.list-input-rows');
                if (rowsContainer) this.renderRows(rowsContainer);
                if (window.nodeManager) window.nodeManager.calculateAll();
            }
        });

        // Формат деньги/проценты имеет смысл ТОЛЬКО для чисел - для
        // строки/булева значения он просто не показывается (Раунд 56)
        if (this.dataType === 'number') {
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
        }

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
