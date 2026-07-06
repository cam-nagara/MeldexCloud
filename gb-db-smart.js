/* スマートシート — gb-database.js から分離 */

let _smartDbRequestSeq = 0;

function _smartDbApplyAutoLinks(el, rawText, scopePath) {
  if (!el || typeof MeldexAutoLink === 'undefined' || String(rawText || '').length < 2) return false;
  MeldexAutoLink.applyToDom(el, scopePath || '');
  const links = [...el.querySelectorAll('.auto-link')];
  links.forEach((link, index) => {
    if (!link.dataset.e2eId) {
      const key = (link.dataset.path || link.textContent || 'auto-link') + '-' + index;
      link.dataset.e2eId = 'smart-db-auto-link-' + _smartDbStableIdPart(key);
    }
    link.setAttribute('role', 'button');
    link.tabIndex = 0;
    link.setAttribute('aria-label', 'リンクを開く: ' + (link.textContent || '').trim());
    if (!link.dataset.smartDbAutoLinkWired) {
      link.dataset.smartDbAutoLinkWired = '1';
      _smartDbBindKeyboardActivate(link, (e) => _smartDbHandleAutoLinkClick(e));
    }
  });
  return links.length > 0;
}

function _smartDbStableIdPart(value) {
  const raw = String(value || '').trim();
  let hash = 2166136261;
  for (let i = 0; i < raw.length; i += 1) {
    hash ^= raw.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const slug = raw
    .replace(/[^\w\u3040-\u30ff\u3400-\u9fff-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'item';
  return `${slug}-${(hash >>> 0).toString(36)}`;
}

function _smartDbStableControlId(prefix, ent) {
  const key = ent?.path || ent?.file_id || ent?.db_path || ent?.name || '';
  return `${prefix}-${_smartDbStableIdPart(key)}`;
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
  if (!Array.isArray(next.sources)) next.sources = [];
  return _ensureSmartDbViews(next);
}

// 実行時に使う sources。通常スマートシートは対象ソースの明示を必須にする。
function _smartDbEffectiveSources(def) {
  if (!def) return [];
  const explicit = Array.isArray(def.sources) ? def.sources.filter(s => s && s.path) : [];
  return explicit;
}

function _smartDbActiveElement() {
  return document.activeElement instanceof HTMLElement ? document.activeElement : null;
}

function _smartDbPopupRestoreTarget(event) {
  const active = _smartDbActiveElement();
  const current = event?.currentTarget instanceof HTMLElement ? event.currentTarget : null;
  if (active && current && current.contains(active)) return active;
  if (current && current.matches?.('tr')) {
    const nested = current.querySelector('[role="button"], button, [tabindex]:not([tabindex="-1"])');
    if (nested instanceof HTMLElement) return nested;
  }
  return current || active;
}

function _smartDbRestoreFocus(target) {
  if (!target || typeof target.focus !== 'function' || !target.isConnected) return;
  try { target.focus({ preventScroll: true }); } catch { target.focus(); }
}

function _smartDbActivationKey(e) {
  return e && !e.isComposing && e.keyCode !== 229 && (e.key === 'Enter' || e.key === ' ');
}

function _smartDbBindKeyboardActivate(el, handler) {
  if (!el || typeof handler !== 'function') return;
  el.addEventListener('keydown', (e) => {
    if (!_smartDbActivationKey(e)) return;
    e.preventDefault();
    e.stopPropagation();
    handler(e);
  });
}

function _smartDbAttachPopupDismiss(popup, restoreTarget) {
  if (!popup) return () => {};
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    document.removeEventListener('pointerdown', onPointerDown, true);
    document.removeEventListener('keydown', onKeyDown, true);
    popup.remove();
    _smartDbRestoreFocus(restoreTarget);
    setTimeout(() => _smartDbRestoreFocus(restoreTarget), 0);
  };
  const onPointerDown = (ev) => {
    if (!popup.contains(ev.target)) close();
  };
  const onKeyDown = (ev) => {
    if (ev.key !== 'Escape') return;
    ev.preventDefault();
    ev.stopPropagation();
    close();
  };
  document.addEventListener('keydown', onKeyDown, true);
  setTimeout(() => {
    if (!popup.isConnected) return;
    document.addEventListener('pointerdown', onPointerDown, true);
  }, 0);
  return close;
}

function _smartDbAttachOverlayDismiss(overlay, restoreTarget) {
  if (!overlay) return () => {};
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    overlay.remove();
    _smartDbRestoreFocus(restoreTarget);
    setTimeout(() => _smartDbRestoreFocus(restoreTarget), 0);
  };
  overlay.addEventListener('pointerdown', (ev) => {
    if (ev.target === overlay) close();
  });
  overlay.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Escape') return;
    ev.preventDefault();
    ev.stopPropagation();
    close();
  });
  return close;
}

