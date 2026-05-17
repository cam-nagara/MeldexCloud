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

// === CSVファイルを開く ===
async function openCsvFile(label, path, opts) {
  const openOpts = opts || {};
  const showGlobalLoading = !openOpts.bridgeLoad && !openOpts.silent
    && typeof showLoading === 'function' && typeof hideLoading === 'function';
  // 前のCSVの未保存変更をフラッシュ
  if (_csvDirty && _csvPath) {
    clearTimeout(_csvAutoSaveTimer);
    const saved = await saveCsv();
    if (!saved) return false;
  }
  if (showGlobalLoading) showLoading('CSVを読み込み中...');
  const openSeq = ++_csvOpenSeq;
    _csvPath = '';
    _csvData = [];
    _csvHeaders = [];
    _csvDirty = false;
    _csvSaveQueued = false;
    _csvLastSavedEtag = '';
    clearTimeout(_csvAutoSaveTimer);

  if (!openOpts.skipStateView) state.view = 'csv';
  if (!openOpts.skipShowView) showView('csv');
  const csvTitleEl = document.getElementById('csv-title');
  if (csvTitleEl) csvTitleEl.textContent = label;
  const currentTitleEl = document.getElementById('current-title');
  if (currentTitleEl && !openOpts.skipGlobalUi) currentTitleEl.textContent = label;
  if (!openOpts.skipSaveLastView) saveLastView({ type: 'csv', label, path });
  if (!openOpts.skipNavPush) {
    const _navEntry = { type: 'csv', label, path };
    navPush(_navEntry);
  }
  if (!openOpts.skipRecent) addRecent(label, path, 'csv');
  if (!openOpts.skipHighlight) highlightOutlinerNode(path);
  if (!openOpts.skipHistoryScope && typeof historySetScope === 'function') historySetScope('csv:' + path);

  try {
    const data = await apiFetch('/file?path=' + encodeURIComponent(path));
    if (_csvOpenSeq !== openSeq) return false;
    const raw = data.content || '';
    if (showGlobalLoading && typeof showLoadingBeforeHeavyWork === 'function') {
      await showLoadingBeforeHeavyWork(raw, '大きいCSVを描画中...');
      if (_csvOpenSeq !== openSeq) return false;
    }
    const parsed = parseCsv(raw);
    _csvPath = path;
    _csvData = parsed;
    _csvHeaders = _csvData.length > 0 ? _csvData[0] : [];
    _csvLastSavedEtag = data.etag || '';
    _csvNormalizeTableShape();
    renderCsvTable();
    if (!openOpts.skipAutoVersion && typeof startAutoVersion === 'function') startAutoVersion(path, 'file');
    if (!openOpts.skipGlobalUi) showStatus('CSV: ' + label);
  } catch {
    if (_csvOpenSeq !== openSeq) return false;
    _csvPath = '';
    _csvData = [];
    _csvHeaders = [];
    _csvDirty = false;
    _csvSaveQueued = false;
    _csvLastSavedEtag = '';
    const container = document.getElementById('csv-table-container');
    if (container) {
      container.innerHTML = '<div style="padding:16px;color:var(--fg2);">CSVを読み込めませんでした</div>';
    }
    if (!openOpts.skipGlobalUi) showStatus('CSVを読み込めませんでした', true);
    return false;
  } finally {
    if (showGlobalLoading) hideLoading();
  }
  return true;
}

