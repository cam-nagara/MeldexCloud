    });
  }

  let trashRefs = succeeded.map(_outlinerTrashRefFromResponse).filter(Boolean);
  let trashNames = _outlinerTrashRefsToNames(trashRefs);
  if (succeeded.length && typeof historyPush === 'function') {
    const label = options.label || (succeeded.length + ' 件を削除');
    const detail = options.detail || succeeded.map(item => item.path).join(', ');
    historyPush(
      label,
      async () => {
        const restored = await _restoreOutlinerTrashRefs(trashRefs);
        await _runOutlinerDeleteHistoryRefresh(options.refresh, 'undo', { succeeded, deletedPaths, trashNames });
        if (typeof showStatus === 'function') showStatus((restored.length || trashNames.length) + ' 件を復元しました');
      },
      async () => {
        const nextTrashRefs = [];
        if (deletedPaths.length) _markOutlinerDeletePending(deletedPaths);
        for (const item of succeeded) {
          const res = await apiPost('/outliner/delete', { path: item.path }).catch(() => null);
          const ref = _outlinerTrashRefFromResponse(res);
          if (ref) nextTrashRefs.push(ref);
        }
        if (deletedPaths.length) _clearOutlinerDeletePending(deletedPaths);
        trashRefs = nextTrashRefs;
        trashNames = _outlinerTrashRefsToNames(trashRefs);
        if (deletedPaths.length && typeof purgeAppPathReferences === 'function') {
          purgeAppPathReferences(deletedPaths);
        }
        await _runOutlinerDeleteHistoryRefresh(options.refresh, 'redo', { succeeded, deletedPaths, trashNames });
        if (typeof showStatus === 'function') showStatus(trashNames.length + ' 件を削除しました');
      },
      options.scope || '',
      detail
    );
  }

  return { targets, requestedTargets, succeeded, skipped, failed, failedCount, deletedCount, deletedPaths, trashNames, trashRefs };
}

const MAIN_CALENDAR_SETTINGS_KEYS = ['main-calendar-path', 'main-calendar-id'];

function _refreshMainCalendarSettingAfterHistory() {
  if (typeof loadOutliner === 'function') loadOutliner();
  if (typeof renderHomeFolderTree === 'function') renderHomeFolderTree();
}

function _captureMainCalendarSettingsHistory() {
  if (typeof captureLocalStorageSettings !== 'function') return null;
  if (typeof isLocalStorageSettingsHistorySuppressed === 'function'
    && isLocalStorageSettingsHistorySuppressed()) return null;
  return captureLocalStorageSettings(MAIN_CALENDAR_SETTINGS_KEYS);
}

function _pushMainCalendarSettingsHistory(label, beforeSnapshot, detail) {
  if (!beforeSnapshot || typeof historyPush !== 'function'
    || typeof captureLocalStorageSettings !== 'function'
    || typeof restoreLocalStorageSettings !== 'function'
    || typeof _normalizeLocalStorageSettingsSnapshots !== 'function') return false;
  const snapshots = _normalizeLocalStorageSettingsSnapshots(
    beforeSnapshot,
    captureLocalStorageSettings(MAIN_CALENDAR_SETTINGS_KEYS)
  );
  let beforeKey = '';
  let afterKey = '';
  try {
    beforeKey = JSON.stringify(snapshots.before);
    afterKey = JSON.stringify(snapshots.after);
  } catch {}
  if (beforeKey && beforeKey === afterKey) return false;
  historyPush(
    label || 'カレンダー: メインカレンダー設定',
    () => restoreLocalStorageSettings(snapshots.before, _refreshMainCalendarSettingAfterHistory),
    () => restoreLocalStorageSettings(snapshots.after, _refreshMainCalendarSettingAfterHistory),
    'calendar:settings',
    detail || ''
  );
  return true;
}

// --- ホバー追加メニュー ---
function _cloudPhase1CreateItems(items) {
  return window.MeldexCloudBootstrap?.filterPhase1CreateItems?.(items) || items;
}

function _isCloudPhase1BlockedCreateType(type) {
  return !!window.MeldexCloudBootstrap?.isPhase1UnsupportedCreateType?.(type);
}

function _showCloudPhase1BlockedCreate(type) {
  if (window.MeldexCloudBootstrap?.showPhase1Unsupported) return window.MeldexCloudBootstrap.showPhase1Unsupported(type);
  showStatus('ブラウザ版Meldexではまだ未対応の作成タイプです', true);
  return false;
}

