/* gb-database.js: flattened split script for static cloud hosting. */
/* Source chunk: gb-database.part01.js */
/**
 * Meldex Database Views
 * DB/ピボット/ギャラリー/カンバン/タイムライン、数式、インライン編集
 */
/* 共通 helper は gb-db-core.js に分離 */

/* ==============================
   DB選択・エントリ選択
   ============================== */
function _resolveDatabasePaneContext(ctx, options) {
  const resolveOpts = options || {};
  const paneMissing = !!(ctx?.paneId && typeof GBLayout !== 'undefined' && typeof GBLayout.findNode === 'function' && !GBLayout.findNode(GBLayout.root, ctx.paneId)?.node);
  const containerDetached = !!(ctx?.containerEl && !document.body.contains(ctx.containerEl));
  const shouldUseActivePane = !!resolveOpts.preferActivePane && !!ctx?.paneId && typeof GBLayout !== 'undefined' && !!GBLayout.activePane && ctx.paneId !== GBLayout.activePane;
  if (!ctx || paneMissing || containerDetached || shouldUseActivePane) return _currentPaneState();
  return ctx;
}

function _restoreDbViewScrollState(ctx, viewMode, scrollState) {
  if (!scrollState) return;
  requestAnimationFrame(() => {
    const container = typeof _getDbViewScrollContainer === 'function'
      ? _getDbViewScrollContainer(ctx, viewMode)
      : null;
    if (!container) return;
    if (Number.isFinite(scrollState.scrollLeft)) container.scrollLeft = scrollState.scrollLeft;
    if (Number.isFinite(scrollState.scrollTop)) container.scrollTop = scrollState.scrollTop;
    const focusedEntity = String(scrollState.focusedEntity || '').trim();
    if (!focusedEntity) return;
    const escaped = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(focusedEntity) : focusedEntity.replace(/"/g, '\\"');
    const target = container.querySelector(`[data-entity-name="${escaped}"], [data-entity="${escaped}"]`)
      || document.querySelector(`[data-entity-name="${escaped}"], [data-entity="${escaped}"]`);
    if (!target) return;
    target.classList.add('db-view-focused-entity');
    target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    setTimeout(() => target.classList.remove('db-view-focused-entity'), 1600);
  });
}

async function selectDatabase(dbPath, ctx, opts) {
  const openOpts = opts || {};
  // silent: インラインセル更新等、ローディングオーバーレイを出したくないケース用
  if (!openOpts.bridgeLoad && !openOpts.silent) showLoading('シートを読み込み中...');
  // 別DBへの切替時は一括編集バーを閉じる + 選択 Set をクリア (D-5)
  if (state.currentDbPath !== dbPath) {
    const _ctxClear = ctx || _currentPaneState();
    if (_ctxClear && _ctxClear._selectedEntities) _ctxClear._selectedEntities.clear();
    const paneIdClr = (_ctxClear && _ctxClear.paneId) || 'main';
    const existingBar = document.body.querySelector(`.db-bulk-edit-bar[data-pane-id="${paneIdClr}"]`) || document.getElementById('db-bulk-edit-bar');
    if (existingBar) existingBar.remove();
  }
  try {
  ctx = _resolveDatabasePaneContext(ctx);
  ctx.dbPath = dbPath;
  ctx.entityPath = null;
  // グローバルstate同期（非スコープ化コードの互換性）
  state.currentDbPath = dbPath;
  state.currentEntityPath = null;
  const dbLoadSeq = (ctx._dbLoadSeq || 0) + 1;
  ctx._dbLoadSeq = dbLoadSeq;
  const isStaleDbLoad = () => ctx._dbLoadSeq !== dbLoadSeq || ctx.dbPath !== dbPath || state.currentDbPath !== dbPath;
  if (!openOpts.skipSaveLastView) saveLastView({type:'pivot', dbPath});
  if (!openOpts.skipNavPush) {
    const _navEntry = {type:'pivot', path: dbPath};
    navPush(_navEntry);
  }
  if (!openOpts.skipRecent) addRecent(dbPath.split('/').pop() || '', dbPath, 'database');
  if (!openOpts.skipAutoVersion) startAutoVersion(dbPath, 'db');
  if (!openOpts.skipHistoryScope) historySetScope('db:' + (dbPath.split('/').pop() || dbPath));

  // フォルダツリーで対応するノードをハイライト
  if (!openOpts.skipHighlight) highlightOutlinerNode(dbPath);

  // DBフォルダ名をカテゴリ名として表示
  const dbName = dbPath.split('/').pop() || dbPath;
  if (!openOpts.skipGlobalUi) {
    const toolbarCategoryEl = document.getElementById('toolbar-category');
    if (toolbarCategoryEl) {
      toolbarCategoryEl.textContent = dbName;
      toolbarCategoryEl.title = 'ダブルクリックでシート名を変更';
      if (!toolbarCategoryEl._dbRenameHandler) {
        toolbarCategoryEl._dbRenameHandler = true;
        toolbarCategoryEl.style.cursor = 'text';
        toolbarCategoryEl.addEventListener('dblclick', () => {
          const curName = toolbarCategoryEl.textContent;
          const input = document.createElement('input');
          input.type = 'text'; input.value = curName;
          input.style.cssText = 'font-size:inherit;font-weight:inherit;color:var(--fg);background:var(--bg);border:1px solid var(--blue,#4a90d9);border-radius:3px;padding:0 4px;outline:none;width:' + Math.max(120, toolbarCategoryEl.offsetWidth) + 'px;';
          toolbarCategoryEl.textContent = '';
          toolbarCategoryEl.appendChild(input);
          input.focus(); input.select();
          const commit = async () => {
            const newName = input.value.trim() || curName;
            toolbarCategoryEl.textContent = newName;
            if (newName !== curName && state.currentDbPath) {
              try {
                const oldPath = state.currentDbPath;
                const res = await apiPost('/outliner/rename', { old_path: oldPath, new_name: newName, type: 'database' });
                const newPath = res?.new_path || oldPath.replace(/[^/]+$/, newName);
                if (typeof renameAppPathReferences === 'function') {
                  renameAppPathReferences(oldPath, newPath, { label: newName, fileId: res?.file_id, type: 'database' });
                }
                if (typeof refreshOutliner === 'function') refreshOutliner();
                await selectDatabase(newPath, ctx, {
                  silent: true,
                  skipRecent: true,
                  skipNavPush: true,
                  skipSaveLastView: false,
                });
                showStatus('シート名を変更しました');
              } catch (err) { toolbarCategoryEl.textContent = curName; showStatus('名前変更失敗: ' + err.message, true); }
            }
          };
          input.addEventListener('blur', commit);
          input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); if (e.key === 'Escape') { input.value = curName; input.blur(); } });
        });
      }
    }
    const currentTitleEl = document.getElementById('current-title');
    if (currentTitleEl) currentTitleEl.textContent = dbName;
    const sbCategoryEl = document.getElementById('sb-category');
    if (sbCategoryEl) sbCategoryEl.textContent = 'シート: ' + dbName;
  }

  // 現在のシートビュータイプ復元（カレンダーDBは timeline=カレンダーモード）
  if (Number.isInteger(openOpts.restoreViewIdx)) {
    const cfgForRestore = getDbViewConfig(dbPath);
    if (Array.isArray(cfgForRestore.savedViews) && openOpts.restoreViewIdx >= 0 && openOpts.restoreViewIdx < cfgForRestore.savedViews.length) {
      setCurrentViewIdx(dbPath, openOpts.restoreViewIdx, { skipHistory: true });
    }
  }
  let dbViewMode = getCurrentViewMode(dbPath);
  ctx.viewMode = dbViewMode;
  if (!openOpts.skipShowView) showView(dbViewMode, ctx);

  // テーマ適用: クリア → DB自身のテーマ
  if (!openOpts.skipGlobalUi && typeof clearFileStyleForPanel === 'function') clearFileStyleForPanel('db-view-container');

  // DBメタデータ（actions/backlinks/theme）を取得
  state.dbMetadata = null;
  try {
    const dbMetadata = await apiFetch('/db-metadata?path=' + encodeURIComponent(dbPath));
    if (isStaleDbLoad()) return;
    state.dbMetadata = dbMetadata;
    // DB自身のスタイル（style: 優先、旧 theme: も後方互換で読む）は DB パネルにのみ適用
    const _dbStyle = state.dbMetadata && (state.dbMetadata.style || state.dbMetadata.theme);
    if (!openOpts.skipGlobalUi && _dbStyle && typeof applyFileStyleToPanel === 'function') {
      applyFileStyleToPanel(_dbStyle, 'db-view-container');
    }
  } catch {
    if (isStaleDbLoad()) return;
    state.dbMetadata = { actions: [], backlinks: [], style: null, theme: null, property_types: null, property_layout: null, property_layout_templates: [], publish: null, calendar_mapping: null };
  }

  // localStorage → バックエンドへの自動マイグレーション（property_types）
  // バックエンドの property_types が未設定（undefined/null）かつ localStorage に設定がある場合のみ
  if (state.dbMetadata && state.dbMetadata.property_types != null && Object.keys(state.dbMetadata.property_types).length === 0) {
    const localPt = getDbViewConfig(dbPath).propertyTypes;
    if (localPt && Object.keys(localPt).length > 0) {
      state.dbMetadata.property_types = localPt;
      _savePropertyTypesToBackend(dbPath);
    }
  }

  try {
    const filterParam = getFilterParam();
    const url = '/pivot?path=' + encodeURIComponent(dbPath) + (filterParam ? '&status_filter=' + filterParam : '');
    const pivotData = await apiFetch(url);
    if (isStaleDbLoad()) return;
    ctx.pivotData = pivotData;
    state.pivotData = ctx.pivotData; // グローバル同期
    if (typeof _preloadRelationMapsForDb === 'function') {
      await _preloadRelationMapsForDb(dbPath, ctx.pivotData);
      if (isStaleDbLoad()) return;
    }
    // カレンダーDBは初回表示時にカレンダービューに自動切替
    if (ctx.pivotData.calendar_db && dbViewMode === 'pivot') {
      dbViewMode = 'calendar';
      ctx.viewMode = dbViewMode;
      if (!openOpts.skipShowView) showView('timeline', ctx);
    }
    const entityCountForLoading = Object.keys(ctx.pivotData.entities || {}).length;
    if (!openOpts.bridgeLoad && !openOpts.silent && typeof showLoadingBeforeHeavyWork === 'function') {
      await showLoadingBeforeHeavyWork(entityCountForLoading, '大きいシートを描画中...', { threshold: 250 });
      if (isStaleDbLoad()) return;
    }
    renderDbViewTabs(ctx);
    const hasDbViews = getSavedViews(dbPath).length > 0;
    if (!hasDbViews && typeof renderDbNoViewsGuide === 'function') renderDbNoViewsGuide(ctx);
    else if (dbViewMode === 'gallery') renderGallery(ctx);
    else if (dbViewMode === 'kanban') renderKanban(ctx);
    else if (dbViewMode === 'timeline' || dbViewMode === 'calendar' || dbViewMode === 'tasks' || dbViewMode === 'shifts') renderTimeline(ctx);
    else if (dbViewMode === 'chart' && typeof renderChart === 'function') renderChart(ctx);
    else if (dbViewMode === 'graph' && typeof renderGraph === 'function') renderGraph(ctx);
    else if (dbViewMode === 'form' && typeof renderDbFormView === 'function') renderDbFormView(ctx);
    else renderPivot(ctx);
    _restoreDbViewScrollState(ctx, dbViewMode, openOpts.restoreScrollState);

    const entityNames = Object.keys(ctx.pivotData.entities || {}).sort();
    if (!openOpts.skipGlobalUi) showStatus(`${entityNames.length} 件のエントリ`);

    // マルチソースリレーション自動収集（fire-and-forget）
    if (hasDbViews && dbViewMode === 'pivot' && typeof _autoCollectAllMsrProps === 'function') {
      _autoCollectAllMsrProps(dbPath, ctx);
    }

    // テンプレートはメニュー/ツールバーから手動で適用
  } catch (e) {
    if (isStaleDbLoad()) return;
    ctx.pivotData = null;
    state.pivotData = null;
    state.dbMetadata = null;
    clearPivot(ctx);
  }
  if (!openOpts.skipGlobalUi) _syncDetailPanel(dbName, dbPath, 'database');
  // エンティティ追加/削除/リネーム後にリンク辞書を更新
  if (typeof MeldexAutoLink !== 'undefined') MeldexAutoLink.scheduleReload(3000);
  } finally { if (!openOpts.bridgeLoad && !openOpts.silent) hideLoading(); }
}

