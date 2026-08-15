/**
 * SPDX-License-Identifier: MIT
 * SPDX-FileCopyrightText: 2024 NodeCalculate Team
 * SPDX-FileCopyrightText: 2024 Pavel Fomin
 *
 * @file    inspectorManager.js
 * @brief   Боковая панель настроек выбранной ноды (цвет, формат значения и т.п.)
 * @author  Pavel Fomin
 * @version 1.8.69
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

        // Раунд 181 (по запросу Mr.D: "у нас есть блоки 'колонка' и
        // 'шапка', но они не выделены в отдельный блок - создадим для
        // них блоки") - currentSubsection - ВЛОЖЕННАЯ группировка
        // ВНУТРИ currentGroup (если есть) - в отличие от обычного
        // 'section' (см. ниже), НЕ сбрасывает currentGroup - можно
        // иметь несколько под-блоков подряд ВНУТРИ одной сворачиваемой
        // секции, не разрывая её.
        let currentGroup = null; // {contentEl} - активная сворачиваемая секция, если есть
        let currentSubsection = null; // {contentEl} - активный под-блок ВНУТРИ currentGroup, если есть
        schema.forEach(field => {
            if (field.type === 'section' && field.collapsible) {
                currentGroup = this._renderCollapsibleSection(node, field);
                this.bodyEl.appendChild(currentGroup.wrapper);
                currentSubsection = null;
                return;
            }
            if (field.type === 'section') {
                currentGroup = null; // обычная (не сворачиваемая) секция сбрасывает группировку
                currentSubsection = null;
            }
            if (field.type === 'subsection') {
                currentSubsection = this._renderSubsection(field);
                const target = currentGroup ? currentGroup.contentEl : this.bodyEl;
                target.appendChild(currentSubsection.wrapper);
                return;
            }
            const el = this.renderField(node, field);
            const target = currentSubsection ? currentSubsection.contentEl : (currentGroup ? currentGroup.contentEl : this.bodyEl);
            target.appendChild(el);
        });
    }

    // Раунд 181 - визуально обособленный под-блок ВНУТРИ уже
    // сворачиваемой секции (лёгкий фон, свой подзаголовок помельче) -
    // НЕ сворачиваемый сам по себе (для этого уже есть 'section' с
    // collapsible:true на ВЕРХНЕМ уровне) - просто визуальная
    // группировка родственных полей (например, всех колонок диаграммы
    // Ганта отдельно от всех строк шапки).
    _renderSubsection(field) {
        const wrapper = document.createElement('div');
        wrapper.className = 'inspector-subsection';

        const heading = document.createElement('div');
        heading.className = 'inspector-subsection-heading';
        heading.textContent = field.label;
        wrapper.appendChild(heading);

        const contentEl = document.createElement('div');
        contentEl.className = 'inspector-subsection-content';
        wrapper.appendChild(contentEl);

        return { wrapper, contentEl };
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
        // Раунд 180 (по жалобе Mr.D: "не нравится как сейчас сделаны
        // флажки в инспекторе, получается что на первой строке флажок,
        // на второй текст, давай сделаем и текст и флажок на одной
        // строке") - .inspector-field по умолчанию flex-column (подпись
        // сверху, контрол снизу - разумно для текстовых/числовых полей с
        // длинными подписями), но для ЧЕКБОКСА это лишняя высота без
        // пользы - подпись короткая, сам чекбокс крошечный. Отдельный
        // модификатор переводит ИМЕННО эту строку в горизонтальную
        // раскладку (подпись слева, флажок справа - тот же приём, что
        // уже привычен по чекбоксам в большинстве интерфейсов).
        if (field.type === 'checkbox') row.classList.add('inspector-field-inline');

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
            // Раунд 183 (по запросу Mr.D: "панель для ввода должна
            // появляться только если выбран соответствующий пункт") -
            // раньше select НЕ перерисовывал панель после смены
            // значения (в отличие от checkbox/colorRole и др.) - любое
            // ДРУГОЕ поле, зависящее от ТЕКУЩЕГО значения этого select
            // (см. periodPreset/customPeriodDays в ganttNode.js),
            // появлялось/исчезало бы только при СЛЕДУЮЩЕМ, случайном
            // перерендере панели, не сразу.
            input.addEventListener('change', (e) => {
                this.applyChange(node, field, e.target.value);
                this.render();
            });
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
        } else if (field.type === 'colorRole') {
            // Раунд 180/181 - [селектор цвета] (квадратик-образец в
            // подписи, field.swatchColor) - [пресет цвета] - [сброс].
            //
            // Раунд 182 (по жалобе Mr.D: "селектор цвета сейчас не
            // очень удобен... оставим выпадающий список и стрелку
            // сброс. В выпадающий список добавим пункт 'Свой цвет',
            // который будет вызывать селектор") - постоянно видимое
            // поле произвольного цвета (Раунд 180) убрано - занимало
            // место в строке ВСЕГДА, даже когда пользователь пользуется
            // только готовой палитрой. Вместо этого - ОТДЕЛЬНЫЙ пункт
            // "Свой цвет..." В САМОМ списке пресетов - выбор ИМЕННО
            // этого пункта программно открывает нативный выбор цвета
            // ОС/браузера (скрытый input[type=color], .click()) - поле
            // "появляется" ТОЛЬКО когда реально нужно.
            const presetSelect = document.createElement('select');
            presetSelect.className = 'inspector-field-input inspector-color-preset-select';
            const CUSTOM_OPTION_VALUE = '__custom__';
            const allOptions = [...(field.presetOptions || []), { value: CUSTOM_OPTION_VALUE, label: 'Свой цвет...' }];
            allOptions.forEach(opt => {
                const o = document.createElement('option');
                o.value = opt.value;
                o.textContent = opt.label;
                o.title = opt.label;
                // "Без цвета" и "Свой цвет..." - оба без осмысленной
                // заливки (у "Свой цвет..." нет ОДНОГО конкретного
                // цвета показать заранее) - текст явно видимый для
                // обоих, остальные - чистая заливка без текста.
                if (opt.value && opt.value !== CUSTOM_OPTION_VALUE) {
                    o.style.backgroundColor = opt.value;
                } else {
                    // Раунд 183 (по жалобе Mr.D: "в тёмной схеме 'Без
                    // цвета' и 'свой цвет' серый на сером - надо
                    // изменить цвет фона под текстом") - раньше менялся
                    // ТОЛЬКО цвет текста (var(--md-text-secondary)),
                    // фон оставался дефолтным системным - в тёмной теме
                    // это давало недостаточный контраст. var(--md-surface-3)
                    // (не -variant/-2 - заметно светлее фона самого
                    // select) + var(--md-text) (не -secondary - полный
                    // контраст, не приглушённый) - работает одинаково
                    // хорошо в обеих темах через CSS-переменные, без
                    // отдельного вычисления под каждую.
                    o.style.backgroundColor = 'var(--md-surface-3)';
                    o.style.color = 'var(--md-text)';
                }
                presetSelect.appendChild(o);
            });
            // field.getPreset() (см. ganttNode.js) теперь возвращает
            // '__custom__', если ТЕКУЩИЙ цвет не входит в готовую
            // палитру - список корректно показывает "Свой цвет..."
            // выбранным, когда активен именно произвольный цвет.
            const currentPresetValue = field.getPreset ? (field.getPreset() ?? '') : '';
            presetSelect.value = currentPresetValue;
            presetSelect.style.backgroundColor = (currentPresetValue && currentPresetValue !== CUSTOM_OPTION_VALUE)
                ? currentPresetValue
                : (currentPresetValue === CUSTOM_OPTION_VALUE ? ((field.getCustom ? field.getCustom() : null) || '') : '');
            presetSelect.addEventListener('mousedown', (e) => e.stopPropagation());
            presetSelect.addEventListener('change', (e) => {
                if (e.target.value === CUSTOM_OPTION_VALUE) {
                    // Скрытый input[type=color] - НЕ часть видимой
                    // строки, существует ровно на время выбора цвета.
                    // Должен побывать в DOM (append), чтобы .click()
                    // надёжно открывал нативный диалог во всех браузерах/
                    // Electron - убирается сразу после использования.
                    const hiddenColorInput = document.createElement('input');
                    hiddenColorInput.type = 'color';
                    hiddenColorInput.value = (field.getCustom ? field.getCustom() : null) || '#90caf9';
                    // Раунд 183 (по жалобе Mr.D: "селектор появляется в
                    // 0,0 экрана, должен ловить положение курсора") -
                    // без явных left/top position:fixed якорится в
                    // (0,0) - нативный диалог выбора цвета браузер/ОС
                    // открывает РЯДОМ С САМИМ ЭЛЕМЕНТОМ, поэтому именно
                    // ЕГО позиция и должна быть верной, не просто
                    // "где-то на экране". getBoundingClientRect() САМОГО
                    // select - надёжнее, чем ловить координаты клика
                    // (работает одинаково и для мыши, и для выбора
                    // клавиатурой, где отдельного клика вообще нет).
                    const selectRect = presetSelect.getBoundingClientRect();
                    hiddenColorInput.style.position = 'fixed';
                    hiddenColorInput.style.left = `${selectRect.left}px`;
                    hiddenColorInput.style.top = `${selectRect.top}px`;
                    hiddenColorInput.style.opacity = '0';
                    hiddenColorInput.style.pointerEvents = 'none';
                    hiddenColorInput.style.width = '0';
                    hiddenColorInput.style.height = '0';
                    document.body.appendChild(hiddenColorInput);
                    hiddenColorInput.addEventListener('input', (ev) => {
                        field.setCustom(ev.target.value);
                    });
                    hiddenColorInput.addEventListener('change', () => {
                        hiddenColorInput.remove();
                        this.render();
                    });
                    hiddenColorInput.click();
                } else {
                    field.setPreset(e.target.value);
                    this.render();
                }
            });
            controlRow.appendChild(presetSelect);

            const resetBtn = document.createElement('button');
            resetBtn.className = 'inspector-reset-btn';
            resetBtn.textContent = '↺';
            resetBtn.title = 'Сбросить (без цвета)';
            resetBtn.addEventListener('mousedown', (e) => e.stopPropagation());
            resetBtn.addEventListener('click', (e) => {
                e.preventDefault();
                field.setPreset('');
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
