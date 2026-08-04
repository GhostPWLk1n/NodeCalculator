/**
 * SPDX-License-Identifier: MIT
 * SPDX-FileCopyrightText: 2024 NodeCalculate Team
 * SPDX-FileCopyrightText: 2024 Pavel Fomin
 *
 * @file    tableFormatNode.js
 * @brief   Обработчик: применяет оформление (формат/ширина/итог/цвет/зебра/линии) к любой Data-таблице
 * @author  Pavel Fomin
 * @version 1.8.9
 * @see     https://github.com/GhostPWLk1n/NodeCalculator.git
 */

import { BaseNode } from './baseNode.js';
import { TableData } from '../utils/dataTypes.js';
import { SocketFactory } from '../utils/socketFactory.js';
import { TableWidgetRenderer } from '../utils/tableWidgetRenderer.js';

/**
 * TableFormatNode ("Оформление таблицы") - Раунд 44. До этого раунда
 * оформление (формат/ширина/знаки/итог/цвет столбца, зебра, линии) жило
 * ПРЯМО в TableInjectNode/TableRemoveNode (Раунд 43) - но это захламляло
 * операционные ноды настройками, вообще не относящимися к их основной
 * задаче (вставить/удалить строки). Mr.D верно предложил разделить -
 * теперь оформление живёт в ОТДЕЛЬНОЙ ноде, подключаемой ПОСЛЕ любой
 * Data-ноды (TableNode, ChartNode, XlsxImportNode, TableInjectNode,
 * TableRemoveNode - какой угодно источник Data), а не встроено в каждую
 * из них по отдельности.
 *
 * Один вход (Data), один выход (та же таблица + оформление). Строки/
 * значения НЕ меняются - меняется только то, КАК таблица показывается
 * (формат числа, ширина столбца на Доске, строка "Итого", цвет столбца,
 * зебра/линии у самого виджета). Столбцы сопоставляются ПО ПОЗИЦИИ - тот
 * же принцип, что у TableInjectNode (см. её докстринг): переопределения
 * (this.columnStyles) синхронизируются по длине с текущим набором
 * столбцов на каждый calculate().
 *
 * Выход - Data (ромб, оранжевый), та же порода, что у остальных
 * табличных нод - подключается куда угодно, что понимает Data, включая
 * ноду "Дашборд" (виджет Доски - см. getDashboardWidget() ниже, код
 * общий с TableNode/TableInjectNode/TableRemoveNode, см.
 * utils/tableWidgetRenderer.js).
 */
export class TableFormatNode extends BaseNode {
    constructor(id, type, x, y, config = {}) {
        super(id, type, x, y, config);
        this.inputs = 1;
        this.inputSockets = [0];
        this.outputs = 1;
        this.width = config.width || 200;

        this._sourceName = null;
        this.tableData = new TableData();

        // Переопределения оформления ПО СТОЛБЦУ - формат/ширина/знаки/
        // итог/цвет, синхронизируется по длине с текущим набором столбцов
        // на каждый calculate() (см. _applyColumnStyles() ниже). Индекс
        // массива = индекс столбца входной (= выходной) таблицы.
        this.columnStyles = Array.isArray(config.columnStyles) ? config.columnStyles : [];

        // Виджет Доски (Раунды 35/42/44, см. TableWidgetRenderer)
        this.boardShowRowNumbers = config.boardShowRowNumbers ?? true;
        // Раунд 93 (чек-лист, п.4.1) - ручная ширина столбцов на Доске
        this.boardColumnWidths = config.boardColumnWidths ? { ...config.boardColumnWidths } : {};
        this.boardSortColumn = config.boardSortColumn ?? null;
        this.boardSortDirection = config.boardSortDirection ?? null;
        this.boardZebra = config.boardZebra ?? false;
        this.boardShowRowLines = config.boardShowRowLines ?? true;
        this.boardShowColumnLines = config.boardShowColumnLines ?? false;
    }

    createContent() {
        const content = document.createElement('div');
        content.className = 'node-content';
        content.style.cssText = 'width: 100%; min-width: 160px;';

        const inRow = document.createElement('div');
        inRow.style.cssText = 'display:flex; align-items:center; gap:6px;';
        const inSocket = SocketFactory.createSocket({
            nodeId: this.id, socketType: 'input', index: 0, isData: true,
            title: 'Таблица, которую оформляем'
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
        hint.textContent = '→ формат/ширина/итог/цвет/зебра — в панели справа';
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
            title: 'Та же таблица с применённым оформлением'
        });
        outRow.appendChild(outSocket);
        content.appendChild(outRow);

        return content;
    }

    // Накладывает переопределения из панели (this.columnStyles) поверх
    // столбцов входной таблицы - формат/ширина/знаки/итог/цвет.
    // Синхронизирует длину массива с текущим набором столбцов: лишние
    // обрезаются, недостающие добавляются пустыми - вызывается в конце
    // calculate(). Тот же приём, что раньше был у TableInjectNode/
    // TableRemoveNode (Раунд 43), до переноса сюда (Раунд 44).
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

        const baseTable = (srcNode && srcNode.tableData && srcNode.tableData.columns.length > 0)
            ? srcNode.tableData
            : new TableData();

        if (baseTable.columns.length === 0) {
            this.tableData = baseTable;
            this.value = 0;
            return this.value;
        }

        const columns = baseTable.columns.map(col => ({
            header: col.header,
            format: col.format,
            values: col.values
        }));

        this.tableData = new TableData(this._applyColumnStyles(columns), { ...baseTable.metadata });
        this.value = this.tableData.rowCount;
        return this.value;
    }

    // Виджет Доски (см. dashboardNode.js/boardManager.js) - та же
    // интерактивная таблица, что у остальных табличных нод (номера
    // строк, сортировка, итоги, зебра/линии, цвет столбцов) - код общий,
    // см. utils/tableWidgetRenderer.js. Это ЕДИНСТВЕННАЯ табличная нода,
    // у которой зебра/линии настраиваются - см. докстринг класса.
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
        const sourceLabel = element.querySelector('.table-format-source-label');
        if (sourceLabel) sourceLabel.textContent = this._sourceName || 'не подключено';
    }

    // Раунд 89 (чек-лист 1.7.21, п.3, по объявленному плану Mr.D) -
    // оформление (формат/цвет/итог по столбцу) переезжает в панель
    // инспектора КАЖДОЙ ноды с собственным представлением данных -
    // отдельная нода-посредник для этого больше не нужна. Нода пока НЕ
    // удалена (старые сохранённые проекты продолжат работать как есть),
    // но новые графы использовать её не должны - см. обсуждение с Mr.D
    // про унификацию правил оформления для Досок и Листов.
    getStaticBadges() {
        return [{ type: 'deprecated', text: 'Оформление переезжает в панель инспектора - см. обсуждение унификации' }];
    }

    getInspectorSchema() {
        const fields = super.getInspectorSchema();

        fields.push({ type: 'section', label: 'Оформление по столбцу' });

        this.columnStyles.forEach((style, i) => {
            const header = this.tableData.columns[i]?.header;
            fields.push({ type: 'section', label: `Столбец ${i + 1}${header ? ' — ' + header : ''}` });

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
                label: 'Ширина столбца, px',
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
                label: 'Цвет столбца (шапка/значения на Доске)',
                type: 'color',
                get: () => style.color,
                set: (v) => { style.color = v; }
            });
        });

        // Оформление виджета на Доске целиком (см. TableWidgetRenderer)
        fields.push({ type: 'section', label: 'Оформление на Доске' });

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
