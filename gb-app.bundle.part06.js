  if (max < min) return min;
  return Math.max(min, Math.min(max, value));
}

function _gbModalMinSize(modal) {
  const cs = getComputedStyle(modal);
  const minWidth = Math.max(240, parseFloat(cs.minWidth) || 0);
  const minHeight = Math.max(160, parseFloat(cs.minHeight) || 0);
  return { minWidth, minHeight };
}

function _gbIsMobileDialogSheetModal(modal) {
  if (!modal) return false;
  const overlay = modal.closest?.('.modal-overlay, .gb-modal-overlay, .gb-cal-modal-overlay, .link-modal-overlay');
  return overlay?.dataset?.mobileDialogSheetActive === '1'
    || modal.dataset.mobileDialogSheet === '1'
    || modal.classList?.contains('gb-mobile-dialog-sheet');
}

function _gbClampModalForNarrowViewport(modal) {
  if (!modal || window.innerWidth > 768) return;
  const gap = 8;
  const zoom = Math.max(0.1, (typeof _getZoom === 'function'
    ? Number(_getZoom())
    : Number.parseFloat(document.documentElement.style.zoom || '1')) || 1);
  const viewportWidth = window.innerWidth / zoom;
  const viewportHeight = (window.visualViewport?.height || window.innerHeight) / zoom;
  modal.style.minWidth = '0';
  modal.style.width = Math.max(240, viewportWidth - gap * 2) + 'px';
  modal.style.maxWidth = Math.max(240, viewportWidth - gap * 2) + 'px';
  modal.style.maxHeight = Math.max(160, viewportHeight - gap * 2) + 'px';
}

function _gbClearResizableModalState(modal) {
  if (!modal) return;
  if (modal.dataset?.gbResizableModal) delete modal.dataset.gbResizableModal;
  modal.classList?.remove('gb-modal-resizable');
  modal.querySelectorAll?.(':scope > .gb-modal-shell-edge').forEach(edge => edge.remove());
}

function _gbStartModalResize(event, modal, direction) {
  if (!modal || (event.button != null && event.button !== 0)) return;
  event.preventDefault();
  event.stopPropagation();
  const handle = event.currentTarget;
  try { handle?.setPointerCapture?.(event.pointerId); } catch (_) {}

  const rect = modal.getBoundingClientRect();
  const start = {
    x: event.clientX,
    y: event.clientY,
    left: rect.left,
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
    width: rect.width,
    height: rect.height,
  };
  const { minWidth, minHeight } = _gbModalMinSize(modal);
  const gap = 8;
  document.body.classList.add('gb-modal-resizing');

  function onMove(moveEvent) {
    moveEvent.preventDefault();
    const dx = moveEvent.clientX - start.x;
    const dy = moveEvent.clientY - start.y;
    const viewportW = window.innerWidth;
    const viewportH = window.innerHeight;
    let left = start.left;
    let top = start.top;
    let right = start.right;
    let bottom = start.bottom;

    if (direction.includes('e')) {
      right = _gbClampModalValue(start.right + dx, start.left + minWidth, viewportW - gap);
    }
    if (direction.includes('w')) {
      left = _gbClampModalValue(start.left + dx, gap, start.right - minWidth);
    }
    if (direction.includes('s')) {
      bottom = _gbClampModalValue(start.bottom + dy, start.top + minHeight, viewportH - gap);
    }
    if (direction.includes('n')) {
      top = _gbClampModalValue(start.top + dy, gap, start.bottom - minHeight);
    }

    modal.style.left = left + 'px';
    modal.style.top = top + 'px';
    modal.style.width = Math.max(minWidth, right - left) + 'px';
    modal.style.height = Math.max(minHeight, bottom - top) + 'px';
  }

  function onUp() {
    try { handle?.releasePointerCapture?.(event.pointerId); } catch (_) {}
    document.removeEventListener('pointermove', onMove, true);
    document.removeEventListener('pointerup', onUp, true);
    document.removeEventListener('pointercancel', onUp, true);
    document.body.classList.remove('gb-modal-resizing');
  }

  document.addEventListener('pointermove', onMove, true);
  document.addEventListener('pointerup', onUp, true);
  document.addEventListener('pointercancel', onUp, true);
}

