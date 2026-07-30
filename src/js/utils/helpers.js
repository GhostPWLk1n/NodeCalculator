/**
 * SPDX-License-Identifier: MIT
 * SPDX-FileCopyrightText: 2024 NodeCalculate Team
 * SPDX-FileCopyrightText: 2024 Pavel Fomin
 *
 * @file    helpers.js
 * @brief   Форматирование чисел/значений, generateId, определение типа сокета
 * @author  Pavel Fomin
 * @version 1.7.4
 * @see     https://github.com/GhostPWLk1n/NodeCalculator.git
 */

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
            if (el.classList.contains('socket-bool')) return 'bool';
            if (el.classList.contains('socket-image')) return 'image';
            if (el.classList.contains('socket-any')) return 'any';
            if (el.classList.contains('socket-count')) return 'count';
        }
        return 'plain';
    },

    /**
     * Форматирует число со пробелами-разделителями тысяч (1000 -> "1 000")
     * и заданным числом знаков после запятой. В отличие от formatNumber()
     * возвращает СТРОКУ, а не число - formatNumber() используется и там,
     * где число нужно как число (например, значение редактируемого
     * input), группировка пробелами там была бы не к месту.
     *
     * @param {number} value
     * @param {number|null} decimals - null/undefined = авто (до 4 знаков,
     *        хвостовые нули обрезаются, как раньше вело себя formatNumber)
     */
    formatGrouped(value, decimals) {
        if (typeof value !== 'number' || isNaN(value)) {
            return value === undefined || value === null ? '—' : String(value);
        }

        let numStr;
        if (decimals === null || decimals === undefined) {
            numStr = Number(value.toFixed(4)).toString();
        } else {
            const d = Math.max(0, Math.min(10, decimals));
            numStr = value.toFixed(d);
        }

        const negative = numStr.startsWith('-');
        if (negative) numStr = numStr.slice(1);

        const [intPart, fracPart] = numStr.split('.');
        const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

        return (negative ? '-' : '') + grouped + (fracPart !== undefined ? '.' + fracPart : '');
    },

    /**
     * Форматирует число согласно выбранному формату значения
     * (Constants.VALUE_FORMATS). Единая точка форматирования - чтобы
     * PercentageNode, TableNode и другие потребители показывали
     * деньги/проценты одинаково. Использует formatGrouped() - деньги и
     * числа выводятся с пробелами-разделителями тысяч (1 000, не 1000).
     *
     * @param {number} value
     * @param {string} formatId - 'number' | 'currency' | 'percent'
     * @param {number|null} [decimals] - число знаков после запятой
     *        (null/не задано = авто)
     */
    /**
     * Приводит значение ЛЮБОГО типа к true/false - для столбца с
     * форматом 'boolean' ("Логический", Раунд 56): значение в ячейке
     * не обязательно уже булево (может быть числом из Excel-импорта,
     * текстом "да"/"нет" и т.п.) - формат столбца ЗАЯВЛЯЕТ намерение
     * "это логическое поле", а эта функция решает, как его читать.
     * @param {*} value
     * @returns {boolean}
     */
    coerceBool(value) {
        if (typeof value === 'boolean') return value;
        if (typeof value === 'number') return value !== 0;
        if (typeof value === 'string') {
            const v = value.trim().toLowerCase();
            return ['true', '1', 'да', 'yes', 'истина'].includes(v);
        }
        return !!value;
    },

    /**
     * Строгое приведение к bool - в отличие от coerceBool() выше (мягкое,
     * никогда не падает, любую нераспознанную строку тихо считает false),
     * тут нераспознанное значение - ЯВНАЯ неудача (null), а не тихое
     * предположение. Изначально появилось в TableFilterNode (Раунд 59)
     * для списков-условий отсеивания, затем понадобилось и в
     * ListConvertNode (Раунд 62, принудительный формат данных) - вынесено
     * сюда как общее место, а не дублируется в двух нодах.
     * @param {*} value
     * @returns {boolean|null} null - не удалось однозначно распознать
     */
    strictCoerceBool(value) {
        if (typeof value === 'boolean') return value;
        if (typeof value === 'number') {
            if (value === 0) return false;
            if (value === 1) return true;
            return null; // любое другое число - неоднозначно, не 0/1
        }
        if (typeof value === 'string') {
            const v = value.trim().toLowerCase();
            if (['true', '1', 'да', 'yes', 'истина'].includes(v)) return true;
            if (['false', '0', 'нет', 'no', 'ложь'].includes(v)) return false;
        }
        return null;
    },

    /**
     * Строгое приведение к числу (Раунд 62, ListConvertNode) - тот же
     * принцип, что и у strictCoerceBool() выше: null, если однозначно не
     * получается, а не "предположим 0" молча.
     * @param {*} value
     * @returns {number|null}
     */
    strictCoerceNumber(value) {
        if (typeof value === 'number') return Number.isNaN(value) ? null : value;
        if (typeof value === 'boolean') return value ? 1 : 0;
        if (typeof value === 'string') {
            const trimmed = value.trim();
            if (trimmed === '') return null;
            const n = Number(trimmed); // Number(), не parseFloat() - не пропускает "5abc" как 5
            if (!Number.isNaN(n)) return n;
        }
        return null;
    },

    formatByType(value, formatId, decimals = null) {
        // Нечисловое значение (например, текстовый столбец с именами строк) -
        // форматы денег/процентов к нему неприменимы, показываем как есть
        if (typeof value !== 'number') {
            return value === undefined || value === null ? '—' : String(value);
        }
        const key = (formatId || 'number').toUpperCase();
        const fmt = Constants.VALUE_FORMATS?.[key] || Constants.VALUE_FORMATS?.NUMBER;
        const num = Helpers.formatGrouped(value, decimals);
        if (!fmt) return String(num);
        return `${fmt.prefix || ''}${num}${fmt.suffix || ''}`;
    },

    // Короткий текст плашки-бейджа над нодой (полное объяснение - в title,
    // см. BaseNode.getActiveBadge/renderer.syncNodeBadge)
    badgeShortLabel(type) {
        return Constants.BADGE_SHORT_LABELS?.[type] || type;
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