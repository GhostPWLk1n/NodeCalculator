/**
 * SPDX-License-Identifier: MIT
 * SPDX-FileCopyrightText: 2024 NodeCalculate Team
 * SPDX-FileCopyrightText: 2024 Pavel Fomin
 *
 * @file    baseNode.js
 * @brief   Базовый класс, от которого наследуются все ноды
 * @author  Pavel Fomin
 * @version 1.8.9
 * @see     https://github.com/GhostPWLk1n/NodeCalculator.git
 */

import { Constants } from '../utils/constants.js';
import { Helpers } from '../utils/helpers.js';

export class BaseNode {
    constructor(id, type, x, y, config = {}) {
        this.id = id;
        this.type = type;
        this.x = x;
        this.y = y;
        this.value = config.value !== undefined ? config.value : null;
        this.customName = config.customName || null;
        // Цвет ноды (акцентная полоска) - null = цвет темы по умолчанию.
        // Формат значения - null = 'number' (см. getValueFormat() ниже).
        // Оба поля редактируются из боковой панели (InspectorManager),
        // не из самой ноды - см. getInspectorSchema().
        this.color = config.color || null;
        this.valueFormat = config.valueFormat || null;
        this.inputs = 0;
        this.outputs = 0;
        this.maxInputs = Constants.DEFAULT_NODE_CONFIG?.maxInputs || 8;
        this.inputSockets = [];
        this.collapsed = config.collapsed || false;
        // Динамические бейджи (см. addBadge/clearBadge/getActiveBadge ниже) -
        // НЕ сериализуются: отражают текущее состояние графа, а не
        // сохраняемую настройку, пересчитываются заново при каждой загрузке
        this._badges = {};
    }
    
    getDisplayName() {
        const defaultName = Constants.TYPE_NAMES?.[this.type] || this.type;
        return this.customName || defaultName;
    }

    // Необязательный формат отображения значения ('number'|'currency'|'percent',
    // см. Constants.VALUE_FORMATS). Ноды, которым это важно, выставляют
    // this.valueFormat сами (например, из будущей панели настроек справа);
    // остальные ничего не переопределяют и получают дефолт 'number'.
    // Потребители (TableNode-колонка, PercentageNode) читают именно этот
    // метод, а не поле напрямую - так источник можно доработать позже,
    // ничего не меняя на стороне потребителей.
    getValueFormat() {
        return this.valueFormat || 'number';
    }

    // === Система бейджей (плашка над нодой) ===
    //
    // Два вида бейджей:
    //  - СТАТИЧЕСКИЕ - свойство типа ноды, не меняются в рантайме.
    //    Переопределяется в подклассе, например:
    //      getStaticBadges() { return [{ type: 'beta', text: 'Экспериментальная нода' }]; }
    //  - ДИНАМИЧЕСКИЕ - выставляются/снимаются в рантайме (обычно из
    //    calculate()) через addBadge(key, ...)/clearBadge(key). key нужен,
    //    чтобы разные проверки не затирали бейджи друг друга - например,
    //    у DashboardNode одновременно может быть статический 'beta' и
    //    динамический 'error' (несовместимый источник), они не должны
    //    друг друга перезаписывать.
    //
    // Если бейджей несколько одновременно - показывается только САМЫЙ
    // ВАЖНЫЙ (Constants.BADGE_PRIORITY: error > warning > beta/deprecated
    // > info), не все разом - иначе плашки в интерфейсе создавали бы шум.
    // См. getActiveBadge() - именно её читает renderer.syncNodeBadge().

    getStaticBadges() {
        return [];
    }

    addBadge(key, { type, text }) {
        this._badges = this._badges || {};
        this._badges[key] = { type, text };
    }

    clearBadge(key) {
        if (this._badges) delete this._badges[key];
    }

    getBadges() {
        return [...this.getStaticBadges(), ...Object.values(this._badges || {})];
    }

