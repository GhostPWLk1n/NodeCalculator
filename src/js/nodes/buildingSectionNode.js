/**
 * SPDX-License-Identifier: MIT
 * SPDX-FileCopyrightText: 2024 NodeCalculate Team
 * SPDX-FileCopyrightText: 2024 Pavel Fomin
 *
 * @file    buildingSectionNode.js
 * @brief   Распознавание таблиц ТЭП (этажи + общая площадь) как Блок-Секция здания
 * @author  Pavel Fomin
 * @version 1.8.94
 * @see     https://github.com/GhostPWLk1n/NodeCalculator.git
 */

import { BaseNode } from './baseNode.js';
import { TableData, ListData } from '../utils/dataTypes.js';
import { SocketFactory } from '../utils/socketFactory.js';

/**
 * BuildingSectionNode ("Блок-Секция ТЭП") - Раунд 198, по запросу Mr.D:
 * "распознавание табличных данных... нужно передать их в узел и
 * распознать как блок секцию здания". ДВА входа (прямое требование
 * Mr.D):
 *   0 - "Этажи" - таблица "ТЭП. Маркер Секция. Все этажи БСx" -
 *       детальные данные по КАЖДОМУ помещению на каждом этаже (код,
 *       подтип, площади) - в файле ОДНА секция на файл.
 *   1 - "Общая площадь" - таблица "ТЭП Общая площадь здания выше/ниже
 *       0.000" (или аналогичная "Строительный объём", та же форма) -
 *       СВОДНЫЕ показатели, но ОДИН файл может содержать НЕСКОЛЬКО
 *       секций сразу (БС1 И БС2 в одной таблице).
 *
 * Оба входа принимаются через СУЩЕСТВУЮЩИЙ XlsxImportNode (Импорт из
 * Excel) - эта нода НЕ читает файлы сама, только table.data,
 * ПРИШЕДШИЙ по соединению (тот же контракт TableData, что уже
 * использует GanttTableProcessorNode/TreeToTableNode - см. их
 * докстринги).
 *
 * КЛЮЧЕВОЕ АРХИТЕКТУРНОЕ РЕШЕНИЕ: код секции (БС1/БС2/...) АВТОМАТИЧЕСКИ
 * определяется из данных ЭТАЖЕЙ (столбец "LabPP: Для этажа" содержит
 * значения вида "БС1-Подвал"/"БС1-Этаж 01" - код секции - часть ДО
 * первого дефиса) - этим же кодом ФИЛЬТРУЕТСЯ таблица "Общая площадь"
 * (та может описывать НЕСКОЛЬКО секций сразу) - пользователю НЕ нужно
 * вручную указывать, какая секция "своя" - нода видит это по
 * подключённым данным этажей.
 *
 * Проверено на реальных файлах (4 шт. от Mr.D, Раунд 198): суммы
 * подытогов по этажам ТОЧНО совпадают с итоговой строкой файла для
 * ОБЕИХ секций (БС1/БС2) - парсинг корректен.
 */
