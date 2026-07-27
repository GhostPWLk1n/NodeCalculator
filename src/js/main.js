/**
 * SPDX-License-Identifier: MIT
 * SPDX-FileCopyrightText: 2024 NodeCalculate Team
 * SPDX-FileCopyrightText: 2024 Pavel Fomin
 *
 * @file    main.js
 * @brief   Точка входа рендерера: регистрация типов нод, глобальные window.*-функции, интеграция с Electron
 * @author  Pavel Fomin
 * @version 1.5.0
 * @see     https://github.com/GhostPWLk1n/NodeCalculator.git
 */

// ============================================
// 1. ИМПОРТЫ 
// ============================================

import { NodeManager } from './core/nodeManager.js';
import { ConnectionManager } from './core/connectionManager.js';
import { Renderer } from './core/renderer.js';
import { LayoutManager } from './core/layoutManager.js';
import { BoardManager } from './core/boardManager.js';
import { InspectorManager } from './core/inspectorManager.js';
import { NumberNode } from './nodes/numberNode.js';
import { OperationNode } from './nodes/operationNode.js';
import { PercentageNode } from './nodes/percentageNode.js';
import { ScaleListNode } from './nodes/scaleListNode.js';
import { LayoutInputNode } from './nodes/layoutInputNode.js';
import { LayoutOutputNode } from './nodes/layoutOutputNode.js';
import { ListViewerNode } from './nodes/listViewerNode.js';
import { ListInputNode } from './nodes/listInputNode.js';
import { StringNode } from './nodes/stringNode.js';
import { TableNode } from './nodes/tableNode.js';
import { TableViewerNode } from './nodes/tableViewerNode.js';
import { PercentConvertNode } from './nodes/percentConvertNode.js';
import { GanttNode } from './nodes/ganttNode.js';
import { DashboardNode } from './nodes/dashboardNode.js';
import { ChartNode } from './nodes/chartNode.js';
import { XlsxImportNode } from './nodes/xlsxImportNode.js';
import { TableInjectNode } from './nodes/tableInjectNode.js';
import { TableRemoveNode } from './nodes/tableRemoveNode.js';
import { TableFormatNode } from './nodes/tableFormatNode.js';
import { TableMergeColumnsNode } from './nodes/tableMergeColumnsNode.js';
import { TableJoinNode } from './nodes/tableJoinNode.js';
import { TableFilterNode } from './nodes/tableFilterNode.js';
import { Constants } from './utils/constants.js';

// ============================================
// 2. СОЗДАНИЕ ЭКЗЕМПЛЯРОВ
// ============================================

console.log('🚀 Загрузка приложения...');

// Версия в сайдбаре (.sidebar-version) - единственный источник, см.
// Constants.APP_VERSION (utils/constants.js). Раньше "v1.0" была
// захардкожена прямо в index.html и не обновлялась при релизах.
const sidebarVersionEl = document.getElementById('sidebarVersion');
if (sidebarVersionEl) sidebarVersionEl.textContent = `v${Constants.APP_VERSION}`;

// Переключатель темы (день/ночь), Раунд 40 - см. #themeSwitch в
// index.html. Тема - это НЕ набор CSS-переменных внутри одного файла, а
// два ПОЛНОСТЬЮ отдельных файла (css/styles.css - тёмная, css/day_styles.css -
// светлая, зеркально друг другу селектор-в-селектор) - переключение
// сводится к подмене href у <link id="themeStylesheet">. Сохранённое
// значение уже применено СИНХРОННО в <head> (см. инлайн-скрипт в
// index.html, до этого файла) - здесь только навешиваем обработчик клика
// и держим DOM/localStorage в согласованном состоянии при последующих
// переключениях.
const THEME_STORAGE_KEY = 'nodecalculate-theme';
const themeStylesheetEl = document.getElementById('themeStylesheet');
const themeSwitchEl = document.getElementById('themeSwitch');

