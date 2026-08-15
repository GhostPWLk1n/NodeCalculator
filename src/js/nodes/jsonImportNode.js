/**
 * SPDX-License-Identifier: MIT
 * SPDX-FileCopyrightText: 2024 NodeCalculate Team
 * SPDX-FileCopyrightText: 2024 Pavel Fomin
 *
 * @file    jsonImportNode.js
 * @brief   Импорт .json - разбирает произвольный JSON в Data + иерархию веток (см. TreeViewerNode)
 * @author  Pavel Fomin
 * @version 1.8.64
 * @see     https://github.com/GhostPWLk1n/NodeCalculator.git
 */

import { BaseNode } from './baseNode.js';
import { TableData } from '../utils/dataTypes.js';
import { SocketFactory } from '../utils/socketFactory.js';
import { initBoardPublishFields, syncNodeToBoards, buildBoardInspectorFields } from '../utils/boardPublish.js';

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
 *   - ДВОЙНОЕ КОДИРОВАНИЕ (Раунд 63) - если значение (само значение
 *     верхнего уровня, элемент массива или значение поля объекта) -
 *     СТРОКА, которая САМА является валидным JSON (после `trim()`
 *     начинается с `{`/`[` и успешно парсится) - она РАЗВОРАЧИВАЕТСЯ и
 *     обрабатывается как вложенная структура, а не оседает текстовым
 *     полем. Частый экспортный паттерн у систем, хранящих сериализованный
 *     JSON текстом - например, когда ВЕСЬ файл целиком представляет
 *     собой JSON-строку (внешние кавычки), внутри которой лежит
 *     настоящий объект - см. `_tryParseJsonString()`.
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
        // Раунд 106 (чек-лист, раздел 2) - минимальная ширина 224px.
        this.width = Math.max(config.width || 220, 224);
        this.minWidth = 224; // Раунд 106 - применяется и при ручном растягивании через UI

        this.fileName = config.fileName || null;
        // Сырой текст файла - сериализуется целиком (тот же принцип, что
        // у ImageNode.dataUrl, Раунд 51 - разбор дешёвый и детерминированный,
        // проще перечитывать текст на каждый calculate(), чем сериализовать
        // весь производный tableData/branches ДЕРЕВОМ вложенных объектов)
        this.jsonText = config.jsonText || null;

        this.tableData = new TableData();
        this.branches = []; // см. докстринг класса - публичное поле для TreeViewerNode

        this.boardShowRowNumbers = config.boardShowRowNumbers ?? true;
        // Раунд 93 (чек-лист, п.4.1) - ручная ширина столбцов на Доске
        this.boardColumnWidths = config.boardColumnWidths ? { ...config.boardColumnWidths } : {};
        this.boardSortColumn = config.boardSortColumn ?? null;
        this.boardSortDirection = config.boardSortDirection ?? null;

        // Раунд 164 (по запросу Mr.D: "нужно добавить виджеты для
        // узлов Импорта") - getDashboardWidget() ниже УЖЕ существовал,
        // но был НЕДОСТИЖИМ через интерфейс - у этой ноды не было
        // getInspectorSchema() вообще (использовался пустой дефолт из
        // BaseNode), раздел "Доска" никогда не показывался, включить
        // виджет было физически невозможно.
        initBoardPublishFields(this, config);
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

    // "Двойное кодирование" (Раунд 63) - значение-СТРОКА, которая САМА
    // является валидным JSON (после trim начинается с { или [ и успешно
    // парсится) - частый паттерн у систем, хранящих сериализованный JSON
    // текстом (в т.ч. весь файл целиком может быть такой строкой - именно
    // так устроен реальный файл, на котором это найдено: корневое
    // значение файла - JSON-строка, а НАСТОЯЩИЙ объект лежит ВНУТРИ неё).
    // Возвращает РАЗОБРАННОЕ значение или undefined, если это не JSON.
    static _tryParseJsonString(value) {
        if (typeof value !== 'string') return undefined;
        const trimmed = value.trim();
        if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return undefined;
        try {
            const parsed = JSON.parse(trimmed);
            if (parsed !== null && typeof parsed === 'object') return parsed;
        } catch {
            // похоже на JSON по первому символу, но не распарсилось -
            // это просто текст, начинающийся с { или [, не наша забота
        }
        return undefined;
    }

    // Рекурсивный разбор одного JSON-значения в {tableData, branches} -
    // см. докстринг класса про правила
    static _convertJsonValue(value, fallbackName) {
        // Раунд 63 - если ЭТО САМО значение - строка с вложенным JSON,
        // разворачиваем её ПЕРЕД дальнейшей классификацией (объект/
        // массив/примитив) - без этой проверки корневая строка целого
        // файла (двойное кодирование) осела бы одной текстовой ячейкой
        // вместо раскрываемого дерева
        const selfNested = JsonImportNode._tryParseJsonString(value);
        if (selfNested !== undefined) value = selfNested;

        if (Array.isArray(value)) {
            if (value.length === 0) return { tableData: new TableData(), branches: [] };

            const isComplexItem = (item) => {
                if (item !== null && typeof item === 'object') return true;
                return JsonImportNode._tryParseJsonString(item) !== undefined;
            };

            const allPrimitive = value.every(v => !isComplexItem(v));
            if (allPrimitive) {
                return {
                    tableData: new TableData([
                        { header: 'Значение', values: value, format: JsonImportNode._inferFormat(value) }
                    ]),
                    branches: []
                };
            }

            const branches = value.map((item, i) => {
                const nested = JsonImportNode._tryParseJsonString(item);
                const actualItem = nested !== undefined ? nested : item;
                return {
                    name: JsonImportNode._extractItemName(actualItem, i),
                    srcNode: JsonImportNode._convertJsonValue(actualItem, String(i + 1))
                };
            });
            return { tableData: new TableData(), branches };
        }

        if (value !== null && typeof value === 'object') {
            const primitiveEntries = [];
            const complexEntries = [];
            Object.entries(value).forEach(([k, v]) => {
                const nested = JsonImportNode._tryParseJsonString(v);
                if (nested !== undefined) {
                    complexEntries.push([k, nested]);
                } else if (v !== null && typeof v === 'object') {
                    complexEntries.push([k, v]);
                } else {
                    primitiveEntries.push([k, v]);
                }
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
            syncNodeToBoards(this);
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

        syncNodeToBoards(this);
        return this.value;
    }

    getDisplayName() {
        return this.customName || 'Импорт JSON';
    }

    // Раунд 164/165 (по запросу Mr.D: "нужно добавить виджеты для узлов
    // Импорта", позже уточнено: "виджет импорта работает как просмотр,
    // это не то. Мне нужно чтобы я мог импортировать файл через этот
    // виджет не заходя на Лист. Функции должны просто дублироваться,
    // просмотра не надо. Компактный вид похожий на то, что мы видим у
    // узла") - раньше (Раунд 164) виджет показывал ПРОСМОТР уже
    // импортированных данных (TableWidgetRenderer) - заменено
    // (Раунд 165) на дубликат САМОГО ТЕЛА НОДЫ (createContent() выше) -
    // выбор файла, имя файла, статус - ТЕ ЖЕ методы (_onFilePicked()),
    // не копия логики. В отличие от XlsxImportNode - здесь ОДИН шаг
    // (выбор файла сразу коммитит и вызывает calculateAll(), см.
    // _onFilePicked() выше) - отдельная кнопка "Импортировать" не нужна.
    getDashboardWidget() {
        return {
            type: 'action',
            title: this.customName || null,
            render: (container) => {
                const fileInput = document.createElement('input');
                fileInput.type = 'file';
                fileInput.accept = '.json,application/json';
                fileInput.style.display = 'none';
                fileInput.addEventListener('mousedown', (e) => e.stopPropagation());
                fileInput.addEventListener('change', (e) => {
                    const file = e.target.files && e.target.files[0];
                    e.target.value = '';
                    if (file) this._onFilePicked(file);
                });
                container.appendChild(fileInput);

                const pickBtn = document.createElement('button');
                pickBtn.className = 'xlsx-pick-btn node-action-btn board-widget-export-btn';
                pickBtn.textContent = '📄 Выбрать JSON-файл';
                pickBtn.addEventListener('mousedown', (e) => e.stopPropagation());
                pickBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    fileInput.click();
                });
                container.appendChild(pickBtn);

                const fileNameEl = document.createElement('div');
                fileNameEl.className = 'board-widget-export-status';
                fileNameEl.textContent = this.fileName || 'файл не выбран';
                fileNameEl.title = this.fileName || '';
                container.appendChild(fileNameEl);

                const statusEl = document.createElement('div');
                statusEl.className = 'board-widget-export-status';
                statusEl.textContent = this._statusText();
                container.appendChild(statusEl);
            }
        };
    }

    getInspectorSchema() {
        const fields = super.getInspectorSchema();
        fields.push(...buildBoardInspectorFields(this));
        return fields;
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
