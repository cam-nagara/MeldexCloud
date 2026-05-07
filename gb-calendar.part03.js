  (async () => {
    try {
      const status = await apiFetch('/cal/sync/status');
      const gStatus = o.querySelector('#sync-google-status');
      const gConnected = status.google?.connected;
      const gAvailable = status.google?.available;
      if (gConnected) {
        gStatus.innerHTML = 'ステータス: <span style="color:var(--green);">接続済み</span>';
        o.querySelector('#sync-google-actions').style.display = 'flex';
      } else if (gAvailable) {
        gStatus.textContent = 'ステータス: 未接続';
        o.querySelector('#sync-google-auth').style.display = '';
      } else {
        gStatus.innerHTML = 'ステータス: <span style="color:var(--red);">パッケージ未インストール</span>';
      }
    } catch { o.querySelector('#sync-google-status').textContent = 'ステータス確認に失敗'; }
  })();

  // Google認証
  const authBtn = o.querySelector('#sync-gcal-auth-btn');
  if (authBtn) authBtn.addEventListener('click', async () => {
    const id = o.querySelector('#sync-gcal-id')?.value.trim();
    const secret = o.querySelector('#sync-gcal-secret')?.value.trim();
    if (!id || !secret) { showStatus('Client IDとSecretを入力してください', true); return; }
    try { const res = await apiPost('/cal/sync/google/auth', { client_id: id, client_secret: secret }); showStatus(res.message || '認証成功'); o.remove(); _showSyncModal(dbPath); } catch (e) { showStatus('認証失敗', true); }
  });
  // Google Pull/Push
  o.querySelector('#sync-gcal-pull').addEventListener('click', async () => {
    showStatus('Googleカレンダーから取得中...');
    try { const res = await apiPost('/calendar-db/sync/google/pull', { db_path: dbPath }); showStatus(`取得完了: ${res.imported}件`); await selectDatabase(dbPath); } catch { showStatus('同期失敗', true); }
  });
  o.querySelector('#sync-gcal-push').addEventListener('click', async () => {
    showStatus('Googleカレンダーに送信中...');
    try { const res = await apiPost('/calendar-db/sync/google/push', { db_path: dbPath }); showStatus(`送信完了: ${res.pushed}件`); } catch { showStatus('送信失敗', true); }
  });

  // iCal
  o.querySelector('#sync-ical-import').addEventListener('click', () => {
    const input = document.createElement('input'); input.type = 'file'; input.accept = '.ics,.ical';
    input.onchange = async () => {
      const file = input.files[0]; if (!file) return;
      const text = await file.text();
      try { const res = await apiPost('/calendar-db/ical/import', { db_path: dbPath, ics: text }); showStatus(`iCalインポート完了: ${res.imported}件`); o.remove(); await selectDatabase(dbPath); } catch { showStatus('インポート失敗', true); }
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
    try { const res = await apiPost('/calendar-db/caldav/sync-to-ics', { db_path: dbPath }); showStatus(`CalDAV送信完了: ${res.synced}件`); } catch { showStatus('CalDAV送信に失敗', true); }
  });
  o.querySelector('#sync-caldav-pull').addEventListener('click', async () => {
    showStatus('CalDAVから取得中...');
    try { const res = await apiPost('/calendar-db/caldav/sync-from-ics', { db_path: dbPath }); showStatus(`CalDAV取得完了: ${res.imported}件`); o.remove(); await selectDatabase(dbPath); } catch { showStatus('CalDAV取得に失敗', true); }
  });

  // SQLiteマイグレーション
  o.querySelector('#sync-migrate').addEventListener('click', async () => {
    try { const res = await apiPost('/calendar-db/migrate-from-sqlite', { db_path: dbPath }); showStatus(`マイグレーション完了: ${res.migrated}件`); o.remove(); await selectDatabase(dbPath); } catch { showStatus('マイグレーションに失敗', true); }
  });
}
