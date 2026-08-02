/**
 * SPDX-License-Identifier: MIT
 * SPDX-FileCopyrightText: 2024 NodeCalculate Team
 * SPDX-FileCopyrightText: 2024 Pavel Fomin
 *
 * @file    treeToTableNode.js
 * @brief   Обработчик: разворачивает иерархию "Дерева" в плоскую таблицу (Data) с выбором глубины и компоновки
 * @author  Pavel Fomin
 * @version 1.7.45
 * @see     https://github.com/GhostPWLk1n/NodeCalculator.git
 */

import { BaseNode } from './baseNode.js';
import { TableData } from '../utils/dataTypes.js';
import { SocketFactory } from '../utils/socketFactory.js';
import { TableWidgetRenderer } from '../utils/tableWidgetRenderer.js';

/**
 * TreeToTableNode ("Дерево → Таблица") - Раунд 70, курс 1.7. Читает
 * `srcNode.branches` (тот же контракт, что уже использует
 * `TreeViewerNode` - см. её докстринг) и разворачивает иерархию в ОДНУ
 * плоскую Data-таблицу - в отличие от просмотрщика, результат можно
 * подключить дальше по графу (Отсеять/Слияние/Экспорт и т.п.), которым
 * нужна именно плоская таблица, а не живая структура с ссылками на ноды.
 *
 * ГЛУБИНА (this.maxDepth) - на каком уровне вложенности останавливаться
 * и превращать ветку в ОДНУ строку с её уже готовым агрегатом, вместо
 * того чтобы разворачивать её саму дальше:
 *   0       - только непосредственные ветки корня (эквивалент простого
 *             подключения TreeNode.tableData к "Просмотру таблицы")
 *   1, 2...  - ещё N уровней вложенных "Деревьев" разворачиваются в
 *             отдельные строки
 *   'leaves' - без ограничения, до самых глубоких данных (тот же полный
 *             обход, что делает TreeViewerNode, включая раскрытие
 *             листьев-таблиц/листьев-списков в их собственные строки)
 *
 * КОМПОНОВКА (this.layoutMode) - как разворачивать инфомацию О ПРЕДКАХ
 * строки (по прямому запросу Mr.D - три варианта под разные сценарии
 * использования результата):
 *   'keys'    - столбец на каждый уровень иерархии ("Уровень 1", "Уровень
 *               2"...), имя предка на своём уровне, пусто - если строка
 *               мельче. Для использования таблицы КАК БАЗЫ ДАННЫХ - можно
 *               фильтровать/группировать по любому уровню отдельно.
 *   'indent'  - "табуляция": каждый уровень вложенности - СВОЙ столбец
 *               ("Уровень 1", "Уровень 2"...), имя ветки стоит только в
 *               столбце своей глубины - классическая "лестница" при
 *               простом взгляде на таблицу (не путать с 'keys' - там в
 *               КАЖДОМ столбце до своей глубины стоит имя предка, здесь -
 *               только в СВОЁМ, остальные пустые).
 *   'headers' - вложенная ветка сначала эмитирует СВОЮ строку-заголовок
 *               (имя в столбце "Название", в остальных столбцах - уже
 *               готовый агрегат для этой ветки, ПО НАСТРОЙКАМ АГРЕГАЦИИ
 *               самой ноды "Дерево" - сумма/макс/мин/среднее/первое,
 *               ничего заново не считаем, см. columnAggregation в
 *               treeNode.js), а ЗАТЕМ - строки её содержимого. Тот же
 *               паттерн, что "разделы с промежуточным итогом" в типичном
 *               Excel-отчёте - для ЭКСПОРТА В EXCEL, где это самый
 *               привычный способ читать вложенность.
 *
 * НАБОР ПОЛЕЙ (шапка) - берётся с КОРНЕВОГО уровня (root.tableData),
 * тот же осознанный упрощённый выбор, что уже сделан в TreeViewerNode -
 * см. её докстринг про то, почему это разумное упрощение на практике.
 */
