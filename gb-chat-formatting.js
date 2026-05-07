/* gb-chat-formatting.js: chat input and user bubble formatting popup */
(function () {
  'use strict';

  const POPUP_CLASS = 'gb-chat-format-popup';
  const RICH_INPUT_ID = 'chat-rich-input';
  const RICH_INPUT_CLASS = 'chat-rich-input';
  const HIDDEN_INPUT_CLASS = 'chat-plain-input-hidden';
  const FORMAT_FIELDS = [
    'textColor', 'bgColor', 'fontSize', 'fontFamily',
    'bold', 'italic', 'underline', 'strike',
  ];

  let _activeTarget = null;
  let _timer = null;
  let _suppressUntil = 0;
  let _updatingFromRich = false;
  let _updatingFromPlain = false;
  let _lastInputSelection = null;
  let _richVerticalColumn = null;
  const INPUT_NAVIGATION_KEYS = new Set(['Home', 'End', 'PageUp', 'PageDown']);

  function _chatInput() {
    if (typeof _chatLiveElement === 'function') {
      const live = _chatLiveElement('chat-input');
      if (live) return live;
    }
    return document.getElementById('chat-input');
  }

  function _chatRichInput() {
    const input = _chatInput();
    const editor = document.getElementById(RICH_INPUT_ID);
    if (!input || !editor || editor.dataset.sourceInputId !== input.id) return null;
    return editor;
  }

  function _chatInputSurface() {
    return _chatRichInput() || _chatInput();
  }

  function _chatStateRef() {
    return typeof _chatState === 'undefined' ? null : _chatState;
  }

  function _closePopup() {
    document.querySelectorAll('.' + POPUP_CLASS).forEach(el => el.remove());
    _activeTarget = null;
  }

  function _isTransparentColor(value) {
    const raw = String(value || '').trim().toLowerCase().replace(/\s+/g, '');
    return !raw || raw === 'transparent' || raw === 'rgba(0,0,0,0)' || raw === 'rgba(0,0,0,0.0)';
  }

  function _nodeElement(node) {
    if (!node) return null;
    return node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
  }

  function _isFormatPopupSurface(el) {
    return !!el?.closest?.('.gb-fmt-popup, .gb-palette-popup');
  }

  function _isFormatPopupInteraction(event) {
    return _isFormatPopupSurface(event?.target) || _isFormatPopupSurface(document.activeElement);
  }

  function _eventRect(event) {
    const x = Number(event?.clientX || 0);
    const y = Number(event?.clientY || 0);
    return { left: x, top: y, right: x, bottom: y, width: 0, height: 0 };
  }

  function _selectionRect(range, fallbackEl) {
    const rects = range ? Array.from(range.getClientRects()).filter(r => r.width || r.height) : [];
    if (rects.length) return rects[0];
    const rect = range?.getBoundingClientRect?.();
    if (rect && (rect.width || rect.height)) return rect;
    return fallbackEl?.getBoundingClientRect?.() || null;
  }

  function _computedValues(el) {
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
      underline: String(cs?.textDecorationLine || '').includes('underline'),
      strike: String(cs?.textDecorationLine || '').includes('line-through'),
    };
  }

  function _clampRange(text, start, end) {
    const len = String(text || '').length;
    const a = Math.max(0, Math.min(len, Number(start) || 0));
    const b = Math.max(0, Math.min(len, Number(end) || 0));
    return { start: Math.min(a, b), end: Math.max(a, b) };
  }

  function _lineRange(text, start, end) {
    const source = String(text || '');
    const range = _clampRange(source, start, end);
    let lineStart = source.lastIndexOf('\n', Math.max(0, range.start - 1)) + 1;
    let lineEnd = source.indexOf('\n', range.end);
    if (lineEnd < 0) lineEnd = source.length;
    return { start: lineStart, end: lineEnd };
  }

  function _headingLevelAt(text, start) {
    const source = String(text || '');
    const range = _lineRange(source, start, start);
    const line = source.slice(range.start, range.end);
    const match = line.match(/^\s{0,3}(#{1,6})\s+/);
    return match ? match[1].length : 0;
  }

  function _applyHeading(text, start, end, level) {
    const source = String(text || '');
    const target = _lineRange(source, start, end);
    const nextLevel = Math.max(0, Math.min(6, Number(level) || 0));
    const block = source.slice(target.start, target.end);
    const lines = block.split('\n').map(line => {
      const body = line.replace(/^\s{0,3}#{1,6}\s+/, '');
      return nextLevel > 0 ? '#'.repeat(nextLevel) + ' ' + body : body;
    });
    const replacement = lines.join('\n');
    return {
      text: source.slice(0, target.start) + replacement + source.slice(target.end),
      start: target.start,
      end: target.start + replacement.length,
    };
  }

  function _safeColor(value) {
    const raw = String(value || '').trim();
    if (/^#[0-9a-f]{3,8}$/i.test(raw)) return raw;
    if (/^rgba?\(\s*[\d.]+%?\s*,\s*[\d.]+%?\s*,\s*[\d.]+%?(?:\s*,\s*(?:0|1|0?\.\d+))?\s*\)$/i.test(raw)) return raw;
    return '';
  }

  function _safeFontFamily(value) {
    const raw = String(value || '').trim().replace(/"/g, "'");
    if (!raw || /url\s*\(|expression\s*\(|[<>[\]]/.test(raw)) return '';
    return /^[\w\s.,'"()-]+$/.test(raw) ? raw : '';
  }

  function _appendRichText(parent, text) {
    if (text) parent.appendChild(document.createTextNode(text));
  }

  function _styleAttrsFromElement(el) {
    const style = el?.style;
    const attrs = [];
    const color = _safeColor(style?.color || '');
    const bg = _safeColor(style?.backgroundColor || '');
    const size = parseInt(style?.fontSize || '', 10);
    const font = _safeFontFamily(style?.fontFamily || '');
    if (color) attrs.push(`color="${color}"`);
    if (bg) attrs.push(`bg="${bg}"`);
    if (Number.isFinite(size) && size > 0) attrs.push(`size="${Math.max(8, Math.min(96, size))}"`);
    if (font) attrs.push(`font="${font}"`);
    return attrs.join(' ');
  }

  function _applyStyleAttrs(span, rawAttrs) {
    String(rawAttrs || '').replace(/([a-z]+)="([^"]*)"/gi, (_, key, value) => {
      const name = String(key || '').toLowerCase();
      if (name === 'color') {
        const color = _safeColor(value);
        if (color) span.style.color = color;
      } else if (name === 'bg') {
        const color = _safeColor(value);
        if (color) span.style.backgroundColor = color;
      } else if (name === 'size') {
        const size = Math.max(8, Math.min(96, Number(value) || 0));
        if (size) span.style.fontSize = size + 'px';
      } else if (name === 'font') {
        const font = _safeFontFamily(value);
        if (font) span.style.fontFamily = font;
      }
      return '';
    });
    return span;
  }

  function _appendRichInline(parent, text) {
    let i = 0;
    let buffer = '';
    const source = String(text || '');
    const flush = () => {
      if (!buffer) return;
      _appendRichText(parent, buffer);
      buffer = '';
    };
    const wrap = (tag, startToken, endToken, offset) => {
      const end = source.indexOf(endToken, i + offset);
      if (end <= i) return false;
      flush();
      const el = document.createElement(tag);
      _appendRichInline(el, source.slice(i + offset, end));
      parent.appendChild(el);
      i = end + endToken.length;
      return true;
    };

    while (i < source.length) {
      const rest = source.slice(i);
      if (rest.startsWith('**') && wrap('strong', '**', '**', 2)) continue;
      if (rest.startsWith('~~') && wrap('del', '~~', '~~', 2)) continue;
      if (rest.startsWith('[u]') && wrap('u', '[u]', '[/u]', 3)) continue;
      const styleOpen = rest.match(/^\[style\s+([^\]]{1,240})\]/i);
      if (styleOpen) {
        const end = source.indexOf('[/style]', i + styleOpen[0].length);
        if (end > i) {
          flush();
          const span = _applyStyleAttrs(document.createElement('span'), styleOpen[1]);
          _appendRichInline(span, source.slice(i + styleOpen[0].length, end));
          parent.appendChild(span);
          i = end + 8;
          continue;
        }
      }
      if (rest.startsWith('*') && !rest.startsWith('**') && wrap('em', '*', '*', 1)) continue;
      if (rest.startsWith('`') && wrap('code', '`', '`', 1)) continue;
      buffer += source[i];
      i += 1;
    }
    flush();
  }

  function _setRichInputContentState(editor, value) {
    if (!editor) return;
    const hasContent = String(value || '').replace(/\u200b/g, '').length > 0;
    if (hasContent) editor.dataset.hasContent = '1';
    else editor.removeAttribute('data-has-content');
  }

  function _isRichInputEmpty(editor) {
    const input = _chatInput();
    return !!editor && !String(input?.value || '').replace(/\u200b/g, '').length;
  }

  function _setRichCaretAtStart(editor) {
    if (!editor) return;
    const range = document.createRange();
    range.setStart(editor, 0);
    range.collapse(true);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    editor.focus();
  }

  function _focusEmptyRichInputAtStart(event, editor) {
    if (event?.button != null && event.button !== 0) return false;
    if (!_isRichInputEmpty(editor)) return false;
    event?.preventDefault?.();
    _richVerticalColumn = null;
    _setRichCaretAtStart(editor);
    return true;
  }

  function _richInputBlocks(editor) {
    return Array.from(editor?.childNodes || []).filter(node => node.nodeType === Node.ELEMENT_NODE);
  }

  function _richDirectBlock(editor, node) {
    if (!editor || !node) return null;
    if (node === editor) return null;
    let el = _nodeElement(node);
    while (el && el.parentElement !== editor) el = el.parentElement;
    return el?.parentElement === editor ? el : null;
  }

  function _sourceLineStarts(source) {
    const text = String(source || '');
    const starts = [0];
    for (let i = 0; i < text.length; i += 1) {
      if (text[i] === '\n') starts.push(i + 1);
    }
    return starts;
  }

  function _linePositionForSourceIndex(source, sourceIndex) {
    const text = String(source || '');
    const index = Math.max(0, Math.min(text.length, Number(sourceIndex) || 0));
    let line = 0;
    let lineStart = 0;
    while (lineStart <= text.length) {
      const newline = text.indexOf('\n', lineStart);
      const lineEnd = newline < 0 ? text.length : newline;
      if (index <= lineEnd || newline < 0) return { line, offset: index - lineStart };
      line += 1;
      lineStart = newline + 1;
    }
    return { line, offset: 0 };
  }

  function _visibleOffsetInBlock(block, container, offset) {
    if (!block) return 0;
    try {
      const range = document.createRange();
      range.selectNodeContents(block);
      range.setEnd(container, offset);
      const length = range.toString().length;
      range.detach?.();
      return Math.max(0, length);
    } catch {
      return 0;
    }
  }

  function _sourceOffsetFromLineVisibleOffset(lineSource, visibleOffset) {
    const mapped = _sourceRangeFromVisibleOffsets(
      String(lineSource || ''),
      { start: visibleOffset, end: visibleOffset },
      true,
    );
    return mapped ? mapped.start : Math.max(0, Math.min(String(lineSource || '').length, Number(visibleOffset) || 0));
  }

  function _richDomPointSourceIndex(editor, source, container, offset) {
    const blocks = _richInputBlocks(editor);
    if (!blocks.length) {
      if (container === editor || editor.contains(_nodeElement(container))) {
        return Math.max(0, Math.min(String(source || '').length, _visibleOffsetInBlock(editor, container, offset)));
      }
      return 0;
    }
    const lines = String(source || '').split('\n');
    const starts = _sourceLineStarts(source);
    if (container === editor) {
      const childIndex = Math.max(0, Math.min(blocks.length, Number(offset) || 0));
      if (childIndex >= blocks.length) {
        const lastLine = lines[blocks.length - 1] || '';
        return (starts[blocks.length - 1] || 0) + lastLine.length;
      }
      return starts[childIndex] || 0;
    }
    const block = _richDirectBlock(editor, container);
    const blockIndex = blocks.indexOf(block);
    if (blockIndex < 0) return 0;
    const visibleOffset = _visibleOffsetInBlock(block, container, offset);
    const lineSource = lines[blockIndex] || '';
    return (starts[blockIndex] || 0) + _sourceOffsetFromLineVisibleOffset(lineSource, visibleOffset);
  }

  function _richSelectionSourceRange(editor, allowCollapsed = false, sourceOverride = null) {
    const input = _chatInput();
    const selection = window.getSelection();
    if (!editor || !input || !selection || !selection.rangeCount || (!allowCollapsed && selection.isCollapsed)) return null;
    const range = selection.getRangeAt(0);
    if (!editor.contains(_nodeElement(range.commonAncestorContainer))) return null;
    const source = (sourceOverride == null ? String(input.value || '') : String(sourceOverride)).replace(/\r\n?/g, '\n');
    const start = _richDomPointSourceIndex(editor, source, range.startContainer, range.startOffset);
    const end = _richDomPointSourceIndex(editor, source, range.endContainer, range.endOffset);
    return { start: Math.min(start, end), end: Math.max(start, end) };
  }

  function _richDomPositionForSourceIndex(editor, source, sourceIndex) {
    const blocks = _richInputBlocks(editor);
    if (!blocks.length) return { node: editor, offset: 0 };
    const lines = String(source || '').split('\n');
    const linePos = _linePositionForSourceIndex(source, sourceIndex);
    const lineIndex = Math.max(0, Math.min(blocks.length - 1, linePos.line));
    const lineSource = lines[lineIndex] || '';
    const visibleOffset = _visibleOffsetForSourceIndex(lineSource, linePos.offset);
    return _textPositionAtVisibleOffset(blocks[lineIndex], visibleOffset);
  }

  function _renderRichInputFromSource(selectionStart, selectionEnd) {
    const input = _chatInput();
    const editor = _chatRichInput();
    if (!input || !editor || _updatingFromRich) return;
    _updatingFromPlain = true;
    const source = String(input.value || '').replace(/\r\n?/g, '\n');
    _setRichInputContentState(editor, source);
    editor.innerHTML = '';
    if (!source) {
      _updatingFromPlain = false;
      return;
    }
    source.split('\n').forEach(line => {
      const heading = line.match(/^\s{0,3}(#{1,6})\s+(.*)$/);
      const block = document.createElement(heading ? 'h' + heading[1].length : 'div');
      block.className = 'chat-rich-input-line';
      _appendRichInline(block, heading ? heading[2] : line);
      if (!block.childNodes.length) block.appendChild(document.createElement('br'));
      editor.appendChild(block);
    });
    _updatingFromPlain = false;
    if (Number.isFinite(selectionStart)) {
      _setRichSelectionFromSourceRange(editor, source, selectionStart, Number.isFinite(selectionEnd) ? selectionEnd : selectionStart);
    }
  }

  function _serializeRichInline(node) {
    if (!node) return '';
    if (node.nodeType === Node.TEXT_NODE) return node.textContent || '';
    if (node.nodeType !== Node.ELEMENT_NODE) return '';
    const tag = node.nodeName.toLowerCase();
    if (tag === 'br') return '\n';
    const body = Array.from(node.childNodes).map(_serializeRichInline).join('');
    if (tag === 'strong' || tag === 'b') return `**${body}**`;
    if (tag === 'em' || tag === 'i') return `*${body}*`;
    if (tag === 'del' || tag === 's') return `~~${body}~~`;
    if (tag === 'u') return `[u]${body}[/u]`;
    if (tag === 'code') return '`' + body + '`';
    if (tag === 'span') {
      const attrs = _styleAttrsFromElement(node);
      return attrs ? `[style ${attrs}]${body}[/style]` : body;
    }
    return body;
  }

  function _serializeRichBlock(block) {
    if (!block) return '';
    if (block.nodeType === Node.TEXT_NODE) return block.textContent || '';
    const tag = block.nodeName ? block.nodeName.toLowerCase() : '';
    const body = Array.from(block.childNodes).map(_serializeRichInline).join('').replace(/\n+$/g, '');
    const heading = tag.match(/^h([1-6])$/);
    return heading ? '#'.repeat(Number(heading[1])) + ' ' + body : body;
  }

  function _richInputToMarkdown(editor) {
    if (!editor) return '';
    const blocks = Array.from(editor.childNodes);
    if (!blocks.length) return '';
    return blocks.map(_serializeRichBlock).join('\n').replace(/\u00a0/g, ' ');
  }

  function _syncPlainFromRich() {
    const input = _chatInput();
    const editor = _chatRichInput();
    if (!input || !editor || _updatingFromPlain) return;
    _updatingFromRich = true;
    const value = _richInputToMarkdown(editor);
    input.value = value;
    _setRichInputContentState(editor, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    _updatingFromRich = false;
  }

  function _insertPlainTextIntoRich(text) {
    const selection = window.getSelection();
    if (!selection || !selection.rangeCount) return false;
    selection.deleteFromDocument();
    selection.getRangeAt(0).insertNode(document.createTextNode(String(text || '')));
    selection.collapseToEnd();
    _syncPlainFromRich();
    return true;
  }

  function _textPositionAtVisibleOffset(root, offset) {
    const target = Math.max(0, Number(offset) || 0);
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let count = 0;
    let last = null;
    while (walker.nextNode()) {
      const node = walker.currentNode;
      last = node;
      const len = (node.textContent || '').length;
      if (count + len >= target) return { node, offset: Math.max(0, Math.min(len, target - count)) };
      count += len;
    }
    return last ? { node: last, offset: (last.textContent || '').length } : { node: root, offset: root.childNodes.length };
  }

  function _visibleOffsetForSourceIndex(source, sourceIndex) {
    const map = _mapVisibleChars(source);
    const target = Math.max(0, Number(sourceIndex) || 0);
    for (let i = 0; i < map.length; i += 1) {
      if (map[i] >= target) return i;
    }
    return map.length;
  }

  function _setRichSelectionByVisibleOffsets(root, start, end) {
    if (!root) return;
    const a = _textPositionAtVisibleOffset(root, start);
    const b = _textPositionAtVisibleOffset(root, end);
    const range = document.createRange();
    range.setStart(a.node, a.offset);
    range.setEnd(b.node, b.offset);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    root.focus();
  }

  function _setRichSelectionFromSourceRange(root, source, start, end) {
    if (!root) return;
    const a = _richDomPositionForSourceIndex(root, source, start);
    const b = _richDomPositionForSourceIndex(root, source, end);
    const range = document.createRange();
    range.setStart(a.node, a.offset);
    range.setEnd(b.node, b.offset);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    root.focus();
  }

  function _styleDescriptor(prop, value, selected) {
    const text = String(selected ?? '');
    const wrap = (prefix, suffix) => ({
      text: prefix + text + suffix,
      innerStart: prefix.length,
      innerEnd: prefix.length + text.length,
    });

    if (prop === 'fontWeight') return value === 'bold' ? wrap('**', '**') : null;
    if (prop === 'fontStyle') return value === 'italic' ? wrap('*', '*') : null;
    if (prop === 'strike') return value ? wrap('~~', '~~') : null;
    if (prop === 'underline') return value ? wrap('[u]', '[/u]') : null;

    let attr = '';
    if (prop === 'textColor') {
      const color = _safeColor(value);
      if (!color) return null;
      attr = `color="${color}"`;
    } else if (prop === 'bgColor') {
      const color = _safeColor(value);
      if (!color) return null;
      attr = `bg="${color}"`;
    } else if (prop === 'fontSize') {
      const size = Math.max(8, Math.min(96, Number(value) || 0));
      if (!size) return null;
      attr = `size="${size}"`;
    } else if (prop === 'fontFamily') {
      const font = _safeFontFamily(value);
      if (!font) return null;
      attr = `font="${font}"`;
    }
    return attr ? wrap(`[style ${attr}]`, '[/style]') : null;
  }

  function _replaceRange(source, start, end, replacement, innerStart, innerEnd) {
    const text = String(source || '');
    const range = _clampRange(text, start, end);
    const next = text.slice(0, range.start) + replacement + text.slice(range.end);
    return {
      text: next,
      start: range.start + innerStart,
      end: range.start + innerEnd,
    };
  }

  function _applyInputFormat(prop, value) {
    const input = _chatInput();
    if (!input) return;
    const target = _activeTarget?.kind === 'input'
      ? _activeTarget
      : { kind: 'input', start: input.selectionStart || 0, end: input.selectionEnd || 0 };
    const source = String(input.value || '');
    const range = _clampRange(source, target.start, target.end);
    const result = prop === 'heading'
      ? _applyHeading(source, range.start, range.end, value)
      : (() => {
          const selected = source.slice(range.start, range.end);
          const descriptor = _styleDescriptor(prop, value, selected);
          if (!descriptor) return null;
          return _replaceRange(source, range.start, range.end, descriptor.text, descriptor.innerStart, descriptor.innerEnd);
        })();
    if (!result) return;
    input.value = result.text;
    const editor = _chatRichInput();
    if (editor) _renderRichInputFromSource(result.start, result.end);
    else {
      input.focus();
      input.setSelectionRange(result.start, result.end);
    }
    _updatingFromPlain = true;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    _updatingFromPlain = false;
    _activeTarget = { kind: 'input', start: result.start, end: result.end };
  }

  function _messageContentString(index) {
    const message = _chatStateRef()?.messages?.[index];
    if (!message || typeof message.content !== 'string') return '';
    return message.content;
  }

  function _applyBubbleFormat(prop, value) {
    const target = _activeTarget?.kind === 'bubble' ? _activeTarget : null;
    if (!target) return;
    const state = _chatStateRef();
    if (state?.streaming) {
      if (typeof showStatus === 'function') showStatus('応答生成中は書式変更できません', true);
      return;
    }
    const message = state?.messages?.[target.index];
    if (!message || typeof message.content !== 'string') {
      if (typeof showStatus === 'function') showStatus('添付を含む発言はこの操作では書式変更できません', true);
      return;
    }
    const source = _messageContentString(target.index);
    const range = _clampRange(source, target.start, target.end);
    const result = prop === 'heading'
      ? _applyHeading(source, range.start, range.end, value)
      : (() => {
          const selected = source.slice(range.start, range.end);
          const descriptor = _styleDescriptor(prop, value, selected);
          if (!descriptor) return null;
          return _replaceRange(source, range.start, range.end, descriptor.text, descriptor.innerStart, descriptor.innerEnd);
        })();
    if (!result) return;
    message.content = result.text;
    _activeTarget = { kind: 'bubble', index: target.index, start: result.start, end: result.end };
    if (typeof _chatRenderStoredMessages === 'function') _chatRenderStoredMessages();
    if (typeof chatAutoSave === 'function') chatAutoSave({ silent: true }).catch(() => {});
  }

  function _applyFormat(prop, value) {
    const normalized = prop === 'bold' ? 'fontWeight'
      : prop === 'italic' ? 'fontStyle'
      : prop;
    if (_activeTarget?.kind === 'input') _applyInputFormat(normalized, value);
    else if (_activeTarget?.kind === 'bubble') _applyBubbleFormat(normalized, value);
  }

  function _makeHeadingControl(currentLevel) {
    const group = document.createElement('label');
    group.className = 'gb-fmt-popup-group';
    const label = document.createElement('span');
    label.className = 'gb-fmt-label';
    label.textContent = '見出し';
    const select = document.createElement('select');
    select.className = 'gb-fmt-sel';
    select.title = '見出し';
    [
      ['', '選択'],
      ['0', '本文'],
      ['1', 'H1'],
      ['2', 'H2'],
      ['3', 'H3'],
      ['4', 'H4'],
      ['5', 'H5'],
      ['6', 'H6'],
    ].forEach(([value, text]) => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = text;
      select.appendChild(option);
    });
    select.value = currentLevel ? String(currentLevel) : '';
    select.addEventListener('change', () => {
      if (select.value === '') return;
      _applyFormat('heading', select.value);
    });
    group.append(label, select);
    return group;
  }

  function _openPopup(target, rect, valueElement) {
    if (Date.now() < _suppressUntil) return;
    if (typeof openFormatPopup !== 'function' || !rect) return;
    _activeTarget = target;
    const anchor = { getBoundingClientRect: () => rect };
    const source = target.kind === 'input'
      ? String(_chatInput()?.value || '')
      : _messageContentString(target.index);
    openFormatPopup(anchor, {
      fields: FORMAT_FIELDS,
      values: _computedValues(valueElement),
      className: POPUP_CLASS,
      closeOnOutside: true,
      closeButton: false,
      extraRow3: [_makeHeadingControl(_headingLevelAt(source, target.start))],
      onChange: _applyFormat,
    });
  }

  function _copyIconHtml(size = 14) {
    if (typeof lucide === 'function') {
      try { return lucide('copy', size); } catch {}
    }
    return 'Copy';
  }

  async function _copyTextToClipboard(text) {
    const value = String(text || '');
    if (!value) return false;
    const chatCopy = typeof window !== 'undefined' && typeof window.GBChatCopyText === 'function'
      ? window.GBChatCopyText
      : (typeof _chatCopyText === 'function' ? _chatCopyText : null);
    if (chatCopy) {
      const ok = await chatCopy(value, '選択範囲をコピーしました');
      if (ok !== false) return true;
    }
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
        if (typeof showStatus === 'function') showStatus('選択範囲をコピーしました');
        return true;
      }
    } catch {}
    const ta = document.createElement('textarea');
    ta.value = value;
    ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch {}
    ta.remove();
    if (ok && typeof showStatus === 'function') showStatus('選択範囲をコピーしました');
    return ok;
  }

  function _chatCopyTargetFromSelection() {
    const selection = window.getSelection();
    if (!selection || !selection.rangeCount || selection.isCollapsed) return null;
    const text = String(selection.toString() || '');
    if (!text.trim()) return null;
    const range = selection.getRangeAt(0);
    const startEl = _nodeElement(range.startContainer);
    const endEl = _nodeElement(range.endContainer);
    const bubble = startEl?.closest?.('.chat-message-bubble')
      || endEl?.closest?.('.chat-message-bubble');
    if (!bubble || !bubble.closest?.('.chat-message-row')) return null;
    if ((startEl && !bubble.contains(startEl)) || (endEl && !bubble.contains(endEl))) return null;
    return { kind: 'copy', text, bubble, range };
  }

  function _openCopyPopup(target, rect) {
    if (Date.now() < _suppressUntil || !target?.text || !rect) return;
    _closePopup();
    _activeTarget = { kind: 'copy', text: target.text };
    const popup = document.createElement('div');
    popup.className = 'gb-fmt-popup ' + POPUP_CLASS + ' gb-chat-copy-popup';
    const row = document.createElement('div');
    row.className = 'gb-fmt-popup-row';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'gb-fmt-btn';
    btn.title = '選択範囲をコピー';
    btn.setAttribute('aria-label', '選択範囲をコピー');
    btn.innerHTML = _copyIconHtml(14) + '<span class="gb-fmt-label">コピー</span>';
    btn.addEventListener('click', async (event) => {
      event.preventDefault();
      event.stopPropagation();
      const ok = await _copyTextToClipboard(_activeTarget?.text || target.text);
      if (!ok && typeof showStatus === 'function') showStatus('コピーできませんでした', true);
      _suppressUntil = Date.now() + 350;
      popup.remove();
      _activeTarget = null;
    });
    row.appendChild(btn);
    popup.appendChild(row);
    document.body.appendChild(popup);
    const anchor = { getBoundingClientRect: () => rect };
    if (typeof positionPopup === 'function') positionPopup(popup, anchor.getBoundingClientRect());
    setTimeout(() => {
      const closeHandler = (event) => {
        if (!popup.contains(event.target)) {
          popup.remove();
          document.removeEventListener('pointerdown', closeHandler, true);
        }
      };
      document.addEventListener('pointerdown', closeHandler, true);
    }, 0);
  }

  function _inputTargetFromSelection(input, rect) {
    return {
      kind: 'input',
      start: input.selectionStart || 0,
      end: input.selectionEnd || 0,
      rect,
    };
  }

  function _richInputTargetFromSelection(editor, rect, allowCollapsed = true) {
    const input = _chatInput();
    if (!input || !editor) return null;
    const source = String(input.value || '');
    const selected = String(window.getSelection()?.toString() || '');
    if (!selected && allowCollapsed && _lastInputSelection?.source === source && Date.now() - _lastInputSelection.time < 1500) {
      return {
        kind: 'input',
        start: _lastInputSelection.start,
        end: _lastInputSelection.end,
        rect,
      };
    }
    let sourceRange = _richSelectionSourceRange(editor, allowCollapsed);
    if (selected && (!sourceRange || source.slice(sourceRange.start, sourceRange.end) !== selected)) {
      const start = source.indexOf(selected);
      if (start >= 0) sourceRange = { start, end: start + selected.length };
    }
    if (!sourceRange) return null;
    if (selected && sourceRange.end > sourceRange.start) {
      _lastInputSelection = { source, start: sourceRange.start, end: sourceRange.end, time: Date.now() };
    }
    return {
      kind: 'input',
      start: sourceRange.start,
      end: sourceRange.end,
      rect,
    };
  }

  function _rememberRichInputSelection() {
    const editor = _chatRichInput();
    const input = _chatInput();
    const selection = window.getSelection();
    if (!editor || !input || !selection || !selection.rangeCount || selection.isCollapsed) return;
    const range = selection.getRangeAt(0);
    if (!editor.contains(_nodeElement(range.commonAncestorContainer))) return;
    const source = String(input.value || '');
    const selected = String(selection.toString() || '');
    let sourceRange = _richSelectionSourceRange(editor, false);
    if (selected && (!sourceRange || source.slice(sourceRange.start, sourceRange.end) !== selected)) {
      const start = source.indexOf(selected);
      if (start >= 0) sourceRange = { start, end: start + selected.length };
    }
    if (sourceRange && sourceRange.end > sourceRange.start) {
      _lastInputSelection = { source, start: sourceRange.start, end: sourceRange.end, time: Date.now() };
    }
  }

  function _selectedTextInside(el) {
    const selection = window.getSelection();
    if (!selection || !selection.rangeCount || selection.isCollapsed) return '';
    const range = selection.getRangeAt(0);
    if (!el.contains(_nodeElement(range.commonAncestorContainer))) return '';
    return selection.toString();
  }

  function _selectionTextOffsetsIn(el, allowCollapsed = false) {
    const selection = window.getSelection();
    if (!selection || !selection.rangeCount || (!allowCollapsed && selection.isCollapsed)) return null;
    const range = selection.getRangeAt(0);
    if (!el.contains(_nodeElement(range.commonAncestorContainer))) return null;
    const textOffset = (container, offset) => {
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      let count = 0;
      while (walker.nextNode()) {
        const node = walker.currentNode;
        if (node === container) return count + Math.max(0, Math.min((node.textContent || '').length, offset));
        count += (node.textContent || '').length;
      }
      if (container.nodeType === Node.ELEMENT_NODE && el.contains(container)) {
        const probe = document.createRange();
        probe.selectNodeContents(el);
        probe.setEnd(container, offset);
        const length = probe.toString().length;
        probe.detach?.();
        return length;
      }
      return count;
    };
    return {
      start: textOffset(range.startContainer, range.startOffset),
      end: textOffset(range.endContainer, range.endOffset),
    };
  }

  function _mapVisibleChars(source) {
    const text = String(source || '').replace(/\r\n?/g, '\n');
    const map = [];
    let atLineStart = true;
    let i = 0;
    const addChar = (index) => {
      map.push(index);
      atLineStart = text[index] === '\n';
    };
    const addRange = (start, end) => {
      for (let n = start; n < end; n += 1) addChar(n);
    };
    const skipLinePrefix = () => {
      const rest = text.slice(i);
      const heading = rest.match(/^\s{0,3}#{1,6}\s+/);
      const quote = rest.match(/^\s*>\s?/);
      const list = rest.match(/^\s*(?:[-*+]|\d+\.)\s+/);
      const prefix = heading || quote || list;
      if (prefix) {
        i += prefix[0].length;
        return true;
      }
      return false;
    };
    const skipInlineOpen = (token, closeToken) => {
      if (!text.startsWith(token, i)) return false;
      const end = text.indexOf(closeToken, i + token.length);
      if (end < 0) return false;
      i += token.length;
      return true;
    };

    while (i < text.length) {
      if (atLineStart && skipLinePrefix()) continue;
      if (text.startsWith('```', i) && (i === 0 || text[i - 1] === '\n')) {
        const lineEnd = text.indexOf('\n', i);
        i = lineEnd < 0 ? text.length : lineEnd + 1;
        continue;
      }
      if (text.startsWith('**', i) || text.startsWith('~~', i)) {
        i += 2;
        continue;
      }
      if (text[i] === '*' || text[i] === '`') {
        i += 1;
        continue;
      }
      if (text.startsWith('[u]', i)) {
        i += 3;
        continue;
      }
      if (text.startsWith('[/u]', i)) {
        i += 4;
        continue;
      }
      const styleOpen = text.slice(i).match(/^\[style\s+[^\]]{1,240}\]/i);
      if (styleOpen) {
        i += styleOpen[0].length;
        continue;
      }
      if (text.startsWith('[/style]', i)) {
        i += 8;
        continue;
      }
      const wiki = text.slice(i).match(/^\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/);
      if (wiki) {
        const labelStart = wiki[2] ? i + wiki[0].indexOf('|') + 1 : i + 2;
        const label = wiki[2] || wiki[1];
        addRange(labelStart, labelStart + label.length);
        i += wiki[0].length;
        continue;
      }
      if (text.startsWith('![', i)) {
        const closeBracket = text.indexOf(']', i + 2);
        if (closeBracket > i && text[closeBracket + 1] === '(') {
          const closeParen = text.indexOf(')', closeBracket + 2);
          if (closeParen > closeBracket) {
            i = closeParen + 1;
            continue;
          }
        }
      }
      if (text[i] === '[') {
        const closeBracket = text.indexOf(']', i + 1);
        if (closeBracket > i && text[closeBracket + 1] === '(') {
          const closeParen = text.indexOf(')', closeBracket + 2);
          if (closeParen > closeBracket) {
            addRange(i + 1, closeBracket);
            i = closeParen + 1;
            continue;
          }
        }
      }
      addChar(i);
      i += 1;
    }
    return map;
  }

  function _sourceRangeFromVisibleOffsets(source, offsets, allowCollapsed = false) {
    if (!offsets) return null;
    const text = String(source || '');
    const map = _mapVisibleChars(text);
    if (!map.length) return allowCollapsed ? { start: 0, end: 0 } : null;
    if (allowCollapsed && offsets.start >= map.length && offsets.end >= map.length) {
      return { start: text.length, end: text.length };
    }
    const visibleStart = Math.max(0, Math.min(map.length - 1, offsets.start));
    const visibleEnd = Math.max(visibleStart, Math.min(map.length, offsets.end));
    if (visibleEnd === visibleStart && allowCollapsed) {
      const collapsed = visibleStart >= map.length ? text.length : map[visibleStart];
      return { start: collapsed, end: collapsed };
    }
    return {
      start: map[visibleStart],
      end: visibleEnd > visibleStart ? map[visibleEnd - 1] + 1 : map[visibleStart] + 1,
    };
  }

  function _bubbleTargetFromElement(row, selectedText, bubble) {
    const index = Number(row?.dataset?.chatMessageIndex);
    if (!Number.isInteger(index)) return null;
    const source = _messageContentString(index);
    if (!source) return null;
    if (!selectedText) return { kind: 'bubble', index, start: 0, end: source.length };
    const mapped = _sourceRangeFromVisibleOffsets(source, _selectionTextOffsetsIn(bubble));
    if (mapped) return { kind: 'bubble', index, start: mapped.start, end: mapped.end };
    const start = source.indexOf(selectedText);
    if (start < 0) return null;
    return { kind: 'bubble', index, start, end: start + selectedText.length };
  }

  function _openForInputSelection(event) {
    const editor = _chatRichInput();
    if (editor && (document.activeElement === editor || editor.contains(document.activeElement))) {
      const offsets = _selectionTextOffsetsIn(editor);
      if (!offsets || offsets.end <= offsets.start) return;
      const range = window.getSelection()?.rangeCount ? window.getSelection().getRangeAt(0) : null;
      const rect = event ? _eventRect(event) : _selectionRect(range, editor);
      const target = _richInputTargetFromSelection(editor, rect, false);
      if (target && rect) _openPopup(target, rect, editor);
      return;
    }
    const input = _chatInput();
    if (!input || document.activeElement !== input) return;
    if ((input.selectionEnd || 0) <= (input.selectionStart || 0)) return;
    const rect = event ? _eventRect(event) : input.getBoundingClientRect();
    _openPopup(_inputTargetFromSelection(input, rect), rect, input);
  }

  function _openForBubbleSelection() {
    const target = _chatCopyTargetFromSelection();
    if (!target) return;
    const rect = _selectionRect(target.range, target.bubble);
    if (rect) _openCopyPopup(target, rect);
  }

  function _hasActiveChatFormatSelection() {
    const input = _chatInput();
    if (input && document.activeElement === input && (input.selectionEnd || 0) > (input.selectionStart || 0)) {
      return true;
    }
    const editor = _chatRichInput();
    if (editor) {
      const offsets = _selectionTextOffsetsIn(editor);
      if (offsets && offsets.end > offsets.start) return true;
    }
    if (_chatCopyTargetFromSelection()) return true;
    return false;
  }

  function _scheduleSelectionOpen(event) {
    _rememberRichInputSelection();
    clearTimeout(_timer);
    _timer = setTimeout(() => {
      if (_isFormatPopupInteraction(event) || Date.now() < _suppressUntil) return;
      if (!_hasActiveChatFormatSelection()) {
        _closePopup();
        return;
      }
      _openForInputSelection(event);
      _openForBubbleSelection();
    }, 90);
  }

  function _handleContextMenu(event) {
    if (event.target?.closest?.('.gb-fmt-popup, .gb-palette-popup')) return;
    const editor = event.target?.closest?.('#' + RICH_INPUT_ID);
    if (editor) {
      event.preventDefault();
      const rect = _eventRect(event);
      const target = _richInputTargetFromSelection(editor, rect, true);
      if (target) _openPopup(target, rect, editor);
      return;
    }
    const input = event.target?.closest?.('#chat-input');
    if (input) {
      event.preventDefault();
      const rect = _eventRect(event);
      _openPopup(_inputTargetFromSelection(input, rect), rect, input);
      return;
    }
    const copyTarget = _chatCopyTargetFromSelection();
    if (copyTarget && event.target?.closest?.('.chat-message-bubble')) {
      event.preventDefault();
      _openCopyPopup(copyTarget, _eventRect(event));
    }
  }

  function _isBlankRichBlock(block) {
    return !String(block?.textContent || '').replace(/\u200b/g, '').length;
  }

  function _setCaretInRichBlock(editor, block, visibleColumn) {
    const pos = _textPositionAtVisibleOffset(block, Math.max(0, Number(visibleColumn) || 0));
    const range = document.createRange();
    range.setStart(pos.node, pos.offset);
    range.collapse(true);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    editor.focus();
  }

  function _handleRichInputVerticalNavigation(event, editor) {
    const key = String(event?.key || '');
    if (key !== 'ArrowUp' && key !== 'ArrowDown') return false;
    if (event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return false;
    const selection = window.getSelection();
    if (!editor || !selection || !selection.rangeCount || !selection.isCollapsed) return false;
    const range = selection.getRangeAt(0);
    if (!editor.contains(_nodeElement(range.commonAncestorContainer))) return false;
    const blocks = _richInputBlocks(editor);
    const block = _richDirectBlock(editor, range.startContainer);
    const index = blocks.indexOf(block);
    const targetIndex = index + (key === 'ArrowDown' ? 1 : -1);
    if (index < 0 || targetIndex < 0 || targetIndex >= blocks.length) return false;
    const target = blocks[targetIndex];
    if (!_isBlankRichBlock(block) && !_isBlankRichBlock(target)) {
      _richVerticalColumn = null;
      return false;
    }
    event.preventDefault();
    event.stopPropagation();
    const column = Number.isFinite(_richVerticalColumn)
      ? _richVerticalColumn
      : _visibleOffsetInBlock(block, range.startContainer, range.startOffset);
    _richVerticalColumn = column;
    _setCaretInRichBlock(editor, target, column);
    return true;
  }

  function _insertSourceTextAtRichSelection(text) {
    const input = _chatInput();
    const editor = _chatRichInput();
    const source = editor ? _richInputToMarkdown(editor).replace(/\r\n?/g, '\n') : '';
    const range = editor ? _richSelectionSourceRange(editor, true, source) : null;
    if (!input || !editor || !range) return false;
    const insert = String(text || '');
    input.value = source.slice(0, range.start) + insert + source.slice(range.end);
    const caret = range.start + insert.length;
    _richVerticalColumn = null;
    _renderRichInputFromSource(caret, caret);
    _updatingFromPlain = true;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    _updatingFromPlain = false;
    return true;
  }

  function _ensureRichInput() {
    const input = _chatInput();
    if (!input) return null;
    let editor = _chatRichInput();
    if (!editor) {
      editor = document.createElement('div');
      editor.id = RICH_INPUT_ID;
      editor.className = RICH_INPUT_CLASS;
      editor.contentEditable = 'true';
      editor.spellcheck = true;
      editor.dataset.sourceInputId = input.id;
      editor.dataset.placeholder = input.getAttribute('placeholder') || 'メッセージを入力...';
      editor.setAttribute('role', 'textbox');
      editor.setAttribute('aria-multiline', 'true');
      editor.setAttribute('aria-label', 'メッセージ入力');
      input.classList.add(HIDDEN_INPUT_CLASS);
      input.setAttribute('aria-hidden', 'true');
      input.tabIndex = -1;
      input.insertAdjacentElement('afterend', editor);
      _renderRichInputFromSource();
    }
    return editor;
  }

  function _bindRichInput(editor, input) {
    if (!editor || !input || editor.dataset.chatRichBound === '1') return;
    editor.dataset.chatRichBound = '1';
    editor.addEventListener('input', () => {
      _richVerticalColumn = null;
      _syncPlainFromRich();
    });
    editor.addEventListener('keydown', (event) => {
      if (_handleRichInputVerticalNavigation(event, editor)) return;
      if (String(event.key || '').startsWith('Arrow') || INPUT_NAVIGATION_KEYS.has(event.key)) {
        event.stopPropagation();
      }
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        _syncPlainFromRich();
        if (typeof chatSend === 'function') chatSend();
      } else if (event.key === 'Enter' && event.shiftKey) {
        event.preventDefault();
        event.stopPropagation();
        _insertSourceTextAtRichSelection('\n');
      } else if (!String(event.key || '').startsWith('Arrow')) {
        _richVerticalColumn = null;
      }
    });
    editor.addEventListener('pointerdown', (event) => {
      if (_focusEmptyRichInputAtStart(event, editor)) return;
      _richVerticalColumn = null;
    });
    editor.addEventListener('mousedown', (event) => {
      if (_focusEmptyRichInputAtStart(event, editor)) return;
      _richVerticalColumn = null;
    });
    editor.addEventListener('paste', (event) => {
      const text = event.clipboardData?.getData('text/plain');
      if (text == null) return;
      event.preventDefault();
      _richVerticalColumn = null;
      if (!_insertSourceTextAtRichSelection(text)) _insertPlainTextIntoRich(text);
    });
    editor.addEventListener('dragover', (event) => {
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    });
    editor.addEventListener('drop', (event) => {
      if (typeof _chatMessageDropHandle === 'function') {
        _chatMessageDropHandle(event, 'chat-input', 'llm');
      }
    });
    input.addEventListener('input', () => {
      if (!_updatingFromRich && !_updatingFromPlain) _renderRichInputFromSource();
    });
  }

  function _install() {
    const input = _chatInput();
    const editor = _ensureRichInput();
    _bindRichInput(editor, input);
    if (input && !input.dataset.chatFormatBound) {
      input.dataset.chatFormatBound = '1';
      input.addEventListener('select', _scheduleSelectionOpen);
      input.addEventListener('mouseup', _scheduleSelectionOpen);
      input.addEventListener('keyup', (event) => {
        const key = String(event?.key || '');
        if (key.startsWith('Arrow') || key === 'Shift' || key === 'Home' || key === 'End') {
          _scheduleSelectionOpen(event);
        }
      });
    }
  }

  document.addEventListener('selectionchange', () => _scheduleSelectionOpen(), true);
  document.addEventListener('mouseup', _scheduleSelectionOpen, true);
  document.addEventListener('contextmenu', _handleContextMenu, true);
  document.addEventListener('pointerdown', (event) => {
    if (event.target?.closest?.('.gb-fmt-popup, .gb-palette-popup')) _suppressUntil = Date.now() + 800;
  }, true);

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _install);
  else _install();

  window.GBChatFormatting = {
    openForSelection: () => {
      _openForInputSelection();
      _openForBubbleSelection();
    },
    rememberSelection: _rememberRichInputSelection,
    syncInput: () => _renderRichInputFromSource(),
    focusInput: () => {
      const editor = _chatRichInput();
      if (editor) {
        if (_isRichInputEmpty(editor)) _setRichCaretAtStart(editor);
        else editor.focus();
        return true;
      }
      const input = _chatInput();
      input?.focus?.();
      return !!input;
    },
    visibleInputForInput: (input) => {
      const editor = _chatRichInput();
      return input && editor && input.id === 'chat-input' ? editor : input;
    },
    insertText: (text) => _insertSourceTextAtRichSelection(text),
    close: _closePopup,
  };
})();
