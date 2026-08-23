/* ==============================
   gb-tool-calendar-shift-templates.js: Shift calendar work templates
   ============================== */
(function() {
  if (typeof CalendarComponent === 'undefined') return;

  const SHIFT_TEMPLATE_KIND = 'shift-template';

  function _stEsc(value) {
    return MeldexEscape.html(value);
  }

  function _stIcon(name, size = 14) {
    return typeof lucide === 'function' ? lucide(name, size) : '';
  }

  function _stModalSizeStyle(minWidth, extra = 'overflow:auto;') {
    const width = Math.max(240, Number(minWidth) || 400);
    const zoom = Math.max(0.1, (typeof _getZoom === 'function' ? _getZoom() : parseFloat(document.documentElement?.style?.zoom || '')) || 1);
    const viewportWidth = Math.floor(window.visualViewport?.width || window.innerWidth || document.documentElement?.clientWidth || width + 16);
    const viewportHeight = Math.floor(window.visualViewport?.height || window.innerHeight || document.documentElement?.clientHeight || 720);
    const safeWidth = Math.max(240, Math.min(width, viewportWidth - 16));
    const safeHeight = Math.max(180, Math.floor((viewportHeight - 56) / zoom));
    return `min-width:0;min-height:0;width:${safeWidth}px;max-width:${safeWidth}px;max-height:${safeHeight}px;${extra}`;
  }

  function _stValidTime(value) {
    return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(value || ''));
  }

  function _stDisplayTime(value) {
    const raw = String(value || '').trim();
    return _stValidTime(raw) ? raw : '';
  }

  function _stTimeControlHtml(name, value, label, optional = false) {
    const placeholder = optional ? '--:--' : '09:00';
    return `<div class="gb-cal-time-control" data-cal-shift-time-control>
      <input class="gb-cal-time-input" data-cal-shift-time="${_stEsc(name)}" data-cal-shift-time-optional="${optional ? '1' : '0'}" type="text" inputmode="numeric" maxlength="5" autocomplete="off" placeholder="${placeholder}" value="${_stEsc(_stDisplayTime(value))}" aria-label="${_stEsc(label)}">
      <button type="button" data-cal-shift-time-menu="${_stEsc(name)}" aria-label="${_stEsc(label)}を選択" title="${_stEsc(label)}を選択">${_stIcon('chevronDown', 14)}</button>
    </div>`;
  }

  let _stActiveTimeMenu = null;
  let _stActiveTimeCleanup = null;
  let _stActiveTimeButton = null;

  function _stCloseTimeMenus() {
    if (_stActiveTimeCleanup) {
      _stActiveTimeCleanup();
      _stActiveTimeCleanup = null;
    }
    if (_stActiveTimeButton) {
      _stActiveTimeButton.setAttribute('aria-expanded', 'false');
      _stActiveTimeButton = null;
    }
    if (_stActiveTimeMenu) {
      _stActiveTimeMenu.remove();
      _stActiveTimeMenu = null;
    }
  }

  function _stTimeOptions(current, optional) {
    const values = [];
    if (optional) values.push('');
    for (let minutes = 0; minutes < 24 * 60; minutes += 15) {
      values.push(`${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`);
    }
    const clean = _stDisplayTime(current);
    if (clean && !values.includes(clean)) values.push(clean);
    return values.sort((a, b) => {
      if (!a) return -1;
      if (!b) return 1;
      return a.localeCompare(b);
    });
  }

  function _stOpenTimeMenu(input) {
    if (!input) return;
    _stCloseTimeMenus();
    const optional = input.dataset.calShiftTimeOptional === '1';
    const current = _stDisplayTime(input.value);
    const label = input.getAttribute('aria-label') || '時刻';
    const button = input.closest('[data-cal-shift-time-control]')?.querySelector('[data-cal-shift-time-menu]') || null;
    const menu = document.createElement('div');
    menu.className = 'gb-context-menu gb-cal-time-picker';
    menu.style.position = 'fixed';
    menu.style.zIndex = '10004';
    menu.setAttribute('role', 'listbox');
    menu.setAttribute('aria-label', label + '候補');
    _stTimeOptions(current, optional).forEach(value => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'gb-context-menu-item';
      btn.dataset.value = value;
      btn.setAttribute('role', 'option');
      btn.setAttribute('aria-selected', value === current ? 'true' : 'false');
      btn.setAttribute('aria-label', `${label} ${value || '未設定'}`);
      btn.textContent = value || '未設定';
      btn.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        input.value = value;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        _stCloseTimeMenus();
        input.focus();
      });
      menu.appendChild(btn);
    });
    _stActiveTimeMenu = menu;
    _stActiveTimeButton = button;
    button?.setAttribute('aria-expanded', 'true');
    _stPositionMenu(menu, input.closest('[data-cal-shift-time-control]') || input);
    requestAnimationFrame(() => {
      const selected = menu.querySelector('[aria-selected="true"]');
      selected?.scrollIntoView?.({ block: 'nearest' });
    });
    const close = event => {
      if (menu.contains(event.target) || input.contains(event.target) || input.closest('[data-cal-shift-time-control]')?.contains(event.target)) return;
      _stCloseTimeMenus();
    };
    const keyClose = event => {
      if (event.key === 'Escape') {
        event.preventDefault();
        _stCloseTimeMenus();
        input.focus();
      }
    };
    setTimeout(() => {
      if (_stActiveTimeMenu !== menu) return;
      document.addEventListener('pointerdown', close, true);
      document.addEventListener('keydown', keyClose, true);
      _stActiveTimeCleanup = () => {
        document.removeEventListener('pointerdown', close, true);
        document.removeEventListener('keydown', keyClose, true);
      };
    }, 0);
  }

  function _stBindTimeControls(root) {
    root.querySelectorAll('[data-cal-shift-time-control]').forEach(control => {
      if (control._calShiftTimeBound) return;
      control._calShiftTimeBound = true;
      const input = control.querySelector('[data-cal-shift-time]');
      const button = control.querySelector('[data-cal-shift-time-menu]');
      button?.setAttribute('aria-haspopup', 'listbox');
      button?.setAttribute('aria-expanded', 'false');
      button?.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        _stOpenTimeMenu(input);
      });
      input?.addEventListener('keydown', event => {
        if (event.key === 'ArrowDown') {
          event.preventDefault();
          _stOpenTimeMenu(input);
        }
      });
    });
  }

  function _stReadTime(root, name) {
    const control = root?.querySelector?.(`[data-cal-shift-time="${name}"]`);
    return String(control?.value || '').trim();
  }

  function _stReadTimeState(root, name) {
    const value = _stReadTime(root, name);
    return { value, partial: Boolean(value) && !_stValidTime(value) };
  }

  function _stUpdateTimeLabel(control, label) {
    if (!control) return;
    control.setAttribute('aria-label', label);
  }

  function _stShiftEntry(template) {
    const entries = Array.isArray(template?.entries) ? template.entries : [];
    return entries.find(entry => entry?.kind === SHIFT_TEMPLATE_KIND) || null;
  }

  function _stDefaultEntry(component) {
    return {
      kind: SHIFT_TEMPLATE_KIND,
      teamFolder: '',
      teamName: 'ワークスペース',
      workStart: '09:00',
      workEnd: '18:00',
      breaks: [
        { start: '12:00', end: '13:00' },
        { start: '', end: '' },
      ],
      user: component?._getUser?.() || 'anonymous',
    };
  }

  function _stNormalizeBreaks(breaks) {
    return (Array.isArray(breaks) ? breaks : [])
      .map(item => ({
        start: String(item?.start || '').trim(),
        end: String(item?.end || '').trim(),
      }))
      .filter(item => item.start && item.end);
  }

  function _stBreaksFromNote(note) {
    return String(note || '').split(/\r?\n/)
      .map(line => {
        const matched = String(line || '').match(/^\s*休憩\s*\d+\s*:\s*([01]\d|2[0-3]):([0-5]\d)\s*-\s*([01]\d|2[0-3]):([0-5]\d)\s*$/);
        return matched ? { start: `${matched[1]}:${matched[2]}`, end: `${matched[3]}:${matched[4]}` } : null;
      })
      .filter(Boolean);
  }

  function _stShiftBaseId(value) {
    const raw = String(value || '');
    const stripped = raw.startsWith('shift:') ? raw.slice('shift:'.length) : raw;
    return stripped.split(':break:')[0];
  }

  function _stNewShiftId() {
    return 'shift_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
  }

  function _stShiftTypeLabel(type) {
    return { work: '勤務', off: '休み', holiday: '祝日' }[type] || type || 'シフト';
  }

  function _stShiftEndDate(dateStr, startTime, endTime, allDay) {
    if (allDay || !dateStr || !startTime || !endTime || endTime > startTime) return dateStr;
    const date = new Date(dateStr + 'T00:00');
    if (Number.isNaN(date.getTime())) return dateStr;
    date.setDate(date.getDate() + 1);
    return [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0'),
    ].join('-');
  }

  function _stShiftCalendar(component, user) {
    const selected = component?._selectedCalendar?.();
    if (selected?.source === 'shift' && (!user || selected.user === user)) return selected;
    return (component?._calendars || []).find(cal => cal.source === 'shift' && (!user || cal.user === user)) || selected || null;
  }

  function _stShiftRow(shift) {
    const type = String(shift?.type || 'work');
    const normalizedBreaks = _stNormalizeBreaks(shift?.breaks);
    const breaks = normalizedBreaks.length ? normalizedBreaks : _stBreaksFromNote(shift?.note);
    return {
      id: String(shift?.id || ''),
      user: String(shift?.user || 'anonymous'),
      date: String(shift?.date || ''),
      start_time: type === 'work' ? String(shift?.start_time || '09:00') : '',
      end_time: type === 'work' ? String(shift?.end_time || '18:00') : '',
      type,
      note: String(shift?.note || ''),
      breaks,
      _optimistic: !!shift?._optimistic,
    };
  }

  function _stShiftEvents(component, shift) {
    const row = _stShiftRow(shift);
    const cal = _stShiftCalendar(component, row.user);
    const allDay = row.type === 'work' && row.start_time ? 0 : 1;
    const startTime = row.start_time || '00:00';
    const endTime = row.end_time || startTime;
    const endDate = _stShiftEndDate(row.date, startTime, endTime, allDay);
    const common = {
      description: row.note,
      location: '',
      url: '',
      recurrence: '',
      external_id: row.id,
      user: row.user,
      creator: row.user,
      members: [],
      calendar_id: cal?.id || '',
      alert_minutes: -1,
      _optimistic: row._optimistic,
    };
    const events = [{
      id: 'shift:' + row.id,
      title: `シフト ${row.user}: ${_stShiftTypeLabel(row.type)}`,
      start: allDay ? row.date : `${row.date}T${startTime}`,
      end: allDay ? row.date : `${endDate}T${endTime}`,
      all_day: allDay,
      color: 'var(--cal-shift-work-bg, #d19a66)',
      calendar_source: 'shift',
      ...common,
    }];
    if (!allDay) {
      _stNormalizeBreaks(row.breaks).forEach((item, index) => {
        const breakEndDate = _stShiftEndDate(row.date, item.start, item.end, 0);
        events.push({
          id: `shift:${row.id}:break:${index + 1}`,
          title: `休憩 ${row.user}: 休憩${index + 1}`,
          start: `${row.date}T${item.start}`,
          end: `${breakEndDate}T${item.end}`,
          all_day: 0,
          color: 'var(--cal-shift-break-bg, #6a9ad1)',
          calendar_source: 'shift-break',
          ...common,
        });
      });
    }
    return events;
  }

  function _stShiftSnapshot(component) {
    return {
      shifts: (component?._shifts || []).map(item => ({ ...item })),
      events: (component?._events || []).map(item => ({ ...item })),
      selected: component?._eventSelection ? [...component._eventSelection()] : [],
      last: component?._lastSelectedEventId || '',
    };
  }

  function _stRestoreShiftSnapshot(component, snapshot) {
    if (!component || !snapshot) return;
    component._shifts = (snapshot.shifts || []).map(item => ({ ...item }));
    component._events = (snapshot.events || []).map(item => ({ ...item }));
    component._setSelectedEvents?.(snapshot.selected || [], snapshot.last || '');
    component._renderCalendarList?.();
    component._render?.();
  }

  function _stBreakLabel(breaks) {
    const normalized = _stNormalizeBreaks(breaks);
    return normalized.length
      ? normalized.map((item, index) => `休憩${index + 1} ${item.start}-${item.end}`).join(' / ')
      : '休憩なし';
  }

  function _stTemplateLine(template) {
    const entry = _stShiftEntry(template);
    if (!entry) return '';
    return `${entry.teamName || 'ワークスペース未設定'} ${entry.workStart || '--:--'}-${entry.workEnd || '--:--'} / ${_stBreakLabel(entry.breaks)}`;
  }

  async function _stLoadTeams(component) {
    if (typeof component?._loadTeamGroups === 'function') {
      try { return await component._loadTeamGroups(); } catch { return null; }
    }
    return [];
  }

  function _stBreakRowHtml(item = {}, index = 0) {
    const label = `休憩${index + 1}`;
    return `<div class="gb-cal-shift-break-row" data-cal-shift-break-row>
      <span class="gb-cal-shift-break-label">${label}</span>
      ${_stTimeControlHtml('break-start', item.start || '', label + '開始', true)}
      ${_stTimeControlHtml('break-end', item.end || '', label + '終了', true)}
      <button type="button" data-cal-shift-break-remove title="休憩を削除" aria-label="${_stEsc(label)}を削除"><span class="gb-cal-shift-break-remove-mark" aria-hidden="true">×</span></button>
    </div>`;
  }

  function _stBreakRowsHtml(breaks) {
    return (breaks || []).map((item, index) => _stBreakRowHtml(item, index)).join('');
  }

  function _stRenumberBreakRows(root) {
    root.querySelectorAll('[data-cal-shift-break-row]').forEach((row, index) => {
      const label = row.querySelector('.gb-cal-shift-break-label');
      const start = row.querySelector('[data-cal-shift-time="break-start"]');
      const end = row.querySelector('[data-cal-shift-time="break-end"]');
      const remove = row.querySelector('[data-cal-shift-break-remove]');
      const name = `休憩${index + 1}`;
      if (label) label.textContent = name;
      _stUpdateTimeLabel(start, name + '開始');
      _stUpdateTimeLabel(end, name + '終了');
      if (remove) remove.setAttribute('aria-label', name + 'を削除');
    });
  }

  function _stPositionMenu(menu, anchor) {
    document.body.appendChild(menu);
    if (typeof positionPopup === 'function' && anchor?.getBoundingClientRect) {
      positionPopup(menu, anchor.getBoundingClientRect());
      return;
    }
    const rect = anchor?.getBoundingClientRect?.() || { left: 20, bottom: 20, top: 20, right: 20 };
    const z = typeof _getZoom === 'function' ? _getZoom() : 1;
    menu.style.left = (rect.left / z) + 'px';
    menu.style.top = (rect.bottom / z + 4) + 'px';
    if (typeof clampPopupToViewport === 'function') clampPopupToViewport(menu);
  }

  CalendarComponent.prototype._isShiftScheduleTemplate = function(template) {
    return !!_stShiftEntry(template);
  };

  CalendarComponent.prototype._newShiftId = function() {
    return _stNewShiftId();
  };

  CalendarComponent.prototype._shiftMutationSnapshot = function() {
    return _stShiftSnapshot(this);
  };

  CalendarComponent.prototype._restoreShiftMutationSnapshot = function(snapshot) {
    _stRestoreShiftSnapshot(this, snapshot);
  };

  CalendarComponent.prototype._upsertShiftOptimistic = function(shift, options = {}) {
    const row = _stShiftRow(shift);
    if (!row.id || !row.date) return '';
    const events = _stShiftEvents(this, row);
    const event = events[0];
    this._shifts = [...(this._shifts || []).filter(item => item?.id !== row.id), row].sort((a, b) =>
      String(a.date || '').localeCompare(String(b.date || '')) ||
      String(a.start_time || '').localeCompare(String(b.start_time || '')) ||
      String(a.user || '').localeCompare(String(b.user || ''))
    );
    this._events = [
      ...(this._events || []).filter(item => item?.id !== event.id && !String(item?.id || '').startsWith(event.id + ':break:')),
      ...events,
    ];
    if (options.select !== false) this._setSelectedEvents?.([event.id], event.id);
    return event.id;
  };

  CalendarComponent.prototype._removeShiftOptimistic = function(id) {
    const shiftId = _stShiftBaseId(id);
    const eventId = 'shift:' + shiftId;
    this._shifts = (this._shifts || []).filter(item => item?.id !== shiftId);
    this._events = (this._events || []).filter(item =>
      item?.id !== eventId &&
      !String(item?.id || '').startsWith(eventId + ':break:') &&
      !(['shift', 'shift-break'].includes(String(item?.calendar_source || '')) && item?.external_id === shiftId)
    );
    this._eventSelection?.().delete(eventId);
    [...(this._eventSelection?.() || [])].forEach(selectedId => {
      if (String(selectedId || '').startsWith(eventId + ':break:')) this._eventSelection?.().delete(selectedId);
    });
    if (this._lastSelectedEventId === eventId) this._lastSelectedEventId = '';
  };

  CalendarComponent.prototype._refreshShiftStateAfterMutation = async function(options = {}) {
    const run = fn => (typeof fn === 'function' ? Promise.resolve().then(() => fn.call(this)) : Promise.resolve());
    await Promise.all([run(this._loadShifts), run(this._loadEvents), run(this._loadCalendars)]);
    this._shiftMutationStateUnknown = false;
    if (options.renderCalendarList !== false) this._renderCalendarList?.();
    this._render?.();
  };

  CalendarComponent.prototype._reconcileShiftMutationAfterError = async function(id, operation, expected = {}) {
    try {
      await this._refreshShiftStateAfterMutation();
    } catch (error) {
      this._shiftMutationStateUnknown = true;
      console.error('シフト保存結果の再確認に失敗しました', error);
      return 'unknown';
    }
    const current = (this._shifts || []).find(item => String(item?.id || '') === String(id || ''));
    if (operation === 'delete') return current ? 'not-applied' : 'applied';
    if (!current) return 'not-applied';
    const fields = ['user', 'date', 'start_time', 'end_time', 'type', 'note'];
    return fields.every(field => String(current?.[field] || '') === String(expected?.[field] || ''))
      ? 'applied'
      : 'not-applied';
  };

  CalendarComponent.prototype._loadShiftScheduleTemplates = async function() {
    const templates = await apiFetch('/cal/schedule-templates?user=' + encodeURIComponent(this._getUser()));
    return (templates || []).filter(template => this._isShiftScheduleTemplate(template));
  };

  CalendarComponent.prototype._renderShiftTemplateSettings = function(settingsBody) {
    const body = settingsBody || this._calendarSettingsBody;
    if (!body) return;
    const token = (this._shiftTemplateSettingsSeq || 0) + 1;
    this._shiftTemplateSettingsSeq = token;
    let field = body.querySelector('[data-cal-shift-template-settings]');
    if (!field) {
      field = document.createElement('div');
      field.className = 'cal-option-field gb-cal-shift-template-settings';
      field.dataset.calShiftTemplateSettings = '1';
      const actions = body.querySelector('.cal-option-actions');
      if (actions) body.insertBefore(field, actions);
      else body.appendChild(field);
    }
    field.innerHTML = '<label>シフト勤務テンプレート</label><div class="gb-section-desc">読み込み中...</div>';
    this._loadShiftScheduleTemplates().then(templates => {
      if (token !== this._shiftTemplateSettingsSeq || !field.isConnected) return;
      const rows = templates.length
        ? templates.map(template => {
          const name = template.name || '無題';
          return `<div class="gb-cal-shift-template-row" data-cal-shift-template-id="${_stEsc(template.id)}">
            <div>
              <strong>${_stEsc(name)}</strong>
              <span>${_stEsc(_stTemplateLine(template))}</span>
            </div>
            <button type="button" data-cal-shift-template-edit="${_stEsc(template.id)}" aria-label="${_stEsc(name)}を編集" title="${_stEsc(name)}を編集">${_stIcon('pencil', 14)}</button>
            <button type="button" data-cal-shift-template-delete="${_stEsc(template.id)}" aria-label="${_stEsc(name)}を削除" title="${_stEsc(name)}を削除">${_stIcon('trash2', 14)}</button>
          </div>`;
        }).join('')
        : '<div class="gb-section-desc">テンプレートがありません。</div>';
      field.innerHTML = `
        <label>シフト勤務テンプレート</label>
        <div class="gb-cal-shift-template-list">${rows}</div>
        <button type="button" class="gb-cal-shift-template-add" data-cal-shift-template-new aria-label="シフト勤務テンプレートを追加" title="シフト勤務テンプレートを追加">${_stIcon('plus', 14)} テンプレート追加</button>`;
      field.querySelectorAll('[data-cal-shift-template-new],[data-cal-shift-template-edit],[data-cal-shift-template-delete]').forEach(button => {
        button.style.minHeight = '44px';
        if (!button.hasAttribute('data-cal-shift-template-new')) button.style.minWidth = '44px';
      });
      field.querySelector('[data-cal-shift-template-new]')?.addEventListener('click', () => this._showShiftTemplateEditor(null));
      field.querySelectorAll('[data-cal-shift-template-edit]').forEach(btn => {
        const template = templates.find(item => item.id === btn.dataset.calShiftTemplateEdit);
        btn.addEventListener('click', () => this._showShiftTemplateEditor(template));
      });
      field.querySelectorAll('[data-cal-shift-template-delete]').forEach(btn => {
        btn.addEventListener('click', async () => {
          if (typeof cfConfirm === 'function' && !await cfConfirm('このシフト勤務テンプレートを削除しますか？', { danger: true, okLabel: '削除' })) return;
          await apiFetch('/cal/schedule-templates/' + encodeURIComponent(btn.dataset.calShiftTemplateDelete), { method: 'DELETE' });
          this._renderShiftTemplateSettings(body);
          this._showStatus?.('シフト勤務テンプレートを削除しました');
        });
      });
    }).catch(() => {
      if (token !== this._shiftTemplateSettingsSeq || !field.isConnected) return;
      field.innerHTML = '<label>シフト勤務テンプレート</label><div class="gb-section-desc">テンプレートを読み込めませんでした。</div>';
    });
  };

  CalendarComponent.prototype._showShiftTemplateEditor = async function(template) {
    const teams = await _stLoadTeams(this);
    const teamLoadFailed = teams === null;
    const teamList = Array.isArray(teams) ? teams : [];
    const entry = { ..._stDefaultEntry(this), ...(_stShiftEntry(template) || {}) };
    // 休憩なしで保存した既存テンプレートに既定休憩（12:00-13:00）を復活させない
    // （既定休憩の補完は新規作成時のみ）
    const breaks = template?.id
      ? (Array.isArray(entry.breaks) ? entry.breaks : [])
      : (Array.isArray(entry.breaks) && entry.breaks.length ? entry.breaks : _stDefaultEntry(this).breaks);
    const savedTeamFolder = String(entry.teamFolder || '');
    const savedTeamInList = !savedTeamFolder || teamList.some(team => String(team.folder || '') === savedTeamFolder);
    // 保存済みワークスペースが一覧に無い場合、先頭ワークスペースへ黙ってすり替わらないよう保持用の選択肢を追加する
    const savedTeamOption = savedTeamInList
      ? ''
      : `<option value="${_stEsc(savedTeamFolder)}" selected>（現在の一覧に無いワークスペース: ${_stEsc(entry.teamName || savedTeamFolder)}）</option>`;
    const teamOptions = (teamList.length || savedTeamOption) ? savedTeamOption + teamList.map(team => {
      const value = String(team.folder || '');
      const selected = value === String(entry.teamFolder || '') ? ' selected' : '';
      return `<option value="${_stEsc(value)}"${selected}>${_stEsc(team.label || value || 'ワークスペース')}</option>`;
    }).join('') : `<option value="">${teamLoadFailed ? 'ワークスペースを読み込めませんでした' : 'ワークスペースを設定してください'}</option>`;
    const content = document.createElement('div');
    content.innerHTML = `<div class="gb-cal-shift-template-form"><div role="status" aria-live="polite" data-cal-shift-template-status></div>
      <div class="field"><label>名前</label><input class="gb-input" data-cal-shift-template-name type="text" aria-label="シフト勤務テンプレート名" value="${_stEsc(template?.name || '標準勤務')}"></div>
      <div class="field"><label>ワークスペース</label><select class="gb-select" data-cal-shift-template-team aria-label="ワークスペース">${teamOptions}</select></div>
      ${teamLoadFailed ? '<div class="gb-section-desc">ワークスペース一覧を読み込めませんでした。保存済みのワークスペースは維持できます。</div>' : ''}
      <div class="gb-cal-shift-work-grid">
        <div class="field"><label>勤務開始</label>${_stTimeControlHtml('work-start', entry.workStart || '09:00', '勤務開始')}</div>
        <div class="field"><label>勤務終了</label>${_stTimeControlHtml('work-end', entry.workEnd || '18:00', '勤務終了')}</div>
      </div>
      <div class="field">
        <label>休憩</label>
        <div class="gb-cal-shift-break-head"><span></span><span>開始</span><span>終了</span><span></span></div>
        <div class="gb-cal-shift-break-list" data-cal-shift-break-list>${_stBreakRowsHtml(breaks)}</div>
        <button type="button" data-cal-shift-break-add aria-label="休憩を追加" title="休憩を追加">${_stIcon('plus', 14)} 休憩追加</button>
      </div></div>`;
    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'gb-btn gb-btn-sm';
    cancelBtn.dataset.calShiftTemplateCancel = '';
    cancelBtn.textContent = 'キャンセル';
    const saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.className = 'gb-btn gb-btn-sm gb-btn-primary primary';
    saveBtn.dataset.calShiftTemplateSave = '';
    saveBtn.textContent = '保存';
    let saving = false;
    // GBUI共通controllerが role="dialog" aria-modal="true" aria-labelledby="gb-cal-shift-template-title" を付与する。
    const modalApi = window.GBUI.createModal({
      id: 'calendar-shift-template-editor',
      title: template?.id ? 'シフト勤務テンプレート編集' : 'シフト勤務テンプレート追加',
      titleId: 'gb-cal-shift-template-title',
      body: [...content.childNodes],
      footer: [cancelBtn, saveBtn],
      variant: 'standard',
      geometryKey: 'calendar-shift-template-editor',
      minWidth: '0',
      initialFocus: '[data-cal-shift-template-name]',
      closeLabel: 'シフト勤務テンプレート編集を閉じる',
      closeOnEsc: true,
      closeOnOverlay: true,
      onBeforeClose: () => !saving,
      onClose: () => _stCloseTimeMenus(),
    });
    const overlay = modalApi.overlay;
    const panel = modalApi.modal;
    modalApi.body.style.setProperty('overflow-x', 'hidden', 'important');
    modalApi.body.style.minWidth = '0';
    modalApi.body.style.overflowWrap = 'anywhere';
    overlay.dataset.e2eId = 'calendar-shift-template-editor-overlay';
    overlay._calendarClose = modalApi.close;
    panel.classList.add('gb-cal-shift-template-modal');
    panel.dataset.e2eId = 'calendar-shift-template-editor-dialog';
    panel.style.cssText = _stModalSizeStyle(520);
    const applyEditorLayout = () => {
      const form = panel.querySelector('.gb-cal-shift-template-form');
      if (form) {
        form.style.display = 'grid';
        form.style.gap = '12px';
        form.style.minWidth = '0';
      }
      panel.querySelectorAll('.field').forEach(field => {
        field.style.display = 'grid';
        field.style.gap = '6px';
        field.style.minWidth = '0';
        const label = field.querySelector(':scope > label');
        if (label) label.style.display = 'block';
      });
      const workGrid = panel.querySelector('.gb-cal-shift-work-grid');
      if (workGrid) {
        workGrid.style.display = 'grid';
        workGrid.style.gridTemplateColumns = window.innerWidth <= 640 ? 'minmax(0,1fr)' : 'repeat(2,minmax(0,1fr))';
        workGrid.style.gap = '8px';
        workGrid.style.minWidth = '0';
      }
      panel.querySelectorAll('.gb-cal-shift-break-head,[data-cal-shift-break-row]').forEach(row => {
        row.style.display = 'grid';
        row.style.gridTemplateColumns = 'minmax(52px,auto) minmax(0,1fr) minmax(0,1fr) 44px';
        row.style.gap = '6px';
        row.style.alignItems = 'center';
        row.style.minWidth = '0';
      });
      panel.querySelectorAll('[data-cal-shift-time-control]').forEach(control => {
        control.style.display = 'grid';
        control.style.gridTemplateColumns = 'minmax(0,1fr) 44px';
        control.style.minWidth = '0';
      });
      panel.querySelectorAll('input,select,textarea').forEach(control => {
        control.style.width = '100%';
        control.style.minWidth = '0';
        control.style.maxWidth = '100%';
        control.style.boxSizing = 'border-box';
      });
      panel.querySelectorAll('button').forEach(button => { button.style.minHeight = '44px'; });
      panel.querySelectorAll('[data-cal-shift-time-menu],[data-cal-shift-break-remove]').forEach(button => {
        button.style.width = '44px';
        button.style.minWidth = '44px';
        button.style.paddingInline = '0';
      });
      const addBreak = panel.querySelector('[data-cal-shift-break-add]');
      if (addBreak) { addBreak.style.width = '100%'; addBreak.style.maxWidth = '100%'; }
    };
    applyEditorLayout();
    const status = panel.querySelector('[data-cal-shift-template-status]');
    modalApi.open();
    const bindBreakDeletes = () => {
      panel.querySelectorAll('[data-cal-shift-break-remove]').forEach(btn => {
        if (btn._calShiftBreakBound) return;
        btn._calShiftBreakBound = true;
        btn.addEventListener('click', () => {
          btn.closest('[data-cal-shift-break-row]')?.remove();
          _stRenumberBreakRows(panel);
        });
      });
    };
    bindBreakDeletes();
    _stBindTimeControls(panel);
    panel.querySelector('[data-cal-shift-break-add]')?.addEventListener('click', () => {
      const list = panel.querySelector('[data-cal-shift-break-list]');
      const index = list?.querySelectorAll('[data-cal-shift-break-row]').length || 0;
      list?.insertAdjacentHTML('beforeend', _stBreakRowHtml({}, index));
      applyEditorLayout();
      bindBreakDeletes();
      _stBindTimeControls(panel);
      _stRenumberBreakRows(panel);
    });
    cancelBtn.addEventListener('click', () => modalApi.close('cancel'));
    saveBtn.addEventListener('click', async () => {
      if (saving) return;
      const name = panel.querySelector('[data-cal-shift-template-name]')?.value.trim() || '標準勤務';
      const teamSelect = panel.querySelector('[data-cal-shift-template-team]');
      const workStart = _stReadTime(panel, 'work-start');
      const workEnd = _stReadTime(panel, 'work-end');
      if (!_stValidTime(workStart) || !_stValidTime(workEnd)) {
        this._showStatus?.('勤務時間を確認してください', true);
        return;
      }
      const breakRows = [...panel.querySelectorAll('[data-cal-shift-break-row]')].map(row => {
        const start = _stReadTimeState(row, 'break-start');
        const end = _stReadTimeState(row, 'break-end');
        return { start: start.value, end: end.value, partial: start.partial || end.partial };
      });
      const invalidBreak = breakRows.some(item => item.partial || ((item.start || item.end) && (!_stValidTime(item.start) || !_stValidTime(item.end))));
      if (invalidBreak) {
        this._showStatus?.('休憩時間を確認してください', true);
        return;
      }
      const selectedTeam = teamList.find(team => String(team.folder || '') === String(teamSelect?.value || '')) || {};
      if (!selectedTeam.workspaceId && !String(teamSelect?.value || '')) {
        this._showStatus?.(teamLoadFailed ? 'ワークスペース一覧を読み込めませんでした。時間をおいて再度お試しください' : 'ワークスペースを選択してください', true);
        return;
      }
      saving = true;
      panel.setAttribute('aria-busy', 'true');
      overlay.classList.add('gb-cal-shift-template-saving');
      if (status) status.textContent = '保存中...';
      if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.textContent = '保存中...';
      }
      if (cancelBtn) cancelBtn.disabled = true;
      const payload = {
        name,
        user: this._getUser(),
        entries: [{
          kind: SHIFT_TEMPLATE_KIND,
          teamFolder: String(teamSelect?.value || ''),
          // ワークスペースを選び直していない場合は、保存済みの紐づけ（ID・表示名）を維持する
          workspaceId: (String(teamSelect?.value || '') === String(entry.teamFolder || '') && entry.workspaceId)
            ? entry.workspaceId
            : (selectedTeam.workspaceId || String(teamSelect?.value || '')),
          teamName: (String(teamSelect?.value || '') === String(entry.teamFolder || '') && entry.teamName)
            ? entry.teamName
            : (selectedTeam.label || teamSelect?.selectedOptions?.[0]?.textContent || 'ワークスペース'),
          workStart,
          workEnd,
          breaks: _stNormalizeBreaks(breakRows),
        }],
      };
      try {
        if (template?.id) await apiPut('/cal/schedule-templates/' + encodeURIComponent(template.id), payload);
        else await apiPost('/cal/schedule-templates', payload);
      } catch (error) {
        saving = false;
        panel.setAttribute('aria-busy', 'false');
        overlay.classList.remove('gb-cal-shift-template-saving');
        if (saveBtn) {
          saveBtn.disabled = false;
          saveBtn.textContent = '保存';
        }
        if (cancelBtn) cancelBtn.disabled = false;
        if (status) status.textContent = '保存に失敗しました。入力内容を保ったまま再試行できます。';
        this._showStatus?.('シフト勤務テンプレートの保存に失敗しました: ' + (error?.message || error), true);
        return;
      }
      saving = false;
      panel.setAttribute('aria-busy', 'false');
      overlay.classList.remove('gb-cal-shift-template-saving');
      modalApi.close('saved');
      let renderFailed = false;
      try { this._renderShiftTemplateSettings?.(this._calendarSettingsBody); }
      catch (error) {
        renderFailed = true;
        this._showStatus?.('テンプレートは保存しましたが、一覧を更新できませんでした。設定画面を開き直してください: ' + (error?.message || error), true);
      }
      if (!renderFailed) this._showStatus?.('シフト勤務テンプレートを保存しました');
    });
  };

  CalendarComponent.prototype._handleShiftCalendarDayClick = function(dateStr, anchorEl) {
    const cal = this._selectedCalendar?.();
    if (this._view !== 'month') return false;
    if (!cal || cal.source !== 'shift') return false;
    this._openShiftTemplatePickerForDate(dateStr, anchorEl);
    return true;
  };

  CalendarComponent.prototype._openShiftTemplatePickerForDate = async function(dateStr, anchorEl) {
    let templates = [];
    try { templates = await this._loadShiftScheduleTemplates(); } catch {}
    if (!templates.length) {
      this._showStatus?.('シフト勤務テンプレートを設定してください', true);
      this._showCalendarSettingsPanel?.();
      return;
    }
    if (templates.length === 1) {
      await this._applyShiftTemplateToDate(templates[0], dateStr);
      return;
    }
    document.querySelectorAll('.gb-cal-shift-template-picker').forEach(menu => menu.remove());
    const menu = document.createElement('div');
    menu.className = 'gb-context-menu gb-cal-shift-template-picker';
    menu.style.position = 'fixed';
    menu.style.zIndex = '10003';
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', 'シフト勤務テンプレート');
    templates.forEach(template => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'gb-context-menu-item';
      btn.setAttribute('role', 'menuitem');
      btn.setAttribute('aria-label', `${template.name || '無題'}を適用`);
      btn.innerHTML = `<span>${_stEsc(template.name || '無題')}</span><span class="menu-shortcut">${_stEsc(_stTemplateLine(template))}</span>`;
      btn.addEventListener('click', async event => {
        event.preventDefault();
        event.stopPropagation();
        closeMenu();
        await this._applyShiftTemplateToDate(template, dateStr);
      });
      menu.appendChild(btn);
    });
    _stPositionMenu(menu, anchorEl);
    let cleanup = null;
    const closeMenu = () => {
      cleanup?.();
      menu.remove();
      anchorEl?.focus?.();
    };
    setTimeout(() => {
      const close = event => {
        if (!menu.contains(event.target)) {
          closeMenu();
        }
      };
      const keyClose = event => {
        if (event.key === 'Escape') {
          event.preventDefault();
          closeMenu();
        }
      };
      document.addEventListener('pointerdown', close, true);
      document.addEventListener('keydown', keyClose, true);
      cleanup = () => {
        document.removeEventListener('pointerdown', close, true);
        document.removeEventListener('keydown', keyClose, true);
      };
    }, 0);
  };

  CalendarComponent.prototype._applyShiftTemplateToDate = async function(template, dateStr) {
    if (this._shiftMutationStateUnknown) {
      this._showStatus?.('前回のシフト保存結果を確認できません。カレンダーを再読み込みしてください', true);
      return;
    }
    const entry = _stShiftEntry(template);
    if (!entry || !_stValidTime(entry.workStart) || !_stValidTime(entry.workEnd)) {
      this._showStatus?.('シフト勤務テンプレートの勤務時間を確認してください', true);
      return;
    }
    const cal = this._selectedCalendar?.();
    const user = cal?.user || this._getUser();
    const breaks = _stNormalizeBreaks(entry.breaks);
    const noteLines = [
      `テンプレート: ${template.name || '無題'}`,
      `ワークスペース: ${entry.teamName || 'ワークスペース'}`,
      `勤務: ${entry.workStart}-${entry.workEnd}`,
      ...breaks.map((item, index) => `休憩${index + 1}: ${item.start}-${item.end}`),
    ];
    const shiftId = this._newShiftId?.() || _stNewShiftId();
    const shift = {
      id: shiftId,
      user,
      date: dateStr,
      start_time: entry.workStart,
      end_time: entry.workEnd,
      type: 'work',
      note: noteLines.join('\n'),
      breaks,
      _optimistic: true,
    };
    const snapshot = this._shiftMutationSnapshot?.() || _stShiftSnapshot(this);
    const eventId = this._upsertShiftOptimistic?.(shift, { select: true });
    this._renderCalendarList?.();
    this._render?.();
    let acknowledged = false;
    try {
      const res = await apiPost('/cal/shifts', {
        id: shiftId,
        user,
        date: dateStr,
        start_time: entry.workStart,
        end_time: entry.workEnd,
        type: 'work',
        note: shift.note,
      });
      acknowledged = true;
      const savedId = res?.id || shiftId;
      if (savedId !== shiftId) this._removeShiftOptimistic?.(shiftId);
      this._upsertShiftOptimistic?.({ ...shift, id: savedId, breaks, _optimistic: false }, { select: !!eventId });
      this._renderCalendarList?.();
      this._render?.();
      await this._refreshShiftStateAfterMutation?.();
      this._showStatus?.('シフトを追加しました');
    } catch (error) {
      if (acknowledged) {
        console.error('保存済みシフトの再読込に失敗しました', error);
        this._showStatus?.('シフトは保存されましたが、再読み込みに失敗しました', true);
        return;
      }
      const outcome = await this._reconcileShiftMutationAfterError?.(shiftId, 'create', shift);
      if (outcome === 'applied') {
        this._showStatus?.('シフトを追加しました');
      } else if (outcome === 'unknown') {
        this._showStatus?.('シフト追加結果を確認できません。カレンダーを再読み込みしてください', true);
      } else {
        this._restoreShiftMutationSnapshot?.(snapshot);
        this._showStatus?.('シフト追加に失敗しました', true);
      }
    }
  };
})();
