import { Helpers } from '../utils/helpers.js';

export class NodeManager {
    constructor() {
        this.nodes = [];
        this.nodeIdCounter = 0;
        this.nodeTypes = new Map();
        this.selectedNode = null;
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
    // Пользователь задаёт только ширину; высоту нода определяет сама.
    startResize(e, node) {
        const el = document.querySelector(`[data-node-id="${node.id}"]`);
        if (!el) return;
        this.isResizing = true;
        this.resizingNode = node;
        this.resizeStartX = e.clientX;
        this.resizeStartWidth = el.offsetWidth;
    }

    updateResize(e) {
        if (!this.isResizing || !this.resizingNode) return;
        
        const el = document.querySelector(`[data-node-id="${this.resizingNode.id}"]`);
        if (!el) return;
        
        // Учитываем масштаб, иначе при zoom ≠ 100% ширина
        // "убегает" от курсора
        const zoom = window.getZoomLevel ? window.getZoomLevel() : 1;
        const deltaX = (e.clientX - this.resizeStartX) / zoom;
        
        // Минимальная ширина 200px
        const newWidth = Math.max(200, this.resizeStartWidth + deltaX);
        
        el.style.width = newWidth + 'px';
        el.style.height = 'auto';
        
        // Сохраняем только ширину
        this.resizingNode.width = newWidth;
        
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
        } else if (node.type === 'percentage') {
            // Для процентного узла устанавливаем разумную ширину по умолчанию
            el.style.width = '320px';
            node.width = 320;
        }
        
        // Создаем содержимое ноды
        const content = node.render();
        el.appendChild(content);
        
        container.appendChild(el);
        
        // Ручка изменения ширины (правый нижний угол)
        const resizeHandle = document.createElement('div');
        resizeHandle.className = 'node-resize-handle';
        resizeHandle.title = 'Изменить ширину';
        el.appendChild(resizeHandle);
        resizeHandle.addEventListener('mousedown', (e) => {
            e.stopPropagation();
            e.preventDefault();
            this.startResize(e, node);
        });
        
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
            if (e.target.closest('.title-input')) return;
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
    
    deleteNode() {
        if (this.contextMenuTarget === null) return;
        const id = this.contextMenuTarget;
        const el = document.querySelector(`[data-node-id="${id}"]`);
        if (el) el.remove();
        this.nodes = this.nodes.filter(n => n.id !== id);
        
        // Удаляем соединения
        if (window.connectionManager) {
            const connections = window.connectionManager.getConnections();
            window.connectionManager.connections = connections.filter(c => 
                c.sourceNodeId !== id && c.targetNodeId !== id
            );
            if (window.renderer) {
                window.renderer.drawAllConnections(window.connectionManager.connections);
            }
        }
        
        document.getElementById('contextMenu').style.display = 'none';
        this.contextMenuTarget = null;
        
        document.getElementById('status').textContent = '🗑️ Нода удалена';
        setTimeout(() => {
            document.getElementById('status').textContent = 'Готово';
        }, 1500);
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
        
        document.getElementById('status').textContent = '✅ Вычислено';
        setTimeout(() => {
            document.getElementById('status').textContent = 'Готово';
        }, 2000);
    }
    
    clearAll() {
        // Удаляем все элементы нод
        document.querySelectorAll('.node').forEach(el => el.remove());
        this.nodes = [];
        // ВАЖНО: nodeIdCounter НЕ сбрасываем в 0.
        // Id нод должны быть уникальны глобально (между всеми листами/layouts),
        // т.к. ноды "Вход листа" ссылаются на ноды "Выход листа" другого листа по id.
    }
}
