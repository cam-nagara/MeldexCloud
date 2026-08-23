      showStatus('フォルダ選択ダイアログを開いています...');
      try {
        const res = await apiFetch('/pick-folder');
        if (!res.path) { showStatus('キャンセルされました'); return; }
        // outliner_rootsを更新
        const roots = await apiFetch('/outliner-roots');
        const baseRoots = _cloneOutlinerRootsForBase(roots);
        const root = roots.find(r => r.path === nodeData.path);
        if (root) {
          root.path = res.path;
          root.name = res.path.split(/[/\\]/).pop();
          await _putOutlinerRootsWithBase(roots, baseRoots);
          await loadOutliner();
          showStatus('パスを変更しました: ' + res.path);
        }
      } catch (e) { showStatus('パス変更に失敗しました', true); }
    }, null, 'folderPen');
    addMenuItem('名前を変更...', async () => {
      closeTreeContextMenu();
      const roots = await apiFetch('/outliner-roots');
      const baseRoots = _cloneOutlinerRootsForBase(roots);
      const root = roots.find(r => r.path === nodeData.path);
      if (!root) return;
      const newName = await cfPrompt('表示名を入力:', root.name);
      if (!newName) return;
      root.name = newName;
      await _putOutlinerRootsWithBase(roots, baseRoots);
      await loadOutliner();
      showStatus('名前を変更しました');
    }, null, 'pencil');
    addMenuItem('チーム管理...', async () => {
      closeTreeContextMenu();
      showSettingsModal({ panel: 'ユーザー' });
    }, null, 'users');
    addSep();
    addMenuItem('このソースフォルダの登録を解除', async () => {
      closeTreeContextMenu();
      // 実際に消えるのはフォルダツリーの一覧からだけ。フォルダ本体とファイルは
      // 消えない（gb-settings-cloud-link.js の confirmDeleteSourceFolder と同じ言い回しに揃える）。
      if (!await cfConfirm('ソースフォルダ「' + nodeData.name + '」の登録を解除しますか？\n（フォルダとファイルはそのまま残ります。フォルダツリーの一覧から外れるだけです）', { okLabel: '登録解除' })) return;
      const roots = await apiFetch('/outliner-roots');
      const baseRoots = _cloneOutlinerRootsForBase(roots);
      const newRoots = roots.filter(r => r.path !== nodeData.path);
      await _putOutlinerRootsWithBase(newRoots, baseRoots);
      await loadOutliner();
      showStatus('ソースフォルダの登録を解除しました');
    }, null, 'folder-minus');
  }

  // --- 作品フォルダ設定（フォルダのみ） ---
  if (isFolder && !isMulti) {
    const curWork = getWorkFolder();
    const isWork = curWork === nodeData.path;
    const wfPanel = _outlinerCreateSubmenu('作品フォルダ');
    _outlinerAppendSubmenu(menu, '作品フォルダ', 'folderDot', wfPanel);
    [['設定する', true], ['解除する', false]].forEach(([label, setIt]) => {
      _outlinerAppendMenuItem(wfPanel, {
        html: radioMark(isWork === setIt) + '<span>' + _outlinerEscHtml(label) + '</span>',
        checked: isWork === setIt,
        action: async () => {
        closeTreeContextMenu();
        if (setIt) {
          setWorkFolder(nodeData.path);
          showStatus(`「${nodeData.name}」を作品フォルダに設定しました`);
        } else {
          setWorkFolder('');
          showStatus('作品フォルダの設定を解除しました');
        }
        await loadLinkDict();
        tooltipCache = {};
        await loadOutliner();
        },
      });
    });
  }

  // --- 並び替え（フォルダ・DB） ---
  if ((isFolder || isDB || isEntity) && !isMulti) {
    const sortPath = nodeData.path;
    const curSort = getSortForFolder(sortPath);
    // サブメニュー風: 1項目でクリック→展開
    const sortPanel = _outlinerCreateSubmenu('並び替え');
    _outlinerAppendSubmenu(menu, '並び替え', 'arrowUpDown', sortPanel);
    const sortOpts = typeof getFolderSortOptions === 'function' ? getFolderSortOptions() : [
      { label: 'マニュアル', sort: 'manual', order: 'asc' },
      { label: '名前 ↑', sort: 'name', order: 'asc' },
      { label: '名前 ↓', sort: 'name', order: 'desc' },
    ];
    sortOpts.forEach(o => {
      const active = curSort.sort === o.sort && curSort.order === o.order;
      _outlinerAppendMenuItem(sortPanel, {
        html: radioMark(active) + '<span>' + _outlinerEscHtml(o.label) + '</span>',
        checked: active,
        action: async () => {
        closeTreeContextMenu();
        const sortHistoryKeys = [SORT_SETTINGS_KEY, MANUAL_ORDER_KEY];
        const before = captureOutlinerSettingsHistory(sortHistoryKeys);
        setSortSetting(sortPath, o.sort, o.order);
        pushOutlinerSettingsHistory(
          'フォルダツリー: 並び替え設定',
          before,
          sortPath + ' / ' + o.label,
          sortHistoryKeys
        );
        if (typeof _folderPath !== 'undefined' && _folderPath === sortPath && typeof renderFolderGrid === 'function') {
          const selectedPaths = typeof _folderSelectedItems !== 'undefined'
            ? _folderSelectedItems.map(item => item?.path).filter(Boolean) : [];
          renderFolderGrid({ preserveSelectedPaths: selectedPaths, resetScrollTop: true });
        }
        const childrenDiv = nodeEl.querySelector(':scope > .tree-children');
        if (childrenDiv) {
          if (typeof _unregisterTreeSubtree === 'function') _unregisterTreeSubtree(childrenDiv);
          childrenDiv.innerHTML = '';
          childrenDiv.dataset.loaded = 'false';
        }
        const toggle = nodeEl.querySelector('.tree-toggle');
        if (toggle && toggle.dataset.expanded === 'true') {
          toggle.dataset.expanded = 'false'; toggle.click();
        }
        },
      });
    });
    addSep();
  }

  // --- 削除（エントリ以外、ロック中は無効） ---
  if (!isEntity && !_locked && !nodeData._isRoot) {
    addSep();
    const delLabel = isMulti ? `削除（${selectedCount}件）` : '削除';
    addMenuItem(delLabel, deleteContextItems, 'danger', 'trash2');
  }

  // --- スプリットビュー ---
  if (!isMulti && isDB && nodeData.path && typeof isSplitActive === 'function' && _isOutlinerFreeLayoutUiEnabled()) {
    addSep();
    if (isSplitActive()) {
      addMenuItem('別の作業領域で開く', () => { closeTreeContextMenu(); openDbInOtherPane(nodeData.path); }, null, 'columns');
    } else {
      addMenuItem('スプリットで開く', () => { closeTreeContextMenu(); openInNewSplit(nodeData.path); }, null, 'columns');
    }
  }

  _outlinerPlaceContextMenu(menu);

  // OSシェルメニュー項目を非同期追加
  if (nodeData.path && typeof appendShellVerbsToMenu === 'function') {
    appendShellVerbsToMenu(menu, nodeData.path, { editingLocked: _locked });
  }
}

