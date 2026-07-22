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
        this.inputs = 0;
        this.outputs = 0;
        this.maxInputs = Constants.DEFAULT_NODE_CONFIG?.maxInputs || 8;
        this.inputSockets = [];
        this.collapsed = config.collapsed || false;
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
}
