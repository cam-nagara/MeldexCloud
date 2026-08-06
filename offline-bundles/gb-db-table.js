/* ピボット描画・委譲UI — gb-database.js から分離 */

// 統合フィルタダイアログ（showUnifiedFilterModal 等）は gb-db-filter-dialog.js へ移設した。


function _dbEntityCreateContextMatches(ctx, dbPath) {
  if (!ctx) return false;
  const normalize = typeof _dbNormalizePath === 'function'
    ? _dbNormalizePath
    : (path) => String(path || '').replace(/\\/g, '/').replace(/\/+$/, '');
  const target = normalize(dbPath);
  const current = normalize(ctx.dbPath || '');
  if (target && current && target !== current) return false;
  return !!(ctx.containerEl && document.body.contains(ctx.containerEl));
}

function _dbResolveEntityCreateRenderContext(ctx, dbPath) {
  if (_dbEntityCreateContextMatches(ctx, dbPath)) return ctx;
  const active = typeof _currentPaneState === 'function' ? _currentPaneState() : null;
  if (_dbEntityCreateContextMatches(active, dbPath)) return active;
  const live = typeof _dbFindPaneContextForPath === 'function' ? _dbFindPaneContextForPath(dbPath) : null;
  if (_dbEntityCreateContextMatches(live, dbPath)) return live;
  return ctx || active || live || null;
}

function _dbRenderEntityCreateContext(renderCtx, dbPath) {
  if (!renderCtx) return;
  if (typeof _renderCurrentDbView === 'function') _renderCurrentDbView(renderCtx, dbPath);
  else if (typeof renderPivot === 'function') renderPivot(renderCtx);
}

function _dbEnsureCreatedEntitiesVisibleLocally(ctx, dbPath, createdNames, options) {
  if (!createdNames?.length) return null;
  const opts = options || {};
  const renderCtx = _dbResolveEntityCreateRenderContext(ctx, dbPath);
  const targets = [];
  if (renderCtx) targets.push(renderCtx);
  const normalize = typeof _dbNormalizePath === 'function'
    ? _dbNormalizePath
    : (path) => String(path || '').replace(/\\/g, '/').replace(/\/+$/, '');
  if (typeof state !== 'undefined' && normalize(state.currentDbPath || '') === normalize(dbPath || '')) targets.push(state);
  let changed = false;
  targets.forEach(target => {
    const data = target?.pivotData;
    if (!data?.entities) return;
    createdNames.forEach(name => {
      if (!Object.prototype.hasOwnProperty.call(data.entities, name)) {
        data.entities[name] = {};
        changed = true;
      }
    });
  });
  if (renderCtx?.pivotData?.entities) {
    const names = Array.isArray(renderCtx._lastEntityNames) ? [...renderCtx._lastEntityNames] : Object.keys(renderCtx.pivotData.entities);
    createdNames.forEach(name => { if (!names.includes(name)) names.push(name); });
    renderCtx._lastEntityNames = names;
  }
  if (changed && !opts.skipRender) _dbRenderEntityCreateContext(renderCtx, dbPath);
  return renderCtx;
}

function _dbRemoveNamesFromCurrentManualOrder(dbPath, names) {
  if (!dbPath || !names?.length || typeof getDbViewConfig !== 'function' || typeof saveDbViewConfig !== 'function') return false;
  const cfg = getDbViewConfig(dbPath);
  const target = typeof _getCurrentDbViewConfigEntryFromConfig === 'function'
    ? (_getCurrentDbViewConfigEntryFromConfig(cfg) || cfg)
    : cfg;
  if (!Array.isArray(target?.manualOrder)) return false;
  const blocked = new Set(names);
  const next = target.manualOrder.filter(name => !blocked.has(name));
  if (next.length === target.manualOrder.length) return false;
  target.manualOrder = next;
  saveDbViewConfig(dbPath, cfg);
  return true;
}

function _dbPlaceCreatedEntitiesInManualOrder(ctx, dbPath, createdNames, options) {
  if (!createdNames?.length || typeof getDbViewConfig !== 'function' || typeof saveDbViewConfig !== 'function') {
    return _dbResolveEntityCreateRenderContext(ctx, dbPath);
  }
  const opts = options || {};
  const renderCtx = _dbResolveEntityCreateRenderContext(ctx, dbPath);
  const cfg = getDbViewConfig(dbPath);
  const target = typeof _getCurrentDbViewConfigEntryFromConfig === 'function'
    ? (_getCurrentDbViewConfigEntryFromConfig(cfg) || cfg)
    : cfg;
  const entitiesMap = renderCtx?.pivotData?.entities || ctx?.pivotData?.entities || {};
  const baseline = _getEntityOrderSnapshot(renderCtx || ctx, dbPath, entitiesMap);
  const appendVisibleOrder = Array.isArray(opts.baselineOrder) ? opts.baselineOrder : null;
  const addOrderName = (order, name) => {
    if (name && !order.includes(name)) order.push(name);
  };
  let order = [];
  if (opts.position === 'append' && appendVisibleOrder?.length) {
    appendVisibleOrder.forEach(name => addOrderName(order, name));
    (Array.isArray(target.manualOrder) ? target.manualOrder : []).forEach(name => addOrderName(order, name));
    baseline.forEach(name => addOrderName(order, name));
  } else {
    order = Array.isArray(target.manualOrder) ? [...target.manualOrder] : baseline;
    baseline.forEach(name => addOrderName(order, name));
  }
  const createdSet = new Set(createdNames);
  order = order.filter(name => !createdSet.has(name));
  const refEntityName = opts.refEntityName || '';
  const refIdx = refEntityName ? order.indexOf(refEntityName) : -1;
  if (refIdx < 0 || opts.position === 'append') {
    order.push(...createdNames);
  } else {
    const insertIdx = refIdx + (opts.position === 'below' ? 1 : 0);
    order.splice(insertIdx, 0, ...createdNames);
  }
  target.sortConfig = { key: 'manual', dir: 'asc' };
  target.manualOrder = order;
  saveDbViewConfig(dbPath, cfg);
  if (renderCtx?.pivotData?.entities) {
    renderCtx._lastEntityNames = order.filter(name => Object.prototype.hasOwnProperty.call(renderCtx.pivotData.entities, name));
  }
  _dbRenderEntityCreateContext(renderCtx, dbPath);
  return renderCtx;
}

function _dbRemoveCreatedEntitiesLocally(ctx, dbPath, names, options = {}) {
  if (!names?.length) return;
  const normalize = typeof _dbNormalizePath === 'function'
    ? _dbNormalizePath
    : (path) => String(path || '').replace(/\\/g, '/').replace(/\/+$/, '');
  const renderCtx = _dbResolveEntityCreateRenderContext(ctx, dbPath);
  const targets = [];
  const addTarget = target => {
    if (target && !target.destroyed && !targets.includes(target)) targets.push(target);
  };
  addTarget(renderCtx);
  if (typeof _dbPaneContextsForPath === 'function') {
    _dbPaneContextsForPath(dbPath).forEach(addTarget);
  }
  if (typeof state !== 'undefined' && normalize(state.currentDbPath || '') === normalize(dbPath || '')) addTarget(state);
  let changed = false;
  targets.forEach(target => {
    const data = target?.pivotData;
    if (!data?.entities) return;
    names.forEach(name => {
      if (Object.prototype.hasOwnProperty.call(data.entities, name)) {
        delete data.entities[name];
        changed = true;
      }
    });
    if (Array.isArray(target._lastEntityNames)) {
      const next = target._lastEntityNames.filter(name => !names.includes(name));
      if (next.length !== target._lastEntityNames.length) {
        target._lastEntityNames = next;
        changed = true;
      }
    }
  });
  if (!options.preserveManualOrder && _dbRemoveNamesFromCurrentManualOrder(dbPath, names)) changed = true;
  if (changed) {
    const renderTargets = targets.filter(target => (
      target === renderCtx || target?.containerEl || target?.embedded
    ));
    (renderTargets.length ? renderTargets : [renderCtx]).forEach(target => {
      if (target) _dbRenderEntityCreateContext(target, dbPath);
    });
  }
}

function _dbCollectEntityNamesForCreate(ctx, dbPath, entitiesMap) {
  const normalize = typeof _dbNormalizePath === 'function'
    ? _dbNormalizePath
    : (path) => String(path || '').replace(/\\/g, '/').replace(/\/+$/, '');
  const target = normalize(dbPath || '');
  const names = new Set(Object.keys(entitiesMap || {}));
  const collectFrom = (source) => {
    if (!source || (target && normalize(source.dbPath || '') !== target)) return;
    Object.keys(source.pivotData?.entities || {}).forEach(name => names.add(name));
    (Array.isArray(source._lastEntityNames) ? source._lastEntityNames : []).forEach(name => names.add(name));
  };
  collectFrom(ctx);
  if (typeof state !== 'undefined') collectFrom(state);
  const live = typeof _dbFindPaneContextForPath === 'function' ? _dbFindPaneContextForPath(dbPath) : null;
  collectFrom(live);
  return [...names].filter(Boolean);
}

function _dbCreateEntityOptimistic(ctx, dbPath, options) {
  const createOpts = options || {};
  const entitiesMap = ctx?.pivotData?.entities || {};
  const existing = _dbCollectEntityNamesForCreate(ctx, dbPath, entitiesMap);
  const baseName = createOpts.baseName || '無題';
  const localName = typeof _dbNextLocalEntityName === 'function'
    ? _dbNextLocalEntityName(dbPath, existing, baseName)
    : _entityDefaultName(baseName, existing.length + 1);
  const shouldPlaceInManualOrder = ['append', 'below', 'above'].includes(createOpts.position);
  const visibleCtx = _dbEnsureCreatedEntitiesVisibleLocally(ctx, dbPath, [localName], {
    skipRender: createOpts.skipRender === true || shouldPlaceInManualOrder,
  }) || ctx;
  const renderCtx = shouldPlaceInManualOrder && typeof _dbPlaceCreatedEntitiesInManualOrder === 'function'
    ? (_dbPlaceCreatedEntitiesInManualOrder(visibleCtx, dbPath, [localName], createOpts) || visibleCtx)
    : visibleCtx;
  const createPromise = (async () => {
    const created = typeof _apiCreateEntityWithUniqueName === 'function'
      ? await _apiCreateEntityWithUniqueName(dbPath, existing, { name: localName, baseName })
      : null;
    const response = created?.response || await apiPost('/entity/create', { parent_path: dbPath, name: localName });
    const name = created?.name || localName;
    return {
      name,
      requestedName: localName,
      path: created?.path || (response && (response.path || response.entry_path)) || `${dbPath}/${name}.md`,
      response,
    };
  })();
  const trackedPromise = typeof _dbRegisterPendingEntityCreate === 'function'
    ? _dbRegisterPendingEntityCreate(dbPath, localName, createPromise)
    : createPromise;
  return { name: localName, renderCtx, promise: trackedPromise, baseName, baseline: existing };
}

// サーバーが実際に付けた名前が楽観行の仮名と異なる場合、ローカル表示（エンティティ
// マップ・表示順・manualOrder）の名前をサーバー名へ付け替える。付け替えないと
// 再取得時に仮名が manualOrder に残り、実体が並び順から外れて行が消えたように見える。
function _dbRenameOptimisticEntityLocally(ctx, dbPath, fromName, toName) {
  if (!fromName || !toName || fromName === toName) return;
  const normalize = typeof _dbNormalizePath === 'function'
    ? _dbNormalizePath
    : (path) => String(path || '').replace(/\\/g, '/').replace(/\/+$/, '');
  const renderCtx = _dbResolveEntityCreateRenderContext(ctx, dbPath);
  const targets = [];
  if (renderCtx) targets.push(renderCtx);
  if (typeof state !== 'undefined' && normalize(state.currentDbPath || '') === normalize(dbPath || '')) targets.push(state);
  targets.forEach(target => {
    const ents = target?.pivotData?.entities;
    if (ents && Object.prototype.hasOwnProperty.call(ents, fromName) && !Object.prototype.hasOwnProperty.call(ents, toName)) {
      ents[toName] = ents[fromName];
      delete ents[fromName];
    }
    if (Array.isArray(target._lastEntityNames)) {
      target._lastEntityNames = target._lastEntityNames.map(name => (name === fromName ? toName : name));
    }
  });
  if (typeof getDbViewConfig === 'function' && typeof saveDbViewConfig === 'function') {
    const cfg = getDbViewConfig(dbPath);
    const entry = typeof _getCurrentDbViewConfigEntryFromConfig === 'function'
      ? (_getCurrentDbViewConfigEntryFromConfig(cfg) || cfg)
      : cfg;
    if (Array.isArray(entry?.manualOrder) && entry.manualOrder.includes(fromName)) {
      entry.manualOrder = entry.manualOrder.map(name => (name === fromName ? toName : name));
      saveDbViewConfig(dbPath, cfg);
    }
  }
}

// 作成通信がタイムアウト/中断で失敗しても、サーバー側は作成を完了していることがある。
// /pivot を取り直して実体が現れていれば、行を撤去せず成功として確定する。
// 撤去してよい（本当に作られていない）場合のみ null を返す。
async function _dbRecoverEntityCreateAfterError(ctx, dbPath, created) {
  try {
    const pivotData = await apiFetch(_dbPivotFetchUrl(dbPath), { skipBrowseCache: true, cache: 'reload' });
    if (typeof _stampPivotValueEntityPaths === 'function') _stampPivotValueEntityPaths(dbPath, pivotData);
    const serverNames = Object.keys(pivotData?.entities || {});
    const baseName = String(created?.baseName || '無題');
    const baseline = new Set(Array.isArray(created?.baseline) ? created.baseline : []);
    let confirmed = '';
    if (created?.name && serverNames.includes(created.name)) {
      confirmed = created.name;
    } else {
      // 再試行で別名が付いた可能性。ベースライン以降に新しく現れた同系統名が
      // ちょうど1件だけなら、それを今回の作成とみなす。
      const family = serverNames.filter(name => !baseline.has(name)
        && (name === baseName || (name.startsWith(baseName) && /^\d+$/.test(name.slice(baseName.length)))));
      if (family.length === 1) confirmed = family[0];
    }
    if (!confirmed) return null;
    if (confirmed !== created.name) _dbRenameOptimisticEntityLocally(ctx, dbPath, created.name, confirmed);
    const renderCtx = _dbResolveEntityCreateRenderContext(ctx, dbPath);
    if (renderCtx) renderCtx.pivotData = pivotData;
    if (typeof state !== 'undefined' && state.currentDbPath === dbPath) state.pivotData = pivotData;
    if (!_dbEntityCreateIsEditing(renderCtx)) {
      if (typeof _renderCurrentDbView === 'function') _renderCurrentDbView(renderCtx, dbPath);
      else if (typeof renderPivot === 'function') renderPivot(renderCtx);
    }
    return { name: confirmed, path: created?.path || (typeof _entityPath === 'function' ? _entityPath(dbPath, confirmed) : `${dbPath}/${confirmed}.md`) };
  } catch {
    return null;
  }
}

