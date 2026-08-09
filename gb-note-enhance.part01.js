/* ==============================
   gb-note-enhance.js: ノートエディタ機能拡張
   - ファイル個別テーマ
   - スラッシュコマンド
   - ブロックドラッグハンドル
   - 見出しインデント表示
   依存: gb-editor.js, meldex-core.js
   ============================== */

// ============================================================
// 1. ファイルスタイル（旧: ファイル個別テーマ）
// ============================================================
// v0.5.125+: 「テーマ」→「ファイルスタイル」に再編。フロントマターキーも theme:→style: に移行。
// 旧 localStorage キー `file-theme-presets` は初回起動時に `file-style-presets` へマイグレート。
const _FILE_STYLE_PRESETS_KEY = 'file-style-presets';
const _FILE_STYLE_DEFAULT_KEY = 'file-style-default';
const _FILE_STYLE_THEME_ID_KEY = '__themeId';
const _FILE_STYLE_USE_OS_ACCENT_KEY = '__useOsAccentColor';
const _FILE_STYLE_LOCAL_CUSTOM_THEME_ID = '__fileCustomTheme';
const _FILE_STYLE_LOCAL_CUSTOM_THEME_NAME_KEY = '__themeName';
const _FILE_STYLE_LOCAL_CUSTOM_THEME_SOURCE_KEY = '__themeSourceId';
const _FOLDER_FILE_STYLE_KEY = 'file-style-folder-overrides';
const _FILE_STYLE_CONTEXTS = ['folder', 'page', 'db', 'board', 'scriptnote'];
const _DB_FILE_STYLE_VIEWS = new Set(['pivot', 'tree', 'gallery', 'kanban', 'timeline', 'chart', 'graph', 'calendar', 'tasks', 'shifts', 'entity', 'smart-db']);
const _SCRIPTNOTE_BUILTIN_STYLE_PRESETS = [
  { name: 'デフォルト', style: {}, context: 'scriptnote' },
];
const _SCRIPTNOTE_REMOVED_FILE_STYLE_KEYS = ['pageBgColor'];
const _SCRIPTNOTE_FILE_STYLE_KEYS = MeldexScriptnoteFileStyleContract.keys;
const _SCRIPTNOTE_FILE_STYLE_DEFAULTS = MeldexScriptnoteFileStyleContract.defaults;
const _BUILTIN_STYLE_PRESETS = [
  { name: 'デフォルト', style: {} },
  { name: 'セピア', style: { '--bg': '#f5f0e8', '--fg': '#3c3836', '--bg2': '#ede5d8', '--bg3': '#ddd5c8', '--border': '#c8bfb0', '--accent': '#8f6b32' } },
  { name: 'ダークブルー', style: { '--bg': '#1a1a2e', '--fg': '#e0e0e0', '--bg2': '#16213e', '--bg3': '#0f3460', '--border': '#2a3a5e', '--accent': '#569cd6' } },
  { name: 'ペーパー', style: { '--bg': '#ffffff', '--fg': '#333333', '--bg2': '#f5f5f5', '--bg3': '#eeeeee', '--border': '#dddddd', '--accent': '#1a73e8' } },
];

