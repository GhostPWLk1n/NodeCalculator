/**
 * SPDX-License-Identifier: MIT
 * SPDX-FileCopyrightText: 2024 NodeCalculate Team
 * SPDX-FileCopyrightText: 2024 Pavel Fomin
 *
 * @file    dashboardNode.js
 * @brief   Нода-мост: подключает источник данных к виджету на конкретной Доске
 * @author  Pavel Fomin
 * @version 1.7.24
 * @see     https://github.com/GhostPWLk1n/NodeCalculator.git
 */

import { BaseNode } from './baseNode.js';
import { SocketFactory } from '../utils/socketFactory.js';
import { ListData } from '../utils/dataTypes.js';

/**
 * DashboardNode - живёт на обычном Листе (как любая другая нода), но
 * фактически передаёт данные не по графу вычислений, а на Доску
 * (см. boardManager.js) - отдельный холст для визуализации,
 * подготовленный под экспорт (PDF и т.п.).
 *
 * Вход и выход - универсальные (any): подключается к чему угодно, и
 * пробрасывает то же самое насквозь (value/listData/tableData
 * зеркалятся от источника) - ноду можно поставить посередине цепочки,
 * не обрывая граф.
 *
 * Совместимость с Доской определяется не типом сокета (any пропускает
 * всё), а тем, реализует ли ПОДКЛЮЧЁННЫЙ ИСТОЧНИК метод
 * getDashboardWidget() (см. numberNode.js/stringNode.js/listInputNode.js
 * за примерами). Если нет - нода вешает на себя error-бейдж (см.
 * baseNode.js) и красит входящую связь в красный
 * (connectionManager.setConnectionError) - оба сигнала независимы от
 * системы типов сокетов, ровно на этот случай их и строили.
 *
 * targetBoardId (какая Доска получает виджет) и dashboardOrder (порядок
 * виджета на странице) - в боковой панели.
 *
 * ПЕРЕОПРЕДЕЛЕНИЕ ЗНАЧЕНИЯ (Раунд 38). Раньше правка редактируемого
 * виджета (Число/Строка/Список, см. Раунд 37) писала ПРЯМО в исходную
 * ноду (src.setValue()) - значит меняла её и везде ЕЩЁ, где та нода
 * подключена, в обход Доски. Это ломало ожидаемую модель "Доска - это
 * ОТДЕЛЬНАЯ развилка данных": Число → Дашборд → Диаграмма должно уметь
 * показывать на Диаграмме отредактированное на Доске значение, но при
 * этом оставлять само исходное Число нетронутым.
 *
 * Теперь редактирование виджета пишет в this.overrideValue/this.overridden
 * (этой ноды, НЕ источника) - см. calculate() ниже: пока overridden=true,
 * СВОЙ выход (value/listData/tableData) эта нода строит из overrideValue,
 * а не пробрасывает src насквозь. overridden включается АВТОМАТИЧЕСКИ
 * первой же правкой в виджете; снять его (вернуться к исходному значению
 * источника) можно из боковой панели. this.locked - отдельный флаг
 * "нередактируемая": когда включён, виджет на Доске рисуется КАК ЕСТЬ,
 * без полей ввода, независимо от overridden.
 *
 * Источник получает эти данные через параметр ctx у getDashboardWidget(ctx):
 *   ctx.readOnly       - true, если редактирование запрещено (this.locked)
 *   ctx.overrideValue  - текущее переопределённое значение (если
 *                        overridden), либо undefined - тогда нода-источник
 *                        показывает своё СОБСТВЕННОЕ живое значение
 *   ctx.onEdit(value)  - вызывается источником при правке ВМЕСТО прямой
 *                        записи в себя; value - число/строка (Число/
 *                        Строка) или массив {name,value} (Список)
 */