const _outlinerContextMenuCleanups = new Set();

function _outlinerEscHtml(value) {
  if (typeof esc === 'function') return esc(value);
  return String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));
}

function _outlinerMenuIconHtml(icon, size = 14) {
  if (!icon || typeof lucide !== 'function') return '';
  return '<span class="menu-icon">' + lucide(icon, size) + '</span>';
}

function _outlinerCreateContextMenu(label, x, y) {
  const menu = document.createElement('div');
  menu.className = 'gb-context-menu';
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', label);
  menu.style.left = x + 'px';
  menu.style.top = y + 'px';
  return menu;
}

function _outlinerCreateSubmenu(label) {
  const panel = document.createElement('div');
  panel.className = 'gb-context-menu';
  panel.setAttribute('role', 'menu');
  panel.setAttribute('aria-label', label);
  panel.style.cssText = 'display:none;min-width:140px;';
  return panel;
}

function _outlinerAppendMenuItem(menu, options) {
  const item = document.createElement('button');
  item.type = 'button';
  item.className = 'gb-context-menu-item' + (options?.danger ? ' danger' : '') + (options?.className ? ' ' + options.className : '');
  item.setAttribute('role', options?.role || 'menuitem');
  if (options?.disabled) {
    item.disabled = true;
    item.classList.add('disabled');
  }
  if (options?.title) {
    item.title = options.title;
    item.dataset.gbTooltip = options.title;
  }
  if (options?.checked) {
    item.classList.add('active');
    item.setAttribute('aria-checked', 'true');
  }
  if (options?.html != null) {
    item.innerHTML = options.html;
  } else {
    item.innerHTML = _outlinerMenuIconHtml(options?.icon) + '<span>' + _outlinerEscHtml(options?.label || '') + '</span>';
  }
  if (options?.hasSubmenu) {
    item.classList.add('has-submenu');
    item.setAttribute('aria-haspopup', 'menu');
    item.setAttribute('aria-expanded', 'false');
  }
  item.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (item.disabled) return;
    if (typeof options?.action === 'function') options.action(event);
  });
  menu.appendChild(item);
  return item;
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

function _showTreeAddMenu(x, y, nodeEl, nodeData) {
  closeTreeContextMenu();
  const menu = _outlinerCreateContextMenu('フォルダツリー新規作成', x, y);
  // シートを選んでいるときは、シートの中に作れる「エントリ」を先頭に出す。
  // ほかの項目はシートの中には作らず、シートと同じ階層に作る。
  if (nodeData?.type === 'database' && nodeData.path) {
    _outlinerAppendMenuItem(menu, {
      label: 'エントリ',
      icon: 'plus',
      action: async () => { closeTreeContextMenu(); await addSheetEntryAt(nodeData.path); },
    });
    _outlinerAppendMenuSeparator(menu);
  }
  _cloudPhase1CreateItems([['フォルダ','folder','folder'],['ノート','page','page'],['シナリオ','scriptnote','bookOpenText'],['シート','database','db'],['ボード','board','presentation'],['スマートシート','smart-db','databaseSearch']]).forEach(([label,type,icon]) => {
    _outlinerAppendMenuItem(menu, {
      label,
      icon,
      action: async () => {
        closeTreeContextMenu();
        await addItemAt(getAddParentPath(nodeEl, nodeData, { insideTarget: true, itemType: type }), type);
      },
    });
  });
  _outlinerPlaceContextMenu(menu);
}

