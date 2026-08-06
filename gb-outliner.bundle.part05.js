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
function _outlinerApplyRenameSuccess(oldPath, newPath, newName, fileId, nodeData, oldName) {
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
  showStatus(`「${oldName}」→「${newName}」にリネームしました`);
}

// リネームAPIタイムアウト時の事後確認: 親フォルダを再取得し、旧名消滅・新名出現を確認する
async function _outlinerHandleTreeRenameTimeout(labelEl, nodeData, oldName, newName, oldPath) {
  const confirmKey = 'rename:' + oldPath;
  if (_outlinerPostTimeoutConfirmInFlight.has(confirmKey)) return;
  _outlinerPostTimeoutConfirmInFlight.add(confirmKey);
  try {
    showStatus('リネームに時間がかかっています。結果を確認中…');
    const parentPath = oldPath.includes('/') ? oldPath.substring(0, oldPath.lastIndexOf('/')) : '';
    const contextNodeEl = labelEl.closest('.tree-node');
    const delays = typeof _outlinerPostTimeoutConfirmDelays === 'function'
      ? _outlinerPostTimeoutConfirmDelays() : OUTLINER_POST_TIMEOUT_CONFIRM_DELAYS_MS;
    for (const delay of delays) {
      await new Promise(r => setTimeout(r, delay));
      const items = await _outlinerFetchFolderListingForConfirm(parentPath, contextNodeEl);
      const found = _outlinerFindRenamedItem(items, oldName, newName);
      if (found) {
        _outlinerApplyRenameSuccess(oldPath, found.path, newName, found.file_id, nodeData, oldName);
        return;
      }
    }
    // 確認中に全体再読込等でノードが再生成されている場合に備え、旧パスの
    // 現在のノードを探してラベルを戻す（元の labelEl は切断されている可能性がある）
    const liveNode = typeof _findTreeNodeByPath === 'function' ? _findTreeNodeByPath(oldPath) : null;
    const liveLabel = liveNode ? liveNode.querySelector(':scope > .tree-node-row .tree-label') : null;
    (liveLabel || labelEl).textContent = oldName;
    showStatus(`「${oldName}」のリネームに失敗（結果を確認できませんでした）`, true);
  } finally {
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
  const toggle = nodeEl?.querySelector?.(':scope > .tree-node-row .tree-toggle') || null;
  if (!toggle || toggle.dataset.expanded === undefined) return false;
  const expanded = toggle.dataset.expanded === 'true';
  if (expand === true && !expanded) { toggle.click(); return true; }
  if (expand === false && expanded) { toggle.click(); return true; }
  return false;
}

function _outlinerKeyboardIsExpandable(nodeEl) {
  const toggle = nodeEl?.querySelector?.(':scope > .tree-node-row .tree-toggle') || null;
  return !!toggle && toggle.dataset.expanded !== undefined;
}

function _outlinerKeyboardIsExpanded(nodeEl) {
  const toggle = nodeEl?.querySelector?.(':scope > .tree-node-row .tree-toggle') || null;
  return !!toggle && toggle.dataset.expanded === 'true';
}

// 標準Tree View操作（§2.4）: 閉じている子項目なら親へ選択を移す
function _outlinerKeyboardParentNode(nodeEl) {
  const container = nodeEl?.parentElement || null;
  return container?.closest?.('.tree-node') || null;
}

// 標準Tree View操作（§2.4）: 展開済みの親なら最初の子へ選択を移す
function _outlinerKeyboardFirstChildNode(nodeEl) {
  const childrenDiv = nodeEl?.querySelector?.(':scope > .tree-children') || null;
  return childrenDiv?.querySelector?.(':scope > .tree-node') || null;
}

function _handleOutlinerTreeKeydown(event) {
  if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
  if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', 'F2'].includes(event.key)) return;
  const target = event.target;
  if (target?.closest?.('input, textarea, select, [contenteditable="true"]')) return;
  const scopeSelector = _outlinerKeyboardScopeFromTarget(target);
  if (!scopeSelector) return;
  const current = _outlinerKeyboardNodeFromTarget(target, scopeSelector);
  event.preventDefault();
  event.stopPropagation();
  _outlinerKeyboardMarkActive();
  if (event.key === 'ArrowLeft') {
    if (!current) return;
    if (_outlinerKeyboardIsExpandable(current) && _outlinerKeyboardIsExpanded(current)) {
      _outlinerKeyboardToggle(current, false);
      return;
    }
    // 展開中でない（閉じた子項目・葉）場合は親へ選択を移す
    const parent = _outlinerKeyboardParentNode(current);
    if (parent) _outlinerKeyboardSelectNode(parent);
    return;
  }
  if (event.key === 'ArrowRight') {
    if (!current) return;
    if (_outlinerKeyboardIsExpandable(current)) {
      if (!_outlinerKeyboardIsExpanded(current)) {
        _outlinerKeyboardToggle(current, true);
        return;
      }
      // 展開済みなら最初の子へ選択を移す
      const firstChild = _outlinerKeyboardFirstChildNode(current);
      if (firstChild) {
        _outlinerKeyboardSelectNode(firstChild);
      } else {
        // 展開直後（子の読み込み中）に2打目のArrowRightが押された場合、
        // まだ子ノードがDOMに存在せずno-opになってしまう。読み込み完了後に
        // 最初の子へフォーカス移動するデフォルト動作を予約しておく
        // （gb-outliner.part01.part02.js の読み込み完了処理が消化する）。
        const childrenDiv = current.querySelector?.(':scope > .tree-children') || null;
        if (childrenDiv && childrenDiv.dataset.loading === 'true') {
          childrenDiv._outlinerPendingArrowRightFocusNode = current;
        }
      }
    }
    return;
  }
  if (event.key === 'Enter') {
    if (current) _outlinerKeyboardActivateNode(current);
    return;
  }
  if (event.key === 'F2') {
    if (current) _outlinerKeyboardStartRename(current);
    return;
  }
  if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
    if (_outlinerKeyboardTryVirtualStep(current, event.key)) return;
  }
  const nodes = _getVisibleTreeNodes(scopeSelector);
  if (!nodes.length) return;
  const rawIndex = nodes.indexOf(current);
  const currentIndex = rawIndex >= 0 ? rawIndex : (event.key === 'ArrowUp' ? 0 : -1);
  const nextIndex = event.key === 'ArrowUp'
    ? Math.max(0, currentIndex - 1)
    : Math.min(nodes.length - 1, currentIndex + 1);
  _outlinerKeyboardSelectNode(nodes[nextIndex]);
}

