  if (!path) return;
  const reservation = typeof historyReserve === 'function' ? historyReserve('トピック追加', '') : null;
  try {
    // 子一覧は保存と並行して読み込む。確定したエントリは応答から差分で足す。
    if (typeof _resolveOutlinerCreateInsertTarget === 'function') _resolveOutlinerCreateInsertTarget(path, { expandUnloaded: true });
    const result = await apiPost('/entity/create', { parent_path: path, name: '無題' });
    const entryPath = result?.path || result?.entry_path;
    if (entryPath && typeof pushCreatedOutlinerItemHistory === 'function') {
      const register = () => pushCreatedOutlinerItemHistory({
        path: entryPath, type: 'entity', name: result.name || '無題',
        entry_id: result.entry_id || result.id || '',
      }, 'トピック追加', { scope: '' });
      if (reservation) reservation.capture(register); else register();
    }
    showStatus('トピックを追加しました');
    let target = typeof _resolveOutlinerCreateInsertTarget === 'function'
      ? _resolveOutlinerCreateInsertTarget(path, { expandUnloaded: true }) : null;
    const directInsert = entryPath && target?.container && !target.deferTreeInsert && typeof _folderInsertDroppedItemsIntoOutliner === 'function';
    if (directInsert) {
      _folderInsertDroppedItemsIntoOutliner(path, [{
        path: entryPath, name: result.name || '無題', type: 'entity', _dbPath: path,
        entityData: { _entry_path: entryPath, _id: result.entry_id || result.id || '' },
      }]);
    } else {
      // 保存前に始めた読込がまだ続いている場合は、完了後の最新pivotで照合する。
      for (let wait = 0; target?.deferTreeInsert && wait < 40; wait += 1) {
        await new Promise(resolve => setTimeout(resolve, 25));
        target = _resolveOutlinerCreateInsertTarget(path, { expandUnloaded: true });
      }
      if (typeof _outlinerSyncFoldersOrReload === 'function') await _outlinerSyncFoldersOrReload([path]);
      else if (typeof loadOutliner === 'function') await loadOutliner();
    }
    // 行を描く前に、開いたシートの追加の読込で画面を混ませない。
    if (typeof requestAnimationFrame === 'function') await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    // 確定した行を先に描いてから、並びと他のエントリを最新の保存内容へ照合する。
    if (directInsert && typeof _outlinerSyncFoldersOrReload === 'function') await _outlinerSyncFoldersOrReload([path]);
    if (typeof navOpen === 'function') navOpen({ type: 'pivot', label: path.split('/').pop() || 'シート', path });
  } catch (e) {
    showStatus((e && e.message) || 'トピックの追加に失敗しました', true);
  } finally {
    reservation?.cancel();
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
  const pending = typeof _outlinerPendingRenames !== 'undefined'
    ? _outlinerPendingRenames.get(_outlinerPendingRenameKey(nodeData?.path)) : null;
  if (pending) {
    // 最初の失敗の表示とラベルの復帰の間にF2が来ても、仮の名前を次の変更前の値にしない。
    pending.retryLabels ||= new WeakSet();
    if (!pending.retryLabels.has(labelEl)) {
      pending.retryLabels.add(labelEl);
      pending.promise.then(() => {
        if (labelEl.isConnected && !labelEl.querySelector('input')) startTreeLabelEdit(labelEl, nodeData, onFinish);
      }).catch(error => showStatus('名前の入力を再開できませんでした: ' + (error?.message || error), true));
    }
    return;
  }
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
      // 履歴の枠は確定の時点で取る。画面の名前は先に変わるので、保存の往復の前に Ctrl+Z を押すと、
      // 名前の変更ではなくその前の操作が取り消されていた（2026-11-22 M-014 フォルダツリー網羅テスト。v0.7.529 と同じ型）。
      const renameReservation = typeof historyReserve === 'function' ? historyReserve(`リネーム: ${old} → ${nv}`, '') : null;
      let resolvePendingRename;
      const pendingRename = { promise: new Promise(resolve => { resolvePendingRename = resolve; }) };
      const pendingKey = _outlinerPendingRenameKey(oldPath);
      _outlinerPendingRenames.set(pendingKey, pendingRename);
      let renameOutcome = { ok: false };
      try {
        const res = await apiPost('/outliner/rename', {
          old_path: oldPath,
          new_name: nv,
          type: nodeData.type || 'page',
          title_only: false
        });
        if (!res || !res.new_path) throw new Error('rename failed');
        const applySuccess = () => _outlinerApplyRenameSuccess(oldPath, res.new_path, nv, res.file_id, nodeData, old, {etag:res.etag,titleOnly:res.title_only});
        if (renameReservation) renameReservation.capture(applySuccess); else applySuccess();
        renameOutcome = { ok: true, newPath: _outlinerTreeFormPath(oldPath, res.new_path), newName: nv, fileId: res.file_id };
        if (typeof handleRelocateResponse === 'function') handleRelocateResponse(res);
      } catch (e) {
        renameReservation?.cancel();
        if (e && e.isTimeout) {
          await _outlinerHandleTreeRenameTimeout(labelEl, nodeData, old, nv, oldPath);
          if (nodeData.path && nodeData.path !== oldPath) renameOutcome = {
            ok: true, newPath: nodeData.path, newName: nodeData.name || nv, fileId: nodeData.file_id,
          };
        } else {
          // API失敗時はラベルを元に戻す（無言で戻すとユーザーが失敗に気づけないため理由も表示）
          applyOptimisticRenameLabel(oldPath, old, nodeData.type || 'page');
          labelEl.textContent = old;
          const reason = (e && (e.userMessage || e.message)) ? String(e.userMessage || e.message) : '';
          showStatus(`「${old}」のリネームに失敗` + (reason ? `（${reason}）` : ''), true);
        }
      } finally {
        if (_outlinerPendingRenames.get(pendingKey) === pendingRename) _outlinerPendingRenames.delete(pendingKey);
        resolvePendingRename(renameOutcome);
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
// 名前の変更の結果（保存先の相対パス）を、ツリーの行と同じ形（ソースフォルダの絶対パスから始まる形）にそろえる。
// 名前の変更は同じフォルダの中の変更なので、元のパスの親に新しい名前を付ける。形がずれると、取り消し・やり直しの
// 後にツリーの行のパスが更新されず、その行をクリックしても開かなくなっていた（2026-11-22 M-014 パネル担当の報告）。
function _outlinerTreeFormPath(fromPath, responsePath) {
  const from = String(fromPath || '');
  const next = String(responsePath || '');
  if (!next) return from;
  const isAbs = value => /^(?:[a-z]:[\\/]|\/)/i.test(value);
  if (!isAbs(from) || isAbs(next)) return next;
  const cut = Math.max(from.lastIndexOf('/'), from.lastIndexOf('\\'));
  const baseName = next.replace(/[\\/]+$/, '').split(/[\\/]/).pop();
  return (cut >= 0 ? from.slice(0, cut + 1) : '') + baseName;
}

function _outlinerApplyRenameSuccess(oldPath, newPath, newName, fileId, nodeData, oldName, options) {
  newPath = _outlinerTreeFormPath(oldPath, newPath);
  const aliases = new Set(Array.isArray(nodeData?.pathAliases) ? nodeData.pathAliases : []);
  // Native folder listings use vault-relative paths; an already open Form may use
  // the absolute path returned by creation. Only derive this alias from the actual
  // local vault root, never from a filename suffix or a Cloud namespace.
  const root = String(typeof state !== 'undefined' ? state.vaultPath || '' : '').replace(/\\/g, '/').replace(/\/+$/, '');
  const from = String(oldPath).replace(/\\/g, '/');
  if (nodeData?.type === 'form-app' && /^(?:[a-z]:\/|\/\/)/i.test(root)
      && !(typeof window !== 'undefined' && window.MeldexRuntimeAdapter?.isBrowserDataMode?.())) {
    if (from.startsWith(root + '/')) aliases.add(from.slice(root.length + 1));
    else if (!/^(?:[a-z][a-z0-9+.-]*:|\/)/i.test(from)) aliases.add(root + '/' + from);
  }
  if (nodeData?.type === 'form-app' && typeof window !== 'undefined'
      && window.MeldexRuntimeAdapter?.isBrowserDataMode?.() && typeof forEachComponent === 'function') {
    const provider = window.MeldexStorageAdapter?.getProvider?.();
    if (typeof provider?._dropboxLocation === 'function') {
      const locationKey = path => {
        const value = provider._dropboxLocation(path);
        return typeof value?.path === 'string' && value.namespaceKind
          ? JSON.stringify([value.namespaceKind, value.path.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()]) : null;
      };
      try {
        const target = locationKey(oldPath);
        if (target) forEachComponent(component => {
          if (component?.store?.doc?.fileType === 'meldex-form' && component.path && locationKey(component.path) === target) aliases.add(component.path);
        });
      } catch (error) { console.warn('[Meldex] フォームの改名先の別名を確認できませんでした', error); }
    }
  }
  const targetBase = String(newPath).replace(/\\/g, '/').replace(/\/+$/, '').split('/').pop();
  const aliasPairs = [...aliases]
    .filter(alias => alias && alias !== oldPath)
    .map(alias => {
      const normalized = String(alias).replace(/[\\/]+$/, '');
      const cut = Math.max(normalized.lastIndexOf('/'), normalized.lastIndexOf('\\'));
      return { oldPath: alias, newPath: (cut >= 0 ? normalized.slice(0, cut + 1) : '') + targetBase };
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
  if (!options?.historyOnly) {
    _renameTreeNode(oldPath, newPath, newName, fileId);
    aliasPairs.forEach(pair => _renameTreeNode(pair.oldPath, pair.newPath, newName, fileId));
  }
  // フォルダパネルが同じフォルダを開いていれば、新しい名前をすぐ出す
  // （フォルダパネルでの名前の変更はパネル自身が表示を直すので、ツリーの行の名前の変更の時だけ）
  const fromTree = Array.from(document.querySelectorAll('#sidebar .tree-node')).some(node => node._nodeData === nodeData);
  if (!options?.historyOnly && fromTree && typeof _outlinerRefreshFolderPanelFor === 'function') _outlinerRefreshFolderPanelFor([_outlinerParentPath(newPath), _outlinerParentPath(oldPath)]);
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
      return { response: res, path: _outlinerTreeFormPath(fromPath, res?.new_path || fromPath) };
    }
    let res = await apiPost('/outliner/rename', { old_path: fromPath, new_name: fileStem, type: itemType, title_only: false });
    let path = _outlinerTreeFormPath(fromPath, res?.new_path || fromPath);
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
  const undoRename = async () => {
      const { response, path } = await renameTo(currentPath, originalStem, oldName);
      moveTreeTo(currentPath, path, oldName, response, 'newPath', 'oldPath');
      nodeData.name = oldName;
      currentPath = path;
      options?.onHistoryApplied?.(oldName);
      if (path !== oldPath) showStatus(`元のファイル名に戻せなかったため「${baseNameOf(path)}」になりました`, true);
    };
  const redoRename = async () => {
      const { response, path } = await renameTo(currentPath, storedStemOf(newPath, oldPath), newName);
      moveTreeTo(currentPath, path, newName, response, 'oldPath', 'newPath');
      nodeData.name = newName;
      currentPath = path;
      options?.onHistoryApplied?.(newName);
    };
  if (options?.historyReservation) options.historyReservation.fill(undoRename, redoRename);
  else historyPush(`リネーム: ${oldName} → ${newName}`, undoRename, redoRename, options?.historyScope);
  const initialResponse = { file_id: fileId, etag: options?.etag, title_only: options?.titleOnly };
  if (!options?.historyOnly) {
    applyPathReferences(oldPath, newPath, newName, initialResponse);
    aliasPairs.forEach(pair => applyPathReferences(pair.oldPath, pair.newPath, newName, initialResponse));
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
  // 通常の「開いた項目の強調」は位置を動かさない。明示的な表示要求だけ移動できる。
  const noScroll = opts?.noScroll !== false;
  // まず既に表示されているノードを探す
  let found = _findAndHighlight(targetPath, noScroll);
  if (found) return;
  // 見つからない場合、パスを分解して親フォルダを順に展開
  if (!noScroll) _autoExpandToPath(targetPath, noScroll);
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
  // フォルダツリーにフォーカスがある時の Ctrl+Z / Ctrl+Y は、フォルダツリーの操作（作成・複製・移動・削除・
  // 編集ロック）が入る共通の履歴を戻す・進める。以前は開いているエディタ（クリックで開いたノート等）の範囲になり、
  // 作った・複製したものを消す記録へは安全のため落ちないので「元に戻す操作がありません」になっていた（2026-11-22 M-014）。
  if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.defaultPrevented) {
    const key = String(event.key || '').toLowerCase();
    const isUndo = key === 'z' && !event.shiftKey;
    const isRedo = key === 'y' || (key === 'z' && event.shiftKey);
    if ((isUndo || isRedo) && !event.target?.closest?.('input, textarea, select, [contenteditable="true"]')
        && _outlinerKeyboardScopeFromTarget(event.target) && typeof historyUndo === 'function') {
      event.preventDefault();
      event.stopPropagation();
      if (isUndo) historyUndo(''); else historyRedo('');
      return;
    }
  }
  if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
  if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', 'F2', 'Delete'].includes(event.key)) return;
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
  // Delete: ツリーにフォーカスがある時はツリーの選択を削除する（マニュアルのショートカット）。
  // 以前はツリーで扱わず、全体のショートカットがフォルダパネルの選択を削除していた（2026-11-22 M-014）。
  if (event.key === 'Delete') {
    if (current && !treeSelection.has(current)) {
      treeSelection.clear();
      treeSelection.add(current);
      treeSelection.lastClicked = current;
    }
    if (typeof deleteOutlinerTreeSelection === 'function') deleteOutlinerTreeSelection();
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
