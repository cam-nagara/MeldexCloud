/* gb-outliner-search.js: outliner filter / search helpers */

/* ==============================
   グローバルフィルタ
   ============================== */
// 既知タイプのラベル辞書（表示順序も兼ねる）
const GF_TYPE_LABELS = {
  page: 'ノート', scriptnote: 'シナリオ', board: 'ボード', calendar: 'カレンダー', database: 'シート', 'smart-db': 'スマートシート',
  image: '画像', video: '動画', audio: '音声', html: 'HTML', csv: 'CSV',
  psd: 'Photoshop', clip: 'CLIP STUDIO', '3d': '3Dモデル',
  document: '文書', archive: 'アーカイブ', app: 'アプリ', chat: 'チャット', unknown: 'その他',
};
// 既知タイプの表示順序
const GF_TYPE_ORDER = ['page','scriptnote','board','calendar','database','smart-db','chat','image','video','audio','html','csv','psd','clip','3d','document','archive','app','unknown'];
const GF_HIDDEN_TYPE_ALIASES = {
  scenario: 'scriptnote',
};

function _globalFilterVisibleType(type) {
  const normalized = String(type || '');
  return GF_HIDDEN_TYPE_ALIASES[normalized] || normalized;
}

function _outlinerReadStorageJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed == null ? fallback : parsed;
  } catch {
    return fallback;
  }
}

function _outlinerReadStorageArray(key) {
  const parsed = _outlinerReadStorageJson(key, []);
  return Array.isArray(parsed) ? parsed : [];
}

function _outlinerParseJson(raw, fallback) {
  try {
    const parsed = JSON.parse(raw);
    return parsed == null ? fallback : parsed;
  } catch {
    return fallback;
  }
}

function _normalizeGlobalFilter(raw) {
  const data = raw && typeof raw === 'object' ? raw : {};
  const types = Array.isArray(data.types)
    ? [...new Set(data.types.map(_globalFilterVisibleType).filter(Boolean))]
    : [];
  return {
    enabled: !!data.enabled,
    allTypes: !!data.allTypes,
    types,
    modifiedDays: Number.isFinite(Number(data.modifiedDays)) ? Math.max(0, parseInt(data.modifiedDays, 10) || 0) : 0,
  };
}

let _globalFilter = _normalizeGlobalFilter(_outlinerReadStorageJson('global-filter', { enabled: false, allTypes: false, types: [], modifiedDays: 0 }));
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
  const raw = _outlinerReadStorageJson(OUTLINER_FILTER_SHARED_STATE_KEY, null);
  if (raw && typeof raw === 'object') return _normalizeOutlinerFilterState(raw, _legacyOutlinerFilterState());
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
function _globalFilterHasTypeSelection(filter = _globalFilter) {
  const data = _normalizeGlobalFilter(filter);
  return data.allTypes || data.types.length > 0;
}
function _globalFilterShouldBackgroundScan(filter = _globalFilter) {
  const data = _normalizeGlobalFilter(filter);
  return data.enabled && _globalFilterHasTypeSelection(data);
}
function _showDatabaseByGlobalFilter() { return !_isGlobalFilterEnabled() || _hasAllGlobalTypesSelected() || _globalFilterHasType('database'); }
function _showEntityByGlobalFilter() { return !_isGlobalFilterEnabled() || _hasAllGlobalTypesSelected() || _globalFilter.types.includes('entity') || _globalFilterHasType('database'); }
function _showRegularNodeByGlobalFilter(item) { return !_isGlobalFilterEnabled() || matchesGlobalFilter(item); }