// 仮想化フォルダ(150件超)の直下の子は、表示範囲＋オーバースキャン分しか実DOM化されない
// （gb-outliner-virtual-render.js）。_getVisibleTreeNodes()はDOM実体限定のため、
// マウント範囲の境界（例: 220件中30件目で止まる）に達すると↓を押し続けても進めなくなり、
// 選択行がスクロールでアンマウント済みだとcurrent===nullになってnodes[0]（無関係な行）へ
// 飛んでしまう。この関数はUp/Downで「現在の選択が仮想化コンテナの内側にある」場合に、
// GBOutlinerVirtualの論理モデルを直接参照して次の論理行を求め、必要なら
// GBOutlinerVirtualRender.ensureLogicalIndexMounted()でスクロール補正+即時再マウントしてから
// 選択する。処理した場合はtrueを返し、呼び出し元はDOM実体限定のフォールバックへ進まない。
// 非仮想化フォルダ、または現在の選択が仮想化コンテナに属さない場合はfalseを返し、
// 既存の_getVisibleTreeNodes経路（親/兄弟への移動を含む）へそのまま委ねる
// （非仮想化フォルダの既存挙動は変更しない）。
function _outlinerKeyboardVirtualContainerFor(nodeEl) {
  const childrenDiv = nodeEl && nodeEl.parentElement;
  return (childrenDiv && childrenDiv.dataset && childrenDiv.dataset.virtual === 'true') ? childrenDiv : null;
}

