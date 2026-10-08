/* Pure normalization helpers shared by Dropbox tag routes. */
(function () {
  'use strict';

  const DEFAULT_PRESET = '標準';

  function nowIso() {
    return new Date().toISOString();
  }

  function randomId() {
    if (globalThis.crypto?.randomUUID) return crypto.randomUUID().replace(/-/g, '');
    return `${Date.now().toString(36)}${Math.random().toString(16).slice(2)}`;
  }

  function identity(value) {
    return String(value || '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('ja');
  }

  function cleanName(value, label) {
    const name = String(value || '').trim().replace(/\s+/g, ' ');
    if (!name) throw new Error(`${label || '名前'}を入力してください`);
    if (name.length > 80) throw new Error(`${label || '名前'}が長すぎます`);
    return name;
  }

  function stringList(value, separators) {
    const values = Array.isArray(value) ? value : [value];
    const seen = new Set();
    const result = [];
    values.forEach(raw => String(raw || '').split(separators || /[\r\n,]+/).forEach(part => {
      const text = String(part || '').trim().replace(/\s+/g, ' ').slice(0, 80);
      const key = identity(text);
      if (text && !seen.has(key)) {
        seen.add(key);
        result.push(text);
      }
    }));
    return result;
  }

  function sortIndex(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.trunc(parsed) : 0;
  }

  function asBool(value) {
    if (typeof value === 'boolean') return value;
    return ['1', 'true', 'yes', 'on', 'はい', '有効'].includes(String(value || '').trim().toLocaleLowerCase('ja'));
  }

  function normalizeCatalog(raw) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const groups = (Array.isArray(source.groups) ? source.groups : []).map(item => ({
      id: String(item?.id || randomId()),
      name: cleanName(item?.name, 'グループ名'),
      parent_id: String(item?.parent_id || '').trim() || null,
      color: String(item?.color || '').trim(),
      description: String(item?.description || '').trim(),
      sort_index: sortIndex(item?.sort_index),
      collapsed: asBool(item?.collapsed),
    }));
    const tags = (Array.isArray(source.tags) ? source.tags : []).map(item => ({
      id: String(item?.id || randomId()),
      name: cleanName(item?.name, 'タグ名'),
      aliases: stringList(item?.aliases),
      presets: stringList(item?.presets, /[\r\n,;]+/).length
        ? stringList(item?.presets, /[\r\n,;]+/)
        : [DEFAULT_PRESET],
      auto_assign: asBool(item?.auto_assign),
      color: String(item?.color || '').trim(),
      description: String(item?.description || '').trim(),
      group_id: String(item?.group_id || '').trim() || null,
      sort_index: sortIndex(item?.sort_index),
    }));

    const allIds = new Set();
    groups.concat(tags).forEach(item => {
      if (allIds.has(item.id)) throw new Error(`内部ID「${item.id}」が重複しています`);
      allIds.add(item.id);
    });
    const groupById = Object.fromEntries(groups.map(group => [group.id, group]));
    const siblingNames = new Set();
    groups.forEach(group => {
      if (group.parent_id && !groupById[group.parent_id]) throw new Error(`「${group.name}」の親グループが見つかりません`);
      if (group.parent_id === group.id) throw new Error('グループ自身を親にはできません');
      const siblingKey = `${group.parent_id || ''}\n${identity(group.name)}`;
      if (siblingNames.has(siblingKey)) throw new Error(`同じ階層にグループ「${group.name}」が重複しています`);
      siblingNames.add(siblingKey);
      const seen = new Set([group.id]);
      let cursor = group.parent_id;
      while (cursor) {
        if (seen.has(cursor)) throw new Error(`グループ「${group.name}」の階層が循環しています`);
        seen.add(cursor);
        cursor = groupById[cursor]?.parent_id || null;
      }
    });

    const tagNames = new Map();
    tags.forEach(tag => {
      if (tag.group_id && !groupById[tag.group_id]) throw new Error(`「${tag.name}」の親グループが見つかりません`);
      const key = identity(tag.name);
      if (tagNames.has(key)) throw new Error(`タグの正式名「${tag.name}」が重複しています`);
      tagNames.set(key, tag.id);
    });
    const aliasNames = new Map();
    tags.forEach(tag => {
      const ownName = identity(tag.name);
      tag.aliases = tag.aliases.filter(alias => {
        const key = identity(alias);
        if (!key || key === ownName) return false;
        if (tagNames.has(key) && tagNames.get(key) !== tag.id) {
          throw new Error(`別名「${alias}」が別のタグの正式名と重複しています`);
        }
        if (aliasNames.has(key) && aliasNames.get(key) !== tag.id) {
          throw new Error(`別名「${alias}」が複数のタグで重複しています`);
        }
        aliasNames.set(key, tag.id);
        return true;
      });
    });
    const compare = (a, b) => a.sort_index - b.sort_index
      || String(a.name).localeCompare(String(b.name), 'ja');
    groups.sort(compare);
    tags.sort(compare);
    const desktopBase = source.desktop_base && typeof source.desktop_base === 'object'
      ? {
          tags: Array.isArray(source.desktop_base.tags) ? structuredClone(source.desktop_base.tags) : [],
          groups: Array.isArray(source.desktop_base.groups) ? structuredClone(source.desktop_base.groups) : [],
        }
      : null;
    return {
      version: 1,
      updated_at: String(source.updated_at || nowIso()),
      desktop_mirror_signature: String(source.desktop_mirror_signature || ''),
      desktop_sheet_mtime_ns: Number.isFinite(Number(source.desktop_sheet_mtime_ns))
        ? Number(source.desktop_sheet_mtime_ns)
        : -1,
      desktop_base: desktopBase,
      sync_pending: !!source.sync_pending,
      sync_conflict: !!source.sync_conflict,
      mutation_blocked: !!source.mutation_blocked,
      conflict_resolution_available: !!source.conflict_resolution_available,
      warning: String(source.warning || ''),
      recovery_path: String(source.recovery_path || ''),
      tags,
      groups,
    };
  }

  window.MeldexDropboxTagCatalogNormalizer = {
    asBool,
    cleanName,
    identity,
    normalizeCatalog,
    nowIso,
    randomId,
    sortIndex,
    stringList,
  };
})();
