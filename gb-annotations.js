/* gb-annotations.js: flattened split script for static cloud hosting. */
/* Source chunk: gb-annotations.part01.js */
/**
 * Meldex Annotations & Overlay
 * アノテーション、付箋ノート、オーバーレイ描画
 */

function _annotationUiZoom() {
  return (typeof _getZoom === 'function') ? Math.max(0.1, _getZoom()) : 1;
}
// フローティングツールバーをボタンの左横に配置
function _positionFloatingToolbar(toolbar, anchorBtn) {
  if (!anchorBtn) return;
  const zoom = _annotationUiZoom();
  // 一旦表示して幅を計測
  toolbar.style.visibility = 'hidden';
  toolbar.classList.add('visible');
  const tbRect = toolbar.getBoundingClientRect();
  const btnRect = anchorBtn.getBoundingClientRect();
  toolbar.classList.remove('visible');
  toolbar.style.visibility = '';
  const toolbarWidth = tbRect.width / zoom;
  const toolbarHeight = tbRect.height / zoom;
  const viewportWidth = window.innerWidth / zoom;
  const viewportHeight = window.innerHeight / zoom;
  const btnLeft = btnRect.left / zoom;
  const btnRight = btnRect.right / zoom;
  const btnTop = btnRect.top / zoom;
  const btnBottom = btnRect.bottom / zoom;
  // ボタンの左横、上端揃え。狭い画面ではボタンの上へ逃がしてボタンを隠さない。
  let x = btnLeft - toolbarWidth - 8;
  let y = btnTop;
  if (toolbarWidth > btnLeft - 12) {
    x = Math.max(4, Math.min(btnRight - toolbarWidth, viewportWidth - toolbarWidth - 4));
    y = btnTop - toolbarHeight - 8;
  }
  // 画面外にはみ出さないよう補正
  if (x < 4) x = 4;
  if (x + toolbarWidth > viewportWidth - 4) x = Math.max(4, viewportWidth - toolbarWidth - 4);
  if (y + toolbarHeight > viewportHeight - 4) y = viewportHeight - toolbarHeight - 4;
  if (y < 4) y = 4;
  const overlapsButton = x < btnRight + 2 && x + toolbarWidth > btnLeft - 2 && y < btnBottom + 2 && y + toolbarHeight > btnTop - 2;
  if (overlapsButton) {
    const aboveY = btnTop - toolbarHeight - 8;
    const belowY = btnBottom + 8;
    if (aboveY >= 4) y = aboveY;
    else if (belowY + toolbarHeight <= viewportHeight - 4) y = belowY;
    else y = 4;
    x = Math.max(4, Math.min(btnRight - toolbarWidth, viewportWidth - toolbarWidth - 4));
  }
  toolbar.style.left = x + 'px';
  toolbar.style.top = y + 'px';
}

// フローティングツールバードラッグ
function _setupFloatingDrag(toolbar) {
  const handle = toolbar.querySelector('.ft-drag');
  if (!handle) return;
  let startX, startY, origX, origY;
  function onDown(e) {
    e.preventDefault();
    const zoom = _annotationUiZoom();
    const ptr = e.touches ? e.touches[0] : e;
    startX = ptr.clientX / zoom; startY = ptr.clientY / zoom;
    const rect = toolbar.getBoundingClientRect();
    origX = rect.left / zoom; origY = rect.top / zoom;
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('touchend', onUp);
  }
  function onMove(e) {
    e.preventDefault();
    const zoom = _annotationUiZoom();
    const viewportWidth = window.innerWidth / zoom;
    const viewportHeight = window.innerHeight / zoom;
    const toolbarWidth = toolbar.getBoundingClientRect().width / zoom;
    const toolbarHeight = toolbar.getBoundingClientRect().height / zoom;
    const ptr = e.touches ? e.touches[0] : e;
    const dx = ptr.clientX / zoom - startX;
    const dy = ptr.clientY / zoom - startY;
    toolbar.style.left = Math.max(0, Math.min(viewportWidth - toolbarWidth, origX + dx)) + 'px';
    toolbar.style.top = Math.max(0, Math.min(viewportHeight - toolbarHeight, origY + dy)) + 'px';
  }
  function onUp() {
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    document.removeEventListener('touchmove', onMove);
    document.removeEventListener('touchend', onUp);
  }
  handle.addEventListener('pointerdown', onDown);
  handle.addEventListener('touchstart', onDown, { passive: false });
}
// 初期化
_setupFloatingDrag(document.getElementById('ann-toolbar'));
// （付箋ツールバーはメモに統合済み）

let _annViewLockBoundKey = '';
let _annViewLockMonitorStarted = false;
let _annViewLockCleanupDone = false;

function _removeDetachedViewLockIcons() {
  document.querySelectorAll('.vl-lock-icon').forEach(el => {
    if (el.id !== 'ann-view-lock-btn') el.remove();
  });
}

function _disableAnnFloatingViewLockButton(reason) {
  const btn = document.getElementById('ann-view-lock-btn');
  if (!btn) return;
  if (btn._viewLockClickHandler) {
    btn.removeEventListener('click', btn._viewLockClickHandler);
    btn._viewLockClickHandler = null;
  }
  if (typeof btn._viewLockUnsubscribe === 'function') {
    try { btn._viewLockUnsubscribe(); } catch (_) {}
    btn._viewLockUnsubscribe = null;
  }
  btn.disabled = true;
  btn.dataset.viewLockBound = '';
  btn.title = reason || 'このビューは表示ロック対象外です';
  btn.innerHTML = typeof lucide === 'function' ? lucide('unlock', 14) : '<span class="ico ico-unlock"></span>';
  btn.style.color = 'var(--fg2)';
  btn.style.opacity = '0.45';
  _annViewLockBoundKey = '';
}

function _refreshAnnFloatingViewLockButton(options = {}) {
  if (options.force || !_annViewLockCleanupDone) {
    _removeDetachedViewLockIcons();
    _annViewLockCleanupDone = true;
  }
  const btn = document.getElementById('ann-view-lock-btn');
  if (!btn) return;
  if (typeof ViewLock === 'undefined' || typeof _getActiveViewLockInfo !== 'function') {
    _disableAnnFloatingViewLockButton('表示ロックを初期化中です');
    return;
  }
  const info = _getActiveViewLockInfo();
  if (!info?.viewKey) {
    _disableAnnFloatingViewLockButton('このビューは表示ロック対象外です');
    return;
  }
  const boundKey = `${info.viewKey}|${info.kind || ''}`;
  if (!options.force && _annViewLockBoundKey === boundKey && btn.dataset.viewLockBound === boundKey) return;
  const paneId = info.viewKey.includes('#') ? info.viewKey.split('#')[1] : '';
  const target = info.viewKey.includes('#') ? info.viewKey.split('#')[0] : info.viewKey;
  try {
    ViewLock.bindHudIcon(btn, target, paneId, info.kind, info.getState);
    btn.dataset.viewLockBound = boundKey;
    _annViewLockBoundKey = boundKey;
  } catch (_) {
    _disableAnnFloatingViewLockButton('表示ロックの初期化に失敗しました');
  }
}

function _startAnnViewLockButtonMonitor() {
  if (_annViewLockMonitorStarted) return;
  _annViewLockMonitorStarted = true;
  _refreshAnnFloatingViewLockButton({ force: true });
  setInterval(() => {
    try { _refreshAnnFloatingViewLockButton(); } catch (_) {}
  }, 750);
}
setTimeout(_startAnnViewLockButtonMonitor, 0);

// オーバーレイサイズをウィンドウリサイズ時に更新
window.addEventListener('resize', () => {
  const overlay = document.getElementById('ann-overlay');
  if (overlay && overlay.style.display !== 'none' && overlay.parentElement) {
    const r = overlay.parentElement.getBoundingClientRect();
    overlay.style.width = r.width + 'px';
    overlay.style.height = r.height + 'px';
  }
});

// オーバーレイの表示/非表示トグル（メモ+付箋の描画を見せる/隠す）
let _overlayVisible = true;
const _ANNOTATION_TARGET_VIEW_TYPES = new Set([
  'entity', 'page', 'database', 'pivot', 'gallery', 'kanban', 'timeline',
  'chart', 'graph', 'form', 'smart-db', 'compare', 'board', 'folder',
  'media', 'html', 'csv', 'scriptnote', 'calendar',
]);
const _ANNOTATION_DB_VIEW_TYPES = new Set([
  'database', 'pivot', 'gallery', 'kanban', 'timeline', 'chart', 'graph', 'form', 'smart-db',
]);
function _usesEmbeddedAnnotationSurface(viewName) {
  return viewName === 'board' || viewName === 'html';
}
function _getActiveAnnotationTab() {
  if (typeof GBLayout === 'undefined' || !GBLayout.root || typeof GBLayout.findNode !== 'function') return null;
  const overlayPaneId = document.getElementById('ann-overlay')?.closest?.('.gb-pane')?.dataset?.paneId || '';
  if (overlayPaneId && GBLayout.paneMap?.[overlayPaneId]) {
    const overlayPaneInfo = GBLayout.findNode(GBLayout.root, overlayPaneId);
    const overlayTab = overlayPaneInfo?.node?.tabs?.[overlayPaneInfo.node.activeTabIndex] || null;
    if (_ANNOTATION_TARGET_VIEW_TYPES.has(overlayTab?.type)) return overlayTab;
  }
  const paneId = GBLayout.activePane;
  if (!paneId) return null;
  const activePaneInfo = GBLayout.findNode(GBLayout.root, paneId);
  const activeTab = activePaneInfo?.node?.tabs?.[activePaneInfo.node.activeTabIndex] || null;
  return _ANNOTATION_TARGET_VIEW_TYPES.has(activeTab?.type) ? activeTab : null;
}
function _getAnnotationViewName() {
  const activeTab = _getActiveAnnotationTab();
  return activeTab?.type || state.view || '';
}
function _getBoardAnnotationPath() {
  const activeTab = _getActiveAnnotationTab();
  if (activeTab?.type === 'board') {
    const activePath = activeTab.path || activeTab.state?.boardPath || '';
    if (activePath) return activePath;
  }
  const boardTab = _getActivePaneTabByType('board');
  return boardTab?.path || boardTab?.state?.boardPath || state.currentBoardPath || ((typeof bd !== 'undefined' && bd.path) ? bd.path : '');
}
function _getBoardAnnotationControl() {
  const canvas = typeof bdGetBoardElement === 'function'
    ? bdGetBoardElement('canvas')
    : document.getElementById('bd-canvas');
  if (canvas && !canvas._annBridge && typeof initIframeMarkup === 'function') {
    try { initIframeMarkup(canvas); } catch (_) {}
  }
  if (canvas && canvas._annBridge) return canvas._annBridge;
  const world = typeof bdGetBoardElement === 'function'
    ? bdGetBoardElement('world')
    : document.getElementById('bd-world');
  if (canvas && world?._annBridge) {
    canvas._annBridge = world._annBridge;
    return canvas._annBridge;
  }
  return world && world._annBridge ? world._annBridge : null;
}
function _forEachStandaloneAnnotationNote(callback) {
  document.querySelectorAll('.ann-note:not(.ann-note-embedded)').forEach(callback);
}
function _dispatchEmbeddedAnnotationMessage(msg) {
  const viewName = _getAnnotationViewName();
  if (!_usesEmbeddedAnnotationSurface(viewName)) return false;
  if (viewName === 'board') {
    const bridge = _getBoardAnnotationControl();
    if (bridge && typeof bridge.handleMessage === 'function') {
      bridge.handleMessage(msg);
      return true;
    }
    return false;
  }
  const iframe = _getActiveIframe();
  if (iframe?.contentWindow) {
    iframe.contentWindow.postMessage(msg, '*');
    return true;
  }
  return false;
}
function toggleOverlayVisibility() {
  _overlayVisible = !_overlayVisible;
  const overlay = document.getElementById('ann-overlay');
  const btn = document.getElementById('btn-overlay-toggle');
  const embedded = _usesEmbeddedAnnotationSurface(_getAnnotationViewName());
  overlay.style.visibility = embedded ? 'hidden' : (_overlayVisible ? '' : 'hidden');
  // 付箋ノート（DOM要素）も連動
  _forEachStandaloneAnnotationNote(el => { el.style.visibility = (!embedded && _overlayVisible) ? '' : 'hidden'; });
  if (btn) {
    btn.classList.toggle('active', _overlayVisible);
    btn.innerHTML = lucide(_overlayVisible ? 'eye' : 'eyeOff', 18);
    btn.title = _overlayVisible ? 'オーバーレイ表示中' : 'オーバーレイ非表示';
  }
  _dispatchEmbeddedAnnotationMessage({ type: 'ann-set-visibility', visible: _overlayVisible });
}