function _gbInstallModalResizeEdges(modal) {
  if (!modal || modal.dataset.gbResizableModal === '1') return;
  if (_gbIsMobileDialogSheetModal(modal)) {
    _gbClearResizableModalState(modal);
    return;
  }
  modal.dataset.gbResizableModal = '1';
  modal.classList.add('gb-modal-resizable');
  modal.style.boxSizing = 'border-box';
  modal.style.position = 'absolute';
  modal.style.right = 'auto';
  modal.style.bottom = 'auto';
  modal.style.margin = '0';
  modal.style.transform = 'none';
  modal.style.maxWidth = 'calc(100vw - 16px)';
  modal.style.maxHeight = 'calc(100vh - 16px)';
  _gbClampModalForNarrowViewport(modal);

  _GB_MODAL_RESIZE_DIRECTIONS.forEach(direction => {
    const edge = document.createElement('div');
    edge.className = `gb-modal-shell-edge gb-modal-shell-edge-${direction}`;
    edge.dataset.modalResize = direction;
    edge.addEventListener('pointerdown', event => _gbStartModalResize(event, modal, direction));
    modal.appendChild(edge);
  });
}

function _gbPrepareResizableModal(modal) {
  if (!modal || modal.dataset.gbResizableModal === '1') return;
  if (_gbIsMobileDialogSheetModal(modal)) {
    _gbClearResizableModalState(modal);
    return;
  }
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (!modal.isConnected || modal.dataset.gbResizableModal === '1') return;
      if (_gbIsMobileDialogSheetModal(modal)) {
        _gbClearResizableModalState(modal);
        return;
      }
      _gbClampModalForNarrowViewport(modal);
      const rect = modal.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const gap = 8;
      const width = Math.min(rect.width, window.innerWidth - gap * 2);
      const height = Math.min(rect.height, window.innerHeight - gap * 2);
      const left = _gbClampModalValue(rect.left, gap, window.innerWidth - width - gap);
      const top = _gbClampModalValue(rect.top, gap, window.innerHeight - height - gap);
      modal.style.left = left + 'px';
      modal.style.top = top + 'px';
      modal.style.width = width + 'px';
      modal.style.height = height + 'px';
      _gbInstallModalResizeEdges(modal);
    });
  });
}

function _gbFindResizableModals(node) {
  const result = [];
  if (node?.matches?.(_GB_RESIZABLE_MODAL_SELECTOR) && !_gbIsMobileDialogSheetModal(node)) result.push(node);
  node?.querySelectorAll?.(_GB_RESIZABLE_MODAL_SELECTOR).forEach(modal => {
    if (!_gbIsMobileDialogSheetModal(modal)) result.push(modal);
  });
  return result;
}

// モーダル表示後にサイズを固定し、4辺+4隅でリサイズできるようにする
function _gbResizableModalMutationFilter(mutation) {
  return Array.from(mutation.addedNodes || []).some(node => {
    if (node?.nodeType !== 1) return false;
    return node.matches?.(_GB_RESIZABLE_MODAL_SELECTOR) || !!node.querySelector?.(_GB_RESIZABLE_MODAL_SELECTOR);
  });
}
function _gbResizableModalMutationCallback(mutations) {
  for (const m of mutations) {
    for (const node of m.addedNodes) {
      if (node.nodeType !== 1) continue;
      _gbFindResizableModals(node).forEach(_gbPrepareResizableModal);
    }
  }
}
if (window.GBMutationBus) {
  window.GBMutationBus.subscribe('gb-app-resizable-modals', {
    filter: _gbResizableModalMutationFilter,
    callback: _gbResizableModalMutationCallback,
    throttle: 30,
  });
} else {
  new MutationObserver(_gbResizableModalMutationCallback).observe(document.body, { childList: true, subtree: true });
}
/* ==============================
   起動
   ============================== */
