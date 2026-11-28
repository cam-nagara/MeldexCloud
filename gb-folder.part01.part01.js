/**
 * Meldex Folder View
 * フォルダビュー、プレビュー、パネル管理
 */

/* ==============================
   フォルダビュー
   ============================== */
// ファイルタイプアイコン（Lucide SVG）
// fileTypeIcon は meldex-core.js で定義済み
// FILE_TYPE_LABELS は meldex-core.js で定義済み
// NATIVE_TYPES は meldex-core.js で定義済み

function _isFolderFreeLayoutUiEnabled() {
  if (typeof GBLayout === 'undefined') return true;
  return typeof GBLayout.isFreeLayoutUiEnabled === 'function'
    ? !!GBLayout.isFreeLayoutUiEnabled()
    : true;
}

function _openFolderInMobileExplorer(label, path, openOpts) {
  if (!path || !openOpts?.fromExplorer || openOpts.skipShowView || openOpts.skipMobileExplorer) return false;
  if (!window.MeldexCloudMobile?.shouldUseSidebarDrawer?.()) return false;
  const explorer = window.MeldexCloudMobileExplorer;
  if (!explorer?.selectFolderFromTree) return false;
  const name = label || String(path).split(/[\\/]/).filter(Boolean).pop() || 'フォルダ';
  explorer.selectFolderFromTree({ name, label: name, path, type: 'folder' }, {
    renderList: true,
    force: true,
  });
  window.MeldexCloudMobile?.openSidebar?.(false);
  explorer.setMode?.('list', { syncFromTree: false, force: true });
  explorer.renderCurrent?.({ force: true });
  return true;
}

// 描画先の解決を1か所へ集約する（ボードのリンクカード計画 Phase B-2）。override
// （サブパネル等の専用DOM）があればそれ、無ければ共有の#folder-gridを返す。
// 判定をここ以外に増やさない（増やすと3つ目の面が出たときに同じ事故が再発する）。
// 例外: 起動時に一度だけ実グリッドへ結線する永続リスナー（ラッソ/空域クリック/
// Ctrl+ホイールズーム）と、メイン画面をリセットする renderFolderInitialPrompt() は
// 意図的にこのヘルパーを経由せず常に実グリッドを指す（overrideが有効な間でも
// メイン画面固有の操作は必ずメイン画面のグリッドへ作用させるため）。
// サブパネルを閉じると専用DOMは切り離される（GBSubPanel._retractCurrentContent）。
// overrideが切り離されたDOMを指したまま残ると、以降のメイン画面側の再描画
// （並べ替え・絞り込み・レイアウト変更・削除など）が画面のどこにも現れなくなる。
// 参照の生死をここで自己修復し、切り離されていれば共有グリッドへ戻す。
function _folderResolveRenderOverride() {
  if (_folderRenderContainerOverride && !_folderRenderContainerOverride.isConnected) {
    _folderRenderContainerOverride = null;
  }
  return _folderRenderContainerOverride;
}

function _folderGridEl() {
  return _folderResolveRenderOverride() || document.getElementById('folder-grid');
}

function _folderIsIndependentSurface() {
  return !!_folderResolveRenderOverride();
}

function _folderUpdateStatusCounts(items) {
  // ステータスバーの件数は、利用者が操作している面のものだけを出す（他の面の裏の読み直しでは書き換えない）
  if (typeof _folderInteractionSurface !== 'undefined'
      && (_folderRenderContainerOverride || null) !== (_folderInteractionSurface || null)) return;
  const list = Array.isArray(items) ? items : [];
  const folderCount = list.reduce((count, item) => count + (item?.type === 'folder' ? 1 : 0), 0);
  const fileCount = list.length - folderCount;
  const countEl = document.getElementById('sb-count');
  if (countEl) countEl.textContent = `フォルダ ${folderCount} / ファイル ${fileCount}`;
}

async function openFolder(label, path, opts) {
  const openOpts = opts || {};
  if (window.MeldexArchiveBrowser) window.MeldexArchiveBrowser.clear();
  if (_openFolderInMobileExplorer(label, path, openOpts)) return true;
  const showOpenLoading = !openOpts.silent
    && !openOpts.skipGlobalUi
    && typeof showLoading === 'function'
    && typeof hideLoading === 'function';
  let loadingShown = false;
  let loading = null;
  const displayLabel = _folderDisplayLabel(label, path);
  const folderLoadSeq = (window._openFolderLoadSeq || 0) + 1;
  window._openFolderLoadSeq = folderLoadSeq;
  const isStaleFolderLoad = () => (typeof openOpts.isLegacyLoadCurrent === 'function' && !openOpts.isLegacyLoadCurrent())
    || !enterFolderSurface()
    || _folderPath !== path;
  // 面（メイン／サブパネル等の独立した描画先）ごとに状態を持つ（gb-folder.part01.part00.js）。containerEl 指定時は
  // その描画先の面、無ければメインの面をつないでから読み込む。別の面が表示しているフォルダは奪わない。
  // 読み込みの続き（待った後）は、毎回 isStaleFolderLoad() が自分の面をつなぎ直してから進む。
  const nextRenderOverride = openOpts.containerEl || null;
  const surfaceAware = typeof _folderBindSurface === 'function';
  const surfaceKey = nextRenderOverride || 'main';
  if (surfaceAware) {
    _folderSurfaceLoadSeq.set(surfaceKey, folderLoadSeq);
    // 開いた面を操作対象にする（他の面の読み直し等、利用者の操作でない読み込みは操作対象を変えない）
    if (!openOpts.keepInteractionSurface) _folderActivateSurface(nextRenderOverride);
  } else _folderRenderContainerOverride = nextRenderOverride;
  function enterFolderSurface() {
    if (!surfaceAware) return window._openFolderLoadSeq === folderLoadSeq;
    return _folderSurfaceLoadSeq.get(surfaceKey) === folderLoadSeq && _folderEnterSurface(nextRenderOverride);
  }
  if (!enterFolderSurface()) return false;
  const switchingFolder = _folderPath !== path;
  const folderLoadingGrid = _folderGridEl();
  if (folderLoadingGrid) folderLoadingGrid.setAttribute('aria-busy', 'true');
  // 別のフォルダへ切り替える時は、読み込みが終わるまで前のフォルダの中身（空なら「このフォルダは空です」）を
  // 残さず「読み込み中...」にする。大きなフォルダ（数千件）では読み込みに数秒かかり、その間「空です」と
  // 前のフォルダの表示が出ていた（2026-11-22 M-014 フォルダの横断の検査: 三千件のフォルダ）。
  if (switchingFolder && !Array.isArray(openOpts.items)) {
    const loadingGrid = _folderGridEl();
    if (loadingGrid) {
      loadingGrid.innerHTML = '';
      const loadingState = document.createElement('div');
      loadingState.className = 'fv-loading-state';
      loadingState.style.cssText = 'padding:24px;color:var(--fg2);';
      loadingState.setAttribute('role', 'status');
      loadingState.textContent = '読み込み中...';
      loadingGrid.appendChild(loadingState);
    }
    _folderItems = [];
    _folderVisibleItems = [];
  }
  let hadError = false;
  try {
    if (showOpenLoading) { loading = showLoading('フォルダを読み込み中...', { key: 'folder:' + path }); loadingShown = true; }
    if (typeof _primeFileLockCacheFromStorage === 'function') _primeFileLockCacheFromStorage();
    if (!openOpts.skipGlobalUi && typeof clearFileStyleForPanel === 'function') clearFileStyleForPanel('folder-view');
    _folderPath = path;
    _folderBrowseIncomplete = null;
    clearTimeout(_folderUnifiedSearchTimer);
    _folderUnifiedSearchTimer = 0;
    ++_folderUnifiedSearchSeq;
    _folderUnifiedSearchPaths = new Set();
    if (switchingFolder) {
      _folderSelected = null;
      _folderSelectedItems = [];
    }
    if (!openOpts.skipShowView) showView('folder');
    if (!openOpts.skipGlobalUi && typeof applyFolderFileStyle === 'function') applyFolderFileStyle(path);
    if (!openOpts.skipGlobalUi) {
      const folderTitleEl = document.getElementById('folder-title');
      if (folderTitleEl) folderTitleEl.textContent = displayLabel;
      window.MeldexFileLockBadge?.apply?.(folderTitleEl, path);
    }
    const currentTitleEl = document.getElementById('current-title');
    if (currentTitleEl && !openOpts.skipGlobalUi) currentTitleEl.textContent = displayLabel;
    if (!openOpts.skipSaveLastView) saveLastView({type:'folder', label: displayLabel, path});
    if (!openOpts.skipNavPush) {
      const _navEntry = {type:'folder', label: displayLabel, path};
      navPush(_navEntry);
    }
    // フォルダパネルを開くだけではツリーの展開・全祖先探索を行わない。
    // 明示的な「フォルダツリーで表示」は gb-current-reveal.js が担当する。
    if (openOpts.revealInTree) _syncFolderPanelPathToOutliner(path, { noScroll: !!openOpts.noScrollHighlight });

    // 表示形式・表示設定はフォルダごと（gb-folder-display-settings.js）。一覧の取得と並行して読み、描画の前に反映する。
    const folderDisplayReady = window.MeldexFolderDisplaySettings?.activate?.(path, { isCurrent: () => !isStaleFolderLoad() });
    const listingStartedAt = Date.now();
    // 大きなフォルダ（項目数がしきい値を超える）は、一覧をページごとに取り、見えている範囲だけ描く（gb-folder-large.js）。
    // 小さなフォルダ・確認できない時は false が返り、従来どおり全件を取って描く。
    const openedLarge = !Array.isArray(openOpts.items) && globalThis.MeldexFolderLarge
      ? await globalThis.MeldexFolderLarge.open(path, {
        isCurrent: () => !isStaleFolderLoad(), displayReady: folderDisplayReady, resetScroll: switchingFolder,
        selectedPaths: Array.isArray(openOpts.selectedPaths) || openOpts.selectedPath !== undefined
          ? [...(Array.isArray(openOpts.selectedPaths) ? openOpts.selectedPaths : []), openOpts.selectedPath].filter(Boolean) : undefined,
      })
      : (globalThis.MeldexFolderLarge?.deactivate?.(), false);
    if (isStaleFolderLoad()) return;
    if (!openedLarge) {
    let fetchedItems = Array.isArray(openOpts.items)
      ? openOpts.items.slice()
      : (typeof _folderFetchBrowseItems === 'function'
        ? await _folderFetchBrowseItems(path, { isCurrent: () => !isStaleFolderLoad() })
        : await apiFetch('/browse?path=' + encodeURIComponent(path) + '&detail=true&all_files=true&form_hierarchy=true'));
    const browseIncomplete = fetchedItems._folderBrowseIncomplete || null;
    if (typeof isOutlinerDeletePendingPath === 'function') {
      fetchedItems = fetchedItems.filter(item => !isOutlinerDeletePendingPath(item?.path));
    }
    if (folderDisplayReady) await folderDisplayReady;
    if (isStaleFolderLoad()) return;
    // 一覧の取得中に名前の変更・移動が確定していたら、届いた一覧は古い。古い名前のまま描くと、
    // そのカードへのドロップが存在しない場所への移動になる（2026-11-24 利用者の報告）。
    if (!Array.isArray(openOpts.items)) fetchedItems = _folderApplyPathChangesSince(fetchedItems, listingStartedAt);
    _folderItems = fetchedItems;
    _folderBrowseIncomplete = browseIncomplete;
    _folderUpdateStatusCounts(_folderItems);
    if (typeof _registerFileIds === 'function') _registerFileIds(_folderItems);
    if (showOpenLoading && typeof showLoadingBeforeHeavyWork === 'function') {
      await showLoadingBeforeHeavyWork(_folderItems.length, '大きいフォルダを描画中...', { threshold: 80, loading });
      if (isStaleFolderLoad()) return;
    }
    registerFileTypes(_folderItems);
    const requestedSelectedPaths = [
      ...(Array.isArray(openOpts.selectedPaths) ? openOpts.selectedPaths : []),
      openOpts.selectedPath,
    ].filter(Boolean);
    const openSelectedPaths = Array.isArray(openOpts.selectedPaths) || openOpts.selectedPath !== undefined
      ? requestedSelectedPaths : switchingFolder ? [] : (_folderSelectedItems || []).map(item => item?.path).filter(Boolean);
    await renderFolderGrid({ preserveSelectedPaths: openSelectedPaths });
    }
    if (isStaleFolderLoad()) return;
    // 直接フォルダを開いた経路も、実際に描画済みの対象を記録する。
    // 他の面の開閉でpane-bridgeが未描画と誤認し、一覧を作り直さないため。
    const liveFolderView = _folderGridEl()?.closest('#folder-view');
    if (liveFolderView && !openOpts.containerEl) {
      liveFolderView.dataset.path = path;
      liveFolderView.dataset.gbLegacyView = 'folder';
      liveFolderView.dataset.gbLegacyPath = path;
    }
    const searchConfig = getFolderDisplayConfig();
    if (!openedLarge && (searchConfig.filterText || _folderSearchRowHasTagCondition())) {
      _refreshFolderUnifiedSearch(searchConfig.filterText || '');
    }
    if (!openOpts.skipGlobalUi) showStatus('フォルダ: ' + displayLabel);
    if (typeof _scheduleFileLockRefreshForOutliner === 'function') _scheduleFileLockRefreshForOutliner();
  } catch (e) {
    if (isStaleFolderLoad()) return;
    hadError = true;
    globalThis.MeldexFolderLarge?.deactivate?.();
    _folderItems = [];
    _folderUpdateStatusCounts(_folderItems);
    _folderSelected = null;
    _folderSelectedItems = [];
    const folderGridEl = _folderGridEl();
    if (folderGridEl) folderGridEl.innerHTML = '<div style="padding:24px;color:var(--fg2);">読み込みに失敗しました</div>';
    if (!_folderIsIndependentSurface()) {
      const folderCountEl = document.getElementById('folder-item-count');
      if (folderCountEl) folderCountEl.textContent = '0 項目';
    }
    if (!openOpts.skipGlobalUi && typeof showStatus === 'function') {
      showStatus('フォルダ読み込みエラー: ' + (e?.message || e), true);
    }
  } finally {
    if (folderLoadingGrid && (!isStaleFolderLoad() || _folderGridEl() !== folderLoadingGrid)) folderLoadingGrid.removeAttribute('aria-busy');
    if (loadingShown) {
      hideLoading(loading);
    }
  }
  if (!openOpts.skipGlobalUi) _syncDetailPanel(displayLabel, path, 'folder');
  if (!openOpts.skipGlobalUi && !hadError && !isStaleFolderLoad()) {
    // 一覧の読込でフォルダIDが確定した後、早い段階で作った設定欄を接続し直す。
    if (typeof applyFolderFileStyle === 'function') applyFolderFileStyle(path);
    if (typeof _refreshFileThemeTargetBindings === 'function') _refreshFileThemeTargetBindings();
  }
  // サブパネル（_mountFolder）が読み込み失敗を検知して再読み込みボタン付きの
  // エラー表示へ切り替えられるよう、CSV/ノートと同じくfalseを返す（成功時はtrue）。
  // 既存の呼び出し元は戻り値を使っていない（folderVisiblePromiseは _waitForBrowseItemVisible
  // 経由でfulfilled/rejected双方をtrueへ丸めるため、値そのものは参照されない）。
  return !hadError;
}