// オーバーレイを常時表示にする（描画内容は常に見える、編集はactive時のみ）
function _ensureOverlayVisible() {
  const overlay = document.getElementById('ann-overlay');
  if (!overlay) return;
  overlay.style.touchAction = 'none';
  if (overlay.style.display === 'none') {
    overlay.style.display = 'block';
    if (overlay.parentElement) {
      const r = overlay.parentElement.getBoundingClientRect();
      overlay.style.width = r.width + 'px';
      overlay.style.height = r.height + 'px';
    }
  }
}

// アノテーションフローティングツールバーのオン/オフ
function toggleAnnotationToolbar() {
  const toolbar = document.getElementById('ann-toolbar');
  const overlay = document.getElementById('ann-overlay');
  const btn = document.getElementById('btn-tb-annotation');
  const isVisible = toolbar.classList.contains('visible');
  const embedded = _usesEmbeddedAnnotationSurface(_getAnnotationViewName());
  if (isVisible) {
    closeAnnotationToolbar();
  } else {
    _positionFloatingToolbar(toolbar, btn);
    toolbar.classList.add('visible');
    document.body.classList.add('ann-toolbar-active');
    _refreshAnnFloatingViewLockButton({ force: true });
    _ensureOverlayVisible();
    ann.active = true;
    ann.tool = 'pen';
    document.querySelectorAll('#ann-toolbar .ann-tool[data-tool]').forEach(b => b.classList.toggle('active', b.dataset.tool === 'pen'));
    ann.targetPath = getAnnotationTarget();
    if (embedded) {
      overlay.classList.remove('active');
      overlay.style.visibility = 'hidden';
      _loadAnnotationsToIframe();
    } else {
      overlay.classList.add('active');
      overlay.style.pointerEvents = 'auto';
      overlay.style.touchAction = 'none';
      overlay.style.visibility = _overlayVisible ? '' : 'hidden';
      loadAnnotations();
    }
    if (btn) btn.classList.add('active');
  }
  // iframe内のメモも同期
  _syncAnnStateToIframe();
}

function closeAnnotationToolbar() {
  const toolbar = document.getElementById('ann-toolbar');
  const overlay = document.getElementById('ann-overlay');
  const btn = document.getElementById('btn-tb-annotation');
  if (toolbar) toolbar.classList.remove('visible');
  document.body.classList.remove('ann-toolbar-active');
  if (btn) btn.classList.remove('active');
  if (overlay) {
    overlay.classList.remove('active');
    overlay.classList.remove('ann-scrollbar-passthrough');
    overlay.style.pointerEvents = 'none';
    overlay.style.cursor = '';
  }
  if (typeof ann !== 'undefined') ann.active = false;
  _refreshAnnFloatingViewLockButton({ force: true });
  if (typeof _syncAnnStateToIframe === 'function') _syncAnnStateToIframe();
}

// メモ状態を同期（Phase D: iframe→直接呼び出し + iframeフォールバック）
function _syncAnnStateToIframe() {
  _dispatchEmbeddedAnnotationMessage({
    type: 'ann-set-state',
    active: ann.active,
    tool: ann.tool,
    color: ann.color,
    opacity: ann.opacity,
    widths: ann.widths,
    targetPath: ann.targetPath,
  });
  _dispatchEmbeddedAnnotationMessage({ type: 'ann-set-opacity', opacity: ann.opacity });
  _dispatchEmbeddedAnnotationMessage({ type: 'ann-set-visibility', visible: _overlayVisible });
}

// メモデータを送信
function _loadAnnotationsToIframe() {
  if (!ann.targetPath) return;
  apiFetch('/annotations?target=' + encodeURIComponent(ann.targetPath)).then(items => {
    _dispatchEmbeddedAnnotationMessage({ type: 'ann-load', items });
  }).catch(() => {});
}

// 現在アクティブなiframeを取得（HTMLビューワーのみiframe維持）
function _getActiveIframe() {
  if (_getAnnotationViewName() === 'html') return document.getElementById('html-iframe');
  return null;
}

// 付箋フローティングツールバーのオン/オフ
// 後方互換（付箋はメモに統合済み）
function toggleStickyToolbar() { toggleAnnotationToolbar(); }

/* ==============================
   オーバーレイ スクロール同期
   ============================== */
let _annScrollContainer = null;
let _annScrollHandler = null;
const _isIframeView = v => _usesEmbeddedAnnotationSurface(v);

function _getActivePaneTabByType(type) {
  if (!type || typeof GBLayout === 'undefined' || !GBLayout.root || typeof GBLayout.findNode !== 'function') return null;
  const paneId = GBLayout.activePane;
  if (paneId) {
    const activePaneInfo = GBLayout.findNode(GBLayout.root, paneId);
    const activeTab = activePaneInfo?.node?.tabs?.[activePaneInfo.node.activeTabIndex] || null;
    if (activeTab?.type === type) return activeTab;
  }
  const panes = typeof GBLayout.getAllPanes === 'function' ? GBLayout.getAllPanes(GBLayout.root) : [];
  for (const pane of panes) {
    const tab = pane?.tabs?.[pane.activeTabIndex] || null;
    if (tab?.type === type) return tab;
  }
  return null;
}

function _getStandaloneAnnotationHost() {
  return document.getElementById('btn-tb-annotation')?.parentElement
    || document.getElementById('ann-overlay')?.parentElement
    || document.getElementById('main-views')
    || document.getElementById('main-area')
    || document.body;
}

function _getScrollContainerForView(viewName) {
  if (viewName === 'page') return document.getElementById('page-content');
  if (viewName === 'entity') return document.getElementById('entity-view');
  if (viewName === 'database') return document.getElementById('pivot-view');
  if (viewName === 'pivot') return document.getElementById('pivot-view');
  if (viewName === 'gallery') return document.getElementById('gallery-view');
  if (viewName === 'form') return document.getElementById('form-view');
  if (viewName === 'kanban') return document.getElementById('kanban-view');
  if (viewName === 'timeline') return document.getElementById('timeline-view');
  if (viewName === 'chart') return document.getElementById('chart-view');
  if (viewName === 'graph') return document.getElementById('graph-view');
  if (viewName === 'smart-db') return document.getElementById('smart-db-view');
  if (viewName === 'compare') return document.getElementById('compare-view');
  if (viewName === 'folder') return document.getElementById('folder-grid');
  if (viewName === 'media') return document.getElementById('media-view');
  if (viewName === 'csv') return document.getElementById('csv-table-container') || document.getElementById('csv-view');
  if (viewName === 'scriptnote') {
    return document.querySelector('.gb-pane-active .gb-scriptnote-root .sn2-scroll')
      || document.querySelector('.gb-pane-active .gb-scriptnote-root #scenario-note-surface')
      || document.querySelector('.gb-scriptnote-root .sn2-scroll')
      || document.querySelector('.gb-scriptnote-root #scenario-note-surface');
  }
  if (viewName === 'calendar') {
    const root = document.querySelector('.gb-pane-active .gb-cal-root') || document.querySelector('.gb-cal-root');
    if (root?.classList?.contains('gb-cal-sidebar-only')) {
      return root.querySelector('.gb-cal-sidebar');
    }
    return root?.querySelector('.gb-cal-content') || root?.querySelector('.gb-cal-sidebar') || null;
  }
  return null; // iframe系(board/html)はnull
}

function _setupOverlayScroll(viewName) {
  // 旧リスナー解除
  if (_annScrollContainer && _annScrollHandler) {
    _annScrollContainer.removeEventListener('scroll', _annScrollHandler);
  }
  _annScrollContainer = null;
  _annScrollHandler = null;

  const layer = document.getElementById('ann-layer');
  if (!layer) return;

  if (_isIframeView(viewName)) {
    // iframe系: iframe内蔵メモに状態とデータを送信
    layer.setAttribute('transform', '');
    _syncAnnStateToIframe();
    _loadAnnotationsToIframe();
    _refreshAnnFloatingViewLockButton({ force: true });
    return;
  }

  const sc = _getScrollContainerForView(viewName);
  if (!sc) {
    layer.setAttribute('transform', '');
    _refreshAnnFloatingViewLockButton({ force: true });
    return;
  }

  _annScrollContainer = sc;
  _annScrollHandler = () => {
    const tx = -sc.scrollLeft, ty = -sc.scrollTop;
    layer.setAttribute('transform', `translate(${tx}, ${ty})`);
    // 付箋もスクロール連動
    _forEachStandaloneAnnotationNote(note => {
      // baseX/Yは付箋生成時に設定される（未設定時は現在位置をスクロール分で補正して初期化）
      if (note.dataset.baseY === undefined || note.dataset.baseY === '') {
        note.dataset.baseY = String(parseFloat(note.style.top || '0') - ty);
      }
      if (note.dataset.baseX === undefined || note.dataset.baseX === '') {
        note.dataset.baseX = String(parseFloat(note.style.left || '0') - tx);
      }
      const baseX = parseFloat(note.dataset.baseX);
      const baseY = parseFloat(note.dataset.baseY);
      note.style.top = (baseY + ty) + 'px';
      note.style.left = (baseX + tx) + 'px';
    });
  };
  sc.addEventListener('scroll', _annScrollHandler, { passive: true });
  // 初回同期
  _annScrollHandler();

  // Audit-P2 H-7: view_lock 対応ビューの scroll container にガードを設置する。
  // UI は注釈フロートバー内の #ann-view-lock-btn に集約する。
  if (typeof ViewLock !== 'undefined' && typeof _getActiveViewLockInfo === 'function') {
    const info = _getActiveViewLockInfo();
    if (info) {
      try { ViewLock.guardScrollContainer(sc, info.viewKey, info.kind); } catch (_) {}
    }
  }
  _refreshAnnFloatingViewLockButton({ force: true });
}

