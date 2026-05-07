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

  function _calAttIcon(name, size = 14) {
    return typeof lucide === 'function' ? lucide(name, size) : '';
  }

  function _calAttStoreKey(kind, id) {
    return `gb:cal-${kind}:${id}`;
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
    return { owner: '管理者のみ', editor: '編集者以上', viewer: '閲覧のみ' }[role] || '管理者のみ';
  }

  function _calAttIsTeamCalendar(cal) {
    return cal?.source === 'shift' || cal?.source === 'attendance';
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
      const me = await apiFetch('/auth/me?username=' + encodeURIComponent(this._getUser()));
      this._calCurrentRole = me?.role || '';
      this._renderCalendarList();
    } catch {}
  };

  CalendarComponent.prototype._calUserIsAdmin = function() {
    let role = this._calCurrentRole || '';
    try {
      if (typeof getMyRoleForPath === 'function') role = getMyRoleForPath('') || role;
      else if (typeof _myTeamRole !== 'undefined') role = _myTeamRole || role;
    } catch {}
    return role === 'owner' || role === 'admin';
  };

  CalendarComponent.prototype._loadEvents = async function() {
    const y = this._date.getFullYear();
    const m = this._date.getMonth();
    const start = this._localDateTimeStr(new Date(y, m - 1, 1, 0, 0));
    const end = this._localDateTimeStr(new Date(y, m + 2, 0, 23, 59));
    try {
      this._events = await apiFetch('/cal/events?start=' + encodeURIComponent(start) + '&end=' + encodeURIComponent(end));
    } catch {
      this._events = [];
    }
  };

  CalendarComponent.prototype._loadCalendars = async function() {
    try {
      this._calendars = await apiFetch('/cal/calendars');
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
        this._calendars = await apiFetch('/cal/calendars');
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
    const valid = (entries || []).filter(row => CLOCK_ACTIONS.some(action => action.type === row.type));
    const last = valid[valid.length - 1];
    if (!last) return 'initial';
    if (last.type === 'clock_in' || last.type === 'break_end') return 'working';
    if (last.type === 'break_start') return 'away';
    return 'off';
  };

  CalendarComponent.prototype._renderClockButtons = function(state) {
    if (!this._clockBtnsEl) return;
    const allowed = this._allowedClockActions(state);
    this._clockBtnsEl.innerHTML = CLOCK_ACTIONS.map(action => {
      const enabled = allowed.has(action.type) && !this._clockBusy;
      return `<button class="gb-cal-clock-icon-btn ${enabled ? '' : 'is-disabled'}" data-clock="${action.type}" title="${action.label}" aria-label="${action.label}" ${enabled ? '' : 'disabled'}>${_calAttIcon(action.icon, 18)}</button>`;
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
    try {
      const entries = await apiFetch(
        '/cal/time?user=' + encodeURIComponent(this._getUser())
        + '&date_from=' + encodeURIComponent(todayStr)
        + '&date_to=' + encodeURIComponent(todayStr + 'T23:59:59')
      );
      this._clockEntries = entries || [];
      this._clockState = this._clockStateFromEntries(this._clockEntries);
      this._renderClockButtons(this._clockState);
      this._renderAttendanceStatus();
    } catch {
      this._clockEntries = [];
      this._clockState = 'initial';
      this._renderClockButtons('initial');
    }
  };

  CalendarComponent.prototype._statusFromEntries = function(entries) {
    const state = this._clockStateFromEntries(entries);
    const valid = (entries || []).filter(row => CLOCK_ACTIONS.some(action => action.type === row.type));
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
    this._wrapCalendarSidebarSection('tasks', '今日のタスク', 'listChecks', taskPanel);
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
    header?.addEventListener('click', () => {
      const nextOpen = section.classList.contains('is-collapsed');
      section.classList.toggle('is-collapsed', !nextOpen);
      if (body) body.hidden = !nextOpen;
      localStorage.setItem(key, nextOpen ? 'true' : 'false');
    });
  };

  CalendarComponent.prototype._loadTeamGroups = async function() {
    const current = this._getUser();
    let roots = [];
    try { roots = await apiFetch('/outliner-roots'); } catch {}
    const visibleRoots = (roots || []).filter(root => root?.visible && root?.path);
    if (!visibleRoots.length) {
      let members = [];
      try { members = await apiFetch('/team'); } catch {}
      return [{ folder: '', label: 'ワークスペース', members: this._normalizeTeamMembers(members, current) }];
    }

    const groups = [];
    for (const root of visibleRoots) {
      let members = [];
      try { members = await apiFetch('/team?folder=' + encodeURIComponent(root.path)); } catch {}
      if ((members || []).length || current) {
        groups.push({
          folder: root.path,
          label: root.name || String(root.path).split(/[\\/]/).pop() || root.path,
          members: this._normalizeTeamMembers(members, current),
        });
      }
    }
    return groups.length ? groups : [{ folder: '', label: 'ワークスペース', members: [{ name: current, role: '' }] }];
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
    const groups = await this._loadTeamGroups();
    if (token !== this._attendanceRenderSeq) return;

    const renderedGroups = [];
    for (const group of groups) {
      const rows = [];
      for (const member of group.members) {
        let entries = [];
        try {
          entries = await apiFetch(
            '/cal/time?user=' + encodeURIComponent(member.name)
            + '&date_from=' + encodeURIComponent(todayStr)
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
        header.innerHTML = `<span class="gb-cal-folder-caret">${_calAttIcon('chevronDown', 12)}</span><span class="gb-cal-folder-name">${_calAttEsc(group.label)}</span><span class="gb-cal-folder-count">${group.rows.length}</span>`;
        const body = document.createElement('div');
        body.className = 'gb-cal-attendance-folder-body';
        body.hidden = !isOpen;
        header.addEventListener('click', () => {
          const nextOpen = groupEl.classList.contains('is-collapsed');
          groupEl.classList.toggle('is-collapsed', !nextOpen);
          body.hidden = !nextOpen;
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

    const folders = new Map();
    (this._calendars || []).forEach(cal => {
      const folder = _calAttDefaultFolder(cal);
      if (!folders.has(folder)) folders.set(folder, []);
      folders.get(folder).push(cal);
    });

    [...folders.entries()].sort((a, b) => a[0].localeCompare(b[0], 'ja')).forEach(([folder, calendars]) => {
      calendars.sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0) || String(a.name || '').localeCompare(String(b.name || ''), 'ja'));
      const group = document.createElement('div');
      group.className = 'gb-cal-calendar-folder';
      const key = _calAttStoreKey('folder-open', folder);
      const open = localStorage.getItem(key) !== 'false';
      group.classList.toggle('is-collapsed', !open);
      const header = document.createElement('button');
      header.type = 'button';
      header.className = 'gb-cal-calendar-folder-header';
      header.innerHTML = `<span class="gb-cal-folder-caret">${_calAttIcon('chevronDown', 12)}</span><span class="gb-cal-folder-name">${_calAttEsc(folder)}</span><span class="gb-cal-folder-count">${calendars.length}</span>`;
      const body = document.createElement('div');
      body.className = 'gb-cal-calendar-folder-body';
      body.hidden = !open;
      header.addEventListener('click', () => {
        const nextOpen = group.classList.contains('is-collapsed');
        group.classList.toggle('is-collapsed', !nextOpen);
        body.hidden = !nextOpen;
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
    row.classList.toggle('is-selected', this._selectedCalendarId === cal.id);
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
    cb.checked = this._visibleCalIds.has(cal.id);
    cb.addEventListener('change', () => {
      if (cb.checked) this._visibleCalIds.add(cal.id);
      else this._visibleCalIds.delete(cal.id);
      if (!cb.checked && this._selectedCalendarId === cal.id) this._selectedCalendarId = '';
      this._ensureSelectedCalendar?.();
      apiPut('/cal/calendars/' + cal.id, { visible: cb.checked ? 1 : 0 });
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
    menuBtn.title = 'カレンダー操作';
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
    const currentColor = cal.color || _calAttPaletteColorAt(0);
    if (typeof setColorSwatchValue === 'function') setColorSwatchValue(colorSwatch, currentColor);
    else { colorSwatch.dataset.color = currentColor; colorSwatch.style.background = currentColor; }
    if (typeof bindColorSwatch === 'function') {
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

    const folderRow = document.createElement('div');
    folderRow.className = 'gb-cal-calendar-menu-field';
    const folderLabel = document.createElement('label');
    folderLabel.textContent = _calAttIsTeamCalendar(cal) ? 'チームフォルダ' : 'フォルダ';
    const folderInput = document.createElement('input');
    folderInput.type = 'text';
    folderInput.value = _calAttDefaultFolder(cal);
    folderInput.placeholder = DEFAULT_CALENDAR_FOLDER;
    const folderSave = document.createElement('button');
    folderSave.type = 'button';
    folderSave.title = 'フォルダ名変更';
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

    if (_calAttIsTeamCalendar(cal)) {
      menu.appendChild(this._buildCalendarTeamFolderRow(cal, folderInput));
    }

    const roleRow = document.createElement('div');
    roleRow.className = 'gb-cal-calendar-menu-field';
    const roleLabel = document.createElement('label');
    roleLabel.textContent = '編集権限';
    const roleSelect = document.createElement('select');
    roleSelect.className = 'gb-cal-calendar-role';
    ['owner', 'editor', 'viewer'].forEach(role => {
      const opt = document.createElement('option');
      opt.value = role;
      opt.textContent = _calAttRoleLabel(role);
      roleSelect.appendChild(opt);
    });
    roleSelect.value = cal.edit_role || 'owner';
    roleSelect.disabled = !this._calUserIsAdmin();
    roleSelect.title = roleSelect.disabled ? '管理者のみ変更できます' : '編集権限';
    roleSelect.addEventListener('change', () => this._setCalendarRole(cal, roleSelect.value));
    roleRow.append(roleLabel, roleSelect);
    menu.appendChild(roleRow);

    document.body.appendChild(menu);
    const rect = anchor.getBoundingClientRect();
    const z = typeof _getZoom === 'function' ? _getZoom() : 1;
    menu.style.left = (rect.right / z + 4) + 'px';
    menu.style.top = (rect.top / z) + 'px';
    if (typeof clampPopupToViewport === 'function') clampPopupToViewport(menu);
    setTimeout(() => {
      const close = (ev) => {
        if (!menu.contains(ev.target) && ev.target !== anchor) {
          menu.remove();
          document.removeEventListener('pointerdown', close, true);
        }
      };
      document.addEventListener('pointerdown', close, true);
    }, 0);
  };

  CalendarComponent.prototype._buildCalendarTeamFolderRow = function(cal, folderInput) {
    const row = document.createElement('div');
    row.className = 'gb-cal-calendar-menu-field';
    const label = document.createElement('label');
    label.textContent = 'チーム';
    const select = document.createElement('select');
    select.className = 'gb-cal-calendar-team-folder';
    select.innerHTML = '<option value="">読み込み中...</option>';
    const save = document.createElement('button');
    save.type = 'button';
    save.title = 'チームフォルダを適用';
    save.innerHTML = _calAttIcon('folderCheck', 14);
    const apply = async () => {
      const value = select.value || _calAttFolderFallbackForSource(cal.source);
      if (folderInput) folderInput.value = value;
      await this._setCalendarFolder(cal, value);
    };
    save.addEventListener('click', apply);
    select.addEventListener('change', apply);
    row.append(label, select, save);

    this._loadTeamGroups().then(groups => {
      const opts = [];
      opts.push({ value: _calAttFolderFallbackForSource(cal.source), label: 'ワークスペース' });
      (groups || []).forEach(group => {
        if (!group.folder) return;
        opts.push({ value: group.folder, label: group.label || group.folder });
      });
      const seen = new Set();
      select.innerHTML = '';
      opts.forEach(opt => {
        if (seen.has(opt.value)) return;
        seen.add(opt.value);
        const option = document.createElement('option');
        option.value = opt.value;
        option.textContent = opt.label;
        select.appendChild(option);
      });
      select.value = cal.folder || _calAttFolderFallbackForSource(cal.source);
      if (select.value !== (cal.folder || _calAttFolderFallbackForSource(cal.source))) {
        const custom = document.createElement('option');
        custom.value = cal.folder || '';
        custom.textContent = cal.folder || 'ワークスペース';
        select.appendChild(custom);
        select.value = custom.value;
      }
    }).catch(() => {
      select.innerHTML = '';
      const option = document.createElement('option');
      option.value = cal.folder || _calAttFolderFallbackForSource(cal.source);
      option.textContent = cal.folder || 'ワークスペース';
      select.appendChild(option);
    });
    return row;
  };

  CalendarComponent.prototype._setCalendarColor = async function(cal, color) {
    const next = String(color || '').trim();
    if (!next) return;
    try {
      await apiPut('/cal/calendars/' + cal.id, { color: next });
      cal.color = next;
      this._renderCalendarList();
      this._render();
      this._showStatus('カレンダーの色を更新しました');
    } catch {
      this._showStatus('色の更新に失敗', true);
    }
  };

  CalendarComponent.prototype._setCalendarFolder = async function(cal, value) {
    const folder = String(value || '').trim() || _calAttFolderFallbackForSource(cal?.source);
    try {
      await apiPut('/cal/calendars/' + cal.id, { folder });
      cal.folder = folder;
      this._renderCalendarList();
      this._showStatus('フォルダを更新しました');
    } catch {
      this._showStatus('フォルダ変更に失敗', true);
    }
  };

  CalendarComponent.prototype._setCalendarRole = async function(cal, role) {
    if (!this._calUserIsAdmin()) return;
    try {
      await apiPut('/cal/calendars/' + cal.id, { edit_role: role });
      cal.edit_role = role;
      this._showStatus('カレンダー権限を更新しました');
    } catch {
      this._showStatus('カレンダー権限の更新に失敗', true);
    }
  };

  CalendarComponent.prototype._moveCalendarToFolder = async function(cal) {
    const current = _calAttDefaultFolder(cal);
    const next = prompt('フォルダ名', current);
    if (next === null) return;
    await this._setCalendarFolder(cal, next);
  };

  CalendarComponent.prototype._ensureTeamShiftCalendars = async function() {
    try {
      const groups = await this._loadTeamGroups();
      const names = new Set();
      groups.forEach(group => group.members.forEach(member => { if (member.name) names.add(member.name); }));
      let created = 0;
      let paletteIdx = (this._calendars || []).length;
      for (const name of names) {
        const exists = (this._calendars || []).some(cal => cal.source === 'shift' && cal.user === name);
        if (exists) continue;
        await apiPost('/cal/calendars', {
          name: `シフト: ${name}`,
          color: _calAttPaletteColorAt(paletteIdx++),
          user: name,
          source: 'shift',
          visible: 1,
          folder: SHIFT_CALENDAR_FOLDER,
        });
        created++;
      }
      await this._loadCalendars();
      this._showStatus(created ? `シフトカレンダーを${created}件作成しました` : 'シフトカレンダーは作成済みです');
    } catch {
      this._showStatus('シフトカレンダーの作成に失敗', true);
    }
  };

  CalendarComponent.prototype._closeCreateCalendarMenu = function() {
    document.querySelectorAll('.gb-cal-create-menu').forEach(menu => menu.remove());
  };

  CalendarComponent.prototype._showCreateCalendarMenu = function(anchor) {
    if (!anchor) return this._createCalendarByKind('local');
    this._closeCreateCalendarMenu();
    const menu = document.createElement('div');
    menu.className = 'gb-context-menu gb-cal-create-menu';
    menu.style.position = 'fixed';
    menu.style.zIndex = '10002';
    const items = [
      ['local', '通常カレンダー作成', 'calendar'],
      ['shift', 'シフトカレンダー作成', 'users'],
      ['attendance', '実績カレンダー作成', 'clipboardCheck'],
    ];
    items.forEach(([kind, label, icon]) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'gb-cal-create-menu-item';
      btn.innerHTML = `${_calAttIcon(icon, 14)}<span>${_calAttEsc(label)}</span>`;
      btn.addEventListener('click', () => {
        menu.remove();
        this._createCalendarByKind(kind);
      });
      menu.appendChild(btn);
    });
    document.body.appendChild(menu);
    if (typeof positionPopup === 'function') {
      positionPopup(menu, anchor.getBoundingClientRect());
    } else {
      const rect = anchor.getBoundingClientRect();
      const z = typeof _getZoom === 'function' ? _getZoom() : 1;
      menu.style.left = (rect.left / z) + 'px';
      menu.style.top = (rect.bottom / z + 4) + 'px';
      if (typeof clampPopupToViewport === 'function') clampPopupToViewport(menu);
    }
    setTimeout(() => {
      const close = (ev) => {
        if (!menu.contains(ev.target) && ev.target !== anchor) {
          menu.remove();
          document.removeEventListener('pointerdown', close, true);
        }
      };
      document.addEventListener('pointerdown', close, true);
    }, 0);
  };

  CalendarComponent.prototype._createCalendarByKind = async function(kind) {
    const source = kind === 'shift' ? 'shift' : kind === 'attendance' ? 'attendance' : 'local';
    const baseName = source === 'shift' ? SHIFT_CALENDAR_FOLDER : source === 'attendance' ? ATTENDANCE_CALENDAR_FOLDER : '無題';
    const name = _calAttUniqueName(this, baseName);
    try {
      const res = await apiPost('/cal/calendars', {
        name,
        color: _calAttPaletteColorAt((this._calendars || []).length),
        user: this._getUser(),
        source,
        visible: 1,
        folder: _calAttFolderFallbackForSource(source),
        edit_role: 'owner',
      });
      await this._loadCalendars();
      if (res?.id) this._selectCalendar?.(res.id);
      this._showStatus(`${name}を作成しました`);
    } catch {
      this._showStatus('カレンダー作成に失敗', true);
    }
  };

  CalendarComponent.prototype._createCalendar = async function() {
    await this._createCalendarByKind('local');
  };

  window.exportAttendanceCsvFromMenu = function() {
    const bounds = _calAttMonthBounds(new Date());
    const overlay = document.createElement('div');
    overlay.className = 'gb-cal-modal-overlay';
    overlay.innerHTML = `<div class="gb-cal-modal gb-cal-attendance-export-modal" style="min-width:420px;"><h3>勤怠CSVとして保存</h3>
      <div class="field"><label>開始日</label><input class="att-csv-from" type="date" value="${bounds.start}"></div>
      <div class="field"><label>終了日</label><input class="att-csv-to" type="date" value="${bounds.end}"></div>
      <div class="field"><label>ユーザー</label><input class="att-csv-user" type="text" value="" placeholder="空欄で全員"></div>
      <div class="gb-cal-att-csv-formats">
        <button class="att-csv-format" data-format="generic">汎用CSV</button>
        <button class="att-csv-format" data-format="smaregi">スマレジ形式</button>
        <button class="att-csv-format" data-format="moneyforward">マネーフォワード形式</button>
      </div>
      <div class="btn-row"><button class="att-csv-close">閉じる</button></div></div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('.att-csv-user').value = '';
    overlay.querySelector('.att-csv-close')?.addEventListener('click', () => overlay.remove());
    overlay.querySelectorAll('.att-csv-format').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (typeof MeldexExportSave === 'undefined' || typeof MeldexExportSave.saveUrl !== 'function') {
          if (typeof showStatus === 'function') showStatus('保存ダイアログを初期化できませんでした', true);
          return;
        }
        const from = overlay.querySelector('.att-csv-from')?.value || '';
        const to = overlay.querySelector('.att-csv-to')?.value || '';
        const user = overlay.querySelector('.att-csv-user')?.value.trim() || '';
        const fmt = btn.dataset.format || 'generic';
        await MeldexExportSave.saveUrl(_calAttExportUrl(fmt, from, to, user), {
          filename: `attendance-${fmt}-${from || 'from'}_${to || 'to'}.csv`,
          extension: '.csv',
          dialogTitle: '勤怠CSVとして保存',
          filetypes: [['CSVファイル', '*.csv'], ['すべてのファイル', '*.*']],
          okMessage: '勤怠CSVを保存しました',
          errorMessage: '勤怠CSVの保存に失敗しました',
        });
      });
    });
  };

  window.exportAttendanceCsvForCurrentUser = function() {
    const bounds = _calAttMonthBounds(new Date());
    const user = _calAttCurrentUser();
    return MeldexExportSave.saveUrl(_calAttExportUrl('generic', bounds.start, bounds.end, user), {
      filename: `attendance-generic-${bounds.start}_${bounds.end}.csv`,
      extension: '.csv',
      dialogTitle: '勤怠CSVとして保存',
      filetypes: [['CSVファイル', '*.csv'], ['すべてのファイル', '*.*']],
    });
  };
})();
