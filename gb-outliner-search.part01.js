/* gb-outliner-search.js: outliner filter / search helpers */

/* ==============================
   グローバルフィルタ
   ============================== */
// 既知タイプのラベル辞書（表示順序も兼ねる）
const GF_TYPE_LABELS = {
  page: 'ノート', scenario: '旧シナリオ', scriptnote: 'シナリオ', board: 'ボード', calendar: 'カレンダー', database: 'シート',
  image: '画像', video: '動画', audio: '音声', html: 'HTML', csv: 'CSV',
  psd: 'Photoshop', clip: 'CLIP STUDIO', '3d': '3Dモデル',
  document: '文書', archive: 'アーカイブ', app: 'アプリ', chat: 'チャット', unknown: 'その他',
};
// 既知タイプの表示順序
const GF_TYPE_ORDER = ['page','scenario','board','calendar','database','chat','image','video','audio','html','csv','psd','clip','3d','document','archive','app','unknown'];

function _normalizeGlobalFilter(raw) {
  const data = raw && typeof raw === 'object' ? raw : {};
  return {
    enabled: !!data.enabled,
    allTypes: !!data.allTypes,
    types: Array.isArray(data.types) ? [...new Set(data.types)] : [],
    modifiedDays: Number.isFinite(Number(data.modifiedDays)) ? Math.max(0, parseInt(data.modifiedDays, 10) || 0) : 0,
  };
}

let _globalFilter = _normalizeGlobalFilter(JSON.parse(localStorage.getItem('global-filter') || '{"enabled":false,"allTypes":false,"types":[],"modifiedDays":0}'));
const OUTLINER_FILTER_SHARED_KEY = 'gb:outliner-filter-shared';
const OUTLINER_FILTER_SHARED_STATE_KEY = 'gb:outliner-filter-shared-state';

function isOutlinerFilterShared() {
  return localStorage.getItem(OUTLINER_FILTER_SHARED_KEY) !== '0';
}

function setOutlinerFilterShared(shared) {
  const on = shared !== false;
  localStorage.setItem(OUTLINER_FILTER_SHARED_KEY, on ? '1' : '0');
  if (on) saveCurrentLayoutFilterState();
}

function _emptyOutlinerFilterState() {
  return {
    globalFilter: _normalizeGlobalFilter({}),
    includeEntities: false,
    filterBarVisible: false,
    treeSearchQuery: '',
  };
}

function _legacyOutlinerFilterState() {
  let filter = null;
  try { filter = JSON.parse(localStorage.getItem('global-filter') || 'null'); } catch {}
  return {
    globalFilter: _normalizeGlobalFilter(filter),
    includeEntities: localStorage.getItem('tree-search-include-entities') === 'true',
    filterBarVisible: localStorage.getItem('gb:filter-bar-visible') === '1',
    treeSearchQuery: '',
  };
}

function _sharedOutlinerFilterState() {
  try {
    const raw = JSON.parse(localStorage.getItem(OUTLINER_FILTER_SHARED_STATE_KEY) || 'null');
    if (raw && typeof raw === 'object') return _normalizeOutlinerFilterState(raw, _legacyOutlinerFilterState());
  } catch {}
  return _legacyOutlinerFilterState();
}

function _normalizeOutlinerFilterState(raw, fallback) {
  const base = fallback || _emptyOutlinerFilterState();
  const data = raw && typeof raw === 'object' ? raw : {};
  return {
    globalFilter: _normalizeGlobalFilter(data.globalFilter || base.globalFilter),
    includeEntities: data.includeEntities !== undefined ? !!data.includeEntities : !!base.includeEntities,
    filterBarVisible: data.filterBarVisible !== undefined ? !!data.filterBarVisible : !!base.filterBarVisible,
    treeSearchQuery: String(data.treeSearchQuery ?? base.treeSearchQuery ?? '').trim(),
  };
}

function _writeLegacyOutlinerFilterState(state) {
  const next = _normalizeOutlinerFilterState(state);
  localStorage.setItem('global-filter', JSON.stringify(next.globalFilter));
  localStorage.setItem('tree-search-include-entities', next.includeEntities ? 'true' : 'false');
  localStorage.setItem('gb:filter-bar-visible', next.filterBarVisible ? '1' : '0');
}

function _writeSharedOutlinerFilterState(state) {
  const next = _normalizeOutlinerFilterState(state);
  try { localStorage.setItem(OUTLINER_FILTER_SHARED_STATE_KEY, JSON.stringify(next)); } catch {}
  _writeLegacyOutlinerFilterState(next);
}

function _setOutlinerFilterStateValues(state) {
  const next = _normalizeOutlinerFilterState(state);
  _globalFilter = next.globalFilter;
  const entityCb = document.getElementById('gf-search-entities');
  if (entityCb) entityCb.checked = next.includeEntities;
  const bar = document.getElementById('global-filter-bar');
  const btn = document.getElementById('btn-filter-toggle');
  if (bar) bar.style.display = next.filterBarVisible ? '' : 'none';
  if (btn) btn.style.color = next.filterBarVisible ? 'var(--accent)' : 'var(--fg2)';
  const input = document.getElementById('sidebar-search-input');
  if (input) input.value = next.treeSearchQuery;
  const clearBtn = document.getElementById('btn-tree-search-clear');
  if (clearBtn) clearBtn.style.display = next.treeSearchQuery ? '' : 'none';
  try { _treeSearchQuery = next.treeSearchQuery.toLowerCase(); } catch {}
  if (isOutlinerFilterShared()) _writeSharedOutlinerFilterState(next);
  else _writeLegacyOutlinerFilterState(next);
}

function _getTreeSearchIncludeEntities() {
  const entityCb = document.getElementById('gf-search-entities');
  return entityCb ? !!entityCb.checked : localStorage.getItem('tree-search-include-entities') === 'true';
}

