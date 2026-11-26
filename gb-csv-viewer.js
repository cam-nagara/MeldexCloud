/**
 * Meldex CSV Viewer
 * CSVファイルのスプレッドシート表示・編集・保存・DB変換
 */

let _csvPath = '';
let _csvData = [];
let _csvHeaders = [];
let _csvDirty = false;
let _csvAutoSaveTimer = null;
let _csvOpenSeq = 0;
let _csvSaveVersion = 0;
let _csvSaveInFlight = null;
let _csvSaveQueued = false;
let _csvSaveHost = {};
let _csvLastSavedEtag = '';
let _csvLastSavedContent = null;
let _csvLastSavedTransportRevision = '';
let _csvSheetModeActive = false;
// CSVの表示は「面」ごとに状態を持つ（2026-11-25）。面 = メインパネルのCSV（#pivot-table のシートモード／
// #csv-table-container）と、openCsvFile の containerEl（サブパネル等の独立した描画先）。
// 上の _csvPath / _csvData / _csvHeaders / _csvDirty / 保存の待ち行列 / 版 / 読み込みの番号 / 書式は
// 「今つないでいる面」の値。既存の読み書きの箇所は変えず、面を切り替える時に退避・復元する
// （_csvBindSurface。DOM には触らない）。
// - 既定でつないでいるのはメインの面。サブパネルの面は、その面の操作（セルのクリック・編集の確定）・
//   自動保存のタイマー・読み込みや保存の続きの間だけつなぎ、終わったらメインへ戻す。
//   そのため、他のファイルから _csvPath 等を読むとメインパネルの値になる（従来どおり）。
// - 以前は状態が1つで、サブパネルで別のCSVを開くとメイン側が「切り替わりました」の表示になっていた。
//   面ごとの状態では、メインとサブパネルで別々のCSVを同時に表示・編集・保存できる（互いを読み直さない）。
// 独立した描画先は共有の #pivot-table（シートモード）を使わない（_csvSheetModeActive は常に false）。
let _csvRenderContainerOverride = null;
// 読み込んだCSVの書式（区切り・改行・文字コード）。独立した描画先の保存で使う
// （メインのシートモードは MeldexCsvWorkbench が書式を持つ）。
let _csvDialect = null;

function _csvNewSurface(container) {
  return {
    container: container || null,
    path: '', data: [], headers: [], dirty: false, autoSaveTimer: null, openSeq: 0,
    saveVersion: 0, saveInFlight: null, saveQueued: false, saveHost: {},
    lastSavedEtag: '', lastSavedContent: null, lastSavedTransportRevision: '',
    sheetModeActive: false, dialect: null,
  };
}
const _csvMainSurface = _csvNewSurface(null);
const _csvSubSurfaces = new Map();
let _csvSurface = _csvMainSurface;
let _csvSurfaceReturnScheduled = false;

function _csvStoreSurface(surface) {
  surface.path = _csvPath;
  surface.data = _csvData;
  surface.headers = _csvHeaders;
  surface.dirty = _csvDirty;
  surface.autoSaveTimer = _csvAutoSaveTimer;
  surface.openSeq = _csvOpenSeq;
  surface.saveVersion = _csvSaveVersion;
  surface.saveInFlight = _csvSaveInFlight;
  surface.saveQueued = _csvSaveQueued;
  surface.saveHost = _csvSaveHost;
  surface.lastSavedEtag = _csvLastSavedEtag;
  surface.lastSavedContent = _csvLastSavedContent;
  surface.lastSavedTransportRevision = _csvLastSavedTransportRevision;
  surface.sheetModeActive = _csvSheetModeActive;
  surface.dialect = _csvDialect;
}

function _csvLoadSurface(surface) {
  _csvPath = surface.path;
  _csvData = surface.data;
  _csvHeaders = surface.headers;
  _csvDirty = surface.dirty;
  _csvAutoSaveTimer = surface.autoSaveTimer;
  _csvOpenSeq = surface.openSeq;
  _csvSaveVersion = surface.saveVersion;
  _csvSaveInFlight = surface.saveInFlight;
  _csvSaveQueued = surface.saveQueued;
  _csvSaveHost = surface.saveHost;
  _csvLastSavedEtag = surface.lastSavedEtag;
  _csvLastSavedContent = surface.lastSavedContent;
  _csvLastSavedTransportRevision = surface.lastSavedTransportRevision;
  _csvSheetModeActive = surface.sheetModeActive;
  _csvDialect = surface.dialect;
  _csvRenderContainerOverride = surface.container;
}

// 面をつなぎ替える（状態の退避・復元だけ。描画・通信はしない）。
function _csvBindSurface(surface) {
  if (!surface || surface === _csvSurface) return;
  _csvStoreSurface(_csvSurface);
  _csvSurface = surface;
  _csvLoadSurface(surface);
}

// fn の間だけ面をつなぎ、終わったら元の面へ戻す（fn が async なら最初の待ちまで）。
function _csvOnSurface(surface, fn) {
  const previous = _csvSurface;
  _csvBindSurface(surface);
  try {
    return fn();
  } finally {
    _csvBindSurface(previous);
  }
}

// 待ち（await）の後に自分の面をつなぎ直す。メイン以外の面は、今の処理の区切りでメインへ戻す。
function _csvEnterSurface(surface) {
  _csvBindSurface(surface);
  if (surface === _csvMainSurface || _csvSurfaceReturnScheduled) return;
  _csvSurfaceReturnScheduled = true;
  const back = () => {
    _csvSurfaceReturnScheduled = false;
    _csvBindSurface(_csvMainSurface);
  };
  if (typeof queueMicrotask === 'function') queueMicrotask(back);
  else Promise.resolve().then(back);
}

// DOM のイベントの処理を、作った時の面で動かす。
function _csvSurfaceHandler(fn) {
  const surface = _csvSurface;
  return function (...args) {
    return _csvOnSurface(surface, () => fn.apply(this, args));
  };
}

function _csvSubSurfaceOfElement(el) {
  if (!el || !_csvSubSurfaces.size) return null;
  for (const surface of _csvSubSurfaces.values()) {
    if (surface.container === el || surface.container.contains?.(el)) return surface;
  }
  return null;
}

function _csvSurfaceForContainer(container) {
  if (!container) return _csvMainSurface;
  let surface = _csvSubSurfaces.get(container);
  if (!surface) {
    _csvPruneSubSurfaces();
    surface = _csvNewSurface(container);
    _csvSubSurfaces.set(container, surface);
  }
  return surface;
}

// 面の値を読む（今つないでいる面は、先に今の値を面へ写してから）。
function _csvSurfaceField(surface, key) {
  if (surface === _csvSurface) _csvStoreSurface(surface);
  return surface[key];
}

// 画面から外れた描画先の面を手放す（未保存・保存中の面は、保存が終わるまで残す）。
function _csvPruneSubSurfaces() {
  for (const [container, surface] of [..._csvSubSurfaces]) {
    if (container.isConnected || surface === _csvSurface) continue;
    if (surface.dirty || surface.saveInFlight || surface.saveQueued) continue;
    clearTimeout(surface.autoSaveTimer);
    _csvSubSurfaces.delete(container);
  }
}

function _csvForEachSurface(fn) {
  [_csvMainSurface, ..._csvSubSurfaces.values()].forEach(surface => _csvOnSurface(surface, () => fn(surface)));
}

// メインパネルのCSVのパス（サブパネルの面をつないでいる間も）。
function _csvMainPath() {
  return _csvSurfaceField(_csvMainSurface, 'path') || '';
}

// 利用者が操作している面。サブパネルのCSVを操作中（クリック・フォーカス）ならその面、それ以外はメイン。
function _csvInteractionSurface() {
  if (!_csvSubSurfaces.size) return _csvMainSurface;
  let host = null;
  try { host = globalThis.GBEditorHost?.get?.() || null; } catch { host = null; }
  if (host?.surface === 'subpanel' && host.root) {
    for (const surface of _csvSubSurfaces.values()) {
      if (surface.container.isConnected && host.root.contains(surface.container)) return surface;
    }
  }
  return _csvMainSurface;
}

// 独立した描画先（サブパネル等）の面の未保存内容を保存する。片付ける前に呼ぶ。
async function _csvFlushContainerSurface(container) {
  const surface = _csvSubSurfaces.get(container);
  if (!surface) return true;
  return _csvOnSurface(surface, () => {
    _csvCommitActiveEditor();
    if (!_csvDirty || !_csvPath) return true;
    clearTimeout(_csvAutoSaveTimer);
    return saveCsv();
  });
}