function applyTheme(theme) {
    const isLight = theme === 'light';
    document.documentElement.dataset.theme = isLight ? 'light' : 'dark';
    if (themeStylesheetEl) {
        themeStylesheetEl.setAttribute('href', isLight ? 'css/day_styles.css' : 'css/styles.css');
    }
    if (themeSwitchEl) themeSwitchEl.setAttribute('aria-pressed', String(isLight));
    localStorage.setItem(THEME_STORAGE_KEY, isLight ? 'light' : 'dark');
}

themeSwitchEl?.addEventListener('click', () => {
    const current = document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
    applyTheme(current === 'light' ? 'dark' : 'light');
});
// aria-pressed при старте - без пересборки href (уже верный из <head>)
if (themeSwitchEl) {
    themeSwitchEl.setAttribute('aria-pressed', String(document.documentElement.dataset.theme === 'light'));
}

const nodeManager = new NodeManager();
const connectionManager = new ConnectionManager();
const renderer = new Renderer();
const layoutManager = new LayoutManager(nodeManager, connectionManager, renderer);
const boardManager = new BoardManager();
const inspectorManager = new InspectorManager();

// Регистрируем типы нод
nodeManager.registerNodeType('number', NumberNode);
nodeManager.registerNodeType('add', OperationNode);
nodeManager.registerNodeType('subtract', OperationNode);
nodeManager.registerNodeType('multiply', OperationNode);
nodeManager.registerNodeType('divide', OperationNode);
nodeManager.registerNodeType('percentage', PercentageNode);
nodeManager.registerNodeType('scaleList', ScaleListNode);
nodeManager.registerNodeType('layoutInput', LayoutInputNode);
nodeManager.registerNodeType('layoutOutput', LayoutOutputNode);
nodeManager.registerNodeType('listViewer', ListViewerNode);
nodeManager.registerNodeType('listInput', ListInputNode);
nodeManager.registerNodeType('string', StringNode);
nodeManager.registerNodeType('table', TableNode);
nodeManager.registerNodeType('tableViewer', TableViewerNode);
nodeManager.registerNodeType('percentConvert', PercentConvertNode);
nodeManager.registerNodeType('gantt', GanttNode);
nodeManager.registerNodeType('dashboard', DashboardNode);
nodeManager.registerNodeType('chart', ChartNode);
nodeManager.registerNodeType('xlsxImport', XlsxImportNode);
nodeManager.registerNodeType('tableInject', TableInjectNode);
nodeManager.registerNodeType('tableRemove', TableRemoveNode);
nodeManager.registerNodeType('tableFormat', TableFormatNode);
nodeManager.registerNodeType('tableMergeColumns', TableMergeColumnsNode);
nodeManager.registerNodeType('tableJoin', TableJoinNode);
nodeManager.registerNodeType('tableFilter', TableFilterNode);

// Делаем доступными глобально (СРАЗУ после создания)
window.nodeManager = nodeManager;
window.connectionManager = connectionManager;
window.renderer = renderer;
window.layoutManager = layoutManager;
window.boardManager = boardManager;
window.inspectorManager = inspectorManager;

console.log('✅ Менеджеры созданы и зарегистрированы');

// Инициализируем первый лист (Layout)
layoutManager.initFirstLayout('Лист 1');
boardManager.initFirstBoard('Доска 1');

// ============================================
// 3. МАСШТАБИРОВАНИЕ (ZOOM)
// ============================================
// Масштаб применяется через CSS transform: scale() на #nodesContainer.
// SVG-слой соединений лежит ВНУТРИ этого контейнера, поэтому линии
// масштабируются вместе с нодами автоматически и без искажений
// (координаты в renderer.js считаются в "донтрансформенных" единицах
// через offsetLeft/offsetTop, которые transform не затрагивает).

let zoomLevel = 1;
const ZOOM_MIN = 0.4;
const ZOOM_MAX = 2;
const ZOOM_STEP = 0.1;

