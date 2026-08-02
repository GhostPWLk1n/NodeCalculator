/**
 * SPDX-License-Identifier: MIT
 * SPDX-FileCopyrightText: 2024 NodeCalculate Team
 * SPDX-FileCopyrightText: 2024 Pavel Fomin
 *
 * @file    treeFormatNode.js
 * @brief   Обработчик: оформление свода "Дерева" (формат/ширина/цвет полей), с сохранением иерархии
 * @author  Pavel Fomin
 * @version 1.7.50
 * @see     https://github.com/GhostPWLk1n/NodeCalculator.git
 */

import { BaseNode } from './baseNode.js';
import { TableData } from '../utils/dataTypes.js';
import { SocketFactory } from '../utils/socketFactory.js';
import { TreeWidgetRenderer } from '../utils/treeWidgetRenderer.js';

/**
 * TreeFormatNode ("Оформление дерева") - Раунд 56, план 1.6.0 п.8 (по
 * просьбе Mr.D - "сделать по примеру таблиц"). Практически то же самое,
 * что `TableFormatNode` (Раунд 44) - формат/ширина/знаки/итог/цвет по
 * каждому полю - но специально для `TreeNode`: КРОМЕ плоского свода
 * (`this.tableData`, тот же формат, что у любой другой Data-ноды) ещё и
 * ПРОКИДЫВАЕТ `this.branches` от источника без изменений - иначе
 * `TreeViewerNode`, подключённый ПОСЛЕ этой ноды, потерял бы доступ к
 * самой иерархии (branches хранит ссылки на ноды-ветки, а не просто
 * цифры - см. докстринг treeNode.js) и не смог бы её рекурсивно
 * отрисовать.
 *
 * Столбцы для оформления - берутся из `srcNode.tableData.columns` (те
 * же совпавшие поля, что уже посчитал `TreeNode`) - "Ветка" (имя) не
 * входит в список оформляемых полей, это служебный столбец.
 */
export class TreeFormatNode extends BaseNode {
    constructor(id, type, x, y, config = {}) {
        super(id, type, x, y, config);
        this.inputs = 1;
        this.inputSockets = [0];
        this.outputs = 1;
        this.width = config.width || 200;

        this._sourceName = null;
        this.tableData = new TableData();
        this.branches = []; // проброс от источника - см. докстринг класса

        // Переопределения оформления ПО ПОЛЮ (индекс = индекс столбца
        // ПОСЛЕ служебного "Ветка", т.е. 0 = первое совпавшее поле) -
        // тот же принцип, что у TableFormatNode.columnStyles
        this.columnStyles = Array.isArray(config.columnStyles) ? config.columnStyles : [];

        // Виджет Доски - см. Раунд 71 ниже (this.dashboardExpandedState) -
        // настоящее раскрываемое дерево, не плоский свод. Часть этих
        // полей (boardShowRowNumbers/boardSortColumn/boardSortDirection)
        // была актуальна только для прежнего плоского TableWidgetRenderer
        // и сейчас не читается новым TreeWidgetRenderer - оставлены как
        // есть (безвредные неиспользуемые поля) ради простоты миграции,
        // не в счёт зебры/линий ниже - те по-прежнему применяются.
        this.boardShowRowNumbers = config.boardShowRowNumbers ?? true;
        this.boardSortColumn = config.boardSortColumn ?? null;
        this.boardSortDirection = config.boardSortDirection ?? null;
        this.boardZebra = config.boardZebra ?? false;
        this.boardShowRowLines = config.boardShowRowLines ?? true;
        this.boardShowColumnLines = config.boardShowColumnLines ?? false;
        // Раунд 71 - виджет Доски теперь настоящее раскрываемое дерево
        // (TreeWidgetRenderer) - см. подробности в treeNode.js/
        // treeWidgetRenderer.js
        this.dashboardExpandedState = config.dashboardExpandedState || {};
    }

