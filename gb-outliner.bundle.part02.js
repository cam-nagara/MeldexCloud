  if (!normalized) return false;
  return OUTLINER_CONFLICT_PATHS.has(normalized)
    || _isOutlinerDropboxConflictName(_outlinerConflictBasename(normalized))
    || !!window.MeldexSaveSafety?.isConflictPath?.(normalized);
}

function _syncOutlinerConflictBadgeToNode(nodeEl) {
  if (!nodeEl || !nodeEl._nodeData) return;
  const row = nodeEl.querySelector(':scope > .tree-node-row');
  const label = row?.querySelector('.tree-label');
  if (!row || !label) return;
  row.querySelector('.tree-conflict-badge')?.remove();
  row.classList.remove('has-conflict');
  if (!_isOutlinerConflictPath(nodeEl._nodeData.path)) return;
  row.classList.add('has-conflict');
  const badge = document.createElement('span');
  badge.className = 'tree-conflict-badge';
  badge.innerHTML = lucide('triangleAlert', 12);
  badge.title = '競合が発生しています。比較ビューまたは競合解消ダイアログで確認してください';
  badge.dataset.gbTooltip = badge.title;
  label.insertAdjacentElement('afterend', badge);
}

function refreshVisibleOutlinerConflictState() {
  document.querySelectorAll('#outliner-tree .tree-node, #body-home .tree-node, #body-workspaces .tree-node')
    .forEach(node => _syncOutlinerConflictBadgeToNode(node));
}

window.addEventListener('meldex-save-conflicts-change', () => {
  refreshVisibleOutlinerConflictState();
});

function _createOutlinerAddHoverButton(nodeEl, item) {
  const addBtn = document.createElement('span');
  addBtn.className = 'tree-hover-btn';
  addBtn.innerHTML = lucide('plus', 14);
  addBtn.title = '追加';
  addBtn.dataset.gbTooltip = 'このフォルダ内に項目を追加します';
  addBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const r = addBtn.getBoundingClientRect();
    const z = parseFloat(document.documentElement.style.zoom) || 1;
    _showTreeAddMenu(r.left / z, r.bottom / z, nodeEl, item);
  });
  return addBtn;
}

function _syncOutlinerAddHoverButton(nodeEl, item, locked) {
  const row = nodeEl?.querySelector?.(':scope > .tree-node-row');
  const hoverBtns = row?.querySelector?.('.tree-hover-btns');
  if (!hoverBtns || item?.type === 'entity') return;
  const addButton = hoverBtns.querySelector('.tree-hover-btn[title="追加"]');
  if (locked) {
    addButton?.remove();
    return;
  }
  if (!addButton) hoverBtns.appendChild(_createOutlinerAddHoverButton(nodeEl, item));
}

function refreshVisibleOutlinerLockState() {
  document.querySelectorAll('#outliner-tree .tree-node, #body-home .tree-node, #body-workspaces .tree-node')
    .forEach(node => _applyOutlinerLockStateToNode(node));
}

let _fileLockOutlinerRefreshPending = false;
function _scheduleFileLockRefreshForOutliner() {
  if (_fileLockOutlinerRefreshPending || typeof _ensureLocksLoaded !== 'function') return;
  _fileLockOutlinerRefreshPending = true;
  Promise.resolve(_ensureLocksLoaded({ force: !_fileLockLoaded }))
    .then(() => {
      refreshVisibleOutlinerLockState();
      if (typeof refreshVisibleFolderLockState === 'function') refreshVisibleFolderLockState();
    })
    .catch(() => {})
    .finally(() => { _fileLockOutlinerRefreshPending = false; });
}

const NODE_COLORS_KEY = 'outliner-node-colors';
function getNodeColors() {
  try { return JSON.parse(localStorage.getItem(NODE_COLORS_KEY)) || {}; } catch { return {}; }
}
function getNodeColor(path) {
  const colors = getNodeColors();
  const fid = _pathToFileId(path);
  return (fid && colors[fid]) || colors[path] || '';
}
function setNodeColor(path, color) {
  const colors = getNodeColors();
  const key = _pathToFileId(path) || path;
  if (color) colors[key] = color; else delete colors[key];
  try { localStorage.setItem(NODE_COLORS_KEY, JSON.stringify(colors)); } catch {}
}

const OUTLINER_SETTINGS_HISTORY_KEYS = [
  SORT_SETTINGS_KEY,
  MANUAL_ORDER_KEY,
  LOCKED_ITEMS_KEY,
  NODE_COLORS_KEY,
  'meldex-favorites',
];

function refreshOutlinerSettingsAfterHistory() {
  if (typeof refreshOutliner === 'function') {
    refreshOutliner();
    return;
  }
  if (typeof loadOutliner === 'function') loadOutliner();
  if (typeof renderFavorites === 'function') renderFavorites();
  if (typeof renderHomeFolderTree === 'function') renderHomeFolderTree({ reason: 'settings-history' });
  if (typeof renderWorkspaceSidebar === 'function') renderWorkspaceSidebar();
}

