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
/* gb-note-enhance.part03.js: note table boundary resize */
let _noteTableResizeState = null;
let _noteTableResizeHoverCell = null;
const _NOTE_TABLE_SELECTOR = '#page-content table, #entity-freetext table, #dp-editable table, #board-note-editable table';
const _NOTE_TABLE_EDITABLE_SELECTOR = '#page-content, #entity-freetext, #dp-editable, #board-note-editable';
let _noteTableActiveCell = null;
let _noteTableControls = null;

function _noteTableUiZoom() {
  return (typeof _getZoom === 'function' ? _getZoom() : 1) || 1;
}

function _noteTableCellFromTarget(target) {
  const cell = target?.closest?.('td, th');
  if (!cell || !cell.closest?.(_NOTE_TABLE_SELECTOR)) return null;
  return cell;
}

function _noteTableEditable(table) {
  return table?.closest?.(_NOTE_TABLE_EDITABLE_SELECTOR) || null;
}

function _noteTableCanEdit(editable, options = {}) {
  if (editable && editable.contentEditable === 'true') return true;
  if (!options.silent && typeof showStatus === 'function') showStatus('ロック中または読み取り専用のため、表を編集できません', true);
  return false;
}

function _noteTablePushCustomUndo(editable) {
  if (!_noteTableCanEdit(editable, { silent: true }) || typeof _pushCustomUndo !== 'function') return false;
  _pushCustomUndo(editable);
  return true;
}

function _noteTableDiscardCustomUndoIfUnchanged(editable, beforeHtml) {
  if (!editable || beforeHtml === undefined || editable.innerHTML !== beforeHtml) return;
  if (!editable._customUndoInputPending || !Array.isArray(editable._customUndoStack)) return;
  const lastIndex = editable._customUndoStack.length - 1;
  if (lastIndex >= 0 && editable._customUndoStack[lastIndex] === beforeHtml) editable._customUndoStack.pop();
  editable._customUndoInputPending = false;
  editable._lastCustomOp = Array.isArray(editable._customUndoStack) && editable._customUndoStack.length > 0;
}

function _noteTableDispatchInput(editable, beforeHtml) {
  if (!editable) return;
  if (beforeHtml !== undefined && editable.innerHTML === beforeHtml) {
    _noteTableDiscardCustomUndoIfUnchanged(editable, beforeHtml);
    return;
  }
  editable.dispatchEvent(new Event('input', { bubbles: true }));
}

function _noteTableConfirm(message) {
  if (typeof cfConfirm === 'function') return cfConfirm(message);
  return typeof window.confirm === 'function' ? window.confirm(message) : false;
}

function _noteTableColumnIndex(cell) {
  const row = cell?.parentElement;
  return row ? [...row.children].indexOf(cell) : -1;
}

function _noteTableColumnCount(table) {
  return Array.from(table?.rows || []).reduce((max, row) => Math.max(max, row.cells.length), 0);
}

function _noteTableColgroup(table) {
  return table?.querySelector?.(':scope > colgroup') || null;
}

function _noteTableNormalizeColgroupToCount(table, colCount = _noteTableColumnCount(table)) {
  const colgroup = _noteTableColgroup(table);
  if (!colgroup) return null;
  while (colgroup.children.length < colCount) colgroup.appendChild(document.createElement('col'));
  while (colgroup.children.length > colCount) colgroup.lastElementChild.remove();
  return colgroup;
}

function _noteTableInsertColgroupColumn(table, colIndex) {
  const colgroup = _noteTableNormalizeColgroupToCount(table);
  if (!colgroup) return;
  const index = Math.max(0, Math.min(colIndex, colgroup.children.length));
  const col = document.createElement('col');
  const source = colgroup.children[Math.min(index, colgroup.children.length - 1)] || colgroup.lastElementChild;
  if (source?.style?.width) col.style.width = source.style.width;
  colgroup.insertBefore(col, colgroup.children[index] || null);
}

function _noteTableDeleteColgroupColumn(table, colIndex) {
  const colgroup = _noteTableNormalizeColgroupToCount(table);
  if (!colgroup) return;
  if (colIndex >= 0 && colIndex < colgroup.children.length) colgroup.children[colIndex].remove();
}

function _noteTableSyncCellWidthsFromColgroup(table) {
  const colgroup = _noteTableColgroup(table);
  if (!colgroup) return;
  Array.from(table?.rows || []).forEach(row => {
    Array.from(row.cells || []).forEach((cell, index) => {
      const width = colgroup.children[index]?.style?.width || '';
      if (width) cell.style.width = width;
    });
  });
}

function _noteTableNewCellForRow(row, rowIndex) {
  return document.createElement(rowIndex === 0 && row?.querySelector?.('th') ? 'th' : 'td');
}

function _noteTableCellAtResizeEdge(event) {
  const cell = _noteTableCellFromTarget(event.target);
  if (!cell) return null;
  const rect = cell.getBoundingClientRect();
  const edge = 6;
  const nearRight = Math.abs(event.clientX - rect.right) <= edge && event.clientY >= rect.top && event.clientY <= rect.bottom;
  const nearBottom = Math.abs(event.clientY - rect.bottom) <= edge && event.clientX >= rect.left && event.clientX <= rect.right;
  if (!nearRight && !nearBottom) return null;
  if (nearRight && (!nearBottom || Math.abs(event.clientX - rect.right) <= Math.abs(event.clientY - rect.bottom))) {
    return { cell, axis: 'col' };
  }
  return { cell, axis: 'row' };
}

function _noteTableClearResizeHover() {
  if (_noteTableResizeHoverCell?.isConnected) _noteTableResizeHoverCell.style.cursor = '';
  _noteTableResizeHoverCell = null;
}

function _noteTableSetResizeHover(target) {
  if (_noteTableResizeState) return;
  if (!target) {
    _noteTableClearResizeHover();
    return;
  }
  if (_noteTableResizeHoverCell && _noteTableResizeHoverCell !== target.cell) _noteTableResizeHoverCell.style.cursor = '';
  _noteTableResizeHoverCell = target.cell;
  target.cell.style.cursor = target.axis === 'col' ? 'col-resize' : 'row-resize';
}

function _noteTableEnsureColgroup(table, colCount) {
  let colgroup = table.querySelector(':scope > colgroup');
  if (!colgroup) {
    colgroup = document.createElement('colgroup');
    table.insertBefore(colgroup, table.firstChild);
  }
  while (colgroup.children.length < colCount) colgroup.appendChild(document.createElement('col'));
  while (colgroup.children.length > colCount) colgroup.lastElementChild.remove();
  return colgroup;
}

function _noteTableApplyColumnWidth(table, colIndex, width) {
  const rows = Array.from(table?.rows || []);
  const colCount = rows.reduce((max, row) => Math.max(max, row.cells.length), 0);
  if (!table || colIndex < 0 || colIndex >= colCount) return;
  table.style.tableLayout = 'fixed';
  table.dataset.noteTableResized = '1';
  const col = _noteTableEnsureColgroup(table, colCount).children[colIndex];
  col.style.width = Math.max(40, Math.round(width)) + 'px';
  rows.forEach(row => {
    if (row.cells[colIndex]) row.cells[colIndex].style.width = col.style.width;
  });
}

