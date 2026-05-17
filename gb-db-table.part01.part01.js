/* ピボット描画・委譲UI — gb-database.js から分離 */

function showUnifiedFilterModal() {
  const dbPath = state.currentDbPath;
  const advFilters = dbPath ? getAdvancedFilters(dbPath) : [];
  const o = document.createElement('div'); o.className = 'modal-overlay';
  o.innerHTML = `<div class="modal" style="min-width:500px;">
    <h3>フィルタ</h3>
    <div style="margin-bottom:12px;">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
        <label style="font-size:12px;color:var(--fg2);display:flex;align-items:center;gap:4px;cursor:pointer;">
          <input type="checkbox" id="uf-status-enabled" ${state.filter !== 'disabled' ? 'checked' : ''}>
          採用状況フィルタ
        </label>
      </div>
      <div id="uf-status-btns" style="display:${state.filter !== 'disabled' ? 'flex' : 'none'};gap:6px;">
        <button id="uf-all" class="${!state.filter || state.filter==='all' || state.filter==='disabled'?'primary':''}" data-action="document.querySelectorAll('#uf-all,#uf-adopted,#uf-nobotsu').forEach(b=>b.classList.remove('primary'));this.classList.add('primary');">全表示</button>
        <button id="uf-adopted" class="${state.filter==='adopted'?'primary':''}" data-action="document.querySelectorAll('#uf-all,#uf-adopted,#uf-nobotsu').forEach(b=>b.classList.remove('primary'));this.classList.add('primary');">採用+掲載済みのみ</button>
        <button id="uf-nobotsu" class="${state.filter==='nobotsu'?'primary':''}" data-action="document.querySelectorAll('#uf-all,#uf-adopted,#uf-nobotsu').forEach(b=>b.classList.remove('primary'));this.classList.add('primary');">ボツ非表示</button>
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
    advFilters.forEach(f => condDiv.insertAdjacentHTML('beforeend', _ufConditionRow(f)));
  }
}

function _getUnifiedFilterProperties(dbPath) {
  const props = [];
  const add = (prop) => {
    if (prop && !props.includes(prop)) props.push(prop);
  };
  (state.pivotData?.properties || []).forEach(add);
  (getColOrder(dbPath) || []).forEach(add);
  Object.keys(getPropertyTypes(dbPath) || {}).forEach(add);
  return props;
}

function _ufConditionRow(f) {
  const selectedProp = f?.property || '*';
  const props = _getUnifiedFilterProperties(state.currentDbPath);
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
  document.getElementById('uf-conditions').insertAdjacentHTML('beforeend', _ufConditionRow({}));
}
function _ufApply() {
  // ステータスフィルタ
  const sfEnabled = document.getElementById('uf-status-enabled')?.checked;
  let nextFilter = 'all';
  if (!sfEnabled) nextFilter = 'disabled';
  else if (document.getElementById('uf-adopted')?.classList.contains('primary')) nextFilter = 'adopted';
  else if (document.getElementById('uf-nobotsu')?.classList.contains('primary')) nextFilter = 'nobotsu';
  setFilter(nextFilter, { skipReload: true });
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
  if (state.currentDbPath) setAdvancedFilters(state.currentDbPath, filters);
  document.querySelector('.modal-overlay').remove();
  _updateFilterBadge();
  if (state.currentDbPath) selectDatabase(state.currentDbPath);
}
function _ufClear() {
  setFilter('disabled', { skipReload: true });
  if (state.currentDbPath) setAdvancedFilters(state.currentDbPath, []);
  document.querySelector('.modal-overlay').remove();
  _updateFilterBadge();
  if (state.currentDbPath) selectDatabase(state.currentDbPath);
}


async function _handleNewEntryClick(ctx) {
  const dbPath = ctx.dbPath;
  const entitiesMap = ctx.pivotData?.entities || {};
  try {
    const created = typeof _apiCreateEntityWithUniqueName === 'function'
      ? await _apiCreateEntityWithUniqueName(dbPath, Object.keys(entitiesMap))
      : null;
    const r = created?.response || await apiPost('/entity/create', { parent_path: dbPath, name: '無題' });
    const name = created?.name || '無題';
    // §12.1 Phase 0: 新規作成後 autoFillOnCreate を適用（R8: 呼び出し側指定なしなので全プロパティ対象）
    const createdPath = created?.path || (r && (r.path || r.entry_path)) || `${dbPath}/${name}.md`;
    if (typeof _shouldRunFrontendAutoFillOnCreate !== 'function' || _shouldRunFrontendAutoFillOnCreate(r)) {
      try { await _autoFillOnCreate(dbPath, createdPath, {}); } catch {}
    }
    await selectDatabase(dbPath);
    // Step 2: チャンク分割中は新規行が遅れて DOM に出現する可能性があるため、待機
    _waitForEntityRow(ctx, name, (tr) => {
      const label = tr.querySelector('.entity-name-label');
      const td = label?.closest('td');
      if (td && label) startEntityInlineRename(td, label, name, dbPath);
    });
  } catch (e) { /* error shown */ }
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
  const dbPath = ctx.dbPath;
  const entitiesMap = ctx.pivotData?.entities || {};
  const existing = Object.keys(entitiesMap);
  count = Math.max(1, count || 1);
  const created = [];
  for (let n = 0; n < count; n++) {
    try {
      const made = typeof _apiCreateEntityWithUniqueName === 'function'
        ? await _apiCreateEntityWithUniqueName(dbPath, existing.concat(created))
        : null;
      const r = made?.response || await apiPost('/entity/create', { parent_path: dbPath, name: '無題' });
      const name = made?.name || '無題';
      const createdPath = made?.path || (r && (r.path || r.entry_path)) || `${dbPath}/${name}.md`;
      if (typeof _shouldRunFrontendAutoFillOnCreate !== 'function' || _shouldRunFrontendAutoFillOnCreate(r)) {
        try { await _autoFillOnCreate(dbPath, createdPath, {}); } catch {}
      }
      created.push(name);
    } catch (e) { /* error shown */ }
  }
  if (created.length === 0) return;
  // manualOrder 更新: refEntityName の above/below に created を挿入
  const cfg = getDbViewConfig(dbPath);
  const view = typeof _getCurrentDbViewConfigEntryFromConfig === 'function'
    ? _getCurrentDbViewConfigEntryFromConfig(cfg)
    : null;
  const target = view || cfg;
  target.sortConfig = { key: 'manual', dir: 'asc' };
  let order = target.manualOrder ? [...target.manualOrder] : _getEntityOrderSnapshot(ctx, dbPath, entitiesMap);
  order = order.filter(n => !created.includes(n));
  // refEntityName が無い場合は末尾
  let refIdx = refEntityName ? order.indexOf(refEntityName) : -1;
  if (refIdx < 0) {
    order.push(...created);
  } else {
    const insertIdx = refIdx + (position === 'below' ? 1 : 0);
    order.splice(insertIdx, 0, ...created);
  }
  target.manualOrder = order;
  saveDbViewConfig(dbPath, cfg);
  await selectDatabase(dbPath, ctx, { silent: true });
  // 1 件のみ作成時はインライン rename を起動
  if (created.length === 1) {
    // Step 2: チャンク分割対応 — 行が DOM に出現するまで待機
    _waitForEntityRow(ctx, created[0], (tr) => {
      const label = tr.querySelector('.entity-name-label');
      const td = label?.closest('td');
      if (td && label) startEntityInlineRename(td, label, created[0], dbPath);
    });
  }
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
    { label: 'リンク先を開く', icon: 'externalLink', action: () => navigateToEntity(entityName, relDbPath) },
    { label: 'サブパネルで開く', icon: 'layers-2', action: () => {
      if (relPath && typeof openLinkInSubPanel === 'function') openLinkInSubPanel(relPath, entityName, { linkType: 'entity', sourcePaneId });
      else navigateToEntity(entityName, relDbPath);
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
    }
  }
  paneRoot._lastSelectedCb = cb;
}

// tbody click 委譲ハンドラ
function _handleTbodyClick(e) {
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
      _executeButtonActions(dbPath, entityName, ptc?.actions || [], ctx);
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
  // セル内の特殊要素は他で処理されている（早期 return チェック）
  if (target.closest('.status-dot') || target.closest('.value-text') || target.closest('.value-url') || target.closest('.multi-select-tag') || target.closest('.cell-checkbox') || target.closest('.cell-select-val') || target.closest('.chat-prop-cell')) return;

  const tr = td.closest('tr');
  const entityName = tr?.dataset?.entityName;
  const propName = td.dataset.propName;
  if (!entityName || !propName) return;

  const propTypes = getPropertyTypes(dbPath);
  const ptc = propTypes[propName];
  const entityData = ctx.pivotData?.entities?.[entityName];
  const rawValues = entityData?.[propName] || [];
  const values = filterValues(rawValues);

  if (values.length === 0 && !(ptc && (ptc.type === 'formula' || ptc.type === 'rollup' || ptc.type === 'button' || ptc.type === 'multi-source-relation' || ptc.type === 'chat'))) {
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
  const cb = e.target.closest('.row-select-cb');
  if (!cb) return;

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
function _handleTbodyDragstart(e) {
  const tbody = e.currentTarget;
  const ctx = tbody._meldexCtx;
  if (!ctx) return;
  const target = e.target;

  // 1. nameSpan ドラッグ → DB間 D&D (text/plain 単一名 + application/x-meldex-node)
  // 自身が複数選択中なら text/x-meldex-rows ペイロードも乗せて行並び替えにも使えるようにする
  const nameSpan = target.closest('.entity-name-label');
  if (nameSpan) {
    e.stopPropagation();
    const tr = nameSpan.closest('tr');
    const entityName = tr?.dataset?.entityName;
    if (!entityName) return;
    const ep = _entityPath(ctx.dbPath, entityName);
    e.dataTransfer.effectAllowed = 'copyMove';
    const sel = ctx._selectedEntities;
    if (sel && sel.has(entityName) && sel.size > 1) {
      const payloadNames = [...sel];
      e.dataTransfer.setData('text/plain', payloadNames.join('\n'));
      e.dataTransfer.setData('text/x-meldex-rows', JSON.stringify(payloadNames));
    } else {
      e.dataTransfer.setData('text/plain', entityName);
    }
    e.dataTransfer.setData('application/x-meldex-node', JSON.stringify({
      name: entityName, path: ep, type: 'entity'
    }));
    nameSpan.classList.add('dragging');
    return;
  }

  // 2. tr (エントリ行) ドラッグ → 並び替え (複数選択時は全行)
  // 早期 return を削除: セル領域からドラッグした場合も並び替えできるように
  const tr = target.closest('tr[data-entity-name]');
  if (tr) {
    // セル内の値チップなど他の draggable はそれ自身で stopPropagation するため
    // ここに到達するのは行レベルのドラッグのみ
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
  const target = e.target;
  const nameSpan = target.closest('.entity-name-label');
  if (nameSpan) { nameSpan.classList.remove('dragging'); return; }
  const tr = target.closest('tr[data-entity-name]');
  if (tr) { tr.style.opacity = ''; }
}

// D-4-f: tbody dragover / dragleave / drop 委譲ハンドラ (エントリ行の並び替え)
function _handleTbodyDragover(e) {
  const tbody = e.currentTarget;
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
  const tr = e.target.closest('tr[data-entity-name]');
  if (!tr) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  const rect = tr.getBoundingClientRect();
  tr.style.boxShadow = e.clientY < rect.top + rect.height / 2 ? 'inset 0 2px 0 var(--blue,#4a90d9)' : 'inset 0 -2px 0 var(--blue,#4a90d9)';
  // 直前にホバーしていた tr の boxShadow をクリア
  if (tbody._lastDragoverTr && tbody._lastDragoverTr !== tr) {
    tbody._lastDragoverTr.style.boxShadow = '';
  }
  tbody._lastDragoverTr = tr;
}

function _handleTbodyDragleave(e) {
  const tbody = e.currentTarget;
  // tbody から完全に離脱する場合のみクリア (子要素間の遷移は無視)
  if (e.relatedTarget && tbody.contains(e.relatedTarget)) return;
  if (tbody._lastDragoverTr) {
    tbody._lastDragoverTr.style.boxShadow = '';
    tbody._lastDragoverTr = null;
  }
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
  const groupByProp = getGroupBy(dbPath);
  if (!groupByProp) return;
  const lockMsg = typeof checkColumnEditable === 'function' ? checkColumnEditable(dbPath, groupByProp) : null;
  if (lockMsg) {
    showStatus(lockMsg, true);
    return;
  }
  const propTypes = getPropertyTypes(dbPath);
  const ptc = propTypes[groupByProp];
  if (!ptc) return;
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
    const visibleVals = filterValues(vals);
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
  // 1. グループヘッダー行へのドロップ → グループ間 D&D
  const gtr = e.target.closest('tr.group-header-row');
  if (gtr) {
    e.preventDefault();
    gtr.classList.remove('group-drop-target');
    if (tbody._lastDragoverGroup) {
      tbody._lastDragoverGroup.classList.remove('group-drop-target');
      tbody._lastDragoverGroup = null;
    }
    let dn = [];
    const rj = e.dataTransfer.getData('text/x-meldex-rows');
    if (rj) { try { dn = JSON.parse(rj) || []; } catch {} }
    if (dn.length === 0) {
      const sg = e.dataTransfer.getData('text/plain');
      if (sg) dn = sg.split('\n').filter(Boolean);
    }
    if (dn.length === 0) return;
    const newGroupKey = gtr.dataset.groupKey || '';
    _handleGroupDrop(ctx, dn, newGroupKey);
    return;
  }
  const tr = e.target.closest('tr[data-entity-name]');
  if (!tr) return;
  e.preventDefault();
  tr.style.boxShadow = '';
  if (tbody._lastDragoverTr) { tbody._lastDragoverTr.style.boxShadow = ''; tbody._lastDragoverTr = null; }

  // ドラッグされたエントリ名を取得 (multi → single fallback)
  let draggedNames = [];
  const rowsJson = e.dataTransfer.getData('text/x-meldex-rows');
  if (rowsJson) {
    try { draggedNames = JSON.parse(rowsJson) || []; } catch {}
  }
  if (draggedNames.length === 0) {
    const single = e.dataTransfer.getData('text/plain');
    if (single) draggedNames = single.split('\n').filter(Boolean);
  }
  const dropTargetEntity = tr.dataset.entityName;
  draggedNames = draggedNames.filter(n => n && n !== dropTargetEntity);
  if (draggedNames.length === 0) return;

  const dbPath = ctx.dbPath;
  const cfgBefore = getDbViewConfig(dbPath);
  const viewBefore = typeof _getCurrentDbViewConfigEntryFromConfig === 'function'
    ? _getCurrentDbViewConfigEntryFromConfig(cfgBefore)
    : null;
  const beforeTarget = viewBefore || cfgBefore;
  const oldSortConfig = beforeTarget.sortConfig ? { ...beforeTarget.sortConfig } : null;
  const oldOrder = beforeTarget.manualOrder ? [...beforeTarget.manualOrder] : null;
  const cfg = cfgBefore;
  const view = typeof _getCurrentDbViewConfigEntryFromConfig === 'function'
    ? _getCurrentDbViewConfigEntryFromConfig(cfg)
    : null;
  const target = view || cfg;
  target.sortConfig = { key: 'manual', dir: 'asc' };
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
  setTimeout(() => restoreActiveCellByEntityName(orderedDragged[0]), 50);
  _restoreSelectionByEntityNames(ctx, orderedDragged);
  _dbUndoManualOrder(dbPath, orderedDragged, oldOrder, oldSortConfig, newOrder);
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
  showDbCardContextMenu(e, ctx.dbPath, entityName);
}

// D-4-c / D-5: tbody change 委譲ハンドラ (キーボード/Space 等のチェックボックス変更)
function _handleTbodyChange(e) {
  const tbody = e.currentTarget;
  const ctx = tbody._meldexCtx;
  if (!ctx) return;
  const cb = e.target.closest('.row-select-cb');
  if (!cb) return;
  const tbl = ctx.tableId || 'pivot-table';
  const paneRoot = _paneEl(ctx, '#' + tbl) || document;
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