replaceIcons();
loadColorSettings();
updateColorScheme();
updateUserIcon();
// UIスケール復元
// ページ離脱時の未保存データ保護
function _sendUnloadJson(url, method, body) {
  let requestMethod = method || 'POST';
  let requestBody = body || {};
  if (requestMethod === 'PUT' && String(url || '').includes('/value?')) {
    requestMethod = 'POST';
    requestBody = { ...requestBody, _unload_update: true };
  }
  const payload = JSON.stringify(requestBody);
  const blob = new Blob([payload], { type: 'application/json' });
  if (requestMethod === 'POST' && navigator.sendBeacon) {
    try {
      if (navigator.sendBeacon(url, blob)) return true;
    } catch {}
  }
  try {
    fetch(url, {
      method: requestMethod,
      headers: { 'Content-Type': 'application/json' },
      body: payload,
      keepalive: true,
    }).catch(() => {});
    return payload.length <= 60000;
  } catch {}
  return false;
}

window.addEventListener('beforeunload', (e) => {
  let unloadSaveQueued = true;
  // ノート: 未保存の自動保存タイマーが残っている場合、即座に保存
  if (window._noteAutoSaveTimer) {
    clearTimeout(window._noteAutoSaveTimer);
    window._noteAutoSaveTimer = null;
    const pc = document.getElementById('page-content');
    const currentPath = pc?.dataset?.path;
    if (currentPath) {
      const md = htmlToMd(pc?.innerHTML || '');
      const fm = pc.dataset.frontmatter || '';
      const full = fm ? fm + md : md;
      const body = typeof _noteSavePayload === 'function'
        ? _noteSavePayload(pc, full)
        : { content: full, if_match_etag: pc?.dataset?.lastSavedEtag || '', skip_if_missing: true };
      const noteSaveQueued = _sendUnloadJson(API_BASE + '/file?path=' + encodeURIComponent(currentPath), 'POST', body);
      unloadSaveQueued = noteSaveQueued && unloadSaveQueued;
      if (!noteSaveQueued) {
        window._noteAutoSaveTimer = setTimeout(() => {
          if (typeof flushPendingEditorAutosave === 'function') flushPendingEditorAutosave();
        }, 500);
      }
    }
  }
  // entity-freetext: 未保存タイマーが残っている場合
  if (window._ftAutoSaveTimer) {
    clearTimeout(window._ftAutoSaveTimer);
    const ft = document.getElementById('entity-freetext');
    const ep = ft?.dataset?.entityPath;
    if (ep) {
      const md = htmlToMd(ft?.innerHTML || '');
      const isEntry = ep.endsWith('.md');
      const url = isEntry
        ? API_BASE + '/value?path=' + encodeURIComponent(ep)
        : API_BASE + '/file?path=' + encodeURIComponent(ep + '/_freetext.md');
      const body = isEntry ? { new_body: md, skip_if_missing: true } : { content: md, skip_if_missing: true };
      unloadSaveQueued = _sendUnloadJson(url, isEntry ? 'PUT' : 'POST', body) && unloadSaveQueued;
    }
  }
  // キャンバス: 未保存タイマーが残っている場合
  if (window._bdTimer && typeof bd !== 'undefined' && bd.dirty && bd.path && typeof bdToMd === 'function') {
    const canSaveBoardPath = typeof _bdCanSaveCurrentBoardPath !== 'function' || _bdCanSaveCurrentBoardPath(bd.path);
    if (!canSaveBoardPath) {
      unloadSaveQueued = false;
    } else {
      clearTimeout(window._bdTimer);
      const boardSaveQueued = _sendUnloadJson(API_BASE + '/file?path=' + encodeURIComponent(bd.path), 'POST', { content: bdToMd(), skip_if_missing: true });
      unloadSaveQueued = boardSaveQueued && unloadSaveQueued;
      if (!boardSaveQueued) window._bdTimer = setTimeout(bdSave, 500);
    }
  }
  if (!unloadSaveQueued) {
    e.preventDefault();
    e.returnValue = '';
  }
});

