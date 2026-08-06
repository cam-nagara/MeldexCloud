  } else {
    // 下に表示
    left = ar.left;
    top = ar.bottom + gap;
  }
  // 右端チェック
  if (left + pw > vw) left = Math.max(gap, vw - pw - gap);
  // 下端チェック
  const spaceBelow = vh - ar.bottom - gap;
  const spaceAbove = ar.top - gap;
  if (top + ph > vh) {
    if (ph <= spaceAbove) {
      top = ar.top - ph - gap;
    } else if (spaceBelow >= spaceAbove) {
      top = ar.bottom + gap;
      popup.style.maxHeight = Math.max(120, spaceBelow) + 'px';
      popup.style.overflowY = 'auto';
    } else {
      top = gap;
      popup.style.maxHeight = Math.max(120, spaceAbove) + 'px';
      popup.style.overflowY = 'auto';
    }
  }
  // 上端チェック
  if (top < gap) top = gap;
  if (avoid) {
    const fitted = _fitPopupAroundAvoidRect(left, top, pw, ph, vw, vh, gap, avoid);
    left = fitted.left;
    top = fitted.top;
    if (fitted.maxHeight != null) {
      popup.style.maxHeight = fitted.maxHeight + 'px';
      popup.style.overflowY = 'auto';
    }
    if (fitted.maxWidth != null) {
      popup.style.maxWidth = fitted.maxWidth + 'px';
      popup.style.overflowX = 'auto';
    }
  }
  popup.style.left = left + 'px';
  popup.style.top = top + 'px';
  popup.style.visibility = 'visible';
  // 最終安全策: clampPopupToViewportで確実にビューポート内に収める
  clampPopupToViewport(popup);
}

// ============================================================
// 長押し検知ヘルパー: iPad など contextmenu が安定しない環境向けに、
// タッチ/ペン入力の長押しで handler を発火させる。マウスは触らない
// （従来の contextmenu で右クリックメニューがそのまま使える）。
//
// 使い方:
//   addLongPressHandler(el, (ev) => { myMenuFn(ev, ...); });
//   ev は clientX/Y/target/currentTarget/preventDefault/stopPropagation を
//   持つ合成オブジェクト。既存の contextmenu ハンドラにそのまま渡せる。
// ============================================================
function addLongPressHandler(el, handler, opts = {}) {
  const DURATION = opts.duration ?? opts.delayMs ?? 500;
  const MOVE_THRESHOLD = opts.moveThreshold ?? opts.moveTolerance ?? 10;
  let timer = null;
  let startX = 0, startY = 0;
  let fired = false;
  let touchStartEv = null;

  const cancel = () => {
    if (timer) { clearTimeout(timer); timer = null; }
  };

  el.addEventListener('pointerdown', (e) => {
    // タッチと Apple Pencil 等のペン入力のみ対象。マウスは無視
    if (e.pointerType !== 'touch' && e.pointerType !== 'pen') return;
    if (e.button !== 0 && e.button !== undefined && e.button !== -1) return;
    cancel();
    fired = false;
    startX = e.clientX;
    startY = e.clientY;
    touchStartEv = e;
    timer = setTimeout(() => {
      timer = null;
      fired = true;
      handler({
        clientX: startX,
        clientY: startY,
        target: touchStartEv?.target || el,
        currentTarget: el,
        pointerType: touchStartEv?.pointerType || 'touch',
        preventDefault: () => {},
        stopPropagation: () => {},
      });
    }, DURATION);
  });

  el.addEventListener('pointermove', (e) => {
    if (!timer) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (dx * dx + dy * dy > MOVE_THRESHOLD * MOVE_THRESHOLD) cancel();
  });

  ['pointerup', 'pointercancel', 'pointerleave'].forEach((ev) => {
    el.addEventListener(ev, cancel);
  });

  // 長押し発火後の click / contextmenu は同ノードの他リスナーも含めて抑止
  // （stopPropagation だと同ノードの bubble リスナーが走る可能性があるため
  //  stopImmediatePropagation を使う）
  el.addEventListener('click', (e) => {
    if (fired) { e.stopImmediatePropagation(); e.preventDefault(); fired = false; }
  }, true);
  el.addEventListener('contextmenu', (e) => {
    if (fired) { e.stopImmediatePropagation(); e.preventDefault(); fired = false; }
  }, true);
}

