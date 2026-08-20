/**
 * SPDX-License-Identifier: MIT
 * SPDX-FileCopyrightText: 2024 NodeCalculate Team
 * SPDX-FileCopyrightText: 2024 Pavel Fomin
 *
 * @file    stateDiff.js
 * @brief   Движок вычисления/применения различий между двумя снимками состояния проекта
 * @author  Pavel Fomin
 * @version 1.8.94
 * @see     https://github.com/GhostPWLk1n/NodeCalculator.git
 */

// Раунд 196 (по запросу Mr.D: "давай начнём делать дельта-журнал,
// сложно, но нужно... хотелось как раз подойти к undo/redo") -
// движок вычисления/применения различий между двумя снимками
// состояния проекта (layoutManager.serialize() + boardManager.serialize()).
//
// АРХИТЕКТУРНОЕ РЕШЕНИЕ (обсуждено с Mr.D перед реализацией):
// вместо журнала ОПЕРАЦИЙ (перехват каждой точки мутации по всему
// проекту вручную - десятки мест, разбросанных по многим типам нод,
// любая пропущенная точка - тихий баг рассинхронизации) - ДИФФ уже
// ГОТОВОГО, заведомо корректного полного состояния (то, которое и так
// производит serialize() для обычного сохранения). Контрольные срезы
// снимаются периодически (см. historyManager.js) - между двумя
// срезами вычисляется разница, она и есть "запись" в
// дельта-журнале/истории Undo. НЕ требует трогать ни одну из
// существующих точек изменения - работает ПОВЕРХ уже готового кода.
//
// Формат diff: массив операций { path: (string|number)[], op:
// 'set'|'delete'|'insert', value?, index? } - применяется
// ПОСЛЕДОВАТЕЛЬНО, каждая операция адресует конкретный путь внутри
// дерева состояния.
//
// Массивы объектов со стабильным полем id (nodes/connections/layouts/
// boards - у ВСЕХ есть свой id) диффятся ПО ЭТОМУ id (не по индексу) -
// добавление/удаление/правка одного элемента где угодно в массиве не
// требует переписывать весь массив целиком. Массивы БЕЗ поля id
// (редкие случаи) - целиком заменяются одной операцией 'set', если
// отличаются хоть чем-то - проще и безопаснее, чем универсальный
// diff произвольных массивов (тот легко ошибается на перестановках).

// Раунд 196 - глубокое рекурсивное сравнение двух JSON-совместимых
// значений - используется и диффом (нужно ли вообще что-то менять),
// и тестами.
export function deepEqual(a, b) {
    if (a === b) return true;
    if (typeof a !== typeof b) return false;
    if (a === null || b === null) return a === b;
    if (typeof a !== 'object') return a === b;
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    if (Array.isArray(a)) {
        if (a.length !== b.length) return false;
        return a.every((v, i) => deepEqual(v, b[i]));
    }
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    if (keysA.length !== keysB.length) return false;
    return keysA.every(k => Object.prototype.hasOwnProperty.call(b, k) && deepEqual(a[k], b[k]));
}

function isPlainObject(v) {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
}

// Раунд 196 - массив объектов "диффится по id", если ВСЕ его элементы -
// обычные объекты (не примитивы/массивы) с непустым полем id/key -
// иначе (смешанный/примитивный массив) - откатываемся на "весь массив
// целиком", безопаснее для нестандартных случаев.
function arrayIdField(arr) {
    if (!Array.isArray(arr) || arr.length === 0) return null;
    if (!arr.every(isPlainObject)) return null;
    if (arr.every(el => typeof el.id !== 'undefined' && el.id !== null)) return 'id';
    if (arr.every(el => typeof el.key !== 'undefined' && el.key !== null)) return 'key';
    return null;
}

