/* ==============================
   gb-split.js: スプリットビュー管理
   2ペイン同時表示でDBを並列閲覧する機能
   ============================== */

let _splitActive = false;

function isSplitActive() { return _splitActive; }

/* --- スプリットビュー有効化/無効化 --- */

/**
 * スプリットビューを有効化する
 * @param {string} [dbPathForPaneB] - Pane Bに開くDBパス（省略時はEmpty）
 */
function activateSplitView(dbPathForPaneB) {
  if (_splitActive) return;

  const mainViews = document.getElementById('main-views');
  if (!mainViews) return;
  const dbPathForPaneA = state.currentDbPath || '';
  _splitActive = true;

  // 既存ビューを非表示
  _hideAllMainViews();

  // split-container作成
  const splitContainer = document.createElement('div');
  splitContainer.id = 'split-container';
  mainViews.appendChild(splitContainer);

  // Pane A 作成
  const paneA = _createPaneDOM('a');
  splitContainer.appendChild(paneA);

  // リサイズハンドル
  const handle = document.createElement('div');
  handle.id = 'split-resize-handle';
  splitContainer.appendChild(handle);
  _initSplitResize(handle, paneA);

  // Pane B 作成
  const paneB = _createPaneDOM('b');
  splitContainer.appendChild(paneB);

  // PaneContext作成
  const ctxA = createPaneContext('pane-a');
  ctxA.containerEl = paneA;
  ctxA.tableId = 'pivot-table-a';
  const ctxB = createPaneContext('pane-b');
  ctxB.containerEl = paneB;
  ctxB.tableId = 'pivot-table-b';

  // Pane Aにアクティブマーク
  setActivePaneById('pane-a');

  // アクティブペイン切替（イベント委譲）
  splitContainer.addEventListener('pointerdown', _onSplitPaneClick);

  // 現在のDBがあればPane Aに読み込み
  if (dbPathForPaneA) {
    openDbInPane(dbPathForPaneA, 'pane-a');
  }

  // Pane Bに指定DBがあれば読み込み
  if (dbPathForPaneB) {
    openDbInPane(dbPathForPaneB, 'pane-b');
  } else {
    _showPaneEmpty(paneB);
  }

  // ツールバーのスプリットボタン状態更新
  _updateSplitButton(true);
}

/**
 * スプリットビューを無効化して通常モードに戻る
 */
function deactivateSplitView() {
  if (!_splitActive) return;
  _splitActive = false;

  const splitContainer = document.getElementById('split-container');
  if (splitContainer) {
    splitContainer.removeEventListener('pointerdown', _onSplitPaneClick);
    splitContainer.remove();
  }

  // PaneContext破棄
  const activeCtx = getActivePane();
  const paneA = getPaneContext('pane-a');
  const paneB = getPaneContext('pane-b');
  const restoreDbPath = activeCtx?.dbPath || paneA?.dbPath || paneB?.dbPath || state.currentDbPath;
  destroyPaneContext('pane-a');
  destroyPaneContext('pane-b');

  // 通常モードに復帰
  _showAllMainViews();
  _updateSplitButton(false);

  // アクティブだったDBを通常モードで表示
  if (restoreDbPath) {
    selectDatabase(restoreDbPath);
  } else {
    showView('welcome');
  }
}

function toggleSplitView() {
  if (_splitActive) deactivateSplitView();
  else activateSplitView();
}

/* --- ペインDOM生成 --- */

/**
 * db-view-container相当のDOMを動的生成する
 */
