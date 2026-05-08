/* gb-folder.js: flattened split script for static cloud hosting. */
/* Source chunk: gb-folder.part01.js */
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
const WEB_PREVIEWABLE_IMAGE = new Set(['image']);
// NATIVE_TYPES は meldex-core.js で定義済み

let _folderPath = '';
let _folderItems = [];
let _folderSelected = null;
let _folderSelectedItems = []; // 複数選択
let _folderLayout = localStorage.getItem('folder-layout') || 'waterfall';
let _folderVisibleItems = [];
let _folderBulkPopupRaf = 0;
let _folderBulkPopupTracking = false;
// パネル表示状態は_getFvPanelCfg()で管理（旧_folderPreviewVisibleは廃止）
let _folderZoom = parseFloat(localStorage.getItem('folder-zoom') || '1');
const HOME_FOLDER_DISPLAY_LABEL = 'ホームフォルダ';

function _normalizeFolderPathForCompare(path) {
  return String(path || '').replace(/\\/g, '/').replace(/\/+$/, '');
}

function _isHomeFolderPath(path) {
  try {
    return !!_homeFolderPath && _normalizeFolderPathForCompare(path) === _normalizeFolderPathForCompare(_homeFolderPath);
  } catch {
    return false;
  }
}

function _folderDisplayLabel(label, path) {
  if (_isHomeFolderPath(path)) return HOME_FOLDER_DISPLAY_LABEL;
  return String(label || '').trim();
}

async function openFolder(label, path, opts) {
  const openOpts = opts || {};
  const displayLabel = _folderDisplayLabel(label, path);
  if (typeof _primeFileLockCacheFromStorage === 'function') _primeFileLockCacheFromStorage();
  if (!openOpts.skipGlobalUi && typeof clearFileStyleForPanel === 'function') clearFileStyleForPanel('folder-view');
  _folderPath = path;
  _folderSelected = null;
  _folderSelectedItems = [];
  if (!openOpts.skipShowView) showView('folder');
  if (!openOpts.skipGlobalUi && typeof applyFolderFileStyle === 'function') applyFolderFileStyle(path);
  const folderTitleEl = document.getElementById('folder-title');
  if (folderTitleEl) folderTitleEl.textContent = displayLabel;
  const currentTitleEl = document.getElementById('current-title');
  if (currentTitleEl && !openOpts.skipGlobalUi) currentTitleEl.textContent = displayLabel;
  if (!openOpts.skipSaveLastView) saveLastView({type:'folder', label: displayLabel, path});
  if (!openOpts.skipNavPush) {
    const _navEntry = {type:'folder', label: displayLabel, path};
    navPush(_navEntry);
  }
  if (!openOpts.skipHighlight) highlightOutlinerNode(path, { noScroll: true });

  try {
    _folderItems = await apiFetch('/browse?path=' + encodeURIComponent(path) + '&detail=true&all_files=true');
    registerFileTypes(_folderItems);
    renderFolderGrid();
    const folderCountEl = document.getElementById('folder-item-count');
    if (folderCountEl) folderCountEl.textContent = _folderItems.length + ' 項目';
    if (!openOpts.skipGlobalUi) showStatus('フォルダ: ' + displayLabel);
    if (typeof _scheduleFileLockRefreshForOutliner === 'function') _scheduleFileLockRefreshForOutliner();
    // 非同期でDB/board/chat判定（browseは拡張子のみなのでcheck-typeで確定）
    const checkTargets = _folderItems.filter(it => it.type === 'folder' || it.type === 'page' || it.type === 'scenario' || it.type === 'scriptnote');
    const capturedPath = path;
    if (checkTargets.length > 0) (async () => {
      let changed = false;
      for (let i = 0; i < checkTargets.length; i += 5) {
        if (_folderPath !== capturedPath) return; // フォルダが変わったら中断
        const batch = checkTargets.slice(i, i + 5);
        await Promise.all(batch.map(async (item) => {
          try {
            const res = await apiFetch('/check-type?path=' + encodeURIComponent(item.path));
            if (res.type !== item.type) { item.type = res.type; changed = true; }
          } catch {}
        }));
      }
      if (changed && _folderPath === capturedPath) {
        const selectedPaths = _folderSelectedItems.map(item => item?.path).filter(Boolean);
        registerFileTypes(_folderItems);
        renderFolderGrid({ preserveSelectedPaths: selectedPaths });
      }
    })();
  } catch (e) {
    _folderItems = [];
    _folderSelected = null;
    _folderSelectedItems = [];
    const folderGridEl = document.getElementById('folder-grid');
    if (folderGridEl) folderGridEl.innerHTML = '<div style="padding:24px;color:var(--fg2);">読み込みに失敗しました</div>';
    const folderCountEl = document.getElementById('folder-item-count');
    if (folderCountEl) folderCountEl.textContent = '0 項目';
  }
  if (!openOpts.skipGlobalUi) _syncDetailPanel(displayLabel, path, 'folder');
}

function setFolderLayout(mode) {
  _folderLayout = mode;
  localStorage.setItem('folder-layout', mode);
  document.getElementById('folder-layout-select').value = mode;
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
  if (_waterfallResizeOb) _waterfallResizeOb.disconnect();
  _waterfallObservedWidth = 0;
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
  if (name.endsWith('.scriptnote.json')) return '.scriptnote.json';
  if (name.endsWith('.smart-db.json')) return '.smart-db.json';
  const index = name.lastIndexOf('.');
  return index >= 0 ? name.slice(index) : '';
}

function _folderItemTypeKey(item) {
  return String(item?.type || 'unknown');
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
    || (cfg.filterModifiedPreset && cfg.filterModifiedPreset !== 'all');
}

function _getFolderFilteredItems() {
  const cfg = typeof getFolderDisplayConfig === 'function' ? getFolderDisplayConfig() : {};
  const text = String(cfg.filterText || '').trim().toLowerCase();
  const types = new Set(_folderFilterArray(cfg.filterTypes));
  const exts = new Set(_folderFilterArray(cfg.filterExts).map(ext => ext.toLowerCase()));
  return _folderItems.filter(item => {
    if (text) {
      const haystack = [item.name, item.path, item.ext, _folderItemTypeLabel(item.type)].join('\n').toLowerCase();
      if (!haystack.includes(text)) return false;
    }
    if (types.size > 0 && !types.has(_folderItemTypeKey(item))) return false;
    if (exts.size > 0 && !exts.has(_folderItemExt(item))) return false;
    return _folderMatchesModifiedFilter(item, cfg);
  });
}

function _folderFilterChoices() {
  const cfg = typeof getFolderDisplayConfig === 'function' ? getFolderDisplayConfig() : {};
  const selectedTypes = _folderFilterArray(cfg.filterTypes);
  const selectedExts = _folderFilterArray(cfg.filterExts).map(ext => ext.toLowerCase());
  const typeMap = new Map();
  const extMap = new Map();
  _folderItems.forEach(item => {
    const type = _folderItemTypeKey(item);
    if (type && !typeMap.has(type)) typeMap.set(type, _folderItemTypeLabel(type));
    const ext = _folderItemExt(item);
    if (ext && !extMap.has(ext)) extMap.set(ext, ext);
  });
  selectedTypes.forEach(type => { if (!typeMap.has(type)) typeMap.set(type, _folderItemTypeLabel(type)); });
  selectedExts.forEach(ext => { if (ext && !extMap.has(ext)) extMap.set(ext, ext); });
  return {
    types: Array.from(typeMap.entries()).sort((a, b) => a[1].localeCompare(b[1], 'ja')),
    exts: Array.from(extMap.entries()).sort((a, b) => a[1].localeCompare(b[1], 'ja')),
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
    filterModifiedPreset: 'all',
    filterModifiedFrom: '',
    filterModifiedTo: '',
  });
  return cfg;
}

function _updateFolderDisplayFilterButton(cfg) {
  const btn = document.getElementById('folder-display-filter-btn') || document.querySelector('[data-action="showFolderDisplaySettings()"]');
  if (!btn) return;
  const active = _folderHasActiveFilters(cfg || (typeof getFolderDisplayConfig === 'function' ? getFolderDisplayConfig() : {}));
  btn.dataset.filterActive = active ? 'true' : 'false';
  btn.style.borderColor = active ? 'var(--accent)' : 'var(--border)';
  btn.style.color = active ? 'var(--accent)' : 'var(--fg2)';
  btn.title = active ? '表示/フィルタ（フィルタ適用中）' : '表示/フィルタ';
}

