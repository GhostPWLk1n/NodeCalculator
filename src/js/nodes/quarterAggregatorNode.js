/**
 * SPDX-License-Identifier: MIT
 * SPDX-FileCopyrightText: 2024 NodeCalculate Team
 * SPDX-FileCopyrightText: 2024 Pavel Fomin
 *
 * @file    quarterAggregatorNode.js
 * @brief   Собирает несколько Блок-Секций (buildingSectionNode) в сводный ТЭП по зданию/кварталу
 * @author  Pavel Fomin
 * @version 1.8.94
 * @see     https://github.com/GhostPWLk1n/NodeCalculator.git
 */

import { BaseNode } from './baseNode.js';
import { TableData } from '../utils/dataTypes.js';
import { SocketFactory } from '../utils/socketFactory.js';

/**
 * QuarterAggregatorNode ("Квартал. Сводный ТЭП") - Раунд 199, по
 * запросу Mr.D: "узел, который все эти секции сможет собрать в
 * кварталы. И отдать нам результат в виде итоговой таблицы. Я скинул
 * пример итоговой" (прислан файл "Книга1.xlsx" - реальный отчёт ТЭП по
 * жилому дому 5.1).
 *
 * ДИНАМИЧЕСКОЕ число входов (та же схема, что у OperationNode - см.
 * раздел 9 NODE_API.md) - каждый вход ожидает выход
 * `buildingSectionNode.js` (ОДНА Блок-Секция) - подключаем СТОЛЬКО
 * секций, сколько входит в квартал/здание, свободный слот добавляется
 * автоматически.
 *
 * ЧТО СЧИТАЕТСЯ НАДЁЖНО (из плоского списка `units`, который каждая
 * Блок-Секция уже экспортирует - см. buildingSectionNode.js):
 *   - Общая площадь помещений здания - сумма totalArea ВСЕХ помещений.
 *   - Кладовые/Технические/МОП/Коммерция - сумма totalArea по коду
 *     помещения (К/ТЕХ/МОП/КОМ).
 *   - Жилые помещения (4 варианта площади) - сумма по ОСТАЛЬНЫМ кодам
 *     (не входящим в служебный список выше) - трактуются как квартиры.
 *   - Количество квартир по типам (студии/1-к/2-к/3-к) - группировка
 *     жилых помещений по числу комнат.
 *   - Строительный объём (выше/ниже 0.000) - сумма по секциям.
 *
 * ЧТО НЕ ЗАПОЛНЯЕТСЯ АВТОМАТИЧЕСКИ (честно оставлено пустым, а не
 * угадано): площадь застройки (это разрез генплана, не выводится из
 * площадей помещений), количество кладовых ШТУКАМИ (в исходных
 * таблицах кладовая - ОДНА агрегированная строка на этаж, не поштучно),
 * пожарно-техническая и архитектурная высота (внешние проектные
 * параметры, не связаны с табличными данными вообще). Пользователь
 * заполняет эти строки вручную после экспорта - таблица создаётся
 * специально с ТЕМИ ЖЕ строками-названиями, что в присланном образце,
 * чтобы было видно, чего не хватает.
 */
export class QuarterAggregatorNode extends BaseNode {
    // Коды помещений, которые НЕ считаются квартирами - используются и
    // при подсчёте площадей по категориям, и при отделении "жилых"
    // помещений от остальных для подсчёта комнатности.
    static NON_RESIDENTIAL_CODES = new Set(['К', 'МОП', 'ТЕХ', 'КОМ']);

    constructor(id, type, x, y, config = {}) {
        super(id, type, x, y, config);
        this.inputs = 1;
        this.inputSockets = [0];
        this.maxInputs = 12;
        this.outputs = 1;
        this.width = config.width || 260;

        this._isRerendering = false;
        this._sectionNames = []; // для статуса в теле ноды

        this.tableData = new TableData();
        this.value = 0;
    }

    createContent() {
        const content = document.createElement('div');
        content.className = 'node-content';
        content.style.cssText = 'width: 100%; min-width: 220px;';

        const socketsWrap = document.createElement('div');
        socketsWrap.className = 'quarter-agg-sockets';
        this.inputSockets.forEach((socketIndex, i) => {
            const row = document.createElement('div');
            row.style.cssText = 'display:flex; align-items:center; gap:6px; margin-top:2px;';
            const socket = SocketFactory.createSocket({
                nodeId: this.id, socketType: 'input', index: socketIndex, isData: true,
                title: `Блок-Секция ${i + 1} (выход ноды "Блок-Секция (ТЭП)")`
            });
            row.appendChild(socket);
            const label = document.createElement('span');
            label.style.cssText = 'color:var(--md-text-secondary); font-size:11px; flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;';
            label.textContent = this._sectionNames[i] || `Секция ${i + 1}: не подключено`;
            row.appendChild(label);
            socketsWrap.appendChild(row);
        });
        content.appendChild(socketsWrap);

        const statusRow = document.createElement('div');
        statusRow.style.cssText = 'padding-top:4px; padding-left:20px;';
        const statusText = document.createElement('div');
        statusText.className = 'quarter-agg-status';
        statusText.style.cssText = 'color:var(--md-text); font-size:10px; line-height:1.5;';
        statusText.textContent = this._statusText();
        statusRow.appendChild(statusText);
        content.appendChild(statusRow);

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
        outLabel.textContent = 'Сводный ТЭП (DATA):';
        outLabel.style.cssText = 'color:var(--md-text-secondary); font-size:11px; flex:1;';
        outRow.appendChild(outLabel);
        const outSocket = SocketFactory.createSocket({
            nodeId: this.id, socketType: 'output', index: 0, isData: true,
            title: 'Итоговая таблица ТЭП по всем подключённым секциям вместе'
        });
        outRow.appendChild(outSocket);
        content.appendChild(outRow);

        return content;
    }