function getCurrentOutlinerFilterState() {
  const input = document.getElementById('sidebar-search-input');
  let treeSearchQuery = (input?.value || '').trim();
  if (!treeSearchQuery) {
    try { treeSearchQuery = _treeSearchQuery || ''; } catch {}
  }
  const bar = document.getElementById('global-filter-bar');
  const filterBarVisible = bar ? bar.style.display !== 'none' : localStorage.getItem('gb:filter-bar-visible') === '1';
  return {
    globalFilter: _normalizeGlobalFilter(_globalFilter),
    includeEntities: _getTreeSearchIncludeEntities(),
    filterBarVisible,
    treeSearchQuery,
  };
}

function _currentLayoutSourceForFilter() {
  if (typeof GBAppLayouts !== 'undefined' && typeof GBAppLayouts.getLayoutSource === 'function') {
    return GBAppLayouts.getLayoutSource();
  }
  return localStorage.getItem('gb:layout-source') || '';
}

function _loadCurrentLayoutFilterState() {
  if (isOutlinerFilterShared()) return _sharedOutlinerFilterState();
  const source = _currentLayoutSourceForFilter();
  if (source.startsWith('app:') && typeof GBAppLayouts !== 'undefined' && typeof GBAppLayouts.getFilterStateForAppLayout === 'function') {
    return GBAppLayouts.getFilterStateForAppLayout(source.slice(4));
  }
  return null;
}

function saveCurrentLayoutFilterState() {
  const state = getCurrentOutlinerFilterState();
  if (isOutlinerFilterShared()) {
    _writeSharedOutlinerFilterState(state);
    return true;
  }
  _writeLegacyOutlinerFilterState(state);
  const source = _currentLayoutSourceForFilter();
  if (source.startsWith('app:') && typeof GBAppLayouts !== 'undefined' && typeof GBAppLayouts.saveFilterStateForAppLayout === 'function') {
    return GBAppLayouts.saveFilterStateForAppLayout(source.slice(4), state);
  }
  return false;
}

function getSharedOutlinerFilterState() {
  return _sharedOutlinerFilterState();
}

function applyOutlinerFilterState(state, options) {
  _setOutlinerFilterStateValues(state || _emptyOutlinerFilterState());
  renderGlobalFilterUI();
  applyGlobalFilter();
  if (!options?.skipPersist) saveCurrentLayoutFilterState();
}

function setTreeSearchIncludeEntities(checked) {
  const entityCb = document.getElementById('gf-search-entities');
  if (entityCb) entityCb.checked = !!checked;
  localStorage.setItem('tree-search-include-entities', checked ? 'true' : 'false');
  let hasSearch = false;
  try { hasSearch = !!_treeSearchQuery; } catch {}
  if (hasSearch) applyTreeNameSearch();
  saveCurrentLayoutFilterState();
}

function _isGlobalFilterEnabled() { return !!_globalFilter.enabled; }
function _hasAllGlobalTypesSelected() { return !!_globalFilter.allTypes; }
function _showDatabaseByGlobalFilter() { return !_isGlobalFilterEnabled() || _hasAllGlobalTypesSelected() || _globalFilter.types.includes('database'); }
function _showEntityByGlobalFilter() { return !_isGlobalFilterEnabled() || _hasAllGlobalTypesSelected() || _globalFilter.types.includes('entity') || _globalFilter.types.includes('database'); }
function _showRegularNodeByGlobalFilter(item) { return !_isGlobalFilterEnabled() || matchesGlobalFilter(item); }

function _snapshotBaseTreeVisibility() {
  document.querySelectorAll('#outliner-tree .tree-node, #body-home .tree-node').forEach(node => {
    node.dataset.baseVisible = node.style.display === 'none' ? '0' : '1';
  });
}

// 初回フィルタ表示時にルート直下をall_files=trueでスキャンしてタイプを収集
let _fileTypesScanned = false;
async function scanFileTypesIfNeeded() {
  if (_fileTypesScanned) return;
  try {
    const roots = await apiFetch('/outliner-roots');
    const visible = roots.filter(r => r.visible);
    // 各ルート直下のみスキャン（軽量）
    await Promise.all(visible.map(async (root) => {
      try {
        const items = await apiFetch('/browse?path=' + encodeURIComponent(root.path) + '&root=' + encodeURIComponent(root.path) + '&all_files=true');
        registerFileTypes(items);
        // 1階層下のフォルダも軽くスキャン
        const folders = items.filter(it => it.type === 'folder');
        await Promise.all(folders.slice(0, 20).map(async (f) => {
          try {
            const sub = await apiFetch('/browse?path=' + encodeURIComponent(f.path) + '&root=' + encodeURIComponent(root.path) + '&all_files=true');
            registerFileTypes(sub);
          } catch(e) {}
        }));
      } catch(e) {}
    }));
    _fileTypesScanned = true;
  } catch(e) {
    _fileTypesScanned = false;
  }
}

function toggleGlobalFilter() {
  // フィルタバーは常時表示。この関数は互換性のため残す。
  // フィルタUIを更新する
  scanFileTypesIfNeeded().then(() => renderGlobalFilterUI());
}

// フィルタバー初期化（起動時にスキャン → UI描画）
function toggleGlobalFilterBar() {
  const bar = document.getElementById('global-filter-bar');
  const btn = document.getElementById('btn-filter-toggle');
  if (!bar) return;
  const hidden = bar.style.display === 'none';
  bar.style.display = hidden ? '' : 'none';
  if (btn) btn.style.color = hidden ? 'var(--accent)' : 'var(--fg2)';
  localStorage.setItem('gb:filter-bar-visible', hidden ? '1' : '0');
  saveCurrentLayoutFilterState();
}

function initGlobalFilterBar() {
  const chips = document.getElementById('gf-chips');
  const state = _loadCurrentLayoutFilterState() || _legacyOutlinerFilterState();
  _setOutlinerFilterStateValues(state);
  const shouldScan = !!state.filterBarVisible || !!state.globalFilter.enabled;
  if (!shouldScan) {
    renderGlobalFilterUI();
    applyGlobalFilter();
    return;
  }
  if (chips) chips.innerHTML = '<span style="color:var(--fg2);font-size:11px;">ファイル形式を読み込み中...</span>';
  scanFileTypesIfNeeded().then(() => { renderGlobalFilterUI(); applyGlobalFilter(); });
}

