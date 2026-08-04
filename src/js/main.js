/**
 * SPDX-License-Identifier: MIT
 * SPDX-FileCopyrightText: 2024 NodeCalculate Team
 * SPDX-FileCopyrightText: 2024 Pavel Fomin
 *
 * @file    main.js
 * @brief   Точка входа рендерера: регистрация типов нод, глобальные window.*-функции, интеграция с Electron
 * @author  Pavel Fomin
 * @version 1.8.9
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
import { SidebarSettings } from './utils/sidebarSettings.js';
import { NumberNode } from './nodes/numberNode.js';
import { BooleanNode } from './nodes/booleanNode.js';
import { BooleanOperationNode } from './nodes/booleanOperationNode.js';
import { InvertNode } from './nodes/invertNode.js';
import { OperationNode } from './nodes/operationNode.js';
import { PercentageNode } from './nodes/percentageNode.js';
import { ScaleListNode } from './nodes/scaleListNode.js';
import { LayoutInputNode } from './nodes/layoutInputNode.js';
import { LayoutOutputNode } from './nodes/layoutOutputNode.js';
import { ListViewerNode } from './nodes/listViewerNode.js';
import { ListInputNode } from './nodes/listInputNode.js';
import { StringNode } from './nodes/stringNode.js';
import { TextNode } from './nodes/textNode.js';
import { TableNode } from './nodes/tableNode.js';
import { TableViewerNode } from './nodes/tableViewerNode.js';
import { PercentConvertNode } from './nodes/percentConvertNode.js';
import { GanttNode } from './nodes/ganttNode.js';
import { CalendarNode } from './nodes/calendarNode.js';
import { DashboardNode } from './nodes/dashboardNode.js';
import { ChartNode } from './nodes/chartNode.js';
import { XlsxImportNode } from './nodes/xlsxImportNode.js';
import { GanttTableProcessorNode } from './nodes/ganttTableProcessorNode.js';
import { JsonImportNode } from './nodes/jsonImportNode.js';
import { ExportXlsxNode } from './nodes/exportXlsxNode.js';
import { ExportJsonNode } from './nodes/exportJsonNode.js';
import { ImageNode } from './nodes/imageNode.js';
import { ProxyNode } from './nodes/proxyNode.js';
import { TreeNode } from './nodes/treeNode.js';
import { TreeFormatNode } from './nodes/treeFormatNode.js';
import { TreeToTableNode } from './nodes/treeToTableNode.js';
import { TreeViewerNode } from './nodes/treeViewerNode.js';
import { TableInjectNode } from './nodes/tableInjectNode.js';
import { TableRemoveNode } from './nodes/tableRemoveNode.js';
import { TableFormatNode } from './nodes/tableFormatNode.js';
import { TableMergeColumnsNode } from './nodes/tableMergeColumnsNode.js';
import { TableJoinNode } from './nodes/tableJoinNode.js';
import { TableFilterNode } from './nodes/tableFilterNode.js';
import { TableUniqueNode } from './nodes/tableUniqueNode.js';
import { ListConvertNode } from './nodes/listConvertNode.js';
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

// Раунд 102 (чек-лист 1.7.21, раздел 5) - настройки сайдбара (показ/
// скрытие нод по конфигурации) - инициализируется СРАЗУ, до
// nodeManager/остального - список нод в самом сайдбаре уже присутствует
// в разметке index.html на этот момент (SidebarSettings сканирует его
// напрямую из DOM, см. её докстринг), ждать остального не нужно.
SidebarSettings.init();

const nodeManager = new NodeManager();
const connectionManager = new ConnectionManager();
const renderer = new Renderer();
const layoutManager = new LayoutManager(nodeManager, connectionManager, renderer);
const boardManager = new BoardManager();
const inspectorManager = new InspectorManager();

// Регистрируем типы нод
nodeManager.registerNodeType('number', NumberNode);
nodeManager.registerNodeType('boolean', BooleanNode);
nodeManager.registerNodeType('booleanOp', BooleanOperationNode);
nodeManager.registerNodeType('invert', InvertNode);
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
nodeManager.registerNodeType('text', TextNode);
nodeManager.registerNodeType('table', TableNode);
nodeManager.registerNodeType('tableViewer', TableViewerNode);
nodeManager.registerNodeType('percentConvert', PercentConvertNode);
nodeManager.registerNodeType('gantt', GanttNode);
nodeManager.registerNodeType('calendar', CalendarNode);
nodeManager.registerNodeType('dashboard', DashboardNode);
nodeManager.registerNodeType('chart', ChartNode);
nodeManager.registerNodeType('xlsxImport', XlsxImportNode);
nodeManager.registerNodeType('ganttTableProcessor', GanttTableProcessorNode);
nodeManager.registerNodeType('jsonImport', JsonImportNode);
nodeManager.registerNodeType('image', ImageNode);
nodeManager.registerNodeType('proxy', ProxyNode);
nodeManager.registerNodeType('tree', TreeNode);
nodeManager.registerNodeType('treeFormat', TreeFormatNode);
nodeManager.registerNodeType('treeToTable', TreeToTableNode);
nodeManager.registerNodeType('treeViewer', TreeViewerNode);
nodeManager.registerNodeType('tableInject', TableInjectNode);
nodeManager.registerNodeType('tableRemove', TableRemoveNode);
nodeManager.registerNodeType('tableFormat', TableFormatNode);
nodeManager.registerNodeType('tableMergeColumns', TableMergeColumnsNode);
nodeManager.registerNodeType('tableJoin', TableJoinNode);
nodeManager.registerNodeType('tableFilter', TableFilterNode);
nodeManager.registerNodeType('tableUnique', TableUniqueNode);
nodeManager.registerNodeType('listConvert', ListConvertNode);
nodeManager.registerNodeType('exportXlsx', ExportXlsxNode);
nodeManager.registerNodeType('exportJson', ExportJsonNode);

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
// Раунд 125 (релиз 1.8.0, механика Досок) - обработчики кнопок формата
// страницы (#boardToolbar) вешаются один раз при старте.
boardManager._wireFormatButtons();

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

// Раунд 119 (релиз 1.8.0, по запросу Mr.D: "если я хочу открыть Excel
// файл в калькуляторе, то я могу его просто перетащить в рабочее
// пространство листа и на этом месте появится нода импорта") - drag&drop
// файлов ИЗВНЕ (проводник/рабочий стол ОС) прямо на холст. Слушаем на
// #nodesContainer (тот же элемент, что toContainerCoords() выше
// переводит координаты курсора относительно него) - события всплывают
// с любой точки внутри рабочей области, включая пустое место "за"
// нодами.
//
// Технически - НЕ через нативный <input type="file"> (тот требует
// клика пользователя, программно не открывается) - вместо этого
// напрямую вызываем ТЕ ЖЕ внутренние методы, что уже вызывает сам
// input.addEventListener('change', ...) внутри xlsxImportNode.js/
// jsonImportNode.js (_onFilePicked(file) принимает обычный File -
// результат браузерного File API, который e.dataTransfer.files даёт
// точно в такой же форме) - никакого дублирования логики импорта.
const DROP_NODE_TYPE_BY_EXT = {
    xlsx: 'xlsxImport',
    json: 'jsonImport'
};

document.getElementById('nodesContainer')?.addEventListener('dragover', (e) => {
    if (!e.dataTransfer?.types?.includes('Files')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    document.getElementById('workspace')?.classList.add('drag-file-over');
});

document.getElementById('nodesContainer')?.addEventListener('dragleave', (e) => {
    // dragleave срабатывает и при переходе между дочерними элементами
    // внутри холста (не только при полном уходе курсора) - проверяем
    // relatedTarget, чтобы не мигать рамкой при каждом мелком движении
    // мыши над нодами.
    if (e.relatedTarget && e.currentTarget.contains(e.relatedTarget)) return;
    document.getElementById('workspace')?.classList.remove('drag-file-over');
});

document.getElementById('nodesContainer')?.addEventListener('drop', async (e) => {
    document.getElementById('workspace')?.classList.remove('drag-file-over');
    const files = e.dataTransfer?.files;
    if (!files || files.length === 0) return;
    e.preventDefault();
    e.stopPropagation();

    const dropPoint = window.toContainerCoords(e.clientX, e.clientY);
    let offsetIndex = 0;

    for (const file of files) {
        const ext = (file.name.split('.').pop() || '').toLowerCase();
        const nodeType = DROP_NODE_TYPE_BY_EXT[ext];
        if (!nodeType) {
            console.warn(`Drag&drop: неподдерживаемое расширение "${ext}" (${file.name}) - пропущено`);
            continue;
        }

        // Раунд 120 (по уточнению Mr.D после проверки: "если у нас уже
        // есть нода Импорт Excel и мы перетаскиваем файл в её поле, то
        // мы не создаём новую ноду, а заменяем ссылку в существующей") -
        // если курсор в момент сброса физически НАД существующей нодой
        // ПОДХОДЯЩЕГО типа (тот же nodeType, что определён по
        // расширению файла) - переиспользуем ЕЁ, не создаём новую.
        // e.target - реальный DOM-элемент под курсором (нативный HTML5
        // Drag&Drop API даёт его точно так же, как у обычного click) -
        // .closest('.node') поднимается до корневого div ноды, откуда
        // data-node-id ведёт к самому экземпляру через nodeManager.
        let node = null;
        const targetNodeEl = e.target.closest?.('.node');
        if (targetNodeEl) {
            const targetId = parseInt(targetNodeEl.dataset.nodeId, 10);
            const existingNode = window.nodeManager?.getNode(targetId);
            if (existingNode && existingNode.type === nodeType) {
                node = existingNode;
            }
        }

        if (!node) {
            // Несколько файлов сразу - раскладываем по вертикали, чтобы
            // ноды не легли друг на друга в одной точке.
            const x = dropPoint.x;
            const y = dropPoint.y + offsetIndex * 140;
            offsetIndex++;
            node = window.addNode(nodeType, x, y);
        }
        if (!node) continue;

        try {
            await node._onFilePicked(file);
            // У Excel импорт - двухшаговый (сначала "поверхностное"
            // сканирование листов внутри _onFilePicked(), затем сам
            // разбор строк) - у JSON он уже полный внутри _onFilePicked()
            // (calculateAll() ниже подхватит this.jsonText сама). Второй
            // шаг вызываем ТОЛЬКО если он есть у этого типа ноды - не
            // размазывать xlsx-специфичную логику по main.js.
            if (typeof node._importSelected === 'function') {
                await node._importSelected();
            }
        } catch (err) {
            console.error(`Drag&drop: ошибка импорта "${file.name}":`, err);
        }
    }

    if (window.nodeManager) window.nodeManager.calculateAll();
    // Раунд 122 (по дампу DOM от Mr.D - реальная причина найдена, не
    // тайминг браузера, как предполагалось в Раунде 121) -
    // drawAllConnections(connections) требует АРГУМЕНТОМ список
    // соединений (см. её начало в renderer.js - сама она НИЧЕГО не
    // читает из connectionManager) - я вызывал её БЕЗ аргумента. Функция
    // СНАЧАЛА чистит SVG (удаляет все path/градиенты - "разлиновка
    // начисто"), а дальше просто нечего было рисовать - отсюда
    // абсолютно пустой <defs></defs> в дампе, при том что
    // connectionManager реально хранил соединения (статус-бар их
    // считал верно). Раунд 121 (requestAnimationFrame) лечил не ту
    // причину - оставлен как есть (не мешает), но реальный фикс - ниже,
    // передача connections явным аргументом, как и во ВСЕХ остальных
    // местах проекта.
    requestAnimationFrame(() => {
        if (window.renderer) {
            window.renderer.drawAllConnections(window.connectionManager?.getConnections() || []);
            window.renderer.updateAllDisplays();
        }
    });
});

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
        window.nodeManager?.clearMultiSelection();
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

// Escape - закрыть боковую панель, не дожидаясь клика мимо, и выключить
// активный инструмент холста (Раунд 54, см. setCutMode()/
// setPlacingProxyMode() ниже по файлу - function-объявления, доступны
// здесь благодаря hoisting)
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        window.nodeManager?.deselectNode();
        window.boardManager?.deselectWidget();
        window.nodeManager?.clearMultiSelection();
        setCutMode(false);
        setPlacingProxyMode(false);
        setMarqueeMode(false);
    }
});

// Delete - удаляет выделенную ноду(ы) (Раунд 64) - множественное
// выделение рамкой (Раунд 58) имеет приоритет над обычным одиночным
// выбором, см. nodeManager.deleteSelectedNodes(). Пропускаем, если
// фокус в поле ввода (имя ноды, значение ячейки и т.п.) - иначе Delete
// при обычном редактировании текста стирал бы саму ноду вместо символа.
document.addEventListener('keydown', (e) => {
    if (e.key !== 'Delete') return;
    const tag = e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target.isContentEditable) return;

    window.nodeManager?.deleteSelectedNodes();
});

// ============================================
// ПОИСК НОД В САЙДБАРЕ (Раунд 53)
// ============================================
// Разметка (#searchNodes) была подготовлена давно, но без единой
// строчки JS - с ростом числа типов нод (27+) искать нужную скроллом
// стало неудобно. Фильтрует по имени ноды И по подписи бейджа
// ("Ввод"/"Операция"/"Служебная" и т.п.) - так можно найти и
// конкретную ноду по названию, и всю категорию сразу. Раздел
// сворачивается целиком (display:none), если в нём не осталось ни
// одной подходящей ноды - не показываем пустые заголовки секций.
const searchInput = document.getElementById('searchNodes');
const sidebarScrollEl = document.querySelector('.sidebar-scroll');
let searchEmptyEl = null;

searchInput?.addEventListener('input', (e) => {
    const query = e.target.value.trim().toLowerCase();
    let totalVisible = 0;

    document.querySelectorAll('.sidebar-section').forEach(section => {
        let sectionVisible = 0;
        section.querySelectorAll('.node-item').forEach(item => {
            const name = item.querySelector('.node-name')?.textContent.toLowerCase() || '';
            const badge = item.querySelector('.node-badge')?.textContent.toLowerCase() || '';
            const matches = !query || name.includes(query) || badge.includes(query);
            item.style.display = matches ? '' : 'none';
            if (matches) sectionVisible++;
        });
        section.style.display = sectionVisible > 0 ? '' : 'none';
        totalVisible += sectionVisible;
    });

    if (!searchEmptyEl && sidebarScrollEl) {
        searchEmptyEl = document.createElement('div');
        searchEmptyEl.className = 'sidebar-search-empty';
        searchEmptyEl.textContent = 'Ничего не найдено';
        sidebarScrollEl.appendChild(searchEmptyEl);
    }
    if (searchEmptyEl) {
        searchEmptyEl.style.display = (query && totalVisible === 0) ? 'block' : 'none';
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

// ============================================
// ПАНЕЛЬ ИНСТРУМЕНТОВ ХОЛСТА (Раунд 54, план 1.6.0 п.1)
// ============================================
// Два инструмента, оба - переключаемые режимы (не разовое действие) -
// "включил, поработал, выключил", а не "нажал один раз, что-то
// произошло сразу". Оба взаимоисключающие - включение одного гасит
// другой (setCutMode()/setPlacingProxyMode() определены как обычные
// function-объявления, а не const-стрелки, специально - они всплывают
// (hoisting) и доступны из более раннего обработчика Escape тоже, хотя
// сам обработчик определён ниже по файлу).
const workspaceEl = document.getElementById('workspace');
const toolCutBtn = document.getElementById('toolCutConnections');
const toolAddProxyBtn = document.getElementById('toolAddProxy');
const toolMarqueeBtn = document.getElementById('toolMarqueeSelect');

let cutMode = false;
let placingProxyMode = false;
let marqueeMode = false;
let cutGesturePoints = null;
let cutFeedbackPath = null;
let marqueeStartPoint = null;
let marqueeEl = null;

function setCutMode(active) {
    cutMode = active;
    toolCutBtn?.classList.toggle('active', active);
    workspaceEl?.classList.toggle('tool-active-cursor', cutMode || placingProxyMode || marqueeMode);
}

function setPlacingProxyMode(active) {
    placingProxyMode = active;
    toolAddProxyBtn?.classList.toggle('active', active);
    workspaceEl?.classList.toggle('tool-active-cursor', cutMode || placingProxyMode || marqueeMode);
}

// Раунд 58, план 1.6.0 п.3 - "Выделение рамкой", рядом с ножницами.
// Тот же принцип переключаемого режима, что у остальных двух
// инструментов (см. докстринг выше про hoisting - по той же причине
// объявлена как function, а не const-стрелка).
function setMarqueeMode(active) {
    marqueeMode = active;
    toolMarqueeBtn?.classList.toggle('active', active);
    workspaceEl?.classList.toggle('tool-active-cursor', cutMode || placingProxyMode || marqueeMode);
}

toolCutBtn?.addEventListener('click', () => {
    const next = !cutMode;
    setPlacingProxyMode(false); // режимы взаимоисключающие
    setMarqueeMode(false);
    setCutMode(next);
});

toolAddProxyBtn?.addEventListener('click', () => {
    const next = !placingProxyMode;
    setCutMode(false);
    setMarqueeMode(false);
    setPlacingProxyMode(next);
});

toolMarqueeBtn?.addEventListener('click', () => {
    const next = !marqueeMode;
    setCutMode(false);
    setPlacingProxyMode(false);
    setMarqueeMode(next);
});

// Раунд 75 - горячие клавиши для инструментов холста (по образцу
// Blender: B - box select). Оба обработчика ИГНОРИРУЮТ нажатия, когда
// фокус внутри текстового поля/textarea/select - иначе набор буквы "b"
// в названии ноды или обычный Ctrl+C/V копирования сломались бы.
function isTypingTarget() {
    const el = document.activeElement;
    if (!el) return false;
    const tag = el.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

// Состояние инструментов ДО временного зажатия Ctrl - восстанавливается
// по отпусканию, см. keyup ниже. null = Ctrl сейчас не зажат нами.
let toolsBeforeCtrlHold = null;

document.addEventListener('keydown', (e) => {
    if (isTypingTarget()) return;

    // "B" (без модификаторов) - переключить "Выделение рамкой", тот же
    // обработчик, что и у клика по кнопке - режимы взаимоисключающие,
    // ничего не дублируем
    // Багфикс: e.key зависит от АКТИВНОЙ раскладки клавиатуры - на
    // русской/немецкой раскладке физическая клавиша "B" отдаёт совсем
    // другой символ ('и' на ЙЦУКЕН и т.п.), поэтому e.key==='b' почти
    // никогда не совпадает вне английской раскладки. e.code, в отличие
    // от e.key, сообщает ФИЗИЧЕСКОЕ положение клавиши на клавиатуре
    // ('KeyB') - не зависит от раскладки вообще, универсальное решение,
    // работает одинаково на любой раскладке.
    if (e.code === 'KeyB' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        toolMarqueeBtn?.click();
        return;
    }

    // Ctrl зажат - временно включить "Ножницы", запомнив, что было
    // активно до этого (e.repeat - защита от повторных keydown, которые
    // браузер шлёт, пока клавиша просто удерживается)
    if (e.key === 'Control' && !e.repeat && toolsBeforeCtrlHold === null) {
        toolsBeforeCtrlHold = { cut: cutMode, proxy: placingProxyMode, marquee: marqueeMode };
        setPlacingProxyMode(false);
        setMarqueeMode(false);
        setCutMode(true);
    }
});

document.addEventListener('keyup', (e) => {
    if (e.key === 'Control' && toolsBeforeCtrlHold !== null) {
        const prev = toolsBeforeCtrlHold;
        toolsBeforeCtrlHold = null;
        setCutMode(prev.cut);
        setPlacingProxyMode(prev.proxy);
        setMarqueeMode(prev.marquee);
    }
});

// Если окно теряет фокус (переключение на другое приложение) с зажатым
// Ctrl - keyup может не долететь - без этого "Ножницы" остались бы
// включёнными навсегда. Возвращаем к состоянию до зажатия по blur окна.
window.addEventListener('blur', () => {
    if (toolsBeforeCtrlHold !== null) {
        const prev = toolsBeforeCtrlHold;
        toolsBeforeCtrlHold = null;
        setCutMode(prev.cut);
        setPlacingProxyMode(prev.proxy);
        setMarqueeMode(prev.marquee);
    }
});

// "Добавить точку" - следующий клик по ПУСТОМУ месту холста создаёт
// Точку ровно там; клик по ноде/сокету игнорируется (не размещаем
// поверх существующей ноды), режим при этом остаётся включённым - можно
// расставить несколько точек подряд, не нажимая кнопку заново.
document.getElementById('nodesContainer')?.addEventListener('click', (e) => {
    if (!placingProxyMode) return;
    if (e.target.closest('.node') || e.target.closest('.socket')) return;
    const { x, y } = window.toContainerCoords(e.clientX, e.clientY);
    window.addNode('proxy', x, y);
});

// "Выделение рамкой" - протянуть прямоугольник по пустому месту холста,
// все ноды, чья граница пересекается с рамкой, попадают в множественное
// выделение (nodeManager.selectMultipleNodes()) - после этого перетаскивание
// ЛЮБОЙ из выделенных нод двигает ВСЕ разом (см. nodeManager.startDragNode()
// и обработчик mousemove выше). Сравнение через getBoundingClientRect() -
// экранные координаты и у рамки, и у нод одинаково "плавают" вместе с
// зумом/скроллом холста, поэтому пересчитывать зум для самого теста
// пересечения не нужно - оба прямоугольника уже в одной системе координат.
// Инструмент гаснет сам после ОДНОГО выделения (тот же принцип, что и у
// "Добавить точку" - однократное действие), а само выделение остаётся
// активным до клика по пустому месту холста или Escape.
document.getElementById('nodesContainer')?.addEventListener('mousedown', (e) => {
    if (!marqueeMode) return;
    if (e.target.closest('.node')) return; // над нодой - обычный drag ноды, не начинаем рамку
    e.preventDefault();
    e.stopPropagation();

    marqueeStartPoint = { x: e.clientX, y: e.clientY };

    marqueeEl = document.createElement('div');
    marqueeEl.className = 'marquee-select-box';
    document.body.appendChild(marqueeEl);
    updateMarqueeBox(marqueeStartPoint, marqueeStartPoint);

    const onMove = (moveEvent) => {
        updateMarqueeBox(marqueeStartPoint, { x: moveEvent.clientX, y: moveEvent.clientY });
    };

    const onUp = (upEvent) => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);

        const endPoint = { x: upEvent.clientX, y: upEvent.clientY };
        const marqueeRect = {
            left: Math.min(marqueeStartPoint.x, endPoint.x),
            right: Math.max(marqueeStartPoint.x, endPoint.x),
            top: Math.min(marqueeStartPoint.y, endPoint.y),
            bottom: Math.max(marqueeStartPoint.y, endPoint.y)
        };

        if (marqueeEl) { marqueeEl.remove(); marqueeEl = null; }
        marqueeStartPoint = null;

        const matchedIds = [];
        document.querySelectorAll('#nodesContainer .node').forEach(nodeEl => {
            const r = nodeEl.getBoundingClientRect();
            const intersects = r.left < marqueeRect.right && r.right > marqueeRect.left
                && r.top < marqueeRect.bottom && r.bottom > marqueeRect.top;
            if (intersects) {
                const id = parseInt(nodeEl.dataset.nodeId, 10);
                if (!Number.isNaN(id)) matchedIds.push(id);
            }
        });

        if (matchedIds.length > 1) {
            window.nodeManager?.selectMultipleNodes(matchedIds);
        } else {
            window.nodeManager?.clearMultiSelection();
        }

        setMarqueeMode(false); // однократное действие, как у "Добавить точку"
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
});

function updateMarqueeBox(start, end) {
    if (!marqueeEl) return;
    const left = Math.min(start.x, end.x);
    const top = Math.min(start.y, end.y);
    const width = Math.abs(end.x - start.x);
    const height = Math.abs(end.y - start.y);
    marqueeEl.style.left = left + 'px';
    marqueeEl.style.top = top + 'px';
    marqueeEl.style.width = width + 'px';
    marqueeEl.style.height = height + 'px';
}

// "Обрезать связи" - протянуть жест мышью через провода, любое
// соединение, чей путь пересекается с жестом, разрывается. Точное
// пересечение с кривой линии (не просто с прямой между её концами)
// проверяется через SVGGeometryElement.getPointAtLength() - берём N
// точек вдоль РЕАЛЬНО отрисованной кривой (тот же path, что видит
// пользователь) и тестируем каждый отрезок жеста против каждого отрезка
// этой ломаной - тот же принцип, что уже применялся для градиента линий
// (Раунд 50): работаем с фактической геометрией, а не приближением.
function crossProduct(a, b, c) {
    return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function segmentsIntersect(p1, p2, p3, p4) {
    const d1 = crossProduct(p3, p4, p1);
    const d2 = crossProduct(p3, p4, p2);
    const d3 = crossProduct(p1, p2, p3);
    const d4 = crossProduct(p1, p2, p4);
    return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
           ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

function applyCutGesture(gesturePoints) {
    const paths = document.querySelectorAll('#connectionsSvg path.connection-path:not(.temp-path)');
    const toRemove = [];

    paths.forEach(pathEl => {
        if (!pathEl.dataset.sourceNodeId) return; // без данных о связи - нечего разрывать (см. renderer.js createConnectionPath)
        const len = pathEl.getTotalLength();
        if (!len) return;

        const steps = 24;
        const samples = [];
        for (let i = 0; i <= steps; i++) {
            samples.push(pathEl.getPointAtLength((len * i) / steps));
        }

        let hit = false;
        for (let i = 0; i < gesturePoints.length - 1 && !hit; i++) {
            for (let j = 0; j < samples.length - 1 && !hit; j++) {
                if (segmentsIntersect(gesturePoints[i], gesturePoints[i + 1], samples[j], samples[j + 1])) {
                    hit = true;
                }
            }
        }

        if (hit) {
            toRemove.push({
                sourceNodeId: parseInt(pathEl.dataset.sourceNodeId, 10),
                targetNodeId: parseInt(pathEl.dataset.targetNodeId, 10),
                targetSocket: parseInt(pathEl.dataset.targetSocket, 10)
            });
        }
    });

    if (toRemove.length && window.connectionManager) {
        toRemove.forEach(c => window.connectionManager.removeConnection(c.sourceNodeId, c.targetNodeId, c.targetSocket));
        if (window.nodeManager) window.nodeManager.calculateAll();

        const statusEl = document.getElementById('status');
        if (statusEl) {
            statusEl.textContent = `✂️ Разорвано связей: ${toRemove.length}`;
            setTimeout(() => { statusEl.textContent = 'Готово'; }, 1500);
        }
    }
}

document.getElementById('nodesContainer')?.addEventListener('mousedown', (e) => {
    if (!cutMode) return;
    if (e.target.closest('.node')) return; // над нодой - обычный drag ноды, не режем
    e.preventDefault();
    e.stopPropagation();

    const start = window.toContainerCoords(e.clientX, e.clientY);
    cutGesturePoints = [start];

    const svg = window.renderer?.ensureLinesSvg();
    if (svg) {
        cutFeedbackPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        cutFeedbackPath.setAttribute('stroke', '#ef5350');
        cutFeedbackPath.setAttribute('stroke-width', '2');
        cutFeedbackPath.setAttribute('stroke-dasharray', '4 4');
        cutFeedbackPath.setAttribute('fill', 'none');
        cutFeedbackPath.setAttribute('opacity', '0.9');
        svg.appendChild(cutFeedbackPath);
    }

    const onMove = (moveEvent) => {
        const pt = window.toContainerCoords(moveEvent.clientX, moveEvent.clientY);
        cutGesturePoints.push(pt);
        if (cutFeedbackPath) {
            const d = cutGesturePoints.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
            cutFeedbackPath.setAttribute('d', d);
        }
    };

    const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        if (cutFeedbackPath) {
            cutFeedbackPath.remove();
            cutFeedbackPath = null;
        }
        if (cutGesturePoints && cutGesturePoints.length >= 2) {
            applyCutGesture(cutGesturePoints);
        }
        cutGesturePoints = null;
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
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

window.exportBoardPdf = () => {
    if (window.electron) {
        window.electron.exportBoardPdf();
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

        // Групповое перемещение (Раунд 58) - та же дельта, что у "ведущей"
        // ноды, применяется ко всем остальным выделенным рамкой - без
        // собственного ограничения по границам контейнера (ведущая уже
        // ограничена выше, остальные просто следуют за ней синхронно)
        if (nodeManager.dragGroupStart) {
            const deltaX = x - nodeManager.dragGroupStart.leadX;
            const deltaY = y - nodeManager.dragGroupStart.leadY;
            Object.entries(nodeManager.dragGroupStart.positions).forEach(([idStr, startPos]) => {
                const id = Number(idStr); // Object.entries() всегда даёт строковые ключи, а node.id - число (getNode ищет строгим ===)
                if (id === nodeManager.draggedNode.id) return; // ведущая уже обновлена выше
                const n = nodeManager.getNode(id);
                const otherEl = document.querySelector(`[data-node-id="${id}"]`);
                if (!n || !otherEl) return;
                const nx = startPos.x + deltaX;
                const ny = startPos.y + deltaY;
                otherEl.style.left = nx + 'px';
                otherEl.style.top = ny + 'px';
                n.x = nx;
                n.y = ny;
            });
        }
        
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
        nodeManager.dragGroupStart = null;
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
