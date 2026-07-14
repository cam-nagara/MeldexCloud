        color: body?.color || '#569cd6',
        location: event.location || '',
        url: event.url || '',
        description: event.description || '',
        recurrence: event.recurrence || '',
        alert_minutes: Number.isFinite(Number(event.alert_minutes)) ? Number(event.alert_minutes) : -1,
        calendar_id: body?.calendar_id || 'default',
        creator: body?.creator || body?.user || '',
        members: [],
      };
      if (found) {
        const next = await _calendarDbUpdate(provider, found.name, payload);
        Object.assign(found, payload, { name: next.name, path: next.path });
        updated += 1;
      } else {
        const created = await _calendarDbCreate(provider, payload);
        existing.push({ ...payload, name: created.name, path: created.path });
        imported += 1;
      }
    }
    return { ok: true, imported, updated };
  }

  function _sheetImportCellText(value) {
    if (value == null) return '';
    const num = Number(value);
    if (typeof value === 'number' && Number.isInteger(num)) return String(num);
    return String(value).trim();
  }

  function _sheetImportPropertyName(value) {
    return _sheetImportCellText(value).replace(/\s+/g, ' ').trim();
  }

  function _sheetImportHeaders(rawHeaders) {
    const headers = [];
    const seen = new Map();
    (rawHeaders || []).forEach((raw, index) => {
      const base = _sheetImportPropertyName(raw) || (index === 0 ? 'Name' : '列' + (index + 1));
      const count = seen.get(base) || 0;
      seen.set(base, count + 1);
      headers.push(count ? base + '_' + (count + 1) : base);
    });
    return headers;
  }

  function _sheetImportDateSpec(header, values) {
    const headerText = _sheetImportCellText(header).toLowerCase();
    const texts = (values || []).map(_sheetImportCellText).filter(Boolean);
    if (!texts.length) return null;
    const dateLike = texts.filter(text => (
      /^\d{4}[-/]\d{1,2}[-/]\d{1,2}(?:[ T]\d{1,2}:\d{2}(?::\d{2})?)?$/.test(text)
      || /^\d{1,2}[-/]\d{1,2}(?:[ T]\d{1,2}:\d{2}(?::\d{2})?)?$/.test(text)
    ));
    const headerSuggestsDate = /date|time|start|end|due|期限|日付|日時|開始|終了|時刻/.test(headerText);
    if (!dateLike.length || (!headerSuggestsDate && dateLike.length < texts.length)) return null;
    return {
      type: 'date',
      withTime: dateLike.some(text => /\d{1,2}:\d{2}/.test(text)),
      range: texts.some(text => /(?:\s+-\s+|〜|~)/.test(text)),
    };
  }

  function _sheetImportPropertySpecs(rawHeaders, headers, rows) {
    const specs = {};
    headers.slice(1).forEach((propName, offset) => {
      const index = offset + 1;
      const spec = _sheetImportDateSpec(rawHeaders?.[index], (rows || []).map(row => row?.[index]));
      if (spec) specs[propName] = spec;
    });
    return specs;
  }

  async function _mergeSheetImportPropertyTypes(provider, dbPath, specs) {
    if (!specs || !Object.keys(specs).length) return;
    const notePath = await _folderNotePath(provider, dbPath);
    if (!notePath) return;
    await _requireUnlocked(provider, notePath, { action: 'import-csv-metadata' });
    const parsed = await _readFrontmatterFile(provider, notePath);
    const frontmatter = { ...(parsed.frontmatter || {}) };
    const propertyTypes = frontmatter.property_types && typeof frontmatter.property_types === 'object' ? { ...frontmatter.property_types } : {};
    let changed = false;
    Object.entries(specs).forEach(([propName, spec]) => {
      const current = propertyTypes[propName] && typeof propertyTypes[propName] === 'object' ? { ...propertyTypes[propName] } : null;
      if (!current) {
        propertyTypes[propName] = { ...spec };
        changed = true;
        return;
      }
      if (current.type !== 'date') return;
      ['withTime', 'range'].forEach(key => {
        if (spec[key] && !current[key]) {
          current[key] = true;
          changed = true;
        }
      });
      propertyTypes[propName] = current;
    });
    if (!changed) return;
    frontmatter.property_types = propertyTypes;
    await _writeFrontmatterFile(provider, notePath, frontmatter, parsed.body || '');
  }

  function _parseImportCsv(text) {
    const normalized = String(text || '').replace(/^\uFEFF/, '');
    const rows = [];
    let row = [];
    let cell = '';
    let inQuote = false;
    let sawCell = false;
    for (let i = 0; i < normalized.length; i += 1) {
      const ch = normalized[i];
      if (inQuote) {
        if (ch === '"' && normalized[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else if (ch === '"') {
          inQuote = false;
        } else {
          cell += ch;
        }
        continue;
      }
      if (ch === '"') {
        inQuote = true;
        sawCell = true;
      } else if (ch === ',') {
        row.push(cell);
        cell = '';
        sawCell = true;
      } else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && normalized[i + 1] === '\n') i += 1;
        row.push(cell);
        rows.push(row);
        row = [];
        cell = '';
        sawCell = false;
      } else {
        cell += ch;
        sawCell = true;
      }
    }
    if (sawCell || cell || row.length) {
      row.push(cell);
      rows.push(row);
    }
    return rows;
  }

  async function _importCsvToDb(provider, body) {
    const csvPath = _normalizeFolderPath(body?.csv_path || body?.csvPath || '');
    const dbPath = _normalizeFolderPath(body?.db_path || body?.dbPath || '');
    if (!csvPath || !dbPath) throw new Error('csv_path and db_path required');
    const csvEntry = await _resolveEntryHandle(provider, csvPath);
    if (!csvEntry || csvEntry.kind !== 'file') throw new Error('CSV not found');
    const rows = _parseImportCsv(await provider.readText(csvPath));
    if (!rows.length) return { ok: true, count: 0 };
    const headers = _sheetImportHeaders(rows[0]);
    if (!headers.length) return { ok: true, count: 0 };
    await _requireUnlocked(provider, dbPath, { action: 'import-csv' });
    await _ensureFolderNote(provider, dbPath, 'settings-db');
    await _mergeSheetImportPropertyTypes(provider, dbPath, _sheetImportPropertySpecs(rows[0], headers, rows.slice(1)));
    let count = 0;
    for (const row of rows.slice(1)) {
      const entityName = _sheetImportCellText(row?.[0]);
      if (!entityName) continue;
      const properties = {};
      headers.slice(1).forEach((propName, offset) => {
        if (!propName) return;
        const rawText = _sheetImportCellText(row?.[offset + 1]);
        if (!rawText) return;
        if (!properties[propName]) properties[propName] = [];
        properties[propName].push({ value: rawText, status: '採用', note: '', created: _nowIso() });
      });
      await _createEntity(provider, {
        parent_path: dbPath,
        name: entityName,
        properties,
        source: 'csv-import',
        user: body?.user || 'anonymous',
      });
      count += 1;
    }
    return { ok: true, count };
  }

  function _yamlFlowSplit(text) {
    const parts = [];
    let buf = '';
    let quote = '';
    let depth = 0;
    String(text || '').split('').forEach((ch) => {
      if (quote) {
        buf += ch;
        if (ch === quote && !buf.endsWith('\\' + ch)) quote = '';
        return;
      }
      if (ch === '"' || ch === "'") {
        quote = ch;
        buf += ch;
        return;
      }
      if (ch === '{' || ch === '[') depth += 1;
      if (ch === '}' || ch === ']') depth = Math.max(0, depth - 1);
      if (ch === ',' && depth === 0) {
        parts.push(buf.trim());
        buf = '';
      } else {
        buf += ch;
      }
    });
    if (buf.trim()) parts.push(buf.trim());
    return parts;
  }

  function _yamlPairIndex(text) {
    let quote = '';
    let depth = 0;
    for (let i = 0; i < String(text || '').length; i += 1) {
      const ch = text[i];
      if (quote) {
        if (ch === quote && text[i - 1] !== '\\') quote = '';
        continue;
      }
      if (ch === '"' || ch === "'") {
        quote = ch;
        continue;
      }
      if (ch === '{' || ch === '[') depth += 1;
      else if (ch === '}' || ch === ']') depth = Math.max(0, depth - 1);
      else if (ch === ':' && depth === 0) return i;
    }
    return -1;
  }

  function _yamlLiteScalar(raw) {
    const value = String(raw == null ? '' : raw).trim();
    if (!value) return '';
    if (value === '{}') return {};
    if (value === '[]') return [];
    if (value.startsWith('{') && value.endsWith('}')) {
      const obj = {};
      _yamlFlowSplit(value.slice(1, -1)).forEach((part) => {
        const idx = _yamlPairIndex(part);
        if (idx <= 0) return;
        const key = part.slice(0, idx).trim().replace(/^['"]|['"]$/g, '');
        obj[key] = _yamlLiteScalar(part.slice(idx + 1));
      });
      return obj;
    }
    if (value.startsWith('[') && value.endsWith(']')) return _yamlFlowSplit(value.slice(1, -1)).map(_yamlLiteScalar);
    return _parseFrontmatterValue(value);
  }

  function _yamlLiteIsOpenQuotedScalar(text) {
    const value = String(text || '').trim();
    const quote = value[0];
    return (quote === "'" || quote === '"') && !(value.length > 1 && value.endsWith(quote));
  }

  function _yamlLiteMergeQuotedLines(rawLines) {
    const merged = [];
    let pending = null;
    let quote = '';
    rawLines.forEach((raw) => {
      const line = String(raw || '');
      if (pending) {
        pending += '\n' + line.trim();
        if (pending.trim().endsWith(quote)) {
          merged.push(pending);
          pending = null;
          quote = '';
        }
        return;
      }
      const idx = _yamlPairIndex(line.trim());
      const value = idx >= 0 ? line.trim().slice(idx + 1).trim() : '';
      if (_yamlLiteIsOpenQuotedScalar(value)) {
        pending = line;
        quote = value[0];
        return;
      }
      merged.push(line);
    });
    if (pending) merged.push(pending);
    return merged;
  }

  function _yamlLiteObject(text) {
    const lines = _yamlLiteMergeQuotedLines(String(text || '').replace(/\t/g, '  ').split(/\r?\n/))
      .map((raw) => ({ raw, indent: (String(raw || '').match(/^ */) || [''])[0].length, text: String(raw || '').trim() }))
      .filter(line => line.text && !line.text.startsWith('#'));

    function readBlockScalar(index, baseIndent, folded) {
      const chunks = [];
      while (index < lines.length && lines[index].indent > baseIndent) {
        chunks.push(String(lines[index].raw || '').slice(Math.min(lines[index].raw.length, baseIndent + 2)));
        index += 1;
      }
      const value = folded ? chunks.join(' ').replace(/\s+/g, ' ').trim() : chunks.join('\n').replace(/\n+$/g, '');
      return { value, index };
    }

    function parseBlock(index) {
      if (index >= lines.length) return { value: '', index };
      return lines[index].text.startsWith('- ') ? parseArray(index, lines[index].indent) : parseObject(index, lines[index].indent);
    }

    function parseObject(index, baseIndent) {
      const obj = {};
      while (index < lines.length) {
        const line = lines[index];
        if (line.indent < baseIndent || line.text.startsWith('- ')) break;
        if (line.indent > baseIndent) {
          index += 1;
          continue;
        }
        const idx = _yamlPairIndex(line.text);
        if (idx <= 0) {
          index += 1;
          continue;
        }
        const key = line.text.slice(0, idx).trim();
        const rawValue = line.text.slice(idx + 1).trim();
        if (/^[>|][+-]?$/.test(rawValue)) {
          const scalar = readBlockScalar(index + 1, line.indent, rawValue[0] === '>');
          obj[key] = scalar.value;
          index = scalar.index;
          continue;
        }
        if (rawValue) {
          obj[key] = _yamlLiteScalar(rawValue);
          index += 1;
          continue;
        }
        const next = lines[index + 1];
        const hasChild = next && (next.indent > line.indent || (next.indent === line.indent && next.text.startsWith('- ')));
        if (hasChild) {
          const child = parseBlock(index + 1);
          obj[key] = child.value;
          index = child.index;
        } else {
          obj[key] = '';
          index += 1;
        }
      }
      return { value: obj, index };
    }

    function parseArray(index, baseIndent) {
      const arr = [];
      while (index < lines.length) {
        const line = lines[index];
        if (line.indent < baseIndent || line.indent !== baseIndent || !line.text.startsWith('- ')) break;
        const rawValue = line.text.slice(2).trim();
        if (!rawValue) {
          const child = lines[index + 1] && lines[index + 1].indent > baseIndent ? parseBlock(index + 1) : { value: '', index: index + 1 };
          arr.push(child.value);
          index = child.index;
          continue;
        }
        const idx = _yamlPairIndex(rawValue);
        let item = idx > 0 ? { [rawValue.slice(0, idx).trim()]: _yamlLiteScalar(rawValue.slice(idx + 1)) } : _yamlLiteScalar(rawValue);
        index += 1;
        while (index < lines.length && lines[index].indent > baseIndent) {
          const childLine = lines[index];
          const childIdx = _yamlPairIndex(childLine.text);
          if (childIdx <= 0 || !item || typeof item !== 'object' || Array.isArray(item)) break;
          const key = childLine.text.slice(0, childIdx).trim();
          const rawChild = childLine.text.slice(childIdx + 1).trim();
          if (/^[>|][+-]?$/.test(rawChild)) {
            const scalar = readBlockScalar(index + 1, childLine.indent, rawChild[0] === '>');
            item[key] = scalar.value;
            index = scalar.index;
            continue;
          }
          if (rawChild) {
            item[key] = _yamlLiteScalar(rawChild);
            index += 1;
            continue;
          }
          const next = lines[index + 1];
          const hasChild = next && (next.indent > childLine.indent || (next.indent === childLine.indent && next.text.startsWith('- ')));
          if (hasChild) {
            const parsed = parseBlock(index + 1);
            item[key] = parsed.value;
            index = parsed.index;
          } else {
            item[key] = '';
            index += 1;
          }
        }
        arr.push(item);
      }
      return { value: arr, index };
    }

    const parsed = parseBlock(0);
    return parsed.value && typeof parsed.value === 'object' && !Array.isArray(parsed.value) ? parsed.value : {};
  }

  function _isWorkspaceScanExcluded(path) {
    const normalized = _normalizeFolderPath(path);
    const parsedSource = window.MeldexSourceFolderRegistry?.parseSourcePath?.(normalized);
    const relative = _normalizeFolderPath(parsedSource?.relativePath ?? normalized);
    const parts = relative.split('/').filter(Boolean);
    if (parts.some(part => part.startsWith('.'))) return true;
    return WORKSPACE_SCAN_EXCLUDES.some(prefix => relative === prefix.replace(/\/$/, '') || relative.startsWith(prefix));
  }

  function _safeVersionName(value) {
    const name = decodeURIComponent(String(value || '')).trim();
    if (!name || name.includes('/') || name.includes('\\') || name === '.' || name === '..') throw new Error('version が不正です');
    return name;
  }

  function _folderVersionDir(path) {
    return _joinPath(VERSION_FOLDER_DIR, _fnvFileId(_normalizeFolderPath(path) || '.'));
  }

  async function _readDbVersionSnapshot(provider, path, version) {
    const normalized = _normalizeFolderPath(path);
    const safeVersion = _safeVersionName(version);
    const versionDir = _joinPath(_folderVersionDir(normalized), safeVersion);
    const meta = await _readJsonSafe(provider, _joinPath(versionDir, '_meta.json'), null);
    if (!meta || typeof meta !== 'object') throw new Error('シート履歴が見つかりません');
    const files = [];
    for (const file of (Array.isArray(meta.files) ? meta.files : [])) {
      const rel = _normalizeFolderPath(file.rel_path || '');
      if (!rel || rel.includes('..') || !/^[^/]+\.md$/i.test(rel)) continue;
      files.push({ path: rel, text: await _readText(provider, _joinPath(versionDir, 'files', rel), '') });
    }
    const noteName = _basename(normalized) + '.md';
    const note = files.find(file => file.path === noteName);
    const dbType = note ? String(_parseFrontmatter(note.text).frontmatter?.type || '') : '';
    return { format: 'new-format-v1', db_type: dbType, files, timestamp: meta.created || '' };
  }

  function _recurrenceObject(value) {
    if (!value) return null;
    if (typeof value === 'object') return value;
    try { return JSON.parse(String(value)); } catch { return null; }
  }

  function _recurrenceToRrule(value) {
    const rec = _recurrenceObject(value);
    if (!rec || !rec.type) return '';
    const parts = ['FREQ=' + String(rec.type).toUpperCase()];
    const interval = Number(rec.interval || 1);
    if (interval > 1) parts.push('INTERVAL=' + Math.floor(interval));
    if (rec.endDate) parts.push('UNTIL=' + _icalDate(rec.endDate, /^\d{4}-\d{2}-\d{2}$/.test(String(rec.endDate))));
    if (rec.count) parts.push('COUNT=' + Math.max(1, Math.floor(Number(rec.count) || 1)));
    if (Array.isArray(rec.daysOfWeek) && rec.daysOfWeek.length) {
      const dayMap = { 0: 'SU', 1: 'MO', 2: 'TU', 3: 'WE', 4: 'TH', 5: 'FR', 6: 'SA' };
      const days = rec.daysOfWeek.map(day => dayMap[Number(day)]).filter(Boolean).join(',');
      if (days) parts.push('BYDAY=' + days);
    }
    return parts.join(';');
  }

  function _rruleToRecurrenceJson(rrule) {
    const parts = {};
    String(rrule || '').split(';').forEach((part) => {
      const idx = part.indexOf('=');
      if (idx > 0) parts[part.slice(0, idx).toUpperCase()] = part.slice(idx + 1);
    });
    const type = String(parts.FREQ || '').toLowerCase();
    if (!type) return '';
    const rec = { type, interval: Math.max(1, Number(parts.INTERVAL || 1) || 1) };
    if (parts.UNTIL) rec.endDate = _icalDateValue(parts.UNTIL);
    if (parts.COUNT) rec.count = Math.max(1, Number(parts.COUNT) || 1);
    if (parts.BYDAY) {
      const dayMap = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
      rec.daysOfWeek = parts.BYDAY.split(',').map(day => dayMap[day.trim().slice(-2).toUpperCase()]).filter(day => day != null);
    }
    return JSON.stringify(rec);
  }

  function _parseCalendarDate(value) {
    const text = String(value || '');
    if (!text) return null;
    const parsed = new Date(/^\d{4}-\d{2}-\d{2}$/.test(text) ? text + 'T00:00:00' : text);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  function _parseCalendarRangeEndDate(value) {
    const text = String(value || '');
    const parsed = _parseCalendarDate(text);
    if (parsed && /^\d{4}-\d{2}-\d{2}$/.test(text)) parsed.setHours(23, 59, 59, 999);
    return parsed;
  }

  function _addCalendarMonths(date, interval) {
    const next = new Date(date.getTime());
    const day = next.getDate();
    next.setDate(1);
    next.setMonth(next.getMonth() + interval);
    const lastDay = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
    next.setDate(Math.min(day, lastDay));
    return next;
  }

  function _addCalendarYears(date, interval) {
    const next = new Date(date.getTime());
    const month = next.getMonth();
    const day = next.getDate();
    next.setDate(1);
    next.setFullYear(next.getFullYear() + interval);
    next.setMonth(month);
    const lastDay = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
    next.setDate(Math.min(day, lastDay));
    return next;
  }

  function _expandCalendarRecurrence(event, startDate, endDate) {
    const rec = _recurrenceObject(event.recurrence);
    const baseStart = _parseCalendarDate(event.start);
    if (!rec || !rec.type || !baseStart) return [event];
    const rangeStart = _parseCalendarDate(startDate) || baseStart;
    const rangeEnd = _parseCalendarDate(endDate) || new Date(rangeStart.getTime() + 90 * 86400000);
    const baseEnd = _parseCalendarDate(event.end) || new Date(baseStart.getTime() + 3600000);
    const duration = Math.max(0, baseEnd.getTime() - baseStart.getTime());
    const interval = Math.max(1, Number(rec.interval || 1) || 1);
    const countLimit = Math.max(0, Number(rec.count || 0) || 0);
    const recurrenceEnd = rec.endDate ? (_parseCalendarRangeEndDate(rec.endDate) || rangeEnd) : new Date(rangeStart.getTime() + 365 * 86400000);
    const results = [];
    let current = new Date(baseStart.getTime());
    let generated = 0;
    for (let guard = 0; guard < 2000 && current <= rangeEnd && current <= recurrenceEnd; guard += 1) {
      const weeklyDays = Array.isArray(rec.daysOfWeek) ? rec.daysOfWeek.map(Number) : [];
      const jsDay = current.getDay();
      const weekNo = Math.floor((current.getTime() - baseStart.getTime()) / (7 * 86400000));
      const weeklyOk = rec.type !== 'weekly' || ((weekNo % interval) === 0 && (!weeklyDays.length || weeklyDays.includes(jsDay)));
      if (weeklyOk) {
        generated += 1;
        if (!countLimit || generated <= countLimit) {
          if (current >= rangeStart && current <= rangeEnd) {
            const occurrence = { ...event, start: current.toISOString(), end: new Date(current.getTime() + duration).toISOString(), _recurrence_instance: true };
            results.push(occurrence);
          }
        }
        if (countLimit && generated >= countLimit) break;
      }
      if (rec.type === 'minutely') current = new Date(current.getTime() + interval * 60000);
      else if (rec.type === 'hourly') current = new Date(current.getTime() + interval * 3600000);
      else if (rec.type === 'daily') current = new Date(current.getTime() + interval * 86400000);
      else if (rec.type === 'weekly') current = new Date(current.getTime() + 86400000);
      else if (rec.type === 'monthly') current = _addCalendarMonths(current, interval);
      else if (rec.type === 'yearly') current = _addCalendarYears(current, interval);
      else break;
    }
    return results.length ? results : [event];
  }

  async function _calendarAlerts(provider, url) {
    const minutes = Math.max(0, Number(url.searchParams.get('minutes_ahead') || 30) || 30);
    const lookback = Math.max(0, Number(url.searchParams.get('lookback_minutes') || 0) || 0);
    const user = String(url.searchParams.get('user') || '');
    const now = new Date();
    const windowStart = new Date(now.getTime() - lookback * 60000);
    const windowEnd = new Date(now.getTime() + minutes * 60000);
    const rows = (await _readStore(provider, 'events')).filter(event => Number(event.alert_minutes) >= 0);
    const alerts = [];
    rows.forEach((event) => {
      if (user && event.user && event.user !== user && event.creator !== user) return;
      const offset = Math.max(0, Number(event.alert_minutes || 0) || 0);
      const eventWindowEnd = new Date(windowEnd.getTime() + offset * 60000);
      const candidates = event.recurrence ? _expandCalendarRecurrence(event, windowStart.toISOString(), eventWindowEnd.toISOString()) : [event];
      candidates.forEach((candidate) => {
        const start = _parseCalendarDate(candidate.start);
        if (!start) return;
        const alertTime = new Date(start.getTime() - offset * 60000);
        if (alertTime >= windowStart && alertTime <= windowEnd) alerts.push({ ...candidate, _alert_time: alertTime.toISOString() });
      });
    });
    return alerts;
  }

  const RELOCATE_TEXT_EXTS = new Set(['.md', '.json', '.mel-board', '.mel-sheet', '.scriptnote.json', '.smart-db.json', '.dashboard.json', '.board.md', '.html', '.css', '.js', '.txt', '.csv']);

  function _relocateText(text, oldPath, newPath) {
    const oldNorm = _normalizeFolderPath(oldPath);
    const newNorm = _normalizeFolderPath(newPath);
    if (!oldNorm || oldNorm === newNorm) return text;
    const encodedOld = encodeURI(oldNorm);
    const encodedNew = encodeURI(newNorm);
    return String(text || '').split(oldNorm).join(newNorm).split(encodedOld).join(encodedNew);
  }

  async function _relocateWorkspaceReferences(provider, oldPath, newPath) {
    if (typeof _relocateReferences === 'function') {
      return _relocateReferences(provider, oldPath, newPath, false);
    }
    const rewritten = [];
    let failed = 0;
    await _iterateWorkspaceFiles(provider, async (path) => {
      const normalized = _normalizeFolderPath(path);
      if (_isWorkspaceScanExcluded(normalized)) return;
      const lower = normalized.toLowerCase();
      if (![...RELOCATE_TEXT_EXTS].some(ext => lower.endsWith(ext))) return;
      try {
        const text = await provider.readText(normalized);
        const next = _relocateText(text, oldPath, newPath);
        if (next !== text) {
          await provider.writeText(normalized, next);
          rewritten.push(normalized);
        }
      } catch {
        failed += 1;
      }
    }, '');
    return { rewritten_count: rewritten.length, failed_count: failed, rewritten_paths: rewritten.slice(0, 100), truncated: rewritten.length > 100 };
  }

  const SEARCH_TEXT_EXTS = new Set(['.md', '.json', '.mel-board', '.mel-sheet', '.scriptnote.json', '.smart-db.json', '.dashboard.json', '.board.md', '.txt', '.csv']);

  function _searchPattern(q, caseSensitive, useRegex) {
    if (!q) return null;
    const flags = caseSensitive ? 'g' : 'gi';
    try {
      return useRegex ? new RegExp(q, flags) : new RegExp(String(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags);
    } catch {
      return null;
    }
  }

  function _collectTextMatches(text, pattern, field) {
    const matches = [];
    String(text || '').split(/\r?\n/).forEach((line, index) => {
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(line)) && matches.length < 50) {
        matches.push({ line: index + 1, field: field || '', text: line.slice(0, 200).trim(), col: match.index });
        if (!match[0]) pattern.lastIndex += 1;
      }
    });
    return matches;
  }

  function _sheetStoreSearchText(row) {
    const parts = [row.name || '', row.body || ''];
    const fm = row.frontmatter || {};
    const props = fm.properties && typeof fm.properties === 'object' ? fm.properties : {};
    Object.entries(props).forEach(([prop, values]) => {
      parts.push(prop);
      _normalizeCandidates(values).forEach((candidate) => {
        parts.push(candidate.value || '', candidate.status || '', candidate.note || '', candidate.rich_html || '');
      });
    });
    return parts.filter(Boolean).join('\n');
  }

  function _searchSheetStoreRows(store, pattern, results) {
    Object.values(store?.rows || {}).forEach((row) => {
      const fileName = _sheetStoreFileName(row.file_name || row.path || row.name);
      const path = _joinPath(store.db_path || '', fileName);
      const matches = _collectTextMatches(_sheetStoreSearchText(row), pattern, 'sheet');
      if (matches.length) {
        results.push({ path, name: _sheetStoreEntityName(row.name || fileName), type: 'database', matches });
      }
    });
  }

  async function _cloudSearch(provider, url) {
    const q = String(url.searchParams.get('q') || '');
    if (!q) return { results: [], total: 0 };
    const caseSensitive = _truthy(url.searchParams.get('case'));
    const useRegex = _truthy(url.searchParams.get('regex'));
    const pattern = _searchPattern(q, caseSensitive, useRegex);
    if (!pattern) return { results: [], total: 0, error: '無効な正規表現' };
    const root = _normalizeFolderPath(url.searchParams.get('path') || '');
    const results = [];
    const searchedSheetStores = new Set();
    function searchSheetStoreOnce(dbPath, store) {
      const normalizedDbPath = _normalizeFolderPath(dbPath);
      if (searchedSheetStores.has(normalizedDbPath)) return;
      searchedSheetStores.add(normalizedDbPath);
      _searchSheetStoreRows(store, pattern, results);
    }
    await _iterateWorkspaceFiles(provider, async (path) => {
      const normalized = _normalizeFolderPath(path);
      if (_isWorkspaceScanExcluded(normalized)) return;
      if (_basename(normalized) === SHEET_CLOUD_STORE_FILE) {
        const store = _normalizeSheetStore(await _readJsonSafe(provider, normalized, null), _dirname(normalized));
        searchSheetStoreOnce(_dirname(normalized), store);
        return;
      }
      const lower = normalized.toLowerCase();
      if (![...SEARCH_TEXT_EXTS].some(ext => lower.endsWith(ext))) return;
      if (lower.endsWith('.md')) {
        const store = await _sheetStoreForRead(provider, _dirname(normalized)).catch(() => null);
        if (store?.rows?.[_sheetStoreFileName(normalized)]) {
          searchSheetStoreOnce(_dirname(normalized), store);
          return;
        }
      }
      try {
        const content = await provider.readText(normalized);
        const matches = _collectTextMatches(content, pattern, '');
        if (matches.length) {
          const type = await _classifyFileType(provider, normalized, { allFiles: true }).catch(() => 'page');
          results.push({ path: normalized, name: _basename(normalized).replace(/\.[^.]+$/, ''), type: type || 'page', matches });
        }
      } catch {}
    }, root);
    return { results, total: results.reduce((sum, item) => sum + (item.matches?.length || 0), 0) };
  }

  function _replaceStringValue(value, pattern, replacement, state) {
    if (state.remaining === 0) return value;
    const text = String(value || '');
    pattern.lastIndex = 0;
    const matches = [...text.matchAll(pattern)];
    if (!matches.length) return value;
    const count = state.replaceAll ? matches.length : 1;
    state.count += count;
    if (!state.replaceAll) state.remaining = 0;
    if (state.replaceAll) return text.replace(pattern, replacement);
    const once = new RegExp(pattern.source, pattern.flags.replace(/g/g, ''));
    return text.replace(once, replacement);
  }

  function _replaceNestedText(value, pattern, replacement, state) {
    if (typeof value === 'string') return _replaceStringValue(value, pattern, replacement, state);
    if (Array.isArray(value)) return value.map(item => _replaceNestedText(item, pattern, replacement, state));
    if (value && typeof value === 'object') {
      const out = {};
      Object.entries(value).forEach(([key, item]) => { out[key] = _replaceNestedText(item, pattern, replacement, state); });
      return out;
    }
    return value;
  }

  async function _replaceInSheetStoreEntry(provider, path, body, pattern) {
    const stored = await _readSheetStoreEntry(provider, path);
    if (!stored) return null;
    const state = { count: 0, replaceAll: _truthy(body?.all), remaining: _truthy(body?.all) ? Number.POSITIVE_INFINITY : 1 };
    const replacement = String(body?.replace ?? '');
    const nextFrontmatter = _replaceNestedText(stored.frontmatter, pattern, replacement, state);
    const nextBody = _replaceStringValue(stored.body || '', pattern, replacement, state);
    if (state.count > 0) {
      await _requireUnlocked(provider, stored.dbPath, { action: 'replace-sheet-store' });
      const physical = await _resolveEntryHandle(provider, stored.path).catch(() => null);
      if (physical?.kind === 'file') await _writeEntity(provider, stored.path, nextFrontmatter, nextBody);
      else await _writeSheetStoreEntryOnly(provider, stored.path, nextFrontmatter, nextBody);
    }
    return { ok: true, count: state.count };
  }

  async function _cloudReplace(provider, body) {
    const path = _normalizeFolderPath(body?.path || '');
    const q = String(body?.search || '');
    if (!path || !q) throw new Error('path, search は必須です');
    const pattern = _searchPattern(q, _truthy(body?.case), _truthy(body?.regex));
    if (!pattern) throw new Error('無効な正規表現');
    const storeResult = await _replaceInSheetStoreEntry(provider, path, body || {}, pattern);
    if (storeResult) return storeResult;
    const entry = await _resolveEntryHandle(provider, path);
    if (!entry || entry.kind !== 'file') throw new Error('ファイルが見つかりません');
    const lower = path.toLowerCase();
    if (![...SEARCH_TEXT_EXTS].some(ext => lower.endsWith(ext))) return { ok: true, count: 0 };
    await _requireUnlocked(provider, path, { action: 'replace' });
    const content = await provider.readText(path);
    const state = { count: 0, replaceAll: _truthy(body?.all), remaining: _truthy(body?.all) ? Number.POSITIVE_INFINITY : 1 };
    const next = _replaceStringValue(content, pattern, String(body?.replace ?? ''), state);
    if (state.count > 0) await provider.writeText(path, next);
    return { ok: true, count: state.count };
  }

  async function _cloudLinkDict(provider, url) {
    const work = _normalizeFolderPath(url.searchParams.get('work') || '');
    const dbs = [];
    const baseKind = work ? await _databaseKind(provider, work).catch(() => '') : '';
    if (baseKind === 'settings-db') dbs.push({ path: work, kind: baseKind });
    dbs.push(...await _findDatabaseFolders(provider, work, 6));
    const entries = [];
    const seen = new Set();
    for (const db of dbs) {
      if (db.kind && db.kind !== 'settings-db') continue;
      const pivot = await _readPivot(provider, db.path, '').catch(() => null);
      Object.entries(pivot?.entities || {}).forEach(([name, props]) => {
        const text = String(name || '').trim();
        if (text.length < 2 || seen.has(text)) return;
        seen.add(text);
        let ruby = '';
        for (const key of ['ふりがな', 'ルビ', 'フリガナ', 'ruby']) {
          const values = Array.isArray(props?.[key]) ? props[key] : [];
          const adopted = values.find(item => item?.status === '採用' && item?.value);
          if (adopted) {
            ruby = String(adopted.value || '');
            break;
          }
        }
        entries.push({ text, type: 'entity', path: _joinPath(db.path, _sheetStoreFileName(text)), entity: text, ruby });
      });
    }
    entries.sort((a, b) => b.text.length - a.text.length);
    return { entries };
  }

  async function _handleCalendar(provider, method, body, url, pathname) {
    if (pathname === '/cal/sync/status' && method === 'GET') {
      return { enabled: true, configured: false, ical: true, google: false, microsoft: false, caldav: false };
    }
    if (pathname === '/cal/sync/ical/export' && method === 'GET') {
      return { ok: true, mime: 'text/calendar;charset=utf-8', filename: 'meldex-calendar.ics', content: _icalExport(await _readStore(provider, 'events')) };
    }
    if (pathname === '/cal/sync/ical/import' && method === 'POST') return _importCalendarStoreIcs(provider, body || {});
    if (/^\/cal\/sync\//.test(pathname)) return { ok: false, unsupported: true, error: 'Cloud BETAでは外部カレンダー同期リレー未設定のため無効です' };
    if (pathname === '/cal/alerts' && method === 'GET') {
      return _calendarAlerts(provider, url);
    }
    const route = pathname.match(/^\/cal\/(calendars|events|tasks|time|shifts|schedule-templates)(?:\/([^/]+))?$/);
    if (!route) return NOT_HANDLED;
    const name = route[1] === 'schedule-templates' ? 'schedule-templates' : route[1];
    const id = route[2] ? decodeURIComponent(route[2]) : '';
    if (method === 'GET' && !id) return _calendarList(provider, name, url);
    if (method === 'POST' && !id) return _calendarCreate(provider, name, body || {});
    if (method === 'PUT' && id) return _calendarUpdate(provider, name, id, body || {});
    if (method === 'DELETE' && id) return _calendarDelete(provider, name, id);
    return NOT_HANDLED;
  }

  function _fallbackModels(provider) {
    const key = String(provider || '').toLowerCase();
    if (key === 'anthropic') return [{ id: 'claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5' }];
    if (key === 'openai') return [{ id: 'gpt-4.1-mini', name: 'GPT-4.1 mini' }];
    return [{ id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash' }];
  }

  function _cloudRole() {
    const state = window.MeldexRuntimeAdapter?.getWorkspaceState?.() || {};
    return {
      access: String(state.access || state.role || '').toLowerCase(),
      isOwner: state.isOwner === true,
    };
  }

  async function assertOwnerWrite(provider, path) {
    const role = _cloudRole();
    if (role.access === 'viewer' || document.body?.dataset?.cloudReadonly === '1') {
      throw new Error('閲覧専用モードではCloud保存APIキーを更新できません');
    }
    if (typeof provider?.assertOwnerWrite === 'function') {
      return provider.assertOwnerWrite(path);
    }
    if (!role.isOwner) {
      throw new Error('Cloud保存APIキーの作成・更新・削除は管理者のみ可能です');
    }
    return { ok: true, path: _normalizeFolderPath(path) };
  }

  async function _requireCloudSecretWritable(provider) {
    await assertOwnerWrite(provider, SECRET_FILE);
  }

  handlers.push(async function _dropboxExpandedFeatureHandler({ method, body, url, pathname }) {
    if (pathname === '/outliner/add' && method === 'POST' && ['database', 'calendar', 'smart-db'].includes(String(body?.type || ''))) {
      const provider = await _requirePwaProvider('readwrite');
      const parent = _normalizeFolderPath(body?.parent || '');
      const label = _validateItemName(body?.label || '無題', 'label');
      const type = String(body?.type || '');
      await _requireUnlocked(provider, parent, { action: 'outliner-add-parent' });
      if (type === 'database') {
        const name = await _uniqueName(provider, parent, label, '');
        const path = _joinPath(parent, name);
        await _requireUnlocked(provider, path, { action: 'outliner-add-database' });
        await _ensureFolderNote(provider, path, 'settings-db');
        return { ok: true, node: { type: 'database', label: name, path } };
      }
      if (type === 'calendar') {
        const name = await _uniqueName(provider, parent, label, '');
        const path = _joinPath(parent, name);
        await _requireUnlocked(provider, path, { action: 'outliner-add-calendar' });
        await _ensureFolderNote(provider, path, 'calendar-db');
        return { ok: true, node: { type: 'calendar', label: name, path } };
      }
      const name = await _uniqueName(provider, parent, label, '.smart-db.json');
      const path = _joinPath(parent, name + '.smart-db.json');
      await _requireUnlocked(provider, path, { action: 'outliner-add-smart-db' });
      await provider.writeJson(path, {
        type: 'smart-db',
        id: 'file:' + path,
        name,
        sourceType: 'db-entities',
        filters: [{ property: 'ステータス', field: 'value', operator: 'equals', value: '進行中' }],
        views: { table: {}, dashboard: { widgets: [] } },
        activeView: 'table',
        created: _nowIso(),
      });
      return { ok: true, node: { type: 'smart-db', label: name, path } };
    }

    if (pathname === '/databases' && method === 'GET') return _listDatabases(await _requirePwaProvider('read'));
    if (pathname === '/pivot' && method === 'GET') return _readPivot(await _requirePwaProvider('read'), url.searchParams.get('path') || '', url.searchParams.get('status_filter') || '');
    if (pathname === '/entity' && method === 'GET') return _readEntity(await _requirePwaProvider('read'), url.searchParams.get('path') || '');
    if (pathname === '/value' && method === 'PUT') return _updateValue(await _requirePwaProvider('readwrite'), url.searchParams.get('path') || '', body || {});
    if (pathname === '/value' && method === 'POST') return _addValue(await _requirePwaProvider('readwrite'), body || {});
    if (pathname === '/entity/create' && method === 'POST') return _createEntity(await _requirePwaProvider('readwrite'), body || {});
    if (pathname === '/entity/rename' && method === 'POST') return _renameEntity(await _requirePwaProvider('readwrite'), body || {});
    if (pathname === '/import-csv' && method === 'POST') return _importCsvToDb(await _requirePwaProvider('readwrite'), body || {});
    if (pathname === '/db-metadata' && method === 'GET') return _dbMetadata(await _requirePwaProvider('read'), url.searchParams.get('path') || '');
    if (pathname === '/db-metadata' && method === 'PUT') return _putDbMetadata(await _requirePwaProvider('readwrite'), url.searchParams.get('path') || '', body || {});
    if (pathname === '/smart-db' && method === 'GET') return _smartDb(await _requirePwaProvider('read'), url);
    if (pathname === '/global-index' && method === 'GET') return _globalIndex(await _requirePwaProvider('read'));
    if (pathname === '/search' && method === 'GET') return _cloudSearch(await _requirePwaProvider('read'), url);
    if (pathname === '/replace' && method === 'PUT') return _cloudReplace(await _requirePwaProvider('readwrite'), body || {});
    if (pathname === '/link-dict' && method === 'GET') return _cloudLinkDict(await _requirePwaProvider('read'), url);

    if (pathname === '/version/read-db' && method === 'GET') {
      return _readDbVersionSnapshot(await _requirePwaProvider('read'), url.searchParams.get('path') || '', url.searchParams.get('version') || '');
    }
    if (/^\/version\/(list-db|save-db|restore-db|delete-db|undelete-db)/.test(pathname)) {
      const route = pathname.replace('-db', '-folder');
      return window.MeldexDataAccess.requestJson(route + (url.search || ''), { method, body });
    }

    if (pathname === '/calendar-db/events' && method === 'GET') return _calendarDbEvents(await _requirePwaProvider('read'), url.searchParams.get('path') || '');
    if (pathname === '/calendar-db/events' && method === 'POST') return _calendarDbCreate(await _requirePwaProvider('readwrite'), body || {});
    if (/^\/calendar-db\/events\/[^/]+$/.test(pathname) && method === 'PUT') {
      return _calendarDbUpdate(await _requirePwaProvider('readwrite'), decodeURIComponent(pathname.split('/').pop()), body || {});
    }
    if (/^\/calendar-db\/events\/[^/]+$/.test(pathname) && method === 'DELETE') {
      return _calendarDbDelete(await _requirePwaProvider('readwrite'), decodeURIComponent(pathname.split('/').pop()), url.searchParams.get('db_path') || body?.db_path || '');
    }
    if (pathname === '/calendar-db/ical/export' && method === 'GET') {
      const events = await _calendarDbEvents(await _requirePwaProvider('read'), url.searchParams.get('path') || '');
      return { ok: true, mime: 'text/calendar;charset=utf-8', filename: 'meldex-calendar-db.ics', content: _icalExport(events) };
    }
    if (pathname === '/calendar-db/ical/import' && method === 'POST') return _importCalendarDbIcs(await _requirePwaProvider('readwrite'), body || {});
    if (/^\/calendar-db\/(sync|caldav)\//.test(pathname)) return { ok: false, unsupported: true, error: 'Cloud BETAでは外部カレンダー同期リレー未設定のため無効です' };
    if (/^\/cal(\/|$)/.test(pathname)) return _handleCalendar(await _requirePwaProvider(method === 'GET' ? 'read' : 'readwrite'), method, body || {}, url, pathname);

    if (pathname === '/chat/budget' && method === 'GET') {
      if (window.MeldexLlmClient?.clientBudgetStatus) return window.MeldexLlmClient.clientBudgetStatus(url.searchParams.get('session_id') || '');
      return { settings: { daily_budget_usd: 0, monthly_budget_usd: 0 }, totals: { day: { cost_usd: 0 }, month: { cost_usd: 0 } }, cloud: true };
    }
    if (pathname === '/chat/budget' && method === 'PUT') {
      try { localStorage.setItem('meldex-cloud-chat-budget', JSON.stringify(body || {})); } catch {}
      return { ok: true, cloud: true };
    }
    if (pathname === '/chat/usage/reset' && method === 'POST') {
      if (window.MeldexLlmClient?.resetClientUsage) return window.MeldexLlmClient.resetClientUsage();
      return { ok: true, cloud: true };
    }
    if (pathname === '/chat/models' && method === 'GET') return { provider: url.searchParams.get('provider') || 'gemini', models: _fallbackModels(url.searchParams.get('provider')), fallback: true };
    if (pathname === '/chat/client-tool-result' && method === 'POST') return { ok: false, unsupported: true, error: 'Cloud BETAではローカルOS/CLIツール結果の送信は無効です' };

    if (pathname === '/llm-keys/cloud' && method === 'GET') {
      const provider = await _requirePwaProvider('read');
      const envelope = await _readJsonSafe(provider, SECRET_FILE, null);
      return envelope ? { exists: true, envelope } : { exists: false, envelope: null };
    }
    if (pathname === '/llm-keys/cloud' && method === 'PUT') {
      const provider = await _requirePwaProvider('readwrite');
      await _requireCloudSecretWritable(provider);
      await _directoryHandle(provider, _dirname(SECRET_FILE), true);
      await provider.writeJson(SECRET_FILE, { ...(body || {}), updated_at: _nowIso() });
      return { ok: true, path: SECRET_FILE };
    }
    if (pathname === '/llm-keys/cloud' && method === 'DELETE') {
      const provider = await _requirePwaProvider('readwrite');
      await _requireCloudSecretWritable(provider);
      const existing = await _resolveEntryHandle(provider, SECRET_FILE);
      if (!existing) return { ok: true, missing: true };
      await _removeEntry(provider, SECRET_FILE);
      if (await _resolveEntryHandle(provider, SECRET_FILE)) throw new Error('Cloud保存APIキーを削除できませんでした');
      return { ok: true };
    }

    return NOT_HANDLED;
  });
})();
