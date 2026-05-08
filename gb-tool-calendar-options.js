/* ==============================
   gb-tool-calendar-options.js: Calendar panel option UI and selection helpers
   ============================== */

(() => {
  if (typeof CalendarComponent === 'undefined') return;

  const EVENT_EDGE_MINUTES = 15;
  const DEFAULT_EVENT_COLOR = '#569cd6';
  const CALENDAR_SETTINGS_SCOPE = 'calendar:settings';

  function _calEsc(v) {
    return typeof esc === 'function' ? esc(v) : String(v ?? '').replace(/[&<>"']/g, ch => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[ch]);
  }

  function _calIcon(name, size = 14) {
    return typeof lucide === 'function' ? lucide(name, size) : '';
  }

  function _calCssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(value);
    return String(value || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }

  function _calLocalInputValue(component, value, fallbackDate) {
    if (value) return String(value).substring(0, 16);
    const d = fallbackDate || new Date();
    return component._localDateTimeStr(d).substring(0, 16);
  }

  function _calOptionContainer(title) {
    const detailEl = typeof _resolveDetailEl === 'function' ? _resolveDetailEl() : document.getElementById('rp-detail');
    if (!detailEl) return null;
    detailEl.style.display = '';
    if (typeof _ensureDetailTabShell === 'function') _ensureDetailTabShell(detailEl);

    const tabBody = detailEl.querySelector?.('#detail-tab-calendar-today') || null;
    if (tabBody) {
      if (typeof showNoteTabs === 'function') showNoteTabs(false);
      if (typeof showDbTabs === 'function') showDbTabs(false);
      if (typeof showBoardTabs === 'function') showBoardTabs(false);
      if (typeof hideBoardNoteTab === 'function') hideBoardNoteTab();
      if (typeof hideScriptnoteDetailTabs === 'function') hideScriptnoteDetailTabs();
      if (typeof showCalendarDetailTabs === 'function') showCalendarDetailTabs(true);
      if (typeof showFileStyleTab === 'function') showFileStyleTab(true);
      if (typeof renderFileStyleTab === 'function') renderFileStyleTab('calendar');
      if (typeof showPublishDetailTab === 'function') showPublishDetailTab(true);
      document.querySelectorAll('.detail-tab-calendar').forEach(t => { t.textContent = 'カレンダー'; });
      if (typeof switchDetailTab === 'function') switchDetailTab('calendar-today');
      tabBody.innerHTML = '';
      const header = document.createElement('div');
      header.className = 'cal-option-header';
      header.textContent = title;
      tabBody.appendChild(header);
      const body = document.createElement('div');
      body.className = 'cal-option-body';
      tabBody.appendChild(body);
      return body;
    }

    detailEl.innerHTML = '';
    if (typeof _buildDpHeader === 'function') {
      const cfg = typeof _getDetailPanelCfg === 'function' ? _getDetailPanelCfg() : {};
      detailEl.appendChild(_buildDpHeader(title, cfg.position || 'right'));
    } else {
      const header = document.createElement('div');
      header.className = 'cal-option-header';
      header.textContent = title;
      detailEl.appendChild(header);
    }
    const body = document.createElement('div');
    body.className = 'cal-option-body';
    detailEl.appendChild(body);
    return body;
  }

  function _calField(label, html) {
    return `<div class="cal-option-field"><label>${label}</label>${html}</div>`;
  }

  function _calBindSwatch(swatch, color) {
    if (!swatch) return;
    const fallback = color || DEFAULT_EVENT_COLOR;
    if (typeof setColorSwatchValue === 'function') setColorSwatchValue(swatch, fallback);
    else swatch.dataset.color = fallback;
    if (typeof bindColorSwatch === 'function') {
      bindColorSwatch(swatch, () => _calGetSwatchValue(swatch, fallback), (nextColor) => {
        if (typeof setColorSwatchValue === 'function') setColorSwatchValue(swatch, nextColor || fallback);
        else swatch.dataset.color = nextColor || fallback;
      });
    }
  }

  function _calGetSwatchValue(swatch, fallback) {
    if (typeof getColorSwatchValue === 'function') return getColorSwatchValue(swatch, fallback);
    return swatch?.dataset?.color || fallback || '';
  }

  function _calSettingsHistoryKeys(keys) {
    const list = Array.isArray(keys) ? keys : [keys];
    return [...new Set(list.filter(Boolean))];
  }

  function _calCaptureSettingsHistory(keys) {
    if (typeof captureLocalStorageSettings !== 'function') return null;
    if (typeof isLocalStorageSettingsHistorySuppressed === 'function'
      && isLocalStorageSettingsHistorySuppressed()) return null;
    return captureLocalStorageSettings(_calSettingsHistoryKeys(keys));
  }

  function _calRefreshSettingsAfterHistory(keys) {
    const changed = new Set(_calSettingsHistoryKeys(keys));
    if (typeof forEachComponent !== 'function') return;
    forEachComponent(component => {
      if (!component || !(component instanceof CalendarComponent)) return;
      if (changed.has('gb-cal-start-day')) {
        component._startDay = parseInt(localStorage.getItem('gb-cal-start-day') || '0', 10) || 0;
      }
      if (changed.has('gb:cal-sidebar-mode') || changed.has('gb:cal-sidebar-only')) {
        component._sidebarMode = localStorage.getItem('gb:cal-sidebar-mode') || (localStorage.getItem('gb:cal-sidebar-only') === 'true' ? 'only' : 'all');
        component._sidebarOnly = component._sidebarMode === 'only';
      }
      component._applySidebarMode?.();
      component._renderMiniCal?.();
      component._render?.();
    });
  }

  function _calPushSettingsHistory(label, beforeSnapshot, keys, detail) {
    if (!beforeSnapshot || typeof historyPush !== 'function'
      || typeof captureLocalStorageSettings !== 'function'
      || typeof restoreLocalStorageSettings !== 'function'
      || typeof _normalizeLocalStorageSettingsSnapshots !== 'function') return false;
    const keyList = _calSettingsHistoryKeys(keys);
    const snapshots = _normalizeLocalStorageSettingsSnapshots(beforeSnapshot, captureLocalStorageSettings(keyList));
    let beforeKey = '';
    let afterKey = '';
    try {
      beforeKey = JSON.stringify(snapshots.before);
      afterKey = JSON.stringify(snapshots.after);
    } catch {}
    if (beforeKey && beforeKey === afterKey) return false;
    historyPush(
      label || 'カレンダー: 設定変更',
      () => restoreLocalStorageSettings(snapshots.before, _calRefreshSettingsAfterHistory),
      () => restoreLocalStorageSettings(snapshots.after, _calRefreshSettingsAfterHistory),
      CALENDAR_SETTINGS_SCOPE,
      detail || keyList.join(', ')
    );
    return true;
  }

  function _calUserListFromValue(value) {
    let raw = value;
    if (!raw) return [];
    if (typeof raw === 'string') {
      try { raw = JSON.parse(raw); } catch { raw = raw.split(','); }
    }
    if (!Array.isArray(raw)) raw = [raw];
    const seen = new Set();
    return raw.map(item => String(item || '').trim()).filter(name => {
      if (!name || seen.has(name)) return false;
      seen.add(name);
      return true;
    });
  }

  function _calEventCreator(ev, fallback) {
    return String(ev?.creator || ev?.user || fallback || '').trim();
  }

  function _calEventUserNames(ev, fallback) {
    const seen = new Set();
    return [_calEventCreator(ev, fallback), ..._calUserListFromValue(ev?.members)].filter(name => {
      if (!name || seen.has(name)) return false;
      seen.add(name);
      return true;
    });
  }

  function _calAvatarHtml(name, size) {
    const safeName = _calEsc(name);
    const src = window.MeldexDataAccess?.team?.avatarUrl?.(name || 'anonymous', {}) || ('/api/team/avatar/' + encodeURIComponent(name) + '?t=0');
    const style = `width:${size}px;height:${size}px;`;
    const fallback = _calEsc((name || '?').charAt(0).toUpperCase() || '?');
    return `<span class="gb-cal-event-avatar" style="${style}" title="${safeName}"><img src="${src}" alt="" onerror="this.style.display='none';this.nextElementSibling.style.display='inline-flex';"><span>${fallback}</span></span>`;
  }

  CalendarComponent.prototype._eventUserNames = function(ev) {
    return _calEventUserNames(ev, this._getUser());
  };

  CalendarComponent.prototype._eventUserAvatarsHtml = function(ev, size = 14) {
    const names = this._eventUserNames(ev).slice(0, 4);
    if (!names.length) return '';
    return `<span class="gb-cal-event-avatars">${names.map(name => _calAvatarHtml(name, size)).join('')}</span>`;
  };

  CalendarComponent.prototype._loadCalendarUserChoices = async function() {
    const current = this._getUser();
    const users = new Map();
    const add = name => { name = String(name || '').trim(); if (name && !users.has(name)) users.set(name, { name }); };
    add(current);
    if (typeof this._loadTeamGroups === 'function') {
      try {
        const groups = await this._loadTeamGroups();
        groups.forEach(group => (group.members || []).forEach(member => add(member.name)));
        return [...users.values()];
      } catch {}
    }
    let roots = [];
    try { roots = await apiFetch('/outliner-roots'); } catch {}
    const visibleRoots = (roots || []).filter(root => root?.visible && root?.path);
    const sources = visibleRoots.length ? visibleRoots.map(root => root.path) : [''];
    for (const folder of sources) {
      try {
        const members = await apiFetch('/team' + (folder ? '?folder=' + encodeURIComponent(folder) : ''));
        (members || []).forEach(member => add(member.name));
      } catch {}
    }
    return [...users.values()];
  };

  CalendarComponent.prototype._populateEventUserControls = async function(body, ev) {
    const creatorSelect = body.querySelector('[data-cal-event-creator]');
    const membersBox = body.querySelector('[data-cal-event-members]');
    if (!creatorSelect && !membersBox) return;
    const creator = _calEventCreator(ev, this._getUser());
    const selectedMembers = new Set(_calUserListFromValue(ev?.members));
    const users = await this._loadCalendarUserChoices();
    [creator, ...selectedMembers].forEach(name => {
      if (name && !users.some(user => user.name === name)) users.push({ name });
    });
    if (!body.isConnected) return;
    if (creatorSelect) {
      creatorSelect.innerHTML = users.map(user => `<option value="${_calEsc(user.name)}" ${user.name === creator ? 'selected' : ''}>${_calEsc(user.name)}</option>`).join('');
    }
    if (membersBox) {
      membersBox.innerHTML = users.map(user => `<label class="cal-option-member"><input type="checkbox" data-cal-event-member="${_calEsc(user.name)}" data-e2e-id="cal-event-member-${_calEsc(user.name)}" value="${_calEsc(user.name)}" aria-label="${_calEsc(user.name)}" ${selectedMembers.has(user.name) ? 'checked' : ''}> <span>${_calEsc(user.name)}</span></label>`).join('');
    }
  };

  CalendarComponent.prototype._collectEventMemberValues = function(body, creator) {
    const seen = new Set();
    const inputs = [...body.querySelectorAll('[data-cal-event-member]')];
    const source = inputs.length ? inputs.filter(input => input.checked).map(input => input.value) : _calUserListFromValue(body.dataset.calEventMembers || '[]');
    return source.map(input => String(input || '').trim()).filter(name => {
      if (!name || name === creator || seen.has(name)) return false;
      seen.add(name);
      return true;
    });
  };

  CalendarComponent.prototype._isCalVisible = function(ev) {
    if (this._calendars.length === 0 || !ev?.calendar_id) return true;
    if (this._visibleCalIds.has(ev.calendar_id)) return true;
    const calendarKnown = this._calendars.some(cal => cal.id === ev.calendar_id);
    return !calendarKnown && this._eventUserNames(ev).includes(this._getUser());
  };

  CalendarComponent.prototype._firstCalendar = function() {
    return (this._calendars || []).find(c => this._visibleCalIds?.has(c.id)) || (this._calendars || [])[0] || null;
  };

  CalendarComponent.prototype._eventColorDefault = function() {
    return this._firstCalendar()?.color || DEFAULT_EVENT_COLOR;
  };

  CalendarComponent.prototype._eventSelection = function() {
    if (!this._selectedEventIds) this._selectedEventIds = new Set();
    return this._selectedEventIds;
  };

  CalendarComponent.prototype._renderedEventIds = function() {
    const ids = [];
    this._contentEl?.querySelectorAll?.('[data-event-id]').forEach(card => {
      const id = card.dataset.eventId || '';
      if (id && !ids.includes(id)) ids.push(id);
    });
    return ids;
  };

  CalendarComponent.prototype._setSelectedEvents = function(ids, lastId) {
    const sel = this._eventSelection();
    sel.clear();
    (ids || []).filter(Boolean).forEach(id => sel.add(id));
    this._lastSelectedEventId = lastId || ids?.[ids.length - 1] || '';
    this._syncEventSelectionDom();
  };

  CalendarComponent.prototype._toggleEventSelection = function(id) {
    const sel = this._eventSelection();
    if (sel.has(id)) sel.delete(id);
    else sel.add(id);
    this._lastSelectedEventId = id;
    this._syncEventSelectionDom();
  };

  CalendarComponent.prototype._selectEventRange = function(id) {
    const order = this._renderedEventIds();
    const anchor = this._lastSelectedEventId || id;
    const a = order.indexOf(anchor), b = order.indexOf(id);
    if (a < 0 || b < 0) {
      this._setSelectedEvents([id], id);
      return;
    }
    const [from, to] = a < b ? [a, b] : [b, a];
    this._setSelectedEvents(order.slice(from, to + 1), id);
  };

  CalendarComponent.prototype._syncEventSelectionDom = function() {
    const sel = this._eventSelection();
    this._contentEl?.classList?.toggle?.('gb-cal-has-event-selection', sel.size > 0);
    this._contentEl?.querySelectorAll?.('[data-event-id]').forEach(card => {
      const id = card.dataset.eventId || '';
      card.classList.toggle('gb-cal-event-selected', sel.has(id));
      let check = card.querySelector(':scope > .gb-cal-event-select-check');
      if (!check) {
        check = document.createElement('input');
        check.type = 'checkbox';
        check.className = 'gb-cal-event-select-check';
        check.setAttribute('aria-label', '選択');
        card.insertBefore(check, card.firstChild);
      }
      check.checked = sel.has(id);
    });
  };

  CalendarComponent.prototype._bindCalendarSelection = function() {
    if (!this._contentEl || this._calendarSelectionBound) return;
    this._calendarSelectionBound = true;
    this._contentEl.addEventListener('click', (event) => {
      const check = event.target.closest?.('.gb-cal-event-select-check');
      if (check) {
        const card = check.closest('[data-event-id]');
        if (!card) return;
        event.stopPropagation();
        this._toggleEventSelection(card.dataset.eventId || '');
        return;
      }
      const card = event.target.closest?.('[data-event-id]');
      if (!card) return;
      const id = card.dataset.eventId || '';
      if (!id) return;
      if (event.shiftKey) {
        event.preventDefault();
        event.stopImmediatePropagation();
        this._selectEventRange(id);
      } else if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        event.stopImmediatePropagation();
        this._toggleEventSelection(id);
      } else {
        this._setSelectedEvents([id], id);
      }
    }, true);
  };

  const _origCreate = CalendarComponent.prototype.create;
  CalendarComponent.prototype.create = function() {
    const el = _origCreate.call(this);
    this._bindCalendarSelection();
    this._bindResponsiveSidebarMode();
    if (typeof applyCalendarPanelStyle === 'function') applyCalendarPanelStyle();
    this._applySidebarMode();
    return el;
  };

  const _origDestroy = CalendarComponent.prototype.destroy;
  CalendarComponent.prototype.destroy = function() {
    if (this._calResponsiveObserver) this._calResponsiveObserver.disconnect();
    this._calResponsiveObserver = null;
    if (this._calResponsiveResizeHandler) window.removeEventListener('resize', this._calResponsiveResizeHandler);
    this._calResponsiveResizeHandler = null;
    _origDestroy.call(this);
  };

  const _origActivate = CalendarComponent.prototype.activate;
  CalendarComponent.prototype.activate = function() {
    _origActivate.call(this);
    if (typeof historySetScope === 'function') historySetScope(CALENDAR_SETTINGS_SCOPE);
  };

  const _origRender = CalendarComponent.prototype._render;
  CalendarComponent.prototype._render = function() {
    _origRender.call(this);
    this._syncEventSelectionDom();
    this._syncCalendarToolbarState();
  };

  CalendarComponent.prototype._syncCalendarToolbarState = function() {
    const sideBtn = this.el?.querySelector?.('[data-cal-action="toggleSidebar"]');
    if (sideBtn) {
      const mode = this._effectiveSidebarOnly() ? 'only' : (this._sidebarEl?.classList.contains('gb-cal-hidden') ? 'hidden' : 'all');
      sideBtn.classList.toggle('active', mode !== 'all');
      sideBtn.dataset.calSidebarMode = mode;
      sideBtn.title = mode === 'all'
        ? 'サイドバーを隠す'
        : mode === 'hidden'
          ? 'サイドバーのみ'
          : 'すべて表示';
    }
    const viewSel = this.el?.querySelector?.('.gb-cal-view-select');
    if (viewSel && viewSel.value !== this._view) viewSel.value = this._view;
  };

  CalendarComponent.prototype._effectiveSidebarOnly = function() {
    return !!(this._sidebarMode === 'only' || this._sidebarOnly || this._autoSidebarOnly);
  };

  CalendarComponent.prototype._bindResponsiveSidebarMode = function() {
    if (!this.el || this._calResponsiveObserver || this._calResponsiveResizeHandler) return;
    const update = () => this._applyResponsiveSidebarMode();
    if (window.ResizeObserver) {
      this._calResponsiveObserver = new ResizeObserver(update);
      this._calResponsiveObserver.observe(this.el);
    } else {
      this._calResponsiveResizeHandler = update;
      window.addEventListener('resize', update);
    }
    update();
  };

  CalendarComponent.prototype._applyResponsiveSidebarMode = function() {
    if (!this.el) return;
    const width = this.el.getBoundingClientRect?.().width || this.el.offsetWidth || 0;
    this._autoSidebarOnly = width > 0 && width < 520;
    if (this._autoSidebarOnly) this._sidebarEl?.classList.remove('gb-cal-hidden');
    this._applySidebarMode();
  };

  CalendarComponent.prototype._applySidebarMode = function() {
    if (!this.el) return;
    const mode = this._sidebarMode || (this._sidebarOnly ? 'only' : 'all');
    const effective = this._effectiveSidebarOnly();
    if (!effective) this._sidebarEl?.classList.toggle('gb-cal-hidden', mode === 'hidden');
    else this._sidebarEl?.classList.remove('gb-cal-hidden');
    this.el.classList.toggle('gb-cal-sidebar-only', effective);
    this.el.classList.toggle('gb-cal-sidebar-auto', !!this._autoSidebarOnly);
    const resize = this.el.querySelector('.gb-cal-sidebar-resize');
    if (resize) resize.style.display = (effective || this._sidebarEl?.classList.contains('gb-cal-hidden')) ? 'none' : '';
    this._syncCalendarToolbarState();
  };

  CalendarComponent.prototype._setSidebarMode = function(mode) {
    const normalized = ['all', 'hidden', 'only'].includes(mode) ? mode : 'all';
    const before = _calCaptureSettingsHistory(['gb:cal-sidebar-mode', 'gb:cal-sidebar-only']);
    this._sidebarMode = normalized;
    this._sidebarOnly = normalized === 'only';
    localStorage.setItem('gb:cal-sidebar-mode', normalized);
    localStorage.setItem('gb:cal-sidebar-only', this._sidebarOnly ? 'true' : 'false');
    const detail = normalized === 'hidden' ? 'サイドバーを隠す' : normalized === 'only' ? 'サイドバーのみ' : 'すべて表示';
    _calPushSettingsHistory('カレンダー: サイドバー表示変更', before, ['gb:cal-sidebar-mode', 'gb:cal-sidebar-only'], detail);
    this._applySidebarMode();
  };

  CalendarComponent.prototype._setSidebarOnly = function(on) {
    this._setSidebarMode(on ? 'only' : 'all');
  };

  CalendarComponent.prototype._toggleSidebar = function() {
    const mode = this._effectiveSidebarOnly() ? 'only' : (this._sidebarEl?.classList.contains('gb-cal-hidden') ? 'hidden' : 'all');
    this._setSidebarMode(mode === 'all' ? 'hidden' : mode === 'hidden' ? 'only' : 'all');
  };

  CalendarComponent.prototype._showCalendarSettingsPanel = function() {
    const body = _calOptionContainer('カレンダー設定');
    if (!body) return;
    const opts = [[0, '日曜始まり'], [1, '月曜始まり'], [2, '火曜始まり'], [3, '水曜始まり'], [4, '木曜始まり'], [5, '金曜始まり'], [6, '土曜始まり']]
      .map(([v, label]) => `<option value="${v}" ${v === this._startDay ? 'selected' : ''}>${label}</option>`).join('');
    body.innerHTML = `
      ${_calField('表示', `<label class="cal-option-check"><input type="checkbox" data-cal-settings-sidebar-only ${this._sidebarOnly ? 'checked' : ''}> サイドバーのみ表示</label>`)}
      ${_calField('週の開始曜日', `<select class="gb-select" data-cal-settings-start-day>${opts}</select>`)}
      <div class="cal-option-actions">
        <button type="button" data-cal-settings-action="template">${_calIcon('layoutTemplate')} テンプレート</button>
        <button type="button" data-cal-settings-action="sync">${_calIcon('refreshCw')} 同期</button>
        <button type="button" data-cal-settings-action="timer">${_calIcon('timer')} タイマー</button>
      </div>`;
    body.querySelector('[data-cal-settings-sidebar-only]')?.addEventListener('change', e => this._setSidebarOnly(e.currentTarget.checked));
    body.querySelector('[data-cal-settings-start-day]')?.addEventListener('change', e => {
      const before = _calCaptureSettingsHistory(['gb-cal-start-day']);
      this._startDay = parseInt(e.currentTarget.value, 10);
      localStorage.setItem('gb-cal-start-day', this._startDay);
      _calPushSettingsHistory('カレンダー: 週の開始曜日変更', before, ['gb-cal-start-day'], String(this._startDay));
      this._render();
      this._renderMiniCal();
    });
    body.querySelectorAll('[data-cal-settings-action]').forEach(btn => {
      btn.addEventListener('click', () => {
        const action = btn.dataset.calSettingsAction;
        if (action === 'template') this._showScheduleTemplateModal();
        else if (action === 'sync') this._showSyncModal();
        else if (action === 'timer') {
          if (typeof openTimerPanel === 'function') openTimerPanel();
          else if (typeof showStatus === 'function') showStatus('タイマーパネルを初期化できませんでした', true);
        }
      });
    });
  };

  CalendarComponent.prototype._createEventQuick = async function(defaultStart, defaultEnd, defaultAllDay) {
    const now = new Date();
    const fallbackStart = defaultStart ? new Date(defaultStart) : now;
    const fallbackEndBase = Number.isNaN(fallbackStart.getTime()) ? now : fallbackStart;
    const start = defaultStart || this._localDateTimeStr(now);
    const end = defaultEnd || this._localDateTimeStr(new Date(fallbackEndBase.getTime() + 3600000));
    const calendarId = this._calendarIdForNewEvent?.() || '';
    const cal = (this._calendars || []).find(c => c.id === calendarId) || this._selectedCalendar?.() || this._firstCalendar();
    const payload = {
      title: '無題',
      start,
      end,
      all_day: defaultAllDay ? 1 : 0,
      color: cal?.color || DEFAULT_EVENT_COLOR,
      calendar_id: cal?.id || '',
      alert_minutes: -1,
      user: this._getUser(),
      creator: this._getUser(),
      members: [],
    };
    const tempId = 'tmp-cal-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
    const optimisticEvent = { id: tempId, ...payload, _optimistic: true };
    this._pushUndo('イベント作成');
    this._events = [...(this._events || []), optimisticEvent];
    this._setSelectedEvents([tempId], tempId);
    this._render();
    try {
      const res = await apiPost('/cal/events', payload);
      const id = res?.id || '';
      if (id) {
        const idx = (this._events || []).findIndex(e => e.id === tempId);
        if (idx >= 0) this._events[idx] = { ...optimisticEvent, id, _optimistic: false };
        this._setSelectedEvents([id], id);
      }
      await this._loadEvents();
      this._render();
      if (id) {
        const created = this._events.find(e => e.id === id) || { id, ...payload };
        this._setSelectedEvents([id], id);
        this._showEventOptionsPanel(created, defaultStart, defaultEnd, defaultAllDay);
      }
      this._showStatus('イベントを追加しました');
      return id;
    } catch {
      this._events = (this._events || []).filter(e => e.id !== tempId);
      this._render();
      this._showStatus('イベント追加に失敗', true);
      return '';
    }
  };

  CalendarComponent.prototype._openEventInPanel = function(editId, defaultStart, defaultEnd, defaultAllDay) {
    if (!editId) {
      this._createEventQuick(defaultStart, defaultEnd, defaultAllDay);
      return;
    }
    const ev = this._events.find(e => e.id === editId);
    if (!ev) return;
    this._setSelectedEvents([editId], editId);
    this._showEventOptionsPanel(ev, defaultStart, defaultEnd, defaultAllDay);
  };

  CalendarComponent.prototype._showEventOptionsPanel = function(ev, defaultStart, defaultEnd, defaultAllDay) {
    const body = _calOptionContainer('イベント設定');
    if (!body) return;
    body._calComponent = this;
    const now = new Date();
    const startVal = _calLocalInputValue(this, ev?.start || defaultStart, now);
    const endVal = _calLocalInputValue(this, ev?.end || defaultEnd, new Date(now.getTime() + 3600000));
    const isAllDay = ev ? !!ev.all_day : !!defaultAllDay;
    const calOpts = (this._calendars || []).map(c => `<option value="${_calEsc(c.id)}" ${ev?.calendar_id === c.id ? 'selected' : ''}>${_calEsc(c.name)}</option>`).join('');
    const creator = _calEventCreator(ev, this._getUser());
    body.dataset.calEventMembers = JSON.stringify(_calUserListFromValue(ev?.members));
    body.innerHTML = `
      ${_calField('タイトル', `<input data-cal-event-title type="text" value="${_calEsc(ev?.title || '')}" placeholder="イベント名">`)}
      ${_calField('', `<label class="cal-option-check"><input data-cal-event-allday type="checkbox" ${isAllDay ? 'checked' : ''}> 終日</label>`)}
      ${_calField('開始', `<input data-cal-event-start type="datetime-local" value="${startVal}" ${isAllDay ? 'disabled' : ''}>`)}
      ${_calField('終了', `<input data-cal-event-end type="datetime-local" value="${endVal}" ${isAllDay ? 'disabled' : ''}>`)}
      ${calOpts ? _calField('カレンダー', `<select data-cal-event-calendar class="gb-select">${calOpts}</select>`) : ''}
      ${_calField('作成者', `<select data-cal-event-creator class="gb-select"><option value="${_calEsc(creator)}">${_calEsc(creator || 'anonymous')}</option></select>`)}
      ${_calField('メンバー', `<div data-cal-event-members class="cal-option-members"><span style="color:var(--fg2);font-size:12px;">読み込み中...</span></div>`)}
      ${_calField('色', `<button type="button" data-cal-event-color class="gb-color-swatch gb-color-swatch--field" data-color="${_calEsc(ev?.color || this._eventColorDefault())}" title="イベント色"></button>`)}
      ${_calField('場所', `<input data-cal-event-location type="text" value="${_calEsc(ev?.location || '')}">`)}
      ${_calField('URL', `<input data-cal-event-url type="url" value="${_calEsc(ev?.url || '')}" placeholder="https://...">`)}
      ${_calField('アラーム', `<select data-cal-event-alert class="gb-select">
        <option value="-1" ${(ev?.alert_minutes ?? -1) === -1 ? 'selected' : ''}>なし</option>
        <option value="0" ${ev?.alert_minutes === 0 ? 'selected' : ''}>イベント時</option>
        <option value="5" ${ev?.alert_minutes === 5 ? 'selected' : ''}>5分前</option>
        <option value="15" ${ev?.alert_minutes === 15 ? 'selected' : ''}>15分前</option>
        <option value="30" ${ev?.alert_minutes === 30 ? 'selected' : ''}>30分前</option>
        <option value="60" ${ev?.alert_minutes === 60 ? 'selected' : ''}>1時間前</option>
      </select>`)}
      ${_calField('説明', `<textarea data-cal-event-desc rows="3">${_calEsc(ev?.description || '')}</textarea>`)}
      <div class="cal-option-actions cal-option-actions--footer">
        <button type="button" class="danger" data-cal-event-delete>削除</button>
        <span></span>
        ${ev?.id ? '<button type="button" data-cal-event-comment-list>コメント一覧</button><button type="button" data-cal-event-comment>コメントを追加</button>' : ''}
        <button type="button" class="primary" data-cal-event-save>保存</button>
      </div>`;
    const allDay = body.querySelector('[data-cal-event-allday]');
    const startInput = body.querySelector('[data-cal-event-start]');
    const endInput = body.querySelector('[data-cal-event-end]');
    allDay?.addEventListener('change', () => {
      startInput.disabled = endInput.disabled = allDay.checked;
    });
    _calBindSwatch(body.querySelector('[data-cal-event-color]'), ev?.color || this._eventColorDefault());
    this._populateEventUserControls(body, ev);
    body.querySelector('[data-cal-event-save]')?.addEventListener('click', () => this._saveEventOptions(ev.id, body));
    body.querySelector('[data-cal-event-delete]')?.addEventListener('click', () => this._deleteEventFromOptions(ev.id));
    body.querySelector('[data-cal-event-comment]')?.addEventListener('click', (event) => {
      if (typeof addCommentHere !== 'function' || !ev?.id) return;
      const calendarId = ev.calendar_id || body.querySelector('[data-cal-event-calendar]')?.value || '_calendar';
      const snapshot = (body.querySelector('[data-cal-event-title]')?.value || ev.title || '').trim().slice(0, 120);
      addCommentHere({
        targetKind: 'calendar_event',
        filePath: calendarId,
        targetRef: { file: calendarId, eventId: ev.id },
        snapshot,
      }, { anchorEl: event.currentTarget });
    });
    body.querySelector('[data-cal-event-comment-list]')?.addEventListener('click', () => {
      const calendarId = ev?.calendar_id || body.querySelector('[data-cal-event-calendar]')?.value || '_calendar';
      if (typeof CommentBadges !== 'undefined' && typeof CommentBadges.openPanelForFileComments === 'function') {
        CommentBadges.openPanelForFileComments(calendarId);
      }
    });
    setTimeout(() => body.querySelector('[data-cal-event-title]')?.focus(), 0);
  };

  CalendarComponent.prototype._saveEventOptions = async function(editId, body) {
    this._pushUndo('イベント編集');
    const creator = body.querySelector('[data-cal-event-creator]')?.value || this._getUser();
    const data = {
      title: body.querySelector('[data-cal-event-title]')?.value || '無題',
      start: body.querySelector('[data-cal-event-start]')?.value || '',
      end: body.querySelector('[data-cal-event-end]')?.value || '',
      all_day: body.querySelector('[data-cal-event-allday]')?.checked ? 1 : 0,
      color: _calGetSwatchValue(body.querySelector('[data-cal-event-color]'), ''),
      location: body.querySelector('[data-cal-event-location]')?.value || '',
      url: body.querySelector('[data-cal-event-url]')?.value || '',
      description: body.querySelector('[data-cal-event-desc]')?.value || '',
      alert_minutes: parseInt(body.querySelector('[data-cal-event-alert]')?.value || '-1', 10),
      calendar_id: body.querySelector('[data-cal-event-calendar]')?.value || '',
      user: this._getUser(),
      creator,
      members: this._collectEventMemberValues(body, creator),
    };
    try {
      await apiPut('/cal/events/' + editId, data);
      await this._loadEvents();
      this._render();
      this._showStatus('イベントを保存しました');
    } catch {
      this._showStatus('保存に失敗', true);
    }
  };

  CalendarComponent.prototype._deleteEventFromOptions = async function(id) {
    if (typeof cfConfirm === 'function' && !await cfConfirm('このイベントを削除しますか？')) return;
    this._pushUndo('イベント削除');
    const evRef = (this._events || []).find(x => x.id === id);
    try {
      await apiFetch('/cal/events/' + id, { method: 'DELETE' });
      apiPost('/annotations/orphan-by-target', {
        target_kind: 'calendar_event',
        target_file: evRef?.calendar_id || '_calendar',
        item_id: id,
        cascade_container: true,
      }).catch(() => {});
      await this._loadEvents();
      this._eventSelection().delete(id);
      this._render();
      const body = _calOptionContainer('カレンダー');
      if (body) body.innerHTML = '<div class="cal-option-empty">イベントを削除しました</div>';
      this._showStatus('削除しました');
    } catch {
      this._showStatus('削除に失敗', true);
    }
  };

  CalendarComponent.prototype._createTaskQuick = async function(options) {
    const opts = options || {};
    this._pushUndo('タスク作成');
    try {
      const res = await apiPost('/cal/tasks', {
        title: '無題',
        status: opts.status || 'todo',
        priority: opts.priority || 'medium',
        due_date: opts.due_date || '',
        user: this._getUser(),
      });
      await this._loadTasks();
      this._render();
      this._renderTodayTasks();
      const id = res?.id || '';
      if (id) this._showTaskModal(id);
      this._showStatus('タスクを追加しました');
      return id;
    } catch {
      this._showStatus('タスク追加に失敗', true);
      return '';
    }
  };

  CalendarComponent.prototype._showTaskModal = function(editId, defaultStatus) {
    if (!editId) {
      this._createTaskQuick({ status: defaultStatus || 'todo' });
      return;
    }
    const task = this._tasks.find(t => t.id === editId);
    if (!task) return;
    this._showTaskOptionsPanel(task);
  };

  CalendarComponent.prototype._showTaskOptionsPanel = function(task) {
    const body = _calOptionContainer('タスク設定');
    if (!body) return;
    body._calComponent = this;
    const statuses = [['backlog','バックログ'],['todo','未着手'],['in_progress','進行中'],['review','レビュー'],['done','完了']];
    const priorities = [['low','低'],['medium','中'],['high','高'],['urgent','緊急']];
    body.innerHTML = `
      ${_calField('タイトル', `<input data-cal-task-title type="text" value="${_calEsc(task.title || '')}" placeholder="タスク名">`)}
      ${_calField('ステータス', `<select data-cal-task-status class="gb-select">${statuses.map(([v,l]) => `<option value="${v}" ${(task.status || 'todo') === v ? 'selected' : ''}>${l}</option>`).join('')}</select>`)}
      ${_calField('優先度', `<select data-cal-task-priority class="gb-select">${priorities.map(([v,l]) => `<option value="${v}" ${(task.priority || 'medium') === v ? 'selected' : ''}>${l}</option>`).join('')}</select>`)}
      ${_calField('期限', `<input data-cal-task-due type="date" value="${_calEsc(task.due_date || '')}">`)}
      ${_calField('担当者', `<input data-cal-task-assignee type="text" value="${_calEsc(task.assignee || '')}">`)}
      <div class="cal-option-grid">
        ${_calField('見積(h)', `<input data-cal-task-est type="number" step="0.5" value="${_calEsc(task.estimated_hours || 0)}">`)}
        ${_calField('実績(h)', `<input data-cal-task-act type="number" step="0.5" value="${_calEsc(task.actual_hours || 0)}">`)}
      </div>
      ${_calField('説明', `<textarea data-cal-task-desc rows="3">${_calEsc(task.description || '')}</textarea>`)}
      <div class="cal-option-actions cal-option-actions--footer">
        <button type="button" class="danger" data-cal-task-delete>削除</button>
        <span></span>
        <button type="button" class="primary" data-cal-task-save>保存</button>
      </div>`;
    body.querySelector('[data-cal-task-save]')?.addEventListener('click', () => this._saveTaskOptions(task.id, body));
    body.querySelector('[data-cal-task-delete]')?.addEventListener('click', () => this._deleteTaskFromOptions(task.id));
    setTimeout(() => body.querySelector('[data-cal-task-title]')?.focus(), 0);
  };

  CalendarComponent.prototype._saveTaskOptions = async function(editId, body) {
    this._pushUndo('タスク編集');
    const data = {
      title: body.querySelector('[data-cal-task-title]')?.value || '無題',
      status: body.querySelector('[data-cal-task-status]')?.value || 'todo',
      priority: body.querySelector('[data-cal-task-priority]')?.value || 'medium',
      due_date: body.querySelector('[data-cal-task-due]')?.value || '',
      assignee: body.querySelector('[data-cal-task-assignee]')?.value || '',
      estimated_hours: parseFloat(body.querySelector('[data-cal-task-est]')?.value || '0') || 0,
      actual_hours: parseFloat(body.querySelector('[data-cal-task-act]')?.value || '0') || 0,
      description: body.querySelector('[data-cal-task-desc]')?.value || '',
      user: this._getUser(),
    };
    try {
      await apiPut('/cal/tasks/' + editId, data);
      await this._loadTasks();
      this._render();
      this._renderTodayTasks();
      this._showStatus('タスクを保存しました');
    } catch {
      this._showStatus('保存に失敗', true);
    }
  };

  CalendarComponent.prototype._deleteTaskFromOptions = async function(id) {
    if (typeof cfConfirm === 'function' && !await cfConfirm('このタスクを削除しますか？')) return;
    if (await this._deleteTask(id)) {
      const body = _calOptionContainer('カレンダー');
      if (body) body.innerHTML = '<div class="cal-option-empty">タスクを削除しました</div>';
    }
  };

  CalendarComponent.prototype._calendarHourPx = function(card) {
    const cell = card?.closest?.('.gb-cal-week-cell') || this._contentEl?.querySelector?.('.gb-cal-week-cell');
    const measured = cell?.getBoundingClientRect?.().height || 0;
    return measured > 0 ? measured : 40;
  };

  CalendarComponent.prototype._resizeGroupForEvent = function(eventId) {
    const sel = this._eventSelection();
    if (!sel.has(eventId)) this._setSelectedEvents([eventId], eventId);
    const rendered = new Set(this._renderedEventIds());
    const ids = [...this._eventSelection()].filter(id =>
      (!rendered.size || rendered.has(id)) && (this._events || []).some(ev => ev.id === id)
    );
    if (!ids.includes(eventId)) ids.push(eventId);
    return ids;
  };

  CalendarComponent.prototype._handleResize = function(event, card, ev, evStart, startH, direction) {
    event.stopPropagation();
    event.preventDefault();
    const groupIds = this._resizeGroupForEvent(ev.id);
    const hourPx = this._calendarHourPx(card);
    const snapPx = hourPx / 4;
    const minMs = EVENT_EDGE_MINUTES * 60000;
    const items = groupIds.map(id => {
      const source = this._events.find(item => item.id === id);
      if (!source) return null;
      const sourceStart = new Date(source.start || evStart);
      const sourceEnd = source.end ? new Date(source.end) : new Date(sourceStart.getTime() + 3600000);
      const visibleCards = [...(this._contentEl?.querySelectorAll?.(`[data-event-id="${_calCssEscape(id)}"]`) || [])];
      return {
        ev: source,
        start: sourceStart,
        end: sourceEnd,
        cards: visibleCards.map(el => ({
          el,
          top: parseFloat(el.style.top) || 0,
          height: el.offsetHeight || parseFloat(el.style.height) || Math.max(20, hourPx),
        })),
      };
    }).filter(Boolean);
    if (!items.length) return;

    const startY = event.clientY;
    const clampDelta = (deltaMs) => {
      let next = deltaMs;
      items.forEach(item => {
        const duration = item.end.getTime() - item.start.getTime();
        if (direction === 'top') next = Math.min(next, duration - minMs);
        else next = Math.max(next, minMs - duration);
      });
      return next;
    };
    const deltaToPx = deltaMs => (deltaMs / minMs) * snapPx;
    const pxToDelta = px => Math.round(px / snapPx) * minMs;
    let activeDeltaMs = 0;

    document.body.style.userSelect = 'none';
    card.style.touchAction = 'none';
    const onMove = (moveEvent) => {
      const rawPx = moveEvent.clientY - startY;
      activeDeltaMs = clampDelta(pxToDelta(rawPx));
      const activePx = deltaToPx(activeDeltaMs);
      items.forEach(item => {
        item.cards.forEach(entry => {
          if (direction === 'bottom') {
            entry.el.style.height = Math.max(snapPx, entry.height + activePx) + 'px';
          } else {
            entry.el.style.top = (entry.top + activePx) + 'px';
            entry.el.style.height = Math.max(snapPx, entry.height - activePx) + 'px';
          }
        });
      });
    };
    const onUp = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.body.style.userSelect = '';
      card.style.touchAction = '';
      if (!activeDeltaMs) {
        this._render();
        return;
      }
      this._pushUndo('イベントリサイズ');
      const updates = items.map(item => {
        if (direction === 'bottom') {
          const nextEnd = new Date(item.end.getTime() + activeDeltaMs);
          return apiPut('/cal/events/' + item.ev.id, { end: this._localDateTimeStr(nextEnd) });
        }
        const nextStart = new Date(item.start.getTime() + activeDeltaMs);
        return apiPut('/cal/events/' + item.ev.id, { start: this._localDateTimeStr(nextStart) });
      });
      Promise.all(updates).then(() => this._loadEvents()).then(() => this._render()).catch(() => {
        this._showStatus('イベントリサイズに失敗', true);
        this._render();
      });
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  };

  window._showCalEventInDetailPanel = function(ev, calendars, defaultStart, defaultEnd, defaultAllDay, ownerComponent) {
    if (ownerComponent && typeof ownerComponent._showEventOptionsPanel === 'function') {
      if (ev?.id) ownerComponent._showEventOptionsPanel(ev, defaultStart, defaultEnd, defaultAllDay);
      else ownerComponent._createEventQuick(defaultStart, defaultEnd, defaultAllDay);
    }
  };
  try { _showCalEventInDetailPanel = window._showCalEventInDetailPanel; } catch (_) {}
})();
