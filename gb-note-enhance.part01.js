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
const _DB_FILE_STYLE_VIEWS = new Set(['pivot', 'gallery', 'kanban', 'timeline', 'chart', 'graph', 'calendar', 'tasks', 'shifts', 'entity', 'smart-db']);
const _SCRIPTNOTE_BUILTIN_STYLE_PRESETS = [
  { name: 'デフォルト', style: {}, context: 'scriptnote' },
];
const _SCRIPTNOTE_REMOVED_FILE_STYLE_KEYS = ['pageBgColor'];
const _SCRIPTNOTE_FILE_STYLE_KEYS = [
  'borderColor',
  'borderWidth',
  'baseTextColor',
  'baseTextBold',
  'baseTextItalic',
  'baseTextFontFamily',
  'baseTextFontSize',
  'baseTextLineHeight',
  'baseTextLetterSpacing',
  'baseTextLineHeightH',
  'baseTextLineHeightV',
  'baseTextLetterSpacingH',
  'baseTextLetterSpacingV',
  'rubyFontSize',
  'rubyOffset',
  'spreadBorderColor',
  'spreadBorderWidth',
  'wrapMode',
  'hoverBgColor',
  'caretColor',
  'caretWidth',
  'dragSelectColor',
  'selectionColor',
  'selectionTextColor',
  'dropIndicatorColor',
  'dropIndicatorWidth',
  'themeId',
  '__themeName',
  '__themeSourceId',
  '__useOsAccentColor',
  '--theme-palette-0',
  '--theme-palette-1',
  '--theme-palette-2',
  '--theme-palette-3',
  '--theme-palette-4',
  '--theme-palette-5',
  '--theme-palette-6',
  '--theme-palette-7',
  '--theme-palette-8',
  '--theme-palette-9',
];
const _SCRIPTNOTE_FILE_STYLE_DEFAULTS = {
  wrapMode: true,
};
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

function _filterScriptnoteFileStyle(style) {
  if (!style || typeof style !== 'object' || Array.isArray(style)) return {};
  const next = {};
  Object.entries(style).forEach(([key, value]) => {
    if (!_isScriptnoteFileStyleKey(key)) return;
    if (value === undefined || value === null || value === '') return;
    next[key] = value;
  });
  return next;
}