function renderFolderGrid(opts) {
  const renderOpts = opts || {};
  const preserveSelectedPaths = new Set((renderOpts.preserveSelectedPaths || []).filter(Boolean));
  const container = document.getElementById('folder-grid');
  container.innerHTML = '';
  const layoutMap = {grid:'grid-layout', list:'list-layout', waterfall:'waterfall-layout', hflow:'hflow-layout'};
  container.className = layoutMap[_folderLayout] || 'grid-layout';
  _installFolderBlankContextMenu(container);
  document.getElementById('folder-layout-select').value = _folderLayout;
  applyFolderZoom();

  _folderSelectedItems = [];
  _folderSelected = null;
  _updateFolderBulkBar();
  // パネルレイアウトを適用
  applyFvPanelLayout();
  // ウォーターフォール以外: 高さリセット
  if (_folderLayout !== 'waterfall') {
    container.style.height = '';
    const oldSpacer = container.querySelector('.wf-spacer');
    if (oldSpacer) oldSpacer.remove();
  }

  const dcfg = getFolderDisplayConfig();
  const filteredItems = _getFolderFilteredItems();
  _folderVisibleItems = filteredItems;
  _updateFolderDisplayFilterButton(dcfg);
  document.getElementById('folder-item-count').textContent = filteredItems.length + (_folderItems.length !== filteredItems.length ? ' / ' + _folderItems.length : '') + ' 項目';
  const showThumb = dcfg.showThumb !== false;
  const showName = dcfg.showName !== false;
  const showSize = dcfg.showSize !== false;
  const showDate = dcfg.showDate !== false;
  const showType = dcfg.showType !== false;

  if (filteredItems.length === 0) {
    const empty = document.createElement('div');
    empty.style.cssText = 'padding:40px;text-align:center;color:var(--fg2);';
    empty.textContent = _folderItems.length > 0 && _folderHasActiveFilters(dcfg) ? '条件に一致する項目がありません' : 'このフォルダは空です';
    container.appendChild(empty);
    return;
  }

  filteredItems.forEach((item, idx) => {
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

    if (showThumb) {
      const thumb = document.createElement('div');
      thumb.className = 'fv-thumb';
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
        img.src = '/api/file-raw?path=' + encodeURIComponent(item.path);
        img.loading = 'lazy';
        img.onerror = () => { const sp = document.createElement('span'); sp.className='fv-icon'; sp.innerHTML=fileTypeIcon(item.type); img.replaceWith(sp); };
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

    if (showName) {
      const name = document.createElement('div');
      name.className = 'fv-name';
      name.textContent = item.name;
      name.title = item.name;
      name.dataset.gbTooltip = item.name;
      el.appendChild(name);
    }

    const meta = document.createElement('div');
    meta.className = 'fv-meta';
    // リスト表示では表示設定に関わらず全メタデータを常に表示
    const isList = _folderLayout === 'list';
    if ((isList || showSize) && item.size != null) meta.appendChild(Object.assign(document.createElement('span'), {textContent: formatFileSize(item.size)}));
    if ((isList || showDate) && item.modified) meta.appendChild(Object.assign(document.createElement('span'), {textContent: item.modified.substring(0, 16).replace('T', ' ')}));
    if (isList || showType) meta.appendChild(Object.assign(document.createElement('span'), {textContent: FILE_TYPE_LABELS[item.type] || item.ext || ''}));
    if (meta.childNodes.length > 0) el.appendChild(meta);

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
        const startIdx = allItems.findIndex(el2 => el2.classList.contains('selected'));
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

    // 右クリックメニュー
    el.oncontextmenu = (e) => {
      e.preventDefault();
      showFolderItemContextMenu(e, item);
    };

    container.appendChild(el);
  });

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
    openSub.item('ビューワーで開く', () => openViewer('/viewer?file=' + encodeURIComponent(item.path)));
    openSub.item('ボードで開く', () => openImageInCanvas(item));
  }
  if (item.type !== 'folder') addItem('アプリで開く', () => openNative(item.path), null, 'externalLink');
  if (item.type !== 'folder') addItem('チャットを開く', () => openFileChat(item.path), null, 'messageSquare');

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
      else if (!isFav && typeof addToFavorites === 'function') addToFavorites(item.name, item.path, item.type);
    }, null, isFav ? 'starOff' : 'star');
  }

  const exportItems = _folderExportItems(item);
  if (exportItems.length > 0) {
    const exportSub = addSub('エクスポート', typeof uiTransferIconName === 'function' ? uiTransferIconName('export') : 'upload');
    exportItems.forEach(exportItem => {
      exportSub.item(exportItem.label, async () => {
        if (typeof MeldexExportSave === 'undefined' || typeof MeldexExportSave.saveUrl !== 'function') {
          showStatus('保存ダイアログを初期化できませんでした', true);
          return;
        }
        await MeldexExportSave.saveUrl(exportItem.url, {
          filename: exportItem.filename,
          extension: exportItem.extension,
          dialogTitle: `${exportItem.label}として保存`,
          filetypes: exportItem.filetypes,
          okMessage: `${exportItem.label} として保存しました`,
          errorMessage: `${exportItem.label} の保存に失敗しました`,
          path: item.path,
          title: item.name || '無題',
        });
      });
    });
  }

  if (!blankTarget && item.path) {
    addItem('所属フォルダを設定...', () => {
      if (typeof showAddFolderLinkModal === 'function') showAddFolderLinkModal(item.path, null);
    }, null, 'link2');
  }

  if (!blankTarget && item.path && typeof getNodeColor === 'function' && typeof setNodeColor === 'function' && typeof openColorPalette === 'function') {
    addSep();
    const currentColor = getNodeColor(item.path);
    const colorItem = document.createElement('div');
    colorItem.className = 'gb-context-menu-item';
    const swatch = document.createElement('button');
    swatch.type = 'button';
    swatch.className = 'gb-color-swatch gb-color-swatch--inline';
    if (typeof setColorSwatchValue === 'function') setColorSwatchValue(swatch, currentColor || 'var(--fg)');
    colorItem.appendChild(swatch);
    const clbl = document.createElement('span');
    clbl.textContent = '色設定';
    colorItem.appendChild(clbl);
    colorItem.addEventListener('click', () => {
      openColorPalette(swatch, currentColor, (color) => {
        _folderApplyItemColor(item, color || null);
        closeMenu();
      });
    });
    menu.appendChild(colorItem);
  }

  if (!blankTarget && item.type === 'folder' && item.path && typeof getWorkFolder === 'function' && typeof setWorkFolder === 'function') {
    const curWork = getWorkFolder();
    const isWork = curWork === item.path;
    const wfSub = addSub('作品フォルダ', 'folder');
    wfSub.item((isWork ? '✓ ' : '') + '設定する', async () => {
      setWorkFolder(item.path);
      showStatus(`「${item.name}」を作品フォルダに設定しました`);
      if (typeof loadLinkDict === 'function') await loadLinkDict();
      if (typeof tooltipCache !== 'undefined') tooltipCache = {};
      if (typeof loadOutliner === 'function') await loadOutliner();
    });
    wfSub.item((!isWork ? '✓ ' : '') + '解除する', async () => {
      setWorkFolder('');
      showStatus('作品フォルダの設定を解除しました');
      if (typeof loadLinkDict === 'function') await loadLinkDict();
      if (typeof tooltipCache !== 'undefined') tooltipCache = {};
      if (typeof loadOutliner === 'function') await loadOutliner();
    });
  }

  if ((item.type === 'folder' || item.type === 'database') && item.path && typeof getSortForFolder === 'function') {
    const sortSub = addSub('並び替え', 'arrowUpDown');
    const curSort = getSortForFolder(item.path);
    const sortSettingsKey = typeof SORT_SETTINGS_KEY !== 'undefined' ? SORT_SETTINGS_KEY : 'outliner-sort';
    [
      { label: 'マニュアル', sort: 'manual', order: 'asc' },
      { label: '名前 ↑', sort: 'name', order: 'asc' },
      { label: '名前 ↓', sort: 'name', order: 'desc' },
      { label: '更新日時 ↑', sort: 'modified', order: 'asc' },
      { label: '更新日時 ↓', sort: 'modified', order: 'desc' },
      { label: '作成日時 ↑', sort: 'created', order: 'asc' },
      { label: '作成日時 ↓', sort: 'created', order: 'desc' },
    ].forEach(option => {
      const active = curSort.sort === option.sort && curSort.order === option.order;
      sortSub.item((active ? '✓ ' : '') + option.label, async () => {
        const before = typeof captureOutlinerSettingsHistory === 'function' ? captureOutlinerSettingsHistory([sortSettingsKey]) : null;
        setSortSetting(item.path, option.sort, option.order);
        if (typeof pushOutlinerSettingsHistory === 'function') {
          pushOutlinerSettingsHistory('フォルダツリー: 並び替え設定', before, item.path + ' / ' + option.label, [sortSettingsKey]);
        }
        if (item.path === _folderPath) await _folderRefreshCurrentFolder();
        if (typeof loadOutliner === 'function') loadOutliner();
      });
    });
  }

  // --- 管理 ---
  addSep();
  addItem('パスをコピー', () => { navigator.clipboard.writeText(item.path); showStatus('パスをコピーしました'); }, null, 'clipboardList');
  const lockedForEdit = _folderMenuItemLocked(item);
  if (!blankTarget && !lockedForEdit) {
    addItem('リネーム', async () => {
      const newName = await cfPrompt('新しい名前:', item.name);
      if (newName && newName !== item.name) {
        apiPost('/outliner/rename', { old_path: item.path, new_name: newName, type: item.type || 'page' }).then((res) => {
          showStatus('リネーム: ' + newName);
          if (res?.new_path && typeof _renameTreeNode === 'function') _renameTreeNode(item.path, res.new_path, newName);
          if (res?.new_path && typeof renameAppPathReferences === 'function') {
            renameAppPathReferences(item.path, res.new_path, { label: newName, fileId: res.file_id, type: item.type || 'page' });
          }
          // 開いているフォルダ自体をリネームした場合は_folderPathを更新
          if (_folderPath && item.type === 'folder' && item.path === _folderPath && res?.new_path) {
            _folderPath = res.new_path;
          }
          if (_folderPath) openFolder(_folderPath.split('/').pop(), _folderPath);
          if (typeof handleRelocateResponse === 'function') handleRelocateResponse(res);
        }).catch(() => showStatus('リネームに失敗', true));
      }
    }, null, 'pencil');
    addItem('複製', async () => {
      try {
        const res = await apiPost('/outliner/duplicate', { path: item.path });
        showStatus('複製しました: ' + (res.new_name || ''));
        if (_folderPath) openFolder(_folderPath.split('/').pop(), _folderPath);
      } catch { showStatus('複製に失敗しました', true); }
    }, null, 'copy');
    addItem('削除', async () => {
      const targets = (_folderSelectedItems.length > 1 ? _folderSelectedItems : [item])
        .filter(target => !_folderMenuItemLocked(target));
      if (!targets.length) {
        showStatus('編集ロック中の項目は削除できません', true);
        return;
      }
      if (!await cfConfirm(targets.length + ' 件を削除しますか？')) return;
      const result = await deleteOutlinerItemsWithHistory(targets, {
        label: targets.length + ' 件を削除',
        refresh: async () => {
          if (_folderPath) await openFolder(_folderPath.split('/').pop(), _folderPath);
        },
      });
      _folderSelectedItems = [];
      _folderSelected = null;
      _updateFolderBulkBar();
      if (_folderPath) await openFolder(_folderPath.split('/').pop(), _folderPath);
      const deletedCount = result.deletedCount || result.succeeded.length;
      if (result.failedCount > 0) showStatus(`${deletedCount} 件を削除、${result.failedCount} 件は失敗しました`, true);
      else if (deletedCount > 0) showStatus(deletedCount + ' 件を削除しました（Undoで戻せます）');
      else showStatus('削除対象が見つからなかったため、表示を更新しました', true);
    }, 'red', 'trash2');
  }

  if (!blankTarget && item.type === 'database' && item.path && typeof isSplitActive === 'function') {
    addSep();
    if (isSplitActive()) {
      addItem('別の作業領域で開く', () => {
        if (typeof openDbInOtherPane === 'function') openDbInOtherPane(item.path);
      }, null, 'columns');
    } else {
      addItem('スプリットで開く', () => {
        if (typeof openInNewSplit === 'function') openInNewSplit(item.path);
      }, null, 'columns');
    }
  }
  { const z = _getZoom(); menu.style.left = (e.clientX / z) + 'px'; menu.style.top = (e.clientY / z) + 'px'; }
  document.body.appendChild(menu);
  if (typeof clampPopupToViewport === 'function') clampPopupToViewport(menu);
  if (item.path && typeof appendShellVerbsToMenu === 'function') appendShellVerbsToMenu(menu, item.path);
  setTimeout(() => {
    const closer = (ev) => {
      const inAnyMenu = [...document.querySelectorAll('.gb-context-menu')].some(m => m.contains(ev.target));
      if (!inAnyMenu) { closeMenu(); document.removeEventListener('pointerdown', closer); }
    };
    document.addEventListener('pointerdown', closer);
  }, 0);
}