// 独立した描画先の面を手放す（メインの面の状態はそのまま残る）。
function _csvReleaseSurface(container) {
  const surface = _csvSubSurfaces.get(container);
  if (!surface || surface === _csvSurface) return false;
  if (surface.dirty || surface.saveInFlight || surface.saveQueued) return false;
  clearTimeout(surface.autoSaveTimer);
  _csvSubSurfaces.delete(container);
  return true;
}

// 開いているCSVの名前の変更・移動。メインの面は gb-app 側が付け替えるので、ここは独立した描画先の面だけ。
function _csvRenameSubSurfacePaths(mapPath) {
  if (typeof mapPath !== 'function') return;
  for (const surface of _csvSubSurfaces.values()) {
    _csvOnSurface(surface, () => { if (_csvPath) _csvPath = mapPath(_csvPath) || _csvPath; });
  }
}

function _csvTableContainerEl() {
  return _csvRenderContainerOverride || document.getElementById('csv-table-container');
}

function _csvHistoryScope() {
  return _csvPath ? 'csv:' + _csvPath : '';
}

// 取り消し・やり直しの対象として「いま読み込まれている」範囲。操作中の面のもの。
function _csvInteractionHistoryScope() {
  const path = _csvSurfaceField(_csvInteractionSurface(), 'path');
  return path ? 'csv:' + path : '';
}

// 取り消し・やり直しを当てる面。記録した面が同じCSVを開いたままならその面、
// 無ければ同じCSVを開いている面（メイン優先）。どの面も開いていなければ null。
function _csvSurfaceForHistory(surface, path) {
  const pathOf = candidate => _csvSurfaceField(candidate, 'path');
  const alive = candidate => candidate === _csvMainSurface || _csvSubSurfaces.get(candidate.container) === candidate;
  if (alive(surface) && pathOf(surface) === path) return surface;
  return [_csvMainSurface, ..._csvSubSurfaces.values()].find(candidate => pathOf(candidate) === path) || null;
}

function _csvSnapshot() {
  return _csvData.map(row => Array.isArray(row) ? row.slice() : []);
}

function _csvSnapshotsEqual(a, b) {
  return serializeCsv(a || []) === serializeCsv(b || []);
}

function _csvMarkDirty() {
  _csvDirty = true;
  _csvSaveVersion += 1;
  if (_csvSaveInFlight) _csvSaveQueued = true;
  if (_csvSurface !== _csvMainSurface) {
    // 独立した描画先の面: 自分のファイルを指定して印を付ける（メインのシート用の列情報には触らない）。
    if (typeof markAutoVersionDirty === 'function') markAutoVersionDirty(_csvPath, 'file');
    return;
  }
  if (typeof markAutoVersionDirty === 'function') markAutoVersionDirty();
  globalThis.MeldexCsvWorkbench?.reconcile?.();
}

function _csvRestoreSnapshot(snapshot) {
  _csvData = (snapshot || []).map(row => Array.isArray(row) ? row.slice() : []);
  _csvHeaders = _csvData.length > 0 ? _csvData[0] : [];
  _csvNormalizeTableShape();
  _csvMarkDirty();
  renderCsvTable();
  scheduleCsvAutoSave();
}

function _csvRegisterHistory(label, beforeSnapshot) {
  const before = (beforeSnapshot || []).map(row => Array.isArray(row) ? row.slice() : []);
  const after = _csvSnapshot();
  if (_csvSnapshotsEqual(before, after)) return false;
  if (typeof historyPush === 'function') {
    // 取り消し・やり直しは、記録した面（同じCSVを開いたままの面）へ当てる。
    const surface = _csvSurface;
    const path = _csvPath;
    const restore = snapshot => {
      const target = _csvSurfaceForHistory(surface, path);
      if (target) _csvOnSurface(target, () => _csvRestoreSnapshot(snapshot));
    };
    historyPush(label,
      () => restore(before),
      () => restore(after),
      _csvHistoryScope()
    );
  }
  _csvMarkDirty();
  scheduleCsvAutoSave();
  return true;
}

// ── ツールバーの自動リンクの切り替え（CSVごと） ──
// CSVの書式には表示設定を入れる場所が無く、横に置く設定ファイルの置き場（.meldex）は保存フォルダ内で
// 使えないため、この端末の中にファイルごとに覚える（ファイルIDで引くので改名・移動でも保たれる）。
const _CSV_DISPLAY_LAYERS_KEY = 'meldex.csvDisplayLayers.v1';
function _csvDisplayLayersKey(path) {
  try { if (typeof _pathToFileId === 'function') return _pathToFileId(path) || String(path || ''); } catch {}
  return String(path || '');
}
function _csvReadDisplayLayers(path) {
  try {
    const store = JSON.parse(localStorage.getItem(_CSV_DISPLAY_LAYERS_KEY) || '{}');
    return store && typeof store === 'object' ? store[_csvDisplayLayersKey(path)] || null : null;
  } catch { return null; }
}
function _csvWriteDisplayLayers(path, next) {
  try {
    const raw = JSON.parse(localStorage.getItem(_CSV_DISPLAY_LAYERS_KEY) || '{}');
    const store = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    store[_csvDisplayLayersKey(path)] = { autoLinks: !!next.autoLinks };
    localStorage.setItem(_CSV_DISPLAY_LAYERS_KEY, JSON.stringify(store));
    return true;
  } catch { return false; }
}
function _csvRegisterDisplayLayers(path) {
  if (!(typeof globalThis.MeldexDisplayLayers?.registerApp === 'function') || !path) return;
  if (!_csvRegisterDisplayLayers.done) {
    _csvRegisterDisplayLayers.done = true;
    MeldexDisplayLayers.registerApp('csv', {
      supportsAutoRuby: false,
      pathForButton() { return _csvMainPath(); },
      async write(target, next) {
        if (!_csvWriteDisplayLayers(target, next)) return false;
        MeldexDisplayLayers.setFileState(target, next, { supportsAutoRuby: false });
        // そのCSVを表示している面だけを描き直す（読み直しはしない）。
        _csvForEachSurface(() => {
          if (target !== _csvPath) return;
          if (_csvSheetModeActive && globalThis.MeldexCsvWorkbench) globalThis.MeldexCsvWorkbench.render();
          else renderCsvTable();
        });
        return true;
      },
    });
  }
  MeldexDisplayLayers.setFileState(path, _csvReadDisplayLayers(path), { supportsAutoRuby: false });
  MeldexDisplayLayers.refreshControls();
}

function _csvSetDecoratedText(el, text) {
  if (!el) return;
  const displayText = String(text ?? '');
  el.textContent = displayText;
  if (typeof MeldexAutoLink === 'undefined' || displayText.length < 2) return;
  MeldexAutoLink.applyToDom(el, _csvPath || '');
}

function _csvHandleAutoLinkClick(e) {
  const link = e?.target?.closest?.('.auto-link[data-path]');
  if (!link || typeof onAutoLinkClick !== 'function') return false;
  e.preventDefault();
  e.stopPropagation();
  onAutoLinkClick(link, e);
  return true;
}

function _csvDisplayLabel(label, path) {
  return String(label || path || '').split(/[\\/]/).pop() || 'CSV';
}

function _csvCanUseSheetSurface() {
  const table = typeof document !== 'undefined' ? document.getElementById('pivot-table') : null;
  return typeof document !== 'undefined'
    && !!table
    && typeof table.appendChild === 'function'
    && typeof table.setAttribute === 'function'
    && typeof showView === 'function';
}

function _csvIcon(name, fallback) {
  if (typeof lucide === 'function') return lucide(name, 16);
  return fallback || '';
}

function _csvToolbarButton(title, iconName, fallback, handler, e2eId) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'tb-icon-btn csv-sheet-action-btn';
  button.title = title;
  button.setAttribute('aria-label', title);
  if (e2eId) button.dataset.e2eId = e2eId;
  button.innerHTML = _csvIcon(iconName, fallback);
  button.addEventListener('click', handler);
  return button;
}

function _csvToolbarTextButton(label, handler, e2eId) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'tb-text-btn csv-sheet-action-btn';
  if (e2eId) button.dataset.e2eId = e2eId;
  button.textContent = label;
  button.addEventListener('click', handler);
  return button;
}

function _csvClearSheetToolbar() {
  const actions = document.querySelector('#tb-db .db-toolbar-actions-right');
  if (actions?.dataset?.csvSheetMode === '1') {
    actions.textContent = '';
    delete actions.dataset.csvSheetMode;
  }
}

