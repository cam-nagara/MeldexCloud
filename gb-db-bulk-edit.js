/* シート一括編集・複数選択 UI — gb-database.js から分離 */

function _ensureSelectedEntities(ctx) {
  const c = ctx || _currentPaneState();
  if (!c) return null;
  let selected = c._selectedEntities;
  if (!selected || typeof selected.add !== 'function' || typeof selected.delete !== 'function') {
    try { c._selectedEntities = new Set(); } catch {}
    selected = c._selectedEntities;
  }
  if (!selected || typeof selected.add !== 'function' || typeof selected.delete !== 'function') return null;
  return selected;
}

function _getSelectedEntities(ctx) {
  const c = ctx || _currentPaneState();
  const selected = _ensureSelectedEntities(c);
  if (!c || !selected) return [];
  const ents = c.pivotData?.entities;
  if (ents) {
    [...selected].forEach(name => {
      if (ents[name] === undefined) selected.delete(name);
    });
  }
  return [...selected];
}

function _dbRowSelectionSurface(ctx) {
  if (typeof _dbTreeIsCurrentView === 'function' && _dbTreeIsCurrentView(ctx, ctx.dbPath)) {
    return ctx.containerEl?.querySelector('.tree-view .db-tree-list')
      || document.querySelector('#tree-view .db-tree-list');
  }
  return _paneEl(ctx, '#' + (ctx.tableId || 'pivot-table'));
}

function _setPaneAllRowsSelected(ctx, shouldSelect) {
  const c = ctx || _currentPaneState();
  const selected = _ensureSelectedEntities(c);
  if (!c || !selected) return false;
  const table = _dbRowSelectionSurface(c);
  const paneRoot = table || c.containerEl || document;
  const entityNames = shouldSelect && Array.isArray(c._lastEntityNames)
    ? c._lastEntityNames.filter(Boolean)
    : [];
  const nameSet = new Set(entityNames);

  selected.clear();
  nameSet.forEach(name => selected.add(name));
  let lastChecked = null;
  paneRoot.querySelectorAll('.row-select-cb').forEach(cb => {
    const checked = shouldSelect && nameSet.has(cb.dataset.entityName);
    cb.checked = checked;
    cb.closest('tr, .db-tree-row')?.classList.toggle('row-selected', checked);
    if (checked) lastChecked = cb;
  });
  paneRoot._lastSelectedCb = lastChecked;
  paneRoot._pendingShiftAnchor = null;
  paneRoot._dragSelectState = null;
  c._dragSelectState = null;
  _syncPaneRowSelectHeader(c);
  _updateBulkEditBar(c);
  return true;
}

function _syncPaneRowSelectHeader(ctx) {
  const c = ctx || _currentPaneState();
  if (!c) return;
  const table = _dbRowSelectionSurface(c);
  const checkbox = table?.querySelector?.('.row-select-all-cb');
  if (!checkbox) return;
  const visibleNames = Array.isArray(c._lastEntityNames) ? c._lastEntityNames.filter(Boolean) : [];
  const selected = _ensureSelectedEntities(c);
  const selectedVisibleCount = selected
    ? visibleNames.reduce((count, name) => count + (selected.has(name) ? 1 : 0), 0)
    : 0;
  // 表の全選択チェックボックスは共通部品（MeldexRowHandleMenu。シナリオのタイプ表・キャラ表と同じ）。
  MeldexRowHandleMenu.syncSelectAllCheckbox(checkbox, {
    total: visibleNames.length, selected: selectedVisibleCount, unit: 'トピック',
  });
}

function _createPaneRowSelectHeaderCheckbox(ctx) {
  return MeldexRowHandleMenu.createSelectAllCheckbox({
    e2eId: _dbE2eId(ctx, 'row-select-all', 'header'),
    unit: 'トピック',
    onToggle: shouldSelect => _setPaneAllRowsSelected(ctx, shouldSelect),
  });
}

function _selectAllPaneRows(ctx) {
  return _setPaneAllRowsSelected(ctx, true);
}

function _clearPaneRowSelection(ctx) {
  return _setPaneAllRowsSelected(ctx, false);
}

function _dbActiveCellForRowShortcut() {
  const cell = typeof _dbCurrentVisualActiveCell === 'function'
    ? _dbCurrentVisualActiveCell()
    : (typeof activeCell !== 'undefined' ? activeCell : null);
  if (!cell?.isConnected || !cell.classList?.contains('active-cell')) return null;
  const style = typeof getComputedStyle === 'function' ? getComputedStyle(cell) : null;
  if (style && (style.display === 'none' || style.visibility === 'hidden')) return null;
  if (typeof cell.getClientRects === 'function'
      && cell.getClientRects().length === 0
      && !cell.offsetWidth
      && !cell.offsetHeight) return null;
  return cell;
}

