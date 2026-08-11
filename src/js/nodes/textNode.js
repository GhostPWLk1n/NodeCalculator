/**
 * SPDX-License-Identifier: MIT
 * SPDX-FileCopyrightText: 2024 NodeCalculate Team
 * SPDX-FileCopyrightText: 2024 Pavel Fomin
 *
 * @file    textNode.js
 * @brief   Узел "Текст" - принимает данные любого типа, преобразует в строку, поддерживает Markdown
 * @author  Pavel Fomin
 * @version 1.8.58
 * @see     https://github.com/GhostPWLk1n/NodeCalculator.git
 */

/**
 * textNode.js - Раунд 127 (по чек-листу Mr.D - новый узел "Текст").
 *
 * В отличие от StringNode (чисто ВВОД - ручное поле, ничего не
 * принимает на вход) - TextNode ПРЕОБРАЗУЕТ данные ЛЮБОГО типа
 * (число/булево/строка/null) с ВХОДНОГО сокета в текстовое
 * представление на ВЫХОДНОМ. Поддерживает Markdown-рендер (см.
 * utils/markdown.js) для ПРЕДПРОСМОТРА в теле ноды - сам выходной
 * сокет всегда отдаёт СЫРОЙ текст (Markdown-разметку КАК ЕСТЬ, не
 * HTML) - потребители, которым нужен именно текст (Экспорт/другая
 * Строка и т.п.), получают ожидаемое, рендер - только для просмотра
 * прямо на диаграмме/Доске.
 */

import { BaseNode } from './baseNode.js';
import { SocketFactory } from '../utils/socketFactory.js';
import { renderMarkdown } from '../utils/markdown.js';
import { initBoardPublishFields, syncNodeToBoards, buildBoardInspectorFields } from '../utils/boardPublish.js';

export class TextNode extends BaseNode {
    constructor(id, type, x, y, config = {}) {
        super(id, type, x, y, config);
        this.inputs = 1;
        this.outputs = 1;
        this.inputSockets = [0];
        this.width = config.width || 240;
        this.collapsed = config.collapsed || false;

        // Раунд 127 (чек-лист, п.1.4) - режим отображения. Markdown -
        // ПО УМОЛЧАНИЮ включён (прямое требование чек-листа), не
        // "обычный текст", как можно было бы ожидать по инерции от
        // других нод.
        this.displayMode = config.displayMode === 'plain' ? 'plain' : 'markdown';

        // Преобразования входных данных (применяются к УЖЕ полученному
        // текстовому представлению, В ПОРЯДКЕ: trim -> регистр -> замена
        // спецсимволов - предсказуемый, единственный порядок, не
        // настраиваемый пользователем отдельно - усложнение, которого
        // чек-лист не просил).
        this.transformTrim = config.transformTrim ?? false;
        this.transformCase = (config.transformCase === 'lower' || config.transformCase === 'upper') ? config.transformCase : 'none';
        // "Замена спецсимволов" - неоднозначная формулировка в
        // чек-листе (чем именно заменять?) - реализовано как базовая
        // "очистка" (slugify-подобная): всё, что не буква/цифра/
        // пробел/базовая пунктуация - заменяется на "_". Разумная
        // трактовка для сценария "текст для имени файла/идентификатора".
        this.transformReplaceSpecial = config.transformReplaceSpecial ?? false;

        // Запасное значение, если вход не подключён или пришёл null/undefined.
        this.fallbackValue = config.fallbackValue ?? '';

        this.value = '';

        // Раунд 127 (релиз 1.8.0, механика Досок) - см. utils/boardPublish.js.
        initBoardPublishFields(this, config);
    }

    // Раунд 127 (чек-лист, п.1.2) - "если данные не текст -
    // преобразуются в строку". Числа/булевы - через String() напрямую
    // (не Helpers.formatNumber() - тот форматирует ПОД ОТОБРАЖЕНИЕ
    // числа с разделителями тысяч и т.п. - здесь нужно именно "то же
    // число текстом", без косметики). Объекты (на случай, если на
    // "любой" сокет случайно попадёт TableData/ListData и т.п.) -
    // JSON.stringify() как последний осмысленный fallback, не "[object
    // Object]".
    _toText(raw) {
        if (raw === null || raw === undefined || raw === '') {
            return raw === '' ? '' : this.fallbackValue;
        }
        if (typeof raw === 'string') return raw;
        if (typeof raw === 'number' || typeof raw === 'boolean') return String(raw);
        try {
            return JSON.stringify(raw);
        } catch {
            return String(raw);
        }
    }

    _applyTransforms(text) {
        let t = text;
        if (this.transformTrim) t = t.trim();
        if (this.transformCase === 'lower') t = t.toLowerCase();
        else if (this.transformCase === 'upper') t = t.toUpperCase();
        if (this.transformReplaceSpecial) {
            // \p{L}/\p{N} (Unicode-свойства "буква"/"число", флаг u) -
            // корректно захватывают и кириллицу, не только латиницу.
            t = t.replace(/[^\p{L}\p{N}\s.,!?()-]/gu, '_');
        }
        return t;
    }

    calculate(nodeManager) {
        const connections = window.connectionManager?.getConnections() || [];
        const conn = connections.find(c => c.targetNodeId === this.id && c.targetSocket === 0);
        const src = conn ? nodeManager.getNode(conn.sourceNodeId) : null;
        const output = conn ? nodeManager.getSourceOutput?.(conn) : null;

        // "Любой" вход - берём то, что реально осмысленно у источника:
        // сначала output.value (учитывает КОНКРЕТНЫЙ выходной сокет
        // многовыходной ноды, см. NODE_API.md про getSourceOutput()),
        // иначе - src.value напрямую (однозначный источник).
        let raw = null;
        if (src) {
            raw = (output && output.value !== undefined) ? output.value : src.value;
        }

        const rawText = this._toText(raw);
        this.value = this._applyTransforms(rawText);

        syncNodeToBoards(this);
        return this.value;
    }

