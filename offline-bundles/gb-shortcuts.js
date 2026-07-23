// ============================================================
// gb-shortcuts.js — ショートカットキー中央管理＆ツールチップ統一
// ============================================================

// === Part 1: ショートカットレジストリ ===

const GB_SHORTCUTS = {
  // --- 全般 ---
  'global.save':          { key: '',             label: '自動保存を即時反映',        scope: 'global' },
  'global.new':           { key: 'ctrl+n',       label: '新規作成',                  scope: 'global' },
  'global.quickOpen':     { key: 'ctrl+p',       label: 'クイックオープン',           scope: 'global' },
  'global.undo':          { key: 'ctrl+z',       label: '元に戻す',                  scope: 'global' },
  'global.redo':          { key: 'ctrl+y',       label: 'やり直し',                  scope: 'global' },
  'global.redo2':         { key: 'ctrl+shift+z', label: 'やり直し（代替）',           scope: 'global' },
  'global.search':        { key: 'ctrl+f',       label: 'ファイル内検索',             scope: 'global' },
  'global.vaultSearch':   { key: 'ctrl+shift+f', label: 'ソースフォルダ全体検索',     scope: 'global' },
  'global.annotation':    { key: 'alt+a',        label: '注釈ツールバーの切替',       scope: 'global' },
  'global.maxPane':       { key: 'ctrl+shift+m', label: 'パネル最大化/復元',         scope: 'global' },
  'global.closeTab':      { key: 'ctrl+w',       label: 'タブを閉じる',              scope: 'global' },
  'global.nextTab':       { key: 'ctrl+tab',     label: '次のタブ',                  scope: 'global' },
  'global.prevTab':       { key: 'ctrl+shift+tab', label: '前のタブ',               scope: 'global' },
  'global.commandPalette': { key: 'ctrl+shift+p', label: 'コマンドパレット',         scope: 'global' },
  'global.settings':      { key: 'ctrl+,',       label: '設定を開く',                scope: 'global' },
  'global.shortcutHelp':  { key: 'ctrl+/',       label: 'ショートカット設定を開く',  scope: 'global' },
  'global.navBack':       { key: 'alt+arrowleft',  label: 'パネル履歴を戻る',       scope: 'global' },
  'global.navForward':    { key: 'alt+arrowright', label: 'パネル履歴を進む',       scope: 'global' },
  'global.navBackBrowser': { key: 'browserback',    label: '戻るボタンでパネル履歴を戻る', scope: 'global' },
  'global.navForwardBrowser': { key: 'browserforward', label: '進むボタンでパネル履歴を進む', scope: 'global' },
  'global.fullscreen':    { key: 'f11',          label: 'フルスクリーン',             scope: 'global' },
  'global.reload':        { key: 'ctrl+shift+r', label: 'リロード',                  scope: 'global' },
  'global.reload2':       { key: 'f5',           label: 'リロード（F5）',             scope: 'global' },
  'global.addComment':    { key: 'alt+shift+c',  label: '注釈コメントを追加',        scope: 'global' },

  // --- ノートエディタ ---
  'note.bold':            { key: 'ctrl+b',       label: '太字',                      scope: 'note' },
  'note.italic':          { key: 'ctrl+i',       label: '斜体',                      scope: 'note' },
  'note.underline':       { key: 'ctrl+u',       label: '下線',                      scope: 'note' },
  'note.strike':          { key: 'ctrl+shift+x', label: '取り消し線',                 scope: 'note' },
  'note.h1':              { key: 'ctrl+shift+1', label: '見出し1',                   scope: 'note' },
  'note.h2':              { key: 'ctrl+shift+2', label: '見出し2',                   scope: 'note' },
  'note.h3':              { key: 'ctrl+shift+3', label: '見出し3',                   scope: 'note' },
  'note.h4':              { key: 'ctrl+shift+4', label: '見出し4',                   scope: 'note' },
  'note.h5':              { key: 'ctrl+shift+5', label: '見出し5',                   scope: 'note' },
  'note.h6':              { key: 'ctrl+shift+6', label: '見出し6',                   scope: 'note' },
  'note.body':            { key: 'ctrl+shift+0', label: '本文に戻す',                scope: 'note' },
  'note.ol':              { key: 'ctrl+shift+7', label: '番号付きリスト',             scope: 'note' },
  'note.ul':              { key: 'ctrl+shift+8', label: '箇条書きリスト',             scope: 'note' },
  'note.quote':           { key: 'ctrl+shift+9', label: '引用',                      scope: 'note' },
  'note.hr':              { key: 'ctrl+shift+h', label: '水平線を挿入',              scope: 'note' },
  'note.indent':          { key: 'tab',          label: 'インデント',                scope: 'note' },
  'note.outdent':         { key: 'shift+tab',    label: 'アウトデント',              scope: 'note' },
  'note.moveUp':          { key: 'alt+shift+arrowup',  label: 'ブロックを上に移動',   scope: 'note' },
  'note.moveDown':        { key: 'alt+shift+arrowdown', label: 'ブロックを下に移動', scope: 'note' },
  'note.link':            { key: 'ctrl+k',       label: 'リンクを挿入',              scope: 'note' },
  'note.plainPaste':      { key: 'ctrl+shift+v', label: 'プレーンテキスト貼り付け',   scope: 'note' },
  'note.replace':         { key: 'ctrl+h',       label: '検索と置換',                scope: 'note' },
  'note.codeBlock':       { key: 'ctrl+shift+`', label: 'コードブロック挿入',         scope: 'note' },
  'note.checklist':       { key: 'ctrl+shift+l', label: 'チェックリスト',             scope: 'note' },
  'note.duplicate':       { key: 'ctrl+d',       label: '行を複製',                  scope: 'note' },
  'note.ruby':            { key: 'alt+arrowdown', label: 'ルビを設定',                scope: 'note' },
  'note.newParagraph':    { key: 'ctrl+enter',   label: '次の段落を追加',            scope: 'note' },

  // --- シナリオ ---
  // 実処理は gb-scriptnote-editor.* の既存 keydown / paste ハンドラに委譲する。
  'scenario.addRow':       { key: 'enter',        label: '行を追加',                  scope: 'scenario' },
  'scenario.addRowSameType': { key: 'ctrl+enter', label: '同タイプ行を追加',           scope: 'scenario' },
  'scenario.deleteRow':    { key: 'shift+delete', label: '行を削除',                  scope: 'scenario' },
  'scenario.moveUp':       { key: 'ctrl+arrowup', label: '行を上に移動',              scope: 'scenario' },
  'scenario.moveDown':     { key: 'ctrl+arrowdown', label: '行を下に移動',            scope: 'scenario' },
  'scenario.selectAll':    { key: 'ctrl+a',       label: '全行を選択',                scope: 'scenario' },
  'scenario.newline':      { key: 'shift+enter',  label: 'セル内改行',                scope: 'scenario' },
  'scenario.copy':         { key: 'ctrl+c',       label: 'セルのコピー',              scope: 'scenario' },
  'scenario.paste':        { key: 'ctrl+v',       label: 'セルの貼り付け',            scope: 'scenario' },
  'scenario.cut':          { key: 'ctrl+x',       label: 'セルの切り取り',            scope: 'scenario' },
  'scenario.tab':          { key: 'tab',          label: 'タイプメニューを開く',       scope: 'scenario' },
  'scenario.escape':       { key: 'escape',       label: '編集キャンセル',             scope: 'scenario' },
  'scenario.deselectAll':  { key: 'ctrl+d',       label: '選択を解除',                scope: 'scenario' },
  'scenario.pasteInCell':  { key: 'ctrl+shift+v', label: 'セル内に貼り付け',           scope: 'scenario' },
  'scenario.ruby':         { key: 'ctrl+r',       label: 'ルビを設定',                scope: 'scenario' },
  'scenario.search':       { key: 'ctrl+f',       label: '検索と置換',                scope: 'scenario' },
  'scenario.replace':      { key: 'ctrl+h',       label: '置換',                      scope: 'scenario' },
  'scenario.undo':         { key: 'ctrl+z',       label: '元に戻す',                  scope: 'scenario' },
  'scenario.redo':         { key: 'ctrl+y',       label: 'やり直す',                  scope: 'scenario' },

  // --- データベース ---
  'db.tab':               { key: 'tab',          label: '次のセルへ移動',            scope: 'database' },
  'db.enter':             { key: 'enter',        label: 'エントリを開く / 編集',      scope: 'database' },
  'db.edit':              { key: 'f2',           label: 'セル / エントリ名を編集',   scope: 'database' },
  'db.newEntry':          { key: 'ctrl+enter',   label: '新規エントリ追加',           scope: 'database' },
  'db.newProp':           { key: 'ctrl+shift+enter', label: '新規列追加',    scope: 'database' },
  'db.search':            { key: 'ctrl+f',       label: '現在のシートを検索',         scope: 'database' },
  'db.replace':           { key: 'ctrl+h',       label: '現在のシートで置換',         scope: 'database' },
  'db.advancedFilter':    { key: 'ctrl+shift+f', label: '複数条件フィルタ',           scope: 'database' },
  'db.bulkEdit':          { key: 'ctrl+e',       label: '選択エントリを一括編集',     scope: 'database' },
  'db.copy':              { key: 'ctrl+c',       label: 'セル値のコピー',            scope: 'database' },
  'db.paste':             { key: 'ctrl+v',       label: 'セル値の貼り付け',          scope: 'database' },
  'db.escape':            { key: 'escape',       label: '編集キャンセル / 選択解除',  scope: 'database' },
  'db.filter':            { key: 'ctrl+shift+l', label: 'フィルタの表示/非表示',      scope: 'database' },

  // --- ボード ---
  'board.search':         { key: 'ctrl+f',       label: 'ボード内を検索',            scope: 'board' },
  'board.replace':        { key: 'ctrl+h',       label: 'ボード内を置換',            scope: 'board' },
  'board.delete':         { key: 'delete',       label: 'カードを削除',              scope: 'board' },
  'board.selectAll':      { key: 'ctrl+a',       label: '全要素を選択',              scope: 'board' },
  'board.deselectAll':    { key: 'ctrl+d',       label: '全選択解除',                scope: 'board' },
  'board.edit':           { key: 'f2',           label: 'テキスト編集',              scope: 'board' },
  'board.addChild':       { key: 'ctrl+enter',   label: '子カードを追加',            scope: 'board' },
  'board.addChildTab':    { key: 'tab',          label: '子カードを追加 (Tab)',      scope: 'board' },
  'board.addSibling':     { key: 'enter',        label: '同階層カードを追加',        scope: 'board' },
  'board.ctrlArrowUp':    { key: 'ctrl+arrowup',    label: '↑: 兄弟入替 / 子階層展開・折りたたみ', scope: 'board' },
  'board.ctrlArrowDown':  { key: 'ctrl+arrowdown',  label: '↓: 兄弟入替 / 子階層展開・折りたたみ', scope: 'board' },
  'board.ctrlArrowLeft':  { key: 'ctrl+arrowleft',  label: '←: 兄弟入替 / 子階層展開・折りたたみ', scope: 'board' },
  'board.ctrlArrowRight': { key: 'ctrl+arrowright', label: '→: 兄弟入替 / 子階層展開・折りたたみ', scope: 'board' },
  'board.copy':           { key: 'ctrl+c',       label: 'コピー',                    scope: 'board' },
  'board.paste':          { key: 'ctrl+v',       label: '貼り付け',                  scope: 'board' },
  'board.cut':            { key: 'ctrl+x',       label: '切り取り',                  scope: 'board' },
  'board.pasteImage':     { key: 'ctrl+shift+v', label: '画像を貼り付け',            scope: 'board' },
  'board.zoomIn':         { key: 'ctrl+=',       label: 'ズームイン',                scope: 'board' },
  'board.zoomOut':        { key: 'ctrl+-',       label: 'ズームアウト',              scope: 'board' },
  'board.zoomFit':        { key: 'ctrl+0',       label: '全体表示にフィット',         scope: 'board' },
  'board.zoom100':        { key: 'ctrl+1',       label: '100%表示',                  scope: 'board' },

  // --- カレンダー ---
  'cal.newEvent':         { key: 'n',            label: '新規イベント',              scope: 'calendar' },
  'cal.delete':           { key: 'delete',       label: 'イベントを削除',            scope: 'calendar' },
  'cal.today':            { key: 't',            label: '今日に移動',                scope: 'calendar' },
  'cal.prev':             { key: 'arrowleft',    label: '前の期間に移動',            scope: 'calendar' },
  'cal.next':             { key: 'arrowright',   label: '次の期間に移動',            scope: 'calendar' },
  'cal.enter':            { key: 'enter',        label: 'イベント作成 / 編集',        scope: 'calendar' },
  'cal.escape':           { key: 'escape',       label: 'ポップアップを閉じる',       scope: 'calendar' },
  'cal.viewDay':          { key: 'd',            label: '日表示',                    scope: 'calendar' },
  'cal.viewWeek':         { key: 'w',            label: '週表示',                    scope: 'calendar' },
  'cal.viewMonth':        { key: 'm',            label: '月表示',                    scope: 'calendar' },

  // --- CSVエディタ ---
  'csv.tab':              { key: 'tab',          label: '右のセルへ移動',            scope: 'csv' },
  'csv.enter':            { key: 'enter',        label: '編集を確定',                scope: 'csv' },
  'csv.escape':           { key: 'escape',       label: '編集をキャンセル',           scope: 'csv' },
  'csv.copy':             { key: 'ctrl+c',       label: 'セルのコピー',              scope: 'csv' },
  'csv.selectAll':        { key: 'ctrl+a',       label: '全セル選択',                scope: 'csv' },
  'csv.search':           { key: 'ctrl+f',       label: 'テーブル内検索',            scope: 'csv' },
  'csv.edit':             { key: 'f2',           label: 'セル編集開始',              scope: 'csv' },

  // --- エクスプローラー ---
  'explorer.selectAll':   { key: 'ctrl+a',       label: '全アイテムを選択',          scope: 'folder' },
  'explorer.open':        { key: 'enter',        label: '選択アイテムを開く',         scope: 'folder' },
  'explorer.rename':      { key: 'f2',           label: 'リネーム',                  scope: 'folder' },
  'explorer.delete':      { key: 'delete',       label: '削除',                      scope: 'folder' },

  // --- パネルセット ---
  'panelset.group1':      { key: 'ctrl+alt+1',   label: 'パネルセット ドック1',       scope: 'global' },
  'panelset.group2':      { key: 'ctrl+alt+2',   label: 'パネルセット ドック2',       scope: 'global' },
  'panelset.group3':      { key: 'ctrl+alt+3',   label: 'パネルセット ドック3',       scope: 'global' },
  'panelset.group4':      { key: 'ctrl+alt+4',   label: 'パネルセット ドック4',       scope: 'global' },
  'panelset.group5':      { key: 'ctrl+alt+5',   label: 'パネルセット ドック5',       scope: 'global' },
  'panelset.group6':      { key: 'ctrl+alt+6',   label: 'パネルセット ドック6',       scope: 'global' },
  'panelset.group7':      { key: 'ctrl+alt+7',   label: 'パネルセット ドック7',       scope: 'global' },
  'panelset.group8':      { key: 'ctrl+alt+8',   label: 'パネルセット ドック8',       scope: 'global' },
  'panelset.group9':      { key: 'ctrl+alt+9',   label: 'パネルセット ドック9',       scope: 'global' },
};

