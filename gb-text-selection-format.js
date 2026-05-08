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

  function _stylePatch(prop, value) {
    if (prop === 'textColor') return { color: value || '' };
    if (prop === 'bgColor') return { backgroundColor: value || '' };
    if (prop === 'fontWeight') return { fontWeight: value === 'bold' ? 'bold' : '' };
    if (prop === 'fontStyle') return { fontStyle: value === 'italic' ? 'italic' : '' };
    if (prop === 'fontSize') return { fontSize: value ? value + 'px' : '' };
    if (prop === 'fontFamily') return { fontFamily: value || '' };
    if (prop === 'textStrokeColor') return { webkitTextStrokeColor: value || '', paintOrder: value ? 'stroke fill' : '' };
    if (prop === 'textStrokeWidth') return { webkitTextStrokeWidth: value ? value + 'px' : '', paintOrder: value ? 'stroke fill' : '' };
    if (prop === 'underline') return { textDecorationLine: value ? 'underline' : '' };
    if (prop === 'accentColor') {
      return {
        textDecorationColor: value || '',
        borderLeftColor: value || '',
      };
    }
    if (prop === 'leftAccent') {
      return {
        borderLeft: value ? '3px solid var(--accent)' : '',
        paddingLeft: value ? '6px' : '',
      };
    }
    return {};
  }

  function _wrapSelectionWithStyle(patch) {
    if (!_restoreSelection()) return;
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount || sel.isCollapsed) return;
    const range = sel.getRangeAt(0);
    const span = document.createElement('span');
    Object.assign(span.style, patch);
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
    if (!_restoreSelection()) return;
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount || sel.isCollapsed || !_savedRoot) return;
    const range = sel.getRangeAt(0);
    const beforeHtml = _savedRoot.innerHTML;
    const candidates = new Set();
    const addStyledAncestor = (node) => {
      let el = _nodeElement(node);
      while (el && el !== _savedRoot) {
        if (el.getAttribute?.('style')) candidates.add(el);
        el = el.parentElement;
      }
    };
    addStyledAncestor(range.startContainer);
    addStyledAncestor(range.endContainer);
    _savedRoot.querySelectorAll('[style]').forEach((el) => {
      if (_rangeIntersectsNode(range, el)) candidates.add(el);
    });
    candidates.forEach((el) => {
      if (!el.style?.[styleProp]) return;
      el.style[styleProp] = '';
      if (!String(el.getAttribute('style') || '').trim()) el.removeAttribute('style');
    });
    if (_savedRoot.innerHTML === beforeHtml) return;
    if (sel.rangeCount) _savedRange = sel.getRangeAt(0).cloneRange();
    _savedRoot.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function _openForSelection() {
    if (_isCloudMobileEditingUiActive()) {
      _closeSelectionPopup();
      return;
    }
    if (Date.now() < _suppressUntil) return;
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
    openFormatPopup(anchor, {
      fields: FIELDS,
      values: _computedValues(range),
      className: POPUP_CLASS,
      closeOnOutside: true,
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
  }

  function _schedule() {
    clearTimeout(_timer);
    _timer = setTimeout(_openForSelection, 90);
  }

  document.addEventListener('selectionchange', _schedule);
  document.addEventListener('mouseup', _schedule, true);
  document.addEventListener('keyup', (ev) => {
    const key = String(ev?.key || '');
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

  window.GBTextSelectionFormat = {
    openForSelection: _openForSelection,
    close: _closeSelectionPopup,
  };
})();
