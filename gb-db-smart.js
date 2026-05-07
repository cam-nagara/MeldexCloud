/* スマートシート — gb-database.js から分離 */

let _smartDbRequestSeq = 0;

function _smartDbApplyAutoLinks(el, rawText, scopePath) {
  if (!el || typeof MeldexAutoLink === 'undefined' || String(rawText || '').length < 2) return false;
  MeldexAutoLink.applyToDom(el, scopePath || '');
  return !!el.querySelector('.auto-link');
}

function _smartDbHandleAutoLinkClick(e) {
  const al = e.target.closest('.auto-link');
  if (!al || typeof onAutoLinkClick !== 'function') return false;
  e.stopPropagation();
  onAutoLinkClick(al, e);
  return true;
}

function _ensureSmartDbViews(def) {
  if (!def || typeof def !== 'object') return def;
  if (!def.views || typeof def.views !== 'object' || Array.isArray(def.views)) def.views = {};
  if (!def.views.table || typeof def.views.table !== 'object' || Array.isArray(def.views.table)) def.views.table = {};
  if (def.views.dashboard) {
    if (typeof def.views.dashboard !== 'object' || Array.isArray(def.views.dashboard)) def.views.dashboard = {};
    if (!Array.isArray(def.views.dashboard.widgets)) def.views.dashboard.widgets = [];
  }
  if (def.activeView !== 'dashboard') def.activeView = 'table';
  return def;
}

function normalizeSmartDbDefinition(def) {
  const next = def && typeof def === 'object' ? def : {};
  next.type = 'smart-db';
  next.name = next.name || '無題';
  next.sourceType = next.sourceType === 'all-files' ? 'all-files' : 'db-entities';
  if (!Array.isArray(next.filters)) next.filters = [];
  return _ensureSmartDbViews(next);
}

function _serializeSmartDbDefinition(def) {
  const src = normalizeSmartDbDefinition({ ...(def || {}) });
  const out = {};
  Object.keys(src).forEach(k => {
    if (!k.startsWith('_')) out[k] = src[k];
  });
  out.type = 'smart-db';
  return out;
}

function _captureSmartDbHistorySnapshot(def) {
  if (!def) return null;
  const out = _serializeSmartDbDefinition(JSON.parse(JSON.stringify(def)));
  out.id = def.id || out.id;
  if (def._filePath) out._filePath = def._filePath;
  if (def._fileId) out._fileId = def._fileId;
  return out;
}

async function _restoreSmartDbHistorySnapshot(snapshot) {
  if (!snapshot?.id) return false;
  const def = normalizeSmartDbDefinition(JSON.parse(JSON.stringify(snapshot)));
  if (snapshot._filePath) def._filePath = snapshot._filePath;
  if (snapshot._fileId) def._fileId = snapshot._fileId;
  await saveSmartDbDef(def);
  if (state.currentSmartDb?.id === def.id || (def._filePath && state.currentSmartDb?._filePath === def._filePath)) {
    await selectSmartDb(def.id, def, {
      skipNavPush: true,
      skipRecent: true,
      skipSaveLastView: true,
      skipAutoVersion: true,
      skipStatus: true,
    });
  } else {
    renderSmartDbList();
  }
  return true;
}

async function _deleteSmartDbHistorySnapshot(snapshot) {
  if (!snapshot?.id || snapshot._filePath) return false;
  setSavedSmartDbs(getSavedSmartDbs().filter(d => d.id !== snapshot.id));
  if (state.currentSmartDb?.id === snapshot.id) {
    state.currentSmartDb = null;
    state.smartDbData = null;
    showView('welcome');
  }
  renderSmartDbList();
  return true;
}

function _smartDbHistoryScopeFor(before, after) {
  const activeScope = (typeof _historyActiveScope !== 'undefined') ? _historyActiveScope : '';
  const snapshot = after || before;
  const target = snapshot?._filePath || snapshot?.id || '';
  if (!target) return activeScope;
  const targetScope = 'smart-db:' + target;
  const currentMatches = state.currentSmartDb?.id === snapshot.id
    || (snapshot._filePath && state.currentSmartDb?._filePath === snapshot._filePath);
  if (!before || currentMatches) return targetScope;
  return activeScope || targetScope;
}