function _outlinerNormalizeComparePath(path) {
  return String(path || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

function _outlinerNodeIsCurrentOrSelected(node, data) {
  const row = node?.querySelector?.(':scope > .tree-node-row');
  if (row?.classList?.contains('active') || row?.classList?.contains('selected')) return true;
  let currentPath = '';
  try { currentPath = typeof _folderPath !== 'undefined' ? _folderPath : ''; } catch {}
  const current = _outlinerNormalizeComparePath(currentPath);
  const target = _outlinerNormalizeComparePath(data?.path);
  return !!current && !!target && current === target;
}

function _outlinerContainerNodeMatchesFilter(data) {
  if (!data) return false;
  if (data._isRoot) return true;
  if (data.type === 'database') return _showDatabaseByGlobalFilter() && matchesGlobalFilter(data);
  if (data.type === 'folder') {
    return _hasAllGlobalTypesSelected()
      || _globalFilterHasType('folder')
      || matchesGlobalFilter(data);
  }
  return false;
}

function _snapshotBaseTreeVisibility() {
  document.querySelectorAll('#outliner-tree .tree-node, #body-home .tree-node, #body-workspaces .tree-node').forEach(node => {
    node.dataset.baseVisible = node.style.display === 'none' ? '0' : '1';
  });
}

// 必要時だけルート直下をall_files=trueでスキャンしてタイプを収集
const OUTLINER_FILE_TYPE_SCAN_SUBFOLDER_LIMIT = 5;
let _fileTypesScanned = false;
let _fileTypesScanPromise = null;

function _outlinerFilterScanYield() {
  if (typeof _outlinerNextFrame === 'function') return _outlinerNextFrame();
  return new Promise(resolve => setTimeout(resolve, 0));
}

function _refreshGlobalFilterFromFileTypeScan() {
  // #gf-chips はポップアップを開いている間だけ存在する動的要素になったため、
  // 初期化済み判定には常時存在する #global-filter-bar を使う（#gf-chips 存在チェックのままだと
  // ポップアップを閉じている間は背景スキャンでの型一覧更新が一切効かなくなってしまう）。
  if (!document.getElementById('global-filter-bar')) return;
  renderGlobalFilterUI();
  if (_isGlobalFilterEnabled()) applyGlobalFilter();
}

async function _scanFileTypesForRoot(root) {
  if (!root?.path) return;
  const rootParam = '&root=' + encodeURIComponent(root.path);
  const items = await apiFetch('/browse?path=' + encodeURIComponent(root.path) + rootParam + '&all_files=true');
  registerFileTypes(items);
  _refreshGlobalFilterFromFileTypeScan();
  const folders = (Array.isArray(items) ? items : [])
    .filter(it => it?.type === 'folder' && it.path)
    .slice(0, OUTLINER_FILE_TYPE_SCAN_SUBFOLDER_LIMIT);
  for (const folder of folders) {
    await _outlinerFilterScanYield();
    try {
      const sub = await apiFetch('/browse?path=' + encodeURIComponent(folder.path) + rootParam + '&all_files=true');
      registerFileTypes(sub);
      _refreshGlobalFilterFromFileTypeScan();
    } catch(e) {}
  }
}

async function scanFileTypesIfNeeded() {
  if (_fileTypesScanned) return;
  if (_fileTypesScanPromise) return _fileTypesScanPromise;
  _fileTypesScanPromise = (async () => {
    try {
      const roots = await apiFetch('/outliner-roots');
      const visible = Array.isArray(roots) ? roots.filter(r => r?.visible && r.path) : [];
      for (const root of visible) {
        try {
          await _scanFileTypesForRoot(root);
        } catch(e) {}
        await _outlinerFilterScanYield();
      }
      _fileTypesScanned = true;
    } catch(e) {
      _fileTypesScanned = false;
    }
  })();
  try {
    return await _fileTypesScanPromise;
  } finally {
    _fileTypesScanPromise = null;
  }
}

function _refreshGlobalFilterAfterBackgroundScan(apply = false) {
  renderGlobalFilterUI();
  if (apply) applyGlobalFilter();
  scanFileTypesIfNeeded().then(() => {
    renderGlobalFilterUI();
    if (apply) applyGlobalFilter();
  }).catch(() => {});
}

function toggleGlobalFilter() {
  // フィルタバーは常時表示。この関数は互換性のため残す。
  // フィルタUIを更新する
  _refreshGlobalFilterAfterBackgroundScan(false);
}

// フィルタバー初期化（UI描画を優先し、必要な時だけ後続スキャン）
function toggleGlobalFilterBar() {
  const bar = document.getElementById('global-filter-bar');
  const btn = document.getElementById('btn-filter-toggle');
  if (!bar) return;
  const hidden = bar.style.display === 'none';
  bar.style.display = hidden ? '' : 'none';
  if (btn) btn.style.color = hidden ? 'var(--accent)' : 'var(--fg2)';
  localStorage.setItem('gb:filter-bar-visible', hidden ? '1' : '0');
  saveCurrentLayoutFilterState();
  if (hidden) setTimeout(() => _refreshGlobalFilterAfterBackgroundScan(false), 0);
  // 検索バーのフィルタボタン1クリックでフィルタ設定へ到達できるよう、バーを
  // 表示した直後にポップアップも開く（バー内トリガーの再クリックを不要にする）。
  // 非表示化した時は開いているポップアップも閉じる。
  if (hidden) {
    setTimeout(() => {
      if (typeof openGlobalFilterPopup === 'function' && !_gfFilterPopupEl) openGlobalFilterPopup();
    }, 0);
  } else if (typeof closeGlobalFilterPopup === 'function') {
    closeGlobalFilterPopup();
  }
}

function initGlobalFilterBar() {
  const state = _loadCurrentLayoutFilterState() || _legacyOutlinerFilterState();
  _setOutlinerFilterStateValues(state);
  const shouldScan = _globalFilterShouldBackgroundScan(state.globalFilter);
  renderGlobalFilterUI();
  applyGlobalFilter();
  if (!shouldScan) {
    return;
  }
  setTimeout(() => _refreshGlobalFilterAfterBackgroundScan(true), 0);
}

// ファイルタイプキャッシュ（browseで読み込まれた全タイプを蓄積）
const _knownFileTypes = new Set();
function registerFileTypes(items) {
  if (!items) return;
  items.forEach(it => {
    const type = _globalFilterVisibleType(it?.type);
    if (type && type !== 'folder' && type !== 'entity') _knownFileTypes.add(type);
  });
}

function _createGlobalFilterButton(label, className, onClick, options = {}) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.textContent = label;
  if (options.e2eId) button.dataset.e2eId = options.e2eId;
  if (options.type) button.dataset.gfType = options.type;
  if (options.pressed !== undefined) button.setAttribute('aria-pressed', options.pressed ? 'true' : 'false');
  button.addEventListener('click', onClick);
  return button;
}

// キャッシュ + DOM + フォルダビューから「現在存在が判明しているタイプ」を毎回“最新値”として
// 計算するヘルパー。renderGlobalFilterUI() の描画時だけでなく、チップのクリックハンドラ内でも
// このヘルパーを呼び直すこと（重要: クロージャで昔の一覧を持ち回さない）。
//
// 背景（フィルタ表示異常 症状a の根本原因）: 旧実装はrenderGlobalFilterUI()呼び出し時点の
// sortedTypes配列をチップのクリックハンドラのクロージャに閉じ込めていた。「すべて選択」中に
// 特定タイプを1つだけOFFにする操作は `_globalFilter.types = sortedTypes.filter(t => t !== typeVal)`
// という「そのクロージャ内の一覧から対象タイプだけ除いた配列」を書き込む処理のため、
// 直近のrenderGlobalFilterUI()呼び出し後にフォルダ展開等で新しいタイプ（例: 動画）が
// 判明していても、そのタイプはこの配列に含まれずtypesから丸ごと落ちてしまう。結果として
// allTypesがfalseになった瞬間、falseにされたタイプは「フィルタ対象外」として全非表示になり、
// 画像だけをOFFにしたつもりが動画も含めて全ファイルが消える（さらに_hideEmptyFilteredFoldersが
// 空になったフォルダ自体を畳んでしまい、見た目上は「次のフォルダが繰り上がって展開されたよう」に
// 見える）。対策として、クリック時点で必ずこの関数を呼び直し、常に最新のタイプ一覧を使う。
function _globalFilterPresentTypes() {
  const presentTypes = new Set(_knownFileTypes);
  _globalFilter.types.forEach(type => {
    const visibleType = _globalFilterVisibleType(type);
    if (visibleType && visibleType !== 'folder' && visibleType !== 'entity') presentTypes.add(visibleType);
  });
  document.querySelectorAll('#outliner-tree .tree-node, #body-home .tree-node, #body-workspaces .tree-node').forEach(node => {
    const d = node._nodeData;
    const type = _globalFilterVisibleType(d?.type);
    if (d && type && type !== 'folder' && type !== 'entity' && !d._isRoot) presentTypes.add(type);
  });
  if (_folderItems) _folderItems.forEach(it => {
    const type = _globalFilterVisibleType(it?.type);
    if (type && type !== 'folder') presentTypes.add(type);
  });
  return [...presentTypes].sort((a, b) => {
    const ia = GF_TYPE_ORDER.indexOf(a), ib = GF_TYPE_ORDER.indexOf(b);
    if (ia >= 0 && ib >= 0) return ia - ib;
    if (ia >= 0) return -1;
    if (ib >= 0) return 1;
    return a.localeCompare(b);
  });
}

function _globalFilterIsRestricting() {
  return _isGlobalFilterEnabled() && (!_hasAllGlobalTypesSelected() || _globalFilter.modifiedDays > 0);
}

function _gfFilterPopupTriggerEl() {
  return document.getElementById('gf-filter-popup-trigger');
}

// トリガーボタンを#global-filter-bar内に用意する（既存なら再利用。多重生成しない）。
function _ensureGlobalFilterTrigger() {
  const bar = document.getElementById('global-filter-bar');
  if (!bar) return null;
  let row = bar.querySelector(':scope > .gf-trigger-row');
  if (!row) {
    row = document.createElement('div');
    row.className = 'gf-trigger-row';
    bar.insertBefore(row, bar.firstChild);
  }
  let trigger = _gfFilterPopupTriggerEl();
  if (!trigger) {
    trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.id = 'gf-filter-popup-trigger';
    trigger.className = 'gf-filter-trigger';
    trigger.dataset.e2eId = 'global-filter-popup-trigger';
    trigger.setAttribute('aria-haspopup', 'true');
    trigger.setAttribute('aria-expanded', 'false');
    const icon = document.createElement('span');
    icon.className = 'gf-filter-trigger-icon';
    icon.innerHTML = typeof lucide === 'function' ? lucide('funnel', 14) : '';
    const label = document.createElement('span');
    label.className = 'gf-filter-trigger-label';
    label.textContent = 'フィルタ';
    trigger.appendChild(icon);
    trigger.appendChild(label);
    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleGlobalFilterPopup();
    });
    row.appendChild(trigger);
  } else if (trigger.parentElement !== row) {
    row.appendChild(trigger);
  }
  return trigger;
}