async function selectEntity(entityPath, opts) {
  const openOpts = opts || {};
  const entityLoadSeq = (window._selectEntityLoadSeq || 0) + 1;
  window._selectEntityLoadSeq = entityLoadSeq;
  state.currentEntityPath = entityPath;
  if (!openOpts.skipStateView) state.view = 'entity';
  if (!openOpts.skipSaveLastView) saveLastView({type:'entity', entityPath});
  const _entityDisplayName = (entityPath.split('/').pop() || '').replace(/\.md$/, '');
  const currentTitleEl = document.getElementById('current-title');
  if (currentTitleEl && !openOpts.skipGlobalUi) currentTitleEl.textContent = _entityDisplayName;
  if (!openOpts.skipRecent) addRecent(_entityDisplayName, entityPath, 'entity');
  if (!openOpts.skipNavPush) {
    const _navEntry = {type:'entity', path: entityPath};
    navPush(_navEntry);
  }

  // フォルダツリーで対応するノードをハイライト
  if (!openOpts.skipHighlight) highlightOutlinerNode(entityPath);

  const entityFreeText = document.getElementById('entity-freetext');
  if (entityFreeText) entityFreeText.dataset.entityNoteCreated = '0';
  const entityRtToolbar = document.getElementById('entity-rt-toolbar');
  if (entityRtToolbar) entityRtToolbar.style.display = 'none';

  if (!openOpts.skipShowView) showView('entity');

  try {
    const data = await apiFetch('/entity?path=' + encodeURIComponent(entityPath));
    if (window._selectEntityLoadSeq !== entityLoadSeq || state.currentEntityPath !== entityPath) return;
    renderEntityPage(data);
    const entityName = _entityDisplayName;
    if (!openOpts.skipGlobalUi) {
      showStatus(`エントリ: ${entityName}`);
      _syncDetailPanel(entityName, entityPath, 'entity');
    }
  } catch (e) {
    // error shown by apiFetch
    if (state.currentEntityPath === entityPath) state.currentEntityPath = null;
    if (state.view === 'entity' && !openOpts.skipShowView) showView('welcome');
  }
}


