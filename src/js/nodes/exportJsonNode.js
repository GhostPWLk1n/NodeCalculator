/**
 * SPDX-License-Identifier: MIT
 * SPDX-FileCopyrightText: 2024 NodeCalculate Team
 * SPDX-FileCopyrightText: 2024 Pavel Fomin
 *
 * @file    exportJsonNode.js
 * @brief   Экспорт подключённой таблицы (Data) в .json по кнопке
 * @author  Pavel Fomin
 * @version 1.8.20
 * @see     https://github.com/GhostPWLk1n/NodeCalculator.git
 */

import { BaseNode } from './baseNode.js';
import { SocketFactory } from '../utils/socketFactory.js';

/**
 * ExportJsonNode - тот же принцип, что ExportXlsxNode (см. её докстринг
 * про "экспорт только по клику, не на каждый calculateAll()"), но без
 * отдельного writer-модуля - JSON.stringify() уже встроен, писать
 * ничего не пришлось. Формат - массив объектов "строка -> {заголовок:
 * значение}" (TableData.row(i)), тот же, что ест JsonImportNode обратно -
 * экспорт и импорт JSON СИММЕТРИЧНЫ для простых плоских таблиц (без
 * вложенных веток - те JsonImportNode/TreeNode строят отдельно).
 */
export class ExportJsonNode extends BaseNode {
    constructor(id, type, x, y, config = {}) {
        super(id, type, x, y, config);
        this.inputs = 1;
        this.inputSockets = [0];
        this.outputs = 0;
        // Раунд 106 (чек-лист, раздел 2) - минимальная ширина 224px.
        this.width = Math.max(config.width || 220, 224);
        this.minWidth = 224; // Раунд 106 - применяется и при ручном растягивании через UI

        this.tableData = null;
        this._sourceName = null;
    }

    createContent() {
        const content = document.createElement('div');
        content.className = 'node-content';
        content.style.cssText = 'width:100%; min-width:180px; display:flex; flex-direction:column; gap:6px;';

        const inRow = document.createElement('div');
        inRow.style.cssText = 'display:flex; align-items:center; gap:6px;';
        const inSocket = SocketFactory.createSocket({
            nodeId: this.id, socketType: 'input', index: 0, isData: true,
            title: 'Таблица для экспорта в .json'
        });
        inRow.appendChild(inSocket);
        const sourceLabel = document.createElement('span');
        sourceLabel.className = 'export-source-label';
        sourceLabel.style.cssText = `
            color: var(--md-text-secondary);
            font-size: 11px;
            flex: 1;
            min-width: 0;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        `;
        sourceLabel.textContent = this._statusText();
        inRow.appendChild(sourceLabel);
        content.appendChild(inRow);

        const exportBtn = document.createElement('button');
        exportBtn.className = 'node-action-btn';
        exportBtn.textContent = '💾 Экспорт в .json';
        exportBtn.disabled = !this._hasData();
        exportBtn.addEventListener('mousedown', (e) => e.stopPropagation());
        exportBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this._doExport();
        });
        content.appendChild(exportBtn);

        return content;
    }

    _hasData() {
        return !!(this.tableData && this.tableData.columns.length > 0);
    }

    _statusText() {
        if (!this.tableData) return 'не подключено';
        if (this.tableData.columns.length === 0) return 'нет данных';
        return `${this._sourceName || 'источник'} — ${this.tableData.rowCount} стр. × ${this.tableData.columns.length} столб.`;
    }

    calculate(nodeManager) {
        const connections = window.connectionManager?.getConnections() || [];
        const conn = connections.find(c => c.targetNodeId === this.id && c.targetSocket === 0);
        const src = conn ? nodeManager.getNode(conn.sourceNodeId) : null;
        // Раунд 84 - через getSourceOutput() (учитывает sourceSocket у
        // многовыходных источников), см. baseNode.js/nodeManager.js
        const output = conn ? nodeManager.getSourceOutput(conn) : null;

        this.tableData = output?.tableData ?? null;
        this._sourceName = src ? (src.customName || src.getDisplayName?.() || 'источник') : null;

        if (conn) {
            if (!this.tableData) {
                this.addBadge('export-no-data', { type: 'error', text: 'Источник не отдаёт табличные данные (Data)' });
                if (window.connectionManager) {
                    window.connectionManager.setConnectionError(conn.sourceNodeId, conn.targetNodeId, conn.targetSocket, true, 'Источник не отдаёт Data');
                }
            } else {
                this.clearBadge('export-no-data');
                if (window.connectionManager) {
                    window.connectionManager.setConnectionError(conn.sourceNodeId, conn.targetNodeId, conn.targetSocket, false);
                }
            }
        } else {
            this.clearBadge('export-no-data');
        }

        return this.value;
    }

    updateDisplay(element) {
        const label = element.querySelector('.export-source-label');
        if (label) label.textContent = this._statusText();
        const btn = element.querySelector('.node-action-btn');
        if (btn) btn.disabled = !this._hasData();
    }

    _buildJson() {
        const rows = [];
        for (let r = 0; r < this.tableData.rowCount; r++) rows.push(this.tableData.row(r));
        return JSON.stringify(rows, null, 2);
    }

    async _doExport() {
        if (!this._hasData()) return;
        const statusEl = document.getElementById('status');

        try {
            const json = this._buildJson();
            const result = await window.electron.exportFile({
                content: json,
                encoding: 'utf8',
                suggestedName: `${this._sourceName || 'export'}.json`,
                filters: [{ name: 'JSON', extensions: ['json'] }]
            });

            if (statusEl) {
                if (result?.success) {
                    statusEl.textContent = '💾 Экспортировано в .json';
                } else if (!result?.canceled) {
                    statusEl.textContent = `❌ Ошибка экспорта: ${result?.error || 'неизвестная ошибка'}`;
                }
                setTimeout(() => { statusEl.textContent = 'Готово'; }, 2000);
            }
        } catch (err) {
            if (statusEl) statusEl.textContent = `❌ Ошибка экспорта: ${err.message}`;
        }
    }
}