// ファイルスタイル → 対象パネル要素に適用（そのパネルのみ）
// --page-* / --db-* / --sn2-* すべての CSS 変数を受理する
const _FILE_STYLE_PANELS = ['folder-view', 'page-content', 'db-view-container', 'bd-canvas'];
function _cloneFileStyleObject(style) {
  if (!style || typeof style !== 'object' || Array.isArray(style)) return {};
  return JSON.parse(JSON.stringify(style));
}
function _fileStylePersistableKey(key) {
  const value = String(key || '').trim();
  return value.startsWith('--') || /^__[A-Za-z0-9_-]+$/.test(value);
}
function _fileStyleYamlQuote(value) {
  return JSON.stringify(String(value == null ? '' : value));
}
function _fileStyleYamlScalar(raw) {
  const value = String(raw == null ? '' : raw).trim();
  if (!value) return '';
  if (value.startsWith('"') && value.endsWith('"')) {
    try { return JSON.parse(value); } catch {}
    return value.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }
  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1).replace(/''/g, "'");
  return value;
}
function _fileStyleBlockRegex() {
  return /style:\s*\n(?:\s+(?:--[\w-]+|__[A-Za-z0-9_-]+):[^\n]*\n?)*/m;
}
function _fileStyleToYaml(style) {
  if (!style || typeof style !== 'object' || Array.isArray(style) || Object.keys(style).length === 0) return '';
  let styleYaml = 'style:\n';
  for (const [k, v] of Object.entries(style)) {
    if (!_fileStylePersistableKey(k) || v === undefined || v === null || v === '') continue;
    styleYaml += `  ${k}: ${_fileStyleYamlQuote(v)}\n`;
  }
  return styleYaml === 'style:\n' ? '' : styleYaml;
}
function _folderFileStyleStorageId(path) {
  const raw = String(path || '').trim();
  if (!raw) return '';
  try {
    if (typeof _pathToFileId === 'function') return _pathToFileId(raw) || raw;
  } catch {}
  return raw;
}
function _readFolderFileStyleStore() {
  try {
    const parsed = JSON.parse(localStorage.getItem(_FOLDER_FILE_STYLE_KEY) || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}
function _writeFolderFileStyleStore(store) {
  const next = store && typeof store === 'object' && !Array.isArray(store) ? store : {};
  if (Object.keys(next).length > 0) localStorage.setItem(_FOLDER_FILE_STYLE_KEY, JSON.stringify(next));
  else localStorage.removeItem(_FOLDER_FILE_STYLE_KEY);
}
function _getFolderFileStyle(path) {
  const id = _folderFileStyleStorageId(path || (typeof _folderPath !== 'undefined' ? _folderPath : ''));
  if (!id) return {};
  const store = _readFolderFileStyleStore();
  return _cloneFileStyleObject(store[id] || {});
}
function _saveFolderFileStyle(style, path) {
  const id = _folderFileStyleStorageId(path || (typeof _folderPath !== 'undefined' ? _folderPath : ''));
  if (!id) return;
  const store = _readFolderFileStyleStore();
  if (style && Object.keys(style).length > 0) store[id] = _cloneFileStyleObject(style);
  else delete store[id];
  _writeFolderFileStyleStore(store);
}

function applyFolderFileStyle(path) {
  const style = _getFolderFileStyle(path);
  if (style && Object.keys(style).length > 0) applyFileStyleToPanel(style, 'folder-view');
}

function _isDbFileStyleView(view) {
  return _DB_FILE_STYLE_VIEWS.has(view || '');
}

function _getCurrentFileStyleContext() {
  const activeTab = (typeof GBTabs !== 'undefined' && typeof GBLayout !== 'undefined')
    ? GBTabs.getActiveTab(GBLayout.activePane)
    : null;
  if (activeTab?.type === 'scriptnote') return 'scriptnote';
  const view = state?.view || '';
  if (view === 'folder') return 'folder';
  if (view === 'page') return 'page';
  if (view === 'board') return 'board';
  if (_isDbFileStyleView(view)) return 'db';
  return null;
}

function _getScriptNoteEditorForFileStyle() {
  const comp = (typeof getActiveScriptNoteComponent === 'function') ? getActiveScriptNoteComponent() : null;
  return comp?._editor?.doc ? comp._editor : null;
}

const _filterScriptnoteFileStyle = MeldexScriptnoteFileStyleContract.filter;
const _isScriptnoteFileStyleKey = MeldexScriptnoteFileStyleContract.isKey;

function _normalizeFileStyleDefaultStore(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const looksScoped = _FILE_STYLE_CONTEXTS.some(ctx => raw[ctx] && typeof raw[ctx] === 'object' && !Array.isArray(raw[ctx]));
  if (looksScoped) return raw;
  return Object.keys(raw).length ? { page: raw } : {};
}

function _refreshCurrentFileStyleUi(ctx) {
  if (ctx !== 'scriptnote') return;
  const comp = (typeof getActiveScriptNoteComponent === 'function') ? getActiveScriptNoteComponent() : null;
  if (!comp?._editor) return;
  if (comp._editor._detailActiveTab === 'style' && typeof comp._syncDetailPanel === 'function') {
    comp._syncDetailPanel();
  } else if (typeof comp._editor._render === 'function') {
    comp._editor._render();
  }
}

// 旧 localStorage キーを新キーに 1 度だけマイグレート
(function _migrateFileThemePresets() {
  try {
    if (localStorage.getItem(_FILE_STYLE_PRESETS_KEY) !== null) return;
    const legacy = localStorage.getItem('file-theme-presets');
    if (legacy === null) return;
    // 旧形式: [{ name, theme }] → 新形式: [{ name, style }]
    let parsed;
    try { parsed = JSON.parse(legacy); } catch { parsed = null; }
    if (Array.isArray(parsed)) {
      const migrated = parsed.map(p => ({ name: p?.name, style: p?.style || p?.theme || {} }));
      localStorage.setItem(_FILE_STYLE_PRESETS_KEY, JSON.stringify(migrated));
    }
    localStorage.removeItem('file-theme-presets');
  } catch {}
})();

function applyFileStyle(style) {
  // body に適用（旧フォルダテーマ互換、現在は非推奨経路）
  if (!style || typeof style !== 'object') return;
  for (const [key, value] of Object.entries(style)) {
    if (key.startsWith('--')) document.body.style.setProperty(key, value);
  }
}

function applyFileStyleToPanel(style, panelId) {
  // 指定パネルに適用。--page-* / --db-* / --sn2-* すべて対応
  const el = panelId === 'bd-canvas' && typeof bdGetBoardElement === 'function'
    ? bdGetBoardElement('canvas')
    : document.getElementById(panelId);
  if (!el) return;
  applyFileStyleToElement(style, el, panelId);
  if (panelId === 'page-content') {
    const titleEl = document.getElementById('page-title');
    if (typeof applyPageTitleStyleToElement === 'function') {
      applyPageTitleStyleToElement(style, titleEl);
    } else if (titleEl && typeof applyFileStyleToElement === 'function') {
      applyFileStyleToElement(style, titleEl, 'page-content');
    }
  }
  if (panelId === 'bd-canvas' && typeof bdApplyBoardFontVariables === 'function') {
    const world = typeof bdGetBoardElement === 'function' ? bdGetBoardElement('world') : document.getElementById('bd-world');
    bdApplyBoardFontVariables(el, world);
  }
}

function clearFileStyleFromElement(el) {
  if (!el) return;
  const raw = el.dataset?.[_FILE_STYLE_APPLIED_DATASET_KEY] || '';
  raw.split(',').map(v => v.trim()).filter(Boolean).forEach(key => el.style.removeProperty(key));
  if (el.dataset) delete el.dataset[_FILE_STYLE_APPLIED_DATASET_KEY];
}

function applyFileStyleToElement(style, el, panelId) {
  if (!el) return;
  clearFileStyleFromElement(el);
  if (!style || typeof style !== 'object') return;
  const vars = _expandFileStyleVars(style, panelId);
  const applied = [];
  for (const [key, value] of Object.entries(vars)) {
    if (!key.startsWith('--')) continue;
    el.style.setProperty(key, value);
    applied.push(key);
  }
  if (applied.length && el.dataset) el.dataset[_FILE_STYLE_APPLIED_DATASET_KEY] = applied.join(',');
}

function applyPageTitleStyleToElement(style, titleEl) {
  if (!titleEl) return;
  applyFileStyleToElement(style, titleEl, 'page-content');
}

function clearFileStyle() {
  // 全パネル横断クリア。他ペインで開いている別ツールのファイルスタイルも巻き込むため、
  // 新規コードでは clearFileStyleForPanel(panelId) を優先すること。
  const toRemove = [];
  for (const prop of document.body.style) {
    if (prop.startsWith('--')) toRemove.push(prop);
  }
  toRemove.forEach(p => document.body.style.removeProperty(p));
  _FILE_STYLE_PANELS.forEach(id => clearFileStyleForPanel(id));
}

function clearFileStyleForPanel(panelId) {
  if (!panelId) return;
  const el = panelId === 'bd-canvas' && typeof bdGetBoardElement === 'function'
    ? bdGetBoardElement('canvas')
    : document.getElementById(panelId);
  if (el) {
    const remove = [];
    for (const prop of el.style) {
      if (prop.startsWith('--')) remove.push(prop);
    }
    remove.forEach(p => el.style.removeProperty(p));
    if (el.dataset) delete el.dataset.fileStyleAppliedVars;
  }
  if (panelId === 'page-content') {
    const titleEl = document.getElementById('page-title');
    if (titleEl && typeof clearFileStyleFromElement === 'function') clearFileStyleFromElement(titleEl);
    const dp = document.getElementById('dp-editable');
    if (dp) clearFileStyleFromElement(dp);
  } else if (panelId === 'bd-canvas') {
    const note = document.getElementById('board-note-editable');
    if (note) clearFileStyleFromElement(note);
    if (typeof bdApplyBoardFontVariables === 'function') bdApplyBoardFontVariables();
  }
}

// フロントマターから style: を抽出。旧 theme: も後方互換で読む
function _parseFileStyleFromFrontmatter(fmStr) {
  if (!fmStr) return null;
  const m = fmStr.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return null;
  // style: 優先、なければ theme: へフォールバック
  let match = m[1].match(/^style:\s*\n((?:\s+(?:--[\w-]+|__[A-Za-z0-9_-]+):[^\n]*\n?)*)/m);
  if (!match) match = m[1].match(/^theme:\s*\n((?:\s+--[^\n]+\n?)+)/m);
  if (!match) return null;
  const style = {};
  match[1].replace(/^\s+((?:--[\w-]+)|__[A-Za-z0-9_-]+):\s*(.*)$/gm, (_, k, v) => {
    style[k] = _fileStyleYamlScalar(v);
  });
  return Object.keys(style).length > 0 ? style : null;
}

function _getFileStylePresets() {
  try {
    const parsed = JSON.parse(localStorage.getItem(_FILE_STYLE_PRESETS_KEY) || '[]');
    const custom = Array.isArray(parsed) ? parsed : [];
    const ctx = _getCurrentFileStyleContext();
    if (ctx === 'scriptnote') {
      return [..._SCRIPTNOTE_BUILTIN_STYLE_PRESETS, ...custom.filter(p => p?.context === 'scriptnote')];
    }
    return [..._BUILTIN_STYLE_PRESETS, ...custom.filter(p => !p?.context || p.context === ctx)];
  } catch {
    return _getCurrentFileStyleContext() === 'scriptnote'
      ? [..._SCRIPTNOTE_BUILTIN_STYLE_PRESETS]
      : [..._BUILTIN_STYLE_PRESETS];
  }
}

function saveFileStylePreset(name, style) {
  const parsed = JSON.parse(localStorage.getItem(_FILE_STYLE_PRESETS_KEY) || '[]');
  const presets = Array.isArray(parsed) ? parsed : [];
  const ctx = _getCurrentFileStyleContext();
  const payload = ctx
    ? { name, style: _cloneFileStyleObject(style), context: ctx }
    : { name, style: _cloneFileStyleObject(style) };
  const idx = presets.findIndex(p => p?.name === name && (p?.context || null) === (ctx || null));
  if (idx >= 0) presets[idx] = payload;
  else presets.push(payload);
  localStorage.setItem(_FILE_STYLE_PRESETS_KEY, JSON.stringify(presets));
}

function _getDefaultFileStyle(context) {
  try {
    const ctx = context || _getCurrentFileStyleContext() || 'page';
    const raw = JSON.parse(localStorage.getItem(_FILE_STYLE_DEFAULT_KEY) || 'null');
    const store = _normalizeFileStyleDefaultStore(raw);
    return store[ctx] ? _cloneFileStyleObject(store[ctx]) : null;
  }
  catch { return null; }
}

function _saveDefaultFileStyle(style) {
  const ctx = _getCurrentFileStyleContext() || 'page';
  const raw = (() => {
    try { return JSON.parse(localStorage.getItem(_FILE_STYLE_DEFAULT_KEY) || 'null'); }
    catch { return null; }
  })();
  const store = _normalizeFileStyleDefaultStore(raw);
  if (style && Object.keys(style).length > 0) {
    store[ctx] = _cloneFileStyleObject(style);
  } else {
    delete store[ctx];
  }
  if (_FILE_STYLE_CONTEXTS.some(key => store[key] && Object.keys(store[key]).length > 0)) {
    localStorage.setItem(_FILE_STYLE_DEFAULT_KEY, JSON.stringify(store));
  } else {
    localStorage.removeItem(_FILE_STYLE_DEFAULT_KEY);
  }
}

function _getCurrentFileStyle() {
  const ctx = _getCurrentFileStyleContext();
  if (ctx === 'scriptnote') {
    const ed = _getScriptNoteEditorForFileStyle();
    return ed ? _filterScriptnoteFileStyle(ed.doc.editor || {}) : {};
  }
  const view = state?.view || '';
  if (view === 'folder') {
    return _getFolderFileStyle();
  } else if (view === 'page') {
    const pc = document.getElementById('page-content');
    return _parseFileStyleFromFrontmatter(pc?.dataset?.frontmatter || '') || {};
  } else if (view === 'board') {
    // bd._fileStyle 優先、旧 bd._fileTheme もフォールバック
    if (typeof bd !== 'undefined') return bd._fileStyle || bd._fileTheme || {};
    return {};
  } else if (_isDbFileStyleView(view) && (state?.dbMetadata?.style || state?.dbMetadata?.theme)) {
    return state.dbMetadata.style || state.dbMetadata.theme;
  }
  return {};
}

// ファイルスタイルタブのフッターボタンから呼ばれるショートカット群
function _getActivePanelId() {
  return _FILE_STYLE_PANELS.find(id => {
    const e = id === 'bd-canvas' && typeof bdGetBoardElement === 'function'
      ? bdGetBoardElement('canvas')
      : document.getElementById(id);
    return e && e.offsetParent !== null;
  }) || null;
}

async function showFileStylePresetSaveDialog() {
  const style = _getCurrentFileStyle();
  if (!style || Object.keys(style).length === 0) {
    showStatus('保存するスタイルがありません', true);
    return;
  }
  const name = await cfPrompt('プリセット名:');
  if (!name) return;
  saveFileStylePreset(name, style);
  showStatus('プリセット「' + name + '」を保存しました');
}

async function showFileStylePresetApplyDialog() {
  const ctx = _getCurrentFileStyleContext();
  const presets = _getFileStylePresets();
  if (!presets.length) { showStatus('プリセットがありません', true); return; }
  const names = presets.map(p => p.name).filter(Boolean);
  const picked = await cfPrompt('適用するプリセット名:\n' + names.join(', '));
  if (!picked) return;
  const p = presets.find(x => x.name === picked);
  if (!p) { showStatus('プリセット「' + picked + '」が見つかりません', true); return; }
  const style = p.style || p.theme || {};
  const applyWithHistory = async (nextStyle) => {
    if (ctx && typeof _fsApplyStyleWithHistory === 'function') {
      const adapter = typeof _fsGetAdapter === 'function' ? _fsGetAdapter(ctx) : null;
      await _fsApplyStyleWithHistory(ctx, adapter, nextStyle, 'プリセット適用', picked);
      return true;
    }
    return false;
  };
  if (Object.keys(style).length === 0) {
    if (!await applyWithHistory(null) && typeof _saveFileTheme === 'function') _saveFileTheme(null);
    if (ctx !== 'scriptnote' && typeof _fsApplyStyleWithHistory !== 'function') {
      const panelId = _getActivePanelId();
      if (panelId) clearFileStyleForPanel(panelId);
    }
  } else {
    if (!await applyWithHistory(style) && typeof _saveFileTheme === 'function') _saveFileTheme(style);
    if (ctx !== 'scriptnote' && typeof _fsApplyStyleWithHistory !== 'function') {
      const panelId = _getActivePanelId();
      if (panelId) applyFileStyleToPanel(style, panelId);
    }
  }
  showStatus('プリセット「' + picked + '」を適用しました');
}

function setDefaultFileStyle() {
  const style = _getCurrentFileStyle();
  _saveDefaultFileStyle(style);
  showStatus('現在のスタイルを既定に設定しました');
}

async function resetCurrentFileStyle() {
  const ctx = _getCurrentFileStyleContext();
  if (ctx && typeof _fsApplyStyleWithHistory === 'function') {
    const adapter = typeof _fsGetAdapter === 'function' ? _fsGetAdapter(ctx) : null;
    await _fsApplyStyleWithHistory(ctx, adapter, null, 'スタイルリセット');
  } else if (typeof _saveFileTheme === 'function') {
    _saveFileTheme(null);
  }
  if (ctx !== 'scriptnote' && typeof _fsApplyStyleWithHistory !== 'function') {
    const panelId = _getActivePanelId();
    if (panelId) clearFileStyleForPanel(panelId);
  }
  showStatus('スタイルをリセットしました');
}

// ============================================================
// 2. スラッシュコマンド（現在行の変換）
// ============================================================
// 計画書§5工程5: `/` は行種レジストリ（gb-note-block-types.js）から共通メニュー
// （gb-note-block-menu.js）を開き、選択された行種へ「現在行」を変換する。
// 旧実装（スラッシュコマンド専用配列 + execCommand('insertHTML', ...) による
// 新規ブロック挿入）はここで廃止し、重複定義を残さない。行種の一覧・アイコン・
// キーワードは MeldexNoteBlockTypes.TYPES を正本として共有する。
let _slashMenuAnchorRange = null;
// 実行時点の検索語（例: "/h1"のh1）。MeldexNoteBlockMenu.open()の_state.queryは
// 選択確定時（_activate）にはメニュー側のclose()が先に呼ばれて既にnullへ戻って
// いるため、onSelectコールバック（_executeSlashCommand）側からは読み出せない
// （実機検証で確認: メニュー項目クリック時に空文字列になり、"/"は消えても検索語が
// 残るという同じ不具合が再現した）。そのため_onSlashInputが検索語を更新する
// たびにこちら側でも保持しておき、選択確定時はこの値を使う。
let _slashMenuLastQuery = '';

function _slashEditableSelector() {
  return (typeof MeldexNoteBlockTypes !== 'undefined' && MeldexNoteBlockTypes.EDITABLE_SELECTOR)
    || '#page-content, #entity-freetext, #dp-editable';
}

function _isSlashMenuActive() {
  return typeof MeldexNoteBlockMenu !== 'undefined' && MeldexNoteBlockMenu.isOpen();
}

function _hideSlashMenu() {
  if (typeof MeldexNoteBlockMenu !== 'undefined') MeldexNoteBlockMenu.close();
  _slashMenuAnchorRange = null;
  _slashMenuLastQuery = '';
}

// "/" と検索語（フィルタ用に入力した文字列）をまとめて取り除く。§5工程5-2:
// 「/と検索語を除去して現在行変換」。行頭記法（gb-note-enhance.part02.js の
// beforeConvert）と同じパターンで、undo push直後・DOM変換の直前に実行することで
// 「削除＋行種変換」を1回のUndoにまとめる。
//
// 旧実装は「メニューを開いた瞬間（検索語が空）のRange」を使って"/"1文字だけを
// 削除しており、その後に入力された検索語（例: "/h1"のh1）が変換後も行頭に
// 残り続ける不具合があった（h1へ変換されるのは合っているが、"h1"という文字列が
// 別途残る）。anchorRangeの起点自体は変わらない（_showSlashMenuはquery===''の
// 時点だけで開き、その時のstartOffsetは常に"/"の直後を指す）ため、削除範囲の
// 終端をquery文字列の長さぶん伸ばすことで、変換直前の最新の検索語まで含めて
// 一度に削除する。メニュー表示中は上下左右キーがメニュー側に奪われ、検索語の
// 入力/削除以外でキャレットが動かないため、「"/"の直後からquery.length文字が
// 検索語である」という前提が常に成立する。
function _removeSlashTriggerAndQuery(anchorRange, query) {
  if (!anchorRange || !anchorRange.startContainer || !anchorRange.startContainer.isConnected) return;
  const node = anchorRange.startContainer;
  if (node.nodeType !== Node.TEXT_NODE) return;
  const slashIdx = node.textContent.lastIndexOf('/', Math.max(0, anchorRange.startOffset - 1));
  if (slashIdx < 0 || slashIdx >= anchorRange.startOffset) return;
  const endOffset = Math.min(node.textContent.length, anchorRange.startOffset + (query || '').length);
  node.textContent = node.textContent.slice(0, slashIdx) + node.textContent.slice(endOffset);
  const next = document.createRange();
  next.setStart(node, slashIdx);
  next.collapse(true);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(next);
}

function _currentSlashSelectionRange() {
  const sel = window.getSelection();
  return sel && sel.rangeCount ? sel.getRangeAt(0) : null;
}

function _executeSlashCommand(typeId) {
  const anchorRange = _slashMenuAnchorRange;
  const query = _slashMenuLastQuery; // _hideSlashMenu()でリセットされる前に読む
  _hideSlashMenu();
  if (!anchorRange || typeof MeldexNoteBlockTypes === 'undefined') return;
  const range = _currentSlashSelectionRange() || anchorRange;
  const editable = MeldexNoteBlockTypes.resolveEditableHost(range);
  const result = MeldexNoteBlockTypes.convertCurrentLineTo(typeId, {
    editable,
    range,
    // §5工程4-4/5-2: "/"と検索語の削除は、undo push直後・DOM変換の直前に実行する
    // （行頭記法と同じbeforeConvertパターン）。beforeConvertを指定しているため、
    // 同じ行種を選択した場合もconvertCurrentLineTo側のunchanged早期returnは
    // スキップされ、トリガー除去とUndo記録が必ず1操作として実行される。
    beforeConvert() {
      _removeSlashTriggerAndQuery(anchorRange, query);
    },
  });
  if (!result.ok && result.reason && result.reason !== 'no-current-block' && typeof showStatus === 'function') {
    showStatus(result.reason, true);
  }
}

function _showSlashMenu() {
  if (typeof MeldexNoteBlockTypes === 'undefined' || typeof MeldexNoteBlockMenu === 'undefined') return;
  const sel = window.getSelection();
  if (!sel.rangeCount) return;
  const range = sel.getRangeAt(0);
  const editable = MeldexNoteBlockTypes.resolveEditableHost(range);
  if (!editable) return;
  _slashMenuAnchorRange = range.cloneRange();
  const rect = range.getBoundingClientRect();
  const blockInfo = MeldexNoteBlockTypes.resolveCurrentBlock(editable, range);
  const currentTypeId = MeldexNoteBlockTypes.getBlockTypeId(blockInfo);
  MeldexNoteBlockMenu.open({
    anchorRect: rect,
    editable,
    range: _slashMenuAnchorRange,
    blockInfo,
    currentTypeId,
    query: '',
    onSelect: (typeId) => _executeSlashCommand(typeId),
    onClose: () => { _slashMenuAnchorRange = null; _slashMenuLastQuery = ''; },
  });
}

// inputイベントで/を検出（§5工程5-1: 論理行の先頭、または行頭の空白後だけで開く）
function _onSlashInput(e) {
  if (e.isComposing) return; // IME変換中はスキップ
  const editable = e.target.closest ? e.target.closest(_slashEditableSelector()) : null;
  if (!editable) return;
  const sel = window.getSelection();
  if (!sel.rangeCount) return;
  const range = sel.getRangeAt(0);
  const node = range.startContainer;
  if (node.nodeType !== Node.TEXT_NODE) { if (_isSlashMenuActive()) _hideSlashMenu(); return; }
  const text = node.textContent;
  const pos = range.startOffset;
  const lineStart = text.lastIndexOf('\n', pos - 2) + 1;
  const lineText = text.substring(lineStart, pos);
  const slashMatch = lineText.match(/^(\s*)\/(.*)$/);

  if (!slashMatch) {
    if (_isSlashMenuActive()) _hideSlashMenu();
    return;
  }
  const query = slashMatch[2];
  if (!_isSlashMenuActive() && query === '') {
    _showSlashMenu();
    _slashMenuLastQuery = query;
  } else if (_isSlashMenuActive()) {
    MeldexNoteBlockMenu.setQuery(query);
    _slashMenuLastQuery = query;
  }
}

// ============================================================
// 3. ブロックドラッグハンドル
// ============================================================
// 計画書 工程7: ハンドルの実装は gb-note-block-reorder.js（ポインタイベント
// ベース、pointer capture対応、全編集ホスト対応）へ統合した。旧実装は
// #page-content 専用のネイティブHTML5 drag&dropで、pointer capture非対応・
// クリックとドラッグの閾値判定なし・詳細パネル内ノートとエンティティ自由記述
// では動作しなかった。ここでは初期化を委譲するだけに留める（関数名・
// 呼び出し口は既存のopenPageフック等との互換のため維持）。
function _initBlockDragHandle() {
  if (typeof MeldexNoteBlockReorder !== 'undefined' && typeof MeldexNoteBlockReorder.initHandle === 'function') {
    MeldexNoteBlockReorder.initHandle();
  }
}

// ============================================================
// 4. 見出しインデント表示
// ============================================================
function wrapHeadingSections(container) {
  const children = [...container.childNodes];
  const fragment = document.createDocumentFragment();
  let stack = []; // [{level, section}]

  function closeAbove(level) {
    while (stack.length > 0 && stack[stack.length - 1].level >= level) {
      stack.pop();
    }
  }

  children.forEach(node => {
    container.removeChild(node);
    const tagMatch = node.nodeName && node.nodeName.match(/^H([1-6])$/);
    if (tagMatch) {
      const lv = parseInt(tagMatch[1]);
      closeAbove(lv);
      const section = document.createElement('section');
      section.className = 'heading-section level-' + lv;
      section.appendChild(node);
      if (stack.length > 0) {
        stack[stack.length - 1].section.appendChild(section);
      } else {
        fragment.appendChild(section);
      }
      stack.push({ level: lv, section });
    } else {
      if (stack.length > 0) {
        stack[stack.length - 1].section.appendChild(node);
      } else {
        fragment.appendChild(node);
      }
    }
  });

  container.appendChild(fragment);
}

function unwrapHeadingSections(container) {
  const sections = container.querySelectorAll('section.heading-section');
  // 内側から外側に向かって解除（reverseで深い方から）
  [...sections].reverse().forEach(sec => {
    while (sec.firstChild) sec.parentNode.insertBefore(sec.firstChild, sec);
    sec.remove();
  });
}

function toggleHeadingIndent() {
  const pc = document.getElementById('page-content');
  if (!pc) return;
  const btn = document.getElementById('btn-heading-indent');
  const _v = localStorage.getItem('note-heading-indent');
  const isOn = _v === null || _v === '1';
  if (isOn) {
    localStorage.setItem('note-heading-indent', '0');
    unwrapHeadingSections(pc);
    if (btn) btn.classList.remove('active');
  } else {
    localStorage.setItem('note-heading-indent', '1');
    wrapHeadingSections(pc);
    if (btn) btn.classList.add('active');
  }
}

// ============================================================
// 初期化
// ============================================================
// openPage完了後のフック（既存のopenPageをラップ）
const _origOpenPage = typeof openPage === 'function' ? openPage : null;
if (_origOpenPage) {
  openPage = async function(label, path, opts) {
    if (!opts?.skipGlobalUi) clearFileStyleForPanel('page-content');
    await _origOpenPage(label, path, opts);
    // ファイル個別テーマはpage-contentパネルにのみ適用
    const pc = document.getElementById('page-content');
    const _fileTheme = _parseFileStyleFromFrontmatter(pc?.dataset.frontmatter);
    if (!opts?.skipGlobalUi) {
      if (_fileTheme) {
        applyFileStyleToPanel(_fileTheme, 'page-content');
      } else {
        // ファイル固有スタイルが無い場合、既定ファイルスタイルを視覚的に適用
        const _def = _getDefaultFileStyle('page');
        if (_def) applyFileStyleToPanel(_def, 'page-content');
      }
    }
    // 見出しインデント（デフォルト: オン）
    const _indentVal = localStorage.getItem('note-heading-indent');
    const _indentOn = _indentVal === null || _indentVal === '1';
    if (_indentOn) {
      if (pc) wrapHeadingSections(pc);
    }
    if (pc && typeof _schedulePageDisplayLayers === 'function') {
      _schedulePageDisplayLayers(path, pc, pc.innerHTML, () => pc.dataset.path !== path);
    }
    const btn = document.getElementById('btn-heading-indent');
    if (btn) btn.classList.toggle('active', _indentOn);
    // ブロックドラッグハンドル初期化
    _initBlockDragHandle();
  };
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', _initBlockDragHandle, { once: true });
} else {
  _initBlockDragHandle();
}