async function refreshOutliner(options) {
  const opts = options && typeof options === 'object' ? options : {};
  const refreshJobs = [];
  if (typeof loadOutliner === 'function') refreshJobs.push(Promise.resolve().then(() => loadOutliner(opts)));
  if (typeof renderFavorites === 'function') refreshJobs.push(Promise.resolve().then(() => renderFavorites()));
  if (typeof renderHomeFolderTree === 'function') refreshJobs.push(Promise.resolve().then(() => renderHomeFolderTree({ reason: opts.reason || 'refresh-outliner' })));
  if (typeof renderWorkspaceSidebar === 'function') refreshJobs.push(Promise.resolve().then(() => renderWorkspaceSidebar()));
  return Promise.allSettled(refreshJobs);
}

async function refreshOutlinerFromButton(event) {
  event?.preventDefault?.();
  event?.stopPropagation?.();
  const btn = event?.currentTarget?.closest?.('.sidebar-section-btn, .cloud-mobile-tree-refresh')
    || event?.target?.closest?.('.sidebar-section-btn, .cloud-mobile-tree-refresh')
    || null;
  if (btn?.disabled) return;
  if (btn) {
    btn.disabled = true;
    btn.setAttribute('aria-busy', 'true');
  }
  // 更新前の展開状態を維持するため、自動展開の制限とカウンタを初期化する
  _outlinerForceExpansionMode = true;
  _outlinerAutoExpandScheduled = 0;
  _outlinerAutoExpandOverflowNotified = false;
  try {
    const results = await refreshOutliner({ force: true, reason: 'manual-refresh' });
    const failedCount = (results || []).filter(result => result?.status === 'rejected').length;
    if (typeof showStatus === 'function') {
      showStatus(failedCount ? 'フォルダツリーの一部更新に失敗しました' : 'フォルダツリーを更新しました', !!failedCount);
    }
  } catch (error) {
    if (typeof showStatus === 'function') showStatus('フォルダツリーの更新に失敗しました', true);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.removeAttribute('aria-busy');
    }
    if (!_outlinerAutoExpandQueue.length && !_outlinerAutoExpandRunning) {
      _outlinerForceExpansionMode = false;
    }
  }
}

function captureOutlinerSettingsHistory(keys) {
  const targetKeys = keys && keys.length ? keys : OUTLINER_SETTINGS_HISTORY_KEYS;
  if (typeof captureLocalStorageSettings === 'function') {
    return captureLocalStorageSettings(targetKeys);
  }
  const storage = {};
  targetKeys.forEach(key => {
    try { storage[key] = localStorage.getItem(key); }
    catch { storage[key] = null; }
  });
  return { keys: targetKeys.slice(), storage };
}

function pushOutlinerSettingsHistory(label, beforeSnapshot, detail, keys) {
  if (typeof pushLocalStorageSettingsHistory !== 'function') return false;
  const afterSnapshot = captureOutlinerSettingsHistory(keys);
  return pushLocalStorageSettingsHistory(
    label || 'フォルダツリー: 設定変更',
    beforeSnapshot,
    afterSnapshot,
    detail || '',
    refreshOutlinerSettingsAfterHistory
  );
}

function applyNodeColor(row, color) {
  const label = row.querySelector('.tree-label');
  const icon = row.querySelector('.tree-icon');
  if (color) {
    if (label) label.style.color = color;
    if (icon) icon.style.color = color;
  } else {
    if (label) label.style.color = '';
    if (icon) icon.style.color = '';
  }
}