// === CSVパーサー（RFC 4180準拠） ===
function parseCsv(text) {
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
function renderCsvTable() {
  const container = document.getElementById('csv-table-container');
  if (_csvData.length === 0) {
    container.innerHTML = '<div style="padding:16px;color:var(--fg2);">空のCSVファイルです</div>';
    return;
  }
  const table = document.createElement('table');
  table.id = 'csv-table';
  table.className = 'csv-table';

  // ヘッダー行
  const thead = document.createElement('thead');
  const headerRow = document.createElement('tr');
  const thNum = document.createElement('th');
  thNum.className = 'csv-row-num';
  thNum.textContent = '#';
  headerRow.appendChild(thNum);
  _csvHeaders.forEach((h, ci) => {
    const th = document.createElement('th');
    _csvSetDecoratedText(th, h);
    th.dataset.col = ci;
    th.addEventListener('click', (e) => {
      if (_csvHandleAutoLinkClick(e)) return;
      if (th.querySelector('input')) return;
      if (th.classList.contains('csv-cell-selected')) {
        startCsvHeaderEdit(th, ci);
        return;
      }
      document.querySelectorAll('.csv-cell-selected').forEach(el => el.classList.remove('csv-cell-selected'));
      th.classList.add('csv-cell-selected');
    });
    th.addEventListener('dblclick', () => startCsvHeaderEdit(th, ci));
    headerRow.appendChild(th);
  });
  thead.appendChild(headerRow);
  table.appendChild(thead);

  // データ行
  const tbody = document.createElement('tbody');
  for (let ri = 1; ri < _csvData.length; ri++) {
    const tr = document.createElement('tr');
    const tdNum = document.createElement('td');
    tdNum.className = 'csv-row-num';
    tdNum.textContent = ri;
    tr.appendChild(tdNum);
    const row = _csvData[ri];
    for (let ci = 0; ci < _csvHeaders.length; ci++) {
      const td = document.createElement('td');
      _csvSetDecoratedText(td, row[ci] ?? '');
      td.dataset.row = ri;
      td.dataset.col = ci;
      td.addEventListener('click', (e) => {
        if (_csvHandleAutoLinkClick(e)) return;
        if (td.querySelector('input, textarea')) return;
        if (td.classList.contains('csv-cell-selected')) {
          startCsvCellEdit(td, ri, ci);
          return;
        }
        document.querySelectorAll('.csv-cell-selected').forEach(el => el.classList.remove('csv-cell-selected'));
        td.classList.add('csv-cell-selected');
      });
      td.addEventListener('dblclick', () => startCsvCellEdit(td, ri, ci));
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  container.innerHTML = '';
  container.appendChild(table);
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
    const td = document.querySelector('#csv-table td[data-row="' + ri + '"][data-col="' + nextCi + '"]');
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
  const editor = document.querySelector('#csv-table .csv-cell-input');
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
  return '\uFEFF' + serializeCsv(_csvData);
}

function _csvIsMissingSaveResult(result) {
  return !!(result?.skipped || result?.missing);
}

async function _csvDrainSaveQueue() {
  let ok = true;
  while (_csvSaveQueued && _csvPath && _csvDirty) {
    _csvSaveQueued = false;
    const savePath = _csvPath;
    const saveVersion = _csvSaveVersion;
    const content = _csvSavePayload();
    try {
      const payload = { content, skip_if_missing: true };
      if (_csvLastSavedEtag) payload.if_match_etag = _csvLastSavedEtag;
      const result = await apiPut('/file?path=' + encodeURIComponent(savePath), payload);
      if (_csvIsMissingSaveResult(result)) {
        _csvDirty = true;
        showStatus('CSVファイルが見つかりません。保存先を確認してください', true);
        return false;
      }
      if (_csvPath === savePath && result?.etag) _csvLastSavedEtag = result.etag;
      if (_csvPath === savePath && _csvSaveVersion === saveVersion) {
        _csvDirty = false;
        clearTimeout(_csvAutoSaveTimer);
        showStatus('CSVを保存しました', false, { passiveSave: true });
      } else {
        _csvDirty = true;
        _csvSaveQueued = true;
      }
    } catch {
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
  const queued = _csvSendUnloadJson(base + '/file?path=' + encodeURIComponent(_csvPath), {
    content: _csvSavePayload(),
    skip_if_missing: true,
    if_match_etag: _csvLastSavedEtag || '',
  });
  if (!queued && event) {
    event.preventDefault?.();
    event.returnValue = '';
  }
  return queued;
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
    '1行目をプロパティ名、2行目以降をエントリとして変換します。\n' +
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
  window.addEventListener('beforeunload', flushCsvBeforeUnload);
  window.addEventListener('pagehide', () => flushCsvBeforeUnload());
}
