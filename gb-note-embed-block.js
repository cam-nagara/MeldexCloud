/* Note inline sheet/board embed controller.  Model data never enters HTML attributes. */
(function (global) {
  'use strict';

  const MIME = 'application/x-meldex-topic-view+json';
  const models = new Map();
  const disposers = new Map();
  let host = null;

  function _serializer() { return global.MeldexNoteEmbedSerializer; }
  function _newId() {
    if (global.crypto && typeof global.crypto.randomUUID === 'function') return global.crypto.randomUUID();
    return 'embed-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
  }
  function _normalize(block) { return _serializer().normalize(block); }
  function _button(label, action) {
    const el = document.createElement('button');
    el.type = 'button'; el.textContent = label; el.dataset.embedAction = action;
    return el;
  }
  function _open(block) {
    const event = new CustomEvent('meldex-open-topic-view', { detail: {
      sourceId: block.sourceId, documentId: block.documentId, viewId: block.viewId,
      resourceType: block.resourceType, dbPath: block.dbPath || block.legacyPath || '',
      boardPath: block.boardPath || block.legacyPath || '', fallback: block.fallback || null,
    } });
    global.dispatchEvent(event);
    return event;
  }
  function _setStatus(block, status, reason, container) {
    const statusEl = container.querySelector('.meldex-note-embed-status');
    if (!statusEl) return;
    statusEl.hidden = status === 'ready';
    statusEl.textContent = reason || ({
      'read-only': 'スナップショットを読み取り専用で表示しています',
      missing: '元のビューが削除されています', denied: 'このビューを開く権限がありません',
      conflict: '更新が競合しています', offline: 'ソースへ接続できません',
    }[status] || '');
    if (status !== 'ready' && status !== 'loading' && status !== 'sleeping') {
      const reconnect = _button('接続し直す', 'reconnect');
      const open = _button('元を開く', 'open');
      reconnect.addEventListener('click', () => global.dispatchEvent(new CustomEvent('meldex-reconnect-topic-view', {
        detail: {
          blockId: block.blockId,
          runtimeId: container.dataset?.meldexEmbedRuntimeId || '',
          sourceId: block.sourceId, documentId: block.documentId, viewId: block.viewId,
        },
      })));
      open.addEventListener('click', () => _open(block));
      statusEl.append(reconnect, open);
    }
  }
  function _ensureHost(options) {
    if (options && options.host) return options.host;
    if (!host && global.MeldexTopicViewHost) {
      host = new global.MeldexTopicViewHost.TopicViewHost({ onStatus: _setStatus });
    }
    return host;
  }
  function _runtimeIdForElement(element) {
    return String(element?.dataset?.meldexEmbedRuntimeId || element?.dataset?.meldexEmbedBlockId || '');
  }
  function _resolveRuntimeId(blockOrRuntimeId) {
    const id = String(blockOrRuntimeId || '');
    if (models.has(id)) return id;
    for (const [runtimeId, model] of models) {
      if (String(model?.blockId || '') === id) return runtimeId;
    }
    return _runtimeIdForElement(_findBlockElement(id));
  }
  function _disposeBlock(blockOrRuntimeId) {
    const id = _resolveRuntimeId(blockOrRuntimeId);
    const dispose = disposers.get(id);
    try {
      if (dispose) dispose();
    } catch (error) {
      // Cleanup must continue for the remaining blocks even if one component has
      // already torn itself down.  Surface the fault without retaining stale state.
      global.console?.warn?.('Meldex note embed cleanup failed', error);
    } finally {
      disposers.delete(id);
      models.delete(id);
    }
    return !!dispose;
  }
  function createElement(rawBlock, options) {
    const inspected = _serializer().inspect(rawBlock);
    const block = inspected.block || rawBlock;
    const runtimeId = _newId();
    const wrap = document.createElement('section');
    wrap.className = 'meldex-note-embed';
    wrap.contentEditable = 'false';
    wrap.dataset.meldexEmbedBlockId = block && block.blockId ? block.blockId : _newId();
    wrap.dataset.meldexEmbedRuntimeId = runtimeId;
    wrap.setAttribute('aria-label', block?.fallback?.title || '埋め込みビュー');
    const header = document.createElement('div'); header.className = 'meldex-note-embed-header';
    const title = document.createElement('span'); title.className = 'meldex-note-embed-title';
    title.textContent = block?.fallback?.title || '対応していない埋め込みビュー';
    header.append(title, _button('元を開く', 'open'), _button('差し替え', 'replace'), _button('高さ', 'height'));
    const body = document.createElement('div'); body.className = 'meldex-note-embed-body';
    const status = document.createElement('div'); status.className = 'meldex-note-embed-status';
    status.setAttribute('role', 'status'); body.appendChild(status);
    wrap.append(header, body);
    if (!inspected.editable) {
      wrap.dataset.embedStatus = inspected.status;
      status.textContent = 'この埋め込み形式は編集できません。リンクから元を開けます。';
      wrap.addEventListener('click', (event) => {
        if (event.target.closest?.('[data-embed-action="open"]')) _open(block || {});
      });
      return wrap;
    }
    models.set(runtimeId, block);
    wrap.style.setProperty('--meldex-embed-height', block.display.height + 'px');
    wrap.dataset.embedHeader = block.display.header;
    wrap.dataset.embedInteraction = block.display.interaction;
    const viewHost = _ensureHost(options);
    if (viewHost) {
      disposers.set(runtimeId, viewHost.register(block, wrap, { mountPoint: body, runtimeBlockId: runtimeId }));
    }
    wrap.addEventListener('click', (event) => {
      const action = event.target.closest?.('[data-embed-action]')?.dataset.embedAction;
      const current = models.get(runtimeId) || block;
      if (action === 'open') _open(current);
      if (action === 'replace') _requestView(current.resourceType, current, (next) => replaceView(runtimeId, next));
      if (action === 'height') global.dispatchEvent(new CustomEvent('meldex-note-request-embed-height', {
        detail: {
          blockId: block.blockId, runtimeId, height: models.get(runtimeId)?.display.height,
          setHeight: (_blockId, height) => setHeight(runtimeId, height),
        },
      }));
    });
    return wrap;
  }
  function _requestView(resourceType, current, callback) {
    if (global.MeldexTopicViewPicker && typeof global.MeldexTopicViewPicker.open === 'function') {
      return global.MeldexTopicViewPicker.open({ resourceType, current })
        .then((value) => value ? callback(value) : null);
    }
    global.dispatchEvent(new CustomEvent('meldex-note-request-view', {
      detail: { resourceType, current: current || null, select: callback },
    }));
  }
  function _defaultBlock(resourceType, ref) {
    return _normalize(Object.assign({}, ref, {
      schemaVersion: 1, blockId: ref.blockId || _newId(), resourceType,
      display: Object.assign({ header: 'compact', height: 420, interaction: 'editable' }, ref.display),
      fallback: Object.assign({ title: resourceType === 'sheet' ? 'シート' : 'ボード', openUri: '#' }, ref.fallback),
    }));
  }
  function _findBlockElement(blockId) {
    const targetId = String(blockId || '');
    if (typeof document === 'undefined') return null;
    return Array.from(document.querySelectorAll('[data-meldex-embed-block-id]'))
      .find((element) => element.dataset.meldexEmbedRuntimeId === targetId
        || element.dataset.meldexEmbedBlockId === targetId) || null;
  }
  function _markEditorChanged(element) {
    const editable = element?.closest?.('[contenteditable="true"]');
    editable?.dispatchEvent?.(new Event('input', { bubbles: true }));
  }
  function _removedEmbedElements(node) {
    if (!node || node.nodeType !== 1) return [];
    const removed = node.matches?.('.meldex-note-embed') ? [node] : [];
    node.querySelectorAll?.('.meldex-note-embed').forEach((element) => removed.push(element));
    return removed;
  }
  function _ensureRemovalObserver(root) {
    if (!root || root._meldexNoteEmbedRemovalObserver || typeof global.MutationObserver !== 'function') return;
    const observer = new global.MutationObserver((records) => {
      const removed = [];
      records.forEach((record) => record.removedNodes?.forEach((node) => {
        removed.push(..._removedEmbedElements(node));
      }));
      if (!removed.length) return;
      // A contenteditable operation may synchronously move a block.  Check after the
      // mutation batch so a reconnected block is not mistaken for a deletion.
      queueMicrotask(() => removed.forEach((element) => {
        if (!element.isConnected) _disposeBlock(_runtimeIdForElement(element));
      }));
    });
    observer.observe(root, { childList: true, subtree: true });
    root._meldexNoteEmbedRemovalObserver = observer;
  }
  function insertEmbed(editable, range, rawBlock, options) {
    if (!editable || editable.contentEditable !== 'true' || !range) return { ok: false, reason: 'read-only' };
    const block = _normalize(rawBlock);
    _ensureRemovalObserver(editable);
    if (!options?.skipUndo && typeof global._pushCustomUndo === 'function') global._pushCustomUndo(editable);
    range.deleteContents();
    const element = createElement(block, options);
    range.insertNode(element);
    const trailing = document.createElement('div'); trailing.appendChild(document.createElement('br'));
    element.after(trailing);
    editable.dispatchEvent(new Event('input', { bubbles: true }));
    return { ok: true, block, element };
  }
  function replaceView(blockId, ref) {
    const runtimeId = _resolveRuntimeId(blockId);
    const old = models.get(runtimeId); if (!old || !ref) return false;
    const next = _defaultBlock(ref.resourceType || old.resourceType, Object.assign({}, old, ref, { blockId: old.blockId }));
    models.set(runtimeId, next);
    const element = _findBlockElement(runtimeId);
    const title = element?.querySelector?.('.meldex-note-embed-title');
    if (title) title.textContent = next.fallback.title;
    if (element) {
      element.dataset.embedHeader = next.display.header;
      element.dataset.embedInteraction = next.display.interaction;
      element.style.setProperty('--meldex-embed-height', next.display.height + 'px');
    }
    if (host) host.replaceBlock(runtimeId, next);
    _markEditorChanged(element);
    return next;
  }
  function setHeight(blockId, height) {
    const runtimeId = _resolveRuntimeId(blockId);
    const old = models.get(runtimeId); if (!old) return false;
    const next = _normalize(Object.assign({}, old, { display: Object.assign({}, old.display, { height }) }));
    models.set(runtimeId, next);
    const element = _findBlockElement(runtimeId);
    element?.style.setProperty('--meldex-embed-height', next.display.height + 'px');
    _markEditorChanged(element);
    return next;
  }
  function duplicateReference(blockId) {
    const old = models.get(_resolveRuntimeId(blockId));
    return old ? _normalize(Object.assign({}, old, { blockId: _newId() })) : null;
  }
  function removeReference(blockId) {
    const runtimeId = _resolveRuntimeId(blockId);
    const element = _findBlockElement(runtimeId);
    _disposeBlock(runtimeId); // Deliberately never deletes source data.
    element?.remove();
    return true;
  }
  // Serialize from a detached copy.  Saving must never replace the live component DOM,
  // because doing so would destroy the current selection and the mounted TopicView.
  function cloneForMarkdown(root) {
    if (!root || typeof root.cloneNode !== 'function') return root;
    const clone = root.cloneNode(true);
    clone.querySelectorAll?.('.meldex-note-embed').forEach((element) => {
      const runtimeId = _runtimeIdForElement(element);
      const model = models.get(runtimeId);
      if (!model) return;
      const ownerDocument = root.ownerDocument || document;
      element.replaceWith(ownerDocument.createTextNode('\n' + _serializer().toMarkdown(model) + '\n'));
    });
    return clone;
  }
  function _directiveContainers(root, directive) {
    const nodes = root?.querySelectorAll?.('div,p') || [];
    return Array.from(nodes).filter((node) => String(node.textContent || '').trim() === directive);
  }
  function _removeRenderedFallback(element, block) {
    const next = element?.nextElementSibling;
    if (!next || String(next.textContent || '').trim() !== String(block?.fallback?.title || '').trim()) return;
    const link = next.querySelector?.('a,.auto-link');
    if (link) next.remove();
  }
  // mdToHtml deliberately renders unknown HTML comments as escaped text.  Once the
  // normal Markdown renderer has finished, turn only validated Meldex directives
  // back into live blocks and remove their adjacent human-readable fallback link.
  function hydrate(root, markdown, options) {
    if (!root) return [];
    _ensureRemovalObserver(root);
    const created = [];
    _serializer().parseMarkdown(markdown).forEach((item) => {
      const container = _directiveContainers(root, item.directive)[0];
      if (!container) return;
      const element = createElement(item.block, options);
      if (item.editable) _removeRenderedFallback(container, item.block);
      container.replaceWith(element);
      created.push(element);
    });
    return created;
  }
  function disposeWithin(root) {
    if (!root?.querySelectorAll) return 0;
    let count = 0;
    root.querySelectorAll('.meldex-note-embed').forEach((element) => {
      if (_disposeBlock(_runtimeIdForElement(element))) count++;
    });
    return count;
  }
  function menuItems() {
    return [
      { id: 'embed-sheet', label: 'シートビュー', icon: 'table2', keywords: ['sheet', 'シート', 'ビュー'], insertOnly: true },
      { id: 'embed-board', label: 'ボードビュー', icon: 'layoutDashboard', keywords: ['board', 'ボード', 'ビュー'], insertOnly: true },
    ];
  }
  function isInsertCommand(id) { return id === 'embed-sheet' || id === 'embed-board'; }
  function insertFromCommand(id, context) {
    if (!isInsertCommand(id)) return false;
    const type = id === 'embed-sheet' ? 'sheet' : 'board';
    _requestView(type, null, (ref) => {
      if (!ref) return;
      if (typeof context.prepareInsert === 'function') context.prepareInsert();
      const selection = global.getSelection?.();
      const range = selection?.rangeCount ? selection.getRangeAt(0) : context.range;
      insertEmbed(context.editable, range, _defaultBlock(type, ref), context);
    });
    return true;
  }
  function _payload(data) {
    try { return _serializer().inspect(JSON.parse(data)); } catch (_) { return null; }
  }
  async function _transferBlock(data) {
    let raw;
    try { raw = JSON.parse(data); } catch (_) { return null; }
    const inspected = _serializer().inspect(raw);
    if (inspected.editable) return inspected.block;
    if (global.MeldexTopicViewPicker?.resolveTransferPayload) {
      return global.MeldexTopicViewPicker.resolveTransferPayload(raw);
    }
    return null;
  }
  function _bindTransfer() {
    document.addEventListener('drop', async (event) => {
      const editable = event.target.closest?.('#page-content, #entity-freetext, #dp-editable');
      const data = event.dataTransfer?.getData(MIME);
      if (!editable || !data) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const block = await _transferBlock(data);
      const range = document.caretRangeFromPoint?.(event.clientX, event.clientY);
      if (block && range) insertEmbed(editable, range, block);
    });
    document.addEventListener('paste', (event) => {
      const editable = event.target.closest?.('#page-content, #entity-freetext, #dp-editable');
      const custom = event.clipboardData?.getData(MIME);
      const markdown = event.clipboardData?.getData('text/plain') || '';
      const parsed = custom ? _payload(custom) : _serializer().parseMarkdown(markdown)[0];
      const sel = global.getSelection?.();
      if (!editable || !parsed?.editable || !sel?.rangeCount) return;
      event.preventDefault(); insertEmbed(editable, sel.getRangeAt(0), parsed.block);
    });
  }
  if (typeof document !== 'undefined') _bindTransfer();
  const api = { MIME, createElement, insertEmbed, replaceView, setHeight, duplicateReference,
    removeReference, menuItems, isInsertCommand, insertFromCommand, openOriginal: _open,
    cloneForMarkdown, hydrate, disposeWithin,
    reconnect(blockId) { return host ? host.refresh(_resolveRuntimeId(blockId)) : 0; },
    destroy() {
      Array.from(disposers.keys()).forEach(_disposeBlock);
      if (host) host.destroy();
      host = null; disposers.clear(); models.clear();
    },
    getModel: (id) => models.get(_resolveRuntimeId(id)),
    debugCounts: () => ({ models: models.size, disposers: disposers.size,
      hostEntries: host?.entries?.length || 0 }) };
  global.MeldexNoteEmbedBlock = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
