/* viewer-epub-frame.js — EPUBの章の枠（iframe）の中で動く、ビューワーの小さな仲介スクリプト。
   この関数は親（ビューワー）では実行しない。viewer-epub-book.js が文字列にして章の文書へ nonce 付きで埋め込む。
   章の枠は sandbox="allow-scripts"（allow-same-origin を付けない＝不透明なオリジン）なので、本の中身から
   Meldexのオリジン・Cookie・保存領域・ローカルAPIへは届かない。親とは postMessage だけでやり取りし、
   親は送り主（この枠の window）と章ごとの合言葉を確かめる。本のスクリプトは消毒とCSP（nonce のない
   スクリプトは動かない）で止める。ここではページ割り・文字の選択・ハイライトの描画だけを行う。
   公開: window.MeldexViewerEpubFrame（親では関数の定義だけ） */
(function (global) {
  'use strict';

  function meldexEpubFrame() {
    'use strict';
    const script = document.currentScript;
    const TOKEN = script ? script.getAttribute('data-channel') : '';
    if (script) script.remove(); // 合言葉を文書に残さない
    const OPACITY_MODEL = 'color-alpha-v1';
    const send = message => { try { parent.postMessage(Object.assign({ meldexEpub: TOKEN }, message), '*'); } catch (_) { /* 親が無い */ } };
    let geometry = { W: 0, H: 0, scale: 1, fixed: null };
    let vertical = false, writingMode = '', count = 1, stride = 1, page = 0, expected = null;
    let parts = null;
    const pageCache = new Map();
    let highlightKeys = [];
    const doc = document;
    const style = id => doc.getElementById(id);

    // ---- ページ割り ----
    function detectWritingMode() {
      const body = doc.body || doc.documentElement;
      const bodyMode = getComputedStyle(body).writingMode || '';
      const rootMode = getComputedStyle(doc.documentElement).writingMode || '';
      const mode = /^vertical/.test(bodyMode) ? bodyMode : rootMode;
      vertical = !geometry.fixed && /^vertical/.test(mode);
      writingMode = vertical ? mode : '';
    }
    function layoutCss() {
      const fixed = geometry.fixed;
      if (fixed) {
        return 'html{margin:0!important;padding:0!important;width:' + fixed.width + 'px!important;height:' + fixed.height
          + 'px!important;overflow:hidden!important;}body{margin:0!important;}';
      }
      const W = geometry.W, H = geometry.H, scale = geometry.scale;
      const padY = Math.round(Math.min(48, Math.max(16, H * 0.05)));
      let padX = Math.round(Math.min(48, Math.max(16, W * 0.05)));
      // 横書きの1行が長くなりすぎないよう、幅の広い単ページでは左右の余白を広げる（約42字）。
      if (!vertical) padX = Math.max(padX, Math.floor((W - 42 * 16 * scale) / 2));
      const columns = vertical
        ? 'column-width:' + (H - padY * 2) + 'px!important;column-gap:' + (padY * 2) + 'px!important;writing-mode:' + writingMode + '!important;'
        : 'column-width:' + (W - padX * 2) + 'px!important;column-gap:' + (padX * 2) + 'px!important;';
      return 'html{margin:0!important;box-sizing:border-box!important;width:' + W + 'px!important;height:' + H + 'px!important;'
        + 'min-width:0!important;min-height:0!important;max-width:none!important;max-height:none!important;overflow:hidden!important;'
        + 'padding:' + padY + 'px ' + padX + 'px!important;column-fill:auto!important;column-count:auto!important;' + columns
        + 'font-size:' + Math.round(100 * scale) + '%!important;-webkit-text-size-adjust:none;}'
        + 'body{margin:0!important;padding:0!important;max-width:none!important;max-height:none!important;min-height:0!important;'
        + 'column-count:auto!important;column-width:auto!important;overflow:visible!important;}'
        + 'img,svg,video{max-width:' + (W - padX * 2) + 'px!important;max-height:' + (H - padY * 2) + 'px!important;'
        + 'box-sizing:border-box;object-fit:contain;break-inside:avoid;}::selection{background:rgba(70,130,220,.35);}';
    }
    function layout(args) {
      geometry = { W: Number(args.W) || 0, H: Number(args.H) || 0, scale: Number(args.scale) || 1,
        fixed: args.fixed && args.fixed.width > 0 ? { width: Number(args.fixed.width), height: Number(args.fixed.height) } : null };
      const sheet = style('meldex-epub-layout');
      sheet.textContent = '';
      detectWritingMode();
      sheet.textContent = layoutCss();
      if (geometry.fixed) { count = 1; stride = 1; }
      else {
        const scroller = doc.scrollingElement || doc.documentElement;
        stride = vertical ? geometry.H : geometry.W;
        const total = vertical ? scroller.scrollHeight : scroller.scrollWidth;
        count = Math.max(1, Math.ceil((total - 2) / stride));
      }
      pageCache.clear();
      page = Math.min(page, count - 1);
      scrollToPage(page);
      return { count, vertical, writingMode };
    }
    function scrollToPage(next) {
      page = Math.max(0, Math.min(count - 1, Number(next) || 0));
      expected = geometry.fixed ? 0 : page * stride;
      if (vertical) scrollTo(0, expected); else scrollTo(expected, 0);
      return page;
    }

    // ---- 本文の文字（ルビの読みは位置の数え方から外す）----
    function textParts() {
      if (parts) return parts;
      const body = doc.body || doc.documentElement;
      const nodes = [];
      let text = '';
      const walker = doc.createTreeWalker(body, NodeFilter.SHOW_TEXT, {
        acceptNode: node => (node.parentElement && node.parentElement.closest('rt,rp') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
      });
      while (walker.nextNode()) { const node = walker.currentNode; nodes.push({ node, start: text.length }); text += node.nodeValue; }
      parts = { nodes, text };
      return parts;
    }
    const firstRect = range => [...range.getClientRects()].find(r => r.width || r.height) || range.getBoundingClientRect();
    function pageOfRect(rect) {
      if (!rect || !(rect.width || rect.height)) return null;
      if (geometry.fixed) return 0;
      const pos = vertical ? rect.top + scrollY + rect.height / 2 : rect.left + scrollX + rect.width / 2;
      return Math.max(0, Math.min(count - 1, Math.floor(pos / stride)));
    }
    function pageOfPart(index) {
      if (pageCache.has(index)) return pageCache.get(index);
      const part = textParts().nodes[index];
      let result = null;
      const at = part ? part.node.nodeValue.search(/\S/) : -1;
      if (at >= 0) {
        const range = doc.createRange();
        range.setStart(part.node, at); range.setEnd(part.node, at + 1);
        result = pageOfRect(firstRect(range));
      }
      pageCache.set(index, result);
      return result;
    }
    // ページの最初の文字の位置（二分探索。文字の無いページは次の文字の位置）。
    function offsetAtPage(args) {
      const target = Number(args.page) || 0;
      const nodes = textParts().nodes;
      if (!nodes.length || geometry.fixed) return 0;
      let lo = 0, hi = nodes.length - 1, found = -1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        let probe = mid, value = null;
        while (probe <= hi && (value = pageOfPart(probe)) == null) probe++;
        if (value == null) { hi = mid - 1; continue; }
        if (value >= target) { found = probe; hi = mid - 1; } else lo = probe + 1;
      }
      if (found < 0) return textParts().text.length;
      const part = nodes[found];
      return part.start + Math.max(0, part.node.nodeValue.search(/\S/));
    }
    function pageForOffset(args) {
      if (geometry.fixed) return 0;
      const offset = Number(args.offset) || 0;
      const all = textParts();
      const part = all.nodes.find(p => offset >= p.start && offset < p.start + p.node.nodeValue.length)
        || all.nodes.find(p => p.start >= offset && /\S/.test(p.node.nodeValue));
      if (!part) return Math.max(0, count - 1);
      const at = Math.max(0, Math.min(part.node.nodeValue.length - 1, offset - part.start));
      const range = doc.createRange();
      range.setStart(part.node, at); range.setEnd(part.node, Math.min(part.node.nodeValue.length, at + 1));
      const result = pageOfRect(firstRect(range));
      return result == null ? 0 : result;
    }
    function rangeFor(anchor) {
      if (!anchor || typeof anchor.quote !== 'string' || !anchor.quote) return null;
      const all = textParts();
      let start = Number(anchor.start), end = Number(anchor.end);
      if (all.text.slice(start, end) !== anchor.quote) {
        const hits = [];
        for (let pos = all.text.indexOf(anchor.quote); pos >= 0; pos = all.text.indexOf(anchor.quote, pos + 1)) {
          const prefix = String(anchor.prefix || ''), suffix = String(anchor.suffix || '');
          if ((!prefix || all.text.slice(Math.max(0, pos - prefix.length), pos) === prefix)
            && (!suffix || all.text.slice(pos + anchor.quote.length, pos + anchor.quote.length + suffix.length) === suffix)) hits.push(pos);
          if (hits.length > 1) break;
        }
        if (hits.length !== 1) return null; // あいまいな引用を別の文へ付けない
        start = hits[0]; end = start + anchor.quote.length;
      }
      const first = all.nodes.find(p => start >= p.start && start < p.start + p.node.nodeValue.length);
      const last = all.nodes.find(p => end > p.start && end <= p.start + p.node.nodeValue.length);
      if (!first || !last) return null;
      const range = doc.createRange();
      range.setStart(first.node, start - first.start);
      range.setEnd(last.node, end - last.start);
      return range;
    }
    function pageForAnchor(args) {
      const range = rangeFor(args.anchor);
      if (!range) return { page: 0, found: false };
      const result = pageOfRect(firstRect(range));
      return { page: result == null ? 0 : result, found: true };
    }
    function pageForFragment(args) {
      const id = String(args.id || '');
      const el = doc.getElementById(id) || (doc.getElementsByName(id) || [])[0];
      if (!el) return 0;
      const result = pageOfRect(el.getClientRects()[0] || el.getBoundingClientRect());
      return result == null ? 0 : result;
    }
    function rectsOf(range) {
      return [...range.getClientRects()].filter(r => r.width && r.height).slice(0, 200)
        .map(r => ({ left: r.left, top: r.top, right: r.right, bottom: r.bottom }));
    }
    function rects(args) { const range = rangeFor(args.anchor); return range ? rectsOf(range) : []; }

    // ---- ハイライト（CSS Highlight。本文の文書は書き換えない）----
    function paint(args) {
      const registry = window.CSS && CSS.highlights;
      const sheet = style('meldex-epub-highlights');
      highlightKeys.forEach(key => registry && registry.delete(key));
      highlightKeys = [];
      if (!registry || typeof Highlight !== 'function' || !sheet) return 0;
      const groups = new Map();
      let painted = 0;
      for (const row of Array.isArray(args.rows) ? args.rows : []) {
        const range = rangeFor(row.anchor);
        if (!range) continue;
        const color = CSS.supports('color', row.color) ? row.color : '#e4bd60';
        const key = (row.legacy ? 'legacy|' : 'alpha|') + color;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(range);
        painted++;
      }
      const rules = [];
      let serial = 0;
      for (const [group, list] of groups) {
        const name = 'meldex-epub-hl-' + (++serial);
        registry.set(name, new Highlight(...list));
        highlightKeys.push(name);
        const color = group.slice(group.indexOf('|') + 1);
        const background = group.startsWith('alpha|') ? color : 'color-mix(in srgb, ' + color + ' 42%, transparent)';
        rules.push('::highlight(' + name + '){background-color:' + background + ';color:inherit;}');
      }
      sheet.textContent = rules.join('\n');
      return painted;
    }

    // ---- 文字の選択（位置: 章の本文の文字位置・引用・前後の文字）----
    function selectionState() {
      const selection = getSelection();
      if (!selection || !selection.rangeCount || selection.isCollapsed) return { has: false };
      const range = selection.getRangeAt(0);
      const all = textParts();
      const offset = (container, value) => {
        const direct = all.nodes.find(part => part.node === container);
        if (direct) return direct.start + value;
        const prefix = doc.createRange();
        prefix.selectNodeContents(doc.body);
        try { prefix.setEnd(container, value); } catch (_) { return 0; }
        let length = 0;
        for (const part of all.nodes) if (prefix.comparePoint(part.node, part.node.nodeValue.length) <= 0) length += part.node.nodeValue.length;
        return length;
      };
      const from = offset(range.startContainer, range.startOffset);
      const to = offset(range.endContainer, range.endOffset);
      const text = all.text.slice(from, to);
      if (to <= from || !text.trim()) return { has: false, raw: String(selection).slice(0, 10000) };
      return { has: true, text: text.slice(0, 20000), rects: rectsOf(range),
        anchor: { start: from, end: to, quote: text.slice(0, 20000), prefix: all.text.slice(Math.max(0, from - 48), from),
          suffix: all.text.slice(to, to + 48) } };
    }
    function restoreSelection(args) {
      const range = rangeFor(args.anchor);
      if (!range) return false;
      const selection = getSelection();
      selection.removeAllRanges(); selection.addRange(range);
      return true;
    }
    function clearSelection() { try { getSelection().removeAllRanges(); } catch (_) { /* 無い */ } return true; }

    const handlers = { layout, scroll: args => scrollToPage(args.page), offsetAtPage, pageForOffset, pageForAnchor, pageForFragment,
      rects, paint, restoreSelection, clearSelection, selection: selectionState };
    addEventListener('message', event => {
      const data = event.data;
      if (event.source !== parent || !data || data.meldexEpub !== TOKEN || typeof data.cmd !== 'string' || !handlers[data.cmd]) return;
      let result;
      try { result = handlers[data.cmd](data.args || {}); }
      catch (error) { send({ reply: data.id, error: String(error && error.message || error) }); return; }
      send({ reply: data.id, result });
    });

    // ---- 入力を親のビューワーの操作へ渡す（親は送り主と合言葉を確かめる）----
    const NAV_KEYS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' ', 'PageUp', 'PageDown', 'Home', 'End'];
    addEventListener('keydown', event => {
      if ((event.ctrlKey || event.metaKey) && ['c', 'a', 'x'].includes(String(event.key).toLowerCase())) return;
      if (NAV_KEYS.includes(event.key) || ['=', '+', '-'].includes(event.key)) event.preventDefault(); // 本文の中をスクロールさせない
      send({ type: 'key', key: event.key, code: event.code, shiftKey: event.shiftKey, ctrlKey: event.ctrlKey, altKey: event.altKey,
        metaKey: event.metaKey, repeat: event.repeat });
    }, true);
    addEventListener('wheel', event => {
      event.preventDefault();
      send({ type: 'wheel', deltaX: event.deltaX, deltaY: event.deltaY, deltaMode: event.deltaMode, x: event.clientX, y: event.clientY, ctrlKey: event.ctrlKey });
    }, { passive: false });
    addEventListener('contextmenu', event => {
      event.preventDefault();
      send({ type: 'selection', state: selectionState() });
      send({ type: 'contextmenu', x: event.clientX, y: event.clientY });
    });
    let touch = null;
    addEventListener('pointerdown', event => {
      send({ type: 'pointerdown' });
      touch = event.pointerType === 'touch' ? { x: event.clientX, y: event.clientY, time: performance.now(), id: event.pointerId } : null;
    }, true);
    addEventListener('pointerup', event => {
      const start = touch; touch = null;
      if (!start || start.id !== event.pointerId) return;
      const dx = event.clientX - start.x, dy = event.clientY - start.y;
      if (performance.now() - start.time > 500 || Math.abs(dx) < 64 || Math.abs(dx) < Math.abs(dy) * 1.2) return;
      if (!getSelection().isCollapsed) return;
      send({ type: 'swipe', dx });
    });
    let moveFrame = 0, lastMove = null;
    addEventListener('mousemove', event => {
      lastMove = { x: event.clientX, y: event.clientY };
      if (moveFrame) return;
      moveFrame = requestAnimationFrame(() => { moveFrame = 0; send({ type: 'move', x: lastMove.x, y: lastMove.y }); });
    });
    addEventListener('click', event => {
      const link = event.target && event.target.closest && event.target.closest('[data-epub-href],[data-external-href]');
      if (!link) return;
      event.preventDefault();
      if (link.dataset.epubHref) send({ type: 'link', href: link.dataset.epubHref });
      else send({ type: 'external', href: link.dataset.externalHref });
    });
    let selectionTimer = 0;
    doc.addEventListener('selectionchange', () => {
      clearTimeout(selectionTimer);
      selectionTimer = setTimeout(() => send({ type: 'selection', state: selectionState() }), 40);
    });
    // フォーカス移動などで本文の中がスクロールしたら、表示中のページへ戻す
    addEventListener('scroll', () => {
      const current = vertical ? scrollY : scrollX;
      if (expected != null && Math.abs(current - expected) > 1) { if (vertical) scrollTo(0, expected); else scrollTo(expected, 0); }
    }, { passive: true });
    // 検査用（読むだけ）
    window.__meldexEpubFrameState = () => ({ vertical, writingMode, count, page, fixed: geometry.fixed, opacityModel: OPACITY_MODEL });

    const ready = () => Promise.race([doc.fonts ? doc.fonts.ready : Promise.resolve(), new Promise(resolve => setTimeout(resolve, 1200))])
      .then(() => send({ type: 'ready' }));
    if (doc.readyState === 'complete') ready(); else addEventListener('load', ready, { once: true });
  }

  global.MeldexViewerEpubFrame = meldexEpubFrame;
})(typeof window !== 'undefined' ? window : globalThis);
