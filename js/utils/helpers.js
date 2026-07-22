import { Constants } from './constants.js';

export const Helpers = {
    /**
     * Определяет "род" сокета - list/string/data/count/plain.
     * Используется connectionManager (совместимость соединений) и renderer
     * (цвет линии). Сначала читает единый data-kind (проставляется
     * SocketFactory.createSocket), а если его нет (сокеты, созданные
     * вручную в старых нодах вроде percentageNode) - определяет по
     * classList/data-isList, чтобы не ломать существующий код.
     */
    getSocketKind(el) {
        if (!el) return 'plain';
        if (el.dataset && el.dataset.kind) return el.dataset.kind;
        if (el.dataset && el.dataset.isList === 'true') return 'list';
        if (el.classList) {
            if (el.classList.contains('socket-list')) return 'list';
            if (el.classList.contains('socket-string')) return 'string';
            if (el.classList.contains('socket-data')) return 'data';
            if (el.classList.contains('socket-count')) return 'count';
        }
        return 'plain';
    },

    /**
     * Форматирует число согласно выбранному формату значения
     * (Constants.VALUE_FORMATS). Единая точка форматирования - чтобы
     * PercentageNode, TableNode и другие потребители показывали
     * деньги/проценты одинаково.
     */
    formatByType(value, formatId) {
        // Нечисловое значение (например, текстовый столбец с именами строк) -
        // форматы денег/процентов к нему неприменимы, показываем как есть
        if (typeof value !== 'number') {
            return value === undefined || value === null ? '—' : String(value);
        }
        const key = (formatId || 'number').toUpperCase();
        const fmt = Constants.VALUE_FORMATS?.[key] || Constants.VALUE_FORMATS?.NUMBER;
        const num = Helpers.formatNumber(value);
        if (!fmt) return String(num);
        return `${fmt.prefix || ''}${num}${fmt.suffix || ''}`;
    },

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