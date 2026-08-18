  // gb-production-management-cloud-spreadsheet-io.js: シフト取込CSV/XLSX解析と
  // CSV/XLSX/ZIP書き出しユーティリティ（責務単位分割 2026-08-12。旧
  // gb-production-management.part03.js）。
  //
  // gb-production-management.part01.js 〜 gb-production-management-cloud-save-hooks.js は
  // 同じ共有クロージャ（IIFEの raw concatenation）に属し、このファイル自体は自前のIIFEを
  // 持たない。IIFEの開始は gb-production-management.part01.js、終了は読み込み順で最後になる
  // gb-production-management-cloud-save-hooks.js にある（読み込み順は gb-production-management.js
  // を参照）。同一クロージャのため呼び出し元との参照は変わらず解決できる。
  //
  // 呼び出し元 openProductionShiftImport は gb-production-management-cloud-dialogs.js にある。

  async function _pmParseShiftFile(file) {
    if (!file) return [];
    if (/\.xlsx$/i.test(file.name)) return PM_SHIFT_PARSER.rowsToShifts(await _pmReadXlsx(file));
    return PM_SHIFT_PARSER.rowsToShifts(PM_SHIFT_PARSER.parseCsv(await file.text()));
  }

  async function _pmReadXlsx(file) {
    if (window.XLSX?.read) {
      const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      const first = workbook.SheetNames[0];
      return XLSX.utils.sheet_to_json(workbook.Sheets[first], { header: 1, raw: false });
    }
    const files = await _pmUnzipStoreOrDeflate(await file.arrayBuffer());
    return _pmWorksheetRows(files);
  }

  async function _pmUnzipStoreOrDeflate(buffer) {
    const view = new DataView(buffer);
    const files = {};
    let offset = 0;
    while (offset + 30 < view.byteLength && view.getUint32(offset, true) === 0x04034b50) {
      const method = view.getUint16(offset + 8, true);
      const compressed = view.getUint32(offset + 18, true);
      const nameLen = view.getUint16(offset + 26, true);
      const extraLen = view.getUint16(offset + 28, true);
      const nameBytes = new Uint8Array(buffer, offset + 30, nameLen);
      const name = new TextDecoder().decode(nameBytes);
      const dataStart = offset + 30 + nameLen + extraLen;
      const data = buffer.slice(dataStart, dataStart + compressed);
      files[name] = method === 8 ? await _pmInflateRaw(data) : new Uint8Array(data);
      offset = dataStart + compressed;
    }
    return files;
  }

  async function _pmInflateRaw(buffer) {
    if (!window.DecompressionStream) throw new Error('このブラウザではExcel解析を利用できません。CSVで取り込んでください');
    const stream = new Blob([buffer]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  function _pmWorksheetRows(files) {
    const decoder = new TextDecoder();
    const shared = _pmSharedStrings(decoder.decode(files['xl/sharedStrings.xml'] || new Uint8Array()));
    const sheetName = Object.keys(files).find(name => /^xl\/worksheets\/sheet\d+\.xml$/.test(name));
    const xml = decoder.decode(files[sheetName] || new Uint8Array());
    const rows = [];
    xml.replace(/<row[^>]*>([\s\S]*?)<\/row>/g, (_, rowXml) => {
      const row = [];
      rowXml.replace(/<c([^>]*)>([\s\S]*?)<\/c>/g, (__, attrs, cellXml) => {
        const ref = (attrs.match(/\sr="([A-Z]+)\d+"/) || [])[1] || '';
        const index = _pmColIndex(ref);
        const type = (attrs.match(/\st="([^"]+)"/) || [])[1] || '';
        const raw = (cellXml.match(/<v[^>]*>([\s\S]*?)<\/v>/) || [])[1] || '';
        const inline = (cellXml.match(/<t[^>]*>([\s\S]*?)<\/t>/) || [])[1] || '';
        row[index] = type === 's'
          ? (shared[Number(raw)] || '')
          : type === 'inlineStr'
            ? _pmXmlText(inline)
            : _pmXmlText(raw);
        return '';
      });
      if (row.some(v => String(v || '').trim())) rows.push(row);
      return '';
    });
    return rows;
  }

  function _pmSharedStrings(xml) {
    const values = [];
    xml.replace(/<si[^>]*>([\s\S]*?)<\/si>/g, (_, item) => {
      const parts = [];
      item.replace(/<t[^>]*>([\s\S]*?)<\/t>/g, (__, text) => {
        parts.push(_pmXmlText(text));
        return '';
      });
      values.push(parts.join(''));
      return '';
    });
    return values;
  }

  function _pmXmlText(value) {
    return String(value || '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"');
  }

  function _pmColIndex(col) {
    let n = 0;
    String(col || '').split('').forEach(ch => { n = n * 26 + ch.charCodeAt(0) - 64; });
    return Math.max(0, n - 1);
  }

  function _pmBase64Blob(base64, mime) {
    const binary = atob(base64 || '');
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: mime || 'application/octet-stream' });
  }

  function _pmRowsCsv(rows) {
    const headers = ['種別', '担当者', '日付', '開始', '終了', '内容', '備考'];
    const lines = [headers.join(',')];
    rows.forEach(row => lines.push(headers.map(header => _pmCsvCell(row[header])).join(',')));
    return '\uFEFF' + lines.join('\r\n') + '\r\n';
  }

  function _pmCsvCell(value) {
    const text = String(value == null ? '' : value);
    return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
  }

  async function _pmBlobBase64(blob) {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = '';
    bytes.forEach(byte => { binary += String.fromCharCode(byte); });
    return btoa(binary);
  }

  function _pmXlsxBlob(rows) {
    const headers = ['種別', '担当者', '日付', '開始', '終了', '内容', '備考'];
    const sheetRows = [headers, ...rows.map(row => headers.map(header => row[header] || ''))];
    const worksheet = _pmWorksheetXml(sheetRows);
    const files = {
      '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
      '_rels/.rels': '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
      'xl/workbook.xml': '<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="制作管理" sheetId="1" r:id="rId1"/></sheets></workbook>',
      'xl/_rels/workbook.xml.rels': '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
      'xl/worksheets/sheet1.xml': worksheet,
    };
    return new Blob([_pmZipStore(files)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }

  function _pmWorksheetXml(rows) {
    const body = rows.map((row, rIndex) => '<row r="' + (rIndex + 1) + '">' + row.map((value, cIndex) => {
      const ref = _pmColumnName(cIndex + 1) + (rIndex + 1);
      return `<c r="${ref}" t="inlineStr"><is><t>${_pmXmlEscape(value)}</t></is></c>`;
    }).join('') + '</row>').join('');
    return '<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' + body + '</sheetData></worksheet>';
  }

  function _pmColumnName(index) {
    let name = '';
    let n = index;
    while (n > 0) {
      const rem = (n - 1) % 26;
      name = String.fromCharCode(65 + rem) + name;
      n = Math.floor((n - 1) / 26);
    }
    return name;
  }

  function _pmXmlEscape(value) {
    return String(value == null ? '' : value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function _pmZipStore(files) {
    const parts = [];
    const central = [];
    let offset = 0;
    Object.entries(files).forEach(([name, text]) => {
      const nameBytes = _pmUtf8(name);
      const data = _pmUtf8(text);
      const crc = _pmCrc32(data);
      const local = _pmZipHeader(0x04034b50, nameBytes, data, crc, offset);
      parts.push(local, data);
      central.push(_pmZipHeader(0x02014b50, nameBytes, data, crc, offset));
      offset += local.length + data.length;
    });
    const centralOffset = offset;
    central.forEach(part => { parts.push(part); offset += part.length; });
    parts.push(_pmEndCentral(central.length, offset - centralOffset, centralOffset));
    return _pmConcat(parts);
  }

  function _pmZipHeader(signature, nameBytes, data, crc, offset) {
    const isCentral = signature === 0x02014b50;
    const size = isCentral ? 46 : 30;
    const out = new Uint8Array(size + nameBytes.length);
    const view = new DataView(out.buffer);
    view.setUint32(0, signature, true);
    if (isCentral) {
      view.setUint16(4, 20, true);
      view.setUint16(6, 20, true);
      view.setUint32(16, crc, true);
      view.setUint32(20, data.length, true);
      view.setUint32(24, data.length, true);
      view.setUint16(28, nameBytes.length, true);
      view.setUint32(42, offset, true);
      out.set(nameBytes, 46);
    } else {
      view.setUint16(4, 20, true);
      view.setUint32(14, crc, true);
      view.setUint32(18, data.length, true);
      view.setUint32(22, data.length, true);
      view.setUint16(26, nameBytes.length, true);
      out.set(nameBytes, 30);
    }
    return out;
  }

  function _pmEndCentral(count, size, offset) {
    const out = new Uint8Array(22);
    const view = new DataView(out.buffer);
    view.setUint32(0, 0x06054b50, true);
    view.setUint16(8, count, true);
    view.setUint16(10, count, true);
    view.setUint32(12, size, true);
    view.setUint32(16, offset, true);
    return out;
  }

  function _pmUtf8(value) {
    return new TextEncoder().encode(String(value || ''));
  }

  function _pmConcat(parts) {
    const size = parts.reduce((sum, part) => sum + part.length, 0);
    const out = new Uint8Array(size);
    let offset = 0;
    parts.forEach((part) => {
      out.set(part, offset);
      offset += part.length;
    });
    return out;
  }

  function _pmCrc32(bytes) {
    let crc = -1;
    for (let i = 0; i < bytes.length; i += 1) {
      crc ^= bytes[i];
      for (let j = 0; j < 8; j += 1) crc = (crc >>> 1) ^ (0xEDB88320 & -(crc & 1));
    }
    return (crc ^ -1) >>> 0;
  }
