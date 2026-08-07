/* gb-system-storage-indexeddb.js
 *
 * ブラウザローカル管理領域アダプター(固有形式付随物廃止・管理データ一元化計画 Phase 1b)。
 *
 * 計画書: app/docs/proprietary-format-sidecar-cleanup-plan-2026-07-31.md (§4.1「ブラウザの
 * ローカル利用 = IndexedDBのMeldex管理ストア」)
 * 契約: gb-system-storage.js(window.MeldexSystemStorage)
 * 対応するPython側: meldex_system_storage_local.py(Windowsローカル。同じ役割をローカル
 * ファイルツリーで担う。JS側はブラウザのIndexedDBを使う点だけが違う)
 *
 * ## 「ブラウザのローカル利用」の意味(Phase 0監査ノート§1.1 系統C)
 *
 * File System Access APIでユーザーの保存場所へ直接読み書きする単独アプリ
 * (board-standalone-fs.js 等)が、注釈・タグ・ロック等の管理データまで
 * ユーザーの保存場所(_meldex/board-annotations.json 等)へ書いてしまう問題を
 * 解消するための保存先。IndexedDBはブラウザの内部ストレージであり、
 * ユーザーが選んだフォルダには一切触れない。
 *
 * ## 既存のIndexedDB利用箇所との流儀の統一
 *
 * standalone-local-drafts.js(DB名 `meldex-standalone-local-v1`、
 * Promiseでラップしたトランザクション、`crypto.randomUUID` によるID生成、
 * 日本語のエラーメッセージ)と同じ流儀に揃える。
 *
 * ## モック注入可能な構造(Node実行テストのため)
 *
 * 実際の `indexedDB.open()` を使う既定バックエンド(_realBackend)と、
 * 保存/読込/一覧/削除の「ロジック」を分離してある。
 * `new IndexedDbSystemStorageAdapter({ backend: fakeBackend })` のように
 * バックエンドを差し替えられるため、Node(indexedDBが無い環境)でも
 * CAS・競合バックアップ・容量上限などの契約ロジックをそのまま検証できる
 * (gb-active-lock-store.js のテストが「provider」を注入するのと同じ考え方。
 * fake-indexeddb 等の外部ライブラリは使わない)。
 */