// ノート縦書き復元
if (localStorage.getItem('note-vertical') === '1') {
  document.getElementById('page-content')?.classList.add('vertical-writing');
  const btn = document.getElementById('btn-note-vertical');
  if (btn) {
    // 上の replaceIcons() は既に実行済みなので、ここで lucide() を直接呼んで SVG を埋め込む
    btn.innerHTML = (typeof lucide === 'function') ? lucide('textAlignStart', 16) : '<span class="ico ico-textAlignStart"></span>';
    btn.title = '横書きに戻す';
    btn.classList.add('active');
  }
}
// ノート余白復元
if (typeof applyNoteMargin === 'function') applyNoteMargin();
if (typeof applyNoteContentMaxWidth === 'function') applyNoteContentMaxWidth();
// UIスケール復元
document.documentElement.style.fontSize = ''; // 旧font-sizeスケーリングをクリア
{
  const saved = localStorage.getItem('ui-scale');
  if (saved !== null) {
    // ユーザーが手動設定済み（または前回の自動設定値） → そのまま適用
    const s = parseInt(saved, 10) || 100;
    applyUIScale(s);
  } else {
    // 初回起動: 画面サイズから最適スケールを自動決定
    const autoScale = _detectOptimalScale();
    applyUIScale(autoScale);
    localStorage.setItem('ui-scale', String(autoScale));
  }
}

// ステータスバー表示状態復元
try {
  if (typeof applyStatusbarHidden === 'function') {
    applyStatusbarHidden(localStorage.getItem('meldex-statusbar-hidden') === '1');
  }
} catch (e) { console.warn('ステータスバー状態復元失敗:', e); }

function _detectOptimalScale() {
  const w = window.screen.width;
  const dpr = window.devicePixelRatio || 1;
  const isTouch = navigator.maxTouchPoints > 0;

  // スマホ（幅768px以下）: 100%のまま（レスポンシブCSSに任せる）
  if (w <= 768) return 100;
  // タブレット + タッチデバイス（幅769〜1366px）: タッチ操作のためやや拡大
  if (w <= 1366 && isTouch) return 110;
  // 高解像度デスクトップ（4K等、OS側のスケーリングが低い場合）
  if (w >= 2560 && dpr <= 1.5) return 125;
  // 通常デスクトップ
  return 100;
}

// Ctrl+ホイールでUIスケール変更（pywebviewではブラウザネイティブzoomが無効のため自前実装）
document.addEventListener('wheel', (e) => {
  if (!e.ctrlKey) return;
  // キャンバス・フォルダビュー等の独自ズームが処理する場合はスキップ
  const canvas = document.getElementById('bd-canvas');
  if (canvas && canvas.contains(e.target)) return;
  const folderGrid = document.getElementById('folder-grid');
  if (folderGrid && folderGrid.contains(e.target)) return;
  e.preventDefault();
  const steps = [67, 75, 80, 90, 100, 110, 125, 150, 175, 200];
  const cur = parseInt(localStorage.getItem('ui-scale') || '100', 10);
  const idx = steps.indexOf(cur);
  let newIdx;
  if (idx === -1) {
    // 現在値がステップ外の場合、最も近いステップを探す
    newIdx = steps.reduce((best, v, i) => Math.abs(v - cur) < Math.abs(steps[best] - cur) ? i : best, 0);
  } else {
    newIdx = e.deltaY < 0 ? Math.min(idx + 1, steps.length - 1) : Math.max(idx - 1, 0);
  }
  if (steps[newIdx] !== cur) {
    const applied = applyUIScale(steps[newIdx]);
    if (applied !== cur) showStatus('表示サイズ: ' + applied + '%');
  }
}, { passive: false });

