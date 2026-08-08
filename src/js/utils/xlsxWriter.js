/**
 * SPDX-License-Identifier: MIT
 * SPDX-FileCopyrightText: 2024 NodeCalculate Team
 * SPDX-FileCopyrightText: 2024 Pavel Fomin
 *
 * @file    xlsxWriter.js
 * @brief   Запись .xlsx (ZIP + OOXML) без сторонних библиотек - только браузерные API
 * @author  Pavel Fomin
 * @version 1.8.36
 * @see     https://github.com/GhostPWLk1n/NodeCalculator.git
 */

/**
 * XlsxWriter - зеркало xlsxReader.js, только в обратную сторону. Те же
 * причины писать с нуля: в проекте нет package.json-зависимостей уровня
 * runtime и сети при сборке нет - взять SheetJS/аналоги неоткуда.
 *
 * СОЗНАТЕЛЬНЫЕ УПРОЩЕНИЯ:
 *   - ZIP-записи хранятся МЕТОДОМ STORED (без сжатия), не DEFLATE.
 *     .xlsx с method=0 - валидный ZIP/OOXML, Excel открывает его без
 *     вопросов (сжатие - опция архива, а не требование формата). Ценой
 *     чуть большего размера файла (текстовый XML сжимается неплохо, но
 *     экспортируемые таблицы - не многомегабайтные логи) это убирает
 *     всю сложность потокового чтения CompressionStream ради записи -
 *     тот же компромисс "поверхностно, но надёжно", что и в xlsxReader.js.
 *   - Одна книга - один лист. Формулы/стили/числовые форматы ячеек не
 *     пишутся - числа как числа, текст как inline-строка (без
 *     sharedStrings.xml - для одноразового экспорта отдельный словарь
 *     строк не даёт выигрыша, только лишняя часть архива).
 *   - Название листа обрезается до 31 символа (жёсткий лимит Excel) и
 *     не проверяется на недопустимые символы ([ ] : * ? / \) - для имён,
 *     приходящих из customName ноды, коллизия маловероятна, но не
 *     исключена полностью.
 */

