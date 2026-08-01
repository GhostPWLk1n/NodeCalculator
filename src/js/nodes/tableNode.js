/**
 * SPDX-License-Identifier: MIT
 * SPDX-FileCopyrightText: 2024 NodeCalculate Team
 * SPDX-FileCopyrightText: 2024 Pavel Fomin
 *
 * @file    tableNode.js
 * @brief   Обработчик: собирает LIST-входы в столбцы таблицы (выход типа Data)
 * @author  Pavel Fomin
 * @version 1.7.15
 * @see     https://github.com/GhostPWLk1n/NodeCalculator.git
 */

import { BaseNode } from './baseNode.js';
import { TableData } from '../utils/dataTypes.js';
import { SocketFactory } from '../utils/socketFactory.js';
import { TableWidgetRenderer } from '../utils/tableWidgetRenderer.js';

/**
 * TableNode - обработчик: собирает входящие LIST-ы в столбцы таблицы.
 * У каждого столбца два входа - LIST (обязательный, значения столбца)
 * и String (необязательный, переопределяет заголовок столбца).
 *
 * ВИД НОДЫ - НАМЕРЕННО МИНИМАЛЬНЫЙ. Всё оформление (формат/итог/ширина/
 * знаки после запятой/подцепить имена строк) живёт в боковой панели
 * (InspectorManager, getInspectorSchema() ниже) - в самом теле ноды
 * остаются только сокеты с подписью имени подключённого источника
 * ([сокет][имя источника]), чтобы нода не разрасталась контролами,
 * которые нужны не постоянно, а изредка. См. docs/NODE_API.md.
 *
 * Формат столбца (число/деньги/проценты) можно выбрать вручную в
 * панели, либо унаследовать от источника через getValueFormat() (см.
 * BaseNode.getValueFormat()).
 *
 * Названия строк (item.name из подключённого LIST) можно подцепить как
 * отдельный текстовый столбец перед числовым - переключается чекбоксом
 * в панели у каждого столбца индивидуально.
 *
 * Ширину столбца и число знаков после запятой в выходной таблице можно
 * задать вручную в панели (пусто = авто) - тогда потребитель
 * (TableViewerNode) применяет их напрямую вместо собственных эвристик.
 *
 * Выход единственный - сокет типа Data (ромб, оранжевый): готовые данные,
 * которые дальше умеет читать, например, PercentageNode.
 *
 * Индексы сокетов: у одной ноды каждый input-сокет должен иметь свой
 * уникальный index (см. docs/NODE_API.md, раздел 5) - поэтому пара
 * LIST+String на столбец занимает ДВА последовательных индекса
 * (this._nextIndex растёт на 2 при каждом новом столбце), а не
 * переиспользует один и тот же index для разных типов сокета.
 */
