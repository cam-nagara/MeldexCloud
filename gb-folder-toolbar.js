(function(global) {
  'use strict';

  const CREATE_ITEMS = Object.freeze([
    ['フォルダ', 'folder', 'folder'],
    ['ノート', 'page', 'page'],
    ['シナリオ', 'scriptnote', 'bookOpenText'],
    ['シート', 'database', 'db'],
    ['ボード', 'board', 'presentation'],
    ['フォーム', 'form-app', 'clipboardList'],
    ['マップ', 'map', 'map'],
    ['カレンダー', 'calendar', 'calendar'],
  ]);

  let _folderToolbarClipboard = null;
  let _folderToolbarMenuCleanup = null;
  let _folderToolbarUpdateRaf = 0;
  let _folderToolbarWrappedBulkBar = false;
  let _folderToolbarSortCleanup = null;
  let _folderToolbarChoiceTrigger = null;

  function _folderToolbarIcon(name, size = 16) {
    return typeof lucide === 'function' ? lucide(name, size) : '';
  }

  function _folderToolbarCurrentPath() {
    return (typeof _folderPath !== 'undefined' && _folderPath) ? _folderPath : '';
  }

  function _folderToolbarIsLockedPath(path) {
    return !!(path && typeof isItemLocked === 'function' && isItemLocked(path));
  }

  function _folderToolbarIsLockedItem(item) {
    if (typeof _folderMenuItemLocked === 'function') return _folderMenuItemLocked(item);
    return _folderToolbarIsLockedPath(item?.path);
  }

  function _folderToolbarNormalizePath(path) {
    return String(path || '').replace(/\\/g, '/').replace(/\/+$/, '');
  }

  function _folderToolbarPathWithin(path, basePath) {
    const pathKey = _folderToolbarNormalizePath(path);
    const baseKey = _folderToolbarNormalizePath(basePath);
    return !!(pathKey && baseKey && (pathKey === baseKey || pathKey.startsWith(baseKey + '/')));
  }

  function _folderToolbarParentPath(path) {
    const normalized = _folderToolbarNormalizePath(path);
    const slash = normalized.lastIndexOf('/');
    return slash > 0 ? normalized.slice(0, slash) : '';
  }

  // フォルダツリーの最上位（ソースフォルダ・ワークスペース・ホーム）。これより上へは移動しない。
  function _folderToolbarTopFolderPaths() {
    const paths = [];
    document.querySelectorAll('#outliner-tree .tree-root-row').forEach(row => {
      const node = row.closest('.tree-node');
      const path = node?._nodeData?._isRoot ? node._nodeData.path : (node?.dataset?.path || '');
      if (path) paths.push(path);
    });
    if (typeof _homeFolderPath === 'string' && _homeFolderPath) paths.push(_homeFolderPath);
    return paths;
  }

  // 上のフォルダ: 区切り文字は元のパスの書式（\ と /）を保ったまま親を求める。
  function _folderToolbarUpTarget() {
    const current = _folderToolbarCurrentPath();
    if (!current) return null;
    const currentKey = _folderToolbarNormalizePath(current);
    const tops = _folderToolbarTopFolderPaths();
    // フォルダパネルの中で開いたフォルダ（ダブルクリック・Enter）は保存先の相対パスで持つ。最上位は絶対パスなので、
    // 相対パスのままでは「最上位の中」と判定できず、上のフォルダへが押せなかった（2026-11-22 M-014 フォルダパネル網羅テスト）。
    // 相対パスはツリーの同じフォルダの行（末尾が一致）を探し、その親の行を上のフォルダにする。
    if (!/^(?:[A-Za-z]:[\\/]|[\\/])/.test(String(current))) {
      const want = currentKey.toLowerCase();
      const node = Array.from(document.querySelectorAll('#outliner-tree .tree-node[data-path]')).find(candidate => {
        const key = _folderToolbarNormalizePath(candidate.dataset.path || '').toLowerCase();
        return key === want || key.endsWith('/' + want);
      });
      if (node) {
        if (node._nodeData?._isRoot || node.querySelector(':scope > .tree-root-row')) return null;
        const parent = node.parentElement?.closest?.('.tree-node');
        const parentPath = parent?._nodeData?.path || parent?.dataset?.path || '';
        if (parentPath) return { path: parentPath, name: parent?._nodeData?.name || parentPath.split(/[\\/]/).pop() || parentPath };
      }
      const cutRel = currentKey.lastIndexOf('/');
      if (cutRel > 0) {
        const path = currentKey.slice(0, cutRel);
        return { path, name: path.split('/').pop() || path };
      }
    }
    if (tops.some(top => _folderToolbarNormalizePath(top).toLowerCase() === currentKey.toLowerCase())) return null;
    const inside = tops.some(top => {
      const topKey = _folderToolbarNormalizePath(top);
      return topKey && currentKey !== topKey && _folderToolbarPathWithin(current, top);
    });
    if (!inside) return null;
    const trimmed = String(current).replace(/[\\/]+$/, '');
    const cut = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
    if (cut <= 0) return null;
    const path = trimmed.slice(0, cut);
    const node = typeof _findTreeNodeByPath === 'function' ? _findTreeNodeByPath(path) : null;
    const name = node?._nodeData?.name || path.split(/[\\/]/).pop() || path;
    return { path, name };
  }

  async function folderToolbarGoUp() {
    const target = _folderToolbarUpTarget();
    if (!target || typeof openFolder !== 'function') return false;
    await openFolder(target.name, target.path);
    return true;
  }

  function _folderToolbarSelectionItems() {
    try {
      if (typeof _normalizeFolderSelectionForVisibleItems === 'function') _normalizeFolderSelectionForVisibleItems();
    } catch {}
    let items = [];
    if (typeof _folderSelectedItems !== 'undefined' && Array.isArray(_folderSelectedItems) && _folderSelectedItems.length) {
      items = _folderSelectedItems;
    } else if (typeof _folderSelected !== 'undefined' && _folderSelected) {
      items = [_folderSelected];
    }
    // 大きなフォルダで多数を選んでいる時は、選択はパスごとに1件ずつ持っているので、重なりの確認を省く
    if (items.length > 2000 && globalThis.MeldexFolderLarge?.active?.()) return items;
    const byPath = new Map();
    items.forEach(item => {
      if (item?.path && !byPath.has(item.path)) byPath.set(item.path, item);
    });
    return Array.from(byPath.values());
  }

  function _folderToolbarOperationItems(items) {
    const byPath = new Map();
    (Array.isArray(items) ? items : []).forEach(item => {
      if (!item?.path || byPath.has(item.path)) return;
      byPath.set(item.path, item);
    });
    return Array.from(byPath.values());
  }

  function _folderToolbarTopLevelItems(items) {
    const withPath = (items || []).filter(item => item?.path);
    // 同じフォルダの直下どうしは親子にならない。大きなフォルダで全件を選んだ時に、下の確認（件数の2乗）を通さない。
    if (withPath.length > 200) {
      const parents = new Set(withPath.map(item => _folderToolbarParentPath(item.path)));
      if (parents.size === 1) return withPath;
    }
    const sorted = withPath
      .sort((a, b) => _folderToolbarNormalizePath(a.path).length - _folderToolbarNormalizePath(b.path).length);
    const topLevel = [];
    sorted.forEach(item => {
      if (!topLevel.some(parent => parent.path !== item.path && _folderToolbarPathWithin(item.path, parent.path))) {
        topLevel.push(item);
      }
    });
    return topLevel;
  }

  function _folderToolbarButtons() {
    return {
      add: document.getElementById('folder-toolbar-add'),
      copy: document.getElementById('folder-toolbar-copy'),
      cut: document.getElementById('folder-toolbar-cut'),
      paste: document.getElementById('folder-toolbar-paste'),
      delete: document.getElementById('folder-toolbar-delete'),
      up: document.getElementById('folder-toolbar-up'),
      undo: document.getElementById('folder-toolbar-undo'),
      redo: document.getElementById('folder-toolbar-redo'),
    };
  }

  // フォルダ操作はグローバルスコープの共通履歴を使う（meldexUndo/meldexRedoに委譲）
  function folderToolbarUndo() {
    if (typeof meldexUndo === 'function') return meldexUndo();
  }

  function folderToolbarRedo() {
    if (typeof meldexRedo === 'function') return meldexRedo();
  }

  function _folderToolbarScheduleUpdate() {
    if (_folderToolbarUpdateRaf) return;
    _folderToolbarUpdateRaf = requestAnimationFrame(() => {
      _folderToolbarUpdateRaf = 0;
      updateFolderToolbarActions();
    });
  }

  function _folderToolbarResolveRenamePath(path) {
    const resolved = window.GBOutlinerVirtualRender?.resolveUniquePath?.(path);
    if (resolved) return resolved;
    const wanted = _folderToolbarNormalizePath(path).toLowerCase();
    const matches = new Set();
    document.querySelectorAll('#outliner-tree .tree-node[data-path]').forEach(node => {
      const candidate = String(node.dataset.path || '').replace(/\\/g, '/').replace(/\/+$/, '');
      const key = candidate.toLowerCase();
      if (key === wanted || key.endsWith('/' + wanted)) matches.add(candidate);
    });
    return matches.size === 1 ? Array.from(matches)[0] : path;
  }

  function _folderToolbarStartTitleRename() {
    const title = document.getElementById('folder-title');
    const path = _folderToolbarCurrentPath();
    if (!title || !path || title.querySelector('input') || typeof startTreeLabelEdit !== 'function') return false;
    const renamePath = _folderToolbarResolveRenamePath(path);
    if (_folderToolbarIsLockedPath(path) || _folderToolbarIsLockedPath(renamePath)) {
      if (typeof showStatus === 'function') showStatus('編集ロック中のフォルダ名は変更できません', true);
      return false;
    }
    const normalizedPaths = new Set([path, renamePath].map(candidate => _folderToolbarNormalizePath(candidate).toLowerCase()));
    if (_folderToolbarTopFolderPaths().some(top => normalizedPaths.has(_folderToolbarNormalizePath(top).toLowerCase()))) return false;
    startTreeLabelEdit(title, {
      path: renamePath,
      pathAliases: renamePath !== path ? [path] : [],
      name: title.textContent || path.split(/[\\/]/).pop() || path,
      type: 'folder',
    }, _folderToolbarScheduleUpdate);
    return true;
  }

  function _folderToolbarBindEditableTitle() {
    const title = document.getElementById('folder-title');
    if (!title || title.dataset.inlineRenameBound === '1') return;
    title.dataset.inlineRenameBound = '1';
    title.tabIndex = 0;
    title.title = 'ダブルクリックまたはF2でフォルダ名を変更';
    title.dataset.gbTooltip = title.title;
    title.addEventListener('dblclick', event => {
      event.preventDefault();
      event.stopPropagation();
      _folderToolbarStartTitleRename();
    });
    title.addEventListener('keydown', event => {
      if (event.key !== 'F2' && event.key !== 'Enter') return;
      event.preventDefault();
      event.stopPropagation();
      _folderToolbarStartTitleRename();
    });
  }

  function updateFolderToolbarActions() {
    const buttons = _folderToolbarButtons();
    if (!buttons.add) return;
    const selection = _folderToolbarSelectionItems();
    const hasSelection = selection.length > 0;
    const currentPath = _folderToolbarCurrentPath();
    const targetLocked = _folderToolbarIsLockedPath(currentPath);
    const setDisabled = (button, disabled) => {
      if (button && button.disabled !== !!disabled) button.disabled = !!disabled;
    };
    setDisabled(buttons.copy, !hasSelection);
    // 多数（大きなフォルダのすべて選択など）を選んでいる時は、1件ずつのロックの確認を省く（操作の時に確認する）
    const manySelected = selection.length > 2000;
    setDisabled(buttons.cut, !hasSelection || (!manySelected && (selection.some(item => item?.linked) || selection.every(_folderToolbarIsLockedItem))));
    setDisabled(buttons.delete, !hasSelection || (!manySelected && selection.every(_folderToolbarIsLockedItem)));
    setDisabled(buttons.paste, (! _folderToolbarClipboard?.items?.length && !window.MeldexOsFileIntake?.isSupported?.()) || !currentPath || targetLocked);
    setDisabled(buttons.add, !currentPath || targetLocked);
    setDisabled(buttons.up, !_folderToolbarUpTarget());
    const expanded = document.querySelector('.folder-toolbar-create-menu') ? 'true' : 'false';
    if (buttons.add.getAttribute('aria-expanded') !== expanded) buttons.add.setAttribute('aria-expanded', expanded);
    // 取り消し・やり直しボタン展開: フォルダ操作はグローバルスコープの共通履歴を使うため、
    // ここでも一緒に有効/無効を更新する（data-undo-button/data-redo-button経由の一括更新と重複してもよい）
    if (typeof updateUndoRedoButtonStates === 'function') updateUndoRedoButtonStates();
  }

  // ツリーの指定したフォルダの子だけを差分で反映する。差分にできない時（仮想化・未読込以外の失敗）は全体を読み直す。
  async function _folderToolbarSyncTree(folders, fallback) {
    // ツリーの行は絶対パス、パネルの項目は相対パスで持つことがあるので、末尾の一致でツリーの行のパスへ直す
    // （ツリーに出ていないフォルダは直す必要が無い）。
    const toTreePath = path => {
      const want = _folderToolbarNormalizePath(path).toLowerCase();
      if (!want) return '';
      const node = Array.from(document.querySelectorAll('#outliner-tree .tree-node, #body-home .tree-node, #body-workspaces .tree-node')).find(candidate => {
        const key = _folderToolbarNormalizePath(candidate._nodeData?.path || candidate.dataset?.path || '').toLowerCase();
        return key === want || key.endsWith('/' + want);
      });
      return node ? (node._nodeData?.path || node.dataset.path) : '';
    };
    // 同じフォルダは1回だけ調べる（多数の項目の移動では、移動元のフォルダが件数ぶん渡される）
    const list = Array.from(new Set(Array.from(new Set((folders || []).filter(Boolean))).map(toTreePath).filter(Boolean)));
    if (!list.length) return true;
    if (typeof _outlinerSyncFolderChildren === 'function') {
      let ok = true;
      for (const path of list) {
        try { if (!(await _outlinerSyncFolderChildren(path))) ok = false; } catch { ok = false; }
      }
      if (ok) return true;
    }
    if (typeof fallback === 'function') return fallback();
    if (typeof refreshOutliner === 'function') return refreshOutliner({ force: true, reason: 'folder-toolbar' });
    return false;
  }

  async function _folderToolbarRefresh(preservePaths = [], options = {}) {
    const folderPath = _folderToolbarCurrentPath();
    // 他の面（メイン／サブパネル）が同じフォルダ・変わったフォルダを表示していれば、そちらも読み直す
    if (typeof _folderNotifyFoldersChanged === 'function') {
      _folderNotifyFoldersChanged([folderPath, ...(Array.isArray(options.treeFolders) ? options.treeFolders : [])].filter(Boolean));
    }
    const refreshTrees = () => {
      if (typeof refreshOutliner === 'function') return refreshOutliner({ force: true, reason: 'folder-toolbar' });
      const refreshJobs = [];
      if (typeof loadOutliner === 'function') refreshJobs.push(Promise.resolve().then(() => loadOutliner()));
      if (typeof renderHomeFolderTree === 'function') refreshJobs.push(Promise.resolve().then(() => renderHomeFolderTree()));
      return Promise.allSettled(refreshJobs);
    };
    // 変わったフォルダが分かっている時は、ツリーはそのフォルダの子だけを差分で反映し、パネルの読み直しと並行して行う
    // （全体の読み直しを待つと、パネルで作ったものがツリーに出るまで 0.3秒を超えていた: 2026-11-22 M-014）。
    if (Array.isArray(options.treeFolders) && options.treeFolders.length) {
      const treeSync = _folderToolbarSyncTree(options.treeFolders, refreshTrees);
      const folderOk = options.refreshFolder === false || !folderPath || typeof openFolder !== 'function'
        ? true
        : (await openFolder(folderPath.split(/[\\/]/).pop() || folderPath, folderPath, {
          ...(typeof _folderSurfaceOpts === 'function' ? _folderSurfaceOpts() : {}),
          skipShowView: true, skipSaveLastView: true, skipNavPush: true, skipHighlight: true, skipGlobalUi: true,
          ...(options.isCurrent ? { isLegacyLoadCurrent: options.isCurrent } : {}),
        })) !== false;
      if (options.refreshFolder !== false && folderOk && preservePaths.length && typeof renderFolderGrid === 'function' && !(options.isCurrent && !options.isCurrent())) {
        renderFolderGrid({ preserveSelectedPaths: preservePaths });
      }
      await treeSync;
      _folderToolbarScheduleUpdate();
      return folderOk;
    }
    // Creation is already durable. Display its folder contents immediately;
    // refreshing other roots must not hold the new item behind a full scan.
    const treeResults = !options.backgroundTrees ? await refreshTrees() : [];
    if (options.isCurrent && !options.isCurrent()) return false;
    let folderOk = true;
    if (options.refreshFolder !== false && folderPath && typeof openFolder === 'function') {
      const scroller = options.preserveScroll && typeof _folderGridEl === 'function' ? _folderGridEl() : null;
      const scroll = scroller ? [scroller.scrollLeft, scroller.scrollTop] : null;
      folderOk = await openFolder(folderPath.split(/[\\/]/).pop() || folderPath, folderPath, {
        ...(typeof _folderSurfaceOpts === 'function' ? _folderSurfaceOpts() : {}),
        skipShowView: true,
        skipSaveLastView: true,
        skipNavPush: true,
        skipHighlight: true,
        skipGlobalUi: true,
        ...(options.isCurrent ? { isLegacyLoadCurrent: options.isCurrent } : {}),
      }) !== false;
      if (options.isCurrent && !options.isCurrent()) return false;
      if (folderOk && preservePaths.length && typeof renderFolderGrid === 'function') {
        renderFolderGrid({ preserveSelectedPaths: preservePaths });
      }
      if (scroll) { scroller.scrollLeft = scroll[0]; scroller.scrollTop = scroll[1]; }
    }
    if (options.backgroundTrees) void refreshTrees();
    _folderToolbarScheduleUpdate();
    return folderOk && !(treeResults || []).some(result => result?.status === 'rejected');
  }

  function _folderToolbarCloseMenus(options = {}) {
    const cleanup = _folderToolbarMenuCleanup;
    _folderToolbarMenuCleanup = null;
    if (typeof cleanup === 'function') cleanup();
    document.querySelectorAll('.folder-toolbar-create-menu').forEach(menu => menu.remove());
    const trigger = document.getElementById('folder-toolbar-add');
    trigger?.setAttribute('aria-expanded', 'false');
    if (options.restoreFocus) trigger?.focus?.();
    updateFolderToolbarActions();
  }

  function _folderToolbarCreateMenuItem(label, type, icon, menu) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'gb-context-menu-item folder-toolbar-create-menu-item';
    item.setAttribute('role', 'menuitem');
    const iconEl = document.createElement('span');
    iconEl.className = 'menu-icon';
    iconEl.innerHTML = _folderToolbarIcon(icon, 14);
    const labelEl = document.createElement('span');
    labelEl.textContent = label;
    item.append(iconEl, labelEl);
    item.addEventListener('click', async () => {
      const requestedParent = _folderToolbarCurrentPath();
      const parent = typeof _outlinerCreateParentPath === 'function' ? _outlinerCreateParentPath(requestedParent, type) : requestedParent;
      _folderToolbarCloseMenus({ restoreFocus: true });
      if (!parent) return;
      if (_folderToolbarIsLockedPath(parent)) {
        showStatus('編集ロック中のフォルダには作成できません', true);
        return;
      }
      // 作成を取り消せるようにする（右クリックの新規作成と同じ。2026-11-21 ユーザー決定）。枠は確定の時点で取る。
      // 作成の記録は共通の履歴に積む（フォルダツリーの新規作成と同じ。開いている画面の履歴に紛れ込ませない）
      const historyScope = '';
      const reservation = typeof historyReserve === 'function' ? historyReserve('新規作成: 無題', historyScope) : null;
      try {
        const finishPreview = typeof _folderStageCreateTreePreview === 'function' ? _folderStageCreateTreePreview(parent, type, '無題') : () => {};
        let res;
        try { res = await apiPost('/outliner/add', { type, label: '無題', parent }); }
        finally { finishPreview(); }
        const node = res?.node || {};
        const name = node.name || node.label || '無題';
        if (node.path && typeof _folderApplySavedDropResults === 'function') {
          _folderApplySavedDropResults(parent, [{ item: { ...node, name } }], []);
        }
        // フォームは入力先のシートも一緒に作る。取り消しで両方をゴミ箱へ移す（フォルダツリーの新規作成と同じ）。
        const companions = Array.isArray(node.companion_paths) ? node.companion_paths.filter(Boolean) : [];
        const pushHistory = () => {
          if (!node.path) return null;
          if (companions.length && typeof _pushCreatedOutlinerItemsHistory === 'function') {
            return _pushCreatedOutlinerItemsHistory([
              { path: node.path, type: node.type || type, kind: (node.type || type) === 'folder' ? 'folder' : 'file' },
              ...companions.map(path => ({ path, type: 'database', kind: 'folder' })),
            ], '新規作成: ' + name, historyScope);
          }
          return typeof pushCreatedOutlinerItemHistory === 'function'
            ? pushCreatedOutlinerItemHistory({ path: node.path, type: node.type || type }, '新規作成: ' + name, {
              scope: historyScope, refresh: () => _folderToolbarRefresh([], { backgroundTrees: true }),
            })
            : null;
        };
        try {
          // 保存済みの行を一度描いてから一覧を照合する。ホームの再読込で、
          // 確定した行まで描画前に「読み込み中」へ置き換えない。
          const schedulePaint = typeof _folderScheduleRenderFrame === 'function' ? _folderScheduleRenderFrame : callback => setTimeout(callback, 0);
          await new Promise(resolve => schedulePaint(() => schedulePaint(() => setTimeout(resolve, 0))));
          await _folderToolbarRefresh(node.path ? [node.path] : [], { treeFolders: [parent] });
        } finally {
          // 一覧更新に失敗しても、実際に作れた項目を取り消せるようにする。
          if (reservation) reservation.capture(pushHistory); else pushHistory();
        }
        showStatus((node.type === 'folder' ? 'フォルダ' : 'ファイル') + 'を作成しました: ' + name);
      } catch (e) {
        reservation?.cancel();
        showStatus('作成に失敗しました: ' + (e?.message || e || ''), true);
      }
    });
    return item;
  }

  function showFolderToolbarAddMenu(event) {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    _folderToolbarCloseMenus();
    const parent = _folderToolbarCurrentPath();
    if (!parent) {
      showStatus('作成先フォルダを開いてください', true);
      return;
    }
    if (_folderToolbarIsLockedPath(parent)) {
      showStatus('編集ロック中のフォルダには作成できません', true);
      return;
    }
    const button = event?.currentTarget || document.getElementById('folder-toolbar-add');
    const menu = document.createElement('div');
    menu.className = 'gb-context-menu folder-toolbar-create-menu';
    menu.setAttribute('role', 'menu');
    menu.style.zIndex = '10000';
    const items = typeof _cloudPhase1CreateItems === 'function'
      ? _cloudPhase1CreateItems(CREATE_ITEMS.slice())
      : CREATE_ITEMS;
    items.forEach(([label, type, icon]) => {
      menu.appendChild(_folderToolbarCreateMenuItem(label, type, icon, menu));
    });
    document.body.appendChild(menu);
    const rect = button?.getBoundingClientRect?.() || { left: 12, top: 40, bottom: 40, right: 12 };
    if (typeof positionPopup === 'function') {
      positionPopup(menu, rect, { prefer: 'below', gap: 6 });
    } else {
      const z = typeof _getZoom === 'function' ? _getZoom() : 1;
      menu.style.left = (rect.left / z) + 'px';
      menu.style.top = ((rect.bottom + 6) / z) + 'px';
      if (typeof clampPopupToViewport === 'function') clampPopupToViewport(menu);
    }
    button?.setAttribute?.('aria-expanded', 'true');
    const closeFromOutside = (ev) => {
      if (!menu.contains(ev.target) && ev.target !== button) {
        _folderToolbarCloseMenus();
      }
    };
    const closeFromKeyboard = (ev) => {
      if (ev.key === 'Escape') {
        ev.preventDefault();
        _folderToolbarCloseMenus({ restoreFocus: true });
      }
    };
    menu.addEventListener('keydown', closeFromKeyboard, true);
    _folderToolbarMenuCleanup = () => {
      document.removeEventListener('pointerdown', closeFromOutside, true);
      menu.removeEventListener('keydown', closeFromKeyboard, true);
    };
    setTimeout(() => {
      document.addEventListener('pointerdown', closeFromOutside, true);
    }, 0);
    requestAnimationFrame(() => menu.querySelector('button')?.focus?.());
  }

  function folderToolbarCopyItems(sourceItems) {
    const items = _folderToolbarOperationItems(sourceItems);
    if (!items.length) return;
    _folderToolbarClipboard = {
      mode: 'copy',
      items: _folderToolbarTopLevelItems(items).map(item => ({
        path: item.path,
        name: item.name || item.path.split(/[\\/]/).pop() || '',
        type: item.type || 'file',
        linked: !!item.linked,
        file_id: item.file_id || '',
        link_folder_path: item.link_folder_path || '',
      })),
    };
    showStatus(_folderToolbarClipboard.items.length + ' 件をコピーしました');
    window.MeldexOsFileIntake?.markInternalCopy?.(_folderToolbarClipboard.items);
    updateFolderToolbarActions();
  }

  function folderToolbarCopySelection() {
    folderToolbarCopyItems(_folderToolbarSelectionItems());
  }

  function folderToolbarCutItems(sourceItems) {
    if (_folderToolbarOperationItems(sourceItems).some(item => item?.linked)) {
      showStatus('リンク表示中の項目は切り取りできません。リンク解除を使用してください', true);
      return;
    }
    const editable = _folderToolbarOperationItems(sourceItems)
      .filter(item => item?.path && !_folderToolbarIsLockedItem(item));
    if (!editable.length) {
      showStatus('編集ロック中の項目は切り取りできません', true);
      return;
    }
    _folderToolbarClipboard = {
      mode: 'cut',
      items: _folderToolbarTopLevelItems(editable).map(item => ({
        path: item.path,
        name: item.name || item.path.split(/[\\/]/).pop() || '',
        type: item.type || 'file',
        parent: _folderToolbarParentPath(item.path),
        linked: false,
        file_id: item.file_id || '',
        link_folder_path: item.link_folder_path || '',
      })),
    };
    showStatus(_folderToolbarClipboard.items.length + ' 件を切り取りました');
    window.MeldexOsFileIntake?.markInternalCopy?.(_folderToolbarClipboard.items);
    updateFolderToolbarActions();
  }

  function folderToolbarCutSelection() {
    folderToolbarCutItems(_folderToolbarSelectionItems());
  }

  function folderToolbarCanPasteTo(destFolder) {
    return !!(
      (_folderToolbarClipboard?.items?.length || window.MeldexOsFileIntake?.isSupported?.())
      && destFolder
      && !_folderToolbarIsLockedPath(destFolder)
    );
  }

  async function folderToolbarPasteToFolder(destFolder, options = {}) {
    const clip = _folderToolbarClipboard;
    if (!destFolder) return;
    if (window.MeldexOsFileIntake?.isSupported?.()) {
      try {
        if (await window.MeldexOsFileIntake.pasteIntoFolder(destFolder)) return;
      } catch (error) { showStatus(error.message || '貼り付けに失敗しました', true); return; }
    }
    if (!clip?.items?.length) { showStatus('コピーしたファイルがありません'); return; }
    // 貼り付け先の確認は、貼り付けの共通処理（gb-folder-link-actions.js）へ渡す前にここで行う。共通処理からは
    // このファイルの内側の確認（ロック・自分の中）が見えず、フォルダを自分の中へ貼り付けると保存先のエラーが
    // そのまま出ていた（2026-11-22 M-014 フォルダパネル網羅テスト）。
    if (_folderToolbarIsLockedPath(destFolder)) {
      showStatus('編集ロック中のフォルダには貼り付けできません', true);
      return;
    }
    // 片方が保存先の相対パス・もう片方が絶対パスのことがある（ツリーから開いたフォルダ）。末尾の一致でも同じフォルダとみなす。
    const sameOrInside = (dest, base) => {
      const d = _folderToolbarNormalizePath(dest).toLowerCase();
      const b = _folderToolbarNormalizePath(base).toLowerCase();
      if (!d || !b) return false;
      if (d === b || d.startsWith(b + '/')) return true;
      return d.endsWith('/' + b) || d.includes('/' + b + '/') || b.endsWith('/' + d);
    };
    const intoSelf = clip.items.filter(item => item?.type === 'folder' && item.path && sameOrInside(destFolder, item.path));
    if (intoSelf.length) {
      showStatus(`フォルダをそのフォルダ自身の中へは貼り付けできません（${intoSelf[0].name || intoSelf[0].path}）`, true);
      return;
    }
    if (typeof executeFolderPasteWithChoice === 'function') {
      await executeFolderPasteWithChoice(clip, destFolder, {
        ...options,
        onCutResult: failedItems => {
          // The clipboard belongs to this closure. Do not overwrite a newer
          // copy/cut made while the asynchronous paste was in progress.
          if (_folderToolbarClipboard === clip) {
            _folderToolbarClipboard = failedItems.length ? { mode: 'cut', items: failedItems } : null;
          }
        },
        // 貼り付けたフォルダの中身を先に描き、ツリーの読み直しは後で行う（全体の読み直しを待つと 1〜2 秒かかっていた）
        refresh: typeof options.refresh === 'function' ? options.refresh : (paths => _folderToolbarRefresh(paths || [], {
          treeFolders: [destFolder, ...(clip.mode === 'cut' ? clip.items.map(item => _folderToolbarParentPath(item.path)) : [])],
        })),
      });
      return;
    }
    if (_folderToolbarIsLockedPath(destFolder)) {
      showStatus('編集ロック中のフォルダには貼り付けできません', true);
      return;
    }
    const pastedPaths = [];
    const failed = [];
    let skipped = 0;
    let processed = 0;
    const movedItems = [];
    const progress = window.MeldexImportProgress?.beginOperation?.(
      clip.mode === 'cut' ? 'ファイルを移動中' : 'ファイルを貼り付け中',
      clip.items.length,
      { delayMs: 0, kind: clip.mode === 'cut' ? 'file-move' : 'file-copy' },
    );
    for (const item of clip.items) {
      try {
        if (item.type === 'folder' && _folderToolbarPathWithin(destFolder, item.path)) {
          failed.push(item);
          continue;
        }
        if (clip.mode === 'cut') {
          if (item.parent === _folderToolbarNormalizePath(destFolder)) {
            skipped++;
            continue;
          }
          if (_folderToolbarPathWithin(destFolder, item.path)) {
            failed.push(item);
            continue;
          }
          const oldPath = item.path;
          const res = await apiPost('/outliner/move', {
            path: item.path,
            dest_folder: destFolder,
            conflict_policy: 'error',
          });
          try {
            if (res?.new_path && typeof renameAppPathReferences === 'function') renameAppPathReferences(oldPath, res.new_path, { preserveMountedViews: true, label: res.new_name || item.name, fileId: res.file_id, type: item.type || 'page' });
          } catch (error) { console.warn('[Meldex] 移動後のパス更新に失敗しました', error); }
          try { if (typeof handleRelocateResponse === 'function') handleRelocateResponse(res); }
          catch (error) { console.warn('[Meldex] 移動後の表示更新に失敗しました', error); }
          const newPath = res?.new_path || item.path;
          pastedPaths.push(newPath);
          movedItems.push({ oldPath, newPath, currentPath: newPath, name: res?.new_name || item.name, type: item.type, fileId: res?.file_id || item.file_id });
        } else {
          const res = await apiPost('/outliner/save-as', { path: item.path, dest_folder: destFolder });
          pastedPaths.push(res?.new_path || '');
        }
      } catch {
        failed.push(item);
      } finally {
        processed += 1;
        window.MeldexImportProgress?.updateOperation?.(processed, null, progress);
      }
    }
    window.MeldexImportProgress?.finishOperation?.(progress, {
      failed: failed.length,
      summary: `${pastedPaths.length}件完了・${failed.length}件失敗`,
    });
    if (clip.mode === 'cut') {
      _folderToolbarClipboard = failed.length ? { mode: 'cut', items: failed } : null;
    }
    const refresh = typeof options.refresh === 'function' ? options.refresh : _folderToolbarRefresh;
    await refresh(pastedPaths.filter(Boolean));
    if (clip.mode === 'cut') {
      window.MeldexFileMoveHistory?.register?.(movedItems, {
        label: 'フォルダ: 切り取り貼り付け',
        detail: `${movedItems.length} 件 → ${destFolder}`,
        refresh,
      });
    }
    if (failed.length) {
      showStatus((pastedPaths.length || 0) + ' 件を貼り付け、' + failed.length + ' 件は失敗しました', true);
    } else if (pastedPaths.length) {
      showStatus(pastedPaths.length + ' 件を貼り付けました');
    } else if (skipped) {
      showStatus('同じフォルダへの移動のため、変更はありません');
    }
    updateFolderToolbarActions();
  }

  async function folderToolbarPasteSelection() {
    await folderToolbarPasteToFolder(_folderToolbarCurrentPath());
  }

  async function showFolderSelectionProperties(sourceItems, sourceEl) {
    const items = _folderToolbarOperationItems(sourceItems);
    if (!items.length) return;
    const fromTree = !!sourceEl?.closest?.('.tree-node');
    global.openRightPanelTab?.('information', sourceEl);
    // パネルの表示に伴う元タブの同期が「開いているフォルダ」を通知した後で、
    // メニューが指定した選択を渡す。待機中に利用者が選択を変えたら上書きしない。
    await global.GBPaneBridge?.whenSettled?.();
    const selected = fromTree && typeof treeSelection !== 'undefined'
      ? treeSelection.getNodeData() : (typeof _folderSelectedItems !== 'undefined' ? _folderSelectedItems : []);
    const paths = values => values.map(item => item.path).sort().join('\n');
    if (paths(selected) !== paths(items)) return;
    global.GBOptionTargetContext?.set(items.map(item => ({
      ...item, kind: item.type === 'folder' ? 'folder' : 'file',
    })), 'folder-menu');
  }

  function appendFolderOperationButtons(menu, options = {}) {
    if (!menu) return null;
    const row = document.createElement('div');
    row.className = 'folder-context-file-actions';
    row.setAttribute('role', 'toolbar');
    row.setAttribute('aria-label', 'ファイル操作');
    const actions = [
      ['copy', 'コピー', 'copy', options.onCopy, options.copyDisabled],
      ['cut', '切り取り', 'scissors', options.onCut, options.cutDisabled],
      ['paste', '貼り付け', 'clipboardPaste', options.onPaste, options.pasteDisabled],
      ['duplicate', '複製', 'copyPlus', options.onDuplicate, options.duplicateDisabled],
      ['delete', '削除', 'trash2', options.onDelete, options.deleteDisabled],
    ];
    actions.forEach(([name, label, icon, handler, disabled]) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'tb-icon-btn' + (name === 'delete' ? ' folder-toolbar-danger' : '');
      button.title = label;
      button.setAttribute('aria-label', label);
      button.dataset.contextFileAction = name;
      button.dataset.e2eId = `${options.e2ePrefix || 'folder-context'}-${name}`;
      button.innerHTML = _folderToolbarIcon(icon, 16);
      button.disabled = !!disabled || typeof handler !== 'function';
      if (!button.disabled) {
        button.addEventListener('click', async (event) => {
          event.preventDefault();
          event.stopPropagation();
          options.closeMenu?.();
          await handler();
        });
      }
      row.appendChild(button);
    });
    menu.appendChild(row);
    return row;
  }

  async function folderToolbarDeleteSelection() {
    const targets = _folderToolbarSelectionItems()
      .filter(item => item?.path && !_folderToolbarIsLockedItem(item));
    if (!targets.length) {
      showStatus('編集ロック中の項目は削除できません', true);
      return;
    }
    const topLevelTargets = _folderToolbarTopLevelItems(targets);
    // handleDisplayedFolderLinkDelete は gb-folder-link-batch.js 側の定義。読み込み漏れ等で
    // 未定義の場合にReferenceErrorで削除処理全体が止まらないよう、存在確認してから呼ぶ
    // （2026-08-19 実UI検査: 同スクリプトがMeldex.htmlに読み込まれておらず、削除ボタンが
    // クリックしても無反応のまま静かに失敗していた）。
    const linkedDelete = typeof handleDisplayedFolderLinkDelete === 'function'
      ? await handleDisplayedFolderLinkDelete(topLevelTargets, _folderToolbarCurrentPath(), { refresh: _folderToolbarRefresh })
      : { handled: false, result: null };
    if (linkedDelete.handled) return;
    const result = await deleteOutlinerItemsWithHistory(topLevelTargets, {
      label: topLevelTargets.length + ' 件を削除',
      refresh: async () => {
        await _folderToolbarRefresh();
      },
    });
    if (typeof _folderSelectedItems !== 'undefined') _folderSelectedItems = [];
    if (typeof _folderSelected !== 'undefined') _folderSelected = null;
    await _folderToolbarRefresh();
    const deletedCount = result.deletedCount || result.succeeded.length;
    if (result.failedCount > 0) showStatus(`${deletedCount} 件を削除、${result.failedCount} 件は失敗しました`, true);
    else if (deletedCount > 0) showStatus(deletedCount + ' 件を削除しました（Undoで戻せます）');
    else showStatus('削除対象が見つからなかったため、表示を更新しました', true);
  }

  function _folderToolbarBindButton(button, iconName, handler) {
    if (!button || button.dataset.folderToolbarBound === '1') return;
    button.dataset.folderToolbarBound = '1';
    button.innerHTML = _folderToolbarIcon(iconName, 16);
    button.addEventListener('click', function(event) {
      const report = error => _folderReportFailure(button.title || 'フォルダ操作', error);
      try {
        return Promise.resolve(handler.call(this, event)).catch(report);
      } catch (error) {
        report(error);
      }
    });
  }

  function _folderToolbarWrapBulkBarUpdate() {
    if (_folderToolbarWrappedBulkBar || typeof global._updateFolderBulkBar !== 'function') return;
    const original = global._updateFolderBulkBar;
    global._updateFolderBulkBar = function(...args) {
      const result = original.apply(this, args);
      _folderToolbarScheduleUpdate();
      return result;
    };
    _folderToolbarWrappedBulkBar = true;
  }

  function _folderToolbarCloseExtraMenu() {
    _folderToolbarSortCleanup?.();
    _folderToolbarSortCleanup = null;
    document.querySelectorAll('.folder-toolbar-sort-menu, .folder-toolbar-layout-menu').forEach(menu => menu.remove());
    _folderToolbarChoiceTrigger?.setAttribute('aria-expanded', 'false');
    _folderToolbarChoiceTrigger = null;
  }

  function _folderToolbarMenuItem(menu, label, icon, action, active) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'gb-context-menu-item tree-ctx-item';
    button.setAttribute('role', 'menuitemradio');
    button.setAttribute('aria-checked', active ? 'true' : 'false');
    button.innerHTML = _folderToolbarIcon(icon || 'arrowUpDown', 14)
      + '<span>' + (typeof esc === 'function' ? esc(label) : label) + '</span>'
      + (active ? '<span class="folder-toolbar-menu-check">' + _folderToolbarIcon('check', 14) + '</span>' : '');
    button.addEventListener('click', async event => {
      event.preventDefault();
      event.stopPropagation();
      _folderToolbarCloseExtraMenu();
      await action();
    });
    menu.appendChild(button);
  }

  function showFolderToolbarSortMenu(event) {
    event.preventDefault();
    event.stopPropagation();
    _folderToolbarCloseExtraMenu();
    const trigger = event.currentTarget;
    const folderPath = _folderToolbarCurrentPath();
    const menu = document.createElement('div');
    menu.className = 'gb-context-menu folder-toolbar-sort-menu';
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', 'フォルダの並び替え');
    const current = typeof getSortForFolder === 'function' ? getSortForFolder(folderPath) : { sort: 'name', order: 'asc' };
    const options = typeof getFolderSortOptions === 'function' ? getFolderSortOptions() : [
      { label: 'マニュアル', sort: 'manual', order: 'asc' },
      { label: '名前 ↑', sort: 'name', order: 'asc' },
      { label: '名前 ↓', sort: 'name', order: 'desc' },
    ];
    options.forEach(option => {
      const active = current.sort === option.sort && current.order === option.order;
      _folderToolbarMenuItem(menu, option.label, option.sort === 'manual' ? 'gripVertical' : 'arrowUpDown', async () => {
        const historyKeys = [
          typeof SORT_SETTINGS_KEY !== 'undefined' ? SORT_SETTINGS_KEY : 'outliner-sort',
          typeof MANUAL_ORDER_KEY !== 'undefined' ? MANUAL_ORDER_KEY : 'outliner-manual-order',
        ];
        const before = typeof captureOutlinerSettingsHistory === 'function' ? captureOutlinerSettingsHistory(historyKeys) : null;
        setSortSetting(folderPath, option.sort, option.order);
        if (typeof pushOutlinerSettingsHistory === 'function') {
          pushOutlinerSettingsHistory('フォルダ: 並び替え設定', before, option.label, historyKeys);
        }
        const selectedPaths = typeof _folderSelectedItems !== 'undefined'
          ? _folderSelectedItems.map(item => item?.path).filter(Boolean) : [];
        if (typeof renderFolderGrid === 'function') renderFolderGrid({ preserveSelectedPaths: selectedPaths, resetScrollTop: true });
        if (typeof loadOutliner === 'function') await loadOutliner({ force: true, reason: 'folder-toolbar-sort' });
      }, active);
    });
    // 大きなフォルダの表示では、サーバーで並べ替えられる順（名前・更新日時・作成日時）だけ選べる
    globalThis.MeldexFolderLarge?.adjustSortMenu?.(menu, options);
    _folderToolbarMountChoiceMenu(menu, trigger);
  }

  function _folderToolbarMountChoiceMenu(menu, trigger) {
    _folderToolbarChoiceTrigger = trigger;
    menu._requestClose = _folderToolbarCloseExtraMenu;
    trigger.setAttribute('aria-expanded', 'true');
    window.attachMeldexDropdownCloseButton?.(menu, {trigger, close: _folderToolbarCloseExtraMenu});
    document.body.appendChild(menu);
    const rect = trigger.getBoundingClientRect();
    if (typeof positionPopup === 'function') positionPopup(menu, rect, { prefer: 'below', gap: 4 });
    else {
      menu.style.left = rect.left + 'px';
      menu.style.top = rect.bottom + 4 + 'px';
    }
    const closer = pointerEvent => {
      if (menu.contains(pointerEvent.target) || trigger.contains(pointerEvent.target)) return;
      _folderToolbarCloseExtraMenu();
    };
    const keyboard = keyEvent => {
      if (menu.contains(document.activeElement) && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(keyEvent.key)) {
        keyEvent.preventDefault();
        keyEvent.stopPropagation();
        const items = Array.from(menu.querySelectorAll('[role="menuitemradio"]:not(:disabled)'));
        const index = items.indexOf(document.activeElement);
        const next = keyEvent.key === 'Home' ? 0 : keyEvent.key === 'End' ? items.length - 1
          : (index + (keyEvent.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
        items[next]?.focus();
        return;
      }
      if (keyEvent.key !== 'Escape') return;
      keyEvent.preventDefault();
      keyEvent.stopPropagation();
      _folderToolbarCloseExtraMenu();
      trigger.focus?.();
    };
    const timer = setTimeout(() => document.addEventListener('pointerdown', closer, true), 0);
    document.addEventListener('keydown', keyboard, true);
    menu.querySelector('[aria-checked="true"]')?.focus();
    _folderToolbarSortCleanup = () => {
      clearTimeout(timer);
      document.removeEventListener('pointerdown', closer, true);
      document.removeEventListener('keydown', keyboard, true);
    };
  }

  function syncFolderLayoutControl() {
    const select = document.getElementById('folder-layout-select');
    const trigger = document.getElementById('folder-layout-menu-btn');
    const label = trigger?.querySelector('.folder-layout-label');
    if (label && select) {
      label.textContent = select.selectedOptions[0]?.textContent || '表示形式';
      trigger.setAttribute('aria-label', '表示形式: ' + label.textContent);
    }
  }

  function showFolderToolbarLayoutMenu(event) {
    event.preventDefault();
    event.stopPropagation();
    const trigger = event.currentTarget;
    const wasOpen = !!document.querySelector('.folder-toolbar-layout-menu');
    _folderToolbarCloseExtraMenu();
    if (wasOpen) return;
    const select = document.getElementById('folder-layout-select');
    const menu = document.createElement('div');
    menu.className = 'gb-context-menu folder-toolbar-layout-menu';
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', 'フォルダの表示形式');
    const icons = typeof FOLDER_LAYOUT_ICONS === 'object' ? FOLDER_LAYOUT_ICONS
      : {grid:'layoutGrid', waterfall:'layoutDashboard', hflow:'columns', list:'list', 'list-small':'listCompact'};
    Array.from(select.options).forEach(option => {
      _folderToolbarMenuItem(menu, option.textContent, icons[option.value], () => {
        setFolderLayout(option.value);
        syncFolderLayoutControl();
        trigger.focus({preventScroll:true});
      }, select.value === option.value);
    });
    _folderToolbarMountChoiceMenu(menu, trigger);
  }

  async function toggleFolderSubfolderContents() {
    const enabled = !(typeof isFolderSubfolderContentsEnabled === 'function' && isFolderSubfolderContentsEnabled());
    if (typeof setFolderSubfolderContentsEnabled === 'function') setFolderSubfolderContentsEnabled(enabled);
    syncFolderSubfolderContentsButtons();
    const folderPath = _folderToolbarCurrentPath();
    if (folderPath && typeof openFolder === 'function') {
      const label = document.getElementById('folder-title')?.textContent || folderPath;
      await openFolder(label, folderPath, {
        ...(typeof _folderSurfaceOpts === 'function' ? _folderSurfaceOpts() : {}),
        silent: true,
        skipShowView: true,
        skipNavPush: true,
        skipSaveLastView: true,
        skipHighlight: true,
        skipGlobalUi: true,
      });
    }
  }

  function syncFolderSubfolderContentsButtons() {
    const enabled = typeof isFolderSubfolderContentsEnabled === 'function' && isFolderSubfolderContentsEnabled();
    document.querySelectorAll('[data-folder-subfolder-contents]').forEach(button => {
      button.setAttribute('aria-pressed', enabled ? 'true' : 'false');
      button.classList.toggle('is-active', enabled);
      button.title = enabled ? 'サブフォルダの内容を表示中' : 'サブフォルダの内容を表示';
      button.setAttribute('aria-label', button.title);
    });
  }

  function _folderToolbarInstallExtraControls() {
    const layout = document.getElementById('folder-layout-select');
    if (layout && !document.getElementById('folder-toolbar-sort')) {
      const sortButton = document.createElement('button');
      sortButton.id = 'folder-toolbar-sort';
      sortButton.type = 'button';
      sortButton.className = 'tb-icon-btn';
      sortButton.title = '並び替え';
      sortButton.setAttribute('aria-label', 'フォルダを並び替え');
      sortButton.setAttribute('aria-haspopup', 'menu');
      sortButton.dataset.e2eId = 'folder-toolbar-sort';
      sortButton.innerHTML = _folderToolbarIcon('arrowUpDown', 16);
      sortButton.addEventListener('click', showFolderToolbarSortMenu);
      layout.parentElement.insertBefore(sortButton, layout);
    }
    if (layout && !document.getElementById('folder-layout-menu-btn')) {
      const trigger = document.createElement('button');
      trigger.id = 'folder-layout-menu-btn';
      trigger.type = 'button';
      trigger.className = 'gb-select folder-layout-trigger';
      trigger.title = '表示形式';
      trigger.setAttribute('aria-label', '表示形式');
      trigger.setAttribute('aria-haspopup', 'menu');
      trigger.setAttribute('aria-expanded', 'false');
      trigger.innerHTML = '<span class="folder-layout-label"></span>' + _folderToolbarIcon('chevronDown', 14);
      trigger.addEventListener('click', showFolderToolbarLayoutMenu);
      layout.insertAdjacentElement('afterend', trigger);
      layout.classList.add('gb-folder-layout-native');
      layout.tabIndex = -1;
      layout.setAttribute('aria-hidden', 'true');
      layout.addEventListener('change', syncFolderLayoutControl);
      syncFolderLayoutControl();
    }
    syncFolderSubfolderContentsButtons();
  }

  function initFolderToolbarActions() {
    const buttons = _folderToolbarButtons();
    if (!buttons.add) return;
    _folderToolbarBindButton(buttons.up, 'folderUp', folderToolbarGoUp);
    _folderToolbarBindButton(buttons.add, 'plus', showFolderToolbarAddMenu);
    _folderToolbarBindButton(buttons.copy, 'copy', folderToolbarCopySelection);
    _folderToolbarBindButton(buttons.cut, 'scissors', folderToolbarCutSelection);
    _folderToolbarBindButton(buttons.paste, 'clipboardPaste', folderToolbarPasteSelection);
    _folderToolbarBindButton(buttons.delete, 'trash2', folderToolbarDeleteSelection);
    _folderToolbarBindButton(buttons.undo, 'undo2', folderToolbarUndo);
    _folderToolbarBindButton(buttons.redo, 'redo2', folderToolbarRedo);
    _folderToolbarInstallExtraControls();
    _folderToolbarBindEditableTitle();
    _folderToolbarWrapBulkBarUpdate();
    const grid = document.getElementById('folder-grid');
    if (grid && grid.dataset.folderToolbarSelectionBound !== '1') {
      grid.dataset.folderToolbarSelectionBound = '1';
      grid.addEventListener('click', _folderToolbarScheduleUpdate);
      grid.addEventListener('change', _folderToolbarScheduleUpdate);
      grid.addEventListener('contextmenu', _folderToolbarScheduleUpdate);
      grid.addEventListener('keyup', _folderToolbarScheduleUpdate);
    }
    updateFolderToolbarActions();
  }

  global.initFolderToolbarActions = initFolderToolbarActions;
  global.updateFolderToolbarActions = updateFolderToolbarActions;
  global.refreshFolderAfterExternalChange = (options = {}) => {
    const path = _folderToolbarCurrentPath();
    const scroller = typeof _folderGridEl === 'function' ? _folderGridEl() : null;
    const visible = !!path && !!scroller?.getClientRects().length;
    const changedPaths = Array.isArray(options.changedPaths) ? options.changedPaths.filter(p => typeof p === 'string' && p) : null;
    const changedFolders = Array.isArray(options.changedFolders) ? options.changedFolders.filter(p => typeof p === 'string' && p) : [];
    if (changedPaths?.length || changedFolders.length) {
      const parents = [...new Set([...(changedPaths || []).map(_folderToolbarParentPath),
        ...changedFolders, ...changedFolders.map(_folderToolbarParentPath)])];
      const sameFolder = parents.some(parent => {
        const current = _folderToolbarNormalizePath(path), changed = _folderToolbarNormalizePath(parent);
        return current === changed || current.endsWith('/' + changed) || changed.endsWith('/' + current);
      });
      return _folderToolbarRefresh(_folderToolbarSelectionItems().map(item => item.path), {
        treeFolders: parents, refreshFolder: visible && sameFolder,
        preserveScroll: true, isCurrent: options.isCurrent,
      });
    }
    return _folderToolbarRefresh(_folderToolbarSelectionItems().map(item => item.path), {
      preserveScroll: true,
      refreshFolder: visible,
      isCurrent: () => _folderToolbarCurrentPath() === path
        && (!visible || _folderGridEl() === scroller && !!scroller.getClientRects().length)
        && (!options.isCurrent || options.isCurrent()),
    });
  };
  global.showFolderToolbarAddMenu = showFolderToolbarAddMenu;
  global.folderToolbarGoUp = folderToolbarGoUp;
  global.folderToolbarSyncTree = _folderToolbarSyncTree;
  global.folderToolbarCopySelection = folderToolbarCopySelection;
  global.folderToolbarCutSelection = folderToolbarCutSelection;
  global.folderToolbarPasteSelection = folderToolbarPasteSelection;
  global.folderToolbarDeleteSelection = folderToolbarDeleteSelection;
  global.folderToolbarCopyItems = folderToolbarCopyItems;
  global.folderToolbarCutItems = folderToolbarCutItems;
  global.folderToolbarCanPasteTo = folderToolbarCanPasteTo;
  global.folderToolbarPasteToFolder = folderToolbarPasteToFolder;
  global.appendFolderOperationButtons = appendFolderOperationButtons;
  global.showFolderSelectionProperties = showFolderSelectionProperties;
  global.showFolderToolbarSortMenu = showFolderToolbarSortMenu;
  global.syncFolderLayoutControl = syncFolderLayoutControl;
  global.toggleFolderSubfolderContents = toggleFolderSubfolderContents;
  global.syncFolderSubfolderContentsButtons = syncFolderSubfolderContentsButtons;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initFolderToolbarActions, { once: true });
  } else {
    initFolderToolbarActions();
  }
})(window);
