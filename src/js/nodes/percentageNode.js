/**
 * SPDX-License-Identifier: MIT
 * SPDX-FileCopyrightText: 2024 NodeCalculate Team
 * SPDX-FileCopyrightText: 2024 Pavel Fomin
 *
 * @file    percentageNode.js
 * @brief   Просмотр диаграммы (Viewer) - без выбора типа, тип берётся из источника
 * @author  Pavel Fomin
 * @version 1.8.20
 * @see     https://github.com/GhostPWLk1n/NodeCalculator.git
 */

import { BaseNode } from './baseNode.js';
import { ListData } from '../utils/dataTypes.js';
import { SocketFactory } from '../utils/socketFactory.js';
import { ChartRenderer } from '../utils/chartRenderer.js';

/**
 * PercentageNode ("Просмотр диаграммы") - ЧИСТЫЙ viewer, терминальная
 * нода без выхода (как TableViewerNode). До Раунда 33 у неё был свой
 * `<select>` для выбора типа диаграммы (круговая/линейчатая) прямо в
 * теле ноды - теперь этот инструмент живёт в ChartNode (chartNode.js,
 * "Диаграмма" в сайдбаре, раздел "Таблицы"), а Viewer только показывает
 * то, что получил на вход, включая ЧЕЙ ТИП диаграммы выбрать:
 *
 *   - если подключён ChartNode - тип читается из его
 *     tableData.metadata.chartType (источник истины - панель ChartNode);
 *   - если подключено что-то другое (TableNode, LIST-нода напрямую) -
 *     chartType остаётся тем, что было раньше (по умолчанию 'donut', или
 *     значение, восстановленное из старого сохранённого проекта, где тип
 *     ещё выбирался прямо здесь) - обратная совместимость без регрессий
 *     для существующих .ncp-файлов.
 *
 * Разбор входа (LIST или Data) не изменился - тот же приоритет, что был
 * раньше: готовая таблица (Data) "богаче" списка, если есть и то, и
 * другое. Единственное отличие для Data-источника: если это именно
 * ChartNode (двухколоночная Категория/Значение) - строки читаются
 * ПОСТРОЧНО (TableData.toRowListData()), а не суммой по столбцам
 * (TableData.toListData(), как для TableNode) - см. комментарий в
 * dataTypes.js про разницу этих двух методов.
 */
export class PercentageNode extends BaseNode {
    constructor(id, type, x, y, config = {}) {
        super(id, type, x, y, config);
        // Диаграмма - терминальная Viewer-нода: ничего не передаёт дальше
        // по графу, поэтому выходного сокета нет (как у TableViewerNode).
        this.outputs = 0;
        // Вход 0 - универсальный (any): список ИЛИ таблица (Data). Если у
        // источника есть и то, и другое - побеждает таблица (см. calculate()):
        // явные заголовки колонок, а не безымянный список.
        this.inputs = 1;
        this.inputSockets = [0];
        this.width = config.width || 280;
        this.listData = new ListData();
        this.outputListData = new ListData();
        this.customTitle = config.customTitle || 'Процентное распределение';
        // Тип диаграммы больше НЕ выбирается тут (см. докстринг класса) -
        // либо приходит от ChartNode, либо остаётся тем, что было
        // восстановлено из старого проекта / дефолтом 'donut'
        this.chartType = config.chartType || 'donut';
        this.resultListData = new ListData();
        // Мультисерийные данные (Раунд 42) - заполняется в calculate()
        // ТОЛЬКО когда источник - ChartNode с несколькими столбцами
        // данных (см. calculate()); null - обычный однорядный режим,
        // рисуем через this.listData как раньше
        this._seriesData = null;
    }
    
