/**
 * SPDX-License-Identifier: MIT
 * SPDX-FileCopyrightText: 2024 NodeCalculate Team
 * SPDX-FileCopyrightText: 2024 Pavel Fomin
 *
 * @file    treeWidgetRenderer.js
 * @brief   Общий код виджета Доски "дерево" - используется TreeNode/TreeFormatNode
 * @author  Pavel Fomin
 * @version 1.7.4
 * @see     https://github.com/GhostPWLk1n/NodeCalculator.git
 */

import { Helpers } from './helpers.js';

/**
 * TreeWidgetRenderer - до Раунда 71 `TreeNode.getDashboardWidget()`/
 * `TreeFormatNode.getDashboardWidget()` показывали на Доске ПЛОСКИЙ свод
 * через `TableWidgetRenderer` (тот же виджет, что у обычных таблиц) - по
 * прямой жалобе Mr.D: "в дашбордах дерево по-прежнему рисуется просто
 * как таблица, должно быть дерево как в просмотре дерева". Этот модуль -
 * порт `TreeViewerNode` (раскрываемая/сворачиваемая иерархия, цвет по
 * роли узла - Раунд 70) на рельсы виджета Доски: та же логика обхода
 * (`_buildRows`/`_walkLeafRows`/`_walkLeafListRows`), только не методы
 * класса, а чистые функции, принимающие `root`/`expandedState` явным
 * параметром вместо `this`.
 *
 * build(node) принимает НОДУ-ИСТОЧНИК (TreeNode/TreeFormatNode) - нужны:
 *   node.branches               - живая иерархия (см. treeNode.js)
 *   node.tableData               - свод корневого уровня (заголовки полей)
 *   node.dashboardExpandedState  - object, путь -> false если свёрнут
 *                                  (мутируется кликом ПРЯМО НА ВИДЖЕТЕ,
 *                                  тот же принцип, что node.boardSortColumn
 *                                  у TableWidgetRenderer - состояние
 *                                  хранится на ноде, не в этом модуле)
 *
 * Клик по стрелке разворачивания мутирует node.dashboardExpandedState и
 * вызывает window.boardManager.renderActiveBoard() - тот же паттерн, что
 * уже применяется для клика по заголовку сортировки в TableWidgetRenderer
 * (см. её докстринг) - полная пересборка виджета, ничего не патчим точечно.
 */
