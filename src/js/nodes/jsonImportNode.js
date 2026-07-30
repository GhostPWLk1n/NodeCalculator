/**
 * SPDX-License-Identifier: MIT
 * SPDX-FileCopyrightText: 2024 NodeCalculate Team
 * SPDX-FileCopyrightText: 2024 Pavel Fomin
 *
 * @file    jsonImportNode.js
 * @brief   Импорт .json - разбирает произвольный JSON в Data + иерархию веток (см. TreeViewerNode)
 * @author  Pavel Fomin
 * @version 1.5.0
 * @see     https://github.com/GhostPWLk1n/NodeCalculator.git
 */

import { BaseNode } from './baseNode.js';
import { TableData } from '../utils/dataTypes.js';
import { SocketFactory } from '../utils/socketFactory.js';
import { TableWidgetRenderer } from '../utils/tableWidgetRenderer.js';

/**
 * JsonImportNode ("Импорт JSON") - Раунд 60. Загружает произвольный
 * .json-файл и разбирает его РЕКУРСИВНО в ту же пару (`tableData` +
 * `branches`), что уже несёт `TreeNode` (Раунд 55) - поэтому подключить
 * эту ноду напрямую к `TreeViewerNode` ("Просмотр дерева") и увидеть
 * вложенную структуру файла раскрываемым деревом работает без единой
 * правки в просмотрщике - тот уже умеет читать `srcNode.branches`
 * рекурсивно у ЛЮБОГО источника, не только у `TreeNode`.
 *
 * ПРАВИЛА РАЗБОРА (_convertJsonValue(), рекурсивно) - JSON-значение
 * может быть объектом, массивом или примитивом:
 *
 *   - ОБЪЕКТ `{...}` - ключи с ПРИМИТИВНЫМИ значениями (строка/число/
 *     bool/null) собираются в ОДНУ строку-таблицу этого уровня (столбец
 *     на каждый такой ключ) - "собственные поля" этого узла. Ключи со
 *     ЗНАЧЕНИЕМ-объектом или -массивом становятся ВЕТКАМИ (рекурсивно) -
 *     имя ветки = имя ключа.
 *   - МАССИВ `[...]`, где ВСЕ элементы примитивы - одна таблица-лист с
 *     одним столбцом "Значение", по строке на элемент, без веток.
 *   - МАССИВ, где есть хотя бы один элемент-объект/массив - каждый
 *     элемент становится СВОЕЙ веткой (рекурсивно). Имя ветки - значение
 *     поля `name`/`title`/`id`/`key` элемента, если оно есть и это
 *     строка/число, иначе порядковый номер (с 1).
 *
 * Ветки - НЕ отдельные ноды графа, а простые вложенные объекты вида
 * `{name, srcNode: {tableData, branches}}` - `TreeViewerNode` не требует
 * от `branch.srcNode` ничего, кроме этих двух полей (см. её докстринг),
 * так что рекурсия строится ПОЛНОСТЬЮ внутри calculate() этой ноды, без
 * создания реальных промежуточных нод в графе.
 *
 * Выход - ОБЫЧНЫЙ Data-сокет (не новый тип) - подключается куда угодно,
 * что понимает Data; `this.branches` читается ДОПОЛНИТЕЛЬНО, только
 * "Просмотром дерева" - тот же дуальный интерфейс, что уже есть у
 * `TreeNode`.
 */
export class JsonImportNode extends BaseNode {
    constructor(id, type, x, y, config = {}) {
        super(id, type, x, y, config);
        this.outputs = 1;
        this.inputs = 0;
        this.inputSockets = [];
        this.width = config.width || 220;

        this.fileName = config.fileName || null;
        // Сырой текст файла - сериализуется целиком (тот же принцип, что
        // у ImageNode.dataUrl, Раунд 51 - разбор дешёвый и детерминированный,
        // проще перечитывать текст на каждый calculate(), чем сериализовать
        // весь производный tableData/branches ДЕРЕВОМ вложенных объектов)
        this.jsonText = config.jsonText || null;

        this.tableData = new TableData();
        this.branches = []; // см. докстринг класса - публичное поле для TreeViewerNode

        this.boardShowRowNumbers = config.boardShowRowNumbers ?? true;
        this.boardSortColumn = config.boardSortColumn ?? null;
        this.boardSortDirection = config.boardSortDirection ?? null;
    }

