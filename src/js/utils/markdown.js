/**
 * SPDX-License-Identifier: MIT
 * SPDX-FileCopyrightText: 2024 NodeCalculate Team
 * SPDX-FileCopyrightText: 2024 Pavel Fomin
 *
 * @file    markdown.js
 * @brief   Лёгкий markdown->HTML рендерер без внешних библиотек - для узла "Текст" (TextNode)
 * @author  Pavel Fomin
 * @version 1.8.9
 * @see     https://github.com/GhostPWLk1n/NodeCalculator.git
 */

/**
 * markdown.js - Раунд 127 (по чек-листу Mr.D - новый узел "Текст" с
 * поддержкой Markdown). Проект принципиально без фреймворков/внешних
 * npm-зависимостей в рендерере (см. NODE_API.md) - вместо подключения
 * стороннего парсера (marked/showdown и т.п.) - собственный, лёгкий,
 * покрывающий ИМЕННО тот набор синтаксиса, что указан в чек-листе:
 * заголовки, жирный/курсив, списки, ссылки, изображения, код/блоки
 * кода, таблицы (базово), цитаты, горизонтальные линии. НЕ претендует
 * на полное соответствие спецификации CommonMark - для содержимого
 * внутри нодового калькулятора этого достаточно.
 *
 * Безопасность: исходный текст ЭКРАНИРУЕТСЯ (escapeHtml()) ДО разбора
 * markdown-разметки - предотвращает встраивание произвольного HTML/JS
 * через содержимое ноды (даже для локального приложения - хорошая
 * практика, не полагаться на "это же просто десктоп").
 */

function escapeHtml(text) {
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// Инлайн-разметка (внутри одной строки/ячейки) - жирный/курсив/код/
// ссылки/изображения. Порядок важен: код ПЕРВЫМ (его содержимое не
// должно дальше разбираться как markdown), изображения ПЕРЕД ссылками
// (у изображений тот же `[...](...)`, но с `!` перед - если сначала
// разобрать как ссылку, `!` останется "осиротевшим" текстом перед ней).
function renderInline(text) {
    let html = escapeHtml(text);

    // Инлайн-код `code` - раньше всего, чтобы избежать двойного разбора
    // содержимого самого кода.
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

    // Изображения ![alt](url)
    html = html.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g,
        (m, alt, url, title) => `<img src="${url}" alt="${alt}"${title ? ` title="${title}"` : ''}>`);

    // Ссылки [текст](url)
    html = html.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g,
        (m, label, url, title) => `<a href="${url}"${title ? ` title="${title}"` : ''} target="_blank" rel="noopener noreferrer">${label}</a>`);

    // Жирный **text** или __text__ - раньше курсива (общий символ *)
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/__([^_]+)__/g, '<strong>$1</strong>');

    // Курсив *text* или _text_ - после жирного, чтобы ** уже не осталось
    html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    html = html.replace(/_([^_]+)_/g, '<em>$1</em>');

    return html;
}

