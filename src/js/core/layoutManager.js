/**
 * SPDX-License-Identifier: MIT
 * SPDX-FileCopyrightText: 2024 NodeCalculate Team
 * SPDX-FileCopyrightText: 2024 Pavel Fomin
 *
 * @file    layoutManager.js
 * @brief   Листы (вкладки) проекта, сериализация и загрузка .ncp
 * @author  Pavel Fomin
 * @version 1.8.27
 * @see     https://github.com/GhostPWLk1n/NodeCalculator.git
 */

// Ноды, отдающие Data-таблицу и подключаемые к виджету Доски через
// TableWidgetRenderer (Раунды 35/42/44/45) - у всех общие поля
// boardShowRowNumbers/boardSortColumn/boardSortDirection (см. serialize()
// ниже). Один список на всех, чтобы не повторять его в каждой строке.
const TABLE_WIDGET_TYPES = [
    'table', 'tableInject', 'tableRemove', 'tableFormat',
    'tableMergeColumns', 'tableJoin', 'tableFilter', 'tableUnique', 'tree', 'treeFormat', 'jsonImport', 'treeToTable'
];

export class LayoutManager {
    constructor(nodeManager, connectionManager, renderer) {
        this.nodeManager = nodeManager;
        this.connectionManager = connectionManager;
        this.renderer = renderer;

        this.layouts = [];
        this.layoutIdCounter = 0;
        this.activeLayoutId = null;

        // Флаг "сейчас на экране показан граф нод (а не Доска)".
        // activeLayoutId сам по себе НЕ говорит, виден ли лист прямо
        // сейчас - Доски (boardManager) используют свой отдельный стек
        // activeBoardId, и оба стека раньше сравнивали клик только со
        // СВОИМ активным id. Из-за этого повторный клик по листу, который
        // формально остался "активным" в layoutManager, но фактически
        // сейчас закрыт видом Доски, ничего не делал. viewActive снимается
        // соседним менеджером при переключении на его вид, см.
        // boardManager.switchToBoard() и loadLayout()/initFirstLayout() ниже.
        this.viewActive = false;
    }

    // ============================================
    // СОЗДАНИЕ / ПОЛУЧЕНИЕ ЛИСТОВ
    // ============================================

    // Подбирает первое свободное имя "Лист N".
    // Раньше имя строилось как `Лист ${length + 1}`: после удаления
    // "Листа 1" при оставшемся "Листе 2" новый лист снова получал
    // имя "Лист 2" (дубликат).
    generateUniqueName() {
        let n = 1;
        while (this.layouts.some(l => l.name === `Лист ${n}`)) n++;
        return `Лист ${n}`;
    }

    createLayout(name) {
        const id = this.layoutIdCounter++;
        const layout = {
            id,
            name: name || this.generateUniqueName(),
            nodes: [],
            connections: []
        };
        this.layouts.push(layout);
        return layout;
    }

    // Инициализация первого листа при старте приложения.
    // Использует уже существующие (возможно пустые) массивы nodeManager/connectionManager,
    // чтобы не было рассинхронизации до первого переключения.
    initFirstLayout(name = 'Лист 1') {
        const id = this.layoutIdCounter++;
        const layout = {
            id,
            name,
            nodes: this.nodeManager.nodes,
            connections: this.connectionManager.connections
        };
        this.layouts.push(layout);
        this.activeLayoutId = id;
        this.viewActive = true; // при старте приложения виден граф нод, не Доска
        this.renderTabs();
        return layout;
    }

    getLayout(id) {
        return this.layouts.find(l => l.id === id);
    }

    getActiveLayout() {
        return this.getLayout(this.activeLayoutId);
    }

    getAllLayouts() {
        return this.layouts;
    }

    // ============================================
    // ПЕРЕКЛЮЧЕНИЕ ЛИСТОВ
    // ============================================

    // Сохраняет текущее состояние nodeManager/connectionManager в активный лист.
    // Вызывается перед любым переключением, чтобы не потерять изменения.
    saveActiveState() {
        const layout = this.getActiveLayout();
        if (!layout) return;
        layout.nodes = this.nodeManager.nodes;
        layout.connections = this.connectionManager.connections;
    }