/* ==============================
   フィルタ
   ============================== */
function setFilter(f, options = {}) {
  state.filter = f || 'disabled';
  if (state.currentDbPath && typeof _saveCurrentDbViewField === 'function') {
    _saveCurrentDbViewField(state.currentDbPath, '', '', { skipHistory: true }, (v) => {
      v.filter = state.filter;
    });
  }
  _updateFilterBadge();
  if (!options.skipReload && state.currentDbPath) selectDatabase(state.currentDbPath);
}

function filterValues(values, status) {
  if (!values) return [];
  // 第2引数 status 指定時は、その特定ステータスのみを返す（候補値書き換え時のガードレール用途）
  // status 未指定時は state.filter (adopted/nobotsu/all) に従ってステータスフィルタを適用
  if (status != null) {
    return values.filter(v => (v?.status || '採用') === status);
  }
  let result = values;
  // ステータスフィルタのみ適用（高度フィルタはプロパティ名が必要なためapplyAdvancedFiltersで適用）
  if (state.filter === 'adopted') result = result.filter(v => v.status === '採用' || v.status === '掲載済み');
  else if (state.filter === 'nobotsu') result = result.filter(v => v.status !== 'ボツ');
  return result;
}

// 候補値配列から「書き換え対象の採用値」を取得する標準ヘルパー。
// 候補値[0] を直接参照すると、先頭が案/ボツ候補だった場合にそれを破壊してしまうため、
// 候補値の書き換え前は必ず本関数で採用値を取得すること。
// 採用値が存在しない場合は null を返し、呼び出し側で新規追加（_apiPostValue）する責務。
function getAdoptedValueForWrite(values) {
  if (!Array.isArray(values) || values.length === 0) return null;
  const adopted = [
    ...filterValues(values, '採用'),
    ...filterValues(values, '掲載済み'),
  ];
  return adopted.length ? adopted[0] : null;
}
window.getAdoptedValueForWrite = getAdoptedValueForWrite;

