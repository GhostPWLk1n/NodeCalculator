/**
 * SPDX-License-Identifier: MIT
 * SPDX-FileCopyrightText: 2024 NodeCalculate Team
 * SPDX-FileCopyrightText: 2024 Pavel Fomin
 *
 * @file    tableJoinNode.js
 * @brief   Обработчик: слияние двух таблиц по ключевым столбцам с агрегацией по столбцу
 * @author  Pavel Fomin
 * @version 1.8.94
 * @see     https://github.com/GhostPWLk1n/NodeCalculator.git
 */

import { BaseNode } from './baseNode.js';
import { TableData } from '../utils/dataTypes.js';
import { SocketFactory } from '../utils/socketFactory.js';
import { TableWidgetRenderer } from '../utils/tableWidgetRenderer.js';

/**
 * TableJoinNode ("Слияние таблиц") - Data → Data, два входа:
 *
 *   - вход 0 ("Таблица А") - базовая, её строки сохраняются ВСЕ, как есть;
 *   - вход 1 ("Таблица Б") - присоединяемая, её столбцы (кроме ключевого)
 *     добавляются к А, по одному значению НА КАЖДУЮ строку А.
 *
 * Это LEFT JOIN по ключевым столбцам (this.keyColumnA/this.keyColumnB) -
 * НО, в отличие от обычного JOIN, у Б может быть НЕСКОЛЬКО строк с одним
 * и тем же ключом (или вовсе ни одной) - поэтому каждый столбец Б (кроме
 * ключа) сворачивается в ОДНО значение НА СВОЮ СОБСТВЕННУЮ операцию
 * агрегации (Раунд 46 - раньше операция была ОДНА на все столбцы Б,
 * теперь у каждого своя, см. this.columnConfigB/getInspectorSchema()):
 *
 *   - sum/max/min/avg - арифметика по числовым значениям среди совпадений
 *     (нечисловые игнорируются; если совпадений нет вовсе - 0 для sum,
 *     null для max/min/avg);
 *   - first - значение из ПЕРВОЙ строки Б, где ключ совпал (null, если
 *     совпадений нет);
 *   - distinct ("перечислить одинаковые") - список УНИКАЛЬНЫХ значений
 *     среди совпадений, через запятую, как текст (пустая строка, если
 *     совпадений нет).
 *
 * Если у строки А НЕТ совпадений в Б - результат агрегации не считается
 * ошибкой, просто "пустое" значение по правилам выше (LEFT JOIN
 * семантика: строки А не теряются, даже если для них нет пары).
 *
 * ИСКЛЮЧЕНИЕ СТОЛБЦОВ ИЗ РЕЗУЛЬТАТА (Раунд 46) - this.columnConfigA/
 * this.columnConfigB, синхронизируются по длине с ПОЛНЫМ набором
 * столбцов каждой таблицы (индекс = индекс столбца В ИСХОДНОЙ таблице,
 * включая ключевой - так индексы не съезжают, если ключ сменить). У
 * каждой записи - `include` (показывать столбец в результате или нет);
 * у Б дополнительно `aggregation` (см. выше). КЛЮЧЕВЫЕ столбцы ВСЕГДА
 * попадают в результат независимо от include - ключ А обязателен (без
 * него нет смысла в строках результата), ключ Б и так никогда не
 * дублируется в выходе (структурно не входит в bColsToKeep, см.
 * calculate()) - поле include у записи на месте ключа просто не
 * используется (не показывается в панели).
 */
