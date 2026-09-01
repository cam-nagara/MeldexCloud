/* 共有ワークスペースの管理者タグ辞書。
 * 個人辞書とは別のSystemStorage文書を使い、管理者定義・管理者割当・監査を
 * 分離する。メンバーが管理者タグを使う時は個人辞書へコピーし、出所を残す。 */
(function attachAdminTagDictionary(global) {
  'use strict';

  const KIND = 'admin-tag-dictionary';
  const CATALOG_SCHEMA = 'meldex.admin-tag-catalog.v1';
  const ASSIGNMENTS_SCHEMA = 'meldex.admin-tag-assignments.v1';
  const FEATURE_GATE = 'admin-tag-dictionary-v1';
  const CATALOG_ID = 'catalog';
  const ADMIN_ID_PREFIX = 'admin:';
  const ADMIN_GROUP_PREFIX = 'admin-group:';
  const MAX_TAGS = 10000;
  let lastCatalog = null;

  function roleState() {
    const state = global.MeldexRuntimeAdapter?.getWorkspaceState?.() || {};
    const role = String(state.access?.role || state.role || state.access || '').trim().toLowerCase();
    return { state, role, canManage: state.isOwner === true || role === 'owner' || role === 'admin' };
  }

  function workspaceId() {
    const state = roleState().state;
    return String(state.workspaceId || state.workspace_id || state.id || '').trim();
  }

  function requireApi() {
    if (typeof global.apiFetch !== 'function' || typeof global.apiPost !== 'function') {
      throw new Error('管理者タグ辞書のサーバ権限境界へ接続できません');
    }
  }

  function cleanText(value, max) { return String(value || '').trim().slice(0, max); }
  function tagId(value) { return cleanText(value, 128).replace(/^admin:/, ''); }

  function normalizeTag(raw) {
    const name = cleanText(raw?.name, 80);
    if (!name) return null;
    const color = /^#[0-9a-f]{6}$/i.test(String(raw?.color || '').trim()) ? String(raw.color).trim() : '';
    return {
      id: tagId(raw?.id) || crypto.randomUUID().replace(/-/g, ''),
      name,
      color,
      description: cleanText(raw?.description, 500),
      aliases: Array.from(new Set((Array.isArray(raw?.aliases) ? raw.aliases : [])
        .map(value => cleanText(value, 80)).filter(Boolean))).slice(0, 100),
      group_id: cleanText(raw?.group_id, 128) || null,
      sort_index: Number.isFinite(Number(raw?.sort_index)) ? Number(raw.sort_index) : 0,
      auto_assign: raw?.auto_assign === true,
      created_at: cleanText(raw?.created_at, 64) || new Date().toISOString(),
      updated_at: cleanText(raw?.updated_at, 64) || new Date().toISOString(),
    };
  }

  function normalizeGroup(raw) {
    const name = cleanText(raw?.name, 80);
    if (!name) return null;
    return {
      id: cleanText(raw?.id, 128) || crypto.randomUUID().replace(/-/g, ''),
      name,
      parent_id: cleanText(raw?.parent_id, 128) || null,
      color: /^#[0-9a-f]{6}$/i.test(String(raw?.color || '').trim()) ? String(raw.color).trim() : '',
      description: cleanText(raw?.description, 500),
      sort_index: Number.isFinite(Number(raw?.sort_index)) ? Number(raw.sort_index) : 0,
      created_at: cleanText(raw?.created_at, 64) || new Date().toISOString(),
      updated_at: cleanText(raw?.updated_at, 64) || new Date().toISOString(),
    };
  }

  function blankCatalog(id) {
    return { schema: CATALOG_SCHEMA, schema_version: 1, feature_gate: FEATURE_GATE,
      workspace_id: id, tags: [], groups: [], updated_by: '', updated_at: '' };
  }

  function normalizeCatalog(value, expectedWorkspaceId) {
    const raw = value && typeof value === 'object' ? value : {};
    if (raw.schema && raw.schema !== CATALOG_SCHEMA) throw new Error('管理者タグ辞書のschemaVersionが未対応です');
    const actualWorkspace = cleanText(raw.workspace_id, 128) || expectedWorkspaceId;
    if (actualWorkspace !== expectedWorkspaceId) throw new Error('管理者タグ辞書のworkspace境界が一致しません');
    const groups = (Array.isArray(raw.groups) ? raw.groups : []).map(normalizeGroup).filter(Boolean);
    const validGroups = new Set(groups.map(row => row.id));
    groups.forEach(group => { if (group.parent_id && !validGroups.has(group.parent_id)) group.parent_id = null; });
    const tags = [];
    const ids = new Set();
    for (const rawTag of Array.isArray(raw.tags) ? raw.tags : []) {
      const tag = normalizeTag(rawTag);
      if (!tag || ids.has(tag.id)) continue;
      ids.add(tag.id);
      if (tag.group_id && !validGroups.has(tag.group_id)) tag.group_id = null;
      tags.push(tag);
      if (tags.length > MAX_TAGS) throw new Error(`管理者タグ辞書は${MAX_TAGS.toLocaleString()}件までです`);
    }
    return { ...blankCatalog(expectedWorkspaceId), ...raw, schema: CATALOG_SCHEMA, schema_version: 1,
      feature_gate: FEATURE_GATE, workspace_id: expectedWorkspaceId, tags, groups };
  }

  function blankAssignments(id) {
    return { schema: ASSIGNMENTS_SCHEMA, schema_version: 1, feature_gate: FEATURE_GATE,
      workspace_id: id, entries: {}, updated_by: '', updated_at: '' };
  }

  function normalizeTargetPath(value) {
    const text = String(value || '').replace(/\\/g, '/').replace(/\/+/g, '/').trim();
    if (!text || text.includes('\u0000') || text.split('/').includes('..')) throw new Error('タグ付与対象パスが不正です');
    return text.replace(/^\/+|\/+$/g, '') || '.';
  }

  function tagSnapshot(tag, id) {
    return {
      tag_uid: tagId(tag?.id), name: cleanText(tag?.name, 80),
      aliases: Array.isArray(tag?.aliases) ? tag.aliases.map(value => cleanText(value, 80)).filter(Boolean) : [],
      group_path: [],
      origin: { scope: 'admin', workspace_id: id, admin_tag_id: tagId(tag?.id), used_name: cleanText(tag?.name, 80) },
    };
  }

  function normalizeAssignments(value, expectedWorkspaceId) {
    const raw = value && typeof value === 'object' ? value : {};
    if (raw.schema && raw.schema !== ASSIGNMENTS_SCHEMA) throw new Error('管理者タグ割当のschemaVersionが未対応です');
    if (raw.workspace_id && raw.workspace_id !== expectedWorkspaceId) throw new Error('管理者タグ割当のworkspace境界が一致しません');
    const entries = {};
    Object.entries(raw.entries && typeof raw.entries === 'object' ? raw.entries : {}).forEach(([path, rows]) => {
      let key;
      try { key = normalizeTargetPath(path); } catch { return; }
      const seen = new Set();
      const snapshots = [];
      (Array.isArray(rows) ? rows : []).forEach(row => {
        const id = tagId(row?.tag_uid || row?.id);
        const name = cleanText(row?.name, 80);
        if (!id || !name || seen.has(id)) return;
        seen.add(id);
        snapshots.push({ tag_uid: id, name,
          aliases: Array.isArray(row?.aliases) ? row.aliases.map(value => cleanText(value, 80)).filter(Boolean) : [],
          group_path: Array.isArray(row?.group_path) ? row.group_path.map(value => cleanText(value, 80)).filter(Boolean) : [],
          origin: { scope: 'admin', workspace_id: expectedWorkspaceId, admin_tag_id: id,
            used_name: cleanText(row?.origin?.used_name || name, 80) } });
      });
      if (snapshots.length) entries[key] = snapshots;
    });
    return { ...blankAssignments(expectedWorkspaceId), ...raw, schema: ASSIGNMENTS_SCHEMA,
      schema_version: 1, feature_gate: FEATURE_GATE, workspace_id: expectedWorkspaceId, entries };
  }

  async function loadCatalog() {
    const id = workspaceId();
    if (!id) return { available: false, catalog: blankCatalog(''), revision: null, offline: false };
    try {
      requireApi();
      const response = await global.apiFetch(`/admin-tag-dictionary?workspace_id=${encodeURIComponent(id)}`,
        { silentError: true, timeoutMs: 120000 });
      lastCatalog = normalizeCatalog(response || {}, id);
      return { available: true, catalog: lastCatalog, revision: response?.revision ?? null,
        canManage: response?.can_manage === true, role: response?.role || '', offline: false };
    } catch (error) {
      if (lastCatalog?.workspace_id === id) return { available: true, catalog: lastCatalog, revision: null,
        canManage: false, offline: true, warning: '管理者辞書へ接続できないため、最後に確認した内容を読み取り専用で表示しています' };
      throw error;
    }
  }

  async function loadAssignments() {
    return { available: false, assignments: blankAssignments(workspaceId()), revision: null };
  }

  function adminDisplayTag(tag, id) {
    return { ...tag, id: ADMIN_ID_PREFIX + tag.id, group_id: tag.group_id ? ADMIN_GROUP_PREFIX + tag.group_id : null,
      _dictionary_scope: 'admin', _admin_tag_id: tag.id, _workspace_id: id,
      _tag_origin: { scope: 'admin', workspace_id: id, admin_tag_id: tag.id, used_name: tag.name } };
  }

  function mergeCatalog(personal, adminState) {
    const base = personal && typeof personal === 'object' ? personal : { tags: [], groups: [] };
    if (!adminState?.available) return base;
    const id = adminState.catalog.workspace_id;
    const personalTags = (Array.isArray(base.tags) ? base.tags : []).map(tag => ({ ...tag,
      _dictionary_scope: 'personal', _tag_origin: tag.origin || {} }));
    const byExactName = new Map(personalTags.map(tag => [String(tag.name || ''), tag]));
    const tags = [...personalTags];
    adminState.catalog.tags.forEach(raw => {
      const existing = byExactName.get(raw.name);
      if (existing) {
        existing._dictionary_scope = 'duplicate';
        existing._admin_tag_id = raw.id;
        existing._admin_definition = adminDisplayTag(raw, id);
      } else tags.push(adminDisplayTag(raw, id));
    });
    const groups = [...(Array.isArray(base.groups) ? base.groups : []), ...adminState.catalog.groups.map(group => ({
      ...group, id: ADMIN_GROUP_PREFIX + group.id,
      parent_id: group.parent_id ? ADMIN_GROUP_PREFIX + group.parent_id : null,
      _dictionary_scope: 'admin',
    }))];
    return { ...base, tags, groups, admin_dictionary: {
      available: true, offline: !!adminState.offline, can_manage: !!adminState.canManage,
      workspace_id: id, warning: adminState.warning || '', revision: adminState.revision,
    }, warning: adminState.warning || base.warning || '' };
  }

  async function mergeWithPersonalCatalog(personal) {
    try { return mergeCatalog(personal, await loadCatalog()); }
    catch (error) { return { ...personal, admin_dictionary: { available: false, error: String(error?.message || error) } }; }
  }

  async function createTag(payload) {
    requireApi();
    const response = await global.apiPost('/admin-tag-dictionary', { ...payload, workspace_id: workspaceId() }, { silentError: true });
    lastCatalog = null;
    return { ...response, tag: response?.tag ? adminDisplayTag(response.tag, workspaceId()) : response?.tag };
  }

  async function updateTag(id, payload) {
    const rawId = tagId(id);
    requireApi();
    const response = await global.apiPost(`/admin-tag-dictionary/${encodeURIComponent(rawId)}`,
      { ...payload, workspace_id: workspaceId() }, { method: 'PATCH', silentError: true });
    lastCatalog = null;
    return response;
  }

  async function deleteTag(id) {
    const rawId = tagId(id);
    requireApi();
    const response = await global.apiFetch(`/admin-tag-dictionary/${encodeURIComponent(rawId)}?workspace_id=${encodeURIComponent(workspaceId())}`,
      { method: 'DELETE', silentError: true });
    lastCatalog = null;
    return response;
  }

  async function useTag(path, tag, sourceFolder) {
    const definition = tag?._admin_definition || tag;
    const rawId = tagId(tag?._admin_tag_id || definition?.id);
    requireApi();
    return global.apiPost('/admin-tag-dictionary/use', {
      workspace_id: workspaceId(), path: normalizeTargetPath(path), tag_id: rawId,
      ...(sourceFolder ? { source_folder: sourceFolder } : {}),
    }, { silentError: true });
  }

  async function setAdminAssignment(path, tag, checked) {
    const target = normalizeTargetPath(path);
    const rawTag = tag?._admin_definition || tag;
    const rawId = tagId(tag?._admin_tag_id || rawTag?.id);
    requireApi();
    return global.apiPost('/admin-tag-dictionary/target', {
      workspace_id: workspaceId(), path: target, tag_id: rawId, checked: checked !== false,
    }, { method: 'PUT', silentError: true });
  }

  async function mergeTargetTags(path, personal) {
    let key;
    try { key = normalizeTargetPath(path); } catch { return personal; }
    let response;
    try {
      requireApi();
      response = await global.apiFetch(`/admin-tag-dictionary/target?workspace_id=${encodeURIComponent(workspaceId())}&path=${encodeURIComponent(key)}`,
        { silentError: true, timeoutMs: 120000 });
    } catch { return personal; }
    const adminRows = (response?.tags || []).map(snapshot => ({
      id: ADMIN_ID_PREFIX + snapshot.tag_uid, name: snapshot.name, aliases: snapshot.aliases,
      _dictionary_scope: 'admin', _admin_tag_id: snapshot.tag_uid,
      _workspace_id: workspaceId(), _tag_origin: snapshot.origin,
    }));
    const personalRows = Array.isArray(personal?.tags) ? personal.tags.map(row => ({ ...row, _dictionary_scope: 'personal' })) : [];
    const byExact = new Map(personalRows.map(row => [String(row.name || ''), row]));
    adminRows.forEach(admin => {
      const same = byExact.get(admin.name);
      if (same) { same._dictionary_scope = 'duplicate'; same._admin_tag_id = admin._admin_tag_id; same._admin_definition = admin; }
      else personalRows.push(admin);
    });
    return { ...personal, tags: personalRows, admin_assignment_offline: false };
  }

  global.MeldexAdminTagDictionary = Object.freeze({
    KIND, CATALOG_SCHEMA, ASSIGNMENTS_SCHEMA, FEATURE_GATE, ADMIN_ID_PREFIX,
    roleState, normalizeCatalog, normalizeAssignments, mergeCatalog, mergeWithPersonalCatalog,
    loadCatalog, loadAssignments, createTag, updateTag, deleteTag, useTag,
    setAdminAssignment, mergeTargetTags, normalizeTargetPath,
  });
})(window);
