async function _showUserDropdown(anchor, val, entityPath, propName, currentValue, isMulti, options) {
  const dropdownOptions = options || {};
  if (typeof closeAllDropdowns === 'function') closeAllDropdowns(dropdownOptions.ctx || anchor);
  else document.querySelectorAll('.user-dropdown').forEach(el => el.remove());

  // 候補ユーザー一覧はMeldexUserPickerに統一（正本「スタッフ管理シート」+
  // ワークスペースメンバーのマージ。/team・/auth/usersへの参照はここで無くなる。
  // ユーザーアカウント一元管理 計画書 Phase 3、§5.8-1）。
  const users = window.MeldexUserPicker
    ? await window.MeldexUserPicker.getCandidates()
    : [];

  const dd = document.createElement('div');
  dd.className = 'cell-inline-dd user-dropdown';
  if (dropdownOptions.ctx?.paneId) dd.dataset.dbPaneId = dropdownOptions.ctx.paneId;
  dd.style.cssText = 'position:fixed;z-index:9999;min-width:180px;max-height:300px;overflow-y:auto;background:var(--ui-popup-bg, var(--bg2));border:1px solid var(--border);border-radius:6px;box-shadow:0 4px 12px rgba(0,0,0,.3);padding:4px;';
  dd.addEventListener('pointerdown', e => e.stopPropagation());
  dd.addEventListener('click', e => e.stopPropagation());

  const searchInput = document.createElement('input');
  searchInput.type = 'text';
  searchInput.placeholder = 'ユーザーを検索...';
  searchInput.style.cssText = 'width:100%;padding:4px 8px;font-size:12px;background:var(--bg);color:var(--fg);border:1px solid var(--border);border-radius:3px;margin-bottom:4px;box-sizing:border-box;';
  dd.appendChild(searchInput);

  const selected = new Set(
    isMulti && currentValue ? currentValue.split(',').map(s => s.trim()).filter(Boolean) : []
  );
  if (!isMulti && currentValue) selected.add(currentValue.trim());

  function renderList(filter) {
    dd.querySelectorAll('.user-option,.user-confirm-btn,.user-clear-btn,.user-empty-msg').forEach(el => el.remove());

    if (users.length === 0) {
      const msg = document.createElement('div');
      msg.className = 'user-empty-msg';
      msg.style.cssText = 'padding:8px;color:var(--fg2);font-size:12px;text-align:center;';
      msg.textContent = 'ユーザーが登録されていません。設定 → ワークスペースでメンバーを追加してください';
      dd.appendChild(msg);
      return;
    }

    const filtered = filter
      ? users.filter(u => u.name.toLowerCase().includes(filter.toLowerCase()))
      : users;

    filtered.forEach(u => {
      const item = document.createElement('div');
      item.className = 'user-option';
      const isSelected = selected.has(u.name);
      item.style.cssText = 'display:flex;align-items:center;gap:6px;padding:4px 8px;cursor:pointer;border-radius:3px;font-size:12px;'
        + (isSelected ? 'background:var(--accent);color:var(--ui-accent-fg, var(--ui-fg-strong));' : '');
      item.innerHTML = (isMulti ? '<span style="font-size:11px;">' + (isSelected ? '\u2713' : '\u3000') + '</span> ' : '')
        + _userAvatarSmall(u.name) + ' ' + esc(u.name)
        + '<span style="margin-left:auto;font-size:10px;color:' + (isSelected ? 'color-mix(in srgb, var(--ui-fg-strong) 70%, transparent)' : 'var(--fg2)') + ';">' + esc(u.role || '') + '</span>';
      item.addEventListener('mouseover', () => { if (!isSelected) item.style.background = 'var(--bg3)'; });
      item.addEventListener('mouseout', () => { if (!isSelected) item.style.background = ''; });
      item.addEventListener('click', async () => {
        if (isMulti) {
          if (selected.has(u.name)) selected.delete(u.name);
          else selected.add(u.name);
          renderList(searchInput.value);
        } else {
          const saved = await _saveUserValue(val, entityPath, propName, u.name, anchor, dropdownOptions);
          if (saved) dd.remove();
          else showStatus('ユーザーを保存できませんでした', true);
        }
      });
      dd.appendChild(item);
    });

    if (isMulti) {
      const confirmBtn = document.createElement('div');
      confirmBtn.className = 'user-confirm-btn dd-nav-item';
      confirmBtn.style.cssText = 'padding:4px 8px;margin-top:4px;text-align:center;cursor:pointer;font-size:12px;color:var(--accent);border-top:1px solid var(--border);font-weight:bold;';
      confirmBtn.textContent = '\u2713 確定';
      const commitMultiUserDropdown = async () => {
        const saved = await _saveUserValue(val, entityPath, propName, [...selected].join(', '), anchor, dropdownOptions);
        if (saved) dd.remove();
        else showStatus('ユーザーを保存できませんでした', true);
      };
      confirmBtn._ddActivate = commitMultiUserDropdown;
      confirmBtn.addEventListener('click', commitMultiUserDropdown);
      dd.appendChild(confirmBtn);
    }

    if (!isMulti && currentValue) {
      const clearBtn = document.createElement('div');
      clearBtn.className = 'user-clear-btn';
      clearBtn.style.cssText = 'padding:4px 8px;text-align:center;cursor:pointer;font-size:11px;color:var(--fg2);border-top:1px solid var(--border);margin-top:4px;';
      clearBtn.textContent = '選択を解除';
      clearBtn.addEventListener('click', async () => {
        const saved = await _saveUserValue(val, entityPath, propName, '', anchor, dropdownOptions);
        if (saved) dd.remove();
        else showStatus('ユーザーを保存できませんでした', true);
      });
      dd.appendChild(clearBtn);
    }
  }

  searchInput.addEventListener('input', () => renderList(searchInput.value));
  renderList('');

  if (typeof _positionCellDropdown === 'function') {
    _positionCellDropdown(dd, anchor, { gap: 2, minWidth: 180 });
  } else {
    const rect = anchor.getBoundingClientRect();
    const _zu = _getZoom();
    dd.style.left = (rect.left / _zu) + 'px';
    dd.style.top = (rect.bottom / _zu + 2) + 'px';
    document.body.appendChild(dd);
    clampPopupToViewport(dd);
  }
  _enableDropdownKeyNav(dd, '.user-option,.user-confirm-btn,.user-clear-btn');
  searchInput.focus();

  setTimeout(() => {
    document.addEventListener('pointerdown', function closer(ev) {
      if (!dd.contains(ev.target)) {
        dd.remove();
        if (typeof dropdownOptions.onCancel === 'function') dropdownOptions.onCancel();
        document.removeEventListener('pointerdown', closer);
      }
    });
  }, 0);
}
async function _saveUserValue(val, entityPath, propName, newValue, anchorEl, options) {
  const saveOptions = options || {};
  const dbPath = saveOptions.dbPath || (typeof _valueEditorDbPath === 'function' ? _valueEditorDbPath(entityPath, anchorEl) : state.currentDbPath);
  const ctx = saveOptions.ctx || (typeof _valueEditorContext === 'function' ? _valueEditorContext(entityPath, anchorEl, dbPath) : null);
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
      if (filePath && typeof historyPush === 'function') {
        let currentRef = {
          file: filePath,
          entry_path: entityPath,
          property: result?.property || propName,
          candidate_index: result?.candidate_index,
        };
        historyPush('値追加: ' + propName + '=' + nextValue,
          currentRef.candidate_index != null
            ? async () => { await _apiPutValue(currentRef, { _delete: true }); await _valueEditorReload(dbPath, ctx); }
            : async () => { await apiPost('/outliner/delete', { path: currentRef.file }); await _valueEditorReload(dbPath, ctx); },
          async () => {
            const redo = await _apiPostValue(entityPath, propName, nextValue, status, '');
            currentRef = {
              file: redo?.path || redo?.file || currentRef.file,
              entry_path: entityPath,
              property: redo?.property || propName,
              candidate_index: redo?.candidate_index,
            };
            await _valueEditorReload(dbPath, ctx);
          },
          typeof _dbScopeForPath === 'function' ? _dbScopeForPath(dbPath) : _dbScope(dbPath)
        );
      }
    }
    // Step 3: 部分更新化 (user/multi-user)
    // val が null (新規追加) の場合は新しいエントリ行が必要なのでフルリロード
    if (!val) {
      await _valueEditorReload(dbPath, ctx);
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
              entry_path: targetPath,
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
  const isSelfRef = (ptc.relationDb === '' && ptc.relationDb !== undefined);
  const sourceDbPath = ptc.__sourceDbPath || (typeof _valueEditorDbPath === 'function' ? _valueEditorDbPath(entityPath, el) : state.currentDbPath);
  const sourceCtx = typeof _valueEditorContext === 'function' ? _valueEditorContext(entityPath, el, sourceDbPath) : null;
  closeAllDropdowns(sourceCtx || el);
  const relDb = typeof _dbResolveRelationDbPath === 'function'
    ? _dbResolveRelationDbPath(sourceDbPath, ptc)
    : (isSelfRef ? sourceDbPath : (ptc.relationDb || ''));
  if (!relDb) { showStatus('参照先シートが設定されていません。列タイプ設定で指定してください。', true); return; }

  // 参照先DBのエントリ一覧（ID付き）を取得
  let entryList = []; // { name, id }
  let refEntities = {};
  try {
    const cachedMap = typeof _getCachedRelationMap === 'function' ? _getCachedRelationMap(relDb) : null;
    const map = cachedMap || await _getRelationMap(relDb);
    if (cachedMap && typeof _refreshRelationMapSoon === 'function') _refreshRelationMapSoon(relDb);
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
  if (sourceCtx?.paneId) dd.dataset.dbPaneId = sourceCtx.paneId;
  dd.style.cssText = 'max-height:300px;overflow-y:auto;min-width:200px;';
  dd.addEventListener('pointerdown', e => e.stopPropagation());
  dd.addEventListener('click', e => e.stopPropagation());

  // 検索ボックス
  const search = document.createElement('input');
  search.type = 'text'; search.placeholder = 'トピックを検索...';
  search.style.cssText = 'width:100%;padding:4px 6px;margin-bottom:4px;background:var(--bg);color:var(--fg);border:1px solid var(--border);border-radius:3px;font-size:12px;';
  dd.appendChild(search);

  const currentVals = isMulti ? ((val?.value) || '').split(',').map(s => s.trim()).filter(Boolean) : [(val?.value) || ''];
  const initialVals = [...currentVals];
  const relationValueText = (values) => (values || []).map(v => String(v || '').trim()).filter(Boolean).join(', ');
  let didChange = false;
  const refreshRelationCellNow = () => {
    try {
      if (typeof _refreshPivotRelationCell === 'function') {
        _refreshPivotRelationCell(el, entityPath, propName, ptc, { dbPath: sourceDbPath, ctx: sourceCtx });
      }
    } catch {}
  };

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
      item.addEventListener('click', () => selectRelationEntry(entry));
      listDiv.appendChild(item);
    });
    // 該当なしの文字列を新規エントリとして追加（部分一致候補の有無に関わらず末尾に表示）
    const trimmedFilter = (filter || '').trim();
    if (trimmedFilter && !entryList.some(e => e.name === trimmedFilter)) {
      const addItem = document.createElement('div');
      addItem.className = 'dd-nav-item';
      addItem.dataset.ddAdd = '1';
      addItem.style.cssText = 'padding:4px 8px;cursor:pointer;font-size:12px;display:flex;align-items:center;gap:6px;color:var(--accent);';
      addItem.innerHTML = lucide('plus', 12) + ' 「' + esc(trimmedFilter) + '」を新規作成';
      addItem.onmouseenter = () => { addItem.style.background = 'var(--bg4)'; };
      addItem.onmouseleave = () => { addItem.style.background = ''; };
      addItem._ddActivate = () => handleCreateNewRelationEntry(trimmedFilter);
      addItem.addEventListener('click', () => handleCreateNewRelationEntry(trimmedFilter));
      listDiv.appendChild(addItem);
    }
  };
  // 既存エントリ選択時の確定処理（新規作成後もこの関数を通す。処理内容は元itemクリックハンドラーをそのまま移動）
  const selectRelationEntry = async (entry) => {
    const oldVal = val?.value || '';
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
      if (idx >= 0) currentVals.splice(idx, 1);
      else currentVals.push(entry.id);
      didChange = relationValueText(currentVals) !== relationValueText(initialVals);
      renderList(search.value);
      if (dd.isConnected) search.focus({ preventScroll: true });
    } else {
      if (oldVal === entry.id || oldVal === entry.name) { closeDropdown(); return; }
      let cascadeClears = [];
      _upsertLocalPivotValue(entityPath, propName, val, entry.id);
      refreshRelationCellNow();
      try {
        cascadeClears = await _clearCascadeDependentValues(entityPath, propName, oldVal, entry.id, { dbPath: sourceDbPath, ctx: sourceCtx });
      } catch (e) {
        _upsertLocalPivotValue(entityPath, propName, val, oldVal);
        refreshRelationCellNow();
        showStatus('カスケード依存値の更新に失敗: ' + (e?.message || e), true);
        return;
      }
      try {
        await _apiPutValue(val, { new_value: entry.id });
      } catch (e) {
        _upsertLocalPivotValue(entityPath, propName, val, oldVal);
        refreshRelationCellNow();
        await _restoreCascadeDependentValues(entityPath, cascadeClears, { dbPath: sourceDbPath, ctx: sourceCtx });
        showStatus('リレーション値の保存に失敗: ' + (e?.message || e), true);
        await _valueEditorReload(sourceDbPath, sourceCtx);
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
        refreshRelationCellNow();
        if (cascadeClears.length && typeof _restoreCascadeDependentValues === 'function') {
          try {
            await _restoreCascadeDependentValues(entityPath, cascadeClears, { dbPath: sourceDbPath, ctx: sourceCtx });
          } catch (rollbackError) {
            console.error('リレーション同期失敗後のカスケード値復旧に失敗:', rollbackError, syncError);
          }
        }
        showStatus('リレーション同期に失敗: ' + (syncError?.message || syncError), true);
        closeDropdown();
        await _valueEditorReload(sourceDbPath, sourceCtx);
        return;
      }
      if (isSelfRef) {
        const selfName = entityPath.replace(/\.md$/, '').split('/').pop();
        const selfMap = _relationCache[relDb];
        const selfIdForCycle = selfMap ? (selfMap.nameToId[selfName] || selfName) : selfName;
        const circular = await _checkCircularDependency(relDb, selfIdForCycle, entry.id, propName);
        if (circular) showStatus('⚠ 循環依存が検出されました', true);
      }
      _dbUndoPairValue(propName, val, oldVal, entry.id, hasPair ? relDb : null, hasPair ? entry.id : null, hasPair ? ptc.pairWith : null, selfId, true, hasPair ? oldVal : null, entityPath, cascadeClears, bidirectionalCtx);
      closeDropdown();
      await _finalizeRelationCellUpdate(el, entityPath, propName, ptc, cascadeClears.map(c => c.propName));
    }
  };
  // 検索欄に完全一致が無い文字列を参照先シートへ新規エントリとして作成し、そのまま選択する
  // （Notionのリレーション追加と同じUX）。連打防止は creatingRelationEntry フラグで行う。
  let creatingRelationEntry = false;
  const handleCreateNewRelationEntry = async (rawName) => {
    const trimmed = String(rawName || '').trim();
    if (!trimmed || creatingRelationEntry) return;
    creatingRelationEntry = true;
    try {
      const sanitized = trimmed.replace(/[\\/:*?"<>|]/g, '_');
      await apiPost('/entity/create', { parent_path: relDb, name: sanitized });
      // 名前解決とロールアップの参照先キャッシュを同時に無効化する
      if (typeof _invalidateRelationTargetCaches === 'function') _invalidateRelationTargetCaches(relDb);
      else _relationCache[relDb] = null;
      const map = await _getRelationMap(relDb);
      const newId = (map?.nameToId && map.nameToId[sanitized]) || sanitized;
      const newEntry = { name: sanitized, id: newId };
      entryList.push(newEntry);
      entryList.sort((a, b) => a.name.localeCompare(b.name));
      await selectRelationEntry(newEntry);
    } catch (e) {
      showStatus('トピックの作成に失敗: ' + (e?.message || e), true);
    } finally {
      creatingRelationEntry = false;
    }
  };
  renderList('');
  search.oninput = () => renderList(search.value);
  dd.appendChild(listDiv);

  // 複数選択の確定ボタン
  if (isMulti) {
    const commitMultiRelationDropdown = async () => {
      const oldVal = relationValueText(initialVals);
      const nv = relationValueText(currentVals);
      closeDropdown();
      if (!didChange || oldVal === nv) return;
      const hasPair = ptc.pairWith && isSelfRef;
      const bidirectionalCtx = ptc.bidirectional ? { entityPath, propName, ptc } : null;
      let selfId = '';
      if (hasPair) {
        const selfName = entityPath.replace(/\.md$/, '').split('/').pop();
        const selfMap = _relationCache[relDb];
        selfId = selfMap ? (selfMap.nameToId[selfName] || selfName) : selfName;
      }
      let cascadeClears = [];
      const syncRollbackOps = [];
      try {
        if (typeof _upsertLocalPivotValue === 'function') _upsertLocalPivotValue(entityPath, propName, val, nv);
        if (val) val.value = nv;
        refreshRelationCellNow();
        if (typeof _clearCascadeDependentValues === 'function') {
          cascadeClears = await _clearCascadeDependentValues(entityPath, propName, oldVal, nv, { dbPath: sourceDbPath, ctx: sourceCtx });
        }
        if (val?.file) {
          await _apiPutValue(val, { new_value: nv });
        } else {
          const created = await _apiPostValue(entityPath, propName, nv, '採用', '');
          if (val && created) {
            val.file = created.path || created.file || val.file;
            val.property = created.property || propName;
            val.candidate_index = created.candidate_index;
            val.status = val.status || '採用';
          }
        }
        if (hasPair) {
          _relationCache[relDb] = null;
          const oldSet = new Set(initialVals);
          const nextSet = new Set(currentVals);
          for (const removed of initialVals.filter(id => !nextSet.has(id))) {
            const op = await _syncPairRelation(relDb, removed, ptc.pairWith, selfId, false);
            if (op?.undo) syncRollbackOps.push(op.undo);
          }
          for (const added of currentVals.filter(id => !oldSet.has(id))) {
            const op = await _syncPairRelation(relDb, added, ptc.pairWith, selfId, true);
            if (op?.undo) syncRollbackOps.push(op.undo);
            const circular = await _checkCircularDependency(relDb, selfId, added, propName);
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
        if (typeof _dbUndoValue === 'function' && val) _dbUndoValue(propName + ': ' + oldVal + ' → ' + nv, val, oldVal, nv);
        const cascadeProps = _getCascadeDependents(propName, sourceDbPath).map(dep => dep.propName);
        await _finalizeRelationCellUpdate(el, entityPath, propName, ptc, cascadeProps);
      } catch (e) {
        await _rollbackRelationSyncOps(syncRollbackOps);
        if (val?.file) {
          try { await _apiPutValue(val, { new_value: oldVal }); } catch {}
        }
        currentVals.splice(0, currentVals.length, ...initialVals);
        if (typeof _upsertLocalPivotValue === 'function') _upsertLocalPivotValue(entityPath, propName, val, oldVal);
        if (val) val.value = oldVal;
        if (cascadeClears.length && typeof _restoreCascadeDependentValues === 'function') {
          try {
            await _restoreCascadeDependentValues(entityPath, cascadeClears, { dbPath: sourceDbPath, ctx: sourceCtx });
          } catch (rollbackError) {
            console.error('リレーション保存失敗後のカスケード値復旧に失敗:', rollbackError, e);
          }
        }
        refreshRelationCellNow();
        showStatus('リレーション値の保存に失敗: ' + (e?.message || e), true);
        await _valueEditorReload(sourceDbPath, sourceCtx);
      }
    };
    const doneBtn = document.createElement('div');
    doneBtn.className = 'dd-nav-item';
    doneBtn.style.cssText = 'padding:4px 8px;text-align:center;cursor:pointer;font-size:12px;font-weight:bold;color:var(--accent);border-top:1px solid var(--border);margin-top:4px;';
    doneBtn.innerHTML = lucide('check', 12) + ' 確定';
    doneBtn._ddActivate = commitMultiRelationDropdown;
    doneBtn.addEventListener('click', commitMultiRelationDropdown);
    search.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey || e.altKey)) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation?.();
        commitMultiRelationDropdown();
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
  if (typeof _positionCellDropdown === 'function') {
    _positionCellDropdown(dd, el, { gap: 2, minWidth: 180 });
  } else {
    const rect = el.getBoundingClientRect();
    const _zr = _getZoom();
    dd.style.position = 'fixed'; dd.style.left = (rect.left / _zr) + 'px'; dd.style.top = (rect.bottom / _zr + 2) + 'px';
    document.body.appendChild(dd);
    clampPopupToViewport(dd);
  }
  _enableDropdownKeyNav(dd, '.dd-nav-item');
  search.focus();

  setTimeout(() => {
    closer = async (e) => {
      if (!dd.contains(e.target)) {
        closeDropdown();
      }
    };
    document.addEventListener('pointerdown', closer);
  }, 0);
}

// Select型ドロップダウン
function showSelectDropdown(el, val, entityPath, propName, options, dbPath) {
  const sourceDbPath = dbPath || (typeof _valueEditorDbPath === 'function' ? _valueEditorDbPath(entityPath, el) : state.currentDbPath);
  const sourceCtx = typeof _valueEditorContext === 'function' ? _valueEditorContext(entityPath, el, sourceDbPath) : null;
  const lockMsg = _valueEditorLockMessage(sourceDbPath, propName, sourceCtx);
  if (lockMsg) { showStatus(lockMsg); return; }
  const latestConfig = typeof getPropertyTypes === 'function' ? getPropertyTypes(sourceDbPath, sourceCtx)?.[propName] : null;
  const effectiveOptions = Array.isArray(latestConfig?.options) ? latestConfig.options : (Array.isArray(options) ? options : []);
  closeAllDropdowns(sourceCtx || el);
  const dd = document.createElement('div');
  dd.className = 'status-dropdown';
  if (sourceCtx?.paneId) dd.dataset.dbPaneId = sourceCtx.paneId;

  // 解除（値をクリア）
  const clearItem = document.createElement('div');
  clearItem.className = 'status-dropdown-item';
  clearItem.style.cssText = 'color:var(--fg2);font-style:italic;';
  clearItem.textContent = '解除';
  clearItem.addEventListener('click', async () => {
    closeAllDropdowns(sourceCtx || el);
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
                entry_path: entityPath,
                property: propName,
                candidate_index: result.candidate_index,
                value: oldVal,
                status: savedStatus,
                note: savedNote,
              };
            }
            await _valueEditorReload(sourceDbPath, sourceCtx);
          },
          async () => {
            await _apiPutValue(currentVal, { _delete: true });
            await _valueEditorReload(sourceDbPath, sourceCtx);
          },
          // 互換テスト用: typeof _dbScopeForPath === 'function' ? _dbScopeForPath(sourceDbPath) : _dbScope()
          typeof _dbScopeForPath === 'function' ? _dbScopeForPath(sourceDbPath) : _dbScope(sourceDbPath)
        );
        // Step 3: 部分更新化 (select 解除) — 削除済み val をローカル pivotData から除去
        _removeLocalPivotValue(val, entityPath, propName);
        _refreshAfterCellEdit(el, entityPath, propName);
      } catch (e) { showStatus('保存に失敗: ' + (e?.message || e), true); }
    }
  });
  dd.appendChild(clearItem);

  effectiveOptions.forEach(opt => {
    const item = document.createElement('div');
    item.className = 'status-dropdown-item';
    if (typeof createDbOptionColorDot === 'function') {
      const dot = createDbOptionColorDot(typeof getDbOptionColor === 'function' ? getDbOptionColor(latestConfig, opt) : '');
      if (dot) item.appendChild(dot);
    }
    item.appendChild(document.createTextNode(opt));
    if (val.value === opt) item.classList.add('selected');
    item.addEventListener('click', async () => {
      closeAllDropdowns(sourceCtx || el);
      if (opt !== val.value) {
        const oldVal = val.value || '';
        try {
          if (typeof _upsertLocalPivotValue === 'function') _upsertLocalPivotValue(entityPath, propName, val, opt);
          else val.value = opt;
          _refreshAfterCellEdit(el, entityPath, propName);
          await _apiPutValue(val, { new_value: opt });
          _dbUndoValue(propName + ': ' + oldVal + ' → ' + opt, val, oldVal, opt);
        } catch (e) {
          if (typeof _upsertLocalPivotValue === 'function') _upsertLocalPivotValue(entityPath, propName, val, oldVal);
          else val.value = oldVal;
          _refreshAfterCellEdit(el, entityPath, propName);
          showStatus('保存に失敗: ' + (e?.message || e), true);
        }
      }
    });
    dd.appendChild(item);
  });

  if (typeof _positionCellDropdown === 'function') {
    _positionCellDropdown(dd, el, { gap: 2 });
  } else {
    const rect = el.getBoundingClientRect();
    const _zs = _getZoom();
    dd.style.position = 'fixed';
    dd.style.left = (rect.left / _zs) + 'px';
    dd.style.top = (rect.bottom / _zs + 2) + 'px';
    document.body.appendChild(dd);
    clampPopupToViewport(dd);
  }
  _enableDropdownKeyNav(dd, '.status-dropdown-item');
  setTimeout(() => {
    const closer = (e) => {
      if (!dd.contains(e.target)) { closeAllDropdowns(sourceCtx || el); document.removeEventListener('pointerdown', closer); }
    };
    document.addEventListener('pointerdown', closer);
  }, 0);
}