// Раунд 196 - вычисляет diff между oldVal и newVal, добавляя операции
// в ops (path - текущий путь до oldVal/newVal внутри всего дерева).
function diffValue(oldVal, newVal, path, ops) {
    if (deepEqual(oldVal, newVal)) return;

    // Оба - массивы объектов с общим id-полем - диффим ПОЭЛЕМЕНТНО.
    if (Array.isArray(oldVal) && Array.isArray(newVal)) {
        const idField = arrayIdField(oldVal) && arrayIdField(newVal) && (arrayIdField(oldVal) === arrayIdField(newVal))
            ? arrayIdField(oldVal) : null;
        if (idField) {
            diffArrayById(oldVal, newVal, idField, path, ops);
            return;
        }
        // Массив без общего id-поля (или пустой с одной из сторон) -
        // целиком заменяем одной операцией, раз уже установили через
        // deepEqual выше, что они отличаются.
        ops.push({ path, op: 'set', value: newVal });
        return;
    }

    // Оба - обычные объекты (не массивы) - диффим по ключам.
    if (isPlainObject(oldVal) && isPlainObject(newVal)) {
        const keys = new Set([...Object.keys(oldVal), ...Object.keys(newVal)]);
        keys.forEach(k => {
            const hasOld = Object.prototype.hasOwnProperty.call(oldVal, k);
            const hasNew = Object.prototype.hasOwnProperty.call(newVal, k);
            if (hasOld && !hasNew) {
                ops.push({ path: [...path, k], op: 'delete' });
            } else if (!hasOld && hasNew) {
                ops.push({ path: [...path, k], op: 'set', value: newVal[k] });
            } else {
                diffValue(oldVal[k], newVal[k], [...path, k], ops);
            }
        });
        return;
    }

    // Разные типы (объект->массив, объект->примитив и т.п.) или оба -
    // примитивы, но разные - простая замена значения целиком.
    ops.push({ path, op: 'set', value: newVal });
}

// Раунд 196 - поэлементный diff двух массивов объектов по общему
// id-полю - производит 'delete' для пропавших id, 'insert' для новых
// (с ЦЕЛЕВЫМ индексом в newArr - нужен, чтобы applyDiff() корректно
// восстановил порядок), и рекурсивный diffValue() для id, оставшихся
// в обоих массивах (правка полей существующего элемента).
function diffArrayById(oldArr, newArr, idField, path, ops) {
    const oldById = new Map(oldArr.map(el => [el[idField], el]));
    const newById = new Map(newArr.map(el => [el[idField], el]));

    oldArr.forEach(el => {
        if (!newById.has(el[idField])) {
            ops.push({ path: [...path, { byId: idField, id: el[idField] }], op: 'delete' });
        }
    });
    newArr.forEach((el, index) => {
        if (!oldById.has(el[idField])) {
            ops.push({ path: [...path], op: 'insert', index, value: el });
        } else {
            diffValue(oldById.get(el[idField]), el, [...path, { byId: idField, id: el[idField] }], ops);
        }
    });
    // Раунд 196 (багфикс, найден исполняемым тестом с комбинированным
    // изменением - добавление+удаление+правка ОДНОВРЕМЕННО) - раньше
    // 'reorder' добавлялась ТОЛЬКО если набор id не менялся (sameSet) -
    // но тогда при ОДНОВРЕМЕННОМ добавлении/удалении элементов
    // перестановка ОСТАВШИХСЯ друг относительно друга и относительно
    // новых элементов терялась - результат применения не совпадал с
    // ожидаемым порядком newArr. Теперь 'reorder' добавляется
    // БЕЗУСЛОВНО при ЛЮБОМ структурном изменении массива (мы уже
    // внутри diffArrayById() ТОЛЬКО если !deepEqual(oldVal,newVal) -
    // массив ТОЧНО как-то изменился) - гарантирует корректный итоговый
    // порядок ценой чуть большего размера diff (безвредная
    // избыточность в случаях, где перестановка была бы и так верна
    // без явного 'reorder').
    ops.push({ path: [...path], op: 'reorder', idField, order: newArr.map(el => el[idField]) });
}

// Раунд 196 - главная точка входа: возвращает diff (массив операций),
// превращающий oldState в newState. Пустой массив - изменений нет.
export function computeDiff(oldState, newState) {
    const ops = [];
    diffValue(oldState, newState, [], ops);
    return ops;
}

// Раунд 196 - получить значение по пути (с поддержкой byId-сегментов
// для массивов, диффящихся по id) - используется applyDiff().
function getByPath(root, path) {
    let cur = root;
    for (const seg of path) {
        if (cur == null) return undefined;
        if (typeof seg === 'object' && seg.byId) {
            cur = Array.isArray(cur) ? cur.find(el => el[seg.byId] === seg.id) : undefined;
        } else {
            cur = cur[seg];
        }
    }
    return cur;
}

