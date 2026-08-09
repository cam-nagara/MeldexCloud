/* board-standalone-annotations.js
 * 単独ボードアプリ(ブラウザローカル / File System Access API モード)向け、
 * 注釈の管理領域(IndexedDB)アクセス層。
 *
 * 固有形式付随物廃止・管理データ一元化計画 Phase 3。
 * 計画書: app/docs/proprietary-format-sidecar-cleanup-plan-2026-07-31.md §5.1
 * 監査ノート: app/docs/proprietary-format-sidecar-cleanup-audit-2026-08-01/notes.md §3.1
 *
 * board-standalone-fs.js は従来、注釈をルート単位で1つの
 * `_meldex/board-annotations.json` にまとめて保存していた(注釈追加の瞬間に
 * `_meldex/` フォルダが新規作成される — 監査で確認済みの違反)。
 *
 * 本ファイルは、保存単位を「ルート全体」から「対象(targetPath)ごとに解決した
 * document_id」へ変更し、gb-system-storage-indexeddb.js(共通ストレージ層、
 * IndexedDB)経由で保存する。正規化(_normalizeAnnotationRecord等)は
 * board-standalone-fs.js 側の責務のまま。本ファイルは「生の行配列をどこに
 * 保存するか」だけを扱う薄いアクセス層。
 *
 * ## document_id の解決方法
 * - 対象が現行4形式なら、gb-document-identity.js の追加型メタデータと
 *   File System Access APIルートの永続IDをSHA-256で名前空間化する。書込が
 *   必要な操作でのみensureDocumentIdを呼び、未付与IDを対象へ書き戻す。
 *   旧fmt-IDレコードはroot別の新IDへ非破壊コピーする。
 * - それ以外の形式(画像等)は、File System Access APIルートの永続IDと
 *   正規化相対パスをSHA-256で名前空間化する。別OSフォルダに同じ相対パスが
 *   あっても注釈を共有しない。
 *
 * ## 旧ファイルからの非破壊移行
 * 現在ルートの新領域に対象レコードがまだ無い時だけ、旧path-onlyレコードと
 * `_meldex/board-annotations.json` からID重複を除いてコピーする。旧データは
 * 削除・更新しない。新領域の空配列も権威として扱い、削除IDはroot別台帳へ
 * tombstoneを残すため、再実行で旧行が復活しない。
 *
 * ## target_path が分からない操作(ID単独のPUT/DELETE)
 * 既存フロントエンドは、注釈の更新・削除をIDだけで呼ぶ。
 * findTargetForAnnotationId は、現在選択中ルートのroot_namespaceを持つ
 * annotationsドキュメントだけを走査し、別フォルダの同IDへ触れない。
 *
 * ## 同じdocument_idの独立コピー検出(計画書§4.3、フェーズB徹底チェック起票分)
 *
 * バイトコピー(Explorerコピー・Dropbox競合コピー等)では、埋め込み済みの
 * document_idもそのまま複製される。書込が必要になった時点(allowWrite=true)
 * でだけ、ANNOTATIONSレコードのpayloadへ known_path(このdocument_idを最後に
 * 確認した対象の相対パス)を書き添え、次回書込時に食い違いを検出する。
 * 既知パスと現在パスが食い違い、かつ既知パス側のファイルが実在する場合は
 * 「独立コピー」と判定し、現在ファイルへ regenerateDocumentId で新しいIDを
 * 発行して分岐する(監査記録はCustomEvent 'meldex:system-storage-audit' で
 * broadcastする)。既知パス側が実在しない場合は「移動」とみなしIDを維持する。
 * 読込専用(allowWrite=false)経路はこの判定を行わない。
 *
 * ## TOCTOU対策(移行処理とのrevision競合)
 *
 * writeRawRowsForTarget は保存のたびに新領域の現在revisionを読み、
 * expectedRevisionを指定して保存する。migrateLegacyStore(移行処理)との
 * 同時書込でrevision競合(SystemStorageConflictError)を検出した場合、
 * ライブ書込側は「読取時→希望状態」の注釈ID単位差分を最新値へ再適用する。
 * 同じIDの同時更新だけは明示競合として止め、無関係な同時追加は保持する。
 */
