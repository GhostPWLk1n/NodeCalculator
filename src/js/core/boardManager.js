/**
 * SPDX-License-Identifier: MIT
 * SPDX-FileCopyrightText: 2024 NodeCalculate Team
 * SPDX-FileCopyrightText: 2024 Pavel Fomin
 *
 * @file    boardManager.js
 * @brief   Доски (вкладки) для визуализации расчётных данных - виджеты от нод "Дашборд"
 * @author  Pavel Fomin
 * @version 1.4.0
 * @see     https://github.com/GhostPWLk1n/NodeCalculator.git
 */

/**
 * BoardManager - Доски визуализации, параллельно Листам (LayoutManager),
 * но принципиально другой холст: не граф нод, а вертикальный поток
 * виджетов в формате страницы (готовится под экспорт в PDF).
 *
 * Доска НЕ хранит собственный граф вычислений - она хранит только
 * ССЫЛКИ на виджеты, которые ей назначили ноды "Дашборд" (DashboardNode,
 * см. dashboardNode.js), живущие на обычных Листах. Одна нода "Дашборд" =
 * один виджет. Порядок виджетов на странице задаёт поле dashboardOrder
 * самой ноды.
 *
 * Виджеты НЕ сериализуются - это производное состояние (пересобирается
 * из DashboardNode.calculate() при каждом пересчёте графа, в том числе
 * сразу после загрузки проекта). Сериализуются только сами доски
 * (id/имя) - см. serialize()/loadFromData().
 */
export class BoardManager {
    constructor() {
        this.boards = [];
        this.boardIdCounter = 0;
        this.activeBoardId = null;
    }

    // ============================================
    // СОЗДАНИЕ / ПОЛУЧЕНИЕ ДОСОК
    // ============================================

    generateUniqueName() {
        let n = 1;
        while (this.boards.some(b => b.name === `Доска ${n}`)) n++;
        return `Доска ${n}`;
    }

    createBoard(name) {
        const id = this.boardIdCounter++;
        const board = {
            id,
            name: name || this.generateUniqueName(),
            // widgetId (= id ноды "Дашборд") -> { order, type, title, render(container) }
            widgets: new Map()
        };
        this.boards.push(board);
        return board;
    }

    initFirstBoard(name = 'Доска 1') {
        const board = this.createBoard(name);
        this.activeBoardId = board.id;
        this.renderTabs();
        this.renderActiveBoard();
        return board;
    }

    getBoard(id) {
        return this.boards.find(b => b.id === id);
    }

    getActiveBoard() {
        return this.getBoard(this.activeBoardId);
    }

    getAllBoards() {
        return this.boards;
    }

    // ============================================
    // ПЕРЕКЛЮЧЕНИЕ / СОЗДАНИЕ / УДАЛЕНИЕ / ПЕРЕИМЕНОВАНИЕ
    // ============================================

    switchToBoard(id) {
        if (id === this.activeBoardId) return;
        this.activeBoardId = id;
        this.showBoardView();
        this.renderTabs();
        this.renderActiveBoard();
    }

    addBoard() {
        const board = this.createBoard();
        this.switchToBoard(board.id);
        return board;
    }

    deleteBoard(id) {
        if (this.boards.length <= 1) return; // нельзя удалить последнюю доску
        const idx = this.boards.findIndex(b => b.id === id);
        if (idx === -1) return;

        this.boards.splice(idx, 1);

        if (this.activeBoardId === id) {
            const next = this.boards[Math.max(0, idx - 1)];
            this.activeBoardId = next.id;
        }
        this.renderTabs();
        this.renderActiveBoard();
    }

    renameBoard(id, newName) {
        const board = this.getBoard(id);
        if (!board || !newName || !newName.trim()) return;
        board.name = newName.trim();
        this.renderTabs();
    }

    // Показать холст Доски вместо графа нод (и наоборот - см.
    // layoutManager.loadLayout(), которая вызывает обратный переключатель)
    showBoardView() {
        const workspace = document.getElementById('workspace');
        const boardCanvas = document.getElementById('boardCanvasWrap');
        if (workspace) workspace.style.display = 'none';
        if (boardCanvas) boardCanvas.style.display = 'flex';
    }

    // ============================================
    // ВИДЖЕТЫ (назначаются нодами "Дашборд", см. dashboardNode.js)
    // ============================================

    // Регистрирует/обновляет виджет на конкретной Доске. Сначала снимает
    // этот же widgetId со ВСЕХ досок - если нода "Дашборд" сменила
    // targetBoardId, виджет не должен остаться дублем на старой доске.
    registerWidget(boardId, widgetId, data) {
        this.unregisterWidgetEverywhere(widgetId, false);
        const board = this.getBoard(boardId);
        if (!board) return;
        board.widgets.set(widgetId, data);
        if (boardId === this.activeBoardId) this.renderActiveBoard();
    }

    unregisterWidgetEverywhere(widgetId, rerender = true) {
        let touched = false;
        this.boards.forEach(board => {
            if (board.widgets.delete(widgetId)) touched = true;
        });
        if (touched && rerender) this.renderActiveBoard();
    }

