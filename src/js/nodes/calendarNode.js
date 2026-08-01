/**
 * SPDX-License-Identifier: MIT
 * SPDX-FileCopyrightText: 2024 NodeCalculate Team
 * SPDX-FileCopyrightText: 2024 Pavel Fomin
 *
 * @file    calendarNode.js
 * @brief   Визуальный календарь (сетка месяца) для ручной разметки праздников/дней - источник для сокета "Праздники" у GanttNode
 * @author  Pavel Fomin
 * @version 1.7.24
 * @see     https://github.com/GhostPWLk1n/NodeCalculator.git
 */

import { BaseNode } from './baseNode.js';
import { Helpers } from '../utils/helpers.js';
import { ListData, TableData } from '../utils/dataTypes.js';
import { SocketFactory } from '../utils/socketFactory.js';
import { HolidayParser } from '../utils/holidayParser.js';

const MAX_DATES = 3660; // ~10 лет суммарно - защита от случайно введённого гигантского диапазона
const WEEKDAY_LABELS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']; // с понедельника
const MONTH_LABELS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];

function formatISO(date) {
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}

function parseISO(str) {
    const d = new Date(str + 'T00:00:00');
    return isNaN(d.getTime()) ? null : d;
}

/**
 * CalendarNode ("Календарь") - Раунд 74, переработка по замечаниям
 * Mr.D к первой версии (список строк с двумя полями даты - неудобно).
 * Раунд 75 - несколько входов. Раунд 76 - режимы invert/erase, LIST-выход.
 *
 * ВИД: настоящая сетка месяца (как обычный календарь), с навигацией
 * ◀ Месяц Год ▶. Разметка мышью, две кнопки-режима под рядами входов:
 *   - 🔁 "Добавление с инверсией" (по умолчанию) - клик по неотмеченному
 *     дню добавляет его как `{type:'single'}`; клик по уже отмеченному -
 *     снимает отметку. Протяжка - то же самое, но диапазоном:
 *     `{type:'range', date, dateTo}` ОДНОЙ записью по отпусканию кнопки
 *     мыши, не россыпью отдельных дней - "календарь диапазонов", как в
 *     transitions/days примера calendar_2026.json.
 *   - 🧹 "Ластик" - стирает ЛЮБУЮ отметку, в т.ч. пришедшую со входа
 *     (см. this.excludedDates ниже - для чужих дат, которые нельзя
 *     удалить из entries, потому что они не оттуда). Попадание на день
 *     ВНУТРИ диапазона удаляет ВЕСЬ диапазон целиком (не режет на
 *     части) - прямой запрос Mr.D.
 *
 * ВХОДНЫЕ СОКЕТЫ (index 0..N, `any`, несколько одновременно - Раунд 75,
 * тот же паттерн авто-роста слотов, что у OperationNode) -
 * "Календарные данные": все необязательные. Каждый подключённый источник,
 * который понимает `HolidayParser` (CalendarNode с чужим набором,
 * JsonImportNode с производственным календарём), подмешивает свои даты к
 * вручную отмеченным (показаны в сетке отдельным оттенком - "из
 * источника"). Источник, который НЕ распознан - его имя уходит в текст
 * красного бейджа с ошибкой ("если он их распознает - всё ок, если нет -
 * выдаёт ошибку", прямая формулировка Mr.D).
 *
 * this.excludedDates (Set ISO-дат) - даты, стёртые Ластиком, даже если
 * они пришли со входа: физически удалить их из ЧУЖИХ entries нельзя,
 * поэтому они просто вычитаются из итогового набора при сборке (см.
 * _recalcDates()). Явная повторная разметка (режим 🔁) снимает дату с
 * этого списка.
 *
 * Выход (index 0, LIST - по запросу Mr.D, раньше был `any`) -
 * `this.listData` (по одному элементу на дату). Плюс `this.holidayDates`
 * (тот же набор плоским массивом ISO-строк) - тот же контракт, что и
 * раньше, читается `HolidayParser` напрямую независимо от типа сокета.
 */
