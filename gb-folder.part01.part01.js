/**
 * Meldex Folder View
 * フォルダビュー、プレビュー、パネル管理
 */

/* ==============================
   フォルダビュー
   ============================== */
// ファイルタイプアイコン（Lucide SVG）
// fileTypeIcon は meldex-core.js で定義済み
// FILE_TYPE_LABELS は meldex-core.js で定義済み
// NATIVE_TYPES は meldex-core.js で定義済み

function _isFolderFreeLayoutUiEnabled() {
  if (typeof GBLayout === 'undefined') return true;
  return typeof GBLayout.isFreeLayoutUiEnabled === 'function'
    ? !!GBLayout.isFreeLayoutUiEnabled()
    : true;
}

function _openFolderInMobileExplorer(label, path, openOpts) {
  if (!path || !openOpts?.fromExplorer || openOpts.skipShowView || openOpts.skipMobileExplorer) return false;
  if (!window.MeldexCloudMobile?.shouldUseSidebarDrawer?.()) return false;
  const explorer = window.MeldexCloudMobileExplorer;
  if (!explorer?.selectFolderFromTree) return false;
  const name = label || String(path).split(/[\\/]/).filter(Boolean).pop() || 'フォルダ';
  explorer.selectFolderFromTree({ name, label: name, path, type: 'folder' }, {
    renderList: true,
    force: true,
  });
  window.MeldexCloudMobile?.openSidebar?.(false);
  explorer.setMode?.('list', { syncFromTree: false, force: true });
  explorer.renderCurrent?.({ force: true });
  return true;
}

async function openFolder(label, path, opts) {
  const openOpts = opts || {};
  if (window.MeldexArchiveBrowser) window.MeldexArchiveBrowser.clear();
  if (_openFolderInMobileExplorer(label, path, openOpts)) return true;
  const showOpenLoading = !openOpts.silent
    && !openOpts.skipGlobalUi
    && typeof showLoading === 'function'
    && typeof hideLoading === 'function';
  let loadingShown = false;
  const displayLabel = _folderDisplayLabel(label, path);
  const folderLoadSeq = (window._openFolderLoadSeq || 0) + 1;
  window._openFolderLoadSeq = folderLoadSeq;
  const isStaleFolderLoad = () => (typeof openOpts.isLegacyLoadCurrent === 'function' && !openOpts.isLegacyLoadCurrent())
    || window._openFolderLoadSeq !== folderLoadSeq
    || _folderPath !== path;
  try {
    if (showOpenLoading) { showLoading('フォルダを読み込み中...'); loadingShown = true; }
    if (typeof _primeFileLockCacheFromStorage === 'function') _primeFileLockCacheFromStorage();
    if (!openOpts.skipGlobalUi && typeof clearFileStyleForPanel === 'function') clearFileStyleForPanel('folder-view');
    _folderPath = path;
    _folderSelected = null;
    _folderSelectedItems = [];
    if (!openOpts.skipShowView) showView('folder');
    if (!openOpts.skipGlobalUi && typeof applyFolderFileStyle === 'function') applyFolderFileStyle(path);
    const folderTitleEl = document.getElementById('folder-title');
    if (folderTitleEl) folderTitleEl.textContent = displayLabel;
    window.MeldexFileLockBadge?.apply?.(folderTitleEl, path);
    const currentTitleEl = document.getElementById('current-title');
    if (currentTitleEl && !openOpts.skipGlobalUi) currentTitleEl.textContent = displayLabel;
    if (!openOpts.skipSaveLastView) saveLastView({type:'folder', label: displayLabel, path});
    if (!openOpts.skipNavPush) {
      const _navEntry = {type:'folder', label: displayLabel, path};
      navPush(_navEntry);
    }
    if (!openOpts.skipHighlight) _syncFolderPanelPathToOutliner(path, { noScroll: !!openOpts.noScrollHighlight });

    let fetchedItems = await apiFetch('/browse?path=' + encodeURIComponent(path) + '&detail=true&all_files=true');
    if (typeof isOutlinerDeletePendingPath === 'function') {
      fetchedItems = fetchedItems.filter(item => !isOutlinerDeletePendingPath(item?.path));
    }
    if (isStaleFolderLoad()) return;
    _folderItems = fetchedItems;
    if (typeof _registerFileIds === 'function') _registerFileIds(_folderItems);
    if (showOpenLoading && typeof showLoadingBeforeHeavyWork === 'function') {
      await showLoadingBeforeHeavyWork(_folderItems.length, '大きいフォルダを描画中...', { threshold: 80 });
      if (isStaleFolderLoad()) return;
    }
    registerFileTypes(_folderItems);
    const openSelectedPaths = [
      ...(Array.isArray(openOpts.selectedPaths) ? openOpts.selectedPaths : []),
      openOpts.selectedPath,
    ].filter(Boolean);
    renderFolderGrid({ preserveSelectedPaths: openSelectedPaths });
    const folderCountEl = document.getElementById('folder-item-count');
    if (folderCountEl) folderCountEl.textContent = _folderItems.length + ' 項目';
    if (!openOpts.skipGlobalUi) showStatus('フォルダ: ' + displayLabel);
    if (typeof _scheduleFileLockRefreshForOutliner === 'function') _scheduleFileLockRefreshForOutliner();
  } catch (e) {
    if (isStaleFolderLoad()) return;
    _folderItems = [];
    _folderSelected = null;
    _folderSelectedItems = [];
    const folderGridEl = document.getElementById('folder-grid');
    if (folderGridEl) folderGridEl.innerHTML = '<div style="padding:24px;color:var(--fg2);">読み込みに失敗しました</div>';
    const folderCountEl = document.getElementById('folder-item-count');
    if (folderCountEl) folderCountEl.textContent = '0 項目';
    if (!openOpts.skipGlobalUi && typeof showStatus === 'function') {
      showStatus('フォルダ読み込みエラー: ' + (e?.message || e), true);
    }
  } finally {
    if (loadingShown) {
      hideLoading();
      if (typeof hideLoadingMessage === 'function') {
        hideLoadingMessage('フォルダを読み込み中...');
        hideLoadingMessage('大きいフォルダを描画中...');
      }
    }
  }
  if (!openOpts.skipGlobalUi) _syncDetailPanel(displayLabel, path, 'folder');
}

