/**
 * SPDX-License-Identifier: MIT
 * SPDX-FileCopyrightText: 2024 NodeCalculate Team
 * SPDX-FileCopyrightText: 2024 Pavel Fomin
 *
 * @file    textNode.js
 * @brief   Узел "Текст" - шаблон с тегами {{socket-N}}, ссылающимися на подключённые данные, MD-форматирование
 * @author  Pavel Fomin
 * @version 1.8.94
 * @see     https://github.com/GhostPWLk1n/NodeCalculator.git
 */

/**
 * textNode.js - Раунд 127 (первая версия - простой конвертер "любой
 * тип -> текст"). Раунд 200 (по запросу Mr.D: "мы начали делать
 * текстовый блок... давай доделаем его, и сделаем оформление через
 * этот блок... у него вход any мы подключаем к нему таблицу. Блок
 * смотрит подключенные данные и даёт возможность их вставить через
 * теги. Например soket-1, чтобы не вручную всегда писать сокеты, они
 * должны появляться в оформительском меню") - ПЕРЕРАБОТКА: из "просто
 * прохода значения единственного входа" в ШАБЛОНИЗАТОР - пользователь
 * ПЕЧАТАЕТ произвольный текст (шапку/заголовок отчёта и т.п.) с
 * ВСТАВЛЕННЫМИ тегами вида {{socket-0}}/{{socket-1:Название строки}},
 * которые при пересчёте заменяются на реальные значения подключённых
 * источников. ДИНАМИЧЕСКОЕ число входов (та же схема, что у
 * OperationNode/QuarterAggregatorNode - checkAndAddEmptySlot()) -
 * подключаем сколько угодно источников, каждый доступен под своим
 * тегом.
 *
 * ОБРАТНАЯ СОВМЕСТИМОСТЬ: старые сохранённые проекты (без this.template
 * в config) получают шаблон по умолчанию "{{socket-0}}" -
 * ВОСПРОИЗВОДИТ старое поведение Раунда 127 (просто текст единственного
 * входа) ЧЕРЕЗ НОВЫЙ, единый механизм - отдельной "старой" ветки кода
 * не существует, разбор шаблона всегда один и тот же путь.
 *
 * ФОРМАТ ТЕГА: {{socket-N}} - "сырое" значение источника, подключённого
 * к N-му входу (то же src.value/output.value, что читал старый
 * TextNode). {{socket-N:Название строки}} - ЕСЛИ источник отдаёт
 * tableData (например, "Блок-Секция"/"Квартал. Сводный ТЭП"/любая
 * другая табличная нода) - ищет строку, где ПЕРВЫЙ столбец совпадает с
 * "Название строки" (точное совпадение по тексту), возвращает значение
 * ВТОРОГО столбца этой строки - тот же принцип, что использует
 * VLOOKUP в присланном Mr.D примере итоговой таблицы (Раунд 199) -
 * "найти строку по названию показателя, взять значение из соседнего
 * столбца".
 */

import { BaseNode } from './baseNode.js';
import { SocketFactory } from '../utils/socketFactory.js';
import { renderMarkdown } from '../utils/markdown.js';
import { initBoardPublishFields, syncNodeToBoards, buildBoardInspectorFields } from '../utils/boardPublish.js';

const TAG_RE = /\{\{socket-(\d+)(?::([^}]+))?\}\}/g;