function _isNativeContextMenuSurface(target) {
  if (!target || typeof target.closest !== 'function') return false;
  return !!target.closest('#html-view, #html-iframe');
}

// Meldex 全域でブラウザ標準右クリックメニューを抑止（input / textarea / HTMLビューワー は除外）。
// 旧 gb-editor.part04.js のルビハンドラ冒頭にあった同処理をここへ移管（capture phase）。
document.addEventListener('contextmenu', (e) => {
  if (_isNativeContextMenuSurface(e.target)) return;
  if (!e.target.matches('input, textarea')) e.preventDefault();
}, true);

// ============================================================
// 確認ダイアログ（モーダル）
// ============================================================
let _showConfirmDialogSeq = 0;
function showConfirmDialog(message, onOk, onCancel) {
  const focusReturnTarget = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const dialogId = 'show-confirm-dialog-' + (++_showConfirmDialogSeq);
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.dataset.e2eId = 'show-confirm-dialog-overlay';
  overlay.dataset.confirmDialog = '1';

  const modal = document.createElement('div');
  modal.className = 'modal show-confirm-dialog';
  modal.dataset.e2eId = 'show-confirm-dialog';
  modal.setAttribute('role', 'alertdialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-label', '確認');
  modal.setAttribute('aria-describedby', dialogId + '-body');
  modal.tabIndex = -1;

  const body = document.createElement('div');
  body.id = dialogId + '-body';
  body.className = 'modal-body show-confirm-dialog-body';
  body.dataset.e2eId = 'show-confirm-dialog-body';
  body.textContent = String(message ?? '');

  const buttonRow = document.createElement('div');
  buttonRow.className = 'btn-row show-confirm-dialog-actions';
  buttonRow.dataset.e2eId = 'show-confirm-dialog-actions';

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'cancel-btn';
  cancelBtn.dataset.e2eId = 'show-confirm-dialog-cancel';
  cancelBtn.textContent = 'キャンセル';

  const okBtn = document.createElement('button');
  okBtn.type = 'button';
  okBtn.className = 'primary ok-btn';
  okBtn.dataset.e2eId = 'show-confirm-dialog-ok';
  okBtn.textContent = 'OK';

  buttonRow.append(cancelBtn, okBtn);
  modal.append(body, buttonRow);
  overlay.appendChild(modal);

  let closed = false;
  const restoreFocus = () => {
    if (focusReturnTarget?.isConnected && typeof focusReturnTarget.focus === 'function') {
      try { focusReturnTarget.focus({ preventScroll: true }); } catch (_) { focusReturnTarget.focus(); }
    }
  };
  const queueFocusRestore = () => {
    setTimeout(() => {
      const active = document.activeElement;
      if (!active || !active.isConnected || active === document.body || active === document.documentElement || active === focusReturnTarget) {
        restoreFocus();
      }
    }, 0);
  };
  const close = (confirmed) => {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKeyDown);
    overlay.remove();
    restoreFocus();
    queueFocusRestore();
    if (confirmed) {
      if (onOk) onOk();
    } else if (onCancel) {
      onCancel();
    }
  };
  function onKeyDown(e) {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    close(false);
  }

  okBtn.addEventListener('click', () => close(true));
  cancelBtn.addEventListener('click', () => close(false));
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(false); });
  document.addEventListener('keydown', onKeyDown);
  document.body.appendChild(overlay);
  window.GBModalShell?.enhanceOverlay?.(overlay);
  setTimeout(() => {
    try { okBtn.focus({ preventScroll: true }); } catch (_) { okBtn.focus(); }
  }, 0);
  return overlay;
}