function _noteTableApplyRowHeight(row, height) {
  if (!row) return;
  const px = Math.max(24, Math.round(height)) + 'px';
  row.style.height = px;
  Array.from(row.cells || []).forEach(cell => { cell.style.height = px; });
  const table = row.closest('table');
  if (table) table.dataset.noteTableResized = '1';
}

function _noteTableBindResizeFinishGuards() {
  window.addEventListener('blur', _noteTableFinishResize, true);
  window.addEventListener('pointerup', _noteTableFinishResize, true);
  window.addEventListener('pointercancel', _noteTableFinishResize, true);
}

function _noteTableUnbindResizeFinishGuards() {
  window.removeEventListener('blur', _noteTableFinishResize, true);
  window.removeEventListener('pointerup', _noteTableFinishResize, true);
  window.removeEventListener('pointercancel', _noteTableFinishResize, true);
}

function _noteTableStartResize(event) {
  const target = _noteTableCellAtResizeEdge(event);
  if (!target) return false;
  const table = target.cell.closest('table');
  const editable = _noteTableEditable(table);
  if (!table || !editable) return false;
  if (!_noteTableCanEdit(editable)) return false;
  const row = target.cell.parentElement;
  const z = _noteTableUiZoom();
  try { target.cell.setPointerCapture?.(event.pointerId); } catch {}
  _noteTableResizeState = {
    axis: target.axis,
    table,
    row,
    colIndex: _noteTableColumnIndex(target.cell),
    editable,
    beforeHtml: editable.innerHTML,
    startX: event.clientX,
    startY: event.clientY,
    startWidth: target.cell.getBoundingClientRect().width / z,
    startHeight: row.getBoundingClientRect().height / z,
    pointerTarget: target.cell,
    pointerId: event.pointerId,
    undoPushed: false,
    changed: false,
  };
  document.body.classList.add('note-table-resizing');
  document.body.style.cursor = target.axis === 'col' ? 'col-resize' : 'row-resize';
  _noteTableBindResizeFinishGuards();
  event.preventDefault();
  event.stopPropagation();
  return true;
}

function _noteTableResizeMove(event) {
  const state = _noteTableResizeState;
  if (!state) return;
  const z = _noteTableUiZoom();
  const delta = state.axis === 'col' ? (event.clientX - state.startX) / z : (event.clientY - state.startY) / z;
  if (Math.abs(delta) < 0.5) return;
  if (!state.undoPushed) state.undoPushed = _noteTablePushCustomUndo(state.editable);
  if (state.axis === 'col') {
    _noteTableApplyColumnWidth(state.table, state.colIndex, state.startWidth + delta);
  } else {
    _noteTableApplyRowHeight(state.row, state.startHeight + delta);
  }
  state.changed = state.editable.innerHTML !== state.beforeHtml;
  _positionNoteTableCellControls();
  event.preventDefault();
}

function _noteTableFinishResize() {
  const state = _noteTableResizeState;
  if (!state) return;
  _noteTableResizeState = null;
  _noteTableUnbindResizeFinishGuards();
  try { state.pointerTarget?.releasePointerCapture?.(state.pointerId); } catch {}
  document.body.classList.remove('note-table-resizing');
  document.body.style.cursor = '';
  _noteTableClearResizeHover();
  if (state.changed || state.undoPushed) _noteTableDispatchInput(state.editable, state.beforeHtml);
}
// === 後方互換エイリアス（他モジュール・HTML からの呼び出しを壊さない） ===
function applyFileTheme(theme) { return applyFileStyle(theme); }
function applyFileThemeToPanel(theme, panelId) { return applyFileStyleToPanel(theme, panelId); }
function clearFileTheme() { return clearFileStyle(); }
function saveFileThemePreset(name, theme) { return saveFileStylePreset(name, theme); }
function _parseFileThemeFromFrontmatter(fmStr) { return _parseFileStyleFromFrontmatter(fmStr); }
function _getFileThemePresets() { return _getFileStylePresets(); }
function _getCurrentFileTheme() { return _getCurrentFileStyle(); }

function _saveFileTheme(theme) {
  const ctx = _getCurrentFileStyleContext();
  if (ctx === 'scriptnote') {
    const ed = _getScriptNoteEditorForFileStyle();
    if (!ed?.doc) return;
    if (!ed.doc.editor) ed.doc.editor = {};
    Object.keys(ed.doc.editor).forEach((key) => {
      if (_SCRIPTNOTE_REMOVED_FILE_STYLE_KEYS.includes(key) || _isScriptnoteFileStyleKey(key)) delete ed.doc.editor[key];
    });
    const next = _filterScriptnoteFileStyle(theme);
    Object.entries(_SCRIPTNOTE_FILE_STYLE_DEFAULTS).forEach(([key, value]) => {
      if (next[key] === undefined) ed.doc.editor[key] = value;
    });
    Object.entries(next).forEach(([key, value]) => {
      ed.doc.editor[key] = value;
    });
    if (typeof ed._render === 'function') ed._render();
    if (typeof ed._markDirty === 'function') ed._markDirty();
    _refreshCurrentFileStyleUi(ctx);
    return;
  }
  const view = state?.view || '';
  if (view === 'folder') {
    _saveFolderFileStyle(theme);
  } else if (view === 'page') {
    _saveFileThemeToNoteFrontmatter(theme);
  } else if (view === 'board') {
    // キャンバスのフロントマター保存はbdSave()に委ねる（bd._fileStyleを設定）
    if (typeof bd !== 'undefined') {
      bd._fileStyle = (theme && Object.keys(theme).length > 0) ? theme : null;
      bd.dirty = true;
      if (typeof bdSave === 'function') bdSave();
    }
  } else if (_isDbFileStyleView(view)) {
    _saveFileThemeToDbFolderNote(theme);
  }
}

let _dbFolderNoteStyleSaveQueue = Promise.resolve();

function _syncDbMetadataFileStyle(theme) {
  if (!state?.dbMetadata) return;
  if (theme && Object.keys(theme).length > 0) {
    state.dbMetadata.style = _cloneFileStyleObject(theme);
    delete state.dbMetadata.theme;
  } else {
    delete state.dbMetadata.style;
    delete state.dbMetadata.theme;
  }
}