function renderFolderInitialPrompt() {
  // メインのフォルダパネルを初期表示へ戻す。サブパネル等の面をつないでいる間は、メインの面へつないで行う。
  if (typeof _folderOnSurface === 'function' && _folderRenderContainerOverride) { _folderOnSurface(null, renderFolderInitialPrompt); return; }
  globalThis.MeldexFolderLarge?.deactivate?.();
  _folderPath = '';
  _folderItems = [];
  _folderBrowseIncomplete = null;
  _folderVisibleItems = [];
  _folderSelected = null;
  _folderSelectedItems = [];
  _folderUpdateStatusCounts(_folderItems);
  const titleEl = document.getElementById('folder-title');
  if (titleEl) titleEl.textContent = 'フォルダ';
  window.MeldexFileLockBadge?.apply?.(titleEl, '');
  const currentTitleEl = document.getElementById('current-title');
  if (currentTitleEl) currentTitleEl.textContent = 'フォルダ';
  const countEl = document.getElementById('folder-item-count');
  if (countEl) countEl.textContent = '0 項目';
  if (typeof _updateFolderBulkBar === 'function') _updateFolderBulkBar();
  if (typeof applyFvPanelLayout === 'function') applyFvPanelLayout();

  const grid = document.getElementById('folder-grid');
  if (!grid) return;
  grid.className = FOLDER_LAYOUT_CLASSES[_folderLayout] || 'grid-layout';
  grid.innerHTML = '';
  grid.scrollTop = 0;

  const empty = document.createElement('div');
  empty.className = 'gb-empty-state';
  empty.style.cssText = 'min-height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;color:var(--fg2);gap:10px;padding:32px;';
  const icon = document.createElement('div');
  icon.className = 'gb-empty-icon';
  icon.style.color = 'var(--fg2)';
  icon.innerHTML = typeof lucide === 'function' ? lucide('folderOpen', 48) : '';
  const message = document.createElement('div');
  message.className = 'gb-empty-message';
  message.style.cssText = 'color:var(--fg);font-size:15px;';
  message.textContent = 'フォルダツリーでフォルダかファイルを選択してください';
  const hint = document.createElement('div');
  hint.className = 'gb-empty-hint';
  hint.style.cssText = 'font-size:13px;line-height:1.6;';
  hint.textContent = '選択したフォルダ、または選択したファイルのあるフォルダをここに表示します。';
  empty.appendChild(icon);
  empty.appendChild(message);
  empty.appendChild(hint);
  grid.appendChild(empty);
}

function setFolderLayout(mode) {
  _folderLayout = mode;
  // 表示形式は開いているフォルダに保存する。フォルダを開いていない時だけ全体の初期値を変える。
  if (!window.MeldexFolderDisplaySettings?.update?.({ layout: mode })) localStorage.setItem('folder-layout', mode);
  const select = document.getElementById('folder-layout-select');
  if (select) select.value = mode;
  window.MeldexCloudMobileExplorer?.syncLayoutFromFolder?.(mode);
  // 表示形式を変えても選択は残す（以前は描き直しで選択が消えていた: 2026-11-22 M-014 フォルダパネル網羅テスト）
  const keepSelected = (Array.isArray(_folderSelectedItems) ? _folderSelectedItems : []).map(item => item?.path).filter(Boolean);
  renderFolderGrid(keepSelected.length ? { preserveSelectedPaths: keepSelected } : undefined);
}

function toggleFolderPreview() {
  // 新パネルシステムのプレビュー＋詳細をまとめてトグル
  const cfg = _getFvPanelCfg();
  const anyVisible = (cfg.previewVisible ?? false) || (cfg.detailVisible ?? false);
  cfg.previewVisible = !anyVisible;
  cfg.detailVisible = !anyVisible;
  _saveFvPanelCfg(cfg);
  if (!anyVisible && _folderSelected) showFolderPreview(_folderSelected);
  else applyFvPanelLayout();
}

// ウォーターフォール: JSで位置計算（Pinterest風）
// ウォーターフォールのリサイズ監視
let _waterfallResizeOb = null;
let _waterfallLayoutRaf = 0;
let _waterfallObservedWidth = 0;

function _disconnectWaterfallResizeObserver() {
  if (_waterfallResizeOb) {
    _waterfallResizeOb.disconnect();
    _waterfallResizeOb = null;
  }
  _waterfallObservedWidth = 0;
}

function _scheduleWaterfallLayout() {
  if (_waterfallLayoutRaf) return;
  const surface = _folderResolveRenderOverride() || null;
  const run = () => {
    // 予約した面（メイン／サブパネル）をつないでから配置する
    if (!_folderEnterSurface(surface)) return;
    _waterfallLayoutRaf = 0;
    applyWaterfallLayout();
  };
  if (typeof requestAnimationFrame === 'function') {
    _waterfallLayoutRaf = requestAnimationFrame(run);
  } else {
    _waterfallLayoutRaf = setTimeout(run, 0);
  }
}

function _ensureWaterfallResizeObserver() {
  const grid = _folderGridEl();
  if (!grid) return;
  _disconnectWaterfallResizeObserver();
  if (grid.classList.contains('waterfall-layout')) {
    const target = grid.parentElement || grid;
    _waterfallObservedWidth = _waterfallElementWidth(target) || _waterfallElementWidth(grid);
    const observedSurface = _folderResolveRenderOverride() || null;
    _waterfallResizeOb = new ResizeObserver(entries => {
      if (!_folderEnterSurface(observedSurface)) return;
      const width = _waterfallElementWidth(target) || _waterfallElementWidth(grid);
      const cardsChanged = entries.some(entry => entry.target !== target);
      if (width === _waterfallObservedWidth && !cardsChanged) return;
      _waterfallObservedWidth = width;
      // サムネイルの後挿入、文字の折返し・フォント、付加情報もカード全体の寸法で検知する。
      // 描画前の通知内で配置を確定し、次のフレームまで重なった状態を見せない。
      applyWaterfallLayout();
    });
    _waterfallResizeOb.observe(target);
    grid.querySelectorAll('.fv-item').forEach(item => _waterfallResizeOb.observe(item));
  }
}

function _setStyleIfChanged(el, property, value) {
  if (!el || el.style[property] === value) return;
  el.style[property] = value;
}

function _waterfallElementWidth(el) {
  const rect = el?.getBoundingClientRect?.();
  return Math.round(rect?.width || el?.offsetWidth || el?.clientWidth || 0);
}

function applyWaterfallLayout() {
  const grid = _folderGridEl();
  if (!grid || !grid.classList.contains('waterfall-layout')) return;
  const items = Array.from(grid.querySelectorAll('.fv-item'));
  if (items.length === 0) return;
  // 別の面が全画面になって幅が0の間は、最後の配置とスクロール範囲を維持する。
  // 表示へ戻った時のResizeObserver通知で、実寸を使って再配置する。
  const gridWidth = _waterfallElementWidth(grid);
  if (gridWidth <= 0) return;
  const gap = 3;
  const colW = parseInt(getComputedStyle(grid).getPropertyValue('--fv-card-w')) || 120;
  const containerW = gridWidth - 24; // padding考慮
  const cols = Math.max(1, Math.floor((containerW + gap) / (colW + gap)));
  const warning = grid.querySelector('.fv-browse-warning');
  const colHeights = new Array(cols).fill(warning ? warning.offsetHeight + gap : 0);

  // 書き込みと読み取りを分ける（幅をすべて書く→高さをまとめて読む→位置を書く）。以前はカードごとに位置を書いた直後に
  // 高さを読み、カードの数だけ配置の計算をやり直していた（三千件で約9秒: 2026-11-22 M-014 フォルダパネル網羅テスト）。
  items.forEach(el => _setStyleIfChanged(el, 'width', colW + 'px'));
  const heights = items.map(el => el.offsetHeight);
  items.forEach((el, index) => {
    const minH = Math.min(...colHeights);
    const colIdx = colHeights.indexOf(minH);
    _setStyleIfChanged(el, 'left', (colIdx * (colW + gap)) + 'px');
    _setStyleIfChanged(el, 'top', minH + 'px');
    colHeights[colIdx] = minH + heights[index] + gap;
  });
  // 内部の高さスペーサーでスクロール可能にする（grid自体のheightは変えない）
  let spacer = grid.querySelector('.wf-spacer');
  if (!spacer) {
    spacer = document.createElement('div');
    spacer.className = 'wf-spacer';
    spacer.style.position = 'relative';
    spacer.style.width = '1px';
    spacer.style.pointerEvents = 'none';
    grid.appendChild(spacer);
  }
  _setStyleIfChanged(spacer, 'height', Math.max(...colHeights) + 'px');
}

function applyFolderZoom() {
  const grid = _folderGridEl();
  if (!grid) return;
  const size = Math.max(48, Math.min(1000, Math.round(120 * _folderZoom)));
  grid.style.setProperty('--fv-card-w', size + 'px');
  grid.style.setProperty('--fv-card-h', size + 'px');
  if (globalThis.MeldexFolderLarge?.active?.()) { globalThis.MeldexFolderLarge.relayout(); return; }
  if (_folderLayout === 'waterfall') _scheduleWaterfallLayout();
}

function _folderFilterArray(value) {
  return Array.isArray(value) ? value.map(v => String(v || '').trim()).filter(Boolean) : [];
}

