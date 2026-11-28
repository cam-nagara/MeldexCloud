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
      showAddFolderLinkModal(nodeData.path, null, { historyScope: '' });
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
    }
  }

  // OSシェルメニューは取得済みなら表示前に組み込む。未取得（PowerShell起動で1秒前後）の
  // 時はメニュー本体を待たせず即表示し、OS項目だけ表示後にメニュー下端へ追記する。
  if (!_locked && nodeData.path && window.MeldexArchiveTools?.desktop()) {
    const archiveItems = isMulti ? [...treeSelection.items].map(node => node._nodeData).filter(data => data?.path) : [nodeData];
    window.MeldexArchiveTools.appendMenu(menu, archiveItems, closeTreeContextMenu);
  }
  const shellPath = !isMulti && nodeData.path && typeof appendShellVerbsToMenu === 'function' ? nodeData.path : '';
  const shellReady = !!shellPath && typeof hasCachedShellVerbs === 'function' && hasCachedShellVerbs(shellPath);
  if (shellReady) {
    await appendShellVerbsToMenu(menu, shellPath, { editingLocked: _locked, beforeDisplay: true });
  }
  if (openSeq !== _outlinerContextMenuOpenSeq) return;
  _outlinerPlaceContextMenu(menu);
  if (shellPath && !shellReady) {
    appendShellVerbsToMenu(menu, shellPath, { editingLocked: _locked }).catch(() => {});
  }
}

// 追加先の親パスを決定
// シートの中に入れてよいのはエントリだけ。ボードやノートの作成先としてシートが
// 選ばれていた場合は、シート自身ではなくその親フォルダを作成先にする。
function _outlinerContainerAcceptsItemType(nodeData, itemType) {
  if (nodeData?.type !== 'database') return true;
  return String(itemType || '') === 'entity';
}

// シートの中へ移動してよい項目か。規則の正本は gb-sheet-attachments.js
// （デスクトップ版・クラウド版で共有するシートの共通規則）に置く。
function _outlinerItemFitsInSheet(nodeData) {
  return window.MeldexSheetAttachments?.itemFitsInSheet
    ? window.MeldexSheetAttachments.itemFitsInSheet(nodeData)
    : true;
}