    _statusText() {
        const connected = this._sectionNames.filter(Boolean).length;
        if (connected === 0) return 'Секции не подключены';
        return `Подключено секций: ${connected}, строк в отчёте: ${this.tableData.rowCount}`;
    }

    updateDisplay(element) {
        const labels = element.querySelectorAll?.('.quarter-agg-sockets > div > span') || [];
        // querySelectorAll может быть недоступен в некоторых тестовых
        // окружениях - страховка, реальный DOM это поддерживает всегда.
        if (labels.length) {
            this.inputSockets.forEach((_, i) => {
                if (labels[i]) labels[i].textContent = this._sectionNames[i] || `Секция ${i + 1}: не подключено`;
            });
        }
        const statusText = element.querySelector?.('.quarter-agg-status');
        if (statusText) statusText.textContent = this._statusText();
    }

    // Раунд 199 - та же логика, что у OperationNode.checkAndAddEmptySlot()
    // (см. её докстринг в operationNode.js/NODE_API.md раздел 9) -
    // добавляет свободный слот, когда ВСЕ текущие заняты.
    checkAndAddEmptySlot() {
        if (this.collapsed) return;
        if (this.inputSockets.length >= this.maxInputs) return;
        const connections = window.connectionManager?.getConnections() || [];
        const usedSockets = connections.filter(c => c.targetNodeId === this.id).map(c => c.targetSocket);
        const freeSockets = this.inputSockets.filter(idx => !usedSockets.includes(idx));
        if (freeSockets.length === 0) {
            const newIndex = this.inputSockets.length;
            this.inputSockets.push(newIndex);
            this.inputs = this.inputSockets.length;
            setTimeout(() => {
                if (!this._isRerendering && !this.collapsed) this.rerender();
            }, 50);
        }
    }

    rerender() {
        if (this._isRerendering) return;
        this._isRerendering = true;
        const el = document.querySelector(`[data-node-id="${this.id}"]`);
        if (el) {
            el.remove();
            if (window.nodeManager) {
                window.nodeManager.renderNode(this);
                if (window.renderer) window.renderer.drawAllConnections(window.connectionManager?.getConnections() || []);
            }
        }
        setTimeout(() => { this._isRerendering = false; }, 100);
    }

    _isResidential(unit) {
        return !!unit.code && !QuarterAggregatorNode.NON_RESIDENTIAL_CODES.has(unit.code);
    }

    _sumBy(units, field) {
        return units.reduce((s, u) => s + (typeof u[field] === 'number' ? u[field] : 0), 0);
    }

