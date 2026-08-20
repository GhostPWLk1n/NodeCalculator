/**
 * SPDX-License-Identifier: MIT
 * SPDX-FileCopyrightText: 2024 NodeCalculate Team
 * SPDX-FileCopyrightText: 2024 Pavel Fomin
 *
 * @file    historyManager.js
 * @brief   Стек Undo/Redo поверх дифф-движка stateDiff.js
 * @author  Pavel Fomin
 * @version 1.8.94
 * @see     https://github.com/GhostPWLk1n/NodeCalculator.git
 */

import { computeDiff, applyDiff } from './stateDiff.js';

// Раунд 196 (по запросу Mr.D: "давай начнём делать дельта-журнал,
// сложно, но нужно... хотелось как раз подойти к undo/redo") -
// HistoryManager - стек Undo/Redo поверх дифф-движка (stateDiff.js).
// Каждая запись истории - {forward, backward} diff между ДВУМЯ
// последовательными полными снимками состояния проекта (не журнал
// отдельных операций - см. докстринг stateDiff.js про архитектурное
// решение) - хранит ОБА направления сразу (вычислены ОДИН раз при
// checkpoint(), пока оба состояния под рукой) - проще и надёжнее, чем
// пытаться "инвертировать" уже готовый diff позже.
export class HistoryManager {
    constructor(maxHistorySize = 100) {
        this.undoStack = [];
        this.redoStack = [];
        this.lastSnapshot = null;
        this._checkpointTimer = null;
        this._maxHistorySize = maxHistorySize;
        // Раунд 197 (по жалобам Mr.D: "кол-во действий в журнале...
        // сейчас возвращал не больше 1-го действия" и "после клика по
        // Undo ни разу не получилось сделать Redo") - НАЙДЕНА причина:
        // layoutManager.loadFromData()/boardManager.loadFromData()
        // (вызываются из applyRestoredState() в main.js ВНУТРИ самого
        // undo()/redo()) сами, ВНУТРИ СЕБЯ, вызывают
        // nodeManager.calculateAll() (перестраивают ноды - те заново
        // проходят обычный цикл пересчёта) - а calculateAll() САМ
        // пытается запланировать контрольную точку истории (тот же
        // хук, что и для обычных правок, Раунд 196). Если пересборка
        // ноды через конструктор (loadFromData()) при повторной
        // сериализации не даёт побайтово идентичный результат исходному
        // diff-восстановленному состоянию (вполне возможно - конструктор
        // может доопределять поля со значением по умолчанию, которых
        // не было явно в diff'е) - эта "фоновая", НЕЗАПЛАНИРОВАННАЯ
        // контрольная точка через 500мс после undo()/redo() создавала
        // ЛОЖНУЮ запись в истории И, что хуже, ОБНУЛЯЛА redoStack (та
        // же логика "новое изменение стирает future redo", что и для
        // ОБЫЧНЫХ правок) - именно поэтому Redo не срабатывал НИ РАЗУ
        // после Undo. suspend()/resume() - явно останавливают ЛЮБУЮ
        // активность истории на время самой перезагрузки данных.
        this._suspended = false;
    }

    // Раунд 197 - вызывается ПЕРЕД loadFromData() внутри undo()/redo() -
    // отменяет любой уже запланированный (но ещё не сработавший)
    // checkpoint и полностью блокирует scheduleCheckpoint()/checkpoint()
    // до resume().
    suspend() {
        this._suspended = true;
        if (this._checkpointTimer) {
            clearTimeout(this._checkpointTimer);
            this._checkpointTimer = null;
        }
    }

    // Раунд 197 - вызывается ПОСЛЕ loadFromData() - снимает блокировку
    // И пересинхронизирует lastSnapshot с ФАКТИЧЕСКИМ текущим
    // состоянием (полученным ЗАНОВО через getCurrentState() уже ПОСЛЕ
    // перезагрузки, а не теоретически вычисленным applyDiff()) -
    // гарантирует, что БУДУЩИЕ контрольные точки сравниваются с тем,
    // что реально сейчас в приложении, а не с тем, что "должно было
    // бы быть" по чистой математике diff'а.
    resume(currentState) {
        this._suspended = false;
        if (currentState) this.lastSnapshot = currentState;
    }

