/**
 * SPDX-License-Identifier: MIT
 * SPDX-FileCopyrightText: 2024 NodeCalculate Team
 * SPDX-FileCopyrightText: 2024 Pavel Fomin
 *
 * @file    xlsxReader.js
 * @brief   Чтение .xlsx (ZIP + OOXML) без сторонних библиотек - только браузерные API
 * @author  Pavel Fomin
 * @version 1.7.15
 * @see     https://github.com/GhostPWLk1n/NodeCalculator.git
 */

/**
 * XlsxReader - минимальный читатель .xlsx "с нуля", без npm-зависимостей
 * (в проекте нет package.json/node_modules, а сеть в сборке недоступна -
 * тянуть SheetJS или аналоги неоткуда и не на чем). .xlsx - это ZIP-архив
 * с XML внутри (OOXML), а всё нужное для его чтения уже есть в самом
 * Chromium/Electron:
 *   - разбор ZIP (центральный каталог, локальные заголовки) - руками,
 *     формат простой и хорошо документирован (APPNOTE.TXT);
 *   - расжатие DEFLATE - через нативный DecompressionStream('deflate-raw'),
 *     не нужно тащить свою реализацию inflate;
 *   - разбор самих XML (workbook.xml/sheetN.xml/sharedStrings.xml) - через
 *     нативный DOMParser, а не самописный XML-парсер.
 *
 * СОЗНАТЕЛЬНЫЕ УПРОЩЕНИЯ ("поверхностное" чтение, как просил Mr.D):
 *   - Даты хранятся в .xlsx как числа (серийный день) + формат ячейки из
 *     styles.xml - styles.xml здесь НЕ разбирается, поэтому даты придут
 *     как обычные числа (например, "45678"), а не как даты. Полноценная
 *     поддержка дат - отдельная задача (нужен разбор numFmt/styles.xml).
 *   - ZIP64 (архивы >4GB или >65535 файлов) не поддержан - для .xlsx
 *     такого размера это практически невозможный сценарий.
 *   - Первая строка листа всегда считается заголовками - переключателя
 *     "без заголовков" нет.
 *   - Формулы читаются как их ПОСЛЕДНЕЕ ВЫЧИСЛЕННОЕ значение (Excel сам
 *     сохраняет его рядом с формулой) - сами формулы не пересчитываются.
 */

const ZIP_EOCD_SIG = 0x06054b50;
const ZIP_CDFH_SIG = 0x02014b50;
const ZIP_LFH_SIG = 0x04034b50;

function findEOCD(view) {
    const maxCommentLen = 65535;
    const minPos = Math.max(0, view.byteLength - 22 - maxCommentLen);
    for (let i = view.byteLength - 22; i >= minPos; i--) {
        if (view.getUint32(i, true) === ZIP_EOCD_SIG) return i;
    }
    throw new Error('Не найден конец центрального каталога ZIP - файл повреждён или это не .xlsx');
}

// Центральный каталог ZIP - карта "имя файла внутри архива" -> метаданные,
// нужные чтобы потом вытащить и расжать именно этот файл (см. extractEntry)
function parseCentralDirectory(buffer) {
    const view = new DataView(buffer);
    const eocdPos = findEOCD(view);
    const cdOffset = view.getUint32(eocdPos + 16, true);
    const totalEntries = view.getUint16(eocdPos + 10, true);

    const entries = new Map();
    let pos = cdOffset;
    for (let i = 0; i < totalEntries; i++) {
        if (view.getUint32(pos, true) !== ZIP_CDFH_SIG) {
            throw new Error('Повреждён центральный каталог ZIP (не .xlsx или файл битый)');
        }
        const method = view.getUint16(pos + 10, true);
        const compSize = view.getUint32(pos + 20, true);
        const nameLen = view.getUint16(pos + 28, true);
        const extraLen = view.getUint16(pos + 30, true);
        const commentLen = view.getUint16(pos + 32, true);
        const localHeaderOffset = view.getUint32(pos + 42, true);
        const nameBytes = new Uint8Array(buffer, pos + 46, nameLen);
        const name = new TextDecoder('utf-8').decode(nameBytes);
        entries.set(name, { localHeaderOffset, compSize, method });
        pos += 46 + nameLen + extraLen + commentLen;
    }
    return entries;
}