function _outlinerKeyboardTryVirtualStep(current, key) {
  const vr = window.GBOutlinerVirtualRender;
  if (!vr || typeof vr.ensureLogicalIndexMounted !== 'function') return false;

  let childrenDiv = null;
  let path = null;
  let recoveringUnmounted = false;
  if (current) {
    childrenDiv = _outlinerKeyboardVirtualContainerFor(current);
    if (!childrenDiv) return false; // 非仮想化行の通常移動は既存経路(_getVisibleTreeNodes)に委ねる
    path = current._nodeData && current._nodeData.path;
  } else {
    // 選択行がアンマウント済み(current===null): treeSelection.lastClickedが保持する
    // 安定パス(._nodeData.path、DOM接続の有無に依存しない)から所属コンテナを復元する。
    const lastPath = treeSelection.lastClicked && treeSelection.lastClicked._nodeData && treeSelection.lastClicked._nodeData.path;
    if (!lastPath || typeof vr.containerForPath !== 'function') return false;
    childrenDiv = vr.containerForPath(lastPath);
    if (!childrenDiv) return false;
    path = lastPath;
    recoveringUnmounted = true;
  }

  const state = childrenDiv._virtualState;
  if (!state || !path) return false;
  const currentIndex = state.flat.findIndex(entry => entry.id === path);
  if (currentIndex < 0) return false;

  const delta = key === 'ArrowUp' ? -1 : 1;
  const nextIndex = Math.max(0, Math.min(state.flat.length - 1, currentIndex + delta));
  // コンテナの論理先頭/末尾に既に居て、これ以上コンテナ内側では動けない場合
  // （かつアンマウント復帰中でもない場合）は、親/兄弟への移動を含む既存経路に委ねる。
  if (nextIndex === currentIndex && !recoveringUnmounted) return false;

  const target = state.mountedByIndex.get(nextIndex) || vr.ensureLogicalIndexMounted(childrenDiv, nextIndex);
  if (!target) return false;
  _outlinerKeyboardSelectNode(target);
  return true;
}

(function initOutlinerTreeKeyboardNavigation() {
  const scroller = document.getElementById('tree-scroll-container');
  if (!scroller) return;
  if (!scroller.hasAttribute('tabindex')) scroller.tabIndex = 0;
  scroller.addEventListener('keydown', _handleOutlinerTreeKeydown);
})();

// ドラッグ中のホイールスクロール対応
(function() {
  let _isDragging = false;
  document.addEventListener('dragstart', () => { _isDragging = true; });
  document.addEventListener('dragend', () => { _isDragging = false; });
  document.addEventListener('drop', () => { _isDragging = false; });
  // ドラッグ中にホイールでスクロール可能にする
  const scrollTargets = ['tree-scroll-container'];
  scrollTargets.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('wheel', (e) => {
      if (!_isDragging) return;
      e.preventDefault();
      el.scrollTop += e.deltaY;
    }, { passive: false });
  });
})();

