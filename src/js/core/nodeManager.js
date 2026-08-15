/**
 * SPDX-License-Identifier: MIT
 * SPDX-FileCopyrightText: 2024 NodeCalculate Team
 * SPDX-FileCopyrightText: 2024 Pavel Fomin
 *
 * @file    nodeManager.js
 * @brief   Создание, рендер, удаление, перетаскивание и изменение размера нод
 * @author  Pavel Fomin
 * @version 1.8.69
 * @see     https://github.com/GhostPWLk1n/NodeCalculator.git
 */

import { Helpers } from '../utils/helpers.js';

export class NodeManager {
    constructor() {
        this.nodes = [];
        this.nodeIdCounter = 0;
        this.nodeTypes = new Map();
        this.selectedNode = null;
        // Множественное выделение рамкой (Раунд 58, план 1.6.0 п.3) -
        // ОТДЕЛЬНО от selectedNode (тот открывает панель инспектора для
        // ОДНОЙ ноды - множественное выделение специально НЕ открывает
        // панель, это про групповое ПЕРЕМЕЩЕНИЕ, не про редактирование
        // настроек сразу нескольких разнотипных нод, для этого нет
        // общей схемы полей). См. selectMultipleNodes()/clearMultiSelection().
        this.multiSelectedIds = new Set();
        // Стартовые позиции ВСЕХ выделенных нод в момент начала
        // перетаскивания - см. startDragNode()/main.js mousemove
        this.dragGroupStart = null;
        this.contextMenuTarget = null;
        this.isDragging = false;
        this.draggedNode = null;
        this.dragOffsetX = 0;
        this.dragOffsetY = 0;
    }
    
    registerNodeType(type, nodeClass) {
        this.nodeTypes.set(type, nodeClass);
    }
    
    addNode(type, x, y, config = {}) {
        const NodeClass = this.nodeTypes.get(type);
        if (!NodeClass) {
            console.error(`Unknown node type: ${type}`);
            return null;
        }
        
        const id = this.nodeIdCounter++;
        const node = new NodeClass(id, type, x, y, config);
        this.nodes.push(node);
        
        // Рендерим ноду
        this.renderNode(node);
        
        console.log(`✅ Нода создана: ${type} (ID: ${id})`);
        return node;
    }

    // Начало растягивания ноды за ручку в правом нижнем углу.
    // По умолчанию пользователь задаёт только ширину; высоту нода
    // определяет сама (см. docs/NODE_API.md). Ноды, которым нужна
    // свобода и по вертикали (например, TableViewerNode - высота видимой
    // части таблицы), реализуют beginFreeResize()/applyFreeResize() -
    // тогда та же самая ручка тянет и высоту тоже, в обход общего правила.
    startResize(e, node) {
        const el = document.querySelector(`[data-node-id="${node.id}"]`);
        if (!el) return;
        this.isResizing = true;
        this.resizingNode = node;
        this.resizeStartX = e.clientX;
        this.resizeStartY = e.clientY;
        this.resizeStartWidth = el.offsetWidth;
        if (typeof node.beginFreeResize === 'function') {
            node.beginFreeResize(el);
        }
    }

    updateResize(e) {
        if (!this.isResizing || !this.resizingNode) return;
        
        const el = document.querySelector(`[data-node-id="${this.resizingNode.id}"]`);
        if (!el) return;
        
        // Учитываем масштаб, иначе при zoom ≠ 100% ширина
        // "убегает" от курсора
        const zoom = window.getZoomLevel ? window.getZoomLevel() : 1;
        const deltaX = (e.clientX - this.resizeStartX) / zoom;
        
        // Минимальная ширина - индивидуальная для типа ноды
        // (this.minWidth, Раунд 106, чек-лист раздел 2), иначе общий
        // дефолт 200px.
        const minWidth = this.resizingNode.minWidth || 200;
        const newWidth = Math.max(minWidth, this.resizeStartWidth + deltaX);
        
        el.style.width = newWidth + 'px';
        
        // Сохраняем только ширину
        this.resizingNode.width = newWidth;
        
        if (typeof this.resizingNode.applyFreeResize === 'function') {
            // Нода сама решает, куда девать дополнительную высоту (см.
            // tableViewerNode.js) - nodeManager не лезет в её внутреннюю
            // структуру, просто передаёт дельту движения мыши по Y.
            const deltaY = (e.clientY - this.resizeStartY) / zoom;
            this.resizingNode.applyFreeResize(el, deltaY);
        } else {
            el.style.height = 'auto';
        }
        
        // Если это PercentageNode - обновляем легенду
        if (this.resizingNode.type === 'percentage' && this.resizingNode.updateLegendAdaptive) {
            this.resizingNode.updateLegendAdaptive();
        }
        
        // Обновляем соединения
        if (window.renderer) {
            window.renderer.drawAllConnections(window.connectionManager?.getConnections() || []);
        }
    }