    // Единственный бейдж, который реально показывается в UI - самый
    // важный по Constants.BADGE_PRIORITY. При равном приоритете (beta
    // и deprecated оба = 2) побеждает первый в списке - статические
    // бейджи идут перед динамическими (см. getBadges()).
    getActiveBadge() {
        const badges = this.getBadges();
        if (badges.length === 0) return null;

        let best = null;
        let bestPriority = -1;
        for (const badge of badges) {
            const priority = Constants.BADGE_PRIORITY?.[badge.type] ?? 0;
            if (priority > bestPriority) {
                best = badge;
                bestPriority = priority;
            }
        }
        return best;
    }

    // Список полей боковой панели (InspectorManager). Базовый набор -
    // имя и цвет - доступен ЛЮБОЙ ноде без переопределения. Конкретные
    // ноды дополняют список своими полями, вызывая
    // super.getInspectorSchema() и добавляя к результату - см. пример
    // в numberNode.js (поле "Формат значения").
    //
    // Формат одного поля: { key, label, type, get(), set(value), ... }
    // type: 'text' | 'color' | 'select' (+options) | 'number' (+min/max/step) | 'checkbox'
    getInspectorSchema() {
        return [
            {
                key: 'customName',
                label: 'Имя',
                type: 'text',
                get: () => this.customName || '',
                set: (v) => { this.customName = (v && v.trim()) ? v.trim() : null; }
            },
            {
                key: 'color',
                label: 'Цвет узла',
                type: 'color',
                get: () => this.color,
                set: (v) => { this.color = v || null; }
            }
        ];
    }
    
    render() {
        const container = document.createElement('div');
        container.className = 'node-container';
        container.appendChild(this.createTitle());
        container.appendChild(this.createContent());
        return container;
    }
    