// 画像をキャンバスで開く（リンクのみ保存）
async function openImageInCanvas(item) {
  const dir = _folderPath || (item.path.includes('/') ? item.path.substring(0, item.path.lastIndexOf('/')) : '');
  let boardName = item.name.replace(/\.[^.]+$/, '') + '_canvas';
  let boardPath = dir + '/' + boardName + '.md';
  // 衝突回避: 同名ファイルが存在する場合は連番
  for (let i = 1; i <= 100; i++) {
    try { await apiFetch('/file?path=' + encodeURIComponent(boardPath)); boardName = item.name.replace(/\.[^.]+$/, '') + '_canvas_' + i; boardPath = dir + '/' + boardName + '.md'; }
    catch { break; } // 404 = 存在しない = OK
  }
  const imgUrl = '/api/file-raw?path=' + encodeURIComponent(item.path);
  const content = '---\ntype: board\npositions:\n  n0: {x: 100, y: 100}\nsizes:\n  n0: {w: 400, h: 0}\n---\n# [img]' + imgUrl + '\n';
  try {
    await apiPut('/file?path=' + encodeURIComponent(boardPath), { content });
    openBoard(boardName, boardPath, { fromExplorer: true });
    showStatus('ボードを作成しました');
  } catch (e) { showStatus('ボード作成に失敗', true); }
}

// 複数画像をキャンバスに並べて開く
async function openImagesInCanvas(items) {
  const dir = _folderPath || '';
  let boardName = 'images_canvas_' + new Date().toISOString().substring(0,10);
  let boardPath = dir + '/' + boardName + '.md';
  // 衝突回避
  for (let i = 1; i <= 100; i++) {
    try { await apiFetch('/file?path=' + encodeURIComponent(boardPath)); boardName = 'images_canvas_' + new Date().toISOString().substring(0,10) + '_' + i; boardPath = dir + '/' + boardName + '.md'; }
    catch { break; }
  }

  // グリッド配置: 1行あたり4枚、300px間隔
  const cols = 4, gapX = 320, gapY = 280;
  let fm = '---\ntype: board\npositions:\n';
  items.forEach((it, i) => {
    const col = i % cols, row = Math.floor(i / cols);
    fm += `  n${i}: {x: ${100 + col * gapX}, y: ${100 + row * gapY}}\n`;
  });
  fm += 'sizes:\n';
  items.forEach((it, i) => { fm += `  n${i}: {w: 280, h: 0}\n`; });
  fm += '---\n';
  items.forEach((it, i) => {
    const imgUrl = '/api/file-raw?path=' + encodeURIComponent(it.path);
    fm += `# [img]${imgUrl}\n${it.name}\n`;
  });

  try {
    await apiPut('/file?path=' + encodeURIComponent(boardPath), { content: fm });
    openBoard(boardName, boardPath, { fromExplorer: true });
    showStatus(items.length + '枚の画像をボードに配置しました');
  } catch (e) { showStatus('ボード作成に失敗', true); }
}

// チェックボックスの状態を選択状態と同期
function _syncFolderCheckboxes() {
  const grid = document.getElementById('folder-grid');
  if (!grid) return;
  grid.querySelectorAll('.fv-item').forEach(el => {
    const chk = el.querySelector('.fv-check');
    if (chk) chk.checked = el.classList.contains('selected');
  });
}

function _folderBulkAnchorRect() {
  const selectedEls = Array.from(document.querySelectorAll('#folder-grid .fv-item.selected'));
  const lastSelected = selectedEls[selectedEls.length - 1] || null;
  const anchor = lastSelected || document.getElementById('folder-display-filter-btn') || document.getElementById('folder-grid');
  return anchor?.getBoundingClientRect?.() || { left: 16, right: 16, top: 48, bottom: 48 };
}

function _positionFolderBulkPopup() {
  const bar = document.getElementById('fv-bulk-bar');
  if (!bar || !bar.classList.contains('visible')) return;
  bar.style.maxHeight = '';
  bar.style.overflowY = '';
  if (typeof positionPopup === 'function') {
    positionPopup(bar, _folderBulkAnchorRect(), { prefer: 'below', gap: 6 });
  } else if (typeof clampPopupToViewport === 'function') {
    const rect = _folderBulkAnchorRect();
    const z = typeof _getZoom === 'function' ? _getZoom() : 1;
    bar.style.left = (rect.left / z) + 'px';
    bar.style.top = (rect.bottom / z + 6) + 'px';
    clampPopupToViewport(bar);
  }
}

function _scheduleFolderBulkPopupPosition() {
  if (_folderBulkPopupRaf) return;
  _folderBulkPopupRaf = requestAnimationFrame(() => {
    _folderBulkPopupRaf = 0;
    _positionFolderBulkPopup();
  });
}

function _setFolderBulkPopupTracking(enabled) {
  if (enabled && !_folderBulkPopupTracking) {
    _folderBulkPopupTracking = true;
    window.addEventListener('resize', _scheduleFolderBulkPopupPosition);
    document.addEventListener('scroll', _scheduleFolderBulkPopupPosition, true);
  } else if (!enabled && _folderBulkPopupTracking) {
    _folderBulkPopupTracking = false;
    window.removeEventListener('resize', _scheduleFolderBulkPopupPosition);
    document.removeEventListener('scroll', _scheduleFolderBulkPopupPosition, true);
    if (_folderBulkPopupRaf) {
      cancelAnimationFrame(_folderBulkPopupRaf);
      _folderBulkPopupRaf = 0;
    }
  }
}

// 一括操作ポップアップの表示/非表示更新
function _updateFolderBulkBar() {
  const bar = document.getElementById('fv-bulk-bar');
  if (!bar) return;
  if (_folderSelectedItems.length > 0) {
    bar.classList.add('visible');
    bar.setAttribute('aria-hidden', 'false');
    const cnt = bar.querySelector('.fv-bulk-count');
    if (cnt) cnt.textContent = _folderSelectedItems.length + ' 件選択中';
    _positionFolderBulkPopup();
    _setFolderBulkPopupTracking(true);
  } else {
    bar.classList.remove('visible');
    bar.setAttribute('aria-hidden', 'true');
    bar.style.left = '';
    bar.style.top = '';
    bar.style.maxHeight = '';
    bar.style.overflowY = '';
    _setFolderBulkPopupTracking(false);
  }
}

// 一括操作: スライドショー
function fvBulkSlideshow() {
  const imgItems = _folderSelectedItems.filter(i => i.type === 'image');
  if (imgItems.length === 0) { showStatus('画像が選択されていません', true); return; }
  openViewer('/viewer?files=' + encodeURIComponent(JSON.stringify(imgItems.map(i => i.path))));
}

// 一括操作: ボードに並べる
function fvBulkBoard() {
  const imgItems = _folderSelectedItems.filter(i => i.type === 'image');
  if (imgItems.length === 0) { showStatus('画像が選択されていません', true); return; }
  openImagesInCanvas(imgItems);
}

// 一括操作: 削除
async function fvBulkDelete() {
  const targets = _folderSelectedItems.filter(item => !_folderMenuItemLocked(item));
  if (targets.length === 0) {
    showStatus('編集ロック中の項目は削除できません', true);
    return;
  }
  if (!await cfConfirm(targets.length + ' 件を削除しますか？')) return;
  const result = await deleteOutlinerItemsWithHistory(targets, {
    label: targets.length + ' 件を削除',
    refresh: async () => {
      if (_folderPath) await openFolder(_folderPath.split('/').pop(), _folderPath);
    },
  });
  _folderSelectedItems = [];
  _folderSelected = null;
  _updateFolderBulkBar();
  if (_folderPath) await openFolder(_folderPath.split('/').pop(), _folderPath);
  const deletedCount = result.deletedCount || result.succeeded.length;
  if (result.failedCount > 0) showStatus(`${deletedCount} 件を削除、${result.failedCount} 件は失敗しました`, true);
  else if (deletedCount > 0) showStatus(deletedCount + ' 件を削除しました（Undoで戻せます）');
  else showStatus('削除対象が見つからなかったため、表示を更新しました', true);
}

// 一括操作: パスをコピー
function fvBulkCopyPath() {
  const paths = _folderSelectedItems.map(i => i.path).join('\n');
  navigator.clipboard.writeText(paths);
  showStatus(_folderSelectedItems.length + ' 件のパスをコピーしました');
}

// 一括操作: 選択解除
function fvBulkDeselect() {
  document.querySelectorAll('.fv-item.selected').forEach(s => s.classList.remove('selected'));
  _folderSelectedItems = [];
  _folderSelected = null;
  _syncFolderCheckboxes();
  _updateFolderBulkBar();
}

function _folderKeyboardEventFromTextEditor(event) {
  const target = event?.target instanceof Element ? event.target : document.activeElement;
  const active = document.activeElement instanceof Element ? document.activeElement : target;
  return !!(
    target?.closest?.('input, textarea, select, [contenteditable="true"], [role="textbox"]') ||
    active?.closest?.('input, textarea, select, [contenteditable="true"], [role="textbox"]')
  );
}

// フォルダビュー: 空域クリックで選択解除
document.getElementById('folder-grid').addEventListener('click', function(e) {
  // ラッソドラッグ直後の合成 click はスキップ（せっかく選択したものを解除させない）
  if (_lassoJustCompleted) return;
  if (e.target === this) {
    document.querySelectorAll('.fv-item.selected').forEach(s => s.classList.remove('selected'));
    _folderSelectedItems = [];
    _folderSelected = null;
    _syncFolderCheckboxes();
    _updateFolderBulkBar();
  }
});

// フォルダビュー: キーボード操作
// 離散ショートカット（Ctrl+A, Delete, F2, Enter）→ gb-shortcuts.js に移行済み
// 矢印キーのグリッドナビゲーションのみ残存
document.addEventListener('keydown', function(e) {
  if (e.defaultPrevented) return;
  if (state.view !== 'folder') return;
  if (_folderKeyboardEventFromTextEditor(e)) return;

  if (e.key === 'ArrowRight' || e.key === 'ArrowLeft' || e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    const grid = document.getElementById('folder-grid');
    const items = Array.from(grid.querySelectorAll('.fv-item'));
    if (items.length === 0) return;
    const curIdx = _folderSelected ? items.findIndex(el => el.classList.contains('selected')) : -1;
    let cols = 1;
    if (items.length > 1) {
      const firstTop = items[0].getBoundingClientRect().top;
      for (let i = 1; i < items.length; i++) {
        if (items[i].getBoundingClientRect().top > firstTop + 5) { cols = i; break; }
      }
      if (cols === 1 && items.length > 1 && items[1].getBoundingClientRect().top <= firstTop + 5) cols = items.length;
    }
    let nextIdx = curIdx;
    if (e.key === 'ArrowRight') nextIdx = Math.min(items.length - 1, curIdx + 1);
    else if (e.key === 'ArrowLeft') nextIdx = Math.max(0, curIdx - 1);
    else if (e.key === 'ArrowDown') nextIdx = Math.min(items.length - 1, curIdx + cols);
    else if (e.key === 'ArrowUp') nextIdx = Math.max(0, curIdx - cols);
    if (nextIdx < 0) nextIdx = 0;
    const filteredItems = _folderVisibleItems.length ? _folderVisibleItems : _getFolderFilteredItems();
    items.forEach(el => el.classList.remove('selected'));
    items[nextIdx].classList.add('selected');
    items[nextIdx].scrollIntoView({ block: 'nearest' });
    const item = filteredItems[parseInt(items[nextIdx].dataset.idx)];
    if (item) { _folderSelected = item; _folderSelectedItems = [item]; }
    _syncFolderCheckboxes();
    _updateFolderBulkBar();
    showStatus(item ? item.name : '');
  }
});

