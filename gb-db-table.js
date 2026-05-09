/* gb-db-table.js: flattened split script for static cloud hosting. */
/* Source chunk: gb-db-table.part01.js */
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
function _handleCheckboxClick(e, cb, ctx) {
  const tbl = ctx.tableId || 'pivot-table';
  const paneRoot = _paneEl(ctx, '#' + tbl) || document;
  const allCbs = [...paneRoot.querySelectorAll('.row-select-cb')];
  const sel = ctx._selectedEntities;
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
      }
      // クリックされた cb もネイティブのトグルで反転している可能性があるので、targetState に揃える
      cb.checked = targetState;
      cb.closest('tr')?.classList.toggle('row-selected', targetState);
      const enClicked = cb.dataset.entityName;
      if (sel && enClicked) { if (targetState) sel.add(enClicked); else sel.delete(enClicked); }
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
      _executeButtonActions(dbPath, entityName, ptc?.actions || []);
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
  if (ctx._selectedEntities && enPd) {
    if (newState) ctx._selectedEntities.add(enPd);
    else ctx._selectedEntities.delete(enPd);
  }
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
  if (ctx._selectedEntities && enPo) {
    if (newState) ctx._selectedEntities.add(enPo);
    else ctx._selectedEntities.delete(enPo);
  }
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
async function _handleGroupDrop(ctx, draggedNames, newGroupKey) {
  const dbPath = ctx.dbPath;
  const groupByProp = getGroupBy(dbPath);
  if (!groupByProp) return;
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
  for (const name of draggedNames) {
    const ed = entities[name];
    if (!ed) continue;
    const vals = ed[groupByProp] || [];
    const visibleVals = filterValues(vals);
    // 表示上のグループを決めている値を優先、なければ採用 or 掲載済み、最後に先頭値
    let target = visibleVals[0]
      || vals.find(v => v.status === '採用')
      || vals.find(v => v.status === '掲載済み')
      || vals[0];
    try {
      if (shouldClear) {
        const targets = [...vals].sort((a, b) => (b.candidate_index ?? 0) - (a.candidate_index ?? 0));
        for (const v of targets) {
          if (v.candidate_index != null && v.file) await _apiPutValue(v, { _delete: true });
          else if (v.file) await apiPost('/outliner/delete', { path: v.file });
        }
        ed[groupByProp] = [];
      } else if (target && target.file) {
        await _apiPutValue(target, { new_value: newGroupKey });
        target.value = newGroupKey;
      } else {
        const ep = _entityPath(dbPath, name);
        await _apiPostValue(ep, groupByProp, newGroupKey, '採用', '');
      }
      updated++;
    } catch (e) { /* error shown */ }
  }
  if (updated > 0) {
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
  const orderedDragged = order.filter(n => draggedSet.has(n));
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
  if (ctx._selectedEntities && en) {
    if (cb.checked) ctx._selectedEntities.add(en);
    else ctx._selectedEntities.delete(en);
  }
  _updateBulkEditBar(ctx);
}

// D-4-b: tbody dblclick 委譲ハンドラ
function _handleTbodyDblclick(e) {
  const tbody = e.currentTarget;
  const ctx = tbody._meldexCtx;
  if (!ctx) return;
  const target = e.target;
  // エントリ名セル (col-entity, new-entity-row 以外) の dblclick → メインパネルで開く
  const colEntityTd = target.closest('td.col-entity');
  if (colEntityTd && !colEntityTd.closest('tr.new-entity-row')) {
    e.stopPropagation();
    const entityName = colEntityTd.closest('tr')?.dataset?.entityName;
    if (entityName) {
      if (typeof _navPushWithViewState === 'function') _navPushWithViewState(ctx, entityName);
      selectEntity(_entityPath(ctx.dbPath, entityName));
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
      showDbCardContextMenu(ev, c.dbPath, entityName);
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
  gtd.colSpan = visibleProps.length + 2;
  const collapsed = _isGroupCollapsed(ctx, groupKey);
  gtd.innerHTML = `<span class="group-toggle ${collapsed ? 'collapsed' : ''}">\u25BC</span>${esc(groupByProp)}: ${esc(groupKey)}<span class="group-count">${names.length} 件</span>`;
  gtr.appendChild(gtd);
  return gtr;
}

function renderEntityCell(entityName, propName, ctx, options) {
  const { propTypes, entitiesMap, dbPath, advFilters, pinnedCols, savedWidths, thumbSize, selectedCols } = options;
  const entityData = entitiesMap[entityName];
  const td = document.createElement('td');
  td.dataset.propName = propName;
  if (typeof _dbE2eId === 'function') {
    td.dataset.e2eId = _dbE2eId(ctx, 'cell', entityName, propName);
  }
  td.setAttribute('role', 'cell');
  td.tabIndex = -1;
  td.setAttribute('aria-label', `${entityName} / ${propName}`);
  if ((selectedCols || []).includes(propName)) td.classList.add('col-selected');
  const rawValues = entityData[propName] || [];
  let values = filterValues(rawValues);
  if (advFilters.length > 0) values = applyAdvancedFilters(values, propName, advFilters);
  let colorValues = values;

  if (pinnedCols.includes(propName)) {
    td.classList.add('col-pinned');
    td.style.left = options.pLeftOffset + 'px';
    options.pLeftOffset += (savedWidths[propName] || 100);
  }

  const container = document.createElement('div');
  container.className = 'cell-values';

  const ptc = propTypes[propName];

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
    } else if (ptc.source === 'modified' && metaVal) {
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
  else if (ptc && ptc.type === 'rollup' && ptc.relationProp && typeof calcRollupValue === 'function') {
    const span = document.createElement('span');
    span.className = 'db-cell-display-text';
    span.style.cssText = 'font-size:13px;color:var(--fg2);';
    span.textContent = '...';
    container.appendChild(span);
    colorValues = [];
    calcRollupValue(entityName, entitiesMap, ptc, propTypes).then(val => {
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
      const cc = getCellColor(displayValue, propName, dbPath);
      if (cc) { td.style.background = cc.bg; td.style.color = cc.fg; }
    }).catch(() => { span.textContent = '#ERR'; span.style.color = 'var(--red)'; });
  }
  // ボタン型: 値を持たず、常にボタンを表示 (click は tbody 委譲で処理)
  else if (ptc && ptc.type === 'button') {
    const btn = document.createElement('button');
    btn.className = 'db-action-btn';
    btn.textContent = ptc.label || '実行';
    container.appendChild(btn);
  }
  // マルチソースリレーション型
  else if (ptc && ptc.type === 'multi-source-relation') {
    const ep = _entityPath(dbPath, entityName);
    const val = values.length > 0 ? values[0] : { value: '', status: '採用' };
    container.appendChild(createTypedValueElement(val, ep, propName, thumbSize, ptc));
  }
  // チャット型
  else if (ptc && ptc.type === 'chat') {
    const ep = _entityPath(dbPath, entityName);
    const val = values.length > 0 ? values[0] : { value: '', status: '採用' };
    container.appendChild(createTypedValueElement(val, ep, propName, thumbSize, ptc));
  }
  // 画像型: 空セルでも D&D 用のプレースホルダを表示
  else if (ptc && ptc.type === 'image') {
    const ep = _entityPath(dbPath, entityName);
    const val = values.length > 0
      ? values[0]
      : { value: '', status: '採用', file: ep, property: propName, candidate_index: null };
    container.appendChild(createTypedValueElement(val, ep, propName, thumbSize, ptc));
  }
  // 数式型: 値ファイルではなく計算結果を表示
  else if (ptc && ptc.type === 'formula' && ptc.formula) {
    const result = formulaEvalForEntity(ptc.formula, entityData);
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
    values.forEach(val => {
      container.appendChild(
        ptc ? createTypedValueElement(val, _entityPath(dbPath, entityName), propName, thumbSize, ptc)
            : createValueElement(val, _entityPath(dbPath, entityName), propName, thumbSize)
      );
    });

    // ステータス機能 OFF の DB では複数候補値追加を許可しない
    const _statusOn = getStatusEnabled(dbPath);
    const _allowAdd = (!ptc || ptc.type !== 'button') && (_statusOn || values.length === 0);
    if (_allowAdd) {
      const addBtn = document.createElement('span');
      addBtn.className = 'cell-add-btn';
      addBtn.innerHTML = lucide('plus', 14);
      addBtn.title = '候補値を追加';
      // click は tbody 委譲で処理
      container.appendChild(addBtn);
    }
  }

  td.appendChild(container);
  // 条件付きカラー
  const cellValues = colorValues.map(v => v.value).join(', ');
  const cc = getCellColor(cellValues, propName, dbPath);
  if (cc) { td.style.background = cc.bg; td.style.color = cc.fg; }

  // click は tbody 委譲で処理 (空セル/アクティブセル切替は _handleTbodyClick 内)

  return td;
}

/* Source chunk: gb-db-table.part02.js */
function renderEntityRow(entityName, ctx, options) {
  const { visibleProps, propTypes, entitiesMap, entityNames, dbPath, condFmt, thumbSize, savedWidths, advFilters, pinnedCols, selectedCols, _entityW, _tbl, _tblId } = options;
  const entityData = entitiesMap[entityName];
  const tr = document.createElement('tr');
  tr.dataset.entityName = entityName;
  tr.setAttribute('role', 'row');
  // エントリD&D並べ替え (draggable は維持。dragstart/dragend/dragover/dragleave/drop は tbody 委譲)
  tr.draggable = true;

  if (condFmt) {
    const mainStatus = getEntityMainStatus(entityData);
    if (mainStatus === '掲載済み') tr.className = 'row-status-published';
    else if (mainStatus === '採用') tr.className = 'row-status-adopted';
    else if (mainStatus === '案') tr.className = 'row-status-draft';
    else if (mainStatus === 'ボツ') tr.className = 'row-status-rejected';
  }

  const tdName = document.createElement('td');
  tdName.className = 'col-entity';
  tdName.setAttribute('role', 'rowheader');
  tdName.setAttribute('aria-label', `エントリ: ${entityName}`);
  if ((selectedCols || []).includes('__entity__')) tdName.classList.add('col-selected');
  tdName.style.width = _entityW + 'px';
  tdName.style.minWidth = _entityW + 'px';

  const nameMain = document.createElement('div');
  nameMain.className = 'entity-name-cell-main';

  // ＋ボタン (エントリ追加: クリック=下に追加 / Alt+クリック=上に追加)
  const addRowBtn = document.createElement('span');
  addRowBtn.className = 'row-add-btn';
  addRowBtn.title = 'クリックで下にエントリを追加 / Alt+クリックで上に追加';
  addRowBtn.innerHTML = lucide('plus', 12);
  addRowBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    e.preventDefault();
    const position = e.altKey ? 'above' : 'below';
    _handleInsertRowRelative(ctx, entityName, position);
  });
  // ドラッグ起点にしないため preventDefault
  addRowBtn.addEventListener('mousedown', (e) => e.stopPropagation());
  nameMain.appendChild(addRowBtn);

  // 行ドラッグハンドル (tr.draggable は既に true。視覚的な掴み所として表示)
  const dragHandle = document.createElement('span');
  dragHandle.className = 'row-drag-handle';
  dragHandle.title = 'ドラッグして並び替え';
  dragHandle.innerHTML = lucide('gripVertical', 12);
  nameMain.appendChild(dragHandle);

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
  // cb pointerdown / pointerover (pointerenter 代替) / change / click は tbody 委譲で処理
  nameMain.appendChild(cb);

  const nameSpan = document.createElement('span');
  nameSpan.className = 'entity-name-label';
  nameSpan.textContent = entityName;
  nameSpan.style.paddingLeft = '4px';
  nameSpan.draggable = true;
  // nameSpan dragstart / dragend は tbody 委譲で処理
  tdName.style.cursor = 'pointer';
  // tdName click / dblclick は tbody 委譲で処理 (openEntityInSplit / startEntityInlineRename)
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
  nameMain.appendChild(moreBtn);
  tdName.appendChild(nameMain);

  // tr contextmenu は tbody 委譲 (_handleTbodyContextmenu) で処理

  // エントリ名の下にリレーションリンクを表示
  const allRelations = [];
  Object.values(entityData).forEach(vals => {
    if (!Array.isArray(vals)) return;
    vals.forEach(v => {
      if (v.relations && v.relations.length > 0) v.relations.forEach(r => allRelations.push(r));
    });
  });
  if (allRelations.length > 0) {
    // リレーションリンクを追加（既存のcheckbox・nameSpanは保持）
    tdName.style.whiteSpace = 'normal';

    const relDiv = document.createElement('div');
    relDiv.className = 'relation-links';
    allRelations.slice(0, 3).forEach(r => {
      const link = document.createElement('span');
      link.className = 'relation-link';
      link.textContent = r.entity || '';
      link.title = r.role || '';
      link.dataset.dbPath = r.db_path || r.dbPath || r.database || dbPath;
      link.dataset.entityName = r.entity || '';
      // click は tbody 委譲 (_handleRelationLinkClick) で処理
      relDiv.appendChild(link);
    });
    if (allRelations.length > 3) {
      const more = document.createElement('span');
      more.style.cssText = 'font-size:11px;color:var(--fg2);';
      more.textContent = '+' + (allRelations.length - 3);
      relDiv.appendChild(more);
    }
    tdName.appendChild(relDiv);
  }
  tr.appendChild(tdName);

  const cellOpts = { propTypes, entitiesMap, dbPath, advFilters, pinnedCols, savedWidths, thumbSize, selectedCols, pLeftOffset: _entityW };
  visibleProps.forEach(propName => {
    tr.appendChild(renderEntityCell(entityName, propName, ctx, cellOpts));
  });

  // ＋プロパティ列の空セル
  const tdAddCol = document.createElement('td');
  tdAddCol.className = 'col-add-prop-cell';
  tdAddCol.setAttribute('role', 'cell');
  tr.appendChild(tdAddCol);

  return tr;
}

function renderNewEntryRow(ctx, options) {
  const { visibleProps, entitiesMap, dbPath, selectedCols, _tbl, _entityW } = options;
  const newTr = document.createElement('tr');
  newTr.className = 'new-entity-row';
  newTr.setAttribute('role', 'row');

  const tdName = document.createElement('td');
  tdName.className = 'col-entity';
  tdName.setAttribute('role', 'cell');
  tdName.setAttribute('aria-label', '新規エントリを追加');
  if ((selectedCols || []).includes('__entity__')) tdName.classList.add('col-selected');
  tdName.style.cssText = 'cursor:pointer;color:var(--fg2);width:' + _entityW + 'px;min-width:' + _entityW + 'px;';
  tdName.innerHTML = `<span class="ico" style="margin-right:4px;">${lucide('plus',14)}</span><span>新規</span>`;
  // click は tbody 委譲 (_handleNewEntryClick) で処理
  newTr.appendChild(tdName);

  visibleProps.forEach(propName => {
    const td = document.createElement('td');
    td.setAttribute('role', 'cell');
    td.setAttribute('aria-label', `新規 / ${propName}`);
    if ((selectedCols || []).includes(propName)) td.classList.add('col-selected');
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
  const table = typeof _currentPivotTable === 'function' ? _currentPivotTable(ctx) : document.getElementById('pivot-table');
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

function _setupDbColumnResizeHandleA11y(handle, th, colIndex, propName, dbPath) {
  if (!handle || !th) return;
  handle.tabIndex = 0;
  handle.setAttribute('role', 'separator');
  handle.setAttribute('aria-orientation', 'vertical');
  handle.setAttribute('aria-label', `${propName === '__entity__' ? 'エントリ名' : propName} 列幅を調整`);
  const applyWidth = (width) => {
    const nextWidth = Math.max(60, Math.round(width));
    th.style.width = nextWidth + 'px';
    th.style.minWidth = nextWidth + 'px';
    handle.setAttribute('aria-valuenow', String(nextWidth));
    const table = th.closest('table');
    if (table) {
      table.querySelectorAll('tbody tr, tfoot tr').forEach(tr => {
        const cell = tr.children[colIndex];
        if (cell) {
          cell.style.width = nextWidth + 'px';
          cell.style.minWidth = nextWidth + 'px';
        }
      });
    } else if (typeof setColWidth === 'function') {
      setColWidth(colIndex, nextWidth);
    }
    if (dbPath && propName && typeof setColWidthPersist === 'function') {
      setColWidthPersist(dbPath, propName, nextWidth, {
        label: 'シート表示: 列幅',
        detail: propName,
      });
    }
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

function _dbClampInt(value, min, max, fallback) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function _dbCellDisplayConfig(dbPath) {
  const cfg = getDbViewConfig(dbPath);
  const overflow = cfg.cellTextOverflow === 'clip' ? 'clip' : 'wrap';
  const lines = _dbClampInt(cfg.cellWrapLines, 1, 10, 10);
  return { overflow, lines };
}

function syncDbCellDisplayToolbar(dbPath) {
  const btn = document.getElementById('btn-db-cell-wrap');
  if (!btn) return;
  const cfg = _dbCellDisplayConfig(dbPath);
  const active = cfg.overflow === 'wrap';
  const iconName = active ? 'wrapText' : 'scissors';
  btn.classList.toggle('active', active);
  btn.innerHTML = (typeof lucide === 'function') ? lucide(iconName, 16) : '';
  btn.title = active ? `折返し (${cfg.lines}行まで)` : '切り詰め';
  btn.setAttribute('aria-label', btn.title);
}

function setDbCellTextDisplay(dbPath, overflow, lines, options = {}) {
  if (!dbPath) return;
  const cfg = getDbViewConfig(dbPath);
  cfg.cellTextOverflow = overflow === 'clip' ? 'clip' : 'wrap';
  cfg.cellWrapLines = _dbClampInt(lines, 1, 10, cfg.cellWrapLines || 10);
  saveDbViewConfig(dbPath, cfg, {
    historyLabel: options.label || 'シート表示: セル折返し',
    historyDetail: cfg.cellTextOverflow === 'wrap' ? `${cfg.cellWrapLines}行` : '切り詰め',
    skipHistory: options.skipHistory === true,
  });
  const ctx = options.ctx
    || (typeof _dbPaneContextFromEvent === 'function' ? _dbPaneContextFromEvent(options.event, { dbPath }) : null)
    || (typeof _currentPaneState === 'function' ? _currentPaneState() : null);
  if (typeof _renderCurrentDbView === 'function') _renderCurrentDbView(ctx, dbPath);
  else if (typeof renderPivot === 'function') renderPivot(ctx);
}

function showDbCellWrapMenu(event) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }
  const ctx = typeof _dbPaneContextFromEvent === 'function'
    ? _dbPaneContextFromEvent(event, { dbPath: state.currentDbPath })
    : _currentPaneState();
  const dbPath = ctx?.dbPath || state.currentDbPath;
  if (!dbPath) return;
  document.querySelectorAll('.db-cell-wrap-menu').forEach(el => el.remove());
  const cfg = _dbCellDisplayConfig(dbPath);
  const menu = document.createElement('div');
  menu.className = 'gb-context-menu db-cell-wrap-menu';
  menu.style.minWidth = '180px';

  const addItem = (label, icon, active, action) => {
    const item = document.createElement('div');
    item.className = 'gb-context-menu-item' + (active ? ' active' : '');
    item.innerHTML = lucide(icon, 14) + ' ' + label;
    item.addEventListener('click', () => {
      action();
      menu.remove();
    });
    menu.appendChild(item);
  };

  addItem('折り返し', 'wrapText', cfg.overflow === 'wrap', () => {
    setDbCellTextDisplay(dbPath, 'wrap', cfg.lines, { ctx, event });
  });
  addItem('切り詰め', 'scissors', cfg.overflow === 'clip', () => {
    setDbCellTextDisplay(dbPath, 'clip', cfg.lines, { ctx, event });
  });

  const row = document.createElement('label');
  row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:6px 10px;font-size:12px;color:var(--fg);';
  const label = document.createElement('span');
  label.textContent = '最大行数';
  const input = document.createElement('input');
  input.type = 'number';
  input.min = '1';
  input.max = '10';
  input.value = String(cfg.lines);
  input.style.cssText = 'width:56px;padding:2px 4px;background:var(--bg);color:var(--fg);border:1px solid var(--border);border-radius:3px;';
  const applyLines = () => {
    const nextLines = _dbClampInt(input.value, 1, 10, cfg.lines);
    input.value = String(nextLines);
    setDbCellTextDisplay(dbPath, 'wrap', nextLines, { ctx, event });
  };
  input.addEventListener('change', applyLines);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      applyLines();
      menu.remove();
    }
  });
  row.appendChild(label);
  row.appendChild(input);
  menu.appendChild(row);

  const x = event?.clientX ?? 16;
  const y = event?.clientY ?? 16;
  const z = parseFloat(document.documentElement.style.zoom) || 1;
  menu.style.left = (x / z) + 'px';
  menu.style.top = (y / z) + 'px';
  document.body.appendChild(menu);
  if (typeof clampPopupToViewport === 'function') clampPopupToViewport(menu);
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

function _dbTextLengthForWidth(text) {
  const lines = String(text ?? '').split(/\r?\n/);
  const longest = lines.reduce((max, line) => Math.max(max, [...line].length), 0);
  return Math.max(longest, [...String(text ?? '').replace(/\r?\n/g, '')].length);
}

function _dbEstimateWrapLines(text, widthChars) {
  const width = Math.max(1, widthChars || 1);
  const lines = String(text ?? '').split(/\r?\n/);
  return lines.reduce((sum, line) => {
    const len = Math.max(1, [...line].length);
    return sum + Math.ceil(len / width);
  }, 0);
}

function _dbTextForProp(entityName, propName, data, propTypes, advFilters) {
  const entityData = data?.entities?.[entityName] || {};
  const ptc = propTypes?.[propName];
  if (ptc?.source) {
    const metaVal = entityData['_' + ptc.source] ?? '';
    return metaVal == null ? '' : String(metaVal);
  }
  if (ptc?.type === 'formula' && ptc.formula && typeof formulaEvalForEntity === 'function') {
    const result = formulaEvalForEntity(ptc.formula, entityData);
    return result?.error ? '' : String(result?.value ?? '');
  }
  let values = entityData[propName] || [];
  if (typeof filterValues === 'function') values = filterValues(values);
  if (advFilters?.length && typeof applyAdvancedFilters === 'function') {
    values = applyAdvancedFilters(values, propName, advFilters);
  }
  return values.map(v => v?.value == null ? '' : String(v.value)).filter(Boolean).join(', ');
}

function _dbAutoWidthCharsForTexts(texts, headerText) {
  const values = texts.filter(Boolean);
  const lengths = values.map(_dbTextLengthForWidth);
  const avg = lengths.length ? lengths.reduce((a, b) => a + b, 0) / lengths.length : 0;
  let chars = Math.max(4, Math.ceil(Math.max(avg, [...String(headerText || '')].length)));
  chars = Math.min(10, chars);
  if (values.some(text => _dbEstimateWrapLines(text, 10) > 3)) chars = Math.max(chars, 20);
  if (values.some(text => _dbEstimateWrapLines(text, 20) > 10)) chars = Math.max(chars, 30);
  if (values.some(text => _dbEstimateWrapLines(text, 30) > 10)) {
    const longest = lengths.length ? Math.max(...lengths) : chars;
    chars = Math.max(chars, Math.min(50, Math.ceil(longest / 10) * 10));
  }
  return Math.min(50, Math.max(4, chars));
}

function _dbAutoWidthCharsForEntryNames(entityNames) {
  const base = _dbAutoWidthCharsForTexts(entityNames, 'エントリ名');
  const maxNameLen = entityNames.length
    ? Math.max(...entityNames.map(name => _dbTextLengthForWidth(name)))
    : 0;
  return Math.max(base, Math.min(36, maxNameLen));
}

function _dbWidthPxFromChars(chars) {
  return Math.max(60, Math.min(640, Math.round(chars * 12 + 28)));
}

const DB_ENTITY_AUTO_WIDTH_CHROME_PX = 74;

function _dbEntityWidthPxFromChars(chars) {
  return Math.max(120, Math.min(640, _dbWidthPxFromChars(chars) + DB_ENTITY_AUTO_WIDTH_CHROME_PX));
}

function autoFitCurrentSheetColumns(event) {
  const ctx = typeof _dbPaneContextFromEvent === 'function'
    ? _dbPaneContextFromEvent(event, { dbPath: state.currentDbPath })
    : _currentPaneState();
  const data = ctx?.pivotData || state.pivotData;
  const dbPath = ctx?.dbPath || state.currentDbPath;
  if (!dbPath || !data?.entities) return;
  const viewMode = typeof _dbCurrentViewModeForContext === 'function'
    ? _dbCurrentViewModeForContext(ctx, dbPath)
    : (typeof getCurrentViewMode === 'function' ? getCurrentViewMode(dbPath) : 'pivot');
  if (viewMode === 'timeline' && typeof autoFitTimelineColumns === 'function') {
    autoFitTimelineColumns(ctx, dbPath);
    return;
  }
  if (viewMode !== 'pivot') {
    if (typeof showStatus === 'function') showStatus('列幅自動調整はテーブル表示とタイムライン表示で利用できます', true);
    return;
  }
  const cfg = getDbViewConfig(dbPath);
  const before = typeof captureDbViewConfigHistory === 'function' ? captureDbViewConfigHistory(dbPath) : null;
  const hiddenCols = getHiddenCols(dbPath);
  const propTypes = getPropertyTypes(dbPath);
  const advFilters = getAdvancedFilters(dbPath);
  const colOrder = getColOrder(dbPath);
  let props = colOrder ? [...colOrder] : [...(data.properties || [])];
  props = [...new Set(props)];
  (data.properties || []).forEach(p => { if (!props.includes(p)) props.push(p); });
  Object.keys(propTypes || {}).forEach(p => { if (!props.includes(p)) props.push(p); });
  const visibleProps = props.filter(p => !hiddenCols.includes(p));
  const entityNames = Object.keys(data.entities || {});
  const currentView = typeof _getCurrentDbViewConfigEntryFromConfig === 'function'
    ? _getCurrentDbViewConfigEntryFromConfig(cfg)
    : null;
  const widthTarget = currentView || cfg;

  widthTarget.colWidths = { ...(widthTarget.colWidths || {}) };
  const entityChars = _dbAutoWidthCharsForEntryNames(entityNames);
  widthTarget.colWidths.__entity__ = _dbEntityWidthPxFromChars(entityChars);
  visibleProps.forEach(propName => {
    const texts = entityNames.map(name => _dbTextForProp(name, propName, data, propTypes, advFilters));
    widthTarget.colWidths[propName] = _dbWidthPxFromChars(_dbAutoWidthCharsForTexts(texts, propName));
  });
  cfg.cellWrapLines = _dbClampInt(cfg.cellWrapLines, 1, 10, 10);
  saveDbViewConfig(dbPath, cfg, { skipHistory: true });
  if (typeof pushDbViewConfigHistory === 'function' && typeof captureDbViewConfigHistory === 'function') {
    pushDbViewConfigHistory(dbPath, 'シート表示: 列幅自動調整', before, captureDbViewConfigHistory(dbPath), '全列');
  }
  renderPivot(ctx);
  if (typeof showStatus === 'function') showStatus('列幅を自動調整しました');
}

function renderPivot(ctx) {
  ctx = typeof _normalizeDbRenderContext === 'function' ? _normalizeDbRenderContext(ctx) : (ctx || _currentPaneState());
  const data = ctx.pivotData || state.pivotData;
  if (!data || !data.properties || !data.entities) { clearPivot(ctx); return; }

  const dbPath = ctx.dbPath || state.currentDbPath;
  const hiddenCols = getHiddenCols(dbPath);
  const pinnedCols = getPinnedCols(dbPath);
  const colOrder = getColOrder(dbPath);
  const condFmt = getConditionalFormat(dbPath);
  const thumbSize = getThumbnailSize(dbPath);
  const savedWidths = getColWidths(dbPath);
  const advFilters = getAdvancedFilters(dbPath);
  const propTypes = getPropertyTypes(dbPath);
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
  const visibleProps = props.filter(p => !hiddenCols.includes(p));

  const entitiesMap = data.entities;
  // エントリのソート（ソート設定に基づく）
  const sortCfg = (typeof getDbSortConfig === 'function' ? getDbSortConfig(dbPath) : getDbViewConfig(dbPath).sortConfig)
    || { key: 'name', dir: 'asc' };
  const manualOrder = typeof getDbManualOrder === 'function' ? getDbManualOrder(dbPath) : getDbViewConfig(dbPath).manualOrder;
  let entityNames = Object.keys(entitiesMap);
  if (sortCfg.key === 'manual' && manualOrder) {
    const order = manualOrder;
    entityNames.sort((a, b) => {
      const ia = order.indexOf(a), ib = order.indexOf(b);
      if (ia < 0 && ib < 0) return a.localeCompare(b);
      if (ia < 0) return 1; if (ib < 0) return -1;
      return ia - ib;
    });
  } else if (sortCfg.key === 'name') {
    entityNames.sort((a, b) => sortCfg.dir === 'desc' ? b.localeCompare(a) : a.localeCompare(b));
  } else {
    // プロパティ値でソート — 採用/掲載済み値を型に応じて比較
    const sortType = (propTypes?.[sortCfg.key]?.type) || 'text';
    const _adoptedStr = (v) => {
      if (!Array.isArray(v)) return v == null ? '' : String(v);
      const picked = v.find(x => x && (x.status === '採用' || x.status === '掲載済み'))
                  || v.find(x => x && x.status === '案')
                  || v[0];
      return picked && picked.value != null ? String(picked.value) : '';
    };
    const _toNum = (s) => { const n = parseFloat(s); return isNaN(n) ? null : n; };
    const _toDate = (s) => { const t = Date.parse(s); return isNaN(t) ? null : t; };
    entityNames.sort((a, b) => {
      const sa = _adoptedStr(entitiesMap[a]?.[sortCfg.key]);
      const sb = _adoptedStr(entitiesMap[b]?.[sortCfg.key]);
      // 空値は常に末尾へ
      if (!sa && !sb) return 0;
      if (!sa) return 1;
      if (!sb) return -1;
      let cmp;
      if (sortType === 'number' || sortType === 'formula') {
        const na = _toNum(sa), nb = _toNum(sb);
        if (na != null && nb != null) cmp = na - nb;
        else if (na != null) cmp = -1;
        else if (nb != null) cmp = 1;
        else cmp = sa.localeCompare(sb);
      } else if (sortType === 'date') {
        const da = _toDate(sa), db = _toDate(sb);
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
  // Step 2: チャンク分割中の D&D で manualOrder 初期化に使う (DOM 未完成時のフォールバック)
  ctx._lastEntityNames = entityNames;
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
  const entityColumnPinned = typeof getEntityColumnPinned === 'function'
    ? getEntityColumnPinned(dbPath)
    : gridCfg.entityColumnPinned !== false;
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
    const cellDisplay = _dbCellDisplayConfig(dbPath);
    tblEl.dataset.cellOverflow = cellDisplay.overflow;
    tblEl.dataset.cellWrapLines = String(cellDisplay.lines);
    tblEl.style.setProperty('--db-cell-wrap-lines', String(cellDisplay.lines));
  }
  syncDbCellDisplayToolbar(dbPath);

  // ヘッダー
  const headerRow = document.createElement('tr');
  headerRow.setAttribute('role', 'row');
  const th0 = document.createElement('th');
  th0.className = 'col-entity-header';
  th0.dataset.e2eId = _dbE2eId(ctx, 'column-header', 'entity');
  _setupDbColumnHeaderA11y(th0, 'エントリ名');
  if (selectedCols.includes('__entity__')) th0.classList.add('col-selected');
  th0.style.position = entityColumnPinned ? 'sticky' : 'relative';
  th0.style.left = entityColumnPinned ? '0px' : '';
  th0.style.zIndex = entityColumnPinned ? '11' : '';
  // エントリ名列の幅（永続化）
  const _entityW = (savedWidths['__entity__'] || 120);
  th0.style.width = _entityW + 'px';
  th0.style.minWidth = _entityW + 'px';
  const th0Label = document.createElement('span');
  th0Label.className = 'th-label';
  th0Label.textContent = 'エントリ名';
  th0.appendChild(th0Label);
  const th0MoreBtn = document.createElement('span');
  th0MoreBtn.className = 'th-more-btn entity-th-more-btn';
  th0MoreBtn.innerHTML = lucide('moreHorizontal', 14);
  th0MoreBtn.title = '列メニュー';
  th0MoreBtn.setAttribute('aria-label', 'エントリ名列メニュー');
  th0MoreBtn.style.cssText = 'position:absolute;right:14px;top:50%;transform:translateY(-50%);opacity:0;padding:2px 3px;border-radius:3px;cursor:pointer;background:var(--bg2);display:inline-flex;align-items:center;transition:opacity 0.1s;z-index:2;';
  th0MoreBtn.addEventListener('mouseenter', () => { th0MoreBtn.style.background = 'var(--bg4)'; });
  th0MoreBtn.addEventListener('mouseleave', () => { th0MoreBtn.style.background = 'var(--bg2)'; });
  th0MoreBtn.addEventListener('click', (e) => { e.stopPropagation(); showEntityColMenu(e); });
  th0.appendChild(th0MoreBtn);
  th0.style.cursor = 'pointer';
  th0.addEventListener('mouseenter', () => { th0MoreBtn.style.opacity = '1'; });
  th0.addEventListener('mouseleave', () => { th0MoreBtn.style.opacity = '0'; });
  th0.addEventListener('contextmenu', (e) => { e.preventDefault(); showEntityColMenu(e); });
  if (typeof addLongPressHandler === 'function') {
    addLongPressHandler(th0, (e) => showEntityColMenu(e));
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
  _setupDbColumnResizeHandleA11y(th0Handle, th0, 0, '__entity__', dbPath);
  th0Handle.addEventListener('pointerdown', (e) => startColResize(e, th0, 0, '__entity__'));
  th0Handle.addEventListener('click', (e) => { e.stopPropagation(); });
  th0Handle.addEventListener('dblclick', (e) => { e.stopPropagation(); });
  th0.appendChild(th0Handle);
  // D&D受け取り（他の列をエントリ名列の左側にドロップ）
  th0.addEventListener('dragover', (e) => {
    if (!e.dataTransfer.types.includes('text/x-col-name')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    th0.classList.add('col-drop-right');
  });
  th0.addEventListener('dragleave', () => th0.classList.remove('col-drop-right'));
  th0.addEventListener('drop', (e) => {
    e.preventDefault();
    const fromName = e.dataTransfer.getData('text/x-col-name');
    th0.classList.remove('col-drop-right');
    if (!fromName) return;
    // エントリ名列の直後に移動 = visible 列の先頭。hidden 列は末尾保持
    const arr = visibleProps.filter(n => n !== fromName);
    arr.unshift(fromName);
    const oldOrder = getColOrder(dbPath) || [];
    const hiddenInOrder = oldOrder.filter(n => hiddenCols.includes(n) && !arr.includes(n));
    setColOrder(dbPath, [...arr, ...hiddenInOrder]);
    renderPivot(ctx);
  });
  headerRow.appendChild(th0);

  let pinnedLeftOffset = _entityW; // エントリ列の幅
  visibleProps.forEach((p, i) => {
    const th = document.createElement('th');
    const ptcHeader = propTypes[p];
    th.dataset.prop = p;
    th.dataset.e2eId = _dbE2eId(ctx, 'column-header', p);
    _setupDbColumnHeaderA11y(th, p);
    const w = savedWidths[p] || 100;
    th.style.width = w + 'px';
    th.style.minWidth = w + 'px';
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

    // 列ロック / sourceインジケータ
    const _ptcHeader2 = propTypes[p];
    if (_ptcHeader2 && _ptcHeader2.source) {
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
      th.style.left = pinnedLeftOffset + 'px';
      pinnedLeftOffset += w;
    }

    // ホバー表示の「...」ボタン（メニュー起動）
    const moreBtn = document.createElement('span');
    moreBtn.className = 'th-more-btn';
    moreBtn.innerHTML = lucide('moreHorizontal', 14);
    moreBtn.title = '列メニュー';
    moreBtn.style.cssText = 'position:absolute;right:14px;top:50%;transform:translateY(-50%);opacity:0;padding:2px 3px;border-radius:3px;cursor:pointer;background:var(--bg2);display:inline-flex;align-items:center;transition:opacity 0.1s;z-index:2;';
    moreBtn.addEventListener('mouseenter', () => { moreBtn.style.background = 'var(--bg4)'; });
    moreBtn.addEventListener('mouseleave', () => { moreBtn.style.background = 'var(--bg2)'; });
    moreBtn.addEventListener('click', (e) => { e.stopPropagation(); showColHeaderMenu(e, p, i); });
    th.appendChild(moreBtn);
    th.style.position = 'relative';
    th.addEventListener('mouseenter', () => { moreBtn.style.opacity = '1'; });
    th.addEventListener('mouseleave', () => { moreBtn.style.opacity = '0'; });

    // リサイズハンドル
    const handle = document.createElement('div');
    handle.className = 'col-resize-handle';
    handle.dataset.e2eId = _dbE2eId(ctx, 'column-resize', p);
    _setupDbColumnResizeHandleA11y(handle, th, i + 1, p, dbPath);
    handle.addEventListener('pointerdown', (e) => startColResize(e, th, i + 1, p));
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
      if (!fromName || fromName === p) return;
      // 現在表示中の visible 順序を起点にする (colOrder が古い場合の防御)
      // visibleProps は forEach 外のクロージャから参照できる
      const arr = visibleProps.filter(n => n !== fromName);
      const idx = arr.indexOf(p);
      const insertIdx = idx >= 0 ? idx + (isLeft ? 0 : 1) : arr.length;
      arr.splice(insertIdx, 0, fromName);
      // hidden 列は元の colOrder の順序のまま末尾に保持
      const oldOrder = getColOrder(dbPath) || [];
      const hiddenInOrder = oldOrder.filter(n => hiddenCols.includes(n) && !arr.includes(n));
      const newOrder = [...arr, ...hiddenInOrder];
      setColOrder(dbPath, newOrder);
      renderPivot(ctx);
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
      if (!selectedCols.includes(p) || selectedCols.length > 1 || selectedCols.includes('__entity__')) {
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
      startHeaderInlineRename(th, p, dbPath);
    });

    // 右クリックメニュー ＋ 長押しで同メニュー（タッチ/ペン）
    th.addEventListener('contextmenu', (e) => { e.preventDefault(); showColHeaderMenu(e, p, i); });
    if (typeof addLongPressHandler === 'function') {
      addLongPressHandler(th, (e) => showColHeaderMenu(e, p, i));
    }
    headerRow.appendChild(th);
  });

  // ＋プロパティ追加列（ヘッダー末尾）
  const thAdd = document.createElement('th');
  thAdd.className = 'col-add-prop';
  thAdd.dataset.e2eId = _dbE2eId(ctx, 'column-add-prop');
  _setupDbColumnHeaderA11y(thAdd, 'プロパティを追加');
  thAdd.style.cssText = 'width:36px;min-width:36px;text-align:center;cursor:pointer;color:var(--fg2);padding:0;';
  thAdd.title = 'プロパティを追加';
  thAdd.innerHTML = lucide('plus', 16);
  thAdd.addEventListener('click', () => {
    const order = getColOrder(dbPath) || [...props];
    let idx = 1, name = 'プロパティ';
    while (order.includes(name)) { idx++; name = 'プロパティ' + idx; }
    order.push(name);
    setColOrder(dbPath, order, { skipHistory: true });
    setPropertyType(dbPath, name, { type: 'text' });
    renderPivot(ctx);
    // 追加直後にヘッダーをインラインリネームモードにする
    setTimeout(() => {
      const newTh = _paneEl(ctx, _tbl(`thead th[data-prop="${name}"]`));
      if (newTh) startHeaderInlineRename(newTh, name, dbPath);
    }, 30);
  });
  thAdd.onmouseenter = () => { if (!thAdd.querySelector('input')) thAdd.style.color = 'var(--accent)'; };
  thAdd.onmouseleave = () => { if (!thAdd.querySelector('input')) thAdd.style.color = 'var(--fg2)'; };
  headerRow.appendChild(thAdd);

  thead.innerHTML = '';
  thead.appendChild(headerRow);

  // ボディ
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
        const result = formulaEvalForEntity(groupPtc.formula, entitiesMap[en]);
        groupKey = result.error ? '#ERROR' : (result.value === '' ? '(未設定)' : String(result.value));
      } else {
        const vals = filterValues(entitiesMap[en][groupByProp] || []);
        groupKey = vals.length > 0 ? vals[0].value : '(未設定)';
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
    selectedCols, _entityW, _tbl, _tblId,
  };

  // 行生成タスクをフラット化 (グループヘッダー + エントリ行を順序通りに並べる)
  // チャンク分割レンダリングで使用 (Step2)
  const rowTasks = [];
  groupedEntities.forEach((names, groupKey) => {
    if (groupKey !== '') {
      rowTasks.push({ kind: 'group', groupKey, names });
      if (_isGroupCollapsed(ctx, groupKey)) return;
    }
    names.forEach(entityName => {
      rowTasks.push({ kind: 'entity', entityName });
    });
  });

  const paneRoot = _paneEl(ctx, _tbl()) || document;
  if (paneRoot._dragSelectPointerUp) document.removeEventListener('pointerup', paneRoot._dragSelectPointerUp);
  paneRoot._dragSelectPointerUp = () => { paneRoot._dragSelectState = null; };
  document.addEventListener('pointerup', paneRoot._dragSelectPointerUp);

  // 常に末尾に「＋新規エントリ」行を表示（Notion風）
  // チャンク分割中、エントリ行はこの行の前に insertBefore で挿入する。これで thead/tfoot/新規行の順序が常に確定する。
  const newEntryRow = renderNewEntryRow(ctx, { visibleProps, entitiesMap, dbPath, selectedCols, _tbl, _entityW });
  tbody.appendChild(newEntryRow);

  // フッター集計行 (entityNames は確定済みなので即時計算)
  renderPivotFooter(visibleProps, entitiesMap, entityNames, pinnedCols, savedWidths, propTypes, ctx);

  const countEl = document.getElementById('sb-count');
  if (countEl) countEl.textContent = entityNames.length + ' 件';

  // ----- Step 2: チャンク分割レンダリング -----
  // 中断トークン: ctx._renderToken に Symbol を割り振る。
  // 後続の renderPivot 呼び出し / destroyPaneContext 等で _renderToken が変わると進行中チャンクは破棄される。
  const renderToken = Symbol('renderPivot');
  ctx._renderToken = renderToken;
  ctx._renderInProgress = true;
  ctx._renderTotalRows = rowTasks.length;
  ctx._renderDoneRows = 0;

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
    tbody.insertBefore(frag, newEntryRow);
    ctx._renderDoneRows = endIdx;
    if (endIdx < rowTasks.length) {
      // 残りを idle callback で処理
      const _ric = window.requestIdleCallback || ((cb) => setTimeout(cb, 0));
      _ric(() => _renderChunk(endIdx));
    } else {
      ctx._renderInProgress = false;
      // Phase 2e-ii-b: 全チャンク完了後にセルコメントバッジを描画
      _refreshSheetBadges(ctx);
      if (typeof _appendBacklinkSummaryColumns === 'function') _appendBacklinkSummaryColumns(ctx);
    }
  };

  // 最初の CHUNK_SIZE 行は同期で生成 → 即座に表示
  if (rowTasks.length > 0) {
    _renderChunk(0);
  } else {
    ctx._renderInProgress = false;
    _refreshSheetBadges(ctx);
    if (typeof _appendBacklinkSummaryColumns === 'function') _appendBacklinkSummaryColumns(ctx);
  }
}

function _refreshSheetBadges(ctx) {
  if (typeof CommentBadges === 'undefined') return;
  try {
    const dbPath = ctx?.dbPath || (typeof state !== 'undefined' ? state.currentDbPath : '');
    const tableId = (ctx && ctx.tableId) || 'pivot-table';
    const tbl = _paneEl(ctx, '#' + tableId) || document.querySelector('#pivot-table') || document.querySelector('table.pivot-table');
    if (dbPath && tbl) CommentBadges.refreshSheet(dbPath, tbl);
  } catch {}
}