    // Раунд 199 - строит итоговую таблицу по образцу присланного
    // "Книга1.xlsx" - строки с реальными вычисленными значениями там,
    // где источники это позволяют, и ЧЕСТНО пустые строки там, где
    // данных для вычисления попросту нет (не угадываем) - см. докстринг
    // класса про полный список того, что не заполняется.
    _buildReport(allUnits, totals) {
        const residential = allUnits.filter(u => this._isResidential(u));
        const byCode = (code) => allUnits.filter(u => u.code === code);

        const roomCounts = { 0: 0, 1: 0, 2: 0, 3: 0, other: 0 };
        residential.forEach(u => {
            const r = typeof u.rooms === 'number' ? u.rooms : 0;
            if (r in roomCounts) roomCounts[r]++;
            else roomCounts.other++;
        });

        const floorNumbers = totals.floorNumbers.filter(n => Number.isFinite(n) && n >= 1);
        const floorsRange = floorNumbers.length
            ? `${Math.min(...floorNumbers)}-${Math.max(...floorNumbers)}`
            : '';

        const rows = [
            ['Этажность', floorsRange, floorsRange ? 'этажей' : ''],
            ['Количество этажей', totals.floorNumbers.length ? String(new Set(totals.floorNumbers).size) : '', totals.floorNumbers.length ? 'этажей' : ''],
            ['Площадь застройки жилого здания', '', 'кв.м'],
            ['Площадь здания (по внутреннему контуру наружных стен, включая лоджии, балконы, террасы, эксплуатируемые кровли)', this._fmtNum(this._sumBy(allUnits, 'areaNoLoggia')), 'кв.м'],
            ['Общая площадь помещений здания', this._fmtNum(this._sumBy(allUnits, 'totalArea')), 'кв.м'],
            ['В том числе:', '', ''],
            ['Площадь кладовых, ПХВС', this._fmtNum(this._sumBy(byCode('К'), 'totalArea')), 'кв.м'],
            ['Площадь технических помещений', this._fmtNum(this._sumBy(byCode('ТЕХ'), 'totalArea')), 'кв.м'],
            ['Места общего пользования (МОП)', this._fmtNum(this._sumBy(byCode('МОП'), 'totalArea')), 'кв.м'],
            ['Площадь нежилых помещений (коммерция)', this._fmtNum(this._sumBy(byCode('КОМ'), 'totalArea')), 'кв.м'],
            ['Общая площадь жилых помещений (с учетом балконов, лоджий, веранд и террас)', this._fmtNum(this._sumBy(residential, 'totalArea')), 'кв.м'],
            ['Общая площадь жилых помещений (с учетом балконов, лоджий, веранд и террас с понижающим коэффициентом)', this._fmtNum(this._sumBy(residential, 'areaWithCoef')), 'кв.м'],
            ['Общая площадь жилых помещений (за исключением балконов, лоджий, веранд и террас)', this._fmtNum(this._sumBy(residential, 'areaNoLoggia')), 'кв.м'],
            ['Жилая площадь квартир', this._fmtNum(this._sumBy(residential, 'livingArea')), 'кв.м'],
            ['Строительный объем здания', this._fmtNum(totals.volumeAbove + totals.volumeBelow), 'куб.м'],
            ['В том числе:', '', ''],
            ['ниже 0,000', this._fmtNum(totals.volumeBelow), 'куб.м'],
            ['выше 0,000', this._fmtNum(totals.volumeAbove), 'куб.м'],
            ['Количество квартир (всего)', String(residential.length), 'кв.'],
            ['В том числе:', '', ''],
            ['студии', String(roomCounts[0]), 'кв.'],
            ['однокомнатные', String(roomCounts[1]), 'кв.'],
            ['двухкомнатные', String(roomCounts[2]), 'кв.'],
            ['трехкомнатные', String(roomCounts[3]), 'кв.'],
            ['Количество кладовых', '', 'шт.'],
            ['Пожарно-техническая высота (от уровня пожарного проезда до низа открывающегося проема верхнего этажа) максимальная', '', 'м'],
            ['Архитектурная высота (от отмостки в каждой точке до самого высоко расположенного конструктивного элемента за исключением ограждений инженерного оборудования)', '', 'м']
        ];
        // Раунд 199 - строка "4 и более комнат" добавляется, ТОЛЬКО
        // если такие помещения реально встретились - образец не
        // предусматривает эту строку вовсе, не засоряем отчёт лишней
        // строкой, когда она не нужна.
        if (roomCounts.other > 0) {
            rows.push(['четырёхкомнатные и более', String(roomCounts.other), 'кв.']);
        }
        return rows;
    }

    _fmtNum(v) {
        if (!Number.isFinite(v) || v === 0) return '';
        return Math.round(v * 100) / 100;
    }

    calculate(nodeManager) {
        const connections = window.connectionManager?.getConnections() || [];
        this._sectionNames = [];

        const allUnits = [];
        const totals = { volumeAbove: 0, volumeBelow: 0, floorNumbers: [] };

        this.inputSockets.forEach((socketIndex, i) => {
            const conn = connections.find(c => c.targetNodeId === this.id && c.targetSocket === socketIndex);
            const src = conn ? nodeManager.getNode(conn.sourceNodeId) : null;
            if (!src) { this._sectionNames[i] = null; return; }

            const output = nodeManager.getSourceOutput(conn);
            const label = src.customName || src.getDisplayName?.() || 'источник';
            const code = output?.sectionCode;
            this._sectionNames[i] = `Секция ${i + 1}: ${label}${code ? ` (${code})` : ''}`;

            if (Array.isArray(output?.units)) allUnits.push(...output.units);
            if (typeof output?.volumeAbove === 'number') totals.volumeAbove += output.volumeAbove;
            if (typeof output?.volumeBelow === 'number') totals.volumeBelow += output.volumeBelow;
            (output?.floors || []).forEach(f => {
                const n = parseInt(f.number, 10);
                if (Number.isFinite(n)) totals.floorNumbers.push(n);
            });
        });

        const rows = this._buildReport(allUnits, totals);
        this.tableData = new TableData([
            { header: 'Наименование расчетного показателя', values: rows.map(r => r[0]), format: 'text' },
            { header: 'Кол-во', values: rows.map(r => r[1]), format: 'auto' },
            { header: 'Ед. изм.', values: rows.map(r => r[2]), format: 'text' }
        ], { title: 'Сводный ТЭП' });

        this.value = allUnits.length;
        return this.value;
    }
}
