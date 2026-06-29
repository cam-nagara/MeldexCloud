(function () {
  'use strict';

  const internals = window.__MeldexPwaDataAccessInternals;
  const handlers = window.__MeldexPwaDataAccessExtensions;
  if (!internals || !Array.isArray(handlers)) return;

  const {
    NOT_HANDLED,
    _normalizeFolderPath,
    _joinPath,
    _readJsonSafe,
    _requirePwaProvider,
    _pathExists,
    _iterateWorkspaceFiles,
  } = internals;

  const STORE_DIR = '_knowledge';
  const MEMORY_DIRECTIVES_PATH = '/memory_directives';
  const DEFAULT_STATUS = '(未設定)';
  const BOOL_FIELDS = [
    'is_canonical',
    'override_protection',
    'learnable',
    'ideation_usable',
    'contradiction_check',
    'llm_reference',
    'llm_citation',
    'chat_response',
    'publish_allowed',
    'unlock_requires_confirmation',
  ];
  const PRESET_POLICIES = [
    { status_value: '掲載済み', display_label: '掲載済み', display_color: '#1e90ff', is_canonical: 1, override_protection: 1, learnable: 1, ideation_usable: 1, contradiction_check: 1, llm_reference: 1, llm_citation: 1, chat_response: 1, publish_allowed: 1, taste_learning_weight: 1, unlock_requires_confirmation: 1, is_system: 1, description: '公表済み、絶対不可逆', sort_order: 10 },
    { status_value: '連載中', display_label: '連載中', display_color: '#2563eb', is_canonical: 1, override_protection: 1, learnable: 1, ideation_usable: 1, contradiction_check: 1, llm_reference: 1, llm_citation: 1, chat_response: 1, publish_allowed: 1, taste_learning_weight: 1, unlock_requires_confirmation: 1, is_system: 1, description: '連載で公表中、最新話は未掲載なら可変だが原則固定', sort_order: 20 },
    { status_value: '確定', display_label: '確定', display_color: '#16a34a', is_canonical: 0, override_protection: 1, learnable: 1, ideation_usable: 1, contradiction_check: 1, llm_reference: 1, llm_citation: 1, chat_response: 1, publish_allowed: 0, taste_learning_weight: 1, unlock_requires_confirmation: 0, is_system: 1, description: '内部確定、未公表だが上書き保護', sort_order: 30 },
    { status_value: '草稿', display_label: '草稿', display_color: '#f59e0b', is_canonical: 0, override_protection: 0, learnable: 1, ideation_usable: 1, contradiction_check: 0, llm_reference: 1, llm_citation: 0, chat_response: 1, publish_allowed: 0, taste_learning_weight: 0.7, unlock_requires_confirmation: 0, is_system: 1, description: '流動的、学習対象だが弱い重み', sort_order: 40 },
    { status_value: '保留', display_label: '保留', display_color: '#8b5cf6', is_canonical: 0, override_protection: 0, learnable: 1, ideation_usable: 0, contradiction_check: 0, llm_reference: 1, llm_citation: 0, chat_response: 0, publish_allowed: 0, taste_learning_weight: 0.5, unlock_requires_confirmation: 0, is_system: 1, description: '学習はするがアイディア入力には使わない', sort_order: 50 },
    { status_value: 'ボツ', display_label: 'ボツ', display_color: '#6b7280', is_canonical: 0, override_protection: 0, learnable: 0, ideation_usable: 0, contradiction_check: 0, llm_reference: 0, llm_citation: 0, chat_response: 0, publish_allowed: 0, taste_learning_weight: 0, unlock_requires_confirmation: 0, is_system: 1, description: '完全除外（学習も連想もしない）', sort_order: 60 },
    { status_value: '(未設定)', display_label: '(未設定)', display_color: '#94a3b8', is_canonical: 0, override_protection: 0, learnable: 1, ideation_usable: 1, contradiction_check: 0, llm_reference: 1, llm_citation: 0, chat_response: 1, publish_allowed: 1, taste_learning_weight: 1, unlock_requires_confirmation: 0, is_system: 1, description: 'デフォルト（status 未指定時）', sort_order: 70 },
  ];

  const STORES = {
    knowledge: { path: 'knowledge_items.json', scope: 'knowledge_items', key: 'items', empty: { items: [], next_id: 1 } },
    rules: { path: 'chat_rules.json', scope: 'chat_rules', key: 'rules', empty: { rules: [], next_id: 1 } },
    policies: { path: 'status_policies.json', scope: 'status_policies', key: 'policies', empty: { policies: [] } },
    tasteSettings: { path: 'taste_settings.json', scope: 'taste_settings', key: 'settings', empty: { settings: { enabled: false, owner_id: 'cloud' } } },
    taste: { path: 'taste_principles.json', scope: 'taste_principles', key: 'items', empty: { items: [], next_id: 1 } },
    tasteFeedback: { path: 'taste_feedback.json', scope: 'taste_feedback', key: 'items', empty: { items: [] } },
    memory: { path: 'memory_directives.json', scope: 'memory_directives', key: 'items', empty: { items: [], next_id: 1 } },
  };

  function _nowIso() {
    return new Date().toISOString();
  }

  function _storePath(def) {
    return _joinPath(STORE_DIR, def.path);
  }

  function _role() {
    const state = window.MeldexRuntimeAdapter?.getWorkspaceState?.() || {};
    if (state.isOwner) return 'owner';
    return state.access === 'viewer' ? 'viewer' : 'editor';
  }

  function _authMe(url) {
    const state = window.MeldexRuntimeAdapter?.getWorkspaceState?.() || {};
    const user = url?.searchParams?.get('username') || state.accountName || state.accountId || 'anonymous';
    const role = _role();
    return { user, username: user, role, access: state.access || (role === 'viewer' ? 'viewer' : 'editor'), is_owner: role === 'owner' };
  }

  function _requireOwner() {
    if (_role() !== 'owner') throw new Error('ナレッジ編集は管理者のみ可能です');
  }

  function _clone(value) {
    return JSON.parse(JSON.stringify(value == null ? null : value));
  }

  function _asBool(value) {
    return value === true || value === 1 || value === '1' || String(value || '').toLowerCase() === 'true';
  }

  function _nextId(rows) {
    return Math.max(0, ...(rows || []).map(row => Number(row?.id || 0))) + 1;
  }

  function _matches(row, query, fields) {
    const q = String(query || '').trim().toLowerCase();
    if (!q) return true;
    const haystack = fields.map(field => String(row?.[field] || '').toLowerCase()).join('\n');
    if (haystack.includes(q)) return true;
    const terms = q.split(/[\s　,.;:!?？。、，．；：]+/).map(term => term.trim()).filter(Boolean);
    return terms.length ? terms.every(term => haystack.includes(term)) : true;
  }

  function _sortByFreshness(rows) {
    return rows.sort((a, b) => {
      const pinDelta = Number(!!b.pinned || !!b.user_pinned) - Number(!!a.pinned || !!a.user_pinned);
      if (pinDelta) return pinDelta;
      return String(b.updated || b.created || '').localeCompare(String(a.updated || a.created || '')) || Number(b.id || 0) - Number(a.id || 0);
    });
  }

  function _queryTerms(query) {
    const seen = new Set();
    return String(query || '').toLowerCase().match(/[a-z0-9_]{2,}|[一-龥ぁ-んァ-ヴー々〆ヵヶ]{2,}/g)?.filter(term => {
      if (seen.has(term)) return false;
      seen.add(term);
      return !['これ', 'それ', 'こと', 'もの', 'ため', 'する', 'した', 'して', 'ナレッジ', '設定', '変更', '確認'].includes(term);
    }).slice(0, 18) || [];
  }

  function _termHits(text, terms) {
    const haystack = String(text || '').toLowerCase();
    return (terms || []).filter(term => term && haystack.includes(term)).length;
  }

  function _knowledgeSearchScore(item, query) {
    const q = String(query || '').trim().toLowerCase();
    const terms = _queryTerms(q);
    const hasQuery = !!(q || terms.length);
    let score = 0;
    if (_asBool(item?.is_canonical)) score += 14;
    if (_asBool(item?.pinned) || _asBool(item?.user_pinned)) score += hasQuery ? 10 : 42;
    if (['decision', 'fact', 'team_consensus'].includes(String(item?.type || ''))) score += 3;
    if (String(item?.type || '') === 'preference') score += 1.5;
    score += Math.min(8, Math.max(0, Number(item?.confidence || 0) * 8));
    score += Math.min(4, Number(item?.use_count || 0) * 0.4);
    const subject = String(item?.subject || '').toLowerCase();
    const statement = String(item?.statement || '').toLowerCase();
    const reasoning = String(item?.reasoning || '').toLowerCase();
    if (hasQuery) {
      if (q && subject.includes(q)) score += 55;
      else if (q && statement.includes(q)) score += 45;
      else if (q && reasoning.includes(q)) score += 25;
      score += _termHits(subject, terms) * 18;
      score += _termHits(statement, terms) * 12;
      score += _termHits(reasoning, terms) * 6;
    }
    return score;
  }

  function _sortKnowledgeForQuery(items, query) {
    return (items || []).slice().sort((a, b) => {
      const scoreDelta = _knowledgeSearchScore(b, query) - _knowledgeSearchScore(a, query);
      if (scoreDelta) return scoreDelta;
      return String(b.updated || b.created || '').localeCompare(String(a.updated || a.created || '')) || Number(b.id || 0) - Number(a.id || 0);
    });
  }

  async function _readStore(provider, def) {
    const fallback = _clone(def.empty);
    const path = _storePath(def);
    const exists = typeof _pathExists === 'function' ? await _pathExists(provider, path).catch(() => false) : true;
    if (!exists) {
      return { ...fallback, verification: { ok: true, skipped: true, reason: 'store-missing' }, store_missing: true };
    }
    const data = await _readJsonSafe(provider, path, fallback);
    const payload = data && typeof data === 'object' ? { ...fallback, ...data } : fallback;
    const verification = await window.MeldexKnowledgeSignature?.verify?.(provider, def.scope, payload).catch(err => ({ ok: false, error: err?.message || String(err) }));
    return { ...payload, verification };
  }

  function _assertWritable(store) {
    const verification = store?.verification;
    if (verification && verification.ok === false && !verification.skipped) {
      throw new Error('ナレッジ情報の署名検証に失敗しました');
    }
  }

  async function _writeStore(provider, def, payload, audit) {
    const next = { ...payload, updated_at: _nowIso() };
    await provider.writeJson(_storePath(def), next);
    await window.MeldexKnowledgeSignature?.sign?.(provider, def.scope, next, { signer: typeof getUsername === 'function' ? getUsername() : '' }).catch(() => null);
    if (audit) await window.MeldexKnowledgeSignature?.recordAudit?.(provider, def.scope, audit).catch(() => {});
    return next;
  }

  function _cleanKnowledge(body, existing) {
    const now = _nowIso();
    const row = { ...(existing || {}) };
    row.type = String(body?.type ?? row.type ?? 'fact').trim() || 'fact';
    row.subject = String(body?.subject ?? row.subject ?? '').trim() || String(body?.statement ?? row.statement ?? '').trim().slice(0, 40) || '無題';
    row.statement = String(body?.statement ?? row.statement ?? '').trim();
    row.reasoning = String(body?.reasoning ?? row.reasoning ?? '').trim();
    row.confidence = Number.isFinite(Number(body?.confidence)) ? Number(body.confidence) : Number(row.confidence ?? 1);
    row.source_folder = _normalizeFolderPath(body?.source_folder ?? row.source_folder ?? '');
    row.scope = String(body?.scope ?? row.scope ?? '').trim();
    row.source_status = String(body?.source_status ?? row.source_status ?? '').trim();
    row.source_chat_path = _normalizeFolderPath(body?.source_chat_path ?? row.source_chat_path ?? '');
    row.source_msg_id = String(body?.source_msg_id ?? row.source_msg_id ?? '').trim();
    row.source_file_path = _normalizeFolderPath(body?.source_file_path ?? row.source_file_path ?? '');
    row.canonical_source_path = _normalizeFolderPath(body?.canonical_source_path ?? row.canonical_source_path ?? '');
    if (Object.prototype.hasOwnProperty.call(body || {}, 'pinned')) row.pinned = _asBool(body.pinned);
    else row.pinned = !!row.pinned;
    if (Object.prototype.hasOwnProperty.call(body || {}, 'is_canonical')) row.is_canonical = _asBool(body.is_canonical);
    else row.is_canonical = !!row.is_canonical;
    if (Object.prototype.hasOwnProperty.call(body || {}, 'superseded_by')) row.superseded_by = body.superseded_by || null;
    row.user_edited = Object.prototype.hasOwnProperty.call(body || {}, 'user_edited') ? _asBool(body.user_edited) : !!row.user_edited;
    row.created = row.created || now;
    row.updated = now;
    row.last_used = String(body?.last_used ?? row.last_used ?? '');
    row.use_count = Number.isFinite(Number(body?.use_count ?? row.use_count)) ? Number(body?.use_count ?? row.use_count) : 0;
    return row;
  }

  async function listKnowledgeItems(provider, query = {}) {
    const store = await _readStore(provider, STORES.knowledge);
    const type = String(query.type || '').trim();
    const includeDeleted = _asBool(query.include_deleted);
    const includeSuperseded = _asBool(query.include_superseded);
    let items = Array.isArray(store.items) ? store.items.slice() : [];
    if (!includeDeleted) items = items.filter(item => !item.deleted_at);
    if (!includeSuperseded) items = items.filter(item => !item.superseded_by);
    if (type) items = items.filter(item => item.type === type);
    items = items.filter(item => _matches(item, query.q, ['subject', 'statement', 'reasoning', 'source_status', 'type']));
    return { items: _sortByFreshness(items), count: items.length, verification: store.verification };
  }

  async function searchKnowledgeItems(provider, q = '', limit = 10) {
    const max = Math.max(1, Math.min(Number(limit || 10), 50));
    const payload = await listKnowledgeItems(provider, { q, include_superseded: false, include_deleted: false });
    const pinnedPayload = q
      ? await listKnowledgeItems(provider, { include_superseded: false, include_deleted: false }).catch(() => ({ items: [] }))
      : { items: [] };
    const seen = new Set();
    const combined = [];
    [...(payload.items || []), ...(pinnedPayload.items || []).filter(item => item.pinned || item.user_pinned)].forEach(item => {
      const key = String(item?.id || `${item?.subject || ''}:${item?.statement || ''}`);
      if (seen.has(key)) return;
      seen.add(key);
      combined.push(item);
    });
    const results = _sortKnowledgeForQuery(combined, q).slice(0, max);
    return { results, count: results.length, verification: payload.verification };
  }

  function _countBy(items, field) {
    const counts = new Map();
    (items || []).forEach(item => {
      const key = String(item?.[field] || DEFAULT_STATUS);
      counts.set(key, (counts.get(key) || 0) + 1);
    });
    return [...counts.entries()]
      .map(([key, count]) => ({ [field]: key, count }))
      .sort((a, b) => Number(b.count || 0) - Number(a.count || 0) || String(a[field] || '').localeCompare(String(b[field] || ''), 'ja'));
  }

  function _statusText(value) {
    let text = String(value == null ? '' : value).trim();
    if (!text) return DEFAULT_STATUS;
    try {
      const parsed = JSON.parse(text);
      if (typeof parsed === 'string') text = parsed.trim();
    } catch {}
    text = text.replace(/^['"]|['"]$/g, '').trim();
    return text || DEFAULT_STATUS;
  }

  function _frontmatterBlock(raw) {
    const match = String(raw || '').match(/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
    return match ? match[1] : '';
  }

  function _frontmatterStatus(raw) {
    const block = _frontmatterBlock(raw);
    if (!block) return DEFAULT_STATUS;
    const direct = block.match(/(?:^|\n)status\s*:\s*([^\r\n]+)/);
    if (direct) return _statusText(direct[1]);
    const sourceStatus = block.match(/(?:^|\n)(?:source_status|sourceStatus|状態|ステータス)\s*:\s*([^\r\n]+)/);
    if (sourceStatus) return _statusText(sourceStatus[1]);
    const nested = block.match(/(?:^|\n)\s+status\s*:\s*([^\r\n]+)/);
    return nested ? _statusText(nested[1]) : DEFAULT_STATUS;
  }

  function _policyForStatus(policies, status) {
    const value = _statusText(status);
    return (policies || []).find(policy => policy.status_value === value)
      || (policies || []).find(policy => policy.status_value === DEFAULT_STATUS)
      || null;
  }

  async function _statusFromPath(provider, rawPath) {
    const path = _normalizeFolderPath(rawPath || '');
    if (!path) return { status: DEFAULT_STATUS, path: '' };
    try {
      const raw = await provider.readText(path);
      return { status: _frontmatterStatus(raw), path };
    } catch {
      return { status: DEFAULT_STATUS, path };
    }
  }

  async function resolveStatusPolicyForPath(provider, url) {
    const explicitStatus = url.searchParams.get('status');
    const path = url.searchParams.get('path') || '';
    const resolved = explicitStatus ? { status: _statusText(explicitStatus), path } : await _statusFromPath(provider, path);
    const payload = await listStatusPolicies(provider);
    return { status: resolved.status, path: resolved.path, policy: _policyForStatus(payload.policies, resolved.status) };
  }

  async function countStatusUsage(provider, statusValue) {
    const targetStatus = _statusText(statusValue);
    const usage = { entry_count: 0, knowledge_item_count: 0, reclassify_count: 0 };
    const knowledge = await listKnowledgeItems(provider, { include_superseded: true, include_deleted: true }).catch(() => ({ items: [] }));
    usage.knowledge_item_count = (knowledge.items || []).filter(item => _statusText(item?.source_status) === targetStatus).length;
    if (typeof _iterateWorkspaceFiles !== 'function') return usage;
    await _iterateWorkspaceFiles(provider, async (filePath) => {
      const path = _normalizeFolderPath(filePath || '');
      if (!path || !/\.md$/i.test(path)) return;
      try {
        const raw = await provider.readText(path);
        if (_frontmatterStatus(raw) === targetStatus) usage.entry_count += 1;
      } catch {}
    }, '').catch(() => {});
    return usage;
  }

  async function knowledgeSummary(provider) {
    const payload = await listKnowledgeItems(provider, { include_superseded: true, include_deleted: false });
    const items = payload.items || [];
    const recentUsage = items
      .filter(item => item.last_used)
      .sort((a, b) => String(b.last_used || '').localeCompare(String(a.last_used || '')) || Number(b.id || 0) - Number(a.id || 0))
      .slice(0, 12);
    return {
      source_folder: 'dropbox',
      total: items.length,
      type_counts: _countBy(items, 'type'),
      status_counts: _countBy(items, 'source_status'),
      recent_usage: recentUsage,
      recent_extraction_runs: [],
      open_conflicts: [],
      verification: payload.verification,
    };
  }

  async function createKnowledgeItem(provider, body = {}) {
    _requireOwner();
    const store = await _readStore(provider, STORES.knowledge);
    _assertWritable(store);
    const items = Array.isArray(store.items) ? store.items.slice() : [];
    const userEdited = Object.prototype.hasOwnProperty.call(body || {}, 'user_edited') ? body.user_edited : true;
    const item = _cleanKnowledge({ ...body, user_edited: userEdited }, null);
    if (!item.statement) throw new Error('statement は必須です');
    item.id = _nextId(items);
    items.push(item);
    await _writeStore(provider, STORES.knowledge, { items, next_id: _nextId(items) }, { action: 'create', id: item.id, subject: item.subject });
    return { ok: true, item };
  }

  async function updateKnowledgeItem(provider, id, patch = {}) {
    _requireOwner();
    const store = await _readStore(provider, STORES.knowledge);
    _assertWritable(store);
    const items = Array.isArray(store.items) ? store.items.slice() : [];
    const index = items.findIndex(item => Number(item.id) === Number(id));
    if (index < 0) throw new Error('記憶項目が見つかりません');
    items[index] = { ..._cleanKnowledge(patch, items[index]), id: items[index].id };
    await _writeStore(provider, STORES.knowledge, { items, next_id: store.next_id || _nextId(items) }, { action: 'update', id: Number(id) });
    return { ok: true, item: items[index] };
  }

  async function deleteKnowledgeItem(provider, id) {
    _requireOwner();
    const store = await _readStore(provider, STORES.knowledge);
    _assertWritable(store);
    const items = Array.isArray(store.items) ? store.items.slice() : [];
    const index = items.findIndex(item => Number(item.id) === Number(id));
    if (index < 0) throw new Error('記憶項目が見つかりません');
    items[index] = { ...items[index], deleted_at: _nowIso(), updated: _nowIso() };
    await _writeStore(provider, STORES.knowledge, { items, next_id: store.next_id || _nextId(items) }, { action: 'delete', id: Number(id) });
    return { ok: true, item: items[index] };
  }

  async function extractKnowledge(provider, body = {}) {
    _requireOwner();
    const path = _normalizeFolderPath(body.path || '');
    if (!path) throw new Error('path は必須です');
    const raw = await provider.readText(path);
    const lines = String(raw || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    const chosen = lines.find(line => /決定|確定|覚えて|記憶|方針/.test(line)) || lines.find(line => !/^---|^#/.test(line)) || '';
    if (!chosen) return { ok: true, created_count: 0, items: [] };
    const created = await createKnowledgeItem(provider, {
      type: /好み|好き|嫌い|文体|絵柄/.test(chosen) ? 'preference' : 'decision',
      subject: path.split('/').pop().replace(/\.[^.]+$/, ''),
      statement: chosen.slice(0, 1200),
      source_chat_path: path,
      confidence: 0.7,
      pinned: false,
    });
    return { ok: true, created_count: 1, items: [created.item] };
  }

  function _normalizeRulePriority(value, fallback = 100) {
    if (value == null || value === '') value = fallback;
    const number = Number(value);
    if (!Number.isFinite(number)) {
      const fallbackNumber = Number(fallback);
      return Number.isFinite(fallbackNumber) ? _normalizeRulePriority(fallbackNumber, 100) : 100;
    }
    return Math.max(0, Math.min(Math.trunc(number), 9999));
  }

  function _cleanRule(body, existing) {
    const now = _nowIso();
    const row = { ...(existing || {}) };
    row.title = String(body?.title ?? row.title ?? '無題ルール').trim() || '無題ルール';
    row.body = String(body?.body ?? row.body ?? '').trim();
    row.scope = String(body?.scope ?? row.scope ?? 'project').trim() || 'project';
    row.enabled = Object.prototype.hasOwnProperty.call(body || {}, 'enabled') ? _asBool(body.enabled) : row.enabled !== false;
    row.pinned = Object.prototype.hasOwnProperty.call(body || {}, 'pinned') ? _asBool(body.pinned) : !!row.pinned;
    row.priority = _normalizeRulePriority(body?.priority, row.priority ?? 100);
    row.source_chat_path = _normalizeFolderPath(body?.source_chat_path ?? row.source_chat_path ?? '');
    row.source_msg_id = String(body?.source_msg_id ?? row.source_msg_id ?? '').trim();
    row.created_by = String(body?.created_by ?? row.created_by ?? '').trim();
    row.created = row.created || now;
    row.updated = now;
    return row;
  }

  async function listChatRules(provider, includeDeleted = false) {
    const store = await _readStore(provider, STORES.rules);
    let rules = Array.isArray(store.rules) ? store.rules.slice() : [];
    if (!includeDeleted) rules = rules.filter(rule => !rule.deleted_at);
    rules.sort((a, b) => Number(a.priority || 100) - Number(b.priority || 100) || String(a.title || '').localeCompare(String(b.title || ''), 'ja'));
    return { rules, count: rules.length, verification: store.verification };
  }

  async function createChatRule(provider, body = {}) {
    _requireOwner();
    const store = await _readStore(provider, STORES.rules);
    _assertWritable(store);
    const rules = Array.isArray(store.rules) ? store.rules.slice() : [];
    const rule = _cleanRule(body, null);
    if (!rule.body) throw new Error('body は必須です');
    rule.id = _nextId(rules);
    rules.push(rule);
    await _writeStore(provider, STORES.rules, { rules, next_id: _nextId(rules) }, { action: 'create', id: rule.id, title: rule.title });
    return { ok: true, rule };
  }

  async function updateChatRule(provider, id, patch = {}) {
    _requireOwner();
    const store = await _readStore(provider, STORES.rules);
    _assertWritable(store);
    const rules = Array.isArray(store.rules) ? store.rules.slice() : [];
    const index = rules.findIndex(rule => Number(rule.id) === Number(id));
    if (index < 0) throw new Error('チャットルールが見つかりません');
    rules[index] = { ..._cleanRule(patch, rules[index]), id: rules[index].id };
    await _writeStore(provider, STORES.rules, { rules, next_id: store.next_id || _nextId(rules) }, { action: 'update', id: Number(id) });
    return { ok: true, rule: rules[index] };
  }

  async function deleteChatRule(provider, id) {
    _requireOwner();
    const store = await _readStore(provider, STORES.rules);
    _assertWritable(store);
    const rules = Array.isArray(store.rules) ? store.rules.slice() : [];
    const index = rules.findIndex(rule => Number(rule.id) === Number(id));
    if (index < 0) throw new Error('チャットルールが見つかりません');
    rules[index] = { ...rules[index], deleted_at: _nowIso(), updated: _nowIso() };
    await _writeStore(provider, STORES.rules, { rules, next_id: store.next_id || _nextId(rules) }, { action: 'delete', id: Number(id) });
    return { ok: true, rule: rules[index] };
  }

  function _presetMap() {
    return new Map(PRESET_POLICIES.map(policy => [policy.status_value, _clone(policy)]));
  }

  function _normalizePolicy(body, existing) {
    const now = _nowIso();
    const row = { ...(existing || {}) };
    row.status_value = String(body?.status_value ?? row.status_value ?? '').trim();
    if (!row.status_value) throw new Error('status_value は必須です');
    row.display_label = String(body?.display_label ?? row.display_label ?? row.status_value).trim() || row.status_value;
    row.display_color = /^#[0-9a-fA-F]{6}$/.test(String(body?.display_color ?? row.display_color ?? '')) ? String(body?.display_color ?? row.display_color) : '#94a3b8';
    BOOL_FIELDS.forEach(field => {
      if (Object.prototype.hasOwnProperty.call(body || {}, field)) row[field] = _asBool(body[field]) ? 1 : 0;
      else row[field] = _asBool(row[field]) ? 1 : 0;
    });
    row.taste_learning_weight = Number.isFinite(Number(body?.taste_learning_weight)) ? Number(body.taste_learning_weight) : Number(row.taste_learning_weight ?? 1);
    row.is_system = Object.prototype.hasOwnProperty.call(body || {}, 'is_system') ? (_asBool(body.is_system) ? 1 : 0) : (_asBool(row.is_system) ? 1 : 0);
    row.description = String(body?.description ?? row.description ?? '').slice(0, 200);
    row.sort_order = Number.isFinite(Number(body?.sort_order)) ? Number(body.sort_order) : Number(row.sort_order ?? 1000);
    row.created = row.created || now;
    row.updated = now;
    return row;
  }

  async function listStatusPolicies(provider) {
    const store = await _readStore(provider, STORES.policies);
    const merged = _presetMap();
    (Array.isArray(store.policies) ? store.policies : []).forEach(policy => {
      if (policy?.status_value) merged.set(policy.status_value, _normalizePolicy(policy, merged.get(policy.status_value)));
    });
    const policies = [...merged.values()].sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0) || a.status_value.localeCompare(b.status_value, 'ja'));
    policies.forEach(policy => { policy.usage = { entry_count: 0, knowledge_item_count: 0, reclassify_count: 0 }; });
    return { policies, undefined_statuses: {}, verification: store.verification };
  }

  async function saveStatusPolicy(provider, body = {}) {
    _requireOwner();
    const store = await _readStore(provider, STORES.policies);
    _assertWritable(store);
    const status = String(body.original_status_value || body.status_value || '').trim();
    const list = (await listStatusPolicies(provider)).policies.filter(policy => !policy.is_system || policy.status_value === status);
    const existing = list.find(policy => policy.status_value === status || policy.status_value === body.status_value) || null;
    const policy = _normalizePolicy(body, existing);
    const next = list.filter(row => row.status_value !== status && row.status_value !== policy.status_value);
    next.push(policy);
    await _writeStore(provider, STORES.policies, { policies: next }, { action: 'upsert', status_value: policy.status_value });
    return { ok: true, policy };
  }

  async function resetStatusPolicies(provider, body = {}) {
    _requireOwner();
    if (body.all) {
      await _writeStore(provider, STORES.policies, { policies: PRESET_POLICIES.map(_clone) }, { action: 'reset-all' });
      return { ok: true, policies: PRESET_POLICIES.map(_clone) };
    }
    const preset = _presetMap().get(String(body.status_value || ''));
    if (!preset) throw new Error('プリセットが見つかりません');
    return saveStatusPolicy(provider, preset);
  }

  async function deleteStatusPolicy(provider, statusValue) {
    _requireOwner();
    const store = await _readStore(provider, STORES.policies);
    _assertWritable(store);
    const preset = _presetMap().get(statusValue);
    if (preset?.is_system) throw new Error('システムポリシーは削除できません');
    const current = (await listStatusPolicies(provider)).policies;
    const next = current.filter(policy => policy.status_value !== statusValue);
    await _writeStore(provider, STORES.policies, { policies: next }, { action: 'delete', status_value: statusValue });
    return { ok: true };
  }

  async function importStatusPolicies(provider, body = {}) {
    _requireOwner();
    const mode = String(body.mode || 'merge');
    const incoming = Array.isArray(body.payload?.policies) ? body.payload.policies : [];
    if (!incoming.length) throw new Error('policies 配列が見つかりません');
    const current = mode === 'replace' ? PRESET_POLICIES.map(_clone) : (await listStatusPolicies(provider)).policies;
    const map = new Map(current.map(policy => [policy.status_value, policy]));
    incoming.forEach(policy => map.set(policy.status_value, _normalizePolicy(policy, map.get(policy.status_value))));
    const policies = [...map.values()];
    await _writeStore(provider, STORES.policies, { policies }, { action: 'import', mode, count: incoming.length });
    return { ok: true, count: incoming.length };
  }

  async function getTasteSettings(provider) {
    return _readStore(provider, STORES.tasteSettings);
  }

  async function updateTasteSettings(provider, body = {}) {
    _requireOwner();
    const store = await _readStore(provider, STORES.tasteSettings);
    _assertWritable(store);
    const settings = { ...(store.settings || {}), enabled: _asBool(body.enabled), owner_id: 'cloud', updated: _nowIso() };
    await _writeStore(provider, STORES.tasteSettings, { settings }, { action: 'settings' });
    return settings;
  }

  function _cleanTaste(body, existing) {
    const now = _nowIso();
    const row = { ...(existing || {}) };
    row.type = String(body?.type ?? row.type ?? 'principle').trim() || 'principle';
    row.scope = String(body?.scope ?? row.scope ?? 'other').trim() || 'other';
    row.rule = String(body?.rule ?? row.rule ?? '').trim();
    row.rationale = String(body?.rationale ?? row.rationale ?? '').trim();
    row.source_path = _normalizeFolderPath(body?.source_path ?? row.source_path ?? '');
    row.source_excerpt = String(body?.source_excerpt ?? row.source_excerpt ?? '').trim();
    row.user_pinned = Object.prototype.hasOwnProperty.call(body || {}, 'user_pinned') ? _asBool(body.user_pinned) : !!row.user_pinned;
    row.user_weight = Number.isFinite(Number(body?.user_weight)) ? Number(body.user_weight) : Number(row.user_weight ?? 1);
    row.learned_weight = Number.isFinite(Number(row.learned_weight)) ? Number(row.learned_weight) : 1;
    row.feedback_count = Number(row.feedback_count || 0);
    row.created = row.created || now;
    row.updated = now;
    return row;
  }

  async function listTastePrinciples(provider, query = {}) {
    const store = await _readStore(provider, STORES.taste);
    let items = Array.isArray(store.items) ? store.items.slice() : [];
    if (!_asBool(query.include_deleted)) items = items.filter(item => !item.deleted_at);
    if (query.type) items = items.filter(item => item.type === query.type);
    if (query.scope) items = items.filter(item => item.scope === query.scope);
    items = items.filter(item => _matches(item, query.q, ['rule', 'rationale', 'type', 'scope']));
    return { items: _sortByFreshness(items).slice(0, Math.max(1, Math.min(Number(query.limit || 200), 500))), count: items.length, verification: store.verification };
  }

  async function createTastePrinciple(provider, body = {}) {
    _requireOwner();
    const store = await _readStore(provider, STORES.taste);
    _assertWritable(store);
    const items = Array.isArray(store.items) ? store.items.slice() : [];
    const item = _cleanTaste(body, null);
    if (!item.rule) throw new Error('rule は必須です');
    item.id = _nextId(items);
    items.push(item);
    await _writeStore(provider, STORES.taste, { items, next_id: _nextId(items) }, { action: 'create', id: item.id });
    return { ok: true, item };
  }

  async function updateTastePrinciple(provider, id, patch = {}) {
    _requireOwner();
    const store = await _readStore(provider, STORES.taste);
    _assertWritable(store);
    const items = Array.isArray(store.items) ? store.items.slice() : [];
    const index = items.findIndex(item => Number(item.id) === Number(id));
    if (index < 0) throw new Error('感性原則が見つかりません');
    items[index] = { ..._cleanTaste(patch, items[index]), id: items[index].id };
    await _writeStore(provider, STORES.taste, { items, next_id: store.next_id || _nextId(items) }, { action: 'update', id: Number(id) });
    return { ok: true, item: items[index] };
  }

  async function deleteTastePrinciple(provider, id) {
    _requireOwner();
    const store = await _readStore(provider, STORES.taste);
    _assertWritable(store);
    const items = Array.isArray(store.items) ? store.items.slice() : [];
    const index = items.findIndex(item => Number(item.id) === Number(id));
    if (index < 0) throw new Error('感性原則が見つかりません');
    items[index] = { ...items[index], deleted_at: _nowIso(), updated: _nowIso() };
    await _writeStore(provider, STORES.taste, { items, next_id: store.next_id || _nextId(items) }, { action: 'delete', id: Number(id) });
    return { ok: true, item: items[index] };
  }

  async function extractTastePrinciples(provider, body = {}) {
    _requireOwner();
    const existing = await listTastePrinciples(provider, {});
    if (existing.items.length && !body.force) return { ok: true, principle_count: 0, skipped: true };
    const knowledge = await listKnowledgeItems(provider, { type: 'preference' });
    let count = 0;
    for (const item of knowledge.items.slice(0, 20)) {
      await createTastePrinciple(provider, { type: 'preference', scope: 'other', rule: item.statement, rationale: item.subject, source_path: item.source_file_path || item.source_chat_path || '' });
      count += 1;
    }
    return { ok: true, principle_count: count };
  }

  async function listTasteFeedback(provider, limit = 200) {
    const store = await _readStore(provider, STORES.tasteFeedback);
    const items = Array.isArray(store.items) ? store.items.slice(0, Math.max(1, Math.min(Number(limit || 200), 500))) : [];
    return { items, count: items.length, verification: store.verification };
  }

  async function listMemoryDirectives(provider, includeDeleted = false) {
    const store = await _readStore(provider, STORES.memory);
    let items = Array.isArray(store.items) ? store.items.slice() : [];
    if (!includeDeleted) items = items.filter(item => !item.deleted_at);
    return { items: _sortByFreshness(items), count: items.length, verification: store.verification };
  }

  async function saveMemoryDirective(provider, body = {}) {
    _requireOwner();
    const store = await _readStore(provider, STORES.memory);
    _assertWritable(store);
    const items = Array.isArray(store.items) ? store.items.slice() : [];
    const now = _nowIso();
    const item = {
      id: _nextId(items),
      statement: String(body.statement || body.text || '').trim(),
      scope: String(body.scope || 'project'),
      source_path: _normalizeFolderPath(body.source_path || ''),
      created: now,
      updated: now,
    };
    if (!item.statement) throw new Error('statement は必須です');
    items.push(item);
    await _writeStore(provider, STORES.memory, { items, next_id: _nextId(items) }, { action: 'create', id: item.id });
    return { ok: true, item };
  }

  async function _handler({ method, body, url, pathname }) {
    if (pathname === '/auth/me' && method === 'GET') return _authMe(url);
    const knowledgeSearchPath = pathname === '/knowledge_items/search';
    const knowledgePath = /^\/knowledge_items(?:\/(\d+))?$/.exec(pathname);
    const rulesPath = /^\/chat_rules(?:\/(\d+))?$/.exec(pathname);
    const tastePath = /^\/taste\/principles(?:\/(\d+))?$/.exec(pathname);
    const statusDelete = /^\/status_policies\/(.+)$/.exec(pathname);
    const memoryPath = pathname === MEMORY_DIRECTIVES_PATH;
    const supported = knowledgeSearchPath || knowledgePath || rulesPath || tastePath || memoryPath
      || pathname.startsWith('/knowledge/')
      || pathname.startsWith('/status_policies')
      || pathname.startsWith('/taste/');
    if (!supported) return NOT_HANDLED;
    const provider = await _requirePwaProvider(method === 'GET' ? 'read' : 'readwrite');

    if (knowledgeSearchPath && method === 'GET') return searchKnowledgeItems(provider, url.searchParams.get('q') || '', url.searchParams.get('limit') || 10);
    if (pathname === '/knowledge/summary' && method === 'GET') return knowledgeSummary(provider);
    if (knowledgePath && method === 'GET') return listKnowledgeItems(provider, {
      q: url.searchParams.get('q') || '',
      type: url.searchParams.get('type') || '',
      include_superseded: url.searchParams.get('include_superseded'),
      include_deleted: url.searchParams.get('include_deleted'),
    });
    if (pathname === '/knowledge_items' && method === 'POST') return createKnowledgeItem(provider, body || {});
    if (knowledgePath?.[1] && method === 'PUT') return updateKnowledgeItem(provider, Number(knowledgePath[1]), body || {});
    if (knowledgePath?.[1] && method === 'DELETE') return deleteKnowledgeItem(provider, Number(knowledgePath[1]));
    if (pathname === '/knowledge/extract' && method === 'POST') return extractKnowledge(provider, body || {});

    if (rulesPath && method === 'GET') return listChatRules(provider, url.searchParams.get('include_deleted') || false);
    if (pathname === '/chat_rules' && method === 'POST') return createChatRule(provider, body || {});
    if (rulesPath?.[1] && method === 'PUT') return updateChatRule(provider, Number(rulesPath[1]), body || {});
    if (rulesPath?.[1] && method === 'DELETE') return deleteChatRule(provider, Number(rulesPath[1]));

    if (pathname === '/status_policies' && method === 'GET') return listStatusPolicies(provider);
    if (pathname === '/status_policies' && method === 'POST') return saveStatusPolicy(provider, body || {});
    if (pathname === '/status_policies/reset' && method === 'POST') return resetStatusPolicies(provider, body || {});
    if (pathname === '/status_policies/import' && method === 'POST') return importStatusPolicies(provider, body || {});
    if (pathname === '/status_policies/export' && method === 'GET') {
      const payload = await listStatusPolicies(provider);
      return { policies: payload.policies, exported_at: _nowIso(), version: 1 };
    }
    if (/^\/status_policies\/usage\//.test(pathname) && method === 'GET') {
      const statusValue = decodeURIComponent(pathname.replace(/^\/status_policies\/usage\//, '').split('?')[0]);
      return countStatusUsage(provider, statusValue);
    }
    if (pathname === '/status_policies/resolve' && method === 'GET') {
      return resolveStatusPolicyForPath(provider, url);
    }
    if (statusDelete && method === 'DELETE') return deleteStatusPolicy(provider, decodeURIComponent(statusDelete[1].split('?')[0]));

    if (pathname === '/taste/settings' && method === 'GET') {
      const store = await getTasteSettings(provider);
      return store.settings || { enabled: false, owner_id: 'cloud' };
    }
    if (pathname === '/taste/settings' && method === 'PUT') return updateTasteSettings(provider, body || {});
    if (pathname === '/taste/principles/extract' && method === 'POST') return extractTastePrinciples(provider, body || {});
    if (tastePath && method === 'GET') return listTastePrinciples(provider, {
      q: url.searchParams.get('q') || '',
      type: url.searchParams.get('type') || '',
      scope: url.searchParams.get('scope') || '',
      include_deleted: url.searchParams.get('include_deleted'),
      limit: url.searchParams.get('limit') || 200,
    });
    if (pathname === '/taste/principles' && method === 'POST') return createTastePrinciple(provider, body || {});
    if (tastePath?.[1] && method === 'PUT') return updateTastePrinciple(provider, Number(tastePath[1]), body || {});
    if (tastePath?.[1] && method === 'DELETE') return deleteTastePrinciple(provider, Number(tastePath[1]));
    if (pathname === '/taste/feedback' && method === 'GET') return listTasteFeedback(provider, url.searchParams.get('limit') || 200);

    if (memoryPath && method === 'GET') return listMemoryDirectives(provider, url.searchParams.get('include_deleted') || false);
    if (memoryPath && method === 'POST') return saveMemoryDirective(provider, body || {});
    return NOT_HANDLED;
  }

  handlers.push(_handler);

  window.MeldexKnowledgeCloudStore = {
    role: _role,
    authMe: _authMe,
    listKnowledgeItems,
    searchKnowledgeItems,
    knowledgeSummary,
    createKnowledgeItem,
    updateKnowledgeItem,
    deleteKnowledgeItem,
    listChatRules,
    createChatRule,
    listStatusPolicies,
    listTastePrinciples,
    createTastePrinciple,
    getTasteSettings,
    listMemoryDirectives,
    saveMemoryDirective,
  };
})();