// ラッソ（矩形ドラッグ）選択
let _lassoJustCompleted = false;
{
  const grid = document.getElementById('folder-grid');
  let _lassoActive = false, _lassoRect = null, _lassoStartX = 0, _lassoStartY = 0;
  let _lassoPreSelected = []; // ラッソ開始前の選択状態
  let _lassoMoved = false;
  grid.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    if (e.target.closest('.fv-item')) return;
    _lassoActive = true;
    _lassoMoved = false;
    // Ctrl+ドラッグ: 既存選択を保持
    _lassoPreSelected = (e.ctrlKey || e.metaKey) ? [..._folderSelectedItems] : [];
    const gr = grid.getBoundingClientRect();
    _lassoStartX = e.clientX - gr.left + grid.scrollLeft;
    _lassoStartY = e.clientY - gr.top + grid.scrollTop;
    _lassoRect = document.createElement('div');
    _lassoRect.style.cssText = 'position:absolute;border:1px solid var(--accent);background:rgba(86,156,214,0.15);pointer-events:none;z-index:10;';
    grid.style.position = 'relative';
    grid.appendChild(_lassoRect);
    grid.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  grid.addEventListener('pointermove', (e) => {
    if (!_lassoActive || !_lassoRect) return;
    const gr = grid.getBoundingClientRect();
    const curX = e.clientX - gr.left + grid.scrollLeft;
    const curY = e.clientY - gr.top + grid.scrollTop;
    const x = Math.min(_lassoStartX, curX), y = Math.min(_lassoStartY, curY);
    const w = Math.abs(curX - _lassoStartX), h = Math.abs(curY - _lassoStartY);
    if (w > 2 || h > 2) _lassoMoved = true;
    _lassoRect.style.left = x + 'px'; _lassoRect.style.top = y + 'px';
    _lassoRect.style.width = w + 'px'; _lassoRect.style.height = h + 'px';
    const selRect = { left: x, top: y, right: x + w, bottom: y + h };
    // 既存選択 + ラッソ矩形内のアイテムを合算
    _folderSelectedItems = [..._lassoPreSelected];
    grid.querySelectorAll('.fv-item').forEach(el => {
      const er = el.getBoundingClientRect();
      const elX = er.left - gr.left + grid.scrollLeft, elY = er.top - gr.top + grid.scrollTop;
      const overlap = !(elX + er.width < selRect.left || elX > selRect.right || elY + er.height < selRect.top || elY > selRect.bottom);
      const visibleItems = _folderVisibleItems.length ? _folderVisibleItems : _getFolderFilteredItems();
      const it = visibleItems?.[parseInt(el.dataset.idx)];
      const wasPreSelected = it && _lassoPreSelected.includes(it);
      el.classList.toggle('selected', overlap || wasPreSelected);
      if (overlap && it && !_folderSelectedItems.includes(it)) _folderSelectedItems.push(it);
    });
    if (_folderSelectedItems.length > 1) showStatus(_folderSelectedItems.length + ' 件選択中');
  });
  const _endLasso = () => {
    if (!_lassoActive) return;
    _lassoActive = false;
    if (_lassoRect) { _lassoRect.remove(); _lassoRect = null; }
    _syncFolderCheckboxes();
    _updateFolderBulkBar();
    // 直後に発火する click イベントで「空域クリック → 選択解除」が走るのを抑止するため、
    // ラッソでドラッグが発生した場合はフラグを立てて 1 ティック保持する。
    if (_lassoMoved) {
      _lassoJustCompleted = true;
      setTimeout(() => { _lassoJustCompleted = false; }, 0);
    }
    _lassoMoved = false;
  };
  grid.addEventListener('pointerup', _endLasso);
  grid.addEventListener('pointercancel', _endLasso);
}

// Ctrl+ホイールでフォルダビューのズーム
document.getElementById('folder-grid').addEventListener('wheel', function(e) {
  if (!e.ctrlKey) return;
  e.preventDefault();
  _folderZoom = Math.max(0.5, Math.min(3, _folderZoom * (e.deltaY > 0 ? 0.9 : 1.1)));
  localStorage.setItem('folder-zoom', _folderZoom);
  applyFolderZoom();
}, {passive: false});

function openFolderItem(item) {
  const _expOpts = { fromExplorer: true };
  if (item.type === 'folder') { openFolder(item.name, item.path, _expOpts); }
  else if (item.type === 'database') { selectDatabase(item.path, null, _expOpts); }
  else if (item.type === 'page') { openPage(item.name, item.path, _expOpts); }
  else if (item.type === 'scriptnote' || item.type === 'scenario' || (typeof isScriptNotePath === 'function' && isScriptNotePath(item.path))) { if (typeof openScenarioInScriptNote === 'function') openScenarioInScriptNote(item.path, item.name || item.path, _expOpts); }
  else if (item.type === 'board') { openBoard(item.name, item.path, _expOpts); }
  else if (item.type === 'calendar') { openCalendarFile(item.name, item.path, _expOpts); }
  else if (item.type === 'chat') { openSavedChat(item.path); }
  else if (item.type === 'image' || item.type === 'video' || item.type === 'audio') { openMedia(item.name, item.path, item.type, _expOpts); }
  else if (item.type === 'html') { openHtmlFile(item.name, item.path, _expOpts); }
  else if (item.type === 'csv') { if (typeof openCsvFile === 'function') openCsvFile(item.name, item.path, _expOpts); else openPage(item.name, item.path, _expOpts); }
  else if (item.type === 'document' && item.name && item.name.toLowerCase().endsWith('.pdf')) {
    openViewer('/viewer?pdf=' + encodeURIComponent(item.path));
  }
  else { openNative(item.path); }
}

// パネル配置設定（フォルダごとに保存、子フォルダに継承）
function _getFvPanelCfg() {
  // 現在のフォルダ→親フォルダ→ルートの順で設定を探す
  let path = _folderPath || '';
  while (path) {
    // file_id キーを優先
    const fid = _pathToFileId(path);
    if (fid) { try { const cfg = JSON.parse(localStorage.getItem('fv-panel-cfg:' + fid)); if (cfg && Object.keys(cfg).length > 0) return cfg; } catch {} }
    try { const cfg = JSON.parse(localStorage.getItem('fv-panel-cfg:' + path)); if (cfg && Object.keys(cfg).length > 0) return cfg; } catch {}
    // 親パスへ
    const lastSlash = path.replace(/\\/g, '/').lastIndexOf('/');
    path = lastSlash > 0 ? path.substring(0, lastSlash) : '';
  }
  // デフォルト
  try { const cfg = JSON.parse(localStorage.getItem('fv-panel-cfg:')); if (cfg) return cfg; } catch {}
  return {};
}
function _saveFvPanelCfg(cfg) {
  const fid = _pathToFileId(_folderPath);
  localStorage.setItem('fv-panel-cfg:' + (fid || _folderPath || ''), JSON.stringify(cfg));
}
function _getFvPanelPos(type) {
  const cfg = _getFvPanelCfg();
  if (type === 'preview') return cfg.previewPos || 'right';
  return cfg.detailPos || 'right';
}
function _getFvPanelSize(type) {
  const cfg = _getFvPanelCfg();
  return (type === 'preview' ? cfg.previewSize : cfg.detailSize) || 300;
}
function _getFvPanelVisible(type) {
  const cfg = _getFvPanelCfg();
  return type === 'preview' ? (cfg.previewVisible ?? false) : (cfg.detailVisible ?? false);
}

// パネルID → DOM要素
function _panelEl(pos) { return document.getElementById('fv-panel-' + pos); }
function _resizeEl(pos) { return document.getElementById('fv-resize-' + pos); }

// パネルレイアウトを適用
function applyFvPanelLayout() {
  const previewPos = _getFvPanelPos('preview');
  const detailPos = _getFvPanelPos('detail');
  const previewVisible = _getFvPanelVisible('preview');
  const detailVisible = _getFvPanelVisible('detail');
  const previewSize = _getFvPanelSize('preview');
  const detailSize = _getFvPanelSize('detail');

  // 全パネル・リサイズハンドルを非表示
  ['top','bottom','left','right'].forEach(pos => {
    const p = _panelEl(pos); if (p) { p.style.display = 'none'; p.innerHTML = ''; p._panelType = null; }
    const r = _resizeEl(pos); if (r) r.style.display = 'none';
  });

  // 同じ場所の場合は統合（プレビューが先）
  const sameSide = previewPos === detailPos;

  // プレビューパネル配置
  if (previewVisible) {
    const el = _panelEl(previewPos);
    if (el) {
      el.style.display = '';
      el._panelType = sameSide ? 'both' : 'preview';
      _applyPanelSize(el, previewPos, previewSize);
      const r = _resizeEl(previewPos); if (r) r.style.display = '';
    }
  }

  // 詳細パネル配置
  if (detailVisible) {
    if (sameSide && previewVisible) {
      // 統合: プレビューパネルに追加
      const el = _panelEl(detailPos);
      if (el) el._panelType = 'both';
    } else {
      const el = _panelEl(detailPos);
      if (el) {
        el.style.display = '';
        el._panelType = 'detail';
        _applyPanelSize(el, detailPos, detailSize);
        const r = _resizeEl(detailPos); if (r) r.style.display = '';

/* Source chunk: gb-folder.part02.js */
      }
    }
  }
}

function _applyPanelSize(el, pos, size) {
  if (pos === 'left' || pos === 'right') {
    el.style.width = size + 'px'; el.style.height = '';
  } else {
    el.style.height = size + 'px'; el.style.width = '';
  }
}

// プレビューコンテンツを生成
function _renderPreviewContent(item) {
  const frag = document.createDocumentFragment();
  // 画像・PDF → viewer.htmlをiframeで埋め込み
  const isPdf = item.name && item.name.toLowerCase().endsWith('.pdf');
  if (item.type === 'image' || isPdf) {
    const iframe = document.createElement('iframe');
    iframe.style.cssText = 'width:100%;height:100%;min-height:300px;border:none;border-radius:4px;';
    if (isPdf) {
      iframe.src = '/viewer?pdf=' + encodeURIComponent(item.path) + '&embed=1';
    } else {
      iframe.src = '/viewer?file=' + encodeURIComponent(item.path) + '&embed=1';
    }
    frag.appendChild(iframe);
  } else if (item.type === 'audio') {
    const audio = document.createElement('audio');
    audio.controls = true;
    audio.style.cssText = 'width:100%;margin-bottom:8px;';
    audio.src = '/api/file-raw?path=' + encodeURIComponent(item.path);
    frag.appendChild(audio);
  } else if (item.type === 'video') {
    const video = document.createElement('video');
    video.controls = true;
    video.style.cssText = 'width:100%;max-height:100%;margin-bottom:8px;border-radius:4px;object-fit:contain;';
    video.src = '/api/file-raw?path=' + encodeURIComponent(item.path);
    frag.appendChild(video);
  } else if (['3d','psd','clip','document'].includes(item.type)) {
    const img = document.createElement('img');
    img.className = 'fp-img';
    img.src = '/api/thumbnail?path=' + encodeURIComponent(item.path) + '&size=512';
    img.onerror = () => {
      const icon = document.createElement('div');
      icon.style.cssText = 'text-align:center;margin:16px 0;color:var(--fg2);';
      icon.innerHTML = fileTypeIcon(item.type, 48);
      img.replaceWith(icon);
    };
    frag.appendChild(img);
  } else {
    const icon = document.createElement('div');
    icon.style.cssText = 'text-align:center;margin:16px 0;color:var(--fg2);';
    icon.innerHTML = fileTypeIcon(item.type, 48);
    frag.appendChild(icon);
  }
  return frag;
}

