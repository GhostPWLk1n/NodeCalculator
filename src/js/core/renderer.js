/**
 * SPDX-License-Identifier: MIT
 * SPDX-FileCopyrightText: 2024 NodeCalculate Team
 * SPDX-FileCopyrightText: 2024 Pavel Fomin
 *
 * @file    renderer.js
 * @brief   Отрисовка SVG-линий соединений и подсветка сокетов
 * @author  Pavel Fomin
 * @version 1.4.0
 * @see     https://github.com/GhostPWLk1n/NodeCalculator.git
 */

import { Helpers } from '../utils/helpers.js';

export class Renderer {
    constructor() {
        this.connectionLines = [];
    }

    // ============================================
    // КООРДИНАТЫ
    // ============================================
    // Вся система координат линий строится через offsetLeft/offsetTop
    // (layout-координаты), а НЕ через getBoundingClientRect().
    // Это даёт две вещи:
    //  1) координаты не зависят от прокрутки #workspace (в отличие от
    //     getBoundingClientRect, который во всех местах кода считался
    //     по-разному - отсюда и "соскакивание" линий);
    //  2) если в будущем добавить зум/пан через CSS transform на
    //     #nodesContainer, эти координаты останутся верными, т.к.
    //     offsetLeft/offsetTop не зависят от transform.

    getRelativePosition(el) {
        const container = document.getElementById('nodesContainer');
        if (!container) return { x: 0, y: 0 };

        let x = 0;
        let y = 0;
        let node = el;
        let guard = 0;

        while (node && node !== container && guard < 50) {
            x += node.offsetLeft;
            y += node.offsetTop;
            node = node.offsetParent;
            guard++;
        }

        return { x, y };
    }

    // Позиция сокета в координатах #nodesContainer.
    // Если нода свёрнута - подставляется "прокси"-сокет из заголовка.
    getSocketPosition(nodeId, socketType, socketIndex = 0) {
        const el = document.querySelector(`[data-node-id="${nodeId}"]`);
        if (!el) return null;

        let socketEl;

        // Если нода свёрнута - используем прокси-сокет из заголовка
        if (el.classList.contains('collapsed')) {
            socketEl = el.querySelector(`.title-${socketType}-socket`);
        } else {
            socketEl = el.querySelector(`.${socketType}-socket[data-index="${socketIndex}"]`);
        }

        if (!socketEl) return null;

        const pos = this.getRelativePosition(socketEl);

        return {
            x: pos.x + socketEl.offsetWidth / 2,
            y: pos.y + socketEl.offsetHeight / 2,
            isList: socketEl.dataset.isList === 'true',
            isCount: socketEl.classList.contains('socket-count'),
            kind: Helpers.getSocketKind(socketEl)
        };
    }

    // ============================================
    // SVG-СЛОЙ ДЛЯ ЛИНИЙ
    // ============================================
    // Один SVG живёт ВНУТРИ #nodesContainer (первым ребёнком), поэтому
    // двигается/масштабируется вместе с нодами один-в-один.

    ensureLinesSvg() {
        const container = document.getElementById('nodesContainer');
        if (!container) return null;

        let svg = document.getElementById('connectionsSvg');
        if (!svg) {
            svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            svg.id = 'connectionsSvg';
            svg.classList.add('connections-svg');
            svg.style.cssText = `
                position: absolute;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                pointer-events: none;
                overflow: visible;
                z-index: 1;
            `;
            container.insertBefore(svg, container.firstChild);
        }
        return svg;
    }

    // ============================================
    // ФОРМА ЛИНИИ (Blender-style noodle)
    // ============================================
    // Касательные всегда строго горизонтальны - именно это дает
    // характерную "лапшу" как в Blender, вместо кривой, что гуляет
    // по диагонали в зависимости от dx/dy.

    buildPathD(x1, y1, x2, y2) {
        const dx = x2 - x1;
        const offset = Math.max(Math.abs(dx) * 0.55, 40);
        const cp1x = x1 + offset;
        const cp1y = y1;
        const cp2x = x2 - offset;
        const cp2y = y2;
        return `M ${x1} ${y1} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${x2} ${y2}`;
    }