// 追加先の親パスを決定
// シートの中に入れてよいのはエントリだけ。ボードやノートの作成先としてシートが
// 選ばれていた場合は、シート自身ではなくその親フォルダを作成先にする。
function _outlinerContainerAcceptsItemType(nodeData, itemType) {
  if (nodeData?.type !== 'database') return true;
  return String(itemType || '') === 'entity';
}

// シートの中へ移動してよい項目か。規則の正本は gb-sheet-attachments.js
// （デスクトップ版・クラウド版で共有するシートの共通規則）に置く。
function _outlinerItemFitsInSheet(nodeData) {
  return window.MeldexSheetAttachments?.itemFitsInSheet
    ? window.MeldexSheetAttachments.itemFitsInSheet(nodeData)
    : true;
}

function getAddParentPath(nodeEl, nodeData, options = {}) {
  const isContainer = nodeData.type === 'folder'
    || (nodeData.type === 'database' && _outlinerContainerAcceptsItemType(nodeData, options.itemType));
  if (isContainer && options.insideTarget && nodeData.path) return nodeData.path;
  if (nodeData._isRoot && nodeData.path) return nodeData.path;
  if (isContainer) {
    // フォルダ/DBが展開中ならその中、閉じているなら同階層
    const toggle = nodeEl.querySelector('.tree-toggle');
    if (toggle && toggle.dataset.expanded === 'true') return nodeData.path;
  }
  // ファイルやエントリ、閉じたフォルダ → 親フォルダのパス
  const parentContainer = nodeEl.parentElement;
  const parentNode = parentContainer?.closest('.tree-node');
  if (parentNode && parentNode._nodeData) return parentNode._nodeData.path;
  // ホーム内のルート直下ノード → ホームフォルダパスを返す
  if (nodeEl.closest('#body-home') && _homeFolderPath) return _homeFolderPath;
  return ''; // ソースフォルダルート
}

// 選択中の全ノードに色を適用
function applyColorToSelection(color) {
  const before = captureOutlinerSettingsHistory([NODE_COLORS_KEY]);
  const detail = [...treeSelection.items]
    .map(nodeEl => nodeEl._nodeData?.path || nodeEl._nodeData?.name || '')
    .filter(Boolean)
    .join(', ');
  treeSelection.items.forEach(nodeEl => {
    const data = nodeEl._nodeData;
    if (!data) return;
    const row = nodeEl.querySelector('.tree-node-row');
    if (row) applyNodeColor(row, color);
    if (data.path) setNodeColor(data.path, color);
  });
  pushOutlinerSettingsHistory(
    color ? 'フォルダツリー: 色設定' : 'フォルダツリー: 色リセット',
    before,
    detail,
    [NODE_COLORS_KEY]
  );
  showStatus(color ? '色を設定しました' : '色をリセットしました');
}

/* ==============================
   タイムアウト事後確認（作成・リネーム共通）
   ============================== */
// APIタイムアウト時のポーリング間隔。合計30秒で打ち切る
const OUTLINER_POST_TIMEOUT_CONFIRM_DELAYS_MS = [2000, 4000, 8000, 16000];
// 同一キーの事後確認ポーリングが二重に走らないようにする
const _outlinerPostTimeoutConfirmInFlight = new Set();

// E2Eから待機時間を短縮できるようにする（通常はundefinedで既定値）
function _outlinerPostTimeoutConfirmDelays() {
  const o = window.__outlinerPostTimeoutConfirmDelaysForE2E;
  return (Array.isArray(o) && o.length) ? o : OUTLINER_POST_TIMEOUT_CONFIRM_DELAYS_MS;
}