function getFilterParam() {
  if (state.filter === 'adopted') return '採用,掲載済み';
  if (state.filter === 'nobotsu') return '採用,掲載済み,案';
  return '';
}

function _updateFilterBadge() {
  const badge = document.getElementById('filter-badge');
  if (!badge) return;
  const dbPath = state.currentDbPath;
  const advCount = dbPath ? (getAdvancedFilters(dbPath) || []).length : 0;
  const statusLabel = state.filter === 'adopted' ? '採用のみ' : state.filter === 'nobotsu' ? 'ボツ非表示' : state.filter === 'all' ? '全表示' : '';
  const labels = [];
  if (statusLabel) labels.push(statusLabel);
  if (advCount) labels.push(advCount + '件');
  badge.textContent = labels.join(' + ');
  badge.style.display = labels.length ? '' : 'none';
}

/* 統合フィルタUI → gb-db-table.js に分離 */

/* ==============================
   ピボットテーブル描画
   ============================== */
function clearPivot(ctx) {
  ctx = ctx || _currentPaneState();
  const tblId = ctx.tableId || 'pivot-table';
  const thead = _paneEl(ctx, '#' + tblId + ' thead');
  const tbody = _paneEl(ctx, '#' + tblId + ' tbody');
  const tfoot = _paneEl(ctx, '#' + tblId + ' tfoot');
  if (thead) thead.innerHTML = '';
  if (tbody) tbody.innerHTML = '';
  if (tfoot) tfoot.innerHTML = '';
  document.getElementById('sb-count').textContent = '0 件';
}

/* PROP_TYPE_ICON → gb-db-props.js に分離 */

/* ==============================
   D-4-a: tbody click イベント委譲 (Phase 0 D-4)
   ============================== */

// 新規エントリ行クリック → 新規作成 + 即リネーム
/* ピボット描画・委譲処理 → gb-db-table.js に分離 */

/* ==============================
   Notion風インライン編集ヘルパー
   ============================== */

// ヘッダーのインラインリネーム
/* インライン編集・キーボードナビゲーション → gb-db-inline-edit.js に分離 */

function _dbScope() { return state.currentDbPath ? 'db:' + state.currentDbPath.split('/').pop() : ''; }