// ============================================================
// contentEditable外クリック時の即時blur（2回クリック問題の回避）
// ============================================================
// WebView2/Chromiumでは、contentEditable要素にフォーカスがある状態で
// その外をクリックすると、最初のクリックがフォーカス解除に消費され、
// ターゲットのクリックハンドラが動作しない。
// capture phaseでblurを先に実行することで、1回のクリックで操作可能にする。
function _focusedContentEditableHost(active = document.activeElement) {
  if (!active || active === document.body || active === document.documentElement) return null;
  if (active.contentEditable === 'true' || active.contentEditable === 'plaintext-only' || active.isContentEditable) {
    return active.closest?.('[contenteditable="true"], [contenteditable="plaintext-only"], [contenteditable]:not([contenteditable="false"])') || active;
  }
  return null;
}

document.addEventListener('pointerdown', (e) => {
  const focused = _focusedContentEditableHost();
  if (focused && !focused.contains(e.target)) focused.blur();
}, true);

// Export for ES module usage (optional)
if (typeof window !== 'undefined') {
  window.CF = {
    API_BASE, apiFetch, apiPost, apiPut,
    esc, formatFileSize, showStatus, getCssVar, rgbToHex,
    LUCIDE, lucide, fileTypeIcon, replaceIcons,
    FILE_TYPE_LABELS, NATIVE_TYPES, PALETTE_COLORS, PALETTE_BG_COLORS,
    inheritParentTheme, loadThemeFromServer,
    positionPopup,
    initIframeMarkup, initStandaloneMarkup, createMarkupToolbar,
  };
}

function enableCheckboxDragToggle(container, scopeSelector) {
  if (!container || container._cbDragToggleInstalled) return;
  container._cbDragToggleInstalled = true;
  container.addEventListener('pointerdown', (e) => {
    const cb = e.target.closest('input[type="checkbox"]');
    if (!cb || cb.disabled) return;
    if (scopeSelector && !cb.closest(scopeSelector)) return;
    const newState = !cb.checked;
    cb.checked = newState;
    cb.dispatchEvent(new Event('change', { bubbles: true }));
    container._cbDragState = { checked: newState };
    e.preventDefault();
    // pointerdown で手動トグル済みのため、同じチェックボックスへ届く後続の
    // ネイティブ click（既定のトグル動作）を1回だけ打ち消す。
    // これが無いと「pointerdownでON→clickでOFF」と往復し、クリックで切り替わらなくなる
    const suppressClick = (clickEv) => {
      // チェックボックス本体だけでなく、包んでいる label 経由の activation も打ち消す
      // （チェックボックスで押してラベル上で離した場合の二重トグル防止）
      const label = cb.closest('label');
      if (clickEv.target !== cb && !(label && label.contains(clickEv.target))) return;
      clickEv.preventDefault();
      clickEv.stopImmediatePropagation();
    };
    document.addEventListener('click', suppressClick, true);
    const onUp = () => {
      delete container._cbDragState;
      document.removeEventListener('pointerup', onUp, true);
      document.removeEventListener('pointercancel', onUp, true);
      // click は pointerup の後・同一タスク内で配送されるため、打ち消しは次のタスクで解除する
      setTimeout(() => document.removeEventListener('click', suppressClick, true), 0);
    };
    document.addEventListener('pointerup', onUp, true);
    document.addEventListener('pointercancel', onUp, true);
  });
  container.addEventListener('pointerover', (e) => {
    if (!container._cbDragState) return;
    const cb = e.target.closest('input[type="checkbox"]');
    if (!cb || cb.disabled) return;
    if (scopeSelector && !cb.closest(scopeSelector)) return;
    if (cb.checked === container._cbDragState.checked) return;
    cb.checked = container._cbDragState.checked;
    cb.dispatchEvent(new Event('change', { bubbles: true }));
  });
}
document.addEventListener('DOMContentLoaded', () => {
  enableCheckboxDragToggle(document.body, '.modal-overlay');
}, { once: true });