function _smartDbFocusFirstDialogControl(overlay) {
  setTimeout(() => {
    const first = overlay?.querySelector?.('input, select, textarea, button, [role="button"], [tabindex]:not([tabindex="-1"])');
    _smartDbRestoreFocus(first);
  }, 0);
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
        headers: { 'Content-Type': 'application/json' },
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
  const isLegacyLoadCurrent = () => typeof openOpts.isLegacyLoadCurrent !== 'function' || openOpts.isLegacyLoadCurrent();
  if (!isLegacyLoadCurrent()) return;
  if (pathText.startsWith('smart-db:')) {
    return selectSmartDb(pathText.slice('smart-db:'.length), null, openOpts);
  }
  try {
    const data = await apiFetch('/file?path=' + encodeURIComponent(pathText));
    if (!isLegacyLoadCurrent()) return;
    const rawDef = JSON.parse(data.content || '{}');
    if (!rawDef.name && label) rawDef.name = label;
    const def = normalizeSmartDbDefinition(rawDef);
    def.id = def.id || 'file:' + pathText;
    def.name = def.name || label;
    def._filePath = pathText;
    const fid = _pathToFileId(pathText);
    if (fid) def._fileId = fid;
    state.currentSmartDb = def;
    return selectSmartDb(def.id, def, openOpts);
  } catch (e) {
    if (!isLegacyLoadCurrent()) return;
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
  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'fav-item smart-db-list-action';
  addBtn.dataset.e2eId = 'smart-db-create';
  addBtn.setAttribute('aria-label', '新規スマートシート');
  addBtn.style.cssText = 'padding:2px 8px;font-size:11px;color:var(--fg2);cursor:pointer;display:flex;align-items:center;gap:4px;background:transparent;border:0;width:100%;text-align:left;';
  addBtn.innerHTML = lucide('plus', 12) + ' 新規スマートシート';
  addBtn.addEventListener('click', createSmartDb);
  container.appendChild(addBtn);
  // 全件インデックス作成ボタン
  const addGlobalBtn = document.createElement('button');
  addGlobalBtn.type = 'button';
  addGlobalBtn.className = 'fav-item smart-db-list-action';
  addGlobalBtn.dataset.e2eId = 'smart-db-create-global';
  addGlobalBtn.setAttribute('aria-label', '全件インデックスを新規作成');
  addGlobalBtn.style.cssText = 'padding:2px 8px;font-size:11px;color:var(--fg2);cursor:pointer;display:flex;align-items:center;gap:4px;background:transparent;border:0;width:100%;text-align:left;';
  addGlobalBtn.innerHTML = lucide('plus', 12) + ' 全件インデックスを新規作成';
  addGlobalBtn.addEventListener('click', () => {
    if (typeof createGlobalIndexSmartDb === 'function') createGlobalIndexSmartDb();
  });
  container.appendChild(addGlobalBtn);
  dbs.forEach(d => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'fav-item';
    item.dataset.e2eId = 'smart-db-list-item';
    item.dataset.smartDbId = d.id || '';
    item.setAttribute('aria-label', 'スマートシートを開く: ' + (d.name || '無題'));
    item.style.border = '0';
    item.style.width = '100%';
    item.style.textAlign = 'left';
    item.innerHTML = lucide('databaseSearch', 14) + ' <span style="overflow:hidden;text-overflow:ellipsis;">' + esc(d.name) + '</span>';
    item.title = (d.filters || []).map(f => f.property + ' ' + f.operator + ' ' + f.value).join(', ');
    item.addEventListener('click', () => selectSmartDb(d.id));
    item.oncontextmenu = (e) => {
      e.preventDefault();
      const menu = document.createElement('div');
      menu.className = 'gb-context-menu';
      menu.setAttribute('role', 'menu');
      menu.setAttribute('aria-label', 'スマートシートメニュー');
      { const z = (typeof _getZoom === 'function') ? _getZoom() : (parseFloat(document.documentElement.style.zoom) || 1); menu.style.left = (e.clientX / z) + 'px'; menu.style.top = (e.clientY / z) + 'px'; }
      const closeMenu = _smartDbAttachPopupDismiss(menu, item);
      function addMI(label, fn, opts = {}) {
        const mi = document.createElement('button');
        mi.type = 'button';
        mi.className = 'gb-context-menu-item' + (opts.danger ? ' danger' : '');
        if (opts.e2eId) mi.dataset.e2eId = opts.e2eId;
        mi.setAttribute('role', 'menuitem');
        mi.setAttribute('aria-label', label);
        mi.textContent = label;
        mi.addEventListener('click', () => { closeMenu(); fn(); });
        menu.appendChild(mi);
      }
      addMI('フィルタ設定', () => {
        if (d.sourceType === 'all-files' && typeof showGlobalIndexFilterModal === 'function') {
          showGlobalIndexFilterModal(d.id);
        } else {
          showSmartDbFilterModal(d.id);
        }
      }, { e2eId: 'smart-db-menu-filter' });
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
      }, { e2eId: 'smart-db-menu-rename' });
      addMI('削除', () => deleteSmartDb(d.id), { e2eId: 'smart-db-menu-delete', danger: true });
      document.body.appendChild(menu);
      clampPopupToViewport(menu);
      menu.querySelector('.gb-context-menu-item')?.focus?.({ preventScroll: true });
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
  const showOpenLoading = !openOpts.silent
    && !openOpts.skipGlobalUi
    && typeof showLoading === 'function'
    && typeof hideLoading === 'function';
  let loadingShown = false;
  const recentPath = def._filePath || ('smart-db:' + smartDbId);
  const requestSeq = ++_smartDbRequestSeq;
  const isStaleSmartDbLoad = () => (typeof openOpts.isLegacyLoadCurrent === 'function' && !openOpts.isLegacyLoadCurrent())
    || requestSeq !== _smartDbRequestSeq
    || state.currentSmartDb?.id !== def.id;
  try {
    if (showOpenLoading) { showLoading('スマートシートを読み込み中...'); loadingShown = true; }
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
    if (def.sourceType === 'all-files') {
      const data = await (typeof loadGlobalIndexData === 'function'
        ? loadGlobalIndexData(def, { refresh: openOpts.forceRefresh === true })
        : Promise.resolve({ files: [], total: 0 }));
      if (isStaleSmartDbLoad()) return;
      state.smartDbData = data;
      if (showOpenLoading && typeof showLoadingBeforeHeavyWork === 'function') {
        await showLoadingBeforeHeavyWork((data.files || []).length, '大きいスマートシートを描画中...', { threshold: 250 });
        if (isStaleSmartDbLoad()) return;
      }
      if (typeof renderGlobalIndexTable === 'function') renderGlobalIndexTable(def);
      if (typeof renderSmartDbActiveView === 'function') renderSmartDbActiveView();
      if (!openOpts.skipGlobalUi) showStatus((data.files || []).length + ' / ' + (data.total || 0) + ' 件');
      return;
    }
    const effectiveSources = _smartDbEffectiveSources(def);
    if (!effectiveSources.length) {
      state.smartDbData = {
        entities: [],
        filter_properties: (def.filters || []).map(f => f?.property).filter(Boolean),
        total_dbs_scanned: 0,
        total_entities_scanned: 0,
        requires_sources: true,
      };
      renderSmartDbTable();
      if (typeof renderSmartDbActiveView === 'function') renderSmartDbActiveView();
      if (!openOpts.skipGlobalUi) showStatus('対象フォルダまたは対象シートを設定してください', true);
      return;
    }
    let url = '/smart-db?filters=' + encodeURIComponent(JSON.stringify(def.filters));
    url += '&sources=' + encodeURIComponent(JSON.stringify(effectiveSources));
    const data = await apiFetch(url);
    if (isStaleSmartDbLoad()) return;
    state.smartDbData = data;
    if (showOpenLoading && typeof showLoadingBeforeHeavyWork === 'function') {
      await showLoadingBeforeHeavyWork((data.entities || []).length, '大きいスマートシートを描画中...', { threshold: 250 });
      if (isStaleSmartDbLoad()) return;
    }
    renderSmartDbTable();
    if (typeof renderSmartDbActiveView === 'function') renderSmartDbActiveView();
    if (!openOpts.skipGlobalUi) showStatus((state.smartDbData.entities || []).length + ' 件（' + state.smartDbData.total_dbs_scanned + ' シートをスキャン）');
  } catch (e) {
    if (isStaleSmartDbLoad()) return;
    state.smartDbData = def.sourceType === 'all-files'
      ? { files: [], source_roots: [], total: 0 }
      : { entities: [], filter_properties: [], total_dbs_scanned: 0 };
    if (def.sourceType === 'all-files') {
      if (typeof renderGlobalIndexTable === 'function') renderGlobalIndexTable(def);
      if (typeof renderSmartDbActiveView === 'function') renderSmartDbActiveView();
    } else {
      renderSmartDbTable();
      if (typeof renderSmartDbActiveView === 'function') renderSmartDbActiveView();
    }
    if (!openOpts.skipGlobalUi) showStatus('スマートシート読み込み失敗', true);
  } finally {
    if (loadingShown) {
      hideLoading();
      if (typeof hideLoadingMessage === 'function') {
        hideLoadingMessage('スマートシートを読み込み中...');
        hideLoadingMessage('大きいスマートシートを描画中...');
      }
    }
  }
}

function _smartDbSourceEntityName(ent) {
  const pathName = String(ent?.path || '').split(/[\\/]/).pop().replace(/\.md$/i, '');
  return String(ent?.name || pathName || '');
}

function _smartDbFindSourceRow(entityName, ctx) {
  if (!entityName) return null;
  const table = (typeof _currentPivotTable === 'function' ? _currentPivotTable(ctx) : null)
    || (typeof _paneEl === 'function' ? _paneEl(ctx, '#pivot-table') : null)
    || document.getElementById('pivot-table');
  const root = table || document;
  const rows = [...root.querySelectorAll('tr[data-entity-name]')];
  return rows.find(row => row.dataset.entityName === entityName && row.getClientRects().length > 0)
    || rows.find(row => row.dataset.entityName === entityName)
    || null;
}

async function _smartDbHighlightSourceRow(entityName, ctx) {
  for (let i = 0; i < 30; i++) {
    const row = _smartDbFindSourceRow(entityName, ctx);
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
  const ctx = typeof _currentPaneState === 'function' ? _currentPaneState() : undefined;
  _smartDbEnsureSourcePivotView(dbPath);
  const highlighted = await _smartDbHighlightSourceRow(entityName, ctx);
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
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', 'スマートシート行メニュー');
  menu.dataset.e2eId = 'smart-db-row-menu';
  const item = document.createElement('button');
  item.type = 'button';
  item.className = 'gb-context-menu-item';
  item.dataset.e2eId = 'smart-db-row-menu-open-source';
  item.setAttribute('role', 'menuitem');
  item.setAttribute('aria-label', '元シートでこの行を開く');
  item.innerHTML = lucide('table', 14) + ' 元シートでこの行を開く';
  const restoreTarget = _smartDbPopupRestoreTarget(event);
  const closeMenu = _smartDbAttachPopupDismiss(menu, restoreTarget);
  item.addEventListener('click', () => {
    closeMenu();
    openSmartDbRowInSourceSheet(ent);
  });
  menu.appendChild(item);
  const anchor = event?.currentTarget?.getBoundingClientRect?.();
  const left = Number.isFinite(event?.clientX) && event.clientX > 0 ? event.clientX : (anchor?.left || 0);
  const top = Number.isFinite(event?.clientY) && event.clientY > 0 ? event.clientY : (anchor?.bottom || anchor?.top || 0);
  positionPopup(menu, {
    left,
    right: left,
    top,
    bottom: top,
  });
  item.focus({ preventScroll: true });
}

function renderSmartDbTable() {
  const data = state.smartDbData;
  if (!data) return;
  const table = document.querySelector('#smart-db-table');
  const thead = document.querySelector('#smart-db-table thead');
  const tbody = document.querySelector('#smart-db-table tbody');
  if (!thead || !tbody) return;
  if (typeof disposeSmartDbVirtualRows === 'function') disposeSmartDbVirtualRows(table);
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
  const createSmartDbRow = (ent) => {
    const row = document.createElement('tr');
    row.style.cssText = 'cursor:pointer;';
    row.tabIndex = 0;
    row.dataset.e2eId = _smartDbStableControlId('smart-db-table-row', ent);
    row.setAttribute('aria-label', 'スマートシート行: ' + (ent.name || '無題'));
    row.onmouseenter = () => { row.style.background = 'rgba(255,255,255,0.04)'; };
    row.onmouseleave = () => { row.style.background = ''; };
    row.addEventListener('contextmenu', (e) => showSmartDbRowContextMenu(e, ent));
    row.addEventListener('keydown', (e) => {
      if (e.key !== 'ContextMenu' && !(e.shiftKey && e.key === 'F10')) return;
      showSmartDbRowContextMenu(e, ent);
    });
    if (typeof addLongPressHandler === 'function') {
      addLongPressHandler(row, (e) => showSmartDbRowContextMenu(e, ent));
    }

    // エントリ名（auto-linkツールチップ付き）
    const tdName = document.createElement('td');
    tdName.style.cssText = 'padding:4px 10px;border-bottom:1px solid var(--border);';
    const nameSpan = document.createElement('span');
    nameSpan.className = 'auto-link';
    nameSpan.dataset.path = ent.path;
    nameSpan.dataset.e2eId = row.dataset.e2eId + '-entry';
    nameSpan.textContent = ent.name;
    nameSpan.style.cursor = 'pointer';
    nameSpan.tabIndex = 0;
    nameSpan.setAttribute('role', 'button');
    nameSpan.setAttribute('aria-label', 'エントリを開く: ' + (ent.name || '無題'));
    nameSpan.addEventListener('click', () => selectEntity(ent.path));
    _smartDbBindKeyboardActivate(nameSpan, () => selectEntity(ent.path));
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
    dbLink.dataset.e2eId = row.dataset.e2eId + '-source';
    dbLink.style.cssText = 'cursor:pointer;text-decoration:underline dotted;';
    dbLink.tabIndex = 0;
    dbLink.setAttribute('role', 'button');
    dbLink.setAttribute('aria-label', '元シートを開く: ' + (ent.db_name || ''));
    dbLink.addEventListener('click', (e) => { e.stopPropagation(); selectDatabase(ent.db_path); });
    _smartDbBindKeyboardActivate(dbLink, (e) => { e.stopPropagation(); selectDatabase(ent.db_path); });
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

    return row;
  };

  const entities = data.entities || [];
  if (typeof renderSmartDbVirtualRows === 'function' && renderSmartDbVirtualRows({
    table,
    tbody,
    rows: entities,
    colSpan: cols.length,
    rowHeight: 34,
    renderRow: createSmartDbRow,
  })) return;

  entities.forEach(ent => {
    tbody.appendChild(createSmartDbRow(ent));
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
  const restoreTarget = _smartDbActiveElement();
  const o = document.createElement('div');
  o.className = 'modal-overlay';
  o.dataset.e2eId = 'smart-filter-overlay';
  let filtersHtml = '';
  (def.filters || []).forEach((f, i) => {
    filtersHtml += `<div class="sdf-row" data-idx="${i}" style="display:flex;gap:4px;align-items:center;margin-bottom:4px;">
      <input type="text" class="gb-input" value="${esc(f.property)}" placeholder="プロパティ名" style="flex:1;padding:4px;background:var(--bg);color:var(--fg);border:1px solid var(--border);border-radius:3px;font-size:12px;" data-field="property" data-e2e-id="smart-filter-${i}-property" aria-label="スマートシート条件${i + 1} プロパティ">
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
      <input type="text" class="gb-input" value="${esc(f.value)}" placeholder="値" style="flex:1;padding:4px;background:var(--bg);color:var(--fg);border:1px solid var(--border);border-radius:3px;font-size:12px;" data-field="value" data-e2e-id="smart-filter-${i}-value" aria-label="スマートシート条件${i + 1} 値">
      <button type="button" data-smart-db-action="remove-filter-row" data-e2e-id="smart-filter-${i}-remove" aria-label="スマートシート条件${i + 1}を削除" style="background:none;border:none;color:var(--red);cursor:pointer;display:flex;align-items:center;">${lucide('x', 14)}</button>
    </div>`;
  });
  // 既存 sources を「フォルダ」「対象シート」に分離する。
  // フォルダは UI で編集対象、対象シートは生成済み定義の正式な参照元として保持する。
  const allExplicit = Array.isArray(def.sources) ? def.sources.filter(s => s && s.path) : [];
  const folderExplicit = allExplicit.filter(s => (s.kind || 'folder') === 'folder');
  const otherExplicit = allExplicit.filter(s => (s.kind || 'folder') !== 'folder');
  let sourcesNote;
  if (folderExplicit.length) {
    sourcesNote = otherExplicit.length
      ? '対象フォルダ（サブフォルダ含む）と対象シート ' + otherExplicit.length + ' 件'
      : '対象フォルダ（サブフォルダ含む）';
  } else if (otherExplicit.length) {
    sourcesNote = '対象シート ' + otherExplicit.length + ' 件が有効です。フォルダを追加することもできます。';
  } else {
    sourcesNote = '対象ソース未設定。対象フォルダまたは対象シートを設定すると読み込みます。';
  }
  let sourcesHtml = '';
  folderExplicit.forEach((s, i) => {
    sourcesHtml += _smartDbSourceRowHtml(s.path, i);
  });
  o.innerHTML = `<div class="modal cond-modal" role="dialog" aria-modal="true" aria-labelledby="sdf-title" aria-describedby="sdf-desc" data-e2e-id="smart-filter-dialog" style="min-width:500px;">
    <h3 id="sdf-title">スマートシート フィルタ設定</h3>
    <div class="modal-body cond-modal-body">
      <div class="field"><label for="sdf-name">名前</label><input id="sdf-name" class="gb-input" type="text" value="${esc(def.name)}" data-e2e-id="smart-filter-name" aria-label="スマートシート名"></div>
      <div id="sdf-desc" style="margin:0;font-size:12px;color:var(--fg2);">${esc(sourcesNote)}</div>
      <div id="sdf-sources" class="cond-list">${sourcesHtml}</div>
      <button type="button" class="cond-add-btn" id="sdf-add-source-btn" data-e2e-id="smart-filter-add-source" style="font-size:12px;padding:2px 8px;background:var(--bg3);color:var(--fg2);border:1px solid var(--border);border-radius:3px;cursor:pointer;margin:4px 0;">+ フォルダを追加</button>
      <div style="margin:8px 0 0;font-size:12px;color:var(--fg2);">フィルタ条件（AND: すべて一致）</div>
      <div id="sdf-filters" class="cond-list">${filtersHtml}</div>
      <button type="button" class="cond-add-btn" data-smart-db-action="add-filter-row" data-e2e-id="smart-filter-add-row" style="font-size:12px;padding:2px 8px;background:var(--bg3);color:var(--fg2);border:1px solid var(--border);border-radius:3px;cursor:pointer;margin:4px 0;">+ 条件追加</button>
    </div>
    <div class="btn-row" style="margin-top:12px;">
      <button type="button" data-smart-db-action="close-modal" data-e2e-id="smart-filter-cancel">キャンセル</button>
      <button type="button" class="primary" id="sdf-save-btn" data-e2e-id="smart-filter-save">保存</button>
    </div>
  </div>`;
  document.body.appendChild(o);
  if (typeof setupConditionModalLayout === 'function') setupConditionModalLayout(o, '#sdf-filters');
  const closeOverlay = _smartDbAttachOverlayDismiss(o, restoreTarget);
  o.addEventListener('click', (ev) => {
    const actionEl = ev.target?.closest?.('[data-smart-db-action]');
    if (!actionEl || !o.contains(actionEl)) return;
    const action = actionEl.dataset.smartDbAction;
    if (action === 'remove-filter-row') actionEl.closest('.sdf-row')?.remove();
    else if (action === 'remove-source-row') actionEl.closest('.sdf-src-row')?.remove();
    else if (action === 'add-filter-row') document.getElementById('sdf-filters')?.insertAdjacentHTML('beforeend', _smartDbFilterRowHtml());
    else if (action === 'close-modal') closeOverlay();
  });
  // smartDbId に特殊文字が含まれる場合 esc() は JS 文字列を保護できないため直接バインド
  document.getElementById('sdf-save-btn').addEventListener('click', () => _saveSmartDbFilters(smartDbId));
  document.getElementById('sdf-add-source-btn').addEventListener('click', () => {
    _openSmartDbFolderPicker(def, (folderPath) => {
      if (!folderPath) return;
      const host = document.getElementById('sdf-sources');
      if (host) host.insertAdjacentHTML('beforeend', _smartDbSourceRowHtml(folderPath));
    }, document.getElementById('sdf-add-source-btn'));
  });
  _smartDbFocusFirstDialogControl(o);
}

function _smartDbSourceRowHtml(path, idx) {
  const safeIdx = (idx != null) ? String(idx) : ('new-' + Date.now().toString(36));
  return `<div class="sdf-src-row" data-src-idx="${esc(safeIdx)}" style="display:flex;gap:4px;align-items:center;margin-bottom:4px;">
    <input type="text" class="gb-input" value="${esc(path || '')}" placeholder="フォルダパス" style="flex:1;padding:4px;background:var(--bg);color:var(--fg);border:1px solid var(--border);border-radius:3px;font-size:12px;" data-field="path" data-e2e-id="smart-filter-source-${esc(safeIdx)}-path" aria-label="対象フォルダ ${esc(safeIdx)}">
    <button type="button" data-smart-db-action="remove-source-row" data-e2e-id="smart-filter-source-${esc(safeIdx)}-remove" aria-label="対象フォルダ ${esc(safeIdx)} を削除" style="background:none;border:none;color:var(--red);cursor:pointer;display:flex;align-items:center;">${lucide('x', 14)}</button>
  </div>`;
}

// 対象フォルダ選択モーダル（フォルダツリーからピックする）
async function _openSmartDbFolderPicker(def, callback) {
  const restoreTarget = arguments.length > 2 ? arguments[2] : null;
  if (window.GBFolderPicker?.pickFolder) {
    const selected = await window.GBFolderPicker.pickFolder({
      title: '対象フォルダを選択',
      initialPath: '',
    });
    if (selected?.path && callback) {
      callback(window.GBFolderPicker.toSourceRelativePath?.(selected) || selected.path);
    }
    return;
  }
  let roots = [];
  try { roots = await apiFetch('/outliner-roots'); }
  catch { showStatus('ソースフォルダ一覧の取得に失敗しました', true); return; }
  const visibleRoots = (Array.isArray(roots) ? roots : []).filter(r => r && r.visible !== false && r.path);
  if (!visibleRoots.length) { showStatus('ソースフォルダが設定されていません', true); return; }

  // ソースフォルダ絶対パスの map（フロントは絶対パス→相対化）
  const rootMap = visibleRoots.map(r => ({
    name: r.name || (String(r.path).split(/[\\/]/).pop() || ''),
    abs: String(r.path || '').replace(/\\/g, '/').replace(/\/+$/, ''),
  }));

  const o = document.createElement('div');
  o.className = 'modal-overlay';
  o.dataset.e2eId = 'smart-folder-picker-overlay';
  const closePicker = () => {
    o.remove();
    _smartDbRestoreFocus(restoreTarget);
  };
  o.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-labelledby="sdf-folder-title" aria-describedby="sdf-folder-desc" data-e2e-id="smart-folder-picker-dialog" style="min-width:520px;max-width:80vw;">
    <h3 id="sdf-folder-title">対象フォルダを選択</h3>
    <div id="sdf-folder-desc" style="font-size:12px;color:var(--fg2);margin-bottom:8px;">フォルダをクリックすると、そのフォルダ＋サブフォルダがスマートシートの対象になります。</div>
    <div id="sdf-folder-tree" role="tree" aria-label="対象フォルダ" style="max-height:60vh;overflow:auto;border:1px solid var(--border);border-radius:6px;padding:6px;background:var(--bg);"></div>
    <div class="btn-row" style="margin-top:12px;">
      <button type="button" data-smart-db-action="close-modal" data-e2e-id="smart-folder-picker-cancel">キャンセル</button>
    </div>
  </div>`;
  document.body.appendChild(o);
  const dismiss = _smartDbAttachOverlayDismiss(o, restoreTarget);
  o.addEventListener('click', (ev) => {
    const actionEl = ev.target?.closest?.('[data-smart-db-action]');
    if (!actionEl || !o.contains(actionEl)) return;
    if (actionEl.dataset.smartDbAction === 'close-modal') dismiss();
  });

  const tree = o.querySelector('#sdf-folder-tree');
  const fragment = document.createDocumentFragment();
  rootMap.forEach(r => fragment.appendChild(_buildSmartDbFolderRoot(r, (relPath) => {
    if (callback) callback(relPath);
    closePicker();
  })));
  tree.appendChild(fragment);
  _smartDbFocusFirstDialogControl(o);
}

// 絶対パスから「ソースフォルダ名/サブパス」形式のソース相対パスを組み立てる
function _smartDbToSourceRelPath(rootInfo, absPath) {
  const abs = String(absPath || '').replace(/\\/g, '/').replace(/\/+$/, '');
  if (!rootInfo || !rootInfo.abs) return abs;
  const rootAbs = rootInfo.abs;
  if (abs === rootAbs) return rootInfo.name;
  if (abs.startsWith(rootAbs + '/')) return rootInfo.name + '/' + abs.slice(rootAbs.length + 1);
  // 想定外: API 戻り値が相対 / 別ボリュームの場合は素直にそのまま返す
  return abs;
}

function _buildSmartDbFolderRoot(rootInfo, onPick) {
  const node = document.createElement('div');
  node.className = 'sdf-tree-node';
  node.style.cssText = 'font-size:13px;';
  const labelRow = _smartDbPickerRow();
  const toggle = labelRow.querySelector('[data-role="toggle"]');
  const labelEl = labelRow.querySelector('[data-role="label"]');
  labelEl.textContent = rootInfo.name + ' (ソースフォルダ全体)';
  labelEl.dataset.e2eId = 'smart-folder-picker-root-label';
  labelEl.setAttribute('aria-label', rootInfo.name + ' を対象フォルダにする');
  node.appendChild(labelRow);

  const childrenHost = document.createElement('div');
  childrenHost.style.cssText = 'margin-left:14px;display:none;';
  node.appendChild(childrenHost);

  _wireSmartDbFolderExpand(toggle, childrenHost, async () => {
    const items = await apiFetch('/browse?path=' + encodeURIComponent(rootInfo.abs) + '&detail=false');
    const subs = (Array.isArray(items) ? items : []).filter(it => it && it.type === 'folder' && it.name);
    subs.sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'ja'));
    return subs.map(sub => _buildSmartDbFolderChild(rootInfo, rootInfo.abs + '/' + sub.name, sub.name, onPick));
  }, '(サブフォルダなし)');

  labelRow.addEventListener('click', (e) => {
    if (e.target === toggle) return;
    if (onPick) onPick(rootInfo.name);
  });
  _smartDbBindKeyboardActivate(labelEl, () => {
    if (onPick) onPick(rootInfo.name);
  });
  return node;
}

function _buildSmartDbFolderChild(rootInfo, absPath, name, onPick) {
  const abs = String(absPath || '').replace(/\\/g, '/').replace(/\/+$/, '');
  const sourceRelPath = _smartDbToSourceRelPath(rootInfo, abs);

  const node = document.createElement('div');
  const labelRow = _smartDbPickerRow();
  const toggle = labelRow.querySelector('[data-role="toggle"]');
  const labelEl = labelRow.querySelector('[data-role="label"]');
  labelEl.textContent = name;
  labelEl.dataset.e2eId = 'smart-folder-picker-child-label';
  labelEl.setAttribute('aria-label', sourceRelPath + ' を対象フォルダにする');
  node.appendChild(labelRow);

  const childrenHost = document.createElement('div');
  childrenHost.style.cssText = 'margin-left:14px;display:none;';
  node.appendChild(childrenHost);

  _wireSmartDbFolderExpand(toggle, childrenHost, async () => {
    const items = await apiFetch('/browse?path=' + encodeURIComponent(abs) + '&detail=false');
    const subs = (Array.isArray(items) ? items : []).filter(it => it && it.type === 'folder' && it.name);
    subs.sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'ja'));
    return subs.map(sub => _buildSmartDbFolderChild(rootInfo, abs + '/' + sub.name, sub.name, onPick));
  }, null);

  labelRow.addEventListener('click', (e) => {
    if (e.target === toggle) return;
    if (onPick) onPick(sourceRelPath);
  });
  _smartDbBindKeyboardActivate(labelEl, () => {
    if (onPick) onPick(sourceRelPath);
  });
  return node;
}

function _smartDbPickerRow() {
  const labelRow = document.createElement('div');
  labelRow.style.cssText = 'display:flex;align-items:center;gap:4px;padding:2px 4px;cursor:pointer;border-radius:3px;';
  labelRow.setAttribute('role', 'presentation');
  labelRow.addEventListener('mouseenter', () => { labelRow.style.background = 'var(--bg3)'; });
  labelRow.addEventListener('mouseleave', () => { labelRow.style.background = ''; });
  const toggle = document.createElement('span');
  toggle.dataset.role = 'toggle';
  toggle.dataset.e2eId = 'smart-folder-picker-toggle';
  toggle.setAttribute('role', 'button');
  toggle.setAttribute('tabindex', '0');
  toggle.setAttribute('aria-label', 'サブフォルダを展開');
  toggle.setAttribute('aria-expanded', 'false');
  toggle.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;width:22px;min-width:22px;min-height:22px;text-align:center;color:var(--fg2);';
  toggle.textContent = '▶';
  const labelEl = document.createElement('span');
  labelEl.dataset.role = 'label';
  labelEl.setAttribute('role', 'button');
  labelEl.setAttribute('tabindex', '0');
  labelEl.style.cssText = 'flex:1;min-height:22px;display:flex;align-items:center;';
  labelRow.appendChild(toggle);
  labelRow.appendChild(labelEl);
  return labelRow;
}

function _wireSmartDbFolderExpand(toggle, childrenHost, fetchChildren, emptyHint) {
  let expanded = false;
  let loaded = false;
  const expand = async () => {
    if (!loaded) {
      loaded = true;
      try {
        const children = await fetchChildren();
        if (!children.length) {
          if (emptyHint) {
            const empty = document.createElement('div');
            empty.style.cssText = 'font-size:11px;color:var(--fg2);padding:2px 0;';
            empty.textContent = emptyHint;
            childrenHost.appendChild(empty);
          } else {
            toggle.style.visibility = 'hidden';
          }
        } else {
          children.forEach(el => childrenHost.appendChild(el));
        }
      } catch {
        const errEl = document.createElement('div');
        errEl.style.cssText = 'font-size:11px;color:var(--red);padding:2px 0;';
        errEl.textContent = '(読み込み失敗)';
        childrenHost.appendChild(errEl);
      }
    }
    expanded = true;
    childrenHost.style.display = '';
    toggle.textContent = '▼';
    toggle.setAttribute('aria-expanded', 'true');
    toggle.setAttribute('aria-label', 'サブフォルダを折りたたむ');
  };
  const collapse = () => {
    expanded = false;
    childrenHost.style.display = 'none';
    toggle.textContent = '▶';
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-label', 'サブフォルダを展開');
  };
  toggle.addEventListener('click', (e) => { e.stopPropagation(); if (expanded) collapse(); else expand(); });
  _smartDbBindKeyboardActivate(toggle, () => { if (expanded) collapse(); else expand(); });
}

function _smartDbFilterRowHtml(prop='', field='value', op='contains', val='') {
  const rowId = 'new-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
  return `<div class="sdf-row" data-e2e-row="${rowId}" style="display:flex;gap:4px;align-items:center;margin-bottom:4px;">
    <input type="text" class="gb-input" value="${esc(prop)}" placeholder="プロパティ名" style="flex:1;padding:4px;background:var(--bg);color:var(--fg);border:1px solid var(--border);border-radius:3px;font-size:12px;" data-field="property" data-e2e-id="smart-filter-${rowId}-property" aria-label="スマートシート新規条件 プロパティ">
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
    <input type="text" class="gb-input" value="${esc(val)}" placeholder="値" style="flex:1;padding:4px;background:var(--bg);color:var(--fg);border:1px solid var(--border);border-radius:3px;font-size:12px;" data-field="value" data-e2e-id="smart-filter-${rowId}-value" aria-label="スマートシート新規条件 値">
    <button type="button" data-smart-db-action="remove-filter-row" data-e2e-id="smart-filter-${rowId}-remove" aria-label="スマートシート新規条件を削除" style="background:none;border:none;color:var(--red);cursor:pointer;display:flex;align-items:center;">${lucide('x', 14)}</button>
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
  // 対象フォルダ（sources）— 空の行は無視、kind は folder 固定（サブフォルダ含む）
  // 生成済み定義の対象シート source（kind: "sheet" 等）は正式な参照元として保持する。
  const srcRows = document.querySelectorAll('#sdf-sources .sdf-src-row');
  const folderSources = [];
  srcRows.forEach(r => {
    const p = (r.querySelector('[data-field="path"]')?.value || '').trim();
    if (p) folderSources.push({ kind: 'folder', path: p });
  });
  const preservedSources = Array.isArray(def?.sources)
    ? def.sources.filter(s => s && s.path && (s.kind || 'folder') !== 'folder')
    : [];
  const sources = preservedSources.concat(folderSources);
  if (def) {
    const before = _captureSmartDbHistorySnapshot(def);
    const nextDef = normalizeSmartDbDefinition(JSON.parse(JSON.stringify({ ...def, name, filters, sources })));
    if (def._filePath) nextDef._filePath = def._filePath;
    if (def._fileId) nextDef._fileId = def._fileId;
    try { await saveSmartDbDef(nextDef); }
    catch (e) { showStatus('スマートシートの保存に失敗しました: ' + e.message, true); return; }
    Object.assign(def, nextDef);
    if (typeof pushSmartDbDefinitionHistory === 'function') {
      pushSmartDbDefinitionHistory('スマートシート: フィルタ保存', before, nextDef, nextDef.name);
    }
    renderSmartDbList();
    showStatus('フィルタを保存しました');
    document.getElementById('sdf-filters')?.closest('.modal-overlay')?.remove();
    // 開いていたら再読み込み
    if (state.currentSmartDb?.id === smartDbId) selectSmartDb(smartDbId, def);
  }
}
