/* gb-scriptnote-print-layout.js: シナリオの論理ページ表示と印刷DOM。 */
(function initScriptNotePrintLayout(global) {
  'use strict';

  const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
  let printRoot = null;
  let printStyle = null;

  function settingsFor(doc) {
    const own = doc?.pageSettings;
    if (own?.paper && own?.grid) return clone(own);
    return global.MeldexScriptNoteTemplateDefinitions?.get?.(doc?.layoutMode || 'manga')
      || global.MeldexScriptNoteTemplateDefinitions?.get?.('manga');
  }

  function rowText(row) {
    return String(row?.text ?? row?.body ?? row?.content ?? row?.value ?? '');
  }

  function rowKind(row) {
    const raw = String(row?.kind || row?.type || row?.role || '').toLowerCase();
    if (row?.isBreak || /pagebreak|改ページ|めくり|白紙/.test(raw)) return 'pageBreak';
    if (/heading|pillar|scene|幕|場|柱/.test(raw)) return 'heading';
    if (/action|ト書き|画面/.test(raw)) return 'action';
    if (/music|sound|se|音響|照明/.test(raw)) return 'cue';
    return 'dialogue';
  }

  function logicalPages(doc) {
    const settings = settingsFor(doc);
    if (!settings) throw new Error('紙面設定がありません');
    const capacity = Math.max(1, Math.floor(Number(settings.grid?.linesPerPage) || 36));
    const pages = [];
    let page = [];
    const flush = () => {
      if (page.length || !pages.length) pages.push(page);
      page = [];
    };
    (Array.isArray(doc?.rows) ? doc.rows : []).forEach((row, rowIndex) => {
      const kind = rowKind(row);
      if (kind === 'pageBreak') {
        flush();
        return;
      }
      if (kind === 'heading' && page.length === capacity - 1) flush();
      if (page.length >= capacity) flush();
      page.push({ row: clone(row), rowIndex, kind, text: rowText(row) });
    });
    if (page.length || !pages.length) flush();
    return { settings, pages };
  }

  function parseRange(value, pageCount, currentPage = 1) {
    const raw = String(value || 'all').trim().toLowerCase();
    if (!raw || raw === 'all') return Array.from({ length: pageCount }, (_, index) => index + 1);
    if (raw === 'current') return [Math.max(1, Math.min(pageCount, currentPage))];
    const result = new Set();
    raw.split(',').forEach(part => {
      const match = part.trim().match(/^(\d+)(?:\s*-\s*(\d+))?$/);
      if (!match) throw new Error('ページ範囲は「1-3,5」の形式で入力してください');
      let start = Number(match[1]);
      let end = Number(match[2] || match[1]);
      if (start > end) [start, end] = [end, start];
      if (start < 1 || end > pageCount) throw new Error(`ページ範囲は1〜${pageCount}で指定してください`);
      for (let page = start; page <= end; page += 1) result.add(page);
    });
    return [...result].sort((a, b) => a - b);
  }

  function renderPage(settings, entries, pageNumber) {
    const page = document.createElement('section');
    page.className = 'sn-print-page';
    page.dataset.pageNumber = String(pageNumber);
    page.dataset.templateId = settings.id || '';
    page.dataset.templateVersion = String(settings.templateVersion || '');
    page.style.setProperty('--sn-page-width', `${settings.paper.widthMm}mm`);
    page.style.setProperty('--sn-page-height', `${settings.paper.heightMm}mm`);
    page.style.setProperty('--sn-margin-top', `${settings.margin?.topMm || 20}mm`);
    page.style.setProperty('--sn-margin-bottom', `${settings.margin?.bottomMm || 20}mm`);
    page.style.setProperty('--sn-margin-inner', `${settings.margin?.innerMm || settings.margin?.rightMm || 20}mm`);
    page.style.setProperty('--sn-margin-outer', `${settings.margin?.outerMm || settings.margin?.leftMm || 20}mm`);
    page.style.setProperty('--sn-font-size', `${settings.grid?.fontSizePt || 10.5}pt`);
    page.style.setProperty('--sn-line-height', `${settings.grid?.lineSpacingPt || 16}pt`);
    page.style.setProperty('--sn-body-font', [settings.fonts?.body, ...(settings.fonts?.fallback || [])].filter(Boolean).join(','));
    page.style.writingMode = settings.writingMode || 'horizontal-tb';
    if (Array.isArray(settings.bands) && settings.bands.length) {
      const bands = document.createElement('div');
      bands.className = 'sn-print-band-head';
      settings.bands.forEach(band => {
        const cell = document.createElement('span');
        cell.textContent = band.label;
        cell.style.flex = String(Number(band.ratio) || 1);
        bands.appendChild(cell);
      });
      page.appendChild(bands);
    }
    const content = document.createElement('div');
    content.className = 'sn-print-page-content';
    entries.forEach(entry => {
      const row = document.createElement('div');
      row.className = `sn-print-row sn-print-row--${entry.kind}`;
      row.dataset.sourceRow = String(entry.rowIndex);
      row.textContent = entry.text || '\u3000';
      content.appendChild(row);
    });
    page.appendChild(content);
    const number = document.createElement('span');
    number.className = 'sn-print-page-number';
    number.textContent = String(pageNumber + Number(settings.pageNumber?.start || 1) - 1);
    page.appendChild(number);
    return page;
  }

  function render(doc, options = {}) {
    const { settings, pages } = logicalPages(doc);
    const selected = parseRange(options.range || 'all', pages.length, options.currentPage || 1);
    const root = document.createElement('div');
    root.className = 'sn-print-document';
    root.dataset.templateId = settings.id || doc?.templateId || '';
    root.dataset.templateVersion = String(settings.templateVersion || doc?.templateVersion || '');
    selected.forEach(pageNumber => root.appendChild(renderPage(settings, pages[pageNumber - 1], pageNumber)));
    return { root, settings, pageCount: pages.length, selected };
  }

  function currentPageForEditor(editor, pages) {
    const activeId = editor?._activeRowId || editor?._activeCell?.rowId || '';
    if (!activeId) return 1;
    const rowIndex = (editor.doc?.rows || []).findIndex(row => row?.id === activeId);
    const page = pages.findIndex(entries => entries.some(entry => entry.rowIndex === rowIndex));
    return page >= 0 ? page + 1 : 1;
  }

  function ensureCss() {
    if (document.getElementById('meldex-scriptnote-print-css')) return;
    const style = document.createElement('style');
    style.id = 'meldex-scriptnote-print-css';
    style.textContent = `
.sn-print-preview{display:flex;flex-wrap:wrap;gap:24px;justify-content:center;align-items:flex-start;max-height:70vh;overflow:auto;padding:20px;background:#d7dbe2}
.sn-print-page{box-sizing:border-box;position:relative;width:var(--sn-page-width);height:var(--sn-page-height);padding:var(--sn-margin-top) var(--sn-margin-outer) var(--sn-margin-bottom) var(--sn-margin-inner);background:#fff;color:#111;box-shadow:0 2px 12px #0003;font-family:var(--sn-body-font);font-size:var(--sn-font-size);line-height:var(--sn-line-height);overflow:hidden;text-orientation:mixed}
.sn-print-page:nth-child(even){padding-left:var(--sn-margin-inner);padding-right:var(--sn-margin-outer)}
.sn-print-page-content{block-size:100%;inline-size:100%;overflow:hidden}
.sn-print-row{break-inside:avoid;white-space:pre-wrap}.sn-print-row--heading{font-weight:700;font-family:sans-serif}.sn-print-row--action{font-weight:400}.sn-print-row--cue{font-weight:600}.sn-print-row--dialogue{font-weight:400}
.sn-print-band-head{position:absolute;inset-block-start:4mm;inset-inline:8mm;display:flex;writing-mode:horizontal-tb;border-block-end:.4pt solid #777;font:8pt sans-serif}.sn-print-band-head span{text-align:center;border-inline-end:.4pt solid #777}
.sn-print-page-number{position:absolute;inset-block-end:5mm;inset-inline-end:50%;writing-mode:horizontal-tb;font:8pt sans-serif}
.sn-print-controls{display:flex;gap:12px;align-items:end;flex-wrap:wrap;margin-bottom:12px}.sn-print-controls label{display:grid;gap:4px}
#meldex-scriptnote-print-root{display:none}
@media print{body.meldex-scriptnote-printing>*:not(#meldex-scriptnote-print-root){display:none!important}#meldex-scriptnote-print-root{display:block!important}.sn-print-page{box-shadow:none;margin:0;break-after:page}.sn-print-page:last-child{break-after:auto}}
`;
    document.head.appendChild(style);
  }

  function cleanupPrint() {
    document.body.classList.remove('meldex-scriptnote-printing');
    printRoot?.remove();
    printStyle?.remove();
    printRoot = null;
    printStyle = null;
  }

  function print(editor, options = {}) {
    if (!editor?.doc) throw new Error('シナリオを開いてから印刷してください');
    ensureCss();
    cleanupPrint();
    const data = logicalPages(editor.doc);
    const currentPage = currentPageForEditor(editor, data.pages);
    const rendered = render(editor.doc, { ...options, currentPage });
    printRoot = rendered.root;
    printRoot.id = 'meldex-scriptnote-print-root';
    printStyle = document.createElement('style');
    printStyle.textContent = `@page{size:${rendered.settings.paper.widthMm}mm ${rendered.settings.paper.heightMm}mm;margin:0}`;
    document.head.appendChild(printStyle);
    document.body.appendChild(printRoot);
    document.body.classList.add('meldex-scriptnote-printing');
    global.addEventListener('afterprint', cleanupPrint, { once: true });
    global.print();
    global.setTimeout(cleanupPrint, 30000);
    return rendered;
  }

  function open(editor) {
    if (!editor?.doc) throw new Error('シナリオを開いてから印刷してください');
    ensureCss();
    const data = logicalPages(editor.doc);
    const currentPage = currentPageForEditor(editor, data.pages);
    if (!global.GBUI?.createModal) return print(editor, { range: 'all' });
    const body = document.createElement('div');
    const controls = document.createElement('div'); controls.className = 'sn-print-controls';
    const mode = document.createElement('select'); mode.className = 'gb-select'; mode.setAttribute('aria-label', '印刷するページ');
    mode.innerHTML = '<option value="all">全ページ</option><option value="current">現在のページ</option><option value="range">ページ範囲</option>';
    const range = document.createElement('input'); range.className = 'gb-input'; range.placeholder = `1-${data.pages.length}`; range.disabled = true; range.setAttribute('aria-label', 'ページ範囲');
    controls.append(mode, range);
    const preview = document.createElement('div'); preview.className = 'sn-print-preview';
    body.append(controls, preview);
    const refresh = () => {
      range.disabled = mode.value !== 'range';
      const value = mode.value === 'range' ? (range.value || `1-${data.pages.length}`) : mode.value;
      try { preview.replaceChildren(render(editor.doc, { range: value, currentPage }).root); range.setCustomValidity(''); }
      catch (error) { range.setCustomValidity(error.message); }
    };
    mode.addEventListener('change', refresh); range.addEventListener('input', refresh);
    const cancel = document.createElement('button'); cancel.className = 'gb-btn'; cancel.textContent = 'キャンセル';
    const action = document.createElement('button'); action.className = 'gb-btn gb-btn-primary'; action.textContent = '印刷…';
    const modal = global.GBUI.createModal({ id: 'scriptnote-print-layout', title: '印刷レイアウト', body, footer: [cancel, action], variant: 'standard', extraClass: 'gb-scriptnote-print-modal' });
    cancel.addEventListener('click', () => modal.close('cancel'));
    action.addEventListener('click', () => {
      const value = mode.value === 'range' ? range.value : mode.value;
      parseRange(value, data.pages.length, currentPage);
      modal.close('print');
      print(editor, { range: value });
    });
    modal.open(); refresh();
    return modal;
  }

  global.addEventListener('keydown', event => {
    if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'p') return;
    const host = [...document.querySelectorAll('#scenario-note-surface')].find(node => node.offsetParent !== null && node.__meldexScriptNoteEditor?.doc);
    if (!host) return;
    event.preventDefault();
    open(host.__meldexScriptNoteEditor);
  });

  ensureCss();
  global.MeldexScriptNotePrint = Object.freeze({ settingsFor, logicalPages, parseRange, render, open, print });
}(typeof globalThis !== 'undefined' ? globalThis : window));
