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

  window.exportAttendanceCsvFromMenu = function() {
    const bounds = _calAttMonthBounds(new Date());
    const content = document.createElement('div');
    content.innerHTML = `<div class="gb-cal-attendance-export-form"><div role="status" aria-live="polite" data-cal-attendance-export-status></div>
      <div class="field"><label>開始日</label><input class="att-csv-from" type="date" value="${bounds.start}"></div>
      <div class="field"><label>終了日</label><input class="att-csv-to" type="date" value="${bounds.end}"></div>
      <div class="field"><label>ユーザー</label><input class="att-csv-user" type="text" value="" placeholder="空欄で全員"></div>
      <div class="gb-cal-att-csv-formats">
        <button type="button" class="att-csv-format" data-format="generic">汎用CSV</button>
        <button type="button" class="att-csv-format" data-format="smaregi">スマレジ形式</button>
        <button type="button" class="att-csv-format" data-format="moneyforward">マネーフォワード形式</button>
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
