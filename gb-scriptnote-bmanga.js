/* B-MANGA scenario export: contract building, confirmation dialog, local relay. */
(function () {
  'use strict';

  const CONTRACT = 'meldex-bmanga-scenario';
  const VERSION = 1;
  const DEFAULT_PORT = 47817;

  function isAvailable() {
    const host = String(location.hostname || '').toLowerCase();
    const localHost = host === '127.0.0.1' || host === 'localhost';
    return localHost && document.body?.dataset?.cloudMode !== 'dropbox';
  }

  function _visibleLength(value) { return Array.from(String(value || '')).length; }

  function _segments(raw) {
    if (typeof _sn2CollectVisibleSegments === 'function') return _sn2CollectVisibleSegments(String(raw || ''));
    return [{ type: 'plain', raw: String(raw || '') }];
  }

  function _plain(raw) {
    if (typeof _sn2UnescapeScriptNotePlainText === 'function') return _sn2UnescapeScriptNotePlainText(raw);
    return String(raw || '').replace(/\\([\\{|}\[\]])/g, '$1');
  }

  function _manualLinkLabelRaw(raw) {
    const match = String(raw || '').match(/^\[((?:\\.|[^\]])+)\]\(ml:/);
    return match ? match[1] : '';
  }

  function resolveVisibleBody(raw, rubyRules) {
    let body = '';
    const rubies = [];
    const protectedRanges = [];
    _segments(raw).forEach(segment => {
      const start = _visibleLength(body);
      if (segment.type === 'ruby') {
        const base = String(segment.plain || '');
        body += base;
        rubies.push({ start, length: _visibleLength(base), rubyText: String(segment.ruby || ''), style: 'group' });
      } else if (segment.type === 'manual-link') {
        const labelRaw = _manualLinkLabelRaw(segment.raw);
        const nested = labelRaw ? resolveVisibleBody(labelRaw, []) : { body: String(segment.plain || ''), rubies: [] };
        const label = nested.body;
        body += label;
        nested.rubies.forEach(item => rubies.push({ ...item, start: start + item.start }));
        protectedRanges.push({ start, length: _visibleLength(label) });
      } else {
        body += _plain(segment.raw);
      }
    });
    _automaticRubies(body, rubyRules, rubies.concat(protectedRanges)).forEach(item => rubies.push(item));
    rubies.sort((a, b) => a.start - b.start || b.length - a.length || a.style.localeCompare(b.style));
    return { body, rubies };
  }

  function _automaticRubies(body, rubyRules, occupied) {
    const chars = Array.from(body);
    const used = new Array(chars.length).fill(false);
    occupied.forEach(item => {
      for (let i = item.start; i < item.start + item.length; i++) used[i] = true;
    });
    const rules = (Array.isArray(rubyRules) ? rubyRules : [])
      .filter(rule => rule && String(rule.text || '') && String(rule.ruby || ''))
      .map((rule, index) => ({ text: String(rule.text), ruby: String(rule.ruby), index, chars: Array.from(String(rule.text)) }));
    const found = [];
    for (let pos = 0; pos < chars.length; pos++) {
      const candidates = rules.filter(rule => rule.chars.every((ch, offset) => chars[pos + offset] === ch));
      candidates.sort((a, b) => b.chars.length - a.chars.length || a.index - b.index);
      const match = candidates.find(rule => rule.chars.every((_ch, offset) => !used[pos + offset]));
      if (!match) continue;
      match.chars.forEach((_ch, offset) => { used[pos + offset] = true; });
      found.push({ start: pos, length: match.chars.length, rubyText: match.ruby, style: 'group' });
      pos += match.chars.length - 1;
    }
    return found;
  }

  // クリスタ送信（gb-scriptnote-clipstudio.js の _sn2GetTextAffix）と同じ解決規則。
  // editor ではなく doc のみから引けるようにした純粋関数版。
  function _getTextAffix(doc, role) {
    const characters = Array.isArray(doc?.characters) ? doc.characters : [];
    const chara = role
      ? characters.find(c => c && !c.isDefault && c.name === role)
      : characters.find(c => c && c.isDefault);
    const ts = chara?.textStyle || {};
    const before = ts.textBefore ?? chara?.textBefore ?? '';
    const after = ts.textAfter ?? chara?.textAfter ?? '';
    return { before: String(before || ''), after: String(after || '') };
  }

  // doc/documentId のみに依存する純粋関数。Node からの直接evalテストのため editor に依存しない。
  function buildPayload(doc, documentId, options) {
    const opts = Object.assign({
      selectedRowIds: null,
      includeAffix: false,
      includeSummary: false,
      includeBreakText: false,
      skipBlank: false,
    }, options || {});
    const id = String(documentId || doc?.source?.documentId || '').trim();
    if (!id) throw new Error('先にシナリオを保存してください');
    const characters = Array.isArray(doc?.characters) ? doc.characters : [];
    const breakNames = new Set(characters
      .filter(item => item && !item.isDefault && item.isBreak && item.name)
      .map(item => String(item.name)));
    const summaryNames = new Set(characters
      .filter(item => item && !item.isDefault && item.isSummary && item.name)
      .map(item => String(item.name)));
    const allRows = Array.isArray(doc?.rows) ? doc.rows : [];
    let sourceRows = allRows;
    if (Array.isArray(opts.selectedRowIds)) {
      const idSet = new Set(opts.selectedRowIds);
      sourceRows = allRows.filter(row => idSet.has(row?.id));
    }
    const pages = [{ pageIndex: 0, rows: [] }];
    sourceRows.forEach((row, index) => {
      const role = String(row?.role || '');
      const isBreak = !!role && breakNames.has(role);
      const isSummary = !!role && summaryNames.has(role);
      if (isSummary && !opts.includeSummary) return;
      if (isBreak && index > 0) pages.push({ pageIndex: pages.length, rows: [] });
      const resolved = resolveVisibleBody(String(row?.text || ''), doc?.rubyRules);
      let body = resolved.body;
      let rubies = resolved.rubies;
      if (opts.includeAffix && body) {
        const affix = _getTextAffix(doc, role);
        const shift = _visibleLength(affix.before);
        if (shift) rubies = rubies.map(item => ({ ...item, start: item.start + shift }));
        body = affix.before + body + affix.after;
      }
      const rowId = String(row?.id || `row-${index}`);
      if (isBreak) {
        // 区切り行は「区切り行のテキストも出力する」ONかつ本文ありのときだけ、新しいページの先頭に type:'' で出力する。
        if (opts.includeBreakText && body) {
          pages[pages.length - 1].rows.push({ rowId, type: '', body, rubies });
        }
        return;
      }
      // 「空白行を出力しない」: 区切り/プロットではなく、役名も本文も空の行だけを除外する。
      if (opts.skipBlank && !isSummary && !role && !body) return;
      pages[pages.length - 1].rows.push({ rowId, type: role, body, rubies });
    });
    return {
      contract: CONTRACT,
      version: VERSION,
      source: { documentId: id, title: String(doc?.title || '') },
      pages,
    };
  }

  function _activeEditor() {
    if (typeof _sn2GetActiveEditor === 'function') return _sn2GetActiveEditor();
    return window.getActiveScriptNoteComponent?.()?._editor || null;
  }

  function _documentId(editor) {
    return String(editor?._path || editor?.doc?.source?.documentId || window.state?.currentPagePath || '');
  }

  // クリスタ送信（_sn2RowsForClipStudio）と同じ方法で選択行を取得し、id配列を返す。
  // 「選択範囲」に意味のある部分選択（1行以上、全行未満）がなければ null を返す。
  function _selectedRowIds(editor) {
    const rows = Array.isArray(editor?.doc?.rows) ? editor.doc.rows : [];
    let selectedIds = null;
    if (typeof editor?._getVisibleSelectedIds === 'function') {
      selectedIds = editor._getVisibleSelectedIds();
    } else if (editor?._rowSelection instanceof Set) {
      selectedIds = editor._rowSelection;
    }
    if (!selectedIds?.size) return null;
    const ids = rows.filter(row => selectedIds.has(row.id)).map(row => row.id);
    if (!ids.length || ids.length >= rows.length) return null;
    return ids;
  }

  function _field(label, input) {
    const wrap = document.createElement('label');
    wrap.style.cssText = 'display:grid;grid-template-columns:150px 1fr;gap:10px;align-items:center;margin:10px 0;';
    const text = document.createElement('span');
    text.textContent = label;
    wrap.append(text, input);
    return wrap;
  }

  function _checkboxField(e2eId, text) {
    const field = document.createElement('div');
    field.className = 'field';
    const label = document.createElement('label');
    label.className = 'sn2-sep-choice';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.dataset.e2eId = e2eId;
    const span = document.createElement('span');
    span.textContent = text;
    label.append(input, span);
    field.appendChild(label);
    return { field, input };
  }

  function _openDialog(doc, documentId, selectedRowIds) {
    return new Promise(resolve => {
      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay';
      overlay.dataset.sn2Dialog = 'bmanga-send';
      const modal = document.createElement('div');
      modal.className = 'modal';
      modal.setAttribute('role', 'dialog');
      modal.setAttribute('aria-modal', 'true');
      modal.setAttribute('aria-label', 'B-MANGAへ送信');
      modal.style.cssText = 'width:min(520px,calc(100vw - 32px));max-height:calc(100vh - 32px);overflow:auto;padding:20px;box-sizing:border-box;';
      const title = document.createElement('h2');
      title.textContent = 'B-MANGAへ送信';

      const totalCount = Array.isArray(doc?.rows) ? doc.rows.length : 0;
      const hasSelection = Array.isArray(selectedRowIds) && selectedRowIds.length > 0;
      const selectedCount = hasSelection ? selectedRowIds.length : 0;

      const rangeField = document.createElement('div');
      rangeField.className = 'field';
      const rangeLabel = document.createElement('label');
      rangeLabel.textContent = '送信範囲';
      const rangeRow = document.createElement('div');
      rangeRow.className = 'sn2-sep-range-row';

      const allChoice = document.createElement('label');
      allChoice.className = 'sn2-sep-choice';
      const allRadio = document.createElement('input');
      allRadio.type = 'radio'; allRadio.name = 'bmanga-send-range'; allRadio.value = 'all';
      allRadio.dataset.e2eId = 'bmanga-send-range-all';
      allRadio.checked = !hasSelection;
      const allLabelText = document.createElement('span');
      allLabelText.textContent = `全行（${totalCount}行）`;
      allChoice.append(allRadio, allLabelText);
      rangeRow.appendChild(allChoice);

      let selectedRadio = null;
      if (hasSelection) {
        const selectedChoice = document.createElement('label');
        selectedChoice.className = 'sn2-sep-choice';
        selectedRadio = document.createElement('input');
        selectedRadio.type = 'radio'; selectedRadio.name = 'bmanga-send-range'; selectedRadio.value = 'selected';
        selectedRadio.dataset.e2eId = 'bmanga-send-range-selected';
        selectedRadio.checked = true;
        const selectedLabelText = document.createElement('span');
        selectedLabelText.textContent = `選択範囲（${selectedCount}行）`;
        selectedChoice.append(selectedRadio, selectedLabelText);
        rangeRow.appendChild(selectedChoice);
      }
      rangeField.append(rangeLabel, rangeRow);

      const affix = _checkboxField('bmanga-send-include-affix', 'テキストの前後設定（「」（）等）を含める');
      const summaryField = _checkboxField('bmanga-send-include-summary', 'プロット行も出力する');
      const breakTextField = _checkboxField('bmanga-send-include-break-text', '区切り行のテキストも出力する');
      const skipBlankField = _checkboxField('bmanga-send-skip-blank', '空白行を出力しない');

      const countSummary = document.createElement('p');

      const currentOptions = () => ({
        selectedRowIds: (selectedRadio?.checked) ? selectedRowIds : null,
        includeAffix: affix.input.checked,
        includeSummary: summaryField.input.checked,
        includeBreakText: breakTextField.input.checked,
        skipBlank: skipBlankField.input.checked,
      });
      const refreshSummary = () => {
        let payload;
        try { payload = buildPayload(doc, documentId, currentOptions()); }
        catch { countSummary.textContent = ''; return; }
        const rowCount = payload.pages.reduce((total, page) => total + page.rows.length, 0);
        countSummary.textContent = `${payload.pages.length}ページ、本文${rowCount}件を送信します。`;
      };
      [allRadio, selectedRadio, affix.input, summaryField.input, breakTextField.input, skipBlankField.input]
        .filter(Boolean)
        .forEach(input => input.addEventListener('change', refreshSummary));
      refreshSummary();

      const port = document.createElement('input');
      port.type = 'number'; port.min = '1024'; port.max = '65535'; port.value = String(DEFAULT_PORT);
      port.dataset.e2eId = 'bmanga-send-port';
      const token = document.createElement('input');
      token.type = 'password'; token.autocomplete = 'off'; token.spellcheck = false;
      token.placeholder = 'B-MANGAに表示された接続トークン'; token.dataset.e2eId = 'bmanga-send-token';
      const buttons = document.createElement('div');
      buttons.style.cssText = 'display:flex;justify-content:flex-end;gap:8px;margin-top:18px;';
      const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = 'キャンセル';
      const send = document.createElement('button'); send.type = 'button'; send.textContent = '送信'; send.className = 'primary';
      send.dataset.e2eId = 'bmanga-send-confirm';
      const close = value => { token.value = ''; overlay.remove(); resolve(value); };
      cancel.addEventListener('click', () => close(null));
      send.addEventListener('click', () => {
        let payload;
        try { payload = buildPayload(doc, documentId, currentOptions()); }
        catch (error) { showStatus?.(error.message || String(error), true); return; }
        close({ port: Number(port.value), token: token.value, payload });
      });
      overlay.addEventListener('click', event => { if (event.target === overlay) close(null); });
      buttons.append(cancel, send);
      modal.append(
        title,
        rangeField,
        affix.field,
        summaryField.field,
        breakTextField.field,
        skipBlankField.field,
        countSummary,
        _field('B-MANGAのポート', port),
        _field('接続トークン', token),
        buttons,
      );
      overlay.appendChild(modal); document.body.appendChild(overlay);
      // 配置は .modal-overlay の flex 中央寄せに任せる（クリスタ送信ダイアログと同方式）。
      // positionPopup で手動配置すると中央寄せから外れ、縦に長いダイアログが画面外へはみ出す。
      window.GBModalShell?.enhanceOverlay?.(overlay);
      token.focus();
    });
  }

  async function sendActiveScenario() {
    if (!isAvailable()) return;
    const editor = _activeEditor();
    if (!editor?.doc) return showStatus?.('シナリオが開かれていません', true);
    editor._syncAllFromDom?.();
    const documentId = _documentId(editor);
    try { buildPayload(editor.doc, documentId, {}); }
    catch (error) { return showStatus?.(error.message || String(error), true); }
    const selectedRowIds = _selectedRowIds(editor);
    const result = await _openDialog(editor.doc, documentId, selectedRowIds);
    if (!result) return;
    showLoading?.('B-MANGAへ送信しています...');
    try {
      const response = await fetch('/api/bmanga/scenario/send', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ port: result.port, token: result.token, payload: result.payload }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.detail || data.error || '送信に失敗しました');
      showStatus?.(`B-MANGAへ${result.payload.pages.length}ページを送信しました`);
      return data;
    } catch (error) {
      showStatus?.(error.message || 'B-MANGAへの送信に失敗しました', true);
    } finally { hideLoading?.(); }
  }

  window.MeldexBManga = { isAvailable, resolveVisibleBody, buildPayload, sendActiveScenario };
})();
