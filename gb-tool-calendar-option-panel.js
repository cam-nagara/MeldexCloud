/* ==============================
   gb-tool-calendar-option-panel.js: Detail shell, settings history, and user helpers
   ============================== */

(() => {
  if (typeof CalendarComponent === 'undefined' || !window.MeldexCalendarOptions) return;
  const {
    DEFAULT_EVENT_COLOR,
    CALENDAR_SETTINGS_SCOPE,
    CALENDAR_DETAIL_TABS,
    _calEsc,
    _calIcon,
  } = window.MeldexCalendarOptions;

  function _calFindCalendarComponent() {
    if (typeof GBTabs !== 'undefined' && typeof getComponentInstance === 'function') {
      const paneId = typeof GBLayout !== 'undefined' ? GBLayout.activePane : null;
      const activeTab = typeof GBTabs.getActiveTab === 'function' ? GBTabs.getActiveTab(paneId) : null;
      if (activeTab?.type === 'calendar') {
        const active = getComponentInstance(activeTab.id);
        if (active instanceof CalendarComponent) return active;
      }
    }
    let fallback = null;
    if (typeof forEachComponent === 'function') {
      forEachComponent((instance) => {
        if (!fallback && instance instanceof CalendarComponent) fallback = instance;
      });
    }
    return fallback;
  }

  function _calDetailTabId(tabId) {
    return CALENDAR_DETAIL_TABS.has(tabId) ? tabId : 'calendar-today';
  }

  function _calPrepareCalendarDetailShell(detailEl) {
    if (!detailEl) return;
    if (typeof showNoteTabs === 'function') showNoteTabs(false);
    if (typeof showFileInfoTab === 'function') showFileInfoTab(true);
    const calendarPath = _calFindCalendarComponent()?.state?.calendarPath || '';
    if (calendarPath && typeof renderFileInfoDetailTab === 'function') {
      void renderFileInfoDetailTab(calendarPath, null, { type: 'calendar', typeLabel: 'カレンダー' });
    }
    if (typeof showDbTabs === 'function') showDbTabs(false);
    if (typeof showBoardTabs === 'function') showBoardTabs(false);
    if (typeof hideBoardNoteTab === 'function') hideBoardNoteTab();
    if (typeof hideScriptnoteDetailTabs === 'function') hideScriptnoteDetailTabs();
    if (typeof showCalendarDetailTabs === 'function') showCalendarDetailTabs(true);
    if (typeof showFileStyleTab === 'function') showFileStyleTab(true);
    if (typeof renderFileStyleTab === 'function') renderFileStyleTab('calendar');
    if (typeof showPublishDetailTab === 'function') showPublishDetailTab(true);
    document.querySelectorAll('.detail-tab-calendar[data-detail-tab="calendar-today"]').forEach(t => { t.textContent = 'カレンダー'; });
  }

  function _calSelectDetailTab(tabId) {
    if (typeof switchDetailTab !== 'function') return;
    try { window.__MeldexSuppressCalendarTabAutoRender = true; } catch {}
    try { switchDetailTab(_calDetailTabId(tabId)); }
    finally {
      try { window.__MeldexSuppressCalendarTabAutoRender = false; } catch {}
    }
  }

  function _calBuildOptionBody(tabBody, title) {
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

  function _calOpenDetailPanel() {
    if (typeof _openDetailRightPanel === 'function') {
      return _openDetailRightPanel();
    }
    if (typeof openRightPanelTab === 'function') {
      openRightPanelTab('detail');
      return true;
    }
    if (typeof switchRightTab === 'function') {
      switchRightTab('detail');
      return true;
    }
    return false;
  }

  function _calOptionContainer(title, options = {}) {
    if (options.openPanel !== false) _calOpenDetailPanel();
    const detailEl = typeof _resolveDetailEl === 'function' ? _resolveDetailEl() : document.getElementById('rp-detail');
    if (!detailEl) return null;
    detailEl.style.display = '';
    if (typeof _ensureDetailTabShell === 'function') _ensureDetailTabShell(detailEl);

    const tabId = _calDetailTabId(options.tabId);
    const tabBody = detailEl.querySelector?.('#detail-tab-' + tabId) || null;
    if (tabBody) {
      _calPrepareCalendarDetailShell(detailEl);
      if (options.select !== false) _calSelectDetailTab(tabId);
      return _calBuildOptionBody(tabBody, title);
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

  window.MeldexCalendarOptionPanel = Object.freeze({
    container: _calOptionContainer,
    field: _calField,
    icon: _calIcon,
    findCalendarComponent: _calFindCalendarComponent,
    syncDetailTabs: _calPrepareCalendarDetailShell,
  });

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
      if (changed.has('gb:cal-attendance-hidden-source-folders')) {
        component._renderAttendanceSourceSettings?.(component._calendarSettingsBody);
        component._renderAttendanceStatus?.();
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
      label || 'スケジュール: 設定変更',
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

  // 候補ユーザー一覧はMeldexUserPickerに統一（正本「スタッフ管理シート」+
  // ワークスペースメンバーのマージ。ユーザーアカウント一元管理 計画書 Phase 3、
  // §5.8-3）。_loadTeamGroups() はワークスペース別グルーピング表示用の別機能
  // として維持し、それが使えない場合のフォールバックだけを差し替える。
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
    if (window.MeldexUserPicker) {
      try {
        const candidates = await window.MeldexUserPicker.getCandidates();
        if (candidates.length) return candidates;
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


  CalendarComponent.prototype._syncHistoryScope = function() {
    if (typeof historySetScope !== 'function') return;
    const embedScope = typeof _meldexProductionEmbedHistoryScope === 'function' ? _meldexProductionEmbedHistoryScope() : '';
    if (embedScope) { historySetScope(embedScope); return; }
    if (this._surface !== 'productionTasks' && typeof _schedHistoryScope === 'function') {
      historySetScope(_schedHistoryScope(this));
      return;
    }
    historySetScope(CALENDAR_SETTINGS_SCOPE);
  };

  const _origActivate = CalendarComponent.prototype.activate;
  CalendarComponent.prototype.activate = function() {
    _origActivate.call(this);
    this._syncHistoryScope();
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
      sideBtn.setAttribute('aria-label', sideBtn.title);
    }
    const viewSel = this.el?.querySelector?.('.gb-cal-view-select');
    if (viewSel && viewSel.value !== this._view) viewSel.value = this._view;
    this._syncEventSelectionBar?.();
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
    _calPushSettingsHistory('スケジュール: サイドバー表示変更', before, ['gb:cal-sidebar-mode', 'gb:cal-sidebar-only'], detail);
    this._applySidebarMode();
  };

  CalendarComponent.prototype._setSidebarOnly = function(on) {
    this._setSidebarMode(on ? 'only' : 'all');
  };

  CalendarComponent.prototype._toggleSidebar = function() {
    const mode = this._effectiveSidebarOnly() ? 'only' : (this._sidebarEl?.classList.contains('gb-cal-hidden') ? 'hidden' : 'all');
    this._setSidebarMode(mode === 'all' ? 'hidden' : mode === 'hidden' ? 'only' : 'all');
  };

  CalendarComponent.prototype._renderCalendarSettingsPanel = function(body) {
    if (!body) return;
    this._calendarSettingsBody = body;
    const opts = [[0, '日曜始まり'], [1, '月曜始まり'], [2, '火曜始まり'], [3, '水曜始まり'], [4, '木曜始まり'], [5, '金曜始まり'], [6, '土曜始まり']]
      .map(([v, label]) => `<option value="${v}" ${v === this._startDay ? 'selected' : ''}>${label}</option>`).join('');
    const currentTimeFormat = window.MeldexProductionTimeFormatter?.getPreference?.() || 'hm';
    const timeFormatOpts = (window.MeldexProductionTimeFormatter?.FORMAT_OPTIONS || [
      { value: 'hm', label: '時間・分' },
      { value: 'm', label: '分' },
      { value: 'decimal', label: '小数時間' },
    ]).map(opt => `<option value="${opt.value}" ${opt.value === currentTimeFormat ? 'selected' : ''}>${opt.label}</option>`).join('');
    body.innerHTML = `
      ${_calField('表示', `<label class="cal-option-check"><input type="checkbox" data-cal-settings-sidebar-only ${this._sidebarOnly ? 'checked' : ''}> サイドバーのみ表示</label>`)}
      ${_calField('週の開始曜日', `<select class="gb-select" data-cal-settings-start-day>${opts}</select>`)}
      ${_calField('時間の表記', `<select class="gb-select" data-cal-settings-time-format>${timeFormatOpts}</select>`)}
      <div class="cal-option-actions">
        <button type="button" data-cal-settings-action="template">${_calIcon('layoutTemplate')} テンプレート</button>
        <button type="button" data-cal-settings-action="sync">${_calIcon('refreshCw')} 同期</button>
        <button type="button" data-cal-settings-action="timer">${_calIcon('timer')} タイマー</button>
      </div>`;
    this._renderAttendanceSourceSettings?.(body);
    this._renderShiftTemplateSettings?.(body);
    body.querySelector('[data-cal-settings-sidebar-only]')?.addEventListener('change', e => this._setSidebarOnly(e.currentTarget.checked));
    body.querySelector('[data-cal-settings-start-day]')?.addEventListener('change', e => {
      const before = _calCaptureSettingsHistory(['gb-cal-start-day']);
      this._startDay = parseInt(e.currentTarget.value, 10);
      localStorage.setItem('gb-cal-start-day', this._startDay);
      _calPushSettingsHistory('スケジュール: 週の開始曜日変更', before, ['gb-cal-start-day'], String(this._startDay));
      this._render();
      this._renderMiniCal();
    });
    body.querySelector('[data-cal-settings-time-format]')?.addEventListener('change', e => {
      const val = e.currentTarget.value;
      if (window.MeldexProductionTimeFormatter?.setPreference) {
        window.MeldexProductionTimeFormatter.setPreference(val);
      }
      this._render?.();
      if (this._surface === 'productionTasks' && typeof this._renderProductionTaskView === 'function') {
        this._renderProductionTaskView();
      }
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

  CalendarComponent.prototype._showCalendarSettingsPanel = function(options = {}) {
    const body = _calOptionContainer('スケジュール設定', {
      tabId: 'calendar-settings',
      select: options.select !== false,
    });
    if (!body) return;
    this._renderCalendarSettingsPanel(body);
  };

  window.openCalendarSettingsPanel = function() {
    const component = _calFindCalendarComponent();
    if (!component || typeof component._showCalendarSettingsPanel !== 'function') {
      if (typeof showStatus === 'function') showStatus('スケジュールを開いてから設定を開いてください', true);
      return;
    }
    component._showCalendarSettingsPanel();
  };

  document.addEventListener('meldex:detail-tab-switched', (event) => {
    if (event.detail?.tab !== 'calendar-settings') return;
    if (window.__MeldexSuppressCalendarTabAutoRender) return;
    const component = _calFindCalendarComponent();
    if (component && typeof component._showCalendarSettingsPanel === 'function') {
      component._showCalendarSettingsPanel({ select: false });
    }
  });


  Object.assign(window.MeldexCalendarOptions, {
    _calFindCalendarComponent,
    _calOptionContainer,
    _calField,
    _calBindSwatch,
    _calGetSwatchValue,
    _calCaptureSettingsHistory,
    _calPushSettingsHistory,
    _calUserListFromValue,
    _calEventCreator,
    _calEventUserNames,
    _calAvatarHtml,
  });
})();
