/**
 * SPDX-License-Identifier: MIT
 * SPDX-FileCopyrightText: 2024 NodeCalculate Team
 * SPDX-FileCopyrightText: 2024 Pavel Fomin
 *
 * @file    treeViewerNode.js
 * @brief   Просмотр иерархии "Дерева" - раскрываемые/сворачиваемые вложенные ветки
 * @author  Pavel Fomin
 * @version 1.8.42
 * @see     https://github.com/GhostPWLk1n/NodeCalculator.git
 */

import { BaseNode } from './baseNode.js';
import { Helpers } from '../utils/helpers.js';
import { SocketFactory } from '../utils/socketFactory.js';

/**
 * TreeViewerNode ("Просмотр дерева") - Раунд 56, план 1.6.0 п.8 (по
 * просьбе Mr.D - "сделать по примеру таблиц"). `TreeNode.tableData`
 * (плоский свод - строка на КАЖДУЮ НЕПОСРЕДСТВЕННУЮ ветку, см. Раунд 55)
 * не показывает саму СТРУКТУРУ - если ветка сама является вложенным
 * `TreeNode`, в своде видно только её ИТОГОВОЕ число, а не то, из каких
 * под-веток оно сложилось. Эта нода читает `srcNode.branches`
 * (`TreeNode`/`TreeFormatNode` - оба его прокидывают, см. их докстринги)
 * и рекурсивно обходит ИМЕННО ЖИВУЮ иерархию графа - для каждой ветки,
 * которая сама несёт `.branches`, спускается на уровень ниже, вместо
 * того чтобы просто показать её агрегированное число.
 *
 * Значения строки (кроме имени) берутся из tableData РОДИТЕЛЬСКОГО
 * уровня - тот самый готовый агрегат, который родитель уже посчитал для
 * ЭТОЙ конкретной ветки (см. _buildRows()) - никакой повторной агрегации
 * здесь не происходит, только чтение уже готовых чисел с нужного уровня.
 *
 * Список отображаемых полей (шапка) берётся с САМОГО ВЕРХНЕГО уровня
 * (корневого подключённого дерева) - упрощение: разные уровни в теории
 * могут иметь разный набор совпавших полей, но в реальном использовании
 * (одна и та же структура таблиц на всех уровнях) они обычно совпадают.
 *
 * ЛИСТЬЯ (Раунд 57, расширено в Раунде 63) - ветка, которая НЕ является
 * вложенным `TreeNode` (обычная таблица ИЛИ список), тоже может
 * раскрываться - показывая СОБСТВЕННЫЕ строки исходных данных, а не
 * только уже посчитанный родителем итог по ней (см. _walkLeafRows()/
 * _walkLeafListRows()). Имя строки листа-таблицы - из ПЕРВОГО текстового
 * столбца исходной таблицы, если есть, иначе "Строка N"; имя строки
 * листа-списка - `item.name` каждого элемента. Строки листа - конечные,
 * дальше не разворачиваются.
 */
export class TreeViewerNode extends BaseNode {
    constructor(id, type, x, y, config = {}) {
        super(id, type, x, y, config);
        this.inputs = 1;
        this.inputSockets = [0];
        this.outputs = 0;
        this.width = config.width || 320;
        // Путь узла (строка вида "root/0/1") -> false, если свёрнут -
        // отсутствие записи = развёрнут по умолчанию (см. _buildRows())
        this.expandedState = config.expandedState || {};

        this._srcNode = null;
    }

    createContent() {
        const content = document.createElement('div');
        content.className = 'node-content';
        content.style.cssText = 'width: 100%;';

        const inRow = document.createElement('div');
        inRow.style.cssText = 'display:flex; align-items:center; gap:6px; margin-bottom:4px;';
        const inSocket = SocketFactory.createSocket({
            nodeId: this.id, socketType: 'input', index: 0, isData: true,
            title: 'Дерево для просмотра иерархии'
        });
        inRow.appendChild(inSocket);
        const sourceLabel = document.createElement('span');
        sourceLabel.className = 'tree-viewer-source-label';
        sourceLabel.style.cssText = 'color:var(--md-text-secondary); font-size:11px; flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;';
        sourceLabel.textContent = this._srcNode ? (this._srcNode.customName || this._srcNode.getDisplayName?.() || 'источник') : 'не подключено';
        inRow.appendChild(sourceLabel);
        content.appendChild(inRow);

        const wrap = document.createElement('div');
        wrap.className = 'tree-viewer-wrap';
        this.renderTree(wrap);
        content.appendChild(wrap);

        return content;
    }