    endResize() {
        this.isResizing = false;
        this.resizingNode = null;
    }
    
    renderNode(node) {
        const container = document.getElementById('nodesContainer');
        if (!container) {
            console.error('nodesContainer not found!');
            return;
        }
        
        // Проверяем, существует ли нода в менеджере
        const existingNode = this.getNode(node.id);
        if (!existingNode) {
            console.error(`Node ${node.id} not found in manager!`);
            return;
        }

        // Удаляем старую ноду если есть
        const oldEl = container.querySelector(`[data-node-id="${node.id}"]`);
        if (oldEl) oldEl.remove();
        
        const el = document.createElement('div');
        el.className = 'node';
        if (node.type === 'number') {
            el.classList.add('number-node-compact');
        }
        if (node.type === 'string') {
            el.classList.add('string-node-compact');
        }
        if (node.type === 'boolean') {
            el.classList.add('boolean-node-compact');
        }
        if (node.type === 'proxy') {
            el.classList.add('proxy-node-compact');
        }
        if (node.collapsed) {
            el.classList.add('collapsed');
        }
        el.dataset.nodeId = node.id;
        
        // Устанавливаем позицию
        el.style.left = node.x + 'px';
        el.style.top = node.y + 'px';
        
        // Устанавливаем ширину, если она сохранена
        if (node.width) {
            el.style.width = node.width + 'px';
        }
        
        // Создаем содержимое ноды
        const content = node.render();
        el.appendChild(content);
        
        container.appendChild(el);
        
        // Акцентный цвет ноды (боковая панель, InspectorManager) - если задан
        this.applyNodeColor(node, el);
        
        // Плашка-бейдж (error/warning/beta/deprecated/info) - сразу при
        // создании, чтобы статические бейджи (например, "beta" у совсем
        // новых нод) были видны с первого рендера, а не только после
        // первого пересчёта графа (renderer.updateAllDisplays() досинхронизирует
        // её дальше при каждом пересчёте, в том числе динамические бейджи)
        if (window.renderer?.syncNodeBadge) {
            window.renderer.syncNodeBadge(node, el);
        }
        
        // Ручка изменения размера (правый нижний угол). По умолчанию -
        // только ширина; если нода реализует applyFreeResize() (см.
        // tableViewerNode.js), та же самая ручка тянет и высоту тоже -
        // единственная точка ресайза для такой ноды, без отдельного
        // внутреннего хэндла, который раньше дублировал эту же ручку.
        // "Точка" (proxy) ручку вообще не получает - у неё нет ни
        // ширины, ни высоты, которые имело бы смысл тянуть (см.
        // proxyNode.js - минимальный render() без .node-content).
        if (node.type !== 'proxy') {
            const supportsFreeResize = typeof node.applyFreeResize === 'function';
            const resizeHandle = document.createElement('div');
            resizeHandle.className = supportsFreeResize ? 'node-resize-handle free-resize' : 'node-resize-handle';
            resizeHandle.title = supportsFreeResize ? 'Изменить размер' : 'Изменить ширину';
            el.appendChild(resizeHandle);
            resizeHandle.addEventListener('mousedown', (e) => {
                e.stopPropagation();
                e.preventDefault();
                this.startResize(e, node);
            });
        }
        
        // Настраиваем обработчики событий
        this.setupNodeEventHandlers(node, el);
        
        // Обновляем соединения
        if (window.renderer) {
            window.renderer.drawAllConnections(window.connectionManager?.getConnections() || []);
        }
        
        return el;
    }
    