    // ============================================
    // РЕНДЕР ВКЛАДОК (зеркало LayoutManager.renderTabs)
    // ============================================

    renderTabs() {
        const tabsContainer = document.getElementById('boardTabs');
        if (!tabsContainer) return;
        tabsContainer.innerHTML = '';

        this.boards.forEach(board => {
            const tab = document.createElement('div');
            tab.className = 'layout-tab' + (board.id === this.activeBoardId ? ' active' : '');
            tab.dataset.boardId = board.id;

            const label = document.createElement('span');
            label.className = 'layout-tab-name';
            label.textContent = board.name;
            tab.appendChild(label);

            const closeBtn = document.createElement('span');
            closeBtn.className = 'layout-tab-close';
            closeBtn.textContent = '✕';
            closeBtn.title = 'Удалить доску';
            closeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.deleteBoard(board.id);
            });
            tab.appendChild(closeBtn);

            tab.addEventListener('click', () => this.switchToBoard(board.id));

            tab.addEventListener('dblclick', (e) => {
                e.stopPropagation();
                if (board.id !== this.activeBoardId) return;
                this.startRenameTab(board, tab, label);
            });

            tabsContainer.appendChild(tab);
        });

        this._appendAddButton(tabsContainer);
    }

    startRenameTab(board, tab, label) {
        if (tab.querySelector('input')) return;

        const input = document.createElement('input');
        input.type = 'text';
        input.value = board.name;
        input.className = 'layout-tab-rename-input';
        input.addEventListener('mousedown', (e) => e.stopPropagation());
        input.addEventListener('click', (e) => e.stopPropagation());

        label.style.display = 'none';
        tab.insertBefore(input, label);
        input.focus();
        input.select();

        const finish = (save) => {
            if (save && input.value.trim()) {
                this.renameBoard(board.id, input.value.trim());
            } else {
                input.remove();
                label.style.display = '';
            }
        };

        input.addEventListener('blur', () => finish(true));
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
            if (e.key === 'Escape') { e.preventDefault(); finish(false); }
        });
    }

    _appendAddButton(tabsContainer) {
        const addBtn = document.createElement('div');
        addBtn.className = 'layout-tab-add';
        addBtn.textContent = '+';
        addBtn.title = 'Добавить доску';
        addBtn.addEventListener('click', () => this.addBoard());
        tabsContainer.appendChild(addBtn);
    }

    // ============================================
    // РЕНДЕР ХОЛСТА (страница, вертикальный поток виджетов)
    // ============================================

    renderActiveBoard() {
        const container = document.getElementById('boardCanvas');
        if (!container) return;
        container.innerHTML = '';

        const board = this.getActiveBoard();
        if (!board) return;

        const page = document.createElement('div');
        page.className = 'board-page';

        const widgets = [...board.widgets.entries()]
            .map(([id, w]) => ({ id, ...w }))
            .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.id - b.id);

        if (widgets.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'board-empty';
            empty.textContent = 'На этой доске пока нет виджетов - подключите ноду "Дашборд" к источнику данных на любом Листе и выберите эту доску в её панели настроек';
            page.appendChild(empty);
        } else {
            widgets.forEach(w => page.appendChild(this.buildWidgetEl(w)));
        }

        container.appendChild(page);
    }

    buildWidgetEl(widget) {
        const widgetEl = document.createElement('div');
        widgetEl.className = 'board-widget';
        widgetEl.dataset.widgetId = widget.id;

        if (widget.title) {
            const titleEl = document.createElement('div');
            titleEl.className = 'board-widget-title';
            titleEl.textContent = widget.title;
            widgetEl.appendChild(titleEl);
        }

        const bodyEl = document.createElement('div');
        bodyEl.className = 'board-widget-body';
        if (typeof widget.render === 'function') {
            widget.render(bodyEl);
        }
        widgetEl.appendChild(bodyEl);

        return widgetEl;
    }

    // ============================================
    // СЕРИАЛИЗАЦИЯ - только сами доски (id/имя), НЕ виджеты (см. докстринг класса)
    // ============================================

    serialize() {
        return {
            activeBoardId: this.activeBoardId,
            boardIdCounter: this.boardIdCounter,
            boards: this.boards.map(b => ({ id: b.id, name: b.name }))
        };
    }

    loadFromData(data) {
        const boardsData = data?.boards;
        if (!Array.isArray(boardsData) || boardsData.length === 0) {
            // Старый проект без Досок или пустые данные - создаём одну
            // дефолтную, чтобы у нод "Дашборд" сразу было куда указывать
            this.boards = [];
            this.boardIdCounter = 0;
            this.initFirstBoard('Доска 1');
            return;
        }

        this.boards = boardsData.map(b => ({ id: b.id, name: b.name, widgets: new Map() }));
        this.boardIdCounter = data.boardIdCounter ?? (Math.max(...this.boards.map(b => b.id)) + 1);
        this.activeBoardId = this.boards.some(b => b.id === data.activeBoardId)
            ? data.activeBoardId
            : this.boards[0].id;

        this.renderTabs();
        this.renderActiveBoard();
    }
}