// pointerdown座標をコンテンツ座標に変換（スクロール分を加算）
function _toContentCoords(clientX, clientY) {
  const overlay = document.getElementById('ann-overlay');
  const rect = overlay.getBoundingClientRect();
  let x = clientX - rect.left;
  let y = clientY - rect.top;
  // スクロール分を加算（コンテンツ基準座標にする）
  if (_annScrollContainer && !_isIframeView(_getAnnotationViewName())) {
    y += _annScrollContainer.scrollTop;
    x += _annScrollContainer.scrollLeft;
  }
  return { x, y };
}

/* ==============================
   アノテーションエンジン
   ============================== */
const _ANN_WIDTH_LIMITS = {
  pen: { min: 1, max: 16, fallback: 3 },
  marker: { min: 4, max: 40, fallback: 12 },
  eraser: { min: 4, max: 48, fallback: 14 },
};

const ann = {
  active: false,
  tool: 'pen', // pen, marker, lasso, rect, eraser, sticky, balloon
  color: '#ffeb3b',
  opacity: 1.0,
  widths: _loadAnnotationToolWidths(),
  drawing: false,
  currentPath: [],
  currentPressures: [],
  currentPointerId: null,
  strokeReady: false,
  strokeEndRequested: false,
  targetPath: '', // 現在のファイルパス
};
let _annLoadSeq = 0;
let _annMutationSeq = 0;
let _annMutationTargetPath = '';
let _annRenderedTargetPath = '';
function _normalizeAnnotationTargetPath(path) {
  return String(path || '').replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+/g, '/');
}
function _clearStandaloneAnnotations() {
  const layer = document.getElementById('ann-layer');
  if (layer) layer.innerHTML = '';
  _forEachStandaloneAnnotationNote(el => el.remove());
}
function _setAnnotationRenderedTarget(targetPath) {
  _annRenderedTargetPath = _normalizeAnnotationTargetPath(targetPath);
}
function _markAnnotationMutated(targetPath) {
  _annMutationSeq += 1;
  _annMutationTargetPath = _normalizeAnnotationTargetPath(targetPath || ann?.targetPath || '');
}
function _resolveAnnotationWriteTarget() {
  const current = (typeof getAnnotationTarget === 'function') ? getAnnotationTarget() : '';
  const targetPath = current || ann.targetPath || '';
  if (targetPath) ann.targetPath = targetPath;
  return targetPath;
}
function _annotationMutationAffectsTarget(targetPath) {
  const mutationTarget = _normalizeAnnotationTargetPath(_annMutationTargetPath);
  return !!mutationTarget && mutationTarget === _normalizeAnnotationTargetPath(targetPath);
}

function _annotationHistoryDetail(row, fallback) {
  return fallback || row?.body || row?.target_path || row?.id || '';
}

function _normalizeAnnotationHistoryRow(row) {
  if (!row || typeof row !== 'object') return null;
  const copy = { ...row };
  if (copy.data && typeof copy.data !== 'string') {
    try { copy.data = JSON.stringify(copy.data); } catch { copy.data = '{}'; }
  }
  return copy;
}

async function _fetchAnnotationHistoryRow(annId) {
  if (!annId) return null;
  const rows = await apiFetch('/annotations?ann_id=' + encodeURIComponent(annId) + '&limit=1');
  return _normalizeAnnotationHistoryRow(Array.isArray(rows) ? rows[0] : null);
}

function _refreshAnnotationHistoryTarget(row) {
  const targetPath = row?.target_path || ann?.targetPath || '';
  _markAnnotationMutated(targetPath);
  if (typeof loadAnnotations === 'function') loadAnnotations();
  if (typeof loadRpAnnotationList === 'function') {
    const panel = document.getElementById('right-panel');
    if (panel?.classList.contains('open')) loadRpAnnotationList();
  }
}

async function _restoreAnnotationHistoryRow(row) {
  const payload = _normalizeAnnotationHistoryRow(row);
  if (!payload?.id) return false;
  await apiPost('/annotations/restore', payload);
  _refreshAnnotationHistoryTarget(payload);
  return true;
}

async function _deleteAnnotationHistoryRow(row) {
  const annId = typeof row === 'string' ? row : row?.id;
  if (!annId) return false;
  await apiDelete('/annotations/' + encodeURIComponent(annId));
  _refreshAnnotationHistoryTarget(typeof row === 'object' ? row : null);
  return true;
}

function _pushAnnotationHistory(label, beforeRow, afterRow, detail) {
  if (typeof historyPush !== 'function') return false;
  const before = _normalizeAnnotationHistoryRow(beforeRow);
  const after = _normalizeAnnotationHistoryRow(afterRow);
  if (!before && !after) return false;
  let beforeKey = '';
  let afterKey = '';
  try {
    beforeKey = JSON.stringify(before || null);
    afterKey = JSON.stringify(after || null);
  } catch {}
  if (beforeKey && beforeKey === afterKey) return false;
  const scope = (typeof _historyActiveScope !== 'undefined') ? _historyActiveScope : '';
  historyPush(
    label,
    () => before ? _restoreAnnotationHistoryRow(before) : _deleteAnnotationHistoryRow(after),
    () => after ? _restoreAnnotationHistoryRow(after) : _deleteAnnotationHistoryRow(before),
    scope,
    _annotationHistoryDetail(after || before, detail)
  );
  return true;
}

function _normalizeAnnotationHistoryRows(rows) {
  return (Array.isArray(rows) ? rows : [])
    .map(row => _normalizeAnnotationHistoryRow(row))
    .filter(row => row?.id);
}

async function _applyAnnotationHistoryRows(targetRows, previousRows) {
  const target = _normalizeAnnotationHistoryRows(targetRows);
  const previous = _normalizeAnnotationHistoryRows(previousRows);
  const targetIds = new Set(target.map(row => String(row.id)));
  for (const row of target) {
    await apiPost('/annotations/restore', row);
  }
  for (const row of previous) {
    if (targetIds.has(String(row.id))) continue;
    await apiDelete('/annotations/' + encodeURIComponent(row.id));
  }
  _refreshAnnotationHistoryTarget(target[0] || previous[0] || null);
  return true;
}

function _pushAnnotationBatchHistory(label, beforeRows, afterRows, detail) {
  if (typeof historyPush !== 'function') return false;
  const before = _normalizeAnnotationHistoryRows(beforeRows);
  const after = _normalizeAnnotationHistoryRows(afterRows);
  if (!before.length && !after.length) return false;
  let beforeKey = '';
  let afterKey = '';
  try {
    beforeKey = JSON.stringify(before);
    afterKey = JSON.stringify(after);
  } catch {}
  if (beforeKey && beforeKey === afterKey) return false;
  const scope = (typeof _historyActiveScope !== 'undefined') ? _historyActiveScope : '';
  historyPush(
    label || '注釈: 一括更新',
    () => _applyAnnotationHistoryRows(before, after),
    () => _applyAnnotationHistoryRows(after, before),
    scope,
    detail || _annotationHistoryDetail(after[0] || before[0], '')
  );
  return true;
}

async function _pushAnnotationCreateHistory(annId, label, detail) {
  const after = await _fetchAnnotationHistoryRow(annId);
  return _pushAnnotationHistory(label || '注釈: 作成', null, after, detail);
}

async function _putAnnotationWithHistory(annId, body, label, detail) {
  const before = await _fetchAnnotationHistoryRow(annId);
  await apiPut('/annotations/' + encodeURIComponent(annId), body);
  const after = await _fetchAnnotationHistoryRow(annId);
  _pushAnnotationHistory(label || '注釈: 更新', before, after, detail);
  return after;
}

function _loadAnnotationToolWidths() {
  const defaults = { pen: 3, marker: 12, eraser: 14 };
  try {
    const saved = JSON.parse(localStorage.getItem('meldex-ann-tool-widths') || '{}');
    return {
      pen: _clampAnnotationToolWidth('pen', saved.pen ?? defaults.pen),
      marker: _clampAnnotationToolWidth('marker', saved.marker ?? defaults.marker),
      eraser: _clampAnnotationToolWidth('eraser', saved.eraser ?? defaults.eraser),
    };
  } catch {
    return defaults;
  }
}

function _clampAnnotationToolWidth(tool, value) {
  const limit = _ANN_WIDTH_LIMITS[tool] || _ANN_WIDTH_LIMITS.pen;
  const n = Number(value);
  if (!Number.isFinite(n)) return limit.fallback;
  return Math.max(limit.min, Math.min(limit.max, n));
}

function _saveAnnotationToolWidths() {
  try { localStorage.setItem('meldex-ann-tool-widths', JSON.stringify(ann.widths)); } catch {}
}

function _annotationDrawWidth(tool, pressures, baseWidth) {
  const normalizedTool = tool === 'stroke' ? 'pen' : tool;
  const base = _clampAnnotationToolWidth(normalizedTool, baseWidth ?? ann.widths?.[normalizedTool]);
  if (normalizedTool === 'pen' && Array.isArray(pressures) && pressures.length > 0) {
    const avgP = pressures.reduce((a, b) => a + (Number(b) || 0), 0) / pressures.length;
    return Math.max(1, base * (0.5 + Math.max(0, Math.min(1, avgP))));
  }
  return base;
}

function _bindAnnotationWidthControls() {
  document.querySelectorAll('[data-ann-width-tool]').forEach(input => {
    const tool = input.dataset.annWidthTool;
    if (!tool || !ann.widths || !(tool in ann.widths)) return;
    const current = _clampAnnotationToolWidth(tool, ann.widths[tool]);
    input.value = String(current);
    globalThis.GBUI?.refreshRangeFill?.(input);
    const label = document.getElementById('ann-width-' + tool + '-label');
    if (label) label.textContent = String(current);
    input.addEventListener('input', () => {
      const next = _clampAnnotationToolWidth(tool, input.value);
      ann.widths[tool] = next;
      input.value = String(next);
      globalThis.GBUI?.refreshRangeFill?.(input);
      const nextLabel = document.getElementById('ann-width-' + tool + '-label');
      if (nextLabel) nextLabel.textContent = String(next);
      _saveAnnotationToolWidths();
      _syncAnnStateToIframe();
    });
  });
}

function getAnnotationTarget() {
  // 現在のビューに応じたターゲットパスを返す
  const viewName = _getAnnotationViewName();
  const activeTab = _getActiveAnnotationTab();
  const statePath = (key) => (typeof state !== 'undefined' ? (state?.[key] || '') : '');
  const tabPath = (...keys) => {
    if (activeTab?.path) return activeTab.path;
    const tabState = activeTab?.state || {};
    for (const key of keys) {
      if (tabState[key]) return tabState[key];
    }
    return '';
  };
  if (viewName === 'entity') return tabPath('entityPath') || statePath('currentEntityPath');
  if (viewName === 'page') return tabPath('pagePath') || statePath('currentPagePath');
  if (_ANNOTATION_DB_VIEW_TYPES.has(viewName)) {
    if (viewName === 'smart-db') {
      return tabPath('smartDbPath', 'dbPath') || statePath('currentSmartDb')?._filePath || statePath('currentDbPath');
    }
    return tabPath('dbPath') || statePath('currentDbPath');
  }
  if (viewName === 'board') {
    const boardPath = _getBoardAnnotationPath();
    if (boardPath) return boardPath;
  }
  if (viewName === 'folder') return tabPath('folderPath') || _folderPath || '';
  if (viewName === 'media') return tabPath('mediaPath', 'pagePath') || statePath('currentPagePath');
  if (viewName === 'csv') return tabPath('csvPath') || (typeof _csvPath !== 'undefined' ? _csvPath : '');
  if (viewName === 'scriptnote') {
    const tab = _getActivePaneTabByType('scriptnote');
    const path = activeTab?.state?.scenarioPath || activeTab?.path || tab?.state?.scenarioPath || tab?.path || '';
    if (path) return path;
  }
  if (viewName === 'calendar') return 'calendar:panel';
  if (viewName === 'html') return tabPath('mediaPath', 'pagePath') || statePath('currentPagePath') || document.getElementById('html-url-bar')?.value || 'viewer';
  if (viewName === 'compare') {
    const left = activeTab?.state?.pathA || activeTab?.state?.leftPath || '';
    const right = activeTab?.state?.pathB || activeTab?.state?.rightPath || '';
    return tabPath('comparePath') || (left || right ? `compare:${left}|${right}` : '');
  }
  return '';
}

