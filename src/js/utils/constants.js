/**
 * SPDX-License-Identifier: MIT
 * SPDX-FileCopyrightText: 2024 NodeCalculate Team
 * SPDX-FileCopyrightText: 2024 Pavel Fomin
 *
 * @file    constants.js
 * @brief   Имена типов нод, цвета, форматы значений, дефолтные конфиги
 * @author  Pavel Fomin
 * @version 1.8.4
 * @see     https://github.com/GhostPWLk1n/NodeCalculator.git
 */

export const Constants = {
    // Единственный источник версии приложения - раньше "v1.0" была
    // захардкожена прямо в index.html (.sidebar-version) и не менялась
    // при релизах. Теперь index.html хранит только пустой <span id=
    // "sidebarVersion">, а текст в него пишет main.js при старте (см.
    // инициализацию там) - обновлять нужно только это значение, одно
    // место на весь проект.
    APP_VERSION: '1.8.4',

    NODE_TYPES: {
        NUMBER: 'number',
        ADD: 'add',
        SUBTRACT: 'subtract',
        MULTIPLY: 'multiply',
        DIVIDE: 'divide'
    },
    
    TYPE_NAMES: {
        number: 'Число',
        boolean: 'Булево',
        booleanOp: 'Логическая операция',
        image: 'Изображение',
        tree: 'Дерево',
        treeFormat: 'Оформление дерева',
        treeViewer: 'Просмотр дерева',
        add: 'Сложение',
        subtract: 'Вычитание',
        multiply: 'Умножение',
        divide: 'Деление',
        string: 'Строка',
        table: 'Таблица',
        percentConvert: 'Проценты от суммы',
        chart: 'Диаграмма',
        xlsxImport: 'Импорт из Excel',
        tableInject: 'Инъекция в таблицу',
        tableRemove: 'Изъятие из таблицы',
        tableFormat: 'Оформление таблицы',
        tableMergeColumns: 'Объединение столбцов',
        tableJoin: 'Слияние таблиц',
        tableFilter: 'Отсеять',
        tableUnique: 'Найти уникальные',
        listConvert: 'Преобразование списка',
        jsonImport: 'Импорт JSON',
        percentage: 'Просмотр диаграммы',
        gantt: 'Диаграмма Ганта',
        dashboard: 'Дашборд',
        exportXlsx: 'Экспорт в Excel',
        exportJson: 'Экспорт JSON',
        treeToTable: 'Дерево → Таблица',
        calendar: 'Календарь',
        invert: 'Инверсия',
        ganttTableProcessor: 'Обработка таблиц Ганта'
    },

    // Форматы отображения числового значения. Источник данных может
    // Все известные "роды" сокетов (data-kind), кроме самого 'any'.
    // Сокет 'any' - прокси: считается совместимым с конкретным родом,
    // если тот входит в этот список (сейчас это буквально все роды,
    // поэтому 'any' ведёт себя как универсальный - но именно перебор
    // по списку, а не безусловное "true", даёт задел на будущее: если
    // когда-нибудь понадобится "any", который принимает не всё подряд,
    // а конкретное подмножество - меняется только этот список).
    SOCKET_KINDS: ['list', 'string', 'data', 'plain', 'count', 'bool', 'image'],

    // Система бейджей (см. baseNode.js getStaticBadges/addBadge/getActiveBadge) -
    // короткая плашка над нодой: error/warning/beta/deprecated/info.
    // Если у ноды несколько бейджей одновременно - показывается только
    // один, самый важный (наибольшее число в BADGE_PRIORITY).
    BADGE_PRIORITY: {
        error: 4,
        warning: 3,
        beta: 2,
        deprecated: 2,
        info: 1
    },

    BADGE_SHORT_LABELS: {
        error: '⚠ Ошибка',
        warning: '⚠ Внимание',
        beta: 'BETA',
        deprecated: 'Устарело',
        info: 'i'
    },

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