    strokeColorFor(meta = {}) {
        const kind = meta.kind || (meta.isList ? 'list' : meta.isCount ? 'count' : 'plain');
        switch (kind) {
            case 'list': return '#4fc3f7';
            case 'string': return '#64b5f6';
            case 'data': return '#ff8a65';
            case 'count': return '#a5d6a7';
            default: return '#90caf9';
        }
    }

    // Возвращает пару элементов: hitArea (невидимая, широкая - только для
    // попадания курсором/правым кликом) и path (видимая тонкая линия).
    // Разделение нужно, потому что попасть правой кнопкой мыши точно по
    // 2.5px линии неудобно - hitArea шире и прозрачна, реальный клик
    // ловит именно она; path остаётся чисто декоративной (pointer-events:none).
    createConnectionPath(x1, y1, x2, y2, meta = {}, conn = null) {
        const d = this.buildPathD(x1, y1, x2, y2);

        const hitArea = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        hitArea.setAttribute('class', 'connection-hitarea');
        hitArea.setAttribute('fill', 'none');
        hitArea.setAttribute('stroke', 'transparent');
        hitArea.setAttribute('stroke-width', '14');
        hitArea.setAttribute('d', d);
        hitArea.style.pointerEvents = 'stroke';
        hitArea.style.cursor = 'context-menu';

        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('class', 'connection-path');
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke', this.strokeColorFor(meta));
        path.setAttribute('stroke-width', '2.5');
        path.setAttribute('stroke-linecap', 'round');
        path.setAttribute('opacity', '0.85');
        path.setAttribute('d', d);
        path.style.pointerEvents = 'none';

        if (conn) {
            [hitArea, path].forEach(el => {
                el.dataset.sourceNodeId = conn.sourceNodeId;
                el.dataset.targetNodeId = conn.targetNodeId;
                el.dataset.targetSocket = conn.targetSocket ?? 0;
                el.dataset.sourceSocket = conn.sourceSocket ?? 0;
            });

            hitArea.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (window.connectionManager) {
                    window.connectionManager.showConnectionContextMenu(e.clientX, e.clientY, conn);
                }
            });