// 親フォルダの一覧をフロントキャッシュを避けて取得する（root/sourceIdはcontextNodeElの祖先から推定）
async function _outlinerFetchFolderListingForConfirm(parentPath, contextNodeEl) {
  const sourceId = contextNodeEl?._nodeData?.sourceId || '';
  let rootPath = '';
  let cur = contextNodeEl || null;
  while (cur) {
    if (cur._nodeData?._isRoot) { rootPath = cur._nodeData.path; break; }
    cur = cur.parentElement ? cur.parentElement.closest('.tree-node') : null;
  }
  const rootParam = rootPath ? '&root=' + encodeURIComponent(rootPath) : '';
  const sourceParam = sourceId ? '&sourceId=' + encodeURIComponent(sourceId) : '';
  try {
    return await apiFetch('/browse?path=' + encodeURIComponent(parentPath || '') + rootParam + sourceParam + '&all_files=true',
      { skipBrowseCache: true, cache: 'reload' });
  } catch {
    return null;
  }
}

// 一覧から旧名が消え新名が現れたことを確認する（リネームの事後確認用）。
// oldDisplayName は拡張子を含まない表示名（/browse の name と同じ規約）を渡すこと
function _outlinerFindRenamedItem(items, oldDisplayName, newName) {
  if (!Array.isArray(items)) return null;
  if (oldDisplayName && oldDisplayName !== newName && items.some(it => it && it.name === oldDisplayName)) return null;
  return items.find(it => it && it.name === newName) || null;
}

function _resolveOutlinerCreateInsertTarget(parentPath, options) {
  const expandUnloaded = options?.expandUnloaded !== false;
  let container;
  let deferTreeInsert = false;
  if (parentPath) {
    const parentNode = typeof _findTreeNodeByPath === 'function' ? _findTreeNodeByPath(parentPath) : null;
    if (parentNode) {
      const childrenDiv = parentNode.querySelector(':scope > .tree-children');
      if (childrenDiv) {
        const toggle = parentNode.querySelector('.tree-toggle');
        if (childrenDiv.dataset.loaded === 'false') {
          deferTreeInsert = true;
          if (expandUnloaded && toggle && toggle.dataset.expanded !== 'true') toggle.click();
        } else {
          childrenDiv.classList.remove('collapsed');
          if (toggle) { toggle.classList.add('expanded'); toggle.dataset.expanded = 'true'; }
          container = childrenDiv;
        }
      }
    }
    if (!container && _homeFolderPath && parentPath === _homeFolderPath) {
      container = document.getElementById('body-home');
    }
    // 親ノードがDOM上に見つからず、ホームフォルダにも該当しない場合はルートへ誤挿入せず
    // 「挿入先不明」を返す。呼び出し元は誤挿入せず全体再読込に委ねる
    if (!container && !deferTreeInsert) return { container: null, deferTreeInsert: false };
  }
  if (!container && !deferTreeInsert) container = document.getElementById('outliner-tree');
  return { container, deferTreeInsert };
}

function _insertOutlinerCreateNode(container, newNode) {
  if (!container || !newNode) return;
  const sel = treeSelection.lastClicked;
  if (sel && sel._nodeData && sel.parentElement === container) {
    const selType = sel._nodeData.type;
    if (selType !== 'folder' && selType !== 'database') {
      container.insertBefore(newNode, sel.nextSibling);
      return;
    }
  }
  container.appendChild(newNode);
}

function _selectOutlinerCreateNode(newNode) {
  if (!newNode) return;
  treeSelection.clear();
  treeSelection.add(newNode);
  treeSelection.lastClicked = newNode;
  document.querySelectorAll('.tree-node-row.active').forEach(r => r.classList.remove('active'));
  newNode.querySelector('.tree-node-row')?.classList.add('active');
}

function _createOutlinerPendingCreateNode(type, label) {
  const item = {
    name: label || '無題',
    type,
    path: '__meldex_pending_create_' + Date.now() + '_' + Math.random().toString(36).slice(2),
    _pendingCreate: true,
  };
  const node = createTreeNodeFromBrowse(item);
  node.classList.add('tree-node-pending-create');
  const row = node.querySelector(':scope > .tree-node-row');
  const labelEl = node.querySelector(':scope > .tree-node-row .tree-label');
  if (row) {
    row.draggable = false;
    row.style.opacity = '0.62';
    row.style.fontStyle = 'italic';
  }
  if (labelEl) labelEl.textContent = (label || '無題') + '（作成中）';
  const block = (e) => { e.preventDefault(); e.stopPropagation(); };
  ['click', 'dblclick', 'contextmenu', 'dragstart'].forEach(eventName => {
    node.addEventListener(eventName, block, true);
  });
  return node;
}

function _openOutlinerCreatedNode(nd, name) {
  const _expOpts = { fromExplorer: true };
  if (nd.type === 'page') openPage(name, nd.path, _expOpts);
  else if (nd.type === 'board') openBoard(name, nd.path, _expOpts);
  else if (nd.type === 'scriptnote' || (typeof isScriptNotePath === 'function' && isScriptNotePath(nd.path))) {
    if (typeof openScenarioInScriptNote === 'function') openScenarioInScriptNote(nd.path, name, _expOpts);
  }
  else if (nd.type === 'scenario') { if (typeof openScenarioInScriptNote === 'function') openScenarioInScriptNote(nd.path, name, _expOpts); }
  else if (nd.type === 'database') selectDatabase(nd.path, null, _expOpts);
  else if (nd.type === 'smart-db') { if (typeof openSmartDbFile === 'function') openSmartDbFile(name, nd.path, _expOpts); }
  else if (nd.type === 'calendar') { if (typeof openCalendarFile === 'function') openCalendarFile(name, nd.path, _expOpts); }
}