function createTreeNodeFromBrowse(item, rootPath) {
  // item: {name, type: "folder"|"database"|"page"|"scenario", path}
  const div = document.createElement('div');
  div.className = 'tree-node';
  div._nodeData = item;
  if (item.path) div.dataset.path = item.path;
  if (item.sourceId) div.dataset.sourceId = item.sourceId;
  if (item.rootKind) div.dataset.rootKind = item.rootKind;
  if (item.workspaceId) div.dataset.workspaceId = item.workspaceId;
  if (item.file_id) _registerFileId(item.path, item.file_id);

  const row = document.createElement('div');
  row.className = 'tree-node-row';
  row.dataset.itemType = item.type || '';
  if (item.sourceId) row.dataset.sourceId = item.sourceId;
  if (item.rootKind) row.dataset.rootKind = item.rootKind;
  if (item.workspaceId) row.dataset.workspaceId = item.workspaceId;
  const itemLocked = item.path && isItemLocked(item.path);
  row.draggable = !itemLocked && !item._isRoot && item.type !== 'entity';
  row.tabIndex = -1;

  const isFolder = item.type === 'folder';
  const isDB = item.type === 'database';
  const isUnavailableRoot = item.needsMapping === true;
  const isExpandable = !isUnavailableRoot && (isFolder || isDB);

  // Toggle arrow
  const toggle = document.createElement('span');
  toggle.className = 'tree-toggle';
  if (isExpandable) {
    toggle.innerHTML = lucide('chevronRight', 16);
    toggle.dataset.expanded = 'false';
  }
  row.appendChild(toggle);

  // Icon（ルートフォルダにはアイコンを表示しない）
  if (!item._isRoot) {
    const icon = document.createElement('span');
    icon.className = 'tree-icon';
    icon.innerHTML = _outlinerIconMarkup(item, 18);
    // リンクファイルマーク
    if (item.linked) {
      icon.innerHTML += '<span style="position:relative;top:-4px;left:-2px;">' + lucide('externalLink', 8) + '</span>';
    }
    row.appendChild(icon);
  }

  // Label
  const label = document.createElement('span');
  label.className = 'tree-label';
  label.textContent = item.name || '';
  if (item._isRoot) label.style.fontWeight = 'bold';
  row.appendChild(label);
  if (isUnavailableRoot) {
    const notice = document.createElement('span');
    notice.className = 'tree-source-mapping-badge';
    notice.textContent = '場所を確認';
    notice.title = 'このPCでDropbox同期フォルダの場所を確認してください';
    notice.style.cssText = 'margin-left:6px;color:var(--fg2);font-size:11px;white-space:nowrap;';
    row.title = notice.title;
    row.dataset.gbTooltip = notice.title;
    row.appendChild(notice);
  }
  if (itemLocked) {
    const lockBadge = document.createElement('span');
    lockBadge.className = 'tree-lock-badge';
    lockBadge.innerHTML = lucide('lock', 12);
    const lockReason = typeof getItemLockReason === 'function' ? getItemLockReason(item.path) : '';
    lockBadge.title = isSystemLockedItem(item.path) ? 'システム保護中です' : ('編集ロック中' + (lockReason ? ': ' + lockReason : ''));
    lockBadge.dataset.gbTooltip = lockBadge.title;
    lockBadge.style.cssText = 'display:inline-flex;align-items:center;opacity:0.65;margin-left:4px;flex-shrink:0;';
    row.title = lockBadge.title;
    row.dataset.gbTooltip = lockBadge.title;
    row.appendChild(lockBadge);
  }
  // ホバーアクションボタン（Notion風: メニュー + 追加）
  if (item.type !== 'entity') {
    const hoverBtns = document.createElement('span');
    hoverBtns.className = 'tree-hover-btns';
    hoverBtns.draggable = false;
    hoverBtns.addEventListener('dragstart', (e) => e.preventDefault());
    // メニューボタン
    const menuBtn = document.createElement('span');
    menuBtn.className = 'tree-hover-btn';
    menuBtn.innerHTML = lucide('ellipsis', 14);
    menuBtn.title = 'メニュー';
    menuBtn.dataset.gbTooltip = 'この項目のメニューを開きます';
    menuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!treeSelection.has(div)) { treeSelection.clear(); treeSelection.add(div); treeSelection.lastClicked = div; }
      const r = menuBtn.getBoundingClientRect();
      const z = parseFloat(document.documentElement.style.zoom) || 1;
      showTreeContextMenu(r.left / z, r.bottom / z, div, item, label);
    });
    hoverBtns.appendChild(menuBtn);
    // 追加ボタン
    if (!itemLocked) {
      hoverBtns.appendChild(_createOutlinerAddHoverButton(div, item));
    }
    row.appendChild(hoverBtns);
  }

  // ルートフォルダの背景色
  if (item._isRoot) row.classList.add('tree-root-row');

  div.appendChild(row);
  _syncOutlinerConflictBadgeToNode(div);

  // Children container (lazy-loaded)
  const childrenDiv = document.createElement('div');
  childrenDiv.className = 'tree-children collapsed';
  childrenDiv.dataset.loaded = 'false';
  div.appendChild(childrenDiv);

  // 保存済み色を適用
  const savedColor = getNodeColor(item.path);
  if (savedColor) applyNodeColor(row, savedColor);
  // ロック状態を反映
  if (itemLocked) {
    label.style.fontStyle = 'italic';
  }

  // Toggle click — lazy load children
  toggle.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (!isExpandable) return;
    const expanded = toggle.dataset.expanded === 'true';
    if (!expanded) {
      toggle.classList.add('expanded');
      toggle.dataset.expanded = 'true';
      // 作品フォルダ動的アイコン切替（icon-implementation-plan §D）
      if (isFolder) {
        const iconEl = row.querySelector('.tree-icon');
        if (iconEl) {
          const isWork = item.path === getWorkFolder();
          iconEl.innerHTML = lucide(isWork ? 'folderOpenDot' : 'folderOpen', 18);
          if (item.linked) iconEl.innerHTML += '<span style="position:relative;top:-4px;left:-2px;">' + lucide('externalLink', 8) + '</span>';
        }
      }
      // 展開前に既存子ノードにフィルタを適用（チラつき防止）
      childrenDiv.querySelectorAll(':scope > .tree-node').forEach(cn => {
        const d = cn._nodeData;
        if (!d || d._isRoot || d.type === 'folder') return;
        if (d.type === 'database') { cn.style.display = _showDatabaseByGlobalFilter() ? '' : 'none'; return; }
        if (d.type === 'entity') { cn.style.display = _showEntityByGlobalFilter() ? '' : 'none'; return; }
        cn.style.display = _showRegularNodeByGlobalFilter(d) ? '' : 'none';
      });
      childrenDiv.classList.remove('collapsed');
      saveExpandedState(item.path, true);

      // Lazy load children
      if (childrenDiv.dataset.loaded === 'false' && childrenDiv.dataset.loading !== 'true') {
        childrenDiv.dataset.loading = 'true';
        // スピナー表示
        const spinner = document.createElement('div');
        spinner.className = 'tree-spinner';
        spinner.innerHTML = '<span style="color:var(--fg2);font-size:11px;padding:4px 24px;">読み込み中...</span>';
        childrenDiv.appendChild(spinner);
        try {
          if (isDB) {
            const pivotData = await apiFetch('/pivot?path=' + encodeURIComponent(item.path));
            // entities が undefined でも TypeError にならないようガード
            const entityNames = Object.keys(pivotData?.entities || {}).sort();
            const entityItems = entityNames.map(name => ({ name, type: 'entity', path: item.path + '/' + name, _dbPath: item.path }));
            await _appendOutlinerChildrenChunked(childrenDiv, entityItems, rootPath);
          } else if (isFolder) {
            const sortCfg = getSortForFolder(item.path);
            const apiSort = sortCfg.sort === 'manual' ? 'name' : sortCfg.sort;
            const rootParam = rootPath ? '&root=' + encodeURIComponent(rootPath) : '';
            const sourceParam = item.sourceId ? '&sourceId=' + encodeURIComponent(item.sourceId) : '';
            const children = await apiFetch('/browse?path=' + encodeURIComponent(item.path) + '&sort=' + apiSort + '&order=' + sortCfg.order + rootParam + sourceParam + '&all_files=true');
            const visibleChildren = children.filter(child => !(typeof isOutlinerDeletePendingPath === 'function' && isOutlinerDeletePendingPath(child?.path)));
            registerFileTypes(visibleChildren);
            _registerOutlinerConflictPaths(visibleChildren);
            visibleChildren.forEach(child => {
              if (item.sourceId && !child.sourceId) child.sourceId = item.sourceId;
            });
            await _appendOutlinerChildrenChunked(childrenDiv, visibleChildren, rootPath);
            // マニュアルソート適用
            if (sortCfg.sort === 'manual') applyManualSort(childrenDiv, item.path);
            // 非同期でDB/board判定（NAS高速化: browseは拡張子のみで判定し、後からcheck-typeで確定）
            const checkTargets = visibleChildren.filter(c => c.type === 'folder' || c.type === 'page' || c.type === 'scenario' || c.type === 'scriptnote');
            // NAS負荷軽減: 5件ずつバッチ処理
            (async () => {
              for (let i = 0; i < checkTargets.length; i += 5) {
                const batch = checkTargets.slice(i, i + 5);
                await Promise.all(batch.map(async child => {
                  try {
                    const res = await apiFetch('/check-type?path=' + encodeURIComponent(child.path));
                    if (res.type !== child.type) {
                      // タイプが変わった → ノードを再作成
                      const oldNode = childrenDiv.querySelector(`[data-path="${child.path.replace(/"/g, '\\"')}"]`);
                      if (oldNode) {
                        child.type = res.type;
                        const newNode = createTreeNodeFromBrowse(child, rootPath);
                        oldNode.replaceWith(newNode);
                        // 置換後のノードにグローバルフィルタを適用（常時）
                        if (res.type === 'database') {
                          newNode.style.display = _showDatabaseByGlobalFilter() ? '' : 'none';
                        } else if (res.type !== 'folder') {
                          newNode.style.display = _showRegularNodeByGlobalFilter(child) ? '' : 'none';
                        }
                      }
                    }
                  } catch(e) {}
                }));
              }
            })();
          }
          childrenDiv.dataset.loaded = 'true';
          // グローバルフィルタを新規読み込みノードに適用（常時）
          childrenDiv.querySelectorAll(':scope > .tree-node').forEach(node => {
            const d = node._nodeData;
            if (!d || d._isRoot) return;
            if (d.type === 'folder') return; // フォルダは_hideEmptyFilteredFoldersで処理
            if (d.type === 'database') { node.style.display = _showDatabaseByGlobalFilter() ? '' : 'none'; return; }
            if (d.type === 'entity') { node.style.display = _showEntityByGlobalFilter() ? '' : 'none'; return; }
            node.style.display = _showRegularNodeByGlobalFilter(d) ? '' : 'none';
          });
          // 空フォルダの非表示（新規読み込み分を含む）
          _hideEmptyFilteredFolders();
          _snapshotBaseTreeVisibility();
          // 検索中なら新ノードに検索フィルタも適用
          if (_treeSearchQuery) {
            const q = _treeSearchQuery;
            const includeEntities = typeof _getTreeSearchIncludeEntities === 'function'
              ? _getTreeSearchIncludeEntities()
              : localStorage.getItem('tree-search-include-entities') === 'true';
            childrenDiv.querySelectorAll(':scope > .tree-node').forEach(node => {
              const d = node._nodeData;
              if (!d) return;
              let match = false;
              if (d.type === 'entity') match = includeEntities && d.name && d.name.toLowerCase().includes(q);
              else match = d.name && d.name.toLowerCase().includes(q);
              if (!match && d.type !== 'folder' && d.type !== 'database' && !d._isRoot) {
                node.style.display = 'none';
              }
            });
          }
          childrenDiv.dataset.loaded = 'true';
        } catch (e) { /* error shown — dataset.loaded を 'false' のまま残してリトライ可能にする */ }
        finally {
          delete childrenDiv.dataset.loading;
          spinner.remove();
        }
      }
    } else {
      toggle.classList.remove('expanded');
      toggle.dataset.expanded = 'false';
      childrenDiv.classList.add('collapsed');
      saveExpandedState(item.path, false);
      // 作品フォルダ動的アイコン切替（折畳み時）
      if (isFolder) {
        const iconEl = row.querySelector('.tree-icon');
        if (iconEl) {
          const isWork = item.path === getWorkFolder();
          iconEl.innerHTML = lucide(isWork ? 'folderDot' : 'folder', 18);
          if (item.linked) iconEl.innerHTML += '<span style="position:relative;top:-4px;left:-2px;">' + lucide('externalLink', 8) + '</span>';
        }
      }
    }
  });

  // 前回展開されていたら自動展開
  _queueSavedOutlinerExpansion(item, toggle);

  // Row click: 選択＋コンテンツ表示
  row.addEventListener('click', (e) => {
    try { row.focus({ preventScroll: true }); } catch {}
    if (_outlinerSuppressNextTreeRowClick && (!_outlinerSuppressTreeRowClickNode || _outlinerSuppressTreeRowClickNode === div)) {
      _outlinerSuppressNextTreeRowClick = false;
      _outlinerSuppressTreeRowClickNode = null;
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (e.shiftKey) {
      // Shift+クリック: 範囲選択
      e.preventDefault();
      treeSelection.rangeTo(div);
      treeSelection.lastClicked = div;
      return;
    }
    if (e.ctrlKey || e.metaKey) {
      // Ctrl+クリック: トグル選択
      treeSelection.toggle(div);
      treeSelection.lastClicked = div;
      return;
    }

    // 通常クリック: 単一選択 + コンテンツ表示
    treeSelection.clear();
    treeSelection.add(div);
    treeSelection.lastClicked = div;

    document.querySelectorAll('.tree-node-row.active').forEach(r => r.classList.remove('active'));
    row.classList.add('active');

    // スクロール位置保護は pointerdown 時点のグローバルガード (_treeScrollGuard) に委ねる

    // skipHighlight: クリック側で既に active クラスを付け終えているので、
    // open* 関数内の highlightOutlinerNode → scrollIntoView は不要かつスクロールジャンプ源。
    const _expOpts = { fromExplorer: true, skipHighlight: true };
    if (typeof _chatSetCurrentTargetPath === 'function' && item.path) {
      _chatSetCurrentTargetPath(item.path, isFolder || isDB ? 'folder' : 'file', { reason: 'tree-click', deferAdoptSource: true });
    }
    if (isDB) {
      selectDatabase(item.path, null, _expOpts);
    } else if (item.type === 'entity') {
      selectEntity(item.path, _expOpts);
    } else if (item.type === 'page') {
      openPage(item.name, item.path, _expOpts);
    } else if (item.type === 'scriptnote' || item.type === 'scenario' || (typeof isScriptNotePath === 'function' && isScriptNotePath(item.path))) {
      if (typeof openScenarioInScriptNote === 'function') openScenarioInScriptNote(item.path, item.name, _expOpts);
    } else if (item.type === 'board') {
      openBoard(item.name, item.path, _expOpts);
    } else if (item.type === 'calendar') {
      openCalendarFile(item.name, item.path, _expOpts);
    } else if (item.type === 'image' || item.type === 'video' || item.type === 'audio') {
      openMedia(item.name, item.path, item.type, _expOpts);
    } else if (item.type === 'html') {
      openHtmlFile(item.name, item.path, _expOpts);
    } else if (item.type === 'csv') {
      if (typeof openCsvFile === 'function') openCsvFile(item.name, item.path, _expOpts);
      else openPage(item.name, item.path, _expOpts);
    } else if (item.type === 'smart-db') {
      if (typeof openSmartDbFile === 'function') openSmartDbFile(item.name, item.path, _expOpts);
    } else if (isFolder) {
      openFolder(item.name, item.path, _expOpts);
      if (toggle && toggle.dataset.expanded !== 'true') toggle.click();
    } else if (!NATIVE_TYPES.has(item.type)) {
      // ネイティブアプリ専用ファイル（psd, clip, 3d等）: メニューから開く案内
      showStatus(item.name + ' — 「…」または長押しメニューからアプリで開く');
    }

    // open* 呼び出し後の念押し復元（ガードは pointerdown で既に張っている）
    _treeScrollGuardRestore();
  });

  // --- ダブルクリック: インラインリネーム ---
  row.ondblclick = (e) => {
    e.stopPropagation();
    if (item.type === 'entity' || item._isRoot) return;
    if (item.path && isItemLocked(item.path)) return;
    // 既にリネーム中なら無視
    if (label.querySelector('input')) return;
    startTreeLabelEdit(label, item);
  };

  // --- 右クリックメニュー ＋ 長押しで同メニュー（タッチ/ペン） ---
  const _openTreeRowCtxMenu = (e) => {
    e.preventDefault();
    e.stopPropagation();
    // 右クリックしたノードが選択に含まれていなければ、単一選択に切り替え
    if (!treeSelection.has(div)) {
      treeSelection.clear();
      treeSelection.add(div);
      treeSelection.lastClicked = div;
    }
    const z = parseFloat(document.documentElement.style.zoom) || 1;
    showTreeContextMenu(e.clientX / z, e.clientY / z, div, item, label);
  };
  row.addEventListener('contextmenu', _openTreeRowCtxMenu);
  if (typeof addLongPressHandler === 'function') {
    addLongPressHandler(row, _openTreeRowCtxMenu);
  }

  // --- ドラッグ&ドロップ ---
  if (item.type === 'entity') {
    row.draggable = false;
  }

  row.addEventListener('dragstart', (e) => {
    if (item._isRoot) {
      e.preventDefault();
      return;
    }
    // 複数選択中にドラッグ開始: 選択に含まれていなければ単一選択に切り替え
    if (!treeSelection.has(div)) {
      treeSelection.clear();
      treeSelection.add(div);
      treeSelection.lastClicked = div;
    }
    draggedNode = div;
    // DOM順でソート（上から下の順序を維持）
    const allTreeNodes = [...document.querySelectorAll('#outliner-tree .tree-node, #body-home .tree-node, #body-workspaces .tree-node')];
    const selectedNodes = [...treeSelection.items].sort((a, b) => allTreeNodes.indexOf(a) - allTreeNodes.indexOf(b));
    draggedNodes = selectedNodes.filter(n => !selectedNodes.some(parent => parent !== n && parent.contains(n)));
    draggedNodes.forEach(n => n.querySelector('.tree-node-row')?.classList.add('dragging'));
    const payload = _treeDragPayload(item);
    e.dataTransfer.effectAllowed = 'copyMove';
    // text/uri-list を入れておくと OS シェル（窓外）が「URL のドラッグ」として
    // 認識し、赤い禁止カーソルが出にくくなる
    try {
      const firstItem = (payload.items && payload.items[0]) || null;
      if (firstItem && firstItem.path && typeof buildSingleTabWindowUrl === 'function') {
        const uri = new URL(buildSingleTabWindowUrl(firstItem), location.origin).toString();
        e.dataTransfer.setData('text/uri-list', uri);
      }
    } catch {}
    e.dataTransfer.setData('text/plain', (payload.items || []).map(entry => entry.name).filter(Boolean).join(', ') || item.name || '');
    e.dataTransfer.setData('application/x-meldex-node', JSON.stringify(payload));
    // 窓外ドロップ時の popout 用に payload を保持
    window._gbOutlinerDragPayload = payload;
    // ドロップインジケータが隠れないよう、プレビュー画像を低不透明度にする
    if (typeof setLowOpacityDragImage === 'function') {
      setLowOpacityDragImage(e, row, 0.35);
    }
  });

  row.addEventListener('dragend', (e) => {
    (draggedNodes || []).forEach(n => n.querySelector('.tree-node-row')?.classList.remove('dragging'));
    clearDragIndicators();
    // ペインタブバーに表示されている挿入位置マーカーを確実にクリア
    // （ESC キャンセル等でタブバー側の dragleave が発火しないケースの漏れ対策）
    document.querySelectorAll('.gb-tab.gb-tab-drop-before, .gb-tab.gb-tab-drop-after')
      .forEach(t => t.classList.remove('gb-tab-drop-before', 'gb-tab-drop-after'));
    // 窓外にドロップされた場合: 共通ヘルパーで単一窓として開く
    if (typeof isDragDroppedOutsideWindow === 'function' && isDragDroppedOutsideWindow(e)) {
      const payload = window._gbOutlinerDragPayload;
      const items = payload && Array.isArray(payload.items) ? payload.items : [];
      if (typeof openItemsAsSingleTabWindows === 'function') openItemsAsSingleTabWindows(items);
    }
    window._gbOutlinerDragPayload = null;
    draggedNode = null;
    draggedNodes = null;
  });

  row.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (!draggedNode) return;
    // Ctrl+ドラッグ中はツリー内移動を行わない（ペインで開く操作に委ねる）
    if (e.ctrlKey) { e.dataTransfer.dropEffect = 'copy'; return; }
    // ドラッグ中のノード自体（複数選択含む）へのドロップを防止
    if (draggedNodes && draggedNodes.includes(div) || draggedNode === div) return;
    e.dataTransfer.dropEffect = 'move';
    clearDragIndicators();

    const rect = row.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const h = rect.height;

    if (isFolder || isDB) {
      if (y < h * 0.25) row.classList.add('drag-over-above');
      else if (y > h * 0.75) row.classList.add('drag-over-below');
      else row.classList.add('drag-over-inside');
    } else {
      if (y < h * 0.5) row.classList.add('drag-over-above');
      else row.classList.add('drag-over-below');
    }
  });

  row.addEventListener('dragleave', () => {
    row.classList.remove('drag-over-above', 'drag-over-below', 'drag-over-inside');
  });

  row.addEventListener('drop', (e) => {
    e.preventDefault();
    // Ctrl+ドロップ: ツリー内移動を行わない（ペインで開く操作に委ねる）
    if (e.ctrlKey) { clearDragIndicators(); return; }
    if (!draggedNode || draggedNode === div) return;
    const nodes = (draggedNodes || [draggedNode])
      .filter(n => n !== div && !n.contains(div) && !n._nodeData?._isRoot && !(n._nodeData?.path && isItemLocked(n._nodeData.path)));
    if (nodes.length === 0) return;
    const orderBefore = captureOutlinerSettingsHistory([SORT_SETTINGS_KEY, MANUAL_ORDER_KEY]);

    // Alt+D&D: フォルダリンク登録（移動ではなくリンク）
    if (e.altKey && (isFolder || isDB)) {
      for (const n of nodes) {
        const d = n._nodeData;
        if (d && d.path) {
          const addLink = typeof addFolderLinkWithHistory === 'function'
            ? addFolderLinkWithHistory(d.path, item.path)
            : apiPost('/folder-links/add', { file_path: d.path, folder_path: item.path });
          Promise.resolve(addLink).then(() => {
            showStatus(d.name + ' → ' + item.name + ' にリンク登録');
          }).catch(() => showStatus('リンク登録に失敗', true));
        }
      }
      clearDragIndicators();
      loadOutliner();
      return;
    }

    const position = row.classList.contains('drag-over-above') ? 'above'
      : row.classList.contains('drag-over-inside') ? 'inside'
      : 'below';
    clearDragIndicators();

    // ワークスペースセクションのルート行への上下ドロップは、並び替えではなく
    // ルートフォルダ外（vaultルート）への実移動になってしまうため受け付けない
    if (position !== 'inside' && item._isRoot && div.closest('#body-workspaces')) {
      showStatus('ワークスペースの中に移動する場合は、ワークスペース名の上にドロップしてください');
      return;
    }

    const targetParent = div.parentElement;

    // リンクファイルチェック
    const hasLinked = nodes.some(n => n._nodeData && n._nodeData.linked);
    if (hasLinked) {
      showStatus('リンクファイルは移動できません（Alt+D&Dでリンク先を変更）');
      return;
    }

    // 移動先フォルダを決定
    let destFolder = '';
    if (position === 'inside' && (isFolder || isDB)) {
      destFolder = item.path;
    } else {
      const parentNode = div.parentElement?.closest('.tree-node');
      if (parentNode) {
        destFolder = parentNode._nodeData?.path || '';
      } else if (div.closest('#body-home') && _homeFolderPath) {
        destFolder = _homeFolderPath;
      } else {
        destFolder = '';
      }
    }
    if (destFolder && isItemLocked(destFolder)) {
      showStatus('編集ロック中のフォルダには移動できません', true);
      return;
    }

    // API移動を先に実行し、成功したノードのみDOMを更新（失敗時にDOMが先行するのを防ぐ）
    (async () => {
      const moved = [];
      let movedAcrossFolders = false;
      for (const n of nodes) {
        const dragData = n._nodeData;
        if (!dragData || !dragData.path) { moved.push(n); continue; }
        const srcFolder = dragData.path.includes('/') ? dragData.path.substring(0, dragData.path.lastIndexOf('/')) : '';
        if (destFolder === srcFolder) { moved.push(n); continue; }
        movedAcrossFolders = true;
        try {
          const oldPath = dragData.path;
          const res = await apiPost('/outliner/move', { path: dragData.path, dest_folder: destFolder });
          if (res.new_path) {
            if (typeof _renameTreeNode === 'function') {
              _renameTreeNode(oldPath, res.new_path, res.new_name || dragData.name, res.file_id);
            } else {
              dragData.path = res.new_path;
              dragData.name = res.new_name || dragData.name;
              const lbl = n.querySelector('.tree-label');
              if (lbl && res.new_name) lbl.textContent = res.new_name;
            }
            if (typeof renameAppPathReferences === 'function') {
              renameAppPathReferences(oldPath, res.new_path, { label: res.new_name || dragData.name, fileId: res.file_id, type: dragData.type || 'page' });
            }
          }
          if (typeof handleRelocateResponse === 'function') handleRelocateResponse(res);
          moved.push(n);
        } catch {
          showStatus(`${dragData.name} の移動に失敗`, true);
        }
      }
      if (moved.length === 0) return;
      // DOM上の移動（ドロップ位置に順番通り挿入）
      if (position === 'inside' && (isFolder || isDB)) {
        if (childrenDiv.dataset.loaded === 'false') {
          moved.forEach(n => {
            if (typeof _unregisterTreeSubtree === 'function') _unregisterTreeSubtree(n);
            n.remove();
          });
          if (toggle.dataset.expanded !== 'true') toggle.click();
        } else {
          moved.forEach(n => childrenDiv.appendChild(n));
          if (toggle.dataset.expanded !== 'true') toggle.click();
          setSortSetting(item.path, 'manual', 'asc');
          saveManualOrderFromDOM(childrenDiv, item.path);
          if (!movedAcrossFolders) {
            pushOutlinerSettingsHistory('フォルダツリー: 並び順', orderBefore, item.path, [SORT_SETTINGS_KEY, MANUAL_ORDER_KEY]);
          }
        }
      } else if (position === 'above') {
        moved.forEach(n => targetParent.insertBefore(n, div));
      } else {
        let ref = div.nextSibling;
        moved.forEach(n => { targetParent.insertBefore(n, ref); });
      }
      if (position !== 'inside') {
        const parentNode = targetParent.closest('.tree-node');
        const parentPath = parentNode?._nodeData?.path || '_root';
        setSortSetting(parentPath, 'manual', 'asc');
        saveManualOrderFromDOM(targetParent, parentPath);
        if (!movedAcrossFolders) {
          pushOutlinerSettingsHistory('フォルダツリー: 並び順', orderBefore, parentPath, [SORT_SETTINGS_KEY, MANUAL_ORDER_KEY]);
        }
      }
    })();
  });

  _registerTreeNode(div);
  return div;
}

