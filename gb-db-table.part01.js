/* ピボット描画・委譲UI — gb-database.js から分離 */

function showUnifiedFilterModal() {
  // スマートシート表示中は state.currentDbPath が null なので、
  // ここで通常シート用ダイアログを開くと保存先が無く条件が消える。
  // スマートシート専用のフィルタ設定ダイアログにルーティングする。
  if (state.currentSmartDb && typeof showSmartDbFilterModal === 'function') {
    showSmartDbFilterModal(state.currentSmartDb.id);
    return;
  }
  const options = arguments[0] || {};
  const ctx = options.ctx
    || (typeof _dbPaneContextFromEvent === 'function' ? _dbPaneContextFromEvent(options.event, { dbPath: state.currentDbPath }) : null)
    || (typeof _currentPaneState === 'function' ? _currentPaneState() : null);
  const smartDb = ctx?.smartDb || state.currentSmartDb;
  if (smartDb && typeof showSmartDbFilterModal === 'function') {
    showSmartDbFilterModal(smartDb.id);
    return;
  }
  const dbPath = ctx?.dbPath || state.currentDbPath;
  const filterMode = ctx?.filter ?? state.filter ?? 'disabled';
  const advFilters = dbPath ? getAdvancedFilters(dbPath, { ctx }) : [];
  const o = document.createElement('div'); o.className = 'modal-overlay';
  o.dataset.ufDbPath = dbPath || '';
  o._ufCtx = ctx || null;
  o.innerHTML = `<div class="modal" style="min-width:500px;">
    <h3>フィルタ</h3>
    <div style="margin-bottom:12px;">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
        <label style="font-size:12px;color:var(--fg2);display:flex;align-items:center;gap:4px;cursor:pointer;">
          <input type="checkbox" id="uf-status-enabled" ${filterMode !== 'disabled' ? 'checked' : ''}>
          採用状況フィルタ
        </label>
      </div>
      <div id="uf-status-btns" style="display:${filterMode !== 'disabled' ? 'flex' : 'none'};gap:6px;">
        <button id="uf-all" class="${!filterMode || filterMode==='all' || filterMode==='disabled'?'primary':''}" data-action="document.querySelectorAll('#uf-all,#uf-adopted,#uf-nobotsu').forEach(b=>b.classList.remove('primary'));this.classList.add('primary');">全表示</button>
        <button id="uf-adopted" class="${filterMode==='adopted'?'primary':''}" data-action="document.querySelectorAll('#uf-all,#uf-adopted,#uf-nobotsu').forEach(b=>b.classList.remove('primary'));this.classList.add('primary');">採用+掲載済みのみ</button>
        <button id="uf-nobotsu" class="${filterMode==='nobotsu'?'primary':''}" data-action="document.querySelectorAll('#uf-all,#uf-adopted,#uf-nobotsu').forEach(b=>b.classList.remove('primary'));this.classList.add('primary');">ボツ非表示</button>
      </div>
    </div>
    <div style="margin-bottom:12px;">
      <div style="font-size:12px;color:var(--fg2);margin-bottom:4px;">条件フィルタ</div>
      <div id="uf-conditions"></div>
      <button data-action="_ufAddCondition()" style="font-size:11px;margin-top:4px;">+ 条件を追加</button>
    </div>
    <div class="btn-row">
      <button data-action="this.closest('.modal-overlay').remove()">キャンセル</button>
      <button data-action="_ufClear()" style="color:var(--red);">全解除</button>
      <button class="primary" data-action="_ufApply()">適用</button>
    </div>
  </div>`;
  document.body.appendChild(o);
  // 採用状況フィルタのチェックボックス制御
  const sfCb = o.querySelector('#uf-status-enabled');
  const sfBtns = o.querySelector('#uf-status-btns');
  if (sfCb && sfBtns) {
    sfCb.addEventListener('change', () => { sfBtns.style.display = sfCb.checked ? 'flex' : 'none'; });
  }
  // 既存条件を復元
  const condDiv = o.querySelector('#uf-conditions');
  if (advFilters.length) {
    advFilters.forEach(f => condDiv.insertAdjacentHTML('beforeend', _ufConditionRow(f, dbPath, ctx)));
  }
}

