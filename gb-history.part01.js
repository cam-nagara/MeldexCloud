/**
 * Meldex History & Version Management
 * アンドゥ・リドゥ + バージョン管理
 */

/* ==============================
   バージョン管理
   ============================== */
// テキストdiffエンジン（Myers diff アルゴリズム簡易版）
const HISTORY_MAX_DIFF_CELLS = 250000;

function _simpleLineDiff(oldLines, newLines) {
  let head = 0;
  while (head < oldLines.length && head < newLines.length && oldLines[head] === newLines[head]) head++;
  let oldTail = oldLines.length - 1;
  let newTail = newLines.length - 1;
  while (oldTail >= head && newTail >= head && oldLines[oldTail] === newLines[newTail]) { oldTail--; newTail--; }
  const result = [];
  for (let i = 0; i < head; i++) result.push({ type: 'same', text: oldLines[i] });
  for (let i = head; i <= oldTail; i++) result.push({ type: 'del', text: oldLines[i] });
  for (let i = head; i <= newTail; i++) result.push({ type: 'add', text: newLines[i] });
  for (let i = oldTail + 1; i < oldLines.length; i++) result.push({ type: 'same', text: oldLines[i] });
  return result;
}

function textDiff(oldText, newText) {
  const oldLines = oldText.split('\n'), newLines = newText.split('\n');
  const m = oldLines.length, n = newLines.length;
  if (m * n > HISTORY_MAX_DIFF_CELLS) return _simpleLineDiff(oldLines, newLines);
  // LCS DP（2行のみ保持してメモリ節約）
  let cur = new Uint32Array(n + 1), prev = new Uint32Array(n + 1);
  // 全DP値を記録する必要があるため、方向配列を使用
  const dir = new Uint8Array(m * n); // 0=diag, 1=up, 2=left
  for (let i = m - 1; i >= 0; i--) {
    [cur, prev] = [prev, cur];
    cur.fill(0);
    for (let j = n - 1; j >= 0; j--) {
      if (oldLines[i] === newLines[j]) { cur[j] = prev[j + 1] + 1; dir[i * n + j] = 0; }
      else if (prev[j] >= cur[j + 1]) { cur[j] = prev[j]; dir[i * n + j] = 1; }
      else { cur[j] = cur[j + 1]; dir[i * n + j] = 2; }
    }
  }
  // diffを生成
  const result = [];
  let i = 0, j = 0;
  while (i < m && j < n) {
    const d = dir[i * n + j];
    if (d === 0) { result.push({type: 'same', text: oldLines[i]}); i++; j++; }
    else if (d === 1) { result.push({type: 'del', text: oldLines[i]}); i++; }
    else { result.push({type: 'add', text: newLines[j]}); j++; }
  }
  while (i < m) { result.push({type: 'del', text: oldLines[i]}); i++; }
  while (j < n) { result.push({type: 'add', text: newLines[j]}); j++; }
  return result;
}

// バージョン管理設定
function getVersionConfig() {
  try { return JSON.parse(localStorage.getItem('version-config')) || {}; } catch { return {}; }
}
function saveVersionConfig(cfg) { localStorage.setItem('version-config', JSON.stringify(cfg)); }
function getAutoInterval() { return getVersionConfig().autoInterval ?? 3600000; } // デフォルト1時間
function getMaxAutoVersions() { return getVersionConfig().maxAuto ?? 30; }

// 自動バージョン保存タイマー
let _autoVersionTimer = null;
let _autoVersionPath = '';
let _autoVersionType = ''; // 'file' | 'db'
let _autoVersionDirty = false;

function startAutoVersion(path, type) {
  stopAutoVersion();
  _autoVersionPath = path;
  _autoVersionType = type;
  _autoVersionDirty = false;
  const interval = getAutoInterval();
  if (interval <= 0) return;
  _autoVersionTimer = setInterval(() => {
    if (!_autoVersionDirty) return; // 更新なしならスキップ
    _autoVersionDirty = false;
    const maxAuto = getMaxAutoVersions();
    if (type === 'db') {
      apiPost('/version/save-db', { path, auto: true, max_auto: maxAuto }).catch(() => {});
    } else {
      apiPost('/version/save', { path, auto: true, max_auto: maxAuto }).catch(() => {});
    }
  }, interval);
}

function stopAutoVersion() {
  if (_autoVersionTimer) { clearInterval(_autoVersionTimer); _autoVersionTimer = null; }
}

function markAutoVersionDirty() { _autoVersionDirty = true; }

function _historyActionAttrs(action, args = []) {
  return `data-action="${esc(action)}" data-args="${esc(JSON.stringify(args))}"`;
}

function _historyCloseAttrs(id) {
  return `data-e2e-id="${esc(id)}" data-action="this.closest('.modal-overlay').remove()"`;
}

function _versionDisplayDate(version) {
  const value = String(version?.created || version?.modified || '');
  return value ? value.substring(0, 19).replace('T', ' ') : '';
}

