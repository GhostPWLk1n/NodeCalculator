/**
 * SPDX-License-Identifier: MIT
 * SPDX-FileCopyrightText: 2024 NodeCalculate Team
 * SPDX-FileCopyrightText: 2024 Pavel Fomin
 *
 * @file    tableWidgetRenderer.js
 * @brief   Общий код виджета Доски "таблица" - используется всеми нодами, отдающими Data-таблицу
 * @author  Pavel Fomin
 * @version 1.8.4
 * @see     https://github.com/GhostPWLk1n/NodeCalculator.git
 */

import { Helpers } from './helpers.js';
import { attachColumnResizeHandle } from './columnResize.js';

/**
 * TableWidgetRenderer - раньше интерактивная таблица на Доске (номера
 * строк, сортировка по клику, проценты-графики, итоги - Раунд 35) была
 * кодом ВНУТРИ TableNode.getDashboardWidget(). С появлением
 * TableInjectNode/TableRemoveNode (Раунд 42), которые тоже отдают Data-
 * таблицу и тоже должны подключаться к Доске, этот код вынесен сюда -
 * чтобы не дублировать ~150 строк в трёх нодах (тот же приём, что и
 * ChartRenderer для диаграмм).
 *
 * build(node) принимает НЕ таблицу, а САМУ НОДУ - виджету нужно не
 * только тело таблицы, но и состояние сортировки/номеров строк/
 * оформления, которое хранится НА НОДЕ (мутируется кликами прямо в
 * виджете, см. Раунд 32/35) и должно быть у КАЖДОЙ ноды, которая хочет
 * этот виджет, со следующими полями (см. докстринги в tableNode.js/
 * tableInjectNode.js/tableRemoveNode.js о том, где именно они заведены):
 *
 *   node.tableData            - TableData, которую рисуем
 *   node.boardShowRowNumbers  - bool, показывать колонку номеров строк
 *   node.boardSortColumn      - number|null, индекс столбца сортировки
 *   node.boardSortDirection   - 'asc'|'desc'|null
 *   node.boardZebra           - bool, зебра (чередующийся фон строк)
 *   node.boardShowRowLines    - bool, горизонтальные линии между строками
 *   node.boardShowColumnLines - bool, вертикальные линии между столбцами
 *
 * Столбцы таблицы (node.tableData.columns[i]) могут нести col.color -
 * акцентный цвет ИМЕННО ЭТОГО столбца (шапка/текст ячеек/процентный
 * график), переопределяет цвет виджета в целом (--board-widget-accent,
 * Раунд 31) для конкретного столбца - см. getInspectorSchema() у
 * ноды-источника про то, как он выставляется.
 */