function _saveFileThemeToNoteFrontmatter(theme) {
  const pc = document.getElementById('page-content');
  if (!pc) return;
  let fmStr = pc.dataset.frontmatter || '';
  // 書込時は必ず style: に統一し、旧 theme: ブロックは除去する（同ファイル内の重複防止）
  fmStr = fmStr.replace(/theme:\s*\n(?:\s+--[^\n]+\n?)*/m, '');
  const styleYaml = _fileStyleToYaml(theme);
  if (styleYaml) {
    if (_fileStyleBlockRegex().test(fmStr)) {
      fmStr = fmStr.replace(_fileStyleBlockRegex(), styleYaml);
    } else if (fmStr.startsWith('---')) {
      fmStr = fmStr.replace(/\r?\n---\r?\n?$/, '\n' + styleYaml + '---\n');
    } else {
      fmStr = '---\n' + styleYaml + '---\n';
    }
  } else {
    fmStr = fmStr.replace(_fileStyleBlockRegex(), '');
    if (fmStr.replace(/---\r?\n\s*---\r?\n?/, '').trim() === '') fmStr = '';
  }
  pc.dataset.frontmatter = fmStr;
  pc.dispatchEvent(new Event('input'));
}

function _saveFileThemeToDbFolderNote(theme) {
  const dbPath = state?.currentDbPath;
  if (!dbPath) return Promise.resolve();
  const themeSnapshot = _cloneFileStyleObject(theme);
  const saveTask = async () => {
  // フォルダノートのフロントマターをAPI経由で更新
    const folderName = dbPath.split('/').pop();
    const notePath = dbPath + '/' + folderName + '.md';
    try {
      const data = await apiFetch('/file?path=' + encodeURIComponent(notePath));
      let content = data.content || '';
      const styleYaml = _fileStyleToYaml(themeSnapshot);
      // フロントマター部分のみ操作（本文の style:/theme: と誤マッチ防止）
      const fmMatch = content.match(/^(---\r?\n[\s\S]*?\r?\n---(?:\r?\n)?)/);
      if (fmMatch) {
        let fm = fmMatch[1];
        // 旧 theme: ブロックは必ず除去
        fm = fm.replace(/theme:\s*\n(?:\s+--[^\n]+\n?)*/m, '');
        if (_fileStyleBlockRegex().test(fm)) {
          fm = fm.replace(_fileStyleBlockRegex(), styleYaml);
        } else if (styleYaml) {
          fm = fm.replace(/\r?\n---\r?\n?$/, '\n' + styleYaml + '---\n');
        }
        content = fm + content.substring(fmMatch[1].length);
      } else if (styleYaml) {
        content = '---\n' + styleYaml + '---\n' + content;
      }
      await apiPut('/file?path=' + encodeURIComponent(notePath), {
        content,
        if_match_etag: data.etag || '',
        transport_revision: data.transport_revision || '',
      });
      if (state?.currentDbPath === dbPath) _syncDbMetadataFileStyle(themeSnapshot);
      showStatus('DBテーマを保存しました');
    } catch (e) { showStatus('テーマ保存に失敗しました', true); }
  };
  _dbFolderNoteStyleSaveQueue = _dbFolderNoteStyleSaveQueue.catch(() => {}).then(saveTask);
  return _dbFolderNoteStyleSaveQueue;
}

// ============================================================
// 5. コピーボタン（コードブロック・コールアウト）
// ============================================================
function _noteEnhanceRenderIcon(name, size = 14, fallback = '') {
  return typeof lucide === 'function' ? lucide(name, size) : fallback;
}

function _noteEnhanceSetCopyButtonIcon(btn, name, label) {
  if (!btn) return;
  btn.setAttribute('aria-label', label);
  btn.title = label;
  btn.innerHTML = _noteEnhanceRenderIcon(name, 14, label);
}

function _initCopyButton() {
  document.addEventListener('mouseover', (e) => {
    const codeBlock = e.target.closest('#page-content pre, #entity-freetext pre');
    const callout = e.target.closest('#page-content .callout-block, #entity-freetext .callout-block');
    const target = codeBlock || callout;
    if (!target) return;
    if (target.querySelector('.copy-btn')) return;

    const btn = document.createElement('button');
    btn.className = 'copy-btn';
    btn.type = 'button';
    btn.dataset.e2eId = codeBlock ? 'note-copy-button-code' : 'note-copy-button-callout';
    btn.contentEditable = 'false';
    _noteEnhanceSetCopyButtonIcon(btn, 'copy', 'コピー');
    btn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      ev.preventDefault();
      const text = codeBlock
        ? (codeBlock.querySelector('code')?.textContent || codeBlock.textContent)
        : (callout.querySelector('.callout-body')?.textContent || callout.textContent);
      navigator.clipboard.writeText(text).then(() => {
        _noteEnhanceSetCopyButtonIcon(btn, 'check', 'コピーしました');
        setTimeout(() => { _noteEnhanceSetCopyButtonIcon(btn, 'copy', 'コピー'); }, 1500);
      });
    });

    target.style.position = 'relative';
    target.appendChild(btn);
  });

  document.addEventListener('mouseout', (e) => {
    const target = e.target.closest('pre, .callout-block');
    if (!target) return;
    const related = e.relatedTarget;
    if (target.contains(related)) return;
    const btn = target.querySelector('.copy-btn');
    if (btn) btn.remove();
  });
}
_initCopyButton();

// タッチ対応: touchstart でもコピーボタン表示
document.addEventListener('touchstart', (e) => {
  const target = e.target.closest('#page-content pre, #entity-freetext pre, #page-content .callout-block, #entity-freetext .callout-block');
  if (!target || target.querySelector('.copy-btn')) return;
  // 既存のmouseoverと同じボタン生成ロジックをトリガー
  target.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
}, { passive: true });

// ============================================================
// 1b. ファイルスタイル適用ヘルパー（分割サイズ調整のため後続チャンクに配置）
// ============================================================
const _FILE_STYLE_APPLIED_DATASET_KEY = 'fileStyleAppliedVars';

function _fileStyleOsAccentKey() {
  return typeof _FILE_STYLE_USE_OS_ACCENT_KEY !== 'undefined' ? _FILE_STYLE_USE_OS_ACCENT_KEY : '__useOsAccentColor';
}

function _fileStyleUsesOsAccent(style) {
  const value = style?.[_fileStyleOsAccentKey()];
  return value === true || value === 1 || value === '1' || value === 'true';
}

function _fileStyleLocalCustomThemeId() {
  return typeof _FILE_STYLE_LOCAL_CUSTOM_THEME_ID !== 'undefined'
    ? _FILE_STYLE_LOCAL_CUSTOM_THEME_ID
    : '__fileCustomTheme';
}

function _fileStyleIsLocalCustomTheme(style) {
  const themeId = style?.[_FILE_STYLE_THEME_ID_KEY] || style?.themeId || '';
  return String(themeId || '') === _fileStyleLocalCustomThemeId();
}

function _applyFileStyleOsAccentVars(vars) {
  if (typeof MeldexThemeManager === 'undefined') return;
  const accent = typeof MeldexThemeManager.getOsAccentColor === 'function' ? MeldexThemeManager.getOsAccentColor() : '';
  const text = typeof MeldexThemeManager.getOsAccentTextColor === 'function' ? MeldexThemeManager.getOsAccentTextColor() : '';
  vars['--theme-os-accent'] = accent || 'AccentColor';
  vars['--theme-os-accent-text'] = text || 'AccentColorText';
  const accentCss = 'var(--theme-os-accent, AccentColor)';
  const textCss = 'var(--theme-os-accent-text, AccentColorText)';
  (MeldexThemeManager.THEME_OS_ACCENT_STYLE_KEYS || []).forEach(key => { vars[key] = accentCss; });
  (MeldexThemeManager.THEME_OS_ACCENT_TEXT_STYLE_KEYS || []).forEach(key => { vars[key] = textCss; });
}

