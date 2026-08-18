/* シート自動入力・監査ログ — gb-database.js から分離 */

async function _autoRenameEntity(dbPath, entityName) {
  const newName = _generateEntryName(dbPath, entityName);
  if (!newName || newName === entityName) return;
  try {
    const ctx = typeof _dbFindPaneContextForPath === 'function' ? _dbFindPaneContextForPath(dbPath) : null;
    await window.GbDbEntryIdentity.rename({
      dbPath,
      oldName: entityName,
      newName,
      path: _entityPath(dbPath, entityName, ctx?.pivotData),
      ctx,
      entryId: ctx?.pivotData?.entities?.[entityName]?._id || '',
    });
  } catch { /* rename failed silently */ }
}

function _resolveAutoFillPlaceholder(raw) {
  if (typeof raw !== 'string') return raw;
  if (!raw.startsWith('$')) return raw;
  const pad = n => String(n).padStart(2, '0');
  const d = new Date();
  const ymd = typeof formatLocalDate === 'function'
    ? formatLocalDate(d)
    : `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const ymdhm = typeof formatLocalDateTime === 'function'
    ? formatLocalDateTime(d).replace('T', ' ')
    : `${ymd} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  switch (raw) {
    case '$today': return ymd;
    case '$now': return ymdhm;
    case '$currentUser': return (typeof getUsername === 'function' ? getUsername() : '') || '';
    case '$version': return (window.__meldexVersionCache && window.__meldexVersionCache.version) || '';
    default: return raw;
  }
}

async function _fetchVersionCache() {
  if (window.__meldexVersionCache) return window.__meldexVersionCache;
  try {
    const j = await apiFetch('/version');
    window.__meldexVersionCache = j || { version: '', semver: '', commit: '', variant: 'dev' };
    return window.__meldexVersionCache;
  } catch {}
  window.__meldexVersionCache = { version: '', semver: '', commit: '', variant: 'dev' };
  return window.__meldexVersionCache;
}

function _autoFillEntityPathForWrite(entityPath) {
  let ep = entityPath;
  if (ep && ep.endsWith('.md')) {
    const parts = ep.replace(/\\/g, '/').split('/');
    const fname = parts[parts.length - 1].replace(/\.md$/, '');
    if (fname.includes('_') && state.currentEntityPath) ep = state.currentEntityPath;
  }
  return ep || '';
}

function _autoFillEntityNameFromPath(entityPath) {
  const parts = String(entityPath || '').replace(/\\/g, '/').split('/');
  return (parts[parts.length - 1] || '').replace(/\.md$/, '');
}

function _findAutoFillExistingValue(entityData, propName, writeStatus) {
  const vals = Array.isArray(entityData?.[propName]) ? entityData[propName] : [];
  const statuses = [writeStatus, '採用', '掲載済み'].filter((status, idx, arr) => status && arr.indexOf(status) === idx);
  return vals.find(v => statuses.includes(v.status || '')) || null;
}

function _recordAutoFillPivotValue(entityData, propName, value, status, created, entityPath) {
  if (!entityData) return;
  if (!Array.isArray(entityData[propName])) entityData[propName] = [];
  const record = created && typeof created === 'object' ? { ...created } : {};
  record.property = record.property || propName;
  record.value = value;
  record.status = status;
  record.entry_path = record.entry_path || entityPath;
  record.file = record.file || record.path || '';
  entityData[propName].push(record);
}

function _autoFillValueRef(val, propName) {
  if (!val) return null;
  return {
    file: val.file || val.path || '',
    property: val.property || propName,
    candidate_index: val.candidate_index,
  };
}

function _autoFillSameDbPath(a, b) {
  const norm = typeof _dbNormalizePath === 'function'
    ? _dbNormalizePath
    : (path) => String(path || '').replace(/\\/g, '/').replace(/\/+$/, '');
  return !!a && !!b && norm(a) === norm(b);
}

async function _autoFillPivotDataForDb(dbPath, options = {}) {
  const ctx = options.ctx || null;
  if (ctx?.pivotData?.entities && _autoFillSameDbPath(ctx.dbPath, dbPath)) return ctx.pivotData;
  if (state?.pivotData?.entities) {
    if (!state.currentDbPath || _autoFillSameDbPath(state.currentDbPath, dbPath)) return state.pivotData;
  }
  if (typeof _dbFindPaneContextForPath === 'function') {
    const paneCtx = _dbFindPaneContextForPath(dbPath);
    if (paneCtx?.pivotData?.entities) return paneCtx.pivotData;
  }
  if (typeof apiFetch === 'function') {
    try { return await apiFetch('/pivot?path=' + encodeURIComponent(dbPath)); } catch {}
  }
  return null;
}

