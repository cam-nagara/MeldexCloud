/* gb-production-management-schema-cleanup.js: 制作管理UX改善計画（2026-08-04）§5-2 で
   削除した死に列の既存データ退避（Cloud側）。

   Desktop側 meldex_production_schema_cleanup.py と同じ設計: RETIRED_SHEET_PROPERTIES に
   列挙された死に列のうち、既存エントリに値が入っているものだけを frontmatter の
   production_schema_cleanup 退避レコードへコピーしてから properties から削除する
   （gb-production-management-schema-migration.js の production_name_migration と同じ
   非破壊パターン）。呼び出しは gb-production-management.part01.js の _pmCloudInit から、
   同ファイルの migrateManagedNameProperties と同じ context（_pmCloudManagedNameContext）
   を再利用する。
*/
(function () {
  'use strict';

  // Desktop meldex_production_management_support.RETIRED_SHEET_PROPERTIES と同一内容
  // （Desktop/Cloud parity は test_meldex_production_schema_cleanup.py で検証する）。
  const RETIRED_SHEET_PROPERTIES = Object.freeze({
    'タスクリスト': Object.freeze(['評価', '総合基準作業時間', '依存割当キー', 'ページ非共有', 'カテゴリ', '作業', '次のタスクにより保留中：', '次のタスクを保留中：']),
    '作品リスト': Object.freeze(['完了', 'タスク生成_ページ', '依存生成']),
    '作業対象リスト': Object.freeze(['担当者候補']),
    '作業内容リスト': Object.freeze(['別名', '依存階層', '標準粒度']),
    '作業規模リスト': Object.freeze(['面積比']),
  });
  const SIMPLE_SHEETS = Object.freeze(['作品リスト', '作業対象リスト', '作業内容リスト', '作業規模リスト']);
  const TASK_LIST_SHEET = 'タスクリスト';

  function _hasValue(candidates) {
    const values = Array.isArray(candidates) ? candidates : (candidates == null ? [] : [candidates]);
    return values.some(item => {
      if (item && typeof item === 'object') return String(item.value || '').trim() !== '';
      return String(item || '').trim() !== '';
    });
  }

  // コミット前レビュー指摘 #18: 一括移行の書込み前にも編集ロックを確認する。この移行は
  // シート表示・初期化のたびに全エントリを走査するため、他メンバーが編集ロック中の
  // エントリを対象から静かに除外できないと、ロック中に横から上書きしてしまう
  // （既存のCloud書込み経路 _requireUnlocked と同じ方式。gb-data-access-dropbox-expanded
  // .part01.js を参照）。ロック台帳が読めない/未読込の場合は既存のrequireUnlocked自体が
  // 安全側（拒否）に倒れるため、ここでは特別扱いしない。
  async function _requireEntryUnlocked(provider, path, action) {
    const requireUnlocked = window.MeldexFileLockStore?.requireUnlocked;
    if (typeof requireUnlocked !== 'function') return;
    await requireUnlocked(provider, path, { action });
  }

  async function _migrateEntry(context, entry, sheetName, retired, now) {
    const frontmatter = entry && entry.frontmatter;
    if (!frontmatter || typeof frontmatter !== 'object') return false;
    const properties = frontmatter.properties;
    if (!properties || typeof properties !== 'object' || Array.isArray(properties)) return false;
    const staleKeys = retired.filter(name => Object.prototype.hasOwnProperty.call(properties, name));
    if (!staleKeys.length) return false;

    const removed = {};
    staleKeys.forEach(name => {
      if (_hasValue(properties[name])) removed[name] = properties[name];
      delete properties[name];
    });

    if (Object.keys(removed).length) {
      const existing = frontmatter.production_schema_cleanup;
      const history = Array.isArray(existing) ? existing.slice()
        : (existing && typeof existing === 'object' ? [existing] : []);
      history.push({ sheet: sheetName, removed, migrated_at: now });
      frontmatter.production_schema_cleanup = history;
    }

    await _requireEntryUnlocked(context.provider, entry.path, 'production-schema-cleanup');
    await context.provider.writeText(entry.path, context.frontmatterText(frontmatter, entry.body || ''));
    return true;
  }

  // context: gb-production-management.part01.js の _pmCloudManagedNameContext(provider, internals)
  // が持つ { provider, listEntries(sheet), listTaskSheets(), frontmatterText(fm, body) } を使う。
  async function migrateProductionSchemaCleanup(context) {
    if (!context || typeof context.listEntries !== 'function' || typeof context.frontmatterText !== 'function'
      || typeof context.provider?.writeText !== 'function') {
      return { migrated: 0 };
    }
    const now = new Date().toISOString();
    let migrated = 0;
    for (const sheet of SIMPLE_SHEETS) {
      const retired = RETIRED_SHEET_PROPERTIES[sheet] || [];
      if (!retired.length) continue;
      const entries = await context.listEntries(sheet);
      for (const entry of entries || []) {
        if (await _migrateEntry(context, entry, sheet, retired, now)) migrated += 1;
      }
    }
    const taskRetired = RETIRED_SHEET_PROPERTIES[TASK_LIST_SHEET] || [];
    if (taskRetired.length && typeof context.listTaskSheets === 'function') {
      const sheetNames = await context.listTaskSheets();
      for (const sheetName of sheetNames || []) {
        const entries = await context.listEntries(sheetName);
        for (const entry of entries || []) {
          if (await _migrateEntry(context, entry, TASK_LIST_SHEET, taskRetired, now)) migrated += 1;
        }
      }
    }
    return { migrated };
  }

  // コミット前レビュー指摘 #7: Desktop meldex_production_schema_cleanup.
  // migrate_production_internal_metadata と同等のCloud側一括移行。タスクリスト（+作品別
  // シート）の内部専用列（INTERNAL_METADATA_PROPERTIES。Desktop
  // meldex_production_management_support.INTERNAL_METADATA_PROPERTIES と同一集合。parityは
  // test_meldex_production_schema_cleanup.py で検証）を properties から frontmatter の
  // production_internal 辞書へ移す（削除ではなく移動 — 値は失われない）。冪等: 移す対象が
  // 無いエントリは書き込まない。production_internal優先で既存値は上書きしない。
  const INTERNAL_METADATA_PROPERTIES = Object.freeze([
    '階層パス', '階層ラベル',
    '単位レベル1', '単位レベル2', '単位レベル3', '単位レベル4', '単位レベル5',
    'プリセット種別', '作業作成粒度', 'ページソート値', '作成キー', '元テンプレートID', '作業予定区間',
  ]);
  const TASK_NAME_FIXED_LEGACY_KEY = 'タスク名を固定';
  const TASK_NAME_FIXED_INTERNAL_KEY = 'task_name_fixed';

  function _candidateText(candidates) {
    const values = Array.isArray(candidates) ? candidates : (candidates == null ? [] : [candidates]);
    const adopted = values.find(item => item && typeof item === 'object'
      && (item.status === '採用' || item.status === '掲載済み'));
    const selected = adopted !== undefined ? adopted : (values.length ? values[0] : '');
    if (selected && typeof selected === 'object') return String(selected.value || '');
    return String(selected || '');
  }

  async function _migrateTaskInternalEntry(context, entry) {
    const frontmatter = entry && entry.frontmatter;
    if (!frontmatter || typeof frontmatter !== 'object') return false;
    let changed = false;
    const properties = frontmatter.properties && typeof frontmatter.properties === 'object' && !Array.isArray(frontmatter.properties)
      ? frontmatter.properties : null;
    let internal = frontmatter.production_internal && typeof frontmatter.production_internal === 'object' && !Array.isArray(frontmatter.production_internal)
      ? frontmatter.production_internal : null;

    if (properties) {
      const moved = {};
      INTERNAL_METADATA_PROPERTIES.forEach((key) => {
        if (!Object.prototype.hasOwnProperty.call(properties, key)) return;
        const value = _candidateText(properties[key]);
        if (value && (!internal || !Object.prototype.hasOwnProperty.call(internal, key))) moved[key] = value;
        delete properties[key];
        changed = true;
      });
      if (Object.keys(moved).length) {
        internal = internal ? { ...internal } : {};
        Object.assign(internal, moved);
      }
    }

    if (Object.prototype.hasOwnProperty.call(frontmatter, TASK_NAME_FIXED_LEGACY_KEY)) {
      const legacyFlag = !!frontmatter[TASK_NAME_FIXED_LEGACY_KEY];
      delete frontmatter[TASK_NAME_FIXED_LEGACY_KEY];
      if (legacyFlag && (!internal || !Object.prototype.hasOwnProperty.call(internal, TASK_NAME_FIXED_INTERNAL_KEY))) {
        internal = internal ? { ...internal } : {};
        internal[TASK_NAME_FIXED_INTERNAL_KEY] = true;
      }
      changed = true;
    }

    if (!changed) return false;
    if (properties) frontmatter.properties = properties;
    if (internal) frontmatter.production_internal = internal;
    // コミット前レビュー指摘 #18: _migrateEntry と同じ、書込み前の編集ロック確認。
    await _requireEntryUnlocked(context.provider, entry.path, 'production-internal-metadata-migrate');
    await context.provider.writeText(entry.path, context.frontmatterText(frontmatter, entry.body || ''));
    return true;
  }

  // context: gb-production-management.part01.js の _pmCloudManagedNameContext(provider, internals)。
  // タスクリスト系シート（listTaskSheets が返す「タスクリスト」+作品別「タスクリスト_*」。
  // 「タスクリスト アーカイブ」は列定義を変更していないため対象外 — Desktop側と同じ）のみ対象。
  async function migrateProductionInternalMetadata(context) {
    if (!context || typeof context.listEntries !== 'function' || typeof context.frontmatterText !== 'function'
      || typeof context.provider?.writeText !== 'function' || typeof context.listTaskSheets !== 'function') {
      return { migrated: 0 };
    }
    let migrated = 0;
    const sheetNames = await context.listTaskSheets();
    for (const sheetName of sheetNames || []) {
      const entries = await context.listEntries(sheetName);
      for (const entry of entries || []) {
        if (await _migrateTaskInternalEntry(context, entry)) migrated += 1;
      }
    }
    return { migrated };
  }

  window.MeldexProductionSchemaCleanup = Object.freeze({
    RETIRED_SHEET_PROPERTIES,
    INTERNAL_METADATA_PROPERTIES,
    migrateProductionSchemaCleanup,
    migrateProductionInternalMetadata,
  });
})();