function pushSmartDbDefinitionHistory(label, beforeSnapshot, afterSnapshot, detail) {
  if (typeof historyPush !== 'function') return false;
  const before = beforeSnapshot ? _captureSmartDbHistorySnapshot(beforeSnapshot) : null;
  const after = afterSnapshot ? _captureSmartDbHistorySnapshot(afterSnapshot) : null;
  if (!before && !after) return false;
  let beforeKey = '';
  let afterKey = '';
  try {
    beforeKey = JSON.stringify(before || null);
    afterKey = JSON.stringify(after || null);
  } catch {}
  if (beforeKey && beforeKey === afterKey) return false;
  const scope = _smartDbHistoryScopeFor(before, after);
  historyPush(
    label || 'スマートシート変更',
    () => before ? _restoreSmartDbHistorySnapshot(before) : _deleteSmartDbHistorySnapshot(after),
    () => after ? _restoreSmartDbHistorySnapshot(after) : _deleteSmartDbHistorySnapshot(before),
    scope,
    detail || (after?.name || before?.name || '')
  );
  return true;
}

async function saveSmartDbDef(def, opts) {
  if (!def) return false;
  const saveOpts = opts || {};
  normalizeSmartDbDefinition(def);
  if (def._filePath) {
    if (!saveOpts.skipFileSave) {
      await apiFetch('/file?path=' + encodeURIComponent(def._filePath), {
        method: 'POST',
        body: JSON.stringify({ content: JSON.stringify(_serializeSmartDbDefinition(def), null, 2) })
      });
    }
    if (!saveOpts.skipVersionDirty && typeof markAutoVersionDirty === 'function') markAutoVersionDirty();
    return true;
  }
  const dbs = getSavedSmartDbs();
  const idx = dbs.findIndex(d => d.id === def.id);
  const stored = _serializeSmartDbDefinition(def);
  stored.id = def.id;
  if (idx >= 0) dbs[idx] = stored;
  else dbs.push(stored);
  setSavedSmartDbs(dbs);
  renderSmartDbList();
  return true;
}

function _findSmartDbDefinition(smartDbId) {
  if (state.currentSmartDb?.id === smartDbId) return state.currentSmartDb;
  const saved = getSavedSmartDbs().find(d => d.id === smartDbId);
  return saved ? normalizeSmartDbDefinition(saved) : null;
}

function removeLegacyDashboardStorageOnce() {
  if (localStorage.getItem('migrated:dashboard-removed')) return;
  localStorage.removeItem('dashboards');
  const keys = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith('dashboard:')) keys.push(key);
  }
  keys.forEach(key => localStorage.removeItem(key));
  localStorage.setItem('migrated:dashboard-removed', '1');
}

// ファイルベースのスマートシートを開く（v5.0: フォルダ内JSONファイルとして管理）
async function openSmartDbFile(label, path, opts) {
  const openOpts = opts || {};
  const pathText = String(path || '');
  if (pathText.startsWith('smart-db:')) {
    return selectSmartDb(pathText.slice('smart-db:'.length), null, openOpts);
  }
  try {
    const data = await apiFetch('/file?path=' + encodeURIComponent(pathText));
    const def = normalizeSmartDbDefinition(JSON.parse(data.content || '{}'));
    def.id = def.id || 'file:' + pathText;
    def.name = def.name || label;
    def._filePath = pathText;
    const fid = _pathToFileId(pathText);
    if (fid) def._fileId = fid;
    state.currentSmartDb = def;
    return selectSmartDb(def.id, def, openOpts);
  } catch (e) {
    if (!openOpts.skipGlobalUi) showStatus('スマートシートの読み込みに失敗: ' + e.message, true);
  }
}

function getSavedSmartDbs() { try { return JSON.parse(localStorage.getItem('smartDbs') || '[]'); } catch { return []; } }
function setSavedSmartDbs(dbs) { localStorage.setItem('smartDbs', JSON.stringify((dbs || []).map(d => _serializeSmartDbDefinition(d)))); }

