/**
 * SPDX-License-Identifier: MIT
 * SPDX-FileCopyrightText: 2024 NodeCalculate Team
 * SPDX-FileCopyrightText: 2024 Pavel Fomin
 *
 * @file    xlsxImportNode.js
 * @brief   Обработчик: импорт выбранных листа/столбцов из .xlsx - на выходе DATA
 * @author  Pavel Fomin
 * @version 1.8.9
 * @see     https://github.com/GhostPWLk1n/NodeCalculator.git
 */

import { BaseNode } from './baseNode.js';
import { TableData } from '../utils/dataTypes.js';
import { SocketFactory } from '../utils/socketFactory.js';
import { XlsxReader } from '../utils/xlsxReader.js';

/**
 * XlsxImportNode - источник данных (входов нет, как у ListInputNode),
 * выход - Data (ромб, оранжевый), та же "порода" сокета, что у TableNode.
 *
 * Работа с файлом - в ДВА явных шага, специально так, чтобы НЕ разбирать
 * весь .xlsx целиком на каждый пересчёт графа:
 *
 *   1. "Выбрать файл" (тело ноды) - читает файл и делает "поверхностное"
 *      сканирование (XlsxReader.scanOutline): имена листов + ПЕРВАЯ
 *      строка (заголовки) каждого - быстро, без разбора всех строк.
 *      Результат сканирования (this._outline) и сами байты файла
 *      (this._arrayBuffer) - ТРАНЗИТНОЕ состояние только текущей сессии,
 *      НЕ сериализуется (см. ниже, почему).
 *   2. "Импортировать выбранное" (боковая панель - выбор листа + галочки
 *      нужных столбцов) - разбирает ПОЛНОСТЬЮ, но ТОЛЬКО выбранный лист,
 *      и сохраняет ТОЛЬКО выбранные столбцы в this.importedHeaders/
 *      this.importedRows - это уже обычные сериализуемые данные ноды,
 *      как у ListInputNode.items.
 *
 * calculate() НИЧЕГО не делает с файлом - просто отдаёт то, что уже
 * импортировано (this.tableData строится один раз в _buildTableData(),
 * вызывается только из _importSelected() и конструктора при загрузке
 * проекта, не на каждый пересчёт). Именно это и было целью: "чтобы
 * постоянно не обрабатывать весь xlsx".
 *
 * this._arrayBuffer НЕ сериализуется намеренно - сырые байты файла
 * (может быть много мегабайт) раздули бы .ncp-проект и дублировали бы
 * то, что уже есть на диске у пользователя. После сохранения/загрузки
 * проекта повторный выбор листа/столбцов недоступен, пока файл не будет
 * выбран заново в этой сессии - зато уже импортированные данные
 * (importedHeaders/importedRows) переживают сохранение/загрузку как
 * обычные данные ноды.
 *
 * ИЗВЕСТНЫЕ УПРОЩЕНИЯ (см. также докстринг XlsxReader):
 *   - Даты приходят как числа (серийный день) - .xlsx хранит формат
 *     ячейки отдельно от значения, styles.xml не разбирается.
 *   - Только .xlsx (Office Open XML) - старый бинарный .xls не читается.
 */
