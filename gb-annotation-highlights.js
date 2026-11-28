/* Text highlights live in the annotation store. CSS Highlight paints without editing the document DOM. */
(function (global) {
  'use strict';
  const states = new Map();
  let serial = 0;
  let longPress = null;
  const parse = value => { try { const parsed = typeof value === 'string' ? JSON.parse(value) : value; return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}; } catch { return {}; } };
  function historyScope() {
    if (global.GBAnnotationSurfaces?.usesHistory?.()) return global.GBAnnotationSurfaces.historyScope();
    return global.GBEditorHost?.get()?.historyScope?.() ?? (typeof _historyActiveScope !== 'undefined' ? _historyActiveScope : '');
  }
  function colors() {
    const swatches = global.getStandardPaletteSwatches?.()?.filter(swatch => swatch.row === 3);
    if (swatches?.length) return swatches.map(swatch => swatch.color);
    const slots = global.getThemeColorSlotSettings?.() || [];
    const values = slots.filter(Boolean).map(slot => slot.color).filter(Boolean);
    return values.length ? values : (global.PALETTE_COLORS || ['#e4bd60', '#90bc83', '#7eacd1', '#c48080']).slice(0, 8);
  }
  // ハイライトの色は共通カラーパレットで選ぶ（不透明度つき）。最後に使った色を次のハイライトに使う。
  // 色に不透明度を含め、以前の「42%に薄める」は印（opacityModel）のない以前のハイライトだけに使う（2026-11-27）。
  const OPACITY_MODEL = 'color-alpha-v1';
  const COLOR_KEY = 'meldex-annotation-highlight-color';
  function currentColor() {
    try { const saved = localStorage.getItem(COLOR_KEY); if (saved && CSS.supports('color', saved)) return saved; } catch {}
    const base = colors()[0] || '#e4bd60';
    return typeof global._annotationColorWithAlpha === 'function' ? global._annotationColorWithAlpha(base, 0.4) : base;
  }
  function rememberColor(color) {
    if (!color || color === 'transparent') return;
    try { localStorage.setItem(COLOR_KEY, color); } catch {}
  }
  // 共通カラーパレットで色を選び、閉じた時に1回だけ呼び出し元へ返す（選ばずに閉じたら返さない）。
  function pickColor(x, y, onPicked) {
    if (typeof global.openColorPalette !== 'function') return false;
    const anchor = { getBoundingClientRect: () => ({ left: x, right: x, top: y, bottom: y, width: 0, height: 0, x, y }) };
    let picked = '';
    global.openColorPalette(anchor, currentColor(), color => { if (color && color !== 'transparent') picked = color; },
      { allowTransparent: false, onClose: () => { if (picked) { rememberColor(picked); onPicked(picked); } } });
    return true;
  }
  function textNodes(block) {
    const nodes = [], walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT, {
      acceptNode: n => n.parentElement?.closest('._nl-id,.cmt-badge,.cmt-line-badge,button,[aria-hidden=true]') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
    });
    let text = '';
    while (walker.nextNode()) { const node = walker.currentNode; nodes.push({ node, start: text.length }); text += node.textContent; }
    return { nodes, text };
  }
  function blockFor(scan, host) {
    const cell = scan.closest('td[data-prop-name]');
    if (cell) return { block: cell, anchor: { kind: 'cell', entry: cell.closest('tr')?.dataset.entityName, column: cell.dataset.propName } };
    const row = scan.closest('.sn2-row[data-row-id]');
    if (row) return { block: row.querySelector('.sn2-text') || row, anchor: { kind: 'scenario', row: row.dataset.rowId } };
    const editor = scan.closest('[data-editor-local-id=page-content],#page-content');
    if (!editor || !host.contains(editor)) return null;
    let block = scan;
    while (block.parentElement && block.parentElement !== editor) block = block.parentElement;
    if (block === editor || block.parentElement !== editor) return null;
    const line = block.querySelector('._nl-id[data-line-id]');
    return { block, anchor: { kind: 'note', line: line?.dataset.lineId || '', index: [...editor.children].indexOf(block) } };
  }
  function capture() {
    global.GBAnnotationSurfaces?.sync?.();
    const selection = getSelection();
    if (!selection?.rangeCount || selection.isCollapsed) return null;
    const range = selection.getRangeAt(0).cloneRange();
    const scan = range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement;
    const surface = global.GBAnnotationSurfaces?.forElement?.(scan);
    if (!surface || surface.iframe || surface.readOnly) return null;
    let info = blockFor(scan, surface.host);
    if (info?.anchor.kind === 'note' && !info.block.contains(range.endContainer)) {
      info = { block: scan.closest('[data-editor-local-id=page-content],#page-content'), anchor: { kind: 'note', root: true } };
    }
    if (!info || !info.block.contains(range.endContainer)) return null;
    const parts = textNodes(info.block);
    function offset(container, offset) {
      const direct = parts.nodes.find(part => part.node === container);
      if (direct) return direct.start + offset;
      const prefix = document.createRange(); prefix.selectNodeContents(info.block); prefix.setEnd(container, offset);
      let length = 0;
      for (const part of parts.nodes) if (prefix.comparePoint(part.node, part.node.length) <= 0) length += part.node.length;
      return length;
    }
    const from = offset(range.startContainer, range.startOffset), to = offset(range.endContainer, range.endOffset);
    const text = parts.text.slice(from, to);
    if (!text.trim()) return null;
    return { surface, range, text, anchor: { ...info.anchor, start: from, end: to,
      quote: text, prefix: parts.text.slice(Math.max(0, from - 48), from), suffix: parts.text.slice(to, to + 48) } };
  }
  function locate(host, anchor) {
    if (!anchor) return null;
    const escape = CSS.escape;
    if (anchor.kind === 'scenario') return host.querySelector(`.sn2-row[data-row-id="${escape(anchor.row)}"] .sn2-text`);
    if (anchor.kind === 'cell') return host.querySelector(`tr[data-entity-name="${escape(anchor.entry)}"] td[data-prop-name="${escape(anchor.column)}"]`);
    const editor = host.querySelector('[data-editor-local-id=page-content],#page-content');
    if (anchor.root) return editor;
    return (anchor.line && editor?.querySelector(`._nl-id[data-line-id="${escape(anchor.line)}"]`)?.parentElement) || editor?.children[anchor.index] || null;
  }
  function rangeFor(block, anchor, cache = new Map()) {
    if (!block || typeof anchor?.quote !== 'string' || !anchor.quote.length) return null;
    let parts = cache.get(block);
    if (!parts) { parts = textNodes(block); cache.set(block, parts); }
    let start = anchor.start, end = anchor.end;
    if (parts.text.slice(start, end) !== anchor.quote) {
      const hits = [];
      for (let pos = parts.text.indexOf(anchor.quote); pos >= 0; pos = parts.text.indexOf(anchor.quote, pos + Math.max(1, anchor.quote.length))) {
        if ((!anchor.prefix || parts.text.slice(Math.max(0, pos - anchor.prefix.length), pos) === anchor.prefix)
          && (!anchor.suffix || parts.text.slice(pos + anchor.quote.length, pos + anchor.quote.length + anchor.suffix.length) === anchor.suffix)) hits.push(pos);
      }
      if (hits.length !== 1) return null; // Never attach an ambiguous quote to a different passage.
      start = hits[0]; end = start + anchor.quote.length;
    }
    const first = parts.nodes.find(p => start >= p.start && start < p.start + p.node.length);
    const last = parts.nodes.find(p => end > p.start && end <= p.start + p.node.length);
    if (!first || !last) return null;
    const range = document.createRange(); range.setStart(first.node, start - first.start); range.setEnd(last.node, end - last.start);
    return range;
  }
  function dispose(surface) {
    const previous = states.get(surface.id);
    if (!previous) return;
    previous.keys.forEach(key => CSS.highlights?.delete(key));
    previous.style.remove(); previous.observer?.disconnect(); clearTimeout(previous.timer); states.delete(surface.id);
  }
  function render(surface, items) {
    if (!global.CSS?.highlights || surface.iframe) return;
    if (!surface.host.isConnected || global.GBAnnotationSurfaces?.forElement?.(surface.host) !== surface) return;
    let state = states.get(surface.id);
    if (!state) {
      const style = document.createElement('style'); document.head.append(style);
      state = { style, keys: [], ranges: new Map(), items: [], pending: new Map(), observer: null, timer: null };
      states.set(surface.id, state);
      const editor = surface.host;
      if (editor) {
        state.observer = new MutationObserver(() => { clearTimeout(state.timer); state.timer = setTimeout(() => render(surface, state.items), 100); });
        state.observer.observe(editor, { childList: true, characterData: true, subtree: true });
      }
    }
    state.items = items; state.keys.forEach(key => CSS.highlights.delete(key)); state.keys = []; state.ranges.clear();
    const groups = new Map(), cache = new Map();
    for (const item of [...(items || []), ...state.pending.values()]) {
      const data = parse(item.data);
      if (item.type !== 'highlight' || data.deleted || !data.textAnchor) continue;
      const container = parse(item.target_ref).container;
      const anchor = { ...data.textAnchor };
      if (container?.kind === 'sheet_cell') { anchor.entry = container.entryId; anchor.column = container.colId; }
      if (container?.kind === 'scriptnote_line') anchor.row = container.id;
      const range = rangeFor(locate(surface.host, anchor), anchor, cache)
        || (anchor.kind === 'note' && rangeFor(surface.host.querySelector('[data-editor-local-id=page-content],#page-content'), anchor, cache));
      if (!range) continue;
      const color = CSS.supports('color', item.color) ? item.color : colors()[0];
      const group = (data.opacityModel === OPACITY_MODEL ? 'alpha|' : 'legacy|') + color;
      if (!groups.has(group)) groups.set(group, []);
      groups.get(group).push(range); state.ranges.set(item.id, range);
    }
    const rules = [];
    for (const [group, ranges] of groups) {
      const key = 'meldex-highlight-' + (++serial);
      const [model, color] = [group.slice(0, group.indexOf('|')), group.slice(group.indexOf('|') + 1)];
      CSS.highlights.set(key, new Highlight(...ranges)); state.keys.push(key);
      // 新しいハイライトは色（不透明度を含む）のとおり、以前のハイライトは従来どおり42%に薄める
      const background = model === 'alpha' ? color : `color-mix(in srgb, ${color} 42%, transparent)`;
      rules.push(`::highlight(${key}) { background-color: ${background}; color: inherit; }`);
    }
    state.style.textContent = rules.join('\n');
  }
  async function create(context, color) {
    const { surface, range, text, anchor } = context;
    rememberColor(color);
    const pending = { id: 'pending-' + (++serial), type: 'highlight', color, data: { text, textAnchor: anchor, opacityModel: OPACITY_MODEL, clientRequestId: crypto.randomUUID() } };
    const scope = historyScope();
    const reservation = historyReserve('アノテート: ハイライト追加', scope, surface.path);
    if (!states.has(surface.id)) render(surface, []);
    const state = states.get(surface.id);
    state.pending.set(pending.id, pending); render(surface, state.items);
    try {
      const container = anchor.kind === 'cell' ? { kind: 'sheet_cell', entryId: anchor.entry, colId: anchor.column }
        : anchor.kind === 'scenario' ? { kind: 'scriptnote_line', id: anchor.row }
          : anchor.line ? { kind: 'note_line', id: anchor.line } : undefined;
      const row = { type: 'highlight', target_path: surface.path, target_kind: 'text_range', body: text,
        user: typeof getUsername === 'function' ? getUsername() : 'anonymous',
        color, opacity: 1, data: pending.data, target_ref: { file: surface.path, container,
          anchorSchema: 'meldex-text-anchor-v1', startOffset: anchor.start, endOffset: anchor.end, snippet: text,
          prefix: anchor.prefix, suffix: anchor.suffix } };
      const result = await apiPost('/annotations', row);
      state.pending.delete(pending.id);
      render(surface, [...state.items, { ...row, id: result.id }]);
      reservation.capture(() => _pushAnnotationHistory('アノテート: ハイライト追加', null,
        { ...row, id: result.id, created: result.created, modified: result.modified || result.created }, surface.path, scope));
      await global.GBAnnotationSurfaces.reloadTarget(surface.path);
      if (typeof loadRpAnnotationList === 'function') void loadRpAnnotationList();
      return result;
    } catch (error) {
      state.pending.delete(pending.id); render(surface, state.items);
      reservation.cancel();
      showStatus('ハイライトを保存できませんでした: ' + error.message, true); return null;
    }
  }
  async function mutate(item, color) {
    const scope = historyScope();
    const label = color == null ? 'アノテート: ハイライト削除' : 'アノテート: ハイライトの色';
    const reservation = historyReserve(label, scope, item.target_path);
    try {
      const before = await _fetchAnnotationHistoryRow(item.id);
      if (!before) throw new Error('対象が見つかりません');
      let after = null;
      if (color == null) await apiDelete('/annotations/' + encodeURIComponent(item.id) + '?expected_modified=' + encodeURIComponent(before.modified || ''));
      else {
        const result = await apiPut('/annotations/' + encodeURIComponent(item.id), { color, expected_modified: before.modified });
        after = { ...before, color, modified: result.modified, modified_at: result.modified };
      }
      reservation.capture(() => _pushAnnotationHistory(label, before, after, item.target_path, scope));
      _refreshAnnotationHistoryTarget(item);
      return true;
    } catch (error) { reservation.cancel(); showStatus('ハイライトを保存できませんでした: ' + error.message, true); return false; }
  }
  function indicate(range) {
    const block = range.commonAncestorContainer.nodeType === 1 ? range.commonAncestorContainer : range.commonAncestorContainer.parentElement;
    const first = [...range.getClientRects()].find(rect => rect.width && rect.height);
    let sc = range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement;
    while (sc && sc !== document.body) {
      const style = getComputedStyle(sc);
      if (/(auto|scroll)/.test(style.overflowX + style.overflowY) && (sc.scrollHeight > sc.clientHeight || sc.scrollWidth > sc.clientWidth)) break;
      sc = sc.parentElement;
    }
    if (first && sc && sc !== document.body) {
      const bounds = sc.getBoundingClientRect();
      sc.scrollBy({ top: first.top - bounds.top - (sc.clientHeight - first.height) / 2,
        left: first.left - bounds.left - (sc.clientWidth - first.width) / 2, behavior: 'instant' });
    } else block?.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
    const rect = range.getBoundingClientRect(), flash = document.createElement('div');
    flash.dataset.annotationFlash = '';
    flash.style.cssText = `position:fixed;pointer-events:none;z-index:10000;left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px;outline:2px solid var(--accent);outline-offset:2px`;
    document.body.append(flash); setTimeout(() => flash.remove(), 1200);
  }
  function prepareMenu(event) {
    const context = capture();
    if (!context || !context.surface.host.contains(event.target)) return null;
    if (event.meldexLongPress) longPress = { target: event.target, at: performance.now() };
    global.GBTextSelectionFormat?.suppressFor(1200);
    const before = new Set(document.querySelectorAll('.gb-context-menu,.sn2-context-menu'));
    // 既存のコピー・コメント・書式等の項目を残し、同じ共通メニューへ追加する。
    return () => {
      const menus = [...document.querySelectorAll('.gb-context-menu,.sn2-context-menu')].filter(menu => menu.isConnected);
      const menu = menus.find(menu => !before.has(menu)) || menus.find(menu => !menu.dataset.annotationHighlightMenu
        && (menu._meldexContextMenuCleanup || menu.classList.contains('sn2-context-menu')));
      if (menu?.dataset.annotationHighlightMenu) return;
      if (!menu && document.querySelector('[data-annotation-highlight-menu]')) return;
      const rect = menu?.getBoundingClientRect();
      const x = event.clientX, y = event.clientY;
      const opened = global.MeldexContextMenuUI.openAt({ menu, x, y,
        anchorRect: rect ? { left: rect.left, right: rect.right, top: rect.top, bottom: rect.top } : undefined,
        ariaLabel: '選択範囲', items: [
          { label: 'ハイライト', icon: 'highlighter', color: currentColor(), e2eId: 'annotation-highlight-create', action: () => void create(context, currentColor()) },
          { label: 'ハイライトの色...', icon: 'palette', e2eId: 'annotation-highlight-pick-color', action: () => pickColor(x, y, color => void create(context, color)) },
          ...(menu ? [{ type: 'separator' }] : [])] });
      opened.dataset.annotationHighlightMenu = '1';
    };
  }
  document.addEventListener('contextmenu', event => {
    if (longPress?.target === event.target && performance.now() - longPress.at < 800) {
      event.preventDefault(); return;
    }
    const decorate = prepareMenu(event);
    if (!decorate) return;
    event.preventDefault();
    setTimeout(decorate, 0);
  }, true);
  global.GBAnnotationHighlights = { colors, currentColor, rememberColor, pickColor, capture, create, mutate, render, dispose, parse, rangeFor, prepareMenu,
    reveal(surface, item) { const range = states.get(surface.id)?.ranges.get(item.id); if (!range?.startContainer.isConnected) return false; indicate(range); return true; },
  };
})(window);