function _csvSyncSheetViewSwitcher() {
  const tabs = document.getElementById('db-view-tabs');
  if (tabs) {
    tabs.textContent = '';
    tabs.dataset.csvSheetMode = '1';
    const tab = document.createElement('div');
    tab.className = 'view-tab active db-csv-view-tab';
    tab.setAttribute('aria-current', 'page');
    const label = document.createElement('span');
    label.className = 'view-tab-label';
    label.textContent = 'CSV';
    tab.appendChild(label);
    tabs.appendChild(tab);
  }

  const select = document.getElementById('db-view-select');
  if (select) {
    select.textContent = '';
    select.dataset.csvSheetMode = '1';
    const option = document.createElement('option');
    option.value = 'csv';
    option.textContent = 'CSV';
    select.appendChild(option);
    select.value = 'csv';
    select.onchange = () => { select.value = 'csv'; };
  }
}

function deactivateCsvSheetMode() {
  // シートモードはメインパネルのCSVだけが使う。
  if (_csvSurface !== _csvMainSurface) return _csvOnSurface(_csvMainSurface, deactivateCsvSheetMode);
  _csvSheetModeActive = false;
  globalThis.MeldexCsvWorkbench?.deactivate?.();
  if (document.body?.dataset) delete document.body.dataset.csvSheetMode;
  _csvClearSheetToolbar();
  const tabs = document.getElementById('db-view-tabs');
  if (tabs?.dataset?.csvSheetMode === '1') {
    delete tabs.dataset.csvSheetMode;
    tabs.textContent = '';
  }
  const select = document.getElementById('db-view-select');
  if (select?.dataset?.csvSheetMode === '1') {
    delete select.dataset.csvSheetMode;
    select.textContent = '';
    select.onchange = null;
  }
  const table = document.getElementById('pivot-table');
  if (table?.classList?.contains('csv-sheet-mode-table')) {
    table.classList.remove('csv-sheet-mode-table');
    table.classList.add('pivot-table');
    table.removeAttribute('data-csv-path');
    table.removeAttribute('aria-label');
    table.style.removeProperty('min-width');
  }
}

function _csvSyncSheetToolbar(label, path, openOpts) {
  if (document.body?.dataset) document.body.dataset.csvSheetMode = '1';
  _csvSyncSheetViewSwitcher();
  const displayLabel = _csvDisplayLabel(label, path);
  const toolbarCategoryEl = document.getElementById('toolbar-category');
  if (toolbarCategoryEl && !openOpts?.skipGlobalUi) {
    if (toolbarCategoryEl._dbRenameHandler) {
      toolbarCategoryEl.removeEventListener('dblclick', toolbarCategoryEl._dbRenameHandler);
      toolbarCategoryEl._dbRenameHandler = null;
    }
    toolbarCategoryEl.textContent = displayLabel;
    toolbarCategoryEl.title = 'CSVファイル';
    toolbarCategoryEl.style.cursor = '';
    if (typeof window !== 'undefined') window.MeldexFileLockBadge?.apply?.(toolbarCategoryEl, path);
  }
  const currentTitleEl = document.getElementById('current-title');
  if (currentTitleEl && !openOpts?.skipGlobalUi) currentTitleEl.textContent = displayLabel;
  const actions = document.querySelector('#tb-db .db-toolbar-actions-right');
  if (!actions) return;
  actions.dataset.csvSheetMode = '1';
  actions.textContent = '';
  actions.appendChild(_csvToolbarButton('行を追加', 'listPlus', '+', addCsvRow, 'csv-sheet-add-row'));
  actions.appendChild(_csvToolbarButton('列を追加', 'columns3', '+', addCsvColumn, 'csv-sheet-add-column'));
  actions.appendChild(_csvToolbarTextButton('シートに変換', convertCsvToDb, 'csv-sheet-convert-to-sheet'));
}

function _csvPrepareVisibleSurface(label, path, openOpts) {
  if (openOpts.skipShowView) {
    // Pane restoration mounts the sheet container without showView().
    // Select the same renderer as that container, including first startup.
    if (openOpts.bridgeLoad && !_csvRenderContainerOverride) {
      _csvSheetModeActive = _csvCanUseSheetSurface();
    }
    return;
  }
  if (_csvCanUseSheetSurface()) {
    _csvSheetModeActive = true;
    showView('pivot');
    if (!openOpts.skipStateView) state.view = 'csv';
    _csvSyncSheetToolbar(label, path, openOpts);
    if (typeof updateCsvShortcutStatusbar === 'function') updateCsvShortcutStatusbar();
    return;
  }
  _csvSheetModeActive = false;
  showView('csv');
}

function _csvRefreshAnnotationTarget() {
  if (typeof ann === 'undefined') return;
  const newTarget = typeof getAnnotationTarget === 'function' ? getAnnotationTarget() : _csvPath;
  if (newTarget !== ann.targetPath) {
    ann.targetPath = newTarget;
    if (typeof loadAnnotations === 'function') loadAnnotations();
  }
  if (typeof _setupOverlayScroll === 'function') _setupOverlayScroll('csv');
}

function _csvRenderMessage(message) {
  if (_csvSheetModeActive && _csvCanUseSheetSurface()) {
    const table = document.getElementById('pivot-table');
    table.className = 'pivot-table csv-sheet-mode-table';
    table.innerHTML = '';
    const tbody = document.createElement('tbody');
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.className = 'csv-empty-cell';
    td.colSpan = 999;
    td.textContent = message;
    tr.appendChild(td);
    tbody.appendChild(tr);
    table.appendChild(tbody);
    return;
  }
  const container = _csvTableContainerEl();
  if (container) container.innerHTML = '<div style="padding:16px;color:var(--fg2);">' + message + '</div>';
}

