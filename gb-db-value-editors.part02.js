async function _saveUserValue(val, entityPath, propName, newValue, anchorEl, options) {
  const saveOptions = options || {};
  const dbPath = saveOptions.dbPath || (typeof _valueEditorDbPath === 'function' ? _valueEditorDbPath(entityPath, anchorEl) : state.currentDbPath);
  const oldValue = val?.value == null ? '' : String(val.value);
  const nextValue = newValue == null ? '' : String(newValue);
  if (nextValue === oldValue) return true;
  try {
    if (val) {
      await _apiPutValue(val, { new_value: nextValue });
      if (typeof _dbUndoValue === 'function') _dbUndoValue(propName + ': ' + oldValue + ' → ' + nextValue, val, oldValue, nextValue);
      val.value = nextValue;
    } else {
      const status = saveOptions.status || '採用';
      const result = await _apiPostValue(entityPath, propName, nextValue, status, '');
      const filePath = result?.path || '';
      const candIdx = result?.candidate_index;
      if (filePath && typeof historyPush === 'function') {
        historyPush('値追加: ' + propName + '=' + nextValue,
          candIdx != null
            ? async () => { await _apiPutValue({ file: filePath, property: propName, candidate_index: candIdx }, { _delete: true }); await _valueEditorReload(dbPath); }
            : async () => { await apiPost('/outliner/delete', { path: filePath }); await _valueEditorReload(dbPath); },
          async () => { await _apiPostValue(entityPath, propName, nextValue, status, ''); await _valueEditorReload(dbPath); },
          typeof _dbScopeForPath === 'function' ? _dbScopeForPath(dbPath) : _dbScope()
        );
      }
    }
    // Step 3: 部分更新化 (user/multi-user)
    // val が null (新規追加) の場合は新しいエントリ行が必要なのでフルリロード
    if (!val) {
      await _valueEditorReload(dbPath);
    } else {
      _refreshAfterCellEdit(anchorEl, entityPath, propName);
    }
    return true;
  } catch (e) {
    if (!saveOptions.silent) showStatus('保存に失敗: ' + (e?.message || e), true);
    return false;
  }
}

// ペアリレーション自動反映
// sourceId を targetEntity の pairProp に追加/除去する
async function _syncPairRelation(dbPath, targetId, pairPropName, sourceId, adding) {
  const map = await _getRelationMap(dbPath);
  const targetName = map.idToName[targetId] || targetId;
  const targetPath = _entityPath(dbPath, targetName);
  try {
    const targetData = await apiFetch('/pivot?path=' + encodeURIComponent(dbPath));
    const entData = targetData.entities?.[targetName];
    if (!entData) return;
    const pairVals = entData[pairPropName] || [];
    const pairVal = pairVals.find(v => ['採用', '掲載済み'].includes(v?.status || '採用')) || null;
    if (!pairVal) {
      // ペアプロパティに値がまだない場合は新規作成
      if (adding) {
        const created = await _apiPostValue(targetPath, pairPropName, sourceId, '採用', '');
        const createdFile = created?.path || created?.file;
        if (!createdFile) return null;
        return {
          undo: async () => {
            await _apiPutValue({
              file: createdFile,
              property: created?.property || pairPropName,
              candidate_index: created?.candidate_index,
            }, { _delete: true });
          },
        };
      }
      return;
    }
    const currentIds = (pairVal.value || '').split(',').map(s => s.trim()).filter(Boolean);
    if (adding) {
      if (!currentIds.includes(sourceId)) currentIds.push(sourceId);
    } else {
      const idx = currentIds.indexOf(sourceId);
      if (idx >= 0) currentIds.splice(idx, 1);
    }
    const oldValue = pairVal.value || '';
    const nextValue = currentIds.join(', ');
    if (oldValue === nextValue) return null;
    await _apiPutValue(pairVal, { new_value: nextValue });
    return {
      undo: async () => {
        await _apiPutValue(pairVal, { new_value: oldValue });
      },
    };
  } catch (e) {
    console.warn('ペアリレーション同期に失敗:', e);
    throw e;
  }
}

