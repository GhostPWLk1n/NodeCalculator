/**
 * SPDX-License-Identifier: MIT
 * SPDX-FileCopyrightText: 2024 NodeCalculate Team
 * SPDX-FileCopyrightText: 2024 Pavel Fomin
 *
 * @file    proxyNode.js
 * @brief   "Точка" - минимальный узел-прокси (reroute) для аккуратной прокладки соединений
 * @author  Pavel Fomin
 * @version 1.7.4
 * @see     https://github.com/GhostPWLk1n/NodeCalculator.git
 */

import { BaseNode } from './baseNode.js';
import { SocketFactory } from '../utils/socketFactory.js';

/**
 * ProxyNode ("Точка") - план 1.6.0, п.2: "Точка - Проксиспот для
 * организации соединений". По образцу Reroute-ноды в Blender - НЕ несёт
 * никакой вычислительной логики, просто промежуточная точка на пути
 * соединения, чтобы провести провод аккуратно (например, в обход других
 * нод), а не по прямой линии через весь холст.
 *
 * Вход и выход - оба universal ('any', см. socketFactory.js) - Точку
 * можно вставить в связь ЛЮБОГО рода (список/строка/таблица/bool/
 * изображение/обычное число), она не сужает совместимость.
 *
 * calculate() пробрасывает ВСЕ слои данных источника насквозь (value/
 * listData/resultListData/tableData) - тот же принцип, что у
 * DashboardNode в режиме без переопределения (см. её докстринг) - иначе
 * Точка "сломала" бы любую цепочку, где потребитель читает не просто
 * value, а конкретный слой (например, ChartNode читает tableData).
 *
 * ИЗВЕСТНОЕ ОГРАНИЧЕНИЕ - getDashboardWidget() НЕ пробрасывается. Если
 * протянуть Точку ПРЯМО перед нодой "Дашборд" (Точка -> Дашборд), виджет
 * на Доске не появится - тот же "не поддерживает Доску", что и у любой
 * другой ноды без своего getDashboardWidget() (OperationNode и т.п.).
 * Обходной путь простой - не ставить Точку сразу перед Дашбордом, она и
 * так больше нужна для аккуратной прокладки ГДЕ-ТО В СЕРЕДИНЕ длинной
 * связи, а не на последнем отрезке перед виджетом.
 *
 * render() ПОЛНОСТЬЮ переопределён (не использует createTitle()/
 * createContent() от BaseNode) - у Точки нет ни имени, ни тела с
 * настройками, ни сворачивания - только сама точка с сокетом слева и
 * справа. nodeManager.renderNode() тоже знает про этот тип (см.
 * nodeManager.js) - не добавляет ручку изменения размера, которая
 * такой ноде не нужна и не имеет смысла.
 */
export class ProxyNode extends BaseNode {
    constructor(id, type, x, y, config = {}) {
        super(id, type, x, y, config);
        this.inputs = 1;
        this.outputs = 1;
        this.inputSockets = [0];
        this.value = null;
    }

    getDisplayName() {
        return this.customName || 'Точка';
    }

    // По просьбе Mr.D - помечена как бета (Раунд 52 -> 53): совсем новая
    // нода с нестандартным render() (см. докстринг класса), и поведение
    // ещё может измениться, когда дойдёт очередь до панели инструментов
    // (п.1 плана 1.6.0) - там "добавить точку" будет опираться на эту же
    // ноду, возможно, немного другим способом её создания
    getStaticBadges() {
        return [{ type: 'beta', text: 'Экспериментальная нода - интерфейс и поведение могут ещё измениться' }];
    }

    render() {
        const container = document.createElement('div');
        container.className = 'proxy-node-container';

        const inSocket = SocketFactory.createSocket({
            nodeId: this.id, socketType: 'input', index: 0, isAny: true,
            title: 'Точка - промежуточная остановка для аккуратной прокладки провода'
        });
        container.appendChild(inSocket);

        const bridge = document.createElement('span');
        bridge.className = 'proxy-node-bridge';
        container.appendChild(bridge);

        const outSocket = SocketFactory.createSocket({
            nodeId: this.id, socketType: 'output', index: 0, isAny: true,
            title: 'Точка - промежуточная остановка для аккуратной прокладки провода'
        });
        container.appendChild(outSocket);

        return container;
    }

    calculate(nodeManager) {
        const connections = window.connectionManager?.getConnections() || [];
        const conn = connections.find(c => c.targetNodeId === this.id && c.targetSocket === 0);
        const src = conn ? nodeManager.getNode(conn.sourceNodeId) : null;

        // Пробрасываем ВСЕ слои данных источника - см. докстринг класса
        this.value = src?.value ?? null;
        this.listData = src?.listData;
        this.resultListData = src?.resultListData;
        this.tableData = src?.tableData;

        return this.value;
    }
}