async function extractEntry(buffer, entry) {
    const view = new DataView(buffer);
    const pos = entry.localHeaderOffset;
    if (view.getUint32(pos, true) !== ZIP_LFH_SIG) {
        throw new Error('Повреждён локальный заголовок ZIP');
    }
    const nameLen = view.getUint16(pos + 26, true);
    const extraLen = view.getUint16(pos + 28, true);
    const dataStart = pos + 30 + nameLen + extraLen;
    const compData = new Uint8Array(buffer, dataStart, entry.compSize);

    if (entry.method === 0) return compData.slice(); // без сжатия
    if (entry.method === 8) {
        if (typeof DecompressionStream === 'undefined') {
            throw new Error('Этот Electron/Chromium слишком старый - нет DecompressionStream для распаковки .xlsx');
        }
        const stream = new Blob([compData]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
        return new Uint8Array(await new Response(stream).arrayBuffer());
    }
    throw new Error(`Неподдерживаемый метод сжатия ZIP (${entry.method}) - обычный .xlsx использует только "без сжатия" или deflate`);
}

async function extractText(buffer, entries, name) {
    const entry = entries.get(name);
    if (!entry) return null;
    return new TextDecoder('utf-8').decode(await extractEntry(buffer, entry));
}

function parseXml(text) {
    return new DOMParser().parseFromString(text, 'application/xml');
}

// "A" -> 0, "B" -> 1, ..., "AA" -> 26 (0-based, удобно как индекс массива)
function columnLetterToIndex(letters) {
    let result = 0;
    for (let i = 0; i < letters.length; i++) {
        result = result * 26 + (letters.charCodeAt(i) - 64);
    }
    return result - 1;
}

function parseCellRef(ref) {
    const m = /^([A-Z]+)(\d+)$/.exec(ref || '');
    return m ? { col: columnLetterToIndex(m[1]) } : null;
}

// <si> может быть простым (<t>текст</t>) или "богатым" (несколько
// <r><t>кусок</t></r> с разным форматированием внутри одной ячейки) -
// в обоих случаях достаточно склеить текст всех <t>
function parseSharedStrings(xmlText) {
    if (!xmlText) return [];
    const items = [...parseXml(xmlText).getElementsByTagName('si')];
    return items.map(si => [...si.getElementsByTagName('t')].map(t => t.textContent).join(''));
}

// Список листов книги в правильном порядке + путь к файлу каждого листа
// внутри архива - имя файла НЕ всегда "sheetN.xml" по порядку (Excel
// может как угодно переименовывать при удалении/пересоздании листов),
// поэтому путь ищем через rels, а не угадываем по индексу
function parseWorkbookSheets(workbookXml, relsXml) {
    const doc = parseXml(workbookXml);
    const sheetEls = [...doc.getElementsByTagName('sheet')];

    const relMap = new Map();
    if (relsXml) {
        [...parseXml(relsXml).getElementsByTagName('Relationship')].forEach(rel => {
            relMap.set(rel.getAttribute('Id'), rel.getAttribute('Target'));
        });
    }

    const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
    return sheetEls.map((el, idx) => {
        const name = el.getAttribute('name') || `Лист ${idx + 1}`;
        const rId = el.getAttribute('r:id') || el.getAttributeNS(R_NS, 'id');
        let target = relMap.get(rId);
        if (!target) {
            // Фолбэк на случай, если rels не нашлись/не распознались -
            // в подавляющем большинстве файлов листы и правда называются
            // по порядку sheet1.xml, sheet2.xml...
            target = `worksheets/sheet${idx + 1}.xml`;
        }
        target = target.replace(/^\/?xl\//, '').replace(/^\.?\//, '');
        return { name, path: `xl/${target}` };
    });
}

function readCellValue(cellEl, sharedStrings) {
    const type = cellEl.getAttribute('t');
    const vEl = cellEl.getElementsByTagName('v')[0];

    if (type === 's') {
        const idx = vEl ? parseInt(vEl.textContent, 10) : NaN;
        return Number.isNaN(idx) ? '' : (sharedStrings[idx] ?? '');
    }
    if (type === 'inlineStr') {
        const isEl = cellEl.getElementsByTagName('is')[0];
        return isEl ? [...isEl.getElementsByTagName('t')].map(t => t.textContent).join('') : '';
    }
    if (type === 'str') return vEl ? vEl.textContent : ''; // строковый результат формулы
    if (type === 'b') return !!vEl && vEl.textContent === '1';
    if (!vEl) return null; // пустая ячейка (например, ошибка формулы без <v>)
    const num = parseFloat(vEl.textContent);
    return Number.isNaN(num) ? vEl.textContent : num;
}

// Одна строка листа -> массив значений по индексу столбца. xlsx не хранит
// пустые <c> вовсе, поэтому дыры заполняем null по максимальному индексу
// столбца среди присутствующих в строке ячеек
function parseRowCells(rowEl, sharedStrings) {
    const cells = [...rowEl.getElementsByTagName('c')];
    if (cells.length === 0) return [];
    const parsed = cells.map(c => ({ ref: parseCellRef(c.getAttribute('r')), cell: c }));
    const maxCol = Math.max(-1, ...parsed.map(p => (p.ref ? p.ref.col : -1)));
    const result = new Array(maxCol + 1).fill(null);
    parsed.forEach(({ ref, cell }) => {
        if (ref) result[ref.col] = readCellValue(cell, sharedStrings);
    });
    return result;
}

// Разбирает ВСЕ строки листа, выровненные по НАСТОЯЩЕМУ номеру строки
// (атрибут r="N" у <row>), а НЕ по порядковой позиции <row>-элемента в
// XML. Это принципиально: Excel не обязан записывать полностью пустые
// строки в XML вовсе - если, скажем, строка 2 пустая и в файле её просто
// нет, третий <row>-элемент по счёту будет иметь r="3", а не r="2". Без
// этой поправки "строка 3" в понимании пользователя (то, что он видит в
// Excel) и "третий элемент <row> в XML" разъехались бы после первого же
// пропуска. Результат - массив, где result[i] соответствует СТРОКЕ i+1
// (0-based индекс = 1-based номер строки минус 1), пропущенные строки -
// пустые массивы (тот же принцип, что и пропущенные ячейки внутри строки).
function parseSheetRows(xmlText, sharedStrings) {
    const rowEls = [...parseXml(xmlText).getElementsByTagName('row')];
    let maxRow = 0;
    const byRowNum = new Map();
    rowEls.forEach(rowEl => {
        const rNum = parseInt(rowEl.getAttribute('r'), 10);
        if (Number.isNaN(rNum)) return;
        byRowNum.set(rNum, parseRowCells(rowEl, sharedStrings));
        if (rNum > maxRow) maxRow = rNum;
    });

    const result = [];
    for (let r = 1; r <= maxRow; r++) {
        result.push(byRowNum.get(r) || []);
    }
    return result;
}

export const XlsxReader = {
    // "Поверхностное" сканирование - имена листов + ПЕРВАЯ строка
    // (заголовки) каждого листа, без разбора всех строк целиком. XML
    // всё равно приходится расжимать целиком (DEFLATE нельзя размотать
    // частично, только с самого начала потока) - но не строить из него
    // полную таблицу, пока лист не выбран явно (см. readSheet ниже).
    async scanOutline(arrayBuffer) {
        const entries = parseCentralDirectory(arrayBuffer);

        const workbookXml = await extractText(arrayBuffer, entries, 'xl/workbook.xml');
        if (!workbookXml) throw new Error('Это не похоже на .xlsx - не найден xl/workbook.xml внутри архива');
        const relsXml = await extractText(arrayBuffer, entries, 'xl/_rels/workbook.xml.rels');
        const sheetsMeta = parseWorkbookSheets(workbookXml, relsXml);

        const sharedStringsXml = await extractText(arrayBuffer, entries, 'xl/sharedStrings.xml');
        const sharedStrings = parseSharedStrings(sharedStringsXml);

        const sheets = [];
        for (const meta of sheetsMeta) {
            if (!entries.has(meta.path)) continue; // лист объявлен, но файла в архиве нет - пропускаем
            const xml = await extractText(arrayBuffer, entries, meta.path);
            const rows = parseSheetRows(xml, sharedStrings);
            const headerCells = rows[0] || [];
            const headers = headerCells.map(v => (v === null || v === undefined ? '' : String(v)));
            sheets.push({ name: meta.name, path: meta.path, headers });
        }

        return { sheets, _entries: entries, _sharedStrings: sharedStrings };
    },

    // Полный разбор ОДНОГО листа (все строки, включая первую строку-
    // заголовок - вызывающий код сам решает, что с ней делать). Вызывается
    // только когда пользователь явно нажал "Импортировать" для конкретного
    // листа - переиспользует entries/sharedStrings, уже посчитанные в
    // scanOutline(), повторно их разбирать не нужно.
    async readSheet(arrayBuffer, outline, sheetPath) {
        const xml = await extractText(arrayBuffer, outline._entries, sheetPath);
        if (!xml) throw new Error(`Лист не найден в архиве: ${sheetPath}`);
        return parseSheetRows(xml, outline._sharedStrings);
    },

    // Заголовки НЕ обязательно в первой строке листа (в реальных файлах
    // часто выше есть строка с названием отчёта, пустая строка-отступ и
    // т.п.) - эта функция достаёт заголовки с ЛЮБОЙ явно указанной строки
    // (rowIndex, 0-based), а не только с первой, как scanOutline() выше.
    // Вызывается, когда пользователь меняет "Строку заголовков" в панели
    // (см. xlsxImportNode.js) - переиспользует entries/sharedStrings из
    // outline, поэтому расжимает только ОДИН нужный лист заново, а не
    // весь файл целиком.
    async getHeadersAtRow(arrayBuffer, outline, sheetPath, rowIndex) {
        const xml = await extractText(arrayBuffer, outline._entries, sheetPath);
        if (!xml) return [];
        const rows = parseSheetRows(xml, outline._sharedStrings);
        const cells = rows[rowIndex] || [];
        return cells.map(v => (v === null || v === undefined ? '' : String(v)));
    }
};
