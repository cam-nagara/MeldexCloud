/* gb-docx-export.js: 外部依存なしの決定的なノートDOCX生成 */
(function (global) {
  'use strict';

  const MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  const encoder = new TextEncoder();

  function xmlText(value) {
    return String(value == null ? '' : value)
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '\uFFFD');
  }

  function xml(value) {
    return xmlText(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  function paragraph(text, style) {
    const styleXml = style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : '';
    if (!text) return `<w:p>${styleXml}</w:p>`;
    return `<w:p>${styleXml}<w:r><w:t xml:space="preserve">${xml(text)}</w:t></w:r></w:p>`;
  }

  function documentXml(title, markdown, options) {
    const blocks = [];
    if (title) blocks.push(paragraph(title, 'Title'));
    const body = String(markdown || '')
      .replace(/\r\n?/g, '\n')
      .replace(/^---\n[\s\S]*?\n---\n?/, '');
    body.split('\n').forEach((line) => {
      const heading = /^(#{1,6})\s+(.+)$/.exec(line);
      blocks.push(heading ? paragraph(heading[2], `Heading${heading[1].length}`) : paragraph(line));
    });
    // 縦書きのノートは、用紙を横向きにして文字方向を縦（tbRl）にする
    const vertical = !!(options && options.vertical);
    const pageSize = vertical
      ? '<w:pgSz w:w="16838" w:h="11906" w:orient="landscape"/><w:textDirection w:val="tbRl"/>'
      : '<w:pgSz w:w="11906" w:h="16838"/>';
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
      + `<w:body>${blocks.join('')}<w:sectPr>${pageSize}`
      + '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>';
  }

  function crc32(bytes) {
    let crc = 0xffffffff;
    for (const byte of bytes) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  function writeU16(bytes, offset, value) {
    bytes[offset] = value & 255;
    bytes[offset + 1] = (value >>> 8) & 255;
  }

  function writeU32(bytes, offset, value) {
    bytes[offset] = value & 255;
    bytes[offset + 1] = (value >>> 8) & 255;
    bytes[offset + 2] = (value >>> 16) & 255;
    bytes[offset + 3] = (value >>> 24) & 255;
  }

  function concatBytes(chunks, totalLength) {
    const output = new Uint8Array(totalLength);
    let offset = 0;
    chunks.forEach((chunk) => {
      output.set(chunk, offset);
      offset += chunk.length;
    });
    return output;
  }

  function localHeader(nameLength, dataLength, crc) {
    const header = new Uint8Array(30);
    writeU32(header, 0, 0x04034b50);
    writeU16(header, 4, 20);
    writeU16(header, 6, 0x0800);
    writeU32(header, 14, crc);
    writeU32(header, 18, dataLength);
    writeU32(header, 22, dataLength);
    writeU16(header, 26, nameLength);
    return header;
  }

  function centralHeader(nameLength, dataLength, crc, offset) {
    const header = new Uint8Array(46);
    writeU32(header, 0, 0x02014b50);
    writeU16(header, 4, 20);
    writeU16(header, 6, 20);
    writeU16(header, 8, 0x0800);
    writeU32(header, 16, crc);
    writeU32(header, 20, dataLength);
    writeU32(header, 24, dataLength);
    writeU16(header, 28, nameLength);
    writeU32(header, 42, offset);
    return header;
  }

  function storedZip(entries) {
    const localChunks = [];
    const centralChunks = [];
    let offset = 0;
    let centralLength = 0;
    Object.entries(entries).forEach(([name, source]) => {
      const nameBytes = encoder.encode(name);
      const data = encoder.encode(source);
      const crc = crc32(data);
      const local = localHeader(nameBytes.length, data.length, crc);
      const central = centralHeader(nameBytes.length, data.length, crc, offset);
      localChunks.push(local, nameBytes, data);
      centralChunks.push(central, nameBytes);
      offset += local.length + nameBytes.length + data.length;
      centralLength += central.length + nameBytes.length;
    });
    const count = Object.keys(entries).length;
    const end = new Uint8Array(22);
    writeU32(end, 0, 0x06054b50);
    writeU16(end, 8, count);
    writeU16(end, 10, count);
    writeU32(end, 12, centralLength);
    writeU32(end, 16, offset);
    return concatBytes(
      localChunks.concat(centralChunks, [end]),
      offset + centralLength + end.length
    );
  }

  function create(title, markdown, options) {
    const entries = {
      '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8"?>'
        + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        + '<Default Extension="xml" ContentType="application/xml"/>'
        + '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
        + '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'
        + '</Types>',
      '_rels/.rels': '<?xml version="1.0" encoding="UTF-8"?>'
        + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
        + '</Relationships>',
      'word/_rels/document.xml.rels': '<?xml version="1.0" encoding="UTF-8"?>'
        + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
        + '</Relationships>',
      'word/document.xml': documentXml(title, markdown, options),
      'word/styles.xml': '<?xml version="1.0" encoding="UTF-8"?>'
        + '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
        + '<w:style w:type="paragraph" w:styleId="Normal" w:default="1"><w:name w:val="Normal"/></w:style>'
        + '<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/></w:style>'
        + Array.from({ length: 6 }, (_, index) => `<w:style w:type="paragraph" w:styleId="Heading${index + 1}"><w:name w:val="heading ${index + 1}"/><w:basedOn w:val="Normal"/></w:style>`).join('')
        + '</w:styles>',
    };
    return new Blob([storedZip(entries)], { type: MIME });
  }

  global.MeldexDocxExport = Object.freeze({ MIME, create });
})(typeof window !== 'undefined' ? window : globalThis);