export const TableWidgetRenderer = {
    // Порядок строк с учётом сортировки - зеркало того, что раньше было
    // TableNode._getBoardRowOrder(), обобщено на любую ноду с нужными полями
    getRowOrder(node) {
        const rowCount = node.tableData.rowCount;
        const order = Array.from({ length: rowCount }, (_, i) => i);
        if (node.boardSortColumn === null || !node.boardSortDirection) return order;

        const col = node.tableData.columns[node.boardSortColumn];
        if (!col) return order;

        order.sort((a, b) => {
            const va = col.values[a];
            const vb = col.values[b];
            let cmp;
            if (typeof va === 'number' && typeof vb === 'number') {
                cmp = va - vb;
            } else if (typeof va === 'boolean' && typeof vb === 'boolean') {
                // Раунд 49 - см. тот же приём в TableViewerNode.getRowOrder()
                cmp = va === vb ? 0 : (va ? 1 : -1);
            } else {
                cmp = String(va ?? '').localeCompare(String(vb ?? ''));
            }
            return node.boardSortDirection === 'asc' ? cmp : -cmp;
        });
        return order;
    },

    // Собирает и возвращает готовый <table> для виджета Доски. Клики
    // внутри (глазик номеров строк, заголовки для сортировки) мутируют
    // поля node напрямую и вызывают window.boardManager.renderActiveBoard()
    // - тот же приём, что у резайза виджетов (Раунд 32): визуальные
    // настройки не трогают tableData, поэтому calculateAll() не нужен.
    build(node) {
        const table = node.tableData;

        // Индекс сортировки мог "протухнуть", если у источника изменился
        // набор столбцов - тогда просто сбрасываем сортировку
        if (node.boardSortColumn !== null && node.boardSortColumn >= table.columns.length) {
            node.boardSortColumn = null;
            node.boardSortDirection = null;
        }

        const rowOrder = this.getRowOrder(node);

        const el = document.createElement('table');
        el.className = 'board-widget-table';
        if (node.boardZebra) el.classList.add('board-widget-table-zebra');
        if (node.boardShowRowLines === false) el.classList.add('board-widget-table-no-row-lines');
        if (node.boardShowColumnLines) el.classList.add('board-widget-table-col-lines');

        // Раунд 47 - раньше col.width (та же настройка "Ширина столбца,
        // px", что уже применялась к TableViewerNode в графе) на Доске
        // просто ИГНОРИРОВАЛАСЬ - таблица всегда была auto-layout, ширины
        // столбцов подбирал браузер сам. table-layout:fixed включаем,
        // только если хоть у одного столбца задана явная ширина - иначе
        // (самый частый случай) поведение не меняется вообще. Раунд 93 -
        // ручное растягивание (node.boardColumnWidths, по заголовку
        // столбца - та же ширина ЭТОГО виджета Доски, не источника,
        // сама Доска - отдельный "просмотрщик" со своими предпочтениями)
        // тоже учитывается здесь.
        if (!node.boardColumnWidths) node.boardColumnWidths = {};
        const hasExplicitWidths = table.columns.some(col => col.width) || Object.keys(node.boardColumnWidths).length > 0;
        if (hasExplicitWidths) el.style.tableLayout = 'fixed';

        // === ШАПКА ===
        const thead = document.createElement('thead');
        const headRow = document.createElement('tr');

        const eyeTh = document.createElement('th');
        eyeTh.className = 'board-widget-table-num-cell';
        const eyeBtn = document.createElement('button');
        eyeBtn.className = 'board-widget-table-eye-btn';
        eyeBtn.textContent = node.boardShowRowNumbers ? '●' : '‿';
        eyeBtn.title = node.boardShowRowNumbers ? 'Скрыть номера строк' : 'Показать номера строк';
        eyeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            node.boardShowRowNumbers = !node.boardShowRowNumbers;
            window.boardManager?.renderActiveBoard();
        });
        eyeTh.appendChild(eyeBtn);
        headRow.appendChild(eyeTh);

        table.columns.forEach((col, colIdx) => {
            const th = document.createElement('th');
            th.className = 'board-widget-table-sortable';
            // Раунд 49 - булев столбец центрируем целиком (шапка + ячейки-
            // чекбоксы), а не оставляем шапку слева от центрированных
            // чекбоксов - col.format у таких столбцов обычно 'text'
            // (XlsxImportNode и т.п. не знают отдельного формата "bool"),
            // поэтому определяем "булевость" по факту наличия булевых
            // значений в столбце, а не по объявленному формату
            const isBoolColumn = col.format === 'boolean' || col.values.some(v => typeof v === 'boolean');
            if (isBoolColumn) th.style.textAlign = 'center';
            else if (col.format !== 'text') th.classList.add('align-right');
            if (col.color) th.style.color = col.color;
            // Раунд 93 (чек-лист, п.4.1) - ручная ширина ЭТОГО виджета
            // Доски в приоритете над col.width источника.
            const manualWidth = node.boardColumnWidths[col.header];
            const effectiveWidth = manualWidth || col.width || null;
            if (effectiveWidth) {
                th.style.width = effectiveWidth + 'px';
                th.style.maxWidth = effectiveWidth + 'px';
            }

            const label = document.createElement('span');
            label.textContent = col.header;
            th.appendChild(label);

            const isSortActive = node.boardSortColumn === colIdx;
            const sortIcon = document.createElement('span');
            sortIcon.className = 'board-widget-table-sort-icon' + (isSortActive ? ' active' : '');
            sortIcon.textContent = isSortActive ? (node.boardSortDirection === 'asc' ? '↑' : '↓') : '↕';
            th.appendChild(sortIcon);

            attachColumnResizeHandle(th, effectiveWidth || 90, (finalWidth) => {
                node.boardColumnWidths[col.header] = finalWidth;
                window.boardManager?.renderActiveBoard();
            });

            th.addEventListener('click', (e) => {
                e.stopPropagation();
                if (node.boardSortColumn !== colIdx) {
                    node.boardSortColumn = colIdx;
                    node.boardSortDirection = 'asc';
                } else if (node.boardSortDirection === 'asc') {
                    node.boardSortDirection = 'desc';
                } else {
                    node.boardSortColumn = null;
                    node.boardSortDirection = null;
                }
                window.boardManager?.renderActiveBoard();
            });

            headRow.appendChild(th);
        });
        thead.appendChild(headRow);
        el.appendChild(thead);

        // === ТЕЛО ===
        const tbody = document.createElement('tbody');
        rowOrder.forEach((srcRowIndex, displayIndex) => {
            const row = document.createElement('tr');

            const numTd = document.createElement('td');
            numTd.className = 'board-widget-table-num-cell';
            numTd.style.visibility = node.boardShowRowNumbers ? 'visible' : 'hidden';
            numTd.textContent = String(displayIndex + 1);
            row.appendChild(numTd);

            table.columns.forEach(col => {
                const td = document.createElement('td');
                const v = col.values[srcRowIndex];
                const hasValue = v !== undefined && v !== null && v !== '';
                // Раунд 56 - не только "значение УЖЕ булево" (typeof), но
                // и "столбец ЯВНО объявлен логическим" (col.format ===
                // 'boolean', TableFormatNode) - см. тот же приём в
                // tableViewerNode.js
                const isBoolValue = typeof v === 'boolean' || col.format === 'boolean';
                if (col.format !== 'text') td.classList.add('align-right');
                if (col.color) td.style.color = col.color;
                if (col.width) {
                    td.style.width = col.width + 'px';
                    td.style.maxWidth = col.width + 'px';
                }

                if (isBoolValue) {
                    // Раунд 49 - см. тот же приём и докстринг в
                    // tableViewerNode.js - чекбокс вместо текста "true"/"false"
                    td.classList.remove('align-right');
                    td.style.textAlign = 'center';
                    const checkbox = document.createElement('input');
                    checkbox.type = 'checkbox';
                    checkbox.className = 'table-cell-checkbox';
                    checkbox.checked = hasValue ? Helpers.coerceBool(v) : false;
                    checkbox.disabled = true;
                    td.appendChild(checkbox);
                } else if (hasValue && col.format === 'percent') {
                    td.classList.add('board-widget-table-percent-cell');
                    const pct = Math.max(0, Math.min(100, v));
                    const bar = document.createElement('div');
                    bar.className = 'board-widget-table-bar';
                    bar.style.width = pct + '%';
                    if (col.color) bar.style.background = col.color;
                    td.appendChild(bar);

                    const textSpan = document.createElement('span');
                    textSpan.className = 'board-widget-table-cell-text';
                    textSpan.textContent = Helpers.formatByType(v, col.format, col.decimals);
                    td.appendChild(textSpan);
                } else {
                    td.textContent = hasValue
                        ? Helpers.formatByType(v, col.format, col.decimals)
                        : (col.format === 'text' ? '' : '—');
                }

                row.appendChild(td);
            });

            tbody.appendChild(row);
        });
        el.appendChild(tbody);

        // === ИТОГО ===
        const hasTotals = table.columns.some(col => col.totalType);
        if (hasTotals) {
            const tfoot = document.createElement('tfoot');
            const totalRow = document.createElement('tr');

            const numTd = document.createElement('td');
            numTd.className = 'board-widget-table-num-cell';
            numTd.textContent = 'Σ';
            numTd.title = 'Итого';
            totalRow.appendChild(numTd);

            table.columns.forEach(col => {
                const td = document.createElement('td');
                if (col.format !== 'text') td.classList.add('align-right');
                if (col.color) td.style.color = col.color;
                if (col.width) {
                    td.style.width = col.width + 'px';
                    td.style.maxWidth = col.width + 'px';
                }
                const agg = table.aggregate(col);
                td.textContent = agg !== null
                    ? Helpers.formatByType(agg, col.format, col.decimals)
                    : '';
                totalRow.appendChild(td);
            });
            tfoot.appendChild(totalRow);
            el.appendChild(tfoot);
        }

        return el;
    }
};
