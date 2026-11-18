/*
 * gb-column-manager.js — 列の表示と並び順を管理する共通ポップアップ。
 *
 * シートのビューの「列管理」と、ギャラリー・カンバン・タイムラインの「表示列」で
 * 同じ見た目と操作を使う（2026-11-18 ユーザー指示）。
 *   - 表示中の列を上、非表示の列を下の欄へまとめる
 *   - 目のボタンで表示を切り替える。Shift+クリックで範囲、押したままなぞると連続で切り替え
 *   - 行を選ぶ（Ctrl/Shift で複数）。選んだ行の目を押すと選んだ行すべてを切り替え
 *   - つまみ（ハンドル）をドラッグして並べ替え。選んだ行はまとめて動く。
 *     非表示の欄へ落とすと非表示、表示中の欄へ落とすと表示になる
 *   - 項目を押してもポップアップは閉じない。外側のクリック・Esc・閉じるボタンで閉じる
 *
 * open(options):
 *   anchor       位置の基準にする要素
 *   title        見出し
 *   className    追加するクラス（既存のテストや後始末用）
 *   e2eId        data-e2e-id
 *   getItems()   [{ id, label, visible, lockedVisible? }] を現在の並び順で返す
 *   onChange(items, detail)  並び順・表示を変えた時。items は新しい並び順（visible 付き）
 *   renderExtra(container)   見出しの下に追加する設定欄（任意。カードの表示設定など）
 *   onClose()    閉じた時
 */