function createSmartDb() {
  const dbs = getSavedSmartDbs();
  let idx = 1, name = '無題';
  const names = dbs.map(d => d.name);
  while (names.includes(name)) { idx++; name = '無題' + idx; }
  const id = 'smart-db-' + Date.now();
  const newDb = normalizeSmartDbDefinition({ id, name, filters: [{ property: 'ステータス', field: 'value', operator: 'equals', value: '案' }], created: new Date().toISOString() });
  dbs.push(newDb);
  setSavedSmartDbs(dbs);
  if (typeof pushSmartDbDefinitionHistory === 'function') {
    pushSmartDbDefinitionHistory('スマートシート: 作成', null, newDb, newDb.name);
  }
  renderSmartDbList();
  selectSmartDb(id);
}

async function deleteSmartDb(id) {
  if (typeof cfConfirm === 'function' && !await cfConfirm('このスマートシートを削除しますか？')) return;
  const before = _findSmartDbDefinition(id);
  setSavedSmartDbs(getSavedSmartDbs().filter(d => d.id !== id));
  if (typeof pushSmartDbDefinitionHistory === 'function') {
    pushSmartDbDefinitionHistory('スマートシート: 削除', before, null, before?.name || id);
  }
  if (state.currentSmartDb?.id === id) {
    state.currentSmartDb = null;
    state.smartDbData = null;
    showView('welcome');
  }
  renderSmartDbList();
  showStatus('スマートシートを削除しました');
}

function renderSmartDbList() {
  const container = document.getElementById('body-smart-db');
  if (!container) return;
  const dbs = getSavedSmartDbs();
  container.innerHTML = '';
  // ＋ボタン
  const addBtn = document.createElement('div');
  addBtn.style.cssText = 'padding:2px 8px;font-size:11px;color:var(--fg2);cursor:pointer;display:flex;align-items:center;gap:4px;';
  addBtn.innerHTML = lucide('plus', 12) + ' 新規スマートシート';
  addBtn.addEventListener('click', createSmartDb);
  container.appendChild(addBtn);
  // 全件インデックス作成ボタン
  const addGlobalBtn = document.createElement('div');
  addGlobalBtn.style.cssText = 'padding:2px 8px;font-size:11px;color:var(--fg2);cursor:pointer;display:flex;align-items:center;gap:4px;';
  addGlobalBtn.innerHTML = lucide('plus', 12) + ' 全件インデックスを新規作成';
  addGlobalBtn.addEventListener('click', () => {
    if (typeof createGlobalIndexSmartDb === 'function') createGlobalIndexSmartDb();
  });
  container.appendChild(addGlobalBtn);
  dbs.forEach(d => {
    const item = document.createElement('div');
    item.className = 'fav-item';
    item.innerHTML = lucide('databaseSearch', 14) + ' <span style="overflow:hidden;text-overflow:ellipsis;">' + esc(d.name) + '</span>';
    item.title = (d.filters || []).map(f => f.property + ' ' + f.operator + ' ' + f.value).join(', ');
    item.addEventListener('click', () => selectSmartDb(d.id));
    item.oncontextmenu = (e) => {
      e.preventDefault();
      const menu = document.createElement('div');
      menu.className = 'gb-context-menu';
      { const z = (typeof _getZoom === 'function') ? _getZoom() : (parseFloat(document.documentElement.style.zoom) || 1); menu.style.left = (e.clientX / z) + 'px'; menu.style.top = (e.clientY / z) + 'px'; }
      function addMI(label, fn) { const mi = document.createElement('div'); mi.textContent = label; mi.style.cssText = 'padding:4px 12px;cursor:pointer;'; mi.onmouseenter = () => { mi.style.background = 'var(--bg4)'; }; mi.onmouseleave = () => { mi.style.background = ''; }; mi.addEventListener('click', () => { menu.remove(); fn(); }); menu.appendChild(mi); }
      addMI('フィルタ設定', () => {
        if (d.sourceType === 'all-files' && typeof showGlobalIndexFilterModal === 'function') {
          showGlobalIndexFilterModal(d.id);
        } else {
          showSmartDbFilterModal(d.id);
        }
      });
      addMI('リネーム', async () => {
        const newName = await cfPrompt('新しい名前:', d.name);
        if (newName && newName !== d.name) {
          const before = _captureSmartDbHistorySnapshot(_findSmartDbDefinition(d.id) || d);
          const dbs2 = getSavedSmartDbs();
          const t = dbs2.find(x => x.id === d.id);
          if (t) {
            t.name = newName;
            setSavedSmartDbs(dbs2);
            if (state.currentSmartDb?.id === d.id) {
              state.currentSmartDb.name = newName;
              const currentTitleEl = document.getElementById('current-title');
              if (currentTitleEl) currentTitleEl.textContent = newName;
              const sbCategoryEl = document.getElementById('sb-category');
              if (sbCategoryEl) sbCategoryEl.textContent = 'スマートシート: ' + newName;
            }
            if (typeof pushSmartDbDefinitionHistory === 'function') {
              pushSmartDbDefinitionHistory('スマートシート: リネーム', before, t, newName);
            }
            renderSmartDbList();
          }
        }
      });
      addMI('削除', () => deleteSmartDb(d.id));
      document.body.appendChild(menu);
      clampPopupToViewport(menu);
      setTimeout(() => { document.addEventListener('pointerdown', function cl(ev) { if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener('pointerdown', cl); } }); }, 0);
    };
    container.appendChild(item);
  });
}
renderSmartDbList();