// ファイルタイプキャッシュ（browseで読み込まれた全タイプを蓄積）
const _knownFileTypes = new Set();
function registerFileTypes(items) {
  if (!items) return;
  items.forEach(it => {
    if (it && it.type && it.type !== 'folder' && it.type !== 'entity') _knownFileTypes.add(it.type);
  });
}

function renderGlobalFilterUI() {
  const container = document.getElementById('gf-chips');
  container.innerHTML = '';

  // キャッシュ + DOM + フォルダビューから収集
  const presentTypes = new Set(_knownFileTypes);
  document.querySelectorAll('#outliner-tree .tree-node, #body-home .tree-node').forEach(node => {
    const d = node._nodeData;
    if (d && d.type && d.type !== 'folder' && d.type !== 'entity' && !d._isRoot) presentTypes.add(d.type);
  });
  if (_folderItems) _folderItems.forEach(it => { if (it.type && it.type !== 'folder') presentTypes.add(it.type); });

  const sortedTypes = [...presentTypes].sort((a, b) => {
    const ia = GF_TYPE_ORDER.indexOf(a), ib = GF_TYPE_ORDER.indexOf(b);
    if (ia >= 0 && ib >= 0) return ia - ib;
    if (ia >= 0) return -1;
    if (ib >= 0) return 1;
    return a.localeCompare(b);
  });
  sortedTypes.forEach(typeVal => {
    const chip = document.createElement('span');
    const active = _hasAllGlobalTypesSelected() || _globalFilter.types.includes(typeVal);
    const label = GF_TYPE_LABELS[typeVal] || typeVal;
    chip.style.cssText = `padding:1px 6px;border-radius:8px;cursor:pointer;font-size:11px;border:1px solid ${active ? 'var(--accent)' : 'var(--border)'};background:${active ? 'var(--accent)' : 'transparent'};color:${active ? 'var(--ui-fg-strong)' : 'var(--fg2)'};${_isGlobalFilterEnabled() ? '' : 'opacity:0.6;'}`;
    chip.textContent = label;
    chip.addEventListener('click', () => {
      if (_hasAllGlobalTypesSelected()) {
        _globalFilter.allTypes = false;
        _globalFilter.types = sortedTypes.filter(t => t !== typeVal);
      } else if (active) {
        _globalFilter.types = _globalFilter.types.filter(t => t !== typeVal);
      } else {
        _globalFilter.types.push(typeVal);
      }
      _globalFilter.enabled = true;
      saveGlobalFilter();
      renderGlobalFilterUI();
    });
    container.appendChild(chip);
  });

  const sep = document.createElement('span');
  sep.style.cssText = 'width:1px;height:16px;background:var(--border);margin:0 4px;';
  container.appendChild(sep);

  const dateSelect = document.createElement('select');
  dateSelect.style.cssText = 'font-size:11px;background:var(--bg3);color:var(--fg);border:1px solid var(--border);border-radius:6px;padding:1px 4px;';
  [
    { v: 0, l: '更新日時: 指定なし' },
    { v: 1, l: '1日以内' },
    { v: 7, l: '7日以内' },
    { v: 30, l: '30日以内' },
  ].forEach(o => {
    const opt = document.createElement('option');
    opt.value = String(o.v); opt.textContent = o.l;
    if (_globalFilter.modifiedDays == o.v) opt.selected = true;
    dateSelect.appendChild(opt);
  });
  dateSelect.onchange = () => {
    _globalFilter.modifiedDays = parseInt(dateSelect.value, 10);
    _globalFilter.enabled = true;
    saveGlobalFilter();
    renderGlobalFilterUI();
  };
  container.appendChild(dateSelect);

  const filterToggle = document.createElement('span');
  filterToggle.style.cssText = `padding:1px 6px;border-radius:8px;cursor:pointer;font-size:11px;border:1px solid ${_isGlobalFilterEnabled() ? 'var(--accent)' : 'var(--border)'};color:${_isGlobalFilterEnabled() ? 'var(--accent)' : 'var(--fg2)'};`;
  filterToggle.textContent = _isGlobalFilterEnabled() ? 'フィルタOFF' : 'フィルタON';
  filterToggle.addEventListener('click', () => {
    _globalFilter.enabled = !_isGlobalFilterEnabled();
    saveGlobalFilter();
    renderGlobalFilterUI();
  });
  container.appendChild(filterToggle);

  const allTypes = sortedTypes;
  if (!_hasAllGlobalTypesSelected()) {
    const allOn = document.createElement('span');
    allOn.style.cssText = 'padding:1px 6px;border-radius:8px;cursor:pointer;font-size:11px;color:var(--accent);border:1px solid var(--accent);';
    allOn.textContent = 'すべて選択';
    allOn.addEventListener('click', () => {
      _globalFilter.allTypes = true;
      _globalFilter.types = [...allTypes];
      _globalFilter.enabled = true;
      saveGlobalFilter();
      renderGlobalFilterUI();
    });
    container.appendChild(allOn);
  }

  const allOff = document.createElement('span');
  allOff.style.cssText = 'padding:1px 6px;border-radius:8px;cursor:pointer;font-size:11px;color:var(--fg2);border:1px solid var(--border);';
  allOff.textContent = 'すべてオフ';
  allOff.addEventListener('click', () => {
    _globalFilter.allTypes = false;
    _globalFilter.types = [];
    _globalFilter.enabled = true;
    saveGlobalFilter();
    renderGlobalFilterUI();
  });
  container.appendChild(allOff);
}

function saveGlobalFilter() {
  localStorage.setItem('global-filter', JSON.stringify(_globalFilter));
  // フォルダツリーとフォルダビューに適用
  applyGlobalFilter();
  saveCurrentLayoutFilterState();
}

// 起動時のフィルタ初期化は initApp 内の outlinerPromise 完了後に実行される

