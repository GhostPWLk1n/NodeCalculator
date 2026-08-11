/**
 * SPDX-License-Identifier: MIT
 * SPDX-FileCopyrightText: 2024 NodeCalculate Team
 * SPDX-FileCopyrightText: 2024 Pavel Fomin
 *
 * @file    imageNode.js
 * @brief   Загрузка локального изображения, вывод через отдельный Image-сокет
 * @author  Pavel Fomin
 * @version 1.8.58
 * @see     https://github.com/GhostPWLk1n/NodeCalculator.git
 */

import { BaseNode } from './baseNode.js';
import { SocketFactory } from '../utils/socketFactory.js';

// Мягкое предупреждение (не блокирует) - файл крупнее этого размера
// целиком уйдёт в .ncp как base64 (раздувается на ~33% против исходного
// размера файла) - для больших фото это заметно раздувает сам проект
const WARN_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5MB

/**
 * ImageNode ("Изображение") - Раунд 51, план 1.6.0 п.6. Источник (входов
 * нет, как у ListInputNode/XlsxImportNode) - выход отдельного рода Image
 * (ромб, бирюзовый, см. socketFactory.js) - НЕ через Data (см. запрос
 * Mr.D: "чтобы не передавать их через data"), чтобы потребители могли
 * явно отличить "это изображение" от "это таблица" на уровне типа
 * сокета, а не по содержимому.
 *
 * Картинка читается через FileReader.readAsDataURL() - результат
 * (data:image/...;base64,...) хранится целиком в this.dataUrl и
 * СЕРИАЛИЗУЕТСЯ целиком в .ncp (в отличие от XlsxImportNode, где
 * сериализуется только УЖЕ РАЗОБРАННЫЙ результат, а не сырые байты
 * файла - у изображения сырые байты И ЕСТЬ полезная нагрузка целиком,
 * разбирать их дальше не на что, поэтому кэшировать нечего отдельно от
 * самих байтов). Именно поэтому - предупреждение (не запрет) на крупные
 * файлы, см. WARN_FILE_SIZE_BYTES выше.
 *
 * Основной путь применения - ImageNode -> DashboardNode -> виджет на
 * Доске (см. getDashboardWidget() ниже) - "для оформления Досок", как и
 * просил Mr.D. DashboardNode ничего не знает о картинках конкретно -
 * его входной сокет уже universal (isAny), а его calculate() уже вызывает
 * getDashboardWidget() у ЛЮБОЙ подключённой ноды, у которой он есть -
 * специальной поддержки под Image добавлять в DashboardNode не пришлось.
 */
export class ImageNode extends BaseNode {
    constructor(id, type, x, y, config = {}) {
        super(id, type, x, y, config);
        this.outputs = 1;
        this.inputs = 0;
        this.inputSockets = [];
        this.width = config.width || 220;

        this.fileName = config.fileName || null;
        this.dataUrl = config.dataUrl || null;
        // 'cover'|'contain'|'fill' - как картинка вписывается в рамку
        // виджета на Доске (см. getInspectorSchema())
        this.objectFit = config.objectFit || 'contain';

        this.value = this.fileName;
    }