    createContent() {
        const content = document.createElement('div');
        content.className = 'node-content';
        content.style.cssText = 'width: 100%; min-width: 160px;';

        const inRow = document.createElement('div');
        inRow.style.cssText = 'display:flex; align-items:center; gap:6px;';
        const inSocket = SocketFactory.createSocket({
            nodeId: this.id, socketType: 'input', index: 0, isData: true,
            title: 'Дерево, которое оформляем'
        });
        inRow.appendChild(inSocket);
        const sourceLabel = document.createElement('span');
        sourceLabel.className = 'table-format-source-label';
        sourceLabel.style.cssText = 'color:var(--md-text-secondary); font-size:11px; flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;';
        sourceLabel.textContent = this._sourceName || 'не подключено';
        inRow.appendChild(sourceLabel);
        content.appendChild(inRow);

        const hintRow = document.createElement('div');
        hintRow.style.cssText = 'padding-left:20px;';
        const hint = document.createElement('span');
        hint.style.cssText = 'color:var(--md-text-disabled); font-size:10px;';
        hint.textContent = '→ формат/ширина/итог/цвет по полям — в панели справа';
        hintRow.appendChild(hint);
        content.appendChild(hintRow);

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
        outLabel.textContent = 'Результат (DATA):';
        outLabel.style.cssText = 'color:var(--md-text-secondary); font-size:11px; flex:1;';
        outRow.appendChild(outLabel);
        const outSocket = SocketFactory.createSocket({
            nodeId: this.id, socketType: 'output', index: 0, isData: true,
            title: 'Дерево с применённым оформлением (иерархия сохранена)'
        });
        outRow.appendChild(outSocket);
        content.appendChild(outRow);

        return content;
    }

    // Тот же приём, что и в TableFormatNode._applyColumnStyles() -
    // синхронизация по длине, лишнее обрезается, недостающее добавляется
    // пустыми
    _applyColumnStyles(columns) {
        while (this.columnStyles.length < columns.length) {
            this.columnStyles.push({ formatOverride: null, width: null, decimals: null, totalType: null, color: null });
        }
        this.columnStyles.length = columns.length;

        return columns.map((col, i) => {
            const style = this.columnStyles[i] || {};
            return {
                header: col.header,
                values: col.values,
                format: style.formatOverride || col.format,
                width: style.width ?? null,
                decimals: style.decimals ?? null,
                totalType: style.totalType ?? null,
                color: style.color ?? null
            };
        });
    }

    calculate(nodeManager) {
        const connections = window.connectionManager?.getConnections() || [];
        const conn = connections.find(c => c.targetNodeId === this.id && c.targetSocket === 0);
        const srcNode = conn ? nodeManager.getNode(conn.sourceNodeId) : null;

        this._sourceName = srcNode ? (srcNode.customName || srcNode.getDisplayName?.() || 'источник') : null;
        // Проброс иерархии - см. докстринг класса. Пустой массив, если
        // источник не подключён или не несёт branches (не "Дерево")
        this.branches = Array.isArray(srcNode?.branches) ? srcNode.branches : [];

        const baseTable = (srcNode && srcNode.tableData && srcNode.tableData.columns.length > 0)
            ? srcNode.tableData
            : new TableData();

        if (baseTable.columns.length === 0) {
            this.tableData = baseTable;
            this.value = 0;
            return this.value;
        }

        // Багфикс: докстринг класса с самого начала обещал, что служебный
        // столбец "Ветка" (имя ветки, всегда первый у TreeNode.tableData)
        // НЕ входит в список оформляемых полей - но код ниже маппил ВСЕ
        // столбцы baseTable без исключения, поэтому columnStyles[0] на
        // самом деле применялся к "Ветке", а не к первому РЕАЛЬНОМУ полю -
        // панель показывала "Поле 1 — Ветка" и любая правка (формат/итог/
        // цвет/ширина), которую пользователь ожидал увидеть на своём
        // первом настоящем столбце, вместо этого улетала на служебное имя
        // ветки. Теперь "Ветка" явно исключена из _applyColumnStyles() и
        // передаётся насквозь как есть, первой колонкой, без оформления -
        // ровно так, как и было изначально задокументировано.
        const branchColumn = baseTable.columns.find(col => col.header === 'Ветка');
        const styleableColumns = baseTable.columns
            .filter(col => col.header !== 'Ветка')
            .map(col => ({ header: col.header, format: col.format, values: col.values }));

        const formattedColumns = branchColumn
            ? [branchColumn, ...this._applyColumnStyles(styleableColumns)]
            : this._applyColumnStyles(styleableColumns);

        this.tableData = new TableData(formattedColumns, { ...baseTable.metadata });
        this.value = this.tableData.rowCount;
        return this.value;
    }