// 追加API呼び出し前の既存子ノード名（事後確認での新規判定に使用）
function _outlinerSnapshotChildNames(container) {
  const names = new Set();
  container.querySelectorAll(':scope > .tree-node').forEach(node => {
    const d = node._nodeData;
    if (d && !d._pendingCreate && d.name) names.add(d.name);
  });
  return names;
}

// 一覧からタイプが一致し事前集合に無い項目を探す（作成の事後確認用）。
// 事前集合が無い場合は新規判定ができないため常にnullを返す（誤検出防止）
function _outlinerFindNewItemInListing(items, type, existingNames) {
  if (!Array.isArray(items) || !(existingNames instanceof Set)) return null;
  return items.find(it => it && it.type === type && it.name && !existingNames.has(it.name)) || null;
}

// 事後確認で成功が判明した場合の反映（仮ノードを本ノードに置換）
function _outlinerApplyCreateSuccess(pendingNode, found, options) {
  if (!options?.skipStatus) showStatus(`「${found.name}」を作成しました`);
  if (!pendingNode || !pendingNode.parentNode) return;
  const newNode = createTreeNodeFromBrowse(found);
  pendingNode.replaceWith(newNode);
  _selectOutlinerCreateNode(newNode);
}

// 挿入先が解決できない場合の後始末（誤挿入せず全体再読込に委ねる）
async function _outlinerCreateFallbackToReload(pendingNode, nd, name) {
  if (pendingNode && pendingNode.parentNode) pendingNode.remove();
  await loadOutliner();
  _openOutlinerCreatedNode(nd, name);
}

// 作成APIタイムアウト時の事後確認: 親フォルダを再取得し、事前集合に無い同タイプの新項目を探す
async function _outlinerHandleCreateTimeout(pendingNode, parentPath, type, existingNames) {
  const confirmKey = 'create:' + (pendingNode?.dataset?.path || (parentPath + '|' + type + '|' + Date.now()));
  if (_outlinerPostTimeoutConfirmInFlight.has(confirmKey)) return;
  _outlinerPostTimeoutConfirmInFlight.add(confirmKey);
  const progress = window.MeldexOperationProgress?.begin?.({
    kind: 'create-confirmation',
    label: '作成結果を確認しています',
    mode: 'indeterminate',
    origin: pendingNode,
    showImmediately: true,
    showInTray: true,
    showInStatus: true,
    priority: 60,
  });
  try {
    if (!progress) showStatus('作成に時間がかかっています。結果を確認中…');
    const contextNodeEl = (typeof _findTreeNodeByPath === 'function' && _findTreeNodeByPath(parentPath)) || pendingNode;
    for (const delay of _outlinerPostTimeoutConfirmDelays()) {
      await new Promise(r => setTimeout(r, delay));
      const items = await _outlinerFetchFolderListingForConfirm(parentPath, contextNodeEl);
      const found = _outlinerFindNewItemInListing(items, type, existingNames);
      if (found) {
        _outlinerApplyCreateSuccess(pendingNode, found, { skipStatus: !!progress });
        progress?.succeed?.({ summary: `「${found.name}」を作成しました` });
        return;
      }
    }
    if (typeof loadOutliner === 'function') await loadOutliner();
    if (typeof renderHomeFolderTree === 'function') renderHomeFolderTree();
    const items = await _outlinerFetchFolderListingForConfirm(parentPath, contextNodeEl);
    const found = _outlinerFindNewItemInListing(items, type, existingNames);
    if (pendingNode && pendingNode.parentNode) pendingNode.remove();
    if (found) {
      if (progress) progress.succeed({ summary: `「${found.name}」を作成しました` });
      else showStatus(`「${found.name}」を作成しました`);
    } else {
      const message = '作成の結果を確認できませんでした。フォルダツリーをご確認ください';
      if (progress) progress.fail({ error: message });
      else showStatus(message, true);
    }
  } finally {
    if (progress && !window.MeldexOperationProgress?.isTerminalStatus?.(progress.getState()?.status)) {
      progress.fail({ error: '作成結果の確認を完了できませんでした' });
    }
    _outlinerPostTimeoutConfirmInFlight.delete(confirmKey);
  }
}

