  // gb-production-management-cloud-dialogs.js: 制作管理メニューから直接開く
  // トップレベルダイアログ（開始／タスク一括作成の起点／シフト取込／書き出し）と、
  // 外部カレンダー自動送信タイマーを担当する（責務単位分割 2026-08-12。旧
  // gb-production-management.part01.js の一部）。
  //
  // gb-production-management.part01.js から続く共有クロージャ（IIFEの raw
  // concatenation）に属し、このファイル自体は自前のIIFEを持たない。読み込み順は
  // gb-production-management.js を参照。

  async function openProductionManagementStart() {
    if (!_pmEnsureWritable()) return null;
    const result = await _pmRequest('/production-management/init', { method: 'POST', body: {} });
    _pmShowStatus(_pmRecoveryText(`制作管理を準備しました: ${result.root || PM_ROOT}`, result));
    return result;
  }

  function openProductionTaskCreate() {
    if (!_pmEnsureWritable()) return null;
    const dialog = window.MeldexProductionTaskCreateDialog?.openActive?.();
    if (!dialog) _pmShowStatus('タスク一括作成画面を初期化できませんでした', true);
    return dialog;
  }

  function openProductionShiftImport() {
    if (!_pmEnsureWritable()) return null;
    const { body, close } = _pmModal('シフト表を取り込む', {
      e2eId: 'production-shift-import-overlay',
      dialogE2eId: 'production-shift-import-dialog',
    });
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv';
    fileInput.className = 'gb-input gb-input-sm gb-production-input';
    fileInput.dataset.e2eId = 'production-shift-import-file';
    const preview = document.createElement('div');
    preview.className = 'gb-production-result-box gb-production-shift-preview';
    preview.dataset.e2eId = 'production-shift-import-preview';
    let parsedRows = [];
    fileInput.addEventListener('change', async () => {
      try {
        parsedRows = await _pmParseShiftFile(fileInput.files?.[0]);
        _pmRenderPreview(preview, parsedRows);
      } catch (error) {
        parsedRows = [];
        preview.textContent = '取り込み内容を読み込めませんでした: ' + (error?.message || error);
        _pmShowStatus(preview.textContent, true);
      }
    });
    body.append(_pmField('Excel / CSV', fileInput), preview);
    body.parentElement.append(_pmFooter(close, '取り込む', async () => {
      if (!parsedRows.length) throw new Error('取り込む行がありません');
      const result = await _pmRequest('/production-management/shifts/apply', { method: 'POST', body: { rows: parsedRows, source_file: fileInput.files?.[0]?.name || '' } });
      let _shiftMsg = `シフトを取り込みました: ${result.count || 0}件`;
      if (result.registry_added) _shiftMsg += `（スタッフ管理シートに${result.registry_added}名を追加）`;
      const _shiftWarns = Array.isArray(result.registry_name_warnings) ? result.registry_name_warnings : [];
      if (_shiftWarns.length) _shiftMsg += ` ⚠ 表記ゆれの可能性: ${_shiftWarns.map(w => `「${w.name}」≈「${w.similar_to}」`).join('、')}`;
      _pmShowStatus(_pmRecoveryText(_shiftMsg, result), _shiftWarns.length > 0);
    }, { write: true, e2eIdPrefix: 'production-shift-import' }));
  }

  function _pmRenderPreview(container, rows) {
    container.replaceChildren();
    const wrap = document.createElement('div');
    wrap.className = 'gb-production-preview-table-wrap';
    const table = document.createElement('table');
    table.className = 'db-table gb-production-preview-table';
    const head = document.createElement('tr');
    ['担当者', '日付', '開始', '終了', '種別'].forEach((label) => {
      const th = document.createElement('th');
      th.textContent = label;
      head.appendChild(th);
    });
    table.appendChild(head);
    rows.slice(0, 50).forEach((row) => {
      const tr = document.createElement('tr');
      [row.user, row.date, row.start_time, row.end_time, row.type].forEach((value) => {
        const td = document.createElement('td');
        td.textContent = value || '';
        tr.appendChild(td);
      });
        table.appendChild(tr);
      });
    wrap.appendChild(table);
    container.appendChild(wrap);
  }

  // runProductionAssignment（「担当者と時間を割り当て」の即時実行）は制作管理UX改善計画
  // （2026-08-04）§6-1で廃止した。同じ用途（未割当のタスクだけを素早く埋める）は「予定を
  // 組み直す」ダイアログの「未割当のタスクだけ」スコープ（unassigned_only）で提供する。
  // /production-management/assign/preview・/apply エンドポイント自体は互換のため残っている
  // （フルエンジンの unassigned_only スコープへ委譲。meldex_production_management.py）。

  // コミット前レビュー指摘 #14: 15分毎の自動送信タイマー（_pmStartExternalSyncTimer）と
  // 手動の「外部カレンダーへ送信」ボタンが同時に走ると、Google側への二重登録や CalDAV
  // 書込みの競合が起き得る。この関数はDesktop/Cloud共通の唯一の入口（両方とも
  // POST /production-management/external-sync を叩く）なので、ここで実行中フラグを持てば
  // 両プラットフォームの並走を一括で防げる。
  let PM_EXTERNAL_SYNC_IN_FLIGHT = false;

  async function runProductionExternalSync(options = {}) {
    if (!_pmCloudCanExportAttendance()) {
      if (!options.silent) _pmShowStatus('外部カレンダーへ送信できるのは管理者のみです', true);
      return { ok: false, forbidden: true };
    }
    if (!_pmEnsureWritable({ notify: !options.silent })) return null;
    if (window.MeldexRuntimeAdapter?.isBrowserDataMode?.() && !_pmCloudCanExportAttendance()) {
      if (!options.silent) _pmShowStatus('外部カレンダーへ送信できるのは管理者のみです', true);
      return { ok: false, status: 403, code: 'PRODUCTION_EXTERNAL_SYNC_ADMIN_REQUIRED' };
    }
    if (PM_EXTERNAL_SYNC_IN_FLIGHT) {
      // 自動側（silent）は次回タイマーに委ねて静かにスキップし、手動側だけ状況を伝える。
      if (!options.silent) _pmShowStatus('外部カレンダーへの送信が既に進行中です。完了までお待ちください', true);
      return { ok: true, skipped: true, in_flight: true };
    }
    PM_EXTERNAL_SYNC_IN_FLIGHT = true;
    try {
      const result = await _pmRequest('/production-management/external-sync', { method: 'POST', body: { automatic: !!options.silent } });
      if (result?.unsupported) {
        if (!options.silent) _pmShowStatus(result.message || '外部カレンダー送信はこの環境では使えません', true);
        return result;
      }
      // Cloud（Dropboxモード）でGoogleカレンダー未接続の場合、result.ok は true のまま
      // result.message に案内文だけが入る（制作管理UX改善計画2026-08-04 §4-4。
      // gb-production-external-sync-cloud.js の syncGoogle 参照）。行き止まり表示にせず案内する。
      if (!options.silent) {
        if (result?.message) {
          _pmShowStatus(result.message, true);
        } else {
          _pmShowStatus(`外部カレンダーへ送信しました: ${result.caldav_synced || 0}件 / Google ${result.google_pushed || 0}件追加・${result.google_updated || 0}件更新`);
        }
      }
      return result;
    } finally {
      PM_EXTERNAL_SYNC_IN_FLIGHT = false;
    }
  }

  async function _pmAutoProductionExternalSync() {
    if (!_pmCloudCanExportAttendance()) return;
    // 制作管理UX改善計画（2026-08-04）§4-4: Google送信がCloudにも対応したため、Dropboxモード
    // 除外は撤去した。Cloud未接続時は runProductionExternalSync が silent:true のもと
    // result.message だけを受け取り、通知を出さずに静かに終わる（15分毎の無駄な失敗表示を避ける）。
    const status = await _pmRequest('/production-management/status', { method: 'GET' }).catch(() => null);
    if (!status?.ready) return;
    await runProductionExternalSync({ silent: true });
  }

  function _pmStartExternalSyncTimer() {
    if (!_pmCloudCanExportAttendance()) {
      if (window.__meldexProductionExternalSyncTimer) clearInterval(window.__meldexProductionExternalSyncTimer);
      window.__meldexProductionExternalSyncTimer = null;
      return;
    }
    // デスクトップ付箋の小窓でも自動送信タイマーが動くと、付箋の枚数だけ外部カレンダーへの
    // 自動送信が並走する。実行中フラグはウィンドウ単位なので窓をまたいだ二重送信は防げない。
    if (typeof _isTrayAnnotationHost === 'function' && _isTrayAnnotationHost()) return;
    if (window.MeldexRuntimeAdapter?.isBrowserDataMode?.() && !_pmCloudCanExportAttendance()) return;
    if (window.__meldexProductionExternalSyncTimer) return;
    const startupTimer = setTimeout(() => _pmAutoProductionExternalSync().catch(() => {}), 15000);
    if (typeof startupTimer?.unref === 'function') startupTimer.unref();
    window.__meldexProductionExternalSyncTimer = setInterval(() => {
      _pmAutoProductionExternalSync().catch(() => {});
    }, 15 * 60 * 1000);
    if (typeof window.__meldexProductionExternalSyncTimer?.unref === 'function') window.__meldexProductionExternalSyncTimer.unref();
  }

  function openProductionExport() {
    const { body, close } = _pmModal('シフト、実績、作業予定を書き出す', {
      e2eId: 'production-export-overlay',
      dialogE2eId: 'production-export-dialog',
    });
    const exportKinds = _pmCloudExportKinds();
    const kind = _pmSelect(exportKinds, exportKinds[0]);
    kind.dataset.e2eId = 'production-export-kind';
    const format = _pmSelect(['csv', 'xlsx'], 'csv');
    format.dataset.e2eId = 'production-export-format';
    const from = _pmInput('', '2026-05-01');
    from.dataset.e2eId = 'production-export-from';
    const to = _pmInput('', '2026-05-31');
    to.dataset.e2eId = 'production-export-to';
    body.append(
      _pmField('対象', kind),
      _pmField('形式', format),
      _pmField('開始日', from),
      _pmField('終了日', to)
    );
    body.parentElement.append(_pmFooter(close, '保存', async () => {
      await _pmSaveExport(kind.value, format.value, from.value, to.value);
    }, { e2eIdPrefix: 'production-export' }));
  }

  async function _pmSaveExport(kind, format, from, to) {
    const params = new URLSearchParams({ kind, format });
    if (from) params.set('date_from', from);
    if (to) params.set('date_to', to);
    const apiUrl = `/api/production-management/export?${params}`;
    if (!window.MeldexRuntimeAdapter?.isBrowserDataMode?.() && window.MeldexExportSave?.saveUrl) {
      await MeldexExportSave.saveUrl(apiUrl, { filename: `production_${kind}.${format}`, mime: format === 'xlsx' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'text/csv;charset=utf-8' });
      return;
    }
    const result = await _pmRequest('/production-management/export?' + params, { method: 'GET' });
    if (result.blob) {
      await MeldexExportSave.saveBlob(_pmBase64Blob(result.blob, result.mime), { filename: result.filename, mime: result.mime });
    } else {
      await MeldexExportSave.saveText(result.content || '', { filename: result.filename || `production_${kind}.csv`, mime: result.mime || 'text/csv;charset=utf-8' });
    }
  }

  // シフト取込XLSX/ZIP解析ユーティリティ（_pmParseShiftFile 以下）と
  // CSV/XLSX/ZIP書き出しユーティリティは gb-production-management-cloud-spreadsheet-io.js
  // （旧 gb-production-management.part03.js）にある。同一クロージャの raw concatenation
  // のため参照は変わらず利用できる。
