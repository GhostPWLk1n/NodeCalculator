/**
 * SPDX-License-Identifier: MIT
 * SPDX-FileCopyrightText: 2024 NodeCalculate Team
 * SPDX-FileCopyrightText: 2024 Pavel Fomin
 *
 * @file    chartRenderer.js
 * @brief   Общий код отрисовки SVG-диаграмм (круговая/линейчатая) + легенды
 * @author  Pavel Fomin
 * @version 1.8.58
 * @see     https://github.com/GhostPWLk1n/NodeCalculator.git
 */

import { Helpers } from './helpers.js';

/**
 * ChartRenderer - раньше это был код внутри PercentageNode (единственного
 * места, где рисовались диаграммы). С Раунда 33 диаграммы рисуют ДВА
 * разных места: PercentageNode (просмотр на Листе) и
 * ChartNode.getDashboardWidget() (просмотр на Доске, см. dashboardNode.js/
 * boardManager.js) - поэтому SVG-код вынесен сюда, чтобы не дублировать
 * ~250 строк в двух нодах.
 *
 * Все функции принимают ListData (см. dataTypes.js) - используют её
 * готовые геттеры .total/.percentages вместо пересчёта на месте.
 */
export const ChartRenderer = {
    getColors() {
        return [
            '#4fc3f7', '#81c784', '#ffb74d', '#ce93d8', '#ef5350',
            '#26c6da', '#ffa726', '#66bb6a', '#42a5f5', '#ec407a',
            '#ab47bc', '#26a69a', '#ff8a65', '#5c6bc0', '#78909c'
        ];
    },

    // Кольцевая диаграмма. opts: { size, radius, strokeWidth, rotateLabels }
    // rotateLabels=false отключает поворот текста на -90deg вместе с SVG -
    // нужно для виджета Доски, где текст должен читаться прямо, а не под
    // углом (в узле на Листе поворот - историческое решение подгонки под
    // компактный квадратный корпус ноды).
    buildDonutChart(listData, opts = {}) {
        const size = opts.size ?? 140;
        const radius = opts.radius ?? 48;
        const strokeWidth = opts.strokeWidth ?? 20;
        const rotateLabels = opts.rotateLabels ?? true;
        const center = size / 2;

        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('width', size);
        svg.setAttribute('height', size);
        svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
        if (rotateLabels) svg.style.cssText = 'transform: rotate(-90deg);';

        const bgCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        bgCircle.setAttribute('cx', center);
        bgCircle.setAttribute('cy', center);
        bgCircle.setAttribute('r', radius);
        bgCircle.setAttribute('fill', 'none');
        bgCircle.setAttribute('stroke', 'rgba(255,255,255,0.05)');
        bgCircle.setAttribute('stroke-width', strokeWidth);
        svg.appendChild(bgCircle);

        const items = listData.items;
        const percentages = listData.percentages;
        const total = listData.total;

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
            if (rotateLabels) text.setAttribute('transform', `rotate(90, ${center}, ${center})`);
            text.textContent = 'Нет данных';
            svg.appendChild(text);
        }

        const centerText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        centerText.setAttribute('x', center);
        centerText.setAttribute('y', center + 5);
        centerText.setAttribute('text-anchor', 'middle');
        centerText.setAttribute('fill', 'var(--md-text)');
        centerText.setAttribute('font-size', '16');
        centerText.setAttribute('font-weight', '700');
        if (rotateLabels) centerText.setAttribute('transform', `rotate(90, ${center}, ${center})`);
        centerText.textContent = total !== 0 ? total.toFixed(1) : '0';
        svg.appendChild(centerText);

        return svg;
    },

    // Линейчатая диаграмма. opts: { maxWidth, maxBars }
    buildBarChart(listData, opts = {}) {
        const maxWidth = opts.maxWidth ?? 260;
        const maxBars = opts.maxBars ?? 8;

        const container = document.createElement('div');
        container.style.cssText = `width: 100%; max-width: ${maxWidth}px; padding: 4px 0;`;

        const items = listData.items;
        const percentages = listData.percentages;
        const total = listData.total;
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
            row.style.cssText = 'display:flex; align-items:center; gap:6px; margin:2px 0;';

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
    },

    // Легенда (для круговой диаграммы). container - уже существующий DOM-
    // элемент, будет очищен и заполнен заново (вызывающий код сам решает,
    // когда её обновлять - см. percentageNode.js/chartNode.js)
    buildLegend(listData, container, opts = {}) {
        container.innerHTML = '';
        const items = listData.items;
        const percentages = listData.percentages;
        const colors = this.getColors();
        const maxLegendItems = opts.maxLegendItems ?? 12;

        const emptyMsg = (text) => {
            const empty = document.createElement('div');
            empty.style.cssText = `
                color: var(--md-text-disabled);
                font-size: 11px;
                padding: 4px;
                text-align: center;
                width: 100%;
            `;
            empty.textContent = text;
            container.appendChild(empty);
        };

        if (items.length === 0) return emptyMsg('Нет данных');

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

        const positiveItems = [];
        items.forEach((item, idx) => {
            if (item.value > 0) positiveItems.push({ item, idx, pct: percentages[idx] });
        });

        if (positiveItems.length === 0) return emptyMsg('Нет данных для отображения');

        let displayItems = positiveItems;
        let hasMore = false;
        if (positiveItems.length > maxLegendItems) {
            displayItems = positiveItems.slice(0, maxLegendItems);
            hasMore = true;
        }

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
            const displayValue = Helpers.formatByType(item.value, item.format);
            const labelText = `${displayName}: ${displayValue} (${displayPct.toFixed(1)}%)`;
            nameLabel.textContent = labelText;
            nameLabel.style.cssText = `
                color: var(--md-text);
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            `;
            nameLabel.title = labelText;

            legendItem.appendChild(colorBox);
            legendItem.appendChild(nameLabel);
            container.appendChild(legendItem);
        });

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
    },

    // ==========================================================
    // МУЛЬТИСЕРИЙНЫЕ ДИАГРАММЫ (Раунд 42) - когда у источника
    // БОЛЬШЕ ОДНОГО столбца с данными (см. TableData.toSeriesData() в
    // dataTypes.js). seriesData = { categories: [...], series: [{name,
    // format, values}] } - категории (строки таблицы) и несколько серий
    // (столбцов), каждая со своим набором значений по тем же категориям.
    // ==========================================================

    // Круговая с несколькими сериями - КОНЦЕНТРИЧЕСКИЕ кольца, одно
    // кольцо на серию (внешнее - первая серия, дальше к центру). Цвет -
    // ПО КАТЕГОРИИ и одинаковый на всех кольцах - так виден "путь" одной
    // категории между сериями (например, между кварталами), а положение
    // кольца уже само говорит, какая это серия.
    buildMultiDonutChart(seriesData, opts = {}) {
        const { categories, series } = seriesData;
        const size = opts.size ?? 140;
        const outerRadius = opts.radius ?? 48;
        const rotateLabels = opts.rotateLabels ?? true;
        const center = size / 2;
        const colors = this.getColors();

        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('width', size);
        svg.setAttribute('height', size);
        svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
        if (rotateLabels) svg.style.cssText = 'transform: rotate(-90deg);';

        if (series.length === 0 || categories.length === 0) {
            const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            text.setAttribute('x', center);
            text.setAttribute('y', center + 4);
            text.setAttribute('text-anchor', 'middle');
            text.setAttribute('fill', 'var(--md-text-disabled)');
            text.setAttribute('font-size', '12');
            text.setAttribute('font-weight', '500');
            if (rotateLabels) text.setAttribute('transform', `rotate(90, ${center}, ${center})`);
            text.textContent = 'Нет данных';
            svg.appendChild(text);
            return svg;
        }

        // Доступный радиус делится поровну между кольцами - зазор между
        // ними фиксирован (2px), толщина кольца - всё, что останется
        const gap = 2;
        const ringWidth = Math.max(4, (outerRadius - 6) / series.length - gap);

        series.forEach((s, seriesIdx) => {
            const radius = outerRadius - seriesIdx * (ringWidth + gap);
            if (radius < ringWidth / 2) return; // слишком много серий - кольцо уже не поместится, дальше не рисуем

            const bgCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            bgCircle.setAttribute('cx', center);
            bgCircle.setAttribute('cy', center);
            bgCircle.setAttribute('r', radius);
            bgCircle.setAttribute('fill', 'none');
            bgCircle.setAttribute('stroke', 'rgba(255,255,255,0.05)');
            bgCircle.setAttribute('stroke-width', ringWidth);
            svg.appendChild(bgCircle);

            const total = s.values.reduce((a, b) => a + (typeof b === 'number' ? b : 0), 0);
            if (total <= 0) return;

            let startAngle = 0;
            s.values.forEach((v, catIdx) => {
                const val = typeof v === 'number' ? v : 0;
                if (val <= 0) return;
                const angle = (val / total) * 2 * Math.PI;
                const endAngle = startAngle + angle;

                const x1 = center + radius * Math.cos(startAngle);
                const y1 = center + radius * Math.sin(startAngle);
                const x2 = center + radius * Math.cos(endAngle);
                const y2 = center + radius * Math.sin(endAngle);
                const largeArc = angle > Math.PI ? 1 : 0;

                const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                path.setAttribute('d', `M ${x1} ${y1} A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2}`);
                path.setAttribute('fill', 'none');
                path.setAttribute('stroke', colors[catIdx % colors.length]);
                path.setAttribute('stroke-width', ringWidth);
                path.setAttribute('stroke-linecap', 'round');
                svg.appendChild(path);

                startAngle = endAngle;
            });
        });

        return svg;
    },

    // Линейчатая с несколькими сериями - ГРУППЫ полос, одна группа на
    // категорию, внутри группы - по полосе на серию. Цвет - ПО СЕРИИ
    // (внутри одной группы категория уже и так очевидна по подписи, а вот
    // какая полоса какой серии принадлежит - нет, отсюда и легенда серий,
    // см. buildSeriesLegend). Общий максимум по ВСЕМ сериям и категориям -
    // чтобы длины полос были сравнимы МЕЖДУ сериями, а не только внутри одной.
    buildMultiBarChart(seriesData, opts = {}) {
        const { categories, series } = seriesData;
        const maxWidth = opts.maxWidth ?? 260;
        const maxCategories = opts.maxCategories ?? 8;
        const colors = this.getColors();

        const container = document.createElement('div');
        container.style.cssText = `width: 100%; max-width: ${maxWidth}px; padding: 4px 0;`;

        if (series.length === 0 || categories.length === 0) {
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

        const globalMax = Math.max(1, ...series.flatMap(s => s.values.map(v => (typeof v === 'number' ? v : 0))));
        const displayCount = Math.min(categories.length, maxCategories);

        for (let catIdx = 0; catIdx < displayCount; catIdx++) {
            const group = document.createElement('div');
            group.style.cssText = 'margin: 6px 0;';

            const catLabel = document.createElement('div');
            catLabel.style.cssText = `
                color: var(--md-text-secondary);
                font-size: 10px;
                font-weight: 500;
                margin-bottom: 2px;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            `;
            catLabel.textContent = categories[catIdx] ?? '';
            catLabel.title = categories[catIdx] ?? '';
            group.appendChild(catLabel);

            series.forEach((s, seriesIdx) => {
                const val = typeof s.values[catIdx] === 'number' ? s.values[catIdx] : 0;

                const row = document.createElement('div');
                row.style.cssText = 'display:flex; align-items:center; gap:6px; margin:1px 0;';

                const barContainer = document.createElement('div');
                barContainer.style.cssText = `
                    flex: 1;
                    height: 12px;
                    background: rgba(255,255,255,0.05);
                    border-radius: 2px;
                    overflow: hidden;
                    min-width: 30px;
                `;
                const bar = document.createElement('div');
                const widthPercent = val > 0 ? Math.max((val / globalMax) * 100, 3) : 0;
                bar.style.cssText = `
                    width: ${widthPercent}%;
                    height: 100%;
                    background: ${colors[seriesIdx % colors.length]};
                    border-radius: 2px;
                    transition: width 0.5s ease;
                `;
                barContainer.appendChild(bar);
                row.appendChild(barContainer);

                const valLabel = document.createElement('span');
                valLabel.style.cssText = `
                    color: var(--md-text);
                    font-size: 9px;
                    min-width: 34px;
                    text-align: right;
                    font-variant-numeric: tabular-nums;
                `;
                valLabel.textContent = Helpers.formatByType(val, s.format);
                row.appendChild(valLabel);

                group.appendChild(row);
            });

            container.appendChild(group);
        }

        if (categories.length > maxCategories) {
            const more = document.createElement('div');
            more.style.cssText = `
                color: var(--md-text-disabled);
                font-size: 10px;
                text-align: center;
                font-style: italic;
                margin-top: 4px;
            `;
            more.textContent = `и ещё ${categories.length - maxCategories} категорий...`;
            container.appendChild(more);
        }

        return container;
    },

    // Легенда категорий (цвет = категория, без значений - у мультисерийной
    // круговой одна категория может иметь РАЗНЫЕ значения на разных
    // кольцах, поэтому тут только имя + цвет, не число)
    buildCategoryLegend(categories, container, opts = {}) {
        container.innerHTML = '';
        const colors = this.getColors();
        const maxItems = opts.maxLegendItems ?? 12;

        if (categories.length === 0) {
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

        if (categories.length > 15) {
            const summary = document.createElement('div');
            summary.style.cssText = `
                color: var(--md-text-secondary);
                font-size: 11px;
                padding: 4px;
                text-align: center;
                width: 100%;
            `;
            summary.textContent = `${categories.length} категорий`;
            container.appendChild(summary);
            return;
        }

        const displayCats = categories.slice(0, maxItems);
        displayCats.forEach((cat, i) => {
            const item = document.createElement('div');
            item.style.cssText = `
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
            const swatch = document.createElement('span');
            swatch.style.cssText = `
                width: 8px;
                height: 8px;
                border-radius: 2px;
                background: ${colors[i % colors.length]};
                flex-shrink: 0;
            `;
            const label = document.createElement('span');
            label.textContent = cat;
            label.title = cat;
            label.style.cssText = `
                color: var(--md-text);
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            `;
            item.appendChild(swatch);
            item.appendChild(label);
            container.appendChild(item);
        });

        if (categories.length > maxItems) {
            const moreLabel = document.createElement('div');
            moreLabel.style.cssText = `
                color: var(--md-text-disabled);
                font-size: 10px;
                padding: 2px 6px;
                text-align: center;
                width: 100%;
                font-style: italic;
            `;
            moreLabel.textContent = `и еще ${categories.length - maxItems} ...`;
            container.appendChild(moreLabel);
        }
    },

    // Легенда серий (цвет = серия) - нужна линейчатой мультисерийной
    // диаграмме, где цвет полосы означает СЕРИЮ, а не категорию
    buildSeriesLegend(series, container) {
        container.innerHTML = '';
        const colors = this.getColors();

        if (series.length === 0) {
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

        series.forEach((s, i) => {
            const item = document.createElement('div');
            item.style.cssText = `
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
            const swatch = document.createElement('span');
            swatch.style.cssText = `
                width: 8px;
                height: 8px;
                border-radius: 2px;
                background: ${colors[i % colors.length]};
                flex-shrink: 0;
            `;
            const label = document.createElement('span');
            label.textContent = s.name || `Серия ${i + 1}`;
            label.title = label.textContent;
            label.style.cssText = `
                color: var(--md-text);
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            `;
            item.appendChild(swatch);
            item.appendChild(label);
            container.appendChild(item);
        });
    }
};
