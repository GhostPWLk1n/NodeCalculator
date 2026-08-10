/**
 * SPDX-License-Identifier: MIT
 * SPDX-FileCopyrightText: 2024 NodeCalculate Team
 * SPDX-FileCopyrightText: 2024 Pavel Fomin
 *
 * @file    columnResize.js
 * @brief   Общая drag-and-drop логика растягивания ширины столбца - переиспользуется во всех табличных представлениях
 * @author  Pavel Fomin
 * @version 1.8.42
 * @see     https://github.com/GhostPWLk1n/NodeCalculator.git
 */

/**
 * columnResize.js - Раунд 93 (чек-лист 1.7.21, п.4.1). Один и тот же
 * жест (узкая ручка у правого края заголовка столбца, тянуть мышью) для
 * ВСЕХ табличных представлений - TableViewerNode (Листы), Доски
 * (TableWidgetRenderer) и левые колонки GanttNode (Задача/ч.ч./Раб.дн./
 * Ответственный - НЕ клетки календарной сетки, там растягивание одной
 * клетки лишено смысла - ширина дня задаётся масштабом линейки/зумом на
 * ВСЮ диаграмму разом, не по клеточно, см. её докстринг).
 *
 * Использование:
 *   attachColumnResizeHandle(headerCellEl, currentWidthPx, (finalWidth) => {
 *       // сохранить finalWidth туда, где хранит именно ЭТОТ потребитель
 *       // (this.columnWidths[header] у TableViewerNode, node.boardColumnWidths[header]
 *       // у Доски, this.labelColWidth и т.п. у GanttNode) + пересчитать/перерисовать
 *   });
 */
export function attachColumnResizeHandle(headerCellEl, currentWidthPx, onResize) {
    const handle = document.createElement('div');
    handle.className = 'column-resize-handle';
    handle.title = 'Потяните, чтобы изменить ширину столбца';

    // headerCellEl должен быть containing block для абсолютно
    // позиционированной ручки - выставляем position:relative, только
    // если ничего другого ещё не задано (не затираем существующий стиль)
    if (!headerCellEl.style.position) {
        headerCellEl.style.position = 'relative';
    }

    handle.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        e.preventDefault();

        const zoom = (typeof window.getZoomLevel === 'function') ? window.getZoomLevel() : 1;
        const startX = e.clientX;
        const startWidth = currentWidthPx;
        handle.classList.add('column-resize-active');
        headerCellEl.classList.add('column-resize-target-active');

        const onMove = (moveEvt) => {
            const deltaPx = (moveEvt.clientX - startX) / zoom;
            const newWidth = Math.max(30, Math.round(startWidth + deltaPx));
            headerCellEl.style.width = newWidth + 'px';
            handle.dataset.pendingWidth = String(newWidth);
        };
        const onUp = () => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            handle.classList.remove('column-resize-active');
            headerCellEl.classList.remove('column-resize-target-active');
            const finalWidth = parseInt(handle.dataset.pendingWidth || String(startWidth), 10);
            delete handle.dataset.pendingWidth;
            if (finalWidth !== startWidth) onResize(finalWidth);
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    });

    headerCellEl.appendChild(handle);
    // Клик ПО САМОЙ РУЧКЕ (без реального перетаскивания - просто короткий
    // клик) не должен всплывать до обработчика заголовка (например,
    // сортировки в TableViewerNode) - иначе случайный клик мимо цели
    // менял бы сортировку столбца.
    handle.addEventListener('click', (e) => e.stopPropagation());
    return handle;
}
