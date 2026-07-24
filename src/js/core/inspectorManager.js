/**
 * SPDX-License-Identifier: MIT
 * SPDX-FileCopyrightText: 2024 NodeCalculate Team
 * SPDX-FileCopyrightText: 2024 Pavel Fomin
 *
 * @file    inspectorManager.js
 * @brief   Боковая панель настроек выбранной ноды (цвет, формат значения и т.п.)
 * @author  Pavel Fomin
 * @version 1.4.0
 * @see     https://github.com/GhostPWLk1n/NodeCalculator.git
 */

/**
 * InspectorManager - правая боковая панель, открывается когда нода в
 * фокусе (выбрана кликом, см. nodeManager.selectNode) и подстраивается
 * под её тип: рисует поля из node.getInspectorSchema() (см. baseNode.js).
 *
 * Задача панели - вынести тонкую настройку (цвет, формат значения и
 * т.п.) из самой ноды, чтобы нода оставалась компактной и не
 * перегружалась контролами, которые нужны не постоянно, а изредка.
 *
 * Панель ничего не знает о конкретных типах нод - она просто рендерит
 * схему полей, которую вернула сама нода. Любая нода может добавить
 * свои поля, переопределив getInspectorSchema() (обычно вызывая
 * super.getInspectorSchema() и дописывая к результату) - см. пример
 * в numberNode.js (поле "Формат значения").
 */
export class InspectorManager {
    constructor() {
        this.activeNode = null;
        this.panelEl = null;
        this.titleEl = null;
        this.bodyEl = null;
    }

    init() {
        this.panelEl = document.getElementById('inspectorPanel');
        this.titleEl = document.getElementById('inspectorTitle');
        this.bodyEl = document.getElementById('inspectorBody');
    }

    isOpenFor(nodeId) {
        return !!this.activeNode && this.activeNode.id === nodeId;
    }

    open(node) {
        if (!this.panelEl) this.init();
        if (!this.panelEl || !node) return;
        this.activeNode = node;
        this.render();
        this.panelEl.classList.add('open');
    }

    close() {
        if (!this.panelEl) this.init();
        this.activeNode = null;
        if (this.panelEl) this.panelEl.classList.remove('open');
    }

    // Перерисовывает панель для уже открытой ноды (например, после
    // переименования из другого места - двойной клик по заголовку ноды)
    refresh() {
        if (this.activeNode) this.render();
    }

    render() {
        if (!this.bodyEl || !this.activeNode) return;
        const node = this.activeNode;

        if (this.titleEl) {
            this.titleEl.textContent = typeof node.getDisplayName === 'function'
                ? node.getDisplayName()
                : (node.type || 'Нода');
        }

        this.bodyEl.innerHTML = '';

        const schema = typeof node.getInspectorSchema === 'function'
            ? node.getInspectorSchema()
            : [];

        if (!schema || schema.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'inspector-empty';
            empty.textContent = 'У этой ноды нет настроек';
            this.bodyEl.appendChild(empty);
            return;
        }

        schema.forEach(field => {
            this.bodyEl.appendChild(this.renderField(node, field));
        });
    }

