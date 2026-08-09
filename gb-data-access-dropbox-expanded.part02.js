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
    const productionSheet = _isProductionManagementSheetMetadataPath(dbPath);
    let changed = false;
    Object.entries(specs).forEach(([propName, spec]) => {
      const current = propertyTypes[propName] && typeof propertyTypes[propName] === 'object' ? { ...propertyTypes[propName] } : null;
      if (!current) {
        propertyTypes[propName] = { ...spec };
        changed = true;
        return;
      }
      // 制作管理の既存列はCSVの推測型で上書き・拡張しない。新規カスタム列だけ追加できる。
      if (productionSheet) return;
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
    if (window.MeldexCsv) return window.MeldexCsv.parse(text).rows;
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

  async function _readImportCsvText(provider, path) {
    if (typeof provider.downloadAsFile === 'function') {
      const file = await provider.downloadAsFile(path);
      const bytes = await file.arrayBuffer();
      const view = new Uint8Array(bytes);
      const bom = view.length >= 3 && view[0] === 0xEF && view[1] === 0xBB && view[2] === 0xBF;
      try {
        return {
          text: new TextDecoder('utf-8', { fatal: true }).decode(bytes),
          encoding: bom ? 'utf-8-bom' : 'utf-8',
          bom,
        };
      } catch {
        return {
          text: new TextDecoder('shift_jis', { fatal: true }).decode(bytes),
          encoding: 'cp932',
          bom: false,
        };
      }
    }
    const text = await provider.readText(path);
    return { text, encoding: 'utf-8', bom: String(text || '').charCodeAt(0) === 0xFEFF };
  }

  function _csvImportSpecs(body, rows) {
    const hasHeader = body?.has_header !== false && body?.hasHeader !== false;
    const columnCount = rows.reduce((max, row) => Math.max(max, row?.length || 0), 0);
    if (!columnCount) throw new Error('CSVに列がありません');
    const baseHeaders = hasHeader ? rows[0] || [] : [];
    const headers = window.MeldexCsv
      ? window.MeldexCsv.uniqueHeaders(Array.from({ length: columnCount }, (_, index) => baseHeaders[index] || `列${index + 1}`))
      : _sheetImportHeaders(baseHeaders);
    let renamedHeaders = headers.reduce((count, name, index) => (
      name !== String(baseHeaders[index] ?? '').trim() ? count + 1 : count
    ), 0);
    const start = hasHeader ? 1 : 0;
    const supplied = Array.isArray(body?.columns) ? body.columns : [];
    const columns = headers.map((header, index) => {
      const inferred = window.MeldexCsv
        ? window.MeldexCsv.inferColumn(rows.slice(start).map(row => row?.[index] ?? ''))
        : { type: 'text', formula: '', warning: '' };
      const configured = supplied[index] && typeof supplied[index] === 'object' ? supplied[index] : {};
      const type = String(configured.type || inferred.type || 'text');
      const formula = String(configured.formula || inferred.formula || '');
      const name = String(configured.name || header).trim() || header;
      if (!['text', 'number', 'formula'].includes(type)) throw new Error(`未対応の列タイプです: ${type}`);
      if (type === 'formula' && (!window.MeldexCsv || !window.MeldexCsv.isMeldexFormula(formula))) {
        throw new Error(`列「${name}」のMeldex数式が正しくありません`);
      }
      if (type === 'number' && window.MeldexCsv) {
        const invalid = rows.slice(start).find(row => String(row?.[index] ?? '').trim() && !window.MeldexCsv.isSafeNumber(row?.[index]));
        if (invalid) throw new Error(`列「${name}」に数値でない値があります`);
      }
      return { name, type, formula, warning: String(configured.warning || inferred.warning || '') };
    });
    const uniqueNames = window.MeldexCsv
      ? window.MeldexCsv.uniqueHeaders(columns.map(column => column.name))
      : _sheetImportHeaders(columns.map(column => column.name));
    columns.forEach((column, index) => {
      if (column.name !== uniqueNames[index]) renamedHeaders += 1;
      column.name = uniqueNames[index];
    });
    const itemColumn = Number(body?.item_name_column ?? body?.itemNameColumn ?? 0);
    if (!Number.isInteger(itemColumn) || itemColumn < 0 || itemColumn >= columns.length) {
      throw new Error('項目名に使う列が範囲外です');
    }
    const records = [];
    const names = new Set();
    let completed = 0;
    let renamed = 0;
    rows.slice(start).forEach((row, offset) => {
      const rawName = String(row?.[itemColumn] ?? '').trim();
      const baseName = rawName || `行 ${offset + 1}`;
      if (!rawName) completed += 1;
      let name = baseName;
      let suffix = 2;
      while (names.has(name)) {
        name = `${baseName} ${suffix}`;
        suffix += 1;
      }
      if (name !== baseName) renamed += 1;
      names.add(name);
      const properties = {};
      columns.forEach((column, index) => {
        if (index === itemColumn || column.type === 'formula') return;
        const value = String(row?.[index] ?? '');
        if (!value) return;
        properties[column.name] = [{ value, status: '採用', note: '', created: _nowIso() }];
      });
      records.push({ name, properties });
    });
    return {
      columns,
      records,
      itemColumn,
      completed,
      renamed,
      renamedHeaders,
      warnings: columns.map(column => column.warning).filter(Boolean),
    };
  }

  async function _setCsvImportPropertyTypes(provider, dbPath, specs, append) {
    const notePath = await _folderNotePath(provider, dbPath);
    if (!notePath) throw new Error('シート定義を作成できませんでした');
    const parsed = await _readFrontmatterFile(provider, notePath);
    const frontmatter = { ...(parsed.frontmatter || {}) };
    const current = frontmatter.property_types && typeof frontmatter.property_types === 'object'
      ? { ...frontmatter.property_types }
      : {};
    const incoming = {};
    specs.columns.forEach((column, index) => {
      if (index === specs.itemColumn) return;
      incoming[column.name] = column.type === 'formula'
        ? { type: 'formula', formula: column.formula }
        : { type: column.type };
    });
    if (append) {
      const conflicts = Object.entries(incoming).filter(([name, spec]) => {
        const existing = current[name];
        return existing && (String(existing.type || 'text') !== spec.type
          || (spec.type === 'formula' && String(existing.formula || '') !== spec.formula));
      });
      if (conflicts.length) throw new Error(`列タイプが一致しません: ${conflicts.map(([name]) => name).join('、')}`);
    }
    frontmatter.property_types = { ...current, ...incoming };
    await _writeFrontmatterFile(provider, notePath, frontmatter, parsed.body || '');
  }

  async function _importCsvToDb(provider, body) {
    const csvPath = _normalizeFolderPath(body?.csv_path || body?.csvPath || '');
    let content = body?.content;
    let encoding = String(body?.encoding || '');
    let bom = body?.bom;
    if (content == null) {
      if (!csvPath) throw new Error('csv_path または content が必要です');
      const csvEntry = await _resolveEntryHandle(provider, csvPath);
      if (!csvEntry || csvEntry.kind !== 'file') throw new Error('CSV not found');
      const expectedEtag = String(body?.if_match_etag || body?.ifMatchEtag || '').trim();
      if (expectedEtag) {
        const currentEtag = await _fileEtag(provider, csvPath, csvEntry);
        if (!currentEtag || currentEtag !== expectedEtag) _throwEtagConflict(csvPath, expectedEtag, currentEtag);
      }
      const read = await _readImportCsvText(provider, csvPath);
      content = read.text;
      encoding = encoding || read.encoding;
      if (bom == null) bom = read.bom;
    }
    if (typeof content !== 'string') throw new Error('content must be text');
    const parsed = window.MeldexCsv
      ? window.MeldexCsv.parse(content, { delimiter: body?.delimiter || '', encoding, bom })
      : { rows: _parseImportCsv(content), dialect: { delimiter: ',', newline: '\n', encoding } };
    if (!parsed.rows.length) throw new Error('CSVに行がありません');
    const specs = _csvImportSpecs(body || {}, parsed.rows);
    const explicit = ['mode', 'has_header', 'hasHeader', 'item_name_column', 'itemNameColumn', 'columns', 'sheet_name']
      .some(key => Object.prototype.hasOwnProperty.call(body || {}, key));
    const mode = String(body?.mode || (explicit ? 'create' : 'append')).toLowerCase();
    if (!['create', 'append'].includes(mode)) throw new Error('mode は create または append を指定してください');
    let dbPath = _normalizeFolderPath(body?.db_path || body?.dbPath || '');
    if (!dbPath) {
      const parent = _normalizeFolderPath(body?.destination_parent || '');
      const stem = String(body?.filename || 'CSV').replace(/\.[^.]+$/, '') || 'CSV';
      dbPath = _joinPath(parent, _safeFileStem(stem, 'CSV'));
    }
    if (!dbPath) throw new Error('保存先が必要です');
    let targetPath = dbPath;
    const targetExists = await _pathExists(provider, targetPath);
    const legacyCreate = !explicit && mode === 'append' && !targetExists;
    if (mode === 'append' && !targetExists && !legacyCreate) throw new Error('追加先シートが見つかりません');
    if (mode === 'create' && targetExists) {
      const unique = await _uniqueName(provider, _dirname(targetPath), _basename(targetPath), '');
      targetPath = _joinPath(_dirname(targetPath), unique);
    }
    await _requireUnlocked(provider, targetPath, { action: 'import-csv' });

    _rejectProductionReservedLegacyProperties(
      targetPath,
      specs.columns.filter((_column, index) => index !== specs.itemColumn).map(column => column.name),
    );
    const legacyDateSpecs = explicit
      ? null
      : _sheetImportPropertySpecs(parsed.rows[0] || [], _sheetImportHeaders(parsed.rows[0] || []), parsed.rows.slice(1));

    const importInto = async (path, category) => {
      await _ensureFolderNote(provider, path, 'settings-db');
      if (legacyDateSpecs) await _mergeSheetImportPropertyTypes(provider, path, legacyDateSpecs);
      else await _setCsvImportPropertyTypes(provider, path, specs, mode === 'append');
      for (const record of specs.records) {
        await _createEntity(provider, {
          parent_path: path,
          category,
          name: record.name,
          properties: record.properties,
          source: 'csv-import',
          user: body?.user || 'anonymous',
        });
      }
    };

    // 取込先が存在しない場合（append指定の暗黙作成 legacyCreate を含む）は、既存フォルダの
    // コピー・バックアップを前提とする追記経路を使えないため、新規作成経路で取り込む。
    if (mode === 'create' || !targetExists) {
      const tempPath = _joinPath(_dirname(targetPath), `.${_basename(targetPath)}.meldex-import-${_randomId('')}`);
      try {
        await importInto(tempPath, _basename(targetPath));
        const tempNote = _joinPath(tempPath, _basename(tempPath) + '.md');
        const finalNote = _joinPath(tempPath, _basename(targetPath) + '.md');
        if (tempNote !== finalNote) await provider.movePath(tempNote, finalNote);
        await provider.movePath(tempPath, targetPath);
      } catch (error) {
        await provider.deletePath(tempPath).catch(() => {});
        throw error;
      }
    } else {
      const tempPath = _joinPath(_dirname(targetPath), `.${_basename(targetPath)}.meldex-import-${_randomId('')}`);
      const backupPath = _joinPath(_dirname(targetPath), `.${_basename(targetPath)}.meldex-backup-${_randomId('')}`);
      let originalMoved = false;
      try {
        await provider.copyPath(targetPath, tempPath);
        // フォルダノートは「フォルダ名と同名の.md」で解決されるため、一時フォルダ内では
        // 実ノートを一時フォルダ名へ改名してから取り込む（そのままだと _ensureFolderNote が
        // 別ノートを新規作成し、既存メタデータを引き継がず列型のマージ先も分裂する）。
        const copiedNote = _joinPath(tempPath, _basename(targetPath) + '.md');
        const workingNote = _joinPath(tempPath, _basename(tempPath) + '.md');
        if (await _pathExists(provider, copiedNote)) await provider.movePath(copiedNote, workingNote);
        await importInto(tempPath, _basename(targetPath));
        await provider.movePath(workingNote, copiedNote);
        await provider.movePath(targetPath, backupPath);
        originalMoved = true;
        try {
          await provider.movePath(tempPath, targetPath);
        } catch (error) {
          await provider.movePath(backupPath, targetPath);
          originalMoved = false;
          throw error;
        }
        await provider.deletePath(backupPath).catch(() => {});
        originalMoved = false;
      } catch (error) {
        await provider.deletePath(tempPath).catch(() => {});
        if (originalMoved) {
          await provider.deletePath(targetPath).catch(() => {});
          await provider.movePath(backupPath, targetPath).catch(() => {});
        }
        throw error;
      }
    }
    return {
      ok: true,
      path: targetPath,
      count: specs.records.length,
      imported_count: specs.records.length,
      completed_name_count: specs.completed,
      renamed_count: specs.renamed + specs.renamedHeaders,
      warnings: specs.warnings,
      columns: specs.columns,
      encoding: parsed.dialect?.encoding || encoding || 'utf-8',
      delimiter: parsed.dialect?.delimiter || ',',
      newline: parsed.dialect?.newline || '\n',
    };
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

  async function _readDbVersionSnapshot(provider, path, version) {
    const normalized = _normalizeFolderPath(path);
    const safeVersion = _safeVersionName(version);
    const storage = window.MeldexSystemStorage;
    const resolver = window.MeldexDropboxManagementRootResolver;
    if (!storage?.SystemStorageKind?.VERSIONS || typeof resolver?.resolveTypedAdapterForProvider !== 'function') {
      throw new Error('シート履歴の管理領域を利用できません');
    }
    const kind = storage.SystemStorageKind.VERSIONS;
    const adapter = await resolver.resolveTypedAdapterForProvider(provider, kind);
    const records = await adapter.listDocuments(kind);
    const record = records.find(row => {
      const payload = row?.payload || {};
      return payload.object_type === 'folder'
        && payload.original_relative_path === normalized
        && payload.version_name === safeVersion
        && !payload.deleted_at;
    });
    let meta = record?.payload;
    let legacyVersionDir = '';
    if (!meta) {
      legacyVersionDir = _joinPath(
        LEGACY_VERSION_FOLDER_DIR,
        _fnvFileId(normalized || '.'),
        safeVersion,
      );
      meta = await _readJsonSafe(provider, _joinPath(legacyVersionDir, '_meta.json'), null);
    }
    if (!meta || typeof meta !== 'object') throw new Error('シート履歴が見つかりません');
    const files = [];
    for (const file of (Array.isArray(meta.files) ? meta.files : [])) {
      const rel = _normalizeFolderPath(file.rel_path || '');
      if (!rel || rel.includes('..') || !/^[^/]+\.md$/i.test(rel)) continue;
      if (file.content_base64) {
        const binary = atob(file.content_base64);
        const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
        files.push({ path: rel, text: new TextDecoder().decode(bytes) });
      } else if (legacyVersionDir) {
        files.push({ path: rel, text: await _readText(provider, _joinPath(legacyVersionDir, 'files', rel), '') });
      }
    }
    const noteName = _basename(normalized) + '.md';
    const note = files.find(file => file.path === noteName)
      || files.find(file => /(?:^|-)db$/i.test(String(_parseFrontmatter(file.text).frontmatter?.type || '')));
    const dbType = note ? String(_parseFrontmatter(note.text).frontmatter?.type || '') : '';
    return { format: 'new-format-v1', db_type: dbType, files, timestamp: meta.created_at || meta.created || '' };
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
      const baseName = _basename(normalized);
      // 大規模シート対策（Phase 3）で単一JSON→マニフェスト+複数シャードへ
      // 分割されたシートは、しきい値超過を境に SHEET_CLOUD_STORE_FILE
      // （_meldex_sheet.cloud.json）が行を持たないスタブへ置き換わる。
      // ここを従来どおり素通しで検索すると分割済みシートが検索から
      // 消え、代わりに下のシャード本体が生JSONの「ページ」として
      // 誤ってヒットする（独立レビューで発見）。マニフェスト・スタブの
      // どちらを踏んでも _readSheetStoreMaybe が透過的に統合済みの行を
      // 返すので、対象dbPathにつき1回だけシート検索へ回す。シャード本体
      // ファイルはここでは何もしない（マニフェスト経由で既に検索済みに
      // なる。生JSONとして個別にヒットさせない）。
      if (baseName === SHEET_CLOUD_STORE_FILE || baseName === SHEET_CLOUD_MANIFEST_FILE) {
        // 分割済みシートは単一JSON（互換性ミラー）とマニフェストの両方が
        // 同じフォルダに存在するため、先に読んでしまうとどちらを先に踏むかで
        // 毎回2回分（全シャード分）読むことになる。dedup判定を読み込みより
        // 先に行い、既に検索済みのdbPathなら読まずに抜ける（独立レビューで
        // 指摘・性能上の指摘であり正しさには影響しないが、Phase 3が対象と
        // する大規模シートでの無駄な二重読み込みを避ける）。
        if (searchedSheetStores.has(_normalizeFolderPath(_dirname(normalized)))) return;
        const store = await _readSheetStoreMaybe(provider, _dirname(normalized)).catch(() => null);
        if (store) searchSheetStoreOnce(_dirname(normalized), store);
        return;
      }
      if (_isSheetCloudShardFileName(baseName)) return;
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

  const CLOUD_UNIFIED_SEARCH_SCOPES = new Set(['name', 'content', 'clip', 'tags', 'memo']);

  function _cloudUnifiedSearchType(path, fallback) {
    if (fallback) return fallback;
    const lower = String(path || '').toLowerCase();
    if (/\.(?:png|jpe?g|gif|webp|bmp|tiff?)$/.test(lower)) return 'image';
    if (/\.(?:mel-scenario|scriptnote\.json|scenario\.json)$/.test(lower)) return 'scriptnote';
    if (/\.(?:mel-board|board\.md)$/.test(lower)) return 'board';
    return 'page';
  }

  function _cloudUnifiedPathMatches(path, root) {
    const normalized = _normalizeFolderPath(path).toLowerCase();
    const prefix = _normalizeFolderPath(root).toLowerCase();
    return !prefix || normalized === prefix || normalized.startsWith(prefix + '/');
  }

  function _cloudUnifiedAdd(merged, sourceCounts, row, source) {
    const path = _normalizeFolderPath(row?.path || '');
    if (!path) return;
    const key = path.toLowerCase();
    let current = merged.get(key);
    if (!current) {
      current = {
        path,
        name: String(row?.name || _basename(path)),
        type: _cloudUnifiedSearchType(path, row?.type),
        asset_id: String(row?.asset_id || ''),
        portable_uid: String(row?.portable_uid || ''),
        score: Number.isFinite(Number(row?.score)) ? Number(row.score) : null,
        matches: [],
        source,
        sources: [],
      };
      merged.set(key, current);
    }
    if (!current.sources.includes(source)) current.sources.push(source);
    if (Array.isArray(row?.matches)) current.matches.push(...row.matches);
    if (Number.isFinite(Number(row?.score))) {
      current.score = current.score == null ? Number(row.score) : Math.max(current.score, Number(row.score));
    }
    sourceCounts[source] = (sourceCounts[source] || 0) + 1;
  }

  async function _cloudUnifiedSearch(provider, url) {
    const query = String(url.searchParams.get('q') || '').trim();
    const requested = String(url.searchParams.get('scopes') || '')
      .split(',').map(value => value.trim().toLowerCase()).filter(value => CLOUD_UNIFIED_SEARCH_SCOPES.has(value));
    const scopes = requested.length ? [...new Set(requested)] : ['name', 'content'];
    const root = _normalizeFolderPath(url.searchParams.get('path') || '');
    const parsedLimit = Number(url.searchParams.get('limit') || 50);
    const limit = Number.isFinite(parsedLimit) ? Math.max(1, Math.min(100, Math.floor(parsedLimit))) : 50;
    if (!query) return { results: [], total: 0, limit, scopes, source_counts: {}, unavailable: [], partial: false };

    const needle = query.toLowerCase();
    const merged = new Map();
    const sourceCounts = {};
    const unavailable = [];

    for (const source of scopes) {
      try {
        if (source === 'clip') {
          // CLIPのテキスト埋め込み生成にはデスクトップ側のローカルモデルが必要。
          // Cloud静的版で見せかけの文字列検索へ落とさず、部分結果として明示する。
          unavailable.push({ source, message: '画像の内容検索はデスクトップ版のCLIPモデルで利用できます' });
          sourceCounts[source] = 0;
          continue;
        }
        if (source === 'name') {
          const index = await _globalIndex(provider);
          (index.files || []).forEach((item) => {
            const name = String(item?.name || _basename(item?.path || ''));
            if (!name.toLowerCase().includes(needle) || !_cloudUnifiedPathMatches(item?.path, root)) return;
            _cloudUnifiedAdd(merged, sourceCounts, {
              ...item,
              matches: [{ line: 1, field: '名前', text: name, col: Math.max(0, name.toLowerCase().indexOf(needle)) }],
            }, source);
          });
          continue;
        }
        if (source === 'content') {
          const searchUrl = new URL(url.toString());
          searchUrl.pathname = '/search';
          searchUrl.search = '';
          searchUrl.searchParams.set('q', query);
          if (root) searchUrl.searchParams.set('path', root);
          const payload = await _cloudSearch(provider, searchUrl);
          (payload.results || []).forEach(row => _cloudUnifiedAdd(merged, sourceCounts, row, source));
          continue;
        }
        if (source === 'tags') {
          const payload = await window.MeldexDataAccess.requestJson(
            '/global-tags/search?tag=' + encodeURIComponent(query),
            { method: 'GET' },
          );
          (payload?.results || []).forEach((row) => {
            if (!_cloudUnifiedPathMatches(row?.path, root)) return;
            const text = (row.tags || []).map(tag => tag?.name || tag?.label || '').filter(Boolean).join(', ');
            _cloudUnifiedAdd(merged, sourceCounts, {
              ...row,
              matches: [{ line: 1, field: 'タグ', text: text || query, col: 0 }],
            }, source);
          });
          continue;
        }
        const rows = await window.MeldexDataAccess.requestJson('/annotations?limit=0', { method: 'GET' });
        (Array.isArray(rows) ? rows : []).forEach((row) => {
          const path = _normalizeFolderPath(row?.target_path || '');
          if (!path || !_cloudUnifiedPathMatches(path, root)) return;
          const text = [row?.body, row?.text, row?.data].filter(Boolean).join('\n');
          const col = text.toLowerCase().indexOf(needle);
          if (col < 0) return;
          _cloudUnifiedAdd(merged, sourceCounts, {
            path,
            name: _basename(path),
            matches: [{ line: 1, field: 'メモ', text: text.slice(0, 200), col }],
          }, source);
        });
      } catch (error) {
        sourceCounts[source] = sourceCounts[source] || 0;
        unavailable.push({ source, message: String(error?.userMessage || error?.message || error) });
      }
    }

    const results = [...merged.values()];
    results.sort((a, b) => (Number(b.score ?? -1) - Number(a.score ?? -1))
      || String(a.name || '').localeCompare(String(b.name || ''), 'ja'));
    return {
      results: results.slice(0, limit), total: results.length, limit, scopes,
      source_counts: sourceCounts, unavailable, partial: unavailable.length > 0,
    };
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
    _rejectProductionReservedLegacyPropertyObject(stored.dbPath, nextFrontmatter?.properties);
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
    if (_isProductionManagementFolderNotePath(path)) {
      throw new Error('制作管理の列定義ファイルは一括置換から変更できません');
    }
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
    if (state.count > 0) {
      _rejectProductionReservedLegacyPropertyObject(_dirname(path), _parseFrontmatter(next).frontmatter?.properties);
      await provider.writeText(path, next);
    }
    return { ok: true, count: state.count };
  }

  async function _cloudLinkDictFuriganaKeys(provider, dbPath) {
    try {
      const note = await _folderFrontmatter(provider, dbPath);
      const propertyTypes = note?.frontmatter?.property_types;
      if (!propertyTypes || typeof propertyTypes !== 'object' || Array.isArray(propertyTypes)) return [];
      return Object.entries(propertyTypes)
        .filter(([, spec]) => spec && typeof spec === 'object' && spec.type === 'furigana')
        .map(([name]) => name);
    } catch {
      return [];
    }
  }

  function _cloudLinkDictReadings(props, rubyKeys) {
    const readings = [];
    const seen = new Set();
    for (const key of rubyKeys) {
      const values = Array.isArray(props?.[key]) ? props[key] : [];
      for (const item of values) {
        const value = String(item?.value || '').trim();
        if (!value) continue;
        const status = String(item?.status || '(未設定)').trim() || '(未設定)';
        const dedupeKey = `${value}\u0000${status}`;
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);
        readings.push({ value, status });
      }
    }
    return readings;
  }

  async function _cloudLinkDictRows(provider, dbPath) {
    const base = _normalizeFolderPath(dbPath);
    const store = await _sheetStoreForRead(provider, base).catch(() => null);
    if (store) {
      // tombstone行（deleted:true）は削除済みのため、リンク辞書候補から除く。
      return Object.values(store.rows || {}).filter(row => !row?.deleted).map(row => ({
        name: _sheetStoreEntityName(row?.name || row?.file_name || row?.path),
        path: row?.path || _joinPath(base, _sheetStoreFileName(row?.name || row?.file_name)),
        properties: row?.frontmatter?.properties || {},
      }));
    }
    const rows = [];
    const items = await _listDirectoryEntries(provider, base);
    for (const item of items) {
      if (item.handle.kind !== 'file' || !item.name.endsWith('.md')
          || item.name.startsWith('_') || item.name === _basename(base) + '.md') continue;
      const path = _joinPath(base, item.name);
      const parsed = await _readFrontmatterFile(provider, path);
      if (String(parsed.frontmatter?.type || '') !== 'settings-entry') continue;
      rows.push({
        name: item.name.replace(/\.md$/i, ''),
        path,
        properties: parsed.frontmatter?.properties || {},
      });
    }
    return rows;
  }

  function _cloudLinkDictMergeReadings(target, additions) {
    const identities = new Set((target.readings || []).map(item => `${item.value}\u0000${item.status}`));
    for (const item of additions || []) {
      const identity = `${item.value}\u0000${item.status}`;
      if (!item.value || identities.has(identity)) continue;
      identities.add(identity);
      target.readings.push({ value: item.value, status: item.status });
    }
    target.ruby = target.readings.find(item => item.status === '採用')?.value || '';
  }

  async function _cloudLinkDict(provider, url) {
    const work = _normalizeFolderPath(url.searchParams.get('work') || '');
    const dbs = [];
    const baseKind = work ? await _databaseKind(provider, work).catch(() => '') : '';
    if (baseKind === 'settings-db') dbs.push({ path: work, kind: baseKind });
    dbs.push(...await _findDatabaseFolders(provider, work, 6));
    const entries = [];
    const byText = new Map();
    for (const db of dbs) {
      if (db.kind && db.kind !== 'settings-db') continue;
      const furiganaKeys = await _cloudLinkDictFuriganaKeys(provider, db.path);
      const rubyKeys = [...new Set([...furiganaKeys, 'ふりがな', 'ルビ', 'フリガナ', 'ruby'])];
      const rows = await _cloudLinkDictRows(provider, db.path).catch(() => []);
      rows.forEach(row => {
        const text = String(row.name || '').trim();
        if (text.length < 2) return;
        const readings = _cloudLinkDictReadings(row.properties, rubyKeys);
        const current = byText.get(text);
        if (current) {
          _cloudLinkDictMergeReadings(current, readings);
          return;
        }
        const entry = {
          text,
          type: 'entity',
          path: row.path || _joinPath(db.path, _sheetStoreFileName(text)),
          entity: text,
          ruby: '',
          readings: [],
        };
        _cloudLinkDictMergeReadings(entry, readings);
        byText.set(text, entry);
        entries.push(entry);
      });
    }
    entries.sort((a, b) => b.text.length - a.text.length);
    return { entries };
  }

  async function _cloudRubyReading(provider, url) {
    const query = String(url.searchParams.get('text') || '').trim();
    if (!query) return { ruby: null, candidates: [] };
    const work = url.searchParams.get('work') || '';
    const dictUrl = new URL('http://x/link-dict');
    if (work) dictUrl.searchParams.set('work', work);
    const dict = await _cloudLinkDict(provider, dictUrl).catch(() => ({ entries: [] }));
    const folded = query.toLowerCase();
    const exact = [];
    const loose = [];
    (dict.entries || []).forEach((entry) => {
      const text = String(entry.text || '').trim();
      const ruby = String(entry.ruby || '').trim();
      if (!text || !ruby) return;
      const candidate = { text, ruby, path: entry.path || '' };
      if (text === query) exact.push(candidate);
      else if (text.toLowerCase() === folded) loose.push(candidate);
    });
    const candidates = exact.concat(loose);
    return { ruby: candidates.length ? candidates[0].ruby : null, candidates };
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
    const ledger = window.MeldexWorkspaceLedgerIO;
    const resolver = window.MeldexDropboxManagementRootResolver;
    if (!ledger || typeof ledger.listJoinedWorkspaces !== 'function' || !resolver) {
      throw new Error('個人Dropbox領域か判定できないため、Cloud保存APIキーを書き込めません');
    }
    try {
      const joined = ledger.listJoinedWorkspaces();
      if (!Array.isArray(joined)) throw new Error('workspace-ledger-unavailable');
    } catch {
      throw new Error('個人Dropbox領域か判定できないため、Cloud保存APIキーを書き込めません');
    }
    const info = await resolver.resolveConnectionInfo(provider);
    if (info.isSharedWorkspace) {
      throw new Error('Cloud保存APIキーは共有ワークスペースへ保存できません');
    }
  }

  function _secretAuth() {
    const auth = window.MeldexDropboxAuth;
    if (!auth || typeof auth.apiRpc !== 'function' || typeof auth.apiContent !== 'function') {
      throw new Error('Dropboxへ接続してください');
    }
    return auth;
  }

  async function _readCloudSecretEnvelope() {
    try {
      const response = await _secretAuth().apiContent(
        'files/download',
        { path: SECRET_FILE },
        undefined,
        { namespaceKind: 'home' },
      );
      return JSON.parse(await response.text());
    } catch (error) {
      if (/not_found|path_lookup|path\/not_found/i.test(String(error?.message || error))) return null;
      throw error;
    }
  }

  async function _writeCloudSecretEnvelope(envelope) {
    const bytes = new TextEncoder().encode(JSON.stringify(envelope));
    await _secretAuth().apiContent(
      'files/upload',
      { path: SECRET_FILE, mode: 'overwrite', autorename: false, mute: false },
      { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: bytes },
      { namespaceKind: 'home' },
    );
  }

  async function _deleteCloudSecretEnvelope() {
    try {
      await _secretAuth().apiRpc(
        'files/delete_v2',
        { path: SECRET_FILE },
        { namespaceKind: 'home' },
      );
      return true;
    } catch (error) {
      if (/not_found|path_lookup|path\/not_found/i.test(String(error?.message || error))) return false;
      throw error;
    }
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
    if (pathname === '/entity/rename' && method === 'POST') {
      const production = window.MeldexProductionManagement;
      if (window.MeldexProductionSchemaMigration?.isManagedEntryPath?.(body?.path)
        && typeof production?.renameCloudManagedEntry === 'function') {
        return production.renameCloudManagedEntry(body || {});
      }
      return _renameEntity(await _requirePwaProvider('readwrite'), body || {});
    }
    if (pathname === '/import-csv' && method === 'POST') return _importCsvToDb(await _requirePwaProvider('readwrite'), body || {});
    // 画像列を編集するたびに呼ばれる後始末（画像の参照一覧の作り直し）。クラウド版では
    // 保存先全体を走査する処理を行わない（Dropbox越しの全走査は現実的な時間で終わらない）。
    // 参照一覧はデスクトップ版の不要画像の掃除だけが使うため、ここで何もしなくても
    // データは壊れない。**ただし空の参照一覧を書き戻してはならない**（掃除が
    // 「どこからも参照されていない」と誤判定して実データを消しうる）。
    // 未配線のままだと画像セルを触るたびに「操作を完了できませんでした」が出る。
    if (pathname === '/media/rebuild-refs' && method === 'POST') {
      return { ok: true, refs: {}, hash_count: 0, skipped: true, reason: 'cloud-no-index-rebuild' };
    }
    if (pathname === '/db-metadata' && method === 'GET') return _dbMetadata(await _requirePwaProvider('read'), url.searchParams.get('path') || '');
    if (pathname === '/db-metadata' && method === 'PUT') return _putDbMetadata(await _requirePwaProvider('readwrite'), url.searchParams.get('path') || '', body || {});
    if (pathname === '/db-property/rename' && method === 'PUT') return _renameDbProperty(await _requirePwaProvider('readwrite'), body || {});
    if (pathname === '/smart-db' && method === 'GET') return _smartDb(await _requirePwaProvider('read'), url);
    if (pathname === '/global-index' && method === 'GET') return _globalIndex(await _requirePwaProvider('read'));
    if (pathname === '/search-unified' && method === 'GET') return _cloudUnifiedSearch(await _requirePwaProvider('read'), url);
    if (pathname === '/search' && method === 'GET') return _cloudSearch(await _requirePwaProvider('read'), url);
    if (pathname === '/replace' && method === 'PUT') return _cloudReplace(await _requirePwaProvider('readwrite'), body || {});
    if (pathname === '/link-dict' && method === 'GET') return _cloudLinkDict(await _requirePwaProvider('read'), url);
    // ルビの読み取得。デスクトップ版の /api/ruby と同じく、リンク辞書が集めた
    // 「ふりがな」系プロパティから引く（外部の日本語解析は使わない）。
    if (pathname === '/ruby' && method === 'GET') return _cloudRubyReading(await _requirePwaProvider('read'), url);

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
      await _requireCloudSecretWritable(provider);
      const envelope = await _readCloudSecretEnvelope();
      return envelope ? { exists: true, envelope } : { exists: false, envelope: null };
    }
    if (pathname === '/llm-keys/cloud' && method === 'PUT') {
      const provider = await _requirePwaProvider('readwrite');
      await _requireCloudSecretWritable(provider);
      await _writeCloudSecretEnvelope({ ...(body || {}), updated_at: _nowIso() });
      return { ok: true, path: SECRET_FILE };
    }
    if (pathname === '/llm-keys/cloud' && method === 'DELETE') {
      const provider = await _requirePwaProvider('readwrite');
      await _requireCloudSecretWritable(provider);
      const removed = await _deleteCloudSecretEnvelope();
      return removed ? { ok: true } : { ok: true, missing: true };
    }

    return NOT_HANDLED;
  });
})();
