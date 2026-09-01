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
  else if (nd.type === 'calendar') { if (typeof openCalendarFile === 'function') openCalendarFile(name, nd.path, _expOpts); }
}

function _outlinerCreateItemIdentity(type, name) {
  const normalizedType = String(type || '').trim();
  const normalizedName = String(name || '').trim();
  return normalizedType && normalizedName ? `${normalizedType}\n${normalizedName}` : '';
}

// 追加API呼び出し前の既存子ノード識別子（事後確認での新規判定に使用）。
// 「無題」のような同名項目は種類をまたいで共存できるため、名前だけでは比較しない。
function _outlinerSnapshotChildNames(container) {
  const names = new Set();
  container.querySelectorAll(':scope > .tree-node').forEach(node => {
    const d = node._nodeData;
    const identity = d && !d._pendingCreate
      ? _outlinerCreateItemIdentity(d.type, d.name)
      : '';
    if (identity) names.add(identity);
  });
  return names;
}

// 一覧からタイプが一致し事前集合に無い項目を探す（作成の事後確認用）。
// 事前集合が無い場合は新規判定ができないため常にnullを返す（誤検出防止）
function _outlinerFindNewItemInListing(items, type, existingNames) {
  if (!Array.isArray(items) || !(existingNames instanceof Set)) return null;
  return items.find(it => {
    if (!it || it.type !== type || !it.name) return false;
    const identity = _outlinerCreateItemIdentity(it.type, it.name);
    return identity && !existingNames.has(identity);
  }) || null;
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
    showStatus('トピックを追加しました');
    if (typeof loadOutliner === 'function') await loadOutliner();
    if (typeof navOpen === 'function') navOpen({ type: 'pivot', label: path.split('/').pop() || 'シート', path });
  } catch (e) {
    showStatus((e && e.message) || 'トピックの追加に失敗しました', true);
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