// 詳細コンテンツを生成
function _renderDetailContent(item) {
  const frag = document.createDocumentFragment();

  // タイトル
  const title = document.createElement('div');
  title.className = 'fp-title';
  title.textContent = item.name;
  frag.appendChild(title);

  // メタデータ
  const meta = document.createElement('div');
  meta.className = 'fp-meta';
  const rows = [
    ['タイプ', FILE_TYPE_LABELS[item.type] || item.ext || 'unknown'],
    ['パス', item.path],
  ];
  if (item.size != null) rows.push(['サイズ', formatFileSize(item.size)]);
  if (item.modified) rows.push(['更新日時', item.modified.substring(0, 19).replace('T', ' ')]);
  if (item.type === 'image') rows.push(['解像度', '']); // onloadで更新
  rows.forEach(([k, v]) => {
    const row = document.createElement('div');
    row.className = 'fp-meta-row';
    const kSpan = document.createElement('span');
    kSpan.textContent = k;
    const vSpan = document.createElement('span');
    vSpan.style.textAlign = 'right';
    vSpan.style.wordBreak = 'break-all';
    vSpan.textContent = v;
    if (k === '解像度') vSpan.className = 'fp-img-dim';
    row.appendChild(kSpan);
    row.appendChild(vSpan);
    meta.appendChild(row);
  });
  frag.appendChild(meta);

  // アクションボタン
  const actions = document.createElement('div');
  actions.className = 'fp-actions';
  if (NATIVE_TYPES.has(item.type)) {
    const b = document.createElement('button');
    b.textContent = 'Meldexで開く';
    b.addEventListener('click', () => openFolderItem(item));
    actions.appendChild(b);
  }
  if (item.type !== 'folder') {
    const b = document.createElement('button');
    b.textContent = 'アプリで開く';
    b.addEventListener('click', () => openNative(item.path));
    actions.appendChild(b);
  }
  if (item.type === 'folder') {
    const b = document.createElement('button');
    b.innerHTML = lucide('play', 12) + ' スライドショー';
    b.addEventListener('click', () => openViewer('/viewer?folder=' + encodeURIComponent(item.path)));
    actions.appendChild(b);
  }
  if (item.name && item.name.toLowerCase().endsWith('.pdf')) {
    const b = document.createElement('button');
    b.innerHTML = lucide('play', 12) + ' PDFビューワー';
    b.addEventListener('click', () => openViewer('/viewer?pdf=' + encodeURIComponent(item.path)));
    actions.appendChild(b);
  }
  frag.appendChild(actions);

  // 所属フォルダ
  if (item.path) {
    const sec = document.createElement('div');
    sec.style.marginTop = '12px';
    const lbl = document.createElement('div');
    lbl.style.cssText = 'font-size:12px;color:var(--fg2);margin-bottom:4px;';
    lbl.textContent = '所属フォルダ:';
    sec.appendChild(lbl);
    const tags = document.createElement('div');
    tags.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;';
    sec.appendChild(tags);
    frag.appendChild(sec);
    loadFileFolderTags(item.path, tags);
  }
  return frag;
}

function showFolderPreview(item) {
  if (!item) return;

  // v5.0: プレビュータブにプレビュー表示
  const previewPane = document.getElementById('gb-preview-pane');
  if (previewPane && previewPane.closest('.gb-pane-content')) {
    // 白フラッシュ防止: 同種のコンテンツならsrc更新のみ
    const isPdf = item.name && item.name.toLowerCase().endsWith('.pdf');
    const existingIframe = previewPane.querySelector('iframe');
    if ((item.type === 'image' || isPdf) && existingIframe) {
      const newSrc = isPdf
        ? '/viewer?pdf=' + encodeURIComponent(item.path) + '&embed=1'
        : '/viewer?file=' + encodeURIComponent(item.path) + '&embed=1';
      existingIframe.src = newSrc;
    } else {
      previewPane.innerHTML = '';
      previewPane.appendChild(_renderPreviewContent(item));
    }
  }

  // v5.0: 詳細タブに詳細表示
  const detailPane = document.getElementById('rp-detail');
  if (detailPane && detailPane.closest('.gb-pane-content')) {
    detailPane.innerHTML = '';
    const header = document.createElement('div');
    header.style.cssText = 'padding:8px 12px;border-bottom:1px solid var(--border);font-size:14px;font-weight:bold;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
    header.textContent = item.name;
    detailPane.appendChild(header);
    const body = document.createElement('div');
    body.style.cssText = 'padding:12px;overflow-y:auto;flex:1;';
    body.appendChild(_renderDetailContent(item));
    detailPane.appendChild(body);
  }
}

// パネル配置設定ドロップダウン
function showFolderPanelSettings() {
  document.querySelectorAll('.fv-panel-dropdown').forEach(el => el.remove());
  const cfg = _getFvPanelCfg();
  const menu = document.createElement('div');
  menu.className = 'fv-panel-dropdown gb-context-menu';
  const sides = [{v:'right',l:'右'},{v:'left',l:'左'},{v:'top',l:'上'},{v:'bottom',l:'下'}];

  // プレビュー表示/位置
  const pH = document.createElement('div');
  pH.style.cssText = 'padding:6px 14px;font-size:12px;font-weight:bold;color:var(--accent);';
  pH.textContent = 'プレビュー';
  menu.appendChild(pH);
  const pVis = cfg.previewVisible ?? true;
  const pVisItem = document.createElement('div');
  pVisItem.className = 'gb-context-menu-item';
  pVisItem.innerHTML = (pVis ? lucide('checkSquare', 12) + ' ' : '　') + '表示';
  pVisItem.addEventListener('click', () => { cfg.previewVisible = !pVis; _saveFvPanelCfg(cfg); showFolderPanelSettings(); if (_folderSelected) showFolderPreview(_folderSelected); });
  menu.appendChild(pVisItem);
  sides.forEach(s => {
    const it = document.createElement('div');
    it.className = 'gb-context-menu-item';
    it.innerHTML = radioMark((cfg.previewPos || 'right') === s.v) + s.l;
    it.addEventListener('click', () => { cfg.previewPos = s.v; _saveFvPanelCfg(cfg); menu.remove(); if (_folderSelected) showFolderPreview(_folderSelected); });
    menu.appendChild(it);
  });

  // 区切り
  const sep = document.createElement('div');
  sep.className = 'gb-context-menu-sep';
  menu.appendChild(sep);

  // 詳細表示/位置
  const dH = document.createElement('div');
  dH.style.cssText = 'padding:6px 14px;font-size:12px;font-weight:bold;color:var(--accent);';
  dH.textContent = 'オプション';
  menu.appendChild(dH);
  const dVis = cfg.detailVisible ?? true;
  const dVisItem = document.createElement('div');
  dVisItem.className = 'gb-context-menu-item';
  dVisItem.innerHTML = (dVis ? lucide('checkSquare', 12) + ' ' : '　') + '表示';
  dVisItem.addEventListener('click', () => { cfg.detailVisible = !dVis; _saveFvPanelCfg(cfg); showFolderPanelSettings(); if (_folderSelected) showFolderPreview(_folderSelected); });
  menu.appendChild(dVisItem);
  sides.forEach(s => {
    const it = document.createElement('div');
    it.className = 'gb-context-menu-item';
    it.innerHTML = radioMark((cfg.detailPos || 'right') === s.v) + s.l;
    it.addEventListener('click', () => { cfg.detailPos = s.v; _saveFvPanelCfg(cfg); menu.remove(); if (_folderSelected) showFolderPreview(_folderSelected); });
    menu.appendChild(it);
  });

  // 位置: ボタンの下に表示（v5.0: ボタンが廃止されている場合はマウス位置にフォールバック）
  const btn = document.querySelector('[data-action="showFolderPanelSettings()"]');
  const rect = btn ? btn.getBoundingClientRect() : { left: window.innerWidth / 2, bottom: window.innerHeight / 2 };
  menu.style.position = 'fixed';
  { const z = _getZoom(); menu.style.left = (rect.left / z) + 'px'; menu.style.top = (rect.bottom / z + 2) + 'px'; }
  document.body.appendChild(menu);
  clampPopupToViewport(menu);
  setTimeout(() => {
    const closer = (ev) => { if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener('pointerdown', closer); } };
    document.addEventListener('pointerdown', closer);
  }, 0);
}

function _bindFolderPanelSettingsButton() {
  const btn = document.querySelector('[data-action="showFolderPanelSettings()"]');
  if (!btn || btn._folderPanelSettingsBound) return;
  btn._folderPanelSettingsBound = true;
  btn.addEventListener('click', (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    showFolderPanelSettings();
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', _bindFolderPanelSettingsButton);
} else {
  _bindFolderPanelSettingsButton();
}

// リサイズハンドルの初期化
(function() {
  ['top','bottom','left','right'].forEach(pos => {
    const handle = document.getElementById('fv-resize-' + pos);
    if (!handle) return;
    const isV = pos === 'left' || pos === 'right';
    let startPos, startSize, panel;
    handle.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      panel = _panelEl(pos);
      if (!panel) return;
      startPos = isV ? e.clientX : e.clientY;
      startSize = isV ? panel.offsetWidth : panel.offsetHeight;
      handle.style.background = 'var(--accent)';
      // iframe がドラッグイベントを吸収するのを防止
      document.querySelectorAll('iframe').forEach(f => f.style.pointerEvents = 'none');
      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);
    });
    function onMove(e) {
      const delta = (isV ? e.clientX : e.clientY) - startPos;
      const sign = (pos === 'right' || pos === 'bottom') ? -1 : 1;
      const newSize = Math.max(100, Math.min(800, startSize + delta * sign));
      if (isV) panel.style.width = newSize + 'px';
      else panel.style.height = newSize + 'px';
    }
    function onUp() {
      handle.style.background = '';
      document.querySelectorAll('iframe').forEach(f => f.style.pointerEvents = '');
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      // サイズを保存
      const cfg = _getFvPanelCfg();
      const size = isV ? panel.offsetWidth : panel.offsetHeight;
      // どのタイプのパネルかを判定
      if (panel._panelType === 'preview' || panel._panelType === 'both') cfg.previewSize = size;
      if (panel._panelType === 'detail') cfg.detailSize = size;
      _saveFvPanelCfg(cfg);
    }
  });
})();