async function _writeAutoFillValue(entityPath, entityData, propName, value, writeStatus) {
  const existing = _findAutoFillExistingValue(entityData, propName, writeStatus);
  if (existing) {
    const ref = _autoFillValueRef(existing, propName);
    const oldValue = existing.value || '';
    await _apiPutValue(existing, { new_value: value });
    existing.value = value;
    return { kind: 'update', ref, oldValue, newValue: value };
  }
  const created = await _apiPostValue(entityPath, propName, value, writeStatus, '');
  _recordAutoFillPivotValue(entityData, propName, value, writeStatus, created, entityPath);
  const ref = _autoFillValueRef({ ...(created || {}), file: created?.path || created?.file, property: created?.property || propName }, propName);
  return { kind: 'create', ref, entityPath, propName, value, status: writeStatus };
}

async function _undoAutoFillStatusOps(ops) {
  for (let i = (ops || []).length - 1; i >= 0; i -= 1) {
    const op = ops[i];
    try {
      if (op.kind === 'create' && op.ref?.file) await _apiPutValue(op.ref, { _delete: true });
      else if (op.kind === 'update' && op.ref?.file) await _apiPutValue(op.ref, { new_value: op.oldValue || '' });
    } catch {}
  }
}

async function _redoAutoFillStatusOps(ops) {
  for (const op of ops || []) {
    try {
      if (op.kind === 'create' && op.entityPath) {
        const created = await _apiPostValue(op.entityPath, op.propName, op.value, op.status || '採用', '');
        if (created?.path || created?.file) {
          op.ref = _autoFillValueRef({ ...created, file: created.path || created.file, property: created.property || op.propName }, op.propName);
        }
      } else if (op.kind === 'update' && op.ref?.file) {
        await _apiPutValue(op.ref, { new_value: op.newValue || '' });
      }
    } catch {}
  }
}

async function _autoFillOnCreate(dbPath, entityPath, overrides) {
  if (!dbPath || !entityPath) return;
  const ov = overrides || {};
  const ptypes = getPropertyTypes(dbPath);
  const needsVersion = Object.values(ptypes).some(p => p && p.autoFillOnCreate === '$version');
  if (needsVersion) await _fetchVersionCache();
  for (const [pName, ptc] of Object.entries(ptypes)) {
    if (!ptc || !('autoFillOnCreate' in ptc)) continue;
    if (Object.prototype.hasOwnProperty.call(ov, pName)) continue;
    const lockMsg = (typeof checkColumnEditable === 'function') ? checkColumnEditable(dbPath, pName) : '';
    if (lockMsg) continue;
    const resolved = _resolveAutoFillPlaceholder(ptc.autoFillOnCreate);
    if (resolved === '' || resolved == null) continue;
    const writeStatus = ptc.writeStatus || '案';
    try {
      await _apiPostValue(entityPath, pName, resolved, writeStatus, '');
    } catch {}
  }
}

async function _autoFillOnStatusChange(entityPath, propName, newStatus, dbPath, options = {}) {
  if (!dbPath) return;
  const ops = [];
  const ptypes = getPropertyTypes(dbPath);
  const pivotData = await _autoFillPivotDataForDb(dbPath, options);
  const needsVersion = Object.values(ptypes).some(p => {
    const a = p && p.autoFillOnStatus;
    return a && typeof a === 'object' && a[newStatus] === '$version';
  });
  if (needsVersion) await _fetchVersionCache();
  for (const [pName, ptc] of Object.entries(ptypes)) {
    let fillVal = null;
    let writeStatus = ptc.writeStatus || '採用';
    if (ptc.autoFillOnStatus === newStatus && ptc.type === 'date') {
      fillVal = '__legacy_date__';
      writeStatus = '採用';
    } else if (ptc.autoFillOnStatus && typeof ptc.autoFillOnStatus === 'object' && newStatus in ptc.autoFillOnStatus) {
      fillVal = _resolveAutoFillPlaceholder(ptc.autoFillOnStatus[newStatus]);
    }
    if (fillVal == null) continue;
    const lockMsg = checkColumnEditable(dbPath, pName);
    if (lockMsg) continue;
    const value = fillVal === '__legacy_date__'
      ? (typeof _dbDateCurrentValue === 'function' ? _dbDateCurrentValue(ptc) : new Date().toISOString().slice(0, 19))
      : fillVal;
    if (value === '' || value == null) continue;
    const ep = _autoFillEntityPathForWrite(entityPath);
    if (!ep) continue;
    const entName = _autoFillEntityNameFromPath(ep);
    const ent = pivotData?.entities?.[entName] || null;
    try {
      const op = await _writeAutoFillValue(ep, ent, pName, value, writeStatus);
      if (op) ops.push(op);
    } catch {
      // 他の自動入力を止めない。
    }
  }
  return ops;
}
