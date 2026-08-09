/* B-MANGA scenario export: contract building, confirmation dialog, local relay. */
(function () {
  'use strict';

  const CONTRACT = 'meldex-bmanga-scenario';
  const VERSION = 1;
  const VERSION_V2 = 2;
  const DEFAULT_PORT = 47817;
  const RUBY_PRIORITY = Object.freeze({
    manual: 400,
    'shared-link-dictionary': 300,
    'document-rule': 200,
    'local-auto-dictionary': 100,
  });
  const DEFAULT_RUBY_PRESENTATION = Object.freeze({
    writingMode: 'horizontal',
    sizePercent: 50,
    gapEm: 0,
    letterSpacingEm: 0,
    lineHeight: 1.8,
    align: 'center',
    smallKana: 'keep',
    fontPreset: 'inherit',
    defaultStyle: 'group',
  });

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

  function _rubyStyle(value, fallback = 'group') {
    const safeFallback = ['group', 'mono', 'jukugo'].includes(fallback) ? fallback : 'group';
    return ['group', 'mono', 'jukugo'].includes(value) ? value : safeFallback;
  }

  function _logicalFontPreset(value) {
    const preset = String(value || '').trim();
    if (!preset || preset.includes('/') || preset.includes('\\') || /^[A-Za-z]:/.test(preset)) return 'inherit';
    return preset.slice(0, 128);
  }

  function _finiteNumber(value, fallback, minimum = null) {
    const number = Number(value);
    if (!Number.isFinite(number) || (minimum != null && number < minimum)) return fallback;
    return number;
  }

  function _legacyTransferGapEm(stored, fallbackWritingMode = 'horizontal') {
    const compatibility = (stored?.compatibility && typeof stored.compatibility === 'object')
      ? stored.compatibility : {};
    if (compatibility.useLegacyGap !== true) {
      return _finiteNumber(stored?.gapEm, DEFAULT_RUBY_PRESENTATION.gapEm);
    }
    const explicit = Number(compatibility.legacyGapEm);
    if (compatibility.legacyGapEm !== undefined && compatibility.legacyGapEm !== null
      && String(compatibility.legacyGapEm).trim() !== '' && Number.isFinite(explicit)) {
      return Math.max(-2, Math.min(4, explicit));
    }
    const baseEm = _finiteNumber(compatibility.legacyBaseEmPx, 14, 0.001);
    const writingMode = ['horizontal', 'vertical'].includes(stored?.writingMode)
      ? stored.writingMode : fallbackWritingMode;
    const defaultCrossSize = writingMode === 'vertical' ? 18 : 14;
    const crossSize = _finiteNumber(compatibility.legacyCrossSizePx, defaultCrossSize, 0.001);
    const offset = _finiteNumber(compatibility.legacyOffsetPx, 3.5);
    return Math.max(-2, Math.min(4, ((crossSize - baseEm) * 0.5 - offset) / baseEm));
  }

  function normalizeRubyPresentation(doc) {
    const stored = (doc?.rubyPresentation && typeof doc.rubyPresentation === 'object')
      ? doc.rubyPresentation
      : ((doc?.editor?.rubyPresentation && typeof doc.editor.rubyPresentation === 'object')
        ? doc.editor.rubyPresentation
        : {});
    const viewMode = doc?.editor?.viewMode === 'vertical' ? 'vertical' : 'horizontal';
    const sharedModel = window.MeldexRubyPresentation;
    if (typeof sharedModel?.normalize === 'function') {
      const fallback = { ...sharedModel.DEFAULTS, writingMode: viewMode };
      const normalized = typeof sharedModel.toTransferPresentation === 'function'
        ? sharedModel.toTransferPresentation(stored, fallback)
        : sharedModel.normalize(stored, fallback);
      return {
        writingMode: normalized.writingMode,
        sizePercent: normalized.sizePercent,
        gapEm: normalized.gapEm,
        letterSpacingEm: normalized.letterSpacingEm,
        lineHeight: normalized.lineHeight,
        align: normalized.align,
        smallKana: normalized.smallKana,
        fontPreset: _logicalFontPreset(normalized.fontPreset),
        defaultStyle: _rubyStyle(normalized.defaultStyle),
      };
    }
    return {
      writingMode: ['horizontal', 'vertical'].includes(stored.writingMode) ? stored.writingMode : viewMode,
      sizePercent: stored?.compatibility?.useLegacySize === true
        ? _finiteNumber(stored.compatibility.legacySizeEm, 0.55, 0.05) * 100
        : _finiteNumber(stored.sizePercent, DEFAULT_RUBY_PRESENTATION.sizePercent, 5),
      gapEm: _legacyTransferGapEm(stored, viewMode),
      letterSpacingEm: _finiteNumber(stored.letterSpacingEm, DEFAULT_RUBY_PRESENTATION.letterSpacingEm),
      lineHeight: _finiteNumber(stored.lineHeight, DEFAULT_RUBY_PRESENTATION.lineHeight, 0.1),
      align: ['center', 'start'].includes(stored.align) ? stored.align : DEFAULT_RUBY_PRESENTATION.align,
      smallKana: ['keep', 'fullsize'].includes(stored.smallKana) ? stored.smallKana : DEFAULT_RUBY_PRESENTATION.smallKana,
      fontPreset: _logicalFontPreset(stored.fontPreset),
      defaultStyle: _rubyStyle(stored.defaultStyle, DEFAULT_RUBY_PRESENTATION.defaultStyle),
    };
  }

  function _normalizedRubyRule(rule, index, origin, defaultStyle = 'group') {
    const text = String(rule?.text || '');
    const rubyText = String(rule?.rubyText ?? rule?.ruby ?? '');
    if (!text || !rubyText) return null;
    const normalized = {
      text,
      chars: Array.from(text),
      rubyText,
      style: _rubyStyle(rule?.style, defaultStyle),
      origin,
      priority: RUBY_PRIORITY[origin],
      index,
    };
    if (Array.isArray(rule?.segments)) normalized.segments = rule.segments.map(item => ({ ...item }));
    return normalized;
  }

  function _applyRubyRuleSource(body, rules, used, found, origin, defaultStyle = 'group') {
    const chars = Array.from(body);
    const normalized = (Array.isArray(rules) ? rules : [])
      .map((rule, index) => _normalizedRubyRule(rule, index, origin, defaultStyle))
      .filter(Boolean);
    for (let pos = 0; pos < chars.length; pos++) {
      const candidates = normalized
        .filter(rule => rule.chars.every((ch, offset) => chars[pos + offset] === ch))
        .sort((a, b) => b.chars.length - a.chars.length || a.index - b.index);
      const match = candidates.find(rule => rule.chars.every((_ch, offset) => !used[pos + offset]));
      if (!match) continue;
      match.chars.forEach((_ch, offset) => { used[pos + offset] = true; });
      const span = {
        start: pos,
        length: match.chars.length,
        rubyText: match.rubyText,
        style: match.style,
        origin: match.origin,
        priority: match.priority,
      };
      if (match.segments) span.segments = match.segments;
      found.push(span);
      pos += match.chars.length - 1;
    }
  }

  function resolveRubySpans(raw, sources = {}) {
    let body = '';
    const rubies = [];
    const protectedRanges = [];
    const defaultStyle = _rubyStyle(sources.defaultStyle);
    _segments(raw).forEach(segment => {
      const start = _visibleLength(body);
      if (segment.type === 'ruby') {
        const base = String(segment.plain || '');
        const rubyText = String(segment.ruby || '');
        body += base;
        const span = {
          start,
          length: _visibleLength(base),
          rubyText,
          style: _rubyStyle(segment.style, defaultStyle),
          origin: 'manual',
          priority: RUBY_PRIORITY.manual,
        };
        if (Array.isArray(segment.segments)) span.segments = segment.segments.map(item => ({ ...item }));
        if (span.length && rubyText) rubies.push(span);
      } else if (segment.type === 'manual-link') {
        const labelRaw = _manualLinkLabelRaw(segment.raw);
        const nested = labelRaw
          ? resolveRubySpans(labelRaw, { defaultStyle })
          : { body: String(segment.plain || ''), rubies: [] };
        body += nested.body;
        nested.rubies.forEach(item => rubies.push({ ...item, start: start + item.start }));
        protectedRanges.push({ start, length: _visibleLength(nested.body) });
      } else {
        body += _plain(segment.raw);
      }
    });
    const used = new Array(_visibleLength(body)).fill(false);
    rubies.concat(protectedRanges).forEach(item => {
      for (let i = item.start; i < item.start + item.length; i++) used[i] = true;
    });
    _applyRubyRuleSource(body, sources.sharedLinkEntries, used, rubies, 'shared-link-dictionary', defaultStyle);
    _applyRubyRuleSource(body, sources.documentRules, used, rubies, 'document-rule', defaultStyle);
    _applyRubyRuleSource(body, sources.localDictionary, used, rubies, 'local-auto-dictionary', defaultStyle);
    rubies.sort((a, b) => a.start - b.start || b.priority - a.priority || b.length - a.length);
    return { body, rubies };
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
  function _getTextAffix(doc, roleOrRow) {
    const role = typeof roleOrRow === 'object' ? String(roleOrRow?.role || '') : String(roleOrRow || '');
    const chara = globalThis.GBScriptNoteRoleModel?.getEffectiveStyle?.(doc, roleOrRow)
      || (role
        ? (doc?.characters || []).find(c => c && !c.isDefault && c.name === role)
        : (doc?.characters || []).find(c => c && c.isDefault));
    const ts = chara?.textStyle || {};
    const before = ts.textBefore ?? chara?.textBefore ?? '';
    const after = ts.textAfter ?? chara?.textAfter ?? '';
    return { before: String(before || ''), after: String(after || '') };
  }

  function _getEffectiveRoleType(doc, row) {
    const effective = globalThis.GBScriptNoteRoleModel?.getEffectiveRole?.(doc, row);
    if (effective) return effective.type || effective.style || null;
    const role = String(row?.role || '');
    return role
      ? (doc?.characters || []).find(item => item && !item.isDefault && item.name === role) || null
      : (doc?.characters || []).find(item => item && item.isDefault) || null;
  }

  function _sharedLinkEntries() {
    const entries = window.MeldexAutoLink?.getDict?.();
    return (Array.isArray(entries) ? entries : []).filter(item => item && String(item.ruby || ''));
  }

  function _supportsV2(capabilities) {
    return capabilities?.contract === CONTRACT
      && Array.isArray(capabilities?.versions)
      && capabilities.versions.includes(VERSION_V2)
      && capabilities?.features?.presentationRuby === true
      && capabilities?.features?.rubySpanOrigins === true
      && capabilities?.features?.rubySegments === true;
  }

  function _rowPresentation(row, doc) {
    const override = (row?.rubyPresentation && typeof row.rubyPresentation === 'object')
      ? row.rubyPresentation
      : ((row?.presentation?.ruby && typeof row.presentation.ruby === 'object') ? row.presentation.ruby : null);
    if (!override) return null;
    return normalizeRubyPresentation({
      rubyPresentation: { ...normalizeRubyPresentation(doc), ...override },
      editor: doc?.editor,
    });
  }

  // doc/documentId のみに依存する純粋関数。Node からの直接evalテストのため editor に依存しない。
  function buildPayload(doc, documentId, options) {
    const opts = Object.assign({
      selectedRowIds: null,
      includeAffix: false,
      includeSummary: false,
      includeBreakText: false,
      skipBlank: false,
      contractVersion: VERSION,
      sharedLinkEntries: null,
      localDictionary: null,
    }, options || {});
    const contractVersion = Number(opts.contractVersion) === VERSION_V2 ? VERSION_V2 : VERSION;
    const id = String(documentId || doc?.source?.documentId || '').trim();
    if (!id) throw new Error('先にシナリオを保存してください');
    const allRows = Array.isArray(doc?.rows) ? doc.rows : [];
    let sourceRows = allRows;
    if (Array.isArray(opts.selectedRowIds)) {
      const idSet = new Set(opts.selectedRowIds);
      sourceRows = allRows.filter(row => idSet.has(row?.id));
    }
    const pages = [{ pageIndex: 0, rows: [] }];
    sourceRows.forEach((row, index) => {
      const role = String(row?.role || '');
      const roleType = _getEffectiveRoleType(doc, row);
      const isBreak = !!role && !!(roleType?.isBreak || roleType?.kind === 'break');
      const isSummary = !!role && !!(roleType?.isSummary || roleType?.kind === 'summary');
      if (isSummary && !opts.includeSummary) return;
      if (isBreak && index > 0) pages.push({ pageIndex: pages.length, rows: [] });
      const resolved = contractVersion === VERSION_V2
        ? resolveRubySpans(String(row?.text || ''), {
          sharedLinkEntries: Array.isArray(opts.sharedLinkEntries) ? opts.sharedLinkEntries : _sharedLinkEntries(),
          documentRules: doc?.rubyRules,
          localDictionary: opts.localDictionary,
          defaultStyle: window.MeldexRubyPresentation?.ensureDocument?.(doc)?.defaultStyle
            || doc?.rubyPresentation?.defaultStyle,
        })
        : resolveVisibleBody(String(row?.text || ''), doc?.rubyRules);
      let body = resolved.body;
      let rubies = resolved.rubies;
      if (opts.includeAffix && body) {
        const affix = _getTextAffix(doc, row);
        const shift = _visibleLength(affix.before);
        if (shift) rubies = rubies.map(item => ({ ...item, start: item.start + shift }));
        body = affix.before + body + affix.after;
      }
      const rowId = String(row?.id || `row-${index}`);
      const rowPayload = { rowId, type: isBreak ? '' : role, body, rubies };
      const rowRubyPresentation = contractVersion === VERSION_V2 ? _rowPresentation(row, doc) : null;
      if (rowRubyPresentation) rowPayload.presentation = { ruby: rowRubyPresentation };
      if (isBreak) {
        // 区切り行は「区切り行のテキストも出力する」ONかつ本文ありのときだけ、新しいページの先頭に type:'' で出力する。
        if (opts.includeBreakText && body) {
          pages[pages.length - 1].rows.push(rowPayload);
        }
        return;
      }
      // 「空白行を出力しない」: 区切り/プロットではなく、役名も本文も空の行だけを除外する。
      if (opts.skipBlank && !isSummary && !role && !body) return;
      pages[pages.length - 1].rows.push(rowPayload);
    });
    const payload = {
      contract: CONTRACT,
      version: contractVersion,
      source: { documentId: id, title: String(doc?.title || '') },
      pages,
    };
    if (contractVersion === VERSION_V2) {
      payload.indexUnit = 'unicode-code-point';
      payload.normalization = 'none';
      payload.presentation = { ruby: normalizeRubyPresentation(doc) };
    }
    return payload;
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
        const options = currentOptions();
        try { payload = buildPayload(doc, documentId, options); }
        catch (error) { showStatus?.(error.message || String(error), true); return; }
        close({ port: Number(port.value), token: token.value, payload, options });
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
      let sendVersion = VERSION;
      try {
        const capabilityResponse = await fetch('/api/bmanga/scenario/capabilities', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ port: result.port, token: result.token }),
        });
        const capabilities = await capabilityResponse.json().catch(() => ({}));
        if (capabilityResponse.ok && _supportsV2(capabilities)) sendVersion = VERSION_V2;
      } catch {
        // 能力確認に失敗しても、公開済みv1の送信経路は止めない。
      }
      result.payload = buildPayload(editor.doc, documentId, {
        ...(result.options || {}),
        contractVersion: sendVersion,
        sharedLinkEntries: _sharedLinkEntries(),
      });
      const response = await fetch('/api/bmanga/scenario/send', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ port: result.port, token: result.token, payload: result.payload }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.detail || data.error || '送信に失敗しました');
      const compatibilityNotice = sendVersion === VERSION
        ? '。ルビの表示設定は送信されません'
        : '';
      showStatus?.(`B-MANGAへ${result.payload.pages.length}ページを送信しました${compatibilityNotice}`);
      return data;
    } catch (error) {
      showStatus?.(error.message || 'B-MANGAへの送信に失敗しました', true);
    } finally { hideLoading?.(); }
  }

  window.MeldexBManga = {
    isAvailable,
    resolveVisibleBody,
    resolveRubySpans,
    normalizeRubyPresentation,
    supportsV2: _supportsV2,
    buildPayload,
    sendActiveScenario,
  };
})();