const GB_SHORTCUTS_DEFAULT = JSON.parse(JSON.stringify(GB_SHORTCUTS));


// === Part 1-2: スコープ解決 ===

function _viewToScope(view) {
  const map = {
    'page': 'note', 'entity': 'note',
    'pivot': 'database', 'gallery': 'database', 'kanban': 'database',
    'timeline': 'database', 'chart': 'database', 'graph': 'database',
    'board': 'board',
    'calendar': 'calendar',
    'scriptnote': 'scenario',
    'csv': 'csv',
    'folder': 'folder',
    'smart-db': 'database',
  };
  return map[view] || 'global';
}

function _resolveShortcutScope(e) {
  const ae = document.activeElement;
  const target = e?.target?.nodeType === 1 ? e.target : e?.target?.parentElement;
  const editEl = [target, ae].map(el => el?.closest?.('input,textarea,select,[contenteditable="true"],[contenteditable="plaintext-only"],[role="textbox"],.chat-rich-input') || el)
    .find(el => el && el.isConnected !== false && (el.isContentEditable || el.contentEditable === 'true' || el.contentEditable === 'plaintext-only' || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || el.getAttribute?.('role') === 'textbox'));
  const isEditing = !!editEl;

  const rightPanel = document.getElementById('right-panel');
  const inRightPanel = !!(rightPanel && (
    (editEl && rightPanel.contains(editEl)) ||
    (ae && rightPanel.contains(ae)) ||
    (target && rightPanel.contains(target))
  ));

  if (inRightPanel && isEditing) return ['global'];
  if (inRightPanel) return ['global', _viewToScope(state.view)];

  if (isEditing) {
    const scope = _viewToScope(state.view);
    if (scope === 'note' && editEl?.closest?.('#page-content, #entity-freetext, #dp-editable')) return ['global', 'note'];
    if (scope === 'scenario' && editEl?.closest?.('.gb-se-root')) return ['global', 'scenario'];
    return ['global'];
  }

  return ['global', _viewToScope(state.view)];
}


// === Part 1-3: キー判定ヘルパー ===

const _MODIFIER_KEYS = new Set(['control', 'shift', 'alt', 'meta']);

// Shift+数字キーの記号→数字マッピング（US配列基準）
const _SHIFT_DIGIT_MAP = { '!':'1', '@':'2', '#':'3', '$':'4', '%':'5', '^':'6', '&':'7', '*':'8', '(':'9', ')':'0' };

function _normalizeKeyEvent(e) {
  const rawKey = typeof e?.key === 'string' ? e.key : '';
  if (!rawKey) return null;
  const key = rawKey.toLowerCase();
  if (_MODIFIER_KEYS.has(key)) return null;
  const mods = [];
  if (e.altKey) mods.push('alt');
  if (e.ctrlKey || e.metaKey) mods.push('ctrl');
  if (e.shiftKey) mods.push('shift');
  let mainKey = key;
  if (mainKey === ' ') mainKey = 'space';
  if (mainKey === '+') {
    mainKey = '=';
    const shiftIdx = mods.indexOf('shift');
    if (shiftIdx >= 0) mods.splice(shiftIdx, 1);
  }
  if (e.shiftKey && e.code === 'Backquote') mainKey = '`';
  // Shift+数字キー: e.keyは記号になるが、e.codeから元の数字を復元
  if (e.shiftKey && e.code && e.code.startsWith('Digit')) {
    mainKey = e.code.charAt(5); // 'Digit1' → '1'
  }
  // Shift+記号キーのフォールバック（e.codeが使えない場合）
  if (e.shiftKey && _SHIFT_DIGIT_MAP[mainKey]) {
    mainKey = _SHIFT_DIGIT_MAP[mainKey];
  }
  return [...mods, mainKey].join('+');
}

function _normalizeKeyDef(keyDef) {
  const parts = keyDef.toLowerCase().replace(/\s/g, '').split('+');
  const mods = [];
  let mainKey = '';
  for (const p of parts) {
    if (['ctrl', 'shift', 'alt', 'meta'].includes(p)) mods.push(p);
    else mainKey = p;
  }
  mods.sort();
  return [...mods, mainKey].join('+');
}

function _isNativeHardReloadShortcut(e) {
  const key = String(e?.key || '').toLowerCase();
  return !!(e && !e.altKey && e.shiftKey && (e.ctrlKey || e.metaKey) && (key === 'r' || e.code === 'KeyR'));
}

function _isNativeBrowserSaveShortcut(e) {
  const key = String(e?.key || '').toLowerCase();
  return !!(e && !e.altKey && !e.shiftKey && (e.ctrlKey || e.metaKey) && (key === 's' || e.code === 'KeyS' || e.keyCode === 83));
}

