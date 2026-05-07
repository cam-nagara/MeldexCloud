/**
 * Meldex History & Version Management
 * アンドゥ・リドゥ + バージョン管理
 */

/* ==============================
   バージョン管理
   ============================== */
// テキストdiffエンジン（Myers diff アルゴリズム簡易版）
function textDiff(oldText, newText) {
  const oldLines = oldText.split('\n'), newLines = newText.split('\n');
  const m = oldLines.length, n = newLines.length;
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
  if (_isScriptNoteVersionPath(path)) {
    return _flushOpenScriptNoteVersionTarget(path);
  }
  return 0;
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
function showScriptNoteDiff(oldDoc, newDoc, oldTitle, newTitle) {
  const oldRows = Array.isArray(oldDoc.rows) ? oldDoc.rows : [];
  const newRows = Array.isArray(newDoc.rows) ? newDoc.rows : [];

  // 行をテキスト化してdiff
  const toLine = (r) => (r.role ? r.role + '：' : '') + (r.text || '');
  const oldLines = oldRows.map(toLine);
  const newLines = newRows.map(toLine);
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
  if (typeof _splitPath !== 'undefined' && _splitPath) { path = _splitPath; }
  else if (state.view === 'page') { const pc = document.getElementById('page-content'); path = pc?.dataset?.path || ''; }
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
    const result = await apiPost('/version/restore-folder', { path: folderPath, version: versionName });
    showStatus(`復元しました（${result.restored_count}ファイル）`);
    // ビューをリロード
    if (state.currentDbPath && folderPath === state.currentDbPath) {
      selectDatabase(state.currentDbPath);
    }
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
  try { return parseInt(localStorage.getItem('history-max')) || 50; } catch { return 50; }
}
function setHistoryMax(n) { localStorage.setItem('history-max', n); }

function _getStack(scope) {
  if (!scope) return _historyGlobal;
  if (!_historyStacks[scope]) _historyStacks[scope] = { undo: [], redo: [] };
  return _historyStacks[scope];
}

// アクティブスコープを設定（DBやツール切り替え時に呼ぶ）
function historySetScope(scope) {
  _historyActiveScope = scope || '';
  renderHistoryList();
  renderHistoryPanel();
}

function _historyScopeDisplayName(scope) {
  const raw = scope ? scope.split(':').slice(1).join(':') : '';
  // パスの場合はファイル名のみ表示
  return raw.includes('/') ? raw.split('/').pop() : raw;
}

function _historyDisplayParts(entry) {
  const label = String(entry?.label || '');
  const explicitDetail = String(entry?.detail || '').trim();
  if (explicitDetail) return { title: label, detail: explicitDetail };
  const colonIdx = label.indexOf(': ');
  if (colonIdx >= 0) return { title: label.slice(0, colonIdx), detail: label.slice(colonIdx + 2) };
  return { title: label, detail: '' };
}

function summarizeHistoryTextChange(beforeText, afterText) {
  const before = String(beforeText || '');
  const after = String(afterText || '');
  if (before === after) return '内容を更新';
  const diff = typeof textDiff === 'function' ? textDiff(before, after) : [];
  let add = 0;
  let del = 0;
  diff.forEach(part => {
    if (part.type === 'add' && part.text.trim()) add += 1;
    if (part.type === 'del' && part.text.trim()) del += 1;
  });
  if (add === 0 && del === 0) return '内容を更新';
  if (add > 0 && del > 0) return `追記 ${add} 行 / 削除 ${del} 行`;
  if (add > 0) return `追記 ${add} 行`;
  return `削除 ${del} 行`;
}

let _localStorageSettingsHistoryRestoring = 0;

function isLocalStorageSettingsHistoryRestoring() {
  return _localStorageSettingsHistoryRestoring > 0;
}

function isLocalStorageSettingsHistorySuppressed() {
  const globalSuppress = typeof window !== 'undefined'
    && Number(window.__meldexSuppressLocalStorageSettingsHistory || 0) > 0;
  return isLocalStorageSettingsHistoryRestoring() || globalSuppress;
}

function captureLocalStorageSettings(keys) {
  const list = [...new Set((Array.isArray(keys) ? keys : []).filter(Boolean))];
  const storage = {};
  list.forEach(key => {
    try { storage[key] = localStorage.getItem(key); }
    catch { storage[key] = null; }
  });
  return { keys: list, storage };
}

function _normalizeLocalStorageSettingsSnapshots(beforeSnapshot, afterSnapshot) {
  const keys = [...new Set([
    ...(beforeSnapshot?.keys || Object.keys(beforeSnapshot?.storage || {})),
    ...(afterSnapshot?.keys || Object.keys(afterSnapshot?.storage || {})),
  ].filter(Boolean))];
  const normalize = snapshot => {
    const storage = {};
    keys.forEach(key => {
      storage[key] = Object.prototype.hasOwnProperty.call(snapshot?.storage || {}, key)
        ? snapshot.storage[key]
        : null;
    });
    return { keys: keys.slice(), storage };
  };
  return { before: normalize(beforeSnapshot), after: normalize(afterSnapshot) };
}

function restoreLocalStorageSettings(snapshot, onRestore) {
  if (!snapshot?.storage) return false;
  const keys = snapshot.keys || Object.keys(snapshot.storage);
  _localStorageSettingsHistoryRestoring += 1;
  try {
    keys.forEach(key => {
      const value = Object.prototype.hasOwnProperty.call(snapshot.storage, key) ? snapshot.storage[key] : null;
      if (value === null || value === undefined) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    });
    if (typeof onRestore === 'function') onRestore(keys.slice(), snapshot);
    try {
      window.dispatchEvent(new CustomEvent('meldex-local-storage-settings-restored', {
        detail: { keys: keys.slice() },
      }));
    } catch {}
  } finally {
    _localStorageSettingsHistoryRestoring -= 1;
  }
  return true;
}

function pushLocalStorageSettingsHistory(label, beforeSnapshot, afterSnapshot, detail, onRestore) {
  if (typeof historyPush !== 'function' || isLocalStorageSettingsHistorySuppressed()) return false;
  if (!beforeSnapshot?.storage || !afterSnapshot?.storage) return false;
  const snapshots = _normalizeLocalStorageSettingsSnapshots(beforeSnapshot, afterSnapshot);
  let beforeKey = '';
  let afterKey = '';
  try {
    beforeKey = JSON.stringify(snapshots.before);
    afterKey = JSON.stringify(snapshots.after);
  } catch {}
  if (beforeKey && beforeKey === afterKey) return false;
  const scope = (typeof _historyActiveScope !== 'undefined') ? _historyActiveScope : '';
  historyPush(
    label || '設定変更',
    () => restoreLocalStorageSettings(snapshots.before, onRestore),
    () => restoreLocalStorageSettings(snapshots.after, onRestore),
    scope,
    detail || ''
  );
  return true;
}

function withLocalStorageSettingsHistory(label, keys, mutator, detail, onRestore) {
  const before = captureLocalStorageSettings(keys);
  const result = typeof mutator === 'function' ? mutator() : undefined;
  const after = captureLocalStorageSettings(keys);
  pushLocalStorageSettingsHistory(label, before, after, detail, onRestore);
  return result;
}

// アクションを記録（undoFnとredoFnはasync可、scopeはオプション）
function historyPush(label, undoFn, redoFn, scope, detail) {
  const s = _getStack(scope);
  s.undo.push({ label, detail: detail || '', undo: undoFn, redo: redoFn, time: Date.now(), scope: scope || '' });
  const max = getHistoryMax();
  while (s.undo.length > max) s.undo.shift();
  s.redo.length = 0;
  renderHistoryList();
  renderHistoryPanel();
}

async function historyUndo(scope) {
  const s = _getStack(scope);
  if (s.undo.length === 0) {
    // スコープスタックが空でもグローバルにフォールバックしない（無関係な操作の巻き戻り防止）
    showStatus('元に戻す操作がありません'); return;
  }
  const entry = s.undo.pop();
  // undo関数がnullのエントリ（ログ専用）はスキップして次を試行
  if (!entry.undo) {
    s.redo.push(entry);
    showStatus('↩ ' + entry.label + '（復元不可）');
    renderHistoryList();
    renderHistoryPanel();
    return;
  }
  // 台本スコープ: undo 前の状態を毎回キャプチャして redo に差し替える。
  // 過去の _redoCaptured フラグは undo/redo 往復で state が乖離する原因になったため廃止。
  if (entry.scope && entry.scope.startsWith('scriptnote:') && typeof _captureScriptnoteState === 'function') {
    const redoState = _captureScriptnoteState(entry.scope);
    entry.redo = () => { _restoreScriptnoteState(redoState, entry.scope); };
  }
  try { await entry.undo(); } catch(e) { showStatus('Undo失敗: ' + e.message, true); s.undo.push(entry); return; }
  s.redo.push(entry);
  showStatus('↩ ' + entry.label);
  renderHistoryList();
  renderHistoryPanel();
}

async function historyRedo(scope) {
  const s = _getStack(scope);
  if (s.redo.length === 0) {
    // スコープスタックが空でもグローバルにフォールバックしない
    showStatus('やり直す操作がありません'); return;
  }
  const entry = s.redo.pop();
  // redo関数がnullのエントリ（ログ専用）はスキップ
  if (!entry.redo) {
    s.undo.push(entry);
    showStatus('↪ ' + entry.label + '（復元不可）');
    renderHistoryList();
    renderHistoryPanel();
    return;
  }
  // 台本スコープ: redo 前の状態を毎回キャプチャして undo に差し替える
  if (entry.scope && entry.scope.startsWith('scriptnote:') && typeof _captureScriptnoteState === 'function') {
    const undoState = _captureScriptnoteState(entry.scope);
    entry.undo = () => { _restoreScriptnoteState(undoState, entry.scope); };
  }
  try { await entry.redo(); } catch(e) { showStatus('Redo失敗: ' + e.message, true); s.redo.push(entry); return; }
  s.undo.push(entry);
  showStatus('↪ ' + entry.label);
  renderHistoryList();
  renderHistoryPanel();
}

function renderHistoryList() {
  const el = document.getElementById('rp-history-list');
  if (!el) return;

  const allUndo = [];
  const allRedo = [];
  const seenUndo = new Set();
  const seenRedo = new Set();
  const collect = (stack, target, seen) => {
    if (!stack) return;
    stack.forEach(entry => {
      if (seen.has(entry)) return;
      seen.add(entry);
      target.push(entry);
    });
  };

  const activeStack = _historyActiveScope ? _getStack(_historyActiveScope) : null;
  if (activeStack) {
    collect(activeStack.undo, allUndo, seenUndo);
    collect(activeStack.redo, allRedo, seenRedo);
  }
  collect(_historyGlobal.undo, allUndo, seenUndo);
  collect(_historyGlobal.redo, allRedo, seenRedo);
  Object.entries(_historyStacks).forEach(([scope, stack]) => {
    if (scope === _historyActiveScope) return;
    collect(stack.undo, allUndo, seenUndo);
    collect(stack.redo, allRedo, seenRedo);
  });

  allUndo.sort((a, b) => b.time - a.time);
  allRedo.sort((a, b) => b.time - a.time);

  const formatScopeTag = (scope) => {
    if (!scope) return '';
    const label = scope.includes(':') ? scope.split(':').slice(1).join(':') : scope;
    return `<span class="gb-hp-scope-tag">${esc(label)}</span> `;
  };

  let html = '';
  allRedo.forEach(e => {
    const parts = _historyDisplayParts(e);
    html += `<div class="gb-hp-entry gb-hp-entry-redo">↪ ${formatScopeTag(e.scope)}${esc(parts.title)}`
      + (parts.detail ? `<div class="gb-hp-detail">${esc(parts.detail)}</div>` : '')
      + `</div>`;
  });
  html += `<div class="gb-hp-current">${lucide('play', 10)} 現在</div>`;
  allUndo.forEach(e => {
    const time = new Date(e.time).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const parts = _historyDisplayParts(e);
    html += `<div class="gb-hp-entry gb-hp-entry-undo">`
      + `${formatScopeTag(e.scope)}<span class="gb-hp-title">${esc(parts.title)}</span>`
      + `<span class="gb-hp-time">${time}</span>`
      + (parts.detail ? `<div class="gb-hp-detail">${esc(parts.detail)}</div>` : '')
      + `</div>`;
  });
  if (allUndo.length === 0 && allRedo.length === 0) {
    html = `<div class="gb-hp-empty">操作履歴がありません<div class="gb-hp-empty-hint">このヒストリーは現在の起動中のみ保持されます。シートの永続ログは「編集履歴」を使ってください。</div></div>`;
  }
  el.innerHTML = html;
}
// === 操作履歴パネル（詳細パネルのタブ） ===
let _historyPanelFilter = 'current'; // 'current' | 'all'

function renderHistoryPanel() {
  const el = document.getElementById('detail-tab-op-history');
  if (!el) return;

  // 全スコープの全エントリを収集
  const allEntries = [];
  const collectFrom = (stack, type) => {
    stack.forEach((e, i) => allEntries.push({ ...e, _type: type, _idx: i, _stack: stack }));
  };

  if (_historyPanelFilter === 'current' && _historyActiveScope) {
    const s = _getStack(_historyActiveScope);
    collectFrom(s.undo, 'undo');
    collectFrom(s.redo, 'redo');
  } else {
    // 全スコープ
    collectFrom(_historyGlobal.undo, 'undo');
    collectFrom(_historyGlobal.redo, 'redo');
    for (const [, s] of Object.entries(_historyStacks)) {
      collectFrom(s.undo, 'undo');
      collectFrom(s.redo, 'redo');
    }
  }

  // 時系列ソート（新しい順）
  allEntries.sort((a, b) => b.time - a.time);

  // undo/redoの境界を特定（最新のundoエントリが「現在位置」）
  const undoEntries = allEntries.filter(e => e._type === 'undo');
  const redoEntries = allEntries.filter(e => e._type === 'redo');

  // フィルタUI
  const scopeLabel = _historyActiveScope ? _historyScopeDisplayName(_historyActiveScope) : 'すべて';
  let html = `<div class="gb-hp-toolbar">
    <select id="hp-filter" class="gb-select gb-select-sm" style="flex:1;"
      data-onchange="this.value==='all'?(_historyPanelFilter='all'):(_historyPanelFilter='current');renderHistoryPanel()">
      <option value="current"${_historyPanelFilter==='current'?' selected':''}>現在: ${esc(scopeLabel)}</option>
      <option value="all"${_historyPanelFilter==='all'?' selected':''}>すべて</option>
    </select>
    <button class="gb-btn gb-btn-xs gb-btn-quiet" data-action="historyPanelClear()">クリア</button>
  </div>`;

  // redo（将来に戻す操作）
  redoEntries.forEach(e => {
    const time = new Date(e.time).toLocaleTimeString('ja-JP', { hour:'2-digit', minute:'2-digit', second:'2-digit' });
    const icon = _hpScopeIcon(e.scope);
    const scopeTag = (_historyPanelFilter === 'all' && e.scope) ? `<span class="gb-hp-scope-tag">${esc(_historyScopeDisplayName(e.scope))}</span> ` : '';
    html += `<div class="gb-hp-entry gb-hp-entry-redo">
      ${icon}${scopeTag}<span class="gb-hp-label">${esc(e.label)}</span>
      <span class="gb-hp-time">${time}</span>
    </div>`;
  });

  // 現在位置マーカー
  html += `<div class="gb-hp-current">${lucide('play', 12)} 現在</div>`;

  // undo（過去の操作）
  undoEntries.forEach((e, i) => {
    const time = new Date(e.time).toLocaleTimeString('ja-JP', { hour:'2-digit', minute:'2-digit', second:'2-digit' });
    const icon = _hpScopeIcon(e.scope);
    const clickable = e.undo !== null;
    const scopeTag = (_historyPanelFilter === 'all' && e.scope) ? `<span class="gb-hp-scope-tag">${esc(_historyScopeDisplayName(e.scope))}</span> ` : '';
    const cls = clickable ? 'gb-hp-entry gb-hp-entry-undo gb-hp-entry-clickable' : 'gb-hp-entry gb-hp-entry-undo gb-hp-entry-disabled';
    const steps = e._stack.length - e._idx;
    const action = clickable ? _historyActionAttrs('historyPanelJump', [steps, e.scope || '']) : '';
    html += `<div class="${cls}" ${action}>
      ${icon}${scopeTag}<span class="gb-hp-label">${esc(e.label)}</span>
      <span class="gb-hp-time">${time}</span>
    </div>`;
  });

  if (undoEntries.length === 0 && redoEntries.length === 0) {
    html += `<div class="gb-hp-empty">操作履歴がありません<div class="gb-hp-empty-hint">このヒストリーは現在の起動中のみ保持されます。シートの永続ログは「編集履歴」を使ってください。</div></div>`;
  }
  el.innerHTML = html;
}

function _hpScopeIcon(scope) {
  if (!scope) return '';
  const s = scope.split(':')[0];
  const name = s === 'scriptnote' ? 'bookOpenText' : s === 'db' ? 'database' : s === 'page' ? 'fileEdit' : 'file';
  return typeof lucide === 'function' ? lucide(name, 12) + ' ' : '';
}

async function historyPanelJump(steps, scope) {
  if (steps <= 0) return;
  const targetScope = arguments.length >= 2 ? (scope || '') : _historyActiveScope;
  if (steps >= 3) {
    const ok = await cfConfirm(steps + '件の操作を元に戻しますか？');
    if (!ok) return;
  }
  for (let i = 0; i < steps; i++) {
    await historyUndo(targetScope);
  }
}

function historyPanelClear() {
  if (_historyActiveScope) {
    const s = _getStack(_historyActiveScope);
    s.undo.length = 0;
    s.redo.length = 0;
  } else {
    _historyGlobal.undo.length = 0;
    _historyGlobal.redo.length = 0;
  }
  renderHistoryList();
  renderHistoryPanel();
  showStatus('操作履歴をクリアしました');
}

// Ctrl+Z / Ctrl+Y → gb-shortcuts.js の中央ハンドラに移行済み
