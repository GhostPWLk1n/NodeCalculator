/**
 * SPDX-License-Identifier: MIT
 * SPDX-FileCopyrightText: 2024 NodeCalculate Team
 * SPDX-FileCopyrightText: 2024 Pavel Fomin
 *
 * @file    treeNode.js
 * @brief   "Дерево" - собирает таблицы/списки в именованные ветки, считает итоги по совпадающим полям
 * @author  Pavel Fomin
 * @version 1.8.46
 * @see     https://github.com/GhostPWLk1n/NodeCalculator.git
 */

import { BaseNode } from './baseNode.js';
import { TableData } from '../utils/dataTypes.js';
import { SocketFactory } from '../utils/socketFactory.js';
import { TreeWidgetRenderer } from '../utils/treeWidgetRenderer.js';

/**
 * TreeNode ("Дерево") - план 1.6.0, п.8. По описанию Mr.D - "фактически
 * как таблица каталогов", с калькуляцией по дереву: собираем таблицы или
 * списки в root-структуру, и если у них совпадают заголовки И тип
 * данных, по ним выводятся итоги (сумма/макс/мин/среднее/первое).
 *
 * АРХИТЕКТУРА - дерево строится ОБЫЧНЫМИ СОЕДИНЕНИЯМИ ГРАФА, а не
 * какой-то внутренней UI-структурой одной ноды. У `TreeNode` динамические
 * входы (по образцу `operationNode.js`/`booleanOperationNode.js`) - "ветки",
 * каждая принимает Data (таблицу или список). ВЛОЖЕННОСТЬ дерева
 * получается, если на вход одного `TreeNode` подключить ВЫХОД другого
 * `TreeNode` - раз выход этой ноды сам по себе обычная Data-таблица
 * (см. ниже), рекурсия просто "проваливается" через обычный многопроходный
 * `nodeManager.calculateAll()`: к моменту, когда верхний `TreeNode`
 * считает СВОЙ результат, вложенный `TreeNode` уже посчитал СВОЙ (более
 * ранний проход) - никакого отдельного рекурсивного обхода писать не
 * пришлось, граф уже умеет распространять значения произвольной глубины.
 *
 * ПОИСК СОВПАДАЮЩИХ ПОЛЕЙ - для каждого заголовка столбца, встреченного
 * хоть в одной ветке, собираются ВСЕ форматы, с которыми он попался (по
 * всем веткам, включая текстовые). Заголовок считается "совпавшим" и
 * попадает в итоговую таблицу, ТОЛЬКО если у него РОВНО ОДИН уникальный
 * формат среди всех веток, где он вообще встретился, И этот формат НЕ
 * text (текстовые поля - описательные, не агрегируются). Если ОДНА и та
 * же по имени колонка в разных ветках имеет РАЗНЫЙ формат (например,
 * "Код" - число в одной ветке, текст в другой) - поле исключается
 * ЦЕЛИКОМ, а не "молча" использует только числовые вхождения - иначе
 * можно было бы незаметно просуммировать поля, которые на самом деле
 * означают разное в разных ветках.
 *
 * АГРЕГАЦИЯ - для каждого совпавшего заголовка своя операция
 * (this.columnAggregation, ключ - имя заголовка, тот же принцип, что у
 * `columnConfigB` в `TableJoinNode`, Раунд 46, но по имени, а не по
 * индексу столбца - тут "поле" это в первую очередь ИМЯ, а не позиция):
 * сумма/максимум/минимум/среднее/первое значение. Ветка, у которой
 * ВООБЩЕ НЕТ такого столбца, получает 0 (для суммы) или null (для
 * остальных режимов) - LEFT JOIN-семантика, та же, что уже была в
 * `TableJoinNode`.
 *
 * ВЕТВИ - у каждого входа есть ИМЯ (this.branchNames, ключ - индекс
 * входа) - по умолчанию берётся отображаемое имя подключённой ноды,
 * можно переопределить в панели (полезно, когда несколько веток
 * подключены от одинаково названных источников).
 */