function _dbUndoValue(label, val, oldValue, newValue, oldRichHtml, newRichHtml) {
  const dbPath = state.currentDbPath;
  const scope = _dbScope();
  const undoUpdates = { new_value: oldValue };
  const redoUpdates = { new_value: newValue };
  if (oldRichHtml !== undefined || newRichHtml !== undefined) {
    undoUpdates.new_rich_html = oldRichHtml || '';
    redoUpdates.new_rich_html = newRichHtml || '';
  }
  historyPush(label,
    async () => { await _apiPutValue(val, undoUpdates); if (dbPath) await selectDatabase(dbPath, undefined, { silent: true }); },
    async () => { await _apiPutValue(val, redoUpdates); if (dbPath) await selectDatabase(dbPath, undefined, { silent: true }); },
    scope
  );
}
// ペアリレーション対応Undo（ペア側も自動で戻す）
function _dbUndoPairValue(label, val, oldValue, newValue, pairDbPath, targetId, pairProp, sourceId, wasAdding, oldTargetId, entityPath, cascadeClears, bidirectionalCtx) {
  const dbPath = state.currentDbPath;
  const scope = _dbScope();
  historyPush(label,
    async () => {
      await _apiPutValue(val, { new_value: oldValue });
      if (pairDbPath && pairProp && sourceId) {
        _relationCache[pairDbPath] = null;
        if (targetId) await _syncPairRelation(pairDbPath, targetId, pairProp, sourceId, !wasAdding);
        if (oldTargetId) await _syncPairRelation(pairDbPath, oldTargetId, pairProp, sourceId, true);
      }
      if (bidirectionalCtx && typeof _applyBidirectionalRelationSync === 'function') {
        await _applyBidirectionalRelationSync({
          sourceDbPath: dbPath,
          entityPath: bidirectionalCtx.entityPath,
          propName: bidirectionalCtx.propName,
          ptc: bidirectionalCtx.ptc,
          oldValue: newValue,
          newValue: oldValue,
        });
      }
      if (entityPath && cascadeClears?.length && typeof _restoreCascadeDependentValues === 'function') {
        await _restoreCascadeDependentValues(entityPath, cascadeClears);
      }
      if (dbPath) await selectDatabase(dbPath, undefined, { silent: true });
    },
    async () => {
      await _apiPutValue(val, { new_value: newValue });
      if (pairDbPath && pairProp && sourceId) {
        _relationCache[pairDbPath] = null;
        if (oldTargetId) await _syncPairRelation(pairDbPath, oldTargetId, pairProp, sourceId, false);
        if (targetId) await _syncPairRelation(pairDbPath, targetId, pairProp, sourceId, wasAdding);
      }
      if (bidirectionalCtx && typeof _applyBidirectionalRelationSync === 'function') {
        await _applyBidirectionalRelationSync({
          sourceDbPath: dbPath,
          entityPath: bidirectionalCtx.entityPath,
          propName: bidirectionalCtx.propName,
          ptc: bidirectionalCtx.ptc,
          oldValue,
          newValue,
        });
      }
      if (entityPath && cascadeClears?.length && typeof _redoCascadeDependentValues === 'function') {
        await _redoCascadeDependentValues(entityPath, cascadeClears);
      }
      if (dbPath) await selectDatabase(dbPath, undefined, { silent: true });
    },
    scope
  );
}

function _dbUndoStatus(val, oldStatus, newStatus) {
  const dbPath = state.currentDbPath;
  const scope = _dbScope();
  historyPush('ステータス: ' + oldStatus + ' → ' + newStatus,
    async () => { await _apiPutValue(val, { new_status: oldStatus }); if (dbPath) await selectDatabase(dbPath, undefined, { silent: true }); },
    async () => { await _apiPutValue(val, { new_status: newStatus }); if (dbPath) await selectDatabase(dbPath, undefined, { silent: true }); },
    scope
  );
}
function _dbUndoManualOrder(dbPath, movedNames, oldOrder, oldSortConfig, newOrder) {
  const scope = _dbScope();
  // movedNames は配列。後方互換のため文字列が来た場合は配列に正規化
  const names = Array.isArray(movedNames) ? movedNames : [movedNames];
  const firstName = names[0];
  // sortConfig === null は「未設定（既定の名前順）」を意味する。Undo時はこれを忠実に復元する必要がある
  const apply = (order, sortConfig) => {
    const c = getDbViewConfig(dbPath);
    const view = typeof _getCurrentDbViewConfigEntryFromConfig === 'function'
      ? _getCurrentDbViewConfigEntryFromConfig(c)
      : null;
    const target = view || c;
    if (order) target.manualOrder = [...order]; else delete target.manualOrder;
    if (sortConfig === null) delete target.sortConfig;
    else target.sortConfig = { ...sortConfig };
    saveDbViewConfig(dbPath, c);
    renderPivot();
    setTimeout(() => restoreActiveCellByEntityName(firstName), 50);
    // 移動した全エントリの選択状態を復元（D&D 直前のチェック状態を再現）
    _restoreSelectionByEntityNames(undefined, names);
  };
  const label = names.length > 1 ? `行移動: ${firstName} 他 ${names.length - 1} 件` : `行移動: ${firstName}`;
  historyPush(label,
    () => apply(oldOrder, oldSortConfig),
    () => apply(newOrder, { key: 'manual', dir: 'asc' }),
    scope
  );
}
// リネーム時に view config 内のエントリ名参照（manualOrder 等）を差し替える
// マニュアルソート中に旧名のままだと新名が manualOrder に存在せず末尾に落ちるため必須
function _dbRenameLocalRefs(dbPath, oldName, newName) {
  const c = getDbViewConfig(dbPath);
  let dirty = false;
  const update = (target) => {
    if (!target || !Array.isArray(target.manualOrder)) return;
    const idx = target.manualOrder.indexOf(oldName);
    if (idx >= 0) { target.manualOrder[idx] = newName; dirty = true; }
  };
  update(c);
  (c.savedViews || []).forEach(update);
  if (dirty) saveDbViewConfig(dbPath, c);
}
function _dbUndoRename(dbPath, oldName, newName) {
  const scope = _dbScope();
  // 即時: 直前の rename 成功に追従して manualOrder 等を更新
  _dbRenameLocalRefs(dbPath, oldName, newName);
  historyPush('名前を変更: ' + oldName + ' → ' + newName,
    async () => {
      await apiPost('/entity/rename', { path: _entityPath(dbPath, newName), new_name: oldName });
      _dbRenameLocalRefs(dbPath, newName, oldName);
      await selectDatabase(dbPath);
    },
    async () => {
      await apiPost('/entity/rename', { path: _entityPath(dbPath, oldName), new_name: newName });
      _dbRenameLocalRefs(dbPath, oldName, newName);
      await selectDatabase(dbPath);
    },
    scope
  );
}