function toggleAnnotation() {
  // 後方互換: Alt+Aで呼ばれる
  toggleAnnotationToolbar();
}

// ツール選択（アノテーションツールバー内）
document.querySelectorAll('#ann-toolbar .ann-tool[data-tool]').forEach(btn => {
  btn.addEventListener('click', () => {
    ann.tool = btn.dataset.tool;
    document.querySelectorAll('#ann-toolbar .ann-tool[data-tool]').forEach(b => b.classList.toggle('active', b === btn));
    const overlay = document.getElementById('ann-overlay');
    overlay.style.cursor = ann.tool === 'eraser' ? 'not-allowed' : ann.tool === 'sticky' ? 'cell' : 'crosshair';
    _syncAnnStateToIframe();
  });
});

// （付箋ツールバーはメモに統合済み）

// 初期色をパレット1番目に
ann.color = PALETTE_COLORS[7] || '#c48080';
function _bindAnnotationColorControl() {
  const swatch = document.getElementById('ann-color-swatch');
  if (!swatch) return;
  const applyColor = (color) => {
    const next = color && color !== 'transparent' ? color : (ann.color || '#c48080');
    ann.color = next;
    if (typeof setColorSwatchValue === 'function') setColorSwatchValue(swatch, next);
    else swatch.style.background = next;
    _syncAnnStateToIframe();
  };
  if (typeof bindColorSwatch === 'function') {
    bindColorSwatch(swatch, () => ann.color, applyColor);
  } else {
    if (typeof setColorSwatchValue === 'function') setColorSwatchValue(swatch, ann.color);
    else swatch.style.background = ann.color;
    swatch.addEventListener('click', () => {
      if (typeof openColorPalette === 'function') openColorPalette(swatch, ann.color, applyColor);
    });
  }
}
_bindAnnotationColorControl();
_bindAnnotationWidthControls();
document.getElementById('ann-opacity').oninput = function() {
  ann.opacity = parseFloat(this.value);
  document.getElementById('ann-opacity-label').textContent = Math.round(ann.opacity * 100) + '%';
  // 全メモの不透明度を一括調整
  const overlay = document.getElementById('ann-overlay');
  if (overlay) overlay.style.opacity = ann.opacity;
  _forEachStandaloneAnnotationNote(note => { note.style.opacity = ann.opacity; });
  _dispatchEmbeddedAnnotationMessage({ type: 'ann-set-opacity', opacity: ann.opacity });
};

// SVG描画
const _annSvgNS = 'http://www.w3.org/2000/svg';
function _pointsToSvgPath(points, pressures, isPen) {
  if (points.length < 2) return '';
  let d = `M ${points[0][0]} ${points[0][1]}`;
  for (let i = 1; i < points.length; i++) {
    d += ` L ${points[i][0]} ${points[i][1]}`;
  }
  return d;
}

function _createStrokeEl(pathD, color, opacity, pressures, isPen, width) {
  const path = document.createElementNS(_annSvgNS, 'path');
  path.setAttribute('d', pathD);
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', color);
  path.setAttribute('stroke-opacity', opacity);
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');
  path.setAttribute('stroke-width', _annotationDrawWidth(isPen ? 'pen' : 'marker', pressures, width));
  if (!isPen) path.setAttribute('stroke-opacity', Math.min(opacity, 0.5)); // マーカーは半透明
  return path;
}

function _createLassoEl(points, color, opacity) {
  const poly = document.createElementNS(_annSvgNS, 'polygon');
  poly.setAttribute('points', points.map(p => p.join(',')).join(' '));
  poly.setAttribute('fill', color);
  poly.setAttribute('fill-opacity', opacity * 0.4);
  poly.setAttribute('stroke', color);
  poly.setAttribute('stroke-width', '1');
  poly.setAttribute('stroke-opacity', opacity);
  return poly;
}

function _annDistanceToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  if (!dx && !dy) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function _annElementHit(el, x, y, tolerance = 10) {
  try {
    const point = new DOMPoint(x, y);
    if (typeof el.isPointInStroke === 'function' && el.isPointInStroke(point)) return true;
    if (typeof el.isPointInFill === 'function' && el.isPointInFill(point)) return true;
  } catch {}
  if (typeof el.getTotalLength === 'function' && typeof el.getPointAtLength === 'function') {
    try {
      const total = el.getTotalLength();
      const step = Math.max(4, total / 80);
      for (let pos = 0; pos <= total; pos += step) {
        const a = el.getPointAtLength(pos);
        const b = el.getPointAtLength(Math.min(total, pos + step));
        if (_annDistanceToSegment(x, y, a.x, a.y, b.x, b.y) <= tolerance) return true;
      }
    } catch {}
  }
  const points = (el.getAttribute('points') || '').trim().split(/\s+/)
    .map(pair => pair.split(',').map(Number))
    .filter(pair => pair.length === 2 && pair.every(Number.isFinite));
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    if (_annDistanceToSegment(x, y, a[0], a[1], b[0], b[1]) <= tolerance) return true;
  }
  return false;
}

// Pointer Events
const annOverlay = document.getElementById('ann-overlay');

function _preventAnnotationPointerDefault(e) {
  e?.preventDefault?.();
  e?.stopPropagation?.();
}

function _resetAnnotationStrokeState() {
  ann.drawing = false;
  ann.strokeReady = false;
  ann.strokeEndRequested = false;
  ann.currentPointerId = null;
  ann.currentPath = [];
  ann.currentPressures = [];
  annOverlay?.querySelector('.ann-preview')?.remove();
}

function _annotationPointFromEvent(e) {
  const pt = _toContentCoords(e.clientX, e.clientY);
  return [pt.x, pt.y];
}

function _renderAnnotationPreview() {
  if (!ann.drawing || !ann.strokeReady || ann.currentPath.length < 2) return;
  const previewTag = ann.tool === 'lasso' ? 'polygon' : (ann.tool === 'rect' ? 'rect' : 'path');
  let preview = annOverlay.querySelector('.ann-preview');
  if (!preview || preview.tagName.toLowerCase() !== previewTag) {
    preview?.remove(); preview = document.createElementNS(_annSvgNS, previewTag); preview.classList.add('ann-preview');
    (document.getElementById('ann-layer') || annOverlay).appendChild(preview);
  }
  if (ann.tool === 'rect') _updateRectFillEl(preview, _annotationRectDataFromPoints(ann.currentPath), ann.color, ann.opacity, true);
  else if (ann.tool === 'lasso') {
    preview.setAttribute('points', ann.currentPath.map(p => p.join(',')).join(' '));
    preview.setAttribute('fill', ann.color);
    preview.setAttribute('fill-opacity', ann.opacity * 0.2);
    preview.setAttribute('stroke', ann.color);
    preview.setAttribute('stroke-width', '1');
    preview.setAttribute('stroke-dasharray', '4,4');
  } else {
    const d = _pointsToSvgPath(ann.currentPath, ann.currentPressures, ann.tool === 'pen');
    preview.setAttribute('d', d);
    preview.setAttribute('fill', 'none');
    preview.setAttribute('stroke', ann.color);
    preview.setAttribute('stroke-width', _annotationDrawWidth(ann.tool, ann.currentPressures, ann.widths?.[ann.tool]));
    preview.setAttribute('stroke-opacity', ann.tool === 'marker' ? 0.5 : ann.opacity);
    preview.setAttribute('stroke-linecap', 'round');
  }
}

async function _finishAnnotationStroke() {
  if (!ann.drawing || !ann.strokeReady) return;
  const pathPoints = ann.currentPath.map(p => [p[0], p[1]]);
  const pressures = [...ann.currentPressures];
  const tool = ann.tool;
  const color = ann.color;
  const opacity = ann.opacity;
  const targetPath = _resolveAnnotationWriteTarget();
  const width = ann.widths?.[tool === 'marker' ? 'marker' : 'pen'];
  _resetAnnotationStrokeState();
  if (pathPoints.length < 2 || !targetPath) return;

  const type = tool === 'rect' ? 'rect' : (tool === 'lasso' ? 'lasso' : (tool === 'marker' ? 'marker' : 'stroke'));
  const strokeData = type === 'rect' ? _annotationRectDataFromPoints(pathPoints) : { points: pathPoints, pressures };
  if (type !== 'lasso' && type !== 'rect') strokeData.width = width;
  const el = type === 'rect' ? _createRectFillEl(strokeData, color, opacity)
    : type === 'lasso' ? _createLassoEl(pathPoints, color, opacity)
      : _createStrokeEl(_pointsToSvgPath(pathPoints, pressures, tool === 'pen'), color, opacity, pressures, tool === 'pen', strokeData.width);
  el.dataset.annPending = '1';
  _setAnnotationRenderedTarget(targetPath);
  _markAnnotationMutated(targetPath);
  (document.getElementById('ann-layer') || annOverlay).appendChild(el);
  try {
    const res = await apiPost('/annotations', {
      target_path: targetPath,
      type,
      data: strokeData,
      color,
      opacity,
      user: getUsername(),
    });
    delete el.dataset.annPending;
    el.dataset.annId = res.id;
    _markAnnotationMutated(targetPath);
    _pushAnnotationCreateHistory(res.id, '注釈: 描画追加', targetPath).catch(() => {});
  } catch(e) {
    el.remove();
    _markAnnotationMutated(targetPath);
    showStatus('注釈保存に失敗', true);
  }
}

/* Source chunk: gb-annotations.part03.js */
// Audit-P2 H-7: view_lock 情報。
// state.view と getAnnotationTarget() から (view_key, kind, getState) を合成する。
function _getActiveViewLockInfo() {
  if (typeof ViewLock === 'undefined' || typeof state === 'undefined') return null;
  const viewName = (typeof _getAnnotationViewName === 'function') ? _getAnnotationViewName() : state.view;
  const target = (typeof getAnnotationTarget === 'function') ? getAnnotationTarget() : '';
  if (!target || !target.includes('/')) return null;
  const kindMap = {
    page: 'page', entity: 'page',
    database: 'db', pivot: 'db', gallery: 'db', kanban: 'db', timeline: 'db',
    chart: 'db', graph: 'db', 'smart-db': 'db',
    scriptnote: 'scriptnote', calendar: 'calendar',
    media: 'media', folder: 'folder',
    compare: 'compare',
  };
  const kind = kindMap[viewName];
  if (!kind || !ViewLock.isSupported(kind)) return null;
  const paneEl = document.querySelector('.gb-pane-active');
  const paneId = paneEl?.id || paneEl?.dataset?.paneId || '';
  const vk = ViewLock.viewKey(target, paneId);
  if (!vk) return null;
  const getState = () => {
    const sc = (typeof _getScrollContainerForView === 'function') ? _getScrollContainerForView(viewName) : null;
    const out = { view: viewName };
    if (sc) { out.scrollX = sc.scrollLeft; out.scrollY = sc.scrollTop; }
    return out;
  };
  return { viewKey: vk, kind, getState };
}