function _fileStyleThemeVars(style) {
  const themeId = style?.[_FILE_STYLE_THEME_ID_KEY] || style?.themeId || '';
  const useOsAccent = _fileStyleUsesOsAccent(style);
  if (_fileStyleIsLocalCustomTheme(style)) {
    const vars = {};
    if (useOsAccent) {
      _applyFileStyleOsAccentVars(vars);
      const colors = typeof MeldexThemeManager !== 'undefined' && typeof MeldexThemeManager.getOsAccentThemeColorSet === 'function'
        ? MeldexThemeManager.getOsAccentThemeColorSet()
        : [];
      if (Array.isArray(colors) && colors.length) {
        for (let i = 0; i < 10; i += 1) vars[`--theme-palette-${i}`] = colors[i % colors.length];
      } else {
        for (let i = 0; i < 10; i += 1) vars[`--theme-palette-${i}`] = 'var(--theme-os-accent, AccentColor)';
      }
    }
    return vars;
  }
  if (typeof MeldexThemeManager === 'undefined') return {};
  const themeDef = themeId && typeof MeldexThemeManager.getThemeById === 'function' ? MeldexThemeManager.getThemeById(themeId) : null;
  const vars = { ...(themeDef?.ui?.cssVars || {}) };
  if (useOsAccent) {
    _applyFileStyleOsAccentVars(vars);
  }
  if (typeof MeldexThemeManager.getThemeColorSet === 'function') {
    const colors = useOsAccent
      ? (typeof MeldexThemeManager.getOsAccentThemeColorSet === 'function' ? MeldexThemeManager.getOsAccentThemeColorSet() : [])
      : (themeDef ? MeldexThemeManager.getThemeColorSet(themeDef, { ignoreOsAccent: true }) : []);
    if (Array.isArray(colors) && colors.length) {
      for (let i = 0; i < 10; i += 1) vars[`--theme-palette-${i}`] = colors[i % colors.length];
    }
    if (useOsAccent && (!Array.isArray(colors) || !colors.length)) {
      for (let i = 0; i < 10; i += 1) vars[`--theme-palette-${i}`] = 'var(--theme-os-accent, AccentColor)';
    }
  }
  return vars;
}

function _fileStyleCssVars(style) {
  const vars = {};
  if (!style || typeof style !== 'object') return vars;
  Object.entries(style).forEach(([key, value]) => {
    if (!key.startsWith('--') || value === undefined || value === null || value === '') return;
    if (_fileStyleUsesOsAccent(style) && key.startsWith('--theme-palette-')) return;
    if (_fileStyleIsCommonIntegratedKey(key)) return;
    vars[key] = typeof normalizeStyleSettingValue === 'function' ? normalizeStyleSettingValue(key, value) : value;
  });
  return vars;
}

function _fileStyleIsCommonIntegratedKey(key) {
  if (typeof COMMON_THEME_SURFACE_STYLE_KEYS !== 'undefined' && COMMON_THEME_SURFACE_STYLE_KEYS.has(key)) return true;
  if (typeof COMMON_THEME_SCROLLBAR_STYLE_KEYS !== 'undefined' && COMMON_THEME_SCROLLBAR_STYLE_KEYS.has(key)) return true;
  return false;
}

