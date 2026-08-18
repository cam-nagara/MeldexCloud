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
    const x = Number(event?.clientX);
    const y = Number(event?.clientY);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return { left: x, top: y, right: x, bottom: y, width: 0, height: 0 };
  }

  function _selectionRect(range, fallbackEl) {
    const rects = range ? Array.from(range.getClientRects()).filter(r => r.width || r.height) : [];
    if (rects.length) return rects[0];
    const rect = range?.getBoundingClientRect?.();
    if (rect && (rect.width || rect.height)) return rect;
    return fallbackEl?.getBoundingClientRect?.() || null;
  }

  function _selectionAvoidRect(range, fallbackEl) {
    const rects = range ? Array.from(range.getClientRects()).filter(r => r.width || r.height) : [];
    if (!rects.length) return _selectionRect(range, fallbackEl);
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
    const effectiveEnd = range.end > range.start && source[range.end - 1] === '\n'
      ? range.end - 1
      : range.end;
    let lineStart = source.lastIndexOf('\n', Math.max(0, range.start - 1)) + 1;
    let lineEnd = source.indexOf('\n', effectiveEnd);
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
    if (!raw || raw.length > 160 || /url\s*\(|expression\s*\(|[<>[\]{};\\]/i.test(raw)) return '';
    return raw;
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

  function _richDirectBlock(editor, node, offset = 0) {
    if (!editor || !node) return null;
    if (node === editor) {
      const blocks = _richInputBlocks(editor);
      const childIndex = Math.max(0, Math.min(blocks.length - 1, Number(offset) || 0));
      return blocks[childIndex] || null;
    }
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
    if (!text.length) return null;
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
      if (value == null || String(value).trim() === '') return null;
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

  function _inlineRemovalToken(prop) {
    if (prop === 'fontWeight') return { open: '**', close: '**' };
    if (prop === 'fontStyle') return { open: '*', close: '*' };
    if (prop === 'strike') return { open: '~~', close: '~~' };
    if (prop === 'underline') return { open: '[u]', close: '[/u]' };
    return null;
  }

  function _inlineStyleAttrForProp(prop) {
    if (prop === 'textColor') return 'color';
    if (prop === 'bgColor') return 'bg';
    if (prop === 'fontSize') return 'size';
    if (prop === 'fontFamily') return 'font';
    return '';
  }

  function _isInlineFormatRemoval(prop, value) {
    if (prop === 'fontWeight') return value !== 'bold';
    if (prop === 'fontStyle') return value !== 'italic';
    if (prop === 'strike' || prop === 'underline') return !value;
    return !!_inlineStyleAttrForProp(prop) && !String(value ?? '').trim();
  }

  function _removeInlineStyleAttr(attrs, attrName) {
    const target = String(attrName || '').toLowerCase();
    return String(attrs || '')
      .replace(/([a-z]+)="([^"]*)"/gi, (all, key) => String(key || '').toLowerCase() === target ? '' : all)
      .replace(/\s+/g, ' ')
      .trim();
  }

  function _removeInlineFormatFromRange(source, start, end, prop) {
    const text = String(source || '');
    const range = _clampRange(text, start, end);
    const selected = text.slice(range.start, range.end);
    if (!selected) return null;
    const token = _inlineRemovalToken(prop);
    if (token) {
      const openStart = range.start - token.open.length;
      const closeEnd = range.end + token.close.length;
      if (openStart >= 0
        && text.slice(openStart, range.start) === token.open
        && text.slice(range.end, closeEnd) === token.close
        && !(token.open === '*' && (text.slice(range.start - 2, range.start) === '**' || text.slice(range.end, range.end + 2) === '**'))
      ) {
        return {
          text: text.slice(0, openStart) + selected + text.slice(closeEnd),
          start: openStart,
          end: openStart + selected.length,
        };
      }
      return null;
    }
    const attr = _inlineStyleAttrForProp(prop);
    if (!attr) return null;
    const before = text.slice(0, range.start);
    const openMatch = before.match(/\[style\s+([^\]]{1,240})\]$/i);
    const closeToken = '[/style]';
    if (!openMatch || text.slice(range.end, range.end + closeToken.length).toLowerCase() !== closeToken) return null;
    const openToken = openMatch[0];
    const prefix = text.slice(0, range.start - openToken.length);
    const suffix = text.slice(range.end + closeToken.length);
    const nextAttrs = _removeInlineStyleAttr(openMatch[1], attr);
    if (!nextAttrs) {
      return {
        text: prefix + selected + suffix,
        start: prefix.length,
        end: prefix.length + selected.length,
      };
    }
    const nextOpen = `[style ${nextAttrs}]`;
    return {
      text: prefix + nextOpen + selected + closeToken + suffix,
      start: prefix.length + nextOpen.length,
      end: prefix.length + nextOpen.length + selected.length,
    };
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

  function _applyInlineFormatToRange(source, start, end, prop, value) {
    const range = _clampRange(source, start, end);
    const selected = String(source || '').slice(range.start, range.end);
    if (!selected) return null;
    if (_isInlineFormatRemoval(prop, value)) {
      return _removeInlineFormatFromRange(source, range.start, range.end, prop);
    }
    if (!selected.includes('\n')) {
      const descriptor = _styleDescriptor(prop, value, selected);
      if (!descriptor) return null;
      return _replaceRange(source, range.start, range.end, descriptor.text, descriptor.innerStart, descriptor.innerEnd);
    }
    const replacement = selected.split('\n').map(segment => {
      if (!segment) return segment;
      const descriptor = _styleDescriptor(prop, value, segment);
      return descriptor ? descriptor.text : segment;
    }).join('\n');
    return _replaceRange(source, range.start, range.end, replacement, 0, replacement.length);
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
      : _applyInlineFormatToRange(source, range.start, range.end, prop, value);
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
      : _applyInlineFormatToRange(source, range.start, range.end, prop, value);
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

  function _openPopup(target, rect, valueElement, avoidRect) {
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
      avoidRect: avoidRect || rect,
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

  function _chatCopyVisibleText(range) {
    const fragment = range.cloneContents();
    const holder = document.createElement('div');
    holder.style.cssText = 'position:fixed;left:-10000px;top:0;width:640px;visibility:hidden;white-space:pre-wrap;';
    holder.appendChild(fragment);
    holder.querySelectorAll(
      'button,script,style,[hidden],[aria-hidden="true"],.chat-thinking,.chat-tool-use,.chat-code-exec,.chat-citations,.chat-cli-auth-recovery'
    ).forEach(element => element.remove());
    holder.querySelectorAll('img').forEach(image => {
      image.replaceWith(document.createTextNode(image.alt || image.title || ''));
    });
    document.body.appendChild(holder);
    const value = String(holder.innerText || holder.textContent || '')
      .replace(/\r\n?/g, '\n')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    holder.remove();
    return value;
  }

  function _chatCopyBodySelectionText(selectionRange, body) {
    if (!body || !selectionRange.intersectsNode?.(body)) return '';
    const bodyRange = document.createRange();
    bodyRange.selectNodeContents(body);
    const part = bodyRange.cloneRange();
    try {
      if (selectionRange.compareBoundaryPoints(Range.START_TO_START, bodyRange) > 0) {
        part.setStart(selectionRange.startContainer, selectionRange.startOffset);
      }
      if (selectionRange.compareBoundaryPoints(Range.END_TO_END, bodyRange) < 0) {
        part.setEnd(selectionRange.endContainer, selectionRange.endOffset);
      }
    } catch (_) {
      return '';
    }
    return part.collapsed ? '' : _chatCopyVisibleText(part);
  }

  // ノート行操作・書式ポップアップ・チャット選択回帰修正計画(2026-08-04)§2.5:
  // 発言者名・日時（.chat-message-header 内の .chat-message-author /
  // .chat-message-time）が選択可能になったのに合わせ、Ctrl+Cのチャット選択判定も
  // ヘッダーまで拡大する。操作ボタン（コピー/削除/再生成/編集/保留取消し）は
  // .chat-message-author/.chat-message-time のどちらでもないため、この判定に
  // ボタンが混ざることはない。ヘッダーの実際の見た目テキストではなく、既存どおり
  // message.dataset.chatCopyAuthor/chatCopyTime（正本の発言者名・日時）を使うため、
  // 部分選択でも表記が崩れず、ボタン名や認証カードが混入する余地も無い。
  function _chatCopyHeaderIntersectsSelection(selectionRange, message) {
    const header = message?.querySelector?.('.chat-message-header');
    if (!header) return false;
    const author = header.querySelector('.chat-message-author');
    const time = header.querySelector('.chat-message-time');
    return !!((author && selectionRange.intersectsNode?.(author)) || (time && selectionRange.intersectsNode?.(time)));
  }

  // 1件分のコピー整形行を組み立てる（DOM/Range非依存の純粋関数）。
  // 本文が選択されていれば従来どおり「[時刻] 発言者\n本文」、ヘッダー
  // （発言者名・日時）だけが選択されている場合は本文行を付けず「[時刻] 発言者」の
  // 見出し行だけを返す。どちらも選択されていなければ null（対象外）。
  // 複数発言をまたぐ場合の結合（entries.join('\n\n')）は呼び出し元のまま維持する。
  function _chatCopyEntryLine(message, bodyText, headerSelected) {
    if (!bodyText && !headerSelected) return null;
    const author = String(message?.dataset?.chatCopyAuthor || '').trim() || '発言者';
    const time = String(message?.dataset?.chatCopyTime || '').trim();
    const headerLine = `${time ? `[${time}] ` : ''}${author}`;
    return bodyText ? `${headerLine}\n${bodyText}` : headerLine;
  }

  function _chatCopyHistoryText(range) {
    const entries = [];
    document.querySelectorAll('.chat-copy-message').forEach(message => {
      if (!range.intersectsNode?.(message)) return;
      const body = message.querySelector('.chat-copy-body');
      const bodyText = _chatCopyBodySelectionText(range, body);
      const headerSelected = _chatCopyHeaderIntersectsSelection(range, message);
      const entry = _chatCopyEntryLine(message, bodyText, headerSelected);
      if (entry != null) entries.push(entry);
    });
    return entries.join('\n\n');
  }

  function _chatCopyTargetFromSelection() {
    const selection = window.getSelection();
    if (!selection || !selection.rangeCount || selection.isCollapsed) return null;
    const range = selection.getRangeAt(0);
    const text = _chatCopyHistoryText(range);
    if (!text.trim()) return null;
    const startEl = _nodeElement(range.startContainer);
    const endEl = _nodeElement(range.endContainer);
    const bubble = startEl?.closest?.('.chat-copy-message')
      || endEl?.closest?.('.chat-copy-message');
    if (!bubble) return null;
    return { kind: 'copy', text, bubble, range };
  }

  function _openCopyPopup(target, rect, avoidRect) {
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
    if (typeof positionPopup === 'function') positionPopup(popup, anchor.getBoundingClientRect(), { avoidRect: avoidRect || rect });
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
      const visible = sourceRange ? _visibleTextForSourceRange(source, sourceRange) : '';
      if (visible !== selected) return null;
    }
    if (!sourceRange) return null;
    if (selected && sourceRange.end > sourceRange.start) {
      _lastInputSelection = { source, start: sourceRange.start, end: sourceRange.end, time: Date.now() };
    }
    return {
      kind: 'input',
      start: sourceRange.start,
      end: sourceRange.end,