export class DashboardNode extends BaseNode {
    constructor(id, type, x, y, config = {}) {
        super(id, type, x, y, config);
        this.inputs = 1;
        this.inputSockets = [0];
        this.outputs = 1;
        this.width = config.width || 220;

        this.targetBoardId = config.targetBoardId ?? null;
        // null = автопорядок (следующий свободный номер на доске)
        this.dashboardOrder = config.dashboardOrder ?? null;

        // Оформление виджета НА ДОСКЕ (не путать с this.color - тем
        // акцентным цветом самой ноды в графе, из BaseNode). Читается/
        // пишется через боковую панель, когда виджет выбран КЛИКОМ ПО
        // НЕМУ НА ДОСКЕ (см. boardManager.selectWidget()) - объект
        // передаётся в boardManager.registerWidget() ПО ССЫЛКЕ (не
        // клонируется, см. calculate() ниже), поэтому правки из панели
        // применяются на Доске сразу, без пересчёта графа - даже если
        // сама эта нода сейчас находится на неактивном Листе.
        this.widgetStyle = {
            color: config.widgetStyle?.color ?? null,
            size: config.widgetStyle?.size ?? 'medium',
            align: config.widgetStyle?.align ?? 'left'
        };

        // Место на условной сетке страницы Доски (см. boardManager.js,
        // Раунд 32) - colSpan (1-12) всегда задан явно, rowSpan === null
        // значит "авто-высота по контенту", пока пользователь не потянет
        // за верхнюю/нижнюю ручку сам (см. boardManager.attachResizeDrag).
        // Как и widgetStyle - передаётся в registerWidget() ПО ССЫЛКЕ, не
        // клонируется, поэтому перетаскивание ручки применяется на Доске
        // сразу, без пересчёта графа.
        this.widgetLayout = {
            colSpan: config.widgetLayout?.colSpan ?? 12,
            rowSpan: config.widgetLayout?.rowSpan ?? null
        };

        // Переопределение значения виджетом (см. докстринг класса и
        // calculate() ниже). overrideValue - число/строка ИЛИ массив
        // {name,value} (для списочных источников) - тип зависит от
        // источника, эта нода его не интерпретирует, а просто хранит и
        // передаёт куда нужно.
        this.overridden = config.overridden ?? false;
        this.overrideValue = config.overrideValue ?? null;
        // "Нередактируемая" - запрещает редактирование виджета на Доске
        // вообще (источник рисует виджет только для просмотра, см. ctx.readOnly)
        this.locked = config.locked ?? false;
        // id последнего источника, на котором стояли calculate() - если
        // соединение переключили на ДРУГОЙ источник, старое overrideValue
        // относится уже не к тому и сбрасывается (см. calculate()).
        // undefined (не null!) - специальный маркер "ещё не считали ни
        // разу", чтобы не сбросить восстановленное из сохранения
        // overrideValue на первом же calculate() после загрузки проекта.
        this._lastSrcId = undefined;

        this._sourceName = null;
        this._widgetType = null;
    }

    createContent() {
        const content = document.createElement('div');
        content.className = 'node-content';
        content.style.cssText = 'width: 100%; min-width: 150px;';

        // --- строка 1: источник данных (any) ---
        const inRow = document.createElement('div');
        inRow.style.cssText = 'display:flex; align-items:center; gap:6px;';
        const inSocket = SocketFactory.createSocket({
            nodeId: this.id, socketType: 'input', index: 0, isAny: true,
            title: 'Источник данных - любой тип, поддерживающий виджет Доски'
        });
        inRow.appendChild(inSocket);
        const sourceLabel = document.createElement('span');
        sourceLabel.className = 'dashboard-source-label';
        sourceLabel.style.cssText = `
            color: var(--md-text-secondary);
            font-size: 11px;
            flex: 1;
            min-width: 0;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        `;
        sourceLabel.textContent = this._sourceName || 'не подключено';
        inRow.appendChild(sourceLabel);
        content.appendChild(inRow);

        // --- строка 2: целевая доска (только для чтения тут - выбор в панели) ---
        const boardRow = document.createElement('div');
        boardRow.style.cssText = 'display:flex; align-items:center; gap:6px;';
        const boardLabel = document.createElement('span');
        boardLabel.className = 'dashboard-board-label';
        boardLabel.style.cssText = `
            color: var(--md-text-disabled);
            font-size: 10px;
            flex: 1;
            min-width: 0;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            padding-left: 20px;
        `;
        boardLabel.textContent = this._boardLabelText();
        boardRow.appendChild(boardLabel);
        content.appendChild(boardRow);

        // --- строка 3: выход (проброс насквозь) ---
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
        outLabel.textContent = 'Проброс:';
        outLabel.style.cssText = 'color:var(--md-text-secondary); font-size:11px; flex:1;';
        outRow.appendChild(outLabel);
        const outSocket = SocketFactory.createSocket({
            nodeId: this.id, socketType: 'output', index: 0, isAny: true,
            title: 'То же самое, что пришло на вход - нода не обрывает граф'
        });
        outRow.appendChild(outSocket);
        content.appendChild(outRow);

        return content;
    }

    _boardLabelText() {
        if (this.targetBoardId === null) return '→ доска не выбрана';
        const board = window.boardManager?.getBoard(this.targetBoardId);
        return `→ ${board ? board.name : 'доска не найдена'}`;
    }

