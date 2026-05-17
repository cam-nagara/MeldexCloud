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
        const result = formulaEvalForEntity(groupPtc.formula, entitiesMap[en], { propTypes, dbPath });
        groupKey = result.error ? '#ERROR' : (result.value === '' ? '(未設定)' : String(result.value));
      } else {
        const entityData = entitiesMap[en] || {};
        const rawVals = Object.prototype.hasOwnProperty.call(entityData, groupByProp) && Array.isArray(entityData[groupByProp])
          ? entityData[groupByProp]
          : [];
        const vals = filterValues(rawVals);
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
    if (tbl && dbPath) {
      tbl.dataset.dbPath = dbPath;
      tbl.dataset.path = dbPath;
    }
    if (dbPath && tbl) CommentBadges.refreshSheet(dbPath, tbl);
  } catch {}
}