export class TableNode extends BaseNode {
    constructor(id, type, x, y, config = {}) {
        super(id, type, x, y, config);
        this.outputs = 1;

        // Практического смысла ограничивать сильно нет - индексы сокетов
        // растут на 2 за столбец, так что верхняя граница нужна только
        // как разумная защита от случайного бесконечного роста ноды
        this.maxColumns = config.maxColumns || 24;
        this._isRerendering = false;

        this.columns = (config.columns && config.columns.length)
            ? config.columns.map(c => ({
                listIndex: c.listIndex,
                stringIndex: c.stringIndex,
                formatOverride: c.formatOverride ?? null,
                includeNames: c.includeNames ?? false,
                width: c.width ?? null,
                totalType: c.totalType ?? null,
                decimals: c.decimals ?? null
            }))
            : [{ listIndex: 0, stringIndex: 1, formatOverride: null, includeNames: false, width: null, totalType: null, decimals: null }];

        this._nextIndex = config._nextIndex ?? (this.columns.length * 2);

        this.inputSockets = this.columns.flatMap(c => [c.listIndex, c.stringIndex]);
        this.inputs = this.inputSockets.length;

        this.width = config.width || 240;
        this.tableData = new TableData();

        // Состояние ТОЛЬКО для виджета на Доске (Раунд 35) - не влияет на
        // тело ноды в графе (оно намеренно минимальное, см. докстринг
        // класса) и не путать с настройками столбцов выше. Зеркало полей
        // TableViewerNode (showRowNumbers/sortColumnIndex/sortDirection) -
        // тот же принцип, просто отдельный набор специально для
        // getDashboardWidget(), т.к. это разные потребители одной tableData.
        this.boardShowRowNumbers = config.boardShowRowNumbers ?? true;
        this.boardSortColumn = config.boardSortColumn ?? null;
        this.boardSortDirection = config.boardSortDirection ?? null; // 'asc' | 'desc' | null
        // Зебра/линии/цвет столбца - НЕ здесь (Раунд 44). В Раунде 43 их
        // добавили прямо сюда, но это захламляло ноду оформлением,
        // которое к её основной задаче (собрать таблицу из списков) не
        // относится - вынесено в отдельную TableFormatNode
        // (tableFormatNode.js, "Оформление таблицы"), которую можно
        // подключить ПОСЛЕ любой Data-ноды, а не только после этой.

        // Имена подключённых источников по столбцам (для подписей
        // [сокет][имя источника] в теле ноды) - заполняется в calculate(),
        // читается в updateDisplay()
        this.columnMeta = this.columns.map(() => ({ listSourceName: null, stringSourceName: null }));
    }

    createContent() {
        const content = document.createElement('div');
        content.className = 'node-content table-node-content';
        content.style.cssText = `
            gap: 8px;
            width: 100%;
            min-width: 150px;
        `;

        const columnsContainer = document.createElement('div');
        columnsContainer.className = 'table-columns-container';
        columnsContainer.style.cssText = `
            display: flex;
            flex-direction: column;
            gap: 6px;
        `;

        this.columns.forEach((col, i) => {
            columnsContainer.appendChild(this.createColumnRow(col, i));
        });

        content.appendChild(columnsContainer);

        // === ВЫХОДНОЙ СОКЕТ (Data) ===
        const outputRow = document.createElement('div');
        outputRow.className = 'node-output table-output-row';
        outputRow.style.cssText = `
            display: flex;
            align-items: center;
            gap: 8px;
            padding-top: 6px;
            margin-top: 2px;
            border-top: 1px solid var(--md-divider);
        `;

        const outputLabel = document.createElement('label');
        outputLabel.textContent = 'Таблица (DATA):';
        outputLabel.className = 'table-output-label';
        outputLabel.style.cssText = `
            color: var(--md-text-secondary);
            font-size: 11px;
            font-weight: 400;
            flex: 1;
        `;
        outputRow.appendChild(outputLabel);

        const outputCount = document.createElement('span');
        outputCount.className = 'table-output-count';
        outputCount.style.cssText = `
            color: #ff8a65;
            font-size: 12px;
            font-weight: 500;
            font-variant-numeric: tabular-nums;
        `;
        outputCount.textContent = `${this.tableData.columns.length}×${this.tableData.rowCount}`;
        outputRow.appendChild(outputCount);

        const outputSocket = SocketFactory.createSocket({
            nodeId: this.id,
            socketType: 'output',
            index: 0,
            isData: true,
            title: 'Таблица (DATA)'
        });
        outputRow.appendChild(outputSocket);

        content.appendChild(outputRow);

        // Проверяем, нужно ли сразу добавить свободный столбец
        this.checkAndAddEmptySlot();

        return content;
    }

