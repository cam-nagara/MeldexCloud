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

  const scopes = _resolveShortcutScope();
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
  'rab-calendar':       { label: 'スケジューラー', desc: 'スケジューラーパネルを開く' },
  'rab-chat':           { label: 'チャット', desc: 'チャットパネルを開く' },
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
  calendar: 'スケジューラー',
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