async function _maybeEngageViewLockForStroke() {
  // 表示ロックは既定OFF。ユーザーがロックアイコンを押した時点でのみ固定する。
  // 描画開始時の自動ロックや確認ダイアログは出さない。
  return true;
}

function _annotationScrollbarHitTest(clientX, clientY) {
  const sc = _annScrollContainer;
  if (!sc || typeof sc.getBoundingClientRect !== 'function') return false;
  const rect = sc.getBoundingClientRect();
  if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) return false;
  const vertical = sc.scrollHeight > sc.clientHeight;
  const horizontal = sc.scrollWidth > sc.clientWidth;
  const gutterX = Math.max(12, Math.min(24, (sc.offsetWidth || 0) - (sc.clientWidth || 0) || 17));
  const gutterY = Math.max(12, Math.min(24, (sc.offsetHeight || 0) - (sc.clientHeight || 0) || 17));
  if (vertical && clientX >= rect.right - gutterX) return true;
  if (horizontal && clientY >= rect.bottom - gutterY) return true;
  return false;
}

function _updateAnnotationOverlayScrollPassthrough(clientX, clientY) {
  const overlay = document.getElementById('ann-overlay');
  if (!overlay || !overlay.classList.contains('active')) return;
  overlay.classList.toggle('ann-scrollbar-passthrough', _annotationScrollbarHitTest(clientX, clientY));
}

function _routeAnnotationWheelToScrollContainer(event) {
  if (typeof ann === 'undefined' || !ann.active || !_annScrollContainer) return;
  if (event.ctrlKey || _isIframeView(_getAnnotationViewName())) return;
  const sc = _annScrollContainer;
  const canScrollY = sc.scrollHeight > sc.clientHeight;
  const canScrollX = sc.scrollWidth > sc.clientWidth;
  if (!canScrollY && !canScrollX) return;
  const line = 16;
  const page = Math.max(1, sc.clientHeight || 1);
  const unit = event.deltaMode === 1 ? line : (event.deltaMode === 2 ? page : 1);
  if (canScrollX) sc.scrollLeft += event.deltaX * unit;
  if (canScrollY) sc.scrollTop += event.deltaY * unit;
  event.preventDefault();
  event.stopPropagation();
}

document.addEventListener('pointermove', (event) => {
  if (typeof ann === 'undefined' || !ann.active || ann.drawing) return;
  _updateAnnotationOverlayScrollPassthrough(event.clientX, event.clientY);
}, { passive: true });

function _annotationRectDataFromPoints(points) {
  const first = points?.[0] || [0, 0];
  const last = points?.[points.length - 1] || first;
  const x1 = Number(first[0]) || 0, y1 = Number(first[1]) || 0;
  const x2 = Number(last[0]) || 0, y2 = Number(last[1]) || 0;
  return { x: Math.min(x1, x2), y: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) };
}

function _updateRectFillEl(rect, data, color, opacity, preview) {
  const x = Number(data?.x) || 0, y = Number(data?.y) || 0;
  rect.setAttribute('x', x);
  rect.setAttribute('y', y);
  rect.setAttribute('width', Math.max(1, Number(data?.width) || 0));
  rect.setAttribute('height', Math.max(1, Number(data?.height) || 0));
  rect.setAttribute('fill', color);
  rect.setAttribute('fill-opacity', String((Number(opacity) || 1) * (preview ? 0.2 : 0.4)));
  rect.setAttribute('stroke', color);
  rect.setAttribute('stroke-width', '1');
  rect.setAttribute('stroke-opacity', String(Number(opacity) || 1));
  if (preview) rect.setAttribute('stroke-dasharray', '4,4');
  else rect.removeAttribute('stroke-dasharray');
  return rect;
}

function _createRectFillEl(data, color, opacity, preview) {
  return _updateRectFillEl(document.createElementNS(_annSvgNS, 'rect'), data, color, opacity, preview);
}

annOverlay?.addEventListener('wheel', _routeAnnotationWheelToScrollContainer, { passive: false });

annOverlay.addEventListener('pointerdown', async (e) => {
  if (!ann.active) return;
  if (typeof _annotationScrollbarHitTest === 'function' && _annotationScrollbarHitTest(e.clientX, e.clientY)) {
    if (typeof _updateAnnotationOverlayScrollPassthrough === 'function') {
      _updateAnnotationOverlayScrollPassthrough(e.clientX, e.clientY);
    }
    return;
  }
  _preventAnnotationPointerDefault(e);
  if (ann.tool === 'sticky') {
    // Audit-P2 H-7: 付箋も表示状態を変えるとズレる → 誘導対象
    const ok = await _maybeEngageViewLockForStroke();
    if (!ok) return;
    createNote(e.clientX, e.clientY, 'sticky');
    return;
  }
  if (ann.tool === 'eraser') {
    await eraseAtPoint(e.clientX, e.clientY);
    return;
  }
  _resetAnnotationStrokeState();
  ann.drawing = true;
  ann.strokeReady = false;
  ann.strokeEndRequested = false;
  ann.currentPointerId = e.pointerId;
  ann.currentPath = [_annotationPointFromEvent(e)];
  ann.currentPressures = [e.pressure || 0.5];
  try { annOverlay.setPointerCapture(e.pointerId); } catch (_) {}
  // 表示ロックは自動では有効化しない。ロック中は別途 ViewLock の操作ガードだけが働く。
  const ok = await _maybeEngageViewLockForStroke();
  if (ann.currentPointerId !== e.pointerId) return;
  if (!ok) {
    _resetAnnotationStrokeState();
    return;
  }
  ann.strokeReady = true;
  _renderAnnotationPreview();
  if (ann.strokeEndRequested) _finishAnnotationStroke();
});

annOverlay.addEventListener('pointermove', (e) => {
  if (!ann.drawing) return;
  _preventAnnotationPointerDefault(e);
  ann.currentPath.push(_annotationPointFromEvent(e));
  ann.currentPressures.push(e.pressure || 0.5);
  _renderAnnotationPreview();
});

annOverlay.addEventListener('pointerup', (e) => {
  if (!ann.drawing) return;
  _preventAnnotationPointerDefault(e);
  ann.strokeEndRequested = true;
  try { annOverlay.releasePointerCapture(e.pointerId); } catch (_) {}
  if (ann.strokeReady) _finishAnnotationStroke();
});

annOverlay.addEventListener('pointercancel', (e) => {
  if (!ann.drawing) return;
  _preventAnnotationPointerDefault(e);
  ann.strokeEndRequested = true;
  if (ann.strokeReady) _finishAnnotationStroke();
});

/* Source chunk: gb-annotations.part02.js */
// Audit-P2 H-7: document キャプチャで UI 要素の click/change をガードする
// スクロールコンテナ内のインタラクティブ要素のみ対象（タブバー・ヘッダー等は除外）。
if (typeof ViewLock !== 'undefined' && typeof ViewLock.installInteractionInterceptor === 'function') {
  try {
    ViewLock.installInteractionInterceptor(
      () => _getActiveViewLockInfo(),
      () => (typeof state !== 'undefined' && typeof _getScrollContainerForView === 'function')
        ? _getScrollContainerForView(state.view)
        : null,
    );
  } catch (_) {}
}

// 消しゴム
async function eraseAtPoint(cx, cy) {
  const pt = _toContentCoords(cx, cy);
  const x = pt.x, y = pt.y;
  // SVG要素をヒットテスト
  const layer = document.getElementById('ann-layer') || annOverlay;
  const els = Array.from(layer.querySelectorAll('path, polygon')).reverse();
  const tolerance = Math.max(8, ann.widths?.eraser || _ANN_WIDTH_LIMITS.eraser.fallback);
  for (const el of els) {
    if (el.classList.contains('ann-preview')) continue;
    if (_annElementHit(el, x, y, tolerance)) {
      const annId = el.dataset.annId;
      if (annId) {
        try {
          const before = await _fetchAnnotationHistoryRow(annId).catch(() => null);
          await apiDelete('/annotations/' + encodeURIComponent(annId));
          _pushAnnotationHistory('注釈: 消しゴム削除', before, null, annId);
        } catch {
          showStatus('削除に失敗', true);
          return;
        }
      }
      el.remove();
      _markAnnotationMutated(ann.targetPath);
      showStatus('削除しました');
      return;
    }
  }
}

// 付箋/コメント作成
async function createNote(cx, cy, shape) {
  const pt = _toContentCoords(cx, cy);
  const x = pt.x, y = pt.y;
  const targetPath = _resolveAnnotationWriteTarget();
  if (!targetPath) {
    showStatus('注釈の保存先が見つかりません', true);
    return;
  }

  const noteData = { x, y, width: 180, height: 100, text: '', html: '', user: getUsername() };
  try {
    const res = await apiPost('/annotations', {
      target_path: targetPath,
      type: 'comment',
      shape,
      data: noteData,
      color: ann.color,
      opacity: ann.opacity,
      user: getUsername(),
    });
    renderNote(res.id, shape, noteData, ann.color, ann.opacity, getUsername(), res.created);
    _setAnnotationRenderedTarget(targetPath);
    _markAnnotationMutated(targetPath);
    _pushAnnotationCreateHistory(res.id, '注釈: 付箋追加', targetPath).catch(() => {});
  } catch(e) { showStatus('付箋作成に失敗', true); }
}

function _annotationNoteUserName(user, data) {
  const local = (typeof getUsername === 'function') ? getUsername() : '';
  const saved = data?.user || '';
  if (user && user !== 'anonymous') return user;
  if (saved && saved !== 'anonymous') return saved;
  return local && local !== 'anonymous' ? local : (user || saved || 'anonymous');
}

function _annotationUserIconNode(username) {
  const wrap = document.createElement('span');
  wrap.className = 'ann-user-icon';
  if (typeof getUserAvatarHtml === 'function') {
    wrap.innerHTML = getUserAvatarHtml(username || 'anonymous', 16);
  } else if (typeof lucide === 'function') {
    wrap.innerHTML = lucide('userRound', 12);
  } else {
    wrap.textContent = (username || '?').charAt(0).toUpperCase();
  }
  return wrap;
}

function _annotationReadableTextFromEditor(editor) {
  return (editor?.innerText || '').replace(/\u00a0/g, ' ').trimEnd();
}

