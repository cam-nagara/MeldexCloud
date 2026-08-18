  function _sourceRangeFromVisibleOffsets(source, offsets, allowCollapsed = false) {
    if (!offsets) return null;
    const text = String(source || '');
    const map = _mapVisibleChars(text, arguments[3] || {});
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
    const mapped = _sourceRangeFromVisibleOffsets(source, _selectionTextOffsetsIn(bubble), false, { renderedMarkdown: true });
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
      const avoidRect = _selectionAvoidRect(range, editor);
      const rect = _eventRect(event) || _selectionRect(range, editor);
      const target = _richInputTargetFromSelection(editor, rect, false);
      if (target && rect) _openPopup(target, rect, editor, avoidRect);
      return;
    }
    const input = _chatInput();
    if (!input || document.activeElement !== input) return;
    if ((input.selectionEnd || 0) <= (input.selectionStart || 0)) return;
    const avoidRect = input.getBoundingClientRect();
    const rect = _eventRect(event) || avoidRect;
    _openPopup(_inputTargetFromSelection(input, rect), rect, input, avoidRect);
  }

  function _openForBubbleSelection() {
    const target = _chatCopyTargetFromSelection();
    if (!target) return;
    const rect = _selectionRect(target.range, target.bubble);
    const avoidRect = _selectionAvoidRect(target.range, target.bubble);
    if (rect) _openCopyPopup(target, rect, avoidRect);
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
      const range = window.getSelection()?.rangeCount ? window.getSelection().getRangeAt(0) : null;
      if (target) _openPopup(target, rect, editor, _selectionAvoidRect(range, editor));
      return;
    }
    const input = event.target?.closest?.('#chat-input');
    if (input) {
      event.preventDefault();
      const rect = _eventRect(event);
      _openPopup(_inputTargetFromSelection(input, rect), rect, input, input.getBoundingClientRect());
      return;
    }
    const copyTarget = _chatCopyTargetFromSelection();
    if (copyTarget && event.target?.closest?.('.chat-message-bubble')) {
      event.preventDefault();
      _openCopyPopup(copyTarget, _eventRect(event), _selectionAvoidRect(copyTarget.range, copyTarget.bubble));
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
    const block = _richDirectBlock(editor, range.startContainer, range.startOffset);
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
    const insert = String(text || '').replace(/\r\n?/g, '\n');
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
      editor.spellcheck = false;
      editor.setAttribute('spellcheck', 'false');
      editor.dataset.sourceInputId = input.id;
      editor.dataset.placeholder = input.getAttribute('placeholder') || 'メッセージを入力...';
      editor.setAttribute('role', 'textbox');
      editor.setAttribute('aria-multiline', 'true');
      editor.setAttribute('aria-label', 'メッセージ入力');
      editor.tabIndex = 0;
      input.classList.add(HIDDEN_INPUT_CLASS);
      input.setAttribute('aria-hidden', 'true');
      input.tabIndex = -1;
      input.insertAdjacentElement('afterend', editor);
      if (typeof _chatBindImeCompositionGuard === 'function') _chatBindImeCompositionGuard(RICH_INPUT_ID);
      _renderRichInputFromSource();
    }
    return editor;
  }

  function _chatClipboardAttachmentFiles(event) {
    const files = [];
    const seen = new Set();
    const addFile = (file) => {
      if (!file) return;
      const key = [file.name || '', file.type || '', file.size || 0, file.lastModified || 0].join('\n');
      if (seen.has(key)) return;
      seen.add(key);
      const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '');
      if (file.type?.startsWith('image/') || isPdf) files.push(file);
    };
    Array.from(event.clipboardData?.files || []).forEach(addFile);
    Array.from(event.clipboardData?.items || []).forEach((item) => {
      if (item?.kind !== 'file') return;
      try { addFile(item.getAsFile()); } catch {}
    });
    return files;
  }

  async function _handleChatClipboardAttachments(event) {
    if (typeof _chatUploadAttachment !== 'function') return false;
    const files = _chatClipboardAttachmentFiles(event);
    if (!files.length) return false;
    event.preventDefault();
    event.stopPropagation();
    for (const file of files) await _chatUploadAttachment(file);
    if (typeof showStatus === 'function') {
      showStatus(files.length === 1 ? 'クリップボードから添付しました' : files.length + '件を添付しました');
    }
    return true;
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
        if (typeof _chatIsImeEnterEvent === 'function' && _chatIsImeEnterEvent(event)) return;
        event.preventDefault();
        _syncPlainFromRich();
        if (typeof chatSend === 'function') chatSend();
      } else if (event.key === 'Enter' && event.shiftKey) {
        if (typeof _chatIsImeEnterEvent === 'function' && _chatIsImeEnterEvent(event)) return;
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
      if (_chatClipboardAttachmentFiles(event).length) {
        _handleChatClipboardAttachments(event).catch(() => {
          if (typeof showStatus === 'function') showStatus('添付ファイルのアップロードに失敗しました', true);
        });
        return;
      }
      const text = event.clipboardData?.getData('text/plain');
      if (text == null) return;
      event.preventDefault();
      if (text === '') return;
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
    input.addEventListener('paste', (event) => {
      if (!_chatClipboardAttachmentFiles(event).length) return;
      _handleChatClipboardAttachments(event).catch(() => {
        if (typeof showStatus === 'function') showStatus('添付ファイルのアップロードに失敗しました', true);
      });
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
  document.addEventListener('copy', event => {
    const target = _chatCopyTargetFromSelection();
    if (!target?.text || !event.clipboardData) return;
    event.preventDefault();
    event.clipboardData.setData('text/plain', target.text);
    if (typeof showStatus === 'function') showStatus('選択範囲をコピーしました');
  }, true);
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
    copyHistoryText: (range) => _chatCopyHistoryText(range),
    close: _closePopup,
  };
})();
