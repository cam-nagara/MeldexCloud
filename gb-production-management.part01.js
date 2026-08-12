(function () {
  'use strict';
  const PM_ROOT = '制作管理';
  // 「スタッフリスト」シート（制作管理ルートごとのスタッフ一覧）は
  // アカウント一元管理 計画書 Phase 4 で廃止し、全体で1枚の正本
  // 「スタッフ管理シート」（gb-staff-registry-schema.js/gb-user-registry.js）へ
  // 統合した。13→12シート契約変更（破壊的変更・メジャー境界リリース）。
  // 「自動シフト調整設定」は制作管理UX改善計画（2026-08-04）§5-2で管理対象から
  // 外した（実行エンジン未実装のため）。既存ワークスペースのフォルダは削除しない
  // 非破壊変更。12→11シート契約変更。
  const PM_SHEETS = ['作品リスト', 'タスクリスト', 'タスクテンプレート', '作業対象リスト', '作業内容リスト', '作業規模リスト', 'スケジュール', '勤怠情報', 'スケジュール アーカイブ', 'タスクリスト アーカイブ', 'データソース'];
  const PM_REQUIRED_PAGES = { '制作進行マニュアル.md': '# 制作進行マニュアル\n\n制作管理の手順を記録します。\n', '設定.md': '# 設定\n\n制作管理の設定メモです。\n' };
  const PM_TASK_SHEET_PREFIX = 'タスクリスト_';
  const PM_MAX_GENERATED_TASKS = 5000;
  let PM_TASK_CREATE_QUEUE = Promise.resolve();
  // コミット前レビュー指摘 #15: providerオブジェクト同一性ではなく、実際に接続している
  // 管理ルート（Dropboxの名前空間+絶対パス）を文字列キーにしたSetで移行スキップを判定する。
  // WeakSet<provider> は「同じprovider参照のままワークスペースを切り替える」実装（共有
  // フォルダ切替・アカウント切替でprovider自体を作り直さない構成）だと、切替後の未移行
  // ルートに対しても誤って「移行済み」と判定してしまう。
  // ルートを解決できない場合（リゾルバ未読込等）は、Desktopの「プロセス（相当）につき
  // 1回」という頻度に合わせてprovider単位のフォールバックキャッシュへ倒す（毎回無条件で
  // 再スキャンすると、Desktop側の一度きり移行と再スキャン頻度がずれ、同一プロセス内で
  // 後から作られたエントリだけCloud側が余分に移行してしまいDesktop/Cloudパリティが崩れる。
  // production-management-ux-improvement-plan-2026-08-04.md 関連のパリティテストで実際に
  // 検出した — test_meldex_production_engine_parity.py）。
  const PM_NAME_MIGRATED_ROOTS = new Set();
  const PM_SCHEMA_CLEANUP_MIGRATED_ROOTS = new Set();
  const PM_INTERNAL_METADATA_MIGRATED_ROOTS = new Set();
  const PM_NAME_MIGRATED_PROVIDERS_FALLBACK = new WeakSet();
  const PM_SCHEMA_CLEANUP_MIGRATED_PROVIDERS_FALLBACK = new WeakSet();
  const PM_INTERNAL_METADATA_MIGRATED_PROVIDERS_FALLBACK = new WeakSet();
  function _pmCloudMigrationAlreadyDone(rootSet, providerFallback, migrationRootKey, provider) {
    return migrationRootKey ? rootSet.has(migrationRootKey) : providerFallback.has(provider);
  }
  function _pmCloudMarkMigrationDone(rootSet, providerFallback, migrationRootKey, provider) {
    if (migrationRootKey) rootSet.add(migrationRootKey);
    else providerFallback.add(provider);
  }
  const PM_TASK_LEGACY_NAME_PROP = 'タスク名';
  // 制作管理UX改善計画（2026-08-04）§5-1: タスクリスト（+作品別シート）だけの内部専用列。
  // 「プロパティ（列）」から外し production_internal: へ移す。Desktop
  // meldex_production_management_support.INTERNAL_METADATA_PROPERTIES と同一集合
  // （parityはtest_meldex_production_schema_cleanup.pyで検証）。作品リストにも同名の列
  // （階層ラベル/プリセット種別/作業作成粒度）があるが別概念のため対象外 — 書込み側は必ず
  // タスクシートかどうかを先に判定してからこの集合を適用すること。
  const PM_INTERNAL_METADATA_PROPERTIES = new Set([
    '階層パス', '階層ラベル',
    '単位レベル1', '単位レベル2', '単位レベル3', '単位レベル4', '単位レベル5',
    'プリセット種別', '作業作成粒度', 'ページソート値', '作成キー', '元テンプレートID', '作業予定区間',
  ]);
  // 制作管理UX改善計画（2026-08-04）§5-1: 既定表示列を状況/担当者/作業予定日時/目標作業時間/
  // 作業時間_実績/優先度/作業対象リスト/作業内容リスト/作業規模リスト/対象数/対象色/備考へ
  // 絞る。コミット前レビュー指摘 #7: 階層パス等の内部専用列は移行後は property_types に
  // 存在しないため本来このリストは無意味だが、移行がまだ完了していないワークスペース
  // （新規行、移行キャッシュがヒットする前の一時的な状態等）では properties に残った
  // ままになり得るため、防御的に既定非表示へ含めておく（未移行データでも表に生JSONが
  // 出ないように）。
  const PM_TASK_HIDDEN_COLUMNS = [
    PM_TASK_LEGACY_NAME_PROP, '開始日時', '完了日時', '作業予定時間', '目標作業時間_値',
    '再計算ロック', '担当者固定', 'シフト固定', 'シフト割当不能理由', 'ページ', 'コマ', '作品タイトル',
    ...PM_INTERNAL_METADATA_PROPERTIES,
  ];
  const PM_SHIFT_PARSER = window.MeldexProductionShiftParser;
  // YAML-liteフロントマター読み書きと権限エラー判定は gb-cloud-frontmatter-lite.js（共有ヘルパー）へ委譲。
  // 実装本体・仕様の説明はそちらを参照（Python meldex_frontmatter 互換）。
  const _pmCloudReadFrontmatter = window.MeldexCloudFrontmatterLite.readFrontmatter;
  const _pmCloudFrontmatterText = window.MeldexCloudFrontmatterLite.frontmatterText;
  const _pmCloudIsNotFoundError = window.MeldexCloudFrontmatterLite.isNotFoundError;
  const _pmCloudIsWriteAccessError = window.MeldexCloudFrontmatterLite.isWriteAccessError;
  function _pmTaskRowEntryName(row) {
    return String(row?._entry_name || row?.['エントリ名'] || row?.[PM_TASK_LEGACY_NAME_PROP] || row?.name || '無題').trim() || '無題';
  }
  function _pmTaskRowProps(row) {
    const out = {};
    Object.entries(row || {}).forEach(([key, value]) => {
      if (key === '_entry_name' || key === 'エントリ名' || key === PM_TASK_LEGACY_NAME_PROP) return;
      out[key] = value;
    });
    return out;
  }
  function _pmWorkPeriodValue(body) {
    const source = body || {};
    for (const key of ['work_period', '作業期間', 'period']) {
      const value = String(source[key] || '').trim();
      if (value) return value;
    }
    const start = String(source.work_start || source['開始日時'] || '').trim();
    const end = String(source.work_end || source['完了日時'] || source['終了日時'] || '').trim();
    return start && end ? `${start}|${end}` : '';
  }
  const PM_PROPERTY_TYPES = window.MeldexProductionSchemaDefinitions.PROPERTY_TYPES;

  const PM_SEEDS = window.MeldexProductionSchemaDefinitions.SEEDS;

  function _pmShowStatus(message, error) {
    if (typeof showStatus === 'function') showStatus(message, !!error);
    else console[error ? 'error' : 'log'](message);
  }

  function _pmEnsureWritable(options = {}) {
    const ensureWritable = window.MeldexProductionUiAvailability?.ensureWritable;
    return typeof ensureWritable !== 'function' || ensureWritable(options);
  }

  function _pmRecoveryText(base, result) {
    return result?.recovered_count ? `${base}（不足していた制作管理ファイルを自動復旧しました）` : base;
  }

  function _pmRequest(path, options) {
  const method = String(options?.method || 'GET').toUpperCase();
  const body = options?.body || {};
  if (method === 'POST' && typeof apiPost === 'function') return apiPost(path, body);
  if (typeof apiFetch === 'function') {
    if (method === 'GET') return apiFetch(path);
    return apiFetch(path, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
  }
  if (window.MeldexDataAccess?.requestJson) return window.MeldexDataAccess.requestJson(path, { method, body });
    throw new Error('制作管理APIを呼び出せません');
  }

  function _pmButton(label, primary, e2eId = '') {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = primary ? 'gb-btn gb-btn-sm gb-btn-primary' : 'gb-btn gb-btn-sm';
    button.textContent = label;
    if (e2eId) button.dataset.e2eId = e2eId;
    return button;
  }

  function _pmField(labelText, input) {
    const field = document.createElement('label');
    field.className = 'field gb-production-field';
    const label = document.createElement('span');
    label.className = 'gb-production-field-label';
    label.textContent = labelText;
    field.append(label, input);
    return field;
  }

  function _pmInput(value, placeholder) {
    const input = document.createElement('input');
    input.type = 'text';
    input.value = value || '';
    input.placeholder = placeholder || '';
    input.className = 'gb-input gb-input-sm gb-production-input';
    return input;
  }

  function _pmSelect(options, value) {
    const select = document.createElement('select');
    select.className = 'gb-select gb-select-sm gb-production-input';
    options.forEach((item) => {
      const option = document.createElement('option');
      option.value = item;
      option.textContent = item;
      option.selected = item === value;
      select.appendChild(option);
    });
    return select;
  }

  function _pmModal(title, options = {}) {
    const focusSource = options.trigger || (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    const dialogE2eId = options.dialogE2eId || 'production-dialog';
    let busy = false;
    const dialogApi = window.GBUI.createModal({
      id: `${dialogE2eId}-common`,
      titleId: `${dialogE2eId}-title`,
      title,
      variant: 'standard',
      extraClass: 'gb-production-modal',
      geometryKey: dialogE2eId,
      minWidth: '0',
      initialFocus: modal => modal.querySelector('input:not([disabled]), textarea:not([disabled]), select:not([disabled]), button:not([disabled])'),
      returnFocus: focusSource,
      closeOnEsc: true,
      closeOnOverlay: true,
      onBeforeClose: reason => !busy || reason === 'complete',
    });
    const { overlay, modal, header, body, footer } = dialogApi;
    overlay.classList.add('modal-overlay', 'gb-production-modal-overlay');
    overlay.dataset.e2eId = options.e2eId || 'production-dialog-overlay';
    modal.classList.add('modal');
    modal.style.setProperty('--gb-production-modal-width', options.width || '720px');
    modal.dataset.e2eId = dialogE2eId;
    header.classList.add('gb-production-modal-header');
    const heading = header.querySelector('.gb-modal-title');
    heading?.classList.add('gb-production-title');
    const closeButton = header.querySelector('.gb-modal-close');
    closeButton?.classList.add('gb-production-modal-close');
    closeButton.setAttribute('aria-label', `${title}を閉じる`); closeButton.dataset.e2eId = `${dialogE2eId}-close`;
    body.classList.add('gb-production-modal-body');
    footer.classList.add('gb-production-modal-footer'); footer.dataset.modalFooter = '1';
    const status = document.createElement('div');
    Object.assign(status, { className: 'gb-production-dialog-status', hidden: true });
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    const close = (reason = 'programmatic') => dialogApi.close(reason);
    Object.assign(close, { footer, body, status });
    close.showStatus = (message, error = false) => {
      status.textContent = String(message || '');
      status.hidden = !status.textContent;
      status.dataset.statusKind = error ? 'error' : 'info';
    };
    close.setBusy = (next) => {
      busy = !!next;
      overlay.setAttribute('aria-busy', busy ? 'true' : 'false');
      closeButton.disabled = busy;
    };
    queueMicrotask(() => dialogApi.open());
    return { overlay, modal, body, close };
  }

  function _pmFooter(closeModal, okLabel, onOk, options = {}) {
    const footer = closeModal.footer || document.createElement('div');
    footer.classList.add('gb-modal-footer', 'gb-production-modal-footer');
    footer.dataset.modalFooter = '1';
    footer.replaceChildren();
    const status = closeModal.status;
    if (status && closeModal.body && !status.isConnected) closeModal.body.appendChild(status);
    const e2ePrefix = String(options.e2eIdPrefix || '').trim();
    const cancel = _pmButton('キャンセル', false, e2ePrefix && `${e2ePrefix}-cancel`);
    const ok = _pmButton(okLabel, true, e2ePrefix && `${e2ePrefix}-primary`);
    if (options.write) window.MeldexProductionUiAvailability?.markWriteControl?.(ok);
    cancel.addEventListener('click', () => closeModal('cancel'));
    ok.addEventListener('click', async () => {
      const modal = footer.closest('.gb-production-modal');
      const controls = Array.from(modal?.querySelectorAll('input, textarea, select, button') || []);
      const priorDisabled = controls.map(control => control.disabled);
      controls.forEach(control => { control.disabled = true; });
      closeModal.setBusy?.(true);
      closeModal.showStatus?.('処理中です。画面を閉じずにお待ちください…');
      try {
        await onOk();
        closeModal('complete');
      } catch (err) {
        closeModal.showStatus?.(err?.message || String(err), true);
        _pmShowStatus(err?.message || String(err), true);
      } finally {
        closeModal.setBusy?.(false);
        controls.forEach((control, index) => { control.disabled = priorDisabled[index]; });
      }
    });
    footer.append(cancel, ok);
    return footer;
  }

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
    if (!_pmEnsureWritable({ notify: !options.silent })) return null;
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
    // 制作管理UX改善計画（2026-08-04）§4-4: Google送信がCloudにも対応したため、Dropboxモード
    // 除外は撤去した。Cloud未接続時は runProductionExternalSync が silent:true のもと
    // result.message だけを受け取り、通知を出さずに静かに終わる（15分毎の無駄な失敗表示を避ける）。
    const status = await _pmRequest('/production-management/status', { method: 'GET' }).catch(() => null);
    if (!status?.ready) return;
    await runProductionExternalSync({ silent: true });
  }

  function _pmStartExternalSyncTimer() {
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
    const kind = _pmSelect(['all', 'shifts', 'attendance', 'work'], 'all');
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

  // コミット前レビュー指摘（2026-08-05、部分行数超過対応）: シフト取込XLSX/ZIP解析
  // ユーティリティ（_pmParseShiftFile 以下）は gb-production-management.part03.js
  // （CSV/XLSX/ZIP書き出しユーティリティと同じテーマ）へ移動した。同一クロージャの
  // raw concatenation のため参照は変わらず利用できる。

  function _pmCalendarStorePath(internals, name) {
    return internals._joinPath('_calendar', name + '.json');
  }

  async function _pmReadCalendarStore(provider, internals, name) {
    const rows = await internals._readJsonSafe(provider, _pmCalendarStorePath(internals, name), []);
    return Array.isArray(rows) ? rows : [];
  }

  async function _pmWriteCalendarStore(provider, internals, name, rows) {
    await internals._directoryHandle(provider, '_calendar', true);
    await provider.writeJson(_pmCalendarStorePath(internals, name), Array.isArray(rows) ? rows : []);
  }

  function _pmCloudShiftEndDate(shift) {
    const startTime = String(shift?.start_time || '');
    const endTime = String(shift?.end_time || startTime);
    if (startTime && endTime && endTime <= startTime) return _pmAddDay(shift.date);
    return String(shift?.date || '');
  }

  async function _pmEnsureCloudCalendar(provider, internals, name, color, source, user) {
    const rows = await _pmReadCalendarStore(provider, internals, 'calendars');
    const owner = user || 'system';
    const found = rows.find(row => row.name === name && row.source === source && (row.user || 'system') === owner);
    if (found?.id) return found.id;
    const id = globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : 'cal_' + Date.now().toString(36);
    rows.push({ id, name, color, user: owner, source, visible: 1, sort_order: 0, folder: 'シフトカレンダー', edit_role: 'owner', created: new Date().toISOString() });
    await _pmWriteCalendarStore(provider, internals, 'calendars', rows);
    return id;
  }

  async function _pmSyncCloudShiftEvent(provider, shift) {
    const internals = window.__MeldexPwaDataAccessInternals;
    const shiftId = String(shift?.id || '');
    const date = String(shift?.date || '');
    if (!internals || !shiftId || !date) return;
    const username = String(shift.user || 'anonymous');
    const calendarId = await _pmEnsureCloudCalendar(provider, internals, `シフト: ${username}`, '#d19a66', 'shift', username);
    const startTime = String(shift.start_time || '');
    const endTime = String(shift.end_time || startTime);
    const allDay = startTime ? 0 : 1;
    const start = allDay ? date : `${date}T${startTime}`;
    const end = allDay ? date : `${_pmCloudShiftEndDate(shift)}T${endTime || startTime}`;
    const label = { work: '勤務', off: '休み', holiday: '祝日' }[shift.type] || shift.type || 'シフト';
    const eventId = `shift:${shiftId}`;
    const rows = (await _pmReadCalendarStore(provider, internals, 'events')).filter(row => String(row.id) !== eventId);
    rows.push({ id: eventId, title: `シフト ${username}: ${label}`, start, end, all_day: allDay, color: '#d19a66', description: shift.note || '', location: '', url: '', recurrence: '', external_id: shiftId, calendar_source: 'shift', user: username, creator: username, calendar_id: calendarId, alert_minutes: -1, created: shift.created || new Date().toISOString(), modified: new Date().toISOString() });
    await _pmWriteCalendarStore(provider, internals, 'events', rows);
  }

  async function _pmRemoveCloudShiftEvent(provider, shiftId) {
    const internals = window.__MeldexPwaDataAccessInternals;
    if (!internals) return;
    const eventId = `shift:${shiftId}`;
    const rows = await _pmReadCalendarStore(provider, internals, 'events');
    await _pmWriteCalendarStore(provider, internals, 'events', rows.filter(row => {
      const id = String(row.id || '');
      return id !== eventId && !id.startsWith(eventId + ':break:');
    }));
  }

  function _pmCloudShiftPairKey(row) {
    return [String(row?.user || ''), String(row?.date || '')].join('\u0000');
  }

  async function _pmCloudDeleteScheduleEntry(provider, path) {
    if (!path || typeof provider?.deletePath !== 'function') return false;
    await provider.deletePath(path);
    return true;
  }

  async function _pmCloudDeleteShiftRecord(provider, internals, shiftId) {
    try {
      await window.MeldexDataAccess.requestJson('/cal/shifts/' + encodeURIComponent(shiftId), { method: 'DELETE' });
      return true;
    } catch {}
    const rows = await _pmReadCalendarStore(provider, internals, 'shifts');
    await _pmWriteCalendarStore(provider, internals, 'shifts', rows.filter(row => String(row.id) !== String(shiftId)));
    await _pmRemoveCloudShiftEvent(provider, shiftId);
    return true;
  }

  async function _pmCloudCleanupExistingShifts(provider, internals, rows, journal) {
    const targetPairs = new Set((rows || []).map(_pmCloudShiftPairKey).filter(key => !key.startsWith('\u0000') && !key.endsWith('\u0000')));
    if (!targetPairs.size) return { removed_ids: [] };
    const currentRows = await window.MeldexDataAccess.requestJson('/cal/shifts').catch(() => _pmReadCalendarStore(provider, internals, 'shifts'));
    const removedIds = [];
    for (const current of currentRows || []) {
      const id = String(current?.id || '');
      if (!id.startsWith('pm-shift-')) continue;
      const normalized = _pmNormalizeIncomingShift(current);
      if (!normalized || !targetPairs.has(_pmCloudShiftPairKey(normalized))) continue;
      removedIds.push(id);
    }
    for (const shiftId of [...new Set(removedIds)]) {
      await _pmCloudDeleteShiftRecord(provider, internals, shiftId);
      const schedulePath = await _pmCloudFindByProp(provider, internals, 'スケジュール', '作成キー', shiftId);
      if (schedulePath && journal) await _pmCloudJournalText(journal, schedulePath);
      await _pmCloudDeleteScheduleEntry(provider, schedulePath);
    }
    return { removed_ids: [...new Set(removedIds)] };
  }

  function _pmInstallCloudHandler() {
    const internals = window.__MeldexPwaDataAccessInternals;
    const handlers = window.__MeldexPwaDataAccessExtensions;
    if (!internals || !Array.isArray(handlers)) return;
    handlers.push(async function _productionManagementCloudHandler({ method, body, url, pathname }) {
      if (pathname === '/entity/rename' && method === 'POST'
        && window.MeldexProductionSchemaMigration?.isManagedEntryPath?.(body?.path)) {
        const provider = await internals._requirePwaProvider('readwrite');
        return _pmCloudRenameManagedEntry(provider, internals, body || {});
      }
      if (!/^\/production-management(\/|$)/.test(pathname)) return internals.NOT_HANDLED;
      const migrateOnFirstDisplay = method === 'GET' && [
        '/production-management/lists',
        '/production-management/task-sheets',
        '/production-management/task-create-catalog',
      ].includes(pathname);
      const readOnlyRequest = method === 'GET' || (method === 'POST' && [
        '/production-management/tasks/query',
        '/production-management/tasks/preview',
        '/production-management/tasks/structure/preview',
        '/production-management/recalculate/preview',
        '/production-management/assign/preview',
      ].includes(pathname));
      const provider = await internals._requirePwaProvider(readOnlyRequest ? 'read' : 'readwrite');
      let migrationMeta = {};
      if (migrateOnFirstDisplay) {
        // コミット前レビュー指摘 #15: provider同一性ではなく管理ルートキーで判定する
        // （解決できない場合はprovider単位のフォールバックへ。_pmCloudMigrationAlreadyDone参照）。
        const rootKey = await _pmCloudRootMigrationKey(provider);
        const alreadyMigrated = _pmCloudMigrationAlreadyDone(PM_NAME_MIGRATED_ROOTS, PM_NAME_MIGRATED_PROVIDERS_FALLBACK, rootKey, provider);
        if (!alreadyMigrated) {
          let writableProvider = null;
          try {
            writableProvider = await internals._requirePwaProvider('readwrite');
          } catch (error) {
            migrationMeta = { read_only: true, migration_skipped: true, migration_message: String(error?.message || error) };
          }
          if (writableProvider) {
            try {
              await _pmCloudWithProductionLease(writableProvider, () => (
                _pmCloudMigrationAlreadyDone(PM_NAME_MIGRATED_ROOTS, PM_NAME_MIGRATED_PROVIDERS_FALLBACK, rootKey, writableProvider)
                  ? Promise.resolve() : _pmCloudInit(writableProvider, internals)
              ));
              _pmCloudMarkMigrationDone(PM_NAME_MIGRATED_ROOTS, PM_NAME_MIGRATED_PROVIDERS_FALLBACK, rootKey, provider);
            } catch (error) {
              const readOnly = _pmCloudIsWriteAccessError(error);
              if (!readOnly && Number(error?.status || 0) !== 423) throw error;
              migrationMeta = { read_only: readOnly, migration_skipped: true, migration_message: String(error?.message || error) };
            }
          }
        }
      }
      if (pathname === '/production-management/status' && method === 'GET') return _pmCloudStatus(provider, internals);
      if (pathname === '/production-management/summary' && method === 'GET') return _pmCloudSummary(provider, internals);
      if (pathname === '/production-management/lists' && method === 'GET') return { ...await _pmCloudList(provider, internals, url), ...migrationMeta };
      if (pathname === '/production-management/task-sheets' && method === 'GET') return { ...await _pmCloudTaskSheets(provider, internals), ...migrationMeta };
      if (pathname === '/production-management/task-create-catalog' && method === 'GET') return { ...await _pmCloudTaskCreateCatalog(provider, internals), ...migrationMeta };
      if (pathname === '/production-management/tasks/query' && method === 'POST') return _pmCloudQueryTasks(provider, internals, body || {});
      if (pathname === '/production-management/entries' && (method === 'POST' || method === 'PATCH')) {
        return _pmCloudWithProductionLease(provider, () => method === 'POST'
          ? _pmCloudCreateEntry(provider, internals, body || {})
          : _pmCloudPatchEntry(provider, internals, body || {}));
      }
      if (pathname === '/production-management/task-by-event' && method === 'GET') return _pmCloudTaskByEvent(provider, internals, url);
      if (pathname === '/production-management/tasks/from-template' && method === 'POST') {
        return _pmCloudWithProductionLease(provider, () => _pmCloudCreateFromTemplate(provider, internals, body || {}));
      }
      if (pathname === '/production-management/task-sheets' && method === 'POST') {
        return _pmCloudWithProductionLease(provider, () => _pmCloudCreateTaskSheet(provider, internals, body || {}));
      }
      if (pathname === '/production-management/init' && method === 'POST') {
        return _pmCloudWithProductionLease(provider, () => _pmCloudInit(provider, internals, {
          migrateLegacyWorkspace: true,
          forceNameMigration: true,
        }));
      }
      if (pathname === '/production-management/tasks/preview' && method === 'POST') return _pmCloudPreviewTasks(provider, internals, body || {});
      if (pathname === '/production-management/tasks/create' && method === 'POST') return _pmCloudCreateTasks(provider, internals, body || {});
      if (pathname === '/production-management/tasks/structure/preview' && method === 'POST') return _pmCloudPreviewTaskStructure(provider, internals, body || {});
      if (pathname === '/production-management/tasks/structure/apply' && method === 'POST') {
        return _pmCloudWithProductionLease(provider, () => _pmCloudApplyTaskStructure(provider, internals, body || {}));
      }
      if (pathname === '/production-management/shifts/apply' && method === 'POST') {
        return _pmCloudWithProductionLease(provider, () => _pmCloudApplyShifts(provider, internals, body || {}));
      }
      if (pathname === '/production-management/staff/add' && method === 'POST') {
        return _pmCloudWithProductionLease(provider, () => _pmCloudAddStaff(provider, internals, body || {}));
      }
      // 「担当者と時間を割り当て」（旧: 簡易割当）はフル再計算エンジンへ一本化した
      // （production-management-ux-improvement-plan-2026-08-04.md §4-1）。unassigned_only
      // スコープ（作業予定日時が空で保護されていないタスクだけを新規割当対象にし、他のタスクは
      // 既存予定を固定扱いで尊重する）でフル再計算を実行する。レスポンス形は互換維持。
      if (pathname === '/production-management/assign/preview' && method === 'POST') {
        const result = await window.MeldexProductionRecalcCloudAdapter.previewCloud(provider, internals, { ...(body || {}), unassigned_only: true }, _pmRecalcEngineDeps());
        if (!result.ok) return result;
        return { ok: true, rows: result.rows || [], count: (result.rows || []).length, cloud: true };
      }
      if (pathname === '/production-management/assign/apply' && method === 'POST') {
        return _pmCloudWithProductionLease(provider, async () => {
          const result = await window.MeldexProductionRecalcCloudAdapter.applyCloud(provider, internals, { ...(body || {}), unassigned_only: true }, _pmRecalcEngineDeps());
          if (!result.ok) return result;
          return { ok: true, updated: result.applied || 0, rows: [], cloud: true };
        });
      }
      if (pathname === '/production-management/recalculate/preview' && method === 'POST') return window.MeldexProductionRecalcCloudAdapter.previewCloud(provider, internals, body || {}, _pmRecalcEngineDeps());
      if (pathname === '/production-management/recalculate/apply' && method === 'POST') return _pmCloudWithProductionLease(provider, () => window.MeldexProductionRecalcCloudAdapter.applyCloud(provider, internals, body || {}, _pmRecalcEngineDeps()));
      if (pathname === '/production-management/tasks/lock' && method === 'POST') return _pmCloudWithProductionLease(provider, () => window.MeldexProductionRecalcCloudAdapter.lockCloud(provider, internals, body || {}, _pmRecalcEngineDeps()));
      // 制作管理UX改善計画（2026-08-04）§6-4: カレンダー上のタスク予定のドラッグ移動・端リサイズ。
      if (pathname === '/production-management/task-schedule/update' && method === 'POST') {
        return _pmCloudWithProductionLease(provider, () => window.MeldexProductionRecalcCloudAdapter.updateTaskScheduleCloud(provider, internals, body || {}, _pmRecalcEngineDeps()));
      }
      // 制作管理UX改善計画（2026-08-04）§4-4: Google送信のみCloud対応（Phase 5のブラウザ完結OAuth基盤
      // に乗る）。CalDAV送信（ローカルサーバー常駐が必要）はDesktop限定のまま。未接続時はエラーで
      // はなく案内メッセージを返す（gb-production-external-sync-cloud.js の syncGoogle 参照）。
      // Google APIへのネットワークI/Oはワークスペースの書き込みロックを保持せずに行う
      // （Desktop sync_production_external_calendars と同じ方針。遅い外部I/Oが他の書き込みを
      // ブロックしないようにする）。
      if (pathname === '/production-management/external-sync' && method === 'POST') {
        if (!window.MeldexProductionExternalSyncCloud?.syncGoogle) {
          return { ok: false, unsupported: true, message: '外部カレンダー送信はデスクトップ版で設定してください' };
        }
        return window.MeldexProductionExternalSyncCloud.syncGoogle(provider, internals, _pmRecalcEngineDeps(), body || {});
      }
      if (pathname === '/production-management/export' && method === 'GET') return _pmCloudExport(url);
      return internals.NOT_HANDLED;
    });
  }

  function _pmCloudRoot(internals) {
    return internals._joinPath(PM_ROOT, 'シート');
  }

  // コミット前レビュー指摘 #15: 移行スキップキャッシュ用の安定キー。実際に接続している
  // Dropbox名前空間+絶対ルートパスを合成する（gb-dropbox-management-root-resolver.js。
  // ワークスペース切替を正しく検知できるのはこちらで、`制作管理/シート` のような
  // provider内相対パスでは複数ワークスペースが同じ文字列に潰れてしまうため使わない）。
  // 解決できない場合（リゾルバ未読込・未接続等）は空文字を返し、呼び出し側はキャッシュを
  // 使わず毎回移行を試みる。
  async function _pmCloudRootMigrationKey(provider) {
    try {
      const resolver = window.MeldexDropboxManagementRootResolver;
      if (!resolver?.resolveConnectionInfo) return '';
      const info = await resolver.resolveConnectionInfo(provider);
      const key = `${String(info?.namespaceKind || '')}:${String(info?.rootPath || '')}`.toLowerCase();
      return key === ':' ? '' : key;
    } catch (err) {
      console.warn('制作管理: 管理ルートの解決に失敗しました。移行スキップキャッシュを無効化します:', err);
      return '';
    }
  }

  async function _pmCloudStatus(provider, internals) {
    const missing = await _pmCloudMissing(provider, internals);
    return { ok: true, root: PM_ROOT, missing, ready: missing.length === 0, repairable: !!missing.length, message: missing.length ? '制作管理に必要なファイルが一部見つかりません。「制作管理を始める」で自動復旧できます。' : '', cloud: true };
  }

  async function _pmCloudSummary(provider, internals) {
    const [works, tasks, contents] = await Promise.all([
      _pmCloudListEntries(provider, internals, '作品リスト'),
      _pmCloudListAllTaskEntries(provider, internals),
      _pmCloudListEntries(provider, internals, '作業内容リスト'),
    ]);
    return { ok: true, root: PM_ROOT, counts: { works: works.length, tasks: tasks.length, contents: contents.length }, cloud: true };
  }

  async function _pmCloudList(provider, internals, url) {
    const aliases = { works: '作品リスト', tasks: 'タスクリスト', contents: '作業内容リスト', targets: '作業対象リスト', scales: '作業規模リスト' };
    const requested = String(url?.searchParams?.get('sheet') || 'タスクリスト');
    const sheet = aliases[requested] || requested;
    const q = String(url?.searchParams?.get('q') || '').trim().toLocaleLowerCase('ja');
    const limit = Math.max(1, Math.min(5000, Number(url?.searchParams?.get('limit') || 100) || 100));
    const entries = sheet === 'タスクリスト'
      ? await _pmCloudListAllTaskEntries(provider, internals)
      : await _pmCloudListEntries(provider, internals, sheet);
    const rows = entries.map(_pmCloudEntryRow).filter(row => {
      if (!q) return true;
      return `${row.name}\n${Object.values(row.properties).join('\n')}`.toLocaleLowerCase('ja').includes(q);
    });
    return { ok: true, sheet, rows: rows.slice(0, limit), count: rows.length, root: PM_ROOT, cloud: true };
  }

  async function _pmCloudTaskSheets(provider, internals, cachedWorks = null) {
    const works = Array.isArray(cachedWorks)
      ? cachedWorks
      : await _pmCloudListEntries(provider, internals, '作品リスト', { concurrency: 8 });
    const rows = await _pmCloudMapBounded(works, 8, async work => {
      const workTitle = work.name || _pmCloudPropValue(work.frontmatter, '作品タイトル_話数')
        || _pmCloudPropValue(work.frontmatter, '作品タイトル');
      const sheetName = _pmCloudPropValue(work.frontmatter, 'タスクリストシート');
      if (!sheetName) return null;
      const entries = await _pmCloudDirectoryEntries(provider, internals, internals._joinPath(_pmCloudRoot(internals), sheetName));
      const count = entries.filter(entry => entry?.handle?.kind === 'file' && String(entry.name || '').endsWith('.md') && entry.name !== sheetName + '.md').length;
      return {
        sheet_name: sheetName,
        work_title: workTitle,
        dir: internals._joinPath(_pmCloudRoot(internals), sheetName),
        count,
      };
    });
    const resolved = rows.filter(Boolean), registered = new Set(resolved.map(row => String(row.sheet_name).toLocaleLowerCase('ja'))); await Promise.all((await _pmCloudTaskSheetNames(provider, internals, works)).filter(name => !registered.has(String(name).toLocaleLowerCase('ja'))).map(async sheetName => { const dir = internals._joinPath(_pmCloudRoot(internals), sheetName), entries = await _pmCloudDirectoryEntries(provider, internals, dir); resolved.push({ sheet_name: sheetName, work_title: sheetName === 'タスクリスト_未分類' ? '' : String(sheetName).replace(/^タスクリスト_/, ''), dir, count: entries.filter(entry => entry?.handle?.kind === 'file' && String(entry.name || '').endsWith('.md') && entry.name !== sheetName + '.md').length }); })); return { ok: true, root: PM_ROOT, sheets: resolved, cloud: true };
  }

  function _pmCloudLegacyTaskWorkTitle(entry) {
    const properties = entry?.frontmatter?.properties || {};
    const hasWorkProperty = Object.prototype.hasOwnProperty.call(properties, '作品タイトル')
      || Object.prototype.hasOwnProperty.call(properties, '作品タイトル_話数');
    const explicit = _pmCloudPropValue(entry?.frontmatter, '作品タイトル')
      || _pmCloudPropValue(entry?.frontmatter, '作品タイトル_話数');
    if (hasWorkProperty) return explicit.trim() || '未分類';
    const keyParts = _pmCloudPropValue(entry?.frontmatter, '作成キー').split('|');
    const inferred = keyParts.length > 4 ? keyParts.slice(0, -4).join('|').trim() : '';
    return inferred || '未分類';
  }

  function _pmCloudAllocateTaskSheetName(workTitle, usedSheets) {
    const base = PM_TASK_SHEET_PREFIX + _pmSafeName(workTitle).slice(0, 100);
    let candidate = base;
    let suffix = 1;
    while (usedSheets.has(candidate.toLocaleLowerCase('ja'))) {
      suffix += 1;
      candidate = `${base}-${suffix}`;
    }
    usedSheets.add(candidate.toLocaleLowerCase('ja'));
    return candidate;
  }

  async function _pmCloudMapBounded(items, limit, mapper) {
    const source = Array.from(items || []);
    const results = new Array(source.length);
    let cursor = 0;
    let firstError = null;
    async function worker() {
      while (!firstError) {
        const index = cursor++;
        if (index >= source.length) return;
        try { results[index] = await mapper(source[index], index); }
        catch (error) { firstError ||= error; }
      }
    }
    await Promise.all(Array.from({ length: Math.min(Math.max(1, limit || 1), source.length) }, worker));
    if (firstError) throw firstError;
    return results;
  }

  async function _pmCloudCreateTaskSheet(provider, internals, body) {
    await _pmCloudInit(provider, internals);
    const workTitle = String(body?.work_title || '').trim();
    if (!workTitle) throw new Error('work_title は必須です');
    const sheetName = await _pmCloudEnsureWorkTaskSheet(provider, internals, workTitle);
    await _pmCloudUpsertEntry(provider, internals, '作品リスト', workTitle, {
      'タスクリストシート': sheetName,
    }, '', '', { reuseName: true });
    return { ok: true, sheet_name: sheetName, work_title: workTitle, dir: internals._joinPath(_pmCloudRoot(internals), sheetName), cloud: true };
  }

  async function _pmCloudAddStaff(provider, internals, body) {
    // 「メンバーを追加」は正本『スタッフ管理シート』への upsert へ委譲する
    // （アカウント一元管理計画書 Phase 4 §5.9手順4・手順5）。スタッフは制作管理
    // ルートごとではなく全体で1枚の正本を共有するため、制作管理の初期化・
    // 一意チェック・書き込みはもう不要（正本自体の保護は window.MeldexUserRegistry
    // が担う）。スキル（旧「担当できる作業」）は正本に存在しない列のため一切
    // 扱わない（計画書§5.5、作業内容リストの「担当者候補」側で設定する）。
    // クラウド静的版のtwin実装（gb-staff-registry-cloud-twin.js、2026-07-20）
    // により実動作する。真のエラー（例: ユーザー重複の409）はここで案内文へ
    // すり替えず、そのまま呼び出し元（openProductionStaffAdd の catch）へ
    // 伝播させる。
    const name = String(body?.name || body?.user || '').trim();
    if (!name) throw new Error('メンバー名は必須です');
    // 「ユーザーを選択（未連携も可）」— user が明示されていない限り name を
    // ユーザーIDへ代用しない（表示名だけの未連携行を許す。
    // meldex_staff_registry_service.upsert_staff の同じ配慮と揃えている）。
    const entry = {
      user: String(body?.user || '').trim(),
      display: String(body?.display || '').trim() || name,
      role: String(body?.role_label || body?.role || '').trim(),
      work_hours: String(body?.work_hours || '').trim(),
      break_hours: String(body?.break_hours || '').trim(),
      holidays: String(body?.holidays || '').trim(),
      active_from: String(body?.active_from || '').trim(),
      active_to: String(body?.active_to || '').trim(),
      google_url: String(body?.google_url || '').trim(),
      caldav_url: String(body?.caldav_url || '').trim(),
      sync_enabled: !!body?.sync_enabled,
      note: String(body?.note || '').trim(),
    };
    await window.MeldexUserRegistry.upsertStaff(entry, { fillOnly: false });
    return { ok: true, staff: name, cloud: true };
  }

  async function _pmCloudTaskSheetForWork(provider, internals, workTitle) {
    const existingWork = await _pmCloudFindByName(provider, internals, '作品リスト', workTitle)
      || await _pmCloudFindByProp(provider, internals, '作品リスト', '作品タイトル_話数', workTitle);
    if (existingWork) {
      const parsed = await _pmCloudReadFrontmatter(provider, existingWork);
      const registered = _pmCloudPropValue(parsed.frontmatter, 'タスクリストシート');
      if (registered) return registered;
    }
    const base = PM_TASK_SHEET_PREFIX + _pmSafeName(workTitle).slice(0, 100);
    const used = new Set();
    for (const work of await _pmCloudListEntries(provider, internals, '作品リスト')) {
      const registered = _pmCloudPropValue(work.frontmatter, 'タスクリストシート');
      if (registered) used.add(registered.toLocaleLowerCase('ja'));
    }
    let candidate = base;
    let suffix = 1;
    // 未登録の同名フォルダは、前回の途中失敗で先に作られた作品別シートとして再利用する。
    // 他作品が正式登録済みの場合だけ枝番へ進み、再試行で孤立シートを増やさない。
    while (used.has(candidate.toLocaleLowerCase('ja'))) {
      suffix += 1;
      candidate = `${base}-${suffix}`;
    }
    return candidate;
  }

  async function _pmCloudEnsureWorkTaskSheet(provider, internals, workTitle) {
    const sheet = await _pmCloudTaskSheetForWork(provider, internals, workTitle);
    await _pmCloudEnsureSheet(provider, internals, sheet, 'タスクリスト');
    return sheet;
  }

  async function _pmCloudInit(provider, internals, options = {}) {
    // コミット前レビュー指摘 #15: 以降のスキップキャッシュ判定はすべてこの1回だけ解決した
    // 管理ルートキーで揃える（provider同一性は使わない。解決できない場合はprovider単位の
    // フォールバックへ倒す。_pmCloudMigrationAlreadyDone参照）。
    const migrationRootKey = await _pmCloudRootMigrationKey(provider);
    // 名称衝突は制作管理ファイルへ一切書き込む前に検出する。
    const shouldMigrateNames = options.forceNameMigration
      || !_pmCloudMigrationAlreadyDone(PM_NAME_MIGRATED_ROOTS, PM_NAME_MIGRATED_PROVIDERS_FALLBACK, migrationRootKey, provider);
    const nameMigration = shouldMigrateNames
      ? await window.MeldexProductionSchemaMigration?.migrateManagedNameProperties?.(
        _pmCloudManagedNameContext(provider, internals)
      ) || { migrated: 0, staff_users_added: 0 }
      : { migrated: 0, staff_users_added: 0 };
    if (shouldMigrateNames) _pmCloudMarkMigrationDone(PM_NAME_MIGRATED_ROOTS, PM_NAME_MIGRATED_PROVIDERS_FALLBACK, migrationRootKey, provider);
    // 制作管理UX改善計画（2026-08-04）§5-2: 死に列に値が残っていれば production_schema_
    // cleanup へ退避してから削除する（非破壊）。名称移行と同じ管理ルート単位のスキップ
    // キャッシュで、毎リクエストの全件スキャンを避ける。
    const shouldMigrateSchemaCleanup = options.forceSchemaCleanupMigration
      || !_pmCloudMigrationAlreadyDone(PM_SCHEMA_CLEANUP_MIGRATED_ROOTS, PM_SCHEMA_CLEANUP_MIGRATED_PROVIDERS_FALLBACK, migrationRootKey, provider);
    if (shouldMigrateSchemaCleanup && window.MeldexProductionSchemaCleanup?.migrateProductionSchemaCleanup) {
      await window.MeldexProductionSchemaCleanup.migrateProductionSchemaCleanup(
        _pmCloudManagedNameContext(provider, internals)
      );
      _pmCloudMarkMigrationDone(PM_SCHEMA_CLEANUP_MIGRATED_ROOTS, PM_SCHEMA_CLEANUP_MIGRATED_PROVIDERS_FALLBACK, migrationRootKey, provider);
    }
    // コミット前レビュー指摘 #7: タスクリスト（+作品別シート）の内部専用列（PM_INTERNAL_
    // METADATA_PROPERTIES と同一集合。Desktop migrate_production_internal_metadata と同等）を
    // properties から production_internal へ一括移行する。移動のみで削除ではないため
    // 非破壊・冪等（既存の production_internal 値は上書きしない）。
    const shouldMigrateInternalMetadata = options.forceInternalMetadataMigration
      || !_pmCloudMigrationAlreadyDone(PM_INTERNAL_METADATA_MIGRATED_ROOTS, PM_INTERNAL_METADATA_MIGRATED_PROVIDERS_FALLBACK, migrationRootKey, provider);
    let internalMetadataMigration = { migrated: 0 };
    if (shouldMigrateInternalMetadata && window.MeldexProductionSchemaCleanup?.migrateProductionInternalMetadata) {
      internalMetadataMigration = await window.MeldexProductionSchemaCleanup.migrateProductionInternalMetadata(
        _pmCloudManagedNameContext(provider, internals)
      ) || { migrated: 0 };
      _pmCloudMarkMigrationDone(PM_INTERNAL_METADATA_MIGRATED_ROOTS, PM_INTERNAL_METADATA_MIGRATED_PROVIDERS_FALLBACK, migrationRootKey, provider);
    }
    const missing = await _pmCloudMissing(provider, internals);
    await internals._directoryHandle(provider, PM_ROOT, true);
    for (const [name, text] of Object.entries(PM_REQUIRED_PAGES)) await _pmCloudEnsurePage(provider, internals, name, text);
    for (const sheet of PM_SHEETS) await _pmCloudEnsureSheet(provider, internals, sheet);
    // 構造が揃っている場合は初期値を再シードしない（編集済みの作業内容・規模リスト等を巻き戻さない）
    if (missing.length) await _pmCloudSeed(provider, internals);
    const recovered = [...missing];
    const cal = await _pmCloudRecoverFromCalendar(provider, internals, missing);
    if (cal.shifts) recovered.push(`カレンダーからシフトを復旧: ${cal.shifts}件`);
    if (cal.tasks) recovered.push(`カレンダーから作業予定を復旧: ${cal.tasks}件`);
    const migration = options.migrateLegacyWorkspace
      ? await _pmCloudMigrateLegacyWorkspace(provider, internals)
      : { works: 0, copied: 0, removed: 0, conflict_copies_removed: 0 };
    return {
      ok: true,
      root: PM_ROOT,
      sheets: PM_SHEETS,
      cloud: true,
      legacy_works_registered: migration.works,
      legacy_migrated: migration.copied,
      legacy_removed: migration.removed,
      conflict_copies_removed: migration.conflict_copies_removed,
      managed_names_migrated: nameMigration.migrated,
      staff_users_added: nameMigration.staff_users_added,
      internal_metadata_migrated: internalMetadataMigration.migrated,
      ..._pmCloudRecoveryPayload(recovered),
    };
  }

  function _pmCloudManagedNameContext(provider, internals) {
    return {
      provider,
      rootPath: _pmCloudRoot(internals),
      listEntries: sheet => _pmCloudListEntries(provider, internals, sheet),
      listTaskSheets: () => _pmCloudTaskSheetNames(provider, internals),
      readFrontmatter: path => _pmCloudReadFrontmatter(provider, path),
      frontmatterText: _pmCloudFrontmatterText,
      safeName: _pmSafeName,
      entryPath: (sheet, name) => internals._joinPath(_pmCloudRoot(internals), sheet, `${name}.md`),
      notePath: sheet => internals._joinPath(_pmCloudRoot(internals), sheet, `${sheet}.md`),
      entryExists: path => _pmCloudEntryExists(provider, path, internals),
      moveEntry: (source, target) => internals._moveEntry(provider, source, target),
      readCalendarEvents: () => _pmReadCalendarStore(provider, internals, 'events'),
      writeCalendarEvents: rows => _pmWriteCalendarStore(provider, internals, 'events', rows),
    };
  }

  async function _pmCloudRenameManagedEntry(provider, internals, body) {
    const migration = window.MeldexProductionSchemaMigration;
    if (!migration?.isManagedEntryPath?.(body?.path)) return internals.NOT_HANDLED;
    const isTaskEntry = !!_pmCloudTaskSheetEntryInfo(internals, body?.path);
    const result = await _pmCloudWithProductionLease(provider, () => migration.renameManagedEntry(
      _pmCloudManagedNameContext(provider, internals),
      body?.path,
      body?.new_name,
      {
        expectedEntryId: body?.expected_entry_id,
        operationId: body?.operation_id,
      },
    ));
    // 手動リネームは「タスク名を固定」を立て、以後の分類変更で名前が自動更新されないように
    // する（meldex_production_task_name_autofill と同じ意図。production-management-ux-
    // improvement-plan-2026-08-04.md §4-3）。
    if (isTaskEntry && result?.ok && result?.new_path) {
      await _pmCloudMarkTaskNameFixed(provider, result.new_path);
    }
    return result;
  }

  async function _pmCloudMarkTaskNameFixed(provider, path) {
    const parsed = await _pmCloudReadFrontmatter(provider, path);
    const fm = { ...(parsed.frontmatter || {}) };
    // 制作管理UX改善計画（2026-08-04）§5-1: 「タスク名を固定」は production_internal
    // へ統一移動済み（gb-production-task-naming.js の isTaskNameFixed / Desktop
    // meldex_production_task_name_autofill._task_name_fixed と同じ場所）。旧トップレベル
    // フラグは新規には立てない（読み取り側のフォールバックとしてのみ残す）。
    fm.production_internal = fm.production_internal && typeof fm.production_internal === 'object' ? { ...fm.production_internal } : {};
    fm.production_internal.task_name_fixed = true;
    delete fm['タスク名を固定'];
    delete fm.task_name_auto_generated;
    await provider.writeText(path, _pmCloudFrontmatterText(fm, parsed.body || ''));
  }

  async function _pmCloudMissing(provider, internals) {
    const missing = [];
    for (const name of Object.keys(PM_REQUIRED_PAGES)) {
      if (!await _pmCloudEntryExists(provider, internals._joinPath(PM_ROOT, name), internals)) missing.push(`${PM_ROOT}/${name}`);
    }
    for (const sheet of PM_SHEETS) {
      const dir = internals._joinPath(_pmCloudRoot(internals), sheet);
      if (!await _pmCloudEntryExists(provider, dir, internals)) missing.push(`シート/${sheet}`);
      else if (!await _pmCloudEntryExists(provider, internals._joinPath(dir, sheet + '.md'), internals)) missing.push(`シート/${sheet}/${sheet}.md`);
    }
    return missing;
  }

  async function _pmCloudEntryExists(provider, path, internals) {
    try {
      if (typeof provider?.statPath === 'function') return !!(await provider.statPath(path));
      return !!(await internals._resolveEntryHandle(provider, path));
    } catch (error) {
      if (_pmCloudIsNotFoundError(error)) return false;
      throw error;
    }
  }

  async function _pmCloudEnsurePage(provider, internals, name, text) {
    const path = internals._joinPath(PM_ROOT, name);
    if (!await _pmCloudEntryExists(provider, path, internals)) await provider.writeText(path, text);
  }

  function _pmCloudRecoveryPayload(items) {
    const unique = [...new Set((items || []).filter(Boolean))];
    return { recovered: !!unique.length, recovered_count: unique.length, recovered_items: unique, message: unique.length ? `制作管理に必要なファイルを自動復旧しました: ${unique.slice(0, 4).join('、')}` : '' };
  }

  async function _pmCloudEnsureSheet(provider, internals, sheet, schemaSheet = sheet) {
    const dir = internals._joinPath(_pmCloudRoot(internals), sheet);
    await internals._directoryHandle(provider, dir, true);
    // ストア汚染（v0.6.120〜v0.7.146 の暗黙sheet-store化）の修復。制作管理の初回表示
    // （_pmCloudInit）とタスクシート作成で必ず通る（production-sheet-store-contamination-
    // fix-plan-2026-08-05.md Phase 2）。ノート再構築より先に行う（修復後の浄化済み
    // frontmatter を _pmCloudReadFrontmatter で読み直すため）。
    await internals._repairProductionSheetStoreIfNeeded?.(provider, dir);
    const note = internals._joinPath(dir, sheet + '.md');
    const parsed = await _pmCloudReadFrontmatter(provider, note);
    const frontmatter = { ...(parsed.frontmatter || {}), type: 'settings-db', schema_version: 1 };
    // 防御: 修復関数が未読込でも、汚染由来の保存方式キーをノートへ引き継がない
    ['storage', 'sheet_storage', 'entry_storage', 'storage_backend'].forEach((key) => {
      if (String(frontmatter[key] || '').toLowerCase() === 'sqlite') delete frontmatter[key];
    });
    if (String(frontmatter.cloud_storage || '').toLowerCase() === 'sheet-store-v1') delete frontmatter.cloud_storage;
    const propTypes = { ...(frontmatter.property_types || {}) };
    if (schemaSheet === 'タスクリスト') {
      delete propTypes[PM_TASK_LEGACY_NAME_PROP];
      delete propTypes['タスク名を固定'];
    }
    if (schemaSheet === 'タスクリスト アーカイブ') delete propTypes[PM_TASK_LEGACY_NAME_PROP];
    const managedNameDefinition = window.MeldexProductionSchemaMigration?.MANAGED_NAME_COLUMNS?.[schemaSheet];
    if (managedNameDefinition) {
      [managedNameDefinition.legacy, ...(managedNameDefinition.historicalAliases || [])]
        .filter(Boolean)
        .forEach(property => { delete propTypes[property]; });
    }
    const expectedTypes = PM_PROPERTY_TYPES[schemaSheet] || {};
    frontmatter.property_types = _pmCloudMergePropertyTypes(propTypes, expectedTypes);
    if (schemaSheet === 'タスクリスト') {
      frontmatter.calendar_mapping = { ...(frontmatter.calendar_mapping || {}), startProp: '作業予定日時', endProp: '作業予定日時', titleProp: '' };
      if (!frontmatter.calendar_mapping.colorProp) frontmatter.calendar_mapping.colorProp = '対象色';
      if (!frontmatter.calendar_mapping.descriptionProp) frontmatter.calendar_mapping.descriptionProp = '備考';
      _pmCloudApplyTaskHiddenColumns(frontmatter);
      _pmCloudApplyComputedProps(frontmatter);
    }
    if (sheet === 'スケジュール') frontmatter.calendar_mapping = frontmatter.calendar_mapping || { startProp: '予定日時', endProp: '予定日時', titleProp: '予定名', descriptionProp: '備考' };
    await provider.writeText(note, _pmCloudFrontmatterText(frontmatter, parsed.body || `# ${sheet}\n\n`));
  }

  function _pmCloudMergePropertyTypes(current, expected) {
    const merged = { ...(current || {}) };
    Object.entries(expected || {}).forEach(([prop, spec]) => {
      const existing = merged[prop] && typeof merged[prop] === 'object' ? merged[prop] : {};
      merged[prop] = { ...existing, ...(spec || {}) };
    });
    return merged;
  }

  // 制作管理UX改善計画（2026-08-04）§5-1: 読み取り専用の自動列（コードが再計算エンジン・
  // 同期フック経由で更新し、ユーザーの直接編集は拒否する）。汎用の計算列基盤
  // （gb-db-computed-columns.js / gb-data-access-dropbox-expanded.part01.js の
  // _rejectComputedPropertyEdit）が frontmatterの computed_props: 宣言を見てセル編集を拒否
  // する。内部エンジンの書込み（applyPropsToFrontmatter 等）は /value を通らないため影響しない。
  // コミット前レビュー指摘 #13: 目標作業時間_値（数値の実体列）にもcomputed_props宣言が
  // 必要（表示文字列の目標作業時間だけ保護しても、裏の数値列を表示に戻すと直接編集できる
  // 抜け道になる）。Desktop meldex_production_management.COMPUTED_PROPS と同じ集合。
  const PM_TASK_COMPUTED_PROPS = ['作業予定日時', '作業予定時間', '目標作業時間', '目標作業時間_値', 'シフト割当不能理由'];
  function _pmCloudApplyComputedProps(frontmatter) {
    const current = Array.isArray(frontmatter.computed_props) ? frontmatter.computed_props : [];
    frontmatter.computed_props = [...new Set([...current, ...PM_TASK_COMPUTED_PROPS])];
  }

  // 制作管理UX改善計画（2026-08-04）§5-1「予定セルの合成表示」: フル汎用の列合成基盤は
  // 大掛かりになるため、コーディネーター確定のフォールバック案を採用する。「作業予定日時」
  // セル（computed_props宣言済みの読み取り専用列）へ、同エントリの「作業予定時間」を
  // 「（3h）」形式で併記し、「シフト割当不能理由」があれば⚠アイコン＋ツールチップで示す。
  // gb-db-computed-columns.js の decorateCell 汎用フック（window.MeldexCellDisplayAugment.
  // decorators）へ登録する（このファイルの読込順に依存しない。描画時に遅延解決されるため）。
  function _pmScheduleCellFirstValue(entityData, propName) {
    const raw = entityData && Object.prototype.hasOwnProperty.call(entityData, propName) ? entityData[propName] : null;
    if (!Array.isArray(raw) || !raw.length) return '';
    const adopted = raw.find(v => v && (v.status === '採用' || v.status === '掲載済み')) || raw[0];
    return adopted && adopted.value != null ? String(adopted.value).trim() : '';
  }

  function _pmFormatScheduleHours(hoursText) {
    const num = Number(hoursText);
    if (!Number.isFinite(num) || num <= 0) return '';
    const rounded = Math.round(num * 10) / 10;
    return `${rounded}h`;
  }

  // 制作管理UX改善計画（2026-08-04）§6-2: 保護トグル（再計算ロック/担当者固定/シフト固定）は
  // タスク詳細サイドバーで編集するが、一覧を見ただけで保護中と分かるよう、既に計算列表示に
  // なっている「作業予定日時」セルへ小さな🔒/📌アイコンを併記する（decorateCell拡張点の再利用）。
  function _pmScheduleCellTruthy(entityData, propName) {
    const value = _pmScheduleCellFirstValue(entityData, propName).toLowerCase();
    return value === 'true' || value === '1' || value === 'yes' || value === 'on';
  }

  function _pmDecorateScheduleCell(td, container, entityData) {
    const hoursLabel = _pmFormatScheduleHours(_pmScheduleCellFirstValue(entityData, '作業予定時間'));
    if (hoursLabel) {
      const hoursSpan = document.createElement('span');
      hoursSpan.className = 'pm-schedule-cell-hours';
      hoursSpan.textContent = `（${hoursLabel}）`;
      container.appendChild(hoursSpan);
    }
    const reasonText = _pmScheduleCellFirstValue(entityData, 'シフト割当不能理由');
    if (reasonText) {
      td.classList.add('pm-schedule-cell-warning');
      td.title = `シフト割当不能: ${reasonText}`;
      const warnSpan = document.createElement('span');
      warnSpan.className = 'pm-schedule-cell-warning-icon';
      warnSpan.textContent = '⚠';
      warnSpan.setAttribute('aria-label', `シフト割当不能理由: ${reasonText}`);
      container.appendChild(warnSpan);
    }
    if (_pmScheduleCellTruthy(entityData, '再計算ロック')) {
      const lockSpan = document.createElement('span');
      lockSpan.className = 'pm-schedule-cell-protection-icon';
      lockSpan.textContent = '🔒';
      lockSpan.title = '再計算ロック: 自動割り当てで動きません';
      lockSpan.setAttribute('aria-label', '再計算ロック中');
      container.appendChild(lockSpan);
    }
    const assigneeFixed = _pmScheduleCellTruthy(entityData, '担当者固定');
    const shiftFixed = _pmScheduleCellTruthy(entityData, 'シフト固定');
    if (assigneeFixed || shiftFixed) {
      const pinLabel = [assigneeFixed && '担当者固定', shiftFixed && 'シフト固定'].filter(Boolean).join(' / ');
      const pinSpan = document.createElement('span');
      pinSpan.className = 'pm-schedule-cell-protection-icon';
      pinSpan.textContent = '📌';
      pinSpan.title = `${pinLabel}: 自動割り当てで動きません`;
      pinSpan.setAttribute('aria-label', `${pinLabel}中`);
      container.appendChild(pinSpan);
    }
  }

  if (typeof window !== 'undefined') {
    window.MeldexCellDisplayAugment = window.MeldexCellDisplayAugment || {};
    window.MeldexCellDisplayAugment.decorators = {
      ...(window.MeldexCellDisplayAugment.decorators || {}),
      '作業予定日時': _pmDecorateScheduleCell,
    };
  }

  // コミット前レビュー指摘 #12: 既定非表示列の適用は初回のみ。_pmCloudEnsureSheet は
  // シートを開くたびに呼ばれ得るため、無条件に union し続けるとユーザーが表示へ戻した列を
  // 毎回黙って再び隠してしまう。適用済みマーカー（フォルダノートのfrontmatter直下。
  // savedViewsの追加・削除に影響されない）が立っていれば以降はスキップする。Desktop
  // meldex_production_management._apply_default_view_config と同じ意図・同じマーカー名。
  function _pmCloudApplyTaskHiddenColumns(frontmatter) {
    if (frontmatter.production_hidden_defaults_applied) return;
    const config = (frontmatter.view_config && typeof frontmatter.view_config === 'object') ? frontmatter.view_config : {};
    const views = Array.isArray(config.savedViews) && config.savedViews.length ? config.savedViews : [{ name: 'テーブル', viewMode: 'pivot' }];
    views.forEach(view => {
      if (!view || typeof view !== 'object') return;
      const current = Array.isArray(view.hiddenCols) ? view.hiddenCols : [];
      view.hiddenCols = [...new Set([...current, ...PM_TASK_HIDDEN_COLUMNS])];
    });
    config.savedViews = views;
    if (!Number.isInteger(config.currentViewIdx)) config.currentViewIdx = 0;
    frontmatter.view_config = config;
    frontmatter.production_hidden_defaults_applied = true;
  }

  function _pmTaskPageOptionCount(rows, fallback) {
    return (rows || []).reduce((max, row) => {
      const match = String(row?.['ページ'] || row?.['単位レベル1'] || '').match(/\d+/);
      return match ? Math.max(max, Number(match[0]) || 1) : max;
    }, Math.max(1, Number(fallback) || 1));
  }

  function _pmTaskPageOptions(count) {
    return Array.from({ length: Math.max(1, Number(count) || 1) }, (_, i) => 'p' + String(i + 1).padStart(4, '0'));
  }

  function _pmTaskPanelOptions(rows) {
    return (rows || []).map(row => String(row?.['コマ'] || row?.['単位レベル2'] || '').trim()).filter(Boolean);
  }

  function _pmTaskPageValues(rows) {
    return (rows || []).map(row => String(row?.['ページ'] || row?.['単位レベル1'] || '').trim()).filter(Boolean);
  }

  function _pmMergeOptions(current, additions) {
    const out = [];
    [...(Array.isArray(current) ? current : []), ...(additions || [])].forEach((item) => {
      const value = String(item || '').trim();
      if (value && !out.includes(value)) out.push(value);
    });
    return out;
  }

  async function _pmCloudEnsureTaskPagePanelOptions(provider, internals, taskSheet, rows, fallbackPageCount) {
    if (!(rows || []).some(row => String(row?.['ページ'] || row?.['コマ'] || '').trim())) return;
    const note = internals._joinPath(_pmCloudRoot(internals), taskSheet, taskSheet + '.md');
    const parsed = await _pmCloudReadFrontmatter(provider, note);
    const frontmatter = { ...(parsed.frontmatter || {}), type: 'settings-db', schema_version: 1 };
    const propTypes = frontmatter.property_types && typeof frontmatter.property_types === 'object' ? { ...frontmatter.property_types } : {};
    const pageSpec = { ...(propTypes['ページ'] || {}), type: 'multi-select' };
    pageSpec.options = _pmMergeOptions(
      pageSpec.options,
      [..._pmTaskPageOptions(_pmTaskPageOptionCount(rows, fallbackPageCount)), ..._pmTaskPageValues(rows)],
    );
    propTypes['ページ'] = pageSpec;
    const panelSpec = { ...(propTypes['コマ'] || {}), type: 'multi-select' };
    const panelOptions = _pmMergeOptions(panelSpec.options, _pmTaskPanelOptions(rows));
    if (panelOptions.length) panelSpec.options = panelOptions;
    propTypes['コマ'] = panelSpec;
    frontmatter.property_types = propTypes;
    await provider.writeText(note, _pmCloudFrontmatterText(frontmatter, parsed.body || `# ${taskSheet}\n\n`));
  }

  async function _pmCloudSeed(provider, internals) {
    for (const [sheet, rows] of Object.entries(PM_SEEDS)) {
      for (const [name, props] of rows) await _pmCloudUpsertEntry(provider, internals, sheet, name, props, '', '', { reuseName: true });
    }
    for (const sheet of PM_SHEETS) {
      await _pmCloudUpsertEntry(provider, internals, 'データソース', sheet, { '役割': sheet, '対象シート': `シート/${sheet}`, '有効': 'true', '説明': '制作管理で使う標準シート' }, '役割', sheet);
    }
  }

  function _pmCloudValidateTaskRows(rows) {
    if (!Array.isArray(rows) || !rows.length) throw new Error('作成するタスクがありません。作業内容を1つ以上選んでください');
    if (rows.length > PM_MAX_GENERATED_TASKS) throw new Error(`一度に作成できるタスクは${PM_MAX_GENERATED_TASKS}件までです`);
  }

  async function _pmCloudPreviewTasks(provider, internals, body) {
    const workTitle = String((body || {}).work_title || (body || {})['作品タイトル'] || (body || {}).title || '無題作品');
    const workEntry = await _pmCloudFindWork(provider, internals, workTitle);
    const taskBody = window.MeldexProductionPageStructure?.prepare?.(body || {}, workEntry?.frontmatter) || (body || {});
    const rows = _pmBuildTaskRows(taskBody);
    _pmCloudValidateTaskRows(rows);
    await _pmCloudApplyTaskDurations(provider, internals, rows);
    const existingKeys = await _pmCloudExistingTaskKeysForWork(provider, internals, workTitle);
    return { ok: true, rows: rows.map(row => ({ ...row, existing: existingKeys.has(String(row['作成キー'] || '')) })), count: rows.length, page_units: taskBody.pages || [], cloud: true };
  }

  async function _pmCloudEnsureTaskReferences(provider, internals, rows, config) {
    const values = (prop) => [...new Set((rows || []).map(row => String(row?.[prop] || '').trim()).filter(Boolean))];
    const standardContents = new Map((PM_SEEDS['作業内容リスト'] || []).map(([name, props]) => [name, props]));
    const specs = [
      ['作業対象リスト', values('作業対象リスト'), () => ({ '基準作業時間': '1' })],
      ['作業内容リスト', values('作業内容リスト'), (name, index) => standardContents.get(name) || { '表示名': name, '作業順': String(100 + index * 10), '作業時間倍率': '1' }],
      ['作業規模リスト', values('作業規模リスト'), () => ({ '作業時間倍率': '1' })],
    ];
    let created = 0;
    for (const [sheet, names, propsFor] of specs) {
      const known = new Set((await _pmCloudListEntries(provider, internals, sheet)).map(entry => entry.name).filter(Boolean));
      for (let index = 0; index < names.length; index += 1) {
        const name = names[index];
        if (known.has(name)) continue;
        await _pmCloudUpsertEntry(provider, internals, sheet, name, propsFor(name, index), '', '', { reuseName: true });
        known.add(name);
        created += 1;
      }
    }
    return created;
  }

  async function _pmCloudCreateTasks(provider, internals, body) {
    const previous = PM_TASK_CREATE_QUEUE;
    let release;
    const current = new Promise(resolve => { release = resolve; });
    PM_TASK_CREATE_QUEUE = current;
    await previous;
    try {
      return await _pmCloudWithProductionLease(provider, () => _pmCloudCreateTasksUnlocked(provider, internals, body));
    } finally {
      release();
      if (PM_TASK_CREATE_QUEUE === current) PM_TASK_CREATE_QUEUE = Promise.resolve();
    }
  }

  async function _pmCloudCreateTasksUnlocked(provider, internals, body) {
    const init = await _pmCloudInit(provider, internals);
    const workTitle = String((body || {}).work_title || (body || {})['作品タイトル'] || (body || {}).title || '無題作品');
    const workEntries = await _pmCloudListEntries(provider, internals, '作品リスト', { concurrency: 8 });
    const workEntry = workEntries.find(entry => {
      const title = entry.name || _pmCloudPropValue(entry.frontmatter, '作品タイトル_話数')
        || _pmCloudPropValue(entry.frontmatter, '作品タイトル');
      return title === workTitle;
    });
    const taskBody = window.MeldexProductionPageStructure?.prepare?.(body || {}, workEntry?.frontmatter) || (body || {});
    const rows = _pmBuildTaskRows(taskBody);
    _pmCloudValidateTaskRows(rows);
    await _pmCloudApplyTaskDurations(provider, internals, rows);
    const config = _pmHierarchyConfig(taskBody);
    const paths = _pmHierarchyPaths(taskBody, config);
    const firstLevelCount = new Set(paths.map(path => path[0]).filter(Boolean)).size || paths.length || 1;
    const physicalPageCount = Number(taskBody._physical_page_count || firstLevelCount);
    const secondLevelsByFirst = new Map();
    paths.forEach(path => {
      if (!path[1]) return;
      if (!secondLevelsByFirst.has(path[0])) secondLevelsByFirst.set(path[0], new Set());
      secondLevelsByFirst.get(path[0]).add(path[1]);
    });
    const secondLevelCount = Math.max(0, ...[...secondLevelsByFirst.values()].map(values => values.size));
    const usedSheets = new Set(workEntries
      .map(entry => _pmCloudPropValue(entry.frontmatter, 'タスクリストシート').toLocaleLowerCase('ja'))
      .filter(Boolean));
    const taskSheet = _pmCloudPropValue(workEntry?.frontmatter, 'タスクリストシート')
      || _pmCloudAllocateTaskSheetName(workTitle, usedSheets);
    await _pmCloudEnsureSheet(provider, internals, taskSheet, 'タスクリスト');
    const workProps = {
      'ページ数': String(physicalPageCount),
      '階層数': String(config.count),
      '階層ラベル': config.labels.join(','),
      'プリセット種別': config.preset,
      '作業作成粒度': String(taskBody.granularity || taskBody['作業作成粒度'] || config.granularity || '階層単位'),
      '生成ページ数': String(firstLevelCount),
      '生成コマ数': String(secondLevelCount),
      'タスク生成': '作成中',
      'タスクリストシート': taskSheet,
    };
    if (taskBody._physical_page_count) {
      workProps['開始ページの位置'] = taskBody._page_start_side || '左ページ';
      workProps['見開きページ'] = (taskBody._spread_pages || []).join(',');
      workProps['カラーページ'] = (taskBody._color_pages || []).join(',');
    }
    const workPeriod = _pmWorkPeriodValue(taskBody);
    if (workPeriod) workProps['作業期間'] = workPeriod;
    const workPath = workEntry
      ? await _pmCloudUpdateEntryAtPath(provider, workEntry.path, workProps, workEntry)
      : await _pmCloudUpsertEntry(provider, internals, '作品リスト', workTitle, workProps, '', '', { reuseName: true, createNew: true });
    const migration = await _pmCloudMigrateLegacyTasksForWork(provider, internals, workTitle, taskSheet);
    if (migration.conflicts) throw new Error(`タスクリストに内容を自動統合できない行が${migration.conflicts}件あります。旧タスクリストまたは競合コピーと、作品別タスクリストの同じ作成キーを確認してください`);
    const referencesCreated = await _pmCloudEnsureTaskReferences(provider, internals, rows, config);
    await _pmCloudEnsureTaskPagePanelOptions(provider, internals, taskSheet, rows, physicalPageCount);
    const existingKeys = new Set(migration.existing_keys || []);
    const missingRows = [];
    for (const row of rows) {
      const key = String(row['作成キー'] || '');
      if (existingKeys.has(key)) continue;
      existingKeys.add(key);
      missingRows.push(row);
    }
    const created = await _pmCloudWriteTaskRows(provider, internals, taskSheet, missingRows);
    await _pmCloudUpdateEntryAtPath(provider, workPath, { ...workProps, 'タスク生成': '作成済み' });
    return { ok: true, created, skipped: rows.length - created, count: rows.length, references_created: referencesCreated, migrated: migration.copied, legacy_removed: migration.removed, migration_conflicts: migration.conflicts, task_sheet: taskSheet, cloud: true, ..._pmCloudRecoveryPayload(init.recovered_items) };
  }

  async function _pmCloudApplyShifts(provider, internals, body) {
    const init = await _pmCloudInit(provider, internals);
    const rows = (body.rows || body.shifts || []).map(_pmNormalizeIncomingShift).filter(Boolean);
    const journal = _pmCloudMutationJournal(provider, internals);
    await _pmCloudJournalCalendar(journal, 'shifts');
    await _pmCloudJournalCalendar(journal, 'events');
    await _pmCloudJournalCalendar(journal, 'calendars');
    try {
      const registry = await _pmCloudRegisterShiftStaff(rows, journal);
      const cleanup = await _pmCloudCleanupExistingShifts(provider, internals, rows, journal);
      const removed = new Set(cleanup.removed_ids || []);
      let created = 0;
      let updated = 0;
      for (const row of rows) {
        const id = _pmShiftId(row);
        const scheduleName = `${row.date}_${row.user}_${_pmScheduleTypeLabel(row.type)}`;
        await _pmCloudUpsertEntry(
          provider,
          internals,
          'スケジュール',
          scheduleName,
          _pmScheduleProps(row, id),
          '作成キー',
          id,
          { beforeWrite: path => _pmCloudJournalText(journal, path) },
        );
        await window.MeldexDataAccess.requestJson('/cal/shifts', { method: 'POST', body: { id, ...row } });
        if (removed.has(id)) updated += 1;
        else created += 1;
      }
      return {
        ok: true,
        count: rows.length,
        created,
        updated,
        registry_added: registry.added,
        registry_name_warnings: registry.warnings,
        cloud: true,
        ..._pmCloudRecoveryPayload(init.recovered_items),
      };
    } catch (error) {
      return _pmCloudRollbackMutation(journal, error);
    }
  }

  async function _pmCloudRegisterShiftStaff(rows, journal) {
    const names = [...new Set((rows || []).map(row => String(row?.user || '').trim()).filter(Boolean))];
    if (!names.length) return { added: 0, warnings: [] };
    const ensured = await window.MeldexDataAccess.requestJson('/staff-registry/ensure', {
      method: 'POST',
      body: {},
    });
    const current = await window.MeldexDataAccess.requestJson('/staff-registry/list');
    if (!current || !Array.isArray(current.staff)) {
      throw new Error('スタッフ台帳を確認できないため、シフト取込を中止しました');
    }
    const existing = Array.isArray(current?.staff) ? current.staff : [];
    const registryRoot = _pmCloudNormalizePath(current.path || ensured?.path || '');
    if (!registryRoot) throw new Error('スタッフ台帳の保存先を確認できないため、シフト取込を中止しました');
    const existingPaths = new Set(
      (await _pmCloudDirectoryEntries(journal.provider, journal.internals, registryRoot))
        .filter(entry => entry?.handle?.kind === 'file')
        .map(entry => _pmCloudNormalizePath(journal.internals._joinPath(registryRoot, entry.name))),
    );
    for (const path of existingPaths) await _pmCloudJournalText(journal, path);
    const identities = new Set(existing.flatMap(row => [
      String(row?.user || '').trim(),
      String(row?.display || '').trim(),
      String(row?.entry_name || '').trim(),
    ]).filter(Boolean));
    let added = 0;
    const warnings = [];
    for (const name of names) {
      if (identities.has(name)) continue;
      const result = await window.MeldexDataAccess.requestJson('/staff-registry/upsert', {
        method: 'POST',
        body: { user: '', display: name, fill_only: true },
      });
      const resultPath = _pmCloudNormalizePath(result?.staff?.path);
      if (!resultPath) throw new Error('登録したスタッフの保存先を確認できません');
      if (!existingPaths.has(resultPath)) _pmCloudJournalCreatedPath(journal, resultPath);
      existingPaths.add(resultPath);
      identities.add(name);
      warnings.push(`${name} はDropboxアカウント未連携のスタッフとして登録しました`);
      added += 1;
    }
    return { added, warnings };
  }

  async function _pmCloudRecoverFromCalendar(provider, internals, missing) {
    const result = { shifts: 0, tasks: 0 };
    const needsSchedule = missing.some(item => item.includes('スケジュール') || item === PM_ROOT);
    const needsTasks = missing.some(item => item.includes('タスクリスト') || item === PM_ROOT);
    if (needsSchedule) {
      const shifts = await window.MeldexDataAccess.requestJson('/cal/shifts').catch(() => []);
      for (const row of shifts || []) {
        const normalized = _pmNormalizeIncomingShift(row);
        if (!normalized) continue;
        await _pmCloudUpsertEntry(provider, internals, 'スケジュール', `${normalized.date}_${normalized.user}`, _pmScheduleProps(normalized, row.id || _pmShiftId(normalized)), '作成キー', row.id || _pmShiftId(normalized));
        result.shifts += 1;
      }
    }
    if (needsTasks) {
      const events = await window.MeldexDataAccess.requestJson('/cal/events').catch(() => []);
      for (const row of (events || []).filter(event => event.calendar_source === 'production-task')) {
        const key = 'calendar:' + String(row.external_id || row.id || row.title || '');
        await _pmCloudUpsertEntry(provider, internals, 'タスクリスト', row.title || '復旧した作業予定', { '担当者': row.user || '', '作業予定日時': row.start && row.end ? `${row.start}|${row.end}` : row.start || '', '状況': '着手待ち', '作成キー': key, '備考': row.description || 'カレンダーから復旧' }, '作成キー', key);
        result.tasks += 1;
      }
    }
    return result;
  }

  async function _pmCloudExport(url) {
    const kind = url.searchParams.get('kind') || 'all';
    const format = url.searchParams.get('format') || 'csv';
    const rows = await _pmCollectCloudExportRows(kind, url.searchParams.get('date_from') || '', url.searchParams.get('date_to') || '');
    if (format === 'xlsx') {
      const blob = _pmXlsxBlob(rows);
      return { ok: true, filename: `production_${kind}.xlsx`, mime: blob.type, blob: await _pmBlobBase64(blob) };
    }
    return { ok: true, filename: `production_${kind}.csv`, mime: 'text/csv;charset=utf-8', content: _pmRowsCsv(rows) };
  }

  async function _pmCollectCloudExportRows(kind, dateFrom, dateTo) {
    const rows = [];
    if (kind === 'all' || kind === 'shifts') {
      (await window.MeldexDataAccess.requestJson('/cal/shifts'))
        .filter(row => _pmDateInRange(row.date || '', dateFrom, dateTo))
        .forEach(row => rows.push({ '種別': 'シフト', '担当者': row.user || '', '日付': row.date || '', '開始': row.start_time || '', '終了': row.end_time || '', '内容': row.type || '', '備考': row.note || '' }));
    }
    if (kind === 'all' || kind === 'attendance') {
      (await window.MeldexDataAccess.requestJson('/cal/time'))
        .filter(row => _pmDateInRange(String(row.timestamp || '').slice(0, 10), dateFrom, dateTo))
        .forEach(row => rows.push({ '種別': '実績', '担当者': row.user || '', '日付': String(row.timestamp || '').slice(0, 10), '開始': String(row.timestamp || '').slice(11, 16), '終了': '', '内容': row.type || '', '備考': row.note || '' }));
    }
    if (kind === 'all' || kind === 'work') {
      (await window.MeldexDataAccess.requestJson('/cal/events'))
        .filter(row => row.calendar_source === 'production-task' && _pmDateInRange(String(row.start || '').slice(0, 10), dateFrom, dateTo))
        .forEach(row => rows.push({ '種別': '作業予定', '担当者': row.user || '', '日付': String(row.start || '').slice(0, 10), '開始': String(row.start || '').slice(11, 16), '終了': String(row.end || '').slice(11, 16), '内容': row.title || '', '備考': row.description || '' }));
    }
    return rows;
  }

  function _pmDateInRange(date, from, to) {
    const value = String(date || '').slice(0, 10);
    return !!value && (!from || value >= from) && (!to || value <= to);
  }