function _normalizeVersionComparePath(path) {
  return String(path || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
}

function _sameVersionTargetPath(a, b) {
  return _normalizeVersionComparePath(a) === _normalizeVersionComparePath(b);
}

function _isScriptNoteVersionPath(path) {
  return /\.scriptnote\.json$/i.test(_normalizeVersionComparePath(path));
}

async function _refreshOpenScriptNoteVersionTarget(path) {
  const normalized = _normalizeVersionComparePath(path);
  if (!normalized || typeof getComponentInstance !== 'function') return 0;
  const tasks = [];
  const seen = new Set();
  const reloadOptions = {
    skipNavPush: true,
    skipRecent: true,
    skipAutoVersion: true,
    skipSaveLastView: true,
    skipStatus: true,
  };

  if (typeof GBLayout !== 'undefined' && typeof GBLayout.getAllPanes === 'function') {
    const panes = GBLayout.getAllPanes(GBLayout.root) || [];
    for (const pane of panes) {
      for (const tab of (pane.tabs || [])) {
        if (tab.type !== 'scriptnote') continue;
        const comp = getComponentInstance(tab.id);
        if (!comp || typeof comp._loadScenario !== 'function') continue;
        const tabPath = tab.state?.scenarioPath || tab.path || comp.state?.scenarioPath || comp._editor?._path || '';
        if (!_sameVersionTargetPath(tabPath, normalized) || seen.has(tab.id)) continue;
        seen.add(tab.id);
        tasks.push(Promise.resolve().then(() => comp._loadScenario(path, reloadOptions)));
      }
    }
  }

  if (!tasks.length && typeof getActiveScriptNoteComponent === 'function') {
    const comp = getActiveScriptNoteComponent();
    const compPath = comp?.state?.scenarioPath || comp?._editor?._path || '';
    if (comp && typeof comp._loadScenario === 'function' && _sameVersionTargetPath(compPath, normalized)) {
      tasks.push(Promise.resolve().then(() => comp._loadScenario(path, reloadOptions)));
    }
  }

  if (!tasks.length) return 0;
  await Promise.allSettled(tasks);
  return tasks.length;
}

async function _flushOpenScriptNoteVersionTarget(path) {
  const normalized = _normalizeVersionComparePath(path);
  if (!normalized || typeof getComponentInstance !== 'function') return 0;
  const tasks = [];
  const seen = new Set();

  if (typeof GBLayout !== 'undefined' && typeof GBLayout.getAllPanes === 'function') {
    const panes = GBLayout.getAllPanes(GBLayout.root) || [];
    for (const pane of panes) {
      for (const tab of (pane.tabs || [])) {
        if (tab.type !== 'scriptnote') continue;
        const comp = getComponentInstance(tab.id);
        const editor = comp?._editor;
        if (!editor || typeof editor.flush !== 'function') continue;
        const tabPath = tab.state?.scenarioPath || tab.path || comp.state?.scenarioPath || editor._path || '';
        if (!_sameVersionTargetPath(tabPath, normalized) || seen.has(tab.id)) continue;
        seen.add(tab.id);
        tasks.push(Promise.resolve().then(() => editor.flush()));
      }
    }
  }

  if (!tasks.length && typeof getActiveScriptNoteComponent === 'function') {
    const comp = getActiveScriptNoteComponent();
    const editor = comp?._editor;
    const compPath = comp?.state?.scenarioPath || editor?._path || '';
    if (editor && typeof editor.flush === 'function' && _sameVersionTargetPath(compPath, normalized)) {
      tasks.push(Promise.resolve().then(() => editor.flush()));
    }
  }

  if (!tasks.length) return 0;
  const results = await Promise.allSettled(tasks);
  const failed = results.some(result => result.status === 'rejected' || result.value === false);
  if (failed) throw new Error('シナリオの未保存内容を保存できませんでした');
  return tasks.length;
}

async function _flushOpenVersionTarget(path, type) {
  const flushed = await _flushOpenAppVersionTarget(path, '');
  if (_isScriptNoteVersionPath(path)) {
    return flushed + await _flushOpenScriptNoteVersionTarget(path);
  }
  return flushed;
}

async function _refreshRestoredVersionTarget(path, type) {
  const targetType = type || 'file';
  if (_isScriptNoteVersionPath(path)) {
    const refreshed = await _refreshOpenScriptNoteVersionTarget(path);
    if (refreshed) return;
  }

  if (targetType === 'db') {
    if (typeof selectDatabase === 'function') await Promise.resolve(selectDatabase(path));
    return;
  }

  if (
    targetType === 'file'
    && state.view === 'smart-db'
    && state.currentSmartDb?._filePath
    && _sameVersionTargetPath(path, state.currentSmartDb._filePath)
    && typeof openSmartDbFile === 'function'
  ) {
    const label = state.currentSmartDb.name || path.split('/').pop()?.replace(/\.\w+$/, '') || '';
    await Promise.resolve(openSmartDbFile(label, path, {
      skipNavPush: true,
      skipRecent: true,
      skipAutoVersion: true,
      skipSaveLastView: true,
      skipGlobalUi: true,
      skipHistoryScope: true,
    }));
    return;
  }

  const currentPath = typeof getCurrentFilePath === 'function'
    ? getCurrentFilePath()
    : '';
  if (path && currentPath && !_sameVersionTargetPath(path, currentPath)) return;

  if (state.view === 'page' && typeof openPage === 'function') {
    const label = path.split('/').pop()?.replace(/\.\w+$/, '') || '';
    await Promise.resolve(openPage(label, path));
  } else if (state.view === 'board' && typeof openBoard === 'function') {
    const label = path.split('/').pop()?.replace(/\.\w+$/, '') || '';
    await Promise.resolve(openBoard(label, path));
  } else if (state.view === 'entity' && state.currentEntityPath && typeof selectEntity === 'function') {
    await Promise.resolve(selectEntity(state.currentEntityPath));
  } else if ((state.view === 'pivot' || state.view === 'gallery' || state.view === 'kanban' || state.view === 'timeline') && state.currentDbPath && typeof selectDatabase === 'function') {
    await Promise.resolve(selectDatabase(state.currentDbPath));
  }
}

// バージョン一覧モーダル
async function showVersionsModal(path, type) {
  const isDb = type === 'db';
  const versions = await apiFetch((isDb ? '/version/list-db' : '/version/list') + '?path=' + encodeURIComponent(path));

  const o = document.createElement('div');
  o.className = 'modal-overlay';
  o.dataset.historyVersionModal = '1';
  o.dataset.versionPath = path || '';
  o.dataset.versionType = type || 'file';

  let listHtml = '';
  if (versions.length === 0) {
    listHtml = `<div class="gb-empty-state" style="padding:24px;">
      <div class="gb-empty-icon">${typeof lucide === 'function' ? lucide('gitBranch', 48) : ''}</div>
      <div class="gb-empty-message">バージョンがありません</div>
      <div class="gb-empty-hint">「+ バージョンを保存」で保存してください</div>
    </div>`;
  } else {
    versions.forEach(v => {
      const dt = _versionDisplayDate(v);
      const badge = v.auto ? '<span class="gb-badge gb-badge-auto">自動</span>' : '<span class="gb-badge gb-badge-manual">手動</span>';
      const label = v.label ? ' — ' + esc(v.label) : '';
      listHtml += `<div class="gb-history-row">
        ${badge}
        <span style="flex:1;">${dt}${label}</span>
        <span class="gb-history-size">${formatFileSize(v.size)}</span>
        <button class="gb-btn gb-btn-xs" ${_historyActionAttrs('previewVersion', [path, v.name, type])}>表示</button>
        <button class="gb-btn gb-btn-xs" ${_historyActionAttrs('compareVersion', [path, v.name, type])}>比較</button>
        <button class="gb-btn gb-btn-xs gb-btn-warn" ${_historyActionAttrs('restoreVersion', [path, v.name, type])}>復元</button>
        <button class="gb-btn gb-btn-xs gb-btn-danger" ${_historyActionAttrs('deleteVersion', [path, v.name, type])}>${lucide('x', 12)}</button>
      </div>`;
    });
  }

  o.innerHTML = `<div class="gb-modal" style="min-width:600px;max-width:90vw;">
    <header class="gb-modal-header">
      <h3 class="gb-modal-title">バージョン管理</h3>
      <button class="gb-modal-close" ${_historyCloseAttrs('history-versions-close-icon')}>${lucide('x', 14)}</button>
    </header>
    <div class="gb-modal-body">
      <div style="margin-bottom:var(--ui-space-4);">
        <button class="gb-btn gb-btn-sm gb-btn-primary" ${_historyActionAttrs('saveManualVersion', [path, type])}>+ バージョンを保存</button>
      </div>
      <div class="gb-history-list">${listHtml}</div>
    </div>
    <footer class="gb-modal-footer">
      <button class="gb-btn gb-btn-sm" ${_historyCloseAttrs('history-versions-close-footer')}>閉じる</button>
    </footer>
  </div>`;
  document.body.appendChild(o);
}

async function saveManualVersion(path, type) {
  const label = await cfPrompt('バージョンラベル（任意）:', '');
  if (label === null) return;
  showLoading('バージョンを保存中...');
  try {
    const isDb = type === 'db';
    await _flushOpenVersionTarget(path, type || 'file');
    await apiPost(isDb ? '/version/save-db' : '/version/save', { path, label, auto: false });
    showStatus('バージョンを保存しました');
    _refreshVersionViews(path, type);
  } catch (err) {
    showStatus('バージョン保存に失敗しました', true);
  } finally { hideLoading(); }
}

async function deleteVersion(path, versionName, type) {
  if (!await cfConfirm('このバージョンを削除しますか？')) return;
  let currentName = versionName;
  let deletedToken = '';
  const versionType = type || 'file';
  const result = await apiPost('/version/delete', { path, version: currentName });
  deletedToken = result?.token || '';
  if (deletedToken && typeof historyPush === 'function') {
    historyPush('バージョン削除: ' + versionName,
      async () => {
        if (!deletedToken) return;
        const restored = await apiPost('/version/undelete', { path, token: deletedToken });
        currentName = restored?.version || currentName;
        deletedToken = '';
        _refreshVersionViews(path, versionType);
      },
      async () => {
        const deleted = await apiPost('/version/delete', { path, version: currentName });
        deletedToken = deleted?.token || '';
        currentName = deleted?.version || currentName;
        _refreshVersionViews(path, versionType);
      },
      _historyActiveScope || '',
      path
    );
  }
  showStatus(deletedToken ? 'バージョンを削除しました（Undoで戻せます）' : 'バージョンを削除しました');
  _refreshVersionViews(path, type || 'file');
}

// バージョンパネル（タブ）とレガシーの詳細パネル両方を更新
function _refreshVersionViews(path, type) {
  const targetType = type || 'file';
  // バージョンタブのコンポーネントを更新
  if (typeof GBLayout !== 'undefined' && typeof GBTabs !== 'undefined') {
    const allPanes = GBLayout.getAllPanes(GBLayout.root);
    for (const pane of allPanes) {
      for (const tab of (pane.tabs || [])) {
        const tabPath = tab.state?.versionPath || tab.path || '';
        if (tab.type === 'version' && _sameVersionTargetPath(tabPath, path)) {
          const tabType = tab.state?.versionType || targetType;
          if (!tab.state || !tab.state.versionType) {
            tab.state = { ...(tab.state || {}), versionType: tabType };
          }
          const comp = typeof getComponentInstance === 'function' ? getComponentInstance(tab.id) : null;
          if (comp && comp._loadVersions) comp._loadVersions(tabPath || path, tabType);
        }
      }
    }
  }
  // レガシー詳細パネルも更新（表示中の場合のみ — モーダルを誤表示しないよう）
  const rpDetail = document.getElementById('rp-detail');
  const detailInPane = rpDetail && rpDetail.closest('.gb-pane-content');
  if (detailInPane && rpDetail.querySelector('.gb-history-panel')) {
    _showVersionsInPanel(path, type);
  }
  document.querySelectorAll('.modal-overlay[data-history-version-modal="1"]').forEach(modal => {
    const modalType = modal.dataset.versionType || 'file';
    if (modalType !== targetType || !_sameVersionTargetPath(modal.dataset.versionPath || '', path)) return;
    modal.remove();
    showVersionsModal(path, targetType).catch(() => {});
  });
}

async function restoreVersion(path, versionName, type) {
  if (!await cfConfirm('このバージョンに復元しますか？\n（現在のバージョンは自動保存されます）')) return;
  showLoading('復元中...');
  try {
    await _flushOpenVersionTarget(path, type || 'file');
    if (type === 'db') {
      await apiPost('/version/restore-db', { path, version: versionName });
    } else {
      await apiPost('/version/restore', { path, version: versionName });
    }
    showStatus('復元しました');
    document.querySelector('.modal-overlay')?.remove();
    await _refreshRestoredVersionTarget(path, type || 'file');
    _refreshVersionViews(path, type || 'file');
  } catch (err) {
    showStatus('復元に失敗しました: ' + (err.message || ''), true);
  } finally { hideLoading(); }
}

// バージョンプレビュー
async function previewVersion(path, versionName, type) {
  if (type === 'db') {
    const data = await apiFetch('/version/read-db?path=' + encodeURIComponent(path) + '&version=' + encodeURIComponent(versionName));
    showDbSnapshotPreview(data, versionName);
    return;
  }
  const data = await apiFetch('/version/read?path=' + encodeURIComponent(path) + '&version=' + encodeURIComponent(versionName));
  showTextPreview(data.content, versionName);
}

function showTextPreview(content, title) {
  const o = document.createElement('div');
  o.className = 'modal-overlay';
  o.style.zIndex = '110';
  // フロントマター除去
  let md = content;
  const fmMatch = md.match(/^---\n[\s\S]*?\n---\n?/);
  if (fmMatch) md = md.substring(fmMatch[0].length);
  const html = md.trim() ? mdToHtml(md) : '<span class="gb-section-desc">(空)</span>';
  o.innerHTML = `<div class="gb-modal" style="min-width:700px;max-width:90vw;">
    <header class="gb-modal-header">
      <h3 class="gb-modal-title">${esc(title)}</h3>
      <button class="gb-modal-close" ${_historyCloseAttrs('history-text-preview-close-icon')}>${lucide('x', 14)}</button>
    </header>
    <div class="gb-modal-body gb-history-preview">${html}</div>
    <footer class="gb-modal-footer">
      <button class="gb-btn gb-btn-sm" ${_historyCloseAttrs('history-text-preview-close-footer')}>閉じる</button>
    </footer>
  </div>`;
  document.body.appendChild(o);
}

function showDbSnapshotPreview(data, title) {
  const o = document.createElement('div');
  o.className = 'modal-overlay';
  o.style.zIndex = '110';
  let tableHtml = '<table class="gb-history-table">';
  tableHtml += '<tr><th>エントリ</th><th>プロパティ</th><th>値</th><th>ステータス</th></tr>';
  for (const [entName, entData] of Object.entries(data.entities || {})) {
    for (const [propName, vals] of Object.entries(entData)) {
      if (propName === '_freetext') continue;
      if (!Array.isArray(vals)) continue;
      vals.forEach(v => {
        tableHtml += `<tr><td>${esc(entName)}</td><td>${esc(propName)}</td><td>${esc(v.value)}</td><td>${esc(v.status)}</td></tr>`;
      });
    }
  }
  tableHtml += '</table>';
  o.innerHTML = `<div class="gb-modal" style="min-width:700px;max-width:90vw;">
    <header class="gb-modal-header">
      <h3 class="gb-modal-title">DBスナップショット: ${esc(title)}</h3>
      <button class="gb-modal-close" ${_historyCloseAttrs('history-db-preview-close-icon')}>${lucide('x', 14)}</button>
    </header>
    <div class="gb-modal-body">
      <div class="gb-section-desc" style="margin-bottom:var(--ui-space-2);">${data.timestamp || ''}</div>
      <div style="overflow:auto;">${tableHtml}</div>
    </div>
    <footer class="gb-modal-footer">
      <button class="gb-btn gb-btn-sm" ${_historyCloseAttrs('history-db-preview-close-footer')}>閉じる</button>
    </footer>
  </div>`;
  document.body.appendChild(o);
}

// diff比較モーダル
let _diffMode = localStorage.getItem('diff-mode') || 'side'; // 'side' | 'inline'

async function compareVersion(path, versionName, type) {
  if (type === 'db') {
    // DB diff: 現在のpivotデータとスナップショットを比較
    const snapshot = await apiFetch('/version/read-db?path=' + encodeURIComponent(path) + '&version=' + encodeURIComponent(versionName));
    const currentData = await apiFetch('/pivot?path=' + encodeURIComponent(path));
    showDbDiff(snapshot, versionName, currentData);
    return;
  }
  const verData = await apiFetch('/version/read?path=' + encodeURIComponent(path) + '&version=' + encodeURIComponent(versionName));
  const curData = await apiFetch('/file?path=' + encodeURIComponent(path));
  const oldText = verData.content || '';
  const newText = curData.content || '';
  // 台本(.scriptnote.json)の場合は構造化差分
  if (path.endsWith('.scriptnote.json')) {
    try {
      const oldDoc = JSON.parse(oldText);
      const newDoc = JSON.parse(newText);
      if (oldDoc.fileType === 'meldex-scriptnote' && newDoc.fileType === 'meldex-scriptnote') {
        showScriptNoteDiff(oldDoc, newDoc, versionName, '現在');
        return;
      }
    } catch {}
  }
  showDiffModal(oldText, newText, versionName, '現在');
}

// 台本の構造化差分表示
function _stableScriptNoteValue(value) {
  if (Array.isArray(value)) return value.map(_stableScriptNoteValue);
  if (value && typeof value === 'object') {
    const out = {};
    Object.keys(value).sort().forEach(key => { out[key] = _stableScriptNoteValue(value[key]); });
    return out;
  }
  return value;
}

function _scriptNoteDiffLines(doc) {
  const rows = Array.isArray(doc.rows) ? doc.rows : [];
  const lines = [];
  Object.keys(doc || {}).filter(key => key !== 'rows').sort().forEach(key => {
    lines.push(`設定.${key}: ${JSON.stringify(_stableScriptNoteValue(doc[key]))}`);
  });
  rows.forEach((row, index) => {
    const role = row?.role ? row.role + '：' : '';
    const text = row?.text || '';
    lines.push(`行${index + 1}: ${role}${text} ${JSON.stringify(_stableScriptNoteValue(row || {}))}`);
  });
  return lines;
}

function showScriptNoteDiff(oldDoc, newDoc, oldTitle, newTitle) {
  const oldLines = _scriptNoteDiffLines(oldDoc);
  const newLines = _scriptNoteDiffLines(newDoc);
  const diff = textDiff(oldLines.join('\n'), newLines.join('\n'));

  // 統計
  let added = 0, removed = 0;
  diff.forEach(d => { if (d.type === 'add') added++; if (d.type === 'del') removed++; });

  const o = document.createElement('div');
  o.className = 'modal-overlay';
  o.style.zIndex = '110';

  let rowsHtml = '';
  diff.forEach(d => {
    const cls = d.type === 'add' ? 'gb-diff-add' : d.type === 'del' ? 'gb-diff-del' : '';
    const prefix = d.type === 'add' ? '+' : d.type === 'del' ? '-' : ' ';
    // ロール部分とテキスト部分を分離表示
    const colonIdx = d.text.indexOf('：');
    let roleHtml = '', textHtml = '';
    if (colonIdx >= 0) {
      roleHtml = `<span class="gb-sn-diff-role">${esc(d.text.substring(0, colonIdx))}</span>`;
      textHtml = esc(d.text.substring(colonIdx + 1));
    } else {
      textHtml = esc(d.text);
    }
    rowsHtml += `<div class="gb-diff-line ${cls}"><span class="gb-diff-prefix">${prefix}</span>${roleHtml}${textHtml}</div>`;
  });

  o.innerHTML = `<div class="gb-modal" style="min-width:800px;max-width:95vw;">
    <header class="gb-modal-header">
      <h3 class="gb-modal-title">シナリオ差分: ${esc(oldTitle)} ↔ ${esc(newTitle)}</h3>
      <div class="gb-panel-actions">
        <span class="gb-section-desc">+${added} -${removed} 行</span>
        <button class="gb-modal-close" ${_historyCloseAttrs('history-scriptnote-diff-close-icon')}>${lucide('x', 14)}</button>
      </div>
    </header>
    <div class="gb-modal-body" style="overflow:auto;">
      <div class="gb-diff-inline">${rowsHtml}</div>
    </div>
    <footer class="gb-modal-footer">
      <button class="gb-btn gb-btn-sm" ${_historyCloseAttrs('history-scriptnote-diff-close-footer')}>閉じる</button>
    </footer>
  </div>`;
  document.body.appendChild(o);
}

function showDiffModal(oldText, newText, oldTitle, newTitle) {
  // フロントマター除去
  function stripFm(t) { const m = t.match(/^---\n[\s\S]*?\n---\n?/); return m ? t.substring(m[0].length) : t; }
  const diff = textDiff(stripFm(oldText), stripFm(newText));

  const o = document.createElement('div');
  o.className = 'modal-overlay';
  o.style.zIndex = '110';

  const toggleBtn = `<button class="gb-btn gb-btn-xs" data-diff-toggle data-e2e-id="version-diff-toggle" aria-label="差分表示切替">${_diffMode === 'side' ? 'インライン表示' : '左右表示'}</button>`;

  o.innerHTML = `<div class="gb-modal" style="min-width:800px;max-width:95vw;">
    <header class="gb-modal-header">
      <h3 class="gb-modal-title">差分比較</h3>
      <div class="gb-panel-actions">
        ${toggleBtn}
        <button class="gb-modal-close" ${_historyCloseAttrs('history-file-diff-close-icon')}>${lucide('x', 14)}</button>
      </div>
    </header>
    <div class="gb-modal-body">
      <div class="gb-history-diff-container" data-diff-container></div>
    </div>
    <footer class="gb-modal-footer">
      <button class="gb-btn gb-btn-sm" ${_historyCloseAttrs('history-file-diff-close-footer')}>閉じる</button>
    </footer>
  </div>`;
  document.body.appendChild(o);

  o._diffData = { diff, oldTitle, newTitle };
  o.querySelector('[data-diff-toggle]')?.addEventListener('click', (ev) => toggleDiffMode(ev.currentTarget, o));
  renderDiff(o);
}

function toggleDiffMode(btn, modal = null) {
  _diffMode = _diffMode === 'side' ? 'inline' : 'side';
  localStorage.setItem('diff-mode', _diffMode);
  btn.textContent = _diffMode === 'side' ? 'インライン表示' : '左右表示';
  renderDiff(modal || btn.closest('.modal-overlay'));
}

function renderDiff(modal = null) {
  const container = modal?.querySelector?.('[data-diff-container]') || document.querySelector('[data-diff-container]');
  const data = modal?._diffData;
  if (!container || !data) return;
  const { diff, oldTitle, newTitle } = data;

  if (_diffMode === 'side') {
    let leftHtml = '', rightHtml = '';
    diff.forEach(d => {
      const cls = d.type === 'add' ? ' gb-diff-add' : d.type === 'del' ? ' gb-diff-del' : '';
      if (d.type === 'same') { leftHtml += `<div class="gb-diff-line">${esc(d.text)}</div>`; rightHtml += `<div class="gb-diff-line">${esc(d.text)}</div>`; }
      else if (d.type === 'del') { leftHtml += `<div class="gb-diff-line${cls}">${esc(d.text)}</div>`; rightHtml += `<div class="gb-diff-line"></div>`; }
      else { leftHtml += `<div class="gb-diff-line"></div>`; rightHtml += `<div class="gb-diff-line${cls}">${esc(d.text)}</div>`; }
    });
    container.innerHTML = `<div class="gb-diff-side">
      <div class="gb-diff-col">
        <div class="gb-diff-col-header">${esc(oldTitle)}</div>
        <div class="gb-diff-col-body">${leftHtml}</div>
      </div>
      <div class="gb-diff-col">
        <div class="gb-diff-col-header">${esc(newTitle)}</div>
        <div class="gb-diff-col-body">${rightHtml}</div>
      </div>
    </div>`;
  } else {
    let html = '';
    diff.forEach(d => {
      const prefix = d.type === 'add' ? '+' : d.type === 'del' ? '-' : ' ';
      const cls = d.type === 'add' ? ' gb-diff-add' : d.type === 'del' ? ' gb-diff-del' : '';
      html += `<div class="gb-diff-line${cls}"><span class="gb-diff-prefix">${prefix}</span> ${esc(d.text)}</div>`;
    });
    container.innerHTML = `<div class="gb-diff-inline">${html}</div>`;
  }
}

// 現在のビューのパスとタイプを取得
function _getCurrentVersionTarget() {
  let path = '', type = 'file';
  const activeTab = (typeof GBTabs !== 'undefined' && typeof GBLayout !== 'undefined')
    ? GBTabs.getActiveTab(GBLayout.activePane)
    : null;
  if (state.view === 'page') { const pc = document.getElementById('page-content'); path = pc?.dataset?.path || ''; }
  else if (state.view === 'entity') { const ep = state.currentEntityPath; path = ep ? (ep.endsWith('.md') ? ep : ep + '/_freetext.md') : ''; }
  else if (state.view === 'board') { path = bd.path || ''; }
  else if ((state.view === 'pivot' || state.view === 'gallery' || state.view === 'kanban' || state.view === 'timeline') && state.currentDbPath) { path = state.currentDbPath; type = 'db'; }
  else if (state.view === 'csv') { path = (typeof _csvPath !== 'undefined') ? _csvPath : ''; }
  else if (state.view === 'scriptnote') {
    const comp = activeTab?.type === 'scriptnote' && typeof getComponentInstance === 'function'
      ? getComponentInstance(activeTab.id)
      : null;
    path = comp?.state?.scenarioPath || activeTab?.path || '';
  }
  else if (state.view === 'smart-db') { path = state.currentSmartDb?._filePath || activeTab?.path || ''; }
  else if (activeTab?.path) {
    path = activeTab.path;
    if (activeTab.type === 'database' || activeTab.type === 'calendar') type = 'db';
  }
  if (!path && typeof _splitPath !== 'undefined' && _splitPath) path = _splitPath;
  return { path, type };
}

// 現在のビューに応じてバージョン管理タブを開く（新方式）
// 対象アプリが無くても空タブとして開く（対象ができたら手動更新または再オープンで反映）
function openCurrentVersionsTab() {
  const { path, type } = _getCurrentVersionTarget();
  if (typeof openVersionTab === 'function') {
    openVersionTab(path || '', type);
  } else if (path) {
    _showVersionsInPanel(path, type);
  }
}

function _buildVersionsPanelHtml(path, type, versions) {
  const safePath = esc(path);
  const list = Array.isArray(versions) ? versions : [];
  let listHtml = '';
  if (!list.length) {
    listHtml = `<div class="gb-empty-state" style="padding:16px;">
      <div class="gb-empty-icon">${typeof lucide === 'function' ? lucide('gitBranch', 36) : ''}</div>
      <div class="gb-empty-message">バージョンがありません</div>
      <div class="gb-empty-hint">「+ バージョンを保存」で保存してください</div>
    </div>`;
  } else {
    list.forEach(v => {
      const dt = _versionDisplayDate(v);
      const badge = v.auto ? '<span class="gb-badge gb-badge-auto">自動</span>' : '<span class="gb-badge gb-badge-manual">手動</span>';
      const label = v.label ? ' — ' + esc(v.label) : '';
      listHtml += `<div class="gb-history-row gb-history-row-compact">
        ${badge}<span class="gb-history-label">${dt}${label}</span>
        <span class="gb-history-size">${formatFileSize(v.size)}</span>
        <div class="gb-history-actions">
          <button class="gb-btn gb-btn-xs" ${_historyActionAttrs('previewVersion', [path, v.name, type])}>表示</button>
          <button class="gb-btn gb-btn-xs" ${_historyActionAttrs('compareVersion', [path, v.name, type])}>比較</button>
          <button class="gb-btn gb-btn-xs gb-btn-warn" ${_historyActionAttrs('restoreVersion', [path, v.name, type])}>復元</button>
          <button class="gb-btn gb-btn-xs gb-btn-danger" ${_historyActionAttrs('deleteVersion', [path, v.name, type])}>${lucide('x', 12)}</button>
        </div>
      </div>`;
    });
  }
  return `<div class="gb-history-panel">
    <div class="gb-history-panel-header">
      <span class="gb-history-panel-title">${lucide('gitBranch',14)} バージョン管理</span>
      <button class="gb-btn gb-btn-xs gb-btn-primary" ${_historyActionAttrs('saveManualVersion', [path, type])}>+ 保存</button>
    </div>
    <div class="gb-history-panel-path" title="${safePath}">${esc(path.split('/').pop())}</div>
    <div class="gb-history-list">${listHtml}</div>
  </div>`;
}

async function _showVersionsInPanel(path, type) {
  // v5.0: 旧detail-panelは廃止。ペインシステムの#rp-detailがペインにマウントされていれば使う。
  const rpDetail = document.getElementById('rp-detail');
  const detailInPane = rpDetail && rpDetail.closest('.gb-pane-content');
  const pos = (typeof _getDetailPanelCfg === 'function') ? (_getDetailPanelCfg().position || 'right') : 'right';
  const panel = detailInPane ? rpDetail : document.getElementById('detail-panel-' + pos);
  if (!panel) { showVersionsModal(path, type); return; }
  if (!detailInPane && typeof _getDetailPanelCfg === 'function') {
    const cfg = _getDetailPanelCfg(); cfg.visible = true; _saveDetailPanelCfg(cfg);
  }
  panel.style.display = ''; panel.innerHTML = '<div class="gb-history-loading">読み込み中...</div>';

  const isDb = type === 'db';
  let versions = [];
  try { versions = await apiFetch((isDb ? '/version/list-db' : '/version/list') + '?path=' + encodeURIComponent(path)); } catch {}
  panel.innerHTML = _buildVersionsPanelHtml(path, type, versions);
}

function showDbDiff(snapshot, title, currentData = null) {
  // 現在のDBデータとスナップショットを比較
  const data = currentData || state.pivotData;
  if (!data) { showStatus('DBデータがありません', true); return; }

  const o = document.createElement('div');
  o.className = 'modal-overlay';
  o.style.zIndex = '110';

  let html = '<table class="gb-history-table">';
  html += '<tr><th>エントリ</th><th>プロパティ</th><th>旧値</th><th>旧ステータス</th><th>現在値</th><th>現在ステータス</th><th>変更</th></tr>';

  const allEntities = new Set([...Object.keys(snapshot.entities || {}), ...Object.keys(data.entities || {})]);
  const allProps = new Set(data.properties || []);
  // スナップショット側のプロパティも収集
  Object.values(snapshot.entities || {}).forEach(ent => { Object.keys(ent).forEach(p => { if (p !== '_freetext') allProps.add(p); }); });

  for (const ent of [...allEntities].sort()) {
    const snapEnt = snapshot.entities?.[ent] || {};
    const curEnt = data.entities?.[ent] || {};
    for (const prop of [...allProps].sort()) {
      if (prop === '_freetext') continue;
      const snapVals = (snapEnt[prop] || []);
      const curVals = (curEnt[prop] || []);
      const snapStr = snapVals.map(v => v.value + '(' + v.status + ')').join(', ');
      const curStr = curVals.map(v => v.value + '(' + v.status + ')').join(', ');
      if (snapStr === curStr) continue; // 変更なしはスキップ
      const changeType = !snapStr ? '追加' : !curStr ? '削除' : '変更';
      const rowCls = changeType === '追加' ? 'gb-diff-row-add' : changeType === '削除' ? 'gb-diff-row-del' : 'gb-diff-row-mod';
      html += `<tr class="${rowCls}">
        <td>${esc(ent)}</td>
        <td>${esc(prop)}</td>
        <td>${esc(snapVals.map(v=>v.value).join(', '))}</td>
        <td>${esc(snapVals.map(v=>v.status).join(', '))}</td>
        <td>${esc(curVals.map(v=>v.value).join(', '))}</td>
        <td>${esc(curVals.map(v=>v.status).join(', '))}</td>
        <td style="font-weight:bold;">${changeType}</td>
      </tr>`;
    }
  }
  html += '</table>';

  o.innerHTML = `<div class="gb-modal" style="min-width:800px;max-width:95vw;">
    <header class="gb-modal-header">
      <h3 class="gb-modal-title">DB差分: ${esc(title)} ↔ 現在</h3>
      <button class="gb-modal-close" ${_historyCloseAttrs('history-db-diff-close-icon')}>${lucide('x', 14)}</button>
    </header>
    <div class="gb-modal-body" style="overflow:auto;">${html}</div>
    <footer class="gb-modal-footer">
      <button class="gb-btn gb-btn-sm" ${_historyCloseAttrs('history-db-diff-close-footer')}>閉じる</button>
    </footer>
  </div>`;
  document.body.appendChild(o);
}

/* ==============================
   フォルダバージョン操作
   ============================== */

async function saveFolderVersion(folderPath) {
  const label = await cfPrompt('フォルダバージョンのラベル（任意）:', '');
  if (label === null) return;
  showLoading('フォルダバージョンを保存中...');
  try {
    await _flushOpenFolderVersionTargets(folderPath);
    const result = await apiPost('/version/save-folder', { path: folderPath, label, auto: false });
    showStatus(`フォルダバージョンを保存しました（${result.file_count}ファイル）`);
    _refreshVersionViews(folderPath, 'folder');
  } catch (err) {
    showStatus('フォルダバージョン保存に失敗しました', true);
  } finally { hideLoading(); }
}

async function showFolderVersionFiles(folderPath, versionName) {
  showLoading('ファイル一覧を取得中...');
  try {
    const meta = await apiFetch('/version/read-folder?path=' + encodeURIComponent(folderPath) + '&version=' + encodeURIComponent(versionName));
    hideLoading();
    const files = meta.files || [];
    const o = document.createElement('div');
    o.className = 'modal-overlay';
    o.style.zIndex = '110';
    let listHtml = '<div style="max-height:60vh;overflow:auto;">';
    files.forEach(f => {
      listHtml += `<div style="display:flex;align-items:center;gap:8px;padding:4px 0;border-bottom:1px solid var(--border);">
        <span style="flex:1;font-size:12px;">${esc(f.rel_path)}</span>
        <span style="font-size:11px;color:var(--fg2);">${formatFileSize(f.size)}</span>
      </div>`;
    });
    listHtml += '</div>';
    const label = meta.label ? ' — ' + esc(meta.label) : '';
    o.innerHTML = `<div class="gb-modal" style="min-width:500px;max-width:80vw;">
      <header class="gb-modal-header">
        <h3 class="gb-modal-title">フォルダバージョン: ${esc(versionName)}${label}</h3>
        <button class="gb-modal-close" ${_historyCloseAttrs('history-folder-files-close-icon')}>${lucide('x', 14)}</button>
      </header>
      <div class="gb-modal-body">
        <div class="gb-section-desc" style="margin-bottom:8px;">${files.length}ファイル</div>
        ${listHtml}
      </div>
      <footer class="gb-modal-footer">
        <button class="gb-btn gb-btn-sm" ${_historyCloseAttrs('history-folder-files-close-footer')}>閉じる</button>
      </footer>
    </div>`;
    document.body.appendChild(o);
  } catch (err) {
    hideLoading();
    showStatus('ファイル一覧の取得に失敗しました', true);
  }
}

async function restoreFolderVersion(folderPath, versionName) {
  // 復元前に影響範囲を確認
  showLoading('復元内容を確認中...');
  let meta;
  try {
    meta = await apiFetch('/version/read-folder?path=' + encodeURIComponent(folderPath) + '&version=' + encodeURIComponent(versionName));
  } catch (err) {
    hideLoading();
    showStatus('バージョン情報の取得に失敗しました', true);
    return;
  }
  hideLoading();

  const files = meta.files || [];
  const label = meta.label ? `「${meta.label}」` : versionName;
  const msg = `${label} を復元しますか？\n\n` +
    `${files.length}ファイルが上書きされます。\n` +
    `⚠ 復元前に現在の状態が自動保存されます。`;
  if (!await cfConfirm(msg)) return;

  showLoading('フォルダバージョンを復元中...');
  try {
    await _flushOpenFolderVersionTargets(folderPath);
    const result = await apiPost('/version/restore-folder', { path: folderPath, version: versionName });
    showStatus(`復元しました（${result.restored_count}ファイル）`);
    await _refreshRestoredFolderVersionTargets(folderPath, result?.restored_files || files.map(f => f.rel_path).filter(Boolean));
    _refreshVersionViews(folderPath, 'folder');
  } catch (err) {
    showStatus('フォルダバージョン復元に失敗しました', true);
  } finally { hideLoading(); }
}

async function deleteFolderVersion(folderPath, versionName) {
  if (!await cfConfirm('このフォルダバージョンを削除しますか？')) return;
  showLoading('削除中...');
  try {
    let currentName = versionName;
    let deletedToken = '';
    const result = await apiPost('/version/delete-folder', { path: folderPath, version: currentName });
    deletedToken = result?.token || '';
    if (deletedToken && typeof historyPush === 'function') {
      historyPush('フォルダバージョン削除: ' + versionName,
        async () => {
          if (!deletedToken) return;
          const restored = await apiPost('/version/undelete-folder', { path: folderPath, token: deletedToken });
          currentName = restored?.version || currentName;
          deletedToken = '';
          _refreshVersionViews(folderPath, 'folder');
        },
        async () => {
          const deleted = await apiPost('/version/delete-folder', { path: folderPath, version: currentName });
          deletedToken = deleted?.token || '';
          currentName = deleted?.version || currentName;
          _refreshVersionViews(folderPath, 'folder');
        },
        _historyActiveScope || '',
        folderPath
      );
    }
    showStatus(deletedToken ? 'フォルダバージョンを削除しました（Undoで戻せます）' : 'フォルダバージョンを削除しました');
    _refreshVersionViews(folderPath, 'folder');
  } catch (err) {
    showStatus('フォルダバージョン削除に失敗しました', true);
  } finally { hideLoading(); }
}

// フォルダ用のバージョンタブを開く
function openFolderVersionTab(folderPath) {
  if (!folderPath) { showStatus('フォルダパスがありません', true); return; }
  if (typeof openVersionTab === 'function') {
    openVersionTab(folderPath, 'folder');
  }
}

/* ==============================
   スコープ付きヒストリー（Undo/Redo）
   - scope付き: 開いているファイル/DB単位のスタック（例: 'db:キャラ'）
   - scopeなし: グローバルスタック（フォルダツリー操作等）
   - Ctrl+Z/Y: アクティブなスコープのスタックを優先、なければグローバル
   ============================== */
const _historyStacks = {};  // scope → { undo: [], redo: [] }
const _historyGlobal = { undo: [], redo: [] }; // scopeなし用
let _historyActiveScope = ''; // 現在アクティブなスコープ

function getHistoryMax() {
