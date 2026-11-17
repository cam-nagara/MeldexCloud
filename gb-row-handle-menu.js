/* gb-row-handle-menu.js — 並べ替えハンドル（行のつまみ）の行メニュー共通部品。
 * ハンドルをドラッグせずにクリック（またはEnter／Space）すると、対象行の直下へ行メニューを開く。
 * ドラッグとの区別: pointerdownからclickまでの移動量が閾値以上なら何もしない
 * （各表のドラッグ実装はそのまま。HTML5 DnD はドラッグ後に click 自体が発生しない）。
 * メニューは MeldexContextMenuUI で開く。既存の独自メニューを使う表は open コールバックで渡す。
 */
(function (global) {
  'use strict';

  if (global.MeldexRowHandleMenu) return;

  const DRAG_THRESHOLD = 4;
  let lastClosedHandle = null;
  let lastClosedAt = 0;

  function _now() {
    return global.performance?.now?.() ?? Date.now();
  }

  // 横書きの表: 行の下端（入り切らない時は上端）に、横位置はハンドルの左端で揃える。
  // 縦書き（prefer: left/right）: 行の帯の横へ出す。
  function anchorRect(handle, row, prefer) {
    const handleRect = handle?.getBoundingClientRect?.();
    const rowRect = (row && row.getBoundingClientRect?.()) || handleRect;
    if (!handleRect || !rowRect) return null;
    if (prefer === 'left' || prefer === 'right') {
      return { left: rowRect.left, right: rowRect.right, top: handleRect.top, bottom: rowRect.bottom };
    }
    return { left: handleRect.left, right: handleRect.right, top: rowRect.top, bottom: rowRect.bottom };
  }

  function _setOpenState(handle, row, open) {
    handle?.setAttribute?.('aria-expanded', open ? 'true' : 'false');
    row?.classList?.toggle?.('gb-row-handle-menu-open', !!open);
  }

  function open(handle, options = {}) {
    const ui = global.MeldexContextMenuUI;
    if (!handle || !ui?.openAt) return null;
    const items = (typeof options.items === 'function' ? options.items() : options.items) || [];
    if (!items.length) return null;
    const row = options.row || null;
    const prefer = options.prefer || 'below';
    const rect = anchorRect(handle, row, prefer);
    if (!rect) return null;
    _setOpenState(handle, row, true);
    const menu = ui.openAt({
      items,
      anchorRect: rect,
      prefer,
      ariaLabel: options.ariaLabel || '行メニュー',
      e2eId: options.e2eId || '',
      restoreFocus: options.restoreFocus ? handle : null,
      onClose: () => {
        _setOpenState(handle, row, false);
        lastClosedHandle = handle;
        lastClosedAt = _now();
        options.onClose?.();
      },
    });
    menu?.classList?.add('gb-row-handle-menu');
    if (options.focusFirst) {
      menu?.querySelector?.(':scope > .gb-context-menu-item:not(.disabled)')?.focus?.({ preventScroll: true });
    }
    return menu;
  }

  /**
   * ハンドルへクリックメニューを結び付ける。
   * config:
   *   getItems(event)  MeldexContextMenuUI の項目配列を返す（空なら開かない）
   *   open(event, info) 独自メニューを開く場合（info.anchorRect を基準に配置する）
   *   getRow()         メニューの基準にする行要素
   *   prefer / getPrefer() 'below'（既定）| 'left' | 'right'
   *   ignoreSelector   ハンドル内でメニューを開かない子要素（追加ボタン・チェックボックス等）
   *   onModifiedClick(event) Shift/Ctrl/Cmd+クリック時の処理（未指定ならメニューを開く）
   *   isEnabled(event) false でメニューを開かない
   */
  function bind(handle, config = {}) {
    if (!handle || handle.dataset?.rowHandleMenuBound === 'true') return handle;
    handle.dataset.rowHandleMenuBound = 'true';
    handle.setAttribute('aria-haspopup', 'menu');
    handle.setAttribute('aria-expanded', 'false');
    let down = null;

    const ignored = event => !!(config.ignoreSelector && event.target?.closest?.(config.ignoreSelector));
    const activate = (event, viaKeyboard) => {
      if (config.isEnabled && config.isEnabled(event) === false) {
        event.preventDefault();
        event.stopPropagation();
        return false;
      }
      const row = config.getRow?.() || null;
      const prefer = config.getPrefer?.() || config.prefer || 'below';
      if (typeof config.open === 'function') {
        event.preventDefault();
        event.stopPropagation();
        config.open(event, { anchorRect: anchorRect(handle, row, prefer), prefer, row, viaKeyboard });
        return true;
      }
      const items = config.getItems?.(event) || [];
      if (!items.length) return false;
      event.preventDefault();
      event.stopPropagation();
      open(handle, {
        items, row, prefer,
        ariaLabel: config.ariaLabel,
        e2eId: config.e2eId,
        restoreFocus: viaKeyboard,
        focusFirst: viaKeyboard,
      });
      return true;
    };

    handle.addEventListener('pointerdown', event => {
      if (event.button !== 0 || ignored(event)) { down = null; return; }
      down = {
        x: event.clientX,
        y: event.clientY,
        // 開いていたメニューは document の pointerdown（capture）で先に閉じている。
        // 同じハンドルを押し直した場合は「閉じる」操作として扱い、開き直さない。
        wasOpen: lastClosedHandle === handle && _now() - lastClosedAt < 120,
      };
    }, true);

    handle.addEventListener('click', event => {
      if (ignored(event)) return;
      const start = down;
      down = null;
      if (event.button) return;
      if (event.detail !== 0 && start) {
        if (Math.hypot(event.clientX - start.x, event.clientY - start.y) >= DRAG_THRESHOLD) return;
        if (start.wasOpen) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
      }
      if ((event.shiftKey || event.ctrlKey || event.metaKey) && typeof config.onModifiedClick === 'function') {
        config.onModifiedClick(event);
        return;
      }
      activate(event, event.detail === 0);
    });

    // button 要素は Enter／Space で click が発生する。それ以外は自前でキー操作を受ける。
    if (!(handle instanceof HTMLButtonElement)) {
      if (handle.tabIndex < 0) handle.tabIndex = 0;
      handle.addEventListener('keydown', event => {
        if (event.target !== handle || event.altKey || event.ctrlKey || event.metaKey) return;
        if (event.key !== 'Enter' && event.key !== ' ' && event.key !== 'ContextMenu') return;
        activate(event, true);
      });
    }
    return handle;
  }

  global.MeldexRowHandleMenu = Object.freeze({ bind, open, anchorRect, DRAG_THRESHOLD });
})(typeof window !== 'undefined' ? window : globalThis);
