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
let _csvLastSavedEtag = '';
let _csvLastSavedTransportRevision = '';
let _csvSheetModeActive = false;
// ボードのリンクカード計画 Phase B-2（縮小スコープ）: CSVの編集状態は#pivot-table等と
// 違い、ctxへ分離されていない単一のグローバル変数のまま。サブパネル等の独立した
// 描画先へ開く場合、_csvRenderContainerOverride を使い #csv-table-container の
// 代わりに専用DOMへ描画する（シートモードの共有 #pivot-table は使わせない＝
// _csvSheetModeActive を強制falseにする）。状態自体は単一のままのため、
// 直前の対象が今回とは別ファイルの場合、直前の描画先へ切り替え通知を出す
// （空白・不一致のまま放置しない。完全な同時独立編集は別フェーズの課題）。
let _csvRenderContainerOverride = null;

// サブパネルを閉じると専用DOMは切り離される（GBSubPanel._retractCurrentContent）。
// overrideが切り離されたDOMを指したまま残ると、以降のメイン画面側の再描画が
// 画面のどこにも現れなくなる。参照の生死をここで自己修復し、切り離されていれば
// 共有の表示領域へ戻す（フォルダの_folderResolveRenderOverrideと同じ考え方）。
function _csvResolveRenderOverride() {
  if (_csvRenderContainerOverride && !_csvRenderContainerOverride.isConnected) {
    _csvRenderContainerOverride = null;
  }
  return _csvRenderContainerOverride;
}

function _csvTableContainerEl() {
  return _csvResolveRenderOverride() || document.getElementById('csv-table-container');
}

function _csvShowTakeoverNotice(newLabel) {
  if (!_csvPath) return;
  _csvRenderMessage(String(newLabel || '') + ' に切り替わりました（別の画面で開かれたため）');
}

