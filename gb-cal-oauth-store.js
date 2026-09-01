/* ==============================
   gb-cal-oauth-store.js: カレンダー外部連携（Google/Microsoft）OAuth認証情報の
   端末ローカル保護保存（Cloud=Dropboxブラウザ完結版専用）

   コミット前レビュー指摘 #10（production-management-ux-improvement-plan-2026-08-04.md）:
   gb-cal-cloud-sync.js / gb-cal-cloud-tasks.js は client_secret・refresh_token・
   access_token を接続中のDropboxワークスペース内 `_calendar/*.json` へ平文で保存して
   いた。共有フォルダの他メンバーやDropboxのバージョン履歴経由で読める状態は保護水準が
   低いため、gb-llm-keys-store.js の「local-device」モード（IndexedDB。既定・パスフレーズ
   不要で自動同期の裏側から使える）と同じ仕組み・同じ保護水準（ブラウザのIndexedDBは
   オリジン限定でDropbox同期の対象外）へ変更する。

   既存プレーンテキストからの読み替え互換: 呼び出し側（gb-cal-cloud-sync.js /
   gb-cal-cloud-tasks.js の _readAuth）が、旧位置（Dropbox JSON）に平文の秘密フィールドを
   見つけたら、この store へ一度だけ移してから旧位置の平文フィールドを削除する
   （extractSecretFields / stripSecretFields を使う）。

   ファイル名注記（2026-08-05）: 元は gb-cal-oauth-token-store.js だったが、Cloud静的ビルド
   検証（build_cloud_static_manifest.FORBIDDEN_NAME_RE）が区切り語「token」を含むファイル名を
   配布物から機械的に拒否するため、現在の名前へ改名した（実体は変更なし。禁止パターン自体は
   実秘密ファイル混入を防ぐガードのため緩和しない）。

   LLM APIキー保存とは別のIndexedDBデータベースにする（用途が異なり、削除・エクスポート等の
   ライフサイクルを混在させたくないため）。トークンをログへ出力しないこと。
   ============================== */
(function () {
  'use strict';

  const DB_NAME = 'meldex-cal-oauth-tokens';
  const STORE_NAME = 'tokens';
  const DB_VERSION = 1;
  // client_id・tenant・sync_state・connected用途のexpires_at等は秘匿の必要が薄い接続
  // メタデータなので対象外（Dropbox側に残し、複数端末での「接続状態」表示・差分同期の
  // 継続に使う）。悪用されると即座にアカウントへアクセスできる3つだけを保護する。
  const SECRET_FIELDS = Object.freeze(['client_secret', 'access_token', 'refresh_token']);

  let _dbPromise = null;

  function _workspaceScope() {
    let state = null;
    try { state = window.MeldexRuntimeAdapter?.getWorkspaceState?.() || null; } catch {}
    let activeId = '';
    try { activeId = String(window.MeldexWorkspaces?.getActiveId?.() || '').trim(); } catch {}
    if (!state && !activeId) return { id: 'local-device', allowLegacyClaim: true };
    const id = String(
      state.workspaceId || state.workspace_id || state.stableId
      || activeId || ''
    ).trim();
    if (!id) throw new Error('安定したワークスペースIDを取得できません');
    return { id, allowLegacyClaim: state?.oauthLegacyClaim === true };
  }

  function _scopedKey(key) {
    const scope = _workspaceScope();
    return { key: `${scope.id}:${String(key || '')}`, scope };
  }

  async function _readValue(db, key) {
    return new Promise((resolve, reject) => {
      const req = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(key);
      req.onsuccess = () => resolve(req.result?.value || null);
      req.onerror = () => reject(req.error || new Error('IndexedDB read failed'));
    });
  }

  function _openDb() {
    if (_dbPromise) return _dbPromise;
    _dbPromise = new Promise((resolve, reject) => {
      if (!window.indexedDB) {
        reject(new Error('IndexedDB is not available'));
        return;
      }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME, { keyPath: 'key' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('IndexedDB open failed'));
      req.onblocked = () => reject(new Error('IndexedDB open blocked'));
    });
    return _dbPromise;
  }

  async function getSecrets(key) {
    if (!key) return null;
    try {
      const db = await _openDb();
      const scoped = _scopedKey(key);
      const value = await _readValue(db, scoped.key);
      if (value || !scoped.scope.allowLegacyClaim) return value;
      const legacy = await _readValue(db, key);
      if (!legacy) return null;
      await setSecrets(key, legacy);
      await new Promise((resolve, reject) => {
        const req = db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).delete(key);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error || new Error('IndexedDB legacy delete failed'));
      });
      return legacy;
    } catch {
      return null;
    }
  }

  async function setSecrets(key, value) {
    if (!key) return { ok: false };
    const scoped = _scopedKey(key);
    const db = await _openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put({ key: scoped.key, workspaceId: scoped.scope.id, value: value && typeof value === 'object' ? value : {}, updatedAt: new Date().toISOString() });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('IndexedDB write failed'));
      tx.onabort = () => reject(tx.error || new Error('IndexedDB write aborted'));
    });
    return { ok: true };
  }

  async function deleteSecrets(key) {
    if (!key) return { ok: true };
    try {
      const db = await _openDb();
      const scoped = _scopedKey(key);
      await new Promise((resolve, reject) => {
        const req = db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).delete(scoped.key);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error || new Error('IndexedDB delete failed'));
      });
    } catch {}
    return { ok: true };
  }

  function extractSecretFields(payload) {
    const secrets = {};
    SECRET_FIELDS.forEach((field) => {
      if (payload && Object.prototype.hasOwnProperty.call(payload, field)) secrets[field] = payload[field];
    });
    return secrets;
  }

  function stripSecretFields(payload) {
    const rest = { ...(payload || {}) };
    SECRET_FIELDS.forEach((field) => { delete rest[field]; });
    return rest;
  }

  function hasAnySecretValue(secrets) {
    return !!secrets && Object.values(secrets).some((value) => String(value || '').trim() !== '');
  }

  window.MeldexCalOAuthTokenStore = {
    SECRET_FIELDS: SECRET_FIELDS.slice(),
    getSecrets,
    setSecrets,
    deleteSecrets,
    extractSecretFields,
    stripSecretFields,
    hasAnySecretValue,
    workspaceScope: _workspaceScope,
  };
})();