function _createPaneDOM(paneId) {
  const pane = document.createElement('div');
  pane.className = 'split-pane';
  pane.id = 'pane-' + paneId;
  pane.dataset.paneId = 'pane-' + paneId;

  // D&D: Ctrl+ドロップでペインにファイルを開く（通常ドロップは各ビュー固有ハンドラに委ねる）
  pane.addEventListener('dragover', (e) => {
    if (e.dataTransfer.types.includes('application/x-meldex-node') && e.ctrlKey) {
      e.preventDefault();
      pane.style.outline = '2px dashed var(--accent)';
    }
  });
  pane.addEventListener('dragleave', () => { pane.style.outline = ''; });
  pane.addEventListener('drop', (e) => {
    pane.style.outline = '';
    if (!e.ctrlKey) return;
    const cfData = e.dataTransfer.getData('application/x-meldex-node');
    if (!cfData) return;
    e.preventDefault();
    try {
      const { name, path, type } = JSON.parse(cfData);
      if (type === 'database') {
        // DBはそのペインで開く
        openDbInPane(path, 'pane-' + paneId);
      } else {
        // DB以外はスプリット解除して通常モードで開く
        deactivateSplitView();
        if (typeof navOpen === 'function') navOpen({ type: type === 'database' ? 'pivot' : (type || 'page'), label: name, path });
      }
    } catch {}
  });

  // ペインヘッダー
  const header = document.createElement('div');
  header.className = 'pane-header';
  const title = document.createElement('span');
  title.className = 'pane-title';
  title.textContent = 'DB未選択';
  header.appendChild(title);
  const closeBtn = document.createElement('button');
  closeBtn.className = 'pane-close-btn';
  closeBtn.innerHTML = lucide('x', 14);
  closeBtn.title = 'スプリット解除';
  closeBtn.addEventListener('click', () => deactivateSplitView());
  header.appendChild(closeBtn);
  pane.appendChild(header);

  // db-view-container相当
  const dbViewContainer = document.createElement('div');
  dbViewContainer.className = 'db-view-container';
  dbViewContainer.style.cssText = 'display:flex;flex-direction:column;flex:1;overflow:hidden;';

  // ビュー切替
  const viewSwitcher = document.createElement('div');
  viewSwitcher.className = 'db-pane-view-switcher';
  const tabs = document.createElement('div');
  tabs.id = 'db-view-tabs-' + paneId;
  tabs.className = 'db-view-tabs';
  // タブエリアへのD&D（DBならこのペインで開く、他はスプリット解除して開く）
  tabs.addEventListener('dragover', (e) => {
    if (e.dataTransfer.types.includes('application/x-meldex-node')) {
      e.preventDefault();
      e.stopPropagation(); // ペイン全体のハンドラに伝搬させない
      tabs.style.background = 'var(--bg4)';
    }
  });
  tabs.addEventListener('dragleave', () => { tabs.style.background = ''; });
  tabs.addEventListener('drop', (e) => {
    tabs.style.background = '';
    const cfData = e.dataTransfer.getData('application/x-meldex-node');
    if (!cfData) return;
    e.preventDefault();
    e.stopPropagation();
    try {
      const { name, path, type } = JSON.parse(cfData);
      if (type === 'database') {
        openDbInPane(path, 'pane-' + paneId);
      } else {
        deactivateSplitView();
        if (typeof navOpen === 'function') navOpen({ type: type === 'database' ? 'pivot' : (type || 'page'), label: name, path });
      }
    } catch {}
  });
  viewSwitcher.appendChild(tabs);
  const viewSelect = document.createElement('select');
  viewSelect.id = 'db-view-select-' + paneId;
  viewSelect.className = 'tb-select db-view-select';
  viewSelect.title = 'ビュー切替';
  viewSelect.setAttribute('aria-label', 'ビュー切替');
  viewSwitcher.appendChild(viewSelect);
  dbViewContainer.appendChild(viewSwitcher);

  // pivot-view
  const pivotView = document.createElement('div');
  pivotView.className = 'pivot-view';
  pivotView.id = 'pivot-view-' + paneId;
  pivotView.style.cssText = 'flex:1;overflow:auto;';
  const table = document.createElement('table');
  table.id = 'pivot-table-' + paneId;
  table.className = 'pivot-table';
  const thead = document.createElement('thead');
  const tbody = document.createElement('tbody');
  const tfoot = document.createElement('tfoot');
  table.appendChild(thead);
  table.appendChild(tbody);
  table.appendChild(tfoot);
  pivotView.appendChild(table);
  dbViewContainer.appendChild(pivotView);

  // gallery-view
  const galleryView = document.createElement('div');
  galleryView.id = 'gallery-view-' + paneId;
  galleryView.className = 'gallery-view';
  galleryView.style.display = 'none';
  dbViewContainer.appendChild(galleryView);

  // kanban-view
  const kanbanView = document.createElement('div');
  kanbanView.id = 'kanban-view-' + paneId;
  kanbanView.className = 'kanban-view';
  kanbanView.style.display = 'none';
  dbViewContainer.appendChild(kanbanView);

  // timeline-view
  const timelineView = document.createElement('div');
  timelineView.id = 'timeline-view-' + paneId;
  timelineView.className = 'timeline-view';
  timelineView.style.display = 'none';
  dbViewContainer.appendChild(timelineView);

  // chart-view
  const chartView = document.createElement('div');
  chartView.id = 'chart-view-' + paneId;
  chartView.className = 'chart-view';
  chartView.style.display = 'none';
  dbViewContainer.appendChild(chartView);

  // graph-view
  const graphView = document.createElement('div');
  graphView.id = 'graph-view-' + paneId;
  graphView.className = 'graph-view';
  graphView.style.display = 'none';
  dbViewContainer.appendChild(graphView);

  // form-view
  const formView = document.createElement('div');
  formView.id = 'form-view-' + paneId;
  formView.className = 'form-view';
  formView.style.display = 'none';
  dbViewContainer.appendChild(formView);

  pane.appendChild(dbViewContainer);
  return pane;
}

/* --- ペイン操作 --- */

/**
 * 指定ペインでDBを表示する
 */
