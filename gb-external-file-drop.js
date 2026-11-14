/* External drops share destination routing; app editors retain their own saves. */
(function (global) {
  'use strict';
  if (global.MeldexExternalFileDrop) return;
  const internal = type => /^application\/(?:x-meldex-|meldex-|x-gb-)/i.test(type)
    || ['text/x-tree-path','application/x-annotation','application/x-cal-event','application/x-tab-idx'].includes(type);
  const list = values => Object.assign(Array.from(values || []), {item(index) { return this[index] || null; }});
  const parent = path => { const value = String(path || '').replace(/\\/g, '/'); return value.includes('/') ? value.slice(0, value.lastIndexOf('/')) : ''; };
  const shown = element => element?.isConnected && element.getClientRects().length > 0;
  let highlighted = null;
  function clearHighlight() {
    highlighted?.removeAttribute('data-meldex-external-drop-active'); highlighted = null;
  }

  // Chromium protects the original store as soon as the drop callback returns.
  // Acquire files, directory entries and strings before any receiver can await.
  function snapshot(transfer) {
    if (typeof MeldexDnD !== 'undefined' && MeldexDnD.snapshotDataTransfer) {
      return MeldexDnD.snapshotDataTransfer(transfer);
    }
    const types = Array.from(transfer?.types || []);
    const strings = Object.fromEntries(types.filter(type => type !== 'Files').map(type => [type.toLowerCase(), transfer.getData(type)]));
    const items = list(Array.from(transfer?.items || []).map(item => {
      const file = item.kind === 'file' ? item.getAsFile?.() : null;
      const entry = item.kind === 'file' ? item.webkitGetAsEntry?.() : null;
      return {kind:item.kind, type:item.type, getAsFile:() => file, webkitGetAsEntry:() => entry,
        getAsString:callback => callback(strings[item.type.toLowerCase()] || '')};
    }));
    const result = {types, items, files:list(transfer?.files), effectAllowed:transfer.effectAllowed,
      getData:type => strings[String(type).toLowerCase()] || ''};
    Object.defineProperty(result, 'dropEffect', {get:() => transfer.dropEffect, set:value => { transfer.dropEffect = value; }});
    return result;
  }
  function external(transfer) {
    const types = Array.from(transfer?.types || []);
    return !types.some(internal) && (types.includes('Files') || types.includes('text/uri-list')
      || types.some(type => type.toLowerCase() === 'downloadurl') || types.includes('text/x-moz-url') || types.includes('text/html'));
  }
  function componentFor(element) {
    const host = element.closest('[data-tab-id]');
    const pane = element.closest('.gb-pane');
    const tab = pane && typeof GBTabs !== 'undefined' ? GBTabs.getActiveTab(pane.dataset.paneId) : null;
    const component = typeof getComponentInstance === 'function' ? getComponentInstance(host?.dataset.tabId || tab?.id) : null;
    return {tab, component, pane, state:component?.state || {}};
  }
  function defaultFolder() {
    if (typeof _homeFolderPath !== 'undefined' && _homeFolderPath) return _homeFolderPath;
    return typeof state !== 'undefined' ? state.vaultPath || '' : '';
  }
  function routeFor(element) {
    if (!element?.closest) return null;
    const fileInput = element.closest('input[type="file"]')
      || element.closest('.gb-form-input-row')?.querySelector('input[type="file"]');
    if (fileInput) return {kind:'input', target:fileInput};
    if (element.closest('.modal-overlay,[role="dialog"][aria-modal="true"]')) return null;
    const {tab, component, pane, state:local} = componentFor(element);
    const auxiliary = element.closest('.gb-subpanel') ? global.GBSubPanel?.getCurrentTarget?.() : null;
    const filePath = auxiliary?.path || tab?.path || local.scenarioPath || local.path || local.filePath
      || local.mediaPath || local.pagePath || local.boardPath || local.mapPath || '';
    const tree = element.closest('#outliner-tree');
    const folder = element.closest('#folder-view,.gb-subpanel-folder-root,.gb-folder-root');
    if (tree || folder) {
      const node = element.closest('.tree-node')?._nodeData;
      const card = element.closest('.fv-item');
      let path = node?.path || card?.dataset.path || '';
      const type = node?.type || card?.dataset.itemType || '';
      if (path && type !== 'folder' && type !== 'database') path = parent(path);
      if (!path) path = auxiliary?.path || local.folderPath || local.path || tab?.path
        || (folder && typeof _folderPath !== 'undefined' ? _folderPath : '') || defaultFolder();
      return {kind:'folder', path, type:type === 'database' ? 'database' : 'folder'};
    }
    const imageCell = element.closest('.gb-image-cell');
    if (imageCell) return {kind:'native', target:imageCell};
    const note = element.closest('#page-content,#entity-freetext,.gb-subpanel-note-content,[data-editor-local-id="page-content"]');
    const noteRoot = element.closest('#page-view,.gb-note-root,.gb-tool-editor');
    const editable = note || noteRoot?.querySelector('#page-content,[contenteditable="true"]');
    if (editable) return {kind:'native', target:editable, editable:true};
    const canvas = element.closest('#bd-canvas') || element.closest('.gb-board-root,.gb-tool-board')?.querySelector('#bd-canvas');
    if (canvas) return {kind:'native', target:canvas};
    const sheet = element.closest('#db-view-container,.gb-database-root');
    if (sheet || (tab?.type === 'database' && !auxiliary)) {
      const path = auxiliary?.path || local.dbPath || tab?.path || global.activeDatabasePath || global.currentDbPath || '';
      return {kind:'sheet', path, refreshView:async () => {
        if (sheet && !shown(sheet)) return;
        if (tab && pane && GBTabs.getActiveTab(pane.dataset.paneId)?.id !== tab.id) return;
        if (component?._embeddedSheet?.open) await component._embeddedSheet.open(path, {silent:true, forceReload:true});
        else if (typeof selectDatabase === 'function') {
          const context = pane && typeof getPaneContext === 'function' ? getPaneContext(pane.dataset.paneId) : undefined;
          await selectDatabase(path, context, {silent:true, forceReload:true});
        }
      }};
    }
    const chat = element.closest('.gb-chat-sidebar,#rp-chat,#chat-messages,#chat-input,#chat-rich-input,#team-messages,#team-input');
    if (chat && !auxiliary) {
      const mode = element.closest('#team-messages,#team-input') || (typeof _chatMode !== 'undefined' && _chatMode === 'team') ? 'team' : 'llm';
      return {kind:'chat', mode, input:mode === 'team' ? 'team-input' : 'chat-input'};
    }
    // Scenario, calendar, map, viewer, app toolbars and empty panel areas accept
    // a file beside their current document (or in Home for a documentless app).
    if (tab?.type === 'folder' && !auxiliary) {
      return {kind:'folder', type:'folder', path:local.folderPath || tab.path || defaultFolder()};
    }
    const virtualPath = /^[a-z][a-z0-9+.-]*:/i.test(filePath) && !/^[a-z]:[\\/]/i.test(filePath);
    return {kind:'folder', type:'folder', path:(!virtualPath && filePath && parent(filePath)) || defaultFolder()};
  }
  function eventFor(event, transfer) {
    return {target:event.target, dataTransfer:transfer, clientX:event.clientX, clientY:event.clientY,
      altKey:event.altKey, ctrlKey:event.ctrlKey, metaKey:event.metaKey, shiftKey:event.shiftKey,
      preventDefault() {}, stopPropagation() {}};
  }
  function pinReceiver(route) {
    if (route.kind === 'native') {
      const target = route.target, path = target.dataset.path || target.dataset.entityPath || '';
      const generation = target._openPageLoadSeq;
      const board = target.id === 'bd-canvas' && typeof bd !== 'undefined' ? [bd.path, bd._openSeq] : null;
      route.isCurrent = () => shown(target) && path === (target.dataset.path || target.dataset.entityPath || '')
        && generation === target._openPageLoadSeq && (!board || (bd.path === board[0] && bd._openSeq === board[1]));
    } else if (route.kind === 'chat') {
      const messages = typeof _chatState !== 'undefined' ? _chatState.messages : null;
      const room = typeof _teamCurrentRoom !== 'undefined' ? _teamCurrentRoom : null;
      route.isCurrent = () => (route.mode !== 'llm' || typeof _chatState === 'undefined' || _chatState.messages === messages)
        && (route.mode !== 'team' || _teamCurrentRoom === room);
    }
    return route;
  }
  function filename(value, fallback) {
    const name = String(value || '').split(/[/\\]/).pop().replace(/[<>:"|?*\x00-\x1f]/g, '_').trim();
    return name && name !== '.' && name !== '..' ? name.slice(0, 180) : fallback;
  }
  function webItem(transfer) {
    let image = '';
    const html = transfer.getData('text/html');
    if (html) {
      const parsed = new DOMParser().parseFromString(html, 'text/html');
      image = parsed.querySelector('img[src]')?.getAttribute('src') || '';
    }
    const download = transfer.getData('DownloadURL').match(/^([^:]+):([^:]*):(https?:\/\/.*)$/i);
    const uri = transfer.getData('text/uri-list').split(/\r?\n/).find(line => line.trim() && !line.startsWith('#'));
    const moz = transfer.getData('text/x-moz-url').split(/\r?\n/)[0];
    if (!image && !download && !uri && !moz) return null;
    const raw = image || download?.[3] || uri || moz || transfer.getData('text/plain');
    let url;
    try { url = new URL(raw.trim()); } catch { return null; }
    if (!['http:', 'https:', 'data:', 'blob:'].includes(url.protocol)) return null;
    let basename = url.pathname.split('/').pop() || '';
    try { basename = decodeURIComponent(basename); } catch {}
    basename = filename(basename, 'download');
    const extension = url.pathname.match(/\.([a-z0-9-]{1,24})$/i)?.[1]?.toLowerCase();
    const downloadable = !!image || !!download || url.protocol === 'data:' || url.protocol === 'blob:'
      || (!!extension && !['html','htm','xhtml','php','asp','aspx','jsp'].includes(extension));
    return {url:url.href, image:!!image, downloadable, name:filename(download?.[2], basename),
      label:url.hostname || 'リンク'};
  }
  async function webFiles(item) {
    if (!item.downloadable) {
      return [new File(['[InternetShortcut]\r\nURL=' + item.url + '\r\n'], filename(item.label, 'リンク') + '.url', {type:'application/internet-shortcut'})];
    }
    let blob, name = item.name;
    if (/^https?:/i.test(item.url)) {
      let result;
      try { result = await apiPost('/external-drop/file', {url:item.url, filename:name, image:item.image}); }
      catch (error) { throw new Error('ドロップしたファイルを取得できませんでした: ' + (error?.userMessage || error?.message || '通信エラー')); }
      if (!result?.ok || !result.data) throw new Error('ドロップしたファイルを取得できませんでした');
      const bytes = Uint8Array.from(atob(result.data), char => char.charCodeAt(0));
      blob = new Blob([bytes], {type:result.content_type}); name = result.filename;
    } else {
      const response = await fetch(item.url);
      if (!response.ok) throw new Error('ドロップした画像を取得できませんでした');
      blob = await response.blob();
    }
    if (blob.size > 25 * 1024 * 1024) throw new Error('ドロップしたファイルは25MB以下にしてください');
    if (!/\.[\w-]+$/.test(name) && blob.type.startsWith('image/')) name += '.' + ({'image/jpeg':'jpg','image/svg+xml':'svg'}[blob.type] || blob.type.split('/')[1] || 'png');
    return [new File([blob], filename(name, 'download'), {type:blob.type})];
  }
  function fileTransfer(files) {
    const transfer = new DataTransfer();
    files.forEach(file => transfer.items.add(file));
    return snapshot(transfer);
  }
  function dispatchNative(route, transfer, event) {
    if (!shown(route.target)) throw new Error('ドロップ先が閉じられたため取り込みを中止しました');
    if (route.editable && !route.target.isContentEditable) throw new Error('読み取り専用のノートへは取り込めません');
    const nativeTransfer = new DataTransfer();
    transfer.files.forEach(file => nativeTransfer.items.add(file));
    if (route.kind === 'input') {
      if (route.target.disabled) throw new Error('このファイル選択は利用できません');
      route.target.files = nativeTransfer.files;
      route.target.dispatchEvent(new Event('change', {bubbles:true}));
      return;
    }
    const rect = route.target.getBoundingClientRect();
    const drop = new DragEvent('drop', {bubbles:true, cancelable:true, dataTransfer:nativeTransfer,
      clientX:event.clientX >= rect.left && event.clientX <= rect.right ? event.clientX : rect.left + rect.width / 2,
      clientY:event.clientY >= rect.top && event.clientY <= rect.bottom ? event.clientY : rect.top + rect.height / 2});
    Object.defineProperty(drop, 'meldexExternalFileDrop', {value:true});
    Object.defineProperty(drop, 'dataTransfer', {value:transfer});
    route.target.dispatchEvent(drop);
  }
  async function receive(route, transfer, event) {
    if (route.isCurrent && !route.isCurrent()) throw new Error('ドロップ先が切り替わったため取り込みを中止しました');
    if (route.kind === 'native' || route.kind === 'input') { dispatchNative(route, transfer, event); return; }
    if (route.kind === 'chat') {
      if (typeof _chatMessageDropHandle !== 'function') throw new Error('チャットを開いてからドロップしてください');
      await _chatMessageDropHandle(eventFor(event, transfer), route.input, route.mode); return;
    }
    if (!route.path) throw new Error('先に保存先のフォルダを選択してください');
    if (typeof isItemLocked === 'function' && isItemLocked(route.path)) throw new Error('編集ロック中の保存先へは取り込めません');
    if (route.kind === 'sheet') {
      await global.MeldexSheetEntryAttachments.intakeDropToSheet(route.path, eventFor(event, transfer), {refreshView:route.refreshView}); return;
    }
    if (typeof _folderImportOsDrop !== 'function') throw new Error('ファイルの取り込み処理を利用できません');
    await _folderImportOsDrop(eventFor(event, transfer), {type:route.type, path:route.path});
  }
  function fail(error) { global.showStatus?.(error?.userMessage || error?.message || 'ファイルの取り込みに失敗しました', true); }
  document.addEventListener('dragover', event => {
    if (!external(event.dataTransfer)) return;
    const route = routeFor(event.target);
    if (!route) return;
    event.preventDefault(); event.dataTransfer.dropEffect = 'copy';
    if (route.kind !== 'native' && route.kind !== 'input') event.stopPropagation();
    const target = event.target.closest('.tree-node-row,.fv-item,#folder-grid,#chat-messages,#chat-rich-input,#db-view-container');
    if (highlighted !== target) { clearHighlight(); highlighted = target; highlighted?.setAttribute('data-meldex-external-drop-active', '1'); }
  }, true);
  document.addEventListener('dragleave', event => { if (!highlighted?.contains(event.relatedTarget)) clearHighlight(); }, true);
  document.addEventListener('dragend', clearHighlight, true);
  document.addEventListener('drop', event => {
    if (event.meldexExternalFileDrop || !external(event.dataTransfer)) return;
    clearHighlight();
    const transfer = snapshot(event.dataTransfer);
    Object.defineProperty(event, 'dataTransfer', {value:transfer});
    const route = routeFor(event.target);
    if (!route) return;
    pinReceiver(route);
    // Ordinary editor file drops keep their actual target and existing handler.
    if (transfer.files.length && route.kind === 'native' && route.target.contains(event.target)) return;
    const item = transfer.files.length || transfer.items.some(entry => entry.kind === 'file') ? null : webItem(transfer);
    if (!transfer.files.length && !transfer.items.some(entry => entry.kind === 'file') && !item) return;
    event.preventDefault(); event.stopImmediatePropagation();
    // Pin destination now: a later app/tab change cannot redirect the write.
    global.MeldexExternalFileDrop.pending = Promise.resolve(item ? webFiles(item).then(fileTransfer) : transfer)
      .then(data => receive(route, data, event)).catch(fail);
  }, true);
  // Trusted Meldex viewers use a separate document, so their drops do not
  // bubble into the app. Import beside the viewer's current file in its parent.
  function bindViewer(frame) {
    if (frame?.tagName !== 'IFRAME') return;
    let child;
    try {
      const url = new URL(frame.src, location.href);
      if (url.origin !== location.origin || !['viewer','viewer.html','pdf-viewer.html','slideshow.html'].includes(url.pathname.split('/').pop())) return;
      child = frame.contentDocument;
    } catch { return; }
    if (!child || child.meldexExternalFileDropBound) return;
    child.meldexExternalFileDropBound = true;
    child.addEventListener('dragover', event => {
      if (!external(event.dataTransfer)) return;
      event.preventDefault(); event.stopImmediatePropagation(); event.dataTransfer.dropEffect = 'copy';
    }, true);
    child.addEventListener('drop', event => {
      if (!external(event.dataTransfer)) return;
      const transfer = snapshot(event.dataTransfer), route = routeFor(frame);
      if (!route) return;
      const item = transfer.files.length ? null : webItem(transfer);
      if (!transfer.files.length && !item) return;
      event.preventDefault(); event.stopImmediatePropagation();
      global.MeldexExternalFileDrop.pending = Promise.resolve(item ? webFiles(item).then(fileTransfer) : transfer)
        .then(data => receive(route, data, event)).catch(fail);
    }, true);
  }
  document.addEventListener('load', event => bindViewer(event.target), true);
  document.querySelectorAll('iframe').forEach(bindViewer);
  global.MeldexExternalFileDrop = {snapshot, routeFor, webItem, pending:null};
}(window));