function applyGlobalFilter() {
  const allNodes = document.querySelectorAll('#outliner-tree .tree-node, #body-home .tree-node');

  if (!_isGlobalFilterEnabled()) {
    allNodes.forEach(node => {
      if (node._nodeData) node.style.display = '';
    });
    _snapshotBaseTreeVisibility();
    if (_treeSearchQuery) applyTreeNameSearch();
    return;
  }

  if (!_hasAllGlobalTypesSelected() && _globalFilter.types.length === 0) {
    allNodes.forEach(node => { node.style.display = 'none'; });
    _snapshotBaseTreeVisibility();
    if (_treeSearchQuery) applyTreeNameSearch();
    return;
  }

  allNodes.forEach(node => {
    const data = node._nodeData;
    if (!data) return;
    if (data._isRoot) { node.style.display = ''; return; }
    if (data.type === 'entity') {
      node.style.display = _showEntityByGlobalFilter() ? '' : 'none';
      return;
    }
    if (data.type === 'database') {
      node.style.display = _showDatabaseByGlobalFilter() ? '' : 'none';
      return;
    }
    if (data.type === 'folder') {
      node.style.display = '';
      return;
    }
    node.style.display = _showRegularNodeByGlobalFilter(data) ? '' : 'none';
  });
  _hideEmptyFilteredFolders();
  _snapshotBaseTreeVisibility();
  if (_treeSearchQuery) applyTreeNameSearch();
}

function _hideEmptyFilteredFolders() {
  if (!_isGlobalFilterEnabled() || (!_hasAllGlobalTypesSelected() && _globalFilter.types.length === 0)) return;
  const allNodes = [...document.querySelectorAll('#outliner-tree .tree-node, #body-home .tree-node')].reverse();
  allNodes.forEach(node => {
    const data = node._nodeData;
    if (!data) return;
    if (data.type !== 'folder' && data.type !== 'database' && !data._isRoot) return;
    const childrenDiv = node.querySelector(':scope > .tree-children');
    if (!childrenDiv) return;
    const hasVisibleChild = [...childrenDiv.querySelectorAll(':scope > .tree-node')].some(c => c.style.display !== 'none');
    if (childrenDiv.dataset.loaded === 'false') return;
    node.style.display = hasVisibleChild ? '' : 'none';
  });
}

function matchesGlobalFilter(item) {
  if (!_isGlobalFilterEnabled()) return true;
  if (!_hasAllGlobalTypesSelected() && !_globalFilter.types.includes(item.type)) return false;
  if (_globalFilter.modifiedDays > 0 && item.modified) {
    const mDate = new Date(item.modified);
    const cutoff = new Date(Date.now() - _globalFilter.modifiedDays * 86400000);
    if (mDate < cutoff) return false;
  }
  return true;
}

/* ==============================
   サイドバー トグル（モバイル）
   ============================== */
// サイドバーリサイズ
(function() {
  const handle = document.getElementById('sidebar-resize');
  const sidebar = document.getElementById('sidebar');
  let startX, startW;

  handle.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    startX = e.clientX;
    startW = sidebar.offsetWidth;
    handle.classList.add('active');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.querySelectorAll('iframe').forEach(f => f.style.pointerEvents = 'none');

    const onMove = (e2) => {
      const w = Math.max(120, Math.min(600, startW + e2.clientX - startX));
      sidebar.style.width = w + 'px';
    };
    const onUp = () => {
      handle.classList.remove('active');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.querySelectorAll('iframe').forEach(f => f.style.pointerEvents = '');
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      // 幅を保存
      localStorage.setItem('sidebar-width', sidebar.offsetWidth);
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  });

  // 保存された幅を復元
  const saved = localStorage.getItem('sidebar-width');
  if (saved) sidebar.style.width = saved + 'px';
})();

// サイドバーセクション開閉
function toggleSidebarSection(name) {
  const body = document.getElementById('body-' + name);
  const toggle = document.getElementById('toggle-' + name);
  if (!body) return;
  const collapsed = body.classList.toggle('collapsed');
  if (toggle) toggle.classList.toggle('expanded', !collapsed);
  _setSidebarSectionExpandedState(name, !collapsed);
  localStorage.setItem('sidebar-section-' + name, collapsed ? 'collapsed' : 'expanded');
}

function _setSidebarSectionExpandedState(name, expanded) {
  const header = document.querySelector(`.sidebar-section-header[data-sidebar-section="${name}"]`);
  if (header) header.setAttribute('aria-expanded', expanded ? 'true' : 'false');
}

function _sidebarFolderLabelFromPath(path, fallback) {
  const value = String(path || '').replace(/[\\/]+$/, '');
  if (!value) return fallback || '';
  return value.split(/[\\/]/).filter(Boolean).pop() || fallback || value;
}

async function _openSidebarSectionFolder(name) {
  if (name === 'home') {
    if (!_homeFolderPath) {
      showStatus('ホームフォルダが設定されていません。設定 → 全般から設定してください。', true);
      return;
    }
    openFolder(typeof HOME_FOLDER_DISPLAY_LABEL !== 'undefined' ? HOME_FOLDER_DISPLAY_LABEL : 'ホームフォルダ', _homeFolderPath, { fromExplorer: true });
    return;
  }
  if (name !== 'roots') return;
  let root = null;
  try {
    const roots = await apiFetch('/outliner-roots');
    root = (roots || []).find(item => item && item.visible !== false && item.path);
  } catch (_) {}
  const path = root?.path || (typeof state !== 'undefined' ? state.vaultPath : '') || '';
  if (!path) {
    showStatus('ソースフォルダが設定されていません。設定 → 全般から追加してください。', true);
    return;
  }
  const label = root?.name || _sidebarFolderLabelFromPath(path, 'ソースフォルダ');
  openFolder(label, path, { fromExplorer: true });
}

function initSidebarSectionHeaders() {
  document.querySelectorAll('.sidebar-section-header[data-sidebar-section]').forEach(header => {
    if (header.__meldexSidebarSectionBound) return;
    header.__meldexSidebarSectionBound = true;
    header.setAttribute('role', 'button');
    header.tabIndex = 0;
    const name = header.dataset.sidebarSection;
    const onToggle = (event) => {
      if (!name || event.target?.closest?.('.sidebar-section-btn')) return;
      event.preventDefault();
      if ((name === 'home' || name === 'roots') && !event.target?.closest?.('.sidebar-section-toggle')) {
        _openSidebarSectionFolder(name);
        return;
      }
      toggleSidebarSection(name);
    };
    header.addEventListener('click', onToggle);
    header.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      if ((name === 'home' || name === 'roots') && event.key === ' ') {
        event.preventDefault();
        toggleSidebarSection(name);
        return;
      }
      onToggle(event);
    });
  });
}