function _refreshFolderLinkUi(filePath, folderPath, tagsContainer) {
  if (tagsContainer) loadFileFolderTags(filePath, tagsContainer);
  if (typeof loadOutliner === 'function') loadOutliner();
  if (folderPath && _folderPath === folderPath && typeof openFolder === 'function') {
    openFolder(folderPath.split('/').pop() || folderPath, folderPath, {
      skipNavPush: true,
      skipSaveLastView: true,
      skipHighlight: true,
      fromExplorer: true,
    });
  }
}

function _pushFolderLinkHistory(label, filePath, fileId, folderPath, folderId, tagsContainer, detail) {
  if (typeof historyPush !== 'function' || !fileId || (!folderPath && !folderId)) return false;
  const removePayload = { file_id: fileId };
  if (folderId) removePayload.folder_id = folderId;
  else removePayload.folder_path = folderPath;
  const addPayload = { file_path: filePath };
  if (folderId) addPayload.folder_id = folderId;
  else addPayload.folder_path = folderPath;
  historyPush(
    label,
    async () => {
      if (label.includes('登録')) await apiPost('/folder-links/remove', removePayload);
      else await apiPost('/folder-links/add', addPayload);
      _refreshFolderLinkUi(filePath, folderPath, tagsContainer);
    },
    async () => {
      if (label.includes('登録')) await apiPost('/folder-links/add', addPayload);
      else await apiPost('/folder-links/remove', removePayload);
      _refreshFolderLinkUi(filePath, folderPath, tagsContainer);
    },
    '',
    detail || ''
  );
  return true;
}

async function addFolderLinkWithHistory(filePath, folderPath, options = {}) {
  const folderId = options.folderId || '';
  const tagsContainer = options.tagsContainer || null;
  const payload = { file_path: filePath };
  if (folderId) payload.folder_id = folderId;
  else payload.folder_path = folderPath;
  const res = await apiPost('/folder-links/add', payload);
  const fileId = res?.file_id || options.fileId || '';
  const resolvedFolderPath = res?.folder_path || folderPath || '';
  const resolvedFolderId = res?.folder_id || folderId || '';
  if (res?.created !== false) {
    _pushFolderLinkHistory(
      '所属フォルダリンク: 登録',
      filePath,
      fileId,
      resolvedFolderPath,
      resolvedFolderId,
      tagsContainer,
      (filePath || '') + ' → ' + (resolvedFolderPath || resolvedFolderId)
    );
  }
  _refreshFolderLinkUi(filePath, resolvedFolderPath, tagsContainer);
  return res;
}

async function removeFolderLinkWithHistory(filePath, fileId, folderPath, options = {}) {
  const folderId = options.folderId || '';
  const tagsContainer = options.tagsContainer || null;
  const payload = { file_id: fileId };
  if (folderId) payload.folder_id = folderId;
  else payload.folder_path = folderPath;
  const res = await apiPost('/folder-links/remove', payload);
  if (res?.removed !== false) {
    _pushFolderLinkHistory(
      '所属フォルダリンク: 解除',
      filePath,
      fileId,
      folderPath || '',
      folderId,
      tagsContainer,
      (filePath || '') + ' ← ' + (folderPath || folderId)
    );
  }
  _refreshFolderLinkUi(filePath, folderPath || '', tagsContainer);
  return res;
}

async function loadFileFolderTags(filePath, container) {
  try {
    const folders = await apiFetch('/file-folders?path=' + encodeURIComponent(filePath));
    container.innerHTML = '';
    folders.forEach(f => {
      const tag = document.createElement('span');
      tag.style.cssText = 'display:inline-flex;align-items:center;gap:3px;padding:2px 8px;border-radius:10px;font-size:11px;background:rgba(255,255,255,0.08);color:var(--fg);cursor:pointer;';
      const name = f.folder.split('/').pop() || f.folder;
      tag.textContent = (f.type === 'link' ? '\u2197 ' : '') + name;
      tag.title = f.folder + '（クリックで開く）';
      tag.dataset.gbTooltip = f.folder + '（クリックで開く）';
      tag.addEventListener('click', () => openFolder(name, f.folder, { fromExplorer: true }));
      // リンクフォルダは解除ボタン付き
      if (f.type === 'link' && f.file_id) {
        const removeBtn = document.createElement('span');
        removeBtn.textContent = '\u00d7';
        removeBtn.style.cssText = 'cursor:pointer;color:var(--fg2);margin-left:2px;';
        removeBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          await removeFolderLinkWithHistory(filePath, f.file_id, f.folder, { tagsContainer: container });
          showStatus('リンク解除しました');
        });
        tag.appendChild(removeBtn);
      }
      container.appendChild(tag);
    });

    // +ボタン
    const addBtn = document.createElement('span');
    addBtn.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:10px;font-size:14px;background:rgba(255,255,255,0.05);color:var(--fg2);cursor:pointer;';
    addBtn.textContent = '+';
    addBtn.title = 'フォルダにリンク登録';
    addBtn.dataset.gbTooltip = 'このファイルを別フォルダにもリンク登録します';
    addBtn.addEventListener('click', () => showAddFolderLinkModal(filePath, container));
    container.appendChild(addBtn);
  } catch (e) {}
}

function showAddFolderLinkModal(filePath, tagsContainer) {
  const o = document.createElement('div');
  o.className = 'modal-overlay';
  o.innerHTML = `<div class="modal" style="min-width:450px;">
    <h3>フォルダにリンク登録</h3>
    <div style="margin-bottom:8px;color:var(--fg2);font-size:12px;">${esc(filePath.split('/').pop())}</div>
    <div class="field"><label>フォルダパス（直接入力またはツリーから選択）</label><input id="modal-link-folder" type="text" placeholder="例: 作品/『MUDMAN』/第1話登場"></div>
    <div id="modal-link-tree" style="max-height:250px;overflow-y:auto;border:1px solid var(--border);border-radius:4px;padding:4px;margin-bottom:8px;background:var(--bg);font-size:12px;">
      <div style="color:var(--fg2);padding:4px;">読み込み中...</div>
    </div>
    <div class="btn-row">
      <button type="button" data-role="cancel">キャンセル</button>
      <button type="button" class="primary" data-role="submit">登録</button>
    </div>
  </div>`;
  document.body.appendChild(o);
  o.querySelector('[data-role="cancel"]')?.addEventListener('click', () => o.remove());
  o.querySelector('[data-role="submit"]')?.addEventListener('click', () => submitAddFolderLink(filePath));
  window._folderLinkTagsContainer = tagsContainer;
  setTimeout(() => document.getElementById('modal-link-folder').focus(), 50);
  // フォルダツリーを読み込み
  _loadFolderLinkTree(document.getElementById('modal-link-tree'));
}

async function _loadFolderLinkTree(container) {
  try {
    const roots = await apiFetch('/outliner-roots');
    container.innerHTML = '';
    // ホームフォルダを先頭に追加（ルートに含まれていない場合）
    if (_homeFolderPath) {
      const rootPaths = roots.filter(r => r.visible).map(r => r.path);
      if (!rootPaths.includes(_homeFolderPath)) {
        const homeLabel = typeof HOME_FOLDER_DISPLAY_LABEL !== 'undefined' ? HOME_FOLDER_DISPLAY_LABEL : 'ホームフォルダ';
        const homeEl = _createLinkTreeNode(homeLabel, _homeFolderPath, _homeFolderPath, true);
        container.appendChild(homeEl);
      }
    }
    for (const root of roots.filter(r => r.visible)) {
      const rootEl = _createLinkTreeNode(root.name, root.path, root.path, true);
      container.appendChild(rootEl);
    }
  } catch(e) {
    container.innerHTML = '<div style="color:var(--fg2);padding:4px;">ツリーの読み込みに失敗</div>';
  }
}

function _createLinkTreeNode(name, path, rootPath, isRoot) {
  const div = document.createElement('div');
  div.style.marginLeft = isRoot ? '0' : '16px';

  const row = document.createElement('div');
  row.style.cssText = 'display:flex;align-items:center;gap:4px;padding:2px 4px;cursor:pointer;border-radius:3px;';
  row.onmouseenter = () => { row.style.background = 'var(--bg3)'; };
  row.onmouseleave = () => { row.style.background = ''; };

  const toggle = document.createElement('span');
  toggle.textContent = '\u25B6';
  toggle.style.cssText = 'font-size:9px;width:12px;text-align:center;flex-shrink:0;color:var(--fg2);cursor:pointer;';
  toggle.dataset.expanded = 'false';
  row.appendChild(toggle);

  const icon = document.createElement('span');
  icon.innerHTML = lucide('folder', 14);
  icon.style.cssText = 'flex-shrink:0;color:var(--fg2);';
  row.appendChild(icon);

  const label = document.createElement('span');
  label.textContent = name;
  label.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
  row.appendChild(label);

  div.appendChild(row);

  const childrenDiv = document.createElement('div');
  childrenDiv.style.display = 'none';
  childrenDiv.dataset.loaded = 'false';
  div.appendChild(childrenDiv);

  // 展開/折りたたみ処理
  async function _toggleExpand() {
    const expanded = toggle.dataset.expanded === 'true';
    if (expanded) {
      childrenDiv.style.display = 'none';
      toggle.textContent = '\u25B6';
      toggle.dataset.expanded = 'false';
    } else {
      childrenDiv.style.display = '';
      toggle.textContent = '\u25BC';
      toggle.dataset.expanded = 'true';
      if (childrenDiv.dataset.loaded === 'false') {
        childrenDiv.dataset.loaded = 'true';
        childrenDiv.innerHTML = '<div style="color:var(--fg2);padding:2px 16px;font-size:11px;">...</div>';
        try {
          const items = await apiFetch('/browse?path=' + encodeURIComponent(path) + '&root=' + encodeURIComponent(rootPath));
          childrenDiv.innerHTML = '';
          const folders = items.filter(it => it.type === 'folder');
          if (folders.length === 0) {
            childrenDiv.innerHTML = '<div style="color:var(--fg2);padding:2px 16px;font-size:11px;">（フォルダなし）</div>';
          } else {
            folders.forEach(f => {
              childrenDiv.appendChild(_createLinkTreeNode(f.name, f.path, rootPath, false));
            });
          }
        } catch(err) {
          childrenDiv.innerHTML = '<div style="color:var(--red);padding:2px 16px;font-size:11px;">エラー</div>';
        }
      }
    }
  }

  // 行クリック → パスをセット + 展開/折りたたみ
  row.addEventListener('click', async (e) => {
    e.stopPropagation();
    const input = document.getElementById('modal-link-folder');
    if (input) input.value = path;
    // 選択ハイライト
    document.querySelectorAll('#modal-link-tree .link-tree-selected').forEach(el => {
      el.classList.remove('link-tree-selected');
      el.style.background = '';
    });
    row.classList.add('link-tree-selected');
    row.style.background = 'rgba(86,156,214,0.2)';
    // 展開/折りたたみもトリガー
    await _toggleExpand();
  });

  return div;
}

