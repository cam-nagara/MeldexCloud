    if ((text.startsWith('{') && text.endsWith('}')) || (text.startsWith('[') && text.endsWith(']'))) {
      const inline = _pmYamlInline(text);
      if (inline !== undefined) return inline;
    }
    if (text === 'true') return true;
    if (text === 'false') return false;
    if (text === 'null') return null;
    if (/^-?\d+(?:\.\d+)?$/.test(text)) return Number(text);
    return text.replace(/^['"]|['"]$/g, '');
  }

  function _pmYamlInline(text) {
    if (text.startsWith('[') && text.endsWith(']')) {
      const body = text.slice(1, -1).trim();
      return body ? _pmYamlSplitInline(body).map(_pmYamlScalar) : [];
    }
    if (text.startsWith('{') && text.endsWith('}')) {
      const body = text.slice(1, -1).trim();
      const out = {};
      if (!body) return out;
      _pmYamlSplitInline(body).forEach((part) => {
        const pair = _pmYamlPair(part);
        if (pair) out[pair.key] = _pmYamlScalar(pair.raw);
      });
      return out;
    }
    return undefined;
  }

  function _pmYamlSplitInline(text) {
    const parts = [];
    let quote = '';
    let depth = 0;
    let start = 0;
    const value = String(text || '');
    for (let i = 0; i < value.length; i += 1) {
      const ch = value[i];
      if (quote) {
        if (ch === quote && value[i - 1] !== '\\') quote = '';
      } else if (ch === '"' || ch === "'") quote = ch;
      else if (ch === '{' || ch === '[') depth += 1;
      else if (ch === '}' || ch === ']') depth -= 1;
      else if (ch === ',' && depth === 0) {
        parts.push(value.slice(start, i).trim());
        start = i + 1;
      }
    }
    parts.push(value.slice(start).trim());
    return parts.filter(Boolean);
  }

  function _pmCloudFrontmatterText(frontmatter, body) {
    const lines = ['---'];
    Object.entries(frontmatter || {}).forEach(([key, value]) => {
      if (!key || key.startsWith('_')) return;
      lines.push(`${key}: ${JSON.stringify(value == null ? '' : value)}`);
    });
    lines.push('---', '');
    return lines.join('\n') + String(body || '');
  }

  async function _pmCloudUpsertEntry(provider, internals, sheet, name, props, keyProp, keyValue) {
    const existing = keyProp && keyValue ? await _pmCloudFindByProp(provider, internals, sheet, keyProp, keyValue) : '';
    const safeName = _pmSafeName(existing ? internals._basename(existing).replace(/\.md$/i, '') : name);
    let path = existing || internals._joinPath(_pmCloudRoot(internals), sheet, safeName + '.md');
    if (!existing && await _pmCloudEntryExists(provider, path, internals)) {
      const suffix = _pmHash([sheet, keyProp || '', keyValue || '', JSON.stringify(props || {})].join('|')).slice(0, 8);
      path = internals._joinPath(_pmCloudRoot(internals), sheet, `${safeName}-${suffix}.md`);
    }
    const parsed = await _pmCloudReadFrontmatter(provider, path);
    const fm = { ...(parsed.frontmatter || {}) };
    fm.type = 'settings-entry';
    fm.id = fm.id || 'ent_' + _pmHash(path).slice(0, 10);
    fm.category = sheet;
    fm.modified = new Date().toISOString();
    fm.properties = { ...(fm.properties || {}) };
    Object.entries(props || {}).forEach(([prop, value]) => {
      if (value == null || value === '') return;
      fm.properties[prop] = [{ value: String(value), status: '採用', note: '', created: new Date().toISOString() }];
    });
    await provider.writeText(path, _pmCloudFrontmatterText(fm, parsed.body || ''));
    return path;
  }

  async function _pmCloudFindByProp(provider, internals, sheet, prop, value) {
    for (const entry of await _pmCloudListEntries(provider, internals, sheet)) {
      if (_pmCloudPropValue(entry.frontmatter, prop) === String(value)) return entry.path;
    }
    return '';
  }

  async function _pmCloudListEntries(provider, internals, sheet) {
    const dir = internals._joinPath(_pmCloudRoot(internals), sheet);
    const entries = await internals._listDirectoryEntries(provider, dir).catch(() => []);
    const result = [];
    for (const entry of entries) {
      if (entry.handle.kind !== 'file' || !entry.name.endsWith('.md') || entry.name === sheet + '.md') continue;
      const path = internals._joinPath(dir, entry.name);
      const parsed = await _pmCloudReadFrontmatter(provider, path);
      result.push({ path, name: entry.name.replace(/\.md$/i, ''), frontmatter: parsed.frontmatter || {}, body: parsed.body || '' });
    }
    return result;
  }

  function _pmCloudPropValue(fm, prop) {
    const values = fm?.properties?.[prop] || [];
    const list = Array.isArray(values) ? values : [values];
    const found = list.find(v => v && (v.status === '採用' || v.status === '掲載済み')) || list[0];
    return found && typeof found === 'object' ? String(found.value || '') : String(found || '');
  }

  function _pmBuildTaskRows(body) {
    const workTitle = String(body.work_title || body['作品タイトル'] || '無題作品');
    const pageCount = Math.max(1, Number(body.page_count || body['ページ数'] || 1) || 1);
    const granularity = String(body.granularity || body['作業作成粒度'] || 'ページ単位');
    const panels = Math.max(1, Number(body.panel_count || body['コマ数'] || 1) || 1);
    const targets = _pmList(body.target_names || body['作業対象リスト'] || '全体');
    const contents = _pmList(body.content_names || body['作業内容リスト'] || 'ネーム');
    const scales = _pmList(body.scale_names || body['作業規模リスト'] || 'ページ全体');
    const rows = [];
    for (let page = 1; page <= pageCount; page += 1) {
      const pageLabel = 'p' + String(page).padStart(3, '0');
      const panelList = granularity === 'コマ単位' ? Array.from({ length: panels }, (_, i) => 'c' + String(i + 1).padStart(2, '0')) : ['全体'];
      panelList.forEach(panel => targets.forEach(target => contents.forEach(content => scales.forEach((scale) => {
        const key = [workTitle, granularity, pageLabel, panel, target, content, scale].join('|');
        rows.push({ 'タスク名': _pmTaskTitle(pageLabel, panel, target, scale, content), '作品タイトル': workTitle, 'ページ': pageLabel, 'コマ': panel, '作業作成粒度': granularity, '作業対象リスト': target, '作業内容リスト': content, '作業規模リスト': scale, '対象数': '1', '状況': '未着手', '目標作業時間_値': '1', 'ページソート値': String(page), '作成キー': key });
      }))));
    }
    return rows;
  }

  function _pmList(value) {
    if (Array.isArray(value)) return value.map(v => String(v).trim()).filter(Boolean);
    return String(value || '').split(/[,、\n]/).map(v => v.trim()).filter(Boolean);
  }

  function _pmTaskTitle(page, panel, target, scale, content) {
    return [page, panel, target === '全体' ? '' : target, scale === 'ページ全体' ? '' : scale, content].filter(Boolean).join(' ');
  }

  function _pmNormalizeIncomingShift(row) {
    if (!row) return null;
    const user = String(row.user || row['担当者'] || row['スタッフ名'] || '').trim();
    const date = _pmDate(row.date || row['日付']);
    if (!user || !date) return null;
    return { user, date, start_time: _pmTime(row.start_time || row['開始時刻'] || row.start), end_time: _pmTime(row.end_time || row['終了時刻'] || row.end), type: _pmShiftType(row.type || row['種別']), note: String(row.note || row['備考'] || '') };
  }

  function _pmScheduleProps(row, id) {
    const label = _pmScheduleTypeLabel(row.type);
    return { '予定名': `${label} ${row.user}`, '種別': label, '担当者': row.user, '予定日時': _pmDateRange(row.date, row.start_time, row.end_time), '開始時刻': row.start_time, '終了時刻': row.end_time, 'カレンダーID': `shift:${id}`, '作成キー': id, '備考': row.note };
  }

  function _pmScheduleTypeLabel(type) {
    return type === 'off' || type === 'holiday' ? '休み' : 'シフト';
  }

  function _pmDateRange(date, start, end) {
    if (!start) return date;
    const endDate = end && end <= start ? _pmAddDay(date) : date;
    return `${date}T${start}|${endDate}T${end || start}`;
  }

  function _pmAddDay(date) {
    const d = new Date(date + 'T00:00:00');
    d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 10);
  }

  function _pmDateTime(date, time) {
    return new Date(`${date}T${time || '00:00'}`);
  }

  function _pmShiftEndDateTime(row) {
    return _pmDateTime(_pmCloudShiftEndDate(row), row.end_time || row.start_time || '00:00');
  }

  function _pmDateTimeText(value) {
    const pad = n => String(n).padStart(2, '0');
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}T${pad(value.getHours())}:${pad(value.getMinutes())}`;
  }

  function _pmShiftId(row) {
    return 'pm-shift-' + _pmHash([row.user, row.date, row.start_time, row.end_time, row.type].join('|')).slice(0, 20);
  }

  function _pmSafeName(value) {
    return String(value || '無題').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').trim().slice(0, 100) || '無題';
  }

  function _pmHash(value) {
    let hash = 2166136261;
    String(value || '').split('').forEach((ch) => {
      hash ^= ch.charCodeAt(0);
      hash = Math.imul(hash, 16777619);
    });
    return (hash >>> 0).toString(16) + Math.abs(String(value || '').length).toString(16);
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

  window.openProductionManagementStart = openProductionManagementStart;
  window.openProductionShiftImport = openProductionShiftImport;
  window.openProductionTaskCreate = openProductionTaskCreate;
  window.runProductionAssignment = runProductionAssignment;
  window.openProductionExport = openProductionExport;
  window.MeldexCloudShiftSync = { sync: _pmSyncCloudShiftEvent, remove: _pmRemoveCloudShiftEvent };
  window.MeldexProductionManagement = { parseCsv: _pmParseCsv, rowsToShifts: _pmRowsToShifts, buildTaskRows: _pmBuildTaskRows };

  _pmInstallCloudHandler();
})();