function _dbEntityCreateIsEditing(renderCtx) {
  const table = typeof _currentPivotTable === 'function' ? _currentPivotTable(renderCtx) : null;
  if (table?.querySelector?.('.entity-rename-input,.th-rename-input,.cell-inline-input,.cell-inline-select,.cell-date-editor')) return true;
  // セレクト/ユーザー/リレーション等のドロップダウンは body 直下に出るため、テーブル内検索では拾えない
  if (renderCtx?.paneId) {
    const paneId = globalThis.CSS?.escape
      ? CSS.escape(renderCtx.paneId)
      : String(renderCtx.paneId).replace(/["\\]/g, '\\$&');
    return !!document.querySelector(
      `.cell-inline-dd[data-db-pane-id="${paneId}"],.status-dropdown[data-db-pane-id="${paneId}"],.user-dropdown[data-db-pane-id="${paneId}"]`
    );
  }
  return !!document.querySelector('.cell-inline-dd,.status-dropdown,.user-dropdown');
}

function _dbPivotFetchUrl(dbPath) {
  return '/pivot?path=' + encodeURIComponent(dbPath)
    + (typeof getFilterParam === 'function' && getFilterParam() ? '&status_filter=' + getFilterParam() : '');
}

function _dbFindEntityRow(ctx, entityName) {
  const tblId = (ctx && ctx.tableId) || 'pivot-table';
  const root = typeof _paneEl === 'function'
    ? (_paneEl(ctx, '#' + tblId) || (!ctx ? document : null))
    : (!ctx ? document : null);
  return root?.querySelector(`tbody tr[data-entity-name="${CSS.escape(entityName)}"]`) || null;
}

function _dbStartEntityInlineRenameWhenVisible(ctx, entityName, dbPath) {
  const start = (tr) => {
    const label = tr.querySelector('.entity-name-label');
    const td = label?.closest('td');
    if (td && label) startEntityInlineRename(td, label, entityName, dbPath);
  };
  const row = _dbFindEntityRow(ctx, entityName);
  if (row) {
    start(row);
    return;
  }
  if (typeof _waitForEntityRow === 'function') _waitForEntityRow(ctx, entityName, start);
}

function _dbKeepNewEntryRowVisible(ctx) {
  const findScrollableParent = (el) => {
    let cur = el?.parentElement || null;
    while (cur && cur !== document.body) {
      const style = getComputedStyle(cur);
      if (/(auto|scroll)/.test(style.overflowY || '') && cur.scrollHeight > cur.clientHeight + 1) return cur;
      cur = cur.parentElement;
    }
    return null;
  };
  const run = () => {
    const table = (typeof _currentPivotTable === 'function' ? _currentPivotTable(ctx) : null)
      || document.getElementById((ctx && ctx.tableId) || 'pivot-table')
      || document.querySelector('table.pivot-table');
    const row = table?.querySelector?.('tbody tr.new-entity-row');
    const scroller = row?.closest?.('#pivot-view, .pivot-view') || findScrollableParent(row);
    if (!table || !row || !scroller) return;
    const rowRect = row.getBoundingClientRect();
    const scrollerRect = scroller.getBoundingClientRect();
    const footerHeight = table.querySelector('tfoot')?.getBoundingClientRect?.().height || 0;
    const zoom = parseFloat(document.documentElement.style.zoom) || 1;
    const visibleBottom = scrollerRect.bottom - footerHeight - 2;
    if (rowRect.bottom > visibleBottom) {
      scroller.scrollTop = Math.max(scroller.scrollTop + Math.ceil((rowRect.bottom - visibleBottom) / zoom) + 2, scroller.scrollHeight);
    } else if (rowRect.top < scrollerRect.top) {
      scroller.scrollTop -= Math.ceil((scrollerRect.top - rowRect.top) / zoom) + 2;
    }
  };
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(() => {
      run();
      setTimeout(run, 0);
      setTimeout(run, 80);
      setTimeout(run, 200);
      setTimeout(run, 600);
      setTimeout(run, 1200);
    });
  } else {
    setTimeout(run, 0);
    setTimeout(run, 80);
    setTimeout(run, 200);
    setTimeout(run, 600);
    setTimeout(run, 1200);
  }
}

async function _dbReloadAfterEntityCreate(ctx, dbPath, createdNames) {
  const renderCtx = _dbResolveEntityCreateRenderContext(ctx, dbPath);
  setTimeout(async () => {
    try {
      const pivotData = await apiFetch(_dbPivotFetchUrl(dbPath));
      if (typeof _stampPivotValueEntityPaths === 'function') _stampPivotValueEntityPaths(dbPath, pivotData);
      // サーバー作成が未確定の楽観的エントリは取得データに含まれないため、行が消えないよう再マージする
      if (typeof _dbMergePendingEntityCreates === 'function') _dbMergePendingEntityCreates(dbPath, pivotData);
      // 直前に作成が確定した名前も、SQLite の可視化タイミング等でこの取得にまだ
      // 現れていない場合があるため、行が一瞬消えないよう空スタブで保持する（次回取得で実体化）。
      if (pivotData && pivotData.entities && typeof pivotData.entities === 'object') {
        (createdNames || []).forEach(name => {
          if (name && !(name in pivotData.entities)) pivotData.entities[name] = {};
        });
      }
      if (renderCtx) renderCtx.pivotData = pivotData;
      if (typeof state !== 'undefined' && state.currentDbPath === dbPath) state.pivotData = pivotData;
      if (!_dbEntityCreateIsEditing(renderCtx)) {
        const tableBefore = typeof _currentPivotTable === 'function' ? _currentPivotTable(renderCtx) : null;
        const scroller = tableBefore?.closest?.('#pivot-view, .pivot-view');
        const scrollTop = scroller ? scroller.scrollTop : 0;
        const scrollLeft = scroller ? scroller.scrollLeft : 0;
        // 再描画で破棄される選択中セルの位置を控えておく
        const activeTd = tableBefore?.querySelector?.('td.active-cell');
        const activeInfo = activeTd ? {
          entityName: activeTd.closest('tr')?.dataset?.entityName || '',
          propName: activeTd.dataset?.propName || '',
          isEntity: activeTd.classList.contains('col-entity'),
        } : null;
        if (typeof _renderCurrentDbView === 'function') _renderCurrentDbView(renderCtx, dbPath);
        else if (typeof renderPivot === 'function') renderPivot(renderCtx);
        // 選択中セルを再描画後のDOMへ復元する
        if (activeInfo?.entityName && typeof setActiveCell === 'function') {
          const tableAfter = typeof _currentPivotTable === 'function' ? _currentPivotTable(renderCtx) : null;
          const rowAfter = tableAfter?.querySelector?.(`tbody tr[data-entity-name="${CSS.escape(activeInfo.entityName)}"]`);
          const cellAfter = activeInfo.propName
            ? rowAfter?.querySelector?.(`td[data-prop-name="${CSS.escape(activeInfo.propName)}"]`)
            : (activeInfo.isEntity ? rowAfter?.querySelector?.('td.col-entity') : null);
          if (cellAfter) setActiveCell(cellAfter, { scroll: false });
        }
        // チャンク分割再描画で一時的に高さが縮んでも表示位置が飛ばないよう復元する
        if (scroller && (scrollTop || scrollLeft)) {
          const restore = () => { scroller.scrollTop = scrollTop; scroller.scrollLeft = scrollLeft; };
          restore();
          requestAnimationFrame(() => { restore(); setTimeout(restore, 120); setTimeout(restore, 300); });
        }
      }
      if (typeof MeldexAutoLink !== 'undefined' && typeof MeldexAutoLink.scheduleIdle === 'function') {
        MeldexAutoLink.scheduleIdle();
      }
    } catch {}
  }, 0);
  return renderCtx;
}

function _dbScheduleEntityCreatePostSync(dbPath, createdItems, renderCtx) {
  const items = (createdItems || []).filter(item => item?.name && item?.path);
  if (!items.length) return;
  Promise.resolve().then(async () => {
    for (const item of items) {
      if (typeof _shouldRunFrontendAutoFillOnCreate === 'function' && !_shouldRunFrontendAutoFillOnCreate(item.response)) continue;
      if (typeof _autoFillOnCreate === 'function') {
        try { await _autoFillOnCreate(dbPath, item.path, {}); } catch {}
      }
    }
  }).then(() => _dbReloadAfterEntityCreate(renderCtx, dbPath, items.map(item => item.name))).catch(() => {});
}


async function _handleNewEntryClick(ctx) {
  const dbPath = ctx?.dbPath || (typeof state !== 'undefined' ? state.currentDbPath : '');
  if (!dbPath) return;
  const keepBottom = () => {
    const table = (typeof _currentPivotTable === 'function' ? _currentPivotTable(ctx) : null)
      || document.getElementById((ctx && ctx.tableId) || 'pivot-table')
      || document.querySelector('table.pivot-table');
    const row = table?.querySelector?.('tbody tr.new-entity-row');
    const scroller = row?.closest?.('#pivot-view, .pivot-view');
    if (scroller) scroller.scrollTop = scroller.scrollHeight;
  };
  const created = _dbCreateEntityOptimistic(ctx, dbPath, { baseName: '無題', skipRender: true });
  const renderCtx = _dbPlaceCreatedEntitiesInManualOrder(created.renderCtx || ctx, dbPath, [created.name], { position: 'append' }) || created.renderCtx;
  keepBottom();
  requestAnimationFrame(() => { keepBottom(); setTimeout(keepBottom, 120); setTimeout(keepBottom, 360); setTimeout(keepBottom, 900); });
  _dbKeepNewEntryRowVisible(renderCtx);
  try {
    const saved = await created.promise;
    // サーバーが仮名と異なる名前を付けた場合は、並び順・manualOrder を実際の名前へ揃える
    if (saved.name !== created.name) _dbRenameOptimisticEntityLocally(renderCtx, dbPath, created.name, saved.name);
    _dbScheduleEntityCreatePostSync(dbPath, [{ name: saved.name, path: saved.path, response: saved.response }], renderCtx);
  } catch (e) {
    // タイムアウト等でも実際は作成済みのことがある。撤去前に必ず確認する
    const recovered = await _dbRecoverEntityCreateAfterError(renderCtx, dbPath, created);
    if (recovered) {
      if (typeof showStatus === 'function') showStatus('エントリを追加しました');
    } else {
      _dbRemoveCreatedEntitiesLocally(renderCtx, dbPath, [created.name]);
      if (typeof showStatus === 'function') showStatus('エントリ作成に失敗: ' + (e?.message || e), true);
    }
  }
}

function _getEntityOrderSnapshot(ctx, dbPath, entitiesMap) {
  const order = [];
  const add = (name) => {
    if (name && !order.includes(name)) order.push(name);
  };
  (Array.isArray(ctx?._lastEntityNames) ? ctx._lastEntityNames : []).forEach(add);
  Object.keys(entitiesMap || {}).forEach(add);
  return order;
}

function _groupCollapseKey(ctx, groupKey) {
  const dbPath = ctx?.dbPath || state.currentDbPath || '';
  const tableId = ctx?.tableId || 'pivot-table';
  return dbPath + '::' + tableId + '::' + String(groupKey ?? '');
}

function _isGroupCollapsed(ctx, groupKey) {
  if (!window._groupCollapsed) window._groupCollapsed = {};
  return !!window._groupCollapsed[_groupCollapseKey(ctx, groupKey)];
}

function _toggleGroupCollapsed(ctx, groupKey) {
  if (!window._groupCollapsed) window._groupCollapsed = {};
  const key = _groupCollapseKey(ctx, groupKey);
  window._groupCollapsed[key] = !window._groupCollapsed[key];
}

// 既存エントリの above / below に新規行を挿入 (manualOrder を更新)
async function _handleInsertRowRelative(ctx, refEntityName, position, count) {
  const dbPath = ctx?.dbPath || (typeof state !== 'undefined' ? state.currentDbPath : '');
  if (!dbPath) return;
  count = Math.max(1, count || 1);
  const createdRecords = [];
  for (let n = 0; n < count; n++) {
    try {
      createdRecords.push(_dbCreateEntityOptimistic(ctx, dbPath, { baseName: '無題', skipRender: true }));
    } catch (e) {
      if (typeof showStatus === 'function') showStatus('エントリ作成に失敗: ' + (e?.message || e), true);
    }
  }
  const created = createdRecords.map(item => item.name);
  if (created.length === 0) return;
  const renderCtx = _dbPlaceCreatedEntitiesInManualOrder(ctx, dbPath, created, { refEntityName, position }) || ctx;
  const createdItems = [];
  const failed = [];
  for (const record of createdRecords) {
    try {
      const saved = await record.promise;
      if (saved.name !== record.name) _dbRenameOptimisticEntityLocally(renderCtx, dbPath, record.name, saved.name);
      createdItems.push({ name: saved.name, path: saved.path, response: saved.response });
    } catch (e) {
      // タイムアウト等でも作成済みのことがあるため、撤去前に確認する
      const recovered = await _dbRecoverEntityCreateAfterError(renderCtx, dbPath, record);
      if (recovered) createdItems.push({ name: recovered.name, path: recovered.path, response: null });
      else failed.push(record.name);
    }
  }
  if (failed.length) {
    _dbRemoveCreatedEntitiesLocally(renderCtx, dbPath, failed);
    if (typeof showStatus === 'function') showStatus('一部のエントリ作成に失敗しました', true);
  }
  _dbScheduleEntityCreatePostSync(dbPath, createdItems, renderCtx);
}

// リレーションリンク click → open / preview メニュー
function _handleRelationLinkClick(link, ctx) {
  const dbPath = ctx.dbPath;
  const entityName = link.textContent || '';
  if (!entityName) return;
  const relDbPath = link.dataset.dbPath || dbPath;
  const relPath = typeof _entityPath === 'function' ? _entityPath(relDbPath, entityName) : '';
  const sourcePaneId = link.closest('.gb-pane')?.dataset?.paneId || '';
  const menu = document.createElement('div');
  menu.className = 'gb-context-menu';
  const items = [
    // 互換テスト用: navigateToEntity(entityName, relDbPath)
    { label: 'リンク先を開く', icon: 'externalLink', action: () => navigateToEntity(entityName, relDbPath, ctx) },
    { label: 'フロートパネルで開く', icon: 'layers-2', action: () => {
      if (relPath && typeof openLinkInFloatPanel === 'function') openLinkInFloatPanel(relPath, entityName, { linkType: 'entity', sourcePaneId });
      // 互換テスト用: navigateToEntity(entityName, relDbPath)
      else navigateToEntity(entityName, relDbPath, ctx);
    } },
    { label: 'ビューワーでプレビュー', icon: 'tvMinimal', action: () => { if (typeof _updateLinkedPreview === 'function' && relPath) _updateLinkedPreview(relPath); } },
  ];
  if (relPath && typeof window.revealPathInFolderTree === 'function') {
    items.push({ label: 'フォルダツリーに表示', icon: 'folderTree', action: () => window.revealPathInFolderTree(relPath) });
  }
  items.forEach(it => {
    const mi = document.createElement('div');
    mi.className = 'gb-context-menu-item';
    mi.innerHTML = lucide(it.icon, 14) + ' ' + it.label;
    mi.addEventListener('click', () => { menu.remove(); it.action(); });
    menu.appendChild(mi);
  });
  const rect = link.getBoundingClientRect();
  const _z = parseFloat(document.documentElement.style.zoom) || 1;
  menu.style.left = (rect.left / _z) + 'px';
  menu.style.top = (rect.bottom / _z + 2) + 'px';
  document.body.appendChild(menu);
  if (typeof clampPopupToViewport === 'function') clampPopupToViewport(menu);
  setTimeout(() => {
    const closer = (ev) => { if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener('pointerdown', closer); } };
    document.addEventListener('pointerdown', closer);
  }, 0);
}

// チェックボックス click (Shift+クリック範囲選択)
// D-5: 選択状態は ctx._selectedEntities (Set) 経由で更新
function _emitRowSelectCheckboxChange(cb) {
  if (!cb) return;
  cb.dispatchEvent(new Event('input', { bubbles: true }));
  cb.dispatchEvent(new Event('change', { bubbles: true }));
}

function _syncRowSelectCheckboxState(cb, ctx) {
  if (!cb) return;
  const checked = !!cb.checked;
  cb.closest('tr')?.classList.toggle('row-selected', checked);
  const en = cb.dataset.entityName;
  const sel = typeof _ensureSelectedEntities === 'function' ? _ensureSelectedEntities(ctx) : ctx._selectedEntities;
  if (sel && en) {
    if (checked) sel.add(en);
    else sel.delete(en);
  }
}

function _handleCheckboxClick(e, cb, ctx) {
  const tbl = ctx.tableId || 'pivot-table';
  const paneRoot = _paneEl(ctx, '#' + tbl) || (!ctx ? document : null);
  if (!paneRoot) return;
  const allCbs = [...paneRoot.querySelectorAll('.row-select-cb')];
  const sel = typeof _ensureSelectedEntities === 'function' ? _ensureSelectedEntities(ctx) : ctx._selectedEntities;
  // Shift+クリック範囲選択: anchor は pointerdown 時に保存した _pendingShiftAnchor を優先
  // (change イベントが先に発火して _lastSelectedCb を上書きするブラウザ挙動への対策)
  const anchor = paneRoot._pendingShiftAnchor || paneRoot._lastSelectedCb;
  paneRoot._pendingShiftAnchor = null;
  if (e.shiftKey && anchor && anchor !== cb && anchor.isConnected) {
    const startIdx = allCbs.indexOf(anchor);
    const endIdx = allCbs.indexOf(cb);
    if (startIdx >= 0 && endIdx >= 0) {
      const [lo, hi] = startIdx < endIdx ? [startIdx, endIdx] : [endIdx, startIdx];
      const targetState = anchor.checked;
      for (let i = lo; i <= hi; i++) {
        const c2 = allCbs[i];
        c2.checked = targetState;
        c2.closest('tr')?.classList.toggle('row-selected', targetState);
        const en = c2.dataset.entityName;
        if (sel && en) { if (targetState) sel.add(en); else sel.delete(en); }
        if (c2 !== cb) _emitRowSelectCheckboxChange(c2);
      }
      // クリックされた cb もネイティブのトグルで反転している可能性があるので、targetState に揃える
      cb.checked = targetState;
      cb.closest('tr')?.classList.toggle('row-selected', targetState);
      const enClicked = cb.dataset.entityName;
      if (sel && enClicked) { if (targetState) sel.add(enClicked); else sel.delete(enClicked); }
      _emitRowSelectCheckboxChange(cb);
      _updateBulkEditBar(ctx);
      paneRoot._lastSelectedCb = cb;
      return;
    }
  }
  if (cb._rowSelectPointerdownHandled) {
    cb._rowSelectPointerdownHandled = false;
    paneRoot._lastSelectedCb = cb;
    return;
  }
  if (cb._rowSelectDirectClickHandled) {
    cb._rowSelectDirectClickHandled = false;
    paneRoot._lastSelectedCb = cb;
    return;
  }
  _syncRowSelectCheckboxState(cb, ctx);
  _emitRowSelectCheckboxChange(cb);
  _updateBulkEditBar(ctx);
  paneRoot._lastSelectedCb = cb;
}

// tbody click 委譲ハンドラ
async function _handleTbodyClick(e) {
  const tbody = e.currentTarget;
  const ctx = tbody._meldexCtx;
  if (!ctx) return;
  const target = e.target;
  const dbPath = ctx.dbPath;

  // 行合わせ後のリレーションステータス丸印は、非同期再描画後も確実に動くよう委譲する。
  const alignedRelationStatus = target.closest('.db-rollup-relation-status');
  if (alignedRelationStatus) {
    e.preventDefault();
    e.stopPropagation();
    if (typeof _dbOpenAlignedRelationStatusDropdown === 'function') {
      _dbOpenAlignedRelationStatusDropdown(alignedRelationStatus, ctx);
    }
    return;
  }

  // 1. グループヘッダー行 click → 折りたたみトグル
  const gtr = target.closest('tr.group-header-row');
  if (gtr) {
    const gKey = gtr.dataset.groupKey || '';
    _toggleGroupCollapsed(ctx, gKey);
    renderPivot(ctx);
    return;
  }

  // 2. 新規エントリ行 click → 新規作成 (col-entity セルのみ。空データセルはノーアクション)
  const newRow = target.closest('tr.new-entity-row');
  if (newRow) {
    if (target.closest('td.col-entity')) _handleNewEntryClick(ctx);
    return;
  }

  // 3. リレーションリンク
  const relLink = target.closest('.relation-link');
  if (relLink) {
    _handleRelationLinkClick(relLink, ctx);
    return;
  }

  // 4. エントリ行の more (⋯) ボタン
  const moreBtn = target.closest('.entity-row-more-btn');
  if (moreBtn) {
    const entityName = moreBtn.closest('tr')?.dataset?.entityName;
    if (entityName) showDbCardContextMenu(e, dbPath, entityName);
    return;
  }

  // 5. row-select-cb (Shift+クリック範囲選択)
  const cb = target.closest('.row-select-cb');
  if (cb) {
    _handleCheckboxClick(e, cb, ctx);
    return;
  }

  // 6. cell-add-btn (候補値追加)
  const addBtn = target.closest('.cell-add-btn');
  if (addBtn) {
    const td = addBtn.closest('td');
    const tr = addBtn.closest('tr');
    const entityName = tr?.dataset?.entityName;
    const propName = td?.dataset?.propName;
    if (entityName && propName) {
      startCellInlineAdd(td, _entityPath(dbPath, entityName), entityName, propName);
    }
    return;
  }

  // 7. db-action-btn (button型セル実行)
  const actionBtn = target.closest('.db-action-btn');
  if (actionBtn) {
    const tr = actionBtn.closest('tr');
    const td = actionBtn.closest('td');
    const entityName = tr?.dataset?.entityName;
    const propName = td?.dataset?.propName;
    if (entityName && propName) {
      const ptc = getPropertyTypes(dbPath)[propName];
      const renderedActions = Array.isArray(actionBtn._dbButtonActions) ? actionBtn._dbButtonActions : null;
      const actions = Array.isArray(ptc?.actions) && ptc.actions.length > 0
        ? ptc.actions
        : (renderedActions || []);
      try {
        actionBtn.disabled = true;
        await _executeButtonActions(dbPath, entityName, actions, ctx);
      } catch (err) {
        if (typeof showStatus === 'function') showStatus('ボタン実行失敗: ' + (err?.message || err), true);
      } finally {
        if (actionBtn.isConnected) actionBtn.disabled = false;
      }
    }
    return;
  }

  // 8. エントリ名セル (col-entity) click → 選択のみ (他セルと同じ操作体系。詳細パネルは開かない)
  const colEntityTd = target.closest('td.col-entity');
  if (colEntityTd && !colEntityTd.closest('tr.new-entity-row')) {
    if (typeof setActiveCell === 'function') setActiveCell(colEntityTd);
    return;
  }

  // 9. データセル click → 空セルなら inline 追加 / 値があればアクティブ化
  const td = target.closest('td');
  if (!td || !td.dataset?.propName) return;
  const isCellSelectionModifier = !!(e.shiftKey || e.ctrlKey || e.metaKey);

  const tr = td.closest('tr');
  const entityName = tr?.dataset?.entityName;
  const propName = td.dataset.propName;
  if (!entityName || !propName) return;
  if (isCellSelectionModifier && td._dbModifierPointerSelectionHandledUntil && td._dbModifierPointerSelectionHandledUntil > Date.now()) {
    e.preventDefault();
    return;
  }

  const propTypes = getPropertyTypes(dbPath);
  const rawPtc = propTypes[propName];
  const ptc = rawPtc?.type ? { ...rawPtc, type: String(rawPtc.type).replace(/_/g, '-') } : rawPtc;
  const opensInlineDropdown = ptc && ['select', 'multi-select', 'common-tags', 'relation', 'multi-relation', 'user', 'multi-user', 'link'].includes(ptc.type);
  // セル内の特殊要素は他で処理されている。候補選択型の値は通常クリックで候補を開き、Ctrl/Shift時はセル選択に回す。
  if (target.closest('.status-dot') || target.closest('.cell-checkbox') || target.closest('.chat-prop-cell')) return;
  if (target.closest('.cell-select-val')) {
    if (isCellSelectionModifier && typeof selectDbCellFromPointer === 'function') {
      selectDbCellFromPointer(td, e);
    } else if (opensInlineDropdown) {
      startCellInlineAdd(td, _entityPath(dbPath, entityName), entityName, propName);
    } else {
      setActiveCell(td);
    }
    return;
  }
  if (!isCellSelectionModifier && !opensInlineDropdown && (target.closest('.value-text') || target.closest('.value-url') || target.closest('.multi-select-tag'))) return;

  const entityData = ctx.pivotData?.entities?.[entityName];
  const rawValues = entityData?.[propName] || [];
  const values = filterValues(rawValues, undefined, ctx?.filter);

  if (isCellSelectionModifier && typeof selectDbCellFromPointer === 'function') {
    selectDbCellFromPointer(td, e);
  } else if (opensInlineDropdown) {
    startCellInlineAdd(td, _entityPath(dbPath, entityName), entityName, propName);
  } else if (values.length === 0 && !(ptc && (ptc.type === 'formula' || ptc.type === 'rollup' || ptc.type === 'button' || ptc.type === 'multi-source-relation' || ptc.type === 'chat'))) {
    startCellInlineAdd(td, _entityPath(dbPath, entityName), entityName, propName);
  } else {
    setActiveCell(td);
  }
}

// D-4-g: tbody pointerdown / pointerover (pointerenter 代替) 委譲ハンドラ
// pointerenter は非バブリングのため pointerover で代替する
function _handleTbodyPointerdown(e) {
  const tbody = e.currentTarget;
  const ctx = tbody._meldexCtx;
  if (!ctx) return;
  const target = e.target;
  const dataCell = target.closest('td[data-prop-name]');
  if (!e._dbCellPointerHandled && dataCell && !dataCell.closest('tr.new-entity-row') && !dataCell.closest('tr.group-header-row')) {
    const isCellControl = !!target.closest('.cell-add-btn,.status-dot,.cell-checkbox,.chat-prop-cell,.db-action-btn,.cell-inline-input,.cell-inline-select,.cell-inline-dd,.cell-date-editor');
    if (!isCellControl) {
      if ((e.shiftKey || e.ctrlKey || e.metaKey) && typeof selectDbCellFromPointer === 'function') {
        dataCell._dbModifierPointerSelectionHandledUntil = Date.now() + 300;
        selectDbCellFromPointer(dataCell, e);
      } else if (typeof setActiveCell === 'function') {
        setActiveCell(dataCell, { scroll: false });
      }
    }
  }
  const cb = e.target.closest('.row-select-cb');
  if (!cb) return;

  if (typeof _dbCloseTransientUiForCellRangeSelection === 'function') {
    _dbCloseTransientUiForCellRangeSelection();
  } else {
    document.querySelectorAll('.status-dropdown,.cell-inline-dd,.user-dropdown,.gb-context-menu').forEach(el => el.remove());
  }

  const tbl = ctx.tableId || 'pivot-table';
  const paneRoot = _paneEl(ctx, '#' + tbl) || (!ctx ? document : null);
  if (!paneRoot) return;

  // 行の HTML5 ドラッグを一時的に無効化 (cb 操作が行ドラッグを誤起動しないように)。
  // 通常行は専用ハンドルだけを draggable にしているため、解除時は true 固定ではなく元の値へ戻す。
  const tr = cb.closest('tr');
  if (tr) {
    const wasDraggable = tr.draggable;
    tr.draggable = false;
    const restore = () => {
      tr.draggable = wasDraggable;
      document.removeEventListener('pointerup', restore, true);
      document.removeEventListener('pointercancel', restore, true);
    };
    document.addEventListener('pointerup', restore, true);
    document.addEventListener('pointercancel', restore, true);
  }

  // 後続の click ネイティブトグル (cb.checked 反転) を一度だけ抑止
  const suppressClick = (ev) => { ev.preventDefault(); };
  cb.addEventListener('click', suppressClick, { once: true, capture: true });
  setTimeout(() => cb.removeEventListener('click', suppressClick, true), 500);

  e.stopPropagation();

  // ステイル anchor チェック
  const anchorCb = paneRoot._lastSelectedCb;
  const validAnchor = !!(anchorCb && anchorCb.isConnected);
  if (!validAnchor && anchorCb) paneRoot._lastSelectedCb = null;
  if (e.shiftKey && validAnchor && anchorCb !== cb) {
    // Shift+クリック範囲選択は click 委譲に任せる。
    // ただし change イベントが先に発火して _lastSelectedCb を上書きする可能性があるため、
    // anchor を _pendingShiftAnchor に保存しておき _handleCheckboxClick で使う。
    paneRoot._pendingShiftAnchor = anchorCb;
    return;
  }

  // 通常クリック / ドラッグ選択開始: 押下時即座にトグル
  const newState = !cb.checked;
  paneRoot._dragSelectState = { checked: newState };
  cb.checked = newState;
  tr?.classList.toggle('row-selected', newState);
  paneRoot._lastSelectedCb = cb;
  // D-5: Set 同期
  const enPd = cb.dataset.entityName;
  const selPd = typeof _ensureSelectedEntities === 'function' ? _ensureSelectedEntities(ctx) : ctx._selectedEntities;
  if (selPd && enPd) {
    if (newState) selPd.add(enPd);
    else selPd.delete(enPd);
  }
  cb._rowSelectPointerdownHandled = true;
  _emitRowSelectCheckboxChange(cb);
  _updateBulkEditBar(ctx);
}