export class BuildingSectionNode extends BaseNode {
    constructor(id, type, x, y, config = {}) {
        super(id, type, x, y, config);
        this.inputs = 3;
        this.inputSockets = [0, 1, 2];
        this.outputs = 1;
        this.width = config.width || 240;

        this._sourceFloorsName = null;
        this._sourceAreaName = null;
        this._sourceVolumeName = null;

        // Раунд 198/199 - результат распознавания (пересчитывается
        // заново в calculate() каждый раз, не сериализуется -
        // производное состояние от подключённых источников, как и
        // tableData у остальных обработчиков таблиц в проекте).
        this.sectionCode = null;
        this.floors = [];
        this.grandTotal = null;
        this.areaAbove = null;
        this.areaBelow = null;
        // Раунд 199 (по запросу Mr.D: "нужен ещё слот для таблицы со
        // строительным объёмом") - третий вход, та же таблица-форма,
        // что и "Общая площадь" (позиционный разбор, переиспользует
        // _parseTotalArea() - см. её докстринг про "выше"/"ниже").
        this.volumeAbove = null;
        this.volumeBelow = null;
        // Раунд 200 (по запросу Mr.D: "оформление. ручной ввод данных.
        // если нет данных для общей площади и объёма, то их можно
        // задать вручную") - ЗАПАСНЫЕ значения (персистентные, из
        // config) - используются, ТОЛЬКО когда автоматическое
        // распознавание вернуло null (вход не подключён, ИЛИ секция не
        // нашлась в подключённой сводной таблице) - см. calculate()
        // ниже про порядок приоритета. null - "не задано вручную", не
        // "ноль" - иначе введённый пользователем настоящий 0
        // (например, у секции действительно нет подвала) было бы
        // невозможно отличить от "поле просто пустое".
        this.manualAreaAbove = config.manualAreaAbove ?? null;
        this.manualAreaBelow = config.manualAreaBelow ?? null;
        this.manualVolumeAbove = config.manualVolumeAbove ?? null;
        this.manualVolumeBelow = config.manualVolumeBelow ?? null;
        // Раунд 199 (задел под "Кварталы" - следующий узел-агрегатор,
        // собирающий НЕСКОЛЬКО Блок-Секций в одну сводку) - ПЛОСКИЙ
        // список ВСЕХ помещений секции (не только суммы по этажам) -
        // агрегатору нужна разбивка ПО КОДУ ПОМЕЩЕНИЯ (кладовые/МОП/
        // ТЕХ/коммерция/квартиры по числу комнат), которую сама эта
        // нода для СВОЕГО вывода не считает - экспортируем сырьё,
        // агрегатор считает разбивку сам.
        this.units = [];
        // Раунд 201 - результаты проверки данных (см. _validateData())
        this.issues = [];

        this.tableData = new TableData();
        this.resultListData = new ListData();
        this.value = 0;
    }

    // Раунд 199 - точка расширения BaseNode (см. её докстринг) -
    // добавляет к стандартным 4 полям СОБСТВЕННОЕ, богатое состояние
    // распознавания, которое агрегатору кварталов нужно целиком, не
    // только value/tableData.
    getOutputBySocket(index) {
        return {
            value: this.value,
            tableData: this.tableData,
            listData: this.listData,
            resultListData: this.resultListData,
            sectionCode: this.sectionCode,
            floors: this.floors,
            grandTotal: this.grandTotal,
            areaAbove: this.areaAbove,
            areaBelow: this.areaBelow,
            volumeAbove: this.volumeAbove,
            volumeBelow: this.volumeBelow,
            units: this.units,
            issues: this.issues
        };
    }

