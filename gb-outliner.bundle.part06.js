  if (!newPath || oldPath === newPath || typeof _findTreeNodeByPath !== 'function') return;
  const node = _findTreeNodeByPath(oldPath);
  if (!node) return;
  const parent = _findTreeNodeByPath(_outlinerParentPath(newPath));
  const children = parent?.querySelector(':scope > .tree-children');
  if (node.parentElement?.dataset.virtual === 'true') return;
  if (children?.dataset.loaded === 'true' && children.dataset.virtual !== 'true') {
    if (typeof _renameTreeNode === 'function') _renameTreeNode(oldPath, newPath, name, fileId);
    children.appendChild(node);
  } else {
    if (typeof _unregisterTreeSubtree === 'function') _unregisterTreeSubtree(node);
    node.remove();
  }
}

function isOutlinerCopyPendingPath(path) {
  return [..._outlinerPendingCopyPreviews].some(record => typeof _folderDropPathsEqual === 'function'
    ? _folderDropPathsEqual(record.path, path)
    : _normalizeOutlinerPathForCompare(record.path) === _normalizeOutlinerPathForCompare(path));
}

function _outlinerSetCopyPendingNode(node, pending) {
  if (!node) return;
  if (pending && node.dataset.copyPending !== 'true') {
    node._copyPreviewPrevious = { inert: node.inert, opacity: node.style.opacity };
    node.dataset.copyPending = 'true'; node.inert = true; node.style.opacity = '0.62';
    node.setAttribute('aria-busy', 'true');
  } else if (!pending && node.dataset.copyPending === 'true') {
    node.inert = node._copyPreviewPrevious?.inert || false;
    node.style.opacity = node._copyPreviewPrevious?.opacity || '';
    delete node._copyPreviewPrevious; delete node.dataset.copyPending;
    node.removeAttribute('aria-busy');
  }
}

function _beginOutlinerPublishedCopyPreview(item, detail) {
  const path = detail.new_path;
  const parent = _outlinerParentPath(path);
  const same = other => typeof _folderDropPathsEqual === 'function' ? _folderDropPathsEqual(path, other) : path === other;
  const findNode = () => (typeof _findTreeNodeByPath === 'function' ? _findTreeNodeByPath(path) : null)
    || Array.from(document.querySelectorAll('.tree-node[data-path]')).find(node => same(node.dataset.path));
  const hadTree = !!findNode();
  const hadPanel = typeof _folderItems !== 'undefined' && _folderItems.some(row => same(row.path));
  const record = { path }; _outlinerPendingCopyPreviews.add(record);
  let finished = false;
  const finish = outcome => {
    if (finished) return; finished = true; _outlinerPendingCopyPreviews.delete(record);
    if (outcome === 'abandon') return; // 接続切替後の別アカウントの表示には触れない。
    const stillPending = isOutlinerCopyPendingPath(path);
    if (outcome === false && !stillPending) {
      if (!hadPanel && typeof _removeFolderItemsForPaths === 'function') _removeFolderItemsForPaths([path]);
      if (!hadTree && typeof _removeOutlinerNodesForPaths === 'function') _removeOutlinerNodesForPaths([path]);
    }
    _outlinerSetCopyPendingNode(findNode(), stillPending);
    if (typeof _folderPath !== 'undefined' && typeof _folderDropPathsEqual === 'function' && _folderDropPathsEqual(_folderPath, parent)) {
      renderFolderGrid({ preserveSelectedPaths: (typeof _folderSelectedItems !== 'undefined' ? _folderSelectedItems : []).map(row => row.path) });
    }
  };
  try {
    _folderApplySavedDropResults(parent, [{ item: { path, name: detail.new_name || item.name,
      type: item.type || 'page', kind: item.type === 'folder' ? 'folder' : 'file' } }], []);
    _outlinerSetCopyPendingNode(findNode(), true);
  } catch (error) { try { finish(false); } catch {} console.warn('[copy preview] 表示に失敗', error); }
  return finish;
}

function _outlinerRevealCopyDestination(path) {
  const node = (typeof _findTreeNodeByPath === 'function' ? _findTreeNodeByPath(path) : null)
    || Array.from(document.querySelectorAll('.tree-node[data-path]')).find(node => _folderDropPathsEqual(node.dataset.path, path));
  const toggle = node?.querySelector(':scope > .tree-node-row > .tree-toggle');
  if (toggle && toggle.dataset.expanded !== 'true') toggle.click();
}

async function _outlinerPostCopyWithPreview(route, body, item, options = {}) {
  if (typeof window.addEventListener !== 'function' || typeof window.removeEventListener !== 'function') return apiPost(route, body);
  const prepared = window.MeldexStableCopyOperationIds?.prepare?.(route, body)
    || { body: { ...body, operation_id: crypto.randomUUID() }, key: '' };
  const origin = typeof state !== 'undefined' ? state.vaultPath : '';
  let active = true, succeeded = false, finishPreview = null;
  const abandon = () => {
    active = false;
    try { finishPreview?.('abandon'); } catch {} finishPreview = null;
  };
  const published = event => {
    const detail = event.detail || {};
    if (!active || finishPreview || detail.operation_id !== prepared.body.operation_id || !detail.new_path) return;
    if ((typeof state !== 'undefined' ? state.vaultPath : '') !== origin) { abandon(); return; }
    try { finishPreview = _beginOutlinerPublishedCopyPreview(item, detail); }
    catch (error) { console.warn('[copy preview] 表示に失敗', error); }
  };
  window.addEventListener('meldex:copy-published', published);
  window.addEventListener('meldex:dropbox-auth-session-changed', abandon);
  window.addEventListener('meldex:mode-changed', abandon);
  try {
    if (options.revealTreeDestination) _outlinerRevealCopyDestination(body.dest_folder || _outlinerParentPath(body.path));
    const result = await apiPost(route, prepared.body);
    succeeded = result?.ok !== false;
    if (succeeded && active) window.MeldexStableCopyOperationIds?.complete?.(prepared.key);
    return result;
  } finally {
    window.removeEventListener('meldex:copy-published', published);
    window.removeEventListener('meldex:dropbox-auth-session-changed', abandon);
    window.removeEventListener('meldex:mode-changed', abandon);
    try { finishPreview?.(succeeded); } catch (error) { console.warn('[copy preview] 表示の確定に失敗', error); }
  }
}

