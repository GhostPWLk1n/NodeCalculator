/**
 * SPDX-License-Identifier: MIT
 * SPDX-FileCopyrightText: 2024 NodeCalculate Team
 * SPDX-FileCopyrightText: 2024 Pavel Fomin
 *
 * @file    ganttMath.js
 * @brief   Математический модуль для диаграммы Ганта: функции работы с датами и расчёта рабочих дней
 * @author  Pavel Fomin
 * @version 1.9.0
 * @see     https://github.com/GhostPWLk1n/NodeCalculator.git
 */

/**
 * Парсит строку в дату (ISO-формат YYYY-MM-DD)
 * @param {string} str - Строка даты
 * @returns {Date|null} Дата или null при ошибке парсинга
 */
export function parseISODate(str) {
    if (!str) return null;
    const d = new Date(str + 'T00:00:00');
    return isNaN(d.getTime()) ? null : d;
}

/**
 * Добавляет дни к дате
 * @param {Date} date - Исходная дата
 * @param {number} days - Количество дней для добавления
 * @returns {Date} Новая дата
 */
export function addDays(date, days) {
    const d = new Date(date.getTime());
    d.setDate(d.getDate() + Math.round(days));
    return d;
}

/**
 * Форматирует дату в ISO-формат (YYYY-MM-DD)
 * @param {Date} date - Дата
 * @returns {string} Строка в формате YYYY-MM-DD
 */
export function formatISODate(date) {
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}

/**
 * Форматирует дату в русском формате (DD.MM.YYYY)
 * @param {Date} date - Дата
 * @returns {string} Строка в формате DD.MM.YYYY
 */
export function formatDateRu(date) {
    const dd = String(date.getDate()).padStart(2, '0');
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    return `${dd}.${mm}.${date.getFullYear()}`;
}

/**
 * Парсит дату из русского формата (DD.MM.YYYY)
 * @param {string} str - Строка в формате DD.MM.YYYY
 * @returns {Date|null} Дата или null при ошибке парсинга
 */
export function parseDateRu(str) {
    const m = String(str ?? '').match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
    if (!m) return null;
    const d = new Date(`${m[3]}-${m[2]}-${m[1]}T00:00:00`);
    return isNaN(d.getTime()) ? null : d;
}

/**
 * Вычисляет количество дней между двумя датами
 * @param {Date} a - Первая дата
 * @param {Date} b - Вторая дата
 * @returns {number} Количество дней
 */
export function daysBetween(a, b) {
    return Math.round((b.getTime() - a.getTime()) / 86400000);
}

/**
 * Проверяет, является ли дата выходным (суббота/воскресенье)
 * Используется ТОЛЬКО как цветовая подсказка при отрисовке.
 * Для определения рабочего/нерабочего дня используйте isNonWorkingDay().
 * @param {Date} date - Дата для проверки
 * @returns {boolean} true, если суббота или воскресенье
 */
export function isWeekend(date) {
    const day = date.getDay();
    return day === 0 || day === 6;
}

/**
 * Проверяет, является ли дата нерабочим днём по календарю праздников
 * Все расчеты длительности ведутся в рабочих днях с учетом holidaySet.
 * @param {Date} date - Дата для проверки
 * @param {Set<string>} holidaySet - Set ISO-дат ('YYYY-MM-DD') праздников
 * @returns {boolean} true, если дата есть в holidaySet
 */
export function isNonWorkingDay(date, holidaySet) {
    return !!(holidaySet && holidaySet.size > 0 && holidaySet.has(formatISODate(date)));
}

/**
 * Сдвигает смещение вперёд до ближайшего рабочего дня
 * Если offsetDays попадает на выходной/праздник - сдвигает пока не найдёт рабочий день
 * Применяется автоматически после всех вычислений (перетаскивание, связи, редактирование)
 * @param {Date} anchor - Базовая дата (якорь)
 * @param {number} offsetDays - Смещение в днях от anchor
 * @param {Set<string>} holidaySet - Set праздников
 * @returns {number} Смещение до ближайшего рабочего дня
 */
export function nextWorkingOffset(anchor, offsetDays, holidaySet) {
    let offset = offsetDays;
    while (isNonWorkingDay(addDays(anchor, offset), holidaySet)) {
        offset += 1;
    }
    return offset;
}

/**
 * Вычисляет смещение конца задачи при расходе durationDays РАБОЧИХ дней
 * Пропускает выходные/праздники (время на них не тратится, но они остаются
 * внутри итогового календарного диапазона).
 * Применяется автоматически ко всем задачам независимо от источника данных.
 * @param {Date} anchor - Базовая дата (якорь)
 * @param {number} startOffsetDays - Смещение начала (гарантированно рабочий день)
 * @param {number} durationDays - Длительность в рабочих днях (может быть дробной)
 * @param {Set<string>} holidaySet - Set праздников
 * @returns {number} Смещение конца задачи от anchor
 */
export function spanWorkingDays(anchor, startOffsetDays, durationDays, holidaySet) {
    if (durationDays <= 0) return startOffsetDays;
    let offset = startOffsetDays;
    let remaining = durationDays;
    while (remaining > 0) {
        if (isNonWorkingDay(addDays(anchor, offset), holidaySet)) {
            offset += 1;
            continue;
        }
        const consume = Math.min(1, remaining);
        remaining -= consume;
        offset += consume;
    }
    return offset;
}

/**
 * Подсчитывает количество рабочих дней в диапазоне [startOffset, startOffset+duration)
 * Используется для конвертации календарной длительности в рабочие дни при сохранении override
 * @param {Date} anchor - Базовая дата (якорь)
 * @param {number} startOffset - Смещение начала
 * @param {number} duration - Длительность в календарных днях
 * @param {Set<string>} holidaySet - Set праздников
 * @returns {number} Количество рабочих дней
 */
export function countWorkingDaysInRange(anchor, startOffset, duration, holidaySet) {
    if (duration <= 0) return 0;
    let count = 0;
    for (let i = 0; i < duration; i++) {
        if (!isNonWorkingDay(addDays(anchor, startOffset + i), holidaySet)) {
            count++;
        }
    }
    return Math.max(0.5, count);
}