function applyZoom() {
    const container = document.getElementById('nodesContainer');
    if (container) {
        container.style.transform = `scale(${zoomLevel})`;
        container.style.transformOrigin = '0 0';
    }
    const zoomLabel = document.getElementById('zoomLevel');
    if (zoomLabel) {
        zoomLabel.textContent = Math.round(zoomLevel * 100) + '%';
    }
}

window.getZoomLevel = () => zoomLevel;

window.zoomIn = () => {
    zoomLevel = Math.min(ZOOM_MAX, Math.round((zoomLevel + ZOOM_STEP) * 100) / 100);
    applyZoom();
};

window.zoomOut = () => {
    zoomLevel = Math.max(ZOOM_MIN, Math.round((zoomLevel - ZOOM_STEP) * 100) / 100);
    applyZoom();
};

window.zoomReset = () => {
    zoomLevel = 1;
    applyZoom();
};

// Переводит координаты курсора (viewport) в локальные координаты
// #nodesContainer с учётом текущего масштаба. Используется везде,
// где раньше был разнобой между getBoundingClientRect и style.left/top
// (перетаскивание нод, временная линия соединения).
window.toContainerCoords = (clientX, clientY) => {
    const container = document.getElementById('nodesContainer');
    if (!container) return { x: clientX, y: clientY };
    const rect = container.getBoundingClientRect();
    return {
        x: (clientX - rect.left) / zoomLevel,
        y: (clientY - rect.top) / zoomLevel
    };
};

applyZoom();

// Ctrl + колесо мыши - зум рабочей области (как в Blender/Figma)
document.getElementById('workspace')?.addEventListener('wheel', (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    if (e.deltaY < 0) {
        window.zoomIn();
    } else {
        window.zoomOut();
    }
}, { passive: false });

// ============================================
// 4. ГЛОБАЛЬНЫЕ ФУНКЦИИ 
// ============================================

// --- Основные функции ---
window.addNode = (type, x, y, config = {}) => {
    console.log(`➕ Создание ноды: ${type} (${x}, ${y})`);
    if (!window.nodeManager) {
        console.error('❌ nodeManager не инициализирован');
        return null;
    }
    const node = window.nodeManager.addNode(type, x, y, config);
    if (node && window.renderer) {
        window.renderer.drawAllConnections(window.connectionManager?.getConnections() || []);
    }
    // Обновляем счетчики
    if (window.updateCounters) {
        window.updateCounters();
    }
    return node;
};

window.calculateAll = () => {
    console.log('🔄 Вычисление...');
    if (window.nodeManager) {
        window.nodeManager.calculateAll();
        if (window.renderer) {
            window.renderer.updateAllDisplays();
        }
    }
    document.getElementById('status').textContent = '✅ Вычислено';
    setTimeout(() => {
        document.getElementById('status').textContent = 'Готово';
    }, 2000);
};

window.clearWorkspace = () => {
    if (!confirm('Очистить текущий лист?')) return;
    console.log('🗑️ Очистка рабочей области');
    if (window.nodeManager) window.nodeManager.clearAll();
    if (window.connectionManager) window.connectionManager.clearAll();
    if (window.renderer) window.renderer.clearWorkspace();
    document.getElementById('status').textContent = '🗑️ Очищено';
    
    // Обновляем счетчики
    if (window.updateCounters) {
        window.updateCounters();
    }
    
    setTimeout(() => {
        document.getElementById('status').textContent = 'Готово';
    }, 1500);
};

window.deleteNode = () => {
    console.log('🗑️ Удаление ноды');
    if (window.nodeManager) {
        window.nodeManager.deleteNode();
        if (window.renderer) {
            window.renderer.drawAllConnections(window.connectionManager?.getConnections() || []);
        }
        // Обновляем счетчики
        if (window.updateCounters) {
            window.updateCounters();
        }
    }
};

window.duplicateNode = () => {
    console.log('📋 Дублирование ноды');
    if (window.nodeManager) {
        window.nodeManager.duplicateNode();
        if (window.renderer) {
            window.renderer.drawAllConnections(window.connectionManager?.getConnections() || []);
        }
        // Обновляем счетчики
        if (window.updateCounters) {
            window.updateCounters();
        }
    }
};