function _getUnifiedFilterProperties(dbPath, ctx) {
  const props = [];
  const add = (prop) => {
    if (prop && !props.includes(prop)) props.push(prop);
  };
  const data = (ctx?.dbPath === dbPath ? ctx.pivotData : null) || (state.currentDbPath === dbPath ? state.pivotData : null) || ctx?.pivotData || state.pivotData;
  (data?.properties || []).forEach(add);
  (getColOrder(dbPath, { ctx }) || []).forEach(add);
  Object.keys(getPropertyTypes(dbPath) || {}).forEach(add);
  return typeof filterDeletedDbProperties === 'function' ? filterDeletedDbProperties(dbPath, props) : props;
}

function _ufConditionRow(f, dbPath, ctx) {
  const selectedProp = f?.property || '*';
  const props = _getUnifiedFilterProperties(dbPath || state.currentDbPath, ctx);
  if (selectedProp !== '*' && !props.includes(selectedProp)) props.push(selectedProp);
  const propOpts = props.map(p => `<option value="${esc(p)}" ${selectedProp===p?'selected':''}>${esc(p)}</option>`).join('');
  return `<div class="uf-cond" style="display:flex;gap:4px;margin-bottom:4px;align-items:center;font-size:12px;">
    <select data-field="field" class="gb-select gb-select-sm"><option value="value" ${f?.field==='value'?'selected':''}>値</option><option value="status" ${f?.field==='status'?'selected':''}>ステータス</option></select>
    <select data-field="property" class="gb-select gb-select-sm" style="flex:1;"><option value="*" ${selectedProp==='*'?'selected':''}>全プロパティ</option>${propOpts}</select>
    <select data-field="operator" class="gb-select gb-select-sm">
      <option value="contains" ${f?.operator==='contains'?'selected':''}>含む</option>
      <option value="not_contains" ${f?.operator==='not_contains'?'selected':''}>含まない</option>
      <option value="equals" ${f?.operator==='equals'?'selected':''}>一致</option>
      <option value="not_equals" ${f?.operator==='not_equals'?'selected':''}>不一致</option>
      <option value="empty" ${f?.operator==='empty'?'selected':''}>空</option>
      <option value="not_empty" ${f?.operator==='not_empty'?'selected':''}>空でない</option>
    </select>
    <input type="text" data-field="value" value="${esc(f?.value ?? '')}" style="padding:2px;width:80px;">
    <button data-action="this.parentElement.remove()" style="color:var(--red);background:none;border:none;cursor:pointer;display:flex;align-items:center;">${lucide('x', 14)}</button>
  </div>`;
}
function _ufAddCondition() {
  const overlay = document.querySelector('.modal-overlay[data-uf-db-path]');
  document.getElementById('uf-conditions').insertAdjacentHTML('beforeend', _ufConditionRow({}, overlay?.dataset.ufDbPath || state.currentDbPath, overlay?._ufCtx || null));
}
function _ufApply() {
  const overlay = document.querySelector('.modal-overlay[data-uf-db-path]');
  const ctx = overlay?._ufCtx || null;
  const dbPath = overlay?.dataset.ufDbPath || ctx?.dbPath || state.currentDbPath;
  // ステータスフィルタ
  const sfEnabled = document.getElementById('uf-status-enabled')?.checked;
  let nextFilter = 'all';
  if (!sfEnabled) nextFilter = 'disabled';
  else if (document.getElementById('uf-adopted')?.classList.contains('primary')) nextFilter = 'adopted';
  else if (document.getElementById('uf-nobotsu')?.classList.contains('primary')) nextFilter = 'nobotsu';
  setFilter(nextFilter, { skipReload: true, dbPath, ctx });
  // 条件フィルタ
  const filters = [];
  document.querySelectorAll('.uf-cond').forEach(row => {
    filters.push({
      field: row.querySelector('[data-field="field"]').value,
      property: row.querySelector('[data-field="property"]').value,
      operator: row.querySelector('[data-field="operator"]').value,
      value: row.querySelector('[data-field="value"]').value,
    });
  });
  if (dbPath) setAdvancedFilters(dbPath, filters, { ctx });
  document.querySelector('.modal-overlay').remove();
  _updateFilterBadge({ dbPath, filter: ctx?.filter ?? nextFilter, ctx });
  if (dbPath) selectDatabase(dbPath, ctx);
}
function _ufClear() {
  const overlay = document.querySelector('.modal-overlay[data-uf-db-path]');
  const ctx = overlay?._ufCtx || null;
  const dbPath = overlay?.dataset.ufDbPath || ctx?.dbPath || state.currentDbPath;
  setFilter('disabled', { skipReload: true, dbPath, ctx });
  if (dbPath) setAdvancedFilters(dbPath, [], { ctx });
  document.querySelector('.modal-overlay').remove();
  _updateFilterBadge({ dbPath, filter: 'disabled', ctx });
  if (dbPath) selectDatabase(dbPath, ctx);
}

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

