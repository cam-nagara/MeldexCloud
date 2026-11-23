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

// フォームの原本と回答用シートは、サーバーと同じく個人ホームの中へ作る。
function _outlinerCreateParentPath(parentPath, type) {
  if (type !== 'form-app' || typeof _homeFolderPath === 'undefined' || !_homeFolderPath) return parentPath;
  const key = path => {
    let value = String(path || '').replace(/\\/g, '/').replace(/\/+$/, '');
    const vault = String(typeof state !== 'undefined' ? state.vaultPath || '' : '').replace(/\\/g, '/').replace(/\/+$/, '');
    if (/^(?:[a-z]:\/|\/\/)/i.test(vault) && value && !/^(?:[a-z][a-z0-9+.-]*:|\/)/i.test(value)) value = vault + '/' + value;
    return /^(?:[a-z]:\/|\/\/)/i.test(value) ? value.toLowerCase() : value;
  };
  const home = key(_homeFolderPath), parent = key(parentPath);
  return parent === home || parent.startsWith(home + '/') ? parentPath : _homeFolderPath;
}

// アイテムを指定パス配下に追加（部分更新、チラつき防止）
async function addItemAt(parentPath, type, options = {}) {
  if (_isCloudPhase1BlockedCreateType(type)) {
    _showCloudPhase1BlockedCreate(type);
    return;
  }
  const createParent = _outlinerCreateParentPath(parentPath, type);
  if (createParent !== parentPath) {
    parentPath = createParent;
    options = { ...options, anchorNode: null, preferHome: true };
  }
  // 改名で空いた旧名を次の作成が再利用する前に、改名の画面と保存先参照の更新まで終える。
  // 順序が逆になると、遅れて届いた改名が新しく同じ旧名で作った行・タブまで変更してしまう。
  const originVault = typeof state !== 'undefined' ? state.vaultPath : '';
  if (typeof _outlinerPendingRenames !== 'undefined' && _outlinerPendingRenames.size) {
    await Promise.all([..._outlinerPendingRenames.values()].map(pending => pending.promise));
    if (originVault !== (typeof state !== 'undefined' ? state.vaultPath : '')) return;
  }
  const label = '無題';
  // メニューを開いた行を固定し、API待機中の選択変更にも影響されないようにする。
  const anchorNode = options.anchorNode;
  // 閉じた作成先は、保存と並行して読み込む。行の＋は並び順を先に確かめる従来の経路を保つ。
  const target = _resolveOutlinerCreateInsertTarget(parentPath, { expandUnloaded: !anchorNode, preferHome: options.preferHome });
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
    // 取り消しの記録は、操作を始めた画面の履歴に積む（2026-11-21 ユーザー決定。取り消しは作ったものをゴミ箱へ移す）。
    // フォルダツリー・フォルダパネル・コマンドパレットからの新規作成は、操作を始めた画面が「共通」の画面なので
    // 共通の履歴へ積む。以前は、たまたま開いていたエディタ（前に作ったシナリオ等）の履歴に積んでいたため、
    // 作ったファイルが新しいタブで開いた後は Ctrl+Z が届かず、元のエディタからの Ctrl+Z が別のファイルを
    // ゴミ箱へ移していた（2026-11-22 M-014 フォルダツリー網羅テスト）。別の画面からの共通履歴への落ち込みは
    // 履歴の守り（作ったファイル以外を消す記録へは落ちない）が止める。
    const createHistoryScope = '';
    const res = await apiPost('/outliner/add', { type, label, parent: parentPath });
    // サーバーはlabelを返すが、createTreeNodeFromBrowseはnameを使う
    if (!res.node.name) res.node.name = res.node.label;
    const companions = Array.isArray(res.node.companion_paths) ? res.node.companion_paths.filter(Boolean) : [];
    if (res.node.path && companions.length && typeof _pushCreatedOutlinerItemsHistory === 'function') {
      // フォームは入力先のシートも一緒に作る。取り消しで両方をゴミ箱へ移す（以前はフォームだけが消え、
      // シートが残っていた: 2026-11-22 M-014 フォルダツリー網羅テスト）。
      _pushCreatedOutlinerItemsHistory([
        { path: res.node.path, type: res.node.type || type, kind: 'file' },
        ...companions.map(path => ({ path, type: 'database', kind: 'folder' })),
      ], '新規作成: ' + (res.node.name || label), createHistoryScope);
    } else if (res.node.path && typeof pushCreatedOutlinerItemHistory === 'function') {
      pushCreatedOutlinerItemHistory({ path: res.node.path, type: res.node.type || type }, '新規作成: ' + (res.node.name || label), {
        scope: createHistoryScope,
      });
    }
    await saveCreateOrder(res.node);
    if (needsReload) {
      // 遅延読込または仮想化モデルで反映し、DOMだけの挿入を避ける。
      const createdNode = _findTreeNodeByPath(res.node.path);
      _selectOutlinerCreateNode(createdNode);
      _openOutlinerCreatedNode(res.node, res.node.name);
      return;
    }

    let insertTarget = target.deferTreeInsert
      ? _resolveOutlinerCreateInsertTarget(parentPath, { expandUnloaded: true, preferHome: options.preferHome })
      : target;
    // API待機中にワークスペースセクション等が再描画され、挿入先コンテナが
    // DOMから切断されていた場合は挿入先を再解決する
    if (!insertTarget.deferTreeInsert && !insertTarget.container?.isConnected) {
      insertTarget = _resolveOutlinerCreateInsertTarget(parentPath, { expandUnloaded: true, preferHome: options.preferHome });
    }
    const nd = res.node;
    const name = nd.name || nd.label || label;
    // 挿入先が最後まで解決できない場合はルート等へ誤挿入せず全体再読込に委ねる
    if (!insertTarget.deferTreeInsert && !insertTarget.container) {
      await _outlinerCreateFallbackToReload(pendingNode, nd, name);
      return;
    }
    const virtualInsert = !insertTarget.deferTreeInsert
      && window.GBOutlinerVirtualRender?.isVirtualContainer(insertTarget.container);
    if (virtualInsert) {
      if (pendingNode?.parentNode) pendingNode.remove();
      window.GBOutlinerVirtualRender.dropInto(insertTarget.container, [res.node]);
    }
    const newNode = insertTarget.deferTreeInsert ? null
      : virtualInsert ? _findTreeNodeByPath(res.node.path) : createTreeNodeFromBrowse(res.node);

    if (!insertTarget.deferTreeInsert && newNode && !virtualInsert) {
      if (pendingNode && pendingNode.parentNode) pendingNode.replaceWith(newNode);
      else _insertOutlinerCreateNode(insertTarget.container, newNode, anchorNode);
      // 挿入直後に切断されている場合の軽い保険
      if (!newNode.isConnected) loadOutliner();
    }

    // 選択状態にする
    if (!insertTarget.deferTreeInsert) _selectOutlinerCreateNode(newNode);
    if (typeof _folderApplySavedDropResults === 'function') {
      _folderApplySavedDropResults(parentPath, [{ item: { ...res.node, name } }], []);
    }
    // 作成が確定した行を先に描画する。ボード等の初期表示で行の反映まで待たせない。
    const createVault = typeof state !== 'undefined' ? state.vaultPath : '';
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 0))));
    if (createVault !== (typeof state !== 'undefined' ? state.vaultPath : '')) return;
    // コンテンツを開く
    _openOutlinerCreatedNode(nd, name);
    // フォルダパネルが同じフォルダを開いていれば、作ったものをすぐ出す
    if (typeof _outlinerRefreshFolderPanelFor === 'function') _outlinerRefreshFolderPanelFor([parentPath]);
    // 一緒に作ったもの（フォームのシート）も、作った場所のフォルダを差分で反映して出す。
    // ホームフォルダの直下は、ホームの節の読み込みと重なると作ったものが消えることがあった（節の一覧を
    // 作成の前の内容で描き直す: 2026-11-22 M-014）ので、作成の後にホームの節を読み直す。
    const createdInHome = typeof _homeFolderPath !== 'undefined' && _homeFolderPath && parentPath === _homeFolderPath;
    if ((companions.length || createdInHome) && typeof _outlinerSyncFoldersOrReload === 'function') {
      await _outlinerSyncFoldersOrReload([parentPath]);
    }
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
  const reservation = typeof historyReserve === 'function' ? historyReserve('トピック追加', '') : null;
  try {
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
    if (typeof loadOutliner === 'function') await loadOutliner();
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
  // フォルダパネルが同じフォルダを開いていれば、新しい名前をすぐ出す
  // （フォルダパネルでの名前の変更はパネル自身が表示を直すので、ツリーの行の名前の変更の時だけ）
  const fromTree = Array.from(document.querySelectorAll('#sidebar .tree-node')).some(node => node._nodeData === nodeData);
  if (fromTree && typeof _outlinerRefreshFolderPanelFor === 'function') _outlinerRefreshFolderPanelFor([_outlinerParentPath(newPath), _outlinerParentPath(oldPath)]);
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