function _expandFileStyleVars(style, panelId) {
  const themeVars = _fileStyleCssVars(_fileStyleThemeVars(style));
  const styleVars = _fileStyleCssVars(style);
  const vars = { ...themeVars, ...styleVars };
  if (_fileStyleUsesOsAccent(style) && typeof _applyFileStyleOsAccentVars === 'function') {
    _applyFileStyleOsAccentVars(vars);
  }
  const hasStyle = (key) => Object.prototype.hasOwnProperty.call(styleVars, key);
  const hasTheme = (key) => Object.prototype.hasOwnProperty.call(themeVars, key);
  const alias = (sourceKey, targetKeys) => {
    if (hasStyle(sourceKey)) {
      targetKeys.forEach((targetKey) => {
        if (_fileStyleIsCommonIntegratedKey(targetKey)) return;
        if (!hasStyle(targetKey)) vars[targetKey] = styleVars[sourceKey];
      });
    } else if (hasTheme(sourceKey)) {
      targetKeys.forEach((targetKey) => {
        if (_fileStyleIsCommonIntegratedKey(targetKey)) return;
        if (!hasStyle(targetKey) && !hasTheme(targetKey)) vars[targetKey] = themeVars[sourceKey];
      });
    }
  };
  const isPage = panelId === 'page-content' || Object.keys(vars).some(key => key.startsWith('--page-'));
  if (isPage) {
    alias('--page-bg', ['--page-text-bg']);
    alias('--page-fg', ['--page-text-fg']);
    alias('--page-heading-color', [
      '--page-h1-fg', '--page-h2-fg', '--page-h3-fg',
      '--page-h4-fg', '--page-h5-fg', '--page-h6-fg',
    ]);
  }
  const isDb = panelId === 'db-view-container' || Object.keys(vars).some(key => key.startsWith('--db-'));
  if (isDb) {
    alias('--db-header-bg', ['--db-th-bg']);
    alias('--db-row-bg', ['--db-cell-bg', '--db-entity-bg']);
    alias('--db-border-color', ['--db-grid-border']);
  }
  return vars;
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

// ============================================================
// 6. テーブル操作（セル編集・行列追加・右クリック削除）
// ============================================================
function _ensureTableRowDragHandle() {
  let handle = document.getElementById('table-row-drag-handle');
  if (handle) return handle;
  handle = document.createElement('div');
  handle.id = 'table-row-drag-handle';
  handle.textContent = '⠿';
  handle.draggable = true;
  handle.setAttribute('contenteditable', 'false');
  handle.style.cssText = 'position:fixed;left:0;top:0;width:18px;height:18px;cursor:grab;opacity:0;transition:opacity 0.15s;color:var(--page-table-control-fg,var(--fg2));font-size:15px;display:flex;align-items:center;justify-content:center;z-index:10000;user-select:none;pointer-events:auto;background:var(--page-table-control-bg,var(--bg2));border:var(--page-table-control-border-width,1px) solid var(--page-table-control-border,var(--border));border-radius:4px;';
  document.body.appendChild(handle);

  const rowSelector = '#page-content table tr, #entity-freetext table tr';
  let dropRow = null;
  let dropBefore = false;
  const clearDropMarker = () => {
    if (dropRow) dropRow.style.boxShadow = '';
    dropRow = null;
  };
  const positionHandle = (row) => {
    const rect = row.getBoundingClientRect();
    const z = (typeof _getZoom === 'function' ? _getZoom() : 1) || 1;
    handle.style.top = ((rect.top + Math.max(0, (rect.height - 18) / 2)) / z) + 'px';
    handle.style.left = ((rect.left - 22) / z) + 'px';
  };
  const cleanupDrag = () => {
    clearDropMarker();
    if (handle._dragRow) {
      handle._dragRow.style.opacity = '';
      handle._dragRow = null;
    }
    dropBefore = false;
    if (!handle.matches(':hover')) handle.style.opacity = '0';
  };
  const rowAtClientY = (clientY, table) => {
    if (!table) return null;
    let nearest = null;
    let nearestDistance = Infinity;
    for (const row of Array.from(table.querySelectorAll('tr'))) {
      const rect = row.getBoundingClientRect();
      if (clientY >= rect.top && clientY <= rect.bottom) return row;
      const distance = Math.min(Math.abs(clientY - rect.top), Math.abs(clientY - rect.bottom));
      if (distance < nearestDistance) {
        nearest = row;
        nearestDistance = distance;
      }
    }
    const rect = table.getBoundingClientRect();
    return clientY >= rect.top && clientY <= rect.bottom ? nearest : null;
  };
  const rowFromDragEvent = (e, dragRow) => {
    let target = e.target?.closest?.(rowSelector) || null;
    if (!target && typeof document.elementFromPoint === 'function') {
      const prevPointerEvents = handle.style.pointerEvents;
      handle.style.pointerEvents = 'none';
      try {
        target = document.elementFromPoint(e.clientX, e.clientY)?.closest?.(rowSelector) || null;
      } finally {
        handle.style.pointerEvents = prevPointerEvents;
      }
    }
    return target || rowAtClientY(e.clientY, dragRow?.closest?.('table'));
  };

  document.addEventListener('mousemove', (e) => {
    if (handle._dragRow) return;
    if (e.target === handle || handle.contains(e.target)) return;
    const row = e.target.closest(rowSelector);
    if (!row) {
      handle.style.opacity = '0';
      handle._targetRow = null;
      return;
    }
    handle._targetRow = row;
    positionHandle(row);
    handle.style.opacity = '1';
  });

  handle.addEventListener('dragstart', (e) => {
    const row = handle._targetRow;
    if (!row) {
      e.preventDefault();
      return;
    }
    handle._dragRow = row;
    row.style.opacity = '0.35';
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', 'table-row');
  });

  document.addEventListener('dragover', (e) => {
    const dragRow = handle._dragRow;
    if (!dragRow) return;
    e.preventDefault();
    e.stopPropagation();
    const target = rowFromDragEvent(e, dragRow);
    if (!target || target === dragRow || target.closest('table') !== dragRow.closest('table')) {
      clearDropMarker();
      return;
    }
    const rect = target.getBoundingClientRect();
    dropBefore = e.clientY < rect.top + rect.height / 2;
    if (dropRow && dropRow !== target) dropRow.style.boxShadow = '';
    dropRow = target;
    dropRow.style.boxShadow = dropBefore
      ? 'inset 0 var(--page-drag-guide-width, 2px) 0 var(--page-drag-guide-color, var(--accent))'
      : 'inset 0 calc(-1 * var(--page-drag-guide-width, 2px)) 0 var(--page-drag-guide-color, var(--accent))';
  }, true);

  document.addEventListener('drop', (e) => {
    const dragRow = handle._dragRow;
    if (!dragRow) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    const target = rowFromDragEvent(e, dragRow);
    if (!target || target === dragRow || target.closest('table') !== dragRow.closest('table')) {
      cleanupDrag();
      return;
    }
    const pc = dragRow.closest('#page-content, #entity-freetext');
    const beforeHtml = pc ? pc.innerHTML : '';
    _noteTablePushCustomUndo(pc);
    const rect = target.getBoundingClientRect();
    const shouldDropBefore = e.clientY < rect.top + rect.height / 2;
    if (shouldDropBefore) target.before(dragRow);
    else target.after(dragRow);
    _noteTableDispatchInput(pc, beforeHtml);
    cleanupDrag();
  }, true);

  handle.addEventListener('dragend', cleanupDrag);
  handle.addEventListener('mouseleave', (e) => {
    if (handle._dragRow) return;
    if (e.relatedTarget && (e.relatedTarget.closest?.('#page-content table, #entity-freetext table') || e.relatedTarget === handle)) return;
    handle.style.opacity = '0';
  });
  return handle;
}

function _noteTableInsertRowNear(cell, where, editable = _noteTableEditable(cell?.closest?.('table'))) {
  const row = cell?.parentElement;
  if (!row) return null;
  if (!_noteTableCanEdit(editable)) return null;
  const colIdx = Math.max(0, _noteTableColumnIndex(cell));
  const beforeHtml = editable ? editable.innerHTML : '';
  const colCount = Math.max(row.children.length, 1);
  const newRow = document.createElement('tr');
  _noteTablePushCustomUndo(editable);
  for (let i = 0; i < colCount; i += 1) {
    const tag = row.children[i]?.tagName?.toLowerCase() === 'th' ? 'th' : 'td';
    newRow.appendChild(document.createElement(tag));
  }
  if (where === 'before') row.before(newRow);
  else row.after(newRow);
  _noteTableDispatchInput(editable, beforeHtml);
  return newRow.children[Math.min(colIdx, newRow.children.length - 1)] || newRow.firstElementChild;
}

function _noteTableInsertColumnNear(cell, where, editable = _noteTableEditable(cell?.closest?.('table'))) {
  const table = cell?.closest?.('table');
  const row = cell?.parentElement;
  if (!table || !row) return null;
  if (!_noteTableCanEdit(editable)) return null;
  const colIdx = Math.max(0, _noteTableColumnIndex(cell));
  const targetColIdx = where === 'before' ? colIdx : colIdx + 1;
  const beforeHtml = editable ? editable.innerHTML : '';
  let selected = null;
  _noteTablePushCustomUndo(editable);
  _noteTableInsertColgroupColumn(table, targetColIdx);
  table.querySelectorAll('tr').forEach((tr, rowIndex) => {
    const newCell = _noteTableNewCellForRow(tr, rowIndex);
    const ref = tr.children[colIdx];
    if (where === 'before') {
      if (ref) ref.before(newCell);
      else tr.appendChild(newCell);
    } else if (ref?.nextElementSibling) {
      ref.nextElementSibling.before(newCell);
    } else {
      tr.appendChild(newCell);
    }
    if (tr === row) selected = newCell;
  });
  _noteTableSyncCellWidthsFromColgroup(table);
  _noteTableDispatchInput(editable, beforeHtml);
  return selected;
}

async function _noteTableDeleteRow(cell, editable = _noteTableEditable(cell?.closest?.('table'))) {
  const table = cell?.closest?.('table');
  const row = cell?.parentElement;
  if (!table || !row) return false;
  if (!_noteTableCanEdit(editable)) return false;
  const removesTable = table.querySelectorAll('tr').length <= 1;
  const ok = await _noteTableConfirm(removesTable ? '最後の行です。表全体を削除しますか？' : 'この行を削除しますか？');
  if (!ok) return false;
  const colIdx = Math.max(0, _noteTableColumnIndex(cell));
  const beforeHtml = editable ? editable.innerHTML : '';
  _noteTablePushCustomUndo(editable);
  if (removesTable) {
    table.remove();
    _closeNoteTableCellControls();
  } else {
    const nextRow = row.nextElementSibling || row.previousElementSibling;
    const nextCell = nextRow?.children?.[Math.min(colIdx, Math.max(0, nextRow.children.length - 1))] || null;
    row.remove();
    if (nextCell) _showNoteTableCellControls(nextCell);
  }
  _noteTableDispatchInput(editable, beforeHtml);
  return true;
}

async function _noteTableDeleteColumn(cell, editable = _noteTableEditable(cell?.closest?.('table'))) {
  const table = cell?.closest?.('table');
  const row = cell?.parentElement;
  if (!table || !row) return false;
  if (!_noteTableCanEdit(editable)) return false;
  const rows = [...table.rows];
  if (!rows.length) return false;
  const colIdx = Math.max(0, _noteTableColumnIndex(cell));
  const colCount = Math.max(...rows.map(tr => tr.cells.length));
  const ok = await _noteTableConfirm(colCount <= 1 ? '最後の列です。表全体を削除しますか？' : 'この列を削除しますか？');
  if (!ok) return false;
  const beforeHtml = editable ? editable.innerHTML : '';
  const nextCell = row.cells[colIdx + 1] || row.cells[colIdx - 1] || null;
  _noteTablePushCustomUndo(editable);
  if (colCount <= 1) {
    table.remove();
    _closeNoteTableCellControls();
  } else {
    _noteTableDeleteColgroupColumn(table, colIdx);
    rows.forEach((tr) => {
      if (colIdx < tr.cells.length) tr.deleteCell(colIdx);
    });
    _noteTableSyncCellWidthsFromColgroup(table);
    if (nextCell?.isConnected) _showNoteTableCellControls(nextCell);
  }
  _noteTableDispatchInput(editable, beforeHtml);
  return true;
}

async function _noteTableDeleteTable(table, editable = _noteTableEditable(table)) {
  if (!table) return false;
  if (!_noteTableCanEdit(editable)) return false;
  const ok = await _noteTableConfirm('表を削除しますか？');
  if (!ok) return false;
  const beforeHtml = editable ? editable.innerHTML : '';
  _noteTablePushCustomUndo(editable);
  table.remove();
  _noteTableDispatchInput(editable, beforeHtml);
  _closeNoteTableCellControls();
  return true;
}

function _noteTableSetButtonPosition(btn, left, top) {
  if (!btn) return;
  btn.style.left = left + 'px';
  btn.style.top = top + 'px';
  if (typeof clampPopupToViewport === 'function') clampPopupToViewport(btn);
}

function _positionNoteTableCellControls(cell = _noteTableActiveCell, controls = _noteTableControls) {
  if (!cell?.isConnected || !controls?.isConnected) {
    _closeNoteTableCellControls();
    return;
  }
  const rect = cell.getBoundingClientRect();
  const z = _noteTableUiZoom();
  const frame = controls.querySelector('.note-table-cell-frame');
  if (frame) {
    frame.style.left = (rect.left / z) + 'px';
    frame.style.top = (rect.top / z) + 'px';
    frame.style.width = Math.max(0, rect.width / z) + 'px';
    frame.style.height = Math.max(0, rect.height / z) + 'px';
  }
  const top = controls.querySelector('[data-note-table-action="insert-row-before"]');
  const bottom = controls.querySelector('[data-note-table-action="insert-row-after"]');
  const left = controls.querySelector('[data-note-table-action="insert-column-before"]');
  const right = controls.querySelector('[data-note-table-action="insert-column-after"]');
  const menu = controls.querySelector('[data-note-table-action="menu"]');
  const plusW = top?.offsetWidth || 22;
  const plusH = top?.offsetHeight || 22;
  const menuW = menu?.offsetWidth || 24;
  _noteTableSetButtonPosition(top, (rect.left + rect.width / 2 - plusW / 2) / z, (rect.top - plusH - 4) / z);
  _noteTableSetButtonPosition(bottom, (rect.left + rect.width / 2 - plusW / 2) / z, (rect.bottom + 4) / z);
  _noteTableSetButtonPosition(left, (rect.left - plusW - 4) / z, (rect.top + rect.height / 2 - plusH / 2) / z);
  _noteTableSetButtonPosition(right, (rect.right + 4) / z, (rect.top + rect.height / 2 - plusH / 2) / z);
  _noteTableSetButtonPosition(menu, (rect.right - menuW - 3) / z, (rect.top + 3) / z);
}

function _closeNoteTableCellControls() {
  if (_noteTableControls) {
    if (typeof _noteTableControls._cleanup === 'function') _noteTableControls._cleanup();
    _noteTableControls.remove();
  }
  _noteTableControls = null;
  _noteTableActiveCell = null;
}

function _noteTableControlButton(action, label, title) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = action === 'menu' ? 'note-table-cell-menu-btn' : 'note-table-cell-plus';
  btn.dataset.noteTableAction = action;
  btn.dataset.e2eId = 'note-table-cell-' + action;
  btn.title = title;
  btn.setAttribute('aria-label', title);
  btn.innerHTML = _noteEnhanceRenderIcon(action === 'menu' ? 'moreHorizontal' : 'plus', 14, label);
  btn.contentEditable = 'false';
  btn.addEventListener('mousedown', (ev) => ev.preventDefault());
  return btn;
}