export class CalendarNode extends BaseNode {
    constructor(id, type, x, y, config = {}) {
        super(id, type, x, y, config);
        this.outputs = 1;
        // Раунд 75 - несколько источников календарных данных одновременно
        // (по запросу Mr.D: "подключать несколько календарей или json") -
        // тот же паттерн авто-роста слотов, что у OperationNode (см. её
        // докстринг про checkAndAddEmptySlot()/rerender() - раздел 9
        // docs/NODE_API.md), не переизобретаем.
        this.maxInputs = 8;
        this.inputs = config.inputs || 1;
        this.inputSockets = Array.from({ length: this.inputs }, (_, i) => i);
        this._isRerendering = false;
        this.width = config.width || 240;

        // entry: { id, type: 'single'|'range', date, dateTo }
        this.entries = Array.isArray(config.entries)
            ? config.entries.map(e => ({
                id: Helpers.generateId(),
                type: e.type === 'range' ? 'range' : 'single',
                date: e.date || '',
                dateTo: e.dateTo || ''
            }))
            : [];

        const today = new Date();
        this.viewYear = config.viewYear ?? today.getFullYear();
        this.viewMonth = config.viewMonth ?? (today.getMonth() + 1); // 1-12

        // Раунд 76 - режим выделения мышью (кнопки под шапкой, см.
        // createContent()) - по итогам живой проверки Mr.D режим 'add'
        // убран, вместо него 'erase' (ластик):
        //   'invert' (по умолчанию) - клик/протяжка по НЕотмеченным датам
        //            добавляет их, по УЖЕ отмеченным - снимает отметку.
        //   'erase'  - клик/протяжка СТИРАЕТ любую отметку, включая ту,
        //            что пришла со входа (см. this.excludedDates ниже) -
        //            попадание на день внутри диапазона удаляет ВЕСЬ
        //            диапазон целиком, не режет его на части.
        this.selectionMode = config.selectionMode === 'erase' ? 'erase' : 'invert';

        // Даты, явно стёртые ластиком, даже если они пришли со входа
        // (не принадлежат entries этой ноды - удалить их оттуда физически
        // нельзя, это чужие данные) - вычитаются из итогового набора при
        // сборке (см. _recalcDates()). Явная повторная разметка (режим
        // 'invert') снимает дату из этого списка - см. _commitDrag().
        this.excludedDates = new Set(Array.isArray(config.excludedDates) ? config.excludedDates : []);

        this.holidayDates = [];       // (entries + все входы) минус excludedDates - то, что видит потребитель
        this._ownDates = new Set();   // только entries этой ноды (для распознавания кликов)
        this._inputDates = new Set(); // объединение ВСЕХ подключённых входов
        this._inputStatuses = [];     // [{socketIndex, sourceName, recognized, count}] - по каждому подключённому входу, для меток/бейджей
        this.listData = new ListData();
        this.tableData = new TableData();
        this._truncated = false;

        this._drag = null; // { startISO, mode: 'mark'|'unmark' } - во время протяжки мышью

        this._recalcDates();
    }

    // Разворачивает entries в плоский набор дат этой ноды. Отдельно от
    // объединения с входом (см. calculate() - вход появляется только
    // там, конструктору источники графа ещё недоступны).
    _recalcOwnDates() {
        const set = new Set();
        let truncated = false;

        for (const entry of this.entries) {
            if (truncated) break;
            if (entry.type === 'single') {
                if (entry.date) set.add(entry.date);
            } else {
                if (!entry.date || !entry.dateTo) continue;
                let from = parseISO(entry.date);
                let to = parseISO(entry.dateTo);
                if (!from || !to) continue;
                if (from > to) { const tmp = from; from = to; to = tmp; }
                const cursor = new Date(from.getTime());
                while (cursor <= to) {
                    if (set.size >= MAX_DATES) { truncated = true; break; }
                    set.add(formatISO(cursor));
                    cursor.setDate(cursor.getDate() + 1);
                }
            }
        }

        this._truncated = truncated;
        this._ownDates = set;
    }