/* セル値D&D: エントリ名・候補値をドラッグして他ツールにリンク挿入
   D-9: 行生成ループ内 addEventListener 0 件にするため document 委譲に移行。
   per-element の addEventListener を廃し、data 属性で値を渡す。
*/
/* 値セルUI・ドロップダウン共通 → gb-db-cell-ui.js に分離 */

/* エントリページ描画 → gb-editor.js に移動 */

/* モーダル・メニュー系（値操作・エントリ操作・プロパティ操作） → gb-db-props.js に分離 */

/* 列設定・フィルタモーダル → gb-db-props.js に分離 */

/* プロパティ型システム → gb-db-property-types.js に分離 */

/* 条件付きカラー → gb-db-props.js に分離 */

/* 型別値エディタ・リレーション/選択ドロップダウン → gb-db-value-editors.js に分離 */


// ビュー管理・ギャラリー・カンバン・タイムラインは gb-db-views.js に分離

async function _autoRenameEntity(dbPath, entityName) {
  const newName = _generateEntryName(dbPath, entityName);
  if (!newName || newName === entityName) return;
  try {
    await apiPost('/entity/rename', { path: _entityPath(dbPath, entityName), new_name: newName });
  } catch { /* rename failed silently */ }
}


/* ==============================
   autoFill プレースホルダ評価（§15.4.2 / X4 確定）
   $today / $now / $currentUser / $version を実行時に評価。
   裸文字列は静的リテラルとして返す。
   ============================== */
