import { BaseNode } from './baseNode.js';
import { Helpers } from '../utils/helpers.js';
import { TableData } from '../utils/dataTypes.js';
import { SocketFactory } from '../utils/socketFactory.js';

const ROW_HEIGHT = 22;      // px, примерная высота строки таблицы
const HEADER_HEIGHT = 26;   // px, примерная высота заголовка
const MAX_VISIBLE_ROWS = 8; // после скольки строк включается скролл (пока не задано вручную)
const MIN_WRAP_HEIGHT = 40; // px, чтобы пустая/маленькая таблица не схлопывалась в ничто

const EYE_OPEN = '●';   // номера строк показаны
const EYE_CLOSED = '‿'; // номера строк замаскированы

/**
 * TableViewerNode - только просмотр: один вход Data, без выходов.
 * Показывает таблицу (шапка = заголовки столбцов, строки = значения
 * с учётом формата колонки - число/деньги/проценты/текст).
 *
 * Область таблицы можно свободно растягивать и по ширине, и по высоте -
 * нативный resize (CSS resize: both) прямо на обёртке таблицы, отдельно
 * от общей ручки изменения ширины ноды. Пока пользователь не растягивал
 * область вручную, высота подстраивается под фактическое число строк;
 * как только область растянута вручную - автоподбор высоты больше не
 * вмешивается.
 *
 * Столбец номеров строк - фиксированной ширины, подобранной под самое
 * крупное число в текущих данных (как в Excel: ширина растёт вместе
 * с количеством цифр, а не "гуляет" от рендера к рендеру).
 *
 * Клик по стрелке рядом с заголовком столбца сортирует строки по этому
 * столбцу: по возрастанию → по убыванию → как есть (три состояния по кругу).
 * Сортировка - чисто визуальная (меняет порядок отображения строк),
 * исходные данные в TableNode не трогает.
 *
 * Номера строк можно замаскировать кнопкой-"глазиком" - сам столбец
 * и кнопка при этом остаются на месте, скрываются только цифры.
 */
export class TableViewerNode extends BaseNode {
    constructor(id, type, x, y, config = {}) {
        super(id, type, x, y, config);
        this.outputs = 0;
        this.inputs = 1;
        this.inputSockets = [0];
        this.width = config.width || 300;
        this.tableData = new TableData();
        this.sourceName = null;
        this.showRowNumbers = config.showRowNumbers !== undefined ? config.showRowNumbers : true;
        // Сортировка: индекс столбца в tableData.columns + направление.
        // null/null = "как есть" (исходный порядок строк)
        this.sortColumnIndex = config.sortColumnIndex ?? null;
        this.sortDirection = config.sortDirection ?? null; // 'asc' | 'desc' | null
    }

    getDisplayName() {
        if (this.customName) return this.customName;
        if (this.sourceName) return this.sourceName;
        return 'Просмотр таблицы';
    }

    createContent() {
        const content = document.createElement('div');
        content.className = 'node-content';
        content.style.cssText = `
            gap: 6px;
            width: 100%;
            min-width: 240px;
        `;

        const topRow = document.createElement('div');
        topRow.style.cssText = `
            display: flex;
            align-items: center;
            gap: 8px;
            padding-bottom: 6px;
            margin-bottom: 2px;
            border-bottom: 1px solid var(--md-divider);
        `;

        const socket = SocketFactory.createSocket({
            nodeId: this.id,
            socketType: 'input',
            index: 0,
            isData: true,
            title: 'Таблица (DATA)'
        });
        topRow.appendChild(socket);

        const infoLabel = document.createElement('span');
        infoLabel.className = 'table-viewer-info';
        infoLabel.style.cssText = `
            color: var(--md-text-secondary);
            font-size: 11px;
            flex: 1;
        `;
        infoLabel.textContent = `${this.tableData.columns.length}×${this.tableData.rowCount}`;
        topRow.appendChild(infoLabel);

        content.appendChild(topRow);

        const tableWrap = document.createElement('div');
        tableWrap.className = 'table-viewer-wrap';
        tableWrap.style.cssText = `
            overflow: auto;
            max-width: 100%;
            min-width: 120px;
            min-height: ${MIN_WRAP_HEIGHT}px;
            resize: both;
        `;
        // Свой resize-хэндл (нативный, CSS resize) должен управлять
        // только размером этой обёртки, а не перетаскиванием всей ноды -
        // без остановки всплытия mousedown ушёл бы в обработчик
        // nodeManager (он двигает ноду по нажатию на любое "пустое" место).
        tableWrap.addEventListener('mousedown', (e) => e.stopPropagation());

        this.renderTable(tableWrap);
        content.appendChild(tableWrap);

        return content;
    }

