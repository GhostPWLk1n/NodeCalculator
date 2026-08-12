/**
 * SPDX-License-Identifier: MIT
 * SPDX-FileCopyrightText: 2024 NodeCalculate Team
 * SPDX-FileCopyrightText: 2024 Pavel Fomin
 *
 * @file    boardManager.js
 * @brief   Доски (вкладки) для визуализации расчётных данных - виджеты от нод "Дашборд"
 * @author  Pavel Fomin
 * @version 1.8.62
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
/**
 * Условная сетка страницы Доски (см. Раунд 32 в CHANGES.md) - 12 колонок
 * (как в большинстве dashboard-конструкторов, Bootstrap/Looker Studio),
 * фиксированная высота ряда ROW_PX. GRID_GAP синхронизирован с CSS
 * (.board-page { gap }) - оба места нужно менять вместе, если захочется
 * поменять зазор между виджетами.
 */
const GRID_COLS = 12;
const ROW_PX = 24;
const GRID_GAP = 16;
const MIN_ROW_SPAN = 2;

function clamp(v, min, max) {
    return Math.min(max, Math.max(min, v));
}

export class BoardManager {
    constructor() {
        this.boards = [];
        this.boardIdCounter = 0;
        this.activeBoardId = null;

        // id виджета (= id ноды "Дашборд"), выбранного кликом на Доске -
        // открывает боковую панель для редактирования стиля виджета
        // (цвет/размер/выравнивание), см. selectWidget()/deselectWidget()
        // и DashboardNode.getInspectorSchema()
        this.selectedWidgetId = null;

        // Флаг "сейчас на экране показана Доска (а не граф нод)" - см.
        // подробное объяснение у layoutManager.viewActive, это его
        // зеркало. По умолчанию false: при старте приложения виден граф
        // нод (layoutManager.initFirstLayout выставляет свой флаг сам),
        // initFirstBoard() ниже сознательно НЕ трогает этот флаг.
        this.viewActive = false;

        // Раунд 162 (по запросу Mr.D: "добавим ещё одну кнопку - Режим
        // редактирования. Без включённого режима редактирования мы
        // можем только менять содержимое виджетов, не можем
        // переставлять виджеты, менять их положение, рамка на активном
        // виджете не появляется") - глобальный флаг (не за каждой
        // Доской отдельно - переключение уровня "сейчас я расставляю
        // макет" vs "сейчас я просто работаю с данными", один на всё
        // приложение сразу, как и сам режим просмотра Досок).
        // По умолчанию ВЫКЛЮЧЕН - безопаснее для повседневной работы
        // (случайно не сдвинуть виджет мышью, читая данные) - явно
        // включается кнопкой в тулбаре, когда нужно перестроить макет.
        this.editMode = false;

        // Раунд 166 (диагностика бага зависания, зарезервированного в
        // Раунде 164: "изменение данных в виджете Диаграммы Ганта
        // иногда вызывает зависание задачи, помогает перейти на Лист и
        // обратно") - НАЙДЕНА вероятная причина: renderActiveBoard()
        // (см. ниже) сохраняет уже существующий DOM-узел виджета ТОЛЬКО
        // для того, что сейчас в ФОКУСЕ ВВОДА (document.activeElement) -
        // это защищает живое редактирование текстового поля, но НЕ
        // защищает АКТИВНОЕ ПЕРЕТАСКИВАНИЕ МЫШЬЮ (drag полосы задачи/
        // ручки изменения размера/связи между задачами и т.п. - Гант
        // несёт МНОГО таких обработчиков, ни один из них не ставит
        // фокус ввода). Если ПОКА идёт перетаскивание (mousedown уже
        // случился, mouseup ещё нет) СРАБАТЫВАЕТ calculateAll() (из
        // ЛЮБОГО источника в графе, не обязательно от этого же
        // виджета) - flush() пересобирает ВЕСЬ виджет ЦЕЛИКОМ прямо под
        // активным перетаскиванием: обработчики mousemove/mouseup
        // (навешенные на document, не на сам удалённый узел) остаются
        // висеть, молча обновляя УЖЕ ОТСОЕДИНЁННЫЙ от DOM элемент -
        // визуально это выглядит как "зависание" (перетаскивание
        // перестаёт на что-либо влиять), хотя JS не падает и не
        // виснет по-настоящему - именно поэтому переключение на Лист и
        // обратно "лечит": оно принудительно перерисовывает Доску
        // целиком заново, обрывая осиротевшие слушатели естественным
        // образом (сборка мусора старого DOM-поддерева).
        //
        // Фикс - тот же принцип защиты, что уже есть для фокуса ввода,
        // но по факту "мышь сейчас зажата НАД этим виджетом" - глобальные
        // mousedown/mouseup на document (не на конкретные ручки внутри
        // ganttNode.js - тех СЛИШКОМ много, чтобы точечно патчить
        // каждую, а этот способ защищает ВСЕ разом, включая будущие).
        this._activeDragWidgetId = null;
        document.addEventListener('mousedown', (e) => {
            const widgetEl = e.target.closest?.('.board-widget');
            this._activeDragWidgetId = widgetEl ? widgetEl.dataset.widgetId : null;
        });
        document.addEventListener('mouseup', () => {
            this._activeDragWidgetId = null;
        });

        // Багфикс 1.6.1: registerWidget()/unregisterWidgetEverywhere()
        // раньше рендерили Доску СРАЗУ при каждом вызове. Оба метода
        // вызываются только изнутри DashboardNode.calculate() (плюс
        // теперь nodeManager.deleteNodeById(), см. там) - то есть всегда
        // либо во время nodeManager.calculateAll() (может прогнать
        // calculate() до nodes.length раз за один вызов - при N виджетах
        // на Доске это давало до nodes.length×N лишних пересборок DOM на
        // одно изменение), либо непосредственно перед вызовом
        // calculateAll(). В обоих случаях рендер безопасно отложить:
        // оба метода теперь только помечают доску "грязной"
        // (_dirtyBoardIds), а единственный реальный renderActiveBoard()
        // происходит один раз в конце calculateAll() через flush() (см.
        // nodeManager.js).
        this._dirtyBoardIds = new Set();
        this._flushScheduled = false;

        // Раунд 160 (по жалобе Mr.D: "формат Web должен подстраиваться
        // под размер окна, но похоже берёт размер окна ТОЛЬКО при
        // запуске - если потом развернуть окно на весь экран, не
        // пересчитывает, DOM-элемент остаётся старой ширины") - причина
        // найдена: во всём проекте не было НИ ОДНОГО обработчика
        // 'resize' - CSS-контейнер формата "web" (flex-grow:1; width:auto)
        // САМ по себе тянется корректно, но содержимое ВНУТРИ виджетов
        // (например, диаграммы, читающие размер контейнера через JS при
        // отрисовке) не получало сигнала пересчитать себя ЗАНОВО при
        // последующем изменении окна - только при ПЕРВОМ рендере.
        // Debounce (200мс) - 'resize' может сработать ДЕСЯТКИ раз за
        // секунду при живом перетаскивании края окна мышью, полная
        // перерисовка Доски на КАЖДЫЙ тик была бы избыточной нагрузкой.
        let resizeDebounceTimer = null;
        window.addEventListener('resize', () => {
            clearTimeout(resizeDebounceTimer);
            resizeDebounceTimer = setTimeout(() => {
                const board = this.getActiveBoard();
                // Перерисовываем ТОЛЬКО когда реально на экране Доска
                // (не граф нод) формата "web" - фиксированные форматы
                // (A4/16:9) не завязаны на размер окна, лишняя
                // перерисовка на resize им не нужна.
                if (this.viewActive && board?.format === 'web') {
                    this.renderActiveBoard();
                }
            }, 200);
        });
    }