export class XlsxImportNode extends BaseNode {
    constructor(id, type, x, y, config = {}) {
        super(id, type, x, y, config);
        this.inputs = 0;
        this.inputSockets = [];
        this.outputs = 1;
        // Раунд 106 (чек-лист, раздел 2) - минимальная ширина 224px -
        // содержимое (кнопка выбора файла + имя файла + сокет) не
        // помещалось разборчиво при более узкой ноде.
        this.width = Math.max(config.width || 240, 224);
        this.minWidth = 224; // Раунд 106 - применяется и при ручном растягивании через UI

        this.fileName = config.fileName || null;
        this.selectedSheet = config.selectedSheet || null;
        // Индексы столбцов (не имена - у листа могут быть повторяющиеся
        // заголовки), выбранные для импорта в последний раз
        this.selectedColumns = Array.isArray(config.selectedColumns) ? config.selectedColumns : [];
        // Номер строки листа (1-based), которая считается заголовками -
        // по умолчанию первая, как и раньше, но не обязательно (Раунд 44:
        // в реальных файлах часто выше есть строка с названием отчёта,
        // пустая строка-отступ и т.п.) - см. _refreshHeadersForCurrentSheet()
        this.headerRow = config.headerRow ?? 1;

        // Максимальное количество столбцов для отображения
        this.maxColumns = config.maxColumns ?? 0; // 0 означает "все столбцы"

        // Уже импортированные данные - сериализуются, переживают
        // сохранение/загрузку проекта (см. докстринг класса)
        this.importedHeaders = Array.isArray(config.importedHeaders) ? config.importedHeaders : [];
        this.importedRows = Array.isArray(config.importedRows) ? config.importedRows : [];
        // Раунд 96 - цвет заливки каждой импортированной ячейки,
        // ВЫРОВНЕННЫЙ по this.importedRows (та же форма - массив строк,
        // каждая строка - массив по тем же столбцам colsToKeep).
        // Раунд 114 (по жалобе Mr.D: "должен перевыгружать файлы после
        // загрузки") - раньше НЕ сериализовался (опасение раздуть
        // .ncp-файл) - но без него разбор дат по цвету у "Обработки
        // таблиц Ганта" молча ломался при каждой загрузке сохранённого
        // проекта - color-decoding работал только в ТОЙ ЖЕ сессии, где
        // файл был импортирован, требуя повторного выбора и импорта
        // файла заново после каждой загрузки. Полезность важнее размера
        // файла - теперь сериализуется, как и importedRows.
        this.cellColors = Array.isArray(config.cellColors) ? config.cellColors : [];

        // Транзитное состояние текущей сессии - НЕ сериализуется
        this._outline = null;
        this._arrayBuffer = null;
        this._isRerendering = false;

        this.tableData = this._buildTableData();
        this.value = this.importedRows.length;
    }

