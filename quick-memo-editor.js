(function () {
  'use strict';

  const HISTORY_LIMIT = 100;
  const INPUT_GROUP_MS = 700;

  function selectionOffsets(root) {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return null;
    const range = selection.getRangeAt(0);
    if (!root.contains(range.commonAncestorContainer)) return null;
    const before = range.cloneRange();
    before.selectNodeContents(root);
    before.setEnd(range.startContainer, range.startOffset);
    return {
      start: before.toString().length,
      end: before.toString().length + range.toString().length,
    };
  }

  function textPoint(root, offset) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let remaining = Math.max(0, offset);
    let last = root;
    while (walker.nextNode()) {
      last = walker.currentNode;
      if (remaining <= last.nodeValue.length) return { node: last, offset: remaining };
      remaining -= last.nodeValue.length;
    }
    return { node: last, offset: last === root ? root.childNodes.length : last.nodeValue.length };
  }

  function restoreSelection(root, offsets) {
    if (!offsets) return;
    const start = textPoint(root, offsets.start);
    const end = textPoint(root, offsets.end);
    const range = document.createRange();
    try {
      range.setStart(start.node, start.offset);
      range.setEnd(end.node, end.offset);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    } catch (_) {
      root.focus();
    }
  }

  function positionBelow(popup, rect) {
    if (typeof window.positionPopup === 'function') {
      window.positionPopup(popup, rect, { prefer: 'below', gap: 8 });
      return;
    }
    popup.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - popup.offsetWidth - 8))}px`;
    popup.style.top = `${Math.max(8, Math.min(rect.bottom + 8, window.innerHeight - popup.offsetHeight - 8))}px`;
  }

  function createPopup() {
    const popup = document.createElement('div');
    popup.className = 'qm-format-popup';
    popup.hidden = true;
    popup.setAttribute('role', 'toolbar');
    popup.setAttribute('aria-label', '選択したテキストの書式');
    const buttons = [
      ['bold', '<b>B</b>', '太字'],
      ['italic', '<i>I</i>', '斜体'],
      ['underline', '<u>U</u>', '下線'],
      ['insertUnorderedList', '•', '箇条書き'],
      ['removeFormat', 'Tx', '書式解除'],
    ];
    buttons.forEach(([command, label, title]) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.command = command;
      button.title = title;
      button.setAttribute('aria-label', title);
      button.innerHTML = label;
      popup.appendChild(button);
    });
    document.body.appendChild(popup);
    return popup;
  }

  function create(options) {
    const editor = options.editor;
    const popup = createPopup();
    const past = [];
    const future = [];
    let active = true;
    let last = null;
    let pendingBefore = null;
    let pendingTimer = 0;
    let savedRange = null;
    let composing = false;
    let suppressInput = false;

    function snapshot() {
      return { html: editor.innerHTML, selection: selectionOffsets(editor) };
    }

    function same(a, b) {
      return Boolean(a && b && a.html === b.html);
    }

    function notifyHistory() {
      options.onHistoryChange?.({ canUndo: past.length > 0, canRedo: future.length > 0 });
    }

    function applySnapshot(value) {
      suppressInput = true;
      editor.innerHTML = value?.html || '';
      editor.focus({ preventScroll: true });
      restoreSelection(editor, value?.selection);
      suppressInput = false;
      last = snapshot();
      options.onChanged?.();
      notifyHistory();
    }

    function pushPast(value) {
      if (!value || same(value, past[past.length - 1])) return;
      past.push(value);
      if (past.length > HISTORY_LIMIT) past.shift();
    }

    function finishPending() {
      if (pendingTimer) window.clearTimeout(pendingTimer);
      pendingTimer = 0;
      if (!pendingBefore) return;
      const current = snapshot();
      if (!same(pendingBefore, current)) {
        pushPast(pendingBefore);
        future.length = 0;
      }
      last = current;
      pendingBefore = null;
      notifyHistory();
    }

    function scheduleCommit() {
      if (!pendingBefore) pendingBefore = last || snapshot();
      if (pendingTimer) window.clearTimeout(pendingTimer);
      pendingTimer = window.setTimeout(finishPending, INPUT_GROUP_MS);
    }

    function immediateMutation(mutator) {
      finishPending();
      const before = snapshot();
      mutator();
      const after = snapshot();
      if (!same(before, after)) {
        pushPast(before);
        future.length = 0;
        last = after;
        options.onChanged?.();
        notifyHistory();
      }
    }

    function selectionInsideEditor() {
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
      const range = selection.getRangeAt(0);
      return editor.contains(range.commonAncestorContainer) ? range : null;
    }

    function hidePopup() {
      popup.hidden = true;
      savedRange = null;
    }

    function updatePopup() {
      if (!active) {
        hidePopup();
        return;
      }
      const range = selectionInsideEditor();
      if (!range) {
        if (!popup.matches(':hover')) hidePopup();
        return;
      }
      const rect = range.getBoundingClientRect();
      if (!rect.width && !rect.height) {
        hidePopup();
        return;
      }
      savedRange = range.cloneRange();
      popup.hidden = false;
      positionBelow(popup, rect);
    }

    function restoreSavedRange() {
      if (!savedRange) return false;
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(savedRange);
      return true;
    }

    function applyCommand(command) {
      if (!restoreSavedRange()) return;
      immediateMutation(() => {
        document.execCommand(command, false, null);
        savedRange = selectionInsideEditor()?.cloneRange() || null;
      });
      window.requestAnimationFrame(updatePopup);
    }

    function undo() {
      finishPending();
      const target = past.pop();
      if (!target) return false;
      future.push(snapshot());
      applySnapshot(target);
      return true;
    }

    function redo() {
      finishPending();
      const target = future.pop();
      if (!target) return false;
      pushPast(snapshot());
      applySnapshot(target);
      return true;
    }

    function reset(html) {
      if (pendingTimer) window.clearTimeout(pendingTimer);
      pendingTimer = 0;
      pendingBefore = null;
      past.length = 0;
      future.length = 0;
      suppressInput = true;
      editor.innerHTML = html || '';
      suppressInput = false;
      last = snapshot();
      hidePopup();
      notifyHistory();
    }

    editor.addEventListener('beforeinput', () => {
      if (!pendingBefore) pendingBefore = last || snapshot();
    });
    editor.addEventListener('input', () => {
      if (suppressInput) return;
      scheduleCommit();
      options.onChanged?.();
    });
    editor.addEventListener('compositionstart', () => {
      composing = true;
      if (!pendingBefore) pendingBefore = last || snapshot();
    });
    editor.addEventListener('compositionend', () => {
      composing = false;
      scheduleCommit();
    });
    // キーは共通のショートカットレジストリへ登録し、右サイドバーの
    // 「ショートカットキー」タブから確認・変更できるようにする。
    window.MeldexShortcutRegistry?.registerLocal({
      'quickmemo.undo': { key: 'ctrl+z', label: '元に戻す', scope: 'quickmemo' },
      'quickmemo.redo': { key: 'ctrl+y', label: 'やり直し', scope: 'quickmemo' },
      'quickmemo.redoAlt': { key: 'ctrl+shift+z', label: 'やり直し（代替）', scope: 'quickmemo' },
    });
    editor.addEventListener('keydown', (event) => {
      if (composing || event.isComposing) return;
      const id = window.MeldexShortcutRegistry?.matchEvent(event, ['quickmemo']) || '';
      if (id === 'quickmemo.undo') {
        event.preventDefault();
        undo();
      } else if (id === 'quickmemo.redo' || id === 'quickmemo.redoAlt') {
        event.preventDefault();
        redo();
      }
    });
    popup.addEventListener('pointerdown', (event) => event.preventDefault());
    popup.addEventListener('click', (event) => {
      const button = event.target.closest('[data-command]');
      if (button) applyCommand(button.dataset.command);
    });
    document.addEventListener('selectionchange', () => window.requestAnimationFrame(updatePopup));
    document.addEventListener('pointerdown', (event) => {
      if (!popup.contains(event.target) && !editor.contains(event.target)) hidePopup();
    });
    window.addEventListener('scroll', hidePopup, true);
    window.addEventListener('resize', hidePopup);
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') hidePopup();
    });

    reset(editor.innerHTML);
    return {
      undo,
      redo,
      reset,
      flush: finishPending,
      getHtml: () => editor.innerHTML,
      hasContent: () => Boolean(editor.innerText.trim() || editor.querySelector('img')),
      setActive(value) {
        active = Boolean(value);
        if (!active) hidePopup();
      },
      mutate: immediateMutation,
      state: () => ({ canUndo: past.length > 0, canRedo: future.length > 0 }),
    };
  }

  window.MeldexQuickMemoEditor = { create };
})();