async function _rollbackRelationSyncOps(ops) {
  for (let i = (ops || []).length - 1; i >= 0; i -= 1) {
    try { await ops[i](); }
    catch (e) { console.warn('リレーション同期の巻き戻しに失敗:', e); }
  }
}

// 循環参照チェック（A→B→C→Aを検出）
async function _checkCircularDependency(dbPath, sourceId, targetId, propName) {
  const sourceKey = String(sourceId || '');
  const visited = new Set();
  const queue = [String(targetId || '')];
  try {
    const data = await apiFetch('/pivot?path=' + encodeURIComponent(dbPath));
    const map = await _getRelationMap(dbPath);
    while (queue.length > 0) {
      const current = String(queue.shift() || '');
      if (!current) continue;
      if (current === sourceKey) return true; // 循環検出
      if (visited.has(current)) continue;
      visited.add(current);
      const name = map.idToName[current] || current;
      const entData = data.entities?.[name];
      if (!entData) continue;
      const vals = entData[propName] || [];
      const v = vals[0]?.value || '';
      v.split(',').map(s => s.trim()).filter(Boolean).forEach(id => {
        const nextId = String(id || '');
        if (nextId === sourceKey) queue.push(nextId);
        else if (!visited.has(nextId)) queue.push(nextId);
      });
    }
  } catch {}
  return false;
}