    createContent() {
        const content = document.createElement('div');
        content.className = 'node-content';
        content.style.cssText = 'width: 100%; min-width: 210px;';

        const floorsRow = document.createElement('div');
        floorsRow.style.cssText = 'display:flex; align-items:center; gap:6px;';
        const floorsSocket = SocketFactory.createSocket({
            nodeId: this.id, socketType: 'input', index: 0, isData: true,
            title: 'Таблица "Маркер Секция. Все этажи" - детальные данные по помещениям на этажах (импорт из Excel)'
        });
        floorsRow.appendChild(floorsSocket);
        const floorsLabel = document.createElement('span');
        floorsLabel.className = 'building-section-floors-label';
        floorsLabel.style.cssText = 'color:var(--md-text-secondary); font-size:11px; flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;';
        floorsLabel.textContent = 'Этажи: ' + this._floorsStatusText();
        floorsRow.appendChild(floorsLabel);
        content.appendChild(floorsRow);

        const areaRow = document.createElement('div');
        areaRow.style.cssText = 'display:flex; align-items:center; gap:6px; margin-top:2px;';
        const areaSocket = SocketFactory.createSocket({
            nodeId: this.id, socketType: 'input', index: 1, isData: true,
            title: 'Таблица "Общая площадь здания выше/ниже 0.000" - сводные показатели (импорт из Excel)'
        });
        areaRow.appendChild(areaSocket);
        const areaLabel = document.createElement('span');
        areaLabel.className = 'building-section-area-label';
        areaLabel.style.cssText = 'color:var(--md-text-secondary); font-size:11px; flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;';
        areaLabel.textContent = 'Общая площадь: ' + this._areaStatusText();
        areaRow.appendChild(areaLabel);
        content.appendChild(areaRow);

        // Раунд 199 (по запросу Mr.D: "нужен ещё слот для таблицы со
        // строительным объёмом") - тот же приём, что у "Общей площади"
        // выше - позиционный разбор той же формы таблицы.
        const volumeRow = document.createElement('div');
        volumeRow.style.cssText = 'display:flex; align-items:center; gap:6px; margin-top:2px;';
        const volumeSocket = SocketFactory.createSocket({
            nodeId: this.id, socketType: 'input', index: 2, isData: true,
            title: 'Таблица "Строительный объём здания выше/ниже 0.000" - сводные показатели (импорт из Excel)'
        });
        volumeRow.appendChild(volumeSocket);
        const volumeLabel = document.createElement('span');
        volumeLabel.className = 'building-section-volume-label';
        volumeLabel.style.cssText = 'color:var(--md-text-secondary); font-size:11px; flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;';
        volumeLabel.textContent = 'Строительный объём: ' + this._volumeStatusText();
        volumeRow.appendChild(volumeLabel);
        content.appendChild(volumeRow);

        const statusRow = document.createElement('div');
        statusRow.style.cssText = 'padding-top:4px; padding-left:20px;';
        const statusText = document.createElement('div');
        statusText.className = 'building-section-status';
        statusText.style.cssText = 'color:var(--md-text); font-size:10px; line-height:1.6;';
        statusText.innerHTML = this._recognitionSummaryHtml();
        statusRow.appendChild(statusText);
        content.appendChild(statusRow);

        // Раунд 201 (по запросу Mr.D: "придумать способы проверки
        // данных, на выявление помарок и подозрительных значений") -
        // полный список проблем текстом - тот же приём <details>, что
        // уже использует блок "Лицензии" в окне приветствия (Раунд
        // 179) - свёрнут по умолчанию, не занимает места, пока всё
        // хорошо/пользователю не интересно.
        const issuesRow = document.createElement('details');
        issuesRow.className = 'building-section-issues';
        issuesRow.style.cssText = 'padding-left:20px; font-size:10px;';
        const issuesSummary = document.createElement('summary');
        issuesSummary.className = 'building-section-issues-summary';
        issuesSummary.style.cssText = 'cursor:pointer; color:var(--md-text-secondary);';
        issuesRow.appendChild(issuesSummary);
        const issuesList = document.createElement('div');
        issuesList.className = 'building-section-issues-list';
        issuesList.style.cssText = 'padding:4px 0 0 12px; line-height:1.6;';
        issuesRow.appendChild(issuesList);
        content.appendChild(issuesRow);
        this._updateIssuesBlock(issuesRow, issuesSummary, issuesList);

        const outRow = document.createElement('div');
        outRow.style.cssText = `
            display: flex;
            align-items: center;
            gap: 8px;
            padding-top: 6px;
            margin-top: 4px;
            border-top: 1px solid var(--md-divider);
        `;
        const outLabel = document.createElement('label');
        outLabel.textContent = 'Блок-Секция (DATA):';
        outLabel.style.cssText = 'color:var(--md-text-secondary); font-size:11px; flex:1;';
        outRow.appendChild(outLabel);
        const outSocket = SocketFactory.createSocket({
            nodeId: this.id, socketType: 'output', index: 0, isData: true,
            title: 'Распознанная Блок-Секция - таблица по этажам, читается как обычная DATA-таблица дальше по графу'
        });
        outRow.appendChild(outSocket);
        content.appendChild(outRow);

        return content;
    }