export class TreeToTableNode extends BaseNode {
    constructor(id, type, x, y, config = {}) {
        super(id, type, x, y, config);
        this.inputs = 1;
        this.inputSockets = [0];
        this.outputs = 1;
        this.width = config.width || 220;

        this.layoutMode = config.layoutMode || 'keys'; // 'keys' | 'indent' | 'headers'
        // Число (0,1,2...) или строка 'leaves' - хранится строкой в
        // config, т.к. select всегда отдаёт строку; при чтении приводим.
        this.maxDepth = config.maxDepth ?? 'leaves';

        this._sourceName = null;
        this.tableData = new TableData();

        // Виджет Доски - тот же общий рендерер, что у остальных
        // табличных нод (TableWidgetRenderer)
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
        content.style.cssText = 'width: 100%; min-width: 170px;';

        const inRow = document.createElement('div');
        inRow.style.cssText = 'display:flex; align-items:center; gap:6px;';
        const inSocket = SocketFactory.createSocket({
            nodeId: this.id, socketType: 'input', index: 0, isData: true,
            title: 'Дерево, которое разворачиваем в плоскую таблицу'
        });
        inRow.appendChild(inSocket);
        const sourceLabel = document.createElement('span');
        sourceLabel.className = 'tree-to-table-source-label';
        sourceLabel.style.cssText = 'color:var(--md-text-secondary); font-size:11px; flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;';
        sourceLabel.textContent = this._statusText();
        inRow.appendChild(sourceLabel);
        content.appendChild(inRow);

        const hintRow = document.createElement('div');
        hintRow.style.cssText = 'padding-left:20px;';
        const hint = document.createElement('span');
        hint.style.cssText = 'color:var(--md-text-disabled); font-size:10px;';
        hint.textContent = '→ глубина и компоновка — в панели справа';
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
        outLabel.textContent = 'Таблица (DATA):';
        outLabel.style.cssText = 'color:var(--md-text-secondary); font-size:11px; flex:1;';
        outRow.appendChild(outLabel);
        const outSocket = SocketFactory.createSocket({
            nodeId: this.id, socketType: 'output', index: 0, isData: true,
            title: 'Плоская таблица - иерархия развёрнута'
        });
        outRow.appendChild(outSocket);
        content.appendChild(outRow);

        return content;
    }

    _statusText() {
        if (!this._sourceName) return 'не подключено';
        if (this.tableData.columns.length === 0) return `${this._sourceName} — источник не Дерево`;
        return `${this._sourceName} — ${this.tableData.rowCount} стр.`;
    }

    // Список полей (шапка) - с корневого уровня, см. докстринг класса.
    // "Ветка" - служебное имя branches у TreeNode.tableData, не поле.
    _getFieldHeaders(root) {
        if (!root?.tableData?.columns) return [];
        return root.tableData.columns.filter(c => c.header !== 'Ветка');
    }

    _depthLimit() {
        return this.maxDepth === 'leaves' ? Infinity : Number(this.maxDepth);
    }

    // Рекурсивный обход живой иерархии - тот же принцип, что
    // TreeViewerNode._buildRows()/_walkLeafRows()/_walkLeafListRows(), но
    // без учёта развёрнуто/свёрнуто (сворачивания тут нет, только глубина)
    // и с накоплением ПОЛНОГО пути предков (нужен для режимов 'keys'/'headers').
    _walk(branches, parentTable, depth, ancestors, headers, out) {
        const limit = this._depthLimit();

        branches.forEach((branch, i) => {
            const isNestedTree = !!(branch.srcNode && Array.isArray(branch.srcNode.branches) && branch.srcNode.branches.length > 0);
            const leafTable = (!isNestedTree && branch.srcNode?.tableData?.columns?.length > 0)
                ? branch.srcNode.tableData
                : null;
            const leafList = (!isNestedTree && !leafTable && branch.srcNode?.listData?.items?.length > 0)
                ? branch.srcNode
                : null;
            const hasChildren = isNestedTree || !!(leafTable && leafTable.rowCount > 0) || !!leafList;

            const ownValues = headers.map(h => {
                const col = (parentTable?.columns || []).find(c => c.header === h.header);
                return col ? col.values[i] : undefined;
            });

            if (hasChildren && depth < limit) {
                // Багфикс (Раунд 72): в 'indent' (лестница) КАЖДЫЙ узел -
                // корень, ветка, лист - должен получить свою строку в
                // своём столбце уровня (см. докстринг класса и ASCII-схему
                // там же). Раньше строку для промежуточной ветки эмитировал
                // ТОЛЬКО 'headers' - 'indent' просто "проваливался" в
                // рекурсию без своей строки, поэтому в итоговой таблице
                // оставались одни листья, а корень/ветки пропадали.
                // 'keys' сознательно НЕ добавлен сюда - там одна строка
                // на ЛИСТ с полным путём предков по столбцам, а не
                // отдельная строка на каждый уровень (иначе таблицу было
                // бы неудобно использовать как базу данных - агрегаты
                // веток мешались бы со строками-фактами).
                if (this.layoutMode === 'headers' || this.layoutMode === 'indent') {
                    // ownValues - уже готовый агрегат, который ROOT-уровень
                    // (parentTable) посчитал для ЭТОЙ ветки ПО СВОИМ
                    // настройкам TreeNode.columnAggregation (сумма/макс/
                    // мин/среднее/первое) - та же цифра, что видна в самой
                    // ноде "Дерево" и в "Просмотре дерева" для этой ветки.
                    // Ничего заново не агрегируем ("смотреть как
                    // определено виджетом Дерево").
                    out.push({
                        depth, path: [...ancestors, branch.name], name: branch.name,
                        values: ownValues, isGroupHeader: true
                    });
                }
                const nextAncestors = [...ancestors, branch.name];
                if (isNestedTree) {
                    this._walk(branch.srcNode.branches, branch.srcNode.tableData, depth + 1, nextAncestors, headers, out);
                } else if (leafTable) {
                    this._walkLeafTable(leafTable, depth + 1, nextAncestors, headers, out);
                } else if (leafList) {
                    this._walkLeafList(leafList, depth + 1, nextAncestors, headers, out);
                }
            } else {
                out.push({ depth, path: [...ancestors, branch.name], name: branch.name, values: ownValues, isGroupHeader: false });
            }
        });
    }

