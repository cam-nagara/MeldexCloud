/* gb-tool-calendar-production-api.js: production management option-panel API */
(function() {
  'use strict';

  async function request(path, options = {}) {
    const method = String(options.method || 'GET').toUpperCase();
    const body = options.body || {};
    const timeoutMs = Number(options.timeoutMs || (method === 'GET' ? 0 : 60000));
    if (method === 'GET') return apiFetch(path, timeoutMs ? { timeoutMs } : undefined);
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
    patchEntry: (payload) => request('/production-management/entries', { method: 'PATCH', body: payload }),
    createEntry: (payload) => request('/production-management/entries', { method: 'POST', body: payload }),
    previewTasks: (payload) => request('/production-management/tasks/preview', { method: 'POST', body: payload }),
    createTasks: (payload) => request('/production-management/tasks/create', { method: 'POST', body: payload, timeoutMs: 120000 }),
    previewTaskStructure: (payload) => request('/production-management/tasks/structure/preview', { method: 'POST', body: payload }),
    applyTaskStructure: (payload) => request('/production-management/tasks/structure/apply', { method: 'POST', body: payload, timeoutMs: 120000 }),
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
    // 一括作成の直後に続けて走らせるため、1000件規模でも既定60秒で切れないようにする。
    recalculatePreview: (payload) => request('/production-management/recalculate/preview', { method: 'POST', body: payload, timeoutMs: 120000 }),
    recalculateApply: (payload) => request('/production-management/recalculate/apply', { method: 'POST', body: payload, timeoutMs: 120000 }),
  };
})();