function getAddParentPath(nodeEl, nodeData, options = {}) {
  const isContainer = nodeData.type === 'folder'
    || (nodeData.type === 'database' && _outlinerContainerAcceptsItemType(nodeData, options.itemType));
  if (isContainer && options.insideTarget && nodeData.path) return nodeData.path;
  if (nodeData._form_parent_path) {
    const path = String(nodeData.path || '').replace(/\\/g, '/');
    return path.slice(0, Math.max(0, path.lastIndexOf('/')));
  }
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

/* ==============================
   タイムアウト事後確認（作成・リネーム共通）
   ============================== */
// APIタイムアウト時のポーリング間隔。合計30秒で打ち切る
const OUTLINER_POST_TIMEOUT_CONFIRM_DELAYS_MS = [2000, 4000, 8000, 16000];
// 同一キーの事後確認ポーリングが二重に走らないようにする
const _outlinerPostTimeoutConfirmInFlight = new Set();

// E2Eから待機時間を短縮できるようにする（通常はundefinedで既定値）
function _outlinerPostTimeoutConfirmDelays() {
  const o = window.__outlinerPostTimeoutConfirmDelaysForE2E;
  return (Array.isArray(o) && o.length) ? o : OUTLINER_POST_TIMEOUT_CONFIRM_DELAYS_MS;
}

// 親フォルダの一覧をフロントキャッシュを避けて取得する（root/sourceIdはcontextNodeElの祖先から推定）
async function _outlinerFetchFolderListingForConfirm(parentPath, contextNodeEl, options = {}) {
  const sourceId = contextNodeEl?._nodeData?.sourceId || '';
  let rootPath = '';
  let cur = contextNodeEl || null;
  while (cur) {
    if (cur._nodeData?._isRoot) { rootPath = cur._nodeData.path; break; }
    cur = cur.parentElement ? cur.parentElement.closest('.tree-node') : null;
  }
  const rootParam = rootPath ? '&root=' + encodeURIComponent(rootPath) : '';
  const sourceParam = sourceId ? '&sourceId=' + encodeURIComponent(sourceId) : '';
  const controller = new AbortController();
  let timer;
  const timeout = new Promise(resolve => {
    timer = setTimeout(() => { controller.abort(); resolve(null); }, options.timeoutMs || 5000);
  });
  try {
    return await Promise.race([apiFetch('/browse?path=' + encodeURIComponent(parentPath || '') + rootParam + sourceParam + '&all_files=true&form_hierarchy=true' + (options.detail ? '&detail=true' : ''),
      { skipBrowseCache: true, cache: 'reload', timeoutMs: options.timeoutMs || 5000, signal: controller.signal }), timeout]);
  } catch {
    return null;
  } finally { clearTimeout(timer); }
}

// 一覧から旧名が消え新名が現れたことを確認する（リネームの事後確認用）。
// oldDisplayName は拡張子を含まない表示名（/browse の name と同じ規約）を渡すこと
function _outlinerFindRenamedItem(items, oldDisplayName, newName, originalPath) {
  if (!Array.isArray(items)) return null;
  // Title-only edits keep their path; another item may have the same display name.
  if (originalPath) {
    const original = items.find(it => it && it.path === originalPath);
    if (original) return original.name === newName ? original : null;
  }
  if (oldDisplayName && oldDisplayName !== newName && items.some(it => it && it.name === oldDisplayName)) return null;
  return items.find(it => it && it.name === newName) || null;
}

function _resolveOutlinerCreateInsertTarget(parentPath, options) {
  const expandUnloaded = options?.expandUnloaded !== false;
  if (options?.preferHome && parentPath === _homeFolderPath) {
    const home = document.getElementById('body-home');
    if (home) return { container: home, deferTreeInsert: false };
  }
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
    // 親ノードがDOM上に見つからず、ホームフォルダにも該当しない場合はルートへ誤挿入せず
    // 「挿入先不明」を返す。呼び出し元は誤挿入せず全体再読込に委ねる
    if (!container && !deferTreeInsert) return { container: null, deferTreeInsert: false };
  }
  if (!container && !deferTreeInsert) container = document.getElementById('outliner-tree');
  return { container, deferTreeInsert };
}