async function submitAddFolderLink(filePath) {
  const folder = document.getElementById('modal-link-folder').value.trim();
  if (!folder) { showStatus('フォルダパスを入力してください', true); return; }
  document.getElementById('modal-link-folder')?.closest('.modal-overlay')?.remove();
  try {
    await addFolderLinkWithHistory(filePath, folder, { tagsContainer: window._folderLinkTagsContainer });
    showStatus('リンク登録しました');
  } catch (e) { showStatus('リンク登録に失敗', true); }
}

function _getViewerParam(params, key) {
  const value = params.get(key) || '';
  return value ? String(value) : '';
}

function _inferViewerFileTypeFromPath(path) {
  const ext = String(path || '').split('?')[0].split('#')[0].split('.').pop().toLowerCase();
  if (!ext || ext === String(path || '').toLowerCase()) return '';
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'avif', 'ico'].includes(ext)) return 'image';
  if (['mp4', 'mov', 'avi', 'webm', 'mkv'].includes(ext)) return 'video';
  if (['mp3', 'wav', 'ogg', 'flac', 'm4a'].includes(ext)) return 'audio';
  if (ext === 'pdf') return 'pdf';
  if (ext === 'csv') return 'csv';
  if (ext === 'html' || ext === 'htm') return 'html';
  return '';
}

function _firstViewerFilesPath(filesValue) {
  if (!filesValue) return '';
  try {
    const files = JSON.parse(filesValue);
    if (Array.isArray(files)) return files[0] || '';
  } catch {}
  return String(filesValue).split(',').filter(Boolean)[0] || '';
}

function _inferViewerFileType(url) {
  const query = String(url || '').includes('?') ? String(url || '').substring(String(url || '').indexOf('?') + 1) : '';
  if (!query) return '';
  const params = new URLSearchParams(query);
  if (_getViewerParam(params, 'folder')) return 'folder';
  if (_getViewerParam(params, 'pdf')) return 'pdf';
  const filePath = _getViewerParam(params, 'file') || _firstViewerFilesPath(_getViewerParam(params, 'files'));
  return _inferViewerFileTypeFromPath(filePath);
}

function openViewer(url, opts) {
  const openOpts = opts || {};
  if (!openOpts.skipShowView) showView('html');
  const iframe = document.getElementById('html-iframe');
  const resolvedUrl = window.MeldexResourceUrl?.rewriteInternalUrl?.(url) || url;
  if (iframe) {
    if (typeof trackIframeLoading === 'function') {
      const inferredType = _inferViewerFileType(url);
      const loadingLabel = inferredType === 'pdf' ? 'PDFを読み込み中...' : 'ビューアを読み込み中...';
      trackIframeLoading(iframe, loadingLabel, openOpts);
    }
    iframe.src = resolvedUrl;
  }
  // ビューワー表示時に詳細パネルにファイル情報を表示
  if (!openOpts.skipGlobalUi) {
    const query = url.includes('?') ? url.substring(url.indexOf('?') + 1) : '';
    const params = new URLSearchParams(query);
    const files = (params.get('files') || '').split(',').filter(Boolean);
    const filePath = params.get('file') || params.get('pdf') || params.get('folder') || files[0] || '';
    if (filePath && typeof _showFileInfoInDetailPanel === 'function') {
      _showFileInfoInDetailPanel(decodeURIComponent(filePath));
    }
  }
}

// フォルダビュー表示設定
function getFolderDisplayConfig() {
  try { return JSON.parse(localStorage.getItem('folder-display-config') || '{}'); } catch { return {}; }
}
function saveFolderDisplayConfig(cfg) { localStorage.setItem('folder-display-config', JSON.stringify(cfg)); }

function _fdSection(menu, title, actionNode) {
  const head = document.createElement('div');
  head.style.cssText = 'display:flex;align-items:center;gap:8px;padding:7px 12px 4px;font-size:11px;font-weight:bold;color:var(--accent);cursor:default;';
  const label = document.createElement('span');
  label.textContent = title;
  head.appendChild(label);
  if (actionNode) {
    const spacer = document.createElement('span');
    spacer.style.flex = '1';
    head.appendChild(spacer);
    head.appendChild(actionNode);
  }
  menu.appendChild(head);
}

function _fdSep(menu) {
  const sep = document.createElement('div');
  sep.className = 'gb-context-menu-sep';
  menu.appendChild(sep);
}

function _fdCheckboxRow(label, checked, onChange, options = {}) {
  const row = document.createElement('div');
  row.className = 'gb-context-menu-item';
  row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:5px 14px;cursor:pointer;font-size:13px;';
  if (options.dataset) {
    Object.keys(options.dataset).forEach(key => { row.dataset[key] = options.dataset[key]; });
  }
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = !!checked;
  input.style.flexShrink = '0';
  const text = document.createElement('span');
  text.textContent = label;
  text.style.overflow = 'hidden';
  text.style.textOverflow = 'ellipsis';
  text.style.whiteSpace = 'nowrap';
  row.appendChild(input);
  row.appendChild(text);
  input.addEventListener('change', () => onChange(input.checked));
  row.addEventListener('click', (event) => {
    event.stopPropagation();
    if (event.target === input) return;
    input.checked = !input.checked;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  return row;
}

function _fdSetArrayFilter(cfg, key, value, enabled) {
  const set = new Set((typeof _folderFilterArray === 'function' ? _folderFilterArray(cfg[key]) : []).map(v => String(v)));
  if (enabled) set.add(String(value));
  else set.delete(String(value));
  cfg[key] = Array.from(set);
  saveFolderDisplayConfig(cfg);
  renderFolderGrid();
}

function _fdButton(label, onClick) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = label;
  btn.style.cssText = 'font-size:11px;padding:2px 7px;background:var(--bg3);color:var(--fg2);border:1px solid var(--border);border-radius:4px;cursor:pointer;';
  btn.addEventListener('click', (event) => {
    event.stopPropagation();
    onClick();
  });
  return btn;
}

function showFolderDisplaySettings() {
  // 既存メニューを閉じる
  document.querySelectorAll('.fd-dropdown').forEach(el => el.remove());

  const cfg = getFolderDisplayConfig();
  const btn = document.querySelector('[data-action="showFolderDisplaySettings()"]');
  const rect = btn.getBoundingClientRect();

  const menu = document.createElement('div');
  menu.className = 'fd-dropdown gb-context-menu';
  menu.style.minWidth = '300px';
  menu.style.maxWidth = '360px';
  menu.style.maxHeight = 'min(78vh, 680px)';
  menu.style.overflowY = 'auto';
  { const z = _getZoom(); menu.style.left = (rect.left / z) + 'px'; menu.style.top = (rect.bottom / z + 2) + 'px'; }

  const visibilityItems = [
    {key: 'showThumb', label: 'サムネイル'},
    {key: 'showName', label: 'ファイル名'},
    {key: 'showSize', label: 'サイズ'},
    {key: 'showDate', label: '更新日時'},
    {key: 'showType', label: 'タイプ'},
  ];

  _fdSection(menu, '表示項目');
  visibilityItems.forEach(it => {
    const checked = cfg[it.key] !== false;
    const el = _fdCheckboxRow(it.label, checked, (next) => {
      cfg[it.key] = next;
      saveFolderDisplayConfig(cfg);
      renderFolderGrid();
    });
    menu.appendChild(el);
  });

  _fdSep(menu);

  const resetBtn = _fdButton('解除', () => {
    if (typeof _clearFolderFilters === 'function') _clearFolderFilters();
    renderFolderGrid();
    menu.remove();
    showFolderDisplaySettings();
  });
  resetBtn.dataset.folderFilterReset = 'true';
  _fdSection(menu, 'フィルタ', resetBtn);

  const searchRow = document.createElement('div');
  searchRow.style.cssText = 'padding:5px 12px;display:flex;flex-direction:column;gap:4px;';
  const searchLabel = document.createElement('label');
  searchLabel.textContent = 'ファイル名・パス';
  searchLabel.style.cssText = 'font-size:11px;color:var(--fg2);';
  const searchInput = document.createElement('input');
  searchInput.type = 'search';
  searchInput.value = cfg.filterText || '';
  searchInput.placeholder = '名前やパスで絞り込み';
  searchInput.dataset.folderFilter = 'text';
  searchInput.style.cssText = 'width:100%;box-sizing:border-box;padding:4px 6px;background:var(--bg);color:var(--fg);border:1px solid var(--border);border-radius:4px;font-size:12px;';
  searchInput.addEventListener('input', () => {
    cfg.filterText = searchInput.value;
    saveFolderDisplayConfig(cfg);
    renderFolderGrid();
  });
  searchRow.appendChild(searchLabel);
  searchRow.appendChild(searchInput);
  menu.appendChild(searchRow);

  const choices = typeof _folderFilterChoices === 'function' ? _folderFilterChoices() : { types: [], exts: [] };
  const selectedTypes = new Set(typeof _folderFilterArray === 'function' ? _folderFilterArray(cfg.filterTypes) : []);
  const selectedExts = new Set((typeof _folderFilterArray === 'function' ? _folderFilterArray(cfg.filterExts) : []).map(ext => String(ext).toLowerCase()));

  _fdSection(menu, '種類');
  const typeBox = document.createElement('div');
  typeBox.style.maxHeight = '150px';
  typeBox.style.overflowY = 'auto';
  if (choices.types.length === 0) {
    const empty = document.createElement('div');
    empty.style.cssText = 'padding:5px 14px;color:var(--fg2);font-size:12px;';
    empty.textContent = '項目がありません';
    typeBox.appendChild(empty);
  } else {
    choices.types.forEach(([type, label]) => {
      typeBox.appendChild(_fdCheckboxRow(label, selectedTypes.has(type), (enabled) => {
        _fdSetArrayFilter(cfg, 'filterTypes', type, enabled);
      }, { dataset: { folderFilterType: type } }));
    });
  }
  menu.appendChild(typeBox);

  _fdSection(menu, '拡張子');
  const extBox = document.createElement('div');
  extBox.style.maxHeight = '130px';
  extBox.style.overflowY = 'auto';
  if (choices.exts.length === 0) {
    const empty = document.createElement('div');
    empty.style.cssText = 'padding:5px 14px;color:var(--fg2);font-size:12px;';
    empty.textContent = '拡張子のある項目がありません';
    extBox.appendChild(empty);
  } else {
    choices.exts.forEach(([ext, label]) => {
      extBox.appendChild(_fdCheckboxRow(label, selectedExts.has(ext), (enabled) => {
        _fdSetArrayFilter(cfg, 'filterExts', ext, enabled);
      }, { dataset: { folderFilterExt: ext } }));
    });
  }
  menu.appendChild(extBox);

  _fdSection(menu, '更新期間');
  const periodRow = document.createElement('div');
  periodRow.style.cssText = 'padding:5px 12px;display:flex;flex-direction:column;gap:6px;';
  const select = document.createElement('select');
  select.dataset.folderFilter = 'modified-preset';
  select.style.cssText = 'width:100%;box-sizing:border-box;padding:4px 6px;background:var(--bg);color:var(--fg);border:1px solid var(--border);border-radius:4px;font-size:12px;';
  [
    ['all', 'すべて'],
    ['today', '今日更新'],
    ['7d', '7日以内'],
    ['30d', '30日以内'],
    ['90d', '90日以内'],
    ['custom', '期間指定'],
  ].forEach(([value, label]) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    select.appendChild(option);
  });
  select.value = cfg.filterModifiedPreset || 'all';
  const customRow = document.createElement('div');
  customRow.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:6px;';
  const from = document.createElement('input');
  from.type = 'date';
  from.value = cfg.filterModifiedFrom || '';
  from.dataset.folderFilter = 'modified-from';
  const to = document.createElement('input');
  to.type = 'date';
  to.value = cfg.filterModifiedTo || '';
  to.dataset.folderFilter = 'modified-to';
  [from, to].forEach(input => {
    input.style.cssText = 'min-width:0;padding:4px 6px;background:var(--bg);color:var(--fg);border:1px solid var(--border);border-radius:4px;font-size:12px;';
  });
  customRow.appendChild(from);
  customRow.appendChild(to);
  const syncCustomVisibility = () => { customRow.style.display = select.value === 'custom' ? 'grid' : 'none'; };
  select.addEventListener('change', () => {
    cfg.filterModifiedPreset = select.value;
    saveFolderDisplayConfig(cfg);
    syncCustomVisibility();
    renderFolderGrid();
  });
  from.addEventListener('change', () => {
    cfg.filterModifiedFrom = from.value;
    if ((cfg.filterModifiedPreset || 'all') !== 'custom') {
      cfg.filterModifiedPreset = 'custom';
      select.value = 'custom';
      syncCustomVisibility();
    }
    saveFolderDisplayConfig(cfg);
    renderFolderGrid();
  });
  to.addEventListener('change', () => {
    cfg.filterModifiedTo = to.value;
    if ((cfg.filterModifiedPreset || 'all') !== 'custom') {
      cfg.filterModifiedPreset = 'custom';
      select.value = 'custom';
      syncCustomVisibility();
    }
    saveFolderDisplayConfig(cfg);
    renderFolderGrid();
  });
  periodRow.appendChild(select);
  periodRow.appendChild(customRow);
  menu.appendChild(periodRow);
  syncCustomVisibility();
  if (typeof attachMeldexDropdownCloseButton === 'function') {
    attachMeldexDropdownCloseButton(menu, {
      trigger: btn,
      close: () => menu.remove(),
    });
  }

  document.body.appendChild(menu);

  // 画面外補正
  clampPopupToViewport(menu);
  searchInput.focus({ preventScroll: true });

  setTimeout(() => {
    const closer = (ev) => {
      if (!menu.contains(ev.target) && ev.target !== btn) { menu.remove(); document.removeEventListener('pointerdown', closer); }
    };
    document.addEventListener('pointerdown', closer);
  }, 0);
}

