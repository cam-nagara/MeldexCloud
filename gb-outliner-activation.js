/**
 * gb-outliner-activation.js
 *
 * フォルダツリー（行・最近使った項目・お気に入り）の「選択」と「開く（アクティベーション）」を
 * 分離する共通モジュール。
 *
 * 計画: app/docs/folder-tree-thumbnail-large-branch-interaction-plan-2026-07-31.md
 *       §2.4（単クリック・ダブルクリック）、§4.1-1（選択・アクティベーション制御）
 *
 * 契約（§2.4 確定仕様）:
 * - 単クリック = 選択・フォーカス・オプションパネル対象の更新のみ。メインパネルは切り替えない。
 * - ダブルクリック／Enter／メニュー「開く」= 本モジュールの activateNode()/activateStoredItem() を
 *   一度だけ呼ぶ共通アクティベーション経路。開く処理を複数箇所に重複実装しない。
 * - F2／メニュー「名前を変更」= startRenameForNode()。ダブルクリックの名前変更割当は廃止。
 * - 型判定待ちの間に選択が別項目へ移った場合は、古い結果で前の項目を開かない
 *   （アクティベーション世代カウンタ + 呼び出し時点の対象ノード同一性の照合で判定する。
 *   .active CSS クラスには依存しない。右クリックメニュー「開く」・長押しメニュー・
 *   Ctrl/Shift+クリック直後のEnterなど、selectNodeOnly() を経由せず直接 activateNode() を
 *   呼ぶ入口では .active が一度も付与されないため、CSS クラス依存の判定は常に失敗していた）。
 * - OS関連付けアプリで開く形式（NATIVE_TYPES外）は、Desktopでは既存の安全な openNative 経路を
 *   既定の開く操作として使う。Cloud等で openNative が実行不能な環境では、開けない理由と
 *   代替操作を表示する。
 *
 * 依存（すべて実行時に参照する既存グローバル関数。読み込み順に依存しない）:
 * treeSelection, isItemLocked, startTreeLabelEdit, showStatus,
 * _applyCachedBrowseItemType, _browseItemNeedsTypeCheck, _resolveBrowseItemTypeOnDemand,
 * _syncOutlinerResolvedItemType, _captureBrowseItemPaneSnapshot, _browseItemPaneSnapshotIsCurrent,
 * _scheduleBrowseItemTypeResolution, _chatSetCurrentTargetPath, NATIVE_TYPES,
 * selectDatabase, selectEntity, openPage, openScenarioInScriptNote, openBoard, openCalendarFile,
 * openMedia, openHtmlFile, openCsvFile, openSmartDbFile, openFolder, openNative, isScriptNotePath,
 * _openStoredOutlinerItem, window.MeldexRuntimeAdapter
 */