function _resolveAutoFillPlaceholder(raw) {
  if (typeof raw !== 'string') return raw;
  if (!raw.startsWith('$')) return raw;
  const pad = n => String(n).padStart(2, '0');
  const d = new Date();
  const ymd = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  switch (raw) {
    case '$today':       return ymd;
    case '$now':         return `${ymd} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    case '$currentUser': return (typeof getUsername === 'function' ? getUsername() : '') || '';
    case '$version':     return (window.__meldexVersionCache && window.__meldexVersionCache.version) || '';
    default: return raw; // 未定義の $xxx は警告せず生のまま返す
  }
}

// バージョン文字列を /api/version から事前取得してキャッシュ（$version 用）
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

/* ==============================
   エントリ作成時 自動初期値充填（§12.1 Phase 0）
   property_types.<prop>.autoFillOnCreate が定義されていれば、値を自動書き込み。
   overrides に含まれるプロパティは R8 に従いスキップ（呼び出し側明示指定を尊重）。
   ============================== */
async function _autoFillOnCreate(dbPath, entityPath, overrides) {
  if (!dbPath || !entityPath) return;
  const ov = overrides || {};
  const ptypes = getPropertyTypes(dbPath);
  const needsVersion = Object.values(ptypes).some(p => p && p.autoFillOnCreate === '$version');
  if (needsVersion) await _fetchVersionCache();
  for (const [pName, ptc] of Object.entries(ptypes)) {
    if (!ptc || !('autoFillOnCreate' in ptc)) continue;
    if (Object.prototype.hasOwnProperty.call(ov, pName)) continue; // R8: 明示指定優先
    const lockMsg = (typeof checkColumnEditable === 'function') ? checkColumnEditable(dbPath, pName) : '';
    if (lockMsg) continue;
    const resolved = _resolveAutoFillPlaceholder(ptc.autoFillOnCreate);
    if (resolved === '' || resolved == null) continue;
    const writeStatus = ptc.writeStatus || '案'; // X5: 既存実態に合わせた既定
    try {
      await _apiPostValue(entityPath, pName, resolved, writeStatus, '');
    } catch { /* 失敗は黙殺: 他の autoFill に影響させない */ }
  }
}

/* ==============================
   ステータス連動 自動日時入力
   ============================== */
async function _autoFillOnStatusChange(entityPath, propName, newStatus, dbPath) {
  if (!dbPath) return;
  const ptypes = getPropertyTypes(dbPath);
  // $version を使う場合は事前取得（新形式 autoFillOnStatus: {status: "$version"} のみ該当）
  const needsVersion = Object.values(ptypes).some(p => {
    const a = p && p.autoFillOnStatus;
    return a && typeof a === 'object' && a[newStatus] === '$version';
  });
  if (needsVersion) await _fetchVersionCache();
  for (const [pName, ptc] of Object.entries(ptypes)) {
    // 互換: 従来は autoFillOnStatus: "ステータス名" (date型のみ、値は現在日時) だったが、
    // 新仕様では autoFillOnStatus: { "ステータス名": "$version" | "$now" | 静的値 } 形式も受容
    let fillVal = null;
    if (ptc.autoFillOnStatus === newStatus && ptc.type === 'date') {
      // 旧形式: date型は現在日時で埋める
      fillVal = '__legacy_date__';
    } else if (ptc.autoFillOnStatus && typeof ptc.autoFillOnStatus === 'object' && newStatus in ptc.autoFillOnStatus) {
      fillVal = _resolveAutoFillPlaceholder(ptc.autoFillOnStatus[newStatus]);
    }
    if (fillVal == null) continue;
    if (fillVal === '__legacy_date__') {
      // ロック列は自動入力をスキップ
      const lockMsg = checkColumnEditable(dbPath, pName);
      if (lockMsg) continue;
      const now = typeof _dbDateCurrentValue === 'function'
        ? _dbDateCurrentValue(ptc)
        : new Date().toISOString().slice(0, 19);

      // エントリパスを特定（旧形式: val.fileは候補値ファイルなので currentEntityPath を使う）
      let ep = entityPath;
      if (ep && !ep.endsWith('.md')) {
        // 旧形式フォルダパスの場合はそのまま使う
      } else if (ep && ep.endsWith('.md')) {
        // 新形式の場合はそのまま（エントリ.md）
        // ただし旧形式の候補値ファイル（例: ステータス_採用.md）の場合は currentEntityPath を使う
        const parts = ep.replace(/\\/g, '/').split('/');
        const fname = parts[parts.length - 1].replace(/\.md$/, '');
        if (fname.includes('_') && state.currentEntityPath) {
          ep = state.currentEntityPath;
        }
      }
      if (!ep) continue;

      // 既存値があるか確認
      if (state.pivotData) {
        // エントリ名: パスの末尾から取得
        const epParts = ep.replace(/\\/g, '/').split('/');
        const entName = epParts[epParts.length - 1].replace(/\.md$/, '');
        const ent = state.pivotData.entities[entName];
        if (ent) {
          const existing = (ent[pName] || []).find(v => v.status === '採用' || v.status === '掲載済み');
          if (existing) {
            await _apiPutValue(existing, { new_value: now });
            // Step 3 補正: ローカル pivotData の値も同期。
            // 同期しないと partial update 経路で他セルが古い値のまま表示される
            existing.value = now;
          } else {
            await _apiPostValue(ep, pName, now, '採用', '');
          }
          continue;
        }
      }
      // pivotDataがない場合は新規追加
      await _apiPostValue(ep, pName, now, '採用', '');
    } else {
      // 新形式: プレースホルダ評価済みの値を書き込む（型制約なし）
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

/* ==============================
   変更ログモーダル（互換フォールバック）
   ============================== */
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
        <button data-action="this.closest('.modal-overlay').remove()" style="background:none;border:none;color:var(--fg2);font-size:18px;cursor:pointer;">✕</button>
      </div>
      <div style="padding:8px 16px;border-bottom:1px solid var(--border);display:flex;gap:8px;">
        <input id="audit-filter-entity" type="text" placeholder="エントリで絞り込み" style="flex:1;padding:4px 8px;font-size:12px;background:var(--bg);color:var(--fg);border:1px solid var(--border);border-radius:3px;">
        <input id="audit-filter-prop" type="text" placeholder="プロパティで絞り込み" style="flex:1;padding:4px 8px;font-size:12px;background:var(--bg);color:var(--fg);border:1px solid var(--border);border-radius:3px;">
      </div>
      <div id="audit-log-list" style="flex:1;overflow-y:auto;padding:8px 16px;font-size:12px;"></div>
      <div id="audit-log-pager" style="padding:8px 16px;border-top:1px solid var(--border);display:flex;justify-content:center;gap:8px;font-size:12px;"></div>
    </div>`;
  document.body.appendChild(modal);
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });

  let _auditOffset = 0;
  const _auditLimit = 100;

  async function _loadAuditLogs() {
    const entity = document.getElementById('audit-filter-entity').value.trim();
    const prop = document.getElementById('audit-filter-prop').value.trim();
    let url = '/db-audit-log?path=' + encodeURIComponent(dbPath)
      + '&limit=' + _auditLimit + '&offset=' + _auditOffset;
    if (entity) url += '&entity=' + encodeURIComponent(entity);
    if (prop) url += '&prop=' + encodeURIComponent(prop);
    try {
      const data = await apiFetch(url);
      _renderAuditLogList(data.logs, data.total);
    } catch {
      document.getElementById('audit-log-list').innerHTML =
        '<div style="color:var(--fg2);padding:16px;text-align:center;">履歴の取得に失敗しました</div>';
    }
  }

  function _renderAuditLogList(logs, total) {
    const container = document.getElementById('audit-log-list');
    if (!logs.length) {
      container.innerHTML = '<div style="color:var(--fg2);padding:16px;text-align:center;">履歴がありません</div>';
      document.getElementById('audit-log-pager').innerHTML = '';
      return;
    }

    const actionLabels = {
      'add_value': '値追加', 'update_value': '値変更', 'delete_value': '値削除',
      'update_status': 'ステータス変更', 'create_entity': 'エントリ作成',
      'rename_entity': '名前を変更', 'delete_entity': 'エントリ削除'
    };

    container.innerHTML = logs.map(log => {
      const time = new Date(log.timestamp).toLocaleString('ja-JP');
      const action = actionLabels[log.action] || log.action;
      let detail = '';
      if (log.action === 'update_value') {
        detail = '\u201c' + (log.old_value || '').slice(0, 40) + '\u201d → \u201c' + (log.new_value || '').slice(0, 40) + '\u201d';
      } else if (log.action === 'update_status') {
        detail = (log.old_status || '') + ' → ' + (log.new_status || '');
      } else if (log.action === 'add_value') {
        detail = '\u201c' + (log.new_value || '').slice(0, 40) + '\u201d';
      } else if (log.action === 'rename_entity') {
        detail = '\u201c' + (log.old_value || '') + '\u201d → \u201c' + (log.new_value || '') + '\u201d';
      }
      return '<div style="padding:6px 0;border-bottom:1px solid var(--border);display:flex;gap:8px;align-items:baseline;">'
        + '<span style="color:var(--fg2);min-width:130px;flex-shrink:0;">' + esc(time) + '</span>'
        + '<span style="color:var(--accent);min-width:60px;flex-shrink:0;">' + esc(log.user) + '</span>'
        + '<span style="font-weight:bold;min-width:70px;flex-shrink:0;">' + esc(action) + '</span>'
        + '<span style="color:var(--fg);">' + esc(log.entity_name)
          + (log.property_name ? ' / ' + esc(log.property_name) : '') + '</span>'
        + (detail ? '<span style="color:var(--fg2);margin-left:auto;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:250px;">' + esc(detail) + '</span>' : '')
        + '</div>';
    }).join('');

    // ページャー
    const pager = document.getElementById('audit-log-pager');
    const totalPages = Math.ceil(total / _auditLimit);
    const currentPage = Math.floor(_auditOffset / _auditLimit) + 1;
    if (totalPages <= 1) { pager.innerHTML = ''; return; }
    pager.innerHTML = '';
    if (currentPage > 1) {
      const prev = document.createElement('button');
      prev.textContent = '← 前';
      prev.style.cssText = 'padding:2px 8px;font-size:12px;cursor:pointer;background:var(--bg);color:var(--fg);border:1px solid var(--border);border-radius:3px;';
      prev.addEventListener('click', () => { _auditOffset -= _auditLimit; _loadAuditLogs(); });
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
      next.addEventListener('click', () => { _auditOffset += _auditLimit; _loadAuditLogs(); });
      pager.appendChild(next);
    }
  }

  // 絞り込みリスナー
  let _filterTimer;
  document.getElementById('audit-filter-entity').addEventListener('input', () => {
    clearTimeout(_filterTimer);
    _filterTimer = setTimeout(() => { _auditOffset = 0; _loadAuditLogs(); }, 300);
  });
  document.getElementById('audit-filter-prop').addEventListener('input', () => {
    clearTimeout(_filterTimer);
    _filterTimer = setTimeout(() => { _auditOffset = 0; _loadAuditLogs(); }, 300);
  });

  _loadAuditLogs();
}

/* 複数エントリの一括編集 → gb-db-bulk-edit.js に分離 */

/* Source chunk: gb-database.part02.js */
/* 複数エントリの一括編集 → gb-db-bulk-edit.js に分離 */

// スマートDBは gb-db-smart.js に分離
