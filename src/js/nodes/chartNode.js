/**
 * SPDX-License-Identifier: MIT
 * SPDX-FileCopyrightText: 2024 NodeCalculate Team
 * SPDX-FileCopyrightText: 2024 Pavel Fomin
 *
 * @file    chartNode.js
 * @brief   Обработчик: строит диаграмму - на выходе DATA (Категория/Значение) с метаданными отрисовки
 * @author  Pavel Fomin
 * @version 1.8.4
 * @see     https://github.com/GhostPWLk1n/NodeCalculator.git
 */

import { BaseNode } from './baseNode.js';
import { TableData } from '../utils/dataTypes.js';
import { SocketFactory } from '../utils/socketFactory.js';
import { ChartRenderer } from '../utils/chartRenderer.js';

/**
 * ChartNode - обработчик (не viewer): вход - список ИЛИ таблица (any),
 * выход - Data (ромб, оранжевый), та же "порода" сокета, что у
 * TableNode. Разграничение функционала (Раунд 33):
 *
 *   - ChartNode (эта нода) - инструменты ПОСТРОЕНИЯ: выбор типа
 *     диаграммы. Вид ноды НАМЕРЕННО минимальный (см. tableNode.js,
 *     тот же принцип) - сама диаграмма тут не рисуется, только
 *     настраивается.
 *   - PercentageNode (percentageNode.js, "Просмотр диаграммы") - ЧИСТЫЙ
 *     viewer: рисует то, что получил на вход, без выбора типа - тип
 *     теперь читается из metadata.chartType подключённого источника.
 *
 * Выходная TableData - "Категория" (text) + ПО СТОЛБЦУ на каждую серию
 * источника (Раунд 42): при ровно одном столбце данных внешне неотличимо
 * от старого поведения ("Категория"+"Значение"), при нескольких - каждый
 * столбец источника становится отдельной серией (см.
 * TableData.toSeriesData() в dataTypes.js). Это тот же принцип "таблица
 * с данными + метаданные для отрисовки", что и у TableNode - поэтому
 * результат подключается куда угодно, что понимает Data: PercentageNode,
 * TableViewerNode (сырые числа), DashboardNode (виджет Доски, см.
 * getDashboardWidget() ниже).
 *
 * МУЛЬТИСЕРИЙНОСТЬ (Раунд 42) - если у подключённого источника несколько
 * столбцов с данными (например, TableNode с колонками "Q1"/"Q2"/"Q3"),
 * диаграмма показывает ВСЕ сразу, а не схлопывает их в одно число:
 *   - круговая - концентрические кольца, одно кольцо на серию (крайнее
 *     снаружи - первая серия), цвет кольца - по КАТЕГОРИИ и одинаковый на
 *     всех кольцах, чтобы был виден "путь" одной категории между сериями;
 *   - линейчатая - группы столбиков, одна группа на категорию, внутри -
 *     по столбику на серию, цвет - по СЕРИИ (внутри группы категория и
 *     так очевидна по подписи, а вот принадлежность столбика серии - нет).
 * См. ChartRenderer.buildMultiDonutChart()/buildMultiBarChart() в
 * utils/chartRenderer.js - та же логика используется и в PercentageNode
 * (просмотр на Листе), и здесь (виджет Доски).
 *
 * Разбор входа (LIST или Data) использует тот же приоритет, что раньше
 * жил в PercentageNode.calculate(): если у источника есть готовая
 * таблица (Data) - она "богаче" (явные заголовки колонок), поэтому
 * побеждает LIST.
 */
export class ChartNode extends BaseNode {
    constructor(id, type, x, y, config = {}) {
        super(id, type, x, y, config);
        this.outputs = 1;
        this.inputs = 1;
        this.inputSockets = [0];
        this.width = config.width || 220;

        this.customTitle = config.customTitle || 'Диаграмма';
        this.chartType = config.chartType || 'donut';
        this.chartTypes = [
            { value: 'donut', label: '🍩 Круговая' },
            { value: 'bar', label: '📊 Линейчатая' }
        ];

        this._sourceName = null;
        this._itemCount = 0;
        this._seriesCount = 0;
        this.tableData = new TableData();
    }

