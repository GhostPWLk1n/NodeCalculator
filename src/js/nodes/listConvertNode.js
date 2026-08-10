/**
 * SPDX-License-Identifier: MIT
 * SPDX-FileCopyrightText: 2024 NodeCalculate Team
 * SPDX-FileCopyrightText: 2024 Pavel Fomin
 *
 * @file    listConvertNode.js
 * @brief   "Преобразование списка" - контейнер преобразования Таблица/Список -> редактируемый Список
 * @author  Pavel Fomin
 * @version 1.8.42
 * @see     https://github.com/GhostPWLk1n/NodeCalculator.git
 */

import { BaseNode } from './baseNode.js';
import { Helpers } from '../utils/helpers.js';
import { ListData } from '../utils/dataTypes.js';
import { SocketFactory } from '../utils/socketFactory.js';

/**
 * ListConvertNode ("Преобразование списка") - Раунд 61 (логика
 * переработана по итогам ревью Раунда 59). "Контейнер преобразования" -
 * универсальный адаптер: на входе Таблица ИЛИ уже готовый Список (один
 * universal-сокет, isAny), на выходе ВСЕГДА список - причём,
 * по прямой просьбе Mr.D, РЕДАКТИРУЕМЫЙ прямо в теле ноды и на Доске,
 * как у `ListInputNode` - не просто "посмотреть результат преобразования",
 * а "получить стартовую заготовку и доработать руками".
 *
 * СОХРАНЕНИЕ РУЧНЫХ ПРАВОК МЕЖДУ ПЕРЕСЧЁТАМИ - это ключевое отличие от
 * "просто пересчитывать по формуле" нод. `this.items` (те же {name,
 * value} пары, что и у `ListInputNode`) пересобираются заново ТОЛЬКО
 * когда меняется ЧТО-ТО СТРУКТУРНОЕ у источника - сам источник, режим,
 * выбор столбцов, число строк/столбцов таблицы (см. calculate()/
 * `_buildSignature()`). Если ничего из этого не поменялось - `calculate()`
 * просто пересобирает `listData` ИЗ ТЕКУЩИХ (возможно, отредактированных
 * руками) `this.items`, не трогая их - иначе любая ручная правка
 * стиралась бы уже на следующем пересчёте графа (а он может произойти
 * из-за изменения ЛЮБОЙ другой ноды где угодно на холсте, не обязательно
 * связанной с этой). Кнопка "Обновить из источника" в теле ноды
 * форсирует пересборку, даже если сигнатура не изменилась - на случай,
 * если пользователь всё-таки хочет отбросить правки и начать заново.
 *
 * ТРИ РЕЖИМА (this.mode) - ровно как описал Mr.D:
 *   - 'namesFromColumn' ("Имена из столбца") - выбранный столбец (this.
 *     singleColumn) даёт ИМЕНА элементов, значения пустые (0) - под
 *     ручной ввод.
 *   - 'valuesFromColumn' ("Автоимена + значения из столбца", по
 *     умолчанию) - имена автоматические ("Элемент 1", "Элемент 2"... -
 *     тот же формат, что и у новых строк в `ListInputNode`), значения -
 *     из выбранного столбца (this.singleColumn).
 *   - 'pair' ("Пара имя:значение") - ДВА выбранных столбца
 *     (this.pairNameColumn/this.pairValueColumn) - один даёт имена,
 *     другой значения.
 *
 * Если источник - уже LIST, его элементы просто КОПИРУЮТСЯ в this.items
 * (тоже с сохранением правок при неизменном источнике) - режимы выше не
 * участвуют, конвертировать нечего.
 */