    createContent() {
        const content = document.createElement('div');
        content.className = 'node-content';
        content.style.cssText = `
            width: 100%;
            min-width: 150px;
        `;
        // ВАЖНО: НЕ ставить overflow: hidden - сокеты выступают за границу
        // ноды через отрицательные margin (--socket-protrude) и обрезались
        
        // === ВЕРХНЯЯ СТРОКА: сокет | количество элементов ===
        const topRow = document.createElement('div');
        topRow.style.cssText = `
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 4px 0 8px 0;
            border-bottom: 1px solid var(--md-divider);
            margin-bottom: 8px;
        `;
        
        // Входной сокет - универсальный (any): список ИЛИ таблица (Data),
        // нода сама разбирается, что пришло (см. calculate())
        const socket = SocketFactory.createSocket({
            nodeId: this.id,
            socketType: 'input',
            index: 0,
            isAny: true,
            title: 'Источник данных: список (LIST) или таблица (DATA)'
        });
        topRow.appendChild(socket);

        // Количество элементов
        const countLabel = document.createElement('span');
        countLabel.className = 'input-count';
        countLabel.style.cssText = `
            color: var(--md-text-secondary);
            font-size: 11px;
            font-weight: 400;
            flex: 1;
            white-space: nowrap;
        `;
        countLabel.textContent = `${this.listData.items.length} эл.`;
        topRow.appendChild(countLabel);
        
        content.appendChild(topRow);

        // === ВИЗУАЛИЗАЦИЯ (тип - см. this.chartType, докстринг класса) ===
        const chartContainer = document.createElement('div');
        chartContainer.className = 'percentage-chart';
        chartContainer.style.cssText = `
            display: flex;
            flex-direction: column;
            gap: 6px;
            margin: 4px 0;
            min-height: 150px;
            flex: 1;
        `;
        
        const chartDisplay = document.createElement('div');
        chartDisplay.className = 'chart-display';
        chartDisplay.style.cssText = `
            display: flex;
            justify-content: center;
            align-items: center;
            padding: 4px 0;
            min-height: 140px;
        `;
        
        if (this._seriesData) {
            // Мультисерийно (Раунд 42) - несколько столбцов данных у
            // источника (ChartNode), см. docstring класса и ChartRenderer
            if (this.chartType === 'bar') {
                chartDisplay.appendChild(ChartRenderer.buildMultiBarChart(this._seriesData));
            } else {
                chartDisplay.appendChild(ChartRenderer.buildMultiDonutChart(this._seriesData));
            }
        } else if (this.chartType === 'bar') {
            chartDisplay.appendChild(ChartRenderer.buildBarChart(this.listData));
        } else {
            chartDisplay.appendChild(ChartRenderer.buildDonutChart(this.listData));
        }
        
        chartContainer.appendChild(chartDisplay);
        
        // Легенда - категорий/серий при мультисерийности (см. выше),
        // иначе как раньше (только для круговой)
        if (this._seriesData) {
            const legendContainer = document.createElement('div');
            legendContainer.className = 'percentage-legend';
            legendContainer.style.cssText = `
                display: flex;
                flex-wrap: wrap;
                gap: 4px 6px;
                justify-content: center;
                padding: 4px 0;
                width: 100%;
            `;
            if (this.chartType === 'bar') {
                ChartRenderer.buildSeriesLegend(this._seriesData.series, legendContainer);
            } else {
                ChartRenderer.buildCategoryLegend(this._seriesData.categories, legendContainer);
            }
            chartContainer.appendChild(legendContainer);
        } else if (this.chartType === 'donut') {
            const legendContainer = document.createElement('div');
            legendContainer.className = 'percentage-legend';
            legendContainer.style.cssText = `
                display: flex;
                flex-wrap: wrap;
                gap: 4px 6px;
                justify-content: center;
                padding: 4px 0;
                width: 100%;
            `;
            ChartRenderer.buildLegend(this.listData, legendContainer);
            chartContainer.appendChild(legendContainer);
        }
        
        content.appendChild(chartContainer);
        
        return content;
    }
    

    updateLegendAdaptive() {
        // Ширину не фиксируем: легенда занимает 100% ширины ноды
        // и перекладывается через flex-wrap автоматически
        const legendContainer = document.querySelector(`[data-node-id="${this.id}"] .percentage-legend`);
        if (!legendContainer) return;
        if (this._seriesData) {
            if (this.chartType === 'bar') {
                ChartRenderer.buildSeriesLegend(this._seriesData.series, legendContainer);
            } else {
                ChartRenderer.buildCategoryLegend(this._seriesData.categories, legendContainer);
            }
        } else {
            ChartRenderer.buildLegend(this.listData, legendContainer);
        }
    }
    