// === CSVファイルを開く ===
async function openCsvFile(label, path, opts) {
  const openOpts = opts || {};
  // 開く先の面（メイン／独立した描画先）。別の面をつないでいる時は、自分の面をつないで入り直す
  // （呼び出し元へ戻る時には元の面へ戻っている）。待ちの後は _csvEnterSurface で自分の面をつなぎ直す。
  const surface = _csvSurfaceForContainer(openOpts.containerEl || null);
  if (_csvSurface !== surface) return _csvOnSurface(surface, () => openCsvFile(label, path, opts));
  const coordinator = window.MeldexDocumentSaveCoordinator;
  let documentKeyAtOpen = coordinator ? coordinator.documentKeyForPath(path) : path;
  const conflictGenerationAtOpen = Object.prototype.hasOwnProperty.call(openOpts, 'conflictGeneration')
    ? openOpts.conflictGeneration
    : null;
  const requireExactConflictGeneration = Object.prototype.hasOwnProperty.call(openOpts, 'conflictGeneration')
    && conflictGenerationAtOpen != null;
  const showGlobalLoading = !openOpts.bridgeLoad && !openOpts.silent
    && typeof showLoading === 'function' && typeof hideLoading === 'function';
  // 前のCSVの未保存変更をフラッシュ
  if (_csvDirty && _csvPath && !openOpts.discardDirty) {
    clearTimeout(_csvAutoSaveTimer);
    const saved = await saveCsv();
    _csvEnterSurface(surface);
    if (!saved) return false;
  }
  // 状態は面ごとなので、ここで開いても他の面（メイン／サブパネル）の表示・編集内容には触らない
  // （以前の「切り替わりました」の表示は廃止）。
  const loading = showGlobalLoading ? showLoading('CSVを読み込み中...', { key: 'csv:' + path }) : null;
  const openSeq = ++_csvOpenSeq;
    _csvPath = '';
    _csvData = [];
    _csvHeaders = [];
    _csvDirty = false;
    _csvSaveQueued = false;
    _csvLastSavedEtag = '';
    _csvLastSavedContent = null;
    _csvLastSavedTransportRevision = '';
    clearTimeout(_csvAutoSaveTimer);

    _csvDialect = null;

  // 独立した描画先（サブパネル等）は共有シングルトンの#pivot-table（シートモード）
  // を絶対に取り合わない。containerEl指定時は常に専用DOMへの直接描画（非シートモード）
  // へ強制する。
  _csvRenderContainerOverride = surface.container;
  if (_csvRenderContainerOverride) _csvSheetModeActive = false;

  if (!openOpts.skipStateView) state.view = 'csv';
  _csvPrepareVisibleSurface(label, path, openOpts);
  if (!openOpts.skipGlobalUi) {
    const csvTitleEl = document.getElementById('csv-title');
    if (csvTitleEl) csvTitleEl.textContent = label;
    if (typeof window !== 'undefined') window.MeldexFileLockBadge?.apply?.(csvTitleEl, path);
  }
  const currentTitleEl = document.getElementById('current-title');
  if (currentTitleEl && !openOpts.skipGlobalUi) currentTitleEl.textContent = label;
  if (!openOpts.skipSaveLastView) saveLastView({ type: 'csv', label, path });
  if (!openOpts.skipNavPush) {
    const _navEntry = { type: 'csv', label, path };
    navPush(_navEntry);
  }
  if (!openOpts.skipRecent) addRecent(label, path, 'csv');
  if (!openOpts.skipHighlight) highlightOutlinerNode(path);

  try {
    const data = openOpts.prefetchedData || await apiFetch('/file?path=' + encodeURIComponent(path));
    _csvEnterSurface(surface);
    if (_csvOpenSeq !== openSeq) return false;
    if (coordinator) documentKeyAtOpen = coordinator.bindDocumentIdentity(path, data) || documentKeyAtOpen;
    const raw = data.content || '';
    _csvLastSavedContent = /^utf-?8(?:-sig)?$/i.test(String(data.encoding || 'utf-8'))
      ? ((data.bom && !raw.startsWith('\ufeff') ? '\ufeff' : '') + raw) : null;
    if (showGlobalLoading && typeof showLoadingBeforeHeavyWork === 'function') {
      await showLoadingBeforeHeavyWork(raw, '大きいCSVを描画中...', { loading });
      _csvEnterSurface(surface);
      if (_csvOpenSeq !== openSeq) return false;
    }
    const parsedResult = globalThis.MeldexCsv
      ? globalThis.MeldexCsv.parse(raw, {
        encoding: data.encoding || '',
        delimiter: data.delimiter || '',
        newline: data.newline || '',
        bom: data.bom,
      })
      : { rows: parseCsv(raw), dialect: null };
    const parsed = parsedResult.rows;
    if (
      requireExactConflictGeneration
      && coordinator?.getConflict?.(documentKeyAtOpen)?.generation !== conflictGenerationAtOpen
    ) {
      throw new Error('CSV conflict generation changed while reloading');
    }
    _csvPath = path;
    _csvDialect = parsedResult.dialect || null;
    _csvRegisterDisplayLayers(path);
    _csvData = parsed;
    _csvHeaders = _csvData.length > 0 ? _csvData[0] : [];
    _csvLastSavedEtag = data.etag || '';
    _csvLastSavedTransportRevision = coordinator
      ? coordinator.normalizeTransportRevision(
        coordinator.currentTransportName(),
        data.transport_revision || data.etag || '',
      )
      : (data.etag || '');
    _csvNormalizeTableShape();
    // MeldexCsvWorkbench.render()は state().active（=_csvSheetModeActive）が false だと
    // 何もせず false を返す（共有 #pivot-table を使わないため）。独立した描画先
    // （サブパネル等）へ強制的に非シートモードで開いた場合にここを無条件で呼ぶと、
    // 表がどちらの経路からも描画されず空白のままになる。_csvSheetModeActive で分岐する。
    if (_csvSheetModeActive && globalThis.MeldexCsvWorkbench) {
      await globalThis.MeldexCsvWorkbench.open({
        path,
        rows: _csvData,
        dialect: parsedResult.dialect,
      });
      _csvEnterSurface(surface);
      if (_csvOpenSeq !== openSeq) return false;
    } else {
      renderCsvTable();
    }
    // 取り消しスコープは _csvData が最終読み込み内容になった後（読み込み中の
    // 別データを取り消しが巻き戻して上書きされないよう）に切り替える。
    // フェッチより前に呼ぶと、切替直後・読込完了前の取り消しがこの読込完了で
    // 上書きされ消える（app/docs/undo-pane-context_plan_2026-07-25.md §9 既知バグ）。
    // 独立した描画先（サブパネル等）は、開いただけでは取り消しの対象を切り替えない
    // （その面を操作した時に GBEditorHost が切り替える。メインの取り消しの対象を奪わない）。
    if (!openOpts.skipHistoryScope && !surface.container && typeof historySetScope === 'function') historySetScope('csv:' + path);
    // 独立した描画先（サブパネル等）はアノテートオーバーレイを描画しないため、メイン画面の
    // アノテート対象（ann.targetPath）をここで奪わない。
    if (!openOpts.skipGlobalUi) _csvRefreshAnnotationTarget();
    if (!openOpts.skipAutoVersion && typeof startAutoVersion === 'function') startAutoVersion(path, 'file');
    if (!openOpts.skipGlobalUi) showStatus('CSV: ' + label);
    // 競合確認からの明示的な再読込だけを、表の描画と後続UI更新がすべて
    // 成功した時点で解決済みとする。ここより前で解除すると、後続処理の例外時に
    // 読込失敗表示へ戻ったのに競合だけ消える状態になり得る。
    if (coordinator && conflictGenerationAtOpen != null) {
      const resolved = coordinator.resolveConflict(documentKeyAtOpen, conflictGenerationAtOpen);
      if (!resolved) throw new Error('CSV conflict generation changed before reload completed');
      window.MeldexConflictPendingBanner?.hide?.(documentKeyAtOpen);
    } else if (coordinator?.getConflict?.(documentKeyAtOpen)) {
      _csvShowConflictPending(documentKeyAtOpen);
    }
  } catch {
    _csvEnterSurface(surface);
    if (_csvOpenSeq !== openSeq) return false;
    _csvPath = '';
    _csvData = [];
    _csvHeaders = [];
    _csvDirty = false;
    _csvSaveQueued = false;
    _csvLastSavedEtag = '';
    _csvLastSavedContent = null;
    _csvLastSavedTransportRevision = '';
    _csvRenderMessage('CSVを読み込めませんでした');
    if (!openOpts.skipGlobalUi) showStatus('CSVを読み込めませんでした', true);
    return false;
  } finally {
    if (showGlobalLoading) hideLoading(loading);
  }
  return true;
}