export class ListConvertNode extends BaseNode {
    constructor(id, type, x, y, config = {}) {
        super(id, type, x, y, config);
        this.inputs = 1;
        this.inputSockets = [0];
        this.outputs = 1;
        this.width = config.width || 220;

        this.mode = config.mode || 'valuesFromColumn'; // 'namesFromColumn'|'valuesFromColumn'|'pair'
        this.singleColumn = config.singleColumn ?? 0; // режимы 1 и 2
        this.pairNameColumn = config.pairNameColumn ?? 0; // режим 3
        this.pairValueColumn = config.pairValueColumn ?? 0; // режим 3

        // Принудительный формат значений (Раунд 62) - 'auto'|'boolean'|
        // 'number'|'text'. По умолчанию 'auto' - тип поля ввода/значения
        // определяется ПО ФАКТИЧЕСКОМУ типу пришедшего значения (как и
        // было раньше). Явно выбранный формат ВАЖЕН для чекбоксов - можно
        // заставить нечисловые/небулевы исходные данные показываться
        // чекбоксом. См. _coerceValueToFormat() про правило конфликта
        // (не конвертируется однозначно - Boolean->false, Number->0,
        // Text->'').
        this.dataFormat = config.dataFormat || 'auto';

        this.items = config.items && config.items.length
            ? config.items.map(item => ({ id: Helpers.generateId(), name: item.name, value: item.value }))
            : [];
        // Сигнатура последнего преобразования из источника - см. докстринг
        // класса про то, зачем и как она защищает ручные правки
        this._lastConversionSignature = config._lastConversionSignature || null;

        this._sourceName = null;
        this._sourceKind = null; // 'table'|'list'|null - для тела ноды/панели
        this._inputHeaders = [];
        this.listData = new ListData();
        this._coerceAllItemsToFormat();
        this._syncListDataFromItems();
    }