export class TextNode extends BaseNode {
    constructor(id, type, x, y, config = {}) {
        super(id, type, x, y, config);
        this.inputs = 1;
        // Раунд 200 - динамическое число входов (см. checkAndAddEmptySlot()
        // ниже) - сохраняется явно (не просто [0,1,...length-1] по
        // порядку) на случай, если пользователь когда-нибудь получит
        // возможность удалять КОНКРЕТНЫЙ слот из середины (сейчас такой
        // кнопки нет, но формат сериализации уже готов под неё).
        this.inputSockets = Array.isArray(config.inputSockets) && config.inputSockets.length
            ? [...config.inputSockets] : [0];
        this.maxInputs = 12;
        this.outputs = 1;
        this.width = config.width || 320;
        this.collapsed = config.collapsed || false;
        this._isRerendering = false;

        this.displayMode = config.displayMode === 'plain' ? 'plain' : 'markdown';

        this.transformTrim = config.transformTrim ?? false;
        this.transformCase = (config.transformCase === 'lower' || config.transformCase === 'upper') ? config.transformCase : 'none';
        this.transformReplaceSpecial = config.transformReplaceSpecial ?? false;
        this.fallbackValue = config.fallbackValue ?? '';

        // Раунд 200 - шаблон с тегами - см. докстринг класса про формат
        // и обратную совместимость.
        this.template = config.template ?? '{{socket-0}}';

        // Раунд 203 (по запросу Mr.D: "хотелось бы добавить чтобы можно
        // было скрывать окно разметки, и наоборот") - НЕЗАВИСИМЫЕ флаги
        // видимости - персистентны (сохраняются в проект), пользователь
        // может скрыть ЛЮБУЮ из двух панелей (или обе - НЕ запрещаем
        // это принудительно, редактирование ВСЁ РАВНО остаётся
        // доступно из панели "Просмотр" в режиме правки, см.
        // _previewEditMode ниже - она НЕ персистентна, сбрасывается на
        // "показ отрендеренного" при каждой новой сессии, разумный
        // дефолт).
        // Раунд 203 - попытка сделать панели скрываемыми (showMarkup/
        // showPreview) и редактируемыми ОБЕ (_previewEditMode) - ОТКАТ
        // в Раунде 204 (по жалобе Mr.D: "улучшения создали непредвиденные
        // ошибки... уберём редактирование в окне просмотра, она создаёт
        // баги и просто дублирует окно разметки") - обратно к простой,
        // всегда видимой паре "Разметка"/"Просмотр". Вместо скрытия -
        // РЕСАЙЗ (по тому же запросу: "добавим хендлер для изменения
        // размера окон... чтобы можно было давать больше размера в
        // одно или другое") - height ОБЕИХ панелей персистентен. Раунд
        // 206 (по жалобе Mr.D: "нужны более удобные ручка, на всю
        // ширину, чтобы не искать её в углу") - нативный
        // resize:vertical (маленький захват ТОЛЬКО в углу) заменён на
        // собственную ручку во всю ширину панели (см. _makeResizeHandle()
        // ниже).
        this.templateHeight = config.templateHeight ?? null;
        this.previewHeight = config.previewHeight ?? null;

        this.value = '';

        initBoardPublishFields(this, config);
    }