function _sanitizeAnnotationHtml(html) {
  const template = document.createElement('template');
  template.innerHTML = html || '';
  const allowed = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'S', 'STRIKE', 'SPAN', 'FONT', 'BR', 'DIV', 'P']);
  const cleanNode = (node) => {
    if (node.nodeType === Node.TEXT_NODE) return document.createTextNode(node.nodeValue || '');
    if (node.nodeType !== Node.ELEMENT_NODE) return document.createDocumentFragment();
    const tag = node.tagName;
    if (!allowed.has(tag)) {
      const frag = document.createDocumentFragment();
      node.childNodes.forEach(child => frag.appendChild(cleanNode(child)));
      return frag;
    }
    const out = document.createElement(tag === 'STRIKE' ? 's' : tag === 'FONT' ? 'span' : tag.toLowerCase());
    if (tag === 'SPAN' || tag === 'FONT') {
      const color = node.style?.color || node.getAttribute('color') || '';
      if (/^(#[0-9a-f]{3,8}|rgb[a]?\(|hsl[a]?\()/i.test(color)) out.style.color = color;
      const fontSize = node.style?.fontSize || '';
      if (/^\d{1,3}(\.\d{1,2})?px$/i.test(fontSize)) out.style.fontSize = fontSize;
      const fontFamily = node.style?.fontFamily || '';
      if (fontFamily && fontFamily.length < 120 && /^[\w\s"',.\-\u3040-\u30ff\u3400-\u9fff]+$/.test(fontFamily)) out.style.fontFamily = fontFamily;
      const fontWeight = node.style?.fontWeight || '';
      if (/^(bold|normal|[1-9]00)$/i.test(fontWeight)) out.style.fontWeight = fontWeight;
      const fontStyle = node.style?.fontStyle || '';
      if (/^(italic|normal)$/i.test(fontStyle)) out.style.fontStyle = fontStyle;
      const textDecoration = node.style?.textDecoration || '';
      if (/underline|line-through/i.test(textDecoration)) out.style.textDecoration = textDecoration;
      const bg = node.style?.backgroundColor || '';
      if (/^(#[0-9a-f]{3,8}|rgb[a]?\(|hsl[a]?\()/i.test(bg)) out.style.backgroundColor = bg;
      const strokeColor = node.style?.webkitTextStrokeColor || node.style?.textStrokeColor || '';
      if (/^(#[0-9a-f]{3,8}|rgb[a]?\(|hsl[a]?\()/i.test(strokeColor)) out.style.webkitTextStrokeColor = strokeColor;
      const strokeWidth = node.style?.webkitTextStrokeWidth || '';
      if (/^\d{1,2}(\.\d{1,2})?px$/i.test(strokeWidth)) out.style.webkitTextStrokeWidth = strokeWidth;
      if (out.style.webkitTextStrokeColor || out.style.webkitTextStrokeWidth) out.style.paintOrder = 'stroke fill';
      const boxShadow = node.style?.boxShadow || '';
      const safeShadow = /inset/i.test(boxShadow)
        && /\d{1,2}px/i.test(boxShadow)
        && /(currentcolor|#[0-9a-f]{3,8}|rgb[a]?\(|hsl[a]?\()/i.test(boxShadow)
        && !/[;{}]|url\(|expression\(/i.test(boxShadow);
      if (safeShadow) {
        out.style.boxShadow = boxShadow;
        out.style.paddingLeft = node.style?.paddingLeft || '6px';
      }
    }
    node.childNodes.forEach(child => out.appendChild(cleanNode(child)));
    return out;
  };
  const out = document.createElement('div');
  template.content.childNodes.forEach(child => out.appendChild(cleanNode(child)));
  return out.innerHTML;
}

function _annotationNotePayload(data, editor, note) {
  const html = _sanitizeAnnotationHtml(editor?.innerHTML || '');
  const text = _annotationReadableTextFromEditor(editor);
  return {
    ...data,
    text,
    html,
    width: Math.max(120, Math.round(note.offsetWidth || parseFloat(note.style.width) || data.width || 180)),
    height: Math.max(60, Math.round(note.offsetHeight || parseFloat(note.style.height) || data.height || 100)),
  };
}

function _applyAnnotationNoteColor(note, color) {
  const next = color || '#c48080';
  note.style.background = next;
  note.style.setProperty('--ann-note-color', next);
  note.style.setProperty('--ann-note-scroll-thumb', `color-mix(in srgb, ${next} 72%, var(--bg) 28%)`);
  note.style.setProperty('--ann-note-scroll-track', `color-mix(in srgb, ${next} 22%, transparent)`);
  note.querySelectorAll('.ann-tail-line line, .ann-tail-line polygon').forEach(el => {
    el.setAttribute('stroke', next);
    el.setAttribute('fill', next);
  });
}

function _createAnnotationEditor(data, scheduleSave, noteId) {
  const editor = document.createElement('div');
  editor.className = 'ann-note-editor';
  editor.contentEditable = 'true';
  if (noteId) editor.dataset.e2eId = `annotation-note-${noteId}-editor`;
  editor.setAttribute('role', 'textbox');
  editor.setAttribute('aria-multiline', 'true');
  if (data.html) editor.innerHTML = _sanitizeAnnotationHtml(data.html);
  else editor.textContent = data.text || '';
  editor.addEventListener('input', scheduleSave);
  editor.addEventListener('blur', scheduleSave);
  editor.addEventListener('mouseup', () => _scheduleAnnotationSelectionPopup(editor, scheduleSave));
  editor.addEventListener('pointerup', () => _scheduleAnnotationSelectionPopup(editor, scheduleSave));
  editor.addEventListener('keyup', (event) => {
    if (event.shiftKey || ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'a', 'A'].includes(event.key)) {
      _scheduleAnnotationSelectionPopup(editor, scheduleSave);
    }
  });
  return editor;
}

let _annSelectionPopupTimer = 0;

function _scheduleAnnotationSelectionPopup(editor, scheduleSave) {
  clearTimeout(_annSelectionPopupTimer);
  _annSelectionPopupTimer = window.setTimeout(() => _showAnnotationSelectionPopup(editor, scheduleSave), 40);
}

function _getAnnotationSelectionRange(editor) {
  const selection = window.getSelection?.();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);
  const root = range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
    ? range.commonAncestorContainer
    : range.commonAncestorContainer.parentElement;
  if (!root || !editor.contains(root)) return null;
  const rects = Array.from(range.getClientRects()).filter(rect => rect.width || rect.height);
  const rect = rects[0] || range.getBoundingClientRect();
  if (!rect || (!rect.width && !rect.height)) return null;
  return { range, rect };
}

function _annotationSelectionElement(range) {
  let node = range?.startContainer || null;
  if (node && node.nodeType !== Node.ELEMENT_NODE) node = node.parentElement;
  return node || null;
}

function _queryAnnotationSelectionValues(range) {
  const el = _annotationSelectionElement(range);
  const computed = el ? getComputedStyle(el) : null;
  const queryState = (command) => {
    try { return !!document.queryCommandState(command); } catch { return false; }
  };
  const queryValue = (command) => {
    try { return document.queryCommandValue(command) || ''; } catch { return ''; }
  };
  const fontWeight = computed?.fontWeight || '';
  return {
    textColor: queryValue('foreColor') || computed?.color || '',
    fontSize: parseInt(computed?.fontSize || '', 10) || '',
    fontFamily: computed?.fontFamily || '',
    fontWeight: queryState('bold') || fontWeight === 'bold' || Number(fontWeight) >= 600 ? 'bold' : '',
    fontStyle: queryState('italic') || computed?.fontStyle === 'italic' ? 'italic' : '',
    bgColor: computed && !/rgba?\(0,\s*0,\s*0,\s*0\)|transparent/i.test(computed.backgroundColor || '') ? computed.backgroundColor : '',
    textStrokeColor: computed?.webkitTextStrokeColor || '',
    textStrokeWidth: parseInt(computed?.webkitTextStrokeWidth || '', 10) || 0,
    leftAccent: /inset/i.test(computed?.boxShadow || ''),
    underline: queryState('underline') || /underline/.test(computed?.textDecorationLine || computed?.textDecoration || ''),
    accentColor: computed?.textDecorationColor || '',
    strike: queryState('strikeThrough') || /line-through/.test(computed?.textDecorationLine || computed?.textDecoration || ''),
  };
}

function _restoreAnnotationSelection(range) {
  if (!range) return;
  const selection = window.getSelection?.();
  if (!selection) return;
  selection.removeAllRanges();
  selection.addRange(range);
}

function _setAnnotationCommandState(command, enabled) {
  try {
    const current = !!document.queryCommandState(command);
    if (current !== !!enabled && typeof document.execCommand === 'function') {
      document.execCommand(command, false, null);
    }
  } catch {}
}

function _wrapAnnotationSelectionStyle(styles) {
  const selection = window.getSelection?.();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return;
  const range = selection.getRangeAt(0);
  const span = document.createElement('span');
  Object.entries(styles || {}).forEach(([key, value]) => {
    if (value != null && value !== '') span.style[key] = value;
  });
  if (!span.getAttribute('style')) return;
  try {
    range.surroundContents(span);
  } catch {
    const fragment = range.extractContents();
    span.appendChild(fragment);
    range.insertNode(span);
  }
  const nextRange = document.createRange();
  nextRange.selectNodeContents(span);
  selection.removeAllRanges();
  selection.addRange(nextRange);
}

function _applyAnnotationSelectionFormat(range, prop, value) {
  _restoreAnnotationSelection(range);
  if (prop === 'fontWeight') {
    _setAnnotationCommandState('bold', value === 'bold');
  } else if (prop === 'fontStyle') {
    _setAnnotationCommandState('italic', value === 'italic');
  } else if (prop === 'underline') {
    _setAnnotationCommandState('underline', !!value);
  } else if (prop === 'strike') {
    _setAnnotationCommandState('strikeThrough', !!value);
  } else if (prop === 'textColor') {
    const color = value || '#333333';
    try { document.execCommand('foreColor', false, color); } catch {}
  } else if (prop === 'bgColor') {
    _wrapAnnotationSelectionStyle({ backgroundColor: value || '' });
  } else if (prop === 'textStrokeColor') {
    _wrapAnnotationSelectionStyle({ webkitTextStrokeColor: value || '', paintOrder: value ? 'stroke fill' : '' });
  } else if (prop === 'textStrokeWidth') {
    const size = Number(value);
    _wrapAnnotationSelectionStyle({ webkitTextStrokeWidth: Number.isFinite(size) && size >= 0 ? size + 'px' : '' });
  } else if (prop === 'leftAccent') {
    _wrapAnnotationSelectionStyle(value ? { boxShadow: 'inset 3px 0 0 currentColor', paddingLeft: '6px' } : { boxShadow: '', paddingLeft: '' });
  } else if (prop === 'accentColor') {
    _wrapAnnotationSelectionStyle({ textDecorationColor: value || '', boxShadow: value ? `inset 3px 0 0 ${value}` : '' });
  } else if (prop === 'fontSize') {
    const size = Number(value);
    if (Number.isFinite(size) && size > 0) _wrapAnnotationSelectionStyle({ fontSize: Math.max(8, Math.min(96, size)) + 'px' });
  } else if (prop === 'fontFamily') {
    if (value) _wrapAnnotationSelectionStyle({ fontFamily: value });
  }
}

function _showAnnotationSelectionPopup(editor, scheduleSave) {
  if (typeof openFormatPopup !== 'function') return;
  const selectionInfo = _getAnnotationSelectionRange(editor);
  if (!selectionInfo) return;
  const savedRange = selectionInfo.range.cloneRange();
  const anchor = { getBoundingClientRect: () => selectionInfo.rect };
  const values = _queryAnnotationSelectionValues(selectionInfo.range);
  // 文字色スウォッチは values.bgColor をコントラスト背景として使う。
  // 付箋では選択範囲自体には背景が付かないことが多いため、
  // 付箋本体の色 (--ann-note-color) で上書きして実際に見える背景と一致させる。
  const noteEl = editor.closest?.('.ann-note');
  const noteColor = noteEl ? (noteEl.style.getPropertyValue('--ann-note-color') || noteEl.style.backgroundColor || '').trim() : '';
  if (noteColor) values.bgColor = noteColor;
  openFormatPopup(anchor, {
    positionAnchor: anchor,
    className: 'gb-fmt-popup--annotation-note',
    fields: ['textColor', 'fontSize', 'fontFamily', 'bold', 'italic', 'bgColor', 'leftAccent', 'accentColor', 'strike', 'underline'],
    values,
    onChange(prop, value) {
      _applyAnnotationSelectionFormat(savedRange, prop, value);
      scheduleSave();
    },
  });
}

function _contentCoordsFromNoteOffset(note) {
  let cx = note.offsetLeft;
  let cy = note.offsetTop;
  if (_annScrollContainer && !_isIframeView(state.view)) {
    cx += _annScrollContainer.scrollLeft;
    cy += _annScrollContainer.scrollTop;
  }
  return { x: cx, y: cy };
}

function _installAnnotationNoteResize(note, data, persist) {
  const dirs = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];
  dirs.forEach(dir => {
    const handle = document.createElement('span');
    handle.className = 'ann-note-resize-handle';
    handle.dataset.dir = dir;
    handle.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      note.classList.add('ann-note-selected');
      const start = {
        x: e.clientX,
        y: e.clientY,
        left: note.offsetLeft,
        top: note.offsetTop,
        width: note.offsetWidth,
        height: note.offsetHeight,
      };
      const minW = 120;
      const minH = 60;
      const onMove = (ev) => {
        const dx = ev.clientX - start.x;
        const dy = ev.clientY - start.y;
        let left = start.left;
        let top = start.top;
        let width = start.width;
        let height = start.height;
        if (dir.includes('e')) width = start.width + dx;
        if (dir.includes('s')) height = start.height + dy;
        if (dir.includes('w')) { width = start.width - dx; left = start.left + dx; }
        if (dir.includes('n')) { height = start.height - dy; top = start.top + dy; }
        if (width < minW) {
          if (dir.includes('w')) left -= minW - width;
          width = minW;
        }
        if (height < minH) {
          if (dir.includes('n')) top -= minH - height;
          height = minH;
        }
        note.style.left = left + 'px';
        note.style.top = top + 'px';
        note.style.width = width + 'px';
        note.style.height = height + 'px';
      };
      const onUp = () => {
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        const pos = _contentCoordsFromNoteOffset(note);
        data.x = pos.x;
        data.y = pos.y;
        data.width = Math.max(minW, Math.round(note.offsetWidth));
        data.height = Math.max(minH, Math.round(note.offsetHeight));
        note.dataset.baseX = String(data.x);
        note.dataset.baseY = String(data.y);
        persist();
      };
      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);
    });
    note.appendChild(handle);
  });
}

// フキダシのしっぽを追加（ドラッグで位置調整可能）
function addNoteTail(note, annId, data, initTailX, initTailY) {
  if (typeof AnnotationStickyTail === 'undefined' || typeof AnnotationStickyTail.setTail !== 'function') return;
  AnnotationStickyTail.setTail(note, {
    startX: (note.offsetWidth || data.width || 180) / 2,
    startY: (note.offsetHeight || data.height || 100) / 2,
    endX: Number(initTailX) + 5,
    endY: Number(initTailY) + 5,
    target: null,
  }, () => {
    const editor = note.querySelector('.ann-note-editor');
    _putAnnotationWithHistory(annId, { data: _annotationNotePayload(data, editor, note) }, '注釈: 付箋更新', annId).catch(() => {});
  });
}

function _isStandaloneAnnotationNoteItem(item, data) {
  if (!item || data?.deleted) return false;
  const type = String(item.type || '');
  const shape = String(item.shape || data?.shape || '');
  const hasPosition = data && (data.x != null || data.y != null || data.width != null || data.height != null);
  if (type === 'comment') {
    return shape === 'sticky' || data?.noteType === 'sticky' || hasPosition;
  }
  return type === 'note' || type === 'sticky';
}

function renderNote(id, shape, data, color, opacity, user, created) {
  // v5.0: 付箋は現在の注釈ホスト（アクティブなペイン）に配置する
  const mainArea = _getStandaloneAnnotationHost();
  const note = document.createElement('div');
  note.className = 'ann-note ' + shape;
  note.dataset.annId = id;
  note._annData = data;
  note.dataset.baseY = data.y; // スクロール同期用の基準Y
  note.draggable = true;
  note.addEventListener('dragstart', (e) => {
    const text = data.text || '付箋注釈';
    e.dataTransfer.setData('text/plain', '[注釈: ' + text.substring(0, 30) + '](annotation:' + id + ')');
    e.dataTransfer.setData('application/x-annotation', JSON.stringify({ id, text, shape }));
  });
  note.dataset.baseX = data.x;
  // スクロール分を引いて画面上の位置を計算
  const scrollY = (_annScrollContainer && !_isIframeView(state.view)) ? _annScrollContainer.scrollTop : 0;
  const scrollX = (_annScrollContainer && !_isIframeView(state.view)) ? _annScrollContainer.scrollLeft : 0;
  note.style.left = (data.x - scrollX) + 'px';
  note.style.top = (data.y - scrollY) + 'px';
  note.style.width = (data.width || 180) + 'px';
  note.style.height = (data.height || 100) + 'px';
  _applyAnnotationNoteColor(note, color);
  note.addEventListener('pointerdown', () => {
    document.querySelectorAll('.ann-note-selected').forEach(el => el.classList.remove('ann-note-selected'));
    note.classList.add('ann-note-selected');
  });

  // ヘッダー（ユーザー名・日時・削除ボタン）
  const header = document.createElement('div');
  header.className = 'ann-note-header';
  const dateStr = created ? created.substring(0, 16).replace('T', ' ') : '';
  const headerLabel = document.createElement('span');
  headerLabel.className = 'ann-note-user';
  const displayUser = _annotationNoteUserName(user, data);
  headerLabel.appendChild(_annotationUserIconNode(displayUser));
  const userText = document.createElement('span');
  userText.className = 'ann-user-name';
  userText.textContent = `${displayUser || ''}${dateStr ? ' ' + dateStr : ''}`.trim();
  headerLabel.appendChild(userText);
  const deleteBtn = document.createElement('span');
  deleteBtn.dataset.annDelete = '1';
  deleteBtn.style.cursor = 'pointer';
  deleteBtn.innerHTML = lucide('x', 12);
  deleteBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    deleteNote(id, note, { data, editor });
  });
  header.appendChild(headerLabel);
  header.appendChild(deleteBtn);
  note.appendChild(header);

  let editor;
  let saveTimer;
  const persist = () => {
    if (note.dataset.deleted === '1') return;
    const d = _annotationNotePayload(data, editor, note);
    data.text = d.text;
    data.html = d.html;
    data.width = d.width;
    data.height = d.height;
    _putAnnotationWithHistory(id, { data: d }, '注釈: 付箋更新', id).catch(() => {});
  };
  const scheduleSave = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(persist, 600);
  };
  editor = _createAnnotationEditor(data, scheduleSave, id);
  note.appendChild(editor);

  // ドラッグ移動
  let dragging = false, dragOff = { x: 0, y: 0 };
  const pointerCssPos = (ev) => {
    const z = (typeof _getZoom === 'function' ? _getZoom() : 1) || 1;
    return { x: ev.clientX / z, y: ev.clientY / z };
  };
  const onDragMove = (ev) => {
    if (!dragging) return;
    ev.preventDefault();
    const pt = pointerCssPos(ev);
    note.style.left = (pt.x - dragOff.x) + 'px';
    note.style.top = (pt.y - dragOff.y) + 'px';
  };
  const onDragEnd = () => {
    if (!dragging) return;
    dragging = false;
    note.draggable = true;
    document.removeEventListener('pointermove', onDragMove);
    document.removeEventListener('pointerup', onDragEnd);
    document.removeEventListener('pointercancel', onDragEnd);
    const pos = _contentCoordsFromNoteOffset(note);
    data.x = pos.x;
    data.y = pos.y;
    note.dataset.baseX = String(pos.x);
    note.dataset.baseY = String(pos.y);
    persist();
  };
  header.addEventListener('pointerdown', (e) => {
    if (e.target.closest('[data-action],[data-ann-delete]')) return;
    e.preventDefault();
    e.stopPropagation();
    dragging = true;
    note.draggable = false;
    const pt = pointerCssPos(e);
    dragOff.x = pt.x - note.offsetLeft;
    dragOff.y = pt.y - note.offsetTop;
    document.addEventListener('pointermove', onDragMove, { passive: false });
    document.addEventListener('pointerup', onDragEnd);
    document.addEventListener('pointercancel', onDragEnd);
  });

  _installAnnotationNoteResize(note, data, persist);
  if (typeof AnnotationStickyTail !== 'undefined') {
    AnnotationStickyTail.install(note, { data, persist, getColor: () => color });
  }

  // フキダシのしっぽ復元（保存データにtailがあれば）
  if (typeof AnnotationStickyTail === 'undefined' && data.tailX !== undefined && data.tailY !== undefined) {
    addNoteTail(note, id, data, data.tailX, data.tailY);
  }

  // 右クリックメニュー（色変更・フキダシしっぽ・削除）
  function _showAnnotationNoteContextMenu(e, noteEl) {
    document.querySelectorAll('._note-ctx-menu').forEach(m => m.remove());
    const menu = document.createElement('div');
    menu.className = '_note-ctx-menu';
    menu.style.cssText = 'position:fixed;z-index:210;background:var(--ui-popup-bg, var(--bg2));border:1px solid var(--border);border-radius:6px;padding:4px 0;box-shadow:0 4px 12px rgba(0,0,0,0.4);min-width:120px;';
    { const z = (typeof _getZoom === 'function') ? _getZoom() : (parseFloat(document.documentElement.style.zoom) || 1); menu.style.left = (e.clientX / z) + 'px'; menu.style.top = (e.clientY / z) + 'px'; }
    const hasTail = !!noteEl.querySelector('.ann-tail,.ann-tail-shape');
    // 色を変更
    const colorItem = document.createElement('div');
    colorItem.className = '_ctx-item';
    colorItem.dataset.action = 'color';
    colorItem.style.cssText = 'padding:6px 12px;cursor:pointer;font-size:12px;display:flex;align-items:center;gap:6px;';
    colorItem.innerHTML = lucide('palette',14) + ' 色を変更';
    menu.appendChild(colorItem);

    // フキダシのしっぽ サブメニュー
    const tailWrap = document.createElement('div');
    tailWrap.style.position = 'relative';
    const tailTrig = document.createElement('div');
    tailTrig.style.cssText = 'padding:6px 12px;cursor:pointer;font-size:12px;display:flex;align-items:center;gap:6px;';
    tailTrig.innerHTML = lucide('messageSquare',14) + ' フキダシのしっぽ' + submenuArrow();
    tailTrig.onmouseenter = () => { tailTrig.style.background='var(--bg4)'; };
    tailTrig.onmouseleave = () => { tailTrig.style.background=''; };
    const tailPanel = document.createElement('div');
    tailPanel.className = '_note-ctx-menu';
    tailPanel.style.cssText = 'display:none;min-width:100px;background:var(--bg2);border:1px solid var(--border);border-radius:6px;padding:4px 0;box-shadow:0 4px 12px rgba(0,0,0,0.4);z-index:211;';
    attachHoverSubmenu(tailTrig, tailPanel);
    [['追加する', false], ['削除する', true]].forEach(([label, isRemove]) => {
      const si = document.createElement('div');
      si.innerHTML = radioMark(hasTail === isRemove) + label;
      si.style.cssText = 'padding:6px 12px;cursor:pointer;font-size:12px;' + (hasTail === isRemove ? 'color:var(--accent);' : '');
      si.onmouseenter = () => { si.style.background='var(--bg4)'; };
      si.onmouseleave = () => { si.style.background=''; };
      si.addEventListener('click', () => {
        document.querySelectorAll('._note-ctx-menu').forEach(m => m.remove());
        if (isRemove) {
          if (typeof AnnotationStickyTail !== 'undefined') AnnotationStickyTail.removeTail(noteEl, null);
          noteEl.querySelectorAll('.ann-tail, .ann-tail-line, .ann-tail-shape, .ann-tail-handle').forEach(el => el.remove());
          delete data.tail;
          delete data.tailX;
          delete data.tailY;
          _putAnnotationWithHistory(id, { data: _annotationNotePayload(data, editor, noteEl) }, '注釈: 付箋更新', id).catch(() => {});
        } else {
          if (!noteEl.querySelector('.ann-tail,.ann-tail-shape')) {
            data.tailX = 0;
            data.tailY = 60;
            addNoteTail(noteEl, id, data, data.tailX, data.tailY);
            _putAnnotationWithHistory(id, { data: _annotationNotePayload(data, editor, noteEl) }, '注釈: 付箋更新', id).catch(() => {});
          }
        }
      });
      tailPanel.appendChild(si);
    });
    tailWrap.appendChild(tailTrig);
    tailWrap.appendChild(tailPanel);
    menu.appendChild(tailWrap);

    // 削除
    const deleteItem = document.createElement('div');
    deleteItem.className = '_ctx-item';
    deleteItem.dataset.action = 'delete';
    deleteItem.style.cssText = 'padding:6px 12px;cursor:pointer;font-size:12px;color:var(--red);display:flex;align-items:center;gap:6px;';
    deleteItem.innerHTML = lucide('trash2',14) + ' 削除';
    menu.appendChild(deleteItem);
    document.body.appendChild(menu);
    clampPopupToViewport(menu);
    colorItem.addEventListener('click', () => {
      menu.remove();
      openColorPalette(noteEl, color, (newColor) => {
        color = newColor;
        _applyAnnotationNoteColor(noteEl, newColor);
        _putAnnotationWithHistory(id, { color: newColor }, '注釈: 色変更', id).catch(() => {});
      });
    });
    deleteItem.addEventListener('click', () => {
      menu.remove();
      deleteNote(id, noteEl, { data, editor });
    });
    setTimeout(() => document.addEventListener('pointerdown', function h(ev) {
      const inAny = [...document.querySelectorAll('._note-ctx-menu')].some(m => m.contains(ev.target));
      if (!inAny) document.querySelectorAll('._note-ctx-menu').forEach(m => m.remove());
      else document.addEventListener('pointerdown', h, {once:true});
    }, {once:true}), 0);
  }

  note.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    _showAnnotationNoteContextMenu(e, note);
  });
  if (typeof addLongPressHandler === 'function') {
    addLongPressHandler(note, (e) => _showAnnotationNoteContextMenu(e, note));
  }

  // メニューボタン追加
  const moreBtn = document.createElement('span');
  moreBtn.className = 'note-more-btn';
  moreBtn.textContent = '\u22ef';
  moreBtn.title = 'メニュー';
  moreBtn.style.cssText = 'position:absolute;top:2px;right:2px;cursor:pointer;font-size:12px;color:var(--fg2);padding:2px 4px;border-radius:3px;z-index:5;';
  moreBtn.addEventListener('click', (ev) => { ev.stopPropagation(); _showAnnotationNoteContextMenu(ev, note); });
  note.appendChild(moreBtn);

  mainArea.appendChild(note);
}

