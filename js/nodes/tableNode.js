import { BaseNode } from './baseNode.js';
import { TableData } from '../utils/dataTypes.js';
import { SocketFactory } from '../utils/socketFactory.js';

/**
 * TableNode - обработчик: собирает входящие LIST-ы в столбцы таблицы.
 * У каждого столбца два входа - LIST (обязательный, значения столбца)
 * и String (необязательный, переопределяет заголовок столбца).
 *
 * Формат столбца (число/деньги/проценты) можно выбрать вручную, либо
 * унаследовать от источника через getValueFormat() (см. docs/NODE_API.md
 * и BaseNode.getValueFormat()).
 *
 * Названия строк (item.name из подключённого LIST) можно подцепить как
 * отдельный текстовый столбец перед числовым - переключается чекбоксом
 * "имена" у каждого столбца индивидуально (пока грубый переключатель,
 * более тонкий менеджмент - на будущее).
 *
 * Ширину столбца в выходной таблице можно задать вручную (px) - иначе
 * потребитель (TableViewerNode) подбирает её сам под содержимое.
 *
 * Выход единственный - сокет типа Data (ромб, оранжевый): готовые данные,
 * которые дальше умеет читать, например, PercentageNode.
 *
 * Индексы сокетов: у одной ноды каждый input-сокет должен иметь свой
 * уникальный index (см. docs/NODE_API.md, раздел 5) - поэтому пара
 * LIST+String на столбец занимает ДВА последовательных индекса
 * (this._nextIndex растёт на 2 при каждом новом столбце), а не
 * переиспользует один и тот же index для разных типов сокета.
 */
export class TableNode extends BaseNode {
    constructor(id, type, x, y, config = {}) {
        super(id, type, x, y, config);
        this.outputs = 1;

        // Практического смысла ограничивать сильно нет - индексы сокетов
        // растут на 2 за столбец, так что верхняя граница нужна только
        // как разумная защита от случайного бесконечного роста ноды
        this.maxColumns = config.maxColumns || 24;
        this._isRerendering = false;

        this.columns = (config.columns && config.columns.length)
            ? config.columns.map(c => ({
                listIndex: c.listIndex,
                stringIndex: c.stringIndex,
                formatOverride: c.formatOverride ?? null,
                includeNames: c.includeNames ?? false,
                width: c.width ?? null
            }))
            : [{ listIndex: 0, stringIndex: 1, formatOverride: null, includeNames: false, width: null }];

        this._nextIndex = config._nextIndex ?? (this.columns.length * 2);

        this.inputSockets = this.columns.flatMap(c => [c.listIndex, c.stringIndex]);
        this.inputs = this.inputSockets.length;

        this.width = config.width || 320;
        this.tableData = new TableData();
    }

    createContent() {
        const content = document.createElement('div');
        content.className = 'node-content table-node-content';
        content.style.cssText = `
            gap: 8px;
            width: 100%;
            min-width: 260px;
        `;

        const columnsContainer = document.createElement('div');
        columnsContainer.className = 'table-columns-container';
        columnsContainer.style.cssText = `
            display: flex;
            flex-direction: column;
            gap: 8px;
        `;

        this.columns.forEach((col, i) => {
            columnsContainer.appendChild(this.createColumnRow(col, i));
        });

        content.appendChild(columnsContainer);

        // === ВЫХОДНОЙ СОКЕТ (Data) ===
        const outputRow = document.createElement('div');
        outputRow.className = 'node-output table-output-row';
        outputRow.style.cssText = `
            display: flex;
            align-items: center;
            gap: 8px;
            padding-top: 6px;
            margin-top: 2px;
            border-top: 1px solid var(--md-divider);
        `;

        const outputLabel = document.createElement('label');
        outputLabel.textContent = 'Таблица (DATA):';
        outputLabel.className = 'table-output-label';
        outputLabel.style.cssText = `
            color: var(--md-text-secondary);
            font-size: 11px;
            font-weight: 400;
            flex: 1;
        `;
        outputRow.appendChild(outputLabel);

        const outputCount = document.createElement('span');
        outputCount.className = 'table-output-count';
        outputCount.style.cssText = `
            color: #ff8a65;
            font-size: 12px;
            font-weight: 500;
            font-variant-numeric: tabular-nums;
        `;
        outputCount.textContent = `${this.tableData.columns.length}×${this.tableData.rowCount}`;
        outputRow.appendChild(outputCount);

        const outputSocket = SocketFactory.createSocket({
            nodeId: this.id,
            socketType: 'output',
            index: 0,
            isData: true,
            title: 'Таблица (DATA)'
        });
        outputRow.appendChild(outputSocket);

        content.appendChild(outputRow);

        // Проверяем, нужно ли сразу добавить свободный столбец
        this.checkAndAddEmptySlot();

        return content;
    }