function _ensureNoteTableCellControls() {
  if (_noteTableControls?.isConnected) return _noteTableControls;
  const controls = document.createElement('div');
  controls.className = 'note-table-cell-controls';
  controls.contentEditable = 'false';
  controls.appendChild(Object.assign(document.createElement('div'), { className: 'note-table-cell-frame' }));
  controls.appendChild(_noteTableControlButton('insert-row-before', '+', '行を上に追加'));
  controls.appendChild(_noteTableControlButton('insert-row-after', '+', '行を下に追加'));
  controls.appendChild(_noteTableControlButton('insert-column-before', '+', '列を左に追加'));
  controls.appendChild(_noteTableControlButton('insert-column-after', '+', '列を右に追加'));
  controls.appendChild(_noteTableControlButton('menu', '…', '表の操作メニュー'));
  controls.addEventListener('click', async (ev) => {
    const action = ev.target?.dataset?.noteTableAction || '';
    if (!action) return;
    ev.preventDefault();
    ev.stopPropagation();
    const cell = controls._cell;
    if (!cell?.isConnected) {
      _closeNoteTableCellControls();
      return;
    }
    const editable = _noteTableEditable(cell.closest?.('table'));
    if (!_noteTableCanEdit(editable)) return;
    let nextCell = null;
    if (action === 'insert-row-before') nextCell = _noteTableInsertRowNear(cell, 'before');
    else if (action === 'insert-row-after') nextCell = _noteTableInsertRowNear(cell, 'after');
    else if (action === 'insert-column-before') nextCell = _noteTableInsertColumnNear(cell, 'before');
    else if (action === 'insert-column-after') nextCell = _noteTableInsertColumnNear(cell, 'after');
    else if (action === 'menu') {
      const rect = ev.target.getBoundingClientRect();
      _showNoteTableCellMenu(cell, rect.left, rect.bottom);
      return;
    }
    if (nextCell?.isConnected) _showNoteTableCellControls(nextCell);
    else _positionNoteTableCellControls(cell, controls);
  });
  document.body.appendChild(controls);
  _noteTableControls = controls;
  return controls;
}