    // Пересобирает итоговый holidayDates/listData/tableData из
    // объединения _ownDates (entries) и _inputDates (вход, если
    // подключён и распознан) - вызывается и из конструктора (до первого
    // calculateAll(), вход тогда всегда пуст), и из calculate().
    _recalcDates() {
        this._recalcOwnDates();
        const merged = new Set([...this._ownDates, ...this._inputDates]);
        this.excludedDates.forEach(d => merged.delete(d));
        this.holidayDates = [...merged].sort();

        const items = this.holidayDates.map(iso => ({ name: iso, value: 1 }));
        this.listData = new ListData(items, { title: this.customName || this.getDisplayName() });
        this.tableData = new TableData([
            { header: 'Дата', format: 'text', values: this.holidayDates }
        ], { title: this.customName || this.getDisplayName() });
    }

    calculate(nodeManager) {
        this.checkAndAddEmptySlot();

        const connections = window.connectionManager?.getConnections() || [];
        const merged = new Set();
        const statuses = [];
        const unrecognizedNames = [];

        this.inputSockets.forEach(socketIndex => {
            const conn = connections.find(c => c.targetNodeId === this.id && c.targetSocket === socketIndex);
            if (!conn) {
                statuses.push({ socketIndex, sourceName: null, recognized: false, count: 0 });
                return;
            }
            const src = nodeManager.getNode(conn.sourceNodeId);
            const sourceName = src ? (src.customName || src.getDisplayName?.() || 'источник') : null;
            const recognized = !!(src && (Array.isArray(src.holidayDates) ||
                (typeof src.jsonText === 'string' && src.jsonText.trim() && this._looksParsable(src.jsonText))));

            if (recognized) {
                const dates = HolidayParser.extract(src);
                dates.forEach(d => merged.add(d));
                statuses.push({ socketIndex, sourceName, recognized: true, count: dates.size });
            } else {
                statuses.push({ socketIndex, sourceName, recognized: false, count: 0 });
                if (sourceName) unrecognizedNames.push(sourceName);
            }
        });

        this._inputStatuses = statuses;
        this._inputDates = merged;

        if (unrecognizedNames.length > 0) {
            this.addBadge('calendar-input-unrecognized', {
                type: 'error',
                text: unrecognizedNames.length === 1
                    ? `Источник «${unrecognizedNames[0]}» не распознан как календарь`
                    : `${unrecognizedNames.length} источников не распознаны как календарь`
            });
        } else {
            this.clearBadge('calendar-input-unrecognized');
        }

        this._recalcDates();
        this.value = this.holidayDates.length;

        if (this._truncated) {
            this.addBadge('calendar-truncated', { type: 'warning', text: `Диапазон слишком большой, обрезано на ${MAX_DATES} датах` });
        } else {
            this.clearBadge('calendar-truncated');
        }

        return this.value;
    }

    isSocketConnected(index) {
        const connections = window.connectionManager?.getConnections() || [];
        return connections.some(c => c.targetNodeId === this.id && c.targetSocket === index);
    }

    // Тот же принцип, что у OperationNode (см. её докстринг) - свободный
    // слот всегда один "про запас"; когда его подключают, следующий
    // calculate() добавляет ещё один. Слоты никогда не убираются
    // автоматически при отключении - только рукам через удаление ноды.
    checkAndAddEmptySlot() {
        if (this.collapsed) return;
        if (this.inputSockets.length >= this.maxInputs) return;

        const connections = window.connectionManager?.getConnections() || [];
        const usedSockets = connections.filter(c => c.targetNodeId === this.id).map(c => c.targetSocket);
        const freeSockets = this.inputSockets.filter(idx => !usedSockets.includes(idx));

        if (freeSockets.length === 0) {
            const newIndex = this.inputSockets.length;
            this.inputSockets.push(newIndex);
            this.inputs = this.inputSockets.length;
            setTimeout(() => {
                if (!this._isRerendering && !this.collapsed) this.rerender();
            }, 50);
        }
    }

    // См. OperationNode.rerender() - тот же приём (убрать старый DOM-узел,
    // отрендерить заново на тех же координатах, перерисовать связи)
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

    _looksParsable(jsonText) {
        try {
            const data = JSON.parse(jsonText);
            return !!(data && typeof data.year === 'number' && Array.isArray(data.months));
        } catch (e) {
            return false;
        }
    }