    // Виджет Доски - Раунд 71: настоящее раскрываемое дерево с
    // применённым оформлением (this.tableData уже несёт форматы/цвета из
    // columnStyles - см. calculate()), не плоский свод.
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
        const sourceLabel = element.querySelector('.table-format-source-label');
        if (sourceLabel) sourceLabel.textContent = this._sourceName || 'не подключено';
    }

    // Раунд 89 - см. подробный комментарий в tableFormatNode.js
    getStaticBadges() {
        return [{ type: 'deprecated', text: 'Оформление переезжает в панель инспектора - см. обсуждение унификации' }];
    }

    getInspectorSchema() {
        const fields = super.getInspectorSchema();

        fields.push({ type: 'section', label: 'Оформление по полю' });

        // Смещение +1: this.tableData.columns[0] - служебная "Ветка"
        // (передаётся насквозь без оформления, см. calculate()), поэтому
        // columnStyles[i] соответствует columns[i+1], а не columns[i]
        // напрямую - иначе подпись поля в панели снова указывала бы не
        // на тот столбец (тот же баг, что уже исправлен в calculate()).
        const headerOffset = (this.tableData.columns[0]?.header === 'Ветка') ? 1 : 0;
        this.columnStyles.forEach((style, i) => {
            const header = this.tableData.columns[i + headerOffset]?.header;
            fields.push({ type: 'section', label: `Поле ${i + 1}${header ? ' — ' + header : ''}` });

            fields.push({
                key: `colStyle${i}_format`,
                label: 'Формат значения',
                type: 'select',
                options: [
                    { value: '', label: 'Авто (как в источнике)' },
                    { value: 'number', label: 'Число' },
                    { value: 'currency', label: 'Деньги' },
                    { value: 'percent', label: 'Проценты' },
                    { value: 'boolean', label: 'Логический (чекбокс)' }
                ],
                get: () => style.formatOverride || '',
                set: (v) => { style.formatOverride = v || null; }
            });

            fields.push({
                key: `colStyle${i}_total`,
                label: 'Итог (строка "Итого")',
                type: 'select',
                options: [
                    { value: '', label: 'Без итога' },
                    { value: 'sum', label: 'Сумма' },
                    { value: 'max', label: 'Наибольшее' },
                    { value: 'min', label: 'Наименьшее' },
                    { value: 'avg', label: 'Среднее' },
                    { value: 'count', label: 'Кол-во' }
                ],
                get: () => style.totalType || '',
                set: (v) => { style.totalType = v || null; }
            });

            fields.push({
                key: `colStyle${i}_width`,
                label: 'Ширина поля, px',
                type: 'number',
                min: 30, step: 5,
                get: () => style.width,
                set: (v) => { style.width = (v === null || isNaN(v)) ? null : Math.max(30, v); }
            });

            fields.push({
                key: `colStyle${i}_decimals`,
                label: 'Знаков после запятой',
                type: 'number',
                min: 0, max: 10, step: 1,
                get: () => style.decimals,
                set: (v) => { style.decimals = (v === null || isNaN(v)) ? null : Math.max(0, Math.min(10, v)); }
            });

            fields.push({
                key: `colStyle${i}_color`,
                label: 'Цвет поля (шапка/значения на Доске)',
                type: 'color',
                get: () => style.color,
                set: (v) => { style.color = v; }
            });
        });

        fields.push({ type: 'section', label: 'Оформление на Доске (дерево)' });

        fields.push({
            key: 'boardZebra',
            label: 'Зебра (чередующийся фон строк)',
            type: 'checkbox',
            get: () => this.boardZebra,
            set: (v) => { this.boardZebra = !!v; window.boardManager?.renderActiveBoard(); }
        });

        fields.push({
            key: 'boardShowRowLines',
            label: 'Линии между строками',
            type: 'checkbox',
            get: () => this.boardShowRowLines,
            set: (v) => { this.boardShowRowLines = !!v; window.boardManager?.renderActiveBoard(); }
        });

        fields.push({
            key: 'boardShowColumnLines',
            label: 'Линии между столбцами',
            type: 'checkbox',
            get: () => this.boardShowColumnLines,
            set: (v) => { this.boardShowColumnLines = !!v; window.boardManager?.renderActiveBoard(); }
        });

        return fields;
    }
}
