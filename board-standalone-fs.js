/* board-standalone-fs.js
 * 単独ボードアプリの「サーバー API → ローカルフォルダ」差し替え層。
 *
 * Meldex 本体のスクリプトが apiFetch('/file?path=...') 等を呼んだ際、
 * 実際のサーバーを叩く代わりに、ユーザーが許可したローカルフォルダ内のファイルを
 * File System Access API で読み書きする。
 *
 * 読み込み順: meldex-core.js（apiFetch を定義する）→ 本ファイル（apiFetch を上書き）
 *
 * 重要: 単独アプリ用。Meldex.html 本体では絶対に読み込まないこと。
 */
(function () {
  'use strict';

  const NS = (window.BoardStandaloneFS = window.BoardStandaloneFS || {});
  const BOARD_FILE_EXTENSION = '.mel-board';

  // 読み書きの基準位置。exe版では開いた/保存したボードファイルの親フォルダ、
  // ブラウザ版ではユーザーが許可したフォルダを BoardStandaloneApp 側から渡す。
  let _rootHandle = null;
  let _nativeConfig = null;

  // ハンドルを IndexedDB に永続化する用のキー。
  const IDB_NAME = 'board-standalone-fs';
  const IDB_STORE = 'handles';
  const IDB_KEY_ROOT = 'rootHandle';

  // -------------------------------------------------------------------------
  // IndexedDB ユーティリティ（ハンドル永続化用の小さなラッパー）
  // -------------------------------------------------------------------------
  function _openDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore(IDB_STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function _idbGet(key) {
    const db = await _openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function _idbSet(key, value) {
    const db = await _openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function _idbDel(key) {
    const db = await _openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  // -------------------------------------------------------------------------
  // パス操作
  // -------------------------------------------------------------------------
  // 基準位置からの相対パス（例: サンプル/死霊探偵/プロット.md）を分解する。
  function _splitPath(relPath) {
    const cleaned = String(relPath || '').trim().replace(/^[/\\]+/, '').replace(/[/\\]+/g, '/');
    if (!cleaned) return { parts: [], filename: '' };
    const parts = cleaned.split('/');
    const filename = parts.pop();
    return { parts, filename };
  }

  // 指定パスのファイルハンドルを取得（無ければエラー）。
  async function _getFileHandle(relPath, { create = false } = {}) {
    if (!_rootHandle) throw new Error('先にボードファイルを保存するか開いてください');
    const { parts, filename } = _splitPath(relPath);
    if (!filename) throw new Error('ファイル名が指定されていません: ' + relPath);
    let dir = _rootHandle;
    for (const part of parts) {
      dir = await dir.getDirectoryHandle(part, { create });
    }
    return dir.getFileHandle(filename, { create });
  }

  // -------------------------------------------------------------------------
  // ルートハンドルの管理
  // -------------------------------------------------------------------------
  async function _fetchNativeJson(path, opts = {}) {
    const res = await fetch('/api' + path, {
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
      ...opts,
    });
    if (!res.ok) {
      let detail = '';
      try {
        const payload = await res.json();
        detail = payload?.detail || payload?.error || '';
      } catch {}
      const error = new Error(detail || ('HTTP ' + res.status));
      error.status = res.status;
      throw error;
    }
    return res.json();
  }

  NS.initNativeIfAvailable = async function () {
    if (new URLSearchParams(location.search).get('native') !== '1') return false;
    try {
      const config = await _fetchNativeJson('/board-app/config');
      if (config?.native) {
        _nativeConfig = config;
        _rootHandle = config.root ? { native: true, root: String(config.root || '') } : null;
        return true;
      }
    } catch (e) {}
    return false;
  };

  NS.isNativeMode = function () {
    return !!_nativeConfig;
  };

  NS.nativeInitialPath = function () {
    const fromQuery = new URLSearchParams(location.search).get('open') || '';
    return String(fromQuery || _nativeConfig?.initialPath || '').replace(/\\/g, '/').replace(/^\/+/, '');
  };

  NS.setRootHandle = function (handle) {
    _rootHandle = handle || null;
  };

  NS.getRootHandle = function () {
    return _rootHandle;
  };

  NS.rootName = function () {
    if (_nativeConfig?.rootName) return String(_nativeConfig.rootName);
    if (_rootHandle?.name) return String(_rootHandle.name);
    const root = String(_rootHandle?.root || _nativeConfig?.root || '').replace(/\\/g, '/').replace(/\/+$/, '');
    return root ? root.split('/').pop() : '';
  };

  NS.rootPathLabel = function () {
    if (_nativeConfig?.root) return String(_nativeConfig.root);
    if (_rootHandle?.root) return String(_rootHandle.root);
    return NS.rootName();
  };

  // 起動時の自動復元: 前回許可したフォルダがあれば呼び出し側に返す。
  // 権限の再要求は呼び出し側で行う（ユーザージェスチャが必要なため）。
  NS.loadSavedRootHandle = async function () {
    if (_nativeConfig) {
      if (_rootHandle?.root) return _rootHandle;
      return _nativeConfig.root ? { native: true, root: _nativeConfig.root } : null;
    }
    try {
      return (await _idbGet(IDB_KEY_ROOT)) || null;
    } catch (e) {
      return null;
    }
  };

  NS.saveRootHandle = async function (handle) {
    if (_nativeConfig) return;
    try {
      if (handle) await _idbSet(IDB_KEY_ROOT, handle);
    } catch (e) {
      // 保存に失敗しても致命的ではない（次回もダイアログを出すだけ）
    }
  };

  NS.clearSavedRootHandle = async function () {
    if (_nativeConfig) return;
    try { await _idbDel(IDB_KEY_ROOT); } catch (e) {}
  };

  // 権限の確認・要求。書き込みも欲しい場合は mode: 'readwrite' を渡す。
  NS.verifyPermission = async function (handle, { mode = 'readwrite' } = {}) {
    if (_nativeConfig) return !!handle;
    if (!handle) return false;
    const opts = { mode };
    if ((await handle.queryPermission(opts)) === 'granted') return true;
    if ((await handle.requestPermission(opts)) === 'granted') return true;
    return false;
  };

  NS.isFileSystemAccessSupported = function () {
    return !!_nativeConfig || typeof window.showDirectoryPicker === 'function';
  };

  NS.pickRootFolder = async function () {
    if (!_nativeConfig) return null;
    const config = await _fetchNativeJson('/board-app/select-folder', { method: 'POST', body: '{}' });
    _nativeConfig = config;
    _rootHandle = { native: true, root: String(config.root || '') };
    return _rootHandle;
  };

  NS.openBoardFile = async function () {
    if (!_nativeConfig) return null;
    try {
      const config = await _fetchNativeJson('/board-app/open-file', { method: 'POST', body: '{}' });
      _nativeConfig = config;
      _rootHandle = config.root ? { native: true, root: String(config.root || '') } : null;
      return config;
    } catch (e) {
      if (e?.status === 499) return null;
      throw e;
    }
  };

  NS.saveBoardAs = async function (content, suggestedName) {
    if (!_nativeConfig) return null;
    try {
      const config = await _fetchNativeJson('/board-app/save-as', {
        method: 'POST',
        body: JSON.stringify({
          content: String(content || ''),
          suggestedName: String(suggestedName || '無題' + BOARD_FILE_EXTENSION),
        }),
      });
      _nativeConfig = config;
      _rootHandle = config.root ? { native: true, root: String(config.root || '') } : null;
      return config;
    } catch (e) {
      if (e?.status === 499) return null;
      throw e;
    }
  };

  NS.pickImageFile = async function (currentPath) {
    if (_nativeConfig) {
      try {
        return await _fetchNativeJson('/board-app/pick-image-file', {
          method: 'POST',
          body: JSON.stringify({ currentPath: String(currentPath || '') }),
        });
      } catch (e) {
        if (e?.status === 499) return null;
        throw e;
      }
    }
    if (typeof window.showOpenFilePicker !== 'function') return null;
    try {
      const [handle] = await window.showOpenFilePicker({
        multiple: false,
        types: [{
          description: '画像ファイル',
          accept: { 'image/*': ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg', '.avif', '.ico'] },
        }],
      });
      if (!handle) return null;
      const file = await handle.getFile();
      return { ok: true, name: file.name, path: '', dataUrl: await _blobToDataUrl(file), outsideRoot: true };
    } catch (e) {
      if (e?.name === 'AbortError') return null;
      throw e;
    }
  };

  // -------------------------------------------------------------------------
  // 読み書きの実装
  // -------------------------------------------------------------------------
  async function _readFileAsText(relPath) {
    const handle = await _getFileHandle(relPath, { create: false });
    const file = await handle.getFile();
    return file.text();
  }

  async function _writeFileText(relPath, text) {
    const handle = await _getFileHandle(relPath, { create: true });
    const writable = await handle.createWritable();
    await writable.write(new Blob([String(text || '')], { type: 'text/plain;charset=utf-8' }));
    await writable.close();
  }

  function _newBoardMarkdown(title) {
    return ''
      + '---\n'
      + 'type: board\n'
      + '---\n';
  }

  function _newScriptnoteJson(title) {
    return JSON.stringify({
      fileType: 'meldex-scriptnote',
      schema_version: 1,
      version: 1,
      title: String(title || ''),
      layoutMode: 'manga',
      editor: { wrapMode: true, statusEnabled: false, viewMode: 'horizontal' },
      characters: [],
      characterDb: [],
      notes: [],
      rubyRules: [],
      rows: [],
      source: {},
    }, null, 2) + '\n';
  }

  function _newSheetJson(title) {
    return JSON.stringify({
      type: 'smart-db',
      name: String(title || ''),
      sourceType: 'db-entities',
      sources: [],
      filters: [],
      views: { table: { columns: [], sort: [] } },
      activeView: 'table',
    }, null, 2) + '\n';
  }

  function _newTimerJson(title) {
    return JSON.stringify({
      type: 'meldex-timer',
      version: 1,
      name: String(title || ''),
      timer: {
        displayMode: 'digital',
        totalSeconds: 300,
        elapsed: 0,
        countUp: false,
        timerRunning: false,
        timerStarted: false,
        elapsedAtStart: 0,
        timerStartMs: 0,
      },
    }, null, 2) + '\n';
  }

  function _linkedFileSpec(type, label) {
    const normalized = String(type || '').trim().toLowerCase();
    if (normalized === 'board') return { suffix: BOARD_FILE_EXTENSION, type: 'board', content: _newBoardMarkdown(label) };
    if (['database', 'sheet', 'smart-db', 'pivot'].includes(normalized)) return { suffix: '.mel-sheet', type: 'smart-db', content: _newSheetJson(label) };
    if (['scriptnote', 'scenario'].includes(normalized)) return { suffix: '.mel-scenario', type: 'scriptnote', content: _newScriptnoteJson(label) };
    if (normalized === 'timer') return { suffix: '.mel-timer', type: 'timer', content: _newTimerJson(label) };
    return { suffix: '.md', type: 'page', content: '# ' + String(label || '無題') + '\n' };
  }

  function _inferTypeFromPath(path) {
    const lower = String(path || '').trim().toLowerCase();
    if (!lower) return '';
    if (lower.endsWith(BOARD_FILE_EXTENSION) || lower.endsWith('.board.md') || lower.endsWith('.board.json') || lower.endsWith('.canvas.json')) return 'board';
    if (lower.endsWith('.mel-sheet') || lower.endsWith('.smart-db.json')) return 'smart-db';
    if (lower.endsWith('.mel-scenario') || lower.endsWith('.scriptnote.json') || lower.endsWith('.scenario.json')) return 'scriptnote';
    if (lower.endsWith('.mel-timer') || lower.endsWith('.timer.json')) return 'timer';
    if (lower.endsWith('.md') || lower.endsWith('.txt')) return 'page';
    if (/\.(png|jpe?g|gif|webp|svg|bmp|ico|avif|mp4|mov|avi|webm|mkv|mp3|wav|ogg|flac|m4a|pdf|html?|csv)$/i.test(lower)) return 'media';
    return '';
  }

  const ANNOTATION_STORE_PATH = '_meldex/board-annotations.json';
  const ANNOTATION_UPDATE_KEYS = [
    'target_path', 'target_id', 'type', 'shape', 'data', 'color', 'opacity', 'user',
    'body', 'target_kind', 'target_ref', 'orphan', 'orphaned_at', 'target_file_name',
  ];

  function _sanitizeFilename(name) {
    const cleaned = String(name || 'file').replace(/[<>:"/\\|?*\x00-\x1f]+/g, '_').replace(/^[. ]+|[. ]+$/g, '');
    return cleaned || 'file';
  }

  async function _fileExists(relPath) {
    try {
      await _getFileHandle(relPath, { create: false });
      return true;
    } catch (e) {
      return false;
    }
  }

  async function _uniqueUploadPath(parentPath, filename) {
    const dir = String(parentPath || '').trim().replace(/^[/\\]+/, '').replace(/[/\\]+/g, '/');
    const safe = _sanitizeFilename(filename);
    const dot = safe.lastIndexOf('.');
    const stem = dot > 0 ? safe.slice(0, dot) : safe;
    const suffix = dot > 0 ? safe.slice(dot) : '';
    let candidate = dir ? dir + '/' + safe : safe;
    let index = 2;
    while (await _fileExists(candidate)) {
      candidate = dir ? dir + '/' + stem + '-' + index + suffix : stem + '-' + index + suffix;
      index += 1;
    }
    return candidate;
  }

  async function _uniqueChildPath(parentPath, label, suffix) {
    const dir = String(parentPath || '').trim().replace(/^[/\\]+/, '').replace(/[/\\]+/g, '/');
    const base = _sanitizeFilename(label || '無題');
    let candidate = dir ? dir + '/' + base + suffix : base + suffix;
    let index = 2;
    while (await _fileExists(candidate)) {
      candidate = dir ? dir + '/' + base + '-' + index + suffix : base + '-' + index + suffix;
      index += 1;
    }
    return candidate;
  }

  function _annotationNow() {
    return new Date().toISOString();
  }

  function _annotationId() {
    if (window.crypto?.randomUUID) return window.crypto.randomUUID();
    return 'ann-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
  }

  function _annotationDataValue(value) {
    if (typeof value === 'string') return value;
    try { return JSON.stringify(value == null ? {} : value); } catch (e) { return '{}'; }
  }

  function _annotationPathKey(value) {
    return String(value || '').replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+/g, '/');
  }

  function _normalizeAnnotationRecord(input) {
    const now = _annotationNow();
    const row = { ...(input || {}) };
    return {
      id: String(row.id || _annotationId()),
      target_path: _annotationPathKey(row.target_path || row.target || ''),
      target_id: String(row.target_id || ''),
      type: String(row.type || 'stroke'),
      shape: String(row.shape || ''),
      data: _annotationDataValue(row.data),
      color: String(row.color || '#ffeb3b'),
      opacity: Number.isFinite(Number(row.opacity)) ? Number(row.opacity) : 1,
      user: String(row.user || (typeof getUsername === 'function' ? getUsername() : 'anonymous')),
      created: String(row.created || now),
      modified: String(row.modified || now),
      body: row.body != null ? String(row.body) : '',
      target_kind: String(row.target_kind || ''),
      target_ref: _annotationDataValue(row.target_ref || {}),
      orphan: row.orphan ? 1 : 0,
      orphaned_at: String(row.orphaned_at || ''),
      target_file_name: String(row.target_file_name || ''),
    };
  }

  async function _readAnnotationRows() {
    try {
      const text = await _readFileAsText(ANNOTATION_STORE_PATH);
      const payload = JSON.parse(text || '{}');
      const rows = Array.isArray(payload) ? payload : payload.annotations;
      return (Array.isArray(rows) ? rows : []).map(_normalizeAnnotationRecord);
    } catch (e) {
      return [];
    }
  }

  async function _writeAnnotationRows(rows) {
    const normalized = (Array.isArray(rows) ? rows : []).map(_normalizeAnnotationRecord);
    const payload = {
      version: 1,
      annotations: normalized,
    };
    await _writeFileText(ANNOTATION_STORE_PATH, JSON.stringify(payload, null, 2) + '\n');
    return normalized;
  }

  function _annotationQuery(apiPath) {
    const q = String(apiPath || '').split('?')[1] || '';
    return new URLSearchParams(q);
  }

  function _annotationLimit(params, fallback) {
    const raw = params.get('limit');
    if (raw == null || raw === '') return fallback;
    const value = Number.parseInt(raw, 10);
    if (!Number.isFinite(value)) return fallback;
    if (value < 0) return fallback;
    return Math.min(value, 10000);
  }

  function _annotationRowsForQuery(rows, apiPath) {
    const params = _annotationQuery(apiPath);
    const annId = params.get('ann_id') || '';
    const target = _annotationPathKey(params.get('target') || '');
    const targetId = params.get('target_id') || '';
    const user = params.get('user') || '';
    const annType = params.get('ann_type') || '';
    let result = rows.filter(row => {
      if (annId && row.id !== annId) return false;
      if (!annId && targetId && row.target_id !== targetId) return false;
      if (!annId && !targetId && target && _annotationPathKey(row.target_path) !== target) return false;
      if (user && row.user !== user) return false;
      if (annType && row.type !== annType) return false;
      return true;
    });
    result = result.sort((a, b) => String(b.created || '').localeCompare(String(a.created || '')));
    const limit = _annotationLimit(params, 200);
    return limit > 0 ? result.slice(0, limit) : result;
  }

  async function _createAnnotation(body) {
    const now = _annotationNow();
    const record = _normalizeAnnotationRecord({
      ...body,
      id: _annotationId(),
      created: now,
      modified: now,
    });
    const rows = await _readAnnotationRows();
    rows.push(record);
    await _writeAnnotationRows(rows);
    return { ok: true, id: record.id, created: record.created };
  }

  async function _restoreAnnotation(body) {
    const record = _normalizeAnnotationRecord(body || {});
    const rows = await _readAnnotationRows();
    const index = rows.findIndex(row => row.id === record.id);
    if (index >= 0) rows[index] = record;
    else rows.push(record);
    await _writeAnnotationRows(rows);
    return { ok: true, id: record.id };
  }

  async function _updateAnnotation(annId, body) {
    const rows = await _readAnnotationRows();
    const now = _annotationNow();
    const index = rows.findIndex(row => row.id === annId);
    if (index < 0) return { ok: true, missing: true };
    const next = { ...rows[index], modified: now };
    ANNOTATION_UPDATE_KEYS.forEach(key => {
      if (!Object.prototype.hasOwnProperty.call(body || {}, key)) return;
      if (key === 'data' || key === 'target_ref') next[key] = _annotationDataValue(body[key]);
      else if (key === 'opacity') next[key] = Number.isFinite(Number(body[key])) ? Number(body[key]) : next[key];
      else if (key === 'orphan') next[key] = body[key] ? 1 : 0;
      else if (key === 'target_path') next[key] = _annotationPathKey(body[key]);
      else next[key] = String(body[key] ?? '');
    });
    rows[index] = _normalizeAnnotationRecord(next);
    await _writeAnnotationRows(rows);
    return { ok: true };
  }

  async function _deleteAnnotation(annId) {
    const rows = await _readAnnotationRows();
    await _writeAnnotationRows(rows.filter(row => row.id !== annId));
    return { ok: true };
  }

  function _blobFromDataUrl(dataUrl) {
    const text = String(dataUrl || '');
    const comma = text.indexOf(',');
    if (comma < 0) throw new Error('アップロードデータが空です');
    const meta = text.slice(0, comma);
    const payload = text.slice(comma + 1);
    const mimeMatch = /^data:([^;,]+)/i.exec(meta);
    const mime = mimeMatch ? mimeMatch[1] : 'application/octet-stream';
    if (/;base64/i.test(meta)) {
      const binary = atob(payload);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
      return new Blob([bytes], { type: mime });
    }
    return new Blob([decodeURIComponent(payload)], { type: mime });
  }

  function _blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = event => resolve(String(event.target?.result || reader.result || ''));
      reader.onerror = () => reject(reader.error || new Error('ファイルを読み込めませんでした'));
      reader.readAsDataURL(blob);
    });
  }

  async function _writeBlob(relPath, blob) {
    const handle = await _getFileHandle(relPath, { create: true });
    const writable = await handle.createWritable();
    await writable.write(blob);
    await writable.close();
  }

  NS.readFileAsDataUrl = async function (relPath) {
    const path = String(relPath || '').replace(/\\/g, '/');
    if (_nativeConfig) {
      const response = await fetch('/api/file-raw?path=' + encodeURIComponent(path), { cache: 'no-store' });
      if (!response.ok) throw new Error('ファイルを読み込めませんでした');
      return _blobToDataUrl(await response.blob());
    }
    const handle = await _getFileHandle(path, { create: false });
    return _blobToDataUrl(await handle.getFile());
  };

  // フォルダを再帰的にスキャンしてボードファイルを集める。
  // 戻り値: [{ path, kind: 'board' }, ...]（path は基準位置からの相対パス）
  NS.listBoardFiles = async function () {
    if (_nativeConfig) {
      const payload = await _fetchNativeJson('/board-app/list-boards');
      return Array.isArray(payload?.entries) ? payload.entries : [];
    }
    if (!_rootHandle) return [];
    const results = [];
    async function walk(dir, prefix) {
      for await (const [name, entry] of dir.entries()) {
        if (name.startsWith('.') || name.startsWith('_')) continue;
        const nextPath = prefix ? prefix + '/' + name : name;
        if (entry.kind === 'directory') {
          await walk(entry, nextPath);
        } else if (entry.kind === 'file') {
          if (_isBoardFilename(name)) results.push({ path: nextPath, kind: 'board' });
        }
      }
    }
    await walk(_rootHandle, '');
    results.sort((a, b) => a.path.localeCompare(b.path, 'ja'));
    return results;
  };

  function _isBoardFilename(name) {
    const lower = String(name || '').toLowerCase();
    if (lower.endsWith(BOARD_FILE_EXTENSION)) return true;
    if (lower.endsWith('.board.json')) return true;
    if (lower.endsWith('.canvas.json')) return true;
    if (lower.endsWith('.board.md')) return true;
    return false;
  }

  NS.isBoardFilename = _isBoardFilename;

  // -------------------------------------------------------------------------
  // apiFetch の上書き
  // -------------------------------------------------------------------------
  // 本体は apiFetch('/file?path=...') のように呼ぶ。
  // 本ファイル読み込み後はローカルフォルダから返す。
  function _parsePathQuery(apiPath) {
    // 例: '/file?path=foo%2Fbar.md' から 'foo/bar.md' を取り出す
    const q = String(apiPath || '').split('?')[1] || '';
    const params = new URLSearchParams(q);
    return params.get('path') || '';
  }

  function _matchEndpoint(apiPath, endpoint) {
    const head = String(apiPath || '').split('?')[0];
    return head === endpoint;
  }

  function _endpointHead(apiPath) {
    return String(apiPath || '').split('?')[0];
  }

  function _jsonBody(opts) {
    let body = opts?.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch (e) { body = {}; }
    }
    return body && typeof body === 'object' ? body : {};
  }

  async function _handleNativeApi(apiPath, opts) {
    const method = (opts?.method || 'GET').toUpperCase();
    const res = await fetch('/api' + apiPath, opts || {});
    if (!res.ok) {
      let detail = '';
      try {
        const payload = await res.json();
        detail = payload?.detail || payload?.error || '';
      } catch {}
      throw new Error(detail || ('HTTP ' + res.status));
    }
    return res.json();
  }

  async function _handleLocalApi(apiPath, opts) {
    if (_nativeConfig) return _handleNativeApi(apiPath, opts || {});
    const method = (opts?.method || 'GET').toUpperCase();
    const endpoint = _endpointHead(apiPath);
    // ファイル読み込み・保存
    if (_matchEndpoint(apiPath, '/file')) {
      const filePath = _parsePathQuery(apiPath);
      if (method === 'GET') {
        const content = await _readFileAsText(filePath);
        return { path: filePath, content };
      }
      if (method === 'PUT') {
        const body = _jsonBody(opts);
        if (body?.skip_if_missing && !(await _fileExists(filePath))) {
          return { ok: false, skipped: true, missing: true, path: filePath };
        }
        const content = body && typeof body.content === 'string' ? body.content : '';
        await _writeFileText(filePath, content);
        return { ok: true, path: filePath };
      }
    }
    // リンク先の種別問い合わせ: 拡張子から推測のみ返す
    if (_matchEndpoint(apiPath, '/check-type')) {
      return { type: _inferTypeFromPath(_parsePathQuery(apiPath)) };
    }
    if (_matchEndpoint(apiPath, '/global-index')) {
      return { files: [] };
    }
    if (_matchEndpoint(apiPath, '/smart-db')) {
      return { entities: [], files: [] };
    }
    if (_matchEndpoint(apiPath, '/pivot')) {
      return { entities: {}, properties: {} };
    }
    if (_matchEndpoint(apiPath, '/entity')) {
      return { properties: {} };
    }
    if (_matchEndpoint(apiPath, '/upload-file') && method === 'POST') {
      const body = _jsonBody(opts);
      const parentPath = _parsePathQuery(apiPath);
      const relPath = await _uniqueUploadPath(parentPath, body?.filename || 'file');
      await _writeBlob(relPath, _blobFromDataUrl(body?.data || ''));
      return { ok: true, path: relPath };
    }
    if (_matchEndpoint(apiPath, '/outliner/add') && method === 'POST') {
      const body = _jsonBody(opts);
      const type = String(body?.type || 'board').trim();
      const label = String(body?.label || '無題').trim() || '無題';
      const spec = _linkedFileSpec(type, label);
      const relPath = await _uniqueChildPath(body?.parent || '', label, spec.suffix);
      await _writeFileText(relPath, spec.content);
      return { node: { name: relPath.split('/').pop() || relPath, label, path: relPath, type: spec.type } };
    }
    if (_matchEndpoint(apiPath, '/outliner/delete') && method === 'POST') {
      const body = _jsonBody(opts);
      const relPath = String(body?.path || '');
      if (relPath) {
        try {
          const { parts, filename } = _splitPath(relPath);
          let dir = _rootHandle;
          for (const part of parts) dir = await dir.getDirectoryHandle(part, { create: false });
          if (filename) await dir.removeEntry(filename);
        } catch (e) {}
      }
      return { ok: true, path: relPath };
    }
    if (_matchEndpoint(apiPath, '/annotations') && method === 'GET') {
      return _annotationRowsForQuery(await _readAnnotationRows(), apiPath);
    }
    if (_matchEndpoint(apiPath, '/annotations') && method === 'POST') {
      return _createAnnotation(_jsonBody(opts));
    }
    if (_matchEndpoint(apiPath, '/annotations/restore') && method === 'POST') {
      return _restoreAnnotation(_jsonBody(opts));
    }
    if (endpoint.startsWith('/annotations/') && method === 'PUT') {
      const annId = decodeURIComponent(endpoint.slice('/annotations/'.length));
      return _updateAnnotation(annId, _jsonBody(opts));
    }
    if (endpoint.startsWith('/annotations/') && method === 'DELETE') {
      const annId = decodeURIComponent(endpoint.slice('/annotations/'.length));
      return _deleteAnnotation(annId);
    }
    if (_matchEndpoint(apiPath, '/annotations/orphan-by-target') && method === 'POST') {
      return { ok: true, skipped: true };
    }
    // それ以外の API はサポート外として静かに失敗（呼び出し側が握りつぶす想定）
    throw new Error('このボード画面では未対応の API です: ' + apiPath);
  }

  // ステータス表示は本体 apiFetch のオプションで silentError を受けるので合わせる。
  const _origApiFetch = window.apiFetch;
  window.apiFetch = async function (path, opts) {
    try {
      return await _handleLocalApi(path, opts || {});
    } catch (e) {
      if (!opts?.silentError && typeof window.showStatus === 'function') {
        window.showStatus('エラー: ' + (e?.message || e), true);
      }
      throw e;
    }
  };

  // apiPut / apiPost / apiDelete は meldex-core.js で apiFetch を呼ぶラッパなので、
  // 既存定義をそのまま使えば apiFetch 上書き経由で動く。明示的に再定義はしない。

  // -------------------------------------------------------------------------
  // 元の apiFetch を保管（万一の復元用）。
  NS._origApiFetch = _origApiFetch;
})();