    createContent() {
        const content = document.createElement('div');
        content.className = 'node-content';
        content.style.cssText = 'width:100%; min-width:216px; display:flex; flex-direction:column; gap:4px;';

        // === Входы (динамически, Раунд 75) - один ряд на сокет, плюс
        // свободный "про запас" (см. checkAndAddEmptySlot()) ===
        const inputsWrap = document.createElement('div');
        inputsWrap.className = 'calendar-inputs-wrap';
        inputsWrap.style.cssText = 'display:flex; flex-direction:column; gap:2px;';
        this.inputSockets.forEach(socketIndex => {
            const inRow = document.createElement('div');
            inRow.className = 'calendar-input-row';
            inRow.style.cssText = 'display:flex; align-items:center; gap:6px;';
            const inSocket = SocketFactory.createSocket({
                nodeId: this.id, socketType: 'input', index: socketIndex, isAny: true,
                title: 'Календарные данные (необязательно) - CalendarNode или Импорт JSON с производственным календарём'
            });
            inRow.appendChild(inSocket);
            const inLabel = document.createElement('span');
            inLabel.className = 'calendar-input-label';
            inLabel.dataset.socketIndex = String(socketIndex);
            inLabel.style.cssText = 'color:var(--md-text-disabled); font-size:10px; flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;';
            inLabel.textContent = this._inputStatusText(socketIndex);
            inRow.appendChild(inLabel);
            inputsWrap.appendChild(inRow);
        });
        content.appendChild(inputsWrap);

        // === Режим выделения (Раунд 75) - маленькие символьные кнопки с
        // подсказкой, сразу под рядами входов ===
        const modeRow = document.createElement('div');
        modeRow.className = 'calendar-mode-row';
        modeRow.style.cssText = 'display:flex; align-items:center; gap:4px; justify-content:flex-end;';

        const modeLabel = document.createElement('span');
        modeLabel.textContent = 'Режим:';
        modeLabel.style.cssText = 'color:var(--md-text-disabled); font-size:9px; margin-right:auto;';
        modeRow.appendChild(modeLabel);

        const invertBtn = document.createElement('button');
        invertBtn.className = 'calendar-mode-btn';
        invertBtn.dataset.mode = 'invert';
        invertBtn.textContent = '🔁';
        invertBtn.title = 'Добавление с инверсией - клик/протяжка по неотмеченным датам добавляет их, по уже отмеченным - снимает отметку';
        invertBtn.classList.toggle('active', this.selectionMode === 'invert');
        invertBtn.addEventListener('mousedown', (e) => e.stopPropagation());
        invertBtn.addEventListener('click', (e) => { e.stopPropagation(); this._setSelectionMode('invert'); });
        modeRow.appendChild(invertBtn);

        const eraseBtn = document.createElement('button');
        eraseBtn.className = 'calendar-mode-btn';
        eraseBtn.dataset.mode = 'erase';
        eraseBtn.textContent = '🧹';
        eraseBtn.title = 'Ластик - стирает ЛЮБУЮ отметку, включая пришедшую со входа; попадание на день внутри диапазона удаляет весь диапазон целиком';
        eraseBtn.classList.toggle('active', this.selectionMode === 'erase');
        eraseBtn.addEventListener('mousedown', (e) => e.stopPropagation());
        eraseBtn.addEventListener('click', (e) => { e.stopPropagation(); this._setSelectionMode('erase'); });
        modeRow.appendChild(eraseBtn);

        content.appendChild(modeRow);

        const gridSlot = document.createElement('div');
        gridSlot.className = 'calendar-grid-slot';
        gridSlot.appendChild(this.buildCalendarGrid());
        content.appendChild(gridSlot);

        const outputRow = document.createElement('div');
        outputRow.style.cssText = `
            display: flex;
            align-items: center;
            gap: 8px;
            padding-top: 6px;
            margin-top: 2px;
            border-top: 1px solid var(--md-divider);
        `;
        const outputLabel = document.createElement('label');
        outputLabel.className = 'calendar-output-count';
        outputLabel.textContent = `${this.holidayDates.length} дат`;
        outputLabel.style.cssText = 'color:var(--md-text-secondary); font-size:11px; flex:1;';
        outputRow.appendChild(outputLabel);
        const outputSocket = SocketFactory.createSocket({
            nodeId: this.id, socketType: 'output', index: 0, isList: true,
            title: 'Набор дат - подключается к сокету "Праздники" у Диаграммы Ганта или куда угодно ещё'
        });
        outputRow.appendChild(outputSocket);
        content.appendChild(outputRow);

        return content;
    }