function renderFolderInitialPrompt() {
  _folderPath = '';
  _folderItems = [];
  _folderVisibleItems = [];
  _folderSelected = null;
  _folderSelectedItems = [];
  const titleEl = document.getElementById('folder-title');
  if (titleEl) titleEl.textContent = 'フォルダ';
  window.MeldexFileLockBadge?.apply?.(titleEl, '');
  const currentTitleEl = document.getElementById('current-title');
  if (currentTitleEl) currentTitleEl.textContent = 'フォルダ';
  const countEl = document.getElementById('folder-item-count');
  if (countEl) countEl.textContent = '0 項目';
  if (typeof _updateFolderBulkBar === 'function') _updateFolderBulkBar();
  if (typeof applyFvPanelLayout === 'function') applyFvPanelLayout();

  const grid = document.getElementById('folder-grid');
  if (!grid) return;
  const layoutMap = {grid:'grid-layout', list:'list-layout', waterfall:'waterfall-layout', hflow:'hflow-layout'};
  grid.className = layoutMap[_folderLayout] || 'grid-layout';
  grid.innerHTML = '';
  grid.scrollTop = 0;

  const empty = document.createElement('div');
  empty.className = 'gb-empty-state';
  empty.style.cssText = 'min-height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;color:var(--fg2);gap:10px;padding:32px;';
  const icon = document.createElement('div');
  icon.className = 'gb-empty-icon';
  icon.style.color = 'var(--fg2)';
  icon.innerHTML = typeof lucide === 'function' ? lucide('folderOpen', 48) : '';
  const message = document.createElement('div');
  message.className = 'gb-empty-message';
  message.style.cssText = 'color:var(--fg);font-size:15px;';
  message.textContent = 'フォルダツリーでフォルダかファイルを選択してください';
  const hint = document.createElement('div');
  hint.className = 'gb-empty-hint';
  hint.style.cssText = 'font-size:13px;line-height:1.6;';
  hint.textContent = '選択したフォルダ、または選択したファイルのあるフォルダをここに表示します。';
  empty.appendChild(icon);
  empty.appendChild(message);
  empty.appendChild(hint);
  grid.appendChild(empty);
}

function setFolderLayout(mode) {
  _folderLayout = mode;
  localStorage.setItem('folder-layout', mode);
  const select = document.getElementById('folder-layout-select');
  if (select) select.value = mode;
  window.MeldexCloudMobileExplorer?.syncLayoutFromFolder?.(mode);
  renderFolderGrid();
}

function toggleFolderPreview() {
  // 新パネルシステムのプレビュー＋詳細をまとめてトグル
  const cfg = _getFvPanelCfg();
  const anyVisible = (cfg.previewVisible ?? false) || (cfg.detailVisible ?? false);
  cfg.previewVisible = !anyVisible;
  cfg.detailVisible = !anyVisible;
  _saveFvPanelCfg(cfg);
  if (!anyVisible && _folderSelected) showFolderPreview(_folderSelected);
  else applyFvPanelLayout();
}

// ウォーターフォール: JSで位置計算（Pinterest風）
// ウォーターフォールのリサイズ監視
let _waterfallResizeOb = null;
let _waterfallLayoutRaf = 0;
let _waterfallObservedWidth = 0;

function _disconnectWaterfallResizeObserver() {
  if (_waterfallResizeOb) {
    _waterfallResizeOb.disconnect();
    _waterfallResizeOb = null;
  }
  _waterfallObservedWidth = 0;
}

function _scheduleWaterfallLayout() {
  if (_waterfallLayoutRaf) return;
  const run = () => {
    _waterfallLayoutRaf = 0;
    applyWaterfallLayout();
  };
  if (typeof requestAnimationFrame === 'function') {
    _waterfallLayoutRaf = requestAnimationFrame(run);
  } else {
    _waterfallLayoutRaf = setTimeout(run, 0);
  }
}

function _ensureWaterfallResizeObserver() {
  const grid = document.getElementById('folder-grid');
  if (!grid) return;
  _disconnectWaterfallResizeObserver();
  if (grid.classList.contains('waterfall-layout')) {
    const target = grid.parentElement || grid;
    _waterfallObservedWidth = _waterfallElementWidth(target) || _waterfallElementWidth(grid);
    _waterfallResizeOb = new ResizeObserver(entries => {
      void entries;
      const width = _waterfallElementWidth(target) || _waterfallElementWidth(grid);
      if (width === _waterfallObservedWidth) return;
      _waterfallObservedWidth = width;
      _scheduleWaterfallLayout();
    });
    _waterfallResizeOb.observe(target);
  }
}

function _setStyleIfChanged(el, property, value) {
  if (!el || el.style[property] === value) return;
  el.style[property] = value;
}

function _waterfallElementWidth(el) {
  const rect = el?.getBoundingClientRect?.();
  return Math.round(rect?.width || el?.offsetWidth || el?.clientWidth || 0);
}

function applyWaterfallLayout() {
  const grid = document.getElementById('folder-grid');
  if (!grid || !grid.classList.contains('waterfall-layout')) return;
  const items = Array.from(grid.querySelectorAll('.fv-item'));
  if (items.length === 0) return;
  const gap = 3;
  const colW = parseInt(getComputedStyle(grid).getPropertyValue('--fv-card-w')) || 120;
  const containerW = _waterfallElementWidth(grid) - 24; // padding考慮
  const cols = Math.max(1, Math.floor((containerW + gap) / (colW + gap)));
  const colHeights = new Array(cols).fill(0);

  items.forEach(el => {
    const minH = Math.min(...colHeights);
    const colIdx = colHeights.indexOf(minH);
    _setStyleIfChanged(el, 'left', (colIdx * (colW + gap)) + 'px');
    _setStyleIfChanged(el, 'top', minH + 'px');
    _setStyleIfChanged(el, 'width', colW + 'px');
    colHeights[colIdx] = minH + el.offsetHeight + gap;
  });
  // 内部の高さスペーサーでスクロール可能にする（grid自体のheightは変えない）
  let spacer = grid.querySelector('.wf-spacer');
  if (!spacer) {
    spacer = document.createElement('div');
    spacer.className = 'wf-spacer';
    spacer.style.position = 'relative';
    spacer.style.width = '1px';
    spacer.style.pointerEvents = 'none';
    grid.appendChild(spacer);
  }
  _setStyleIfChanged(spacer, 'height', Math.max(...colHeights) + 'px');
}

function applyFolderZoom() {
  const grid = document.getElementById('folder-grid');
  const w = Math.round(120 * _folderZoom);
  const h = Math.round(75 * _folderZoom);
  grid.style.setProperty('--fv-card-w', w + 'px');
  grid.style.setProperty('--fv-card-h', h + 'px');
  if (_folderLayout === 'waterfall') _scheduleWaterfallLayout();
}

function _folderFilterArray(value) {
  return Array.isArray(value) ? value.map(v => String(v || '').trim()).filter(Boolean) : [];
}

