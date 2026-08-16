/**
 * SPDX-License-Identifier: MIT
 * SPDX-FileCopyrightText: 2024 NodeCalculate Team
 * SPDX-FileCopyrightText: 2024 Pavel Fomin
 *
 * @file    columnFormatting.js
 * @brief   Общая логика оформления столбцов (палитры, применение стилей, поля инспектора) - единая для всех нод с tableData
 * @author  Pavel Fomin
 * @version 1.8.72
 * @see     https://github.com/GhostPWLk1n/NodeCalculator.git
 */

/**
 * columnFormatting.js - Раунд 90 (чек-лист 1.7.21, п.2/3, по объявленному
 * плану Mr.D): оформление (формат/цвет/итог/ширина по столбцу) переезжает
 * в панель инспектора КАЖДОЙ ноды с собственным tableData - вместо
 * отдельной ноды-посредника (`TableFormatNode`/`TreeFormatNode`,
 * см. плашку "Устарело" на них, Раунд 89). Одни и те же правила работают
 * и для Досок (виджет читает `col.color`/`col.format` и т.п. напрямую из
 * `tableData.columns[i]`), и для Листов (`TableViewerNode` читает те же
 * поля) - унификация получается САМА СОБОЙ, раз оба потребителя УЖЕ
 * читают одни и те же поля колонки, просто раньше их некому было
 * проставить без отдельной ноды.
 *
 * Использование в НОВОЙ ноде (3 шага):
 *   1. В конструкторе: `this.columnStyles = config.columnStyles ? [...config.columnStyles] : [];`
 *   2. В конце calculate(), после того как построены "сырые" колонки:
 *      `this.tableData = new TableData(applyColumnStyles(rawColumns, this.columnStyles), metadata);`
 *   3. В getInspectorSchema(): `fields.push(...buildColumnFormattingFields(this, this.tableData));`
 */

// Раунд 90 - "цветовые схемы" (по прямому запросу Mr.D: "набор готовых
// палитр плюс ручной цвет") - куратор-подобранный набор, а не
// произвольный color-picker как единственный вариант. Значения - те же
// design tokens, что уже используются по всему проекту (var(--md-...)),
// но здесь захардкожены как HEX (color-поле в инспекторе - обычный
// <input type="color">, CSS-переменную туда не положить).
export const COLOR_PALETTE = [
    { value: '', label: 'Без цвета' },
    { value: '#90caf9', label: 'Синий' },
    { value: '#a5d6a7', label: 'Зелёный' },
    { value: '#ffd54f', label: 'Жёлтый' },
    { value: '#ffb74d', label: 'Оранжевый' },
    { value: '#ef9a9a', label: 'Красный' },
    { value: '#ce93d8', label: 'Фиолетовый' },
    { value: '#80deea', label: 'Бирюзовый' },
    { value: '#e0e0e0', label: 'Серый' }
];

const CUSTOM_COLOR_VALUE = '__custom__';

// Растягивает/обрезает columnStyles до нужной длины, заполняя новые
// слоты (И любые "дыры" - undefined на отдельных индексах, могло бы
// возникнуть при миграции старых конфигов) пустым стилем - тот же
// паттерн, что раньше был приватным методом TableFormatNode/
// TreeFormatNode, теперь общий.
export function ensureColumnStyles(columnStyles, count) {
    for (let i = 0; i < count; i++) {
        if (!columnStyles[i]) {
            columnStyles[i] = { formatOverride: null, width: null, decimals: null, totalType: null, color: null };
        }
    }
    columnStyles.length = count;
    return columnStyles;
}

// Применяет columnStyles к "сырым" столбцам (header/values/format) -
// возвращает НОВЫЙ массив столбцов, готовый для `new TableData(...)`.
// rawColumns - обычный формат {header, values, format}[], тот же, что
// уже везде используется при построении tableData.
export function applyColumnStyles(rawColumns, columnStyles) {
    ensureColumnStyles(columnStyles, rawColumns.length);
    return rawColumns.map((col, i) => {
        const style = columnStyles[i] || {};
        return {
            header: col.header,
            values: col.values,
            format: style.formatOverride || col.format,
            width: style.width ?? null,
            decimals: style.decimals ?? null,
            totalType: style.totalType ?? null,
            color: style.color ?? null
        };
    });
}