export class TreeNode extends BaseNode {
    constructor(id, type, x, y, config = {}) {
        super(id, type, x, y, config);
        this.outputs = 1;
        this.inputs = config.inputs || 2;
        this.maxInputs = 20;
        this.inputSockets = Array.from({ length: this.inputs }, (_, i) => i);

        // Переопределение имени ветки (индекс входа -> имя) - по
        // умолчанию берётся из подключённой ноды, см. calculate()
        this.branchNames = config.branchNames || {};
        // Агрегация по КАЖДОМУ совпавшему полю (имя заголовка -> режим) -
        // см. докстринг класса
        this.columnAggregation = config.columnAggregation || {};

        this._branchInfo = []; // [{index, name}] - для тела ноды/панели
        this.branches = []; // [{name, srcNode}] - публичный, для TreeViewerNode/TreeFormatNode (см. calculate())
        this.tableData = new TableData();
        this._isRerendering = false;

        // Виджет Доски (см. utils/tableWidgetRenderer.js) - только номера
        // строк/сортировка, оформление - через TableFormatNode (Раунд 44)
        this.boardShowRowNumbers = config.boardShowRowNumbers ?? true;
        this.boardSortColumn = config.boardSortColumn ?? null;
        this.boardSortDirection = config.boardSortDirection ?? null;
        // Раунд 71 - виджет Доски теперь рисует настоящее раскрываемое
        // дерево (TreeWidgetRenderer), а не плоский свод через
        // TableWidgetRenderer - state развёрнутости/свёрнутости веток
        // хранится здесь же, мутируется кликом прямо на виджете (см.
        // treeWidgetRenderer.js). Путь -> false, если свёрнут.
        this.dashboardExpandedState = config.dashboardExpandedState || {};
    }

    createContent() {
        const content = document.createElement('div');
        content.className = 'node-content';

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

        const outRow = document.createElement('div');
        outRow.style.cssText = `
            display: flex;
            align-items: center;
            gap: 8px;
            padding-top: 6px;
            margin-top: 2px;
            border-top: 1px solid var(--md-divider);
        `;
        const outLabel = document.createElement('label');
        outLabel.textContent = 'Итог (DATA):';
        outLabel.style.cssText = 'color:var(--md-text-secondary); font-size:11px; flex:1;';
        outRow.appendChild(outLabel);
        const outSocket = SocketFactory.createSocket({
            nodeId: this.id, socketType: 'output', index: 0, isData: true,
            title: 'Свод по веткам - строка на ветку, столбец на каждое совпавшее поле'
        });
        outRow.appendChild(outSocket);
        content.appendChild(outRow);

        this.checkAndAddEmptySlot();

        return content;
    }