    createContent() {
        const content = document.createElement('div');
        content.className = 'node-content';
        content.style.cssText = 'width:100%; min-width:190px; display:flex; flex-direction:column; gap:6px;';

        // Скрытый файловый input - выбор триггерится кнопкой ниже.
        // accept=".xlsx" - у самого чтения (xlsxReader.js) поддержан
        // только Office Open XML, старый бинарный .xls не читается.
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = '.xlsx';
        fileInput.style.display = 'none';
        fileInput.addEventListener('mousedown', (e) => e.stopPropagation());
        fileInput.addEventListener('change', (e) => {
            const file = e.target.files && e.target.files[0];
            e.target.value = ''; // чтобы повторный выбор ТОГО ЖЕ файла тоже сработал (change иначе не сработает)
            if (file) this._onFilePicked(file);
        });
        content.appendChild(fileInput);

        const pickRow = document.createElement('div');
        pickRow.style.cssText = 'display:flex; align-items:center; gap:6px;';
        const pickBtn = document.createElement('button');
        pickBtn.className = 'xlsx-pick-btn';
        pickBtn.textContent = '📁 Выбрать файл';
        pickBtn.addEventListener('mousedown', (e) => e.stopPropagation());
        pickBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            fileInput.click();
        });
        pickRow.appendChild(pickBtn);
        content.appendChild(pickRow);

        const fileNameEl = document.createElement('div');
        fileNameEl.className = 'xlsx-filename';
        fileNameEl.textContent = this.fileName || 'файл не выбран';
        fileNameEl.title = this.fileName || '';
        content.appendChild(fileNameEl);

        const statusEl = document.createElement('div');
        statusEl.className = 'xlsx-status';
        statusEl.textContent = this._statusText();
        content.appendChild(statusEl);

        // Раунд 85 (по запросу Mr.D: "чтобы каждый раз не просматривать
        // список") - та же кнопка, что уже есть в панели инспектора
        // (getInspectorSchema(), в самом низу) - здесь прямо на теле
        // ноды, для быстрого повторного импорта уже выбранного листа/
        // столбцов без похода в панель. Вызывает ТОТ ЖЕ _importSelected() -
        // не дублирует логику, только доступ к ней.
        const reimportBtn = document.createElement('button');
        reimportBtn.className = 'node-action-btn';
        reimportBtn.textContent = '⬇️ Импортировать выбранное';
        reimportBtn.disabled = !this._outline || !this.selectedSheet;
        reimportBtn.addEventListener('mousedown', (e) => e.stopPropagation());
        reimportBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this._importSelected();
        });
        content.appendChild(reimportBtn);

        const outRow = document.createElement('div');
        outRow.style.cssText = `
            display: flex;
            align-items: center;
            gap: 8px;
            padding-top: 6px;
            margin-top: 2px;
            border-top: 1px solid var(--md-divider);
        `;
        const outLabel = document.createElement('label');
        outLabel.textContent = 'Данные (DATA):';
        outLabel.style.cssText = 'color:var(--md-text-secondary); font-size:11px; flex:1;';
        outRow.appendChild(outLabel);
        const outSocket = SocketFactory.createSocket({
            nodeId: this.id, socketType: 'output', index: 0, isData: true,
            title: 'Импортированные строки/столбцы из .xlsx'
        });
        outRow.appendChild(outSocket);
        content.appendChild(outRow);

        return content;
    }

    _statusText() {
        if (!this.importedHeaders.length) {
            return this._outline ? 'выберите лист и столбцы в панели →' : 'нет импортированных данных';
        }
        const displayCols = this.maxColumns > 0 && this.maxColumns < this.importedHeaders.length 
            ? this.maxColumns 
            : this.importedHeaders.length;
        return `${this.importedRows.length} строк × ${displayCols} из ${this.importedHeaders.length} столбцов (лист «${this.selectedSheet}»)`;
    }

    // Шаг 1 (см. докстринг класса) - "поверхностное" сканирование:
    // имена листов + заголовки, без разбора всех строк
    async _onFilePicked(file) {
        this.fileName = file.name;
        this._outline = null;
        this._arrayBuffer = null;

        const statusEl = document.getElementById('status');
        if (statusEl) statusEl.textContent = '⏳ Чтение структуры Excel...';

        try {
            this._arrayBuffer = await file.arrayBuffer();
            this._outline = await XlsxReader.scanOutline(this._arrayBuffer);

            const firstSheet = this._outline.sheets[0] || null;
            this.selectedSheet = firstSheet ? firstSheet.name : null;
            this.selectedColumns = firstSheet ? firstSheet.headers.map((_, i) => i) : [];

            if (statusEl) {
                statusEl.textContent = `📄 Листов найдено: ${this._outline.sheets.length}`;
                setTimeout(() => { statusEl.textContent = 'Готово'; }, 2000);
            }
        } catch (err) {
            console.error('Ошибка чтения .xlsx:', err);
            alert('Не удалось прочитать файл Excel: ' + err.message);
            this._outline = null;
            this._arrayBuffer = null;
            if (statusEl) statusEl.textContent = 'Готово';
        }

        this.rerender();
        if (window.inspectorManager?.isOpenFor(this.id)) window.inspectorManager.refresh();
    }

    // Шаг 2 (см. докстринг класса) - полный разбор ТОЛЬКО выбранного
    // листа, сохраняем ТОЛЬКО выбранные столбцы. Дальше calculate()
    // просто отдаёт уже готовый результат, файл больше не трогается.
    async _importSelected() {
        if (!this._outline || !this._arrayBuffer || !this.selectedSheet) {
            alert('Сначала выберите файл в теле ноды');
            return;
        }
        const sheet = this._outline.sheets.find(s => s.name === this.selectedSheet);
        if (!sheet) return;

        const statusEl = document.getElementById('status');
        if (statusEl) statusEl.textContent = '⏳ Импорт данных из Excel...';

        try {
            // Раунд 96 - readSheet() теперь возвращает {values, colors},
            // не голый rows-массив, как раньше - colors нужны "Обработке
            // таблиц Ганта" для разбора цветового кодирования дат.
            const { values: allRows, colors: allColors } = await XlsxReader.readSheet(this._arrayBuffer, this._outline, sheet.path);
            // this.headerRow - 1-based номер строки заголовков (Раунд 44,
            // по умолчанию 1 - первая строка, как было раньше); данные
            // начинаются СРАЗУ ПОСЛЕ неё - 0-based индекс первой строки
            // данных численно равен 1-based номеру строки заголовков
            const dataRows = allRows.slice(this.headerRow);
            const dataColors = allColors.slice(this.headerRow);
            
            // Определяем, какие столбцы будем показывать
            let colsToKeep = this.selectedColumns.length
                ? [...this.selectedColumns].sort((a, b) => a - b)
                : sheet.headers.map((_, i) => i);
            
            // Применяем ограничение на количество столбцов
            if (this.maxColumns > 0 && colsToKeep.length > this.maxColumns) {
                colsToKeep = colsToKeep.slice(0, this.maxColumns);
            }

            this.importedHeaders = colsToKeep.map(i => sheet.headers[i] || `Столбец ${i + 1}`);
            // Та же фильтрация (по values), применённая параллельно и к
            // цветам - importedRows[i]/cellColors[i] должны соответствовать
            // ОДНОЙ и той же исходной строке листа, иначе цвет "уехал" бы
            // не на ту задачу при разборе в GanttTableProcessorNode.
            const keepMask = dataRows.map(row => row.length > 0);
            this.importedRows = dataRows
                .filter((_, i) => keepMask[i])
                .map(row => colsToKeep.map(i => (row[i] === undefined ? null : row[i])));
            this.cellColors = dataColors
                .filter((_, i) => keepMask[i])
                .map(row => colsToKeep.map(i => (row?.[i] ?? null)));

            this.tableData = this._buildTableData();
            this.value = this.importedRows.length;

            if (statusEl) {
                statusEl.textContent = `✅ Импортировано строк: ${this.importedRows.length}`;
                setTimeout(() => { statusEl.textContent = 'Готово'; }, 2000);
            }

            if (window.nodeManager) window.nodeManager.calculateAll();
            this.rerender();
        } catch (err) {
            console.error('Ошибка импорта .xlsx:', err);
            alert('Не удалось импортировать данные: ' + err.message);
            if (statusEl) statusEl.textContent = 'Готово';
        }
    }

    // Перечитывает заголовки ТЕКУЩЕГО выбранного листа с УКАЗАННОЙ строки
    // (this.headerRow) вместо первой - вызывается, когда пользователь
    // меняет "Строку заголовков" или переключает лист, пока headerRow != 1
    // (см. getInspectorSchema()). Расжимает заново только ОДИН нужный
    // лист (XlsxReader.getHeadersAtRow переиспользует entries/
    // sharedStrings из this._outline) - не весь файл целиком.
    async _refreshHeadersForCurrentSheet() {
        if (!this._outline || !this.selectedSheet || !this._arrayBuffer) return;
        const sheetIdx = this._outline.sheets.findIndex(s => s.name === this.selectedSheet);
        if (sheetIdx === -1) return;
        const sheet = this._outline.sheets[sheetIdx];

        const statusEl = document.getElementById('status');
        if (statusEl) statusEl.textContent = '⏳ Чтение строки заголовков...';

        try {
            const headers = await XlsxReader.getHeadersAtRow(this._arrayBuffer, this._outline, sheet.path, this.headerRow - 1);
            this._outline.sheets[sheetIdx] = { ...sheet, headers };
            // Новая строка заголовков может иметь другой набор столбцов -
            // сбрасываем выбор на "все столбцы", как при первом выборе файла
            this.selectedColumns = headers.map((_, i) => i);
            if (statusEl) statusEl.textContent = 'Готово';
        } catch (err) {
            console.error('Ошибка чтения строки заголовков:', err);
            if (statusEl) statusEl.textContent = 'Готово';
        }

        if (window.inspectorManager) window.inspectorManager.refresh();
    }

    _buildTableData() {
        if (!this.importedHeaders.length) return new TableData();
        
        // Определяем, сколько столбцов показывать
        const displayHeaders = this.maxColumns > 0 && this.maxColumns < this.importedHeaders.length
            ? this.importedHeaders.slice(0, this.maxColumns)
            : this.importedHeaders;
        
        const columns = displayHeaders.map((header, colIdx) => {
            const values = this.importedRows.map(row => (row[colIdx] === undefined ? null : row[colIdx]));
            const isNumericCol = values.some(v => typeof v === 'number')
                && values.every(v => v === null || v === '' || typeof v === 'number');
            return { header, values, format: isNumericCol ? 'number' : 'text' };
        });
        return new TableData(columns, { title: this.customName || this.fileName || 'Excel' });
    }

    calculate(nodeManager) {
        // Никакой работы с файлом тут не происходит - см. докстринг класса
        this.value = this.importedRows.length;
        return this.value;
    }

    updateDisplay(element) {
        const fileNameEl = element.querySelector('.xlsx-filename');
        if (fileNameEl) {
            fileNameEl.textContent = this.fileName || 'файл не выбран';
            fileNameEl.title = this.fileName || '';
        }
        const statusEl = element.querySelector('.xlsx-status');
        if (statusEl) statusEl.textContent = this._statusText();
        const reimportBtn = element.querySelector('.node-action-btn');
        if (reimportBtn) reimportBtn.disabled = !this._outline || !this.selectedSheet;
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

    // Боковая панель: выбор листа + галочки столбцов + кнопка импорта.
    // Доступно только пока файл выбран В ЭТОЙ СЕССИИ (this._outline) -
    // после загрузки проекта заново нужно выбрать файл, см. докстринг класса.
    getInspectorSchema() {
        const fields = super.getInspectorSchema();

        fields.push({ type: 'section', label: 'Импорт из Excel' });

        if (!this._outline) {
            fields.push({
                type: 'section',
                label: this.fileName
                    ? `Уже импортировано из «${this.fileName}» - выберите файл заново в теле ноды, чтобы сменить лист/столбцы`
                    : 'Сначала выберите файл в теле ноды'
            });
            return fields;
        }

        fields.push({
            key: 'selectedSheet',
            label: 'Лист',
            type: 'select',
            options: this._outline.sheets.map(s => ({ value: s.name, label: s.name })),
            get: () => this.selectedSheet || '',
            set: (v) => {
                this.selectedSheet = v;
                if (this.headerRow > 1) {
                    // Строка заголовков не первая - переиспользуем ту же
                    // логику, что и при смене этой настройки, чтобы новый
                    // лист тоже читал заголовки с правильной строки, а не
                    // всегда с первой
                    this._refreshHeadersForCurrentSheet();
                } else {
                    const sheet = this._outline.sheets.find(s => s.name === v);
                    this.selectedColumns = sheet ? sheet.headers.map((_, i) => i) : [];
                }
                // Список чекбоксов столбцов зависит от выбранного листа -
                // без явного refresh() панель осталась бы со старыми
                // чекбоксами до следующего открытия/закрытия
                if (window.inspectorManager) window.inspectorManager.refresh();
            }
        });

        fields.push({
            key: 'headerRow',
            label: 'Строка заголовков (с 1)',
            type: 'number',
            min: 1, step: 1,
            get: () => this.headerRow,
            set: (v) => {
                this.headerRow = Math.max(1, v || 1);
                // Асинхронно - панель обновится сама, когда дочитает
                // (см. _refreshHeadersForCurrentSheet(), сама зовёт refresh())
                this._refreshHeadersForCurrentSheet();
            }
        });

        // Добавляем поле для ограничения количества столбцов
        fields.push({
            key: 'maxColumns',
            label: 'Максимум столбцов для отображения (0 - все)',
            type: 'number',
            min: 0, step: 1,
            get: () => this.maxColumns || 0,
            set: (v) => {
                this.maxColumns = Math.max(0, v || 0);
                // Обновляем отображение без повторного импорта
                this.tableData = this._buildTableData();
                this.rerender();
                if (window.nodeManager) window.nodeManager.calculateAll();
            }
        });

        const sheet = this._outline.sheets.find(s => s.name === this.selectedSheet);
        const headers = sheet ? sheet.headers : [];

        fields.push({ type: 'section', label: 'Столбцы для импорта' });
        
        // Показываем чекбоксы для всех столбцов, но с пометкой, какие будут отображаться
        const displayLimit = this.maxColumns > 0 ? this.maxColumns : headers.length;
        headers.forEach((header, i) => {
            const label = header || `Столбец ${i + 1}`;
            const isDisplayed = i < displayLimit;
            const isSelected = this.selectedColumns.includes(i);
            
            fields.push({
                key: `xlsxCol_${i}`,
                label: isDisplayed ? label : `${label} (не отображается)`,
                type: 'checkbox',
                disabled: !isDisplayed && displayLimit < headers.length,
                get: () => isSelected,
                set: (v) => {
                    if (v) {
                        if (!this.selectedColumns.includes(i)) {
                            // Если пытаемся выбрать столбец за пределами лимита, но лимит установлен
                            if (this.maxColumns > 0 && i >= this.maxColumns) {
                                alert(`Невозможно выбрать столбец ${i + 1}, так как он за пределами максимального количества отображаемых столбцов (${this.maxColumns}). Увеличьте значение "Максимум столбцов для отображения"`);
                                return;
                            }
                            this.selectedColumns.push(i);
                        }
                    } else {
                        this.selectedColumns = this.selectedColumns.filter(idx => idx !== i);
                    }
                }
            });
        });

        fields.push({
            type: 'button',
            label: '⬇️ Импортировать выбранное',
            disabled: !headers.length,
            onClick: () => this._importSelected()
        });

        return fields;
    }
}