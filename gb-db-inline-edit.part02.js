function startCellInlineAdd(td, entityPath, entityName, propName) {
  const ctx = typeof _dbPaneContextFromEvent === 'function'
    ? _dbPaneContextFromEvent(td, { dbPath: typeof _dbPathFromEntityPath === 'function' ? _dbPathFromEntityPath(entityPath) : state.currentDbPath })
    : _currentPaneState();
  const dbPath = (ctx && ctx.dbPath) || state.currentDbPath;
  // 列ロックチェック
  const lockMsg = checkColumnEditable(dbPath, propName, ctx);
  if (lockMsg) { showStatus(lockMsg); return; }
  const container = td.querySelector('.cell-values');
  if (!container) return;
  let ptc = dbPath ? getPropertyTypes(dbPath, ctx)[propName] : null;
  if (ptc?.type) ptc = { ...ptc, type: String(ptc.type).replace(/_/g, '-') };
  const type = ptc?.type || 'text';
  const isPickerReplacementType = ['select', 'multi-select', 'common-tags', 'relation', 'multi-relation', 'user', 'multi-user', 'link', 'multi-link'].includes(type);
  const existingInlineEditor = td.querySelector('.cell-inline-input,.cell-inline-select,.cell-inline-dd,.cell-date-editor');
  if (existingInlineEditor) {
    if (isPickerReplacementType) existingInlineEditor.remove();
    else return;
  }
  // ステータス機能 OFF の DB は 1セル1値運用。既存値ありセルへの新規候補追加を禁止
  // セレクト / リレーション / ユーザー系は既存値の置き換え編集として扱うため、既存値ありでも候補ドロップダウンを開く。
  if (!getStatusEnabled(dbPath) && container.querySelector('.cell-value') && !isPickerReplacementType) {
    showStatus('このシートは1セル1値運用です（ステータス機能オフ）');
    return;
  }
  const addBtn = container.querySelector('.cell-add-btn');
  if (addBtn) {
    addBtn.style.display = 'none';
    addBtn.dataset.editingHidden = '1';
  }
  const cancel = () => {
    container.querySelectorAll('.cell-inline-input,.cell-inline-select,.cell-inline-dd,.cell-date-toggle,.cell-date-editor').forEach(el => el.remove());
    if (addBtn) { addBtn.style.display = ''; delete addBtn.dataset.editingHidden; }
    setActiveCell(td);
  };
  const pos = _cellPos(td);
  const isRelationType = type === 'relation' || type === 'multi-relation';
  const restoreActiveCellNow = () => {
    if (typeof setActiveCell === 'function' && td?.isConnected) setActiveCell(td, { scroll: false });
  };
  const closeInlineEditorShell = () => {
    container.querySelectorAll('.cell-inline-input,.cell-inline-select,.cell-inline-dd,.cell-date-toggle,.cell-date-editor').forEach(el => el.remove());
    if (addBtn) { addBtn.style.display = ''; delete addBtn.dataset.editingHidden; }
    restoreActiveCellNow();
  };
  const renderPickerCellFallbackNow = (displayValue) => {
    if (!isPickerReplacementType || isRelationType || !td?.isConnected) return false;
    const liveContainer = td.querySelector('.cell-values');
    if (!liveContainer) return false;
    const text = String(displayValue ?? '').trim();
    liveContainer.querySelectorAll('.cell-inline-input,.cell-inline-select,.cell-inline-dd,.cell-date-toggle,.cell-date-editor').forEach(el => el.remove());
    liveContainer.querySelectorAll('.cell-value').forEach(el => el.remove());
    if (text) {
      const valObj = {
        value: text,
        status: '採用',
        file: '',
        property: propName,
        candidate_index: null,
        note: '',
      };
      const thumbSize = typeof getThumbnailSize === 'function' ? getThumbnailSize(dbPath, { ctx }) : 80;
      if (typeof createTypedValueElement === 'function') {
        liveContainer.appendChild(createTypedValueElement(valObj, entityPath, propName, thumbSize, ptc, { dbPath, ctx, filter: ctx?.filter }));
      } else {
        const span = document.createElement('span');
        span.className = type === 'multi-select' ? 'multi-select-tags' : 'cell-select-val';
        span.textContent = text;
        liveContainer.appendChild(span);
      }
    }
    if (addBtn) { addBtn.style.display = ''; delete addBtn.dataset.editingHidden; }
    restoreActiveCellNow();
    return true;
  };
  const refreshRelationCellNow = (affectedProps) => {
    if (!isRelationType) return;
    try {
      if (typeof _refreshPivotRelationCell === 'function') {
        _refreshPivotRelationCell(td, entityPath, propName, ptc, { dbPath, ctx });
      } else if (typeof _finalizeRelationCellUpdate === 'function') {
        _finalizeRelationCellUpdate(td, entityPath, propName, ptc, affectedProps || [], { dbPath, ctx });
      }
    } catch {}
  };
  const refreshCellDisplayNow = (affectedProps, fallbackValue) => {
    let refreshed = false;
    if (isRelationType) {
      refreshRelationCellNow(affectedProps || []);
      refreshed = true;
    } else if (typeof _tryRefreshPivotCellLocal === 'function') {
      refreshed = !!_tryRefreshPivotCellLocal(td, entityPath, propName, { dbPath, ctx });
    }
    if (!refreshed && typeof _refreshPivotRelationCell === 'function') {
      try { refreshed = !!_refreshPivotRelationCell(td, entityPath, propName, ptc, { dbPath, ctx }); } catch {}
    }
    if (!refreshed && fallbackValue !== undefined) {
      refreshed = renderPickerCellFallbackNow(fallbackValue);
    }
    if (!refreshed) closeInlineEditorShell();
    else restoreActiveCellNow();
    return refreshed;
  };
  const removeLocalCellValue = (valueRef) => {
    if (!valueRef) return;
    const pivotData = (ctx && ctx.pivotData) || state.pivotData;
    const entData = pivotData?.entities?.[entityName];
    const values = entData?.[propName];
    if (!Array.isArray(values)) return;
    const idx = values.indexOf(valueRef);
    if (idx >= 0) values.splice(idx, 1);
  };
  const normalizeSelectOptionValues = (values) => {
    const list = Array.isArray(values) ? values : [values];
    return list
      .map(v => String(v ?? '').trim())
      .filter(Boolean);
  };
  const ensureSelectOptions = async (values) => {
    if (type !== 'select' && type !== 'multi-select') return true;
    if (!dbPath || !propName || typeof setPropertyType !== 'function') return true;
    const nextValues = normalizeSelectOptionValues(values);
    if (!nextValues.length) return true;
    const latest = (typeof getPropertyTypes === 'function' ? (getPropertyTypes(dbPath, ctx) || {})[propName] : null) || ptc || {};
    const currentOptions = Array.isArray(latest.options) ? latest.options : [];
    const merged = [...currentOptions];
    let changed = false;
    nextValues.forEach(value => {
      if (!merged.includes(value)) {
        merged.push(value);
        changed = true;
      }
    });
    if (!changed) return true;
    const optionIds = { ...(latest.option_ids || {}) };
    merged.forEach(value => {
      optionIds[value] = optionIds[value]
        || window.GbDbSchemaMutation?.newId?.('option')
        || ('option_' + Date.now().toString(36));
    });
    const nextConfig = { ...latest, type, options: merged, option_ids: optionIds };
    ptc = { ...nextConfig };
    try {
      await Promise.resolve(setPropertyType(dbPath, propName, nextConfig, ctx));
      return true;
    } catch (e) {
      showStatus('選択肢の保存に失敗: ' + (e?.message || e), true);
      return false;
    }
  };
  const captureSelectedPeerCellsForBulkValueApply = () => {
    const table = td.closest?.('table');
    if (!table || !propName) return [];
    const selected = Array.from(table.querySelectorAll('tbody td.db-range-selected[data-prop-name]'));
    if (selected.length <= 1 || !selected.includes(td)) return [];
    return selected.filter(cell => cell !== td && cell.dataset?.propName === propName);
  };
  const bulkValueApplyPeerCells = captureSelectedPeerCellsForBulkValueApply();
  const selectedPeerCellsForBulkValueApply = () => {
    const captured = bulkValueApplyPeerCells.filter(cell => cell?.isConnected && cell.dataset?.propName === propName);
    if (captured.length) return captured;
    return captureSelectedPeerCellsForBulkValueApply();
  };
  const applyValueToSelectedPeerCells = (value, meta = {}) => {
    const valueText = String(value ?? '');
    if (!meta.allowEmptyClear && valueText === '' && value !== 'false') return;
    if (typeof _dbPrepareWriteClipboardCellValue !== 'function'
        || typeof _dbPersistPreparedCellMutations !== 'function') return;
    const targets = selectedPeerCellsForBulkValueApply();
    if (!targets.length) return;
    const ops = [];
    const writeMeta = {
      status: meta.status || '採用',
      note: meta.note || '',
    };
    targets.forEach(cell => {
      try {
        const op = _dbPrepareWriteClipboardCellValue(cell, valueText, ctx, writeMeta);
        if (op) ops.push(op);
      } catch {}
    });
    if (!ops.length) return;
    const debug = {
      startedAt: Date.now(),
      source: { entityName, propName, value: valueText },
      written: ops.length,
      errors: [],
    };
    try { window.__meldexLastCellBulkValueApply = debug; } catch {}
    _dbPersistPreparedCellMutations(ops, ctx, debug).then(results => {
      const failed = (results || []).filter(v => v < 0).length;
      debug.failed = failed;
      if (failed && typeof showStatus === 'function') {
        showStatus(`選択セルへの反映に失敗しました（${failed} 件）`, true);
      }
    }).catch(e => {
      debug.failed = ops.length;
      debug.error = e?.message || String(e || '');
      if (typeof showStatus === 'function') showStatus('選択セルへの反映に失敗しました', true);
    });
  };
  const saveAndRestore = async (value, moveTo) => {
    if (!value && value !== 'false') { cancel(); return; }
    let optimisticValue = null;
    let restoredOptimistic = false;
    let createdValueRef = null;
    let cascadeClears = [];
    let bidirectionalOp = null;
    let backendCommitted = false;
    const writeStatus = isPickerReplacementType || !getStatusEnabled(dbPath) ? '採用' : '案';
    try {
      closeInlineEditorShell();
      if (typeof _upsertLocalPivotValue === 'function') {
        optimisticValue = _upsertLocalPivotValue(entityPath, propName, null, value, {
          file: '',
          property: propName,
          candidate_index: null,
          status: writeStatus,
          note: '',
        }, ctx);
        refreshCellDisplayNow([], value);
        _restoreCellPos(pos, moveTo);
        restoredOptimistic = true;
      }
      const result = await _apiPostValue(entityPath, propName, value, writeStatus, '');
      const filePath = result?.path || '';
      createdValueRef = {
        file: result?.path || result?.file || '',
        entry_path: entityPath,
        entry_id: result?.entry_id || '',
        property: result?.property || propName,
        candidate_index: result?.candidate_index,
      };
      const bidirectionalCtx = ((type === 'relation' || type === 'multi-relation') && ptc?.bidirectional)
        ? { entityPath, propName, ptc }
        : null;
      if (bidirectionalCtx && typeof _applyBidirectionalRelationSync === 'function') {
        bidirectionalOp = await _applyBidirectionalRelationSync({
          sourceDbPath: dbPath,
          entityPath,
          propName,
          ptc,
          oldValue: '',
          newValue: value,
        });
      }
      if ((type === 'relation' || type === 'multi-relation')
          && typeof _clearCascadeDependentValues === 'function') {
        cascadeClears = await _clearCascadeDependentValues(entityPath, propName, '', value, { dbPath, ctx });
      }
      backendCommitted = true;
      applyValueToSelectedPeerCells(value, { status: writeStatus });
      const historyScope = typeof _dbScopeForPath === 'function'
        ? _dbScopeForPath(dbPath)
        : (typeof _dbScope === 'function' ? _dbScope(dbPath) : 'db:' + String(dbPath || '').replace(/\\/g, '/'));
      if (filePath) {
        const candIdx = result?.candidate_index;
        const undoFn = (candIdx != null)
          ? async () => {
            await _apiPutValue({file: filePath, entry_path: entityPath, property: propName, candidate_index: candIdx}, { _delete: true });
            if (bidirectionalCtx && typeof _applyBidirectionalRelationSync === 'function') {
              await _applyBidirectionalRelationSync({
                sourceDbPath: dbPath,
                entityPath,
                propName,
                ptc,
                oldValue: value,
                newValue: '',
              });
            }
            if (cascadeClears.length && typeof _restoreCascadeDependentValues === 'function') {
              await _restoreCascadeDependentValues(entityPath, cascadeClears, { dbPath, ctx });
            }
            await selectDatabase(dbPath, ctx, { silent: true });
          }
          : async () => {
            await apiPost('/outliner/delete', { path: filePath });
            if (bidirectionalCtx && typeof _applyBidirectionalRelationSync === 'function') {
              await _applyBidirectionalRelationSync({
                sourceDbPath: dbPath,
                entityPath,
                propName,
                ptc,
                oldValue: value,
                newValue: '',
              });
            }
            if (cascadeClears.length && typeof _restoreCascadeDependentValues === 'function') {
              await _restoreCascadeDependentValues(entityPath, cascadeClears, { dbPath, ctx });
            }
            await selectDatabase(dbPath, ctx, { silent: true });
          };
        historyPush('値追加: ' + propName + '=' + value,
          undoFn,
          async () => {
            await _apiPostValue(entityPath, propName, value, writeStatus, '');
            if (bidirectionalCtx && typeof _applyBidirectionalRelationSync === 'function') {
              await _applyBidirectionalRelationSync({
                sourceDbPath: dbPath,
                entityPath,
                propName,
                ptc,
                oldValue: '',
                newValue: value,
              });
            }
            if (cascadeClears.length && typeof _redoCascadeDependentValues === 'function') {
              await _redoCascadeDependentValues(entityPath, cascadeClears, { dbPath, ctx });
            }
            await selectDatabase(dbPath, ctx, { silent: true });
          },
          historyScope
        );
      }
      if (isRelationType
          && typeof _upsertLocalPivotValue === 'function'
          && typeof _finalizeRelationCellUpdate === 'function') {
        _upsertLocalPivotValue(entityPath, propName, optimisticValue, value, {
          file: filePath,
          property: propName,
          candidate_index: result?.candidate_index,
          status: writeStatus,
          note: '',
        }, ctx);
        await _finalizeRelationCellUpdate(td, entityPath, propName, ptc, cascadeClears.map(c => c.propName), { dbPath, ctx });
        return true;
      }
      // 楽観的増分更新: pivotData をローカルで更新してからセル DOM だけ書き換える
      // フォールバック条件 (group化中等) では従来通り全再描画
      if (optimisticValue) {
        optimisticValue.file = filePath;
        optimisticValue.entry_path = entityPath;
        optimisticValue.candidate_index = result?.candidate_index;
        optimisticValue.property = propName;
        optimisticValue.status = optimisticValue.status || writeStatus;
        optimisticValue.note = optimisticValue.note || '';
      } else {
        const pivotData = (ctx && ctx.pivotData) || state.pivotData;
        if (pivotData?.entities) {
        const _entName = entityPath.replace(/\.md$/, '').split('/').pop();
        const _entData = pivotData.entities[_entName];
        if (_entData) {
          if (!Array.isArray(_entData[propName])) _entData[propName] = [];
          _entData[propName].push({
            property: propName,
            entry_path: entityPath,
            value: value,
            status: writeStatus,
            note: '',
            file: filePath,
            candidate_index: result?.candidate_index,
          });
        }
        }
      }
      const _refreshed = refreshCellDisplayNow(cascadeClears.map(c => c.propName), value);
      if (!_refreshed) {
        await selectDatabase(dbPath, ctx, { silent: true });
      }
      if (!restoredOptimistic) _restoreCellPos(pos, moveTo);
      return true;
    } catch(e) {
      if (!backendCommitted) {
        if (cascadeClears.length && typeof _restoreCascadeDependentValues === 'function') {
          try {
            await _restoreCascadeDependentValues(entityPath, cascadeClears, { dbPath, ctx });
          } catch (rollbackError) {
            console.error('セル保存失敗後のカスケード値復旧に失敗:', rollbackError, e);
          }
        }
        if (bidirectionalOp?.undo) {
          try { await bidirectionalOp.undo(); } catch (rollbackError) {
            console.error('セル保存失敗後の双方向リレーション復旧に失敗:', rollbackError, e);
          }
        }
        if (createdValueRef?.candidate_index != null) {
          try { await _apiPutValue(createdValueRef, { _delete: true }); } catch (rollbackError) {
            console.error('セル保存失敗後の候補値削除に失敗:', rollbackError, e);
          }
        } else if (createdValueRef?.file) {
          try { await apiPost('/outliner/delete', { path: createdValueRef.file }); } catch (rollbackError) {
            console.error('セル保存失敗後の値ファイル削除に失敗:', rollbackError, e);
          }
        }
      }
      if (optimisticValue) {
        removeLocalCellValue(optimisticValue);
        refreshCellDisplayNow([], '');
      }
      if (dbPath && typeof selectDatabase === 'function') {
        try { await selectDatabase(dbPath, ctx || undefined, { silent: true }); } catch {}
      }
      if (typeof showStatus === 'function') showStatus('保存に失敗: ' + (e?.message || e), true);
      cancel();
      return false;
    }
  };
  const saveSelectAndRestore = async (value, moveTo) => {
    if (!value && value !== 'false') { cancel(); return; }
    if (!await ensureSelectOptions(value)) { cancel(); return; }
    const pivotData = (ctx && ctx.pivotData) || state.pivotData;
    const entData = pivotData?.entities?.[entityName];
    const rawValues = Array.isArray(entData?.[propName]) ? entData[propName] : [];
    const existing = (typeof getAdoptedValueForWrite === 'function' ? getAdoptedValueForWrite(rawValues) : null)
      || rawValues.find(v => v && v.file)
      || null;
    if (!existing?.file) {
      await saveAndRestore(value, moveTo);
      return;
    }
    if (!existing.property) existing.property = propName;
    if ((existing.value || '') === value) { cancel(); return; }
    const oldValue = existing.value || '';
    try {
      closeInlineEditorShell();
      if (typeof _upsertLocalPivotValue === 'function') {
        _upsertLocalPivotValue(entityPath, propName, existing, value, {
          file: existing.file,
          property: existing.property || propName,
          candidate_index: existing.candidate_index,
          status: existing.status || '採用',
          note: existing.note || '',
        }, ctx);
      } else {
        existing.value = value;
      }
      const refreshed = refreshCellDisplayNow([], value);
      _restoreCellPos(pos, moveTo);
      await _apiPutValue(existing, { new_value: value });
      if (typeof _dbUndoValue === 'function') _dbUndoValue(propName + ': ' + oldValue + ' → ' + value, existing, oldValue, value);
      if (!refreshed) await selectDatabase(dbPath, ctx, { silent: true });
      applyValueToSelectedPeerCells(value, { status: existing.status || '採用', note: existing.note || '' });
    } catch (e) {
      if (typeof _upsertLocalPivotValue === 'function') {
        _upsertLocalPivotValue(entityPath, propName, existing, oldValue, {
          file: existing.file,
          property: existing.property || propName,
          candidate_index: existing.candidate_index,
          status: existing.status || '採用',
          note: existing.note || '',
        }, ctx);
      } else {
        existing.value = oldValue;
      }
      refreshCellDisplayNow([], oldValue);
      cancel();
    }
  };
  const splitMultiSelectValue = (value) => String(value || '').split(',').map(s => s.trim()).filter(Boolean);
  const reportCommonTagPartialSave = (createdTagNames) => {
    if (!Array.isArray(createdTagNames) || !createdTagNames.length || typeof showStatus !== 'function') return;
    showStatus(
      'タグ「' + createdTagNames.join('、') + '」は作成されましたが、このセルへの設定に失敗しました。再度選択してください。',
      true
    );
  };
  const saveMultiSelectAndRestore = async (value, moveTo, saveOptions = {}) => {
    const nextValue = splitMultiSelectValue(value).join(', ');
    if (!await ensureSelectOptions(splitMultiSelectValue(nextValue))) { cancel(); return; }
    const pivotData = (ctx && ctx.pivotData) || state.pivotData;
    const entData = pivotData?.entities?.[entityName];
    const rawValues = Array.isArray(entData?.[propName]) ? entData[propName] : [];
    const existing = (typeof getAdoptedValueForWrite === 'function' ? getAdoptedValueForWrite(rawValues) : null)
      || rawValues.find(v => v && v.file)
      || null;
    if (!existing?.file) {
      if (nextValue) {
        const saved = await saveAndRestore(nextValue, moveTo);
        if (!saved) reportCommonTagPartialSave(saveOptions.createdTagNames);
      }
      else cancel();
      return;
    }
    if (!existing.property) existing.property = propName;
    const oldValue = existing.value || '';
    if (oldValue === nextValue) { cancel(); return; }
    const saveRef = { ...existing, property: existing.property || propName };
    try {
      closeInlineEditorShell();
      if (nextValue) {
        if (typeof _upsertLocalPivotValue === 'function') {
          _upsertLocalPivotValue(entityPath, propName, existing, nextValue, {
            file: existing.file,
            property: existing.property || propName,
            candidate_index: existing.candidate_index,
            status: existing.status || '採用',
            note: existing.note || '',
          }, ctx);
        } else {
          existing.value = nextValue;
        }
      } else if (typeof _removeLocalPivotValue === 'function') {
        _removeLocalPivotValue(existing, entityPath, propName);
      } else {
        existing.value = '';
      }
      const refreshed = refreshCellDisplayNow([], nextValue);
      _restoreCellPos(pos, moveTo);
      if (nextValue) {
        await _apiPutValue(saveRef, { new_value: nextValue });
        if (typeof _syncValueRefAfterSave === 'function') _syncValueRefAfterSave(saveRef, existing);
        if (typeof _dbUndoValue === 'function') _dbUndoValue(propName + ': ' + oldValue + ' → ' + nextValue, existing, oldValue, nextValue);
      } else {
        await _apiPutValue(saveRef, { _delete: true });
        if (typeof historyPush === 'function') {
          const savedStatus = existing.status || '採用';
          const savedNote = existing.note || '';
          let currentRef = { ...saveRef, value: oldValue, status: savedStatus, note: savedNote };
          historyPush('値削除: ' + propName + '=' + oldValue,
            async () => {
              const result = await _apiPostValue(entityPath, propName, oldValue, savedStatus, savedNote);
              if (result) {
                currentRef = {
                  file: result.path || currentRef.file,
                  entry_path: entityPath,
                  property: propName,
                  candidate_index: result.candidate_index,
                  value: oldValue,
                  status: savedStatus,
                  note: savedNote,
                };
              }
              await selectDatabase(dbPath, ctx, { silent: true });
            },
            async () => {
              await _apiPutValue(currentRef, { _delete: true });
              await selectDatabase(dbPath, ctx, { silent: true });
            },
            _dbScope(dbPath)
          );
        }
      }
      if (!refreshed) await selectDatabase(dbPath, ctx, { silent: true });
      applyValueToSelectedPeerCells(nextValue, {
        status: existing.status || '採用',
        note: existing.note || '',
        allowEmptyClear: true,
      });
    } catch (e) {
      if (typeof _upsertLocalPivotValue === 'function') {
        _upsertLocalPivotValue(entityPath, propName, existing, oldValue, {
          file: saveRef.file || existing.file,
          property: existing.property || propName,
          candidate_index: existing.candidate_index,
          status: existing.status || '採用',
          note: existing.note || '',
        }, ctx);
      } else {
        existing.value = oldValue;
      }
      refreshCellDisplayNow([], oldValue);
      cancel();
      reportCommonTagPartialSave(saveOptions.createdTagNames);
    }
  };
  const openMultiSelectDropdown = () => {
    if (typeof closeAllDropdowns === 'function') closeAllDropdowns(ctx || td);
    const paneRoot = ctx?.containerEl || td.closest?.('.gb-pane-content,.gb-production-sheet-embed') || document;
    paneRoot.querySelectorAll('.cell-add-btn[data-editing-hidden]').forEach(btn => {
      if (!td.contains(btn)) {
        btn.style.display = '';
        delete btn.dataset.editingHidden;
      }
    });
    const pivotData = (ctx && ctx.pivotData) || state.pivotData;
    const entData = pivotData?.entities?.[entityName];
    const rawValues = Array.isArray(entData?.[propName]) ? entData[propName] : [];
    const existing = (typeof getAdoptedValueForWrite === 'function' ? getAdoptedValueForWrite(rawValues) : null)
      || rawValues.find(v => v && v.file)
      || null;
    const selected = new Set(splitMultiSelectValue(existing?.value || ''));
    const baseOptions = Array.isArray(ptc?.options) ? ptc.options : [];
    const dynamicResult = window.MeldexDbDynamicOptions?.resolve?.(ptc, entData) || null;
    const dynamicOptions = dynamicResult?.options || [];
    const invalidDynamicSelections = dynamicResult
      ? [...selected].filter(value => value && !dynamicOptions.includes(value))
      : [];
    // 列内で実際に使われている値（スキーマ未登録分）も候補へ統合する。
    // 行ごとに候補が変わる動的選択肢列（optionSource）では他行の値を混ぜない。
    const columnValues = (!dynamicResult && typeof collectDbColumnValues === 'function')
      ? collectDbColumnValues(pivotData, propName, { splitCsv: true })
      : [];
    const optionSet = new Set([...baseOptions, ...dynamicOptions, ...columnValues, ...selected]);
    const dd = document.createElement('div');
    dd.className = 'cell-inline-dd status-dropdown';
    if (ctx?.paneId) dd.dataset.dbPaneId = ctx.paneId;
    dd.style.cssText = 'max-height:300px;overflow-y:auto;min-width:180px;';
    dd.addEventListener('pointerdown', e => e.stopPropagation());
    dd.addEventListener('click', e => e.stopPropagation());
    let pointerCloser = null;
    const closeMultiSelectDropdown = (shouldCancel = false) => {
      if (dd.parentNode) dd.remove();
      if (pointerCloser) {
        document.removeEventListener('pointerdown', pointerCloser);
        pointerCloser = null;
      }
      if (shouldCancel) cancel();
    };
    try {
      window.__meldexLastMultiSelectDropdownOpen = {
        dbPath,
        entityName,
        propName,
        type,
        options: [...optionSet],
      };
    } catch {}
    dd.addEventListener('db-dropdown-cancel', () => closeMultiSelectDropdown(true));
    const search = document.createElement('input');
    search.type = 'text';
    search.placeholder = '検索...';
    search.style.cssText = 'width:100%;padding:3px 6px;margin-bottom:2px;background:var(--bg);color:var(--fg);border:1px solid var(--border);border-radius:3px;font-size:12px;box-sizing:border-box;';
    dd.appendChild(search);
    if (invalidDynamicSelections.length) {
      const warning = document.createElement('div');
      warning.setAttribute('role', 'alert');
      warning.style.cssText = 'margin:2px 0 4px;padding:5px 7px;border:1px solid var(--warning,#d6a100);border-radius:3px;color:var(--warning,#d6a100);font-size:11px;line-height:1.4;';
      warning.textContent = `現在のページ数・開始位置では使えない選択値があります（${invalidDynamicSelections.join('、')}）。設定は自動削除されません。`;
      dd.appendChild(warning);
    }
    const listDiv = document.createElement('div');
    const toggleValue = (opt) => {
      if (!opt) return;
      if (selected.has(opt)) selected.delete(opt);
      else selected.add(opt);
      if (!optionSet.has(opt)) optionSet.add(opt);
      renderList(search.value);
      if (dd.isConnected) search.focus({ preventScroll: true });
      requestAnimationFrame(() => {
        if (dd.isConnected) search.focus({ preventScroll: true });
      });
    };
    const renderList = (filter) => {
      listDiv.innerHTML = '';
      const query = String(filter || '').trim();
      const options = [...optionSet].filter(Boolean);
      const filtered = query
        ? options.filter(opt => opt.toLowerCase().includes(query.toLowerCase()))
        : options;
      filtered.forEach(opt => {
        const item = document.createElement('div');
        item.className = 'dd-nav-item status-dropdown-item';
        item.style.cssText = 'padding:3px 8px;cursor:pointer;font-size:12px;display:flex;align-items:center;gap:6px;';
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = selected.has(opt);
        item.appendChild(cb);
        if (typeof appendDbOptionColorSwatch === 'function') {
          appendDbOptionColorSwatch(item, { dbPath, propName, option: opt, ctx });
        } else if (typeof createDbOptionColorDot === 'function') {
          const dot = createDbOptionColorDot(typeof getDbOptionColor === 'function' ? getDbOptionColor(ptc, opt) : '');
          if (dot) item.appendChild(dot);
        }
        item.appendChild(document.createTextNode(opt));
        item._ddActivate = () => toggleValue(opt);
        item.addEventListener('click', () => toggleValue(opt));
        listDiv.appendChild(item);
      });
      if (query && !options.some(opt => opt === query)) {
        const addItem = document.createElement('div');
        addItem.className = 'dd-nav-item status-dropdown-item';
        addItem.dataset.ddAdd = '1';
        addItem.style.cssText = 'padding:3px 8px;cursor:pointer;font-size:12px;color:var(--fg2);';
        addItem.innerHTML = lucide('plus', 12) + ' ' + esc(query) + ' を追加';
        addItem._ddActivate = () => toggleValue(query);
        addItem.addEventListener('click', () => toggleValue(query));
        listDiv.appendChild(addItem);
      }
      if (!listDiv.children.length) {
        const empty = document.createElement('div');
        empty.style.cssText = 'padding:6px 8px;color:var(--fg2);font-size:12px;font-style:italic;';
        empty.textContent = '選択肢がありません';
        listDiv.appendChild(empty);
      }
    };
    search.oninput = () => renderList(search.value);
    renderList('');
    dd.appendChild(listDiv);
    const clearItem = document.createElement('div');
    clearItem.className = 'status-dropdown-item status-dropdown-clear';
    clearItem.style.cssText = 'padding:3px 8px;text-align:center;cursor:pointer;font-size:12px;color:var(--fg2);border-top:1px solid var(--border);';
    clearItem.textContent = '選択を解除';
    clearItem.addEventListener('click', () => {
      closeMultiSelectDropdown(false);
      saveMultiSelectAndRestore('', null);
    });
    dd.appendChild(clearItem);
    const commitMultiSelectDropdown = () => {
      closeMultiSelectDropdown(false);
      const value = [...selected].join(', ');
      saveMultiSelectAndRestore(value, null);
    };
    const doneBtn = document.createElement('div');
    doneBtn.className = 'dd-nav-item status-dropdown-item';
    doneBtn.style.cssText = 'padding:3px 8px;text-align:center;cursor:pointer;font-size:12px;font-weight:bold;color:var(--accent);border-top:1px solid var(--border);';
    doneBtn.innerHTML = lucide('check', 12) + ' 確定';
    doneBtn._ddActivate = commitMultiSelectDropdown;
    doneBtn.addEventListener('click', commitMultiSelectDropdown);
    dd.appendChild(doneBtn);
    search.addEventListener('keydown', (e) => {
      if (typeof _dbInlineIsComposing === 'function' && _dbInlineIsComposing(e)) return;
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey || e.altKey)) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation?.();
        commitMultiSelectDropdown();
      }
    });
    if (typeof _enableDropdownKeyNav === 'function') {
      _enableDropdownKeyNav(dd, '.dd-nav-item');
    }
    if (typeof _positionCellDropdown === 'function') {
      _positionCellDropdown(dd, td, { gap: 2, minWidth: 180 });
    } else {
      const rect = td.getBoundingClientRect();
      const _zm = _getZoom();
      dd.style.position = 'fixed';
      dd.style.left = (rect.left / _zm) + 'px';
      dd.style.top = (rect.bottom / _zm + 2) + 'px';
      document.body.appendChild(dd);
      clampPopupToViewport(dd);
    }
    search.focus();
    setTimeout(() => {
      pointerCloser = (e) => {
        if (!dd.isConnected) {
          document.removeEventListener('pointerdown', pointerCloser);
          pointerCloser = null;
          return;
        }
        if (!dd.contains(e.target) && !e.target.closest?.('.gb-palette-popup')) {
          closeMultiSelectDropdown(true);
        }
      };
      document.addEventListener('pointerdown', pointerCloser);
    }, 0);
  };
  // 共通タグ型: グローバルタグカタログ（.meldex/global-tags.json）から複数選択する
  // ドロップダウン。候補は非同期取得。検索欄に一致するタグが無い場合はその場で新規タグを作成できる。
  const openCommonTagsDropdown = () => {
    if (typeof closeAllDropdowns === 'function') closeAllDropdowns(ctx || td);
    const paneRoot = ctx?.containerEl || td.closest?.('.gb-pane-content,.gb-production-sheet-embed') || document;
    paneRoot.querySelectorAll('.cell-add-btn[data-editing-hidden]').forEach(btn => {
      if (!td.contains(btn)) {
        btn.style.display = '';
        delete btn.dataset.editingHidden;
      }
    });
    const pivotData = (ctx && ctx.pivotData) || state.pivotData;
    const entData = pivotData?.entities?.[entityName];
    const rawValues = Array.isArray(entData?.[propName]) ? entData[propName] : [];
    const existing = (typeof getAdoptedValueForWrite === 'function' ? getAdoptedValueForWrite(rawValues) : null)
      || rawValues.find(v => v && v.file)
      || null;
    const selectedIds = new Set(splitMultiSelectValue(existing?.value || ''));
    const dd = document.createElement('div');
    dd.className = 'cell-inline-dd status-dropdown';
    if (ctx?.paneId) dd.dataset.dbPaneId = ctx.paneId;
    dd.dataset.e2eId = 'db-common-tags-dropdown';
    dd.style.cssText = 'max-height:300px;overflow-y:auto;min-width:200px;';
    dd.addEventListener('pointerdown', e => e.stopPropagation());
    dd.addEventListener('click', e => e.stopPropagation());
    let pointerCloser = null;
    const closeCommonTagsDropdown = (shouldCancel = false) => {
      if (dd.parentNode) dd.remove();
      if (pointerCloser) {
        document.removeEventListener('pointerdown', pointerCloser);
        pointerCloser = null;
      }
      if (shouldCancel) cancel();
    };
    dd.addEventListener('db-dropdown-cancel', () => closeCommonTagsDropdown(true));
    const loadingMsg = document.createElement('div');
    loadingMsg.style.cssText = 'padding:6px 8px;color:var(--fg2);font-size:12px;';
    loadingMsg.textContent = 'タグを読み込んでいます...';
    dd.appendChild(loadingMsg);
    if (typeof _positionCellDropdown === 'function') {
      _positionCellDropdown(dd, td, { gap: 2, minWidth: 200 });
    } else {
      const rect = td.getBoundingClientRect();
      const _zm = _getZoom();
      dd.style.position = 'fixed';
      dd.style.left = (rect.left / _zm) + 'px';
      dd.style.top = (rect.bottom / _zm + 2) + 'px';
      document.body.appendChild(dd);
      clampPopupToViewport(dd);
    }
    const tagsApi = window.MeldexGlobalTags;
    if (!tagsApi || typeof tagsApi.loadTagsCached !== 'function') {
      loadingMsg.textContent = 'タグ機能を利用できません';
      return;
    }
    tagsApi.loadTagsCached().then(data => {
      if (!dd.isConnected) return;
      dd.textContent = '';
      const allTags = Array.isArray(data?.tags) ? data.tags : [];
      const groups = Array.isArray(data?.groups) ? data.groups : [];
      const groupsById = Object.fromEntries(groups.map(g => [g.id, g]));
      const search = document.createElement('input');
      search.type = 'text';
      search.placeholder = 'タグを検索・作成...';
      search.style.cssText = 'width:100%;padding:3px 6px;margin-bottom:2px;background:var(--bg);color:var(--fg);border:1px solid var(--border);border-radius:3px;font-size:12px;box-sizing:border-box;';
      dd.appendChild(search);
      const listDiv = document.createElement('div');
      const createdTagNames = [];
      const toggleValue = (tagId) => {
        if (!tagId) return;
        const key = String(tagId);
        if (selectedIds.has(key)) selectedIds.delete(key);
        else selectedIds.add(key);
        renderList(search.value);
        if (dd.isConnected) search.focus({ preventScroll: true });
      };
      let creating = false;
      const createAndToggle = async (name) => {
        const trimmed = String(name || '').trim();
        if (!trimmed || creating) return;
        creating = true;
        try {
          const existingTag = allTags.find(t => String(t.name || '').trim().toLowerCase() === trimmed.toLowerCase());
          let tag = existingTag;
          if (!tag) {
            const created = await tagsApi.createTag({ name: trimmed });
            tag = created?.tag || null;
            if (tag) {
              allTags.push(tag);
              createdTagNames.push(String(tag.name || trimmed));
            }
          }
          if (tag) {
            selectedIds.add(String(tag.id));
            search.value = '';
            renderList('');
          }
        } catch (err) {
          if (typeof showStatus === 'function') showStatus('タグを作成できませんでした: ' + (err?.userMessage || err?.message || err), true);
        } finally {
          creating = false;
        }
      };
      const renderList = (filter) => {
        listDiv.innerHTML = '';
        const query = String(filter || '').trim().toLowerCase();
        const filtered = query ? allTags.filter(t => String(t.name || '').toLowerCase().includes(query)) : allTags;
        filtered.forEach(tag => {
          const item = document.createElement('div');
          item.className = 'dd-nav-item status-dropdown-item';
          item.style.cssText = 'padding:3px 8px;cursor:pointer;font-size:12px;display:flex;align-items:center;gap:6px;';
          const cb = document.createElement('input');
          cb.type = 'checkbox';
          cb.checked = selectedIds.has(String(tag.id));
          item.appendChild(cb);
          const color = typeof tagsApi.effectiveTagColor === 'function' ? tagsApi.effectiveTagColor(tag, groupsById) : 'var(--accent)';
          const label = document.createElement('span');
          label.className = 'gb-common-tag-option-label';
          label.style.cssText = 'min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600;color:' + color + ';';
          label.textContent = tag.name || '';
          item.appendChild(label);
          item._ddActivate = () => toggleValue(tag.id);
          item.addEventListener('click', () => toggleValue(tag.id));
          listDiv.appendChild(item);
        });
        if (query && !allTags.some(t => String(t.name || '').trim().toLowerCase() === query)) {
          const addItem = document.createElement('div');
          addItem.className = 'dd-nav-item status-dropdown-item';
          addItem.dataset.ddAdd = '1';
          addItem.style.cssText = 'padding:3px 8px;cursor:pointer;font-size:12px;color:var(--fg2);';
          addItem.innerHTML = lucide('plus', 12) + ' 「' + esc(String(filter || '').trim()) + '」を新規タグとして追加';
          addItem._ddActivate = () => createAndToggle(filter);
          addItem.addEventListener('click', () => createAndToggle(filter));
          listDiv.appendChild(addItem);
        }
        if (!listDiv.children.length) {
          const empty = document.createElement('div');
          empty.style.cssText = 'padding:6px 8px;color:var(--fg2);font-size:12px;font-style:italic;';
          empty.textContent = 'タグがありません';
          listDiv.appendChild(empty);
        }
      };
      search.oninput = () => renderList(search.value);
      renderList('');
      dd.appendChild(listDiv);
      const clearItem = document.createElement('div');
      clearItem.className = 'status-dropdown-item status-dropdown-clear';
      clearItem.style.cssText = 'padding:3px 8px;text-align:center;cursor:pointer;font-size:12px;color:var(--fg2);border-top:1px solid var(--border);';
      clearItem.textContent = '選択を解除';
      clearItem.addEventListener('click', () => {
        closeCommonTagsDropdown(false);
        saveMultiSelectAndRestore('', null);
      });
      dd.appendChild(clearItem);
      const commitCommonTagsDropdown = async () => {
        closeCommonTagsDropdown(false);
        const value = [...selectedIds].join(', ');
        await saveMultiSelectAndRestore(value, null, { createdTagNames });
      };
      const doneBtn = document.createElement('div');
      doneBtn.className = 'dd-nav-item status-dropdown-item';
      doneBtn.style.cssText = 'padding:3px 8px;text-align:center;cursor:pointer;font-size:12px;font-weight:bold;color:var(--accent);border-top:1px solid var(--border);';
      doneBtn.innerHTML = lucide('check', 12) + ' 確定';
      doneBtn._ddActivate = commitCommonTagsDropdown;
      doneBtn.addEventListener('click', commitCommonTagsDropdown);
      dd.appendChild(doneBtn);
      search.addEventListener('keydown', (e) => {
        if (typeof _dbInlineIsComposing === 'function' && _dbInlineIsComposing(e)) return;
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey || e.altKey)) {
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation?.();
          commitCommonTagsDropdown();
        }
      });
      if (typeof _enableDropdownKeyNav === 'function') _enableDropdownKeyNav(dd, '.dd-nav-item');
      if (typeof clampPopupToViewport === 'function' && dd.isConnected) clampPopupToViewport(dd);
      search.focus();
    }).catch(() => {
      if (dd.isConnected) loadingMsg.textContent = 'タグを読み込めませんでした';
    });
    setTimeout(() => {
      pointerCloser = (e) => {
        if (!dd.isConnected) {
          document.removeEventListener('pointerdown', pointerCloser);
          pointerCloser = null;
          return;
        }
        if (!dd.contains(e.target)) closeCommonTagsDropdown(true);
      };
      document.addEventListener('pointerdown', pointerCloser);
    }, 0);
  };
  // --- チェックボックス: クリック即座にtrue/false ---
  if (type === 'checkbox') {
    saveAndRestore('true', null);
    return;
  }
  // --- カラー: 共通カラーパレットで色を選ぶ ---
  if (type === 'color') {
    // カラーはインラインエディタではなくポップアップのパレットで選ぶので、+ボタンは隠さず戻す
    if (addBtn) { addBtn.style.display = ''; delete addBtn.dataset.editingHidden; }
    if (typeof openColorPalette !== 'function') { cancel(); return; }
    const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
    let handled = false, saveTimer = null;
    openColorPalette(addBtn && addBtn.isConnected ? addBtn : td, '', (color) => {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        const nv = HEX.test(String(color || '').trim()) ? color.trim() : '';
        if (handled || !nv) return;
        handled = true;
        saveAndRestore(nv, null);
      }, 250);
    });
    setActiveCell(td);
    return;
  }
  // --- リンク: フォルダツリーのダイアログから選択 ---
  if (type === 'link' || type === 'multi-link') {
    const startLinkEditor = type === 'multi-link' && typeof startDbMultiLinkCellEdit === 'function'
      ? startDbMultiLinkCellEdit : (typeof startDbLinkCellEdit === 'function' ? startDbLinkCellEdit : null);
    if (startLinkEditor) {
      startLinkEditor({
        td, entityPath, entityName, propName, ptc, ctx, dbPath,
        cancel, closeInlineEditorShell, refreshCellDisplayNow,
        restoreCellPos: () => _restoreCellPos(pos, null),
      });
    } else {
      cancel();
    }
    return;
  }
  // --- セレクト: ドロップダウン表示 ---
  if (type === 'select') {
    if (typeof closeAllDropdowns === 'function') closeAllDropdowns(ctx || td);
    const paneRoot = ctx?.containerEl || td.closest?.('.gb-pane-content,.gb-production-sheet-embed') || document;
    paneRoot.querySelectorAll('.cell-add-btn[data-editing-hidden]').forEach(btn => {
      if (!td.contains(btn)) {
        btn.style.display = '';
        delete btn.dataset.editingHidden;
      }
    });
    const dd = document.createElement('div');
    dd.className = 'cell-inline-dd status-dropdown';
    if (ctx?.paneId) dd.dataset.dbPaneId = ctx.paneId;
    dd.style.maxHeight = '300px';
    dd.style.overflowY = 'auto';
    let pointerCloser = null;
    const closeSelectDropdown = (shouldCancel = false) => {
      if (dd.parentNode) dd.remove();
      if (pointerCloser) {
        document.removeEventListener('pointerdown', pointerCloser);
        pointerCloser = null;
      }
      if (shouldCancel) cancel();
    };
    dd.addEventListener('db-dropdown-cancel', () => closeSelectDropdown(true));
    // 解除（入力キャンセル）
    const clearItem = document.createElement('div');
    clearItem.className = 'status-dropdown-item status-dropdown-clear';
    clearItem.style.cssText = 'color:var(--fg2);font-style:italic;';
    clearItem.textContent = '解除';
    clearItem.addEventListener('click', () => { closeSelectDropdown(true); });
    dd.appendChild(clearItem);
    // 候補 = スキーマ登録済み選択肢 + 列内で実際に使われている値（スキーマ未登録分）。
    // 行ごとに候補が変わる動的選択肢列（optionSource）では他行の値を混ぜない。
    const selectOptions = [...(ptc.options || [])];
    if (!ptc?.optionSource && typeof collectDbColumnValues === 'function') {
      const selectPivotData = (ctx && ctx.pivotData) || state.pivotData;
      collectDbColumnValues(selectPivotData, propName).forEach(v => {
        if (!selectOptions.includes(v)) selectOptions.push(v);
      });
    }
    selectOptions.forEach(opt => {
      const item = document.createElement('div');
      item.className = 'status-dropdown-item';
      if (typeof appendDbOptionColorSwatch === 'function') {
        appendDbOptionColorSwatch(item, { dbPath, propName, option: opt, ctx });
      } else if (typeof createDbOptionColorDot === 'function') {
        const dot = createDbOptionColorDot(typeof getDbOptionColor === 'function' ? getDbOptionColor(ptc, opt) : '');
        if (dot) item.appendChild(dot);
      }
      item.appendChild(document.createTextNode(opt));
      item.addEventListener('click', () => { closeSelectDropdown(false); saveSelectAndRestore(opt, null); });
      dd.appendChild(item);
    });
    // 「新しい選択肢を入力」
    const addItem = document.createElement('div');
    addItem.className = 'status-dropdown-item';
    addItem.style.color = 'var(--fg2)';
    addItem.innerHTML = lucide('plus', 12) + ' 新しい値を入力';
    addItem.addEventListener('click', () => {
      closeSelectDropdown(false);
      _createTextInput('select');
    });
    dd.appendChild(addItem);
    if (typeof _positionCellDropdown === 'function') {
      _positionCellDropdown(dd, td, { gap: 2 });
    } else {
      const rect = td.getBoundingClientRect();
      const _zi = _getZoom();
      dd.style.position = 'fixed';
      dd.style.left = (rect.left / _zi) + 'px';
      dd.style.top = (rect.bottom / _zi + 2) + 'px';
      dd.style.minWidth = (rect.width / _zi) + 'px';
      document.body.appendChild(dd);
      clampPopupToViewport(dd);
    }
    _enableDropdownKeyNav(dd, '.status-dropdown-item');
    setTimeout(() => {
      pointerCloser = (e) => {
        if (!dd.isConnected) {
          document.removeEventListener('pointerdown', pointerCloser);
          pointerCloser = null;
          return;
        }
        if (!dd.contains(e.target) && !e.target.closest?.('.gb-palette-popup')) closeSelectDropdown(true);
      };
      document.addEventListener('pointerdown', pointerCloser);
    }, 0);
    return;
  }
  // --- マルチセレクト: ドロップダウンで複数選択 ---
  if (type === 'multi-select') {
    openMultiSelectDropdown();
    return;
  }
  // --- 共通タグ: グローバルタグカタログからドロップダウンで複数選択（新規作成も可） ---
  if (type === 'common-tags') {
    openCommonTagsDropdown();
    return;
  }
  // --- ユーザー: ドロップダウンでユーザー選択 ---
  if (type === 'user' || type === 'multi-user') {
    _showUserDropdown(td, null, entityPath, propName, '', type === 'multi-user', {
      onCancel: cancel,
      status: '案',
      dbPath,
      ctx,
    });
    return;
  }
  // --- リレーション: ドロップダウンで参照先DBエントリ選択 ---
  if (type === 'relation' || type === 'multi-relation') {
    const isMulti = type === 'multi-relation';
    (async () => {
      // 自己参照対応: relationDbが空文字の場合は現在のDBを参照
      const isSelfRef = (ptc.relationDb === '' && ptc.relationDb !== undefined);
      const relDb = typeof _dbResolveRelationDbPath === 'function'
        ? _dbResolveRelationDbPath(dbPath, ptc)
        : (isSelfRef ? dbPath : (ptc.relationDb || ''));
      if (!relDb) { showStatus('参照先シートが未設定です。列タイプ設定で指定してください。', true); cancel(); return; }
      // entry = { name, id }
      let entryList = [];
      let refEntities = {};
      try {
        const cachedMap = typeof _getCachedRelationMap === 'function' ? _getCachedRelationMap(relDb) : null;
        const map = cachedMap || (typeof _getRelationMap === 'function'
          ? await _getRelationMap(relDb)
          : (typeof _setRelationMapCache === 'function'
            ? _setRelationMapCache(relDb, await apiFetch('/pivot?path=' + encodeURIComponent(relDb)))
            : null));
        if (cachedMap && typeof _refreshRelationMapSoon === 'function') _refreshRelationMapSoon(relDb);
        refEntities = map?.entities || {};
        entryList = Object.entries(map?.idToName || {}).map(([id, name]) => ({ name, id }));
        entryList.sort((a, b) => a.name.localeCompare(b.name));
      } catch (err) {
        showStatus('参照先シート読み込み失敗: ' + relDb, true); cancel(); return;
      }
      // カスケード絞り込み（依存元列に値があれば参照先DBをフィルタ）
      if (ptc.cascadeFrom) {
        let parentValue = '';
        try {
          // D-7: ctx.pivotData を優先 (state.pivotData にフォールバック)
          const piv = (ctx && ctx.pivotData) || state.pivotData;
          if (piv?.entities) {
            const entData = piv.entities[entityName];
            if (entData && entData[ptc.cascadeFrom]) {
              const vals = entData[ptc.cascadeFrom];
              const adopted = vals.find(v => v.status === '採用' || v.status === '掲載済み');
              parentValue = (adopted || vals[0])?.value || '';
            }
          }
        } catch {}
        if (parentValue) {
          entryList = entryList.filter(entry => {
            const entData = refEntities[entry.name];
            if (!entData) return false;
            const cascadeVals = entData[ptc.cascadeKey] || [];
            return cascadeVals.some(v => (v.value || '').split(',').map(s => s.trim()).includes(parentValue));
          });
        }
      }
      // 自己参照時: 自分自身を除外
      if (isSelfRef && entityName) {
        entryList = entryList.filter(e => e.name !== entityName);
      }
      // 参照先シートにエントリが無くても、検索欄からの新規作成に使えるようドロップダウン自体は表示する
      const dd = document.createElement('div');
      dd.className = 'cell-inline-dd status-dropdown';
      if (ctx?.paneId) dd.dataset.dbPaneId = ctx.paneId;
      dd.style.cssText = 'max-height:250px;overflow-y:auto;min-width:180px;';
      dd.addEventListener('pointerdown', e => e.stopPropagation());
      dd.addEventListener('click', e => e.stopPropagation());
      const search = document.createElement('input');
      search.type = 'text'; search.placeholder = '検索...';
      search.style.cssText = 'width:100%;padding:3px 6px;margin-bottom:2px;background:var(--bg);color:var(--fg);border:1px solid var(--border);border-radius:3px;font-size:12px;box-sizing:border-box;';
      dd.appendChild(search);
      const listDiv = document.createElement('div');
      const selected = []; // 選択済みID配列
      let closer = null;
      const closeDropdown = () => {
        if (dd.parentNode) dd.remove();
        if (closer) { document.removeEventListener('pointerdown', closer); closer = null; }
      };
      const commitRelationDropdown = () => {
        closeDropdown();
        if (selected.length) saveAndRestore(selected.join(', '), null);
        else cancel();
      };
      const toggleRelationEntry = (entry) => {
        if (!entry?.id) return;
        const si = selected.indexOf(entry.id);
        if (si >= 0) selected.splice(si, 1);
        else selected.push(entry.id);
        renderList(search.value);
        if (dd.isConnected) search.focus({ preventScroll: true });
        requestAnimationFrame(() => {
          if (dd.isConnected) search.focus({ preventScroll: true });
        });
      };
      // 既存エントリをクリックした時と同じ確定処理（新規作成後もこの経路を通す）
      const selectRelationEntry = (entry) => {
        if (isMulti) {
          toggleRelationEntry(entry);
        } else {
          closeDropdown();
          saveAndRestore(entry.id, null);
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
          const map = typeof _getRelationMap === 'function' ? await _getRelationMap(relDb) : null;
          const newId = (map?.nameToId && map.nameToId[sanitized]) || sanitized;
          const newEntry = { name: sanitized, id: newId };
          entryList.push(newEntry);
          entryList.sort((a, b) => a.name.localeCompare(b.name));
          selectRelationEntry(newEntry);
        } catch (e) {
          showStatus('トピックの作成に失敗: ' + (e?.message || e), true);
        } finally {
          creatingRelationEntry = false;
        }
      };
      const renderList = (filter) => {
        listDiv.innerHTML = '';
        const filtered = filter ? entryList.filter(e => e.name.toLowerCase().includes(filter.toLowerCase())) : entryList;
        filtered.forEach(entry => {
          const item = document.createElement('div');
          item.className = 'dd-nav-item status-dropdown-item';
          item.style.cssText = 'padding:3px 8px;cursor:pointer;font-size:12px;';
          if (isMulti) {
            item.style.display = 'flex';
            item.style.alignItems = 'center';
            item.style.gap = '6px';
            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.checked = selected.includes(entry.id);
            cb.tabIndex = -1;
            item.appendChild(cb);
            item.appendChild(document.createTextNode(entry.name));
          } else {
            item.textContent = entry.name;
          }
          if (selected.includes(entry.id)) item.style.color = 'var(--accent)';
          item.onmouseenter = () => { item.style.background = 'var(--bg4)'; };
          item.onmouseleave = () => { item.style.background = ''; };
          item._ddActivate = () => selectRelationEntry(entry);
          item.addEventListener('click', (e) => {
            if (isMulti) {
              e.preventDefault();
              e.stopPropagation();
            }
            selectRelationEntry(entry);
          });
          listDiv.appendChild(item);
        });
        if (filtered.length === 0) {
          const empty = document.createElement('div');
          empty.style.cssText = 'padding:6px 8px;color:var(--fg2);font-size:12px;font-style:italic;';
          empty.textContent = '該当なし';
          listDiv.appendChild(empty);
        }
        // 該当なしの文字列を新規エントリとして追加（部分一致候補の有無に関わらず末尾に表示）
        const trimmedFilter = (filter || '').trim();
        if (trimmedFilter && !entryList.some(e => e.name === trimmedFilter)) {
          const addItem = document.createElement('div');
          addItem.className = 'dd-nav-item status-dropdown-item';
          addItem.dataset.ddAdd = '1';
          addItem.style.cssText = 'padding:3px 8px;cursor:pointer;font-size:12px;color:var(--accent);';
          addItem.innerHTML = lucide('plus', 12) + ' 「' + esc(trimmedFilter) + '」を新規作成';
          addItem.onmouseenter = () => { addItem.style.background = 'var(--bg4)'; };
          addItem.onmouseleave = () => { addItem.style.background = ''; };
          addItem._ddActivate = () => handleCreateNewRelationEntry(trimmedFilter);
          addItem.addEventListener('click', () => handleCreateNewRelationEntry(trimmedFilter));
          listDiv.appendChild(addItem);
        }
      };
      renderList('');
      search.oninput = () => renderList(search.value);
      dd.appendChild(listDiv);
      if (isMulti) {
        const doneBtn = document.createElement('div');
        doneBtn.className = 'dd-nav-item';
        doneBtn.style.cssText = 'padding:3px 8px;text-align:center;cursor:pointer;font-size:12px;font-weight:bold;color:var(--accent);border-top:1px solid var(--border);';
        doneBtn.innerHTML = lucide('check', 12) + ' 確定';
        doneBtn._ddActivate = commitRelationDropdown;
        doneBtn.addEventListener('click', commitRelationDropdown);
        dd.appendChild(doneBtn);
        search.addEventListener('keydown', (e) => {
          if (typeof _dbInlineIsComposing === 'function' && _dbInlineIsComposing(e)) return;
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey || e.altKey)) {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation?.();
            commitRelationDropdown();
          }
        });
      }
      if (typeof _positionCellDropdown === 'function') {
        _positionCellDropdown(dd, td, { gap: 2, minWidth: 180 });
      } else {
        const rect = td.getBoundingClientRect();
        const _zr = _getZoom();
        dd.style.position = 'fixed'; dd.style.left = (rect.left / _zr) + 'px'; dd.style.top = (rect.bottom / _zr + 2) + 'px';
        document.body.appendChild(dd);
        clampPopupToViewport(dd);
      }
      _enableDropdownKeyNav(dd, '.dd-nav-item');
      search.focus();
      setTimeout(() => {
        closer = (e) => {
          if (!dd.contains(e.target)) {
            closeDropdown();
            cancel();
          }
        };
        document.addEventListener('pointerdown', closer);
      }, 0);
    })();
    return;
  }
  // --- 日付: date input ---
  if (type === 'date') {
    const editor = typeof _dbDateCreateEditor === 'function'
      ? _dbDateCreateEditor('', ptc, {
        layout: 'inline',
        className: 'cell-date-editor',
        rootStyle: 'display:flex;align-items:center;gap:4px;flex-wrap:wrap;width:100%;',
        inputStyle: 'flex:1 1 0;min-width:120px;padding:3px 6px;background:var(--bg2);color:var(--fg);border:1px solid var(--accent);border-radius:3px;font-size:12px;box-sizing:border-box;',
      })
      : null;
    if (!editor) return;
    // +ボタンを一時的に隠す
    if (addBtn) { addBtn.dataset.editingHidden = '1'; addBtn.style.display = 'none'; }
    const restoreAddBtn = () => { if (addBtn && addBtn.dataset.editingHidden) { addBtn.style.display = ''; delete addBtn.dataset.editingHidden; } };
    container.insertBefore(editor.root, addBtn);
    editor.focus();
    let committed = false;
    const commit = () => {
      if (committed) return;
      committed = true;
      restoreAddBtn();
      const value = editor.getValue();
      if (value) saveAndRestore(value, null);
      else cancel();
    };
    editor.root.addEventListener('focusout', (e) => {
      if (editor.contains(e.relatedTarget)) return;
      commit();
    });
    editor.root.addEventListener('db-date-editor-commit', (e) => {
      e.preventDefault();
      commit();
    });
    if (!editor.mode?.withTime && !editor.mode?.range && editor.startInput) {
      editor.startInput.addEventListener('change', commit);
    }
    editor.root.addEventListener('keydown', (e) => {
      if (typeof _dbInlineIsComposing === 'function' && _dbInlineIsComposing(e)) return;
      if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation?.(); commit(); }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation?.(); committed = true; restoreAddBtn(); cancel(); }
    });
    return;
  }
  // --- 数値: number input ---
  if (type === 'number') {
    const inp = document.createElement('input');
    inp.className = 'cell-inline-input';
    inp.type = 'number';
    inp.placeholder = '数値';
    inp.style.cssText = 'width:100%;padding:3px 6px;background:var(--bg2);color:var(--fg);border:1px solid var(--accent);border-radius:3px;font-size:12px;box-sizing:border-box;';
    container.insertBefore(inp, addBtn);
    inp.focus();
    _attachCommitHandlers(inp, saveAndRestore, cancel);
    return;
  }
  // --- テキスト / URL / その他: text input ---
  _createTextInput(type);
  function _createTextInput(forType) {
    const isPlainText = !forType || forType === 'text' || forType === 'furigana';
    const inp = document.createElement(isPlainText ? 'textarea' : 'input');
    inp.className = isPlainText ? 'cell-inline-input cell-inline-input--textarea' : 'cell-inline-input';
    if (!isPlainText) inp.type = 'text';
    if (isPlainText) inp.rows = 1;
    inp.placeholder = forType === 'url' ? 'https://...' : forType === 'multi-select' ? '値1, 値2, ...' : '値を入力';
    inp.style.cssText = 'width:100%;padding:3px 6px;background:var(--bg2);color:var(--fg);border:1px solid var(--accent);border-radius:3px;font-size:12px;box-sizing:border-box;';
    container.insertBefore(inp, addBtn);
    if (isPlainText) _autosizeInlineTextarea(inp);
    inp.focus();
    _attachCommitHandlers(inp, forType === 'select' ? saveSelectAndRestore : saveAndRestore, cancel);
  }
  function _autosizeInlineTextarea(inp) {
    if (!inp || inp.tagName !== 'TEXTAREA') return;
    const lineHeight = parseFloat(getComputedStyle(inp).lineHeight) || 18;
    const maxHeight = Math.max(lineHeight * 10 + 8, 80);
    inp.style.height = 'auto';
    inp.style.height = Math.min(inp.scrollHeight, maxHeight) + 'px';
    inp.style.overflowY = inp.scrollHeight > maxHeight ? 'auto' : 'hidden';
  }
  function _attachCommitHandlers(inp, save, cancelFn) {
    let committed = false;
    const commit = (moveTo) => {
      if (committed) return;
      committed = true;
      const v = inp.value.trim();
      if (!v) { cancelFn(); return; }
      save(v, moveTo);
    };
    inp.addEventListener('input', () => _autosizeInlineTextarea(inp));
    inp.addEventListener('keydown', (e) => {
      if (typeof _dbInlineIsComposing === 'function' && _dbInlineIsComposing(e)) return;
      const allowNewline = inp.tagName === 'TEXTAREA' && e.key === 'Enter' && e.shiftKey && !e.ctrlKey && !e.metaKey;
      if (e.key === 'Enter' && !allowNewline) { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation?.(); commit(null); }
      else if (e.key === 'Tab') { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation?.(); commit(e.shiftKey ? 'left' : 'right'); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation?.(); committed = true; cancelFn(); }
    });
    // 入力欄の中をクリックしただけ（キャレット移動）や日本語変換中は確定しない
    if (typeof attachInlineBlurCommit === 'function') attachInlineBlurCommit(inp, () => commit(null));
    else inp.addEventListener('blur', () => commit(null));
  }
}