function _folderItemExt(item) {
  const explicit = String(item?.ext || '').trim().toLowerCase();
  if (explicit) return explicit.startsWith('.') ? explicit : '.' + explicit;
  const path = String(item?.path || item?.name || '').split(/[?#]/)[0].toLowerCase();
  const name = path.split(/[\\/]/).pop() || '';
  if (name.endsWith('.mel-board')) return '.mel-board';
  if (name.endsWith('.mel-form')) return '.mel-form';
  if (name.endsWith('.mel-sheet')) return '.mel-sheet';
  if (name.endsWith('.mel-scenario')) return '.mel-scenario';
  if (name.endsWith('.mel-timer')) return '.mel-timer';
  if (name.endsWith('.scriptnote.json')) return '.scriptnote.json';
  if (name.endsWith('.timer.json')) return '.timer.json';
  const index = name.lastIndexOf('.');
  return index >= 0 ? name.slice(index) : '';
}

function _folderItemTypeKey(item) {
  return String(item?.type || 'unknown');
}

function _folderItemTypeKeys(item) {
  const type = _folderItemTypeKey(item);
  if (type === 'scriptnote') return ['scriptnote', 'scenario'];
  if (type === 'scenario') return ['scenario', 'scriptnote'];
  return [type];
}

function _folderItemTypeLabel(type) {
  return FILE_TYPE_LABELS?.[type] || type || 'unknown';
}

function _folderItemModifiedTime(item) {
  const raw = item?.modified || item?.mtime || '';
  const time = raw ? Date.parse(raw) : NaN;
  return Number.isFinite(time) ? time : 0;
}

function _folderLocalDateStart(value) {
  if (!value) return 0;
  const time = Date.parse(String(value) + 'T00:00:00');
  return Number.isFinite(time) ? time : 0;
}

function _folderLocalDateEnd(value) {
  const start = _folderLocalDateStart(value);
  return start ? start + 24 * 60 * 60 * 1000 - 1 : 0;
}

function _folderModifiedLowerBound(preset) {
  const now = Date.now();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (preset === 'today') return today.getTime();
  if (preset === '7d') return now - 7 * 24 * 60 * 60 * 1000;
  if (preset === '30d') return now - 30 * 24 * 60 * 60 * 1000;
  if (preset === '90d') return now - 90 * 24 * 60 * 60 * 1000;
  return 0;
}

function _folderMatchesModifiedFilter(item, cfg) {
  const preset = cfg.filterModifiedPreset || 'all';
  if (preset === 'all') return true;
  const modified = _folderItemModifiedTime(item);
  if (!modified) return false;
  if (preset === 'custom') {
    const from = _folderLocalDateStart(cfg.filterModifiedFrom);
    const to = _folderLocalDateEnd(cfg.filterModifiedTo);
    if (from && modified < from) return false;
    if (to && modified > to) return false;
    return true;
  }
  const lower = _folderModifiedLowerBound(preset);
  return lower ? modified >= lower : true;
}

function _folderHasActiveFilters(cfg) {
  return !!String(cfg.filterText || '').trim()
    || _folderFilterArray(cfg.filterTypes).length > 0
    || _folderFilterArray(cfg.filterExts).length > 0
    || _folderHasActiveFolderFilter(cfg)
    || _folderHasActiveTagFilter(cfg)
    || (cfg.filterModifiedPreset && cfg.filterModifiedPreset !== 'all');
}

function _getFolderFilteredItems() {
  const cfg = typeof getFolderDisplayConfig === 'function' ? getFolderDisplayConfig() : {};
  const text = String(cfg.filterText || '').trim().toLowerCase();
  const includeName = window.MeldexUnifiedSearch?.read?.().name !== false;
  const types = new Set(_folderFilterArray(cfg.filterTypes));
  const exts = new Set(_folderFilterArray(cfg.filterExts).map(ext => ext.toLowerCase()));
  const folders = new Set(_folderFilterFolderKeys(cfg));
  const tags = new Set(_folderFilterTagKeys(cfg));
  const tagMode = _folderTagFilterMode(cfg);
  // 検索欄のタグ条件（search側。フィルタの filterTags とは別物）。
  // 検索文字列が空でもタグ条件だけで絞り込めるようにする（2-F）。
  const hasSearchTagCondition = (window.MeldexUnifiedSearch?.readTagCondition?.().tagIds || []).length > 0;
  return _folderItems.filter(function matches(item) {
    if (item.type === 'form-app' && item.children?.some(matches)) return true;
    if (typeof isOutlinerDeletePendingPath === 'function' && isOutlinerDeletePendingPath(item?.path)) return false;
    const unifiedMatch = _folderUnifiedSearchPaths.has(String(item.path || '').replace(/\\/g, '/').toLowerCase());
    if (hasSearchTagCondition && !unifiedMatch) return false;
    if (text) {
      const haystack = [item.name, item.path, item.ext, _folderItemTypeLabel(item.type)].join('\n').toLowerCase();
      if (!(includeName && haystack.includes(text)) && !unifiedMatch) return false;
    }
    if (types.size > 0 && !_folderItemTypeKeys(item).some(type => types.has(type))) return false;
    if (exts.size > 0 && !exts.has(_folderItemExt(item))) return false;
    if (!_folderMatchesFolderFilter(item, folders)) return false;
    if (!_folderMatchesTagFilter(item, tags, tagMode)) return false;
    return _folderMatchesModifiedFilter(item, cfg);
  });
}

function _folderFilterChoices() {
  const cfg = typeof getFolderDisplayConfig === 'function' ? getFolderDisplayConfig() : {};
  const selectedTypes = _folderFilterArray(cfg.filterTypes);
  const selectedExts = _folderFilterArray(cfg.filterExts).map(ext => ext.toLowerCase());
  const selectedFolders = _folderFilterFolderKeys(cfg);
  const selectedTags = _folderFilterTagKeys(cfg);
  const typeMap = new Map();
  const extMap = new Map();
  const folderMap = new Map();
  const tagMap = new Map();
  _folderItems.flatMap(item => [item, ...(item.type === 'form-app' ? item.children || [] : [])]).forEach(item => {
    const type = _folderItemTypeKey(item);
    if (type && !typeMap.has(type)) typeMap.set(type, _folderItemTypeLabel(type));
    const ext = _folderItemExt(item);
    if (ext && !extMap.has(ext)) extMap.set(ext, ext);
    const memberships = _folderItemMemberships(item);
    if (memberships.length > 1 || memberships.some(row => row.type === 'link')) {
      memberships.forEach(row => {
        const folder = _folderMembershipKey(row.folder);
        if (folder && !folderMap.has(folder)) folderMap.set(folder, _folderMembershipFolderLabel(folder));
      });
    }
    _folderItemTags(item).forEach(tag => {
      const key = String(tag.id || tag.name || '').toLowerCase();
      if (key && !tagMap.has(key)) tagMap.set(key, tag.name || key);
    });
  });
  selectedTypes.forEach(type => { if (!typeMap.has(type)) typeMap.set(type, _folderItemTypeLabel(type)); });
  selectedExts.forEach(ext => { if (ext && !extMap.has(ext)) extMap.set(ext, ext); });
  selectedFolders.forEach(folder => { if (folder && !folderMap.has(folder)) folderMap.set(folder, _folderMembershipFolderLabel(folder)); });
  selectedTags.forEach(tag => { if (tag && !tagMap.has(tag)) tagMap.set(tag, _folderTagLabel(tag)); });
  return {
    types: Array.from(typeMap.entries()).sort((a, b) => a[1].localeCompare(b[1], 'ja')),
    exts: Array.from(extMap.entries()).sort((a, b) => a[1].localeCompare(b[1], 'ja')),
    folders: Array.from(folderMap.entries()).sort((a, b) => a[1].localeCompare(b[1], 'ja')),
    tags: Array.from(tagMap.entries()).sort((a, b) => a[1].localeCompare(b[1], 'ja')),
  };
}

function _saveFolderDisplayConfigPatch(patch) {
  const cfg = typeof getFolderDisplayConfig === 'function' ? getFolderDisplayConfig() : {};
  Object.assign(cfg, patch || {});
  if (typeof saveFolderDisplayConfig === 'function') saveFolderDisplayConfig(cfg);
  return cfg;
}

function _clearFolderFilters() {
  const cfg = _saveFolderDisplayConfigPatch({
    filterText: '',
    filterTypes: [],
    filterExts: [],
    filterFolders: [],
    filterTags: [],
    filterModifiedPreset: 'all',
    filterModifiedFrom: '',
    filterModifiedTo: '',
  });
  return cfg;
}

function applyFolderTagFilter(tag) {
  if (!_folderPath || !Array.isArray(_folderItems)) {
    if (typeof showStatus === 'function') showStatus('フォルダを開いてからタグで絞り込んでください', true);
    return false;
  }
  const tagKey = String(tag?.id || tag?.name || tag || '').trim();
  if (!tagKey) return false;
  const cfg = _saveFolderDisplayConfigPatch({ filterTags: [tagKey] });
  if (typeof _folderEnsureTags === 'function') _folderEnsureTags(_folderItems, { rerender: true });
  renderFolderGrid({ resetScrollTop: true });
  _updateFolderDisplayFilterButton(cfg);
  return true;
}

function _updateFolderDisplayFilterButton(cfg) {
  // メイン画面専用のツールバー（#folder-display-btn・#folder-filter-btn等）。
  // 独立した描画先（サブパネル等）はこのツールバーを持たないため触らない。
  if (_folderIsIndependentSurface()) return;
  const current = cfg || (typeof getFolderDisplayConfig === 'function' ? getFolderDisplayConfig() : {});
  const displayBtn = document.getElementById('folder-display-btn');
  const displayIcon = document.getElementById('folder-display-icon');
  const filterBtn = document.getElementById('folder-filter-btn');
  const filterCount = document.getElementById('folder-filter-count');
  const icon = FOLDER_LAYOUT_ICONS[_folderLayout] || 'layoutGrid';
  if (displayIcon) {
    displayIcon.className = 'ico';
    displayIcon.innerHTML = lucide(icon, 16);
  }
  window.syncFolderLayoutControl?.();
  if (displayBtn) {
    displayBtn.dataset.layout = _folderLayout || 'grid';
    displayBtn.title = '表示設定: ' + (FOLDER_LAYOUT_LABELS[_folderLayout] || 'グリッド');
  }
  if (!filterBtn) return;
  const active = _folderHasActiveFilters(current);
  const count = [
    String(current.filterText || '').trim() ? 1 : 0,
    ...(Array.isArray(current.filterTypes) ? current.filterTypes : []),
    ...(Array.isArray(current.filterExts) ? current.filterExts : []),
    ...(Array.isArray(current.filterFolders) ? current.filterFolders : []),
    ...(Array.isArray(current.filterTags) ? current.filterTags : []),
    current.filterModifiedPreset && current.filterModifiedPreset !== 'all' ? 1 : 0,
  ].filter(Boolean).length;
  filterBtn.dataset.filterActive = active ? 'true' : 'false';
  filterBtn.style.borderColor = active ? 'var(--accent)' : 'var(--border)';
  filterBtn.style.color = active ? 'var(--accent)' : 'var(--fg2)';
  filterBtn.title = active ? `フィルタ（${count}件の条件を適用中）` : 'フィルタ';
  if (filterCount) {
    filterCount.hidden = !active;
    filterCount.textContent = active ? ` ${count}` : '';
  }
}

function _folderCreateItemCard(item, idx, context) {
  const { container, filteredItems, preserveSelectedPaths, showThumbForLayout, isListLayout, compactList, showName, showSize, showDate, showType, showDimensions, showRating, showTags } = context;
    const el = document.createElement('div');
    el.className = 'fv-item';
    if (item.type === 'folder' || item.type === 'database') el.classList.add('fv-folder-list-item');
    el._folderItem = item;
    el.dataset.idx = idx;
    el.dataset.itemType = item.type || '';
    el.dataset.itemName = item.name || '';
    if (item.path) el.dataset.path = item.path;
    if (typeof _folderPasteMovePending === 'function' && _folderPasteMovePending(item.path)) {
      el.inert = true;
      el.setAttribute('aria-busy', 'true');
      el.style.opacity = '0.62';
    }
    if (typeof isOutlinerCopyPendingPath === 'function' && isOutlinerCopyPendingPath(item.path)) {
      _outlinerSetCopyPendingNode(el, true);
    }
    const fileLocked = item.path && typeof isItemLocked === 'function' && isItemLocked(item.path);
    const itemLocked = !!item.contained_reference || fileLocked;
    el.draggable = !itemLocked;
    if (preserveSelectedPaths.has(item.path) && !el.inert) {
      el.classList.add('selected');
      _folderSelectedItems.push(item);
      _folderSelected = item;
    }

    // チェックボックス（ホバー時表示）
    const chk = document.createElement('input');
    chk.type = 'checkbox';
    chk.className = 'fv-check';
    chk.dataset.e2eId = `folder-item-select-${item.path || idx}`;
    chk.setAttribute('aria-label', `フォルダ項目を選択: ${item.name || item.path || idx + 1}`);
    chk.addEventListener('click', (e) => {
      e.stopPropagation();
      if (globalThis.MeldexFolderLarge?.active?.()) { globalThis.MeldexFolderLarge.cardCheck(item, el, chk.checked); return; }
      if (chk.checked) {
        el.classList.add('selected');
        if (!_folderSelectedItems.includes(item)) _folderSelectedItems.push(item);
      } else {
        el.classList.remove('selected');
        _folderSelectedItems = _folderSelectedItems.filter(i => i !== item);
      }
      _folderSelected = _folderSelectedItems.length > 0 ? _folderSelectedItems[_folderSelectedItems.length - 1] : null;
      _updateFolderBulkBar();
      if (_folderSelectedItems.length > 1) showStatus(_folderSelectedItems.length + ' 件選択中');
    });
    el.appendChild(chk);

    const moreBtn = document.createElement('button');
    moreBtn.type = 'button';
    moreBtn.className = 'fv-more-btn';
    moreBtn.title = 'メニュー';
    moreBtn.dataset.e2eId = 'folder-item-menu-' + idx + '-' + (item.path || item.name || idx).replace(/[^a-zA-Z0-9_-]+/g, '-');
    moreBtn.dataset.gbTooltip = 'この項目のメニューを開きます';
    moreBtn.innerHTML = lucide('ellipsis', 14);
    moreBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      showFolderItemContextMenu(e, item);
    });
    el.appendChild(moreBtn);

    if (fileLocked) {
      const lockBadge = document.createElement('span');
      lockBadge.className = 'fv-lock-badge';
      lockBadge.innerHTML = lucide('lock', 12);
      const lockReason = typeof getItemLockReason === 'function' ? getItemLockReason(item.path) : '';
      lockBadge.title = typeof isSystemLockedItem === 'function' && isSystemLockedItem(item.path)
        ? 'システム保護中です'
        : ('編集ロック中' + (lockReason ? ': ' + lockReason : ''));
      lockBadge.dataset.gbTooltip = lockBadge.title;
      el.appendChild(lockBadge);
    }

    let folderCardThumb = null;
    let folderPreviewImage = null;
    if (showThumbForLayout) {
      const thumb = document.createElement('div');
      folderCardThumb = thumb;
      thumb.className = 'fv-thumb';
      if (isListLayout) {
        thumb.style.gridColumn = '1';
        thumb.style.gridRow = '1';
      }
      const THUMB_TYPES = new Set(['image','video']);
      const appendIconThumb = () => {
        const icon = document.createElement('span');
        icon.className = 'fv-icon';
        icon.innerHTML = typeof _outlinerIconMarkup === 'function'
          ? _outlinerIconMarkup(item, compactList ? 18 : 36)
          : fileTypeIcon(item.type);
        thumb.appendChild(icon);
        if (!item.display_icon) window.GBOutlinerThumbnails?.attachFormatIcon?.(icon, item);
      };
      if (compactList) {
        appendIconThumb();
      } else if (window.GBOutlinerThumbnails?.canLoadThumbnail?.(item) && !item.display_icon) {
        appendIconThumb();
        window.GBOutlinerThumbnails.attachToElement(thumb, item, thumb.firstElementChild, 256);
      } else if (THUMB_TYPES.has(item.type) && !item.display_icon) {
        const img = document.createElement('img');
        const generatedThumbnail = item.type === 'video';
        const cloudThumbnail = item.type === 'image' && window.MeldexRuntimeAdapter?.isDropboxMode?.()
          && window.MeldexPwaFileUrl?.applyToElement
          && !item.archive_path && !item.external_reference;
        folderPreviewImage = img;
        if (!cloudThumbnail) img.src = generatedThumbnail ? _folderItemThumbnailUrl(item) : _folderItemRawUrl(item);
        const loadCloudImage = source => window.MeldexPwaFileUrl.applyToElement(img, source).then(info => {
          if (!info?.url) img.onerror();
        });
        img.loading = 'lazy';
        img.onerror = () => {
          if (cloudThumbnail && img.getAttribute('src')?.startsWith('blob:') && !img.dataset.rawFallback) {
            img.dataset.rawFallback = '1';
            loadCloudImage(_folderItemRawUrl(item));
            return;
          }
          if (!cloudThumbnail && !generatedThumbnail && !img.dataset.thumbFallback && !item?.external_reference) {
            img.dataset.thumbFallback = '1';
            img.src = _folderItemThumbnailUrl(item);
            return;
          }
          const sp = document.createElement('span');
          sp.className = 'fv-icon';
          sp.innerHTML = fileTypeIcon(item.type);
          img.replaceWith(sp);
        };
        thumb.appendChild(img);
        if (cloudThumbnail) loadCloudImage(_folderItemThumbnailUrl(item));
        window.MeldexImageLoading?.track?.(img, { host: thumb, errorMode: 'silent' });
      } else {
        appendIconThumb();
      }
      // リンクファイルバッジ
      if (item.linked) {
        const badge = document.createElement('span');
        badge.style.cssText = 'position:absolute;top:4px;right:4px;background:rgba(0,0,0,0.6);border-radius:50%;width:18px;height:18px;display:flex;align-items:center;justify-content:center;';
        badge.innerHTML = lucide('externalLink', 10);
        badge.style.color = 'var(--accent)';
        badge.title = 'リンクファイル';
        badge.dataset.gbTooltip = item.contained_reference
          ? `${item.contained_by_name || '文書'} が参照しているリンクファイルです`
          : '別のフォルダにも登録されているリンクファイルです';
        thumb.style.position = 'relative';
        thumb.appendChild(badge);
      }
      el.appendChild(thumb);
    }

    let folderMetaHost = null;
    if (isListLayout) {
      const nameCell = _folderAppendListCells(el, item);
      if (nameCell && item.linked && !showThumbForLayout) {
        const linkMark = document.createElement('span');
        linkMark.className = 'fv-link-file-mark';
        linkMark.innerHTML = lucide('externalLink', 11);
        linkMark.title = item.contained_reference ? `${item.contained_by_name || '文書'} が参照しているリンクファイル` : 'リンクファイル';
        linkMark.dataset.gbTooltip = linkMark.title;
        nameCell.appendChild(linkMark);
      }
      if (nameCell && ((item.type === 'image' && (showDimensions || showRating)) || showTags)) {
        folderMetaHost = document.createElement('div');
        folderMetaHost.className = 'fv-list-extra-meta';
        nameCell.appendChild(folderMetaHost);
      }
    } else if (showName) {
      const name = document.createElement('div');
      name.className = 'fv-name';
      name.textContent = item.name;
      name.title = item.contained_reference ? `${item.name} — ${item.contained_by_name || '文書'} からのリンク` : item.name;
      name.dataset.gbTooltip = name.title;
      if (item.linked && !showThumbForLayout) {
        const linkMark = document.createElement('span');
        linkMark.className = 'fv-link-file-mark';
        linkMark.style.marginLeft = '4px';
        linkMark.innerHTML = lucide('externalLink', 11);
        name.appendChild(linkMark);
      }
      el.appendChild(name);
    }

    if (!isListLayout) {
      const meta = document.createElement('div');
      meta.className = 'fv-meta';
      if (showSize && item.size != null) meta.appendChild(Object.assign(document.createElement('span'), {className: 'fv-meta-item', textContent: formatFileSize(item.size)}));
      if (showDate && item.modified) meta.appendChild(Object.assign(document.createElement('span'), {className: 'fv-meta-item', textContent: item.modified.substring(0, 16).replace('T', ' ')}));
      if (showType) meta.appendChild(Object.assign(document.createElement('span'), {className: 'fv-meta-item', textContent: FILE_TYPE_LABELS[item.type] || item.ext || ''}));
      if (meta.childNodes.length > 0 || (item.type === 'image' && (showDimensions || showRating)) || showTags) {
        folderMetaHost = meta;
        el.appendChild(meta);
      }
    }

    if (folderMetaHost) {
      window.MeldexEmbeddedMetadata?.attachFolderCard?.(folderCardThumb, item, folderPreviewImage, {
        metaHost: folderMetaHost,
        showDimensions,
        showRating,
      });
      if (showTags) window.MeldexEmbeddedMetadata?.attachFolderTags?.(folderMetaHost, item);
    }

    // クリック: 選択（Ctrl=トグル追加、Shift=範囲選択）
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!e.ctrlKey && !e.metaKey && !e.shiftKey && e.detail < 2
          && e.target.closest('.fv-name') && el.classList.contains('selected')
          && _folderStartRename(item, el)) return;
      // 大きなフォルダの表示では、選択を位置とパスで持つ（まだ取っていないページをまたぐ範囲も選べる）
      if (globalThis.MeldexFolderLarge?.active?.()) { globalThis.MeldexFolderLarge.cardClick(e, item, el); return; }
      if (e.ctrlKey || e.metaKey) {
        // Ctrl+クリック: トグル
        el.classList.toggle('selected');
        if (el.classList.contains('selected')) {
          _folderSelectedItems.push(item);
        } else {
          _folderSelectedItems = _folderSelectedItems.filter(i => i !== item);
        }
      } else if (e.shiftKey && _folderSelected) {
        // Shift+クリック: 範囲選択
        const allItems = [...container.querySelectorAll('.fv-item')];
        const anchorPath = _folderSelected?.path || '';
        const startIdx = filteredItems.findIndex(it => it === _folderSelected || (anchorPath && it?.path === anchorPath));
        const endIdx = allItems.indexOf(el);
        if (startIdx >= 0 && endIdx >= 0) {
          const [from, to] = startIdx < endIdx ? [startIdx, endIdx] : [endIdx, startIdx];
          allItems.forEach((el2, i) => {
            if (i >= from && i <= to) {
              el2.classList.add('selected');
              const it = filteredItems[parseInt(el2.dataset.idx)];
              if (it && !_folderSelectedItems.includes(it)) _folderSelectedItems.push(it);
            }
          });
        }
      } else {
        // 通常クリック: 単一選択
        (_folderGridEl() || document).querySelectorAll('.fv-item.selected').forEach(s => s.classList.remove('selected'));
        el.classList.add('selected');
        _folderSelectedItems = [item];
      }
      _folderSelected = item;
      _syncFolderCheckboxes();
      _updateFolderBulkBar();
      { const _pc = _getFvPanelCfg(); if ((_pc.previewVisible ?? true) || (_pc.detailVisible ?? true)) showFolderPreview(item); }
      // 選択件数表示
      if (_folderSelectedItems.length > 1) {
        showStatus(_folderSelectedItems.length + ' 件選択中');
      }
    });

    el.ondblclick = (e) => { e.stopPropagation(); openFolderItem(item); };

    // D&D開始対応（エクスプローラからキャンバス・ノート等へドラッグ）
    el.addEventListener('dragstart', (e) => {
      if (item.path && typeof isItemLocked === 'function' && isItemLocked(item.path)) {
        e.preventDefault();
        showStatus('編集ロック中の項目はドラッグできません', true);
        return;
      }
      e.stopPropagation();
      const largeFolder = globalThis.MeldexFolderLarge?.active?.() ? globalThis.MeldexFolderLarge : null;
      const draggedIsSelected = largeFolder ? largeFolder.isSelectedItem(item)
        : _folderSelectedItems.some(selected => selected?.path === item.path);
      const largeDragItems = largeFolder && draggedIsSelected ? largeFolder.dragItems(item) : null;
      if (largeFolder && draggedIsSelected && !largeDragItems) {
        e.preventDefault();
        showStatus('選択した項目を確認しています。少し待ってからドラッグしてください', true);
        return;
      }
      if (!draggedIsSelected && largeFolder) largeFolder.selectOnly(item, el);
      else if (!draggedIsSelected) {
        _folderSelected = item;
        _folderSelectedItems = [item];
        (_folderGridEl() || document).querySelectorAll('.fv-item.selected').forEach(selected => selected.classList.remove('selected'));
        el.classList.add('selected');
        _syncFolderCheckboxes();
        _updateFolderBulkBar();
      }
      // 大きなフォルダの選択は同じフォルダの直下だけなので、親子の重なりの確認（件数の2乗）は要らない
      const dragItems = (largeDragItems || _folderDragItemsForStart(
        item,
        draggedIsSelected ? _folderSelectedItems : [item]
      ))
        .map(selected => ({
          name: selected.name || '',
          path: selected.path,
          type: selected.type || 'file',
          linked: !!selected.linked,
          sourceSurface: 'folder-panel',
        }));
      const primary = dragItems.find(selected => selected.path === item.path) || dragItems[0];
      const payload = { ...primary, items: dragItems, sourceSurface: 'folder-panel' };
      el.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'copyMove';
      e.dataTransfer.setData('text/plain', dragItems.map(selected => selected.name).filter(Boolean).join(', '));
      e.dataTransfer.setData('application/x-meldex-node', JSON.stringify(payload));
      // text/uri-list を併用することで OS シェル側の赤い禁止カーソルを軽減
      try {
        if (item.path && typeof buildSingleTabWindowUrl === 'function') {
          const uri = new URL(
            buildSingleTabWindowUrl({ name: item.name, path: item.path, type: item.type || 'file' }),
            location.origin
          ).toString();
          e.dataTransfer.setData('text/uri-list', uri);
        }
      } catch {}
      window._gbFolderViewDragNonce = typeof MeldexDnD !== 'undefined'
        ? MeldexDnD.beginCrossWindowDrag(e.dataTransfer, payload, 'node') : '';
      window._gbFolderViewDragPayload = payload;
      // ドロップインジケータが隠れないよう、プレビュー画像を低不透明度 + カーソルから離す
      if (typeof setLowOpacityDragImage === 'function') setLowOpacityDragImage(e, el, 0.35);
    });
    el.addEventListener('dragend', async (e) => {
      el.classList.remove('dragging');
      if (typeof clearDragIndicators === 'function') clearDragIndicators();
      // 窓外にドロップされた場合: 共通ヘルパーで単一窓として開く
      const shouldPopout = typeof shouldOpenDragPopout === 'function'
        ? await shouldOpenDragPopout(e, window._gbFolderViewDragNonce)
        : (typeof isDragDroppedOutsideWindow === 'function' && isDragDroppedOutsideWindow(e));
      if (shouldPopout) {
        const payload = window._gbFolderViewDragPayload;
        const items = payload && Array.isArray(payload.items) ? payload.items : [];
        if (typeof openItemsAsSingleTabWindows === 'function') openItemsAsSingleTabWindows(items);
      }
      if (window._gbFolderViewDragNonce && typeof MeldexDnD !== 'undefined') {
        MeldexDnD.cancelCrossWindowDrag(window._gbFolderViewDragNonce);
      }
      window._gbFolderViewDragPayload = null;
      window._gbFolderViewDragNonce = '';
    });
    el.addEventListener('dragover', (e) => {
      const routedNode = typeof MeldexDnD !== 'undefined' && MeldexDnD.hasDropKind(e, 'node');
      if (routedNode && MeldexDnD.resolveTargetRoute?.(e)?.kind !== 'topic-placement') return;
      const osDrop = _folderCanAcceptOsDrop(e, item);
      const manualDrop = _folderManualDropIntent(e, el, item);
      const linkDrop = _folderCanAcceptLinkDrop(e, item);
      const moveDrop = _folderCanAcceptMoveDrop(e, item);
      if (!osDrop && !manualDrop && !linkDrop && !moveDrop) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = osDrop ? 'copy' : linkDrop ? 'link' : 'move';
      _folderClearManualDropIndicators();
      if (manualDrop) el.classList.add(manualDrop.position === 'before' ? 'fv-manual-before' : 'fv-manual-after');
      else el.classList.add('fv-link-drop');
    });
    el.addEventListener('dragleave', () => {
      el.classList.remove('fv-link-drop');
      el.classList.remove('fv-manual-before', 'fv-manual-after');
    });
    el.addEventListener('drop', async (e) => {
      const routedNode = typeof MeldexDnD !== 'undefined' && MeldexDnD.hasDropKind(e, 'node');
      if (routedNode && MeldexDnD.resolveTargetRoute?.(e)?.kind !== 'topic-placement') return;
      const osDrop = _folderCanAcceptOsDrop(e, item);
      const manualDrop = _folderManualDropIntent(e, el, item);
      const linkDrop = _folderCanAcceptLinkDrop(e, item);
      const moveDrop = _folderCanAcceptMoveDrop(e, item);
      if (!osDrop && !manualDrop && !linkDrop && !moveDrop) return;
      e.preventDefault();
      e.stopPropagation();
      el.classList.remove('fv-link-drop');
      _folderClearManualDropIndicators();
      if (osDrop) { await _folderImportOsDrop(e, item); return; }
      if (manualDrop) { _folderApplyManualDrop(manualDrop, item); return; }
      const resolved = typeof MeldexDnD !== 'undefined' ? await MeldexDnD.resolveDropData(e, 'node') : null;
      const completed = linkDrop
        ? await _folderCreateLinksFromDrop(e, item, resolved?.payload)
        : await _folderMoveItemsFromDrop(e, item, resolved?.payload);
      if (resolved && completed > 0) MeldexDnD.completeDrop(resolved);
      else if (resolved) MeldexDnD.failDrop(resolved);
    });

    // 右クリックメニュー
    el.oncontextmenu = (e) => {
      e.preventDefault();
      showFolderItemContextMenu(e, item);
    };
    if (typeof addLongPressHandler === 'function') {
      addLongPressHandler(el, (e) => {
        e.preventDefault?.();
        showFolderItemContextMenu(e, item);
      });
    }
    if (typeof addLongPressHandler === 'function') {
      addLongPressHandler(el, (e) => {
        e.preventDefault?.();
        showFolderItemContextMenu(e, item);
      });
    }

    if (item.type === 'form-app' && Array.isArray(item.children)) {
      const children = document.createElement('div'); children.className = 'fv-form-sheets';
      children.style.cssText = 'grid-column:1/-1;padding-left:8px;min-width:0;';
      children.setAttribute('aria-label', 'フォーム内のシート');
      for (const sheet of item.children) {
        const open = document.createElement('button'); open.type = 'button'; open.className = 'gb-btn';
        open.style.cssText = 'display:block;max-width:100%;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
        open.dataset.gbTooltip = sheet.name || sheet.path;
        open.textContent = '↳ ' + (sheet.name || sheet.path); open.setAttribute('aria-label', 'シートを開く: ' + (sheet.name || sheet.path));
        open.addEventListener('click', event => { event.stopPropagation(); selectDatabase(sheet.path); });
        open.addEventListener('dblclick', event => event.stopPropagation()); children.appendChild(open);
      }
      el.appendChild(children);
    }
  return el;
}