(function () {
  'use strict';

  const NS = (window.BoardStandaloneAnnotations = window.BoardStandaloneAnnotations || {});
  const LEGACY_STORE_PATH = '_meldex/board-annotations.json';

  function _adapter() {
    const factory = window.MeldexSystemStorageIndexedDB;
    if (!factory || typeof factory.createLocalBrowserAdapter !== 'function') return null;
    return factory.createLocalBrowserAdapter({ boundary: 'browser-local' });
  }

  function _pathKey(value) {
    return String(value || '').replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+/g, '/');
  }

  const _readSnapshots = new Map();

  function _legacyPathDocumentId(targetPath) {
    const normalized = _pathKey(targetPath);
    let hash = 0x811c9dc5;
    for (let i = 0; i < normalized.length; i += 1) {
      hash ^= normalized.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return 'path-' + hash.toString(16).padStart(8, '0');
  }

  async function _sha256(value) {
    if (!globalThis.crypto?.subtle) {
      throw new Error('このブラウザでは安全な注釈ID(SHA-256)を生成できません');
    }
    const bytes = new TextEncoder().encode(String(value || ''));
    const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  }

  async function _rootNamespace() {
    const fs = window.BoardStandaloneFS;
    if (!fs || typeof fs.getRootIdentity !== 'function') {
      throw new Error('注釈の保存先ルートを識別できません');
    }
    return _sha256('meldex-board-root-v1\0' + await fs.getRootIdentity());
  }

  async function _stablePathDocumentId(targetPath, rootNamespace) {
    const digest = await _sha256(
      'meldex-board-annotation-path-v2\0' + String(rootNamespace || '') + '\0' + _pathKey(targetPath),
    );
    return 'path2-' + digest;
  }

  async function _stableFormatDocumentId(documentId, rootNamespace) {
    const digest = await _sha256(
      'meldex-board-annotation-format-v2\0'
      + String(rootNamespace || '') + '\0' + String(documentId || ''),
    );
    return 'fmt2-' + digest;
  }

  function _rows(value) {
    return Array.isArray(value)
      ? value.filter(row => row && typeof row === 'object')
      : [];
  }

  function _dedupeRows(value) {
    const byId = new Map();
    _rows(value).forEach((row) => {
      const id = String(row.id || '');
      if (!id || byId.has(id)) return;
      byId.set(id, row);
    });
    return Array.from(byId.values());
  }

  function _rowEqual(left, right) {
    return JSON.stringify(left) === JSON.stringify(right);
  }

  function _cloneRows(value) {
    const rows = _dedupeRows(value);
    if (typeof structuredClone === 'function') return structuredClone(rows);
    return JSON.parse(JSON.stringify(rows));
  }

  // 書込直前に、同じdocument_idを持つ独立コピーが既に存在しないか確認する。
  // 計画書§4.3「同じIDの独立コピーを検出した場合は、ユーザー作業を止めずに
  // 新IDへ分岐し、監査記録を残す」の実装(フェーズB徹底チェックで実証された
  // バグの修正)。既知パス(この docId のANNOTATIONSレコードへ前回保存した
  // 相対パス、known_path)と現在の対象パスが食い違い、かつ既知パス側に
  // ファイルが実在する場合だけ「独立コピー」と判定し、現在ファイルへ新しい
  // document_id を発行して分岐する(元ファイル側には一切触れない)。既知パス
  // 側が実在しない場合は「移動(リネーム含む)」であり、IDは維持する
  // (known_path自体の更新は後続の書込に委ねる)。
  async function _branchDocumentIdIfDuplicateCopy(
    rel, fmt, text, docId, rootNamespace, writeFileText, fileExists,
  ) {
    const adapter = _adapter();
    if (!adapter) return docId; // 管理領域が使えない環境では検出をスキップ
    const contract = window.MeldexSystemStorage;
    let record = null;
    try {
      record = await adapter.load(contract.SystemStorageKind.ANNOTATIONS, docId);
    } catch { record = null; }
    const rawKnownPath = record && record.payload ? record.payload.known_path : null;
    const knownPath = (typeof rawKnownPath === 'string' && rawKnownPath) ? rawKnownPath : null;
    if (!knownPath || knownPath === rel) return docId;

    let knownFileExists = false;
    if (typeof fileExists === 'function') {
      try { knownFileExists = await fileExists(knownPath); } catch { knownFileExists = false; }
    }
    if (!knownFileExists) {
      // 既知パス側は既に存在しない(移動/リネーム)。IDは維持する。
      return docId;
    }

    // 既知パス側にファイルが実在する = 同じIDを共有する独立コピー。
    // 現在ファイルへ新しいIDを発行して分岐する。
    const identity = window.MeldexDocumentIdentity;
    const result = identity.regenerateDocumentId(text, fmt);
    if (!result.changed || !result.documentId) return docId;
    try {
      await writeFileText(rel, result.text);
    } catch {
      return docId;
    }
    const newDocId = await _stableFormatDocumentId(result.documentId, rootNamespace);
    contract.recordStorageAuditEvent(null, {
      level: 'warning',
      operation: 'duplicate_document_id_branched',
      kind: contract.SystemStorageKind.ANNOTATIONS,
      documentId: docId,
      environment: 'browser-local-indexeddb',
      message: '同じ文書IDを持つ独立コピーを検出したため、新しい文書IDへ分岐しました',
      detail: { known_path: knownPath, current_path: rel, new_document_id: newDocId },
    });
    return newDocId;
  }

  async function _documentIdForTarget(targetPath, allowWrite, readFileAsText, writeFileText, fileExists, rootNamespace) {
    const rel = _pathKey(targetPath);
    const identity = window.MeldexDocumentIdentity;
    const fmt = identity ? identity.formatForPath(rel) : null;
    if (fmt && rel) {
      let text = null;
      try { text = await readFileAsText(rel); } catch { text = null; }
      if (text !== null) {
        if (allowWrite) {
          const result = identity.ensureDocumentId(text, fmt);
          if (result.changed) {
            try { await writeFileText(rel, result.text); text = result.text; } catch { /* 書込失敗時はハッシュへフォールバック */ }
          }
          if (result.documentId) {
            const docId = await _stableFormatDocumentId(result.documentId, rootNamespace);
            const branched = await _branchDocumentIdIfDuplicateCopy(
              rel, fmt, text, docId, rootNamespace, writeFileText, fileExists,
            );
            return {
              docId: branched,
              legacyDocId: branched === docId ? 'fmt-' + result.documentId : '',
            };
          }
        } else {
          const existing = identity.readDocumentId(text, fmt);
          if (existing) {
            return {
              docId: await _stableFormatDocumentId(existing, rootNamespace),
              legacyDocId: 'fmt-' + existing,
            };
          }
        }
      }
    }
    return {
      docId: await _stablePathDocumentId(rel, rootNamespace),
      legacyDocId: _legacyPathDocumentId(rel),
    };
  }

  async function _readLegacyRows(readFileAsText) {
    try {
      const text = await readFileAsText(LEGACY_STORE_PATH);
      const payload = JSON.parse(text || '{}');
      const rows = Array.isArray(payload) ? payload : payload.annotations;
      return Array.isArray(rows) ? rows.filter(row => row && typeof row === 'object') : [];
    } catch {
      return [];
    }
  }

  async function _legacyRowsForTarget(targetPath, readFileAsText) {
    const key = _pathKey(targetPath);
    const rows = await _readLegacyRows(readFileAsText);
    return rows.filter(row => _pathKey(row.target_path || row.target || '') === key);
  }

  function _migrationMetadata(payload) {
    const source = payload?.migration && typeof payload.migration === 'object' ? payload.migration : {};
    const sidecar = source.legacy_sidecar && typeof source.legacy_sidecar === 'object'
      ? source.legacy_sidecar
      : {};
    return {
      ...source,
      legacy_sidecar: {
        ...sidecar,
        imported_ids: Array.from(new Set((sidecar.imported_ids || []).map(String))),
        deleted_ids: Array.from(new Set((sidecar.deleted_ids || []).map(String))),
      },
    };
  }

  function _payloadForRoot(targetPath, rootNamespace, rows, previousPayload, migration) {
    return {
      ...(previousPayload || {}),
      annotations: _dedupeRows(rows),
      known_path: _pathKey(targetPath),
      root_namespace: rootNamespace,
      migration: migration || _migrationMetadata(previousPayload),
    };
  }

  async function _loadTargetRecord(targetPath, options) {
    const adapter = _adapter();
    if (!adapter) return { adapter: null, docId: '', rootNamespace: '', record: null };
    const rootNamespace = await _rootNamespace();
    const identity = await _documentIdForTarget(
      targetPath,
      !!options.allowWrite,
      options.readFileAsText,
      options.writeFileText,
      options.fileExists,
      rootNamespace,
    );
    const docId = identity.docId;
    const contract = window.MeldexSystemStorage;
    let record = null;
    try { record = await adapter.load(contract.SystemStorageKind.ANNOTATIONS, docId); } catch { record = null; }
    if (record) {
      if (record.payload?.root_namespace !== rootNamespace) {
        throw new contract.SystemStorageConflictError({
          kind: contract.SystemStorageKind.ANNOTATIONS,
          documentId: docId,
          currentRevision: record.revision,
          message: '別の保存先ルートに属する注釈レコードを検出したため、読込を停止しました',
        });
      }
      return { adapter, docId, rootNamespace, record };
    }

    const targetKey = _pathKey(targetPath);
    let migratedRows = [];
    let migration = _migrationMetadata(null);
    if (identity.legacyDocId) {
      const legacyDocId = identity.legacyDocId;
      let legacyRecord = null;
      try { legacyRecord = await adapter.load(contract.SystemStorageKind.ANNOTATIONS, legacyDocId); } catch { legacyRecord = null; }
      const legacyKnownPath = _pathKey(legacyRecord?.payload?.known_path || '');
      const legacyRootNamespace = String(legacyRecord?.payload?.root_namespace || '');
      const rootMatches = !legacyRootNamespace || legacyRootNamespace === rootNamespace;
      if (legacyRecord && rootMatches && (!legacyKnownPath || legacyKnownPath === targetKey)) {
        migratedRows = _dedupeRows(legacyRecord.payload?.annotations);
        const migrationKey = legacyDocId.startsWith('fmt-') ? 'format_v1' : 'path_v1';
        migration[migrationKey] = {
          source_document_id: legacyDocId,
          ambiguous: !legacyRootNamespace,
          copied_at: new Date().toISOString(),
        };
      }
    }

    const sidecarRows = await _legacyRowsForTarget(targetKey, options.readFileAsText);
    const deletedIds = new Set(migration.legacy_sidecar.deleted_ids);
    const importable = _dedupeRows(sidecarRows).filter(row => !deletedIds.has(String(row.id || '')));
    if (importable.length) {
      migratedRows = _dedupeRows([...migratedRows, ...importable]);
      migration.legacy_sidecar = {
        ...migration.legacy_sidecar,
        imported_ids: Array.from(new Set([
          ...migration.legacy_sidecar.imported_ids,
          ...importable.map(row => String(row.id || '')).filter(Boolean),
        ])),
        copied_at: new Date().toISOString(),
      };
    }

    const initialPayload = _payloadForRoot(targetKey, rootNamespace, migratedRows, null, migration);
    // 読取時にも空レコードを確立する。以後は空配列自体が権威となり、
    // 削除済みの旧sidecar行をフォールバックで復活させない。
    try {
      await adapter.save(
        contract.SystemStorageKind.ANNOTATIONS,
        docId,
        initialPayload,
        { expectedRevision: null },
      );
    } catch (error) {
      if (!(error instanceof contract.SystemStorageConflictError)) throw error;
    }
    try { record = await adapter.load(contract.SystemStorageKind.ANNOTATIONS, docId); } catch { record = null; }
    if (record && record.payload?.root_namespace !== rootNamespace) {
      throw new contract.SystemStorageConflictError({
        kind: contract.SystemStorageKind.ANNOTATIONS,
        documentId: docId,
        currentRevision: record.revision,
        message: '注釈レコードの保存先ルートが一致しません',
      });
    }
    return { adapter, docId, rootNamespace, record };
  }

  // 対象1件分の生の注釈行(未正規化)を読む。読込専用
  // (document_idの新規付与はしない。新領域に無ければ旧ファイルから読取専用フォールバック)。
  NS.readRawRowsForTarget = async function (targetPath, { readFileAsText }) {
    const resolved = await _loadTargetRecord(targetPath, { readFileAsText, allowWrite: false });
    if (!resolved.adapter || !resolved.record) return _legacyRowsForTarget(targetPath, readFileAsText);
    const rows = _dedupeRows(resolved.record.payload?.annotations);
    _readSnapshots.set(resolved.docId, {
      rows: _cloneRows(rows),
      revision: resolved.record.revision,
      payload: resolved.record.payload,
      rootNamespace: resolved.rootNamespace,
    });
    return rows;
  };

  // ライブ書込がANNOTATIONS種別のrevision競合(移行処理との同時書込)に遭遇した
  // 際、何度まで「現在値を読み直して再試行」するかの上限(計画書§4.3の
  // TOCTOU対策)。ユーザー操作を無期限にブロックしないよう小さい回数に留め、
  // それでも解消しない場合は競合を明示し、古い内容で上書きしない。
  const WRITE_CONFLICT_MAX_RETRIES = 5;

  function _operationDelta(baseRows, desiredRows) {
    const base = new Map(_dedupeRows(baseRows).map(row => [String(row.id || ''), row]));
    const desired = new Map(_dedupeRows(desiredRows).map(row => [String(row.id || ''), row]));
    const operations = [];
    base.forEach((row, id) => {
      if (!desired.has(id)) operations.push({ type: 'delete', id, base: row });
      else if (!_rowEqual(row, desired.get(id))) {
        operations.push({ type: 'update', id, base: row, desired: desired.get(id) });
      }
    });
    desired.forEach((row, id) => {
      if (!base.has(id)) operations.push({ type: 'add', id, desired: row });
    });
    return operations;
  }

  function _applyOperationDelta(latestRows, operations, contract, docId, latestRevision) {
    const latest = new Map(_dedupeRows(latestRows).map(row => [String(row.id || ''), row]));
    for (const operation of operations) {
      const current = latest.get(operation.id);
      if (operation.type === 'add') {
        if (!current) latest.set(operation.id, operation.desired);
        else if (!_rowEqual(current, operation.desired)) {
          throw new contract.SystemStorageConflictError({
            kind: contract.SystemStorageKind.ANNOTATIONS,
            documentId: docId,
            currentRevision: latestRevision,
            message: '同じ注釈IDが別内容で追加されたため、自動統合できません',
          });
        }
      } else if (operation.type === 'update') {
        if (_rowEqual(current, operation.desired)) continue;
        if (!_rowEqual(current, operation.base)) {
          throw new contract.SystemStorageConflictError({
            kind: contract.SystemStorageKind.ANNOTATIONS,
            documentId: docId,
            currentRevision: latestRevision,
            message: '同じ注釈が同時に更新されたため、自動統合できません',
          });
        }
        latest.set(operation.id, operation.desired);
      } else if (operation.type === 'delete') {
        if (!current) continue;
        if (!_rowEqual(current, operation.base)) {
          throw new contract.SystemStorageConflictError({
            kind: contract.SystemStorageKind.ANNOTATIONS,
            documentId: docId,
            currentRevision: latestRevision,
            message: '更新済みの注釈を削除せず、競合として保留しました',
          });
        }
        latest.delete(operation.id);
      }
    }
    return Array.from(latest.values());
  }

  function _migrationAfterOperations(payload, operations) {
    const migration = _migrationMetadata(payload);
    const imported = new Set(migration.legacy_sidecar.imported_ids);
    const deleted = new Set(migration.legacy_sidecar.deleted_ids);
    operations.forEach((operation) => {
      if (operation.type === 'delete' && imported.has(operation.id)) deleted.add(operation.id);
      if (operation.type === 'add') deleted.delete(operation.id);
    });
    migration.legacy_sidecar.deleted_ids = Array.from(deleted);
    return migration;
  }

  // 呼出元が読んだbase→希望rowsの注釈ID単位差分だけを、競合時の最新rowsへ
  // 再適用する。無関係な同時追加は保持し、同じIDの同時更新だけを明示競合にする。
  NS.writeRawRowsForTarget = async function (
    targetPath,
    rows,
    { readFileAsText, writeFileText, fileExists, baseRows },
  ) {
    const resolved = await _loadTargetRecord(targetPath, {
      readFileAsText, writeFileText, fileExists, allowWrite: true,
    });
    const adapter = resolved.adapter;
    const docId = resolved.docId;
    if (!adapter || !resolved.record) throw new Error('この端末では注釈の保存(管理データストア)を利用できません');
    const contract = window.MeldexSystemStorage;
    const cachedSnapshot = _readSnapshots.get(docId);
    const snapshot = Array.isArray(baseRows) ? {
      rows: _cloneRows(baseRows),
      revision: cachedSnapshot?.revision || resolved.record.revision,
      payload: cachedSnapshot?.payload || resolved.record.payload,
    } : cachedSnapshot || {
      rows: _dedupeRows(resolved.record.payload?.annotations),
      revision: resolved.record.revision,
      payload: resolved.record.payload,
    };
    const operations = _operationDelta(snapshot.rows, rows);

    let attempt = 0;
    for (;;) {
      let existing = null;
      try { existing = await adapter.load(contract.SystemStorageKind.ANNOTATIONS, docId); } catch { existing = null; }
      if (!existing) throw new Error('注釈の保存レコードが見つかりません');
      const mergedRows = _applyOperationDelta(
        existing.payload?.annotations,
        operations,
        contract,
        docId,
        existing.revision,
      );
      const payload = _payloadForRoot(
        targetPath,
        resolved.rootNamespace,
        mergedRows,
        existing.payload,
        _migrationAfterOperations(existing.payload, operations),
      );
      try {
        await adapter.save(
          contract.SystemStorageKind.ANNOTATIONS,
          docId,
          payload,
          { expectedRevision: existing.revision },
        );
        const saved = await adapter.load(contract.SystemStorageKind.ANNOTATIONS, docId);
        _readSnapshots.set(docId, {
          rows: _cloneRows(saved?.payload?.annotations),
          revision: saved?.revision,
          payload: saved?.payload,
          rootNamespace: resolved.rootNamespace,
        });
        return _dedupeRows(saved?.payload?.annotations);
      } catch (error) {
        if (!(error instanceof contract.SystemStorageConflictError)) throw error;
        attempt += 1;
        if (attempt >= WRITE_CONFLICT_MAX_RETRIES) throw error;
      }
    }
  };

  // target_pathを伴わないPUT/DELETE(IDのみ)から対象を逆引きする。
  NS.findTargetForAnnotationId = async function (annId, { readFileAsText }) {
    if (!annId) return null;
    const adapter = _adapter();
    if (adapter) {
      const contract = window.MeldexSystemStorage;
      const rootNamespace = await _rootNamespace();
      const records = await adapter.listDocuments(contract.SystemStorageKind.ANNOTATIONS);
      for (const record of records) {
        if (record.payload?.root_namespace !== rootNamespace) continue;
        const rows = record.payload ? record.payload.annotations : null;
        if (!Array.isArray(rows)) continue;
        const match = rows.find(row => row && String(row.id || '') === annId);
        if (match) return String(match.target_path || '');
      }
    }
    const legacyRows = await _readLegacyRows(readFileAsText);
    const match = legacyRows.find(row => String(row.id || '') === annId);
    return match ? String(match.target_path || match.target || '') : null;
  };

  NS.LEGACY_STORE_PATH = LEGACY_STORE_PATH;

  // --- 移行(固有形式付随物廃止・管理データ一元化計画 Phase 5) -------------------
  //
  // 旧 `_meldex/board-annotations.json` をtarget_pathごとに新領域(IndexedDB)へ
  // コピーする。ファイル本体の削除・30日バックアップ・台帳記録・空フォルダ清掃は
  // 呼び出し元(gb-sidecar-migration.js)の責務。ここは「内容を新領域へ安全に
  // 移すこと」だけを担当する(既存の read/write ヘルパーと同じ薄いアクセス層)。
  NS.migrateLegacyStore = async function ({ readFileAsText, writeFileText, fileExists }) {
    let rawText;
    try {
      rawText = await readFileAsText(LEGACY_STORE_PATH);
    } catch {
      return { status: 'no_legacy_data' };
    }
    if (rawText == null) return { status: 'no_legacy_data' };

    let payload;
    try {
      payload = JSON.parse(rawText || '{}');
    } catch {
      return { status: 'error', detail: '旧付随物のJSONが破損しているため移行を保留しました' };
    }
    const rows = Array.isArray(payload) ? payload : (payload && typeof payload === 'object' ? payload.annotations : null);
    if (!Array.isArray(rows)) {
      return { status: 'error', detail: '旧付随物がMeldexの既知フォーマット(annotations配列)ではないため移行を保留しました' };
    }

    const adapter = _adapter();
    if (!adapter) return { status: 'error', detail: 'この端末では管理データストア(IndexedDB)を利用できません' };
    const contract = window.MeldexSystemStorage;

    const grouped = new Map();
    (rows.filter(row => row && typeof row === 'object')).forEach((row) => {
      const target = _pathKey(row.target_path || row.target || '');
      if (!grouped.has(target)) grouped.set(target, []);
      grouped.get(target).push(row);
    });

    let migratedCount = 0;
    const targetErrors = {};
    for (const [targetPath, targetRows] of grouped) {
      try {
        const resolved = await _loadTargetRecord(targetPath, {
          readFileAsText, writeFileText, fileExists, allowWrite: true,
        });
        let attempt = 0;
        for (;;) {
          const existing = await adapter.load(contract.SystemStorageKind.ANNOTATIONS, resolved.docId);
          const migration = _migrationMetadata(existing?.payload);
          const deletedIds = new Set(migration.legacy_sidecar.deleted_ids);
          const currentRows = _dedupeRows(existing?.payload?.annotations);
          const currentIds = new Set(currentRows.map(row => String(row.id || '')));
          const additions = _dedupeRows(targetRows).filter((row) => {
            const id = String(row.id || '');
            return id && !deletedIds.has(id) && !currentIds.has(id);
          });
          migration.legacy_sidecar = {
            ...migration.legacy_sidecar,
            imported_ids: Array.from(new Set([
              ...migration.legacy_sidecar.imported_ids,
              ..._dedupeRows(targetRows).map(row => String(row.id || '')).filter(Boolean),
            ])),
            copied_at: migration.legacy_sidecar.copied_at || new Date().toISOString(),
          };
          const nextPayload = _payloadForRoot(
            targetPath,
            resolved.rootNamespace,
            [...currentRows, ...additions],
            existing?.payload,
            migration,
          );
          try {
            await adapter.save(
              contract.SystemStorageKind.ANNOTATIONS,
              resolved.docId,
              nextPayload,
              { expectedRevision: existing?.revision || null },
            );
            break;
          } catch (error) {
            if (!(error instanceof contract.SystemStorageConflictError)) throw error;
            attempt += 1;
            if (attempt >= WRITE_CONFLICT_MAX_RETRIES) throw error;
          }
        }
        migratedCount += 1;
      } catch (error) {
        targetErrors[targetPath] = String((error && error.message) || error);
      }
    }

    if (Object.keys(targetErrors).length) {
      return {
        status: 'in_progress',
        targetsTotal: grouped.size,
        targetsMigrated: migratedCount,
        targetErrors,
        legacyContent: rawText,
      };
    }
    return {
      status: 'completed',
      targetsTotal: grouped.size,
      targetsMigrated: migratedCount,
      legacyContent: rawText,
    };
  };
})();
