/**
 * SPDX-License-Identifier: MIT
 * SPDX-FileCopyrightText: 2024 NodeCalculate Team
 * SPDX-FileCopyrightText: 2024 Pavel Fomin
 *
 * @file    tableViewerNode.js
 * @brief   Нода просмотра таблицы (Data), без выходов
 * @author  Pavel Fomin
 * @version 1.8.20
 * @see     https://github.com/GhostPWLk1n/NodeCalculator.git
 */

import { BaseNode } from './baseNode.js';
import { Helpers } from '../utils/helpers.js';
import { TableData } from '../utils/dataTypes.js';
import { SocketFactory } from '../utils/socketFactory.js';
import { attachColumnResizeHandle } from '../utils/columnResize.js';

const ROW_HEIGHT = 22;         // px, оценка высоты строки тела (фолбэк до первого измерения)
const MAX_VISIBLE_ROWS = 8;    // после скольки строк тело включает внутренний скролл
const MIN_WRAP_HEIGHT = 40;    // px, чтобы пустая/маленькая таблица не схлопывалась в ничто
const DEFAULT_COL_WIDTH = 90;  // px, ширина столбца без ручной настройки (col.width)

const EYE_OPEN = '●';   // номера строк показаны
const EYE_CLOSED = '‿'; // номера строк замаскированы

