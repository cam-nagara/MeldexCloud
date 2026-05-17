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
