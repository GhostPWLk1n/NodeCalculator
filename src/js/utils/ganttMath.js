/**
 * SPDX-License-Identifier: MIT
 * SPDX-FileCopyrightText: 2024 NodeCalculate Team
 * SPDX-FileCopyrightText: 2024 Pavel Fomin
 *
 * @file    ganttMath.js
 * @brief   Чистые функции даты/планирования для Диаграммы Ганта - без
 *          состояния, без DOM, без зависимости от конкретного узла.
 *          Вынесены из ganttNode.js (Раунд 141, по запросу Mr.D:
 *          "модуль узла gantt_node_js получился очень громоздким, надо
 *          его разбить, разнести логику, вынести математику отдельно").
 * @author  Pavel Fomin
 * @version 1.8.94
 * @see     https://github.com/GhostPWLk1n/NodeCalculator.git
 *
 * ЕДИНЫЙ ПРИНЦИП ХРАНЕНИЯ ДАТ (по прямому указанию Mr.D, Раунд 141):
 * "ВСЕ вычисления должны храниться и производиться в РАБОЧИХ днях, и
 * конвертироваться в календарные ТОЛЬКО после расчётов" - до Раунда
 * 141 в проекте существовал переключаемый "Расчёт длительности"
 * (календарные/рабочие дни, scheduleMode) - убран целиком (см.
 * ganttNode.js) - именно СМЕШЕНИЕ этих двух единиц измерения в разных
 * местах кода было причиной нескольких найденных багов ("застывшая"
 * длительность при ручном вводе, разъезжающиеся даты у дочерних задач
 * связи). Теперь калькулятор один, и правило одно:
 *   - startOffsetDays/durationDays у ЗАДАЧИ, ХРАНИМЫЕ пользователем
 *     (this.taskDates/this.taskDurationOverrides) - РАБОЧИЕ дни
 *     (сколько дней РЕАЛЬНО занимает задача, без выходных).
 *   - startOffsetDays/durationDays у ЗАДАЧИ, ИСПОЛЬЗУЕМЫЕ для отрисовки
 *     (this.tasks[].startOffsetDays/durationDays, ПОСЛЕ calculate()) -
 *     КАЛЕНДАРНЫЕ дни (реальная ширина полосы на экране, с "перепрыгнутыми"
 *     через выходные интервалами) - конвертация происходит ОДИН раз,
 *     внутри calculate(), через spanWorkingDays()/nextWorkingOffset()
 *     ниже - НИГДЕ БОЛЬШЕ калькулятор не имеет права путать эти две
 *     единицы измерения.
 */

// === Даты - без внешних библиотек, простые хелперы ===

export function parseISODate(str) {
    if (!str) return null;
    const d = new Date(str + 'T00:00:00');
    return isNaN(d.getTime()) ? null : d;
}

export function addDays(date, days) {
    const d = new Date(date.getTime());
    d.setDate(d.getDate() + Math.round(days));
    return d;
}

export function formatISODate(date) {
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}

export function formatDateRu(date) {
    const dd = String(date.getDate()).padStart(2, '0');
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    return `${dd}.${mm}.${date.getFullYear()}`;
}

export function parseDateRu(str) {
    const m = String(str ?? '').match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
    if (!m) return null;
    const d = new Date(`${m[3]}-${m[2]}-${m[1]}T00:00:00`);
    return isNaN(d.getTime()) ? null : d;
}

export function daysBetween(a, b) {
    return Math.round((b.getTime() - a.getTime()) / 86400000);
}

// Date.getDay(): 0=вс, 6=сб. Раунд 92 (чек-лист, п.2.2) - используется
// ТОЛЬКО как цветовая подсказка при отрисовке (выходные-по-календарю
// подсвечиваются иначе, чем выходные-по-факту-даты-недели) - различить
// "выглядит как обычный выходной" от "будний день, отмеченный
// праздником" СРЕДИ УЖЕ ПОДТВЕРЖДЁННЫХ календарём дат. В определении
// рабочий/нерабочий БОЛЬШЕ НЕ УЧАСТВУЕТ - см. isNonWorkingDay() ниже.
export function isWeekend(date) {
    const day = date.getDay();
    return day === 0 || day === 6;
}

