/**
 * SPDX-License-Identifier: MIT
 * SPDX-FileCopyrightText: 2024 NodeCalculate Team
 * SPDX-FileCopyrightText: 2024 Pavel Fomin
 *
 * @file    dataTypes.js
 * @brief   Единые форматы данных между нодами: ListData и TableData
 * @author  Pavel Fomin
 * @version 1.8.9
 * @see     https://github.com/GhostPWLk1n/NodeCalculator.git
 */

export class ListData {
    constructor(items = [], metadata = {}) {
        this.items = items; // Массив объектов { name: string, value: number }
        this.metadata = metadata; // { title, total, ... }
        this.type = 'list';
    }
    
    get total() {
        return this.items.reduce((sum, item) => sum + item.value, 0);
    }
    
    get names() {
        return this.items.map(item => item.name);
    }
    
    get values() {
        return this.items.map(item => item.value);
    }
    
    get percentages() {
        const total = this.total;
        if (total === 0) return this.values.map(() => 0);
        return this.values.map(v => (v / total) * 100);
    }
    
    addItem(name, value) {
        this.items.push({ name, value });
        return this;
    }
    
    merge(otherList) {
        const merged = new ListData([], { ...this.metadata, merged: true });
        merged.items = [...this.items, ...otherList.items];
        return merged;
    }
}

/**
 * TableData - формат данных, который выдаёт TableNode (сокет типа Data).
 * columns: [{ header: string, values: number[], format: 'number'|'currency'|'percent' }]
 * Колонки могут быть разной длины - rowCount берёт максимум, недостающие
 * значения читаются как null (безопасный дефолт вместо ошибки).
 */
export class TableData {
    constructor(columns = [], metadata = {}) {
        this.columns = columns;
        this.metadata = metadata;
        this.type = 'data';
    }

    get rowCount() {
        return this.columns.reduce((max, c) => Math.max(max, c.values.length), 0);
    }

    get headers() {
        return this.columns.map(c => c.header);
    }

    row(i) {
        const obj = {};
        this.columns.forEach(c => { obj[c.header] = c.values[i] ?? null; });
        return obj;
    }

    // Итог по столбцу для строки "Итого" (TableViewerNode). Не числовые
    // значения (текстовые столбцы с именами и т.п.) игнорируются;
    // null возвращается, если у столбца не задан col.totalType, либо
    // числовых значений нет вовсе.
    aggregate(col) {
        if (!col || !col.totalType) return null;

        // "Кол-во" (Раунд 92, чек-лист п.4.2) - единственная агрегация,
        // которая имеет смысл и для НЕчисловых столбцов (текст, даты и
        // т.п.) - считает непустые значения, а не идёт через общий
        // числовой фильтр ниже, как sum/max/min/avg.
        if (col.totalType === 'count') {
            return col.values.filter(v => v !== null && v !== undefined && v !== '').length;
        }

        const nums = col.values.filter(v => typeof v === 'number' && !isNaN(v));
        if (nums.length === 0) return null;

        switch (col.totalType) {
            case 'sum': return nums.reduce((a, b) => a + b, 0);
            case 'max': return Math.max(...nums);
            case 'min': return Math.min(...nums);
            case 'avg': return nums.reduce((a, b) => a + b, 0) / nums.length;
            default: return null;
        }
    }

    // Сумма каждой колонки как ListData - основной способ, которым
    // Data-потребители (PercentageNode и т.п.) сворачивают таблицу
    // обратно в привычный список "имя - значение". Текстовые колонки
    // (format: 'text', например подцепленные названия строк) в сумму
    // не участвуют - это не числовые данные для диаграммы.
    toListData() {
        return new ListData(
            this.columns
                .filter(col => col.format !== 'text')
                .map(col => ({
                    name: col.header,
                    value: col.values.reduce((sum, v) => sum + (typeof v === 'number' ? v : 0), 0),
                    format: col.format || 'number'
                })),
            { title: this.metadata.title || 'Таблица' }
        );
    }

    // Построчная разборка таблицы в ListData - КАЖДАЯ СТРОКА становится
    // одним элементом {name, value}. Зеркально toListData() выше (там
    // наоборот: один СТОЛБЕЦ - это один суммарный элемент). Такой формат
    // нужен диаграммам (ChartNode, см. chartNode.js) - там таблица всегда
    // двухколоночная "Категория (text) / Значение (число)", и строка
    // таблицы - это ровно один сектор/столбец диаграммы, а не то, что
    // нужно суммировать. Категория берётся из первого текстового столбца
    // (format === 'text'), значение - из первого нетекстового; если
    // текстового столбца нет - имена строк "Строка N".
    toRowListData() {
        const textCol = this.columns.find(col => col.format === 'text');
        const valueCol = this.columns.find(col => col.format !== 'text') || this.columns[0];
        if (!valueCol) return new ListData([], { title: this.metadata.title || 'Диаграмма' });

        const items = [];
        for (let i = 0; i < this.rowCount; i++) {
            items.push({
                name: (textCol ? textCol.values[i] : null) || `Строка ${i + 1}`,
                value: typeof valueCol.values[i] === 'number' ? valueCol.values[i] : 0,
                format: valueCol.format || 'number'
            });
        }
        return new ListData(items, { title: this.metadata.title || 'Диаграмма' });
    }

    // Обобщение toRowListData() на НЕСКОЛЬКО числовых столбцов сразу
    // (Раунд 42) - toRowListData() выше берёт только ПЕРВЫЙ нетекстовый
    // столбец, теряя остальные; здесь сохраняются ВСЕ - каждый становится
    // отдельной "серией" со своим именем (заголовок столбца) и набором
    // значений по тем же категориям (строкам). Нужно ChartNode, когда у
    // источника больше одного столбца с данными - каждый рисуется как
    // отдельное кольцо (круговая) или отдельный набор столбиков
    // (линейчатая), а не схлопывается в одно число на строку.
    // При РОВНО одном числовом столбце возвращает ровно 1 серию - то есть
    // ведёт себя как toRowListData() в самом частом (однорядном) случае.
    toSeriesData() {
        const textCol = this.columns.find(col => col.format === 'text');
        const valueCols = this.columns.filter(col => col.format !== 'text');

        const categories = [];
        for (let i = 0; i < this.rowCount; i++) {
            categories.push((textCol ? textCol.values[i] : null) || `Строка ${i + 1}`);
        }

        const series = valueCols.map(col => ({
            name: col.header,
            format: col.format || 'number',
            values: categories.map((_, i) => (typeof col.values[i] === 'number' ? col.values[i] : 0))
        }));

        return { categories, series };
    }
}