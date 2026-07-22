export const Helpers = {
    getNodeElement(nodeId) {
        return document.querySelector(`[data-node-id="${nodeId}"]`);
    },
    
    getSocketPosition(nodeId, socketType, workspace) {
        const el = Helpers.getNodeElement(nodeId);
        if (!el) return null;
        
        const rect = el.getBoundingClientRect();
        const socketEl = el.querySelector(`.${socketType}-socket`);
        if (!socketEl) return null;
        
        const sRect = socketEl.getBoundingClientRect();
        return {
            x: sRect.left + sRect.width / 2 + window.scrollX,
            y: sRect.top + sRect.height / 2 + window.scrollY
        };
    },
    
    formatNumber(value) {
        if (value === undefined || value === null) return '—';
        if (typeof value === 'number') {
            return Number(value.toFixed(4));
        }
        return value;
    },
    
    getDefaultName(type) {
        const names = {
            number: 'Число',
            add: 'Сложение',
            subtract: 'Вычитание',
            multiply: 'Умножение',
            divide: 'Деление'
        };
        return names[type] || type;
    },
    
    generateId() {
        return Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    }
};