// リレーションドロップダウン（参照先DBのエントリ一覧）
async function _showRelationDropdown(el, val, entityPath, propName, ptc, isMulti) {
  closeAllDropdowns();
  const isSelfRef = (ptc.relationDb === '' && ptc.relationDb !== undefined);
  const sourceDbPath = ptc.__sourceDbPath || (typeof _valueEditorDbPath === 'function' ? _valueEditorDbPath(entityPath, el) : state.currentDbPath);
  const relDb = isSelfRef ? sourceDbPath : (ptc.relationDb || '');
  if (!relDb) { showStatus('参照先シートが設定されていません。プロパティ型設定で指定してください。', true); return; }

  // 参照先DBのエントリ一覧（ID付き）を取得
  let entryList = []; // { name, id }
  let refEntities = {};
  try {
    const map = await _getRelationMap(relDb);
    refEntities = map.entities || {};
    entryList = Object.entries(map.idToName).map(([id, name]) => ({ name, id }));
  } catch { showStatus('参照先シートの読み込みに失敗: ' + relDb, true); return; }

  // カスケード絞り込み
  if (ptc.cascadeFrom) {
    const parentValues = typeof _getCurrentEntityValues === 'function'
      ? _getCurrentEntityValues(entityPath, ptc.cascadeFrom)
      : [_getCurrentEntityValue(entityPath, ptc.cascadeFrom)].filter(Boolean);
    if (parentValues.length) {
      entryList = entryList.filter(entry => {
        const entData = refEntities[entry.name];
        if (!entData) return false;
        const cascadeVals = entData[ptc.cascadeKey] || [];
        return cascadeVals.some(v => {
          const vals = typeof _splitDbMultiValue === 'function'
            ? _splitDbMultiValue(v.value)
            : String(v.value || '').split(',').map(s => s.trim()).filter(Boolean);
          return parentValues.some(parentValue => vals.includes(parentValue));
        });
      });
    }
  }
  // 自己参照時: 自分自身を除外
  if (isSelfRef && entityPath) {
    const selfName = entityPath.replace(/\.md$/, '').split('/').pop();
    const selfMap = _relationCache[relDb];
    const selfId = selfMap ? (selfMap.nameToId[selfName] || selfName) : selfName;
    entryList = entryList.filter(e => e.id !== selfId && e.name !== selfName);
  }
  entryList.sort((a, b) => a.name.localeCompare(b.name));

  const dd = document.createElement('div');
  dd.className = 'status-dropdown';
  dd.style.cssText = 'max-height:300px;overflow-y:auto;min-width:200px;';

  // 検索ボックス
  const search = document.createElement('input');
  search.type = 'text'; search.placeholder = 'エントリを検索...';
  search.style.cssText = 'width:100%;padding:4px 6px;margin-bottom:4px;background:var(--bg);color:var(--fg);border:1px solid var(--border);border-radius:3px;font-size:12px;';
  dd.appendChild(search);

  const currentVals = isMulti ? ((val?.value) || '').split(',').map(s => s.trim()).filter(Boolean) : [(val?.value) || ''];
  let didChange = false;

  const listDiv = document.createElement('div');
  const renderList = (filter) => {
    listDiv.innerHTML = '';
    const filtered = filter ? entryList.filter(e => e.name.toLowerCase().includes(filter.toLowerCase())) : entryList;
    filtered.forEach(entry => {
      const isSelected = currentVals.includes(entry.id) || currentVals.includes(entry.name);
      const item = document.createElement('div');
      item.className = 'dd-nav-item';
      item.style.cssText = 'padding:4px 8px;cursor:pointer;font-size:12px;display:flex;align-items:center;gap:6px;';
      if (isSelected) item.style.background = 'rgba(86,156,214,0.15)';
      item.onmouseenter = () => { item.style.background = 'var(--bg4)'; };
      item.onmouseleave = () => { item.style.background = isSelected ? 'rgba(86,156,214,0.15)' : ''; };
      if (isMulti) {
        const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = isSelected;
        item.appendChild(cb);
      }
      item.appendChild(document.createTextNode(entry.name));
      item.addEventListener('click', async () => {
        const oldVal = val.value || '';
        const hasPair = ptc.pairWith && isSelfRef;
        const bidirectionalCtx = ptc.bidirectional ? { entityPath, propName, ptc } : null;
        let selfId = '';
        if (hasPair) {
          const selfName = entityPath.replace(/\.md$/, '').split('/').pop();
          const selfMap = _relationCache[relDb];
          selfId = selfMap ? (selfMap.nameToId[selfName] || selfName) : selfName;
        }
        if (isMulti) {
          const idx = currentVals.findIndex(v => v === entry.id || v === entry.name);
          const adding = idx < 0;
          const nextVals = [...currentVals];
          if (idx >= 0) nextVals.splice(idx, 1); else nextVals.push(entry.id);
          const nv = nextVals.join(', ');
          let cascadeClears = [];
          try {
            cascadeClears = await _clearCascadeDependentValues(entityPath, propName, oldVal, nv);
          } catch (e) {
            showStatus('カスケード依存値の更新に失敗: ' + (e?.message || e), true);
            return;
          }
          try {
            await _apiPutValue(val, { new_value: nv });
          } catch (e) {
            await _restoreCascadeDependentValues(entityPath, cascadeClears);
            showStatus('リレーション値の保存に失敗: ' + (e?.message || e), true);
            await _valueEditorReload(sourceDbPath);
            return;
          }
          currentVals.splice(0, currentVals.length, ...nextVals);
          _upsertLocalPivotValue(entityPath, propName, val, nv);
          didChange = true;
          let syncError = null;
          const syncRollbackOps = [];
          try {
            if (hasPair) {
              _relationCache[relDb] = null;
              const pairOp = await _syncPairRelation(relDb, entry.id, ptc.pairWith, selfId, adding);
              if (pairOp?.undo) syncRollbackOps.push(pairOp.undo);
              if (adding) {
                const circular = await _checkCircularDependency(relDb, selfId, entry.id, propName);
                if (circular) showStatus('⚠ 循環依存が検出されました', true);
              }
            }
            if (bidirectionalCtx && typeof _applyBidirectionalRelationSync === 'function') {
              const bidirectionalOp = await _applyBidirectionalRelationSync({
                sourceDbPath,
                entityPath,
                propName,
                ptc,
                oldValue: oldVal,
                newValue: nv,
              });
              if (bidirectionalOp?.undo) syncRollbackOps.push(bidirectionalOp.undo);
            }
          } catch (e) {
            syncError = e;
          }
          if (syncError) {
            await _rollbackRelationSyncOps(syncRollbackOps);
            try { await _apiPutValue(val, { new_value: oldVal }); } catch {}
            currentVals.splice(0, currentVals.length, ...oldVal.split(',').map(s => s.trim()).filter(Boolean));
            _upsertLocalPivotValue(entityPath, propName, val, oldVal);
            if (cascadeClears.length && typeof _restoreCascadeDependentValues === 'function') {
              try { await _restoreCascadeDependentValues(entityPath, cascadeClears); } catch {}
            }
            showStatus('リレーション同期に失敗: ' + (syncError?.message || syncError), true);
            renderList(search.value);
            return;
          }
          // Undo: ペア込みで両方戻す
          _dbUndoPairValue(propName, val, oldVal, nv, hasPair ? relDb : null, hasPair ? entry.id : null, hasPair ? ptc.pairWith : null, selfId, !hasPair ? false : (idx < 0), null, entityPath, cascadeClears, bidirectionalCtx);
          renderList(search.value);
        } else {
          if (oldVal === entry.id || oldVal === entry.name) { closeDropdown(); return; }
          let cascadeClears = [];
          try {
            cascadeClears = await _clearCascadeDependentValues(entityPath, propName, oldVal, entry.id);
          } catch (e) {
            showStatus('カスケード依存値の更新に失敗: ' + (e?.message || e), true);
            return;
          }
          try {
            await _apiPutValue(val, { new_value: entry.id });
          } catch (e) {
            await _restoreCascadeDependentValues(entityPath, cascadeClears);
            showStatus('リレーション値の保存に失敗: ' + (e?.message || e), true);
            await _valueEditorReload(sourceDbPath);
            return;
          }
          _upsertLocalPivotValue(entityPath, propName, val, entry.id);
          didChange = true;
          let syncError = null;
          const syncRollbackOps = [];
          try {
            if (hasPair) {
              _relationCache[relDb] = null;
              if (oldVal) {
                const oldPairOp = await _syncPairRelation(relDb, oldVal, ptc.pairWith, selfId, false);
                if (oldPairOp?.undo) syncRollbackOps.push(oldPairOp.undo);
              }
              const newPairOp = await _syncPairRelation(relDb, entry.id, ptc.pairWith, selfId, true);
              if (newPairOp?.undo) syncRollbackOps.push(newPairOp.undo);
            }
            if (bidirectionalCtx && typeof _applyBidirectionalRelationSync === 'function') {
              const bidirectionalOp = await _applyBidirectionalRelationSync({
                sourceDbPath,
                entityPath,
                propName,
                ptc,
                oldValue: oldVal,
                newValue: entry.id,
              });
              if (bidirectionalOp?.undo) syncRollbackOps.push(bidirectionalOp.undo);
            }
          } catch (e) {
            syncError = e;
          }
          if (syncError) {
            await _rollbackRelationSyncOps(syncRollbackOps);
            try { await _apiPutValue(val, { new_value: oldVal }); } catch {}
            _upsertLocalPivotValue(entityPath, propName, val, oldVal);
            if (cascadeClears.length && typeof _restoreCascadeDependentValues === 'function') {
              try { await _restoreCascadeDependentValues(entityPath, cascadeClears); } catch {}
            }
            showStatus('リレーション同期に失敗: ' + (syncError?.message || syncError), true);
            closeDropdown();
            await _valueEditorReload(sourceDbPath);
            return;
          }
          _dbUndoPairValue(propName, val, oldVal, entry.id, hasPair ? relDb : null, hasPair ? entry.id : null, hasPair ? ptc.pairWith : null, selfId, true, hasPair ? oldVal : null, entityPath, cascadeClears, bidirectionalCtx);
          closeDropdown();
          await _finalizeRelationCellUpdate(el, entityPath, propName, ptc, cascadeClears.map(c => c.propName));
        }
      });
      listDiv.appendChild(item);
    });
  };
  renderList('');
  search.oninput = () => renderList(search.value);
  dd.appendChild(listDiv);

  // 複数選択の確定ボタン
  if (isMulti) {
    const doneBtn = document.createElement('div');
    doneBtn.style.cssText = 'padding:4px 8px;text-align:center;cursor:pointer;font-size:12px;font-weight:bold;color:var(--accent);border-top:1px solid var(--border);margin-top:4px;';
    doneBtn.innerHTML = lucide('check', 12) + ' 確定';
    doneBtn.addEventListener('click', async () => {
      closeDropdown();
      if (didChange) {
        const cascadeProps = _getCascadeDependents(propName, sourceDbPath).map(dep => dep.propName);
        await _finalizeRelationCellUpdate(el, entityPath, propName, ptc, cascadeProps);
      }
    });
    dd.appendChild(doneBtn);
  }

  let closer = null;
  const closeDropdown = () => {
    if (dd.parentNode) dd.remove();
    if (closer) {
      document.removeEventListener('pointerdown', closer);
      closer = null;
    }
  };
  const rect = el.getBoundingClientRect();
  const _zr = _getZoom();
  dd.style.position = 'fixed'; dd.style.left = (rect.left / _zr) + 'px'; dd.style.top = (rect.bottom / _zr + 2) + 'px';
  document.body.appendChild(dd);
  clampPopupToViewport(dd);
  _enableDropdownKeyNav(dd, '.dd-nav-item');
  search.focus();

  setTimeout(() => {
    closer = async (e) => {
      if (!dd.contains(e.target)) {
        closeDropdown();
        if (isMulti && didChange) {
          const cascadeProps = _getCascadeDependents(propName, sourceDbPath).map(dep => dep.propName);
          await _finalizeRelationCellUpdate(el, entityPath, propName, ptc, cascadeProps);
        }
      }
    };
    document.addEventListener('pointerdown', closer);
  }, 0);
}

