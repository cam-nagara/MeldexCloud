/* gb-tool-calendar-production-api.js: production management option-panel API */
(function() {
  'use strict';

  async function request(path, options = {}) {
    const method = String(options.method || 'GET').toUpperCase();
    const body = options.body || {};
    if (method === 'GET') return apiFetch(path);
    return apiFetch(path, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  function query(params = {}) {
    const items = Object.entries(params).filter(([, value]) => value !== undefined && value !== null && value !== '');
    return items.length ? '?' + items.map(([key, value]) => encodeURIComponent(key) + '=' + encodeURIComponent(value)).join('&') : '';
  }

  window.MeldexProductionApi = {
    summary: () => request('/production-management/summary'),
    list: (sheet, params = {}) => request('/production-management/lists' + query({ sheet, ...params })),
    patchEntry: (payload) => request('/production-management/entries', { method: 'PATCH', body: payload }),
    createEntry: (payload) => request('/production-management/entries', { method: 'POST', body: payload }),
    createTasks: (payload) => request('/production-management/tasks/create', { method: 'POST', body: payload }),
    taskByEvent: (eventId) => request('/production-management/task-by-event' + query({ event_id: eventId })),
  };
})();