// --- 右クリックメニュー ---
function closeTreeContextMenu() {
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

function showTreeContextMenu(x, y, nodeEl, nodeData, labelEl) {
  closeTreeContextMenu();
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
    const linkedDelete = await handleDisplayedFolderLinkDelete(targets, '', {
      refresh: async () => {
        if (typeof loadOutliner === 'function') await loadOutliner();
        if (typeof renderHomeFolderTree === 'function') renderHomeFolderTree();
        if (typeof renderWorkspaceSidebar === 'function') renderWorkspaceSidebar();
      },
    });
    if (linkedDelete.handled) {
      if (linkedDelete.result) treeSelection.clear();
      return;
    }
    const names = targets.map(item => item.name).join('、');
    const impactTargets = targets.map(item => ({ path: item.path, kind: item.type === 'folder' ? 'folder' : 'file' }));
    const confirmed = typeof MeldexDeleteImpactWarning !== 'undefined'
      ? await MeldexDeleteImpactWarning.confirmDeleteWithImpact(impactTargets, `「${names}」を削除しますか？`)
      : await cfConfirm(`「${names}」を削除しますか？`);
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
      showStatus(`${result.deletedCount || result.succeeded.length}件を削除、${result.failedCount}件は失敗しました`, true);
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
      onDelete: deleteContextItems,
      copyDisabled: contextOperationItems.length === 0,
      cutDisabled: editableContextItems.length === 0,
      pasteDisabled: !folderToolbarCanPasteTo(addParent),
      deleteDisabled: editableContextItems.length === 0,
    });
    addSep();
  }

  // --- 新規作成サブメニュー ---
  if (!(addParent && isItemLocked(addParent))) {
    const createPanel = _outlinerCreateSubmenu('フォルダツリー新規作成');
    _outlinerAppendSubmenu(menu, '新規作成', 'plus', createPanel);
    _cloudPhase1CreateItems([['フォルダ','folder','folder'],['ノート','page','page'],['シナリオ','scriptnote','bookOpenText'],['シート','database','db'],['ボード','board','presentation'],['スマートシート','smart-db','databaseSearch']]).forEach(([label,type,icon]) => {
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
        label: '右サイドバーで開く', icon: 'panelRight', action: () => {
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

  // --- 編集ロック ---
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
    addMenuItem('バージョンを保存', () => {
      closeTreeContextMenu();
      if (typeof saveFolderVersion === 'function') saveFolderVersion(nodeData.path);
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
      const linkPath = nodeData.path;
      const linkName = nodeData.name || linkPath.split(/[/\\]/).pop() || linkPath;
      if (typeof MeldexBroadcast !== 'undefined') {
        MeldexBroadcast.copyMeldexLink(linkName, linkPath, nodeData.type).then(ok => {
          if (ok) showStatus('リンクをコピーしました');
        });
      }
    }, null, 'link');
  }

  // --- リネーム（F2と同じ共通ヘルパー。単一選択時のみ、エントリ以外、ロック中は無効） ---
  if (!isMulti && !isEntity && !_locked && !nodeData._isRoot) {
    addMenuItem('リネーム', () => {
      closeTreeContextMenu();
      window.GBOutlinerActivation?.startRenameForNode(nodeEl, labelEl, nodeData);
    }, null, 'pencil');
  }

  // --- 複製 ---
  {
    // nodeDataとnodeElをペアで保持し、フィルタ後もインデックスがずれないようにする
    const dupPairs = isMulti
      ? [...treeSelection.items].filter(n => n._nodeData && n._nodeData.path && !n._nodeData._isRoot).map(n => ({ data: n._nodeData, el: n }))
      : (nodeData.path && !nodeData._isRoot ? [{ data: nodeData, el: nodeEl }] : []);
    if (dupPairs.length > 0) {
      const dupLabel = isMulti ? `複製（${dupPairs.length}件）` : '複製';
      addMenuItem(dupLabel, async () => {
        closeTreeContextMenu();
        let count = 0;
        for (const { data: d, el: srcEl } of dupPairs) {
          try {
            const res = await apiPost('/outliner/duplicate', { path: d.path });
            count++;
            const newItem = { ...d, name: res.new_name, path: res.new_path };
            if (res.file_id) newItem.file_id = res.file_id;
            else delete newItem.file_id;
            const parentChildren = srcEl?.parentElement;
            if (parentChildren) {
              const rootPath = srcEl.closest('#outliner-tree > .tree-node')?._nodeData?.path;
              const newNode = createTreeNodeFromBrowse(newItem, rootPath);
              srcEl.nextSibling ? parentChildren.insertBefore(newNode, srcEl.nextSibling) : parentChildren.appendChild(newNode);
            }
          } catch {}
        }
        if (count > 0) showStatus(`${count}件を複製しました`);
        else showStatus('複製に失敗しました', true);
      }, null, 'copy');
    }
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

  // --- お気に入り ---
  if (!isEntity && nodeData.path) {
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

  // --- 所属フォルダ（リンク登録） ---
  if (!isEntity && nodeData.path) {
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