function openDbInPane(dbPath, paneId) {
  const ctx = getPaneContext(paneId);
  if (!ctx) return;
  setActivePaneById(paneId);

  // ペインヘッダーのタイトル更新 + 空表示オーバーレイ除去
  const paneEl = ctx.containerEl;
  if (paneEl) {
    const title = paneEl.querySelector('.pane-title');
    if (title) title.textContent = dbPath.split('/').pop() || dbPath;
    _hidePaneEmpty(paneEl);
  }

  selectDatabase(dbPath, ctx);
}

/**
 * 別ペインでDBを開く（フォルダツリー連携用）
 */
function openDbInOtherPane(dbPath) {
  const active = getActivePane();
  if (!active) return;
  const otherId = active.paneId === 'pane-a' ? 'pane-b' : 'pane-a';
  openDbInPane(dbPath, otherId);
}

/**
 * スプリットモードを有効化して指定DBをPane Bで開く
 */
function openInNewSplit(dbPath) {
  activateSplitView(dbPath);
}

/**
 * アクティブペインを切り替える
 */
function setActivePaneById(paneId) {
  setActivePane(paneId, { sync: true });
  const ctx = getPaneContext(paneId);

  // global state同期（非スコープ化コードの互換性）
  if (ctx) {
    state.currentDbPath = ctx.dbPath;
    state.pivotData = ctx.pivotData;
    if (typeof setFilter === 'function') setFilter(ctx.filter, { skipReload: true });
    else state.filter = ctx.filter;
    state.currentEntityPath = ctx.entityPath;
    state.view = ctx.viewMode;
    if (ctx.smartDb !== undefined) state.currentSmartDb = ctx.smartDb;
    if (ctx.smartDbData !== undefined) state.smartDbData = ctx.smartDbData;
  }

  // ビジュアルインジケーター更新
  document.querySelectorAll('.split-pane').forEach(el => el.classList.remove('active'));
  const paneEl = document.getElementById(paneId);
  if (paneEl) paneEl.classList.add('active');
}

/* --- イベントハンドラ --- */

function _onSplitPaneClick(e) {
  const pane = e.target.closest('.split-pane');
  if (!pane) return;
  const paneId = pane.dataset.paneId;
  if (paneId && paneId !== getActivePane()?.paneId) {
    setActivePaneById(paneId);
  }
}

/* --- リサイズ --- */

function _initSplitResize(handle, paneA) {
  let startX = 0, startWidth = 0;

  handle.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    startX = e.clientX;
    startWidth = paneA.getBoundingClientRect().width;

    // iframeがポインターイベントを奪うのを防止
    document.querySelectorAll('iframe').forEach(f => f.style.pointerEvents = 'none');

    const onMove = (e2) => {
      const dx = e2.clientX - startX;
      const containerWidth = paneA.parentElement ? paneA.parentElement.getBoundingClientRect().width : Infinity;
      const newWidth = Math.min(Math.max(200, startWidth + dx), containerWidth - 200);
      paneA.style.flex = 'none';
      paneA.style.width = newWidth + 'px';
    };

    const onUp = () => {
      document.querySelectorAll('iframe').forEach(f => f.style.pointerEvents = '');
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onUp);
      window.removeEventListener('blur', onUp);
    };

    // documentにリスナーを付けて、カーソルが高速移動しても追従
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onUp);
    window.addEventListener('blur', onUp, { once: true });
  });
}

/* --- UI ヘルパー --- */

function _hideAllMainViews() {
  const ids = ['login-view','welcome-view','db-view-container','entity-view','page-view',
    'media-view','html-view','folder-view'];
  ids.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
}

function _showAllMainViews() {
  // 通常モードに戻す（showViewが適切に表示する）
  // split-containerを除去した後にshowViewが呼ばれるので、ここでは何もしなくてよい
}

function _showPaneEmpty(paneEl) {
  const container = paneEl.querySelector('.db-view-container');
  if (!container) return;
  // 既存のビュー要素 (pivot-view, gallery-view, kanban-view...) は壊さず、
  // 上に空表示用オーバーレイだけ重ねる。openDbInPane 時に _hidePaneEmpty で除去。
  let overlay = container.querySelector(':scope > .pane-empty-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.className = 'pane-empty-overlay';
    overlay.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:var(--fg2);font-size:14px;background:var(--bg1);z-index:5;';
    overlay.textContent = 'フォルダツリーからシートを選択、またはファイルメニューから「別の作業領域で開く」';
    if (getComputedStyle(container).position === 'static') {
      container.style.position = 'relative';
    }
    container.appendChild(overlay);
  }
}

function _hidePaneEmpty(paneEl) {
  if (!paneEl) return;
  const overlay = paneEl.querySelector('.db-view-container > .pane-empty-overlay');
  if (overlay) overlay.remove();
}

function _updateSplitButton(active) {
  const btn = document.getElementById('btn-split-toggle');
  if (btn) {
    btn.classList.toggle('active', active);
    btn.title = active ? 'スプリット解除' : 'スプリットビュー';
  }
}
