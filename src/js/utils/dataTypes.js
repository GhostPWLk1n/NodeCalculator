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