    calculate(nodeManager) {
        const connections = window.connectionManager?.getConnections() || [];
        const conn = connections.find(c => c.targetNodeId === this.id && c.targetSocket === 0);
        const src = conn ? nodeManager.getNode(conn.sourceNodeId) : null;
        const srcId = src ? src.id : null;

        // Источник сменился (переключили соединение на другую ноду) -
        // старое overrideValue относилось к ДРУГОМУ источнику, больше не
        // имеет смысла. Первый вызов после загрузки проекта не в счёт -
        // _lastSrcId === undefined значит "ещё не считали", не "сменился".
        if (this._lastSrcId !== undefined && srcId !== this._lastSrcId) {
            this.overridden = false;
            this.overrideValue = null;
        }
        this._lastSrcId = srcId;

        this._sourceName = src ? (src.customName || src.getDisplayName?.() || 'источник') : null;

        const hasWidget = !!(src && typeof src.getDashboardWidget === 'function');

        if (src && !hasWidget) {
            const sourceLabel = src.customName || src.getDisplayName?.() || src.type;
            this.addBadge('dashboard-compat', {
                type: 'error',
                text: `«${sourceLabel}» не поддерживает отображение на Доске`
            });
            if (conn) {
                window.connectionManager?.setConnectionError(
                    conn.sourceNodeId, conn.targetNodeId, conn.targetSocket,
                    true, 'Источник не поддерживает Доску'
                );
            }
        } else {
            this.clearBadge('dashboard-compat');
            if (conn) {
                window.connectionManager?.setConnectionError(
                    conn.sourceNodeId, conn.targetNodeId, conn.targetSocket, false
                );
            }
        }

        // Свой выход (value/listData/tableData) - см. докстринг класса.
        // Пока overridden=true, строим его из overrideValue вместо
        // проброса src насквозь: этой развилки достаточно, чтобы
        // дальнейшая цепочка (например, ChartNode) увидела
        // отредактированное на Доске значение, а сам src остался нетронут.
        if (this.overridden) {
            if (Array.isArray(this.overrideValue)) {
                // Источник-список (ListInputNode и т.п.)
                this.listData = new ListData(
                    this.overrideValue.map(i => ({ name: i.name, value: i.value })),
                    { title: this._sourceName || 'Список', isFullList: true }
                );
                this.value = this.listData.total;
                this.tableData = src?.tableData ?? null;
            } else {
                this.value = this.overrideValue;
                // ListData имеет смысл только для числового переопределения
                // (Число) - строковое (Строка) через неё не выражается,
                // тогда просто не трогаем listData источника вовсе
                this.listData = (typeof this.overrideValue === 'number')
                    ? new ListData(
                        [{ name: this._sourceName || 'значение', value: this.overrideValue }],
                        { title: this._sourceName || 'значение' }
                    )
                    : (src?.listData ?? null);
                this.tableData = src?.tableData ?? null;
            }
            this.addBadge('dashboard-override', { type: 'info', text: 'Значение переопределено на Доске' });
        } else {
            // Проброс насквозь - с выхода этой ноды можно читать те же
            // поля, что были бы доступны при подключении напрямую к источнику
            this.value = src?.value ?? null;
            this.listData = src?.listData;
            this.tableData = src?.tableData;
            this.clearBadge('dashboard-override');
        }

        if (window.boardManager) {
            if (this.targetBoardId !== null && hasWidget) {
                // ctx - см. докстринг класса: источник рисует виджет
                // read-only (locked), показывает overrideValue вместо
                // своего живого значения (если overridden), и на правку
                // вызывает onEdit() ВМЕСТО прямой записи в себя
                const ctx = {
                    readOnly: this.locked,
                    overrideValue: this.overridden ? this.overrideValue : undefined,
                    onEdit: (value) => {
                        this.overrideValue = value;
                        this.overridden = true;
                        if (window.nodeManager) window.nodeManager.calculateAll();
                    }
                };
                const widget = src.getDashboardWidget(ctx);
                this._widgetType = widget.type;
                window.boardManager.registerWidget(this.targetBoardId, this.id, {
                    order: this.dashboardOrder,
                    type: widget.type,
                    title: widget.title,
                    render: widget.render,
                    // ссылка, не копия - см. комментарий у this.widgetStyle/this.widgetLayout
                    style: this.widgetStyle,
                    layout: this.widgetLayout,
                    // Метка "переопределено" - см. докстринг класса, чисто
                    // визуальная (boardManager.buildWidgetEl рисует по ней
                    // маленькую пометку в углу виджета)
                    overridden: this.overridden
                });
            } else {
                this._widgetType = null;
                window.boardManager.unregisterWidgetEverywhere(this.id);
            }
        }

        return this.value;
    }