function _hasChatMessageTextSelection() {
  const selection = typeof document.getSelection === 'function' ? document.getSelection() : null;
  if (!selection || selection.isCollapsed || !String(selection.toString())) return false;
  const selectors = '#chat-messages .chat-message-bubble, #team-messages .chat-message-bubble, #chat-messages .chat-message-text, #team-messages .chat-message-text';
  const messageEls = Array.from(document.querySelectorAll(selectors));
  if (!messageEls.length) return false;
  for (let i = 0; i < selection.rangeCount; i++) {
    const range = selection.getRangeAt(i);
    for (const el of messageEls) {
      try {
        if (range.intersectsNode(el)) return true;
      } catch (_) {}
    }
  }
  return false;
}

function _performMeldexHardReload() {
  const reload = () => {
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('devBust', String(Date.now()));
      window.location.replace(url.toString());
    } catch (_) {
      window.location.reload();
    }
  };
  const tasks = [];
  try {
    if (navigator.serviceWorker?.getRegistrations) {
      tasks.push(navigator.serviceWorker.getRegistrations()
        .then(registrations => Promise.all(registrations.map(registration => registration.unregister()))));
    }
  } catch (_) {}
  try {
    if (window.caches?.keys) {
      tasks.push(caches.keys().then(keys => Promise.all(keys.map(key => caches.delete(key)))));
    }
  } catch (_) {}
  if (!tasks.length) {
    reload();
    return;
  }
  Promise.allSettled(tasks).then(reload, reload);
}
if (typeof window !== 'undefined') window.__meldexPerformHardReload = _performMeldexHardReload;

// 表示用: "ctrl+shift+a" → "Ctrl+Shift+A"
function _formatKeyDisplay(keyStr) {
  if (!keyStr) return '';
  return keyStr.split('+').map(p => {
    if (p === 'ctrl') return 'Ctrl';
    if (p === 'shift') return 'Shift';
    if (p === 'alt') return 'Alt';
    if (p === 'meta') return 'Meta';
    if (p === 'arrowup') return '↑';
    if (p === 'arrowdown') return '↓';
    if (p === 'arrowleft') return '←';
    if (p === 'arrowright') return '→';
    if (p === 'browserback') return '戻るボタン';
    if (p === 'browserforward') return '進むボタン';
    if (p === 'escape') return 'Esc';
    if (p === 'enter') return 'Enter';
    if (p === 'delete') return 'Del';
    if (p === 'backspace') return 'BS';
    if (p === 'tab') return 'Tab';
    if (p === 'space') return 'Space';
    if (p.length === 1) return p.toUpperCase();
    return p.charAt(0).toUpperCase() + p.slice(1);
  }).join('+');
}


// === Part 2-1: カスタム設定の保存 ===

const _SHORTCUT_STORAGE_KEY = 'meldex-custom-shortcuts';

function _getCustomShortcuts() {
  try { return JSON.parse(localStorage.getItem(_SHORTCUT_STORAGE_KEY) || '{}'); } catch { return {}; }
}

function _shortcutKeyDisplay(keyStr) {
  return keyStr ? _formatKeyDisplay(keyStr) : '未設定';
}

function _refreshShortcutSettingsAfterHistory() {
  if (typeof _updateAllTooltips === 'function') _updateAllTooltips();
  if (typeof updateScriptnoteShortcutStatusbar === 'function') updateScriptnoteShortcutStatusbar();
  document.querySelectorAll('.shortcut-settings-wrap').forEach(wrap => {
    const container = wrap.parentElement;
    if (container && typeof renderShortcutSettings === 'function') renderShortcutSettings(container);
  });
}

function _saveCustomShortcuts(custom, options) {
  const before = (typeof captureLocalStorageSettings === 'function')
    ? captureLocalStorageSettings([_SHORTCUT_STORAGE_KEY])
    : null;
  localStorage.setItem(_SHORTCUT_STORAGE_KEY, JSON.stringify(custom));
  if (typeof updateScriptnoteShortcutStatusbar === 'function') updateScriptnoteShortcutStatusbar();
  if (before && options?.skipHistory !== true && typeof pushLocalStorageSettingsHistory === 'function') {
    pushLocalStorageSettingsHistory(
      options?.label || '設定: ショートカット変更',
      before,
      captureLocalStorageSettings([_SHORTCUT_STORAGE_KEY]),
      options?.detail || '',
      _refreshShortcutSettingsAfterHistory
    );
  }
}

function _getEffectiveShortcuts() {
  const custom = _getCustomShortcuts();
  const result = JSON.parse(JSON.stringify(GB_SHORTCUTS));
  for (const [id, overrides] of Object.entries(custom)) {
    if (result[id]) result[id].key = overrides.key;
  }
  return result;
}

// 指定IDのショートカットの現在のキーを取得（ツールチップ用）
function getShortcutKey(id) {
  const custom = _getCustomShortcuts();
  if (custom[id]) return custom[id].key;
  return GB_SHORTCUTS[id]?.key || '';
}

function _shortcutStatusItem(id, label) {
  const key = getShortcutKey(id);
  if (!key) return '';
  const display = typeof _formatKeyDisplay === 'function' ? _formatKeyDisplay(key) : key;
  return display + ' ' + label;
}

function getScriptnoteShortcutStatusText() {
  // 2026-07-17 最新仕様に同期: Tab=タイプ選択・同タイプ行追加・セル内貼付・全選択/選択解除を追加、
  // 「上へ/下へ」は行移動であることが分かる表記へ変更
  return [
    _shortcutStatusItem('scenario.addRow', '行追加'),
    _shortcutStatusItem('scenario.addRowSameType', '同タイプ行追加'),
    _shortcutStatusItem('scenario.newline', 'セル内改行'),
    _shortcutStatusItem('scenario.deleteRow', '行削除'),
    _shortcutStatusItem('scenario.tab', 'タイプ選択'),
    _shortcutStatusItem('scenario.moveUp', '行を上へ'),
    _shortcutStatusItem('scenario.moveDown', '行を下へ'),
    _shortcutStatusItem('scenario.search', '検索'),
    _shortcutStatusItem('scenario.replace', '置換'),
    _shortcutStatusItem('scenario.ruby', 'ルビ'),
    _shortcutStatusItem('scenario.copy', 'コピー'),
    _shortcutStatusItem('scenario.paste', '貼付'),
    _shortcutStatusItem('scenario.pasteInCell', 'セル内貼付'),
    _shortcutStatusItem('scenario.selectAll', '全選択'),
    _shortcutStatusItem('scenario.deselectAll', '選択解除'),
    _shortcutStatusItem('scenario.undo', 'Undo'),
    _shortcutStatusItem('scenario.redo', 'Redo'),
  ].filter(Boolean).join(' | ');
}

function updateScriptnoteShortcutStatusbar(targetEl) {
  const sc = targetEl || document.getElementById('sb-shortcuts');
  if (!sc) return;
  if (!targetEl && typeof state !== 'undefined' && state.view !== 'scriptnote') return;
  sc.textContent = getScriptnoteShortcutStatusText();
}

function _runScriptnoteShortcutAction(id, e) {
  const editor = typeof _sn2GetActiveEditor === 'function' ? _sn2GetActiveEditor() : null;
  if (!editor || typeof editor.runShortcutAction !== 'function') return false;
  return editor.runShortcutAction(id, e);
}


// === Part 1-5: アクションハンドラマップ ===

function _switchPanelsetGroupByIndex(n) {
  if (typeof GBPanelSet === 'undefined' || typeof GBLayout === 'undefined') return;
  const ap = GBLayout.activePane;
  if (!ap) return;
  function findPanelset(node) {
    if (!node) return null;
    if (node.type === 'panelset') {
      const active = (node.groups || []).find(g => g && g.id === node.activeGroupId);
      if (active?.root && GBLayout.findNode(active.root, ap)) return node;
    }
    if (node.type === 'split' && Array.isArray(node.children)) {
      for (const c of node.children) { const f = findPanelset(c); if (f) return f; }
    }
    return null;
  }
  const ps = findPanelset(GBLayout.root);
  if (!ps || !ps.groups || ps.groups.length < n) return;
  GBPanelSet.switchGroup(ps, ps.groups[n - 1].id);
}

function _activeCalendarShortcutComponent() {
  try {
    if (typeof GBLayout === 'undefined' || typeof GBTabs === 'undefined' || typeof getComponentInstance !== 'function') return null;
    const paneId = GBLayout.activePane;
    const activeTab = paneId ? GBTabs.getActiveTab(paneId) : null;
    if (!activeTab || activeTab.type !== 'calendar') return null;
    const component = getComponentInstance(activeTab.id);
    return component || null;
  } catch {
    return null;
  }
}

function _calendarShortcutSelectedEventId(component) {
  try {
    const selection = typeof component._eventSelection === 'function' ? component._eventSelection() : null;
    if (selection?.size) return [...selection][selection.size - 1] || '';
    const lastId = component._lastSelectedEventId || '';
    const rendered = typeof component._renderedEventIds === 'function' ? component._renderedEventIds() : [];
    return lastId && rendered.includes(lastId) ? lastId : '';
  } catch {
    return '';
  }
}

function _runCalendarShortcut(action) {
  const component = _activeCalendarShortcutComponent();
  if (!component) return false;
  switch (action) {
    case 'newEvent': {
      const date = component._date || new Date();
      const dateStr = typeof component._localDateStr === 'function'
        ? component._localDateStr(date)
        : new Date(date).toISOString().slice(0, 10);
      if (typeof component._openEventInPanel === 'function') {
        component._openEventInPanel(null, dateStr + 'T00:00', dateStr + 'T23:59', true);
        return true;
      }
      return false;
    }
    case 'delete': {
      const id = _calendarShortcutSelectedEventId(component);
      if (!id) return false;
      if (typeof component._deleteEventFromOptions === 'function') component._deleteEventFromOptions(id);
      else if (typeof component._deleteEventFromPanel === 'function') component._deleteEventFromPanel(id);
      else return false;
      return true;
    }
    case 'today':
      if (typeof component._handleAction === 'function') component._handleAction('today');
      else return false;
      return true;
    case 'prev':
      if (typeof component._handleAction === 'function') component._handleAction('prev');
      else return false;
      return true;
    case 'next':
      if (typeof component._handleAction === 'function') component._handleAction('next');
      else return false;
      return true;
    case 'enter': {
      const id = _calendarShortcutSelectedEventId(component);
      if (id && typeof component._openEventInPanel === 'function') component._openEventInPanel(id);
      else return _runCalendarShortcut('newEvent');
      return true;
    }
    case 'escape':
      if (typeof component._setSelectedEvents === 'function') component._setSelectedEvents([]);
      if (typeof component._closeRightPanel === 'function') component._closeRightPanel();
      return true;
    case 'viewDay':
      if (typeof component.setView === 'function') component.setView('day');
      else return false;
      return true;
    case 'viewWeek':
      if (typeof component.setView === 'function') component.setView('week');
      else return false;
      return true;
    case 'viewMonth':
      if (typeof component.setView === 'function') component.setView('month');
      else return false;
      return true;
    default:
      return false;
  }
}