    createContent() {
        const content = document.createElement('div');
        content.className = 'node-content';
        content.style.cssText = 'width: 100%; min-width: 190px;';

        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = '.json,application/json';
        fileInput.style.display = 'none';
        fileInput.addEventListener('mousedown', (e) => e.stopPropagation());
        fileInput.addEventListener('change', (e) => {
            const file = e.target.files && e.target.files[0];
            e.target.value = ''; // повторный выбор того же файла тоже сработает
            if (file) this._onFilePicked(file);
        });
        content.appendChild(fileInput);

        const pickBtn = document.createElement('button');
        pickBtn.className = 'xlsx-pick-btn'; // переиспользуем стиль кнопки-пунктира XlsxImportNode
        pickBtn.textContent = '📄 Выбрать JSON-файл';
        pickBtn.addEventListener('mousedown', (e) => e.stopPropagation());
        pickBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            fileInput.click();
        });
        content.appendChild(pickBtn);

        const fileNameEl = document.createElement('div');
        fileNameEl.className = 'xlsx-filename';
        fileNameEl.textContent = this.fileName || 'файл не выбран';
        fileNameEl.title = this.fileName || '';
        content.appendChild(fileNameEl);

        const statusRow = document.createElement('div');
        statusRow.style.cssText = 'padding-left:4px;';
        const statusLabel = document.createElement('span');
        statusLabel.className = 'json-import-status-label';
        statusLabel.style.cssText = 'color:var(--md-text-disabled); font-size:10px;';
        statusLabel.textContent = this._statusText();
        statusRow.appendChild(statusLabel);
        content.appendChild(statusRow);

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
            title: 'Корневой уровень JSON - подключите к "Просмотру дерева" для иерархии'
        });
        outRow.appendChild(outSocket);
        content.appendChild(outRow);

        return content;
    }

    _statusText() {
        if (!this.jsonText) return '→ файл не выбран';
        return `→ полей: ${this.tableData.columns.length} · веток: ${this.branches.length}`;
    }

    async _onFilePicked(file) {
        this.fileName = file.name;

        try {
            this.jsonText = await file.text();
        } catch (err) {
            console.error('Ошибка чтения JSON-файла:', err);
            alert('Не удалось прочитать файл: ' + err.message);
            this.jsonText = null;
        }

        if (window.nodeManager) window.nodeManager.calculateAll();
        const el = document.querySelector(`[data-node-id="${this.id}"]`);
        if (el) this.updateDisplay(el);
    }

    static _inferFormat(values) {
        if (values.every(v => typeof v === 'boolean')) return 'boolean';
        if (values.every(v => typeof v === 'number')) return 'number';
        return 'text';
    }

    // Имя ветки для элемента массива - см. докстринг класса
    static _extractItemName(item, index) {
        if (item !== null && typeof item === 'object' && !Array.isArray(item)) {
            for (const key of ['name', 'title', 'id', 'key']) {
                if (typeof item[key] === 'string' || typeof item[key] === 'number') {
                    return String(item[key]);
                }
            }
        }
        return String(index + 1);
    }

    // Рекурсивный разбор одного JSON-значения в {tableData, branches} -
    // см. докстринг класса про правила
    static _convertJsonValue(value, fallbackName) {
        if (Array.isArray(value)) {
            if (value.length === 0) return { tableData: new TableData(), branches: [] };

            const allPrimitive = value.every(v => v === null || typeof v !== 'object');
            if (allPrimitive) {
                return {
                    tableData: new TableData([
                        { header: 'Значение', values: value, format: JsonImportNode._inferFormat(value) }
                    ]),
                    branches: []
                };
            }

            const branches = value.map((item, i) => ({
                name: JsonImportNode._extractItemName(item, i),
                srcNode: JsonImportNode._convertJsonValue(item, String(i + 1))
            }));
            return { tableData: new TableData(), branches };
        }

        if (value !== null && typeof value === 'object') {
            const primitiveEntries = [];
            const complexEntries = [];
            Object.entries(value).forEach(([k, v]) => {
                if (v !== null && typeof v === 'object') complexEntries.push([k, v]);
                else primitiveEntries.push([k, v]);
            });

            const tableData = primitiveEntries.length > 0
                ? new TableData(primitiveEntries.map(([k, v]) => ({
                    header: k, values: [v], format: JsonImportNode._inferFormat([v])
                })))
                : new TableData();

            const branches = complexEntries.map(([k, v]) => ({
                name: k,
                srcNode: JsonImportNode._convertJsonValue(v, k)
            }));
            return { tableData, branches };
        }

        // Примитив прямо на верхнем уровне файла (валидный, но необычный JSON)
        return {
            tableData: new TableData([
                { header: fallbackName, values: [value], format: JsonImportNode._inferFormat([value]) }
            ]),
            branches: []
        };
    }

    calculate() {
        if (!this.jsonText) {
            this.tableData = new TableData();
            this.branches = [];
            this.value = 0;
            this.clearBadge('jsonParseError');
            return this.value;
        }

        try {
            const parsed = JSON.parse(this.jsonText);
            const { tableData, branches } = JsonImportNode._convertJsonValue(parsed, this.fileName || 'JSON');
            this.tableData = tableData;
            this.branches = branches;
            this.value = branches.length;
            this.clearBadge('jsonParseError');
        } catch (err) {
            this.tableData = new TableData();
            this.branches = [];
            this.value = 0;
            this.addBadge('jsonParseError', { type: 'error', text: `Ошибка разбора JSON: ${err.message}` });
        }

        return this.value;
    }

    getDisplayName() {
        return this.customName || 'Импорт JSON';
    }

    // Виджет Доски (см. dashboardNode.js/boardManager.js) - показывает
    // ТОЛЬКО собственные примитивные поля корневого уровня (плоская
    // таблица) - для полной иерархии на Доске нужна отдельная задача -
    // тут просто тот же общий рендерер, что у остальных табличных нод.
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
        const fileNameEl = element.querySelector('.xlsx-filename');
        if (fileNameEl) {
            fileNameEl.textContent = this.fileName || 'файл не выбран';
            fileNameEl.title = this.fileName || '';
        }

        const statusLabel = element.querySelector('.json-import-status-label');
        if (statusLabel) statusLabel.textContent = this._statusText();
    }
}