function _folderItemExt(item) {
  const explicit = String(item?.ext || '').trim().toLowerCase();
  if (explicit) return explicit.startsWith('.') ? explicit : '.' + explicit;
  const path = String(item?.path || item?.name || '').split(/[?#]/)[0].toLowerCase();
  const name = path.split(/[\\/]/).pop() || '';
  if (name.endsWith('.mel-board')) return '.mel-board';
  if (name.endsWith('.mel-sheet')) return '.mel-sheet';
  if (name.endsWith('.mel-scenario')) return '.mel-scenario';
  if (name.endsWith('.mel-timer')) return '.mel-timer';
  if (name.endsWith('.scriptnote.json')) return '.scriptnote.json';
  if (name.endsWith('.smart-db.json')) return '.smart-db.json';
  if (name.endsWith('.timer.json')) return '.timer.json';
  const index = name.lastIndexOf('.');
  return index >= 0 ? name.slice(index) : '';
}

function _folderItemTypeKey(item) {
  return String(item?.type || 'unknown');
}

function _folderItemTypeKeys(item) {
  const type = _folderItemTypeKey(item);
  if (type === 'scriptnote') return ['scriptnote', 'scenario'];
  if (type === 'scenario') return ['scenario', 'scriptnote'];
  if (type === 'smart-db') return ['smart-db'];
  return [type];
}

function _folderItemTypeLabel(type) {
  return FILE_TYPE_LABELS?.[type] || type || 'unknown';
}

function _folderItemModifiedTime(item) {
  const raw = item?.modified || item?.mtime || '';
  const time = raw ? Date.parse(raw) : NaN;
  return Number.isFinite(time) ? time : 0;
}

function _folderLocalDateStart(value) {
  if (!value) return 0;
  const time = Date.parse(String(value) + 'T00:00:00');
  return Number.isFinite(time) ? time : 0;
}

function _folderLocalDateEnd(value) {
  const start = _folderLocalDateStart(value);
  return start ? start + 24 * 60 * 60 * 1000 - 1 : 0;
}

function _folderModifiedLowerBound(preset) {
  const now = Date.now();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (preset === 'today') return today.getTime();
  if (preset === '7d') return now - 7 * 24 * 60 * 60 * 1000;
  if (preset === '30d') return now - 30 * 24 * 60 * 60 * 1000;
  if (preset === '90d') return now - 90 * 24 * 60 * 60 * 1000;
  return 0;
}

function _folderMatchesModifiedFilter(item, cfg) {
  const preset = cfg.filterModifiedPreset || 'all';
  if (preset === 'all') return true;
  const modified = _folderItemModifiedTime(item);
  if (!modified) return false;
  if (preset === 'custom') {
    const from = _folderLocalDateStart(cfg.filterModifiedFrom);
    const to = _folderLocalDateEnd(cfg.filterModifiedTo);
    if (from && modified < from) return false;
    if (to && modified > to) return false;
    return true;
  }
  const lower = _folderModifiedLowerBound(preset);
  return lower ? modified >= lower : true;
}

function _folderHasActiveFilters(cfg) {
  return !!String(cfg.filterText || '').trim()
    || _folderFilterArray(cfg.filterTypes).length > 0
    || _folderFilterArray(cfg.filterExts).length > 0
    || _folderHasActiveFolderFilter(cfg)
    || _folderHasActiveTagFilter(cfg)
    || (cfg.filterModifiedPreset && cfg.filterModifiedPreset !== 'all');
}

function _getFolderFilteredItems() {
  const cfg = typeof getFolderDisplayConfig === 'function' ? getFolderDisplayConfig() : {};
  const text = String(cfg.filterText || '').trim().toLowerCase();
  const types = new Set(_folderFilterArray(cfg.filterTypes));
  const exts = new Set(_folderFilterArray(cfg.filterExts).map(ext => ext.toLowerCase()));
  const folders = new Set(_folderFilterFolderKeys(cfg));
  const tags = new Set(_folderFilterTagKeys(cfg));
  return _folderItems.filter(item => {
    if (typeof isOutlinerDeletePendingPath === 'function' && isOutlinerDeletePendingPath(item?.path)) return false;
    if (text) {
      const haystack = [item.name, item.path, item.ext, _folderItemTypeLabel(item.type)].join('\n').toLowerCase();
      if (!haystack.includes(text)) return false;
    }
    if (types.size > 0 && !_folderItemTypeKeys(item).some(type => types.has(type))) return false;
    if (exts.size > 0 && !exts.has(_folderItemExt(item))) return false;
    if (!_folderMatchesFolderFilter(item, folders)) return false;
    if (!_folderMatchesTagFilter(item, tags)) return false;
    return _folderMatchesModifiedFilter(item, cfg);
  });
}

function _folderFilterChoices() {
  const cfg = typeof getFolderDisplayConfig === 'function' ? getFolderDisplayConfig() : {};
  const selectedTypes = _folderFilterArray(cfg.filterTypes);
  const selectedExts = _folderFilterArray(cfg.filterExts).map(ext => ext.toLowerCase());
  const selectedFolders = _folderFilterFolderKeys(cfg);
  const selectedTags = _folderFilterTagKeys(cfg);
  const typeMap = new Map();
  const extMap = new Map();
  const folderMap = new Map();
  const tagMap = new Map();
  _folderItems.forEach(item => {
    const type = _folderItemTypeKey(item);
    if (type && !typeMap.has(type)) typeMap.set(type, _folderItemTypeLabel(type));
    const ext = _folderItemExt(item);
    if (ext && !extMap.has(ext)) extMap.set(ext, ext);
    const memberships = _folderItemMemberships(item);
    if (memberships.length > 1 || memberships.some(row => row.type === 'link')) {
      memberships.forEach(row => {
        const folder = _folderMembershipKey(row.folder);
        if (folder && !folderMap.has(folder)) folderMap.set(folder, _folderMembershipFolderLabel(folder));
      });
    }
    _folderItemTags(item).forEach(tag => {
      const key = String(tag.id || tag.name || '').toLowerCase();
      if (key && !tagMap.has(key)) tagMap.set(key, tag.name || key);
    });
  });
  selectedTypes.forEach(type => { if (!typeMap.has(type)) typeMap.set(type, _folderItemTypeLabel(type)); });
  selectedExts.forEach(ext => { if (ext && !extMap.has(ext)) extMap.set(ext, ext); });
  selectedFolders.forEach(folder => { if (folder && !folderMap.has(folder)) folderMap.set(folder, _folderMembershipFolderLabel(folder)); });
  selectedTags.forEach(tag => { if (tag && !tagMap.has(tag)) tagMap.set(tag, _folderTagLabel(tag)); });
  return {
    types: Array.from(typeMap.entries()).sort((a, b) => a[1].localeCompare(b[1], 'ja')),
    exts: Array.from(extMap.entries()).sort((a, b) => a[1].localeCompare(b[1], 'ja')),
    folders: Array.from(folderMap.entries()).sort((a, b) => a[1].localeCompare(b[1], 'ja')),
    tags: Array.from(tagMap.entries()).sort((a, b) => a[1].localeCompare(b[1], 'ja')),
  };
}

function _saveFolderDisplayConfigPatch(patch) {
  const cfg = typeof getFolderDisplayConfig === 'function' ? getFolderDisplayConfig() : {};
  Object.assign(cfg, patch || {});
  if (typeof saveFolderDisplayConfig === 'function') saveFolderDisplayConfig(cfg);
  return cfg;
}

function _clearFolderFilters() {
  const cfg = _saveFolderDisplayConfigPatch({
    filterText: '',
    filterTypes: [],
    filterExts: [],
    filterFolders: [],
    filterTags: [],
    filterModifiedPreset: 'all',
    filterModifiedFrom: '',
    filterModifiedTo: '',
  });
  return cfg;
}

function applyFolderTagFilter(tag) {
  if (!_folderPath || !Array.isArray(_folderItems)) {
    if (typeof showStatus === 'function') showStatus('フォルダを開いてからタグで絞り込んでください', true);
    return false;
  }
  const tagKey = String(tag?.id || tag?.name || tag || '').trim();
  if (!tagKey) return false;
  const cfg = _saveFolderDisplayConfigPatch({ filterTags: [tagKey] });
  if (typeof _folderEnsureTags === 'function') _folderEnsureTags(_folderItems, { rerender: true });
  renderFolderGrid({ resetScrollTop: true });
  _updateFolderDisplayFilterButton(cfg);
  return true;
}

function _updateFolderDisplayFilterButton(cfg) {
  const current = cfg || (typeof getFolderDisplayConfig === 'function' ? getFolderDisplayConfig() : {});
  const displayBtn = document.getElementById('folder-display-btn');
  const displayIcon = document.getElementById('folder-display-icon');
  const filterBtn = document.getElementById('folder-filter-btn');
  const filterCount = document.getElementById('folder-filter-count');
  const layoutIcons = { list: 'list', grid: 'grid3x3', waterfall: 'layoutGrid', hflow: 'galleryHorizontal' };
  const icon = layoutIcons[_folderLayout] || 'grid3x3';
  if (displayIcon) displayIcon.className = 'ico ico-' + icon;
  if (displayBtn) {
    displayBtn.dataset.layout = _folderLayout || 'grid';
    displayBtn.title = '表示: ' + ({ list: 'リスト', grid: 'グリッド', waterfall: 'ウォーターフォール', hflow: '横並び' }[_folderLayout] || 'グリッド');
  }
  if (!filterBtn) return;
  const active = _folderHasActiveFilters(current);
  const count = [
    String(current.filterText || '').trim() ? 1 : 0,
    ...(Array.isArray(current.filterTypes) ? current.filterTypes : []),
    ...(Array.isArray(current.filterExts) ? current.filterExts : []),
    ...(Array.isArray(current.filterFolders) ? current.filterFolders : []),
    ...(Array.isArray(current.filterTags) ? current.filterTags : []),
    current.filterModifiedPreset && current.filterModifiedPreset !== 'all' ? 1 : 0,
  ].filter(Boolean).length;
  filterBtn.dataset.filterActive = active ? 'true' : 'false';
  filterBtn.style.borderColor = active ? 'var(--accent)' : 'var(--border)';
  filterBtn.style.color = active ? 'var(--accent)' : 'var(--fg2)';
  filterBtn.title = active ? `フィルタ（${count}件の条件を適用中）` : 'フィルタ';
  if (filterCount) {
    filterCount.hidden = !active;
    filterCount.textContent = active ? ` ${count}` : '';
  }
}

function renderFolderGrid(opts) {
  const renderOpts = opts || {};
  const preserveSelectedPaths = new Set((renderOpts.preserveSelectedPaths || []).filter(Boolean));
  const resetScrollTop = !!renderOpts.resetScrollTop;
  const container = document.getElementById('folder-grid');
  const renderSeq = ++_folderRenderSeq;
  container.innerHTML = '';
  if (resetScrollTop) container.scrollTop = 0;
  const layoutMap = {grid:'grid-layout', list:'list-layout', waterfall:'waterfall-layout', hflow:'hflow-layout'};
  container.className = layoutMap[_folderLayout] || 'grid-layout';
  _installFolderBlankContextMenu(container);
  const layoutSelect = document.getElementById('folder-layout-select');
  if (layoutSelect) layoutSelect.value = _folderLayout;
  applyFolderZoom();

  _folderSelectedItems = [];
  _folderSelected = null;
  _updateFolderBulkBar();
  // パネルレイアウトを適用
  applyFvPanelLayout();
  // ウォーターフォール以外: 高さリセット
  if (_folderLayout !== 'waterfall') {
    _disconnectWaterfallResizeObserver();
    container.style.height = '';
    const oldSpacer = container.querySelector('.wf-spacer');
    if (oldSpacer) oldSpacer.remove();
  }

  const dcfg = getFolderDisplayConfig();
  const showThumb = dcfg.showThumb !== false;
  const showName = dcfg.showName !== false;
  const showSize = dcfg.showSize !== false;
  const showDate = dcfg.showDate !== false;
  const showType = dcfg.showType !== false;
  const showDimensions = dcfg.showDimensions !== false;
  const showRating = dcfg.showRating !== false;
  const showTags = dcfg.showTags !== false;
  if (_folderHasActiveFolderFilter(dcfg)) _folderEnsureMemberships(_folderItems, { rerender: true });
  const activeTagFilter = _folderHasActiveTagFilter(dcfg);
  const tagLoadPromise = (showTags || activeTagFilter)
    ? _folderEnsureTags(_folderItems, { rerender: activeTagFilter })
    : null;
  const filteredItems = _folderSortVisibleItems(_getFolderFilteredItems());
  _folderVisibleItems = filteredItems;
  _updateFolderDisplayFilterButton(dcfg);
  document.getElementById('folder-item-count').textContent = filteredItems.length + (_folderItems.length !== filteredItems.length ? ' / ' + _folderItems.length : '') + ' 項目';
  const isListLayout = _folderLayout === 'list';
  const showThumbForLayout = isListLayout || showThumb;
  _folderConfigureListLayout(container, isListLayout);
  if (isListLayout) _folderRenderListHeader(container);

  if (filteredItems.length === 0) {
    const empty = document.createElement('div');
    empty.style.cssText = 'padding:40px;text-align:center;color:var(--fg2);';
    empty.textContent = _folderItems.length > 0 && _folderHasActiveFilters(dcfg) ? '条件に一致する項目がありません' : 'このフォルダは空です';
    container.appendChild(empty);
    return;
  }

  let nextRenderIndex = 0;
  const finishFolderGridRender = () => {
    if (renderSeq !== _folderRenderSeq) return;
    _syncFolderCheckboxes();
    _updateFolderBulkBar();
    if (preserveSelectedPaths.size > 0 && _folderSelected) {
      const panelCfg = _getFvPanelCfg();
      if ((panelCfg.previewVisible ?? true) || (panelCfg.detailVisible ?? true)) showFolderPreview(_folderSelected);
    }

    // ウォーターフォール: 全アイテム追加後にレイアウト計算 + 画像読み込み完了後に再計算（debounce）
    if (_folderLayout === 'waterfall') {
      _scheduleWaterfallLayout();
      let _wfDebounceTimer = null;
      const debouncedLayout = () => {
        clearTimeout(_wfDebounceTimer);
        _wfDebounceTimer = setTimeout(() => _scheduleWaterfallLayout(), 80);
      };
      container.querySelectorAll('img').forEach(img => {
        if (!img.complete) img.onload = debouncedLayout;
      });
      _ensureWaterfallResizeObserver();
    }
    tagLoadPromise?.then(() => {
      if (renderSeq !== _folderRenderSeq) return;
      window.MeldexEmbeddedMetadata?.refreshFolderTags?.(container);
      if (_folderLayout === 'waterfall') _scheduleWaterfallLayout();
    });
  };
  const renderFolderGridChunk = () => {
    if (renderSeq !== _folderRenderSeq) return;
    const fragment = document.createDocumentFragment();
    const endIndex = Math.min(filteredItems.length, nextRenderIndex + _folderPanelRenderChunkSize(filteredItems.length));
    for (; nextRenderIndex < endIndex; nextRenderIndex++) {
      const item = filteredItems[nextRenderIndex];
      const idx = nextRenderIndex;
    const el = document.createElement('div');
    el.className = 'fv-item';
    el.dataset.idx = idx;
    el.dataset.itemType = item.type || '';
    if (item.path) el.dataset.path = item.path;
    const itemLocked = item.path && typeof isItemLocked === 'function' && isItemLocked(item.path);
    el.draggable = !itemLocked;
    if (preserveSelectedPaths.has(item.path)) {
      el.classList.add('selected');
      _folderSelectedItems.push(item);
      _folderSelected = item;
    }

    // チェックボックス（ホバー時表示）
    const chk = document.createElement('input');
    chk.type = 'checkbox';
    chk.className = 'fv-check';
    chk.dataset.e2eId = `folder-item-select-${item.path || idx}`;
    chk.setAttribute('aria-label', `フォルダ項目を選択: ${item.name || item.path || idx + 1}`);
    chk.addEventListener('click', (e) => {
      e.stopPropagation();
      if (chk.checked) {
        el.classList.add('selected');
        if (!_folderSelectedItems.includes(item)) _folderSelectedItems.push(item);
      } else {
        el.classList.remove('selected');
        _folderSelectedItems = _folderSelectedItems.filter(i => i !== item);
      }
      _folderSelected = _folderSelectedItems.length > 0 ? _folderSelectedItems[_folderSelectedItems.length - 1] : null;
      _syncFolderSelectionToOutliner(_folderSelected);
      _updateFolderBulkBar();
      if (_folderSelectedItems.length > 1) showStatus(_folderSelectedItems.length + ' 件選択中');
    });
    el.appendChild(chk);

    const moreBtn = document.createElement('button');
    moreBtn.type = 'button';
    moreBtn.className = 'fv-more-btn';
    moreBtn.title = 'メニュー';
    moreBtn.dataset.e2eId = 'folder-item-menu-' + idx + '-' + (item.path || item.name || idx).replace(/[^a-zA-Z0-9_-]+/g, '-');
    moreBtn.dataset.gbTooltip = 'この項目のメニューを開きます';
    moreBtn.innerHTML = lucide('ellipsis', 14);
    moreBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      showFolderItemContextMenu(e, item);
    });
    el.appendChild(moreBtn);

    if (itemLocked) {
      const lockBadge = document.createElement('span');
      lockBadge.className = 'fv-lock-badge';
      lockBadge.innerHTML = lucide('lock', 12);
      const lockReason = typeof getItemLockReason === 'function' ? getItemLockReason(item.path) : '';
      lockBadge.title = typeof isSystemLockedItem === 'function' && isSystemLockedItem(item.path)
        ? 'システム保護中です'
        : ('編集ロック中' + (lockReason ? ': ' + lockReason : ''));
      lockBadge.dataset.gbTooltip = lockBadge.title;
      el.appendChild(lockBadge);
    }

    let folderCardThumb = null;
    let folderPreviewImage = null;
    if (showThumbForLayout) {
      const thumb = document.createElement('div');
      folderCardThumb = thumb;
      thumb.className = 'fv-thumb';
      if (isListLayout) {
        thumb.style.gridColumn = '1';
        thumb.style.gridRow = '1';
      }
      const THUMB_TYPES = new Set(['image','video']);
      const SHELL_THUMB_TYPES = new Set(['3d','psd','clip','document']);
      const appendIconThumb = () => {
        const icon = document.createElement('span');
        icon.className = 'fv-icon';
        icon.innerHTML = fileTypeIcon(item.type);
        thumb.appendChild(icon);
      };
      if (THUMB_TYPES.has(item.type)) {
        const img = document.createElement('img');
        const generatedThumbnail = item.type === 'video';
        folderPreviewImage = img;
        img.src = generatedThumbnail ? _folderItemThumbnailUrl(item) : _folderItemRawUrl(item);
        img.loading = 'lazy';
        img.onerror = () => {
          if (!generatedThumbnail && !img.dataset.thumbFallback && !item?.external_reference) {
            img.dataset.thumbFallback = '1';
            img.src = _folderItemThumbnailUrl(item);
            return;
          }
          const sp = document.createElement('span');
          sp.className = 'fv-icon';
          sp.innerHTML = fileTypeIcon(item.type);
          img.replaceWith(sp);
        };
        thumb.appendChild(img);
      } else if (SHELL_THUMB_TYPES.has(item.type)) {
        // Windows シェルサムネイルは起動直後の大量生成で固まるため、フォルダカードでは安定したアイコンを使う。
        appendIconThumb();
      } else {
        appendIconThumb();
      }
      // リンクファイルバッジ
      if (item.linked) {
        const badge = document.createElement('span');
        badge.style.cssText = 'position:absolute;top:4px;right:4px;background:rgba(0,0,0,0.6);border-radius:50%;width:18px;height:18px;display:flex;align-items:center;justify-content:center;';
        badge.innerHTML = lucide('externalLink', 10);
        badge.style.color = 'var(--accent)';
        badge.title = 'リンクファイル';
        badge.dataset.gbTooltip = '別のフォルダにも登録されているリンクファイルです';
        thumb.style.position = 'relative';
        thumb.appendChild(badge);
      }
      el.appendChild(thumb);
    }

    let folderMetaHost = null;
    if (isListLayout) {
      const nameCell = _folderAppendListCells(el, item);
      if (nameCell && ((item.type === 'image' && (showDimensions || showRating)) || showTags)) {
        folderMetaHost = document.createElement('div');
        folderMetaHost.className = 'fv-list-extra-meta';
        nameCell.appendChild(folderMetaHost);
      }
    } else if (showName) {
      const name = document.createElement('div');
      name.className = 'fv-name';
      name.textContent = item.name;
      name.title = item.name;
      name.dataset.gbTooltip = item.name;
      el.appendChild(name);
    }

    if (!isListLayout) {
      const meta = document.createElement('div');
      meta.className = 'fv-meta';
      if (showSize && item.size != null) meta.appendChild(Object.assign(document.createElement('span'), {className: 'fv-meta-item', textContent: formatFileSize(item.size)}));
      if (showDate && item.modified) meta.appendChild(Object.assign(document.createElement('span'), {className: 'fv-meta-item', textContent: item.modified.substring(0, 16).replace('T', ' ')}));
      if (showType) meta.appendChild(Object.assign(document.createElement('span'), {className: 'fv-meta-item', textContent: FILE_TYPE_LABELS[item.type] || item.ext || ''}));
      if (meta.childNodes.length > 0 || (item.type === 'image' && (showDimensions || showRating)) || showTags) {
        folderMetaHost = meta;
        el.appendChild(meta);
      }
    }

    if (folderMetaHost) {
      window.MeldexEmbeddedMetadata?.attachFolderCard?.(folderCardThumb, item, folderPreviewImage, {
        metaHost: folderMetaHost,
        showDimensions,
        showRating,
      });
      if (showTags) window.MeldexEmbeddedMetadata?.attachFolderTags?.(folderMetaHost, item);
    }

    // クリック: 選択（Ctrl=トグル追加、Shift=範囲選択）
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      if (e.ctrlKey || e.metaKey) {
        // Ctrl+クリック: トグル
        el.classList.toggle('selected');
        if (el.classList.contains('selected')) {
          _folderSelectedItems.push(item);
        } else {
          _folderSelectedItems = _folderSelectedItems.filter(i => i !== item);
        }
      } else if (e.shiftKey && _folderSelected) {
        // Shift+クリック: 範囲選択
        const allItems = [...container.querySelectorAll('.fv-item')];
        const anchorPath = _folderSelected?.path || '';
        const startIdx = filteredItems.findIndex(it => it === _folderSelected || (anchorPath && it?.path === anchorPath));
        const endIdx = allItems.indexOf(el);
        if (startIdx >= 0 && endIdx >= 0) {
          const [from, to] = startIdx < endIdx ? [startIdx, endIdx] : [endIdx, startIdx];
          allItems.forEach((el2, i) => {
            if (i >= from && i <= to) {
              el2.classList.add('selected');
              const it = filteredItems[parseInt(el2.dataset.idx)];
              if (it && !_folderSelectedItems.includes(it)) _folderSelectedItems.push(it);
            }
          });
        }
      } else {
        // 通常クリック: 単一選択
        document.querySelectorAll('.fv-item.selected').forEach(s => s.classList.remove('selected'));
        el.classList.add('selected');
        _folderSelectedItems = [item];
      }
      _folderSelected = item;
      _syncFolderSelectionToOutliner(item);
      _syncFolderCheckboxes();
      _updateFolderBulkBar();
      { const _pc = _getFvPanelCfg(); if ((_pc.previewVisible ?? true) || (_pc.detailVisible ?? true)) showFolderPreview(item); }
      // 選択件数表示
      if (_folderSelectedItems.length > 1) {
        showStatus(_folderSelectedItems.length + ' 件選択中');
      }
    });

    el.ondblclick = (e) => { e.stopPropagation(); openFolderItem(item); };

    // D&D開始対応（エクスプローラからキャンバス・ノート等へドラッグ）
    el.addEventListener('dragstart', (e) => {
      if (item.path && typeof isItemLocked === 'function' && isItemLocked(item.path)) {
        e.preventDefault();
        showStatus('編集ロック中の項目はドラッグできません', true);
        return;
      }
      e.stopPropagation();
      el.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'copyMove';
      e.dataTransfer.setData('text/plain', item.name || '');
      e.dataTransfer.setData('application/x-meldex-node', JSON.stringify({
        name: item.name, path: item.path, type: item.type || 'file'
      }));
      // text/uri-list を併用することで OS シェル側の赤い禁止カーソルを軽減
      try {
        if (item.path && typeof buildSingleTabWindowUrl === 'function') {
          const uri = new URL(
            buildSingleTabWindowUrl({ name: item.name, path: item.path, type: item.type || 'file' }),
            location.origin
          ).toString();
          e.dataTransfer.setData('text/uri-list', uri);
        }
      } catch {}
      // 窓外 popout 用に単一 item 分の payload を保持
      window._gbFolderViewDragPayload = {
        items: [{ name: item.name, path: item.path, type: item.type || 'file' }],
      };
      // ドロップインジケータが隠れないよう、プレビュー画像を低不透明度 + カーソルから離す
      if (typeof setLowOpacityDragImage === 'function') setLowOpacityDragImage(e, el, 0.35);
    });
    el.addEventListener('dragend', (e) => {
      el.classList.remove('dragging');
      // 窓外にドロップされた場合: 共通ヘルパーで単一窓として開く
      if (typeof isDragDroppedOutsideWindow === 'function' && isDragDroppedOutsideWindow(e)) {
        const payload = window._gbFolderViewDragPayload;
        const items = payload && Array.isArray(payload.items) ? payload.items : [];
        if (typeof openItemsAsSingleTabWindows === 'function') openItemsAsSingleTabWindows(items);
      }
      window._gbFolderViewDragPayload = null;
    });
    el.addEventListener('dragover', (e) => {
      if (!_folderCanAcceptLinkDrop(e, item)) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'link';
      el.classList.add('fv-link-drop');
    });
    el.addEventListener('dragleave', () => {
      el.classList.remove('fv-link-drop');
    });
    el.addEventListener('drop', async (e) => {
      if (!_folderCanAcceptLinkDrop(e, item)) return;
      e.preventDefault();
      e.stopPropagation();
      el.classList.remove('fv-link-drop');
      await _folderCreateLinksFromDrop(e, item);
    });

    // 右クリックメニュー
    el.oncontextmenu = (e) => {
      e.preventDefault();
      showFolderItemContextMenu(e, item);
    };

    fragment.appendChild(el);
    }
    container.appendChild(fragment);
    if (nextRenderIndex < filteredItems.length) {
      _folderScheduleRenderFrame(renderFolderGridChunk);
      return;
    }
    finishFolderGridRender();
  };
  renderFolderGridChunk();
}