// 作成した項目だけを追加する。既存カードと選択・スクロール・プレビューを保持する。
function _folderApplyCreatedItems(items) {
  if (typeof _folderNotifyFoldersChanged === 'function' && Array.isArray(items) && items.length) {
    _folderNotifyFoldersChanged([...new Set(items.map(item => _folderDirectParentKey(item?.path || '')))]);
  }
  if (globalThis.MeldexFolderLarge?.active?.()) { globalThis.MeldexFolderLarge.refresh(); return; }
  const container = _folderGridEl();
  if (!container || !Array.isArray(_folderItems)) return;
  const normalize = path => String(path || '').replace(/\\/g, '/').toLowerCase();
  const known = new Set(_folderItems.map(item => normalize(item.path)));
  const added = (items || []).filter(item => item?.path && !known.has(normalize(item.path)));
  if (!added.length) return;
  _folderItems.push(...added);
  const ordered = _folderSortVisibleItems(_getFolderFilteredItems()).filter(item => !_folderPendingMovePaths.has(_folderMembershipKey(item.path)));
  // カードの範囲選択が参照する配列そのものは替えない。
  const filteredItems = _folderVisibleItems;
  filteredItems.splice(0, filteredItems.length, ...ordered);
  const existing = new Map(Array.from(container.querySelectorAll('.fv-item'), card => [normalize(card.dataset.path), card]));
  const dcfg = getFolderDisplayConfig();
  const isListLayout = _folderIsListLayout();
  const context = { container, filteredItems, preserveSelectedPaths: new Set(), isListLayout,
    compactList: _folderLayout === 'list-small',
    showThumbForLayout: isListLayout || dcfg.showThumb !== false,
    showName: dcfg.showName !== false, showSize: dcfg.showSize !== false, showDate: dcfg.showDate !== false,
    showType: dcfg.showType !== false, showDimensions: dcfg.showDimensions !== false,
    showRating: dcfg.showRating !== false, showTags: dcfg.showTags !== false };
  const scroll = [container.scrollLeft, container.scrollTop];
  if (filteredItems.length) container.querySelectorAll('.fv-empty-state').forEach(node => node.remove());
  filteredItems.forEach((item, index) => {
    const key = normalize(item.path);
    const card = existing.get(key);
    if (card) { card.dataset.idx = index; return; }
    const created = _folderCreateItemCard(item, index, context);
    const next = filteredItems.slice(index + 1).map(nextItem => existing.get(normalize(nextItem.path))).find(Boolean);
    container.insertBefore(created, next || null);
    if (_folderLayout === 'waterfall') _waterfallResizeOb?.observe(created);
    existing.set(key, created);
  });
  container.scrollLeft = scroll[0]; container.scrollTop = scroll[1];
  _folderUpdateStatusCounts(_folderItems);
  const count = document.getElementById('folder-item-count');
  if (count) count.textContent = filteredItems.length + (_folderItems.length !== filteredItems.length ? ' / ' + _folderItems.length : '') + ' 項目';
  if (typeof registerFileTypes === 'function') registerFileTypes(added);
  _syncFolderCheckboxes(); _updateFolderBulkBar();
  if (_folderLayout === 'waterfall') _scheduleWaterfallLayout();
}