    loadLayout(id) {
        const layout = this.getLayout(id);
        if (!layout) return;

        this.saveActiveState();

        // Ноды старого листа сейчас будут пересозданы с нуля - выбранная
        // (боковая панель) нода из прошлого листа больше не актуальна
        this.nodeManager.selectedNode = null;
        if (window.inspectorManager) {
            window.inspectorManager.close();
        }

        // Показываем граф нод вместо холста Доски (обратное действие -
        // boardManager.showBoardView(), см. boardManager.js)
        const workspace = document.getElementById('workspace');
        const boardCanvas = document.getElementById('boardCanvasWrap');
        const boardToolbar = document.getElementById('boardToolbar');
        if (workspace) workspace.style.display = '';
        if (boardCanvas) boardCanvas.style.display = 'none';
        if (boardToolbar) boardToolbar.style.display = 'none';

        // Этот вид (граф нод) теперь на экране - снимаем флаг с Досок,
        // иначе оба стека вкладок будут одновременно считать себя
        // "видимыми" (см. viewActive в конструкторе)
        this.viewActive = true;
        if (window.boardManager) {
            window.boardManager.viewActive = false;
            window.boardManager.selectedWidgetId = null;
            window.boardManager.renderTabs();
        }

        this.activeLayoutId = id;
        this.nodeManager.nodes = layout.nodes;
        this.connectionManager.connections = layout.connections;

        // Сбрасываем состояние перетаскивания/соединения, чтобы не тянуть "хвосты" с прошлого листа
        this.nodeManager.isDragging = false;
        this.nodeManager.draggedNode = null;
        this.connectionManager.cancelConnection();

        // Перерисовываем DOM
        const container = document.getElementById('nodesContainer');
        if (container) container.innerHTML = '';

        layout.nodes.forEach(node => this.nodeManager.renderNode(node));

        if (this.renderer) {
            this.renderer.drawAllConnections(layout.connections);
        }

        this.nodeManager.calculateAll();
        this.renderTabs();

        const status = document.getElementById('status');
        if (status) {
            status.textContent = `📄 Открыт лист «${layout.name}»`;
            setTimeout(() => { status.textContent = 'Готово'; }, 1500);
        }

        if (window.updateCounters) window.updateCounters();
    }

    addLayout() {
        const layout = this.createLayout();
        this.loadLayout(layout.id);
        return layout;
    }

    renameLayout(id, newName) {
        const layout = this.getLayout(id);
        if (!layout || !newName || !newName.trim()) return;
        layout.name = newName.trim();
        this.renderTabs();
    }

    deleteLayout(id) {
        if (this.layouts.length <= 1) {
            alert('Нельзя удалить последний лист');
            return;
        }

        const idx = this.layouts.findIndex(l => l.id === id);
        if (idx === -1) return;

        // Проверяем, не ссылаются ли на выходы этого листа ноды "Вход листа" из других листов
        const isUsed = this.layouts.some(l =>
            l.id !== id && l.nodes.some(n => n.type === 'layoutInput' && n.sourceLayoutId === id)
        );
        if (isUsed) {
            const ok = confirm('На этот лист есть ссылки из нод "Вход листа" на других листах. Всё равно удалить?');
            if (!ok) return;
        }

        this.layouts.splice(idx, 1);

        if (this.activeLayoutId === id) {
            const next = this.layouts[Math.max(0, idx - 1)];
            this.loadLayout(next.id);
        } else {
            this.renderTabs();
        }
    }

    // ============================================
    // СЕРИАЛИЗАЦИЯ / ДЕСЕРИАЛИЗАЦИЯ
    // ============================================