// Select型ドロップダウン
function showSelectDropdown(el, val, entityPath, propName, options, dbPath) {
  const sourceDbPath = dbPath || (typeof _valueEditorDbPath === 'function' ? _valueEditorDbPath(entityPath, el) : state.currentDbPath);
  const lockMsg = _valueEditorLockMessage(sourceDbPath, propName);
  if (lockMsg) { showStatus(lockMsg); return; }
  closeAllDropdowns();
  const dd = document.createElement('div');
  dd.className = 'status-dropdown';

  // 解除（値をクリア）
  const clearItem = document.createElement('div');
  clearItem.className = 'status-dropdown-item';
  clearItem.style.cssText = 'color:var(--fg2);font-style:italic;';
  clearItem.textContent = '解除';
  clearItem.addEventListener('click', async () => {
    closeAllDropdowns();
    if (val.value) {
      const oldVal = val.value;
      const savedStatus = val.status || '案';
      const savedNote = val.note || '';
      let currentVal = { ...val };
      try {
        await _apiPutValue(val, { _delete: true });
        historyPush('値解除: ' + propName + '=' + oldVal,
          async () => {
            const result = await _apiPostValue(entityPath, propName, oldVal, savedStatus, savedNote);
            if (result) {
              currentVal = {
                file: result.path || currentVal.file,
                property: propName,
                candidate_index: result.candidate_index,
                value: oldVal,
                status: savedStatus,
                note: savedNote,
              };
            }
            await _valueEditorReload(sourceDbPath);
          },
          async () => {
            await _apiPutValue(currentVal, { _delete: true });
            await _valueEditorReload(sourceDbPath);
          },
          typeof _dbScopeForPath === 'function' ? _dbScopeForPath(sourceDbPath) : _dbScope()
        );
        // Step 3: 部分更新化 (select 解除) — 削除済み val をローカル pivotData から除去
        _removeLocalPivotValue(val, entityPath, propName);
        _refreshAfterCellEdit(el, entityPath, propName);
      } catch (e) { showStatus('保存に失敗: ' + (e?.message || e), true); }
    }
  });
  dd.appendChild(clearItem);

  options.forEach(opt => {
    const item = document.createElement('div');
    item.className = 'status-dropdown-item';
    item.textContent = opt;
    if (val.value === opt) item.classList.add('selected');
    item.addEventListener('click', async () => {
      closeAllDropdowns();
      if (opt !== val.value) {
        const oldVal = val.value || '';
        try {
          await _apiPutValue(val, { new_value: opt });
          _dbUndoValue(propName + ': ' + oldVal + ' → ' + opt, val, oldVal, opt);
          val.value = opt;
          // Step 3: 部分更新化 (select 値変更)
          _refreshAfterCellEdit(el, entityPath, propName);
        } catch (e) { showStatus('保存に失敗: ' + (e?.message || e), true); }
      }
    });
    dd.appendChild(item);
  });

  const rect = el.getBoundingClientRect();
  const _zs = _getZoom();
  dd.style.position = 'fixed';
  dd.style.left = (rect.left / _zs) + 'px';
  dd.style.top = (rect.bottom / _zs + 2) + 'px';
  document.body.appendChild(dd);
  clampPopupToViewport(dd);
  _enableDropdownKeyNav(dd, '.status-dropdown-item');
  setTimeout(() => {
    const closer = (e) => {
      if (!dd.contains(e.target)) { closeAllDropdowns(); document.removeEventListener('pointerdown', closer); }
    };
    document.addEventListener('pointerdown', closer);
  }, 0);
}


