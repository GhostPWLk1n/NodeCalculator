/**
 * SPDX-License-Identifier: MIT
 * SPDX-FileCopyrightText: 2024 NodeCalculate Team
 * SPDX-FileCopyrightText: 2024 Pavel Fomin
 *
 * @file    tableFilterNode.js
 * @brief   Обработчик: отсеивает строки таблицы по условиям на столбцы (список значений или сравнение)
 * @author  Pavel Fomin
 * @version 1.8.42
 * @see     https://github.com/GhostPWLk1n/NodeCalculator.git
 */

import { BaseNode } from './baseNode.js';
import { Helpers } from '../utils/helpers.js';
import { TableData } from '../utils/dataTypes.js';
import { SocketFactory } from '../utils/socketFactory.js';
import { TableWidgetRenderer } from '../utils/tableWidgetRenderer.js';

/**
 * TableFilterNode ("Отсеять") - Data → Data. Формирует новую таблицу,
 * оставляя только строки, которые проходят условие ПО КАЖДОМУ столбцу
 * (this.columnFilters[i] - строка-условие для столбца i, пустая строка =
 * без условия, этот столбец не ограничивает выборку). Строка проходит,
 * только если она подходит ПОД ВСЕ заданные условия одновременно (AND).
 *
 * Каждое условие - обычный текст, ФОРМАТ условия определяется
 * автоматически по его виду (_matchesFilter() ниже):
 *
 *   - Если строка начинается с оператора сравнения (>, <, >=, <=, =, !=,
 *     <>) - "сравнение": остаток строки - число или текст, с которым
 *     сравнивается значение ячейки (пример из ТЗ: "третий[>30]").
 *   - Иначе - "перечень": строка через запятую задаёт СПИСОК допустимых
 *     значений, строка проходит, если значение ячейки совпадает с ЛЮБЫМ
 *     из них (пример из ТЗ: "первый столбец - [0, 1, 5]",
 *     "второй[Вася, Лена]").
 *
 * Сравнение чисел - как чисел, если ячейка - число и правая часть
 * условия распознаётся как число; иначе - как текст (регистронезависимо).
 * this.columnFilters синхронизируется по длине с текущим набором
 * столбцов на каждый calculate() - лишние условия обрезаются,
 * недостающие столбцы получают условие "" (без ограничения).
 *
 * РЕГУЛЯРНЫЕ ВЫРАЖЕНИЯ (добавлено в версии 1.7.6):
 *   - Для каждого столбца можно включить режим регулярных выражений
 *     (this.useRegex[i] - boolean). В этом режиме условие интерпретируется
 *     как регулярное выражение (без учёта регистра по умолчанию).
 *   - Поддерживаются флаги: можно добавить в конце выражения после
 *     закрывающего слеша, например: jho*i или ^test$m
 *   - Для инвертирования результата используйте оператор "!=" перед
 *     регулярным выражением, например: !=jho*i или !="jho*i"
 *   - Для фильтрации пустых значений: != "" (исключает пустые строки)
 *     или = "" (оставляет только пустые строки)
 *
 * СПИСОК ВМЕСТО ТЕКСТА (Раунд 57, логика переработана в Раунде 59) - у
 * каждого столбца ЕСТЬ СВОЙ динамический LIST-вход (this.inputSockets =
 * [0, 1, 2, ...] - 0 это сама таблица, 1..N по одному на каждый столбец).
 * Подключённый список задаёт "таблицу членства" ИМЯ -> ИСТИНА/ЛОЖЬ, а НЕ
 * просто перечень допустимых значений:
 *
 *   - Каждый элемент списка - пара {name, value}. `value` СТРОГО
 *     приводится к bool (`Helpers.strictCoerceBool()`, вынесена в общее
 *     место в Раунде 62) - реальный boolean, числа
 *     0/1, или текст "да"/"нет"/"true"/"false"/"yes"/"no"/"истина"/"ложь"
 *     (регистронезависимо). Любое ДРУГОЕ значение (нераспознанная
 *     строка, число не 0/1 и т.п.) - ОШИБКА, а не тихое предположение.
 *   - Значение ячейки СРАВНИВАЕТСЯ С ИМЕНЕМ элемента (не со значением) -
 *     если совпало И у этого элемента value=true (после приведения) -
 *     строка проходит по этому столбцу. Если совпало, но value=false -
 *     явно НЕ проходит. Если имя вообще не встретилось в списке - тоже
 *     НЕ проходит (список должен явно перечислять и то, что оставляем,
 *     и то, что отсеиваем, а не только "включённое").
 *   - Если ХОТЯ БЫ ОДИН элемент подключённого списка не приводится к
 *     bool - условие для ЭТОГО столбца НЕ применяется вовсе (пропускает
 *     всё, как будто список не подключён), а на ноде появляется бейдж
 *     ошибки (`filterListTypeError`) с именами проблемных столбцов -
 *     см. calculate().
 *
 * Подключённый список для столбца ПОЛНОСТЬЮ ПЕРЕБИВАЕТ текстовое условие
 * для этого же столбца - оба одновременно не применяются, чтобы не
 * путать, какое условие реально сработало.
 * Сокеты синхронизируются по количеству столбцов входной таблицы -
 * тот же приём отложенного пересоздания DOM (setTimeout + rerender()),
 * что уже используется у `OperationNode`/`BooleanOperationNode`
 * (docs/NODE_API.md, раздел 9).
 */
