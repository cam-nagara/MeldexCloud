/* Editor ownership is independent of focus in an inspector, menu, or rail. */
(function () {
  'use strict';
  const hosts = new Map();
  let current = null, generation = 0, syncTimer = null, pointerPending = false, needsSync = false;
  function mainStamp() {
    const paneId = window.GBPaneDefaultLayout?.resolveMainPaneId?.({ contentOnly: true });
    const tab = paneId && typeof GBTabs !== 'undefined' ? GBTabs.getActiveTab(paneId) : null;
    return tab ? [tab.id, tab.type, tab.path || ''].join('|') : '';
  }
  function get() {
    if (!current?.root?.isConnected || current.root.closest('[hidden]') || !current.root.getClientRects().length) return null;
    if (current.surface === 'subpanel' && current.mainStamp !== mainStamp()) {
      current = null; generation++; return null;
    }
    if (current.resolveCtx) current.ctx = current.resolveCtx();
    if (current.resolveComponent) current.component = current.resolveComponent();
    if (current.auto) {
      const paneId = current.root.closest('.gb-pane')?.dataset.paneId;
      const tab = typeof GBTabs !== 'undefined' ? GBTabs.getActiveTab(paneId) : null;
      if (tab?.type !== 'page') return null;
      if (current.path !== tab.path) { current = null; generation++; return null; }
    }
    return current;
  }
  function element(id) {
    const host = get();
    if (host?.root.dataset.editorLocalId === id) return host.root;
    return host?.root.querySelector('[data-editor-local-id="' + id + '"]') || document.getElementById(id);
  }
  function ownerOf(element) {
    const host = hosts.get(element?.closest?.('[data-editor-host]'));
    if (host?.resolveCtx) host.ctx = host.resolveCtx();
    if (host?.resolveComponent) host.component = host.resolveComponent();
    return host || null;
  }
  function ownsComponent(component) {
    return !!component && [...hosts.values()].some(host => host.component === component);
  }
  function bindState(host) {
    if (host.resolveCtx) host.ctx = host.resolveCtx();
    host.activate?.();
    if (host.kind === 'page') {
      const editor = host.root.querySelector('[data-editor-local-id="page-content"],#page-content');
      if (editor && typeof rtTarget !== 'undefined') {
        rtTarget = editor;
        if (host.range && editor.contains(host.range.commonAncestorContainer)) rtSavedSelection = host.range.cloneRange();
        else if (!rtSavedSelection || !editor.contains(rtSavedSelection.commonAncestorContainer)) {
          const range = document.createRange(); range.selectNodeContents(editor); range.collapse(false);
          rtSavedSelection = range;
        }
      }
    }
    if (host.ctx && typeof state !== 'undefined') {
      for (const [key, globalKey] of Object.entries({ dbPath: 'currentDbPath', pagePath: 'currentPagePath', entityPath: 'currentEntityPath', boardPath: 'currentBoardPath', pivotData: 'pivotData', viewMode: 'view' })) {
        if (host.ctx[key] != null) state[globalKey] = host.ctx[key];
      }
    }
    if (typeof state !== 'undefined' && !host.ctx) state.view = host.kind;
  }
  function sync() {
    const host = get();
    if (!host) return;
    needsSync = false;
    bindState(host);
    const path = host.path;
    window.GBOptionTargetContext?.set({ path: host.kind === 'database' ? (window.GbBacklinks?.dbFolderNotePath?.(path) || path) : path,
      contextPath: path, kind: host.kind }, 'editor-host');
    if (host.syncDetail) host.syncDetail();
    else if (typeof _syncDetailPanel === 'function') void _syncDetailPanel(host.label || path.split('/').pop(), path, host.kind);
    const scope = host.historyScope?.();
    if (scope && typeof historySetScope === 'function' && (typeof _historyActiveScope === 'undefined' || scope !== _historyActiveScope)) historySetScope(scope);
    if (typeof GBPaneBridge !== 'undefined') GBPaneBridge.syncFollowingVersionTabs?.();
    for (const id of ['rp-detail', 'rp-history', 'rp-tags', 'rp-information']) {
      window.GBOptionTargetContext?.renderHeader(document.getElementById(id), null, { caption: host.surface === 'subpanel' ? '対象 サブ' : '対象 メイン' });
    }
  }
  function activate(host) {
    if (!host?.root?.isConnected) return;
    const changed = current !== host;
    current = host;
    host.mainStamp = mainStamp();
    // Only runtime binding here: no remount, DOM replacement, or focus change.
    bindState(host);
    if (!changed) return;
    generation++;
    // Invalidate an older inspector load before this pointer's click executes.
    if (typeof _detailSyncSeq !== 'undefined') _detailSyncSeq++;
    needsSync = true;
    clearTimeout(syncTimer);
    // Pointer activation waits for click; programmatic activation uses the next task.
    if (!pointerPending) syncTimer = setTimeout(sync, 0);
  }
  function register(root, options) {
    const host = { ...options, root, editorId: options.editorId || 'editor-' + (hosts.size + 1) };
    root.dataset.editorHost = host.editorId;
    hosts.set(root, host);
    return { host, activate: () => activate(host), dispose() {
      hosts.delete(root);
      delete root.dataset.editorHost;
      if (current === host) { current = null; generation++; }
    } };
  }
  function noteEditor(root) { return root.querySelector('[data-editor-local-id="page-content"],#page-content'); }
  async function flushNote(root) {
    const editor = noteEditor(root);
    if (!editor?.dataset.path) return true;
    await _runNoteAutoSave(editor);
    return !window.MeldexNoteSaveAdapter?.isConflictPending?.(editor.dataset.path)
      && window.MeldexNoteSaveAdapter.isUnchanged(editor, _noteMarkdownFromEditor(editor));
  }
  function reloadNote(root, label, path) {
    return openPage(label, path, { containerEl: noteEditor(root), skipShowView: true, skipGlobalUi: true,
      skipStateView: true, skipNavPush: true, skipSaveLastView: true, skipRecent: true,
      skipHighlight: true, skipHistoryScope: true, skipAutoVersion: true });
  }
  function fromEvent(event) {
    if (event.type === 'pointerdown') pointerPending = true;
    const el = event.target?.nodeType === 1 ? event.target : event.target?.parentElement;
    const root = el?.closest('[data-editor-host]');
    if (root && hosts.has(root)) {
      const host = hosts.get(root);
      if (host.auto) {
        const paneId = root.closest('.gb-pane')?.dataset.paneId;
        const tab = typeof GBTabs !== 'undefined' ? GBTabs.getActiveTab(paneId) : null;
        if (tab?.type !== 'page') return;
        if (host.path !== tab.path) host.range = null;
        host.path = tab.path; host.label = tab.label;
        host.ctx = typeof getPaneContext === 'function' ? getPaneContext(paneId) : null;
        if (host.ctx) { host.ctx.pagePath = tab.path; host.ctx.viewMode = 'page'; }
      }
      activate(host); return;
    }
    const entity = el?.closest('.meldex-entity-detail[data-path]');
    const pane = el?.closest('.gb-pane');
    if (!pane || pane.matches('.gb-pane-role-left-sidebar,.gb-pane-role-right-sidebar,.gb-pane-role-chat-sidebar')) return;
    const paneId = pane.dataset.paneId;
    const tab = typeof GBTabs !== 'undefined' ? GBTabs.getActiveTab(paneId) : null;
    if (!entity && (!tab?.path || ['detail', 'history', 'version', 'subpanel', 'outliner'].includes(tab.type))) return;
    if (!entity && tab?.type === 'page') {
      const noteRoot = pane.querySelector('#page-view');
      if (noteRoot) {
        let host = hosts.get(noteRoot);
        if (!host) host = register(noteRoot, { auto: true, kind: 'page', path: tab.path, label: tab.label,
          surface: 'main', ctx: typeof getPaneContext === 'function' ? getPaneContext(paneId) : null,
          flush: () => flushNote(noteRoot), reload: () => reloadNote(noteRoot, host.label, host.path),
          historyScope: () => 'page:' + String(host.path).replace(/^\/+/, '') }).host;
        host.path = tab.path;
        if (host.ctx) { host.ctx.pagePath = tab.path; host.ctx.viewMode = 'page'; }
        activate(host);
        return;
      }
    }
    // Normal panes already own their runtime. Release only the nested owner.
    if (current) { current = null; generation++; clearTimeout(syncTimer); }
    if (entity) {
      window.GBOptionTargetContext?.set({ path: entity.dataset.path, kind: 'entity' }, 'topic-parent');
    }
  }
  function toolbar(templateId, suffix) {
    const template = document.getElementById(templateId);
    if (!template) throw new Error('アプリのツールバーを読み込めませんでした: ' + templateId);
    const bar = template.cloneNode(true);
    // Measurement state and generated overflow buttons belong to the source instance.
    bar.classList.remove('gb-toolbar-overflow-host');
    bar.querySelectorAll('.gb-toolbar-overflow-button').forEach(el => el.remove());
    bar.querySelectorAll('.gb-tbo-hidden').forEach(el => el.classList.remove('gb-tbo-hidden'));
    for (const el of [bar, ...bar.querySelectorAll('[id]')]) {
      if (!el.id) continue;
      el.dataset.editorLocalId = el.id;
      el.id += '-' + suffix;
    }
    bar.style.display = 'flex';
    bar.classList.add('gb-editor-host-toolbar');
    bar.addEventListener('mousedown', event => {
      if (event.target.closest('button')) {
        if (!get() && typeof rtCaptureSelectionFromToolbar === 'function') rtCaptureSelectionFromToolbar();
        event.preventDefault();
      }
    });
    if (typeof replaceIcons === 'function') replaceIcons(bar);
    return bar;
  }
  async function flushSurface(surface) {
    for (const host of hosts.values()) if (host.surface === surface && await host.flush?.() === false) return false;
    return true;
  }
  const normalizedPath = path => String(path || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  function matching(path) {
    const keyFor = value => window.MeldexDocumentSaveCoordinator?.documentKeyForPath?.(value);
    const key = keyFor(path);
    return [...hosts.values()].filter(host => host.root.isConnected
      && (normalizedPath(host.path) === normalizedPath(path) || (key && keyFor(host.path) === key)));
  }
  async function flushPath(path) {
    const targets = matching(path);
    for (const host of targets) {
      const result = await withBoardRuntime(host, () => host.flush?.());
      if (result === false) throw new Error('対象ファイルの未保存内容を保存できませんでした');
    }
    return targets.length;
  }
  async function withBoardRuntime(host, operation) {
    if (host.kind !== 'board') return operation();
    const previous = get();
    activate(host);
    const started = generation;
    try { return await operation(); }
    finally {
      if (current === host && generation === started && previous !== host) {
        if (previous) activate(previous);
        else returnToMain();
      }
    }
  }
  async function reloadPath(path) {
    let count = 0;
    for (const host of matching(path)) {
      if (!host.reload) continue;
      const result = await withBoardRuntime(host, () => host.reload({ skipFlush: true }));
      if (result === false) throw new Error('復元後のファイルを再読込できませんでした');
      count++;
    }
    return count;
  }
  function returnToMain() {
    const host = [...hosts.values()].find(h => h.surface !== 'subpanel' && h.root.isConnected && !h.root.closest('[hidden]') && h.root.getClientRects().length);
    if (host) {
      if (host.auto) {
        const paneId = host.root.closest('.gb-pane')?.dataset.paneId;
        const tab = GBTabs.getActiveTab(paneId);
        if (tab?.type === 'page') {
          host.path = tab.path; host.label = tab.label;
          host.ctx = typeof getPaneContext === 'function' ? getPaneContext(paneId) : null;
          if (host.ctx) { host.ctx.pagePath = tab.path; host.ctx.viewMode = 'page'; }
        }
      }
      const paneId = host.root.closest('.gb-pane')?.dataset.paneId;
      if (paneId && typeof GBLayout !== 'undefined') GBLayout.setActivePane(paneId, { skipCallback: true });
      activate(host);
    }
    else {
      current = null; generation++;
      const paneId = window.GBPaneDefaultLayout?.resolveMainPaneId?.({ contentOnly: true });
      if (paneId && typeof GBLayout !== 'undefined') GBLayout.setActivePane(paneId, { sync: true });
    }
  }
  function onPathRename(oldPath, newPath, options = {}) {
    const normalize = path => String(path || '').replace(/\\/g, '/').replace(/\/$/, '');
    const before = normalize(oldPath), after = normalize(newPath);
    if (!before || !after) return;
    const map = path => normalize(path) === before ? after : normalize(path).startsWith(before + '/') ? after + normalize(path).slice(before.length) : path;
    for (const host of hosts.values()) {
      const next = map(host.path);
      if (next === host.path && host.path !== before) continue;
      host.path = next;
      if (options.label && next === after) host.label = options.label;
      if (host.ctx) for (const key of ['pagePath', 'dbPath', 'entityPath', 'boardPath']) {
        if (host.ctx[key]) host.ctx[key] = map(host.ctx[key]);
      }
      host.root.querySelectorAll('[data-path]').forEach(el => { el.dataset.path = map(el.dataset.path); });
      Promise.resolve(host.onPathRename?.(oldPath, newPath)).catch(error => {
        if (typeof showStatus === 'function') showStatus('移動後のファイルを確認できませんでした: ' + error.message, true);
      });
      host.mainStamp = mainStamp();
    }
  }
  document.addEventListener('pointerdown', fromEvent, true);
  document.addEventListener('focusin', fromEvent, true);
  document.addEventListener('selectionchange', () => {
    const selection = window.getSelection();
    if (!selection?.rangeCount) return;
    const range = selection.getRangeAt(0);
    for (const host of hosts.values()) {
      const editor = host.root.querySelector('[data-editor-local-id="page-content"],#page-content');
      if (editor?.contains(range.commonAncestorContainer)) host.range = range.cloneRange();
    }
  });
  for (const type of ['click', 'pointerup', 'pointercancel']) document.addEventListener(type, () => {
    pointerPending = false;
    clearTimeout(syncTimer);
    if (get() && needsSync) syncTimer = setTimeout(sync, 0);
  }, true);
  window.GBEditorHost = { get, ownerOf, ownsComponent, register, activate, element, toolbar, sync, flushSurface, flushPath, reloadPath, reloadNote, returnToMain, onPathRename, generation: () => generation };
})();
