import { Helpers } from '../utils/helpers.js';

export class ConnectionManager {
    constructor() {
        this.connections = [];
        this.tempLine = null;
        this.tempStart = null;
        this.isConnecting = false;
        this.connectionStart = null;
    }
    
    addConnection(sourceId, targetId, targetSocket, sourceSocket = 0) {
        const existing = this.connections.find(c => 
            c.targetNodeId === targetId && 
            c.targetSocket === targetSocket
        );
        
        if (existing) {
            console.warn('⚠️ Вход уже занят');
            return false;
        }
        
        this.connections.push({
            sourceNodeId: sourceId,
            targetNodeId: targetId,
            targetSocket: targetSocket,
            sourceSocket: sourceSocket // Сохраняем индекс выходного сокета
        });
        
        if (window.renderer) {
            window.renderer.drawAllConnections(this.connections);
        }

        const targetNode = window.nodeManager?.getNode(targetId);
        if (targetNode && targetNode.checkAndAddEmptySlot) {
            setTimeout(() => targetNode.checkAndAddEmptySlot(), 50);
        }
        
        return true;
    }
    
    removeConnection(sourceId, targetId, targetSocket) {
        this.connections = this.connections.filter(c =>
            !(c.sourceNodeId === sourceId && 
              c.targetNodeId === targetId && 
              c.targetSocket === targetSocket)
        );
        
        if (window.renderer) {
            window.renderer.drawAllConnections(this.connections);
        }
    }
    
    removeAllConnectionsForNode(nodeId) {
        this.connections = this.connections.filter(c => 
            c.sourceNodeId !== nodeId && c.targetNodeId !== nodeId
        );
        
        if (window.renderer) {
            window.renderer.drawAllConnections(this.connections);
        }
    }
    
    getNodeConnections(nodeId) {
        return this.connections.filter(c => 
            c.sourceNodeId === nodeId || c.targetNodeId === nodeId
        );
    }
    
    clearAll() {
        this.connections = [];
        
        if (window.renderer) {
            window.renderer.drawAllConnections(this.connections);
        }
    }
    
    getConnections() {
        return this.connections;
    }
    
    // ============================================
    // СОЗДАНИЕ НОВОГО СОЕДИНЕНИЯ (drag из сокета)
    // ============================================
    
    startConnection(e, nodeId, socketType) {
        if (socketType !== 'output') return;
        
        const target = e.target.closest('.socket');
        if (!target) return;
        
        const socketIndex = parseInt(target.dataset.index || 0);
        const isList = target.dataset.isList === 'true';
        const socketKind = Helpers.getSocketKind(target);
        
        const pos = window.renderer?.getSocketPosition(nodeId, 'output', socketIndex);
        if (!pos) return;
        
        // Защита от "призрачных" линий: если предыдущее соединение
        // не было корректно завершено/отменено (например, кнопку мыши
        // отпустили за пределами окна браузера и document-уровневый
        // mouseup не сработал), tempLine мог остаться в DOM навсегда -
        // ссылка на него терялась при перезаписи this.tempLine ниже.
        // Подчищаем и конкретную ссылку, и вообще все .temp-path в SVG.
        if (this.tempLine) {
            this.tempLine.remove();
            this.tempLine = null;
        }
        if (window.renderer?.clearAllTempPaths) {
            window.renderer.clearAllTempPaths();
        }
        
        this.isConnecting = true;
        this.connectionStart = { 
            nodeId, 
            socketType,
            socketIndex: socketIndex,
            isList: isList,
            kind: socketKind
        };
        this.tempStart = { x: pos.x, y: pos.y };
        
        if (window.renderer) {
            this.tempLine = window.renderer.createTempPath(pos.x, pos.y, pos.x, pos.y);
        }
        
        document.getElementById('drag-info').classList.add('show');
        document.getElementById('drag-info').textContent = '🔗 Перетащите на вход другой ноды';
    }
    