    // Список полей (шапка) - с корневого уровня, см. докстринг класса
    _getFieldHeaders() {
        if (!this._srcNode?.tableData?.columns) return [];
        return this._srcNode.tableData.columns.filter(c => c.header !== 'Ветка');
    }

    // Рекурсивно обходит ЖИВУЮ иерархию (branches[i].srcNode.branches),
    // строя ПЛОСКИЙ список видимых строк с учётом того, что свёрнуто
    _buildRows() {
        const rows = [];
        const root = this._srcNode;
        if (!root || !Array.isArray(root.branches)) return rows;

        const walk = (branches, parentTable, depth, pathPrefix) => {
            branches.forEach((branch, i) => {
                const path = `${pathPrefix}/${i}`;
                const isNestedTree = !!(branch.srcNode && Array.isArray(branch.srcNode.branches) && branch.srcNode.branches.length > 0);
                // Раунд 57 - ветка-ЛИСТ (обычная таблица, не вложенное
                // "Дерево") тоже может раскрываться - показывая СОБСТВЕННЫЕ
                // строки, а не только уже посчитанный родителем итог по
                // ней. Раньше лист был всегда "тупиковым" - видно было
                // только агрегированное число, без возможности заглянуть
                // внутрь исходной таблицы.
                const leafTable = (!isNestedTree && branch.srcNode?.tableData?.columns?.length > 0)
                    ? branch.srcNode.tableData
                    : null;
                // Раунд 63 - ветка-СПИСОК (ListInputNode/ListConvertNode
                // подключены НАПРЯМУЮ как ветка, без промежуточной таблицы) -
                // тоже раскрывается, тем же принципом, что и таблица - иначе
                // структуры, собранные ВРУЧНУЮ через "Дерево" (список
                // как лист, а не только таблица), было бы нельзя развернуть
                const leafList = (!isNestedTree && !leafTable && branch.srcNode?.listData?.items?.length > 0)
                    ? branch.srcNode
                    : null;
                const hasLeafRows = !!(leafTable && leafTable.rowCount > 0);
                const hasLeafList = !!leafList;
                const hasChildren = isNestedTree || hasLeafRows || hasLeafList;

                const values = (parentTable?.columns || [])
                    .filter(c => c.header !== 'Ветка')
                    .map(c => c.values[i]);
                const expanded = this.expandedState[path] !== false;

                rows.push({ path, depth, name: branch.name, values, hasChildren, expanded, isLeafRow: false });

                if (hasChildren && expanded) {
                    if (isNestedTree) {
                        walk(branch.srcNode.branches, branch.srcNode.tableData, depth + 1, path);
                    } else if (hasLeafRows) {
                        this._walkLeafRows(leafTable, depth + 1, path, rows);
                    } else if (hasLeafList) {
                        this._walkLeafListRows(leafList, depth + 1, path, rows);
                    }
                }
            });
        };

        walk(root.branches, root.tableData, 0, 'root');
        return rows;
    }

    // Разворачивает лист (обычную таблицу, см. _buildRows()) в отдельные
    // строки - каждая строка исходной таблицы становится своей записью в
    // дереве, без возможности сворачивания дальше (это уже конечные
    // данные, а не ветка). Имя строки - значение из ПЕРВОГО текстового
    // столбца самой таблицы, если такой есть, иначе просто "Строка N".
    // Значения сопоставляются с полями КОРНЯ по имени заголовка - если у
    // листа нет столбца с таким именем, ячейка просто пустая.
    _walkLeafRows(leafTable, depth, pathPrefix, rows) {
        const rootHeaders = this._getFieldHeaders();
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
    }

    // Разворачивает лист-СПИСОК (Раунд 63) в отдельные строки - каждый
    // элемент списка {name, value} становится своей записью. У списка,
    // в отличие от таблицы, нет НАБОРА именованных столбцов - только ОДНО
    // значение на элемент, поэтому оно проставляется в столбец корня,
    // ИМЯ которого совпадает с тем, как эта ветка "видна" родителю (см.
    // TreeNode._getBranchColumns() - список заворачивается в столбец по
    // имени ноды) - в остальных столбцах строки пусто.
    _walkLeafListRows(srcNode, depth, pathPrefix, rows) {
        const rootHeaders = this._getFieldHeaders();
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
    }