function _handleTbodyPointerover(e) {
  const tbody = e.currentTarget;
  const ctx = tbody._meldexCtx;
  if (!ctx) return;
  const cb = e.target.closest('.row-select-cb');
  if (!cb) return;
  const tbl = ctx.tableId || 'pivot-table';
  const paneRoot = _paneEl(ctx, '#' + tbl) || (!ctx ? document : null);
  if (!paneRoot) return;
  if (!paneRoot._dragSelectState) return;
  if (cb.checked === paneRoot._dragSelectState.checked) return;
  const newState = !!paneRoot._dragSelectState.checked;
  cb.checked = newState;
  cb.closest('tr')?.classList.toggle('row-selected', newState);
  paneRoot._lastSelectedCb = cb;
  // D-5: Set 同期 (ドラッグ範囲選択)
  const enPo = cb.dataset.entityName;
  const selPo = typeof _ensureSelectedEntities === 'function' ? _ensureSelectedEntities(ctx) : ctx._selectedEntities;
  if (selPo && enPo) {
    if (newState) selPo.add(enPo);
    else selPo.delete(enPo);
  }
  _emitRowSelectCheckboxChange(cb);
  _updateBulkEditBar(ctx);
}

// D-4-e: tbody dragstart / dragend 委譲ハンドラ
// 注: 値チップ (.cell-value) のドラッグは createValueElement 内で stopPropagation
// するため tbody まで届かず影響を受けない。tr と nameSpan のみ委譲。
// 行先頭コントロール列（＋追加/ドラッグハンドル/選択チェックボックス）の分だけ、
// キーボードナビゲーション上の「実DOM列インデックス」の最小値が 1 になる（0列目は常に非対象）。
const DB_ROW_CONTROLS_COL_COUNT = 1;

// 行先頭コントロール列の幅。正は CSS 変数 --db-row-controls-w（gb-tools.part01.part01.css）で、
// タッチ環境では gb-sheet-mobile.css が上書きする。固定列の sticky left はこの幅を起点にするため、
// CSS と JS で必ず同じ値を使う（ズレると固定列だけ横にずれる）。
function _dbRowControlsWidth(tableEl) {
  if (tableEl && typeof getComputedStyle === 'function') {
    const w = parseFloat(getComputedStyle(tableEl).getPropertyValue('--db-row-controls-w'));
    if (Number.isFinite(w) && w > 0) return w;
  }
  return 56;
}

function _dbTableUsesManualSort(ctx) {
  const dbPath = ctx?.dbPath || state.currentDbPath || '';
  const sortConfig = typeof getDbSortConfig === 'function'
    ? getDbSortConfig(dbPath, { ctx })
    : getDbViewConfig(dbPath).sortConfig;
  return sortConfig?.key === 'manual';
}

function _dbTableWarnManualSortRequired() {
  if (typeof showStatus === 'function') {
    showStatus('行を並べ替えるには、並び替えを「マニュアル」にしてください。', true);
  }
}

function _dbPinnedColumnOffsets(renderedCols, pinnedCols, entityColumnPinned, savedWidths, entityWidth, rowControlsWidth) {
  const offsets = {};
  let left = Number.isFinite(rowControlsWidth) ? rowControlsWidth : 56;
  const pinnedState = typeof getPinnedColumnRangeState === 'function'
    ? getPinnedColumnRangeState(renderedCols, pinnedCols, entityColumnPinned)
    : { pinnedCols, entityColumnPinned };
  const effectivePinnedCols = Array.isArray(pinnedState.pinnedCols) ? pinnedState.pinnedCols : [];
  (Array.isArray(renderedCols) ? renderedCols : []).forEach(token => {
    const pinned = token === '__entity__'
      ? !!pinnedState.entityColumnPinned
      : effectivePinnedCols.includes(token);
    if (!pinned) return;
    offsets[token] = left;
    const rawWidth = token === '__entity__'
      ? entityWidth
      : ((savedWidths && savedWidths[token]) || 100);
    const numericWidth = Number(rawWidth);
    left += Number.isFinite(numericWidth) && numericWidth > 0
      ? numericWidth
      : (token === '__entity__' ? 120 : 100);
  });
  return offsets;
}

function _handleTbodyDragstart(e) {
  const tbody = e.currentTarget;
  const ctx = tbody._meldexCtx;
  if (!ctx) return;
  const target = e.target;
  if (target.closest('.row-add-btn, .entity-row-more-btn, .row-select-cb, button, input, select, textarea, [contenteditable="true"]')) {
    e.preventDefault();
    e.stopPropagation();
    return;
  }

  // 1. nameSpan ドラッグ → DB間 D&D (text/plain 単一名 + application/x-meldex-node)
  // 自身が複数選択中なら text/x-meldex-rows ペイロードも乗せて行並び替えにも使えるようにする
  const nameSpan = target.closest('.entity-name-label');
  if (nameSpan) {
    e.stopPropagation();
    const tr = nameSpan.closest('tr');
    const entityName = tr?.dataset?.entityName;
    if (!entityName) return;
    const ep = tr.dataset.meldexEntityPath || _entityPath(ctx.dbPath, entityName, ctx.pivotData);
    e.dataTransfer.effectAllowed = 'copyMove';
    const sel = ctx._selectedEntities;
    if (sel && sel.has(entityName) && sel.size > 1) {
      const payloadNames = [...sel];
      e.dataTransfer.setData('text/plain', payloadNames.join('\n'));
      e.dataTransfer.setData('text/x-meldex-rows', JSON.stringify(payloadNames));
      e.dataTransfer.setData('application/x-meldex-node', JSON.stringify({
        items: payloadNames.map(name => ({
          name,
          path: _entityPath(ctx.dbPath, name, ctx.pivotData),
          type: 'entity',
        })),
      }));
    } else {
      if (window.MeldexBoardTransfer?.setEntityDragData) {
        window.MeldexBoardTransfer.setEntityDragData(e.dataTransfer, ctx.dbPath, entityName, ep);
      } else {
        e.dataTransfer.setData('text/plain', entityName);
        e.dataTransfer.setData('application/x-meldex-node', JSON.stringify({
          name: entityName, path: ep, type: 'entity'
        }));
      }
    }
    nameSpan.classList.add('dragging');
    return;
  }

  // 2. 専用ハンドルからのドラッグ → 行並び替え (複数選択時は全行)
  // セル自体は draggable にしない。編集・選択操作と行並び替えを明確に分離する。
  const rowHandle = target.closest('.row-drag-handle');
  if (!rowHandle) return;
  const tr = target.closest('tr[data-entity-name]');
  if (tr) {
    const groupByProp = typeof getGroupBy === 'function' ? getGroupBy(ctx.dbPath, ctx) : '';
    if (!_dbTableUsesManualSort(ctx) && !groupByProp) {
      e.preventDefault();
      e.stopPropagation();
      _dbTableWarnManualSortRequired();
      return;
    }
    const entityName = tr.dataset.entityName;
    let payloadNames = [entityName];
    // D-5: 自分が選択中で複数選択されている場合は全選択中エントリを運ぶ
    const sel = ctx._selectedEntities;
    if (sel && sel.has(entityName) && sel.size > 1) {
      payloadNames = [...sel];
    }
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', payloadNames.join('\n'));
    e.dataTransfer.setData('text/x-meldex-rows', JSON.stringify(payloadNames));
    tr.style.opacity = '0.4';
  }
}

function _handleTbodyDragend(e) {
  const tbody = e.currentTarget;
  const ctx = tbody._meldexCtx;
  if (!ctx) return;
  _dbTableClearRowDropIndicator(tbody);
  const target = e.target;
  const nameSpan = target.closest('.entity-name-label');
  if (nameSpan) { nameSpan.classList.remove('dragging'); return; }
  const tr = target.closest('tr[data-entity-name]');
  if (tr) { tr.style.opacity = ''; }
}

// D-4-f: tbody dragover / dragleave / drop 委譲ハンドラ (エントリ行の並び替え)
function _dbTableHasInternalRowDrag(e) {
  const types = e?.dataTransfer?.types;
  if (!types) return false;
  return Array.from(types).includes('text/x-meldex-rows');
}

function _dbTableReadDraggedRows(e) {
  if (!_dbTableHasInternalRowDrag(e)) return [];
  const rowsJson = e.dataTransfer.getData('text/x-meldex-rows');
  if (!rowsJson) return [];
  try {
    const parsed = JSON.parse(rowsJson);
    return Array.isArray(parsed)
      ? parsed.filter(name => typeof name === 'string' && name.length > 0)
      : [];
  } catch {
    return [];
  }
}

function _dbTableClearRowDropIndicator(tbody) {
  if (!tbody?._lastDragoverTr) return;
  tbody._lastDragoverTr.classList.remove('db-row-drop-before', 'db-row-drop-after');
  tbody._lastDragoverTr = null;
}

function _dbTableSetRowDropIndicator(tbody, tr, position) {
  if (!tbody || !tr) return;
  if (tbody._lastDragoverTr && tbody._lastDragoverTr !== tr) {
    tbody._lastDragoverTr.classList.remove('db-row-drop-before', 'db-row-drop-after');
  }
  tr.classList.toggle('db-row-drop-before', position === 'before');
  tr.classList.toggle('db-row-drop-after', position === 'after');
  tbody._lastDragoverTr = tr;
}

function _handleTbodyDragover(e) {
  const tbody = e.currentTarget;
  if (!_dbTableHasInternalRowDrag(e)) return;
  const ctx = tbody._meldexCtx;
  if (!ctx) return;
  // 1. グループヘッダー行への dragover (グループ間 D&D)
  const gtr = e.target.closest('tr.group-header-row');
  if (gtr) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    gtr.classList.add('group-drop-target');
    if (tbody._lastDragoverGroup && tbody._lastDragoverGroup !== gtr) {
      tbody._lastDragoverGroup.classList.remove('group-drop-target');
    }
    tbody._lastDragoverGroup = gtr;
    return;
  }
  if (!_dbTableUsesManualSort(ctx)) return;
  const tr = e.target.closest('tr[data-entity-name]');
  if (!tr) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  const rect = tr.getBoundingClientRect();
  _dbTableSetRowDropIndicator(tbody, tr, e.clientY < rect.top + rect.height / 2 ? 'before' : 'after');
}

function _handleTbodyDragleave(e) {
  const tbody = e.currentTarget;
  // tbody から完全に離脱する場合のみクリア (子要素間の遷移は無視)
  if (e.relatedTarget && tbody.contains(e.relatedTarget)) return;
  _dbTableClearRowDropIndicator(tbody);
  if (tbody._lastDragoverGroup) {
    tbody._lastDragoverGroup.classList.remove('group-drop-target');
    tbody._lastDragoverGroup = null;
  }
}

// グループヘッダーへのドロップ: 各 dragged entity の groupBy プロパティ値を新グループ key に書き換える
function _dbTableCandidateSnapshot(val) {
  if (!val) return null;
  return {
    file: val.file || '',
    property: val.property || '',
    candidate_index: val.candidate_index,
    value: val.value || '',
    status: val.status || '採用',
    note: val.note || '',
    rich_html: val.rich_html || '',
  };
}

function _dbTableValueObjFromSnapshot(snapshot, propName) {
  return {
    file: snapshot.file,
    property: snapshot.property || propName,
    candidate_index: snapshot.candidate_index,
    value: snapshot.value,
    status: snapshot.status,
    note: snapshot.note,
    rich_html: snapshot.rich_html,
  };
}

async function _dbTableDeleteCandidateSnapshot(snapshot, propName) {
  if (!snapshot?.file) return;
  const valObj = _dbTableValueObjFromSnapshot(snapshot, propName);
  if (snapshot.candidate_index != null) await _apiPutValue(valObj, { _delete: true });
  else await apiPost('/outliner/delete', { path: snapshot.file });
}

async function _dbTablePostCandidateSnapshot(dbPath, entityName, propName, snapshot) {
  if (!snapshot) return null;
  const result = await _apiPostValue(
    _entityPath(dbPath, entityName),
    propName,
    snapshot.value,
    snapshot.status || '採用',
    snapshot.note || '',
    snapshot.rich_html || ''
  );
  return {
    ...snapshot,
    file: result?.path || snapshot.file,
    property: result?.property || propName,
    candidate_index: result?.candidate_index,
  };
}

async function _dbTableApplyGroupDropOp(dbPath, groupByProp, op, side) {
  if (op.kind === 'update') {
    const snapshot = side === 'before' ? op.before : op.after;
    await _apiPutValue(_dbTableValueObjFromSnapshot(snapshot, groupByProp), {
      new_value: snapshot.value,
      new_status: snapshot.status || '採用',
      new_note: snapshot.note || '',
      new_rich_html: snapshot.rich_html || '',
    });
    return;
  }
  if (op.kind === 'delete') {
    if (side === 'before') {
      op.current = await _dbTablePostCandidateSnapshot(dbPath, op.entityName, groupByProp, op.before);
    } else {
      await _dbTableDeleteCandidateSnapshot(op.current || op.before, groupByProp);
      op.current = null;
    }
    return;
  }
  if (op.kind === 'create') {
    if (side === 'before') {
      await _dbTableDeleteCandidateSnapshot(op.current || op.after, groupByProp);
      op.current = null;
    } else {
      op.current = await _dbTablePostCandidateSnapshot(dbPath, op.entityName, groupByProp, op.after);
    }
  }
}

function _dbTablePushGroupDropHistory(dbPath, groupByProp, ops, ctx, label) {
  if (!ops.length || typeof historyPush !== 'function') return;
  const scope = typeof _dbViewConfigHistoryScope === 'function'
    ? _dbViewConfigHistoryScope(dbPath)
    : 'db:' + String(dbPath || '').replace(/\\/g, '/');
  historyPush(label,
    async () => {
      for (let i = ops.length - 1; i >= 0; i -= 1) {
        await _dbTableApplyGroupDropOp(dbPath, groupByProp, ops[i], 'before');
      }
      await selectDatabase(dbPath, ctx, { silent: true });
    },
    async () => {
      for (const op of ops) await _dbTableApplyGroupDropOp(dbPath, groupByProp, op, 'after');
      await selectDatabase(dbPath, ctx, { silent: true });
    },
    scope
  );
}

async function _handleGroupDrop(ctx, draggedNames, newGroupKey) {
  const dbPath = ctx.dbPath;
  const groupByProp = getGroupBy(dbPath, ctx);
  if (!groupByProp) return;
  const lockMsg = typeof checkColumnEditable === 'function' ? checkColumnEditable(dbPath, groupByProp) : null;
  if (lockMsg) {
    showStatus(lockMsg, true);
    return;
  }
  const propTypes = getPropertyTypes(dbPath);
  const ptc = propTypes[groupByProp];
  if (!ptc) {
    showStatus('グループ列の型設定が見つかりません', true);
    return;
  }
  // formula / rollup / multi-source-relation はドロップ不可
  if (['formula', 'rollup', 'multi-source-relation'].includes(ptc.type)) {
    showStatus('この型はグループ間ドラッグ&ドロップに対応していません', true);
    return;
  }
  const entities = ctx.pivotData?.entities || {};
  const shouldClear = newGroupKey === '(未設定)' || newGroupKey === '';
  let updated = 0;
  const historyOps = [];
  for (const name of draggedNames) {
    const ed = entities[name];
    if (!ed) continue;
    const vals = Array.isArray(ed[groupByProp]) ? ed[groupByProp] : [];
    // 互換テスト用: const visibleVals = filterValues(vals);
    const visibleVals = filterValues(vals, null, ctx?.filter);
    const target = typeof getAdoptedValueForWrite === 'function'
      ? getAdoptedValueForWrite(vals)
      : (vals.find(v => v.status === '採用') || vals.find(v => v.status === '掲載済み') || null);
    try {
      if (shouldClear) {
        if (!target) continue;
        const before = _dbTableCandidateSnapshot(target);
        await _dbTableDeleteCandidateSnapshot(before, groupByProp);
        ed[groupByProp] = vals.filter(v => v !== target);
        historyOps.push({ kind: 'delete', entityName: name, before, current: null });
      } else if (target && target.file) {
        const before = _dbTableCandidateSnapshot(target);
        await _apiPutValue(target, { new_value: newGroupKey });
        target.value = newGroupKey;
        historyOps.push({
          kind: 'update',
          entityName: name,
          before,
          after: { ...before, value: newGroupKey },
        });
      } else {
        const ep = _entityPath(dbPath, name);
        const result = await _apiPostValue(ep, groupByProp, newGroupKey, '採用', '');
        const after = {
          file: result?.path || ep,
          property: result?.property || groupByProp,
          candidate_index: result?.candidate_index,
          value: newGroupKey,
          status: '採用',
          note: '',
          rich_html: '',
        };
        historyOps.push({ kind: 'create', entityName: name, after, current: after });
      }
      updated++;
    } catch (e) { /* error shown */ }
  }
  if (updated > 0) {
    _dbTablePushGroupDropHistory(
      dbPath,
      groupByProp,
      historyOps,
      ctx,
      `グループ移動: ${updated} 件 → ${shouldClear ? '(未設定)' : newGroupKey}`
    );
    showStatus(`グループを変更: ${updated} 件 → ${shouldClear ? '(未設定)' : newGroupKey}`);
    await selectDatabase(dbPath, ctx, { silent: true });
  }
}

function _handleTbodyDrop(e) {
  const tbody = e.currentTarget;
  const ctx = tbody._meldexCtx;
  if (!ctx) return;
  const draggedRows = _dbTableReadDraggedRows(e);
  if (draggedRows.length === 0) return;
  // 1. グループヘッダー行へのドロップ → グループ間 D&D
  const gtr = e.target.closest('tr.group-header-row');
  if (gtr) {
    e.preventDefault();
    gtr.classList.remove('group-drop-target');
    if (tbody._lastDragoverGroup) {
      tbody._lastDragoverGroup.classList.remove('group-drop-target');
      tbody._lastDragoverGroup = null;
    }
    const dn = draggedRows;
    if (dn.length === 0) return;
    const newGroupKey = gtr.dataset.groupKey || '';
    _handleGroupDrop(ctx, dn, newGroupKey);
    return;
  }
  if (!_dbTableUsesManualSort(ctx)) {
    e.preventDefault();
    _dbTableClearRowDropIndicator(tbody);
    _dbTableWarnManualSortRequired();
    return;
  }
  const tr = e.target.closest('tr[data-entity-name]');
  if (!tr) return;
  e.preventDefault();
  _dbTableClearRowDropIndicator(tbody);

  let draggedNames = draggedRows;
  const dropTargetEntity = tr.dataset.entityName;
  draggedNames = draggedNames.filter(n => n && n !== dropTargetEntity);
  if (draggedNames.length === 0) return;

  const dbPath = ctx.dbPath;
  const cfgBefore = getDbViewConfig(dbPath);
  const viewBefore = typeof _getCurrentDbViewConfigEntryFromConfig === 'function'
    ? _getCurrentDbViewConfigEntryFromConfig(cfgBefore, { ctx })
    : null;
  const beforeTarget = viewBefore || cfgBefore;
  const oldSortConfig = beforeTarget.sortConfig ? { ...beforeTarget.sortConfig } : null;
  const oldOrder = beforeTarget.manualOrder ? [...beforeTarget.manualOrder] : null;
  const cfg = cfgBefore;
  const view = typeof _getCurrentDbViewConfigEntryFromConfig === 'function'
    ? _getCurrentDbViewConfigEntryFromConfig(cfg, { ctx })
    : null;
  const target = view || cfg;
  if (!target.manualOrder) {
    target.manualOrder = _getEntityOrderSnapshot(ctx, dbPath, ctx.pivotData?.entities || {});
    if (target.manualOrder.length === 0) {
      target.manualOrder = [...tbody.querySelectorAll('tr[data-entity-name]')].map(t => t.dataset.entityName).filter(Boolean);
    }
  }
  const order = target.manualOrder;
  const draggedSet = new Set(draggedNames);
  const orderedDragged = [
    ...order.filter(n => draggedSet.has(n)),
    ...draggedNames.filter(n => !order.includes(n)),
  ];
  if (orderedDragged.length === 0) return;
  for (const n of orderedDragged) {
    const i = order.indexOf(n);
    if (i >= 0) order.splice(i, 1);
  }
  let toIdx = order.indexOf(dropTargetEntity);
  if (toIdx < 0) toIdx = order.length;
  const rect = tr.getBoundingClientRect();
  if (e.clientY >= rect.top + rect.height / 2) toIdx++;
  order.splice(toIdx, 0, ...orderedDragged);
  const newOrder = [...order];
  saveDbViewConfig(dbPath, cfg);
  renderPivot(ctx);
  _dbUndoManualOrder(dbPath, orderedDragged, oldOrder, oldSortConfig, newOrder, ctx);
}

// D-4-d: tbody contextmenu 委譲ハンドラ
function _handleTbodyContextmenu(e) {
  const tbody = e.currentTarget;
  const ctx = tbody._meldexCtx;
  if (!ctx) return;
  // 新規エントリ行・グループヘッダー行は対象外
  const tr = e.target.closest('tr');
  if (!tr) return;
  if (tr.classList.contains('new-entity-row') || tr.classList.contains('group-header-row')) return;
  const entityName = tr.dataset.entityName;
  if (!entityName) return;
  e.preventDefault();
  const td = e.target.closest('td[data-prop-name]');
  showDbCardContextMenu(e, ctx.dbPath, entityName, td?.dataset?.propName);
}

// D-4-c / D-5: tbody change 委譲ハンドラ (キーボード/Space 等のチェックボックス変更)
function _handleTbodyChange(e) {
  const tbody = e.currentTarget;
  const ctx = tbody._meldexCtx;
  if (!ctx) return;
  const cb = e.target.closest('.row-select-cb');
  if (!cb) return;
  const tbl = ctx.tableId || 'pivot-table';
  const paneRoot = _paneEl(ctx, '#' + tbl) || (!ctx ? document : null);
  if (!paneRoot) return;
  cb.closest('tr')?.classList.toggle('row-selected', cb.checked);
  paneRoot._lastSelectedCb = cb;
  // D-5: Set 同期
  const en = cb.dataset.entityName;
  const sel = typeof _ensureSelectedEntities === 'function' ? _ensureSelectedEntities(ctx) : ctx._selectedEntities;
  if (sel && en) {
    if (cb.checked) sel.add(en);
    else sel.delete(en);
  }
  _updateBulkEditBar(ctx);
}

