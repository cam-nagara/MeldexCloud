/* Pure CSV parsing and catalog merge helpers for Dropbox tag dictionaries. */
(function (global) {
  'use strict';

  function parseCsv(text) {
    const rows = [];
    let row = [], field = '', quoted = false;
    const source = String(text || '').replace(/^\uFEFF/, '');
    for (let index = 0; index < source.length; index += 1) {
      const char = source[index];
      if (quoted) {
        if (char === '"' && source[index + 1] === '"') {
          field += '"';
          index += 1;
        } else if (char === '"') quoted = false;
        else field += char;
      } else if (char === '"') quoted = true;
      else if (char === ',') {
        row.push(field);
        field = '';
      } else if (char === '\n') {
        row.push(field.replace(/\r$/, ''));
        if (row.some(value => value !== '')) rows.push(row);
        row = [];
        field = '';
      } else field += char;
    }
    row.push(field.replace(/\r$/, ''));
    if (row.some(value => value !== '')) rows.push(row);
    if (!rows.length) return [];
    const headers = rows.shift().map(
      value => String(value || '').trim().toLocaleLowerCase('ja'),
    );
    return rows.map(values => Object.fromEntries(
      headers.map((header, index) => [header, values[index] || '']),
    ));
  }

  function requireDependencies(raw) {
    const dependencies = raw && typeof raw === 'object' ? raw : {};
    const required = [
      'identity',
      'randomId',
      'stringList',
      'asBool',
      'sortIndex',
      'normalizeCatalog',
    ];
    required.forEach(name => {
      if (typeof dependencies[name] !== 'function') {
        throw new Error(`CSVタグ辞書の依存関数「${name}」がありません`);
      }
    });
    return {
      ...dependencies,
      defaultPreset: String(dependencies.defaultPreset || '標準'),
    };
  }

  function mergeCsv(catalog, csvText, presetName, rawDependencies) {
    const {
      identity,
      randomId,
      stringList,
      asBool,
      sortIndex,
      normalizeCatalog,
      defaultPreset,
    } = requireDependencies(rawDependencies);
    const rows = parseCsv(csvText);
    if (!rows.length) throw new Error('CSVが空です');
    const eagle = ['group', 'color', 'tag'].every(
      key => Object.prototype.hasOwnProperty.call(rows[0], key),
    );
    const groups = catalog.groups.map(group => ({ ...group }));
    const tags = catalog.tags.map(tag => ({
      ...tag,
      aliases: [...tag.aliases],
      presets: [...tag.presets],
    }));
    const tagsByName = new Map(tags.map(tag => [identity(tag.name), tag]));
    const groupPaths = new Map();
    const groupPath = group => {
      const names = [];
      const seen = new Set();
      let current = group;
      while (current && !seen.has(current.id)) {
        seen.add(current.id);
        names.unshift(current.name);
        current = groups.find(item => item.id === current.parent_id);
      }
      return names.join(' > ');
    };
    groups.forEach(group => groupPaths.set(identity(groupPath(group)), group.id));

    const ensureGroupPath = (rawPath, color) => {
      let parentId = null;
      const built = [];
      String(rawPath || '').split(/\s*>\s*/).filter(Boolean).forEach(part => {
        const name = part.trim();
        built.push(name);
        const key = identity(built.join(' > '));
        let id = groupPaths.get(key);
        if (!id) {
          const existing = groups.find(
            group => identity(group.name) === identity(name)
              && group.parent_id === parentId,
          );
          if (existing) id = existing.id;
          else {
            id = randomId();
            groups.push({
              id,
              name,
              parent_id: parentId,
              color: color || '',
              description: '',
              sort_index: 0,
              collapsed: false,
            });
          }
          groupPaths.set(key, id);
        }
        parentId = id;
      });
      return parentId;
    };

    let imported = 0;
    rows.forEach(row => {
      let kind, name, aliases, presets, parentPath, color;
      let autoAssign, description, order;
      if (eagle) {
        const parts = String(row.tag || '')
          .split(/[/|｜／]/)
          .map(value => value.trim())
          .filter(Boolean);
        [name, ...aliases] = parts;
        kind = 'tag';
        presets = [presetName || defaultPreset];
        parentPath = row.group || '';
        color = row.color || '';
        autoAssign = true;
        description = '';
        order = 0;
      } else {
        kind = String(row.kind || row['種類'] || 'tag')
          .trim()
          .toLocaleLowerCase('ja');
        name = String(row.name || row['正式名'] || '').trim();
        aliases = stringList(row.aliases || row['別名']);
        presets = stringList(
          row.presets || row.preset || row['プリセット'],
          /[\r\n,;]+/,
        );
        if (!presets.length) presets = [presetName || defaultPreset];
        parentPath = row.parent || row['親グループ'] || '';
        color = row.color || row['色'] || '';
        autoAssign = asBool(row.auto_assign || row['自動付与']);
        description = row.description || row['説明'] || '';
        order = sortIndex(row.sort_index || row['並び順']);
      }
      if (!name) return;
      const parentId = ensureGroupPath(parentPath, color);
      if (kind === 'group' || kind === 'グループ') {
        const existing = groups.find(
          group => identity(group.name) === identity(name)
            && group.parent_id === parentId,
        );
        if (existing) {
          Object.assign(existing, {
            color: color || existing.color,
            description: description || existing.description,
            sort_index: order,
          });
        } else {
          groups.push({
            id: randomId(),
            name,
            parent_id: parentId,
            color,
            description,
            sort_index: order,
            collapsed: false,
          });
        }
      } else {
        const existing = tagsByName.get(identity(name));
        if (existing) {
          existing.aliases = stringList([existing.aliases, aliases].flat());
          existing.presets = stringList(
            [existing.presets, presets].flat(),
            /[\r\n,;]+/,
          );
        } else {
          const tag = {
            id: randomId(),
            name,
            aliases,
            presets,
            auto_assign: autoAssign,
            color,
            description,
            group_id: parentId,
            sort_index: order,
          };
          tags.push(tag);
          tagsByName.set(identity(name), tag);
        }
      }
      imported += 1;
    });
    return {
      catalog: normalizeCatalog({ tags, groups }),
      imported,
      format: eagle ? 'eagle' : 'meldex',
    };
  }

  function dictionaryNoteText(dictionaryFolder) {
    const metadata = {
      type: 'settings-db',
      schema_version: 1,
      storage: 'sqlite',
      category: dictionaryFolder,
      roles: ['auto-tag-dictionary'],
      property_types: {
        正式名: { type: 'text' },
        種類: { type: 'select', options: ['タグ', 'グループ'] },
        プリセット: { type: 'long-text' },
        親グループ: { type: 'relation', relationDb: '' },
        別名: { type: 'long-text' },
        自動付与: { type: 'checkbox' },
        色: { type: 'color' },
        説明: { type: 'long-text' },
        並び順: { type: 'number' },
        折りたたみ: { type: 'checkbox' },
        内部ID: { type: 'text' },
      },
    };
    const lines = ['---'];
    Object.entries(metadata).forEach(
      ([key, value]) => lines.push(`${key}: ${JSON.stringify(value)}`),
    );
    lines.push(
      '---',
      '',
      `# ${dictionaryFolder}`,
      '',
      'タグ・別名・自動付与・グループ階層を管理するシートです。',
      '',
    );
    return lines.join('\n');
  }

  async function ensureDictionary(provider, rawDependencies) {
    const dependencies = rawDependencies && typeof rawDependencies === 'object'
      ? rawDependencies
      : {};
    const ensureDirectory = dependencies.ensureDirectory;
    const resolveEntryHandle = dependencies.resolveEntryHandle;
    const writeCatalog = dependencies.writeCatalog;
    if (
      typeof ensureDirectory !== 'function'
      || typeof resolveEntryHandle !== 'function'
      || typeof writeCatalog !== 'function'
    ) {
      throw new Error('タグ辞書作成APIの依存関数が不足しています');
    }
    const dictionaryFolder = String(
      dependencies.dictionaryFolder || '自動タグ辞書',
    );
    const dictionaryNote = String(
      dependencies.dictionaryNote
      || `${dictionaryFolder}/${dictionaryFolder}.md`,
    );
    const catalogFile = String(
      dependencies.catalogFile || '.meldex/auto-tag-dictionary.v1.json',
    );
    await ensureDirectory(provider, '.meldex');
    await ensureDirectory(provider, dictionaryFolder);
    if (!await resolveEntryHandle(provider, dictionaryNote)) {
      await provider.writeText(
        dictionaryNote,
        dictionaryNoteText(dictionaryFolder),
      );
    }
    if (!await resolveEntryHandle(provider, catalogFile)) {
      await writeCatalog(provider, catalog => catalog);
    }
    return {
      ok: true,
      created: true,
      db_path: dictionaryFolder,
      catalog_path: catalogFile,
    };
  }

  async function importCsv(provider, body, dependencies) {
    const writeCatalog = dependencies?.writeCatalog;
    const catalogResponse = dependencies?.catalogResponse;
    if (
      typeof writeCatalog !== 'function'
      || typeof catalogResponse !== 'function'
    ) {
      throw new Error('CSVタグ辞書取込APIの依存関数が不足しています');
    }
    let importResult;
    const saved = await writeCatalog(provider, catalog => {
      importResult = mergeCsv(
        catalog,
        String(body?.csv_text || body?.csvText || ''),
        String(body?.preset_name || body?.presetName || '').trim(),
        dependencies,
      );
      return importResult.catalog;
    });
    return {
      ok: true,
      imported: importResult.imported,
      format: importResult.format,
      tag_count: saved.tags.length,
      group_count: saved.groups.length,
      preset_names: catalogResponse(saved).preset_names,
      db_path: String(dependencies?.dictionaryFolder || '自動タグ辞書'),
    };
  }

  global.MeldexDropboxTagCsv = Object.freeze({
    parseCsv,
    mergeCsv,
    ensureDictionary,
    importCsv,
  });
})(typeof window !== 'undefined' ? window : globalThis);