// アイテムを指定パス配下に追加（部分更新、チラつき防止）
async function addItemAt(parentPath, type) {
  if (_isCloudPhase1BlockedCreateType(type)) {
    _showCloudPhase1BlockedCreate(type);
    return;
  }
  const label = '無題';
  const target = _resolveOutlinerCreateInsertTarget(parentPath, { expandUnloaded: false });
  let pendingNode = null;
  let existingNames = null;
  if (!target.deferTreeInsert && target.container) {
    existingNames = _outlinerSnapshotChildNames(target.container);
    pendingNode = _createOutlinerPendingCreateNode(type, label);
    _insertOutlinerCreateNode(target.container, pendingNode);
    pendingNode.scrollIntoView({ block: 'nearest' });
  }
  try {
    const res = await apiPost('/outliner/add', { type, label, parent: parentPath });
    // サーバーはlabelを返すが、createTreeNodeFromBrowseはnameを使う
    if (!res.node.name) res.node.name = res.node.label;

    let insertTarget = target.deferTreeInsert
      ? _resolveOutlinerCreateInsertTarget(parentPath, { expandUnloaded: true })
      : target;
    // API待機中にワークスペースセクション等が再描画され、挿入先コンテナが
    // DOMから切断されていた場合は挿入先を再解決する
    if (!insertTarget.deferTreeInsert && !insertTarget.container?.isConnected) {
      insertTarget = _resolveOutlinerCreateInsertTarget(parentPath, { expandUnloaded: true });
    }
    const nd = res.node;
    const name = nd.name || nd.label || label;
    // 挿入先が最後まで解決できない場合はルート等へ誤挿入せず全体再読込に委ねる
    if (!insertTarget.deferTreeInsert && !insertTarget.container) {
      await _outlinerCreateFallbackToReload(pendingNode, nd, name);
      return;
    }
    const newNode = insertTarget.deferTreeInsert ? null : createTreeNodeFromBrowse(res.node);

    if (!insertTarget.deferTreeInsert && newNode) {
      if (pendingNode && pendingNode.parentNode) pendingNode.replaceWith(newNode);
      else _insertOutlinerCreateNode(insertTarget.container, newNode);
      // 挿入直後に切断されている場合の軽い保険
      if (!newNode.isConnected) loadOutliner();
    }

    if (!insertTarget.deferTreeInsert) newNode.scrollIntoView({ block: 'nearest' });
    // 選択状態にする
    if (!insertTarget.deferTreeInsert) _selectOutlinerCreateNode(newNode);
    // コンテンツを開く
    _openOutlinerCreatedNode(nd, name);
  } catch (e) {
    if (e && e.isTimeout) {
      await _outlinerHandleCreateTimeout(pendingNode, parentPath, type, existingNames);
    } else {
      if (pendingNode && pendingNode.parentNode) pendingNode.remove();
      showStatus((e && e.message) || '追加に失敗しました', true);
    }
  }
}

// シートの中へエントリを追加する（シートに作れるのはエントリだけ）
async function addSheetEntryAt(sheetPath) {
  const path = String(sheetPath || '').trim();
  if (!path) return;
  try {
    await apiPost('/entity/create', { parent_path: path, name: '無題' });
    showStatus('エントリを追加しました');
    if (typeof loadOutliner === 'function') await loadOutliner();
    if (typeof navOpen === 'function') navOpen({ type: 'pivot', label: path.split('/').pop() || 'シート', path });
  } catch (e) {
    showStatus((e && e.message) || 'エントリの追加に失敗しました', true);
  }
}

// ヘッダーボタンからの追加（選択中アイテムのコンテキストを考慮）
async function showAddOutlinerItem(type) {
  // 選択中のアイテムから追加先を決定
  let parentPath = '';
  if (treeSelection.lastClicked && treeSelection.lastClicked._nodeData) {
    // ホーム内のノードが選択されている場合
    if (treeSelection.lastClicked.closest('#body-home') && _homeFolderPath) {
      const nd = treeSelection.lastClicked._nodeData;
      if (nd.type === 'folder' || (nd.type === 'database' && _outlinerContainerAcceptsItemType(nd, type))) {
        const toggle = treeSelection.lastClicked.querySelector('.tree-toggle');
        parentPath = (toggle && toggle.dataset.expanded === 'true') ? nd.path : _homeFolderPath;
      } else {
        const pn = treeSelection.lastClicked.parentElement?.closest('.tree-node');
        parentPath = pn?._nodeData?.path || _homeFolderPath;
      }
    } else {
      parentPath = getAddParentPath(treeSelection.lastClicked, treeSelection.lastClicked._nodeData, { itemType: type });
    }
  }
  // 何も選択されていない場合、ホームフォルダにフォールバック
  if (!parentPath && _homeFolderPath) {
    parentPath = _homeFolderPath;
  }
  await addItemAt(parentPath, type);
}

// フォルダツリーのラベルをインライン編集
function startTreeLabelEdit(labelEl, nodeData, onFinish) {
  const old = labelEl.textContent;
  const input = document.createElement('input');
  input.type = 'text';
  input.value = old === '無題' ? '' : old;
  input.placeholder = '名前を入力';

/* === gb-outliner.part03.js === */
  input.style.cssText = 'width:100%;background:var(--bg);color:var(--fg);border:1px solid var(--accent);border-radius:2px;padding:1px 4px;font-size:13px;outline:none;';
  labelEl.textContent = '';
  labelEl.appendChild(input);
  input.focus();
  // クリックがrowのclickイベントにバブルしてファイルを開くのを防止
  input.addEventListener('click', (e) => e.stopPropagation());
  input.addEventListener('dblclick', (e) => e.stopPropagation());

  const finish = async () => {
    const nv = input.value.trim() || '無題';
    labelEl.textContent = nv;

    // ファイル/フォルダの実体をリネーム
    if (nodeData.path && nv !== old) {
      const oldPath = nodeData.path;
      try {
        const res = await apiPost('/outliner/rename', {
          old_path: oldPath,
          new_name: nv,
          type: nodeData.type || 'page'
        });
        if (!res || !res.new_path) throw new Error('rename failed');
        _outlinerApplyRenameSuccess(oldPath, res.new_path, nv, res.file_id, nodeData, old);
        if (typeof handleRelocateResponse === 'function') handleRelocateResponse(res);
      } catch (e) {
        if (e && e.isTimeout) {
          await _outlinerHandleTreeRenameTimeout(labelEl, nodeData, old, nv, oldPath);
        } else {
          // API失敗時はラベルを元に戻す（無言で戻すとユーザーが失敗に気づけないため理由も表示）
          labelEl.textContent = old;
          const reason = (e && (e.userMessage || e.message)) ? String(e.userMessage || e.message) : '';
          showStatus(`「${old}」のリネームに失敗` + (reason ? `（${reason}）` : ''), true);
        }
      }
    }
    if (onFinish) onFinish();
  };

  input.addEventListener('blur', finish);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
    if (e.key === 'Escape') { input.value = old; input.blur(); }
  });
}