    // Добавляем метод для сброса ширины при полном обновлении
    resetWidth() {
        const el = document.querySelector(`[data-node-id="${this.id}"]`);
        if (el) {
            el.style.width = (this.width || 280) + 'px';
        }
    }

    calculate(nodeManager) {
        const connections = window.connectionManager?.getConnections() || [];
        const conn = connections.find(c => c.targetNodeId === this.id && c.targetSocket === 0);
        const srcNode = conn ? nodeManager.getNode(conn.sourceNodeId) : null;

        let inputList = new ListData();
        let inputName = this.customTitle || 'Процентное распределение';
        // Сбрасываем каждый пересчёт - если источник сменился на что-то
        // однорядное (или отключился совсем), старые мультисерийные
        // данные от предыдущего ChartNode-источника не должны остаться
        this._seriesData = null;

        // === ПРИОРИТЕТ 1: у источника есть готовая таблица (Data) ===
        // "Богаче" по семантике - заголовки колонок уже явные, поэтому
        // если у источника есть и tableData, и listData - побеждает tableData.
        if (srcNode && srcNode.tableData && srcNode.tableData.columns.length > 0) {
            if (srcNode.type === 'chart') {
                // ChartNode - двухколоночная Категория/Значение (или больше
                // при нескольких сериях, см. TableData.toSeriesData() в
                // dataTypes.js, Раунд 42), строка = элемент диаграммы, и
                // именно ChartNode - источник истины для типа диаграммы
                const seriesData = srcNode.tableData.toSeriesData();
                this._seriesData = seriesData.series.length > 1 ? seriesData : null;
                inputList = srcNode.tableData.toRowListData();
                if (srcNode.tableData.metadata?.chartType) {
                    this.chartType = srcNode.tableData.metadata.chartType;
                }
            } else {
                this._seriesData = null;
                inputList = srcNode.tableData.toListData();
            }
            inputName = srcNode.tableData.metadata?.title || srcNode.customName || srcNode.getDisplayName?.() || 'Таблица';
        }

        // === ПРИОРИТЕТ 2: у источника есть список (LIST) ===
        if (inputList.items.length === 0 && srcNode) {
            // === ВАЖНО: для процентного графика берем ПОЛНЫЙ СПИСОК ===
            // Сначала проверяем listData (полный список)
            if (srcNode.listData && srcNode.listData.items && srcNode.listData.items.length > 0) {
                // Проверяем, не является ли это сжатым списком (один элемент)
                // Если это полный список (isFullList) или элементов > 1 - берем его
                const isFullList = srcNode.listData.metadata?.isFullList === true;
                const hasManyItems = srcNode.listData.items.length > 1;

                if (isFullList || hasManyItems) {
                    inputList = srcNode.listData;
                    inputName = srcNode.listData.metadata?.title || srcNode.customName || srcNode.type || 'Данные';
                } else if (srcNode.resultListData && srcNode.resultListData.items && srcNode.resultListData.items.length === 1) {
                    // Список содержит только один элемент, но это результат операции - берем его
                    inputList = srcNode.resultListData;
                    inputName = srcNode.resultListData.metadata?.title || srcNode.customName || srcNode.type || 'Данные';
                } else {
                    // Обычный список с одним элементом
                    inputList = srcNode.listData;
                    inputName = srcNode.listData.metadata?.title || srcNode.customName || srcNode.type || 'Данные';
                }
            } else if (srcNode.resultListData && srcNode.resultListData.items && srcNode.resultListData.items.length > 0) {
                // Есть resultListData и это не полный список - берем resultListData
                inputList = srcNode.resultListData;
                inputName = srcNode.resultListData.metadata?.title || srcNode.customName || srcNode.type || 'Данные';
            }
        }

        this.listData = inputList;
        
        // Создаем выходной список с процентами
        this.outputListData = new ListData(
            this.listData.items.map(item => ({
                name: item.name || 'unknown',
                value: item.value || 0,
                format: item.format || 'number'
            })),
            {
                title: this.customTitle || 'Процентное распределение',
                total: this.listData.total,
                percentages: this.listData.percentages,
                chartType: this.chartType,
                sourceName: inputName
            }
        );
        
        // Создаем resultListData для передачи дальше (сумма)
        const totalSum = this.listData.total;
        const displayName = this.customTitle || this.customName || 'Проценты';
        this.resultListData = new ListData(
            [{ name: displayName, value: totalSum }],
            {
                title: displayName,
                total: totalSum,
                isPercentageResult: true,
                sourceName: inputName,
                itemsCount: this.listData.items.length
            }
        );
        
        return this.listData.total;
    }
    
