/* ==============================
   gb-float-panel-base.js — フロートパネルの共通の骨組み（挙動のみ）

   作業領域の上に浮かべる小型パネルに共通する挙動を1つの部品にまとめる。
   ヘッダードラッグでの移動、8方向の枠ドラッグでのサイズ変更、画面外へ出さない
   補正、表示倍率（--meldex-ui-zoom）対応、位置とサイズの記憶、Escapeでの
   閉じる、スマートフォン幅での全幅ボトムシート化を提供する。

   見た目（CSS）は呼び出し側が完全に所有する。この部品はDOM構造と挙動だけを
   提供し、クラス名は呼び出し側が指定した名前をそのまま使う（既存パネルの
   CSSセレクタを壊さないため）。

   由来: クイックメモのフロートパネル（v0.7.258, gb-quick-memo-panel.js）から
   機械的に切り出した。挙動は変えていない。タグ選択パネル（gb-tag-picker-panel.js）
   が2つ目の利用者。
   ============================== */
(function () {
  'use strict';

  function _zoom() {
    const z = (typeof _getZoom === 'function')
      ? Number(_getZoom())
      : parseFloat(document.documentElement.style.zoom || '1');
    return Number.isFinite(z) && z > 0 ? z : 1;
  }

  function create(config) {
    const cfg = config || {};
    const MIN_W = Number(cfg.minWidth) || 300;
    const MIN_H = Number(cfg.minHeight) || 320;
    const DEFAULT_W = Number(cfg.defaultWidth) || 420;
    const DEFAULT_H = Number(cfg.defaultHeight) || 620;
    const MARGIN = Number(cfg.margin) || 8;
    const STORAGE_KEY = String(cfg.storageKey || ('meldex:float-panel:' + (cfg.id || 'panel') + ':rect:v1'));
    const MOBILE_BREAKPOINT = Number(cfg.mobileBreakpoint) || 640;
    const escapeRequiresFocusWithin = cfg.escapeRequiresFocusWithin !== false;
    const resizable = cfg.resizable !== false;

    let _panel = null;
    let _header = null;
    let _body = null;
    let _dragState = null;
    let _resizeState = null;
    let _keyListener = null;
    let _windowResizeListener = null;

    function _isMobileSheetActive() {
      if (!cfg.mobileSheet) return false;
      try { return window.matchMedia('(max-width: ' + MOBILE_BREAKPOINT + 'px)').matches; }
      catch { return (window.innerWidth || 0) <= MOBILE_BREAKPOINT; }
    }

    function _viewportCssSize() {
      const z = _zoom();
      return {
        w: Math.max(MIN_W, (window.innerWidth || document.documentElement.clientWidth || MIN_W) / z),
        h: Math.max(MIN_H, (window.innerHeight || document.documentElement.clientHeight || MIN_H) / z),
      };
    }

    function _clampRect(rect) {
      const viewport = _viewportCssSize();
      const rawW = Number(rect?.w);
      const rawH = Number(rect?.h);
      const w = Math.max(MIN_W, Math.min(Number.isFinite(rawW) ? rawW : DEFAULT_W, viewport.w - MARGIN * 2));
      const h = Math.max(MIN_H, Math.min(Number.isFinite(rawH) ? rawH : DEFAULT_H, viewport.h - MARGIN * 2));
      const maxLeft = Math.max(MARGIN, viewport.w - w - MARGIN);
      const maxTop = Math.max(MARGIN, viewport.h - h - MARGIN);
      const rawLeft = Number(rect?.left);
      const rawTop = Number(rect?.top);
      return {
        left: Math.max(MARGIN, Math.min(Number.isFinite(rawLeft) ? rawLeft : maxLeft, maxLeft)),
        top: Math.max(MARGIN, Math.min(Number.isFinite(rawTop) ? rawTop : MARGIN, maxTop)),
        w,
        h,
      };
    }

    function _applyRect(rect) {
      if (!_panel) return null;
      // モバイルシートは位置とサイズをCSSが決めるため、インラインstyleは触らない。
      if (_isMobileSheetActive()) return null;
      const next = _clampRect(rect);
      _panel.style.left = next.left + 'px';
      _panel.style.top = next.top + 'px';
      _panel.style.width = next.w + 'px';
      _panel.style.height = next.h + 'px';
      return next;
    }

    function _currentRect() {
      if (!_panel) return null;
      const rect = _panel.getBoundingClientRect();
      const z = _zoom();
      return { left: rect.left / z, top: rect.top / z, w: rect.width / z, h: rect.height / z };
    }

    function _readStoredRect() {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        const parsed = raw ? JSON.parse(raw) : null;
        return parsed && typeof parsed === 'object' ? parsed : null;
      } catch {
        return null;
      }
    }

    function _saveRect() {
      if (_isMobileSheetActive()) return;
      const rect = _currentRect();
      if (!rect) return;
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(rect)); } catch {}
    }

    function _defaultRect() {
      const viewport = _viewportCssSize();
      const w = Math.min(DEFAULT_W, Math.max(MIN_W, viewport.w - MARGIN * 2));
      const h = Math.min(DEFAULT_H, Math.max(MIN_H, viewport.h - MARGIN * 2));
      const anchor = cfg.anchorSelector ? document.querySelector(cfg.anchorSelector) : null;
      const z = _zoom();
      let left = viewport.w - w - MARGIN;
      if (anchor) {
        const anchorRect = anchor.getBoundingClientRect();
        if (anchorRect.width > 0) left = anchorRect.left / z - w - MARGIN;
      }
      return _clampRect({ left, top: Math.max(MARGIN, viewport.h - h - MARGIN), w, h });
    }

    // ドラッグ・リサイズ中はiframe等がポインタを奪うことがあるため、呼び出し側に
    // 一時的な無効化のタイミングを通知する（quick-memoはiframeのpointer-eventsを切る）。
    function _notifyDragToggle(enabled) {
      if (typeof cfg.onDragToggle === 'function') cfg.onDragToggle(enabled);
    }

    function _startDrag(event) {
      if (event.button !== 0 || _isMobileSheetActive()) return;
      const rect = _currentRect();
      if (!rect) return;
      event.preventDefault();
      const z = _zoom();
      _dragState = {
        startX: event.clientX,
        startY: event.clientY,
        startLeft: rect.left,
        startTop: rect.top,
        w: rect.w,
        h: rect.h,
        zoom: z,
      };
      _notifyDragToggle(false);
      const onMove = (ev) => {
        if (!_dragState) return;
        const dx = (ev.clientX - _dragState.startX) / _dragState.zoom;
        const dy = (ev.clientY - _dragState.startY) / _dragState.zoom;
        _applyRect({
          left: _dragState.startLeft + dx,
          top: _dragState.startTop + dy,
          w: _dragState.w,
          h: _dragState.h,
        });
      };
      const onUp = () => {
        _dragState = null;
        _notifyDragToggle(true);
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        _saveRect();
      };
      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);
    }

    function _bindResize() {
      if (!_panel || !resizable) return;
      _panel.querySelectorAll('.gb-float-panel-resize-handle').forEach((handle) => {
        handle.addEventListener('pointerdown', (event) => {
          if (event.button !== 0 || _isMobileSheetActive()) return;
          const rect = _currentRect();
          if (!rect) return;
          event.preventDefault();
          event.stopPropagation();
          _resizeState = {
            dir: handle.dataset.dir || 'se',
            startX: event.clientX,
            startY: event.clientY,
            startW: rect.w,
            startH: rect.h,
            startLeft: rect.left,
            startTop: rect.top,
            zoom: _zoom(),
          };
          _notifyDragToggle(false);
          const onMove = (ev) => {
            if (!_resizeState) return;
            const { dir, startX, startY, startW, startH, startLeft, startTop, zoom } = _resizeState;
            const dx = (ev.clientX - startX) / zoom;
            const dy = (ev.clientY - startY) / zoom;
            let w = startW;
            let h = startH;
            let left = startLeft;
            let top = startTop;
            if (dir.includes('e')) w = Math.max(MIN_W, startW + dx);
            if (dir.includes('s')) h = Math.max(MIN_H, startH + dy);
            if (dir.includes('w')) {
              w = Math.max(MIN_W, startW - dx);
              left = startLeft + (startW - w);
            }
            if (dir.includes('n')) {
              h = Math.max(MIN_H, startH - dy);
              top = startTop + (startH - h);
            }
            _applyRect({ left, top, w, h });
          };
          const onUp = () => {
            _resizeState = null;
            _notifyDragToggle(true);
            document.removeEventListener('pointermove', onMove);
            document.removeEventListener('pointerup', onUp);
            _saveRect();
          };
          document.addEventListener('pointermove', onMove);
          document.addEventListener('pointerup', onUp);
          // ポインタ捕捉は失敗しても続行する。ここで例外が出ると、操作対象を
          // 無効化したままリサイズが始まらない状態で止まってしまう。
          try { handle.setPointerCapture?.(event.pointerId); } catch {}
        });
      });
    }

    function _syncMobileAttr() {
      if (!_panel) return;
      _panel.dataset.mobileSheetEligible = cfg.mobileSheet ? '1' : '0';
    }

    function _build() {
      const panel = document.createElement('div');
      if (cfg.id) panel.id = cfg.id;
      panel.className = ['gb-float-panel', cfg.className].filter(Boolean).join(' ');
      if (cfg.dataE2eId) panel.dataset.e2eId = cfg.dataE2eId;
      if (cfg.ariaLabel) panel.setAttribute('aria-label', cfg.ariaLabel);
      panel.tabIndex = -1;

      const header = document.createElement('div');
      header.className = ['gb-float-panel-header', cfg.headerClassName].filter(Boolean).join(' ');
      if (cfg.headerE2eId) header.dataset.e2eId = cfg.headerE2eId;
      header.addEventListener('pointerdown', (event) => {
        if (event.target?.closest?.('button,input,select,textarea,a,[data-no-drag]')) return;
        _startDrag(event);
      });
      panel.appendChild(header);

      const body = document.createElement('div');
      body.className = ['gb-float-panel-body', cfg.bodyClassName].filter(Boolean).join(' ');
      panel.appendChild(body);

      if (resizable) {
        ['n', 'e', 's', 'w', 'ne', 'se', 'sw', 'nw'].forEach((dir) => {
          const handle = document.createElement('div');
          handle.className = ['gb-float-panel-resize-handle', cfg.resizeHandleClassName].filter(Boolean).join(' ');
          handle.dataset.dir = dir;
          panel.appendChild(handle);
        });
      }

      _panel = panel;
      _header = header;
      _body = body;
      if (typeof cfg.buildHeader === 'function') cfg.buildHeader(header, controller);
      if (typeof cfg.buildBody === 'function') cfg.buildBody(body, controller);
      document.body.appendChild(panel);
      _syncMobileAttr();
      _bindResize();
      return panel;
    }

    function isOpen() {
      return !!(_panel && _panel.isConnected);
    }

    function open(runtimeOptions) {
      if (isOpen()) {
        if (typeof cfg.onReopen === 'function') cfg.onReopen(runtimeOptions);
        focus();
        return _panel;
      }
      _build();
      _applyRect(_readStoredRect() || _defaultRect());
      _keyListener = (event) => {
        if (event.key !== 'Escape' || !isOpen()) return;
        if (escapeRequiresFocusWithin && !_panel.contains(document.activeElement)) return;
        event.preventDefault();
        event.stopPropagation();
        close();
      };
      document.addEventListener('keydown', _keyListener, true);
      _windowResizeListener = () => {
        _syncMobileAttr();
        if (!isOpen() || _dragState || _resizeState) return;
        _applyRect(_currentRect());
      };
      window.addEventListener('resize', _windowResizeListener);
      if (typeof cfg.onOpen === 'function') cfg.onOpen(runtimeOptions);
      syncTriggerButtons();
      focus();
      return _panel;
    }

    function close() {
      if (!_panel) return false;
      if (typeof cfg.onBeforeClose === 'function') cfg.onBeforeClose();
      _saveRect();
      if (_keyListener) {
        document.removeEventListener('keydown', _keyListener, true);
        _keyListener = null;
      }
      if (_windowResizeListener) {
        window.removeEventListener('resize', _windowResizeListener);
        _windowResizeListener = null;
      }
      _panel.remove();
      _panel = null;
      _header = null;
      _body = null;
      _dragState = null;
      _resizeState = null;
      if (typeof cfg.onClose === 'function') cfg.onClose();
      syncTriggerButtons();
      return true;
    }

    function toggle(runtimeOptions) {
      return isOpen() ? (close(), false) : (open(runtimeOptions), true);
    }

    function focus() {
      try {
        if (typeof cfg.onFocus === 'function') { cfg.onFocus(); return; }
        _panel?.focus?.({ preventScroll: true });
      } catch {}
    }

    // レール/ボタン側は再描画のたびに作り直されることがあるため、描画後に
    // 開閉状態を貼り直せるよう外部からも呼べるようにする。
    function syncTriggerButtons() {
      const raw = cfg.triggerSelectors;
      const selectors = Array.isArray(raw) ? raw : (raw ? [raw] : []);
      if (!selectors.length) return;
      const open_ = isOpen();
      selectors.forEach((selector) => {
        document.querySelectorAll(selector).forEach((btn) => {
          btn.classList.toggle('active', open_);
          btn.setAttribute('aria-pressed', open_ ? 'true' : 'false');
        });
      });
    }

    const controller = {
      open,
      close,
      toggle,
      isOpen,
      focus,
      syncTriggerButtons,
      getElement: () => _panel,
      getHeaderElement: () => _header,
      getBodyElement: () => _body,
      applyRect: (rect) => _applyRect(rect),
      saveRect: () => _saveRect(),
      isMobileSheetActive: _isMobileSheetActive,
    };
    return controller;
  }

  window.GBFloatPanelBase = Object.freeze({ create });
})();
