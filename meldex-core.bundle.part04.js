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