async function _outlinerDuplicateItems(items, options = {}) {
  const result = { ok: 0, failed: 0, error: null, created: [] };
  // 複製を取り消せるようにする（作ったものをゴミ箱へ移す。2026-11-21 ユーザー決定の「作る操作は取り消せる」。
  // ツール・メニューの複製は記録していたが、フォルダツリー・フォルダパネルの右クリックの複製は記録していなかった:
  // 2026-11-22 M-014 フォルダツリー網羅テスト）。複数を一度に複製した時は1回の取り消しで全部を戻す。
  const historyScope = '';
  const createdItems = [];
  const reservation = typeof historyReserve === 'function' ? historyReserve('複製', historyScope) : null;
  try {
  const targets = Array.from(items || []);
  for (let offset = 0; offset < targets.length; offset += 2) {
    const outcomes = await Promise.all(targets.slice(offset, offset + 2).map(async target => {
      try { return { target, res: await _outlinerPostCopyWithPreview('/outliner/duplicate', { path: target.path }, target, options) }; }
      catch (error) { return { target, error }; }
    }));
    for (const { target, res, error } of outcomes) {
      if (error) { result.failed += 1; if (!result.error) result.error = error; continue; }
      result.ok += 1;
      const createdPath = res?.new_path || '';
      if (createdPath) {
        result.created.push(createdPath);
        createdItems.push({ path: createdPath, type: target.type || '', kind: target.type === 'folder' ? 'folder' : 'file',
          name: res?.new_name || createdPath.split('/').pop() || createdPath });
        try {
          if (typeof _folderApplySavedDropResults === 'function') {
            _folderApplySavedDropResults(_outlinerParentPath(createdPath), [{ item: createdItems[createdItems.length - 1] }], []);
          }
        } catch (error) { console.warn('[duplicate] 保存済みの表示反映に失敗', error); }
      }
    }
  }
  const register = () => {
  if (createdItems.length === 1 && typeof pushCreatedOutlinerItemHistory === 'function') {
    pushCreatedOutlinerItemHistory(createdItems[0], '複製: ' + createdItems[0].name, { scope: historyScope, ...(typeof options.refresh === 'function' ? { refresh: options.refresh } : {}) });
  } else if (createdItems.length > 1) {
    _pushCreatedOutlinerItemsHistory(createdItems, `複製: ${createdItems.length} 件`, historyScope, options);
  }
  };
  if (reservation) reservation.capture(register); else register();
  return result;
  } finally { reservation?.cancel(); }
}

// 複数の作ったものを1つの取り消しの記録にする（取り消し=全部をゴミ箱へ、やり直し=ゴミ箱から全部戻す）。
function _pushCreatedOutlinerItemsHistory(createdItems, label, scope, options = {}) {
  if (typeof historyPush !== 'function' || !createdItems.length) return null;
  const records = createdItems.map(item => ({ ...item, trashRef: null }));
  const refresh = async () => {
    if (typeof options.refresh === 'function') { await options.refresh(); return; }
    await _outlinerSyncFoldersOrReload(records.map(record => _outlinerParentPath(record.path)));
  };
  const entry = historyPush(label,
    async () => {
      // 一部だけ移せた時も、成功した画像のごみ箱参照を保持して残りだけを再試行する。
      const pending = records.filter(record => !record.trashRef);
      if (!pending.length) { await refresh(); return; }
      const targets = pending.map(record => ({ path: record.path, kind: record.kind }));
      const warning = typeof MeldexDeleteImpactWarning !== 'undefined' ? MeldexDeleteImpactWarning : null;
      const confirmation = warning?.authorizeReversibleDelete ? await warning.authorizeReversibleDelete(targets) : { confirmed: true, operation: 'trash' };
      if (!confirmation) throw new Error('参照の確認ができなかったため取り消しを中止しました');
      const results = await _deleteOutlinerTargetsSequentially(targets, { confirmation, silentError: true });
      const failures = [];
      pending.forEach((record, index) => {
        const outcome = results[index];
        const ref = outcome?.status === 'fulfilled' ? _outlinerTrashRefFromResponse(outcome.value) : null;
        if (ref) record.trashRef = ref; else failures.push(record);
      });
      await refresh();
      if (failures.length) throw new Error(`${failures.length} 件をゴミ箱へ移せませんでした`);
    },
    async () => {
      const failures = [];
      for (const record of records) {
        if (!record.trashRef) continue;
        try {
          const restored = await apiPost('/outliner/restore', {
            trash_name: record.trashRef.trash_name,
            ...(record.trashRef.trash_root ? { trash_root: record.trashRef.trash_root } : {}),
          }, { silentError: true });
          record.path = restored?.restored_to || restored?.restored_path || record.path;
          record.trashRef = null;
        } catch (error) { failures.push(error); }
      }
      await refresh();
      if (failures.length) throw new Error(`${failures.length} 件をゴミ箱から戻せませんでした`);
    },
    scope);
  if (typeof historyMarkFileEffects === 'function') historyMarkFileEffects(entry, { undoDeletes: records.map(record => record.path) });
  return entry;
}

function _outlinerReportBatchResult(result, verbDone, failMessage) {
  const reason = result.failed ? _outlinerFailureReason(result.error) : '';
  const suffix = reason ? `：${reason}` : '';
  if (!result.failed) {
    showStatus(`${result.ok}件を${verbDone}`);
  } else if (!result.ok) {
    showStatus(`${failMessage}${suffix}`, true);
  } else {
    showStatus(`${result.ok}件を${verbDone}。${result.failed}件は失敗しました${suffix}`, true);
  }
}

