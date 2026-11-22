/* Selectable derived text. All boxes use the existing media-pixel-v1 space.
   No source document or system clipboard is written by this module. */
(function () {
  'use strict';
  const layers = new WeakMap();
  let boxesVisible = false;
  let searchGeneration = 0;

  function dispose(media) {
    const old = layers.get(media);
    old?.task?.cancel(); old?.observer?.disconnect();
    old?.container.remove(); old?.mapper.remove();
    layers.delete(media);
  }

  function disposeIn(root) {
    root?.querySelectorAll('canvas, img').forEach(dispose);
  }

  function orderedContent(content) {
    let items = content.items.filter(item => typeof item.str === 'string');
    // Native vertical fonts, rotated baselines, and upright single-glyph columns.
    const vertical = new Set(items.filter(item => content.styles[item.fontName]?.vertical
      || Math.abs(item.transform[1]) > Math.abs(item.transform[0]) * 2));
    const glyphs = items.filter(item => /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー。、！？]$/u.test(item.str));
    const columns = new Map();
    for (const item of glyphs) {
      const key = Math.round(item.transform[4] / Math.max(Math.abs(item.transform[3]) * .35, 1));
      if (!columns.has(key)) columns.set(key, []);
      columns.get(key).push(item);
    }
    for (const column of columns.values()) {
      column.sort((a, b) => b.transform[5] - a.transform[5]);
      for (let index = 1; index < column.length; index++) {
        const item = column[index], previous = column[index - 1];
        const dy = Math.abs(item.transform[5] - previous.transform[5]);
        if (dy > Math.abs(item.transform[3]) * .5 && dy < Math.abs(item.transform[3]) * 2) {
          vertical.add(item); vertical.add(previous);
        }
      }
    }
    if (vertical.size > items.length / 2) {
      // PDF.js may synthesize horizontal gap spaces between upright columns.
      items = items.filter(item => item.str.trim());
      items.sort((a, b) => {
        const dx = b.transform[4] - a.transform[4];
        const tolerance = Math.max(Math.hypot(a.transform[0], a.transform[1]), 1) * .45;
        return Math.abs(dx) > tolerance ? dx : b.transform[5] - a.transform[5];
      });
      items = items.map((item, index) => {
        const next = items[index + 1];
        const sameColumn = next && Math.abs(item.transform[4] - next.transform[4]) < Math.max(Math.abs(item.transform[3]) * .45, 1);
        return { ...item, hasEOL: next ? !sameColumn : false };
      });
    }
    return { ...content, items };
  }

  function wrapMedia(media) {
    let wrap = media.parentElement;
    if (!wrap?.classList.contains('viewer-ann-scene-wrap')) {
      wrap = document.createElement('div');
      wrap.className = 'viewer-ann-scene-wrap';
      media.replaceWith(wrap);
      wrap.append(media);
    }
    wrap.classList.add('viewer-text-wrap');
    return wrap;
  }

  function mount(media, { width, height, page = 1, path = '', engine = 'pdf', version = '' }) {
    const wrap = wrapMedia(media);
    dispose(media);
    const container = document.createElement('div');
    container.className = 'viewer-text-layer textLayer';
    container.classList.toggle('show-text-boxes', boxesVisible);
    container.setAttribute('aria-label', '選択できるテキスト');
    const mapper = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    mapper.classList.add('viewer-text-mapper');
    mapper.setAttribute('viewBox', `0 0 ${width} ${height}`);
    mapper.setAttribute('preserveAspectRatio', 'none');
    wrap.append(container, mapper);
    const entry = { media, wrap, container, mapper, width, height, page, path, engine, version };
    layers.set(media, entry);
    return entry;
  }

  async function pdf(media, doc, pageNumber, zoom, path = '') {
    const lib = await window.MeldexViewerPdfRenderer.ensurePdfjs();
    const page = await doc.getPage(pageNumber);
    const natural = page.getViewport({ scale: 1 });
    const entry = mount(media, { width: natural.width, height: natural.height, page: pageNumber, path, version: lib.version });
    entry.container.style.setProperty('--scale-factor', zoom);
    const content = orderedContent(await page.getTextContent());
    if (layers.get(media) !== entry) return;
    const task = new lib.TextLayer({ textContentSource: content, container: entry.container,
      viewport: page.getViewport({ scale: zoom }) });
    entry.task = task;
    try { await task.render(); } catch (error) {
      if (error?.name !== 'AbortException') throw error;
    }
    updateIndicator();
    return entry;
  }

  function ocr(media, result, path) {
    // The existing annotation scene uses the displayed image's intrinsic size,
    // which may be a smaller preview. Keep cached source boxes unchanged.
    if (media.tagName === 'IMG' && media.naturalWidth && media.naturalHeight) {
      const sx = media.naturalWidth / result.width, sy = media.naturalHeight / result.height;
      result = { ...result, width: media.naturalWidth, height: media.naturalHeight,
        lines: result.lines.map(line => ({ ...line, box: [line.box[0] * sx, line.box[1] * sy, line.box[2] * sx, line.box[3] * sy] })) };
    }
    const entry = mount(media, { ...result, path });
    for (const line of result.lines) {
      const span = document.createElement('span');
      const glyphs = document.createElement('span'); glyphs.textContent = line.text;
      glyphs._ocrLine = line;
      span.append(glyphs);
      const [x, y, w, h] = line.box;
      Object.assign(span.style, { left: `${x / result.width * 100}%`, top: `${y / result.height * 100}%`,
        width: `${w / result.width * 100}%`, height: `${h / result.height * 100}%`,
        writingMode: line.vertical ? 'vertical-rl' : 'horizontal-tb' });
      span.dataset.ocr = 'true';
      Object.assign(glyphs.style, { left: '0', top: '0', writingMode: line.vertical ? 'vertical-rl' : 'horizontal-tb' });
      span._ocrBox = line.box; span._ocrVertical = !!line.vertical;
      entry.container.append(span);
    }
    const fit = () => {
      const scale = media.offsetWidth / result.width;
      for (const span of entry.container.children) {
        const [, , w, h] = span._ocrBox;
        const glyphs = span.firstElementChild;
        glyphs.style.transform = '';
        glyphs.style.fontSize = `${(span._ocrVertical ? w : h) * scale}px`;
        const factorX = span.clientWidth / glyphs.offsetWidth, factorY = span.clientHeight / glyphs.offsetHeight;
        if (Number.isFinite(factorX) && Number.isFinite(factorY) && factorX > 0 && factorY > 0) glyphs.style.transform = `scale(${factorX},${factorY})`;
      }
    };
    entry.observer = new ResizeObserver(fit); entry.observer.observe(media); fit();
    updateIndicator();
    return entry;
  }

  function visibleEntries() {
    const scene = window.MeldexViewerScene;
    const root = scene ? document.getElementById('layer' + scene.getActiveLayerId()) : document;
    return [...(root?.querySelectorAll('canvas, img') || [])].map(media => layers.get(media)).filter(Boolean);
  }

  // Highlight integration contract: one document page per selection; null for
  // mixed pages/documents. Coordinates are never screen pixels or percentages.
  function getSelection() {
    const selection = window.getSelection();
    if (!selection?.rangeCount || selection.isCollapsed) return null;
    const range = selection.getRangeAt(0);
    const entry = visibleEntries().find(item => item.container.contains(range.startContainer)
      && item.container.contains(range.endContainer));
    if (!entry) return null;
    const inverse = entry.mapper.getScreenCTM()?.inverse();
    if (!inverse) return null;
    const boxes = [];
    let text = '';
    for (const span of entry.container.querySelectorAll('span')) {
      if (span.firstChild?.nodeType !== Node.TEXT_NODE || !range.intersectsNode(span) || !span.textContent) continue;
      const part = document.createRange();
      part.selectNodeContents(span);
      if (span.contains(range.startContainer)) part.setStart(range.startContainer, range.startOffset);
      if (span.contains(range.endContainer)) part.setEnd(range.endContainer, range.endOffset);
      const value = part.toString();
      if (!value) continue;
      text += value;
      if (span.nextElementSibling?.tagName === 'BR' && range.intersectsNode(span.nextElementSibling)) text += '\n';
      if (span._ocrLine) {
        const line = span._ocrLine, [x, y, width, height] = line.box;
        const first = part.startContainer === span.firstChild ? part.startOffset : 0;
        const last = part.endContainer === span.firstChild ? part.endOffset : span.textContent.length;
        const count = Math.max(1, [...span.textContent].length);
        const before = [...span.textContent.slice(0, first)].length / count;
        const amount = [...span.textContent.slice(first, last)].length / count;
        boxes.push(line.vertical ? { x, y: y + height * before, width, height: height * amount }
          : { x: x + width * before, y, width: width * amount, height });
        continue;
      }
      for (const rect of part.getClientRects()) {
        const points = [[rect.left, rect.top], [rect.right, rect.top], [rect.right, rect.bottom], [rect.left, rect.bottom]]
          .map(([x, y]) => new DOMPoint(x, y).matrixTransform(inverse));
        const x = Math.min(...points.map(p => p.x)), y = Math.min(...points.map(p => p.y));
        boxes.push({ x, y, width: Math.max(...points.map(p => p.x)) - x, height: Math.max(...points.map(p => p.y)) - y });
      }
    }
    return text ? { schemaVersion: 1, text: text.trimEnd(), path: entry.path, page: entry.page,
      pageIndex: entry.page - 1, boxes, mediaWidth: entry.width, mediaHeight: entry.height,
      coordinateSpace: 'media-pixel-v1', engine: entry.engine, version: entry.version } : null;
  }

  async function search(doc, query, { signal, onMatch } = {}) {
    const generation = ++searchGeneration;
    const needle = String(query || '').normalize('NFKC').toLocaleLowerCase();
    if (!needle) return [];
    const found = [];
    for (let page = 1; page <= doc.numPages; page++) {
      if (signal?.aborted || generation !== searchGeneration) break;
      const content = orderedContent(await (await doc.getPage(page)).getTextContent());
      const text = content.items.map(item => item.str).join('');
      if (text.normalize('NFKC').toLocaleLowerCase().includes(needle)) {
        const match = { page, text };
        found.push(match); onMatch?.(match);
      }
      // Never render offscreen pages, and yield between every text extraction.
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    return found;
  }

  function toggleBoxes() {
    boxesVisible = !boxesVisible;
    document.getElementById('btn-text-layer')?.setAttribute('aria-pressed', String(boxesVisible));
    document.querySelectorAll('.viewer-text-layer').forEach(el => el.classList.toggle('show-text-boxes', boxesVisible));
  }
  function selectQuery(query) {
    const needle = String(query).normalize('NFKC').toLocaleLowerCase();
    for (const entry of visibleEntries()) {
      const nodes = [], offsets = [];
      const walker = document.createTreeWalker(entry.container, NodeFilter.SHOW_TEXT);
      let node, combined = '';
      while ((node = walker.nextNode())) {
        let position = 0;
        for (const character of node.textContent) {
          const value = character.normalize('NFKC').toLocaleLowerCase();
          for (let i = 0; i < value.length; i++) offsets.push({ node, start: position, end: position + character.length });
          combined += value; position += character.length;
        }
        nodes.push(node);
      }
      const start = combined.indexOf(needle);
      if (start < 0 || !needle) continue;
      const first = offsets[start], last = offsets[start + needle.length - 1];
      const range = document.createRange(); range.setStart(first.node, first.start); range.setEnd(last.node, last.end);
      const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
      return getSelection();
    }
    return null;
  }
  function updateIndicator() {
    const button = document.getElementById('btn-text-layer');
    if (button) {
      const exists = visibleEntries().some(entry => entry.container.textContent.trim());
      button.dataset.hasText = String(exists);
      button.title = exists ? 'テキストあり／認識範囲の表示切替' : 'テキストなし／認識範囲の表示切替';
    }
  }
  document.addEventListener('copy', event => {
    const selected = getSelection();
    if (!selected || !event.clipboardData) return;
    event.clipboardData.setData('text/plain', selected.text);
    event.preventDefault();
  });
  document.addEventListener('selectionchange', () => {
    const detail = getSelection();
    window.dispatchEvent(new CustomEvent('meldex-viewer-text-selection', { detail }));
    if (window.parent !== window) window.parent.postMessage({ type: 'meldex-viewer-text-selection', selection: detail }, location.origin);
  });
  document.getElementById('btn-text-layer')?.addEventListener('click', toggleBoxes);
  window.MeldexViewerTextLayer = { pdf, ocr, getSelection, selectQuery, search, orderedContent, toggleBoxes, updateIndicator, dispose, disposeIn };
})();