// D-4-b: tbody dblclick 委譲ハンドラ
function _handleTbodyDblclick(e) {

  const tbody = e.currentTarget;
  const ctx = tbody._meldexCtx;
  if (!ctx) return;
  const target = e.target;
  // エントリ名セル (col-entity, new-entity-row 以外) の dblclick → インライン名称編集開始
  const colEntityTd = target.closest('td.col-entity');
  if (colEntityTd && !colEntityTd.closest('tr.new-entity-row')) {
    e.stopPropagation();
    const entityName = colEntityTd.closest('tr')?.dataset?.entityName;
    if (entityName && typeof startEntityInlineRename === 'function') {
      const nameSpan = colEntityTd.querySelector('.entity-name-label');
      startEntityInlineRename(colEntityTd, nameSpan, entityName, ctx.dbPath);
    }
    return;
  }
}

// tbody に全イベント委譲を 1 回だけ登録 (click / dblclick / change / contextmenu / drag / pointer)
function _installTbodyDelegation(tbody, ctx) {
  if (!tbody) return;
  tbody._meldexCtx = ctx;
  if (tbody._delegationInstalled) return;
  tbody.addEventListener('click', _handleTbodyClick);
  tbody.addEventListener('dblclick', _handleTbodyDblclick);
  tbody.addEventListener('change', _handleTbodyChange);
  tbody.addEventListener('contextmenu', _handleTbodyContextmenu);
  // 長押しでも同メニュー（タッチ/ペン）
  if (typeof addLongPressHandler === 'function') {
    addLongPressHandler(tbody, (ev) => {
      const tr = ev.target?.closest?.('tr');
      if (!tr) return;
      if (tr.classList.contains('new-entity-row') || tr.classList.contains('group-header-row')) return;
      const entityName = tr.dataset.entityName;
      if (!entityName) return;
      const c = tbody._meldexCtx;
      if (!c) return;
      const td = ev.target?.closest?.('td[data-prop-name]');
      showDbCardContextMenu(ev, c.dbPath, entityName, td?.dataset?.propName);
    });
  }
  tbody.addEventListener('dragstart', _handleTbodyDragstart);
  tbody.addEventListener('dragend', _handleTbodyDragend);
  tbody.addEventListener('dragover', _handleTbodyDragover);
  tbody.addEventListener('dragleave', _handleTbodyDragleave);
  tbody.addEventListener('drop', _handleTbodyDrop);
  tbody.addEventListener('pointerdown', _handleTbodyPointerdown);
  tbody.addEventListener('pointerover', _handleTbodyPointerover);
  tbody._delegationInstalled = true;
}

function renderGroupHeaderRow(groupKey, names, visibleProps, groupByProp, ctx) {
  const gtr = document.createElement('tr');
  gtr.className = 'group-header-row';
  gtr.dataset.groupKey = groupKey;
  gtr.setAttribute('role', 'row');
  const gtd = document.createElement('td');
  gtd.setAttribute('role', 'cell');
  gtd.setAttribute('aria-label', `${groupByProp}: ${groupKey}、${names.length} 件`);
  gtd.colSpan = visibleProps.length + 3;
  const collapsed = _isGroupCollapsed(ctx, groupKey);
  const groupColor = typeof getDbOptionColorForGroup === 'function'
    ? getDbOptionColorForGroup((ctx && ctx.dbPath) || (typeof state !== 'undefined' ? state.currentDbPath : ''), groupByProp, groupKey, ctx)
    : '';
  const dotHtml = typeof dbOptionColorDotHtmlForGroup === 'function'
    ? dbOptionColorDotHtmlForGroup((ctx && ctx.dbPath) || (typeof state !== 'undefined' ? state.currentDbPath : ''), groupByProp, groupKey, ctx)
    : '';
  gtd.innerHTML = `<span class="group-toggle ${collapsed ? 'collapsed' : ''}">\u25BC</span>${dotHtml}${esc(groupByProp)}: ${esc(groupKey)}<span class="group-count">${names.length} 件</span>`;
  gtr.appendChild(gtd);
  if (typeof applyDbOptionHeaderColor === 'function') applyDbOptionHeaderColor(gtr, groupColor);
  return gtr;
}

function _dbRollupAlignmentState(ctx) {
  if (!ctx) return null;
  const token = ctx._renderToken || null;
  if (!ctx._rollupAlignmentState || ctx._rollupAlignmentState.token !== token) {
    ctx._rollupAlignmentState = { token, rows: new Map() };
  }
  return ctx._rollupAlignmentState;
}

function _dbRollupLineElement(text, className) {
  const line = document.createElement('span');
  line.className = className;
  line.textContent = text == null || text === '' ? '' : String(text);
  return line;
}

function _dbRenderAlignedRollupCell(record, slotCounts) {
  const { host, result, visible } = record;
  host.innerHTML = '';
  host.className = 'db-cell-display-text db-rollup-lines';
  if (!visible) return;
  if (!result.groups.length) {
    host.appendChild(_dbRollupLineElement('—', 'db-rollup-line'));
    return;
  }
  result.groups.forEach((group, groupIndex) => {
    const count = slotCounts[groupIndex] || 1;
    for (let lineIndex = 0; lineIndex < count; lineIndex++) {
      const line = _dbRollupLineElement(group.values[lineIndex] || '', 'db-rollup-line');
      line.dataset.relationStatus = group.relationStatus || '採用';
      host.appendChild(line);
    }
  });
}

function _dbRelationAlignmentStatusTarget(relationCell, group) {
  const values = [...relationCell.querySelectorAll('.cell-values > .cell-value')];
  const candidateIndex = Number.isInteger(group?.relationCandidateIndex)
    ? group.relationCandidateIndex
    : 0;
  return values[candidateIndex]?.querySelector('.status-dot') || values[0]?.querySelector('.status-dot') || null;
}

function _dbRelationAlignmentLinkTarget(relationCell, groupIndex) {
  const links = [...relationCell.querySelectorAll('.relation-link')];
  const link = links[groupIndex] || links[0] || null;
  if (!link) return relationCell.querySelector('.multi-select-tags,.cell-value');
  return link.closest('.multi-select-tags') || link;
}

function _dbOpenAlignedRelationStatusDropdown(statusDot, ctx) {
  const relationCell = statusDot?.closest('td[data-prop-name]');
  if (!relationCell) return false;
  const candidateIndex = Number.parseInt(statusDot.dataset.relationCandidateIndex || '0', 10);
  const sourceStatusDot = _dbRelationAlignmentStatusTarget(relationCell, {
    relationCandidateIndex: Number.isInteger(candidateIndex) ? candidateIndex : 0,
  });
  const dropdownArgs = sourceStatusDot?._dbStatusDropdownArgs;
  if (dropdownArgs && typeof showStatusDropdown === 'function') {
    showStatusDropdown(
      statusDot,
      dropdownArgs.val,
      dropdownArgs.entityPath,
      dropdownArgs.propName
    );
    return true;
  }
  sourceStatusDot?.dispatchEvent(new MouseEvent('click', {
    bubbles: true,
    cancelable: true,
    view: window,
  }));
  return Boolean(sourceStatusDot);
}

function _dbRenderAlignedRelationCell(rowRecord, relationProp, groups, slotCounts, ctx) {
  const firstRollup = [...rowRecord.rollups.values()][0];
  const relationCell = [...(firstRollup?.td?.closest('tr')?.querySelectorAll('td[data-prop-name]') || [])]
    .find(cell => cell.dataset.propName === relationProp);
  if (!relationCell) return;
  const cellValues = relationCell.querySelector('.cell-values');
  if (!cellValues) return;

  cellValues.querySelector('.db-rollup-relation-lines')?.remove();
  [...cellValues.children].forEach(child => {
    if (child.classList?.contains('db-rollup-relation-lines')) return;
    if (child.classList?.contains('cell-add-btn')) {
      child.hidden = false;
      return;
    }
    child.hidden = true;
  });
  const aligned = document.createElement('div');
  aligned.className = 'db-rollup-relation-lines';
  if (!groups.length) {
    aligned.appendChild(_dbRollupLineElement('—', 'db-rollup-relation-line'));
  } else {
    groups.forEach((group, groupIndex) => {
      const count = slotCounts[groupIndex] || 1;
      for (let lineIndex = 0; lineIndex < count; lineIndex++) {
        const line = _dbRollupLineElement(group.relationName || group.relationId || '—', 'db-rollup-relation-line relation-link');
        line.dataset.dbPath = firstRollup.result.targetDbPath || '';
        line.dataset.entityId = group.relationId || '';
        line.dataset.entityName = group.relationName || group.relationId || '';
        line.dataset.relationStatus = group.relationStatus || '採用';
        const statusDot = document.createElement('span');
        statusDot.className = 'status-dot db-rollup-relation-status';
        statusDot.style.background = typeof _getStatusColor === 'function'
          ? _getStatusColor(group.relationStatus || '採用', ctx?.dbPath || '')
          : '';
        statusDot.title = group.relationStatus || '採用';
        statusDot.dataset.relationCandidateIndex = String(
          Number.isInteger(group.relationCandidateIndex) ? group.relationCandidateIndex : 0
        );
        line.prepend(statusDot);
        line.addEventListener('click', (event) => {
          if (event.target.closest('.db-rollup-relation-status')) return;
          event.stopPropagation();
          const target = _dbRelationAlignmentLinkTarget(relationCell, groupIndex);
          target?.dispatchEvent(new MouseEvent('click', {
            bubbles: true,
            cancelable: true,
            view: window,
          }));
        });
        line.addEventListener('dblclick', (event) => {
          event.preventDefault();
          event.stopPropagation();
          if (typeof navigateToEntity === 'function') {
            navigateToEntity(
              group.relationName || group.relationId,
              firstRollup.result.targetDbPath || '',
              ctx
            );
          }
        });
        aligned.appendChild(line);
      }
    });
  }
  cellValues.appendChild(aligned);
  relationCell.classList.add('db-rollup-aligned-relation');
}

function _dbUpdateRollupAlignment(ctx, entityName, relationProp) {
  const stateInfo = _dbRollupAlignmentState(ctx);
  const rowRecord = stateInfo?.rows.get(entityName + '\u0000' + relationProp);
  if (!rowRecord?.rollups.size) return;
  const results = [...rowRecord.rollups.values()].map(record => record.result);
  const reference = results.find(result => result.groups.length) || results[0];
  const groupCount = reference?.groups?.length || 0;
  const slotCounts = Array.from({ length: groupCount }, (_, groupIndex) => {
    return Math.max(
      1,
      ...results.map(result => result.groups[groupIndex]?.values?.length || 1)
    );
  });
  rowRecord.rollups.forEach(record => _dbRenderAlignedRollupCell(record, slotCounts));
  _dbRenderAlignedRelationCell(rowRecord, relationProp, reference?.groups || [], slotCounts, ctx);
}

function _dbRegisterRollupAlignment(ctx, entityName, propName, td, host, result, visible) {
  const stateInfo = _dbRollupAlignmentState(ctx);
  if (!stateInfo) return;
  const relationProp = result.relationProp || '';
  const key = entityName + '\u0000' + relationProp;
  let rowRecord = stateInfo.rows.get(key);
  if (!rowRecord) {
    rowRecord = { rollups: new Map() };
    stateInfo.rows.set(key, rowRecord);
  }
  rowRecord.rollups.set(propName, { td, host, result, visible });
  _dbUpdateRollupAlignment(ctx, entityName, relationProp);
}

function renderEntityCell(entityName, propName, ctx, options) {
  const { propTypes, entitiesMap, dbPath, advFilters, pinnedCols, savedWidths, thumbSize, selectedCols, cellDisplayByCol, cellImageThumbCount } = options;
  const entityData = entitiesMap[entityName];
  const td = document.createElement('td');
  td.dataset.propName = propName;
  td.dataset.dbColToken = propName;
  if (typeof _dbE2eId === 'function') {
    td.dataset.e2eId = _dbE2eId(ctx, 'cell', entityName, propName);
  }
  td.setAttribute('role', 'cell');
  td.tabIndex = -1;
  td.setAttribute('aria-label', `${entityName} / ${propName}`);
  if ((selectedCols || []).includes(propName)) td.classList.add('col-selected');
  if (typeof window !== 'undefined') window.MeldexComputedColumns?.applyCellStyle?.(td, dbPath, propName, ctx);
  // 列単位のセル折返し/切り詰め上書き（シート全体設定より優先。CSS側は td[data-cell-overflow] で特異度勝ち）。
  // cellDisplayByCol が未設定(null)の大多数のケースでは即座に何もせず抜ける。
  const colDisplay = typeof _dbColumnCellOverrideEntry === 'function' ? _dbColumnCellOverrideEntry(cellDisplayByCol, propName) : null;
  if (colDisplay) {
    td.dataset.cellOverflow = colDisplay.overflow;
    td.style.setProperty('--db-cell-wrap-lines', String(colDisplay.lines));
  }
  const rawValues = entityData && Object.prototype.hasOwnProperty.call(entityData, propName) && Array.isArray(entityData[propName])
    ? entityData[propName]
    : [];
  let values = filterValues(rawValues, undefined, ctx?.filter);
  if (advFilters.length > 0) values = applyAdvancedFilters(values, propName, advFilters);
  let colorValues = values;

  if (pinnedCols.includes(propName)) {
    td.classList.add('col-pinned');
    const pinnedLeft = options.pinnedOffsets?.[propName];
    if (Number.isFinite(pinnedLeft)) td.style.left = pinnedLeft + 'px';
  }

  td.addEventListener('pointerdown', (e) => {
    if (e.defaultPrevented) return;
    if (e._dbCellPointerHandled) return;
    if (e.target.closest('.cell-add-btn,.status-dot,.cell-checkbox,.chat-prop-cell,.db-action-btn,.cell-inline-input,.cell-inline-select,.cell-inline-dd,.cell-date-editor')) return;
    e._dbCellPointerHandled = true;
    if (e.shiftKey || e.ctrlKey || e.metaKey) {
      td._dbModifierPointerSelectionHandledUntil = Date.now() + 300;
      if (typeof selectDbCellFromPointer === 'function') selectDbCellFromPointer(td, e);
    } else if (typeof setActiveCell === 'function') {
      setActiveCell(td, { scroll: false });
    }
  }, { capture: true });

  const container = document.createElement('div');
  container.className = 'cell-values';

  const ptc = propTypes[propName];
  if (ptc && ptc.type === 'select') {
    td.addEventListener('click', (e) => {
      if (e.defaultPrevented) return;
      if (e.target.closest('.cell-select-val,.cell-add-btn,.status-dot,.cell-inline-input,.cell-inline-select,.cell-inline-dd,.cell-date-editor')) return;
      if (e.shiftKey || e.ctrlKey || e.metaKey) {
        if (typeof selectDbCellFromPointer === 'function') selectDbCellFromPointer(td, e);
        else if (typeof setActiveCell === 'function') setActiveCell(td, { scroll: false });
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      if (typeof setActiveCell === 'function') setActiveCell(td, { scroll: false });
      if (typeof startCellInlineAdd === 'function') {
        startCellInlineAdd(td, _entityPath(dbPath, entityName), entityName, propName);
      }
    });
  }

  // sourceプロパティ: フロントマターのメタデータを読み取り専用で表示
  if (ptc && ptc.source) {
    const metaKey = '_' + ptc.source;
    const metaVal = entityData[metaKey] ?? '';
    let sourceValues = [{ value: String(metaVal), status: '採用' }];
    if (advFilters.length > 0) sourceValues = applyAdvancedFilters(sourceValues, propName, advFilters);
    colorValues = sourceValues;
    const span = document.createElement('span');
    span.className = 'db-cell-display-text';
    span.style.cssText = 'font-size:13px;color:var(--fg2);';
    if (sourceValues.length === 0) {
      span.textContent = '';
    } else if ((ptc.source === 'created' || ptc.source === 'modified') && metaVal) {
      span.textContent = typeof _formatDateDisplay === 'function'
        ? _formatDateDisplay(metaVal, ptc)
        : metaVal.replace('T', ' ').substring(0, 16);
    } else if (ptc.source === 'modified_by' && metaVal) {
      span.innerHTML = (typeof _userAvatarSmall === 'function' ? _userAvatarSmall(metaVal) + ' ' : '') + esc(metaVal);
    } else {
      span.textContent = '—';
    }
    container.appendChild(span);
  }
  // ロールアップ型: リレーション先の集計値を非同期表示
  // 設定が未完了（リレーション列が未選択）のままここで値の表示へ落とすと、
  // 元のテキスト値がそのまま出てテキスト列と見分けが付かなくなるため、
  // 「まだ集計していない列」だと分かる表示にして値編集の見た目にはしない。
  else if (ptc && ptc.type === 'rollup' && (!ptc.relationProp || typeof calcRollupValue !== 'function')) {
    const span = document.createElement('span');
    span.className = 'db-cell-display-text db-cell-unconfigured';
    span.style.cssText = 'font-size:13px;color:var(--fg2);';
    span.textContent = '未設定';
    span.title = '列タイプの設定でリレーション列と参照先の列を指定してください';
    container.appendChild(span);
    colorValues = [];
  }
  else if (ptc && ptc.type === 'rollup') {
    const span = document.createElement('span');
    span.className = 'db-cell-display-text';
    span.style.cssText = 'font-size:13px;color:var(--fg2);';
    span.textContent = '...';
    container.appendChild(span);
    colorValues = [];
    const renderToken = ctx?._renderToken || null;
    calcRollupValue(entityName, entitiesMap, ptc, propTypes, dbPath, ctx?.filter).then(val => {
      if ((renderToken && ctx?._renderToken !== renderToken) || !td.isConnected) return;
      if (val?.kind === 'rollup-values') {
        let rollupValues = [{ value: val.text, status: '採用' }];
        if (advFilters.length > 0) rollupValues = applyAdvancedFilters(rollupValues, propName, advFilters);
        span.style.color = 'var(--fg)';
        _dbRegisterRollupAlignment(ctx, entityName, propName, td, span, val, rollupValues.length > 0);
        const cc = getCellColor(val.text, propName, dbPath, ctx);
        if (cc) { td.style.background = cc.bg; td.style.color = cc.fg; }
        return;
      }
      const displayValue = val === '-' ? '-' : String(val);
      let rollupValues = [{ value: displayValue, status: '採用' }];
      if (advFilters.length > 0) rollupValues = applyAdvancedFilters(rollupValues, propName, advFilters);
      if (rollupValues.length === 0) {
        span.textContent = '';
        return;
      }
      span.textContent = displayValue;
      span.style.color = 'var(--fg)';
      if (typeof _cellUiApplyAutoLinks === 'function'
          && _cellUiApplyAutoLinks(span, displayValue, _entityPath(dbPath, entityName))) {
        span.addEventListener('click', (e) => { if (typeof _cellUiHandleAutoLinkClick === 'function') _cellUiHandleAutoLinkClick(e); });
      }
      const cc = getCellColor(displayValue, propName, dbPath, ctx);
      if (cc) { td.style.background = cc.bg; td.style.color = cc.fg; }
    }).catch(() => {
      if ((renderToken && ctx?._renderToken !== renderToken) || !td.isConnected) return;
      span.textContent = '#ERR';
      span.style.color = 'var(--red)';
    });
  }
  // ボタン型: 値を持たず、常にボタンを表示 (click は tbody 委譲で処理)
  else if (ptc && ptc.type === 'button') {
    const btn = document.createElement('button');
    btn.className = 'db-action-btn';
    if (typeof _dbE2eId === 'function') {
      btn.dataset.e2eId = _dbE2eId(ctx, 'cell-button', entityName, propName);
    }
    btn._dbButtonActions = Array.isArray(ptc.actions) ? ptc.actions.map(action => ({ ...action })) : [];
    btn.textContent = ptc.label || '実行';
    container.appendChild(btn);
  }
  // マルチソースリレーション型
  else if (ptc && ptc.type === 'multi-source-relation') {
    const ep = _entityPath(dbPath, entityName);
    const val = values.length > 0 ? values[0] : { value: '', status: '採用' };
    container.appendChild(createTypedValueElement(val, ep, propName, thumbSize, ptc, { dbPath, ctx, filter: ctx?.filter }));
  }
  // チャット型
  else if (ptc && ptc.type === 'chat') {
    const ep = _entityPath(dbPath, entityName);
    const val = values.length > 0 ? values[0] : { value: '', status: '採用' };
    container.appendChild(createTypedValueElement(val, ep, propName, thumbSize, ptc, { dbPath, ctx, filter: ctx?.filter }));
  }
  // 画像型: 空セルでも D&D 用のプレースホルダを表示
  else if (ptc && ptc.type === 'image') {
    const ep = _entityPath(dbPath, entityName);
    const val = values.length > 0
      ? values[0]
      : { value: '', status: '採用', file: ep, property: propName, candidate_index: null };
    container.appendChild(createTypedValueElement(val, ep, propName, thumbSize, ptc, { dbPath, ctx, filter: ctx?.filter, imagePreviewCount: cellImageThumbCount }));
  }
  // チェックボックス型: 未設定セルも false として直接切り替え可能にする
  else if (ptc && ptc.type === 'checkbox') {
    const ep = _entityPath(dbPath, entityName);
    const val = values.length > 0
      ? values[0]
      : { value: 'false', status: '採用', file: ep, property: propName, candidate_index: null };
    colorValues = values.length > 0 ? values : [val];
    container.appendChild(createTypedValueElement(val, ep, propName, thumbSize, ptc, { dbPath, ctx, filter: ctx?.filter }));
  }
  // 数式型: 数式が未入力のうちはロールアップと同じく「未設定」を出す（下のコメント参照）
  else if (ptc && ptc.type === 'formula' && !ptc.formula) {
    const span = document.createElement('span');
    span.className = 'db-cell-display-text db-cell-unconfigured';
    span.style.cssText = 'font-size:13px;color:var(--fg2);';
    span.textContent = '未設定';
    span.title = '列タイプの設定で数式を入力してください';
    container.appendChild(span);
    colorValues = [];
  }
  // 数式型: 値ファイルではなく計算結果を表示
  else if (ptc && ptc.type === 'formula' && ptc.formula) {
    const result = formulaEvalForEntity(ptc.formula, entityData, { propTypes, dbPath });
    const span = document.createElement('span');
    span.className = 'db-cell-display-text';
    span.style.cssText = 'font-size:13px;color:var(--fg);';
    if (result.error) {
      span.style.color = 'var(--red)';
      span.textContent = '#ERROR';
      span.title = result.error;
    } else {
      const formulaValue = result.value === '' ? '' : String(result.value);
      let formulaValues = [{ value: formulaValue, status: '採用' }];
      if (advFilters.length > 0) formulaValues = applyAdvancedFilters(formulaValues, propName, advFilters);
      colorValues = formulaValues;
      span.textContent = formulaValues.length === 0 ? '' : formulaValue;
      if (formulaValues.length !== 0 && typeof _cellUiApplyAutoLinks === 'function'
          && _cellUiApplyAutoLinks(span, formulaValue, _entityPath(dbPath, entityName))) {
        span.addEventListener('click', (e) => { if (typeof _cellUiHandleAutoLinkClick === 'function') _cellUiHandleAutoLinkClick(e); });
      }
    }
    container.appendChild(span);
  } else {
    // 候補値が2つ以上あるセルは、ステータス機能OFFでも採用/案/ボツを区別できるよう
    // ステータスマークを自動表示する（ユーザー判断・案A 2026-07-25）。
    const _forceStatusDot = values.length > 1;
    values.forEach(val => {
      container.appendChild(
        ptc ? createTypedValueElement(val, _entityPath(dbPath, entityName), propName, thumbSize, ptc, { dbPath, ctx, filter: ctx?.filter, forceStatusDot: _forceStatusDot })
            : createValueElement(val, _entityPath(dbPath, entityName), propName, thumbSize, { dbPath, ctx, filter: ctx?.filter, forceStatusDot: _forceStatusDot })
      );
    });

    // 候補値追加は基本機能。ステータス機能OFFでも値のある列型では常に＋を出す
    // （ユーザー判断・案A 2026-07-25。従来の「OFF時は1セル1値」設計を反転）。
    // button/formula/rollup 等の非値型は上の分岐で処理されここには来ないが、防御的に除外する。
    const _nonValueTypes = ['button', 'formula', 'rollup', 'multi-source-relation', 'chat'];
    const _allowAdd = !ptc || !_nonValueTypes.includes(ptc.type);
    if (_allowAdd) {
      const addBtn = document.createElement('span');
      addBtn.className = 'cell-add-btn';
      addBtn.innerHTML = lucide('plus', 14);
      addBtn.title = ptc && ptc.type === 'select' ? '値を選択' : '候補値を追加';
      addBtn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
      });
      addBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        startCellInlineAdd(td, _entityPath(dbPath, entityName), entityName, propName);
      });
      container.appendChild(addBtn);
    }
  }

  if (typeof window !== 'undefined') window.MeldexComputedColumns?.decorateCell?.(td, container, dbPath, propName, entityData, ctx);
  td.appendChild(container);
  // 条件付きカラー
  const cellValues = colorValues.map(v => v.value).join(', ');
  const cc = getCellColor(cellValues, propName, dbPath, ctx);
  if (cc) { td.style.background = cc.bg; td.style.color = cc.fg; }

  // リンク型: サイドバーD&D（application/x-meldex-node）を受理する
  if (ptc && ptc.type === 'link' && typeof decorateDbLinkCellDrop === 'function') {
    decorateDbLinkCellDrop(td, entityName, propName, ctx, dbPath);
  }

  // click は tbody 委譲で処理 (空セル/アクティブセル切替は _handleTbodyClick 内)

  return td;
}