async function _outlinerRunDuplicate(items) {
  const result = await _outlinerDuplicateItems(items);
  if (result.ok > 0) {
    // 複製は元と同じフォルダにできる。そのフォルダだけを差分で反映する（全体の読み直しをしない）。
    try { await _outlinerSyncFoldersOrReload((items || []).map(item => _outlinerParentPath(item.path))); }
    catch (error) { console.error('[outliner duplicate] 表示の更新に失敗', error); }
  }
  _outlinerReportBatchResult(result, '複製しました', '複製に失敗しました');
  return result;
}

// ソースフォルダの表示名変更。失敗は原因つきで表示し、成功表示は保存と再読込の後だけ。
async function _outlinerRenameSourceFolder(nodeData) {
  let reservation = null;
  try {
    const roots = await apiFetch('/outliner-roots');
    const baseRoots = _cloneOutlinerRootsForBase(roots);
    const root = roots.find(r => r.path === nodeData.path);
    if (!root) {
      showStatus('名前を変更できませんでした：ソースフォルダの登録が見つかりません', true);
      return false;
    }
    const newName = await cfPrompt('表示名を入力:', root.name);
    if (!newName) return false;
    reservation = typeof historyReserve === 'function' ? historyReserve('設定: ソースフォルダ表示名', '') : null;
    const before = await captureOutlinerRootsSettingsSnapshot();
    root.name = newName;
    await _putOutlinerRootsWithBase(roots, baseRoots);
    const after = { ...before, roots };
    const register = () => pushOutlinerRootsSettingsHistory('設定: ソースフォルダ表示名', before, after, newName, '');
    if (reservation) reservation.capture(register); else register();
    await loadOutliner();
    showStatus('名前を変更しました');
    return true;
  } catch (error) {
    console.warn('[outliner source folder] 名前の変更に失敗（画面に原因を表示済み）', error);
    _outlinerReportFailure('名前を変更できませんでした', error);
    return false;
  } finally {
    reservation?.cancel();
  }
}

async function _outlinerUnregisterSourceFolder(nodeData) {
  let reservation = null;
  try {
    // 実際に消えるのはフォルダツリーの一覧からだけ。フォルダ本体とファイルは
    // 消えない（gb-settings-cloud-link.js の confirmDeleteSourceFolder と同じ言い回しに揃える）。
    if (!await cfConfirm('ソースフォルダ「' + nodeData.name + '」の登録を解除しますか？\n（フォルダとファイルはそのまま残ります。フォルダツリーの一覧から外れるだけです）', { okLabel: '登録解除' })) return false;
    const roots = await apiFetch('/outliner-roots');
    const baseRoots = _cloneOutlinerRootsForBase(roots);
    const newRoots = roots.filter(r => r.path !== nodeData.path);
    if (newRoots.length === roots.length) {
      showStatus('登録を解除できませんでした：ソースフォルダの登録が見つかりません', true);
      return false;
    }
    reservation = typeof historyReserve === 'function' ? historyReserve('設定: ソースフォルダ登録解除', '') : null;
    const before = await captureOutlinerRootsSettingsSnapshot();
    await _putOutlinerRootsWithBase(newRoots, baseRoots);
    const after = { ...before, roots: newRoots };
    const register = () => pushOutlinerRootsSettingsHistory('設定: ソースフォルダ登録解除', before, after, nodeData.name, '');
    if (reservation) reservation.capture(register); else register();
    await loadOutliner();
    showStatus('ソースフォルダの登録を解除しました');
    return true;
  } catch (error) {
    console.warn('[outliner source folder] 登録解除に失敗（画面に原因を表示済み）', error);
    _outlinerReportFailure('ソースフォルダの登録を解除できませんでした', error);
    return false;
  } finally {
    reservation?.cancel();
  }
}

async function _outlinerCopyLink(nodeData) {
  const linkPath = nodeData?.path;
  if (!linkPath) return false;
  const linkName = nodeData.name || linkPath.split(/[/\\]/).pop() || linkPath;
  if (typeof MeldexBroadcast === 'undefined' || typeof MeldexBroadcast.copyMeldexLink !== 'function') {
    showStatus('リンクをコピーできませんでした：この画面ではコピー機能を使えません', true);
    return false;
  }
  try {
    const ok = await MeldexBroadcast.copyMeldexLink(linkName, linkPath, nodeData.type);
    if (ok) showStatus('リンクをコピーしました');
    else showStatus('リンクをコピーできませんでした：クリップボードに書き込めませんでした', true);
    return !!ok;
  } catch (error) {
    _outlinerReportFailure('リンクをコピーできませんでした', error);
    return false;
  }
}

function _outlinerAppendMenuSeparator(menu) {
  const separator = document.createElement('div');
  separator.className = 'gb-context-menu-sep cm-sep';
  separator.setAttribute('role', 'separator');
  menu.appendChild(separator);
  return separator;
}

function _outlinerAppendSubmenu(menu, label, icon, panel) {
  const trigger = _outlinerAppendMenuItem(menu, { label, icon, hasSubmenu: true, className: 'tree-ctx-item' });
  const setExpanded = (expanded) => trigger.setAttribute('aria-expanded', expanded ? 'true' : 'false');
  trigger.addEventListener('mouseenter', () => setExpanded(true));
  trigger.addEventListener('mouseleave', () => setTimeout(() => {
    if (panel.style.display === 'none') setExpanded(false);
  }, 220));
  trigger.addEventListener('click', () => {
    trigger.dispatchEvent(new MouseEvent('mouseenter', { cancelable: true }));
    setExpanded(true);
  });
  panel.addEventListener('mouseenter', () => setExpanded(true));
  panel.addEventListener('mouseleave', () => setExpanded(false));
  attachHoverSubmenu(trigger, panel);
  return trigger;
}