// 一覧の取得を始めた後に確定した名前の変更・移動を、届いた一覧へ当てはめる（出て行った項目は除く）。
function _folderApplyPathChangesSince(items, since) {
  if (!Array.isArray(items) || typeof resolveCurrentAppPath !== 'function') return items;
  const base = value => String(value || '').replace(/\\/g, '/').replace(/\/+$/, '').split('/').pop() || '';
  const stem = value => value.replace(/\.[^./]+$/, '');
  const lower = value => String(value || '').replace(/\\/g, '/').toLowerCase();
  const remapped = new Map();
  const kept = [];
  let changed = false;
  for (const item of items) {
    const current = item?.path ? resolveCurrentAppPath(item.path, { since }) : '';
    if (!current || current === item.path) { kept.push(item); continue; }
    changed = true;
    if (!_folderIsDirectChildOfCurrent(current)) continue;
    const oldBase = base(item.path), newBase = base(current);
    const name = item.name === oldBase ? newBase : item.name === stem(oldBase) ? stem(newBase) : item.name;
    remapped.set(lower(current), { ...item, path: current, name });
  }
  if (!changed) return items;
  const keptPaths = new Set(kept.map(item => lower(item?.path)));
  const out = [...kept, ...[...remapped].filter(([key]) => !keptPaths.has(key)).map(([, item]) => item)];
  if (items._folderBrowseIncomplete) out._folderBrowseIncomplete = items._folderBrowseIncomplete;
  return out;
}

// ドラッグ中は一覧を描き直さない。描き直すと行の並びが変わり、マウスの下に別の項目が来て、
// 狙ったフォルダではなく隣のシートの中へ落ちてしまう（2026-11-24 利用者の報告: 4件が別のシートの中へ移動した）。
// ドラッグが終わった直後に、最後に頼まれた描き直しを1回だけ行う。
let _folderDragInProgress = false;
let _folderDeferredRenderOpts = null;
function _folderFlushDeferredRender() {
  _folderDragInProgress = false;
  const pending = _folderDeferredRenderOpts;
  _folderDeferredRenderOpts = null;
  // 描き直しは、頼まれた面（メイン／サブパネル）ごとに1回ずつ行う
  const deferred = Array.isArray(pending) ? pending : (pending ? [{ opts: pending.opts, surface: null }] : []);
  deferred.forEach(entry => (typeof _folderOnSurface === 'function'
    ? _folderOnSurface(entry.surface, () => renderFolderGrid(entry.opts))
    : renderFolderGrid(entry.opts)));
}
if (typeof document !== 'undefined' && !window.__gbFolderDragRenderGuard) {
  window.__gbFolderDragRenderGuard = true;
  document.addEventListener('dragstart', () => { _folderDragInProgress = true; }, true);
  // ドロップでは、受け取る処理がドロップ先のカードを調べ終わってから描き直す（ドロップの最中にカードを
  // 入れ替えると、受け取る処理がドロップ先を見失って何も起きない）。終わりの知らせは2つとも来ることがある。
  const flushSoon = () => { if (_folderDragInProgress || _folderDeferredRenderOpts) setTimeout(_folderFlushDeferredRender, 0); };
  document.addEventListener('drop', flushSoon, true);
  document.addEventListener('dragend', flushSoon, true);
  // ドラッグの終わりの知らせが来なかった時の保険（ドラッグ中はマウスの移動の知らせが来ない）
  ['pointermove', 'pointerdown', 'keydown'].forEach(type => document.addEventListener(type, () => {
    if (_folderDragInProgress) _folderFlushDeferredRender();
  }, true));
}