(function () {
  'use strict';

  // ------------------------------------------------------------
  // クリックで開く設定（設定ダイアログ側が localStorage['gb:tree-open-click-mode'] に
  // 'single' | 'double' を書き込む。既定は 'single'=クリックで開く。明示的に 'double' が
  // 保存されている場合だけダブルクリックで開く（2026-08-05 既定値変更）。
  // フォルダ行本体・最近使った項目・お気に入りの各クリックハンドラから共通で参照する。
  // ------------------------------------------------------------
  const TREE_OPEN_CLICK_MODE_KEY = 'gb:tree-open-click-mode';

  function singleClickOpensItems() {
    try { return localStorage.getItem(TREE_OPEN_CLICK_MODE_KEY) !== 'double'; } catch (_) { return true; }
  }

  // ------------------------------------------------------------
  // アクティベーション世代ガード
  // ------------------------------------------------------------
  let _activationGeneration = 0;

  function nextGeneration() {
    return ++_activationGeneration;
  }

  function isCurrentGeneration(gen) {
    return gen === _activationGeneration;
  }

  // 型判定待ちの間に「選択だけ」が別項目へ移った場合に、古い結果で前の項目を開かないための
  // 「現在の対象ノード」トラッカー。selectNodeOnly()（単クリック／矢印キー選択）と
  // activateNode() 自身（ダブルクリック／Enter／メニュー「開く」など）の両方が、
  // 呼び出し時点で自分の対象ノードをここへ記録する。
  //
  // .active CSS クラスへ依存しないのは、右クリックメニュー「開く」・長押しメニュー・
  // Ctrl/Shift+クリック直後のEnterなど、selectNodeOnly() を経由せず直接 activateNode() を
  // 呼ぶ入口があるため（それらの入口では .active が一度も付与されず、CSS クラス依存の
  // 判定は常に無音失敗していた）。
  let _currentActivationTargetNode = null;

  const IMAGE_EXTS = new Set([
    '.png', '.apng', '.jpg', '.jpeg', '.jpe', '.jfif', '.gif', '.bmp', '.webp',
    '.svg', '.ico', '.avif', '.tif', '.tiff', '.heic', '.heif', '.psd', '.psb',
  ]);
  const VIDEO_EXTS = new Set(['.mp4', '.webm', '.mov', '.m4v', '.avi', '.mkv']);
  const AUDIO_EXTS = new Set(['.mp3', '.wav', '.ogg', '.m4a', '.flac']);

  function _pathExt(path) {
    const name = String(path || '').replace(/\\/g, '/').split('/').pop() || '';
    const index = name.lastIndexOf('.');
    return index >= 0 ? name.slice(index).toLowerCase() : '';
  }

  function _mediaTypeFromItem(item) {
    const type = item?.type || '';
    if (type === 'image' || type === 'video' || type === 'audio' || type === 'pdf') return type;
    const ext = _pathExt(item?.path || item?.name || '');
    if (ext === '.pdf') return 'pdf';
    if (IMAGE_EXTS.has(ext)) return 'image';
    if (VIDEO_EXTS.has(ext)) return 'video';
    if (AUDIO_EXTS.has(ext)) return 'audio';
    return '';
  }

  // ------------------------------------------------------------
  // 選択のみ（単クリック・矢印キー共通）
  // ------------------------------------------------------------

  // ツリー行の選択・フォーカス・オプションパネル対象の更新のみを行う。
  // メインパネルのタブ作成／切替・展開／折りたたみは一切行わない（§2.4）。
  function selectNodeOnly(nodeEl, options) {
    const opts = options || {};
    const row = nodeEl?.querySelector?.(':scope > .tree-node-row') || null;
    if (!nodeEl || !row) return false;
    if (opts.focus !== false) {
      try { row.focus({ preventScroll: true }); } catch {}
    }
    if (typeof treeSelection !== 'undefined') {
      treeSelection.clear();
      treeSelection.add(nodeEl);
      treeSelection.lastClicked = nodeEl;
    }
    document.querySelectorAll('.tree-node-row.active').forEach((r) => r.classList.remove('active'));
    row.classList.add('active');
    // 選択だけが別項目へ移ったことを型判定待ちのactivateNode()が検知できるよう記録する
    _currentActivationTargetNode = nodeEl;

    const item = nodeEl._nodeData || null;
    if (!item) return true;

    // 表示中アイコン・展開矢印の整合のためにキャッシュ済み型があれば即時反映
    if (typeof _applyCachedBrowseItemType === 'function' && _applyCachedBrowseItemType(item)) {
      if (typeof _syncOutlinerResolvedItemType === 'function') _syncOutlinerResolvedItemType(nodeEl, item);
    }
    // 型が未解決でも選択自体はブロックしない。オプションパネル反映用にバックグラウンドで解決する
    if (
      typeof _browseItemNeedsTypeCheck === 'function' && _browseItemNeedsTypeCheck(item)
      && item.type !== 'folder' && typeof _resolveBrowseItemTypeOnDemand === 'function'
    ) {
      Promise.resolve(_resolveBrowseItemTypeOnDemand(item)).then(() => {
        if (row.isConnected && row.classList.contains('active') && typeof _syncOutlinerResolvedItemType === 'function') {
          _syncOutlinerResolvedItemType(nodeEl, item);
        }
      }).catch(() => {});
    }

    const currentIsFolder = item.type === 'folder';
    const currentIsDB = item.type === 'database';
    if (typeof _chatSetCurrentTargetPath === 'function' && item.path) {
      _chatSetCurrentTargetPath(item.path, currentIsFolder || currentIsDB ? 'folder' : 'file', {
        reason: 'tree-select',
        deferAdoptSource: true,
      });
    }
    return true;
  }

  // ------------------------------------------------------------
  // アクティベーション（開く）— ダブルクリック／Enter／メニュー「開く」共通
  // ------------------------------------------------------------

  // ツリー行（フォルダツリー本体）のノードを一度だけ開く。
  async function activateNode(nodeEl, options) {
    const opts = options || {};
    const item = nodeEl?._nodeData || null;
    const row = nodeEl?.querySelector?.(':scope > .tree-node-row') || null;
    if (!item || !row || !item.path || item.needsMapping === true) return false;

    const gen = nextGeneration();
    // このアクティベーション呼び出し自身も「現在の対象」として記録する。
    // selectNodeOnly() を経由しない入口（右クリックメニュー「開く」・長押しメニュー・
    // Ctrl/Shift+クリック直後のEnter等）では、事前に対象ノードが記録されていないため。
    _currentActivationTargetNode = nodeEl;
    const paneSnapshot = typeof _captureBrowseItemPaneSnapshot === 'function'
      ? _captureBrowseItemPaneSnapshot('', { requirePath: false })
      : null;
    if (typeof _applyCachedBrowseItemType === 'function' && _applyCachedBrowseItemType(item)) {
      if (typeof _syncOutlinerResolvedItemType === 'function') _syncOutlinerResolvedItemType(nodeEl, item);
    }
    if (
      typeof _browseItemNeedsTypeCheck === 'function' && _browseItemNeedsTypeCheck(item)
      && item.type !== 'folder' && typeof _resolveBrowseItemTypeOnDemand === 'function'
    ) {
      await _resolveBrowseItemTypeOnDemand(item);
      // 型判定待ちの間に選択が別項目へ移った場合、古い結果で前の項目を開かない。
      // 呼び出し時点のノード同一性とアクティベーション世代の両方を照合する
      // （.active CSS クラスには依存しない。selectNodeOnly() を経由しない入口では
      // .active が一度も付与されないため、CSS クラス依存の判定は常に無音失敗していた）。
      if (!isCurrentGeneration(gen)) return false;
      if (!row.isConnected) return false;
      if (opts.requireActiveRow !== false && _currentActivationTargetNode !== nodeEl) return false;
      if (typeof _browseItemPaneSnapshotIsCurrent === 'function' && !_browseItemPaneSnapshotIsCurrent(paneSnapshot)) return false;
      if (typeof _browseItemNeedsTypeCheck === 'function' && !_browseItemNeedsTypeCheck(item) && typeof _syncOutlinerResolvedItemType === 'function') {
        _syncOutlinerResolvedItemType(nodeEl, item);
      }
    }

    const currentIsFolder = item.type === 'folder';
    const currentIsDB = item.type === 'database';
    const toggle = row.querySelector('.tree-toggle');
    const _expOpts = { fromExplorer: true, skipHighlight: true };

    if (typeof _chatSetCurrentTargetPath === 'function' && item.path) {
      _chatSetCurrentTargetPath(item.path, currentIsFolder || currentIsDB ? 'folder' : 'file', {
        reason: 'tree-activate',
        deferAdoptSource: true,
      });
    }

    if (currentIsDB) {
      if (typeof selectDatabase === 'function') selectDatabase(item.path, paneSnapshot?.paneContext || null, _expOpts);
    } else if (item.type === 'entity') {
      if (typeof selectEntity === 'function') selectEntity(item.path, _expOpts);
    } else if (item.type === 'page') {
      if (typeof openPage === 'function') openPage(item.name, item.path, _expOpts);
    } else if (item.type === 'scriptnote' || item.type === 'scenario' || (typeof isScriptNotePath === 'function' && isScriptNotePath(item.path))) {
      if (typeof openScenarioInScriptNote === 'function') openScenarioInScriptNote(item.path, item.name, _expOpts);
    } else if (item.type === 'board') {
      if (typeof openBoard === 'function') openBoard(item.name, item.path, _expOpts);
    } else if (item.type === 'calendar') {
      if (typeof openCalendarFile === 'function') {
        openCalendarFile(item.name, item.path, { ..._expOpts, paneContext: paneSnapshot?.paneContext || null });
      }
    } else {
      const mediaType = _mediaTypeFromItem(item);
      if (mediaType) {
        if (typeof openMedia === 'function') openMedia(item.name, item.path, mediaType, _expOpts);
      } else if (item.type === 'html') {
        if (typeof openHtmlFile === 'function') openHtmlFile(item.name, item.path, _expOpts);
      } else if (item.type === 'csv') {
        if (typeof openCsvFile === 'function') openCsvFile(item.name, item.path, _expOpts);
        else if (typeof openPage === 'function') openPage(item.name, item.path, _expOpts);
      } else if (item.type === 'smart-db') {
        if (typeof openSmartDbFile === 'function') openSmartDbFile(item.name, item.path, _expOpts);
      } else if (currentIsFolder) {
        let folderVisiblePromise = null;
        const mobileExplorer = window.MeldexCloudMobileExplorer;
        const handledByMobileExplorer = !!(
          window.MeldexCloudMobile?.shouldUseSidebarDrawer?.()
          && mobileExplorer?.selectFolderFromTree?.(item, { syncSelection: false })
        );
        if (!handledByMobileExplorer && typeof openFolder === 'function') {
          folderVisiblePromise = openFolder(item.name, item.path, _expOpts);
        }
        if (toggle && toggle.dataset.expanded !== 'true') toggle.click();
        const nodeSnapshot = typeof _captureBrowseItemPaneSnapshot === 'function'
          ? _captureBrowseItemPaneSnapshot(item.path, { requirePath: !handledByMobileExplorer })
          : null;
        if (typeof _scheduleBrowseItemTypeResolution === 'function') {
          _scheduleBrowseItemTypeResolution(nodeEl, item, folderVisiblePromise, {
            paneSnapshot: nodeSnapshot,
            isStillActive: handledByMobileExplorer
              ? () => mobileExplorer?.currentFolderTarget?.()?.path === item.path
              : undefined,
            onResolved: handledByMobileExplorer && typeof mobileExplorer?.handleResolvedItemType === 'function'
              ? (payload) => mobileExplorer.handleResolvedItemType(payload)
              : undefined,
          });
        }
      } else if (!(typeof NATIVE_TYPES !== 'undefined' && NATIVE_TYPES.has(item.type))) {
        // OS関連付けアプリで開く形式（clip, 3d等）。Desktopでは「アプリで開く」と同じ
        // 安全な openNative 経路を既定の開く操作として使う（計画§2.4）。Cloud等、
        // openNative が実行不能な環境では、現行どおり理由と代替操作を案内する。
        const isBrowserMode = !!(window.MeldexRuntimeAdapter?.isBrowserDataMode?.());
        if (!isBrowserMode && typeof openNative === 'function') {
          openNative(item.path);
        } else if (typeof showStatus === 'function') {
          showStatus((item.name || item.path) + ' — 「…」または長押しメニューからアプリで開く');
        }
      }
    }
    return true;
  }

  // 最近使った項目・お気に入りショートカット用の共通アクティベーション。
  // レコード形状は {name, path, type, label?} を想定する。
  async function activateStoredItem(record, options) {
    if (!record) return false;
    const opts = Object.assign({ fromExplorer: true }, options || {});
    if (typeof _openStoredOutlinerItem === 'function') {
      _openStoredOutlinerItem(record, opts);
      return true;
    }
    return false;
  }

  // ------------------------------------------------------------
  // 名前変更（F2／メニュー「名前を変更」共通）
  // ------------------------------------------------------------

  // ダブルクリックの名前変更割当は廃止済み。F2とコンテキストメニューの「名前を変更」から
  // このヘルパーを経由する。ルート・エントリ・編集ロック中・既に編集中は既存制限どおり拒否する。
  function startRenameForNode(nodeEl, labelEl, item) {
    if (!nodeEl || !labelEl || !item) return false;
    if (item.type === 'entity' || item._isRoot) return false;
    if (item.path && typeof isItemLocked === 'function' && isItemLocked(item.path)) return false;
    if (labelEl.querySelector('input')) return false; // 既にリネーム中
    if (typeof startTreeLabelEdit !== 'function') return false;
    startTreeLabelEdit(labelEl, item);
    return true;
  }

  window.GBOutlinerActivation = {
    nextGeneration,
    isCurrentGeneration,
    selectNodeOnly,
    activateNode,
    activateStoredItem,
    startRenameForNode,
    singleClickOpensItems,
  };
})();