function renderEntityRow(entityName, ctx, options) {
  const { visibleProps, propTypes, entitiesMap, entityNames, dbPath, condFmt, thumbSize, savedWidths, advFilters, pinnedCols, selectedCols, _entityW, _tbl, _tblId, entityColumnPinned, cellDisplayByCol, renderedCols, pinnedOffsets, cellImageThumbCount } = options;
  const entityData = entitiesMap[entityName];
  const tr = document.createElement('tr');
  tr.dataset.entityName = entityName;
  tr.dataset.meldexEntityPath = _entityPath(dbPath, entityName, ctx?.pivotData || state.pivotData);
  tr.setAttribute('role', 'row');
  // 行並べ替えは専用ハンドルだけを draggable にして、セル選択・セル編集と競合させない。
  tr.draggable = false;

  if (condFmt) {
    const mainStatus = getEntityMainStatus(entityData);
    if (mainStatus === '掲載済み') tr.className = 'row-status-published';
    else if (mainStatus === '採用') tr.className = 'row-status-adopted';
    else if (mainStatus === '案') tr.className = 'row-status-draft';
    else if (mainStatus === 'ボツ') tr.className = 'row-status-rejected';
  }

  // 行先頭コントロール列（＋追加/ドラッグハンドル/選択チェックボックス）。
  // エントリ名列（col-entity）から独立した、常に先頭固定・並べ替え対象外の列。
  // 中身（addRowBtn/dragHandle/cb）は既存のまま下方で生成し、controlsMain へ追加する。
  const tdControls = document.createElement('td');
  tdControls.className = 'col-row-controls';
  tdControls.dataset.e2eId = _dbE2eId(ctx, 'row-controls-cell', entityName);
  tdControls.setAttribute('role', 'cell');
  const controlsMain = document.createElement('div');
  controlsMain.className = 'row-controls-main';
  tdControls.appendChild(controlsMain);
  tr.appendChild(tdControls);

  const tdName = document.createElement('td');
  tdName.className = 'col-entity';
  tdName.dataset.dbColToken = '__entity__';
  tdName.dataset.e2eId = _dbE2eId(ctx, 'entry-name-cell', entityName);
  tdName.setAttribute('role', 'rowheader');
  tdName.setAttribute('aria-label', `エントリ: ${entityName}`);
  if ((selectedCols || []).includes('__entity__')) tdName.classList.add('col-selected');
  tdName.style.width = _entityW + 'px';
  tdName.style.minWidth = _entityW + 'px';
  tdName.style.maxWidth = _entityW + 'px';
  // エントリ名列の折り返し/切り詰め上書き（__entity__ キー）。通常列と同じ仕組み。
  const _entityColDisplay = typeof _dbColumnCellOverrideEntry === 'function'
    ? _dbColumnCellOverrideEntry(cellDisplayByCol, '__entity__') : null;
  if (_entityColDisplay) {
    tdName.dataset.cellOverflow = _entityColDisplay.overflow;
    tdName.style.setProperty('--db-cell-wrap-lines', String(_entityColDisplay.lines));
  }

  const nameMain = document.createElement('div');
  nameMain.className = 'entity-name-cell-main';

  // ＋ボタン (エントリ追加: クリック=下に追加 / Alt+クリック=上に追加)
  const addRowBtn = document.createElement('span');
  addRowBtn.className = 'row-add-btn';
  addRowBtn.title = 'クリックで下にエントリを追加 / Alt+クリックで上に追加';
  addRowBtn.draggable = false;
  addRowBtn.tabIndex = 0;
  addRowBtn.setAttribute('role', 'button');
  addRowBtn.setAttribute('aria-label', 'エントリを追加');
  addRowBtn.dataset.e2eId = 'db-row-add-' + String(entityName || '').replace(/[^\w\u3040-\u30ff\u3400-\u9fff-]+/g, '-').slice(0, 60);
  addRowBtn.innerHTML = lucide('plus', 12);
  const triggerAddRow = (e) => {
    e.stopPropagation();
    e.preventDefault();
    const position = e.altKey ? 'above' : 'below';
    _handleInsertRowRelative(ctx, entityName, position);
  };
  addRowBtn.addEventListener('click', triggerAddRow);
  addRowBtn.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    triggerAddRow(e);
  });
  // 行そのものが draggable のため、追加ボタンから行ドラッグを開始させない。
  addRowBtn.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    e.preventDefault();
  });
  addRowBtn.addEventListener('mousedown', (e) => {
    e.stopPropagation();
    e.preventDefault();
  });
  addRowBtn.addEventListener('dragstart', (e) => {
    e.preventDefault();
    e.stopPropagation();
  });
  controlsMain.appendChild(addRowBtn);

  // 行ドラッグハンドル
  const dragHandle = document.createElement('span');
  dragHandle.className = 'row-drag-handle';
  dragHandle.draggable = true;
  dragHandle.title = _dbTableUsesManualSort(ctx)
    ? 'ドラッグして行を並べ替え'
    : '行を並べ替えるには、並び替えを「マニュアル」にしてください';
  dragHandle.dataset.e2eId = _dbE2eId(ctx, 'row-drag', entityName);
  dragHandle.setAttribute('role', 'button');
  dragHandle.setAttribute('aria-label', dragHandle.title);
  dragHandle.innerHTML = lucide('gripVertical', 12);
  dragHandle.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
  });
  controlsMain.appendChild(dragHandle);

  // 複数選択対応チェックボックス
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.className = 'row-select-cb';
  cb.dataset.entityName = entityName;
  cb.dataset.e2eId = `db-row-select-${entityName}`;
  cb.setAttribute('aria-label', `エントリ選択: ${entityName}`);
  // D-5: ctx の Set に含まれていれば checked 状態で生成 (render 跨ぎで選択維持)
  const isSelected = ctx && ctx._selectedEntities && ctx._selectedEntities.has(entityName);
  cb.checked = !!isSelected;
  if (isSelected) tr.classList.add('row-selected');
  cb.addEventListener('click', (e) => {
    if (e.shiftKey || cb._rowSelectPointerdownHandled) return;
    cb._rowSelectDirectClickHandled = true;
    if (typeof _syncRowSelectCheckboxState === 'function') _syncRowSelectCheckboxState(cb, ctx);
    if (typeof _emitRowSelectCheckboxChange === 'function') _emitRowSelectCheckboxChange(cb);
    if (typeof _updateBulkEditBar === 'function') _updateBulkEditBar(ctx);
  });
  // cb pointerdown / pointerover (pointerenter 代替) / Shift+click は tbody 委譲で処理
  controlsMain.appendChild(cb);

  const nameSpan = document.createElement('span');
  nameSpan.className = 'entity-name-label';
  nameSpan.textContent = entityName;
  nameSpan.style.paddingLeft = '4px';
  nameSpan.draggable = true;
  // nameSpan dragstart / dragend は tbody 委譲で処理
  tdName.style.cursor = 'pointer';
  // tdName click / dblclick は tbody 委譲で処理 (選択のみ / startEntityInlineRename)
  // 既定パネルで開くボタン。行自体が draggable なので、ボタン側でドラッグ起点を止める。
  const openBtn = document.createElement('span');
  openBtn.className = 'entity-row-open-btn';
  openBtn.title = '既定パネルで開く';
  openBtn.draggable = false;
  openBtn.innerHTML = lucide('externalLink', 14);
  openBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
  openBtn.addEventListener('mousedown', (e) => e.stopPropagation());
  openBtn.addEventListener('dragstart', (e) => {
    e.preventDefault();
    e.stopPropagation();
  });
  openBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const ep = typeof _entityPath === 'function' ? _entityPath(dbPath, entityName) : '';
    if (!ep) return;
    const cfg = typeof getDbViewConfig === 'function' ? getDbViewConfig(dbPath) : {};
    const target = cfg.defaultPanel || 'main';
    const sourcePaneId = e.target.closest('.gb-pane')?.dataset?.paneId || '';
    if (target === 'float') {
      if (typeof openLinkInFloatPanel === 'function') openLinkInFloatPanel(ep, entityName, { linkType: 'entity', sourcePaneId });
    } else if (target === 'sidebar') {
      // フロートパネル／サブパネル内でこの既定パネル設定が「右サイドバー」のままだと
      // 右サイドバー補助操作の制限に触れるため、呼び出し元要素を渡して判定させる
      // （計画書「右サイドバー操作の制限」節）。制限時は openLinkInRightPane 側が
      // 実行を中止し、短いステータス通知を出す。
      if (typeof openLinkInRightPane === 'function') openLinkInRightPane(ep, entityName, { linkType: 'entity', sourcePaneId, sourceEl: e.target });
    } else {
      if (typeof openLinkInMainPane === 'function') openLinkInMainPane(ep, entityName, { linkType: 'entity' });
    }
  });
  // 「...」ボタン。行自体が draggable なので、ボタン側でドラッグ起点を止める。
  const moreBtn = document.createElement('span');
  moreBtn.className = 'entity-row-more-btn';
  moreBtn.title = 'メニュー';
  moreBtn.draggable = false;
  moreBtn.innerHTML = lucide('moreHorizontal', 12);
  moreBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
  moreBtn.addEventListener('mousedown', (e) => e.stopPropagation());
  moreBtn.addEventListener('dragstart', (e) => {
    e.preventDefault();
    e.stopPropagation();
  });
  moreBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (typeof showDbCardContextMenu === 'function') showDbCardContextMenu(e, dbPath, entityName);
  });
  nameMain.appendChild(nameSpan);
  nameMain.appendChild(openBtn);
  nameMain.appendChild(moreBtn);
  tdName.appendChild(nameMain);

  // tr contextmenu は tbody 委譲 (_handleTbodyContextmenu) で処理

  // フェーズ2: エントリ名列（tdName）もプロパティ列と同じ並べ替え順序（renderedCols）に従って配置する。
  // renderedCols が無い場合（保存済み colOrder に '__entity__' が未含有の旧データ等）は先頭固定として扱う。
  const cols = Array.isArray(renderedCols) && renderedCols.length ? renderedCols : ['__entity__', ...visibleProps];
  const cellOpts = { propTypes, entitiesMap, dbPath, advFilters, pinnedCols, savedWidths, thumbSize, selectedCols, pinnedOffsets, cellDisplayByCol, cellImageThumbCount };
  cols.forEach(token => {
    if (token === '__entity__') {
      const entityLeft = pinnedOffsets?.__entity__;
      const entityShouldStick = entityColumnPinned && Number.isFinite(entityLeft);
      tdName.style.position = entityShouldStick ? 'sticky' : '';
      tdName.style.left = entityShouldStick ? entityLeft + 'px' : '';
      tr.appendChild(tdName);
      return;
    }
    tr.appendChild(renderEntityCell(entityName, token, ctx, cellOpts));
  });

  // ＋プロパティ列の空セル
  const tdAddCol = document.createElement('td');
  tdAddCol.className = 'col-add-prop-cell';
  tdAddCol.setAttribute('role', 'cell');
  tr.appendChild(tdAddCol);

  return tr;
}

function renderNewEntryRow(ctx, options) {
  const { visibleProps, selectedCols, _entityW, renderedCols, pinnedCols, pinnedOffsets } = options;
  const newTr = document.createElement('tr');
  newTr.className = 'new-entity-row';
  newTr.setAttribute('role', 'row');

  // 行先頭コントロール列（列数を揃えるための空セル。新規行自体に個別の＋/ハンドル/チェックボックスは無い）
  const tdControls = document.createElement('td');
  tdControls.className = 'col-row-controls';
  tdControls.setAttribute('role', 'cell');
  tdControls.setAttribute('aria-hidden', 'true');
  newTr.appendChild(tdControls);

  const tdName = document.createElement('td');
  tdName.className = 'col-entity';
  tdName.dataset.dbColToken = '__entity__';
  tdName.dataset.e2eId = _dbE2eId(ctx, 'entry-name-new');
  tdName.setAttribute('role', 'cell');
  tdName.setAttribute('aria-label', '新規エントリを追加');
  if ((selectedCols || []).includes('__entity__')) tdName.classList.add('col-selected');
  tdName.style.cssText = 'cursor:pointer;color:var(--fg2);width:' + _entityW + 'px;min-width:' + _entityW + 'px;';
  tdName.style.maxWidth = _entityW + 'px';
  tdName.innerHTML = `<span class="ico" style="margin-right:4px;">${lucide('plus',14)}</span><span>新規</span>`;
  // click は tbody 委譲 (_handleNewEntryClick) で処理

  // フェーズ2: エントリ名列も他の列と同じ並べ替え順序（renderedCols）で配置する
  const cols = Array.isArray(renderedCols) && renderedCols.length ? renderedCols : ['__entity__', ...visibleProps];
  cols.forEach(token => {
    if (token === '__entity__') {
      const entityLeft = pinnedOffsets?.__entity__;
      if (Number.isFinite(entityLeft)) {
        tdName.style.position = 'sticky';
        tdName.style.left = entityLeft + 'px';
      }
      newTr.appendChild(tdName);
      return;
    }
    const propName = token;
    const td = document.createElement('td');
    td.dataset.dbColToken = propName;
    td.setAttribute('role', 'cell');
    td.setAttribute('aria-label', `新規 / ${propName}`);
    if ((selectedCols || []).includes(propName)) td.classList.add('col-selected');
    if ((pinnedCols || []).includes(propName)) {
      td.classList.add('col-pinned');
      const pinnedLeft = pinnedOffsets?.[propName];
      if (Number.isFinite(pinnedLeft)) td.style.left = pinnedLeft + 'px';
    }
    newTr.appendChild(td);
  });
  // ＋プロパティ列の空セル
  const tdAddCol2 = document.createElement('td');
  tdAddCol2.className = 'col-add-prop-cell';
  tdAddCol2.setAttribute('role', 'cell');
  newTr.appendChild(tdAddCol2);

  return newTr;
}
function _applySelectedColumnClasses(ctx, dbPath) {
  const table = typeof _currentPivotTable === 'function'
    ? _currentPivotTable(ctx)
    : (!ctx ? document.getElementById('pivot-table') : null);
  if (!table) return;
  const selected = typeof _getSelectedColumns === 'function' ? _getSelectedColumns(dbPath) : [];
  table.querySelectorAll('th.col-selected, td.col-selected').forEach(el => el.classList.remove('col-selected'));
  if (selected.includes('__entity__')) {
    table.querySelector('thead th.col-entity-header')?.classList.add('col-selected');
    table.querySelectorAll('tbody td.col-entity, tfoot td.col-entity').forEach(td => td.classList.add('col-selected'));
  }
  selected.forEach(propName => {
    if (propName === '__entity__') return;
    const cssProp = (typeof CSS !== 'undefined' && typeof CSS.escape === 'function')
      ? CSS.escape(propName)
      : String(propName).replace(/["\\]/g, '\\$&');
    table.querySelectorAll(`thead th[data-prop="${cssProp}"], tbody td[data-prop-name="${cssProp}"], tfoot td[data-prop-name="${cssProp}"]`)
      .forEach(el => el.classList.add('col-selected'));
  });
}

function _setupDbColumnHeaderA11y(th, label) {
  if (!th) return;
  th.setAttribute('role', 'columnheader');
  th.setAttribute('scope', 'col');
  th.tabIndex = 0;
  th.setAttribute('aria-label', label || th.textContent?.trim() || '列');
}

// パスから決まる既定のエントリ名列ラベル（制作管理シートは固定名）
function _dbDefaultEntityColumnLabel(dbPath) {
  const parts = String(dbPath || '').replace(/\\/g, '/').replace(/\/+$/g, '').split('/').filter(Boolean);
  if (parts.length < 3 || parts[parts.length - 3] !== '制作管理' || parts[parts.length - 2] !== 'シート') {
    return 'エントリ名';
  }
  const sheetName = parts[parts.length - 1];
  if (sheetName === 'タスクリスト' || sheetName.startsWith('タスクリスト_')) return 'タスク名';
  return ({
    '作品リスト': '作品名',
    '作業対象リスト': '作業対象名',
    '作業内容リスト': '作業内容名',
    '作業規模リスト': '作業規模名',
    'スタッフリスト': 'スタッフ名',
  })[sheetName] || 'エントリ名';
}

// 表示用ラベル。制作管理以外のシートでは、ユーザーがビュー設定に保存した任意名を優先する。
function _dbEntityColumnDisplayLabel(dbPath, options) {
  const isProduction = typeof isProductionManagementSheetPath === 'function'
    && isProductionManagementSheetPath(dbPath);
  if (!isProduction && typeof getEntityColumnLabel === 'function') {
    const custom = getEntityColumnLabel(dbPath, options || {});
    if (custom) return custom;
  }
  return _dbDefaultEntityColumnLabel(dbPath);
}

function _dbDefaultEntityColumnWidth(dbPath) {
  // 幅の目安は既定ラベル基準（任意名を付けても既定の幅感を保つ）
  const label = _dbDefaultEntityColumnLabel(dbPath);
  return label === 'タスク名' ? 260 : (label === 'エントリ名' ? 120 : 180);
}

function _dbE2eToken(value) {
  return String(value == null ? '' : value)
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^\p{L}\p{N}_-]+/gu, '-')
    .replace(/^-+|-+$/g, '') || 'item';
}

function _dbE2eId(ctx, kind, ...parts) {
  const tableId = _dbE2eToken(ctx?.tableId || 'pivot-table');
  const suffix = parts.map(_dbE2eToken).join('-');
  return `db-${tableId}-${kind}${suffix ? '-' + suffix : ''}`;
}

function _setupDbColumnResizeHandleA11y(handle, th, colIndex, propName, dbPath, ctx) {
  if (!handle || !th) return;
  handle.tabIndex = 0;
  handle.setAttribute('role', 'separator');
  handle.setAttribute('aria-orientation', 'vertical');
  handle.setAttribute('aria-label', `${propName === '__entity__' ? _dbEntityColumnDisplayLabel(dbPath) : propName} 列幅を調整`);
  const applyWidth = (width) => {
    const nextWidth = Math.max(60, Math.round(width));
    th.style.width = nextWidth + 'px';
    th.style.minWidth = nextWidth + 'px';
    th.style.maxWidth = nextWidth + 'px';
    handle.setAttribute('aria-valuenow', String(nextWidth));
    const table = th.closest('table');
    if (table) {

      table.querySelectorAll('tbody tr, tfoot tr').forEach(tr => {
        const cell = tr.children[colIndex];
        if (cell) {
          cell.style.width = nextWidth + 'px';
          cell.style.minWidth = nextWidth + 'px';
          cell.style.maxWidth = nextWidth + 'px';
        }
      });
    } else if (typeof setColWidth === 'function') {
      setColWidth(colIndex, nextWidth);
    }
    if (dbPath && propName && typeof setColWidthPersist === 'function') {
      setColWidthPersist(dbPath, propName, nextWidth, {
        ctx,
        label: 'シート表示: 列幅',
        detail: propName,
      });
    }
    _dbReflowPinnedColumnOffsets(table);
  };
  const syncValue = () => {
    const width = Math.max(60, Math.round(th.offsetWidth || parseFloat(th.style.width) || 100));
    handle.setAttribute('aria-valuemin', '60');
    handle.setAttribute('aria-valuemax', '800');
    handle.setAttribute('aria-valuenow', String(width));
  };
  syncValue();
  handle.addEventListener('keydown', (e) => {
    if (e.isComposing || e.keyCode === 229) return;
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    e.stopPropagation();
    const current = Math.max(60, Math.round(th.offsetWidth || parseFloat(th.style.width) || 100));
    const step = e.shiftKey ? 40 : 8;
    applyWidth(current + (e.key === 'ArrowRight' ? step : -step));
  });
  handle.addEventListener('focus', syncValue);
}