// === CSVパーサー（RFC 4180準拠） ===
function parseCsv(text) {
  if (globalThis.MeldexCsv) return globalThis.MeldexCsv.parse(text).rows;
  const normalized = String(text || '').replace(/^\uFEFF/, '');
  const rows = [];
  let row = [];
  let cell = '';
  let inQuote = false;
  let sawCell = false;
  for (let i = 0; i < normalized.length; i++) {
    const c = normalized[i];
    if (inQuote) {
      if (c === '"' && normalized[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') { inQuote = false; }
      else { cell += c; }
    } else {
      if (c === '"') { inQuote = true; sawCell = true; }
      else if (c === ',') { row.push(cell); cell = ''; sawCell = true; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && normalized[i + 1] === '\n') i++; // \r\n
        row.push(cell); cell = '';
        rows.push(row); row = []; sawCell = false;
      } else { cell += c; sawCell = true; }
    }
  }
  if (sawCell || cell || row.length > 0) { row.push(cell); rows.push(row); }
  return rows;
}

function serializeCsv(data) {
  if (globalThis.MeldexCsv) {
    return globalThis.MeldexCsv.serialize(data, {
      delimiter: ',',
      newline: '\r\n',
      bom: false,
      finalNewline: false,
    });
  }
  return data.map(row =>
    row.map(cell => {
      const s = String(cell ?? '');
      if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
        return '"' + s.replace(/"/g, '""') + '"';
      }
      return s;
    }).join(',')
  ).join('\n');
}

function _csvNormalizeTableShape() {
  if (_csvData.length === 0) {
    _csvHeaders = [];
    return;
  }
  if (!Array.isArray(_csvData[0])) _csvData[0] = [];
  _csvHeaders = _csvData[0];
  const maxCols = _csvData.reduce((max, row) => Math.max(max, Array.isArray(row) ? row.length : 0), 0);
  while (_csvHeaders.length < maxCols) {
    _csvHeaders.push(_csvUniqueHeader('列' + (_csvHeaders.length + 1)));
  }
  for (let i = 1; i < _csvData.length; i++) {
    if (!Array.isArray(_csvData[i])) _csvData[i] = [];
    while (_csvData[i].length < _csvHeaders.length) _csvData[i].push('');
  }
}

// === テーブルレンダリング ===
// 今つないでいる面の中だけを探す（メインの面は、独立した描画先の中の要素を除く）。
function _csvQueryAllInSurface(selector) {
  if (_csvRenderContainerOverride) return [..._csvRenderContainerOverride.querySelectorAll(selector)];
  if (typeof document === 'undefined' || typeof document.querySelectorAll !== 'function') return [];
  return [...document.querySelectorAll(selector)].filter(el => !_csvSubSurfaceOfElement(el));
}

function _csvClearSelection() {
  _csvQueryAllInSurface('.csv-cell-selected').forEach(el => el.classList.remove('csv-cell-selected'));
}

function _csvAppendHeaderCell(headerRow, headerText, ci) {
  const th = document.createElement('th');
  _csvSetDecoratedText(th, headerText);
  th.dataset.col = ci;
  th.dataset.csvCol = ci;
  th.addEventListener('click', _csvSurfaceHandler((e) => {
    if (_csvHandleAutoLinkClick(e)) return;
    if (th.querySelector('input')) return;
    if (th.classList.contains('csv-cell-selected')) {
      startCsvHeaderEdit(th, ci);
      return;
    }
    _csvClearSelection();
    th.classList.add('csv-cell-selected');
  }));
  th.addEventListener('dblclick', _csvSurfaceHandler(() => startCsvHeaderEdit(th, ci)));
  headerRow.appendChild(th);
}

function _csvAppendDataCell(tr, row, ri, ci) {
  const td = document.createElement('td');
  _csvSetDecoratedText(td, row[ci] ?? '');
  td.dataset.row = ri;
  td.dataset.col = ci;
  td.dataset.csvRow = ri;
  td.dataset.csvCol = ci;
  td.addEventListener('click', _csvSurfaceHandler((e) => {
    if (_csvHandleAutoLinkClick(e)) return;
    if (td.querySelector('input, textarea')) return;
    if (td.classList.contains('csv-cell-selected')) {
      startCsvCellEdit(td, ri, ci);
      return;
    }
    _csvClearSelection();
    td.classList.add('csv-cell-selected');
  }));
  td.addEventListener('dblclick', _csvSurfaceHandler(() => startCsvCellEdit(td, ri, ci)));
  tr.appendChild(td);
}

function _csvBuildTable(table) {
  table.innerHTML = '';
  const thead = document.createElement('thead');
  const headerRow = document.createElement('tr');
  const thNum = document.createElement('th');
  thNum.className = 'csv-row-num';
  thNum.textContent = '#';
  headerRow.appendChild(thNum);
  _csvHeaders.forEach((h, ci) => _csvAppendHeaderCell(headerRow, h, ci));
  thead.appendChild(headerRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  for (let ri = 1; ri < _csvData.length; ri++) {
    const tr = document.createElement('tr');
    tr.dataset.csvRow = ri;
    const tdNum = document.createElement('td');
    tdNum.className = 'csv-row-num';
    tdNum.textContent = ri;
    tr.appendChild(tdNum);
    const row = _csvData[ri];
    for (let ci = 0; ci < _csvHeaders.length; ci++) {
      _csvAppendDataCell(tr, row, ri, ci);
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
}

function _csvRenderSheetTable() {
  const table = document.getElementById('pivot-table');
  if (!_csvCanUseSheetSurface()) return false;
  if (_csvData.length === 0) {
    _csvRenderMessage('空のCSVファイルです');
    return true;
  }
  table.className = 'pivot-table csv-sheet-mode-table';
  table.dataset.csvPath = _csvPath || '';
  table.setAttribute('role', 'table');
  table.setAttribute('aria-label', 'CSV');
  table.style.minWidth = Math.max(520, (_csvHeaders.length + 1) * 120) + 'px';
  _csvBuildTable(table);
  return true;
}

function _csvRenderLegacyTable() {
  const container = _csvTableContainerEl();
  if (!container) return;
  if (_csvData.length === 0) {
    _csvRenderMessage('空のCSVファイルです');
    return;
  }
  const table = document.createElement('table');
  table.id = 'csv-table';
  table.className = 'csv-table';
  _csvBuildTable(table);
  container.innerHTML = '';
  container.appendChild(table);
}

function renderCsvTable() {
  if (_csvSheetModeActive && globalThis.MeldexCsvWorkbench?.render?.()) return;
  if (_csvSheetModeActive && _csvRenderSheetTable()) return;
  _csvRenderLegacyTable();
}

function _csvUniqueHeader(base) {
  const excludeIndex = arguments.length > 1 ? arguments[1] : null;
  const used = new Set(_csvHeaders
    .map((h, index) => index === excludeIndex ? null : String(h))
    .filter(h => h != null && h !== ''));
  const cleanBase = String(base || '').trim() || '列';
  let name = cleanBase;
  let i = 2;
  while (used.has(name)) {
    name = `${cleanBase} ${i}`;
    i++;
  }
  return name;
}

function _csvEnsureEditableHeader() {
  if (_csvData.length === 0) _csvData.push([]);
  if (_csvHeaders.length === 0) {
    const name = _csvUniqueHeader('列1');
    _csvHeaders.push(name);
    _csvData[0].push(name);
  }
}

// === セル編集 ===
function startCsvCellEdit(td, ri, ci) {
  // セルのある面（メイン／独立した描画先）のデータを編集する。
  const cellSurface = _csvSubSurfaceOfElement(td) || _csvMainSurface;
  if (_csvSurface !== cellSurface) return _csvOnSurface(cellSurface, () => startCsvCellEdit(td, ri, ci));
  if (td.querySelector('input, textarea')) return;
  const value = _csvData[ri]?.[ci] ?? '';
  const isMultiline = value.includes('\n');
  let cancelled = false;

  if (isMultiline) {
    const ta = document.createElement('textarea');
    ta.value = value;
    ta.className = 'csv-cell-input';
    ta.dataset.csvEditKind = 'cell';
    ta.dataset.row = String(ri);
    ta.dataset.col = String(ci);
    td.textContent = '';
    td.appendChild(ta);
    ta.focus();
    ta.addEventListener('blur', _csvSurfaceHandler(() => { if (!cancelled && ta.dataset.csvCommitHandled !== '1') commitCsvCellEdit(td, ta.value, ri, ci); }));
    ta.addEventListener('keydown', _csvSurfaceHandler((e) => {
      if (e.key === 'Enter' && e.ctrlKey) ta.blur(); // Ctrl+Enterで確定
      else if (e.key === 'Escape') { cancelled = true; _csvSetDecoratedText(td, value); }
    }));
  } else {
    const input = document.createElement('input');
    input.type = 'text';
    input.value = value;
    input.className = 'csv-cell-input';
    input.dataset.csvEditKind = 'cell';
    input.dataset.row = String(ri);
    input.dataset.col = String(ci);
    td.textContent = '';
    td.appendChild(input);
    input.focus();
    input.select();
    input.addEventListener('blur', _csvSurfaceHandler(() => { if (!cancelled && input.dataset.csvCommitHandled !== '1') commitCsvCellEdit(td, input.value, ri, ci); }));
    input.addEventListener('keydown', _csvSurfaceHandler((e) => {
      if (e.key === 'Enter') input.blur();
      else if (e.key === 'Escape') { cancelled = true; _csvSetDecoratedText(td, value); }
      else if (e.key === 'Tab') { e.preventDefault(); input.blur(); moveCsvFocus(ri, ci, e.shiftKey ? -1 : 1); }
    }));
  }
}

function commitCsvCellEdit(td, newValue, ri, ci) {
  if (!_csvData[ri]) return;
  const oldValue = _csvData[ri]?.[ci] ?? '';
  if (String(oldValue) === String(newValue)) {
    _csvSetDecoratedText(td, newValue);
    return;
  }
  const before = _csvSnapshot();
  while (_csvData[ri].length <= ci) _csvData[ri].push('');
  _csvData[ri][ci] = newValue;
  _csvSetDecoratedText(td, newValue);
  _csvRegisterHistory('CSVセル編集', before);
}

function startCsvHeaderEdit(th, ci) {
  const cellSurface = _csvSubSurfaceOfElement(th) || _csvMainSurface;
  if (_csvSurface !== cellSurface) return _csvOnSurface(cellSurface, () => startCsvHeaderEdit(th, ci));
  if (th.querySelector('input')) return;
  const value = _csvHeaders[ci] ?? '';
  let cancelled = false;
  const input = document.createElement('input');
  input.type = 'text';
  input.value = value;
  input.className = 'csv-cell-input';
  input.dataset.csvEditKind = 'header';
  input.dataset.col = String(ci);
  th.textContent = '';
  th.appendChild(input);
  input.focus();
  input.select();
  input.addEventListener('blur', _csvSurfaceHandler(() => {
    if (cancelled || input.dataset.csvCommitHandled === '1') return;
    commitCsvHeaderEdit(th, input.value, ci);
  }));
  input.addEventListener('keydown', _csvSurfaceHandler((e) => {
    if (e.key === 'Enter') input.blur();
    else if (e.key === 'Escape') { cancelled = true; _csvSetDecoratedText(th, value); }
  }));
}

function commitCsvHeaderEdit(th, newValue, ci) {
  if (!_csvData[0]) _csvData[0] = [];
  const normalizedValue = _csvUniqueHeader(newValue || ('列' + (ci + 1)), ci);
  if (String(_csvHeaders[ci] ?? '') === String(normalizedValue)) {
    _csvSetDecoratedText(th, normalizedValue);
    return;
  }
  const before = _csvSnapshot();
  _csvHeaders[ci] = normalizedValue;
  _csvData[0][ci] = normalizedValue;
  _csvSetDecoratedText(th, normalizedValue);
  _csvRegisterHistory('CSVヘッダー編集', before);
}

function moveCsvFocus(ri, ci, direction) {
  const nextCi = ci + direction;
  if (nextCi >= 0 && nextCi < _csvHeaders.length) {
    const td = _csvQueryAllInSurface(
      '#csv-table td[data-row="' + ri + '"][data-col="' + nextCi + '"], ' +
      '#pivot-table.csv-sheet-mode-table td[data-row="' + ri + '"][data-col="' + nextCi + '"]'
    )[0];
    if (td) startCsvCellEdit(td, ri, nextCi);
  }
}

// === 自動保存 ===
function scheduleCsvAutoSave() {
  clearTimeout(_csvAutoSaveTimer);
  // 自動保存は、予約した面（メイン／独立した描画先）のファイルだけを保存する。
  const surface = _csvSurface;
  _csvAutoSaveTimer = setTimeout(() => _csvOnSurface(surface, saveCsv), 2000);
}

function _csvCommitActiveEditor() {
  if (typeof document === 'undefined' || typeof document.querySelector !== 'function') return false;
  // 今つないでいる面の編集中のセルだけを確定する（他の面の編集中のセルには触らない）。
  let editor = _csvRenderContainerOverride
    ? _csvRenderContainerOverride.querySelector('.csv-cell-input')
    : document.querySelector('#csv-table .csv-cell-input, #pivot-table.csv-sheet-mode-table .csv-cell-input');
  if (editor && !_csvRenderContainerOverride && _csvSubSurfaceOfElement(editor)) {
    editor = _csvQueryAllInSurface('#csv-table .csv-cell-input, #pivot-table.csv-sheet-mode-table .csv-cell-input')[0] || null;
  }
  if (!editor) return false;
  const host = editor.closest?.('td,th');
  if (!host) return false;
  editor.dataset.csvCommitHandled = '1';
  const kind = editor.dataset.csvEditKind || '';
  if (kind === 'header') {
    commitCsvHeaderEdit(host, editor.value, Number(editor.dataset.col || 0));
    return true;
  }
  commitCsvCellEdit(host, editor.value, Number(editor.dataset.row || 0), Number(editor.dataset.col || 0));
  return true;
}

function _csvSavePayload() {
  // 独立した描画先（サブパネル等）の面は、自分が読み込んだCSVの書式で書き出す
  // （MeldexCsvWorkbench が持つ書式はメインパネルのCSVのもの）。
  if (_csvSurface !== _csvMainSurface) {
    if (globalThis.MeldexCsv?.serialize && globalThis.MeldexCsv?.normalizeDialect) {
      const serialized = String(globalThis.MeldexCsv.serialize(_csvData, globalThis.MeldexCsv.normalizeDialect(_csvDialect)) || '');
      return serialized.startsWith('\uFEFF') ? serialized : `\uFEFF${serialized}`;
    }
    return '\uFEFF' + serializeCsv(_csvData);
  }
  if (globalThis.MeldexCsvWorkbench?.serialize) {
    const serialized = String(globalThis.MeldexCsvWorkbench.serialize() || '');
    return serialized.startsWith('\uFEFF') ? serialized : `\uFEFF${serialized}`;
  }
  return '\uFEFF' + serializeCsv(_csvData);
}

function _csvIsMissingSaveResult(result) {
  return !!(result?.skipped || result?.missing);
}

// 工程2-C項目4: 本物の409だけを共通conflict-pending導線へ接続する。CSVの
// 既存single-flightキュー（_csvSaveInFlight/_csvSaveQueued）とetag更新は
// そのまま維持し、別実装で置き換えない。
function _csvDocumentKey(path) {
  const coordinator = window.MeldexDocumentSaveCoordinator;
  return coordinator ? coordinator.documentKeyForPath(path) : path;
}

function _csvShowConflictPending(documentKey) {
  // 「確認する」は、競合を出した面（メイン／独立した描画先）の編集内容を対象にする。
  const surface = _csvSurface;
  window.MeldexConflictPendingBanner?.show?.(documentKey, {
    label: '競合を保留中',
    e2eId: 'csv-conflict-pending-banner',
    onConfirm: () => {
      _csvOnSurface(surface, () => _csvReloadAfterConflict()).catch(() => showStatus('最新版の取得に失敗しました', true));
    },
  });
}

// 独立した描画先（サブパネル等）の面を開き直す時の指定（メインの画面・履歴・タブには触らない）。メインの面は空。
function _csvSurfaceReopenOpts() {
  if (!_csvRenderContainerOverride) return {};
  return {
    containerEl: _csvRenderContainerOverride,
    skipShowView: true,
    skipGlobalUi: true,
    skipStateView: true,
    skipSaveLastView: true,
    skipHighlight: true,
    silent: true,
  };
}

function _csvHasActiveEditor() {
  if (_csvRenderContainerOverride) return !!_csvRenderContainerOverride.querySelector('.csv-cell-input');
  return _csvQueryAllInSurface('#csv-table .csv-cell-input, #pivot-table.csv-sheet-mode-table .csv-cell-input').length > 0;
}

// 保存済みの内容を、今つないでいる面へそのまま反映する（通信しない）。未保存の編集がある面には使わない。
function _csvApplySavedContentToSurface(content, result) {
  const text = String(content);
  const parsed = globalThis.MeldexCsv.parse(text, {
    encoding:'utf-8', bom:text.startsWith('\ufeff'),
  });
  clearTimeout(_csvAutoSaveTimer);
  _csvData = parsed.rows;
  _csvHeaders = _csvData[0] || [];
  _csvNormalizeTableShape();
  _csvDialect = parsed.dialect || _csvDialect;
  _csvLastSavedEtag = result.etag;
  _csvLastSavedContent = text;
  const coordinator = window.MeldexDocumentSaveCoordinator;
  _csvLastSavedTransportRevision = coordinator
    ? coordinator.normalizeTransportRevision(coordinator.currentTransportName(),result.transport_revision || result.etag)
    : result.etag;
  if (_csvSheetModeActive && globalThis.MeldexCsvWorkbench) {
    globalThis.MeldexCsvWorkbench.adoptSavedDialect(parsed.dialect);
  } else {
    renderCsvTable();
  }
}

// 同じCSVを別の面でも開いている時、保存した内容を「未保存の編集が無い」面へ反映する
// （古い内容のまま残して、後から古い内容で保存し直さないため）。未保存の編集・編集中のセルがある面は
// そのまま残す。その面の保存は版の照合で止まり、既存の「競合を保留中」の確認へ進む（黙って上書きしない）。
function _csvAdoptSavedOnOtherSurfaces(savedSurface, path, content, result) {
  if (!result?.etag || !globalThis.MeldexCsv?.parse) return;
  for (const other of [_csvMainSurface, ..._csvSubSurfaces.values()]) {
    if (other === savedSurface) continue;
    _csvOnSurface(other, () => {
      if (_csvPath !== path || _csvDirty || _csvSaveInFlight || _csvSaveQueued) return;
      if (other.container && !other.container.isConnected) return;
      if (_csvHasActiveEditor()) return;
      try { _csvApplySavedContentToSurface(content, result); } catch {}
    });
  }
}

function _csvRestoreConflictReview(documentKey, reviewRecord) {
  const coordinator = window.MeldexDocumentSaveCoordinator;
  if (coordinator && reviewRecord) {
    const current = coordinator.getConflict?.(documentKey);
    if (!current || current.generation !== reviewRecord.generation) return;
    coordinator.restoreConflict?.(documentKey, reviewRecord);
  }
  _csvShowConflictPending(documentKey);
}

// 「確認する」導線（計画書§2.6・§5工程2-A項目7の等価物）。CSVは差分表示付きの
// 専用ダイアログを持たないため、上書き/再読込の2択に絞った確認を出す
// （保留中の未保存編集を無言で破棄しない。計画書§9「実装しないこと」）。
async function _csvReloadAfterConflict() {
  const surface = _csvSurface;
  const path = _csvPath;
  if (!path) return;
  const documentKey = _csvDocumentKey(path);
  const coordinator = window.MeldexDocumentSaveCoordinator;
  const reviewRecord = coordinator?.requestConflictReview?.(documentKey) || null;
  if (coordinator && !reviewRecord) return;
  const conflictGeneration = reviewRecord?.generation ?? null;
  window.MeldexConflictPendingBanner?.hide?.(documentKey);
  const keepLocal = typeof cfConfirm === 'function'
    ? await cfConfirm('このCSVは他の場所で更新されています。今の編集内容で上書きしますか？（キャンセルすると最新版を読み込み、今の編集内容は失われます）')
    : false;
  _csvEnterSurface(surface);
  if (keepLocal) {
    try {
      const content = _csvSavePayload();
      const result = await apiPut('/file?path=' + encodeURIComponent(path), { content, force_overwrite: true });
      _csvEnterSurface(surface);
      const resolved = coordinator?.resolveConflict?.(documentKey, conflictGeneration);
      if (coordinator && !resolved) {
        throw new Error('CSVの競合状態が更新されたため、上書き結果を確定できません');
      }
      if (_csvPath === path) {
        _csvLastSavedEtag = result?.etag || _csvLastSavedEtag;
        _csvLastSavedContent = content;
        if (coordinator && (result?.transport_revision || result?.etag)) {
          _csvLastSavedTransportRevision = coordinator.normalizeTransportRevision(
            coordinator.currentTransportName(),
            result.transport_revision || result.etag,
          );
          coordinator.bindDocumentIdentity(path, result);
        }
        _csvDirty = false;
      }
      if (resolved) window.MeldexConflictPendingBanner?.hide?.(documentKey);
      if (_csvPath === path) _csvAdoptSavedOnOtherSurfaces(surface, path, content, result);
      await window.MeldexDraftRecovery?.markSynced?.(path);
      _csvEnterSurface(surface);
      showStatus('自分の編集で上書き保存しました');
    } catch (e) {
      _csvEnterSurface(surface);
      _csvRestoreConflictReview(documentKey, reviewRecord);
      showStatus('上書き保存に失敗しました', true);
    }
    return;
  }
  // 先に最新版の取得を完了させる。旧実装は取得前にdirty/競合を解除していたため、
  // 通信失敗だけで未保存の表と再確認導線を同時に失っていた。
  const localSnapshot = {
    path: _csvPath,
    data: _csvSnapshot(),
    dirty: _csvDirty,
    saveQueued: _csvSaveQueued,
    lastSavedEtag: _csvLastSavedEtag,
    lastSavedContent: _csvLastSavedContent,
    lastSavedTransportRevision: _csvLastSavedTransportRevision,
    saveVersion: _csvSaveVersion,
    dialect: globalThis.MeldexCsvWorkbench?.getMetadata?.().dialect || null,
  };
  await window.MeldexDraftRecovery?.saveDraft?.(path, _csvSavePayload(), _csvLastSavedEtag || '');
  _csvEnterSurface(surface);
  let reloadOpenSeq = null;
  try {
    const data = await apiFetch('/file?path=' + encodeURIComponent(path));
    _csvEnterSurface(surface);
    if (_csvPath !== path) {
      _csvRestoreConflictReview(documentKey, reviewRecord);
      return;
    }
    reloadOpenSeq = _csvOpenSeq + 1;
    const opened = await openCsvFile(path.split('/').pop(), path, {
      discardDirty: true,
      prefetchedData: data,
      conflictGeneration,
      skipNavPush: true,
      skipRecent: true,
      skipAutoVersion: true,
      ..._csvSurfaceReopenOpts(),
    });
    _csvEnterSurface(surface);
    if (!opened) throw new Error('CSV reload failed');
    showStatus('最新のCSVを読み込みました');
  } catch (_) {
    _csvEnterSurface(surface);
    // この再読込自身が失敗した場合だけローカル表を戻す。途中で別のCSVを開いた
    // （openSeqが進んだ）場合は、新しい画面を古いスナップショットで巻き戻さない。
    if (reloadOpenSeq == null || _csvOpenSeq === reloadOpenSeq) {
      _csvPath = localSnapshot.path;
      _csvData = localSnapshot.data.map(row => row.slice());
      _csvHeaders = _csvData.length > 0 ? _csvData[0] : [];
      _csvDirty = localSnapshot.dirty;
      _csvSaveQueued = localSnapshot.saveQueued;
      _csvLastSavedEtag = localSnapshot.lastSavedEtag;
      _csvLastSavedContent = localSnapshot.lastSavedContent;
      _csvLastSavedTransportRevision = localSnapshot.lastSavedTransportRevision;
      _csvSaveVersion = localSnapshot.saveVersion;
      if (_csvSurface !== _csvMainSurface) {
        renderCsvTable();
      } else if (globalThis.MeldexCsvWorkbench?.open) {
        try {
          await globalThis.MeldexCsvWorkbench.open({
            path: localSnapshot.path,
            rows: _csvData,
            dialect: localSnapshot.dialect,
          });
          _csvEnterSurface(surface);
        } catch (_) {
          _csvEnterSurface(surface);
          renderCsvTable();
        }
      } else {
        renderCsvTable();
      }
    }
    _csvRestoreConflictReview(documentKey, reviewRecord);
    showStatus('最新版の取得に失敗しました', true);
  }
}

async function _csvDrainSaveQueue() {
  const surface = _csvSurface;
  let ok = true;
  const coordinator = window.MeldexDocumentSaveCoordinator;
  while (_csvSaveQueued && _csvPath && _csvDirty) {
    _csvSaveQueued = false;
    const savePath = _csvPath;
    const saveVersion = _csvSaveVersion;
    const documentKey = _csvDocumentKey(savePath);
    if (coordinator && coordinator.isConflictPending(documentKey)) {
      // conflict-pending中はネットワーク保存を止める（ローカルのdirty内容は保持したまま）。
      // 「確認する」から解決するまで、自動保存タイマーの再試行では送らない。
      window.MeldexDraftRecovery?.queueDraft?.(savePath, _csvSavePayload(), _csvLastSavedEtag || '');
      break;
    }
    const content = _csvSavePayload();
    try {
      const payload = { content, skip_if_missing: true };
      const guardedRevision = coordinator
        ? coordinator.revisionTokenForWrite(
          _csvLastSavedTransportRevision || _csvLastSavedEtag || '',
          coordinator.currentTransportName(),
        )
        : (_csvLastSavedEtag || '');
      if (guardedRevision) payload.if_match_etag = guardedRevision;
      if (_csvLastSavedTransportRevision) payload.transport_revision = _csvLastSavedTransportRevision;
      const send = previous => apiPut('/file?path=' + encodeURIComponent(savePath), {
        ...payload,
        ...(previous?.etag ? { if_match_etag: previous.etag,
          transport_revision: previous.transport_revision || coordinator?.normalizeTransportRevision(coordinator.currentTransportName(), previous.etag) || '' } : {}),
      });
      const result = coordinator
        ? await coordinator.requestSave(documentKey, _csvSaveHost, savePath, content, send, { reason: 'csv-auto' })
        : await send();
      _csvEnterSurface(surface);
      if (result?.conflictPending || result?.queued) {
        _csvDirty = true;
        return false;
      }
      if (_csvIsMissingSaveResult(result)) {
        _csvDirty = true;
        showStatus('CSVファイルが見つかりません。保存先を確認してください', true);
        return false;
      }
      if (_csvPath === savePath && result?.etag) {
        _csvLastSavedEtag = result.etag;
        _csvLastSavedContent = content;
      }
      if (coordinator && _csvPath === savePath && (result?.transport_revision || result?.etag)) {
        _csvLastSavedTransportRevision = coordinator.normalizeTransportRevision(
          coordinator.currentTransportName(),
          result.transport_revision || result.etag,
        );
        coordinator.bindDocumentIdentity(savePath, result);
      }
      if (_csvPath === savePath && _csvSaveVersion === saveVersion) {
        _csvDirty = false;
        clearTimeout(_csvAutoSaveTimer);
        showStatus('CSVを保存しました', false, { passiveSave: true });
        _csvAdoptSavedOnOtherSurfaces(surface, savePath, content, result);
      } else {
        _csvDirty = true;
        _csvSaveQueued = true;
      }
    } catch (e) {
      _csvEnterSurface(surface);
      _csvDirty = true;
      if (coordinator && (e?.status === 409 || e?.meldexCode === 'etag_conflict')) {
        // 項目15の反転: dirty内容を保持したまま共通の保留/解決導線へ接続する。
        coordinator.reportConflict(documentKey, {
          path: savePath,
          localMd: content,
          localEtag: _csvLastSavedTransportRevision || _csvLastSavedEtag || '',
          serverDetail: (e && e.meldexDetail && typeof e.meldexDetail === 'object') ? e.meldexDetail : null,
        });
        window.MeldexDraftRecovery?.saveDraft?.(savePath, content, _csvLastSavedEtag || '');
        _csvShowConflictPending(documentKey);
        showStatus('CSVは上書きされていません。別の端末で更新されています', true);
        break;
      }
      ok = false;
      showStatus('CSV保存に失敗しました', true);
      break;
    }
  }
  return ok && !_csvDirty;
}

async function saveCsv() {
  _csvCommitActiveEditor();
  if (!_csvPath || !_csvDirty) return true;
  _csvSaveQueued = true;
  if (_csvSaveInFlight) return _csvSaveInFlight;
  // 保存は、今つないでいる面（メイン／独立した描画先）のファイルだけへ書く。
  const surface = _csvSurface;
  _csvSaveInFlight = _csvDrainSaveQueue().finally(() => {
    _csvOnSurface(surface, () => { _csvSaveInFlight = null; });
    _csvPruneSubSurfaces();
  });
  return _csvSaveInFlight;
}

function _csvSendUnloadJson(url, payload) {
  if (typeof _sendUnloadJson === 'function') return _sendUnloadJson(url, 'POST', payload);
  try {
    const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
    if (navigator.sendBeacon && navigator.sendBeacon(url, blob)) return true;
  } catch {}
  try {
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      keepalive: true,
    });
    return true;
  } catch {
    return false;
  }
}

// 利用者が操作している面（サブパネルのCSVを操作中ならその面、それ以外はメイン）を保存する。保存のショートカット用。
function saveCsvForInteraction() {
  return _csvOnSurface(_csvInteractionSurface(), saveCsv);
}

// 画面を閉じる時は、すべての面（メイン／独立した描画先）の未保存内容を送る。
function flushCsvBeforeUnload(event) {
  let pending = false;
  let queued = true;
  _csvForEachSurface(() => {
    const result = _csvFlushSurfaceBeforeUnload();
    if (result === null) return;
    pending = true;
    queued = queued && result;
  });
  if (!pending) return true;
  if (event) {
    event.preventDefault?.();
    event.returnValue = '';
  }
  return !event && queued;
}

// 今つないでいる面の未保存内容を送る。未保存が無ければ null、送信を依頼できたかどうかを返す。
function _csvFlushSurfaceBeforeUnload() {
  _csvCommitActiveEditor();
  if (!_csvPath || !_csvDirty) return null;
  clearTimeout(_csvAutoSaveTimer);
  const base = typeof API_BASE !== 'undefined' ? API_BASE : '/api';
  const coordinator = window.MeldexDocumentSaveCoordinator;
  const guardedRevision = coordinator
    ? coordinator.revisionTokenForWrite(
      _csvLastSavedTransportRevision || _csvLastSavedEtag || '',
      coordinator.currentTransportName(),
    )
    : (_csvLastSavedEtag || '');
  const queued = _csvSendUnloadJson(base + '/file?path=' + encodeURIComponent(_csvPath), {
    content: _csvSavePayload(),
    skip_if_missing: true,
    if_match_etag: guardedRevision,
    transport_revision: _csvLastSavedTransportRevision || '',
  });
  return !!queued;
}

// === 行・列の追加 ===
function addCsvRow() {
  const before = _csvSnapshot();
  _csvEnsureEditableHeader();
  const newRow = new Array(_csvHeaders.length).fill('');
  _csvData.push(newRow);
  renderCsvTable();
  _csvRegisterHistory('CSV行追加', before);
}

function addCsvColumn() {
  const before = _csvSnapshot();
  const name = _csvUniqueHeader('新規列');
  // 空CSVの場合、ヘッダー行を作成
  if (_csvData.length === 0) _csvData.push([]);
  _csvHeaders.push(name);
  _csvData[0].push(name);
  for (let i = 1; i < _csvData.length; i++) _csvData[i].push('');
  renderCsvTable();
  _csvRegisterHistory('CSV列追加', before);
}

// === DB変換 ===
async function convertCsvToDb() {
  if (globalThis.MeldexCsvConversion?.open) {
    _csvCommitActiveEditor();
    if (_csvDirty && !await saveCsv()) return;
    return globalThis.MeldexCsvConversion.open({
      csvPath: _csvPath,
      filename: _csvPath.split(/[\\/]/).pop() || 'CSV.csv',
      rows: _csvData,
      dialect: globalThis.MeldexCsvWorkbench?.getMetadata?.().dialect,
      columns: globalThis.MeldexCsvWorkbench?.getMetadata?.().columns,
      sourceEtag: _csvLastSavedEtag,
    });
  }
  _csvCommitActiveEditor();
  if (_csvDirty) {
    const saved = await saveCsv();
    if (!saved) return;
  }
  const parts = _csvPath.replace(/\\/g, '/').split('/');
  const fileName = parts.pop().replace(/\.csv$/i, '');
  const parentDir = parts.join('/');
  const dbPath = parentDir ? parentDir + '/' + fileName : fileName;
  const existing = await _csvPathExists(dbPath);

  if (!await cfConfirm(
    '「' + fileName + '」をシートに変換します。\n' +
    '1行目を列名、2行目以降をエントリとして変換します。\n' +
    '変換先: ' + dbPath + '/\n\n' +
    (existing ? '※ 同名のシートがあるため、既存シートへ取り込みます。\n' : '') +
    '※ 元のCSVファイルは残ります。'
  )) return;

  try {
    const sourceCsvPath = _csvPath;
    const result = await runBackgroundJob('/import-csv', { csv_path: sourceCsvPath, db_path: dbPath, background: true }, { operationLabel: 'CSVをシートに変換しています' });
    if (result?.ok === false) throw new Error('import failed');
    const count = Number(result?.count || 0);
    showStatus('シート変換完了: ' + fileName + '（' + count + '件）');
    if (typeof loadOutliner === 'function') loadOutliner();
    if (typeof selectDatabase === 'function' && _csvPath === sourceCsvPath) selectDatabase(dbPath);
  } catch (e) {
    if (e?.name === 'AbortError') {
      showStatus('CSV変換を停止しました。保存済みの行を保持し、同じCSVの再実行では残りを取り込みます。');
      return;
    }
    showStatus('DB変換に失敗しました', true);
  }
}

async function _csvPathExists(path) {
  if (!path || typeof apiFetch !== 'function') return false;
  try {
    const result = await apiFetch('/check-type?path=' + encodeURIComponent(path), { silentError: true });
    return !!(result?.type && result.type !== 'unknown');
  } catch {
    return false;
  }
}

// === イベントリスナー ===
document.getElementById('csv-add-row')?.addEventListener('click', addCsvRow);
document.getElementById('csv-add-col')?.addEventListener('click', addCsvColumn);
document.getElementById('csv-to-db')?.addEventListener('click', convertCsvToDb);
if (typeof window !== 'undefined') {
  // MeldexCsvHost はメインパネルのCSV（シートモードの MeldexCsvWorkbench・履歴の復元等）の入口。
  // サブパネルの面をつないでいる間に呼ばれても、メインの面の状態を読み書きする。
  const onMain = fn => (...args) => _csvOnSurface(_csvMainSurface, () => fn(...args));
  window.MeldexCsvHost = Object.freeze({
    getState: onMain(() => ({
      path: _csvPath,
      data: _csvData,
      headers: _csvHeaders,
      dirty: _csvDirty,
      saving: !!_csvSaveInFlight || _csvSaveQueued,
      etag: _csvLastSavedEtag,
      savedContent: _csvLastSavedContent,
      transport_revision: _csvLastSavedTransportRevision,
      active: _csvSheetModeActive,
    })),
    snapshot: onMain(_csvSnapshot),
    normalize: onMain(_csvNormalizeTableShape),
    registerHistory: onMain(_csvRegisterHistory),
    markDirty: onMain(_csvMarkDirty),
    renderLegacy: onMain(() => {
      if (_csvSheetModeActive && _csvRenderSheetTable()) return;
      _csvRenderLegacyTable();
    }),
    startCellEdit: startCsvCellEdit,
    startHeaderEdit: startCsvHeaderEdit,
    commitActiveEditor: onMain(_csvCommitActiveEditor),
    save: onMain(saveCsv),
    // メインパネルのCSVのキー操作を受けてよいか。サブパネルを操作中（クリック・フォーカス）の間は受けない
    // （サブパネルでのキー操作が、メインパネルのCSVの選択範囲へ作用しないようにする）。
    ownsKeyboard() {
      let host = null;
      try { host = globalThis.GBEditorHost?.get?.() || null; } catch { host = null; }
      return host?.surface !== 'subpanel';
    },
    applyExternalSavedContent: onMain((paths, content, result) => {
      const normalize = value => String(value || '').replace(/\\/g, '/').replace(/^\/+/, '');
      if (!(paths || []).map(normalize).includes(normalize(_csvPath))) return false;
      if (_csvDirty || _csvSaveInFlight || _csvSaveQueued) {
        throw new Error('CSVに保存待ちの編集があるため、表示を上書きしませんでした');
      }
      _csvApplySavedContentToSurface(content, result);
      // 同じCSVを開いている他の面（未保存の編集が無いもの）にも反映する。
      _csvAdoptSavedOnOtherSurfaces(_csvMainSurface, _csvPath, String(content), result);
      return true;
    }),
  });
  window.deactivateCsvSheetMode = deactivateCsvSheetMode;
  window.isCsvSheetModeActive = () => !!_csvSurfaceField(_csvMainSurface, 'sheetModeActive');
  window.addEventListener('beforeunload', flushCsvBeforeUnload);
  window.addEventListener('pagehide', () => flushCsvBeforeUnload());
}
