      ? Math.max(gap, avoid.top - Math.min(ph, vertical.space) - gap)
      : avoid.bottom + gap;
    return { left, top, maxHeight: Math.max(72, vertical.space) };
  }

  const horizontal = candidates
    .filter(c => c.side === 'right' || c.side === 'left')
    .filter(c => c.space >= 72)
    .sort((a, b) => b.space - a.space)[0];
  if (horizontal) {
    const left = horizontal.side === 'left'
      ? Math.max(gap, avoid.left - Math.min(pw, horizontal.space) - gap)
      : avoid.right + gap;
    const top = _popupClampValue(horizontal.top, gap, maxTop);
    return { left, top, maxWidth: Math.max(72, horizontal.space) };
  }

  return {
    left: _popupClampValue(baseLeft, gap, maxLeft),
    top: _popupClampValue(baseTop, gap, maxTop),
  };
}

function positionPopup(popup, anchorRect, options = {}) {
  const z = _getZoom();
  const vw = document.documentElement.clientWidth;
  const vh = document.documentElement.clientHeight;
  const gap = options.gap ?? 4;
  // 'below' | 'right' | 'left'
  // 'left' はノート縦書き用。縦書きでは本文の続きが下に伸びるため、下へ開くと
  // 直後の文章を隠してしまう。'right' の鏡映しとして左側へ寄せる。
  const preferDirection = options.prefer || 'below';
  // anchorRectはgetBoundingClientRect()由来（viewport pixels）なのでCSS座標に変換
  const ar = _popupCssRect(anchorRect, z);
  const avoid = _popupCssRect(options.avoidRect, z);
  if (!ar) return;
  // 非表示でDOMに追加して測定
  popup.style.maxHeight = '';
  popup.style.maxWidth = '';
  popup.style.overflowY = '';
  popup.style.overflowX = '';
  popup.style.visibility = 'hidden';
  if (!popup.parentNode) document.body.appendChild(popup);
  const pw = popup.offsetWidth;
  const ph = popup.offsetHeight;
  let left, top;
  if (preferDirection === 'right') {
    // 右に表示、収まらなければ左
    left = ar.right + gap;
    if (left + pw > vw) left = Math.max(gap, ar.left - pw - gap);
    if (left + pw > vw) left = Math.max(gap, vw - pw - gap);
    top = ar.top;
  } else if (preferDirection === 'left') {
    // 左に表示、収まらなければ右
    left = ar.left - pw - gap;
    if (left < gap) left = Math.min(vw - pw - gap, ar.right + gap);
    if (left < gap) left = gap;
    top = ar.top;
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
  if (typeof window.GBUI?.createModal !== 'function') {
    throw new Error('確認ダイアログを初期化できませんでした。');
  }

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
  let confirmed = false;
  const modalApi = window.GBUI.createModal({
    id: dialogId,
    title: '確認',
    body,
    footer: buttonRow,
    variant: 'standard',
    extraClass: 'show-confirm-dialog',
    geometryKey: 'show-confirm-dialog',
    initialFocus: okBtn,
    returnFocus: focusReturnTarget || undefined,
    closeLabel: '確認を閉じる',
    closeOnEsc: true,
    closeOnOverlay: true,
    onClose: () => {
      if (confirmed) onOk?.();
      else onCancel?.();
    },
  });
  const { overlay, modal } = modalApi;
  overlay.classList.add('modal-overlay');
  overlay.dataset.e2eId = 'show-confirm-dialog-overlay';
  overlay.dataset.confirmDialog = '1';
  overlay._showConfirmDialogApi = modalApi;
  modal.dataset.e2eId = 'show-confirm-dialog';
  modal.setAttribute('role', 'alertdialog');
  modal.setAttribute('aria-label', '確認');
  modal.setAttribute('aria-describedby', dialogId + '-body');
  okBtn.addEventListener('click', () => {
    confirmed = true;
    modalApi.close('submit');
  });
  cancelBtn.addEventListener('click', () => modalApi.close('cancel'));
  modalApi.open();
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