// Раунд 196 - применяет ОДНУ операцию к дереву root (мутирует ЕГО
// КОПИЮ - см. applyDiff(), не сам root напрямую).
function applyOp(root, opEntry) {
    const { path, op } = opEntry;
    if (path.length === 0) {
        // Операция на САМОМ корне (крайне маловероятно в реальных
        // diff'ах этого приложения, но поддерживаем для полноты) -
        // 'set' на пустом пути подменяет весь root целиком.
        if (op === 'set') return opEntry.value;
        return root;
    }
    const parentPath = path.slice(0, -1);
    const lastSeg = path[path.length - 1];
    const parent = getByPath(root, parentPath);
    if (parent == null) return root; // путь ведёт в никуда - защитный откат, не бросаем исключение на чужих данных

    if (typeof lastSeg === 'object' && lastSeg.byId) {
        // Операция над ЭЛЕМЕНТОМ массива, адресованным по id - 'delete'/
        // 'insert' обрабатываются на уровне САМОГО массива (см. ниже,
        // path без последнего byId-сегмента для них не используется -
        // они всегда приходят с path, УКАЗЫВАЮЩИМ НА МАССИВ, не на
        // элемент, см. diffArrayById()) - здесь остаётся ТОЛЬКО случай
        // "правка поля СУЩЕСТВУЮЩЕГO элемента массива", т.е. lastSeg -
        // byId, а сама операция - вложенный 'set'/'delete' ВНУТРИ
        // этого элемента, что уже отражено в БОЛЕЕ ДЛИННОМ path и сюда
        // не попадает. lastSeg == byId САМ ПО СЕБЕ не операция -
        // ничего не делаем (не должно происходить на практике).
        return root;
    }

    if (op === 'set') {
        parent[lastSeg] = opEntry.value;
    } else if (op === 'delete') {
        if (Array.isArray(parent)) {
            const idx = typeof lastSeg === 'number' ? lastSeg : -1;
            if (idx >= 0) parent.splice(idx, 1);
        } else {
            delete parent[lastSeg];
        }
    } else if (op === 'insert') {
        // 'insert' приходит с path, указывающим НА САМ МАССИВ (не на
        // элемент) - значит parent (по parentPath) - это родитель
        // массива, а lastSeg - ключ, под которым массив лежит.
        const arr = parent[lastSeg];
        if (Array.isArray(arr)) {
            const insertIdx = Math.min(opEntry.index ?? arr.length, arr.length);
            arr.splice(insertIdx, 0, opEntry.value);
        }
    } else if (op === 'reorder') {
        const arr = parent[lastSeg];
        if (Array.isArray(arr)) {
            const idField = opEntry.idField || 'id';
            const byId = new Map(arr.map(el => [el[idField], el]));
            const reordered = opEntry.order.map(id => byId.get(id)).filter(el => el !== undefined);
            arr.length = 0;
            arr.push(...reordered);
        }
    }
    return root;
}

// Раунд 196 - применяет diff (массив операций из computeDiff()) к
// state, ВОЗВРАЩАЯ НОВЫЙ объект (глубокая копия через
// JSON.parse(JSON.stringify(...)) ПЕРЕД мутациями - state НИКОГДА не
// мутируется напрямую, вызывающий код всегда получает свежий объект,
// а исходный остаётся нетронутым для сравнения/отладки).
export function applyDiff(state, diff) {
    let root = JSON.parse(JSON.stringify(state));
    // 'insert'/'delete' на элементах массива, диффленного по id,
    // требуют ОСОБОЙ обработки (path указывает на МАССИВ для insert,
    // но на КОНКРЕТНЫЙ элемент через byId-сегмент для delete) -
    // применяем каждую операцию согласно её ТИПУ.
    diff.forEach(opEntry => {
        const { path, op } = opEntry;
        if (op === 'delete' && path.length > 0 && typeof path[path.length - 1] === 'object' && path[path.length - 1].byId) {
            const byIdSeg = path[path.length - 1];
            const arrPath = path.slice(0, -1);
            const arr = getByPath(root, arrPath);
            if (Array.isArray(arr)) {
                const idx = arr.findIndex(el => el[byIdSeg.byId] === byIdSeg.id);
                if (idx >= 0) arr.splice(idx, 1);
            }
            return;
        }
        if (path.length > 0 && typeof path[path.length - 1] === 'object' && path[path.length - 1].byId) {
            // Путь до КОНКРЕТНОГО поля ВНУТРИ элемента массива,
            // диффленного по id, например path = [..., {byId:'id',
            // id:5}, 'x'] - НЕ обрабатывается здесь (lastSeg - 'x', не
            // byId-сегмент) - это стандартный случай, идёт через
            // applyOp() ниже, getByPath() уже умеет резолвить
            // byId-сегменты В СЕРЕДИНЕ пути.
        }
        root = applyOp(root, opEntry);
    });
    return root;
}