    _floorsStatusText() {
        if (!this._sourceFloorsName) return 'не подключено';
        if (this.floors.length === 0) return `${this._sourceFloorsName} — не распознано`;
        return `${this._sourceFloorsName} — ${this.floors.length} эт.`;
    }
    _areaStatusText() {
        if (!this._sourceAreaName) return 'не подключено';
        if (this.areaAbove === null && this.areaBelow === null) return `${this._sourceAreaName} — не найдено для этой секции`;
        return `${this._sourceAreaName} — найдено`;
    }
    _volumeStatusText() {
        if (!this._sourceVolumeName) return 'не подключено';
        if (this.volumeAbove === null && this.volumeBelow === null) return `${this._sourceVolumeName} — не найдено для этой секции`;
        return `${this._sourceVolumeName} — найдено`;
    }
    _fmt(v) {
        return v === null || v === undefined ? '—' : Number(v).toLocaleString('ru-RU', { maximumFractionDigits: 2 });
    }
    _recognitionSummaryHtml() {
        if (!this.sectionCode) return 'Секция: <span style="color:var(--md-text-disabled)">не определена</span>';
        const unitsCount = this.floors.reduce((sum, f) => sum + f.units.length, 0);
        const lines = [
            `Секция: <b>${this.sectionCode}</b> · этажей: ${this.floors.length} · помещений: ${unitsCount}`,
            `Площадь выше/ниже 0.000: ${this._fmt(this.areaAbove)} / ${this._fmt(this.areaBelow)}`,
            `Объём выше/ниже 0.000: ${this._fmt(this.volumeAbove)} / ${this._fmt(this.volumeBelow)}`
        ];
        // Раунд 201 (по запросу Mr.D: "придумать способы проверки
        // данных, на выявление помарок и подозрительных значений") -
        // краткая сводка числа проблем по уровню серьёзности - полный
        // список текстом ниже, в отдельном разворачивающемся блоке
        // (см. createContent()/updateDisplay()), не загромождает
        // основной статус, когда всё в порядке.
        const errorCount = this.issues.filter(i => i.severity === 'error').length;
        const warnCount = this.issues.filter(i => i.severity === 'warning').length;
        if (errorCount > 0 || warnCount > 0) {
            const parts = [];
            if (errorCount > 0) parts.push(`<span style="color:var(--md-error)">⚠ ${errorCount} ошибок</span>`);
            if (warnCount > 0) parts.push(`<span style="color:var(--md-warning)">⚠ ${warnCount} предупреждений</span>`);
            lines.push(parts.join(' · '));
        } else if (this.sectionCode) {
            lines.push('<span style="color:var(--md-secondary)">✓ проверок не выявлено проблем</span>');
        }
        return lines.join('<br>');
    }

    updateDisplay(element) {
        const floorsLabel = element.querySelector('.building-section-floors-label');
        if (floorsLabel) floorsLabel.textContent = 'Этажи: ' + this._floorsStatusText();
        const areaLabel = element.querySelector('.building-section-area-label');
        if (areaLabel) areaLabel.textContent = 'Общая площадь: ' + this._areaStatusText();
        const volumeLabel = element.querySelector('.building-section-volume-label');
        if (volumeLabel) volumeLabel.textContent = 'Строительный объём: ' + this._volumeStatusText();
        const statusText = element.querySelector('.building-section-status');
        if (statusText) statusText.innerHTML = this._recognitionSummaryHtml();
        const issuesRow = element.querySelector('.building-section-issues');
        const issuesSummary = element.querySelector('.building-section-issues-summary');
        const issuesList = element.querySelector('.building-section-issues-list');
        if (issuesRow && issuesSummary && issuesList) this._updateIssuesBlock(issuesRow, issuesSummary, issuesList);
    }

    // Раунд 201 - наполняет разворачивающийся блок "Проверка данных" -
    // цвет по уровню серьёзности (error/warning/info), блок ПОЛНОСТЬЮ
    // скрывается, если проблем нет вообще (пустой список НЕ показываем
    // как "0 проблем" - просто убираем блок с глаз, меньше визуального
    // шума в обычном, "всё хорошо" случае).
    _updateIssuesBlock(issuesRow, issuesSummary, issuesList) {
        if (this.issues.length === 0) {
            issuesRow.style.display = 'none';
            return;
        }
        issuesRow.style.display = '';
        issuesSummary.textContent = `⚠ Проверка данных: ${this.issues.length} ${this.issues.length === 1 ? 'замечание' : 'замечаний'}`;
        issuesList.innerHTML = '';
        const colorFor = { error: 'var(--md-error)', warning: 'var(--md-warning)', info: 'var(--md-text-secondary)' };
        const iconFor = { error: '✕', warning: '⚠', info: 'ℹ' };
        this.issues.forEach(issue => {
            const line = document.createElement('div');
            line.style.cssText = `color:${colorFor[issue.severity] || 'var(--md-text)'};`;
            line.textContent = `${iconFor[issue.severity] || '·'} ${issue.message}`;
            issuesList.appendChild(line);
        });
    }

    _norm(v) {
        if (v === null || v === undefined) return null;
        if (typeof v === 'string' && v.trim() === '') return null;
        return v;
    }