// Раунд 73 - выходной/праздник по календарю (holidaySet - Set<string>
// ISO-дат 'YYYY-MM-DD' из HolidayParser.extract()). Раунд 92 (чек-лист,
// п.2.2, по прямому запросу Mr.D: "убрать автоматические выходные (сб,
// вс) из Ганта, выходные определяются ТОЛЬКО подключённым календарём") -
// автоматическая проверка "суббота/воскресенье = нерабочий" УБРАНА
// ЦЕЛИКОМ. Если сокет "Праздники" не подключён (holidaySet пуст) -
// isNonWorkingDay() всегда false, ни один день не считается нерабочим -
// авто-расстановка задач идёт по КАЖДОМУ календарному дню без
// исключений, пока пользователь явно не подключит календарь (см.
// CalendarNode - там есть кнопка "Отметить все выходные" специально
// для восстановления прежнего поведения, если оно нужно).
export function isNonWorkingDay(date, holidaySet) {
    return !!(holidaySet && holidaySet.size > 0 && holidaySet.has(formatISODate(date)));
}

// Если calendar-смещение offsetDays (от anchor) попадает на выходной -
// сдвигает его вперёд до ближайшего рабочего дня. Используется и для
// автоматической расстановки (курсор), и для перетащенных мышью задач
// (raw-смещение хранится как есть в taskDates, а "прилипание" к
// рабочему дню происходит здесь, при каждом calculate()), и для связей
// между задачами (см. GanttNode._applyDependencyConstraints()).
export function nextWorkingOffset(anchor, offsetDays, holidaySet) {
    let offset = offsetDays;
    while (isNonWorkingDay(addDays(anchor, offset), holidaySet)) {
        offset += 1;
    }
    return offset;
}

// Считает calendar-смещение КОНЦА задачи (от anchor), если начать в
// startOffsetDays (уже гарантированно рабочий день, см. nextWorkingOffset
// выше) и "расходовать" durationDays РАБОЧИХ дней подряд, пропуская
// выходные (время на них не тратится, но они остаются внутри итогового
// календарного диапазона - задача просто визуально "перепрыгивает" через
// уик-энд, как в большинстве Gantt-инструментов). Дробный последний день
// (например, 4 часа = 1/6 дня) учитывается частично, без округления.
//
// ЕДИНСТВЕННОЕ место во всём проекте, где РАБОЧИЕ дни (durationDays,
// вход) превращаются в КАЛЕНДАРНОЕ смещение (offset, выход) - см.
// докстринг файла выше про единый принцип хранения дат.
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

// ============================================================================
// Раунд 142 - рефакторинг по ТЗ Mr.D ("Рефакторинг модуля ganttMath.js" от
// 2026-08-07): полноценная система календарного планирования поверх
// проверенных чистых функций выше - топологическая сортировка, каскадный
// пересчёт до стабилизации, явные коды ошибок (E001-E008).
//
// ВАЖНОЕ РЕШЕНИЕ ПО НЕОДНОЗНАЧНОСТИ ТЗ (задокументировано явно, чтобы не
// потерялось): ТЗ называет параметр конструктора WorkCalendar "workDays" и
// описывает его как "множество рабочих дней" - БУКВАЛЬНО это выглядело бы
// как WHITELIST (только эти дни рабочие, всё остальное - нет). НО
// собственный пример ТЗ (п.11) - `new WorkCalendar(new Set(['01.01.2026',
// '02.01.2026']))`, затем 5-дневная задача с 1 по 5 января - математически
// НЕВОЗМОЖЕН при whitelist-трактовке (5 рабочих дней не уместились бы в
// множество из 2 разрешённых дат). Единственная непротиворечивая трактовка -
// множество это НЕРАБОЧИЕ дни (BLACKLIST, 1-2 января - новогодние
// праздники) - ТА ЖЕ семантика, что уже у this.holidaySet во всём проекте
// (см. isNonWorkingDay() выше) - WorkCalendar реализован именно так, для
// полной совместимости с существующим HolidayParser/CalendarNode (NFR-4.1 -
// "существующие экспорты сохранены для обратной совместимости" - тот же
// принцип применён и к СЕМАНТИКЕ данных, не только к именам функций).
// Формат ключей на входе - 'DD.MM.YYYY', как буквально указано в ТЗ
// (нормализуется внутрь в ISO 'YYYY-MM-DD' - тот же формат, что уже
// использует holidaySet - переиспользует isNonWorkingDay() напрямую).
// ============================================================================