function _dbReflowPinnedColumnOffsets(table) {
  if (!table) return;
  const headers = Array.from(table.querySelectorAll('thead th'));
  // 行先頭コントロール列（常時先頭固定）の分だけ、後続の固定列オフセットを右にずらす。
  const controlsHeader = headers.find(th => th.classList.contains('col-row-controls-header'));
  let left = controlsHeader
    ? Math.max(0, Math.round(controlsHeader.offsetWidth || parseFloat(controlsHeader.style.width) || 52))
    : 0;
  headers.forEach((th, colIndex) => {
    const isEntity = th.classList.contains('col-entity-header');
    const isEntityPinned = isEntity && th.style.position === 'sticky';
    const isPinned = th.classList.contains('col-pinned');
    if (isEntityPinned || isPinned) {
      th.style.left = left + 'px';
      table.querySelectorAll('tbody tr, tfoot tr').forEach(tr => {
        const cell = tr.children[colIndex];
        if (cell && (isEntityPinned || cell.classList.contains('col-pinned'))) {
          cell.style.left = left + 'px';
        }
      });
      left += Math.max(60, Math.round(th.offsetWidth || parseFloat(th.style.width) || 100));
    }
  });
  _dbAlignPinnedColumnSeams(table);
  _dbSchedulePinnedColumnSeamAlignment(table);
}

function _dbPinnedColumnCells(table, header, colIndex, isEntityPinned) {
  const cells = [header];
  table.querySelectorAll('tbody tr, tfoot tr').forEach(tr => {
    const cell = tr.children[colIndex];
    if (!cell) return;
    if (isEntityPinned ? cell.classList.contains('col-entity') : cell.classList.contains('col-pinned')) {
      cells.push(cell);
    }
  });
  return cells;
}

function _dbSetPinnedColumnShift(table, entry, shiftPx) {
  const transform = Math.abs(shiftPx) > 0.25 ? `translateX(${shiftPx}px)` : '';
  _dbPinnedColumnCells(table, entry.header, entry.colIndex, entry.isEntityPinned).forEach(cell => {
    cell.style.transform = transform;
  });
}

// 固定列の合計幅が狭いパネルを超えると、Chrome は末尾の sticky セルを
// スクロール領域の右端へ押し戻し、直前の固定列へ重ねてしまう。実際の描画座標を基準に
// 各固定列を順番に継ぎ目へ戻し、固定列の間から通常列が見える隙間・重なりを防ぐ。
function _dbAlignPinnedColumnSeams(table) {
  if (!table?.isConnected) return;
  const headers = Array.from(table.querySelectorAll('thead th'));
  const entries = headers.map((header, colIndex) => {
    const isEntity = header.classList.contains('col-entity-header');
    const isEntityPinned = isEntity && header.style.position === 'sticky';
    const isPinned = header.classList.contains('col-pinned');
    return (isEntityPinned || isPinned)
      ? { header, colIndex, isEntityPinned }
      : null;
  }).filter(Boolean);
  if (!entries.length) return;

  // 前回の補正を外した同一レイアウトから再計測する。ここから補正の再適用までは
  // 同じフレーム内なので、中間状態が画面へ描画されることはない。
  entries.forEach(entry => _dbSetPinnedColumnShift(table, entry, 0));
  let targetLeft = null;
  entries.forEach((entry, index) => {
    const rect = entry.header.getBoundingClientRect();
    // 先頭の固定列は既存の sticky left を基準にする。狭幅時には行コントロール列自体も
    // テーブル右端制約を受けるため、その描画位置を基準にすると固定列群全体が左へずれる。
    if (index === 0) {
      targetLeft = rect.right;
      return;
    }
    const scaleX = entry.header.offsetWidth > 0
      ? rect.width / entry.header.offsetWidth
      : 1;
    const shiftPx = (targetLeft - rect.left) / (Number.isFinite(scaleX) && scaleX > 0 ? scaleX : 1);
    _dbSetPinnedColumnShift(table, entry, shiftPx);
    targetLeft = entry.header.getBoundingClientRect().right;
  });
}

function _dbSchedulePinnedColumnSeamAlignment(table) {
  if (!table) return;
  if (table._dbPinnedSeamTimer) clearTimeout(table._dbPinnedSeamTimer);
  // scroll イベントが発火しない「同じ scrollLeft のままパネル幅だけ変わる」経路も拾う。
  table._dbPinnedSeamTimer = setTimeout(() => {
    table._dbPinnedSeamTimer = 0;
    _dbAlignPinnedColumnSeams(table);
  }, 32);
  if (table._dbPinnedSeamFrame) return;
  if (typeof requestAnimationFrame !== 'function') {
    _dbAlignPinnedColumnSeams(table);
    return;
  }
  table._dbPinnedSeamFrame = requestAnimationFrame(() => {
    _dbAlignPinnedColumnSeams(table);
    // scrollLeft 更新直後は sticky の右端制約が次の描画フレームで確定する場合がある。
    // 2フレーム目でも再計測し、狭幅・拡大表示時の末尾固定列の重なりを補正する。
    table._dbPinnedSeamFrame = requestAnimationFrame(() => {
      table._dbPinnedSeamFrame = 0;
      _dbAlignPinnedColumnSeams(table);
    });
  });
}

function _dbPinnedColumnScrollHost(table) {
  let node = table?.parentElement;
  while (node && node !== document.body) {
    const overflowX = typeof getComputedStyle === 'function'
      ? getComputedStyle(node).overflowX
      : '';
    if (/(auto|scroll|overlay)/.test(overflowX)) return node;
    node = node.parentElement;
  }
  return table?.parentElement || null;
}

function _dbDisconnectPinnedColumnTracking(table) {
  if (!table) return;
  table._dbPinnedWidthObserver?.disconnect?.();
  table._dbPinnedWidthObserver = null;
  table._dbPinnedHostMutationObserver?.disconnect?.();
  table._dbPinnedHostMutationObserver = null;
  if (table._dbPinnedScrollHost && table._dbPinnedScrollHandler) {
    table._dbPinnedScrollHost.removeEventListener('scroll', table._dbPinnedScrollHandler);
  }
  table._dbPinnedScrollHost = null;
  table._dbPinnedScrollHandler = null;
  if (table._dbPinnedSeamFrame && typeof cancelAnimationFrame === 'function') {
    cancelAnimationFrame(table._dbPinnedSeamFrame);
  }
  table._dbPinnedSeamFrame = 0;
  if (table._dbPinnedSeamTimer) clearTimeout(table._dbPinnedSeamTimer);
  table._dbPinnedSeamTimer = 0;
}

function _dbObservePinnedColumnWidths(table) {
  _dbDisconnectPinnedColumnTracking(table);
  if (!table || typeof ResizeObserver !== 'function') return;
  const observer = new ResizeObserver(() => _dbReflowPinnedColumnOffsets(table));
  table.querySelectorAll('thead th').forEach(header => observer.observe(header));
  const scrollHost = _dbPinnedColumnScrollHost(table);
  if (scrollHost) {
    observer.observe(scrollHost);
    const onScroll = () => _dbSchedulePinnedColumnSeamAlignment(table);
    scrollHost.addEventListener('scroll', onScroll, { passive: true });
    table._dbPinnedScrollHost = scrollHost;
    table._dbPinnedScrollHandler = onScroll;
    if (typeof MutationObserver === 'function') {
      const hostObserver = new MutationObserver(() => _dbSchedulePinnedColumnSeamAlignment(table));
      hostObserver.observe(scrollHost, {
        attributes: true,
        attributeFilter: ['class', 'style'],
      });
      table._dbPinnedHostMutationObserver = hostObserver;
    }
  }
  table._dbPinnedWidthObserver = observer;
  _dbSchedulePinnedColumnSeamAlignment(table);
}

// 表示責務（セル表示設定・自動列幅算出）は gb-db-table-display.js へ移設した。
// _dbClampInt / _dbCellDisplayConfig / setDbCellTextDisplay / showDbCellWrapMenu /
// _makeColumnWrapSubmenuItems / autoFitCurrentSheetColumns 等はそちらを参照。

function _dbSortedEntityNames(data, dbPath, ctx, options = {}) {
  const entitiesMap = data?.entities || {};
  const propTypes = options.propTypes || (typeof getPropertyTypes === 'function' ? getPropertyTypes(dbPath, ctx) : {});
  const advFilters = options.advFilters || (typeof getAdvancedFilters === 'function' ? getAdvancedFilters(dbPath, { ctx }) : []);
  const columnValueFilters = options.columnValueFilters
    || (typeof getColumnValueFilters === 'function' ? getColumnValueFilters(dbPath, { ctx }) : {});
  const filterMode = options.filterMode ?? ctx?.filter ?? (typeof state !== 'undefined' ? state.filter : undefined) ?? 'disabled';
  const sortCfg = (typeof getDbSortConfig === 'function' ? getDbSortConfig(dbPath, { ctx }) : getDbViewConfig(dbPath).sortConfig)
    || { key: 'name', dir: 'asc' };
  const manualOrder = typeof getDbManualOrder === 'function'
    ? getDbManualOrder(dbPath, { ctx })
    : getDbViewConfig(dbPath).manualOrder;
  let entityNames = Object.keys(entitiesMap);
  if (options.applyAdvancedFilters && Array.isArray(advFilters) && advFilters.length && typeof _dbEntityPassesAdvancedFilters === 'function') {
    entityNames = entityNames.filter(name => _dbEntityPassesAdvancedFilters(entitiesMap[name], advFilters, filterMode));
  }
  if (typeof _dbEntityPassesColumnValueFilters === 'function' && Object.keys(columnValueFilters || {}).length) {
    entityNames = entityNames.filter(name => _dbEntityPassesColumnValueFilters(
      name,
      entitiesMap[name],
      columnValueFilters,
      dbPath,
      ctx,
      filterMode,
    ));
  }
  if (sortCfg.key === 'manual') {
    const order = Array.isArray(manualOrder)
      ? manualOrder
      : (typeof _getEntityOrderSnapshot === 'function'
          ? _getEntityOrderSnapshot(ctx, dbPath, entitiesMap)
          : [...entityNames]);
    const sourceIndexes = new Map(entityNames.map((name, index) => [name, index]));
    entityNames.sort((a, b) => {
      const ia = order.indexOf(a), ib = order.indexOf(b);
      if (ia < 0 && ib < 0) return sourceIndexes.get(a) - sourceIndexes.get(b);
      if (ia < 0) return 1; if (ib < 0) return -1;
      return ia - ib;
    });
  } else if (sortCfg.key === 'name') {
    entityNames.sort((a, b) => sortCfg.dir === 'desc' ? b.localeCompare(a) : a.localeCompare(b));
  } else {
    const sortPtc = propTypes?.[sortCfg.key] || {};
    const sortType = sortPtc.type || 'text';
    const adoptedStr = (v) => {
      if (!Array.isArray(v)) return v == null ? '' : String(v);
      const picked = v.find(x => x && (x.status === '採用' || x.status === '掲載済み'))
                  || v.find(x => x && x.status === '案')
                  || v[0];
      return picked && picked.value != null ? String(picked.value) : '';
    };
    const sortValue = (entityName) => {
      if (sortPtc.source || sortPtc.type === 'formula') {
        return _dbTextForProp(entityName, sortCfg.key, data, propTypes, advFilters, dbPath, filterMode);
      }
      const entityData = entitiesMap[entityName] || {};
      const rawValues = Object.prototype.hasOwnProperty.call(entityData, sortCfg.key) && Array.isArray(entityData[sortCfg.key])
        ? entityData[sortCfg.key]
        : [];
      return adoptedStr(rawValues);
    };
    const toNum = (s) => { const n = parseFloat(s); return isNaN(n) ? null : n; };
    const toDate = (s) => { const t = Date.parse(s); return isNaN(t) ? null : t; };
    entityNames.sort((a, b) => {
      const sa = sortValue(a);
      const sb = sortValue(b);
      if (!sa && !sb) return 0;
      if (!sa) return 1;
      if (!sb) return -1;
      let cmp;
      if (sortType === 'number' || sortType === 'formula') {
        const na = toNum(sa), nb = toNum(sb);
        if (na != null && nb != null) cmp = na - nb;
        else if (na != null) cmp = -1;
        else if (nb != null) cmp = 1;
        else cmp = sa.localeCompare(sb);
      } else if (sortType === 'date') {
        const da = toDate(sa), db = toDate(sb);
        if (da != null && db != null) cmp = da - db;
        else if (da != null) cmp = -1;
        else if (db != null) cmp = 1;
        else cmp = sa.localeCompare(sb);
      } else {
        cmp = sa.localeCompare(sb);
      }
      return sortCfg.dir === 'desc' ? -cmp : cmp;
    });
  }
  return entityNames;
}

// リンク切れ（参照先シート欠落）を列見出しに示す警告アイコンを生成する。
// 色だけに頼らず三角形状＋aria-label で意味を担保（UI共通ルール準拠）。
// ホバー/フォーカス/長押しの説明は gb-tooltip が data-gb-tooltip / title を拾って表示する。
function _buildLinkWarnIcon(targetSheetName) {
  const icon = document.createElement('span');
  icon.className = 'th-linkwarn-icon';
  icon.style.cssText = 'margin-left:4px;flex-shrink:0;display:inline-flex;align-items:center;color:var(--orange);';
  icon.innerHTML = lucide('alertTriangle', 12);
  const msg = 'リンク切れ: 参照先シート『' + (targetSheetName || '') + '』が見つかりません';
  icon.title = msg;
  icon.dataset.gbTooltip = msg;
  icon.setAttribute('role', 'img');
  icon.setAttribute('aria-label', msg);
  return icon;
}

// リレーション列の参照先シートパスを解決する（relation / multi-relation 用）。
function _relationColumnTargetPath(dbPath, ptc) {
  if (!ptc) return '';
  return typeof _dbResolveRelationDbPath === 'function'
    ? _dbResolveRelationDbPath(dbPath, ptc)
    : ((ptc.relationDb === '' ? dbPath : ptc.relationDb) || '');
}

// リレーション列の「参照先シート欠落（リンク切れ）」を列見出しの警告アイコンで反映する。
// - 検出範囲: 参照先シートフォルダ自体が存在しない場合のみ（値の未解決 dangling は対象外）。
// - 冪等: 欠落なら .th-linkwarn-icon を追加、解消なら除去。再呼び出しで最新状態に揃える。
// - 通常シート・埋め込みシートとも同じ renderPivot 経由なので、この1関数で両対応。
function _syncRelationWarningIcons(ctx) {
  ctx = typeof _normalizeDbRenderContext === 'function' ? _normalizeDbRenderContext(ctx) : (ctx || (typeof _currentPaneState === 'function' ? _currentPaneState() : null));
  if (!ctx) return;
  const dbPath = ctx.dbPath || (typeof state !== 'undefined' ? state.currentDbPath : '');
  if (!dbPath) return;
  if (typeof _isRelationTargetMissing !== 'function' || typeof _paneEl !== 'function') return;
  const _tblId = ctx.tableId || 'pivot-table';
  const thead = _paneEl(ctx, '#' + _tblId + ' thead');
  if (!thead) return;
  // 見出しの装飾処理。renderPivot の行描画前に呼ばれるため、
  // 万一の例外で本体描画を止めないよう全体を try/catch で保護する。
  try {
  const propTypes = (typeof getPropertyTypes === 'function' ? getPropertyTypes(dbPath, ctx) : null) || {};
  const basename = (p) => String(p).split(/[\\/]/).filter(Boolean).pop() || String(p);
  thead.querySelectorAll('th[data-prop]').forEach(th => {
    const propName = th.dataset.prop;
    if (!propName || propName === '__entity__') return;
    const ptc = propTypes[propName];
    let targetName = '';
    if (ptc && (ptc.type === 'relation' || ptc.type === 'multi-relation')) {
      const target = _relationColumnTargetPath(dbPath, ptc);
      if (target && target !== dbPath && _isRelationTargetMissing(target)) targetName = basename(target);
    } else if (ptc && ptc.type === 'multi-source-relation') {
      // 複数ソースのうち欠落しているシートがあれば警告（欠落シート名を列挙）。
      const missNames = (ptc.sources || [])
        .map(src => src && src.db)
        .filter(sdb => sdb && sdb !== dbPath && _isRelationTargetMissing(sdb))
        .map(basename);
      if (missNames.length) targetName = missNames.join('・');
    }
    const existing = th.querySelector(':scope > .th-linkwarn-icon');
    if (targetName) {
      const msg = 'リンク切れ: 参照先シート『' + targetName + '』が見つかりません';
      if (existing) {
        if (existing.dataset.gbTooltip !== msg) {
          existing.title = msg; existing.dataset.gbTooltip = msg; existing.setAttribute('aria-label', msg);
        }
      } else {
        const icon = _buildLinkWarnIcon(targetName);
        const label = th.querySelector(':scope > .th-label');
        if (label && label.nextSibling) th.insertBefore(icon, label.nextSibling);
        else th.appendChild(icon);
      }
    } else if (existing) {
      existing.remove();
    }
  });
  } catch (e) {
    try { console.warn('[Meldex] リンク切れ警告アイコンの反映に失敗しました', e); } catch {}
  }
}

