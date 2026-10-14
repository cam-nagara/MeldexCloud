(function (global) {
  'use strict';

  const BASE = '/knowledge/service';

  function _portable() {
    const client = global.MeldexPortableKnowledge;
    return client?.isAvailable?.() ? client : null;
  }

  function isAvailable() {
    if (_portable()) return true;
    const runtime = global.MeldexRuntimeAdapter;
    if (!runtime) return typeof global.apiFetch === 'function';
    return !runtime.isBrowserDataMode?.();
  }

  async function _request(path, options = {}) {
    if (!isAvailable()) {
      const error = new Error('共有ナレッジサービスはこの保存方式では未設定です');
      error.code = 'knowledge_service_unavailable';
      throw error;
    }
    const route = BASE + String(path || '');
    if (typeof global.apiFetch === 'function') {
      return global.apiFetch(route, { silentError: true, ...options });
    }
    const apiBase = global.MeldexRuntimeAdapter?.getApiBasePath?.() || '/api';
    const response = await global.fetch(String(apiBase).replace(/\/+$/, '') + route, {
      credentials: 'same-origin',
      ...options,
      headers: {
        ...(options.body != null ? { 'Content-Type': 'application/json' } : {}),
        ...(options.headers || {}),
      },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload.detail || payload.error || `HTTP ${response.status}`);
      error.status = response.status;
      throw error;
    }
    return payload;
  }

  function _post(path, body) {
    return _request(path, { method: 'POST', body: JSON.stringify(body || {}) });
  }

  function batchUpsert(artifacts, options = {}) {
    if (_portable()) return _portable().batchUpsert(artifacts, options);
    return _post('/batch-upsert', {
      artifacts: Array.isArray(artifacts) ? artifacts : [],
      device_id: options.deviceId || options.device_id || '',
    });
  }

  function deleteArtifacts(documentIds, options = {}) {
    if (_portable()) return _portable().deleteArtifacts(documentIds, options);
    return _post('/delete', {
      document_ids: Array.isArray(documentIds) ? documentIds : [],
      device_id: options.deviceId || options.device_id || '',
    });
  }

  function retrieve(query, options = {}) {
    if (_portable()) return _portable().retrieve(query, options);
    return _post('/retrieve', {
      query: String(query || ''),
      limit: options.limit || 10,
      kinds: options.kinds || [],
      workspace_ids: options.workspaceIds || options.workspace_ids || [],
      include_structure: options.includeStructure !== false,
    });
  }

  function pull(documentIds, options = {}) {
    if (_portable()) return _portable().pull(documentIds, options);
    return _post('/artifacts/pull', {
      document_ids: Array.isArray(documentIds) ? documentIds : [],
      workspace_ids: options.workspaceIds || options.workspace_ids || [],
    });
  }

  function reconcile(expectedDocumentIds, options = {}) {
    if (_portable()) return _portable().reconcile(expectedDocumentIds, options);
    return _post('/reconcile', {
      expected_document_ids: Array.isArray(expectedDocumentIds) ? expectedDocumentIds : [],
      visibility: options.visibility || 'personal',
      workspace_id: options.workspaceId || options.workspace_id || '',
      root_ids: options.rootIds || options.root_ids || [],
      device_id: options.deviceId || options.device_id || '',
    });
  }

  function coverage(options = {}) {
    if (_portable()) return _portable().coverage(options);
    const params = new URLSearchParams();
    const workspaces = options.workspaceIds || options.workspace_ids || [];
    if (workspaces.length) params.set('workspace_ids', workspaces.join(','));
    return _request('/coverage' + (params.size ? `?${params}` : ''));
  }

  function changes(cursor = 0, options = {}) {
    if (_portable()) return _portable().changes(cursor, options);
    const params = new URLSearchParams({ since: String(Math.max(0, Number(cursor) || 0)) });
    const workspaces = options.workspaceIds || options.workspace_ids || [];
    if (workspaces.length) params.set('workspace_ids', workspaces.join(','));
    if (options.limit) params.set('limit', String(options.limit));
    return _request('/changes?' + params);
  }

  function getJob(jobId, options = {}) {
    if (_portable()) return _portable().getJob(jobId, options);
    const params = new URLSearchParams();
    const workspaces = options.workspaceIds || options.workspace_ids || [];
    if (workspaces.length) params.set('workspace_ids', workspaces.join(','));
    return _request('/jobs/' + encodeURIComponent(String(jobId || '')) + (params.size ? `?${params}` : ''));
  }

  function rebuild() {
    if (_portable()) return _portable().rebuild();
    return _post('/rebuild', {});
  }

  function _legacyHash(value) {
    let hash = 2166136261;
    const text = String(value || '');
    for (const character of text) {
      hash ^= character.codePointAt(0);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
  }

  function legacyItemToArtifact(item = {}) {
    const sourceFolder = String(item.source_folder || 'unknown').replace(/\\/g, '/').replace(/\/{2,}/g, '/').replace(/\/$/, '');
    const subject = String(item.subject || '未分類').trim();
    const statement = String(item.statement || '').trim();
    const reasoning = String(item.reasoning || '').trim();
    const text = [subject, statement, reasoning].filter(Boolean).join('\n');
    const workspaceId = String(item.workspace_id || '').trim();
    const shared = !!workspaceId && ['team', 'project', 'workspace'].includes(String(item.scope || '').toLowerCase());
    const visibility = shared ? (item.is_canonical ? 'admin-canonical' : 'workspace') : 'personal';
    const id = Math.max(0, Number(item.id) || 0);
    const revisionBasis = [
      id,
      String(item.source_folder || ''),
      String(item.updated || ''),
      String(item.source_status || ''),
      item.is_canonical ? '1' : '0',
      item.pinned ? '1' : '0',
      text,
    ].join('\0');
    return {
      document_id: '',
      revision: 'legacy-v1:' + _legacyHash(revisionBasis),
      source_path: `knowledge_items/${sourceFolder || 'unknown'}#${id}`,
      root_id: 'legacy-knowledge',
      kind: 'legacy-knowledge',
      visibility,
      owner_id: visibility === 'personal' ? String(item.owner_id || 'local') : '',
      workspace_id: visibility === 'personal' ? '' : workspaceId,
      extractor: 'meldex-legacy-knowledge',
      extractor_version: '1',
      text_chunks: text ? [{ id: 'chunk-0', order: 0, text }] : [],
      nodes: [],
      edges: [],
      images: [],
      source_refs: [
        { path: `knowledge_items/${sourceFolder || 'unknown'}#${id}`, kind: 'legacy-knowledge' },
        ...(item.source_chat_path ? [{ path: String(item.source_chat_path), kind: 'chat' }] : []),
      ],
      warnings: [],
      metadata: {
        title: subject,
        legacy_id: id,
        legacy_type: String(item.type || 'fact'),
        legacy_scope: String(item.scope || 'personal'),
        source_folder: String(item.source_folder || ''),
        source_status: String(item.source_status || ''),
        confidence: Number(item.confidence || 0),
        is_canonical: !!item.is_canonical,
        pinned: !!item.pinned,
        user_edited: !!item.user_edited,
        created: String(item.created || ''),
        updated: String(item.updated || ''),
        legacy_store_preserved: true,
      },
    };
  }

  async function migrateLegacyItems(items, options = {}) {
    const active = (Array.isArray(items) ? items : []).filter(item => item && !item.deleted && !item.superseded_by);
    const artifacts = active.map(legacyItemToArtifact);
    const totals = { items: active.length, upserted: 0, unchanged: 0, changed: 0, jobs: [] };
    for (let offset = 0; offset < artifacts.length; offset += 500) {
      const result = await batchUpsert(artifacts.slice(offset, offset + 500), options);
      totals.upserted += Number(result.upserted || 0);
      totals.unchanged += Number(result.unchanged || 0);
      totals.changed += Number(result.changed || 0);
      if (result.job_id) totals.jobs.push(result.job_id);
    }
    return totals;
  }

  global.MeldexUnifiedKnowledgeClient = Object.freeze({
    isAvailable,
    batchUpsert,
    deleteArtifacts,
    retrieve,
    pull,
    reconcile,
    coverage,
    changes,
    getJob,
    rebuild,
    legacyItemToArtifact,
    migrateLegacyItems,
  });
})(window);
