export class LayoutManager {
    constructor(nodeManager, connectionManager, renderer) {
        this.nodeManager = nodeManager;
        this.connectionManager = connectionManager;
        this.renderer = renderer;

        this.layouts = [];
        this.layoutIdCounter = 0;
        this.activeLayoutId = null;
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
                    items: n.type === 'listInput' && n.items
                        ? n.items.map(i => ({ name: i.name, value: i.value }))
                        : undefined,
                    // Формат отображения значения (см. BaseNode.getValueFormat) -
                    // необязателен, выставляется явно только теми нодами,
                    // которым это важно
                    valueFormat: n.valueFormat,
                    // TableNode: столбцы (пары LIST+String индексов сокетов
                    // и переопределение формата) + счётчик для новых индексов
                    columns: n.type === 'table' && n.columns
                        ? n.columns.map(c => ({ ...c }))
                        : undefined,
                    _nextIndex: n.type === 'table' ? n._nextIndex : undefined,
                    showRowNumbers: n.type === 'tableViewer' ? n.showRowNumbers : undefined,
                    sortColumnIndex: n.type === 'tableViewer' ? n.sortColumnIndex : undefined,
                    sortDirection: n.type === 'tableViewer' ? n.sortDirection : undefined
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
                if (sn.inputs) node.inputs = sn.inputs;
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

    // ============================================
    // РЕНДЕР ВКЛАДОК
    // ============================================

    renderTabs() {
        const tabsContainer = document.getElementById('layoutTabs');
        if (!tabsContainer) return;
        tabsContainer.innerHTML = '';

        this.layouts.forEach(layout => {
            const tab = document.createElement('div');
            tab.className = 'layout-tab' + (layout.id === this.activeLayoutId ? ' active' : '');
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
                if (layout.id !== this.activeLayoutId) {
                    this.loadLayout(layout.id);
                }
            });

            tab.addEventListener('dblclick', (e) => {
                e.stopPropagation();
                // Редактируем только активную вкладку: по неактивной первый
                // клик переключает лист и пересоздаёт DOM вкладок, поэтому
                // dblclick до старого элемента просто не доходит
                if (layout.id !== this.activeLayoutId) return;
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