// Раунд 127 - построчный разбор блочных элементов (заголовки/списки/
// цитаты/таблицы/код-блоки/горизонтальные линии/параграфы) - тот же
// общий подход, что у большинства лёгких markdown-парсеров: сначала
// определить ТИП текущей и соседних строк, затем сгруппировать
// последовательные строки одного типа в один блок (список целиком,
// таблица целиком и т.п.).
export function renderMarkdown(source) {
    const lines = String(source ?? '').replace(/\r\n/g, '\n').split('\n');
    const out = [];
    let i = 0;

    while (i < lines.length) {
        const line = lines[i];

        // Блок кода ```...```
        if (/^```/.test(line.trim())) {
            const codeLines = [];
            i++;
            while (i < lines.length && !/^```/.test(lines[i].trim())) {
                codeLines.push(lines[i]);
                i++;
            }
            i++; // пропустить закрывающую ```
            out.push(`<pre><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
            continue;
        }

        // Горизонтальная линия --- (три и более дефиса/звёздочки/подчёркивания, одни на строке)
        if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line.trim())) {
            out.push('<hr>');
            i++;
            continue;
        }

        // Заголовки # ## ### (до 6 уровней)
        const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
        if (headingMatch) {
            const level = headingMatch[1].length;
            out.push(`<h${level}>${renderInline(headingMatch[2].trim())}</h${level}>`);
            i++;
            continue;
        }

        // Цитата > text (несколько подряд идущих строк - один <blockquote>)
        if (/^>\s?/.test(line)) {
            const quoteLines = [];
            while (i < lines.length && /^>\s?/.test(lines[i])) {
                quoteLines.push(lines[i].replace(/^>\s?/, ''));
                i++;
            }
            out.push(`<blockquote>${renderInline(quoteLines.join(' '))}</blockquote>`);
            continue;
        }

        // Таблица (базовая поддержка) - строка заголовка, строка-разделитель
        // (---|---|---), затем строки данных - формат GFM-таблиц.
        if (line.includes('|') && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[i + 1]) && lines[i + 1].includes('-')) {
            const headerCells = line.split('|').map(c => c.trim()).filter((c, idx, arr) => !(idx === 0 && c === '') && !(idx === arr.length - 1 && c === ''));
            i += 2; // пропустить строку заголовка и строку-разделитель
            const bodyRows = [];
            while (i < lines.length && lines[i].includes('|')) {
                const cells = lines[i].split('|').map(c => c.trim()).filter((c, idx, arr) => !(idx === 0 && c === '') && !(idx === arr.length - 1 && c === ''));
                bodyRows.push(cells);
                i++;
            }
            let tableHtml = '<table><thead><tr>' +
                headerCells.map(c => `<th>${renderInline(c)}</th>`).join('') +
                '</tr></thead><tbody>' +
                bodyRows.map(row => '<tr>' + row.map(c => `<td>${renderInline(c)}</td>`).join('') + '</tr>').join('') +
                '</tbody></table>';
            out.push(tableHtml);
            continue;
        }

        // Списки - маркированные (-/*/+) или нумерованные (1. 2. ...) -
        // последовательные строки одного вида группируются в один
        // <ul>/<ol>.
        const isBullet = /^\s*[-*+]\s+/.test(line);
        const isNumbered = /^\s*\d+\.\s+/.test(line);
        if (isBullet || isNumbered) {
            const tag = isNumbered ? 'ol' : 'ul';
            const itemRe = isNumbered ? /^\s*\d+\.\s+(.*)$/ : /^\s*[-*+]\s+(.*)$/;
            const items = [];
            while (i < lines.length) {
                const m = lines[i].match(itemRe);
                if (!m) break;
                items.push(`<li>${renderInline(m[1])}</li>`);
                i++;
            }
            out.push(`<${tag}>${items.join('')}</${tag}>`);
            continue;
        }

        // Пустая строка - просто разделитель между блоками, ничего не выводим
        if (line.trim() === '') {
            i++;
            continue;
        }

        // Обычный параграф - захватывает все подряд идущие непустые
        // строки, ни под один из блочных типов выше не подошедшие.
        const paraLines = [line];
        i++;
        while (i < lines.length && lines[i].trim() !== '' &&
            !/^#{1,6}\s/.test(lines[i]) && !/^>\s?/.test(lines[i]) &&
            !/^```/.test(lines[i].trim()) && !/^\s*[-*+]\s+/.test(lines[i]) &&
            !/^\s*\d+\.\s+/.test(lines[i]) && !/^(-{3,}|\*{3,}|_{3,})\s*$/.test(lines[i].trim())) {
            paraLines.push(lines[i]);
            i++;
        }
        out.push(`<p>${renderInline(paraLines.join(' '))}</p>`);
    }

    return out.join('\n');
}