// Коды ошибок - как в разделе 7 ТЗ. SchedulerError.code содержит код
// БЕЗ квадратных скобок (для программных if (e.code === 'E003')), в
// message - код уже встроен в текст (для читаемых логов/алертов).
export class SchedulerError extends Error {
    constructor(code, message) {
        super(`[${code}] ${message}`);
        this.name = 'SchedulerError';
        this.code = code;
    }
}

// FR-1 - календарь рабочих дней. Тонкая ООП-обёртка над isNonWorkingDay()/
// nextWorkingOffset() выше (не дублирует логику) - O(1) проверка дня
// обеспечена тем же Set, что и раньше.
export class WorkCalendar {
    /**
     * @param {Set<string>} nonWorkingDays - НЕРАБОЧИЕ дни в формате
     *   'DD.MM.YYYY' (см. докстринг выше про решение по неоднозначности
     *   ТЗ - это BLACKLIST, не whitelist). Пустой/не-Set -> все дни рабочие
     *   (та же семантика, что у this.holidaySet по умолчанию).
     */
    constructor(nonWorkingDays) {
        const source = nonWorkingDays instanceof Set ? nonWorkingDays : new Set();
        // Нормализация DD.MM.YYYY -> ISO 'YYYY-MM-DD' ОДИН раз, в
        // конструкторе - isNonWorkingDay()/formatISODate() дальше работают
        // с готовым ISO-множеством, без парсинга на каждой проверке.
        this._nonWorkingIso = new Set();
        source.forEach(raw => {
            const parsed = parseDateRu(raw);
            if (parsed) this._nonWorkingIso.add(formatISODate(parsed));
        });
    }

    /**
     * @param {Date} date
     * @returns {boolean} true, если день рабочий
     */
    isWorkingDay(date) {
        return !isNonWorkingDay(date, this._nonWorkingIso);
    }

    /**
     * @param {Date} date
     * @returns {Date} ближайший рабочий день >= date
     * @throws {SchedulerError} E006, если не найден за 365 дней (защита
     *   от бесконечного цикла - FR-4.2)
     */
    findNextWorkday(date) {
        for (let i = 0; i <= 365; i++) {
            const candidate = addDays(date, i);
            if (this.isWorkingDay(candidate)) return candidate;
        }
        throw new SchedulerError('E006', 'No working day found within 365 days');
    }

    /**
     * Прибавляет N РАБОЧИХ дней к дате - "задача из N рабочих дней,
     * начинающаяся с startDate" -> дата её ПОСЛЕДНЕГО рабочего дня
     * (включительно, не "день после неё" - см. Task.end ниже: это
     * реальная дата окончания работ, что и просит ТЗ п.11 - у задачи A
     * (5 дней с 1 января) end='05.01.2026', НЕ '06.01.2026').
     * @param {Date} startDate
     * @param {number} days - целое >= 0
     * @returns {Date}
     * @throws {SchedulerError} E005, если days < 0
     */
    addWorkdays(startDate, days) {
        if (days < 0) throw new SchedulerError('E005', `Invalid duration: ${days} must be > 0`);
        let current = this.findNextWorkday(startDate);
        if (days === 0) return current;
        let remaining = days - 1; // стартовый день уже потреблён как первый рабочий день задачи
        while (remaining > 0) {
            current = this.findNextWorkday(addDays(current, 1));
            remaining -= 1;
        }
        return current;
    }
}

// FR-2 - задача. Простой контейнер данных (без собственной логики расчёта -
// расчёт целиком в ProjectScheduler, см. ниже) - start/end заполняются
// ТОЛЬКО планировщиком, не самой задачей.
export class Task {
    /**
     * @param {string} id
     * @param {number} duration - рабочих дней, целое > 0
     * @param {string|null} dependsOn - id родительской задачи или null
     * @param {Date|null} fixedStart - фиксированный старт или null
     * @throws {SchedulerError} E005, E004
     */
    constructor(id, duration, dependsOn = null, fixedStart = null) {
        if (!(duration > 0)) {
            throw new SchedulerError('E005', `Invalid duration: ${duration} must be > 0`);
        }
        if (dependsOn && fixedStart) {
            throw new SchedulerError('E004', `Task '${id}' has both dependsOn and fixedStart`);
        }
        this.id = id;
        this.duration = duration;
        this.dependsOn = dependsOn || null;
        this.fixedStart = fixedStart || null;
        this.start = null;
        this.end = null;
    }
}