export class TableJoinNode extends BaseNode {
    constructor(id, type, x, y, config = {}) {
        super(id, type, x, y, config);
        this.inputs = 2;
        this.inputSockets = [0, 1];
        this.outputs = 1;
        this.width = config.width || 220;

        this.keyColumnA = config.keyColumnA ?? 0;
        this.keyColumnB = config.keyColumnB ?? 0;

        // Индекс = индекс столбца В ИСХОДНОЙ таблице (А/Б), см. докстринг
        // класса. columnConfigA: {include}. columnConfigB: {include, aggregation}.
        this.columnConfigA = Array.isArray(config.columnConfigA) ? config.columnConfigA : [];
        this.columnConfigB = Array.isArray(config.columnConfigB) ? config.columnConfigB : [];

        this._aSourceName = null;
        this._bSourceName = null;
        this._aHeaders = [];
        this._bHeaders = [];
        this.tableData = new TableData();

        // Виджет Доски (см. utils/tableWidgetRenderer.js) - только номера
        // строк/сортировка, оформление - через TableFormatNode (Раунд 44)
        this.boardShowRowNumbers = config.boardShowRowNumbers ?? true;
        // Раунд 93 (чек-лист, п.4.1) - ручная ширина столбцов на Доске
        this.boardColumnWidths = config.boardColumnWidths ? { ...config.boardColumnWidths } : {};
        this.boardSortColumn = config.boardSortColumn ?? null;
        this.boardSortDirection = config.boardSortDirection ?? null;
    }

