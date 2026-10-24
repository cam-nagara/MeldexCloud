/* Share native/Explorer file paste with each app's existing drop/save handler. */
(function () {
  'use strict';
  let pending = null;
  let lastTarget = null;
  document.addEventListener('pointerdown', event => { lastTarget = surface(event.target); }, true);
  const visibleTarget = element => element?.isConnected && element.getClientRects().length ? element : null;
  const isSupported = () => !['dropbox', 'browser', 'server'].includes(document.body?.dataset.cloudMode || '')
    && !window.MeldexRuntimeAdapter?.isPwaMode?.();
  function surface(element) {
    const editable = element?.closest?.('input, textarea, [contenteditable="true"]');
    const own = element?.closest?.('.gb-image-cell, #page-content, #entity-freetext, #chat-rich-input, #chat-input, #team-input, input[type="file"]');
    if (editable && !own) return null;
    return own || element?.closest?.('#bd-canvas, #folder-view, #outliner-tree');
  }
  function targetFor(element) {
    return surface(element) || ((element === document.body || element === document.documentElement)
      && !document.querySelector('[role="dialog"][aria-modal="true"]') ? visibleTarget(lastTarget) : null);
  }
  function folderFor(element) {
    if (element?.closest?.('#outliner-tree')) {
      const row = (element.closest('.tree-node') || document.querySelector('#outliner-tree .tree-node.selected'))?._nodeData;
      if (row?.path) return row.type === 'folder' || row.type === 'database' ? row.path : row.path.replace(/[/\\][^/\\]+$/, '');
      return typeof state !== 'undefined' ? state.vaultPath : '';
    }
    return element?.closest?.('#folder-view') && typeof _folderPath !== 'undefined' ? _folderPath : '';
  }
  function dispatchFiles(target, files) {
    if (!target?.isConnected || !files.length) return false;
    const transfer = new DataTransfer();
    files.forEach(file => transfer.items.add(file));
    transfer.effectAllowed = 'copy';
    if (target.matches('input[type="file"]')) {
      target.files = transfer.files;
      target.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }
    const selection = window.getSelection();
    const caret = selection?.rangeCount && target.contains(selection.anchorNode) ? selection.getRangeAt(0).getBoundingClientRect() : null;
    const rect = caret?.width || caret?.height ? caret : target.getBoundingClientRect();
    const event = new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer,
      clientX: rect.left + Math.min(10, rect.width / 2), clientY: rect.top + Math.min(10, rect.height / 2) });
    Object.defineProperty(event, 'meldexFilePaste', { value: true });
    target.dispatchEvent(event);
    return event.defaultPrevented;
  }
  async function pasteIntoFolder(path, snapshot) {
    if (!path || !isSupported()) return false;
    const data = snapshot || await apiPost('/os-clipboard/read', {}, { silentError: true });
    if (!data.items?.length) return false;
    const result = await runBackgroundJob('/os-clipboard/import', { ticket: data.ticket, path });
    if (!result?.ok) throw new Error(result?.error || '貼り付け処理の完了を確認できませんでした');
    if (typeof loadOutliner === 'function') await loadOutliner({ force: true, reason: 'os-clipboard' });
    if (typeof openFolder === 'function' && typeof _folderPath !== 'undefined' && _folderPath === path) {
      await openFolder(document.getElementById('folder-title')?.textContent || path, path, { silent: true, skipNavPush: true });
    }
    showStatus(`${result.paths.length}件を${data.cut ? '移動' : '貼り付け'}しました`);
    return true;
  }
  async function nativePaste(target, ticket) {
    const data = await apiPost('/os-clipboard/read', {}, { silentError: true });
    if (!ticket.isCurrent() || !data.items?.length) return;
    const folder = folderFor(target);
    if (folder) { await pasteIntoFolder(folder, data); return; }
    const files = [];
    for (const item of data.items) {
      if (item.directory) throw new Error('フォルダはフォルダツリーまたはフォルダパネルへ貼り付けてください');
      const response = await fetch(API_BASE + '/os-clipboard/file?' + new URLSearchParams({ ticket: data.ticket, index: item.index }));
      if (!response.ok) throw new Error('コピー元を読み取れません。もう一度コピーしてください');
      const blob = await response.blob();
      files.push(new File([blob], item.name, { type: blob.type }));
    }
    if (ticket.isCurrent()) dispatchFiles(target, files);
  }
  document.addEventListener('paste', event => {
    const target = targetFor(event.target);
    if (!target || !event.clipboardData?.files?.length) return;
    if (pending) pending.cancelled = true;
    // Plain text/HTML paste remains owned by the editor. File paste uses exactly
    // the existing drop contract, including locks, versions and failure drafts.
    event.preventDefault(); event.stopImmediatePropagation();
    const folder = folderFor(target);
    if (folder && typeof _folderImportOsDrop === 'function') {
      const dataTransfer = event.clipboardData;
      _folderImportOsDrop({ dataTransfer }, { type: 'folder', path: folder }).catch(error => showStatus(error.message, true));
    } else dispatchFiles(target, Array.from(event.clipboardData.files));
  }, true);
  document.addEventListener('keydown', event => {
    if (!(event.ctrlKey || event.metaKey) || event.shiftKey || event.altKey || String(event.key).toLowerCase() !== 'v' || event.repeat || event.isComposing || !isSupported()) return;
    const target = targetFor(event.target);
    if (!target) return;
    const folder = folderFor(target);
    if (folder && typeof folderToolbarPasteToFolder === 'function') {
      event.preventDefault(); event.stopImmediatePropagation();
      folderToolbarPasteToFolder(folder);
      return;
    }
    if (pending) pending.cancelled = true;
    const originalPath = target.dataset.path || target.dataset.entityPath || '';
    const originalGeneration = target._openPageLoadSeq;
    const originalBoard = target.closest('#bd-canvas') && typeof bd !== 'undefined' ? bd.path : null;
    const originalChat = typeof _chatState !== 'undefined' ? _chatState.messages : null;
    const ticket = { cancelled: false, isCurrent: () => !ticket.cancelled && visibleTarget(target)
      && originalPath === (target.dataset.path || target.dataset.entityPath || '')
      && originalGeneration === target._openPageLoadSeq
      && (originalBoard === null || (typeof bd !== 'undefined' && originalBoard === bd.path))
      && (!target.closest('#rp-chat') || typeof _chatState === 'undefined' || originalChat === _chatState.messages) };
    pending = ticket;
    // Do not suppress the browser's normal text/image paste while the OS bridge
    // checks CF_HDROP. A real file paste event cancels this fallback above.
    nativePaste(target, ticket).catch(error => {
      if (!ticket.cancelled && error?.status !== 409) showStatus(error.message, true);
    }).finally(() => { if (pending === ticket) pending = null; });
  }, true);
  document.addEventListener('dragover', event => {
    if (Array.from(event.dataTransfer?.types || []).includes('Files') && surface(event.target)) event.preventDefault();
  }, true);
  const markInternalCopy = items => {
    // Replace a previous Explorer CF_HDROP when the user copies Meldex items.
    // Otherwise the next paste could import an older OS selection instead.
    navigator.clipboard?.writeText?.(items.map(item => item.path).join('\n')).catch(() => {});
  };
  window.MeldexOsFileIntake = { isSupported, pasteIntoFolder, dispatchFiles, markInternalCopy };
})();