function renderPivot(ctx) {
  const renderPerfStartedAt = typeof _perfNowMs === 'function' ? _perfNowMs() : Date.now();
  ctx = typeof _normalizeDbRenderContext === 'function' ? _normalizeDbRenderContext(ctx) : (ctx || _currentPaneState());
  const data = ctx.pivotData || state.pivotData;
  if (!data || !data.properties || !data.entities) { clearPivot(ctx); return; }

  const dbPath = ctx.dbPath || state.currentDbPath;
  const filterMode = ctx.filter ?? state.filter ?? 'disabled';
  const hiddenCols = getHiddenCols(dbPath, { ctx });
  const configuredPinnedCols = getPinnedCols(dbPath, { ctx });
  const colOrder = getColOrder(dbPath, { ctx });
  const condFmt = getConditionalFormat(dbPath, { ctx });
  const thumbSize = getThumbnailSize(dbPath, { ctx });
  let savedWidths = getColWidths(dbPath, { ctx });
  const advFilters = getAdvancedFilters(dbPath, { ctx });
  const columnValueFilters = typeof getColumnValueFilters === 'function'
    ? getColumnValueFilters(dbPath, { ctx })
    : {};
  const propTypes = getPropertyTypes(dbPath, ctx);
  const groupByProp = getGroupBy(dbPath);

  // カラム順序適用（非表示カラムは除外）
  // colOrderにあるがdata.propertiesに無い空列も保持する
  let props = colOrder ? [...colOrder] : [...data.properties];
  // colOrder が過去の不整合で重複を含んでいた場合の防御
  props = [...new Set(props)];
  // colOrderに含まれない新規プロパティを末尾に追加
  data.properties.forEach(p => { if (!props.includes(p)) props.push(p); });
  // property_types に定義されているがデータに存在しないプロパティも追加（テンプレート適用直後等）
  if (propTypes) {
    Object.keys(propTypes).forEach(p => { if (!props.includes(p)) props.push(p); });
  }
  if (typeof filterDeletedDbProperties === 'function') props = filterDeletedDbProperties(dbPath, props);
  const visibleProps = props.filter(p => !hiddenCols.includes(p));

  // 列の描画順序（'__entity__' を含む）。フェーズ2でエントリ名列もD&D並べ替え対象化。
  // colOrder に '__entity__' が無い(=未保存/旧データ)場合は先頭補完し、従来の見た目を維持する。
  const entityOrderRaw = colOrder ? [...colOrder] : [];
  const renderedCols = entityOrderRaw.includes('__entity__')
    ? entityOrderRaw.filter(p => p === '__entity__' || visibleProps.includes(p))
    : [];
  if (!renderedCols.includes('__entity__')) renderedCols.unshift('__entity__');
  visibleProps.forEach(p => { if (!renderedCols.includes(p)) renderedCols.push(p); });
  // 固定列は現在の表示順における左端から固定終端までの連続範囲に正規化する。
  // 旧版の飛び飛び固定設定や列D&D後も、固定列間にスクロールする列を残さない。
  const configuredEntityColumnPinned = typeof getEntityColumnPinned === 'function'
    ? getEntityColumnPinned(dbPath, { ctx })
    : true;
  const pinnedRange = typeof getPinnedColumnRangeState === 'function'
    ? getPinnedColumnRangeState(renderedCols, configuredPinnedCols, configuredEntityColumnPinned)
    : {
      pinnedCols: configuredPinnedCols,
      entityColumnPinned: configuredEntityColumnPinned,
    };
  const pinnedCols = pinnedRange.pinnedCols;
  const entityColumnPinned = pinnedRange.entityColumnPinned;

  const entitiesMap = data.entities;
  const entityNames = _dbSortedEntityNames(data, dbPath, ctx, {
    propTypes,
    advFilters,
    columnValueFilters,
    filterMode,
    applyAdvancedFilters: true,
  });
  // データを持つビューで保存済み列幅が一つも無ければ、初回描画前に一度だけ自動調整して保存する
  // （利用者調整済みの列幅がある場合や空のビューでは何もしない。gb-db-table-display.js 参照）。
  if (typeof _dbMaybeAutoFitColumnsOnce === 'function') {
    const autoFitWidths = _dbMaybeAutoFitColumnsOnce(dbPath, ctx, {
      data, propTypes, visibleProps, entityNames, advFilters, savedWidths,
    });
    if (autoFitWidths) savedWidths = autoFitWidths;
  }
  // Step 2: チャンク分割中の D&D で manualOrder 初期化に使う (DOM 未完成時のフォールバック)
  ctx._lastEntityNames = entityNames;
  const renderRowLimit = _dbEffectiveRenderRowLimit(ctx, entityNames, visibleProps);
  const isRenderLimited = renderRowLimit > 0 && renderRowLimit < entityNames.length;
  const shownEntityCount = isRenderLimited ? renderRowLimit : entityNames.length;
  const selectedCols = _getSelectedColumns(dbPath);

  // エントリ0件でもテーブルを描画（＋新規エントリ行を表示するため）

  // テーブルセレクタヘルパー（スプリットビュー対応: ペインごとにテーブルIDが異なる）
  const _tblId = ctx.tableId || 'pivot-table';
  const _tbl = (sub) => '#' + _tblId + (sub ? ' ' + sub : '');
  const thead = _paneEl(ctx, _tbl('thead'));
  const tbody = _paneEl(ctx, _tbl('tbody'));
  if (!thead || !tbody) {
    if (typeof showStatus === 'function') showStatus('シート表示領域を準備できませんでした。シートを開き直してください。', true);
    return;
  }

  // 枠線設定の適用（DB個別）
  const gridCfg = getDbViewConfig(dbPath);
  const gridH = gridCfg.gridH || { width: '1px', color: '' };
  const gridV = gridCfg.gridV || { width: '1px', color: '' };
  // 列ごとのセル折返し/切り詰め上書き。未設定なら null にして renderEntityCell 側の per-td 処理を丸ごとスキップさせる。
  const currentViewDisplay = typeof getCurrentDbViewConfigEntry === 'function'
    ? getCurrentDbViewConfigEntry(dbPath, { ctx })
    : null;
  const currentViewCellDisplay = currentViewDisplay
    && Object.prototype.hasOwnProperty.call(currentViewDisplay, 'cellDisplayByCol')
    ? currentViewDisplay.cellDisplayByCol
    : gridCfg.cellDisplayByCol;
  const cellDisplayByCol = (currentViewCellDisplay
      && typeof currentViewCellDisplay === 'object'
      && Object.keys(currentViewCellDisplay).length)
    ? currentViewCellDisplay
    : null;
  // セル表示の画像サムネ数（保存ビュー単位。gb-db-table-display.js の getCellImageThumbCount 参照）。
  const cellImageThumbCount = typeof getCellImageThumbCount === 'function' ? getCellImageThumbCount(dbPath, { ctx }) : 3;
  const tblEl = _paneEl(ctx, _tbl());
  if (tblEl) {
    tblEl.classList.add('pivot-table');
    tblEl.setAttribute('role', 'table');
    tblEl.setAttribute('aria-label', 'シート');
    const hW = gridH.width === 'none' ? '0' : gridH.width;
    const vW = gridV.width === 'none' ? '0' : gridV.width;
    const hC = gridH.color || 'var(--db-grid-border)';
    const vC = gridV.color || 'var(--db-grid-border)';
    tblEl.style.setProperty('--db-grid-h', hW);
    tblEl.style.setProperty('--db-grid-v', vW);
    tblEl.style.setProperty('--db-grid-h-color', hC);
    tblEl.style.setProperty('--db-grid-v-color', vC);
    tblEl.classList.toggle('entity-col-unpinned', !entityColumnPinned);
    const cellDisplay = _dbCellDisplayConfig(dbPath, ctx);
    tblEl.dataset.cellOverflow = cellDisplay.overflow;
    tblEl.dataset.cellWrapLines = String(cellDisplay.lines);
    tblEl.style.setProperty('--db-cell-wrap-lines', String(cellDisplay.lines));
  }
  syncDbCellDisplayToolbar(dbPath, ctx);

  // ヘッダー
  const headerRow = document.createElement('tr');
  headerRow.setAttribute('role', 'row');

  // 行先頭コントロール列（＋追加/ドラッグハンドル/選択チェックボックス）。常に先頭固定・並べ替え対象外。
  // 幅は gb-tools.part01.part01.css の CSS 変数 --db-row-controls-w が正（タッチ環境では拡幅される）。
  const ROW_CONTROLS_WIDTH = typeof _dbRowControlsWidth === 'function' ? _dbRowControlsWidth(tblEl) : 56;
  const thControls = document.createElement('th');
  thControls.className = 'col-row-controls-header';
  thControls.dataset.e2eId = _dbE2eId(ctx, 'column-header', 'row-controls');
  thControls.setAttribute('role', 'columnheader');
  thControls.setAttribute('scope', 'col');
  thControls.setAttribute('aria-label', '行操作');
  headerRow.appendChild(thControls);

  // 列D&D並べ替え（エントリ名列・プロパティ列で共通）
  const _dbHandleColumnDrop = (fromName, targetToken, isLeft) => {
    if (!fromName || fromName === targetToken) return;
    const arr = renderedCols.filter(n => n !== fromName);
    const idx = arr.indexOf(targetToken);
    const insertIdx = idx >= 0 ? idx + (isLeft ? 0 : 1) : arr.length;
    arr.splice(insertIdx, 0, fromName);
    // hidden 列は元の colOrder の順序のまま末尾に保持
    const oldOrder = getColOrder(dbPath, { ctx }) || [];
    const hiddenInOrder = oldOrder.filter(n => hiddenCols.includes(n) && !arr.includes(n));
    setColOrder(dbPath, [...arr, ...hiddenInOrder], { ctx });
    renderPivot(ctx);
  };

  const entityColumnLabel = _dbEntityColumnDisplayLabel(dbPath);
  // エントリ名列の幅（永続化）
  const _entityW = (savedWidths['__entity__'] || _dbDefaultEntityColumnWidth(dbPath));

  const pinnedOffsets = typeof _dbPinnedColumnOffsets === 'function'
    ? _dbPinnedColumnOffsets(renderedCols, pinnedCols, entityColumnPinned, savedWidths, _entityW, ROW_CONTROLS_WIDTH)
    : {};
  renderedCols.forEach((token, idx) => {
    // 行先頭コントロール列の分だけ +1 した実DOM列インデックス（列幅リサイズ等で使用）
    const domColIndex = idx + 1;

    if (token === '__entity__') {
      const th0 = document.createElement('th');
      th0.className = 'col-entity-header';
      th0.dataset.dbColToken = '__entity__';
      th0.dataset.e2eId = _dbE2eId(ctx, 'column-header', 'entity');
      _setupDbColumnHeaderA11y(th0, entityColumnLabel);
      if (selectedCols.includes('__entity__')) th0.classList.add('col-selected');
      const entityLeft = pinnedOffsets.__entity__;
      const entityShouldStick = entityColumnPinned && Number.isFinite(entityLeft);
      th0.style.position = entityShouldStick ? 'sticky' : 'relative';
      th0.style.left = entityShouldStick ? entityLeft + 'px' : '';
      th0.style.zIndex = entityShouldStick ? '11' : '';
      th0.style.width = _entityW + 'px';
      th0.style.minWidth = _entityW + 'px';
      th0.style.maxWidth = _entityW + 'px';
      const th0Label = document.createElement('span');
      th0Label.className = 'th-label';
      th0Label.textContent = entityColumnLabel;
      th0.appendChild(th0Label);
      if (typeof isDbColumnFilterActive === 'function' && isDbColumnFilterActive(dbPath, '__entity__', ctx)) {
        th0.classList.add('col-filtered');
        const filterIcon = document.createElement('span');
        filterIcon.className = 'th-filter-icon';
        filterIcon.innerHTML = lucide('filter', 12);
        filterIcon.title = 'この列にフィルターが適用されています';
        filterIcon.setAttribute('aria-label', 'フィルター適用中');
        th0.appendChild(filterIcon);
      }
      const th0MoreBtn = document.createElement('span');
      th0MoreBtn.className = 'th-more-btn entity-th-more-btn';
      th0MoreBtn.innerHTML = lucide('moreHorizontal', 14);
      th0MoreBtn.title = '列メニュー';
      th0MoreBtn.setAttribute('aria-label', entityColumnLabel + '列メニュー');
      th0MoreBtn.style.cssText = 'position:absolute;right:14px;top:50%;transform:translateY(-50%);opacity:0;padding:2px 3px;border-radius:3px;cursor:pointer;background:var(--bg2);display:inline-flex;align-items:center;transition:opacity 0.1s;z-index:2;';
      th0MoreBtn.addEventListener('mouseenter', () => { th0MoreBtn.style.background = 'var(--bg4)'; });
      th0MoreBtn.addEventListener('mouseleave', () => { th0MoreBtn.style.background = 'var(--bg2)'; });
      th0MoreBtn.addEventListener('click', (e) => { e.stopPropagation(); showEntityColMenu(e, ctx, dbPath); });
      th0.appendChild(th0MoreBtn);
      th0.style.cursor = 'pointer';
      th0.addEventListener('mouseenter', () => { th0MoreBtn.style.opacity = '1'; });
      th0.addEventListener('mouseleave', () => { th0MoreBtn.style.opacity = '0'; });
      th0.addEventListener('contextmenu', (e) => { e.preventDefault(); showEntityColMenu(e, ctx, dbPath); });
      if (typeof addLongPressHandler === 'function') {
        addLongPressHandler(th0, (e) => showEntityColMenu(e, ctx, dbPath));
      }
      th0.addEventListener('click', (e) => {
        if (e.target.closest('.col-resize-handle, .th-more-btn')) return;
        e.stopPropagation();
        _setSelectedColumns(dbPath, ['__entity__'], '__entity__');
        _applySelectedColumnClasses(ctx, dbPath);
        if (typeof showDbPropertySettingsForColumn === 'function') {
          showDbPropertySettingsForColumn(dbPath, '__entity__');
        }
      });
      // リサイズハンドル
      const th0Handle = document.createElement('div');
      th0Handle.className = 'col-resize-handle';
      th0Handle.dataset.e2eId = _dbE2eId(ctx, 'column-resize', 'entity');
      _setupDbColumnResizeHandleA11y(th0Handle, th0, domColIndex, '__entity__', dbPath, ctx);
      th0Handle.addEventListener('pointerdown', (e) => startColResize(e, th0, domColIndex, '__entity__'));
      th0Handle.addEventListener('click', (e) => { e.stopPropagation(); });
      th0Handle.addEventListener('dblclick', (e) => { e.stopPropagation(); });
      th0.appendChild(th0Handle);
      // D&D 列並び替え（プロパティ列と同じ機構。他の列と同様に並べ替え可能）
      th0.draggable = true;
      th0.addEventListener('dragstart', (e) => {
        if (e.target.closest('.col-resize-handle, .th-more-btn')) { e.preventDefault(); return; }
        e.dataTransfer.setData('text/x-col-name', '__entity__');
        e.dataTransfer.effectAllowed = 'move';
        th0.classList.add('col-dragging');
      });
      th0.addEventListener('dragend', () => th0.classList.remove('col-dragging'));
      th0.addEventListener('dragover', (e) => {
        if (!e.dataTransfer.types.includes('text/x-col-name')) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        const rect = th0.getBoundingClientRect();
        const isLeftHalf = (e.clientX - rect.left) < rect.width / 2;
        th0.classList.toggle('col-drop-left', isLeftHalf);
        th0.classList.toggle('col-drop-right', !isLeftHalf);
      });
      th0.addEventListener('dragleave', () => { th0.classList.remove('col-drop-left', 'col-drop-right'); });
      th0.addEventListener('drop', (e) => {
        e.preventDefault();
        const fromName = e.dataTransfer.getData('text/x-col-name');
        const isLeftHalf = th0.classList.contains('col-drop-left');
        th0.classList.remove('col-drop-left', 'col-drop-right');
        _dbHandleColumnDrop(fromName, '__entity__', isLeftHalf);
      });
      headerRow.appendChild(th0);
      return;
    }

    const p = token;
    const th = document.createElement('th');
    const ptcHeader = propTypes[p];
    th.dataset.prop = p;
    th.dataset.dbColToken = p;
    th.dataset.e2eId = _dbE2eId(ctx, 'column-header', p);
    _setupDbColumnHeaderA11y(th, p);
    const w = savedWidths[p] || 100;
    th.style.width = w + 'px';
    th.style.minWidth = w + 'px';
    th.style.maxWidth = w + 'px';
    if (selectedCols.includes(p)) th.classList.add('col-selected');

    // ヘッダーラベル（タイプアイコン＋テキスト）
    const typeIcon = document.createElement('span');
    typeIcon.className = 'th-type-icon';
    typeIcon.style.cssText = 'opacity:0.8;margin-right:4px;';
    typeIcon.innerHTML = lucide(PROP_TYPE_ICON[ptcHeader?.type] || PROP_TYPE_ICON.text, 14);
    th.appendChild(typeIcon);
    const labelSpan = document.createElement('span');
    labelSpan.className = 'th-label';
    labelSpan.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
    labelSpan.textContent = p;
    th.appendChild(labelSpan);
    if (typeof isDbColumnFilterActive === 'function' && isDbColumnFilterActive(dbPath, p, ctx)) {
      th.classList.add('col-filtered');
      const filterIcon = document.createElement('span');
      filterIcon.className = 'th-filter-icon';
      filterIcon.innerHTML = lucide('filter', 12);
      filterIcon.title = 'この列にフィルターが適用されています';
      filterIcon.setAttribute('aria-label', 'フィルター適用中');
      th.appendChild(filterIcon);
    }

    // 列ロック / sourceインジケータ / 計算列インジケータ
    const _ptcHeader2 = propTypes[p];
    if (typeof window !== 'undefined' && window.MeldexComputedColumns?.attachHeaderIcon?.(th, dbPath, p, ctx)) {
      // 計算列（読み取り専用・コードが更新する列）: 鍵アイコンを付与済み
    } else if (_ptcHeader2 && _ptcHeader2.source) {
      const autoIcon = document.createElement('span');
      autoIcon.className = 'th-lock-icon';
      autoIcon.style.cssText = 'opacity:0.5;margin-left:4px;flex-shrink:0;';
      autoIcon.innerHTML = lucide('zap', 12);
      autoIcon.title = '自動入力（読み取り専用）';
      th.appendChild(autoIcon);
    } else {
      const _colLock = getColumnLock(dbPath, p);
      if (_colLock !== 'none') {
        const lockIcon = document.createElement('span');
        lockIcon.className = 'th-lock-icon';
        lockIcon.style.cssText = 'opacity:0.5;margin-left:4px;flex-shrink:0;';
        lockIcon.innerHTML = lucide(_colLock === 'locked' ? 'lock' : 'shield', 12);
        lockIcon.title = _colLock === 'locked' ? 'ロック' : '管理者のみ編集';
        th.appendChild(lockIcon);
      }
    }

    // ピン留め
    if (pinnedCols.includes(p)) {
      th.classList.add('col-pinned');
      const pinnedLeft = pinnedOffsets[p];
      if (Number.isFinite(pinnedLeft)) th.style.left = pinnedLeft + 'px';
    }

    // ホバー表示の「...」ボタン（メニュー起動）
    const moreBtn = document.createElement('span');
    moreBtn.className = 'th-more-btn';
    moreBtn.innerHTML = lucide('moreHorizontal', 14);
    moreBtn.title = '列メニュー';
    moreBtn.style.cssText = 'position:absolute;right:14px;top:50%;transform:translateY(-50%);opacity:0;padding:2px 3px;border-radius:3px;cursor:pointer;background:var(--bg2);display:inline-flex;align-items:center;transition:opacity 0.1s;z-index:2;';
    moreBtn.addEventListener('mouseenter', () => { moreBtn.style.background = 'var(--bg4)'; });
    moreBtn.addEventListener('mouseleave', () => { moreBtn.style.background = 'var(--bg2)'; });
    moreBtn.addEventListener('click', (e) => { e.stopPropagation(); showColHeaderMenu(e, p, domColIndex, ctx, dbPath); });
    th.appendChild(moreBtn);
    th.style.position = pinnedCols.includes(p) ? 'sticky' : 'relative';
    th.addEventListener('mouseenter', () => { moreBtn.style.opacity = '1'; });
    th.addEventListener('mouseleave', () => { moreBtn.style.opacity = '0'; });

    // リサイズハンドル
    const handle = document.createElement('div');
    handle.className = 'col-resize-handle';
    handle.dataset.e2eId = _dbE2eId(ctx, 'column-resize', p);
    _setupDbColumnResizeHandleA11y(handle, th, domColIndex, p, dbPath, ctx);
    handle.addEventListener('pointerdown', (e) => startColResize(e, th, domColIndex, p));
    handle.addEventListener('click', (e) => { e.stopPropagation(); });
    handle.addEventListener('dblclick', (e) => { e.stopPropagation(); });
    th.appendChild(handle);

    // D&D 列並び替え
    th.draggable = true;
    th.addEventListener('dragstart', (e) => {
      if (e.target.closest('.col-resize-handle, .th-more-btn, .th-rename-input')) { e.preventDefault(); return; }
      e.dataTransfer.setData('text/x-col-name', p);
      e.dataTransfer.effectAllowed = 'move';
      th.classList.add('col-dragging');
    });
    th.addEventListener('dragend', () => th.classList.remove('col-dragging'));
    th.addEventListener('dragover', (e) => {
      if (!e.dataTransfer.types.includes('text/x-col-name')) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const rect = th.getBoundingClientRect();
      const isLeft = (e.clientX - rect.left) < rect.width / 2;
      th.classList.toggle('col-drop-left', isLeft);
      th.classList.toggle('col-drop-right', !isLeft);
    });
    th.addEventListener('dragleave', () => { th.classList.remove('col-drop-left', 'col-drop-right'); });
    th.addEventListener('drop', (e) => {
      e.preventDefault();
      const fromName = e.dataTransfer.getData('text/x-col-name');
      const isLeft = th.classList.contains('col-drop-left');
      th.classList.remove('col-drop-left', 'col-drop-right');
      _dbHandleColumnDrop(fromName, p, isLeft);
    });

    // シングルクリック → プロパティメニュー（Notion風）
    th.addEventListener('click', (e) => {
      if (e.target.closest('.col-resize-handle')) return;
      if (th.querySelector('.th-rename-input')) return;
      let nextSelected;
      if (e.shiftKey || e.ctrlKey || e.metaKey) {
        const current = _getSelectedColumns(dbPath);
        if (e.shiftKey) {
          const anchor = _dbSelectedColumns.dbPath === dbPath ? _dbSelectedColumns.anchor : '';
          const startIdx = visibleProps.indexOf(anchor || p);
          const endIdx = visibleProps.indexOf(p);
          if (startIdx >= 0 && endIdx >= 0) {
            const [lo, hi] = startIdx < endIdx ? [startIdx, endIdx] : [endIdx, startIdx];
            nextSelected = visibleProps.slice(lo, hi + 1);
            _setSelectedColumns(dbPath, nextSelected, anchor || p);
          } else {
            nextSelected = [p];
            _setSelectedColumns(dbPath, nextSelected, p);
          }
        } else {
          nextSelected = current.includes(p) ? current.filter(name => name !== p) : [...current, p];
          _setSelectedColumns(dbPath, nextSelected, p);
        }
        _applySelectedColumnClasses(ctx, dbPath);
        if (typeof showDbPropertySettingsForColumn === 'function') {
          showDbPropertySettingsForColumn(dbPath, nextSelected.length === 1 ? nextSelected[0] : '', { switchTab: true });
        }
        return;
      }
      const currentSelected = _getSelectedColumns(dbPath);
      if (!currentSelected.includes(p) || currentSelected.length > 1 || currentSelected.includes('__entity__')) {
        nextSelected = [p];
        _setSelectedColumns(dbPath, nextSelected, p);
      }
      if (typeof showDbPropertySettingsForColumn === 'function') {
        showDbPropertySettingsForColumn(dbPath, p);
      }
      _applySelectedColumnClasses(ctx, dbPath);
    });

    // ダブルクリック → インラインリネーム
    th.addEventListener('dblclick', (e) => {
      if (e.target.closest('.col-resize-handle')) return;
      e.stopPropagation();
      closeColHeaderMenu();
      startHeaderInlineRename(th, p, dbPath, ctx);
    });

    // 右クリックメニュー ＋ 長押しで同メニュー（タッチ/ペン）
    th.addEventListener('contextmenu', (e) => { e.preventDefault(); showColHeaderMenu(e, p, domColIndex, ctx, dbPath); });
    if (typeof addLongPressHandler === 'function') {
      addLongPressHandler(th, (e) => showColHeaderMenu(e, p, domColIndex, ctx, dbPath));
    }
    headerRow.appendChild(th);
  });

  // ＋プロパティ追加列（ヘッダー末尾）
  const thAdd = document.createElement('th');
  thAdd.className = 'col-add-prop';
  thAdd.dataset.e2eId = _dbE2eId(ctx, 'column-add-prop');
  _setupDbColumnHeaderA11y(thAdd, '列を追加');
  thAdd.style.cssText = 'width:36px;min-width:36px;text-align:center;cursor:pointer;color:var(--fg2);padding:0;';
  thAdd.title = '列を追加';
  thAdd.innerHTML = lucide('plus', 16);
  // クリックで列タイプ選択ポップアップを表示する（「左/右に列を挿入」と同じ列タイプ一覧・
  // 同じ日時サブメニューを共有。選んだ型で末尾に列を追加）。
  thAdd.addEventListener('click', (e) => {
    e.stopPropagation();
    if (typeof closeColHeaderMenu === 'function') closeColHeaderMenu();
    if (typeof closeAllDropdowns === 'function') closeAllDropdowns(ctx || thAdd);
    const menu = document.createElement('div');
    menu.className = 'gb-context-menu';
    menu.dataset.e2eId = _dbE2eId(ctx, 'column-add-type-menu');
    const items = typeof _makeInsertColumnTypeChildren === 'function'
      ? _makeInsertColumnTypeChildren(null, 'after', ctx || dbPath)
      : [];
    if (typeof _renderColMenuItems === 'function') _renderColMenuItems(menu, items);
    document.body.appendChild(menu);
    if (typeof positionPopup === 'function') positionPopup(menu, thAdd.getBoundingClientRect());
    setTimeout(() => {
      const closer = (ev) => {
        const inAny = [...document.querySelectorAll('.gb-context-menu')].some(m => m.contains(ev.target));
        if (!inAny) {
          if (typeof closeColHeaderMenu === 'function') closeColHeaderMenu();
          else menu.remove();
          document.removeEventListener('pointerdown', closer);
        }
      };
      document.addEventListener('pointerdown', closer);
    }, 0);
  });

  thAdd.onmouseenter = () => { if (!thAdd.querySelector('input')) thAdd.style.color = 'var(--accent)'; };
  thAdd.onmouseleave = () => { if (!thAdd.querySelector('input')) thAdd.style.color = 'var(--fg2)'; };
  headerRow.appendChild(thAdd);

  thead.innerHTML = '';
  thead.appendChild(headerRow);

  // リンク切れ（参照先シート欠落）の列見出し警告アイコンを反映（既知欠落を即時、
  // 未判明分は先読み完了後に selectDatabase から再度この関数が呼ばれて反映される）。
  if (typeof _syncRelationWarningIcons === 'function') _syncRelationWarningIcons(ctx);

  // ボディ
  if (typeof _dbDisposeVirtualRows === 'function') {
    if (tblEl?._dbVirtualRows?.ctx && tblEl._dbVirtualRows.ctx !== ctx) _dbDisposeVirtualRows(tblEl._dbVirtualRows.ctx); _dbDisposeVirtualRows(ctx);
  }
  tbody.innerHTML = '';
  // D-4-a: tbody click 委譲を登録 (べき等。再 render 時は ctx だけ更新)
  _installTbodyDelegation(tbody, ctx);

  // グループ化処理
  let groupedEntities;
  if (groupByProp && visibleProps.includes(groupByProp)) {
    groupedEntities = new Map();
    const groupPtc = propTypes[groupByProp];
    entityNames.forEach(en => {
      let groupKey;
      if (groupPtc && groupPtc.type === 'formula' && groupPtc.formula) {
        const result = formulaEvalForEntity(groupPtc.formula, entitiesMap[en], { propTypes, dbPath });
        groupKey = result.error ? '#ERROR' : (result.value === '' ? '(未設定)' : String(result.value));
      } else {
        const entityData = entitiesMap[en] || {};
        const rawVals = Object.prototype.hasOwnProperty.call(entityData, groupByProp) && Array.isArray(entityData[groupByProp])
          ? entityData[groupByProp]
          : [];
        const vals = filterValues(rawVals, undefined, filterMode);
        const firstValue = vals.length > 0 ? vals[0].value : '';
        groupKey = firstValue === '' || firstValue == null ? '(未設定)' : String(firstValue);
      }
      if (!groupedEntities.has(groupKey)) groupedEntities.set(groupKey, []);
      groupedEntities.get(groupKey).push(en);
    });
  } else {
    groupedEntities = new Map([['', entityNames]]);
  }

  // 折りたたみ状態
  if (!window._groupCollapsed) window._groupCollapsed = {};

  const entityRowOpts = {
    visibleProps, propTypes, entitiesMap, entityNames,
    dbPath, condFmt, thumbSize, savedWidths, advFilters, pinnedCols,
    selectedCols, _entityW, _tbl, _tblId, entityColumnPinned,
    cellDisplayByCol, renderedCols, pinnedOffsets, cellImageThumbCount,
  };

  // 行生成タスクをフラット化 (グループヘッダー + エントリ行を順序通りに並べる)
  // チャンク分割レンダリングで使用 (Step2)
  const rowTasks = [];
  let pushedEntityRows = 0;
  groupedEntities.forEach((names, groupKey) => {
    if (isRenderLimited && pushedEntityRows >= renderRowLimit) return;
    if (groupKey !== '') {
      rowTasks.push({ kind: 'group', groupKey, names });
      if (_isGroupCollapsed(ctx, groupKey)) return;
    }
    for (const entityName of names) {
      if (isRenderLimited && pushedEntityRows >= renderRowLimit) break;
      rowTasks.push({ kind: 'entity', entityName });
      pushedEntityRows++;
    }
  });

  const paneRoot = _paneEl(ctx, _tbl()) || (!ctx ? document : null);
  if (!paneRoot) return;
  if (ctx?._dragSelectPointerUp) {
    document.removeEventListener('pointerup', ctx._dragSelectPointerUp);
    document.removeEventListener('pointercancel', ctx._dragSelectPointerUp);
  }
  if (paneRoot._dragSelectPointerUp) document.removeEventListener('pointerup', paneRoot._dragSelectPointerUp);
  if (paneRoot._dragSelectPointerUp) document.removeEventListener('pointercancel', paneRoot._dragSelectPointerUp);
  paneRoot._dragSelectPointerUp = () => {
    paneRoot._dragSelectState = null;
    if (ctx) ctx._dragSelectState = null;
  };
  if (ctx) ctx._dragSelectPointerUp = paneRoot._dragSelectPointerUp;
  document.addEventListener('pointerup', paneRoot._dragSelectPointerUp);
  document.addEventListener('pointercancel', paneRoot._dragSelectPointerUp);

  // 常に末尾に「＋新規エントリ」行を表示（Notion風）
  // 大規模シートも初期状態から全件スクロール可能にし、実DOMは仮想スクロールで画面周辺だけ作る。
  const renderMoreRow = null;
  const newEntryRow = renderNewEntryRow(ctx, {
    visibleProps,
    selectedCols,
    _entityW,
    renderedCols,
    pinnedCols,
    pinnedOffsets,
  });
  tbody.appendChild(newEntryRow);
  const newEntrySpacerRow = document.createElement('tr');
  newEntrySpacerRow.className = 'new-entity-spacer-row';
  newEntrySpacerRow.setAttribute('aria-hidden', 'true');
  newEntrySpacerRow.setAttribute('role', 'presentation');
  const newEntrySpacerCell = document.createElement('td');
  newEntrySpacerCell.colSpan = visibleProps.length + 3;
  newEntrySpacerRow.appendChild(newEntrySpacerCell);
  tbody.appendChild(newEntrySpacerRow);

  // フッター集計行 (entityNames は確定済みなので即時計算)
  renderPivotFooter(visibleProps, entitiesMap, entityNames, pinnedCols, savedWidths, propTypes, ctx, {
    renderedCols,
    entityColumnPinned,
    pinnedOffsets,
    entityWidth: _entityW,
  });
  if (tblEl && typeof _dbReflowPinnedColumnOffsets === 'function') {
    requestAnimationFrame(() => {
      if (tblEl.isConnected) _dbReflowPinnedColumnOffsets(tblEl);
    });
    if (typeof _dbObservePinnedColumnWidths === 'function') _dbObservePinnedColumnWidths(tblEl);
  }

  const countEl = _paneEl(ctx, '#sb-count') || (!ctx ? document.getElementById('sb-count') : null);
  if (countEl) countEl.textContent = isRenderLimited
    ? entityNames.length + ' 件 (' + shownEntityCount + '件表示)'
    : entityNames.length + ' 件';

  // ----- Step 2: チャンク分割レンダリング -----
  // 中断トークン: ctx._renderToken に Symbol を割り振る。
  // 後続の renderPivot 呼び出し / destroyPaneContext 等で _renderToken が変わると進行中チャンクは破棄される。
  const renderToken = Symbol('renderPivot');
  ctx._renderToken = renderToken;
  ctx._renderInProgress = true;
  ctx._renderTotalRows = rowTasks.length;
  ctx._renderDoneRows = 0;

  const virtualRowsEnabled = typeof _dbShouldUseVirtualRows === 'function' && _dbShouldUseVirtualRows(ctx, rowTasks, { visibleProps, propTypes, thumbSize });
  if (virtualRowsEnabled && typeof _dbRunVirtualRowRenderer === 'function'
      && _dbRunVirtualRowRenderer(ctx, { rowTasks, tbody, renderToken, renderMoreRow, newEntryRow, visibleProps, groupByProp, entityRowOpts, propTypes, thumbSize, renderPerfStartedAt, dbPath, entityNames, renderRowLimit })) return;

  const CHUNK_SIZE = 100; // ベンチマーク用閾値 (100行/チャンク)

  // チャンクを 1 つ生成して tbody に挿入する
  // 最初のチャンクは同期、残りは requestIdleCallback で。
  const _renderChunk = (startIdx) => {
    // 中断チェック: トークンが書き換わっていれば破棄
    if (ctx._renderToken !== renderToken) return;
    const endIdx = Math.min(startIdx + CHUNK_SIZE, rowTasks.length);
    // DocumentFragment でまとめて挿入 (reflow 削減)
    const frag = document.createDocumentFragment();
    for (let i = startIdx; i < endIdx; i++) {
      const task = rowTasks[i];
      if (task.kind === 'group') {
        frag.appendChild(renderGroupHeaderRow(task.groupKey, task.names, visibleProps, groupByProp, ctx));
      } else {
        frag.appendChild(renderEntityRow(task.entityName, ctx, entityRowOpts));
      }
    }
    // 中断チェック (ループ中に破棄された可能性)
    if (ctx._renderToken !== renderToken) return;
    // 新規エントリ行の前に挿入 → 常に末尾に新規エントリ行を維持
    tbody.insertBefore(frag, renderMoreRow || newEntryRow);
    ctx._renderDoneRows = endIdx;
    if (endIdx < rowTasks.length) {
      // 残りを idle callback で処理
      const scheduleNextChunk = (cb) => {
        if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(cb, { timeout: 120 });
        else setTimeout(cb, 0);
      };
      scheduleNextChunk(() => _renderChunk(endIdx));
    } else {
      ctx._renderInProgress = false;
      // Phase 2e-ii-b: 全チャンク完了後にセルコメントバッジを描画
      _refreshSheetBadges(ctx);
      if (typeof _appendBacklinkSummaryColumns === 'function') _appendBacklinkSummaryColumns(ctx);
      if (typeof _logPerfEvent === 'function') {
        _logPerfEvent('sheet.renderPivot.complete', renderPerfStartedAt, {
          targetLabel: String(dbPath || '').split(/[\\/]/).filter(Boolean).pop() || String(dbPath || ''),
          entityCount: entityNames.length,
          propertyCount: visibleProps.length,
          rowTaskCount: rowTasks.length,
          renderRowLimit,
          renderedRows: ctx._renderDoneRows,
        });
      }
    }
  };

  // 最初の CHUNK_SIZE 行は同期で生成 → 即座に表示
  if (rowTasks.length > 0) {
    _renderChunk(0);
  } else {
    ctx._renderInProgress = false;
    _refreshSheetBadges(ctx);
    if (typeof _appendBacklinkSummaryColumns === 'function') _appendBacklinkSummaryColumns(ctx);
    if (typeof _logPerfEvent === 'function') {
      _logPerfEvent('sheet.renderPivot.complete', renderPerfStartedAt, {
        targetLabel: String(dbPath || '').split(/[\\/]/).filter(Boolean).pop() || String(dbPath || ''),
        entityCount: entityNames.length,
        propertyCount: visibleProps.length,
        rowTaskCount: rowTasks.length,
        renderRowLimit,
        renderedRows: 0,
      });
    }
  }
}