// FR-3 - планировщик. Хранит задачи, строит порядок расчёта топологической
// сортировкой (алгоритм Кана - FR-3.2), пересчитывает до стабилизации
// (FR-3.3) - см. докстринг recalculate() ниже про то, зачем вообще нужна
// стабилизация в несколько проходов, а не один линейный проход по
// топологически отсортированному списку (казалось бы, при ПРАВИЛЬНОМ
// порядке одного прохода достаточно - см. пояснение там).
export class ProjectScheduler {
    /**
     * @param {WorkCalendar} calendar
     */
    constructor(calendar) {
        this.calendar = calendar;
        /** @type {Map<string, Task>} */
        this.tasks = new Map();
    }

    /**
     * @param {string} id
     * @param {number} duration
     * @param {string|null} dependsOn
     * @param {Date|null} fixedStart
     * @returns {Task}
     * @throws {SchedulerError} E001, E002, E004, E005
     */
    addTask(id, duration, dependsOn = null, fixedStart = null) {
        if (this.tasks.has(id)) {
            throw new SchedulerError('E001', `Task with id '${id}' already exists`);
        }
        if (dependsOn && !this.tasks.has(dependsOn)) {
            throw new SchedulerError('E002', `Task '${id}' depends on '${dependsOn}' which not found`);
        }
        const task = new Task(id, duration, dependsOn, fixedStart);
        this.tasks.set(id, task);
        return task;
    }

    /**
     * FR-3.2 - алгоритм Кана. Возвращает задачи в порядке "родители перед
     * детьми" - строит граф ТОЛЬКО из связей dependsOn (fixedStart-задачи -
     * всегда "корни", без входящих рёбер).
     * @returns {Task[]}
     * @throws {SchedulerError} E003, если есть цикл
     */
    _topologicalSort() {
        const inDegree = new Map();
        const children = new Map(); // parentId -> [childId, ...]
        this.tasks.forEach((task, id) => {
            inDegree.set(id, task.dependsOn ? 1 : 0);
            if (!children.has(id)) children.set(id, []);
        });
        this.tasks.forEach((task, id) => {
            if (task.dependsOn) {
                if (!children.has(task.dependsOn)) children.set(task.dependsOn, []);
                children.get(task.dependsOn).push(id);
            }
        });

        const queue = [...this.tasks.keys()].filter(id => inDegree.get(id) === 0);
        const sorted = [];
        while (queue.length > 0) {
            const id = queue.shift();
            sorted.push(this.tasks.get(id));
            (children.get(id) || []).forEach(childId => {
                inDegree.set(childId, inDegree.get(childId) - 1);
                if (inDegree.get(childId) === 0) queue.push(childId);
            });
        }

        if (sorted.length !== this.tasks.size) {
            // Задачи, НЕ попавшие в sorted, - часть цикла (или зависят от
            // задачи внутри цикла) - перечисляем их id для читаемой ошибки.
            const inCycle = [...this.tasks.keys()].filter(id => !sorted.some(t => t.id === id));
            throw new SchedulerError('E003', `Circular dependency detected: ${inCycle.join(' -> ')}`);
        }
        return sorted;
    }

    /**
     * Считает {start, end} ОДНОЙ задачи из уже (частично) посчитанных
     * данных - fixedStart побеждает безусловно; dependsOn - "сразу после
     * конца родителя" (родитель ДОЛЖЕН уже иметь end - гарантируется
     * топологическим порядком вызова в recalculate()); ни то ни другое -
     * задача "плывёт" от начала эры (день 0) - тот же принцип, что uses
     * anchor в остальном проекте.
     * @param {Task} task
     * @returns {{start: Date, end: Date}}
     */
    _calculateTask(task) {
        let start;
        if (task.fixedStart) {
            start = task.fixedStart;
        } else if (task.dependsOn) {
            const parent = this.tasks.get(task.dependsOn);
            // parent.end гарантированно заполнен - топологический порядок
            // (см. recalculate()) вызывает _calculateTask() для родителя
            // РАНЬШЕ, чем для этого потомка.
            start = addDays(parent.end, 1);
        } else {
            start = new Date(1970, 0, 1); // "эпоха" - задача без привязки, самостоятельная дорожка
        }
        const end = this.calendar.addWorkdays(start, task.duration);
        return { start: this.calendar.findNextWorkday(start), end };
    }