function _activeNoteEditable() {
  const ae = document.activeElement;
  const editable = ae?.closest?.('#page-content, #entity-freetext, #dp-editable') || null;
  if (!editable || editable.contentEditable !== 'true') return null;
  return editable;
}

function _runNoteRichTextCommand(cmd, value) {
  if (!_activeNoteEditable()) return false;
  if (typeof rtCmd === 'function') {
    rtCmd(cmd, value);
  } else {
    document.execCommand(cmd, false, value || null);
  }
}

function _runNoteHeadingShortcut(tag) {
  if (!_activeNoteEditable()) return false;
  if (typeof rtHeading === 'function') {
    rtHeading(tag);
  } else {
    document.execCommand('formatBlock', false, tag);
  }
}

function _currentNoteSelectionRange() {
  const editable = _activeNoteEditable();
  const sel = editable && typeof window.getSelection === 'function' ? window.getSelection() : null;
  if (!editable || !sel || !sel.rangeCount) return null;
  const range = sel.getRangeAt(0);
  const host = range.commonAncestorContainer?.nodeType === 1
    ? range.commonAncestorContainer
    : range.commonAncestorContainer?.parentElement;
  if (!host || !editable.contains(host)) return null;
  return range.cloneRange();
}

function _insertParagraphAfterCurrentNoteBlock() {
  const editable = _activeNoteEditable();
  const sel = editable && typeof window.getSelection === 'function' ? window.getSelection() : null;
  if (!editable || !sel || !sel.rangeCount) return false;
  const range = sel.getRangeAt(0);
  const node = range.startContainer?.nodeType === 1 ? range.startContainer : range.startContainer?.parentElement;
  const block = node?.closest?.('p, li, h1, h2, h3, h4, h5, h6, blockquote, pre, div');
  const target = (!block || block === editable || !editable.contains(block)) ? null : block;
  if (target && !target.parentNode) return false;
  const beforeHtml = editable.innerHTML;
  if (typeof _pushCustomUndo === 'function') _pushCustomUndo(editable);
  const next = document.createElement(target?.tagName === 'LI' ? 'li' : 'p');
  next.appendChild(document.createElement('br'));
  (target ? target.parentNode : editable).insertBefore(next, target ? target.nextSibling : null);
  const caret = document.createRange();
  caret.setStart(next, 0);
  caret.collapse(true);
  sel.removeAllRanges();
  sel.addRange(caret);
  if (editable.innerHTML !== beforeHtml) editable.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
}

