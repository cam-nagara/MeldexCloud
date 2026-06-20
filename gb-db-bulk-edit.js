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

function _updateBulkEditBar(ctx) {
  const c = ctx || _currentPaneState();
  const paneId = (c && c.paneId) || 'main';
  const selected = _getSelectedEntities(c);
  const table = _paneEl(c, '#' + ((c && c.tableId) || 'pivot-table'));
  const host = c?.containerEl || table?.closest?.('.gb-pane-content,.pane-content,#pivot-view,#main-views') || document.getElementById('main-views') || document.body;
  let bar = document.querySelector(`.db-bulk-edit-bar[data-pane-id="${paneId}"]`);
  if (selected.length === 0) {
    if (bar) bar.remove();
    return;
  }
  if (!bar) {
    bar = document.createElement('div');
    bar.className = 'db-bulk-edit-bar gb-selection-float-bar';
    bar.dataset.paneId = paneId;
    bar.dataset.selectionFloatPaneId = paneId;
    bar.id = 'db-bulk-edit-bar';
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
    ? window.GBSelectionFloatMenu.button('下に ' + selected.length + ' エントリ追加')
    : document.createElement('button');
  if (!window.GBSelectionFloatMenu) {
    addRowsBtn.textContent = '下に ' + selected.length + ' エントリ追加';
  }
  addRowsBtn.title = '選択中の最後のエントリの下に、選択数と同じだけ新規エントリを追加';
  addRowsBtn.dataset.e2eId = 'db-bulk-add-rows-' + paneId;
  addRowsBtn.addEventListener('click', async () => {
    const c2 = ctx || _currentPaneState();
    const tblSel = '#' + ((c2 && c2.tableId) || 'pivot-table');
    const paneRoot = _paneEl(c2, tblSel) || document;
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
        onClick: () => {
          const c2 = ctx || _currentPaneState();
          if (c2 && c2._selectedEntities) c2._selectedEntities.clear();
          const tblSel = '#' + ((c2 && c2.tableId) || 'pivot-table');
          const paneRoot = _paneEl(c2, tblSel) || document;
          paneRoot.querySelectorAll('.row-select-cb:checked').forEach(cb => {
            cb.checked = false;
            cb.closest('tr')?.classList.remove('row-selected');
          });
          _updateBulkEditBar(c2);
        },
      })
    : document.createElement('button');
  if (!window.GBSelectionFloatMenu) {
    clearBtn.textContent = '選択解除';
    clearBtn.dataset.e2eId = 'db-bulk-clear-' + paneId;
    clearBtn.addEventListener('click', () => {
    const c2 = ctx || _currentPaneState();
    if (c2 && c2._selectedEntities) c2._selectedEntities.clear();
    const tblSel = '#' + ((c2 && c2.tableId) || 'pivot-table');
    const paneRoot = _paneEl(c2, tblSel) || document;
    paneRoot.querySelectorAll('.row-select-cb:checked').forEach(cb => {
      cb.checked = false;
      cb.closest('tr')?.classList.remove('row-selected');
    });
    _updateBulkEditBar(c2);
    });
  }
  bar.appendChild(clearBtn);

  const sep = document.createElement('span');
  sep.style.cssText = 'width:1px;height:20px;background:var(--border);display:inline-block;';
  bar.appendChild(sep);

  const delBtn = window.GBSelectionFloatMenu
    ? window.GBSelectionFloatMenu.button('一括削除...', {
        e2eId: 'db-bulk-delete-' + paneId,
        danger: true,
        onClick: () => _bulkDeleteEntities(selected, ctx),
      })
    : document.createElement('button');
  if (!window.GBSelectionFloatMenu) {
    delBtn.textContent = '一括削除...';
    delBtn.dataset.e2eId = 'db-bulk-delete-' + paneId;
    delBtn.addEventListener('click', () => _bulkDeleteEntities(selected, ctx));
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
      await _apiPutValue({ file: v.file, property: prop, candidate_index: v.candidate_index }, { _delete: true });
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
  const names = deletedItems.map(item => item.name);
  const toTrashRef = (item, res = item) => {
    const src = res && typeof res === 'object' ? res : item;
    return src?.trash_name ? {
      trash_name: src.trash_name,
      trash_root: src.trash_root || '',
      path: item?.path || '',
      name: item?.name || '',
    } : null;
  };
  let trashRefs = deletedItems.map(toTrashRef).filter(Boolean);
  const refresh = async (restoreSelection) => {
    await selectDatabase(dbPath, ctx, { silent: true });
    if (restoreSelection) _restoreSelectionByEntityNames(ctx, names);
    else if (ctx && ctx._selectedEntities) names.forEach(n => ctx._selectedEntities.delete(n));
    _updateBulkEditBar(ctx);
  };
  historyPush(
    `一括削除: ${deletedItems.length} 件`,
    async () => {
      for (const ref of trashRefs) {
        await apiPost('/outliner/restore', {
          trash_name: ref.trash_name,
          ...(ref.trash_root ? { trash_root: ref.trash_root } : {}),
        }).catch(() => {});
        try {
          if (window.GbDbCalendarSync && typeof window.GbDbCalendarSync.onEntryRestored === 'function') {
            await window.GbDbCalendarSync.onEntryRestored(dbPath, ref.path);
          }
        } catch {}
      }
      await refresh(true);
    },
    async () => {
      const nextTrashRefs = [];
      for (const item of deletedItems) {
        const res = await apiPost('/outliner/delete', { path: item.path }).catch(() => null);
        const ref = toTrashRef(item, res);
        if (ref) nextTrashRefs.push(ref);
        try {
          if (window.GbDbCalendarSync && typeof window.GbDbCalendarSync.onEntryDeleted === 'function') {
            await window.GbDbCalendarSync.onEntryDeleted(dbPath, item.path);
          }
        } catch {}
      }
      trashRefs = nextTrashRefs;
      await refresh(false);
    },
    scope
  );
}

function _showBulkEditModal(entityNames, ctx) {
  const dbPath = (ctx && ctx.dbPath) || state.currentDbPath;
  if (!dbPath) return;
  const pivotData = (ctx && ctx.pivotData) || (state.currentDbPath === dbPath ? state.pivotData : null) || {};
  const props = pivotData.properties || [];
  const propTypes = getPropertyTypes(dbPath) || {};
  const statusOn = getStatusEnabled(dbPath);
  const editableProps = props.filter(p => {
    const t = propTypes[p]?.type;
    const lockMsg = (typeof checkColumnEditable === 'function') ? checkColumnEditable(dbPath, p) : '';
    return !lockMsg && !['formula', 'button', 'chat', 'multi-source-relation', 'rollup'].includes(t);
  });
  if (editableProps.length === 0) {
    showStatus('編集可能なプロパティがありません', true);
    return;
  }

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `<div class="modal" style="min-width:460px;">
    <h3>一括編集 (${entityNames.length} 件)</h3>
    <div style="margin:8px 0;color:var(--fg2);font-size:12px;max-height:80px;overflow-y:auto;">${entityNames.map(n => esc(n)).join(' / ')}</div>
    <div class="field"><label>プロパティ</label>
      <select id="bulk-edit-prop" style="width:100%;padding:4px;">
        ${editableProps.map(p => `<option value="${esc(p)}">${esc(p)} (${esc(propTypes[p]?.type || 'text')})</option>`).join('')}
      </select>
    </div>
    <div class="field"><label>値</label><div id="bulk-edit-value-container"></div></div>
    ${statusOn ? `<div class="field"><label>ステータス</label>
      <select id="bulk-edit-status" style="width:100%;padding:4px;">
        <option value="案">案</option>
        <option value="採用" selected>採用</option>
        <option value="ボツ">ボツ</option>
        <option value="掲載済み">掲載済み</option>
      </select>
    </div>` : ''}
    <div class="field" id="bulk-edit-replace-row"><label><input id="bulk-edit-replace" type="checkbox" checked ${statusOn ? '' : 'disabled'}> ${statusOn ? '既存の値を置き換える（チェックなしで候補値として追加）' : '既存の値を置き換える'}</label></div>
    <div class="btn-row" style="margin-top:12px;">
      <button data-action="this.closest('.modal-overlay').remove()">キャンセル</button>
      <button class="primary" id="bulk-edit-apply">適用</button>
    </div>
  </div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

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
      select.style.cssText = baseStyle;
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
      select.style.cssText = baseStyle;
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
    } else if (ptc.type === 'url') {
      const inp = document.createElement('input');
      inp.type = 'url';
      inp.id = 'bulk-edit-value';
      inp.style.cssText = baseStyle;
      inp.placeholder = 'https://...';
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
        select.style.cssText = baseStyle;
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
      const users = [];
      const seen = new Set();
      try {
        const team = await apiFetch('/team');
        if (isStaleRender()) return;
        if (Array.isArray(team)) {
          team.forEach(member => {
            if (member?.name && !seen.has(member.name)) {
              seen.add(member.name);
              users.push(member.name);
            }
          });
        }
      } catch {}
      try {
        const authUsers = await apiFetch('/auth/users');
        if (isStaleRender()) return;
        if (Array.isArray(authUsers)) {
          authUsers.forEach(user => {
            if (user?.name && !seen.has(user.name)) {
              seen.add(user.name);
              users.push(user.name);
            }
          });
        }
      } catch {}
      if (ptc.type === 'user') {
        const select = document.createElement('select');
        select.id = 'bulk-edit-value';
        select.style.cssText = baseStyle;
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

  document.getElementById('bulk-edit-apply').addEventListener('click', async () => {
    const prop = document.getElementById('bulk-edit-prop').value;
    const value = collectValue();
    const statusEl = document.getElementById('bulk-edit-status');
    const status = statusEl ? statusEl.value : '採用';
    const replaceEl = document.getElementById('bulk-edit-replace');
    const replace = statusOn ? (replaceEl ? replaceEl.checked : true) : true;
    const ptc = propTypes[prop] || { type: 'text' };
    const canBatchUndo = true;
    if (!prop) {
      showStatus('プロパティを選択してください', true);
      return;
    }
    if (replace && (ptc.type === 'relation' || ptc.type === 'multi-relation' || ptc.bidirectional)) {
      const ok = await (typeof cfConfirm === 'function'
        ? cfConfirm('一括編集で既存のリレーション候補を置き換えます。\n\n削除される候補は元に戻せるよう履歴へ記録します。続行しますか？')
        : Promise.resolve(window.confirm('一括編集で既存のリレーション候補を置き換えます。続行しますか？')));
      if (!ok) return;
    }
    overlay.remove();
    showStatus(entityNames.length + ' 件を更新中...');
    let ok = 0;
    let fail = 0;
    const failNames = [];
    const beforeSnapshots = [];
    const afterSnapshots = [];
    for (const name of entityNames) {
      let ep = '';
      let beforeSnapshot = null;
      let createdRef = null;
      try {
        ep = _entityPath(dbPath, name);
        const entData = pivotData.entities?.[name];
        const existingVals = [...(entData?.[prop] || [])];
        beforeSnapshot = canBatchUndo ? _bulkValueSnapshotFromValues(name, ep, existingVals) : null;
        const primaryForOld = (typeof getAdoptedValueForWrite === 'function' ? getAdoptedValueForWrite(existingVals) : null) || existingVals[0];
        const oldValue = primaryForOld?.value ?? '';
        let cascadeClears = [];
        if (replace) {
          const primary = primaryForOld;
          if (primary) {
            await _apiPutValue({ ...primary, property: primary.property || prop }, { new_value: value, new_status: status });
            const extras = existingVals.filter(v => v !== primary).sort((a, b) => (b.candidate_index ?? 0) - (a.candidate_index ?? 0));
            for (const v of extras) {
              if (v.candidate_index != null && v.file) {
                await _apiPutValue({ file: v.file, property: prop, candidate_index: v.candidate_index }, { _delete: true });
              } else if (v.file) {
                await apiPost('/outliner/delete', { path: v.file });
              }
            }
          } else {
            const res = await _apiPostValue(ep, prop, value, status, '');
            createdRef = { file: res?.path || res?.file || ep, property: res?.property || prop, candidate_index: res?.candidate_index };
          }
        } else {
          const res = await _apiPostValue(ep, prop, value, status, '');
          createdRef = { file: res?.path || res?.file || ep, property: res?.property || prop, candidate_index: res?.candidate_index };
        }
        if (replace && (ptc.type === 'relation' || ptc.type === 'multi-relation')
            && typeof _clearCascadeDependentValues === 'function') {
          cascadeClears = await _clearCascadeDependentValues(ep, prop, oldValue, value);
        }
        if (replace && ptc.bidirectional && (ptc.type === 'relation' || ptc.type === 'multi-relation')
            && typeof _applyBidirectionalRelationSync === 'function') {
          await _applyBidirectionalRelationSync({
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
      } catch {
        failNames.push(name);
        try {
          if (beforeSnapshot) await _bulkReplaceEntityPropValues(ep || _entityPath(dbPath, name), prop, beforeSnapshot.values);
          else if (createdRef?.file) await _apiPutValue(createdRef, { _delete: true });
        } catch {}
        fail++;
      }
    }
    _dbUndoBulkPropEdit(dbPath, prop, beforeSnapshots, afterSnapshots, ctx);
    showStatus(`一括編集完了: 成功 ${ok} 件${fail > 0 ? ' / 失敗 ' + fail + ' 件: ' + failNames.join(', ') : ''}`, fail > 0);
    await selectDatabase(dbPath, ctx);
    _restoreSelectionByEntityNames(ctx, entityNames);
    _updateBulkEditBar(ctx);
  });
}

function _restoreSelectionByEntityNames(ctx, entityNames) {
  if (!entityNames || entityNames.length === 0) return;
  const c = ctx || _currentPaneState();
  const tblSel = '#' + ((c && c.tableId) || 'pivot-table');
  const paneRoot = _paneEl(c, tblSel) || document;
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
  if (!await cfConfirm(`${names.length} 件のエントリをゴミ箱に移動しますか？`)) return;
  if (ctx && ctx._selectedEntities) names.forEach(n => ctx._selectedEntities.delete(n));
  if (typeof _dbRemoveCreatedEntitiesLocally === 'function') {
    _dbRemoveCreatedEntitiesLocally(ctx, dbPath, names);
  } else {
    const tblSel = '#' + ((ctx && ctx.tableId) || 'pivot-table');
    const paneRoot = _paneEl(ctx, tblSel) || document;
    names.forEach(name => {
      const safeName = typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
        ? CSS.escape(name)
        : String(name).replace(/(["\\])/g, '\\$1');
      paneRoot.querySelector(`tr[data-entity-name="${safeName}"]`)?.remove();
    });
  }
  _updateBulkEditBar(ctx);
  showStatus(`${names.length} 件のエントリを削除中...`);
  const results = await Promise.all(names.map(async name => {
    try {
      const ep = _entityPath(dbPath, name);
      const res = await apiPost('/outliner/delete', { path: ep });
      try {
        if (window.GbDbCalendarSync && typeof window.GbDbCalendarSync.onEntryDeleted === 'function') {
          await window.GbDbCalendarSync.onEntryDeleted(dbPath, ep);
        }
      } catch {}
      return { ok: true, item: { name, path: ep, trash_name: res?.trash_name || '', trash_root: res?.trash_root || '' } };
    } catch {
      return { ok: false };
    }
  }));
  const deletedItems = results.filter(result => result.ok).map(result => result.item);
  const ok = deletedItems.length;
  const fail = results.length - ok;
  _dbUndoBulkDeleteEntities(dbPath, deletedItems, ctx);
  showStatus(`一括削除完了: 成功 ${ok} 件${fail > 0 ? ' / 失敗 ' + fail + ' 件' : ''}`);
  if (fail > 0) {
    await selectDatabase(dbPath, ctx, { silent: true });
  }
  _updateBulkEditBar(ctx);
}