    // Раунд 198 - разбор таблицы "Этажи" ПО ИМЕНАМ столбцов (эта таблица
    // ВСЕГДА содержит настоящую строку заголовков, в отличие от "Общей
    // площади" ниже) - устойчиво к перестановке столбцов местами.
    // Группировка: строка с ЗАПОЛНЕННЫМ "Номер Собственного Этажа" -
    // помещение НА этом этаже; строка с ПУСТЫМ номером - итог (либо по
    // текущему этажу, либо, если это ПОСЛЕДНЯЯ строка таблицы целиком -
    // итог по всей секции, "хвостовая" grand-total строка).
    _parseFloors(tableData) {
        if (!tableData || !tableData.columns || tableData.columns.length === 0) {
            return { sectionCode: null, floors: [], grandTotal: null };
        }
        const findCol = (name) => tableData.columns.find(c => (c.header || '').trim() === name);
        const colFloorNum = findCol('Номер Собственного Этажа');
        const colCode = findCol('Код квартиры или офиса');
        const colSubtype = findCol('LabPP: Подтип');
        const colFloorLabel = findCol('LabPP: Для этажа');
        const colRooms = findCol('Кол-во жилых комнат');
        const colLivingArea = findCol('Площадь жилая');
        const colAreaNoLoggia = findCol('Площадь без лоджий');
        const colAreaWithCoef = findCol('Площадь общая с учетом коэффициентов');
        const colTotalArea = findCol('Площадь общая');

        // Заголовки не совпали с ожидаемыми - не тот тип таблицы
        // (например, случайно подключили "Общую площадь" в этот вход) -
        // не бросаем исключение, просто ничего не распознаём.
        if (!colFloorNum || !colTotalArea) {
            return { sectionCode: null, floors: [], grandTotal: null };
        }

        const rowCount = tableData.rowCount;
        const floors = [];
        let currentFloor = null;
        let sectionCode = null;
        let grandTotal = null;

        for (let i = 0; i < rowCount; i++) {
            const floorNum = this._norm(colFloorNum.values[i]);
            const label = this._norm(colFloorLabel?.values[i]);
            if (label && !sectionCode) {
                sectionCode = String(label).split('-')[0].trim();
            }

            if (floorNum !== null) {
                const key = String(floorNum);
                if (!currentFloor || currentFloor.number !== key) {
                    currentFloor = { number: key, label: label || key, units: [], subtotal: null };
                    floors.push(currentFloor);
                }
                currentFloor.units.push({
                    code: this._norm(colCode?.values[i]),
                    subtype: this._norm(colSubtype?.values[i]),
                    rooms: colRooms?.values[i] ?? null,
                    livingArea: colLivingArea?.values[i] ?? null,
                    areaNoLoggia: colAreaNoLoggia?.values[i] ?? null,
                    areaWithCoef: colAreaWithCoef?.values[i] ?? null,
                    totalArea: colTotalArea?.values[i] ?? null
                });
            } else {
                const totals = {
                    livingArea: colLivingArea?.values[i] ?? null,
                    areaNoLoggia: colAreaNoLoggia?.values[i] ?? null,
                    areaWithCoef: colAreaWithCoef?.values[i] ?? null,
                    totalArea: colTotalArea?.values[i] ?? null
                };
                if (i === rowCount - 1) {
                    grandTotal = totals;
                } else if (currentFloor) {
                    currentFloor.subtotal = totals;
                }
            }
        }

        return { sectionCode, floors, grandTotal };
    }

    // Раунд 198 - разбор таблицы "Общая площадь"/"Строительный объём" -
    // ПОЗИЦИОННО (не по именам столбцов - эта таблица НЕ содержит
    // настоящей строки заголовков вовсе, только данные, проверено на
    // реальных файлах Mr.D). Столбец 0 - код секции ("БС1_"/"БС1" -
    // возможен хвостовой "_", нормализуется), последний ТЕКСТОВЫЙ
    // столбец - метка с ключевым словом "выше"/"ниже", последний
    // ЧИСЛОВОЙ столбец в строке - значение (у "Общей площади" это
    // столбец 2, у "Строительного объёма" - столбец 3, но искать
    // "последнее число в строке" устойчиво к ОБОИМ вариантам разом).
    _parseTotalArea(tableData, targetSectionCode) {
        if (!tableData || !tableData.columns || tableData.columns.length < 2 || !targetSectionCode) {
            return { above: null, below: null };
        }
        const normalizeSectionCode = (s) => {
            if (!s) return null;
            return String(s).trim().replace(/_+$/, '').toUpperCase();
        };
        const target = normalizeSectionCode(targetSectionCode);
        const rowCount = tableData.rowCount;
        const cols = tableData.columns;
        let above = null, below = null;

        for (let i = 0; i < rowCount; i++) {
            const secRaw = this._norm(cols[0]?.values[i]);
            if (normalizeSectionCode(secRaw) !== target) continue;
            const labelRaw = this._norm(cols[1]?.values[i]);
            const label = String(labelRaw || '').toLowerCase();
            let value = null;
            for (let ci = cols.length - 1; ci >= 0; ci--) {
                const v = cols[ci]?.values[i];
                if (typeof v === 'number') { value = v; break; }
            }
            if (label.includes('выше')) above = value;
            else if (label.includes('ниже')) below = value;
        }
        return { above, below };
    }