function _dbRowShortcutHasNativeEditor() {
  const target = document.activeElement;
  return !!(target && target.isConnected !== false
    && (target.isContentEditable || target.contentEditable === 'true'
      || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT'));
}

function _dbPaneContextForCanvas(canvas) {
  if (typeof getAllPanes === 'function') {
    const panes = Object.values(getAllPanes() || {});
    const match = panes.find(ctx => ctx?.containerEl?.contains?.(canvas));
    if (match) return match;
  }
  return typeof _currentPaneState === 'function' ? _currentPaneState() : null;
}

function _isPivotBlankCanvasClick(event, canvas) {
  if (!event || event.button !== 0 || event.target !== canvas) return false;
  const rect = canvas.getBoundingClientRect?.();
  if (!rect) return true;
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  return x >= 0 && y >= 0 && x < canvas.clientWidth && y < canvas.clientHeight;
}

document.addEventListener('click', event => {
  const canvas = event.target?.matches?.('#pivot-view, .pivot-view') ? event.target : null;
  if (!canvas || !_isPivotBlankCanvasClick(event, canvas)) return;
  _clearPaneRowSelection(_dbPaneContextForCanvas(canvas));
});

// 単独シートは中央ショートカットレジストリを読み込まないため、同じ行選択操作をここで補完する。
// メイン画面では runMeldexShortcutById が存在するので中央ハンドラだけが処理する。
document.addEventListener('keydown', event => {
  if (typeof runMeldexShortcutById === 'function') return;
  if (event.defaultPrevented || event.isComposing || event.keyCode === 229) return;
  if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return;
  const key = String(event.key || '').toLowerCase();
  if (key !== 'a' && key !== 'd') return;
  const cell = _dbActiveCellForRowShortcut();
  if (!cell || _dbRowShortcutHasNativeEditor()) return;
  const ctx = typeof _dbPaneContextFromEvent === 'function'
    ? _dbPaneContextFromEvent(cell)
    : (typeof _currentPaneState === 'function' ? _currentPaneState() : null);
  if (!ctx) return;
  event.preventDefault();
  if (key === 'a') _selectAllPaneRows(ctx);
  else _clearPaneRowSelection(ctx);
});

// 行の選択が変わった時の同期。表（行ハンドルメニュー移行済み）では一括操作バーを出さない。
// 一括操作は選択中の行のハンドルメニューから行う（UI共通ルール §6「行の選択と一括実行」）。
// 関数名は多数の呼び出し元のため残す。選択見出しの同期と、残っているバーの撤去だけを行う。
// シートのツリービューは行ハンドルメニュー未移行（ルールの未移行台帳）のため、移行まで従来のバーを残す。
function _updateBulkEditBar(ctx) {
  const c = ctx || _currentPaneState();
  const paneId = (c && c.paneId) || 'main';
  const selected = _getSelectedEntities(c);
  _syncPaneRowSelectHeader(c);
  let bar = document.querySelector(`.db-bulk-edit-bar[data-pane-id="${paneId}"]`);
  const treeView = !!(c && typeof _dbTreeIsCurrentView === 'function' && _dbTreeIsCurrentView(c, c.dbPath));
  if (selected.length === 0 || !treeView) {
    if (bar) bar.remove();
    return;
  }
  _updateDbTreeBulkEditBar(c, paneId, selected, bar);
}

function _updateDbTreeBulkEditBar(ctx, paneId, selected, existingBar) {
  const c = ctx;
  const table = _dbRowSelectionSurface(c);
  const host = c?.containerEl || table?.closest?.('.gb-pane-content,.pane-content,#pivot-view,#main-views') || document.getElementById('main-views') || document.body;
  let bar = existingBar;
  if (!bar) {
    bar = document.createElement('div');
    bar.className = 'db-bulk-edit-bar gb-selection-float-bar';
    bar.dataset.paneId = paneId;
    bar.dataset.selectionFloatPaneId = paneId;
    // ペインごとに一意なidにする（従来は固定文字列で、複数ペイン/分割ビューで
    // 同時に一括編集バーを表示するとDOM上にid重複が発生していた）。
    bar.id = 'db-bulk-edit-bar-' + paneId;
    host.appendChild(bar);
  }
  if (window.GBSelectionFloatMenu) {
    window.GBSelectionFloatMenu.bindDrag(bar, { host });
    window.GBSelectionFloatMenu.resetPosition(bar, { host, anchor: table, zIndex: '500' });
  }
  bar.innerHTML = '';
  if (window.GBSelectionFloatMenu) {
    bar.appendChild(window.GBSelectionFloatMenu.createDragHandle());
  }

  const label = document.createElement('span');
  label.className = 'db-bulk-edit-count gb-selection-float-count';
  label.textContent = selected.length + ' 件選択中';
  bar.appendChild(label);

  const editBtn = window.GBSelectionFloatMenu
    ? window.GBSelectionFloatMenu.button('一括編集...', {
        e2eId: 'db-bulk-edit-' + paneId,
        onClick: () => _showBulkEditModal(selected, ctx),
      })
    : document.createElement('button');
  if (!window.GBSelectionFloatMenu) {
    editBtn.textContent = '一括編集...';
    editBtn.dataset.e2eId = 'db-bulk-edit-' + paneId;
    editBtn.addEventListener('click', () => _showBulkEditModal(selected, ctx));
  }
  bar.appendChild(editBtn);

  const addRowsBtn = window.GBSelectionFloatMenu
    ? window.GBSelectionFloatMenu.button('下に ' + selected.length + ' トピック追加')
    : document.createElement('button');
  if (!window.GBSelectionFloatMenu) {
    addRowsBtn.textContent = '下に ' + selected.length + ' トピック追加';
  }
  addRowsBtn.title = '選択中の最後のトピックの下に、選択数と同じだけ新規トピックを追加';
  addRowsBtn.dataset.e2eId = 'db-bulk-add-rows-' + paneId;
  addRowsBtn.addEventListener('click', async () => {
    const c2 = ctx || _currentPaneState();
    const tblSel = '#' + ((c2 && c2.tableId) || 'pivot-table');
    const paneRoot = _paneEl(c2, tblSel) || (!c2 ? document : null);
    if (!paneRoot) return;
    const rows = [...paneRoot.querySelectorAll('tbody tr[data-entity-name]')];
    let lastSelected = null;
    for (const row of rows) {
      if (selected.includes(row.dataset.entityName)) lastSelected = row.dataset.entityName;
    }
    if (!lastSelected) lastSelected = selected[selected.length - 1];
    await _handleInsertRowRelative(c2, lastSelected, 'below', selected.length);
  });
  bar.appendChild(addRowsBtn);

  const clearBtn = window.GBSelectionFloatMenu
    ? window.GBSelectionFloatMenu.button('選択解除', {
        e2eId: 'db-bulk-clear-' + paneId,
        muted: true,
        onClick: () => _clearPaneRowSelection(ctx || _currentPaneState()),
      })
    : document.createElement('button');
  if (!window.GBSelectionFloatMenu) {
    clearBtn.textContent = '選択解除';
    clearBtn.dataset.e2eId = 'db-bulk-clear-' + paneId;
    clearBtn.addEventListener('click', () => _clearPaneRowSelection(ctx || _currentPaneState()));
  }
  bar.appendChild(clearBtn);

  const sep = document.createElement('span');
  sep.style.cssText = 'width:1px;height:20px;background:var(--border);display:inline-block;';
  bar.appendChild(sep);

  const delBtn = window.GBSelectionFloatMenu
    ? window.GBSelectionFloatMenu.button('一括削除...', {
        e2eId: 'db-bulk-delete-' + paneId,
        danger: true,
        onClick: () => _dbRunMenuItemAction(_bulkDeleteEntities, selected, ctx),
      })
    : document.createElement('button');
  if (!window.GBSelectionFloatMenu) {
    delBtn.textContent = '一括削除...';
    delBtn.dataset.e2eId = 'db-bulk-delete-' + paneId;
    delBtn.addEventListener('click', () => _dbRunMenuItemAction(_bulkDeleteEntities, selected, ctx));
  }
  bar.appendChild(delBtn);
}

function _bulkValueSnapshotFromValues(entityName, entityPath, values) {
  return {
    name: entityName,
    path: entityPath,
    values: [...(values || [])].map(v => ({
      value: v?.value == null ? '' : String(v.value),
      status: v?.status || '採用',
      note: v?.note || '',
      rich_html: v?.rich_html || '',
      relations: Array.isArray(v?.relations) ? JSON.parse(JSON.stringify(v.relations)) : [],
      published_in: Array.isArray(v?.published_in) ? JSON.parse(JSON.stringify(v.published_in)) : [],
      created: v?.created || '',
    })),
  };
}

async function _bulkReplaceEntityPropValues(entityPath, prop, values) {
  const entity = await apiFetch('/entity?path=' + encodeURIComponent(entityPath));
  const current = [...((entity?.properties || {})[prop] || [])].sort((a, b) => (b.candidate_index ?? 0) - (a.candidate_index ?? 0));
  for (const v of current) {
    if (v.candidate_index != null && v.file) {
      await _apiPutValue({ file: v.file, entry_path: entityPath, property: prop, candidate_id: v?.candidate_id, entry_id: v?.entry_id, candidate_index: v.candidate_index }, { _delete: true });
    } else if (v.file) {
      await apiPost('/outliner/delete', { path: v.file });
    }
  }
  for (const v of values || []) {
    await _apiPostValue(entityPath, prop, v.value, v.status || '採用', v.note || '', v.rich_html || '', {
      relations: Array.isArray(v.relations) ? v.relations : [],
      published_in: Array.isArray(v.published_in) ? v.published_in : [],
      created: v.created || '',
    });
  }
}

async function _bulkApplyPropSnapshots(dbPath, prop, snapshots, ctx) {
  for (const item of snapshots || []) {
    await _bulkReplaceEntityPropValues(item.path, prop, item.values || []);
  }
  await selectDatabase(dbPath, ctx, { silent: true });
  _restoreSelectionByEntityNames(ctx, (snapshots || []).map(item => item.name));
  _updateBulkEditBar(ctx);
}

function _dbUndoBulkPropEdit(dbPath, prop, beforeSnapshots, afterSnapshots, ctx) {
  if (typeof historyPush !== 'function' || !beforeSnapshots.length || !afterSnapshots.length) return;
  const scope = typeof _dbScope === 'function' ? _dbScope(dbPath) : ('db:' + String(dbPath || '').split('/').pop());
  historyPush(
    `一括編集: ${prop} (${beforeSnapshots.length} 件)`,
    () => _bulkApplyPropSnapshots(dbPath, prop, beforeSnapshots, ctx),
    () => _bulkApplyPropSnapshots(dbPath, prop, afterSnapshots, ctx),
    scope
  );
}

function _dbUndoBulkDeleteEntities(dbPath, deletedItems, ctx) {
  if (typeof historyPush !== 'function' || !deletedItems.length) return;
  const scope = typeof _dbScope === 'function' ? _dbScope(dbPath) : ('db:' + String(dbPath || '').split('/').pop());
  const toTrashRef = (item, res = item) => {
    const src = res && typeof res === 'object' ? res : item;
    return src?.trash_name ? {
      trash_name: src.trash_name,
      trash_root: src.trash_root || '',
      path: item?.path || '',
      name: item?.name || '',
      asset_id: item?.asset_id || item?.assetId || '',
    } : null;
  };
  const historyItems = deletedItems.filter(item => toTrashRef(item));
  if (!historyItems.length) return;
  const names = historyItems.map(item => item.name);
  let trashRefs = historyItems.map(toTrashRef).filter(Boolean);
  const refresh = async (restoreSelection) => {
    await selectDatabase(dbPath, ctx, { silent: true });
    if (restoreSelection) _restoreSelectionByEntityNames(ctx, names);
    else if (ctx && ctx._selectedEntities) names.forEach(n => ctx._selectedEntities.delete(n));
    _updateBulkEditBar(ctx);
  };
  historyPush(
    `一括削除: ${historyItems.length} 件`,
    async () => {
      const failedRefs = [];
      for (const ref of trashRefs) {
        try {
          await apiPost('/outliner/restore', {
            trash_name: ref.trash_name,
            ...(ref.trash_root ? { trash_root: ref.trash_root } : {}),
          });
        } catch {
          failedRefs.push(ref);
          continue;
        }
        try {
          if (window.GbDbCalendarSync && typeof window.GbDbCalendarSync.onEntryRestored === 'function') {
            await window.GbDbCalendarSync.onEntryRestored(dbPath, ref.path);
          }
        } catch {}
      }
      trashRefs = failedRefs;
      await refresh(true);
      if (failedRefs.length) throw new Error(`${failedRefs.length} 件のトピックを復元できませんでした`);
    },
    async () => {
      const redoEntries = historyItems.map(item => ({
        name: item.name,
        path: item.path,
        entryId: item.entry_id || '',
        assetId: item.asset_id || item.assetId || '',
      }));
      const confirmed = typeof MeldexDeleteImpactWarning !== 'undefined'
        ? await MeldexDeleteImpactWarning.authorizeReversibleDelete(
            redoEntries.map(entry => ({
              path: entry.path,
              kind: 'file',
              ...(entry.assetId ? { assetId: entry.assetId } : {}),
            })),
          )
        : { confirmed: true, operation: 'trash' };
      if (!confirmed) throw new Error('削除の参照確認に失敗しました');
      const result = await window.GbDbEntryIdentity.deleteEntries({
        dbPath,
        ctx,
        entries: redoEntries,
        source: 'bulk-delete-redo',
        confirmation: confirmed,
      });
      trashRefs = result.trashRefs.map(toTrashRef).filter(Boolean);
      const calendarWarning = typeof _dbDeleteCalendarSyncWarningMessage === 'function'
        ? _dbDeleteCalendarSyncWarningMessage(result.responses)
        : '';
      if (result.failures.length && typeof showStatus === 'function') {
        showStatus(`やり直しで ${result.failures.length} 件の削除に失敗しました`, true);
      }
      if (calendarWarning && typeof showStatus === 'function') showStatus(calendarWarning, true);
    },
    scope
  );
}

function _showBulkEditModal(entityNames, ctx, options = {}) {
  const dbPath = (ctx && ctx.dbPath) || state.currentDbPath;
  if (!dbPath) return;
  const pivotData = (ctx && ctx.pivotData) || (state.currentDbPath === dbPath ? state.pivotData : null) || {};
  const propTypes = getPropertyTypes(dbPath) || {};
  // pivotData.properties は値のある列だけを持つ。表の見出しと同じく、まだ値の無い列（列タイプだけ設定した列）も
  // 一括編集の対象に含める（含めないと、作ったばかりのリレーション列・ユーザー列などへ一括で値を入れられなかった）。
  const allProps = [...new Set([...(pivotData.properties || []), ...Object.keys(propTypes)])];
  const props = typeof filterDeletedDbProperties === 'function' ? filterDeletedDbProperties(dbPath, allProps) : allProps;
  const statusOn = getStatusEnabled(dbPath);
  const editableProps = props.filter(p => {
    const t = propTypes[p]?.type;
    const lockMsg = (typeof checkColumnEditable === 'function') ? checkColumnEditable(dbPath, p) : '';
    return !lockMsg && !['formula', 'button', 'chat', 'multi-source-relation', 'rollup'].includes(t);
  });
  if (editableProps.length === 0) {
    showStatus('編集可能な列がありません', true);
    return;
  }

  // 行ハンドルメニューから開いた時は、閉じたメニューの項目ではなく押したハンドルへフォーカスを戻す。
  const returnFocus = options?.returnFocus instanceof HTMLElement && options.returnFocus.isConnected
    ? options.returnFocus
    : (document.activeElement instanceof HTMLElement && document.activeElement !== document.body
      ? document.activeElement
      : null);
  const body = document.createElement('div');
  body.innerHTML = `<div class="db-bulk-edit-selection-summary" style="margin:0 0 8px;color:var(--fg2);font-size:12px;line-height:20px;min-height:20px;max-height:80px;overflow-y:auto;flex:0 0 auto;">${entityNames.map(n => esc(n)).join(' / ')}</div>
    <div class="field gb-field-select-row"><label class="gb-label" for="bulk-edit-prop">列</label>
      <select id="bulk-edit-prop" class="gb-select gb-select-column">
        ${editableProps.map(p => `<option value="${esc(p)}">${esc(p)} (${esc(propTypes[p]?.type || 'text')})</option>`).join('')}
      </select>
    </div>
    <div class="field gb-field-select-row"><label class="gb-label" for="bulk-edit-value">値</label><div id="bulk-edit-value-container"></div></div>
    ${statusOn ? `<div class="field gb-field-select-row"><label class="gb-label" for="bulk-edit-status">ステータス</label>
      <select id="bulk-edit-status" class="gb-select gb-select-column">
        <option value="案">案</option>
        <option value="採用" selected>採用</option>
        <option value="ボツ">ボツ</option>
        <option value="掲載済み">掲載済み</option>
      </select>
    </div>` : ''}
    <div class="field" id="bulk-edit-replace-row"><label><input id="bulk-edit-replace" type="checkbox" checked ${statusOn ? '' : 'disabled'}> ${statusOn ? '既存の値を置き換える（チェックなしで候補値として追加）' : '既存の値を置き換える'}</label></div>`;
  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'gb-btn gb-btn-sm';
  cancelBtn.dataset.e2eId = 'db-bulk-edit-cancel';
  cancelBtn.textContent = 'キャンセル';
  const applyBtn = document.createElement('button');
  applyBtn.type = 'button';
  applyBtn.className = 'gb-btn gb-btn-sm gb-btn-primary primary';
  applyBtn.id = 'bulk-edit-apply';
  applyBtn.textContent = '適用';
  const modalApi = window.GBUI.createModal({
    id: 'db-bulk-edit-dialog',
    title: `一括編集 (${entityNames.length} 件)`,
    body,
    footer: [cancelBtn, applyBtn],
    variant: 'standard',
    extraClass: 'db-bulk-edit-modal',
    geometryKey: 'db-bulk-edit',
    initialFocus: '#bulk-edit-prop',
    returnFocus: returnFocus || undefined,
  });
  const overlay = modalApi.overlay;
  overlay.classList.add('modal-overlay');
  overlay.dataset.dbBulkEditModal = '1';
  modalApi.modal.style.width = 'min(560px, calc(100vw - 24px))';
  modalApi.modal.style.maxWidth = 'calc(100vw - 24px)';
  const headerClose = modalApi.header.querySelector('.gb-modal-close');
  if (headerClose) headerClose.dataset.e2eId = 'db-bulk-edit-close-icon';
  cancelBtn.addEventListener('click', () => modalApi.close('cancel'));
  modalApi.open();

  let renderValueInputSeq = 0;
  const renderValueInput = async (propName) => {
    const renderSeq = ++renderValueInputSeq;
    const ptc = propTypes[propName] || { type: 'text' };
    const container = document.getElementById('bulk-edit-value-container');
    if (!container) return;
    container._dateEditor = null;
    container.innerHTML = '';
    const isStaleRender = () => renderSeq !== renderValueInputSeq || document.getElementById('bulk-edit-prop')?.value !== propName;
    const baseStyle = 'width:100%;padding:4px;font-size:13px;';
    if (ptc.type === 'select') {
      const vals = new Set(ptc.options || []);
      if (pivotData?.entities) {
        Object.values(pivotData.entities).forEach(ent => {
          (ent[propName] || []).forEach(v => { if (v.value) vals.add(v.value); });
        });
      }
      const select = document.createElement('select');
      select.id = 'bulk-edit-value';
      select.className = 'gb-select gb-select-column';
      select.innerHTML = '<option value="">(未設定)</option>' + [...vals].map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join('');
      container.appendChild(select);
    } else if (ptc.type === 'multi-select') {
      const vals = new Set(ptc.options || []);
      if (pivotData?.entities) {
        Object.values(pivotData.entities).forEach(ent => {
          (ent[propName] || []).forEach(v => (v.value || '').split(',').map(s => s.trim()).filter(Boolean).forEach(s => vals.add(s)));
        });
      }
      const wrap = document.createElement('div');
      wrap.style.cssText = 'max-height:160px;overflow-y:auto;border:1px solid var(--border);border-radius:4px;padding:6px;font-size:12px;';
      [...vals].forEach(v => {
        const lbl = document.createElement('label');
        lbl.style.cssText = 'display:block;padding:2px 0;cursor:pointer;';
        lbl.innerHTML = `<input type="checkbox" class="bulk-edit-ms" value="${esc(v)}"> ${esc(v)}`;
        wrap.appendChild(lbl);
      });
      container.appendChild(wrap);
    } else if (ptc.type === 'checkbox') {
      const select = document.createElement('select');
      select.id = 'bulk-edit-value';
      select.className = 'gb-select gb-select-column';
      select.innerHTML = '<option value="true">ON (true)</option><option value="false">OFF (false)</option>';
      container.appendChild(select);
    } else if (ptc.type === 'date') {
      const editor = typeof _dbDateCreateEditor === 'function'
        ? _dbDateCreateEditor('', ptc, { layout: 'block', className: 'bulk-date-editor cell-date-editor', rootStyle: 'display:flex;flex-direction:column;gap:6px;width:100%;', inputStyle: baseStyle })
        : null;
      if (!editor) return;
      container._dateEditor = editor;
      container.appendChild(editor.root);
    } else if (ptc.type === 'number') {
      const inp = document.createElement('input');
      inp.type = 'number';
      inp.id = 'bulk-edit-value';
      inp.style.cssText = baseStyle;
      if (ptc.unit) inp.placeholder = '単位: ' + ptc.unit;
      container.appendChild(inp);
    } else if (ptc.type === 'link' || ptc.type === 'multi-link' || ptc.type === 'url') {
      const inp = document.createElement('input');
      inp.type = 'text';
      inp.id = 'bulk-edit-value';
      inp.style.cssText = baseStyle;
      inp.placeholder = 'Web URL、Meldex項目、ファイル、フォルダ';
      container.appendChild(inp);
    } else if (ptc.type === 'relation' || ptc.type === 'multi-relation') {
      const isSelfRef = (ptc.relationDb === '' && ptc.relationDb !== undefined);
      const relDb = isSelfRef ? dbPath : (ptc.relationDb || '');
      if (!relDb) {
        container.innerHTML = '<span style="color:var(--fg2);font-size:12px;">参照先シートが未設定です</span>';
        return;
      }
      let entryList = [];
      try {
        const data = await apiFetch('/pivot?path=' + encodeURIComponent(relDb));
        if (isStaleRender()) return;
        entryList = Object.entries(data.entities || {}).map(([name, props]) => ({ name, id: props._id || name }));
        entryList.sort((a, b) => a.name.localeCompare(b.name));
      } catch {
        if (isStaleRender()) return;
        container.innerHTML = '<span style="color:var(--red);font-size:12px;">参照先シートの読み込み失敗: ' + esc(relDb) + '</span>';
        return;
      }
      if (ptc.type === 'relation') {
        const select = document.createElement('select');
        select.id = 'bulk-edit-value';
        select.className = 'gb-select gb-select-column';
        select.innerHTML = '<option value="">(未選択)</option>' + entryList.map(entry => `<option value="${esc(entry.id)}">${esc(entry.name)}</option>`).join('');
        container.appendChild(select);
      } else {
        const wrap = document.createElement('div');
        wrap.style.cssText = 'max-height:200px;overflow-y:auto;border:1px solid var(--border);border-radius:4px;padding:6px;font-size:12px;';
        entryList.forEach(entry => {
          const lbl = document.createElement('label');
          lbl.style.cssText = 'display:block;padding:2px 0;cursor:pointer;';
          lbl.innerHTML = `<input type="checkbox" class="bulk-edit-ms" value="${esc(entry.id)}"> ${esc(entry.name)}`;
          wrap.appendChild(lbl);
        });
        container.appendChild(wrap);
      }
    } else if (ptc.type === 'user' || ptc.type === 'multi-user') {
      // 候補ユーザー一覧は MeldexUserPicker.getCandidates() に統一する
      // （正本「スタッフ管理シート」+ワークスペースメンバーのマージ。
      // ユーザーアカウント一元管理 計画書 Phase 5、旧 /team・/auth/users の
      // 個別マージ実装を置換）。
      let users = [];
      try {
        const candidates = window.MeldexUserPicker ? await window.MeldexUserPicker.getCandidates() : [];
        if (isStaleRender()) return;
        users = candidates.map(candidate => candidate?.name).filter(Boolean);
      } catch {
        if (isStaleRender()) return;
      }
      if (ptc.type === 'user') {
        const select = document.createElement('select');
        select.id = 'bulk-edit-value';
        select.className = 'gb-select gb-select-column';
        select.innerHTML = '<option value="">(未選択)</option>' + users.map(user => `<option value="${esc(user)}">${esc(user)}</option>`).join('');
        container.appendChild(select);
      } else {
        const wrap = document.createElement('div');
        wrap.style.cssText = 'max-height:160px;overflow-y:auto;border:1px solid var(--border);border-radius:4px;padding:6px;font-size:12px;';
        users.forEach(user => {
          const lbl = document.createElement('label');
          lbl.style.cssText = 'display:block;padding:2px 0;cursor:pointer;';
          lbl.innerHTML = `<input type="checkbox" class="bulk-edit-ms" value="${esc(user)}"> ${esc(user)}`;
          wrap.appendChild(lbl);
        });
        container.appendChild(wrap);
      }
    } else {
      const inp = document.createElement('input');
      inp.type = 'text';
      inp.id = 'bulk-edit-value';
      inp.style.cssText = baseStyle;
      inp.placeholder = '新しい値';
      container.appendChild(inp);
    }
  };

  renderValueInput(editableProps[0]);
  document.getElementById('bulk-edit-prop').addEventListener('change', (e) => renderValueInput(e.target.value));

  const collectValue = () => {
    const dateContainer = document.getElementById('bulk-edit-value-container');
    if (dateContainer?._dateEditor) return dateContainer._dateEditor.getValue();
    const cboxes = document.querySelectorAll('#bulk-edit-value-container .bulk-edit-ms:checked');
    if (cboxes.length > 0) return [...cboxes].map(cb => cb.value).join(', ');
    const el = document.getElementById('bulk-edit-value');
    return el ? el.value : '';
  };

  applyBtn.addEventListener('click', async () => {
    const prop = document.getElementById('bulk-edit-prop').value;
    const value = collectValue();
    const statusEl = document.getElementById('bulk-edit-status');
    const status = statusEl ? statusEl.value : '採用';
    const replaceEl = document.getElementById('bulk-edit-replace');
    const replace = statusOn ? (replaceEl ? replaceEl.checked : true) : true;
    const ptc = propTypes[prop] || { type: 'text' };
    const canBatchUndo = true;
    if (!prop) {
      showStatus('列を選択してください', true);
      return;
    }
    if (replace && (ptc.type === 'relation' || ptc.type === 'multi-relation' || ptc.bidirectional)) {
      const ok = await (typeof cfConfirm === 'function'
        ? cfConfirm('一括編集で既存のリレーション候補を置き換えます。\n\n削除される候補は元に戻せるよう履歴へ記録します。続行しますか？')
        : Promise.resolve(window.confirm('一括編集で既存のリレーション候補を置き換えます。続行しますか？')));
      if (!ok) return;
    }
    modalApi.close('apply');
    showStatus(entityNames.length + ' 件を更新中...');
    let ok = 0;
    let fail = 0;
    const failNames = [];
    const rollbackFailNames = [];
    const beforeSnapshots = [];
    const afterSnapshots = [];
    for (const name of entityNames) {
      let ep = '';
      let beforeSnapshot = null;
      let createdRef = null;
      let cascadeClears = [];
      let bidirectionalOp = null;
      try {
        ep = _entityPath(dbPath, name, pivotData);
        const entData = pivotData.entities?.[name];
        const existingVals = [...(entData?.[prop] || [])];
        beforeSnapshot = canBatchUndo ? _bulkValueSnapshotFromValues(name, ep, existingVals) : null;
        const primaryForOld = (typeof getAdoptedValueForWrite === 'function' ? getAdoptedValueForWrite(existingVals) : null) || existingVals[0];
        const oldValue = primaryForOld?.value ?? '';
        if (replace) {
          const primary = primaryForOld;
          if (primary) {
            await _apiPutValue({ ...primary, property: primary.property || prop }, { new_value: value, new_status: status });
            const extras = existingVals.filter(v => v !== primary).sort((a, b) => (b.candidate_index ?? 0) - (a.candidate_index ?? 0));
            for (const v of extras) {
              if (v.candidate_index != null && v.file) {
                await _apiPutValue({ file: v.file, entry_path: ep, property: prop, candidate_id: v?.candidate_id, entry_id: v?.entry_id, candidate_index: v.candidate_index }, { _delete: true });
              } else if (v.file) {
                await _apiPutValue({ file: v.file, entry_path: ep, property: prop }, { _delete: true });
              }
            }
          } else {
            const res = await _apiPostValue(ep, prop, value, status, '');
            createdRef = { file: res?.path || res?.file || ep, entry_path: ep, property: res?.property || prop, candidate_id: res?.candidate_id, entry_id: res?.entry_id, candidate_index: res?.candidate_index };
          }
        } else {
          const res = await _apiPostValue(ep, prop, value, status, '');
          createdRef = { file: res?.path || res?.file || ep, entry_path: ep, property: res?.property || prop, candidate_id: res?.candidate_id, entry_id: res?.entry_id, candidate_index: res?.candidate_index };
        }
        if (replace && (ptc.type === 'relation' || ptc.type === 'multi-relation')
            && typeof _clearCascadeDependentValues === 'function') {
          cascadeClears = await _clearCascadeDependentValues(ep, prop, oldValue, value, { dbPath, ctx });
        }
        if (replace && ptc.bidirectional && (ptc.type === 'relation' || ptc.type === 'multi-relation')
            && typeof _applyBidirectionalRelationSync === 'function') {
          bidirectionalOp = await _applyBidirectionalRelationSync({
            sourceDbPath: dbPath,
            entityPath: ep,
            propName: prop,
            ptc,
            oldValue,
            newValue: value,
          });
        }
        if (entData && replace) {
          entData[prop] = [{ value, status, note: '', property: prop }];
          cascadeClears.forEach(clear => { entData[clear.propName] = []; });
        }
        if (canBatchUndo && beforeSnapshot) {
          beforeSnapshots.push(beforeSnapshot);
          const nextValues = replace
            ? [{ value, status, note: '' }]
            : [...beforeSnapshot.values, { value, status, note: '' }];
          afterSnapshots.push(_bulkValueSnapshotFromValues(name, ep, nextValues));
        }
        ok++;
      } catch (mutationError) {
        failNames.push(name);
        let rollbackOk = true;
        try {
          if (bidirectionalOp?.undo) await bidirectionalOp.undo();
        } catch (rollbackError) {
          rollbackOk = false;
          console.warn('一括編集の双方向リレーション復旧に失敗:', rollbackError, mutationError);
        }
        try {
          if (cascadeClears.length && typeof _restoreCascadeDependentValues === 'function') {
            await _restoreCascadeDependentValues(ep || _entityPath(dbPath, name), cascadeClears, { dbPath, ctx });
          }
        } catch (rollbackError) {
          rollbackOk = false;
          console.warn('一括編集のカスケード値復旧に失敗:', rollbackError, mutationError);
        }
        try {
          if (beforeSnapshot) await _bulkReplaceEntityPropValues(ep || _entityPath(dbPath, name), prop, beforeSnapshot.values);
          else if (createdRef?.file) await _apiPutValue(createdRef, { _delete: true });
        } catch (rollbackError) {
          rollbackOk = false;
          console.warn('一括編集のセル値復旧に失敗:', rollbackError, mutationError);
        }
        // 元の値へ戻せなかった行は、結果の表示で名前を出して確認を促す（黙って不整合を残さない）
        if (!rollbackOk) rollbackFailNames.push(name);
        fail++;
      }
    }
    // 成功した行だけを取り消しの履歴へ積み、失敗した行は元の値へ戻してある（部分成功）。
    // 失敗した行だけを選択したまま残し、もう一度「一括編集」で失敗分だけを再試行できるようにする。
    _dbUndoBulkPropEdit(dbPath, prop, beforeSnapshots, afterSnapshots, ctx);
    const rollbackNote = rollbackFailNames.length
      ? `。元の値へ戻せなかった行があります: ${rollbackFailNames.join(', ')}（値を確認してください）`
      : '';
    showStatus(`一括編集完了: 成功 ${ok} 件${fail > 0 ? ' / 失敗 ' + fail + ' 件: ' + failNames.join(', ') + '（失敗した行を選択しています）' : ''}${rollbackNote}`, fail > 0);
    await selectDatabase(dbPath, ctx);
    if (fail > 0) {
      const c = ctx || _currentPaneState();
      if (c?._selectedEntities) c._selectedEntities.clear();
      const tblSel = '#' + ((c && c.tableId) || 'pivot-table');
      const paneRoot = _paneEl(c, tblSel) || (!c ? document : null);
      paneRoot?.querySelectorAll?.('.row-select-cb').forEach(cb => {
        cb.checked = false;
        cb.closest('tr')?.classList.remove('row-selected');
      });
      _restoreSelectionByEntityNames(ctx, failNames);
    } else {
      _restoreSelectionByEntityNames(ctx, entityNames);
    }
    _updateBulkEditBar(ctx);
  });
}

function _restoreSelectionByEntityNames(ctx, entityNames) {
  if (!entityNames || entityNames.length === 0) return;
  const c = ctx || _currentPaneState();
  const tblSel = '#' + ((c && c.tableId) || 'pivot-table');
  const paneRoot = _paneEl(c, tblSel) || (!c ? document : null);
  if (!paneRoot) return;
  const nameSet = new Set(entityNames);
  let restored = 0;
  if (c && c._selectedEntities) nameSet.forEach(n => c._selectedEntities.add(n));
  paneRoot.querySelectorAll('.row-select-cb').forEach(cb => {
    if (nameSet.has(cb.dataset.entityName)) {
      cb.checked = true;
      cb.closest('tr')?.classList.add('row-selected');
      paneRoot._lastSelectedCb = cb;
      restored++;
    }
  });
  if (restored > 0 && typeof _updateBulkEditBar === 'function') _updateBulkEditBar(c);
}

async function _bulkDeleteEntities(entityNames, ctx) {
  const dbPath = (ctx && ctx.dbPath) || state.currentDbPath;
  if (!dbPath) return;
  const names = [...new Set((entityNames || []).filter(Boolean))];
  if (!names.length) return;
  const entries = names.map(name => ({
    name,
    path: _entityPath(dbPath, name, ctx?.pivotData),
    entryId: String(ctx?.pivotData?.entities?.[name]?._id || ''),
    assetId: String(ctx?.pivotData?.entities?.[name]?.asset_id || ctx?.pivotData?.entities?.[name]?.assetId || ''),
  }));
  // 名前から保存先を推定してはいけない。改名済みの実体を旧名の仮行が指すことがある。
  let pivot;
  try {
    pivot = await apiFetch('/pivot?path=' + encodeURIComponent(dbPath), { skipBrowseCache: true, cache: 'no-store' });
  } catch (error) {
    console.warn('[Meldex] 一括削除の前の確認に失敗しました', error);
    showStatus('一括削除できませんでした。選択した行の保存状態を確認できません: ' + (error?.message || error), true);
    return;
  }
  const valid = entries.every(entry => {
    const saved = pivot?.entities?.[entry.name];
    return saved && (pivot.new_format !== true || (entry.entryId && saved._id === entry.entryId))
      && _entityPath(dbPath, entry.name, pivot) === entry.path;
  });
  if (!valid) {
    await window.GbDbEntryIdentity.reload(ctx, dbPath);
    showStatus('選択した行の保存状態が変わったため削除を中止しました。行を選び直してください', true);
    return;
  }
  const confirmed = typeof MeldexDeleteImpactWarning !== 'undefined'
    ? await MeldexDeleteImpactWarning.authorizeReversibleDelete(
        entries.map(entry => ({ path: entry.path, kind: 'file', ...(entry.assetId ? { assetId: entry.assetId } : {}) })),
      )
    : { confirmed: true, operation: 'trash' };
  if (!confirmed) return;
  const result = await window.GbDbEntryIdentity.deleteEntries({
    dbPath,
    ctx,
    entries,
    source: 'bulk-delete',
    confirmation: confirmed,
  }).catch((error) => {
    console.warn('[Meldex] 一括削除に失敗しました', error);
    showStatus('一括削除できませんでした: ' + (error?.message || error), true);
    return null;
  });
  if (!result) {
    if (typeof _updateBulkEditBar === 'function') _updateBulkEditBar(ctx);
    return;
  }
  const deletedItems = Array.isArray(result.trashRefs) ? result.trashRefs : [];
  const ok = result.successes.length;
  const fail = result.failures.length;
  // 取り消し履歴はゴミ箱へ移せた分だけ積む（失敗分は履歴に残さない）
  if (deletedItems.length) _dbUndoBulkDeleteEntities(dbPath, deletedItems, ctx);
  const firstFailure = result.failures.find(item => item?.error)?.error;
  const failureReason = firstFailure ? '（' + (firstFailure?.message || firstFailure) + '）' : '';
  const summary = `一括削除完了: 成功 ${ok} 件${fail > 0 ? ' / 失敗 ' + fail + ' 件' + failureReason : ''}`;
  const calendarWarning = typeof _dbDeleteCalendarSyncWarningMessage === 'function'
    ? _dbDeleteCalendarSyncWarningMessage(result.responses)
    : '';
  showStatus(calendarWarning ? `${summary}。${calendarWarning}` : summary, fail > 0 || !!calendarWarning);
  _updateBulkEditBar(ctx);
}

// ============================================================
// AI（チャットのツール）がシートを書き換えた知らせ（2026-11-22 利用者役の探索）
// 開いているシートは読み直して変更を映し、取り消し・やり直しの履歴へ積む。
// 取り消しは画面の値の保存と同じ経路（_bulkReplaceEntityPropValues）で変更前の値へ戻すので、
// 書き込み権限・編集ロックの確認もそこで通る。
// ============================================================
function _llmSheetSamePath(a, b) {
  const norm = (p) => String(p || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  const x = norm(a), y = norm(b);
  return !!x && !!y && (x === y || x.endsWith('/' + y) || y.endsWith('/' + x));
}

function _llmSheetOpenContexts(sheetPath) {
  const out = [];
  try {
    const panes = typeof getAllPanes === 'function' ? Object.values(getAllPanes() || {}) : [];
    panes.forEach(ctx => { if (ctx?.dbPath && _llmSheetSamePath(ctx.dbPath, sheetPath) && !out.includes(ctx)) out.push(ctx); });
  } catch (_) { /* パネルが無い */ }
  return out;
}

async function _llmSheetRefreshOpen(dbPath) {
  for (const ctx of _llmSheetOpenContexts(dbPath)) {
    try {
      await selectDatabase(ctx.dbPath, ctx, { silent: true, skipRecent: true, skipNavPush: true, skipSaveLastView: true });
    } catch (error) {
      console.warn('[Meldex] AIの変更をシートへ映せませんでした', error);
    }
  }
}

function _llmSheetChangedProps(before, after) {
  const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  return [...keys].filter(key => JSON.stringify((before || {})[key] || []) !== JSON.stringify((after || {})[key] || []));
}

async function meldexApplyLlmSheetChange(change) {
  if (!change || change.type !== 'meldex_sheet_changed') return false;
  const ctx = _llmSheetOpenContexts(change.sheet_path)[0] || null;
  const dbPath = ctx?.dbPath || change.sheet_path;
  if (!dbPath || !change.file_name) return false;
  const entityPath = String(dbPath).replace(/\\/g, '/').replace(/\/+$/, '') + '/' + change.file_name;
  const entity = change.entity || change.file_name.replace(/\.md$/i, '');
  const scope = typeof _dbScope === 'function' ? _dbScope(dbPath) : ('db:' + dbPath);
  const op = String(change.operation || '');
  if (typeof historyPush === 'function') {
    if ((op === 'value_set' || op === 'entry_update') && change.before_properties && change.after_properties) {
      const props = _llmSheetChangedProps(change.before_properties, change.after_properties);
      const apply = (side) => async () => {
        for (const prop of props) await _bulkReplaceEntityPropValues(entityPath, prop, (side || {})[prop] || []);
        await _llmSheetRefreshOpen(dbPath);
      };
      if (props.length) {
        historyPush(`AIの変更: ${entity}（${props.join('、')}）`,
          apply(change.before_properties), apply(change.after_properties), scope);
      }
    } else if (op === 'entry_create' && window.GbDbEntryIdentity?.deleteEntries) {
      let trashRefs = [];
      historyPush(`AIのトピック追加: ${entity}`,
        async () => {
          const result = await window.GbDbEntryIdentity.deleteEntries({
            dbPath, ctx, entries: [{ name: entity, path: entityPath }], source: 'llm-undo',
            confirmation: { confirmed: true, operation: 'trash' },
          });
          trashRefs = Array.isArray(result?.trashRefs) ? result.trashRefs : [];
          if (!trashRefs.length) throw new Error(`「${entity}」を取り消せませんでした`);
          await _llmSheetRefreshOpen(dbPath);
        },
        async () => {
          for (const ref of trashRefs) {
            await apiPost('/outliner/restore', { trash_name: ref.trash_name, ...(ref.trash_root ? { trash_root: ref.trash_root } : {}) });
          }
          trashRefs = [];
          await _llmSheetRefreshOpen(dbPath);
        },
        scope);
    }
  }
  await _llmSheetRefreshOpen(dbPath);
  return true;
}
window.meldexApplyLlmSheetChange = meldexApplyLlmSheetChange;