    // Высота области прокрутки зависит от фактического числа строк -
    // до MAX_VISIBLE_ROWS помещается целиком без скролла, дальше
    // появляется вертикальный скролл. НЕ применяется, если пользователь
    // уже растягивал область вручную (см. hasManualSize в renderTable).
    applyWrapHeight(wrap) {
        const rowCount = this.tableData.rowCount;
        if (rowCount === 0) {
            wrap.style.maxHeight = MIN_WRAP_HEIGHT + 'px';
            return;
        }
        const visibleRows = Math.min(rowCount, MAX_VISIBLE_ROWS);
        const height = HEADER_HEIGHT + visibleRows * ROW_HEIGHT + 4;
        wrap.style.maxHeight = Math.max(height, MIN_WRAP_HEIGHT) + 'px';
    }

    // Порядок отображения строк с учётом текущей сортировки. Возвращает
    // массив ИСХОДНЫХ индексов строк в нужном порядке отображения.
    getRowOrder() {
        const rowCount = this.tableData.rowCount;
        const order = Array.from({ length: rowCount }, (_, i) => i);

        if (this.sortColumnIndex === null || !this.sortDirection) return order;
        const col = this.tableData.columns[this.sortColumnIndex];
        if (!col) return order;

        order.sort((a, b) => {
            const va = col.values[a];
            const vb = col.values[b];
            let cmp;
            if (typeof va === 'number' && typeof vb === 'number') {
                cmp = va - vb;
            } else {
                cmp = String(va ?? '').localeCompare(String(vb ?? ''));
            }
            return this.sortDirection === 'asc' ? cmp : -cmp;
        });
        return order;
    }