function _csvHistoryScope() {
  return _csvPath ? 'csv:' + _csvPath : '';
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
    historyPush(label,
      () => _csvRestoreSnapshot(before),
      () => _csvRestoreSnapshot(after),
      _csvHistoryScope()
    );
  }
  _csvMarkDirty();
  scheduleCsvAutoSave();
  return true;
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
  if (openOpts.skipShowView) return;
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
    if (!saved) return false;
  }
  // 直前の対象が今回とは別ファイルで、かつ直前の描画先がまだ残っている場合は
  // 空白・不一致のまま放置せず、切り替わったことを明示する（_csvRenderContainerOverure
  // を書き換える前に呼ぶことで、直前の描画先＝サブパネル/メインどちらでも正しく届く）。
  if (_csvPath && _csvPath !== path) {
    _csvShowTakeoverNotice(_csvDisplayLabel(label, path));
  }
  if (showGlobalLoading) showLoading('CSVを読み込み中...');
  const openSeq = ++_csvOpenSeq;
    _csvPath = '';
    _csvData = [];
    _csvHeaders = [];
    _csvDirty = false;
    _csvSaveQueued = false;
    _csvLastSavedEtag = '';
    _csvLastSavedTransportRevision = '';
    clearTimeout(_csvAutoSaveTimer);

  // 独立した描画先（サブパネル等）は共有シングルトンの#pivot-table（シートモード）
  // を絶対に取り合わない。containerEl指定時は常に専用DOMへの直接描画（非シートモード）
  // へ強制する。
  _csvRenderContainerOverride = openOpts.containerEl || null;
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
    if (_csvOpenSeq !== openSeq) return false;
    if (coordinator) documentKeyAtOpen = coordinator.bindDocumentIdentity(path, data) || documentKeyAtOpen;
    const raw = data.content || '';
    if (showGlobalLoading && typeof showLoadingBeforeHeavyWork === 'function') {
      await showLoadingBeforeHeavyWork(raw, '大きいCSVを描画中...');
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
    } else {
      renderCsvTable();
    }
    // 取り消しスコープは _csvData が最終読み込み内容になった後（読み込み中の
    // 別データを取り消しが巻き戻して上書きされないよう）に切り替える。
    // フェッチより前に呼ぶと、切替直後・読込完了前の取り消しがこの読込完了で
    // 上書きされ消える（app/docs/undo-pane-context_plan_2026-07-25.md §9 既知バグ）。
    if (!openOpts.skipHistoryScope && typeof historySetScope === 'function') historySetScope('csv:' + path);
    // 独立した描画先（サブパネル等）は注釈オーバーレイを描画しないため、メイン画面の
    // 注釈対象（ann.targetPath）をここで奪わない。
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
    if (_csvOpenSeq !== openSeq) return false;
    _csvPath = '';
    _csvData = [];
    _csvHeaders = [];
    _csvDirty = false;
    _csvSaveQueued = false;
    _csvLastSavedEtag = '';
    _csvLastSavedTransportRevision = '';
    _csvRenderMessage('CSVを読み込めませんでした');
    if (!openOpts.skipGlobalUi) showStatus('CSVを読み込めませんでした', true);
    return false;
  } finally {
    if (showGlobalLoading) hideLoading();
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
function _csvClearSelection() {
  document.querySelectorAll('.csv-cell-selected').forEach(el => el.classList.remove('csv-cell-selected'));
}

function _csvAppendHeaderCell(headerRow, headerText, ci) {
  const th = document.createElement('th');
  _csvSetDecoratedText(th, headerText);
  th.dataset.col = ci;
  th.dataset.csvCol = ci;
  th.addEventListener('click', (e) => {
    if (_csvHandleAutoLinkClick(e)) return;
    if (th.querySelector('input')) return;
    if (th.classList.contains('csv-cell-selected')) {
      startCsvHeaderEdit(th, ci);
      return;
    }
    _csvClearSelection();
    th.classList.add('csv-cell-selected');
  });
  th.addEventListener('dblclick', () => startCsvHeaderEdit(th, ci));
  headerRow.appendChild(th);
}

function _csvAppendDataCell(tr, row, ri, ci) {
  const td = document.createElement('td');
  _csvSetDecoratedText(td, row[ci] ?? '');
  td.dataset.row = ri;
  td.dataset.col = ci;
  td.dataset.csvRow = ri;
  td.dataset.csvCol = ci;
  td.addEventListener('click', (e) => {
    if (_csvHandleAutoLinkClick(e)) return;
    if (td.querySelector('input, textarea')) return;
    if (td.classList.contains('csv-cell-selected')) {
      startCsvCellEdit(td, ri, ci);
      return;
    }
    _csvClearSelection();
    td.classList.add('csv-cell-selected');
  });
  td.addEventListener('dblclick', () => startCsvCellEdit(td, ri, ci));
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
    ta.addEventListener('blur', () => { if (!cancelled && ta.dataset.csvCommitHandled !== '1') commitCsvCellEdit(td, ta.value, ri, ci); });
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.ctrlKey) ta.blur(); // Ctrl+Enterで確定
      else if (e.key === 'Escape') { cancelled = true; _csvSetDecoratedText(td, value); }
    });
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
    input.addEventListener('blur', () => { if (!cancelled && input.dataset.csvCommitHandled !== '1') commitCsvCellEdit(td, input.value, ri, ci); });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') input.blur();
      else if (e.key === 'Escape') { cancelled = true; _csvSetDecoratedText(td, value); }
      else if (e.key === 'Tab') { e.preventDefault(); input.blur(); moveCsvFocus(ri, ci, e.shiftKey ? -1 : 1); }
    });
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
  input.addEventListener('blur', () => {
    if (cancelled || input.dataset.csvCommitHandled === '1') return;
    commitCsvHeaderEdit(th, input.value, ci);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') input.blur();
    else if (e.key === 'Escape') { cancelled = true; _csvSetDecoratedText(th, value); }
  });
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
    const td = document.querySelector(
      '#csv-table td[data-row="' + ri + '"][data-col="' + nextCi + '"], ' +
      '#pivot-table.csv-sheet-mode-table td[data-row="' + ri + '"][data-col="' + nextCi + '"]'
    );
    if (td) startCsvCellEdit(td, ri, nextCi);
  }
}

// === 自動保存 ===
function scheduleCsvAutoSave() {
  clearTimeout(_csvAutoSaveTimer);
  _csvAutoSaveTimer = setTimeout(saveCsv, 2000);
}