// 表示形式ごとの描画先のclass。「リスト・小」はリストの仕組みをそのまま使い、行の寸法だけフォルダツリーと同じにする
// （list-small-layout が付いている時だけ gb-tools.part01.part01.css の寸法の上書きが効く）。
const FOLDER_LAYOUT_CLASSES = { grid: 'grid-layout', list: 'list-layout', 'list-small': 'list-layout list-small-layout',
  waterfall: 'waterfall-layout', hflow: 'hflow-layout' };
const FOLDER_LAYOUT_LABELS = { grid: 'グリッド', waterfall: 'ウォーターフォール', hflow: '横並び', list: 'リスト', 'list-small': 'リスト・小' };
const FOLDER_LAYOUT_ICONS = { grid: 'layoutGrid', waterfall: 'layoutDashboard', hflow: 'columns', list: 'list', 'list-small': 'listCompact' };
// リストの行の形で描く表示形式（リスト・リスト・小）
function _folderIsListLayout(mode) {
  const value = mode === undefined ? _folderLayout : mode;
  return value === 'list' || value === 'list-small';
}

function renderFolderGrid(opts) {
  if (_folderDragInProgress) {
    const deferSurface = _folderResolveRenderOverride() || null;
    _folderDeferredRenderOpts = (Array.isArray(_folderDeferredRenderOpts) ? _folderDeferredRenderOpts : []).filter(entry => entry.surface !== deferSurface);
    _folderDeferredRenderOpts.push({ opts, surface: deferSurface });
    return;
  }
  if (globalThis.MeldexFolderLarge?.active?.()) return globalThis.MeldexFolderLarge.render(opts);
  // 従来の描き方で描く時は、前に開いていた大きなフォルダの表示の後始末をする
  globalThis.MeldexFolderLarge?.deactivate?.();
  const renderOpts = opts || {};
  const preserveSelectedPaths = new Set((renderOpts.preserveSelectedPaths
    ?? (_folderSelectedItems || []).map(item => item?.path)).filter(Boolean));
  const resetScrollTop = !!renderOpts.resetScrollTop;
  const container = _folderGridEl();
  if (!container) return;
  // 描画の続き（分割して置くカード・タグの読み込み後）は、この面をつなぎ直してから進める
  const renderSurface = _folderResolveRenderOverride() || null;
  const renderStillCurrent = () => _folderEnterSurface(renderSurface) && renderSeq === _folderRenderSeq;
  _folderUpdateStatusCounts(_folderItems);
  const renderSeq = ++_folderRenderSeq;
  window.GBOutlinerThumbnails?.detachWithin?.(container);
  container.innerHTML = '';
  if (resetScrollTop) container.scrollTop = 0;
  const layoutClass = FOLDER_LAYOUT_CLASSES[_folderLayout] || 'grid-layout';
  // レイアウトモードclassをまるごと差し替える（containerが#folder-gridの場合は
  // 元々classを持たないため問題ない）。独立した描画先（サブパネル等）は自身の
  // 識別class（gb-subpanel-folder-root。gb-subpanel.cssの対応スタイルが参照する）
  // を残す必要があるため、置き換えではなく保持したうえでレイアウトmode classを付ける。
  container.className = _folderIsIndependentSurface()
    ? ('gb-subpanel-folder-root ' + layoutClass)
    : layoutClass;
  _installFolderBlankContextMenu(container);
  if (!_folderIsIndependentSurface()) {
    const layoutSelect = document.getElementById('folder-layout-select');
    if (layoutSelect) layoutSelect.value = _folderLayout;
  }
  applyFolderZoom();

  _folderSelectedItems = [];
  _folderSelected = null;
  _updateFolderBulkBar();
  // パネルレイアウトを適用
  applyFvPanelLayout();
  // ウォーターフォール以外: 高さリセット
  if (_folderLayout !== 'waterfall') {
    _disconnectWaterfallResizeObserver();
    container.style.height = '';
    const oldSpacer = container.querySelector('.wf-spacer');
    if (oldSpacer) oldSpacer.remove();
  }

  const dcfg = getFolderDisplayConfig();
  const showThumb = dcfg.showThumb !== false;
  const showName = dcfg.showName !== false;
  const showSize = dcfg.showSize !== false;
  const showDate = dcfg.showDate !== false;
  const showType = dcfg.showType !== false;
  const showDimensions = dcfg.showDimensions !== false;
  const showRating = dcfg.showRating !== false;
  const showTags = dcfg.showTags !== false;
  if (_folderHasActiveFolderFilter(dcfg)) _folderEnsureMemberships(_folderItems, { rerender: true });
  const activeTagFilter = _folderHasActiveTagFilter(dcfg);
  const tagLoadPromise = (showTags || activeTagFilter)
    ? _folderEnsureTags(_folderItems, { rerender: activeTagFilter })
    : null;
  const filteredItems = _folderSortVisibleItems(_getFolderFilteredItems())
    .filter(item => !_folderPendingMovePaths.has(_folderMembershipKey(item.path)));
  _folderVisibleItems = filteredItems;
  _updateFolderDisplayFilterButton(dcfg);
  if (!_folderIsIndependentSurface()) {
    const folderCountEl = document.getElementById('folder-item-count');
    if (folderCountEl) folderCountEl.textContent = filteredItems.length + (_folderItems.length !== filteredItems.length ? ' / ' + _folderItems.length : '') + ' 項目';
  }
  const isListLayout = _folderIsListLayout();
  // リスト・小はサムネイルを出さずアイコンだけ（フォルダツリーと同じ大きさ）
  const compactList = _folderLayout === 'list-small';
  const showThumbForLayout = isListLayout || showThumb;
  _folderConfigureListLayout(container, isListLayout);
  if (isListLayout) _folderRenderListHeader(container);

  if (_folderBrowseIncomplete) {
    const warning = document.createElement('div');
    warning.className = 'fv-browse-warning';
    warning.setAttribute('role', 'status');
    warning.style.cssText = 'grid-column:1 / -1;width:100%;box-sizing:border-box;flex:none;padding:8px 12px;color:var(--fg2);';
    if (_folderLayout === 'waterfall') {
      warning.style.position = 'absolute';
      warning.style.top = '0';
      warning.style.left = '0';
    }
    warning.textContent = _folderBrowseIncomplete.truncated
      ? 'サブフォルダーの表示上限に達しました。一部は未確認です。'
      : '一部のサブフォルダーを読み込めませんでした。';
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'gb-btn gb-btn-sm';
    retry.dataset.e2eId = 'folder-browse-retry';
    retry.textContent = '再読み込み';
    const retryPath = _folderPath;
    retry.addEventListener('click', () => {
      if (_folderPath !== retryPath) return;
      openFolder(retryPath.split(/[\\/]/).pop(), retryPath, {
        silent: true, skipNavPush: true, skipSaveLastView: true,
        selectedPaths: _folderSelectedItems.map(item => item.path),
        containerEl: _folderResolveRenderOverride(),
      });
    });
    warning.appendChild(retry);
    container.appendChild(warning);
  }

  if (filteredItems.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'fv-empty-state';
    const searchTags = window.MeldexUnifiedSearch?.readTagCondition?.().tagIds || [];
    const filteredOut = _folderItems.length > 0 && (_folderHasActiveFilters(dcfg) || searchTags.length > 0);
    empty.textContent = filteredOut ? `${_folderItems.length}項目が絞り込みで非表示です`
      : _folderBrowseIncomplete ? '読み込めた項目はありません' : 'このフォルダは空です';
    if (filteredOut) {
      empty.style.flexDirection = 'column';
      empty.style.gap = '12px';
      const summary = document.createElement('div');
      const conditions = [];
      if (String(dcfg.filterText || '').trim()) conditions.push('名前・パス');
      const types = _folderFilterArray(dcfg.filterTypes);
      if (types.length) conditions.push('種類: ' + types.map(_folderItemTypeLabel).join('、'));
      if (_folderFilterArray(dcfg.filterExts).length) conditions.push('拡張子');
      if (_folderHasActiveFolderFilter(dcfg)) conditions.push('所属フォルダ');
      if (_folderHasActiveTagFilter(dcfg) || searchTags.length) conditions.push('タグ');
      if (dcfg.filterModifiedPreset && dcfg.filterModifiedPreset !== 'all') conditions.push('更新日時');
      summary.textContent = '適用中の条件: ' + conditions.join(' / ');
      empty.appendChild(summary);
      const reset = document.createElement('button');
      reset.type = 'button';
      reset.className = 'gb-btn gb-btn-sm';
      reset.dataset.e2eId = 'folder-empty-clear-filters';
      reset.textContent = '絞り込みを解除';
      reset.addEventListener('click', () => {
        _clearFolderFilters();
        if (searchTags.length) window.MeldexUnifiedSearch?.writeTagCondition?.({ tagIds: [] });
        renderFolderGrid({ resetScrollTop: true });
      });
      empty.appendChild(reset);
    }
    container.appendChild(empty);
    return;
  }

  let nextRenderIndex = 0;
  // 先頭のカードをすぐ表示し、残りは画面から外した場所で組み立てて最後に一度だけ置く。
  // 各80件を画面へ置くたびに周辺の寸法計算と描画が走り、三千件で数秒かかっていた。
  const stagedCards = filteredItems.length > FOLDER_PANEL_RENDER_CHUNK_SIZE ? document.createDocumentFragment() : null;
  let resolveRender;
  const rendered = new Promise(resolve => { resolveRender = resolve; });
  const finishFolderGridRender = () => {
    if (!renderStillCurrent()) { resolveRender(false); return; }
    _syncFolderCheckboxes();
    _updateFolderBulkBar();
    if (preserveSelectedPaths.size > 0 && _folderSelected) {
      const panelCfg = _getFvPanelCfg();
      if ((panelCfg.previewVisible ?? true) || (panelCfg.detailVisible ?? true)) showFolderPreview(_folderSelected);
    }

    // 後から挿入される画像も含め、カード全体の寸法を監視する。
    if (_folderLayout === 'waterfall') {
      _scheduleWaterfallLayout();
      _ensureWaterfallResizeObserver();
    }
    tagLoadPromise?.then(() => {
      if (!renderStillCurrent()) return;
      window.MeldexEmbeddedMetadata?.refreshFolderTags?.(container);
      if (_folderLayout === 'waterfall') _scheduleWaterfallLayout();
    });
    resolveRender(true);
  };
  const renderFolderGridChunk = () => {
    if (!renderStillCurrent()) { resolveRender(false); return; }
    const fragment = document.createDocumentFragment();
    const firstChunk = nextRenderIndex === 0;
    const endIndex = Math.min(filteredItems.length, nextRenderIndex + _folderPanelRenderChunkSize(filteredItems.length));
    for (; nextRenderIndex < endIndex; nextRenderIndex++) {
      const item = filteredItems[nextRenderIndex];
      const idx = nextRenderIndex;
    const el = _folderCreateItemCard(item, idx, { container, filteredItems, preserveSelectedPaths, showThumbForLayout, isListLayout, compactList, showName, showSize, showDate, showType, showDimensions, showRating, showTags });
    fragment.appendChild(el);
    }
    (stagedCards && !firstChunk ? stagedCards : container).appendChild(fragment);
    if (firstChunk && _folderLayout === 'waterfall') _scheduleWaterfallLayout();
    if (nextRenderIndex < filteredItems.length) {
      if (stagedCards) setTimeout(renderFolderGridChunk, 0);
      else _folderScheduleRenderFrame(renderFolderGridChunk);
      return;
    }
    if (stagedCards) container.appendChild(stagedCards);
    finishFolderGridRender();
  };
  renderFolderGridChunk();
  return rendered;
}

function _folderMenuItemLocked(item) {
  return !!item?.contained_reference
    || !!(item?.path && typeof isItemLocked === 'function' && isItemLocked(item.path));
}

