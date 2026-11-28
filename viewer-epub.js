/* viewer-epub.js — Meldexビューワー: EPUB（DRMなし）の表示・ページ割り・位置の記憶・選んだ文字のハイライト（親の側）。
   - 章は viewer-epub-book.js が消毒した文書として、sandbox="allow-scripts" の iframe（allow-same-origin を付けない＝
     不透明なオリジン）へ入れる。本の中身から Meldex のオリジン・Cookie・保存領域・ローカルAPI・親の関数へは届かない。
   - 章の文書のCSPは nonce つきで、動くのはビューワーの仲介スクリプト（viewer-epub-frame.js）だけ。本のスクリプトは
     消毒で取り除き、残っていてもCSPで動かない。読み込みは本の中の資源（data:）だけ。
   - 親と枠は postMessage だけでやり取りする。親は送り主（枠の window）と章ごとの合言葉を確かめ、決まった種類・形の
     知らせだけを受ける。枠へは秘密（ローカルAPIの合言葉など）を渡さない。
   - allow-same-origin を付けずに allow-scripts だけにしているのは、スクリプトを止めた sandbox（allow-scripts なし）では
     縦書きの文字をドラッグで選ぶと Chromium / Edge の表示処理ごと落ちるため（2026-11-28 実測: Chromium 148・Edge 158）。
     不透明なオリジン＋allow-scripts では落ちない。
   - リフロー型の本は段組み（CSS columns）で画面の大きさのページに割る（縦書きは段が下へ並ぶ）。固定レイアウトは
     1章＝1ページを画面に収める。単ページは枠1つ、見開きは枠2つ。進む方向「左へ」では最初のページを右に置く。
   - 文字の大きさ＝ビューワーの倍率。読んでいた位置は「章のパス＋章の本文の何文字目か」で覚える。
   - ハイライトは選んだ文字に付けるアノテート（type: highlight / target_kind: text_range）。位置は章のパス・本文の
     文字位置・引用（前後の文字つき）。描画は枠の中の CSS Highlight で行い、本文の文書は書き換えない。
   公開: window.MeldexViewerEpub */