window.toggleNodeCollapse = () => {
    console.log('🔽 Переключение свёрнутости ноды');
    if (window.nodeManager) {
        window.nodeManager.toggleCollapseSelected();
    }
};

window.closeInspector = () => {
    if (window.nodeManager) {
        window.nodeManager.deselectNode();
    }
};

// Клик по "пустому" месту холста (не по ноде, не по линии соединения) -
// снимает выбор ноды и закрывает боковую панель. e.target === сам
// контейнер срабатывает именно на пустом месте: клики по нодам ловят их
// собственные обработчики раньше и не всплывают сюда как "пустой" клик
// (SVG-слой соединений имеет pointer-events:none, кроме самих линий).
document.getElementById('nodesContainer')?.addEventListener('mousedown', (e) => {
    if (e.target.id === 'nodesContainer' || e.target.id === 'connectionsSvg') {
        window.nodeManager?.deselectNode();
    }
});

// То же самое для холста Доски: клик мимо виджета (пустое место
// страницы/серый фон вокруг неё) снимает выбор виджета - виджеты сами
// останавливают всплытие клика (boardManager.buildWidgetEl)
document.getElementById('boardCanvasWrap')?.addEventListener('mousedown', (e) => {
    if (!e.target.closest('.board-widget')) {
        window.boardManager?.deselectWidget();
    }
});

// Escape - закрыть боковую панель, не дожидаясь клика мимо
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        window.nodeManager?.deselectNode();
        window.boardManager?.deselectWidget();
    }
});

// ============================================
// DRAG-AND-DROP ДЛЯ НОД ИЗ САЙДБАРА (Раунд 47)
// ============================================
// Клик по .node-item (см. onclick в index.html) по-прежнему создаёт
// ноду в фиксированной точке - drag-and-drop это ДОПОЛНИТЕЛЬНЫЙ способ
// разместить её ровно там, где отпустили мышь, как в большинстве
// нод-редакторов. Тип ноды и (если есть) доп. конфиг читаются из
// data-type/data-config самого .node-item - один и тот же источник
// правды, что и у onclick, дублировать вручную не пришлось.
document.querySelectorAll('.node-item').forEach(item => {
    item.draggable = true;
    item.addEventListener('dragstart', (e) => {
        const type = item.dataset.type;
        if (!type) return;
        e.dataTransfer.effectAllowed = 'copy';
        e.dataTransfer.setData('application/x-nodecalculate-type', type);
        if (item.dataset.config) {
            e.dataTransfer.setData('application/x-nodecalculate-config', item.dataset.config);
        }
    });
});

const nodesContainerEl = document.getElementById('nodesContainer');
nodesContainerEl?.addEventListener('dragover', (e) => {
    // Без preventDefault() браузер по умолчанию ЗАПРЕЩАЕТ drop - это
    // единственная причина этого обработчика, сам по себе он ничего не делает
    if (e.dataTransfer.types.includes('application/x-nodecalculate-type')) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
    }
});
nodesContainerEl?.addEventListener('drop', (e) => {
    const type = e.dataTransfer.getData('application/x-nodecalculate-type');
    if (!type) return;
    e.preventDefault();

    let config = {};
    const configRaw = e.dataTransfer.getData('application/x-nodecalculate-config');
    if (configRaw) {
        try { config = JSON.parse(configRaw); } catch { /* игнорируем битый JSON, создаём с дефолтным конфигом */ }
    }

    // toContainerCoords() уже учитывает текущие зум/скролл #nodesContainer
    // (см. её же определение выше) - ровно то же преобразование, что
    // используется при перетаскивании самих нод по холсту
    const { x, y } = window.toContainerCoords(e.clientX, e.clientY);
    window.addNode(type, x, y, config);
});

