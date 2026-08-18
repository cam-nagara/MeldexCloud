/* gb-system-storage-dropbox.js
 *
 * Dropbox個人領域/共有ワークスペース向け管理領域アダプター(ブラウザ側。
 * 固有形式付随物廃止・管理データ一元化計画 Phase 1b)。
 *
 * 計画書: app/docs/proprietary-format-sidecar-cleanup-plan-2026-07-31.md (§4.1・§4.3)
 * 契約: gb-system-storage.js(window.MeldexSystemStorage)
 * 対応するPython側: meldex_system_storage_dropbox.py(サーバー経由。PC本体はDropbox
 * デスクトップアプリが同期済みのローカルフォルダをファイルシステム経由で読み書きする)
 *
 * ## 保存先
 *
 * - 個人: /MeldexSettings/system/v1 (Dropboxアカウントの home namespace 直下)
 * - 共有ワークスペース: <ワークスペース>/MeldexShare/system/v1
 *
 * Phase 1aと同じパス規約。ただし本モジュールは「ブラウザから直接Dropbox Web API
 * を呼ぶ」経路(Phase 0監査ノート§1.1 系統D)であり、Python版のような
 * 「ローカル同期フォルダ経由」ではない。
 *
 * ## 既存基盤の再利用(新しい認証経路を作らない)
 *
 * - HTTP呼び出し: window.MeldexDropboxAuth.apiRpc / apiContent
 *   (gb-dropbox-auth.js。トークン取得・401時のリフレッシュ・リトライは
 *   ここが担う。本モジュールは一切新しい認証コードを書かない)
 * - 個人領域の設定ルート: window.MeldexSourceFolderRegistry.getSettingsPath()
 *   (既定 `/MeldexSettings`。gb-source-folder-registry.js)
 * - 共有ワークスペースの共有フォルダ名: window.MeldexWorkspaceSharedLedger.WORKSPACE_SHARE_DIR
 *   (既定 `MeldexShare`。gb-workspace-shared-ledger.js)
 * - Dropboxパスの正規化・結合(normalizeDropboxPath 等)は
 *   gb-source-folder-registry.js の実装が非公開(モジュール内private関数)の
 *   ため呼び出せない。gb-workspace-ledger-io.js が同じ理由で採用している
 *   「既存ファイルへの依存を増やさないための複製」方針にならい、
 *   同じロジックをこのファイル内に複製する(gb-workspace-ledger-io.js 冒頭コメント参照)。
 *
 * ## revisionについて(重要)
 *
 * 真のDropbox rev(Web APIが発行する不透明文字列)をそのまま
 * expected_revision/revision として使う(meldex_system_storage_dropbox.py の
 * モジュールdocstringと同じ設計判断)。ただし「ファイルの中身に書き込む
 * revisionフィールド」と「実際にCAS判定へ使うrevision」は別の値になる
 * (鶏と卵の問題): Dropboxのrevはアップロードが成功して初めてサーバーから
 * 返るため、アップロードするJSON本文自身に「これからアップロードされる
 * rev」を事前に書き込むことはできない。そのため:
 *
 * - 書き込むJSON本文の meldex_system_storage.revision には
 *   「書込直前に確認した現在のrev(または空文字)」を参考情報として入れる。
 * - 実際のCAS判定・戻り値の revision は、常にDropbox APIのレスポンス
 *   メタデータ(get_metadata / upload / download の `.rev`)から取得し、
 *   JSON本文に書かれた値は信用しない。
 *
 * ## オフライン時の送信待ち
 *
 * save() 自体は契約どおり同期的に成功/失敗する(黙って保留にしない)。
 * オフライン時に自動で送信待ちへ回したい呼び出し元は saveWithOfflineQueue()
 * を使う。標準の standalone-offline-outbox.js は apiPost/apiPut 等の
 * グローバル関数を横取りする設計で、save()/load() という別形状のAPIを持つ
 * 本モジュールには噛み合わないため転用せず、localStorageベースの
 * 最小限の送信待ちキュー(上限リトライ回数あり。無制限リトライはしない)を
 * 実装する。
 */
