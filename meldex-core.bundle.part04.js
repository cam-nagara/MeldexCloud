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
function showConfirmDialog(message, onOk, onCancel) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `<div class="modal" style="min-width:320px;max-width:480px;">
    <div class="modal-body" style="padding:16px 20px;font-size:13px;white-space:pre-wrap;color:var(--fg);">${typeof esc === 'function' ? esc(message) : message}</div>
    <div class="btn-row" style="display:flex;gap:8px;justify-content:flex-end;padding:8px 16px 16px;">
      <button type="button" class="cancel-btn">キャンセル</button>
      <button type="button" class="primary ok-btn">OK</button>
    </div>
  </div>`;
  overlay.querySelector('.ok-btn').addEventListener('click', () => { overlay.remove(); if (onOk) onOk(); });
  overlay.querySelector('.cancel-btn').addEventListener('click', () => { overlay.remove(); if (onCancel) onCancel(); });
  overlay.addEventListener('click', (e) => { if (e.target === overlay) { overlay.remove(); if (onCancel) onCancel(); } });
  document.body.appendChild(overlay);
  overlay.querySelector('.ok-btn').focus();
}

// ============================================================
// contentEditable外クリック時の即時blur（2回クリック問題の回避）
// ============================================================
// WebView2/Chromiumでは、contentEditable要素にフォーカスがある状態で
// その外をクリックすると、最初のクリックがフォーカス解除に消費され、
// ターゲットのクリックハンドラが動作しない。
// capture phaseでblurを先に実行することで、1回のクリックで操作可能にする。
document.addEventListener('pointerdown', (e) => {
  const focused = document.activeElement;
  if (focused && focused.contentEditable === 'true' && !focused.contains(e.target)) {
    focused.blur();
  }
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
    const onUp = () => {
      delete container._cbDragState;
      document.removeEventListener('pointerup', onUp, true);
      document.removeEventListener('pointercancel', onUp, true);
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
