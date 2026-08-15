  // gb-production-management-cloud-exports.js: 制作管理Cloud機能の公開API
  // （window.openProductionManagementStart 等のグローバル関数、
  // window.MeldexProductionManagement）と、Cloudルートハンドラ・外部カレンダー自動送信
  // タイマーの起動呼び出しを担当する（責務単位分割 2026-08-12。旧
  // gb-production-management.part02.js の一部）。
  //
  // gb-production-management.part01.js から続く共有クロージャ（IIFEの raw
  // concatenation）に属し、このファイル自体は自前のIIFEを持たない。読み込み順は
  // gb-production-management.js を参照。ただし、このファイルの
  // _pmInstallCloudHandler() / _pmStartExternalSyncTimer() 呼び出しは、それらが参照する
  // 関数（他ファイルの function 宣言）がJSの関数宣言ホイスティングにより読み込み順に
  // かかわらず解決されるため、読み込み順で最後である必要はない
  // （gb-production-management-cloud-save-hooks.js だけは閉じ括弧 })(); を持つため
  // 必ず最後に読み込むこと）。

  window.openProductionManagementStart = openProductionManagementStart;
  window.openProductionShiftImport = openProductionShiftImport;
  window.openProductionTaskCreate = openProductionTaskCreate;
  window.runProductionExternalSync = runProductionExternalSync;
  window.openProductionExport = openProductionExport;
  window.MeldexCloudShiftSync = { sync: _pmSyncCloudShiftEvent, remove: _pmRemoveCloudShiftEvent };
  window.MeldexProductionManagement = {
    parseCsv: PM_SHIFT_PARSER.parseCsv,
    rowsToShifts: PM_SHIFT_PARSER.rowsToShifts,
    buildTaskRows: _pmBuildTaskRows,
    // コミット前レビュー指摘 #17: Desktop meldex_production_management_support.
    // INTERNAL_METADATA_PROPERTIES とJS側複製の集合一致をテストで検証できるよう公開する
    // （test_meldex_production_schema_cleanup.py）。
    INTERNAL_METADATA_PROPERTIES: PM_INTERNAL_METADATA_PROPERTIES,
    queryCloudTasksWithProvider: _pmCloudQueryTasks,
    cloudRecalcDeps: _pmRecalcEngineDeps,
    withCloudProductionLease: _pmCloudWithProductionLease,
    async renameCloudManagedEntry(body) {
      const internals = window.__MeldexPwaDataAccessInternals;
      if (!internals) throw new Error('Cloudデータ操作を利用できません');
      const provider = await internals._requirePwaProvider('readwrite');
      return _pmCloudRenameManagedEntry(provider, internals, body || {});
    },
    // gb-data-access-dropbox-expanded.part01.js のセル値保存経路（_updateValue /
    // _updateSheetStoreValue / _addValue / _addSheetStoreValue）から呼ばれる、タスクリスト
    // セル保存時の自動追従フックの単一入口。目標作業時間の分類変更追従（changedProperty で
    // ゲート）と、状況変更に伴う開始日時・完了日時の自動記録（changedProperty を問わず毎回
    // チェック。production-management-ux-improvement-plan-2026-08-04.md §5-1）の2つをここで
    // まとめる。タスクリスト系シート以外・保護対象行では何もしない（false を返す）。
    async applyTaskDurationRecalcOnValueUpdate(provider, path, frontmatter, changedProperty) {
      const durationChanged = await _pmCloudApplyDurationRecalcHook(provider, path, frontmatter, changedProperty);
      const timestampChanged = _pmCloudApplyStatusTimestampHook(path, frontmatter);
      return durationChanged || timestampChanged;
    },
    // gb-data-access-dropbox-expanded.part01.js の汎用エントリ作成経路（_createEntity）から
    // 呼ばれる、作業内容リストへ行を直接追加した時の作業順自動採番の単一入口
    // （production-management-ux-improvement-plan-2026-08-04.md §5-3）。対象外シート・
    // 既に値がある行では何もしない（false を返す）。
    async applyWorkOrderDefaultOnEntityCreate(provider, path, frontmatter) {
      return _pmCloudApplyWorkOrderDefault(provider, path, frontmatter);
    },
    // gb-data-access-dropbox-expanded.part01.js の4つの値書込み関数（_updateValue /
    // _addValue / _updateSheetStoreValue / _addSheetStoreValue）から「書込み完了後」に
    // 呼ばれる、タスク名自動更新（管理付きリネーム込み）の単一入口（Stage 4）。
    async applyTaskNameAutoRenameOnValueUpdate(provider, path, frontmatter) {
      return _pmCloudApplyTaskNameAutoRename(provider, path, frontmatter);
    },
    // テスト・診断用に内部関数も公開する（gb-cal-cloud-sync.js の _internal と同じ方針。
    // コミット前レビュー指摘 #16: _pmCloudUpdateEntryAtPath の内部メタデータ振り分けゲートを
    // 直接検証できるようにする）。
    _internal: {
      updateEntryAtPath: _pmCloudUpdateEntryAtPath,
    },
  };

  _pmInstallCloudHandler();
  _pmStartExternalSyncTimer();