async function selectSmartDb(smartDbId, defOverride, opts) {
  const openOpts = opts || {};
  const rawDef = defOverride || getSavedSmartDbs().find(d => d.id === smartDbId);
  if (!rawDef) { showStatus('スマートシートが見つかりません', true); return; }
  const def = normalizeSmartDbDefinition(rawDef);
  const recentPath = def._filePath || ('smart-db:' + smartDbId);
  if (!openOpts.skipStateView) state.view = 'smart-db';
  state.currentSmartDb = def;
  state.currentDbPath = null;
  if (!openOpts.skipShowView) showView('smart-db');
  if (!openOpts.skipGlobalUi) {
    const currentTitleEl = document.getElementById('current-title');
    if (currentTitleEl) currentTitleEl.textContent = def.name;
    const sbCategoryEl = document.getElementById('sb-category');
    if (sbCategoryEl) sbCategoryEl.textContent = 'スマートシート: ' + def.name;
  }
  if (!openOpts.skipSaveLastView) saveLastView({ type: 'smart-db', smartDbId, path: recentPath });
  if (!openOpts.skipNavPush) {
    const _navEntry = { type: 'smart-db', smartDbId, label: def.name, path: recentPath };
    navPush(_navEntry);
  }
  if (!openOpts.skipRecent) addRecent(def.name, recentPath, 'smart-db');
  if (!openOpts.skipHighlight && def._filePath) highlightOutlinerNode(def._filePath);
  if (!openOpts.skipAutoVersion && def._filePath && typeof startAutoVersion === 'function') startAutoVersion(def._filePath, 'file');
  if (!openOpts.skipHistoryScope && typeof historySetScope === 'function') {
    historySetScope('smart-db:' + (def._filePath || def.id || smartDbId || ''));
  }
  if (!openOpts.skipGlobalUi) showStatus('スキャン中...');
  const requestSeq = ++_smartDbRequestSeq;
  try {
    if (def.sourceType === 'all-files') {
      const data = await (typeof loadGlobalIndexData === 'function' ? loadGlobalIndexData(def) : Promise.resolve({ files: [], total: 0 }));
      if (requestSeq !== _smartDbRequestSeq || state.currentSmartDb?.id !== def.id) return;
      state.smartDbData = data;
      if (typeof renderGlobalIndexTable === 'function') renderGlobalIndexTable(def);
      if (!openOpts.skipGlobalUi) showStatus((data.files || []).length + ' / ' + (data.total || 0) + ' 件');
      return;
    }
    const url = '/smart-db?filters=' + encodeURIComponent(JSON.stringify(def.filters));
    const data = await apiFetch(url);
    if (requestSeq !== _smartDbRequestSeq || state.currentSmartDb?.id !== def.id) return;
    state.smartDbData = data;
    renderSmartDbTable();
    if (typeof renderSmartDbActiveView === 'function') renderSmartDbActiveView();
    if (!openOpts.skipGlobalUi) showStatus((state.smartDbData.entities || []).length + ' 件（' + state.smartDbData.total_dbs_scanned + ' シートをスキャン）');
  } catch (e) {
    if (requestSeq !== _smartDbRequestSeq || state.currentSmartDb?.id !== def.id) return;
    state.smartDbData = def.sourceType === 'all-files'
      ? { files: [], source_roots: [], total: 0 }
      : { entities: [], filter_properties: [], total_dbs_scanned: 0 };
    if (def.sourceType === 'all-files') {
      if (typeof renderGlobalIndexTable === 'function') renderGlobalIndexTable(def);
    } else {
      renderSmartDbTable();
      if (typeof renderSmartDbActiveView === 'function') renderSmartDbActiveView();
    }
    if (!openOpts.skipGlobalUi) showStatus('スマートシート読み込み失敗', true);
  }
}