    createTitle() {
        const titleContainer = document.createElement('div');
        titleContainer.className = 'node-title';

        // === ПРОКСИ-СОКЕТЫ ЗАГОЛОВКА (видны только когда нода свёрнута) ===
        // Когда тело ноды скрыто, все входы/выходы визуально "стягиваются"
        // в одну точку слева/справа от заголовка - как в Blender.
        // ВАЖНО: прокси-сокеты добавляем ВНУТРЬ titleContainer, но
        // позиционируем их абсолютно относительно него.

        // Прокси-сокет для входов (слева)
        if (this.inputs > 0 || (this.inputSockets && this.inputSockets.length > 0)) {
            const titleInputSocket = document.createElement('div');
            titleInputSocket.className = 'socket title-input-socket';
            titleInputSocket.dataset.nodeId = this.id;
            titleInputSocket.dataset.socketType = 'input';
            titleInputSocket.dataset.index = 'proxy';
            titleInputSocket.dataset.isList = 'false';
            // Добавляем в начало заголовка
            titleContainer.appendChild(titleInputSocket);
        }

        // === КНОПКА СВОРАЧИВАНИЯ ===
        const collapseIcon = document.createElement('span');
        collapseIcon.className = 'collapse-icon';
        collapseIcon.textContent = this.collapsed ? '▸' : '▾';
        collapseIcon.title = this.collapsed ? 'Развернуть ноду' : 'Свернуть ноду';
        collapseIcon.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggleCollapse();
        });
        titleContainer.appendChild(collapseIcon);
        
        // Текст заголовка
        const titleText = document.createElement('span');
        titleText.className = 'title-text';
        titleText.textContent = this.getDisplayName();
        titleContainer.appendChild(titleText);
        
        // Иконка редактирования
        const editIcon = document.createElement('span');
        editIcon.className = 'edit-icon';
        editIcon.textContent = '✏️';
        titleContainer.appendChild(editIcon);

        // Прокси-сокет для выходов (справа)
        if (this.outputs > 0) {
            const titleOutputSocket = document.createElement('div');
            titleOutputSocket.className = 'socket title-output-socket';
            titleOutputSocket.dataset.nodeId = this.id;
            titleOutputSocket.dataset.socketType = 'output';
            titleOutputSocket.dataset.index = 'proxy';
            titleOutputSocket.dataset.isList = 'false';
            // Добавляем в конец заголовка (после иконки редактирования)
            titleContainer.appendChild(titleOutputSocket);
        }     
        
        // Логика редактирования
        let isEditing = false;
        
        const startEditing = () => {
            if (isEditing) return;
            isEditing = true;
            
            const currentName = this.getDisplayName();
            const input = document.createElement('input');
            input.className = 'title-input';
            input.type = 'text';
            input.value = currentName;
            
            titleText.style.display = 'none';
            titleContainer.insertBefore(input, editIcon);
            
            input.focus();
            input.select();
            
            const finishEditing = (save = true) => {
                if (save && input.value.trim()) {
                    this.customName = input.value.trim();
                    titleText.textContent = this.customName;
                    
                    document.getElementById('status').textContent = `✏️ Переименовано в "${this.customName}"`;
                    setTimeout(() => {
                        document.getElementById('status').textContent = 'Готово';
                    }, 1500);
                } else {
                    titleText.textContent = this.getDisplayName();
                }
                titleText.style.display = 'inline';
                input.remove();
                isEditing = false;
            };
            
            input.addEventListener('blur', () => finishEditing(true));
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    input.blur();
                }
                if (e.key === 'Escape') {
                    e.preventDefault();
                    finishEditing(false);
                }
            });
        };
        
        titleText.addEventListener('dblclick', startEditing);
        editIcon.addEventListener('click', (e) => {
            e.stopPropagation();
            startEditing();
        });
        
        return titleContainer;
    }

    // Сворачивает/разворачивает ноду до заголовка
    toggleCollapse() {
        this.collapsed = !this.collapsed;

        const el = document.querySelector(`[data-node-id="${this.id}"]`);
        if (el) {
            el.classList.toggle('collapsed', this.collapsed);

            const icon = el.querySelector('.collapse-icon');
            if (icon) {
                icon.textContent = this.collapsed ? '▸' : '▾';
                icon.title = this.collapsed ? 'Развернуть ноду' : 'Свернуть ноду';
            }
        }

        // Пересчитываем линии - при сворачивании они должны "прыгнуть"
        // на прокси-сокеты заголовка
        if (window.renderer) {
            window.renderer.drawAllConnections(window.connectionManager?.getConnections() || []);
        }
    }
    
    createContent() {
        throw new Error('Method createContent must be implemented by subclass');
    }
    
    calculate(nodeManager) {
        throw new Error('Method calculate must be implemented by subclass');
    }
    
    updateDisplay(element) {
        const valueDisplay = element.querySelector('.node-value-display');
        if (valueDisplay) {
            valueDisplay.textContent = Helpers.formatNumber(this.value);
        }
    }
    
    updateValueFromInput() {
        const el = document.querySelector(`[data-node-id="${this.id}"]`);
        if (el) {
            const input = el.querySelector('.number-input');
            if (input) {
                const val = parseFloat(input.value);
                if (!isNaN(val)) {
                    this.value = val;
                    return val;
                }
            }
        }
        return this.value;
    }

    // Раунд 84 - фундамент для НАСТОЯЩИХ многовыходных нод (по образцу
    // Blender - разные данные на разных выходах, а не декоративно разные
    // сокеты с одними и теми же данными). До этого раунда socketIndex
    // (conn.sourceSocket) использовался ТОЛЬКО для отрисовки линии в
    // правильном месте (см. renderer.js) - ни один потребитель нигде в
    // проекте не читал его для выбора данных, поэтому у уже существующих
    // многовыходных нод (OperationNode - "Результат"/"Кол-во"/"Список")
    // выходы, не совпадающие по РОДУ данных (напр. "Результат" и
    // "Кол-во" - оба скаляры), на практике неразличимы для потребителя -
    // тот в любом случае читает node.value и получает одно и то же
    // независимо от того, к какому из двух сокетов подключился.
    //
    // getOutputBySocket(index) - точка расширения: по умолчанию
    // возвращает ОДИН И ТОТ ЖЕ набор полей независимо от index (ровно
    // прежнее поведение, ничего не ломает ни для одной существующей
    // ноды). Ноды, которым нужны настоящие разные выходы (напр. новый
    // "Обработка таблиц Ганта"), переопределяют этот метод. Читается
    // через nodeManager.getSourceOutput(conn) - см. её докстринг в
    // nodeManager.js про то, в каких потребителях уже подключено.
    getOutputBySocket(index) {
        return {
            value: this.value,
            tableData: this.tableData,
            listData: this.listData,
            resultListData: this.resultListData
        };
    }
}