(function () {
  'use strict';

  const Book = () => window.MeldexViewerEpubBook;
  const PageState = () => window.MeldexViewerPageState;
  const OUTER_Y = 12;
  const OUTER_X = 60; // 左右のページ送り領域（.nav-area 60px）に本文を重ねない
  const SPREAD_GAP = 12;
  const MIN_SCALE = 0.5, MAX_SCALE = 3;
  const CHAPTER_CACHE = 8;
  const RPC_TIMEOUT_MS = 10000;
  const LOAD_TIMEOUT_MS = 15000;
  const OPACITY_MODEL = 'color-alpha-v1';

  let state = null;
  let root = null;
  let openToken = 0;

  function ensureRoot() {
    if (root?.isConnected) return root;
    const display = document.getElementById('display');
    root = document.createElement('div');
    root.id = 'viewer-epub';
    root.className = 'viewer-epub';
    root.hidden = true;
    root.setAttribute('aria-label', '本文');
    display.appendChild(root);
    return root;
  }

  function createSlot(index) {
    const el = document.createElement('div');
    el.className = 'viewer-epub-slot';
    el.dataset.slot = String(index);
    const frame = document.createElement('iframe');
    frame.setAttribute('sandbox', 'allow-scripts');
    frame.setAttribute('referrerpolicy', 'no-referrer');
    frame.setAttribute('title', index ? '本文（2ページ目）' : '本文');
    frame.className = 'viewer-epub-frame';
    el.appendChild(frame);
    return { index, el, frame, spine: -1, href: '', page: 0, count: 0, token: 0, ready: null, channel: '', fixed: null, scale: 1,
      vertical: false, shown: false, selection: null, calls: new Map(), serial: 0, onReady: null };
  }

  // ---- 親と枠の間の決まった形のやり取り ----
  function rpc(slot, cmd, args = {}) {
    const win = slot.frame.contentWindow;
    if (!win || !slot.channel) return Promise.reject(new Error('章の枠がありません'));
    const id = ++slot.serial;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { slot.calls.delete(id); reject(new Error('章の枠が応答しません: ' + cmd)); }, RPC_TIMEOUT_MS);
      slot.calls.set(id, { resolve, reject, timer, channel: slot.channel });
      // 枠は不透明なオリジンなので送り先は '*'。送るのは本の表示に要る値だけ（秘密は渡さない）。
      win.postMessage({ meldexEpub: slot.channel, id, cmd, args }, '*');
    });
  }
  const isNum = value => typeof value === 'number' && Number.isFinite(value);
  const cleanRects = rects => (Array.isArray(rects) ? rects.slice(0, 200).filter(r => r && isNum(r.left) && isNum(r.top) && isNum(r.right) && isNum(r.bottom))
    .map(r => ({ left: r.left, top: r.top, right: r.right, bottom: r.bottom })) : []);
  function cleanSelection(value) {
    if (!value || value.has !== true || typeof value.text !== 'string' || !value.anchor) return null;
    const a = value.anchor;
    if (!isNum(a.start) || !isNum(a.end) || typeof a.quote !== 'string' || a.end <= a.start) return null;
    return { text: value.text.slice(0, 20000), rects: cleanRects(value.rects),
      anchor: { start: a.start, end: a.end, quote: a.quote.slice(0, 20000), prefix: String(a.prefix || '').slice(0, 48), suffix: String(a.suffix || '').slice(0, 48) } };
  }
  window.addEventListener('message', event => {
    if (!state) return;
    const slot = state.slots.find(item => item.frame.contentWindow && item.frame.contentWindow === event.source);
    const data = event.data;
    if (!slot || !data || typeof data !== 'object' || !slot.channel || data.meldexEpub !== slot.channel) return;
    if (data.reply != null) {
      const call = slot.calls.get(data.reply);
      if (!call) return;
      slot.calls.delete(data.reply); clearTimeout(call.timer);
      if (data.error) call.reject(new Error(String(data.error))); else call.resolve(data.result);
      return;
    }
    handleFrameEvent(slot, data);
  });

  function toParentPoint(slot, x, y) {
    const rect = slot.frame.getBoundingClientRect();
    const scale = slot.scale || 1;
    return { x: rect.left + (Number(x) || 0) * scale, y: rect.top + (Number(y) || 0) * scale };
  }
  const FORWARD_KEYS = /^(Arrow(Left|Right|Up|Down)|PageUp|PageDown|Home|End| |Escape|Enter|Tab|[A-Za-z0-9=+\-])$/;
  function handleFrameEvent(slot, data) {
    switch (data.type) {
      case 'ready': slot.onReady?.(); break;
      case 'selection': {
        slot.selection = cleanSelection(data.state);
        if (slot.selection) state.selectionSlot = slot;
        // 親のビューワーの「文字を選んでいるか」の判定（アノテートのハイライトのボタン）を更新させる
        document.dispatchEvent(new Event('selectionchange'));
        break;
      }
      case 'key': {
        if (typeof data.key !== 'string' || !FORWARD_KEYS.test(data.key)) break;
        document.dispatchEvent(new KeyboardEvent('keydown', { key: data.key, code: String(data.code || ''), shiftKey: !!data.shiftKey,
          ctrlKey: !!data.ctrlKey, altKey: !!data.altKey, metaKey: !!data.metaKey, repeat: !!data.repeat, bubbles: true, cancelable: true }));
        break;
      }
      case 'wheel': {
        const point = toParentPoint(slot, data.x, data.y);
        document.getElementById('display').dispatchEvent(new WheelEvent('wheel', { deltaX: Number(data.deltaX) || 0, deltaY: Number(data.deltaY) || 0,
          deltaMode: Number(data.deltaMode) || 0, clientX: point.x, clientY: point.y, ctrlKey: !!data.ctrlKey, bubbles: true, cancelable: true }));
        break;
      }
      case 'contextmenu': {
        const point = toParentPoint(slot, data.x, data.y);
        state.menuSlot = slot;
        window.MeldexViewerContextMenu?.openAt?.(point.x, point.y, null);
        break;
      }
      case 'pointerdown': {
        if (window.MeldexContextMenuUI?.isOpen?.()) window.MeldexContextMenuUI.close?.();
        // 枠ごとに選択を持つので、もう一方の枠の選択を外す（ハイライトの対象を1つにする）
        state.slots.forEach(other => { if (other !== slot && other.selection) { other.selection = null; rpc(other, 'clearSelection').catch(() => {}); } });
        break;
      }
      case 'swipe': {
        const forwardLeft = state.direction === 'left';
        if ((Number(data.dx) < 0) !== forwardLeft) void next(); else void prev();
        break;
      }
      case 'move': {
        const point = toParentPoint(slot, data.x, data.y);
        document.dispatchEvent(new MouseEvent('mousemove', { clientX: point.x, clientY: point.y, bubbles: true }));
        break;
      }
      case 'link': if (typeof data.href === 'string') void goToHref(data.href.slice(0, 2000)); break;
      case 'external': window.MeldexViewerScene?.flashStatus?.('本の外へのリンクは開きません: ' + String(data.href || '').slice(0, 300), 4000); break;
      default: break;
    }
  }

  // ---- 位置・設定の保存（ファイルごと）----
  async function saveLocation() {
    const session = state;
    if (!session) return;
    const lead = session.slots[0];
    if (lead.spine < 0) return;
    const spine = lead.spine, page = lead.page, href = lead.href, count = lead.count;
    let offset = 0;
    try { offset = Number(await rpc(lead, 'offsetAtPage', { page })) || 0; } catch (_) { return; }
    if (session !== state || lead.spine !== spine || lead.page !== page) return;
    session.location = { href, offset, page, count };
    clearTimeout(session.saveTimer);
    const location = session.location;
    session.saveTimer = setTimeout(() => { PageState()?.write(session.path, { epubLocation: location }); }, 250);
  }

  // ---- ページ割り ----
  function geometry() {
    const display = document.getElementById('display');
    const width = Math.max(200, display.clientWidth - OUTER_X * 2);
    const height = Math.max(160, display.clientHeight - OUTER_Y * 2);
    const spread = state.mode === 'spread';
    const slotWidth = spread ? Math.max(120, Math.floor((width - SPREAD_GAP) / 2)) : width;
    return { slotWidth, slotHeight: height, spread };
  }
  function sizeFrame(slot) {
    const geo = geometry();
    if (slot.fixed) {
      const s = Math.min(geo.slotWidth / slot.fixed.width, geo.slotHeight / slot.fixed.height);
      slot.frame.style.width = slot.fixed.width + 'px';
      slot.frame.style.height = slot.fixed.height + 'px';
      slot.frame.style.transform = `scale(${s})`;
      slot.scale = s;
      slot.el.style.width = Math.round(slot.fixed.width * s) + 'px';
      slot.el.style.height = Math.round(slot.fixed.height * s) + 'px';
    } else {
      slot.frame.style.width = geo.slotWidth + 'px';
      slot.frame.style.height = geo.slotHeight + 'px';
      slot.frame.style.transform = '';
      slot.scale = 1;
      slot.el.style.width = geo.slotWidth + 'px';
      slot.el.style.height = geo.slotHeight + 'px';
    }
    return geo;
  }
  async function applyLayout(slot) {
    const geo = sizeFrame(slot);
    const info = await rpc(slot, 'layout', { W: geo.slotWidth, H: geo.slotHeight, scale: state.fontScale, fixed: slot.fixed });
    slot.count = Math.max(1, Number(info?.count) || 1);
    slot.vertical = !!info?.vertical;
    return slot.count;
  }
  async function scrollSlot(slot) { await rpc(slot, 'scroll', { page: slot.page }); }

  // ---- 章を枠へ読み込む ----
  function chapter(index) {
    const cache = state.chapters;
    if (cache.has(index)) { const hit = cache.get(index); cache.delete(index); cache.set(index, hit); return hit; }
    const promise = state.book.buildChapter(index);
    cache.set(index, promise);
    promise.catch(() => cache.delete(index));
    while (cache.size > CHAPTER_CACHE) cache.delete(cache.keys().next().value);
    return promise;
  }

  function loadSlot(slot, index) {
    if (slot.spine === index && slot.ready) return slot.ready;
    const token = ++slot.token;
    const session = state;
    slot.spine = index; slot.count = 0; slot.page = 0; slot.selection = null; slot.channel = '';
    slot.calls.forEach(call => { clearTimeout(call.timer); call.reject(new Error('章を読み直しました')); });
    slot.calls.clear();
    slot.ready = (async () => {
      const built = await chapter(index);
      if (token !== slot.token || session !== state) return false;
      slot.fixed = built.fixed;
      slot.href = built.href;
      sizeFrame(slot);
      const loaded = new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('章の表示が時間内に終わりませんでした')), LOAD_TIMEOUT_MS);
        slot.onReady = () => { clearTimeout(timer); slot.onReady = null; resolve(); };
      });
      slot.channel = built.channel;
      slot.frame.srcdoc = built.html;
      await loaded;
      if (token !== slot.token || session !== state) return false;
      await applyLayout(slot);
      if (token !== slot.token || session !== state) return false;
      await paintSlot(slot);
      return true;
    })();
    slot.ready.catch(() => { if (slot.token === token) { slot.ready = null; slot.spine = -1; } });
    return slot.ready;
  }

  // ---- 表示 ----
  function nextPos(slot) {
    if (slot.page + 1 < slot.count) return { spine: slot.spine, page: slot.page + 1 };
    return slot.spine + 1 < state.book.spine.length ? { spine: slot.spine + 1, page: 0 } : null;
  }

  function arrange() {
    const spread = state.mode === 'spread';
    const rtl = spread && state.direction === 'left';
    root.dataset.mode = spread ? 'spread' : 'single';
    root.dataset.order = rtl ? 'rtl' : 'ltr';
    state.slots.forEach((slot, i) => {
      slot.el.hidden = i > 0 && !spread;
      slot.el.style.order = String(rtl ? state.slots.length - i : i);
    });
  }

  async function display(target, options = {}) {
    const session = state;
    const token = ++session.displayToken;
    const lead = session.slots[0];
    const started = performance.now();
    await loadSlot(lead, target.spine);
    if (token !== session.displayToken || session !== state) return false;
    let page = target.page;
    if (target.offset != null) page = Number(await rpc(lead, 'pageForOffset', { offset: target.offset })) || 0;
    if (target.range) page = await target.range(lead);
    if (token !== session.displayToken || session !== state) return false;
    if (page < 0) page = lead.count + page;
    const leadPage = Math.max(0, Math.min(lead.count - 1, Number(page) || 0));
    arrange();
    const second = session.slots[1];
    // 見開きの2ページ目は、別の章なら読み込みを待ってから2ページを同時に切り替える（片方だけ古いページが残らない）
    let secondPage = -1;
    if (session.mode === 'spread') {
      const next = leadPage + 1 < lead.count ? { spine: lead.spine, page: leadPage + 1 }
        : (lead.spine + 1 < session.book.spine.length ? { spine: lead.spine + 1, page: 0 } : null);
      if (next) {
        try {
          await loadSlot(second, next.spine);
          if (token !== session.displayToken || session !== state) return false;
          secondPage = Math.max(0, Math.min(second.count - 1, next.page));
        } catch (error) { console.warn('[viewer-epub] 2ページ目を表示できませんでした', error?.message || error); }
      }
    }
    lead.page = leadPage;
    const scrolls = [scrollSlot(lead)];
    lead.shown = true;
    if (secondPage >= 0) {
      second.page = secondPage;
      scrolls.push(scrollSlot(second));
      second.el.classList.remove('viewer-epub-blank');
      second.shown = true;
    } else {
      if (session.mode === 'spread') second.el.classList.add('viewer-epub-blank');
      second.shown = false;
    }
    await Promise.all(scrolls);
    if (token !== session.displayToken || session !== state) return false;
    root.hidden = false;
    session.label = computeLabel();
    session.lastTurnMs = performance.now() - started;
    if (!options.keepLocation) {
      // 位置はすぐ覚える（文字位置は枠に問い合わせて後から埋める）。直後の並べ直しが前の位置へ戻さない。
      session.location = { href: lead.href, offset: null, page: lead.page, count: lead.count };
      void saveLocation();
    }
    window.dispatchEvent(new CustomEvent('viewer-epub-position', { detail: { spine: lead.spine } }));
    prefetch(lead.spine);
    return true;
  }

  // 次の章の文書を手が空いた時に組み立てておく（表示はしない）。
  function prefetch(index) {
    const session = state;
    clearTimeout(session.prefetchTimer);
    session.prefetchTimer = setTimeout(() => {
      if (session !== state) return;
      [index + 1, index + 2, index - 1].forEach(i => { if (i >= 0 && i < session.book.spine.length) chapter(i).catch(() => {}); });
    }, 200);
  }

  function lastShown() {
    const slots = state.slots.filter(slot => slot.shown && slot.spine >= 0);
    return slots[slots.length - 1] || state.slots[0];
  }

  async function next() {
    if (!state?.ready) return false;
    const target = nextPos(lastShown());
    if (!target) { window.MeldexViewerScene?.flashStatus?.('最後のページです'); return false; }
    return display(target);
  }
  async function prev() {
    if (!state?.ready) return false;
    const lead = state.slots[0];
    const step = state.mode === 'spread' ? 2 : 1;
    if (lead.page >= step) return display({ spine: lead.spine, page: lead.page - step });
    if (lead.page > 0) return display({ spine: lead.spine, page: 0 });
    if (lead.spine <= 0) { window.MeldexViewerScene?.flashStatus?.('最初のページです'); return false; }
    return display({ spine: lead.spine - 1, page: -step });
  }
  function goToChapter(index) {
    if (!state?.ready) return false;
    const target = Math.max(0, Math.min(state.book.spine.length - 1, Number(index) || 0));
    return display({ spine: target, page: 0 });
  }
  function goToHref(href) {
    if (!state?.ready) return false;
    const [path, fragment] = String(href || '').split('#');
    const index = state.book.spineIndexOf(path);
    if (index < 0) { window.MeldexViewerScene?.flashStatus?.('この本の中のリンク先が見つかりません'); return false; }
    return display({ spine: index, page: 0, range: fragment ? async slot => Number(await rpc(slot, 'pageForFragment', { id: fragment })) || 0 : null });
  }

  // 文字の大きさ・窓の大きさ・表示モードが変わった時に、読んでいた文の辺りを開き直す。
  async function relayout() {
    if (!state?.ready) return;
    const session = state;
    const lead = session.slots[0];
    // まだページを送っていない時は、今のページの最初の文字を基準にする（並べ替える前のページ割りで求める）
    let location = session.location;
    if (!location && lead.channel) {
      try { location = { href: lead.href, offset: Number(await rpc(lead, 'offsetAtPage', { page: lead.page })) || 0 }; } catch (_) { location = null; }
    }
    if (session !== state) return;
    await Promise.all(session.slots.filter(slot => slot.channel && slot.spine >= 0).map(slot => applyLayout(slot).catch(() => {})));
    if (session !== state) return;
    // 並べ直しの間に別の場所へ移っていたら、その位置を使う
    if (session.location && session.location !== location) location = session.location;
    // 覚えている位置（文字位置）は書き換えない。大きさを何度変えても、読んでいた文から前へずれていかない。
    if (location) {
      const spine = Math.max(0, session.book.spineIndexOf(location.href));
      await display(location.offset == null ? { spine, page: Number(location.page) || 0 } : { spine, page: 0, offset: location.offset }, { keepLocation: true });
    }
  }
  let relayoutTimer = 0;
  function scheduleRelayout() {
    clearTimeout(relayoutTimer);
    relayoutTimer = setTimeout(() => { void relayout(); }, 120);
  }

  // ---- ハイライト ----
  function parseData(value) {
    try { const parsed = typeof value === 'string' ? JSON.parse(value) : value; return parsed && typeof parsed === 'object' ? parsed : {}; }
    catch (_) { return {}; }
  }
  function rowsForHref(href) {
    return [...(state.rows || []), ...state.pending.values()].map(row => ({ row, data: parseData(row.data) }))
      .filter(({ row, data }) => row.type === 'highlight' && !data.deleted && data.textAnchor?.kind === 'epub' && data.textAnchor.href === href);
  }
  async function paintSlot(slot) {
    if (!slot.channel || !state) return 0;
    const rows = rowsForHref(slot.href).map(({ row, data }) => ({ id: String(row.id), color: String(row.color || ''),
      legacy: data.opacityModel !== OPACITY_MODEL, anchor: data.textAnchor }));
    try { return await rpc(slot, 'paint', { rows }); } catch (_) { return 0; }
  }
  function paintAll() { state?.slots.forEach(slot => { if (slot.channel && slot.spine >= 0) void paintSlot(slot); }); }

  async function reloadHighlights() {
    if (!state) return;
    const session = state, token = ++session.highlightToken;
    try {
      if (typeof window.apiFetch !== 'function') return;
      const rows = await window.apiFetch('/annotations?target=' + encodeURIComponent(session.path));
      if (session !== state || token !== session.highlightToken) return;
      session.rows = Array.isArray(rows) ? rows : [];
      paintAll();
    } catch (error) {
      console.warn('[viewer-epub] ハイライトを読み込めませんでした', error?.message || error);
    }
  }
  let highlightReloadTimer = 0;
  window.addEventListener('meldex-viewer-annotations-changed', () => {
    if (!state) return;
    clearTimeout(highlightReloadTimer);
    highlightReloadTimer = setTimeout(() => { void reloadHighlights(); }, 50);
  });

  // 選んでいる文字（どちらかの枠。枠が選択の変化ごとに知らせる）。ハイライトの位置を作る。
  function activeSlot() {
    if (!state?.ready) return null;
    return [state.selectionSlot, ...state.slots].find(slot => slot && slot.shown && slot.selection) || null;
  }
  function captureSelection() {
    const slot = activeSlot();
    if (!slot) return null;
    const { text, rects, anchor } = slot.selection;
    const last = rects[rects.length - 1];
    const point = last ? toParentPoint(slot, (last.left + last.right) / 2, last.bottom) : null;
    return { path: state.path, text, slot, point,
      anchor: { kind: 'epub', href: slot.href, spine: slot.spine, ...anchor } };
  }
  function clearSelection() {
    state?.slots.forEach(slot => { if (slot.selection) { slot.selection = null; rpc(slot, 'clearSelection').catch(() => {}); } });
  }
  function restoreSelection(context) {
    const slot = context?.slot;
    if (!slot?.channel || slot.href !== context.anchor?.href) return;
    rpc(slot, 'restoreSelection', { anchor: context.anchor }).catch(() => {});
  }
  function addPending(row) { if (!state) return ''; state.pending.set(row.id, row); paintAll(); return row.id; }
  function commitPending(id, saved) {
    if (!state) return;
    state.pending.delete(id);
    if (saved) state.rows = [...(state.rows || []).filter(row => String(row.id) !== String(saved.id)), saved];
    paintAll();
  }
  function selectedText() { return activeSlot()?.selection?.text.trim() || ''; }
  function pointOnSelection(x, y) {
    const slot = activeSlot();
    if (!slot || !Number.isFinite(x) || !Number.isFinite(y)) return false;
    const margin = 8;
    return slot.selection.rects.some(rect => {
      const a = toParentPoint(slot, rect.left, rect.top), b = toParentPoint(slot, rect.right, rect.bottom);
      return x >= a.x - margin && x <= b.x + margin && y >= a.y - margin && y <= b.y + margin;
    });
  }
  // コピーは親が選んだ文字を受け取って行う（枠には書き込みの権限を渡さない）
  function copySelection() { return false; }

  // アノテート管理のカードから: そのハイライトのページへ移り、範囲を示す。
  function reveal(item) {
    if (!state?.ready) return false;
    const data = parseData(item?.data);
    const anchor = data.textAnchor;
    if (anchor?.kind !== 'epub') return false;
    const index = state.book.spineIndexOf(anchor.href);
    if (index < 0) { window.MeldexViewerScene?.flashStatus?.('ハイライトの章が見つかりません'); return true; }
    void (async () => {
      let found = false;
      await display({ spine: index, page: 0, range: async slot => {
        const result = await rpc(slot, 'pageForAnchor', { anchor });
        found = !!result?.found;
        return Number(result?.page) || 0;
      } });
      if (!found) { window.MeldexViewerScene?.flashStatus?.('ハイライトの位置が見つかりませんでした', 4000); return; }
      const lead = state.slots[0];
      flash(lead, cleanRects(await rpc(lead, 'rects', { anchor }).catch(() => [])));
    })();
    return true;
  }
  function flash(slot, rects) {
    if (!rects.length) return;
    const first = toParentPoint(slot, Math.min(...rects.map(r => r.left)), Math.min(...rects.map(r => r.top)));
    const last = toParentPoint(slot, Math.max(...rects.map(r => r.right)), Math.max(...rects.map(r => r.bottom)));
    const mark = document.createElement('div');
    mark.dataset.epubHighlightFlash = '';
    mark.style.cssText = `position:fixed;pointer-events:none;z-index:40;left:${first.x}px;top:${first.y}px;width:${last.x - first.x}px;height:${last.y - first.y}px;outline:2px solid var(--accent);outline-offset:2px;border-radius:2px`;
    document.body.appendChild(mark);
    setTimeout(() => mark.remove(), 1200);
  }

  // ---- 開く・閉じる ----
  async function open(path, options = {}) {
    close();
    const token = ++openToken;
    const response = await fetch(options.url, { cache: 'no-store' });
    if (!response.ok) throw new Error('EPUBファイルを読み込めませんでした（' + response.status + '）');
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (token !== openToken) return null;
    const book = await Book().open(bytes, { name: String(path).split(/[\\/]/).pop() });
    if (token !== openToken) { book.dispose(); return null; }
    ensureRoot();
    root.replaceChildren();
    const slots = [createSlot(0), createSlot(1)];
    slots.forEach(slot => root.appendChild(slot.el));
    // 隠したままだと本文の大きさを測れない（ページ数が1になる）。読み込み中の表示はこの上に重なる。
    root.hidden = false;
    slots[1].el.hidden = true;
    const saved = PageState()?.read(path) || {};
    state = {
      path, book, slots, ready: false, mode: options.mode === 'spread' ? 'spread' : 'single',
      direction: (typeof options.directionFor === 'function' ? options.directionFor(book) : options.direction) || 'right',
      fontScale: clampScale(options.fontScale), chapters: new Map(), displayToken: 0, highlightToken: 0, rows: [], pending: new Map(),
      location: saved.epubLocation && typeof saved.epubLocation === 'object' ? saved.epubLocation : null,
      saveTimer: 0, prefetchTimer: 0, selectionSlot: null, menuSlot: null, lastTurnMs: 0, label: '',
    };
    const location = state.location;
    const startIndex = location ? Math.max(0, book.spineIndexOf(location.href)) : 0;
    const startedAt = performance.now();
    await display(!location ? { spine: 0, page: 0 }
      : (location.offset == null ? { spine: startIndex, page: Number(location.page) || 0 } : { spine: startIndex, page: 0, offset: location.offset }),
    { keepLocation: true });
    if (token !== openToken) return null;
    state.ready = true;
    state.firstPageMs = performance.now() - startedAt;
    void reloadHighlights();
    return { book, direction: state.direction, items: book.spine.map(item => ({ type: 'epub-chapter', path, name: tocLabelFor(book, item.href) || item.href.split('/').pop(), spineIndex: item.index, w: 0, h: 0 })) };
  }
  function tocLabelFor(book, href) { return book.toc.find(entry => entry.href === href)?.label || ''; }
  function close() {
    openToken++;
    if (state) {
      clearTimeout(state.saveTimer); clearTimeout(state.prefetchTimer);
      if (state.location) PageState()?.write(state.path, { epubLocation: state.location });
      state.slots.forEach(slot => { slot.calls.forEach(call => clearTimeout(call.timer)); slot.calls.clear(); slot.channel = ''; });
      state.book.dispose();
    }
    state = null;
    if (root) { root.replaceChildren(); root.hidden = true; }
  }

  function clampScale(value) { const n = Number(value); return Number.isFinite(n) && n > 0 ? Math.max(MIN_SCALE, Math.min(MAX_SCALE, n)) : 1; }
  function setFontScale(value) {
    if (!state) return 1;
    const next = clampScale(value);
    if (Math.abs(next - state.fontScale) < 0.001) return next;
    state.fontScale = next;
    PageState()?.write(state.path, { epubFontScale: next });
    void relayout();
    return next;
  }
  function setMode(mode) {
    if (!state) return;
    state.mode = mode === 'spread' ? 'spread' : 'single';
    void relayout();
  }
  function setDirection(direction) {
    if (!state) return;
    state.direction = direction;
    arrange();
  }
  // 表示を切り替え終えた時の位置（読み込み途中の章の番号を出さない）
  function positionLabel() { return state?.ready ? (state.label || computeLabel()) : ''; }
  function computeLabel() {
    const lead = state.slots[0];
    const page = lead.page + 1;
    const end = state.mode === 'spread' && state.slots[1].shown && state.slots[1].spine === lead.spine ? state.slots[1].page + 1 : page;
    return `${lead.spine + 1}/${state.book.spine.length}章 ${page === end ? page : page + '-' + end}/${lead.count}`;
  }

  window.addEventListener('viewer-layout-resize', () => { if (state?.ready) scheduleRelayout(); });
  window.addEventListener('resize', () => { if (state?.ready) scheduleRelayout(); });

  window.MeldexViewerEpub = {
    open, close, next, prev, goToChapter, goToHref, relayout, setFontScale, setMode, setDirection,
    isActive: () => !!state,
    isReady: () => !!state?.ready,
    getPath: () => state?.path || '',
    currentSpine: () => state?.slots[0].spine ?? -1,
    positionLabel,
    toc: () => state?.book.toc || [],
    spineIndexOf: href => (state ? state.book.spineIndexOf(String(href || '').split('#')[0]) : -1),
    bookInfo: () => state ? { title: state.book.title, rtl: state.book.rtl, chapters: state.book.spine.length, language: state.book.language } : null,
    metrics: () => state ? { firstPageMs: state.firstPageMs || 0, lastTurnMs: state.lastTurnMs || 0 } : null,
    // ハイライト（viewer-highlights.js が使う）
    captureSelection, clearSelection, restoreSelection, addPending, commitPending, reloadHighlights, reveal,
    selectedText, pointOnSelection, copySelection, hasSelection: () => !!captureSelection(),
    // 検査用の参照（枠の中身には触れない。値だけ）
    _state: () => state,
  };
})();