(function initOutlinerLassoSelection() {
  const scroller = document.getElementById('tree-scroll-container');
  if (!scroller) return;
  const LASSO_DRAG_THRESHOLD = 4;
  let active = false;
  let tracking = false;
  let box = null;
  let startX = 0;
  let startY = 0;
  let startClientX = 0;
  let startClientY = 0;
  let selectionMode = 'replace';
  let selectionScope = '#outliner-tree,#body-home';
  let baseSelection = [];
  let pointerId = null;
  let pointerCaptured = false;
  let _savedScrollerPosition = null;

  function _outlinerLassoMode(event) {
    if (event.ctrlKey || event.metaKey) return 'toggle';
    if (event.shiftKey) return 'add';
    return 'replace';
  }

  function _outlinerLassoScopeFromTarget(target) {
    if (target?.closest?.('#body-home')) return '#body-home';
    if (target?.closest?.('#body-workspaces')) return '#body-workspaces';
    if (target?.closest?.('#outliner-tree')) return '#outliner-tree';
    const section = target?.closest?.('.sidebar-section');
    if (section?.id === 'section-home') return '#body-home';
    if (section?.id === 'section-workspaces') return '#body-workspaces';
    if (section?.id === 'section-roots') return '#outliner-tree';
    return '#outliner-tree,#body-home';
  }

  // 空白ヒットテスト（§2.5・§4.1-2）: gb-outliner-input.js の共通入力判定モジュールへ委譲する。
  // 「明示コントロール」「項目行」のいずれでもない場合だけ矩形選択の待機対象にする。
  // 項目行（.tree-node-row）からの押下は、選択状態やmodifierキーに関わらず、
  // 矩形選択に一切入らない（ネイティブHTML5ドラッグ = 項目移動に判定を委ねる）。
  function _outlinerLassoIsBlankTarget(target) {
    if (window.GBOutlinerInput?.classifyPointerTarget) {
      return window.GBOutlinerInput.classifyPointerTarget(target) === 'blank';
    }
    // gb-outliner-input.js 未読込時のフォールバック（読み込み順に依存しないための保険）
    if (target?.closest?.('.tree-hover-btn, .tree-toggle, .tree-node-row, .sidebar-section-header, .fav-item, input, textarea, button, select, [contenteditable="true"]')) return false;
    if (target?.closest?.('#outliner-tree, #body-home, #body-workspaces')) return true;
    const section = target?.closest?.('.sidebar-section');
    if (section?.id === 'section-workspaces') return true;
    return section?.id === 'section-roots' || section?.id === 'section-home';
  }

  function _outlinerLassoRectForEvent(event) {
    const rect = scroller.getBoundingClientRect();
    const currentX = event.clientX - rect.left + scroller.scrollLeft;
    const currentY = event.clientY - rect.top + scroller.scrollTop;
    const left = Math.min(startX, currentX);
    const top = Math.min(startY, currentY);
    const width = Math.abs(currentX - startX);
    const height = Math.abs(currentY - startY);
    return { left, top, right: left + width, bottom: top + height, width, height };
  }

  function _outlinerLassoRowRect(row) {
    const rowRect = row.getBoundingClientRect();
    const scrollerRect = scroller.getBoundingClientRect();
    return {
      left: rowRect.left - scrollerRect.left + scroller.scrollLeft,
      top: rowRect.top - scrollerRect.top + scroller.scrollTop,
      right: rowRect.left - scrollerRect.left + scroller.scrollLeft + rowRect.width,
      bottom: rowRect.top - scrollerRect.top + scroller.scrollTop + rowRect.height,
    };
  }

  function _outlinerRectsOverlap(a, b) {
    return !(b.right < a.left || b.left > a.right || b.bottom < a.top || b.top > a.bottom);
  }

  const updateSelection = (lassoRect) => {
    const base = new Set(baseSelection.filter(node => node?.isConnected));
    const hitNodes = [];
    treeSelection.clear();
    base.forEach(node => treeSelection.add(node));
    _getVisibleTreeNodes(selectionScope).forEach(nodeEl => {
      const row = nodeEl.querySelector('.tree-node-row');
      if (!row) return;
      if (!_outlinerRectsOverlap(lassoRect, _outlinerLassoRowRect(row))) return;
      hitNodes.push(nodeEl);
      if (selectionMode === 'toggle' && base.has(nodeEl)) treeSelection.remove(nodeEl);
      else treeSelection.add(nodeEl);
    });
    treeSelection.lastClicked = hitNodes[hitNodes.length - 1] || [...treeSelection.items].pop() || treeSelection.lastClicked;
    if (treeSelection.items.size > 1) showStatus(treeSelection.items.size + ' 件選択中');
    // 仮想化コンテナ（フォルダツリー改修Phase3）: 現在マウントされていない行も、
    // 矩形の論理Y範囲から該当する表示モデルの行を求めて選択状態に反映する（§2.5）。
    if (window.GBOutlinerVirtualRender?.applyLassoSelection) {
      const basePaths = new Set([...base].map(node => node?._nodeData?.path).filter(Boolean));
      window.GBOutlinerVirtualRender.applyLassoSelection({
        lassoRect, scope: selectionScope, mode: selectionMode, basePaths,
      });
    }
  };

  const beginLasso = (event) => {
    if (active) return;
    active = true;
    if (!pointerCaptured && pointerId != null && scroller.setPointerCapture) {
      try {
        scroller.setPointerCapture(pointerId);
        pointerCaptured = true;
      } catch {}
    }
    box = document.createElement('div');
    box.className = 'outliner-lasso-box';
    _savedScrollerPosition = scroller.style.position;
    scroller.style.position = 'relative';
    scroller.appendChild(box);
    if (selectionMode === 'replace') treeSelection.clear();
    updateSelection(_outlinerLassoRectForEvent(event));
  };

  const endLasso = () => {
    if (!tracking && !active) return;
    const wasActive = active;
    active = false;
    tracking = false;
    removeDocumentPointerEndHandlers();
    box?.remove();
    box = null;
    if (pointerCaptured && pointerId != null && scroller.releasePointerCapture) {
      try { scroller.releasePointerCapture(pointerId); } catch {}
    }
    pointerId = null;
    pointerCaptured = false;
    // pointerdown で設定した inline position を元に戻す
    if (_savedScrollerPosition !== null) {
      scroller.style.position = _savedScrollerPosition;
      _savedScrollerPosition = null;
    }
    // 矩形選択は空白からしか開始しない（§2.5）ため、項目行クリックとの競合は起こらず、
    // 行クリック抑止のための暫定フラグ（フォルダツリー改修Phase 2で撤去済み）は不要になった。
    if (!wasActive && selectionMode === 'replace') treeSelection.clear();
  };

  function addDocumentPointerEndHandlers() {
    document.addEventListener('pointerup', endLasso, true);
    document.addEventListener('pointercancel', endLasso, true);
  }

  function removeDocumentPointerEndHandlers() {
    document.removeEventListener('pointerup', endLasso, true);
    document.removeEventListener('pointercancel', endLasso, true);
  }

  scroller.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    if (e.pointerType && e.pointerType !== 'mouse') return;
    // 空白ヒットテスト（§2.5）: 明示コントロール・項目行のいずれでもない場合だけ矩形選択を待機する。
    // 項目行から始まるドラッグは、選択状態やmodifierキーに関わらず矩形選択に一切入らない
    // （ネイティブHTML5ドラッグ = 項目移動にそのまま委ねる。行のdraggable属性を一時的に
    //   書き換えて競合を避ける旧来の暫定機構は撤去済み）。
    if (!_outlinerLassoIsBlankTarget(e.target)) return;
    selectionMode = _outlinerLassoMode(e);
    tracking = true;
    active = false;
    addDocumentPointerEndHandlers();
    pointerId = e.pointerId;
    pointerCaptured = false;
    selectionScope = _outlinerLassoScopeFromTarget(e.target);
    baseSelection = selectionMode === 'replace' ? [] : [...treeSelection.items];
    const rect = scroller.getBoundingClientRect();
    startX = e.clientX - rect.left + scroller.scrollLeft;
    startY = e.clientY - rect.top + scroller.scrollTop;
    startClientX = e.clientX;
    startClientY = e.clientY;
  });

  scroller.addEventListener('pointermove', (e) => {
    if (!tracking) return;
    const distance = Math.max(Math.abs(e.clientX - startClientX), Math.abs(e.clientY - startClientY));
    if (!active && distance < LASSO_DRAG_THRESHOLD) return;
    beginLasso(e);
    const rect = _outlinerLassoRectForEvent(e);
    const { left, top, width, height } = rect;
    box.style.left = left + 'px';
    box.style.top = top + 'px';
    box.style.width = width + 'px';
    box.style.height = height + 'px';
    updateSelection(rect);
    e.preventDefault();
  });
  scroller.addEventListener('pointerup', endLasso);
  scroller.addEventListener('pointercancel', endLasso);
})();