function _showAutoFillStatusInput(dbPath, propName, ptc, currentValue) {
  closeColHeaderMenu();
  const currentText = (currentValue && typeof currentValue === 'object')
    ? JSON.stringify(currentValue, null, 2)
    : (currentValue || '');
  // インラインモーダル（prompt()禁止のため）
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal" style="width:350px;padding:16px;">
      <div style="font-size:14px;font-weight:bold;margin-bottom:8px;">ステータス連動設定</div>
      <div style="font-size:12px;color:var(--fg2);margin-bottom:12px;">
        どのステータスに変更されたとき、この日付プロパティに現在日時を自動入力しますか？<br>
        空にすると自動入力を解除します。
      </div>
      <input id="_autoFillStatusInput" type="text" value="${esc(currentText)}" placeholder="例: 撮影済み, 確認済み"
        style="width:100%;padding:6px 8px;font-size:13px;background:var(--bg);color:var(--fg);border:1px solid var(--border);border-radius:4px;box-sizing:border-box;margin-bottom:12px;">
      <div style="display:flex;gap:8px;justify-content:flex-end;">
        <button style="padding:4px 12px;font-size:12px;cursor:pointer;background:var(--bg3);color:var(--fg);border:1px solid var(--border);border-radius:4px;"
          data-action="this.closest('.modal-overlay').remove()">キャンセル</button>
        <button id="_autoFillStatusOk" style="padding:4px 12px;font-size:12px;cursor:pointer;background:var(--accent);color:var(--ui-fg-strong);border:none;border-radius:4px;">設定</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

  const input = document.getElementById('_autoFillStatusInput');
  input.focus();
  input.select();

  const confirm = async () => {
    const raw = input.value.trim();
    const newPtc = { ...ptc };
    let nextValue = raw;
    if (raw && /^[{\[]/.test(raw)) {
      try { nextValue = JSON.parse(raw); }
      catch (e) { showStatus('JSON形式の自動入力設定が不正です', true); return; }
    }
    if (raw) {
      newPtc.autoFillOnStatus = nextValue;
    } else {
      delete newPtc.autoFillOnStatus;
    }
    try {
      await Promise.resolve(setPropertyType(dbPath, propName, newPtc));
      showStatus(raw ? 'ステータス連動自動入力を設定' : '自動入力を解除');
      overlay.remove();
    } catch (e) {
      showStatus('自動入力設定の保存に失敗: ' + (e?.message || e), true);
    }
  };

  document.getElementById('_autoFillStatusOk').addEventListener('click', confirm);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') confirm(); });
}