function _showAutoFillStatusInput(dbPath, propName, ptc, currentValue) {
  closeColHeaderMenu();
  if (!globalThis.GBUI?.createModal) throw new Error('ステータス連動設定を初期化できませんでした');
  const currentText = (currentValue && typeof currentValue === 'object')
    ? JSON.stringify(currentValue, null, 2)
    : (currentValue || '');
  const body = document.createElement('div');
  body.innerHTML = `<div class="gb-section-desc">${fieldHelp('どのステータスに変更されたとき、この日時列に現在日時を自動入力しますか？空にすると自動入力を解除します。')}</div>
    <div class="field"><label for="_autoFillStatusInput">対象ステータス</label><input id="_autoFillStatusInput" class="gb-input" type="text" value="${esc(currentText)}" placeholder="例: 撮影済み, 確認済み" style="width:100%;min-width:0;box-sizing:border-box;"></div>`;
  const cancelButton = document.createElement('button');
  cancelButton.type = 'button'; cancelButton.className = 'gb-btn gb-btn-sm'; cancelButton.textContent = 'キャンセル';
  const applyButton = document.createElement('button');
  applyButton.type = 'button'; applyButton.id = '_autoFillStatusOk'; applyButton.className = 'gb-btn gb-btn-sm gb-btn-primary'; applyButton.textContent = '設定';
  let busy = false;
  const modalApi = globalThis.GBUI.createModal({
    id: 'db-auto-fill-status', title: 'ステータス連動設定', body, footer: [cancelButton, applyButton],
    variant: 'standard', geometryKey: 'db-auto-fill-status', minWidth: '0', initialFocus: '#_autoFillStatusInput',
    returnFocus: document.activeElement instanceof HTMLElement ? document.activeElement : undefined,
    closeLabel: 'ステータス連動設定を閉じる', closeOnEsc: true, closeOnOverlay: true,
    onBeforeClose: reason => reason === 'saved' || !busy,
  });
  modalApi.overlay.dataset.e2eId = 'db-auto-fill-status-overlay';
  modalApi.modal.dataset.e2eId = 'db-auto-fill-status-dialog';
  modalApi.modal.style.width = 'min(440px, calc(100vw - 24px))';
  modalApi.body.style.setProperty('overflow-x', 'hidden', 'important');
  const input = body.querySelector('#_autoFillStatusInput');
  cancelButton.addEventListener('click', () => modalApi.close('cancel'));

  const confirm = async () => {
    if (busy) return;
    const raw = input.value.trim();
    const newPtc = { ...ptc };
    let nextValue = raw;
    if (raw && /^[{\[]/.test(raw)) {
      try { nextValue = JSON.parse(raw); }
      catch (e) { showStatus('JSON形式の自動入力設定が不正です', true); input.focus(); return; }
    }
    if (raw) {
      newPtc.autoFillOnStatus = nextValue;
    } else {
      delete newPtc.autoFillOnStatus;
    }
    busy = true;
    cancelButton.disabled = true;
    applyButton.disabled = true;
    try {
      await Promise.resolve(setPropertyType(dbPath, propName, newPtc));
      showStatus(raw ? 'ステータス連動自動入力を設定' : '自動入力を解除');
      modalApi.close('saved');
    } catch (e) {
      showStatus('自動入力設定の保存に失敗: ' + (e?.message || e), true);
      busy = false;
      cancelButton.disabled = false;
      applyButton.disabled = false;
      applyButton.focus({ preventScroll: true });
    }
  };

  applyButton.addEventListener('click', confirm);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') confirm(); });
  modalApi.open();
  setTimeout(() => input.select(), 0);
  return modalApi;
}