            // Лёгкая подсветка при наведении - видно, какую именно связь удалишь
            hitArea.addEventListener('mouseenter', () => {
                path.setAttribute('stroke-width', '4');
                path.setAttribute('opacity', '1');
            });
            hitArea.addEventListener('mouseleave', () => {
                path.setAttribute('stroke-width', '2.5');
                path.setAttribute('opacity', '0.85');
            });
        }

        return { hitArea, path };
    }

    // Временная линия (тянется за курсором при создании соединения)
    createTempPath(x1, y1, x2, y2) {
        const svg = this.ensureLinesSvg();
        if (!svg) return null;

        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('class', 'connection-path temp-path');
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke', '#ffb74d');
        path.setAttribute('stroke-width', '2.5');
        path.setAttribute('stroke-dasharray', '8, 4');
        path.setAttribute('stroke-linecap', 'round');
        path.setAttribute('opacity', '0.9');
        path.setAttribute('d', this.buildPathD(x1, y1, x2, y2));

        svg.appendChild(path);
        return path;
    }

    updatePathD(path, x1, y1, x2, y2) {
        if (!path) return;
        path.setAttribute('d', this.buildPathD(x1, y1, x2, y2));
    }

    // Убирает ВСЕ временные (пунктирные) линии из SVG, независимо от того,
    // есть ли на них живая JS-ссылка. Защита от "призрачных" линий -
    // например, если mouseup произошёл за пределами окна браузера и
    // обычный путь очистки (finishConnection/cancelConnection) не сработал.
    clearAllTempPaths() {
        const svg = document.getElementById('connectionsSvg');
        if (!svg) return;
        svg.querySelectorAll('path.temp-path').forEach(p => p.remove());
    }

    // ============================================
    // ОТРИСОВКА ВСЕХ СОЕДИНЕНИЙ
    // ============================================

    drawAllConnections(connections) {
        this.resetAllSockets();

        const svg = this.ensureLinesSvg();
        if (!svg) return;

        // Убираем только "постоянные" линии, временную (при перетаскивании) не трогаем
        svg.querySelectorAll('path.connection-path:not(.temp-path)').forEach(p => p.remove());
        svg.querySelectorAll('path.connection-hitarea').forEach(p => p.remove());
        this.connectionLines = [];

        connections.forEach(conn => {
            const sourceIndex = conn.sourceSocket || 0;
            const targetIndex = conn.targetSocket || 0;

            const startPos = this.getSocketPosition(conn.sourceNodeId, 'output', sourceIndex);
            const endPos = this.getSocketPosition(conn.targetNodeId, 'input', targetIndex);
            if (!startPos || !endPos) return;

            const { hitArea, path } = this.createConnectionPath(startPos.x, startPos.y, endPos.x, endPos.y, startPos, conn);
            svg.appendChild(hitArea);
            svg.appendChild(path);
            this.connectionLines.push(path);

            this.markSocketAsConnected(conn.sourceNodeId, 'output', sourceIndex);
            this.markSocketAsConnected(conn.targetNodeId, 'input', targetIndex);
        });
    }

    resetAllSockets() {
        document.querySelectorAll('.socket').forEach(socket => {
            socket.classList.remove('socket-connected');
            socket.style.background = '';
            socket.style.boxShadow = '';
            socket.style.borderColor = '';
        });
    }

    markSocketAsConnected(nodeId, socketType, socketIndex = 0) {
        const el = document.querySelector(`[data-node-id="${nodeId}"]`);
        if (!el) return;

        const targets = [];

        // Ищем реальный сокет
        const realSocket = el.querySelector(`.${socketType}-socket[data-index="${socketIndex}"]`);
        if (realSocket) {
            this.applySocketConnectedStyle(realSocket);
        }
        
        // Ищем прокси-сокет в заголовке (если нода свёрнута, он виден,
        // но подсвечиваем всегда, чтобы при сворачивании сразу было видно активные связи)
        const proxySocket = el.querySelector(`.title-${socketType}-socket`);
        if (proxySocket) {
            this.applySocketConnectedStyle(proxySocket);
        }
    }

    applySocketConnectedStyle(socket) {
        socket.classList.add('socket-connected');

        let bgColor, borderColor, shadowColor;

        if (socket.classList.contains('socket-list')) {
            bgColor = '#4fc3f7';
            borderColor = '#4fc3f7';
            shadowColor = 'rgba(79, 195, 247, 0.3)';
        } else if (socket.classList.contains('socket-string')) {
            bgColor = '#64b5f6';
            borderColor = '#64b5f6';
            shadowColor = 'rgba(100, 181, 246, 0.3)';
        } else if (socket.classList.contains('socket-data')) {
            bgColor = '#ff8a65';
            borderColor = '#ff8a65';
            shadowColor = 'rgba(255, 138, 101, 0.3)';
        } else if (socket.classList.contains('socket-count')) {
            bgColor = '#a5d6a7';
            borderColor = '#a5d6a7';
            shadowColor = 'rgba(165, 214, 167, 0.3)';
        } else {
            bgColor = '#9e9e9e';
            borderColor = '#9e9e9e';
            shadowColor = 'rgba(158, 158, 158, 0.3)';
        }

        socket.style.background = bgColor;
        socket.style.borderColor = borderColor;
        socket.style.boxShadow = `0 0 12px ${shadowColor}`;
    }

    updateAllDisplays() {
        document.querySelectorAll('.node').forEach(el => {
            const nodeId = parseInt(el.dataset.nodeId);
            const node = window.nodeManager?.getNode(nodeId);
            if (node && node.updateDisplay) {
                node.updateDisplay(el);
            }
        });
    }

    clearWorkspace() {
        const container = document.getElementById('nodesContainer');
        if (container) {
            container.innerHTML = '';
        }
        this.connectionLines = [];
    }
}
