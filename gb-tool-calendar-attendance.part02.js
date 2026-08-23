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
    const baseName = source === 'shift'
      ? `シフト: ${this._getUser()}`
      : source === 'attendance'
        ? `実績: ${this._getUser()}`
        : '無題';
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

  function _calAttCorrectionNextDay(day) {
    const parts = String(day || '').split('-').map(Number);
    const value = parts.length === 3 ? new Date(parts[0], parts[1] - 1, parts[2] + 1, 12) : new Date(NaN);
    return Number.isNaN(value.getTime()) ? day : [
      value.getFullYear(),
      String(value.getMonth() + 1).padStart(2, '0'),
      String(value.getDate()).padStart(2, '0'),
    ].join('-');
  }

  function _calAttCorrectionButton(label, className) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className || 'gb-btn gb-btn-sm';
    button.textContent = label;
    button.style.minHeight = '44px';
    return button;
  }

  function _calAttCorrectionTypeSelect(value) {
    const select = document.createElement('select');
    select.className = 'gb-select';
    select.setAttribute('aria-label', '打刻種別');
    [['clock_in', '出勤'], ['clock_out', '退勤'], ['break_start', '離席'], ['break_end', '復帰']].forEach(([key, label]) => {
      const option = document.createElement('option');
      option.value = key;
      option.textContent = label;
      option.selected = key === value;
      select.appendChild(option);
    });
    return select;
  }

  function _calAttCorrectionEntriesForDay(entries, day) {
    const sorted = [...(entries || [])].sort((a, b) => String(a.timestamp || '').localeCompare(String(b.timestamp || '')));
    const result = [];
    for (const entry of sorted) {
      const entryDay = String(entry.timestamp || '').slice(0, 10);
      if (entryDay < day) continue;
      if (entryDay > day && entry.type === 'clock_in') break;
      if (entryDay === day || result.length) result.push(entry);
    }
    return result;
  }

  CalendarComponent.prototype._showAttendanceCorrectionModal = function(eventRecord) {
    if (!this._calUserIsAdmin?.()) {
      this._showStatus('実績の修正は管理者に依頼してください', true);
      return;
    }
    const component = this;
    const user = String(eventRecord?.user || this._getUser() || '').trim();
    const day = String(eventRecord?.start || '').slice(0, 10) || this._localDateStr(this._date);
    const nextDay = _calAttCorrectionNextDay(day);
    const body = document.createElement('div');
    const dayField = document.createElement('label');
    dayField.textContent = '勤務日';
    dayField.style.cssText = 'display:grid;gap:4px;max-width:220px;';
    const dayInput = document.createElement('input');
    dayInput.type = 'date';
    dayInput.value = day;
    dayInput.setAttribute('aria-label', '修正する勤務日');
    dayInput.style.minHeight = '44px';
    dayField.appendChild(dayInput);
    const description = document.createElement('p');
    description.textContent = `${user}・${day}開始分の打刻を管理者として修正します。変更内容は実績カレンダーへ自動反映されます。`;
    const status = document.createElement('div');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    status.dataset.calAttendanceCorrectionStatus = '1';
    const list = document.createElement('div');
    list.dataset.calAttendanceCorrectionList = '1';
    list.tabIndex = -1;
    list.style.display = 'grid';
    list.style.gap = '8px';
    const addRow = document.createElement('div');
    addRow.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;align-items:end;';
    const addType = _calAttCorrectionTypeSelect('clock_in');
    const addTime = document.createElement('input');
    addTime.type = 'datetime-local';
    addTime.setAttribute('aria-label', '追加する打刻日時');
    addTime.value = `${day}T09:00`;
    addType.style.cssText = 'min-height:44px;flex:1 1 110px;';
    addTime.style.cssText = 'min-height:44px;flex:2 1 190px;min-width:0;';
    const addButton = _calAttCorrectionButton('打刻を追加', 'gb-btn gb-btn-sm gb-btn-primary primary');
    addRow.append(addType, addTime, addButton);
    body.append(dayField, description, status, list, addRow);
    const closeButton = _calAttCorrectionButton('閉じる');
    let busy = false;
    const modalApi = window.GBUI.createModal({
      id: 'calendar-attendance-correction',
      title: '実績を修正',
      body: [...body.childNodes],
      footer: closeButton,
      variant: 'standard',
      geometryKey: 'calendar-attendance-correction',
      minWidth: '0',
      initialFocus: '[data-cal-attendance-correction-list]',
      closeLabel: '実績修正を閉じる',
      closeOnEsc: true,
      closeOnOverlay: true,
      onBeforeClose: () => !busy,
    });
    const panel = modalApi.modal;
    modalApi.overlay.dataset.e2eId = 'calendar-attendance-correction-overlay';
    panel.dataset.e2eId = 'calendar-attendance-correction-dialog';
    panel.style.minWidth = 'min(620px, 100%)';
    modalApi.body.style.setProperty('overflow-x', 'hidden', 'important');
    modalApi.body.style.minWidth = '0';
    const panelStatus = panel.querySelector('[data-cal-attendance-correction-status]');
    const panelList = panel.querySelector('[data-cal-attendance-correction-list]');
    dayInput.addEventListener('change', () => {
      const selectedDay = dayInput.value;
      if (!selectedDay || selectedDay === day || busy) return;
      modalApi.close('date-change');
      component._showAttendanceCorrectionModal?.({ ...eventRecord, user, start: `${selectedDay}T00:00:00`, calendar_source: 'attendance' });
    });
    const setBusy = (next, message) => {
      busy = next;
      panel.setAttribute('aria-busy', next ? 'true' : 'false');
      panel.querySelectorAll('button,input,select').forEach(control => { control.disabled = next; });
      closeButton.disabled = next;
      if (message && panelStatus) panelStatus.textContent = message;
    };
    let pendingAddId = '';
    const resetPendingAdd = () => { pendingAddId = ''; };
    addType.addEventListener('change', resetPendingAdd);
    addTime.addEventListener('input', resetPendingAdd);
    const refreshCalendar = async () => {
      await Promise.all([component._loadEvents(), component._loadCalendars(), component._updateClockStatus()]);
      component._render();
    };
    const reload = async () => {
      const entries = await apiFetch('/cal/time?user=' + encodeURIComponent(user)
        + '&date_from=' + encodeURIComponent(day)
        + '&date_to=' + encodeURIComponent(nextDay + 'T23:59:59'));
      if (!modalApi.isOpen() || !panelList) return;
      panelList.textContent = '';
      const scopedEntries = _calAttCorrectionEntriesForDay(entries, day);
      scopedEntries.forEach(entry => {
        const row = document.createElement('div');
        row.dataset.calAttendanceCorrectionRow = String(entry.id || '');
        row.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;align-items:center;';
        const typeSelect = _calAttCorrectionTypeSelect(entry.type);
        const timeInput = document.createElement('input');
        timeInput.type = 'datetime-local';
        timeInput.setAttribute('aria-label', '打刻日時');
        timeInput.value = String(entry.timestamp || '').slice(0, 16);
        typeSelect.style.cssText = 'min-height:44px;flex:1 1 110px;';
        timeInput.style.cssText = 'min-height:44px;flex:2 1 190px;min-width:0;';
        const saveButton = _calAttCorrectionButton('保存', 'gb-btn gb-btn-sm gb-btn-primary primary');
        const deleteButton = _calAttCorrectionButton('削除', 'gb-btn gb-btn-sm gb-btn-danger danger');
        saveButton.style.flex = '0 0 auto';
        deleteButton.style.flex = '0 0 auto';
        saveButton.addEventListener('click', async () => {
          if (busy || !timeInput.value) return;
          setBusy(true, '保存中...');
          try {
            await apiPut('/cal/time/' + encodeURIComponent(entry.id), {
              user, type: typeSelect.value, timestamp: timeInput.value, correction: true,
            });
            await reload();
            await refreshCalendar();
            if (panelStatus) panelStatus.textContent = '実績を更新しました。';
          } catch (error) {
            try {
              await reload();
              await refreshCalendar();
              if (panelStatus) panelStatus.textContent = '保存応答を確認できなかったため、最新の実績を再読み込みしました。';
            } catch {
              if (panelStatus) panelStatus.textContent = '保存できず、最新状態も確認できませんでした: ' + (error?.message || error);
            }
          } finally {
            if (modalApi.isOpen()) setBusy(false);
          }
        });
        deleteButton.addEventListener('click', async () => {
          if (busy || (typeof cfConfirm === 'function' && !await cfConfirm('この打刻を削除しますか？'))) return;
          setBusy(true, '削除中...');
          try {
            await apiFetch('/cal/time/' + encodeURIComponent(entry.id), { method: 'DELETE' });
            await reload();
            await refreshCalendar();
            if (panelStatus) panelStatus.textContent = '打刻を削除しました。';
          } catch (error) {
            try {
              await reload();
              await refreshCalendar();
              if (panelStatus) panelStatus.textContent = '削除応答を確認できなかったため、最新の実績を再読み込みしました。';
            } catch {
              if (panelStatus) panelStatus.textContent = '削除できず、最新状態も確認できませんでした: ' + (error?.message || error);
            }
          } finally {
            if (modalApi.isOpen()) setBusy(false);
          }
        });
        row.append(typeSelect, timeInput, saveButton, deleteButton);
        row.querySelectorAll('button,input,select').forEach(control => { control.disabled = busy; });
        panelList.appendChild(row);
      });
      if (!scopedEntries.length) panelList.textContent = 'この勤務日の打刻はありません。';
    };
    closeButton.addEventListener('click', () => modalApi.close('close'));
    panel.querySelectorAll('button').forEach(button => { button.style.minHeight = '44px'; });
    addButton.addEventListener('click', async () => {
      if (busy || !addTime.value) return;
      if (!pendingAddId) pendingAddId = globalThis.crypto?.randomUUID?.() || `time-correction-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const requestId = pendingAddId;
      setBusy(true, '追加中...');
      try {
        await apiPost('/cal/time', { id: requestId, operation_id: requestId, user, type: addType.value, timestamp: addTime.value, correction: true });
        await reload();
        await refreshCalendar();
        pendingAddId = '';
        if (panelStatus) panelStatus.textContent = '打刻を追加しました。';
      } catch (error) {
        try {
          await reload();
          const applied = [...(panelList?.querySelectorAll('[data-cal-attendance-correction-row]') || [])]
            .some(row => row.dataset.calAttendanceCorrectionRow === requestId);
          await refreshCalendar();
          if (applied) {
            pendingAddId = '';
            if (panelStatus) panelStatus.textContent = '打刻は追加済みでした。最新の実績を表示しています。';
          } else if (panelStatus) {
            panelStatus.textContent = '追加できませんでした: ' + (error?.message || error);
          }
        } catch {
          if (panelStatus) panelStatus.textContent = '追加できず、最新状態も確認できませんでした: ' + (error?.message || error);
        }
      } finally {
        if (modalApi.isOpen()) setBusy(false);
      }
    });
    modalApi.open();
    setBusy(true, '打刻を読み込んでいます...');
    reload().then(() => {
      if (modalApi.isOpen()) {
        setBusy(false);
        if (panelStatus) panelStatus.textContent = '';
      }
    }).catch(error => {
      if (modalApi.isOpen()) {
        setBusy(false);
        if (panelStatus) panelStatus.textContent = '打刻を読み込めませんでした: ' + (error?.message || error);
      }
    });
  };

  window.exportAttendanceCsvFromMenu = function() {
    if (!_calAttCanManageAttendance()) {
      if (typeof showStatus === 'function') showStatus('勤怠CSVは管理者のみ保存できます', true);
      return;
    }
    const bounds = _calAttMonthBounds(new Date());
    const content = document.createElement('div');
    content.innerHTML = `<div class="gb-cal-attendance-export-form"><div role="status" aria-live="polite" data-cal-attendance-export-status></div>
      <div class="field"><label>開始日</label><input class="att-csv-from" type="date" value="${bounds.start}"></div>
      <div class="field"><label>終了日</label><input class="att-csv-to" type="date" value="${bounds.end}"></div>
      <div class="field"><label>ユーザー</label><input class="att-csv-user" type="text" value="" placeholder="空欄で全員"></div>
      <div class="gb-cal-att-csv-formats">
        <button type="button" class="att-csv-format" data-format="generic">汎用CSV</button>
        <button type="button" class="att-csv-format" data-format="smaregi">スマレジ向け勤務実績</button>
        <button type="button" class="att-csv-format" data-format="moneyforward">マネーフォワード日次打刻</button>
      </div></div>`;
    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.className = 'att-csv-close gb-btn gb-btn-sm';
    closeButton.textContent = '閉じる';
    closeButton.setAttribute('aria-label', '勤怠CSV保存を閉じる');
    let busy = false;
    const modalApi = window.GBUI.createModal({
      id: 'calendar-attendance-export',
      title: '勤怠CSVとして保存',
      body: [...content.childNodes],
      footer: closeButton,
      variant: 'standard',
      geometryKey: 'calendar-attendance-export',
      minWidth: '0',
      initialFocus: '.att-csv-from',
      closeLabel: '勤怠CSV保存を閉じる',
      closeOnEsc: true,
      closeOnOverlay: true,
      onBeforeClose: () => !busy,
    });
    const overlay = modalApi.overlay;
    const panel = modalApi.modal;
    modalApi.body.style.setProperty('overflow-x', 'hidden', 'important');
    modalApi.body.style.minWidth = '0';
    modalApi.body.style.overflowWrap = 'anywhere';
    overlay.dataset.e2eId = 'calendar-attendance-export-overlay';
    overlay._calendarClose = modalApi.close;
    panel.classList.add('gb-cal-attendance-export-modal');
    panel.dataset.e2eId = 'calendar-attendance-export-dialog';
    panel.style.minWidth = 'min(420px, 100%)';
    const form = panel.querySelector('.gb-cal-attendance-export-form');
    if (form) {
      form.style.display = 'grid';
      form.style.gap = '12px';
      form.style.minWidth = '0';
    }
    panel.querySelectorAll('.field').forEach(field => {
      field.style.display = 'grid';
      field.style.gap = '6px';
      field.style.minWidth = '0';
      const label = field.querySelector('label');
      if (label) label.style.display = 'block';
    });
    [...panel.querySelectorAll('input,button')].forEach(control => {
      control.style.maxWidth = '100%';
      control.style.boxSizing = 'border-box';
    });
    panel.querySelectorAll('input').forEach(input => { input.style.width = '100%'; input.style.minWidth = '0'; });
    const formats = panel.querySelector('.gb-cal-att-csv-formats');
    if (formats) {
      formats.style.display = 'grid';
      formats.style.gridTemplateColumns = 'repeat(auto-fit,minmax(min(132px,100%),1fr))';
      formats.style.gap = '8px';
      formats.style.minWidth = '0';
    }
    const status = panel.querySelector('[data-cal-attendance-export-status]');
    const formatButtons = [...panel.querySelectorAll('.att-csv-format')];
    formatButtons.forEach(button => { button.style.minHeight = '44px'; button.style.width = '100%'; });
    const setBusy = (next) => {
      busy = next;
      panel.setAttribute('aria-busy', next ? 'true' : 'false');
      [...formatButtons, closeButton].forEach(button => { button.disabled = next; });
    };
    closeButton.addEventListener('click', () => modalApi.close('close'));
    formatButtons.forEach(btn => {
      btn.addEventListener('click', async () => {
        if (busy) return;
        if (typeof MeldexExportSave === 'undefined' || typeof MeldexExportSave.saveUrl !== 'function') {
          if (status) status.textContent = '保存ダイアログを初期化できませんでした。';
          if (typeof showStatus === 'function') showStatus('保存ダイアログを初期化できませんでした', true);
          return;
        }
        const from = panel.querySelector('.att-csv-from')?.value || '';
        const to = panel.querySelector('.att-csv-to')?.value || '';
        const user = panel.querySelector('.att-csv-user')?.value.trim() || '';
        const fmt = btn.dataset.format || 'generic';
        setBusy(true);
        if (status) status.textContent = '保存中...';
        let saved = false;
        let saveErrored = false;
        try {
          saved = await MeldexExportSave.saveUrl(_calAttExportUrl(fmt, from, to, user), {
            filename: `attendance-${fmt}-${from || 'from'}_${to || 'to'}.csv`,
            extension: '.csv',
            dialogTitle: '勤怠CSVとして保存',
            filetypes: [['CSVファイル', '*.csv'], ['すべてのファイル', '*.*']],
            okMessage: '勤怠CSVを保存しました',
            errorMessage: '勤怠CSVの保存に失敗しました',
          });
        } catch (error) {
          saveErrored = true;
          if (status) status.textContent = '保存できませんでした。入力内容を保ったまま再試行できます。';
          if (typeof showStatus === 'function') showStatus('勤怠CSVの保存に失敗しました: ' + (error?.message || error), true);
        } finally {
          if (modalApi.isOpen()) setBusy(false);
        }
        if (saved) {
          modalApi.close('saved');
          return;
        }
        if (!saveErrored && status) status.textContent = '保存は完了していません。入力内容を保ったまま、必要に応じてもう一度お試しください。';
      });
    });
    modalApi.open();
  };

  window.exportAttendanceCsvForCurrentUser = function() {
    if (!_calAttCanManageAttendance()) {
      if (typeof showStatus === 'function') showStatus('勤怠CSVは管理者のみ保存できます', true);
      return false;
    }
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
