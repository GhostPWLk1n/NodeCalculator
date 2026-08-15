/**
 * SPDX-License-Identifier: MIT
 * SPDX-FileCopyrightText: 2024 NodeCalculate Team
 * SPDX-FileCopyrightText: 2024 Pavel Fomin
 *
 * @file    boardPublish.js
 * @brief   Переиспользуемый "переключатель Доска" в инспекторе любой ноды - замена механики DashboardNode
 * @author  Pavel Fomin
 * @version 1.8.69
 * @see     https://github.com/GhostPWLk1n/NodeCalculator.git
 */

/**
 * boardPublish.js - Раунд 124 (релиз 1.8.0, по решению Mr.D: "механика
 * с нодой Дашборд плохо приживается... оставим, но упростим. Теперь
 * каждая нода, которая может представить себя на Дашборде, будет иметь
 * переключатель 'Доска' в инспекторе, там же можно указать, на каких
 * досках мы хотим видеть отображение этого узла").
 *
 * Пилотная реализация - StringNode и ExportXlsxNode (по прямому
 * указанию Mr.D: "для начала протестируем нововведения на узле Строка
 * и Экспорт в Excel"). Остальные типы нод НЕ подключены - см.
 * initBoardPublishFields()/buildBoardInspectorFields() ниже, любой
 * другой тип ноды может подключиться ТЕМИ ЖЕ ДВУМЯ вызовами.
 *
 * В отличие от DashboardNode (одна нода = одна доска, через
 * targetBoardId) - здесь узел может показываться СРАЗУ на нескольких
 * досках одновременно (см. boardManager.syncWidgetToBoards(), новый
 * метод именно под это). Стиль/позиция виджета настраиваются ПРЯМО в
 * инспекторе самой ноды - отдельного клика по виджету на Доске для
 * этого не требуется (хотя он тоже работает - см. boardManager.
 * selectWidget(), widgetId теперь совпадает с id САМОЙ ноды, не
 * посредника).
 */

// Раунд 124 - вызывается ОДИН РАЗ в конструкторе ноды (после super()),
// заводит поля состояния публикации на досках. config - тот же объект,
// что уже передаётся в конструктор ноды (сериализованные поля).
export function initBoardPublishFields(node, config) {
    node.showOnBoard = config.showOnBoard ?? false;
    node.boardIds = Array.isArray(config.boardIds) ? [...config.boardIds] : [];
    node.widgetStyle = config.widgetStyle ? { ...config.widgetStyle } : {};
    node.widgetLayout = config.widgetLayout ? { ...config.widgetLayout } : { colSpan: 12, rowSpan: null };
}

// Раунд 124 - синхронизирует виджет ноды с выбранными досками -
// вызывается из calculate() ноды (после того, как её собственное
// состояние/значение уже посчитано - виджет должен показывать
// СВЕЖИЕ данные). Требует, чтобы у ноды уже был метод
// getDashboardWidget(ctx) (тот же метод, что уже читает DashboardNode) -
// если его нет, ничего не делает (нода технически не "доскопригодна").
export function syncNodeToBoards(node) {
    if (!window.boardManager || typeof node.getDashboardWidget !== 'function') return;
    const targetIds = node.showOnBoard ? node.boardIds : [];
    // ctx пустой (в отличие от DashboardNode) - никакого отдельного
    // "переопределения" здесь нет, правки на Доске идут НАПРЯМУЮ в
    // саму ноду (см. StringNode.getDashboardWidget() - при отсутствии
    // ctx.onEdit падает на node.setValue()).
    const widget = node.getDashboardWidget({});
    window.boardManager.syncWidgetToBoards(node.id, targetIds, {
        type: widget.type,
        title: widget.title,
        render: widget.render,
        style: node.widgetStyle,
        layout: node.widgetLayout
    });
}

// Раунд 124 - поля инспектора: переключатель "Показывать на Досках" +
// список чекбоксов по одному на каждую существующую Доску + стиль
// виджета (тот же набор controls, что уже был у DashboardNode -
// размер/цвет/выравнивание). Собирается в отдельный сворачиваемый
// блок (field.collapsible, Раунд 90) - свёрнут по умолчанию, не
// каждой ноде это нужно видеть постоянно.
export function buildBoardInspectorFields(node) {
    const fields = [];

    fields.push({ type: 'section', label: '📌 Доска', collapsible: true, collapsed: true });

    fields.push({
        key: 'showOnBoard',
        label: 'Показывать на Досках',
        type: 'checkbox',
        get: () => node.showOnBoard,
        set: (v) => {
            node.showOnBoard = !!v;
            syncNodeToBoards(node);
        }
    });

    const boards = window.boardManager?.getAllBoards() || [];
    boards.forEach(board => {
        fields.push({
            key: `boardPublish_${board.id}`,
            label: board.name,
            type: 'checkbox',
            get: () => node.boardIds.includes(board.id),
            set: (v) => {
                const set = new Set(node.boardIds);
                if (v) set.add(board.id); else set.delete(board.id);
                node.boardIds = [...set];
                syncNodeToBoards(node);
            }
        });
    });

    fields.push({
        key: 'boardWidgetSize',
        label: 'Размер виджета',
        type: 'select',
        options: [
            { value: 'small', label: 'Маленький' },
            { value: 'medium', label: 'Средний' },
            { value: 'large', label: 'Большой' }
        ],
        get: () => node.widgetStyle.size || 'medium',
        set: (v) => { node.widgetStyle.size = v; syncNodeToBoards(node); }
    });

    fields.push({
        key: 'boardWidgetColor',
        label: 'Акцентный цвет виджета',
        type: 'color',
        get: () => node.widgetStyle.color || '#90caf9',
        set: (v) => { node.widgetStyle.color = v; syncNodeToBoards(node); }
    });

    fields.push({
        key: 'boardWidgetAlign',
        label: 'Выравнивание содержимого',
        type: 'select',
        options: [
            { value: 'left', label: 'По левому краю' },
            { value: 'center', label: 'По центру' },
            { value: 'right', label: 'По правому краю' }
        ],
        get: () => node.widgetStyle.align || 'left',
        set: (v) => { node.widgetStyle.align = v; syncNodeToBoards(node); }
    });

    return fields;
}