    renderField(node, field) {
        // 'section' - просто заголовок-разделитель, без label/control -
        // группирует соседние поля (например, настройки одного столбца
        // таблицы) визуально, без изменения формата схемы для остальных типов
        if (field.type === 'section') {
            const heading = document.createElement('div');
            heading.className = 'inspector-section-heading';
            heading.textContent = field.label;
            return heading;
        }

        const row = document.createElement('div');
        row.className = 'inspector-field';

        const label = document.createElement('label');
        label.className = 'inspector-field-label';
        label.textContent = field.label;
        row.appendChild(label);

        const controlRow = document.createElement('div');
        controlRow.className = 'inspector-field-control';

        if (field.type === 'select') {
            const input = document.createElement('select');
            input.className = 'inspector-field-input';
            (field.options || []).forEach(opt => {
                const o = document.createElement('option');
                o.value = opt.value;
                o.textContent = opt.label;
                input.appendChild(o);
            });
            input.value = field.get() ?? '';
            input.addEventListener('mousedown', (e) => e.stopPropagation());
            input.addEventListener('change', (e) => this.applyChange(node, field, e.target.value));
            controlRow.appendChild(input);
        } else if (field.type === 'color') {
            const current = field.get();
            const input = document.createElement('input');
            input.type = 'color';
            input.className = 'inspector-field-input inspector-color-input';
            input.value = current || '#4fc3f7';
            input.addEventListener('mousedown', (e) => e.stopPropagation());
            input.addEventListener('input', (e) => this.applyChange(node, field, e.target.value));
            controlRow.appendChild(input);

            const resetBtn = document.createElement('button');
            resetBtn.className = 'inspector-reset-btn';
            resetBtn.textContent = '↺';
            resetBtn.title = 'Сбросить к цвету темы по умолчанию';
            resetBtn.addEventListener('mousedown', (e) => e.stopPropagation());
            resetBtn.addEventListener('click', (e) => {
                e.preventDefault();
                this.applyChange(node, field, null);
                this.render();
            });
            controlRow.appendChild(resetBtn);
        } else if (field.type === 'checkbox') {
            const input = document.createElement('input');
            input.type = 'checkbox';
            input.className = 'inspector-field-input';
            input.checked = !!field.get();
            input.addEventListener('mousedown', (e) => e.stopPropagation());
            input.addEventListener('change', (e) => this.applyChange(node, field, e.target.checked));
            controlRow.appendChild(input);
        } else if (field.type === 'number') {
            const input = document.createElement('input');
            input.type = 'number';
            input.className = 'inspector-field-input';
            if (field.min !== undefined) input.min = field.min;
            if (field.max !== undefined) input.max = field.max;
            if (field.step !== undefined) input.step = field.step;
            input.value = field.get() ?? '';
            input.addEventListener('mousedown', (e) => e.stopPropagation());
            input.addEventListener('input', (e) => {
                const val = e.target.value === '' ? null : parseFloat(e.target.value);
                this.applyChange(node, field, val);
            });
            controlRow.appendChild(input);
        } else if (field.type === 'date') {
            const input = document.createElement('input');
            input.type = 'date';
            input.className = 'inspector-field-input';
            input.value = field.get() || '';
            input.addEventListener('mousedown', (e) => e.stopPropagation());
            input.addEventListener('change', (e) => this.applyChange(node, field, e.target.value));
            controlRow.appendChild(input);
        } else {
            // 'text' по умолчанию
            const input = document.createElement('input');
            input.type = 'text';
            input.className = 'inspector-field-input';
            input.value = field.get() ?? '';
            input.addEventListener('mousedown', (e) => e.stopPropagation());
            input.addEventListener('input', (e) => this.applyChange(node, field, e.target.value));
            controlRow.appendChild(input);
        }

        row.appendChild(controlRow);
        return row;
    }

    applyChange(node, field, value) {
        field.set(value);
        this.afterChange(node);
    }

    // Общая точка после любого изменения из панели: перерисовываем
    // визуал самой ноды (цвет/имя могли поменяться), пересчитываем граф.
    afterChange(node) {
        const el = document.querySelector(`[data-node-id="${node.id}"]`);
        if (el && window.nodeManager?.applyNodeColor) {
            window.nodeManager.applyNodeColor(node, el);
        }
        if (el) {
            const titleText = el.querySelector('.title-text');
            if (titleText && document.activeElement !== titleText && typeof node.getDisplayName === 'function') {
                titleText.textContent = node.getDisplayName();
            }
        }
        if (this.titleEl && typeof node.getDisplayName === 'function') {
            this.titleEl.textContent = node.getDisplayName();
        }

        if (window.nodeManager) window.nodeManager.calculateAll();
        if (window.renderer) window.renderer.updateAllDisplays();
    }
}
