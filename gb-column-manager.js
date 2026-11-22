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
 *   icon         見出しの前に出すアイコン名（任意。列管理は専用の columns3Cog）
 *   getItems()   [{ id, label, visible, lockedVisible?, iconHtml? }] を現在の並び順で返す。
 *                iconHtml は列名の前に出すアイコン（列見出しと同じ列タイプのアイコン。呼び出し側が作る）
 *   onChange(items, detail)  並び順・表示を変えた時。items は新しい並び順（visible 付き）
 *   renderExtra(container)   見出しの下に追加する設定欄（任意。カードの表示設定など）
 *   getRowMenuItems(targets) つまみのクリックメニューへ足す項目（任意）。{ duplicate, settings, danger } の
 *                配列を返す（MeldexContextMenuUI の項目）。targets は MeldexRowHandleMenu.resolveTargets の結果に
 *                items（対象の行）と refresh()（列を増減した後に一覧を読み直す）を足したもの。
 *                並べ替え（上へ・下へ）・表示の切り替え・選択の解除と反転は部品側で入れる（UI共通ルール §6）。
 *   initialQuery 開いた時に検索欄へ入れておく文字（任意。列名の変更で非表示の同名列がある時など）
 *   onClose()    閉じた時
 */
(function (global) {
  'use strict';

  const STYLE_ID = 'meldex-column-manager-style';
  const DRAG_THRESHOLD_PX = 4;
  const SIZE_STORAGE_KEY = 'meldex-column-manager-size';
  const MIN_WIDTH = 220;
  const MIN_HEIGHT = 160;
  const RESIZE_DIRS = ['n', 'e', 's', 'w', 'ne', 'nw', 'se', 'sw'];
  const ROW_MENU_E2E_ID = 'column-manager-row-menu';
  let current = null;
  let rememberedSize = null;

  function icon(name, size) {
    return typeof global.lucide === 'function' ? global.lucide(name, size || 14) : '';
  }

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
/* 外枠は角丸で中身を切り抜き、スクロールは内側の本文だけで行う。外枠ごとスクロールさせると、
   スクロールバーが右上・右下の角丸の上に描かれて枠線が途切れる（2026-11-20 報告）。 */
.meldex-column-manager{position:fixed;z-index:10000;box-sizing:border-box;min-width:240px;max-width:340px;max-height:min(70vh,520px);overflow:visible;padding:0;display:flex;flex-direction:column;}
.meldex-column-manager.is-resized{min-width:0;max-width:calc(100vw - 8px);max-height:calc(100vh - 8px);}
/* 角丸の切り抜きは本文が自分で行う（外枠は切り抜かない。大きさ変更の取っ手を外枠のすぐ外側へ置くため）。 */
.meldex-column-manager-body{flex:1 1 auto;min-height:0;overflow:auto;padding:6px;display:flex;flex-direction:column;gap:2px;border-top-left-radius:inherit;border-top-right-radius:inherit;}
.meldex-column-manager-body:last-child{border-bottom-left-radius:inherit;border-bottom-right-radius:inherit;}
.meldex-column-manager-body > *{flex-shrink:0;}
.meldex-column-manager > .meldex-dropdown-close-row{flex-shrink:0;margin-top:0;padding:var(--ui-space-2, 4px) var(--ui-space-3, 6px);border-bottom-left-radius:inherit;border-bottom-right-radius:inherit;}
/* 共通メニューの「直下の div のホバーで背景色」を、本文と取っ手には当てない（2026-11-21 報告: 端へカーソルを
   近づけると背景色が変わる）。取っ手はカーソルの形だけを変える。 */
/* 共通メニューの「直下の div は項目」の余白・指カーソルも当てない（取っ手が余白の分だけ太くなり、本文のスクロールバーへ
   かぶっていた）。本文の余白は今までの見た目（項目と同じ余白）を明示して保つ。 */
.gb-context-menu.meldex-column-manager > .meldex-column-manager-body{padding:var(--ui-menu-item-padding-y, 4px) var(--ui-menu-item-padding-x, 12px);cursor:default;}
.gb-context-menu.meldex-column-manager > .meldex-column-manager-resize{padding:0;margin:0;font-size:0;}
.gb-context-menu.meldex-column-manager > .meldex-column-manager-body:hover,
.gb-context-menu.meldex-column-manager > .meldex-column-manager-resize,
.gb-context-menu.meldex-column-manager > .meldex-column-manager-resize:hover{background:transparent;}
/* 取っ手は外枠のすぐ外側に置き、本文のスクロールバーと重ねない（重なるとスクロールバーを操作できない）。 */
.meldex-column-manager-resize{position:absolute;z-index:2;touch-action:none;}
.meldex-column-manager-resize[data-dir="n"]{top:-6px;left:8px;right:8px;height:6px;cursor:ns-resize;}
.meldex-column-manager-resize[data-dir="s"]{bottom:-6px;left:8px;right:8px;height:6px;cursor:ns-resize;}
.meldex-column-manager-resize[data-dir="e"]{top:8px;bottom:8px;right:-6px;width:6px;cursor:ew-resize;}
.meldex-column-manager-resize[data-dir="w"]{top:8px;bottom:8px;left:-6px;width:6px;cursor:ew-resize;}
.meldex-column-manager-resize[data-dir="ne"]{top:-6px;right:-6px;width:8px;height:8px;cursor:nesw-resize;}
.meldex-column-manager-resize[data-dir="nw"]{top:-6px;left:-6px;width:8px;height:8px;cursor:nwse-resize;}
.meldex-column-manager-resize[data-dir="se"]{bottom:-6px;right:-6px;width:8px;height:8px;cursor:nwse-resize;}
.meldex-column-manager-resize[data-dir="sw"]{bottom:-6px;left:-6px;width:8px;height:8px;cursor:nesw-resize;}
/* 見出しの文字は折り返さない（2026-11-21 報告:「列管理」が改行されていた）。幅が足りない時は
   「すべて表示」「すべて非表示」のほうを次の行へ送る。 */
.meldex-column-manager-head{display:flex;flex-wrap:wrap;align-items:center;gap:4px 6px;padding:2px 4px 4px;font-weight:600;font-size:12px;}
.meldex-column-manager-head-icon{display:inline-flex;align-items:center;flex:0 0 auto;color:var(--fg2);}
.meldex-column-manager-head .meldex-column-manager-title{flex:1 0 auto;white-space:nowrap;}
.meldex-column-manager-head button{font-size:11px;padding:1px 6px;white-space:nowrap;flex:0 0 auto;}
.meldex-column-manager-icon{display:inline-flex;align-items:center;justify-content:center;width:16px;height:20px;flex:0 0 auto;opacity:.8;}
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
.meldex-column-manager-search{margin:0 2px 2px;}
.meldex-column-manager-extra{display:flex;flex-direction:column;gap:2px;padding-bottom:4px;border-bottom:1px solid var(--border);margin-bottom:2px;}
`;
    document.head.appendChild(style);
  }

  function zoom() {
    const z = typeof global._getZoom === 'function' ? Number(global._getZoom()) : 1;
    return Number.isFinite(z) && z > 0 ? z : 1;
  }

  // 利用者が変えた大きさを覚え、次に開いた時も同じ大きさで出す（ブラウザ保存が使えない時は今回の起動中だけ）。
  function readRememberedSize() {
    if (rememberedSize) return rememberedSize;
    try {
      const raw = JSON.parse(global.localStorage?.getItem(SIZE_STORAGE_KEY) || 'null');
      if (raw && Number(raw.w) >= MIN_WIDTH && Number(raw.h) >= MIN_HEIGHT) rememberedSize = { w: Number(raw.w), h: Number(raw.h) };
    } catch (_) { /* 保存が使えない環境 */ }
    return rememberedSize;
  }

  function rememberSize(size) {
    rememberedSize = { w: Math.round(size.w), h: Math.round(size.h) };
    try { global.localStorage?.setItem(SIZE_STORAGE_KEY, JSON.stringify(rememberedSize)); } catch (_) { /* 保存が使えない環境 */ }
  }

  function viewportLimits() {
    const z = zoom();
    return { z, maxW: (global.innerWidth || 1200) / z - 8, maxH: (global.innerHeight || 800) / z - 8 };
  }

  function applySize(root, size) {
    if (!size) return;
    const { maxW, maxH } = viewportLimits();
    root.classList.add('is-resized');
    root.style.width = Math.max(MIN_WIDTH, Math.min(maxW, size.w)) + 'px';
    root.style.height = Math.max(MIN_HEIGHT, Math.min(maxH, size.h)) + 'px';
  }

  // 辺と四隅でサイズを変える（UI共通ルール §7 のダイアログと同じ8方向）。
  function attachResizeHandles(root) {
    RESIZE_DIRS.forEach(dir => {
      const handle = document.createElement('div');
      handle.className = 'meldex-column-manager-resize';
      handle.dataset.dir = dir;
      handle.dataset.e2eId = 'column-manager-resize-' + dir;
      handle.setAttribute('aria-hidden', 'true');
      handle.addEventListener('pointerdown', (event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        const { z, maxW, maxH } = viewportLimits();
        const rect = root.getBoundingClientRect();
        const start = { x: event.clientX, y: event.clientY, w: rect.width / z, h: rect.height / z, left: rect.left / z, top: rect.top / z };
        root.classList.add('is-resized');
        root.style.width = start.w + 'px';
        root.style.height = start.h + 'px';
        try { handle.setPointerCapture?.(event.pointerId); } catch (_) { /* noop */ }
        const move = (ev) => {
          const dx = (ev.clientX - start.x) / z;
          const dy = (ev.clientY - start.y) / z;
          let { w, h, left, top } = start;
          // 画面の端（4px）より外へは広げない。
          if (dir.includes('e')) w = Math.max(MIN_WIDTH, Math.min(maxW + 4 - start.left, start.w + dx));
          if (dir.includes('s')) h = Math.max(MIN_HEIGHT, Math.min(maxH + 4 - start.top, start.h + dy));
          if (dir.includes('w')) {
            w = Math.max(MIN_WIDTH, Math.min(start.left + start.w - 4, start.w - dx));
            left = start.left + start.w - w;
          }
          if (dir.includes('n')) {
            h = Math.max(MIN_HEIGHT, Math.min(start.top + start.h - 4, start.h - dy));
            top = start.top + start.h - h;
          }
          root.style.width = w + 'px';
          root.style.height = h + 'px';
          root.style.left = left + 'px';
          root.style.top = top + 'px';
        };
        const end = () => {
          document.removeEventListener('pointermove', move, true);
          document.removeEventListener('pointerup', end, true);
          document.removeEventListener('pointercancel', end, true);
          const r = root.getBoundingClientRect();
          const zz = zoom();
          rememberSize({ w: r.width / zz, h: r.height / zz });
        };
        document.addEventListener('pointermove', move, true);
        document.addEventListener('pointerup', end, true);
        document.addEventListener('pointercancel', end, true);
      });
      root.appendChild(handle);
    });
  }

  function close() {
    if (!current) return;
    const state = current;
    current = null;
    state.cleanup.forEach(fn => { try { fn(); } catch (_) { /* noop */ } });
    if (document.querySelector(`.gb-row-handle-menu[data-e2e-id="${ROW_MENU_E2E_ID}"]`)) {
      try { global.MeldexContextMenuUI?.close?.(); } catch (_) { /* noop */ }
    }
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
      paint: null, drag: null, query: '',
    };
    current = state;
    // 中身はスクロールする本文へ入れる（外枠はスクロールさせない）。
    const body = document.createElement('div');
    body.className = 'meldex-column-manager-body';
    root.appendChild(body);

    const head = document.createElement('div');
    head.className = 'meldex-column-manager-head';
    if (options.icon) {
      const headIcon = document.createElement('span');
      headIcon.className = 'meldex-column-manager-head-icon';
      headIcon.setAttribute('aria-hidden', 'true');
      headIcon.innerHTML = icon(options.icon, 14);
      head.appendChild(headIcon);
    }
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
    body.appendChild(head);

    if (typeof options.renderExtra === 'function') {
      const extra = document.createElement('div');
      extra.className = 'meldex-column-manager-extra';
      options.renderExtra(extra);
      if (extra.childNodes.length) body.appendChild(extra);
    }

    // 列名で絞り込む検索欄（共通部品 MeldexSearchField。2026-11-21 ユーザー指示）。絞り込みは表示だけで、
    // 並べ替え・表示の切り替えの保存は常に全部の列の並びで行う（絞り込みで隠れた列を失わない）。
    const search = global.MeldexSearchField?.create?.({
      placeholder: '列名で検索',
      ariaLabel: '列名で検索',
      e2eId: 'column-manager-search',
      onInput: (query) => {
        state.query = String(query || '');
        render();
      },
    }) || null;
    if (search) {
      search.element.classList.add('meldex-column-manager-search');
      if (options.initialQuery) {
        search.input.value = String(options.initialQuery);
        search.element.classList.add('has-value');
        state.query = String(options.initialQuery);
      }
      search.input.addEventListener('keydown', (event) => {
        if (event.key !== 'ArrowDown' || event.isComposing) return;
        const first = shownOrder()[0];
        if (!first) return;
        event.preventDefault();
        rowOf(first.id)?.focus();
      });
      body.appendChild(search.element);
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
    body.append(visibleHead, visibleList, hiddenHead, hiddenList);

    const readItems = () => {
      const raw = typeof options.getItems === 'function' ? options.getItems() : [];
      return (Array.isArray(raw) ? raw : []).map(item => ({
        id: String(item.id),
        label: String(item.label ?? item.id),
        visible: item.visible !== false,
        lockedVisible: item.lockedVisible === true,
        iconHtml: typeof item.iconHtml === 'string' ? item.iconHtml : null,
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

    // 表示中の欄 → 非表示の欄の順に並べ直した「画面の並び」（絞り込み前の全部の列）。
    const displayOrder = () => [
      ...state.items.filter(item => item.visible),
      ...state.items.filter(item => !item.visible),
    ];
    // 検索欄の文字に一致する列だけ（画面に出ている行）。選択の範囲・キー移動はこちらで決める。
    const isShown = item => !state.query || (global.MeldexSearchField?.matches
      ? global.MeldexSearchField.matches(item.label, state.query)
      : String(item.label).toLowerCase().includes(state.query.toLowerCase()));
    const shownOrder = () => displayOrder().filter(isShown);

    // Shift+目のボタン: 前回押した行（起点）からの範囲。起点の行は押した時に別の欄へ移るので、
    // 起点が元いた欄での位置を覚えておき、同じ欄の今の並びで範囲を決める。
    function toggleRangeIds(anchor, toId) {
      const to = state.items.find(item => item.id === toId);
      if (!to || to.visible !== anchor.visible) return [toId];
      const section = shownOrder().filter(item => item.visible === anchor.visible).map(item => item.id);
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
      const order = shownOrder().map(item => item.id);
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
      handle.title = 'クリックでメニュー / ドラッグで並べ替え';
      handle.setAttribute('role', 'button');
      handle.setAttribute('aria-label', `${item.label}のメニュー`);
      handle.dataset.e2eId = 'column-manager-handle';
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
      row.append(handle, eye);
      // 列名の前のアイコン。1行でもアイコンを持つ時は、持たない行（トピック名の列など）にも同じ幅の
      // 空欄を置いて列名の開始位置をそろえる。
      if (state.items.some(entry => entry.iconHtml !== null)) {
        const typeIcon = document.createElement('span');
        typeIcon.className = 'meldex-column-manager-icon';
        typeIcon.setAttribute('aria-hidden', 'true');
        typeIcon.innerHTML = item.iconHtml || '';
        row.appendChild(typeIcon);
      }
      row.appendChild(label);
      bindRowMenu(handle, row, item);
      return row;
    }

    function render() {
      const scrollTop = body.scrollTop;
      const focusedId = document.activeElement?.closest?.('.meldex-column-manager-row')?.dataset.id || null;
      const visibleItems = state.items.filter(item => item.visible && isShown(item));
      const hiddenItems = state.items.filter(item => !item.visible && isShown(item));
      visibleHead.innerHTML = `<span>表示中</span><span class="meldex-column-manager-section-count">${visibleItems.length}</span>`;
      hiddenHead.innerHTML = `<span>非表示</span><span class="meldex-column-manager-section-count">${hiddenItems.length}</span>`;
      visibleList.replaceChildren(...visibleItems.map(buildRow));
      hiddenList.replaceChildren(...hiddenItems.map(buildRow));
      const emptyText = (dropText) => (state.query ? '一致する列はありません' : dropText);
      if (!visibleItems.length) visibleList.innerHTML = `<div class="meldex-column-manager-empty">${emptyText('ここへドラッグすると表示します')}</div>`;
      if (!hiddenItems.length) hiddenList.innerHTML = `<div class="meldex-column-manager-empty">${emptyText('ここへドラッグすると非表示にします')}</div>`;
      body.scrollTop = scrollTop;
      if (focusedId) rowOf(focusedId)?.focus({ preventScroll: true });
    }

    // 絞り込み中は、一致している列だけをまとめて切り替える。
    const shownIds = () => shownOrder().map(item => item.id);
    showAll.addEventListener('click', () => setVisibility(shownIds(), true, 'すべて表示'));
    hideAll.addEventListener('click', () => setVisibility(shownIds(), false, 'すべて非表示'));

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
      const order = shownOrder().map(item => item.id);
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

    // --- つまみのクリックメニュー（UI共通ルール §6 行ハンドルのクリックメニュー・一括実行） ------
    // ドラッグ（4px以上）とクリックは MeldexRowHandleMenu が区別する。クリックは選択を変えない。
    function refreshItems() {
      if (current !== state) return;
      state.items = readItems();
      const ids = new Set(state.items.map(item => item.id));
      state.selected = new Set([...state.selected].filter(id => ids.has(id)));
      render();
    }

    // 対象（同じ欄の中で連続していなくてもよい）をまとめて1つ上／下へ。欄の端に当たる時は動かさない。
    function movedSectionOrder(ids, dir) {
      const targets = state.items.filter(item => ids.includes(item.id));
      if (!targets.length || targets.some(item => item.visible !== targets[0].visible)) return null;
      const section = displayOrder().filter(item => item.visible === targets[0].visible);
      const order = global.MeldexRowHandleMenu?.moveOrder?.(section.map(item => item.id), ids, dir);
      return order ? { visible: targets[0].visible, order } : null;
    }

    function applyMovedSection(moved, detail) {
      const byId = new Map(state.items.map(item => [item.id, item]));
      const section = moved.order.map(id => byId.get(id));
      const other = displayOrder().filter(item => item.visible !== moved.visible);
      commit(moved.visible ? [...section, ...other] : [...other, ...section], detail);
    }

    function rowMenuItems(rowId) {
      const order = displayOrder().map(item => item.id);
      const targets = global.MeldexRowHandleMenu?.resolveTargets?.(rowId, order, state.selected)
        || { batch: false, ids: [rowId], runs: [[rowId]], count: 1, rowId };
      const targetItems = targets.ids.map(id => state.items.find(item => item.id === id)).filter(Boolean);
      if (!targetItems.length) return [];
      const detail = targetItems.map(item => item.label).join('、');
      let own = {};
      if (typeof options.getRowMenuItems === 'function') {
        try { own = options.getRowMenuItems({ ...targets, items: targetItems.map(item => ({ ...item })), refresh: refreshItems }) || {}; }
        catch (error) { console.warn('[MeldexColumnManager] 行メニューの項目を作れませんでした', error); }
      }
      const up = movedSectionOrder(targets.ids, -1);
      const down = movedSectionOrder(targets.ids, 1);
      const allVisible = targetItems.every(item => item.visible);
      const canHide = targetItems.some(item => item.visible && !item.lockedVisible);
      const items = [
        ...(own.duplicate || []),
        { type: 'separator' },
        { label: '上へ移動', icon: 'arrowUp', batch: true, disabled: !up, e2eId: 'column-manager-move-up',
          action: () => { if (up) applyMovedSection(up, detail); } },
        { label: '下へ移動', icon: 'arrowDown', batch: true, disabled: !down, e2eId: 'column-manager-move-down',
          action: () => { if (down) applyMovedSection(down, detail); } },
        { type: 'separator' },
        ...(own.settings || []),
        allVisible
          ? { label: '非表示にする', icon: 'eyeOff', batch: true, disabled: !canHide, e2eId: 'column-manager-hide',
            action: () => setVisibility(targets.ids, false, detail) }
          : { label: '表示する', icon: 'eye', batch: true, e2eId: 'column-manager-show',
            action: () => setVisibility(targets.ids, true, detail) },
        { type: 'separator' },
        { label: '選択を解除', batchOnly: true, e2eId: 'column-manager-clear-selection',
          action: () => { state.selected = new Set(); render(); } },
        { label: '選択を反転', batchOnly: true, e2eId: 'column-manager-invert-selection',
          action: () => { state.selected = new Set(order.filter(id => !state.selected.has(id))); render(); } },
        { type: 'separator' },
        ...(own.danger || []),
      ];
      return global.MeldexRowHandleMenu?.buildItems
        ? global.MeldexRowHandleMenu.buildItems(items, targets, { unit: '列' })
        : items.filter(item => !item.batchOnly);
    }

    function bindRowMenu(handle, row, item) {
      if (!global.MeldexRowHandleMenu?.bind) return;
      global.MeldexRowHandleMenu.bind(handle, {
        getRow: () => row,
        getItems: () => rowMenuItems(item.id),
        ariaLabel: `${item.label}のメニュー`,
        e2eId: ROW_MENU_E2E_ID,
      });
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
      // 列管理から開いた行メニュー・確認ダイアログの中の操作では閉じない。
      if (event.target?.closest?.(`.gb-context-menu[role="menu"], .modal-overlay`)) return;
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
    attachResizeHandles(root);
    applySize(root, readRememberedSize());
    position(root, anchor);
    state.refresh = refreshItems;
    return { root, close, refresh: refreshItems };
  }

  // 開いている列管理を読み直す（列名の変更など、列管理の外で列が変わった時）。
  function refresh() { current?.refresh?.(); }

  global.MeldexColumnManager = { open, close, refresh, isOpen: () => !!current };
})(typeof window !== 'undefined' ? window : globalThis);
