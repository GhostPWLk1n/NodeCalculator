/**
 * SPDX-License-Identifier: MIT
 * SPDX-FileCopyrightText: 2024 NodeCalculate Team
 * SPDX-FileCopyrightText: 2024 Pavel Fomin
 *
 * @file    invertNode.js
 * @brief   Инверсия истина/ложь и 1/0 - поэлементно по подключённому списку, таблице или скаляру
 * @author  Pavel Fomin
 * @version 1.8.72
 * @see     https://github.com/GhostPWLk1n/NodeCalculator.git
 */

import { BaseNode } from './baseNode.js';
import { ListData, TableData } from '../utils/dataTypes.js';
import { SocketFactory } from '../utils/socketFactory.js';

/**
 * InvertNode ("Инверсия") - по образцу узла Invert в Blender: один вход,
 * один выход, оба `any` (Раунд 48) - подключается ЧТО УГОДНО (список,
 * таблица, или скалярный источник вроде BooleanNode/NumberNode), нода
 * САМА смотрит, что реально пришло, и инвертирует только то, что умеет:
 *
 *   true  -> false, false -> true
 *   1     -> 0,     0     -> 1
 *   всё остальное (текст, любые другие числа) - БЕЗ ИЗМЕНЕНИЙ, проходит
 *   насквозь как есть ("инвертируем, если оно вообще инвертируется" -
 *   прямая формулировка Mr.D)
 *
 * Отдельно от BooleanOperationNode: та нода - СВЁРТКА нескольких
 * скалярных булевых входов в ОДИН результат (И/ИЛИ/НЕ/...), НЕ работает
 * со списком/таблицей. InvertNode - ровно наоборот: ПОЭЛЕМЕНТНОЕ
 * преобразование потока данных, без свёртки - на выходе столько же
 * элементов/строк, сколько на входе, просто каждое инвертируемое
 * значение инвертировано. Разные по природе операции - разные ноды,
 * не режим одной и той же.
 *
 * Приоритет источника (тот же порядок проверки, что у большинства
 * табличных нод - "Data, если есть, иначе LIST, иначе скаляр"):
 *   1. src.tableData (Data) - новая таблица с теми же столбцами,
 *      значения инвертированы поэлементно.
 *   2. src.listData (LIST) - новый список с теми же именами,
 *      значения инвертированы поэлементно.
 *   3. src.value (скаляр - BooleanNode/NumberNode и т.п.) - одно
 *      инвертированное значение.
 */
export class InvertNode extends BaseNode {
    constructor(id, type, x, y, config = {}) {
        super(id, type, x, y, config);
        this.inputs = 1;
        this.inputSockets = [0];
        this.outputs = 1;
        this.width = config.width || 160;

        this.value = null;
        this.listData = new ListData();
        this.tableData = new TableData();
        this._sourceName = null;
        this._sourceMode = 'none'; // 'table' | 'list' | 'scalar' | 'none'
    }

    // true/false -> инвертируем; ровно 1 или 0 (число) -> инвертируем;
    // всё остальное - не инвертируется, возвращаем как есть
    _invertValue(v) {
        if (typeof v === 'boolean') return !v;
        if (v === 1) return 0;
        if (v === 0) return 1;
        return v;
    }

    createContent() {
        const content = document.createElement('div');
        content.className = 'node-content';
        content.style.cssText = 'width:100%; min-width:140px; display:flex; flex-direction:column; gap:4px;';

        const inRow = document.createElement('div');
        inRow.style.cssText = 'display:flex; align-items:center; gap:6px;';
        const inSocket = SocketFactory.createSocket({
            nodeId: this.id, socketType: 'input', index: 0, isAny: true,
            title: 'Список, таблица или скаляр - true/1 станет false/0 и наоборот, остальное без изменений'
        });
        inRow.appendChild(inSocket);
        const inLabel = document.createElement('span');
        inLabel.className = 'invert-source-label';
        inLabel.style.cssText = 'color:var(--md-text-secondary); font-size:11px; flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;';
        inLabel.textContent = this._statusText();
        inRow.appendChild(inLabel);
        content.appendChild(inRow);

        const outRow = document.createElement('div');
        outRow.style.cssText = 'display:flex; align-items:center; gap:6px; justify-content:flex-end;';
        const outLabel = document.createElement('span');
        outLabel.textContent = 'НЕ';
        outLabel.style.cssText = 'color:var(--md-text-secondary); font-size:11px;';
        outRow.appendChild(outLabel);
        const outSocket = SocketFactory.createSocket({
            nodeId: this.id, socketType: 'output', index: 0, isAny: true,
            title: 'Инвертированный результат (тот же вид данных, что на входе)'
        });
        outRow.appendChild(outSocket);
        content.appendChild(outRow);

        return content;
    }

    _statusText() {
        if (this._sourceMode === 'none') return 'не подключено';
        const suffix = this._sourceMode === 'table' ? 'таблица' : (this._sourceMode === 'list' ? 'список' : 'скаляр');
        return `${this._sourceName || 'источник'} (${suffix})`;
    }

    calculate(nodeManager) {
        const connections = window.connectionManager?.getConnections() || [];
        const conn = connections.find(c => c.targetNodeId === this.id && c.targetSocket === 0);
        const src = conn ? nodeManager.getNode(conn.sourceNodeId) : null;

        this._sourceName = src ? (src.customName || src.getDisplayName?.() || 'источник') : null;

        if (src?.tableData && src.tableData.columns.length > 0) {
            this._sourceMode = 'table';
            const columns = src.tableData.columns.map(col => ({
                header: col.header,
                format: col.format,
                values: col.values.map(v => this._invertValue(v))
            }));
            this.tableData = new TableData(columns, { ...src.tableData.metadata });
            this.listData = new ListData();
            this.value = null;
        } else if (src?.listData && src.listData.items.length > 0) {
            this._sourceMode = 'list';
            const items = src.listData.items.map(item => ({ name: item.name, value: this._invertValue(item.value) }));
            this.listData = new ListData(items, { ...src.listData.metadata });
            this.tableData = new TableData();
            this.value = null;
        } else if (src && (typeof src.value === 'boolean' || typeof src.value === 'number')) {
            this._sourceMode = 'scalar';
            this.value = this._invertValue(src.value);
            this.tableData = new TableData();
            this.listData = new ListData();
        } else {
            this._sourceMode = conn ? 'scalar' : 'none';
            this.value = null;
            this.tableData = new TableData();
            this.listData = new ListData();
        }

        this.resultListData = new ListData(
            [{ name: this.customName || this.getDisplayName(), value: this.value }],
            { title: this.getDisplayName() }
        );

        return this.value;
    }

    updateDisplay(element) {
        const label = element.querySelector('.invert-source-label');
        if (label) label.textContent = this._statusText();
    }
}
