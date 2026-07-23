/* gb-tool-calendar-production-list-tabs.js
 * スケジュール タスクリスト面の作品別タブ（リスト切替バー）に、シートアプリの
 * ビュータブと同じ操作感を与える独立モジュール。
 * - ドラッグ＆ドロップでの並べ替え（前後インジケーター付き）
 * - ホバー「…」ボタン / 右クリック / 長押しで開くタブメニュー（左右入れ替え・タブを閉じる）
 * - 閉じたタブの再表示メニュー
 * 並び順と閉じたタブは localStorage("productionListTabPrefs:<制作管理ルート>") へ保存する。
 * シートのビュー表示設定（dbViewConfig）と同じく「このブラウザの表示設定」として扱い、
 * タスクリスト本体のデータには一切書き込まない（閉じる＝非表示。削除ではない）。
 */
(function () {
  'use strict';

  const STORAGE_PREFIX = 'productionListTabPrefs:';
  const DRAG_NAME_TYPE = 'text/x-production-list-tab';
  const DRAG_ROOT_TYPE = 'text/x-production-list-tab-root';

  function _storageKey(pmRoot) {
    return STORAGE_PREFIX + String(pmRoot || '制作管理');
  }

  function _zoom() {
    return typeof _getZoom === 'function' ? (_getZoom() || 1) : 1;
  }

  function _icon(name, size) {
    const span = document.createElement('span');
    span.className = 'gb-production-task-icon';
    if (typeof lucide === 'function') span.innerHTML = lucide(name, size || 14);
    return span;
  }

  function _sanitizeIdPart(raw) {
    // renderListBar のタブ e2e-id と同じ規則（Unicode文字/数字は保持）で衝突を防ぐ。
    return String(raw || '').replace(/[^\p{L}\p{N}_-]+/gu, '-');
  }

  function loadPrefs(pmRoot) {
    try {
      if (typeof localStorage === 'undefined') return { order: [], hidden: [] };
      const raw = localStorage.getItem(_storageKey(pmRoot));
      const parsed = raw ? JSON.parse(raw) : null;
      return {
        order: Array.isArray(parsed?.order) ? parsed.order.map(String) : [],
        hidden: Array.isArray(parsed?.hidden) ? parsed.hidden.map(String) : [],
      };
    } catch {
      return { order: [], hidden: [] };
    }
  }

  function savePrefs(pmRoot, prefs, sheets) {
    try {
      if (typeof localStorage === 'undefined') return false;
      // 実在しないシート名は保存時に掃除する（削除済み作品の設定が残り続けないように）。
      const known = Array.isArray(sheets) && sheets.length
        ? new Set(sheets.map(sheet => String(sheet?.sheet_name || '')))
        : null;
      const keep = name => !known || known.has(name);
      const order = (prefs?.order || []).map(String).filter(keep);
      const hidden = (prefs?.hidden || []).map(String).filter(keep);
      localStorage.setItem(_storageKey(pmRoot), JSON.stringify({ order, hidden }));
      return true;
    } catch {
      return false;
    }
  }

  // 全シートを保存済みの並び順で整列する（未知の新規シートは元の並びのまま末尾へ）。
  function _arrangeFull(sheets, pmRoot) {
    const list = Array.isArray(sheets) ? sheets.filter(sheet => sheet && sheet.sheet_name) : [];
    const orderIndex = new Map(loadPrefs(pmRoot).order.map((name, index) => [name, index]));
    return list
      .map((sheet, index) => ({ sheet, index }))
      .sort((a, b) => {
        const ai = orderIndex.has(a.sheet.sheet_name) ? orderIndex.get(a.sheet.sheet_name) : Number.MAX_SAFE_INTEGER;
        const bi = orderIndex.has(b.sheet.sheet_name) ? orderIndex.get(b.sheet.sheet_name) : Number.MAX_SAFE_INTEGER;
        return ai !== bi ? ai - bi : a.index - b.index;
      })
      .map(item => item.sheet);
  }

  function arrange(sheets, pmRoot) {
    const full = _arrangeFull(sheets, pmRoot);
    const hiddenSet = new Set(loadPrefs(pmRoot).hidden);
    return {
      visible: full.filter(sheet => !hiddenSet.has(sheet.sheet_name)),
      hidden: full.filter(sheet => hiddenSet.has(sheet.sheet_name)),
    };
  }

  // fromName のタブを targetName の before/after へ移動して並び順を保存する。
  function moveTab(pmRoot, sheets, fromName, targetName, side) {
    if (!fromName || !targetName || fromName === targetName) return false;
    const names = _arrangeFull(sheets, pmRoot).map(sheet => sheet.sheet_name);
    const fromIdx = names.indexOf(fromName);
    let toIdx = names.indexOf(targetName);
    if (fromIdx < 0 || toIdx < 0) return false;
    if (side === 'after') toIdx += 1;
    if (fromIdx < toIdx) toIdx -= 1;
    if (toIdx === fromIdx) return false;
    names.splice(toIdx, 0, names.splice(fromIdx, 1)[0]);
    return savePrefs(pmRoot, { order: names, hidden: loadPrefs(pmRoot).hidden }, sheets);
  }

  // 表示中タブ列の中で左右の隣と入れ替える（非表示タブは跨いで無視する）。
  function swapTab(pmRoot, sheets, name, direction) {
    const visible = arrange(sheets, pmRoot).visible.map(sheet => sheet.sheet_name);
    const index = visible.indexOf(name);
    const neighbor = visible[index + direction];
    if (index < 0 || !neighbor) return false;
    return moveTab(pmRoot, sheets, name, neighbor, direction > 0 ? 'after' : 'before');
  }

  function hideTab(pmRoot, sheets, name) {
    const prefs = loadPrefs(pmRoot);
    if (prefs.hidden.includes(name)) return false;
    prefs.hidden.push(name);
    return savePrefs(pmRoot, prefs, sheets);
  }

  function showTab(pmRoot, sheets, name) {
    const prefs = loadPrefs(pmRoot);
    if (!prefs.hidden.includes(name)) return false;
    prefs.hidden = prefs.hidden.filter(item => item !== name);
    return savePrefs(pmRoot, prefs, sheets);
  }

  /* --- ドロップ位置インジケーター（シートビュータブの db-view-drop-* と同じ見た目） --- */

  function _clearDropIndicators(bar) {
    const scope = bar || document;
    scope.querySelectorAll?.('.gb-production-tab-drop-before, .gb-production-tab-drop-after, .gb-production-list-switch-btn.drag-over-tab')
      .forEach(tab => tab.classList.remove('gb-production-tab-drop-before', 'gb-production-tab-drop-after', 'drag-over-tab'));
  }

  function _dropSide(tab, event) {
    const rect = tab.getBoundingClientRect();
    const x = typeof event?.clientX === 'number' ? event.clientX : rect.left + rect.width / 2;
    return x < rect.left + rect.width / 2 ? 'before' : 'after';
  }

  /* --- コンテキストメニュー --- */

  function _closeMenu() {
    document.querySelectorAll('.gb-production-list-tab-menu').forEach(menu => menu.remove());
  }

  function _openMenu(event, items, e2eId) {
    _closeMenu();
    const menu = document.createElement('div');
    menu.className = 'gb-context-menu gb-production-list-tab-menu';
    menu.dataset.e2eId = e2eId || 'gb-production-list-tab-menu';
    items.forEach(item => {
      if (item.type === 'sep') {
        menu.appendChild(Object.assign(document.createElement('div'), { className: 'gb-context-menu-sep' }));
        return;
      }
      const node = document.createElement('div');
      node.className = 'gb-context-menu-item' + (item.disabled ? ' disabled' : '');
      if (item.e2eId) node.dataset.e2eId = item.e2eId;
      if (typeof lucide === 'function' && item.icon) node.innerHTML = lucide(item.icon, 14) + ' ';
      node.appendChild(document.createTextNode(item.label));
      if (!item.disabled) {
        node.addEventListener('click', () => {
          _closeMenu();
          item.action?.();
        });
      }
      menu.appendChild(node);
    });
    const z = _zoom();
    const anchorRect = typeof event?.clientX === 'number'
      ? { left: event.clientX, bottom: event.clientY }
      : event?.currentTarget?.getBoundingClientRect?.() || { left: 0, bottom: 0 };
    menu.style.left = (anchorRect.left / z) + 'px';
    menu.style.top = ((anchorRect.bottom + 2) / z) + 'px';
    document.body.appendChild(menu);
    if (typeof clampPopupToViewport === 'function') clampPopupToViewport(menu);
    setTimeout(() => {
      const closer = ev => {
        if (!menu.contains(ev.target)) {
          _closeMenu();
          document.removeEventListener('pointerdown', closer);
        }
      };
      document.addEventListener('pointerdown', closer);
    }, 0);
    return menu;
  }

  function _tabMenuItems(opts) {
    const idPart = _sanitizeIdPart(opts.sheetName);
    return [
      {
        label: '左と入れ替え',
        icon: 'arrowLeft',
        disabled: !opts.canSwapLeft,
        e2eId: 'gb-production-list-tab-swap-left-' + idPart,
        action: () => {
          if (swapTab(opts.pmRoot, opts.sheets, opts.sheetName, -1)) opts.onChanged?.('reorder');
        },
      },
      {
        label: '右と入れ替え',
        icon: 'arrowRight',
        disabled: !opts.canSwapRight,
        e2eId: 'gb-production-list-tab-swap-right-' + idPart,
        action: () => {
          if (swapTab(opts.pmRoot, opts.sheets, opts.sheetName, 1)) opts.onChanged?.('reorder');
        },
      },
      { type: 'sep' },
      {
        label: 'タブを閉じる（データは残る）',
        icon: 'x',
        e2eId: 'gb-production-list-tab-close-' + idPart,
        action: () => opts.onHide?.(),
      },
    ];
  }

  /* --- タブ装飾（D&D + メニュー） --- */

  // button: renderListBar が生成した .gb-production-list-switch-btn
  // opts: { sheetName, pmRoot, sheets, canSwapLeft, canSwapRight, onChanged(action), onHide() }
  function decorateTab(button, opts) {
    if (!button || !opts?.sheetName) return;
    const bar = () => button.closest('.gb-production-list-switch');

    // ホバー「…」ボタン（シートビュータブと同じ操作感）
    const moreBtn = document.createElement('span');
    moreBtn.className = 'gb-production-list-tab-more';
    moreBtn.dataset.e2eId = 'gb-production-list-tab-more-' + _sanitizeIdPart(opts.sheetName);
    moreBtn.title = 'タブ操作';
    if (typeof lucide === 'function') moreBtn.innerHTML = lucide('moreHorizontal', 12);
    moreBtn.addEventListener('click', event => {
      event.stopPropagation();
      _openMenu(event, _tabMenuItems(opts));
    });
    button.appendChild(moreBtn);
    button.classList.add('gb-production-list-switch-btn-sortable');

    button.addEventListener('contextmenu', event => {
      event.preventDefault();
      _openMenu(event, _tabMenuItems(opts));
    });
    if (typeof addLongPressHandler === 'function') {
      addLongPressHandler(button, event => _openMenu(event, _tabMenuItems(opts)));
    }

    // D&D 並べ替え
    button.draggable = true;
    button.addEventListener('dragstart', event => {
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData(DRAG_NAME_TYPE, opts.sheetName);
        event.dataTransfer.setData(DRAG_ROOT_TYPE, String(opts.pmRoot || ''));
      }
      button.classList.add('dragging');
    });
    button.addEventListener('dragend', () => {
      button.classList.remove('dragging');
      _clearDropIndicators(bar());
    });
    button.addEventListener('dragover', event => {
      if (!event.dataTransfer?.types?.includes?.(DRAG_NAME_TYPE)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      _clearDropIndicators(bar());
      const side = _dropSide(button, event);
      button.classList.add('drag-over-tab', side === 'before' ? 'gb-production-tab-drop-before' : 'gb-production-tab-drop-after');
    });
    button.addEventListener('dragleave', event => {
      if (event.relatedTarget && button.contains(event.relatedTarget)) return;
      button.classList.remove('drag-over-tab', 'gb-production-tab-drop-before', 'gb-production-tab-drop-after');
    });
    button.addEventListener('drop', event => {
      if (!event.dataTransfer?.types?.includes?.(DRAG_NAME_TYPE)) return;
      event.preventDefault();
      event.stopPropagation();
      const side = _dropSide(button, event);
      _clearDropIndicators(bar());
      const fromName = event.dataTransfer.getData(DRAG_NAME_TYPE);
      const fromRoot = event.dataTransfer.getData(DRAG_ROOT_TYPE);
      if (!fromName || fromRoot !== String(opts.pmRoot || '')) return;
      if (moveTab(opts.pmRoot, opts.sheets, fromName, opts.sheetName, side)) opts.onChanged?.('reorder');
    });
  }

  /* --- 閉じたタブの再表示メニュー --- */

  // hiddenSheets: arrange().hidden / opts: { pmRoot, sheets, onReopen(sheet) }
  function buildHiddenMenuButton(hiddenSheets, opts) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'gb-production-list-switch-btn gb-production-list-switch-hidden-btn';
    button.dataset.e2eId = 'gb-production-list-switch-hidden-menu';
    button.title = '閉じたタスクリストを再表示';
    button.setAttribute('aria-label', `閉じたタスクリストを再表示（${hiddenSheets.length}件）`);
    button.setAttribute('aria-haspopup', 'menu');
    button.appendChild(_icon('panelTopOpen', 13));
    button.appendChild(document.createTextNode(String(hiddenSheets.length)));
    button.addEventListener('click', event => {
      event.stopPropagation();
      _openMenu(event, hiddenSheets.map(sheet => ({
        label: sheet.work_title || sheet.sheet_name,
        icon: 'listTodo',
        e2eId: 'gb-production-list-hidden-item-' + _sanitizeIdPart(sheet.sheet_name),
        action: () => {
          showTab(opts.pmRoot, opts.sheets, sheet.sheet_name);
          opts.onReopen?.(sheet);
        },
      })), 'gb-production-list-hidden-menu');
    });
    return button;
  }

  window.MeldexProductionListTabs = Object.freeze({
    arrange,
    moveTab,
    swapTab,
    hideTab,
    showTab,
    loadPrefs,
    savePrefs,
    decorateTab,
    buildHiddenMenuButton,
  });
})();