function _insertOutlinerCreateNode(container, newNode, anchorNode) {
  if (!container || !newNode) return;
  if (anchorNode && (container.parentElement === anchorNode
      || anchorNode._nodeData?.path === container.closest('.tree-node')?._nodeData?.path)) {
    container.insertBefore(newNode, container.firstChild);
    return;
  }
  const sel = anchorNode || treeSelection.lastClicked;
  if (sel && sel._nodeData && sel.parentElement === container) {
    const selType = sel._nodeData.type;
    if (anchorNode || (selType !== 'folder' && selType !== 'database')) {
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

function _openOutlinerCreatedNode(nd, name, options = {}) {
  const _expOpts = { fromExplorer: true };
  if (nd.type === 'page') openPage(name, nd.path, _expOpts);
  else if (nd.type === 'form-app') return openFormApp(nd.path, name, { ..._expOpts, ...options });
  else if (nd.type === 'map') openMapApp(nd.path, name, _expOpts);
  else if (nd.type === 'board') openBoard(name, nd.path, _expOpts);
  else if (nd.type === 'scriptnote' || (typeof isScriptNotePath === 'function' && isScriptNotePath(nd.path))) {
    if (typeof openScenarioInScriptNote === 'function') openScenarioInScriptNote(nd.path, name, _expOpts);
  }
  else if (nd.type === 'scenario') { if (typeof openScenarioInScriptNote === 'function') openScenarioInScriptNote(nd.path, name, _expOpts); }
  else if (nd.type === 'database') selectDatabase(nd.path, null, _expOpts);
  else if (nd.type === 'calendar') { if (typeof openCalendarFile === 'function') openCalendarFile(name, nd.path, _expOpts); }
}

function _outlinerCreateItemIdentity(type, name) {
  const normalizedType = String(type || '').trim();
  const normalizedName = String(name || '').trim();
  return normalizedType && normalizedName ? `${normalizedType}\n${normalizedName}` : '';
}

// 追加API呼び出し前の既存子ノード識別子（事後確認での新規判定に使用）。
// 「無題」のような同名項目は種類をまたいで共存できるため、名前だけでは比較しない。
function _outlinerSnapshotChildNames(container) {
  const names = new Set();
  container.querySelectorAll(':scope > .tree-node').forEach(node => {
    const d = node._nodeData;
    const identity = d && !d._pendingCreate
      ? _outlinerCreateItemIdentity(d.type, d.name)
      : '';
    if (identity) names.add(identity);
  });
  return names;
}

// 一覧からタイプが一致し事前集合に無い項目を探す（作成の事後確認用）。
// 事前集合が無い場合は新規判定ができないため常にnullを返す（誤検出防止）
function _outlinerFindNewItemInListing(items, type, existingNames) {
  if (!Array.isArray(items) || !(existingNames instanceof Set)) return null;
  return items.find(it => {
    if (!it || it.type !== type || !it.name) return false;
    const identity = _outlinerCreateItemIdentity(it.type, it.name);
    return identity && !existingNames.has(identity);
  }) || null;
}

// 事後確認で成功が判明した場合の反映（仮ノードを本ノードに置換）
function _outlinerApplyCreateSuccess(pendingNode, found, options) {
  if (!options?.skipStatus) showStatus(`「${found.name}」を作成しました`);
  if (!pendingNode || !pendingNode.parentNode) return;
  const newNode = createTreeNodeFromBrowse(found);
  pendingNode.replaceWith(newNode);
  _selectOutlinerCreateNode(newNode);
}

// 挿入先が解決できない場合の後始末（誤挿入せず全体再読込に委ねる）
async function _outlinerCreateFallbackToReload(pendingNode, nd, name, options) {
  if (pendingNode && pendingNode.parentNode) pendingNode.remove();
  await loadOutliner();
  _openOutlinerCreatedNode(nd, name, options);
}

// 作成APIタイムアウト時の事後確認: 親フォルダを再取得し、事前集合に無い同タイプの新項目を探す
async function _outlinerHandleCreateTimeout(pendingNode, parentPath, type, existingNames, onConfirmed) {
  const confirmKey = 'create:' + (pendingNode?.dataset?.path || (parentPath + '|' + type + '|' + Date.now()));
  if (_outlinerPostTimeoutConfirmInFlight.has(confirmKey)) return;
  _outlinerPostTimeoutConfirmInFlight.add(confirmKey);
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
    const res = await apiPost('/outliner/add', { type, label, parent: parentPath, ...(type === 'form-app' ? { include_form_content: true } : {}) });
    const formOpenOptions = type === 'form-app' && res.form_content?.path === res.node?.path
      ? { formCopyOpen: { file: res.form_content } } : undefined;
    // サーバーはlabelを返すが、createTreeNodeFromBrowseはnameを使う
    if (!res.node.name) res.node.name = res.node.label;
    const companions = Array.isArray(res.node.companion_paths) ? res.node.companion_paths.filter(Boolean) : [];
    if (res.node.path && companions.length && typeof _pushCreatedOutlinerItemsHistory === 'function') {
      // フォームは入力先のシートも一緒に作る。取り消しで両方をゴミ箱へ移す（以前はフォームだけが消え、
      // シートが残っていた: 2026-11-22 M-014 フォルダツリー網羅テスト）。
      _pushCreatedOutlinerItemsHistory([
        { path: res.node.path, type: res.node.type || type, kind: 'file' },
        ...companions.map(path => ({ path, type: 'database', kind: 'folder' })),
      ], '新規作成: ' + (res.node.name || label), createHistoryScope,
      type === 'form-app' ? { companionOwner: res.node.path } : {});
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
      _openOutlinerCreatedNode(res.node, res.node.name, formOpenOptions);
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
      await _outlinerCreateFallbackToReload(pendingNode, nd, name, formOpenOptions);
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
    if (type !== 'form-app') await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 0))));
    if (createVault !== (typeof state !== 'undefined' ? state.vaultPath : '')) return;
    // コンテンツを開く
    const opened = _openOutlinerCreatedNode(nd, name, formOpenOptions);
    if (type === 'form-app') {
      await opened;
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    }
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