// モバイルツールメニュー（トップバー折りたたみ時）
function showMobileToolMenu(e) {
  document.querySelectorAll('.mobile-tool-menu').forEach(el => el.remove());
  const btn = e.target.closest('button') || e.target;
  const items = [
    { label: 'フォルダ', action: () => openToolTab('folder') },
    { label: 'ノート', action: () => openToolTab('page') },
    { label: 'シート', action: () => openToolTab('database') },
    { label: 'スマートシート', action: () => openToolTab('smart-db') },
    { label: 'ボード', action: () => openToolTab('board') },
    null,
    { label: 'ビューワー', action: () => toggleRightPanelTab('preview') },
    { label: 'オプション', action: () => toggleOptionPanel() },
    null,
    { label: '注釈ツール', action: () => toggleAnnotationToolbar() },
    { label: 'オーバーレイ', action: () => toggleOverlayVisibility() },
  ];
  const menu = document.createElement('div');
  menu.className = 'gb-context-menu mobile-tool-menu';
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', 'ツールメニュー');
  menu.style.cssText = 'position:fixed;z-index:999;max-height:80vh;overflow-y:auto;';
  let menuClosed = false;
  let closeOnPointer = null;
  let closeOnKey = null;
  function closeMenu(restoreFocus = false) {
    if (menuClosed) return;
    menuClosed = true;
    document.removeEventListener('pointerdown', closeOnPointer, true);
    document.removeEventListener('keydown', closeOnKey, true);
    menu.remove();
    if (restoreFocus && typeof btn.focus === 'function') {
      try { btn.focus({ preventScroll: true }); } catch { btn.focus(); }
    }
  }
  function focusableItems() {
    return [...menu.querySelectorAll('.gb-context-menu-item')];
  }
  items.forEach(it => {
    if (!it) { const sep = document.createElement('div'); sep.className = 'gb-context-menu-sep'; sep.setAttribute('role', 'separator'); menu.appendChild(sep); return; }
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'gb-context-menu-item';
    row.setAttribute('role', 'menuitem');
    row.textContent = it.label;
    row.addEventListener('click', () => { closeMenu(false); try { it.action(); } catch {} });
    menu.appendChild(row);
  });
  document.body.appendChild(menu);
  const br = btn.getBoundingClientRect();
  if (typeof positionPopup === 'function') {
    positionPopup(menu, br, { prefer: 'bottom', gap: 2 });
  } else {
    { const z = _getZoom(); menu.style.left = Math.max(4, Math.min(br.left / z, window.innerWidth / z - menu.offsetWidth - 4)) + 'px'; menu.style.top = (br.bottom / z + 2) + 'px'; }
    if (typeof clampPopupToViewport === 'function') clampPopupToViewport(menu);
  }
  closeOnPointer = function closeMobileToolMenuOnPointer(ev) {
    if (!menu.contains(ev.target)) closeMenu(false);
  };
  closeOnKey = function closeMobileToolMenuOnKey(ev) {
    if (ev.key === 'Escape') {
      ev.preventDefault();
      closeMenu(true);
      return;
    }
    const rows = focusableItems();
    if (!rows.length) return;
    const currentIndex = Math.max(0, rows.indexOf(document.activeElement));
    let nextIndex = currentIndex;
    if (ev.key === 'ArrowDown') nextIndex = (currentIndex + 1) % rows.length;
    else if (ev.key === 'ArrowUp') nextIndex = (currentIndex - 1 + rows.length) % rows.length;
    else if (ev.key === 'Home') nextIndex = 0;
    else if (ev.key === 'End') nextIndex = rows.length - 1;
    else return;
    ev.preventDefault();
    rows[nextIndex]?.focus();
  };
  setTimeout(() => {
    if (menuClosed || !menu.isConnected) return;
    document.addEventListener('pointerdown', closeOnPointer, true);
    document.addEventListener('keydown', closeOnKey, true);
  }, 0);
  menu.querySelector('.gb-context-menu-item')?.focus();
}

// OS テーマ変更を監視
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (detectCurrentTheme() === 'OSに合わせる' || localStorage.getItem('editor-theme-name') === 'OSに合わせる') {
    applyThemePreset('OSに合わせる');
    saveColorSettings();
  }
});