function _isScriptnoteFileStyleKey(key) {
  const value = String(key || '').trim();
  return _SCRIPTNOTE_FILE_STYLE_KEYS.includes(value) || value.startsWith('--') || /^__[A-Za-z0-9_-]+$/.test(value);
}

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
  if (Object.keys(style).length === 0) {
    if (typeof _saveFileTheme === 'function') _saveFileTheme(null);
    if (ctx !== 'scriptnote') {
      const panelId = _getActivePanelId();
      if (panelId) clearFileStyleForPanel(panelId);
    }
  } else {
    if (typeof _saveFileTheme === 'function') _saveFileTheme(style);
    if (ctx !== 'scriptnote') {
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

function resetCurrentFileStyle() {
  const ctx = _getCurrentFileStyleContext();
  if (typeof _saveFileTheme === 'function') _saveFileTheme(null);
  if (ctx !== 'scriptnote') {
    const panelId = _getActivePanelId();
    if (panelId) clearFileStyleForPanel(panelId);
  }
  showStatus('スタイルをリセットしました');
}

// ============================================================
// 2. スラッシュコマンド
// ============================================================
let _slashMenuActive = false;
let _slashMenuSelection = 0;

const _SLASH_COMMANDS = [
  { id: 'h1', label: '見出し1', icon: 'hash', keywords: ['見出し', 'heading', 'h1', 'みだし'] },
  { id: 'h2', label: '見出し2', icon: 'hash', keywords: ['見出し', 'heading', 'h2', 'みだし'] },
  { id: 'h3', label: '見出し3', icon: 'hash', keywords: ['見出し', 'heading', 'h3', 'みだし'] },
  { id: 'ul', label: '箇条書きリスト', icon: 'minus', keywords: ['リスト', 'list', 'bullet', 'りすと'] },
  { id: 'ol', label: '番号付きリスト', icon: 'hash', keywords: ['番号', 'リスト', 'number', 'ordered', 'ばんごう'] },
  { id: 'check', label: 'チェックリスト', icon: 'checkSquare', keywords: ['チェック', 'check', 'todo', 'ちぇっく'] },
  { id: 'table', label: 'テーブル', icon: 'table', keywords: ['テーブル', 'table', '表', 'ひょう'] },
  { id: 'callout', label: 'コールアウト', icon: 'alertTriangle', keywords: ['コールアウト', 'callout', '注意', 'info'] },
  { id: 'hr', label: '水平線', icon: 'minus', keywords: ['水平線', 'hr', 'line', 'すいへいせん'] },
  { id: 'code', label: 'コードブロック', icon: 'fileText', keywords: ['コード', 'code', 'こーど'] },
  { id: 'quote', label: '引用', icon: 'fileText', keywords: ['引用', 'quote', 'いんよう'] },
];

function _createSlashMenu() {
  const menu = document.createElement('div');
  menu.id = 'slash-menu';
  menu.style.display = 'none';
  document.body.appendChild(menu);
  menu.addEventListener('mousedown', (e) => e.preventDefault()); // フォーカス奪取防止
  return menu;
}

function _renderSlashMenuItems(query) {
  const menu = document.getElementById('slash-menu') || _createSlashMenu();
  const q = (query || '').toLowerCase();
  const filtered = q ? _SLASH_COMMANDS.filter(c =>
    c.label.toLowerCase().includes(q) || c.id.includes(q) || c.keywords.some(k => k.toLowerCase().includes(q))
  ) : _SLASH_COMMANDS;

  if (filtered.length === 0) { menu.style.display = 'none'; _slashMenuActive = false; return; }
  if (_slashMenuSelection >= filtered.length) _slashMenuSelection = 0;

  menu.innerHTML = filtered.map((c, i) =>
    `<div class="slash-item${i === _slashMenuSelection ? ' selected' : ''}" data-cmd="${c.id}">` +
    `<span class="slash-icon">${typeof lucide === 'function' ? lucide(c.icon, 16) : ''}</span>` +
    `<span>${esc(c.label)}</span></div>`
  ).join('');

  menu.querySelectorAll('.slash-item').forEach(item => {
    item.addEventListener('click', () => _executeSlashCommand(item.dataset.cmd));
  });
}

function _showSlashMenu() {
  const sel = window.getSelection();
  if (!sel.rangeCount) return;
  const range = sel.getRangeAt(0);
  const rect = range.getBoundingClientRect();
  const menu = document.getElementById('slash-menu') || _createSlashMenu();
  _slashMenuActive = true;
  _slashMenuSelection = 0;
  _renderSlashMenuItems('');
  { const z = _getZoom(); menu.style.top = (rect.bottom / z + 4) + 'px'; menu.style.left = (rect.left / z) + 'px'; }
  menu.style.display = '';
  clampPopupToViewport(menu);
  const raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (fn) => setTimeout(fn, 0);
  raf(() => {
    if (_slashMenuActive && menu.style.display !== 'none') clampPopupToViewport(menu);
  });
}

function _hideSlashMenu() {
  const menu = document.getElementById('slash-menu');
  if (menu) menu.style.display = 'none';
  _slashMenuActive = false;
}

function _executeSlashCommand(cmd) {
  const sel = window.getSelection();
  if (!sel.rangeCount) { _hideSlashMenu(); return; }
  const range = sel.getRangeAt(0);
  const node = range.startContainer;
  if (node.nodeType === Node.TEXT_NODE) {
    const slashIdx = node.textContent.lastIndexOf('/', Math.max(0, range.startOffset - 1));
    if (slashIdx >= 0 && slashIdx < range.startOffset) {
      node.textContent = node.textContent.substring(0, slashIdx) + node.textContent.substring(range.startOffset);
      range.setStart(node, slashIdx);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
    }
  }
  const insertMap = {
    h1: '<h1>見出し</h1>', h2: '<h2>見出し</h2>', h3: '<h3>見出し</h3>',
    ul: '<ul><li>項目</li></ul>', ol: '<ol><li>項目</li></ol>',
    check: '<ul><li>[ ] 項目</li></ul>',
    hr: '<hr>', code: '<pre style="background:var(--bg3);padding:8px;border-radius:4px;overflow-x:auto;font-size:13px;"><code>コード</code></pre>',
    callout: '<div class="callout-block callout-info" contenteditable="false"><span class="callout-icon" data-icon="info" style="color:#569cd6;">' + (typeof lucide === 'function' ? lucide('info', 20) : 'ℹ') + '</span><div class="callout-body" contenteditable="true">テキスト</div></div>',
    table: '<table><tr><th>列1</th><th>列2</th></tr><tr><td>-</td><td>-</td></tr></table>',
    quote: '<blockquote>引用</blockquote>',
  };
  if (insertMap[cmd]) document.execCommand('insertHTML', false, insertMap[cmd]);
  _hideSlashMenu();
}

// inputイベントで/を検出
function _onSlashInput(e) {
  if (e.isComposing) return; // IME変換中はスキップ
  const pc = e.target.closest('#page-content');
  if (!pc) return;
  const sel = window.getSelection();
  if (!sel.rangeCount) return;
  const range = sel.getRangeAt(0);
  const node = range.startContainer;
  if (node.nodeType !== Node.TEXT_NODE) { if (_slashMenuActive) _hideSlashMenu(); return; }
  const text = node.textContent;
  const pos = range.startOffset;
  const lineStart = text.lastIndexOf('\n', pos - 2) + 1;
  const lineText = text.substring(lineStart, pos);

  if (lineText === '/') {
    _showSlashMenu();
  } else if (lineText.startsWith('/') && lineText.length > 1) {
    if (_slashMenuActive) _renderSlashMenuItems(lineText.substring(1));
  } else {
    if (_slashMenuActive) _hideSlashMenu();
  }
}

// keydownイベントでメニュー操作
function _onSlashKeydown(e) {
  if (e.isComposing) return; // IME変換中はスキップ
  if (!_slashMenuActive) return;
  const menu = document.getElementById('slash-menu');
  if (!menu || menu.style.display === 'none') return;
  const items = menu.querySelectorAll('.slash-item');
  if (items.length === 0) return;

  if (e.key === 'ArrowDown') {
    e.preventDefault();
    _slashMenuSelection = (_slashMenuSelection + 1) % items.length;
    items.forEach((it, i) => it.classList.toggle('selected', i === _slashMenuSelection));
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    _slashMenuSelection = (_slashMenuSelection - 1 + items.length) % items.length;
    items.forEach((it, i) => it.classList.toggle('selected', i === _slashMenuSelection));
  } else if (e.key === 'Enter') {
    e.preventDefault();
    const selected = items[_slashMenuSelection];
    if (selected) _executeSlashCommand(selected.dataset.cmd);
  } else if (e.key === 'Escape') {
    e.preventDefault();
    _hideSlashMenu();
  }
}

// ============================================================
// 3. ブロックドラッグハンドル
// ============================================================
function _initBlockDragHandle() {
  const pc = document.getElementById('page-content');
  if (!pc || pc._blockDragInit) return;
  pc._blockDragInit = true;

  // ハンドルは document.body 直下に position:fixed で配置する。
  // - page-content の親 (フレックスコンテナ) に置くと目次 (note-toc 200px + リサイザ 6px)
  //   の幅を考慮できず目次領域内に着地してしまう (旧バグ)
  // - page-content 自身に置くと contenteditable な innerHTML に入り込んで保存内容を汚染する
  // 上記を避けるため body 直下 + viewport 座標で配置する
  const handle = document.createElement('div');
  handle.id = 'block-drag-handle';
  handle.innerHTML = '⠿';
  handle.style.cssText = 'position:fixed;left:0;top:0;width:20px;height:20px;cursor:grab;opacity:0;transition:opacity 0.15s;color:var(--fg2);font-size:16px;display:flex;align-items:center;justify-content:center;z-index:10000;user-select:none;pointer-events:auto;';
  handle.draggable = true;
  handle.setAttribute('contenteditable', 'false');
  document.body.appendChild(handle);

  // section内のブロックにもマッチするヘルパー
  function _findBlock(el) {
    // heading-section内の直接ブロック、またはpage-content直下のブロックを返す
    let node = el;
    while (node && node !== pc) {
      if (node === handle || node.id === 'block-drag-handle') return null; // ハンドル自身は除外
      if (node.parentElement === pc || (node.parentElement && node.parentElement.classList?.contains('heading-section'))) return node;
      node = node.parentElement;
    }
    return null;
  }

  // ハンドルの viewport 座標を計算
  // - left: page-content の padding-left の 22px 内側 (固定)
  // - top: マウス Y にハンドル中心を合わせる (block 範囲内にクランプ)
  //   これによりユーザーがハンドルに向かって左に動かすだけで掴める。
  //   旧実装は blockRect.top にハンドルを置いていたため、ハンドルへ向かう途中で
  //   上のブロック領域に侵入して mouseover が再発火し、ハンドルが連鎖的に上方へ逃げていた。
  const HANDLE_H = 20;
  function _positionHandle(blockRect, mouseY) {
    const pcRect = pc.getBoundingClientRect();
    const cs = getComputedStyle(pc);
    const padLeft = parseFloat(cs.paddingLeft) || 0;
    const z = (typeof _getZoom === 'function') ? _getZoom() : 1;
    // ハンドル top: マウス Y の中心合わせ。ブロック範囲を超えないようクランプ
    const minTop = blockRect.top;
    const maxTop = Math.max(blockRect.top, blockRect.bottom - HANDLE_H);
    const desiredTop = (typeof mouseY === 'number') ? (mouseY - HANDLE_H / 2) : blockRect.top;
    const top = Math.min(maxTop, Math.max(minTop, desiredTop));
    handle.style.top = (top / z) + 'px';
    handle.style.left = ((pcRect.left + Math.max(0, padLeft - 22)) / z) + 'px';
  }

  // 直前にハンドルを表示したマウス Y。同じブロック内で微小に動いただけならハンドルを動かさない
  // (描画ジッタを防ぐ + 常に新しいマウス位置に追随するとドラッグ開始時に位置がブレる)
  let _lastBlock = null;
  let _lastMouseY = null;

  pc.addEventListener('mousemove', (e) => {
    if (handle._dragBlock) return; // ドラッグ中は再配置しない
    const block = _findBlock(e.target);
    if (!block || block.tagName === 'BR') {
      // padding 内など block 外: ハンドルは現在位置のまま据え置き、表示状態だけは維持
      return;
    }
    // 別ブロックに入った、または同一ブロック内で 16px 以上 Y が動いたときだけ再配置
    if (block !== _lastBlock || _lastMouseY === null || Math.abs(e.clientY - _lastMouseY) > 16) {
      _positionHandle(block.getBoundingClientRect(), e.clientY);
      _lastBlock = block;
      _lastMouseY = e.clientY;
    }
    handle.style.opacity = '1';
    handle._targetBlock = block;
  });
  pc.addEventListener('mouseleave', (e) => {
    // ハンドル上にカーソルが移ったときは隠さない
    if (e.relatedTarget === handle) return;
    handle.style.opacity = '0';
    _lastBlock = null;
    _lastMouseY = null;
  });
  // ハンドルから外れたら隠す (page-content に戻る場合は mousemove で再表示される)
  handle.addEventListener('mouseleave', (e) => {
    if (e.relatedTarget && pc.contains(e.relatedTarget)) return;
    handle.style.opacity = '0';
    _lastBlock = null;
    _lastMouseY = null;
  });

  // タッチ対応: touchstart でブロックドラッグハンドル表示
  pc.addEventListener('touchstart', (e) => {
    const block = _findBlock(e.target);
    if (block && block.tagName !== 'BR') {
      const t = e.touches?.[0];
      _positionHandle(block.getBoundingClientRect(), t?.clientY);
      _lastBlock = block;
      _lastMouseY = t?.clientY ?? null;
      handle.style.opacity = '1';
      handle._targetBlock = block;
    }
  }, { passive: true });

  handle.addEventListener('dragstart', (e) => {
    const block = handle._targetBlock;
    if (!block) { e.preventDefault(); return; }
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', '');
    block.classList.add('dragging');
    handle._dragBlock = block;
  });

  // dragover / drop は capture フェーズで登録する。
  // page-content には setupEditableDropHandler ([gb-editor.js](app/gb-editor.js)) のドロップ処理が
  // bubble フェーズで先に登録されており、bubble で動かすと
  //   1. 先に走る setupEditableDropHandler が `.drop-caret` を caretRangeFromPoint で表示してしまい
  //      ブロック境界とズレた位置にインジケーターが出る (「微妙にズレ」)
  //   2. 同じ handler の drop 内で `sel.addRange(range)` がカーソル位置を書き換え、
  //      その後の execCommand 周辺と相まってブロック移動の DOM 操作が破綻する
  // capture フェーズで先に拾い、ブロックドラッグなら stopPropagation して bubble 側を完全に止める。
  const _isBlockDrag = () => !!handle._dragBlock;

  function _blockAtClientY(clientY) {
    const blocks = [];
    Array.from(pc.children || []).forEach((child) => {
      if (child.nodeType !== Node.ELEMENT_NODE || child.tagName === 'BR') return;
      if (child.classList?.contains('heading-section')) {
        Array.from(child.children || []).forEach((sectionChild) => {
          if (sectionChild.nodeType === Node.ELEMENT_NODE && sectionChild.tagName !== 'BR') blocks.push(sectionChild);
        });
      }
      blocks.push(child);
    });
    let nearest = null;
    let nearestDistance = Infinity;
    for (const block of blocks) {
      const rect = block.getBoundingClientRect();
      if (clientY >= rect.top && clientY <= rect.bottom) return block;
      const distance = Math.min(Math.abs(clientY - rect.top), Math.abs(clientY - rect.bottom));
      if (distance < nearestDistance) {
        nearest = block;
        nearestDistance = distance;
      }
    }
    const pcRect = pc.getBoundingClientRect();
    return clientY >= pcRect.top && clientY <= pcRect.bottom ? nearest : null;
  }

  function _blockFromDragEvent(e) {
    const direct = _findBlock(e.target);
    if (direct) return direct;
    if (typeof document.elementFromPoint === 'function') {
      const prevPointerEvents = handle.style.pointerEvents;
      handle.style.pointerEvents = 'none';
      try {
        const hit = document.elementFromPoint(e.clientX, e.clientY);
        const hitBlock = _findBlock(hit);
        if (hitBlock) return hitBlock;
      } finally {
        handle.style.pointerEvents = prevPointerEvents;
      }
    }
    return _blockAtClientY(e.clientY);
  }

  function _handleBlockDragOver(e) {
    if (!_isBlockDrag() || !pc.isConnected) return;
    e.preventDefault();
    e.stopPropagation(); // bubble 側 (setupEditableDropHandler) を止める
    // setupEditableDropHandler が以前に作った drop-caret が残っていたら除去
    const stale = pc.querySelector('.drop-caret');
    if (stale) stale.remove();
    const target = _blockFromDragEvent(e);
    pc.querySelectorAll('.drag-guide-top, .drag-guide-bottom').forEach(el => el.classList.remove('drag-guide-top', 'drag-guide-bottom'));
    if (!target || target === handle._dragBlock) return;
    const rect = target.getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    if (e.clientY < midY) target.classList.add('drag-guide-top');
    else target.classList.add('drag-guide-bottom');
  }

  function _handleBlockDrop(e) {
    const dragBlock = handle._dragBlock;
    if (!dragBlock || !pc.isConnected) return; // ブロックドラッグでない場合は他 drop に任せる
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    let target = _blockFromDragEvent(e);
    pc.querySelectorAll('.drag-guide-top, .drag-guide-bottom').forEach(el => el.classList.remove('drag-guide-top', 'drag-guide-bottom'));
    const stale = pc.querySelector('.drop-caret');
    if (stale) stale.remove();
    // dragBlock の内側に落とした場合 (heading-section を引きずって自分の子要素にドロップ等):
    // dragBlock.contains(target) が真になり target.before(dragBlock) が
    // HierarchyRequestError ("The new child element contains the parent") を投げる。
    // この場合は dragBlock 自身を target として扱い (実質ノーオペ)、移動を諦める。
    if (target && dragBlock.contains(target)) target = dragBlock;
    if (!target || dragBlock === target) { dragBlock.classList.remove('dragging'); handle._dragBlock = null; return; }
    const rect = target.getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    const beforeHtml = pc.innerHTML;
    if (typeof _pushCustomUndo === 'function') _pushCustomUndo(pc);
    try {
      if (e.clientY < midY) target.before(dragBlock);
      else target.after(dragBlock);
    } catch (err) {
      // 防御的: 想定外の階層エラーが出ても dragging クラスは必ず解除する
      console.warn('block drop move failed:', err);
    }
    dragBlock.classList.remove('dragging');
    handle._dragBlock = null;
    if (pc.innerHTML !== beforeHtml) pc.dispatchEvent(new Event('input', { bubbles: true })); // 自動保存トリガー
  }

  document.addEventListener('dragover', _handleBlockDragOver, true);
  document.addEventListener('drop', _handleBlockDrop, true);

  handle.addEventListener('dragend', () => {
    if (handle._dragBlock) handle._dragBlock.classList.remove('dragging');
    handle._dragBlock = null;
    pc.querySelectorAll('.drag-guide-top, .drag-guide-bottom').forEach(el => el.classList.remove('drag-guide-top', 'drag-guide-bottom'));
    const stale = pc.querySelector('.drop-caret');
    if (stale) stale.remove();
  });
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