// ソースフォルダの管理を開く
function _openSourceFolderSettings() {
  if (typeof showSettingsModal === 'function') showSettingsModal();
}

// ホームセクションの追加メニュー
function _showHomeAddMenu(e) {
  e.stopPropagation();
  if (!_homeFolderPath) { showStatus('ホームフォルダが設定されていません。設定 → 全般から設定してください。'); return; }
  const btn = e.target.closest('.sidebar-section-btn');
  if (!btn) return;
  document.querySelectorAll('.gb-context-menu').forEach(m => m.remove());
  const menu = document.createElement('div');
  menu.className = 'gb-context-menu';
  const _z = parseFloat(document.documentElement.style.zoom) || 1;
  const r = btn.getBoundingClientRect();
  menu.style.left = (r.left / _z) + 'px';
  menu.style.top = (r.bottom / _z) + 'px';
  [['フォルダ','folder','folder'],['ノート','page','page'],['シナリオ','scriptnote','bookOpenText'],['シート','database','db'],['ボード','board','presentation'],['スマートシート','smart-db','databaseSearch']].forEach(([label,type,icon]) => {
    const el = document.createElement('div');
    el.className = 'gb-context-menu-item';
    el.innerHTML = '<span class="menu-icon">' + lucide(icon, 14) + '</span>' + label;
    el.addEventListener('click', async () => { menu.remove(); await addItemAt(_homeFolderPath || '', type); });
    menu.appendChild(el);
  });
  document.body.appendChild(menu);
  requestAnimationFrame(() => {
    const h = (e2) => { if (!menu.contains(e2.target)) { menu.remove(); document.removeEventListener('pointerdown', h); } };
    document.addEventListener('pointerdown', h);
  });
}

// セクション状態復元
function restoreSidebarSections() {
  for (const name of ['recent', 'favorites', 'home', 'smart-db', 'roots']) {
    const state = localStorage.getItem('sidebar-section-' + name);
    const body = document.getElementById('body-' + name);
    const toggle = document.getElementById('toggle-' + name);
    if (!body) continue;
    if (state === 'expanded' || (state === null && (name === 'roots' || name === 'home'))) {
      body.classList.remove('collapsed');
      if (toggle) toggle.classList.add('expanded');
      _setSidebarSectionExpandedState(name, true);
    } else if (state === 'collapsed') {
      body.classList.add('collapsed');
      if (toggle) toggle.classList.remove('expanded');
      _setSidebarSectionExpandedState(name, false);
    } else {
      _setSidebarSectionExpandedState(name, !body.classList.contains('collapsed'));
    }
  }
}
initSidebarSectionHeaders();
restoreSidebarSections();

// 最近使った項目を更新（既存のaddRecentと同じフォーマット: label/path/type/time）
function updateRecentItems() {
  const container = document.getElementById('body-recent');
  if (!container) return;
  // #body-recent は #tree-scroll-container 内にあるため、innerHTML を空にすると
  // ブラウザのスクロールアンカリングがアンカーを失ってツリーが先頭に飛ぶ。
  // ツリークリックハンドラのガードが稼働中はそちらに任せ、ここでの復元をスキップする。
  const treeScroll = document.getElementById('tree-scroll-container');
  const lockActive = _treeClickScrollLock;
  const savedScrollTop = (!lockActive && treeScroll) ? treeScroll.scrollTop : 0;
  const recent = JSON.parse(localStorage.getItem('meldex-recent') || '[]').slice(0, 5);
  container.innerHTML = '';
  const _restoreAfter = () => {
    if (lockActive || !treeScroll) return; // ガード稼働中はスキップ
    if (treeScroll.scrollTop !== savedScrollTop) treeScroll.scrollTop = savedScrollTop;
  };
  if (recent.length === 0) {
    container.innerHTML = '<div style="padding:4px 12px;font-size:11px;color:var(--fg2);">なし</div>';
    _restoreAfter();
    requestAnimationFrame(_restoreAfter);
    return;
  }
  recent.forEach(r => {
    const item = document.createElement('div');
    item.className = 'fav-item';
    const name = r.label || r.name || r.path?.split('/').pop() || '?';
    const iconName = _outlinerIconName(r.type, r.path, false);
    item.innerHTML = lucide(iconName, 14) + ' <span style="overflow:hidden;text-overflow:ellipsis;">' + esc(name) + '</span>';
    item.title = r.path || '';
    item.addEventListener('click', () => {
      const _expOpts = { fromExplorer: true };
      if (r.type === 'page') openPage(name, r.path, _expOpts);
      else if (r.type === 'board') openBoard(name, r.path, _expOpts);
      else if (r.type === 'scriptnote' || r.type === 'scenario' || (typeof isScriptNotePath === 'function' && isScriptNotePath(r.path))) openScenarioInScriptNote?.(r.path, name, _expOpts);
      else if (r.type === 'database') selectDatabase(r.path, null, _expOpts);
      else if (r.type === 'smart-db') {
        if ((r.path || '').startsWith('smart-db:')) selectSmartDb(r.path.replace('smart-db:', ''), null, _expOpts);
        else if (typeof openSmartDbFile === 'function') openSmartDbFile(name, r.path, _expOpts);
      }
      else if (r.type === 'entity') { if (typeof selectEntity === 'function') selectEntity(r.path, _expOpts); }
      else if (r.type === 'csv') { if (typeof openCsvFile === 'function') openCsvFile(name, r.path, _expOpts); }
      else if (r.type === 'media') { const ext = (r.path||'').split('.').pop().toLowerCase(); const mt = ['jpg','jpeg','png','gif','webp','svg','bmp','avif','ico'].includes(ext)?'image':['mp4','mov','avi','webm'].includes(ext)?'video':['mp3','wav','ogg','flac'].includes(ext)?'audio':'file'; openMedia(name, r.path, mt, _expOpts); }
      else if (r.type === 'html') { if (typeof openHtmlFile === 'function') openHtmlFile(name, r.path, _expOpts); else openPage(name, r.path, _expOpts); }
      else openPage(name, r.path, _expOpts);
    });
    container.appendChild(item);
  });
  _restoreAfter();
  requestAnimationFrame(_restoreAfter);
}