    createContent() {
        const content = document.createElement('div');
        content.className = 'node-content';
        content.style.cssText = 'width: 100%; min-width: 180px;';

        const aRow = document.createElement('div');
        aRow.style.cssText = 'display:flex; align-items:center; gap:6px;';
        const aSocket = SocketFactory.createSocket({
            nodeId: this.id, socketType: 'input', index: 0, isData: true,
            title: 'Таблица А - базовая, её строки сохраняются все'
        });
        aRow.appendChild(aSocket);
        const aLabel = document.createElement('span');
        aLabel.className = 'table-join-a-label';
        aLabel.style.cssText = 'color:var(--md-text-secondary); font-size:11px; flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;';
        aLabel.textContent = this._aSourceName || 'А: не подключена';
        aRow.appendChild(aLabel);
        content.appendChild(aRow);

        const bRow = document.createElement('div');
        bRow.style.cssText = 'display:flex; align-items:center; gap:6px;';
        const bSocket = SocketFactory.createSocket({
            nodeId: this.id, socketType: 'input', index: 1, isData: true,
            title: 'Таблица Б - присоединяемая, столбцы агрегируются по ключу'
        });
        bRow.appendChild(bSocket);
        const bLabel = document.createElement('span');
        bLabel.className = 'table-join-b-label';
        bLabel.style.cssText = 'color:var(--md-text-secondary); font-size:11px; flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;';
        bLabel.textContent = this._bSourceName || 'Б: не подключена';
        bRow.appendChild(bLabel);
        content.appendChild(bRow);

        const opRow = document.createElement('div');
        opRow.style.cssText = 'padding-left:20px;';
        const opLabel = document.createElement('span');
        opLabel.className = 'table-join-op-label';
        opLabel.style.cssText = 'color:var(--md-text-disabled); font-size:10px;';
        opLabel.textContent = this._operationText();
        opRow.appendChild(opLabel);
        content.appendChild(opRow);

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
            title: 'Таблица А + агрегированные столбцы Б'
        });
        outRow.appendChild(outSocket);
        content.appendChild(outRow);

        return content;
    }

    _operationText() {
        const aKey = this._aHeaders[this.keyColumnA] || `столбец ${this.keyColumnA + 1}`;
        const bKey = this._bHeaders[this.keyColumnB] || `столбец ${this.keyColumnB + 1}`;
        const includedB = this.columnConfigB.filter((c, i) => i !== this.keyColumnB && c?.include !== false).length;
        return `→ А.«${aKey}» = Б.«${bKey}» · столбцов Б в результате: ${includedB}`;
    }

    static _aggregate(values, mode) {
        const nums = values.filter(v => typeof v === 'number');
        switch (mode) {
            case 'sum': return nums.reduce((a, b) => a + b, 0);
            case 'max': return nums.length ? Math.max(...nums) : null;
            case 'min': return nums.length ? Math.min(...nums) : null;
            case 'avg': return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
            case 'distinct': {
                const uniq = [...new Set(values.map(v => String(v ?? '')))];
                return uniq.join(', ');
            }
            case 'first':
            default:
                return values.length ? values[0] : null;
        }
    }

    // Синхронизирует columnConfigA/columnConfigB по длине с текущими
    // таблицами - лишние обрезаются, недостающие добавляются с дефолтами
    // (include: true, у Б ещё aggregation: 'first') - тот же приём, что у
    // columnStyles в TableFormatNode (Раунд 44).
    _syncColumnConfigs(tableA, tableB) {
        while (this.columnConfigA.length < tableA.columns.length) this.columnConfigA.push({ include: true });
        this.columnConfigA.length = tableA.columns.length;

        if (tableB) {
            while (this.columnConfigB.length < tableB.columns.length) {
                this.columnConfigB.push({ include: true, aggregation: 'first' });
            }
            this.columnConfigB.length = tableB.columns.length;
        }
    }

    calculate(nodeManager) {
        const connections = window.connectionManager?.getConnections() || [];
        const aConn = connections.find(c => c.targetNodeId === this.id && c.targetSocket === 0);
        const bConn = connections.find(c => c.targetNodeId === this.id && c.targetSocket === 1);
        const aSrc = aConn ? nodeManager.getNode(aConn.sourceNodeId) : null;
        const bSrc = bConn ? nodeManager.getNode(bConn.sourceNodeId) : null;

        this._aSourceName = aSrc ? (aSrc.customName || aSrc.getDisplayName?.() || 'источник') : null;
        this._bSourceName = bSrc ? (bSrc.customName || bSrc.getDisplayName?.() || 'источник') : null;

        const tableA = (aSrc && aSrc.tableData && aSrc.tableData.columns.length > 0) ? aSrc.tableData : new TableData();
        const tableB = (bSrc && bSrc.tableData && bSrc.tableData.columns.length > 0) ? bSrc.tableData : null;

        this._aHeaders = tableA.columns.map(c => c.header);
        this._bHeaders = tableB ? tableB.columns.map(c => c.header) : [];
        this._syncColumnConfigs(tableA, tableB);

        // Нет Б - нечего сливать, но include-фильтр А всё равно применяем
        // (убрать ненужные столбцы А можно и без подключённой Б)
        if (!tableB || tableA.columns.length === 0) {
            const keyColA = tableA.columns.length ? Math.max(0, Math.min(tableA.columns.length - 1, this.keyColumnA)) : 0;
            const aColsToKeep = tableA.columns.filter((_, i) => i === keyColA || this.columnConfigA[i]?.include !== false);
            this.tableData = tableA.columns.length ? new TableData(aColsToKeep, { ...tableA.metadata }) : tableA;
            this.value = this.tableData.rowCount;
            return this.value;
        }

        const keyColA = Math.max(0, Math.min(tableA.columns.length - 1, this.keyColumnA));
        const keyColB = Math.max(0, Math.min(tableB.columns.length - 1, this.keyColumnB));

        const keyAVals = tableA.columns[keyColA].values;
        const keyBVals = tableB.columns[keyColB].values;

        // А: ключ - ВСЕГДА, остальные - только если include !== false
        const aColsToKeep = tableA.columns.filter((_, i) => i === keyColA || this.columnConfigA[i]?.include !== false);

        // Б: ключ - НИКОГДА (структурно потребляется джойном, не дублируется
        // в выходе), остальные - только если include !== false
        const bColsToKeep = tableB.columns
            .map((col, i) => ({ col, i }))
            .filter(({ i }) => i !== keyColB && this.columnConfigB[i]?.include !== false);

        const rowCount = tableA.rowCount;
        const resultBCols = bColsToKeep.map(({ col, i }) => ({
            header: col.header, values: [], format: col.format, _origIndex: i
        }));

        for (let r = 0; r < rowCount; r++) {
            const key = keyAVals[r];
            const matchIndexes = [];
            for (let i = 0; i < keyBVals.length; i++) {
                if (keyBVals[i] === key) matchIndexes.push(i);
            }

            resultBCols.forEach((rc) => {
                const mode = this.columnConfigB[rc._origIndex]?.aggregation || 'first';
                const matchedValues = matchIndexes.map(mi => tableB.columns[rc._origIndex].values[mi]);
                rc.values.push(TableJoinNode._aggregate(matchedValues, mode));
                if (['sum', 'max', 'min', 'avg'].includes(mode)) rc.format = 'number';
                else if (mode === 'distinct') rc.format = 'text';
                // 'first' - формат столбца Б как он был, не меняем
            });
        }

        // Убираем временное поле _origIndex перед финальной сборкой -
        // TableData не должна нести служебные поля наружу
        const finalBCols = resultBCols.map(({ _origIndex, ...rest }) => rest);

        const finalColumns = [...aColsToKeep, ...finalBCols];
        this.tableData = new TableData(finalColumns, { ...tableA.metadata });
        this.value = this.tableData.rowCount;
        return this.value;
    }

    // Виджет Доски (см. dashboardNode.js/boardManager.js) - код общий, см.
    // utils/tableWidgetRenderer.js.
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
        const aLabel = element.querySelector('.table-join-a-label');
        if (aLabel) aLabel.textContent = this._aSourceName || 'А: не подключена';

        const bLabel = element.querySelector('.table-join-b-label');
        if (bLabel) bLabel.textContent = this._bSourceName || 'Б: не подключена';

        const opLabel = element.querySelector('.table-join-op-label');
        if (opLabel) opLabel.textContent = this._operationText();
    }

    getInspectorSchema() {
        const fields = super.getInspectorSchema();

        fields.push({ type: 'section', label: 'Ключевые столбцы' });

        fields.push({
            key: 'keyColumnA',
            label: 'Ключевой столбец таблицы А',
            type: 'select',
            options: this._aHeaders.map((h, i) => ({ value: String(i), label: h || `Столбец ${i + 1}` })),
            get: () => String(this.keyColumnA),
            set: (v) => { this.keyColumnA = parseInt(v, 10) || 0; }
        });

        fields.push({
            key: 'keyColumnB',
            label: 'Ключевой столбец таблицы Б',
            type: 'select',
            options: this._bHeaders.map((h, i) => ({ value: String(i), label: h || `Столбец ${i + 1}` })),
            get: () => String(this.keyColumnB),
            set: (v) => { this.keyColumnB = parseInt(v, 10) || 0; }
        });

        // Столбцы А (кроме ключа - он обязателен, см. докстринг класса) -
        // только включить/убрать, агрегация им не нужна (не сворачиваются)
        fields.push({ type: 'section', label: 'Столбцы таблицы А в результате' });
        this._aHeaders.forEach((header, i) => {
            if (i === this.keyColumnA) return; // ключ - не показываем, всегда включён
            const cfg = this.columnConfigA[i] || {};
            fields.push({
                key: `joinColA${i}`,
                label: header || `Столбец ${i + 1}`,
                type: 'checkbox',
                get: () => cfg.include !== false,
                set: (v) => { this.columnConfigA[i] = { ...cfg, include: !!v }; }
            });
        });

        // Столбцы Б (кроме ключа - он никогда не дублируется в выходе) -
        // включить/убрать + СВОЯ агрегация на каждый (Раунд 46)
        fields.push({ type: 'section', label: 'Столбцы таблицы Б в результате' });
        this._bHeaders.forEach((header, i) => {
            if (i === this.keyColumnB) return; // ключ Б - не показываем, никогда не дублируется
            const cfg = this.columnConfigB[i] || {};
            const label = header || `Столбец ${i + 1}`;

            fields.push({ type: 'section', label });

            fields.push({
                key: `joinColB${i}_include`,
                label: 'Включить в результат',
                type: 'checkbox',
                get: () => cfg.include !== false,
                set: (v) => { this.columnConfigB[i] = { ...cfg, include: !!v }; }
            });

            fields.push({
                key: `joinColB${i}_agg`,
                label: 'Агрегация',
                type: 'select',
                options: [
                    { value: 'sum', label: 'Сумма' },
                    { value: 'max', label: 'Максимум' },
                    { value: 'min', label: 'Минимум' },
                    { value: 'avg', label: 'Среднее' },
                    { value: 'first', label: 'Первое значение' },
                    { value: 'distinct', label: 'Перечислить одинаковые' }
                ],
                get: () => cfg.aggregation || 'first',
                set: (v) => { this.columnConfigB[i] = { ...cfg, aggregation: v }; }
            });
        });

        return fields;
    }
}