function clearDragIndicators() {
  document.querySelectorAll('.drag-over-above,.drag-over-below,.drag-over-inside').forEach(el => {
    el.classList.remove('drag-over-above', 'drag-over-below', 'drag-over-inside');
  });
}

// DOMからツリー構造をJSON化
function domToTree(container) {
  const tree = [];
  container.querySelectorAll(':scope > .tree-node').forEach(nodeEl => {
    const data = nodeEl._nodeData;
    if (!data) return;
    const childrenContainer = nodeEl.querySelector(':scope > .tree-children');
    const node = { ...data };
    if (childrenContainer && childrenContainer.children.length > 0) {
      const childNodes = domToTree(childrenContainer).filter(c => c.type !== 'entity');
      if (data.type === 'folder' || data.type === 'database') {
        node.children = childNodes;

/* === gb-outliner.part02.js === */
      }
    } else if (data.children) {
      node.children = data.children;
    }
    if (data.type !== 'entity') {
      tree.push(node);
    }
  });
  return tree;
}

async function saveOutlinerTree() {
  // ルートフォルダベースではファイルシステムがツリー構造そのもの。
  // D&Dによる並べ替えは localStorage のマニュアル順として永続化する。
}

function _normalizeOutlinerPathForCompare(path) {
  return String(path || '').replace(/\\/g, '/').replace(/\/+$/, '');
}