    renderTree(container) {
        container.innerHTML = '';

        const root = this._srcNode;
        if (!root || !Array.isArray(root.branches) || root.branches.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'tree-viewer-empty';
            empty.textContent = 'Подключите "Дерево" (или "Оформление дерева")';
            container.appendChild(empty);
            return;
        }

        const headers = this._getFieldHeaders();

        // === ШАПКА ===
        const headerRow = document.createElement('div');
        headerRow.className = 'tree-viewer-header-row';
        const headerNameCell = document.createElement('div');
        headerNameCell.className = 'tree-viewer-name-cell tree-viewer-header-cell';
        headerNameCell.textContent = 'Ветка';
        headerRow.appendChild(headerNameCell);
        headers.forEach(col => {
            const cell = document.createElement('div');
            cell.className = 'tree-viewer-value-cell tree-viewer-header-cell';
            cell.textContent = col.header;
            headerRow.appendChild(cell);
        });
        container.appendChild(headerRow);

        // === СТРОКИ (рекурсивно построенный плоский список) ===
        const rows = this._buildRows();
        rows.forEach(row => {
            const rowEl = document.createElement('div');
            // Роль строки для стилизации (Раунд 70, по просьбе Mr.D -
            // "сейчас всё одного цвета, непонятно где корень/ветка/лист"):
            //   root   - depth===0 (непосредственная ветка корня)
            //   branch - depth>0 и есть дети (вложенное поддерево)
            //   leaf   - строка листа (isLeafRow) ИЛИ ветка без детей
            const role = row.isLeafRow ? 'leaf' : (row.depth === 0 ? 'root' : (row.hasChildren ? 'branch' : 'leaf'));
            rowEl.className = `tree-viewer-row tree-viewer-row-${role}`;
            rowEl.dataset.depth = String(row.depth);

            const nameCell = document.createElement('div');
            nameCell.className = 'tree-viewer-name-cell';

            // Направляющие линии отступа (Раунд 70) - одна на уровень
            // вложенности, вместо голого paddingLeft: помогает считать
            // глубину на глаз в широком дереве, тот же приём, что в
            // файловых деревьях IDE (VS Code и т.п.)
            for (let d = 0; d < row.depth; d++) {
                const guide = document.createElement('span');
                guide.className = 'tree-viewer-guide';
                nameCell.appendChild(guide);
            }

            if (row.hasChildren) {
                const toggle = document.createElement('span');
                toggle.className = 'tree-viewer-toggle';
                toggle.textContent = row.expanded ? '▾' : '▸';
                toggle.title = row.expanded ? 'Свернуть' : 'Развернуть';
                toggle.addEventListener('mousedown', (e) => e.stopPropagation());
                toggle.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.expandedState[row.path] = !row.expanded;
                    this.renderTree(container);
                });
                nameCell.appendChild(toggle);
            } else {
                const spacer = document.createElement('span');
                spacer.className = 'tree-viewer-toggle-spacer';
                nameCell.appendChild(spacer);
            }

            const nameText = document.createElement('span');
            nameText.className = 'tree-viewer-name-text';
            nameText.textContent = row.name;
            nameText.title = row.name;
            nameCell.appendChild(nameText);

            rowEl.appendChild(nameCell);

            headers.forEach((col, i) => {
                const valCell = document.createElement('div');
                valCell.className = 'tree-viewer-value-cell';
                const v = row.values[i];
                const hasValue = v !== undefined && v !== null && v !== '';

                if (hasValue && col.format === 'boolean') {
                    valCell.classList.add('tree-viewer-value-cell-center');
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

            container.appendChild(rowEl);
        });
    }

    calculate(nodeManager) {
        const connections = window.connectionManager?.getConnections() || [];
        const conn = connections.find(c => c.targetNodeId === this.id && c.targetSocket === 0);
        this._srcNode = conn ? nodeManager.getNode(conn.sourceNodeId) : null;

        this.value = (this._srcNode && Array.isArray(this._srcNode.branches))
            ? this._srcNode.branches.length
            : 0;
        return this.value;
    }

    updateDisplay(element) {
        const sourceLabel = element.querySelector('.tree-viewer-source-label');
        if (sourceLabel) {
            sourceLabel.textContent = this._srcNode
                ? (this._srcNode.customName || this._srcNode.getDisplayName?.() || 'источник')
                : 'не подключено';
        }

        const wrap = element.querySelector('.tree-viewer-wrap');
        if (wrap) this.renderTree(wrap);
    }
}