function _showNoteTableCellControls(cell) {
  if (!cell?.isConnected || !cell.closest?.(_NOTE_TABLE_SELECTOR)) {
    _closeNoteTableCellControls();
    return null;
  }
  document.querySelectorAll('.table-mini-toolbar').forEach(existing => {
    if (typeof existing._cleanup === 'function') existing._cleanup();
    existing.remove();
  });
  const controls = _ensureNoteTableCellControls();
  _noteTableActiveCell = cell;
  controls._cell = cell;
  _positionNoteTableCellControls(cell, controls);

  const reposition = () => _positionNoteTableCellControls(controls._cell, controls);
  const closeOutside = (ev) => {
    const target = ev.target;
    if (target?.closest?.('.note-table-cell-controls, .table-cell-menu')) return;
    if (_noteTableCellFromTarget(target)) return;
    _closeNoteTableCellControls();
  };
  const closeOnEscape = (ev) => {
    if (ev.key === 'Escape') _closeNoteTableCellControls();
  };
  if (typeof controls._cleanup === 'function') controls._cleanup();
  controls._cleanup = () => {
    window.removeEventListener('scroll', reposition, true);
    window.removeEventListener('resize', reposition);
    document.removeEventListener('mousedown', closeOutside, true);
    document.removeEventListener('keydown', closeOnEscape, true);
  };
  window.addEventListener('scroll', reposition, true);
  window.addEventListener('resize', reposition);
  document.addEventListener('mousedown', closeOutside, true);
  document.addEventListener('keydown', closeOnEscape, true);
  return controls;
}

function _noteTableMenuSeparator() {
  const sep = document.createElement('div');
  sep.className = 'gb-context-menu-sep';
  return sep;
}

function _showNoteTableCellMenu(cell, x, y, options = {}) {
  const table = cell?.closest?.('table');
  const editable = options.editable || _noteTableEditable(table);
  if (!table) return null;
  if (!_noteTableCanEdit(editable)) return null;
  document.querySelectorAll('.table-cell-menu, .gb-context-menu').forEach(m => m.remove());
  const menu = document.createElement('div');
  menu.className = 'table-cell-menu gb-context-menu';
  menu.dataset.e2eId = 'note-table-cell-menu';
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', '表の操作メニュー');

  const mkItem = (id, label, handler, danger = false) => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'gb-context-menu-item' + (danger ? ' danger' : '');
    item.dataset.e2eId = 'note-table-cell-menu-' + id;
    item.setAttribute('role', 'menuitem');
    item.setAttribute('aria-label', label);
    const labelEl = document.createElement('span');
    labelEl.className = 'gb-context-menu-item-label';
    labelEl.textContent = label;
    item.appendChild(labelEl);
    item.addEventListener('click', async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      menu.remove();
      const result = await handler();
      if (result?.isConnected) _showNoteTableCellControls(result);
      else if (cell?.isConnected) _positionNoteTableCellControls(cell);
    });
    return item;
  };

  menu.appendChild(mkItem('insert-row-before', '行を上に追加', () => _noteTableInsertRowNear(cell, 'before', editable)));
  menu.appendChild(mkItem('insert-row-after', '行を下に追加', () => _noteTableInsertRowNear(cell, 'after', editable)));
  menu.appendChild(mkItem('insert-column-before', '列を左に追加', () => _noteTableInsertColumnNear(cell, 'before', editable)));
  menu.appendChild(mkItem('insert-column-after', '列を右に追加', () => _noteTableInsertColumnNear(cell, 'after', editable)));
  menu.appendChild(_noteTableMenuSeparator());
  menu.appendChild(mkItem('delete-row', 'この行を削除', () => _noteTableDeleteRow(cell, editable), true));
  menu.appendChild(mkItem('delete-column', 'この列を削除', () => _noteTableDeleteColumn(cell, editable), true));
  menu.appendChild(_noteTableMenuSeparator());
  menu.appendChild(mkItem('delete-table', '表を削除', () => _noteTableDeleteTable(table, editable), true));

  document.body.appendChild(menu);
  if (typeof positionPopup === 'function') {
    positionPopup(menu, { left: x, right: x, top: y, bottom: y });
  } else {
    const z = _noteTableUiZoom();
    menu.style.left = (x / z) + 'px';
    menu.style.top = (y / z) + 'px';
  }
  const closeMenu = (ev) => {
    if (!menu.contains(ev.target) && !ev.target?.closest?.('.note-table-cell-controls')) {
      menu.remove();
      document.removeEventListener('mousedown', closeMenu, true);
    }
  };
  setTimeout(() => document.addEventListener('mousedown', closeMenu, true), 0);
  return menu;
}

function _initTableOperations() {
  _ensureTableRowDragHandle();
  document.addEventListener('pointermove', (e) => {
    if (_noteTableResizeState) {
      _noteTableResizeMove(e);
      return;
    }
    _noteTableSetResizeHover(_noteTableCellAtResizeEdge(e));
  });
  document.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    _noteTableStartResize(e);
  }, true);
  document.addEventListener('pointerup', _noteTableFinishResize, true);
  document.addEventListener('pointercancel', _noteTableFinishResize, true);
  document.addEventListener('click', (e) => {
    const cell = _noteTableCellFromTarget(e.target);
    if (cell) _showNoteTableCellControls(cell);
  });

  // セルクリックで直接編集
  document.addEventListener('click', (e) => {
    const cell = e.target.closest('td, th');
    if (!cell || !cell.closest('#page-content table, #entity-freetext table')) return;
    if (cell.closest('[contenteditable="true"]')) return; // contentEditable内テーブルは gb-editor.js に委譲
    if (cell.querySelector('input.cell-edit')) return;
    const editable = cell.closest('#page-content, #entity-freetext');
    if (!_noteTableCanEdit(editable)) return;

    const input = document.createElement('input');
    input.className = 'cell-edit';
    input.type = 'text';
    input.value = cell.textContent.trim();
    input.style.cssText = 'width:100%;border:none;background:transparent;color:inherit;font:inherit;padding:0;outline:none;';

    const originalText = cell.textContent;
    let cancelled = false;
    cell.textContent = '';
    cell.appendChild(input);
    input.focus();
    input.select();

    input.addEventListener('blur', () => {
      if (cancelled) return;
      cell.textContent = input.value;
      const pc = cell.closest('#page-content, #entity-freetext');
      _noteTableDispatchInput(pc);
    });

    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') { ev.preventDefault(); input.blur(); }
      if (ev.key === 'Escape') { cancelled = true; cell.textContent = originalText; }
      if (ev.key === 'Tab') {
        ev.preventDefault();
        input.blur();
        const nextCell = ev.shiftKey ? cell.previousElementSibling : cell.nextElementSibling;
        if (nextCell) nextCell.click();
        else {
          const row = cell.parentElement;
          const nextRow = ev.shiftKey ? row.previousElementSibling : row.nextElementSibling;
          if (nextRow) {
            const target = ev.shiftKey ? nextRow.lastElementChild : nextRow.firstElementChild;
            if (target) target.click();
          }
        }
      }
    });
  });
}
_initTableOperations();
window.showNoteTableCellControls = _showNoteTableCellControls;

