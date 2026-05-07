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