function _readOutlinerDroppedFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = ev => resolve(ev.target.result);
    reader.onerror = () => reject(reader.error || new Error('ファイルを読み込めませんでした'));
    reader.onabort = () => reject(new Error('ファイルの読み込みが中断されました'));
    reader.readAsDataURL(file);
  });
}

async function _uploadOutlinerDroppedFile(file, parentPath) {
  try {
    const data = await _readOutlinerDroppedFile(file);
    await apiFetch('/upload-file?path=' + encodeURIComponent(parentPath), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data, filename: file.name }),
    });
    return { ok: true, name: file.name };
  } catch (error) {
    return {
      ok: false,
      name: file?.name || 'ファイル',
      error: error?.message ? String(error.message) : '取り込みに失敗しました',
    };
  }
}

document.getElementById('outliner-tree')?.addEventListener('drop', async e => {
  e.preventDefault();
  const files = Array.from(e.dataTransfer.files || []); if (!files.length) return;
  let parentPath = '';
  // ドロップ先のフォルダを検出
  const nodeEl = e.target?.closest?.('.tree-node');
  if (nodeEl && nodeEl._nodeData) {
    const nd = nodeEl._nodeData;
    if (nd.type === 'folder' || nd.type === 'database') parentPath = nd.path;
    else parentPath = nd.path.substring(0, nd.path.lastIndexOf('/'));
  }
  showStatus(`${files.length}個のファイルをインポート中...`);
  const results = await Promise.all(files.map(file => _uploadOutlinerDroppedFile(file, parentPath)));
  await loadOutliner();
  const succeeded = results.filter(result => result.ok);
  const failed = results.filter(result => !result.ok);
  if (failed.length) {
    const names = failed.slice(0, 3).map(result => result.name).join('、');
    const suffix = failed.length > 3 ? ` ほか${failed.length - 3}件` : '';
    showStatus(`${succeeded.length}個をインポート、${failed.length}個は失敗しました: ${names}${suffix}`, true);
  } else {
    showStatus(files.length + '個のファイルをインポートしました');
  }
});
