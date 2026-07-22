export const Constants = {
    NODE_TYPES: {
        NUMBER: 'number',
        ADD: 'add',
        SUBTRACT: 'subtract',
        MULTIPLY: 'multiply',
        DIVIDE: 'divide'
    },
    
    TYPE_NAMES: {
        number: 'Число',
        add: 'Сложение',
        subtract: 'Вычитание',
        multiply: 'Умножение',
        divide: 'Деление',
        string: 'Строка',
        table: 'Таблица'
    },

    // Форматы отображения числового значения. Источник данных может
    // необязательно объявить свой формат через BaseNode.getValueFormat(),
    // а TableNode позволяет переопределить его вручную на уровне колонки.
    VALUE_FORMATS: {
        NUMBER:   { id: 'number',   label: 'Число',    prefix: '',  suffix: '' },
        CURRENCY: { id: 'currency', label: 'Деньги',   prefix: '',  suffix: ' ₽' },
        PERCENT:  { id: 'percent',  label: 'Проценты', prefix: '',  suffix: '%' }
    },
    
    OPERATION_SYMBOLS: {
        add: '➕',
        subtract: '➖',
        multiply: '✖️',
        divide: '➗'
    },
    
    DEFAULT_NODE_CONFIG: {
        maxInputs: 8,
        minInputs: 2,
        defaultX: 200,
        defaultY: 200,
        offsetX: 30,
        offsetY: 30
    },
    
    COLORS: {
        primary: '#4a6fa5',
        secondary: '#7ab7ff',
        accent: '#ffd700',
        danger: '#ff6b6b',
        success: '#4caf50',
        warning: '#ffb347'
    }
};