    // Раунд 201 (по запросу Mr.D: "давай добавим узлу полноэкранный
    // режим") - механизм уже полностью общий (BaseNode.supportsFullscreen()/
    // window.expandNodeFullscreen(), Раунд 190) - здесь только
    // "включаем" кнопку для этого типа ноды.
    supportsFullscreen() {
        return true;
    }

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
            t = t.replace(/[^\p{L}\p{N}\s.,!?()-]/gu, '_');
        }
        return t;
    }

    // Раунд 200 - находит строку table по точному совпадению ПЕРВОГО
    // столбца, возвращает значение ВТОРОГО - см. докстринг класса про
    // формат тега {{socket-N:Название}}.
    _lookupTableRow(tableData, rowLabel) {
        if (!tableData || !tableData.columns || tableData.columns.length < 2) return null;
        const keyCol = tableData.columns[0];
        const valCol = tableData.columns[1];
        for (let i = 0; i < tableData.rowCount; i++) {
            const key = keyCol.values[i];
            if (key !== null && key !== undefined && String(key).trim() === rowLabel.trim()) {
                return valCol.values[i];
            }
        }
        return null;
    }

    // Раунд 200 - разбирает this.template, заменяя КАЖДЫЙ тег
    // {{socket-N}}/{{socket-N:Название}} на реальное значение
    // подключённого источника - см. докстринг класса.
    _resolveTemplate(nodeManager) {
        const connections = window.connectionManager?.getConnections() || [];
        return String(this.template || '').replace(TAG_RE, (match, idxStr, rowLabel) => {
            const socketIndex = parseInt(idxStr, 10);
            const conn = connections.find(c => c.targetNodeId === this.id && c.targetSocket === socketIndex);
            if (!conn) return this.fallbackValue;
            const src = nodeManager.getNode(conn.sourceNodeId);
            if (!src) return this.fallbackValue;
            const output = nodeManager.getSourceOutput?.(conn);

            if (rowLabel) {
                const val = this._lookupTableRow(output?.tableData, rowLabel);
                return this._toText(val);
            }
            const raw = (output && output.value !== undefined) ? output.value : src.value;
            return this._toText(raw);
        });
    }

    calculate(nodeManager) {
        const resolved = this._resolveTemplate(nodeManager);
        this.value = this._applyTransforms(resolved);
        syncNodeToBoards(this);
        return this.value;
    }

    // Раунд 200 - та же схема, что у OperationNode/QuarterAggregatorNode
    // (см. их докстринги/NODE_API.md раздел 9) - добавляет свободный
    // вход, когда ВСЕ текущие заняты.
    checkAndAddEmptySlot() {
        if (this.collapsed) return;
        if (this.inputSockets.length >= this.maxInputs) return;
        const connections = window.connectionManager?.getConnections() || [];
        const usedSockets = connections.filter(c => c.targetNodeId === this.id).map(c => c.targetSocket);
        const freeSockets = this.inputSockets.filter(idx => !usedSockets.includes(idx));
        if (freeSockets.length === 0) {
            const newIndex = this.inputSockets.length ? Math.max(...this.inputSockets) + 1 : 0;
            this.inputSockets.push(newIndex);
            this.inputs = this.inputSockets.length;
            setTimeout(() => {
                if (!this._isRerendering && !this.collapsed) this.rerender();
            }, 50);
        }
    }

    rerender() {
        if (this._isRerendering) return;
        this._isRerendering = true;
        const el = document.querySelector(`[data-node-id="${this.id}"]`);
        if (el) {
            el.remove();
            if (window.nodeManager) {
                window.nodeManager.renderNode(this);
                if (window.renderer) window.renderer.drawAllConnections(window.connectionManager?.getConnections() || []);
            }
        }
        setTimeout(() => { this._isRerendering = false; }, 100);
    }

    // Раунд 200 (по запросу Mr.D: "блок смотрит подключенные данные и
    // даёт возможность их вставить через теги... они должны появляться
    // в оформительском меню") - список ДОСТУПНЫХ тегов на основе
    // ТЕКУЩИХ подключений - для каждого подключённого входа: сам тег
    // "{{socket-N}}" (сырое значение), плюс, если источник отдаёт
    // table - по одному пункту на КАЖДУЮ строку этой таблицы (тег
    // "{{socket-N:НазваниеСтроки}}").
    _availableTags() {
        if (!window.nodeManager) return [];
        const connections = window.connectionManager?.getConnections() || [];
        const tags = [];
        this.inputSockets.forEach(socketIndex => {
            const conn = connections.find(c => c.targetNodeId === this.id && c.targetSocket === socketIndex);
            if (!conn) return;
            const src = window.nodeManager.getNode(conn.sourceNodeId);
            if (!src) return;
            const label = src.customName || src.getDisplayName?.() || `вход ${socketIndex}`;
            const output = window.nodeManager.getSourceOutput?.(conn);

            tags.push({ tag: `{{socket-${socketIndex}}}`, label: `socket-${socketIndex}: ${label} (значение)` });

            const t = output?.tableData;
            if (t && t.columns.length >= 2) {
                const keyCol = t.columns[0];
                for (let i = 0; i < t.rowCount; i++) {
                    const key = keyCol.values[i];
                    if (key === null || key === undefined || String(key).trim() === '') continue;
                    const rowLabel = String(key).trim();
                    tags.push({ tag: `{{socket-${socketIndex}:${rowLabel}}}`, label: `socket-${socketIndex}: ${rowLabel}` });
                }
            }
        });
        return tags;
    }

    // Раунд 201 - общая точка получения "выхода источника" для
    // конкретного входного сокета - переиспользуется и проверкой
    // "показывать ли кнопку 📋" (_socketHasTableData), и самой
    // генерацией таблицы (_generateTableTemplate) - не дублирует поиск
    // соединения/источника в двух местах.
    _getSocketOutput(socketIndex) {
        if (!window.nodeManager) return null;
        const connections = window.connectionManager?.getConnections() || [];
        const conn = connections.find(c => c.targetNodeId === this.id && c.targetSocket === socketIndex);
        if (!conn) return null;
        const src = window.nodeManager.getNode(conn.sourceNodeId);
        if (!src) return null;
        return window.nodeManager.getSourceOutput?.(conn) || null;
    }

    _socketHasTableData(socketIndex) {
        const output = this._getSocketOutput(socketIndex);
        return !!(output?.tableData && output.tableData.columns.length >= 2 && output.tableData.rowCount > 0);
    }

    // Раунд 201 (по запросу Mr.D: "давай для удобства сделаем преген
    // таблицы если источником является узел квартал. То есть теги
    // сами соберутся в таблицу") - собирает ГОТОВЫЙ Markdown-блок со
    // ВСЕМИ строками подключённого источника - работает для ЛЮБОЙ
    // table-таблицы с 2+ столбцами (не привязано конкретно к "Кварталу" -
    // тот просто самый частый практический случай, см. докстринг
    // кнопки в createContent()). ПЕРВЫЙ столбец таблицы становится
    // названиями строк/тегами {{socket-N:Название}}, ВТОРОЙ -
    // подставляемое значение, ТРЕТИЙ (если есть, например "Ед. изм." у
    // Квартала) - берётся СТАТИЧЕСКИ (как текущее значение на момент
    // генерации, не как отдельный тег) - единицы измерения показателя
    // меняются крайне редко, отдельный тег под них был бы избыточным
    // усложнением формата.
    _generateTableTemplate(socketIndex) {
        const output = this._getSocketOutput(socketIndex);
        const t = output?.tableData;
        if (!t || t.columns.length < 2 || t.rowCount === 0) return null;

        const nameCol = t.columns[0];
        const valueHeader = t.columns[1].header || 'Значение';
        const unitCol = t.columns[2];
        const headerCells = [nameCol.header || 'Показатель', valueHeader];
        if (unitCol) headerCells.push(unitCol.header || 'Ед. изм.');

        const lines = [];
        lines.push(`| ${headerCells.join(' | ')} |`);
        lines.push(`|${headerCells.map(() => '---').join('|')}|`);

        for (let i = 0; i < t.rowCount; i++) {
            const rawLabel = nameCol.values[i];
            if (rawLabel === null || rawLabel === undefined || String(rawLabel).trim() === '') continue;
            const label = String(rawLabel).trim();
            const cells = [label, `{{socket-${socketIndex}:${label}}}`];
            if (unitCol) cells.push(unitCol.values[i] ?? '');
            lines.push(`| ${cells.join(' | ')} |`);
        }
        return '\n' + lines.join('\n') + '\n';
    }

    // === Вспомогательные функции редактирования textarea по курсору ===
    // Раунд 205 (по запросу Mr.D: "если я выделяю элемент в просмотре,
    // нужно чтобы хотя бы этот элемент выделился в редакторе, и фокус
    // был на нём... чтобы было удобно редактировать") - переводит
    // диапазон НОМЕРОВ СТРОК (0-индексация, из data-line-start/end -
    // см. markdown.js/withLineAttrs()) в диапазон СИМВОЛЬНЫХ позиций
    // this.template - именно в них работают selectionStart/selectionEnd
    // textarea, номера строк напрямую не годятся.
    _lineRangeToCharRange(startLine, endLine) {
        const lines = this.template.split('\n');
        let charStart = 0;
        for (let i = 0; i < startLine && i < lines.length; i++) {
            charStart += lines[i].length + 1; // +1 - символ перевода строки
        }
        let charEnd = charStart;
        for (let i = startLine; i <= endLine && i < lines.length; i++) {
            charEnd += lines[i].length;
            if (i < endLine) charEnd += 1;
        }
        return { start: charStart, end: charEnd };
    }

    // Раунд 205 - клик по ЛЮБОМУ месту внутри отрендеренного блока
    // превью (например, по любой ЯЧЕЙКЕ строки таблицы) - closest()
    // находит БЛИЖАЙШИЙ элемент с data-line-start (сам блок, если клик
    // пришёлся на его корень, ИЛИ ближайшего "хозяина" - конкретную
    // строку таблицы/пункт списка - см. withLineAttrs() в markdown.js
    // про то, что размечается ИНДИВИДУАЛЬНО, а что диапазоном целиком) -
    // выделяет СООТВЕТСТВУЮЩИЙ диапазон исходного текста в textarea и
    // ставит туда фокус - минимальная, но реальная связь "просмотр ->
    // редактор", без попытки построить полноценный WYSIWYG (см. отказ
    // от этого в Раунде 204). Раунд 206 (по запросу Mr.D: "хотелось бы,
    // чтобы выделенный элемент в просмотре тоже был подсвечен") -
    // ДОПОЛНИТЕЛЬНО подсвечивает КЛИКНУТЫЙ блок В САМОМ превью - previewEl
    // передаётся отдельным параметром (а не через closest() снова)
    // специально, чтобы ОДНИМ querySelectorAll() ГАРАНТИРОВАННО снять
    // подсветку с ЛЮБОГО ранее подсвеченного элемента, даже если тот
    // сейчас не под курсором - без этого при повторных кликах старая
    // подсветка накапливалась бы одновременно с новой.
    _handlePreviewClick(e, templateArea, previewEl) {
        const target = e.target.closest('[data-line-start]');
        if (!target || !templateArea) return;
        const startLine = parseInt(target.dataset.lineStart, 10);
        const endLine = parseInt(target.dataset.lineEnd, 10);
        if (!Number.isFinite(startLine) || !Number.isFinite(endLine)) return;
        const { start, end } = this._lineRangeToCharRange(startLine, endLine);
        templateArea.focus();
        templateArea.setSelectionRange(start, end);
        if (previewEl) {
            previewEl.querySelectorAll('.text-node-preview-highlight').forEach(el => {
                el.classList.remove('text-node-preview-highlight');
            });
            target.classList.add('text-node-preview-highlight');
        }
    }

    _insertAtCursor(textarea, text) {
        const start = textarea.selectionStart ?? textarea.value.length;
        const end = textarea.selectionEnd ?? textarea.value.length;
        textarea.value = textarea.value.slice(0, start) + text + textarea.value.slice(end);
        textarea.selectionStart = textarea.selectionEnd = start + text.length;
        textarea.focus();
        textarea.dispatchEvent(new Event('input'));
    }
    _wrapSelection(textarea, before, after) {
        const start = textarea.selectionStart ?? 0;
        const end = textarea.selectionEnd ?? 0;
        const selected = textarea.value.slice(start, end);
        textarea.value = textarea.value.slice(0, start) + before + selected + after + textarea.value.slice(end);
        textarea.selectionStart = start + before.length;
        textarea.selectionEnd = start + before.length + selected.length;
        textarea.focus();
        textarea.dispatchEvent(new Event('input'));
    }
    _prefixLine(textarea, prefix) {
        const start = textarea.selectionStart ?? 0;
        const value = textarea.value;
        const lineStart = value.lastIndexOf('\n', start - 1) + 1;
        textarea.value = value.slice(0, lineStart) + prefix + value.slice(lineStart);
        textarea.selectionStart = textarea.selectionEnd = start + prefix.length;
        textarea.focus();
        textarea.dispatchEvent(new Event('input'));
    }

    // Раунд 206 (по запросу Mr.D: "нужны более удобные ручка, на всю
    // ширину, чтобы не искать её в углу") - НАЙДЕНА причина неудобства
    // нативного resize:vertical (Раунд 204) - браузер даёт ЗАХВАТ
    // ТОЛЬКО в нижнем правом углу элемента, размером ~12×12px - легко
    // промахнуться, особенно на панели во всю ширину ноды. Собственная
    // ручка - ПОЛНАЯ ширина панели, любое место по ней ловит drag -
    // getTargetEl() (не прямая ссылка) - на момент СОЗДАНИЯ ручки
    // целевой элемент ЕЩЁ может быть не создан (порядок вызовов в
    // createContent()) - функция вызывается только В МОМЕНТ клика,
    // когда переменная уже точно присвоена.
    _makeResizeHandle(getTargetEl, heightFieldName) {
        const handle = document.createElement('div');
        handle.className = 'text-node-resize-handle';
        handle.title = 'Потяните, чтобы изменить высоту';
        handle.addEventListener('mousedown', (e) => {
            e.stopPropagation();
            e.preventDefault();
            const targetEl = getTargetEl();
            if (!targetEl) return;
            const startY = e.clientY;
            const startHeight = targetEl.offsetHeight || this[heightFieldName] || 200;
            const onMove = (moveEvt) => {
                const newHeight = Math.max(60, startHeight + (moveEvt.clientY - startY));
                targetEl.style.height = newHeight + 'px';
                this[heightFieldName] = newHeight;
            };
            const onUp = () => {
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
            };
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        });
        return handle;
    }

    createContent() {
        const content = document.createElement('div');
        content.className = 'node-content';
        content.style.cssText = 'width:100%; min-width:260px; display:flex; flex-direction:column; gap:6px;';

        // Объявлена здесь (а не там, где создаётся элемент) - на неё
        // ссылаются замыкания кнопок И в цикле сокетов (автогенерация
        // таблицы), И в панели форматирования ниже - JS-время
        // выполнения ("когда клик реально произойдёт") здесь не
        // важно, важна ТОЛЬКО область видимости объявления.
        let templateArea;

        // Раунд 200 - динамические входы, один на строку - каждый
        // подписан своим тегом "socket-N", чтобы не приходилось
        // держать нумерацию в уме при написании шаблона.
        const socketsWrap = document.createElement('div');
        socketsWrap.className = 'text-node-sockets';
        this.inputSockets.forEach(socketIndex => {
            const row = document.createElement('div');
            row.style.cssText = 'display:flex; align-items:center; gap:6px;';
            const socket = SocketFactory.createSocket({
                nodeId: this.id, socketType: 'input', index: socketIndex, isAny: true,
                title: `Данные любого типа - доступны в шаблоне как {{socket-${socketIndex}}}`
            });
            row.appendChild(socket);
            const label = document.createElement('span');
            label.style.cssText = 'color:var(--md-text-secondary); font-size:10px; font-family:monospace; flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;';
            label.textContent = `{{socket-${socketIndex}}}`;
            row.appendChild(label);

            // Раунд 201 (по запросу Mr.D: "давай для удобства сделаем
            // преген таблицы если источником является узел квартал. То
            // есть теги сами соберутся в таблицу") - кнопка появляется
            // ТОЛЬКО если ЭТОТ вход СЕЙЧАС подключён к источнику,
            // отдающему table (не привязано К КОНКРЕТНО "Кварталу" -
            // работает для ЛЮБОЙ table-таблицы с 2+ столбцами, "Квартал" -
            // просто самый частый практический случай) - вставляет ГОТОВЫЙ
            // Markdown-блок со ВСЕМИ строками источника уже как теги,
            // экономит ручную вставку каждого тега по одному.
            const genBtn = document.createElement('button');
            genBtn.type = 'button';
            genBtn.className = 'text-node-tool-btn text-node-gen-btn';
            genBtn.dataset.socketIndex = String(socketIndex);
            genBtn.textContent = '📋';
            genBtn.title = 'Собрать Markdown-таблицу из ВСЕХ строк источника (теги вставятся автоматически)';
            genBtn.style.display = 'none'; // показывается только если источник даёт table - см. ниже
            genBtn.addEventListener('mousedown', (e) => e.stopPropagation());
            genBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const generated = this._generateTableTemplate(socketIndex);
                if (generated && templateArea) this._insertAtCursor(templateArea, generated);
            });
            row.appendChild(genBtn);
            if (window.nodeManager && this._socketHasTableData(socketIndex)) {
                genBtn.style.display = '';
            }

            socketsWrap.appendChild(row);
        });
        content.appendChild(socketsWrap);

        // Раунд 200 (по запросу Mr.D: "Меню: стандартный оформительский
        // набор") - панель форматирования Markdown - каждая кнопка
        // вставляет/оборачивает выделение соответствующим синтаксисом
        // прямо в textarea шаблона (не отдельное WYSIWYG-поле - весь
        // проект принципиально без внешних библиотек, см. markdown.js).
        const toolbar = document.createElement('div');
        toolbar.className = 'text-node-toolbar';
        toolbar.style.cssText = 'display:flex; flex-wrap:wrap; gap:2px;';
        toolbar.addEventListener('mousedown', (e) => e.stopPropagation());

        // templateArea уже объявлена выше (перед циклом сокетов) - тем же
        // замыканием пользуется и кнопка автогенерации таблицы, и кнопки
        // панели форматирования ниже.

        const addToolBtn = (label, title, action) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'text-node-tool-btn';
            btn.textContent = label;
            btn.title = title;
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (templateArea) action(templateArea);
            });
            toolbar.appendChild(btn);
            return btn;
        };
        addToolBtn('Ж', 'Жирный (**текст**)', (ta) => this._wrapSelection(ta, '**', '**'));
        addToolBtn('К', 'Курсив (*текст*)', (ta) => this._wrapSelection(ta, '*', '*'));
        addToolBtn('H1', 'Заголовок 1 уровня', (ta) => this._prefixLine(ta, '# '));
        addToolBtn('H2', 'Заголовок 2 уровня', (ta) => this._prefixLine(ta, '## '));
        addToolBtn('H3', 'Заголовок 3 уровня', (ta) => this._prefixLine(ta, '### '));
        addToolBtn('•', 'Маркированный список', (ta) => this._prefixLine(ta, '- '));
        addToolBtn('1.', 'Нумерованный список', (ta) => this._prefixLine(ta, '1. '));
        addToolBtn('"', 'Цитата', (ta) => this._prefixLine(ta, '> '));
        addToolBtn('—', 'Горизонтальная линия', (ta) => this._insertAtCursor(ta, '\n---\n'));
        // Раунд 203 (по запросу Mr.D: "добавить кнопки для создания
        // таблиц") - запрашивает число столбцов через нативный prompt()
        // (простой, надёжный способ - не городить отдельную форму ради
        // одного числа) - вставляет ГОТОВЫЙ пустой скелет таблицы
        // (строка заголовков + одна пустая строка данных), который
        // пользователь заполняет вручную - для таблиц ИЗ подключённых
        // данных используется другая кнопка ("📋", у каждого входа выше,
        // Раунд 201) - эта, наоборот, для таблиц "с нуля".
        addToolBtn('▦', 'Вставить пустую таблицу', (ta) => {
            const colsRaw = window.prompt('Сколько столбцов в таблице?', '2');
            if (colsRaw === null) return; // пользователь нажал "Отмена"
            const cols = Math.max(1, Math.min(10, parseInt(colsRaw, 10) || 2));
            const header = '| ' + Array.from({ length: cols }, (_, i) => `Заголовок ${i + 1}`).join(' | ') + ' |';
            const divider = '|' + Array(cols).fill('---').join('|') + '|';
            const dataRow = '| ' + Array(cols).fill(' ').join(' | ') + ' |';
            this._insertAtCursor(ta, `\n${header}\n${divider}\n${dataRow}\n`);
        });
        content.appendChild(toolbar);

        // Раунд 200 (по запросу Mr.D: "они должны появляться в
        // оформительском меню") - выпадающий список доступных тегов
        // (пересобирается каждый раз при открытии - "живой" список по
        // ТЕКУЩИМ подключениям) - выбор ВСТАВЛЯЕТ тег по месту курсора
        // и возвращает select на placeholder, чтобы им можно было
        // пользоваться повторно без пересборки.
        const tagRow = document.createElement('div');
        tagRow.style.cssText = 'display:flex; align-items:center; gap:4px;';
        tagRow.addEventListener('mousedown', (e) => e.stopPropagation());
        const tagSelect = document.createElement('select');
        tagSelect.className = 'text-node-tag-select';
        tagSelect.style.cssText = 'flex:1; font-size:10px;';
        const fillTagSelect = () => {
            tagSelect.innerHTML = '';
            const placeholder = document.createElement('option');
            placeholder.value = '';
            placeholder.textContent = '+ Вставить тег…';
            tagSelect.appendChild(placeholder);
            this._availableTags().forEach(({ tag, label }) => {
                const opt = document.createElement('option');
                opt.value = tag;
                opt.textContent = label;
                tagSelect.appendChild(opt);
            });
        };
        fillTagSelect();
        tagSelect.addEventListener('mousedown', (e) => { e.stopPropagation(); fillTagSelect(); });
        tagSelect.addEventListener('change', (e) => {
            if (e.target.value && templateArea) this._insertAtCursor(templateArea, e.target.value);
            e.target.value = '';
        });
        tagRow.appendChild(tagSelect);
        content.appendChild(tagRow);

        // Раунд 204 (откат по жалобе Mr.D: "улучшения создали
        // непредвиденные ошибки... откатим обратно отключение окон,
        // оставим как раньше два окна. Уберём редактирование в окне
        // просмотра, она создаёт баги и просто дублирует окно
        // разметки") - простая, ВСЕГДА видимая пара, как было
        // изначально в Раунде 200 - ОДНО поле ввода, без переключателей
        // видимости/режима редактирования (Раунд 203, убраны целиком).
        templateArea = document.createElement('textarea');
        templateArea.className = 'text-node-template';
        templateArea.value = this.template;
        templateArea.rows = 5;
        // Раунд 204/206 - height, если пользователь УЖЕ когда-то
        // потянул за ручку ресайза (собственную, полноширинную - см.
        // _makeResizeHandle()) - иначе высота по умолчанию (5 строк,
        // через rows выше).
        templateArea.style.cssText = `
            width: 100%;
            box-sizing: border-box;
            font-size: 12px;
            font-family: monospace;
            color: var(--md-text);
            background: var(--md-surface-2);
            border: 1px solid var(--md-divider);
            border-radius: var(--md-radius);
            padding: 6px 8px;
            ${this.templateHeight ? `height: ${this.templateHeight}px;` : ''}
        `;
        templateArea.addEventListener('mousedown', (e) => e.stopPropagation());
        templateArea.addEventListener('input', (e) => {
            this.template = e.target.value;
            if (window.nodeManager) window.nodeManager.calculateAll();
        });
        content.appendChild(templateArea);
        content.appendChild(this._makeResizeHandle(() => templateArea, 'templateHeight'));

        const preview = document.createElement('div');
        preview.className = 'text-node-preview';
        preview.style.cssText = `
            height: ${this.previewHeight || 220}px;
            overflow-y: auto;
            font-size: 12px;
            color: var(--md-text);
            background: var(--md-surface-2);
            border-radius: var(--md-radius);
            padding: 8px 10px;
            line-height: 1.5;
        `;
        preview.addEventListener('mousedown', (e) => e.stopPropagation());
        // Раунд 205 (по запросу Mr.D: "если я выделяю элемент в
        // просмотре, нужно чтобы хотя бы этот элемент выделился в
        // редакторе, и фокус был на нём") - см. докстринг
        // _handlePreviewClick() выше.
        preview.addEventListener('click', (e) => this._handlePreviewClick(e, templateArea, preview));
        content.appendChild(preview);
        content.appendChild(this._makeResizeHandle(() => preview, 'previewHeight'));
        this._updatePreview(preview);

        const outRow = document.createElement('div');
        outRow.style.cssText = 'display:flex; align-items:center; gap:8px; padding-top:4px; border-top:1px solid var(--md-divider);';
        const outLabel = document.createElement('span');
        outLabel.style.cssText = 'color:var(--md-text-secondary); font-size:11px; flex:1;';
        outLabel.textContent = 'Выход (текст)';
        outRow.appendChild(outLabel);
        const outSocket = SocketFactory.createSocket({
            nodeId: this.id, socketType: 'output', index: 0, isAny: false,
            title: 'Итоговый текст - шаблон с подставленными значениями тегов'
        });
        outRow.appendChild(outSocket);
        content.appendChild(outRow);

        return content;
    }

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
        // Раунд 200 - textarea НЕ перезаписываем, пока в ней фокус
        // (тот же принцип, что у остальных редактируемых полей проекта,
        // см. NODE_API.md раздел 8) - пользователь может как раз сейчас
        // печатать шаблон, calculateAll() не должен "перебивать" ввод.
        const templateArea = element.querySelector('.text-node-template');
        if (templateArea && document.activeElement !== templateArea && templateArea.value !== this.template) {
            templateArea.value = this.template;
        }
        // Раунд 201 - видимость кнопки "📋 Собрать таблицу" обновляется
        // при КАЖДОМ пересчёте (не только при первом рендере) -
        // подключение/отключение источника ПОСЛЕ создания ноды должно
        // сразу показать/скрыть кнопку, без необходимости пересоздавать
        // ноду целиком.
        const genBtns = element.querySelectorAll?.('.text-node-gen-btn') || [];
        genBtns.forEach(btn => {
            const socketIndex = parseInt(btn.dataset.socketIndex, 10);
            btn.style.display = this._socketHasTableData(socketIndex) ? '' : 'none';
        });
    }

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
            label: 'Запасное значение (если тег пуст)',
            type: 'text',
            get: () => this.fallbackValue,
            set: (v) => { this.fallbackValue = v ?? ''; if (window.nodeManager) window.nodeManager.calculateAll(); }
        });

        fields.push(...buildBoardInspectorFields(this));

        return fields;
    }
}
