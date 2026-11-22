        option.textContent = opt.label;
        select.appendChild(option);
      });
      const currentValue = String(cal.folder || '');
      select.value = currentValue;
      if (currentValue && select.value !== currentValue) {
        const custom = document.createElement('option');
        custom.value = currentValue;
        custom.textContent = '未登録ワークスペース';
        select.appendChild(custom);
        select.value = custom.value;
      } else if (!currentValue && opts.length && !opts[0].disabled) {
        select.value = opts[0].value;
      }
    }).catch(() => {
      select.innerHTML = '';
      const option = document.createElement('option');
      option.value = cal.folder || '';
      option.textContent = cal.folder ? '未登録ワークスペース' : 'ワークスペースを読み込めませんでした';
      option.disabled = !cal.folder;
      select.appendChild(option);
    });
    return row;
  };

  CalendarComponent.prototype._loadAttendanceSourceChoices = async function() {
    if (typeof this._loadTeamGroups === 'function') {
      try {
        const groups = await this._loadTeamGroups();
        if ((groups || []).length) return groups.map(group => ({ path: String(group.folder || ''), label: group.label || 'ワークスペース' }));
      } catch {}
    }
    return [];
  };

  CalendarComponent.prototype._loadAttendanceTeamGroups = async function() {
    const groups = await this._loadTeamGroups();
    const hidden = _calAttReadHiddenSourceFolders();
    return (groups || []).filter(group => !hidden.has(String(group?.folder || '')));
  };

  CalendarComponent.prototype._renderAttendanceSourceSettings = function(settingsBody) {
    const body = settingsBody || this._calendarSettingsBody;
    if (!body) return;
    const token = (this._attendanceSourceSettingsSeq || 0) + 1;
    this._attendanceSourceSettingsSeq = token;
    let field = body.querySelector('[data-cal-attendance-source-settings]');
    if (!field) {
      field = document.createElement('div');
      field.className = 'cal-option-field';
      field.dataset.calAttendanceSourceSettings = '1';
      const actions = body.querySelector('.cal-option-actions');
      if (actions) body.insertBefore(field, actions);
      else body.appendChild(field);
    }
    field.innerHTML = '<label>出退勤状況に表示するワークスペース</label><div class="gb-section-desc">読み込み中...</div>';
    this._loadAttendanceSourceChoices().then(choices => {
      if (token !== this._attendanceSourceSettingsSeq || !field.isConnected) return;
      const hidden = _calAttReadHiddenSourceFolders();
      if (!choices.length) {
        field.innerHTML = `
          <label>出退勤状況に表示するワークスペース</label>
          <div class="gb-section-desc">ワークスペースを設定すると、出退勤状況にメンバーを表示できます。</div>`;
        return;
      }
      const rows = choices.map(choice => {
        const path = String(choice.path || '');
        const slug = _calAttStableSlug(path || 'workspace');
        return `<label class="cal-option-member" title="${_calAttEsc(path || 'ワークスペース')}">
          <input type="checkbox" data-cal-attendance-source="${_calAttEsc(path)}" data-e2e-id="cal-attendance-source-${slug}" aria-label="${_calAttEsc(choice.label)}" ${hidden.has(path) ? '' : 'checked'}>
          <span>${_calAttEsc(choice.label)}</span>
        </label>`;
      }).join('');
      field.innerHTML = `
        <label>出退勤状況に表示するワークスペース ${fieldHelp('チェックを外したワークスペースのメンバーは、出退勤状況に表示しません。')}</label>
        <div class="cal-option-members" data-cal-attendance-source-list>${rows}</div>`;
      field.querySelectorAll('[data-cal-attendance-source]').forEach(input => {
        input.addEventListener('change', () => {
          const before = _calAttCaptureSourceSettingsHistory();
          const nextHidden = _calAttReadHiddenSourceFolders();
          const sourcePath = String(input.dataset.calAttendanceSource || '');
          if (input.checked) nextHidden.delete(sourcePath);
          else nextHidden.add(sourcePath);
          _calAttWriteHiddenSourceFolders(nextHidden);
          _calAttPushSourceSettingsHistory(before, input.checked ? '表示する' : '表示しない');
          this._renderAttendanceStatus();
        });
      });
    }).catch(() => {
      if (token !== this._attendanceSourceSettingsSeq || !field.isConnected) return;
      field.innerHTML = '<label>出退勤状況に表示するワークスペース</label><div class="gb-section-desc">ワークスペースを読み込めませんでした。</div>';
    });
  };

  // 色見本は選んだ時点で新しい色になるため、保存に失敗したら元の色へ戻す。
  function _calAttRestoreSwatch(swatch, color) {
    if (!swatch || !color) return;
    if (typeof setColorSwatchValue === 'function') setColorSwatchValue(swatch, color);
    else { swatch.dataset.color = color; swatch.style.background = color; }
  }

  CalendarComponent.prototype._setCalendarColor = async function(cal, color, options = {}) {
    const previousColor = cal?.color || '';
    if (!this._calUserCanEditCalendar(cal)) {
      _calAttRestoreSwatch(options.swatch, previousColor);
      this._showStatus('編集権限がありません', true);
      return false;
    }
    const next = String(color || '').trim();
    if (!next) {
      _calAttRestoreSwatch(options.swatch, previousColor);
      return false;
    }
    try {
      await (globalThis.MeldexDiagnostics?.watchScheduleTask || ((op, task) => task))('calendar-save', apiPut('/cal/calendars/' + encodeURIComponent(cal.id) + '?_user=' + encodeURIComponent(this._getUser()), { color: next }));
    } catch (error) {
      _calAttRestoreSwatch(options.swatch, previousColor);
      const detail = String(error?.userMessage || error?.message || '').trim();
      this._showStatus(detail ? `色の更新に失敗しました: ${detail}` : '色の更新に失敗しました', true);
      return false;
    }
    cal.color = next;
    // 一覧取得時の有効色はサーバー側で解決されるが、色変更直後は手元の
    // イベント配列を再描画するため、継承イベントだけを先に同期する。
    (this._events || []).forEach(event => {
      if (event?.calendar_id !== cal.id) return;
      if (event.uses_calendar_color === false || String(event.color_override || '').trim()) return;
      event.color = next;
      event.uses_calendar_color = true;
    });
    this._renderCalendarList();
    this._render();
    this._showStatus('カレンダーの色を更新しました');
    return true;
  };

  CalendarComponent.prototype._setCalendarFolder = async function(cal, value) {
    if (!this._calUserCanEditCalendar(cal)) {
      this._showStatus('編集権限がありません', true);
      return;
    }
    const folder = String(value || '').trim() || _calAttFolderFallbackForSource(cal?.source);
    try {
      await (globalThis.MeldexDiagnostics?.watchScheduleTask || ((op, task) => task))('calendar-save', apiPut('/cal/calendars/' + encodeURIComponent(cal.id) + '?_user=' + encodeURIComponent(this._getUser()), { folder }));
      cal.folder = folder;
      this._renderCalendarList();
      this._showStatus('フォルダを更新しました');
    } catch {
      this._showStatus('フォルダ変更に失敗', true);
    }
  };

  // 選択欄は選んだ時点で新しい値になるため、保存できなかった時は元の権限へ戻す。
  CalendarComponent.prototype._setCalendarRole = async function(cal, role, options = {}) {
    const control = options.control || null;
    const previousRole = cal?.edit_role || 'owner';
    const restore = () => { if (control) control.value = previousRole; };
    if (!this._calUserIsAdmin()) {
      restore();
      this._showStatus('管理者のみ変更できます', true);
      return false;
    }
    try {
      await (globalThis.MeldexDiagnostics?.watchScheduleTask || ((op, task) => task))('calendar-save', apiPut('/cal/calendars/' + encodeURIComponent(cal.id) + '?_user=' + encodeURIComponent(this._getUser()), { edit_role: role }));
    } catch (error) {
      restore();
      const detail = String(error?.userMessage || error?.message || '').trim();
      this._showStatus(detail ? `カレンダー権限の更新に失敗しました: ${detail}` : 'カレンダー権限の更新に失敗しました', true);
      return false;
    }
    cal.edit_role = role;
    this._showStatus('カレンダー権限を更新しました');
    return true;
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
      const memberships = new Map();
      groups.forEach(group => group.members.forEach(member => {
        if (!member.name) return;
        const workspaceId = String(group.workspaceId || group.folder || '');
        const memberId = String(member.memberId || '');
        const key = `${workspaceId}\u001f${memberId || member.name}`;
        memberships.set(key, { name: member.name, workspaceId, memberId, folder: String(group.folder || workspaceId) });
      }));
      let created = 0;
      let paletteIdx = (this._calendars || []).length;
      for (const membership of memberships.values()) {
        const { name, workspaceId, memberId, folder } = membership;
        const matches = cal => cal?.source === 'shift'
          && ((memberId && String(cal.member_id || '') === memberId)
            || (!memberId && cal.user === name))
          && (workspaceId
            ? String(cal.workspace_id || '') === workspaceId
            : !String(cal.workspace_id || ''));
        if ((this._calendars || []).some(matches)) continue;
        // 他のメンバー名義のカレンダーは自分の一覧に出ないことがある（認証を使わないローカル構成では
        // 一覧が自分の分だけ）。そのメンバーの一覧でも確かめ、作成済みなら作らない（押すたびに重複していた。M-014 で発見）。
        if (name !== this._getUser()) {
          const theirs = await apiFetch('/cal/calendars?user=' + encodeURIComponent(name), { silentError: true }).catch(() => null);
          if (Array.isArray(theirs) && theirs.some(matches)) continue;
        }
        await (globalThis.MeldexDiagnostics?.watchScheduleTask || ((op, task) => task))('calendar-save', apiPost('/cal/calendars', {
          name: `シフト: ${name}`,
          color: _calAttPaletteColorAt(paletteIdx++),
          user: name,
          source: 'shift',
          visible: 1,
          folder: folder || SHIFT_CALENDAR_FOLDER,
          workspace_id: workspaceId,
          member_id: memberId,
        }));
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