function _updateGlobalFilterTriggerState() {
  const trigger = _gfFilterPopupTriggerEl();
  if (!trigger) return;
  const restricting = _globalFilterIsRestricting();
  trigger.classList.toggle('is-active', restricting);
  trigger.setAttribute('aria-pressed', restricting ? 'true' : 'false');
  trigger.title = restricting ? 'フィルタ（絞り込み中）' : 'フィルタ';
}

// ポップアップ本体（document.body直下・position:fixedで生成する。共通ルールにより
// #global-filter-bar内に据え置きにはしない）。
let _gfFilterPopupEl = null;

function _repositionGlobalFilterPopup() {
  const trigger = _gfFilterPopupTriggerEl();
  if (!_gfFilterPopupEl || !trigger) return;
  if (typeof positionPopup === 'function') positionPopup(_gfFilterPopupEl, trigger.getBoundingClientRect());
  else if (typeof clampPopupToViewport === 'function') clampPopupToViewport(_gfFilterPopupEl);
}

function _wireGlobalFilterPopupCloseButton(popup) {
  if (popup.querySelector('[data-meldex-dropdown-close]')) return;
  if (typeof attachMeldexDropdownCloseButton === 'function') {
    attachMeldexDropdownCloseButton(popup, {
      label: '閉じる',
      trigger: _gfFilterPopupTriggerEl(),
      close: closeGlobalFilterPopup,
    });
  }
}

function _renderGlobalFilterPopupBody(popup) {
  popup.innerHTML = '';

  // フィルタ有効トグル
  const toggleRow = document.createElement('div');
  toggleRow.className = 'gf-popup-row';
  const filterToggle = _createGlobalFilterButton(
    _isGlobalFilterEnabled() ? 'フィルタOFF' : 'フィルタON',
    'gf-chip gf-filter-toggle' + (_isGlobalFilterEnabled() ? ' is-active' : ''),
    () => {
      _globalFilter.enabled = !_isGlobalFilterEnabled();
      saveGlobalFilter();
      renderGlobalFilterUI();
    },
    { e2eId: 'global-filter-enabled-toggle', pressed: _isGlobalFilterEnabled() }
  );
  toggleRow.appendChild(filterToggle);
  popup.appendChild(toggleRow);

  // タイプ別チェック一覧
  const typesSection = document.createElement('div');
  typesSection.className = 'gf-popup-section';
  const typesLabel = document.createElement('div');
  typesLabel.className = 'gf-popup-section-label';
  typesLabel.textContent = '対象タイプ';
  typesSection.appendChild(typesLabel);
  const chipList = document.createElement('div');
  chipList.id = 'gf-chips';
  chipList.className = 'gf-popup-chip-list';
  const sortedTypes = _globalFilterPresentTypes();
  sortedTypes.forEach(typeVal => {
    const active = _hasAllGlobalTypesSelected() || _globalFilter.types.includes(typeVal);
    const label = GF_TYPE_LABELS[typeVal] || typeVal;
    const classes = ['gf-chip', 'gf-type-chip'];
    if (active) classes.push('is-active');
    if (!_isGlobalFilterEnabled()) classes.push('is-muted');
    const chip = _createGlobalFilterButton(label, classes.join(' '), () => {
      // クリック時点の最新タイプ一覧から算出する（このファイル冒頭のコメント参照。
      // 描画時点の古い一覧を閉包で持ち回さない）。
      const liveTypes = _globalFilterPresentTypes();
      if (_hasAllGlobalTypesSelected()) {
        _globalFilter.allTypes = false;
        _globalFilter.types = liveTypes.filter(t => t !== typeVal);
      } else if (active) {
        _globalFilter.types = _globalFilter.types.filter(t => t !== typeVal);
      } else {
        _globalFilter.types.push(typeVal);
      }
      _globalFilter.enabled = true;
      saveGlobalFilter();
      renderGlobalFilterUI();
    }, {
      e2eId: 'global-filter-type-' + typeVal,
      type: typeVal,
      pressed: active,
    });
    chipList.appendChild(chip);
  });
  if (!sortedTypes.length) {
    const empty = document.createElement('div');
    empty.className = 'gf-popup-empty';
    empty.textContent = '対象タイプがまだありません（フォルダを開くと判明します）';
    chipList.appendChild(empty);
  }
  typesSection.appendChild(chipList);
  popup.appendChild(typesSection);

  // 更新日時
  const dateRow = document.createElement('div');
  dateRow.className = 'gf-popup-row';
  const dateSelect = document.createElement('select');
  dateSelect.id = 'gf-modified-days';
  dateSelect.dataset.e2eId = 'global-filter-modified-days';
  dateSelect.setAttribute('aria-label', '更新日時フィルタ');
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
  dateRow.appendChild(dateSelect);
  popup.appendChild(dateRow);

  // すべて選択 / すべてオフ
  const cmdRow = document.createElement('div');
  cmdRow.className = 'gf-popup-row gf-popup-command-row';
  if (!_hasAllGlobalTypesSelected()) {
    const allOn = _createGlobalFilterButton('すべて選択', 'gf-chip gf-command gf-all-on', () => {
      const liveTypes = _globalFilterPresentTypes();
      _globalFilter.allTypes = true;
      _globalFilter.types = [...liveTypes];
      _globalFilter.enabled = true;
      saveGlobalFilter();
      renderGlobalFilterUI();
    }, { e2eId: 'global-filter-all-on' });
    cmdRow.appendChild(allOn);
  }
  const allOff = _createGlobalFilterButton('すべてオフ', 'gf-chip gf-command gf-all-off', () => {
    _globalFilter.allTypes = false;
    _globalFilter.types = [];
    _globalFilter.enabled = true;
    saveGlobalFilter();
    renderGlobalFilterUI();
  }, { e2eId: 'global-filter-all-off' });
  cmdRow.appendChild(allOff);
  popup.appendChild(cmdRow);
}

