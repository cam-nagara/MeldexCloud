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
  const _localWriteLocks = new Map();

  // ハンドルを IndexedDB に永続化する用のキー。
  const IDB_NAME = 'board-standalone-fs';
  const IDB_STORE = 'handles';
  const IDB_KEY_ROOT = 'rootHandle';
  const IDB_KEY_ROOT_IDENTITIES = 'rootIdentitiesV1';
  const _sessionRootIdentities = new WeakMap();

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

  function _newRootIdentity() {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    const bytes = new Uint8Array(16);
    globalThis.crypto.getRandomValues(bytes);
    return Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
  }

  async function _sameRootHandle(left, right) {
    if (!left || !right) return false;
    if (left === right) return true;
    let firstError = null;
    if (typeof left.isSameEntry === 'function') {
      try { return await left.isSameEntry(right); }
      catch (error) { firstError = error; }
    }
    if (typeof right.isSameEntry === 'function') {
      try { return await right.isSameEntry(left); }
      catch (error) {
        throw new Error('注釈ルート識別台帳のフォルダを比較できません', {
          cause: error || firstError,
        });
      }
    }
    if (firstError) {
      throw new Error('注釈ルート識別台帳のフォルダを比較できません', {
        cause: firstError,
      });
    }
    return false;
  }

  async function _storedRootIdentity(handle) {
    const stored = await _idbGet(IDB_KEY_ROOT_IDENTITIES);
    if (stored != null && !Array.isArray(stored)) {
      throw new Error('注釈ルート識別台帳の形式が不正です');
    }
    const records = stored || [];
    if (records.some(item => !item?.id || !item?.handle)) {
      throw new Error('注釈ルート識別台帳に不完全なレコードがあります');
    }
    for (const record of records) {
      if (await _sameRootHandle(record.handle, handle)) {
        return { id: String(record.id), records };
      }
    }
    return { id: '', records };
  }

  async function _registerRootIdentity(handle) {
    const current = await _storedRootIdentity(handle);
    if (current.id) return current.id;
    const id = _newRootIdentity();
    current.records.push({ id, handle, created: new Date().toISOString() });
    await _idbSet(IDB_KEY_ROOT_IDENTITIES, current.records);
    return id;
  }

  // File System Access API は絶対パスを公開しないため、許可済みDirectoryHandleと
  // 安定UUIDの対応を、ハンドルの永続化先と同じIndexedDBへ保存する。
  // フォルダ名だけを識別子にしないことで、別ドライブ/別フォルダの同名ルートを
  // 混同しない。注釈側はこの値をさらにSHA-256で不可逆な名前空間へ変換する。
  NS.getRootIdentity = async function () {
    if (!_rootHandle) throw new Error('注釈の保存先ルートが選択されていません');
    if (_nativeConfig || _rootHandle?.native) {
      const root = String(_rootHandle?.root || _nativeConfig?.root || '')
        .replace(/\\/g, '/').replace(/\/+$/, '').toLocaleLowerCase('en-US');
      if (!root) throw new Error('注釈の保存先ルートを識別できません');
      return 'native-root:' + root;
    }
    const cached = _sessionRootIdentities.get(_rootHandle);
    if (cached) return cached;
    const existing = await _storedRootIdentity(_rootHandle);
    if (existing.id) {
      _sessionRootIdentities.set(_rootHandle, existing.id);
      return existing.id;
    }
    // 初回登録だけはorigin全体のWeb Lock内で再読込→登録する。同じ未登録
    // DirectoryHandleを2タブが同時に開いても、後着は先着のUUIDを再利用する。
    // Web Lock無しで別UUIDを発行するより、安全側で保存を止める。
    if (!globalThis.navigator?.locks?.request) {
      throw new Error('このブラウザでは注釈ルートの同時初期化を安全に行えません');
    }
    const handle = _rootHandle;
    const id = await globalThis.navigator.locks.request(
      'meldex-board-root-identity-v1',
      () => _registerRootIdentity(handle),
    );
    _sessionRootIdentities.set(handle, id);
    return id;
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
    const requestBody = {
      content: String(content || ''),
      suggestedName: String(suggestedName || '無題' + BOARD_FILE_EXTENSION),
    };
    const prepared = window.MeldexStableCopyOperationIds?.prepare?.('/board-app/save-as', requestBody)
      || { body: { ...requestBody, operation_id: crypto.randomUUID() }, key: '' };
    try {
      const config = await _fetchNativeJson('/board-app/save-as', {
        method: 'POST',
        body: JSON.stringify(prepared.body),
      });
      window.MeldexStableCopyOperationIds?.complete?.(prepared.key);
      _nativeConfig = config;
      _rootHandle = config.root ? { native: true, root: String(config.root || '') } : null;
      return config;
    } catch (e) {
      if (e?.status === 499) {
        window.MeldexStableCopyOperationIds?.complete?.(prepared.key);
        return null;
      }
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

  async function _allWorkspaceFilePaths() {
    if (!_rootHandle || typeof _rootHandle.entries !== 'function') throw Object.assign(new Error('保存先を走査できません'), { status: 503 });
    const paths = [];
    let entryCount = 0; let pathBytes = 0;
    async function walk(dir, prefix) {
      for await (const [name, entry] of dir.entries()) {
        if (name === '.meldex' || (!prefix && name === '_trash')) continue;
        const path = prefix ? `${prefix}/${name}` : name;
        entryCount += 1; pathBytes += new TextEncoder().encode(path).byteLength;
        if (entryCount > 20000 || pathBytes > 4 * 1024 * 1024) throw Object.assign(new Error('参照影響の走査上限を超えました'), { status: 503 });
        if (entry.kind === 'directory') await walk(entry, path);
        else if (entry.kind === 'file') {
          if (paths.length >= 20000) throw Object.assign(new Error('参照影響の走査件数上限を超えました'), { status: 503 });
          paths.push(path);
        }
      }
    }
    await walk(_rootHandle, '');
    return paths.sort((a, b) => a.localeCompare(b));
  }

  async function _confirmationMetadata(path) {
    const support = window.MeldexBoardStandaloneDeleteSupport;
    if (!support?.confirmationMetadata) throw Object.assign(new Error('削除対象の確認機能を利用できません'), { status: 503 });
    return support.confirmationMetadata({ rootHandle: _rootHandle, path, splitPath: _splitPath });
  }

  async function _confirmationWalkEntries(path, limits = {}) {
    const maxEntries = Number(limits.maxEntries || 20000);
    const maxPathBytes = Number(limits.maxPathBytes || 4 * 1024 * 1024);
    const split = _splitPath(path);
    let parent = _rootHandle;
    for (const part of split.parts) parent = await parent.getDirectoryHandle(part, { create: false });
    const root = await parent.getDirectoryHandle(split.filename, { create: false });
    const rows = []; const stack = [[path, root]]; let pathBytes = 0;
    while (stack.length) {
      const [prefix, directory] = stack.pop();
      for await (const [name, handle] of directory.entries()) {
        const childPath = `${prefix}/${name}`;
        pathBytes += new TextEncoder().encode(childPath).byteLength;
        if (rows.length >= maxEntries || pathBytes > maxPathBytes) throw Object.assign(new Error('削除対象フォルダの確認上限を超えました'), { status: 503 });
        if (handle.kind === 'directory') {
          rows.push({ path: childPath, kind: 'directory', id: `folder:${childPath}`, revision: 'directory', size: 0 });
          stack.push([childPath, handle]);
        } else {
          const file = await handle.getFile();
          rows.push({ path: childPath, kind: 'file', id: `file:${childPath}`,
            revision: `${file.size}:${file.lastModified}`, size: file.size, modifiedMs: file.lastModified });
        }
      }
    }
    return rows;
  }

  async function _confirmationProvider() {
    const rootId = await NS.getRootIdentity();
    if (!rootId || String(rootId).startsWith('native-root:')) {
      throw Object.assign(new Error('ブラウザ保存先の安定IDを確認できません'), { status: 503 });
    }
    const factory = window.MeldexSystemStorageIndexedDB?.createLocalBrowserAdapter;
    if (typeof factory !== 'function') throw Object.assign(new Error('確認tokenのCAS保存先を利用できません'), { status: 503 });
    const adapter = factory({ boundary: `board-root-${rootId}` });
    return {
      getConfirmationActor: async () => `board-owner:${rootId}`,
      statPathFresh: _confirmationMetadata,
      walkEntriesFresh: _confirmationWalkEntries,
      getSystemStorageAdapter: () => adapter,
      resolveConfirmationScope: async () => ({
        adapter, scopeKey: `board-root:${rootId}`,
        toCanonicalPath: value => String(value || '').replace(/^\/+|\/+$/g, ''),
      }),
    };
  }

  async function _localReferenceImpact(items) {
    const scanner = window.MeldexReferenceImpactLiveScan;
    if (!scanner?.query) throw Object.assign(new Error('参照影響の走査機能を利用できません'), { status: 503 });
    return scanner.query({
      items, listFiles: _allWorkspaceFilePaths,
      readTextBounded: async (path, remaining) => {
        const file = await (await _getFileHandle(path, { create: false })).getFile();
        if (file.size > remaining) throw Object.assign(new Error('参照影響の読取上限を超えました'), { status: 503 });
        return file.slice(0, remaining + 1).text();
      },
      statSize: async path => (await (await _getFileHandle(path, { create: false })).getFile()).size,
      isTextLike: scanner.isTextLikePath,
    });
  }

  async function _moveToTrash(relPath, revalidateBeforeRemove) {
    const support = window.MeldexBoardStandaloneDeleteSupport;
    if (!support?.moveToTrash) throw Object.assign(new Error('ゴミ箱機能を利用できません'), { status: 503 });
    return support.moveToTrash({ rootHandle: _rootHandle, path: relPath, splitPath: _splitPath, revalidateBeforeRemove });
  }

  async function _localFileSnapshot(relPath) {
    const handle = await _getFileHandle(relPath, { create: false });
    const file = await handle.getFile();
    const content = await file.text();
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(content));
    const hash = Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
    const etag = `${file.lastModified}:${file.size}:${hash}`;
    const fmt = window.MeldexDocumentIdentity?.formatForPath?.(relPath, content);
    const documentId = fmt
      ? String(window.MeldexDocumentIdentity?.readDocumentId?.(content, fmt) || '')
      : '';
    return {
      content,
      etag,
      transport_revision: { transport: 'local-etag', token: etag },
      ...(documentId ? {
        document_id: documentId,
        document_key: 'document:' + documentId,
      } : {}),
    };
  }

  function _localFileError(status, code, message, detail) {
    const error = new Error(message);
    error.status = status;
    error.code = code;
    error.meldexCode = code;
    error.meldexDetail = detail || null;
    return error;
  }

  function _localTransportEtag(body) {
    const revision = body?.transport_revision || body?.transportRevision || '';
    if (revision && typeof revision === 'object') {
      const transport = String(revision.transport || revision.kind || 'local-etag');
      if (transport !== 'local-etag') {
        throw _localFileError(400, 'transport_mismatch', 'この保存先では別の保存経路のrevisionを使用できません');
      }
      return String(revision.token || revision.revision || revision.etag || '');
    }
    const raw = String(revision || '');
    if (raw.startsWith('local-etag:')) return raw.slice('local-etag:'.length);
    if (raw.startsWith('dropbox-rev:')) {
      throw _localFileError(400, 'transport_mismatch', 'この保存先ではDropboxのrevisionを使用できません');
    }
    return raw;
  }

  async function _withLocalWriteLock(relPath, callback) {
    const lockName = 'meldex-board-file:' + String(relPath || '').replace(/\\/g, '/').toLowerCase();
    if (globalThis.navigator?.locks?.request) return globalThis.navigator.locks.request(lockName, callback);
    const previous = _localWriteLocks.get(lockName) || Promise.resolve();
    const current = previous.catch(() => {}).then(callback);
    _localWriteLocks.set(lockName, current);
    try {
      return await current;
    } finally {
      if (_localWriteLocks.get(lockName) === current) _localWriteLocks.delete(lockName);
    }
  }

  async function _writeFileText(relPath, text, preferredDocumentId, overwrite) {
    let content = String(text || '');
    const docIdentity = window.MeldexDocumentIdentity;
    const fmt = docIdentity?.formatForPath?.(relPath, content);
    if (fmt) {
      content = (overwrite
        ? docIdentity.ensureDocumentIdForOverwrite(content, fmt, preferredDocumentId)
        : docIdentity.ensureDocumentId(content, fmt, preferredDocumentId)).text;
    }
    const handle = await _getFileHandle(relPath, { create: true });
    const writable = await handle.createWritable();
    await writable.write(new Blob([content], { type: 'text/plain;charset=utf-8' }));
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
      schema_version: 3,
      version: 1,
      title: String(title || ''),
      layoutMode: 'manga',
      editor: { wrapMode: true, statusEnabled: false, viewMode: 'horizontal' },
      scenarioTypes: [],
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
    if (normalized === 'smart-db') return { suffix: '.mel-sheet', type: 'smart-db', content: _newSheetJson(label) };
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

  const ANNOTATION_UPDATE_KEYS = [
    'target_path', 'target_id', 'type', 'shape', 'data', 'color', 'opacity', 'user',
    'body', 'target_kind', 'target_ref', 'orphan', 'orphaned_at', 'target_file_name',
  ];
  const _annotationRowBases = new WeakMap();

  function _cloneAnnotationRows(rows) {
    if (typeof structuredClone === 'function') return structuredClone(rows || []);
    return JSON.parse(JSON.stringify(rows || []));
  }

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

  async function _directoryExists(relPath) {
    try {
      const { parts, filename } = _splitPath(relPath);
      let dir = _rootHandle;
      for (const part of [...parts, filename].filter(Boolean)) {
        dir = await dir.getDirectoryHandle(part, { create: false });
      }
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

  async function _uniqueChildDirectory(parentPath, label) {
    const dir = String(parentPath || '').trim().replace(/^[/\\]+/, '').replace(/[/\\]+/g, '/');
    const base = _sanitizeFilename(label || '無題');
    let candidate = dir ? dir + '/' + base : base;
    let index = 2;
    while (await _directoryExists(candidate) || await _fileExists(candidate)) {
      candidate = dir ? dir + '/' + base + '-' + index : base + '-' + index;
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
      ...row,
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

  // 固有形式付随物廃止・管理データ一元化計画 Phase 3: 注釈は対象(targetPath)
  // ごとに解決した document_id をキーに、IndexedDB(共通ストレージ層)へ保存する
  // (board-standalone-annotations.js)。旧 `_meldex/board-annotations.json` は
  // 読取専用フォールバックとしてのみ参照し、二度と書き込まない。
  async function _readAnnotationRows(targetPath) {
    const helper = window.BoardStandaloneAnnotations;
    if (!helper) return [];
    const rows = await helper.readRawRowsForTarget(targetPath, { readFileAsText: _readFileAsText });
    const normalized = rows.map(_normalizeAnnotationRecord);
    _annotationRowBases.set(normalized, {
      normalized: _cloneAnnotationRows(normalized),
      raw: _cloneAnnotationRows(rows),
    });
    return normalized;
  }

  async function _writeAnnotationRows(
    targetPath,
    rows,
    { normalize = true, baseRows: explicitBaseRows } = {},
  ) {
    const bases = _annotationRowBases.get(rows);
    const baseRows = explicitBaseRows || bases?.raw;
    const normalized = (Array.isArray(rows) ? rows : []).map(_normalizeAnnotationRecord);
    let rowsToSave = normalize ? normalized : _cloneAnnotationRows(Array.isArray(rows) ? rows : []);
    if (normalize && bases?.raw && bases?.normalized) {
      const rawById = new Map(bases.raw.map(row => [String(row.id || ''), row]));
      const normalizedById = new Map(bases.normalized.map(row => [String(row.id || ''), row]));
      rowsToSave = normalized.map((row) => {
        const id = String(row.id || '');
        const before = normalizedById.get(id);
        return before && JSON.stringify(before) === JSON.stringify(row) && rawById.has(id)
          ? _cloneAnnotationRows([rawById.get(id)])[0]
          : row;
      });
    }
    const helper = window.BoardStandaloneAnnotations;
    if (helper) {
      await helper.writeRawRowsForTarget(targetPath, rowsToSave, {
        readFileAsText: _readFileAsText,
        writeFileText: _writeFileText,
        fileExists: _fileExists,
        baseRows,
      });
    }
    return normalized;
  }

  async function _findAnnotationTarget(annId) {
    const helper = window.BoardStandaloneAnnotations;
    if (!helper) return null;
    return helper.findTargetForAnnotationId(annId, { readFileAsText: _readFileAsText });
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
    const rows = await _readAnnotationRows(record.target_path);
    rows.push(record);
    await _writeAnnotationRows(record.target_path, rows);
    return { ok: true, id: record.id, created: record.created };
  }

  async function _restoreAnnotation(body) {
    const record = _normalizeAnnotationRecord(body || {});
    const rows = await _readAnnotationRows(record.target_path);
    const index = rows.findIndex(row => row.id === record.id);
    if (index >= 0) rows[index] = record;
    else rows.push(record);
    await _writeAnnotationRows(record.target_path, rows);
    return { ok: true, id: record.id };
  }

  async function _updateAnnotation(annId, body) {
    const oldTarget = await _findAnnotationTarget(annId);
    if (oldTarget == null) return { ok: true, missing: true };
    const rows = await _readAnnotationRows(oldTarget);
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
    const updated = _normalizeAnnotationRecord(next);
    if (updated.target_path !== oldTarget) {
      // 移動先を先に確定し、失敗時に移動元を失わない。
      const newRows = await _readAnnotationRows(updated.target_path);
      const existingIndex = newRows.findIndex(row => row.id === updated.id);
      const destinationBaseRows = _annotationRowBases.get(newRows)?.raw || [];
      const destinationOriginal = existingIndex >= 0
        ? _cloneAnnotationRows([
          destinationBaseRows.find(row => row.id === updated.id) || newRows[existingIndex],
        ])[0]
        : null;
      if (existingIndex >= 0) newRows[existingIndex] = updated;
      else newRows.push(updated);
      await _writeAnnotationRows(updated.target_path, newRows);
      rows.splice(index, 1);
      try {
        await _writeAnnotationRows(oldTarget, rows);
      } catch (error) {
        const rollbackRows = await _readAnnotationRows(updated.target_path);
        const rollbackBaseRows = _annotationRowBases.get(rollbackRows)?.raw || [];
        const rollbackDesiredRows = _cloneAnnotationRows(rollbackBaseRows);
        const rollbackIndex = rollbackDesiredRows.findIndex(row => row.id === updated.id);
        if (rollbackIndex >= 0
            && JSON.stringify(rollbackDesiredRows[rollbackIndex]) === JSON.stringify(updated)) {
          if (destinationOriginal) rollbackDesiredRows[rollbackIndex] = destinationOriginal;
          else rollbackDesiredRows.splice(rollbackIndex, 1);
        }
        await _writeAnnotationRows(
          updated.target_path,
          rollbackDesiredRows,
          { normalize: false, baseRows: rollbackBaseRows },
        );
        throw error;
      }
    } else {
      rows[index] = updated;
      await _writeAnnotationRows(oldTarget, rows);
    }
    return { ok: true };
  }

  async function _deleteAnnotation(annId) {
    const target = await _findAnnotationTarget(annId);
    if (target == null) return { ok: true };
    const rows = await _readAnnotationRows(target);
    // filterは新しいArrayを返すためWeakMap上の読取baseを自動継承しない。
    // 同じ旧状態から別操作が追加保存した直後でも、その追加を削除側の古い
    // 全体配列で上書きしないよう、元配列のbaseを明示的に渡す。
    const baseRows = _annotationRowBases.get(rows)?.raw || [];
    const desiredRows = baseRows.filter(row => row.id !== annId);
    await _writeAnnotationRows(target, desiredRows, { normalize: false, baseRows });
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
      let payload = null;
      try {
        payload = await res.json();
        detail = payload?.detail || payload?.error || '';
      } catch {}
      const message = typeof detail === 'string'
        ? detail
        : (detail?.message || detail?.detail || ('HTTP ' + res.status));
      const error = new Error(message || ('HTTP ' + res.status));
      error.status = res.status;
      error.code = detail?.code || payload?.code || '';
      error.meldexCode = error.code;
      error.meldexDetail = detail && typeof detail === 'object' ? detail : null;
      throw error;
    }
    return res.json();
  }

  async function _handleLocalApi(apiPath, opts) {
    if (_nativeConfig) return _handleNativeApi(apiPath, opts || {});
    const method = (opts?.method || 'GET').toUpperCase();
      const endpoint = _endpointHead(apiPath);
    if (_matchEndpoint(apiPath, '/references/delete-impact') && method === 'POST') {
      const body = _jsonBody(opts);
      const provider = await _confirmationProvider();
      const gate = window.MeldexCloudDeleteConfirmation;
      if (!gate?.prepareProviderDelete) throw Object.assign(new Error('削除確認機能を利用できません'), { status: 503 });
      return gate.prepareProviderDelete({
        provider, items: Array.isArray(body?.items) ? body.items : [], operation: body?.operation,
        queryImpact: (_provider, items) => _localReferenceImpact(items),
      });
    }
    // ファイル読み込み・保存
    if (_matchEndpoint(apiPath, '/file')) {
      const filePath = _parsePathQuery(apiPath);
      if (method === 'GET') {
        const snapshot = await _localFileSnapshot(filePath);
        const metadataOnly = new URL('http://standalone.local' + apiPath).searchParams.get('metadata_only');
        return {
          path: filePath,
          ...snapshot,
          ...(metadataOnly === '1' || metadataOnly === 'true' ? { content: undefined } : {}),
        };
      }
      if (method === 'PUT') {
        const body = _jsonBody(opts);
        const content = body && typeof body.content === 'string' ? body.content : '';
        return _withLocalWriteLock(filePath, async () => {
          const exists = await _fileExists(filePath);
          if ((body?.skip_if_missing || body?.skipIfMissing) && !exists) {
            return { ok: false, skipped: true, missing: true, path: filePath };
          }
          const current = exists ? await _localFileSnapshot(filePath) : null;
          const explicit = String(body?.if_match_etag || body?.ifMatchEtag || '');
          const transportEtag = _localTransportEtag(body);
          if (explicit && transportEtag && explicit !== transportEtag) {
            throw _localFileError(400, 'revision_field_mismatch', 'if_match_etagとtransport_revisionが一致しません');
          }
          const expected = explicit || transportEtag;
          const force = !!(body?.force_overwrite || body?.forceOverwrite);
          const createOnly = !!(body?.create_only || body?.createOnly);
          if (createOnly && exists) {
            throw _localFileError(409, 'etag_conflict', '同じ名前のファイルが既にあります', {
              path: filePath, expected_etag: '', current_etag: current?.etag || '',
            });
          }
          if (!force && expected && expected !== (current?.etag || '')) {
            throw _localFileError(409, 'etag_conflict', '別の画面またはアプリで更新されたため、上書きを中止しました', {
              path: filePath, expected_etag: expected, current_etag: current?.etag || '',
            });
          }
          if (exists && !expected && !force) {
            throw _localFileError(428, 'precondition_required', '既存ファイルを更新するには読込時のrevisionが必要です');
          }
          await _writeFileText(filePath, content, current?.document_id || '', exists);
          const saved = await _localFileSnapshot(filePath);
          return { ok: true, path: filePath, ...saved, content: undefined };
        });
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
      if (['database', 'sheet', 'pivot'].includes(type.toLowerCase())) {
        const relPath = await _uniqueChildDirectory(body?.parent || '', label);
        const folderName = relPath.split('/').pop() || label;
        await _writeFileText(relPath + '/' + folderName + '.md', ''
          + '---\n'
          + 'type: settings-db\n'
          + 'schema_version: 1\n'
          + 'storage: sqlite\n'
          + 'cloud_storage: sheet-store-v1\n'
          + '---\n'
          + '# ' + folderName + '\n\n');
        return { node: { name: folderName, label: folderName, path: relPath, type: 'database' } };
      }
      const spec = _linkedFileSpec(type, label);
      const relPath = await _uniqueChildPath(body?.parent || '', label, spec.suffix);
      await _writeFileText(relPath, spec.content);
      return { node: { name: relPath.split('/').pop() || relPath, label, path: relPath, type: spec.type } };
    }
    if (_matchEndpoint(apiPath, '/outliner/delete') && method === 'POST') {
      const body = _jsonBody(opts);
      const relPath = String(body?.path || '');
      if (!relPath) throw new Error('path は必須です');
      const kind = await _directoryExists(relPath) ? 'folder' : 'file';
      if (body?.kind && body.kind !== kind) throw Object.assign(new Error('削除対象の種類が変更されました'), { status: 409 });
      const provider = await _confirmationProvider();
      const gate = window.MeldexCloudDeleteConfirmation;
      if (!gate?.consumeProviderDelete) throw Object.assign(new Error('削除確認機能を利用できません'), { status: 503 });
      const consumed = await gate.consumeProviderDelete({
        provider, items: [{ path: relPath, kind }], operation: 'trash',
        confirmations: body?.confirmations,
        confirmationToken: body?.confirmationToken || body?.confirmation_token,
        graphRevision: body?.graphRevision || body?.graph_revision,
        queryImpact: (_provider, items) => _localReferenceImpact(items),
      });
      const revalidate = () => gate.revalidateProviderDelete({
        provider, receipt: consumed.receipt,
        queryImpact: (_provider, items) => _localReferenceImpact(items),
      });
      await revalidate();
      const trashName = await _moveToTrash(relPath, revalidate);
      return { ok: true, path: relPath, trash_name: trashName };
    }
    if (_matchEndpoint(apiPath, '/annotations') && method === 'GET') {
      const params = _annotationQuery(apiPath);
      let target = _annotationPathKey(params.get('target') || '');
      if (!target) {
        const annId = params.get('ann_id') || '';
        if (annId) target = (await _findAnnotationTarget(annId)) || '';
      }
      const rows = target ? await _readAnnotationRows(target) : [];
      return _annotationRowsForQuery(rows, apiPath);
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
  function _isNativeHostApi(path) {
    if (!NS.isNativeMode?.()) return false;
    const endpoint = String(path || '').split('?')[0].replace(/^\/api(?=\/)/, '');
    return endpoint === '/file-meta'
      || endpoint === '/standalone/open-target'
      || endpoint === '/standalone/open-target/capabilities';
  }
  window.apiFetch = async function (path, opts) {
    try {
      // Windows単独版のランタイムが持つ読取・許可リスト起動APIは、
      // File System Access API用のローカル互換層で遮断せず元のHTTP経路へ渡す。
      if (_isNativeHostApi(path) && typeof _origApiFetch === 'function') {
        return await _origApiFetch(path, opts || {});
      }
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
  // 固有形式付随物廃止・管理データ一元化計画 Phase 5: 既存付随物の安全な自動移行。
  // 実際の検出・コピー・照合・退避・削除・清掃のオーケストレーションは
  // gb-sidecar-migration.js が担う。ここではFile System Access APIハンドルへの
  // 削除・空判定アクセスだけを提供する薄いブリッジ。
  // native mode(exe版、MeldexBoard.py 経由)は系統B として Python側
  // (app/meldex_sidecar_migration.py)が別途処理するため、ここでは対象外。
  // -------------------------------------------------------------------------
  NS.runSidecarMigrationIfSupported = async function () {
    if (NS.isNativeMode() || !_rootHandle || typeof _rootHandle.getDirectoryHandle !== 'function') return null;
    const migration = window.MeldexSidecarMigration;
    if (!migration || typeof migration.migrateStandaloneBoardAnnotations !== 'function') return null;
    return migration.migrateStandaloneBoardAnnotations({
      readFileAsText: _readFileAsText,
      writeFileText: _writeFileText,
      fileExists: _fileExists,
      deleteFile: async (relPath) => {
        const { parts, filename } = _splitPath(relPath);
        let dir = _rootHandle;
        for (const part of parts) dir = await dir.getDirectoryHandle(part, { create: false });
        if (filename) await dir.removeEntry(filename);
      },
      directoryIsEmpty: async (relPath) => {
        try {
          const { parts, filename } = _splitPath(relPath);
          let dir = _rootHandle;
          for (const part of [...parts, filename].filter(Boolean)) dir = await dir.getDirectoryHandle(part, { create: false });
          // eslint-disable-next-line no-unreachable-loop
          for await (const _entry of dir.entries()) return false;
          return true;
        } catch {
          // 読込不能を「空」とみなすと、権限・I/O障害時に削除へ進み得る。
          return false;
        }
      },
      removeEmptyDirectory: async (relPath) => {
        const { parts, filename } = _splitPath(relPath);
        const segments = [...parts, filename].filter(Boolean);
        const target = segments.pop();
        let dir = _rootHandle;
        for (const part of segments) dir = await dir.getDirectoryHandle(part, { create: false });
        if (target) await dir.removeEntry(target);
      },
    });
  };

  // フェーズB徹底チェック(c): 移行バックアップ・競合バックアップの30日保持
  // (計画書§6.3)が実質無期限だった問題への対応。上の runSidecarMigrationIfSupported
  // と同じタイミング方針(root確定時に1回、ユーザー操作をブロックしない、
  // 失敗は握りつぶす)で、期限超過分の掃除を行う。native mode(exe版)は
  // MeldexBoard.py 側(app/MeldexBoard.py の _run_system_storage_retention_
  // cleanup_background)が別途処理するため、ここでは対象外。
  NS.runRetentionCleanupIfSupported = async function () {
    if (NS.isNativeMode()) return null;
    const migration = window.MeldexSidecarMigration;
    if (!migration || typeof migration.runStandaloneRetentionCleanup !== 'function') return null;
    return migration.runStandaloneRetentionCleanup();
  };

  // -------------------------------------------------------------------------
  // 元の apiFetch を保管（万一の復元用）。
  NS._origApiFetch = _origApiFetch;
})();