function crc32(bytes) {
    if (!crc32._table) {
        const table = new Uint32Array(256);
        for (let n = 0; n < 256; n++) {
            let c = n;
            for (let k = 0; k < 8; k++) {
                c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
            }
            table[n] = c >>> 0;
        }
        crc32._table = table;
    }
    const table = crc32._table;
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) {
        crc = table[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
}

function textToBytes(str) {
    return new TextEncoder().encode(str);
}

function escapeXml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

// Столбец 0 -> 'A', 25 -> 'Z', 26 -> 'AA' и т.д. (буквенный адрес ячейки OOXML)
function colLetter(index) {
    let i = index + 1;
    let s = '';
    while (i > 0) {
        const rem = (i - 1) % 26;
        s = String.fromCharCode(65 + rem) + s;
        i = Math.floor((i - 1) / 26);
    }
    return s;
}

// DOS-дата/время в заголовках ZIP - формально обязательны, но Excel их
// нигде не показывает пользователю, поэтому фиксированное значение
// (1 января 1980, 00:00 - минимально допустимая DOS-дата) вместо
// вычисления реальной даты/времени экспорта.
const DOS_TIME = 0;
const DOS_DATE = 0x21;

// Собирает ZIP-архив методом STORED (без сжатия) - локальные заголовки,
// данные, центральный каталог, EOCD - вручную, по APPNOTE.TXT, тем же
// подходом "с нуля", что уже применён при чтении в xlsxReader.js.
function buildZip(files) {
    const parts = [];
    const centralParts = [];
    let offset = 0;

    files.forEach(f => {
        const nameBytes = textToBytes(f.name);
        const crc = crc32(f.bytes);
        const size = f.bytes.length;

        const local = new DataView(new ArrayBuffer(30));
        local.setUint32(0, 0x04034b50, true);   // local file header signature
        local.setUint16(4, 20, true);            // version needed to extract
        local.setUint16(6, 0, true);             // general purpose flag
        local.setUint16(8, 0, true);             // compression method = stored
        local.setUint16(10, DOS_TIME, true);
        local.setUint16(12, DOS_DATE, true);
        local.setUint32(14, crc, true);
        local.setUint32(18, size, true);         // compressed size == uncompressed (stored)
        local.setUint32(22, size, true);
        local.setUint16(26, nameBytes.length, true);
        local.setUint16(28, 0, true);            // extra field length

        parts.push(new Uint8Array(local.buffer), nameBytes, f.bytes);

        const central = new DataView(new ArrayBuffer(46));
        central.setUint32(0, 0x02014b50, true);  // central directory file header signature
        central.setUint16(4, 20, true);          // version made by
        central.setUint16(6, 20, true);          // version needed
        central.setUint16(8, 0, true);
        central.setUint16(10, 0, true);
        central.setUint16(12, DOS_TIME, true);
        central.setUint16(14, DOS_DATE, true);
        central.setUint32(16, crc, true);
        central.setUint32(20, size, true);
        central.setUint32(24, size, true);
        central.setUint16(28, nameBytes.length, true);
        central.setUint16(30, 0, true);          // extra field length
        central.setUint16(32, 0, true);          // comment length
        central.setUint16(34, 0, true);          // disk number start
        central.setUint16(36, 0, true);          // internal file attrs
        central.setUint32(38, 0, true);          // external file attrs
        central.setUint32(42, offset, true);     // offset of local header

        centralParts.push(new Uint8Array(central.buffer), nameBytes);
        offset += 30 + nameBytes.length + size;
    });

    const centralStart = offset;
    const centralSize = centralParts.reduce((a, p) => a + p.length, 0);

    const eocd = new DataView(new ArrayBuffer(22));
    eocd.setUint32(0, 0x06054b50, true);
    eocd.setUint16(4, 0, true);
    eocd.setUint16(6, 0, true);
    eocd.setUint16(8, files.length, true);
    eocd.setUint16(10, files.length, true);
    eocd.setUint32(12, centralSize, true);
    eocd.setUint32(16, centralStart, true);
    eocd.setUint16(20, 0, true);

    const allParts = [...parts, ...centralParts, new Uint8Array(eocd.buffer)];
    const total = allParts.reduce((a, p) => a + p.length, 0);
    const out = new Uint8Array(total);
    let pos = 0;
    allParts.forEach(p => { out.set(p, pos); pos += p.length; });
    return out;
}

// Раунд 110 (по запросу Mr.D: "обратный механизм - выгрузить
// раскрашенную нашими цветами диаграмму") - минимальный styles.xml с
// заливкой ячеек. Симметрично xlsxReader.js (parseStylesXml() там
// ЧИТАЕТ fills/cellXfs) - здесь их ПИШЕМ. Принимает список HEX-цветов
// Раунд 110/111 (по запросу Mr.D: "заливка" + "разлиновка") -
// минимальный styles.xml с заливкой ячеек И тонкой границей по всем
// сторонам. Симметрично xlsxReader.js (parseStylesXml() там ЧИТАЕТ
// fills/cellXfs) - здесь их ПИШЕМ. Принимает МАССИВ УНИКАЛЬНЫХ КЛЮЧЕЙ
// стиля {color, border} (color - HEX без "#" или null/без заливки,
// border - bool) - индекс в массиве = индекс стиля (s="N") минус 1
// (0 зарезервирован под "без заливки, без границы").
function buildStylesXml(styleKeys) {
    // Раунд 111 - тонкая граница по всем 4 сторонам ("разлиновка", по
    // запросу Mr.D) - borderId=1 (borderId=0 - "без границы", ниже).
    const borders = `<borders count="2">` +
        `<border><left/><right/><top/><bottom/><diagonal/></border>` +
        `<border><left style="thin"><color indexed="64"/></left><right style="thin"><color indexed="64"/></right>` +
        `<top style="thin"><color indexed="64"/></top><bottom style="thin"><color indexed="64"/></bottom><diagonal/></border>` +
        `</borders>`;

    // Уникальные цвета (без null) - каждому свой fillId, начиная с 2
    // (0="none", 1="gray125" - зарезервированы стандартом OOXML).
    const uniqueColors = [...new Set(styleKeys.map(k => k.color).filter(Boolean))];
    const colorToFillId = new Map(uniqueColors.map((c, i) => [c, i + 2]));
    const fills = uniqueColors.map(hex =>
        `<fill><patternFill patternType="solid"><fgColor rgb="FF${hex}"/><bgColor indexed="64"/></patternFill></fill>`
    ).join('');

    const cellXfs = styleKeys.map(({ color, border, bold }) => {
        const fillId = color ? colorToFillId.get(color) : 0;
        const borderId = border ? 1 : 0;
        // Раунд 153 (по запросу Mr.D: "чтобы показать иерархию в xlsx мы
        // не будем делать отступы, просто строки групп должны быть
        // жирными") - fontId=1 (жирный, см. <fonts> ниже) для строк-
        // заголовков разделов вместо отступов - плоская, но визуально
        // отличимая структура.
        const fontId = bold ? 1 : 0;
        const applyFill = color ? ' applyFill="1"' : '';
        const applyBorder = border ? ' applyBorder="1"' : '';
        const applyFont = bold ? ' applyFont="1"' : '';
        return `<xf numFmtId="0" fontId="${fontId}" fillId="${fillId}" borderId="${borderId}" xfId="0"${applyFill}${applyBorder}${applyFont}/>`;
    }).join('');

    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
        `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
        `<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>` +
        `<fills count="${uniqueColors.length + 2}">` +
        `<fill><patternFill patternType="none"/></fill>` +
        `<fill><patternFill patternType="gray125"/></fill>` +
        fills +
        `</fills>` +
        borders +
        `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
        `<cellXfs count="${styleKeys.length + 1}">` +
        `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>` +
        cellXfs +
        `</cellXfs>` +
        `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>` +
        `</styleSheet>`;
}

// Раунд 111 - "ключ" стиля ячейки, по которому ищем/заводим индекс в
// styleIndexByKey ("HEX|0|0" - цвет+граница+жирность, Раунд 153 добавил
// третье поле). Единая функция - используется и при сборе уникальных
// стилей, и при поиске индекса конкретной ячейки.
function styleKeyFor(color, border, bold) {
    return `${color || ''}|${border ? 1 : 0}|${bold ? 1 : 0}`;
}

// Раунд 110 - собирает XML листа из ПРОИЗВОЛЬНОЙ сетки (не только
// TableData, как buildSheetXml() выше) - каждая ячейка либо голое
// значение, либо {value, color, border, bold} (color - HEX без "#" или
// null, border/bold - bool). Нужен для календарного экспорта Ганта
// (ganttCalendarExport.js) - там сетка нерегулярная (заголовочные
// строки года/месяца/недели + строки задач), TableData (строго
// табличная форма) для этого не подходит.
function buildGridSheetXml(grid, styleIndexByKey) {
    let rows = '';
    grid.forEach((row, ri) => {
        const cells = row.map((cell, ci) => {
            const isObj = cell !== null && typeof cell === 'object' && !(cell instanceof Date);
            const value = isObj ? cell.value : cell;
            const color = isObj ? cell.color : null;
            const border = isObj ? !!cell.border : false;
            const bold = isObj ? !!cell.bold : false;
            const key = styleKeyFor(color, border, bold);
            const styleIdx = styleIndexByKey.get(key);
            const sAttr = styleIdx ? ` s="${styleIdx}"` : '';
            const ref = `${colLetter(ci)}${ri + 1}`;
            if (value === null || value === undefined || value === '') {
                if (!sAttr) return '';
                return `<c r="${ref}"${sAttr}/>`;
            }
            if (typeof value === 'boolean') {
                return `<c r="${ref}"${sAttr} t="b"><v>${value ? 1 : 0}</v></c>`;
            }
            if (typeof value === 'number' && isFinite(value)) {
                return `<c r="${ref}"${sAttr}><v>${value}</v></c>`;
            }
            return `<c r="${ref}"${sAttr} t="inlineStr"><is><t>${escapeXml(String(value))}</t></is></c>`;
        }).join('');
        rows += `<row r="${ri + 1}">${cells}</row>`;
    });

    return rows;
}

// Собирает XML одного листа из TableData (см. dataTypes.js) - шапка
// (имена столбцов) в строке 1, данные с строки 2. Числа/bool/текст -
// разные типы ячеек OOXML (см. докстринг класса про отсутствие
// sharedStrings.xml - текст всегда inline).
function buildSheetXml(tableData) {
    const headers = tableData.headers;
    const rowCount = tableData.rowCount;

    let rows = `<row r="1">` + headers.map((h, ci) =>
        `<c r="${colLetter(ci)}1" t="inlineStr"><is><t>${escapeXml(h ?? '')}</t></is></c>`
    ).join('') + `</row>`;

    for (let r = 0; r < rowCount; r++) {
        const cells = tableData.columns.map((col, ci) => {
            const v = col.values[r];
            const ref = `${colLetter(ci)}${r + 2}`;
            if (v === null || v === undefined || v === '') return '';
            if (typeof v === 'boolean') {
                return `<c r="${ref}" t="b"><v>${v ? 1 : 0}</v></c>`;
            }
            if (typeof v === 'number' && isFinite(v)) {
                return `<c r="${ref}"><v>${v}</v></c>`;
            }
            return `<c r="${ref}" t="inlineStr"><is><t>${escapeXml(String(v))}</t></is></c>`;
        }).join('');
        rows += `<row r="${r + 2}">${cells}</row>`;
    }

    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
        `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
        `<sheetData>${rows}</sheetData></worksheet>`;
}

export const XlsxWriter = {
    // tableData - экземпляр TableData (utils/dataTypes.js). sheetName -
    // до 31 символа, дальше обрезается (жёсткий лимит Excel).
    build(tableData, sheetName = 'Sheet1') {
        const safeName = escapeXml((sheetName || 'Sheet1').slice(0, 31));

        const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
            `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
            `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
            `<Default Extension="xml" ContentType="application/xml"/>` +
            `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
            `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
            `</Types>`;

        const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
            `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
            `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
            `</Relationships>`;

        const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
            `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ` +
            `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
            `<sheets><sheet name="${safeName}" sheetId="1" r:id="rId1"/></sheets></workbook>`;

        const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
            `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
            `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>` +
            `</Relationships>`;

        const files = [
            { name: '[Content_Types].xml', bytes: textToBytes(contentTypes) },
            { name: '_rels/.rels', bytes: textToBytes(rootRels) },
            { name: 'xl/workbook.xml', bytes: textToBytes(workbookXml) },
            { name: 'xl/_rels/workbook.xml.rels', bytes: textToBytes(workbookRels) },
            { name: 'xl/worksheets/sheet1.xml', bytes: textToBytes(buildSheetXml(tableData)) }
        ];

        return buildZip(files);
    },

    // Раунд 110 (по запросу Mr.D: "обратный механизм - выгрузить
    // раскрашенную нашими цветами диаграмму") - книга из ПРОИЗВОЛЬНОЙ
    // сетки (grid - массив строк, каждая ячейка - голое значение или
    // {value, color, border}, color - HEX без "#", border - bool) с
    // поддержкой заливки/границ ячеек. Раунд 111 (по запросу Mr.D:
    // ширина столбцов + объединение ячеек по месяцам/годам) - options:
    //   colWidths - массив ширины КАЖДОГО столбца в Excel-"units"
    //     (прямая конвертация 1:1 из пикселей - см. ganttCalendarExport.js)
    //   merges - массив {r1,c1,r2,c2} (0-based, включительно) - диапазоны
    //     объединяемых ячеек (год/месяц в шапке календаря).
    buildFromGrid(grid, sheetName = 'Sheet1', options = {}) {
        const { colWidths = [], merges = [] } = options;
        const safeName = escapeXml((sheetName || 'Sheet1').slice(0, 31));

        // Раунд 111 - уникальные КЛЮЧИ стиля (цвет+граница), не только
        // голые цвета - см. styleKeyFor()/buildStylesXml().
        const styleKeysSet = new Map(); // key -> {color, border, bold}
        grid.forEach(row => row.forEach(cell => {
            const isObj = cell !== null && typeof cell === 'object' && !(cell instanceof Date);
            const color = isObj && cell.color ? String(cell.color).replace('#', '').toUpperCase() : null;
            const border = isObj && !!cell.border;
            const bold = isObj && !!cell.bold;
            if (!color && !border && !bold) return; // дефолтный стиль (индекс 0) - заводить не нужно
            const key = styleKeyFor(color, border, bold);
            if (!styleKeysSet.has(key)) styleKeysSet.set(key, { color, border, bold });
        }));
        const styleKeys = [...styleKeysSet.values()];
        const styleIndexByKey = new Map([...styleKeysSet.keys()].map((k, i) => [k, i + 1]));

        const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
            `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
            `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
            `<Default Extension="xml" ContentType="application/xml"/>` +
            `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
            `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
            `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
            `</Types>`;

        const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
            `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
            `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
            `</Relationships>`;

        const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
            `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ` +
            `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
            `<sheets><sheet name="${safeName}" sheetId="1" r:id="rId1"/></sheets></workbook>`;

        const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
            `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
            `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>` +
            `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
            `</Relationships>`;

        // Раунд 111 - <cols> ДОЛЖЕН идти ПЕРЕД <sheetData> (порядок
        // элементов в <worksheet> строго фиксирован спецификацией OOXML).
        const colsXml = colWidths.length
            ? `<cols>` + colWidths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('') + `</cols>`
            : '';
        // <mergeCells> идёт ПОСЛЕ <sheetData>.
        const mergeCellsXml = merges.length
            ? `<mergeCells count="${merges.length}">` + merges.map(m =>
                `<mergeCell ref="${colLetter(m.c1)}${m.r1 + 1}:${colLetter(m.c2)}${m.r2 + 1}"/>`
            ).join('') + `</mergeCells>`
            : '';

        const sheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
            `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
            colsXml +
            `<sheetData>${buildGridSheetXml(grid, styleIndexByKey)}</sheetData>` +
            mergeCellsXml +
            `</worksheet>`;

        const files = [
            { name: '[Content_Types].xml', bytes: textToBytes(contentTypes) },
            { name: '_rels/.rels', bytes: textToBytes(rootRels) },
            { name: 'xl/workbook.xml', bytes: textToBytes(workbookXml) },
            { name: 'xl/_rels/workbook.xml.rels', bytes: textToBytes(workbookRels) },
            { name: 'xl/styles.xml', bytes: textToBytes(buildStylesXml(styleKeys)) },
            { name: 'xl/worksheets/sheet1.xml', bytes: textToBytes(sheetXml) }
        ];

        return buildZip(files);
    },

    // Uint8Array -> base64 - чанками, чтобы не упереться в лимит
    // аргументов String.fromCharCode.apply на больших таблицах.
    bytesToBase64(bytes) {
        let binary = '';
        const chunk = 0x8000;
        for (let i = 0; i < bytes.length; i += chunk) {
            binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
        }
        return btoa(binary);
    }
};