    setupNodeEventHandlers(node, el) {
        // Перетаскивание
        el.addEventListener('mousedown', (e) => {
            // Выбор ноды (боковая панель) - срабатывает на любой клик по
            // ноде, включая клики по её внутренним контролам, не только
            // по "пустому" месту, которое запускает перетаскивание.
            this.selectNode(node);
            
            if (e.target.closest('.socket')) return;
            if (e.target.closest('input')) return;
            if (e.target.closest('button')) return;
            if (e.target.closest('select')) return;
            // ВАЖНО: раньше исключался клик по ВСЕМУ .node-title, из-за чего
            // свёрнутую ноду (где виден только заголовок) нельзя было
            // перетащить вообще. Теперь исключаем только конкретные
            // интерактивные элементы заголовка, а по "пустому" месту
            // заголовка (в т.ч. у свёрнутой ноды) можно тащить ноду.
            if (e.target.closest('.collapse-icon')) return;
            if (e.target.closest('.title-text')) return;
            if (e.target.closest('.edit-icon')) return;
            if (e.target.closest('.fullscreen-icon')) return;
            if (e.target.closest('.title-input')) return;
            // Раунд 190 (по запросу Mr.D: "разворачивание нод на весь
            // экран") - обработчик навешен ПРЯМО на сам DOM-элемент
            // (не делегирован через #nodesContainer) - остаётся
            // физически привязан к узлу, даже когда тот временно
            // перемещён в полноэкранный оверлей (см.
            // window.expandNodeFullscreen() в main.js) - без этой
            // проверки startDragNode() считал бы координаты
            // относительно холста, которого узел сейчас физически не
            // касается, что дало бы бессмысленный "прыжок" при
            // возврате на Лист.
            if (e.target.closest('.node-fullscreen-content')) return;
            this.startDragNode(e, node.id);
        });
        
        // Контекстное меню
        el.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.selectedNode = node;
            this.contextMenuTarget = node.id;
            this.showContextMenu(e.clientX, e.clientY);
        });
        
        // Обработчики для сокетов
        el.querySelectorAll('.socket').forEach(socket => {
            socket.addEventListener('mousedown', (e) => {
                e.stopPropagation();
                e.preventDefault();
                if (window.connectionManager) {
                    window.connectionManager.startConnection(e, node.id, socket.dataset.socketType);
                }
            });
        });
    }
    
    getNode(id) {
        return this.nodes.find(n => n.id === id);
    }

    // Раунд 84 - читает данные ИМЕННО с того выходного сокета источника,
    // к которому идёт соединение (conn.sourceSocket), а не просто
    // node.tableData/node.value напрямую - см. подробный докстринг
    // BaseNode.getOutputBySocket() про то, зачем это понадобилось
    // (декоративные, неразличимые для потребителя выходы у существующих
    // многовыходных нод). Пока подключено ТОЛЬКО в нескольких основных
    // потребителях (TableViewerNode, GanttNode, ExportXlsxNode,
    // ExportJsonNode) - остальные ноды по-прежнему читают node.tableData
    // и т.п. напрямую, это ПОСТЕПЕННАЯ миграция, не одномоментная -
    // прямое чтение безопасно и для многовыходных нод тоже (просто не
    // различает сокеты, как и раньше).
    getSourceOutput(conn) {
        if (!conn) return null;
        const src = this.getNode(conn.sourceNodeId);
        if (!src) return null;
        return src.getOutputBySocket(conn.sourceSocket || 0);
    }

    // === Боковая панель (InspectorManager): выбор ноды кликом ===

    selectNode(node) {
        if (this.selectedNode && this.selectedNode.id !== node.id) {
            const prevEl = document.querySelector(`[data-node-id="${this.selectedNode.id}"]`);
            if (prevEl) prevEl.classList.remove('inspector-selected');
        }
        this.selectedNode = node;
        const el = document.querySelector(`[data-node-id="${node.id}"]`);
        if (el) el.classList.add('inspector-selected');
        if (window.inspectorManager) {
            window.inspectorManager.open(node);
        }
    }

    deselectNode() {
        if (this.selectedNode) {
            const el = document.querySelector(`[data-node-id="${this.selectedNode.id}"]`);
            if (el) el.classList.remove('inspector-selected');
        }
        this.selectedNode = null;
        if (window.inspectorManager) {
            window.inspectorManager.close();
        }
    }

    // Применяет результат рамочного выделения (Раунд 58) - заменяет
    // ТЕКУЩЕЕ множественное выделение целиком (не добавляет к нему -
    // Shift/Ctrl-модификаторы "добавить к выделению" осознанно не
    // реализованы в этом раунде, см. "Заметки на будущее").
    selectMultipleNodes(nodeIds) {
        this.clearMultiSelection();
        nodeIds.forEach(id => {
            this.multiSelectedIds.add(id);
            const el = document.querySelector(`[data-node-id="${id}"]`);
            if (el) el.classList.add('multi-selected');
        });
    }

    clearMultiSelection() {
        this.multiSelectedIds.forEach(id => {
            const el = document.querySelector(`[data-node-id="${id}"]`);
            if (el) el.classList.remove('multi-selected');
        });
        this.multiSelectedIds.clear();
    }

    // Акцентный цвет ноды (--node-accent + класс has-custom-color) -
    // задаётся из боковой панели, null означает "цвет темы по умолчанию".
    // Вызывается и при первом рендере ноды, и при каждом изменении из панели.
    applyNodeColor(node, el) {
        if (!el) return;
        if (node.color) {
            el.style.setProperty('--node-accent', node.color);
            el.classList.add('has-custom-color');
        } else {
            el.style.removeProperty('--node-accent');
            el.classList.remove('has-custom-color');
        }
    }
    
    // Общая логика удаления ОДНОЙ ноды по id - вынесена из deleteNode()
    // (Раунд 64), чтобы её же переиспользовать для удаления по клавише
    // Delete (см. deleteSelectedNodes() ниже) - без специфики контекстного
    // меню (та осталась только в самом deleteNode()).
    deleteNodeById(id) {
        const el = document.querySelector(`[data-node-id="${id}"]`);
        if (el) el.remove();
        this.nodes = this.nodes.filter(n => n.id !== id);

        if (this.selectedNode && this.selectedNode.id === id) {
            this.selectedNode = null;
            if (window.inspectorManager) {
                window.inspectorManager.close();
            }
        }
        this.multiSelectedIds.delete(id);

        if (window.connectionManager) {
            const connections = window.connectionManager.getConnections();
            window.connectionManager.connections = connections.filter(c =>
                c.sourceNodeId !== id && c.targetNodeId !== id
            );
        }

        // Багфикс 1.6.1: если удаляемая нода была нодой "Дашборд" (id
        // виджета на Доске = id ноды "Дашборд"), её виджет должен
        // исчезнуть с Доски вместе с ней. Раньше unregisterWidgetEverywhere()
        // вызывался ТОЛЬКО изнутри DashboardNode.calculate() - а удалённая
        // нода больше никогда не пересчитывается, поэтому виджет оставался
        // на Доске навсегда, застыв с последним посчитанным значением
        // ("осиротевший" виджет - выглядело как баг проброса данных).
        // Для любого другого типа ноды это безопасный no-op:
        // unregisterWidgetEverywhere() на отсутствующий ключ просто
        // ничего не находит.
        if (window.boardManager) {
            window.boardManager.unregisterWidgetEverywhere(id);
        }
    }

    deleteNode() {
        if (this.contextMenuTarget === null) return;
        const id = this.contextMenuTarget;
        this.deleteNodeById(id);

        if (window.renderer) {
            window.renderer.drawAllConnections(window.connectionManager?.getConnections() || []);
        }
        if (window.nodeManager) window.nodeManager.calculateAll();

        document.getElementById('contextMenu').style.display = 'none';
        this.contextMenuTarget = null;
        
        document.getElementById('status').textContent = '🗑️ Нода удалена';
        setTimeout(() => {
            document.getElementById('status').textContent = 'Готово';
        }, 1500);
    }

    // Удаление по клавише Delete (Раунд 64) - множественное выделение
    // рамкой (см. selectMultipleNodes(), Раунд 58) имеет приоритет: если
    // выделено несколько нод - удаляются ВСЕ разом; иначе - обычная
    // одна выбранная нода (this.selectedNode, панель инспектора).
    deleteSelectedNodes() {
        const idsToDelete = this.multiSelectedIds.size > 0
            ? [...this.multiSelectedIds]
            : (this.selectedNode ? [this.selectedNode.id] : []);

        if (idsToDelete.length === 0) return;

        idsToDelete.forEach(id => this.deleteNodeById(id));
        this.clearMultiSelection();

        if (window.renderer) {
            window.renderer.drawAllConnections(window.connectionManager?.getConnections() || []);
        }
        this.calculateAll();

        const statusEl = document.getElementById('status');
        if (statusEl) {
            statusEl.textContent = idsToDelete.length > 1
                ? `🗑️ Удалено нод: ${idsToDelete.length}`
                : '🗑️ Нода удалена';
            setTimeout(() => { statusEl.textContent = 'Готово'; }, 1500);
        }
    }
    
    duplicateNode() {
        if (this.contextMenuTarget === null) return;
        const orig = this.getNode(this.contextMenuTarget);
        if (!orig) return;
        const newNode = this.addNode(
            orig.type, 
            orig.x + 30, 
            orig.y + 30,
            { value: orig.value, customName: orig.customName }
        );
        document.getElementById('contextMenu').style.display = 'none';
        this.contextMenuTarget = null;
        return newNode;
    }
    
    startDragNode(e, nodeId) {
        const node = this.getNode(nodeId);
        if (!node) return;
        const el = document.querySelector(`[data-node-id="${nodeId}"]`);
        if (!el) return;
        
        // Переводим координаты курсора в локальные координаты #nodesContainer
        // с учётом масштаба (zoom). window.toContainerCoords определена в main.js.
        const local = window.toContainerCoords
            ? window.toContainerCoords(e.clientX, e.clientY)
            : { x: e.clientX, y: e.clientY };
        
        // Получаем текущую позицию ноды (уже в px, установленные через style.left/top)
        const nodeX = parseFloat(el.style.left) || node.x;
        const nodeY = parseFloat(el.style.top) || node.y;
        
        // Вычисляем смещение (разница между позицией мыши и позицией ноды)
        this.dragOffsetX = local.x - nodeX;
        this.dragOffsetY = local.y - nodeY;
        
        this.draggedNode = node;
        this.isDragging = true;
        el.classList.add('dragging');

        // Групповое перетаскивание (Раунд 58) - если тянем ноду, входящую
        // в текущее рамочное выделение (больше одной ноды в нём),
        // запоминаем стартовые позиции ВСЕХ выделенных нод - на mousemove
        // (main.js) к ним применяется ТА ЖЕ дельта, что и у "ведущей"
        // (напрямую перетаскиваемой) ноды.
        if (this.multiSelectedIds.has(nodeId) && this.multiSelectedIds.size > 1) {
            this.dragGroupStart = { leadX: node.x, leadY: node.y, positions: {} };
            this.multiSelectedIds.forEach(id => {
                const n = this.getNode(id);
                if (n) this.dragGroupStart.positions[id] = { x: n.x, y: n.y };
            });
        } else {
            this.dragGroupStart = null;
        }

        document.getElementById('drag-info').classList.add('show');
        document.getElementById('drag-info').textContent = `🔄 Перемещение ноды ${nodeId}`;
    }

    getNodePosition(nodeId) {
        const el = document.querySelector(`[data-node-id="${nodeId}"]`);
        if (!el) return null;
        const rect = el.getBoundingClientRect();
        const scrollX = window.scrollX || window.pageXOffset;
        const scrollY = window.scrollY || window.pageYOffset;
        return {
            x: rect.left + scrollX,
            y: rect.top + scrollY
        };
    }
    
    showContextMenu(x, y) {
        const menu = document.getElementById('contextMenu');
        menu.style.display = 'block';
        menu.style.left = x + 'px';
        menu.style.top = y + 'px';

        // Контекстное меню НОДЫ - показываем пункты для ноды, прячем
        // "Удалить связь" (тот относится к конкретному ребру графа,
        // выбираемому отдельным правым кликом по самой линии соединения -
        // см. connectionManager.showConnectionContextMenu)
        ['contextMenuToggleCollapse', 'contextMenuDeleteNode', 'contextMenuDuplicate'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.style.display = '';
        });
        const deleteConnItem = document.getElementById('contextMenuDeleteConnection');
        if (deleteConnItem) deleteConnItem.style.display = 'none';

        // Режимы "выбрана нода" и "выбрана связь" взаимоисключающие
        if (window.connectionManager) {
            window.connectionManager.contextMenuTarget = null;
        }

        // Подпись пункта "Свернуть/Развернуть" зависит от текущего
        // состояния конкретной ноды, по которой кликнули правой кнопкой
        const toggleItem = document.getElementById('contextMenuToggleCollapse');
        const node = this.getNode(this.contextMenuTarget);
        if (toggleItem && node) {
            toggleItem.textContent = node.collapsed ? '▸ Развернуть ноду' : '▾ Свернуть ноду';
        }
    }
    
    toggleCollapseSelected() {
        if (this.contextMenuTarget === null) return;
        const node = this.getNode(this.contextMenuTarget);
        if (node && node.toggleCollapse) {
            node.toggleCollapse();
        }
        document.getElementById('contextMenu').style.display = 'none';
        this.contextMenuTarget = null;
    }
    
    calculateAll() {
        // Раунд 184 (по запросу Mr.D: "Контроль изменений -
        // отслеживание dirty-флага (были ли изменения после последнего
        // сохранения)") - calculateAll() - практически ЕДИНАЯ точка,
        // через которую проходит ЛЮБАЯ содержательная правка проекта
        // (добавление/удаление ноды, правка свойства через инспектор,
        // перетаскивание, изменение раздела Диаграммы Ганта и т.п.) -
        // самое надёжное место пометить "проект изменён", не
        // разыскивая и не патчя ДЕСЯТКИ отдельных точек мутации по
        // всему проекту. window.markProjectDirty() (main.js) сама
        // решает, спамить ли IPC дальше (не спамит, если уже грязный).
        if (window.markProjectDirty) window.markProjectDirty();

        // Сначала вычисляем числовые ноды
        this.nodes.forEach(n => {
            if (n.type === 'number') {
                n.updateValueFromInput();
            }
        });
        
        // Вычисляем операционные ноды (несколько проходов для распространения)
        for (let iter = 0; iter < this.nodes.length; iter++) {
            this.nodes.forEach(n => {
                if (n.type !== 'number') {
                    n.calculate(this);
                }
            });
        }
        
        // Обновляем отображение
        if (window.renderer) {
            window.renderer.updateAllDisplays();
        }

        // Багфикс 1.6.1: Доска перерисовывается ОДИН раз здесь, а не
        // изнутри каждого DashboardNode.calculate() на каждый из
        // nodes.length проходов цикла выше. Раньше при N виджетах на
        // Доске и графе из M нод один calculateAll() (то есть одно
        // нажатие клавиши в виджете) вызывал полную пересборку Доски до
        // M×N раз - тот же главный поток, что обрабатывает ввод на
        // Листе, отсюда и тормоза "и на Доске, и на Листе". Данные
        // виджетов (board.widgets) по-прежнему пишутся из
        // DashboardNode.calculate() на каждом проходе (это дёшево -
        // Map.set), но сама перерисовка DOM отложена до этой единственной
        // точки, см. boardManager.flush().
        if (window.boardManager) {
            window.boardManager.flush();
        }

        document.getElementById('status').textContent = '✅ Вычислено';
        setTimeout(() => {
            document.getElementById('status').textContent = 'Готово';
        }, 2000);
    }
    
    clearAll() {
        // Удаляем все элементы нод
        document.querySelectorAll('.node').forEach(el => el.remove());
        this.nodes = [];
        this.selectedNode = null;
        if (window.inspectorManager) {
            window.inspectorManager.close();
        }
        // ВАЖНО: nodeIdCounter НЕ сбрасываем в 0.
        // Id нод должны быть уникальны глобально (между всеми листами/layouts),
        // т.к. ноды "Вход листа" ссылаются на ноды "Выход листа" другого листа по id.
    }
}