function _isOutlinerPathWithin(path, basePath) {
  const normalizedPath = _normalizeOutlinerPathForCompare(path);
  const normalizedBase = _normalizeOutlinerPathForCompare(basePath);
  if (!normalizedPath || !normalizedBase) return false;
  if (normalizedPath === normalizedBase || normalizedPath.startsWith(normalizedBase + '/')) return true;
  return false;
}

const _outlinerPendingDeletePaths = new Set();

function _isOutlinerFreeLayoutUiEnabled() {
  if (typeof GBLayout === 'undefined') return true;
  return typeof GBLayout.isFreeLayoutUiEnabled === 'function'
    ? !!GBLayout.isFreeLayoutUiEnabled()
    : true;
}

function isOutlinerDeletePendingPath(path) {
  const normalizedPath = _normalizeOutlinerPathForCompare(path);
  if (!normalizedPath || !_outlinerPendingDeletePaths.size) return false;
  for (const pendingPath of _outlinerPendingDeletePaths) {
    if (_isOutlinerPathWithin(normalizedPath, pendingPath)) return true;
  }
  return false;
}

function _setOutlinerDeletePending(paths, pending) {
  const normalizedPaths = (paths || []).map(_normalizeOutlinerPathForCompare).filter(Boolean);
  normalizedPaths.forEach(path => {
    if (pending) _outlinerPendingDeletePaths.add(path);
    else _outlinerPendingDeletePaths.delete(path);
  });
  return normalizedPaths;
}

