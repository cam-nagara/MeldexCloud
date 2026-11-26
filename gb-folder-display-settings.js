/* フォルダパネルの表示形式・表示設定をフォルダごとに覚える（2026-11-22）。

   - 保存先はフォルダのアイコンと同じ「フォルダ自身のノートの設定欄」（folder_display）。
     本体は /api/folder-display、Cloud版は下の拡張が同じ形の要求を Dropbox 上のノートへ読み書きする。
   - 保存の無いフォルダは、この端末で最後に使っていた全体の値（旧 localStorage の
     folder-layout / folder-display-config / folder-thumbnail-size-px）を初期値として表示する。
     フォルダで変えた値はそのフォルダにだけ保存し、全体の値は書き換えない（自動リンクのファイルごと化と同じ）。
   - 閲覧専用・編集ロック中など保存できないフォルダでは、変えた値をこの画面を閉じるまでだけ使う。
   - フィルタ・検索の条件はフォルダごとにしない（従来どおり端末内の全体の値）。 */
(function (global) {
  'use strict';
  const LAYOUTS = ['grid', 'waterfall', 'hflow', 'list', 'list-small'];
  const BOOL_KEYS = ['showThumb', 'showName', 'showSize', 'showDate', 'showType', 'showDimensions', 'showRating', 'showTags'];
  const DISPLAY_KEYS = BOOL_KEYS.concat(['tagDisplayLimit']);
  const DISPLAY_DEFAULTS = { showName: true, showDate: true, showType: true, showSize: false,
    showDimensions: false, showRating: false, showTags: false };
  const FIELD = 'folder_display';
  const cache = new Map();          // key -> { settings, etag, sessionOnly }
  const loading = new Map();        // key -> Promise
  let current = { path: '', key: '' };
  let saveTimer = 0;
  let saveChain = Promise.resolve();

  function scopeToken() {
    try { return global.MeldexFileIcons?.scope?.() || ''; } catch { return ''; }
  }
  function key(path) {
    return scopeToken() + '\n' + String(path || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  }
  function readJson(name, fallback) {
    try { const raw = localStorage.getItem(name); return raw ? JSON.parse(raw) : fallback; } catch { return fallback; }
  }
  function clampPx(value) {
    const px = Math.round(Number(value));
    return Number.isFinite(px) ? Math.max(48, Math.min(1000, px)) : 120;
  }

  // 保存の無いフォルダの初期値（この端末で最後に使っていた全体の値）。読むだけで書き換えない。
  function globalDefaults() {
    let layout = 'waterfall';
    try { layout = localStorage.getItem('folder-layout') || 'waterfall'; } catch {}
    if (!LAYOUTS.includes(layout)) layout = 'waterfall';
    let px = NaN;
    try { px = parseInt(localStorage.getItem('folder-thumbnail-size-px') || '', 10); } catch {}
    if (!Number.isFinite(px)) {
      let zoom = NaN;
      try { zoom = parseFloat(localStorage.getItem('folder-zoom') || ''); } catch {}
      px = Number.isFinite(zoom) ? zoom * 120 : 120;
    }
    const stored = readJson('folder-display-config', {}) || {};
    const display = { ...DISPLAY_DEFAULTS };
    DISPLAY_KEYS.forEach(name => { if (Object.prototype.hasOwnProperty.call(stored, name)) display[name] = stored[name]; });
    return { layout, thumbnailPx: clampPx(px), display };
  }

  function sanitize(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const result = {};
    if (LAYOUTS.includes(raw.layout)) result.layout = raw.layout;
    if (Number.isFinite(Number(raw.thumbnailPx)) && raw.thumbnailPx !== null && typeof raw.thumbnailPx !== 'boolean') {
      result.thumbnailPx = clampPx(raw.thumbnailPx);
    }
    if (raw.display && typeof raw.display === 'object') {
      const display = {};
      BOOL_KEYS.forEach(name => { if (typeof raw.display[name] === 'boolean') display[name] = raw.display[name]; });
      const limit = Number(raw.display.tagDisplayLimit);
      if (Number.isInteger(limit) && limit >= 1 && limit <= 999) display.tagDisplayLimit = limit;
      result.display = display;
    }
    return result;
  }

  function effective(path) {
    const base = globalDefaults();
    const saved = cache.get(key(path))?.settings || null;
    if (!saved) return base;
    return {
      layout: saved.layout || base.layout,
      thumbnailPx: saved.thumbnailPx || base.thumbnailPx,
      display: { ...base.display, ...(saved.display || {}) },
    };
  }

  function hasSaved(path) { return !!cache.get(key(path))?.settings; }

  async function load(path) {
    const id = key(path);
    if (!path) return null;
    if (cache.has(id)) return cache.get(id).settings;
    if (loading.has(id)) return loading.get(id);
    if (typeof apiFetch !== 'function') return null;
    const promise = apiFetch('/folder-display?path=' + encodeURIComponent(path), { silentError: true })
      .then(data => {
        if (!cache.has(id) || !cache.get(id).dirty) {
          cache.set(id, { settings: sanitize(data?.settings), etag: String(data?.etag || ''), sessionOnly: false });
        }
        return cache.get(id).settings;
      })
      .catch(() => {
        // 読めないフォルダ（閲覧不可・Cloud未接続等）は保存なしとして初期値で表示する。
        if (!cache.has(id)) cache.set(id, { settings: null, etag: '', sessionOnly: true });
        return null;
      })
      .finally(() => loading.delete(id));
    loading.set(id, promise);
    return promise;
  }

  // 現在のフォルダの値をフォルダパネルの状態へ反映する（描画はしない）。
  function applyToPanel(path) {
    const value = effective(path);
    try { if (typeof _folderLayout !== 'undefined') _folderLayout = value.layout; } catch {}
    try { if (typeof _folderZoom !== 'undefined') _folderZoom = value.thumbnailPx / 120; } catch {}
    // サブパネルなど独立した面をつないでいる間は、メインのフォルダパネルの表示形式の切替には触らない。
    let independent = false;
    try { independent = typeof _folderIsIndependentSurface === 'function' && _folderIsIndependentSurface(); } catch {}
    if (independent) return value;
    const select = document.getElementById('folder-layout-select');
    if (select) select.value = value.layout;
    global.syncFolderLayoutControl?.();
    global.MeldexCloudMobileExplorer?.syncLayoutFromFolder?.(value.layout);
    return value;
  }

  // フォルダを開く時に呼ぶ。保存済みの値を読み、読めた時点でまだそのフォルダなら状態へ反映する。
  async function activate(path, options = {}) {
    current = { path: path || '', key: key(path) };
    if (!path) return applyToPanel('');
    await load(path);
    if (typeof options.isCurrent === 'function' && !options.isCurrent()) return null;
    if (current.key !== key(path)) return null;
    return applyToPanel(path);
  }

  // 面（メイン／サブパネル）のつなぎ替えで、現在のフォルダだけを合わせる（読み込み・画面への反映はしない）。
  function bind(path) { current = { path: path || '', key: key(path) }; }

  function currentPath() { return current.path; }

  function displayConfig() { return effective(current.path).display; }

  function update(patch) {
    const path = current.path;
    if (!path) return false;
    const id = key(path);
    const next = effective(path);
    if (patch.layout && LAYOUTS.includes(patch.layout)) next.layout = patch.layout;
    if (patch.thumbnailPx !== undefined) next.thumbnailPx = clampPx(patch.thumbnailPx);
    if (patch.display) next.display = { ...next.display, ...sanitize({ display: patch.display }).display };
    const entry = cache.get(id) || { settings: null, etag: '', sessionOnly: false };
    entry.settings = sanitize(next);
    entry.dirty = true;
    entry.rev = (entry.rev || 0) + 1;
    cache.set(id, entry);
    scheduleSave(path, entry);
    return true;
  }

  // 保存する記録は変更した時点のものを持ち回る（起動直後は保存先の識別が変わることがあり、
  // 後で鍵を引き直すと別の記録を見て黙って保存しなかった）。
  let pendingSave = null;
  function scheduleSave(path, entry) {
    clearTimeout(saveTimer);
    if (pendingSave && pendingSave.entry !== entry) {
      const previous = pendingSave;
      saveChain = saveChain.then(() => save(previous.path, previous.entry)).catch(() => {});
    }
    pendingSave = { path, entry };
    saveTimer = setTimeout(() => { saveTimer = 0; flush(); }, 250);
  }

  function flush() {
    clearTimeout(saveTimer);
    saveTimer = 0;
    const job = pendingSave;
    pendingSave = null;
    if (job) saveChain = saveChain.then(() => save(job.path, job.entry)).catch(() => {});
    return saveChain;
  }

  async function save(path, entry) {
    if (!entry || !entry.dirty || typeof apiFetch !== 'function') return;
    // 送った後に変わった値は、この保存の完了で「保存済み」にしない（続けて変えた設定が消えていた）。
    const sentRev = entry.rev || 0;
    const body = () => JSON.stringify({ path, settings: entry.settings, if_match_etag: entry.etag || '' });
    const put = () => apiFetch('/folder-display', { method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: body(), silentError: true });
    try {
      let result;
      try {
        result = await put();
      } catch (error) {
        if (error?.status !== 409 || error?.payload?.detail?.code === 'folder_display_unsupported') throw error;
        // 他の保存で版が進んでいた。表示の好みは最後の操作を優先し、最新の版で1回だけ保存し直す。
        const fresh = await apiFetch('/folder-display?path=' + encodeURIComponent(path), { silentError: true });
        entry.etag = String(fresh?.etag || '');
        result = await put();
      }
      const previous = entry.etag;
      entry.etag = String(result?.etag || '');
      if ((entry.rev || 0) === sentRev) entry.dirty = false;
      entry.sessionOnly = false;
      global.MeldexFileIcons?.adoptRevision?.(folderNotePath(path), previous, entry.etag);
    } catch (error) {
      if ((entry.rev || 0) === sentRev) entry.dirty = false;
      if (!entry.sessionOnly && typeof showStatus === 'function') {
        showStatus('このフォルダには表示設定を保存できません。画面を閉じるまでだけ使います: '
          + (error?.userMessage || error?.message || error), true);
      }
      entry.sessionOnly = true;
    }
  }

  function folderNotePath(path) {
    const normalized = String(path || '').replace(/\\/g, '/').replace(/\/+$/, '');
    const name = normalized.split('/').pop() || normalized;
    return normalized + '/' + name + '.md';
  }

  // 保存ファイルを開き直した等で、次に開いた時に読み直す。
  function forget(path) { if (path) cache.delete(key(path)); else cache.clear(); }

  global.MeldexFolderDisplaySettings = {
    DISPLAY_KEYS, LAYOUTS, activate, bind, load, update, flush, effective, hasSaved, displayConfig,
    currentPath, globalDefaults, forget, sanitize,
  };

  // ---- Cloud版（Dropbox）: /folder-display を同じ形で処理する ----
  const LINE = new RegExp('^' + FIELD + ':[^\\r\\n]*(?:\\r?\\n[ \\t]+[^\\r\\n]*)*\\r?\\n?', 'm');
  const HEADER = /^﻿?---\r?\n(?:([\s\S]*?)\r?\n)?---(?:\r?\n|$)/;
  function readField(text) {
    const match = String(text || '').match(HEADER);
    if (!match && /^﻿?---(?:\r?\n|$)/.test(String(text || ''))) throw new Error('フォルダの設定欄を読み取れません');
    const lines = [...(match?.[1] || '').matchAll(new RegExp('^' + FIELD + ': *([^\\r\\n]*)$', 'gm'))];
    if (lines.length > 1) throw new Error('フォルダの表示設定が重複しています');
    if (!lines.length) return null;
    try { return sanitize(JSON.parse(lines[0][1])); } catch { return null; }
  }
  function readMeta(text) {
    const match = String(text || '').match(HEADER);
    const raw = match?.[1] || '';
    const type = (raw.match(/^type: *["']?([A-Za-z-]+)/m) || [])[1] || '';
    return { type, hasColumns: /^property_types:/m.test(raw), hasRows: /^rows:/m.test(raw) };
  }
  function writeField(text, settings, metadataOnly) {
    const source = String(text || '');
    const match = source.match(HEADER);
    let raw = (match?.[1] || '').replace(LINE, '').replace(/[\r\n]+$/, '');
    if (metadataOnly && !/^file_icon_metadata_only:/m.test(raw)) raw = 'file_icon_metadata_only: true' + (raw ? '\n' + raw : '');
    raw += (raw ? '\n' : '') + FIELD + ': ' + JSON.stringify(settings).replace(/,"/g, ', "').replace(/":/g, '": ');
    return '---\n' + raw + '\n---\n' + (match ? source.slice(match[0].length) : source);
  }
  // フォルダのノートを、表示設定を知らない画面が古い内容のまま保存しても消さない（アイコンと同じ扱い）。
  // 保存する中身に folder_display があればその値を使い、項目そのものが無い時だけ前の値を戻す。
  function isFolderNote(path) {
    const parts = String(path || '').replace(/\\/g, '/').split('/').filter(Boolean);
    return parts.length >= 2 && /\.md$/i.test(parts[parts.length - 1]) && parts[parts.length - 1] === parts[parts.length - 2] + '.md';
  }
  function preserve(newText, oldText, path) {
    if (!isFolderNote(path) || !String(oldText || '').includes(FIELD + ':')) return newText;
    let previous = null;
    try { previous = readField(oldText); } catch { return newText; }
    if (!previous) return newText;
    const source = String(newText || '');
    if (/^\uFEFF?---(?:\r?\n|$)/.test(source) && !HEADER.test(source)) return newText;
    const header = source.match(HEADER)?.[1] || '';
    if (new RegExp('^' + FIELD + ':', 'm').test(header)) return newText;
    return writeField(source, previous, false);
  }
  global.MeldexFolderDisplaySettings.preserve = preserve;
  const UNSUPPORTED = new Set(['database', 'pivot', 'tree', 'gallery', 'kanban', 'timeline', 'chart', 'graph',
    'board', 'calendar', 'scenario', 'scriptnote', 'timer', 'form-app', 'map', 'chat']);
  const extensions = global.__MeldexPwaDataAccessExtensions;
  if (Array.isArray(extensions)) extensions.push(async ({ pathname, method, url, body }) => {
    const internals = global.__MeldexPwaDataAccessInternals;
    if (pathname !== '/folder-display' || !['GET', 'PUT'].includes(method)) return internals?.NOT_HANDLED;
    const provider = await internals._requirePwaProvider(method === 'PUT' ? 'readwrite' : 'read');
    const token = scopeToken();
    const requireScope = () => {
      if (global.MeldexFileIcons?.matchesScope && !global.MeldexFileIcons.matchesScope(token, provider)) {
        throw new Error('保存先が変わりました。フォルダを開き直してください');
      }
    };
    const path = internals._normalizeFolderPath(method === 'PUT' ? body?.path : url.searchParams.get('path'));
    if (!path) throw new Error('path は必須です');
    const entry = await internals._resolveEntryHandle(provider, path);
    if (!entry) throw new Error('フォルダが見つかりません');
    if (entry.kind !== 'directory') throw new Error('フォルダではありません');
    const note = internals._joinPath(path, internals._basename(path) + '.md');
    const noteExists = !!await internals._resolveEntryHandle(provider, note);
    requireScope();
    const loaded = noteExists ? await global.MeldexDataAccess.requestJson('/file?path=' + encodeURIComponent(note)) : { content: '', etag: '' };
    requireScope();
    if (method === 'GET') return { ok: true, path, settings: readField(loaded.content), etag: loaded.etag || '' };
    if (!Object.prototype.hasOwnProperty.call(body || {}, 'if_match_etag')) throw new Error('再読込してから変更してください');
    if ((body.if_match_etag || '') !== (loaded.etag || '')) {
      const error = new Error('他の編集が保存されています');
      error.status = 409;
      error.payload = { detail: { code: 'folder_display_conflict', etag: loaded.etag || '' } };
      throw error;
    }
    const meta = readMeta(loaded.content);
    if (UNSUPPORTED.has(meta.type) || meta.hasColumns || meta.hasRows) {
      const error = new Error('このフォルダには表示設定を保存できません');
      error.status = 409;
      error.payload = { detail: { code: 'folder_display_unsupported' } };
      throw error;
    }
    const settings = sanitize(body.settings) || {};
    const content = writeField(loaded.content, settings, !noteExists);
    const saved = await global.MeldexDataAccess.requestJson('/file?path=' + encodeURIComponent(note), {
      method: 'PUT',
      body: { content, if_match_etag: loaded.etag || '', create_only: !noteExists, _file_icon_write: true, _file_icon_scope: token },
    });
    return { ...saved, ok: true, settings };
  });
})(window);