function _outlinerPlaceContextMenu(menu) {
  document.body.appendChild(menu);
  const rect = menu.getBoundingClientRect();
  const z = _getZoom();
  if (rect.right > window.innerWidth) menu.style.left = ((window.innerWidth - rect.width - 4) / z) + 'px';
  if (rect.bottom > window.innerHeight) menu.style.top = ((window.innerHeight - rect.height - 4) / z) + 'px';
  if (typeof clampPopupToViewport === 'function') clampPopupToViewport(menu);
  const first = menu.querySelector('button.gb-context-menu-item:not(:disabled)');
  first?.focus?.({ preventScroll: true });
  _outlinerBindContextMenuClose(menu);
}

function _outlinerBindContextMenuClose(menu) {
  let removed = false;
  let pointerArmed = false;
  const cleanup = () => {
    if (removed) return;
    removed = true;
    document.removeEventListener('keydown', keyHandler, true);
    if (pointerArmed) document.removeEventListener('pointerdown', pointerHandler, true);
    _outlinerContextMenuCleanups.delete(cleanup);
  };
  const keyHandler = (event) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    closeTreeContextMenu();
  };
  const pointerHandler = (event) => {
    const inAnyMenu = [...document.querySelectorAll('.gb-context-menu')].some(m => m.contains(event.target));
    if (!inAnyMenu) closeTreeContextMenu();
  };
  _outlinerContextMenuCleanups.add(cleanup);
  document.addEventListener('keydown', keyHandler, true);
  pointerArmed = true;
  document.addEventListener('pointerdown', pointerHandler, true);
}

async function _refreshOutlinerSort() {
  const results = await refreshOutliner({ force: true, reason: 'outliner-sort' });
  if (results?.some(result => result.status === 'rejected')) showStatus('並び順を保存しましたが、ツリーの一部を更新できませんでした', true);
  if (typeof renderFolderGrid === 'function' && typeof _folderPath !== 'undefined' && _folderPath) {
    await renderFolderGrid({ preserveSelectedPaths: _folderSelectedItems.map(item => item?.path).filter(Boolean) });
  }
}

function showOutlinerSortMenu(event) {
  event?.preventDefault();
  event?.stopPropagation();
  closeTreeContextMenu();
  const trigger = document.getElementById('btn-tree-sort');
  if (!trigger) return;
  const rect = trigger.getBoundingClientRect();
  const zoom = parseFloat(document.documentElement.style.zoom) || 1;
  const menu = _outlinerCreateContextMenu('フォルダツリーの並べ替え', rect.left / zoom, rect.bottom / zoom);
  menu.dataset.e2eId = 'outliner-sort-menu';
  const current = getSortSettings()._tree || { sort: 'manual', order: 'asc' };
  getFolderSortOptions().forEach(option => {
    const active = current.sort === option.sort && current.order === option.order;
    const button = _outlinerAppendMenuItem(menu, {
      label: option.label, checked: active, role: 'menuitemradio',
      action: async () => {
        closeTreeContextMenu();
        const keys = [SORT_SETTINGS_KEY, MANUAL_ORDER_KEY];
        const before = captureOutlinerSettingsHistory(keys);
        const settings = getSortSettings();
        Object.keys(settings).forEach(key => { settings[key] = { sort: option.sort, order: option.order }; });
        settings._tree = { sort: option.sort, order: option.order };
        localStorage.setItem(SORT_SETTINGS_KEY, JSON.stringify(settings));
        if (typeof pushLocalStorageSettingsHistory === 'function') {
          pushLocalStorageSettingsHistory('フォルダツリー: 並べ替え設定', before,
            captureOutlinerSettingsHistory(keys), option.label, _refreshOutlinerSort);
        }
        await _refreshOutlinerSort();
      },
    });
    button.dataset.sort = option.sort;
    button.dataset.order = option.order;
    button.setAttribute('aria-checked', active ? 'true' : 'false');
  });
  _outlinerPlaceContextMenu(menu);
}

function _showTreeAddMenu(x, y, nodeEl, nodeData) {
  closeTreeContextMenu();
  const menu = _outlinerCreateContextMenu('フォルダツリー新規作成', x, y);
  // シートを選んでいるときは、シートの中に作れる「エントリ」を先頭に出す。
  // ほかの項目はシートの中には作らず、シートと同じ階層に作る。
  if (nodeData?.type === 'database' && nodeData.path) {
    _outlinerAppendMenuItem(menu, {
      label: 'トピック',
      icon: 'plus',
      action: async () => { closeTreeContextMenu(); await addSheetEntryAt(nodeData.path); },
    });
    _outlinerAppendMenuSeparator(menu);
  }
  _cloudPhase1CreateItems([['フォルダ','folder','folder'],['ノート','page','page'],['シナリオ','scriptnote','bookOpenText'],['シート','database','db'],['ボード','board','presentation'],['フォーム','form-app','clipboardList'],['マップ','map','map']]).forEach(([label,type,icon]) => {
    _outlinerAppendMenuItem(menu, {
      label,
      icon,
      action: async () => {
        closeTreeContextMenu();
        await addItemAt(getAddParentPath(nodeEl, nodeData, { insideTarget: true, itemType: type }), type, { anchorNode: nodeEl });
      },
    });
  });
  _outlinerPlaceContextMenu(menu);
}

// --- 右クリックメニュー ---
function closeTreeContextMenu() {
  _outlinerContextMenuOpenSeq += 1;
  _outlinerContextMenuCleanups.forEach(cleanup => {
    try { cleanup(); } catch {}
  });
  _outlinerContextMenuCleanups.clear();
  document.querySelectorAll('.gb-context-menu').forEach(el => el.remove());
}