/**
 * TableViewerNode - только просмотр: один вход Data, без выходов.
 *
 * АРХИТЕКТУРА БЕЗ position:sticky. Раньше шапка и строка "Итого" были
 * sticky-ячейками внутри одной прокручиваемой `<table>` - это упиралось в
 * известную особенность рендеринга Chromium (прокручиваемый контент мог
 * "просвечивать" сквозь sticky-ячейки, а высота окна прокрутки считалась
 * неточно, потому что нужно было заранее прикидывать высоту шапки/итога).
 *
 * Вместо этого шапка, тело и итог - три ФИЗИЧЕСКИ РАЗДЕЛЬНЫХ блока в
 * обычном потоке документа:
 *   [headerRow]   - обычный поток, НЕ прокручивается сам по себе
 *   [bodyScroll]  - собственный вертикальный скролл (overflow-y:auto)
 *   [footerRow]   - обычный поток, НЕ прокручивается сам по себе
 * Все три - flex-строки с ОДИНАКОВЫМИ явными пиксельными ширинами ячеек
 * (numColWidth для номеров строк, col.width/DEFAULT_COL_WIDTH для
 * остальных) - поэтому столбцы всегда совпадают между шапкой/телом/
 * итогом без какой-либо ручной синхронизации через JS.
 *
 * Горизонтальный скролл - ТОЛЬКО на внешней обёртке (.table-viewer-wrap),
 * один нативный скроллбар на все три блока разом (Раунд 47 - раньше был
 * скрыт баг: bodyScroll стретчился на всю ширину wrap (флекс-контейнер
 * `wrap` по умолчанию растягивает элементы по кросс-оси - align-items:
 * stretch), и раз его контент (строки таблицы) шире этой растянутой
 * ширины, у bodyScroll САМОГО появлялся собственный горизонтальный
 * скролл - ровно тот самый "задублированный скролл". Спека CSS здесь
 * подставляет ловушку: если overflow-y задан (auto), а overflow-x не
 * задан явно (остаётся 'visible' по умолчанию), браузер обязан ТОЖЕ
 * трактовать overflow-x как 'auto' - "молчаливого" overflow-x:visible
 * с overflow-y:auto не бывает. headerRow/footerRow УЖЕ были защищены от
 * этого через `align-self: flex-start` (выходят из-под stretch, сами
 * определяют свою ширину по контенту) - bodyScroll этого не делал.
 * Теперь bodyScroll тоже `align-self: flex-start` (та же ширина по
 * контенту, что и у шапки/итога) + `overflow-x: hidden` (явно, а не
 * "промолчать" - подстраховка от той же ловушки спеки) - вылезание по
 * ширине теперь ловит ТОЛЬКО внешняя обёртка, один скроллбар на всё.
 *
 * Высота bodyScroll выставлена через flex (flex:1, min-height:0) с
 * потолком max-height, посчитанным по РЕАЛЬНО измеренной высоте первой
 * строки - шапка и итог в этот расчёт вообще не входят, потому что
 * физически лежат ВНЕ прокручиваемой области. Это и убирает саму
 * причину бага "на строку заголовков ниже / на строку итогов короче",
 * а не просто маскирует симптом.
 *
 * Столбец номеров строк - фиксированной ширины, подобранной под самое
 * крупное число в текущих данных (как в Excel).
 *
 * Клик по стрелке рядом с заголовком столбца сортирует строки по этому
 * столбцу: по возрастанию → по убыванию → как есть (три состояния по кругу).
 * Сортировка - чисто визуальная, исходные данные в TableNode не трогает.
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
        this.sortColumnIndex = config.sortColumnIndex ?? null;
        this.sortDirection = config.sortDirection ?? null; // 'asc' | 'desc' | null
        // Высота видимой области таблицы, если пользователь тянул общую
        // ручку ресайза ноды по вертикали (см. beginFreeResize/applyFreeResize
        // ниже) - null = высота подбирается автоматически по числу строк.
        this.wrapHeight = config.wrapHeight ?? null;
        // Раунд 93 (чек-лист 1.7.21, п.4.1) - ручное растягивание ширины
        // столбца мышью (attachColumnResizeHandle) - ключ по ЗАГОЛОВКУ
        // столбца (не по индексу - переживает переупорядочивание/
        // добавление столбцов в источнике разумным образом). Это ширина
        // ИМЕННО ЭТОГО просмотрщика, не источника - разные просмотрщики
        // одних и тех же данных могут иметь разную ширину столбцов,
        // как в обычном табличном редакторе.
        this.columnWidths = config.columnWidths ? { ...config.columnWidths } : {};

        // Багфикс (Раунд 77, по жалобе Mr.D: "если таблица очень большая,
        // начинает зависать") - см. подробный комментарий у updateDisplay()
        // ниже про причину и решение (кеш по дешёвой сигнатуре содержимого).
        this._lastRenderedSignature = null;
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
            min-width: 150px;
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

        const wrap = document.createElement('div');
        wrap.className = 'table-viewer-wrap';
        wrap.style.cssText = `
            display: flex;
            flex-direction: column;
            overflow-x: auto;
            overflow-y: hidden;
            min-width: 120px;
        `;
        // Ресайз только через общую ручку ноды (правый нижний угол,
        // см. nodeManager.startResize/applyFreeResize ниже) - раньше
        // здесь ещё был свой нативный resize:both, который по сути
        // дублировал ту же самую ручку у ноды. mousedown всё равно
        // останавливаем - иначе клик/скролл по таблице сдвигал бы ноду.
        wrap.addEventListener('mousedown', (e) => e.stopPropagation());

        this.renderTable(wrap);
        content.appendChild(wrap);

        return content;
    }

    // === Свободный ресайз через общую ручку ноды (nodeManager.js) ===
    // Реализация этих двух методов - это и есть "разрешение" для
    // nodeManager тянуть высоту той же самой ручкой, что обычно тянет
    // только ширину (см. docs/NODE_API.md). Дополнительная высота идёт
    // именно в .table-viewer-body-scroll, а НЕ в .table-viewer-wrap -
    // раньше высота ставилась на wrap, у которого overflow:auto (обе оси
    // разом), и получалось два вложенных скролла: внешний (wrap, двигал
    // шапку+тело+итог целиком) и внутренний (bodyScroll, двигал только
    // строки) - тот самый "двойной скролл".

    beginFreeResize(el) {
        const bodyScroll = el.querySelector('.table-viewer-body-scroll');
        this._resizeStartWrapHeight = bodyScroll ? bodyScroll.offsetHeight : MIN_WRAP_HEIGHT;
    }

    applyFreeResize(el, deltaY) {
        const bodyScroll = el.querySelector('.table-viewer-body-scroll');
        if (!bodyScroll) return;
        const newHeight = Math.max(MIN_WRAP_HEIGHT, (this._resizeStartWrapHeight || MIN_WRAP_HEIGHT) + deltaY);
        bodyScroll.style.maxHeight = 'none';
        bodyScroll.style.height = newHeight + 'px';
        this.wrapHeight = newHeight;
    }

    // Ширина каждого столбца - явная и одинаковая для шапки/тела/итога.
    // Для столбцов без ручной настройки (col.width) берём эвристику по
    // длине заголовка вместо единого DEFAULT_COL_WIDTH - чуть более
    // адекватный дефолт, но всё ещё детерминированный (без измерения
    // реального DOM), так что три независимых блока гарантированно
    // совпадают по ширине столбцов без JS-синхронизации.
    getColumnWidths() {
        return this.tableData.columns.map(col => {
            if (this.columnWidths[col.header] != null) return this.columnWidths[col.header];
            if (col.width) return col.width;
            const guess = (col.header?.length || 6) * 7 + 24;
            return Math.max(50, Math.min(140, guess));
        });
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
            } else if (typeof va === 'boolean' && typeof vb === 'boolean') {
                // Раунд 49 - раньше это тоже падало в ветку ниже
                // (String(true).localeCompare(String(false))) - работало
                // только по случайному совпадению ("false" < "true"
                // алфавитно), явное сравнение надёжнее и не зависит от
                // того, как называются булевы значения в других языках
                cmp = va === vb ? 0 : (va ? 1 : -1);
            } else {
                cmp = String(va ?? '').localeCompare(String(vb ?? ''));
            }
            return this.sortDirection === 'asc' ? cmp : -cmp;
        });
        return order;
    }

    // Одна ячейка (используется и в шапке, и в теле, и в итоге) -
    // фиксированная ширина, общая логика обрезания текста/выравнивания.
    buildCell(width, textAlign, extraStyle = '') {
        const cell = document.createElement('div');
        cell.style.cssText = `
            box-sizing: border-box;
            width: ${width}px;
            min-width: ${width}px;
            max-width: ${width}px;
            flex-shrink: 0;
            text-align: ${textAlign};
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            ${extraStyle}
        `;
        return cell;
    }

    buildHeaderRow(numColWidth, colWidths) {
        const headerRow = document.createElement('div');
        headerRow.className = 'table-viewer-header-row';
        headerRow.style.cssText = `
            display: inline-flex;
            align-self: flex-start;
            flex-shrink: 0;
            background: var(--md-surface-variant);
            border-bottom: 1px solid var(--md-divider);
        `;

        // Первая ячейка - кнопка-глазик. Столбец с номерами и сама кнопка
        // ВСЕГДА на месте - переключатель маскирует только цифры под ним,
        // а не убирает ячейку целиком.
        const eyeCell = this.buildCell(numColWidth, 'right', 'padding: 4px 6px;');
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
            const wrap = eyeBtn.closest ? eyeBtn.closest('.table-viewer-wrap') : null;
            this._rerenderWrap(wrap);
        });
        eyeCell.appendChild(eyeBtn);
        headerRow.appendChild(eyeCell);

        this.tableData.columns.forEach((col, colIdx) => {
            const isText = col.format === 'text';
            const isSortActive = this.sortColumnIndex === colIdx;
            // Раунд 49 - см. тот же приём в TableWidgetRenderer - булев
            // столбец определяем по факту булевых значений в нём (не по
            // col.format, обычно 'text' для таких столбцов), и центрируем
            // шапку, чтобы она не "убегала" влево от центрированных
            // чекбоксов-ячеек под ней
            const isBoolColumn = col.format === 'boolean' || col.values.some(v => typeof v === 'boolean');
            const justify = isBoolColumn ? 'center' : (isText ? 'flex-start' : 'flex-end');

            const th = this.buildCell(colWidths[colIdx], isBoolColumn ? 'center' : (isText ? 'left' : 'right'), `
                padding: 4px 8px 4px 4px;
                color: var(--md-text-secondary);
                font-weight: 500;
                font-size: 11px;
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: ${justify};
                gap: 4px;
            `);
            th.title = col.header;

            const headerText = document.createElement('span');
            headerText.textContent = col.header;
            headerText.style.cssText = 'overflow:hidden; text-overflow:ellipsis; white-space:nowrap;';
            th.appendChild(headerText);

            const sortIcon = document.createElement('span');
            sortIcon.className = 'table-viewer-sort-icon';
            sortIcon.textContent = isSortActive ? (this.sortDirection === 'asc' ? '↑' : '↓') : '↕';
            sortIcon.style.cssText = `
                font-size: 9px;
                flex-shrink: 0;
                opacity: ${isSortActive ? '1' : '0.35'};
                color: ${isSortActive ? 'var(--md-primary)' : 'inherit'};
            `;
            th.appendChild(sortIcon);

            // Раунд 93 (чек-лист, п.4.1) - ручка растягивания. Сохраняет
            // в this.columnWidths по ЗАГОЛОВКУ столбца, не по индексу -
            // переживает переупорядочивание источника разумным образом.
            attachColumnResizeHandle(th, colWidths[colIdx], (finalWidth) => {
                this.columnWidths[col.header] = finalWidth;
                const wrap = th.closest ? th.closest('.table-viewer-wrap') : null;
                this._rerenderWrap(wrap);
            });

            th.addEventListener('mousedown', (e) => e.stopPropagation());
            th.addEventListener('click', (e) => {
                e.stopPropagation();
                if (this.sortColumnIndex !== colIdx) {
                    this.sortColumnIndex = colIdx;
                    this.sortDirection = 'asc';
                } else if (this.sortDirection === 'asc') {
                    this.sortDirection = 'desc';
                } else {
                    this.sortColumnIndex = null;
                    this.sortDirection = null;
                }
                const wrap = th.closest ? th.closest('.table-viewer-wrap') : null;
                this._rerenderWrap(wrap);
            });

            headerRow.appendChild(th);
        });

        return headerRow;
    }

    buildDataRow(srcRowIndex, displayIndex, numColWidth, colWidths) {
        const row = document.createElement('div');
        row.className = 'table-viewer-data-row';
        row.style.cssText = 'display:inline-flex; align-self:flex-start;';

        const numCell = this.buildCell(numColWidth, 'right', `
            padding: 3px 6px;
            color: var(--md-text-disabled);
            font-size: 9px;
            font-variant-numeric: tabular-nums;
            visibility: ${this.showRowNumbers ? 'visible' : 'hidden'};
        `);
        numCell.className = 'table-viewer-row-num';
        numCell.textContent = String(displayIndex + 1);
        row.appendChild(numCell);

        this.tableData.columns.forEach((col, colIdx) => {
            const isText = col.format === 'text';
            const v = col.values[srcRowIndex];
            const hasValue = v !== undefined && v !== null && v !== '';
            // Раунд 56 - не только "значение УЖЕ булево" (typeof), но и
            // "столбец ЯВНО объявлен логическим" (col.format === 'boolean',
            // TableFormatNode) - тогда чекбоксом рисуем ЛЮБОЕ значение,
            // приведённое к true/false через Helpers.coerceBool() (число
            // 0/1, текст "да"/"нет" и т.п. - не только настоящий JS-bool)
            const isBoolValue = typeof v === 'boolean' || col.format === 'boolean';
            const isStripe = displayIndex % 2 === 0;

            const cell = this.buildCell(colWidths[colIdx], isBoolValue ? 'center' : (isText ? 'left' : 'right'), `
                position: relative;
                padding: 3px 10px 3px 4px;
                color: var(--md-text);
                font-size: 11px;
                ${isText ? '' : 'font-variant-numeric: tabular-nums;'}
                ${isStripe ? 'background: rgba(255,255,255,0.02);' : ''}
            `);

            if (isBoolValue) {
                // Раунд 49 - булево значение показываем чекбоксом, а не
                // текстом "true"/"false" (Helpers.formatByType просто
                // делает String(v) для нечисловых значений - для bool
                // это буквально "true"/"false", нечитаемо на глаз рядом
                // с остальными столбцами). Только просмотр - таблица тут
                // обычно уже вычисленный/импортированный результат, а не
                // прямой пользовательский ввод.
                const checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.className = 'table-cell-checkbox';
                checkbox.checked = hasValue ? Helpers.coerceBool(v) : false;
                checkbox.disabled = true;
                cell.appendChild(checkbox);
            } else if (hasValue && col.format === 'percent') {
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
                cell.appendChild(bar);

                const textSpan = document.createElement('span');
                textSpan.style.cssText = 'position: relative; z-index: 1;';
                textSpan.textContent = Helpers.formatByType(v, col.format, col.decimals);
                cell.appendChild(textSpan);
            } else {
                const textSpan = document.createElement('span');
                textSpan.style.cssText = 'position: relative; z-index: 1;';
                textSpan.textContent = hasValue ? Helpers.formatByType(v, col.format, col.decimals) : '—';
                cell.appendChild(textSpan);
            }

            row.appendChild(cell);
        });

        return row;
    }

    buildFooterRow(numColWidth, colWidths) {
        const footerRow = document.createElement('div');
        footerRow.className = 'table-viewer-footer-row';
        footerRow.style.cssText = `
            display: inline-flex;
            align-self: flex-start;
            flex-shrink: 0;
            background: var(--md-surface-variant);
            border-top: 1px solid var(--md-divider);
        `;

        const labelCell = this.buildCell(numColWidth, 'right', `
            padding: 4px 6px;
            color: var(--md-text-secondary);
            font-weight: 500;
            font-size: 11px;
        `);
        labelCell.className = 'table-viewer-row-num';
        labelCell.textContent = 'Σ';
        labelCell.title = 'Итого';
        footerRow.appendChild(labelCell);

        this.tableData.columns.forEach((col, colIdx) => {
            const isText = col.format === 'text';
            const agg = this.tableData.aggregate(col);

            const cell = this.buildCell(colWidths[colIdx], isText ? 'left' : 'right', `
                padding: 4px 10px 4px 4px;
                color: var(--md-text);
                font-weight: 500;
                font-size: 11px;
                ${isText ? '' : 'font-variant-numeric: tabular-nums;'}
            `);
            cell.textContent = agg === null ? '' : Helpers.formatByType(agg, col.format, col.decimals);
            footerRow.appendChild(cell);
        });

        return footerRow;
    }

    // Небольшой помощник: если по какой-то причине не удалось достать wrap
    // через closest() (например, в упрощённом тестовом DOM), просто
    // находим его через родительский узел содержимого ноды.
    _rerenderWrap(wrap) {
        if (!wrap) {
            const el = document.querySelector(`[data-node-id="${this.id}"]`);
            wrap = el ? el.querySelector('.table-viewer-wrap') : null;
        }
        if (wrap) this.renderTable(wrap);
    }

    renderTable(wrap) {
        // Индекс сортировки мог "протухнуть", если у источника изменился
        // набор столбцов - тогда просто сбрасываем сортировку.
        if (this.sortColumnIndex !== null && this.sortColumnIndex >= this.tableData.columns.length) {
            this.sortColumnIndex = null;
            this.sortDirection = null;
        }

        wrap.innerHTML = '';

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

        const rowCount = this.tableData.rowCount;
        const rowOrder = this.getRowOrder();

        // Фиксированная ширина столбца номеров - под самое крупное число
        // в текущих данных (как в Excel)
        const digits = String(Math.max(rowCount, 1)).length;
        const numColWidth = Math.max(22, digits * 7 + 14);
        const colWidths = this.getColumnWidths();

        // === ШАПКА - обычный поток, ВНЕ прокручиваемой области ===
        const headerRow = this.buildHeaderRow(numColWidth, colWidths);
        wrap.appendChild(headerRow);

        // === ТЕЛО - единственная часть с собственным вертикальным скроллом ===
        const bodyScroll = document.createElement('div');
        bodyScroll.className = 'table-viewer-body-scroll';
        bodyScroll.style.cssText = `
            flex: 1 1 auto;
            align-self: flex-start;
            min-height: 0;
            overflow-y: auto;
            overflow-x: hidden;
            scrollbar-gutter: stable;
        `;

        const bodyInner = document.createElement('div');
        bodyInner.className = 'table-viewer-body-inner';
        bodyInner.style.cssText = 'display:flex; flex-direction:column;';

        rowOrder.forEach((srcRowIndex, displayIndex) => {
            bodyInner.appendChild(this.buildDataRow(srcRowIndex, displayIndex, numColWidth, colWidths));
        });
        bodyScroll.appendChild(bodyInner);
        wrap.appendChild(bodyScroll);

        // === ИТОГО - обычный поток, ВНЕ прокручиваемой области, только
        // если хотя бы один столбец просит итог ===
        const hasTotals = this.tableData.columns.some(c => c.totalType);
        if (hasTotals) {
            wrap.appendChild(this.buildFooterRow(numColWidth, colWidths));
        }

        // Высота ТОЛЬКО тела - шапка и итог физически вне этой области,
        // поэтому их размер вообще не участвует в расчёте (в отличие от
        // старой sticky-версии, где это и было источником ошибки).
        // this.wrapHeight - JS-свойство, а не инспекция DOM: раньше
        // проверяли inline-стили wrap ("wrap.style.width||height"), но
        // высоту теперь ставим на bodyScroll, а не на wrap - DOM-проверка
        // была бы неверной целью.
        if (this.wrapHeight) {
            bodyScroll.style.maxHeight = 'none';
            bodyScroll.style.height = this.wrapHeight + 'px';
        } else {
            const firstRow = bodyInner.firstChild;
            const rowH = firstRow?.offsetHeight || ROW_HEIGHT;
            const visibleRows = Math.min(rowCount, MAX_VISIBLE_ROWS);
            bodyScroll.style.maxHeight = Math.max(visibleRows * rowH, ROW_HEIGHT) + 'px';
        }

        // Кеш сигнатуры обновляется ЗДЕСЬ, а не в updateDisplay() - так
        // прямые вызовы renderTable() (клик по заголовку для сортировки,
        // ресайз и т.п., см. другие вызовы этого метода) тоже держат кеш
        // свежим, без лишнего повторного рендера на следующем
        // updateDisplay() (см. её докстринг про причину кеша).
        this._lastRenderedSignature = this._computeSignature();
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
        // Раунд 84 - через getSourceOutput(), не srcNode.tableData
        // напрямую - учитывает конкретный выходной сокет источника (см.
        // BaseNode.getOutputBySocket()/nodeManager.getSourceOutput()) -
        // для обычных однослойных источников поведение не меняется.
        const output = nodeManager.getSourceOutput(input);
        if (!srcNode || !output?.tableData) {
            this.tableData = new TableData();
            this.sourceName = null;
            return null;
        }

        this.sourceName = srcNode.customName
            || output.tableData.metadata?.title
            || srcNode.getDisplayName?.()
            || null;

        this.tableData = output.tableData;

        return this.tableData.rowCount;
    }

    // Быстрый отпечаток содержимого + значимых для рендера опций отображения -
    // НЕ криптографический хэш, просто дешёвое (один линейный проход,
    // FNV-1a смешивание символов без построения промежуточных строк)
    // средство отличить "таблица реально изменилась" от "пересчитался
    // граф, а эта конкретная таблица - нет". Reference-сравнение
    // (this.tableData === старый объект) здесь не годится - src-нода
    // пересоздаёт TableData на КАЖДЫЙ calculate(), даже если значения не
    // изменились (см. calculate() выше - обычный паттерн всех табличных
    // нод проекта), так что ссылка меняется каждый раз независимо от
    // содержимого.
    _computeSignature() {
        let hash = 2166136261 >>> 0;
        const mix = (str) => {
            for (let i = 0; i < str.length; i++) {
                hash ^= str.charCodeAt(i);
                hash = Math.imul(hash, 16777619) >>> 0;
            }
        };
        const t = this.tableData;
        mix(`${t.rowCount}|${t.columns.length}|${this.showRowNumbers}|${this.sortColumnIndex}|${this.sortDirection}|${this.wrapHeight}|`);
        t.columns.forEach(col => {
            mix(`${col.header}:${col.format}|`);
            for (let i = 0; i < col.values.length; i++) {
                mix(String(col.values[i]));
                mix('|');
            }
        });
        return hash;
    }

    updateDisplay(element) {
        const infoLabel = element.querySelector('.table-viewer-info');
        if (infoLabel) {
            infoLabel.textContent = `${this.tableData.columns.length}×${this.tableData.rowCount}`;
        }

        const wrap = element.querySelector('.table-viewer-wrap');
        if (wrap) {
            if (this._computeSignature() !== this._lastRenderedSignature) {
                this.renderTable(wrap);
            }
        }

        const titleText = element.querySelector('.title-text');
        if (titleText && !this.customName) {
            titleText.textContent = this.getDisplayName();
        }
    }
}