    updateDisplay(element) {
        const sourceLabel = element.querySelector('.dashboard-source-label');
        if (sourceLabel) sourceLabel.textContent = this._sourceName || 'не подключено';

        const boardLabel = element.querySelector('.dashboard-board-label');
        if (boardLabel) boardLabel.textContent = this._boardLabelText();
    }

    // Боковая панель: какая Доска получает виджет + порядок на странице.
    // Список досок читается из window.boardManager - тот же паттерн, что
    // у layoutInputNode.js со списком Листов.
    getInspectorSchema() {
        const fields = super.getInspectorSchema();

        fields.push({ type: 'section', label: 'Доска' });

        const boards = window.boardManager?.getAllBoards() || [];
        fields.push({
            key: 'targetBoardId',
            label: 'Целевая доска',
            type: 'select',
            options: [
                { value: '', label: '— не выбрана —' },
                ...boards.map(b => ({ value: String(b.id), label: b.name }))
            ],
            get: () => (this.targetBoardId === null ? '' : String(this.targetBoardId)),
            set: (v) => {
                this.targetBoardId = v === '' ? null : parseInt(v, 10);
                if (window.nodeManager) window.nodeManager.calculateAll();
            }
        });

        fields.push({
            key: 'dashboardOrder',
            label: 'Порядок на странице (пусто = авто)',
            type: 'number',
            min: 0, step: 1,
            get: () => this.dashboardOrder,
            set: (v) => {
                this.dashboardOrder = v;
                if (window.nodeManager) window.nodeManager.calculateAll();
            }
        });

        // Стиль ВИДЖЕТА (как он выглядит на странице Доски) - отдельная
        // группа полей от "Доска" выше. Пишет напрямую в this.widgetStyle
        // и перерисовывает только Доску (renderActiveBoard), НЕ гоняя весь
        // граф через calculateAll() - см. комментарий у widgetStyle в
        // конструкторе про то, почему это безопасно даже для ноды с
        // неактивного Листа.
        fields.push({ type: 'section', label: 'Стиль виджета' });

        fields.push({
            key: 'widgetColor',
            label: 'Цвет акцента',
            type: 'color',
            get: () => this.widgetStyle.color,
            set: (v) => {
                this.widgetStyle.color = v;
                window.boardManager?.renderActiveBoard();
            }
        });

        fields.push({
            key: 'widgetSize',
            label: 'Размер',
            type: 'select',
            options: [
                { value: 'small', label: 'Компактный' },
                { value: 'medium', label: 'Обычный' },
                { value: 'large', label: 'Крупный' }
            ],
            get: () => this.widgetStyle.size || 'medium',
            set: (v) => {
                this.widgetStyle.size = v || 'medium';
                window.boardManager?.renderActiveBoard();
            }
        });

        fields.push({
            key: 'widgetAlign',
            label: 'Выравнивание',
            type: 'select',
            options: [
                { value: 'left', label: 'Слева' },
                { value: 'center', label: 'По центру' },
                { value: 'right', label: 'Справа' }
            ],
            get: () => this.widgetStyle.align || 'left',
            set: (v) => {
                this.widgetStyle.align = v || 'left';
                window.boardManager?.renderActiveBoard();
            }
        });

        // Переопределение значения (см. докстринг класса) - overridden
        // включается АВТОМАТИЧЕСКИ первой же правкой в виджете; здесь
        // можно только СНЯТЬ его (вернуться к живому значению источника) -
        // ручная установка в true без правки виджета просто выставит флаг
        // (overrideValue тогда null, пока пользователь не отредактирует
        // виджет по-настоящему).
        fields.push({ type: 'section', label: 'Переопределение значения' });

        fields.push({
            key: 'overridden',
            label: 'Значение переопределено на Доске',
            type: 'checkbox',
            get: () => this.overridden,
            set: (v) => {
                this.overridden = !!v;
                if (!this.overridden) this.overrideValue = null;
                if (window.nodeManager) window.nodeManager.calculateAll();
            }
        });

        fields.push({
            key: 'locked',
            label: 'Нередактируемая (запретить менять значение на Доске)',
            type: 'checkbox',
            get: () => this.locked,
            set: (v) => {
                this.locked = !!v;
                window.boardManager?.renderActiveBoard();
            }
        });

        return fields;
    }
}