function _refreshSheetBadges(ctx) {
  if (typeof CommentBadges === 'undefined') return;
  try {
    const dbPath = ctx?.dbPath || (typeof state !== 'undefined' ? state.currentDbPath : '');
    const tableId = (ctx && ctx.tableId) || 'pivot-table';
    const tbl = _paneEl(ctx, '#' + tableId)
      || (!ctx ? document.querySelector('#pivot-table') || document.querySelector('table.pivot-table') : null);
    if (tbl && dbPath) {
      tbl.dataset.dbPath = dbPath;
      tbl.dataset.path = dbPath;
    }
    if (dbPath && tbl) CommentBadges.refreshSheet(dbPath, tbl);
  } catch {}
}
/* 大規模シートの仮想スクロール — gb-db-table.js から分離 */

const DB_VIRTUAL_ROW_TASK_THRESHOLD = 900;
const DB_VIRTUAL_CELL_TASK_THRESHOLD = 80000;
const DB_VIRTUAL_ROW_OVERSCAN = 24;
const DB_VIRTUAL_MAX_RENDERED_TASKS = 220;
const DB_VIRTUAL_BACKLINK_DEBOUNCE_MS = 180;

function _dbSetRenderRowLimit(ctx, totalRows, requestedLimit) {
  if (ctx) ctx._dbRenderRowLimit = 0;
  return 0;
}

function _dbEffectiveRenderRowLimit(ctx, entityNames, visibleProps) {
  if (ctx) ctx._dbRenderRowLimit = 0;
  return 0;
}

function _dbDisposeVirtualRows(ctx) {
  const v = ctx?._dbVirtualRows;
  if (!v) return;
  if (v.scroller && v.onScroll) v.scroller.removeEventListener('scroll', v.onScroll);
  if (v.onResize) window.removeEventListener('resize', v.onResize);
  if (v.resizeObserver) v.resizeObserver.disconnect();
  if (v.raf) cancelAnimationFrame(v.raf);
  if (ctx?._dbVirtualBacklinkTimer) {
    clearTimeout(ctx._dbVirtualBacklinkTimer);
    ctx._dbVirtualBacklinkTimer = null;
  }
  if (v.table && v.table._dbVirtualRows === v) v.table._dbVirtualRows = null;
  if (ctx) ctx._dbVirtualRows = null;
}

function _dbShouldUseVirtualRows(ctx, rowTasks, options = {}) {
  if (!ctx || !Array.isArray(rowTasks)) return false;
  if (options.disabled === true || ctx._dbDisableVirtualRows === true) return false;
  const projectedCells = rowTasks.length * Math.max(1, (options.visibleProps?.length || 0) + 1);
  return rowTasks.length >= DB_VIRTUAL_ROW_TASK_THRESHOLD
    || projectedCells >= DB_VIRTUAL_CELL_TASK_THRESHOLD;
}

function _dbVirtualEstimateRowHeight(options = {}) {
  const visibleProps = Array.isArray(options.visibleProps) ? options.visibleProps : [];
  const propTypes = options.propTypes || {};
  let rowHeight = options.thumbSize === 'large' ? 104 : 38;
  visibleProps.forEach(propName => {
    const ptc = propTypes[propName];
    if (ptc?.type !== 'image') return;
    const cellSize = typeof _imagePropCellSize === 'function'
      ? _imagePropCellSize(ptc)
      : _dbClampInt(ptc?.options?.cell_height ?? ptc?.options?.cell_thumbnail_size, 32, 320, 96);
    rowHeight = Math.max(rowHeight, cellSize + 14);
  });
  return Math.max(30, Math.min(360, Math.round(rowHeight)));
}

function _dbVirtualScrollContainer(ctx, tbody) {
  const table = tbody?.closest?.('table');
  return table?.closest?.('#pivot-view,.pivot-view')
    || (typeof _paneEl === 'function' ? (_paneEl(ctx, '.pivot-view') || _paneEl(ctx, '#pivot-view')) : null)
    || (typeof findScrollableParent === 'function' ? findScrollableParent(table) : null);
}

function _dbCreateVirtualSpacerRow(className, colSpan) {
  const tr = document.createElement('tr');
  tr.className = className;
  tr.setAttribute('aria-hidden', 'true');
  tr.setAttribute('role', 'presentation');
  const td = document.createElement('td');
  td.colSpan = colSpan;
  td.style.cssText = 'height:0;padding:0;border:0;line-height:0;';
  tr.appendChild(td);
  return tr;
}

function _dbSetVirtualSpacerHeight(row, height) {
  const px = Math.max(0, Math.round(height || 0));
  const td = row?.firstElementChild;
  if (td) td.style.height = px + 'px';
}

function _dbRenderVirtualTask(task, config) {
  if (task.kind === 'group') {
    return renderGroupHeaderRow(task.groupKey, task.names, config.visibleProps, config.groupByProp, config.ctx);
  }
  return renderEntityRow(task.entityName, config.ctx, config.entityRowOpts);
}

function _dbScheduleVirtualBacklinkSummary(ctx, renderToken) {
  if (typeof _appendBacklinkSummaryColumns !== 'function' || !ctx) return;
  clearTimeout(ctx._dbVirtualBacklinkTimer);
  ctx._dbVirtualBacklinkTimer = setTimeout(() => {
    if (renderToken && ctx._renderToken !== renderToken) return;
    _appendBacklinkSummaryColumns(ctx);
  }, DB_VIRTUAL_BACKLINK_DEBOUNCE_MS);
}

function _dbVirtualAfterVisibleRows(ctx, renderToken) {
  if (renderToken && ctx?._renderToken !== renderToken) return;
  if (typeof _refreshSheetBadges === 'function') _refreshSheetBadges(ctx);
  _dbScheduleVirtualBacklinkSummary(ctx, renderToken);
}

function _dbVirtualStateForTable(table) {
  return table?._dbVirtualRows || null;
}

function _dbApplyVirtualPendingCell(vState) {
  const pending = vState?.pendingCell;
  if (!pending?.entityName || pending.colIdx == null) return;
  const cssName = (typeof CSS !== 'undefined' && typeof CSS.escape === 'function')
    ? CSS.escape(pending.entityName)
    : String(pending.entityName).replace(/["\\]/g, '\\$&');
  const row = vState.table?.querySelector?.(`tbody tr[data-entity-name="${cssName}"]`);
  const cell = row?.children?.[pending.colIdx] || null;
  if (!cell || cell.classList.contains('col-add-prop-cell')) return;
  vState.pendingCell = null;
  if (typeof setActiveCell === 'function') {
    setTimeout(() => {
      if (cell.isConnected) setActiveCell(cell, { preserveRange: true });
    }, 0);
  }
}

function _dbRequestVirtualCellReveal(table, rowIdx, colIdx) {
  const v = _dbVirtualStateForTable(table);
  if (!v) return false;
  const entityName = v.entityNames?.[rowIdx];
  if (!entityName) return false;
  v.pendingCell = { entityName, colIdx };
  return _dbRevealVirtualEntityRow(v.ctx, entityName);
}

function _dbRunVirtualRowRenderer(ctx, config) {
  const tbody = config?.tbody;
  const rowTasks = config?.rowTasks;
  const scroller = _dbVirtualScrollContainer(ctx, tbody);
  if (!ctx || !tbody || !Array.isArray(rowTasks) || !scroller) return false;
  const table = tbody.closest('table');

  const colSpan = (config.visibleProps?.length || 0) + 3;
  const topSpacer = _dbCreateVirtualSpacerRow('db-virtual-spacer-row db-virtual-spacer-top', colSpan);
  const bottomSpacer = _dbCreateVirtualSpacerRow('db-virtual-spacer-row db-virtual-spacer-bottom', colSpan);
  const anchor = config.renderMoreRow || config.newEntryRow || null;
  tbody.insertBefore(topSpacer, anchor);
  tbody.insertBefore(bottomSpacer, anchor);

  const rowHeight = _dbVirtualEstimateRowHeight(config);
  const renderToken = config.renderToken;
  const vState = {
    rowTasks,
    rowHeight,
    scroller,
    topSpacer,
    bottomSpacer,
    table,
    ctx,
    entityNames: rowTasks.filter(task => task.kind === 'entity').map(task => task.entityName),
    renderedRows: [],
    start: -1,
    end: -1,
    raf: 0,
    onScroll: null,
    onResize: null,
    resizeObserver: null,
    forceNextRender: false,
    renderNow: null,
    renderToken,
  };
  ctx._dbVirtualRows = vState;
  if (table) table._dbVirtualRows = vState;

  const renderVisible = (force = false) => {
    if (renderToken && ctx._renderToken !== renderToken) return;
    const viewportHeight = Math.max(240, scroller.clientHeight || window.innerHeight || 600);
    const first = Math.max(0, Math.floor((scroller.scrollTop || 0) / rowHeight) - DB_VIRTUAL_ROW_OVERSCAN);
    const visibleCount = Math.min(
      DB_VIRTUAL_MAX_RENDERED_TASKS,
      Math.ceil(viewportHeight / rowHeight) + DB_VIRTUAL_ROW_OVERSCAN * 2,
    );
    const last = Math.min(rowTasks.length, first + visibleCount);
    if (!force && first === vState.start && last === vState.end) return;

    vState.renderedRows.forEach(row => row.remove());
    vState.renderedRows = [];
    _dbSetVirtualSpacerHeight(topSpacer, first * rowHeight);
    _dbSetVirtualSpacerHeight(bottomSpacer, (rowTasks.length - last) * rowHeight);

    const frag = document.createDocumentFragment();
    for (let i = first; i < last; i++) {
      const row = _dbRenderVirtualTask(rowTasks[i], config);
      vState.renderedRows.push(row);
      frag.appendChild(row);
    }
    tbody.insertBefore(frag, bottomSpacer);
    vState.start = first;
    vState.end = last;
    ctx._renderDoneRows = Math.max(0, last - first);
    ctx._renderInProgress = false;
    _dbApplyVirtualPendingCell(vState);
    _dbVirtualAfterVisibleRows(ctx, renderToken);

    if (!vState.logged && typeof _logPerfEvent === 'function') {
      vState.logged = true;
      _logPerfEvent('sheet.renderPivot.complete', config.renderPerfStartedAt, {
        targetLabel: String(config.dbPath || '').split(/[\\/]/).filter(Boolean).pop() || String(config.dbPath || ''),
        entityCount: config.entityNames?.length || 0,
        propertyCount: config.visibleProps?.length || 0,
        rowTaskCount: rowTasks.length,
        renderRowLimit: config.renderRowLimit,
        renderedRows: ctx._renderDoneRows,
        virtualRows: true,
      });
    }
  };

  const requestRender = (force = false) => {
    vState.forceNextRender = vState.forceNextRender || force;
    if (vState.raf) return;
    vState.raf = requestAnimationFrame(() => {
      vState.raf = 0;
      const shouldForce = vState.forceNextRender;
      vState.forceNextRender = false;
      renderVisible(shouldForce);
    });
  };
  vState.renderNow = renderVisible;
  vState.onScroll = () => requestRender(false);
  vState.onResize = () => requestRender(true);
  scroller.addEventListener('scroll', vState.onScroll, { passive: true });
  window.addEventListener('resize', vState.onResize);
  if (typeof ResizeObserver === 'function') {
    let lastWidth = scroller.clientWidth;
    let lastHeight = scroller.clientHeight;
    vState.resizeObserver = new ResizeObserver(() => {
      const nextWidth = scroller.clientWidth;
      const nextHeight = scroller.clientHeight;
      if (nextWidth === lastWidth && nextHeight === lastHeight) return;
      lastWidth = nextWidth;
      lastHeight = nextHeight;
      requestRender(true);
    });
    vState.resizeObserver.observe(scroller);
  }
  renderVisible(true);
  return true;
}

function _dbRevealVirtualEntityRow(ctx, entityName) {
  const v = ctx?._dbVirtualRows;
  if (!v || !entityName) return false;
  const index = v.rowTasks.findIndex(task => task.kind === 'entity' && task.entityName === entityName);
  if (index < 0) return false;
  const viewportHeight = Math.max(240, v.scroller?.clientHeight || window.innerHeight || 600);
  v.scroller.scrollTop = Math.max(0, Math.round(index * v.rowHeight - viewportHeight / 2));
  v.renderNow?.(true);
  return true;
}
