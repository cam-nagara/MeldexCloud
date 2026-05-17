    addMenuItem('名前を変更...', async () => {
      closeTreeContextMenu();
      const roots = await apiFetch('/outliner-roots');
      const root = roots.find(r => r.path === nodeData.path);
      if (!root) return;
      const newName = await cfPrompt('表示名を入力:', root.name);
      if (!newName) return;
      root.name = newName;
      await apiPut('/outliner-roots', { roots });
      await loadOutliner();
      showStatus('名前を変更しました');
    }, null, 'pencil');
    addMenuItem('チーム管理...', async () => {
      closeTreeContextMenu();
      showSettingsModal({ panel: 'ユーザー', teamFolder: nodeData.path });
    }, null, 'users');
    addSep();
    addMenuItem('このソースフォルダを削除', async () => {
      closeTreeContextMenu();
      if (!await cfConfirm('ソースフォルダ「' + nodeData.name + '」をフォルダツリーから削除しますか？\n（ファイルは削除されません）')) return;
      const roots = await apiFetch('/outliner-roots');
      const newRoots = roots.filter(r => r.path !== nodeData.path);
      await apiPut('/outliner-roots', { roots: newRoots });
      await loadOutliner();
      showStatus('ソースフォルダを削除しました');
    }, null, 'trash2');
  }

  // --- 作品フォルダ設定（フォルダのみ） ---
  if (isFolder && !isMulti) {
    const curWork = getWorkFolder();
    const isWork = curWork === nodeData.path;
    const wfWrap = document.createElement('div');
    wfWrap.style.position = 'relative';
    const wfTrigger = document.createElement('div');
    wfTrigger.className = 'tree-ctx-item';
    wfTrigger.innerHTML = '<span style="margin-right:6px;opacity:0.7;">' + lucide('folder', 14) + '</span>作品フォルダ' + submenuArrow();
    wfTrigger.style.cssText = 'padding:4px 12px;cursor:pointer;';
    const wfPanel = document.createElement('div');
    wfPanel.className = 'gb-context-menu';
    wfPanel.style.cssText = 'display:none;min-width:140px;';
    attachHoverSubmenu(wfTrigger, wfPanel);
    [['設定する', true], ['解除する', false]].forEach(([label, setIt]) => {
      const si = document.createElement('div');
      si.innerHTML = radioMark(isWork === setIt) + label;
      si.style.cssText = 'padding:4px 12px;cursor:pointer;' + (isWork === setIt ? 'color:var(--accent);' : '');
      si.onmouseenter = () => { si.style.background = 'var(--bg4)'; };
      si.onmouseleave = () => { si.style.background = ''; };
      si.addEventListener('click', async () => {
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
      });
      wfPanel.appendChild(si);
    });
    wfWrap.appendChild(wfTrigger);
    wfWrap.appendChild(wfPanel);
    menu.appendChild(wfWrap);
  }

  // --- 並び替え（フォルダ・DB） ---
  if ((isFolder || isDB || isEntity) && !isMulti) {
    const sortPath = nodeData.path;
    const curSort = getSortForFolder(sortPath);
    // サブメニュー風: 1項目でクリック→展開
    const sortWrap = document.createElement('div');
    sortWrap.style.position = 'relative';
    const sortTrigger = document.createElement('div');
    sortTrigger.className = 'tree-ctx-item';
    sortTrigger.innerHTML = '<span style="margin-right:6px;opacity:0.7;">' + lucide('arrowUpDown', 14) + '</span>並び替え' + submenuArrow();
    sortTrigger.style.cssText = 'padding:4px 12px;cursor:pointer;';
    const sortPanel = document.createElement('div');
    sortPanel.className = 'gb-context-menu';
    sortPanel.style.cssText = 'display:none;min-width:140px;';
    attachHoverSubmenu(sortTrigger, sortPanel);
    const sortOpts = [
      { label: 'マニュアル', sort: 'manual', order: 'asc' },
      { label: '名前 ↑', sort: 'name', order: 'asc' },
      { label: '名前 ↓', sort: 'name', order: 'desc' },
      { label: '更新日時 ↑', sort: 'modified', order: 'asc' },
      { label: '更新日時 ↓', sort: 'modified', order: 'desc' },
      { label: '作成日時 ↑', sort: 'created', order: 'asc' },
      { label: '作成日時 ↓', sort: 'created', order: 'desc' },
    ];
    sortOpts.forEach(o => {
      const active = curSort.sort === o.sort && curSort.order === o.order;
      const si = document.createElement('div');
      si.innerHTML = radioMark(active) + o.label;
      si.style.cssText = 'padding:4px 12px;cursor:pointer;' + (active ? 'color:var(--accent);' : '');
      si.onmouseenter = () => { si.style.background = 'var(--bg4)'; };
      si.onmouseleave = () => { si.style.background = ''; };
      si.addEventListener('click', async () => {
        closeTreeContextMenu();
        const before = captureOutlinerSettingsHistory([SORT_SETTINGS_KEY]);
        setSortSetting(sortPath, o.sort, o.order);
        pushOutlinerSettingsHistory(
          'フォルダツリー: 並び替え設定',
          before,
          sortPath + ' / ' + o.label,
          [SORT_SETTINGS_KEY]
        );
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
      });
      sortPanel.appendChild(si);
    });
    sortWrap.appendChild(sortTrigger);
    sortWrap.appendChild(sortPanel);
    addSep();
    menu.appendChild(sortWrap);
  }

  // --- 削除（エントリ以外、ロック中は無効） ---
  if (!isEntity && !_locked && !nodeData._isRoot) {
    addSep();
    const delLabel = isMulti ? `削除（${selectedCount}件）` : '削除';
    addMenuItem(delLabel, async () => {
      closeTreeContextMenu();
      const targets = treeSelection.getNodeData().filter(d => {
        if (d.type === 'entity' || d._isRoot) return false;
        if (!d.path || typeof isItemLocked !== 'function') return true;
        return !isItemLocked(d.path);
      });
      if (!targets.length) {
        showStatus('削除できる項目がありません', true);
        return;
      }
      const names = targets.map(d => d.name).join('、');
      if (!await cfConfirm(`「${names}」を削除しますか？`)) return;
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
        },
      });
      _removeOutlinerNodesForPaths(result.deletedPaths);
      if (result.failedCount) {
        showStatus(`${result.deletedCount || result.succeeded.length}件を削除、${result.failedCount}件は失敗しました`, true);
        loadOutliner();
      } else if (result.succeeded.length) {
        showStatus(`${result.deletedCount || result.succeeded.length}件を削除しました（Undoで戻せます）`);
      } else if (result.skipped.length) {
        showStatus('削除対象が見つからなかったため、表示を更新しました', true);
        loadOutliner();
      }
    }, 'danger', 'trash2');
  }

  // --- スプリットビュー ---
  if (!isMulti && isDB && nodeData.path && typeof isSplitActive === 'function') {
    addSep();
    if (isSplitActive()) {
      addMenuItem('別の作業領域で開く', () => { closeTreeContextMenu(); openDbInOtherPane(nodeData.path); }, null, 'columns');
    } else {
      addMenuItem('スプリットで開く', () => { closeTreeContextMenu(); openInNewSplit(nodeData.path); }, null, 'columns');
    }
  }

  document.body.appendChild(menu);
  { const rect = menu.getBoundingClientRect(); const z = _getZoom();
  if (rect.right > window.innerWidth) menu.style.left = ((window.innerWidth - rect.width - 4) / z) + 'px';
  if (rect.bottom > window.innerHeight) menu.style.top = ((window.innerHeight - rect.height - 4) / z) + 'px'; }

  // OSシェルメニュー項目を非同期追加
  if (nodeData.path && typeof appendShellVerbsToMenu === 'function') {
    appendShellVerbsToMenu(menu, nodeData.path);
  }

  setTimeout(() => {
    document.addEventListener('pointerdown', function closer(e) {
      // body 直下に分離したサブメニューも考慮
      const inAnyMenu = [...document.querySelectorAll('.gb-context-menu')].some(m => m.contains(e.target));
      if (!inAnyMenu) { closeTreeContextMenu(); document.removeEventListener('pointerdown', closer); }
    });
  }, 0);
}