// リネーム成功時の反映（通常成功時とタイムアウト事後確認成功時で共通）
function _outlinerApplyRenameSuccess(oldPath, newPath, newName, fileId, nodeData, oldName, options) {
  _renameTreeNode(oldPath, newPath, newName, fileId);
  historyPush(`リネーム: ${oldName} → ${newName}`,
    async () => {
      const r2 = await apiPost('/outliner/rename', { old_path: newPath, new_name: oldName, type: nodeData.type || 'page' });
      _renameTreeNode(newPath, oldPath, oldName, r2?.file_id);
      if (typeof renameAppPathReferences === 'function') renameAppPathReferences(newPath, oldPath, { label: oldName, fileId: r2?.file_id, type: nodeData.type || 'page' });
    },
    async () => {
      const r2 = await apiPost('/outliner/rename', { old_path: oldPath, new_name: newName, type: nodeData.type || 'page' });
      _renameTreeNode(oldPath, newPath, newName, r2?.file_id);
      if (typeof renameAppPathReferences === 'function') renameAppPathReferences(oldPath, newPath, { label: newName, fileId: r2?.file_id, type: nodeData.type || 'page' });
    }
  );
  if (typeof renameAppPathReferences === 'function') {
    renameAppPathReferences(oldPath, newPath, { label: newName, fileId, type: nodeData.type || 'page' });
  }
  if (!options?.skipStatus) showStatus(`「${oldName}」→「${newName}」にリネームしました`);
}

// リネームAPIタイムアウト時の事後確認: 親フォルダを再取得し、旧名消滅・新名出現を確認する
async function _outlinerHandleTreeRenameTimeout(labelEl, nodeData, oldName, newName, oldPath) {
  const confirmKey = 'rename:' + oldPath;
  if (_outlinerPostTimeoutConfirmInFlight.has(confirmKey)) return;
  _outlinerPostTimeoutConfirmInFlight.add(confirmKey);
  const progress = window.MeldexOperationProgress?.begin?.({
    kind: 'rename-confirmation',
    label: 'リネーム結果を確認しています',
    mode: 'indeterminate',
    origin: labelEl,
    showImmediately: true,
    showInTray: true,
    showInStatus: true,
    priority: 60,
  });
  try {
    if (!progress) showStatus('リネームに時間がかかっています。結果を確認中…');
    const parentPath = oldPath.includes('/') ? oldPath.substring(0, oldPath.lastIndexOf('/')) : '';
    const contextNodeEl = labelEl.closest('.tree-node');
    const delays = typeof _outlinerPostTimeoutConfirmDelays === 'function'
      ? _outlinerPostTimeoutConfirmDelays() : OUTLINER_POST_TIMEOUT_CONFIRM_DELAYS_MS;
    for (const delay of delays) {
      await new Promise(r => setTimeout(r, delay));
      const items = await _outlinerFetchFolderListingForConfirm(parentPath, contextNodeEl);
      const found = _outlinerFindRenamedItem(items, oldName, newName);
      if (found) {
        _outlinerApplyRenameSuccess(oldPath, found.path, newName, found.file_id, nodeData, oldName, { skipStatus: !!progress });
        progress?.succeed?.({ summary: `「${oldName}」→「${newName}」にリネームしました` });
        return;
      }
    }
    // 確認中に全体再読込等でノードが再生成されている場合に備え、旧パスの
    // 現在のノードを探してラベルを戻す（元の labelEl は切断されている可能性がある）
    const liveNode = typeof _findTreeNodeByPath === 'function' ? _findTreeNodeByPath(oldPath) : null;
    const liveLabel = liveNode ? liveNode.querySelector(':scope > .tree-node-row .tree-label') : null;
    (liveLabel || labelEl).textContent = oldName;
    const message = `「${oldName}」のリネームに失敗（結果を確認できませんでした）`;
    if (progress) progress.fail({ error: message });
    else showStatus(message, true);
  } finally {
    if (progress && !window.MeldexOperationProgress?.isTerminalStatus?.(progress.getState()?.status)) {
      progress.fail({ error: 'リネーム結果の確認を完了できませんでした' });
    }
    _outlinerPostTimeoutConfirmInFlight.delete(confirmKey);
  }
}

function backToPivot() {
  state.currentEntityPath = null;
  if (state.currentDbPath) {
    selectDatabase(state.currentDbPath);
  } else {
    showView('pivot');
  }
  document.querySelectorAll('.tree-node-row.active').forEach(el => el.classList.remove('active'));
}

