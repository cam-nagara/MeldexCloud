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
      const visible = sourceRange ? _visibleTextForSourceRange(source, sourceRange) : '';
      if (visible !== selected) return;
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

  function _mapVisibleChars(source, options = {}) {
    const text = String(source || '').replace(/\r\n?/g, '\n');
    const map = [];
    const hidden = new Set();
    const renderedMarkdown = options?.renderedMarkdown === true;
    const markHidden = (start, end) => {
      const a = Math.max(0, Math.min(text.length, Number(start) || 0));
      const b = Math.max(a, Math.min(text.length, Number(end) || 0));
      for (let n = a; n < b; n += 1) hidden.add(n);
    };
    const isVisibleToken = (index, token) => {
      if (!text.startsWith(token, index)) return false;
      for (let n = index; n < index + token.length; n += 1) {
        if (hidden.has(n)) return false;
      }
      return true;
    };
    const findVisibleToken = (token, from) => {
      let index = Math.max(0, Number(from) || 0);
      while (index < text.length) {
        index = text.indexOf(token, index);
        if (index < 0) return -1;
        if (isVisibleToken(index, token)) return index;
        index += token.length;
      }
      return -1;
    };
    const markPairedToken = (openToken, closeToken = openToken) => {
      let index = 0;
      while (index < text.length) {
        const start = findVisibleToken(openToken, index);
        if (start < 0) break;
        const close = findVisibleToken(closeToken, start + openToken.length);
        if (close < 0) {
          index = start + openToken.length;
          continue;
        }
        markHidden(start, start + openToken.length);
        markHidden(close, close + closeToken.length);
        index = close + closeToken.length;
      }
    };
    const markStylePairs = () => {
      let index = 0;
      while (index < text.length) {
        const match = text.slice(index).match(/\[style\s+[^\]]{1,240}\]/i);
        if (!match) break;
        const start = index + match.index;
        const end = text.indexOf('[/style]', start + match[0].length);
        if (end < 0) {
          index = start + match[0].length;
          continue;
        }
        markHidden(start, start + match[0].length);
        markHidden(end, end + 8);
        index = end + 8;
      }
    };
    const markLinePrefixes = () => {
      let lineStart = 0;
      while (lineStart <= text.length) {
        const newline = text.indexOf('\n', lineStart);
        const lineEnd = newline < 0 ? text.length : newline;
        const line = text.slice(lineStart, lineEnd);
        const heading = line.match(/^\s{0,3}#{1,6}\s+/);
        const renderedPrefix = renderedMarkdown
          ? (line.match(/^\s*>\s?/) || line.match(/^\s*(?:[-*+]|\d+\.)\s+/))
          : null;
        const prefix = heading || renderedPrefix;
        if (prefix) markHidden(lineStart, lineStart + prefix[0].length);
        if (renderedMarkdown && line.startsWith('```')) markHidden(lineStart, newline < 0 ? lineEnd : newline + 1);
        if (newline < 0) break;
        lineStart = newline + 1;
      }
    };
    const markRenderedMarkdownLinks = () => {
      if (!renderedMarkdown) return;
      let index = 0;
      while (index < text.length) {
        const wiki = text.slice(index).match(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/);
        const linkStart = text.indexOf('[', index);
        const wikiStart = wiki ? index + wiki.index : -1;
        let start = -1;
        let kind = '';
        if (wikiStart >= 0 && (linkStart < 0 || wikiStart <= linkStart)) {
          start = wikiStart;
          kind = 'wiki';
        } else if (linkStart >= 0) {
          start = linkStart;
          kind = 'link';
        }
        if (start < 0) break;
        if (kind === 'wiki') {
          const current = text.slice(start).match(/^\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/);
          const labelStart = current?.[2] ? start + current[0].indexOf('|') + 1 : start + 2;
          markHidden(start, labelStart);
          markHidden(start + current[0].length - 2, start + current[0].length);
          index = start + current[0].length;
          continue;
        }
        if (text.startsWith('![', start)) {
          const closeBracket = text.indexOf(']', start + 2);
          const closeParen = closeBracket > start && text[closeBracket + 1] === '('
            ? text.indexOf(')', closeBracket + 2)
            : -1;
          if (closeParen > closeBracket) {
            markHidden(start, closeParen + 1);
            index = closeParen + 1;
            continue;
          }
        }
        const closeBracket = text.indexOf(']', start + 1);
        const closeParen = closeBracket > start && text[closeBracket + 1] === '('
          ? text.indexOf(')', closeBracket + 2)
          : -1;
        if (closeParen > closeBracket) {
          markHidden(start, start + 1);
          markHidden(closeBracket, closeParen + 1);
          index = closeParen + 1;
        } else {
          index = start + 1;
        }
      }
    };

    markLinePrefixes();
    markStylePairs();
    markPairedToken('**');
    markPairedToken('~~');
    markPairedToken('[u]', '[/u]');
    markPairedToken('*');
    markPairedToken('`');
    markRenderedMarkdownLinks();
    for (let i = 0; i < text.length; i += 1) {
      if (!hidden.has(i)) map.push(i);
    }
    return map;
  }

  function _visibleTextForSourceRange(source, range) {
    if (!range) return '';
    const text = String(source || '');
    const clamped = _clampRange(text, range.start, range.end);
    const map = _mapVisibleChars(text);
    return map
      .filter(index => index >= clamped.start && index < clamped.end)
      .map(index => text[index])
      .join('');
  }