    // Раунд 196 - устанавливает "точку отсчёта" ЗАНОВО - вызывается
    // при загрузке проекта/новом проекте (main.js) - история Undo НЕ
    // должна переживать переход на ДРУГОЙ проект (это была бы путаница -
    // "отменить" случайно откатило бы к состоянию СОВСЕМ ДРУГОГО файла).
    reset(currentState) {
        this.lastSnapshot = currentState;
        this.undoStack = [];
        this.redoStack = [];
        if (this._checkpointTimer) {
            clearTimeout(this._checkpointTimer);
            this._checkpointTimer = null;
        }
    }

    // Раунд 196 - вызывается после КАЖДОГО содержательного изменения
    // проекта (см. main.js, тот же хук, что уже держит dirty-флаг,
    // Раунд 184) - САМА запись в историю ДЕБАУНСИТСЯ (по умолчанию
    // 500мс простоя) - иначе непрерывное перетаскивание (десятки
    // calculateAll() в секунду во время одного movement-жеста) породило
    // бы десятки отдельных шагов Undo для ОДНОГО действия пользователя -
    // один Undo должен откатывать одно ЗАКОНЧЕННОЕ действие целиком, не
    // один промежуточный кадр перетаскивания.
    scheduleCheckpoint(getCurrentState, delayMs = 500) {
        if (this._suspended) return;
        if (this._checkpointTimer) clearTimeout(this._checkpointTimer);
        this._checkpointTimer = setTimeout(() => {
            this._checkpointTimer = null;
            this.checkpoint(getCurrentState());
        }, delayMs);
    }

    // Раунд 196 - немедленная (без дебаунса) фиксация контрольной точки -
    // используется scheduleCheckpoint() внутри, но доступна и напрямую
    // (например, ПЕРЕД undo()/redo() самими - чтобы не потерять
    // "зависшее" недебаунсенное изменение, см. undo()/redo() ниже).
    checkpoint(currentState) {
        if (this._suspended) return;
        if (this._checkpointTimer) {
            clearTimeout(this._checkpointTimer);
            this._checkpointTimer = null;
        }
        if (!this.lastSnapshot) {
            this.lastSnapshot = currentState;
            return;
        }
        const forward = computeDiff(this.lastSnapshot, currentState);
        if (forward.length === 0) return; // ничего не изменилось - не засоряем историю пустым шагом
        const backward = computeDiff(currentState, this.lastSnapshot);
        this.undoStack.push({ forward, backward });
        if (this.undoStack.length > this._maxHistorySize) this.undoStack.shift();
        // Новое изменение "затирает" будущее redo - стандартная
        // семантика Undo/Redo в любом редакторе (правка после отмены
        // делает "вернуть" бессмысленным - та ветка истории больше не
        // актуальна).
        this.redoStack = [];
        this.lastSnapshot = currentState;
    }

    canUndo() { return this.undoStack.length > 0; }
    canRedo() { return this.redoStack.length > 0; }

    // Раунд 196 - откатывает ОДИН шаг назад, возвращает НОВОЕ состояние
    // (вызывающий код сам решает, что с ним делать - см.
    // window.undoAction() в main.js, загружает через
    // layoutManager.loadFromData()/boardManager.loadFromData(), те же
    // функции, что уже загружают обычный файл проекта). getCurrentState -
    // ОПЦИОНАЛЬНЫЙ колбэк: если передан, ПЕРЕД самим undo() сначала
    // фиксирует ЛЮБОЕ "зависшее" недебаунсенное изменение (иначе оно
    // потерялось бы молча - пользователь успел что-то поменять, но
    // scheduleCheckpoint() ещё не успел сработать).
    undo(getCurrentState) {
        if (getCurrentState) this.checkpoint(getCurrentState());
        if (!this.canUndo()) return null;
        const entry = this.undoStack.pop();
        const newState = applyDiff(this.lastSnapshot, entry.backward);
        this.redoStack.push(entry);
        this.lastSnapshot = newState;
        return newState;
    }

    redo(getCurrentState) {
        if (getCurrentState) this.checkpoint(getCurrentState());
        if (!this.canRedo()) return null;
        const entry = this.redoStack.pop();
        const newState = applyDiff(this.lastSnapshot, entry.forward);
        this.undoStack.push(entry);
        this.lastSnapshot = newState;
        return newState;
    }
}
