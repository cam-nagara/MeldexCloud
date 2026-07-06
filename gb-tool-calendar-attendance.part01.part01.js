/* ==============================
   gb-tool-calendar-attendance.js: 打刻・勤怠・カレンダー整理拡張
   ============================== */

(() => {
  if (typeof CalendarComponent === 'undefined') return;

  const CLOCK_ACTIONS = [
    { type: 'clock_in', label: '出勤', icon: 'play' },
    { type: 'clock_out', label: '退勤', icon: 'pause' },
    { type: 'break_start', label: '離席', icon: 'clock' },
    { type: 'break_end', label: '復帰', icon: 'rotateCcw' },
  ];
  const CLOCK_STATE_LABELS = {
    initial: '未出勤',
    working: '出勤中',
    away: '離席中',
    off: '退勤済み',
  };
  const DEFAULT_CALENDAR_FOLDER = 'カレンダー';
  const SHIFT_CALENDAR_FOLDER = 'シフトカレンダー';
  const ATTENDANCE_CALENDAR_FOLDER = '実績カレンダー';
  const ATTENDANCE_SOURCE_HIDDEN_KEY = 'gb:cal-attendance-hidden-source-folders';
  const FALLBACK_CALENDAR_COLORS = ['#569cd6', '#d19a66', '#98c379', '#c678dd', '#e06c75', '#61afef', '#e5c07b', '#56b6c2'];

  function _calAttThemePalette() {
    try {
      if (typeof MeldexThemeManager !== 'undefined' && typeof MeldexThemeManager.getThemeColorSet === 'function') {
        const set = MeldexThemeManager.getThemeColorSet();
        if (Array.isArray(set) && set.length) return set.filter(Boolean);
      }
    } catch {}
    return FALLBACK_CALENDAR_COLORS;
  }

  function _calAttPaletteColorAt(index) {
    const palette = _calAttThemePalette();
    if (!palette.length) return FALLBACK_CALENDAR_COLORS[0];
    return palette[((index % palette.length) + palette.length) % palette.length];
  }

  function _calAttEsc(v) {
    return typeof esc === 'function' ? esc(v) : String(v ?? '').replace(/[&<>"']/g, ch => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[ch]);
  }

  function _calAttStableSlug(value) {
    const raw = String(value || '').trim().toLowerCase();
    const ascii = raw.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    let hash = 0;
    for (let i = 0; i < raw.length; i++) {
      hash = ((hash << 5) - hash + raw.charCodeAt(i)) | 0;
    }
    return `${ascii || 'calendar'}-${Math.abs(hash).toString(36)}`;
  }

  function _calAttCalendarE2eKey(component, cal) {
    const base = [
      cal?.source || 'local',
      _calAttDefaultFolder(cal),
      cal?.name || '無題',
    ].join('|');
    const calendars = Array.isArray(component?._calendars) ? component._calendars : [];
    const sameBase = calendars.filter(item => [
      item?.source || 'local',
      _calAttDefaultFolder(item),
      item?.name || '無題',
    ].join('|') === base);
    if (sameBase.length <= 1) return _calAttStableSlug(base);
    const duplicateIndex = Math.max(0, sameBase.findIndex(item => item?.id === cal?.id));
    return _calAttStableSlug(`${base}|${duplicateIndex}`);
  }

  function _calAttIcon(name, size = 14) {
    return typeof lucide === 'function' ? lucide(name, size) : '';
  }

  function _calAttStoreKey(kind, id) {
    return `gb:cal-${kind}:${id}`;
  }

  function _calAttReadHiddenSourceFolders() {
    try {
      const raw = JSON.parse(localStorage.getItem(ATTENDANCE_SOURCE_HIDDEN_KEY) || '[]');
      return new Set(Array.isArray(raw) ? raw.map(item => String(item || '')) : []);
    } catch {
      return new Set();
    }
  }

  function _calAttWriteHiddenSourceFolders(hidden) {
    try {
      localStorage.setItem(ATTENDANCE_SOURCE_HIDDEN_KEY, JSON.stringify([...hidden].filter(item => item !== null && item !== undefined)));
    } catch {}
  }

  function _calAttRefreshSourceSettingsAfterHistory() {
    if (typeof forEachComponent !== 'function') return;
    forEachComponent(component => {
      if (!component || !(component instanceof CalendarComponent)) return;
      component._renderAttendanceSourceSettings?.(component._calendarSettingsBody);
      component._renderAttendanceStatus?.();
    });
  }

  function _calAttCaptureSourceSettingsHistory() {
    if (typeof captureLocalStorageSettings !== 'function') return null;
    if (typeof isLocalStorageSettingsHistorySuppressed === 'function'
      && isLocalStorageSettingsHistorySuppressed()) return null;
    return captureLocalStorageSettings([ATTENDANCE_SOURCE_HIDDEN_KEY]);
  }

  function _calAttPushSourceSettingsHistory(beforeSnapshot, detail) {
    if (!beforeSnapshot || typeof historyPush !== 'function'
      || typeof captureLocalStorageSettings !== 'function'
      || typeof restoreLocalStorageSettings !== 'function'
      || typeof _normalizeLocalStorageSettingsSnapshots !== 'function') return false;
    const snapshots = _normalizeLocalStorageSettingsSnapshots(beforeSnapshot, captureLocalStorageSettings([ATTENDANCE_SOURCE_HIDDEN_KEY]));
    let beforeKey = '';
    let afterKey = '';
    try {
      beforeKey = JSON.stringify(snapshots.before);
      afterKey = JSON.stringify(snapshots.after);
    } catch {}
    if (beforeKey && beforeKey === afterKey) return false;
    historyPush(
      'スケジューラー: 出退勤状況の表示変更',
      () => restoreLocalStorageSettings(snapshots.before, _calAttRefreshSourceSettingsAfterHistory),
      () => restoreLocalStorageSettings(snapshots.after, _calAttRefreshSourceSettingsAfterHistory),
      'calendar:settings',
      detail || '出退勤状況に表示するワークスペース'
    );
    return true;
  }

  function _calAttDateLabel(timestamp) {
    const raw = String(timestamp || '');
    if (!raw) return '';
    if (raw.endsWith('Z') || /[+-]\d{2}:\d{2}$/.test(raw)) {
      const d = new Date(raw);
      if (!Number.isNaN(d.getTime())) {
        return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
      }
    }
    return raw.substring(11, 16);
  }

  function _calAttDefaultFolder(cal) {
    if (cal?.folder) return cal.folder;
    if (cal?.source === 'attendance') return ATTENDANCE_CALENDAR_FOLDER;
    if (cal?.source === 'shift') return SHIFT_CALENDAR_FOLDER;
    return DEFAULT_CALENDAR_FOLDER;
  }

  function _calAttRoleLabel(role) {
    return { owner: '管理者のみ', editor: '編集者以上', members: '設定されたメンバーのみ', viewer: '閲覧のみ' }[role] || '管理者のみ';
  }

  function _calAttIsTeamCalendar(cal) {
    return cal?.source === 'shift' || cal?.source === 'attendance';
  }

  function _calAttCalendarSection(component, cal) {
    const folder = _calAttDefaultFolder(cal);
    if (!_calAttIsTeamCalendar(cal)) return { key: folder || DEFAULT_CALENDAR_FOLDER, label: folder || DEFAULT_CALENDAR_FOLDER };
    const labelMap = component?._calTeamFolderLabels;
    const mapped = labelMap instanceof Map ? labelMap.get(String(cal?.folder || '')) : '';
    const fallback = folder && folder !== SHIFT_CALENDAR_FOLDER && folder !== ATTENDANCE_CALENDAR_FOLDER
      ? String(folder).split(/[\\/]/).pop()
      : '';
    return {
      key: `${cal?.source || 'team'}:${folder || fallback || 'default'}`,
      label: mapped || fallback || 'ワークスペース未設定',
    };
  }

  function _calAttFolderFallbackForSource(source) {
    if (source === 'shift') return SHIFT_CALENDAR_FOLDER;
    if (source === 'attendance') return ATTENDANCE_CALENDAR_FOLDER;
    return DEFAULT_CALENDAR_FOLDER;
  }

  function _calAttUniqueName(component, baseName) {
    let idx = 1;
    let name = baseName || '無題';
    const names = (component._calendars || []).map(c => c.name);
    while (names.includes(name)) {
      idx++;
      name = `${baseName || '無題'}${idx}`;
    }
    return name;
  }

  function _calAttExportUrl(format, from, to, user) {
    const params = new URLSearchParams();
    params.set('format', format);
    if (from) params.set('date_from', from);
    if (to) params.set('date_to', to);
    if (user) params.set('user', user);
    return `${API_BASE}/cal/export/attendance-csv?${params.toString()}`;
  }

  function _calAttAuthHeaders() {
    const headers = {};
    try {
      if (typeof _authToken !== 'undefined' && _authToken) headers.Authorization = 'Bearer ' + _authToken;
    } catch {}
    return headers;
  }

  function _calAttCurrentUser() {
    try { return JSON.parse(localStorage.getItem('meldex-user') || '{}').name || 'anonymous'; }
    catch { return 'anonymous'; }
  }

  function _calAttMonthBounds(date) {
    const d = date || new Date();
    const y = d.getFullYear();
    const m = d.getMonth();
    const start = `${y}-${String(m + 1).padStart(2, '0')}-01`;
    const endDate = new Date(y, m + 1, 0);
    const end = `${endDate.getFullYear()}-${String(endDate.getMonth() + 1).padStart(2, '0')}-${String(endDate.getDate()).padStart(2, '0')}`;
    return { start, end };
  }

  function _calAttPreviousDateStr(component, dateStr) {
    const base = typeof component._parseLocalDate === 'function' ? component._parseLocalDate(dateStr) : new Date(dateStr);
    if (Number.isNaN(base.getTime())) return dateStr;
    base.setDate(base.getDate() - 1);
    return component._localDateStr(base);
  }

  const baseCreate = CalendarComponent.prototype.create;
  CalendarComponent.prototype.create = function() {
    const el = baseCreate.call(this);
    this._installAttendanceSidebar();
    this._initClockPanel();
    this._loadCurrentCalendarRole();
    this._updateClockStatus();
    this._bindCalendarThemeListeners();
    return el;
  };

  CalendarComponent.prototype._bindCalendarThemeListeners = function() {
    if (this._calendarThemeHandler) return;
    const handler = () => {
      if (!this.el || !this.el.isConnected) return;
      this._renderCalendarList();
      if (typeof this._render === 'function') this._render();
    };
    this._calendarThemeHandler = handler;
    window.addEventListener('meldex-theme-color-set-change', handler);
    window.addEventListener('meldex-theme-change', handler);
  };

  CalendarComponent.prototype._unbindCalendarThemeListeners = function() {
    if (!this._calendarThemeHandler) return;
    window.removeEventListener('meldex-theme-color-set-change', this._calendarThemeHandler);
    window.removeEventListener('meldex-theme-change', this._calendarThemeHandler);
    this._calendarThemeHandler = null;
  };

  const baseAttendanceDestroy = CalendarComponent.prototype.destroy;
  CalendarComponent.prototype.destroy = function() {
    this._unbindCalendarThemeListeners();
    if (typeof baseAttendanceDestroy === 'function') baseAttendanceDestroy.call(this);
  };

  CalendarComponent.prototype._loadCurrentCalendarRole = async function() {
    try {
      const me = await apiFetch('/auth/me?username=' + encodeURIComponent(this._getUser()), { headers: _calAttAuthHeaders(), silentError: true });
      this._calCurrentRole = me?.role || '';
      this._renderCalendarList();
    } catch {}
  };

  CalendarComponent.prototype._calUserIsAdmin = function() {
    let role = this._calCurrentRole || '';
    try {
      if (!role && typeof getMyRoleForPath === 'function') role = getMyRoleForPath('') || role;
      else if (!role && typeof _myTeamRole !== 'undefined') role = _myTeamRole || role;
    } catch {}
    return role === 'owner' || role === 'admin';
  };

  CalendarComponent.prototype._calUserCanEditCalendar = function(cal) {
    if (!cal) return false;
    const user = this._getUser();
    if ((cal.user || '') === user) return true;
    let role = this._calCurrentRole || '';
    try {
      if (!role && typeof getMyRoleForPath === 'function') role = getMyRoleForPath('') || role;
      else if (!role && typeof _myTeamRole !== 'undefined') role = _myTeamRole || role;
    } catch {}
    if (role === 'owner' || role === 'admin') return true;
    return (cal.edit_role || 'owner') === 'editor' && role === 'editor';
  };

  CalendarComponent.prototype._calUserCanDeleteCalendar = function(cal) {
    if (!cal) return false;
    return (cal.user || '') === this._getUser() || this._calUserIsAdmin();
  };

  CalendarComponent.prototype._loadEvents = async function() {
    const y = this._date.getFullYear();
    const m = this._date.getMonth();
    const start = this._localDateTimeStr(new Date(y, m - 1, 1, 0, 0));
    const end = this._localDateTimeStr(new Date(y, m + 2, 0, 23, 59));
    if (typeof this._guardUndoLoadWindow === 'function') this._guardUndoLoadWindow(start + '|' + end);
    const seq = (this._loadEventsSeq = (this._loadEventsSeq || 0) + 1);
    try {
      const events = await apiFetch('/cal/events?start=' + encodeURIComponent(start) + '&end=' + encodeURIComponent(end) + '&user=' + encodeURIComponent(this._getUser()));
      if (seq !== this._loadEventsSeq) return; // 古い読み込み窓の応答は破棄（連打時の巻き戻り防止）
      this._events = events;
    } catch {
      if (seq !== this._loadEventsSeq) return;
      // 取得失敗時に表示中の予定を消さない（既存表示を維持してエラーを知らせる）
      if (!Array.isArray(this._events)) this._events = [];
      this._showStatus?.('予定の読み込みに失敗しました', true);
    }
  };

  CalendarComponent.prototype._loadCalendars = async function() {
    try {
      this._calendars = await apiFetch('/cal/calendars?user=' + encodeURIComponent(this._getUser()));
      const user = this._getUser();
      const hasOwnLocal = this._calendars.some(c => (c.user || '') === user && (c.source || 'local') === 'local');
      if (!hasOwnLocal) {
        await apiPost('/cal/calendars', {
          name: 'マイカレンダー',
          color: _calAttPaletteColorAt(this._calendars.length),
          user,
          source: 'local',
          folder: DEFAULT_CALENDAR_FOLDER,
        });
        this._calendars = await apiFetch('/cal/calendars?user=' + encodeURIComponent(this._getUser()));
      }
      this._visibleCalIds = new Set(this._calendars.filter(c => c.visible).map(c => c.id));
      this._ensureSelectedCalendar?.();
      this._renderCalendarList();
    } catch {}
  };

  CalendarComponent.prototype._firstCalendar = function() {
    const calendars = this._calendars || [];
    const user = this._getUser();
    const visible = calendars.filter(c => this._visibleCalIds?.has(c.id));
    return visible.find(c => (c.user || '') === user && (c.source || 'local') === 'local')
      || visible.find(c => (c.user || '') === user)
      || calendars.find(c => (c.user || '') === user && (c.source || 'local') === 'local')
      || visible.find(c => (c.source || 'local') === 'local')
      || visible[0]
      || calendars[0]
      || null;
  };

  CalendarComponent.prototype._initClockPanel = function() {
    const toggle = this.el?.querySelector?.('.gb-cal-clock-toggle');
    const toggleLabel = toggle?.closest?.('label');
    if (toggleLabel) toggleLabel.style.display = 'none';
    this._clockEnabled = true;
    localStorage.setItem('gb:clock-enabled', 'true');
    if (this._clockBtnsEl) {
      this._clockBtnsEl.style.display = '';
      this._clockBtnsEl.classList.add('gb-cal-clock-buttons-icon');
    }
    this._clockStatusEl = null;
    this._renderClockButtons(this._clockState || 'initial');
  };

  CalendarComponent.prototype._toggleClockPanel = function() {
    this._clockEnabled = true;
    if (this._clockBtnsEl) this._clockBtnsEl.style.display = '';
    this._renderClockButtons(this._clockState || 'initial');
    this._updateClockStatus();
  };

  CalendarComponent.prototype._allowedClockActions = function(state) {
    if (state === 'initial') return new Set(['clock_in']);
    if (state === 'working') return new Set(['clock_out', 'break_start']);
    if (state === 'away') return new Set(['break_end']);
    return new Set();
  };

  CalendarComponent.prototype._clockStateFromEntries = function(entries) {
    const valid = (entries || [])
      .filter(row => CLOCK_ACTIONS.some(action => action.type === row.type))
      .sort((a, b) => String(a.timestamp || '').localeCompare(String(b.timestamp || '')));
    const last = valid[valid.length - 1];
    if (!last) return 'initial';
    if (last.type === 'clock_in' || last.type === 'break_end') return 'working';
    if (last.type === 'break_start') return 'away';
    return 'off';
  };

  CalendarComponent.prototype._clockStateFromWindowEntries = function(entries, day) {
    const valid = (entries || [])
      .filter(row => CLOCK_ACTIONS.some(action => action.type === row.type))
      .sort((a, b) => String(a.timestamp || '').localeCompare(String(b.timestamp || '')));
    const dayPrefix = String(day || this._localDateStr()) + 'T';
    if (valid.some(row => String(row.timestamp || '').startsWith(dayPrefix))) {
      return this._clockStateFromEntries(valid);
    }
    const state = this._clockStateFromEntries(valid);
    return state === 'working' || state === 'away' ? state : 'initial';
  };

  CalendarComponent.prototype._renderClockButtons = function(state) {
    if (!this._clockBtnsEl) return;
    const allowed = this._allowedClockActions(state);
    this._clockBtnsEl.innerHTML = CLOCK_ACTIONS.map(action => {
      const enabled = allowed.has(action.type) && !this._clockBusy && !this._clockStateUnknown;
      return `<button type="button" class="gb-cal-clock-icon-btn ${enabled ? '' : 'is-disabled'}" data-clock="${action.type}" title="${action.label}" aria-label="${action.label}" ${enabled ? '' : 'disabled'}>${_calAttIcon(action.icon, 18)}</button>`;
    }).join('');
  };

  CalendarComponent.prototype._clockAction = async function(type) {
    if (this._clockBusy) return;
    const state = this._clockState || this._clockStateFromEntries(this._clockEntries || []);
    if (!this._allowedClockActions(state).has(type)) return;
    this._clockBusy = true;
    this._renderClockButtons(state);
    try {
      await apiPost('/cal/time', {
        type,
        user: this._getUser(),
        timestamp: this._localDateTimeStr(new Date()),
      });
      const labels = { clock_in: '出勤しました', clock_out: '退勤しました', break_start: '離席しました', break_end: '復帰しました' };
      this._showStatus(labels[type] || type);
      await Promise.all([this._updateClockStatus(), this._loadEvents(), this._loadCalendars()]);
      this._render();
    } catch {
      this._showStatus('打刻に失敗', true);
    } finally {
      this._clockBusy = false;
      this._renderClockButtons(this._clockState || 'initial');
    }
  };

  CalendarComponent.prototype._updateClockStatus = async function() {
    const todayStr = this._localDateStr();
    const previousDayStr = _calAttPreviousDateStr(this, todayStr);
    try {
      const entries = await apiFetch(
        '/cal/time?user=' + encodeURIComponent(this._getUser())
        + '&date_from=' + encodeURIComponent(previousDayStr)
        + '&date_to=' + encodeURIComponent(todayStr + 'T23:59:59')
      );
      this._clockEntries = entries || [];
      this._clockState = this._clockStateFromWindowEntries(this._clockEntries, todayStr);
      this._clockStateUnknown = false;
      this._renderClockButtons(this._clockState);
      this._renderAttendanceStatus();
    } catch {
      // 取得失敗時に「未出勤」へ戻さない。出勤中に再出勤できてしまうと
      // 同日の打刻が二重記録され実績イベントが壊れるため、状態確定まで全ボタンを無効にする
      this._clockStateUnknown = true;
      this._renderClockButtons(this._clockState || 'initial');
      this._showStatus?.('勤務状態を取得できませんでした。再試行してください', true);
    }
  };

  CalendarComponent.prototype._statusFromEntries = function(entries) {
    const todayStr = this._localDateStr();
    const state = this._clockStateFromWindowEntries(entries, todayStr);
    const valid = (entries || [])
      .filter(row => CLOCK_ACTIONS.some(action => action.type === row.type))
      .sort((a, b) => String(a.timestamp || '').localeCompare(String(b.timestamp || '')));
    const last = valid[valid.length - 1];
    return {
      state,
      label: CLOCK_STATE_LABELS[state] || '未出勤',
      time: last ? _calAttDateLabel(last.timestamp) : '',
    };
  };

  CalendarComponent.prototype._installAttendanceSidebar = function() {
    if (!this._sidebarEl || this._sidebarEl.dataset.attendanceInstalled === '1') return;
    this._sidebarEl.dataset.attendanceInstalled = '1';

    const clockPanel = this._sidebarEl.querySelector('.gb-cal-clock-panel');
    const miniPanel = this._sidebarEl.querySelector('.gb-cal-mini');
    const taskPanel = this._todayTasksEl?.parentElement;
    const calendarPanel = this._calListEl?.parentElement;

    const clockHeader = clockPanel?.firstElementChild;
    if (clockHeader) clockHeader.style.display = 'none';
    const clockSection = this._wrapCalendarSidebarSection('clock', '打刻', 'clock', clockPanel);
    const attendanceSection = this._createCalendarSidebarSection('attendance', '出退勤状況', 'users');
    attendanceSection.querySelector('.gb-cal-section-body').innerHTML = '<div class="gb-cal-attendance-list"></div>';
    this._attendanceListEl = attendanceSection.querySelector('.gb-cal-attendance-list');
    if (clockSection?.nextSibling) this._sidebarEl.insertBefore(attendanceSection, clockSection.nextSibling);
    else this._sidebarEl.appendChild(attendanceSection);

    this._wrapCalendarSidebarSection('mini', 'ミニカレンダー', 'calendarDays', miniPanel);
    this._wrapCalendarSidebarSection('tasks', '今日のToDo', 'listChecks', taskPanel);
    this._wrapCalendarSidebarSection('calendars', 'カレンダー', 'calendarDays', calendarPanel);
    this._compactLegacySidebarHeader(taskPanel);
    this._compactLegacySidebarHeader(calendarPanel);
  };

  CalendarComponent.prototype._compactLegacySidebarHeader = function(node) {
    const header = node?.firstElementChild;
    if (!header) return;
    const title = header.querySelector('span');
    if (title) title.remove();
    header.style.justifyContent = 'flex-end';
  };

  CalendarComponent.prototype._createCalendarSidebarSection = function(id, title, icon) {
    const section = document.createElement('div');
    section.className = 'gb-cal-sidebar-section';
    section.dataset.calSidebarSection = id;
    const header = document.createElement('button');
    header.type = 'button';
    header.className = 'gb-cal-section-header';
    header.dataset.calSectionHeader = id;
    header.setAttribute('aria-label', `${title}を開閉`);
    header.innerHTML = `<span class="gb-cal-section-caret">${_calAttIcon('chevronDown', 12)}</span><span class="gb-cal-section-title">${_calAttIcon(icon, 14)}<span>${_calAttEsc(title)}</span></span>`;
    const body = document.createElement('div');
    body.className = 'gb-cal-section-body';
    section.appendChild(header);
    section.appendChild(body);
    this._bindCalendarSectionCollapse(section, id);
    return section;
  };

  CalendarComponent.prototype._wrapCalendarSidebarSection = function(id, title, icon, node) {
    if (!node || !node.parentElement) return null;
    const existing = node.closest('.gb-cal-sidebar-section');
    if (existing) return existing;
    const section = this._createCalendarSidebarSection(id, title, icon);
    node.parentElement.insertBefore(section, node);
    section.querySelector('.gb-cal-section-body').appendChild(node);
    return section;
  };

  CalendarComponent.prototype._bindCalendarSectionCollapse = function(section, id) {
    const header = section.querySelector('.gb-cal-section-header');
    const body = section.querySelector('.gb-cal-section-body');
    const key = _calAttStoreKey('section-open', id);
    const isOpen = localStorage.getItem(key) !== 'false';
    section.classList.toggle('is-collapsed', !isOpen);
    if (body) body.hidden = !isOpen;
    header?.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    header?.addEventListener('click', () => {
      const nextOpen = section.classList.contains('is-collapsed');
      section.classList.toggle('is-collapsed', !nextOpen);
      if (body) body.hidden = !nextOpen;
      header.setAttribute('aria-expanded', nextOpen ? 'true' : 'false');
      localStorage.setItem(key, nextOpen ? 'true' : 'false');
    });
  };

  CalendarComponent.prototype._loadTeamGroups = async function() {
    const current = this._getUser();
    try {
      let payload = null;
      if (window.MeldexWorkspaces?.load) {
        const workspaces = await window.MeldexWorkspaces.load({ force: true });
        payload = { workspaces };
      } else if (typeof apiFetch === 'function') {
        payload = await apiFetch('/workspaces');
      }
      const workspaces = Array.isArray(payload?.workspaces) ? payload.workspaces : (Array.isArray(payload) ? payload : []);
      if (workspaces.length) {
        const groups = workspaces.map(workspace => ({
          folder: workspace.id || workspace.folder || '',
          workspaceId: workspace.id || '',
          label: workspace.name || workspace.folder || 'ワークスペース',
          members: this._normalizeTeamMembers(workspace.members || [], current),
        }));
        this._calTeamFolderLabels = new Map(groups.map(group => [String(group.folder || ''), group.label || 'ワークスペース']));
        return groups;
      }
    } catch {}
    this._calTeamFolderLabels = new Map();
    return [];
  };

  CalendarComponent.prototype._normalizeTeamMembers = function(members, current) {
    const map = new Map();
    (members || []).forEach(member => {
      const name = String(member?.name || '').trim();
      if (name) map.set(name, { name, role: member.role || '' });
    });
    if (current && !map.has(current)) map.set(current, { name: current, role: '' });
    return [...map.values()];
  };

  CalendarComponent.prototype._renderAttendanceStatus = async function() {
    const list = this._attendanceListEl || this.el?.querySelector?.('.gb-cal-attendance-list');
    if (!list) return;
    const token = (this._attendanceRenderSeq || 0) + 1;
    this._attendanceRenderSeq = token;
    list.innerHTML = '<div class="gb-cal-attendance-empty">読み込み中...</div>';
    const todayStr = this._localDateStr();
    const previousDayStr = _calAttPreviousDateStr(this, todayStr);
    const groups = await this._loadAttendanceTeamGroups();
    if (token !== this._attendanceRenderSeq) return;
    if (!groups.length) {
      list.innerHTML = '<div class="gb-cal-attendance-empty">表示するワークスペースが選択されていません</div>';
      return;
    }

    const renderedGroups = [];
    for (const group of groups) {
      const rows = [];
      for (const member of group.members) {
        let entries = [];
        try {
          entries = await apiFetch(
            '/cal/time?user=' + encodeURIComponent(member.name)
            + '&date_from=' + encodeURIComponent(previousDayStr)
            + '&date_to=' + encodeURIComponent(todayStr + 'T23:59:59')
          );
        } catch {}
        rows.push({ member, status: this._statusFromEntries(entries) });
      }
      renderedGroups.push({ ...group, rows });
    }
    if (token !== this._attendanceRenderSeq) return;

    list.innerHTML = '';
    const hasMultipleFolders = renderedGroups.length > 1;
    renderedGroups.forEach(group => {
      const groupEl = document.createElement('div');
      groupEl.className = 'gb-cal-attendance-group';
      const buildUserRow = (row) => {
        const item = document.createElement('div');
        item.className = 'gb-cal-attendance-user';
        const iconHtml = typeof getUserAvatarHtml === 'function'
          ? getUserAvatarHtml(row.member.name, 20)
          : `<span class="gb-cal-attendance-avatar">${_calAttEsc(row.member.name.charAt(0).toUpperCase() || '?')}</span>`;
        item.innerHTML = `<span class="gb-cal-attendance-icon">${iconHtml}</span><span class="gb-cal-attendance-name">${_calAttEsc(row.member.name)}</span><strong class="gb-cal-attendance-status ${row.status.state}">${_calAttEsc(row.status.label)}</strong><span class="gb-cal-attendance-time">${_calAttEsc(row.status.time)}</span>`;
        return item;
      };

      if (hasMultipleFolders || group.folder) {
        const folderKey = group.folder || group.label || '';
        const storageKey = _calAttStoreKey('attendance-folder-open', folderKey);
        const isOpen = localStorage.getItem(storageKey) !== 'false';
        groupEl.classList.add('gb-cal-attendance-folder-group');
        groupEl.classList.toggle('is-collapsed', !isOpen);
        const header = document.createElement('button');
        header.type = 'button';
        header.className = 'gb-cal-attendance-folder-header';
        header.dataset.calAttendanceFolder = folderKey || group.label || 'default';
        header.setAttribute('aria-label', `${group.label}の出退勤状況を開閉`);
        header.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
        header.innerHTML = `<span class="gb-cal-folder-caret">${_calAttIcon('chevronDown', 12)}</span><span class="gb-cal-folder-name">${_calAttEsc(group.label)}</span><span class="gb-cal-folder-count">${group.rows.length}</span>`;
        const body = document.createElement('div');
        body.className = 'gb-cal-attendance-folder-body';
        body.hidden = !isOpen;
        header.addEventListener('click', () => {
          const nextOpen = groupEl.classList.contains('is-collapsed');
          groupEl.classList.toggle('is-collapsed', !nextOpen);
          body.hidden = !nextOpen;
          header.setAttribute('aria-expanded', nextOpen ? 'true' : 'false');
          localStorage.setItem(storageKey, nextOpen ? 'true' : 'false');
        });
        group.rows.forEach(row => body.appendChild(buildUserRow(row)));
        groupEl.append(header, body);
      } else {
        group.rows.forEach(row => groupEl.appendChild(buildUserRow(row)));
      }
      list.appendChild(groupEl);
    });
    if (!list.children.length) list.innerHTML = '<div class="gb-cal-attendance-empty">メンバーなし</div>';
  };

  CalendarComponent.prototype._renderCalendarList = function() {
    const container = this._calListEl;
    if (!container) return;
    container.innerHTML = '';
    this._ensureSelectedCalendar?.();

    if (!this._calTeamFolderLabelsLoadStarted && typeof this._loadTeamGroups === 'function') {
      this._calTeamFolderLabelsLoadStarted = true;
      this._loadTeamGroups().then(() => this._renderCalendarList?.()).catch(() => {});
    }

    const folders = new Map();
    (this._calendars || []).forEach(cal => {
      const section = _calAttCalendarSection(this, cal);
      if (!folders.has(section.key)) folders.set(section.key, { label: section.label, calendars: [] });
      folders.get(section.key).calendars.push(cal);
    });

    [...folders.entries()].sort((a, b) => a[1].label.localeCompare(b[1].label, 'ja')).forEach(([folder, section]) => {
      const calendars = section.calendars;
      calendars.sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0) || String(a.name || '').localeCompare(String(b.name || ''), 'ja'));
      const group = document.createElement('div');
      group.className = 'gb-cal-calendar-folder';
      const key = _calAttStoreKey('folder-open', folder);
      const open = localStorage.getItem(key) !== 'false';
      group.classList.toggle('is-collapsed', !open);
      const header = document.createElement('button');
      header.type = 'button';
      header.className = 'gb-cal-calendar-folder-header';
      header.dataset.calCalendarFolder = folder || 'default';
      header.setAttribute('aria-label', `${section.label}のカレンダーを開閉`);
      header.setAttribute('aria-expanded', open ? 'true' : 'false');
      header.innerHTML = `<span class="gb-cal-folder-caret">${_calAttIcon('chevronDown', 12)}</span><span class="gb-cal-folder-name">${_calAttEsc(section.label)}</span><span class="gb-cal-folder-count">${calendars.length}</span>`;
      const body = document.createElement('div');
      body.className = 'gb-cal-calendar-folder-body';
      body.hidden = !open;
      header.addEventListener('click', () => {
        const nextOpen = group.classList.contains('is-collapsed');
        group.classList.toggle('is-collapsed', !nextOpen);
        body.hidden = !nextOpen;
        header.setAttribute('aria-expanded', nextOpen ? 'true' : 'false');
        localStorage.setItem(key, nextOpen ? 'true' : 'false');
      });
      group.appendChild(header);
      group.appendChild(body);
      calendars.forEach(cal => body.appendChild(this._buildCalendarRow(cal)));
      container.appendChild(group);
    });
  };

  CalendarComponent.prototype._buildCalendarRow = function(cal) {
    const row = document.createElement('div');
    row.className = 'gb-cal-calendar-row';
    row.dataset.calendarId = cal.id;
    row.tabIndex = 0;
    row.setAttribute('aria-label', 'カレンダーを選択: ' + (cal.name || '無題'));
    row.classList.toggle('is-selected', this._selectedCalendarId === cal.id);
    row.setAttribute('aria-selected', this._selectedCalendarId === cal.id ? 'true' : 'false');
    row.addEventListener('click', (e) => {
      if (e.target.closest('input,button,select,label')) return;
      this._selectCalendar?.(cal.id);
    });
    row.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      this._selectCalendar?.(cal.id);
    });
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.title = '表示切り替え: ' + (cal.name || '無題');
    cb.setAttribute('aria-label', cb.title);
    cb.dataset.calCalendarVisible = cal.id || '';
    cb.checked = this._visibleCalIds.has(cal.id);
    cb.disabled = !this._calUserCanEditCalendar(cal);
    if (cb.disabled) cb.title = '編集権限がありません';
    cb.addEventListener('change', () => {
      if (!this._calUserCanEditCalendar(cal)) {
        cb.checked = this._visibleCalIds.has(cal.id);
        this._showStatus('編集権限がありません', true);
        return;
      }
      if (cb.checked) this._visibleCalIds.add(cal.id);
      else this._visibleCalIds.delete(cal.id);
      if (!cb.checked && this._selectedCalendarId === cal.id) this._selectedCalendarId = '';
      this._ensureSelectedCalendar?.();
      apiPut('/cal/calendars/' + encodeURIComponent(cal.id) + '?_user=' + encodeURIComponent(this._getUser()), { visible: cb.checked ? 1 : 0 });
      this._renderCalendarList();
      this._render();
    });
    const dot = document.createElement('span');
    dot.className = 'gb-cal-calendar-dot';
    const idx = Math.max(0, (this._calendars || []).findIndex(c => c.id === cal.id));
    dot.style.background = cal.color || _calAttPaletteColorAt(idx);
    const label = document.createElement('span');
    label.className = 'gb-cal-calendar-name';
    label.textContent = cal.name || '無題';
    const menuBtn = document.createElement('button');
    menuBtn.type = 'button';
    menuBtn.className = 'gb-cal-calendar-icon-action gb-cal-calendar-more';
    const calendarLabel = cal.name || '無題';
    menuBtn.title = 'カレンダー操作';
    menuBtn.setAttribute('aria-label', 'カレンダー操作: ' + calendarLabel);
    menuBtn.dataset.e2eId = 'calendar-row-menu-' + _calAttCalendarE2eKey(this, cal);
    menuBtn.dataset.calCalendarAction = 'menu:' + (cal.id || '');
    menuBtn.innerHTML = _calAttIcon('moreHorizontal', 14);
    menuBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this._showCalendarRowMenu(menuBtn, cal);
    });

    row.appendChild(cb);
    row.appendChild(dot);
    row.appendChild(label);
    row.appendChild(menuBtn);
    return row;
  };

  CalendarComponent.prototype._closeCalendarRowMenu = function() {
    document.querySelectorAll('.gb-cal-calendar-menu').forEach(menu => menu.remove());
  };

  CalendarComponent.prototype._showCalendarRowMenu = function(anchor, cal) {
    if (!anchor || !cal) return;
    this._closeCalendarRowMenu();
    const menu = document.createElement('div');
    menu.className = 'gb-context-menu gb-cal-calendar-menu';
    menu.style.position = 'fixed';
    menu.style.zIndex = '10002';
    const canEdit = this._calUserCanEditCalendar(cal);
    const canDelete = this._calUserCanDeleteCalendar(cal);
    const calendarE2eKey = _calAttCalendarE2eKey(this, cal);
    menu.setAttribute('role', 'dialog');
    menu.setAttribute('aria-label', 'カレンダー操作: ' + (cal.name || '無題'));

    const title = document.createElement('div');
    title.className = 'gb-cal-calendar-menu-title';
    title.textContent = cal.name || '無題';
    menu.appendChild(title);

    const colorRow = document.createElement('div');
    colorRow.className = 'gb-cal-calendar-menu-field';
    const colorLabel = document.createElement('label');
    colorLabel.textContent = '色';
    const colorSwatch = document.createElement('button');
    colorSwatch.type = 'button';
    colorSwatch.className = 'gb-color-swatch gb-color-swatch--field';
    colorSwatch.title = 'カレンダーの色';
    colorSwatch.setAttribute('aria-label', 'カレンダーの色');
    const currentColor = cal.color || _calAttPaletteColorAt(0);
    if (typeof setColorSwatchValue === 'function') setColorSwatchValue(colorSwatch, currentColor);
    else { colorSwatch.dataset.color = currentColor; colorSwatch.style.background = currentColor; }
    colorSwatch.disabled = !canEdit;
    colorSwatch.title = canEdit ? 'カレンダーの色' : '編集権限がありません';
    colorSwatch.setAttribute('aria-label', colorSwatch.title);
    if (canEdit && typeof bindColorSwatch === 'function') {
      bindColorSwatch(colorSwatch,
        () => (typeof getColorSwatchValue === 'function' ? getColorSwatchValue(colorSwatch, currentColor) : (colorSwatch.dataset.color || currentColor)),
        (nextColor) => {
          const chosen = nextColor || currentColor;
          if (typeof setColorSwatchValue === 'function') setColorSwatchValue(colorSwatch, chosen);
          else { colorSwatch.dataset.color = chosen; colorSwatch.style.background = chosen; }
          this._setCalendarColor(cal, chosen);
        });
    }
    colorRow.append(colorLabel, colorSwatch);
    menu.appendChild(colorRow);

    let folderInput = null;
    if (!_calAttIsTeamCalendar(cal)) {
      const folderRow = document.createElement('div');
      folderRow.className = 'gb-cal-calendar-menu-field';
      const folderLabel = document.createElement('label');
      folderLabel.textContent = 'フォルダ';
      folderInput = document.createElement('input');
      folderInput.type = 'text';
      folderInput.className = 'gb-cal-calendar-folder-input';
      folderInput.value = _calAttDefaultFolder(cal);
      folderInput.placeholder = DEFAULT_CALENDAR_FOLDER;
      folderInput.disabled = !canEdit;
      folderInput.title = canEdit ? 'フォルダ' : '編集権限がありません';
      folderInput.setAttribute('aria-label', 'フォルダ');
      folderInput.dataset.e2eId = 'calendar-folder-input-' + calendarE2eKey;
      folderInput.dataset.calCalendarFolderInput = cal.id || '';
      const folderSave = document.createElement('button');
      folderSave.type = 'button';
      folderSave.className = 'gb-cal-calendar-folder-save';
      folderSave.disabled = !canEdit;
      folderSave.title = canEdit ? 'フォルダ名変更' : '編集権限がありません';
      folderSave.setAttribute('aria-label', folderSave.title);
      folderSave.dataset.e2eId = 'calendar-folder-save-' + calendarE2eKey;
      folderSave.dataset.calCalendarFolderSave = cal.id || '';
      folderSave.innerHTML = _calAttIcon('folderPen', 14);
      folderSave.addEventListener('click', async () => {
        await this._setCalendarFolder(cal, folderInput.value);
        menu.remove();
      });
      folderInput.addEventListener('keydown', async (e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        await this._setCalendarFolder(cal, folderInput.value);
        menu.remove();
      });
      folderRow.append(folderLabel, folderInput, folderSave);
      menu.appendChild(folderRow);
    }

    if (_calAttIsTeamCalendar(cal)) {
      menu.appendChild(this._buildCalendarTeamFolderRow(cal, folderInput));
    }

    const roleRow = document.createElement('div');
    roleRow.className = 'gb-cal-calendar-menu-field';
    const roleLabel = document.createElement('label');
    roleLabel.textContent = '編集権限';
    const roleSelect = document.createElement('select');
    roleSelect.className = 'gb-cal-calendar-role';
    ['owner', 'editor', 'members', 'viewer'].forEach(role => {
      const opt = document.createElement('option');
      opt.value = role;
      opt.textContent = _calAttRoleLabel(role);
      roleSelect.appendChild(opt);
    });
    roleSelect.value = cal.edit_role || 'owner';
    roleSelect.disabled = !this._calUserIsAdmin();
    roleSelect.title = roleSelect.disabled ? '管理者のみ変更できます' : '編集権限';
    roleSelect.setAttribute('aria-label', '編集権限');
    roleSelect.addEventListener('change', () => this._setCalendarRole(cal, roleSelect.value));
    roleRow.append(roleLabel, roleSelect);
    menu.appendChild(roleRow);

    const divider = document.createElement('div');
    divider.className = 'gb-cal-calendar-menu-divider';
    menu.appendChild(divider);
    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'gb-cal-calendar-menu-delete';
    deleteBtn.disabled = !canDelete;
    deleteBtn.title = canDelete ? 'このカレンダーを削除' : '削除権限がありません';
    deleteBtn.setAttribute('aria-label', deleteBtn.title);
    deleteBtn.innerHTML = `<span>${_calAttIcon('trash2', 14)}</span><span>このカレンダーを削除</span>`;
    deleteBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this._deleteCalendarFromMenu(cal, menu);
    });
    menu.appendChild(deleteBtn);

    document.body.appendChild(menu);
    const rect = anchor.getBoundingClientRect();
    const z = typeof _getZoom === 'function' ? _getZoom() : 1;
    menu.style.left = (rect.right / z + 4) + 'px';
    menu.style.top = (rect.top / z) + 'px';
    if (typeof clampPopupToViewport === 'function') clampPopupToViewport(menu);
    setTimeout(() => {
      const cleanup = () => {
        menu.remove();
        document.removeEventListener('pointerdown', close, true);
        document.removeEventListener('keydown', closeKey, true);
      };
      const close = (ev) => {
        if (!menu.contains(ev.target) && ev.target !== anchor) {
          cleanup();
        }
      };
      const closeKey = (ev) => {
        if (ev.key !== 'Escape') return;
        ev.preventDefault();
        cleanup();
        const restored = anchor?.isConnected
          ? anchor
          : [...document.querySelectorAll('[data-cal-calendar-action]')]
            .find(btn => btn?.dataset?.calCalendarAction === 'menu:' + String(cal.id || ''));
        const focusRestored = () => {
          if (!restored?.isConnected) return;
          try { restored.focus({ preventScroll: true }); }
          catch { restored.focus?.(); }
        };
        focusRestored();
        setTimeout(() => {
          if (document.activeElement !== restored) focusRestored();
        }, 0);
      };
      document.addEventListener('pointerdown', close, true);
      document.addEventListener('keydown', closeKey, true);
    }, 0);
  };

  CalendarComponent.prototype._deleteCalendarFromMenu = async function(cal, menu) {
    if (!cal?.id) return;
    if (!this._calUserCanDeleteCalendar(cal)) {
      this._showStatus?.('削除権限がありません', true);
      return;
    }
    const name = cal.name || '無題';
    if (typeof cfConfirm === 'function') {
      const ok = await cfConfirm(`カレンダー「${name}」を削除しますか？\n予定は削除せず、カレンダー未設定として残します。`);
      if (!ok) return;
    }
    menu?.remove?.();

    const beforeCalendars = Array.isArray(this._calendars) ? [...this._calendars] : [];
    const beforeVisibleIds = new Set(this._visibleCalIds || []);
    const beforeSelectedId = this._selectedCalendarId || '';
    const beforeEvents = Array.isArray(this._events) ? [...this._events] : [];

    this._calendars = beforeCalendars.filter(item => item.id !== cal.id);
    if (this._visibleCalIds) this._visibleCalIds.delete(cal.id);
    if (this._selectedCalendarId === cal.id) this._selectedCalendarId = '';
    if (Array.isArray(this._events)) {
      this._events = this._events.map(ev => ev?.calendar_id === cal.id ? { ...ev, calendar_id: '' } : ev);
    }
    this._ensureSelectedCalendar?.();
    this._renderCalendarList?.();
    this._render?.();

    try {
      await apiFetch('/cal/calendars/' + encodeURIComponent(cal.id) + '?_user=' + encodeURIComponent(this._getUser()), { method: 'DELETE' });
      await Promise.all([
        Promise.resolve(this._loadCalendars?.()).catch(() => {}),
        Promise.resolve(this._loadEvents?.()).catch(() => {}),
      ]);
      this._render?.();
      this._showStatus?.('カレンダーを削除しました');
    } catch (e) {
      this._calendars = beforeCalendars;
      this._visibleCalIds = beforeVisibleIds;
      this._selectedCalendarId = beforeSelectedId;
      this._events = beforeEvents;
      this._renderCalendarList?.();
      this._render?.();
      this._showStatus?.('カレンダーの削除に失敗しました', true);
    }
  };

  CalendarComponent.prototype._buildCalendarTeamFolderRow = function(cal, folderInput) {
    const row = document.createElement('div');
    row.className = 'gb-cal-calendar-menu-field';
    const label = document.createElement('label');
    label.textContent = 'ワークスペース';
    const select = document.createElement('select');
    select.className = 'gb-cal-calendar-team-folder';
    select.innerHTML = '<option value="">読み込み中...</option>';
    select.setAttribute('aria-label', 'ワークスペース');
    const canEdit = this._calUserCanEditCalendar(cal);
    select.disabled = !canEdit;
    select.title = canEdit ? 'ワークスペース' : '編集権限がありません';
    const apply = async () => {
      if (!canEdit) return;
      const value = select.value || '';
      if (!value) {
        this._showStatus?.('ワークスペースを選択してください', true);
        return;
      }
      if (folderInput) folderInput.value = value;
      await this._setCalendarFolder(cal, value);
    };
    select.addEventListener('change', apply);
    row.append(label, select);

    this._loadTeamGroups().then(groups => {
      const opts = (groups || [])
        .filter(group => group?.folder)
        .map(group => ({ value: group.folder, label: group.label || group.folder }));
      if (!opts.length) opts.push({ value: '', label: 'ワークスペースを設定してください', disabled: true });
      const seen = new Set();
      select.innerHTML = '';
      opts.forEach(opt => {
        if (seen.has(opt.value)) return;
        seen.add(opt.value);
        const option = document.createElement('option');
        option.value = opt.value;
        option.disabled = !!opt.disabled;