(function () {
  'use strict';

  if (window.MeldexSystemStorageDropbox) return;

  const MANAGEMENT_SUBPATH = 'system/v1';
  const OUTBOX_KEY_PREFIX = 'meldex-system-storage-dropbox-outbox-v1';
  const MAX_OFFLINE_QUEUE_ATTEMPTS = 8;
  let _migrationWriteScopeDepth = 0;

  function _contract() {
    const contract = window.MeldexSystemStorage;
    if (!contract) throw new Error('gb-system-storage.js が読み込まれていません');
    return contract;
  }

  // --- Dropboxパス正規化・結合(gb-workspace-ledger-io.js と同じ方針で複製) ------

  function _normalizeDropboxPath(path) {
    const raw = String(path || '').trim().replace(/\\/g, '/').replace(/\/+/g, '/');
    if (raw === '/') return '/';
    const normalized = raw.replace(/\/$/, '');
    if (!normalized) return '';
    return normalized.startsWith('/') ? normalized : ('/' + normalized);
  }

  function _normalizeRelativePath(path) {
    return String(path || '')
      .trim()
      .replace(/\\/g, '/')
      .replace(/^\/+/, '')
      .replace(/\/+/g, '/')
      .replace(/^\.\//, '')
      .replace(/\/$/, '');
  }

  function _joinDropboxPath(base, relative) {
    const normalizedBase = _normalizeDropboxPath(base);
    const normalizedRelative = _normalizeRelativePath(relative);
    if (!normalizedRelative) return normalizedBase;
    return normalizedBase === '/' ? `/${normalizedRelative}` : `${normalizedBase}/${normalizedRelative}`;
  }

  function _normalizeNamespaceKind(value) {
    return value === 'team_root' ? 'team_root' : 'home';
  }

  // --- 保存先ルート解決 --------------------------------------------------------

  function personalManagementRoot() {
    const registry = window.MeldexSourceFolderRegistry;
    if (!registry || typeof registry.getSettingsPath !== 'function') {
      throw new (_contract().SystemStorageError)('gb-source-folder-registry.js が読み込まれていません');
    }
    return _joinDropboxPath(registry.getSettingsPath(), MANAGEMENT_SUBPATH);
  }

  function sharedWorkspaceManagementRoot(workspaceDropboxPath) {
    if (!workspaceDropboxPath) {
      throw new (_contract().SystemStorageError)('共有ワークスペースフォルダの位置が指定されていません');
    }
    const sharedLedger = window.MeldexWorkspaceSharedLedger;
    const shareDir = (sharedLedger && sharedLedger.WORKSPACE_SHARE_DIR) || 'MeldexShare';
    return _joinDropboxPath(workspaceDropboxPath, `${shareDir}/${MANAGEMENT_SUBPATH}`);
  }

  // --- Dropbox API呼び出し(既存の gb-dropbox-auth.js をそのまま使う) -----------

  async function _rpc(route, body, namespaceKind) {
    const auth = window.MeldexDropboxAuth;
    if (!auth || typeof auth.apiRpc !== 'function') {
      throw new (_contract().SystemStorageError)('Dropboxへ接続してください');
    }
    return auth.apiRpc(route, body, { namespaceKind: _normalizeNamespaceKind(namespaceKind) });
  }

  async function _content(route, arg, init, namespaceKind) {
    const auth = window.MeldexDropboxAuth;
    if (!auth || typeof auth.apiContent !== 'function') {
      throw new (_contract().SystemStorageError)('Dropboxへ接続してください');
    }
    return auth.apiContent(route, arg, init, { namespaceKind: _normalizeNamespaceKind(namespaceKind) });
  }

  // gb-storage-adapter.part01.js / gb-workspace-ledger-io.js と同じ正規表現による分類
  // (apiRpc/apiContent は Dropbox の error_summary テキストを message に持つ Error を投げる)。
  function _isNotFoundError(err) {
    return /not_found|path_lookup|path\/not_found/i.test((err && err.message) || '');
  }

  function _isConflictError(err) {
    return /conflict|too_many_write_operations|path\/conflict/i.test((err && err.message) || '');
  }

  const _RETRYABLE_ERROR_RE = /offline|network|failed to fetch|fetch failed|timeout|timed out|接続|認証|unauthori|access.?token/i;

  function _isRetryableOfflineError(error) {
    if (typeof navigator !== 'undefined' && navigator && navigator.onLine === false) return true;
    return _RETRYABLE_ERROR_RE.test(String((error && error.message) || error || ''));
  }

  async function _ensureFolder(dropboxPath, namespaceKind) {
    const normalized = _normalizeDropboxPath(dropboxPath);
    if (!normalized || normalized === '/') return true;
    try {
      await _rpc('files/create_folder_v2', { path: normalized, autorename: false }, namespaceKind);
      return true;
    } catch (err) {
      let meta = null;
      try {
        meta = await _rpc('files/get_metadata', {
          path: normalized, include_deleted: false, include_has_explicit_shared_members: false,
        }, namespaceKind);
      } catch { /* メタデータ取得も失敗した場合は直前の create_folder_v2 のエラーをそのまま投げる */ }
      if (meta && meta['.tag'] === 'folder') return true;
      if (meta) throw new (_contract().SystemStorageError)(`${normalized} はDropbox上でフォルダではありません`);
      throw err;
    }
  }

  async function _downloadEnvelope(fullPath, namespaceKind) {
    let response;
    try {
      response = await _content('files/download', { path: fullPath }, undefined, namespaceKind);
    } catch (err) {
      if (_isNotFoundError(err)) return null;
      throw err;
    }
    const text = await response.text();
    let rev = '';
    try {
      const metaText = (response.headers && response.headers.get && response.headers.get('dropbox-api-result')) || '';
      const meta = metaText ? JSON.parse(metaText) : null;
      rev = String((meta && meta.rev) || '');
    } catch { /* dropbox-api-result ヘッダーが無い/壊れている場合は rev 無しのまま扱う */ }
    let data;
    try {
      data = JSON.parse(text);
    } catch (err) {
      throw new (_contract().SystemStorageCorruptRecordError)(`管理データを読み込めません(${fullPath}): ${err && err.message}`);
    }
    return { data, rev };
  }

  // --- localStorageベースの最小限の送信待ちキュー ------------------------------

  function _outboxKey(boundary) {
    return `${OUTBOX_KEY_PREFIX}:${boundary}`;
  }

  function _readOutbox(boundary) {
    let raw;
    try {
      raw = localStorage.getItem(_outboxKey(boundary));
    } catch (error) {
      throw new (_contract().SystemStorageWriteError)(
        `送信待ちデータを読み込めません: ${error && error.message}`,
      );
    }
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) throw new Error('配列ではありません');
      return parsed;
    } catch (error) {
      throw new (_contract().SystemStorageCorruptRecordError)(
        `送信待ちデータが破損しています: ${error && error.message}`,
      );
    }
  }

  async function runMigrationWriteScope(callback) {
    if (typeof callback !== 'function') {
      throw new (_contract().SystemStorageError)('移行処理が指定されていません');
    }
    _migrationWriteScopeDepth += 1;
    try {
      return await callback();
    } finally {
      _migrationWriteScopeDepth = Math.max(0, _migrationWriteScopeDepth - 1);
    }
  }

  function _writeOutbox(boundary, rows) {
    const key = _outboxKey(boundary);
    let serialized;
    try {
      serialized = JSON.stringify(rows);
      localStorage.setItem(key, serialized);
      const reloaded = localStorage.getItem(key);
      if (reloaded !== serialized) {
        throw new Error('保存後の再読込内容が一致しません');
      }
      const parsed = JSON.parse(reloaded);
      if (!Array.isArray(parsed)) throw new Error('保存後の送信待ちデータが配列ではありません');
    } catch (error) {
      throw new (_contract().SystemStorageWriteError)(
        `送信待ちデータを永続化できません: ${error && error.message}`,
      );
    }
  }

  // --- アダプター本体 ----------------------------------------------------------

  class DropboxSystemStorageAdapter {
    constructor({ managementRoot, boundary, environment, namespaceKind, auditSink, compatibilityLockProvider } = {}) {
      if (!managementRoot) throw new (_contract().SystemStorageError)('管理領域のパスが指定されていません');
      this._managementRoot = _normalizeDropboxPath(managementRoot);
      this._boundary = String(boundary || 'dropbox');
      this._environment = String(environment || 'dropbox');
      this._namespaceKind = _normalizeNamespaceKind(namespaceKind);
      this._auditSink = typeof auditSink === 'function' ? auditSink : null;
      this._compatibilityLockProvider = compatibilityLockProvider || null;
    }

    get boundary() { return this._boundary; }
    get environment() { return this._environment; }
    get namespaceKind() { return this._namespaceKind; }

    _pathFor(kind, documentId) {
      return _joinDropboxPath(this._managementRoot, _contract().documentRelativePath(kind, documentId));
    }

    _folderFor(kind) {
      return _joinDropboxPath(this._managementRoot, _contract().kindSubpathSegment(kind));
    }

    async _assertCompatibilityWriteAllowed(kind) {
      if (this._environment !== 'dropbox-shared-workspace' || _migrationWriteScopeDepth > 0) return;
      const contract = _contract();
      if (kind === contract.SystemStorageKind.MIGRATION_LEDGER) return;
      const migration = window.MeldexSidecarMigration;
      const provider = this._compatibilityLockProvider || window.MeldexStorageAdapter?.getProvider?.();
      let lock;
      if (!migration || typeof migration.getCompatibilityLock !== 'function') {
        lock = { locked: true, unavailable: true };
      } else try {
        lock = provider ? await migration.getCompatibilityLock(provider) : { locked: true, unavailable: true };
      } catch (error) {
        lock = { locked: true, unavailable: true, detail: String((error && error.message) || error) };
      }
      if (!lock?.locked && !lock?.unavailable) return;
      const error = new contract.SystemStorageWriteError(
        '共有ワークスペースは互換性確認のため閲覧専用です。全員を最新版へ更新し、所有者が再移行してください',
      );
      error.code = 'compatibility_lock';
      error.meldexCode = 'compatibility_lock';
      error.compatibilityLock = lock || { locked: true };
      throw error;
    }

    _audit(level, operation, kind, documentId, extra) {
      _contract().recordStorageAuditEvent(this._auditSink, {
        level, operation, kind, documentId, environment: this._environment,
        message: (extra && extra.message) || '',
        detail: extra && extra.detail,
      });
    }

    async _readExisting(kind, documentId) {
      const path = this._pathFor(kind, documentId);
      const result = await _downloadEnvelope(path, this._namespaceKind);
      if (!result) return null;
      const contract = _contract();
      try {
        const record = contract.recordFromEnvelope(result.data, { revisionOverride: result.rev });
        return record;
      } catch (error) {
        this._audit('error', 'load', kind, documentId, { message: '破損した管理データを検出しました' });
        throw error;
      }
    }

    async load(kind, documentId) {
      const contract = _contract();
      const docId = contract.sanitizeDocumentId(documentId);
      return this._readExisting(kind, docId);
    }

    async _listFolderEntries(folderPath) {
      const entries = [];
      let payload;
      try {
        payload = await _rpc('files/list_folder', { path: folderPath, recursive: false }, this._namespaceKind);
      } catch (err) {
        if (_isNotFoundError(err)) return [];
        throw err;
      }
      entries.push(...(payload.entries || []));
      while (payload.has_more) {
        payload = await _rpc('files/list_folder/continue', { cursor: payload.cursor }, this._namespaceKind);
        entries.push(...(payload.entries || []));
      }
      return entries;
    }

    async listDocuments(kind) {
      const contract = _contract();
      const entries = await this._listFolderEntries(this._folderFor(kind));
      const records = [];
      for (const entry of entries) {
        if (entry['.tag'] !== 'file' || !/\.json$/i.test(entry.name || '')) continue;
        const documentId = String(entry.name).slice(0, -5);
        try {
          contract.sanitizeDocumentId(documentId);
        } catch {
          continue; // 本契約が作成したものではない未知のファイルは無視する
        }
        try {
          const record = await this.load(kind, documentId);
          if (record) records.push(record);
        } catch (error) {
          this._audit('error', 'list_documents', kind, documentId, {
            message: `破損データをスキップしました: ${error && error.message}`,
          });
        }
      }
      return records;
    }

    async listDocumentHeaders(kind, options) {
      const contract = _contract();
      const opts = options || {};
      const limit = Math.max(1, Math.min(200, Number(opts.limit || 50)));
      let payload;
      if (opts.cursor) {
        payload = await _rpc('files/list_folder/continue', { cursor: String(opts.cursor) }, this._namespaceKind);
      } else {
        payload = await _rpc('files/list_folder', {
          path: this._folderFor(kind), recursive: false, limit,
        }, this._namespaceKind).catch((error) => {
          if (_isNotFoundError(error)) return { entries: [], has_more: false, cursor: '' };
          throw error;
        });
      }
      const entries = [];
      for (const entry of payload.entries || []) {
        if (entry['.tag'] !== 'file' || !/\.json$/i.test(entry.name || '')) continue;
        const documentId = String(entry.name).slice(0, -5);
        try { contract.sanitizeDocumentId(documentId); } catch { continue; }
        entries.push({
          documentId, revision: String(entry.rev || ''), size: Number(entry.size || 0),
          modified: String(entry.server_modified || entry.client_modified || ''),
        });
      }
      return {
        entries, cursor: String(payload.cursor || ''), complete: !payload.has_more,
        revision: String(payload.cursor || ''),
      };
    }

    async documentCollectionGeneration(kind, options) {
      const contract = _contract();
      const excluded = new Set((options?.excludeDocumentIds || []).map(String));
      const headers = [];
      for (const entry of await this._listFolderEntries(this._folderFor(kind))) {
        if (entry['.tag'] !== 'file' || !/\.json$/i.test(entry.name || '')) continue;
        const documentId = String(entry.name).slice(0, -5);
        try { contract.sanitizeDocumentId(documentId); } catch { continue; }
        if (!excluded.has(documentId)) headers.push([documentId, String(entry.rev || '')]);
      }
      headers.sort((a, b) => a[0].localeCompare(b[0]));
      return contract.computeRevision(headers);
    }

    async _totalBytesForKind(kind, excludeDocumentId) {
      let entries;
      try {
        entries = await this._listFolderEntries(this._folderFor(kind));
      } catch (err) {
        if (_isNotFoundError(err)) return 0;
        throw err;
      }
      const excludeName = excludeDocumentId ? `${excludeDocumentId}.json` : null;
      return entries
        .filter(entry => entry['.tag'] === 'file' && (!excludeName || entry.name !== excludeName))
        .reduce((sum, entry) => sum + Number(entry.size || 0), 0);
    }

    async _preserveConflictBackup(kind, documentId, attemptedPayload, existing) {
      const contract = _contract();
      const backupId = `${documentId}-conflict-${Math.random().toString(16).slice(2, 14)}${Date.now().toString(36)}`;
      const backupPayload = {
        original_kind: kind,
        original_document_id: documentId,
        attempted_payload: attemptedPayload,
        current_payload_at_conflict: existing ? existing.payload : null,
        attempted_at: contract.nowIso(),
      };
      try {
        await this.save(contract.SystemStorageKind.CONFLICT_BACKUPS, backupId, backupPayload);
        return backupId;
      } catch {
        this._audit('error', 'conflict_backup_failed', kind, documentId, { message: '競合バックアップの保全に失敗しました' });
        return '';
      }
    }

    async save(kind, documentId, payload, options) {
      const contract = _contract();
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        throw new contract.SystemStorageError('payload はオブジェクトである必要があります');
      }
      const docId = contract.sanitizeDocumentId(documentId);
      const opts = options || {};
      const expectedRevision = Object.prototype.hasOwnProperty.call(opts, 'expectedRevision') ? opts.expectedRevision : undefined;
      const path = this._pathFor(kind, docId);
      await this._assertCompatibilityWriteAllowed(kind);

      const existing = await this._readExisting(kind, docId);
      const currentRevision = existing ? existing.revision : null;

      // undefined は「CAS指定なし」。明示 null は「未作成を期待する
      // create-only CAS」なので、既存レコードがあれば必ず競合にする。
      if (expectedRevision !== undefined && expectedRevision !== currentRevision) {
        const conflictBackupDocumentId = await this._preserveConflictBackup(kind, docId, payload, existing);
        this._audit('warning', 'save_conflict', kind, docId, {
          message: 'revisionが一致しないため書込を中止しました',
          detail: { expected_revision: expectedRevision, current_revision: currentRevision },
        });
        throw new contract.SystemStorageConflictError({
          kind, documentId: docId, expectedRevision, currentRevision, conflictBackupDocumentId,
        });
      }

      await _ensureFolder(this._managementRoot, this._namespaceKind);
      await _ensureFolder(this._folderFor(kind), this._namespaceKind);

      const policy = contract.retentionPolicyFor(kind);
      const timestamp = contract.nowIso();
      const record = {
        kind,
        documentId: docId,
        schemaVersion: contract.CURRENT_SCHEMA_VERSION,
        // 書込直前に確認できた現在のrev(参考情報。CAS判定・戻り値は常に
        // Dropbox APIレスポンスの真のrevを使う。ファイル冒頭コメント参照)。
        revision: currentRevision || '',
        payload,
        createdAt: existing ? existing.createdAt : timestamp,
        updatedAt: timestamp,
        boundary: this._boundary,
      };
      const bytes = new TextEncoder().encode(JSON.stringify(contract.recordToEnvelope(record), null, 2));
      contract.checkDocumentSizeQuota(kind, bytes.length, { policy });
      const existingTotal = await this._totalBytesForKind(kind, docId);
      contract.checkTotalSizeQuota(kind, existingTotal, bytes.length, { policy });

      const mode = currentRevision ? { '.tag': 'update', update: currentRevision } : 'add';
      let uploadMeta;
      try {
        const response = await _content('files/upload', {
          path, mode, autorename: false, mute: false, strict_conflict: true,
        }, {
          method: 'POST',
          headers: { 'Content-Type': 'application/octet-stream' },
          body: bytes,
        }, this._namespaceKind);
        uploadMeta = await response.json();
      } catch (error) {
        if (_isConflictError(error)) {
          // 事前確認とアップロードの間にDropbox側で更新された(実レース)。
          const refreshed = await _downloadEnvelope(path, this._namespaceKind).catch(() => null);
          const conflictBackupDocumentId = await this._preserveConflictBackup(kind, docId, payload, existing);
          const refreshedRevision = refreshed ? refreshed.rev : currentRevision;
          this._audit('warning', 'save_conflict', kind, docId, {
            message: 'Dropbox側で更新競合を検出しました',
            detail: { expected_revision: expectedRevision, current_revision: refreshedRevision },
          });
          throw new contract.SystemStorageConflictError({
            kind,
            documentId: docId,
            expectedRevision: expectedRevision === undefined ? currentRevision : expectedRevision,
            currentRevision: refreshedRevision,
            conflictBackupDocumentId,
          });
        }
        this._audit('error', 'save', kind, docId, { message: `書込に失敗しました: ${error && error.message}` });
        throw new contract.SystemStorageWriteError(`管理データの書込に失敗しました: ${error && error.message}`);
      }
      record.revision = String((uploadMeta && uploadMeta.rev) || currentRevision || '');
      this._audit('info', 'save', kind, docId, { message: '保存しました' });
      return record;
    }

    async delete(kind, documentId) {
      const contract = _contract();
      const docId = contract.sanitizeDocumentId(documentId);
      const path = this._pathFor(kind, docId);
      await this._assertCompatibilityWriteAllowed(kind);
      try {
        await _rpc('files/delete_v2', { path }, this._namespaceKind);
        this._audit('info', 'delete', kind, docId, { message: '削除しました' });
        return true;
      } catch (error) {
        if (_isNotFoundError(error)) return false;
        this._audit('error', 'delete', kind, docId, { message: `削除に失敗しました: ${error && error.message}` });
        throw new contract.SystemStorageWriteError(`管理データの削除に失敗しました: ${error && error.message}`);
      }
    }

    describe() {
      return {
        environment: this._environment,
        boundary: this._boundary,
        namespace_kind: this._namespaceKind,
        management_root: this._managementRoot,
      };
    }

    // --- オフライン送信待ち(save() 自体の契約は変えず、opt-inの別APIとして提供) ---

    _enqueuePending(kind, documentId, payload, expectedRevision, hasExpectedRevision, errorMessage) {
      const rows = _readOutbox(this._boundary);
      const now = _contract().nowIso();
      const existingIndex = rows.findIndex(row => row.kind === kind && row.documentId === documentId);
      const entry = {
        id: existingIndex >= 0 ? rows[existingIndex].id : `${kind}:${documentId}:${Date.now().toString(36)}`,
        kind,
        documentId,
        payload,
        expectedRevision: expectedRevision == null ? null : expectedRevision,
        // 旧キューにはこのフィールドが無い。旧実装は省略時にも null を保存して
        // いたため、再送時は安全側(create-only)として扱う。
        // オフライン時に現在revを確認できない無指定保存も、再送では
        // create-only(null)として扱う。無条件再送は他端末の更新を失わせる。
        hasExpectedRevision: true,
        attempts: existingIndex >= 0 ? Number(rows[existingIndex].attempts || 0) : 0,
        state: 'pending',
        createdAt: existingIndex >= 0 ? rows[existingIndex].createdAt : now,
        updatedAt: now,
        lastError: String(errorMessage || ''),
      };
      if (existingIndex >= 0) rows[existingIndex] = entry;
      else rows.push(entry);
      _writeOutbox(this._boundary, rows);
      return entry;
    }

    listPending() {
      return _readOutbox(this._boundary);
    }

    async saveWithOfflineQueue(kind, documentId, payload, options) {
      const contract = _contract();
      try {
        return await this.save(kind, documentId, payload, options);
      } catch (error) {
        if (error instanceof contract.SystemStorageConflictError) throw error; // 競合は自動キューしない(ユーザー判断が必要)
        if (!_isRetryableOfflineError(error)) throw error; // 恒久的エラー(権限不足等)はそのまま伝える
        const docId = contract.sanitizeDocumentId(documentId);
        const opts = options || {};
        const hasExpectedRevision = Object.prototype.hasOwnProperty.call(opts, 'expectedRevision');
        const expectedRevision = hasExpectedRevision ? opts.expectedRevision : null;
        const entry = this._enqueuePending(
          kind, docId, payload, expectedRevision, hasExpectedRevision, error && error.message,
        );
        this._audit('warning', 'save_queued_offline', kind, docId, { message: 'オフラインのため送信待ちに登録しました' });
        return { queued: true, operationId: entry.id, kind, documentId: docId };
      }
    }

    async flushPending() {
      const rows = _readOutbox(this._boundary);
      if (!rows.length) return { flushed: 0, remaining: 0, failed: 0 };
      let remaining = rows.slice();
      let flushed = 0;
      for (const row of rows) {
        if (row.state === 'failed') {
          continue;
        }
        try {
          const replayOptions = row.hasExpectedRevision === false
            ? {}
            : { expectedRevision: row.expectedRevision };
          await this.save(row.kind, row.documentId, row.payload, replayOptions);
          const next = remaining.filter(item => item.id !== row.id);
          try {
            // リモート成功ごとに送信待ちを確定する。ここが失敗した場合は
            // 直ちに停止し、CAS付きの行を残して安全に再判定できるようにする。
            _writeOutbox(this._boundary, next);
          } catch (checkpointError) {
            const durableError = new (_contract().SystemStorageWriteError)(
              `リモート保存後の送信待ち確定に失敗しました: ${checkpointError && checkpointError.message}`,
            );
            durableError.code = 'outbox_checkpoint_failed';
            durableError.meldexCode = 'outbox_checkpoint_failed';
            throw durableError;
          }
          remaining = next;
          flushed += 1;
        } catch (error) {
          if (error && (error.code === 'outbox_checkpoint_failed' || error.meldexCode === 'outbox_checkpoint_failed')) {
            throw error;
          }
          const contract = _contract();
          const attempts = Number(row.attempts || 0) + 1;
          const isConflict = error instanceof contract.SystemStorageConflictError;
          const permanentFailure = !isConflict && !_isRetryableOfflineError(error);
          const updated = {
            ...row,
            attempts,
            state: (permanentFailure || attempts >= MAX_OFFLINE_QUEUE_ATTEMPTS) ? 'failed' : 'pending',
            updatedAt: contract.nowIso(),
            lastError: String((error && error.message) || error).slice(0, 500),
          };
          remaining = remaining.map(item => item.id === row.id ? updated : item);
          _writeOutbox(this._boundary, remaining);
        }
      }
      const failed = remaining.filter(row => row.state === 'failed').length;
      return { flushed, remaining: remaining.length, failed };
    }
  }

  // --- ファクトリ ---------------------------------------------------------------

  function createPersonalAdapter({ accountBoundary, auditSink, namespaceKind } = {}) {
    return new DropboxSystemStorageAdapter({
      managementRoot: personalManagementRoot(),
      boundary: `dropbox-personal:${String(accountBoundary || 'unknown').trim()}`,
      environment: 'dropbox-personal',
      namespaceKind: namespaceKind || 'home',
      auditSink,
    });
  }

  function createSharedWorkspaceAdapter({
    workspaceDropboxPath, workspaceId, namespaceKind, auditSink, compatibilityLockProvider,
  } = {}) {
    return new DropboxSystemStorageAdapter({
      managementRoot: sharedWorkspaceManagementRoot(workspaceDropboxPath),
      boundary: `dropbox-shared-workspace:${String(workspaceId || workspaceDropboxPath).trim()}`,
      environment: 'dropbox-shared-workspace',
      namespaceKind: namespaceKind || 'home',
      auditSink,
      compatibilityLockProvider,
    });
  }

  window.MeldexSystemStorageDropbox = {
    MANAGEMENT_SUBPATH,
    DropboxSystemStorageAdapter,
    personalManagementRoot,
    sharedWorkspaceManagementRoot,
    runMigrationWriteScope,
    createPersonalAdapter,
    createSharedWorkspaceAdapter,
  };
})();