function _smartDbSourceEntityName(ent) {
  const pathName = String(ent?.path || '').split(/[\\/]/).pop().replace(/\.md$/i, '');
  return String(ent?.name || pathName || '');
}

function _smartDbFindSourceRow(entityName) {
  if (!entityName) return null;
  const rows = [...document.querySelectorAll('tr[data-entity-name]')];
  return rows.find(row => row.dataset.entityName === entityName && row.getClientRects().length > 0)
    || rows.find(row => row.dataset.entityName === entityName)
    || null;
}

async function _smartDbHighlightSourceRow(entityName) {
  for (let i = 0; i < 30; i++) {
    const row = _smartDbFindSourceRow(entityName);
    if (row) {
      row.scrollIntoView({ block: 'center', inline: 'nearest' });
      if (typeof setActiveCell === 'function') setActiveCell(row.children[0]);
      else row.children[0]?.focus?.({ preventScroll: true });
      return true;
    }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  return false;
}

function _smartDbEnsureSourcePivotView(dbPath) {
  if (!dbPath || typeof getCurrentViewMode !== 'function') return;
  const ctx = typeof _currentPaneState === 'function' ? _currentPaneState() : undefined;
  const views = typeof getSavedViews === 'function' ? getSavedViews(dbPath) : [];
  if (Array.isArray(views) && views.length > 0 && getCurrentViewMode(dbPath) === 'pivot') return;
  const pivotIdx = Array.isArray(views)
    ? views.findIndex(view => (view?.viewMode || 'pivot') === 'pivot')
    : -1;
  if (pivotIdx >= 0 && typeof loadSavedView === 'function') {
    loadSavedView(pivotIdx, ctx, { skipHistory: true });
    return;
  }
  if (typeof doSaveViewWithTypeDirect === 'function') {
    doSaveViewWithTypeDirect('pivot', 'テーブル');
    return;
  }
}

async function openSmartDbRowInSourceSheet(ent) {
  const dbPath = ent?.db_path || '';
  const entityName = _smartDbSourceEntityName(ent);
  if (!dbPath) {
    if (typeof showStatus === 'function') showStatus('元シートを特定できません', true);
    return false;
  }
  if (typeof selectDatabase === 'function') await selectDatabase(dbPath);
  _smartDbEnsureSourcePivotView(dbPath);
  const highlighted = await _smartDbHighlightSourceRow(entityName);
  if (typeof showStatus === 'function') {
    showStatus(highlighted ? '元シートで行を開きました' : '元シートを開きました');
  }
  return highlighted;
}

function showSmartDbRowContextMenu(event, ent) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }
  document.querySelectorAll('.smart-db-row-menu').forEach(el => el.remove());
  const menu = document.createElement('div');
  menu.className = 'gb-context-menu smart-db-row-menu';
  const item = document.createElement('div');
  item.className = 'gb-context-menu-item';
  item.innerHTML = lucide('table', 14) + ' 元シートでこの行を開く';
  item.addEventListener('click', () => {
    menu.remove();
    openSmartDbRowInSourceSheet(ent);
  });
  menu.appendChild(item);
  positionPopup(menu, {
    left: event?.clientX || 0,
    right: event?.clientX || 0,
    top: event?.clientY || 0,
    bottom: event?.clientY || 0,
  });
  setTimeout(() => {
    const closer = (ev) => {
      if (!menu.contains(ev.target)) {
        menu.remove();
        document.removeEventListener('pointerdown', closer);
      }
    };
    document.addEventListener('pointerdown', closer);
  }, 0);
}