function _folderMenuItemLocked(item) {
  return !!(item?.path && typeof isItemLocked === 'function' && isItemLocked(item.path));
}

function _folderMenuLockStatusLabel(item) {
  if (typeof isSystemLockedItem === 'function' && isSystemLockedItem(item?.path)) return 'システム保護';
  if (typeof isFileLockOwner === 'function' && !isFileLockOwner()) {
    return _folderMenuItemLocked(item) ? '編集ロック中' : '編集ロック（管理者のみ）';
  }
  return _folderMenuItemLocked(item) ? '編集ロック解除' : '編集ロックする';
}

async function _toggleFolderItemLock(item) {
  if (!item?.path || typeof toggleItemLock !== 'function') return;
  const changed = await toggleItemLock(item.path);
  if (!changed) return;
  if (_folderPath) await openFolder(_folderPath.split('/').pop(), _folderPath, {
    skipSaveLastView: true,
    skipNavPush: true,
    skipHighlight: true,
  });
  showStatus(_folderMenuItemLocked(item) ? '編集ロックしました' : '編集ロックを解除しました');
}

function _isPureRefFolderItem(item) {
  return !!(item?.path && /\.pur$/i.test(String(item.path).split(/[?#]/)[0]));
}

function _folderParentPath(path) {
  const normalized = String(path || '').replace(/\\/g, '/');
  const index = normalized.lastIndexOf('/');
  return index >= 0 ? normalized.slice(0, index) : '';
}

async function _convertPureRefFolderItemToBoard(item) {
  if (!_isPureRefFolderItem(item)) return;
  const baseName = String(item.name || item.path.split(/[\\/]/).pop() || 'PureRef').replace(/\.pur$/i, '') || 'PureRef';
  try {
    showStatus('PureRefをボードファイルに変換しています...');
    const result = await runBackgroundJob('/external-import/pureref/import', {
      path: item.path,
      board_name: baseName,
      save_dir: _folderParentPath(item.path),
      save_root: 'source',
    }, {
      onProgress: (progress) => {
        if (progress && progress.message) showStatus(progress.message);
      },
    });
    if (_folderPath) await _folderRefreshCurrentFolder();
    if (typeof reloadOutlinerTree === 'function') reloadOutlinerTree();
    if (result?.board_path && typeof openBoard === 'function') {
      openBoard(result.board_path.split('/').pop(), result.board_path, { fromExplorer: true });
    }
    showStatus(`PureRefをボードファイルに変換しました: ${result?.board_path || baseName}`);
  } catch (err) {
    showStatus('PureRefを変換できませんでした: ' + (err?.userMessage || err?.message || err), true);
  }
}

function refreshVisibleFolderLockState() {
  const grid = document.getElementById('folder-grid');
  if (!grid) return;
  grid.querySelectorAll('.fv-item').forEach(el => {
    const idx = parseInt(el.dataset.idx, 10);
    const item = (_folderVisibleItems.length ? _folderVisibleItems : _getFolderFilteredItems())[idx];
    if (!item?.path || typeof isItemLocked !== 'function') return;
    const locked = isItemLocked(item.path);
    el.draggable = !locked;
    el.querySelector('.fv-lock-badge')?.remove();
    if (!locked) return;
    const lockBadge = document.createElement('span');
    lockBadge.className = 'fv-lock-badge';
    lockBadge.innerHTML = lucide('lock', 12);
    const lockReason = typeof getItemLockReason === 'function' ? getItemLockReason(item.path) : '';
    lockBadge.title = typeof isSystemLockedItem === 'function' && isSystemLockedItem(item.path)
      ? 'システム保護中です'
      : ('編集ロック中' + (lockReason ? ': ' + lockReason : ''));
    lockBadge.dataset.gbTooltip = lockBadge.title;
    el.appendChild(lockBadge);
  });
}

// フォルダアイテムの右クリックメニュー
function showFolderItemContextMenu(e, item, options = {}) {
  if ((item?.archive_path || window._archiveBrowseContext) && typeof showArchiveItemContextMenu === 'function') {
    showArchiveItemContextMenu(e, item);
    return;
  }
  closeColHeaderMenu();
  const itemEl = e?.currentTarget?.closest?.('.fv-item') || e?.target?.closest?.('.fv-item') || null;
  const blankTarget = !!options.blankTarget;
  const alreadySelected = !blankTarget && _folderSelectedItems.some(selected => selected?.path === item.path);
  if (!blankTarget && !alreadySelected) {
    document.querySelectorAll('.fv-item.selected').forEach(s => s.classList.remove('selected'));
    if (itemEl) itemEl.classList.add('selected');
    _folderSelectedItems = [item];
    _folderSelected = item;
    _syncFolderCheckboxes();
    _updateFolderBulkBar();
    const panelCfg = _getFvPanelCfg();
    if ((panelCfg.previewVisible ?? true) || (panelCfg.detailVisible ?? true)) showFolderPreview(item);
  } else if (!blankTarget) {
    _folderSelected = item;
  }
  const menu = document.createElement('div');
  menu.className = 'gb-context-menu';
  const closeMenu = () => document.querySelectorAll('.gb-context-menu').forEach(m => m.remove());
  function addItem(label, fn, cls, icon) {
    const d = document.createElement('div');
    d.className = 'gb-context-menu-item';
    if (icon && typeof lucide === 'function') {
      d.innerHTML = '<span style="margin-right:6px;opacity:0.7;">' + lucide(icon, 14) + '</span>' + label;
    } else {
      d.textContent = label;
    }
    if (cls) d.style.color = 'var(--' + cls + ')';
    d.addEventListener('click', () => { closeMenu(); fn(); });
    menu.appendChild(d);
  }
  function addSep() { const d = document.createElement('div'); d.className = 'gb-context-menu-sep'; menu.appendChild(d); }
  function addSub(label, icon) {
    const wrap = document.createElement('div'); wrap.style.position = 'relative';
    const trigger = document.createElement('div'); trigger.className = 'gb-context-menu-item';
    trigger.innerHTML = (icon && typeof lucide === 'function' ? '<span style="margin-right:6px;opacity:0.7;">' + lucide(icon, 14) + '</span>' : '') + esc(label) + submenuArrow();
    const panel = document.createElement('div'); panel.className = 'gb-context-menu';
    panel.style.cssText = 'display:none;';
    attachHoverSubmenu(trigger, panel);
    wrap.appendChild(trigger); wrap.appendChild(panel); menu.appendChild(wrap);
    return {
      item(l, fn, cls, itemIcon) {
        const d = document.createElement('div');
        d.className = 'gb-context-menu-item';
        if (itemIcon && typeof lucide === 'function') d.innerHTML = '<span style="margin-right:6px;opacity:0.7;">' + lucide(itemIcon, 14) + '</span>' + esc(l);
        else d.textContent = l;
        if(cls) d.style.color='var(--'+cls+')';
        d.addEventListener('click', () => { closeMenu(); fn(); });
        panel.appendChild(d);
      }
    };
  }

  // --- 新規作成 ---
  const createParent = _folderContextCreateParent(item);
  if (createParent && !(typeof isItemLocked === 'function' && isItemLocked(createParent))) {
    const createSub = addSub('新規作成', 'plus');
    [['フォルダ','folder','folder'],['ノート','page','page'],['シナリオ','scriptnote','bookOpenText'],['シート','database','db'],['ボード','board','presentation'],['スマートシート','smart-db','databaseSearch']].forEach(([label,type,icon]) => {
      createSub.item(label, async () => {
        if (typeof addItemAt === 'function') {
          await addItemAt(createParent, type);
          await _folderRefreshCurrentFolder();
        }
      }, null, icon);
    });
    addSep();
  }

  // --- 開く ---
  if (!blankTarget) addItem('開く', () => openFolderItem(item), null, 'folderOpen');
  if (item.type === 'image') {
    const openSub = addSub('別の方法で開く');
    openSub.item('ビューワーで開く', () => openViewer(_folderItemViewerUrl(item)));
    openSub.item('サイドバーで開く', () => openLinkedPathInRightPane(item.path, item.name, { linkType: item.type }), null, 'panelRight');
    openSub.item('ボードで開く', () => openImageInCanvas(item));
  }
  if (_isPureRefFolderItem(item)) {
    addItem('ボードファイルに変換', () => _convertPureRefFolderItemToBoard(item), null, 'presentation');
  }
  if (item.type !== 'folder') addItem('アプリで開く', () => openNative(item.path), null, 'externalLink');
  if (item.type !== 'folder') addItem('チャットを開く', () => openFileChat(item.path), null, 'messageSquare');
  if (!blankTarget && item.path) {
    addItem(item.type === 'folder' ? 'フォルダ内すべてを自動タグ付け' : '自動タグ付け', () => {
      if (typeof autoTagFolderTarget === 'function') autoTagFolderTarget(item, { recursive: item.type === 'folder' });
    }, null, 'tags');
  }
  if (!blankTarget && item.path) {
    const archiveTargets = _folderSelectedItems.length > 1 ? _folderSelectedItems : [item];
    addItem(archiveTargets.length > 1 ? '選択項目を圧縮' : '圧縮', () => {
      if (typeof compressFolderItems === 'function') compressFolderItems(archiveTargets);
    }, null, 'archive');
  }
  if (!blankTarget && item.path && typeof _folderCanExtractArchive === 'function' && _folderCanExtractArchive(item)) {
    addItem('解凍', () => {
      if (typeof extractArchiveItem === 'function') extractArchiveItem(item);
    }, null, 'packageOpen');
  }

  if (item.type === 'calendar' && item.path) {
    const mainCalId = localStorage.getItem('main-calendar-id');
    const mainCalPath = localStorage.getItem('main-calendar-path');
    const nodeFid = typeof _pathToFileId === 'function' ? _pathToFileId(item.path) : '';
    const isMain = (mainCalId && nodeFid && mainCalId === nodeFid) || mainCalPath === item.path;
    const calSub = addSub('メインカレンダー', 'calendar');
    calSub.item((isMain ? '✓ ' : '') + '設定する', () => {
      const before = typeof _captureMainCalendarSettingsHistory === 'function' ? _captureMainCalendarSettingsHistory() : null;
      localStorage.setItem('main-calendar-path', item.path);
      if (nodeFid) localStorage.setItem('main-calendar-id', nodeFid);
      showStatus(`「${item.name}」をメインカレンダーに設定しました`);
      if (typeof _pushMainCalendarSettingsHistory === 'function') _pushMainCalendarSettingsHistory('カレンダー: メインカレンダー設定', before, item.path);
    });
    calSub.item((!isMain ? '✓ ' : '') + '解除する', () => {
      const before = typeof _captureMainCalendarSettingsHistory === 'function' ? _captureMainCalendarSettingsHistory() : null;
      localStorage.removeItem('main-calendar-path');
      localStorage.removeItem('main-calendar-id');
      showStatus('メインカレンダー設定を解除しました');
      if (typeof _pushMainCalendarSettingsHistory === 'function') _pushMainCalendarSettingsHistory('カレンダー: メインカレンダー解除', before, item.path);
    });
  }

  if ((item.type === 'folder' || item.type === 'database') && item.path) {
    addSep();
    addItem('バージョンを保存', () => {
      if (typeof saveFolderVersion === 'function') saveFolderVersion(item.path);
    }, null, 'save');
    addItem('バージョン管理', () => {
      if (typeof openFolderVersionTab === 'function') openFolderVersionTab(item.path);
      else if (typeof openVersionTab === 'function') openVersionTab(item.path, 'folder');
    }, null, 'gitBranch');
  }

  if (item.path) {
    addSep();
    const systemLocked = typeof isSystemLockedItem === 'function' && isSystemLockedItem(item.path);
    const canEditLock = typeof isFileLockOwner === 'function' && isFileLockOwner();
    const lockLabel = _folderMenuLockStatusLabel(item);
    if (systemLocked || !canEditLock) {
      const lockedItem = document.createElement('div');
      lockedItem.className = 'gb-context-menu-item disabled';
      lockedItem.innerHTML = '<span style="margin-right:6px;opacity:0.7;">' + lucide('lock', 14) + '</span>' + lockLabel;
      lockedItem.title = systemLocked ? 'システム保護中です' : '編集ロックの設定は管理者のみ可能です';
      lockedItem.dataset.gbTooltip = lockedItem.title;
      menu.appendChild(lockedItem);
    } else {
      addItem(lockLabel, () => _toggleFolderItemLock(item), null, _folderMenuItemLocked(item) ? 'unlock' : 'lock');
    }
  }

  // --- 複数選択 ---
  if (_folderSelectedItems.length > 1) {
    addSep();
    const imgItems = _folderSelectedItems.filter(i => i.type === 'image');
    if (imgItems.length > 0) {
      addItem('スライドショー (' + imgItems.length + '枚)', () => {
        openViewer('/viewer?files=' + encodeURIComponent(JSON.stringify(imgItems.map(i => i.path))));
      }, null, 'image');
      addItem('ボードに並べる (' + imgItems.length + '枚)', () => openImagesInCanvas(imgItems), null, 'presentation');
    }
  }

  // --- Notion同期（フォルダのみ） ---
  if (item.type === 'folder' && typeof addNotionSyncFolder === 'function') {
    addSep();
    addItem('Notion同期フォルダに追加', () => addNotionSyncFolder(item.path), null, 'sync');
  }

  // --- ツール ---
  if (item.type === 'folder' || _folderPath) {
    addSep();
    const toolSub = addSub('ツール');
    if (item.type === 'folder') {
      toolSub.item('重複画像を検出', () => showDuplicateScanModal(item.path));
      toolSub.item('画像インデックスを作成', () => clipIndexFolder(item.path));
    }
    if (_folderPath && (item.type !== 'folder' || item.path !== _folderPath)) {
      toolSub.item('このフォルダで重複検出', () => showDuplicateScanModal(_folderPath));
      toolSub.item('このフォルダのインデックス作成', () => clipIndexFolder(_folderPath));
    }
  }

  if (item.path && ((item.type === 'scriptnote') || (typeof isScriptNotePath === 'function' && isScriptNotePath(item.path)))) {
    addSep();
    addItem('シナリオで開く', () => {
      if (typeof openScenarioInScriptNote === 'function' && openScenarioInScriptNote(item.path, item.name || '', { fromExplorer: true })) return;
      showStatus('シナリオエディタを開けませんでした', true);
    }, null, 'fileText');
  }

  if (item.type === 'scenario' && item.path && !(typeof isScriptNotePath === 'function' && isScriptNotePath(item.path))) {
    addSep();
    addItem('シナリオへインポートして開く', () => {
      if (typeof openScenarioInScriptNote === 'function' && openScenarioInScriptNote(item.path, item.name || '', { fromExplorer: true })) return;
      showStatus('シナリオエディタを開けませんでした', true);
    }, null, 'fileText');
  }

  if (item.path && item.type !== 'folder' && typeof showCompareModal === 'function') {
    addSep();
    addItem('比較...', () => showCompareModal(item.path), null, 'columns');
  }

  if (!blankTarget && item.path) {
    addSep();
    addItem('リンクをコピー', () => _folderCopyMeldexLink(item), null, 'link');
    addItem('新しいタブで開く', () => _folderOpenItemInNewTab(item), null, 'externalLink');
    addItem('新しいウィンドウで開く', () => _folderOpenItemInNewWindow(item), null, 'monitor');
  }

  if (!blankTarget && item.path && typeof getFavorites === 'function') {
    const isFav = getFavorites().some(f => f.path === item.path);
    addItem(isFav ? 'お気に入りを外す' : 'お気に入りに追加', () => {
      if (isFav && typeof removeFromFavorites === 'function') removeFromFavorites(item.path);