    updateTempLine(e) {
        if (!this.tempLine || !this.isConnecting || !this.tempStart) return;
        
        const container = document.getElementById('nodesContainer');
        if (!container) return;
        
        // Единственное место, где мы всё ещё читаем getBoundingClientRect -
        // и то только ОДИН раз за курсор мыши (не за каждый сокет),
        // чтобы перевести координаты мыши (viewport) в координаты контейнера.
        // Делим на zoom, т.к. rect уже отражает визуально отмасштабированный размер.
        const rect = container.getBoundingClientRect();
        const scale = window.getZoomLevel ? window.getZoomLevel() : 1;
        const x2 = (e.clientX - rect.left) / scale;
        const y2 = (e.clientY - rect.top) / scale;
        
        if (window.renderer) {
            window.renderer.updatePathD(this.tempLine, this.tempStart.x, this.tempStart.y, x2, y2);
        }
    }
    
    finishConnection(e, nodeManager) {
        if (!this.isConnecting || !this.connectionStart) return;
        
        const target = document.elementFromPoint(e.clientX, e.clientY);
        if (target) {
            const socket = target.closest('.socket');
            if (socket && socket.dataset.socketType === 'input') {
                const sourceId = parseInt(this.connectionStart.nodeId);
                const targetId = parseInt(socket.dataset.nodeId);
                const targetSocket = parseInt(socket.dataset.index || 0);
                const sourceSocket = this.connectionStart.socketIndex || 0;
                
                if (sourceId !== targetId) {
                    // Проверяем совместимость типов сокетов: список только
                    // со списком, строка только со строкой, данные только
                    // с данными; обычное число/count - вместе (bucket 'plain').
                    const rawSourceKind = this.connectionStart.kind || (this.connectionStart.isList ? 'list' : 'plain');
                    const rawTargetKind = Helpers.getSocketKind(socket);
                    // 'count' исторически совместим с обычным числом (это просто
                    // отдельный выход-счётчик, input-сокетов типа count не бывает)
                    const normalize = (k) => (k === 'count' ? 'plain' : k);
                    const sourceKind = normalize(rawSourceKind);
                    const targetKind = normalize(rawTargetKind);
                    const kindLabels = {
                        list: 'LIST (список)',
                        string: 'String (строка)',
                        data: 'Data (таблица)',
                        plain: 'числовому'
                    };

                    if (sourceKind !== targetKind) {
                        document.getElementById('status').textContent =
                            `⚠️ Несовместимые сокеты: ${kindLabels[sourceKind] || sourceKind} нельзя подключить к ${kindLabels[targetKind] || targetKind}`;
                        setTimeout(() => {
                            document.getElementById('status').textContent = 'Готово';
                        }, 2000);
                        this.cancelConnection();
                        return;
                    }
                    
                    // Проверяем, нет ли уже соединения на этот вход
                    const existing = this.connections.find(c => 
                        c.targetNodeId === targetId && 
                        c.targetSocket === targetSocket
                    );
                    
                    if (!existing) {
                        this.addConnection(sourceId, targetId, targetSocket, sourceSocket);
                        document.getElementById('status').textContent = '🔗 Соединение создано';
                    } else {
                        document.getElementById('status').textContent = '⚠️ Вход уже занят';
                    }
                    
                    setTimeout(() => {
                        document.getElementById('status').textContent = 'Готово';
                    }, 1500);
                }
            }
        }
        
        if (this.tempLine) {
            this.tempLine.remove();
            this.tempLine = null;
        }
        if (window.renderer?.clearAllTempPaths) {
            window.renderer.clearAllTempPaths();
        }
        
        this.isConnecting = false;
        this.connectionStart = null;
        this.tempStart = null;
        document.getElementById('drag-info').classList.remove('show');
        
        if (window.renderer) {
            window.renderer.drawAllConnections(this.connections);
        }
        if (nodeManager) {
            nodeManager.calculateAll();
            if (window.renderer) {
                window.renderer.updateAllDisplays();
            }
        }
    }
    
    cancelConnection() {
        if (this.tempLine) {
            this.tempLine.remove();
            this.tempLine = null;
        }
        if (window.renderer?.clearAllTempPaths) {
            window.renderer.clearAllTempPaths();
        }
        this.isConnecting = false;
        this.connectionStart = null;
        this.tempStart = null;
        document.getElementById('drag-info').classList.remove('show');
    }
}