function openFolderSlideshow() {
  if (!_folderPath) return;
  openViewer('/viewer?folder=' + encodeURIComponent(_folderPath));
}

async function openNative(path) {
  try {
    await apiPost('/open-native', { path });
    showStatus('ネイティブアプリで開きました');
  } catch (e) {
    showStatus('開けませんでした: ' + e.message, true);
  }
}

// formatFileSize は meldex-core.js で定義済み

// === ビューワーペインへのD&D ===
(function() {
  function _initPreviewDrop() {
    const pane = document.getElementById('gb-preview-pane');
    if (!pane) return;
    pane.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; pane.style.outline = '2px solid var(--accent)'; });
    pane.addEventListener('dragleave', () => { pane.style.outline = ''; });
    pane.addEventListener('drop', (e) => {
      e.preventDefault();
      pane.style.outline = '';
      // ツリーノードからのドロップ
      const nodeData = e.dataTransfer.getData('application/x-meldex-node');
      if (nodeData) {
        try {
          const data = JSON.parse(nodeData);
          if (data.path) {
            const name = data.path.split(/[/\\]/).pop();
            const ext = name.split('.').pop().toLowerCase();
            const imgExts = ['jpg','jpeg','png','gif','bmp','webp','svg','ico'];
            const vidExts = ['mp4','webm','mov','avi','mkv'];
            const type = imgExts.includes(ext) ? 'image' : vidExts.includes(ext) ? 'video' : ext === 'pdf' ? 'pdf' : 'file';
            showFolderPreview({ name, path: data.path, type });
          }
        } catch {}
        return;
      }
      // OSファイルのドロップ（パス解決不可のためスキップ）
      // テキスト/URLのドロップ
      const text = e.dataTransfer.getData('text/plain');
      if (text && text.startsWith('/')) {
        const name = text.split(/[/\\]/).pop();
        showFolderPreview({ name, path: text, type: 'image' });
      }
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _initPreviewDrop);
  else setTimeout(_initPreviewDrop, 1000);
})();

/* Source chunk: gb-folder.part03.js */
function _folderCurrentContextItem() {
  if (!_folderPath) return null;
  const title = document.getElementById('folder-title')?.textContent || _folderPath.split(/[\\/]/).pop() || _folderPath;
  return { name: title, path: _folderPath, type: 'folder' };
}

function _folderContextCreateParent(item) {
  if ((item?.type === 'folder' || item?.type === 'database') && item.path) return item.path;
  return _folderPath || '';
}

function _folderOpenType(item) {
  if (item?.type === 'database') return 'pivot';
  return item?.type || 'page';
}

function _folderRefreshCurrentFolder() {
  if (_folderPath) return openFolder(_folderPath.split(/[\\/]/).pop() || _folderPath, _folderPath);
  return Promise.resolve();
}

function _folderCopyMeldexLink(item) {
  if (!item?.path || typeof MeldexBroadcast === 'undefined') return;
  const name = item.name || item.path.split(/[\\/]/).pop() || item.path;
  MeldexBroadcast.copyMeldexLink(name, item.path, item.type).then(ok => {
    if (ok) showStatus('リンクをコピーしました');
  });
}

function _folderOpenItemInNewTab(item) {
  if (!item?.path) return;
  const openType = _folderOpenType(item);
  if (typeof _openInNewTab === 'function') _openInNewTab(item.name || '', item.path, openType);
}

function _folderOpenItemInNewWindow(item) {
  if (!item?.path) return;
  const openType = _folderOpenType(item);
  const openUrl = '/?open=' + encodeURIComponent(openType) + '&path=' + encodeURIComponent(item.path) + '&label=' + encodeURIComponent(item.name || '');
  if (typeof _open_app_window_js === 'function') _open_app_window_js(openUrl);
  else window.open(openUrl, '_blank', 'width=1200,height=800,menubar=no,toolbar=no,location=no');
}

function _folderApplyItemColor(item, color) {
  if (!item?.path || typeof setNodeColor !== 'function') return;
  const colorSettingsKey = typeof NODE_COLORS_KEY !== 'undefined' ? NODE_COLORS_KEY : 'outliner-node-colors';
  const before = typeof captureOutlinerSettingsHistory === 'function' ? captureOutlinerSettingsHistory([colorSettingsKey]) : null;
  setNodeColor(item.path, color || null);
  if (typeof pushOutlinerSettingsHistory === 'function') {
    pushOutlinerSettingsHistory(
      color ? 'フォルダツリー: 色設定' : 'フォルダツリー: 色リセット',
      before,
      item.path,
      [colorSettingsKey]
    );
  }
  if (typeof loadOutliner === 'function') loadOutliner();
  if (typeof renderHomeFolderTree === 'function') renderHomeFolderTree();
  showStatus(color ? '色を設定しました' : '色をリセットしました');
}

function _folderExportItems(item) {
  const items = [];
  if (!item?.path) return items;
  const baseName = (typeof MeldexExportSave !== 'undefined' && typeof MeldexExportSave.guessNameFromPath === 'function')
    ? MeldexExportSave.guessNameFromPath(item.path, item.name || '無題')
    : (item.name || '無題');
  const stem = String(baseName || '無題').replace(/\.[^.]+$/, '') || '無題';
  const push = (label, url, extension, filetypes) => items.push({ label, url, filename: stem + extension, extension, filetypes });
  if (item.type === 'database') {
    push('CSV', '/export/db?path=' + encodeURIComponent(item.path) + '&format=csv', '.csv', [['CSVファイル', '*.csv'], ['すべてのファイル', '*.*']]);
    push('HTML', '/export/db?path=' + encodeURIComponent(item.path) + '&format=html', '.html', [['HTMLファイル', '*.html'], ['すべてのファイル', '*.*']]);
    push('Excel', '/export/db?path=' + encodeURIComponent(item.path) + '&format=xlsx', '.xlsx', [['Excelファイル', '*.xlsx'], ['すべてのファイル', '*.*']]);
  } else if (item.type === 'board') {
    push('HTML', '/export/canvas?path=' + encodeURIComponent(item.path) + '&format=html', '.html', [['HTMLファイル', '*.html'], ['すべてのファイル', '*.*']]);
    push('SVG画像', '/export/canvas?path=' + encodeURIComponent(item.path) + '&format=svg', '.svg', [['SVGファイル', '*.svg'], ['すべてのファイル', '*.*']]);
    push('Markdown', '/export/canvas?path=' + encodeURIComponent(item.path) + '&format=md', '.md', [['Markdownファイル', '*.md'], ['すべてのファイル', '*.*']]);
  } else if (item.type === 'page') {
    push('テキスト', '/export/note?path=' + encodeURIComponent(item.path) + '&format=txt', '.txt', [['テキストファイル', '*.txt'], ['すべてのファイル', '*.*']]);
    push('Markdown', '/export/note?path=' + encodeURIComponent(item.path) + '&format=md', '.md', [['Markdownファイル', '*.md'], ['すべてのファイル', '*.*']]);
    push('HTML', '/export/note?path=' + encodeURIComponent(item.path) + '&format=html', '.html', [['HTMLファイル', '*.html'], ['すべてのファイル', '*.*']]);
    push('Word', '/export/note?path=' + encodeURIComponent(item.path) + '&format=docx', '.docx', [['Wordファイル', '*.docx'], ['すべてのファイル', '*.*']]);
  }
  return items;
}

function _installFolderBlankContextMenu(container) {
  if (!container || container.dataset.blankContextMenuBound === '1') return;
  container.dataset.blankContextMenuBound = '1';
  container.addEventListener('contextmenu', (e) => {
    if (e.target.closest?.('.fv-item')) return;
    if (e.target.closest?.('.gb-context-menu')) return;
    e.preventDefault();
    const item = _folderCurrentContextItem();
    if (item) showFolderItemContextMenu(e, item, { blankTarget: true });
  });
}