// お気に入り
// お気に入り（ツリー構造）
// データ形式: [{name, path, type, children:[...]}] — type:'fav-folder'はお気に入りフォルダ
function getFavorites() { return JSON.parse(localStorage.getItem('meldex-favorites') || '[]'); }
function saveFavorites(favs) { localStorage.setItem('meldex-favorites', JSON.stringify(favs)); }

function _favFindAndRemove(tree, path) {
  for (let i = 0; i < tree.length; i++) {
    if (tree[i].path === path && tree[i].type !== 'fav-folder') { tree.splice(i, 1); return true; }
    if (tree[i].children && _favFindAndRemove(tree[i].children, path)) return true;
  }
  return false;
}

function _favFindAndRemoveNode(tree, path) {
  for (let i = 0; i < tree.length; i++) {
    if (tree[i].path === path) return tree.splice(i, 1)[0];
    if (tree[i].children) {
      const found = _favFindAndRemoveNode(tree[i].children, path);
      if (found) return found;
    }
  }
  return null;
}

function _favContainsPath(node, path) {
  if (!node || !path) return false;
  if (node.path === path) return true;
  return (node.children || []).some(child => _favContainsPath(child, path));
}

function _favCloneNode(node) {
  return JSON.parse(JSON.stringify(node));
}

function _favExists(tree, path) {
  for (const n of tree) {
    if (n.path === path && n.type !== 'fav-folder') return true;
    if (n.children && _favExists(n.children, path)) return true;
  }
  return false;
}

function addToFavorites(name, path, type) {
  const favs = getFavorites();
  if (_favExists(favs, path)) return;
  const before = typeof captureOutlinerSettingsHistory === 'function'
    ? captureOutlinerSettingsHistory(['meldex-favorites'])
    : null;
  const fid = _pathToFileId(path);
  favs.push({ name, path, type, ...(fid ? { file_id: fid } : {}) });
  saveFavorites(favs);
  if (before && typeof pushOutlinerSettingsHistory === 'function') {
    pushOutlinerSettingsHistory('フォルダツリー: お気に入り追加', before, path, ['meldex-favorites']);
  }
  renderFavorites();
  showStatus('お気に入りに追加しました');
}

function removeFromFavorites(path) {
  const favs = getFavorites();
  const before = typeof captureOutlinerSettingsHistory === 'function'
    ? captureOutlinerSettingsHistory(['meldex-favorites'])
    : null;
  const removed = _favFindAndRemove(favs, path);
  if (!removed) return;
  saveFavorites(favs);
  if (before && typeof pushOutlinerSettingsHistory === 'function') {
    pushOutlinerSettingsHistory('フォルダツリー: お気に入り削除', before, path, ['meldex-favorites']);
  }
  renderFavorites();
  showStatus('お気に入りから削除しました');
}

function addFavFolder() {
  const favs = getFavorites();
  const before = typeof captureOutlinerSettingsHistory === 'function'
    ? captureOutlinerSettingsHistory(['meldex-favorites'])
    : null;
  // 無題連番
  let idx = 1, name = '無題';
  const existingNames = favs.filter(f => f.type === 'fav-folder').map(f => f.name);
  while (existingNames.includes(name)) { idx++; name = '無題' + idx; }
  favs.push({ name, type: 'fav-folder', path: '_fav_' + Date.now(), children: [] });
  saveFavorites(favs);
  if (before && typeof pushOutlinerSettingsHistory === 'function') {
    pushOutlinerSettingsHistory('フォルダツリー: お気に入りフォルダ追加', before, name, ['meldex-favorites']);
  }
  renderFavorites();
}

function removeFavFolder(id) {
  const favs = getFavorites();
  const before = typeof captureOutlinerSettingsHistory === 'function'
    ? captureOutlinerSettingsHistory(['meldex-favorites'])
    : null;
  if (_favFindAndRemoveNode(favs, id)) {
    saveFavorites(favs);
    if (before && typeof pushOutlinerSettingsHistory === 'function') {
      pushOutlinerSettingsHistory('フォルダツリー: お気に入りフォルダ削除', before, id, ['meldex-favorites']);
    }
    renderFavorites();
  }
}