// ツリーノードのパス・名前をDOM上で直接更新（リネーム後の即時反映用）
function _renameTreeNode(oldPath, newPath, newName, fileId) {
  const nodes = document.querySelectorAll('#outliner-tree .tree-node, #body-home .tree-node, #body-workspaces .tree-node');
  const oldPrefix = oldPath + '/';
  const expanded = getExpandedPaths();
  const colors = getNodeColors();
  let expandedChanged = false;
  let colorsChanged = false;

  // file_id キャッシュを更新
  if (fileId) {
    _registerFileId(newPath, fileId);
  }

  for (const node of nodes) {
    const d = node._nodeData;
    if (!d || !d.path) continue;

    if (d.path === oldPath) {
      // リネーム対象ノード自体
      if (typeof _unregisterTreeNode === 'function') _unregisterTreeNode(node, d.path);
      d.path = newPath;
      d.name = newName;
      if (fileId) d.file_id = fileId;
      node.dataset.path = newPath;
      const label = node.querySelector('.tree-label');
      if (label) label.textContent = newName;
      if (typeof _registerTreeNode === 'function') _registerTreeNode(node);
    } else if (d.path.startsWith(oldPrefix)) {
      // 子ノード: パスの接頭辞を書き換え
      const childOldPath = d.path;
      const childNewPath = newPath + d.path.substring(oldPath.length);
      if (typeof _unregisterTreeNode === 'function') _unregisterTreeNode(node, childOldPath);
      // 旧パスキーの色を新パスキーに移行（file_id キーがあればそちらは不変）
      if (colors[d.path]) { colors[childNewPath] = colors[d.path]; delete colors[d.path]; colorsChanged = true; }
      // 子ノードの file_id キャッシュも更新
      if (d.file_id) _registerFileId(childNewPath, d.file_id);
      d.path = childNewPath;
      node.dataset.path = childNewPath;
      if (typeof _registerTreeNode === 'function') _registerTreeNode(node);
    } else {
      continue;
    }
  }

  // localStorage展開状態: 旧パスキーを新パスキーに変換（file_idキーは不変なのでスキップ）
  let expChanged = false;
  for (let i = 0; i < expanded.length; i++) {
    if (expanded[i] === oldPath) { expanded[i] = newPath; expChanged = true; }
    else if (expanded[i].startsWith(oldPrefix)) { expanded[i] = newPath + expanded[i].substring(oldPath.length); expChanged = true; }
  }
  if (expChanged) localStorage.setItem('outliner-expanded', JSON.stringify(expanded));

  // ノード色: 旧パスキーを新パスキーに変換
  if (colors[oldPath]) { colors[newPath] = colors[oldPath]; delete colors[oldPath]; colorsChanged = true; }
  if (colorsChanged) localStorage.setItem(NODE_COLORS_KEY, JSON.stringify(colors));
  try {
    const manual = JSON.parse(localStorage.getItem(MANUAL_ORDER_KEY) || '{}');
    let manualChanged = false;
    const oldName = oldPath.split('/').pop() || oldPath;
    const oldParent = oldPath.includes('/') ? oldPath.substring(0, oldPath.lastIndexOf('/')) : '_root';
    const newParent = newPath.includes('/') ? newPath.substring(0, newPath.lastIndexOf('/')) : '_root';
    const renameOrderKeys = new Set([oldParent, newParent, _pathToFileId(oldParent), _pathToFileId(newParent)].filter(Boolean));
    Object.keys(manual).forEach(key => {
      const mappedKey = key === oldPath ? newPath : (key.startsWith(oldPrefix) ? newPath + key.substring(oldPath.length) : key);
      if (mappedKey !== key) {
        manual[mappedKey] = manual[key];
        delete manual[key];
        manualChanged = true;
      }
      if (renameOrderKeys.has(mappedKey) && Array.isArray(manual[mappedKey])) {
        const next = manual[mappedKey].map(name => name === oldName ? newName : name);
        if (next.some((name, idx) => name !== manual[mappedKey][idx])) {
          manual[mappedKey] = next;
          manualChanged = true;
        }
      }
    });
    if (manualChanged) localStorage.setItem(MANUAL_ORDER_KEY, JSON.stringify(manual));
  } catch {}
}

function _normalizeOutlinerHighlightPath(path) {
  return String(path || '')
    .trim()
    .replace(/^file:\/+/i, '')
    .replace(/\\/g, '/')
    .replace(/\/+$/, '')
    .replace(/\/+/g, '/')
    .toLowerCase();
}

function _outlinerHighlightPathMatches(nodePath, targetPath) {
  const nodeKey = _normalizeOutlinerHighlightPath(nodePath);
  const targetKey = _normalizeOutlinerHighlightPath(targetPath);
  if (!nodeKey || !targetKey) return false;
  if (nodeKey === targetKey) return true;
  const nodeName = nodeKey.split('/').pop();
  const targetName = targetKey.split('/').pop();
  if (!nodeName || nodeName !== targetName) return false;
  return nodeKey.endsWith('/' + targetKey) || targetKey.endsWith('/' + nodeKey);
}

function _outlinerHighlightNodeCandidates() {
  const preferred = [...document.querySelectorAll('#outliner-tree .tree-node, #body-home .tree-node')];
  const fallback = [...document.querySelectorAll('#sidebar .tree-node')]
    .filter(node => !preferred.includes(node));
  return [...preferred, ...fallback];
}

// フォルダツリーで対応ノードをハイライト（auto-link遷移・ページ復元等で使用）
function highlightOutlinerNode(targetPath, opts) {
  document.querySelectorAll('.tree-node-row.active').forEach(r => r.classList.remove('active'));
  if (!targetPath) return;
  const noScroll = opts && opts.noScroll;
  // まず既に表示されているノードを探す
  let found = _findAndHighlight(targetPath, noScroll);
  if (found) return;
  // 見つからない場合、パスを分解して親フォルダを順に展開
  _autoExpandToPath(targetPath, noScroll);
}