(function (global) {
  'use strict';

  const STYLE_ID = 'meldex-column-manager-style';
  const DRAG_THRESHOLD_PX = 4;
  let current = null;

  function icon(name, size) {
    return typeof global.lucide === 'function' ? global.lucide(name, size || 14) : '';
  }

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
.meldex-column-manager{position:fixed;z-index:10000;min-width:240px;max-width:340px;max-height:min(70vh,520px);overflow:auto;padding:6px;display:flex;flex-direction:column;gap:2px;}
.meldex-column-manager > *{flex-shrink:0;}
.meldex-column-manager-head{display:flex;align-items:center;gap:6px;padding:2px 4px 4px;font-weight:600;font-size:12px;}
.meldex-column-manager-head .meldex-column-manager-title{flex:1;min-width:0;}
.meldex-column-manager-head button{font-size:11px;padding:1px 6px;}
.meldex-column-manager-section{font-size:11px;color:var(--fg2);padding:6px 6px 2px;display:flex;align-items:center;gap:6px;}
.meldex-column-manager-section-count{opacity:.8;}
.meldex-column-manager-list{display:flex;flex-direction:column;min-height:22px;border-radius:4px;}
.meldex-column-manager-list.is-drop-target{outline:1px dashed var(--accent);}
.meldex-column-manager-empty{font-size:11px;color:var(--fg2);padding:3px 8px;}
.meldex-column-manager-row{display:flex;align-items:center;gap:4px;min-height:24px;padding:0 4px;border-radius:4px;cursor:default;user-select:none;}
.meldex-column-manager-row:hover{background:var(--bg3, rgba(127,127,127,.12));}
.meldex-column-manager-row.is-selected{background:color-mix(in srgb, var(--accent) 22%, transparent);}
.meldex-column-manager-row.is-dragging{opacity:.45;}
.meldex-column-manager-row.is-hidden .meldex-column-manager-label{color:var(--fg2);}
.meldex-column-manager-row:focus-visible{outline:2px solid var(--accent);outline-offset:-2px;}
.meldex-column-manager-handle{display:inline-flex;align-items:center;justify-content:center;width:18px;height:20px;color:var(--fg2);cursor:grab;touch-action:none;flex:0 0 auto;}
.meldex-column-manager-handle:active{cursor:grabbing;}
.meldex-column-manager-eye{display:inline-flex;align-items:center;justify-content:center;width:22px;height:20px;padding:0;border:0;background:transparent;color:var(--fg);cursor:pointer;flex:0 0 auto;border-radius:3px;}
.meldex-column-manager-eye:disabled{opacity:.4;cursor:default;}
.meldex-column-manager-row.is-hidden .meldex-column-manager-eye{color:var(--fg2);}
.meldex-column-manager-label{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;}
.meldex-column-manager-drop-line{height:2px;background:var(--accent);border-radius:1px;margin:0 4px;pointer-events:none;}
.meldex-column-manager-extra{display:flex;flex-direction:column;gap:2px;padding-bottom:4px;border-bottom:1px solid var(--border);margin-bottom:2px;}
`;
    document.head.appendChild(style);
  }

  function close() {
    if (!current) return;
    const state = current;
    current = null;
    state.cleanup.forEach(fn => { try { fn(); } catch (_) { /* noop */ } });
    state.root.remove();
    try { state.options.onClose?.(); } catch (_) { /* noop */ }
  }

  function position(root, anchor) {
    const rect = anchor?.getBoundingClientRect?.();
    if (!rect) return;
    if (typeof global.positionPopup === 'function') {
      global.positionPopup(root, rect);
      return;
    }
    root.style.left = Math.max(4, rect.left) + 'px';
    root.style.top = (rect.bottom + 2) + 'px';
  }

  function open(options = {}) {
    close();
    ensureStyle();
    const root = document.createElement('div');
    root.className = ['gb-context-menu', 'meldex-column-manager', options.className || ''].join(' ').trim();
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-label', options.title || '列管理');
    if (options.e2eId) root.dataset.e2eId = options.e2eId;
    const state = {
      root, options, cleanup: [],
      items: [], selected: new Set(), anchorId: null, toggleAnchorId: null,
      paint: null, drag: null,
    };
    current = state;

    const head = document.createElement('div');
    head.className = 'meldex-column-manager-head';
    const titleEl = document.createElement('span');
    titleEl.className = 'meldex-column-manager-title';
    titleEl.textContent = options.title || '列管理';
    const showAll = document.createElement('button');
    showAll.type = 'button';
    showAll.textContent = 'すべて表示';
    showAll.dataset.e2eId = 'column-manager-show-all';
    const hideAll = document.createElement('button');
    hideAll.type = 'button';
    hideAll.textContent = 'すべて非表示';
    hideAll.dataset.e2eId = 'column-manager-hide-all';
    head.append(titleEl, showAll, hideAll);
    root.appendChild(head);

    if (typeof options.renderExtra === 'function') {
      const extra = document.createElement('div');
      extra.className = 'meldex-column-manager-extra';
      options.renderExtra(extra);
      if (extra.childNodes.length) root.appendChild(extra);
    }

    const visibleHead = document.createElement('div');
    visibleHead.className = 'meldex-column-manager-section';
    const visibleList = document.createElement('div');
    visibleList.className = 'meldex-column-manager-list';
    visibleList.dataset.section = 'visible';
    const hiddenHead = document.createElement('div');
    hiddenHead.className = 'meldex-column-manager-section';
    const hiddenList = document.createElement('div');
    hiddenList.className = 'meldex-column-manager-list';
    hiddenList.dataset.section = 'hidden';
    root.append(visibleHead, visibleList, hiddenHead, hiddenList);

    const readItems = () => {
      const raw = typeof options.getItems === 'function' ? options.getItems() : [];
      return (Array.isArray(raw) ? raw : []).map(item => ({
        id: String(item.id),
        label: String(item.label ?? item.id),
        visible: item.visible !== false,
        lockedVisible: item.lockedVisible === true,
      }));
    };

    const commit = (nextItems, detail, commitOptions = {}) => {
      state.items = nextItems;
      try { options.onChange?.(nextItems.map(item => ({ ...item })), detail || ''); } catch (error) {
        if (typeof global.showStatus === 'function') global.showStatus('列の表示を変更できませんでした: ' + (error?.message || error), true);
      }
      if (commitOptions.inPlace) updateRowsInPlace();
      else render();
    };

    // 目のボタンを押している間（なぞって切り替える間）は行を欄の間で動かさない。動かすと
    // ポインターの下へ次の行が来て、なぞっていないのに続けて切り替わってしまう。
    function updateRowsInPlace() {
      state.items.forEach(item => {
        const row = rowOf(item.id);
        if (!row) return;
        row.classList.toggle('is-hidden', !item.visible);
        const eye = row.querySelector('.meldex-column-manager-eye');
        if (!eye) return;
        eye.innerHTML = icon(item.visible ? 'eye' : 'eyeOff', 14);
        eye.setAttribute('aria-pressed', item.visible ? 'true' : 'false');
        eye.setAttribute('aria-label', `${item.label}を${item.visible ? '非表示にする' : '表示する'}`);
      });
    }

    const orderedIds = () => state.items.map(item => item.id);
    const rowOf = id => root.querySelector(`.meldex-column-manager-row[data-id="${cssEscape(id)}"]`);

    function cssEscape(value) {
      return global.MeldexEscape?.cssIdent ? global.MeldexEscape.cssIdent(value) : String(value).replace(/["\\]/g, '\\$&');
    }

    function setVisibility(ids, visible, detail, commitOptions) {
      const target = new Set(ids);
      let changed = false;
      const next = state.items.map(item => {
        if (!target.has(item.id) || item.visible === visible) return item;
        if (!visible && item.lockedVisible) return item;
        changed = true;
        return { ...item, visible };
      });
      if (changed) commit(next, detail, commitOptions);
    }

    // 表示中の欄 → 非表示の欄の順に並べ直した「画面の並び」。
    const displayOrder = () => [
      ...state.items.filter(item => item.visible),
      ...state.items.filter(item => !item.visible),
    ];

    // Shift+目のボタン: 前回押した行（起点）からの範囲。起点の行は押した時に別の欄へ移るので、
    // 起点が元いた欄での位置を覚えておき、同じ欄の今の並びで範囲を決める。
    function toggleRangeIds(anchor, toId) {
      const to = state.items.find(item => item.id === toId);
      if (!to || to.visible !== anchor.visible) return [toId];
      const section = displayOrder().filter(item => item.visible === anchor.visible).map(item => item.id);
      const j = section.indexOf(toId);
      const anchorStill = section.indexOf(anchor.id);
      if (anchorStill >= 0) {
        const [lo, hi] = anchorStill < j ? [anchorStill, j] : [j, anchorStill];
        return section.slice(lo, hi + 1);
      }
      const i = Math.max(0, anchor.index);
      return j < i ? section.slice(j, i) : section.slice(i, j + 1);
    }

    // 範囲は同じ欄の中だけで決める。起点の行が別の欄へ移っていたら、押した行だけにする
    // （欄をまたぐと、間にある無関係な列まで切り替わる）。
    function rangeIds(fromId, toId) {
      const from = state.items.find(item => item.id === fromId);
      const to = state.items.find(item => item.id === toId);
      if (!from || !to || from.visible !== to.visible) return [toId];
      const order = displayOrder().map(item => item.id);
      const a = order.indexOf(fromId);
      const b = order.indexOf(toId);
      if (a < 0 || b < 0) return [toId];
      const [lo, hi] = a < b ? [a, b] : [b, a];
      return order.slice(lo, hi + 1);
    }

    function buildRow(item) {
      const row = document.createElement('div');
      row.className = 'meldex-column-manager-row';
      row.classList.toggle('is-hidden', !item.visible);
      row.classList.toggle('is-selected', state.selected.has(item.id));
      row.dataset.id = item.id;
      row.tabIndex = 0;
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', state.selected.has(item.id) ? 'true' : 'false');
      const handle = document.createElement('span');
      handle.className = 'meldex-column-manager-handle';
      handle.innerHTML = icon('gripVertical', 14);
      handle.title = 'ドラッグで並べ替え';
      handle.setAttribute('aria-hidden', 'true');
      const eye = document.createElement('button');
      eye.type = 'button';
      eye.className = 'meldex-column-manager-eye';
      eye.innerHTML = icon(item.visible ? 'eye' : 'eyeOff', 14);
      eye.setAttribute('aria-pressed', item.visible ? 'true' : 'false');
      eye.setAttribute('aria-label', `${item.label}を${item.visible ? '非表示にする' : '表示する'}`);
      eye.title = item.visible ? '非表示にする（Shiftで範囲・なぞって連続）' : '表示する（Shiftで範囲・なぞって連続）';
      eye.dataset.e2eId = 'column-manager-toggle';
      if (item.visible && item.lockedVisible) eye.disabled = true;
      const label = document.createElement('span');
      label.className = 'meldex-column-manager-label';
      label.textContent = item.label;
      row.append(handle, eye, label);
      return row;
    }

    function render() {
      const scrollTop = root.scrollTop;
      const focusedId = document.activeElement?.closest?.('.meldex-column-manager-row')?.dataset.id || null;
      const visibleItems = state.items.filter(item => item.visible);
      const hiddenItems = state.items.filter(item => !item.visible);
      visibleHead.innerHTML = `<span>表示中</span><span class="meldex-column-manager-section-count">${visibleItems.length}</span>`;
      hiddenHead.innerHTML = `<span>非表示</span><span class="meldex-column-manager-section-count">${hiddenItems.length}</span>`;
      visibleList.replaceChildren(...visibleItems.map(buildRow));
      hiddenList.replaceChildren(...hiddenItems.map(buildRow));
      if (!visibleItems.length) visibleList.innerHTML = '<div class="meldex-column-manager-empty">ここへドラッグすると表示します</div>';
      if (!hiddenItems.length) hiddenList.innerHTML = '<div class="meldex-column-manager-empty">ここへドラッグすると非表示にします</div>';
      root.scrollTop = scrollTop;
      if (focusedId) rowOf(focusedId)?.focus({ preventScroll: true });
    }

    showAll.addEventListener('click', () => setVisibility(orderedIds(), true, 'すべて表示'));
    hideAll.addEventListener('click', () => setVisibility(orderedIds(), false, 'すべて非表示'));

    // --- 選択 -------------------------------------------------------------
    function selectRow(id, event) {
      if (event.shiftKey && state.anchorId) {
        state.selected = new Set(rangeIds(state.anchorId, id));
      } else if (event.ctrlKey || event.metaKey) {
        if (state.selected.has(id)) state.selected.delete(id); else state.selected.add(id);
        state.anchorId = id;
      } else {
        state.selected = new Set([id]);
        state.anchorId = id;
      }
      render();
    }

    // --- 目のボタン（Shift範囲・なぞって連続） ------------------------------
    root.addEventListener('pointerdown', (event) => {
      const eye = event.target.closest?.('.meldex-column-manager-eye');
      const handle = event.target.closest?.('.meldex-column-manager-handle');
      const row = event.target.closest?.('.meldex-column-manager-row');
      if (eye && row && event.button === 0) {
        event.preventDefault();
        if (eye.disabled) return;
        const id = row.dataset.id;
        const item = state.items.find(entry => entry.id === id);
        if (!item) return;
        const nextVisible = !item.visible;
        let ids = [id];
        if (event.shiftKey && state.toggleAnchor) ids = toggleRangeIds(state.toggleAnchor, id);
        else if (state.selected.has(id) && state.selected.size > 1) ids = [...state.selected];
        const sectionItems = displayOrder().filter(entry => entry.visible === item.visible);
        state.toggleAnchor = {
          id, visible: item.visible,
          index: sectionItems.findIndex(entry => entry.id === id),
        };
        state.toggleAnchorId = id;
        state.paint = { visible: nextVisible, touched: new Set(ids) };
        setVisibility(ids, nextVisible, item.label, { inPlace: true });
        return;
      }
      if (handle && row && event.button === 0) {
        startDrag(event, row.dataset.id);
        return;
      }
      if (row && event.button === 0) selectRow(row.dataset.id, event);
    });
    root.addEventListener('pointerover', (event) => {
      if (!state.paint) return;
      const eye = event.target.closest?.('.meldex-column-manager-eye');
      const row = event.target.closest?.('.meldex-column-manager-row');
      if (!eye || !row || state.paint.touched.has(row.dataset.id)) return;
      state.paint.touched.add(row.dataset.id);
      setVisibility([row.dataset.id], state.paint.visible, '', { inPlace: true });
    });
    const endPaint = () => {
      if (!state.paint) return;
      state.paint = null;
      if (current === state) render();
    };
    document.addEventListener('pointerup', endPaint, true);
    document.addEventListener('pointercancel', endPaint, true);
    state.cleanup.push(() => {
      document.removeEventListener('pointerup', endPaint, true);
      document.removeEventListener('pointercancel', endPaint, true);
    });
    // 目のボタンはキーボードでも押せる（Space / Enter）。pointerdown 済みのクリックは無視する。
    root.addEventListener('click', (event) => {
      const eye = event.target.closest?.('.meldex-column-manager-eye');
      if (!eye || event.detail !== 0) return;
      const row = eye.closest('.meldex-column-manager-row');
      const item = state.items.find(entry => entry.id === row?.dataset.id);
      if (item) setVisibility([item.id], !item.visible, item.label);
    });

    // --- キーボード ---------------------------------------------------------
    root.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        close();
        options.anchor?.focus?.();
        return;
      }
      const row = event.target.closest?.('.meldex-column-manager-row');
      if (!row) return;
      const order = displayOrder().map(item => item.id);
      const idx = order.indexOf(row.dataset.id);
      if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && event.altKey) {
        event.preventDefault();
        const ids = state.selected.has(row.dataset.id) ? [...state.selected] : [row.dataset.id];
        moveIds(ids, event.key === 'ArrowUp' ? -1 : 1);
        return;
      }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const nextIdx = (idx + (event.key === 'ArrowDown' ? 1 : -1) + order.length) % order.length;
        const nextId = order[nextIdx];
        if (event.shiftKey) {
          state.selected = new Set(rangeIds(state.anchorId || row.dataset.id, nextId));
          render();
        }
        rowOf(nextId)?.focus();
        return;
      }
      if (event.key === ' ' && event.target === row) {
        event.preventDefault();
        const item = state.items.find(entry => entry.id === row.dataset.id);
        const ids = state.selected.has(row.dataset.id) ? [...state.selected] : [row.dataset.id];
        if (item) setVisibility(ids, !item.visible, item.label);
      }
    });

    // 1つ上・下へ移動（同じ欄の中で）。
    function moveIds(ids, delta) {
      const display = displayOrder();
      const moving = new Set(ids);
      const first = display.findIndex(item => moving.has(item.id));
      if (first < 0) return;
      const section = display[first].visible;
      const sectionItems = display.filter(item => item.visible === section);
      const rest = sectionItems.filter(item => !moving.has(item.id));
      const block = sectionItems.filter(item => moving.has(item.id));
      const startIdx = sectionItems.findIndex(item => moving.has(item.id));
      const insertAt = Math.max(0, Math.min(rest.length, startIdx + delta));
      const nextSection = [...rest.slice(0, insertAt), ...block, ...rest.slice(insertAt)];
      const other = display.filter(item => item.visible !== section);
      commit(section ? [...nextSection, ...other] : [...other, ...nextSection], block.map(item => item.label).join('、'));
      rowOf(ids[0])?.focus();
    }

    // --- ドラッグで並べ替え -------------------------------------------------
    function startDrag(event, id) {
      event.preventDefault();
      const ids = state.selected.has(id) && state.selected.size > 1
        ? displayOrder().map(item => item.id).filter(entry => state.selected.has(entry))
        : [id];
      const startY = event.clientY;
      let started = false;
      let dropLine = null;
      let drop = null;
      const pointerId = event.pointerId;

      const computeDrop = (clientY) => {
        const lists = [visibleList, hiddenList];
        let targetList = null;
        for (const list of lists) {
          const rect = list.getBoundingClientRect();
          if (clientY >= rect.top - 8 && clientY <= rect.bottom + 8) { targetList = list; break; }
        }
        if (!targetList) {
          const vr = visibleList.getBoundingClientRect();
          targetList = clientY < vr.bottom ? visibleList : hiddenList;
        }
        const rows = [...targetList.querySelectorAll('.meldex-column-manager-row')]
          .filter(row => !ids.includes(row.dataset.id));
        let beforeId = null;
        for (const row of rows) {
          const rect = row.getBoundingClientRect();
          if (clientY < rect.top + rect.height / 2) { beforeId = row.dataset.id; break; }
        }
        return { list: targetList, visible: targetList.dataset.section === 'visible', beforeId };
      };

      const showDrop = (next) => {
        dropLine?.remove();
        [visibleList, hiddenList].forEach(list => list.classList.toggle('is-drop-target', list === next.list));
        dropLine = document.createElement('div');
        dropLine.className = 'meldex-column-manager-drop-line';
        const beforeRow = next.beforeId ? rowOf(next.beforeId) : null;
        if (beforeRow && beforeRow.parentElement === next.list) next.list.insertBefore(dropLine, beforeRow);
        else next.list.appendChild(dropLine);
      };

      const onMove = (moveEvent) => {
        if (moveEvent.pointerId !== pointerId) return;
        if (!started) {
          if (Math.abs(moveEvent.clientY - startY) < DRAG_THRESHOLD_PX) return;
          started = true;
          global.MeldexDragAutoScroll?.beginPointerSession?.(moveEvent.clientX, moveEvent.clientY);
          ids.forEach(entry => rowOf(entry)?.classList.add('is-dragging'));
        }
        moveEvent.preventDefault();
        global.MeldexDragAutoScroll?.updatePointer?.(moveEvent.clientX, moveEvent.clientY);
        drop = computeDrop(moveEvent.clientY);
        showDrop(drop);
      };
      const finish = (upEvent) => {
        if (upEvent && upEvent.pointerId !== pointerId) return;
        document.removeEventListener('pointermove', onMove, true);
        document.removeEventListener('pointerup', finish, true);
        document.removeEventListener('pointercancel', cancel, true);
        if (started) global.MeldexDragAutoScroll?.endPointerSession?.();
        dropLine?.remove();
        [visibleList, hiddenList].forEach(list => list.classList.remove('is-drop-target'));
        if (!started || !drop) {
          ids.forEach(entry => rowOf(entry)?.classList.remove('is-dragging'));
          return;
        }
        const moving = new Set(ids);
        const block = state.items.filter(item => moving.has(item.id)).map(item => {
          if (!drop.visible && item.lockedVisible) return item;
          return { ...item, visible: drop.visible };
        });
        // ロックされた列（非表示にできない列）は表示中の欄に残す。
        const blockOrder = ids.map(entry => block.find(item => item.id === entry)).filter(Boolean);
        const display = displayOrder().filter(item => !moving.has(item.id));
        const sectionVisible = drop.visible;
        const section = display.filter(item => item.visible === sectionVisible);
        const other = display.filter(item => item.visible !== sectionVisible);
        const insertAt = drop.beforeId ? Math.max(0, section.findIndex(item => item.id === drop.beforeId)) : section.length;
        const landing = blockOrder.filter(item => item.visible === sectionVisible);
        const stay = blockOrder.filter(item => item.visible !== sectionVisible);
        const nextSection = [...section.slice(0, insertAt), ...landing, ...section.slice(insertAt)];
        const visiblePart = sectionVisible ? nextSection : [...other, ...stay];
        const hiddenPart = sectionVisible ? [...other, ...stay] : nextSection;
        commit([...visiblePart.filter(item => item.visible), ...hiddenPart.filter(item => !item.visible),
          ...visiblePart.filter(item => !item.visible), ...hiddenPart.filter(item => item.visible)],
        blockOrder.map(item => item.label).join('、'));
      };
      const cancel = (cancelEvent) => {
        drop = null;
        finish(cancelEvent);
      };
      document.addEventListener('pointermove', onMove, true);
      document.addEventListener('pointerup', finish, true);
      document.addEventListener('pointercancel', cancel, true);
    }

    // --- 外側のクリックで閉じる ---------------------------------------------
    const anchor = options.anchor || null;
    const outside = (event) => {
      if (root.contains(event.target)) return;
      if (anchor && (event.target === anchor || anchor.contains?.(event.target))) return;
      close();
    };
    setTimeout(() => {
      if (current !== state) return;
      document.addEventListener('pointerdown', outside, true);
    }, 0);
    state.cleanup.push(() => document.removeEventListener('pointerdown', outside, true));

    state.items = readItems();
    render();
    document.body.appendChild(root);
    if (typeof global.attachMeldexDropdownCloseButton === 'function') {
      global.attachMeldexDropdownCloseButton(root, {
        trigger: anchor,
        className: 'meldex-column-manager-close',
        attr: 'data-column-manager-close',
        close,
      });
    }
    position(root, anchor);
    return {
      root,
      close,
      refresh() {
        if (current !== state) return;
        state.items = readItems();
        render();
      },
    };
  }

  global.MeldexColumnManager = { open, close, isOpen: () => !!current };
})(typeof window !== 'undefined' ? window : globalThis);