// HTML ビューワーのナビゲーション
function htmlNavBack() { const f = document.getElementById('html-iframe'); if (f?.contentWindow) try { f.contentWindow.history.back(); } catch {} }
function htmlNavForward() { const f = document.getElementById('html-iframe'); if (f?.contentWindow) try { f.contentWindow.history.forward(); } catch {} }
function htmlNavigate(url) { if (!url) return; _gbSetHtmlViewerSrc(url); }
function htmlRefresh() { const f = _gbPrepareUntrustedIframe(document.getElementById('html-iframe')); if (f) try { f.contentWindow.location.reload(); } catch { f.src = f.src; } }

// ============================================================
// 最後のポインタ操作がフォルダツリー内かどうかを追跡
// gb-editor.js の Delete ハンドラが誤削除防止に使う
// ============================================================
document.addEventListener('pointerdown', (e) => {
  try {
    window._lastPointerInTree = !!(e.target && e.target.closest && e.target.closest('#outliner-tree'));
  } catch {}
}, true);

// ============================================================
// 共通コンテキストメニューの閉じる処理
// ============================================================
document.addEventListener('pointerdown', (e) => {
  if (!e.target?.closest?.('.gb-context-menu')) {
    document.querySelectorAll('.gb-context-menu').forEach(m => m.remove());
  }
}, true);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    document.querySelectorAll('.gb-context-menu').forEach(m => m.remove());
  }
});

// ============================================================
// 空状態表示
// ============================================================
function renderEmptyState(container, icon, message, hint) {
  container.innerHTML = `
    <div class="gb-empty-state">
      <div class="gb-empty-icon">${typeof lucide === 'function' ? lucide(icon, 48) : ''}</div>
      <div class="gb-empty-message">${esc(message)}</div>
      ${hint ? `<div class="gb-empty-hint">${esc(hint)}</div>` : ''}
    </div>`;
}

// ============================================================
// ローディング表示
// ============================================================
let _loadingCount = 0;
let _loadingTimer = null;
let _loadingVisible = false;
let _loadingMessage = '';

function _loadingText(msg) {
  return String(msg || _loadingMessage || '読み込み中...');
}

function _setLoadingNodeContent(el, msg) {
  if (!el) return;
  const spinner = document.createElement('span');
  spinner.className = 'gb-spinner';
  const label = document.createElement('span');
  label.className = 'gb-loading-label';
  label.textContent = _loadingText(msg);
  el.replaceChildren(spinner, label);
}

function _ensureGlobalLoadingIndicator() {
  let el = document.getElementById('gb-global-loading');
  if (el) return el;
  el = document.createElement('div');
  el.id = 'gb-global-loading';
  el.className = 'gb-global-loading';
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');
  el.setAttribute('aria-atomic', 'true');
  el.hidden = true;
  document.body.appendChild(el);
  return el;
}

function _renderLoadingUi(msg) {
  const text = _loadingText(msg);
  const statusEl = document.getElementById('sb-loading');
  if (statusEl) {
    _setLoadingNodeContent(statusEl, text);
    statusEl.style.display = '';
  }
  const floatingEl = _ensureGlobalLoadingIndicator();
  if (floatingEl) {
    _setLoadingNodeContent(floatingEl, text);
    floatingEl.hidden = false;
  }
  _loadingVisible = true;
}

function _hideLoadingUi() {
  const statusEl = document.getElementById('sb-loading');
  if (statusEl) {
    statusEl.replaceChildren();
    statusEl.style.display = 'none';
  }
  const floatingEl = document.getElementById('gb-global-loading');
  if (floatingEl) {
    floatingEl.replaceChildren();
    floatingEl.hidden = true;
  }
  _loadingVisible = false;
}

function _loadingPaintDelay() {
  return new Promise(resolve => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };
    if (typeof requestAnimationFrame === 'function' && document.visibilityState !== 'hidden') {
      requestAnimationFrame(() => requestAnimationFrame(finish));
      setTimeout(finish, 80);
    } else {
      setTimeout(finish, 0);
    }
  });
}