    // Превращает все листы в чистый JSON-совместимый объект.
    // Ноды - экземпляры классов, поэтому явно перечисляем поля:
    // JSON.stringify "как есть" сохранил бы мусор (listData, DOM-ссылки),
    // а при загрузке всё равно нужно восстанавливать классы.
    serialize() {
        this.saveActiveState();
        return {
            version: 1,
            activeLayoutId: this.activeLayoutId,
            layoutIdCounter: this.layoutIdCounter,
            nodeIdCounter: this.nodeManager.nodeIdCounter,
            layouts: this.layouts.map(l => ({
                id: l.id,
                name: l.name,
                connections: l.connections.map(c => ({ ...c })),
                nodes: l.nodes.map(n => ({
                    id: n.id, type: n.type, x: n.x, y: n.y,
                    value: n.value,
                    customName: n.customName,
                    width: n.width,
                    collapsed: n.collapsed,
                    inputs: n.inputs,
                    // Поля конкретных типов нод (undefined отбрасывается JSON'ом)
                    chartType: n.chartType,
                    customTitle: n.customTitle,
                    scaleValue: n.scaleValue,
                    sourceLayoutId: n.sourceLayoutId,
                    sourceNodeId: n.sourceNodeId,
                    items: ['listInput', 'listConvert'].includes(n.type) && n.items
                        ? n.items.map(i => ({ name: i.name, value: i.value }))
                        : undefined,
                    nameColumnWidth: n.type === 'listInput' ? n.nameColumnWidth : undefined,
                    valueColumnWidth: n.type === 'listInput' ? n.valueColumnWidth : undefined,
                    dataType: n.type === 'listInput' ? n.dataType : undefined,
                    // Формат отображения значения (см. BaseNode.getValueFormat) -
                    // необязателен, выставляется явно только теми нодами,
                    // которым это важно
                    valueFormat: n.valueFormat,
                    // Раунд 124 (релиз 1.8.0, "переключатель Доска" в
                    // инспекторе) - универсально по НАЛИЧИЮ поля (см.
                    // initBoardPublishFields() в utils/boardPublish.js),
                    // не по конкретному типу ноды - любая будущая нода,
                    // подключившая эту механику, сохранится сама, без
                    // правки этого файла.
                    showOnBoard: n.showOnBoard !== undefined ? n.showOnBoard : undefined,
                    boardIds: n.boardIds?.length ? [...n.boardIds] : undefined,
                    widgetStyle: n.widgetStyle && Object.keys(n.widgetStyle).length ? { ...n.widgetStyle } : undefined,
                    widgetLayout: n.widgetLayout ? { ...n.widgetLayout } : undefined,
                    // Акцентный цвет ноды (боковая панель, InspectorManager) -
                    // необязателен, null = цвет темы по умолчанию
                    color: n.color,
                    // TableNode: столбцы (пары LIST+String индексов сокетов
                    // и переопределение формата) + счётчик для новых индексов
                    columns: n.type === 'table' && n.columns
                        ? n.columns.map(c => ({ ...c }))
                        : undefined,
                    _nextIndex: n.type === 'table' ? n._nextIndex : undefined,
                    // Виджет Доски (Раунды 35/42/45) - номера строк/сортировка -
                    // общие поля у ЛЮБОЙ ноды, отдающей Data-таблицу
                    // (TableNode/TableInjectNode/TableRemoveNode/
                    // TableFormatNode/TableMergeColumnsNode/TableJoinNode/
                    // TableFilterNode), см. TableWidgetRenderer
                    boardShowRowNumbers: TABLE_WIDGET_TYPES.includes(n.type) ? n.boardShowRowNumbers : undefined,
                    boardSortColumn: TABLE_WIDGET_TYPES.includes(n.type) ? n.boardSortColumn : undefined,
                    boardSortDirection: TABLE_WIDGET_TYPES.includes(n.type) ? n.boardSortDirection : undefined,
                    // Раунд 93 (чек-лист, п.4.1) - ручная ширина столбцов
                    // ИМЕННО на Доске (TableWidgetRenderer, auto-init
                    // node.boardColumnWidths при первой отрисовке виджета -
                    // здесь просто читаем, если уже существует).
                    boardColumnWidths: TABLE_WIDGET_TYPES.includes(n.type) && n.boardColumnWidths
                        ? { ...n.boardColumnWidths }
                        : undefined,
                    // Зебра/линии (Раунд 44, расширено на TreeFormatNode в
                    // Раунде 56) - ТОЛЬКО у "форматирующих" нод -
                    // остальные табличные/древесные ноды намеренно не
                    // хламятся оформлением, см. докстринг tableFormatNode.js
                    boardZebra: ['tableFormat', 'treeFormat', 'treeToTable'].includes(n.type) ? n.boardZebra : undefined,
                    boardShowRowLines: ['tableFormat', 'treeFormat', 'treeToTable'].includes(n.type) ? n.boardShowRowLines : undefined,
                    boardShowColumnLines: ['tableFormat', 'treeFormat', 'treeToTable'].includes(n.type) ? n.boardShowColumnLines : undefined,
                    showRowNumbers: n.type === 'tableViewer' ? n.showRowNumbers : undefined,
                    sortColumnIndex: n.type === 'tableViewer' ? n.sortColumnIndex : undefined,
                    sortDirection: n.type === 'tableViewer' ? n.sortDirection : undefined,
                    columnWidths: n.type === 'tableViewer' && n.columnWidths ? { ...n.columnWidths } : undefined,
                    // Свободный ресайз (nodeManager.applyFreeResize) - и у
                    // TableViewerNode, и у GanttNode, взаимоисключающе по типу,
                    // поэтому один общий ключ (раньше было ДВА одинаковых ключа
                    // wrapHeight подряд - JS в object-литерале молча берёт
                    // последний, из-за чего высота TableViewerNode терялась)
                    wrapHeight: (n.type === 'tableViewer' || n.type === 'gantt') ? n.wrapHeight : undefined,
                    // DashboardNode: привязка к Доске
                    targetBoardId: n.type === 'dashboard' ? n.targetBoardId : undefined,
                    overridden: n.type === 'dashboard' ? n.overridden : undefined,
                    overrideValue: n.type === 'dashboard' ? n.overrideValue : undefined,
                    locked: n.type === 'dashboard' ? n.locked : undefined,
                    // GanttNode: календарь плана
                    startDate: n.type === 'gantt' ? n.startDate : undefined,
                    autoAnchorFromData: n.type === 'gantt' ? n.autoAnchorFromData : undefined,
                    periodPreset: n.type === 'gantt' ? n.periodPreset : undefined,
                    customPeriodDays: n.type === 'gantt' ? n.customPeriodDays : undefined,
                    durationUnit: n.type === 'gantt' ? n.durationUnit : undefined,
                    // Раунд 141 - scheduleMode убран целиком (все расчёты
                    // теперь всегда в рабочих днях, переключать нечего).
                    taskDates: n.type === 'gantt' ? { ...n.taskDates } : undefined,
                    taskDurationOverrides: n.type === 'gantt' ? { ...n.taskDurationOverrides } : undefined,
                    taskResponsible: n.type === 'gantt' ? { ...n.taskResponsible } : undefined,
                    showDurationColumn: n.type === 'gantt' ? n.showDurationColumn : undefined,
                    showWorkingDaysColumn: n.type === 'gantt' ? n.showWorkingDaysColumn : undefined,
                    showResponsibleColumn: n.type === 'gantt' ? n.showResponsibleColumn : undefined,
                    showCalDaysColumn: n.type === 'gantt' ? n.showCalDaysColumn : undefined,
                    subtitleText: n.type === 'gantt' ? n.subtitleText : undefined,
                    numColWidthOverride: n.type === 'gantt' ? n.numColWidthOverride : undefined,
                    labelColWidthOverride: n.type === 'gantt' ? n.labelColWidthOverride : undefined,
                    hoursColWidthOverride: n.type === 'gantt' ? n.hoursColWidthOverride : undefined,
                    workdaysColWidthOverride: n.type === 'gantt' ? n.workdaysColWidthOverride : undefined,
                    responsibleColWidthOverride: n.type === 'gantt' ? n.responsibleColWidthOverride : undefined,
                    calDaysColWidthOverride: n.type === 'gantt' ? n.calDaysColWidthOverride : undefined,
                    // Раунд 133 - колонка "Раздел"
                    showSectionColumn: n.type === 'gantt' ? n.showSectionColumn : undefined,
                    sectionColWidthOverride: n.type === 'gantt' ? n.sectionColWidthOverride : undefined,
                    // Раунд 109 - пользовательские цвета ответственных/групп
                    responsibleColors: n.type === 'gantt' && n.responsibleColors ? { ...n.responsibleColors } : undefined,
                    groupColors: n.type === 'gantt' && n.groupColors ? { ...n.groupColors } : undefined,
                    // Раунд 115 (чек-лист, раздел 4) - ручные добавления/удаления строк
                    manualTasks: n.type === 'gantt' && n.manualTasks?.length ? n.manualTasks.map(t => ({ ...t })) : undefined,
                    // Раунд 146 - строки, превращённые в разделы
                    promotedSectionKeys: n.type === 'gantt' && n.promotedSectionKeys?.size ? [...n.promotedSectionKeys] : undefined,
                    deletedTaskKeys: n.type === 'gantt' && n.deletedTaskKeys?.length ? [...n.deletedTaskKeys] : undefined,
                    taskNameOverrides: n.type === 'gantt' && n.taskNameOverrides && Object.keys(n.taskNameOverrides).length ? { ...n.taskNameOverrides } : undefined,
                    // Раунд 136 - ручное редактирование колонки "Раздел"
                    taskSectionOverrides: n.type === 'gantt' && n.taskSectionOverrides && Object.keys(n.taskSectionOverrides).length ? { ...n.taskSectionOverrides } : undefined,
                    // Раунд 137 - связи между задачами
                    dependencies: n.type === 'gantt' && n.dependencies?.length ? n.dependencies.map(d => ({ ...d })) : undefined,
                    collapsedGroups: n.type === 'gantt' && n.collapsedGroups ? { ...n.collapsedGroups } : undefined,
                    // Раунд 130 (иерархия Ганта)
                    collapsedBlocks: n.type === 'gantt' && n.collapsedBlocks && Object.keys(n.collapsedBlocks).length ? { ...n.collapsedBlocks } : undefined,
                    collapsedStages: n.type === 'gantt' && n.collapsedStages && Object.keys(n.collapsedStages).length ? { ...n.collapsedStages } : undefined,
                    rulerScale: n.type === 'gantt' ? n.rulerScale : undefined,
                    showGridLines: n.type === 'gantt' ? n.showGridLines : undefined,
                    // Раунд 144 - подписи дат на полосах
                    showBarDateLabels: n.type === 'gantt' ? n.showBarDateLabels : undefined,
                    deadlineDate: n.type === 'gantt' ? n.deadlineDate : undefined,
                    showYearRow: n.type === 'gantt' ? n.showYearRow : undefined,
                    showMonthRow: n.type === 'gantt' ? n.showMonthRow : undefined,
                    showDayRow: n.type === 'gantt' ? n.showDayRow : undefined,
                    showWeekdayRow: n.type === 'gantt' ? n.showWeekdayRow : undefined,

                    // XlsxImportNode: только УЖЕ импортированный снимок данных -
                    // сырые байты файла НЕ сериализуются (см. докстринг класса,
                    // xlsxImportNode.js) - после загрузки проекта нужно заново
                    // выбрать файл, чтобы сменить лист/столбцы, но сам импорт
                    // переживает сохранение/загрузку как обычные данные ноды
                    // fileName - ОБЩИЙ ключ на XlsxImportNode и ImageNode
                    // (оба "выбор файла", оба хранят его имя) - ОДНА
                    // строка с объединённым условием, а не две отдельные
                    // с одинаковым ключом: JS в object-литерале молча
                    // берёт ПОСЛЕДНЕЕ значение при дублировании ключа -
                    // ровно та ловушка, что уже один раз ловилась на
                    // wrapHeight (см. комментарий у него ниже)
                    fileName: ['xlsxImport', 'image', 'jsonImport'].includes(n.type) ? n.fileName : undefined,
                    selectedSheet: n.type === 'xlsxImport' ? n.selectedSheet : undefined,
                    selectedColumns: n.type === 'xlsxImport' ? [...n.selectedColumns] : undefined,
                    headerRow: n.type === 'xlsxImport' ? n.headerRow : undefined,
                    importedHeaders: n.type === 'xlsxImport' ? [...n.importedHeaders] : undefined,
                    importedRows: n.type === 'xlsxImport' ? n.importedRows.map(r => [...r]) : undefined,
                    // Раунд 114 - см. докстринг this.cellColors в конструкторе
                    cellColors: n.type === 'xlsxImport' && n.cellColors?.length ? n.cellColors.map(r => [...r]) : undefined,
                    // Раунд 134 - см. докстринг this.cellItalics в конструкторе
                    cellItalics: n.type === 'xlsxImport' && n.cellItalics?.length ? n.cellItalics.map(r => [...r]) : undefined,

                    // ImageNode: сама картинка целиком (base64 data URL) -
                    // см. докстринг imageNode.js про то, почему тут (в
                    // отличие от XlsxImportNode) сериализуются именно
                    // сырые данные файла, а не какой-то разобранный результат
                    // (fileName - см. общий ключ выше, у selectedSheet и т.п.)
                    dataUrl: n.type === 'image' ? n.dataUrl : undefined,
                    objectFit: n.type === 'image' ? n.objectFit : undefined,

                    // JsonImportNode: сырой текст файла целиком (тот же
                    // принцип, что у ImageNode.dataUrl выше - см. докстринг
                    // jsonImportNode.js, fileName - общий ключ выше)
                    jsonText: n.type === 'jsonImport' ? n.jsonText : undefined,
                    // Раунд 127 (новый узел "Текст")
                    displayMode: n.type === 'text' ? n.displayMode : undefined,
                    transformTrim: n.type === 'text' ? n.transformTrim : undefined,
                    transformCase: n.type === 'text' ? n.transformCase : undefined,
                    transformReplaceSpecial: n.type === 'text' ? n.transformReplaceSpecial : undefined,
                    fallbackValue: n.type === 'text' ? n.fallbackValue : undefined,

                    // TableInjectNode: операция вставки + номер строки
                    operation: ['tableInject', 'tableRemove', 'booleanOp'].includes(n.type) ? n.operation : undefined,
                    rowIndex: (n.type === 'tableInject' || n.type === 'tableRemove') ? n.rowIndex : undefined,
                    // TableRemoveNode: доп. параметры для режимов "Диапазон"/"Первые N"/"Последние N"
                    rangeStart: n.type === 'tableRemove' ? n.rangeStart : undefined,
                    rangeEnd: n.type === 'tableRemove' ? n.rangeEnd : undefined,
                    count: n.type === 'tableRemove' ? n.count : undefined,
                    // Раунд 90 - единый columnStyles[] теперь и у обычных
                    // табличных нод (не только у Format-посредников) -
                    // см. докстринг this.columnStyles в конструкторах.
                    columnStyles: ['tableFormat', 'treeFormat', 'table'].includes(n.type) && n.columnStyles
                        ? n.columnStyles.map(s => ({ ...s }))
                        : undefined,

                    // TreeToTableNode: компоновка развёртки + глубина
                    // (Раунд 70) - см. докстринг treeToTableNode.js
                    layoutMode: n.type === 'treeToTable' ? n.layoutMode : undefined,
                    maxDepth: n.type === 'treeToTable' ? n.maxDepth : undefined,

                    // CalendarNode: введённые вручную дни/диапазоны
                    // (Раунд 73, переработано в Раунде 74 - см.
                    // докстринг calendarNode.js) - без entries правки
                    // терялись бы при каждой перезагрузке проекта
                    entries: n.type === 'calendar' && Array.isArray(n.entries)
                        ? n.entries.map(e => ({ type: e.type, date: e.date, dateTo: e.dateTo }))
                        : undefined,
                    viewYear: n.type === 'calendar' ? n.viewYear : undefined,
                    viewMonth: n.type === 'calendar' ? n.viewMonth : undefined,
                    selectionMode: n.type === 'calendar' ? n.selectionMode : undefined,
                    excludedDates: n.type === 'calendar' && n.excludedDates ? [...n.excludedDates] : undefined,
                    dataStartRowOverride: n.type === 'ganttTableProcessor' ? n.dataStartRowOverride : undefined,
                    colorRoles: n.type === 'ganttTableProcessor' && n.colorRoles ? { ...n.colorRoles } : undefined,

                    // TableMergeColumnsNode: какие столбцы объединяем, как, куда
                    sourceColumns: n.type === 'tableMergeColumns' ? [...n.sourceColumns] : undefined,
                    mergeOperation: n.type === 'tableMergeColumns' ? n.operation : undefined,
                    separator: n.type === 'tableMergeColumns' ? n.separator : undefined,
                    targetPosition: n.type === 'tableMergeColumns' ? n.targetPosition : undefined,
                    resultHeader: n.type === 'tableMergeColumns' ? n.resultHeader : undefined,

                    // TableJoinNode: ключевые столбцы А/Б + операция агрегации
                    keyColumnA: n.type === 'tableJoin' ? n.keyColumnA : undefined,
                    keyColumnB: n.type === 'tableJoin' ? n.keyColumnB : undefined,
                    // Раунд 46: агрегация переехала с одной глобальной на
                    // отдельную по каждому столбцу Б + возможность убрать
                    // столбец из результата (А и Б) - см. докстринг
                    // tableJoinNode.js про columnConfigA/columnConfigB
                    columnConfigA: n.type === 'tableJoin' && n.columnConfigA
                        ? n.columnConfigA.map(c => ({ ...c }))
                        : undefined,
                    columnConfigB: n.type === 'tableJoin' && n.columnConfigB
                        ? n.columnConfigB.map(c => ({ ...c }))
                        : undefined,

                    // TableFilterNode: условие на каждый столбец (см. докстринг
                    // tableFilterNode.js - список значений или сравнение)
                    columnFilters: n.type === 'tableFilter' && n.columnFilters
                        ? [...n.columnFilters]
                        : undefined,

                    // TableUniqueNode: ключевой столбец + include/агрегация
                    // по каждому остальному столбцу - см. докстринг
                    // tableUniqueNode.js
                    keyColumn: n.type === 'tableUnique' ? n.keyColumn : undefined,
                    columnConfig: n.type === 'tableUnique' && n.columnConfig
                        ? n.columnConfig.map(c => ({ ...c }))
                        : undefined,

                    // ListConvertNode: режим преобразования + выбранные
                    // столбцы + сигнатура последнего преобразования (чтобы
                    // после загрузки проекта не пересобрать список заново
                    // поверх сохранённых ручных правок при первом же
                    // calculate()) - см. докстринг listConvertNode.js
                    mode: n.type === 'listConvert' ? n.mode : undefined,
                    singleColumn: n.type === 'listConvert' ? n.singleColumn : undefined,
                    pairNameColumn: n.type === 'listConvert' ? n.pairNameColumn : undefined,
                    pairValueColumn: n.type === 'listConvert' ? n.pairValueColumn : undefined,
                    dataFormat: n.type === 'listConvert' ? n.dataFormat : undefined,
                    _lastConversionSignature: n.type === 'listConvert' ? n._lastConversionSignature : undefined,

                    // TreeNode: имена веток (по индексу входа) + агрегация
                    // по каждому совпавшему полю (по имени заголовка) -
                    // см. докстринг treeNode.js
                    branchNames: n.type === 'tree' && n.branchNames
                        ? { ...n.branchNames }
                        : undefined,
                    columnAggregation: n.type === 'tree' && n.columnAggregation
                        ? { ...n.columnAggregation }
                        : undefined,

                    // TreeViewerNode: какие ветки свёрнуты (путь узла -> false) -
                    // см. докстринг treeViewerNode.js
                    expandedState: n.type === 'treeViewer' && n.expandedState
                        ? { ...n.expandedState }
                        : undefined
                }))
            }))
        };
    }

