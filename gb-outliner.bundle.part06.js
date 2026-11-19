    }
  }

  // OSシェルメニューは取得済みなら表示前に組み込む。未取得（PowerShell起動で1秒前後）の
  // 時はメニュー本体を待たせず即表示し、OS項目だけ表示後にメニュー下端へ追記する。
  const shellPath = nodeData.path && typeof appendShellVerbsToMenu === 'function' ? nodeData.path : '';
  const shellReady = !!shellPath && typeof hasCachedShellVerbs === 'function' && hasCachedShellVerbs(shellPath);
  if (shellReady) {
    await appendShellVerbsToMenu(menu, shellPath, { editingLocked: _locked, beforeDisplay: true });
  }
  if (openSeq !== _outlinerContextMenuOpenSeq) return;
  _outlinerPlaceContextMenu(menu);
  if (shellPath && !shellReady) {
    appendShellVerbsToMenu(menu, shellPath, { editingLocked: _locked }).catch(() => {});
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
  if (nodeData._form_parent_path) {
    const path = String(nodeData.path || '').replace(/\\/g, '/');
    return path.slice(0, Math.max(0, path.lastIndexOf('/')));
  }
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
async function _outlinerFetchFolderListingForConfirm(parentPath, contextNodeEl, options = {}) {
  const sourceId = contextNodeEl?._nodeData?.sourceId || '';
  let rootPath = '';
  let cur = contextNodeEl || null;
  while (cur) {
    if (cur._nodeData?._isRoot) { rootPath = cur._nodeData.path; break; }
    cur = cur.parentElement ? cur.parentElement.closest('.tree-node') : null;
  }
  const rootParam = rootPath ? '&root=' + encodeURIComponent(rootPath) : '';
  const sourceParam = sourceId ? '&sourceId=' + encodeURIComponent(sourceId) : '';
  const controller = new AbortController();
  let timer;
  const timeout = new Promise(resolve => {
    timer = setTimeout(() => { controller.abort(); resolve(null); }, options.timeoutMs || 5000);
  });
  try {
    return await Promise.race([apiFetch('/browse?path=' + encodeURIComponent(parentPath || '') + rootParam + sourceParam + '&all_files=true&form_hierarchy=true' + (options.detail ? '&detail=true' : ''),
      { skipBrowseCache: true, cache: 'reload', timeoutMs: options.timeoutMs || 5000, signal: controller.signal }), timeout]);
  } catch {
    return null;
  } finally { clearTimeout(timer); }
}

// 一覧から旧名が消え新名が現れたことを確認する（リネームの事後確認用）。
// oldDisplayName は拡張子を含まない表示名（/browse の name と同じ規約）を渡すこと
function _outlinerFindRenamedItem(items, oldDisplayName, newName, originalPath) {
  if (!Array.isArray(items)) return null;
  // Title-only edits keep their path; another item may have the same display name.
  if (originalPath) {
    const original = items.find(it => it && it.path === originalPath);
    if (original) return original.name === newName ? original : null;
  }
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

function _insertOutlinerCreateNode(container, newNode, anchorNode) {
  if (!container || !newNode) return;
  if (anchorNode && (container.parentElement === anchorNode
      || anchorNode._nodeData?.path === container.closest('.tree-node')?._nodeData?.path)) {
    container.insertBefore(newNode, container.firstChild);
    return;
  }
  const sel = anchorNode || treeSelection.lastClicked;
  if (sel && sel._nodeData && sel.parentElement === container) {
    const selType = sel._nodeData.type;
    if (anchorNode || (selType !== 'folder' && selType !== 'database')) {
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
  else if (nd.type === 'form-app') openFormApp(nd.path, name, _expOpts);
  else if (nd.type === 'map') openMapApp(nd.path, name, _expOpts);
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
async function _outlinerHandleCreateTimeout(pendingNode, parentPath, type, existingNames, onConfirmed) {
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
        if (onConfirmed) await onConfirmed(found);
        _outlinerApplyCreateSuccess(pendingNode, found, { skipStatus: !!progress });
        progress?.succeed?.({ summary: `「${found.name}」を作成しました` });
        return;
      }
    }
    const message = '作成結果を確認できませんでした。重複を避けるため、再作成する前にフォルダを再読込してください';
    if (progress) progress.fail({ error: message });
    else showStatus(message, true);
  } finally {
    if (pendingNode?.parentNode) pendingNode.remove();
    if (progress && !window.MeldexOperationProgress?.isTerminalStatus?.(progress.getState()?.status)) {
      progress.fail({ error: '作成結果の確認を完了できませんでした' });
    }
    _outlinerPostTimeoutConfirmInFlight.delete(confirmKey);
  }
}

// アイテムを指定パス配下に追加（部分更新、チラつき防止）
async function addItemAt(parentPath, type, options = {}) {
  if (_isCloudPhase1BlockedCreateType(type)) {
    _showCloudPhase1BlockedCreate(type);
    return;
  }
  const label = '無題';
  // メニューを開いた行を固定し、API待機中の選択変更にも影響されないようにする。
  const anchorNode = options.anchorNode;
  const target = _resolveOutlinerCreateInsertTarget(parentPath, { expandUnloaded: false });
  const virtualTarget = !!window.GBOutlinerVirtualRender?.isVirtualContainer(target.container);
  const needsReload = !!anchorNode && (target.deferTreeInsert || virtualTarget);
  let pendingNode = null;
  let existingNames = null;
  let siblingNames = null;
  if (!target.deferTreeInsert && target.container && !needsReload) {
    existingNames = _outlinerSnapshotChildNames(target.container);
    siblingNames = [...target.container.querySelectorAll(':scope > .tree-node')]
      .map(node => node._nodeData?.path).filter(Boolean);
    pendingNode = _createOutlinerPendingCreateNode(type, label);
    _insertOutlinerCreateNode(target.container, pendingNode, anchorNode);
  }
  const saveCreateOrder = async (node) => {
    if (!anchorNode || !siblingNames) return;
    const names = siblingNames.slice();
    const anchorIndex = anchorNode._nodeData?.path === parentPath
      ? -1 : names.indexOf(anchorNode._nodeData?.path);
    names.splice(anchorIndex + 1, 0, node.path);
    setManualOrder(parentPath || '_root', names);
    setSortSetting(parentPath || '_root', 'manual', 'asc');
    if (needsReload) {
      if (virtualTarget) {
        const vr = window.GBOutlinerVirtualRender;
        const inside = anchorNode._nodeData?.path === parentPath;
        const referencePath = inside ? siblingNames[0] : anchorNode._nodeData?.path;
        vr.dropInto(target.container, [node]);
        if (referencePath) vr.reorderAround(target.container, [node.path], referencePath, inside ? 'above' : 'below');
      }
      _resolveOutlinerCreateInsertTarget(parentPath, { expandUnloaded: true });
    }
  };
  try {
    if (needsReload) {
      const sortCfg = getSortForFolder(parentPath);
      const virtualItems = window.GBOutlinerVirtualRender?.stateChildItemsFor(target.container, parentPath);
      const items = virtualItems || await _outlinerFetchFolderListingForConfirm(parentPath, anchorNode, {
        detail: !['manual', 'name'].includes(sortCfg.sort),
      });
      if (!Array.isArray(items)) throw new Error('追加先の並び順を取得できませんでした。もう一度お試しください');
      existingNames = new Set(items.map(item => _outlinerCreateItemIdentity(item.type, item.name)).filter(Boolean));
      const ordered = virtualItems || (sortCfg.sort === 'manual' ? _sortItemsByManualOrder(items, parentPath)
        : [...items].sort((a, b) => compareItemsForFolderSort(a, b, sortCfg.sort, sortCfg.order)));
      siblingNames = ordered.map(item => item.path).filter(Boolean);
    }
    const res = await apiPost('/outliner/add', { type, label, parent: parentPath });
    // サーバーはlabelを返すが、createTreeNodeFromBrowseはnameを使う
    if (!res.node.name) res.node.name = res.node.label;
    await saveCreateOrder(res.node);
    if (needsReload) {
      // 遅延読込または仮想化モデルで反映し、DOMだけの挿入を避ける。
      const createdNode = _findTreeNodeByPath(res.node.path);
      _selectOutlinerCreateNode(createdNode);
      _openOutlinerCreatedNode(res.node, res.node.name);
      return;
    }

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
      else _insertOutlinerCreateNode(insertTarget.container, newNode, anchorNode);
      // 挿入直後に切断されている場合の軽い保険
      if (!newNode.isConnected) loadOutliner();
    }

    // 選択状態にする
    if (!insertTarget.deferTreeInsert) _selectOutlinerCreateNode(newNode);
    // コンテンツを開く
    _openOutlinerCreatedNode(nd, name);
  } catch (e) {
    if (e && e.isTimeout) {
      await _outlinerHandleCreateTimeout(pendingNode, parentPath, type, existingNames, saveCreateOrder);
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

/* === gb-outliner.part03.js === */
  input.style.cssText = 'width:100%;background:var(--bg);color:var(--fg);border:1px solid var(--accent);border-radius:2px;padding:1px 4px;font-size:13px;outline:none;';
  labelEl.textContent = '';
  labelEl.appendChild(input);
  input.focus();
  // クリックがrowのclickイベントにバブルしてファイルを開くのを防止
  input.addEventListener('click', (e) => e.stopPropagation());
  input.addEventListener('dblclick', (e) => e.stopPropagation());

  let finished = false;
  const finish = async () => {
    if (finished) return;
    finished = true;
    const nv = input.value.trim() || '無題';
    labelEl.textContent = nv;

    // ファイル/フォルダの実体をリネーム
    if (nodeData.path && nv !== old) {
      const oldPath = nodeData.path;
      // 通信を待たずに、開いているタブやツールバーの名前も先に変える
      applyOptimisticRenameLabel(oldPath, nv, nodeData.type || 'page');
      try {
        const res = await apiPost('/outliner/rename', {
          old_path: oldPath,
          new_name: nv,
          type: nodeData.type || 'page',
          title_only: false
        });
        if (!res || !res.new_path) throw new Error('rename failed');
        _outlinerApplyRenameSuccess(oldPath, res.new_path, nv, res.file_id, nodeData, old, {etag:res.etag,titleOnly:res.title_only});
        if (typeof handleRelocateResponse === 'function') handleRelocateResponse(res);
      } catch (e) {
        if (e && e.isTimeout) {
          await _outlinerHandleTreeRenameTimeout(labelEl, nodeData, old, nv, oldPath);
        } else {
          // API失敗時はラベルを元に戻す（無言で戻すとユーザーが失敗に気づけないため理由も表示）
          applyOptimisticRenameLabel(oldPath, old, nodeData.type || 'page');
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
    e.stopPropagation();
    if (e.isComposing) return;
    if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
    if (e.key === 'Escape') { e.preventDefault(); input.value = old; input.blur(); }
  });
}

// リネーム成功時の反映（通常成功時とタイムアウト事後確認成功時で共通）
function _outlinerApplyRenameSuccess(oldPath, newPath, newName, fileId, nodeData, oldName, options) {
  const aliasPairs = (Array.isArray(nodeData?.pathAliases) ? nodeData.pathAliases : [])
    .filter(alias => alias && alias !== oldPath)
    .map(alias => {
      const normalized = String(alias).replace(/[\\/]+$/, '');
      const cut = Math.max(normalized.lastIndexOf('/'), normalized.lastIndexOf('\\'));
      return { oldPath: alias, newPath: (cut >= 0 ? normalized.slice(0, cut + 1) : '') + newName };
    });
  const applyPathReferences = (fromPath, toPath, label, response) => {
    if (typeof renameAppPathReferences !== 'function') return;
    renameAppPathReferences(fromPath, toPath, {
      preserveMountedViews: true,
      label,
      fileId: response?.file_id,
      etag: response?.etag,
      titleOnly: response?.title_only,
      type: nodeData.type || 'page',
    });
  };
  _renameTreeNode(oldPath, newPath, newName, fileId);
  aliasPairs.forEach(pair => _renameTreeNode(pair.oldPath, pair.newPath, newName, fileId));
  nodeData.path = newPath;
  nodeData.name = newName;
  nodeData.pathAliases = aliasPairs.map(pair => pair.newPath);
  // 取り消し・やり直し: 以前は表示名（oldName）をそのまま新しいファイル名として送り、
  // 戻った先を oldPath と決め打ちしていた。「タイトル＝ファイル名」では、表示タイトルと
  // ファイル名が違う項目（無題/ を「キャラ」と表示する等）が キャラ/ へ改名される一方、
  // ツリーと参照は存在しない 無題/ を指してしまう。元のファイル名へ戻してから表示タイトルを
  // 戻し、ツリーと参照はサーバーが実際に返したパスへ合わせる。
  const titleOnlyRename = options?.titleOnly === true || oldPath === newPath;
  const itemType = nodeData.type || 'page';
  const baseNameOf = (path) => String(path || '').replace(/[\/]+$/, '').split(/[\/]/).pop() || '';
  const storedStemOf = (fromPath, toPath) => {
    const fromBase = baseNameOf(fromPath);
    const toBase = baseNameOf(toPath);
    for (let index = fromBase.indexOf('.'); index > 0; index = fromBase.indexOf('.', index + 1)) {
      const ext = fromBase.slice(index);
      if (toBase.toLowerCase().endsWith(ext.toLowerCase())) return fromBase.slice(0, index);
    }
    return fromBase;
  };
  const originalStem = storedStemOf(oldPath, newPath);
  let currentPath = newPath;
  const renameTo = async (fromPath, fileStem, displayTitle) => {
    if (titleOnlyRename) {
      const res = await apiPost('/outliner/rename', { old_path: fromPath, new_name: displayTitle, type: itemType, title_only: true });
      return { response: res, path: res?.new_path || fromPath };
    }
    let res = await apiPost('/outliner/rename', { old_path: fromPath, new_name: fileStem, type: itemType, title_only: false });
    let path = res?.new_path || fromPath;
    if (displayTitle && displayTitle !== fileStem) {
      const titled = await apiPost('/outliner/rename', { old_path: path, new_name: displayTitle, type: itemType, title_only: true });
      res = { ...res, ...titled, new_path: path, file_id: titled?.file_id || res?.file_id };
    }
    return { response: res, path };
  };
  const moveTreeTo = (fromPath, toPath, label, response, aliasFrom, aliasTo) => {
    _renameTreeNode(fromPath, toPath, label, response?.file_id);
    aliasPairs.forEach(pair => _renameTreeNode(pair[aliasFrom], pair[aliasTo], label, response?.file_id));
    applyPathReferences(fromPath, toPath, label, response);
    aliasPairs.forEach(pair => applyPathReferences(pair[aliasFrom], pair[aliasTo], label, response));
    nodeData.path = toPath;
    nodeData.pathAliases = aliasPairs.map(pair => pair[aliasTo]);
  };
  historyPush(`リネーム: ${oldName} → ${newName}`,
    async () => {
      const { response, path } = await renameTo(currentPath, originalStem, oldName);
      moveTreeTo(currentPath, path, oldName, response, 'newPath', 'oldPath');
      nodeData.name = oldName;
      currentPath = path;
      if (path !== oldPath) showStatus(`元のファイル名に戻せなかったため「${baseNameOf(path)}」になりました`, true);
    },
    async () => {
      const { response, path } = await renameTo(currentPath, storedStemOf(newPath, oldPath), newName);
      moveTreeTo(currentPath, path, newName, response, 'oldPath', 'newPath');
      nodeData.name = newName;
      currentPath = path;
    }
  );
  const initialResponse = { file_id: fileId, etag: options?.etag, title_only: options?.titleOnly };
  applyPathReferences(oldPath, newPath, newName, initialResponse);
  aliasPairs.forEach(pair => applyPathReferences(pair.oldPath, pair.newPath, newName, initialResponse));
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
      const found = _outlinerFindRenamedItem(items, oldName, newName, oldPath);
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

// 名前の変更を確定した瞬間に、ツリー・タブ・ツールバーの表示名だけを先に変える。
// 保存先（パス）の差し替えはサーバーの応答後に renameAppPathReferences が行う。
// 改名の通信は環境によって数秒かかるため、待たずに名前が変わったことを見せる。
// 失敗時は同じ関数を元の名前で呼び直して戻す。
function applyOptimisticRenameLabel(path, label, type) {
  if (!path || label == null || label === '') return;
  const text = String(label);
  document.querySelectorAll('#outliner-tree .tree-node, #body-home .tree-node, #body-workspaces .tree-node').forEach(node => {
    if (node._nodeData?.path !== path) return;
    const labelEl = node.querySelector(':scope > .tree-node-row .tree-label');
    if (labelEl && !labelEl.querySelector('input')) labelEl.textContent = text;
  });
  try {
    if (typeof renameAppPathReferences === 'function') {
      renameAppPathReferences(path, path, { label: text, type: type || 'page', preserveMountedViews: true, skipDbReload: true });
    }
  } catch (error) {
    console.warn('[Meldex] 名前の先行表示に失敗しました', error);
  }
}
if (typeof window !== 'undefined') window.applyOptimisticRenameLabel = applyOptimisticRenameLabel;

// ツリーノードのパス・名前をDOM上で直接更新（リネーム後の即時反映用）
function _renameTreeNode(oldPath, newPath, newName, fileId) {
  const resolvedOldPath = window.GBOutlinerVirtualRender?.resolveUniquePath?.(oldPath) || '';
  if (resolvedOldPath) {
    const normalizedNewPath = String(newPath || '').replace(/\\/g, '/');
    const isAbsoluteNewPath = /^(?:[a-z]:\/|\/)/i.test(normalizedNewPath);
    const cut = Math.max(resolvedOldPath.lastIndexOf('/'), resolvedOldPath.lastIndexOf('\\'));
    oldPath = resolvedOldPath;
    newPath = isAbsoluteNewPath
      ? normalizedNewPath
      : (cut >= 0 ? resolvedOldPath.slice(0, cut + 1) : '') + (newName || normalizedNewPath);
  }
  window.GBOutlinerVirtualRender?.renamePath?.(oldPath, newPath, newName, fileId);
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

  if (typeof _folderApplyRename === 'function') _folderApplyRename(oldPath, newPath, newName, fileId);

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
  const selectedShortcut = document.querySelector('#body-recent .fav-item.selected, #body-favorites .fav-item.selected');
  const shortcutPath = String(window._meldexSidebarShortcutSelectionPath || '').replace(/\\/g, '/');
  if (selectedShortcut && shortcutPath && _outlinerHighlightPathMatches(shortcutPath, targetPath)) {
    // ショートカットから開いた直後の後追い表示更新で、同じ実体のツリー行へ色を移さない。
    document.querySelectorAll('.tree-node-row.active').forEach(r => r.classList.remove('active'));
    return;
  }
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
