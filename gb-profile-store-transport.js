// gb-profile-store-transport.js
//
// Dropboxアカウント基準の共有プロフィールストアを読み書きする
// transport（搬送経路）を切り替え可能にするモジュール。gb-dropbox-profile-sync.js
// 本体はこのモジュール経由で read/write を行い、Dropbox HTTP API 直叩き（クラウド版・
// Dropbox接続済みのデスクトップ版）と、デスクトップのローカルAPIサーバー経由の
// settings-file API（Dropbox OAuth未接続のデスクトップ版）を透過的に切り替える。
// settings-file API側の正本は型付き管理領域
// (profiles-workspace/dropbox-profiles)であり、旧 _meldex/profiles.v1.json は
// 読取専用fallbackとしてのみ使う。
//
// 各 transport は {id, available(), read(storePath), write(storePath, storeObj, options)}
// の形を持つ。read()/write() の戻り値・例外の意味論は両 transport で揃える:
//   - read() → { store: <object|null>, rev: <string> }（not_found は store:null, rev:''）
//   - write(storePath, storeObj, { ifMatch }) → 成功時 undefined、競合時は
//     メッセージに "conflict" を含む Error を投げる（_isConflictError 互換）
//
// gb-dropbox-profile-sync.js は本モジュール未ロード時に備えて、Dropbox HTTP API
// 直叩きの独立したフォールバック実装を自前で持つ（クラウド互換を絶対に保つため）。
(function () {
  const DEFAULT_SETTINGS_ROOT = '/MeldexSettings';
  const SETTINGS_FILE_API_PATH = '/dropbox-link/settings-file';
  const STATUS_API_PATH = '/dropbox-link/status';

  function _auth() {
    return window.MeldexDropboxAuth;
  }

  function _runtime() {
    return window.MeldexRuntimeAdapter;
  }

  function _safeJsonParse(text, fallbackValue) {
    try {
      return JSON.parse(String(text || ''));
    } catch {
      return fallbackValue;
    }
  }

  function _isNotFoundError(error) {
    return /not_found|path\/not_found/i.test(String(error?.message || error || ''));
  }

  function _isHttpStatus(error, status) {
    return new RegExp('\\bHTTP ' + status + '\\b').test(String(error?.message || error || ''));
  }

  // --- dropbox-api transport: Dropbox HTTP API へ直接アクセスする ---------------------
  // クラウド版・Dropbox接続済みのデスクトップ版で使う。既存のクラウド実装
  // （rev楽観ロック・path/not_found→空store・conflict判定）と同じロジック。

  function _dropboxApiTransport() {
    return {
      id: 'dropbox-api',
      async available() {
        const auth = _auth();
        if (!auth?.apiContent || !auth?.getCurrentAccount) return false;
        try {
          const account = await auth.getCurrentAccount(false);
          return !!String(account?.account_id || account?.accountId || '').trim();
        } catch {
          return false;
        }
      },
      async read(storePath) {
        const auth = _auth();
        if (!auth?.apiContent) throw new Error('Dropbox API is unavailable');
        try {
          const response = await auth.apiContent('files/download', { path: storePath });
          const meta = _safeJsonParse(response.headers?.get?.('dropbox-api-result') || '{}', {}) || {};
          const text = await response.text();
          const parsed = _safeJsonParse(text, null);
          if (!parsed || typeof parsed !== 'object') throw new Error('Dropbox profile store JSON is broken');
          return { store: parsed, rev: String(meta.rev || '') };
        } catch (error) {
          if (_isNotFoundError(error)) return { store: null, rev: '' };
          throw error;
        }
      },
      async write(storePath, storeObj, options) {
        void storePath;
        void storeObj;
        void options;
        throw new Error('旧プロフィール付随物への書き込みは廃止されました');
      },
    };
  }

  // --- settings-bridge transport: デスクトップのローカルAPIサーバー経由 --------------
  // Dropbox OAuth未接続でも、Dropboxデスクトップアプリの同期フォルダが検出できて
  // いれば、/api/dropbox-link/settings-file 経由で型付き管理レコードを読み書き
  // できる。管理revisionによるCASで衝突検出を行う。

  function _relativeToSettingsRoot(path) {
    const normalized = String(path || '').replace(/\\/g, '/').replace(/\/+/g, '/');
    const prefix = DEFAULT_SETTINGS_ROOT + '/';
    if (normalized.toLowerCase().startsWith(prefix.toLowerCase())) return normalized.slice(prefix.length);
    return normalized.replace(/^\/+/, '');
  }

  function _settingsBridgeTransport() {
    async function getStore(storePath) {
      const relative = _relativeToSettingsRoot(storePath);
      return apiFetch(SETTINGS_FILE_API_PATH + '?path=' + encodeURIComponent(relative), {
        skipBrowseCache: true,
      });
    }

    async function putStore(storePath, storeObj, expectedRevision) {
      const relative = _relativeToSettingsRoot(storePath);
      return apiFetch(SETTINGS_FILE_API_PATH, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: relative,
          content: JSON.stringify(storeObj, null, 2),
          expectedRevision,
        }),
      });
    }

    return {
      id: 'settings-bridge',
      async available() {
        if (typeof apiFetch !== 'function') return false;
        if (_runtime()?.isDropboxMode?.()) return false;
        try {
          const status = await apiFetch(STATUS_API_PATH, { skipBrowseCache: true });
          return !!(status && status.activeSyncRoot);
        } catch {
          return false;
        }
      },
      async read(storePath) {
        let result = await getStore(storePath);
        if (!result || result.available === false) throw new Error('settings-bridge is unavailable');
        if (!result.found) return { store: null, rev: '' };
        const parsed = _safeJsonParse(result.content, null);
        if (!parsed || typeof parsed !== 'object') throw new Error('settings-file JSON is broken');
        if (result.source === 'legacy') {
          try {
            const migrated = await putStore(storePath, parsed, null);
            return { store: parsed, rev: String(migrated?.revision || '') };
          } catch (error) {
            if (!_isHttpStatus(error, 409)) throw error;
            // 別クライアントが先に移行した。旧内容で上書きせず管理側の勝者を再取得する。
            result = await getStore(storePath);
            if (!result?.found || result.source !== 'managed') throw error;
            const winner = _safeJsonParse(result.content, null);
            if (!winner || typeof winner !== 'object') throw new Error('settings-file JSON is broken');
            return { store: winner, rev: String(result.revision || '') };
          }
        }
        return { store: parsed, rev: String(result.revision || '') };
      },
      async write(storePath, storeObj, options) {
        const expectedRevision = options?.ifMatch || null;
        try {
          await putStore(storePath, storeObj, expectedRevision);
        } catch (error) {
          // apiFetch はHTTPステータス文字列(statusText)を含めてエラーにするが、
          // HTTP/2 環境等では statusText が空になり得るため、必ず含まれる数字の
          // ステータスコードで判定する。
          if (_isHttpStatus(error, 409)) throw new Error('path/conflict: settings-file revision mismatch');
          throw error;
        }
      },
    };
  }

  // --- 選択: dropbox-api（セッションあり）→ settings-bridge（デスクトップ）→ null ---

  async function select() {
    const dropboxApi = _dropboxApiTransport();
    if (await dropboxApi.available()) return dropboxApi;
    const bridge = _settingsBridgeTransport();
    if (await bridge.available()) return bridge;
    return null;
  }

  window.MeldexProfileStoreTransport = {
    select,
    _internals: {
      dropboxApiTransport: _dropboxApiTransport,
      settingsBridgeTransport: _settingsBridgeTransport,
      relativeToSettingsRoot: _relativeToSettingsRoot,
    },
  };
})();
