import { BaseNode } from './baseNode.js';
import { Helpers } from'../utils/helpers.js';
import { ListData } from '../utils/dataTypes.js';

export class PercentageNode extends BaseNode {
    constructor(id, type, x, y, config = {}) {
        super(id, type, x, y, config);
        this.outputs = 1;
        this.inputs = 1;
        this.inputSockets = [0];
        this.listData = new ListData();
        this.outputListData = new ListData();
        this.customTitle = config.customTitle || 'Процентное распределение';
        this.chartType = config.chartType || 'donut';
        this.chartTypes = [
            { value: 'donut', label: '🍩 Круговая' },
            { value: 'bar', label: '📊 Линейчатая' }
        ];
        this.resultListData = new ListData();
    }
    
    createContent() {
        const content = document.createElement('div');
        content.className = 'node-content';
        content.style.minWidth = '280px';
        content.style.minHeight = '200px';
        content.style.width = '100%';
        // ВАЖНО: НЕ ставить overflow: hidden - сокеты выступают за границу
        // ноды через отрицательные margin (--socket-protrude) и обрезались
        
        // === ВЕРХНЯЯ СТРОКА: сокет | переключатель | сумма ===
        const topRow = document.createElement('div');
        topRow.style.cssText = `
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 4px 0 8px 0;
            border-bottom: 1px solid var(--md-divider);
            margin-bottom: 8px;
        `;
        
        // Входной сокет (квадратный, синий)
        const socket = document.createElement('div');
        socket.className = 'socket input-socket socket-list';
        socket.dataset.nodeId = this.id;
        socket.dataset.socketType = 'input';
        socket.dataset.index = 0;
        socket.dataset.isList = 'true';
        socket.style.cssText = `
            width: 14px;
            height: 14px;
            border-radius: 3px;
            flex-shrink: 0;
        `;
        socket.title = 'Входной список (LIST)';
        topRow.appendChild(socket);
        
        socket.addEventListener('mousedown', (e) => {
            e.stopPropagation();
            e.preventDefault();
            if (window.connectionManager) {
                window.connectionManager.startConnection(e, this.id, 'input');
            }
        });
        
        // Выпадающий список для выбора типа диаграммы
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
            min-width: 100px;
        `;
        
        this.chartTypes.forEach(type => {
            const option = document.createElement('option');
            option.value = type.value;
            option.textContent = type.label;
            if (type.value === this.chartType) {
                option.selected = true;
            }
            select.appendChild(option);
        });
        
        select.addEventListener('change', (e) => {
            this.chartType = e.target.value;
            this.rerender();
        });
        
        topRow.appendChild(select);
        
        // Количество элементов
        const countLabel = document.createElement('span');
        countLabel.className = 'input-count';
        countLabel.style.cssText = `
            color: var(--md-text-secondary);
            font-size: 11px;
            font-weight: 400;
            white-space: nowrap;
        `;
        countLabel.textContent = `${this.listData.items.length} эл.`;
        topRow.appendChild(countLabel);
        
        // Сумма (общее)
        const totalValue = document.createElement('span');
        totalValue.className = 'percentage-total';
        totalValue.style.cssText = `
            color: var(--md-accent);
            font-size: 16px;
            font-weight: 700;
            min-width: 50px;
            text-align: right;
            font-variant-numeric: tabular-nums;
        `;
        totalValue.textContent = this.listData.total !== 0 ? this.listData.total.toFixed(2) : '0';
        topRow.appendChild(totalValue);
        
        content.appendChild(topRow);
        
        // === ВИЗУАЛИЗАЦИЯ ===
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
        
        // Контейнер для диаграммы
        const chartDisplay = document.createElement('div');
        chartDisplay.className = 'chart-display';
        chartDisplay.style.cssText = `
            display: flex;
            justify-content: center;
            align-items: center;
            padding: 4px 0;
            min-height: 140px;
        `;
        
        // Рендерим выбранную диаграмму
        if (this.chartType === 'bar') {
            const barChart = this.createBarChart();
            chartDisplay.appendChild(barChart);
        } else {
            const donutChart = this.createDonutChart();
            chartDisplay.appendChild(donutChart);
        }
        
        chartContainer.appendChild(chartDisplay);
        
        // Легенда (только для круговой диаграммы)
        if (this.chartType === 'donut') {
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
            this.updateLegend(legendContainer);
            chartContainer.appendChild(legendContainer);
        }
        
        content.appendChild(chartContainer);
        
        // === ВЫХОДНОЙ СОКЕТ ===
        const outputRow = document.createElement('div');
        outputRow.className = 'node-output';
        outputRow.style.cssText = `
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 6px 0 2px 0;
            margin-top: 6px;
            border-top: 1px solid var(--md-divider);
        `;
        
        const outputLabel = document.createElement('label');
        outputLabel.textContent = 'Список (LIST):';
        outputLabel.style.cssText = `
            color: var(--md-text-secondary);
            font-size: 11px;
            font-weight: 400;
            flex: 1;
        `;
        outputRow.appendChild(outputLabel);
        
        const outputCount = document.createElement('span');
        outputCount.className = 'output-count';
        outputCount.style.cssText = `
            color: #4fc3f7;
            font-size: 12px;
            font-weight: 500;
        `;
        outputCount.textContent = `${this.outputListData.items.length} эл.`;
        outputRow.appendChild(outputCount);
        
        const outputSocket = document.createElement('div');
        outputSocket.className = 'socket output-socket socket-list';
        outputSocket.dataset.nodeId = this.id;
        outputSocket.dataset.socketType = 'output';
        outputSocket.dataset.outputType = 'list';
        outputSocket.dataset.index = 0;
        outputSocket.dataset.isList = 'true';
        outputSocket.style.cssText = `
            border-color: #4fc3f7 !important;
            width: 14px;
            height: 14px;
            border-radius: 3px;
            flex-shrink: 0;
        `;
        outputSocket.title = 'Выходной список (LIST)';
        outputRow.appendChild(outputSocket);
        
        outputSocket.addEventListener('mousedown', (e) => {
            e.stopPropagation();
            e.preventDefault();
            if (window.connectionManager) {
                window.connectionManager.startConnection(e, this.id, 'output');
            }
        });
        
        content.appendChild(outputRow);
        
        return content;
    }
    
    createDonutChart() {
        const size = 140;
        const radius = 48;
        const strokeWidth = 20;
        const center = size / 2;
        
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('width', size);
        svg.setAttribute('height', size);
        svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
        svg.style.cssText = 'transform: rotate(-90deg);';
        
        const bgCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        bgCircle.setAttribute('cx', center);
        bgCircle.setAttribute('cy', center);
        bgCircle.setAttribute('r', radius);
        bgCircle.setAttribute('fill', 'none');
        bgCircle.setAttribute('stroke', 'rgba(255,255,255,0.05)');
        bgCircle.setAttribute('stroke-width', strokeWidth);
        svg.appendChild(bgCircle);
        
        const items = this.listData.items;
        const percentages = this.listData.percentages;
        const total = this.listData.total;
        
        if (total > 0 && items.length > 0) {
            const colors = this.getColors();
            let startAngle = 0;
            
            items.forEach((item, idx) => {
                const pct = percentages[idx];
                if (pct <= 0) return;
                
                const angle = (pct / 100) * 2 * Math.PI;
                const endAngle = startAngle + angle;
                
                const x1 = center + radius * Math.cos(startAngle);
                const y1 = center + radius * Math.sin(startAngle);
                const x2 = center + radius * Math.cos(endAngle);
                const y2 = center + radius * Math.sin(endAngle);
                
                const largeArc = angle > Math.PI ? 1 : 0;
                
                const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                const d = [
                    `M ${x1} ${y1}`,
                    `A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2}`
                ].join(' ');
                
                path.setAttribute('d', d);
                path.setAttribute('fill', 'none');
                path.setAttribute('stroke', colors[idx % colors.length]);
                path.setAttribute('stroke-width', strokeWidth);
                path.setAttribute('stroke-linecap', 'round');
                
                svg.appendChild(path);
                startAngle = endAngle;
            });
        } else {
            const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            text.setAttribute('x', center);
            text.setAttribute('y', center + 4);
            text.setAttribute('text-anchor', 'middle');
            text.setAttribute('fill', 'var(--md-text-disabled)');
            text.setAttribute('font-size', '12');
            text.setAttribute('font-weight', '500');
            text.setAttribute('transform', 'rotate(90, ' + center + ', ' + center + ')');
            text.textContent = 'Нет данных';
            svg.appendChild(text);
        }
        
        // Центральный текст - сумма
        const centerText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        centerText.setAttribute('x', center);
        centerText.setAttribute('y', center + 5);
        centerText.setAttribute('text-anchor', 'middle');
        centerText.setAttribute('fill', 'var(--md-text)');
        centerText.setAttribute('font-size', '16');
        centerText.setAttribute('font-weight', '700');
        centerText.setAttribute('transform', 'rotate(90, ' + center + ', ' + center + ')');
        centerText.textContent = this.listData.total !== 0 ? this.listData.total.toFixed(1) : '0';
        svg.appendChild(centerText);
        
        return svg;
    }
    
    createBarChart() {
        const container = document.createElement('div');
        container.style.cssText = `
            width: 100%;
            max-width: 260px;
            padding: 4px 0;
        `;
        
        const items = this.listData.items;
        const percentages = this.listData.percentages;
        const total = this.listData.total;
        const colors = this.getColors();
        
        if (total === 0 || items.length === 0) {
            const noData = document.createElement('div');
            noData.style.cssText = `
                color: var(--md-text-disabled);
                font-size: 13px;
                text-align: center;
                padding: 20px 0;
            `;
            noData.textContent = 'Нет данных';
            container.appendChild(noData);
            return container;
        }
        
        const maxValue = Math.max(...percentages);
        const barHeight = 18;
        const maxBars = 8;
        
        let displayItems = items;
        let displayPercentages = percentages;
        let displayColors = colors;
        
        if (items.length > maxBars) {
            const sorted = items.map((item, idx) => ({
                item,
                pct: percentages[idx],
                color: colors[idx % colors.length],
                idx
            })).sort((a, b) => b.pct - a.pct);
            
            const top = sorted.slice(0, maxBars);
            const rest = sorted.slice(maxBars);
            
            displayItems = top.map(d => d.item);
            displayPercentages = top.map(d => d.pct);
            displayColors = top.map(d => d.color);
            
            if (rest.length > 0) {
                const restPct = rest.reduce((sum, d) => sum + d.pct, 0);
                displayItems.push({ name: 'Остальные' });
                displayPercentages.push(restPct);
                displayColors.push('#78909c');
            }
        }
        
        displayItems.forEach((item, idx) => {
            const pct = displayPercentages[idx];
            if (pct <= 0) return;
            
            const row = document.createElement('div');
            row.style.cssText = `
                display: flex;
                align-items: center;
                gap: 6px;
                margin: 2px 0;
            `;
            
            const name = document.createElement('span');
            name.style.cssText = `
                color: var(--md-text-secondary);
                font-size: 10px;
                min-width: 50px;
                max-width: 70px;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
                text-align: right;
            `;
            name.textContent = item.name || 'unknown';
            name.title = item.name || 'unknown';
            row.appendChild(name);
            
            const barContainer = document.createElement('div');
            barContainer.style.cssText = `
                flex: 1;
                height: ${barHeight}px;
                background: rgba(255,255,255,0.05);
                border-radius: 3px;
                overflow: hidden;
                position: relative;
                min-width: 40px;
            `;
            
            const bar = document.createElement('div');
            const widthPercent = Math.max((pct / maxValue) * 100, 3);
            bar.style.cssText = `
                width: ${widthPercent}%;
                height: 100%;
                background: ${displayColors[idx % displayColors.length]};
                border-radius: 3px;
                transition: width 0.5s ease;
                position: relative;
            `;
            
            barContainer.appendChild(bar);
            row.appendChild(barContainer);
            
            const pctLabel = document.createElement('span');
            pctLabel.style.cssText = `
                color: var(--md-text);
                font-size: 10px;
                font-weight: 500;
                min-width: 40px;
                text-align: right;
                font-variant-numeric: tabular-nums;
            `;
            pctLabel.textContent = `${pct.toFixed(1)}%`;
            row.appendChild(pctLabel);
            
            container.appendChild(row);
        });
        
        return container;
    }
    
    getColors() {
        return [
            '#4fc3f7', '#81c784', '#ffb74d', '#ce93d8', '#ef5350',
            '#26c6da', '#ffa726', '#66bb6a', '#42a5f5', '#ec407a',
            '#ab47bc', '#26a69a', '#ff8a65', '#5c6bc0', '#78909c'
        ];
    }
    
    updateLegend(container) {
        container.innerHTML = '';
        const items = this.listData.items;
        const percentages = this.listData.percentages;
        const colors = this.getColors();
        
        if (items.length === 0) {
            const empty = document.createElement('div');
            empty.style.cssText = `
                color: var(--md-text-disabled);
                font-size: 11px;
                padding: 4px;
                text-align: center;
                width: 100%;
            `;
            empty.textContent = 'Нет данных';
            container.appendChild(empty);
            return;
        }
        
        // Если элементов слишком много - показываем компактную легенду
        if (items.length > 15) {
            const summary = document.createElement('div');
            summary.style.cssText = `
                color: var(--md-text-secondary);
                font-size: 11px;
                padding: 4px;
                text-align: center;
                width: 100%;
            `;
            summary.textContent = `${items.length} элементов`;
            container.appendChild(summary);
            return;
        }
        
        // Фильтруем только элементы с положительным значением
        const positiveItems = [];
        items.forEach((item, idx) => {
            if (item.value > 0) {
                positiveItems.push({ item, idx, pct: percentages[idx] });
            }
        });
        
        if (positiveItems.length === 0) {
            const empty = document.createElement('div');
            empty.style.cssText = `
                color: var(--md-text-disabled);
                font-size: 11px;
                padding: 4px;
                text-align: center;
                width: 100%;
            `;
            empty.textContent = 'Нет данных для отображения';
            container.appendChild(empty);
            return;
        }
        
        // Ограничиваем количество отображаемых элементов в легенде
        const maxLegendItems = 12;
        let displayItems = positiveItems;
        let hasMore = false;
        
        if (positiveItems.length > maxLegendItems) {
            displayItems = positiveItems.slice(0, maxLegendItems);
            hasMore = true;
        }
        
        // Просто рендерим элементы - flex-wrap контейнера сам разложит их
        // по ширине ноды; при нехватке места элементы переносятся на новую
        // строку, а нода растёт по высоте (у .node высота авто)
        displayItems.forEach(({ item, idx, pct }) => {
            const legendItem = document.createElement('div');
            legendItem.style.cssText = `
                display: flex;
                align-items: center;
                gap: 4px;
                font-size: 10px;
                padding: 2px 6px;
                background: rgba(255,255,255,0.03);
                border-radius: 3px;
                max-width: 100%;
                overflow: hidden;
            `;
            
            const colorBox = document.createElement('span');
            colorBox.style.cssText = `
                width: 8px;
                height: 8px;
                border-radius: 2px;
                background: ${colors[idx % colors.length]};
                flex-shrink: 0;
            `;
            
            const nameLabel = document.createElement('span');
            const displayPct = pct || 0;
            const displayName = item.name || 'unknown';
            
            nameLabel.textContent = `${displayName}: ${displayPct.toFixed(1)}%`;
            nameLabel.style.cssText = `
                color: var(--md-text);
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            `;
            nameLabel.title = `${displayName}: ${displayPct.toFixed(1)}%`;
            
            legendItem.appendChild(colorBox);
            legendItem.appendChild(nameLabel);
            container.appendChild(legendItem);
        });
        
        // Добавляем индикатор "и еще ..." если есть скрытые элементы
        if (hasMore) {
            const moreLabel = document.createElement('div');
            moreLabel.style.cssText = `
                color: var(--md-text-disabled);
                font-size: 10px;
                padding: 2px 6px;
                text-align: center;
                width: 100%;
                font-style: italic;
            `;
            moreLabel.textContent = `и еще ${positiveItems.length - maxLegendItems} ...`;
            container.appendChild(moreLabel);
        }
    }

    updateLegendAdaptive() {
        // Ширину не фиксируем: легенда занимает 100% ширины ноды
        // и перекладывается через flex-wrap автоматически
        const legendContainer = document.querySelector(`[data-node-id="${this.id}"] .percentage-legend`);
        if (legendContainer) {
            this.updateLegend(legendContainer);
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
        const inputs = connections.filter(c => c.targetNodeId === this.id);
        
        let inputList = new ListData();
        let inputName = this.customTitle || 'Процентное распределение';
        
        inputs.forEach(c => {
            const srcNode = nodeManager.getNode(c.sourceNodeId);
            if (!srcNode) return;
            
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
                    return;
                }
            }
            
            // Если список содержит только один элемент, но это результат операции - берем его
            if (srcNode.listData && srcNode.listData.items && srcNode.listData.items.length === 1) {
                // Проверяем, не является ли это resultListData (у него есть маркер isResult)
                if (srcNode.resultListData && srcNode.resultListData.items && srcNode.resultListData.items.length === 1) {
                    // Это результат операции - используем его как единственный элемент
                    inputList = srcNode.resultListData;
                    inputName = srcNode.resultListData.metadata?.title || srcNode.customName || srcNode.type || 'Данные';
                    return;
                }
                
                // Если это обычный список с одним элементом - берем его
                inputList = srcNode.listData;
                inputName = srcNode.listData.metadata?.title || srcNode.customName || srcNode.type || 'Данные';
                return;
            }
            
            // Если есть resultListData и это не полный список - берем resultListData
            if (srcNode.resultListData && srcNode.resultListData.items && srcNode.resultListData.items.length > 0) {
                // Проверяем, что это не полный список с одним элементом
                const isFullList = srcNode.listData?.metadata?.isFullList === true;
                if (!isFullList) {
                    inputList = srcNode.resultListData;
                    inputName = srcNode.resultListData.metadata?.title || srcNode.customName || srcNode.type || 'Данные';
                    return;
                }
            }
        });
        
        this.listData = inputList;
        
        // Создаем выходной список с процентами
        this.outputListData = new ListData(
            this.listData.items.map(item => ({
                name: item.name || 'unknown',
                value: item.value || 0
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
        // Обновляем сумму
        const totalDisplay = element.querySelector('.percentage-total');
        if (totalDisplay) {
            totalDisplay.textContent = this.listData.total !== 0 ? this.listData.total.toFixed(2) : '0';
        }
        
        // Обновляем количество элементов
        const countDisplay = element.querySelector('.input-count');
        if (countDisplay) {
            countDisplay.textContent = `${this.listData.items.length} эл.`;
        }
        
        // Обновляем выходной счетчик
        const outputCount = element.querySelector('.output-count');
        if (outputCount) {
            outputCount.textContent = `${this.outputListData.items.length} эл.`;
        }
        
        // Обновляем выпадающий список
        const select = element.querySelector('.chart-type-select');
        if (select) {
            select.value = this.chartType;
        }
        
        // Обновляем диаграмму
        const chartDisplay = element.querySelector('.chart-display');
        if (chartDisplay) {
            chartDisplay.innerHTML = '';
            if (this.chartType === 'bar') {
                const barChart = this.createBarChart();
                chartDisplay.appendChild(barChart);
            } else {
                const donutChart = this.createDonutChart();
                chartDisplay.appendChild(donutChart);
            }
        }
        
        // Обновляем легенду (только для круговой)
        const legendContainer = element.querySelector('.percentage-legend');
        if (legendContainer) {
            if (this.chartType === 'donut') {
                legendContainer.style.display = 'flex';
                this.updateLegend(legendContainer);
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