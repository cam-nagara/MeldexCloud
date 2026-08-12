/**
 * Meldex Annotations & Overlay
 * アノテーション、付箋ノート、オーバーレイ描画
 */

function _annotationUiZoom() {
  const zoom = (typeof _getZoom === 'function')
    ? Number(_getZoom())
    : Number.parseFloat(document.documentElement?.style?.zoom || '1');
  return Math.max(0.1, Number.isFinite(zoom) ? zoom : 1);
}

function _normalizeAnnotationOpacity(value, fallback = 1) {
  const opacity = Number(value);
  if (!Number.isFinite(opacity)) return fallback;
  return Math.max(0, Math.min(1, opacity));
}

function _parseAnnotationData(item) {
  if (!item) return {};
  if (typeof item.data !== 'string') return item.data || {};
  try {
    return JSON.parse(item.data || '{}') || {};
  } catch {
    return null;
  }
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
    // 注釈ツールバー内のスクリーンショット・表示切替・全削除は、表示ロックと
    // 同じ外観を共有する正規ボタン。ツールバー外に残った旧ロックだけを除去する。
    if (el.id !== 'ann-view-lock-btn' && !el.closest('#ann-toolbar')) el.remove();
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
  btn.dataset.viewLockState = 'unsupported';
  btn.title = reason || 'このビューは表示ロック対象外です';
  btn.setAttribute('aria-label', btn.title);
  btn.setAttribute('aria-pressed', 'false');
  btn.setAttribute('aria-disabled', 'true');
  btn.classList.remove('vl-lock-icon-locked');
  btn.classList.add('vl-lock-icon-disabled');
  btn.innerHTML = typeof lucide === 'function' ? lucide('unlock', 14) : '<span class="ico ico-unlock" aria-hidden="true"></span>';
  btn.style.color = '';
  btn.style.opacity = '';
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
  const paneSep = info.viewKey.lastIndexOf('#');
  const paneId = paneSep >= 0 ? info.viewKey.slice(paneSep + 1) : '';
  const target = paneSep >= 0 ? info.viewKey.slice(0, paneSep) : info.viewKey;
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
  'entity', 'page', 'database', 'pivot', 'tree', 'gallery', 'kanban', 'timeline',
  'chart', 'graph', 'form', 'smart-db', 'compare', 'board', 'folder',
  'media', 'html', 'csv', 'scriptnote', 'calendar',
]);
const _ANNOTATION_DB_VIEW_TYPES = new Set([
  'database', 'pivot', 'tree', 'gallery', 'kanban', 'timeline', 'chart', 'graph', 'form', 'smart-db',
]);
// ビューワー安定化計画(app/docs/viewer-stability-common-ui-plan-2026-07-31.md「実装変更 > 3」):
// #html-iframe が信頼済みの内部ビューワー(viewer.html。画像/PDF)を表示している場合、
// 'html' ビューも「注釈編集を埋め込みサーフェス（iframe内蔵の注釈コントローラー）へ委譲する」
// 対象として扱う。外部URL・任意HTMLファイルのプレビュー（同じ#html-iframe/'html'ビューを使う）は
// _gbIsTrustedInternalViewerUrl が false を返すため対象外のまま。
function _getTrustedViewerIframeElement() {
  const iframe = document.getElementById('html-iframe');
  if (!iframe) return null;
  const src = iframe.getAttribute('src') || iframe.src || '';
  return (typeof window._gbIsTrustedInternalViewerUrl === 'function' && window._gbIsTrustedInternalViewerUrl(src)) ? iframe : null;
}
function _usesEmbeddedAnnotationSurface(viewName) {
  if (viewName === 'board') return true;
  if (viewName === 'html') return !!_getTrustedViewerIframeElement();
  return false;
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
// ビューワー(viewer.html)への配送: 新設のpostMessageタイプ viewer-ann-set-state のみを使う
// （既存の 'ann-set-state' ペイロードをそのまま積み替えて送るだけ。'ann-load' はビューワー側が
// 自前でシーンごとに読み込む設計のため未配線のまま。'ann-set-visibility'/'ann-set-opacity' は
// ビューワー側では完全スナップショットの一部（visible/opacity）として扱うため、ここで
// viewer-ann-set-state と同じ完全スナップショットへ合流させて配送する — 部分メッセージを
// 乱送しない設計（ビューワー残課題修正計画2026-08-04「3. 注釈座標と親画面連携」）。
function _dispatchAnnotationMessageToViewerIframe(msg) {
  if (msg?.type !== 'ann-set-state' && msg?.type !== 'ann-set-visibility' && msg?.type !== 'ann-set-opacity') return false;
  const iframe = _getTrustedViewerIframeElement();
  if (!iframe?.contentWindow) return false;
  try {
    iframe.contentWindow.postMessage({
      type: 'viewer-ann-set-state',
      active: msg.type === 'ann-set-state' ? msg.active : ann.active,
      visible: msg.type === 'ann-set-visibility' ? msg.visible : _overlayVisible,
      tool: msg.type === 'ann-set-state' ? msg.tool : ann.tool,
      color: msg.type === 'ann-set-state' ? msg.color : ann.color,
      opacity: msg.type === 'ann-set-opacity' ? msg.opacity : (msg.type === 'ann-set-state' ? msg.opacity : ann.opacity),
      widths: msg.type === 'ann-set-state' ? msg.widths : ann.widths,
      targetPath: msg.type === 'ann-set-state' ? msg.targetPath : ann.targetPath,
    }, window.location.origin);
    return true;
  } catch {
    return false;
  }
}
function _dispatchEmbeddedAnnotationMessage(msg) {
  const viewName = _getAnnotationViewName();
  if (!_usesEmbeddedAnnotationSurface(viewName)) return false;
  if (viewName === 'html') return _dispatchAnnotationMessageToViewerIframe(msg);
  const bridge = _getBoardAnnotationControl();
  if (bridge && typeof bridge.handleMessage === 'function') {
    bridge.handleMessage(msg);
    return true;
  }
  return false;
}

// ビューワー(viewer.html)からのpostMessage受信: iframe内蔵の注釈コントローラーが
// 実際にactive/drawing状態を変えた時（Aキー・右クリックメニュー・右サイドバー経由も含む）に
// 親側の右下フロートボタン／フローティングツールバーの見た目を追従させる。
// event.source === iframe.contentWindow と同一オリジンを検証してから適用する。
window.addEventListener('message', (ev) => {
  const iframe = _getTrustedViewerIframeElement();
  if (!iframe?.contentWindow || ev.source !== iframe.contentWindow) return;
  if (ev.origin !== window.location.origin && ev.origin !== 'null') return;
  const msg = ev.data;
  if (!msg || typeof msg.type !== 'string') return;
  if (msg.type === 'viewer-ann-state-changed') {
    const btn = document.getElementById('btn-tb-annotation');
    const toolbar = document.getElementById('ann-toolbar');
    if (btn) btn.classList.toggle('active', !!msg.active);
    if (toolbar) toolbar.classList.toggle('visible', !!msg.active);
    if (typeof ann !== 'undefined') ann.active = !!msg.active;
  }
  if (msg.type === 'viewer-ann-save-result') {
    _handleViewerAnnotationSaveResult(msg);
  }
});

// ビューワーiframe内の注釈保存結果を受け取る。失敗時のみ共通通知UIへ表示し、成功時は
// 保存済み状態の更新だけを行う（通知は出さない。ビューワー残課題修正計画2026-08-04「3」）。
const _VIEWER_ANN_ERROR_CODE_MESSAGES = {
  forbidden: '権限がないため注釈を保存できませんでした',
  not_found: '対象のファイルが見つからないため注釈を保存できませんでした',
  conflict: '他の変更と競合したため注釈を保存できませんでした（再読み込みしてください）',
  server_error: 'サーバーエラーのため注釈を保存できませんでした',
  http_error: '通信エラーのため注釈を保存できませんでした',
  network_error: 'ネットワークに接続できないため注釈を保存できませんでした',
  timeout: 'タイムアウトしたため注釈を保存できませんでした',
  unknown_error: '注釈を保存できませんでした',
};
const _VIEWER_ANN_ACTION_LABELS = { create: '作成', update: '更新', delete: '削除' };
function _handleViewerAnnotationSaveResult(msg) {
  if (msg?.ok) {
    // 成功時は保存済み状態の更新だけ行う（通知は出さない）。現状このUIには
    // 「未保存」インジケーターが無いため、追加のDOM更新は不要。
    return;
  }
  const actionLabel = _VIEWER_ANN_ACTION_LABELS[msg?.action] || '';
  const baseMessage = _VIEWER_ANN_ERROR_CODE_MESSAGES[msg?.errorCode] || _VIEWER_ANN_ERROR_CODE_MESSAGES.unknown_error;
  const text = actionLabel ? `注釈の${actionLabel}に失敗しました（${baseMessage}）` : baseMessage;
  if (typeof showStatus === 'function') showStatus(text, true);
}
function toggleOverlayVisibility() {
  _overlayVisible = !_overlayVisible;
  const overlay = document.getElementById('ann-overlay');
  const btn = document.getElementById('btn-overlay-toggle');
  const embedded = _usesEmbeddedAnnotationSurface(_getAnnotationViewName());
  // #ann-overlay は 'board'/'page' 等のペイン描画に付随する要素で、'html'（ビューワー埋め込み）
  // ペインだけがアクティブな画面（レイアウトツリーにボード/ページ系ペインが1つも無い状態）では
  // マウントされない。埋め込みビューワーへは _dispatchEmbeddedAnnotationMessage が別途状態を
  // 配送するため、ここでは存在確認してから触る（未マウント時はスキップし、以後の処理は続行する）。
  if (overlay) overlay.style.visibility = embedded ? 'hidden' : (_overlayVisible ? '' : 'hidden');
  // 付箋ノート（DOM要素）も連動
  _forEachStandaloneAnnotationNote(el => { el.style.visibility = (!embedded && _overlayVisible) ? '' : 'hidden'; });
  if (btn) {
    btn.classList.toggle('active', _overlayVisible);
    btn.innerHTML = lucide(_overlayVisible ? 'eye' : 'eyeOff', 18);
    btn.title = _overlayVisible ? '注釈表示中' : '注釈非表示中';
    btn.setAttribute('aria-label', _overlayVisible ? '注釈を非表示にする' : '注釈を表示する');
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
  const targetPath = ann.targetPath;
  const viewName = _getAnnotationViewName();
  const requestSeq = ++_annLoadSeq;
  apiFetch(_annotationTargetFetchUrl(targetPath)).then(items => {
    if (requestSeq !== _annLoadSeq) return;
    if (_getAnnotationViewName() !== viewName) return;
    if (_normalizeAnnotationTargetPath(targetPath) !== _normalizeAnnotationTargetPath(ann.targetPath)) return;
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
  return document.getElementById('ann-desktop-host')
    || document.getElementById('btn-tb-annotation')?.parentElement
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
  if (viewName === 'tree') return document.getElementById('tree-view');
  if (viewName === 'gallery') return document.getElementById('gallery-view');
  if (viewName === 'form') return document.getElementById('form-view');
  if (viewName === 'kanban') return document.getElementById('kanban-view');
  if (viewName === 'timeline') return document.getElementById('timeline-view');
  if (viewName === 'chart') return document.getElementById('chart-view');
  if (viewName === 'graph') return document.getElementById('graph-view');
  if (viewName === 'smart-db') return document.getElementById('smart-db-table-area') || document.getElementById('smart-db-view');
  if (viewName === 'compare') return document.getElementById('compare-view');
  if (viewName === 'folder') return document.getElementById('folder-grid');
  if (viewName === 'media') return document.getElementById('media-view');
  if (viewName === 'csv') {
    if (document.body?.dataset?.csvSheetMode === '1') return document.getElementById('pivot-view') || document.getElementById('db-view-container');
    return document.getElementById('csv-table-container') || document.getElementById('csv-view');
  }
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
  const zoom = _annotationUiZoom();
  let x = (clientX - rect.left) / zoom;
  let y = (clientY - rect.top) / zoom;
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
  pen: { min: 1, max: 48, fallback: 3 },
  marker: { min: 1, max: 48, fallback: 3 },
  eraser: { min: 1, max: 48, fallback: 3 },
};

const ann = {
  active: false,
  tool: 'pen', // pen, marker, polyline, ellipse-line, rect-line, lasso, ellipse-fill, rect, eraser, sticky
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
function _readTrayAnnotationHostQuery() {
  try {
    const params = new URLSearchParams(window.location.search || '');
    const targetPath = _normalizeAnnotationTargetPath(params.get('annotation_target') || '');
    const annotationId = String(params.get('annotation_id') || '').trim();
    if (params.get('tray') !== '1' || targetPath !== '_meldex/desktop' || !annotationId) return null;
    return {
      targetPath,
      annotationId,
      modified: '',
      pollTimer: 0,
      initialized: false,
    };
  } catch {
    return null;
  }
}
let _trayAnnotationHost = _readTrayAnnotationHostQuery();
function _configureTrayAnnotationHostFromLocation() {
  if (_trayAnnotationHost) return _trayAnnotationHost;
  _trayAnnotationHost = _readTrayAnnotationHostQuery();
  return _trayAnnotationHost;
}
function _isTrayAnnotationHost() {
  return !!_trayAnnotationHost;
}
function _trayAnnotationApiFetch(path, options) {
  if (_isTrayAnnotationHost() && typeof _origApiFetch === 'function') {
    return _origApiFetch(path, options);
  }
  return apiFetch(path, options);
}
function _trayAnnotationApiPut(path, body) {
  return _trayAnnotationApiFetch(path, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
}
function _trayAnnotationApiPost(path, body) {
  return _trayAnnotationApiFetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
}
let _annLoadSeq = 0;
let _annMutationSeq = 0;
let _annMutationTargetPath = '';
let _annRenderedTargetPath = '';
const _ANNOTATION_FETCH_LIMIT = 5000;
function _normalizeAnnotationTargetPath(path) {
  return String(path || '').replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+/g, '/');
}
function _annotationTargetFetchUrl(targetPath, limit = _ANNOTATION_FETCH_LIMIT) {
  const params = new URLSearchParams();
  params.set('target', targetPath || '');
  params.set('limit', String(limit));
  return '/annotations?' + params.toString();
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
  if (_isTrayAnnotationHost()) {
    ann.targetPath = _trayAnnotationHost.targetPath;
    return ann.targetPath;
  }
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
  const rows = await _trayAnnotationApiFetch('/annotations?ann_id=' + encodeURIComponent(annId) + '&limit=1');
  return _normalizeAnnotationHistoryRow(Array.isArray(rows) ? rows[0] : null);
}

function _refreshEmbeddedAnnotationHistoryTarget(targetPath) {
  const viewName = _getAnnotationViewName();
  if (!_usesEmbeddedAnnotationSurface(viewName)) return false;
  const activeTargetPath = (typeof getAnnotationTarget === 'function') ? getAnnotationTarget() : ann?.targetPath || '';
  const activeKey = _normalizeAnnotationTargetPath(activeTargetPath);
  const targetKey = _normalizeAnnotationTargetPath(targetPath || ann?.targetPath || activeTargetPath);
  if (targetKey && activeKey && targetKey !== activeKey) return true;
  if (!ann.targetPath && activeTargetPath) ann.targetPath = activeTargetPath;
  if (typeof _loadAnnotationsToIframe === 'function') _loadAnnotationsToIframe();
  return true;
}

function _refreshAnnotationHistoryTarget(row) {
  const targetPath = row?.target_path || ann?.targetPath || '';
  _markAnnotationMutated(targetPath);
  if (!_refreshEmbeddedAnnotationHistoryTarget(targetPath) && typeof loadAnnotations === 'function') loadAnnotations();
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
  const payload = { ...(body || {}) };
  if (_isTrayAnnotationHost() && _trayAnnotationHost.annotationId === String(annId)) {
    const expectedModified = _trayAnnotationHost.modified || before?.modified || '';
    if (expectedModified) payload.expected_modified = expectedModified;
  }
  if (_isTrayAnnotationHost()) {
    await _trayAnnotationApiPut('/annotations/' + encodeURIComponent(annId), payload);
  } else {
    await apiPut('/annotations/' + encodeURIComponent(annId), payload);
  }
  const after = await _fetchAnnotationHistoryRow(annId);
  if (_isTrayAnnotationHost() && _trayAnnotationHost.annotationId === String(annId)) {
    _trayAnnotationHost.modified = String(after?.modified || '');
  }
  _pushAnnotationHistory(label || '注釈: 更新', before, after, detail);
  return after;
}

function _loadAnnotationToolWidths() {
  const defaults = { pen: 3, marker: 3, eraser: 3 };
  try {
    const saved = JSON.parse(localStorage.getItem('meldex-ann-tool-widths') || '{}');
    const shared = _clampAnnotationToolWidth('pen', saved.pen ?? saved.marker ?? saved.eraser ?? defaults.pen);
    return {
      pen: shared,
      marker: shared,
      eraser: shared,
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
  const inputs = [...document.querySelectorAll('[data-ann-width-tool]')];
  const sharedInput = document.getElementById('ann-width-pen');
  if (!sharedInput) return;
  inputs.forEach(input => {
    if (input !== sharedInput) input.closest('.ann-width-control')?.setAttribute('hidden', '');
  });
  const host = sharedInput.closest('.ann-width-control');
  host?.setAttribute('title', '太さ');
  sharedInput.setAttribute('aria-label', '太さ');
  sharedInput.min = '1'; sharedInput.max = '48'; sharedInput.step = '1';
  const current = _clampAnnotationToolWidth('pen', ann.widths.pen);
  sharedInput.value = String(current);
  const label = document.getElementById('ann-width-pen-label');
  if (label) label.textContent = String(current);
  globalThis.GBUI?.refreshRangeFill?.(sharedInput);
  sharedInput.addEventListener('input', () => {
    const next = _clampAnnotationToolWidth('pen', sharedInput.value);
    ann.widths.pen = next; ann.widths.marker = next; ann.widths.eraser = next;
    inputs.forEach(input => { input.value = String(next); });
    sharedInput.value = String(next);
    if (label) label.textContent = String(next);
    globalThis.GBUI?.refreshRangeFill?.(sharedInput);
    _saveAnnotationToolWidths();
    _syncAnnStateToIframe();
    _updateAnnotationBrushCursor();
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
const _ANN_TOOL_GROUPS = {
  stroke: [
    { tool: 'pen', label: 'ペン', icon: 'pencil' },
    { tool: 'marker', label: 'マーカー', icon: 'highlighter' },
  ],
  line: [
    { tool: 'polyline', label: '折れ線', icon: 'spline' },
    { tool: 'ellipse-line', label: '円形', icon: 'circle' },
    { tool: 'rect-line', label: '矩形', icon: 'square' },
  ],
  fill: [
    { tool: 'lasso', label: '囲い塗り', icon: 'lasso' },
    { tool: 'ellipse-fill', label: '円形塗り', icon: 'circle' },
    { tool: 'rect', label: '矩形塗り', icon: 'square' },
  ],
};

function _annotationSelectTool(tool, sourceButton) {
  ann.tool = tool;
  document.querySelectorAll('#ann-toolbar .ann-tool[data-tool]').forEach(button => {
    const group = button.dataset.annToolGroup;
    const members = group ? (_ANN_TOOL_GROUPS[group] || []).map(item => item.tool) : [button.dataset.tool];
    button.classList.toggle('active', members.includes(tool));
    if (members.includes(tool)) button.dataset.tool = tool;
  });
  document.querySelectorAll('.ann-tool-popup').forEach(menu => menu.remove());
  _updateAnnotationBrushCursor();
  _syncAnnStateToIframe();
  sourceButton?.focus?.();
}

function _openAnnotationToolPopup(button, group) {
  document.querySelectorAll('.ann-tool-popup').forEach(menu => menu.remove());
  const items = _ANN_TOOL_GROUPS[group] || [];
  const menu = document.createElement('div');
  menu.className = 'ann-tool-popup';
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', button.getAttribute('aria-label') || '注釈ツール');
  items.forEach(item => {
    const option = document.createElement('button');
    option.type = 'button';
    option.className = 'ann-tool-popup-item';
    option.dataset.annSelectTool = item.tool;
    option.setAttribute('role', 'menuitemradio');
    option.setAttribute('aria-checked', String(ann.tool === item.tool));
    option.innerHTML = `${typeof lucide === 'function' ? lucide(item.icon, 14) : ''}<span>${item.label}</span>`;
    option.addEventListener('click', () => _annotationSelectTool(item.tool, button));
    menu.appendChild(option);
  });
  document.body.appendChild(menu);
  const rect = button.getBoundingClientRect();
  menu.style.left = Math.max(4, Math.min(innerWidth - menu.offsetWidth - 4, rect.left)) + 'px';
  menu.style.top = Math.max(4, rect.top - menu.offsetHeight - 4) + 'px';
  const close = event => {
    if (!menu.contains(event.target) && event.target !== button) {
      menu.remove();
      document.removeEventListener('pointerdown', close, true);
    }
  };
  setTimeout(() => document.addEventListener('pointerdown', close, true), 0);
  menu.querySelector('button')?.focus();
}

function _initAnnotationToolGroups() {
  const toolbar = document.getElementById('ann-toolbar');
  const pen = toolbar?.querySelector('[data-tool="pen"]');
  const marker = toolbar?.querySelector('[data-tool="marker"]');
  const fill = toolbar?.querySelector('[data-tool="lasso"]');
  const rectFill = toolbar?.querySelector('[data-tool="rect"]');
  if (!toolbar || !pen || !fill) return;
  pen.dataset.annToolGroup = 'stroke';
  pen.title = 'ストローク'; pen.setAttribute('aria-label', 'ストローク');
  marker?.remove();
  const line = document.createElement('button');
  line.type = 'button'; line.className = 'ann-tool'; line.dataset.tool = 'polyline'; line.dataset.annToolGroup = 'line';
  line.title = 'ライン'; line.setAttribute('aria-label', 'ライン');
  line.innerHTML = typeof lucide === 'function' ? lucide('spline', 14) : '⌁';
  fill.before(line);
  fill.dataset.annToolGroup = 'fill'; fill.title = '塗りつぶし'; fill.setAttribute('aria-label', '塗りつぶし');
  rectFill?.remove();
}

function _styleAnnotationUtilityButtons() {
  const toolbar = document.getElementById('ann-toolbar');
  const screenshotButton = toolbar?.querySelector('button[title="スクリーンショット撮影"], button[aria-label="スクリーンショット撮影"]');
  const overlayButton = document.getElementById('btn-overlay-toggle');
  const clearButton = toolbar?.querySelector('button[title="全削除"], button[aria-label="全削除"]');
  [screenshotButton, overlayButton, clearButton].forEach(button => button?.classList.add('vl-lock-icon', 'ann-tool'));
}

function _updateAnnotationBrushCursor() {
  const overlay = document.getElementById('ann-overlay');
  if (!overlay) return;
  if (ann.tool === 'sticky') { overlay.style.cursor = 'cell'; return; }
  const lineTools = new Set(['polyline', 'ellipse-line', 'rect-line']);
  if (!['pen', 'marker', 'eraser'].includes(ann.tool) && !lineTools.has(ann.tool)) { overlay.style.cursor = 'crosshair'; return; }
  const widthKey = lineTools.has(ann.tool) ? 'pen' : ann.tool;
  const width = Math.max(4, Math.min(48, Number(ann.widths?.[widthKey]) || 3));
  const size = Math.ceil(width + 6);
  const shape = ann.tool === 'marker'
    ? `<rect x="3" y="3" width="${width}" height="${width}" fill="rgba(255,255,255,.18)" stroke="white"/><rect x="2" y="2" width="${width + 2}" height="${width + 2}" fill="none" stroke="black"/>`
    : `<circle cx="${size / 2}" cy="${size / 2}" r="${width / 2}" fill="rgba(255,255,255,.12)" stroke="white"/><circle cx="${size / 2}" cy="${size / 2}" r="${width / 2 + 1}" fill="none" stroke="black"/>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${shape}</svg>`;
  overlay.style.cursor = `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${Math.floor(size / 2)} ${Math.floor(size / 2)}, crosshair`;
}
_initAnnotationToolGroups();
_styleAnnotationUtilityButtons();
document.querySelectorAll('#ann-toolbar .ann-tool[data-tool]').forEach(btn => {
  btn.addEventListener('click', () => {
    const group = btn.dataset.annToolGroup;
    if (group) _openAnnotationToolPopup(btn, group);
    else _annotationSelectTool(btn.dataset.tool, btn);
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
// 注釈ツールバーから右サイドバーを開く導線は重複するため撤去する。HTML生成物を
// 直接編集せず、正本スクリプトの初期化時に既存ボタンだけを除去する。
document.querySelector('#ann-toolbar [data-action="openRightPanelTab(\'annotation\')"]')?.remove();
{
  const overlayButton = document.getElementById('btn-overlay-toggle');
  _styleAnnotationUtilityButtons();
  if (overlayButton) {
    overlayButton.title = _overlayVisible ? '注釈表示中' : '注釈非表示中';
    overlayButton.setAttribute('aria-label', _overlayVisible ? '注釈を非表示にする' : '注釈を表示する');
  }
}
document.getElementById('ann-opacity').oninput = function() {
  ann.opacity = _normalizeAnnotationOpacity(parseFloat(this.value), 1);
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
  for (let i = 1; i < points.length - 1; i++) {
    const midX = (points[i][0] + points[i + 1][0]) / 2;
    const midY = (points[i][1] + points[i + 1][1]) / 2;
    d += ` Q ${points[i][0]} ${points[i][1]} ${midX} ${midY}`;
  }
  const last = points[points.length - 1];
  d += ` L ${last[0]} ${last[1]}`;
  return d;
}

function _createStrokeEl(pathD, color, opacity, pressures, isPen, width) {
  const path = document.createElementNS(_annSvgNS, 'path');
  path.setAttribute('d', pathD);
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', color);
  path.setAttribute('stroke-opacity', opacity);
  path.setAttribute('stroke-linecap', isPen ? 'round' : 'butt');
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
  if (el?.tagName?.toLowerCase?.() === 'rect') {
    const rx = Number(el.getAttribute('x')) || 0;
    const ry = Number(el.getAttribute('y')) || 0;
    const rw = Number(el.getAttribute('width')) || 0;
    const rh = Number(el.getAttribute('height')) || 0;
    if (x >= rx - tolerance && x <= rx + rw + tolerance && y >= ry - tolerance && y <= ry + rh + tolerance) return true;
  }
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