window.deleteConnection = () => {
    console.log('🔗 Удаление связи');
    const conn = window.connectionManager?.contextMenuTarget;
    if (window.connectionManager && conn) {
        window.connectionManager.removeConnection(conn.sourceNodeId, conn.targetNodeId, conn.targetSocket);
        window.connectionManager.contextMenuTarget = null;
        if (window.nodeManager) {
            window.nodeManager.calculateAll();
        }
        if (window.renderer) {
            window.renderer.updateAllDisplays();
        }
        // Обновляем счетчики
        if (window.updateCounters) {
            window.updateCounters();
        }
    }
    document.getElementById('contextMenu').style.display = 'none';
    document.getElementById('status').textContent = '🔗 Связь удалена';
    setTimeout(() => {
        document.getElementById('status').textContent = 'Готово';
    }, 1500);
};

// --- Функции для листов (layouts) ---
window.addLayout = () => window.layoutManager?.addLayout();
window.switchLayout = (id) => window.layoutManager?.loadLayout(id);

// --- Функции для Electron ---
window.saveProject = () => {
    if (window.electron) {
        window.electron.saveProject();
    } else {
        console.warn('Electron API не доступен');
    }
};

window.loadProject = () => {
    if (window.electron) {
        window.electron.loadProject();
    } else {
        console.warn('Electron API не доступен');
    }
};

window.exportImage = () => {
    if (window.electron) {
        window.electron.exportImage();
    } else {
        console.warn('Electron API не доступен');
    }
};

console.log('✅ Глобальные функции зарегистрированы');
console.log('  - window.addNode');
console.log('  - window.calculateAll');
console.log('  - window.clearWorkspace');
console.log('  - window.deleteNode');
console.log('  - window.duplicateNode');
console.log('  - window.deleteConnection()');
console.log('  - window.addLayout / window.switchLayout');
console.log('  - window.zoomIn / window.zoomOut / window.zoomReset');

// ============================================
// 5. ИНТЕГРАЦИЯ С ELECTRON
// ============================================

if (window.electron) {
    console.log('🔌 Electron API обнаружен');
    
    // Обработка сохранения проекта:
    // main-процесс просит данные → отправляем сериализованный проект
    window.electron.onGetProjectData(() => {
        const layoutData = window.layoutManager?.serialize() || { layouts: [] };
        const boardData = window.boardManager?.serialize() || { boards: [] };
        window.electron.sendProjectData({ ...layoutData, ...boardData });
    });
    
    // Обработка загрузки проекта:
    // main-процесс прислал распарсенный JSON из файла
    window.electron.onLoadProject((event, data) => {
        try {
            window.layoutManager?.loadFromData(data);
            window.boardManager?.loadFromData(data);
            if (window.updateCounters) window.updateCounters();
        } catch (err) {
            console.error('❌ Ошибка загрузки проекта:', err);
            alert('Не удалось загрузить проект: ' + err.message);
        }
    });
    
    window.electron.statusUpdate((event, message) => {
        document.getElementById('status').textContent = message;
        setTimeout(() => {
            document.getElementById('status').textContent = 'Готово';
        }, 2000);
    });
    
    window.electron.clearAll(() => {
        window.clearWorkspace?.();
    });
    
    window.electron.onExportImage(async (event, filePath) => {
        const workspace = document.getElementById('workspace');
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        
        canvas.width = workspace.scrollWidth;
        canvas.height = workspace.scrollHeight;
        
        ctx.fillStyle = '#1a1a2e';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        const nodes = document.querySelectorAll('.node');
        nodes.forEach(node => {
            const rect = node.getBoundingClientRect();
            const workspaceRect = workspace.getBoundingClientRect();
            
            const clone = node.cloneNode(true);
            clone.style.position = 'absolute';
            clone.style.left = (rect.left - workspaceRect.left) + 'px';
            clone.style.top = (rect.top - workspaceRect.top) + 'px';
            clone.style.transform = 'none';
            workspace.appendChild(clone);
            clone.remove();
        });
        
        const dataUrl = canvas.toDataURL('image/png');
        await window.electron.saveImage(dataUrl, filePath);
    });
}

