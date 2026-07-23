/* gb-text-selection-format.js: selection-triggered rich text format popup */
(function () {
  'use strict';

  const POPUP_CLASS = 'gb-text-selection-fmt';
  const ALLOWED_EDITABLES = [
    '#page-content',
    '#entity-freetext',
    '#dp-editable',
    '#board-note-editable',
    '.sn2-text[contenteditable="true"]',
    '.value-rich-editor[contenteditable="true"]',
    '.bd-node.bd-editing .bd-text[contenteditable="true"]',
    '.bd-conn-label[contenteditable="true"]',
  ].join(',');
  const FIELDS = [
    'textColor', 'fontSize', 'fontFamily',
    'bold', 'italic', 'textStrokeColor', 'textStrokeWidth',
    'bgColor', 'leftAccent', 'underline', 'accentColor',
  ];

  let _timer = null;
  let _savedRange = null;
  let _savedRoot = null;
  let _suppressUntil = 0;
  // 選択操作の途中（マウスドラッグ中 / Shift押下中）はルビ入力欄へ自動フォーカスしない
  let _pointerSelecting = false;
  let _shiftSelecting = false;

  function _closeSelectionPopup() {
    document.querySelectorAll('.' + POPUP_CLASS).forEach(el => el.remove());
  }

  function _isCloudMobileEditingUiActive() {
    return !!window.MeldexCloudMobile?.isMobileEditingUiEnabled?.()
      || document.body?.dataset?.cloudMobileEditingUi === '1';
  }

  function _nodeElement(node) {
    if (!node) return null;
    return node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
  }

  function _isTransparentColor(value) {
    const raw = String(value || '').trim().toLowerCase().replace(/\s+/g, '');
    return !raw
      || raw === 'transparent'
      || raw === 'rgba(0,0,0,0)'
      || raw === 'rgba(0,0,0,0.0)';
  }

  function _allowedRootFromRange(range) {
    const root = _nodeElement(range.commonAncestorContainer)?.closest?.(ALLOWED_EDITABLES);
    if (!root || root.getAttribute('contenteditable') === 'false') return null;
    return root;
  }

  function _rangeRect(range) {
    const rects = Array.from(range.getClientRects()).filter(r => r.width || r.height);
    if (rects.length) return rects[0];
    const rect = range.getBoundingClientRect();
    return rect && (rect.width || rect.height) ? rect : null;
  }

  function _rangeAvoidRect(range) {
    const rects = Array.from(range.getClientRects()).filter(r => r.width || r.height);
    if (!rects.length) return _rangeRect(range);
    return rects.reduce((acc, r) => ({
      left: Math.min(acc.left, r.left),
      top: Math.min(acc.top, r.top),
      right: Math.max(acc.right, r.right),
      bottom: Math.max(acc.bottom, r.bottom),
      width: Math.max(acc.right, r.right) - Math.min(acc.left, r.left),
      height: Math.max(acc.bottom, r.bottom) - Math.min(acc.top, r.top),
    }), {
      left: rects[0].left,
      top: rects[0].top,
      right: rects[0].right,
      bottom: rects[0].bottom,
      width: rects[0].width,
      height: rects[0].height,
    });
  }

  function _restoreSelection() {
    if (!_savedRange || !_savedRoot?.isConnected) return false;
    const sel = window.getSelection();
    if (!sel) return false;
    _savedRoot.focus?.();
    sel.removeAllRanges();
    sel.addRange(_savedRange.cloneRange());
    return true;
  }

  function _rangeIntersectsNode(range, node) {
    try {
      return !!(range && node && range.intersectsNode(node));
    } catch {
      return false;
    }
  }

  function _elementHasSelectedText(range, el) {
    if (!el || !_rangeIntersectsNode(range, el)) return false;
    return !!String(el.textContent || '').trim();
  }

  function _firstSelectedTextElement(range, root) {
    const startEl = _nodeElement(range.startContainer);
    if (range.startContainer?.nodeType === Node.TEXT_NODE && String(range.startContainer.textContent || '').trim()) {
      return startEl;
    }
    if (range.startContainer?.nodeType === Node.ELEMENT_NODE) {
      const child = range.startContainer.childNodes?.[range.startOffset] || null;
      const childEl = _nodeElement(child);
      if (childEl && root?.contains?.(childEl) && _elementHasSelectedText(range, childEl)) return childEl;
    }
    const walkerRoot = (startEl && root?.contains?.(startEl)) ? startEl : (_nodeElement(range.commonAncestorContainer) || root);
    if (!walkerRoot) return startEl || root;
    const walker = document.createTreeWalker(walkerRoot, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!String(node.textContent || '').trim()) return NodeFilter.FILTER_REJECT;
        if (!_rangeIntersectsNode(range, node)) return NodeFilter.FILTER_REJECT;
        const el = _nodeElement(node);
        return el && root?.contains?.(el) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      },
    });
    const textNode = walker.nextNode();
    return _nodeElement(textNode) || startEl || root;
  }

  function _styleElementForRange(range) {
    const root = _allowedRootFromRange(range) || _savedRoot;
    const el = _firstSelectedTextElement(range, root);
    if (el && root?.contains?.(el)) return el;
    return _nodeElement(range.startContainer) || root;
  }

  function _computedValues(range) {
    const el = _styleElementForRange(range);
    const cs = el ? getComputedStyle(el) : null;
    const bg = cs?.backgroundColor || '';
    return {
      textColor: cs?.color || '',
      bgColor: _isTransparentColor(bg) ? '' : bg,
      fontWeight: parseInt(cs?.fontWeight || '400', 10) >= 600 ? 'bold' : '',
      fontStyle: cs?.fontStyle === 'italic' ? 'italic' : '',
      fontSize: parseInt(cs?.fontSize || '', 10) || '',
      fontFamily: typeof normalizeFontFamilyValue === 'function'
        ? normalizeFontFamilyValue(cs?.fontFamily || '')
        : (cs?.fontFamily || ''),
      textStrokeColor: cs?.webkitTextStrokeColor || '',
      textStrokeWidth: parseFloat(cs?.webkitTextStrokeWidth || '') || 0,
      leftAccent: false,
      underline: String(cs?.textDecorationLine || '').includes('underline'),
      accentColor: cs?.textDecorationColor || cs?.color || '',
    };
  }

  function _computedStyleFor(el) {
    try {
      return el && typeof getComputedStyle === 'function' ? getComputedStyle(el) : null;
    } catch {
      return null;
    }
  }

  function _rootTextColor() {
    return _computedStyleFor(_savedRoot)?.color || 'var(--fg)';
  }

  function _rootFontSize() {
    return _computedStyleFor(_savedRoot)?.fontSize || '';
  }

  function _rootFontFamily() {
    const value = _computedStyleFor(_savedRoot)?.fontFamily || '';
    return typeof normalizeFontFamilyValue === 'function' ? normalizeFontFamilyValue(value) : value;
  }

  function _clearBackgroundColor() {
    const candidates = typeof document === 'undefined'
      ? [_savedRoot]
      : [_savedRoot, document.body, document.documentElement];
    for (const el of candidates) {
      const bg = _computedStyleFor(el)?.backgroundColor || '';
      if (!_isTransparentColor(bg)) return bg;
    }
    return 'var(--bg)';
  }

  function _stylePatch(prop, value) {
    if (prop === 'textColor') return { color: value || _rootTextColor() };
    if (prop === 'bgColor') return { backgroundColor: _isTransparentColor(value) ? _clearBackgroundColor() : value };
    if (prop === 'fontWeight') return { fontWeight: value === 'bold' ? 'bold' : 'normal' };
    if (prop === 'fontStyle') return { fontStyle: value === 'italic' ? 'italic' : 'normal' };
    if (prop === 'fontSize') return { fontSize: value ? value + 'px' : _rootFontSize() };
    if (prop === 'fontFamily') return { fontFamily: value || _rootFontFamily() };
    if (prop === 'textStrokeColor') return { webkitTextStrokeColor: value || 'transparent', paintOrder: value ? 'stroke fill' : '' };
    if (prop === 'textStrokeWidth') return { webkitTextStrokeWidth: value ? value + 'px' : '0px', paintOrder: value ? 'stroke fill' : '' };
    if (prop === 'underline') return { textDecoration: value ? 'underline' : 'none', textDecorationLine: value ? 'underline' : 'none' };
    if (prop === 'accentColor') {
      return {
        textDecorationColor: value || 'currentColor',
        borderLeftColor: value || 'currentColor',
      };
    }
    if (prop === 'leftAccent') {
      return {
        borderLeft: value ? '3px solid var(--accent)' : '0 solid transparent',
        paddingLeft: value ? '6px' : '0',
      };
    }
    return {};
  }

  function _captureUndoBeforeFormat(root) {
    if (!root) return;
    const scriptText = root.closest?.('.sn2-text[contenteditable="true"]');
    if (scriptText && typeof getActiveScriptNoteComponent === 'function') {
      const ed = getActiveScriptNoteComponent()?._editor;
      if (typeof ed?._pushUndo === 'function') {
        ed._pushUndo('書式設定変更');
        return;
      }
    }
    if (root.closest?.('.bd-node.bd-editing, .bd-conn-label[contenteditable="true"]') && typeof bdPushUndo === 'function') {
      bdPushUndo();
      return;
    }
    if (typeof _pushCustomUndo === 'function' && root.contentEditable === 'true') {
      _pushCustomUndo(root);
    }
  }

  function _clearStylePatch(styleProp) {
    if (styleProp === 'backgroundColor') return _stylePatch('bgColor', '');
    if (styleProp === 'color') return _stylePatch('textColor', '');
    if (styleProp === 'fontWeight') return _stylePatch('fontWeight', '');
    if (styleProp === 'fontStyle') return _stylePatch('fontStyle', '');
    if (styleProp === 'fontSize') return _stylePatch('fontSize', '');
    if (styleProp === 'fontFamily') return _stylePatch('fontFamily', '');
    if (styleProp === 'webkitTextStrokeColor') return _stylePatch('textStrokeColor', '');
    if (styleProp === 'webkitTextStrokeWidth') return _stylePatch('textStrokeWidth', '');
    if (styleProp === 'textDecorationLine') return _stylePatch('underline', false);
    return { [styleProp]: '' };
  }

  function _wrapSelectionWithStyle(patch) {
    if (!_restoreSelection()) return;
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount || sel.isCollapsed) return;
    const range = sel.getRangeAt(0);
    const span = document.createElement('span');
    Object.assign(span.style, patch);
    _captureUndoBeforeFormat(_savedRoot);
    try {
      range.surroundContents(span);
    } catch {
      const contents = range.extractContents();
      span.appendChild(contents);
      range.insertNode(span);
    }
    sel.removeAllRanges();
    const nextRange = document.createRange();
    nextRange.selectNodeContents(span);
    sel.addRange(nextRange);
    _savedRange = nextRange.cloneRange();
    _savedRoot?.dispatchEvent?.(new Event('input', { bubbles: true }));
  }

  function _clearSelectionStyle(styleProp) {
    _wrapSelectionWithStyle(_clearStylePatch(styleProp));
  }

  function _selectionClipboardButton(iconName, label, command) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'gb-fmt-btn gb-text-selection-clipboard-btn';
    btn.title = label;
    btn.setAttribute('aria-label', label);
    btn.innerHTML = typeof lucide === 'function' ? lucide(iconName, 14) : label;
    btn.addEventListener('pointerdown', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      _suppressUntil = Date.now() + 800;
    });
    btn.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      void _runClipboardCommand(command);
    });
    return btn;
  }

  function _selectionClipboardRow() {
    const row = document.createElement('div');
    row.className = 'gb-text-selection-clipboard-row';
    row.append(
      _selectionClipboardButton('copy', 'コピー', 'copy'),
      _selectionClipboardButton('scissors', '切り取り', 'cut'),
      _selectionClipboardButton('clipboardPaste', '貼り付け', 'paste'),
    );
    return row;
  }

  // シナリオのテキストセル選択なら、対象エディタ（ルビ挿入APIを持つもの）を返す
  function _scriptnoteRubyEditor(root) {
    if (!root?.matches?.('.sn2-text[contenteditable="true"]')) return null;
    if (typeof getActiveScriptNoteComponent !== 'function') return null;
    const ed = getActiveScriptNoteComponent()?._editor;
    if (!ed || typeof ed._applyRubyToSelection !== 'function') return null;
    if (!ed.host?.contains?.(root)) return null;
    return ed;
  }

  function _focusSavedRoot() {
    const root = _savedRoot;
    if (!root?.isConnected) return;
    const doFocus = () => {
      // 遅延実行の間に別のポップアップ等がフォーカスを取った場合は奪い返さない
      const ae = document.activeElement;
      if (ae && ae !== document.body && ae !== root && !root.contains(ae)) return;
      try { root.focus({ preventScroll: true }); } catch { try { root.focus(); } catch {} }
    };
    doFocus();
    requestAnimationFrame(doFocus);
  }

  // ルビ入力行（シナリオのテキストセル選択時のみ書式設定ポップアップへ表示）
  // 1行目: ラベル+入力欄+追加 / 2行目: 読み取得+自動ルビルール（追加ボタンの後で改行する）
  function _selectionRubyRow(root) {
    if (!_scriptnoteRubyEditor(root)) return null;
    const row = document.createElement('div');
    row.className = 'gb-text-selection-ruby-row';
    row.dataset.e2eId = 'sn2-ruby-row';
    const label = document.createElement('span');
    label.className = 'gb-fmt-label';
    label.textContent = 'ルビ';
    label.title = '選択した文字にルビを追加します';
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'gb-fmt-text gb-text-selection-ruby-input';
    input.dataset.e2eId = 'sn2-ruby-input';
    input.placeholder = 'ルビを入力...';
    input.setAttribute('aria-label', '選択文字のルビ');
    // 開くたびに自動フォーカスされるため、フォーカス由来のツールチップは出さない
    input.setAttribute('data-gb-tooltip-disabled', 'true');
    const okButton = document.createElement('button');
    okButton.type = 'button';
    okButton.className = 'gb-btn gb-btn-sm gb-btn-primary primary gb-text-selection-ruby-ok';
    okButton.dataset.e2eId = 'sn2-ruby-ok';
    okButton.textContent = '追加';
    const autoButton = document.createElement('button');
    autoButton.type = 'button';
    autoButton.className = 'gb-btn gb-btn-sm gb-btn-quiet gb-text-selection-ruby-auto';
    autoButton.dataset.e2eId = 'sn2-ruby-auto';
    autoButton.textContent = '読み取得';
    const addRuleLabel = document.createElement('label');
    addRuleLabel.className = 'gb-check gb-text-selection-ruby-check';
    addRuleLabel.dataset.e2eId = 'sn2-ruby-add-rule-label';
    const addRuleInput = document.createElement('input');
    addRuleInput.type = 'checkbox';
    addRuleInput.className = 'gb-checkbox';
    addRuleInput.dataset.e2eId = 'sn2-ruby-add-rule';
    const addRuleText = document.createElement('span');
    addRuleText.textContent = '自動ルビルールにも追加';
    addRuleLabel.append(addRuleInput, addRuleText);
    const applyRuby = () => {
      const ruby = input.value.trim();
      const ed = _scriptnoteRubyEditor(root);
      _suppressUntil = Date.now() + 400;
      if (ruby && ed && _restoreSelection()) {
        const sel = window.getSelection();
        if (sel?.rangeCount && !sel.isCollapsed) {
          ed._applyRubyToSelection(sel.getRangeAt(0), root, ruby, addRuleInput.checked);
        }
      }
      _closeSelectionPopup();
      _focusSavedRoot();
    };
    okButton.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      applyRuby();
    });
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        ev.stopPropagation();
        applyRuby();
      }
    });
    autoButton.addEventListener('click', async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const text = String(_savedRange?.toString?.() || '').trim();
      if (!text) return;
      try {
        const res = await apiFetch('/ruby?text=' + encodeURIComponent(text));
        if (res?.ruby) input.value = res.ruby;
        else if (typeof showStatus === 'function') showStatus('自動ルビの取得に失敗しました', true);
      } catch (err) {
        if (typeof showStatus === 'function') showStatus('自動ルビエラー: ' + err.message, true);
      }
    });
    const mainLine = document.createElement('div');
    mainLine.className = 'gb-text-selection-ruby-line';
    mainLine.append(label, input, okButton);
    const optionLine = document.createElement('div');
    optionLine.className = 'gb-text-selection-ruby-line';
    optionLine.append(autoButton, addRuleLabel);
    row.append(mainLine, optionLine);
    return row;
  }

  async function _runClipboardCommand(command) {
    if (!_restoreSelection()) return;
    const root = _savedRoot;
    if (command === 'cut' || command === 'paste') _captureUndoBeforeFormat(root);
    let changed = command === 'cut' || command === 'paste';
    try {
      if (command === 'paste') {
        let text = '';
        try {
          if (navigator.clipboard?.readText) text = await navigator.clipboard.readText();
        } catch {}
        if (text) document.execCommand('insertText', false, text);
        else document.execCommand('paste');
      } else {
        document.execCommand(command);
      }
    } catch (err) {
      changed = false;
      if (typeof showStatus === 'function') showStatus(labelForClipboardCommand(command) + 'できませんでした', true);
    } finally {
      const sel = window.getSelection();
      if (sel?.rangeCount) _savedRange = sel.getRangeAt(0).cloneRange();
      if (changed) root?.dispatchEvent?.(new Event('input', { bubbles: true }));
      _suppressUntil = Date.now() + 250;
    }
  }

  function labelForClipboardCommand(command) {
    if (command === 'copy') return 'コピー';
    if (command === 'cut') return '切り取り';
    if (command === 'paste') return '貼り付け';
    return '操作';
  }

  function _openForSelection(opts = {}) {
    const force = !!opts.force;
    if (_isCloudMobileEditingUiActive()) {
      _closeSelectionPopup();
      return;
    }
    if (!force && Date.now() < _suppressUntil) return;
    if (force) _suppressUntil = 0;
    // ポップアップ内の入力欄（ルビ等）を操作中は、selectionchange で閉じ直さない
    if (!force) {
      const openPopup = document.querySelector('.' + POPUP_CLASS);
      if (openPopup && openPopup.contains(document.activeElement)) return;
    }
    if (typeof openFormatPopup !== 'function') return;
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount || sel.isCollapsed) {
      _closeSelectionPopup();
      return;
    }
    const range = sel.getRangeAt(0);
    const root = _allowedRootFromRange(range);
    const rect = root ? _rangeRect(range) : null;
    if (!root || !rect) {
      _closeSelectionPopup();
      return;
    }
    _savedRoot = root;
    _savedRange = range.cloneRange();
    const anchor = { getBoundingClientRect: () => rect };
    const rubyRow = _selectionRubyRow(root);
    const popup = openFormatPopup(anchor, {
      fields: FIELDS,
      values: _computedValues(range),
      className: POPUP_CLASS,
      closeOnOutside: true,
      avoidRect: _rangeAvoidRect(range),
      focusTarget: root,
      extraRowTop: [rubyRow].filter(Boolean),
      extraRow2: [_selectionClipboardRow()],
      onChange(prop, value) {
        const normalized = prop === 'bold' ? 'fontWeight'
          : prop === 'italic' ? 'fontStyle'
          : prop;
        if (normalized === 'bgColor' && _isTransparentColor(value)) {
          _clearSelectionStyle('backgroundColor');
          return;
        }
        _wrapSelectionWithStyle(_stylePatch(normalized, value));
      },
    });
    popup?.setAttribute?.('role', 'dialog');
    popup?.setAttribute?.('aria-label', '選択範囲の書式設定');
    // ルビ入力欄を初期フォーカスにする（2026-07-18 ユーザー指示）。
    // ドラッグ選択中・Shift+矢印での選択拡張中はフォーカスを奪うと選択操作が
    // 途切れるため、操作が終わったタイミング（pointerup / Shift解放）の再表示で当てる
    if (rubyRow && (opts.focusRuby || (!_pointerSelecting && !_shiftSelecting))) {
      const rubyInput = popup?.querySelector?.('[data-e2e-id="sn2-ruby-input"]');
      if (rubyInput) {
        try { rubyInput.focus({ preventScroll: true }); } catch { rubyInput.focus(); }
      }
    }
  }

  function _schedule() {
    clearTimeout(_timer);
    _timer = setTimeout(_openForSelection, 90);
  }

  document.addEventListener('selectionchange', _schedule);
  // Escape は共通ポップアップの汎用ハンドラより先（登録順）に受けて、編集中セルへ
  // フォーカスを戻して閉じる（ルビ入力欄などフォーカスがポップアップ内にある場合の復帰経路）
  document.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Escape') return;
    if (!document.querySelector('.' + POPUP_CLASS)) return;
    ev.preventDefault();
    ev.stopImmediatePropagation();
    if (typeof closeAllPalettePopups === 'function') closeAllPalettePopups();
    if (typeof closeAllFormatPopups === 'function') closeAllFormatPopups();
    else _closeSelectionPopup();
    _suppressUntil = Date.now() + 250;
    _focusSavedRoot();
  }, true);
  // ポップアップ表示中の Tab / Shift+Tab はポップアップ内の項目切り替えに割り当てる
  // （編集セル側の Tab 動作＝タイプ選択メニュー等より優先する）。
  // ルビ行が無いポップアップ（ノート本文などの選択書式のみ）は、フォーカスが
  // ポップアップ内にある時だけ切り替え、編集エリア側の Tab 動作（インデント等）を保つ
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Shift') _shiftSelecting = true;
    if (ev.key !== 'Tab') return;
    const popup = document.querySelector('.' + POPUP_CLASS);
    if (!popup) return;
    const hasRubyRow = !!popup.querySelector('[data-e2e-id="sn2-ruby-row"]');
    if (!hasRubyRow && !popup.contains(document.activeElement)) return;
    ev.preventDefault();
    ev.stopImmediatePropagation();
    if (typeof gbCyclePopupFocus === 'function') gbCyclePopupFocus(popup, ev.shiftKey);
  }, true);
  document.addEventListener('pointerdown', (ev) => {
    if (ev.button === 0 && !ev.target?.closest?.('.gb-fmt-popup, .gb-palette-popup')) _pointerSelecting = true;
  }, true);
  document.addEventListener('pointerup', () => { _pointerSelecting = false; }, true);
  document.addEventListener('pointercancel', () => { _pointerSelecting = false; }, true);
  // ウィンドウ非アクティブ化で keyup / pointerup を取りこぼしても状態を残さない
  window.addEventListener('blur', () => { _pointerSelecting = false; _shiftSelecting = false; });
  document.addEventListener('mouseup', _schedule, true);
  document.addEventListener('keyup', (ev) => {
    const key = String(ev?.key || '');
    if (key === 'Shift') _shiftSelecting = false;
    if (key.startsWith('Arrow') || key === 'Shift' || key === 'Home' || key === 'End') _schedule();
  }, true);
  document.addEventListener('pointerdown', (ev) => {
    if (ev.target?.closest?.('.gb-fmt-popup, .gb-palette-popup')) _suppressUntil = Date.now() + 800;
  }, true);
  document.addEventListener('contextmenu', () => {
    _suppressUntil = Date.now() + 800;
    clearTimeout(_timer);
    _closeSelectionPopup();
  }, true);

  function _contextSelectionText(target) {
    const input = target?.closest?.('textarea,input[type="text"],input[type="search"],input[type="url"],input[type="email"]');
    if (input && typeof input.selectionStart === 'number' && input.selectionEnd > input.selectionStart) {
      return String(input.value || '').slice(input.selectionStart, input.selectionEnd).trim();
    }
    const sel = window.getSelection?.();
    const text = String(sel?.toString?.() || '').trim();
    if (!text || !sel?.rangeCount) return '';
    const range = sel.getRangeAt(0);
    return _rangeIntersectsNode(range, target) ? text : '';
  }

  function _contextImageUrl(target) {
    const img = target?.closest?.('img');
    if (img?.currentSrc || img?.src) {
      try { return new URL(img.currentSrc || img.src, location.href).href; } catch { return img.currentSrc || img.src || ''; }
    }
    const el = _nodeElement(target);
    const bg = _computedStyleFor(el)?.backgroundImage || '';
    const match = bg.match(/url\(["']?(.+?)["']?\)/);
    if (!match) return '';
    try { return new URL(match[1], location.href).href; } catch { return match[1] || ''; }
  }

  function _openGoogleUrl(url) {
    const win = window.open(url, '_blank', 'noopener');
    if (win) win.opener = null;
  }

  function _restoreGoogleContextFocus(target) {
    const focusTarget = target?.closest?.('[contenteditable="true"], textarea, input, button, [tabindex]');
    if (!focusTarget?.isConnected || typeof focusTarget.focus !== 'function') return;
    try { focusTarget.focus({ preventScroll: true }); } catch { try { focusTarget.focus(); } catch {} }
  }

  function _googleContextItems(menu) {
    return Array.from(menu?.querySelectorAll?.('.gb-context-menu-item:not(:disabled)') || [])
      .filter(item => {
        if (!(item instanceof HTMLElement) || item.classList.contains('disabled')) return false;
        const rect = item.getBoundingClientRect();
        const style = getComputedStyle(item);
        return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
      });
  }

  function _focusGoogleContextItem(menu, direction) {
    const items = _googleContextItems(menu);
    if (!items.length) return;
    const current = items.indexOf(document.activeElement);
    const next = direction === 'first'
      ? 0
      : direction === 'last'
        ? items.length - 1
        : (Math.max(0, current) + direction + items.length) % items.length;
    items[next]?.focus?.();
  }

  function _googleContextActions(ev) {
    const target = ev?.target;
    const text = _contextSelectionText(target);
    const imageUrl = _contextImageUrl(target);
    const actions = [];
    if (text) {
      actions.push({
        label: 'Googleで検索',
        icon: 'search',
        run: () => _openGoogleUrl('https://www.google.com/search?q=' + encodeURIComponent(text)),
      });
    }
    if (imageUrl) {
      actions.push({
        label: 'Googleで画像検索',
        icon: 'scanSearch',
        run: () => _openGoogleUrl('https://www.google.com/searchbyimage?image_url=' + encodeURIComponent(imageUrl)),
      });
    }
    return actions;
  }

  function _appendGoogleContextItems(menu, actions) {
    if (!menu || menu.querySelector?.('[data-gb-google-context="1"]')) return;
    if (menu.childElementCount) {
      const sep = document.createElement('div');
      sep.className = 'gb-context-menu-sep';
      sep.dataset.gbGoogleContext = '1';
      sep.setAttribute('role', 'separator');
      menu.appendChild(sep);
    }
    actions.forEach(action => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'gb-context-menu-item';
      item.dataset.gbGoogleContext = '1';
      item.setAttribute('role', 'menuitem');
      item.setAttribute('aria-label', action.label);
      if (typeof lucide === 'function') {
        const icon = document.createElement('span');
        icon.className = 'menu-icon';
        icon.setAttribute('aria-hidden', 'true');
        icon.innerHTML = lucide(action.icon, 14);
        item.appendChild(icon);
      }
      const label = document.createElement('span');
      label.className = 'menu-label';
      label.textContent = action.label;
      item.appendChild(label);
      item.addEventListener('click', (clickEv) => {
        clickEv.preventDefault();
        clickEv.stopPropagation();
        if (typeof menu._gbGoogleContextClose === 'function') menu._gbGoogleContextClose(false);
        else document.querySelectorAll('.gb-context-menu').forEach(el => el.remove());
        action.run();
      });
      menu.appendChild(item);
    });
  }

  function _showGoogleContextMenu(ev, actions) {
    document.querySelectorAll('.gb-google-context-menu').forEach(el => {
      if (typeof el._gbGoogleContextClose === 'function') el._gbGoogleContextClose(false);
      else el.remove();
    });
    if (typeof closeColHeaderMenu === 'function') closeColHeaderMenu();
    if (typeof closeAllDropdowns === 'function') closeAllDropdowns();
    const sourceTarget = ev?.target;
    const menu = document.createElement('div');
    menu.className = 'gb-context-menu gb-google-context-menu';
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', 'Google検索メニュー');
    _appendGoogleContextItems(menu, actions);
    const cleanup = { pointer: null, key: null };
    const close = (restoreFocus = true) => {
      menu.remove();
      if (cleanup.pointer) document.removeEventListener('pointerdown', cleanup.pointer);
      if (cleanup.key) menu.removeEventListener('keydown', cleanup.key);
      if (restoreFocus) _restoreGoogleContextFocus(sourceTarget);
    };
    menu._gbGoogleContextClose = close;
    document.body.appendChild(menu);
    if (typeof positionPopup === 'function') {
      positionPopup(menu, { left: ev.clientX, right: ev.clientX, top: ev.clientY, bottom: ev.clientY });
    } else {
      const z = typeof _getZoom === 'function' ? _getZoom() : 1;
      menu.style.position = 'fixed';
      menu.style.left = (ev.clientX / z) + 'px';
      menu.style.top = (ev.clientY / z) + 'px';
      if (typeof clampPopupToViewport === 'function') clampPopupToViewport(menu);
    }
    setTimeout(() => {
      cleanup.pointer = (downEv) => {
        if (!menu.contains(downEv.target)) {
          close(true);
        }
      };
      cleanup.key = (keyEv) => {
        if (keyEv.key === 'Escape') {
          keyEv.preventDefault();
          close(true);
          return;
        }
        if (keyEv.key === 'ArrowDown') {
          keyEv.preventDefault();
          _focusGoogleContextItem(menu, 1);
        } else if (keyEv.key === 'ArrowUp') {
          keyEv.preventDefault();
          _focusGoogleContextItem(menu, -1);
        } else if (keyEv.key === 'Home') {
          keyEv.preventDefault();
          _focusGoogleContextItem(menu, 'first');
        } else if (keyEv.key === 'End') {
          keyEv.preventDefault();
          _focusGoogleContextItem(menu, 'last');
        }
      };
      document.addEventListener('pointerdown', cleanup.pointer);
      menu.addEventListener('keydown', cleanup.key);
      _focusGoogleContextItem(menu, 'first');
    }, 0);
  }

  document.addEventListener('contextmenu', (ev) => {
    const actions = _googleContextActions(ev);
    if (!actions.length) return;
    if (ev.defaultPrevented) {
      setTimeout(() => {
        const menus = Array.from(document.querySelectorAll('.gb-context-menu'))
          .filter(menu => !menu.classList.contains('gb-google-context-menu') && menu.isConnected);
        _appendGoogleContextItems(menus[menus.length - 1], actions);
      }, 0);
      return;
    }
    ev.preventDefault();
    _showGoogleContextMenu(ev, actions);
  });

  window.GBTextSelectionFormat = {
    openForSelection: _openForSelection,
    close: _closeSelectionPopup,
  };
})();