    // Восстанавливает проект из данных serialize().
    // Счётчики id тоже восстанавливаются, чтобы межлистовые ссылки
    // (layoutInput → layoutOutput по id) оставались валидными и новые
    // ноды не получали конфликтующие id.
    loadFromData(data) {
        if (!data || !Array.isArray(data.layouts) || data.layouts.length === 0) {
            alert('Файл не содержит листов или имеет неверный формат');
            return;
        }

        let maxNodeId = -1;

        this.layouts = data.layouts.map(l => ({
            id: l.id,
            name: l.name,
            connections: (l.connections || []).map(c => ({ ...c })),
            nodes: (l.nodes || []).map(sn => {
                const NodeClass = this.nodeManager.nodeTypes.get(sn.type);
                if (!NodeClass) {
                    console.warn(`Неизвестный тип ноды при загрузке: ${sn.type}`);
                    return null;
                }
                // Конструкторы всех нод читают свои поля из config -
                // передаём сохранённый объект как config целиком
                const node = new NodeClass(sn.id, sn.type, sn.x, sn.y, sn);
                if (sn.width) node.width = sn.width;
                node.collapsed = !!sn.collapsed;
                // ВАЖНО: node.inputs НЕ перезаписываем сохранённым sn.inputs -
                // конструктор каждой ноды уже сам корректно выставляет inputs
                // (константа либо производное от inputSockets.length/config).
                // Перезапись устаревшим числом ломает файлы, сохранённые
                // ДО изменения схемы конкретной ноды (например, у
                // PercentageNode было 1 вход, стало 2 - старый .ncp принёс
                // бы inputs:1 и рассинхронизировал бы его с inputSockets).
                maxNodeId = Math.max(maxNodeId, sn.id);
                return node;
            }).filter(Boolean)
        }));

        this.layoutIdCounter = data.layoutIdCounter
            ?? Math.max(...this.layouts.map(l => l.id)) + 1;
        this.nodeManager.nodeIdCounter = data.nodeIdCounter ?? maxNodeId + 1;

        const activeId = this.layouts.some(l => l.id === data.activeLayoutId)
            ? data.activeLayoutId
            : this.layouts[0].id;

        // ВАЖНО: сбрасываем activeLayoutId перед loadLayout, иначе
        // saveActiveState() внутри loadLayout запишет СТАРЫЕ ноды
        // в свежезагруженный лист при совпадении id
        this.activeLayoutId = null;
        this.loadLayout(activeId);
    }

