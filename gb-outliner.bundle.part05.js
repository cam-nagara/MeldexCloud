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
    const impactTargets = targets.map(item => ({
      path: item.path,
      kind: item.type === 'folder' ? 'folder' : 'file',
      ...((item.assetId || item.asset_id) ? { assetId: String(item.assetId || item.asset_id) } : {}),
    }));
    const confirmed = typeof MeldexDeleteImpactWarning !== 'undefined'
      ? await MeldexDeleteImpactWarning.authorizeReversibleDelete(impactTargets)
      : { confirmed: true, operation: 'trash' };
    if (!confirmed) return;
    treeSelection.clear();
    const result = await deleteOutlinerItemsWithHistory(targets, {
      confirmation: confirmed,
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
    if (result.failedCount) {
      const reason = result.failed?.[0]?.error;
      const detail = typeof reason === 'string' ? reason : reason?.message || reason?.detail?.message || reason?.detail || '';
      showStatus(`${result.deletedCount || result.succeeded.length}件を削除、${result.failedCount}件は失敗しました${detail ? ': ' + detail : ''}`, true);
      loadOutliner();
    } else if (result.succeeded.length) {
      showStatus(`${result.deletedCount || result.succeeded.length}件を削除しました（Undoで戻せます）`);
    } else if (result.skipped.length) {
      showStatus('削除対象が見つからなかったため、表示を更新しました', true);
      loadOutliner();
    }
  };

  if (typeof appendFolderOperationButtons === 'function') {
    appendFolderOperationButtons(menu, {
      e2ePrefix: 'folder-tree-context',
      closeMenu: closeTreeContextMenu,
      onCopy: () => folderToolbarCopyItems(contextOperationItems),
      onCut: () => folderToolbarCutItems(contextOperationItems),
      onPaste: () => folderToolbarPasteToFolder(addParent),
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
        } else {
          showStatus('自動タグ付けを初期化できませんでした', true);
        }
      },
      null,
      'tags'
    );
  }

  // --- ファイルのチャット（ファイル/DB/エントリのみ） ---
  if (!isMulti && nodeData.path && nodeData.type !== 'folder' && !nodeData._isRoot) {
    addMenuItem('チャットを開く', () => {
      closeTreeContextMenu();
      openFileChat(nodeData.path);
    }, null, 'messageSquare');
  }

  // --- 比較（ファイル全般） ---
  if (!isMulti && nodeData.path && nodeData.type !== 'folder' && !nodeData._isRoot && typeof showCompareModal === 'function') {
    addMenuItem('比較...', () => {
      closeTreeContextMenu();
      showCompareModal(nodeData.path);
    }, null, 'columns');
  }

  // --- この階層を閉じる（大量項目向けUI補助導線。§2.3） ---
  // メニュー構築中に例外が起きても、以降の項目や末尾の_outlinerPlaceContextMenu(menu)を
  // 必ず実行させる（例外1つでメニュー全体が出なくなる事態を避ける）。
  try {
    if (!isMulti && (isFolder || isDB)) {
      const toggleEl = nodeEl.querySelector(':scope > .tree-node-row .tree-toggle');
      if (toggleEl && toggleEl.dataset.expanded === 'true') {
        addMenuItem('この階層を閉じる', () => {
          closeTreeContextMenu();
          window.GBOutlinerVirtualPin?.closeBranch(nodeEl);
        }, null, 'chevronsUp');
      }
    }
  } catch (err) {
    console.error('[showTreeContextMenu] この階層を閉じるメニューの構築に失敗', err);
  }

  // --- リンクをコピー ---
  if (!isMulti && nodeData.path) {
    addMenuItem('リンクをコピー', () => {
      closeTreeContextMenu();
      return _outlinerCopyLink(nodeData);
    }, null, 'link');
  }

  // --- リネーム（F2と同じ共通ヘルパー。単一選択時のみ、エントリ以外、ロック中は無効） ---
  if (!isMulti && !isEntity && !_locked && !nodeData._isRoot) {
    addMenuItem('リネーム', () => {
      closeTreeContextMenu();
      window.GBOutlinerActivation?.startRenameForNode(nodeEl, labelEl, nodeData);
    }, null, 'pencil');
  }

  // --- パスをコピー ---
  {
    const pathTargets = isMulti
      ? [...treeSelection.items]
          .map(node => ({ node, data: node._nodeData }))
          .filter(item => item.data?.path)
      : (nodeData.path ? [{ node: nodeEl, data: nodeData }] : []);
    if (pathTargets.length > 0) {
      const pathLabel = isMulti ? `パスをコピー（${pathTargets.length}件）` : 'パスをコピー';
      addMenuItem(pathLabel, () => {
        closeTreeContextMenu();
        const copyPaths = pathTargets.map(item => _outlinerLocalCopyPath(item.node, item.data)).filter(Boolean);
        const paths = copyPaths.join('\n');
        const msg = pathTargets.length === 1
          ? 'パスをコピーしました: ' + copyPaths[0]
          : `パスをコピーしました（${pathTargets.length}件）`;
        navigator.clipboard.writeText(paths).then(() => {
          showStatus(msg);
        }).catch(() => {
          const ta = document.createElement('textarea');
          ta.value = paths; document.body.appendChild(ta);
          ta.select(); document.execCommand('copy'); ta.remove();
          showStatus(msg);
        });
      }, null, 'clipboardList');
    }
  }

  // --- お気に入り（1項目だけが対象のため単独選択時のみ） ---
  if (!isMulti && !isEntity && nodeData.path) {
    const isFav = getFavorites().some(f => f.path === nodeData.path);
    addMenuItem(isFav ? 'お気に入りを外す' : 'お気に入りに追加', () => {
      closeTreeContextMenu();
      if (isFav) removeFromFavorites(nodeData.path);
      else addToFavorites(nodeData.name, nodeData.path, nodeData.type);
    }, null, isFav ? 'starOff' : 'star');
  }

  // --- エクスポート ---
  if (!isMulti && nodeData.path) {
    const _expItems = [];
    const pushExportItem = (label, url, extension, filetypes) => {
      const baseName = (typeof MeldexExportSave !== 'undefined' && typeof MeldexExportSave.guessNameFromPath === 'function')
        ? MeldexExportSave.guessNameFromPath(nodeData.path, nodeData.name || '無題')
        : (nodeData.name || '無題');
      const stem = String(baseName || '無題').replace(/\.[^.]+$/, '') || '無題';
      _expItems.push({
        label,
        url,
        filename: stem + extension,
        extension,
        filetypes,
      });
    };
    if (nodeData.type === 'database') {
      pushExportItem('CSV', '/export/db?path=' + encodeURIComponent(nodeData.path) + '&format=csv', '.csv', [['CSVファイル', '*.csv'], ['すべてのファイル', '*.*']]);
      pushExportItem('HTML', '/export/db?path=' + encodeURIComponent(nodeData.path) + '&format=html', '.html', [['HTMLファイル', '*.html'], ['すべてのファイル', '*.*']]);
      pushExportItem('Excel', '/export/db?path=' + encodeURIComponent(nodeData.path) + '&format=xlsx', '.xlsx', [['Excelファイル', '*.xlsx'], ['すべてのファイル', '*.*']]);
    } else if (nodeData.type === 'board') {
      pushExportItem('HTML', '/export/canvas?path=' + encodeURIComponent(nodeData.path) + '&format=html', '.html', [['HTMLファイル', '*.html'], ['すべてのファイル', '*.*']]);
      pushExportItem('SVG画像', '/export/canvas?path=' + encodeURIComponent(nodeData.path) + '&format=svg', '.svg', [['SVGファイル', '*.svg'], ['すべてのファイル', '*.*']]);
      pushExportItem('Markdown', '/export/canvas?path=' + encodeURIComponent(nodeData.path) + '&format=md', '.md', [['Markdownファイル', '*.md'], ['すべてのファイル', '*.*']]);
    } else if (nodeData.type === 'page') {
      pushExportItem('テキスト', '/export/note?path=' + encodeURIComponent(nodeData.path) + '&format=txt', '.txt', [['テキストファイル', '*.txt'], ['すべてのファイル', '*.*']]);
      pushExportItem('Markdown', '/export/note?path=' + encodeURIComponent(nodeData.path) + '&format=md', '.md', [['Markdownファイル', '*.md'], ['すべてのファイル', '*.*']]);
      pushExportItem('HTML', '/export/note?path=' + encodeURIComponent(nodeData.path) + '&format=html', '.html', [['HTMLファイル', '*.html'], ['すべてのファイル', '*.*']]);
      pushExportItem('Word', '/export/note?path=' + encodeURIComponent(nodeData.path) + '&format=docx', '.docx', [['Wordファイル', '*.docx'], ['すべてのファイル', '*.*']]);
    }
    if (_expItems.length > 0) {
      // エクスポートサブメニュー
      const exportIconName = typeof uiTransferIconName === 'function' ? uiTransferIconName('export') : 'upload';
      const expPanel = _outlinerCreateSubmenu('エクスポート');
      _outlinerAppendSubmenu(menu, 'エクスポート', exportIconName, expPanel);
      _expItems.forEach(ei => {
        _outlinerAppendMenuItem(expPanel, {
          label: ei.label,
          action: async () => {
          closeTreeContextMenu();
          if (typeof MeldexExportSave === 'undefined' || typeof MeldexExportSave.saveUrl !== 'function') {
            showStatus('保存ダイアログを初期化できませんでした', true);
            return;
          }
          await MeldexExportSave.saveUrl(ei.url, {
            filename: ei.filename,
            extension: ei.extension,
            dialogTitle: `${ei.label}として保存`,
            filetypes: ei.filetypes,
            okMessage: `${ei.label} として保存しました`,
            errorMessage: `${ei.label} の保存に失敗しました`,
            path: nodeData.path,
            title: nodeData.name || '無題',
          });
          },
        });
      });
      addSep();
    }
  }

  // --- 所属フォルダ（リンク登録。1項目だけが対象のため単独選択時のみ） ---
  if (!isMulti && !isEntity && nodeData.path) {
    const linkLabel = nodeData.type === 'folder' ? 'このフォルダへのリンクを作成...' : '所属フォルダを設定...';
    addMenuItem(linkLabel, () => {
      closeTreeContextMenu();
      showAddFolderLinkModal(nodeData.path, null);
    }, null, 'link2');
  }

  // --- 色設定 ---
  addSep();
  {
    const currentColor = getNodeColor(nodeData.path);
    const colorItem = _outlinerAppendMenuItem(menu, {
      html: '',
      action: () => {
        openColorPalette(swatch, currentColor, (c) => {
          closeTreeContextMenu();
          applyColorToSelection(c || null);
        });
      },
    });
    const swatch = document.createElement('span');
    swatch.className = 'gb-color-swatch gb-color-swatch--inline';
    swatch.setAttribute('aria-hidden', 'true');
    setColorSwatchValue(swatch, currentColor || 'var(--fg)');
    colorItem.appendChild(swatch);
    const clbl = document.createElement('span');
    clbl.textContent = isMulti ? `色設定（${selectedCount}件）` : '色設定';
    colorItem.appendChild(clbl);
  }

  // --- ワークスペースルート: ソースフォルダ用メニューは出さない ---
  // （ワークスペースはソースフォルダ設定に保存されないため、出しても無効操作になる）
  if (nodeData._isRoot && !isMulti && (nodeData.rootKind === 'workspace' || nodeData.workspaceId)) {
    addSep();
    addMenuItem('ワークスペースの管理...', () => {
      closeTreeContextMenu();
      if (typeof openWorkspaceSettings === 'function') openWorkspaceSettings();
    }, null, 'usersRound');
  }

  // --- ルートフォルダのパス変更 ---
  if (nodeData._isRoot && !isMulti && !(nodeData.rootKind === 'workspace' || nodeData.workspaceId)) {
    addSep();
    addMenuItem('パスを変更...', async () => {
      closeTreeContextMenu();
      showStatus('フォルダ選択ダイアログを開いています...');
      try {
        const isDropbox = window.MeldexRuntimeAdapter?.isDropboxMode?.();
        const res = isDropbox
          ? await window.MeldexDropboxFolderPicker.pickFolder({ title: 'ソースフォルダの参照先を選択' })
          : await apiFetch('/pick-folder');
        if (!res?.path) { showStatus('キャンセルされました'); return; }
        // outliner_rootsを更新
        const roots = await apiFetch('/outliner-roots');
        const baseRoots = _cloneOutlinerRootsForBase(roots);
        const root = roots.find(r => r.path === nodeData.path);
        if (root) {
          if (isDropbox) {
            const registry = window.MeldexSourceFolderRegistry;
            const sourceId = root.sourceId || root.id || registry.parseSourcePath(root.path)?.sourceId;
            if (!sourceId) throw new Error('ソースフォルダの登録IDを確認できません');
            root.provider = 'dropbox';
            root.id = root.sourceId = sourceId;
            root.dropboxPath = registry.normalizeDropboxPath(res.path);
            root.namespaceKind = registry.normalizeNamespaceKind(res.namespaceKind);
            root.path = registry.sourcePath(sourceId);
            root.name = res.name || res.path.split('/').filter(Boolean).pop();
          } else {
            root.path = res.path;
            root.name = res.path.split(/[/\\]/).pop();
          }
          await _putOutlinerRootsWithBase(roots, baseRoots);
          // The virtual ID remains the same, but cached files/revisions belong
          // to the former physical location and must not follow the new path.
          if (isDropbox) window.MeldexStorageAdapter?.getProvider?.()?._forgetMeta?.(root.path);
          await loadOutliner();
          showStatus('パスを変更しました: ' + res.path);
        }
      } catch (e) { showStatus('パス変更に失敗しました', true); }
    }, null, 'folderPen');
    addMenuItem('名前を変更...', async () => {
      closeTreeContextMenu();
      await _outlinerRenameSourceFolder(nodeData);
    }, null, 'pencil');
    addMenuItem('チーム管理...', async () => {
      closeTreeContextMenu();
      showSettingsModal({ panel: 'ユーザー' });
    }, null, 'users');
    addSep();
    addMenuItem('このソースフォルダの登録を解除', async () => {
      closeTreeContextMenu();
      await _outlinerUnregisterSourceFolder(nodeData);
    }, null, 'folder-minus');
  }

  // --- 作品フォルダ設定（フォルダのみ） ---
  if (isFolder && !isMulti) {
    const isWork = isWorkFolder(nodeData.path);
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
          removeWorkFolder(nodeData.path);
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

  // --- スプリットビュー ---
  if (!isMulti && isDB && nodeData.path && typeof isSplitActive === 'function' && _isOutlinerFreeLayoutUiEnabled()) {
    addSep();
    if (isSplitActive()) {
      addMenuItem('別の作業領域で開く', () => { closeTreeContextMenu(); openDbInOtherPane(nodeData.path); }, null, 'columns');
    } else {
      addMenuItem('スプリットで開く', () => { closeTreeContextMenu(); openInNewSplit(nodeData.path); }, null, 'columns');