async function deleteNote(id, el, options = {}) {
  if (!options.skipConfirm && typeof cfConfirm === 'function' && !await cfConfirm('この注釈を削除しますか？')) return false;
  const isNote = el?.classList?.contains('ann-note');
  const before = await _fetchAnnotationHistoryRow(id).catch(() => null);
  if (el) {
    el.dataset.deleted = '1';
    el.remove();
    _markAnnotationMutated(ann.targetPath);
  }
  try {
    const data = options.data || el?._annData || {};
    const editor = options.editor || el?.querySelector?.('.ann-note-editor') || null;
    if (isNote) {
      const payload = _annotationNotePayload(data, editor, el);
      payload.deleted = true;
      payload.deletedAt = new Date().toISOString();
      await apiPut('/annotations/' + encodeURIComponent(id), { data: payload });
      const after = await _fetchAnnotationHistoryRow(id).catch(() => null);
      _pushAnnotationHistory('注釈: 削除', before, after, id);
    } else {
      await apiDelete('/annotations/' + encodeURIComponent(id));
      _pushAnnotationHistory('注釈: 削除', before, null, id);
    }
    if (typeof showStatus === 'function') showStatus('削除しました');
    return true;
  } catch {
    if (typeof showStatus === 'function') showStatus('削除に失敗', true);
    return false;
  }
}

