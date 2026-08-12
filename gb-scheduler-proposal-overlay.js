/* gb-scheduler-proposal-overlay.js: read-only proposal projection for calendar/task views. */
(function () {
  'use strict';

  let activeProposal = null;
  let installed = false;
  let refreshQueued = false;

  function clone(value) {
    return value == null ? value : structuredClone(value);
  }

  function normalizePath(value) {
    return String(value || '').trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '').toLowerCase();
  }

  function logicalTaskId(event) {
    const direct = String(event?.task_id || event?.taskId || '').trim();
    if (direct) return direct;
    const raw = String(event?.id || event?.external_id || '');
    if (!raw.startsWith('production-task:')) return '';
    return raw.slice('production-task:'.length).split(':part:')[0];
  }

  function placementSegments(placement) {
    const values = Array.isArray(placement?.segments) && placement.segments.length
      ? placement.segments : [{ start: placement?.start, end: placement?.end }];
    return values.map(item => ({ start: String(item?.start || ''), end: String(item?.end || '') }))
      .filter(item => item.start && item.end);
  }

  function placementIndex(proposal) {
    const byId = new Map();
    const byPath = new Map();
    (proposal?.placements || []).forEach(placement => {
      const id = String(placement?.task_id || '').trim();
      const path = normalizePath(placement?.task_path);
      if (id) byId.set(id, placement);
      if (path) byPath.set(path, placement);
    });
    return { byId, byPath };
  }

  function placementFor(index, value) {
    const id = String(value?.task_id || value?.taskId || value?._id || value?.entry_id || '').trim();
    const path = normalizePath(value?.task_path || value?.path || value?.entry_path);
    return (id && index.byId.get(id)) || (path && index.byPath.get(path)) || null;
  }

  function eventId(taskId, segmentIndex) {
    const base = `production-task:${taskId}`;
    return segmentIndex ? `${base}:part:${segmentIndex + 1}` : base;
  }

  function projectCalendarEvents(events, proposal) {
    const source = Array.isArray(events) ? events : [];
    if (!proposal?.id) return { events: source, warnings: [], matchedIds: [] };
    const index = placementIndex(proposal);
    const templates = new Map();
    const matched = new Set();
    source.forEach(event => {
      if (String(event?.calendar_source || '') !== 'production-task') return;
      const id = logicalTaskId(event);
      const placement = placementFor(index, { task_id: id, task_path: event?.task_path });
      if (!placement) return;
      matched.add(placement);
      if (!templates.has(placement)) templates.set(placement, event);
    });
    const untouched = source.filter(event => {
      if (String(event?.calendar_source || '') !== 'production-task') return true;
      return !placementFor(index, { task_id: logicalTaskId(event), task_path: event?.task_path });
    });
    const projected = [];
    const warnings = [];
    (proposal.placements || []).forEach(placement => {
      const taskId = String(placement?.task_id || '').trim();
      const segments = placementSegments(placement);
      if (!taskId) {
        warnings.push({ code: 'missing-stable-id', taskPath: placement?.task_path || '', message: 'stable task id がないため案を表示できないタスクがあります' });
        return;
      }
      if (!['scheduled', 'locked'].includes(String(placement?.status || '')) || !segments.length) {
        warnings.push({ code: 'unplaced', taskId, taskPath: placement?.task_path || '', message: placement?.reason || '案で未配置のタスクがあります' });
        return;
      }
      const template = templates.get(placement) || {};
      segments.forEach((segment, segmentIndex) => {
        const id = eventId(taskId, segmentIndex);
        projected.push({
          ...clone(template), id, external_id: id, calendar_source: 'production-task',
          task_id: taskId, task_path: placement.task_path || template.task_path || '',
          title: placement.task_name || template.title || taskId,
          start: segment.start, end: segment.end, all_day: false,
          user: placement.user || '', users: placement.user ? [placement.user] : [],
          color: placement.color || template.color || '',
          _schedulerProposal: true, _schedulerProposalId: proposal.id,
        });
      });
    });
    (proposal.placements || []).forEach(placement => {
      if (!matched.has(placement) && String(placement?.task_id || '').trim()) {
        warnings.push({ code: 'confirmed-event-missing', taskId: placement.task_id, message: '確定版に対応する予定がないため案から補完表示しました' });
      }
    });
    return { events: untouched.concat(projected), warnings, matchedIds: [...matched].map(item => item.task_id) };
  }

  function projectTaskRows(rows, proposal) {
    const source = Array.isArray(rows) ? rows : [];
    if (!proposal?.id) return { rows: source, warnings: [], matchedIds: [] };
    const index = placementIndex(proposal);
    const matched = new Set();
    const projected = source.map(row => {
      const placement = placementFor(index, row);
      if (!placement) return row;
      matched.add(placement);
      const next = clone(row);
      next.properties = { ...(next.properties || {}) };
      next.properties['担当者'] = placement.user || '';
      next.properties['作業予定日時'] = placement.after_range || (placement.start && placement.end ? `${placement.start}|${placement.end}` : '');
      next._schedulerProposal = true;
      next._schedulerProposalId = proposal.id;
      next._schedulerPlacementStatus = placement.status || '';
      return next;
    });
    const warnings = (proposal.placements || []).filter(item => !matched.has(item)).map(item => ({
      code: 'task-row-missing', taskId: item.task_id || '', taskPath: item.task_path || '',
      message: 'タスクリストに対応行がない案のタスクがあります',
    }));
    return { rows: projected, warnings, matchedIds: [...matched].map(item => item.task_id) };
  }

  function clearTaskTable(container) {
    if (!container) return;
    container.classList.remove('gb-scheduler-proposal-overlay-active');
    container.querySelectorAll('[data-scheduler-proposal-value]').forEach(cell => {
      delete cell.dataset.schedulerProposalValue;
      delete cell.dataset.schedulerProposalField;
      cell.removeAttribute('aria-readonly');
      if (cell.dataset.schedulerOriginalTitle === '__none__') cell.removeAttribute('title');
      else if (Object.prototype.hasOwnProperty.call(cell.dataset, 'schedulerOriginalTitle')) cell.title = cell.dataset.schedulerOriginalTitle;
      delete cell.dataset.schedulerOriginalTitle;
    });
    container.querySelectorAll('.gb-scheduler-proposal-row').forEach(row => row.classList.remove('gb-scheduler-proposal-row'));
  }

  function applyTaskTable(container, proposal) {
    clearTaskTable(container);
    if (!container || !proposal?.id) return { matched: 0, warnings: [] };
    const index = placementIndex(proposal);
    const matched = new Set();
    container.querySelectorAll('tr[data-meldex-entity-path], tr[data-row-path]').forEach(row => {
      const placement = placementFor(index, { path: row.dataset.meldexEntityPath || row.dataset.rowPath });
      if (!placement) return;
      matched.add(placement);
      row.classList.add('gb-scheduler-proposal-row');
      const values = {
        '担当者': placement.user || '未割り当て',
        '作業予定日時': placement.after_range || (placement.start && placement.end ? `${placement.start}|${placement.end}` : '未配置'),
      };
      Object.entries(values).forEach(([field, value]) => {
        const cell = row.querySelector(`td[data-prop-name="${field}"]`);
        if (!cell) return;
        if (!Object.prototype.hasOwnProperty.call(cell.dataset, 'schedulerOriginalTitle')) {
          cell.dataset.schedulerOriginalTitle = cell.hasAttribute('title') ? cell.title : '__none__';
        }
        cell.dataset.schedulerProposalField = field;
        cell.dataset.schedulerProposalValue = value;
        cell.setAttribute('aria-readonly', 'true');
        cell.title = `${proposal.name || '案'}の値（読み取り専用）`;
      });
    });
    container.classList.add('gb-scheduler-proposal-overlay-active');
    const warnings = (proposal.placements || []).filter(item => !matched.has(item)).map(item => ({
      code: 'task-row-missing', taskId: item.task_id || '', taskPath: item.task_path || '',
      message: '表示中のタスクリストに対応行がない案のタスクがあります',
    }));
    return { matched: matched.size, warnings };
  }

  function decorateCalendar(component, proposal, projected) {
    const root = component?.el;
    if (!root) return;
    root.querySelectorAll('.gb-scheduler-proposal-event').forEach(node => node.classList.remove('gb-scheduler-proposal-event'));
    if (proposal?.id) {
      root.querySelectorAll('[data-event-id]').forEach(node => {
        const event = projected.find(item => item._schedulerProposal && String(item.id) === String(node.dataset.eventId));
        if (!event) return;
        node.classList.add('gb-scheduler-proposal-event');
        node.draggable = false;
        node.dataset.schedulerProposalId = proposal.id;
        node.title = `${event.title || 'タスク'} — ${proposal.name || '案'}（読み取り専用）`;
      });
    }
    let badge = root.querySelector('[data-e2e-id="scheduler-proposal-overlay-banner"]');
    if (!proposal?.id) { badge?.remove(); return; }
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'gb-scheduler-overlay-banner';
      badge.dataset.e2eId = 'scheduler-proposal-overlay-banner';
      root.querySelector('.gb-toolbar-cal')?.appendChild(badge);
    }
    if (badge) {
      const warningCount = (proposal.placements || []).filter(item => (
        !String(item?.task_id || '').trim() || !['scheduled', 'locked'].includes(String(item?.status || ''))
      )).length;
      badge.textContent = `${proposal.name || '案'}を表示中（読み取り専用）${warningCount ? `・未配置/警告${warningCount}件` : ''}`;
    }
  }

  function refreshComponent(component) {
    if (!component) return;
    if (component._surface === 'calendar' && typeof component._render === 'function') {
      component._render();
    } else if (component._surface === 'productionTasks') {
      const state = component._productionTaskState;
      state?.allView?.applySchedulerProposal?.(activeProposal);
      state?.embed?.applySchedulerProposal?.(activeProposal);
      decorateCalendar(component, activeProposal, []);
    }
  }

  function refreshAll() {
    refreshQueued = false;
    if (typeof forEachComponent === 'function') forEachComponent(refreshComponent);
  }

  function scheduleRefresh() {
    if (refreshQueued) return;
    refreshQueued = true;
    queueMicrotask(refreshAll);
  }

  function setActive(proposal) {
    activeProposal = proposal?.id ? proposal : null;
    scheduleRefresh();
    return activeProposal;
  }

  function blockProposalWrites(event) {
    const target = event.target;
    if (target?.closest?.('.gb-scheduler-proposal-event')
      || target?.closest?.('.gb-scheduler-proposal-overlay-active td[data-prop-name]')) {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.type === 'click' && typeof showStatus === 'function') showStatus('案の表示中は編集できません。採用すると確定版へ反映されます');
    }
  }

  function install() {
    if (installed) return;
    installed = true;
    const originalRender = window.CalendarComponent?.prototype?._render;
    if (typeof originalRender === 'function') {
      window.CalendarComponent.prototype._render = function (...args) {
        if (!activeProposal?.id || this._surface !== 'calendar' || this._view === 'shifts') {
          const plainResult = originalRender.apply(this, args);
          if (this._surface === 'calendar') decorateCalendar(this, activeProposal, []);
          return plainResult;
        }
        const baseEvents = this._events;
        const scrollLeft = this._contentEl?.scrollLeft || 0;
        const scrollTop = this._contentEl?.scrollTop || 0;
        const result = projectCalendarEvents(baseEvents, activeProposal);
        this._events = result.events;
        try { return originalRender.apply(this, args); }
        finally {
          this._events = baseEvents;
          decorateCalendar(this, activeProposal, result.events);
          if (this._contentEl) { this._contentEl.scrollLeft = scrollLeft; this._contentEl.scrollTop = scrollTop; }
        }
      };
    }
    document.addEventListener('meldex:scheduler-proposal-selected', event => setActive(event.detail?.proposal || null));
    document.addEventListener('meldex:scheduler-proposals-changed', event => setActive(event.detail?.proposal || null));
    ['click', 'dblclick', 'contextmenu', 'dragstart'].forEach(type => document.addEventListener(type, blockProposalWrites, true));
  }

  window.MeldexSchedulerProposalOverlay = Object.freeze({
    install, setActive, active: () => activeProposal,
    projectCalendarEvents, projectTaskRows, applyTaskTable, normalizePath, logicalTaskId,
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();
})();