    // Перерисовывает активную Доску, если после предыдущего flush() в
    // неё приходили изменения виджетов (registerWidget/
    // unregisterWidgetEverywhere). Безопасно вызывать часто - если
    // ничего не "грязно", ничего не делает.
    //
    // Раунд 167 (по жалобе Mr.D: "меняю продолжительность дней в
    // виджете, и тоже виснет интерфейс виджета, пока не переключусь на
    // Лист. При добавлении строки этот баг ловится тоже, но с нюансом -
    // через контекстное меню строка появляется, и потом становится в
    // фокус... думаю важный нюанс - добавление строки в виджете через
    // контекстное меню проталкивает рендер. Но потом опять всё
    // зависает") - flush() вызывается СИНХРОННО из calculateAll()
    // (nodeManager.js), которая, в свою очередь, вызывается ИЗНУТРИ
    // обработчика 'change'/'click' САМОГО ПОЛЯ/пункта меню виджета -
    // то есть renderActiveBoard() (полностью УДАЛЯЕТ и ЗАМЕНЯЕТ DOM
    // виджета) срабатывает, пока браузер ЕЩЁ НЕ ЗАВЕРШИЛ СВОЮ
    // СОБСТВЕННУЮ внутреннюю обработку ЭТОГО ЖЕ события (у <input>
    // событие 'change' - часть последовательности потери фокуса;
    // удаление элемента ПРЯМО ПОСРЕДИ этой последовательности -
    // известный источник поломки фокус-менеджера браузера). Фикс -
    // откладываем ФАКТИЧЕСКУЮ пересборку DOM на следующий тик
    // (setTimeout 0). _flushScheduled - защита от дублирования, если
    // flush() вызовется несколько раз до того, как отложенный рендер
    // успеет сработать.
    flush() {
        if (this._dirtyBoardIds.size === 0) return;
        if (this._flushScheduled) return;
        this._flushScheduled = true;
        setTimeout(() => {
            this._flushScheduled = false;
            const shouldRenderActive = this._dirtyBoardIds.has(this.activeBoardId);
            this._dirtyBoardIds.clear();
            if (shouldRenderActive) this.renderActiveBoard();
        }, 0);
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
            // widgetId (= id ноды, показывающей себя на Доске) -> { order, type, title, render(container) }
            widgets: new Map(),
            // Раунд 124 (релиз 1.8.0, по решению Mr.D: "уйдём от ручного
            // ввода порядка виджетов, это был костыль для тестов -
            // виджеты должны перетаскиваться драг-энд-дропом") - порядок
            // ТЕПЕРЬ принадлежит ДОСКЕ (массив widgetId в нужной
            // последовательности), а не отдельной ноде - drag&drop
            // прямо на самой Доске (см. attachWidgetDrag()) двигает
            // ИМЕННО этот массив. Новый widgetId, которого здесь ещё
            // нет - дописывается в конец при первом рендере (см.
            // renderActiveBoard()).
            order: [],
            // Раунд 125 (релиз 1.8.0, по запросу Mr.D: "сейчас есть одна
            // фиксированная ширина, надо сделать чтобы формат можно было
            // переключать - фиксированная ширина A4, 16:9, и Web") -
            // 'a4' (дефолт - прежнее единственное поведение, без
            // изменений для существующих Досок), '16:9', 'web' (ширина
            // подстраивается под доступную ширину окна - см. CSS,
            // .board-page[data-format="web"]).
            format: 'a4'
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
        // Переключаем, если это другая доска ИЛИ эта же доска формально
        // "активна", но сейчас закрыта видом графа нод (см. viewActive)
        if (id === this.activeBoardId && this.viewActive) return;
        this.activeBoardId = id;

        this.viewActive = true;
        if (window.layoutManager) {
            window.layoutManager.viewActive = false;
            window.layoutManager.renderTabs();
        }

        // Свежий вид Доски - снимаем выбор виджета и закрываем панель,
        // оставшуюся от предыдущего вида (ноды графа или другой Доски),
        // а не показываем настройки того, что сейчас не на экране
        this.selectedWidgetId = null;
        if (window.inspectorManager) window.inspectorManager.close();

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

    // Раунд 125 - переключение формата активной Доски (кнопки в
    // #boardToolbar, см. index.html/_wireFormatButtons()).
    setFormat(format) {
        const board = this.getActiveBoard();
        if (!board || board.format === format) return;
        board.format = format;
        this.renderActiveBoard();
    }

    _syncFormatButtons() {
        const board = this.getActiveBoard();
        const format = board?.format || 'a4';
        ['boardFormatA4', 'boardFormat169', 'boardFormatWeb'].forEach(id => {
            const btn = document.getElementById(id);
            if (btn) btn.classList.toggle('active', btn.dataset.format === format);
        });
    }

    // Раунд 162 - переключение режима редактирования (перестановка/
    // изменение размера виджетов, рамка выделения) - см. докстринг поля
    // this.editMode выше про то, зачем он глобальный и выключен по
    // умолчанию. Перерисовывает активную Доску сразу - выключение
    // должно НЕМЕДЛЕННО убрать ручки/рамку с уже выбранного виджета
    // (не ждать следующего клика), включение - вернуть их для уже
    // выбранного (если выбор остался с прошлого раза).
    toggleEditMode() {
        this.editMode = !this.editMode;
        // Раунд 162 - выключение должно НЕМЕДЛЕННО убрать рамку/панель
        // уже выбранного виджета (не оставлять "осиротевшее" выделение,
        // с которым больше нельзя взаимодействовать, раз клик-выбор
        // теперь недоступен).
        if (!this.editMode) this.selectedWidgetId = null;
        this._syncEditModeButton();
        this.renderActiveBoard();
    }

    _syncEditModeButton() {
        const btn = document.getElementById('boardEditModeBtn');
        if (btn) btn.classList.toggle('active', this.editMode);
    }

    _wireEditModeButton() {
        const btn = document.getElementById('boardEditModeBtn');
        if (btn) btn.addEventListener('click', () => this.toggleEditMode());
    }

    // Вызывается один раз при старте приложения (см. main.js) - вешает
    // клик-обработчики на три кнопки формата в #boardToolbar. Отдельно
    // от _syncFormatButtons() (та просто подсвечивает активную кнопку
    // при каждом рендере Доски, без пере-навешивания обработчиков).
    _wireFormatButtons() {
        document.querySelectorAll('#boardToolbar .canvas-tool-btn[data-format]').forEach(btn => {
            btn.addEventListener('click', () => this.setFormat(btn.dataset.format));
        });
    }

    // Показать холст Доски вместо графа нод (и наоборот - см.
    // layoutManager.loadLayout(), которая вызывает обратный переключатель)
    showBoardView() {
        const workspace = document.getElementById('workspace');
        const boardCanvas = document.getElementById('boardCanvasWrap');
        const boardToolbar = document.getElementById('boardToolbar');
        if (workspace) workspace.style.display = 'none';
        if (boardCanvas) boardCanvas.style.display = 'flex';
        if (boardToolbar) boardToolbar.style.display = 'flex';
    }

    // ============================================
    // ВИДЖЕТЫ (назначаются нодами "Дашборд", см. dashboardNode.js)
    // ============================================

    // Регистрирует/обновляет виджет на конкретной Доске. Сначала снимает
    // этот же widgetId со ВСЕХ досок - если нода "Дашборд" сменила
    // targetBoardId, виджет не должен остаться дублем на старой доске.
    registerWidget(boardId, widgetId, data) {
        this.unregisterWidgetEverywhere(widgetId);
        const board = this.getBoard(boardId);
        if (!board) return;
        board.widgets.set(widgetId, data);
        this._dirtyBoardIds.add(boardId);
    }

    unregisterWidgetEverywhere(widgetId) {
        this.boards.forEach(board => {
            if (board.widgets.delete(widgetId)) this._dirtyBoardIds.add(board.id);
            const idx = board.order.indexOf(widgetId);
            if (idx !== -1) board.order.splice(idx, 1);
        });
    }

    // Раунд 124 (релиз 1.8.0, по запросу Mr.D: "переключатель Доска...
    // указать на каких досках мы хотим видеть отображение этого узла") -
    // публикация ОДНОГО виджета сразу на НЕСКОЛЬКО досок - в отличие от
    // registerWidget() (которая снимает виджет со ВСЕХ других досок,
    // рассчитана на модель "один узел = одна доска", как у DashboardNode)
    // здесь виджет может стоять на любом подмножестве досок одновременно.
    // targetBoardIds - массив id досок, где виджет должен быть показан
    // (пустой массив - снять со всех). data - объект виджета
    // ({type, title, render, style, layout}), общий для всех целевых
    // досок (та же ссылка - стиль/размер редактируются один раз, видны
    // везде, тот же приём, что уже применён у DashboardNode).
    syncWidgetToBoards(widgetId, targetBoardIds, data) {
        const targetSet = new Set(targetBoardIds || []);
        this.boards.forEach(board => {
            const shouldBeOn = targetSet.has(board.id);
            const isOn = board.widgets.has(widgetId);
            if (shouldBeOn && !isOn) {
                board.widgets.set(widgetId, data);
                this._dirtyBoardIds.add(board.id);
            } else if (shouldBeOn && isOn) {
                // Уже есть - обновляем данные виджета (свежий render()
                // после пересчёта), позицию в order не трогаем.
                board.widgets.set(widgetId, data);
                this._dirtyBoardIds.add(board.id);
            } else if (!shouldBeOn && isOn) {
                board.widgets.delete(widgetId);
                const idx = board.order.indexOf(widgetId);
                if (idx !== -1) board.order.splice(idx, 1);
                this._dirtyBoardIds.add(board.id);
            }
        });
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
            // "active" только если Доска и правда сейчас на экране -
            // одного совпадения id с activeBoardId недостаточно, пока
            // видом владеет граф нод (см. viewActive)
            const isActive = board.id === this.activeBoardId && this.viewActive;
            tab.className = 'layout-tab' + (isActive ? ' active' : '');
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
                if (!isActive) return;
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
    // ВЫБОР ВИДЖЕТА (клик по виджету на Доске -> боковая панель стиля)
    // ============================================

    // widgetId совпадает с id ноды "Дашборд", создавшей виджет - ищем
    // инстанс через layoutManager.findNodeAnywhere(), т.к. эта нода может
    // жить на ЛЮБОМ Листе, не обязательно активном сейчас (см.
    // dashboardNode.js). Открываем ту же боковую панель, что и для
    // выбора ноды в графе - DashboardNode.getInspectorSchema() уже
    // содержит секцию "Стиль виджета".
    selectWidget(widgetId) {
        if (this.selectedWidgetId === widgetId) return;
        this.selectedWidgetId = widgetId;
        this.renderActiveBoard();

        const node = window.layoutManager?.findNodeAnywhere(widgetId);
        if (node && window.inspectorManager) {
            window.inspectorManager.open(node);
        }
    }

    deselectWidget() {
        if (this.selectedWidgetId === null) return;
        this.selectedWidgetId = null;
        this.renderActiveBoard();
        if (window.inspectorManager) window.inspectorManager.close();
    }

    // ============================================
    // РЕНДЕР ХОЛСТА (страница, вертикальный поток виджетов)
    // ============================================

    // До 1.6.1 этот метод вызывался ОЧЕНЬ часто напрямую из
    // registerWidget()/unregisterWidgetEverywhere() - на каждое нажатие
    // клавиши в редактируемом поле виджета (Число/Список/Строка, Раунд 37)
    // и на КАЖДЫЙ из nodes.length проходов nodeManager.calculateAll() для
    // КАЖДОГО виджета на Доске (при N виджетах - до nodes.length×N
    // пересборок на одно изменение, см. багфикс 1.6.1 у registerWidget()
    // выше). Начиная с 1.6.1 registerWidget()/unregisterWidgetEverywhere()
    // только помечают доску "грязной" (_dirtyBoardIds), а renderActiveBoard()
    // вызывается один раз за calculateAll() - через flush() (см.
    // nodeManager.js). Реконсиляция ниже по-прежнему нужна: при живом
    // редактировании (пользователь печатает) flush всё равно происходит
    // на каждое нажатие клавиши (просто один раз, а не N×M) - фокус
    // нужно сохранять.
    //
    // Раньше метод БЕЗУСЛОВНО делал container.innerHTML='' и пересоздавал
    // все виджеты заново - на каждое нажатие клавиши input, в который
    // печатает пользователь, уничтожался и создавался заново, теряя
    // фокус (ровно то, от чего в NODE_API.md предупреждает раздел про
    // updateDisplay() - "не перезаписывайте поле, пока в нём фокус", но
    // раньше здесь эта защита отсутствовала вовсе).
    //
    // Решение - реконсиляция ПО МЕСТУ вместо innerHTML='': если фокус
    // сейчас внутри какого-то виджета, его DOM-элемент переиспользуется
    // КАК ЕСТЬ (не пересоздаётся), остальные виджеты по-прежнему
    // перестраиваются заново на каждый вызов (живое обновление, например
    // у Таблицы, получающей изменённое число через ноду "Дашборд",
    // работает как и раньше). page.insertBefore/removeChild ниже двигают
    // узлы ВНУТРИ уже прикреплённой к документу страницы, не отсоединяя
    // их от документа ни на миг - в отличие от innerHTML='', это не
    // сбрасывает фокус.
    renderActiveBoard() {
        const container = document.getElementById('boardCanvas');
        if (!container) return;

        let page = container.querySelector('.board-page');
        if (!page) {
            page = document.createElement('div');
            page.className = 'board-page';
            container.innerHTML = '';
            container.appendChild(page);
        }
        const board = this.getActiveBoard();
        // Раунд 125 - формат страницы (A4/16:9/Web) читается через
        // CSS-атрибут (тот же приём, что data-size у виджетов) - вся
        // геометрия (ширина/пропорции) описана в styles.css/
        // day_styles.css, здесь только проставляем значение.
        page.dataset.format = board?.format || 'a4';
        this._syncFormatButtons();
        this._syncEditModeButton();

        const activeEl = document.activeElement;
        const focusedWidgetEl = (activeEl && page.contains(activeEl))
            ? activeEl.closest('.board-widget')
            : null;
        const focusedWidgetId = focusedWidgetEl ? focusedWidgetEl.dataset.widgetId : null;

        // Раунд 166 - та же защита, что уже была для фокуса ввода
        // (focusedWidgetEl выше), но по факту "мышь сейчас зажата НАД
        // этим виджетом" (см. докстринг this._activeDragWidgetId в
        // конструкторе про то, какой класс багов это устраняет).
        const activeDragWidgetEl = this._activeDragWidgetId
            ? page.querySelector(`.board-widget[data-widget-id="${this._activeDragWidgetId}"]`)
            : null;

        // Раунд 124 - любой widgetId, которого ещё нет в board.order
        // (только что зарегистрированный виджет) - дописывается в конец
        // ПЕРЕД сортировкой, чтобы у него сразу было законное место в
        // последовательности (а не "сортировка как попало" на первом
        // рендере).
        //
        // Багфикс (Раунд 125) - раньше здесь ЕЩЁ была защитная строка
        // `board.order = board.order.filter(id => board.widgets.has(id))`
        // ("на случай рассинхронизации") - она СТИРАЛА весь сохранённый
        // порядок сразу после loadFromData(): на этот момент
        // board.widgets ВСЕГДА пуст (виджеты не сериализуются, см.
        // докстринг класса - они появляются только когда ноды
        // пересчитаются и САМИ зарегистрируются через
        // syncWidgetToBoards()/registerWidget(), что происходит ПОЗЖЕ) -
        // фильтр "по существующим widgets" удалял ВСЕ id из order,
        // потому что ни одного widget'а ещё физически не было. Отдельная
        // защита не нужна - unregisterWidgetEverywhere()/
        // syncWidgetToBoards() и так корректно убирают id из order В
        // ТОТ МОМЕНТ, когда виджет реально перестаёт публиковаться -
        // проверено исполняемым тестом (см. CHANGES.md).
        if (board) {
            board.widgets.forEach((_, id) => {
                if (!board.order.includes(id)) board.order.push(id);
            });
        }
        const widgets = board
            ? board.order.map(id => ({ id, ...board.widgets.get(id) }))
            : [];

        if (widgets.length === 0) {
            page.innerHTML = '';
            if (board) {
                const empty = document.createElement('div');
                empty.className = 'board-empty';
                empty.textContent = 'На этой доске пока нет виджетов - подключите ноду "Дашборд" к источнику данных на любом Листе и выберите эту доску в её панели настроек';
                page.appendChild(empty);
            }
            return;
        }

        // Раунд 168 (по жалобе Mr.D: "рендер не обновляется... Диаграмма
        // Ганта") - у Диаграммы Ганта ЕСТЬ СВОЙ, УЗЛОВОЙ (не DOM)
        // механизм фокуса (_focusedTaskKey, ganttNode.js) - защита
        // "сохранить DOM при фокусе ввода" ей не просто не нужна, она
        // ВРЕДНА (клавиатурная навигация постоянно держит фокус ВНУТРИ
        // виджета, из-за чего виджет никогда бы не обновлялся свежими
        // данными).
        const isGanttWidget = (w) => w.type === 'gantt';

        // Раунд 171 (по жалобе Mr.D: "виджет забывает положение
        // пользователя (прокрутки внутри) при обновлении рендера") -
        // Диаграмма Ганта ВСЕГДА пересобирается заново (см. isGanttWidget
        // выше) - buildWidgetEl() строит СОВЕРШЕННО НОВЫЙ DOM со
        // scrollLeft/scrollTop = 0 по умолчанию на КАЖДОЕ изменение
        // данных.
        //
        // Раунд 173 (по жалобе Mr.D: "баг остался, положение
        // сбрасывается") - Раунд 171 восстанавливал прокрутку СРАЗУ
        // после buildWidgetEl(), ДО того, как новый узел РЕАЛЬНО
        // вставлен в документ (это происходит позже, в цикле
        // page.insertBefore() внизу метода) - в РЕАЛЬНОМ браузере
        // scrollLeft/scrollTop, выставленные на ЕЩЁ НЕ прикреплённом к
        // документу элементе, часто молча игнорируются или сбрасываются:
        // область прокрутки (высота/ширина содержимого) физически не
        // вычислена, пока элемент не стал частью видимого дерева со
        // своей раскладкой - собственный тестовый DOM-стаб этого не
        // ловил (там scrollLeft/scrollTop - просто поле объекта, без
        // имитации реальной раскладки браузера). Копим ЖЕЛАЕМУЮ
        // прокрутку в ganttScrollToRestore (widgetId -> {scrollLeft,
        // scrollTop}) и применяем её ПОСЛЕ цикла вставки внизу метода,
        // через requestAnimationFrame - гарантированно после того, как
        // браузер хотя бы раз посчитал раскладку нового узла.
        const ganttScrollToRestore = new Map();
        const captureGanttScroll = (widgetId) => {
            const oldEl = page.querySelector(`.board-widget[data-widget-id="${widgetId}"]`);
            const oldOuter = oldEl?.querySelector('.gantt-outer-scroll');
            const oldRowsWrap = oldEl?.querySelector('.gantt-rows-scroll');
            if (!oldOuter && !oldRowsWrap) return null;
            const scrollLeft = oldOuter?.scrollLeft || 0;
            const scrollTop = oldRowsWrap?.scrollTop || 0;
            if (!scrollLeft && !scrollTop) return null;
            return { scrollLeft, scrollTop };
        };

        // Для виджета в фокусе ИЛИ с активным перетаскиванием мышью -
        // тот же DOM-узел, что уже стоит в странице; для всех остальных -
        // свежий, как и раньше.
        const desiredEls = widgets.map(w => {
            if (!isGanttWidget(w) && focusedWidgetId !== null && String(w.id) === focusedWidgetId) return focusedWidgetEl;
            if (this._activeDragWidgetId !== null && String(w.id) === this._activeDragWidgetId && activeDragWidgetEl) return activeDragWidgetEl;
            if (isGanttWidget(w)) {
                const savedScroll = captureGanttScroll(w.id);
                const freshEl = this.buildWidgetEl(w);
                if (savedScroll) ganttScrollToRestore.set(freshEl, savedScroll);
                return freshEl;
            }
            return this.buildWidgetEl(w);
        });

        // Багфикс (виджеты №2+ ломались при вводе). Раньше цикл ниже
        // сверял desiredEls с ЖИВОЙ коллекцией page.children[i], которая
        // меняется прямо по ходу того же цикла: как только перед
        // виджетом в фокусе вставлялся/пересобирался хоть один другой
        // виджет (i=0 обрабатывается раньше), все последующие индексы
        // сдвигались - и на следующей итерации page.children[i] для
        // виджета В ФОКУСЕ уже указывал не на него, из-за чего код
        // считал, что его тоже надо "переставить" через insertBefore(),
        // хотя он и так стоял на месте. insertBefore() на элементе,
        // у которого прямо сейчас фокус и курсор посреди текста, сбивает
        // ввод. Именно поэтому баг был только у виджетов НЕ на первой
        // позиции - перед первым (i=0) сдвигов ещё не было.
        //
        // Фикс - сначала явно удалить из DOM только те узлы, которых
        // нет среди desiredEls (точное сравнение ссылок, включая
        // сфокусированный - он есть в desiredEls, поэтому не тронется).
        // После этого "мусорных" узлов, из-за которых сдвигались индексы,
        // не остаётся, и обычная вставка по индексу работает корректно
        // без единого лишнего перемещения уже стоящих на месте элементов.
        const desiredSet = new Set(desiredEls);
        Array.from(page.children).forEach(child => {
            if (!desiredSet.has(child)) page.removeChild(child);
        });

        desiredEls.forEach((el, i) => {
            const current = page.children[i];
            if (current !== el) page.insertBefore(el, current || null);
        });

        // Раунд 173 - применяем накопленную прокрутку ТЕПЕРЬ, когда все
        // элементы гарантированно уже в документе (см. докстринг
        // ganttScrollToRestore выше). requestAnimationFrame - на случай,
        // если браузеру нужен ХОТЯ БЫ один кадр между вставкой в DOM и
        // тем, когда scrollLeft/scrollTop на новом узле начинают
        // реально "держаться" (зависит от движка - для надёжности не
        // полагаемся на синхронное применение сразу после insertBefore).
        if (ganttScrollToRestore.size > 0) {
            requestAnimationFrame(() => {
                ganttScrollToRestore.forEach((saved, el) => {
                    const newOuter = el.querySelector('.gantt-outer-scroll');
                    const newRowsWrap = el.querySelector('.gantt-rows-scroll');
                    if (newOuter && saved.scrollLeft) newOuter.scrollLeft = saved.scrollLeft;
                    if (newRowsWrap && saved.scrollTop) newRowsWrap.scrollTop = saved.scrollTop;
                });
            });
        }
    }

    // Раунд 47 - "выравнивание" виджета (style.align, Раунд 31) раньше
    // ставилось ТОЛЬКО как text-align на обёртку (bodyEl) и полагалось
    // на CSS-наследование - для простого текста этого достаточно, но НЕ
    // работает для table/input-содержимого:
    //   - <input> с width:100% занимает всю ширину контейнера целиком -
    //     "центрировать" сам БОКС нечем (он уже во всю ширину), нужно
    //     выравнивать ТЕКСТ ВНУТРИ поля - inherited text-align до него
    //     не всегда доходит достаточно надёжно;
    //   - <td>/<th> внутри таблиц (Список/Таблица/Итого) УЖЕ несут
    //     СВОЙ text-align через CSS-класс (.align-right и т.п.) - более
    //     специфичное правило класса побеждает унаследованное значение
    //     от родителя вообще без вариантов, унаследованное там не
    //     работает никогда, а не иногда.
    // Поэтому: после того как render() построил содержимое, проходим по
    // нему и переопределяем text-align НАПРЯМУЮ на найденных input/td/th -
    // инлайн-стиль побеждает любой CSS-класс. Столбец номеров строк
    // (.board-widget-table-num-cell) исключён - это служебная навигация,
    // не "данные", которыми управляет align виджета.
    _applyWidgetAlign(bodyEl, align) {
        const value = align || 'left';
        bodyEl.querySelectorAll('input').forEach(el => {
            el.style.textAlign = value;
        });
        bodyEl.querySelectorAll('table td:not(.board-widget-table-num-cell), table th:not(.board-widget-table-num-cell)').forEach(el => {
            el.style.textAlign = value;
        });
    }

    buildWidgetEl(widget) {
        const widgetEl = document.createElement('div');
        widgetEl.className = 'board-widget';
        widgetEl.dataset.widgetId = widget.id;
        const isSelected = widget.id === this.selectedWidgetId;
        if (isSelected) widgetEl.classList.add('selected');

        // Стиль из боковой панели (DashboardNode.widgetStyle) - размер
        // читает CSS через data-size (см. styles.css, .board-widget[data-size]),
        // цвет - через CSS-переменную (используют .board-widget-number/
        // -table/-list, см. styles.css), выравнивание - инлайн на теле и
        // заголовке виджета
        const style = widget.style || {};
        widgetEl.dataset.size = style.size || 'medium';
        if (style.color) {
            widgetEl.style.setProperty('--board-widget-accent', style.color);
        }

        // Место на условной сетке страницы (см. GRID_COLS/ROW_PX выше).
        // colSpan всегда задан явно (12 = во всю ширину - дефолт, как
        // раньше вело себя width:100%). rowSpan === null - "авто высота
        // по контенту": grid-row намеренно НЕ трогаем, единственный
        // implicit-ряд сам растягивается под контент через
        // grid-auto-rows: minmax(ROW_PX, auto) (см. styles.css) - ручное
        // измерение не нужно, пока пользователь сам не потянет за
        // верхнюю/нижнюю ручку (см. attachResizeDrag).
        const layout = widget.layout || { colSpan: GRID_COLS, rowSpan: null };
        widgetEl.style.gridColumn = `span ${clamp(layout.colSpan || GRID_COLS, 1, GRID_COLS)}`;
        if (layout.rowSpan) {
            widgetEl.style.gridRow = `span ${Math.max(MIN_ROW_SPAN, layout.rowSpan)}`;
        }

        // Раунд 162 (по запросу Mr.D: "без включённого режима
        // редактирования мы можем только менять содержимое виджетов, не
        // можем переставлять виджеты, менять их положение, рамка на
        // активном виджете не появляется") - клик-выбор (рамка + панель
        // инспектора) и ручка перетаскивания доступны ТОЛЬКО в режиме
        // редактирования - вне его клик по виджету просто "проваливается"
        // до его СОБСТВЕННОГО содержимого (bodyEl.render() уже навесил
        // на него свои обработчики - тем ничего не мешает).
        if (this.editMode) {
            widgetEl.addEventListener('click', (e) => {
                e.stopPropagation();
                this.selectWidget(widget.id);
            });

            // Раунд 124 (по решению Mr.D: "уйдём от ручного ввода порядка
            // виджетов, это был костыль для тестов - виджеты должны
            // перетаскиваться драг-энд-дропом") - выделенная ручка (не
            // весь виджет целиком - тот может содержать интерактивное
            // содержимое, поля ввода и т.п., которым drag не должен
            // мешать). Нативный HTML5 Drag&Drop (не mousedown/mousemove,
            // как у attachResizeDrag() выше) - для "определить, над
            // каким именно виджетом сейчас курсор" браузерный dragover/
            // drop подходит лучше ручного hit-testing.
            this.attachWidgetDrag(widgetEl, widget.id);
        }

        if (widget.title) {
            const titleEl = document.createElement('div');
            titleEl.className = 'board-widget-title';
            titleEl.textContent = widget.title;
            titleEl.style.textAlign = style.align || 'left';
            widgetEl.appendChild(titleEl);
        }

        // Метка "переопределено на Доске" (см. dashboardNode.js) - чисто
        // визуальная, показывает, что текущее значение отличается от
        // исходной ноды в графе
        if (widget.overridden) {
            const overrideMark = document.createElement('span');
            overrideMark.className = 'board-widget-override-mark';
            overrideMark.textContent = '✎';
            overrideMark.title = 'Значение переопределено на Доске - отличается от исходной ноды в графе';
            widgetEl.appendChild(overrideMark);
        }

        const bodyEl = document.createElement('div');
        bodyEl.className = 'board-widget-body';
        bodyEl.style.textAlign = style.align || 'left';
        if (typeof widget.render === 'function') {
            widget.render(bodyEl);
        }
        this._applyWidgetAlign(bodyEl, style.align);
        widgetEl.appendChild(bodyEl);

        // Ручки деформации по сетке - по одной на середину каждой грани,
        // рисуются только у выбранного виджета (не захламляют страницу,
        // когда ничего не выбрано)
        if (isSelected) {
            ['n', 'e', 's', 'w'].forEach(edge => {
                const handle = document.createElement('div');
                handle.className = `board-widget-handle board-widget-handle-${edge}`;
                this.attachResizeDrag(handle, widget.id, edge, widgetEl);
                widgetEl.appendChild(handle);
            });
        }

        return widgetEl;
    }

    // Раунд 124 - выделенная ручка перетаскивания (⠿, левый верхний
    // угол виджета) - только ОНА реально draggable="true", сам виджет
    // при этом остаётся кликабельным/редактируемым как обычно. dragover
    // на ДРУГОМ виджете определяет цель, drop переставляет ПЕРЕТАСКИВАЕМЫЙ
    // id на место ЦЕЛЕВОГО в board.order (простой swap-по-позиции, не
    // полноценная 2D-раскладка с учётом colSpan/rowSpan - для сетки с
    // разноразмерными виджетами этого достаточно для "визуально перед/
    // после" без лишней сложности).
    attachWidgetDrag(widgetEl, widgetId) {
        const handle = document.createElement('div');
        handle.className = 'board-widget-drag-handle';
        handle.title = 'Перетащите, чтобы изменить порядок виджетов';
        handle.textContent = '⠿';
        handle.draggable = true;
        handle.addEventListener('mousedown', (e) => e.stopPropagation());
        handle.addEventListener('click', (e) => e.stopPropagation());

        handle.addEventListener('dragstart', (e) => {
            e.stopPropagation();
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', String(widgetId));
            widgetEl.classList.add('dragging');
        });
        handle.addEventListener('dragend', () => {
            widgetEl.classList.remove('dragging');
        });

        widgetEl.addEventListener('dragover', (e) => {
            if (!e.dataTransfer.types.includes('text/plain')) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            widgetEl.classList.add('drop-target');
        });
        widgetEl.addEventListener('dragleave', () => {
            widgetEl.classList.remove('drop-target');
        });
        widgetEl.addEventListener('drop', (e) => {
            e.preventDefault();
            e.stopPropagation();
            widgetEl.classList.remove('drop-target');
            const draggedId = Number(e.dataTransfer.getData('text/plain'));
            const targetId = widgetId;
            if (!Number.isFinite(draggedId) || draggedId === targetId) return;

            const board = this.getActiveBoard();
            if (!board) return;
            const fromIdx = board.order.indexOf(draggedId);
            const toIdx = board.order.indexOf(targetId);
            if (fromIdx === -1 || toIdx === -1) return;

            board.order.splice(fromIdx, 1);
            // toIdx мог сдвинуться после удаления draggedId выше, если
            // draggedId стоял ПЕРЕД целью - пересчитываем заново вместо
            // использования устаревшего индекса.
            const newToIdx = board.order.indexOf(targetId);
            board.order.splice(newToIdx, 0, draggedId);

            this.renderActiveBoard();
        });

        widgetEl.insertBefore(handle, widgetEl.firstChild);
    }

    // Перетаскивание ручки на грани виджета - меняет colSpan (e/w) или
    // rowSpan (n/s) на условной сетке страницы. Во время движения мыши
    // меняем только инлайн-стиль САМОГО виджета (мгновенный визуальный
    // отклик, без пересборки остальной Доски на каждый pixel) - реальное
    // перетекание соседних виджетов на новое место сетки (grid-auto-flow)
    // пересчитывается один раз на mouseup через renderActiveBoard().
    //
    // Доска НЕ находится внутри зумируемого #nodesContainer (см.
    // main.js/applyZoom) - в отличие от перетаскивания в графе нод,
    // здесь зум-коррекция дельты мыши не нужна.
    attachResizeDrag(handleEl, widgetId, edge, widgetEl) {
        handleEl.addEventListener('mousedown', (e) => {
            e.stopPropagation();
            e.preventDefault();

            const node = window.layoutManager?.findNodeAnywhere(widgetId);
            if (!node || !node.widgetLayout) return;

            const pageEl = widgetEl.closest('.board-page');
            if (!pageEl) return;
            const pageStyle = getComputedStyle(pageEl);
            const contentWidth = pageEl.clientWidth
                - parseFloat(pageStyle.paddingLeft) - parseFloat(pageStyle.paddingRight);
            // Шаг в px, который сдвигает ровно на 1 колонку/ряд сетки -
            // включает зазор (GRID_GAP), т.к. дорожки repeat(12,1fr)
            // вместе с зазорами в точности заполняют contentWidth
            const colStepPx = (contentWidth + GRID_GAP) / GRID_COLS;
            const rowStepPx = ROW_PX + GRID_GAP;

            const startX = e.clientX;
            const startY = e.clientY;
            const startColSpan = clamp(node.widgetLayout.colSpan || GRID_COLS, 1, GRID_COLS);
            // Если высота ещё "авто" (rowSpan === null) - точкой отсчёта
            // для вертикальной ручки берём ТЕКУЩУЮ измеренную высоту
            // виджета, чтобы перетаскивание не начиналось со скачка
            const startRowSpan = node.widgetLayout.rowSpan
                || Math.max(MIN_ROW_SPAN, Math.round(widgetEl.offsetHeight / rowStepPx));

            let pendingColSpan = startColSpan;
            let pendingRowSpan = startRowSpan;

            const onMove = (ev) => {
                const dx = ev.clientX - startX;
                const dy = ev.clientY - startY;

                if (edge === 'e') {
                    pendingColSpan = clamp(startColSpan + Math.round(dx / colStepPx), 1, GRID_COLS);
                    widgetEl.style.gridColumn = `span ${pendingColSpan}`;
                } else if (edge === 'w') {
                    // Тянем левую грань влево - виджет растёт, вправо - сжимается
                    pendingColSpan = clamp(startColSpan - Math.round(dx / colStepPx), 1, GRID_COLS);
                    widgetEl.style.gridColumn = `span ${pendingColSpan}`;
                } else if (edge === 's') {
                    pendingRowSpan = Math.max(MIN_ROW_SPAN, startRowSpan + Math.round(dy / rowStepPx));
                    widgetEl.style.gridRow = `span ${pendingRowSpan}`;
                } else if (edge === 'n') {
                    pendingRowSpan = Math.max(MIN_ROW_SPAN, startRowSpan - Math.round(dy / rowStepPx));
                    widgetEl.style.gridRow = `span ${pendingRowSpan}`;
                }
            };

            const onUp = () => {
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);

                // Прямая мутация - widgetLayout передан в registerWidget()
                // ПО ССЫЛКЕ (тот же приём, что и widgetStyle, см. Раунд 31),
                // поэтому запись видна сразу, даже если нода "Дашборд"
                // сейчас на неактивном Листе
                node.widgetLayout.colSpan = pendingColSpan;
                if (edge === 'n' || edge === 's') {
                    node.widgetLayout.rowSpan = pendingRowSpan;
                }

                this.renderActiveBoard();
            };

            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        });
    }

    // ============================================
    // СЕРИАЛИЗАЦИЯ - только сами доски (id/имя), НЕ виджеты (см. докстринг класса)
    // ============================================

    serialize() {
        return {
            activeBoardId: this.activeBoardId,
            boardIdCounter: this.boardIdCounter,
            boards: this.boards.map(b => ({ id: b.id, name: b.name, order: b.order, format: b.format }))
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

        this.boards = boardsData.map(b => ({ id: b.id, name: b.name, widgets: new Map(), order: Array.isArray(b.order) ? b.order : [], format: b.format || 'a4' }));
        this.boardIdCounter = data.boardIdCounter ?? (Math.max(...this.boards.map(b => b.id)) + 1);
        this.activeBoardId = this.boards.some(b => b.id === data.activeBoardId)
            ? data.activeBoardId
            : this.boards[0].id;

        this.renderTabs();
        this.renderActiveBoard();
    }
}