// アノテーション読み込み
async function loadAnnotations() {
  const layer = document.getElementById('ann-layer');
  const targetPath = ann.targetPath;
  const loadSeq = ++_annLoadSeq;
  const mutationSeq = _annMutationSeq;
  const targetKey = _normalizeAnnotationTargetPath(targetPath);
  if (!targetPath) {
    _clearStandaloneAnnotations();
    _setAnnotationRenderedTarget('');
    return;
  }
  if (_normalizeAnnotationTargetPath(_annRenderedTargetPath) !== targetKey) {
    _clearStandaloneAnnotations();
    _setAnnotationRenderedTarget(targetPath);
  }
  try {
    const items = await apiFetch('/annotations?target=' + encodeURIComponent(targetPath));
    if (
      loadSeq !== _annLoadSeq ||
      targetPath !== ann.targetPath ||
      (mutationSeq !== _annMutationSeq && _annotationMutationAffectsTarget(targetPath)) ||
      ann.drawing
    ) {
      return;
    }
    if (layer) layer.innerHTML = '';
    _forEachStandaloneAnnotationNote(el => el.remove());
    _setAnnotationRenderedTarget(targetPath);
    items.forEach(item => {
      const data = typeof item.data === 'string' ? JSON.parse(item.data) : item.data;
      if (_isStandaloneAnnotationNoteItem(item, data)) {
        renderNote(item.id, item.shape || 'sticky', data, item.color, item.opacity, item.user, item.created);
      } else if (item.type === 'comment' || item.type === 'note' || item.type === 'sticky') {
        return;
      } else if (item.type === 'lasso') {
        if (data.points) {
          const el = _createLassoEl(data.points, item.color, item.opacity);
          el.dataset.annId = item.id;
          layer.appendChild(el);
        }
      } else if (item.type === 'rect') {
        if (data && data.width != null && data.height != null) {
          const el = _createRectFillEl(data, item.color, item.opacity);
          el.dataset.annId = item.id;
          layer.appendChild(el);
        }
      } else {
        if (data.points) {
          const pathD = _pointsToSvgPath(data.points, data.pressures || [], item.type === 'stroke');
          const el = _createStrokeEl(pathD, item.color, item.opacity, data.pressures || [], item.type === 'stroke', data.width);
          el.dataset.annId = item.id;
          layer.appendChild(el);
        }
      }
    });
  } catch(e) {}
}

async function annClear() {
  if (!await cfConfirm('この画面の注釈をすべて削除しますか？')) return;
  const embedded = _usesEmbeddedAnnotationSurface(_getAnnotationViewName());
  const overlay = embedded ? null : document.getElementById('ann-overlay');
  const bridge = embedded ? _getBoardAnnotationControl() : null;
  let historyBefore = [];
  if (ann.targetPath) {
    try {
      historyBefore = await apiFetch('/annotations?target=' + encodeURIComponent(ann.targetPath));
    } catch {}
  }
  const ids = new Set();
  const softDeleted = new Map();
  overlay?.querySelectorAll('[data-ann-id]').forEach(el => { ids.add(el.dataset.annId); el.remove(); });
  bridge?.layer?.querySelectorAll('[data-ann-id]').forEach(el => { ids.add(el.dataset.annId); el.remove(); });
  document.querySelectorAll(embedded ? '.ann-note.ann-note-embedded' : '.ann-note:not(.ann-note-embedded)').forEach(el => {
    if (el.dataset.annId) {
      softDeleted.set(el.dataset.annId, { ...(el._annData || {}), deleted: true, deletedAt: new Date().toISOString() });
      ids.delete(el.dataset.annId);
    }
    el.remove();
  });
  if (embedded && ann.targetPath) {
    try {
      const items = await apiFetch('/annotations?target=' + encodeURIComponent(ann.targetPath));
      (items || []).forEach(item => {
        if (!item?.id) return;
        const data = typeof item.data === 'string' ? JSON.parse(item.data || '{}') : (item.data || {});
        if (_isStandaloneAnnotationNoteItem(item, data)) {
          softDeleted.set(item.id, { ...data, deleted: true, deletedAt: new Date().toISOString() });
          ids.delete(item.id);
        } else if (item.type === 'comment' || item.type === 'note' || item.type === 'sticky') {
          return;
        } else {
          ids.add(item.id);
        }
      });
    } catch {}
  }
  await Promise.all([
    ...[...ids].filter(id => !softDeleted.has(id)).map(id => apiDelete('/annotations/' + encodeURIComponent(id)).catch(() => {})),
    ...[...softDeleted.entries()].map(([id, data]) => apiPut('/annotations/' + encodeURIComponent(id), { data }).catch(() => {})),
  ]);
  let historyAfter = [];
  if (ann.targetPath) {
    try {
      historyAfter = await apiFetch('/annotations?target=' + encodeURIComponent(ann.targetPath));
    } catch {}
  }
  if (typeof _pushAnnotationBatchHistory === 'function') {
    _pushAnnotationBatchHistory('注釈: 全削除', historyBefore, historyAfter, ann.targetPath);
  }
  _markAnnotationMutated(ann.targetPath);
  showStatus('注釈を全削除しました');
}

// Alt+A → gb-shortcuts.js の中央ハンドラに移行済み

// ==============================
// アノテーション管理ビュー
// ==============================
async function openAnnotationManager() {
  if (typeof openRightPanelTab === 'function') openRightPanelTab('annotation');
  else if (typeof toggleRightPanelTab === 'function') toggleRightPanelTab('annotation');
  if (typeof loadRpAnnotationList === 'function') loadRpAnnotationList();
}

function jumpToAnnotation(targetPath) {
  // ターゲットパスからビューを推定して移動
  document.querySelector('.modal-overlay')?.remove();
  if (!targetPath) {
    showStatus('注釈の対象ファイルが見つかりません', true);
    return;
  }
  if (targetPath.includes('/設定/') || targetPath.includes('/DB')) {
    selectDatabase(targetPath);
  } else if (targetPath.endsWith('.scriptnote.json') || targetPath.endsWith('.scenario.json')) {
    if (typeof openScenarioInScriptNote === 'function') openScenarioInScriptNote(targetPath, targetPath.split('/').pop());
  } else {
    openPage(targetPath.split('/').pop(), targetPath);
  }
}