// 追加先の親パスを決定
function getAddParentPath(nodeEl, nodeData, options = {}) {
  const isContainer = nodeData.type === 'folder' || nodeData.type === 'database';
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

// アイテムを指定パス配下に追加（部分更新、チラつき防止）
async function addItemAt(parentPath, type) {
  if (_isCloudPhase1BlockedCreateType(type)) {
    _showCloudPhase1BlockedCreate(type);
    return;
  }
  const label = '無題';
  const target = _resolveOutlinerCreateInsertTarget(parentPath, { expandUnloaded: false });
  let pendingNode = null;
  if (!target.deferTreeInsert && target.container) {
    pendingNode = _createOutlinerPendingCreateNode(type, label);
    _insertOutlinerCreateNode(target.container, pendingNode);
    pendingNode.scrollIntoView({ block: 'nearest' });
  }
  try {
    const res = await apiPost('/outliner/add', { type, label, parent: parentPath });
    // サーバーはlabelを返すが、createTreeNodeFromBrowseはnameを使う
    if (!res.node.name) res.node.name = res.node.label;

    const insertTarget = target.deferTreeInsert
      ? _resolveOutlinerCreateInsertTarget(parentPath, { expandUnloaded: true })
      : target;
    const newNode = insertTarget.deferTreeInsert ? null : createTreeNodeFromBrowse(res.node);

    if (!insertTarget.deferTreeInsert && newNode) {
      if (pendingNode && pendingNode.parentNode) pendingNode.replaceWith(newNode);
      else _insertOutlinerCreateNode(insertTarget.container, newNode);
    }

    if (!insertTarget.deferTreeInsert) newNode.scrollIntoView({ block: 'nearest' });
    const nd = res.node;
    const name = nd.name || nd.label || label;
    // 選択状態にする
    if (!insertTarget.deferTreeInsert) _selectOutlinerCreateNode(newNode);
    // コンテンツを開く
    _openOutlinerCreatedNode(nd, name);
  } catch (e) {
    if (pendingNode && pendingNode.parentNode) pendingNode.remove();
    showStatus((e && e.message) || '追加に失敗しました', true);
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
      if (nd.type === 'folder' || nd.type === 'database') {
        const toggle = treeSelection.lastClicked.querySelector('.tree-toggle');
        parentPath = (toggle && toggle.dataset.expanded === 'true') ? nd.path : _homeFolderPath;
      } else {
        const pn = treeSelection.lastClicked.parentElement?.closest('.tree-node');
        parentPath = pn?._nodeData?.path || _homeFolderPath;
      }
    } else {
      parentPath = getAddParentPath(treeSelection.lastClicked, treeSelection.lastClicked._nodeData);
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