    // ============================================
    // МЕЖЛИСТОВЫЕ ССЫЛКИ
    // ============================================

    // Список выходов (нод LayoutOutput) конкретного листа - для выпадающего списка в LayoutInput
    getOutputsForLayout(layoutId) {
        const layout = this.getLayout(layoutId);
        if (!layout) return [];
        return layout.nodes
            .filter(n => n.type === 'layoutOutput')
            .map(n => ({ id: n.id, name: n.getDisplayName(), value: n.value }));
    }

    // Получить инстанс ноды-выхода по id листа + id ноды (независимо от того, активен ли этот лист)
    getOutputNode(layoutId, nodeId) {
        const layout = this.getLayout(layoutId);
        if (!layout) return null;
        return layout.nodes.find(n => n.id === nodeId && n.type === 'layoutOutput') || null;
    }

    // Найти ноду по id ПО ВСЕМ Листам, не только по активному - нужно
    // Доскам (boardManager.selectWidget()): нода "Дашборд", создавшая
    // виджет, может жить на любом Листе, а не обязательно на том,
    // который сейчас открыт.
    findNodeAnywhere(nodeId) {
        for (const layout of this.layouts) {
            const node = layout.nodes.find(n => n.id === nodeId);
            if (node) return node;
        }
        return null;
    }