    createContent() {
        const content = document.createElement('div');
        content.className = 'node-content';
        content.style.cssText = 'width: 100%; min-width: 150px;';

        // --- строка 1: вход (any) + выбор типа + счётчик ---
        const topRow = document.createElement('div');
        topRow.style.cssText = 'display:flex; align-items:center; gap:6px;';

        const inSocket = SocketFactory.createSocket({
            nodeId: this.id, socketType: 'input', index: 0, isAny: true,
            title: 'Источник данных: список (LIST) или таблица (DATA)'
        });
        topRow.appendChild(inSocket);

        const select = document.createElement('select');
        select.className = 'chart-type-select';
        select.style.cssText = `
            background: rgba(0, 0, 0, 0.3);
            border: 1px solid var(--md-divider);
            border-radius: 4px;
            color: var(--md-text);
            font-size: 11px;
            padding: 2px 6px;
            font-family: inherit;
            cursor: pointer;
            outline: none;
            flex: 1;
            min-width: 60px;
        `;
        this.chartTypes.forEach(t => {
            const option = document.createElement('option');
            option.value = t.value;
            option.textContent = t.label;
            if (t.value === this.chartType) option.selected = true;
            select.appendChild(option);
        });
        select.addEventListener('change', (e) => {
            this.chartType = e.target.value;
            if (window.nodeManager) window.nodeManager.calculateAll();
            if (window.renderer) window.renderer.updateAllDisplays();
        });
        topRow.appendChild(select);

        const countLabel = document.createElement('span');
        countLabel.className = 'chart-item-count';
        countLabel.style.cssText = `
            color: var(--md-text-secondary);
            font-size: 11px;
            white-space: nowrap;
        `;
        countLabel.textContent = this._countLabelText();
        topRow.appendChild(countLabel);

        content.appendChild(topRow);

        // --- строка 2: имя источника (только для чтения) ---
        const sourceRow = document.createElement('div');
        sourceRow.style.cssText = 'display:flex; align-items:center; gap:6px; padding-left:20px;';
        const sourceLabel = document.createElement('span');
        sourceLabel.className = 'chart-source-label';
        sourceLabel.style.cssText = `
            color: var(--md-text-disabled);
            font-size: 10px;
            flex: 1;
            min-width: 0;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        `;
        sourceLabel.textContent = this._sourceName || 'не подключено';
        sourceRow.appendChild(sourceLabel);
        content.appendChild(sourceRow);

        // --- строка 3: выход (Data) ---
        const outRow = document.createElement('div');
        outRow.style.cssText = `
            display: flex;
            align-items: center;
            gap: 8px;
            padding-top: 6px;
            margin-top: 2px;
            border-top: 1px solid var(--md-divider);
        `;
        const outLabel = document.createElement('label');
        outLabel.textContent = 'Данные (DATA):';
        outLabel.style.cssText = 'color:var(--md-text-secondary); font-size:11px; flex:1;';
        outRow.appendChild(outLabel);
        const outSocket = SocketFactory.createSocket({
            nodeId: this.id, socketType: 'output', index: 0, isData: true,
            title: 'Категория/Значение + метаданные отрисовки (chartType)'
        });
        outRow.appendChild(outSocket);
        content.appendChild(outRow);

        return content;
    }

    calculate(nodeManager) {
        const connections = window.connectionManager?.getConnections() || [];
        const conn = connections.find(c => c.targetNodeId === this.id && c.targetSocket === 0);
        const srcNode = conn ? nodeManager.getNode(conn.sourceNodeId) : null;

        // seriesData = { categories: [...], series: [{name, format, values}] } -
        // единый формат независимо от источника (см. TableData.toSeriesData()
        // в dataTypes.js, Раунд 42). При РОВНО одной серии ведёт себя как
        // раньше (один слайс на строку); при нескольких столбцах данных у
        // источника - каждый становится отдельной серией (несколько колец
        // у круговой, несколько столбиков на категорию у линейчатой - см.
        // getDashboardWidget() и аналогичную логику в percentageNode.js).
        let seriesData = null;
        let inputName = this.customTitle || 'Диаграмма';

        // Приоритет 1: у источника есть готовая таблица (Data) - "богаче"
        // по семантике (явные заголовки колонок), чем безымянный список
        if (srcNode && srcNode.tableData && srcNode.tableData.columns.length > 0) {
            seriesData = srcNode.tableData.toSeriesData();
            inputName = srcNode.tableData.metadata?.title || srcNode.customName || srcNode.getDisplayName?.() || 'Таблица';
        }

        // Приоритет 2: у источника есть список (LIST) - оборачиваем в ОДНУ
        // серию (список сам по себе не хранит понятие "несколько столбцов")
        if ((!seriesData || seriesData.series.length === 0) && srcNode) {
            let list = null;
            if (srcNode.listData?.items?.length > 0) {
                list = srcNode.listData;
                inputName = srcNode.listData.metadata?.title || srcNode.customName || srcNode.type || 'Данные';
            } else if (srcNode.resultListData?.items?.length > 0) {
                list = srcNode.resultListData;
                inputName = srcNode.resultListData.metadata?.title || srcNode.customName || srcNode.type || 'Данные';
            }
            if (list) {
                seriesData = {
                    categories: list.items.map(i => i.name || ''),
                    series: [{
                        name: inputName,
                        format: list.items[0]?.format || 'number',
                        values: list.items.map(i => (typeof i.value === 'number' ? i.value : 0))
                    }]
                };
            }
        }

        if (!seriesData) seriesData = { categories: [], series: [] };

        this._sourceName = srcNode ? (srcNode.customName || srcNode.getDisplayName?.() || 'источник') : null;
        this._itemCount = seriesData.categories.length;
        this._seriesCount = seriesData.series.length;

        // Выход - "Категория" + ПО СТОЛБЦУ на каждую серию источника
        // (раньше было ровно 2 колонки всегда - при одной серии внешне
        // неотличимо от прежнего поведения для потребителей, которые ждут
        // "Категория/Значение")
        const columns = [{ header: 'Категория', values: seriesData.categories, format: 'text' }];
        seriesData.series.forEach(s => {
            columns.push({ header: s.name || 'Значение', values: s.values, format: s.format || 'number' });
        });

        this.tableData = new TableData(columns, {
            title: this.customTitle || this.getDisplayName(),
            chartType: this.chartType,
            sourceName: inputName
        });

        this.value = seriesData.series[0]
            ? seriesData.series[0].values.reduce((a, b) => a + (typeof b === 'number' ? b : 0), 0)
            : 0;

        return this.value;
    }