function renderSmartDbTable() {
  const data = state.smartDbData;
  if (!data) return;
  const thead = document.querySelector('#smart-db-table thead');
  const tbody = document.querySelector('#smart-db-table tbody');
  if (!thead || !tbody) return;
  thead.innerHTML = ''; tbody.innerHTML = '';

  const filterProps = data.filter_properties || [];
  const cols = ['エントリ', ...filterProps, 'シート', 'ルート', '更新日'];

  // ヘッダ
  const tr = document.createElement('tr');
  cols.forEach(c => {
    const th = document.createElement('th');
    th.textContent = c;
    th.style.cssText = 'padding:6px 10px;text-align:left;border-bottom:2px solid var(--border);color:var(--fg2);font-weight:normal;font-size:12px;white-space:nowrap;position:sticky;top:0;background:var(--bg2);';
    tr.appendChild(th);
  });
  thead.appendChild(tr);

  // ボディ
  (data.entities || []).forEach(ent => {
    const row = document.createElement('tr');
    row.style.cssText = 'cursor:pointer;';
    row.onmouseenter = () => { row.style.background = 'rgba(255,255,255,0.04)'; };
    row.onmouseleave = () => { row.style.background = ''; };
    row.addEventListener('contextmenu', (e) => showSmartDbRowContextMenu(e, ent));
    if (typeof addLongPressHandler === 'function') {
      addLongPressHandler(row, (e) => showSmartDbRowContextMenu(e, ent));
    }

    // エントリ名（auto-linkツールチップ付き）
    const tdName = document.createElement('td');
    tdName.style.cssText = 'padding:4px 10px;border-bottom:1px solid var(--border);';
    const nameSpan = document.createElement('span');
    nameSpan.className = 'auto-link';
    nameSpan.dataset.path = ent.path;
    nameSpan.textContent = ent.name;
    nameSpan.style.cursor = 'pointer';
    nameSpan.addEventListener('click', () => selectEntity(ent.path));
    tdName.appendChild(nameSpan);
    row.appendChild(tdName);

    // フィルタプロパティ値
    filterProps.forEach(fp => {
      const td = document.createElement('td');
      td.style.cssText = 'padding:4px 10px;border-bottom:1px solid var(--border);font-size:12px;';
      const vals = (ent.matched_props || {})[fp] || [];
      const displayValue = vals.map(v => v.value).join(', ');
      td.textContent = displayValue;
      if (_smartDbApplyAutoLinks(td, displayValue, ent.path || ent.db_path || '')) {
        td.addEventListener('click', (e) => { _smartDbHandleAutoLinkClick(e); });
      }
      row.appendChild(td);
    });

    // シート名
    const tdDb = document.createElement('td');
    tdDb.style.cssText = 'padding:4px 10px;border-bottom:1px solid var(--border);font-size:12px;color:var(--fg2);';
    const dbLink = document.createElement('span');
    dbLink.textContent = ent.db_name;
    dbLink.style.cssText = 'cursor:pointer;text-decoration:underline dotted;';
    dbLink.addEventListener('click', (e) => { e.stopPropagation(); selectDatabase(ent.db_path); });
    tdDb.appendChild(dbLink);
    row.appendChild(tdDb);

    // ルート
    const tdRoot = document.createElement('td');
    tdRoot.style.cssText = 'padding:4px 10px;border-bottom:1px solid var(--border);font-size:11px;color:var(--fg2);';
    tdRoot.textContent = ent.root_name;
    row.appendChild(tdRoot);

    // 更新日
    const tdMod = document.createElement('td');
    tdMod.style.cssText = 'padding:4px 10px;border-bottom:1px solid var(--border);font-size:11px;color:var(--fg2);';
    tdMod.textContent = ent.modified ? ent.modified.substring(0, 10) : '';
    row.appendChild(tdMod);

    tbody.appendChild(row);
  });
}

