  const syncErrorMessage = (fallback, err) => {
    const detail = err?.detail || err?.message || err?.error || '';
    return detail ? `${fallback}: ${detail}` : fallback;
  };
  const syncCountMessage = (label, result, fields) => {
    const parts = fields
      .map(([fieldLabel, key]) => [fieldLabel, Number(result?.[key]) || 0])
      .filter(([, count]) => count > 0)
      .map(([fieldLabel, count]) => `${fieldLabel}${count}件`);
    return `${label}: ${parts.length ? parts.join('、') : '0件'}`;
  };

  (async () => {
    try {
      const status = await apiFetch('/cal/sync/status');
      const gStatus = o.querySelector('#sync-google-status');
      const googleStatus = status.google;
      const googleStatusObj = googleStatus && typeof googleStatus === 'object' ? googleStatus : null;
      const gConnected = !!googleStatusObj?.connected;
      const gAvailable = googleStatus === true || !!googleStatusObj?.available;
      const gUnsupported = googleStatus === false || status.unsupported === true;
      if (gConnected) {
        gStatus.innerHTML = 'ステータス: <span style="color:var(--green);">接続済み</span>';
        o.querySelector('#sync-google-actions').style.display = 'flex';
      } else if (gAvailable) {
        gStatus.textContent = 'ステータス: 未接続';
        o.querySelector('#sync-google-auth').style.display = '';
      } else if (gUnsupported) {
        gStatus.textContent = 'ステータス: Cloud BETAでは外部カレンダー同期リレー未設定のため無効です';
      } else {
        gStatus.innerHTML = 'ステータス: <span style="color:var(--red);">パッケージ未インストール</span>';
      }
    } catch (err) { o.querySelector('#sync-google-status').textContent = syncErrorMessage('ステータス確認に失敗', err); }
  })();

  // Google認証
  const authBtn = o.querySelector('#sync-gcal-auth-btn');
  if (authBtn) authBtn.addEventListener('click', async () => {
    const id = o.querySelector('#sync-gcal-id')?.value.trim();
    const secret = o.querySelector('#sync-gcal-secret')?.value.trim();
    if (!id || !secret) { showStatus('Client IDとSecretを入力してください', true); return; }
    try { const res = await apiPost('/cal/sync/google/auth', { client_id: id, client_secret: secret }); showStatus(res.message || '認証成功'); o.remove(); _showSyncModal(dbPath); } catch (e) { showStatus(syncErrorMessage('認証失敗', e), true); }
  });
  // Google Pull/Push
  o.querySelector('#sync-gcal-pull').addEventListener('click', async () => {
    showStatus('Googleカレンダーから取得中...');
    try { const res = await apiPost('/calendar-db/sync/google/pull', { db_path: dbPath }); showStatus(syncCountMessage('取得完了', res, [['新規', 'imported'], ['更新', 'updated']])); await _refreshCalendarDb(dbPath); } catch (err) { showStatus(syncErrorMessage('同期失敗', err), true); }
  });
  o.querySelector('#sync-gcal-push').addEventListener('click', async () => {
    showStatus('Googleカレンダーに送信中...');
    try { const res = await apiPost('/calendar-db/sync/google/push', { db_path: dbPath }); showStatus(syncCountMessage('送信完了', res, [['新規', 'pushed'], ['更新', 'updated']])); } catch (err) { showStatus(syncErrorMessage('送信失敗', err), true); }
  });

  // iCal
  o.querySelector('#sync-ical-import').addEventListener('click', () => {
    const input = document.createElement('input'); input.type = 'file'; input.accept = '.ics,.ical';
    input.onchange = async () => {
      const file = input.files[0]; if (!file) return;
      try {
        const text = await file.text();
        const res = await apiPost('/calendar-db/ical/import', { db_path: dbPath, ics: text });
        showStatus(syncCountMessage('iCalインポート完了', res, [['新規', 'imported'], ['更新', 'updated']]));
        o.remove();
        await _refreshCalendarDb(dbPath);
      } catch (err) { showStatus(syncErrorMessage('インポート失敗', err), true); }
    };
    input.click();
  });
  o.querySelector('#sync-ical-export').addEventListener('click', async () => {
    if (typeof MeldexExportSave === 'undefined' || typeof MeldexExportSave.saveUrl !== 'function') {
      showStatus('保存ダイアログを初期化できませんでした', true);
      return;
    }
    const baseName = (typeof MeldexExportSave.guessNameFromPath === 'function')
      ? MeldexExportSave.guessNameFromPath(dbPath, 'calendar')
      : 'calendar';
    const stem = String(baseName || 'calendar').replace(/\.[^.]+$/, '') || 'calendar';
    await MeldexExportSave.saveUrl('/api/calendar-db/ical/export?path=' + encodeURIComponent(dbPath), {
      filename: stem + '.ics',
      extension: '.ics',
      dialogTitle: 'iCal として保存',
      filetypes: [['iCalファイル', '*.ics'], ['すべてのファイル', '*.*']],
      okMessage: 'iCal を保存しました',
      errorMessage: 'iCal の保存に失敗しました',
      path: dbPath,
    });
  });

  // 勤怠CSV
  const now = new Date(), cy = now.getFullYear(), cm = now.getMonth();
  const csvFrom = o.querySelector('#csv-from'), csvTo = o.querySelector('#csv-to');
  csvFrom.value = `${cy}-${_p2(cm + 1)}-01`;
  csvTo.value = _dateStr(new Date(cy, cm + 1, 0));
  const csvExport = async (fmt) => {
    if (typeof MeldexExportSave === 'undefined' || typeof MeldexExportSave.saveUrl !== 'function') {
      showStatus('保存ダイアログを初期化できませんでした', true);
      return;
    }
    const user = encodeURIComponent(_getUser());
    await MeldexExportSave.saveUrl(`/api/cal/export/attendance-csv?format=${fmt}&date_from=${csvFrom.value}&date_to=${csvTo.value}&user=${user}`, {
      filename: `attendance-${fmt}-${csvFrom.value || 'from'}_${csvTo.value || 'to'}.csv`,
      extension: '.csv',
      dialogTitle: '勤怠CSVとして保存',
      filetypes: [['CSVファイル', '*.csv'], ['すべてのファイル', '*.*']],
      okMessage: '勤怠CSVを保存しました',
      errorMessage: '勤怠CSVの保存に失敗しました',
    });
  };
  o.querySelector('#csv-generic').addEventListener('click', () => csvExport('generic'));
  o.querySelector('#csv-smaregi').addEventListener('click', () => csvExport('smaregi'));
  o.querySelector('#csv-mf').addEventListener('click', () => csvExport('moneyforward'));

  // テンプレート
  o.querySelector('#sync-templates').addEventListener('click', () => { o.remove(); _showTemplateModal(dbPath); });

  // CalDAV
  o.querySelector('#sync-caldav-push').addEventListener('click', async () => {
    showStatus('CalDAVに送信中...');
    try { const res = await apiPost('/calendar-db/caldav/sync-to-ics', { db_path: dbPath }); showStatus(syncCountMessage('CalDAV送信完了', res, [['送信', 'synced']])); } catch (err) { showStatus(syncErrorMessage('CalDAV送信に失敗', err), true); }
  });
  o.querySelector('#sync-caldav-pull').addEventListener('click', async () => {
    showStatus('CalDAVから取得中...');
    try { const res = await apiPost('/calendar-db/caldav/sync-from-ics', { db_path: dbPath }); showStatus(syncCountMessage('CalDAV取得完了', res, [['新規', 'imported'], ['更新', 'updated']])); o.remove(); await _refreshCalendarDb(dbPath); } catch (err) { showStatus(syncErrorMessage('CalDAV取得に失敗', err), true); }
  });

  // SQLiteマイグレーション
  o.querySelector('#sync-migrate').addEventListener('click', async () => {
    try { const res = await apiPost('/calendar-db/migrate-from-sqlite', { db_path: dbPath }); showStatus(`マイグレーション完了: ${res.migrated}件`); o.remove(); await _refreshCalendarDb(dbPath); } catch (err) { showStatus(syncErrorMessage('マイグレーションに失敗', err), true); }
  });
}