    createContent() {
        const content = document.createElement('div');
        content.className = 'node-content';
        content.style.cssText = 'width: 100%; min-width: 180px;';

        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = 'image/*';
        fileInput.style.display = 'none';
        fileInput.addEventListener('mousedown', (e) => e.stopPropagation());
        fileInput.addEventListener('change', (e) => {
            const file = e.target.files && e.target.files[0];
            e.target.value = ''; // чтобы повторный выбор ТОГО ЖЕ файла тоже сработал
            if (file) this._onFilePicked(file);
        });
        content.appendChild(fileInput);

        const pickBtn = document.createElement('button');
        pickBtn.className = 'xlsx-pick-btn'; // та же кнопка-пунктир, что у XlsxImportNode - переиспользуем стиль
        pickBtn.textContent = '🖼️ Выбрать изображение';
        pickBtn.addEventListener('mousedown', (e) => e.stopPropagation());
        pickBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            fileInput.click();
        });
        content.appendChild(pickBtn);

        const preview = document.createElement('div');
        preview.className = 'image-node-preview';
        this._renderPreview(preview);
        content.appendChild(preview);

        const fileNameEl = document.createElement('div');
        fileNameEl.className = 'xlsx-filename'; // тот же стиль строки с именем файла
        fileNameEl.textContent = this.fileName || 'файл не выбран';
        fileNameEl.title = this.fileName || '';
        content.appendChild(fileNameEl);

        const outRow = document.createElement('div');
        outRow.style.cssText = `
            display: flex;
            align-items: center;
            gap: 8px;
            padding-top: 6px;
            margin-top: 2px;
            border-top: 1px solid var(--md-divider);
        `;
        const outLabel = document.createElement('label');
        outLabel.textContent = 'Изображение:';
        outLabel.style.cssText = 'color:var(--md-text-secondary); font-size:11px; flex:1;';
        outRow.appendChild(outLabel);
        const outSocket = SocketFactory.createSocket({
            nodeId: this.id, socketType: 'output', index: 0, isImage: true,
            title: 'Image (изображение)'
        });
        outRow.appendChild(outSocket);
        content.appendChild(outRow);

        this._previewElement = preview;
        this._fileNameElement = fileNameEl;

        return content;
    }

    _renderPreview(container) {
        container.innerHTML = '';
        if (this.dataUrl) {
            const img = document.createElement('img');
            img.src = this.dataUrl;
            img.alt = this.fileName || 'изображение';
            container.appendChild(img);
            container.classList.remove('image-node-preview-empty');
        } else {
            const placeholder = document.createElement('span');
            placeholder.textContent = 'нет изображения';
            container.appendChild(placeholder);
            container.classList.add('image-node-preview-empty');
        }
    }

    async _onFilePicked(file) {
        this.fileName = file.name;
        this.dataUrl = null;

        const statusEl = document.getElementById('status');
        if (file.size > WARN_FILE_SIZE_BYTES) {
            const mb = (file.size / (1024 * 1024)).toFixed(1);
            if (statusEl) {
                statusEl.textContent = `⚠️ Файл ${mb}MB - целиком войдёт в проект, .ncp заметно раздуется`;
                setTimeout(() => { statusEl.textContent = 'Готово'; }, 3500);
            }
        }

        try {
            this.dataUrl = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result);
                reader.onerror = () => reject(reader.error || new Error('Не удалось прочитать файл'));
                reader.readAsDataURL(file);
            });
            this.value = this.fileName;
        } catch (err) {
            console.error('Ошибка чтения изображения:', err);
            alert('Не удалось загрузить изображение: ' + err.message);
            this.dataUrl = null;
        }

        if (window.nodeManager) window.nodeManager.calculateAll();
        const el = document.querySelector(`[data-node-id="${this.id}"]`);
        if (el) this.updateDisplay(el);
    }

    calculate() {
        this.value = this.fileName;
        return this.value;
    }

    updateDisplay(element) {
        if (!element) return;
        const preview = element.querySelector('.image-node-preview');
        if (preview) this._renderPreview(preview);

        const fileNameEl = element.querySelector('.xlsx-filename');
        if (fileNameEl) {
            fileNameEl.textContent = this.fileName || 'файл не выбран';
            fileNameEl.title = this.fileName || '';
        }
    }

    // Виджет Доски (см. dashboardNode.js/boardManager.js) - сама картинка,
    // вписанная в рамку виджета по this.objectFit. Только просмотр -
    // сменить изображение можно только выбором нового файла в теле ноды
    // (в отличие от Числа/Строки/Булево, тут нечего "печатать" в поле на
    // Доске - ctx.onEdit тут не пригодился бы).
    getDashboardWidget() {
        const node = this;
        return {
            type: 'image',
            title: this.customName || null,
            render: (container) => {
                if (!node.dataUrl) {
                    const empty = document.createElement('div');
                    empty.className = 'board-widget-image-empty';
                    empty.textContent = 'нет изображения';
                    container.appendChild(empty);
                    return;
                }
                const img = document.createElement('img');
                img.className = 'board-widget-image';
                img.src = node.dataUrl;
                img.alt = node.fileName || 'изображение';
                img.style.objectFit = node.objectFit;
                container.appendChild(img);
            }
        };
    }

    getInspectorSchema() {
        const fields = super.getInspectorSchema();

        fields.push({ type: 'section', label: 'Изображение' });

        fields.push({
            key: 'objectFit',
            label: 'Вписывание в рамку на Доске',
            type: 'select',
            options: [
                { value: 'contain', label: 'Целиком (Contain)' },
                { value: 'cover', label: 'Заполнить (Cover, обрезка по краям)' },
                { value: 'fill', label: 'Растянуть (Fill)' }
            ],
            get: () => this.objectFit,
            set: (v) => { this.objectFit = v; window.boardManager?.renderActiveBoard(); }
        });

        return fields;
    }
}