function _folderMenuLockStatusLabel(item) {
  if (typeof isSystemLockedItem === 'function' && isSystemLockedItem(item?.path)) return 'システム保護';
  if (typeof isFileLockOwner === 'function' && !isFileLockOwner()) {
    return _folderMenuItemLocked(item) ? '編集ロック中' : '編集ロック（管理者のみ）';
  }
  return _folderMenuItemLocked(item) ? '編集ロック解除' : '編集ロックする';
}

async function _toggleFolderItemLock(item) {
  if (!item?.path || typeof toggleItemLock !== 'function') return;
  const changed = await toggleItemLock(item.path);
  if (!changed) return;
  if (_folderPath) await openFolder(_folderPath.split('/').pop(), _folderPath, { ...(typeof _folderSurfaceOpts === 'function' ? _folderSurfaceOpts() : {}),
    skipSaveLastView: true,
    skipNavPush: true,
    skipHighlight: true,
  });
  showStatus(_folderMenuItemLocked(item) ? '編集ロックしました' : '編集ロックを解除しました');
}

function _isPureRefFolderItem(item) {
  return !!(item?.path && /\.pur$/i.test(String(item.path).split(/[?#]/)[0]));
}

function _folderParentPath(path) {
  const normalized = String(path || '').replace(/\\/g, '/');
  const index = normalized.lastIndexOf('/');
  return index >= 0 ? normalized.slice(0, index) : '';
}

async function _convertPureRefFolderItemToBoard(item) {
  if (!_isPureRefFolderItem(item)) return;
  const baseName = String(item.name || item.path.split(/[\\/]/).pop() || 'PureRef').replace(/\.pur$/i, '') || 'PureRef';
  try {
    showStatus('PureRefをボードファイルに変換しています...');
    const result = await runBackgroundJob('/external-import/pureref/import', {
      path: item.path,
      board_name: baseName,
      save_dir: _folderParentPath(item.path),
      save_root: 'source',
    }, {
      onProgress: (progress) => {
        if (progress && progress.message) showStatus(progress.message);
      },
    });
    if (_folderPath) await _folderRefreshCurrentFolder();
    if (typeof reloadOutlinerTree === 'function') reloadOutlinerTree();
    if (result?.board_path && typeof openBoard === 'function') {
      openBoard(result.board_path.split('/').pop(), result.board_path, { fromExplorer: true });
    }
    showStatus(`PureRefをボードファイルに変換しました: ${result?.board_path || baseName}`);
  } catch (err) {
    showStatus('PureRefを変換できませんでした: ' + (err?.userMessage || err?.message || err), true);
  }
}

function refreshVisibleFolderLockState() {
  const grid = _folderGridEl();
  if (!grid) return;
  grid.querySelectorAll('.fv-item').forEach(el => {
    const idx = parseInt(el.dataset.idx, 10);
    const item = (_folderVisibleItems.length ? _folderVisibleItems : _getFolderFilteredItems())[idx];
    if (!item?.path || typeof isItemLocked !== 'function') return;
    const locked = !!item.contained_reference || isItemLocked(item.path);
    el.draggable = !locked;
    el.querySelector('.fv-lock-badge')?.remove();
    if (!locked) return;
    const lockBadge = document.createElement('span');
    lockBadge.className = 'fv-lock-badge';
    lockBadge.innerHTML = lucide('lock', 12);
    const lockReason = typeof getItemLockReason === 'function' ? getItemLockReason(item.path) : '';
    lockBadge.title = item.contained_reference
      ? '参照元の文書で管理される読み取り専用リンクです'
      : typeof isSystemLockedItem === 'function' && isSystemLockedItem(item.path)
      ? 'システム保護中です'
      : ('編集ロック中' + (lockReason ? ': ' + lockReason : ''));
    lockBadge.dataset.gbTooltip = lockBadge.title;
    el.appendChild(lockBadge);
  });
}

// ツリーとパネルで同じインライン編集・保存・失敗回復経路を使う。
function _folderStartRename(item, card) {
  if (!item?.path || item.type === 'entity' || item._isRoot || _folderMenuItemLocked(item)) return false;
  card = card || [...(_folderGridEl()?.querySelectorAll('.fv-item') || [])].find(el => el.dataset.path === item.path);
  if (!card) return false;
  let label = card.querySelector('.fv-list-name-text, .fv-name');
  if (!label) {
    label = document.createElement('div');
    label.className = 'fv-name';
    label.textContent = item.name;
    card.appendChild(label);
  }
  if (label.querySelector('input') || typeof startTreeLabelEdit !== 'function') return false;
  startTreeLabelEdit(label, item);
  return true;
}

// DOMを作り直さず、選択・スクロール・プレビューを保って改名結果を反映する。
function _folderApplyRename(oldPath, newPath, newName, fileId) {
  if (typeof _folderNotifyFoldersChanged === 'function') _folderNotifyFoldersChanged([_folderDirectParentKey(oldPath || '')]);
  if (_folderPendingMovePaths.delete(_folderMembershipKey(oldPath))) _folderPendingMovePaths.add(_folderMembershipKey(newPath));
  const seen = new Set();
  const update = item => {
    if (!item?.path || seen.has(item)) return;
    seen.add(item);
    if (item.path === oldPath || item.path === newPath) {
      item.path = newPath;
      item.name = newName;
      if (fileId) item.file_id = fileId;
    } else if (item.path.startsWith(oldPath + '/')) {
      item.path = newPath + item.path.slice(oldPath.length);
    }
  };
  _folderItems.forEach(update);
  _folderSelectedItems.forEach(update);
  update(_folderSelected);
  document.querySelectorAll('.fv-item').forEach(card => {
    update(card._folderItem);
    const path = card.dataset.path;
    if (path === oldPath || path === newPath) {
      card.dataset.path = newPath;
      card.dataset.itemName = newName;
      const label = card.querySelector('.fv-list-name-text, .fv-name');
      if (label) {
        label.textContent = newName;
        label.title = newName;
        label.dataset.gbTooltip = newName;
      }
    } else if (path?.startsWith(oldPath + '/')) {
      card.dataset.path = newPath + path.slice(oldPath.length);
    }
  });
}

let _folderContextMenuOpenSeq = 0;

// フォルダアイテムの右クリックメニュー
async function showFolderItemContextMenu(e, item, options = {}) {
  if ((item?.archive_path || window._archiveBrowseContext) && typeof showArchiveItemContextMenu === 'function') {
    showArchiveItemContextMenu(e, item);
    return;
  }
  closeColHeaderMenu();
  const openSeq = ++_folderContextMenuOpenSeq;
  const itemEl = e?.currentTarget?.closest?.('.fv-item') || e?.target?.closest?.('.fv-item') || null;
  // サブパネル内では、サブパネルで開く・バージョン管理等の
  // 右サイドバー補助操作のUIを表示しない（計画書「右サイドバー操作の制限」節）。
  const _canUseRightSidebar = typeof GBPaneBridge === 'undefined' || typeof GBPaneBridge.canUseRightSidebarTools !== 'function'
    || typeof GBPaneBridge.surfaceOf !== 'function'
    || GBPaneBridge.canUseRightSidebarTools(GBPaneBridge.surfaceOf(itemEl || e?.target || null));
  const blankTarget = !!options.blankTarget;
  const alreadySelected = !blankTarget && _folderSelectedItems.some(selected => selected?.path === item.path);
  if (!blankTarget && !alreadySelected) {
    (_folderGridEl() || document).querySelectorAll('.fv-item.selected').forEach(s => s.classList.remove('selected'));
    if (itemEl) itemEl.classList.add('selected');
    _folderSelectedItems = [item];
    _folderSelected = item;
    _syncFolderCheckboxes();
    _updateFolderBulkBar();
    const panelCfg = _getFvPanelCfg();
    if ((panelCfg.previewVisible ?? true) || (panelCfg.detailVisible ?? true)) showFolderPreview(item);
  } else if (!blankTarget) {
    _folderSelected = item;
  }
  // 複数選択中の項目でメニューを開いた時は、選んだ操作を選択中のすべての項目へ一括実行する。
  // 1項目にしか効かない操作（開く、アイコン変更、バージョン、リンクをコピー等）は出さない
  // （フォルダツリーの複数選択メニューと同じ基準）。旧「一括操作バー」の機能もここへ集約した。
  const multiItems = !blankTarget && _folderSelectedItems.length > 1 ? _folderSelectedItems.slice() : null;
  const isMulti = !!multiItems;
  const menu = document.createElement('div');
  menu.className = 'gb-context-menu';
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', blankTarget
    ? 'フォルダパネルメニュー'
    : isMulti ? `選択中の${multiItems.length}件のメニュー` : `${item.name || '項目'}のメニュー`);
  if (isMulti) {
    menu.dataset.folderMultiSelection = String(multiItems.length);
    const heading = document.createElement('div');
    heading.className = 'gb-context-menu-label';
    heading.dataset.e2eId = 'folder-item-context-selection-count';
    heading.textContent = `${multiItems.length}件を選択中`;
    menu.appendChild(heading);
  }
  const closeMenu = () => {
    _folderContextMenuOpenSeq += 1;
    document.querySelectorAll('.gb-context-menu').forEach(m => {
      if (!m.parentElement?.closest?.('.gb-context-menu')) m.remove();
    });
  };
  function addItem(label, fn, cls, icon) {
    if (typeof _outlinerAppendMenuItem === 'function') {
      return _outlinerAppendMenuItem(menu, {
        label,
        icon,
        danger: cls === 'red',
        className: 'tree-ctx-item',
        action: () => { closeMenu(); return _folderRunMenuAction(fn, label); },
      });
    }
    const d = document.createElement('div');
    d.className = 'gb-context-menu-item';
    if (!icon && icon !== false) icon = window.MeldexMenuIcons?.resolve?.(label) || '';
    if (icon && typeof lucide === 'function') {
      d.innerHTML = '<span style="margin-right:6px;opacity:0.7;">' + lucide(icon, 14) + '</span>' + label;
    } else {
      d.textContent = label;
    }
    if (cls) d.style.color = 'var(--' + cls + ')';
    d.addEventListener('click', () => { closeMenu(); return _folderRunMenuAction(fn, label); });
    menu.appendChild(d);
  }
  function addSep() {
    if (typeof _outlinerAppendMenuSeparator === 'function') return _outlinerAppendMenuSeparator(menu);
    const d = document.createElement('div'); d.className = 'gb-context-menu-sep'; menu.appendChild(d); return d;
  }
  function addSub(label, icon) {
    if (typeof _outlinerCreateSubmenu === 'function' && typeof _outlinerAppendSubmenu === 'function') {
      const panel = _outlinerCreateSubmenu(label);
      _outlinerAppendSubmenu(menu, label, icon, panel);
      return {
        panel,
        item(l, fn, cls, itemIcon) {
          return _outlinerAppendMenuItem(panel, {
            label: l,
            icon: itemIcon,
            danger: cls === 'red',
            className: 'tree-ctx-item',
            action: () => { closeMenu(); return _folderRunMenuAction(fn, l); },
          });
        },
      };
    }
    const wrap = document.createElement('div'); wrap.className = 'gb-context-menu-submenu'; wrap.style.position = 'relative';
    const trigger = document.createElement('div'); trigger.className = 'gb-context-menu-item';
    trigger.innerHTML = (icon && typeof lucide === 'function' ? '<span style="margin-right:6px;opacity:0.7;">' + lucide(icon, 14) + '</span>' : '') + esc(label) + submenuArrow();
    const panel = document.createElement('div'); panel.className = 'gb-context-menu';
    panel.style.cssText = 'display:none;';
    attachHoverSubmenu(trigger, panel);
    wrap.appendChild(trigger); wrap.appendChild(panel); menu.appendChild(wrap);
    return {
      panel,
      item(l, fn, cls, itemIcon) {
        const d = document.createElement('div');
        d.className = 'gb-context-menu-item';
        if (itemIcon && typeof lucide === 'function') d.innerHTML = '<span style="margin-right:6px;opacity:0.7;">' + lucide(itemIcon, 14) + '</span>' + esc(l);
        else d.textContent = l;
        if(cls) d.style.color='var(--'+cls+')';
        d.addEventListener('click', () => { closeMenu(); return _folderRunMenuAction(fn, l); });
        panel.appendChild(d);
      }
    };
  }

  // ツールバーと同じ基本操作を、右クリック位置からもすぐ実行できるようにする。
  if (typeof appendFolderOperationButtons === 'function') {
    const operationItems = blankTarget
      ? []
      : (_folderSelectedItems.length > 1 ? _folderSelectedItems : [item]);
    const pasteTarget = blankTarget || item.type !== 'folder' ? _folderPath : item.path;
    const editableItems = operationItems.filter(target => !_folderMenuItemLocked(target));
    appendFolderOperationButtons(menu, {
      e2ePrefix: 'folder-item-context',
      closeMenu,
      onCopy: () => folderToolbarCopyItems(operationItems),
      onCut: () => folderToolbarCutItems(operationItems),
      onPaste: () => folderToolbarPasteToFolder(pasteTarget),
      onDuplicate: () => _folderDuplicateItems(editableItems, () => (
        _folderPath ? openFolder(_folderPath.split('/').pop(), _folderPath, { ...(typeof _folderSurfaceOpts === 'function' ? _folderSurfaceOpts() : {}) }) : null
      )),
      onDelete: () => folderToolbarDeleteSelection(),
      copyDisabled: operationItems.length === 0,
      cutDisabled: editableItems.length === 0,
      pasteDisabled: !folderToolbarCanPasteTo(pasteTarget),
      duplicateDisabled: editableItems.length === 0,
      deleteDisabled: editableItems.length === 0,
    });
    addSep();
  }

  // --- 新規作成 ---（作成先が押した1項目で決まり、選択中のすべてへ働く操作ではないため複数選択時は出さない）
  const createParent = isMulti ? null : _folderContextCreateParent(item);
  if (createParent && !(typeof isItemLocked === 'function' && isItemLocked(createParent))) {
    const createSub = addSub('新規作成', 'plus');
    [['フォルダ','folder','folder'],['ノート','page','page'],['シナリオ','scriptnote','bookOpenText'],['シート','database','db'],['ボード','board','presentation'],['フォーム','form-app','clipboardList']].forEach(([label,type,icon]) => {
      createSub.item(label, async () => {
        if (typeof addItemAt === 'function') {
          await addItemAt(createParent, type);
          if (type !== 'form-app') await _folderRefreshCurrentFolder();
        }
      }, null, icon);
    });
    addSep();
  }

  if (!blankTarget && !isMulti && window.MeldexFileIcons?.canEdit(item) && !_folderMenuItemLocked(item)) {
    addItem('アイコンを変更', () => window.MeldexFileIcons.openPicker(item, itemEl || e?.target), null, 'smile');
    addSep();
  }
  // --- 開く ---
  if (!blankTarget && !isMulti && item.path) {
    const openSub = addSub('開く', 'folderOpen');
    openSub.item('メインパネルで開く', () => openFolderItem(item), null, 'panelTop');
    openSub.item('新しいタブで開く', () => _folderOpenItemInNewTab(item), null, 'externalLink');
    if (_canUseRightSidebar && typeof openLinkedPathInRightSidebar === 'function') {
      openSub.item('サブパネルで開く', () => openLinkedPathInRightSidebar(item.path, item.name, { linkType: item.type, sourceEl: itemEl || e?.target || null }), null, 'panelRight');
    }
    if (typeof openLinkedPathStandalone === 'function'
        && (typeof canOpenLinkedPathStandalone !== 'function' || canOpenLinkedPathStandalone(item.path, item.type))) {
      openSub.item('単独アプリで開く', () => openLinkedPathStandalone(item.path, item.name, { linkType: item.type }), null, 'appWindow');
    }
    openSub.item('新しいウィンドウで開く', () => _folderOpenItemInNewWindow(item), null, 'monitor');
    if (item.type !== 'folder') openSub.item('アプリで開く', () => openNative(item.path), null, 'externalLink');
    if (item.type === 'image') {
      openSub.item('ビューワーで開く', () => openViewer(_folderItemViewerUrl(item)), null, 'image');
      openSub.item('ボードで開く', () => openImageInCanvas(item), null, 'presentation');
    }
    if ((item.type === 'scriptnote') || (typeof isScriptNotePath === 'function' && isScriptNotePath(item.path))) {
      openSub.item('シナリオで開く', () => {
        if (typeof openScenarioInScriptNote === 'function' && openScenarioInScriptNote(item.path, item.name || '', { fromExplorer: true })) return;
        showStatus('シナリオエディタを開けませんでした', true);
      }, null, 'fileText');
    } else if (item.type === 'scenario') {
      openSub.item('シナリオへ取り込んで開く', () => {
        if (typeof openScenarioInScriptNote === 'function' && openScenarioInScriptNote(item.path, item.name || '', { fromExplorer: true })) return;
        showStatus('シナリオエディタを開けませんでした', true);
      }, null, 'fileText');
    }
    addSep();
  }
  if (!blankTarget && !isMulti && typeof canShowContainedFiles === 'function' && canShowContainedFiles(item)) {
    addItem('ファイル内のファイルを表示', () => showContainedFiles(item), null, 'files');
    addSep();
  }
  if (!isMulti && _isPureRefFolderItem(item)) {
    addItem('ボードファイルに変換', () => _convertPureRefFolderItemToBoard(item), null, 'presentation');
  }
  if (!isMulti && item.type !== 'folder' && _canUseRightSidebar) addItem('チャットを開く', () => openFileChat(item.path), null, 'messageSquare');
  if (isMulti) {
    if (_canUseRightSidebar) {
      addItem(`プロパティ（${multiItems.length}件）`, () => showFolderSelectionProperties(multiItems, itemEl), null, 'info');
    }
    // 旧「一括操作バー」の画像向け操作。画像を含む時だけ出す。
    const imgCount = multiItems.filter(i => i.type === 'image').length;
    if (imgCount > 0) {
      addItem(`スライドショー（${imgCount}枚）`, () => fvBulkSlideshow(), null, 'image');
      if (document.body?.dataset?.cloudReadonly !== '1') {
        addItem(`ボードに並べる（${imgCount}枚）`, () => fvBulkBoard(), null, 'presentation');
      }
    }
    if (window.isAutoTagRuntimeAvailable?.() === true && multiItems.some(i => i?.path)) {
      addItem(`自動タグ付け（${multiItems.length}件）`, () => fvBulkAutoTag(), null, 'tags');
    }
  } else if (!blankTarget && item.path && window.isAutoTagRuntimeAvailable?.() === true) {
    addItem(item.type === 'folder' ? 'フォルダ内すべてを自動タグ付け' : '自動タグ付け', () => {
      if (typeof autoTagFolderTarget === 'function') autoTagFolderTarget(item, { recursive: item.type === 'folder' });
    }, null, 'tags');
  }
  if (!blankTarget && item.path && window.MeldexArchiveTools?.desktop()) {
    window.MeldexArchiveTools.appendMenu(menu, _folderSelectedItems.length > 1 ? _folderSelectedItems.slice() : [item], closeMenu);
  } else if (!blankTarget && item.path) {
    const canCompress = typeof _folderCanCompress === 'function' ? _folderCanCompress() : !window.MeldexRuntimeAdapter?.isBrowserDataMode?.();
    const archiveTargets = _folderSelectedItems.length > 1 ? _folderSelectedItems : [item];
    const extractTargets = archiveTargets.filter(target => (
      typeof _folderCanExtractArchive === 'function' && _folderCanExtractArchive(target)
    ));
    if (canCompress || extractTargets.length) {
      const archiveSub = addSub('圧縮/解凍', 'archive');
      archiveSub.panel.dataset.shellArchivePanel = '1';
      if (canCompress) {
        archiveSub.item(archiveTargets.length > 1 ? '選択項目を圧縮' : '圧縮', () => {
          if (typeof compressFolderItems === 'function') compressFolderItems(archiveTargets);
        }, null, 'archive');
      }
      if (extractTargets.length) {
        archiveSub.item(extractTargets.length > 1 ? 'すべて展開' : '解凍', () => {
          if (typeof extractArchiveItems === 'function') extractArchiveItems(extractTargets);
          else if (typeof extractArchiveItem === 'function') extractArchiveItem(extractTargets[0]);
        }, null, 'packageOpen');
      }
    }
  }

  if (!isMulti && item.type === 'calendar' && item.path) {
    const mainCalId = localStorage.getItem('main-calendar-id');
    const mainCalPath = localStorage.getItem('main-calendar-path');
    const nodeFid = typeof _pathToFileId === 'function' ? _pathToFileId(item.path) : '';
    const isMain = (mainCalId && nodeFid && mainCalId === nodeFid) || mainCalPath === item.path;
    const calSub = addSub('メインカレンダー', 'calendar');
    calSub.item((isMain ? '✓ ' : '') + '設定する', () => {
      const before = typeof _captureMainCalendarSettingsHistory === 'function' ? _captureMainCalendarSettingsHistory() : null;
      localStorage.setItem('main-calendar-path', item.path);
      if (nodeFid) localStorage.setItem('main-calendar-id', nodeFid);
      showStatus(`「${item.name}」をメインカレンダーに設定しました`);
      if (typeof _pushMainCalendarSettingsHistory === 'function') _pushMainCalendarSettingsHistory('カレンダー: メインカレンダー設定', before, item.path);
    });
    calSub.item((!isMain ? '✓ ' : '') + '解除する', () => {
      const before = typeof _captureMainCalendarSettingsHistory === 'function' ? _captureMainCalendarSettingsHistory() : null;
      localStorage.removeItem('main-calendar-path');
      localStorage.removeItem('main-calendar-id');
      showStatus('メインカレンダー設定を解除しました');
      if (typeof _pushMainCalendarSettingsHistory === 'function') _pushMainCalendarSettingsHistory('カレンダー: メインカレンダー解除', before, item.path);
    });
  }

  if (!isMulti && (item.type === 'folder' || item.type === 'database') && item.path) {
    addSep();
    addItem('バージョンを保存', () => {
      if (typeof saveFolderVersion === 'function') saveFolderVersion(item.path);
    }, null, 'save');
    if (_canUseRightSidebar) {
      addItem('バージョン管理', () => {
        if (typeof openFolderVersionTab === 'function') openFolderVersionTab(item.path);
        else if (typeof openVersionTab === 'function') openVersionTab(item.path, 'folder');
      }, null, 'gitBranch');
    }
  }

  if (!isMulti && item.path && !item.contained_reference) {
    addSep();
    const systemLocked = typeof isSystemLockedItem === 'function' && isSystemLockedItem(item.path);
    const canEditLock = typeof isFileLockOwner === 'function' && isFileLockOwner();
    const lockLabel = _folderMenuLockStatusLabel(item);
    if (systemLocked || !canEditLock) {
      const lockedItem = document.createElement('div');
      lockedItem.className = 'gb-context-menu-item disabled';
      lockedItem.innerHTML = '<span style="margin-right:6px;opacity:0.7;">' + lucide('lock', 14) + '</span>' + lockLabel;
      lockedItem.title = systemLocked ? 'システム保護中です' : '編集ロックの設定は管理者のみ可能です';
      lockedItem.dataset.gbTooltip = lockedItem.title;
      menu.appendChild(lockedItem);
    } else {
      addItem(lockLabel, () => _toggleFolderItemLock(item), null, _folderMenuItemLocked(item) ? 'unlock' : 'lock');
    }
  }

  // --- ツール（1つのフォルダ・現在のフォルダが対象のため単独選択時のみ） ---
  if (!isMulti && (item.type === 'folder' || _folderPath)) {
    addSep();
    const toolSub = addSub('ツール');
    if (item.type === 'folder') {
      if (window.MeldexCloudBatchRename?.openDialog) {
        toolSub.item('ファイル名を一括変更…', () => window.MeldexCloudBatchRename.openDialog(item.path), null, 'textCursorInput');
      }
      toolSub.item('重複画像を検出', () => showDuplicateScanModal(item.path));
      toolSub.item('画像インデックスを作成', () => clipIndexFolder(item.path));
    }
    if (_folderPath && (item.type !== 'folder' || item.path !== _folderPath)) {
      toolSub.item('このフォルダで重複検出', () => showDuplicateScanModal(_folderPath));
      toolSub.item('このフォルダのインデックス作成', () => clipIndexFolder(_folderPath));
    }
  }

  if (!isMulti && item.path && item.type !== 'folder' && typeof showCompareModal === 'function') {
    addSep();
    addItem('比較...', () => showCompareModal(item.path), null, 'columns');
  }

  if (!blankTarget && !isMulti && item.path) {
    addSep();
    addItem('リンクをコピー', () => _folderCopyMeldexLink(item), null, 'link');
  }

  if (!blankTarget && !isMulti && item.path && typeof getFavorites === 'function') {
    const isFav = getFavorites().some(f => f.path === item.path);
    addItem(isFav ? 'お気に入りを外す' : 'お気に入りに追加', () => {
      if (isFav && typeof removeFromFavorites === 'function') removeFromFavorites(item.path);