/**
 * Строит поля панели инспектора "Отображение" (сворачиваемая секция,
 * Раунд 90 - см. inspectorManager.js) - по одному под-разделу на
 * столбец, с полями формата/итога/ширины/знаков после запятой/цвета
 * (палитра + свой цвет).
 *
 * @param {object} node - сама нода (нужны node.columnStyles - должен
 *   существовать заранее, см. докстринг класса выше)
 * @param {object} tableData - TableData, ПОСЛЕ применения стилей (те же
 *   столбцы, что уйдут потребителю) - берём заголовки оттуда
 * @param {object} [options]
 * @param {string[]} [options.excludeHeaders] - служебные столбцы, которые
 *   не нужно показывать в оформлении (например, "Ветка" у TreeNode -
 *   имя ветки, не оформляемое поле, см. её докстринг)
 */
export function buildColumnFormattingFields(node, tableData, { excludeHeaders = [] } = {}) {
    const fields = [];
    if (!tableData || !tableData.columns || tableData.columns.length === 0) return fields;

    fields.push({ type: 'section', label: 'Отображение', collapsible: true, collapsed: true });

    const visibleColumns = tableData.columns
        .map((col, rawIndex) => ({ col, rawIndex }))
        .filter(({ col }) => !excludeHeaders.includes(col.header));

    ensureColumnStyles(node.columnStyles, tableData.columns.length);

    visibleColumns.forEach(({ col, rawIndex }) => {
        const style = node.columnStyles[rawIndex] || {};

        fields.push({ type: 'section', label: `Столбец — ${col.header}`, collapsible: true, collapsed: true });

        fields.push({
            key: `colStyle${rawIndex}_format`,
            label: 'Формат значения',
            type: 'select',
            options: [
                { value: '', label: 'Авто (как в источнике)' },
                { value: 'number', label: 'Число' },
                { value: 'currency', label: 'Деньги' },
                { value: 'percent', label: 'Проценты' },
                { value: 'boolean', label: 'Логический (чекбокс)' }
            ],
            get: () => style.formatOverride || '',
            set: (v) => { style.formatOverride = v || null; }
        });

        fields.push({
            key: `colStyle${rawIndex}_total`,
            label: 'Итог (строка "Итого")',
            type: 'select',
            options: [
                { value: '', label: 'Без итога' },
                { value: 'sum', label: 'Сумма' },
                { value: 'max', label: 'Наибольшее' },
                { value: 'min', label: 'Наименьшее' },
                { value: 'avg', label: 'Среднее' },
                { value: 'count', label: 'Кол-во' }
            ],
            get: () => style.totalType || '',
            set: (v) => { style.totalType = v || null; }
        });

        fields.push({
            key: `colStyle${rawIndex}_width`,
            label: 'Ширина столбца, px',
            type: 'number',
            min: 30, step: 5,
            get: () => style.width,
            set: (v) => { style.width = (v === null || isNaN(v)) ? null : Math.max(30, v); }
        });

        fields.push({
            key: `colStyle${rawIndex}_decimals`,
            label: 'Знаков после запятой',
            type: 'number',
            min: 0, max: 10, step: 1,
            get: () => style.decimals,
            set: (v) => { style.decimals = (v === null || isNaN(v)) ? null : Math.max(0, Math.min(10, v)); }
        });

        // Цвет - палитра (Раунд 90, по запросу Mr.D: "набор готовых
        // палитр плюс ручной цвет") + отдельное поле "свой цвет",
        // включается выбором "Свой цвет..." в палитре.
        fields.push({
            key: `colStyle${rawIndex}_colorPreset`,
            label: 'Цвет столбца - палитра',
            type: 'select',
            options: [...COLOR_PALETTE, { value: CUSTOM_COLOR_VALUE, label: 'Свой цвет...' }],
            get: () => {
                if (!style.color) return '';
                const known = COLOR_PALETTE.find(p => p.value === style.color);
                return known ? known.value : CUSTOM_COLOR_VALUE;
            },
            set: (v) => {
                if (v === CUSTOM_COLOR_VALUE) return; // ничего не меняем - ждём выбора в color-поле ниже
                style.color = v || null;
            }
        });

        fields.push({
            key: `colStyle${rawIndex}_colorCustom`,
            label: 'Свой цвет (если выбрано выше)',
            type: 'color',
            get: () => style.color || '#90caf9',
            set: (v) => { style.color = v || null; }
        });
    });

    return fields;
}
