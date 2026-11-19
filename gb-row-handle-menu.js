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

  // ---------------------------------------------------------------------------
  // 複数選択時の一括実行（2026-11-19決定。共通ルール §6「行の選択と一括実行」）
  //
  // ・押したハンドルの行が選択中で、選択が2行以上なら「一括」。選択中のすべての行が対象。
  // ・押した行が選択外なら、その1行だけが対象（選択は変えない）。
  // ・対象は表示順に並べ、連続する行を1つのまとまり（run）にする。
  //   追加・複製はまとまりごとに、まとまりの行数ぶん、まとまりの上／下へ入れる。
  // ---------------------------------------------------------------------------

  /** orderedIds の並びで、idSet に含まれる連続区間を配列で返す。 */
  function runsOf(orderedIds, idSet) {
    const set = idSet instanceof Set ? idSet : new Set(idSet || []);
    const runs = [];
    let current = null;
    let prevIndex = -2;
    (orderedIds || []).forEach((id, index) => {
      if (!set.has(id)) return;
      if (current && index === prevIndex + 1) current.push(id);
      else { current = [id]; runs.push(current); }
      prevIndex = index;
    });
    return runs;
  }

  /**
   * ハンドルメニューの対象を決める。
   * @param {*} rowId 押したハンドルの行
   * @param {Array} orderedIds 表示順の全行ID
   * @param {Iterable} selectedIds 選択中の行ID
   * @returns {{batch:boolean, ids:Array, runs:Array<Array>, count:number, rowId:*}}
   */
  function resolveTargets(rowId, orderedIds, selectedIds) {
    const order = Array.isArray(orderedIds) ? orderedIds : [];
    const selected = new Set(selectedIds || []);
    const visibleSelected = order.filter(id => selected.has(id));
    const batch = visibleSelected.length > 1 && selected.has(rowId);
    const idSet = batch ? new Set(visibleSelected) : new Set([rowId]);
    const ids = batch ? visibleSelected : [rowId];
    return { batch, ids, runs: runsOf(order, idSet), count: ids.length, rowId };
  }

  /**
   * 追加・複製の挿入計画。まとまりごとに { ids, anchorId, position, count } を返す。
   * 下（後ろ）のまとまりから順に並べるので、位置（index）で挿入する表もそのまま順に適用できる。
   */
  function planInsertions(targets, position) {
    const where = position === 'above' ? 'above' : 'below';
    return (targets?.runs || []).map(run => ({
      ids: run.slice(),
      anchorId: where === 'above' ? run[0] : run[run.length - 1],
      position: where,
      count: run.length,
    })).reverse();
  }

  /**
   * 対象をまとめて1つ上（dir=-1）／下（dir=1）へ動かした並びを返す。端に当たって動かせない時は null。
   */
  function moveOrder(orderedIds, targetIds, dir) {
    const order = (orderedIds || []).slice();
    const set = new Set(targetIds || []);
    if (!set.size) return null;
    const step = dir < 0 ? -1 : 1;
    const edge = step < 0 ? 0 : order.length - 1;
    if (set.has(order[edge])) return null;
    const indices = order.map((id, index) => (set.has(id) ? index : -1)).filter(index => index >= 0);
    if (step > 0) indices.reverse();
    indices.forEach(index => {
      const other = index + step;
      const tmp = order[other];
      order[other] = order[index];
      order[index] = tmp;
    });
    return order;
  }

  function _collapseSeparators(items) {
    const out = [];
    items.forEach(item => {
      const isSep = !item || item.type === 'separator' || item.type === 'sep';
      if (isSep && (!out.length || out[out.length - 1].__sep)) return;
      out.push(isSep ? { type: 'separator', __sep: true } : item);
    });
    while (out.length && out[out.length - 1].__sep) out.pop();
    return out.map(item => (item.__sep ? { type: 'separator' } : item));
  }

  /**
   * 一括時は「一括実行できる項目（batch: true）」だけを残し、batchLabel があれば差し替える。
   * 先頭に「N行を選択中」の見出しを置く。単独時は batchOnly の項目を外して、そのまま返す。
   *   item.batch      true で一括時にも表示（action は呼び出し側が対象全体に対して実装する）
   *   item.batchOnly  true で一括時だけ表示（選択の反転・解除など）
   *   item.batchLabel 一括時の表示名（文字列、または count を受け取る関数）
   */
  function buildItems(items, targets, options = {}) {
    const list = Array.isArray(items) ? items : [];
    const batch = !!targets?.batch;
    const count = targets?.count || 0;
    const transform = entries => entries.map(item => {
      if (!item || item.type === 'separator' || item.type === 'sep' || item.type === 'label') return item;
      if (batch ? !item.batch && !item.batchOnly : item.batchOnly) return null;
      const next = { ...item };
      if (batch && item.batchLabel) {
        next.label = typeof item.batchLabel === 'function' ? item.batchLabel(count) : item.batchLabel;
      }
      if (Array.isArray(item.items)) {
        next.items = _collapseSeparators(transform(item.items).filter(Boolean));
        if (!next.items.length) return null;
      }
      delete next.batch; delete next.batchOnly; delete next.batchLabel;
      return next;
    }).filter(Boolean);
    const result = _collapseSeparators(transform(list));
    if (batch && result.length) {
      const unit = options.unit || '行';
      result.unshift(
        { type: 'label', label: `${count}${unit}を選択中`, e2eId: options.labelE2eId || 'row-handle-menu-batch-label' },
        { type: 'separator' },
      );
    }
    return result;
  }

  global.MeldexRowHandleMenu = Object.freeze({
    bind, open, anchorRect, DRAG_THRESHOLD,
    runsOf, resolveTargets, planInsertions, moveOrder, buildItems,
  });
})(typeof window !== 'undefined' ? window : globalThis);