function renderFavorites() {
  const container = document.getElementById('body-favorites');
  if (!container) return;
  const favs = getFavorites();
  container.innerHTML = '';

  if (favs.length === 0) return;

  function _renderFavNode(node, parent, depth) {
    const isFavFolder = node.type === 'fav-folder';
    const div = document.createElement('div');
    div.style.marginLeft = (depth * 12) + 'px';
    div.dataset.favPath = node.path;

    const row = document.createElement('div');
    row.className = 'fav-item';
    row.draggable = true;

    if (isFavFolder) {
      const toggle = document.createElement('span');
      toggle.style.cssText = 'width:12px;text-align:center;cursor:pointer;flex-shrink:0;display:flex;align-items:center;';
      toggle.innerHTML = lucide('chevronRight', 12);
      toggle.classList.add('fav-toggle');
      const childDiv = document.createElement('div');
      childDiv.className = 'fav-children';
      childDiv.style.display = 'none';
      toggle.addEventListener('click', (e) => {
        e.stopPropagation();
        const open = childDiv.style.display !== 'none';
        childDiv.style.display = open ? 'none' : '';
        toggle.style.transform = open ? '' : 'rotate(90deg)';
      });
      row.appendChild(toggle);
      const ico = document.createElement('span');
      ico.innerHTML = lucide('folder', 14);
      ico.style.cssText = 'display:inline;flex-shrink:0;';
      row.appendChild(ico);
      const lbl = document.createElement('span');
      lbl.style.cssText = 'overflow:hidden;text-overflow:ellipsis;';
      lbl.textContent = node.name;
      row.appendChild(lbl);
      row.oncontextmenu = async (e) => { e.preventDefault(); if (await cfConfirm('「' + node.name + '」フォルダを削除しますか？（中身は失われます）')) removeFavFolder(node.path); };
      div.appendChild(row);
      div.appendChild(childDiv);
      (node.children || []).forEach(c => _renderFavNode(c, childDiv, depth + 1));
      // D&Dドロップ先
      row.addEventListener('dragover', (e) => { e.preventDefault(); row.style.background = 'rgba(86,156,214,0.2)'; });
      row.addEventListener('dragleave', () => { row.style.background = ''; });
      row.addEventListener('drop', (e) => {
        e.preventDefault(); row.style.background = '';
        const data = JSON.parse(e.dataTransfer.getData('application/x-fav') || 'null');
        if (!data) return;
        if (data.path === node.path || (data.type === 'fav-folder' && _favContainsPath(data, node.path))) return;
        const before = typeof captureOutlinerSettingsHistory === 'function'
          ? captureOutlinerSettingsHistory(['meldex-favorites'])
          : null;
        // favs内からdataを探して移動
        const favs = getFavorites();
        const moved = _favFindAndRemoveNode(favs, data.path) || data;
        // node.pathのchildren先頭に追加
        function _findFolder(tree, id) { for (const n of tree) { if (n.path === id) return n; if (n.children) { const r = _findFolder(n.children, id); if (r) return r; } } return null; }
        const folder = _findFolder(favs, node.path);
        if (folder) { if (!folder.children) folder.children = []; folder.children.push(moved); }
        saveFavorites(favs);
        if (before && typeof pushOutlinerSettingsHistory === 'function') {
          pushOutlinerSettingsHistory('フォルダツリー: お気に入り並び順', before, node.path, ['meldex-favorites']);
        }
        renderFavorites();
      });
    } else {
      const iconName = _outlinerIconName(node.type, node.path, node.type === 'folder' && node.path === getWorkFolder());
      row.innerHTML = lucide(iconName, 14) + ' <span style="overflow:hidden;text-overflow:ellipsis;">' + esc(node.name) + '</span>';
      row.title = node.path;
      row.addEventListener('click', () => {
        const _expOpts = { fromExplorer: true };
        if (node.type === 'page') openPage(node.name, node.path, _expOpts);
        else if (node.type === 'board') openBoard(node.name, node.path, _expOpts);
        else if (node.type === 'scriptnote' || node.type === 'scenario' || (typeof isScriptNotePath === 'function' && isScriptNotePath(node.path))) openScenarioInScriptNote?.(node.path, node.name, _expOpts);
        else if (node.type === 'database') selectDatabase(node.path, null, _expOpts);
        else if (node.type === 'folder') openFolder(node.name, node.path, _expOpts);
        else if (node.type === 'smart-db' && typeof openSmartDbFile === 'function') openSmartDbFile(node.name, node.path, _expOpts);
      });
      row.oncontextmenu = (e) => { e.preventDefault(); removeFromFavorites(node.path); };
      div.appendChild(row);
    }

    // D&Dソース
    row.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('application/x-fav', JSON.stringify(_favCloneNode(node)));
      e.dataTransfer.effectAllowed = 'move';
    });

    parent.appendChild(div);
  }

  favs.forEach(f => _renderFavNode(f, container, 0));

  // ルートレベルのD&Dドロップ（古いリスナーをクリアして再登録）
  const fresh = container.cloneNode(false);
  while (container.firstChild) fresh.appendChild(container.firstChild);
  container.replaceWith(fresh);
  fresh.addEventListener('dragover', (e) => { e.preventDefault(); });
  fresh.addEventListener('drop', (e) => {
    if (e.target !== fresh) return; // フォルダ内dropは上で処理
    const data = JSON.parse(e.dataTransfer.getData('application/x-fav') || 'null');
    if (!data) return;
    const before = typeof captureOutlinerSettingsHistory === 'function'
      ? captureOutlinerSettingsHistory(['meldex-favorites'])
      : null;
    const favs = getFavorites();
    const moved = _favFindAndRemoveNode(favs, data.path) || data;
    favs.push(moved);
    saveFavorites(favs);
    if (before && typeof pushOutlinerSettingsHistory === 'function') {
      pushOutlinerSettingsHistory('フォルダツリー: お気に入り並び順', before, data.path, ['meldex-favorites']);
    }
    renderFavorites();
  });
}

renderFavorites();
updateRecentItems();

// ==============================
// スマートDB
// ==============================
/* DB: スマートDB → gb-database.js に移動 */

// ==============================
// ホームフォルダ
// ==============================
let _homeFolderPath = '';

async function loadHomeFolder() {
  try {
    const res = await apiFetch('/home-folder');
    _homeFolderPath = res.path || '';
    if (typeof setSystemLockedItems === 'function') {
      setSystemLockedItems(res.locked_paths || []);
    }
    if (typeof _primeFileLockCacheFromStorage === 'function') _primeFileLockCacheFromStorage();
    renderHomeFolderTree();
    if (typeof _scheduleFileLockRefreshForOutliner === 'function') _scheduleFileLockRefreshForOutliner();
  } catch {}
}

async function renderHomeFolderTree() {
  const container = document.getElementById('body-home');
  if (!container || !_homeFolderPath) return;
  if (typeof _unregisterTreeSubtree === 'function') _unregisterTreeSubtree(container);
  container.innerHTML = '';
  try {
    if (typeof _primeFileLockCacheFromStorage === 'function') _primeFileLockCacheFromStorage();
    const children = await apiFetch('/browse?path=' + encodeURIComponent(_homeFolderPath) + '&root=' + encodeURIComponent(_homeFolderPath) + '&all_files=true');
    registerFileTypes(children);
    if (typeof _registerOutlinerConflictPaths === 'function') _registerOutlinerConflictPaths(children);
    children.forEach(child => {
      container.appendChild(createTreeNodeFromBrowse(child, _homeFolderPath));
    });
    if (typeof _scheduleFileLockRefreshForOutliner === 'function') _scheduleFileLockRefreshForOutliner();
  } catch {
    if (typeof _unregisterTreeSubtree === 'function') _unregisterTreeSubtree(container);
    container.innerHTML = '<div style="padding:4px 12px;font-size:11px;color:var(--fg2);">読み込みエラー</div>';
  }
}