    _setSelectionMode(mode) {
        this.selectionMode = mode;
        const el = document.querySelector(`[data-node-id="${this.id}"]`);
        if (!el) return;
        el.querySelectorAll('.calendar-mode-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.mode === mode);
        });
    }

    _inputStatusText(socketIndex) {
        const status = this._inputStatuses.find(s => s.socketIndex === socketIndex);
        if (!status || !status.sourceName) return 'не подключено';
        if (!status.recognized) return `${status.sourceName} — не распознан`;
        return `${status.sourceName} — ${status.count} дат`;
    }

    // Строит сетку месяца целиком заново (навигация/разметка не трогают
    // остальной DOM ноды) - тот же приём, что у GanttNode.createGanttArea()/
    // updateDisplay() (slot.innerHTML='' + пересборка).
    buildCalendarGrid() {
        const wrap = document.createElement('div');
        wrap.className = 'calendar-grid-wrap';

        // --- навигация ---
        const nav = document.createElement('div');
        nav.className = 'calendar-nav-row';
        const prevBtn = document.createElement('button');
        prevBtn.className = 'calendar-nav-btn';
        prevBtn.textContent = '◀';
        prevBtn.addEventListener('mousedown', (e) => e.stopPropagation());
        prevBtn.addEventListener('click', (e) => { e.stopPropagation(); this._shiftMonth(-1); });
        nav.appendChild(prevBtn);

        const title = document.createElement('span');
        title.className = 'calendar-nav-title';
        title.textContent = `${MONTH_LABELS[this.viewMonth - 1]} ${this.viewYear}`;
        nav.appendChild(title);

        const nextBtn = document.createElement('button');
        nextBtn.className = 'calendar-nav-btn';
        nextBtn.textContent = '▶';
        nextBtn.addEventListener('mousedown', (e) => e.stopPropagation());
        nextBtn.addEventListener('click', (e) => { e.stopPropagation(); this._shiftMonth(1); });
        nav.appendChild(nextBtn);
        wrap.appendChild(nav);

        // --- шапка дней недели ---
        const weekHead = document.createElement('div');
        weekHead.className = 'calendar-week-row calendar-week-head';
        WEEKDAY_LABELS.forEach(lbl => {
            const cell = document.createElement('div');
            cell.className = 'calendar-weekday-label';
            cell.textContent = lbl;
            weekHead.appendChild(cell);
        });
        wrap.appendChild(weekHead);

        // --- сетка дней (6 недель, с хвостами соседних месяцев блёкло) ---
        const firstOfMonth = new Date(this.viewYear, this.viewMonth - 1, 1);
        const mondayOffset = (firstOfMonth.getDay() + 6) % 7; // 0=пн
        const gridStart = new Date(firstOfMonth.getTime());
        gridStart.setDate(gridStart.getDate() - mondayOffset);

        const grid = document.createElement('div');
        grid.className = 'calendar-days-grid';

        for (let week = 0; week < 6; week++) {
            for (let dow = 0; dow < 7; dow++) {
                const date = new Date(gridStart.getTime());
                date.setDate(date.getDate() + week * 7 + dow);
                const iso = formatISO(date);
                const inCurrentMonth = date.getMonth() === this.viewMonth - 1;

                const cell = document.createElement('div');
                cell.className = 'calendar-day-cell';
                cell.dataset.date = iso;
                if (!inCurrentMonth) cell.classList.add('calendar-day-outside');
                if (dow >= 5) cell.classList.add('calendar-day-weekend');

                const excluded = this.excludedDates.has(iso);
                const isOwn = this._ownDates.has(iso) && !excluded;
                const isFromInput = this._inputDates.has(iso) && !isOwn && !excluded;
                if (isOwn) cell.classList.add('calendar-day-marked');
                if (isFromInput) cell.classList.add('calendar-day-from-input');

                cell.textContent = String(date.getDate());
                this._attachDayHandlers(cell, iso);
                grid.appendChild(cell);
            }
        }
        wrap.appendChild(grid);

        return wrap;
    }

    _shiftMonth(delta) {
        let m = this.viewMonth + delta;
        let y = this.viewYear;
        while (m < 1) { m += 12; y -= 1; }
        while (m > 12) { m -= 12; y += 1; }
        this.viewMonth = m;
        this.viewYear = y;
        this._rebuildGrid();
    }

    _rebuildGrid() {
        const el = document.querySelector(`[data-node-id="${this.id}"] .calendar-grid-slot`);
        if (!el) return;
        el.innerHTML = '';
        el.appendChild(this.buildCalendarGrid());
    }

    // Клик = переключить один день. Протяжка (mousedown -> mousemove по
    // ячейкам -> mouseup) = один диапазон целиком. Направление протяжки
    // (вперёд/назад по календарю) не важно - при фиксации date/dateTo
    // нормализуются по возрастанию. Режим (this.selectionMode, кнопки
    // под шапкой, Раунд 76) определяет, что делает mousedown:
    //   'invert' - 'unmark', если ячейка уже отмечена (this._ownDates),
    //              иначе 'mark'.
    //   'erase'  - ВСЕГДА 'unmark' (ластик, независимо от состояния
    //              ячейки - см. _commitDrag про то, как именно стирается)
    _attachDayHandlers(cell, iso) {
        cell.addEventListener('mousedown', (e) => {
            e.stopPropagation();
            e.preventDefault();
            // Багфикс: raw _inputDates.has(iso) остаётся true даже после
            // стирания Ластиком (стирание не удаляет дату ИЗ _inputDates -
            // источник её всё ещё присылает, просто она гасится через
            // excludedDates при сборке итогового набора, см. _recalcDates()).
            // Без учёта excludedDates здесь клик по стёртой дате видел
            // "уже отмечена" (raw _inputDates=true) и выбирал mode='unmark' -
            // а дата и так уже не отмечена визуально, ничего не менялось,
            // перезаписать её было невозможно. Теперь "видимо отмечена"
            // считается по ТОЙ ЖЕ формуле, что красит ячейку в
            // buildCalendarGrid() (см. там же).
            const excluded = this.excludedDates.has(iso);
            const alreadyMarked = (this._ownDates.has(iso) || this._inputDates.has(iso)) && !excluded;
            const mode = this.selectionMode === 'erase' ? 'unmark' : (alreadyMarked ? 'unmark' : 'mark');
            this._drag = { startISO: iso, mode };
            this._paintDragPreview(iso, iso);

            const onMove = (moveEvt) => {
                const overCell = document.elementFromPoint(moveEvt.clientX, moveEvt.clientY);
                const overDate = overCell?.closest?.('.calendar-day-cell')?.dataset?.date;
                if (overDate) this._paintDragPreview(this._drag.startISO, overDate);
            };
            const onUp = (upEvt) => {
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
                const overCell = document.elementFromPoint(upEvt.clientX, upEvt.clientY);
                const endISO = overCell?.closest?.('.calendar-day-cell')?.dataset?.date || this._drag.startISO;
                this._commitDrag(this._drag.startISO, endISO, this._drag.mode);
                this._drag = null;
            };
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        });
    }

    // Подсветка диапазона ПРЯМО В DOM во время протяжки, без пересчёта
    // графа - только визуальный предпросмотр, this.entries не трогаем,
    // пока кнопка мыши не отпущена (см. _commitDrag)
    _paintDragPreview(fromISO, toISO) {
        const grid = document.querySelector(`[data-node-id="${this.id}"] .calendar-days-grid`);
        if (!grid) return;
        let [a, b] = [fromISO, toISO].sort();
        const eraseClass = this.selectionMode === 'erase';
        grid.querySelectorAll('.calendar-day-cell').forEach(cell => {
            const d = cell.dataset.date;
            const inRange = d >= a && d <= b;
            cell.classList.toggle('calendar-day-drag-preview', inRange && !eraseClass);
            cell.classList.toggle('calendar-day-drag-preview-erase', inRange && eraseClass);
        });
    }

    // Удаляет из entries ЛЮБУЮ запись, чей диапазон ХОТЯ БЫ ЧАСТИЧНО
    // пересекается с [from, to] - попадание на день внутри чужого
    // диапазона стирает диапазон ЦЕЛИКОМ, а не режет его на части (по
    // прямому запросу Mr.D: "удалит протяженность если попал на день,
    // где был диапазон").
    _removeIntersectingEntries(from, to) {
        this.entries = this.entries.filter(e => {
            const eFrom = e.date;
            const eTo = e.type === 'range' ? e.dateTo : e.date;
            const intersects = eFrom <= to && eTo >= from;
            return !intersects;
        });
    }

    _commitDrag(startISO, endISO, mode) {
        const grid = document.querySelector(`[data-node-id="${this.id}"] .calendar-days-grid`);
        if (grid) grid.querySelectorAll('.calendar-day-drag-preview, .calendar-day-drag-preview-erase').forEach(c => c.classList.remove('calendar-day-drag-preview', 'calendar-day-drag-preview-erase'));

        const [from, to] = [startISO, endISO].sort();

        if (mode === 'unmark') {
            // И "снять отметку" (invert по уже своей дате), И "ластик"
            // (erase, в т.ч. по чужой дате со входа) заходят сюда -
            // разница только в том, что ластик мог попасть на дату,
            // которой у entries вообще нет (только вход) - на этот
            // случай и нужен excludedDates (см. докстринг конструктора).
            this._removeIntersectingEntries(from, to);
            if (this.selectionMode === 'erase') {
                // добавляем ВСЕ дни протянутого диапазона в исключения -
                // гасит и то, что пришло со входа, а не только entries
                const cursor = parseISO(from);
                const toDate = parseISO(to);
                if (cursor && toDate) {
                    while (cursor <= toDate) {
                        this.excludedDates.add(formatISO(cursor));
                        cursor.setDate(cursor.getDate() + 1);
                    }
                }
            }
        } else if (startISO === endISO) {
            // одиночный клик, режим 'invert', день ещё не отмечен -
            // добавляем ОДНУ дату; снимаем её же с excludedDates (если
            // раньше уже стирали ластиком - явная разметка отменяет это)
            this.entries.push({ id: Helpers.generateId(), type: 'single', date: startISO, dateTo: '' });
            this.excludedDates.delete(startISO);
        } else {
            // протяжка, режим 'invert', диапазон ещё не отмечен целиком -
            // добавляем ОДИН range, снимаем весь диапазон с excludedDates
            this.entries.push({ id: Helpers.generateId(), type: 'range', date: from, dateTo: to });
            const cursor = parseISO(from);
            const toDate = parseISO(to);
            if (cursor && toDate) {
                while (cursor <= toDate) {
                    this.excludedDates.delete(formatISO(cursor));
                    cursor.setDate(cursor.getDate() + 1);
                }
            }
        }

        this._recalcFromEntries();
    }

    // Тот же принцип, что _recalculateFromItems() у ListConvertNode -
    // пересчитать граф И перерисовать связи (высота ноды не меняется у
    // календаря, но источники/потребители могут отреагировать на новые
    // даты), см. её докстринг про багфикс 1.6.1.
    _recalcFromEntries() {
        this._recalcDates();
        if (window.nodeManager) window.nodeManager.calculateAll();
        if (window.renderer) {
            window.renderer.drawAllConnections(window.connectionManager?.getConnections() || []);
        }
        this._rebuildGrid();
    }

    updateDisplay(element) {
        const count = element.querySelector('.calendar-output-count');
        if (count) count.textContent = `${this.holidayDates.length} дат`;

        element.querySelectorAll('.calendar-input-label').forEach(label => {
            const idx = Number(label.dataset.socketIndex);
            label.textContent = this._inputStatusText(idx);
        });

        const slot = element.querySelector('.calendar-grid-slot');
        if (slot) {
            slot.innerHTML = '';
            slot.appendChild(this.buildCalendarGrid());
        }
    }
}