function showSmartDbFilterModal(smartDbId) {
  const def = _findSmartDbDefinition(smartDbId);
  if (!def) return;
  if (def.sourceType === 'all-files') {
    if (typeof showGlobalIndexFilterModal === 'function') showGlobalIndexFilterModal(smartDbId);
    else showStatus('全件インデックス用フィルタを開けません', true);
    return;
  }
  const o = document.createElement('div');
  o.className = 'modal-overlay';
  let filtersHtml = '';
  (def.filters || []).forEach((f, i) => {
    filtersHtml += `<div class="sdf-row" data-idx="${i}" style="display:flex;gap:4px;align-items:center;margin-bottom:4px;">
      <input type="text" value="${esc(f.property)}" placeholder="プロパティ名" style="flex:1;padding:4px;background:var(--bg);color:var(--fg);border:1px solid var(--border);border-radius:3px;font-size:12px;" data-field="property" data-e2e-id="smart-filter-${i}-property" aria-label="スマートシート条件${i + 1} プロパティ">
      <select data-field="field" class="gb-select" data-e2e-id="smart-filter-${i}-field" aria-label="スマートシート条件${i + 1} 対象">
        <option value="value"${f.field === 'value' ? ' selected' : ''}>値</option>
        <option value="status"${f.field === 'status' ? ' selected' : ''}>ステータス</option>
      </select>
      <select data-field="operator" class="gb-select" data-e2e-id="smart-filter-${i}-operator" aria-label="スマートシート条件${i + 1} 演算子">
        <option value="equals"${f.operator === 'equals' ? ' selected' : ''}>等しい</option>
        <option value="not_equals"${f.operator === 'not_equals' ? ' selected' : ''}>等しくない</option>
        <option value="contains"${f.operator === 'contains' ? ' selected' : ''}>含む</option>
        <option value="not_contains"${f.operator === 'not_contains' ? ' selected' : ''}>含まない</option>
        <option value="not_empty"${f.operator === 'not_empty' ? ' selected' : ''}>空でない</option>
        <option value="empty"${f.operator === 'empty' ? ' selected' : ''}>空</option>
      </select>
      <input type="text" value="${esc(f.value)}" placeholder="値" style="flex:1;padding:4px;background:var(--bg);color:var(--fg);border:1px solid var(--border);border-radius:3px;font-size:12px;" data-field="value" data-e2e-id="smart-filter-${i}-value" aria-label="スマートシート条件${i + 1} 値">
      <button data-action="this.closest('.sdf-row').remove()" data-e2e-id="smart-filter-${i}-remove" aria-label="スマートシート条件${i + 1}を削除" style="background:none;border:none;color:var(--red);cursor:pointer;display:flex;align-items:center;">${lucide('x', 14)}</button>
    </div>`;
  });
  o.innerHTML = `<div class="modal cond-modal" style="min-width:500px;">
    <h3>スマートシート フィルタ設定</h3>
    <div class="modal-body cond-modal-body">
      <div class="field"><label>名前</label><input id="sdf-name" type="text" value="${esc(def.name)}" data-e2e-id="smart-filter-name"></div>
      <div style="margin:0;font-size:12px;color:var(--fg2);">フィルタ条件（AND: すべて一致）</div>
      <div id="sdf-filters" class="cond-list">${filtersHtml}</div>
      <button class="cond-add-btn" data-action="document.getElementById('sdf-filters').insertAdjacentHTML('beforeend', _smartDbFilterRowHtml())" data-e2e-id="smart-filter-add-row" style="font-size:12px;padding:2px 8px;background:var(--bg3);color:var(--fg2);border:1px solid var(--border);border-radius:3px;cursor:pointer;margin:4px 0;">+ 条件追加</button>
    </div>
    <div class="btn-row" style="margin-top:12px;">
      <button data-action="this.closest('.modal-overlay').remove()" data-e2e-id="smart-filter-cancel">キャンセル</button>
      <button class="primary" id="sdf-save-btn" data-e2e-id="smart-filter-save">保存</button>
    </div>
  </div>`;
  document.body.appendChild(o);
  if (typeof setupConditionModalLayout === 'function') setupConditionModalLayout(o, '#sdf-filters');
  // smartDbId に特殊文字が含まれる場合 esc() は JS 文字列を保護できないため直接バインド
  document.getElementById('sdf-save-btn').addEventListener('click', () => _saveSmartDbFilters(smartDbId));
}