loadHomeFolder();

// ホームフォルダへのドロップ対応
(function() {
  const homeBody = document.getElementById('body-home');
  if (!homeBody) return;
  homeBody.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (!draggedNode) return;
    e.dataTransfer.dropEffect = 'move';
    homeBody.style.outline = '2px solid var(--accent)';
  });
  homeBody.addEventListener('dragleave', () => { homeBody.style.outline = ''; });
  homeBody.addEventListener('drop', async (e) => {
    e.preventDefault();
    homeBody.style.outline = '';
    if (!draggedNode || !_homeFolderPath) return;
    const nodes = (draggedNodes || [draggedNode]).filter(Boolean);
    for (const n of nodes) {
      const dragData = n._nodeData;
      if (!dragData || !dragData.path) continue;
      if (typeof isItemLocked === 'function' && isItemLocked(dragData.path)) { showStatus('編集ロック中の項目は移動できません', true); continue; }
      if (dragData.linked) { showStatus('リンクファイルは移動できません'); continue; }
      try {
        const oldPath = dragData.path;
        const _res = await apiPost('/outliner/move', { path: oldPath, dest_folder: _homeFolderPath });
        if (_res?.new_path && typeof renameAppPathReferences === 'function') {
          renameAppPathReferences(oldPath, _res.new_path, { label: _res.new_name || dragData.name, fileId: _res.file_id, type: dragData.type || 'page' });
        }
        if (typeof handleRelocateResponse === 'function') handleRelocateResponse(_res);
      } catch { showStatus('移動に失敗', true); }
    }
    await renderHomeFolderTree();
    await loadOutliner();
    showStatus(nodes.length + ' 件をホームフォルダに移動しました');
  });
})();

function closeSidebar() {
  const sidebar = document.getElementById('sidebar');
  const resize = document.getElementById('sidebar-resize');
  const btn = document.getElementById('btn-sidebar-toggle');
  const isMobile = window.innerWidth <= 768;
  if (isMobile) {
    sidebar.classList.remove('open');
    document.getElementById('sidebar-backdrop').classList.remove('open');
  } else {
    sidebar.style.display = 'none';
    if (resize) resize.style.display = 'none';
    if (btn) btn.classList.remove('active');
  }
}
function toggleSidebar(withFolderView) {
  const sidebar = document.getElementById('sidebar');
  const resize = document.getElementById('sidebar-resize');
  const btn = document.getElementById('btn-sidebar-toggle');
  const isMobile = window.innerWidth <= 768;
  if (isMobile) {
    sidebar.style.display = '';
    if (resize) resize.style.display = 'none';
    const opening = !sidebar.classList.contains('open');
    sidebar.classList.toggle('open');
    document.getElementById('sidebar-backdrop').classList.toggle('open');
    if (opening && withFolderView) showFolderViewForSidebar();
  } else {
    if (sidebar.style.display === 'none') {
      sidebar.style.display = '';
      if (resize) resize.style.display = '';
      if (btn) btn.classList.add('active');
      if (withFolderView) showFolderViewForSidebar();
    } else {
      sidebar.style.display = 'none';
      if (resize) resize.style.display = 'none';
      if (btn) btn.classList.remove('active');
    }
  }
}
// サイドバー表示時にメインパネルをフォルダビューに切り替える
function showFolderViewForSidebar() {
  // すでにコンテンツを表示中（ページ/シナリオ/DB等）ならそのまま維持
  if (state.view && state.view !== 'welcome') return;
  const _expOpts = { fromExplorer: true };
  // フォルダビューを表示: 前回のフォルダがあればそれを、なければルートフォルダを開く
  if (_folderPath) {
    openFolder(_folderPath.split('/').pop(), _folderPath, _expOpts);
  } else {
    // ツリーの最初のルートフォルダを開く
    const firstRoot = document.querySelector('#outliner-tree > .tree-node');
    if (firstRoot && firstRoot._nodeData) {
      openFolder(firstRoot._nodeData.name, firstRoot._nodeData.path, _expOpts);
    }
  }
}
// 起動時のサイドバー状態を反映
document.getElementById('btn-sidebar-toggle')?.classList.add('active');
// ブラウザ自動補完をクリア
document.getElementById('sidebar-search-input').value = '';

function _removeAppBarDropdowns(selector) {
  const menus = document.querySelectorAll(selector || '.ab-dropdown');
  menus.forEach((menu) => {
    if (typeof menu._cleanupActivityMenu === 'function') menu._cleanupActivityMenu();
    if (typeof menu._cleanupPanelMenu === 'function') menu._cleanupPanelMenu();
    menu.remove();
  });
}

function _isAppBarDropdownTarget(target, rootMenu, button) {
  if (!target) return false;
  if (rootMenu?.contains?.(target)) return true;
  if (button?.contains?.(target)) return true;
  return !!target.closest?.('.ab-dropdown.ab-sub-menu');
}

function _resolveAppBarButton(event) {
  const button = event?.target?.closest?.('button');
  if (button) return button;
  return null;
}

// アクティビティバー: ハンバーガーメニュー
function toggleActivityMenu(e) {
  const closeMenu = () => {
    _removeAppBarDropdowns();
  };
  // 既存メニューがあれば閉じる
  const existing = document.querySelector('.ab-dropdown.ab-activity-menu');
  if (existing) { closeMenu(); return; }
  _removeAppBarDropdowns();

  const menu = document.createElement('div');
  menu.className = 'ab-dropdown ab-activity-menu';
  menu.style.cssText = 'position:fixed;z-index:999;';

  function addItem(label, icon, fn) {
    const item = document.createElement('div');
    item.className = 'ab-dropdown-item';
    item.innerHTML = lucide(icon, 16) + ' ' + label;
    item.addEventListener('click', () => { closeMenu(); fn(); });
