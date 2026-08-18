// ============================================================================
// gb-dock-popup.js — ドックバーアイコンのポップアップ一時表示 (Phase 5)
// ============================================================================
// 対象パネルの DOM 要素を一時的にポップアップへ移動して表示。ポップアップを
// 閉じたら元の位置に戻す。8方向リサイズ / 外クリック / Escape / 再クリックで
// 閉じる。同時表示は1つのみ。
// ============================================================================
(function () {
  'use strict';

  const Z_INDEX = 10050;
  const MIN_W = 200;
  const MIN_H = 150;
  const DEFAULT_W_RATIO = 0.6;
  const DEFAULT_H_RATIO = 0.8;
  const DEFAULT_OUTLINER_W = 260;
  const DEFAULT_RIGHT_DOCK_W = 360;
  const POPUP_OWNED_FLOATING_SELECTORS = [
    '.gb-context-menu',
    '.ab-dropdown',
    '.tool-menu-dropdown',
    '.status-dropdown',
    '.cell-inline-dd',
    '.user-dropdown',
    '#chat-title-dropdown',
    '.gb-palette-popup',
    '.gb-fmt-popup',
    '.sn2-header-popup',
    '._note-ctx-menu',
    '.db-picker-popup',
    '.cmd-palette',
    '.modal-overlay',
    '.gb-modal-overlay',
    '.gb-cal-modal-overlay',
    '.link-modal-overlay',
  ];

  let _popup = null;          // DOM element
  let _state = null;          // { panelsetId, groupId, paneId, tabId, tabType, originalParent, originalNextSibling, paneEl }
  let _resizeState = null;    // 現在リサイズ中の状態
  let _clickListener = null;
  let _keyListener = null;
  let _resizeWindowListener = null;
  let _suppressOutsidePointerUntil = 0;

  function isOpen() { return !!_popup; }

  function _dockPopupZoom() {
    const z = (typeof _getZoom === 'function')
      ? Number(_getZoom())
      : parseFloat(document.documentElement.style.zoom || '1');
    return Number.isFinite(z) && z > 0 ? z : 1;
  }

  function _viewportCssSize() {
    const z = _dockPopupZoom();
    return {
      w: Math.max(MIN_W, (window.innerWidth || document.documentElement.clientWidth || MIN_W) / z - 16),
      h: Math.max(MIN_H, (window.innerHeight || document.documentElement.clientHeight || MIN_H) / z - 16),
    };
  }

  function _clampPopupSize(size) {
    const viewport = _viewportCssSize();
    const w = Number(size?.w);
    const h = Number(size?.h);
    return {
      w: Math.max(MIN_W, Math.min(Number.isFinite(w) ? w : MIN_W, viewport.w)),
      h: Math.max(MIN_H, Math.min(Number.isFinite(h) ? h : MIN_H, viewport.h)),
    };
  }

  function _clampPopupRect(rect) {
    const viewport = _viewportCssSize();
    const size = _clampPopupSize({ w: rect?.w, h: rect?.h });
    const maxLeft = Math.max(8, viewport.w - size.w - 8);
    const maxTop = Math.max(8, viewport.h - size.h - 8);
    const rawLeft = Number(rect?.left);
    const rawTop = Number(rect?.top);
    return {
      left: Math.max(8, Math.min(Number.isFinite(rawLeft) ? rawLeft : 8, maxLeft)),
      top: Math.max(8, Math.min(Number.isFinite(rawTop) ? rawTop : 8, maxTop)),
      w: size.w,
      h: size.h,
    };
  }

  function _applyPopupRect(popup, rect) {
    const next = _clampPopupRect(rect);
    popup.style.left = next.left + 'px';
    popup.style.top = next.top + 'px';
    popup.style.width = next.w + 'px';
    popup.style.height = next.h + 'px';
    return next;
  }

  function _collectPanelsetTabTypes(panelsetNode) {
    const types = [];
    const walk = (node) => {
      if (!node) return;
      if (node.type === 'pane') {
        (node.tabs || []).forEach(tab => { if (tab?.type) types.push(tab.type); });
        return;
      }
      if (node.type === 'split') (node.children || []).forEach(walk);
      if (node.type === 'panelset') (node.groups || []).forEach(group => walk(group?.root));
    };
    (panelsetNode?.groups || []).forEach(group => walk(group?.root));
    return types;
  }

  function _inferDefaultPopupWidth(panelsetNode) {
    const explicit = Number(panelsetNode?.defaultPopupWidth || 0);
    if (explicit > 0) return explicit;
    const types = _collectPanelsetTabTypes(panelsetNode);
    if (types.includes('outliner')) return DEFAULT_OUTLINER_W;
    const rightDockTypes = new Set(['preview', 'timer', 'detail', 'version', 'chat', 'calendar', 'history', 'annotation']);
    if (types.some(type => rightDockTypes.has(type))) return DEFAULT_RIGHT_DOCK_W;
    return 0;
  }

  function _defaultRect(anchorEl, panelsetNode) {
    // 初期レイアウト由来の既定幅がある場合はパネル幅と揃える。
    // ユーザーがリサイズした後は panelset.popupRect が優先される。
    const parent = anchorEl?.closest?.('.gb-dock') || anchorEl?.closest?.('.gb-column') || document.body;
    const rect = parent.getBoundingClientRect();
    const z = _dockPopupZoom();
    const defaultWidth = _inferDefaultPopupWidth(panelsetNode);
    const rawW = defaultWidth > 0 ? Math.max(MIN_W, Math.round(defaultWidth)) : Math.max(MIN_W, Math.floor((rect.width / z) * DEFAULT_W_RATIO));
    const rawH = Math.max(MIN_H, Math.floor((rect.height / z) * DEFAULT_H_RATIO));
    return _clampPopupSize({ w: rawW, h: rawH });
  }

  function _positionPopup(popup, anchorEl, size) {
    const safeSize = _clampPopupSize(size);
    const anchorRect = anchorEl?.getBoundingClientRect?.();
    if (!anchorRect) {
      _applyPopupRect(popup, { left: 100, top: 100, w: safeSize.w, h: safeSize.h });
      return;
    }
    const z = _dockPopupZoom();
    const vw = (window.innerWidth || document.documentElement.clientWidth) / z;
    const vh = (window.innerHeight || document.documentElement.clientHeight) / z;
    const cssAnchor = {
      left: anchorRect.left / z,
      right: anchorRect.right / z,
      top: anchorRect.top / z,
    };
    // ドックバーは右側にあるため、ポップアップはアンカーの左側に開く。
    // 左側に入らなければ右側へフォールバック。
    let left = cssAnchor.left - safeSize.w - 2;
    if (left < 8) left = Math.min(vw - safeSize.w - 8, cssAnchor.right + 2);
    if (left < 8) left = 8;
    let top = cssAnchor.top;
    if (top + safeSize.h > vh - 8) top = Math.max(8, vh - safeSize.h - 8);
    _applyPopupRect(popup, { left, top, w: safeSize.w, h: safeSize.h });
  }

  function _buildPopupDom(title) {
    const el = document.createElement('div');
    el.className = 'gb-dock-popup';
    el.style.zIndex = String(Z_INDEX);
    el.innerHTML = `
      <div class="gb-dock-popup-header">
        <span class="gb-dock-popup-title"></span>
        <button type="button" class="gb-dock-popup-close" data-e2e-id="dock-popup-close" aria-label="閉じる" title="閉じる">×</button>
      </div>
      <div class="gb-dock-popup-body"></div>
      <div class="gb-dock-popup-resize-handle" data-dir="n"></div>
      <div class="gb-dock-popup-resize-handle" data-dir="e"></div>
      <div class="gb-dock-popup-resize-handle" data-dir="s"></div>
      <div class="gb-dock-popup-resize-handle" data-dir="w"></div>
      <div class="gb-dock-popup-resize-handle" data-dir="ne"></div>
      <div class="gb-dock-popup-resize-handle" data-dir="se"></div>
      <div class="gb-dock-popup-resize-handle" data-dir="sw"></div>
      <div class="gb-dock-popup-resize-handle" data-dir="nw"></div>
    `;
    el.querySelector('.gb-dock-popup-title').textContent = title || '';
    el.querySelector('.gb-dock-popup-close').addEventListener('click', (e) => {
      e.stopPropagation();
      closePopup();
    });
    // 内部でのドラッグでページ遷移等を起こさない
    el.addEventListener('dragover', (e) => { e.preventDefault(); });
    return el;
  }

  function _findPaneElement(paneId) {
    if (!paneId) return null;
    const escapedId = (typeof CSS !== 'undefined' && typeof CSS.escape === 'function')
      ? CSS.escape(paneId)
      : String(paneId).replace(/["\\]/g, '\\$&');
    return document.querySelector(`.gb-pane[data-pane-id="${escapedId}"]`);
  }

  function _setPopupTargetState(panelsetNode, groupId, paneNode, tabIdx) {
    // ポップアップは一時表示なので panelsetNode.activeGroupId は変更しない。
    // ここで active group を永続変更すると、チャット復元や内部タブ操作から
    // revealPane() が走った時に折りたたみドックが展開されてしまう。
    if (paneNode && Number.isInteger(tabIdx) && paneNode.activeTabIndex !== tabIdx) {
      paneNode.activeTabIndex = tabIdx;
    }
  }

  function _syncPopupPaneDom(paneEl, paneNode) {
    if (!paneEl || !paneNode) return;
    const activeIndex = Number.isInteger(paneNode.activeTabIndex) ? paneNode.activeTabIndex : 0;
    paneEl.querySelectorAll('.gb-tab').forEach((el, idx) => {
      el.classList.toggle('active', idx === activeIndex);
    });
    if (typeof GBPaneBridge?.refreshPaneAfterTabSwitch === 'function') {
      GBPaneBridge.refreshPaneAfterTabSwitch(paneNode.id, { dockPopup: true });
    } else if (typeof GBPaneBridge?.mountAllPanes === 'function') {
      GBPaneBridge.mountAllPanes();
    }
    if (typeof replaceIcons === 'function') replaceIcons();
  }

  function _bindPopupTabActivation(popup, paneNode) {
    if (!popup || !paneNode) return;
    popup.addEventListener('click', (e) => {
      const tabEl = e.target?.closest?.('.gb-tab[data-tab-id]');
      if (!tabEl || !popup.contains(tabEl)) return;
      e.preventDefault();
      e.stopPropagation();
      if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
      const tabId = tabEl.dataset.tabId || '';
      const tabIdx = (paneNode.tabs || []).findIndex((t) => t?.id === tabId);
      if (tabIdx < 0) return;
      paneNode.activeTabIndex = tabIdx;
      const tab = paneNode.tabs[tabIdx];
      const titleEl = popup.querySelector('.gb-dock-popup-title');
      if (titleEl) titleEl.textContent = tab?.label || '';
      if (_state && _state.paneId === paneNode.id) {
        _state.tabId = tab?.id || '';
        _state.tabType = tab?.type || '';
        _state.tabIdx = tabIdx;
      }
      _syncPopupPaneDom(_state?.paneEl || _findPaneElement(paneNode.id), paneNode);
    }, true);
  }

  function _markPopupInternalInteraction() {
    _suppressOutsidePointerUntil = Date.now() + 1500;
  }

  function _markNativeControlInteraction() {
    _markPopupInternalInteraction();
  }

  function _isNativePopupControl(el) {
    return !!el?.closest?.('select');
  }

  function _isPopupOwnedFloatingElement(el) {
    if (!el?.closest) return false;
    try {
      return POPUP_OWNED_FLOATING_SELECTORS.some(selector => !!el.closest(selector));
    } catch {
      return false;
    }
  }

  function _bindNativeControlGuard(popup) {
    if (!popup) return;
    popup.addEventListener('pointerdown', (event) => {
      if (_isNativePopupControl(event.target)) _markNativeControlInteraction();
    }, true);
    popup.addEventListener('mousedown', (event) => {
      if (_isNativePopupControl(event.target)) _markNativeControlInteraction();
    }, true);
    popup.addEventListener('focusin', (event) => {
      if (_isNativePopupControl(event.target)) _markNativeControlInteraction();
    }, true);
    popup.addEventListener('change', (event) => {
      if (_isNativePopupControl(event.target)) _markNativeControlInteraction();
    }, true);
  }

  function _shouldKeepPopupForNativeControl() {
    if (!_popup) return false;
    if (Date.now() < _suppressOutsidePointerUntil) return true;
    const active = document.activeElement;
    return !!(active && _popup.contains(active) && _isNativePopupControl(active));
  }

  function _eventStartedInPopup(ev) {
    if (!_popup) return false;
    if (_popup.contains(ev.target)) return true;
    const path = typeof ev.composedPath === 'function' ? ev.composedPath() : [];
    if (Array.isArray(path) && path.includes(_popup)) return true;
    const x = Number(ev.clientX);
    const y = Number(ev.clientY);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
    const rect = _popup.getBoundingClientRect();
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
  }

  function activateTabType(tabType, path) {
    if (!_popup || !_state?.paneNode || !tabType) return false;
    const tabs = _state.paneNode.tabs || [];
    const targetPath = path == null ? '' : String(path);
    const idx = tabs.findIndex(tab => tab?.type === tabType && String(tab?.path || '') === targetPath);
    if (idx < 0) return false;
    _state.paneNode.activeTabIndex = idx;
    const tab = tabs[idx];
    const titleEl = _popup.querySelector('.gb-dock-popup-title');
    if (titleEl) titleEl.textContent = tab?.label || '';
    _state.tabId = tab?.id || '';
    _state.tabType = tab?.type || '';
    _state.tabIdx = idx;
    _syncPopupPaneDom(_state.paneEl || _findPaneElement(_state.paneNode.id), _state.paneNode);
    return true;
  }

  function _bindResize(popup, panelsetNode) {
    popup.querySelectorAll('.gb-dock-popup-resize-handle').forEach((h) => {
      h.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const dir = h.dataset.dir || 'se';
        const rect = popup.getBoundingClientRect();
        const z = _dockPopupZoom();
        _resizeState = {
          dir,
          startX: e.clientX,
          startY: e.clientY,
          startW: rect.width / z,
          startH: rect.height / z,
          startLeft: rect.left / z,
          startTop: rect.top / z,
          zoom: z,
          panelsetNode,
        };
        h.setPointerCapture?.(e.pointerId);
        const onMove = (ev) => _onResizeMove(ev, popup);
        const onUp = (ev) => {
          _onResizeEnd(ev, popup, panelsetNode);
          document.removeEventListener('pointermove', onMove);
          document.removeEventListener('pointerup', onUp);
        };
        document.addEventListener('pointermove', onMove);
        document.addEventListener('pointerup', onUp);
      });
    });
  }

  function _onResizeMove(e, popup) {
    if (!_resizeState) return;
    const { dir, startX, startY, startW, startH, startLeft, startTop } = _resizeState;
    const z = _resizeState.zoom || _dockPopupZoom();
    const dx = (e.clientX - startX) / z;
    const dy = (e.clientY - startY) / z;
    let newW = startW, newH = startH, newLeft = startLeft, newTop = startTop;
    if (dir.includes('e')) newW = Math.max(MIN_W, startW + dx);
    if (dir.includes('s')) newH = Math.max(MIN_H, startH + dy);
    if (dir.includes('w')) {
      const w = Math.max(MIN_W, startW - dx);
      newLeft = startLeft + (startW - w);
      newW = w;
    }
    if (dir.includes('n')) {
      const h = Math.max(MIN_H, startH - dy);
      newTop = startTop + (startH - h);
      newH = h;
    }
    _applyPopupRect(popup, { left: newLeft, top: newTop, w: newW, h: newH });
  }

  function _onResizeEnd(e, popup, panelsetNode) {
    if (!_resizeState) return;
    _resizeState = null;
    const rect = popup.getBoundingClientRect();
    const z = _dockPopupZoom();
    const clamped = _applyPopupRect(popup, {
      left: rect.left / z,
      top: rect.top / z,
      w: rect.width / z,
      h: rect.height / z,
    });
    // panelset.popupRect に保存
    if (panelsetNode) {
      panelsetNode.popupRect = { w: Math.round(clamped.w), h: Math.round(clamped.h) };
      if (typeof GBLayout?.saveLayout === 'function') GBLayout.saveLayout();
    }
  }

  function _reclampOnWindowResize(popup) {
    if (!popup) return;
    const rect = popup.getBoundingClientRect();
    const z = _dockPopupZoom();
    _applyPopupRect(popup, {
      left: rect.left / z,
      top: rect.top / z,
      w: rect.width / z,
      h: rect.height / z,
    });
  }

  function openPopup({ panelsetNode, groupId, paneNode, tab, tabIdx, anchorEl }) {
    if (!panelsetNode || !paneNode || !tab) return;
    // 既に同じ対象で開いている場合はトグル（閉じる）
    if (_popup && _state?.paneId === paneNode.id && _state?.tabId === tab.id) {
      closePopup();
      return;
    }
    // 別対象で開いていたら閉じる
    if (_popup) closePopup();

    _setPopupTargetState(panelsetNode, groupId, paneNode, tabIdx);

    // サイズ決定: panelset.popupRect → fallback
    const savedRect = panelsetNode.popupRect;
    const size = (savedRect && savedRect.w >= MIN_W && savedRect.h >= MIN_H)
      ? _clampPopupSize({ w: savedRect.w, h: savedRect.h })
      : _defaultRect(anchorEl, panelsetNode);

    // ポップアップ DOM 作成
    const popup = _buildPopupDom(tab.label || '');
    const body = popup.querySelector('.gb-dock-popup-body');

    // 対象 pane の DOM を移動（参照切断を避けるため元の位置情報を保持）
    let paneEl = _findPaneElement(paneNode.id);
    let originalParent = null, originalNextSibling = null;
    let synthetic = false;
    if (paneEl) {
      originalParent = paneEl.parentNode;
      originalNextSibling = paneEl.nextSibling;
      body.appendChild(paneEl);
    } else if (typeof GBLayout?.renderNode === 'function') {
      paneEl = GBLayout.renderNode(paneNode, 0);
      synthetic = true;
      body.appendChild(paneEl);
    } else {
      // pane DOM が見つからない場合のフォールバック（プレースホルダ表示）
      const placeholder = document.createElement('div');
      placeholder.className = 'gb-dock-popup-placeholder';
      placeholder.style.padding = '16px';
      placeholder.textContent = tab.label ? `パネル: ${tab.label}` : 'パネル';
      body.appendChild(placeholder);
    }

    document.body.appendChild(popup);
    _popup = popup;
    _state = {
      panelsetId: panelsetNode.id,
      groupId: groupId || '',
      paneId: paneNode.id,
      tabId: tab.id || '',
      tabType: tab.type || '',
      tabIdx,
      paneNode,
      paneEl,
      synthetic,
      originalParent,
      originalNextSibling,
    };
    _bindPopupTabActivation(popup, paneNode);
    _bindNativeControlGuard(popup);
    _syncPopupPaneDom(paneEl, paneNode);
    if (_popup !== popup) return;
    _positionPopup(popup, anchorEl, size);
    _bindResize(popup, panelsetNode);

    // 外クリックで閉じる
    _clickListener = (ev) => {
      if (!_popup) return;
      // ポップアップ内または同じアンカー内クリックは無視
      if (_eventStartedInPopup(ev)) return;
      if (_isPopupOwnedFloatingElement(ev.target)) {
        _markPopupInternalInteraction();
        return;
      }
      if (_shouldKeepPopupForNativeControl()) return;
      // ドックバー上のクリックは該当アイコンハンドラが処理するのでここでは無視
      if (ev.target?.closest?.('.gb-dock-bar')) return;
      closePopup();
    };
    // 次マイクロタスクで登録（open 直後の自己クリックを無視）
    setTimeout(() => { if (_clickListener) document.addEventListener('pointerdown', _clickListener, true); }, 0);

    // Escape
    _keyListener = (ev) => {
      if (ev.key === 'Escape' && _popup) closePopup();
    };
    document.addEventListener('keydown', _keyListener, true);

    // ウィンドウリサイズでクランプ
    _resizeWindowListener = () => _reclampOnWindowResize(_popup);
    window.addEventListener('resize', _resizeWindowListener);
  }

  function closePopup() {
    if (!_popup) return;
    const state = _state;
    // pane DOM を元に戻す
    if (state?.paneEl && state.originalParent && !state.synthetic) {
      if (state.originalNextSibling && state.originalNextSibling.parentNode === state.originalParent) {
        state.originalParent.insertBefore(state.paneEl, state.originalNextSibling);
      } else {
        state.originalParent.appendChild(state.paneEl);
      }
    } else if (state?.synthetic && state.paneId && typeof GBLayout?.paneMap === 'object') {
      if (typeof GBPaneBridge?.retractPaneContent === 'function') {
        GBPaneBridge.retractPaneContent(state.paneId);
      }
      delete GBLayout.paneMap[state.paneId];
    }
    _popup.remove();
    _popup = null;
    _state = null;
    if (_clickListener) {
      document.removeEventListener('pointerdown', _clickListener, true);
      _clickListener = null;
    }
    if (_keyListener) {
      document.removeEventListener('keydown', _keyListener, true);
      _keyListener = null;
    }
    if (_resizeWindowListener) {
      window.removeEventListener('resize', _resizeWindowListener);
      _resizeWindowListener = null;
    }
  }

  function getCurrentPopupPaneId() {
    return _state?.paneId || null;
  }

  function getCurrentPopupTarget() {
    if (!_state) return null;
    return {
      panelsetId: _state.panelsetId || '',
      groupId: _state.groupId || '',
      paneId: _state.paneId || '',
      tabId: _state.tabId || '',
      tabType: _state.tabType || '',
      tabIdx: _state.tabIdx,
    };
  }

  window.GBDockPopup = {
    open: openPopup,
    close: closePopup,
    isOpen,
    getCurrentPopupPaneId,
    getCurrentPopupTarget,
    activateTabType,
  };
})();
