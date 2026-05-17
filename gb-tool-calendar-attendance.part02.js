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