    createColumnRow(col, index) {
        const row = document.createElement('div');
        row.className = 'table-column-row';
        row.dataset.colIndex = index;
        row.style.cssText = `
            display: flex;
            flex-direction: column;
            gap: 3px;
            padding: 4px 0;
            ${index > 0 ? 'border-top: 1px dashed var(--md-divider);' : ''}
        `;

        // --- строка 1: LIST-сокет + удаление столбца ---
        // Минимальная строка - только то, что обязано быть первым
        // элементом ряда (сокет с отрицательным margin, см.
        // docs/NODE_API.md раздел 5). Остальные органы управления - на
        // строке 2, единой строкой, как и просили.
        const listLine = document.createElement('div');
        listLine.className = 'table-column-line';
        listLine.style.cssText = `
            display: flex;
            align-items: center;
            gap: 6px;
        `;

        const listSocket = SocketFactory.createSocket({
            nodeId: this.id,
            socketType: 'input',
            index: col.listIndex,
            isList: true,
            title: `Список — столбец ${index + 1}`
        });
        listLine.appendChild(listSocket);

        const listSpacer = document.createElement('span');
        listSpacer.style.cssText = 'flex: 1;';
        listLine.appendChild(listSpacer);

        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'delete-input-btn';
        deleteBtn.textContent = '✕';
        deleteBtn.style.display = this.columns.length > 1 ? 'inline-block' : 'none';
        deleteBtn.title = 'Удалить столбец';
        deleteBtn.addEventListener('mousedown', (e) => e.stopPropagation());
        deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.removeColumn(index);
        });
        listLine.appendChild(deleteBtn);

        row.appendChild(listLine);

        // --- строка 2: String-сокет + имена + формат + ширина - ОДНОЙ строкой ---
        const metaLine = document.createElement('div');
        metaLine.className = 'table-column-line table-column-meta';
        metaLine.style.cssText = `
            display: flex;
            align-items: center;
            gap: 6px;
        `;

        const stringSocket = SocketFactory.createSocket({
            nodeId: this.id,
            socketType: 'input',
            index: col.stringIndex,
            isString: true,
            title: 'Заголовок столбца (необязательно)'
        });
        metaLine.appendChild(stringSocket);

        // Переключатель "подцепить названия строк" - если включён, перед
        // числовым столбцом появится ещё один, текстовый, со значениями
        // item.name исходного списка (см. calculate())
        const namesLabel = document.createElement('label');
        namesLabel.className = 'table-names-toggle';
        namesLabel.title = 'Добавить столбец с названиями строк (имена элементов списка)';
        namesLabel.style.cssText = `
            display: flex;
            align-items: center;
            gap: 3px;
            color: var(--md-text-disabled);
            font-size: 9px;
            cursor: pointer;
            flex-shrink: 0;
        `;
        const namesCheckbox = document.createElement('input');
        namesCheckbox.type = 'checkbox';
        namesCheckbox.checked = !!col.includeNames;
        namesCheckbox.style.cssText = `
            width: 11px;
            height: 11px;
            cursor: pointer;
            margin: 0;
            accent-color: var(--md-primary);
        `;
        namesCheckbox.addEventListener('mousedown', (e) => e.stopPropagation());
        namesCheckbox.addEventListener('change', (e) => {
            col.includeNames = e.target.checked;
            if (window.nodeManager) window.nodeManager.calculateAll();
        });
        namesLabel.appendChild(namesCheckbox);
        namesLabel.appendChild(document.createTextNode('имена'));
        metaLine.appendChild(namesLabel);

        const formatSelect = document.createElement('select');
        formatSelect.className = 'table-format-select';
        formatSelect.title = 'Формат значения';
        formatSelect.style.cssText = `
            flex-shrink: 0;
            width: 56px;
            background: rgba(0, 0, 0, 0.3);
            border: 1px solid var(--md-divider);
            border-radius: 4px;
            color: var(--md-text);
            font-size: 10px;
            padding: 2px 2px;
            font-family: inherit;
            cursor: pointer;
            outline: none;
        `;
        formatSelect.innerHTML = `
            <option value="">Авто</option>
            <option value="number">Число</option>
            <option value="currency">Деньги</option>
            <option value="percent">%</option>
        `;
        formatSelect.value = col.formatOverride || '';
        formatSelect.addEventListener('mousedown', (e) => e.stopPropagation());
        formatSelect.addEventListener('change', (e) => {
            col.formatOverride = e.target.value || null;
            if (window.nodeManager) window.nodeManager.calculateAll();
        });
        metaLine.appendChild(formatSelect);

        const widthInput = document.createElement('input');
        widthInput.type = 'number';
        widthInput.className = 'table-width-input';
        widthInput.title = 'Ширина столбца в выходной таблице, px (пусто = авто)';
        widthInput.placeholder = 'авто';
        widthInput.min = '30';
        widthInput.step = '5';
        widthInput.value = col.width ?? '';
        widthInput.style.cssText = `
            width: 42px;
            flex-shrink: 0;
            background: rgba(0, 0, 0, 0.3);
            border: 1px solid var(--md-divider);
            border-radius: 4px;
            color: var(--md-text);
            font-size: 10px;
            padding: 2px 4px;
            font-family: inherit;
            outline: none;
            text-align: center;
        `;
        widthInput.addEventListener('mousedown', (e) => e.stopPropagation());
        widthInput.addEventListener('input', (e) => {
            const val = parseInt(e.target.value, 10);
            col.width = (e.target.value === '' || isNaN(val)) ? null : Math.max(30, val);
            if (window.nodeManager) window.nodeManager.calculateAll();
        });
        metaLine.appendChild(widthInput);

        row.appendChild(metaLine);

        return row;
    }

    isSocketConnected(index) {
        const connections = window.connectionManager?.getConnections() || [];
        return connections.some(c => c.targetNodeId === this.id && c.targetSocket === index);
    }

    // Автодобавление свободного столбца - вызывается ядром
    // (connectionManager.addConnection) после каждого нового соединения.
    checkAndAddEmptySlot() {
        if (this.collapsed) return;
        if (this.columns.length >= this.maxColumns) return;

        const allFilled = this.columns.every(col => this.isSocketConnected(col.listIndex));
        if (!allFilled) return;

        this.columns.push({
            listIndex: this._nextIndex,
            stringIndex: this._nextIndex + 1,
            formatOverride: null,
            includeNames: false,
            width: null
        });
        this._nextIndex += 2;
        this.inputSockets = this.columns.flatMap(c => [c.listIndex, c.stringIndex]);
        this.inputs = this.inputSockets.length;

        setTimeout(() => {
            if (!this._isRerendering && !this.collapsed) {
                this.rerender();
            }
        }, 50);
    }

    removeColumn(index) {
        if (this.columns.length <= 1) {
            document.getElementById('status').textContent = '⚠️ Минимум 1 столбец';
            setTimeout(() => { document.getElementById('status').textContent = 'Готово'; }, 1500);
            return;
        }

        const col = this.columns[index];

        if (window.connectionManager) {
            const connections = window.connectionManager.getConnections();
            const filtered = connections.filter(c =>
                !(c.targetNodeId === this.id && (c.targetSocket === col.listIndex || c.targetSocket === col.stringIndex))
            );
            window.connectionManager.connections = filtered;
            if (window.renderer) {
                window.renderer.drawAllConnections(filtered);
            }
        }

        this.columns.splice(index, 1);
        this.inputSockets = this.columns.flatMap(c => [c.listIndex, c.stringIndex]);
        this.inputs = this.inputSockets.length;

        this.rerender();

        if (window.nodeManager) {
            window.nodeManager.calculateAll();
            if (window.renderer) window.renderer.updateAllDisplays();
        }
    }

    rerender() {
        if (this._isRerendering) return;
        this._isRerendering = true;

        const el = document.querySelector(`[data-node-id="${this.id}"]`);
        if (el) {
            el.remove();
            if (window.nodeManager) {
                window.nodeManager.renderNode(this);
                if (window.renderer) {
                    window.renderer.drawAllConnections(window.connectionManager?.getConnections() || []);
                }
            }
        }

        setTimeout(() => { this._isRerendering = false; }, 100);
    }

    calculate(nodeManager) {
        const connections = window.connectionManager?.getConnections() || [];

        const columns = this.columns.flatMap((col, i) => {
            const listConn = connections.find(c => c.targetNodeId === this.id && c.targetSocket === col.listIndex);
            const strConn = connections.find(c => c.targetNodeId === this.id && c.targetSocket === col.stringIndex);

            const listSrc = listConn ? nodeManager.getNode(listConn.sourceNodeId) : null;
            // Столбец без подключённого LIST-источника - "заготовка" для
            // следующего соединения (см. checkAndAddEmptySlot), а не
            // реальные данные. В tableData она не попадает - иначе
            // потребители (Viewer, PercentageNode) показывали бы пустой
            // столбец без значений.
            if (!listSrc) return [];

            const items = listSrc.listData?.items || [];
            const values = items.length > 0
                ? listSrc.listData.values
                : (typeof listSrc.value === 'number' ? [listSrc.value] : []);

            const strSrc = strConn ? nodeManager.getNode(strConn.sourceNodeId) : null;
            const header = (typeof strSrc?.value === 'string' && strSrc.value.trim())
                ? strSrc.value.trim()
                : (listSrc.listData?.metadata?.title || listSrc.getDisplayName?.() || `Столбец ${i + 1}`);

            // Приоритет формата: ручной выбор в колонке -> формат,
            // объявленный источником-списком -> 'number' по умолчанию
            const format = col.formatOverride
                || (typeof listSrc.getValueFormat === 'function' ? listSrc.getValueFormat() : null)
                || 'number';

            const entries = [];

            // Названия строк (item.name) - отдельный текстовый столбец
            // ПЕРЕД числовым, если пользователь включил переключатель
            if (col.includeNames && items.length > 0) {
                entries.push({
                    header: `${header} (имена)`,
                    values: items.map(it => it.name || ''),
                    format: 'text',
                    width: null
                });
            }

            entries.push({ header, values, format, width: col.width || null });

            return entries;
        });

        this.tableData = new TableData(columns, { title: this.customName || this.getDisplayName() });
        this.value = this.tableData.rowCount;

        setTimeout(() => this.checkAndAddEmptySlot(), 100);

        return this.value;
    }

    updateDisplay(element) {
        const countEl = element.querySelector('.table-output-count');
        if (countEl) {
            countEl.textContent = `${this.tableData.columns.length}×${this.tableData.rowCount}`;
        }
    }
}