export const TreeWidgetRenderer = {
    _getFieldHeaders(root) {
        if (!root?.tableData?.columns) return [];
        return root.tableData.columns.filter(c => c.header !== 'Ветка');
    },

    // Порт TreeViewerNode._buildRows() - см. её докстринг за подробным
    // объяснением обхода (вложенные "Деревья" рекурсивно, листья-таблицы/
    // листья-списки раскрываются в собственные строки).
    _buildRows(root, expandedState) {
        const rows = [];
        if (!root || !Array.isArray(root.branches)) return rows;

        const walk = (branches, parentTable, depth, pathPrefix) => {
            branches.forEach((branch, i) => {
                const path = `${pathPrefix}/${i}`;
                const isNestedTree = !!(branch.srcNode && Array.isArray(branch.srcNode.branches) && branch.srcNode.branches.length > 0);
                const leafTable = (!isNestedTree && branch.srcNode?.tableData?.columns?.length > 0)
                    ? branch.srcNode.tableData
                    : null;
                const leafList = (!isNestedTree && !leafTable && branch.srcNode?.listData?.items?.length > 0)
                    ? branch.srcNode
                    : null;
                const hasLeafRows = !!(leafTable && leafTable.rowCount > 0);
                const hasLeafList = !!leafList;
                const hasChildren = isNestedTree || hasLeafRows || hasLeafList;

                const values = (parentTable?.columns || [])
                    .filter(c => c.header !== 'Ветка')
                    .map(c => c.values[i]);
                const expanded = expandedState[path] !== false;

                rows.push({ path, depth, name: branch.name, values, hasChildren, expanded, isLeafRow: false });

                if (hasChildren && expanded) {
                    if (isNestedTree) {
                        walk(branch.srcNode.branches, branch.srcNode.tableData, depth + 1, path);
                    } else if (hasLeafRows) {
                        this._walkLeafRows(leafTable, depth + 1, path, rows, root);
                    } else if (hasLeafList) {
                        this._walkLeafListRows(leafList, depth + 1, path, rows, root);
                    }
                }
            });
        };

        walk(root.branches, root.tableData, 0, 'root');
        return rows;
    },

    _walkLeafRows(leafTable, depth, pathPrefix, rows, root) {
        const rootHeaders = this._getFieldHeaders(root);
        const nameCol = leafTable.columns.find(c => c.format === 'text');

        for (let r = 0; r < leafTable.rowCount; r++) {
            const path = `${pathPrefix}/leaf${r}`;
            const name = nameCol && nameCol.values[r] !== undefined && nameCol.values[r] !== null && nameCol.values[r] !== ''
                ? String(nameCol.values[r])
                : `Строка ${r + 1}`;
            const values = rootHeaders.map(col => {
                const leafCol = leafTable.columns.find(c => c.header === col.header);
                return leafCol ? leafCol.values[r] : undefined;
            });
            rows.push({ path, depth, name, values, hasChildren: false, expanded: true, isLeafRow: true });
        }
    },

    _walkLeafListRows(srcNode, depth, pathPrefix, rows, root) {
        const rootHeaders = this._getFieldHeaders(root);
        const columnName = srcNode.customName || srcNode.getDisplayName?.() || 'Значение';
        const colIndex = rootHeaders.findIndex(col => col.header === columnName);

        srcNode.listData.items.forEach((item, r) => {
            const path = `${pathPrefix}/listleaf${r}`;
            const name = item.name !== undefined && item.name !== null && item.name !== ''
                ? String(item.name)
                : `Строка ${r + 1}`;
            const values = rootHeaders.map((col, i) => (i === colIndex ? item.value : undefined));
            rows.push({ path, depth, name, values, hasChildren: false, expanded: true, isLeafRow: true });
        });
    },

    build(node) {
        const wrap = document.createElement('div');
        wrap.className = 'board-widget-tree';

        if (!node || !Array.isArray(node.branches) || node.branches.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'board-widget-tree-empty';
            empty.textContent = 'Нет данных для отображения дерева';
            wrap.appendChild(empty);
            return wrap;
        }

        if (!node.dashboardExpandedState) node.dashboardExpandedState = {};

        // Зебра/линии - те же поля, что уже читает TableWidgetRenderer у
        // TreeFormatNode (this.boardZebra и т.п., см. её докстринг) -
        // TreeNode их не заводит, там просто останутся undefined/falsy,
        // без ошибок.
        if (node.boardZebra) wrap.classList.add('board-widget-tree-zebra');
        if (node.boardShowRowLines === false) wrap.classList.add('board-widget-tree-no-row-lines');
        if (node.boardShowColumnLines) wrap.classList.add('board-widget-tree-col-lines');

        const headers = this._getFieldHeaders(node);

        const headerRow = document.createElement('div');
        headerRow.className = 'board-widget-tree-header-row';
        const headerNameCell = document.createElement('div');
        headerNameCell.className = 'board-widget-tree-name-cell board-widget-tree-header-cell';
        headerNameCell.textContent = 'Ветка';
        headerRow.appendChild(headerNameCell);
        headers.forEach(col => {
            const cell = document.createElement('div');
            cell.className = 'board-widget-tree-value-cell board-widget-tree-header-cell';
            cell.textContent = col.header;
            headerRow.appendChild(cell);
        });
        wrap.appendChild(headerRow);

        const rows = this._buildRows(node, node.dashboardExpandedState);
        rows.forEach((row, rowIndex) => {
            const rowEl = document.createElement('div');
            const role = row.isLeafRow ? 'leaf' : (row.depth === 0 ? 'root' : (row.hasChildren ? 'branch' : 'leaf'));
            rowEl.className = `board-widget-tree-row board-widget-tree-row-${role} board-widget-tree-row-${rowIndex % 2 === 0 ? 'even' : 'odd'}`;

            const nameCell = document.createElement('div');
            nameCell.className = 'board-widget-tree-name-cell';

            for (let d = 0; d < row.depth; d++) {
                const guide = document.createElement('span');
                guide.className = 'board-widget-tree-guide';
                nameCell.appendChild(guide);
            }

            if (row.hasChildren) {
                const toggle = document.createElement('span');
                toggle.className = 'board-widget-tree-toggle';
                toggle.textContent = row.expanded ? '▾' : '▸';
                toggle.title = row.expanded ? 'Свернуть' : 'Развернуть';
                // Клик по стрелке - НЕ выбор виджета (иначе всплыл бы до
                // widgetEl -> selectWidget() -> полная пересборка Доски,
                // тот же приём защиты, что уже применён у редактируемых
                // полей Числа/Списка на Доске, см. numberNode.js)
                toggle.addEventListener('mousedown', (e) => e.stopPropagation());
                toggle.addEventListener('click', (e) => {
                    e.stopPropagation();
                    node.dashboardExpandedState[row.path] = !row.expanded;
                    window.boardManager?.renderActiveBoard();
                });
                nameCell.appendChild(toggle);
            } else {
                const spacer = document.createElement('span');
                spacer.className = 'board-widget-tree-toggle-spacer';
                nameCell.appendChild(spacer);
            }

            const nameText = document.createElement('span');
            nameText.className = 'board-widget-tree-name-text';
            nameText.textContent = row.name;
            nameText.title = row.name;
            nameCell.appendChild(nameText);

            rowEl.appendChild(nameCell);

            headers.forEach((col, i) => {
                const valCell = document.createElement('div');
                valCell.className = 'board-widget-tree-value-cell';
                const v = row.values[i];
                const hasValue = v !== undefined && v !== null && v !== '';

                if (hasValue && col.format === 'boolean') {
                    valCell.classList.add('board-widget-tree-value-cell-center');
                    const checkbox = document.createElement('input');
                    checkbox.type = 'checkbox';
                    checkbox.className = 'table-cell-checkbox';
                    checkbox.checked = Helpers.coerceBool(v);
                    checkbox.disabled = true;
                    valCell.appendChild(checkbox);
                } else {
                    valCell.textContent = hasValue ? Helpers.formatByType(v, col.format, col.decimals) : '—';
                }
                rowEl.appendChild(valCell);
            });

            wrap.appendChild(rowEl);
        });

        return wrap;
    }
};