export class TableFilterNode extends BaseNode {
    constructor(id, type, x, y, config = {}) {
        super(id, type, x, y, config);
        // 0 - таблица, 1..N - по одному LIST-входу на каждый столбец
        // (см. докстринг класса). this.inputs - обычное число, уже
        // сериализуется генерически для ЛЮБОЙ ноды (n.inputs) - массив
        // inputSockets НЕ сериализуется нигде в проекте (тот же принцип,
        // что у OperationNode/BooleanOperationNode) - при загрузке
        // проекта восстанавливается из inputs, а точный набор столбцов
        // сам "самоисцеляется" на первом же calculate() после загрузки
        this.inputs = config.inputs || 1;
        this.inputSockets = Array.from({ length: this.inputs }, (_, i) => i);
        this.outputs = 1;
        this.width = config.width || 210;

        // Условие для каждого столбца входной таблицы - см. докстринг класса
        this.columnFilters = Array.isArray(config.columnFilters) ? config.columnFilters : [];
        
        // Флаги использования регулярных выражений для каждого столбца
        this.useRegex = Array.isArray(config.useRegex) ? config.useRegex : [];

        this._sourceName = null;
        this._filterColumnHeaders = []; // для подписей сокетов в теле ноды
        this._isRerendering = false;
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
        content.style.cssText = 'width: 100%; min-width: 190px;';

        const inRow = document.createElement('div');
        inRow.style.cssText = 'display:flex; align-items:center; gap:6px;';
        const inSocket = SocketFactory.createSocket({
            nodeId: this.id, socketType: 'input', index: 0, isData: true,
            title: 'Таблица, которую отсеиваем'
        });
        inRow.appendChild(inSocket);
        const sourceLabel = document.createElement('span');
        sourceLabel.className = 'table-filter-source-label';
        sourceLabel.style.cssText = 'color:var(--md-text-secondary); font-size:11px; flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;';
        sourceLabel.textContent = this._sourceName || 'не подключено';
        inRow.appendChild(sourceLabel);
        content.appendChild(inRow);

        const statusRow = document.createElement('div');
        statusRow.style.cssText = 'padding-left:20px;';
        const statusLabel = document.createElement('span');
        statusLabel.className = 'table-filter-status-label';
        statusLabel.style.cssText = 'color:var(--md-text-disabled); font-size:10px;';
        statusLabel.textContent = this._statusText();
        statusRow.appendChild(statusLabel);
        content.appendChild(statusRow);

        // === СПИСКИ ДЛЯ УСЛОВИЙ (Раунд 57) - по одному LIST-входу на
        // каждый столбец, см. докстринг класса ===
        if (this._filterColumnHeaders.length > 0) {
            const listsHeader = document.createElement('div');
            listsHeader.style.cssText = 'padding-top:6px; margin-top:4px; border-top:1px solid var(--md-divider); color:var(--md-text-disabled); font-size:9px; text-transform:uppercase; letter-spacing:0.03em;';
            listsHeader.textContent = 'Списки условий (необязательно)';
            content.appendChild(listsHeader);

            const listsContainer = document.createElement('div');
            listsContainer.className = 'node-inputs-container';
            listsContainer.style.cssText = `
                display: flex;
                flex-direction: column;
                gap: 4px;
                padding-left: 21px;
                padding-right: 4px;
                margin-left: -21px;
                margin-top: 4px;
            `;
            this._filterColumnHeaders.forEach((header, i) => {
                listsContainer.appendChild(this._createFilterListRow(i, header));
            });
            content.appendChild(listsContainer);
        }

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
            title: 'Отфильтрованная таблица'
        });
        outRow.appendChild(outSocket);
        content.appendChild(outRow);

        return content;
    }

    _createFilterListRow(columnIndex, header) {
        const row = document.createElement('div');
        row.className = 'node-input';
        row.style.cssText = 'display:flex; align-items:center; gap:8px; padding:2px 0;';

        const socketIndex = columnIndex + 1; // 0 занят таблицей
        const isConnected = this.isListSocketConnected(socketIndex);

        const socket = SocketFactory.createSocket({
            nodeId: this.id, socketType: 'input', index: socketIndex, isList: true,
            title: `Список "имя:истина/ложь" для столбца "${header}" - перебивает текстовое условие в панели. Значение должно приводиться к bool, иначе ошибка.`
        });
        if (isConnected) {
            socket.classList.add('socket-connected');
            socket.style.background = '#4fc3f7';
            socket.style.borderColor = '#4fc3f7';
            socket.style.boxShadow = '0 0 12px rgba(79, 195, 247, 0.3)';
        }
        row.appendChild(socket);

        const label = document.createElement('label');
        label.textContent = header;
        label.style.cssText = `
            color: ${isConnected ? 'var(--md-text)' : 'var(--md-text-secondary)'};
            font-size: 11px;
            flex: 1;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        `;
        row.appendChild(label);

        return row;
    }

    isListSocketConnected(socketIndex) {
        const connections = window.connectionManager?.getConnections() || [];
        return connections.some(c => c.targetNodeId === this.id && c.targetSocket === socketIndex);
    }

    _statusText() {
        const activeCount = this.columnFilters.filter(f => (f || '').trim()).length;
        const regexCount = this.useRegex.filter(r => r === true).length;
        const regexInfo = regexCount > 0 ? ` (regex: ${regexCount})` : '';
        return activeCount
            ? `→ ${this.value ?? 0} строк прошло (условий: ${activeCount}${regexInfo})`
            : '→ без условий - пропускает всё';
    }

    // Сравнение "ячейка ОПЕРАТОР правая_часть" - числами, если можно,
    // иначе текстом (регистронезависимо)
    static _compareValue(cellValue, operator, rhsStr) {
        const rhsNum = parseFloat(rhsStr);
        const useNumeric = typeof cellValue === 'number' && !Number.isNaN(rhsNum);
        const a = useNumeric ? cellValue : String(cellValue ?? '').toLowerCase();
        const b = useNumeric ? rhsNum : rhsStr.trim().toLowerCase();
        switch (operator) {
            case '>': return a > b;
            case '<': return a < b;
            case '>=': return a >= b;
            case '<=': return a <= b;
            case '=':
            case '==': return a === b;
            case '!=':
            case '<>': return a !== b;
            default: return true;
        }
    }

    // "Ячейка равна одному из значений перечня" - числом, если ячейка
    // число и элемент перечня им распознаётся, иначе текстом
    static _valueEquals(cellValue, filterItem) {
        const trimmed = filterItem.trim();
        if (typeof cellValue === 'number') {
            const asNum = parseFloat(trimmed);
            if (!Number.isNaN(asNum)) return cellValue === asNum;
        }
        return String(cellValue ?? '').trim().toLowerCase() === trimmed.toLowerCase();
    }

    // Обработка регулярных выражений с поддержкой флагов
    static _matchesRegex(cellValue, patternStr) {
        try {
            // Проверяем, является ли строка регулярным выражением в формате /pattern/flags
            const regexMatch = /^\/(.+)\/([gimuy]*)$/.exec(patternStr.trim());
            let regex;
            if (regexMatch) {
                // Пользователь указал флаги
                regex = new RegExp(regexMatch[1], regexMatch[2] || 'i');
            } else {
                // Просто текст - экранируем специальные символы и создаём RegExp
                const escaped = patternStr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                regex = new RegExp(escaped, 'i');
            }
            
            const cellStr = String(cellValue ?? '');
            return regex.test(cellStr);
        } catch (e) {
            // Если регулярное выражение невалидно, возвращаем false
            console.warn('Invalid regex pattern:', patternStr, e);
            return false;
        }
    }

    // Авто-определение вида условия - сравнение (по оператору в начале
    // строки) или перечень значений через запятую - см. докстринг класса
    static _matchesFilter(cellValue, filterStr, useRegex = false) {
        const trimmed = filterStr.trim();
        
        // Если включён режим регулярных выражений
        if (useRegex) {
            // Проверяем, есть ли оператор инвертирования перед регулярным выражением
            const invertMatch = /^(!=|<>)\s*(.+)$/.exec(trimmed);
            if (invertMatch) {
                // Инвертированное регулярное выражение (не должно совпадать)
                const pattern = invertMatch[2].trim();
                // Специальная обработка для пустых значений
                if (pattern === '""' || pattern === "''") {
                    return cellValue !== '' && cellValue !== null && cellValue !== undefined;
                }
                return !TableFilterNode._matchesRegex(cellValue, pattern);
            }
            
            // Обычное регулярное выражение
            const eqMatch = /^(=|==)?\s*(.+)$/.exec(trimmed);
            if (eqMatch) {
                const pattern = eqMatch[2].trim();
                // Специальная обработка для пустых значений
                if (pattern === '""' || pattern === "''") {
                    return cellValue === '' || cellValue === null || cellValue === undefined;
                }
                return TableFilterNode._matchesRegex(cellValue, pattern);
            }
            
            // Если не удалось распарсить, пробуем как простое регулярное выражение
            return TableFilterNode._matchesRegex(cellValue, trimmed);
        }
        
        // Обычный режим (без регулярных выражений)
        const compMatch = /^(>=|<=|!=|<>|>|<|={1,2})\s*(.+)$/.exec(trimmed);
        if (compMatch) {
            return TableFilterNode._compareValue(cellValue, compMatch[1], compMatch[2]);
        }
        
        const list = trimmed.split(',').map(s => s.trim()).filter(s => s.length > 0);
        if (list.length === 0) return true;
        return list.some(item => TableFilterNode._valueEquals(cellValue, item));
    }

    // Авто-подстройка DOM под изменившееся число сокетов (см. calculate() -
    // вызывается ОТЛОЖЕННО через setTimeout, не прямо во время пересчёта
    // графа) - тот же приём, что у OperationNode/BooleanOperationNode
    // (docs/NODE_API.md, раздел 9)
    rerender() {
        if (this._isRerendering) return;
        this._isRerendering = true;

        const el = document.querySelector(`[data-node-id="${this.id}"]`);
        if (el) {
            el.remove();
            if (window.nodeManager) {
                window.nodeManager.renderNode(this);
                if (window.renderer) {
                    window.renderer.drawAllConnections(window.connectionManager?.getConnections() || []);
                }
            }
        }

        setTimeout(() => { this._isRerendering = false; }, 100);
    }

    // Строит "таблицу членства" имя -> true/false из подключённого списка
    // (Раунд 59) - каждый элемент списка {name, value} говорит "у значения
    // ИМЯ результат ЗНАЧЕНИЕ (после строгого приведения к bool)". Если
    // ХОТЯ БЫ ОДИН элемент не приводится к bool - hasError:true, и это
    // условие для столбца НЕ применяется вовсе (см. calculate()) - ошибка
    // сообщается бейджем, а не тихо "предполагаем что-то".
    static _buildMembershipMap(srcNode) {
        const items = srcNode?.listData?.items || [];
        const map = new Map();
        let hasError = false;
        items.forEach(item => {
            const b = Helpers.strictCoerceBool(item.value);
            if (b === null) {
                hasError = true;
            } else {
                map.set(String(item.name ?? ''), b);
            }
        });
        return { map, hasError };
    }

    // Проходит, только если ЗНАЧЕНИЕ ЯЧЕЙКИ совпадает (как имя) с записью
    // в таблице членства И эта запись - true. Нет в списке ИЛИ явно false -
    // не проходит (см. докстринг класса)
    static _matchesMembership(cellValue, membershipMap) {
        const key = String(cellValue ?? '');
        return membershipMap.get(key) === true;
    }

    calculate(nodeManager) {
        const connections = window.connectionManager?.getConnections() || [];
        const conn = connections.find(c => c.targetNodeId === this.id && c.targetSocket === 0);
        const srcNode = conn ? nodeManager.getNode(conn.sourceNodeId) : null;

        this._sourceName = srcNode ? (srcNode.customName || srcNode.getDisplayName?.() || 'источник') : null;

        const baseTable = (srcNode && srcNode.tableData && srcNode.tableData.columns.length > 0)
            ? srcNode.tableData
            : new TableData();

        // Синхронизация условий по длине с текущим набором столбцов -
        // тот же приём, что у columnStyles в TableFormatNode (Раунд 44)
        while (this.columnFilters.length < baseTable.columns.length) this.columnFilters.push('');
        this.columnFilters.length = baseTable.columns.length;
        
        // Синхронизация флагов регулярных выражений
        while (this.useRegex.length < baseTable.columns.length) this.useRegex.push(false);
        this.useRegex.length = baseTable.columns.length;
        
        this._filterColumnHeaders = baseTable.columns.map(c => c.header);

        // Раунд 57 - синхронизация LIST-сокетов (1 на столбец) по
        // количеству столбцов - см. докстринг класса. Меняем метаданные
        // СРАЗУ (расчёт связей ниже уже использует актуальный набор), а
        // DOM подгоняем ОТЛОЖЕННО (rerender() в setTimeout ниже) - тот же
        // принцип, что у checkAndAddEmptySlot() в OperationNode.
        const desiredSockets = [0, ...baseTable.columns.map((_, i) => i + 1)];
        const socketsChanged = JSON.stringify(this.inputSockets) !== JSON.stringify(desiredSockets);
        this.inputSockets = desiredSockets;
        this.inputs = desiredSockets.length;

        if (baseTable.columns.length === 0) {
            this.tableData = baseTable;
            this.value = 0;
            this.clearBadge('filterListTypeError');
            if (socketsChanged) setTimeout(() => this.rerender(), 100);
            return this.value;
        }

        // Для каждого столбца - "таблица членства" ИЗ ПОДКЛЮЧЁННОГО LIST-
        // входа, если он есть (перебивает текстовое условие целиком), иначе
        // null (используем обычное текстовое условие ниже) - см. докстринг
        // класса и _buildMembershipMap() про строгое приведение к bool
        const errorColumns = [];
        const listMemberships = baseTable.columns.map((col, c) => {
            const listConn = connections.find(cn => cn.targetNodeId === this.id && cn.targetSocket === c + 1);
            const listSrc = listConn ? nodeManager.getNode(listConn.sourceNodeId) : null;
            if (!listSrc) return null;

            const { map, hasError } = TableFilterNode._buildMembershipMap(listSrc);
            if (hasError) {
                errorColumns.push(col.header);
                return { error: true };
            }
            return { map };
        });

        if (errorColumns.length > 0) {
            this.addBadge('filterListTypeError', {
                type: 'error',
                text: `Список для "${errorColumns.join(', ')}" содержит значения, не приводимые к булеву - условие не применено`
            });
        } else {
            this.clearBadge('filterListTypeError');
        }

        const rowCount = baseTable.rowCount;
        const keepIndexes = [];
        for (let r = 0; r < rowCount; r++) {
            let passes = true;
            for (let c = 0; c < baseTable.columns.length; c++) {
                const membership = listMemberships[c];
                if (membership) {
                    if (membership.error) continue; // ошибка конвертации - не ограничиваем этим столбцом
                    if (!TableFilterNode._matchesMembership(baseTable.columns[c].values[r], membership.map)) {
                        passes = false;
                        break;
                    }
                    continue;
                }
                const filterStr = (this.columnFilters[c] || '').trim();
                if (!filterStr) continue;
                if (!TableFilterNode._matchesFilter(
                    baseTable.columns[c].values[r], 
                    filterStr, 
                    this.useRegex[c] || false
                )) {
                    passes = false;
                    break;
                }
            }
            if (passes) keepIndexes.push(r);
        }

        const columns = baseTable.columns.map(col => ({
            header: col.header,
            format: col.format,
            values: keepIndexes.map(i => col.values[i] ?? null)
        }));

        this.tableData = new TableData(columns, { ...baseTable.metadata });
        this.value = this.tableData.rowCount;

        if (socketsChanged) setTimeout(() => this.rerender(), 100);

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
        const sourceLabel = element.querySelector('.table-filter-source-label');
        if (sourceLabel) sourceLabel.textContent = this._sourceName || 'не подключено';

        const statusLabel = element.querySelector('.table-filter-status-label');
        if (statusLabel) statusLabel.textContent = this._statusText();

        // Подсветка подключённых LIST-сокетов по столбцам (Раунд 57) -
        // сам набор строк не пересоздаём тут (это делает rerender(),
        // только когда меняется КОЛИЧЕСТВО столбцов), просто обновляем
        // визуальное состояние "подключено/нет" на уже существующих
        const rows = element.querySelectorAll('.node-inputs-container .node-input');
        rows.forEach((row, i) => {
            const socketIndex = i + 1;
            const isConnected = this.isListSocketConnected(socketIndex);
            const socket = row.querySelector('.socket');
            const label = row.querySelector('label');
            if (socket) {
                if (isConnected) {
                    socket.classList.add('socket-connected');
                    socket.style.background = '#4fc3f7';
                    socket.style.borderColor = '#4fc3f7';
                    socket.style.boxShadow = '0 0 12px rgba(79, 195, 247, 0.3)';
                } else {
                    socket.classList.remove('socket-connected');
                    socket.style.background = '';
                    socket.style.borderColor = '';
                    socket.style.boxShadow = '';
                }
            }
            if (label) label.style.color = isConnected ? 'var(--md-text)' : 'var(--md-text-secondary)';
        });
    }

    getInspectorSchema() {
        const fields = super.getInspectorSchema();

        fields.push({ type: 'section', label: 'Условия по столбцам' });
        fields.push({
            type: 'section',
            label: 'Список через запятую ("0, 1, 5") или сравнение (">30", "!=0") - пусто = без условия. Подключённый список (сокет в теле ноды) полностью перебивает текст здесь. Включите Regex для поиска по фрагменту.'
        });

        this.columnFilters.forEach((filterStr, i) => {
            const header = this.tableData.columns[i]?.header;
            const isOverridden = this.isListSocketConnected(i + 1);
            const colName = header || `Столбец ${i + 1}`;
            
            // Группа для каждого столбца
            fields.push({
                key: `filterGroup_${i}`,
                type: 'section',
                label: colName + (isOverridden ? ' — переопределено подключённым списком' : '')
            });

            // Поле ввода условия
            fields.push({
                key: `filterCol${i}`,
                label: 'Условие',
                type: 'text',
                get: () => this.columnFilters[i] || '',
                set: (v) => { this.columnFilters[i] = v || ''; }
            });

            // Кнопка-переключатель для регулярных выражений
            fields.push({
                key: `regexToggle${i}`,
                label: 'Регулярное выражение',
                type: 'checkbox',
                disabled: isOverridden,
                get: () => this.useRegex[i] || false,
                set: (v) => { 
                    this.useRegex[i] = !!v; 
                    // При изменении режима автоматически пересчитываем
                    if (window.nodeManager) window.nodeManager.calculateAll();
                }
            });

            // Подсказка для регулярных выражений
            if (this.useRegex[i]) {
                fields.push({
                    type: 'section',
                    label: '💡 Примеры: /jho*/i - поиск по фрагменту, !=/jho*/i - исключить фрагмент, ="" - только пустые, !="" - исключить пустые'
                });
            }
        });

        return fields;
    }
}