const _shortcutHandlers = {

  // ============ 全般 ============

  'global.save': (e) => {
    if (state.view === 'board' && window.MeldexBoardStandalone?.saveCurrentBoard) window.MeldexBoardStandalone.saveCurrentBoard();
    else if (state.view === 'board' && typeof bdSave === 'function') bdSave();
    else if (state.view === 'csv' && typeof saveCsv === 'function') saveCsv();
    else if (state.view === 'scriptnote') {
      const editor = typeof _sn2GetActiveEditor === 'function' ? _sn2GetActiveEditor() : null;
      if (editor?.save) editor.save();
    }
    else {
      if (typeof flushPendingEditorAutosave === 'function') flushPendingEditorAutosave();
      if (typeof showStatus === 'function') showStatus('自動保存を即時反映しました');
    }
  },
  'global.new': () => {
    const typeMap = { page: 'page', entity: 'page', pivot: 'database', gallery: 'database', kanban: 'database', board: 'board', calendar: 'calendar', csv: 'page', folder: 'page' };
    const type = typeMap[state.view] || 'page';
    if (typeof showAddOutlinerItem === 'function') showAddOutlinerItem(type);
  },
  'global.quickOpen': () => {
    const searchInput = document.getElementById('sidebar-search-input');
    if (searchInput) { searchInput.focus(); searchInput.select(); }
  },
  'global.undo': () => {
    // contentEditable内ではブラウザデフォルトに任せる（この判定はショートカット側のみに残す。
    // ツールバーボタンはクリック時点でフォーカスがボタンへ移るため、meldexUndo() には入れない）
    const ae = document.activeElement;
    if (ae && (ae.contentEditable === 'true' || ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA')) return false;
    if (typeof meldexUndo === 'function') meldexUndo();
  },
  'global.redo': () => {
    const ae = document.activeElement;
    if (ae && (ae.contentEditable === 'true' || ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA')) return false;
    if (typeof meldexRedo === 'function') meldexRedo();
  },
  'global.redo2': () => _shortcutHandlers['global.redo'](),
  'global.navBack': (e) => {
    const ae = document.activeElement;
    if (ae && (ae.contentEditable === 'true' || ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.tagName === 'SELECT')) return false;
    if (typeof navBack === 'function') navBack();
  },
  'global.navForward': (e) => {
    const ae = document.activeElement;
    if (ae && (ae.contentEditable === 'true' || ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.tagName === 'SELECT')) return false;
    if (typeof navForward === 'function') navForward();
  },
  'global.navBackBrowser': (e) => _shortcutHandlers['global.navBack'](e),
  'global.navForwardBrowser': (e) => _shortcutHandlers['global.navForward'](e),
  'global.search': () => {
    // アクティブ pane のタブ種別に応じて、現在のビュー内検索バーを開く
    try {
      const paneId = typeof GBLayout !== 'undefined' ? GBLayout.activePane : '';
      const activeTab = paneId && typeof GBTabs !== 'undefined' ? GBTabs.getActiveTab(paneId) : null;
      if (activeTab && activeTab.type === 'board' && typeof bdOpenFindBar === 'function') {
        bdOpenFindBar('find');
        return;
      }
      if (activeTab && (activeTab.type === 'database' || activeTab.type === 'sheet') && typeof openDbFindReplace === 'function') {
        openDbFindReplace('find');
        return;
      }
    } catch (_) {}
    const bar = document.getElementById('file-search-bar');
    if (bar && bar.classList.contains('open') && !bar.classList.contains('replace-open')) {
      if (typeof closeFileSearch === 'function') closeFileSearch();
    } else {
      if (typeof openFileSearch === 'function') openFileSearch('find');
    }
  },
  'global.vaultSearch': () => { if (typeof openSearchPanel === 'function') openSearchPanel(); },
  'global.annotation': () => { if (typeof toggleAnnotation === 'function') toggleAnnotation(); },
  'global.maxPane': () => {
    const paneId = typeof GBLayout !== 'undefined' && GBLayout.activePane;
    if (paneId) {
      if (GBLayout.isMaximized && GBLayout.isMaximized()) GBLayout.restoreMaximizedPane();
      else GBLayout.maximizePane(paneId);
    }
  },
  'global.closeTab': () => {
    const paneId = typeof GBLayout !== 'undefined' && GBLayout.activePane;
    if (paneId && typeof GBTabs !== 'undefined') {
      const activeTab = GBTabs.getActiveTab(paneId);
      if (activeTab) GBTabs.closeTab(paneId, activeTab.id);
    }
  },
  'global.nextTab': () => {
    if (typeof GBTabs !== 'undefined' && typeof GBLayout !== 'undefined') {
      const pane = GBLayout.activePane;
      const tabs = GBTabs.getTabs(pane);
      if (!tabs || !tabs.length) return;
      const active = GBTabs.getActiveTab(pane);
      const idx = tabs.findIndex(t => t.id === active?.id);
      const next = tabs[(idx + 1) % tabs.length];
      if (next) GBTabs.activateTab(pane, next.id);
    } else if (typeof _tabs !== 'undefined' && _tabs.length) {
      const idx = _tabs.findIndex(t => t.id === _activeTabId);
      const next = _tabs[(idx + 1) % _tabs.length];
      if (next && typeof activateTab === 'function') activateTab(next.id);
    }
  },
  'global.prevTab': () => {
    if (typeof GBTabs !== 'undefined' && typeof GBLayout !== 'undefined') {
      const pane = GBLayout.activePane;
      const tabs = GBTabs.getTabs(pane);
      if (!tabs || !tabs.length) return;
      const active = GBTabs.getActiveTab(pane);
      const idx = tabs.findIndex(t => t.id === active?.id);
      const prev = tabs[(idx - 1 + tabs.length) % tabs.length];
      if (prev) GBTabs.activateTab(pane, prev.id);
    } else if (typeof _tabs !== 'undefined' && _tabs.length) {
      const idx = _tabs.findIndex(t => t.id === _activeTabId);
      const prev = _tabs[(idx - 1 + _tabs.length) % _tabs.length];
      if (prev && typeof activateTab === 'function') activateTab(prev.id);
    }
  },
  'global.commandPalette': () => {
    if (typeof showCommandPalette === 'function') showCommandPalette();
  },
  'global.settings': () => { if (typeof showSettingsModal === 'function') showSettingsModal(); },
  'global.shortcutHelp': () => {
    if (typeof showSettingsModal === 'function') showSettingsModal({ panel: 'ショートカット' });
  },
  'global.fullscreen': () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen?.();
  },
  'global.reload':  () => false,
  'global.reload2': () => { location.reload(); },
  'global.addComment': () => { if (typeof addCommentHere === 'function') addCommentHere(); },

  // ============ ノートエディタ ============

  'note.bold':      () => _runNoteRichTextCommand('bold'),
  'note.italic':    () => _runNoteRichTextCommand('italic'),
  'note.underline': () => _runNoteRichTextCommand('underline'),
  'note.strike':    () => _runNoteRichTextCommand('strikeThrough'),
  'note.h1':        () => _runNoteHeadingShortcut('H1'),
  'note.h2':        () => _runNoteHeadingShortcut('H2'),
  'note.h3':        () => _runNoteHeadingShortcut('H3'),
  'note.h4':        () => _runNoteHeadingShortcut('H4'),
  'note.h5':        () => _runNoteHeadingShortcut('H5'),
  'note.h6':        () => _runNoteHeadingShortcut('H6'),
  'note.body':      () => _runNoteHeadingShortcut('P'),
  'note.ol':        () => _runNoteRichTextCommand('insertOrderedList'),
  'note.ul':        () => _runNoteRichTextCommand('insertUnorderedList'),
  'note.quote':     () => _runNoteRichTextCommand('formatBlock', 'BLOCKQUOTE'),
  'note.hr':        () => _runNoteRichTextCommand('insertHorizontalRule'),
  'note.indent':    () => _runNoteRichTextCommand('indent'),
  'note.outdent':   () => _runNoteRichTextCommand('outdent'),
  'note.moveUp':    () => { if (typeof moveBlock === 'function') moveBlock('up'); },
  'note.moveDown':  () => { if (typeof moveBlock === 'function') moveBlock('down'); },
  'note.link':      () => {
    const savedRange = _currentNoteSelectionRange();
    if (typeof showLinkInsertModal === 'function') {
      showLinkInsertModal(savedRange);
      return;
    }
    if (typeof cfPrompt !== 'function') return false;
    cfPrompt('URL:').then(url => {
      if (!url) return;
      if (savedRange) {
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(savedRange);
      }
      document.execCommand('createLink', false, url);
    });
  },
  'note.plainPaste': (e) => {
    // ブラウザデフォルトのプレーンテキスト貼り付けに任せる
    return false;
  },
  'note.replace':   () => {
    if (typeof openFileSearch === 'function') openFileSearch('replace');
  },
  'note.codeBlock': () => {
    _runNoteRichTextCommand('formatBlock', 'PRE');
  },
  'note.checklist': () => {
    // チェックリスト挿入は箇条書きリストで代替
    _runNoteRichTextCommand('insertUnorderedList');
  },
  'note.duplicate': () => {
    const sel = window.getSelection();
    if (!sel.rangeCount) return;
    const range = sel.getRangeAt(0);
    const block = range.startContainer.nodeType === 3 ? range.startContainer.parentElement : range.startContainer;
    const line = block?.closest?.('p, li, h1, h2, h3, h4, h5, h6, blockquote, pre, div');
    const editable = line?.closest?.('[contenteditable="true"]') || document.activeElement?.closest?.('[contenteditable="true"]');
    if (!line || !line.parentElement || line === editable) return;
    const beforeHtml = editable ? editable.innerHTML : '';
    if (editable && typeof _pushCustomUndo === 'function') _pushCustomUndo(editable);
    const clone = line.cloneNode(true);
    line.parentElement.insertBefore(clone, line.nextSibling);
    if (editable && editable.innerHTML !== beforeHtml) {
      editable.dispatchEvent(new Event('input', { bubbles: true }));
    }
  },
  'note.ruby': (e) => {
    const edTarget = document.activeElement?.closest('[contenteditable="true"]');
    const sel = window.getSelection();
    if (!edTarget || !sel || sel.isCollapsed || !sel.toString().trim()) return false;
    if (typeof showNoteRubyPopup !== 'function') return false;
    showNoteRubyPopup(edTarget, sel.getRangeAt(0).cloneRange());
  },
  'note.newParagraph': () => _insertParagraphAfterCurrentNoteBlock(),

  // ============ シナリオ ============
  'scenario.addRow': (e) => _runScriptnoteShortcutAction('scenario.addRow', e),
  'scenario.addRowSameType': (e) => _runScriptnoteShortcutAction('scenario.addRowSameType', e),
  'scenario.deleteRow': (e) => _runScriptnoteShortcutAction('scenario.deleteRow', e),
  'scenario.moveUp': (e) => _runScriptnoteShortcutAction('scenario.moveUp', e),
  'scenario.moveDown': (e) => _runScriptnoteShortcutAction('scenario.moveDown', e),
  'scenario.selectAll': (e) => _runScriptnoteShortcutAction('scenario.selectAll', e),
  'scenario.newline': (e) => _runScriptnoteShortcutAction('scenario.newline', e),
  'scenario.copy': (e) => _runScriptnoteShortcutAction('scenario.copy', e),
  'scenario.paste': (e) => _runScriptnoteShortcutAction('scenario.paste', e),
  'scenario.cut': (e) => _runScriptnoteShortcutAction('scenario.cut', e),
  'scenario.tab': (e) => _runScriptnoteShortcutAction('scenario.tab', e),
  'scenario.escape': (e) => _runScriptnoteShortcutAction('scenario.escape', e),
  'scenario.deselectAll': (e) => _runScriptnoteShortcutAction('scenario.deselectAll', e),
  'scenario.pasteInCell': (e) => _runScriptnoteShortcutAction('scenario.pasteInCell', e),
  'scenario.ruby': (e) => _runScriptnoteShortcutAction('scenario.ruby', e),
  'scenario.search': (e) => _runScriptnoteShortcutAction('scenario.search', e),
  'scenario.replace': (e) => _runScriptnoteShortcutAction('scenario.replace', e),
  'scenario.undo': (e) => _runScriptnoteShortcutAction('scenario.undo', e),
  'scenario.redo': (e) => _runScriptnoteShortcutAction('scenario.redo', e),

  // ============ データベース ============

  'db.newEntry': () => {
    if (state.view !== 'pivot') return false;
    const table = activeCell?.closest?.('table') || document.getElementById('pivot-table');
    if (!table) return false;
    const dataRows = Array.from(table.querySelectorAll('tbody tr:not(.new-entity-row):not(.new-entity-spacer-row):not(.db-virtual-spacer-row):not(.group-header-row)'));
    if (typeof triggerNewEntity === 'function') triggerNewEntity(table, dataRows);
  },
  'db.newProp': () => {
    if (state.view !== 'pivot') return false;
    if (typeof triggerNewProperty === 'function') triggerNewProperty();
  },
  'db.enter': () => {
    if (state.view !== 'pivot') return false;
    if (!activeCell) return false;
    const ae = document.activeElement;
    if (ae && ae.isConnected !== false && (ae.contentEditable === 'true' || ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.tagName === 'SELECT')) return false;
    const table = activeCell?.closest?.('table') || document.getElementById('pivot-table');
    if (!table) return false;
    const dataRows = Array.from(table.querySelectorAll('tbody tr:not(.new-entity-row):not(.new-entity-spacer-row):not(.db-virtual-spacer-row):not(.group-header-row)'));
    const thAll = Array.from(table.querySelectorAll('thead th'));
    const tr = activeCell.parentElement;
    const colIdx = Array.from(tr.children).indexOf(activeCell);
    const rowIdx = dataRows.indexOf(tr);
    if (colIdx === 0) {
      const nameLabel = activeCell.querySelector('.entity-name-label');
      if (nameLabel) nameLabel.click();
    } else {
      if (typeof _dbStartCellInlineEditor === 'function') {
        _dbStartCellInlineEditor(activeCell, { preferExistingValue: true });
      } else {
        const valText = activeCell.querySelector('.value-text');
        if (valText) {
          valText.click();
          return;
        }
        const entityName = dataRows[rowIdx]?.querySelector('.entity-name-label')?.textContent;
        const propName = thAll[colIdx]?.dataset?.prop;
        if (entityName && propName && state.currentDbPath) {
          startCellInlineAdd(activeCell, _entityPath(state.currentDbPath, entityName), entityName, propName);
        }
      }
    }
  },
  'db.edit': () => {
    if (state.view !== 'pivot') return false;
    if (!activeCell) return false;
    const ae = document.activeElement;
    if (ae && ae.isConnected !== false && (ae.contentEditable === 'true' || ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.tagName === 'SELECT')) return false;
    const table = activeCell?.closest?.('table') || document.getElementById('pivot-table');
    const tr = activeCell.parentElement;
    const colIdx = Array.from(tr.children).indexOf(activeCell);
    if (colIdx === 0) {
      const nameLabel = activeCell.querySelector('.entity-name-label');
      if (nameLabel) {
        const entityName = nameLabel.textContent;
        startEntityInlineRename(activeCell, nameLabel, entityName, state.currentDbPath);
      }
    } else {
      if (typeof _dbStartCellInlineEditor === 'function') {
        _dbStartCellInlineEditor(activeCell, { preferExistingValue: true });
      } else if (table) {
        const valText = activeCell.querySelector('.value-text');
        if (valText) {
          valText.click();
          return;
        }
        const dataRows = Array.from(table.querySelectorAll('tbody tr:not(.new-entity-row):not(.new-entity-spacer-row):not(.db-virtual-spacer-row):not(.group-header-row)'));
        const thAll = Array.from(table.querySelectorAll('thead th'));
        const rowIdx = dataRows.indexOf(tr);
        const entityName = dataRows[rowIdx]?.querySelector('.entity-name-label')?.textContent;
        const propName = thAll[colIdx]?.dataset?.prop;
        if (entityName && propName && state.currentDbPath && typeof startCellInlineAdd === 'function') {
          startCellInlineAdd(activeCell, _entityPath(state.currentDbPath, entityName), entityName, propName);
        }
      }
    }
  },
  'db.tab': () => {
    // データベースのTab移動は既存ハンドラに残す（矢印キーと一体の複雑なロジック）
    return false;
  },
  'db.search': () => {
    if (!state.currentDbPath) return false;
    if (typeof openDbFindReplace === 'function') openDbFindReplace('find');
  },
  'db.replace': () => {
    if (!state.currentDbPath) return false;
    if (typeof openDbFindReplace === 'function') openDbFindReplace('replace');
  },
  'db.advancedFilter': () => {
    if (!state.currentDbPath) return false;
    if (typeof showUnifiedFilterModal === 'function') showUnifiedFilterModal();
    else if (typeof showAdvancedFilterModal === 'function') showAdvancedFilterModal();
    else return false;
  },
  'db.bulkEdit': () => {
    const ctx = typeof _currentPaneState === 'function' ? _currentPaneState() : null;
    const selected = typeof _getSelectedEntities === 'function'
      ? _getSelectedEntities(ctx)
      : (ctx?._selectedEntities ? [...ctx._selectedEntities] : []);
    if (!selected.length || typeof _showBulkEditModal !== 'function') return false;
    _showBulkEditModal(selected, ctx);
  },
  'db.copy': () => { return false; },
  'db.paste': () => { return false; },
  'db.escape': () => {
    const ctx = typeof _currentPaneState === 'function' ? _currentPaneState() : null;
    const selectedSet = ctx?._selectedEntities || state._selectedEntities;
    if (!selectedSet || !selectedSet.size) return false;
    selectedSet.clear();
    const table = typeof _currentPivotTable === 'function' ? _currentPivotTable(ctx) : document.getElementById('pivot-table');
    table?.querySelectorAll?.('.row-select-cb:checked')?.forEach(cb => {
      cb.checked = false;
      cb.closest('tr')?.classList.remove('row-selected');
    });
    if (typeof _updateBulkEditBar === 'function') _updateBulkEditBar(ctx);
  },
  'db.filter': () => {
    const btn = document.getElementById('btn-filter');
    if (btn) btn.click();
  },

  // ============ ボード ============

  'board.search': () => {
    if (state.view !== 'board' || typeof bd === 'undefined' || bd.editing) return false;
    if (typeof bdOpenFindBar === 'function') bdOpenFindBar('find');
  },
  'board.replace': () => {
    if (state.view !== 'board' || typeof bd === 'undefined' || bd.editing) return false;
    if (typeof bdOpenFindBar === 'function') bdOpenFindBar('replace');
  },
  'board.delete': () => {
    if (state.view !== 'board' || typeof bd === 'undefined' || bd.editing) return false;
    if (typeof bdDeleteSelected === 'function') bdDeleteSelected();
  },
  'board.selectAll': () => {
    if (state.view !== 'board' || typeof bd === 'undefined' || bd.editing) return false;
    if (typeof bdSelectAllElements === 'function') bdSelectAllElements();
  },
  'board.deselectAll': () => {
    if (state.view !== 'board' || typeof bd === 'undefined' || bd.editing) return false;
    if (typeof bdSelect === 'function') { bdSelect(null); bd._activeNode = null; }
  },
  'board.edit': () => {
    if (state.view !== 'board' || typeof bd === 'undefined' || bd.editing) return false;
    if (bd.selected.size === 1 && typeof bdEditNode === 'function') bdEditNode([...bd.selected][0]);
  },
  // Ctrl+Enter (新) / Tab (互換) で子カードを追加。親と同じスタイル / 構造を継承する。
  'board.addChild': () => {
    if (state.view !== 'board' || typeof bd === 'undefined') return false;
    if (bd.editing) {
      bdFinishEdit();
      setTimeout(() => {
        if (typeof bdAddChildToSelected === 'function') bdAddChildToSelected();
      }, 0);
      return;
    }
    if (typeof bdAddChildToSelected === 'function') bdAddChildToSelected();
  },
  'board.addChildTab': () => {
    if (state.view !== 'board' || typeof bd === 'undefined') return false;
    if (bd.editing) {
      bdFinishEdit();
      setTimeout(() => {
        if (typeof bdAddChildToSelected === 'function') bdAddChildToSelected();
      }, 0);
      return;
    }
    if (typeof bdAddChildToSelected === 'function') bdAddChildToSelected();
  },
  // Enter で同階層カードを追加。選択カードがルート (親なし) の場合は何もしない。
  'board.addSibling': () => {
    if (state.view !== 'board' || typeof bd === 'undefined' || bd.editing) return false;
    if (bd.selected.size !== 1) return; // 単一選択時のみ反応 (board.addChild と整合)
    if (typeof bdAddSiblingToSelected !== 'function') return false;
    const created = bdAddSiblingToSelected();
    if (!created && typeof showStatus === 'function') {
      showStatus('ルートカードは同階層に追加できません');
    }
  },
  // Ctrl+矢印: ツリーの展開方向に応じて、兄弟入替 / 子階層の折りたたみ・展開を切り替える
  'board.ctrlArrowUp': () => {
    if (state.view !== 'board' || typeof bd === 'undefined' || bd.editing) return false;
    if (typeof bdHandleCtrlArrow !== 'function') return false;
    bdHandleCtrlArrow('up');
  },
  'board.ctrlArrowDown': () => {
    if (state.view !== 'board' || typeof bd === 'undefined' || bd.editing) return false;
    if (typeof bdHandleCtrlArrow !== 'function') return false;
    bdHandleCtrlArrow('down');
  },
  'board.ctrlArrowLeft': () => {
    if (state.view !== 'board' || typeof bd === 'undefined' || bd.editing) return false;
    if (typeof bdHandleCtrlArrow !== 'function') return false;
    bdHandleCtrlArrow('left');
  },
  'board.ctrlArrowRight': () => {
    if (state.view !== 'board' || typeof bd === 'undefined' || bd.editing) return false;
    if (typeof bdHandleCtrlArrow !== 'function') return false;
    bdHandleCtrlArrow('right');
  },
  'board.copy': () => {
    if (state.view !== 'board' || typeof bd === 'undefined' || bd.editing) return false;
    if (typeof bdCopy === 'function') bdCopy();
  },
  'board.paste': () => {
    if (state.view !== 'board' || typeof bd === 'undefined' || bd.editing) return false;
    if (typeof bdPaste === 'function') bdPaste();
  },
  'board.cut': () => {
    if (state.view !== 'board' || typeof bd === 'undefined' || bd.editing) return false;
    const selectedConnIds = typeof bdGetSelectedConnectionIds === 'function'
      ? bdGetSelectedConnectionIds()
      : (bd.selectedConnId ? [bd.selectedConnId] : []);
    const selectedNodeIds = new Set(bd.selected || []);
    // bd.connections 未定義時は接続選択の検証をスキップ（false 警告防止）
    const hasUncopiedLine = selectedConnIds.length > 0 && Array.isArray(bd.connections)
      ? selectedConnIds.some((connId) => {
          const conn = bd.connections.find(c => c.id === connId);
          return !conn || !selectedNodeIds.has(conn.from) || !selectedNodeIds.has(conn.to);
        })
      : false;
    if (hasUncopiedLine) {
      if (typeof showStatus === 'function') showStatus('ラインは切り取りできません。削除する場合はDeleteを使ってください', true);
      return;
    }
    if (!selectedNodeIds.size) return false;
    if (typeof bdCopy === 'function') bdCopy();
    if (typeof bdDeleteSelected === 'function') bdDeleteSelected();
  },
  'board.pasteImage': () => {
    if (state.view !== 'board' || typeof bd === 'undefined' || bd.editing) return false;
    if (typeof bdPasteImage === 'function') bdPasteImage();
  },
  'board.zoomIn': () => {
    if (state.view !== 'board' || typeof bd === 'undefined' || bd.editing) return false;
    if (typeof bdZoom === 'function') bdZoom(0.1);
  },
  'board.zoomOut': () => {
    if (state.view !== 'board' || typeof bd === 'undefined' || bd.editing) return false;
    if (typeof bdZoom === 'function') bdZoom(-0.1);
  },
  'board.zoomFit': () => {
    if (state.view !== 'board' || typeof bd === 'undefined') return false;
    // 全体表示にフィット: 全ノードが収まるようにズーム/パンを調整
    if (bd.nodes.length === 0) return;
    const canvas = document.getElementById('bd-canvas');
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    bd.nodes.forEach(n => {
      const el = document.getElementById('bdn-' + n.id);
      const w = el ? el.offsetWidth : 160, h = el ? el.offsetHeight : 36;
      minX = Math.min(minX, n.x); minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x + w); maxY = Math.max(maxY, n.y + h);
    });
    const contentW = maxX - minX + 100, contentH = maxY - minY + 100;
    const zoom = Math.max(0.1, Math.min(rect.width / contentW, rect.height / contentH, 1.5));
    bd.zoom = zoom;
    bd.panX = (rect.width - contentW * zoom) / 2 - minX * zoom + 50 * zoom;
    bd.panY = (rect.height - contentH * zoom) / 2 - minY * zoom + 50 * zoom;
    bdTransform();
    const zoomLabel = document.getElementById('bd-zoom-label');
    if (zoomLabel) zoomLabel.textContent = Math.round(bd.zoom * 100) + '%';
  },
  'board.zoom100': () => {
    if (state.view !== 'board' || typeof bd === 'undefined') return false;
    bd.zoom = 1;
    bdTransform();
    const zoomLabel = document.getElementById('bd-zoom-label');
    if (zoomLabel) zoomLabel.textContent = '100%';
  },
  // ============ カレンダー ============
  'cal.newEvent': () => _runCalendarShortcut('newEvent'),
  'cal.delete': () => _runCalendarShortcut('delete'),
  'cal.today': () => _runCalendarShortcut('today'),
  'cal.prev': () => _runCalendarShortcut('prev'),
  'cal.next': () => _runCalendarShortcut('next'),
  'cal.enter': () => _runCalendarShortcut('enter'),
  'cal.escape': () => _runCalendarShortcut('escape'),
  'cal.viewDay': () => _runCalendarShortcut('viewDay'),
  'cal.viewWeek': () => _runCalendarShortcut('viewWeek'),
  'cal.viewMonth': () => _runCalendarShortcut('viewMonth'),

  // ============ CSVエディタ ============
  // CSVエディタのショートカットは gb-csv-viewer.js 内で処理される
  'csv.tab': () => { return false; },
  'csv.enter': () => { return false; },
  'csv.escape': () => { return false; },
  'csv.copy': () => { return false; },
  'csv.selectAll': () => { return false; },
  'csv.search': () => { return false; },
  'csv.edit': () => { return false; },

  // ============ エクスプローラー ============

  'explorer.selectAll': () => {
    if (state.view !== 'folder') return false;
    const els = document.querySelectorAll('#folder-grid .fv-item');
    if (typeof _folderItems !== 'undefined') {
      _folderSelectedItems = [];
      els.forEach(el => { el.classList.add('selected'); const it = _folderItems[parseInt(el.dataset.idx)]; if (it) _folderSelectedItems.push(it); });
      _folderSelected = _folderSelectedItems.length ? _folderSelectedItems[_folderSelectedItems.length - 1] : null;
      if (typeof _syncFolderCheckboxes === 'function') _syncFolderCheckboxes();
      if (typeof _updateFolderBulkBar === 'function') _updateFolderBulkBar();
      if (typeof showStatus === 'function') showStatus(_folderSelectedItems.length + ' 件選択');
    }
  },
  'explorer.open': () => {
    if (state.view !== 'folder') return false;
    if (typeof _folderSelected !== 'undefined' && _folderSelected && typeof openFolderItem === 'function') {
      openFolderItem(_folderSelected);
    }
  },
  'explorer.rename': async () => {
    if (state.view !== 'folder') return false;
    if (typeof _folderSelected === 'undefined' || !_folderSelected) return;
    const newName = await cfPrompt('新しい名前:', _folderSelected.name);
    if (newName && newName !== _folderSelected.name) {
      const oldPath = _folderSelected.path;
      try {
        const res = await apiPost('/outliner/rename', { old_path: oldPath, new_name: newName, type: _folderSelected.type || 'page' });
        if (typeof showStatus === 'function') showStatus('リネーム: ' + newName);
        if (res?.new_path && typeof _renameTreeNode === 'function') _renameTreeNode(oldPath, res.new_path, newName);
        if (typeof _folderPath !== 'undefined' && _folderPath) openFolder(_folderPath.split('/').pop(), _folderPath);
      } catch (err) {
        if (typeof showStatus === 'function') showStatus('リネームに失敗', true);
      }
    }
  },
  // パネルセット: アクティブペインが属する panelset の N 番目のドックに切替
  'panelset.group1': () => _switchPanelsetGroupByIndex(1),
  'panelset.group2': () => _switchPanelsetGroupByIndex(2),
  'panelset.group3': () => _switchPanelsetGroupByIndex(3),
  'panelset.group4': () => _switchPanelsetGroupByIndex(4),
  'panelset.group5': () => _switchPanelsetGroupByIndex(5),
  'panelset.group6': () => _switchPanelsetGroupByIndex(6),
  'panelset.group7': () => _switchPanelsetGroupByIndex(7),
  'panelset.group8': () => _switchPanelsetGroupByIndex(8),
  'panelset.group9': () => _switchPanelsetGroupByIndex(9),

  'explorer.delete': async () => {
    if (state.view !== 'folder') return false;
    if (typeof _folderSelectedItems === 'undefined' || _folderSelectedItems.length === 0) return;
    if (!await cfConfirm(_folderSelectedItems.length + ' 件を削除しますか？')) return;
    const deletedItems = [..._folderSelectedItems];
    const result = await deleteOutlinerItemsWithHistory(deletedItems, {
      label: deletedItems.length + ' 件を削除',
      refresh: async () => {
        if (typeof _folderPath !== 'undefined' && _folderPath && typeof openFolder === 'function') {
          await openFolder(_folderPath.split('/').pop(), _folderPath);
        }
      },
    });
    if (result.succeeded.length > 0) {
      const deletedCount = result.deletedCount || result.succeeded.length;
      if (typeof showStatus === 'function') showStatus(deletedCount + ' 件を削除しました（Undoで戻せます）' + (result.failedCount ? `（${result.failedCount}件失敗）` : ''), result.failedCount > 0);
    } else if (typeof showStatus === 'function') {
      showStatus('削除に失敗しました', true);
    }
    _folderSelectedItems = [];
    _folderSelected = null;
    if (typeof _syncFolderCheckboxes === 'function') _syncFolderCheckboxes();
    if (typeof _updateFolderBulkBar === 'function') _updateFolderBulkBar();
    if (typeof _folderPath !== 'undefined' && _folderPath) openFolder(_folderPath.split('/').pop(), _folderPath);
  },
};


// === Part 1-4: 中央キーハンドラ ===

function runMeldexShortcutById(id, e, options = {}) {
  const handler = _shortcutHandlers[id];
  if (!handler) return false;
  const result = handler(e);
  if (result === false) return false;
  if (!options.skipPreventDefault && e && typeof e.preventDefault === 'function') e.preventDefault();
  return true;
}
if (typeof window !== 'undefined') window.runMeldexShortcutById = runMeldexShortcutById;

document.addEventListener('keydown', (e) => {
  if (e.defaultPrevented) return;
  if (e.isComposing || e.keyCode === 229) return;
  if (!_isNativeHardReloadShortcut(e)) return;
  e.preventDefault();
  e.stopPropagation();
  (window.__meldexPerformHardReload || _performMeldexHardReload)();
}, true);

document.addEventListener('keydown', (e) => {
  if (e.defaultPrevented) return;
  if (e.isComposing || e.keyCode === 229) return;
  if (_isNativeHardReloadShortcut(e)) {
    e.preventDefault();
    (window.__meldexPerformHardReload || _performMeldexHardReload)();
    return;
  }
  const shouldSuppressBrowserSave = _isNativeBrowserSaveShortcut(e);
  if (shouldSuppressBrowserSave) e.preventDefault();

  const pressed = _normalizeKeyEvent(e);
  if (!pressed) return;
  if (pressed === 'ctrl+c' && _hasChatMessageTextSelection()) return;

  // モーダルダイアログが開いている場合はスキップ（ダイアログ自身が処理する）
  if (document.querySelector('.modal-overlay')) return;

  const scopes = _resolveShortcutScope(e);
  const shortcuts = _getEffectiveShortcuts();

  // ツール固有スコープを先に、globalを後にマッチ
  const sortedScopes = [...scopes].sort((a, b) => a === 'global' ? 1 : b === 'global' ? -1 : 0);

  for (const scope of sortedScopes) {
    for (const [id, def] of Object.entries(shortcuts)) {
      if (def.scope !== scope) continue;
      if (def.key && _normalizeKeyDef(def.key) === pressed) {
        const handler = _shortcutHandlers[id];
        if (handler) {
          runMeldexShortcutById(id, e);
          return;
        }
      }
    }
  }
});


// === Part 3: ツールチップ統一 ===

const GB_TOOLTIPS = {
  // --- 左クローム ---
  'left-chrome-command-trigger': { label: 'コマンドパレット', desc: 'コマンドやファイルを検索', shortcutId: 'global.commandPalette' },
  'left-chrome-floating-command': { label: 'コマンドパレット', desc: 'コマンドやファイルを検索', shortcutId: 'global.commandPalette' },
  'left-chrome-user':    { label: 'ユーザー', desc: 'ユーザー設定を開く' },
  'left-chrome-floating-user': { label: 'ユーザー', desc: 'ユーザー設定を開く' },
  'left-chrome-help': { label: 'ヘルプ', desc: 'ヘルプメニューを開く' },
  'left-chrome-floating-help': { label: 'ヘルプ', desc: 'ヘルプメニューを開く' },
  'left-chrome-trash': { label: 'ゴミ箱', desc: '削除済みファイルを開く' },
  'left-chrome-floating-trash': { label: 'ゴミ箱', desc: '削除済みファイルを開く' },
  'left-chrome-settings': { label: '設定', desc: '設定ダイアログを開く', shortcutId: 'global.settings' },
  'left-chrome-floating-settings': { label: '設定', desc: '設定ダイアログを開く', shortcutId: 'global.settings' },
  'btn-sidebar-toggle': { label: 'フォルダツリー', desc: 'フォルダツリーの表示/非表示' },
  'btn-tb-annotation':  { label: '注釈ツール', desc: '手描き注釈ツールバーの表示/非表示', shortcutId: 'global.annotation' },
  'btn-overlay-toggle': { label: 'オーバーレイ', desc: '注釈の表示/非表示を切替' },
  'btn-filter':         { label: 'フィルタ', desc: 'フィルタ条件を設定', shortcutId: 'db.filter' },
  'btn-split-toggle':   { label: 'スプリットビュー', desc: '画面を分割して比較表示' },
  'btn-toc-toggle':     { label: '目次', desc: 'ノートの目次を表示/非表示' },
  'btn-note-vertical':  { label: '縦書き/横書き', desc: '縦書き/横書きモードの切替' },
  'btn-heading-indent': { label: 'インデント', desc: '見出しインデント表示の切替' },
  'btn-version':        { label: 'バージョン管理', desc: 'バージョン管理パネルを開く' },
  'rab-detail':         { label: 'オプション', desc: 'オプションパネルを開く' },
  'rab-calendar':       { label: 'スケジュール', desc: 'スケジュールパネルを開く' },
  'rab-chat':           { label: 'チャット', desc: 'チャットパネルを開く' },
  'rab-tags':           { label: 'タグ', desc: 'タグ管理パネルを開く' },
  'rab-annotation':     { label: '注釈', desc: '注釈パネルを開く' },
  'rab-history':        { label: '履歴', desc: '操作履歴パネルを開く' },

  // --- サイドバー ---
  'btn-tree-search-clear': { label: '検索をクリア', desc: 'ツリー検索をクリア' },
  'btn-vault-search':   { label: '全文検索', desc: 'ソースフォルダ全体を検索', shortcutId: 'global.vaultSearch' },
  'btn-filter-toggle':  { label: 'フィルタ', desc: 'フィルタ表示の切替' },

  // --- CSVツールバー ---
  'csv-add-row':        { label: '行追加', desc: 'CSVに新しい行を追加' },
  'csv-add-col':        { label: '列追加', desc: 'CSVに新しい列を追加' },
  'csv-to-db':          { label: 'DB変換', desc: 'CSVをシートに変換' },

  // --- フォルダビューツールバー ---
  'folder-btn-slideshow': { label: 'スライドショー', desc: 'スライドショーを開始' },

  // --- チャット ---
  'chat-send-btn':      { label: '送信', desc: 'チャットメッセージを送信' },
};

function _updateAllTooltips() {
  const shortcuts = _getEffectiveShortcuts();

  // ID指定のツールチップ
  for (const [elemId, tip] of Object.entries(GB_TOOLTIPS)) {
    const el = document.getElementById(elemId);
    if (!el) continue;
    let text = tip.title || tip.label;
    if (!tip.title && tip.desc) text += ' — ' + tip.desc;
    if (tip.shortcutId && shortcuts[tip.shortcutId]?.key) {
      text += ' (' + _formatKeyDisplay(shortcuts[tip.shortcutId].key) + ')';
    }
    el.title = text;
  }

  // data-shortcut-id 属性を持つ要素（動的生成ボタン用）
  document.querySelectorAll('[data-shortcut-id]').forEach(el => {
    const id = el.dataset.shortcutId;
    const def = shortcuts[id];
    if (def) {
      const base = (el.title || el.textContent.trim()).replace(/\s*\([^)]*\)\s*$/, '');
      el.title = def.key ? base + ' (' + _formatKeyDisplay(def.key) + ')' : base;
    }
  });
}


// === Part 2-2: ショートカット設定タブ ===

const GB_SHORTCUT_SCOPE_ORDER = ['global', 'note', 'scenario', 'database', 'board', 'calendar', 'csv', 'folder', 'panelset'];
const GB_SHORTCUT_SCOPE_LABELS = {
  global: '全体',
  note: 'ノート',
  scenario: 'シナリオ',
  database: 'シート',
  board: 'ボード',
  calendar: 'スケジュール',
  csv: 'CSV',
  folder: 'フォルダ',
  panelset: 'パネルセット',
};

function _shortcutDisplayScope(id, def) {
  if (id.startsWith('panelset.')) return 'panelset';
  return def.scope || 'global';
}

function _shortcutSettingsGroups(shortcuts, custom) {
  const groups = Object.fromEntries(GB_SHORTCUT_SCOPE_ORDER.map(scope => [scope, []]));
  for (const [id, def] of Object.entries(shortcuts)) {
    const displayScope = _shortcutDisplayScope(id, def);
    if (!groups[displayScope]) groups[displayScope] = [];
    groups[displayScope].push({ id, displayScope, ...def, isCustom: !!custom[id] });
  }
  return groups;
}

function _applyShortcutSettingsFilter(container) {
  const q = (container.querySelector('#shortcut-search')?.value || '').trim().toLowerCase();
  const selectedScope = container.querySelector('#shortcut-scope-filter')?.value || 'all';
  container.querySelectorAll('.shortcut-row').forEach(row => {
    const matchesScope = selectedScope === 'all' || row.dataset.scope === selectedScope;
    const matchesSearch = !q || (row.dataset.search || '').includes(q);
    row.hidden = !(matchesScope && matchesSearch);
  });
  container.querySelectorAll('.shortcut-group').forEach(group => {
    const visibleCount = Array.from(group.querySelectorAll('.shortcut-row')).filter(row => !row.hidden).length;
    group.hidden = visibleCount === 0;
    const count = group.querySelector('.shortcut-group-count');
    if (count) count.textContent = visibleCount + '件';
  });
  const empty = container.querySelector('#shortcut-empty');
  if (empty) empty.hidden = !!container.querySelector('.shortcut-group:not([hidden])');
}

function _shortcutSettingsScopeOptionsHtml(scopeOptions, previousScope) {
  let html = '<option value="all"' + (previousScope === 'all' ? ' selected' : '') + '>すべて</option>';
  for (const [scope, items] of scopeOptions) {
    html += '<option value="' + esc(scope) + '"' + (previousScope === scope ? ' selected' : '') + '>' + esc(GB_SHORTCUT_SCOPE_LABELS[scope] || scope) + ' (' + items.length + ')</option>';
  }
  return html;
}

function _shortcutSettingsRowHtml(item) {
  const customStyle = item.isCustom ? ' color:var(--accent);' : '';
  const status = item.isCustom ? 'カスタム' : '既定';
  const scopeLabel = GB_SHORTCUT_SCOPE_LABELS[item.displayScope] || item.displayScope;
  const searchText = [item.label, item.id, item.key, scopeLabel].join(' ').toLowerCase();
  let html = '<div class="shortcut-row" data-id="' + esc(item.id) + '" data-scope="' + esc(item.displayScope) + '" data-search="' + esc(searchText) + '" style="display:flex;align-items:center;padding:4px 0;gap:8px;">';
  html += '<span style="flex:1;min-width:0;font-size:12px;" title="' + esc(item.id) + '">' + esc(item.label) + '</span>';
  html += '<span class="shortcut-status" style="width:56px;text-align:center;font-size:11px;color:' + (item.isCustom ? 'var(--accent)' : 'var(--fg2)') + ';">' + status + '</span>';
  html += '<kbd class="shortcut-key" data-id="' + esc(item.id) + '" style="min-width:120px;text-align:center;padding:2px 8px;font-size:12px;background:var(--bg3);border:1px solid var(--border);border-radius:3px;cursor:pointer;' + customStyle + '" title="クリックして変更">' + esc(_shortcutKeyDisplay(item.key)) + '</kbd>';
  if (item.isCustom) {
    html += '<button class="shortcut-reset gb-btn gb-btn-xs gb-btn-quiet" data-id="' + esc(item.id) + '" data-e2e-id="shortcut-reset-' + esc(item.id) + '" style="width:28px;padding:1px 4px;" title="デフォルトに戻す" aria-label="' + esc(item.label) + 'をデフォルトに戻す">✕</button>';
  } else {
    html += '<span style="width:28px;"></span>';
  }
  return html + '</div>';
}

function _shortcutSettingsGroupHtml(scope, items) {
  let html = '<div class="shortcut-group" data-scope="' + esc(scope) + '" style="margin-top:10px;">';
  html += '<div style="display:flex;align-items:center;gap:8px;font-weight:bold;font-size:13px;padding:8px 0 4px;border-bottom:1px solid var(--border);margin-bottom:4px;">';
  html += '<span>' + esc(GB_SHORTCUT_SCOPE_LABELS[scope] || scope) + '</span>';
  html += '<span class="shortcut-group-count gb-section-desc" style="margin-left:auto;margin-bottom:0;">' + items.length + '件</span>';
  html += '</div>';
  html += items.map(_shortcutSettingsRowHtml).join('');
  return html + '</div>';
}

function renderShortcutSettings(container) {
  const shortcuts = _getEffectiveShortcuts();
  const custom = _getCustomShortcuts();
  const groups = _shortcutSettingsGroups(shortcuts, custom);
  const previousSearch = container.querySelector('#shortcut-search')?.value || '';
  const previousScope = container.querySelector('#shortcut-scope-filter')?.value || 'all';
  const scopeOptions = Object.entries(groups).filter(([, items]) => items.length);

  let html = '<section class="gb-section gb-section--boxed shortcut-settings-wrap" style="max-height:500px;overflow-y:auto;">';
  html += '<div class="gb-section-title">ショートカット</div>';
  html += '<div style="margin-bottom:10px;display:grid;grid-template-columns:minmax(0,1fr) minmax(120px,180px) auto;gap:8px;align-items:center;">';
  html += '<input id="shortcut-search" class="gb-input" type="text" placeholder="検索" value="' + esc(previousSearch) + '">';
  html += '<select id="shortcut-scope-filter" class="gb-select">';
  html += _shortcutSettingsScopeOptionsHtml(scopeOptions, previousScope);
  html += '</select>';
  html += '<button id="shortcut-reset-all" class="gb-btn gb-btn-sm" style="white-space:nowrap;">すべてリセット</button>';
  html += '</div>';
  html += scopeOptions.map(([scope, items]) => _shortcutSettingsGroupHtml(scope, items)).join('');
  html += '<div id="shortcut-empty" class="gb-section-desc" hidden style="padding:16px 0;">該当するショートカットがありません</div>';
  html += '</section>';
  container.innerHTML = html;

  // --- イベントバインド ---

  // キー変更
  container.querySelectorAll('.shortcut-key').forEach(kbd => {
    kbd.addEventListener('click', () => _startKeyCapture(kbd, container));
  });

  // 個別リセット
  container.querySelectorAll('.shortcut-reset').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id;
      const custom = _getCustomShortcuts();
      delete custom[id];
      _saveCustomShortcuts(custom);
      renderShortcutSettings(container);
      _updateAllTooltips();
    });
  });

  // 全リセット
  container.querySelector('#shortcut-reset-all')?.addEventListener('click', async () => {
    if (!await cfConfirm('すべてのショートカットをデフォルトに戻しますか？')) return;
    _saveCustomShortcuts({});
    renderShortcutSettings(container);
    _updateAllTooltips();
  });

  container.querySelector('#shortcut-search')?.addEventListener('input', () => _applyShortcutSettingsFilter(container));
  container.querySelector('#shortcut-scope-filter')?.addEventListener('change', () => _applyShortcutSettingsFilter(container));
  _applyShortcutSettingsFilter(container);
}