function _prepareOutlinerDeleteTargets(items) {
  const seen = new Set();
  const unique = (Array.isArray(items) ? items : [])
    .filter(item => item && item.path)
    .map(item => ({
      name: item.name || item.label || String(item.path).split('/').pop() || '',
      path: item.path,
      type: item.type || 'page',
      _comparePath: _normalizeOutlinerPathForCompare(item.path),
    }))
    .filter(item => {
      if (!item._comparePath || seen.has(item._comparePath)) return false;
      seen.add(item._comparePath);
      return true;
    })
    .sort((a, b) => a._comparePath.split('/').length - b._comparePath.split('/').length);
  const roots = [];
  unique.forEach(item => {
    if (roots.some(root => _isOutlinerPathWithin(item._comparePath, root._comparePath))) return;
    roots.push(item);
  });
  return roots.map(({ _comparePath, ...item }) => item);
}

async function _deleteOutlinerTargetsSequentially(targets, options = {}) {
  const batchTargets = (Array.isArray(targets) ? targets : []).filter(item => item && item.path);
  if (batchTargets.length) {
    try {
      const payload = await apiPost('/outliner/delete-batch', {
        items: batchTargets.map(item => ({ path: item.path })),
      });
      const batchResults = Array.isArray(payload?.results) ? payload.results : [];
      if (batchResults.length === batchTargets.length) {
        return batchResults.map((entry, index) => {
          const item = batchTargets[index];
          if (entry?.ok) {