    createContent() {
        const content = document.createElement('div');
        content.className = 'node-content';
        content.style.cssText = 'width:100%; min-width:200px; display:flex; flex-direction:column; gap:6px;';

        const inRow = document.createElement('div');
        inRow.style.cssText = 'display:flex; align-items:center; gap:6px;';
        const inSocket = SocketFactory.createSocket({
            nodeId: this.id, socketType: 'input', index: 0, isAny: true,
            title: 'Данные любого типа (число/булево/строка) - преобразуются в текст'
        });
        inRow.appendChild(inSocket);
        const inLabel = document.createElement('span');
        inLabel.style.cssText = 'color:var(--md-text-secondary); font-size:11px; flex:1;';
        inLabel.textContent = 'Вход (любой тип)';
        inRow.appendChild(inLabel);
        content.appendChild(inRow);

        const preview = document.createElement('div');
        preview.className = 'text-node-preview';
        preview.style.cssText = `
            max-height: 220px;
            overflow-y: auto;
            font-size: 12px;
            color: var(--md-text);
            background: var(--md-surface-2);
            border-radius: var(--md-radius);
            padding: 8px 10px;
            line-height: 1.5;
        `;
        content.appendChild(preview);
        this._updatePreview(preview);

        const outRow = document.createElement('div');
        outRow.style.cssText = 'display:flex; align-items:center; gap:8px; padding-top:4px; border-top:1px solid var(--md-divider);';
        const outLabel = document.createElement('span');
        outLabel.style.cssText = 'color:var(--md-text-secondary); font-size:11px; flex:1;';
        outLabel.textContent = 'Выход (текст)';
        outRow.appendChild(outLabel);
        const outSocket = SocketFactory.createSocket({
            nodeId: this.id, socketType: 'output', index: 0, isAny: false,
            title: 'Текстовое представление входных данных'
        });
        outRow.appendChild(outSocket);
        content.appendChild(outRow);

        return content;
    }

    // Раунд 127 - в Markdown-режиме показывает ОТРЕНДЕРЕННЫЙ HTML
    // (utils/markdown.js), в обычном - сырой текст без разметки. Тот
    // же метод переиспользуется и для тела ноды (updateDisplay()), и
    // для виджета на Доске (getDashboardWidget()) - единая точка,
    // чтобы предпросмотр на диаграмме и на Доске не могли разойтись.
    _updatePreview(el) {
        if (!el) return;
        if (this.displayMode === 'markdown') {
            el.innerHTML = renderMarkdown(this.value);
        } else {
            el.textContent = this.value;
        }
    }

    updateDisplay(element) {
        const preview = element.querySelector('.text-node-preview');
        this._updatePreview(preview);
    }

    // Раунд 127 (релиз 1.8.0, механика Досок) - виджет показывает ТОТ
    // ЖЕ предпросмотр (Markdown-рендер или сырой текст), что и на самой
    // диаграмме.
    getDashboardWidget() {
        return {
            type: 'text',
            title: this.customName || null,
            render: (container) => {
                const preview = document.createElement('div');
                preview.className = 'board-widget-text-preview';
                container.appendChild(preview);
                this._updatePreview(preview);
            }
        };
    }

    getInspectorSchema() {
        const fields = super.getInspectorSchema();

        fields.push({ type: 'section', label: 'Текст' });

        fields.push({
            key: 'displayMode',
            label: 'Режим отображения',
            type: 'select',
            options: [
                { value: 'markdown', label: 'Markdown' },
                { value: 'plain', label: 'Обычный текст' }
            ],
            get: () => this.displayMode,
            set: (v) => { this.displayMode = v === 'plain' ? 'plain' : 'markdown'; }
        });

        fields.push({
            key: 'transformTrim',
            label: 'Обрезка пробелов (trim)',
            type: 'checkbox',
            get: () => this.transformTrim,
            set: (v) => { this.transformTrim = !!v; if (window.nodeManager) window.nodeManager.calculateAll(); }
        });

        fields.push({
            key: 'transformCase',
            label: 'Регистр',
            type: 'select',
            options: [
                { value: 'none', label: 'Без изменений' },
                { value: 'lower', label: 'нижний регистр' },
                { value: 'upper', label: 'ВЕРХНИЙ РЕГИСТР' }
            ],
            get: () => this.transformCase,
            set: (v) => { this.transformCase = v; if (window.nodeManager) window.nodeManager.calculateAll(); }
        });

        fields.push({
            key: 'transformReplaceSpecial',
            label: 'Замена спецсимволов на "_"',
            type: 'checkbox',
            get: () => this.transformReplaceSpecial,
            set: (v) => { this.transformReplaceSpecial = !!v; if (window.nodeManager) window.nodeManager.calculateAll(); }
        });

        fields.push({
            key: 'fallbackValue',
            label: 'Запасное значение (если вход пуст)',
            type: 'text',
            get: () => this.fallbackValue,
            set: (v) => { this.fallbackValue = v ?? ''; if (window.nodeManager) window.nodeManager.calculateAll(); }
        });

        fields.push(...buildBoardInspectorFields(this));

        return fields;
    }
}
