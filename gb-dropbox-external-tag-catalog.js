/* Query-only Dropbox shards for external tag/group suggestions. No startup I/O. */
(function () {
  'use strict';

  const internals = window.__MeldexPwaDataAccessInternals;
  const handlers = window.__MeldexPwaDataAccessExtensions;
  const tagDictionary = window.MeldexDropboxTagDictionary;
  if (!internals || !Array.isArray(handlers) || !tagDictionary) return;

  const {
    NOT_HANDLED,
    _readJsonSafe,
    _requirePwaProvider,
  } = internals;
  const {
    cleanName,
    identity,
    randomId,
    sortIndex,
    stringList,
  } = tagDictionary.helpers || {};
  if ([cleanName, identity, randomId, sortIndex, stringList].some(value => typeof value !== 'function')) {
    throw new Error('Cloudタグ辞書の候補実体化ヘルパーが不足しています');
  }
  const ROOT = '.meldex/external-tag-catalog/v1/shards';
  const MAX_SHARD_ITEMS = 10_000;

  function searchKey(value) {
    return String(value || '')
      .normalize('NFKC')
      .replaceAll('_', ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLocaleLowerCase();
  }

  function shardName(query) {
    const first = [...searchKey(query)][0] || '';
    if (!first) return '';
    return `u${first.codePointAt(0).toString(16).padStart(6, '0')}.json`;
  }

  function normalizedGroups(value) {
    return (Array.isArray(value) ? value : [])
      .slice(0, 32)
      .map(group => ({
        catalog_group_key: String(group?.catalog_group_key || ''),
        name: String(group?.name || '').trim().slice(0, 80),
        color: String(group?.color || '').trim().slice(0, 32),
        description: String(group?.description || '').trim().slice(0, 500),
        sort_index: Number(group?.sort_index || 0),
      }))
      .filter(group => group.name);
  }

  function normalizeCandidate(raw) {
    const kind = String(raw?.kind || '').trim().toLowerCase();
    const catalogId = String(raw?.catalog_id || '').trim().slice(0, 200);
    const name = String(raw?.name || '').trim().slice(0, 80);
    if (!['tag', 'group'].includes(kind) || !catalogId || !name) return null;
    const groups = normalizedGroups(raw?.definition?.groups || raw?.groups);
    if (kind === 'group' && !groups.length) return null;
    const definition = kind === 'tag'
      ? {
          catalog_tag_id: catalogId,
          name,
          aliases: stringList?.(raw?.definition?.aliases || raw?.aliases) || [],
          presets: stringList?.(raw?.definition?.presets || ['外部タグカタログ']) || ['外部タグカタログ'],
          auto_assign: true,
          color: String(raw?.definition?.color || '').trim().slice(0, 32),
          description: String(raw?.definition?.description || '').trim().slice(0, 500),
          sort_index: sortIndex?.(raw?.definition?.sort_index) || 0,
          groups,
        }
      : {
          catalog_group_key: catalogId,
          groups,
        };
    return {
      candidate_id: `${kind}:${catalogId}`,
      catalog_id: catalogId,
      kind,
      name,
      aliases: kind === 'tag' ? definition.aliases : [],
      group_path: groups.map(group => group.name).join(' > '),
      source: 'external',
      definition,
      search_keys: (Array.isArray(raw?.search_keys) ? raw.search_keys : [])
        .map(searchKey)
        .filter(Boolean)
        .slice(0, 64),
    };
  }

  function candidateKeys(candidate) {
    const values = [
      candidate.name,
      candidate.group_path,
      ...(candidate.aliases || []),
      ...(candidate.search_keys || []),
    ];
    return [...new Set(values.map(searchKey).filter(Boolean))];
  }

  function searchShard(shard, query, kind, limit, offset = 0) {
    const key = searchKey(query).slice(0, 80);
    if (!key) return [];
    const items = (Array.isArray(shard?.items) ? shard.items : [])
      .slice(0, MAX_SHARD_ITEMS)
      .map(normalizeCandidate)
      .filter(candidate => candidate?.kind === kind)
      .map(candidate => {
        const matches = candidateKeys(candidate).filter(value => value.startsWith(key));
        return {
          candidate,
          exact: matches.includes(key) ? 0 : 1,
          length: matches.length ? Math.min(...matches.map(value => value.length)) : Number.MAX_SAFE_INTEGER,
        };
      })
      .filter(row => row.length !== Number.MAX_SAFE_INTEGER)
      .sort((left, right) => (
        left.exact - right.exact
        || left.length - right.length
        || left.candidate.name.localeCompare(right.candidate.name, 'ja')
      ));
    const seen = new Set();
    const result = [];
    for (const row of items) {
      if (seen.has(row.candidate.candidate_id)) continue;
      seen.add(row.candidate.candidate_id);
      result.push(row.candidate);
      if (result.length >= offset + limit) break;
    }
    return result.slice(offset, offset + limit);
  }

  function ensureGroups(catalog, rawGroups) {
    let parentId = null;
    let created = 0;
    for (const raw of normalizedGroups(rawGroups)) {
      const key = identity(`${parentId || ''}\n${raw.name}`);
      let group = catalog.groups.find(item => (
        identity(`${item.parent_id || ''}\n${item.name}`) === key
      ));
      if (!group) {
        group = {
          id: randomId(),
          name: cleanName(raw.name),
          parent_id: parentId,
          color: raw.color,
          description: raw.description,
          sort_index: sortIndex(raw.sort_index),
          collapsed: false,
        };
        catalog.groups.push(group);
        created += 1;
      }
      parentId = group.id;
    }
    return { groupId: parentId, created };
  }

  function safeAliases(catalog, target, values) {
    const ownId = String(target.id);
    const owners = new Map();
    catalog.tags.forEach(tag => {
      [tag.name, ...(tag.aliases || [])].forEach(value => {
        const key = identity(value);
        if (!key) return;
        if (!owners.has(key)) owners.set(key, new Set());
        owners.get(key).add(String(tag.id));
      });
    });
    return [...new Set([...(target.aliases || []), ...stringList(values)])]
      .filter(value => {
        const ownerIds = owners.get(identity(value));
        return !ownerIds || [...ownerIds].every(id => id === ownId);
      });
  }

  function findExistingTag(catalog, candidate) {
    const exactKey = identity(candidate.name);
    const exact = catalog.tags.find(item => identity(item.name) === exactKey);
    if (exact) return exact;
    const candidateIdentities = new Set(
      [candidate.name, ...(candidate.aliases || [])].map(identity).filter(Boolean),
    );
    const matches = catalog.tags.filter(tag => (
      [tag.name, ...(tag.aliases || [])]
        .map(identity)
        .some(key => candidateIdentities.has(key))
    ));
    return matches.length === 1 ? matches[0] : null;
  }

  async function materialize(provider, candidate) {
    const normalized = normalizeCandidate(candidate);
    if (!normalized) throw new Error('外部カタログ候補が不正です');
    const current = await tagDictionary.readCatalog(provider);
    tagDictionary.requireCatalogMutable(current);
    let created = 0;
    let updated = 0;
    let resolvedId = '';
    const saved = await tagDictionary.writeCatalog(provider, catalog => {
      created = 0;
      updated = 0;
      resolvedId = '';
      if (normalized.kind === 'group') {
        const groups = ensureGroups(catalog, normalized.definition.groups);
        created += groups.created;
        resolvedId = groups.groupId || '';
        return catalog;
      }
      let tag = findExistingTag(catalog, normalized);
      const groups = tag?.group_id
        ? { groupId: tag.group_id, created: 0 }
        : ensureGroups(catalog, normalized.definition.groups);
      created += groups.created;
      if (!tag) {
        tag = {
          id: randomId(),
          name: cleanName(normalized.name),
          aliases: [],
          presets: stringList(normalized.definition.presets).length
            ? stringList(normalized.definition.presets)
            : ['外部タグカタログ'],
          auto_assign: true,
          group_id: groups.groupId,
          color: normalized.definition.color,
          description: normalized.definition.description,
          sort_index: sortIndex(normalized.definition.sort_index),
        };
        tag.aliases = safeAliases(catalog, tag, normalized.definition.aliases);
        catalog.tags.push(tag);
        created += 1;
      } else {
        const before = JSON.stringify(tag);
        tag.aliases = safeAliases(catalog, tag, normalized.definition.aliases);
        tag.presets = stringList([
          ...(tag.presets || []),
          ...(normalized.definition.presets || []),
        ]);
        if (!tag.group_id && groups.groupId) tag.group_id = groups.groupId;
        if (!tag.color) tag.color = normalized.definition.color;
        if (!tag.description) tag.description = normalized.definition.description;
        if (JSON.stringify(tag) !== before) updated += 1;
      }
      resolvedId = tag.id;
      return catalog;
    });
    const item = normalized.kind === 'tag'
      ? saved.tags.find(tag => tag.id === resolvedId)
      : saved.groups.find(group => group.id === resolvedId);
    return { ok: true, created, updated, kind: normalized.kind, item };
  }

  async function route({ method, body, url, pathname }) {
    if (!pathname.startsWith('/external-tag-catalog')) return NOT_HANDLED;
    const query = url?.searchParams || new URL(`http://local${pathname}`).searchParams;
    if (pathname === '/external-tag-catalog/suggestions' && method === 'GET') {
      const value = String(query.get('query') || '').trim();
      if (!value) {
        return { ok: true, available: false, items: [], startup_io: false };
      }
      if (globalThis.navigator?.onLine === false) {
        return { ok: true, available: false, offline: true, items: [], startup_io: false };
      }
      const provider = await _requirePwaProvider('read');
      const shard = await _readJsonSafe(provider, `${ROOT}/${shardName(value)}`, null);
      const kind = query.get('kind') === 'group' ? 'group' : 'tag';
      const limit = Math.max(1, Math.min(50, Number(query.get('limit') || 20)));
      const offset = Math.max(0, Math.min(1000000, Number(query.get('offset') || 0)));
      const page = searchShard(shard, value, kind, limit + 1, offset);
      const items = page.slice(0, limit);
      return {
        ok: true,
        available: !!shard,
        needs_prepare: false,
        items,
        has_more: page.length > limit,
        next_offset: offset + items.length,
        startup_io: false,
      };
    }
    if (pathname === '/external-tag-catalog/prepare' && method === 'POST') {
      return { ok: true, status: 'unavailable', available: false, needs_prepare: false };
    }
    if (pathname === '/external-tag-catalog/materialize' && method === 'POST') {
      const provider = await _requirePwaProvider('readwrite');
      return materialize(provider, body?.candidate);
    }
    return NOT_HANDLED;
  }

  handlers.push(route);
  window.MeldexDropboxExternalTagCatalog = {
    normalizeCandidate,
    searchKey,
    searchShard,
    shardName,
  };
})();