    // Разворачивает лист-таблицу в отдельные строки - см.
    // TreeViewerNode._walkLeafRows() (тот же принцип сопоставления по
    // имени заголовка, то же имя строки из первого текстового столбца).
    _walkLeafTable(leafTable, depth, ancestors, headers, out) {
        const nameCol = leafTable.columns.find(c => c.format === 'text');
        for (let r = 0; r < leafTable.rowCount; r++) {
            const name = (nameCol && nameCol.values[r] !== undefined && nameCol.values[r] !== null && nameCol.values[r] !== '')
                ? String(nameCol.values[r])
                : `Строка ${r + 1}`;
            const values = headers.map(h => {
                const col = leafTable.columns.find(c => c.header === h.header);
                return col ? col.values[r] : undefined;
            });
            out.push({ depth, path: [...ancestors, name], name, values, isGroupHeader: false });
        }
    }

    // Разворачивает лист-список в отдельные строки - см.
    // TreeViewerNode._walkLeafListRows().
    _walkLeafList(srcNode, depth, ancestors, headers, out) {
        const columnName = srcNode.customName || srcNode.getDisplayName?.() || 'Значение';
        const colIndex = headers.findIndex(h => h.header === columnName);
        srcNode.listData.items.forEach((item, r) => {
            const name = (item.name !== undefined && item.name !== null && item.name !== '')
                ? String(item.name)
                : `Строка ${r + 1}`;
            const values = headers.map((h, i) => (i === colIndex ? item.value : undefined));
            out.push({ depth, path: [...ancestors, name], name, values, isGroupHeader: false });
        });
    }

