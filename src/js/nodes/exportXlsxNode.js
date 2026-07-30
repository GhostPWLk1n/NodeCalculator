/**
 * SPDX-License-Identifier: MIT
 * SPDX-FileCopyrightText: 2024 NodeCalculate Team
 * SPDX-FileCopyrightText: 2024 Pavel Fomin
 *
 * @file    exportXlsxNode.js
 * @brief   Экспорт подключённой таблицы (Data) в .xlsx по кнопке
 * @author  Pavel Fomin
 * @version 1.7.4
 * @see     https://github.com/GhostPWLk1n/NodeCalculator.git
 */

import { BaseNode } from './baseNode.js';
import { SocketFactory } from '../utils/socketFactory.js';
import { XlsxWriter } from '../utils/xlsxWriter.js';

/**
 * ExportXlsxNode - зеркало XlsxImportNode: вход Data, БЕЗ выхода
 * (терминальная нода, как TableViewerNode) - у экспорта нет смысла
 * пробрасывать данные дальше по графу.
 *
 * Экспорт - ТОЛЬКО по явному клику на кнопку, не на каждый
 * calculateAll() - запись файла на диск при каждом пересчёте графа
 * была бы неожиданным побочным эффектом (см. обсуждение с Mr.D перед
 * реализацией). calculate() только читает источник и обновляет
 * this.tableData/готовность кнопки - не трогает файловую систему.
 *
 * this.tableData - ТРАНЗИТНОЕ состояние (как у DashboardNode.value) -
 * не сериализуется, пересобирается из графа при каждой загрузке проекта.
 */
export class ExportXlsxNode extends BaseNode {
    constructor(id, type, x, y, config = {}) {
        super(id, type, x, y, config);
        this.inputs = 1;
        this.inputSockets = [0];
        this.outputs = 0;
        this.width = config.width || 220;

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
            title: 'Таблица для экспорта в .xlsx'
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
        exportBtn.textContent = '💾 Экспорт в .xlsx';
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

        this.tableData = src?.tableData ?? null;
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

    async _doExport() {
        if (!this._hasData()) return;
        const statusEl = document.getElementById('status');

        try {
            const bytes = XlsxWriter.build(this.tableData, this._sourceName || 'Sheet1');
            const base64 = XlsxWriter.bytesToBase64(bytes);
            const result = await window.electron.exportFile({
                content: base64,
                encoding: 'base64',
                suggestedName: `${this._sourceName || 'export'}.xlsx`,
                filters: [{ name: 'Excel', extensions: ['xlsx'] }]
            });

            if (statusEl) {
                if (result?.success) {
                    statusEl.textContent = '💾 Экспортировано в .xlsx';
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
