/* gb-sidecar-migration.js
 *
 * 固有形式付随物廃止・管理データ一元化計画 Phase 5: 既存付随物の安全な自動移行
 * (ブラウザ側。系統C=ブラウザローカル/File System Access API と、
 * 系統D=Cloud静的版・Dropbox個人/共有 の両方を担当する)。
 *
 * 計画書: app/docs/proprietary-format-sidecar-cleanup-plan-2026-07-31.md
 * (§6 既存付随物の安全な自動移行、Phase 5)
 * 監査ノート: app/docs/proprietary-format-sidecar-cleanup-audit-2026-08-01/notes.md
 * 対応するPython側(系統B・単独exe専用): app/meldex_sidecar_migration.py
 *
 * ## 対象
 *
 * - 系統C(board-standalone-fs.js、ブラウザのFile System Access API):
 *   `_meldex/board-annotations.json` → IndexedDB(ANNOTATIONS種別)。
 *   実体のtarget_pathごとのコピー処理は board-standalone-annotations.js の
 *   `migrateLegacyStore` に委譲し、本ファイルは検出→バックアップ→削除→清掃の
 *   オーケストレーションだけを行う。
 * - 系統D(Cloud静的版・Dropbox個人/共有、gb-data-access-dropbox-fileops-*.js):
 *   - アノテート: `_events/annotations/<id>.json` → 共通ストレージ層(ANNOTATIONS種別)
 *   - 閲覧ロック: `_meldex/view-locks/<hash>.json` → 共通ストレージ層(VIEW_LOCKS種別)
 *   - 編集ロック(Cloud専用): `_meldex/file_locks.json` → 共通ストレージ層(EDIT_LOCKS種別)
 *
 * 他の旧付随物は各機能が型付き管理領域を正本とし、旧パスを読取専用
 * フォールバックとして扱う。本モジュールはアノテート・閲覧ロック・編集ロックの
 * 検証済み移行と、旧クライアント再生成時の互換性ロックだけを担当する。
 *
 * ## 冪等性・中断安全性
 *
 * 各対象は台帳(MIGRATION_LEDGER種別)の状態を見て「次に何をすべきか」を判断する。
 * 途中で処理が中断されても、次回呼び出し時に未完了の部分から自然に再開する。
 *
 * ## 失敗時の原則(計画書§6.3)
 *
 * 破損・権限不足・容量不足・競合・不明ファイル混在では、該当対象の移行を保留する
 * だけで削除は行わない。新領域に既にデータがある場合も上書きしない。
 */