function _csvCommitActiveEditor() {
  if (typeof document === 'undefined' || typeof document.querySelector !== 'function') return false;
  const editor = document.querySelector('#csv-table .csv-cell-input, #pivot-table.csv-sheet-mode-table .csv-cell-input');
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
  window.MeldexConflictPendingBanner?.show?.(documentKey, {
    label: '競合を保留中',
    e2eId: 'csv-conflict-pending-banner',
    onConfirm: () => { _csvReloadAfterConflict().catch(() => showStatus('最新版の取得に失敗しました', true)); },
  });
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
  if (keepLocal) {
    try {
      const content = _csvSavePayload();
      const result = await apiPut('/file?path=' + encodeURIComponent(path), { content, force_overwrite: true });
      const resolved = coordinator?.resolveConflict?.(documentKey, conflictGeneration);
      if (coordinator && !resolved) {
        throw new Error('CSVの競合状態が更新されたため、上書き結果を確定できません');
      }
      if (_csvPath === path) {
        _csvLastSavedEtag = result?.etag || _csvLastSavedEtag;
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
      await window.MeldexDraftRecovery?.markSynced?.(path);
      showStatus('自分の編集で上書き保存しました');
    } catch (e) {
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
    lastSavedTransportRevision: _csvLastSavedTransportRevision,
    saveVersion: _csvSaveVersion,
    dialect: globalThis.MeldexCsvWorkbench?.getMetadata?.().dialect || null,
  };
  await window.MeldexDraftRecovery?.saveDraft?.(path, _csvSavePayload(), _csvLastSavedEtag || '');
  let reloadOpenSeq = null;
  try {
    const data = await apiFetch('/file?path=' + encodeURIComponent(path));
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
    });
    if (!opened) throw new Error('CSV reload failed');
    showStatus('最新のCSVを読み込みました');
  } catch (_) {
    // この再読込自身が失敗した場合だけローカル表を戻す。途中で別のCSVを開いた
    // （openSeqが進んだ）場合は、新しい画面を古いスナップショットで巻き戻さない。
    if (reloadOpenSeq == null || _csvOpenSeq === reloadOpenSeq) {
      _csvPath = localSnapshot.path;
      _csvData = localSnapshot.data.map(row => row.slice());
      _csvHeaders = _csvData.length > 0 ? _csvData[0] : [];
      _csvDirty = localSnapshot.dirty;
      _csvSaveQueued = localSnapshot.saveQueued;
      _csvLastSavedEtag = localSnapshot.lastSavedEtag;
      _csvLastSavedTransportRevision = localSnapshot.lastSavedTransportRevision;
      _csvSaveVersion = localSnapshot.saveVersion;
      if (globalThis.MeldexCsvWorkbench?.open) {
        try {
          await globalThis.MeldexCsvWorkbench.open({
            path: localSnapshot.path,
            rows: _csvData,
            dialect: localSnapshot.dialect,
          });
        } catch (_) {
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
      const result = await apiPut('/file?path=' + encodeURIComponent(savePath), payload);
      if (_csvIsMissingSaveResult(result)) {
        _csvDirty = true;
        showStatus('CSVファイルが見つかりません。保存先を確認してください', true);
        return false;
      }
      if (_csvPath === savePath && result?.etag) _csvLastSavedEtag = result.etag;
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
      } else {
        _csvDirty = true;
        _csvSaveQueued = true;
      }
    } catch (e) {
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
  _csvSaveInFlight = _csvDrainSaveQueue().finally(() => {
    _csvSaveInFlight = null;
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

function flushCsvBeforeUnload(event) {
  _csvCommitActiveEditor();
  if (!_csvPath || !_csvDirty) return true;
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
  if (event) {
    event.preventDefault?.();
    event.returnValue = '';
  }
  return !event && queued;
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
    const result = await apiPost('/import-csv', { csv_path: _csvPath, db_path: dbPath });
    if (result?.ok === false) throw new Error('import failed');
    const count = Number(result?.count || 0);
    showStatus('シート変換完了: ' + fileName + '（' + count + '件）');
    if (typeof loadOutliner === 'function') loadOutliner();
    if (typeof selectDatabase === 'function') selectDatabase(dbPath);
  } catch (e) {
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
  window.MeldexCsvHost = Object.freeze({
    getState: () => ({
      path: _csvPath,
      data: _csvData,
      headers: _csvHeaders,
      dirty: _csvDirty,
      etag: _csvLastSavedEtag,
      active: _csvSheetModeActive,
    }),
    snapshot: _csvSnapshot,
    normalize: _csvNormalizeTableShape,
    registerHistory: _csvRegisterHistory,
    markDirty: _csvMarkDirty,
    renderLegacy: () => {
      if (_csvSheetModeActive && _csvRenderSheetTable()) return;
      _csvRenderLegacyTable();
    },
    startCellEdit: startCsvCellEdit,
    startHeaderEdit: startCsvHeaderEdit,
    commitActiveEditor: _csvCommitActiveEditor,
    save: saveCsv,
  });
  window.deactivateCsvSheetMode = deactivateCsvSheetMode;
  window.isCsvSheetModeActive = () => _csvSheetModeActive;
  window.addEventListener('beforeunload', flushCsvBeforeUnload);
  window.addEventListener('pagehide', () => flushCsvBeforeUnload());
}