    // Раунд 201 (по запросу Mr.D: "придумать способы проверки данных,
    // на выявление помарок и подозрительных значений") - набор
    // независимых проверок распознанных данных, каждая возвращает
    // {severity: 'error'|'warning'|'info', message}. 'error' - точно
    // логическая ошибка данных (не бывает такого физически); 'warning' -
    // подозрительно, но МОЖЕТ быть легитимным (нужна проверка
    // человеком); 'info' - нейтральное наблюдение. НЕ бросает
    // исключений и не блокирует расчёт - только информирует, решение
    // за пользователем.
    _validateData(floors, grandTotal) {
        const issues = [];
        const allUnits = floors.flatMap(f => f.units.map(u => ({ ...u, floorNumber: f.number })));

        // 1. Секция не определена, хотя данные этажей подключены -
        // почти наверняка проблема с заголовками исходной таблицы
        // (не тот файл/формат).
        if (this._sourceFloorsName && floors.length === 0) {
            issues.push({ severity: 'error', message: 'Данные этажей подключены, но секция не распознана - проверьте, что это таблица "Маркер Секция. Все этажи" с ожидаемыми заголовками столбцов' });
        }

        // 2. Расхождение суммы подытогов по этажам с итоговой строкой
        // файла - САМАЯ надёжная проверка (у нас есть ОБА числа из
        // одного и того же файла-источника, они ДОЛЖНЫ совпадать
        // точно, с точностью до округления).
        if (grandTotal && floors.length > 0) {
            const sumTotalArea = floors.reduce((s, f) => s + (f.subtotal?.totalArea || 0), 0);
            const diff = Math.abs(sumTotalArea - (grandTotal.totalArea || 0));
            if (diff > 0.5) {
                issues.push({ severity: 'error', message: `Сумма площадей по этажам (${sumTotalArea.toFixed(2)}) не совпадает с итоговой строкой файла (${grandTotal.totalArea?.toFixed(2)}) - расхождение ${diff.toFixed(2)} кв.м, возможен пропуск/задвоение строки в исходной таблице` });
            }
        }

        // 3-6. Проверки по КАЖДОМУ отдельному помещению.
        allUnits.forEach(u => {
            const loc = `этаж ${u.floorNumber}${u.code ? `, ${u.code}` : ''}`;
            ['totalArea', 'livingArea', 'areaNoLoggia', 'areaWithCoef'].forEach(field => {
                if (typeof u[field] === 'number' && u[field] < 0) {
                    issues.push({ severity: 'error', message: `Отрицательная площадь (${field}=${u[field]}) - ${loc}` });
                }
            });
            // "С учётом ПОНИЖАЮЩЕГО коэффициента" - по определению
            // должна быть МЕНЬШЕ ИЛИ РАВНА полной площади, не больше.
            if (typeof u.areaWithCoef === 'number' && typeof u.totalArea === 'number' && u.areaWithCoef > u.totalArea + 0.01) {
                issues.push({ severity: 'error', message: `Площадь с понижающим коэффициентом (${u.areaWithCoef}) больше полной площади (${u.totalArea}) - ${loc}` });
            }
            // "Без лоджий" - площадь БЕЗ части помещений - не может
            // превышать площадь ВКЛЮЧАЯ их.
            if (typeof u.areaNoLoggia === 'number' && typeof u.totalArea === 'number' && u.areaNoLoggia > u.totalArea + 0.01) {
                issues.push({ severity: 'error', message: `Площадь без лоджий (${u.areaNoLoggia}) больше полной площади (${u.totalArea}) - ${loc}` });
            }
            // "Жилая" - только комнаты, без кухни/санузла/коридора -
            // не может превышать площадь помещения целиком.
            if (typeof u.livingArea === 'number' && typeof u.totalArea === 'number' && u.livingArea > u.totalArea + 0.01) {
                issues.push({ severity: 'error', message: `Жилая площадь (${u.livingArea}) больше полной площади (${u.totalArea}) - ${loc}` });
            }
            // Необычно крупное/мелкое ЖИЛОЕ помещение (не служебные
            // К/МОП/ТЕХ/КОМ - те легитимно бывают любого размера) -
            // МЯГКАЯ проверка (warning, не error) - реальные квартиры
            // такого размера редки, но не невозможны.
            const isService = ['К', 'МОП', 'ТЕХ', 'КОМ'].includes(u.code);
            if (!isService && typeof u.totalArea === 'number') {
                if (u.totalArea > 300) {
                    issues.push({ severity: 'warning', message: `Необычно большая площадь помещения (${u.totalArea} кв.м) - ${loc} - проверьте, не задвоена ли строка` });
                } else if (u.totalArea > 0 && u.totalArea < 3) {
                    issues.push({ severity: 'warning', message: `Необычно маленькая площадь помещения (${u.totalArea} кв.м) - ${loc} - проверьте единицы измерения` });
                }
            }
        });

        // 7. Разрыв в последовательности номеров этажей (например, 1,2,4 -
        // пропущен 3) - НЕ ошибка сама по себе (технический этаж мог
        // быть законно объединён/пропущен), но стоит обратить внимание.
        const numericFloors = floors
            .map(f => parseInt(f.number, 10))
            .filter(n => Number.isFinite(n) && n >= 1)
            .sort((a, b) => a - b);
        for (let i = 1; i < numericFloors.length; i++) {
            const gap = numericFloors[i] - numericFloors[i - 1];
            if (gap > 1) {
                issues.push({ severity: 'info', message: `Пропуск в нумерации этажей: между ${numericFloors[i - 1]} и ${numericFloors[i]}` });
            }
        }

        return issues;
    }

