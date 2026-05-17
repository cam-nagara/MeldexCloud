/* ==============================
   gb-db-core.js: シート共通 helper

   gb-database.js / gb-db-props.js から共有される基礎 helper を分離。
   panel-local state と互換 global state の境界をここで吸収する。
   ============================== */

const DB_CACHE_TTL_MS = {
  relation: 30000,
  metadata: 30000,
  rollup: 30000,
};

function _dbCacheTtl(kind) {
  return DB_CACHE_TTL_MS[kind] || DB_CACHE_TTL_MS.relation;
}

function _dbCacheIsFresh(entry, kind) {
  return !!entry && Date.now() - (entry.timestamp || 0) < _dbCacheTtl(kind);
}

function _dbCloneJsonSafe(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function _dbCacheWrap(data) {
  return { data: _dbCloneJsonSafe(data), timestamp: Date.now() };
}

// 列のロック設定を取得: 'none' | 'admin' | 'locked'
function getColumnLock(dbPath, propName) {
  const cfg = getDbViewConfig(dbPath);
  return (cfg.columnLocks && cfg.columnLocks[propName]) || 'none';
}

function setColumnLock(dbPath, propName, lock, options = {}) {
  const cfg = getDbViewConfig(dbPath);
  if (!cfg.columnLocks) cfg.columnLocks = {};
  if (lock === 'none') {
    delete cfg.columnLocks[propName];
    if (Object.keys(cfg.columnLocks).length === 0) delete cfg.columnLocks;
  } else {
    cfg.columnLocks[propName] = lock;
  }
  saveDbViewConfig(dbPath, cfg, {
    historyLabel: options.label || 'シート表示: 列ロック',
    historyDetail: options.detail || propName || '',
    skipHistory: options.skipHistory === true,
  });
}

function _isAdminUser(filePath) {
  if (typeof getMyRoleForPath === 'function') return getMyRoleForPath(filePath || '') === 'owner';
  if (typeof _myTeamRole !== 'undefined') return _myTeamRole === 'owner';
  return false;
}

function checkColumnEditable(dbPath, propName) {
  const ptc = dbPath ? getPropertyTypes(dbPath)[propName] : null;
  if (ptc && ptc.source) return 'この列は自動入力（読み取り専用）です';
  const lock = getColumnLock(dbPath, propName);
  if (lock === 'locked') return 'この列はロックされています';
  if (lock === 'admin' && !_isAdminUser(dbPath)) return 'この列は管理者のみ編集できます';
  return null;
}

function _isNewFormatDb() {
  return !!(state.pivotData && state.pivotData.new_format);
}

function _dbNormalizePath(path) {
  return String(path || '').replace(/\\/g, '/').replace(/\/+$/, '');
}

function _dbPathContains(path, rootPath) {
  const p = _dbNormalizePath(path);
  const root = _dbNormalizePath(rootPath);
  return !!root && (p === root || p.startsWith(root + '/'));
}

function _dbFormatInfoFromPivotData(pivotData) {
  if (pivotData && Object.prototype.hasOwnProperty.call(pivotData, 'new_format')) {
    return { known: true, newFormat: !!pivotData.new_format };
  }
  return { known: false, newFormat: false };
}

function _dbFormatInfoForPath(dbPath, pivotData) {
  const explicit = _dbFormatInfoFromPivotData(pivotData);
  if (explicit.known) return explicit;
  const target = _dbNormalizePath(dbPath);
  if (typeof state !== 'undefined') {
    const current = _dbNormalizePath(state.currentDbPath);
    const currentInfo = _dbFormatInfoFromPivotData(state.pivotData);
    if (currentInfo.known && (!target || target === current)) return currentInfo;
  }
  const ctx = target && typeof _dbFindPaneContextForPath === 'function'
    ? _dbFindPaneContextForPath(target)
    : null;
  const ctxInfo = _dbFormatInfoFromPivotData(ctx?.pivotData);
  if (ctxInfo.known) return ctxInfo;
  return { known: false, newFormat: _isNewFormatDb() };
}

function _dbFormatInfoForValueFile(filePath) {
  const target = _dbNormalizePath(filePath);
  let best = null;
  const consider = (dbPath, pivotData) => {
    const root = _dbNormalizePath(dbPath);
    if (!root || !_dbPathContains(target, root)) return;
    const info = _dbFormatInfoFromPivotData(pivotData);
    if (!info.known) return;
    if (!best || root.length > best.root.length) best = { root, ...info };
  };
  if (typeof state !== 'undefined') consider(state.currentDbPath, state.pivotData);
  if (typeof getAllPanes === 'function') {
    try {
      const panes = getAllPanes() || {};
      Object.values(panes).forEach(ctx => consider(ctx?.dbPath, ctx?.pivotData));
    } catch {}
  }
  return best || { known: false, newFormat: _isNewFormatDb() };
}

function _dbIsNewFormat(dbPath, pivotData) {
  return _dbFormatInfoForPath(dbPath, pivotData).newFormat;
}

function _entityPath(dbPath, entityName, pivotData) {
  return _dbIsNewFormat(dbPath, pivotData) ? dbPath + '/' + entityName + '.md' : dbPath + '/' + entityName;
}

function _resolveEntityPathFromValObj(val) {
  if (!val || !val.file) return state.currentEntityPath || '';
  if (val.entry_path || val.entity_path || val.folder_path) {
    return _dbNormalizePath(val.entry_path || val.entity_path || val.folder_path);
  }
  const f = String(val.file).replace(/\\/g, '/');
  const parts = f.split('/');
  const leaf = parts[parts.length - 1] || '';
  if (!leaf.endsWith('.md')) return f;
  const stem = leaf.replace(/\.md$/, '');
  const format = _dbFormatInfoForValueFile(f);
  if (format.known) {
    if (!format.newFormat && stem.includes('_')) {
      parts.pop();
      return parts.join('/');
    }
    return f;
  }
  if (!_isNewFormatDb() && stem.includes('_')) {
    parts.pop();
    return parts.join('/');
  }
  return f;
}

function _dbPathFromEntityPath(entityPath) {
  const p = String(entityPath || '').replace(/\\/g, '/');
  if (!p) return '';
  const parts = p.split('/');
  if (parts.length < 2) return '';
  parts.pop();
  return parts.join('/');
}

function _markDbAutoVersionDirty(dbPath) {
  if (typeof markAutoVersionDirty !== 'function') return;
  try {
    if (typeof _autoVersionType === 'undefined' || typeof _autoVersionPath === 'undefined') return;
    if (_autoVersionType !== 'db') return;
    if (dbPath && typeof _sameVersionTargetPath === 'function' && !_sameVersionTargetPath(_autoVersionPath, dbPath)) return;
    markAutoVersionDirty();
  } catch {}
}

async function _apiPutValue(valObj, updates) {
  const body = { ...updates };
  delete body.__source;
  if (valObj.candidate_index != null) {
    body.property = valObj.property;
    body.candidate_index = valObj.candidate_index;
  }
  const res = await apiPut('/value?path=' + encodeURIComponent(valObj.file), body);
  if (res?.new_path) valObj.file = _dbNormalizePath(res.new_path);
  const entityPath = _resolveEntityPathFromValObj(valObj);
  const dbPath = _dbPathFromEntityPath(entityPath) || state.currentDbPath || '';
  const nextValue = updates._delete ? '' : (updates.new_value != null ? updates.new_value : valObj.value);
  _markDbAutoVersionDirty(dbPath);
  try {
    if (typeof clearRollupCache === 'function' && dbPath) clearRollupCache(dbPath);
  } catch {}
  try {
    if (window.GbDbCalendarSync && typeof window.GbDbCalendarSync.onValueSaved === 'function') {
      window.GbDbCalendarSync.onValueSaved({
        dbPath,
        entityPath,
        propName: valObj.property || '',
        newValue: nextValue,
        oldValue: valObj.value,
        status: updates.new_status || valObj.status,
        source: updates.__source || '',
      });
    }
  } catch {}
  try {
    const ptc = dbPath && valObj.property && typeof getPropertyTypes === 'function'
      ? getPropertyTypes(dbPath)?.[valObj.property]
      : null;
    if (ptc?.type === 'image') apiPost('/media/rebuild-refs', {}).catch(() => {});
  } catch {}
  if (updates.new_rich_html !== undefined) {
    if (updates.new_rich_html) valObj.rich_html = updates.new_rich_html;
    else delete valObj.rich_html;
  } else if (updates.new_value != null) {
    delete valObj.rich_html;
  }
  return res;
}

async function _apiPostValue(entityPath, propName, value, status, note, richHtml) {
  const key = entityPath.endsWith('.md') ? 'entry_path' : 'folder_path';
  const body = { [key]: entityPath, property: propName, value, status, note: note || '' };
  if (richHtml) body.rich_html = richHtml;
  const res = await apiPost('/value', body);
  const dbPath = _dbPathFromEntityPath(entityPath) || state.currentDbPath || '';
  _markDbAutoVersionDirty(dbPath);
  try {
    if (typeof clearRollupCache === 'function' && dbPath) clearRollupCache(dbPath);
  } catch {}
  try {
    if (window.GbDbCalendarSync && typeof window.GbDbCalendarSync.onValueSaved === 'function') {
      window.GbDbCalendarSync.onValueSaved({
        dbPath,
        entityPath,
        propName,
        newValue: value,
        oldValue: '',
        status,
      });
    }
  } catch {}
  try {
    const ptc = dbPath && propName && typeof getPropertyTypes === 'function'
      ? getPropertyTypes(dbPath)?.[propName]
      : null;
    if (ptc?.type === 'image') apiPost('/media/rebuild-refs', {}).catch(() => {});
  } catch {}
  return res;
}

function _isEntityCreateNameConflict(error) {
  const raw = [
    String(error?.status || ''),
    error?.meldexCode || '',
    error?.message || '',
    error?.userMessage || '',
    JSON.stringify(error?.payload || error?.meldexDetail || {}),
  ].join('\n');
  return Number(error?.status || 0) === 409
    && /既に存在|同名|file_exists|already exists|HTTP\s+409/i.test(raw);
}

function _entityDefaultName(baseName, index) {
  const base = String(baseName || '無題').trim() || '無題';
  return index <= 1 ? base : base + index;
}

function _shouldRunFrontendAutoFillOnCreate(response) {
  if (!response || typeof response !== 'object') return true;
  return !(response.autofill_applied === true || response.backend_autofill === true || response.new_format === true);
}

async function _apiCreateEntityWithUniqueName(dbPath, existingNames, options = {}) {
  const used = new Set((existingNames || []).map(name => String(name || '')));
  const bodyExtra = options.body && typeof options.body === 'object' ? options.body : {};
  const baseName = String(options.baseName || options.name || '無題').trim() || '無題';
  let index = 1;
  let lastError = null;
  for (let attempt = 0; attempt < 50; attempt++) {
    let name = String(options.name || '').trim();
    if (!name || used.has(name) || attempt > 0) {
      do {
        name = _entityDefaultName(baseName, index);
        index += 1;
      } while (used.has(name));
    }
    used.add(name);
    try {
      const response = await apiPost(
        '/entity/create',
        { ...bodyExtra, parent_path: dbPath, name },
        { silentError: true }
      );
      const path = (response && (response.path || response.entry_path)) || `${dbPath}/${name}.md`;
      return { response, name, path };
    } catch (error) {
      lastError = error;
      if (_isEntityCreateNameConflict(error)) continue;
      if (!options.silentError && typeof showStatus === 'function') {
        const text = window.MeldexErrorMessages?.toStatusText?.(error, { path: '/entity/create' }) || error.message || String(error);
        showStatus('エントリ作成に失敗: ' + text, true);
      }
      throw error;
    }
  }
  const error = lastError || new Error('同名エントリが多数存在するため作成できません');
  if (!options.silentError && typeof showStatus === 'function') {
    showStatus('エントリ作成に失敗: 同名エントリが多数存在します', true);
  }
  throw error;
}

let _dbSelectedColumns = { dbPath: '', props: [], anchor: '' };

function _currentPivotTable(ctx) {
  const cur = ctx || (typeof _currentPaneState === 'function' ? _currentPaneState() : null);
  const tableId = (cur && cur.tableId) || 'pivot-table';
  return (typeof _paneEl === 'function' ? _paneEl(cur, '#' + tableId) : null)
    || document.getElementById(tableId)
    || document.getElementById('pivot-table');
}

function _currentPivotRows(ctx) {
  const table = _currentPivotTable(ctx);
  return table ? Array.from(table.querySelectorAll('tbody tr:not(.new-entity-row):not(.group-header-row)')) : [];
}

function _getSelectedColumns(dbPath) {
  return _dbSelectedColumns.dbPath === dbPath ? [..._dbSelectedColumns.props] : [];
}

function _setSelectedColumns(dbPath, props, anchor) {
  _dbSelectedColumns = {
    dbPath,
    props: [...new Set((props || []).filter(Boolean))],
    anchor: anchor || ((props || [])[0] || ''),
  };
}

function _dbFindPaneContextForPath(dbPath) {
  if (typeof getAllPanes !== 'function') return null;
  const target = _dbNormalizePath(dbPath);
  try {
    const panes = getAllPanes() || {};
    for (const ctx of Object.values(panes)) {
      if (ctx && (!target || _dbNormalizePath(ctx.dbPath) === target)) return ctx;
    }
  } catch {}
  return null;
}

function _dbPaneContextFromEvent(eventOrElement, options = {}) {
  const fallbackDbPath = typeof state !== 'undefined' ? state.currentDbPath : '';
  const dbPath = options.dbPath || fallbackDbPath || '';
  const target = eventOrElement?.currentTarget || eventOrElement?.target || eventOrElement;
  const paneEl = target?.closest?.('.gb-pane[data-pane-id]') || target?.closest?.('.gb-pane');
  const paneId = paneEl?.dataset?.paneId || '';
  if (paneId && typeof getPaneContext === 'function') {
    const ctx = getPaneContext(paneId);
    if (ctx) return ctx;
  }
  const active = typeof _currentPaneState === 'function' ? _currentPaneState() : null;
  if (active && (!dbPath || active.dbPath === dbPath || !active.dbPath)) return active;
  return _dbFindPaneContextForPath(dbPath) || active || null;
}

function _dbCurrentViewModeForContext(ctx, dbPath) {
  const raw = dbPath && typeof getCurrentViewMode === 'function'
    ? getCurrentViewMode(dbPath)
    : (ctx?.viewMode || (typeof state !== 'undefined' ? state.view : '') || 'pivot');
  return ['calendar', 'tasks', 'shifts'].includes(raw) ? 'timeline' : (raw || 'pivot');
}

function _renderCurrentDbView(ctx, dbPath) {
  const mode = _dbCurrentViewModeForContext(ctx, dbPath);
  if (mode === 'gallery' && typeof renderGallery === 'function') renderGallery(ctx);
  else if (mode === 'kanban' && typeof renderKanban === 'function') renderKanban(ctx);
  else if (mode === 'timeline' && typeof renderTimeline === 'function') renderTimeline(ctx);
  else if (mode === 'chart' && typeof renderChart === 'function') renderChart(ctx);
  else if (mode === 'graph' && typeof renderGraph === 'function') renderGraph(ctx);
  else if (mode === 'form' && typeof renderDbFormView === 'function') renderDbFormView(ctx);
  else if (typeof renderPivot === 'function') renderPivot(ctx);
}