function _gfPopupOutsideClickHandler(e) {
  const trigger = _gfFilterPopupTriggerEl();
  if (!_gfFilterPopupEl) return;
  if (_gfFilterPopupEl.contains(e.target)) return;
  if (trigger && (e.target === trigger || trigger.contains(e.target))) return;
  closeGlobalFilterPopup();
}

function _gfPopupKeydownHandler(e) {
  if (e.key !== 'Escape' || !_gfFilterPopupEl) return;
  e.stopPropagation();
  closeGlobalFilterPopup();
  if (typeof focusMeldexDropdownTrigger === 'function') focusMeldexDropdownTrigger(_gfFilterPopupTriggerEl());
}

function closeGlobalFilterPopup() {
  if (!_gfFilterPopupEl) return;
  _gfFilterPopupEl.remove();
  _gfFilterPopupEl = null;
  document.removeEventListener('pointerdown', _gfPopupOutsideClickHandler, true);
  document.removeEventListener('keydown', _gfPopupKeydownHandler, true);
  const trigger = _gfFilterPopupTriggerEl();
  if (trigger) trigger.setAttribute('aria-expanded', 'false');
}

function openGlobalFilterPopup() {
  const trigger = _ensureGlobalFilterTrigger();
  if (!trigger) return;
  closeGlobalFilterPopup();
  const popup = document.createElement('div');
  popup.className = 'gf-filter-popup';
  popup.setAttribute('role', 'dialog');
  popup.setAttribute('aria-label', 'フィルタ');
  popup.style.cssText = 'position:fixed;z-index:10000;';
  _gfFilterPopupEl = popup;
  _renderGlobalFilterPopupBody(popup);
  _wireGlobalFilterPopupCloseButton(popup);
  document.body.appendChild(popup);
  _repositionGlobalFilterPopup();
  trigger.setAttribute('aria-expanded', 'true');
  setTimeout(() => {
    document.addEventListener('pointerdown', _gfPopupOutsideClickHandler, true);
    document.addEventListener('keydown', _gfPopupKeydownHandler, true);
  }, 0);
}

function toggleGlobalFilterPopup() {
  if (_gfFilterPopupEl) closeGlobalFilterPopup();
  else openGlobalFilterPopup();
}

// フィルタUI全体の再描画エントリポイント。トリガーの状態更新に加え、ポップアップが
// 開いている場合はその中身も最新状態へ更新する（クリック後・タイプ新規判明後などに
// 呼ばれる。既存呼び出し元は変更不要）。
function renderGlobalFilterUI() {
  _ensureGlobalFilterTrigger();
  _updateGlobalFilterTriggerState();
  if (_gfFilterPopupEl) {
    _renderGlobalFilterPopupBody(_gfFilterPopupEl);
    _wireGlobalFilterPopupCloseButton(_gfFilterPopupEl);
    _repositionGlobalFilterPopup();
  }
}

function saveGlobalFilter() {
  localStorage.setItem('global-filter', JSON.stringify(_globalFilter));
  // フォルダツリーとフォルダビューに適用
  applyGlobalFilter();
  saveCurrentLayoutFilterState();
}

// 起動時のフィルタ初期化は initApp 内の outlinerPromise 完了後に実行される

