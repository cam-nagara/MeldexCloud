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
        <label>出退勤状況に表示するワークスペース</label>
        <div class="cal-option-members" data-cal-attendance-source-list>${rows}</div>
        <div class="gb-section-desc">チェックを外したワークスペースのメンバーは、出退勤状況に表示しません。</div>`;
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

  CalendarComponent.prototype._setCalendarColor = async function(cal, color) {
    if (!this._calUserCanEditCalendar(cal)) {
      this._showStatus('編集権限がありません', true);
      return;
    }
    const next = String(color || '').trim();
    if (!next) return;
    try {
      await apiPut('/cal/calendars/' + encodeURIComponent(cal.id) + '?_user=' + encodeURIComponent(this._getUser()), { color: next });
      cal.color = next;
      this._renderCalendarList();
      this._render();
      this._showStatus('カレンダーの色を更新しました');
    } catch {
      this._showStatus('色の更新に失敗', true);
    }
  };

  CalendarComponent.prototype._setCalendarFolder = async function(cal, value) {
    if (!this._calUserCanEditCalendar(cal)) {
      this._showStatus('編集権限がありません', true);
      return;
    }
    const folder = String(value || '').trim() || _calAttFolderFallbackForSource(cal?.source);
    try {
      await apiPut('/cal/calendars/' + encodeURIComponent(cal.id) + '?_user=' + encodeURIComponent(this._getUser()), { folder });
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
      await apiPut('/cal/calendars/' + encodeURIComponent(cal.id) + '?_user=' + encodeURIComponent(this._getUser()), { edit_role: role });
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