    // Минимальная строка столбца - только сокеты и подпись имени
    // подключённого источника. Всё оформление - в боковой панели
    // (getInspectorSchema()).
    createColumnRow(col, index) {
        const row = document.createElement('div');
        row.className = 'table-column-row';
        row.dataset.colIndex = index;
        row.style.cssText = `
            display: flex;
            flex-direction: column;
            gap: 2px;
            padding: 3px 0;
            ${index > 0 ? 'border-top: 1px dashed var(--md-divider);' : ''}
        `;

        // --- строка 1: LIST-сокет + имя источника + удаление столбца ---
        const listLine = document.createElement('div');
        listLine.className = 'table-column-line';
        listLine.style.cssText = 'display:flex; align-items:center; gap:6px;';

        const listSocket = SocketFactory.createSocket({
            nodeId: this.id,
            socketType: 'input',
            index: col.listIndex,
            isList: true,
            title: `Список — столбец ${index + 1}`
        });
        listLine.appendChild(listSocket);

        const sourceLabel = document.createElement('span');
        sourceLabel.className = 'table-column-source-label';
        sourceLabel.dataset.colIndex = String(index);
        sourceLabel.dataset.role = 'list';
        sourceLabel.style.cssText = `
            color: var(--md-text-secondary);
            font-size: 11px;
            flex: 1;
            min-width: 0;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        `;
        sourceLabel.textContent = this.columnMeta[index]?.listSourceName || 'не подключено';
        listLine.appendChild(sourceLabel);

        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'delete-input-btn';
        deleteBtn.textContent = '✕';
        deleteBtn.style.display = this.columns.length > 1 ? 'inline-block' : 'none';
        deleteBtn.title = 'Удалить столбец';
        deleteBtn.addEventListener('mousedown', (e) => e.stopPropagation());
        deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.removeColumn(index);
        });
        listLine.appendChild(deleteBtn);

        row.appendChild(listLine);

        // --- строка 2: String-сокет + имя источника заголовка ---
        const metaLine = document.createElement('div');
        metaLine.className = 'table-column-line table-column-meta';
        metaLine.style.cssText = 'display:flex; align-items:center; gap:6px;';

        const stringSocket = SocketFactory.createSocket({
            nodeId: this.id,
            socketType: 'input',
            index: col.stringIndex,
            isString: true,
            title: 'Заголовок столбца (необязательно)'
        });
        metaLine.appendChild(stringSocket);

        const stringLabel = document.createElement('span');
        stringLabel.className = 'table-column-source-label';
        stringLabel.dataset.colIndex = String(index);
        stringLabel.dataset.role = 'string';
        stringLabel.style.cssText = `
            color: var(--md-text-disabled);
            font-size: 10px;
            flex: 1;
            min-width: 0;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        `;
        stringLabel.textContent = this.columnMeta[index]?.stringSourceName
            ? `заголовок: ${this.columnMeta[index].stringSourceName}`
            : 'заголовок: авто';
        metaLine.appendChild(stringLabel);

        row.appendChild(metaLine);

        return row;
    }

    isSocketConnected(index) {
        const connections = window.connectionManager?.getConnections() || [];
        return connections.some(c => c.targetNodeId === this.id && c.targetSocket === index);
    }

    // Автодобавление свободного столбца - вызывается ядром
    // (connectionManager.addConnection) после каждого нового соединения.
    checkAndAddEmptySlot() {
        if (this.collapsed) return;
        if (this.columns.length >= this.maxColumns) return;

        const allFilled = this.columns.every(col => this.isSocketConnected(col.listIndex));
        if (!allFilled) return;

        this.columns.push({
            listIndex: this._nextIndex,
            stringIndex: this._nextIndex + 1,
            formatOverride: null,
            includeNames: false,
            width: null,
            totalType: null,
            decimals: null
        });
        this._nextIndex += 2;
        this.inputSockets = this.columns.flatMap(c => [c.listIndex, c.stringIndex]);
        this.inputs = this.inputSockets.length;
        this.columnMeta.push({ listSourceName: null, stringSourceName: null });

        setTimeout(() => {
            if (!this._isRerendering && !this.collapsed) {
                this.rerender();
            }
            if (window.inspectorManager?.isOpenFor(this.id)) {
                window.inspectorManager.refresh();
            }
        }, 50);
    }

    removeColumn(index) {
        if (this.columns.length <= 1) {
            document.getElementById('status').textContent = '⚠️ Минимум 1 столбец';
            setTimeout(() => { document.getElementById('status').textContent = 'Готово'; }, 1500);
            return;
        }

        const col = this.columns[index];

        if (window.connectionManager) {
            const connections = window.connectionManager.getConnections();
            const filtered = connections.filter(c =>
                !(c.targetNodeId === this.id && (c.targetSocket === col.listIndex || c.targetSocket === col.stringIndex))
            );
            window.connectionManager.connections = filtered;
            if (window.renderer) {
                window.renderer.drawAllConnections(filtered);
            }
        }

        this.columns.splice(index, 1);
        this.columnMeta.splice(index, 1);
        this.inputSockets = this.columns.flatMap(c => [c.listIndex, c.stringIndex]);
        this.inputs = this.inputSockets.length;

        this.rerender();

        if (window.nodeManager) {
            window.nodeManager.calculateAll();
            if (window.renderer) window.renderer.updateAllDisplays();
        }
        // Панель могла быть открыта для этой же ноды с полями по индексам
        // столбцов - индексы сместились, перерисовываем
        if (window.inspectorManager?.isOpenFor(this.id)) {
            window.inspectorManager.refresh();
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

    calculate(nodeManager) {
        const connections = window.connectionManager?.getConnections() || [];

        const columns = this.columns.flatMap((col, i) => {
            const listConn = connections.find(c => c.targetNodeId === this.id && c.targetSocket === col.listIndex);
            const strConn = connections.find(c => c.targetNodeId === this.id && c.targetSocket === col.stringIndex);

            const listSrc = listConn ? nodeManager.getNode(listConn.sourceNodeId) : null;
            const strSrc = strConn ? nodeManager.getNode(strConn.sourceNodeId) : null;

            // Имена источников - для подписей [сокет][имя источника] в теле
            // ноды (см. createColumnRow/updateDisplay)
            const listSourceName = listSrc ? (listSrc.customName || listSrc.getDisplayName?.() || 'источник') : null;
            const stringSourceName = strSrc
                ? ((typeof strSrc.value === 'string' && strSrc.value.trim()) ? strSrc.value.trim() : (strSrc.getDisplayName?.() || 'строка'))
                : null;
            this.columnMeta[i] = { listSourceName, stringSourceName };

            // Столбец без подключённого LIST-источника - "заготовка" для
            // следующего соединения (см. checkAndAddEmptySlot), а не
            // реальные данные. В tableData она не попадает - иначе
            // потребители (Viewer, PercentageNode) показывали бы пустой
            // столбец без значений.
            if (!listSrc) return [];

            const items = listSrc.listData?.items || [];
            const values = items.length > 0
                ? listSrc.listData.values
                : (typeof listSrc.value === 'number' ? [listSrc.value] : []);

            const header = stringSourceName
                || listSrc.listData?.metadata?.title
                || listSourceName
                || `Столбец ${i + 1}`;

            // Приоритет формата: ручной выбор в колонке -> формат,
            // объявленный источником-списком -> 'number' по умолчанию
            const format = col.formatOverride
                || (typeof listSrc.getValueFormat === 'function' ? listSrc.getValueFormat() : null)
                || 'number';

            const entries = [];

            // Названия строк (item.name) - отдельный текстовый столбец
            // ПЕРЕД числовым, если включено в панели
            if (col.includeNames && items.length > 0) {
                entries.push({
                    header: `${header} (имена)`,
                    values: items.map(it => it.name || ''),
                    format: 'text',
                    width: null
                });
            }

            entries.push({ header, values, format, width: col.width || null, totalType: col.totalType || null, decimals: col.decimals ?? null });

            return entries;
        });

        this.tableData = new TableData(columns, { title: this.customName || this.getDisplayName() });
        this.value = this.tableData.rowCount;

        setTimeout(() => this.checkAndAddEmptySlot(), 100);

        return this.value;
    }

    // Виджет Доски (см. dashboardNode.js/boardManager.js) - рендерит ту
    // же TableData, что видит TableViewerNode, но как обычную (не
    // прокручиваемую) HTML-таблицу: страница Доски готовится под печать/
    // PDF, где скролл не нужен - все строки показываются сразу.
    //
    // Сама отрисовка (шапка/сортировка/номера строк/итоги/зебра/линии) -
    // в TableWidgetRenderer (utils/tableWidgetRenderer.js, Раунд 42) -
    // общий код для TableNode/TableInjectNode/TableRemoveNode, чтобы не
    // дублировать ~150 строк в трёх нодах. Здесь только оборачиваем в
    // контракт getDashboardWidget().
    getDashboardWidget() {
        const node = this;
        return {
            type: 'table',
            title: this.customName || null,
            render: (container) => {
                container.appendChild(TableWidgetRenderer.build(node));
            }
        };
    }

    updateDisplay(element) {
        const countEl = element.querySelector('.table-output-count');
        if (countEl) {
            countEl.textContent = `${this.tableData.columns.length}×${this.tableData.rowCount}`;
        }

        const labels = element.querySelectorAll('.table-column-source-label');
        labels.forEach(label => {
            const idx = parseInt(label.dataset.colIndex, 10);
            const meta = this.columnMeta[idx];
            if (!meta) return;
            if (label.dataset.role === 'list') {
                label.textContent = meta.listSourceName || 'не подключено';
            } else {
                label.textContent = meta.stringSourceName ? `заголовок: ${meta.stringSourceName}` : 'заголовок: авто';
            }
        });
    }

    // Боковая панель - здесь живёт всё оформление, которое раньше было
    // инлайн-контролами в теле ноды: формат/итог/ширина/знаки после
    // запятой/подцепить имена строк, по одной группе полей на столбец.
    getInspectorSchema() {
        const fields = super.getInspectorSchema();

        this.columns.forEach((col, i) => {
            fields.push({ type: 'section', label: `Столбец ${i + 1}` });

            fields.push({
                key: `col${i}_format`,
                label: 'Формат значения',
                type: 'select',
                options: [
                    { value: '', label: 'Авто' },
                    { value: 'number', label: 'Число' },
                    { value: 'currency', label: 'Деньги' },
                    { value: 'percent', label: 'Проценты' }
                ],
                get: () => col.formatOverride || '',
                set: (v) => { col.formatOverride = v || null; }
            });

            fields.push({
                key: `col${i}_total`,
                label: 'Итог (строка "Итого")',
                type: 'select',
                options: [
                    { value: '', label: 'Без итога' },
                    { value: 'sum', label: 'Сумма' },
                    { value: 'max', label: 'Наибольшее' },
                    { value: 'min', label: 'Наименьшее' },
                    { value: 'avg', label: 'Среднее' }
                ],
                get: () => col.totalType || '',
                set: (v) => { col.totalType = v || null; }
            });

            fields.push({
                key: `col${i}_width`,
                label: 'Ширина столбца, px',
                type: 'number',
                min: 30, step: 5,
                get: () => col.width,
                set: (v) => { col.width = (v === null || isNaN(v)) ? null : Math.max(30, v); }
            });

            fields.push({
                key: `col${i}_decimals`,
                label: 'Знаков после запятой',
                type: 'number',
                min: 0, max: 10, step: 1,
                get: () => col.decimals,
                set: (v) => { col.decimals = (v === null || isNaN(v)) ? null : Math.max(0, Math.min(10, v)); }
            });

            fields.push({
                key: `col${i}_names`,
                label: 'Добавить столбец с именами строк',
                type: 'checkbox',
                get: () => !!col.includeNames,
                set: (v) => { col.includeNames = !!v; }
            });
        });

        // Зебра/линии/цвет столбца - см. TableFormatNode ("Оформление
        // таблицы", Раунд 44) - отдельная нода, подключается ПОСЛЕ этой
        // (или любой другой Data-ноды), чтобы не захламлять построение
        // таблицы из списков настройками оформления.

        return fields;
    }
}