function applyGlobalFilter() {
  const allNodes = document.querySelectorAll('#outliner-tree .tree-node, #body-home .tree-node, #body-workspaces .tree-node');

  if (!_isGlobalFilterEnabled()) {
    allNodes.forEach(node => {
      if (node._nodeData) node.style.display = '';
    });
    _snapshotBaseTreeVisibility();
    window.GBOutlinerVirtualRender?.refreshAllFilters();
    if (_treeSearchQuery) applyTreeNameSearch();
    return;
  }

  if (!_hasAllGlobalTypesSelected() && _globalFilter.types.length === 0) {
    allNodes.forEach(node => { node.style.display = 'none'; });
    _snapshotBaseTreeVisibility();
    window.GBOutlinerVirtualRender?.refreshAllFilters();
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
  // 仮想化コンテナのDOM上マウント行数は表示範囲＋オーバースキャン分のみであり、
  // フィルタ変更直後は旧フィルタ時点の行がまだ乗っている。_hideEmptyFilteredFoldersの
  // 前に仮想モデルを新フィルタへ再構築しておく（順序を入れ替えても
  // _hideEmptyFilteredFoldersの仮想化分岐は状態モデルを直接参照するため実害は無いが、
  // 非仮想フォルダ側の判定材料となるDOMも最終状態に揃えておくため先に実行する）。
  window.GBOutlinerVirtualRender?.refreshAllFilters();
  _hideEmptyFilteredFolders();
  _snapshotBaseTreeVisibility();
  if (_treeSearchQuery) applyTreeNameSearch();
}

// 仮想化コンテナ（gb-outliner-virtual-render.js）配下のフォルダは、DOM上に実マウントされて
// いる行が表示範囲＋オーバースキャン分だけであり、子孫がフラットに祖先コンテナへ直接
// マウントされる（ネストしたフォルダ自身の.tree-childrenは常に空のプレースホルダ）。
// そのためDOM子要素数だけを見ると「実際は絞り込み後も表示対象の子孫を持つのに、
// たまたま今画面外/未マウントなだけ」のフォルダを誤って空フォルダと判定し、
// フォルダごと非表示にしてしまう（フィルタ表示異常 症状b「フォルダ自体が非表示になる」の
// 根本原因）。仮想化管理下のノードは、DOM件数ではなく仮想モデルの全項目
// （state.allItems / state.childrenByParent、マウント状態に関係なく保持される）を
// 現在のフィルタ条件で再帰的に判定する。
function _folderHasFilterVisibleDescendant(childrenDiv, path) {
  const accessor = window.GBOutlinerVirtualRender?.stateChildItemsFor;
  if (typeof accessor !== 'function') return null;
  const seen = new Set();
  function walk(p) {
    const items = accessor(childrenDiv, p);
    if (items === undefined) return null; // 仮想化管理下ではない（呼び出し側の判定ミス）
    if (items === null) return 'unknown'; // 未読込（展開されたことがない）
    let unknown = false;
    for (const it of items) {
      if (!it || !it.path || seen.has(it.path)) continue;
      seen.add(it.path);
      if (it.type === 'folder') {
        const r = walk(it.path);
        if (r === true) return true;
        if (r === 'unknown') unknown = true;
        continue;
      }
      if (it.type === 'database') {
        if (_showDatabaseByGlobalFilter() && matchesGlobalFilter(it)) return true;
        continue;
      }
      if (it.type === 'entity') {
        if (_showEntityByGlobalFilter()) return true;
        continue;
      }
      if (_showRegularNodeByGlobalFilter(it)) return true;
    }
    return unknown ? 'unknown' : false;
  }
  const result = walk(path);
  return result === 'unknown' ? null : result;
}

function _hideEmptyFilteredFolders() {
  if (!_isGlobalFilterEnabled() || (!_hasAllGlobalTypesSelected() && _globalFilter.types.length === 0)) return;
  const allNodes = [...document.querySelectorAll('#outliner-tree .tree-node, #body-home .tree-node, #body-workspaces .tree-node')].reverse();
  allNodes.forEach(node => {
    const data = node._nodeData;
    if (!data) return;
    if (data.type !== 'folder' && data.type !== 'database' && !data._isRoot) return;
    const childrenDiv = node.querySelector(':scope > .tree-children');
    if (!childrenDiv) return;
    const virtualManaged = childrenDiv.dataset.virtual === 'true' || !!childrenDiv._virtualOwnerContainer;
    let hasVisibleChild;
    if (virtualManaged) {
      const verdict = _folderHasFilterVisibleDescendant(childrenDiv, data.path);
      if (verdict == null) return; // 判定不能（未読込含む）は従来どおり表示のまま
      hasVisibleChild = verdict;
    } else {
      if (childrenDiv.dataset.loaded === 'false') return;
      hasVisibleChild = [...childrenDiv.querySelectorAll(':scope > .tree-node')].some(c => c.style.display !== 'none');
    }
    if (!hasVisibleChild && (_outlinerNodeIsCurrentOrSelected(node, data) || _outlinerContainerNodeMatchesFilter(data))) {
      node.style.display = '';
      return;
    }
    node.style.display = hasVisibleChild ? '' : 'none';
  });
}

function _globalFilterTypeKeys(type) {
  const normalized = String(type || '');
  if (normalized === 'scriptnote') return ['scriptnote', 'scenario'];
  if (normalized === 'scenario') return ['scenario', 'scriptnote'];
  if (normalized === 'smart-db') return ['smart-db'];
  return [normalized];
}

function _globalFilterHasType(type) {
  return _globalFilterTypeKeys(type).some((key) => _globalFilter.types.includes(key));
}

function matchesGlobalFilter(item) {
  if (!_isGlobalFilterEnabled()) return true;
  if (!_hasAllGlobalTypesSelected() && !_globalFilterHasType(item.type)) return false;
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
  if (name === 'home' && !collapsed && typeof renderHomeFolderTree === 'function') {
    Promise.resolve().then(() => renderHomeFolderTree({ force: true, reason: 'section-open' })).catch(() => {});
  }
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
  for (const name of ['recent', 'favorites', 'workspaces', 'home', 'smart-db', 'roots']) {
    const state = localStorage.getItem('sidebar-section-' + name);
    const body = document.getElementById('body-' + name);
    const toggle = document.getElementById('toggle-' + name);
    if (!body) continue;
    const hasStoredFavorites = name === 'favorites' && typeof getFavorites === 'function' && getFavorites().length > 0;
    if (state === 'expanded' || (state === null && (name === 'workspaces' || name === 'roots' || hasStoredFavorites))) {
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
function _outlinerStoredItemName(item) {
  const path = String(item?.path || '');
  return item?.label || item?.name || path.split(/[\\/]/).filter(Boolean).pop() || '?';
}

function _outlinerMediaTypeFromPath(path, type) {
  if (type === 'image' || type === 'video' || type === 'audio') return type;
  const ext = String(path || '').split(/[?#]/)[0].split('.').pop().toLowerCase();
  if (['jpg','jpeg','png','gif','webp','svg','bmp','avif','ico'].includes(ext)) return 'image';
  if (['mp4','mov','avi','webm','mkv','m4v'].includes(ext)) return 'video';
  if (['mp3','wav','ogg','flac','m4a'].includes(ext)) return 'audio';
  if (ext === 'pdf') return 'pdf';
  return type || '';
}

function _outlinerStoredItemType(item) {
  const type = String(item?.type || '');
  const lower = String(item?.path || '').toLowerCase();
  if (type === 'smart-db' || lower.endsWith('.mel-sheet') || lower.endsWith('.smart-db.json')) return 'smart-db';
  if (type === 'scriptnote' || type === 'scenario' || lower.endsWith('.mel-scenario') || lower.endsWith('.scriptnote.json') || lower.endsWith('.scenario.json')) return 'scriptnote';
  if (type === 'timer' || lower.endsWith('.mel-timer') || lower.endsWith('.timer.json')) return 'timer';
  if (type === 'board' || lower.endsWith('.mel-board') || lower.endsWith('.board.md')) return 'board';
  if (type === 'csv' || lower.endsWith('.csv')) return 'csv';
  if (type === 'html' || lower.endsWith('.html') || lower.endsWith('.htm')) return 'html';
  if (type === 'media') return _outlinerMediaTypeFromPath(lower, type);
  if (type) return type;
  return 'page';
}

function _outlinerPersistRepairedRecentType(path, type) {
  if (!path || !type) return;
  const recent = _outlinerReadStorageArray('meldex-recent');
  let changed = false;
  recent.forEach(entry => {
    if (!entry || typeof entry !== 'object' || entry.path !== path || entry.type === type) return;
    entry.type = type;
    changed = true;
  });
  if (changed) {
    try {
      localStorage.setItem('meldex-recent', JSON.stringify(recent));
    } catch {
      // 保存不可でも今回の実体判定は有効なので、開く処理は継続する。
    }
  }
}

async function _outlinerResolveStoredItemType(item) {
  const storedType = _outlinerStoredItemType(item);
  const path = String(item?.path || '');
  if (!path || !['folder', 'database', 'calendar'].includes(storedType) || typeof apiFetch !== 'function') {
    return storedType;
  }
  try {
    const resolved = await apiFetch('/check-type?path=' + encodeURIComponent(path), { silentError: true });
    const actualType = String(resolved?.type || '');
    if (!['folder', 'database', 'calendar'].includes(actualType)) return storedType;
    if (actualType !== storedType) {
      item.type = actualType;
      _outlinerPersistRepairedRecentType(path, actualType);
    }
    return actualType;
  } catch {
    return storedType;
  }
}

async function _openStoredOutlinerItem(item, opts) {
  const path = String(item?.path || '');
  const name = _outlinerStoredItemName(item);
  const type = await _outlinerResolveStoredItemType(item);
  const openOpts = opts || { fromExplorer: true };
  if (!path && type !== 'smart-db') return;
  if (type === 'folder') openFolder(name, path, openOpts);
  else if (type === 'database') selectDatabase(path, null, openOpts);
  else if (type === 'entity') { if (typeof selectEntity === 'function') selectEntity(path, openOpts); }
  else if (type === 'page') openPage(name, path, openOpts);
  else if (type === 'scriptnote') { if (typeof openScenarioInScriptNote === 'function') openScenarioInScriptNote(path, name, openOpts); else openPage(name, path, openOpts); }
  else if (type === 'board') openBoard(name, path, openOpts);
  else if (type === 'calendar') openCalendarFile(name, path, openOpts);
  else if (type === 'chat') { if (typeof openSavedChat === 'function') openSavedChat(path); else openPage(name, path, openOpts); }
  else if (type === 'smart-db') {
    if (path.startsWith('smart-db:') && typeof selectSmartDb === 'function') selectSmartDb(path.replace('smart-db:', ''), null, openOpts);
    else if (typeof openSmartDbFile === 'function') openSmartDbFile(name, path, openOpts);
  }
  else if (type === 'image' || type === 'video' || type === 'audio') openMedia(name, path, type, openOpts);
  else if (type === 'pdf' || (type === 'document' && path.toLowerCase().endsWith('.pdf'))) {
    if (typeof openViewer === 'function') openViewer('/viewer?pdf=' + encodeURIComponent(path), openOpts);
    else if (typeof openNative === 'function') openNative(path);
  }
  else if (type === 'html') openHtmlFile(name, path, openOpts);
  else if (type === 'csv') { if (typeof openCsvFile === 'function') openCsvFile(name, path, openOpts); else openPage(name, path, openOpts); }
  else if (typeof openNative === 'function') openNative(path);
}

// 最近使った項目・お気に入りショートカットの単クリック選択（単一選択。開かない）。
// フォルダツリー本体の treeSelection とは別の軽量な選択状態として扱う（§2.4）。
function _selectSidebarShortcutItem(item) {
  if (!item) return;
  document.querySelectorAll('#body-recent .fav-item.selected, #body-favorites .fav-item.selected')
    .forEach(el => { if (el !== item) el.classList.remove('selected'); });
  item.classList.add('selected');
}

function updateRecentItems() {
  const container = document.getElementById('body-recent');
  if (!container) return;
  // #body-recent は #tree-scroll-container 内にあるため、innerHTML を空にすると
  // ブラウザのスクロールアンカリングがアンカーを失ってツリーが先頭に飛ぶ。
  // ツリークリックハンドラのガードが稼働中はそちらに任せ、ここでの復元をスキップする。
  const treeScroll = document.getElementById('tree-scroll-container');
  const lockActive = _treeClickScrollLock;
  if (lockActive) {
    if (container.dataset.recentRefreshDeferred !== '1') {
      container.dataset.recentRefreshDeferred = '1';
      setTimeout(() => {
        container.dataset.recentRefreshDeferred = '';
        updateRecentItems();
      }, 1600);
    }
    if (typeof _treeScrollGuardRestore === 'function') {
      _treeScrollGuardRestore();
      requestAnimationFrame(_treeScrollGuardRestore);
    }
    return;
  }
  const savedScrollTop = (!lockActive && treeScroll) ? treeScroll.scrollTop : 0;
  const recent = _outlinerReadStorageArray('meldex-recent').filter(item => item && typeof item === 'object').slice(0, 5);
  container.innerHTML = '';
  const _restoreAfter = () => {
    if (lockActive || !treeScroll) return; // ガード稼働中はスキップ
    if (treeScroll.scrollTop !== savedScrollTop) treeScroll.scrollTop = savedScrollTop;
  };
  if (recent.length === 0) {
    // 空のときは何も表示しない（ソースフォルダ・ホームフォルダ・お気に入り
    // ＝renderFavorites() と同じ扱い。「なし」プレースホルダは出さない）。
    _restoreAfter();
    requestAnimationFrame(_restoreAfter);
    return;
  }
  recent.forEach(r => {
    const item = document.createElement('div');
    item.className = 'fav-item';
    const name = r.label || r.name || r.path?.split('/').pop() || '?';
    const iconName = _outlinerIconName(r.type, r.path, false);
    item.innerHTML = lucide(iconName, 18) + ' <span style="overflow:hidden;text-overflow:ellipsis;">' + esc(name) + '</span>';
    item.title = r.path || '';
    // 単クリック=選択のみ、ダブルクリック=開く（§2.4・フォルダツリー行と同じ操作語彙に統一）
    item.addEventListener('click', (e) => {
      if (e.target.closest('.fav-more-btn')) return;
      _selectSidebarShortcutItem(item);
      if (window.GBOutlinerActivation?.singleClickOpensItems?.()) {
        window.GBOutlinerActivation.activateStoredItem(r, { fromExplorer: true });
      }
    });
    item.addEventListener('dblclick', (e) => {
      if (e.target.closest('.fav-more-btn')) return;
      if (window.GBOutlinerActivation?.singleClickOpensItems?.()) return; // 単クリックで既に開いている
      window.GBOutlinerActivation?.activateStoredItem(r, { fromExplorer: true });
    });
    item.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      _showRecentItemMenu(e, r);
    });
    if (typeof addLongPressHandler === 'function') {
      addLongPressHandler(item, (e) => _showRecentItemMenu(e, r));
    }
    const moreBtn = document.createElement('button');
    moreBtn.type = 'button';
    moreBtn.className = 'fav-more-btn';
    moreBtn.title = 'メニュー';
    moreBtn.setAttribute('aria-label', '最近使った項目のメニューを開く');
    const recentE2eKey = encodeURIComponent(String(r.path || r.label || r.name || 'item')).replace(/%/g, '_');
    moreBtn.setAttribute('data-e2e-id', `recent-item-menu-${recentE2eKey}`);
    moreBtn.draggable = false;
    moreBtn.innerHTML = typeof lucide === 'function' ? lucide('ellipsis', 14) : '...';
    moreBtn.addEventListener('click', (e) => { e.stopPropagation(); _showRecentItemMenu(e, r); });
    moreBtn.addEventListener('dragstart', (e) => e.preventDefault());
    item.appendChild(moreBtn);
    container.appendChild(item);
  });
  _restoreAfter();
  requestAnimationFrame(_restoreAfter);
}

// お気に入り
// お気に入り（ツリー構造）
// データ形式: [{name, path, type, children:[...]}] — type:'fav-folder'はお気に入りフォルダ
function getFavorites() { return _outlinerReadStorageArray('meldex-favorites').filter(item => item && typeof item === 'object'); }
function saveFavorites(favs) { localStorage.setItem('meldex-favorites', JSON.stringify(Array.isArray(favs) ? favs : [])); }

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

function _showRecentItemMenu(event, entry) {
  if (!entry) return;
  event?.preventDefault?.();
  event?.stopPropagation?.();
  document.querySelectorAll('.gb-context-menu').forEach(m => m.remove());
  const menu = document.createElement('div');
  menu.className = 'gb-context-menu';
  const closeMenu = () => menu.remove();
  const addItem = (label, fn, icon, danger) => {
    const it = document.createElement('div');
    it.className = 'gb-context-menu-item';
    if (danger) it.classList.add('danger');
    if (icon && typeof lucide === 'function') {
      it.innerHTML = '<span style="margin-right:6px;opacity:0.7;">' + lucide(icon, 14) + '</span>' + esc(label);
    } else {
      it.textContent = label;
    }
    it.addEventListener('click', async () => { closeMenu(); await fn(); });
    menu.appendChild(it);
  };
  const name = entry.label || entry.name || entry.path?.split('/').pop() || '?';
  const path = entry.path || '';
  addItem('開く', () => _openStoredOutlinerItem(entry, { fromExplorer: true }), 'folderOpen');
  if (typeof _openInNewTab === 'function') {
    addItem('新しいタブで開く', async () => {
      const resolvedType = await _outlinerResolveStoredItemType(entry);
      const openType = typeof _normalizeOpenTypeForNav === 'function'
        ? _normalizeOpenTypeForNav(resolvedType) : (resolvedType || 'page');
      _openInNewTab(name, path, openType);
    }, 'externalLink');
  }
  if (typeof addToFavorites === 'function') {
    addItem('お気に入りに追加', () => addToFavorites(name, path, entry.type), 'star');
  }
  if (path) {
    addItem('パスをコピー', () => {
      if (navigator.clipboard) navigator.clipboard.writeText(path);
      if (typeof showStatus === 'function') showStatus('パスをコピーしました');
    }, 'copy');
  }
  if (path && typeof openNative === 'function') {
    const folderPath = path.replace(/[/\\][^/\\]+$/, '');
    addItem('エクスプローラーで表示', () => openNative(folderPath), 'folderOpen');
  }
  const sep = document.createElement('div');
  sep.style.cssText = 'height:1px;background:var(--border);margin:4px 0;';
  menu.appendChild(sep);
  addItem('最近使った項目から削除', () => {
    const arr = _outlinerReadStorageArray('meldex-recent').filter(
      item => item && typeof item === 'object' && item.path !== path
    );
    localStorage.setItem('meldex-recent', JSON.stringify(arr));
    updateRecentItems();
  }, 'x', true);

  document.body.appendChild(menu);
  const z = parseFloat(document.documentElement.style.zoom) || 1;
  const x = Number.isFinite(event?.clientX) ? event.clientX / z : 24;
  const y = Number.isFinite(event?.clientY) ? event.clientY / z : 64;
  menu.style.left = x + 'px';
  menu.style.top = y + 'px';
  if (typeof clampPopupToViewport === 'function') clampPopupToViewport(menu);
  setTimeout(() => {
    document.addEventListener('pointerdown', function closer(e) {
      if (!menu.contains(e.target)) {
        closeMenu();
        document.removeEventListener('pointerdown', closer);
      }
    });
  }, 0);
}

function _showFavoriteItemMenu(event, node, isFavFolder) {
  if (!node) return;
  event?.preventDefault?.();
  event?.stopPropagation?.();
  document.querySelectorAll('.gb-context-menu').forEach(menu => menu.remove());
  const menu = document.createElement('div');
  menu.className = 'gb-context-menu';
  const closeMenu = () => menu.remove();
  const addItem = (label, fn, icon, danger) => {
    const item = document.createElement('div');
    item.className = 'gb-context-menu-item';
    if (danger) item.classList.add('danger');
    if (icon && typeof lucide === 'function') {
      item.innerHTML = '<span style="margin-right:6px;opacity:0.7;">' + lucide(icon, 14) + '</span>' + esc(label);
    } else {
      item.textContent = label;
    }
    item.addEventListener('click', async () => {
      closeMenu();
      await fn();
    });
    menu.appendChild(item);
  };
  if (!isFavFolder) {
    addItem('開く', () => _openStoredOutlinerItem(node, { fromExplorer: true }), 'folderOpen');
    addItem('お気に入りを外す', () => removeFromFavorites(node.path), 'starOff');
  } else {
    addItem('フォルダを削除', async () => {
      const ok = typeof cfConfirm === 'function'
        ? await cfConfirm('「' + node.name + '」フォルダを削除しますか？（中身は失われます）')
        : confirm('「' + node.name + '」フォルダを削除しますか？（中身は失われます）');
      if (ok) removeFavFolder(node.path);
    }, 'trash2', true);
  }
  document.body.appendChild(menu);
  const z = parseFloat(document.documentElement.style.zoom) || 1;
  const x = Number.isFinite(event?.clientX) ? event.clientX / z : 24;
  const y = Number.isFinite(event?.clientY) ? event.clientY / z : 64;
  menu.style.left = x + 'px';
  menu.style.top = y + 'px';
  if (typeof clampPopupToViewport === 'function') clampPopupToViewport(menu);
  setTimeout(() => {
    document.addEventListener('pointerdown', function closer(e) {
      if (!menu.contains(e.target)) {
        closeMenu();
        document.removeEventListener('pointerdown', closer);
      }
    });
  }, 0);
}

function _createFavoriteMoreButton(node, isFavFolder) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'fav-more-btn';
  button.title = 'メニュー';
  button.setAttribute('aria-label', 'お気に入りメニューを開く');
  const favoriteE2eKey = encodeURIComponent(String(node?.path || node?.name || 'item')).replace(/%/g, '_');
  button.setAttribute('data-e2e-id', `favorite-item-menu-${favoriteE2eKey}`);
  button.draggable = false;
  button.innerHTML = typeof lucide === 'function' ? lucide('ellipsis', 14) : '...';
  button.addEventListener('click', (event) => _showFavoriteItemMenu(event, node, isFavFolder));
  button.addEventListener('dragstart', (event) => event.preventDefault());
  return button;
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
      toggle.style.cssText = 'width:16px;text-align:center;cursor:pointer;flex-shrink:0;display:flex;align-items:center;justify-content:center;';
      toggle.innerHTML = lucide('chevronRight', 16);
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
      ico.innerHTML = lucide('folder', 18);
      ico.style.cssText = 'display:inline-flex;flex-shrink:0;';
      row.appendChild(ico);
      const lbl = document.createElement('span');
      lbl.style.cssText = 'overflow:hidden;text-overflow:ellipsis;flex:1 1 auto;min-width:0;';
      lbl.textContent = node.name;
      row.appendChild(lbl);
      row.appendChild(_createFavoriteMoreButton(node, true));
      row.oncontextmenu = (e) => _showFavoriteItemMenu(e, node, true);
      if (typeof addLongPressHandler === 'function') {
        addLongPressHandler(row, (e) => _showFavoriteItemMenu(e, node, true));
      }
      div.appendChild(row);
      div.appendChild(childDiv);
      (node.children || []).forEach(c => _renderFavNode(c, childDiv, depth + 1));
      // D&Dドロップ先
      row.addEventListener('dragover', (e) => { e.preventDefault(); row.style.background = 'rgba(86,156,214,0.2)'; });
      row.addEventListener('dragleave', () => { row.style.background = ''; });
      row.addEventListener('drop', (e) => {
        e.preventDefault(); row.style.background = '';
        const data = _outlinerParseJson(e.dataTransfer.getData('application/x-fav') || 'null', null);
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
      const ico = document.createElement('span');
      ico.innerHTML = lucide(iconName, 18);
      ico.style.cssText = 'display:inline-flex;flex-shrink:0;';
      row.appendChild(ico);
      const lbl = document.createElement('span');
      lbl.style.cssText = 'overflow:hidden;text-overflow:ellipsis;flex:1 1 auto;min-width:0;';
      lbl.textContent = node.name;
      row.appendChild(lbl);
      row.appendChild(_createFavoriteMoreButton(node, false));
      row.title = node.path;
      // 単クリック=選択のみ、ダブルクリック=開く（§2.4・フォルダツリー行と同じ操作語彙に統一）
      row.addEventListener('click', (e) => {
        if (e.target.closest('.fav-more-btn')) return;
        _selectSidebarShortcutItem(row);
        if (window.GBOutlinerActivation?.singleClickOpensItems?.()) {
          window.GBOutlinerActivation.activateStoredItem(node, { fromExplorer: true });
        }
      });
      row.addEventListener('dblclick', (e) => {
        if (e.target.closest('.fav-more-btn')) return;
        if (window.GBOutlinerActivation?.singleClickOpensItems?.()) return; // 単クリックで既に開いている
        window.GBOutlinerActivation?.activateStoredItem(node, { fromExplorer: true });
      });
      row.oncontextmenu = (e) => _showFavoriteItemMenu(e, node, false);
      if (typeof addLongPressHandler === 'function') {
        addLongPressHandler(row, (e) => _showFavoriteItemMenu(e, node, false));
      }
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
    const data = _outlinerParseJson(e.dataTransfer.getData('application/x-fav') || 'null', null);
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