    createContent() {
        const content = document.createElement('div');
        content.className = 'node-content';
        content.style.cssText = 'width: 100%; min-width: 200px;';

        const inRow = document.createElement('div');
        inRow.style.cssText = 'display:flex; align-items:center; gap:6px;';
        const inSocket = SocketFactory.createSocket({
            nodeId: this.id, socketType: 'input', index: 0, isAny: true,
            title: 'Таблица или Список - источник для преобразования'
        });
        inRow.appendChild(inSocket);
        const sourceLabel = document.createElement('span');
        sourceLabel.className = 'list-convert-source-label';
        sourceLabel.style.cssText = 'color:var(--md-text-secondary); font-size:11px; flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;';
        sourceLabel.textContent = this._sourceName || 'не подключено';
        inRow.appendChild(sourceLabel);

        const refreshBtn = document.createElement('button');
        refreshBtn.className = 'list-convert-refresh-btn';
        refreshBtn.textContent = '↻';
        refreshBtn.title = 'Обновить из источника - отбросить ручные правки и пересобрать список заново';
        refreshBtn.addEventListener('mousedown', (e) => e.stopPropagation());
        refreshBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this._lastConversionSignature = null; // форсируем пересборку на следующем calculate()
            if (window.nodeManager) window.nodeManager.calculateAll();
        });
        inRow.appendChild(refreshBtn);
        content.appendChild(inRow);

        const statusRow = document.createElement('div');
        statusRow.style.cssText = 'padding-left:20px;';
        const statusLabel = document.createElement('span');
        statusLabel.className = 'list-convert-status-label';
        statusLabel.style.cssText = 'color:var(--md-text-disabled); font-size:10px;';
        statusLabel.textContent = this._statusText();
        statusRow.appendChild(statusLabel);
        content.appendChild(statusRow);

        const rowsContainer = document.createElement('div');
        rowsContainer.className = 'list-input-rows';
        rowsContainer.style.cssText = 'margin-top:6px;';
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

        const outRow = document.createElement('div');
        outRow.style.cssText = `
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 6px 0 2px 0;
            margin-top: 8px;
            border-top: 1px solid var(--md-divider);
        `;
        const outLabel = document.createElement('label');
        outLabel.textContent = 'Список (LIST):';
        outLabel.style.cssText = 'color:var(--md-text-secondary); font-size:11px; flex:1;';
        outRow.appendChild(outLabel);
        const outSocket = SocketFactory.createSocket({
            nodeId: this.id, socketType: 'output', index: 0, isList: true,
            title: 'Результат преобразования - редактируемый'
        });
        outRow.appendChild(outSocket);
        content.appendChild(outRow);

        return content;
    }

    // Строки ввода - тот же визуальный/интерактивный паттерн, что у
    // ListInputNode.renderRows(), но тип поля значения определяется ПО
    // ФАКТИЧЕСКОМУ типу значения в элементе (bool -> чекбокс, число ->
    // number, иначе текст), а не отдельным полем dataType на ноде - тут
    // элементы обычно уже одного типа, унаследованного от исходного
    // столбца таблицы.
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
                this._recalculateFromItems();
            });
            row.appendChild(nameInput);

            const valueInput = this._buildValueInput(item, (newValue) => {
                item.value = newValue;
                this._recalculateFromItems();
            });
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

    _buildValueInput(item, onChange) {
        // Раунд 62 - тип поля определяется ПРИНУДИТЕЛЬНО (this.dataFormat),
        // если он не 'auto' - иначе, как и раньше, по фактическому типу
        // значения элемента (см. _effectiveFormatFor(), общая и для тела
        // ноды, и для виджета Доски)
        const effectiveFormat = this._effectiveFormatFor(item.value);

        if (effectiveFormat === 'boolean') {
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

        if (effectiveFormat === 'number') {
            const input = document.createElement('input');
            input.type = 'number';
            input.step = 'any';
            input.className = 'list-input-value';
            input.value = typeof item.value === 'number' ? item.value : (Helpers.strictCoerceNumber(item.value) ?? 0);
            input.addEventListener('mousedown', (e) => e.stopPropagation());
            input.addEventListener('input', (e) => {
                const val = parseFloat(e.target.value);
                onChange(isNaN(val) ? 0 : val);
            });
            return input;
        }

        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'list-input-value';
        input.value = typeof item.value === 'string' ? item.value : String(item.value ?? '');
        input.placeholder = 'Значение';
        input.addEventListener('mousedown', (e) => e.stopPropagation());
        input.addEventListener('input', (e) => onChange(e.target.value));
        return input;
    }

    addRow(container) {
        this.items.push({ id: Helpers.generateId(), name: `Элемент ${this.items.length + 1}`, value: 0 });
        this.renderRows(container);
        this._recalculateFromItems();
    }

    removeRow(rowId, container) {
        if (this.items.length <= 1) return;
        this.items = this.items.filter(item => item.id !== rowId);
        this.renderRows(container);
        this._recalculateFromItems();
    }

    // Багфикс: addRow()/removeRow() меняют высоту ноды (строк стало
    // больше/меньше), а значит и позицию outRow/выходного сокета внизу
    // ноды. calculateAll() -> renderer.updateAllDisplays() обновляет
    // только ТЕКСТ в уже существующем DOM, но НЕ перерисовывает сами
    // SVG-линии соединений (за это отвечает отдельный
    // renderer.drawAllConnections() - вызывается явно, не изнутри
    // calculateAll()). Без этого вызова провод к выходу оставался
    // нарисован на старой позиции - визуально "отрывался" от
    // сдвинувшегося сокета при каждом добавлении/удалении строки. Тот
    // же приём, что уже применён в OperationNode.rerender() для
    // аналогичного случая (динамические сокеты меняют размер ноды).
    _recalculateFromItems() {
        this._syncListDataFromItems();
        if (window.nodeManager) window.nodeManager.calculateAll();
        if (window.renderer) {
            window.renderer.drawAllConnections(window.connectionManager?.getConnections() || []);
        }
    }

    // Приводит ОДНО значение к принудительному формату (this.dataFormat) -
    // 'auto' пропускает значение как есть. Правило конфликта (Раунд 62,
    // по прямому указанию Mr.D) - если значение НЕ приводится однозначно
    // (Helpers.strictCoerceBool()/strictCoerceNumber() вернули null) -
    // Boolean -> false, Number -> 0, Text -> '' (пустая строка), а НЕ
    // тихая догадка вроде Helpers.coerceBool() (тот всегда что-то
    // возвращает, но недостаточно строг для этого явного выбора формата
    // пользователем - если пользователь СКАЗАЛ "это булево поле", молчаливое
    // "предположим true" на мусорных данных было бы хуже, чем явный false).
    _coerceValueToFormat(value) {
        if (this.dataFormat === 'boolean') {
            const b = Helpers.strictCoerceBool(value);
            return b === null ? false : b;
        }
        if (this.dataFormat === 'number') {
            const n = Helpers.strictCoerceNumber(value);
            return n === null ? 0 : n;
        }
        if (this.dataFormat === 'text') {
            return value === null || value === undefined ? '' : String(value);
        }
        return value; // 'auto' - не трогаем
    }

    _coerceAllItemsToFormat() {
        if (this.dataFormat === 'auto') return;
        this.items.forEach(item => { item.value = this._coerceValueToFormat(item.value); });
    }

    _syncListDataFromItems() {
        this.listData = new ListData(
            this.items.map(item => ({ name: item.name || '', value: item.value })),
            { title: this.customName || 'Список', isFullList: true }
        );
    }

    _statusText() {
        if (this._sourceKind === 'list') return `→ из списка · ${this.items.length} эл.`;
        if (this._sourceKind === 'table') {
            const modeLabels = {
                namesFromColumn: 'имена из столбца',
                valuesFromColumn: 'автоимена + значения из столбца',
                pair: 'пара имя:значение'
            };
            return `→ из таблицы (${modeLabels[this.mode] || this.mode}) · ${this.items.length} эл.`;
        }
        return this.items.length > 0 ? `→ без источника · ${this.items.length} эл. (введены вручную)` : '→ не подключено';
    }

    // Род КОНКРЕТНОГО подключённого сокета - см. докстринг класса (Раунд
    // 59) про то, почему это надёжнее, чем смотреть на tableData/listData
    // самой ноды-источника
    static _getSourceSocketKind(conn) {
        if (!conn) return null;
        const socketEl = document.querySelector(
            `[data-node-id="${conn.sourceNodeId}"][data-socket-type="output"][data-index="${conn.sourceSocket || 0}"]`
        );
        return socketEl ? Helpers.getSocketKind(socketEl) : null;
    }

    _buildItemsFromTable(baseTable) {
        const singleCol = Math.max(0, Math.min(baseTable.columns.length - 1, this.singleColumn));
        const nameCol = Math.max(0, Math.min(baseTable.columns.length - 1, this.pairNameColumn));
        const valCol = Math.max(0, Math.min(baseTable.columns.length - 1, this.pairValueColumn));

        const rowCount = baseTable.rowCount;
        const items = [];
        for (let r = 0; r < rowCount; r++) {
            let name, value;
            if (this.mode === 'namesFromColumn') {
                name = String(baseTable.columns[singleCol].values[r] ?? '');
                value = 0;
            } else if (this.mode === 'pair') {
                name = String(baseTable.columns[nameCol].values[r] ?? '');
                value = baseTable.columns[valCol].values[r];
            } else { // 'valuesFromColumn' - по умолчанию
                name = `Элемент ${r + 1}`;
                value = baseTable.columns[singleCol].values[r];
            }
            items.push({ id: Helpers.generateId(), name, value });
        }
        return items;
    }

    calculate(nodeManager) {
        const connections = window.connectionManager?.getConnections() || [];
        const conn = connections.find(c => c.targetNodeId === this.id && c.targetSocket === 0);
        const srcNode = conn ? nodeManager.getNode(conn.sourceNodeId) : null;

        this._sourceName = srcNode ? (srcNode.customName || srcNode.getDisplayName?.() || 'источник') : null;

        if (!srcNode) {
            // Источник отключён - НЕ трогаем this.items (могли быть введены
            // вручную без какого-либо источника вовсе) - просто отдаём то,
            // что уже есть
            this._sourceKind = null;
            this._inputHeaders = [];
            this._syncListDataFromItems();
            this.value = this.items.length;
            return this.value;
        }

        const socketKind = ListConvertNode._getSourceSocketKind(conn);
        let signature;
        let buildFreshItems;

        if (socketKind === 'list') {
            this._sourceKind = 'list';
            this._inputHeaders = [];
            const srcItems = srcNode.listData?.items || [];
            signature = JSON.stringify({ kind: 'list', sourceId: srcNode.id, count: srcItems.length });
            buildFreshItems = () => srcItems.map(i => ({ id: Helpers.generateId(), name: i.name, value: i.value }));
        } else {
            const baseTable = srcNode.tableData;
            if (!baseTable || baseTable.columns.length === 0) {
                this._sourceKind = baseTable ? 'table' : null;
                this._inputHeaders = baseTable ? baseTable.columns.map(c => c.header) : [];
                this._syncListDataFromItems();
                this.value = this.items.length;
                return this.value;
            }
            this._sourceKind = 'table';
            this._inputHeaders = baseTable.columns.map(c => c.header);
            signature = JSON.stringify({
                kind: 'table', sourceId: srcNode.id, mode: this.mode,
                singleColumn: this.singleColumn, pairNameColumn: this.pairNameColumn, pairValueColumn: this.pairValueColumn,
                columnCount: baseTable.columns.length, rowCount: baseTable.rowCount
            });
            buildFreshItems = () => this._buildItemsFromTable(baseTable);
        }

        // Пересобираем ТОЛЬКО если сигнатура реально изменилась - см.
        // докстринг класса про сохранение ручных правок
        if (signature !== this._lastConversionSignature) {
            this.items = buildFreshItems();
            this._coerceAllItemsToFormat();
            this._lastConversionSignature = signature;
        }

        this._syncListDataFromItems();
        this.value = this.items.length;
        return this.value;
    }

    getDisplayName() {
        return this.customName || 'Преобразование списка';
    }

    updateDisplay(element) {
        const sourceLabel = element.querySelector('.list-convert-source-label');
        if (sourceLabel) sourceLabel.textContent = this._sourceName || 'не подключено';

        const statusLabel = element.querySelector('.list-convert-status-label');
        if (statusLabel) statusLabel.textContent = this._statusText();

        const rowsContainer = element.querySelector('.list-input-rows');
        if (rowsContainer) this.renderRows(rowsContainer);
    }

    // Виджет Доски - редактируемая таблица имя/значение, тот же паттерн,
    // что у ListInputNode.getDashboardWidget() (Раунды 32/37/38) - правки
    // через ctx.onEdit пишут в DashboardNode (передаётся ПОЛНЫЙ
    // обновлённый массив), а не напрямую в this.items.
    // Общая логика "каким полем показывать это значение" - тело ноды
    // (_buildValueInput) и виджет Доски используют ЕЁ ЖЕ, чтобы не
    // разойтись в поведении между графом и Доской
    _effectiveFormatFor(value) {
        if (this.dataFormat !== 'auto') return this.dataFormat;
        return typeof value === 'boolean' ? 'boolean' : (typeof value === 'number' ? 'number' : 'text');
    }

    getDashboardWidget(ctx = {}) {
        const node = this;
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
                        if (node._effectiveFormatFor(item.value) === 'boolean') {
                            const checkbox = document.createElement('input');
                            checkbox.type = 'checkbox';
                            checkbox.className = 'table-cell-checkbox';
                            checkbox.checked = Helpers.coerceBool(item.value);
                            checkbox.disabled = true;
                            valueCell.appendChild(checkbox);
                        } else {
                            valueCell.textContent = String(item.value ?? '');
                        }
                        row.appendChild(nameCell);
                        row.appendChild(valueCell);
                        table.appendChild(row);
                    });
                    container.appendChild(table);
                    return;
                }

                const workingItems = sourceItems.map(i => ({ name: i.name, value: i.value }));
                const emitChange = () => {
                    if (ctx.onEdit) ctx.onEdit(workingItems.map(i => ({ ...i })));
                    else node._recalculateFromItems();
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
                        else { node.items[idx].name = e.target.value; node._recalculateFromItems(); }
                    });
                    nameCell.appendChild(nameInput);

                    const valueCell = document.createElement('td');
                    const applyValueChange = (newValue) => {
                        item.value = newValue;
                        if (ctx.onEdit) emitChange();
                        else { node.items[idx].value = newValue; node._recalculateFromItems(); }
                    };

                    const effectiveFormat = node._effectiveFormatFor(item.value);
                    if (effectiveFormat === 'boolean') {
                        const checkbox = document.createElement('input');
                        checkbox.type = 'checkbox';
                        checkbox.className = 'board-widget-list-input-value';
                        checkbox.checked = Helpers.coerceBool(item.value);
                        checkbox.addEventListener('mousedown', (e) => e.stopPropagation());
                        checkbox.addEventListener('click', (e) => e.stopPropagation());
                        checkbox.addEventListener('change', (e) => applyValueChange(e.target.checked));
                        valueCell.appendChild(checkbox);
                    } else if (effectiveFormat === 'number') {
                        const valueInput = document.createElement('input');
                        valueInput.type = 'number';
                        valueInput.step = 'any';
                        valueInput.className = 'board-widget-list-input board-widget-list-input-value';
                        valueInput.value = typeof item.value === 'number' ? item.value : (Helpers.strictCoerceNumber(item.value) ?? 0);
                        valueInput.addEventListener('mousedown', (e) => e.stopPropagation());
                        valueInput.addEventListener('click', (e) => e.stopPropagation());
                        valueInput.addEventListener('input', (e) => {
                            const val = parseFloat(e.target.value);
                            applyValueChange(isNaN(val) ? 0 : val);
                        });
                        valueCell.appendChild(valueInput);
                    } else {
                        const valueInput = document.createElement('input');
                        valueInput.type = 'text';
                        valueInput.className = 'board-widget-list-input board-widget-list-input-value';
                        valueInput.value = typeof item.value === 'string' ? item.value : String(item.value ?? '');
                        valueInput.addEventListener('mousedown', (e) => e.stopPropagation());
                        valueInput.addEventListener('click', (e) => e.stopPropagation());
                        valueInput.addEventListener('input', (e) => applyValueChange(e.target.value));
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

    getInspectorSchema() {
        const fields = super.getInspectorSchema();

        // Раунд 62 - формат значений НЕ зависит от источника (актуален и
        // для списка-источника, и для строк, введённых вручную без
        // подключения вовсе) - поэтому ДО развилки по _sourceKind ниже
        fields.push({ type: 'section', label: 'Формат значений' });
        fields.push({
            key: 'dataFormat',
            label: 'Принудительный формат (важно для чекбоксов)',
            type: 'select',
            options: [
                { value: 'auto', label: 'Авто (по фактическому типу)' },
                { value: 'boolean', label: 'Логический (чекбокс)' },
                { value: 'number', label: 'Число' },
                { value: 'text', label: 'Текст' }
            ],
            get: () => this.dataFormat,
            set: (v) => {
                this.dataFormat = v;
                this._coerceAllItemsToFormat();
                this._syncListDataFromItems();
                const el = document.querySelector(`[data-node-id="${this.id}"]`);
                const rowsContainer = el?.querySelector('.list-input-rows');
                if (rowsContainer) this.renderRows(rowsContainer);
                if (window.nodeManager) window.nodeManager.calculateAll();
            }
        });

        if (this._sourceKind !== 'table') {
            fields.push({
                type: 'section',
                label: this._sourceKind === 'list'
                    ? 'Источник уже Список - режимы преобразования не нужны'
                    : 'Подключите Таблицу или Список, чтобы задать режим преобразования'
            });
            return fields;
        }

        fields.push({ type: 'section', label: 'Режим преобразования' });
        fields.push({
            key: 'mode',
            label: 'Режим',
            type: 'select',
            options: [
                { value: 'namesFromColumn', label: 'Имена из столбца (значения пустые)' },
                { value: 'valuesFromColumn', label: 'Автоимена + значения из столбца' },
                { value: 'pair', label: 'Пара имя:значение (два столбца)' }
            ],
            get: () => this.mode,
            set: (v) => { this.mode = v; }
        });

        if (this.mode === 'pair') {
            fields.push({
                key: 'pairNameColumn',
                label: 'Столбец имён',
                type: 'select',
                options: this._inputHeaders.map((h, i) => ({ value: String(i), label: h || `Столбец ${i + 1}` })),
                get: () => String(this.pairNameColumn),
                set: (v) => { this.pairNameColumn = parseInt(v, 10) || 0; }
            });
            fields.push({
                key: 'pairValueColumn',
                label: 'Столбец значений',
                type: 'select',
                options: this._inputHeaders.map((h, i) => ({ value: String(i), label: h || `Столбец ${i + 1}` })),
                get: () => String(this.pairValueColumn),
                set: (v) => { this.pairValueColumn = parseInt(v, 10) || 0; }
            });
        } else {
            fields.push({
                key: 'singleColumn',
                label: this.mode === 'namesFromColumn' ? 'Столбец имён' : 'Столбец значений',
                type: 'select',
                options: this._inputHeaders.map((h, i) => ({ value: String(i), label: h || `Столбец ${i + 1}` })),
                get: () => String(this.singleColumn),
                set: (v) => { this.singleColumn = parseInt(v, 10) || 0; }
            });
        }

        return fields;
    }
}