async function showLoadingBeforeHeavyWork(sizeOrText, msg, opts) {
  const options = opts || {};
  const threshold = Number.isFinite(options.threshold) ? options.threshold : 200000;
  const size = typeof sizeOrText === 'number'
    ? sizeOrText
    : String(sizeOrText || '').length;
  if (size < threshold) return;
  if (_loadingCount <= 0 && !_loadingVisible) return;
  _loadingMessage = _loadingText(msg);
  if (_loadingTimer) {
    clearTimeout(_loadingTimer);
    _loadingTimer = null;
  }
  _renderLoadingUi(_loadingMessage);
  await _loadingPaintDelay();
}

function showLoading(msg) {
  _loadingCount++;
  _loadingMessage = _loadingText(msg);
  if (_loadingVisible) {
    _renderLoadingUi(_loadingMessage);
    return;
  }
  if (!_loadingTimer) {
    _loadingTimer = setTimeout(() => {
      _loadingTimer = null;
      if (_loadingCount > 0) _renderLoadingUi(_loadingMessage);
    }, 300);
  }
}

function hideLoading() {
  _loadingCount = Math.max(0, _loadingCount - 1);
  if (_loadingCount === 0) {
    clearTimeout(_loadingTimer);
    _loadingTimer = null;
    _loadingMessage = '';
    _hideLoadingUi();
  }
}

function hideLoadingMessage(msg) {
  const expected = _loadingText(msg);
  if (!_loadingVisible && !_loadingTimer) return false;
  if (_loadingMessage && _loadingMessage !== expected) return false;
  const floatingEl = document.getElementById('gb-global-loading');
  const visibleText = (floatingEl?.textContent || '').trim();
  if (visibleText && visibleText !== expected) return false;
  _loadingCount = 0;
  clearTimeout(_loadingTimer);
  _loadingTimer = null;
  _loadingMessage = '';
  _hideLoadingUi();
  return true;
}

function trackIframeLoading(iframe, msg, opts) {
  const options = opts || {};
  if (!iframe || options.silent || options.skipGlobalUi) return;
  if (typeof showLoading !== 'function' || typeof hideLoading !== 'function') return;
  showLoading(msg || 'ビューアを読み込み中...');
  let done = false;
  let timer = null;
  const finish = () => {
    if (done) return;
    done = true;
    if (timer) clearTimeout(timer);
    iframe.removeEventListener('load', finish);
    iframe.removeEventListener('error', finish);
    hideLoading();
  };
  iframe.addEventListener('load', finish);
  iframe.addEventListener('error', finish);
  timer = setTimeout(finish, Number.isFinite(options.timeoutMs) ? options.timeoutMs : 15000);
}

// サーバーへの定期ハートビート（exe版: ブラウザ閉じたらサーバー自動終了用）
let _heartbeatTimer = null;

function _isHeartbeatCloudMode() {
  return window.MeldexRuntimeAdapter?.isDropboxMode?.() || document.body?.dataset?.cloudMode === 'dropbox';
}

function _sendHeartbeat() {
  fetch('/api/heartbeat', { method: 'POST' }).catch(() => {});
}

function _startHeartbeat() {
  _sendHeartbeat();
  if (_heartbeatTimer) return;
  _heartbeatTimer = setInterval(_sendHeartbeat, 10000);
}

function _stopHeartbeat() {
  if (!_heartbeatTimer) return;
  clearInterval(_heartbeatTimer);
  _heartbeatTimer = null;
}

function _syncHeartbeatForVisibility() {
  if (_isHeartbeatCloudMode()) {
    _stopHeartbeat();
    return;
  }
  _startHeartbeat();
}

document.addEventListener('visibilitychange', _syncHeartbeatForVisibility);
if (document.body && typeof MutationObserver !== 'undefined') {
  new MutationObserver(_syncHeartbeatForVisibility).observe(document.body, {
    attributes: true,
    attributeFilter: ['data-cloud-mode'],
  });
}
_syncHeartbeatForVisibility();
