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
function _ensureWaterfallResizeObserver() {
  const grid = document.getElementById('folder-grid');
  if (!grid) return;
  if (_waterfallResizeOb) _waterfallResizeOb.disconnect();
  if (grid.classList.contains('waterfall-layout')) {
    _waterfallResizeOb = new ResizeObserver(() => applyWaterfallLayout());
    _waterfallResizeOb.observe(grid);
  }
}

function applyWaterfallLayout() {
  const grid = document.getElementById('folder-grid');
  if (!grid || !grid.classList.contains('waterfall-layout')) return;
  const items = Array.from(grid.querySelectorAll('.fv-item'));
  if (items.length === 0) return;
  const gap = 3;
  const colW = parseInt(getComputedStyle(grid).getPropertyValue('--fv-card-w')) || 120;
  const containerW = grid.clientWidth - 24; // padding考慮
  const cols = Math.max(1, Math.floor((containerW + gap) / (colW + gap)));
  const colHeights = new Array(cols).fill(0);

  items.forEach(el => {
    const minH = Math.min(...colHeights);
    const colIdx = colHeights.indexOf(minH);
    el.style.left = (colIdx * (colW + gap)) + 'px';
    el.style.top = minH + 'px';
    el.style.width = colW + 'px';
    colHeights[colIdx] = minH + el.offsetHeight + gap;
  });
  // 内部の高さスペーサーでスクロール可能にする（grid自体のheightは変えない）
  let spacer = grid.querySelector('.wf-spacer');
  if (!spacer) { spacer = document.createElement('div'); spacer.className = 'wf-spacer'; grid.appendChild(spacer); }
  spacer.style.cssText = 'position:relative;width:1px;height:' + Math.max(...colHeights) + 'px;pointer-events:none;';
}

function applyFolderZoom() {
  const grid = document.getElementById('folder-grid');
  const w = Math.round(120 * _folderZoom);
  const h = Math.round(75 * _folderZoom);
  grid.style.setProperty('--fv-card-w', w + 'px');
  grid.style.setProperty('--fv-card-h', h + 'px');
  if (_folderLayout === 'waterfall') requestAnimationFrame(() => applyWaterfallLayout());
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
      if (THUMB_TYPES.has(item.type)) {
        const img = document.createElement('img');
        img.src = '/api/file-raw?path=' + encodeURIComponent(item.path);
        img.loading = 'lazy';
        img.onerror = () => { const sp = document.createElement('span'); sp.className='fv-icon'; sp.innerHTML=fileTypeIcon(item.type); img.replaceWith(sp); };
        thumb.appendChild(img);
      } else if (SHELL_THUMB_TYPES.has(item.type)) {
        // Windows シェルサムネイルを試行
        const img = document.createElement('img');
        img.src = '/api/thumbnail?path=' + encodeURIComponent(item.path);
        img.loading = 'lazy';
        img.onerror = () => { const sp = document.createElement('span'); sp.className='fv-icon'; sp.innerHTML=fileTypeIcon(item.type); img.replaceWith(sp); };
        thumb.appendChild(img);
      } else {
        const icon = document.createElement('span');
        icon.className = 'fv-icon';
        icon.innerHTML = fileTypeIcon(item.type);
        thumb.appendChild(icon);
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
    requestAnimationFrame(() => applyWaterfallLayout());
    let _wfDebounceTimer = null;
    const debouncedLayout = () => {
      clearTimeout(_wfDebounceTimer);
      _wfDebounceTimer = setTimeout(() => applyWaterfallLayout(), 80);
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