function _dbRemoveCreatedEntitiesLocally(ctx, dbPath, names) {
  if (!names?.length) return;
  const normalize = typeof _dbNormalizePath === 'function'
    ? _dbNormalizePath
    : (path) => String(path || '').replace(/\\/g, '/').replace(/\/+$/, '');
  const renderCtx = _dbResolveEntityCreateRenderContext(ctx, dbPath);
  const targets = [];
  if (renderCtx) targets.push(renderCtx);
  if (typeof state !== 'undefined' && normalize(state.currentDbPath || '') === normalize(dbPath || '')) targets.push(state);
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
  if (_dbRemoveNamesFromCurrentManualOrder(dbPath, names)) changed = true;
  if (changed) {
    _dbRenderEntityCreateContext(renderCtx, dbPath);
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
  return { name: localName, renderCtx, promise: trackedPromise };
}

function _dbEntityCreateIsEditing(renderCtx) {
  const table = typeof _currentPivotTable === 'function' ? _currentPivotTable(renderCtx) : null;
  if (table?.querySelector?.('.entity-rename-input,.th-rename-input,.cell-inline-input,.cell-inline-select,.cell-date-editor')) return true;
  // セレクト/ユーザー/リレーション等のドロップダウンは body 直下に出るため、テーブル内検索では拾えない
  return !!document.querySelector('.cell-inline-dd,.status-dropdown,.user-dropdown');
}

function _dbPivotFetchUrl(dbPath) {
  return '/pivot?path=' + encodeURIComponent(dbPath)
    + (typeof getFilterParam === 'function' && getFilterParam() ? '&status_filter=' + getFilterParam() : '');
}

function _dbFindEntityRow(ctx, entityName) {
  const tblId = (ctx && ctx.tableId) || 'pivot-table';
  const root = typeof _paneEl === 'function' ? (_paneEl(ctx, '#' + tblId) || document) : document;
  return root.querySelector(`tbody tr[data-entity-name="${CSS.escape(entityName)}"]`);
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
      // サーバー作成が未確定の楽観的エントリは取得データに含まれないため、行が消えないよう再マージする
      if (typeof _dbMergePendingEntityCreates === 'function') _dbMergePendingEntityCreates(dbPath, pivotData);
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
    _dbScheduleEntityCreatePostSync(dbPath, [{ name: saved.name, path: saved.path, response: saved.response }], renderCtx);
  } catch (e) {
    _dbRemoveCreatedEntitiesLocally(renderCtx, dbPath, [created.name]);
    if (typeof showStatus === 'function') showStatus('エントリ作成に失敗: ' + (e?.message || e), true);
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
      createdItems.push({ name: saved.name, path: saved.path, response: saved.response });
    } catch (e) {
      failed.push(record.name);
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
    { label: 'サブパネルで開く', icon: 'layers-2', action: () => {
      if (relPath && typeof openLinkInSubPanel === 'function') openLinkInSubPanel(relPath, entityName, { linkType: 'entity', sourcePaneId });
      // 互換テスト用: navigateToEntity(entityName, relDbPath)
      else navigateToEntity(entityName, relDbPath, ctx);
    } },
    { label: 'ビューワーでプレビュー', icon: 'tvMinimal', action: () => { if (typeof _updateLinkedPreview === 'function' && relPath) _updateLinkedPreview(relPath); } },
  ];
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
  const paneRoot = _paneEl(ctx, '#' + tbl) || document;
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

  // 8. エントリ名セル (col-entity) click → 詳細パネル
  const colEntityTd = target.closest('td.col-entity');
  if (colEntityTd && !colEntityTd.closest('tr.new-entity-row')) {
    const entityName = colEntityTd.closest('tr')?.dataset?.entityName;
    if (entityName) {
      openEntityInSplit(_entityPath(dbPath, entityName), entityName);
    }
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
  const opensInlineDropdown = ptc && ['select', 'multi-select', 'relation', 'multi-relation', 'user', 'multi-user'].includes(ptc.type);
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
  const paneRoot = _paneEl(ctx, '#' + tbl) || document;

  // 行の HTML5 ドラッグを一時的に無効化 (cb 操作が行ドラッグを誤起動しないように)
  const tr = cb.closest('tr');
  if (tr) {
    tr.draggable = false;
    const restore = () => {
      tr.draggable = true;
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
  const paneRoot = _paneEl(ctx, '#' + tbl) || document;
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
