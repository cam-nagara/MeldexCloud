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

  window.MeldexProductionApi = {
    summary: () => request('/production-management/summary'),
    list: (sheet, params = {}) => request('/production-management/lists' + encodeQuery({ sheet, ...params })),
    taskSheets: () => request('/production-management/task-sheets'),
    taskCreateCatalog: () => request('/production-management/task-create-catalog'),
    createTaskSheet: (payload) => request('/production-management/task-sheets', { method: 'POST', body: payload }),
    queryTasks: (payload = {}) => request('/production-management/tasks/query', { method: 'POST', body: payload }),
    patchEntry: (payload) => request('/production-management/entries', { method: 'PATCH', body: payload }),
    createEntry: (payload) => request('/production-management/entries', { method: 'POST', body: payload }),
    previewTasks: (payload) => request('/production-management/tasks/preview', { method: 'POST', body: payload }),
    createTasks: (payload) => request('/production-management/tasks/create', { method: 'POST', body: payload, timeoutMs: 120000 }),
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
    recalculatePreview: (payload) => request('/production-management/recalculate/preview', { method: 'POST', body: payload }),
    recalculateApply: (payload) => request('/production-management/recalculate/apply', { method: 'POST', body: payload }),
    async recalculateEqual(payload = {}, options = {}) {
      const body = { mode: 'equal_until_deadline', staff_scope: 'current_user', ...payload };
      const preview = await request('/production-management/recalculate/preview', { method: 'POST', body });
      if (!options.apply || preview?.apply_allowed === false) return preview;
      return request('/production-management/recalculate/apply', { method: 'POST', body });
    },
  };
})();