// ============================================
// 6. ОБРАБОТЧИКИ СОБЫТИЙ
// ============================================

document.addEventListener('mousemove', (e) => {
    // Растягивание ноды по ширине
    if (nodeManager.isResizing) {
        nodeManager.updateResize(e);
        return;
    }
    
    // Перетаскивание нод
    if (nodeManager.isDragging && nodeManager.draggedNode) {
        const el = document.querySelector(`[data-node-id="${nodeManager.draggedNode.id}"]`);
        if (!el) return;
        
        // Координаты мыши в системе координат #nodesContainer (с учётом zoom)
        const local = window.toContainerCoords(e.clientX, e.clientY);
        
        let x = local.x - nodeManager.dragOffsetX;
        let y = local.y - nodeManager.dragOffsetY;
        
        // Получаем контейнер для ограничений
        const container = document.getElementById('nodesContainer');
        if (container) {
            // Ограничиваем, чтобы нода не выходила за пределы контейнера
            const maxX = container.scrollWidth - el.offsetWidth - 20;
            const maxY = container.scrollHeight - el.offsetHeight - 20;
            x = Math.max(0, Math.min(x, maxX));
            y = Math.max(0, Math.min(y, maxY));
        }
        
        // Устанавливаем новую позицию
        el.style.left = x + 'px';
        el.style.top = y + 'px';
        nodeManager.draggedNode.x = x;
        nodeManager.draggedNode.y = y;
        
        // Обновляем линии
        if (window.renderer) {
            window.renderer.drawAllConnections(window.connectionManager?.getConnections() || []);
        }
    }
    
    // Обновление временной линии соединения
    if (window.connectionManager?.isConnecting && window.connectionManager?.tempLine) {
        window.connectionManager.updateTempLine(e);
    }
});

document.addEventListener('mouseup', (e) => {
    // Завершение растягивания ноды
    if (nodeManager.isResizing) {
        nodeManager.endResize();
    }
    
    // Завершение перетаскивания ноды
    if (nodeManager.isDragging && nodeManager.draggedNode) {
        const el = document.querySelector(`[data-node-id="${nodeManager.draggedNode.id}"]`);
        if (el) el.classList.remove('dragging');
        nodeManager.isDragging = false;
        nodeManager.draggedNode = null;
        document.getElementById('drag-info').classList.remove('show');
    }
    
    // Завершение создания соединения
    if (connectionManager.isConnecting) {
        connectionManager.finishConnection(e, nodeManager);
        renderer.drawAllConnections(connectionManager.getConnections());
        nodeManager.calculateAll();
        renderer.updateAllDisplays();
    }
});

// Закрытие контекстного меню по клику вне его пределов
document.addEventListener('mousedown', (e) => {
    const menu = document.getElementById('contextMenu');
    if (!menu) return;
    if (menu.style.display === 'block' && !e.target.closest('.context-menu')) {
        menu.style.display = 'none';
        if (window.nodeManager) window.nodeManager.contextMenuTarget = null;
        if (window.connectionManager) window.connectionManager.contextMenuTarget = null;
    }
});

// Страховка от "зависших" временных линий соединения: если окно теряет
// фокус (Alt+Tab, переключение вкладки) или курсор покидает документ
// во время протягивания линии - обычный document 'mouseup' может не
// сработать (кнопка мыши отпущена за пределами страницы). Без этой
// страховки this.tempLine "терялся" бы в DOM навсегда как призрачная линия.
window.addEventListener('blur', () => {
    if (window.connectionManager?.isConnecting) {
        window.connectionManager.cancelConnection();
    }
});

document.addEventListener('mouseleave', () => {
    if (window.connectionManager?.isConnecting) {
        window.connectionManager.cancelConnection();
    }
});

// ============================================
// АВТО-РАСШИРЕНИЕ РАБОЧЕЙ ОБЛАСТИ
// ============================================