    calculate(nodeManager) {
        const connections = window.connectionManager?.getConnections() || [];
        const conn = connections.find(c => c.targetNodeId === this.id && c.targetSocket === 0);
        const root = conn ? nodeManager.getNode(conn.sourceNodeId) : null;

        this._sourceName = root ? (root.customName || root.getDisplayName?.() || 'источник') : null;

        const isTree = !!(root && Array.isArray(root.branches) && root.branches.length > 0);

        if (conn) {
            if (!isTree) {
                this.addBadge('tree-to-table-not-a-tree', { type: 'error', text: 'Источник не является Деревом (нет иерархии)' });
                if (window.connectionManager) {
                    window.connectionManager.setConnectionError(conn.sourceNodeId, conn.targetNodeId, conn.targetSocket, true, 'Источник не Дерево');
                }
            } else {
                this.clearBadge('tree-to-table-not-a-tree');
                if (window.connectionManager) {
                    window.connectionManager.setConnectionError(conn.sourceNodeId, conn.targetNodeId, conn.targetSocket, false);
                }
            }
        } else {
            this.clearBadge('tree-to-table-not-a-tree');
        }

        if (!isTree) {
            this.tableData = new TableData();
            this.value = 0;
            return this.value;
        }

        const headers = this._getFieldHeaders(root);
        const rows = [];
        this._walk(root.branches, root.tableData, 0, [], headers, rows);

        let columns;
        if (this.layoutMode === 'keys') {
            const levelCount = rows.reduce((m, r) => Math.max(m, r.path.length), 1);
            const levelColumns = Array.from({ length: levelCount }, (_, lvl) => ({
                header: `Уровень ${lvl + 1}`,
                format: 'text',
                values: rows.map(r => r.path[lvl] ?? null)
            }));
            const dataColumns = headers.map((h, hi) => ({
                header: h.header,
                format: h.format,
                values: rows.map(r => (r.values[hi] === undefined ? null : r.values[hi]))
            }));
            columns = [...levelColumns, ...dataColumns];
        } else if (this.layoutMode === 'indent') {
            // "Табуляция" (по уточнению Mr.D - раньше тут был один
            // текстовый столбец с символами отступа, оказалось не то, что
            // имелось в виду): КАЖДЫЙ уровень вложенности - СВОЙ столбец
            // ("Уровень 1", "Уровень 2"...), имя ветки стоит ТОЛЬКО в
            // столбце своей глубины, в остальных - пусто. Даёт классическую
            // "лестницу" при простом взгляде на таблицу:
            //   Корень   |         |          |
            //            | Ветка   |          |
            //            |         | Ветка 2  |
            //            |         |          | Листья
            const levelCount = rows.reduce((m, r) => Math.max(m, r.depth + 1), 1);
            const levelColumns = Array.from({ length: levelCount }, (_, lvl) => ({
                header: `Уровень ${lvl + 1}`,
                format: 'text',
                values: rows.map(r => (r.depth === lvl ? r.name : null))
            }));
            const dataColumns = headers.map((h, hi) => ({
                header: h.header,
                format: h.format,
                values: rows.map(r => (r.values[hi] === undefined ? null : r.values[hi]))
            }));
            columns = [...levelColumns, ...dataColumns];
        } else { // 'headers'
            const nameColumn = {
                header: 'Название',
                format: 'text',
                values: rows.map(r => r.name)
            };
            const dataColumns = headers.map((h, hi) => ({
                header: h.header,
                format: h.format,
                // Багфикс: раньше строка-заголовок группы (r.isGroupHeader)
                // принудительно обнулялась здесь - теперь r.values уже несёт
                // готовый агрегат родителя (см. _walk() выше), просто
                // показываем его, как для обычной строки.
                values: rows.map(r => (r.values[hi] === undefined ? null : r.values[hi]))
            }));
            columns = [nameColumn, ...dataColumns];
        }

        this.tableData = new TableData(columns, { title: this.customName || this.getDisplayName() });
        this.value = rows.length;
        return this.value;
    }

    updateDisplay(element) {
        const label = element.querySelector('.tree-to-table-source-label');
        if (label) label.textContent = this._statusText();
    }

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

    getInspectorSchema() {
        const fields = super.getInspectorSchema();

        fields.push({ type: 'section', label: 'Развёртка дерева' });

        fields.push({
            key: 'layoutMode',
            label: 'Компоновка',
            type: 'select',
            options: [
                { value: 'keys', label: 'Столбцы-ключи на уровень (база данных)' },
                { value: 'indent', label: 'Табуляция - свой столбец на уровень (лестница)' },
                { value: 'headers', label: 'Строка-заголовок групп (для Excel)' }
            ],
            get: () => this.layoutMode,
            set: (v) => { this.layoutMode = v || 'keys'; }
        });

        fields.push({
            key: 'maxDepth',
            label: 'Глубина разворачивания',
            type: 'select',
            options: [
                { value: '0', label: 'Только корень (непосредственные ветки)' },
                { value: '1', label: 'Корень + 1 уровень' },
                { value: '2', label: 'Корень + 2 уровня' },
                { value: '3', label: 'Корень + 3 уровня' },
                { value: 'leaves', label: 'До самых глубоких листьев (по умолчанию)' }
            ],
            get: () => String(this.maxDepth),
            set: (v) => { this.maxDepth = (v === 'leaves') ? 'leaves' : Math.max(0, parseInt(v, 10) || 0); }
        });

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
