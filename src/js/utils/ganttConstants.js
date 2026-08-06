/**
 * SPDX-License-Identifier: MIT
 * SPDX-FileCopyrightText: 2024 NodeCalculate Team
 * SPDX-FileCopyrightText: 2024 Pavel Fomin
 *
 * @file    ganttConstants.js
 * @brief   Константы для диаграммы Ганта
 * @author  Pavel Fomin
 * @version 1.8.20
 * @see     https://github.com/GhostPWLk1n/NodeCalculator.git
 */

// === Размеры и отступы ===
export const ROW_HEIGHT = 26;      // px на строку задачи
export const MAX_VISIBLE_ROWS = 6; // после скольки задач включается вертикальный скролл
export const LABEL_WIDTH = 84;     // px, колонка с названиями задач
export const HOURS_COL_WIDTH = 34; // px, колонка "ч.ч."
export const WORKDAYS_COL_WIDTH = 34; // px, колонка "Раб.дн."
export const RESPONSIBLE_COL_WIDTH = 70; // px, колонка "Ответственный"
export const CALDAYS_COL_WIDTH = 40; // px, колонка "Кал. дни"
export const SECTION_COL_WIDTH = 100; // px, колонка "Раздел"
export const FOCUS_COL_WIDTH = 16; // px, узкая колонка перед "№ п/п" для фокуса
export const HEADER_ROW_HEIGHT = 15; // px на каждую из строк шапки

// === Рабочее время ===
export const HOURS_PER_WORKDAY = 8; // человеко-день (стандартный рабочий день)

// === Индексы сокетов ===
export const HOLIDAY_SOCKET_INDEX = 50; // фиксированный индекс для "Праздники"
export const TITLE_INPUT_SOCKET_INDEX = 51; // фиксированный индекс для "Заголовок"
export const SUBTITLE_INPUT_SOCKET_INDEX = 52; // фиксированный индекс для "Подзаголовок"

// === Масштабы линейки ===
export const RULER_SCALES = {
    hours: { label: 'Часы', dayWidth: 48, tickStepDays: 1 },
    days: { label: 'Дни', dayWidth: 22, tickStepDays: 1 },
    weeks: { label: 'Недели', dayWidth: 10, tickStepDays: 7 },
    months: { label: 'Месяцы', dayWidth: 4, tickStepDays: 30 }
};

// === Пресеты периода отображения ===
export const PERIOD_PRESETS = {
    month: { label: 'Месяц', days: 30 },
    quarter: { label: 'Квартал', days: 90 },
    halfyear: { label: 'Полгода', days: 182 },
    year: { label: 'Год', days: 365 }
};

// === Названия дней недели и месяцев ===
export const WEEKDAY_LABELS = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
export const MONTH_LABELS = [
    'январь', 'февраль', 'март', 'апрель', 'май', 'июнь',
    'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'
];
