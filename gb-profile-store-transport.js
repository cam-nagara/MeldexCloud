// gb-profile-store-transport.js
//
// Dropboxアカウント基準の共有プロフィールストア（profiles.v1.json）を読み書きする
// transport（搬送経路）を切り替え可能にするモジュール。gb-dropbox-profile-sync.js
// 本体はこのモジュール経由で read/write を行い、Dropbox HTTP API 直叩き（クラウド版・
// Dropbox接続済みのデスクトップ版）と、デスクトップのローカルAPIサーバー経由の
// settings-file API（Dropbox OAuth未接続のデスクトップ版）を透過的に切り替える。
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

  function _isConflictError(error) {
    return /conflict|too_many_write_operations|path\/conflict/i.test(String(error?.message || error || ''));
  }

  function _isHttpStatus(error, status) {
    return new RegExp('\\bHTTP ' + status + '\\b').test(String(error?.message || error || ''));
  }

  // --- dropbox-api transport: Dropbox HTTP API へ直接アクセスする ---------------------
  // クラウド版・Dropbox接続済みのデスクトップ版で使う。既存のクラウド実装
  // （rev楽観ロック・path/not_found→空store・conflict判定）と同じロジック。

  async function _ensureDropboxFolders(auth, storePath) {
    const segments = String(storePath || '').replace(/\\/g, '/').split('/').filter(Boolean);
    segments.pop(); // ファイル名を除く
    const parents = [];
    let acc = '';
    for (const segment of segments) {
      acc += '/' + segment;
      parents.push(acc);
    }
    for (const path of parents) {
      try {
        await auth.apiRpc('files/create_folder_v2', { path, autorename: false });
      } catch (error) {
        if (!_isConflictError(error)) throw error;
      }
    }
  }

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
        const auth = _auth();
        if (!auth?.apiContent) throw new Error('Dropbox API is unavailable');
        await _ensureDropboxFolders(auth, storePath);
        const rev = options?.ifMatch || '';
        const mode = rev ? { '.tag': 'update', update: rev } : 'add';
        const bytes = new TextEncoder().encode(JSON.stringify(storeObj, null, 2));
        await auth.apiContent('files/upload', {
          path: storePath,
          mode,
          autorename: false,
          mute: false,
          strict_conflict: true,
        }, {
          method: 'POST',
          headers: { 'Content-Type': 'application/octet-stream' },
          body: bytes,
        });
      },
    };
  }

  // --- settings-bridge transport: デスクトップのローカルAPIサーバー経由 --------------
  // Dropbox OAuth未接続でも、Dropboxデスクトップアプリの同期フォルダが検出できて
  // いれば、/api/dropbox-link/settings-file 経由で同じ profiles.v1.json を読み書き
  // できる。ifMtime によるmtime楽観ロックで、Dropbox rev楽観ロックと同等の
  // 衝突検出を行う。

  function _relativeToSettingsRoot(path) {
    const normalized = String(path || '').replace(/\\/g, '/').replace(/\/+/g, '/');
    const prefix = DEFAULT_SETTINGS_ROOT + '/';
    if (normalized.toLowerCase().startsWith(prefix.toLowerCase())) return normalized.slice(prefix.length);
    return normalized.replace(/^\/+/, '');
  }

  function _settingsBridgeTransport() {
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
        const relative = _relativeToSettingsRoot(storePath);
        const result = await apiFetch(SETTINGS_FILE_API_PATH + '?path=' + encodeURIComponent(relative), { skipBrowseCache: true });
        if (!result || result.available === false) throw new Error('settings-bridge is unavailable');
        if (!result.found) return { store: null, rev: '' };
        const parsed = _safeJsonParse(result.content, null);
        if (!parsed || typeof parsed !== 'object') throw new Error('settings-file JSON is broken');
        return { store: parsed, rev: result.mtime == null ? '' : String(result.mtime) };
      },
      async write(storePath, storeObj, options) {
        const relative = _relativeToSettingsRoot(storePath);
        const ifMatch = options?.ifMatch;
        const body = {
          path: relative,
          content: JSON.stringify(storeObj, null, 2),
          // ifMatch 無し(初回作成相当) は null にして「未存在のみ許可」を明示する。
          // Dropbox API の mode:'add' と同じ意味論。
          ifMtime: ifMatch ? Number(ifMatch) : null,
        };
        try {
          await apiFetch(SETTINGS_FILE_API_PATH, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          });
        } catch (error) {
          // apiFetch はHTTPステータス文字列(statusText)を含めてエラーにするが、
          // HTTP/2 環境等では statusText が空になり得るため、必ず含まれる数字の
          // ステータスコードで判定する。
          if (_isHttpStatus(error, 409)) throw new Error('path/conflict: settings-file ifMtime mismatch');
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