function _findAndHighlight(targetPath, noScroll) {
  for (const node of _outlinerHighlightNodeCandidates()) {
    const data = node._nodeData;
    const nodePath = data?.path || node.dataset?.path || '';
    if (_outlinerHighlightPathMatches(nodePath, targetPath)) {
      const row = node.querySelector('.tree-node-row');
      if (row) {
        row.classList.add('active');
        if (!noScroll) row.scrollIntoView({ block: 'nearest' });
      }
      return true;
    }
  }
  return false;
}

async function _autoExpandToPath(targetPath, noScroll) {
  // パスの各階層を上から順に展開
  const parts = targetPath.replace(/\\/g, '/').split('/');
  for (let i = 1; i <= parts.length; i++) {
    const partial = parts.slice(0, i).join('/');
    let expanded = false;
    for (const node of _outlinerHighlightNodeCandidates()) {
      const data = node._nodeData;
      const nodePath = data?.path || node.dataset?.path || '';
      if (nodePath && _outlinerHighlightPathMatches(nodePath, partial)) {
        const toggle = node.querySelector('.tree-toggle');
        if (toggle && toggle.dataset.expanded !== 'true') {
          const childrenDiv = node.querySelector(':scope > .tree-children');
          toggle.click();
          // lazy load完了を待つ（子要素が追加されるか、最大2秒）
          for (let w = 0; w < 20; w++) {
            await new Promise(r => setTimeout(r, 100));
            if (childrenDiv && childrenDiv.dataset.loaded === 'true') break;
          }
          expanded = true;
        }
        break;
      }
    }
    // 展開したら次の階層でターゲットが見つかるかチェック
    if (expanded && _findAndHighlight(targetPath, noScroll)) return;
  }
  _findAndHighlight(targetPath, noScroll);
}

/* ==============================
   フォルダごとのファイル非表示
   ============================== */
/* フィルタ / 検索 / フォルダごとの非表示は gb-outliner-search.js に分離 */
document.getElementById('outliner-tree')?.addEventListener('dragover', e => e.preventDefault());

let _outlinerKeyboardFocusSeq = 0;

function _outlinerKeyboardRow(nodeEl) {
  return nodeEl?.querySelector?.(':scope > .tree-node-row') || null;
}

function _outlinerKeyboardMarkActive() {
  window._outlinerKeyboardNavigationActiveUntil = Date.now() + 1500;
}

function _outlinerKeyboardRestoreFocus(row, focusSeq) {
  if (focusSeq && focusSeq !== _outlinerKeyboardFocusSeq) return;
  if (!row?.isConnected) return;
  const active = document.activeElement;
  if (active?.closest?.('input, textarea, select, [contenteditable="true"]')) return;
  _outlinerKeyboardMarkActive();
  try { row.focus({ preventScroll: true }); } catch {}
}

// ↑/↓/Home/Endなどの選択移動専用。開く処理は行わない（§2.4・§5 Phase1）。
// 実際の選択・フォーカス・オプションパネル対象更新は gb-outliner-activation.js の
// selectNodeOnly() へ委譲し、マウスクリックと同じ一経路にする。
function _outlinerKeyboardSelectNode(nodeEl) {
  const row = _outlinerKeyboardRow(nodeEl);
  if (!nodeEl || !row) return false;
  const focusSeq = ++_outlinerKeyboardFocusSeq;
  window.GBOutlinerActivation?.selectNodeOnly(nodeEl, { focus: false });
  _outlinerKeyboardRestoreFocus(row, focusSeq);
  row.scrollIntoView({ block: 'nearest' });
  return true;
}

// Enter／メニュー「開く」と同じ共通アクティベーション経路を使う
function _outlinerKeyboardActivateNode(nodeEl) {
  const row = _outlinerKeyboardRow(nodeEl);
  if (!nodeEl || !row) return false;
  const focusSeq = ++_outlinerKeyboardFocusSeq;
  try {
    const opened = window.GBOutlinerActivation?.activateNode(nodeEl);
    Promise.resolve(opened).finally(() => _outlinerKeyboardRestoreFocus(row, focusSeq));
  } catch (err) {
    _outlinerKeyboardRestoreFocus(row, focusSeq);
    throw err;
  }
  return true;
}

// F2: 名前変更開始（ダブルクリックの旧割当はここへ移動済み）
function _outlinerKeyboardStartRename(nodeEl) {
  const row = _outlinerKeyboardRow(nodeEl);
  const label = row?.querySelector(':scope > .tree-label');
  const item = nodeEl?._nodeData;
  if (!row || !label || !item) return false;
  return window.GBOutlinerActivation?.startRenameForNode(nodeEl, label, item) || false;
}

function _outlinerKeyboardScopeFromTarget(target) {
  if (target?.closest?.('#body-home')) return '#body-home';
  if (target?.closest?.('#body-workspaces')) return '#body-workspaces';
  if (target?.closest?.('#outliner-tree')) return '#outliner-tree';
  if (target?.id === 'tree-scroll-container') return '#outliner-tree';
  return '';
}

function _outlinerKeyboardNodeFromTarget(target, scopeSelector) {
  const direct = target?.closest?.('.tree-node') || null;
  if (direct && (!scopeSelector || direct.closest(scopeSelector))) return direct;
  if (treeSelection.lastClicked && (!scopeSelector || treeSelection.lastClicked.closest(scopeSelector))) return treeSelection.lastClicked;
  const activeRow = document.querySelector(`${scopeSelector || '#outliner-tree'} .tree-node-row.active`);
  return activeRow?.closest?.('.tree-node') || null;
}

function _outlinerKeyboardToggle(nodeEl, expand) {
