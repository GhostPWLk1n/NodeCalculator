/**
 * SPDX-License-Identifier: MIT
 * SPDX-FileCopyrightText: 2024 NodeCalculate Team
 * SPDX-FileCopyrightText: 2024 Pavel Fomin
 *
 * @file    inspectorManager.js
 * @brief   Боковая панель настроек выбранной ноды (цвет, формат значения и т.п.)
 * @author  Pavel Fomin
 * @version 1.8.42
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

        // Раунд 90 - состояние свёрнутости живёт НА САМОЙ НОДЕ (не в
        // InspectorManager) - переживает повторные render() (те
        // случаются на каждое изменение поля), но не сериализуется -
        // чисто сессионное UI-удобство, не часть данных проекта.
        if (!node._inspectorCollapsed) node._inspectorCollapsed = {};

        let currentGroup = null; // {contentEl} - активная сворачиваемая секция, если есть
        schema.forEach(field => {
            if (field.type === 'section' && field.collapsible) {
                currentGroup = this._renderCollapsibleSection(node, field);
                this.bodyEl.appendChild(currentGroup.wrapper);
                return;
            }
            if (field.type === 'section') {
                currentGroup = null; // обычная (не сворачиваемая) секция сбрасывает группировку
            }
            const el = this.renderField(node, field);
            if (currentGroup) {
                currentGroup.contentEl.appendChild(el);
            } else {
                this.bodyEl.appendChild(el);
            }
        });
    }

    // Сворачиваемая секция (Раунд 90) - field.collapsed задаёт значение
    // ПО УМОЛЧАНИЮ только при первом рендере этой ноды за сессию; дальше
    // состояние хранится в node._inspectorCollapsed и не перезаписывается
    // схемой при последующих render(). Все поля МЕЖДУ этой секцией и
    // следующей 'section' (любой, не только сворачиваемой) уходят внутрь
    // contentEl - см. render() выше.
    _renderCollapsibleSection(node, field) {
        const key = field.label;
        if (!(key in node._inspectorCollapsed)) {
            node._inspectorCollapsed[key] = !!field.collapsed;
        }
        const collapsed = node._inspectorCollapsed[key];

        const wrapper = document.createElement('div');
        wrapper.className = 'inspector-section-group';

        const heading = document.createElement('div');
        heading.className = 'inspector-section-heading inspector-section-heading-collapsible';
        heading.addEventListener('mousedown', (e) => e.stopPropagation());
        heading.addEventListener('click', () => {
            node._inspectorCollapsed[key] = !node._inspectorCollapsed[key];
            this.render();
        });

        const arrow = document.createElement('span');
        arrow.className = 'inspector-section-arrow';
        arrow.textContent = collapsed ? '▸' : '▾';
        heading.appendChild(arrow);

        const labelEl = document.createElement('span');
        labelEl.textContent = field.label;
        heading.appendChild(labelEl);

        const contentEl = document.createElement('div');
        contentEl.className = 'inspector-section-content';
        if (collapsed) contentEl.style.display = 'none';

        wrapper.appendChild(heading);
        wrapper.appendChild(contentEl);

        return { wrapper, contentEl };
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

        // 'button' - разовое действие (например, "Импортировать выбранное"
        // у xlsxImportNode.js), а не значение для чтения/записи через
        // get()/set() - поэтому рендерится отдельно от обычных полей: без
        // подписи слева, кнопка на всю ширину. field.onClick может быть
        // асинхронным - панель просто ждёт и перерисовывается после,
        // чтобы отразить любые изменения схемы (например, новые чекбоксы
        // столбцов после того, как выбрали файл).
        if (field.type === 'button') {
            const btnRow = document.createElement('div');
            btnRow.className = 'inspector-field inspector-field-button-row';
            const btn = document.createElement('button');
            btn.className = 'inspector-action-btn';
            btn.textContent = field.label;
            if (field.disabled) btn.disabled = true;
            btn.addEventListener('mousedown', (e) => e.stopPropagation());
            btn.addEventListener('click', async (e) => {
                e.preventDefault();
                if (field.onClick) await field.onClick();
                this.render();
            });
            btnRow.appendChild(btn);
            return btnRow;
        }

        const row = document.createElement('div');
        row.className = 'inspector-field';

        const label = document.createElement('label');
        label.className = 'inspector-field-label';
        // Раунд 99 (по запросу Mr.D - "маленький квадратик с цветом
        // перед #HEX в ролях цветов, чтобы явно видеть о каком цвете
        // идёт речь") - общая возможность для ЛЮБОГО поля, не только
        // ролей цветов: field.swatchColor - если задан, перед текстом
        // подписи ставится маленький квадратик именно этого цвета.
        if (field.swatchColor) {
            const swatch = document.createElement('span');
            swatch.className = 'inspector-field-swatch';
            swatch.style.background = field.swatchColor;
            label.appendChild(swatch);
        }
        label.appendChild(document.createTextNode(field.label));
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