function _smartDbFilterRowHtml(prop='', field='value', op='contains', val='') {
  const rowId = 'new-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
  return `<div class="sdf-row" data-e2e-row="${rowId}" style="display:flex;gap:4px;align-items:center;margin-bottom:4px;">
    <input type="text" value="${esc(prop)}" placeholder="プロパティ名" style="flex:1;padding:4px;background:var(--bg);color:var(--fg);border:1px solid var(--border);border-radius:3px;font-size:12px;" data-field="property" data-e2e-id="smart-filter-${rowId}-property" aria-label="スマートシート新規条件 プロパティ">
    <select data-field="field" class="gb-select" data-e2e-id="smart-filter-${rowId}-field" aria-label="スマートシート新規条件 対象">
      <option value="value"${field === 'value' ? ' selected' : ''}>値</option>
      <option value="status"${field === 'status' ? ' selected' : ''}>ステータス</option>
    </select>
    <select data-field="operator" class="gb-select" data-e2e-id="smart-filter-${rowId}-operator" aria-label="スマートシート新規条件 演算子">
      <option value="equals"${op === 'equals' ? ' selected' : ''}>等しい</option>
      <option value="not_equals"${op === 'not_equals' ? ' selected' : ''}>等しくない</option>
      <option value="contains"${op === 'contains' ? ' selected' : ''}>含む</option>
      <option value="not_contains"${op === 'not_contains' ? ' selected' : ''}>含まない</option>
      <option value="not_empty"${op === 'not_empty' ? ' selected' : ''}>空でない</option>
      <option value="empty"${op === 'empty' ? ' selected' : ''}>空</option>
    </select>
    <input type="text" value="${esc(val)}" placeholder="値" style="flex:1;padding:4px;background:var(--bg);color:var(--fg);border:1px solid var(--border);border-radius:3px;font-size:12px;" data-field="value" data-e2e-id="smart-filter-${rowId}-value" aria-label="スマートシート新規条件 値">
    <button data-action="this.closest('.sdf-row').remove()" data-e2e-id="smart-filter-${rowId}-remove" aria-label="スマートシート新規条件を削除" style="background:none;border:none;color:var(--red);cursor:pointer;display:flex;align-items:center;">${lucide('x', 14)}</button>
  </div>`;
}

async function _saveSmartDbFilters(smartDbId) {
  const name = document.getElementById('sdf-name').value.trim() || '無題';
  const rows = document.querySelectorAll('#sdf-filters .sdf-row');
  const filters = [];
  rows.forEach(r => {
    const prop = r.querySelector('[data-field="property"]').value.trim();
    const field = r.querySelector('[data-field="field"]').value;
    const operator = r.querySelector('[data-field="operator"]').value;
    const value = r.querySelector('[data-field="value"]').value.trim();
    if (prop) filters.push({ property: prop, field, operator, value });
  });
  const def = _findSmartDbDefinition(smartDbId);
  if (def) {
    const before = _captureSmartDbHistorySnapshot(def);
    def.name = name;
    def.filters = filters;
    try { await saveSmartDbDef(def); }
    catch (e) { showStatus('スマートシートの保存に失敗しました: ' + e.message, true); return; }
    if (typeof pushSmartDbDefinitionHistory === 'function') {
      pushSmartDbDefinitionHistory('スマートシート: フィルタ保存', before, def, def.name);
    }
    renderSmartDbList();
    showStatus('フィルタを保存しました');
    document.querySelector('.modal-overlay')?.remove();
    // 開いていたら再読み込み
    if (state.currentSmartDb?.id === smartDbId) selectSmartDb(smartDbId, def);
  }
}
