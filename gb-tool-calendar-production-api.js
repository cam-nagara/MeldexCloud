/* gb-tool-calendar-production-api.js: production management option-panel API */
(function() {
  'use strict';

  const READ_POST_ENDPOINTS = new Set([
    '/production-management/tasks/query',
    '/production-management/tasks/preview',
    '/production-management/tasks/structure/preview',
  ]);

  function isWriteRequest(path, method) {
    return method !== 'GET' && !(method === 'POST' && READ_POST_ENDPOINTS.has(path));
  }

  async function request(path, options = {}) {
    const method = String(options.method || 'GET').toUpperCase();
    const body = options.body || {};
    // 通常の読取・更新は共通apiFetchの契約へ委ねる。ここで更新を60秒へ
    // 短縮すると、共通層の120秒/長時間処理5分という分類を上書きしてしまう。
    const timeoutMs = Number(options.timeoutMs || 0);
    if (method === 'GET') return apiFetch(path, timeoutMs ? { timeoutMs } : undefined);
    if (isWriteRequest(path, method) && window.MeldexProductionUiAvailability?.ensureWritable?.() === false) {
      const error = new Error('閲覧専用モードのため編集できません'); error.status = 403; throw error;
    }
    return apiFetch(path, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      ...(timeoutMs ? { timeoutMs } : {}),
    });
  }

  function encodeQuery(params = {}) {
    const items = Object.entries(params).filter(([, value]) => value !== undefined && value !== null && value !== '');
    return items.length ? '?' + items.map(([key, value]) => encodeURIComponent(key) + '=' + encodeURIComponent(value)).join('&') : '';
  }

  // 制作管理UX改善計画（2026-08-04）§6-1: 「制作管理を始める」ボタン廃止に伴い、未
  // セットアップ状態を空状態カードとして扱うための軽量キャッシュ付き判定。/status は
  // _ensure_existing_or_template を呼ばない唯一の読み取りのため、これを先に呼べば
  // 未セットアップのワークスペースを自己修復（自動作成）させずに判定できる。
  const READY_CACHE_TTL_MS = 4000;
  let readyCache = null; // { value: boolean, ts: number }
  async function checkReady(options = {}) {
    const now = Date.now();
    if (!options.force && readyCache && (now - readyCache.ts) < READY_CACHE_TTL_MS) return readyCache.value;
    try {
      const result = await request('/production-management/status');
      const ready = !!result?.ready;
      readyCache = { value: ready, ts: now };
      return ready;
    } catch {
      // 状態を取得できない場合は既存の自己修復フローを妨げない（開始済み扱いにフォールバック）。
      readyCache = { value: true, ts: now };
      return true;
    }
  }
  function invalidateReady() { readyCache = null; }

  const entryHistoryRows = new Map();
  const SIMPLE_HISTORY_PROPERTIES = new Set(['備考', '優先度', '階層数', '階層ラベル']);
  let entryHistoryContext = '', entryHistoryGeneration = 0;
  function assigneeHistoryIsSafe(row) {
    const engine = window.MeldexProductionTaskActualEngine;
    if (typeof engine?.normalizeTaskStatus !== 'function') return false;
    const status = engine.normalizeTaskStatus(row?.properties?.['状況']);
    return typeof status === 'string' && [engine.CANONICAL_STATUS_NOT_STARTED, engine.CANONICAL_STATUS_PENDING,
      engine.CANONICAL_STATUS_REVIEW_WAITING, engine.CANONICAL_STATUS_DONE].includes(status);
  }
  function historyContext() {
    const workspace = window.MeldexRuntimeAdapter?.getWorkspaceState?.() || {};
    const key = JSON.stringify([typeof getUsername === 'function' ? getUsername() : '',
      typeof state !== 'undefined' ? state.vaultPath || '' : '',
      window.MeldexRuntimeAdapter?.getMode?.() || '',
      window.MeldexWorkspaces?.getActiveId?.() || workspace.workspaceId || workspace.workspace_id || '',
      workspace.accountId || workspace.account_id || '',
      workspace.securityScopeId || workspace.security_scope_id || '',
      workspace.path || workspace.folder || '', workspace.access || workspace.role || '']);
    if (key !== entryHistoryContext) { entryHistoryContext = key; entryHistoryGeneration++; entryHistoryRows.clear(); }
    return entryHistoryGeneration;
  }

  async function patchEntryWithHistory(payload, previous, history = {}) {
    const generation = historyContext();
    const result = await request('/production-management/entries', { method: 'PATCH', body: payload });
    if (generation !== historyContext() || !result?.row) return result;
    const key = String(result.row.path || payload.path || '');
    entryHistoryRows.set(key, result.row);
    const names = Object.keys(payload.properties || {});
    // 作業中の状況・担当変更は実績区間に影響する。閉じた区間を変更しない状態の
    // 担当変更だけ、版を照合する逆PATCHで計画の改訂を追加して戻す。
    const assigneeChange = names.includes('担当者');
    const safeAssignee = assigneeChange && assigneeHistoryIsSafe(previous) && assigneeHistoryIsSafe(result.row);
    if (!names.length || !names.every(name => SIMPLE_HISTORY_PROPERTIES.has(name) || name === '担当者' && safeAssignee)
        || !previous || result.unchanged || typeof historyPush !== 'function') return result;
    const before = Object.fromEntries(names.map(name => [name, previous.properties?.[name] ?? '']));
    const after = Object.fromEntries(names.map(name => [name, result.row.properties?.[name] ?? '']));
    const restore = async properties => {
      if (historyContext() !== generation) {
        const error = new Error('制作管理の対象が切り替わったため、この履歴は使えません');
        error.code = 'production_history_context_changed'; throw error;
      }
      const current = entryHistoryRows.get(key);
      if (assigneeChange && !assigneeHistoryIsSafe(current)) {
        const error = new Error('現在作業中のため、この担当変更を取り消せません。現在の担当を確認して変更してください');
        error.code = 'production_assignee_history_active'; throw error;
      }
      const restored = await request('/production-management/entries', { method: 'PATCH', body: {
        ...payload, properties, entry_revision: current.entry_revision,
        transport_revision: current.transport_revision, expectedModified: current.modified || '',
      } });
      entryHistoryRows.set(key, restored.row);
      try { await history.onRestore?.(restored.row); }
      catch (error) { history.onRefreshError?.(error); console.warn('[Production] 履歴の保存後に表示を更新できませんでした', error); }
    };
    historyPush(history.label || '制作管理を編集', () => restore(before), () => restore(after), history.scope || '');
    return result;
  }

  window.MeldexProductionApi = {
    summary: () => request('/production-management/summary'),
    status: () => request('/production-management/status'),
    checkReady,
    invalidateReady,
    list: (sheet, params = {}) => request('/production-management/lists' + encodeQuery({ sheet, ...params })),
    taskSheets: () => request('/production-management/task-sheets'),
    taskCreateCatalog: () => request('/production-management/task-create-catalog'),
    createTaskSheet: (payload) => request('/production-management/task-sheets', { method: 'POST', body: payload }),
    queryTasks: (payload = {}) => request('/production-management/tasks/query', { method: 'POST', body: payload }),
    patchEntryWithHistory,
    contextGeneration: historyContext,
    patchEntry: (payload) => request('/production-management/entries', { method: 'PATCH', body: payload }),
    createEntry: (payload) => request('/production-management/entries', { method: 'POST', body: payload }),
    previewTasks: (payload) => request('/production-management/tasks/preview', { method: 'POST', body: payload }),
    createTasks: (payload) => request('/production-management/tasks/create', { method: 'POST', body: payload, timeoutMs: 300000 }),
    previewTaskStructure: (payload) => request('/production-management/tasks/structure/preview', { method: 'POST', body: payload }),
    applyTaskStructure: (payload) => request('/production-management/tasks/structure/apply', { method: 'POST', body: payload, timeoutMs: 300000 }),
    taskByEvent: (eventId) => request('/production-management/task-by-event' + encodeQuery({ event_id: eventId })),
    templates: (params = {}) => request('/production-management/lists' + encodeQuery({ sheet: 'タスクテンプレート', limit: 500, ...params })),
    createTemplate: (payload) => request('/production-management/entries', {
      method: 'POST',
      body: { ...payload, sheet: 'タスクテンプレート' },
    }),
    patchTemplate: (payload) => request('/production-management/entries', {
      method: 'PATCH',
      body: { ...payload, sheet: 'タスクテンプレート' },
    }),
    fromTemplate: (payload) => request('/production-management/tasks/from-template', { method: 'POST', body: payload }),
    // 一括作成の直後に続けて走らせるため、1000件規模でも短い更新上限で切らない。
    recalculatePreview: (payload) => request('/production-management/recalculate/preview', { method: 'POST', body: payload, timeoutMs: 300000 }),
    recalculateApply: (payload) => request('/production-management/recalculate/apply', { method: 'POST', body: payload, timeoutMs: 300000 }),
  };
})();