    createInputSocket(index) {
        const inputRow = document.createElement('div');
        inputRow.className = 'node-input';
        inputRow.style.cssText = 'display:flex; align-items:center; gap:8px; padding:2px 0;';

        const isConnected = this.isSocketConnected(index);

        const socket = SocketFactory.createSocket({
            nodeId: this.id, socketType: 'input', index: index, isData: true,
            title: 'Ветка - таблица или список'
        });
        if (isConnected) {
            socket.classList.add('socket-connected');
            socket.style.background = '#ff8a65';
            socket.style.borderColor = '#ff8a65';
            socket.style.boxShadow = '0 0 12px rgba(255, 138, 101, 0.3)';
        }
        inputRow.appendChild(socket);

        const branchInfo = this._branchInfo.find(b => b.index === index);
        const label = document.createElement('label');
        label.textContent = branchInfo ? branchInfo.name : `ветка ${index + 1}`;
        label.style.cssText = `
            color: ${isConnected ? 'var(--md-text)' : 'var(--md-text-secondary)'};
            font-size: 11px;
            font-weight: ${isConnected ? '500' : '400'};
            flex: 1;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
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
            if (isConnected && window.connectionManager) {
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
                statusEl.textContent = '⚠️ Минимум 2 ветки';
                setTimeout(() => { statusEl.textContent = 'Готово'; }, 1500);
            }
            return;
        }

        const idx = this.inputSockets.indexOf(index);
        if (idx === -1) return;
        this.inputSockets.splice(idx, 1);
        this.inputs = this.inputSockets.length;
        delete this.branchNames[index];

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

    // Достаёт "родные" столбцы ветки - таблица целиком (Data) или список
    // (LIST), обёрнутый в один столбец по имени ноды (список - это по
    // сути одна колонка чисел без явного заголовка)
    static _getBranchColumns(src) {
        if (src.tableData && src.tableData.columns.length > 0) {
            return src.tableData.columns;
        }
        if (src.listData?.items?.length > 0) {
            const items = src.listData.items;
            // Раунд 63 - формат берём из самих данных, а не жёстко
            // 'number' (как было раньше) - список-ветка может быть
            // текстовым/булевым (ListInputNode.dataType, Раунд 56, или
            // ListConvertNode.dataFormat, Раунд 62) - молчаливое
            // "number" затирало бы это и ломало бы чекбоксы/текст в
            // "Просмотре дерева" при ручной сборке структуры из таких нод
            const format = items[0]?.format
                || src.listData.metadata?.format
                || (items.every(i => typeof i.value === 'boolean') ? 'boolean'
                    : items.every(i => typeof i.value === 'number') ? 'number' : 'text');
            return [{
                header: src.customName || src.getDisplayName?.() || 'Значение',
                values: items.map(i => i.value),
                format
            }];
        }
        return [];
    }

    static _aggregate(values, mode) {
        const nums = values.filter(v => typeof v === 'number');
        switch (mode) {
            case 'max': return nums.length ? Math.max(...nums) : null;
            case 'min': return nums.length ? Math.min(...nums) : null;
            case 'avg': return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
            case 'first': return values.length ? values[0] : null;
            case 'sum':
            default:
                return nums.reduce((a, b) => a + b, 0);
        }
    }

    static _emptyValueFor(mode) {
        return mode === 'sum' ? 0 : null;
    }

    calculate(nodeManager) {
        const connections = window.connectionManager?.getConnections() || [];

        const branches = this.inputSockets.map(index => {
            const conn = connections.find(c => c.targetNodeId === this.id && c.targetSocket === index);
            const src = conn ? nodeManager.getNode(conn.sourceNodeId) : null;
            return { index, src };
        }).filter(b => b.src);

        this._branchInfo = branches.map(b => ({
            index: b.index,
            name: this.branchNames[b.index] || b.src.customName || b.src.getDisplayName?.() || `Ветка ${b.index + 1}`
        }));

        // Раунд 56 - публичный список веток С ССЫЛКОЙ на саму ноду-источник
        // (не только имя, как в this._branchInfo выше) - для "Просмотра
        // дерева"/"Оформления дерева" (treeViewerNode.js/treeFormatNode.js):
        // this.tableData (плоский свод) хранит только ИТОГОВЫЕ числа по
        // веткам, а НЕ то, что каждая ветка сама по себе МОЖЕТ БЫТЬ другим
        // TreeNode со своими собственными вложенными ветками - именно
        // ЭТУ иерархию просмотрщик обходит рекурсивно через branches[i].srcNode.branches
        this.branches = this._branchInfo.map((info, i) => ({
            name: info.name,
            srcNode: branches[i].src
        }));

        if (branches.length === 0) {
            this.tableData = new TableData();
            this.value = 0;
            return this.value;
        }

        const branchColumns = branches.map(b => TreeNode._getBranchColumns(b.src));

        // Совпадающие поля - см. докстринг класса про строгое правило
        // "ровно один формат среди всех веток, где поле встретилось"
        const formatsByHeader = new Map();
        branchColumns.forEach(cols => {
            cols.forEach(col => {
                if (!formatsByHeader.has(col.header)) formatsByHeader.set(col.header, new Set());
                formatsByHeader.get(col.header).add(col.format);
            });
        });

        const matchedHeaders = [];
        const formatByHeader = new Map();
        formatsByHeader.forEach((formats, header) => {
            if (formats.size === 1) {
                const fmt = [...formats][0];
                if (fmt !== 'text') {
                    matchedHeaders.push(header);
                    formatByHeader.set(header, fmt);
                }
            }
        });

        // Синхронизация this.columnAggregation - убираем устаревшие поля,
        // добавляем новые (дефолт - сумма)
        const newAggregation = {};
        matchedHeaders.forEach(h => { newAggregation[h] = this.columnAggregation[h] || 'sum'; });
        this.columnAggregation = newAggregation;

        const nameColumn = { header: 'Ветка', values: this._branchInfo.map(b => b.name), format: 'text' };
        const dataColumns = matchedHeaders.map(header => {
            const mode = this.columnAggregation[header];
            const format = formatByHeader.get(header);
            const values = branchColumns.map(cols => {
                const col = cols.find(c => c.header === header);
                if (!col) return TreeNode._emptyValueFor(mode);
                return TreeNode._aggregate(col.values, mode);
            });
            return { header, values, format };
        });

        this.tableData = new TableData([nameColumn, ...dataColumns], {
            title: this.customName || this.getDisplayName()
        });
        this.value = branches.length;

        setTimeout(() => this.checkAndAddEmptySlot(), 100);

        return this.value;
    }

    getDisplayName() {
        return this.customName || 'Дерево';
    }

    // Виджет Доски (см. dashboardNode.js/boardManager.js) - Раунд 71:
    // настоящее раскрываемое дерево (TreeWidgetRenderer), не плоский
    // свод - по прямой жалобе Mr.D ("в дашбордах дерево по-прежнему
    // рисуется просто как таблица"). TableWidgetRenderer больше не
    // используется здесь (остаётся у остальных Data-нод).
    getDashboardWidget() {
        const node = this;
        return {
            type: 'tree',
            title: this.customName || null,
            render: (container) => {
                container.appendChild(TreeWidgetRenderer.build(node));
            }
        };
    }

    updateDisplay(element) {
        this.inputSockets.forEach(index => {
            const isConnected = this.isSocketConnected(index);
            const branchInfo = this._branchInfo.find(b => b.index === index);
            const row = element.querySelectorAll('.node-input')[this.inputSockets.indexOf(index)];
            if (!row) return;

            const label = row.querySelector('label');
            if (label) {
                label.textContent = branchInfo ? branchInfo.name : `ветка ${index + 1}`;
                label.style.color = isConnected ? 'var(--md-text)' : 'var(--md-text-secondary)';
            }

            const socket = row.querySelector('.socket');
            if (socket) {
                if (isConnected) {
                    socket.classList.add('socket-connected');
                    socket.style.background = '#ff8a65';
                    socket.style.borderColor = '#ff8a65';
                    socket.style.boxShadow = '0 0 12px rgba(255, 138, 101, 0.3)';
                } else {
                    socket.classList.remove('socket-connected');
                    socket.style.background = '';
                    socket.style.borderColor = '';
                    socket.style.boxShadow = '';
                }
            }
        });
    }

    getInspectorSchema() {
        const fields = super.getInspectorSchema();

        fields.push({ type: 'section', label: 'Имена веток' });
        this._branchInfo.forEach(branch => {
            fields.push({
                key: `branchName${branch.index}`,
                label: `Вход ${branch.index + 1} (по умолчанию: имя источника)`,
                type: 'text',
                get: () => this.branchNames[branch.index] || '',
                set: (v) => {
                    if (v && v.trim()) this.branchNames[branch.index] = v.trim();
                    else delete this.branchNames[branch.index];
                }
            });
        });

        const matchedHeaders = Object.keys(this.columnAggregation);
        if (matchedHeaders.length > 0) {
            fields.push({ type: 'section', label: 'Итоги по совпавшим полям' });
            matchedHeaders.forEach(header => {
                fields.push({
                    key: `treeAgg_${header}`,
                    label: header,
                    type: 'select',
                    options: [
                        { value: 'sum', label: 'Сумма' },
                        { value: 'max', label: 'Максимум' },
                        { value: 'min', label: 'Минимум' },
                        { value: 'avg', label: 'Среднее' },
                        { value: 'first', label: 'Первое значение' }
                    ],
                    get: () => this.columnAggregation[header] || 'sum',
                    set: (v) => { this.columnAggregation[header] = v; }
                });
            });
        } else {
            fields.push({
                type: 'section',
                label: 'Пока нет совпадающих полей - подключите ветки с одинаковыми по имени и типу столбцами'
            });
        }

        return fields;
    }
}