    // ============================================
    // РЕНДЕР ВКЛАДОК
    // ============================================

    renderTabs() {
        const tabsContainer = document.getElementById('layoutTabs');
        if (!tabsContainer) return;
        tabsContainer.innerHTML = '';

        this.layouts.forEach(layout => {
            const tab = document.createElement('div');
            // "active" только если этот лист и правда сейчас на экране -
            // одного совпадения id с activeLayoutId недостаточно, пока
            // видом владеет Доска (см. viewActive)
            const isActive = layout.id === this.activeLayoutId && this.viewActive;
            tab.className = 'layout-tab' + (isActive ? ' active' : '');
            tab.dataset.layoutId = layout.id;

            const label = document.createElement('span');
            label.className = 'layout-tab-name';
            label.textContent = layout.name;
            tab.appendChild(label);

            const closeBtn = document.createElement('span');
            closeBtn.className = 'layout-tab-close';
            closeBtn.textContent = '✕';
            closeBtn.title = 'Удалить лист';
            closeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.deleteLayout(layout.id);
            });
            tab.appendChild(closeBtn);

            tab.addEventListener('click', () => {
                // Переключаем, если это другой лист ИЛИ этот же лист
                // формально "активен", но сейчас закрыт видом Доски
                if (layout.id !== this.activeLayoutId || !this.viewActive) {
                    this.loadLayout(layout.id);
                }
            });

            tab.addEventListener('dblclick', (e) => {
                e.stopPropagation();
                // Редактируем только активную (реально видимую) вкладку: по
                // неактивной первый клик переключает лист и пересоздаёт DOM
                // вкладок, поэтому dblclick до старого элемента просто не доходит
                if (!isActive) return;
                this.startRenameTab(layout, tab, label);
            });

            tabsContainer.appendChild(tab);
        });

        this._appendAddButton(tabsContainer);
    }

    // Инлайн-переименование вкладки.
    // window.prompt() в Electron НЕ поддерживается (молча падает),
    // поэтому редактируем имя прямо во вкладке.
    startRenameTab(layout, tab, label) {
        if (tab.querySelector('input')) return; // уже редактируется

        const input = document.createElement('input');
        input.type = 'text';
        input.value = layout.name;
        input.className = 'layout-tab-rename-input';
        input.addEventListener('mousedown', (e) => e.stopPropagation());
        input.addEventListener('click', (e) => e.stopPropagation());

        label.style.display = 'none';
        tab.insertBefore(input, label);
        input.focus();
        input.select();

        const finish = (save) => {
            if (save && input.value.trim()) {
                this.renameLayout(layout.id, input.value.trim());
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
        addBtn.title = 'Добавить лист';
        addBtn.addEventListener('click', () => this.addLayout());
        tabsContainer.appendChild(addBtn);
    }
}
