/**
 * SPDX-License-Identifier: MIT
 * SPDX-FileCopyrightText: 2024 NodeCalculate Team
 * SPDX-FileCopyrightText: 2024 Pavel Fomin
 *
 * @file    holidayParser.js
 * @brief   Извлекает набор дат-праздников из подключённой ноды - для сокета "Праздники" у GanttNode
 * @author  Pavel Fomin
 * @version 1.8.94
 * @see     https://github.com/GhostPWLk1n/NodeCalculator.git
 */

/**
 * HolidayParser - по прямому запросу Mr.D: "просто подключать Импорт
 * JSON к диаграмме Ганта" - без промежуточной ноды-конвертера. Значит,
 * GanttNode должен уметь понять и живой список дат от нового CalendarNode
 * (Раунд 73), И сырой JSON от JsonImportNode - ОБА через ОДИН и тот же
 * вход, без явного выбора формата пользователем. `extract(srcNode)`
 * пробует стратегии по очереди, пока одна не даст результат:
 *
 *   1. srcNode.holidayDates (array ISO-строк 'YYYY-MM-DD') - CalendarNode
 *      или любая будущая нода с тем же полем.
 *   2. srcNode.jsonText (сырой текст, как есть у JsonImportNode ДО любого
 *      разбора в branches/tableData - см. её докстринг) - парсим JSON,
 *      если по форме похоже на "производственный календарь" (см. ниже).
 *
 * ФОРМАТ ПРОИЗВОДСТВЕННОГО КАЛЕНДАРЯ (образец от Mr.D, calendar_2026.json):
 * ```json
 * {
 *   "year": 2026,
 *   "months": [ { "month": 1, "days": "1,2,3,...,9+,10,11" }, ... ],
 *   "transitions": [ { "from": "01.03", "to": "01.09" }, ... ]
 * }
 * ```
 *
 * РЕШЁННАЯ НЕОДНОЗНАЧНОСТЬ (стоит перепроверить на реальном календаре,
 * если результат не совпадёт с ожиданием):
 *   - `days` за каждый месяц считается УЖЕ ГОТОВЫМ, окончательным списком
 *     нерабочих дней (выходные+праздники) - переносы уже учтены в самом
 *     списке. Поле `transitions` НЕ применяется повторно (иначе рисковали
 *     бы либо задвоить перенос, либо противоречить уже готовому `days`) -
 *     оно только для справки/подсказки, откуда взялся конкретный день.
 *   - Суффикс `+` (перенесённый выходной) - день уже и так есть в `days`,
 *     дополнительной обработки не требует.
 *   - Суффикс `*` (сокращённый предпраздничный день) - это НЕ выходной,
 *     просто короче обычного; такие дни ИСКЛЮЧАЮТСЯ из набора праздников
 *     (остаются рабочими для целей диаграммы Ганта - там нет полей смены
 *     длительности часов из-за сокращения дня).
 */
export const HolidayParser = {
    // Возвращает Set<string> ISO-дат 'YYYY-MM-DD' - пустой Set, если
    // источник не подключён или не распознан ни одной стратегией.
    extract(srcNode) {
        if (!srcNode) return new Set();

        if (Array.isArray(srcNode.holidayDates)) {
            return new Set(srcNode.holidayDates.filter(d => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)));
        }

        if (typeof srcNode.jsonText === 'string' && srcNode.jsonText.trim()) {
            try {
                const data = JSON.parse(srcNode.jsonText);
                if (this._looksLikeProductionCalendar(data)) {
                    return this._parseProductionCalendar(data);
                }
            } catch (e) {
                // некорректный JSON - молча пустой набор, GanttNode сам
                // покажет предупреждающий бейдж по пустому Set + наличию соединения
            }
        }

        return new Set();
    },

    _looksLikeProductionCalendar(data) {
        return !!(data && typeof data.year === 'number' && Array.isArray(data.months));
    },

    _parseProductionCalendar(data) {
        const dates = new Set();
        const year = data.year;

        data.months.forEach(monthEntry => {
            const month = Number(monthEntry?.month);
            if (!month || month < 1 || month > 12) return;
            const daysStr = String(monthEntry?.days || '');
            if (!daysStr.trim()) return;

            daysStr.split(',').forEach(token => {
                const trimmed = token.trim();
                if (!trimmed) return;
                // '*' (сокращённый день) - не праздник, пропускаем целиком
                if (trimmed.endsWith('*')) return;
                // '+' (перенесённый выходной) - обычный праздник, просто
                // снимаем суффикс перед разбором числа
                const dayNum = parseInt(trimmed.replace(/\+$/, ''), 10);
                if (!dayNum || dayNum < 1 || dayNum > 31) return;

                const mm = String(month).padStart(2, '0');
                const dd = String(dayNum).padStart(2, '0');
                dates.add(`${year}-${mm}-${dd}`);
            });
        });

        return dates;
    }
};