(function () {
  'use strict';

  const NS = (window.MeldexSidecarMigration = window.MeldexSidecarMigration || {});

  function _contract() {
    return window.MeldexSystemStorage || null;
  }

  function _nowText() {
    const contract = _contract();
    return contract ? contract.nowIso() : new Date().toISOString();
  }

  // --- 系統C: ブラウザローカル(board-standalone-fs.js) ---------------------------
  //
  // 台帳・移行バックアップの保存先はIndexedDB(gb-system-storage-indexeddb.js)。
  // 削除・空フォルダ判定はFile System Access APIハンドルへ直接触れる必要があるため、
  // 呼び出し元(board-standalone-fs.js)が deleteFile/directoryHasEntries を提供する。

  const STANDALONE_LEDGER_DOC_ID = 'standalone-board-annotations-v1';

  function _localBrowserAdapter() {
    const factory = window.MeldexSystemStorageIndexedDB;
    if (!factory || typeof factory.createLocalBrowserAdapter !== 'function') return null;
    return factory.createLocalBrowserAdapter({ boundary: 'browser-local' });
  }

  /**
   * ブラウザローカル単独アプリ向けの移行エントリポイント。
   * `board-standalone-fs.js` が起動時(ルートフォルダ確定後)に1回呼ぶことを想定する。
   *
   * @param {object} fsHelpers
   * @param {(relPath:string)=>Promise<string>} fsHelpers.readFileAsText
   * @param {(relPath:string,text:string)=>Promise<void>} fsHelpers.writeFileText
   * @param {(relPath:string)=>Promise<boolean>} fsHelpers.fileExists
   * @param {(relPath:string)=>Promise<void>} fsHelpers.deleteFile
   * @param {(dirRelPath:string)=>Promise<boolean>} fsHelpers.directoryIsEmpty - 対象フォルダが空(またはフォルダ自体が無い)なら true
   * @param {(dirRelPath:string)=>Promise<void>} fsHelpers.removeEmptyDirectory
   */
  NS.migrateStandaloneBoardAnnotations = async function (fsHelpers) {
    const helper = window.BoardStandaloneAnnotations;
    const adapter = _localBrowserAdapter();
    const contract = _contract();
    if (!helper || !adapter || !contract) {
      return { status: 'error', detail: '移行に必要なモジュールが読み込まれていません' };
    }
    const legacyPath = helper.LEGACY_STORE_PATH || '_meldex/board-annotations.json';
    let exists = true;
    if (typeof fsHelpers.fileExists === 'function') {
      try {
        exists = await fsHelpers.fileExists(legacyPath);
      } catch (error) {
        return { status: 'error', detail: `旧付随物の存在を確認できません: ${error && error.message}` };
      }
    }
    if (!exists) return { status: 'no_legacy_data' };

    const nowText = _nowText();
    let ledgerRecord = null;
    try {
      ledgerRecord = await adapter.load(contract.SystemStorageKind.MIGRATION_LEDGER, STANDALONE_LEDGER_DOC_ID);
    } catch (error) {
      return { status: 'error', detail: `移行台帳を読み込めません: ${error && error.message}` };
    }
    const ledgerPayload = (ledgerRecord && ledgerRecord.payload) ? { ...ledgerRecord.payload } : {};

    const result = await helper.migrateLegacyStore({
      readFileAsText: fsHelpers.readFileAsText,
      writeFileText: fsHelpers.writeFileText,
      fileExists: fsHelpers.fileExists,
    });
    if (result.status === 'no_legacy_data') return result;
    if (result.status === 'error') {
      ledgerPayload.last_error = result.detail;
      ledgerPayload.last_checked_at = nowText;
      try {
        await adapter.save(contract.SystemStorageKind.MIGRATION_LEDGER, STANDALONE_LEDGER_DOC_ID, ledgerPayload);
      } catch (error) {
        return { status: 'error', detail: `移行失敗を台帳へ保存できません: ${error && error.message}` };
      }
      return result;
    }

    ledgerPayload.source_kind = 'local-board-annotations';
    ledgerPayload.legacy_relative_path = legacyPath;
    ledgerPayload.last_checked_at = nowText;
    ledgerPayload.targets_total = result.targetsTotal;
    ledgerPayload.targets_migrated = result.targetsMigrated;
    delete ledgerPayload.last_error;

    if (result.status === 'in_progress') {
      ledgerPayload.target_errors = result.targetErrors;
      try {
        await adapter.save(contract.SystemStorageKind.MIGRATION_LEDGER, STANDALONE_LEDGER_DOC_ID, ledgerPayload);
      } catch (error) {
        return { status: 'in_progress', detail: `移行途中の台帳を保存できないため旧データを残しました: ${error && error.message}`, ...result };
      }
      return { status: 'in_progress', detail: '一部のtarget_pathで移行できませんでした(次回実行時に再試行します)', ...result };
    }

    // 退避(まだ済んでいなければ)
    let backupDocumentId = ledgerPayload.backup_document_id;
    if (!backupDocumentId) {
      backupDocumentId = `${STANDALONE_LEDGER_DOC_ID}-${Date.now().toString(36)}`;
      try {
        const backupPayload = {
          source_kind: 'local-board-annotations',
          legacy_relative_path: legacyPath,
          legacy_content: result.legacyContent,
          backed_up_at: nowText,
        };
        const savedBackup = await adapter.save(
          contract.SystemStorageKind.MIGRATION_BACKUPS, backupDocumentId, backupPayload,
          { expectedRevision: null },
        );
        const reloadedBackup = await adapter.load(contract.SystemStorageKind.MIGRATION_BACKUPS, backupDocumentId);
        if (!reloadedBackup || !_recordsMatch(reloadedBackup.payload, backupPayload)) {
          throw new Error('移行バックアップを再読込して照合できませんでした');
        }
        if (savedBackup?.revision && reloadedBackup.revision && savedBackup.revision !== reloadedBackup.revision) {
          throw new Error('移行バックアップのrevisionが再読込結果と一致しません');
        }
        ledgerPayload.backup_document_id = backupDocumentId;
        ledgerPayload.backed_up_at = nowText;
        await adapter.save(contract.SystemStorageKind.MIGRATION_LEDGER, STANDALONE_LEDGER_DOC_ID, ledgerPayload);
      } catch (error) {
        return { status: 'in_progress', detail: `移行バックアップへの退避に失敗したため削除を保留しました: ${error && error.message}` };
      }
    }

    // 削除直前に旧ファイルが変わっていないか再確認する(同時編集への対応)。
    let currentText = null;
    try {
      currentText = await fsHelpers.readFileAsText(legacyPath);
    } catch (error) {
      return { status: 'in_progress', detail: `削除直前に旧付随物を再読込できないため削除を保留しました: ${error && error.message}` };
    }
    if (currentText !== result.legacyContent) {
      return { status: 'in_progress', detail: '削除直前に旧付随物が更新されていたため、今回は削除を見送りました(次回実行で再評価します)' };
    }

    if (typeof fsHelpers.deleteFile === 'function') {
      try {
        await fsHelpers.deleteFile(legacyPath);
      } catch (error) {
        return { status: 'in_progress', detail: `旧付随物の削除に失敗しました: ${error && error.message}` };
      }
      ledgerPayload.legacy_deleted_at = nowText;
      try {
        await adapter.save(contract.SystemStorageKind.MIGRATION_LEDGER, STANDALONE_LEDGER_DOC_ID, ledgerPayload);
      } catch (error) {
        return { status: 'in_progress', legacyDeleted: true, detail: `旧データ削除後の台帳保存に失敗しました: ${error && error.message}` };
      }
    }

    let folderCleaned = false;
    if (typeof fsHelpers.directoryIsEmpty === 'function' && typeof fsHelpers.removeEmptyDirectory === 'function') {
      const legacyDir = legacyPath.slice(0, legacyPath.lastIndexOf('/')) || '_meldex';
      try {
        if (await fsHelpers.directoryIsEmpty(legacyDir)) {
          await fsHelpers.removeEmptyDirectory(legacyDir);
          folderCleaned = true;
        }
      } catch { /* 清掃の失敗は致命的ではない */ }
    }

    return { status: 'completed', targetsTotal: result.targetsTotal, targetsMigrated: result.targetsMigrated, folderCleaned };
  };

  // 固有形式付随物廃止・管理データ一元化計画 フェーズB徹底チェック(c): 移行
  // バックアップ・競合バックアップの30日保持(計画書§6.3)が、判定関数
  // (selectDocumentsExceedingRetention)のみ存在し呼び出し元が無いため
  // 実質無期限だった問題への対応。ブラウザローカル(IndexedDB)向けの
  // エントリポイント。呼び出し元(board-standalone-fs.js)が起動時(ルート
  // フォルダ確定後)に1回呼ぶことを想定する(移行と同じタイミング方針)。
  NS.runStandaloneRetentionCleanup = async function () {
    const adapter = _localBrowserAdapter();
    const contract = _contract();
    if (!adapter || !contract || typeof contract.runRetentionCleanup !== 'function') return null;
    return contract.runRetentionCleanup(adapter);
  };

  // --- 系統D: Cloud静的版・Dropbox個人/共有 -------------------------------------

  const CLOUD_LEDGER_DOC_ID = 'cloud-sidecar-migration-v1';

  function _internals() {
    return window.__MeldexPwaDataAccessInternals || null;
  }

  async function _managementAdapterForProvider(provider) {
    const resolver = window.MeldexDropboxManagementRootResolver;
    if (!resolver) return null;
    try { return await resolver.resolveAdapterForProvider(provider); } catch { return null; }
  }

  const CLOUD_MULTI_DOCUMENT_SOURCES = [
    { key: 'cloud-annotations', legacyDir: '_events/annotations', kindName: 'ANNOTATIONS' },
    { key: 'cloud-view-locks', legacyDir: '_meldex/view-locks', kindName: 'VIEW_LOCKS' },
  ];
  const CLOUD_SINGLE_DOCUMENT_SOURCES = [
    { key: 'cloud-file-locks', legacyPath: '_meldex/file_locks.json', kindName: 'EDIT_LOCKS', documentId: 'file-lock-store' },
  ];

  // 照合(計画書の手順3。Python版=件数再照合、ブラウザローカル版=部分集合
  // 安全性チェックと同等の安全策をCloud版へも追加する。フェーズB徹底チェック
  // で判明: 従来はadapter.save()の成功(例外なし)だけを根拠に即verified扱い
  // していたため、書込が実際に反映されたかを一切確認していなかった)。
  //
  // Cloud側の1ドキュメントは(boardアノテートのようなtarget_path単位の行配列では
  // なく)旧ファイル1つ=新領域1ドキュメントの対応なので、「件数」ではなく
  // 「新領域から再読込した内容が、書き込もうとした内容と一致するか」を
  // 照合の基準にする(単一ドキュメントに対しては件数一致より厳密な検査)。
  function _canonicalJson(value) {
    if (Array.isArray(value)) return `[${value.map(_canonicalJson).join(',')}]`;
    if (value && typeof value === 'object') {
      return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${_canonicalJson(value[key])}`).join(',')}}`;
    }
    return JSON.stringify(value);
  }

  function _recordsMatch(a, b) {
    try { return _canonicalJson(a) === _canonicalJson(b); } catch { return false; }
  }

  async function _sha256Text(text) {
    const bytes = new TextEncoder().encode(String(text));
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
  }

  function _schemaOf(value) {
    return value && typeof value === 'object'
      ? (value.schema_version ?? value.schema ?? 1) : 1;
  }

  function _itemsAndIds(value, fallbackId) {
    let items = null;
    if (Array.isArray(value)) items = value;
    else if (value && typeof value === 'object') {
      for (const key of ['annotations', 'entries', 'items', 'locks']) {
        if (Array.isArray(value[key])) { items = value[key]; break; }
      }
    }
    if (!items) return { count: 1, sortedIds: [String(fallbackId)] };
    const ids = items.map((item, index) => String(
      item && typeof item === 'object'
        ? (item.id ?? item.path ?? item.target_path ?? item.name ?? '')
        : '',
    ));
    if (ids.some(id => !id) || new Set(ids).size !== ids.length) {
      throw new Error('IDの無い行または重複IDが含まれています');
    }
    return { count: items.length, sortedIds: ids.sort() };
  }

  async function _sourceRevision(provider, path, rawHash) {
    let meta = null;
    try {
      if (typeof provider.getMetadata === 'function') meta = await provider.getMetadata(path);
      else if (typeof provider.statPath === 'function') meta = await provider.statPath(path);
    } catch { meta = null; }
    return String((meta && (meta.rev || meta.content_hash || meta.etag)) || rawHash);
  }

  async function _readLegacyArtifact(provider, path, fallbackId) {
    let rawText;
    if (typeof provider.readText === 'function') {
      rawText = await provider.readText(path);
    } else {
      const value = await _internals()._readJsonSafe(provider, path, null);
      if (value == null) throw new Error('旧付随物を読み込めません');
      rawText = JSON.stringify(value);
    }
    const record = JSON.parse(rawText);
    if (record == null || typeof record !== 'object') throw new Error('旧付随物が既知の形式ではありません');
    const rawBytesSha256 = await _sha256Text(rawText);
    const ids = _itemsAndIds(record, fallbackId);
    return {
      record,
      rawText,
      integrity: {
        count: ids.count,
        sorted_ids: ids.sortedIds,
        normalized_json_sha256: await _sha256Text(_canonicalJson(record)),
        raw_bytes_sha256: rawBytesSha256,
        schema: _schemaOf(record),
        source_revision: await _sourceRevision(provider, path, rawBytesSha256),
      },
    };
  }

  const LEGACY_DELETE_QUARANTINE_SUFFIX = '.migration-quarantine';

  async function _strictPathExists(provider, path) {
    const internals = _internals();
    if (!internals || typeof internals._pathExists !== 'function') {
      throw new Error('旧付随物の存在確認機能がありません');
    }
    return internals._pathExists(provider, path);
  }

  async function _recoverInterruptedQuarantine(provider, legacyPath) {
    const quarantinePath = `${legacyPath}${LEGACY_DELETE_QUARANTINE_SUFFIX}`;
    const quarantineExists = await _strictPathExists(provider, quarantinePath);
    if (!quarantineExists) return { ok: true, recovered: false };
    const originalExists = await _strictPathExists(provider, legacyPath);
    if (originalExists) {
      return { ok: false, detail: `旧付随物と削除隔離データの両方が存在します: ${legacyPath}` };
    }
    if (typeof provider.movePath !== 'function') {
      return { ok: false, detail: `中断された削除隔離データを復旧できません: ${legacyPath}` };
    }
    await provider.movePath(quarantinePath, legacyPath);
    return { ok: true, recovered: true };
  }

  async function _quarantineVerifiedLegacyArtifact(provider, legacyPath, expectedIntegrity, fallbackId) {
    if (typeof provider.movePath !== 'function') {
      return { ok: false, detail: '条件付き削除に必要な隔離移動機能がありません' };
    }
    const quarantinePath = `${legacyPath}${LEGACY_DELETE_QUARANTINE_SUFFIX}`;
    if (await _strictPathExists(provider, quarantinePath)) {
      return { ok: false, detail: `削除隔離データが既に存在します: ${quarantinePath}` };
    }
    try {
      await provider.movePath(legacyPath, quarantinePath);
    } catch (error) {
      return { ok: false, detail: `旧付随物を削除前に隔離できません: ${error && error.message}` };
    }
    let moved;
    try {
      moved = await _readLegacyArtifact(provider, quarantinePath, fallbackId);
    } catch (error) {
      try {
        if (!await _strictPathExists(provider, legacyPath)) {
          await provider.movePath(quarantinePath, legacyPath);
        }
      } catch { /* 隔離データを残し、削除はしない。 */ }
      return { ok: false, detail: `隔離後の旧付随物を再読込できません: ${error && error.message}`, quarantinePath };
    }
    const matches = (
      moved.integrity.raw_bytes_sha256 === expectedIntegrity.raw_bytes_sha256
      && moved.integrity.normalized_json_sha256 === expectedIntegrity.normalized_json_sha256
      && moved.integrity.count === expectedIntegrity.count
      && _recordsMatch(moved.integrity.sorted_ids, expectedIntegrity.sorted_ids)
      && moved.integrity.schema === expectedIntegrity.schema
    );
    if (!matches) {
      try {
        if (!await _strictPathExists(provider, legacyPath)) {
          await provider.movePath(quarantinePath, legacyPath);
        }
      } catch { /* 隔離データを残す。削除はしない。 */ }
      return { ok: false, detail: `隔離後の旧付随物が照合済み内容と異なるため保全しました: ${legacyPath}` };
    }
    try {
      await provider.deletePath(quarantinePath);
    } catch (error) {
      try {
        if (!await _strictPathExists(provider, legacyPath)) {
          await provider.movePath(quarantinePath, legacyPath);
        }
      } catch { /* 隔離データを残し、削除はしない。 */ }
      return { ok: false, detail: `照合済み隔離データを削除できません: ${error && error.message}` };
    }
    if (await _strictPathExists(provider, legacyPath)) {
      return { ok: false, detail: `削除処理中に旧クライアントが付随物を再生成しました: ${legacyPath}`, recreated: true };
    }
    return { ok: true };
  }

  async function _verifyWrittenRecord(adapter, kind, docId, { wroteNew, record }) {
    let verifyRecord = null;
    try {
      verifyRecord = await adapter.load(kind, docId);
    } catch {
      verifyRecord = null;
    }
    const verifyPayload = (verifyRecord && typeof verifyRecord.payload === 'object' && verifyRecord.payload !== null)
      ? verifyRecord.payload : null;
    if (!verifyPayload) {
      return { ok: false, detail: '照合に失敗しました(新領域から読み戻せません)' };
    }
    if (!_recordsMatch(verifyPayload, record)) {
      return { ok: false, detail: '照合に失敗しました(書き込んだ内容と一致しません)' };
    }
    return { ok: true, record: verifyRecord };
  }

  async function _migrateMultiDocumentSource(provider, adapter, source, sourceState, nowText) {
    const internals = _internals();
    const contract = _contract();
    const kind = contract.SystemStorageKind[source.kindName];
    let entries;
    try {
      entries = await internals._listDirectoryEntries(provider, source.legacyDir);
    } catch (error) {
      if (/フォルダが見つかりません|path[_ ]?not[_ ]?found|not found/i.test(String((error && error.message) || error))) {
        return {
          targetsTotal: 0, targetsMigrated: 0, targetErrors: {},
          legacyEntries: [], unknownEntries: [], readFailed: false, noLegacyData: true,
        };
      }
      return {
        targetsTotal: 0, targetsMigrated: 0, targetErrors: { _directory: `旧フォルダを読み込めません: ${error && error.message}` },
        legacyEntries: [], unknownEntries: [], readFailed: true,
      };
    }
    const interrupted = entries.filter(entry => String(entry && entry.name || '').endsWith(LEGACY_DELETE_QUARANTINE_SUFFIX));
    for (const entry of interrupted) {
      const originalName = String(entry.name).slice(0, -LEGACY_DELETE_QUARANTINE_SUFFIX.length);
      try {
        const recovered = await _recoverInterruptedQuarantine(provider, `${source.legacyDir}/${originalName}`);
        if (!recovered.ok) {
          return {
            targetsTotal: 0, targetsMigrated: 0,
            targetErrors: { _quarantine: recovered.detail },
            legacyEntries: [], unknownEntries: [entry.name], readFailed: true,
          };
        }
      } catch (error) {
        return {
          targetsTotal: 0, targetsMigrated: 0,
          targetErrors: { _quarantine: `削除隔離データを復旧できません: ${error && error.message}` },
          legacyEntries: [], unknownEntries: [entry.name], readFailed: true,
        };
      }
    }
    if (interrupted.length) {
      try {
        entries = await internals._listDirectoryEntries(provider, source.legacyDir);
      } catch (error) {
        return {
          targetsTotal: 0, targetsMigrated: 0,
          targetErrors: { _directory: `復旧後の旧フォルダを読み込めません: ${error && error.message}` },
          legacyEntries: [], unknownEntries: [], readFailed: true,
        };
      }
    }
    const jsonEntries = entries.filter(entry => entry && entry.handle && entry.handle.kind === 'file' && /\.json$/i.test(entry.name || ''));
    const unknownEntries = entries.filter(entry => !jsonEntries.includes(entry)).map(entry => String(entry && entry.name || ''));
    const targets = sourceState.targets || (sourceState.targets = {});
    const targetErrors = {};
    let migratedCount = 0;
    for (const entry of jsonEntries) {
      const docId = entry.name.slice(0, -5);
      const legacyRelPath = `${source.legacyDir}/${entry.name}`;
      try {
        const artifact = await _readLegacyArtifact(provider, legacyRelPath, docId);
        const record = artifact.record;
        let existing = null;
        try { existing = await adapter.load(kind, docId); } catch (error) { throw error; }
        const wroteNew = existing == null;
        let saveResponse = existing;
        if (wroteNew) {
          try {
            saveResponse = await adapter.save(kind, docId, record, { expectedRevision: null });
          } catch (error) {
            const raced = await adapter.load(kind, docId).catch(() => null);
            if (!raced || !_recordsMatch(raced.payload, record)) throw error;
            existing = raced;
            saveResponse = raced;
          }
        } else if (!_recordsMatch(existing.payload, record)) {
          targets[docId] = {
            ...artifact.integrity, status: 'conflict',
            destination_revision: existing.revision || '',
            last_error: '新領域に異なる既存データがあるため双方を保全しました',
          };
          targetErrors[docId] = targets[docId].last_error;
          continue;
        }
        const verification = await _verifyWrittenRecord(adapter, kind, docId, { wroteNew, record });
        if (!verification.ok) {
          targets[docId] = { status: 'error', last_error: verification.detail };
          targetErrors[docId] = verification.detail;
          continue;
        }
        const saveRevision = String((saveResponse && saveResponse.revision) || '');
        const reloadRevision = String((verification.record && verification.record.revision) || '');
        if (saveRevision && reloadRevision && saveRevision !== reloadRevision) {
          throw new Error('保存応答と再読込先のrevisionが一致しません');
        }
        targets[docId] = {
          ...artifact.integrity, status: 'verified', verified_at: nowText,
          legacy_relative_path: legacyRelPath,
          save_response_revision: saveRevision || reloadRevision,
          reloaded_destination_revision: reloadRevision,
        };
        migratedCount += 1;
      } catch (error) {
        targets[docId] = { status: 'error', last_error: String((error && error.message) || error) };
        targetErrors[docId] = targets[docId].last_error;
      }
    }
    if (unknownEntries.length) targetErrors._unknown = `不明ファイルが混在しています: ${unknownEntries.join(', ')}`;
    return {
      targetsTotal: jsonEntries.length, targetsMigrated: migratedCount, targetErrors,
      legacyEntries: jsonEntries.map(entry => ({ name: entry.name, path: `${source.legacyDir}/${entry.name}` })),
      unknownEntries,
    };
  }

  async function _migrateSingleDocumentSource(provider, adapter, source, sourceState, nowText) {
    const internals = _internals();
    const contract = _contract();
    const kind = contract.SystemStorageKind[source.kindName];
    try {
      const recovered = await _recoverInterruptedQuarantine(provider, source.legacyPath);
      if (!recovered.ok) {
        return {
          targetsTotal: 0, targetsMigrated: 0,
          targetErrors: { _quarantine: recovered.detail },
          readFailed: true,
        };
      }
    } catch (error) {
      return {
        targetsTotal: 0, targetsMigrated: 0,
        targetErrors: { _quarantine: `削除隔離データを復旧できません: ${error && error.message}` },
        readFailed: true,
      };
    }
    let exists;
    try {
      exists = await internals._pathExists(provider, source.legacyPath);
    } catch (error) {
      return {
        targetsTotal: 0,
        targetsMigrated: 0,
        targetErrors: { _path: `旧付随物の存在を確認できません: ${error && error.message}` },
        readFailed: true,
      };
    }
    if (!exists) return { targetsTotal: 0, targetsMigrated: 0, targetErrors: {}, noLegacyData: true };
    const targets = sourceState.targets || (sourceState.targets = {});
    try {
      const artifact = await _readLegacyArtifact(provider, source.legacyPath, source.documentId);
      const record = artifact.record;
      let existing = null;
      existing = await adapter.load(kind, source.documentId);
      const wroteNew = existing == null;
      let saveResponse = existing;
      if (wroteNew) {
        saveResponse = await adapter.save(kind, source.documentId, record, { expectedRevision: null });
      } else if (!_recordsMatch(existing.payload, record)) {
        const detail = '新領域に異なる既存データがあるため双方を保全しました';
        targets[source.documentId] = {
          ...artifact.integrity, status: 'conflict',
          destination_revision: existing.revision || '', last_error: detail,
        };
        return { targetsTotal: 1, targetsMigrated: 0, targetErrors: { [source.documentId]: detail }, legacyArtifact: artifact };
      }
      const verification = await _verifyWrittenRecord(adapter, kind, source.documentId, { wroteNew, record });
      if (!verification.ok) {
        targets[source.documentId] = { status: 'error', last_error: verification.detail };
        return { targetsTotal: 1, targetsMigrated: 0, targetErrors: { [source.documentId]: verification.detail } };
      }
      targets[source.documentId] = {
        ...artifact.integrity, status: 'verified', verified_at: nowText,
        legacy_relative_path: source.legacyPath,
        save_response_revision: String((saveResponse && saveResponse.revision) || ''),
        reloaded_destination_revision: String(verification.record.revision || ''),
      };
      if (
        targets[source.documentId].save_response_revision
        && targets[source.documentId].reloaded_destination_revision
        && targets[source.documentId].save_response_revision !== targets[source.documentId].reloaded_destination_revision
      ) throw new Error('保存応答と再読込先のrevisionが一致しません');
      return { targetsTotal: 1, targetsMigrated: 1, targetErrors: {}, legacyArtifact: artifact };
    } catch (error) {
      const message = String((error && error.message) || error);
      targets[source.documentId] = { status: 'error', last_error: message };
      return { targetsTotal: 1, targetsMigrated: 0, targetErrors: { [source.documentId]: message } };
    }
  }

  async function _backupAndDeleteLegacyDir(provider, adapter, source, sourceState, legacyEntries, nowText, persistLedger) {
    const internals = _internals();
    const snapshot = {};
    for (const entry of legacyEntries) {
      try {
        const artifact = await _readLegacyArtifact(provider, entry.path, entry.name.slice(0, -5));
        snapshot[entry.name] = { raw_text: artifact.rawText, integrity: artifact.integrity };
      } catch (error) {
        return { ok: false, detail: `バックアップ元の読込に失敗しました(${entry.name}): ${error && error.message}` };
      }
    }
    let backupId = sourceState.backup_document_id;
    let backupPayload = null;
    if (backupId) {
      const existingBackup = await adapter.load(_contract().SystemStorageKind.MIGRATION_BACKUPS, backupId).catch(() => null);
      if (existingBackup && _recordsMatch(existingBackup.payload.legacy_snapshot, snapshot)) {
        backupPayload = existingBackup.payload;
      } else {
        backupId = null;
      }
    }
    if (!backupId) {
      backupId = `${CLOUD_LEDGER_DOC_ID}-${source.key}-${Date.now().toString(36)}`;
      backupPayload = {
        source_kind: source.key, legacy_dir: source.legacyDir,
        legacy_snapshot: snapshot, backed_up_at: nowText,
      };
      try {
        await adapter.save(_contract().SystemStorageKind.MIGRATION_BACKUPS, backupId, backupPayload, { expectedRevision: null });
        const reloaded = await adapter.load(_contract().SystemStorageKind.MIGRATION_BACKUPS, backupId);
        if (!reloaded || !_recordsMatch(reloaded.payload, backupPayload)) throw new Error('バックアップ再読込照合に失敗しました');
      } catch (error) {
        return { ok: false, detail: `移行バックアップへの退避に失敗しました: ${error && error.message}` };
      }
      sourceState.backup_document_id = backupId;
      sourceState.backed_up_at = nowText;
    }
    try { await persistLedger(); } catch (error) {
      return { ok: false, detail: `台帳へバックアップ情報を保存できません: ${error && error.message}` };
    }

    let currentEntries;
    try {
      currentEntries = await internals._listDirectoryEntries(provider, source.legacyDir);
    } catch (error) {
      return { ok: false, detail: `削除直前の旧フォルダ再読込に失敗しました: ${error && error.message}` };
    }
    const currentNames = currentEntries.map(entry => String(entry && entry.name || '')).sort();
    const expectedNames = legacyEntries.map(entry => entry.name).sort();
    if (!_recordsMatch(currentNames, expectedNames)) {
      return { ok: false, detail: '削除直前に不明ファイル混在または内容一覧の変更を検出しました' };
    }
    const kind = _contract().SystemStorageKind[source.kindName];
    for (const entry of legacyEntries) {
      const docId = entry.name.slice(0, -5);
      const current = await _readLegacyArtifact(provider, entry.path, docId).catch(() => null);
      const expected = snapshot[entry.name];
      const destination = await adapter.load(kind, docId).catch(() => null);
      const targetState = (sourceState.targets || {})[docId] || {};
      if (
        !current || current.integrity.raw_bytes_sha256 !== expected.integrity.raw_bytes_sha256
        || current.integrity.source_revision !== expected.integrity.source_revision
        || !destination
        || String(destination.revision || '') !== String(targetState.reloaded_destination_revision || '')
        || await _sha256Text(_canonicalJson(destination.payload)) !== targetState.normalized_json_sha256
      ) {
        return { ok: false, detail: `削除直前のhash/revision照合に失敗しました: ${entry.name}` };
      }
    }
    // 削除失敗を握りつぶさない(PC側 meldex_sidecar_migration.py・ブラウザ
    // ローカル側 board-standalone-annotations.js の migrateLegacyStore と
    // 同じ意味論に揃える)。一部だけ削除に失敗しても、成功した分は次回実行時
    // 再スキャンで自然に対象から外れるため個別のロールバックは不要だが、
    // 全体としては「完了」にせず、エラーを台帳へ残して次回接続時の再試行
    // 対象に残す(フェーズB徹底チェックで判明。Cloud側だけ削除失敗が
    // ok:true 扱いになり、台帳が誤って完了扱いになっていた)。
    const deleteErrors = {};
    for (const { name } of legacyEntries) {
      const expected = snapshot[name];
      const deleted = await _quarantineVerifiedLegacyArtifact(
        provider,
        `${source.legacyDir}/${name}`,
        expected.integrity,
        name.slice(0, -5),
      );
      if (!deleted.ok) deleteErrors[name] = deleted.detail;
    }
    if (Object.keys(deleteErrors).length) {
      return {
        ok: false,
        detail: `旧付随物の削除に失敗しました: ${Object.values(deleteErrors).join('; ')}`,
        deleteErrors,
      };
    }
    return { ok: true };
  }

  async function _backupAndDeleteLegacyFile(provider, adapter, source, sourceState, artifact, nowText, persistLedger) {
    let backupId = sourceState.backup_document_id;
    const backupPayload = {
      source_kind: source.key, legacy_path: source.legacyPath,
      legacy_raw_text: artifact.rawText, source_snapshot: artifact.integrity,
      backed_up_at: nowText,
    };
    if (backupId) {
      const existing = await adapter.load(_contract().SystemStorageKind.MIGRATION_BACKUPS, backupId).catch(() => null);
      if (!existing || !_recordsMatch(existing.payload.source_snapshot, artifact.integrity)) backupId = null;
    }
    if (!backupId) {
      backupId = `${CLOUD_LEDGER_DOC_ID}-${source.key}-${Date.now().toString(36)}`;
      try {
        await adapter.save(_contract().SystemStorageKind.MIGRATION_BACKUPS, backupId, backupPayload, { expectedRevision: null });
        const reloaded = await adapter.load(_contract().SystemStorageKind.MIGRATION_BACKUPS, backupId);
        if (!reloaded || !_recordsMatch(reloaded.payload, backupPayload)) throw new Error('バックアップ再読込照合に失敗しました');
      } catch (error) {
        return { ok: false, detail: `移行バックアップへの退避に失敗しました: ${error && error.message}` };
      }
      sourceState.backup_document_id = backupId;
      sourceState.backed_up_at = nowText;
    }
    try { await persistLedger(); } catch (error) {
      return { ok: false, detail: `台帳へバックアップ情報を保存できません: ${error && error.message}` };
    }
    const current = await _readLegacyArtifact(provider, source.legacyPath, source.documentId).catch(() => null);
    const destination = await adapter.load(_contract().SystemStorageKind[source.kindName], source.documentId).catch(() => null);
    const state = (sourceState.targets || {})[source.documentId] || {};
    if (
      !current
      || current.integrity.raw_bytes_sha256 !== artifact.integrity.raw_bytes_sha256
      || current.integrity.source_revision !== artifact.integrity.source_revision
      || !destination
      || String(destination.revision || '') !== String(state.reloaded_destination_revision || '')
      || await _sha256Text(_canonicalJson(destination.payload)) !== state.normalized_json_sha256
    ) {
      return { ok: false, detail: '削除直前の元/先hash・revision照合に失敗しました' };
    }
    // 削除失敗を握りつぶさない(上記 _backupAndDeleteLegacyDir と同じ理由。
    // フェーズB徹底チェックで判明)。
    return _quarantineVerifiedLegacyArtifact(
      provider, source.legacyPath, artifact.integrity, source.documentId,
    );
  }

  /**
   * Cloud静的版・Dropbox個人/共有 向けの移行エントリポイント。
   * `gb-cloud-bootstrap.js` が接続確立(owner/editor権限)後に1回呼ぶことを想定する。
   */
  async function _persistCloudLedger(adapter, payload) {
    const kind = _contract().SystemStorageKind.MIGRATION_LEDGER;
    // 読込不能を「台帳なし」とみなすと既存台帳をcreate-onlyで上書きし得る。
    const current = await adapter.load(kind, CLOUD_LEDGER_DOC_ID);
    const options = current && current.revision
      ? { expectedRevision: current.revision } : (current ? {} : { expectedRevision: null });
    const saved = await adapter.save(kind, CLOUD_LEDGER_DOC_ID, payload, options);
    const reloaded = await adapter.load(kind, CLOUD_LEDGER_DOC_ID);
    if (!reloaded || !_recordsMatch(reloaded.payload, payload)) throw new Error('移行台帳の再読込照合に失敗しました');
    if (saved && saved.revision && reloaded.revision && saved.revision !== reloaded.revision) {
      throw new Error('移行台帳の保存応答revisionと再読込revisionが一致しません');
    }
    return reloaded;
  }

  NS.migrateCloudSidecars = async function (provider) {
    const internals = _internals();
    const contract = _contract();
    if (!internals || !contract || !provider) {
      return { status: 'error', detail: '移行に必要なモジュールが読み込まれていません' };
    }
    const adapter = await _managementAdapterForProvider(provider);
    if (!adapter) return { status: 'error', detail: '管理領域アダプターを解決できませんでした(Dropbox未接続の可能性)' };

    const nowText = _nowText();
    let ledgerRecord = null;
    try {
      ledgerRecord = await adapter.load(contract.SystemStorageKind.MIGRATION_LEDGER, CLOUD_LEDGER_DOC_ID);
    } catch (error) {
      return { status: 'error', detail: `移行台帳を読み込めません: ${error && error.message}` };
    }
    const ledgerPayload = (ledgerRecord && ledgerRecord.payload) ? { ...ledgerRecord.payload } : {};
    const sources = ledgerPayload.sources || (ledgerPayload.sources = {});
    const persistLedger = () => _persistCloudLedger(adapter, ledgerPayload);

    const summary = { status: 'completed', sources: {} };
    for (const source of CLOUD_MULTI_DOCUMENT_SOURCES) {
      const sourceState = sources[source.key] || (sources[source.key] = {});
      const stepResult = await _migrateMultiDocumentSource(provider, adapter, source, sourceState, nowText);
      let sourceStatus = 'completed';
      if (Object.keys(stepResult.targetErrors).length) {
        sourceStatus = 'in_progress';
      } else if (stepResult.targetsTotal > 0) {
        try { await persistLedger(); } catch (error) {
          sourceState.last_error = `台帳保存に失敗しました: ${error && error.message}`;
          sourceStatus = 'in_progress';
        }
        const outcome = sourceStatus === 'completed'
          ? await _backupAndDeleteLegacyDir(provider, adapter, source, sourceState, stepResult.legacyEntries, nowText, persistLedger)
          : { ok: false, detail: sourceState.last_error };
        if (!outcome.ok) {
          sourceStatus = 'in_progress';
          sourceState.last_error = outcome.detail;
        } else {
          sourceState.legacy_deleted_at = nowText;
          delete sourceState.last_error;
        }
      }
      sourceState.last_checked_at = nowText;
      summary.sources[source.key] = { status: sourceStatus, ...stepResult };
      if (sourceStatus !== 'completed') summary.status = 'in_progress';
    }
    for (const source of CLOUD_SINGLE_DOCUMENT_SOURCES) {
      const sourceState = sources[source.key] || (sources[source.key] = {});
      const stepResult = await _migrateSingleDocumentSource(provider, adapter, source, sourceState, nowText);
      let sourceStatus = 'completed';
      if (stepResult.noLegacyData) {
        sourceStatus = 'no_legacy_data';
      } else if (Object.keys(stepResult.targetErrors).length) {
        sourceStatus = 'in_progress';
      } else if (stepResult.targetsTotal > 0) {
        try { await persistLedger(); } catch (error) {
          sourceState.last_error = `台帳保存に失敗しました: ${error && error.message}`;
          sourceStatus = 'in_progress';
        }
        const outcome = sourceStatus === 'completed'
          ? await _backupAndDeleteLegacyFile(provider, adapter, source, sourceState, stepResult.legacyArtifact, nowText, persistLedger)
          : { ok: false, detail: sourceState.last_error };
        if (!outcome.ok) {
          sourceStatus = 'in_progress';
          sourceState.last_error = outcome.detail;
        } else {
          sourceState.legacy_deleted_at = nowText;
          delete sourceState.last_error;
        }
      }
      sourceState.last_checked_at = nowText;
      summary.sources[source.key] = { status: sourceStatus, ...stepResult };
      if (sourceStatus === 'in_progress') summary.status = 'in_progress';
    }

    ledgerPayload.last_checked_at = nowText;
    ledgerPayload.migration_completed_at = summary.status === 'completed' ? nowText : (ledgerPayload.migration_completed_at || null);
    try {
      await persistLedger();
    } catch (error) {
      summary.status = 'in_progress';
      summary.ledger_error = String((error && error.message) || error);
      ledgerPayload.migration_completed_at = null;
    }

    return summary;
  };

  function _sourceDefinition(sourceKey) {
    return [...CLOUD_MULTI_DOCUMENT_SOURCES, ...CLOUD_SINGLE_DOCUMENT_SOURCES]
      .find(source => source.key === sourceKey) || null;
  }

  NS.restoreCloudSidecarMigrationBackup = async function (provider, backupDocumentId, options) {
    const adapter = await _managementAdapterForProvider(provider);
    const contract = _contract();
    if (!adapter || !contract) return { status: 'error', detail: '管理領域アダプターを解決できませんでした' };
    const backup = await adapter.load(contract.SystemStorageKind.MIGRATION_BACKUPS, backupDocumentId).catch(() => null);
    if (!backup || !backup.payload) return { status: 'error', detail: 'バックアップが見つかりません' };
    const payload = backup.payload;
    const backedUpMs = Date.parse(payload.backed_up_at || '');
    const nowMs = options && Number.isFinite(options.nowMs) ? options.nowMs : Date.now();
    if (!Number.isFinite(backedUpMs)) return { status: 'error', detail: 'バックアップ日時が不正です' };
    if (nowMs - backedUpMs > 30 * 24 * 60 * 60 * 1000) return { status: 'expired', detail: '30日の復元期限を過ぎています' };
    const source = _sourceDefinition(payload.source_kind);
    if (!source) return { status: 'error', detail: '未知のバックアップ種別です' };
    const kind = contract.SystemStorageKind[source.kindName];
    const artifacts = [];
    try {
      if (payload.legacy_snapshot) {
        for (const [name, item] of Object.entries(payload.legacy_snapshot)) {
          const record = JSON.parse(item.raw_text);
          const rawHash = await _sha256Text(item.raw_text);
          const normalizedHash = await _sha256Text(_canonicalJson(record));
          if (rawHash !== item.integrity.raw_bytes_sha256 || normalizedHash !== item.integrity.normalized_json_sha256) {
            throw new Error(`${name} のhashが一致しません`);
          }
          artifacts.push({ docId: name.slice(0, -5), record });
        }
      } else {
        const record = JSON.parse(payload.legacy_raw_text);
        const rawHash = await _sha256Text(payload.legacy_raw_text);
        const normalizedHash = await _sha256Text(_canonicalJson(record));
        if (rawHash !== payload.source_snapshot.raw_bytes_sha256 || normalizedHash !== payload.source_snapshot.normalized_json_sha256) {
          throw new Error('バックアップのhashが一致しません');
        }
        artifacts.push({ docId: source.documentId, record });
      }
    } catch (error) {
      return { status: 'error', detail: `バックアップ検証に失敗しました: ${error && error.message}` };
    }

    const restored = [];
    const idempotent = [];
    const conflicts = [];
    for (const artifact of artifacts) {
      try {
        const existing = await adapter.load(kind, artifact.docId);
        if (existing) {
          if (_recordsMatch(existing.payload, artifact.record)) idempotent.push(artifact.docId);
          else conflicts.push(artifact.docId);
          continue;
        }
        const saved = await adapter.save(kind, artifact.docId, artifact.record, { expectedRevision: null });
        const reloaded = await adapter.load(kind, artifact.docId);
        if (!reloaded || !_recordsMatch(reloaded.payload, artifact.record)) throw new Error('復元後の内容照合に失敗しました');
        if (saved && saved.revision && reloaded.revision && saved.revision !== reloaded.revision) {
          throw new Error('復元後のrevision照合に失敗しました');
        }
        restored.push(artifact.docId);
      } catch (error) {
        const raced = await adapter.load(kind, artifact.docId).catch(() => null);
        if (raced && !_recordsMatch(raced.payload, artifact.record)) conflicts.push(artifact.docId);
        else return { status: 'error', detail: `${artifact.docId} の復元に失敗しました: ${error && error.message}` };
      }
    }
    return {
      status: conflicts.length ? 'conflict' : 'completed',
      restored, idempotent, conflicts,
    };
  };

  NS.getCompatibilityLock = async function (provider) {
    const adapter = await _managementAdapterForProvider(provider);
    if (!adapter) return { locked: true, unavailable: true, reason: 'management_adapter_unavailable' };
    let record;
    try {
      record = await adapter.load(_contract().SystemStorageKind.MIGRATION_LEDGER, CLOUD_LEDGER_DOC_ID);
    } catch (error) {
      return {
        locked: true,
        unavailable: true,
        reason: 'compatibility_lock_unreadable',
        detail: String((error && error.message) || error),
      };
    }
    return (record && record.payload && record.payload.compatibility_lock)
      ? { ...record.payload.compatibility_lock } : { locked: false };
  };

  NS.clearCompatibilityLockAfterOwnerRemigration = async function (provider, options) {
    if (!options || options.isOwner !== true || options.remigrationSucceeded !== true) {
      return { status: 'denied', detail: 'ownerによる再移行成功後のみ解除できます' };
    }
    const adapter = await _managementAdapterForProvider(provider);
    if (!adapter) return { status: 'error', detail: '管理領域アダプターを解決できませんでした' };
    const record = await adapter.load(_contract().SystemStorageKind.MIGRATION_LEDGER, CLOUD_LEDGER_DOC_ID);
    const payload = record && record.payload ? { ...record.payload } : {};
    payload.compatibility_lock = {
      ...(payload.compatibility_lock || {}),
      locked: false,
      unlocked_at: _nowText(),
      unlock_reason: 'owner_remigration_succeeded',
    };
    try { await _persistCloudLedger(adapter, payload); } catch (error) {
      return { status: 'error', detail: `compatibility lockを解除できません: ${error && error.message}` };
    }
    return { status: 'completed', compatibilityLock: payload.compatibility_lock };
  };

  // --- 旧クライアント検知(計画書§6.3最終項) --------------------------------------
  //
  // 完全な読取専用化は影響が大きすぎるため、検出+警告表示+旧パス再読込という
  // 縮退運用にする(Part 1指示どおり)。移行完了(migration_completed_at記録済み)
  // にも関わらず、旧パスへ新しいファイルが存在する場合、旧バージョンのMeldexが
  // 同じ共有ワークスペースへ接続していると推定し、呼び出し元へ通知する。
  // 通知を受け取った側は、警告表示に加えて旧パスの内容も再読込することを推奨する
  // (旧クライアントが書いた新しいデータを見逃さないため)。
  NS.detectLegacyClientActivity = async function (provider) {
    const internals = _internals();
    const contract = _contract();
    if (!internals || !contract || !provider) {
      return {
        detected: true,
        unavailable: true,
        compatibilityLock: { locked: true, unavailable: true, reason: 'legacy_detection_unavailable' },
      };
    }
    const adapter = await _managementAdapterForProvider(provider);
    if (!adapter) {
      return {
        detected: true,
        unavailable: true,
        compatibilityLock: { locked: true, unavailable: true, reason: 'management_adapter_unavailable' },
      };
    }
    let ledgerRecord = null;
    try {
      ledgerRecord = await adapter.load(contract.SystemStorageKind.MIGRATION_LEDGER, CLOUD_LEDGER_DOC_ID);
    } catch (error) {
      return {
        detected: true,
        unavailable: true,
        compatibilityLock: {
          locked: true,
          unavailable: true,
          reason: 'migration_ledger_unreadable',
          detail: String((error && error.message) || error),
        },
      };
    }
    const payload = ledgerRecord && ledgerRecord.payload;
    if (!payload || !payload.migration_completed_at) return { detected: false };

    const staleSources = [];
    const detectionErrors = [];
    for (const source of CLOUD_MULTI_DOCUMENT_SOURCES) {
      let entries = [];
      try {
        entries = await internals._listDirectoryEntries(provider, source.legacyDir);
      } catch (error) {
        if (/フォルダが見つかりません|path[_ ]?not[_ ]?found|not found/i.test(String((error && error.message) || error))) continue;
        detectionErrors.push(`${source.key}: ${String((error && error.message) || error)}`);
        continue;
      }
      const jsonNames = entries
        .filter(entry => entry && entry.handle && entry.handle.kind === 'file' && /\.json$/i.test(entry.name || ''))
        .map(entry => entry.name);
      if (jsonNames.length) staleSources.push(source.key);
    }
    for (const source of CLOUD_SINGLE_DOCUMENT_SOURCES) {
      try {
        if (await internals._pathExists(provider, source.legacyPath)) staleSources.push(source.key);
      } catch (error) {
        detectionErrors.push(`${source.key}: ${String((error && error.message) || error)}`);
      }
    }
    if (!staleSources.length && !detectionErrors.length) return { detected: false };
    payload.compatibility_lock = {
      locked: true,
      unavailable: detectionErrors.length > 0,
      reason: detectionErrors.length ? 'legacy_detection_unavailable' : 'legacy_client_regenerated_sidecars',
      stale_sources: [...new Set(staleSources)].sort(),
      detection_errors: detectionErrors,
      locked_at: _nowText(),
    };
    try {
      await _persistCloudLedger(adapter, payload);
    } catch (error) {
      return {
        detected: true, staleSources, compatibilityLock: { locked: true, persistence_failed: true },
        detail: `compatibility lockの永続化に失敗しました: ${error && error.message}`,
      };
    }
    return {
      detected: true,
      staleSources,
      compatibilityLock: payload.compatibility_lock,
      message: '旧バージョンのMeldexが同じ共有フォルダへ接続している可能性があります。全員が最新版に更新するまで、この画面の内容が最新でない場合があります。',
    };
  };
})();
