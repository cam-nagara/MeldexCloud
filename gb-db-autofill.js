/* シート自動入力・監査ログ — gb-database.js から分離 */

async function _autoRenameEntity(dbPath, entityName) {
  const newName = _generateEntryName(dbPath, entityName);
  if (!newName || newName === entityName) return;
  try {
    await apiPost('/entity/rename', { path: _entityPath(dbPath, entityName), new_name: newName });
  } catch { /* rename failed silently */ }
}

function _resolveAutoFillPlaceholder(raw) {
  if (typeof raw !== 'string') return raw;
  if (!raw.startsWith('$')) return raw;
  const pad = n => String(n).padStart(2, '0');
  const d = new Date();
  const ymd = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  switch (raw) {
    case '$today': return ymd;
    case '$now': return `${ymd} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
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

async function _autoFillOnStatusChange(entityPath, propName, newStatus, dbPath) {
  if (!dbPath) return;
  const ptypes = getPropertyTypes(dbPath);
  const needsVersion = Object.values(ptypes).some(p => {
    const a = p && p.autoFillOnStatus;
    return a && typeof a === 'object' && a[newStatus] === '$version';
  });
  if (needsVersion) await _fetchVersionCache();
  for (const [pName, ptc] of Object.entries(ptypes)) {
    let fillVal = null;
    if (ptc.autoFillOnStatus === newStatus && ptc.type === 'date') {
      fillVal = '__legacy_date__';
    } else if (ptc.autoFillOnStatus && typeof ptc.autoFillOnStatus === 'object' && newStatus in ptc.autoFillOnStatus) {
      fillVal = _resolveAutoFillPlaceholder(ptc.autoFillOnStatus[newStatus]);
    }
    if (fillVal == null) continue;
    if (fillVal === '__legacy_date__') {
      const lockMsg = checkColumnEditable(dbPath, pName);
      if (lockMsg) continue;
      const now = typeof _dbDateCurrentValue === 'function'
        ? _dbDateCurrentValue(ptc)
        : new Date().toISOString().slice(0, 19);
      let ep = entityPath;
      if (ep && ep.endsWith('.md')) {
        const parts = ep.replace(/\\/g, '/').split('/');
        const fname = parts[parts.length - 1].replace(/\.md$/, '');
        if (fname.includes('_') && state.currentEntityPath) ep = state.currentEntityPath;
      }
      if (!ep) continue;
      if (state.pivotData) {
        const epParts = ep.replace(/\\/g, '/').split('/');
        const entName = epParts[epParts.length - 1].replace(/\.md$/, '');
        const ent = state.pivotData.entities[entName];
        if (ent) {
          const existing = (ent[pName] || []).find(v => v.status === '採用' || v.status === '掲載済み');
          if (existing) {
            await _apiPutValue(existing, { new_value: now });
            existing.value = now;
          } else {
            await _apiPostValue(ep, pName, now, '採用', '');
          }
          continue;
        }
      }
      await _apiPostValue(ep, pName, now, '採用', '');
    } else {
      const lockMsg = checkColumnEditable(dbPath, pName);
      if (lockMsg) continue;
      let ep = entityPath;
      if (ep && ep.endsWith('.md')) {
        const parts = ep.replace(/\\/g, '/').split('/');
        const fname = parts[parts.length - 1].replace(/\.md$/, '');
        if (fname.includes('_') && state.currentEntityPath) ep = state.currentEntityPath;
      }
      if (!ep) continue;
      const writeStatus = ptc.writeStatus || '採用';
      if (state.pivotData) {
        const epParts = ep.replace(/\\/g, '/').split('/');
        const entName = epParts[epParts.length - 1].replace(/\.md$/, '');
        const ent = state.pivotData.entities[entName];
        if (ent) {
          const existing = (ent[pName] || []).find(v => v.status === '採用' || v.status === '掲載済み');
          if (existing) {
            await _apiPutValue(existing, { new_value: fillVal });
            existing.value = fillVal;
          } else {
            await _apiPostValue(ep, pName, fillVal, writeStatus, '');
          }
          continue;
        }
      }
      await _apiPostValue(ep, pName, fillVal, writeStatus, '');
    }
  }
}

async function showDbAuditLogModal() {
  if (typeof openCurrentVersionsTab === 'function') {
    openCurrentVersionsTab();
    return;
  }
  const dbPath = state.currentDbPath;
  if (!dbPath) return;

  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal" style="width:750px;max-height:80vh;display:flex;flex-direction:column;">
      <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid var(--border);">
        <div style="font-size:15px;font-weight:bold;">変更ログ</div>
        <button data-audit-close style="background:none;border:none;color:var(--fg2);font-size:18px;cursor:pointer;">✕</button>
      </div>
      <div style="padding:8px 16px;border-bottom:1px solid var(--border);display:flex;gap:8px;">
        <input id="audit-filter-entity" type="text" placeholder="エントリで絞り込み" style="flex:1;padding:4px 8px;font-size:12px;background:var(--bg);color:var(--fg);border:1px solid var(--border);border-radius:3px;">
        <input id="audit-filter-prop" type="text" placeholder="プロパティで絞り込み" style="flex:1;padding:4px 8px;font-size:12px;background:var(--bg);color:var(--fg);border:1px solid var(--border);border-radius:3px;">
      </div>
      <div id="audit-log-list" style="flex:1;overflow-y:auto;padding:8px 16px;font-size:12px;"></div>
      <div id="audit-log-pager" style="padding:8px 16px;border-top:1px solid var(--border);display:flex;justify-content:center;gap:8px;font-size:12px;"></div>
    </div>`;
  document.body.appendChild(modal);

  let auditOffset = 0;
  const auditLimit = 100;
  let auditClosed = false;
  let filterTimer = null;

  const closeAuditModal = () => {
    auditClosed = true;
    if (filterTimer) clearTimeout(filterTimer);
    modal.remove();
  };
  modal.querySelector('[data-audit-close]')?.addEventListener('click', closeAuditModal);
  modal.addEventListener('click', (e) => { if (e.target === modal) closeAuditModal(); });

  async function loadAuditLogs() {
    if (auditClosed || !modal.isConnected) return;
    const entityEl = modal.querySelector('#audit-filter-entity');
    const propEl = modal.querySelector('#audit-filter-prop');
    if (!entityEl || !propEl) return;
    const entity = entityEl.value.trim();
    const prop = propEl.value.trim();
    let url = '/db-audit-log?path=' + encodeURIComponent(dbPath)
      + '&limit=' + auditLimit + '&offset=' + auditOffset;
    if (entity) url += '&entity=' + encodeURIComponent(entity);
    if (prop) url += '&prop=' + encodeURIComponent(prop);
    try {
      const data = await apiFetch(url);
      if (auditClosed || !modal.isConnected) return;
      renderAuditLogList(data.logs, data.total);
    } catch {
      const list = modal.querySelector('#audit-log-list');
      if (list && !auditClosed) {
        list.innerHTML = '<div style="color:var(--fg2);padding:16px;text-align:center;">履歴の取得に失敗しました</div>';
      }
    }
  }

  function renderAuditLogList(logs, total) {
    if (auditClosed || !modal.isConnected) return;
    const container = modal.querySelector('#audit-log-list');
    if (!container) return;
    if (!logs.length) {
      container.innerHTML = '<div style="color:var(--fg2);padding:16px;text-align:center;">履歴がありません</div>';
      const emptyPager = modal.querySelector('#audit-log-pager');
      if (emptyPager) emptyPager.innerHTML = '';
      return;
    }
    const actionLabels = {
      add_value: '値追加',
      update_value: '値変更',
      delete_value: '値削除',
      update_status: 'ステータス変更',
      create_entity: 'エントリ作成',
      rename_entity: 'リネーム',
      delete_entity: 'エントリ削除',
    };
    container.innerHTML = logs.map(log => {
      const time = new Date(log.timestamp).toLocaleString('ja-JP');
      const action = actionLabels[log.action] || log.action;
      let detail = '';
      if (log.action === 'update_value') detail = '\u201c' + (log.old_value || '').slice(0, 40) + '\u201d → \u201c' + (log.new_value || '').slice(0, 40) + '\u201d';
      else if (log.action === 'update_status') detail = (log.old_status || '') + ' → ' + (log.new_status || '');
      else if (log.action === 'add_value') detail = '\u201c' + (log.new_value || '').slice(0, 40) + '\u201d';
      else if (log.action === 'rename_entity') detail = '\u201c' + (log.old_value || '') + '\u201d → \u201c' + (log.new_value || '') + '\u201d';
      return '<div style="padding:6px 0;border-bottom:1px solid var(--border);display:flex;gap:8px;align-items:baseline;">'
        + '<span style="color:var(--fg2);min-width:130px;flex-shrink:0;">' + esc(time) + '</span>'
        + '<span style="color:var(--accent);min-width:60px;flex-shrink:0;">' + esc(log.user) + '</span>'
        + '<span style="font-weight:bold;min-width:70px;flex-shrink:0;">' + esc(action) + '</span>'
        + '<span style="color:var(--fg);">' + esc(log.entity_name)
          + (log.property_name ? ' / ' + esc(log.property_name) : '') + '</span>'
        + (detail ? '<span style="color:var(--fg2);margin-left:auto;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:250px;">' + esc(detail) + '</span>' : '')
        + '</div>';
    }).join('');

    const pager = modal.querySelector('#audit-log-pager');
    if (!pager) return;
    const totalPages = Math.ceil(total / auditLimit);
    const currentPage = Math.floor(auditOffset / auditLimit) + 1;
    if (totalPages <= 1) {
      pager.innerHTML = '';
      return;
    }
    pager.innerHTML = '';
    if (currentPage > 1) {
      const prev = document.createElement('button');
      prev.textContent = '← 前';
      prev.style.cssText = 'padding:2px 8px;font-size:12px;cursor:pointer;background:var(--bg);color:var(--fg);border:1px solid var(--border);border-radius:3px;';
      prev.addEventListener('click', () => { if (auditClosed) return; auditOffset -= auditLimit; loadAuditLogs(); });
      pager.appendChild(prev);
    }
    const info = document.createElement('span');
    info.style.color = 'var(--fg2)';
    info.textContent = currentPage + ' / ' + totalPages + ' (' + total + '件)';
    pager.appendChild(info);
    if (currentPage < totalPages) {
      const next = document.createElement('button');
      next.textContent = '次 →';
      next.style.cssText = 'padding:2px 8px;font-size:12px;cursor:pointer;background:var(--bg);color:var(--fg);border:1px solid var(--border);border-radius:3px;';
      next.addEventListener('click', () => { if (auditClosed) return; auditOffset += auditLimit; loadAuditLogs(); });
      pager.appendChild(next);
    }
  }

  modal.querySelector('#audit-filter-entity')?.addEventListener('input', () => {
    clearTimeout(filterTimer);
    filterTimer = setTimeout(() => { if (auditClosed) return; auditOffset = 0; loadAuditLogs(); }, 300);
  });
  modal.querySelector('#audit-filter-prop')?.addEventListener('input', () => {
    clearTimeout(filterTimer);
    filterTimer = setTimeout(() => { if (auditClosed) return; auditOffset = 0; loadAuditLogs(); }, 300);
  });

  loadAuditLogs();
}
