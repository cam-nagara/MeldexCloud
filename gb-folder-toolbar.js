(function(global) {
  'use strict';

  const CREATE_ITEMS = Object.freeze([
    ['フォルダ', 'folder', 'folder'],
    ['ノート', 'page', 'page'],
    ['シナリオ', 'scriptnote', 'bookOpenText'],
    ['シート', 'database', 'db'],
    ['ボード', 'board', 'presentation'],
    ['カレンダー', 'calendar', 'calendar'],
    ['スマートシート', 'smart-db', 'databaseSearch'],
    ['タイマー', 'timer', 'timer'],
  ]);

  let _folderToolbarClipboard = null;
  let _folderToolbarMenuCleanup = null;
  let _folderToolbarUpdateRaf = 0;
  let _folderToolbarWrappedBulkBar = false;

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
    const sorted = (items || [])
      .filter(item => item?.path)
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
      undo: document.getElementById('folder-toolbar-undo'),
      redo: document.getElementById('folder-toolbar-redo'),
    };
  }

  // フォルダ操作はグローバルスコープの共通履歴を使う（meldexUndo/meldexRedoに委譲）
  function folderToolbarUndo() {
    if (typeof meldexUndo === 'function') meldexUndo();
  }

  function folderToolbarRedo() {
    if (typeof meldexRedo === 'function') meldexRedo();
  }

  function _folderToolbarScheduleUpdate() {
    if (_folderToolbarUpdateRaf) return;
    _folderToolbarUpdateRaf = requestAnimationFrame(() => {
      _folderToolbarUpdateRaf = 0;
      updateFolderToolbarActions();
    });
  }

  function updateFolderToolbarActions() {
    const buttons = _folderToolbarButtons();
    if (!buttons.add) return;
    const selection = _folderToolbarSelectionItems();
    const hasSelection = selection.length > 0;
    const currentPath = _folderToolbarCurrentPath();
    const targetLocked = _folderToolbarIsLockedPath(currentPath);
    buttons.copy.disabled = !hasSelection;
    buttons.cut.disabled = !hasSelection || selection.some(item => item?.linked) || selection.every(_folderToolbarIsLockedItem);
    buttons.delete.disabled = !hasSelection || selection.every(_folderToolbarIsLockedItem);
    buttons.paste.disabled = !_folderToolbarClipboard?.items?.length || !currentPath || targetLocked;
    buttons.add.disabled = !currentPath || targetLocked;
    buttons.add.setAttribute('aria-expanded', document.querySelector('.folder-toolbar-create-menu') ? 'true' : 'false');
    // 取り消し・やり直しボタン展開: フォルダ操作はグローバルスコープの共通履歴を使うため、
    // ここでも一緒に有効/無効を更新する（data-undo-button/data-redo-button経由の一括更新と重複してもよい）
    if (typeof updateUndoRedoButtonStates === 'function') updateUndoRedoButtonStates();
  }

  async function _folderToolbarRefresh(preservePaths = []) {
    const folderPath = _folderToolbarCurrentPath();
    const refreshJobs = [];
    if (typeof loadOutliner === 'function') refreshJobs.push(Promise.resolve().then(() => loadOutliner()));
    if (typeof renderHomeFolderTree === 'function') refreshJobs.push(Promise.resolve().then(() => renderHomeFolderTree()));
    if (refreshJobs.length) await Promise.allSettled(refreshJobs);
    if (folderPath && typeof openFolder === 'function') {
      await openFolder(folderPath.split(/[\\/]/).pop() || folderPath, folderPath, {
        skipShowView: true,
        skipSaveLastView: true,
        skipNavPush: true,
        skipHighlight: true,
        skipGlobalUi: true,
      });
      if (preservePaths.length && typeof renderFolderGrid === 'function') {
        renderFolderGrid({ preserveSelectedPaths: preservePaths });
      }
    }
    _folderToolbarScheduleUpdate();
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
      const parent = _folderToolbarCurrentPath();
      _folderToolbarCloseMenus({ restoreFocus: true });
      if (!parent) return;
      if (_folderToolbarIsLockedPath(parent)) {
        showStatus('編集ロック中のフォルダには作成できません', true);
        return;
      }
      try {
        const res = await apiPost('/outliner/add', { type, label: '無題', parent });
        const node = res?.node || {};
        const name = node.name || node.label || '無題';
        await _folderToolbarRefresh(node.path ? [node.path] : []);
        showStatus((node.type === 'folder' ? 'フォルダ' : 'ファイル') + 'を作成しました: ' + name);
      } catch (e) {
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
    updateFolderToolbarActions();
  }

  function folderToolbarCutSelection() {
    folderToolbarCutItems(_folderToolbarSelectionItems());
  }

  function folderToolbarCanPasteTo(destFolder) {
    return !!(
      _folderToolbarClipboard?.items?.length
      && destFolder
      && !_folderToolbarIsLockedPath(destFolder)
    );
  }

  async function folderToolbarPasteToFolder(destFolder, options = {}) {
    const clip = _folderToolbarClipboard;
    if (!clip?.items?.length || !destFolder) return;
    if (typeof executeFolderPasteWithChoice === 'function') {
      await executeFolderPasteWithChoice(clip, destFolder, {
        ...options,
        refresh: typeof options.refresh === 'function' ? options.refresh : _folderToolbarRefresh,
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
          const res = await apiPost('/outliner/move', { path: item.path, dest_folder: destFolder });
          if (res?.new_path && typeof renameAppPathReferences === 'function') {
            renameAppPathReferences(oldPath, res.new_path, { label: res.new_name || item.name, fileId: res.file_id, type: item.type || 'page' });
          }
          if (typeof handleRelocateResponse === 'function') handleRelocateResponse(res);
          pastedPaths.push(res?.new_path || item.path);
        } else {
          const res = await apiPost('/outliner/save-as', { path: item.path, dest_folder: destFolder });
          pastedPaths.push(res?.new_path || '');
        }
      } catch {
        failed.push(item);
      }
    }
    if (clip.mode === 'cut') {
      _folderToolbarClipboard = failed.length ? { mode: 'cut', items: failed } : null;
    }
    const refresh = typeof options.refresh === 'function' ? options.refresh : _folderToolbarRefresh;
    await refresh(pastedPaths.filter(Boolean));
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
    const impactTargets = topLevelTargets.map(item => ({
      path: item.path,
      kind: item.type === 'folder' ? 'folder' : 'file',
      ...((item.assetId || item.asset_id) ? { assetId: String(item.assetId || item.asset_id) } : {}),
    }));
    const confirmMessage = topLevelTargets.length + ' 件を削除しますか？';
    const confirmed = typeof MeldexDeleteImpactWarning !== 'undefined'
      ? await MeldexDeleteImpactWarning.confirmDeleteWithImpact(impactTargets, confirmMessage)
      : await cfConfirm(confirmMessage);
    if (!confirmed) return;
    const result = await deleteOutlinerItemsWithHistory(topLevelTargets, {
      confirmation: confirmed,
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
    button.addEventListener('click', handler);
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
    document.querySelectorAll('.folder-toolbar-sort-menu').forEach(menu => menu.remove());
  }

  function _folderToolbarMenuItem(menu, label, icon, action, active) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'gb-context-menu-item tree-ctx-item';
    button.setAttribute('role', 'menuitemradio');
    button.setAttribute('aria-checked', active ? 'true' : 'false');
    button.innerHTML = _folderToolbarIcon(icon || 'arrowUpDown', 14)
      + '<span>' + (active ? '✓ ' : '') + (typeof esc === 'function' ? esc(label) : label) + '</span>';
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
    document.body.appendChild(menu);
    const rect = event.currentTarget.getBoundingClientRect();
    if (typeof positionPopup === 'function') positionPopup(menu, rect, { prefer: 'below', gap: 4 });
    else {
      menu.style.left = rect.left + 'px';
      menu.style.top = rect.bottom + 4 + 'px';
    }
    setTimeout(() => document.addEventListener('pointerdown', function closer(pointerEvent) {
      if (menu.contains(pointerEvent.target) || event.currentTarget.contains(pointerEvent.target)) return;
      document.removeEventListener('pointerdown', closer, true);
      menu.remove();
    }, true), 0);
  }

  async function toggleFolderSubfolderContents() {
    const enabled = !(typeof isFolderSubfolderContentsEnabled === 'function' && isFolderSubfolderContentsEnabled());
    if (typeof setFolderSubfolderContentsEnabled === 'function') setFolderSubfolderContentsEnabled(enabled);
    syncFolderSubfolderContentsButtons();
    const folderPath = _folderToolbarCurrentPath();
    if (folderPath && typeof openFolder === 'function') {
      const label = document.getElementById('folder-title')?.textContent || folderPath;
      await openFolder(label, folderPath, {
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
    syncFolderSubfolderContentsButtons();
  }

  function initFolderToolbarActions() {
    const buttons = _folderToolbarButtons();
    if (!buttons.add) return;
    _folderToolbarBindButton(buttons.add, 'plus', showFolderToolbarAddMenu);
    _folderToolbarBindButton(buttons.copy, 'copy', folderToolbarCopySelection);
    _folderToolbarBindButton(buttons.cut, 'scissors', folderToolbarCutSelection);
    _folderToolbarBindButton(buttons.paste, 'clipboardPaste', folderToolbarPasteSelection);
    _folderToolbarBindButton(buttons.delete, 'trash2', folderToolbarDeleteSelection);
    _folderToolbarBindButton(buttons.undo, 'undo2', folderToolbarUndo);
    _folderToolbarBindButton(buttons.redo, 'redo2', folderToolbarRedo);
    _folderToolbarInstallExtraControls();
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
  global.showFolderToolbarAddMenu = showFolderToolbarAddMenu;
  global.folderToolbarCopySelection = folderToolbarCopySelection;
  global.folderToolbarCutSelection = folderToolbarCutSelection;
  global.folderToolbarPasteSelection = folderToolbarPasteSelection;
  global.folderToolbarDeleteSelection = folderToolbarDeleteSelection;
  global.folderToolbarCopyItems = folderToolbarCopyItems;
  global.folderToolbarCutItems = folderToolbarCutItems;
  global.folderToolbarCanPasteTo = folderToolbarCanPasteTo;
  global.folderToolbarPasteToFolder = folderToolbarPasteToFolder;
  global.appendFolderOperationButtons = appendFolderOperationButtons;
  global.showFolderToolbarSortMenu = showFolderToolbarSortMenu;
  global.toggleFolderSubfolderContents = toggleFolderSubfolderContents;
  global.syncFolderSubfolderContentsButtons = syncFolderSubfolderContentsButtons;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initFolderToolbarActions, { once: true });
  } else {
    initFolderToolbarActions();
  }
})(window);