    updateDisplay(element) {
        // Обновляем количество элементов
        const countDisplay = element.querySelector('.input-count');
        if (countDisplay) {
            countDisplay.textContent = `${this.listData.items.length} эл.`;
        }
        
        // Обновляем диаграмму
        const chartDisplay = element.querySelector('.chart-display');
        if (chartDisplay) {
            chartDisplay.innerHTML = '';
            if (this._seriesData) {
                chartDisplay.appendChild(this.chartType === 'bar'
                    ? ChartRenderer.buildMultiBarChart(this._seriesData)
                    : ChartRenderer.buildMultiDonutChart(this._seriesData));
            } else if (this.chartType === 'bar') {
                chartDisplay.appendChild(ChartRenderer.buildBarChart(this.listData));
            } else {
                chartDisplay.appendChild(ChartRenderer.buildDonutChart(this.listData));
            }
        }
        
        // Обновляем легенду - категорий/серий при мультисерийности,
        // иначе как раньше (только для круговой)
        const legendContainer = element.querySelector('.percentage-legend');
        if (legendContainer) {
            if (this._seriesData) {
                legendContainer.style.display = 'flex';
                if (this.chartType === 'bar') {
                    ChartRenderer.buildSeriesLegend(this._seriesData.series, legendContainer);
                } else {
                    ChartRenderer.buildCategoryLegend(this._seriesData.categories, legendContainer);
                }
            } else if (this.chartType === 'donut') {
                legendContainer.style.display = 'flex';
                ChartRenderer.buildLegend(this.listData, legendContainer);
            } else {
                legendContainer.style.display = 'none';
            }
        }
    }
    
    rerender() {
        const el = document.querySelector(`[data-node-id="${this.id}"]`);
        if (!el) return;
        
        // Сохраняем состояние
        const currentWidth = this.width || el.offsetWidth || 280;
        const currentX = parseFloat(el.style.left) || this.x;
        const currentY = parseFloat(el.style.top) || this.y;
        const wasCollapsed = this.collapsed;
        const wasCustomName = this.customName;
        
        // Удаляем старый DOM элемент
        el.remove();
        
        // Восстанавливаем состояние в объекте ноды
        this.x = currentX;
        this.y = currentY;
        this.width = currentWidth;
        this.collapsed = wasCollapsed;
        if (wasCustomName) {
            this.customName = wasCustomName;
        }
        
        // Обновляем ноду в менеджере
        if (window.nodeManager) {
            const nodeInManager = window.nodeManager.getNode(this.id);
            if (nodeInManager) {
                nodeInManager.x = currentX;
                nodeInManager.y = currentY;
                nodeInManager.width = this.width;
                nodeInManager.collapsed = wasCollapsed;
                nodeInManager.customName = wasCustomName;
            }
            
            // Перерисовываем через менеджер
            window.nodeManager.renderNode(this);
            
            // Применяем ширину к новому элементу
            const newEl = document.querySelector(`[data-node-id="${this.id}"]`);
            if (newEl) {
                newEl.style.width = this.width + 'px';
                if (wasCollapsed) {
                    newEl.classList.add('collapsed');
                }
            }
            
            // Перерисовываем соединения и обновляем дисплей
            if (window.renderer) {
                window.renderer.drawAllConnections(window.connectionManager?.getConnections() || []);
                window.renderer.updateAllDisplays();
            }
        }
    }
}