    updateDisplay(element) {
        const countLabel = element.querySelector('.chart-item-count');
        if (countLabel) countLabel.textContent = this._countLabelText();

        const sourceLabel = element.querySelector('.chart-source-label');
        if (sourceLabel) sourceLabel.textContent = this._sourceName || 'не подключено';
    }

    // "12 эл." для одной серии, "12 эл. · 3 сер." при нескольких (Раунд 42) -
    // подсказка прямо в теле ноды, что источник многоколоночный и
    // диаграмма будет мультисерийной (кольца/группы столбиков)
    _countLabelText() {
        return this._seriesCount > 1
            ? `${this._itemCount} эл. · ${this._seriesCount} сер.`
            : `${this._itemCount} эл.`;
    }

    // Виджет Доски (см. dashboardNode.js/boardManager.js) - рисует ту же
    // диаграмму, что и PercentageNode на Листе, общим кодом ChartRenderer
    // (см. utils/chartRenderer.js). rotateLabels:false - на печатной
    // странице Доски текст должен читаться прямо, а не под углом.
    // При нескольких сериях (Раунд 42, toSeriesData().series.length > 1) -
    // концентрические кольца/группы столбиков вместо одиночной диаграммы,
    // легенда тоже другая (категорий или серий - см. ChartRenderer).
    getDashboardWidget() {
        const seriesData = this.tableData.toSeriesData();
        const isMultiSeries = seriesData.series.length > 1;
        const listData = this.tableData.toRowListData();
        const chartType = this.chartType;
        return {
            type: 'chart',
            title: this.customName || this.customTitle || null,
            render: (container) => {
                const wrap = document.createElement('div');
                wrap.style.cssText = 'display:flex; flex-direction:column; align-items:center; gap:8px;';

                const display = document.createElement('div');
                display.style.cssText = 'display:flex; justify-content:center; width:100%;';
                if (chartType === 'bar') {
                    display.appendChild(isMultiSeries
                        ? ChartRenderer.buildMultiBarChart(seriesData, { maxWidth: 320 })
                        : ChartRenderer.buildBarChart(listData, { maxWidth: 320 }));
                } else {
                    display.appendChild(isMultiSeries
                        ? ChartRenderer.buildMultiDonutChart(seriesData, { size: 180, radius: 64, rotateLabels: false })
                        : ChartRenderer.buildDonutChart(listData, { size: 180, radius: 64, strokeWidth: 26, rotateLabels: false }));
                }
                wrap.appendChild(display);

                const legend = document.createElement('div');
                legend.style.cssText = 'display:flex; flex-wrap:wrap; gap:4px 6px; justify-content:center; width:100%;';
                if (isMultiSeries) {
                    // Круговая - легенда категорий (цвет = категория),
                    // линейчатая - легенда серий (цвет = серия), см.
                    // докстринги buildMultiDonutChart/buildMultiBarChart
                    if (chartType === 'bar') {
                        ChartRenderer.buildSeriesLegend(seriesData.series, legend);
                    } else {
                        ChartRenderer.buildCategoryLegend(seriesData.categories, legend);
                    }
                    wrap.appendChild(legend);
                } else if (chartType === 'donut') {
                    ChartRenderer.buildLegend(listData, legend);
                    wrap.appendChild(legend);
                }

                container.appendChild(wrap);
            }
        };
    }

    getInspectorSchema() {
        const fields = super.getInspectorSchema();
        fields.push({
            key: 'customTitle',
            label: 'Заголовок данных',
            type: 'text',
            get: () => this.customTitle || '',
            set: (v) => { this.customTitle = (v && v.trim()) ? v.trim() : 'Диаграмма'; }
        });
        return fields;
    }
}
