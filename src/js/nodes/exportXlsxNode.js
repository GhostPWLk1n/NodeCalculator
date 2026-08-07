/**
 * SPDX-License-Identifier: MIT
 * SPDX-FileCopyrightText: 2024 NodeCalculate Team
 * SPDX-FileCopyrightText: 2024 Pavel Fomin
 *
 * @file    exportXlsxNode.js
 * @brief   Экспорт подключённой таблицы (Data) в .xlsx по кнопке
 * @author  Pavel Fomin
 * @version 1.8.27
 * @see     https://github.com/GhostPWLk1n/NodeCalculator.git
 */

import { BaseNode } from './baseNode.js';
import { SocketFactory } from '../utils/socketFactory.js';
import { XlsxWriter } from '../utils/xlsxWriter.js';
import { buildGanttCalendarGrid } from '../utils/ganttCalendarExport.js';
import { initBoardPublishFields, syncNodeToBoards, buildBoardInspectorFields } from '../utils/boardPublish.js';

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
        // Раунд 106 (чек-лист, раздел 2) - минимальная ширина 224px.
        this.width = Math.max(config.width || 220, 224);
        this.minWidth = 224; // Раунд 106 - применяется и при ручном растягивании через UI

        this.tableData = null;
        this._sourceName = null;
        // Раунд 110 - ссылка на САМ узел-источник (не только имя) -
        // нужен доступ к его this.tasks/responsibleColors/groupColors
        // для календарного экспорта Ганта (см. _doExportGanttCalendar()).
        // Транзитное состояние, как this.tableData - не сериализуется.
        this._sourceNode = null;
        // Раунд 124 (релиз 1.8.0, пилот "переключателя Доска") - см.
        // utils/boardPublish.js.
        initBoardPublishFields(this, config);
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
        exportBtn.className = 'node-action-btn export-xlsx-btn';
        exportBtn.textContent = '💾 Экспорт в .xlsx';
        exportBtn.disabled = !this._hasData();
        exportBtn.addEventListener('mousedown', (e) => e.stopPropagation());
        exportBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this._doExport();
        });
        content.appendChild(exportBtn);

        // Раунд 110 (по запросу Mr.D: "обратный механизм - выгрузить
        // раскрашенную нашими цветами диаграмму") - отдельная кнопка,
        // видна ТОЛЬКО когда источник - Диаграмма Ганта (см.
        // _isGanttSource()) - обычный "💾 Экспорт в .xlsx" выше по-прежнему
        // экспортирует плоскую таблицу (Группа/Задача/Начало/... - как
        // было раньше, без изменений) - эта кнопка ДОПОЛНИТЕЛЬНО
        // экспортирует в том же календарном виде, что читает "Обработка
        // таблиц Ганта" при импорте, с цветами по Ответственному/Группе
        // (Раунд 109). ВСЕГДА в DOM (не условно) - источник может
        // смениться с/на Гант уже ПОСЛЕ первой отрисовки, а
        // updateDisplay() не пересоздаёт DOM - видимость переключается
        // через display, не через add/remove.
        const calendarBtn = document.createElement('button');
        calendarBtn.className = 'node-action-btn export-gantt-calendar-btn';
        calendarBtn.textContent = '📅 Экспорт как календарь Ганта';
        calendarBtn.style.display = this._isGanttSource() ? '' : 'none';
        calendarBtn.disabled = !(this._sourceNode?.tasks?.length > 0);
        calendarBtn.addEventListener('mousedown', (e) => e.stopPropagation());
        calendarBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this._doExportGanttCalendar();
        });
        content.appendChild(calendarBtn);

        return content;
    }

    // Раунд 110 - источник считается "Диаграммой Ганта", если у него
    // есть this.tasks (массив) - проверка по НАЛИЧИЮ поля, не по
    // node.type === 'gantt' - на случай, если в будущем появится другой
    // тип ноды с такой же формой задач (см. тот же принцип "утиной
    // типизации", что уже используется в isCompatibleTable()).
    // Раунд 124 (релиз 1.8.0, пилот "переключателя Доска") - у
    // ExportXlsxNode такого метода раньше не было вообще (терминальная
    // "нода-действие", не "нода-данные", как StringNode/NumberNode) -
    // виджет здесь не столько показывает значение, сколько ДУБЛИРУЕТ
    // саму кнопку экспорта прямо на Доске (тот же _doExport(), что и в
    // теле ноды) - удобно, если Доска используется как "пульт
    // управления" набором экспортов.
    getDashboardWidget() {
        return {
            type: 'action',
            title: this.customName || 'Экспорт в Excel',
            render: (container) => {
                const statusEl = document.createElement('div');
                statusEl.className = 'board-widget-export-status';
                statusEl.textContent = this._statusText();
                container.appendChild(statusEl);

                const btn = document.createElement('button');
                btn.className = 'node-action-btn board-widget-export-btn';
                btn.textContent = '💾 Экспорт в .xlsx';
                btn.disabled = !this._hasData();
                btn.addEventListener('mousedown', (e) => e.stopPropagation());
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this._doExport();
                });
                container.appendChild(btn);
            }
        };
    }

    getInspectorSchema() {
        const fields = super.getInspectorSchema();
        fields.push(...buildBoardInspectorFields(this));
        return fields;
    }

    _isGanttSource() {
        return !!(this._sourceNode && Array.isArray(this._sourceNode.tasks));
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
        this._sourceNode = src || null;

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

        syncNodeToBoards(this);
        return this.value;
    }

    updateDisplay(element) {
        const label = element.querySelector('.export-source-label');
        if (label) label.textContent = this._statusText();
        const btn = element.querySelector('.export-xlsx-btn');
        if (btn) btn.disabled = !this._hasData();

        const calendarBtn = element.querySelector('.export-gantt-calendar-btn');
        if (calendarBtn) {
            calendarBtn.style.display = this._isGanttSource() ? '' : 'none';
            calendarBtn.disabled = !(this._sourceNode?.tasks?.length > 0);
        }
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

    // Раунд 110 - обратный механизм к GanttTableProcessorNode: собирает
    // ту же календарную сетку (год/месяц/неделя + раскрашенные точки
    // начала/конца задач), что "Обработка таблиц Ганта" умеет ЧИТАТЬ -
    // экспортированный файл можно снова импортировать через тот же
    // узел, получив ИСХОДНЫЕ даты и цвета обратно (проверено
    // исполняемым тестом полного цикла).
    async _doExportGanttCalendar() {
        if (!this._isGanttSource()) return;
        const built = buildGanttCalendarGrid(this._sourceNode);
        if (!built) return;
        const { grid, colWidths, merges } = built;
        const statusEl = document.getElementById('status');

        try {
            const bytes = XlsxWriter.buildFromGrid(grid, this._sourceName || 'Гант', { colWidths, merges });
            const base64 = XlsxWriter.bytesToBase64(bytes);
            const result = await window.electron.exportFile({
                content: base64,
                encoding: 'base64',
                suggestedName: `${this._sourceName || 'gantt'}_календарь.xlsx`,
                filters: [{ name: 'Excel', extensions: ['xlsx'] }]
            });

            if (statusEl) {
                if (result?.success) {
                    statusEl.textContent = '📅 Экспортировано как календарь Ганта';
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