    calculate(nodeManager) {
        const connections = window.connectionManager?.getConnections() || [];
        const floorsConn = connections.find(c => c.targetNodeId === this.id && c.targetSocket === 0);
        const areaConn = connections.find(c => c.targetNodeId === this.id && c.targetSocket === 1);
        const volumeConn = connections.find(c => c.targetNodeId === this.id && c.targetSocket === 2);

        const floorsSrc = floorsConn ? nodeManager.getNode(floorsConn.sourceNodeId) : null;
        const areaSrc = areaConn ? nodeManager.getNode(areaConn.sourceNodeId) : null;
        const volumeSrc = volumeConn ? nodeManager.getNode(volumeConn.sourceNodeId) : null;
        this._sourceFloorsName = floorsSrc ? (floorsSrc.customName || floorsSrc.getDisplayName?.() || 'источник') : null;
        this._sourceAreaName = areaSrc ? (areaSrc.customName || areaSrc.getDisplayName?.() || 'источник') : null;
        this._sourceVolumeName = volumeSrc ? (volumeSrc.customName || volumeSrc.getDisplayName?.() || 'источник') : null;

        const floorsOutput = floorsConn ? nodeManager.getSourceOutput(floorsConn) : null;
        const areaOutput = areaConn ? nodeManager.getSourceOutput(areaConn) : null;
        const volumeOutput = volumeConn ? nodeManager.getSourceOutput(volumeConn) : null;

        const { sectionCode, floors, grandTotal } = this._parseFloors(floorsOutput?.tableData);
        this.sectionCode = sectionCode;
        this.floors = floors;
        this.grandTotal = grandTotal;

        const { above, below } = this._parseTotalArea(areaOutput?.tableData, sectionCode);
        // Раунд 200 (по запросу Mr.D: "если нет данных для общей
        // площади и объёма, то их можно задать вручную") - ручное
        // значение - ТОЛЬКО запасной вариант, автоматически
        // распознанное (когда оно есть) всегда в приоритете - иначе
        // подключение реального источника молча игнорировалось бы,
        // пока в поле ручного ввода что-то когда-то было введено.
        this.areaAbove = above !== null ? above : this.manualAreaAbove;
        this.areaBelow = below !== null ? below : this.manualAreaBelow;

        // Раунд 199 (по запросу Mr.D: "нужен ещё слот для таблицы со
        // строительным объёмом") - та же _parseTotalArea(), что и у
        // "Общей площади" - таблица объёма устроена ИДЕНТИЧНО по форме
        // (код секции/метка "выше-ниже"/значение), просто с другим
        // числом столбцов - функция уже это учитывает (ищет ПОСЛЕДНЕЕ
        // число в строке, а не конкретный индекс столбца).
        const { above: volAbove, below: volBelow } = this._parseTotalArea(volumeOutput?.tableData, sectionCode);
        this.volumeAbove = volAbove !== null ? volAbove : this.manualVolumeAbove;
        this.volumeBelow = volBelow !== null ? volBelow : this.manualVolumeBelow;

        // Раунд 199 (задел под агрегатор "Кварталы") - плоский список
        // ВСЕХ помещений секции, с привязкой к этажу - агрегатор сам
        // считает разбивку по коду/числу комнат, эта нода только
        // отдаёт сырьё.
        this.units = floors.flatMap(f => f.units.map(u => ({ ...u, floorNumber: f.number, floorLabel: f.label })));

        // Раунд 201 (по запросу Mr.D: "придумать способы проверки
        // данных, на выявление помарок и подозрительных значений") -
        // результат проверок - в поле экземпляра (не сериализуется -
        // производное состояние, как и все остальные результаты
        // распознавания) - используется и в теле ноды (см.
        // _recognitionSummaryHtml()), и доступно downstream через
        // getOutputBySocket() при необходимости.
        this.issues = this._validateData(floors, grandTotal);

        if (floors.length > 0) {
            this.tableData = new TableData([
                { header: 'Этаж', values: floors.map(f => f.number), format: 'text' },
                { header: 'Название', values: floors.map(f => f.label), format: 'text' },
                { header: 'Помещений', values: floors.map(f => f.units.length), format: 'number' },
                { header: 'Площадь жилая', values: floors.map(f => f.subtotal?.livingArea ?? null), format: 'number' },
                { header: 'Площадь без лоджий', values: floors.map(f => f.subtotal?.areaNoLoggia ?? null), format: 'number' },
                { header: 'Площадь с коэфф.', values: floors.map(f => f.subtotal?.areaWithCoef ?? null), format: 'number' },
                { header: 'Площадь общая', values: floors.map(f => f.subtotal?.totalArea ?? null), format: 'number' }
            ], { title: this.sectionCode || 'Блок-Секция' });
        } else {
            this.tableData = new TableData();
        }

        const items = [];
        if (this.areaAbove !== null) items.push({ name: 'Площадь выше 0.000', value: this.areaAbove });
        if (this.areaBelow !== null) items.push({ name: 'Площадь ниже 0.000', value: this.areaBelow });
        if (this.volumeAbove !== null) items.push({ name: 'Объём выше 0.000', value: this.volumeAbove });
        if (this.volumeBelow !== null) items.push({ name: 'Объём ниже 0.000', value: this.volumeBelow });
        if (this.grandTotal) items.push({ name: 'Площадь по этажам (итого)', value: this.grandTotal.totalArea });
        this.resultListData = new ListData(items, { title: this.sectionCode || 'Блок-Секция' });

        this.value = (this.areaAbove || 0) + (this.areaBelow || 0);
        return this.value;
    }