    /**
     * FR-3.1/3.3 - главный пересчёт. Топологическая сортировка (см. выше)
     * УЖЕ гарантирует верный порядок при ОДНОМ проходе для дерева/цепочки
     * без изменений "задним числом" - но повторные проходы (стабилизация)
     * всё равно нужны, потому что calendar.addWorkdays()/findNextWorkday()
     * зависят от КОНКРЕТНОЙ даты (не просто "числа дней") - при первом
     * проходе start ещё может быть "эпохой" (1970 год) для задачи без
     * fixedStart/dependsOn, но если у НЕЁ САМОЙ есть дети - их даты нужно
     * пересчитать ЗАНОВО, когда (например, снаружи, через updateTask())
     * появится реальная точка отсчёта. Для ПРОСТОГО графа без внешних
     * правок одного прохода достаточно - changed после первого прохода
     * будет false, стабилизация останавливается сразу (см. NFR-1.3).
     * @param {number} maxIterations
     * @returns {Object} { taskId: { start: ISO, end: ISO } }
     * @throws {SchedulerError} E003, E007
     */
    recalculate(maxIterations = 10) {
        const sorted = this._topologicalSort();
        let iteration = 0;
        let changed = true;
        while (changed && iteration < maxIterations) {
            changed = false;
            sorted.forEach(task => {
                const { start, end } = this._calculateTask(task);
                const prevStartIso = task.start ? formatISODate(task.start) : null;
                const prevEndIso = task.end ? formatISODate(task.end) : null;
                const newStartIso = formatISODate(start);
                const newEndIso = formatISODate(end);
                if (newStartIso !== prevStartIso || newEndIso !== prevEndIso) changed = true;
                task.start = start;
                task.end = end;
            });
            iteration += 1;
        }
        if (changed) {
            throw new SchedulerError('E007', `Tasks did not stabilize after ${maxIterations} iterations`);
        }
        return this.getSchedule();
    }

    /**
     * FR-3.1 - обновление задачи с автопересчётом (E008, если не найдена).
     * @param {string} id
     * @param {{duration?: number, fixedStart?: Date, dependsOn?: string}} updates
     */
    updateTask(id, updates) {
        const task = this.tasks.get(id);
        if (!task) throw new SchedulerError('E008', `Task '${id}' not found`);
        if (updates.dependsOn !== undefined && updates.fixedStart !== undefined
            && updates.dependsOn && updates.fixedStart) {
            throw new SchedulerError('E004', `Task '${id}' has both dependsOn and fixedStart`);
        }
        if (updates.duration !== undefined) {
            if (!(updates.duration > 0)) throw new SchedulerError('E005', `Invalid duration: ${updates.duration} must be > 0`);
            task.duration = updates.duration;
        }
        if (updates.dependsOn !== undefined) {
            if (updates.dependsOn && !this.tasks.has(updates.dependsOn)) {
                throw new SchedulerError('E002', `Task '${id}' depends on '${updates.dependsOn}' which not found`);
            }
            task.dependsOn = updates.dependsOn || null;
            if (task.dependsOn) task.fixedStart = null;
        }
        if (updates.fixedStart !== undefined) {
            task.fixedStart = updates.fixedStart || null;
            if (task.fixedStart) task.dependsOn = null;
        }
        this.recalculate();
    }

    /**
     * @returns {Object} { taskId: { start: 'YYYY-MM-DD', end: 'YYYY-MM-DD', duration, dependsOn } }
     */
    getSchedule() {
        const schedule = {};
        this.tasks.forEach((task, id) => {
            schedule[id] = {
                start: task.start ? formatISODate(task.start) : null,
                end: task.end ? formatISODate(task.end) : null,
                duration: task.duration,
                dependsOn: task.dependsOn
            };
        });
        return schedule;
    }
}
