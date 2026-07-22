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
}