function _startKeyCapture(kbd, settingsContainer) {
  kbd.textContent = 'キーを入力...';
  kbd.style.background = 'var(--accent)';
  kbd.style.color = '#fff';

  const handler = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.key === 'Escape') {
      document.removeEventListener('keydown', handler, true);
      const shortcuts = _getEffectiveShortcuts();
      kbd.textContent = _shortcutKeyDisplay(shortcuts[kbd.dataset.id]?.key || '');
      kbd.style.background = '';
      kbd.style.color = '';
      return;
    }
    const newKey = _normalizeKeyEvent(e);
    if (!newKey) return; // 修飾キー単体は無視（入力継続）
    const id = kbd.dataset.id;

    const conflict = _checkKeyConflict(id, newKey);
    if (conflict) {
      kbd.textContent = '競合: ' + conflict.label;
      setTimeout(() => {
        kbd.textContent = _shortcutKeyDisplay(_getEffectiveShortcuts()[id]?.key || '');
        kbd.style.background = '';
        kbd.style.color = '';
      }, 1500);
      document.removeEventListener('keydown', handler, true);
      return;
    }

    const custom = _getCustomShortcuts();
    // デフォルトと同じなら削除（カスタム扱いにしない）
    if (_normalizeKeyDef(GB_SHORTCUTS[id]?.key || '') === newKey) {
      delete custom[id];
    } else {
      custom[id] = { key: newKey };
    }
    _saveCustomShortcuts(custom);
    document.removeEventListener('keydown', handler, true);
    renderShortcutSettings(settingsContainer);
    _updateAllTooltips();
  };
  document.addEventListener('keydown', handler, true);
}

function _checkKeyConflict(selfId, newKey) {
  const shortcuts = _getEffectiveShortcuts();
  const selfScope = shortcuts[selfId]?.scope;
  for (const [id, def] of Object.entries(shortcuts)) {
    if (id === selfId) continue;
    if (!def.key) continue;
    if (_normalizeKeyDef(def.key) === newKey) {
      if (def.scope === selfScope || def.scope === 'global' || selfScope === 'global') {
        return def;
      }
    }
  }
  return null;
}


// === 初期化 ===

document.addEventListener('DOMContentLoaded', _updateAllTooltips);