// テーブルセル右クリックで行/列削除メニュー（editable コンテナ委譲）
// 旧: document 委譲 → editable コンテナ個別登録へ移行（global-contextmenu-refactor-plan.md）
// 4-7: セル判定セレクタを closest('td, th') に簡略化。これにより #dp-editable 内テーブルも拾える。
function _tableCellCtxMenuHandler(e) {
  const editable = e.currentTarget;
  const cell = e.target.closest('td, th');
  if (!cell) return;
  const table = cell.closest('table');
  if (!table) return;
  if (!_noteTableCanEdit(editable, { silent: true })) return;
  e.preventDefault();
  e.stopPropagation();
  e.stopImmediatePropagation?.();
  _showNoteTableCellControls(cell);
  _showNoteTableCellMenu(cell, e.clientX, e.clientY, { editable });
}

// editable コンテナにテーブルセルメニューを付ける
function bindTableCellContextMenu(el) {
  if (!el || el._tableCellCtxMenuAttached) return;
  el._tableCellCtxMenuAttached = true;
  el.addEventListener('contextmenu', _tableCellCtxMenuHandler);
  // タッチ/ペンの長押しでも同じハンドラを発火
  if (typeof addLongPressHandler === 'function') addLongPressHandler(el, _tableCellCtxMenuHandler);
}

// 静的要素に初期バインド（#dp-editable は gb-detail-panel.part02.js の _dpBindAutoSave で動的バインド）
bindTableCellContextMenu(document.getElementById('page-content'));
bindTableCellContextMenu(document.getElementById('entity-freetext'));

// ============================================================
// 行頭記法（工程6） — 「・」「数値」「h1〜h6」「既存の#〜######」+ Space
// ============================================================
// 計画書§5工程6: 共通の現在行変換（gb-note-block-types.js の
// MeldexNoteBlockTypes.convertCurrentLineTo）へ委譲する。現在行の解決境界も
// レジストリの resolveCurrentBlock を正本にし、旧実装（#page-content 直下の
// div/p/h1-6/blockquote だけを対象にした専用ロジック）は残さない。

// 行頭からキャレットまでのテキスト（改行区切りの現在行部分）を取得する。
function _noteLineTextBeforeCaret(block, range) {
  const before = range.cloneRange();
  before.setStart(block, 0);
  const text = before.toString().replace(/\u00a0/g, ' ');
  return text.slice(text.lastIndexOf('\n') + 1);
}

// 行頭記法トリガーの判定。一致しなければ null。
// - 「・」→ 箇条書き
// - 数値（1桁以上）→ 番号付きリスト（入力した数値をstartとして保持）
// - h1〜h6（大小文字問わず）→ 見出し1〜6
// - 既存の #〜###### → 見出し1〜6（維持）
function _noteLineStartTrigger(lineText) {
  const headingHash = lineText.match(/^(#{1,6})$/);
  if (headingHash) return { typeId: 'h' + headingHash[1].length };
  const headingLetter = lineText.match(/^[hH]([1-6])$/);
  if (headingLetter) return { typeId: 'h' + headingLetter[1] };
  if (lineText === '・') return { typeId: 'ul' }; // 「・」
  const ordered = lineText.match(/^(\d+)$/);
  if (ordered) return { typeId: 'ol', orderedStart: parseInt(ordered[1], 10) };
  return null;
}

function _handleNoteMarkdownShortcutKeydown(e) {
  if (e.defaultPrevented || e.isComposing) return; // IME変換中は誤発火させない（工程6必須要件）
  if (e.key !== ' ' && e.key !== 'Spacebar') return;
  if (typeof MeldexNoteBlockTypes === 'undefined') return;
  const editable = e.target?.closest?.(MeldexNoteBlockTypes.EDITABLE_SELECTOR);
  if (!editable || editable.contentEditable !== 'true') return;
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return;
  const range = sel.getRangeAt(0);
  if (!editable.contains(range.startContainer)) return;
  const info = MeldexNoteBlockTypes.resolveCurrentBlock(editable, range);
  if (!info) return;
  // コード・表・コールアウト内では行頭記法を認識しない（誤変換防止。従来挙動を維持）
  if (info.kind === 'code' || info.kind === 'table' || info.kind === 'callout') return;
  const lineText = _noteLineTextBeforeCaret(info.block, range);
  const trigger = _noteLineStartTrigger(lineText);
  if (!trigger) return;

  e.preventDefault();
  const originalRange = range.cloneRange();
  MeldexNoteBlockTypes.convertCurrentLineTo(trigger.typeId, {
    editable,
    range: originalRange,
    orderedStart: trigger.orderedStart,
    // トリガー文字（"###" 等）の削除は、共通変換の undo push 直後・DOM変換の
    // 直前で実行し、「削除＋行種変換」を1回のUndoにまとめる（§5工程4-4）。
    beforeConvert(convInfo, convRange) {
      const deleteRange = convRange.cloneRange();
      deleteRange.setStart(convInfo.block, 0);
      const lineIdSpan = convInfo.block.firstElementChild?.classList?.contains('_nl-id') ? convInfo.block.firstElementChild : null;
      if (lineIdSpan) deleteRange.setStartAfter(lineIdSpan);
      deleteRange.deleteContents();
    },
  });
}

function bindNoteMarkdownShortcuts() {
  if (document._noteMarkdownShortcutAttached) return;
  document._noteMarkdownShortcutAttached = true;
  // captureフェーズの単一リスナーへ集約する（#page-content 限定だった旧実装から
  // #entity-freetext・#dp-editable へも一般化。動的生成される編集ホストにも
  // 個別バインド不要で追従する）。
  document.addEventListener('keydown', _handleNoteMarkdownShortcutKeydown, true);
}

bindNoteMarkdownShortcuts();

// スラッシュコマンドのイベントリスナー登録（キー操作は gb-note-block-menu.js が
// document capture フェーズで処理する。ここでは / の検出のみ）
document.addEventListener('input', _onSlashInput);