(function () {
  'use strict';

  if (window.MeldexSystemStorageIndexedDB) return;

  const DB_NAME = 'meldex-system-storage-v1';
  const DB_VERSION = 1;
  const STORE_NAME = 'records';
  const DEFAULT_BOUNDARY = 'browser-local';
  const DEFAULT_ENVIRONMENT = 'browser-local-indexeddb';

  function _contract() {
    const contract = window.MeldexSystemStorage;
    if (!contract) throw new Error('gb-system-storage.js が読み込まれていません');
    return contract;
  }

  function _recordKey(boundary, kind, documentId) {
    return `${encodeURIComponent(String(boundary || ''))}|${kind}|${documentId}`;
  }

  // --- 既定バックエンド(実際の indexedDB を使う) ------------------------------

  let _dbPromise = null;

  function _openDb() {
    if (_dbPromise) return _dbPromise;
    _dbPromise = new Promise((resolve, reject) => {
      if (!window.indexedDB) {
        reject(new Error('この端末では管理データの保存(IndexedDB)を利用できません'));
        return;
      }
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
          store.createIndex('boundaryKind', ['boundary', 'kind']);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('管理データストアを開けませんでした'));
    });
    return _dbPromise;
  }

  async function _transaction(mode, action) {
    const db = await _openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, mode);
      const store = tx.objectStore(STORE_NAME);
      let result;
      try {
        result = action(store);
      } catch (error) {
        reject(error);
        return;
      }
      tx.oncomplete = () => resolve(result && result.result);
      tx.onerror = () => reject(tx.error || (result && result.error) || new Error('管理データの保存に失敗しました'));
      tx.onabort = () => reject(tx.error || new Error('管理データの保存を中断しました'));
    });
  }

  // standalone-local-drafts.js の transaction() ヘルパーと同じ流儀:
  // action(store) は IDBRequest をそのまま返し、_transaction() 側が
  // tx.oncomplete 時点で request.result を取り出す(二重にPromiseへ
  // 包まない。トランザクションは保留中のリクエストが無くなり、かつ
  // 同期的な後続操作が無い時点で自動コミットされるため、この形で安全に
  // 「リクエスト成功 → トランザクションコミット → resolve」の順が守られる)。
  const _realBackend = {
    async get(boundary, kind, documentId) {
      const key = _recordKey(boundary, kind, documentId);
      const row = await _transaction('readonly', store => store.get(key));
      return row || null;
    },

    async put(row) {
      await _transaction('readwrite', store => store.put(row));
    },

    async putConditional(row, expectedRevision) {
      const db = await _openDb();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const request = store.get(row.id);
        let conflict = null;
        request.onsuccess = () => {
          const current = request.result || null;
          const currentRevision = current?.envelope?.meldex_system_storage?.revision || null;
          if (expectedRevision !== undefined && expectedRevision !== currentRevision) {
            conflict = { expectedRevision, currentRevision };
            tx.abort();
            return;
          }
          store.put(row);
        };
        request.onerror = () => reject(request.error || new Error('管理データの競合確認に失敗しました'));
        tx.oncomplete = () => resolve();
        tx.onabort = () => {
          if (conflict) {
            const error = new Error('SYSTEM_STORAGE_CAS_CONFLICT');
            error.name = 'IndexedDbCasConflict';
            error.expectedRevision = conflict.expectedRevision;
            error.currentRevision = conflict.currentRevision;
            reject(error);
          } else {
            reject(tx.error || new Error('管理データの保存を中断しました'));
          }
        };
        tx.onerror = () => {
          if (!conflict) reject(tx.error || new Error('管理データの保存に失敗しました'));
        };
      });
    },

    async delete(boundary, kind, documentId) {
      const key = _recordKey(boundary, kind, documentId);
      const existing = await this.get(boundary, kind, documentId);
      if (!existing) return false;
      await _transaction('readwrite', store => store.delete(key));
      return true;
    },

    async listForBoundaryKind(boundary, kind) {
      const rows = await _transaction('readonly', (store) => {
        const index = store.index('boundaryKind');
        return index.getAll(IDBKeyRange.only([String(boundary || ''), kind]));
      });
      return rows || [];
    },
  };

  // --- ロジック本体(バックエンド注入可能) -------------------------------------

  class IndexedDbSystemStorageAdapter {
    constructor(options) {
      const opts = options || {};
      this._boundary = String(opts.boundary || DEFAULT_BOUNDARY);
      this._environment = String(opts.environment || DEFAULT_ENVIRONMENT);
      this._auditSink = typeof opts.auditSink === 'function' ? opts.auditSink : null;
      this._preserveConflicts = !!opts.preserveConflicts;
      this._backend = opts.backend || _realBackend;
    }

    _audit(level, operation, kind, documentId, extra) {
      const contract = _contract();
      contract.recordStorageAuditEvent(this._auditSink, {
        level,
        operation,
        kind,
        documentId,
        environment: this._environment,
        message: (extra && extra.message) || '',
        detail: extra && extra.detail,
      });
    }

    async _readRow(kind, documentId) {
      const row = await this._backend.get(this._boundary, kind, documentId);
      if (!row) return null;
      const contract = _contract();
      try {
        return contract.recordFromEnvelope(row.envelope);
      } catch (error) {
        this._audit('error', 'load', kind, documentId, { message: '破損した管理データを検出しました' });
        throw error;
      }
    }

    async load(kind, documentId) {
      return this._readRow(kind, documentId);
    }

    async listDocuments(kind) {
      const contract = _contract();
      const rows = await this._backend.listForBoundaryKind(this._boundary, kind);
      const records = [];
      for (const row of rows) {
        try {
          records.push(contract.recordFromEnvelope(row.envelope));
        } catch (error) {
          this._audit('error', 'list_documents', kind, row && row.documentId, {
            message: `破損データをスキップしました: ${error && error.message}`,
          });
        }
      }
      return records;
    }

    async _totalBytesForKind(kind, excludeDocumentId) {
      const rows = await this._backend.listForBoundaryKind(this._boundary, kind);
      return rows
        .filter(row => row.documentId !== excludeDocumentId)
        .reduce((sum, row) => sum + Number(row.sizeBytes || 0), 0);
    }

    async _preserveConflictBackup(kind, documentId, attemptedPayload, existing) {
      const backupId = `${documentId}-conflict-${Math.random().toString(16).slice(2, 14)}${Date.now().toString(36)}`;
      const backupPayload = {
        original_kind: kind,
        original_document_id: documentId,
        attempted_payload: attemptedPayload,
        current_payload_at_conflict: existing ? existing.payload : null,
        attempted_at: _contract().nowIso(),
      };
      try {
        await this.save(_contract().SystemStorageKind.CONFLICT_BACKUPS, backupId, backupPayload);
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
      const existing = await this._readRow(kind, docId);
      const currentRevision = existing ? existing.revision : null;

      // expectedRevision:null は「まだ存在しないこと」を期待するcreate-only CAS。
      // nullを無条件保存として扱うと、初回作成同士の競合だけ検出できず、
      // 後着の空payloadが先着の編集を消し得る。
      if (expectedRevision !== undefined && expectedRevision !== currentRevision) {
        let conflictBackupDocumentId = null;
        if (this._preserveConflicts) {
          conflictBackupDocumentId = await this._preserveConflictBackup(kind, docId, payload, existing);
        }
        this._audit('warning', 'save_conflict', kind, docId, {
          message: 'revisionが一致しないため書込を中止しました',
          detail: { expected_revision: expectedRevision, current_revision: currentRevision },
        });
        throw new contract.SystemStorageConflictError({
          kind, documentId: docId, expectedRevision, currentRevision, conflictBackupDocumentId,
        });
      }

      const policy = contract.retentionPolicyFor(kind);
      const revision = await contract.computeRevision(payload);
      const timestamp = contract.nowIso();
      const record = {
        kind,
        documentId: docId,
        schemaVersion: contract.CURRENT_SCHEMA_VERSION,
        revision,
        payload,
        createdAt: existing ? existing.createdAt : timestamp,
        updatedAt: timestamp,
        boundary: this._boundary,
      };
      const envelope = contract.recordToEnvelope(record);
      const serialized = JSON.stringify(envelope);
      const sizeBytes = new TextEncoder().encode(serialized).length;
      contract.checkDocumentSizeQuota(kind, sizeBytes, { policy });
      const existingTotal = await this._totalBytesForKind(kind, docId);
      contract.checkTotalSizeQuota(kind, existingTotal, sizeBytes, { policy });

      const rowToSave = {
          id: _recordKey(this._boundary, kind, docId),
          boundary: this._boundary,
          kind,
          documentId: docId,
          envelope,
          sizeBytes,
      };
      try {
        if (typeof this._backend.putConditional === 'function') {
          await this._backend.putConditional(rowToSave, expectedRevision);
        } else {
          await this._backend.put(rowToSave);
        }
      } catch (error) {
        if (error?.name === 'IndexedDbCasConflict') {
          this._audit('warning', 'save_conflict', kind, docId, {
            message: 'revisionが一致しないため書込を中止しました',
            detail: {
              expected_revision: error.expectedRevision,
              current_revision: error.currentRevision,
            },
          });
          throw new contract.SystemStorageConflictError({
            kind,
            documentId: docId,
            expectedRevision: error.expectedRevision,
            currentRevision: error.currentRevision,
          });
        }
        this._audit('error', 'save', kind, docId, { message: `書込に失敗しました: ${error && error.message}` });
        throw new contract.SystemStorageWriteError(`管理データの書込に失敗しました: ${error && error.message}`);
      }
      this._audit('info', 'save', kind, docId, { message: '保存しました' });
      return record;
    }

    async delete(kind, documentId) {
      const contract = _contract();
      const docId = contract.sanitizeDocumentId(documentId);
      try {
        const removed = await this._backend.delete(this._boundary, kind, docId);
        if (removed) this._audit('info', 'delete', kind, docId, { message: '削除しました' });
        return removed;
      } catch (error) {
        this._audit('error', 'delete', kind, docId, { message: `削除に失敗しました: ${error && error.message}` });
        throw new contract.SystemStorageWriteError(`管理データの削除に失敗しました: ${error && error.message}`);
      }
    }

    describe() {
      return {
        environment: this._environment,
        boundary: this._boundary,
        preserve_conflicts: this._preserveConflicts,
      };
    }
  }

  function createLocalBrowserAdapter(options) {
    return new IndexedDbSystemStorageAdapter(options);
  }

  window.MeldexSystemStorageIndexedDB = {
    DB_NAME,
    DB_VERSION,
    STORE_NAME,
    IndexedDbSystemStorageAdapter,
    createLocalBrowserAdapter,
    _realBackend, // 実IndexedDBバックエンド(通常は createLocalBrowserAdapter 経由で使う)
  };
})();