    renderTable(wrap) {
        // Индекс сортировки мог "протухнуть", если у источника изменился
        // набор столбцов (например, TableNode отфильтровал неподключённый
        // столбец) - тогда просто сбрасываем сортировку, а не падаем.
        if (this.sortColumnIndex !== null && this.sortColumnIndex >= this.tableData.columns.length) {
            this.sortColumnIndex = null;
            this.sortDirection = null;
        }

        // Нативный resize (CSS resize:both) проставляет inline width/height
        // сам, когда пользователь тащит уголок обёртки. Наши вычисления
        // (applyWrapHeight) не должны затирать это ручное решение при
        // каждом пересчёте - иначе перетягивание сбрасывалось бы обратно
        // при любом обновлении данных.
        const hasManualSize = !!(wrap.style.width || wrap.style.height);

        wrap.innerHTML = '';

        if (hasManualSize) {
            wrap.style.maxHeight = 'none';
        } else {
            this.applyWrapHeight(wrap);
        }

        if (this.tableData.columns.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'table-viewer-empty';
            empty.style.cssText = `
                color: var(--md-text-disabled);
                font-size: 11px;
                text-align: center;
                padding: 10px 0;
            `;
            empty.textContent = 'Нет данных';
            wrap.appendChild(empty);
            return;
        }

        const table = document.createElement('table');
        table.className = 'table-viewer-table';
        table.style.cssText = `
            border-collapse: collapse;
            width: 100%;
            font-size: 11px;
        `;

        const rowCount = this.tableData.rowCount;
        const rowOrder = this.getRowOrder();

        // Фиксированная ширина столбца номеров - под самое крупное число
        // в текущих данных (как в Excel), одинаковая у шапки и у всех строк
        const digits = String(Math.max(rowCount, 1)).length;
        const numColWidth = Math.max(22, digits * 7 + 14);

        // === ШАПКА ===
        const thead = document.createElement('thead');
        const headRow = document.createElement('tr');

        // Первая ячейка шапки - кнопка-глазик. Столбец с номерами и сама
        // кнопка ВСЕГДА на месте - переключатель маскирует только цифры
        // под ним, а не убирает ячейку (иначе вместе со столбцом
        // пропадала бы и сама кнопка).
        const eyeTh = document.createElement('th');
        eyeTh.style.cssText = `
            width: ${numColWidth}px;
            min-width: ${numColWidth}px;
            max-width: ${numColWidth}px;
            padding: 4px 6px;
            border-bottom: 1px solid var(--md-divider);
            position: sticky;
            top: 0;
            left: 0;
            background: var(--md-surface-variant);
            z-index: 2;
        `;
        const eyeBtn = document.createElement('button');
        eyeBtn.className = 'table-viewer-eye-btn';
        eyeBtn.textContent = this.showRowNumbers ? EYE_OPEN : EYE_CLOSED;
        eyeBtn.title = this.showRowNumbers ? 'Скрыть номера строк' : 'Показать номера строк';
        eyeBtn.style.cssText = `
            background: transparent;
            border: none;
            cursor: pointer;
            font-size: 12px;
            padding: 0;
            line-height: 1;
            color: var(--md-text-secondary);
        `;
        eyeBtn.addEventListener('mousedown', (e) => e.stopPropagation());
        eyeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.showRowNumbers = !this.showRowNumbers;
            this.renderTable(wrap);
        });
        eyeTh.appendChild(eyeBtn);
        headRow.appendChild(eyeTh);

        this.tableData.columns.forEach((col, colIdx) => {
            const isText = col.format === 'text';
            const isSortActive = this.sortColumnIndex === colIdx;

            const th = document.createElement('th');
            th.title = col.header;
            th.style.cssText = `
                text-align: ${isText ? 'left' : 'right'};
                padding: 4px 8px 4px 4px;
                color: var(--md-text-secondary);
                font-weight: 500;
                border-bottom: 1px solid var(--md-divider);
                white-space: nowrap;
                overflow: hidden;
                position: sticky;
                top: 0;
                background: var(--md-surface-variant);
                z-index: 1;
                cursor: pointer;
                ${col.width ? `width:${col.width}px; max-width:${col.width}px;` : 'max-width: 90px;'}
            `;
            // Обёртка ВНУТРИ th, не сам th - если сделать flex сам th,
            // браузер выкинет ячейку из табличного алгоритма раскладки
            // колонок, и шапка перестанет совпадать по ширине со строками
            const headerWrap = document.createElement('div');
            headerWrap.style.cssText = `
                display: flex;
                align-items: center;
                justify-content: ${isText ? 'flex-start' : 'flex-end'};
                gap: 4px;
                overflow: hidden;
            `;
            const headerText = document.createElement('span');
            headerText.textContent = col.header;
            headerText.style.cssText = 'overflow:hidden; text-overflow:ellipsis; white-space:nowrap;';
            headerWrap.appendChild(headerText);

            const sortIcon = document.createElement('span');
            sortIcon.className = 'table-viewer-sort-icon';
            sortIcon.textContent = isSortActive ? (this.sortDirection === 'asc' ? '↑' : '↓') : '↕';
            sortIcon.style.cssText = `
                font-size: 9px;
                flex-shrink: 0;
                opacity: ${isSortActive ? '1' : '0.35'};
                color: ${isSortActive ? 'var(--md-primary)' : 'inherit'};
            `;
            headerWrap.appendChild(sortIcon);

            th.appendChild(headerWrap);

            th.addEventListener('mousedown', (e) => e.stopPropagation());
            th.addEventListener('click', (e) => {
                e.stopPropagation();
                // Три состояния по кругу: как есть -> по возрастанию ->
                // по убыванию -> снова как есть
                if (this.sortColumnIndex !== colIdx) {
                    this.sortColumnIndex = colIdx;
                    this.sortDirection = 'asc';
                } else if (this.sortDirection === 'asc') {
                    this.sortDirection = 'desc';
                } else {
                    this.sortColumnIndex = null;
                    this.sortDirection = null;
                }
                this.renderTable(wrap);
            });

            headRow.appendChild(th);
        });
        thead.appendChild(headRow);
        table.appendChild(thead);

        // === ТЕЛО ===
        const tbody = document.createElement('tbody');

        rowOrder.forEach((srcRowIndex, displayIndex) => {
            const tr = document.createElement('tr');

            const numTd = document.createElement('td');
            numTd.className = 'table-viewer-row-num';
            numTd.textContent = String(displayIndex + 1);
            numTd.style.cssText = `
                width: ${numColWidth}px;
                min-width: ${numColWidth}px;
                max-width: ${numColWidth}px;
                text-align: right;
                padding: 3px 6px;
                color: var(--md-text-disabled);
                font-variant-numeric: tabular-nums;
                position: sticky;
                left: 0;
                background: var(--md-surface-variant);
                visibility: ${this.showRowNumbers ? 'visible' : 'hidden'};
            `;
            tr.appendChild(numTd);

            this.tableData.columns.forEach(col => {
                const isText = col.format === 'text';
                const td = document.createElement('td');
                const v = col.values[srcRowIndex];
                const hasValue = v !== undefined && v !== null && v !== '';
                const isStripe = displayIndex % 2 === 0;

                td.style.cssText = `
                    position: relative;
                    text-align: ${isText ? 'left' : 'right'};
                    padding: 3px 10px 3px 4px;
                    color: var(--md-text);
                    ${isText ? '' : 'font-variant-numeric: tabular-nums;'}
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                    ${col.width ? `max-width:${col.width}px;` : ''}
                    ${isStripe ? 'background: rgba(255,255,255,0.02);' : ''}
                `;

                // Для процентного формата - линейная графа (заливка) под
                // текстом значения, пропорциональная величине (0-100%)
                if (hasValue && col.format === 'percent') {
                    const pct = Math.max(0, Math.min(100, v));
                    const bar = document.createElement('div');
                    bar.className = 'table-viewer-cell-bar';
                    bar.style.cssText = `
                        position: absolute;
                        left: 0;
                        top: 0;
                        bottom: 0;
                        width: ${pct}%;
                        background: rgba(100, 181, 246, 0.22);
                        z-index: 0;
                    `;
                    td.appendChild(bar);
                }

                const textSpan = document.createElement('span');
                textSpan.style.cssText = 'position: relative; z-index: 1;';
                textSpan.textContent = hasValue ? Helpers.formatByType(v, col.format) : '—';
                td.appendChild(textSpan);

                tr.appendChild(td);
            });
            tbody.appendChild(tr);
        });
        table.appendChild(tbody);
        wrap.appendChild(table);
    }

    calculate(nodeManager) {
        const connections = window.connectionManager?.getConnections() || [];
        const input = connections.find(c => c.targetNodeId === this.id && c.targetSocket === 0);

        if (!input) {
            this.tableData = new TableData();
            this.sourceName = null;
            return null;
        }

        const srcNode = nodeManager.getNode(input.sourceNodeId);
        if (!srcNode || !srcNode.tableData) {
            this.tableData = new TableData();
            this.sourceName = null;
            return null;
        }

        this.sourceName = srcNode.customName
            || srcNode.tableData.metadata?.title
            || srcNode.getDisplayName?.()
            || null;

        this.tableData = srcNode.tableData;

        return this.tableData.rowCount;
    }

    updateDisplay(element) {
        const infoLabel = element.querySelector('.table-viewer-info');
        if (infoLabel) {
            infoLabel.textContent = `${this.tableData.columns.length}×${this.tableData.rowCount}`;
        }

        const wrap = element.querySelector('.table-viewer-wrap');
        if (wrap) {
            this.renderTable(wrap);
        }

        // Заголовок ноды обновляется на лету, если пользователь его не переименовывал
        const titleText = element.querySelector('.title-text');
        if (titleText && !this.customName) {
            titleText.textContent = this.getDisplayName();
        }
    }
}
