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

  function visibleRowText(row) {
    const raw = rowText(row);
    const withoutRuby = raw.replace(/\{((?:\\.|[^{}|])*)\|(?:\\.|[^{}])*\}/g, '$1');
    if (typeof global._sn2UnescapeScriptNotePlainText === 'function') {
      return global._sn2UnescapeScriptNotePlainText(withoutRuby);
    }
    return withoutRuby.replace(/\\([\\{|}])/g, '$1');
  }

  function storedRowText(value) {
    const normalized = String(value || '').replace(/\u00a0/g, ' ').replace(/\r\n?/g, '\n');
    if (typeof global._sn2EscapeScriptNotePlainText === 'function') {
      return global._sn2EscapeScriptNotePlainText(normalized);
    }
    return normalized.replace(/([\\{|}])/g, '\\$1');
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
      page.push({ row: clone(row), rowIndex, kind, text: visibleRowText(row) });
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

  function renderPage(settings, entries, pageNumber, options = {}) {
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
    if (settings.header?.enabled && settings.header?.text) {
      const header = document.createElement('span');
      header.className = 'sn-print-page-header';
      header.textContent = String(settings.header.text);
      page.appendChild(header);
    }
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
      row.dataset.sourceRowId = String(entry.row?.id || '');
      row.textContent = entry.text || '\u3000';
      if (options.editable) {
        row.contentEditable = 'plaintext-only';
        row.setAttribute('role', 'textbox');
        row.setAttribute('aria-label', `${entry.rowIndex + 1}行目を紙面上で編集`);
        row.spellcheck = true;
      }
      content.appendChild(row);
    });
    page.appendChild(content);
    const number = document.createElement('span');
    number.className = 'sn-print-page-number';
    number.textContent = String(pageNumber + Number(settings.pageNumber?.start || 1) - 1);
    number.hidden = settings.pageNumber?.enabled === false;
    page.appendChild(number);
    if (settings.footer?.enabled && settings.footer?.text) {
      const footer = document.createElement('span');
      footer.className = 'sn-print-page-footer';
      footer.textContent = String(settings.footer.text);
      page.appendChild(footer);
    }
    return page;
  }

  function render(doc, options = {}) {
    const { settings, pages } = logicalPages(doc);
    const selected = parseRange(options.range || 'all', pages.length, options.currentPage || 1);
    const root = document.createElement('div');
    root.className = 'sn-print-document';
    root.dataset.templateId = settings.id || doc?.templateId || '';
    root.dataset.templateVersion = String(settings.templateVersion || doc?.templateVersion || '');
    selected.forEach(pageNumber => root.appendChild(renderPage(settings, pages[pageNumber - 1], pageNumber, options)));
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
.sn-print-row[contenteditable]{border-radius:2px;outline:none;cursor:text}.sn-print-row[contenteditable]:hover{background:#1677ff0d}.sn-print-row[contenteditable]:focus{background:#1677ff14;box-shadow:0 0 0 1px #1677ff88 inset}
.sn-print-band-head{position:absolute;inset-block-start:4mm;inset-inline:8mm;display:flex;writing-mode:horizontal-tb;border-block-end:.4pt solid #777;font:8pt sans-serif}.sn-print-band-head span{text-align:center;border-inline-end:.4pt solid #777}
.sn-print-page-number{position:absolute;inset-block-end:5mm;inset-inline-end:50%;writing-mode:horizontal-tb;font:8pt sans-serif}
.sn-print-page-header,.sn-print-page-footer{position:absolute;inset-inline:12mm;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;writing-mode:horizontal-tb;font:8pt sans-serif;text-align:center}.sn-print-page-header{inset-block-start:4mm}.sn-print-page-footer{inset-block-end:4mm}
.sn-print-controls{display:flex;gap:8px 12px;align-items:end;flex-wrap:wrap;margin-bottom:12px}.sn-print-controls label{display:grid;gap:4px;font-size:12px}.sn-print-controls .gb-input[type="number"]{width:72px}.sn-print-controls .sn-print-wide{min-width:180px}.sn-print-save-status{min-height:1.5em;margin:0 0 8px;color:var(--fg2)}
#meldex-scriptnote-print-root{display:none}
@media print{body.meldex-scriptnote-printing>*:not(#meldex-scriptnote-print-root){display:none!important}#meldex-scriptnote-print-root{display:block!important}.sn-print-page{box-shadow:none;margin:0;break-after:page}.sn-print-page:last-child{break-after:auto}.sn-print-row[contenteditable]{background:transparent!important;box-shadow:none!important}}
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
    let data = logicalPages(editor.doc);
    let currentPage = currentPageForEditor(editor, data.pages);
    if (!global.GBUI?.createModal) return print(editor, { range: 'all' });
    const body = document.createElement('div');
    const controls = document.createElement('div'); controls.className = 'sn-print-controls';
    const mode = document.createElement('select'); mode.className = 'gb-select'; mode.setAttribute('aria-label', '印刷するページ');
    mode.innerHTML = '<option value="all">全ページ</option><option value="current">現在のページ</option><option value="range">ページ範囲</option>';
    const range = document.createElement('input'); range.className = 'gb-input'; range.placeholder = `1-${data.pages.length}`; range.disabled = true; range.setAttribute('aria-label', 'ページ範囲');
    const setting = (label, control) => {
      const wrapper = document.createElement('label');
      const caption = document.createElement('span'); caption.textContent = label;
      wrapper.append(caption, control); controls.appendChild(wrapper);
      return control;
    };
    setting('表示ページ', mode); setting('ページ範囲', range);
    const paper = document.createElement('select'); paper.className = 'gb-select'; paper.setAttribute('aria-label', '用紙サイズ');
    paper.innerHTML = '<option value="A4">A4</option><option value="B5">B5</option><option value="custom">カスタム</option>';
    const orientation = document.createElement('select'); orientation.className = 'gb-select'; orientation.setAttribute('aria-label', '用紙の向き');
    orientation.innerHTML = '<option value="portrait">縦</option><option value="landscape">横</option>';
    const writing = document.createElement('select'); writing.className = 'gb-select'; writing.setAttribute('aria-label', '組方向');
    writing.innerHTML = '<option value="horizontal-tb">横書き</option><option value="vertical-rl">縦書き</option>';
    const numeric = (label, aria, min, max, step = '1') => {
      const input = document.createElement('input'); input.type = 'number'; input.className = 'gb-input'; input.min = String(min); input.max = String(max); input.step = step; input.setAttribute('aria-label', aria);
      setting(label, input); return input;
    };
    setting('用紙', paper); setting('向き', orientation); setting('組方向', writing);
    const paperWidth = numeric('用紙幅(mm)', '用紙幅', 50, 1000, '0.5');
    const paperHeight = numeric('用紙高(mm)', '用紙高', 50, 1000, '0.5');
    const chars = numeric('1行の字数', '1行の字数', 1, 200);
    const lines = numeric('1ページの行数', '1ページの行数', 1, 200);
    const marginTop = numeric('上余白(mm)', '上余白', 0, 100, '0.5');
    const marginBottom = numeric('下余白(mm)', '下余白', 0, 100, '0.5');
    const marginInner = numeric('内余白(mm)', '内余白', 0, 100, '0.5');
    const marginOuter = numeric('外余白(mm)', '外余白', 0, 100, '0.5');
    const pageStart = numeric('開始ページ', '開始ページ', 0, 9999);
    const headerText = document.createElement('input'); headerText.className = 'gb-input sn-print-wide'; headerText.setAttribute('aria-label', 'ヘッダー'); headerText.placeholder = '空欄なら表示しません'; setting('ヘッダー', headerText);
    const footerText = document.createElement('input'); footerText.className = 'gb-input sn-print-wide'; footerText.setAttribute('aria-label', 'フッター'); footerText.placeholder = '空欄なら表示しません'; setting('フッター', footerText);
    const preview = document.createElement('div'); preview.className = 'sn-print-preview';
    const saveStatus = document.createElement('p'); saveStatus.className = 'sn-print-save-status'; saveStatus.setAttribute('role', 'status');
    body.append(controls, saveStatus, preview);
    const syncSettingControls = () => {
      const settings = settingsFor(editor.doc);
      paper.value = ['A4', 'B5'].includes(settings.paper?.size) ? settings.paper.size : 'custom';
      orientation.value = settings.paper?.orientation || (settings.paper?.widthMm > settings.paper?.heightMm ? 'landscape' : 'portrait');
      writing.value = settings.writingMode || 'horizontal-tb';
      paperWidth.value = String(settings.paper?.widthMm || 210); paperHeight.value = String(settings.paper?.heightMm || 297);
      paperWidth.disabled = paper.value !== 'custom'; paperHeight.disabled = paper.value !== 'custom';
      chars.value = String(settings.grid?.charsPerLine || 40); lines.value = String(settings.grid?.linesPerPage || 36);
      marginTop.value = String(settings.margin?.topMm ?? 20); marginBottom.value = String(settings.margin?.bottomMm ?? 20);
      marginInner.value = String(settings.margin?.innerMm ?? settings.margin?.rightMm ?? 20); marginOuter.value = String(settings.margin?.outerMm ?? settings.margin?.leftMm ?? 20);
      pageStart.value = String(settings.pageNumber?.start ?? 1);
      headerText.value = String(settings.header?.text || ''); footerText.value = String(settings.footer?.text || '');
    };
    const updateSetting = (mutate, label = '紙面設定') => {
      if (editor._readOnly) return;
      editor._pushUndo?.(label);
      const settings = settingsFor(editor.doc);
      mutate(settings);
      editor.doc.pageSettings = settings;
      editor.doc.editor = { ...(editor.doc.editor || {}), viewMode: settings.writingMode === 'vertical-rl' ? 'vertical' : 'horizontal' };
      editor._markDirty?.({ skipUndo: true });
      syncSettingControls();
      refresh();
    };
    const bindSetting = (control, mutate, eventName = 'change') => control.addEventListener(eventName, () => updateSetting(mutate));
    bindSetting(paper, settings => {
      const sizes = { A4: [210, 297], B5: [182, 257] }; const size = sizes[paper.value];
      const current = settings.paper || {};
      if (!size) {
        settings.paper = { ...current, size: 'custom', orientation: orientation.value,
          widthMm: Number(current.widthMm) || 210, heightMm: Number(current.heightMm) || 297 };
        return;
      }
      const landscape = orientation.value === 'landscape';
      settings.paper = { ...current, size: paper.value, orientation: orientation.value, widthMm: landscape ? size[1] : size[0], heightMm: landscape ? size[0] : size[1] };
    });
    bindSetting(orientation, settings => {
      const next = orientation.value; const current = settings.paper || {}; const landscape = next === 'landscape';
      const long = Math.max(Number(current.widthMm) || 210, Number(current.heightMm) || 297); const short = Math.min(Number(current.widthMm) || 210, Number(current.heightMm) || 297);
      settings.paper = { ...current, orientation: next, widthMm: landscape ? long : short, heightMm: landscape ? short : long };
    });
    bindSetting(writing, settings => { settings.writingMode = writing.value; });
    bindSetting(paperWidth, settings => { settings.paper = { ...(settings.paper || {}), size: 'custom', widthMm: Math.max(50, Number(paperWidth.value) || 50) }; });
    bindSetting(paperHeight, settings => { settings.paper = { ...(settings.paper || {}), size: 'custom', heightMm: Math.max(50, Number(paperHeight.value) || 50) }; });
    bindSetting(chars, settings => { settings.grid = { ...(settings.grid || {}), charsPerLine: Math.max(1, Number(chars.value) || 1) }; });
    bindSetting(lines, settings => { settings.grid = { ...(settings.grid || {}), linesPerPage: Math.max(1, Number(lines.value) || 1) }; });
    bindSetting(marginTop, settings => { settings.margin = { ...(settings.margin || {}), topMm: Math.max(0, Number(marginTop.value) || 0) }; });
    bindSetting(marginBottom, settings => { settings.margin = { ...(settings.margin || {}), bottomMm: Math.max(0, Number(marginBottom.value) || 0) }; });
    bindSetting(marginInner, settings => { settings.margin = { ...(settings.margin || {}), innerMm: Math.max(0, Number(marginInner.value) || 0) }; });
    bindSetting(marginOuter, settings => { settings.margin = { ...(settings.margin || {}), outerMm: Math.max(0, Number(marginOuter.value) || 0) }; });
    bindSetting(pageStart, settings => { settings.pageNumber = { ...(settings.pageNumber || {}), enabled: true, start: Math.max(0, Number(pageStart.value) || 0) }; });
    bindSetting(headerText, settings => { settings.header = { enabled: !!headerText.value, text: headerText.value }; });
    bindSetting(footerText, settings => { settings.footer = { enabled: !!footerText.value, text: footerText.value }; });
    const bindPaperEditing = () => {
      preview.querySelectorAll('.sn-print-row[contenteditable]').forEach(rowEl => {
        // 本体エディタと同じく、連続入力を1履歴へまとめ、入力停止後の再編集は
        // 新しい履歴にする。once listenerでは同じ紙面行の2回目以降が履歴へ
        // 入らず、Undoで一括して古い状態へ戻ってしまう。
        rowEl.addEventListener('beforeinput', () => editor._beginTextInputUndo?.('紙面編集'));
        rowEl.addEventListener('input', () => {
          const rowId = rowEl.dataset.sourceRowId;
          const row = (editor.doc?.rows || []).find(item => String(item?.id || '') === rowId)
            || editor.doc?.rows?.[Number(rowEl.dataset.sourceRow)];
          if (!row || editor._readOnly) return;
          const next = storedRowText(rowEl.innerText === '\n' ? '' : rowEl.innerText);
          if (row.text === next) return;
          row.text = next;
          // 履歴・保存処理は本体エディタDOMを正本として同期する。紙面側だけを
          // 変えると直後のUndoで旧本文へ上書きされるため、同じ行のDOMも同期する。
          const editorText = Array.from(editor.host?.querySelectorAll?.('.sn2-text') || [])
            .find(element => String(element.dataset?.rowId || '') === String(row.id || rowId));
          if (editorText) editorText.textContent = rowEl.innerText === '\n' ? '' : rowEl.innerText;
          editor._calcCache = null; editor._markDirty?.({ skipUndo: true });
          saveStatus.textContent = '編集中（自動保存します）';
        });
        rowEl.addEventListener('blur', () => editor._endTextInputUndo?.());
        rowEl.addEventListener('compositionend', () => { saveStatus.textContent = '入力内容を自動保存します'; });
      });
    };
    const refresh = () => {
      data = logicalPages(editor.doc); currentPage = currentPageForEditor(editor, data.pages);
      range.placeholder = `1-${data.pages.length}`;
      range.disabled = mode.value !== 'range';
      const value = mode.value === 'range' ? (range.value || `1-${data.pages.length}`) : mode.value;
      try { preview.replaceChildren(render(editor.doc, { range: value, currentPage, editable: !editor._readOnly }).root); bindPaperEditing(); range.setCustomValidity(''); }
      catch (error) { range.setCustomValidity(error.message); }
    };
    mode.addEventListener('change', refresh); range.addEventListener('input', refresh);
    const cancel = document.createElement('button'); cancel.className = 'gb-btn'; cancel.textContent = 'キャンセル';
    const undo = document.createElement('button'); undo.className = 'gb-btn'; undo.textContent = '元に戻す';
    const redo = document.createElement('button'); redo.className = 'gb-btn'; redo.textContent = 'やり直す';
    const save = document.createElement('button'); save.className = 'gb-btn'; save.textContent = '保存';
    const action = document.createElement('button'); action.className = 'gb-btn gb-btn-primary'; action.textContent = '印刷…';
    const modal = global.GBUI.createModal({ id: 'scriptnote-print-layout', title: '紙面WYSIWYG', body, footer: [cancel, undo, redo, save, action], variant: 'standard', extraClass: 'gb-scriptnote-print-modal' });
    cancel.addEventListener('click', () => modal.close('cancel'));
    undo.addEventListener('click', () => { editor.undo?.(); global.setTimeout(() => { syncSettingControls(); refresh(); }, 0); });
    redo.addEventListener('click', () => { editor.redo?.(); global.setTimeout(() => { syncSettingControls(); refresh(); }, 0); });
    save.addEventListener('click', async () => {
      save.disabled = true; saveStatus.textContent = '保存しています…';
      try { const ok = await editor.flush?.(); saveStatus.textContent = ok === false ? '保存できませんでした。編集内容は保持しています。' : '保存しました'; }
      catch (error) { saveStatus.textContent = '保存できませんでした: ' + (error?.userMessage || error?.message || error); }
      finally { save.disabled = false; }
    });
    action.addEventListener('click', () => {
      const value = mode.value === 'range' ? range.value : mode.value;
      parseRange(value, data.pages.length, currentPage);
      modal.close('print');
      print(editor, { range: value });
    });
    const onHistory = event => {
      if (event.detail?.editor !== editor || !modal.isOpen?.()) return;
      syncSettingControls(); refresh();
    };
    global.addEventListener('meldex:scriptnote-history-restored', onHistory);
    const originalClose = modal.close.bind(modal);
    modal.close = reason => { global.removeEventListener('meldex:scriptnote-history-restored', onHistory); return originalClose(reason); };
    modal.open(); syncSettingControls(); refresh();
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