    // Раунд 200 (по запросу Mr.D: "оформление. ручной ввод данных.
    // если нет данных для общей площади и объёма, то их можно задать
    // вручную") - число (не текст) - пустая строка в поле трактуется
    // как "сбросить" (обратно в null, не в 0 - см. докстринг
    // конструктора про то, почему 0 и "не задано" - РАЗНЫЕ вещи).
    getInspectorSchema() {
        const fields = super.getInspectorSchema();
        fields.push({ type: 'section', label: '✋ Ручной ввод (запасные значения)', collapsible: true });
        const numField = (key, label) => ({
            key, label, type: 'number', step: 0.01,
            get: () => this[key],
            set: (v) => {
                const n = v === '' || v === null || v === undefined ? null : parseFloat(v);
                this[key] = Number.isFinite(n) ? n : null;
                if (window.nodeManager) window.nodeManager.calculateAll();
            }
        });
        fields.push(numField('manualAreaAbove', 'Площадь выше 0.000 (если нет данных)'));
        fields.push(numField('manualAreaBelow', 'Площадь ниже 0.000 (если нет данных)'));
        fields.push(numField('manualVolumeAbove', 'Объём выше 0.000 (если нет данных)'));
        fields.push(numField('manualVolumeBelow', 'Объём ниже 0.000 (если нет данных)'));
        return fields;
    }
}
