(function () {
  'use strict';
  // gb-production-management.part01.js: 責務単位分割（2026-08-12）後もこのファイル名を
  // 維持している。以下の複数の既存テスト（このリファクタの編集許可範囲外）が、対象の関数・
  // 文字列がこの物理ファイル名の中に存在することを直接検証しているため（ファイル名や
  // window.MeldexProductionManagement 経由の間接参照ではなく、gb-production-management.js の
  // ローダー配列を辿らない直読み）:
  //   - tests/meldex_dialog_inventory.py の COMMON_PATTERN 走査（window.GBUI の
  //     createModal 呼び出しを含む _pmModal の定義がこのファイルにあることを
  //     1件のダイアログ経路として検証。この行自体に対象パターンの完全一致文字列を
  //     書かないこと。走査はコメントも区別せず文字列一致で数えるため誤検出になる）
  //   - tests/test_meldex_production_phase4_ui.py（_pmInstallCloudHandler 内の
  //     "window.MeldexProductionExternalSyncCloud?.syncGoogle"）
  //   - tests/test_meldex_scheduler_frontend.py（_pmInstallCloudHandler 内の
  //     "_pmCloudWithProductionLease(...) => ...applyCloud"）
  //   - tests/test_meldex_phase_e_board_timer_quickmemo_viewer.py（_pmCloudCleanupExistingShifts
  //     内の _pmCloudDeleteScheduleEntry 呼び出し、_pmCloudApplyShifts / _pmCloudRegisterShiftStaff
  //     の関数本体をNode上でbrace抽出してevalする回帰テストを含む）
  // そのため、このファイルには以下の4つの責務だけを残す（他の責務は
  // gb-production-management-cloud-*.js へ分離済み）:
  //   1. 共有定数・APIリクエストヘルパー・共通ダイアログ部品（_pmModal / _pmFooter 等）
  //   2. シフト⇔カレンダー同期ヘルパー（_pmCloudCleanupExistingShifts 等）
  //   3. Cloudルートディスパッチャ（_pmInstallCloudHandler）
  //   4. シフト取込の確定処理・スタッフ登録・カレンダーからの復旧・書き出しAPI
  //
  // IIFEの開始はこのファイル、終了は読み込み順で最後になる
  // gb-production-management-cloud-save-hooks.js にある（読み込み順は
  // gb-production-management.js を参照）。
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

  // 制作管理メニューから直接開くダイアログ（開始／タスク一括作成の起点／シフト取込／
  // 書き出し）と外部カレンダー自動送信タイマーは gb-production-management-cloud-dialogs.js
  // にある（責務単位分割 2026-08-12）。同一クロージャのため参照は変わらず利用できる。

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

  // ワークスペースの状態確認・一覧取得・初期化・シート/フォルダノートのスキーマ整備は
  // gb-production-management-cloud-workspace.js、タスク一覧セルの合成表示・ページ/コマの
  // 選択肢整備・初期シード・タスク一括作成のプレビュー/確定は
  // gb-production-management-cloud-task-generation.js にある（責務単位分割 2026-08-12）。
  // 同一クロージャのため参照は変わらず利用できる。

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