// gb-path-utils.js（window.GBPathUtils）へ委譲。未ロード時は同等ロジックへフォールバックする。
function _outlinerPathIsAbsolute(path) {
  if (window.GBPathUtils?.isAbsolute) return window.GBPathUtils.isAbsolute(path);
  const value = String(path || '');
  return /^[a-zA-Z]:[\\/]/.test(value) || /^[/\\]{2}/.test(value) || value.startsWith('/');
}

function _outlinerJoinPath(base, rel) {
  if (window.GBPathUtils?.join) return window.GBPathUtils.join(base, rel);
  const left = String(base || '').replace(/[\\/]+$/, '');
  const right = String(rel || '').replace(/^[\\/]+/, '');
  if (!left) return right;
  if (!right) return left;
  return left + '/' + right;
}

function _outlinerNativeClipboardPath(path) {
  if (window.GBPathUtils?.toNativeClipboard) return window.GBPathUtils.toNativeClipboard(path);
  const value = String(path || '');
  if (/^[a-zA-Z]:[\\/]/.test(value)) return value.replace(/\//g, '\\');
  if (/^[/\\]{2}/.test(value)) return '\\\\' + value.replace(/^[/\\]+/, '').replace(/\//g, '\\');
  return value;
}

function _outlinerLocalCopyPath(nodeEl, nodeData) {
  let path = String(nodeData?.path || '');
  if (!path) return '';
  if (!_outlinerPathIsAbsolute(path)) {
    const rootNode = nodeEl?.closest?.('#outliner-tree > .tree-node');
    const rootPath = rootNode?._nodeData?.path || '';
    const base = nodeEl?.closest?.('#body-home') && _homeFolderPath
      ? _homeFolderPath
      : (rootPath || (typeof state !== 'undefined' ? state.vaultPath : ''));
    if (base && _outlinerPathIsAbsolute(base)) path = _outlinerJoinPath(base, path);
  }
  return _outlinerNativeClipboardPath(path);
}

// フォルダツリーの右クリックからのコピー・切り取りの元（貼り付けの後に差分で反映するフォルダを決める）
let _outlinerClipboardOrigin = null;

// フォルダツリーの右クリックの貼り付けの後の反映。貼り付け先（と切り取りの元）のフォルダだけを差分で反映し、
// 全体の読み直しをしない（2026-11-22 M-014: 以前は2〜2.5秒）。フォルダパネルで開いているフォルダも読み直す。
// コピー・切り取りの元がツリー以外（フォルダパネル等）で分からない時は、差分の反映の後にツリー全体を裏で読み直す。
// 取り消し・やり直し（引数なし）の時は従来どおりツリー全体を読み直す。
async function _outlinerRefreshAfterTreePaste(destFolder, pastedPaths) {
  const panelRefresh = async () => {
    if (typeof _folderRefreshCurrentFolder === 'function' && typeof state !== 'undefined' && state.view === 'folder') {
      try { await _folderRefreshCurrentFolder(); } catch (error) { console.warn('[outliner paste] フォルダパネルの更新に失敗', error); }
    }
  };
  if (!Array.isArray(pastedPaths)) {
    if (typeof refreshOutliner === 'function') await refreshOutliner({ force: true, reason: 'outliner-paste-history' });
    await panelRefresh();
    return;
  }
  const origin = _outlinerClipboardOrigin;
  const folders = [destFolder];
  if (origin?.mode === 'cut') origin.paths.forEach(path => folders.push(_outlinerParentPath(path)));
  await _outlinerSyncFoldersOrReload(folders);
  // 次の貼り付けでは、その間にフォルダパネル等でコピー・切り取りされたかもしれないので、元が分からない扱いにする
  _outlinerClipboardOrigin = null;
  await panelRefresh();
  if (!origin && typeof refreshOutliner === 'function') {
    setTimeout(() => { refreshOutliner({ force: true, reason: 'outliner-paste-unknown-origin' }).catch?.(() => {}); }, 0);
  }
}

// フォルダツリーの選択中の項目を削除する（右クリックの削除・Delete キーの共通の入口）。
// 途中の失敗は原因つきで表示する（以前は右クリックの削除ボタンが例外を受け止めず、失敗が画面に出なかった:
// 2026-11-22 M-014 フォルダツリー網羅テスト）。削除済みと対象なしが混ざった時も表示を読み直す。
async function deleteOutlinerTreeSelection() {
  try {
      const targets = treeSelection.getNodeData().filter(item => {
        if (item.type === 'entity' || item._isRoot) return false;
        return item.path && !isItemLocked(item.path);
      });
      if (!targets.length) {
        showStatus('削除できる項目がありません', true);
        return;
      }
      // handleDisplayedFolderLinkDelete は gb-folder-link-batch.js 側の定義。読み込み漏れ等で
      // 未定義の場合にReferenceErrorで削除処理全体が止まらないよう、存在確認してから呼ぶ
      // （2026-08-19 実UI検査: 同スクリプトがMeldex.htmlに読み込まれておらず、フォルダツリーの
      // 削除ボタンがクリックしても無反応のまま静かに失敗していた）。
      const linkedDelete = typeof handleDisplayedFolderLinkDelete === 'function'
        ? await handleDisplayedFolderLinkDelete(targets, '', {
          refresh: async () => {
            if (typeof loadOutliner === 'function') await loadOutliner();
            if (typeof renderHomeFolderTree === 'function') renderHomeFolderTree();
            if (typeof renderWorkspaceSidebar === 'function') renderWorkspaceSidebar();
          },
        })
        : { handled: false, result: null };
      if (linkedDelete.handled) {
        if (linkedDelete.result) treeSelection.clear();
        return;
      }
      const names = targets.map(item => item.name).join('、');
      treeSelection.clear();
      const result = await deleteOutlinerItemsWithHistory(targets, {
        label: targets.length + ' 件を削除',
        detail: names,
        onItemDeleted: (item) => {
          _removeOutlinerNodesForPaths([item.path]);
        },
        refresh: async () => {
          if (typeof loadOutliner === 'function') await loadOutliner();
          if (typeof renderHomeFolderTree === 'function') renderHomeFolderTree();
          if (typeof renderWorkspaceSidebar === 'function') renderWorkspaceSidebar();
        },
      });
      _removeOutlinerNodesForPaths(result.deletedPaths);
      _outlinerRefreshFolderPanelFor((result.deletedPaths || []).map(path => _outlinerParentPath(path)));
      if (result.failedCount) {
        const reason = result.failed?.[0]?.error;
        const detail = typeof reason === 'string' ? reason : reason?.message || reason?.detail?.message || reason?.detail || '';
        showStatus(`${result.deletedCount || result.succeeded.length}件を削除、${result.failedCount}件は失敗しました${detail ? ': ' + detail : ''}`, true);
        loadOutliner();
      } else if (result.succeeded.length) {
        showStatus(`${result.deletedCount || result.succeeded.length}件を削除しました（Undoで戻せます）`);
        // 先に画面から消した中に「見つからなかった」項目が混ざっていたら、実際の状態へ読み直す
        if (result.skipped.length) loadOutliner();
      } else if (result.skipped.length) {
        showStatus('削除対象が見つからなかったため、表示を更新しました', true);
        loadOutliner();
      }
  
  } catch (error) {
    if (typeof console !== 'undefined') console.error('[outliner] 削除に失敗', error);
    _outlinerReportFailure('削除に失敗しました', error);
  }
}

async function showTreeContextMenu(x, y, nodeEl, nodeData, labelEl) {
  closeTreeContextMenu();
  const openSeq = ++_outlinerContextMenuOpenSeq;
  const menu = _outlinerCreateContextMenu('フォルダツリーメニュー', x, y);

  const selectedCount = treeSelection.items.size;
  const isMulti = selectedCount > 1;
  const isFolder = nodeData.type === 'folder';
  const isDB = nodeData.type === 'database';
  const isEntity = nodeData.type === 'entity';

  function addMenuItem(text, onclick, cls, icon, targetMenu = menu) {
    return _outlinerAppendMenuItem(targetMenu, {
      label: text,
      icon,
      danger: cls === 'danger',
      className: cls && cls !== 'danger' ? cls : '',
      action: onclick,
    });
  }
  function addSep() {
    _outlinerAppendMenuSeparator(menu);
  }

  // 複数選択時は先頭に件数見出しを置く（フォルダパネルの複数選択メニューと同じ）。
  if (isMulti) {
    menu.dataset.folderMultiSelection = String(selectedCount);
    const heading = document.createElement('div');
    heading.className = 'gb-context-menu-label';
    heading.dataset.e2eId = 'folder-tree-context-selection-count';
    heading.textContent = `${selectedCount}件を選択中`;
    menu.appendChild(heading);
  }

  const addParent = getAddParentPath(nodeEl, nodeData, { insideTarget: true });
  const contextOperationItems = (isMulti ? treeSelection.getNodeData() : [nodeData])
    .filter(item => item?.path && item.type !== 'entity' && !item._isRoot);
  const editableContextItems = contextOperationItems.filter(item => !isItemLocked(item.path));
  const deleteContextItems = async () => {
    closeTreeContextMenu();
    await deleteOutlinerTreeSelection();
  };

  if (typeof appendFolderOperationButtons === 'function') {
    appendFolderOperationButtons(menu, {
      e2ePrefix: 'folder-tree-context',
      closeMenu: closeTreeContextMenu,
      onCopy: () => { _outlinerClipboardOrigin = { mode: 'copy', paths: contextOperationItems.map(item => item.path) }; folderToolbarCopyItems(contextOperationItems); },
      onCut: () => { _outlinerClipboardOrigin = { mode: 'cut', paths: editableContextItems.map(item => item.path) }; folderToolbarCutItems(contextOperationItems); },
      onPaste: () => folderToolbarPasteToFolder(addParent, { revealTreeDestination: true, refresh: pasted => _outlinerRefreshAfterTreePaste(addParent, pasted) }),
      onDuplicate: () => _outlinerRunDuplicate(editableContextItems),
      onDelete: deleteContextItems,
      copyDisabled: contextOperationItems.length === 0,
      cutDisabled: editableContextItems.length === 0,
      pasteDisabled: !folderToolbarCanPasteTo(addParent),
      duplicateDisabled: editableContextItems.length === 0,
      deleteDisabled: editableContextItems.length === 0,
    });
    addSep();
  }

  if (!isMulti && isEntity && window.MeldexTopicPlacementUI) {
    const topicSource = window.MeldexTopicPlacementUI.treeSource(nodeData);
    if (topicSource) {
      window.MeldexTopicPlacementUI.menuItems(topicSource).forEach(item => {
        addMenuItem(item.label, () => {
          closeTreeContextMenu();
          item.action();
        }, null, item.icon);
      });
      addSep();
    }
  }

  if (isMulti) {
    addMenuItem(`プロパティ（${selectedCount}件）`, () => {
      closeTreeContextMenu();
      return showFolderSelectionProperties(treeSelection.getNodeData(), nodeEl);
    }, null, 'info');
    if (window.isAutoTagRuntimeAvailable?.() === true && contextOperationItems.length) {
      addMenuItem(`自動タグ付け（${selectedCount}件）`, () => {
        closeTreeContextMenu();
        fvBulkAutoTag(contextOperationItems);
      }, null, 'tags');
    }
    addSep();
  }

  // --- 新規作成サブメニュー ---（作成先が押した1項目で決まるため、複数選択時は出さない）
  if (!isMulti && !(addParent && isItemLocked(addParent))) {
    const createPanel = _outlinerCreateSubmenu('フォルダツリー新規作成');
    _outlinerAppendSubmenu(menu, '新規作成', 'plus', createPanel);
    _cloudPhase1CreateItems([['フォルダ','folder','folder'],['ノート','page','page'],['シナリオ','scriptnote','bookOpenText'],['シート','database','db'],['ボード','board','presentation'],['フォーム','form-app','clipboardList'],['マップ','map','map']]).forEach(([label,type,icon]) => {
      _outlinerAppendMenuItem(createPanel, {
        label,
        icon,
        action: async () => { closeTreeContextMenu(); await addItemAt(addParent, type); },
      });
    });
  }
  addSep();

  // --- 開く系は利用頻度が高いため、上部の1つのサブメニューへ集約する ---
  if (!isMulti && nodeData.path && !nodeData._isRoot) {
    const openType = typeof _normalizeOpenTypeForNav === 'function'
      ? _normalizeOpenTypeForNav(nodeData.type)
      : (nodeData.type === 'database' ? 'pivot' : (nodeData.type === 'scenario' ? 'scriptnote' : (nodeData.type || 'page')));
    const openUrl = '/?open=' + encodeURIComponent(openType) + '&path=' + encodeURIComponent(nodeData.path) + '&label=' + encodeURIComponent(nodeData.name || '');
    const canUseRightSidebar = typeof GBPaneBridge === 'undefined'
      || typeof GBPaneBridge.canUseRightSidebarTools !== 'function'
      || typeof GBPaneBridge.surfaceOf !== 'function'
      || GBPaneBridge.canUseRightSidebarTools(GBPaneBridge.surfaceOf(nodeEl));
    const openPanel = _outlinerCreateSubmenu('開く');
    _outlinerAppendSubmenu(menu, '開く', 'folderOpen', openPanel);
    _outlinerAppendMenuItem(openPanel, {
      label: 'メインパネルで開く', icon: 'panelTop', action: () => {
        closeTreeContextMenu();
        window.GBOutlinerActivation?.activateNode(nodeEl);
      },
    });
    _outlinerAppendMenuItem(openPanel, {
      label: '新しいタブで開く', icon: 'externalLink', action: () => {
        closeTreeContextMenu();
        _openInNewTab(nodeData.name || '', nodeData.path, openType);
      },
    });
    if (canUseRightSidebar && typeof openLinkedPathInRightSidebar === 'function') {
      _outlinerAppendMenuItem(openPanel, {
        label: 'サブパネルで開く', icon: 'panelRight', action: () => {
          closeTreeContextMenu();
          openLinkedPathInRightSidebar(nodeData.path, nodeData.name, { linkType: nodeData.type, sourceEl: nodeEl });
        },
      });
    }
    if (typeof openLinkedPathStandalone === 'function'
        && (typeof canOpenLinkedPathStandalone !== 'function' || canOpenLinkedPathStandalone(nodeData.path, nodeData.type))) {
      _outlinerAppendMenuItem(openPanel, {
        label: '単独アプリで開く', icon: 'appWindow', action: () => {
          closeTreeContextMenu();
          openLinkedPathStandalone(nodeData.path, nodeData.name, { linkType: nodeData.type });
        },
      });
    }
    _outlinerAppendMenuItem(openPanel, {
      label: '新しいウィンドウで開く', icon: 'monitor', action: () => {
        closeTreeContextMenu();
        if (typeof _open_app_window_js === 'function') _open_app_window_js(openUrl);
        else window.open(openUrl, '_blank', 'width=1200,height=800,menubar=no,toolbar=no,location=no');
      },
    });
    if (!isFolder && typeof openNative === 'function') {
      const needsExternalApp = !(typeof NATIVE_TYPES !== 'undefined' && NATIVE_TYPES.has(nodeData.type));
      addMenuItem('アプリで開く', () => {
          closeTreeContextMenu();
          openNative(nodeData.path);
        }, null, needsExternalApp ? 'externalLink' : 'appWindow', openPanel);
    }
    if (nodeData.type === 'image') {
      _outlinerAppendMenuItem(openPanel, {
        label: 'ビューワーで開く', icon: 'image', action: () => {
          closeTreeContextMenu();
          if (typeof openViewer === 'function') openViewer('/viewer?file=' + encodeURIComponent(nodeData.path));
        },
      });
      if (typeof openImageInCanvas === 'function') {
        _outlinerAppendMenuItem(openPanel, {
          label: 'ボードで開く', icon: 'presentation', action: () => {
            closeTreeContextMenu();
            openImageInCanvas(nodeData);
          },
        });
      }
    }
    if ((nodeData.type === 'scriptnote') || (typeof isScriptNotePath === 'function' && isScriptNotePath(nodeData.path))) {
      _outlinerAppendMenuItem(openPanel, {
        label: 'シナリオで開く', icon: 'fileText', action: () => {
          closeTreeContextMenu();
          if (typeof openScenarioInScriptNote === 'function' && openScenarioInScriptNote(nodeData.path, nodeData.name || '', { fromExplorer: true })) return;
          showStatus('シナリオエディタを開けませんでした', true);
        },
      });
    } else if (nodeData.type === 'scenario') {
      _outlinerAppendMenuItem(openPanel, {
        label: 'シナリオへ取り込んで開く', icon: 'fileText', action: () => {
          closeTreeContextMenu();
          if (typeof openScenarioInScriptNote === 'function' && openScenarioInScriptNote(nodeData.path, nodeData.name || '', { fromExplorer: true })) return;
          showStatus('シナリオエディタを開けませんでした', true);
        },
      });
    }
    addSep();
  }

  if (!isMulti && nodeData.path && !nodeData._isRoot
      && typeof canShowContainedFiles === 'function' && canShowContainedFiles(nodeData)) {
    addMenuItem('ファイル内のファイルを表示', () => {
      closeTreeContextMenu();
      showContainedFiles(nodeData);
    }, null, 'files');
    addSep();
  }

  // --- 編集ロック ---
  if (!isMulti && window.MeldexFileIcons?.canEdit(nodeData) && !isItemLocked(nodeData.path)) {
    addMenuItem('アイコンを変更', () => {
      closeTreeContextMenu();
      window.MeldexFileIcons.openPicker(nodeData, nodeEl.querySelector('.tree-icon') || nodeEl);
    }, null, 'smile');
    addSep();
  }
  if (!isMulti && nodeData.path && !isEntity) {
    const locked = isItemLocked(nodeData.path);
    const systemLocked = typeof isSystemLockedItem === 'function' && isSystemLockedItem(nodeData.path);
    const canEditLock = typeof isFileLockOwner === 'function' && isFileLockOwner();
    if (systemLocked) {
      const lockedItem = addMenuItem('システム保護', () => {}, null, 'lock');
      lockedItem.style.opacity = '0.65';
      lockedItem.style.cursor = 'default';
      lockedItem.title = 'システム保護中です';
      lockedItem.dataset.gbTooltip = lockedItem.title;
    } else if (!canEditLock) {
      const lockedItem = addMenuItem(locked ? '編集ロック中' : '編集ロック（管理者のみ）', () => {}, null, 'lock');
      lockedItem.style.opacity = '0.65';
      lockedItem.style.cursor = 'default';
      lockedItem.title = '編集ロックの設定は管理者のみ可能です';
      lockedItem.dataset.gbTooltip = lockedItem.title;
    } else {
      const lockPanel = _outlinerCreateSubmenu('編集ロック');
      _outlinerAppendSubmenu(menu, '編集ロック', 'lock', lockPanel);
      [['編集ロックする', true, 'lock'], ['編集ロック解除', false, 'unlock']].forEach(([label, val, icon]) => {
        _outlinerAppendMenuItem(lockPanel, {
          html: radioMark(locked === val) + _outlinerMenuIconHtml(icon, 12) + '<span>' + _outlinerEscHtml(label) + '</span>',
          checked: locked === val,
          action: async () => {
          closeTreeContextMenu();
          const changed = locked !== val ? await toggleItemLock(nodeData.path) : true;
          if (!changed) return;
          const lbl = nodeEl.querySelector('.tree-label');
          if (lbl) lbl.style.fontStyle = isItemLocked(nodeData.path) ? 'italic' : '';
          showStatus(val ? '編集ロックしました' : '編集ロックを解除しました');
          },
        });
      });
    }
  }

  const _locked = nodeData.path ? isItemLocked(nodeData.path) : false;

  // --- メインカレンダーに設定（calendarタイプのみ） ---
  if (!isMulti && nodeData.type === 'calendar' && nodeData.path) {
    const mainCalId = localStorage.getItem('main-calendar-id');
    const mainCalPath = localStorage.getItem('main-calendar-path');
    const nodeFid = _pathToFileId(nodeData.path);
    const isMain = (mainCalId && nodeFid && mainCalId === nodeFid) || mainCalPath === nodeData.path;
    const calPanel = _outlinerCreateSubmenu('メインカレンダー');
    _outlinerAppendSubmenu(menu, 'メインカレンダー', 'calendar', calPanel);
    [['設定する', true], ['解除する', false]].forEach(([label, val]) => {
      _outlinerAppendMenuItem(calPanel, {
        html: radioMark(isMain === val) + '<span>' + _outlinerEscHtml(label) + '</span>',
        checked: isMain === val,
        action: () => {
        closeTreeContextMenu();
        const before = _captureMainCalendarSettingsHistory();
        if (val) {
          localStorage.setItem('main-calendar-path', nodeData.path);
          const mcFid = _pathToFileId(nodeData.path);
          if (mcFid) localStorage.setItem('main-calendar-id', mcFid);
          showStatus(`「${nodeData.name}」をメインカレンダーに設定しました`);
          _pushMainCalendarSettingsHistory('カレンダー: メインカレンダー設定', before, nodeData.path);
        } else {
          localStorage.removeItem('main-calendar-path');
          localStorage.removeItem('main-calendar-id');
          showStatus('メインカレンダー設定を解除しました');
          _pushMainCalendarSettingsHistory('カレンダー: メインカレンダー解除', before, nodeData.path);
        }
        },
      });
    });
  }

  // --- バージョン管理（フォルダのみ） ---
  if (!isMulti && (isFolder || isDB) && nodeData.path) {
    addSep();
    addMenuItem('バージョンを保存', async () => {
      closeTreeContextMenu();
      if (typeof saveFolderVersion !== 'function') {
        showStatus('バージョンを保存できませんでした：この画面ではバージョン管理を使えません', true);
        return;
      }
      await saveFolderVersion(nodeData.path);
    }, null, 'save');
    addMenuItem('バージョン管理', () => {
      closeTreeContextMenu();
      if (typeof openFolderVersionTab === 'function') openFolderVersionTab(nodeData.path);
      else if (typeof openVersionTab === 'function') openVersionTab(nodeData.path, 'folder');
    }, null, 'gitBranch');
  }

  // --- 画像ツール（フォルダのみ） ---
  if (!isMulti && (nodeData.type === 'folder' || nodeData._isRoot) && nodeData.path) {
    addMenuItem('重複画像を検出', () => {
      closeTreeContextMenu();
      showDuplicateScanModal(nodeData.path);
    }, null, 'search');
    addMenuItem('画像インデックスを作成', () => {
      closeTreeContextMenu();
      clipIndexFolder(nodeData.path);
    }, null, 'image');
  }

  // --- 自動タグ付け（フォルダは深い階層まで再帰処理） ---
  if (!isMulti && nodeData.path && !isEntity && window.isAutoTagRuntimeAvailable?.() === true) {
    const recursiveAutoTag = isFolder || !!nodeData._isRoot;
    addMenuItem(
      recursiveAutoTag ? 'フォルダ内すべてを自動タグ付け' : '自動タグ付け',
      () => {
        closeTreeContextMenu();
        if (typeof autoTagFolderTarget === 'function') {
          autoTagFolderTarget(nodeData, { recursive: recursiveAutoTag });