function ensureWorkspaceSize(x, y) {
    const container = document.getElementById('nodesContainer');
    const workspace = document.getElementById('workspace');
    if (!container || !workspace) return;
    
    // Проверяем, не выходит ли нода за границы
    const padding = 500; // Запас для прокрутки
    const currentWidth = parseInt(container.style.minWidth) || window.innerWidth * 2;
    const currentHeight = parseInt(container.style.minHeight) || window.innerHeight * 2;
    
    if (x + 300 > currentWidth) {
        container.style.minWidth = (x + padding) + 'px';
        container.style.width = (x + padding) + 'px';
        workspace.style.minWidth = (x + padding) + 'px';
    }
    
    if (y + 300 > currentHeight) {
        container.style.minHeight = (y + padding) + 'px';
        container.style.height = (y + padding) + 'px';
        workspace.style.minHeight = (y + padding) + 'px';
    }
}

// Модифицируем addNode
const originalAddNode = window.addNode;
window.addNode = (type, x, y, config = {}) => {
    // Расширяем рабочую область
    ensureWorkspaceSize(x, y);
    
    const node = originalAddNode(type, x, y, config);
    return node;
};

// ============================================
// 7. ЗАГРУЗКА ПРИМЕРА
// ============================================

function loadExample() {
    console.log('📂 Загрузка примера...');
    
    // Проверяем, есть ли уже ноды
    if (nodeManager.nodes.length > 0) {
        console.log('⚠️ Ноды уже есть, пример не загружаем');
        return;
    }
    
    try {
        const n1 = nodeManager.addNode('number', 100, 200, { 
            value: 10, 
            customName: 'Зарплата'  // Теперь имя будет отображаться в списке
        });
        const n2 = nodeManager.addNode('number', 100, 320, { 
            value: 25, 
            customName: 'Бонус' 
        });
        const n3 = nodeManager.addNode('add', 300, 260, { customName: 'Сумма' });
        
        if (!n1 || !n2 || !n3) {
            console.error('❌ Ошибка создания нод для примера');
            return;
        }
        
        setTimeout(() => {
            connectionManager.addConnection(n1.id, n3.id, 0);
            connectionManager.addConnection(n2.id, n3.id, 1);
            renderer.drawAllConnections(connectionManager.getConnections());
            nodeManager.calculateAll();
            renderer.updateAllDisplays();
            document.getElementById('status').textContent = '✅ Пример загружен (10 + 25 = 35)';
            setTimeout(() => {
                document.getElementById('status').textContent = 'Готово';
            }, 3000);
            console.log('✅ Пример загружен успешно');
        }, 200);
    } catch (error) {
        console.error('❌ Ошибка при загрузке примера:', error);
    }
}

// ============================================
// ОБНОВЛЕНИЕ СЧЕТЧИКОВ
// ============================================

function updateCounters() {
    const nodeCount = document.getElementById('nodeCount');
    const connectionCount = document.getElementById('connectionCount');
    
    if (nodeCount) {
        nodeCount.textContent = `Нод: ${nodeManager?.nodes?.length || 0}`;
    }
    if (connectionCount) {
        connectionCount.textContent = `Соединений: ${connectionManager?.connections?.length || 0}`;
    }
}

// Вызываем при изменении
setInterval(updateCounters, 500);

// Экспортируем для вызова из других мест
window.updateCounters = updateCounters;

// Загружаем пример после небольшой задержки
setTimeout(loadExample, 300);

console.log('🚀 Нодовый калькулятор загружен!');
console.log('📦 Доступные команды:');
console.log('  - window.addNode(type, x, y, config)');
console.log('  - window.calculateAll()');
console.log('  - window.clearWorkspace()');
console.log('  - window.deleteNode()');
console.log('  - window.duplicateNode()');
console.log('  - window.deleteConnection()');
console.log('  - window.addLayout() / window.switchLayout(id)');
console.log('  - window.zoomIn() / window.zoomOut() / window.zoomReset()');
