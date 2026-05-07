/* インライン編集・キーボードナビゲーション — gb-database.js から分離 */

function startHeaderInlineRename(th, oldName, dbPath) {
  if (th.querySelector('.th-rename-input')) return;
  const label = th.querySelector('.th-label');
  if (label) label.style.display = 'none';
  const inp = document.createElement('input');
  inp.className = 'th-rename-input';
  inp.type = 'text';
  inp.value = oldName;
  if (getComputedStyle(th).position === 'static') th.style.position = 'relative';
  inp.style.cssText = [
    'position:absolute',
    'left:6px',
    'right:28px',
    'top:50%',
    'transform:translateY(-50%)',
    'width:auto',
    'max-width:calc(100% - 34px)',
    'height:22px',
    'line-height:18px',
    'box-sizing:border-box',
    'margin:0',
    'padding:1px 4px',
    'background:var(--bg2)',
    'color:var(--fg)',
    'border:1px solid var(--accent)',
    'border-radius:3px',
    'font-size:12px',
    'font-weight:bold',
    'white-space:nowrap',
    'z-index:4'
  ].join(';');
  th.insertBefore(inp, th.querySelector('.col-resize-handle'));
  inp.focus();
  inp.select();
  let committed = false;
  const commit = async () => {
    if (committed) return;
    committed = true;
    const newName = inp.value.trim();
    if (!newName || newName === oldName) {
      renderPivot();
      restoreActiveCellByProp(oldName);
      return;
    }
    const existingProps = [
      ...(state.pivotData?.properties || []),
      ...(getColOrder(dbPath) || []),
      ...Object.keys(getPropertyTypes(dbPath) || {}),
    ];
    if (existingProps.some(name => name === newName && name !== oldName)) {
      showStatus('同名のプロパティが既にあります: ' + newName, true);
      renderPivot();
      restoreActiveCellByProp(oldName);
      return;
    }
    if (typeof renameDbProperty === 'function') {
      await renameDbProperty(dbPath, oldName, newName);
    }
    const selected = _getSelectedColumns(dbPath).map(name => name === oldName ? newName : name);
    _setSelectedColumns(dbPath, selected, newName);
    renderPivot();
    restoreActiveCellByProp(newName);
  };
  inp.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    if (e.key === 'Escape') { committed = true; renderPivot(); restoreActiveCellByProp(oldName); }
    if (e.key === 'Tab') { e.preventDefault(); commit(); }
  });
  inp.addEventListener('blur', commit);
}

function startEntityInlineRename(td, nameSpan, oldName, dbPath) {
  if (td.querySelector('.entity-rename-input')) return;
  // 行インデックスを記憶
  const _renCtx = _currentPaneState();
  const _renTblId = _renCtx.tableId || 'pivot-table';
  const table = _paneEl(_renCtx, '#' + _renTblId) || document.getElementById('pivot-table');
  const dataRows = table ? Array.from(table.querySelectorAll('tbody tr:not(.new-entity-row):not(.group-header-row)')) : [];
  const rowIdx = dataRows.indexOf(td.parentElement);

  nameSpan.style.display = 'none';
  // リネーム中は「...」ボタン・リレーションリンクを非表示にして折り返しを防ぐ
  // （commit 時に renderPivot で再構築されるため復元不要）
  const moreBtn = td.querySelector('.entity-row-more-btn');
  const relDiv = td.querySelector('.relation-links');
  if (moreBtn) moreBtn.style.display = 'none';
  if (relDiv) relDiv.style.display = 'none';
  const inp = document.createElement('input');
  inp.className = 'entity-rename-input';
  inp.type = 'text';
  inp.value = oldName;
  inp.style.cssText = 'width:calc(100% - 24px);padding:2px 4px;margin-left:20px;background:var(--bg2);color:var(--fg);border:1px solid var(--accent);border-radius:3px;font-size:13px;';
  td.insertBefore(inp, nameSpan);
  inp.focus();
  inp.select();
  let committed = false;
  const commit = async () => {
    if (committed) return;
    committed = true;
    const newName = inp.value.trim();
    if (!newName || newName === oldName) {
      renderPivot();
      restoreActiveCellByRow(rowIdx, 0);
      return;
    }
    try {
      await apiPost('/entity/rename', { path: _entityPath(dbPath, oldName), new_name: newName });
      _dbUndoRename(dbPath, oldName, newName);
      await selectDatabase(dbPath);
      setTimeout(() => restoreActiveCellByEntityName(newName), 50);
    } catch(e) {
      renderPivot();
      restoreActiveCellByRow(rowIdx, 0);
    }
  };
  inp.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    if (e.key === 'Escape') { committed = true; renderPivot(); restoreActiveCellByRow(rowIdx, 0); }
    if (e.key === 'Tab') {
      e.preventDefault();
      // Tab: 確定して同じ行の次のセルへ
      committed = true;
      const newName = inp.value.trim();
      const doAfter = () => restoreActiveCellByRow(rowIdx, 1);
      if (!newName || newName === oldName) { renderPivot(); doAfter(); return; }
      apiPost('/entity/rename', { path: _entityPath(dbPath, oldName), new_name: newName }).then(() => {
        _dbUndoRename(dbPath, oldName, newName);
        selectDatabase(dbPath).then(() => setTimeout(doAfter, 50));
      }).catch(() => { renderPivot(); doAfter(); });
    }
  });
  inp.addEventListener('blur', commit);
}

// アクティブセル復元ヘルパー
function restoreActiveCellByProp(propName) {
  setTimeout(() => {
    const table = _currentPivotTable();
    if (!table) return;
    const dataRows = _currentPivotRows();
    // プロパティ名からcolIdxを特定
    const thAll = Array.from(table.querySelectorAll('thead th'));
    const colIdx = thAll.findIndex(th => th.dataset.prop === propName);
    if (colIdx >= 0 && dataRows.length > 0) {
      const cell = dataRows[0].children[colIdx];
      if (cell) setActiveCell(cell);
    }
  }, 30);
}

function restoreActiveCellByRow(rowIdx, colIdx, _attempt) {
  setTimeout(() => {
    const table = _currentPivotTable();
    if (!table) return;
    const dataRows = _currentPivotRows();
    // Step 2: チャンク分割中で目的の rowIdx がまだ生成されていない可能性。
    // 進行中なら最大 30 回 (約1.5秒) リトライ
    const ctx = (typeof _currentPaneState === 'function') ? _currentPaneState() : null;
    const attempt = _attempt || 0;
    if (rowIdx >= dataRows.length && ctx && ctx._renderInProgress && attempt < 30) {
      restoreActiveCellByRow(rowIdx, colIdx, attempt + 1);
      return;
    }
    const row = dataRows[Math.min(rowIdx, dataRows.length - 1)];
    if (row) {
      const cell = row.children[colIdx] || row.children[0];
      if (cell) setActiveCell(cell);
    }
  }, 30);
}

function restoreActiveCellByEntityName(entityName) {
  const table = _currentPivotTable();
  if (!table) return;
  const dataRows = _currentPivotRows();
  for (const row of dataRows) {
    const label = row.querySelector('.entity-name-label');
    if (label && label.textContent === entityName) {
      setActiveCell(row.children[0]);
      return;
    }
  }
  // Step 2: チャンク分割中で対象行が未生成の可能性。進行中ならポーリングで待機
  const ctx = (typeof _currentPaneState === 'function') ? _currentPaneState() : null;
  if (ctx && ctx._renderInProgress) {
    _waitForEntityRow(ctx, entityName, (tr) => setActiveCell(tr.children[0]));
    return;
  }
  // 見つからなければ先頭行
  if (dataRows.length > 0) setActiveCell(dataRows[0].children[0]);
}

// 空セルへの直接インライン入力
// セル位置を記憶し、値保存後に復元する共通処理
// D-6: セル位置を {entityName, propName} で保持 (rowIdx/colIdx ではない)
function _cellPos(td) {
  const tr = td.closest('tr');
  return {
    entityName: tr?.dataset?.entityName || '',
    propName: td.dataset?.propName || '',
  };
}

/**
 * Step 2: 指定したエントリ名の行が tbody に出現するまでポーリングしてから cb を呼ぶ。
 * チャンク分割レンダリング中は新規行が遅れて DOM に追加されるため、新規エントリ作成
 * 後の rename / focus 処理がレースしないようリトライする。
 * @param {object} ctx ペインコンテキスト
 * @param {string} entityName 待機対象のエントリ名
 * @param {(tr: HTMLElement) => void} cb 行が見つかったときに呼ぶコールバック
 */
function _waitForEntityRow(ctx, entityName, cb) {
  const tblId = (ctx && ctx.tableId) || 'pivot-table';
  let attempts = 0;
  const tick = () => {
    const root = _paneEl(ctx, '#' + tblId) || document;
    const tr = root.querySelector(`tbody tr[data-entity-name="${CSS.escape(entityName)}"]`);
    if (tr) { cb(tr); return; }
    // 進行中なら再試行 (最大 30 回 = 約1.5秒)
    if (attempts < 30 && ctx && ctx._renderInProgress) {
      attempts++;
      setTimeout(tick, 50);
    }
  };
  setTimeout(tick, 50);
}

function _restoreCellPos(pos, moveTo, _retryCount) {
  setTimeout(() => {
    const ctx = _currentPaneState();
    const tblId = (ctx && ctx.tableId) || 'pivot-table';
    const tbody = _paneEl(ctx, '#' + tblId + ' tbody');
    if (!tbody) return;

    let { entityName, propName } = pos;
    if (!entityName) return;

    // visibleProps と flatRows を再計算 (移動方向の解決に使う)
    const dbPath = (ctx && ctx.dbPath) || state.currentDbPath;
    const data = (ctx && ctx.pivotData) || state.pivotData;
    if (!data) return;
    const hiddenCols = getHiddenCols(dbPath) || [];
    const colOrder = getColOrder(dbPath);
    let props = colOrder ? [...colOrder] : [...data.properties];
    props = [...new Set(props)];
    (data.properties || []).forEach(p => { if (!props.includes(p)) props.push(p); });
    const propTypes = getPropertyTypes(dbPath);
    if (propTypes) Object.keys(propTypes).forEach(p => { if (!props.includes(p)) props.push(p); });
    const visibleProps = props.filter(p => !hiddenCols.includes(p));

    // flatRows = 現在 DOM に存在するエントリ行の entityName 列
    const flatRows = [...tbody.querySelectorAll('tr[data-entity-name]')].map(tr => tr.dataset.entityName);

    if (moveTo === 'right') {
      const i = visibleProps.indexOf(propName);
      if (i >= 0 && i + 1 < visibleProps.length) propName = visibleProps[i + 1];
    } else if (moveTo === 'left') {
      const i = visibleProps.indexOf(propName);
      if (i > 0) propName = visibleProps[i - 1];
    } else if (moveTo === 'down') {
      const i = flatRows.indexOf(entityName);
      if (i >= 0 && i + 1 < flatRows.length) entityName = flatRows[i + 1];
    } else if (moveTo === 'up') {
      const i = flatRows.indexOf(entityName);
      if (i > 0) entityName = flatRows[i - 1];
    }

    // tr を検索 (CSS.escape で特殊文字を安全に)
    const tr = tbody.querySelector(`tr[data-entity-name="${CSS.escape(entityName)}"]`);
    if (!tr) {
      // Step 2: チャンク分割中で対象行がまだ生成されていない可能性。
      // 進行中なら短い間隔でリトライ (上限 20回 = 1秒程度)。
      const retryCount = _retryCount || 0;
      if (ctx && ctx._renderInProgress && retryCount < 20) {
        _restoreCellPos(pos, moveTo, retryCount + 1);
      }
      return;
    }
    const td = (propName && tr.querySelector(`td[data-prop-name="${CSS.escape(propName)}"]`)) || tr.children[0];
    if (td) setActiveCell(td);
  }, 50);
}

// 型対応インラインセル入力
// D-7: ctx を最初に取得して state 参照を排除。Undo callback は closure 内 dbPath を使う
function startCellInlineAdd(td, entityPath, entityName, propName) {
  const ctx = _currentPaneState();
  const dbPath = (ctx && ctx.dbPath) || state.currentDbPath;
  // 列ロックチェック
  const lockMsg = checkColumnEditable(dbPath, propName);
  if (lockMsg) { showStatus(lockMsg); return; }
  if (td.querySelector('.cell-inline-input') || td.querySelector('.cell-inline-select') || td.querySelector('.cell-date-editor')) return;
  const container = td.querySelector('.cell-values');
  if (!container) return;
  // ステータス機能 OFF の DB は 1セル1値運用。既存値ありセルへの新規候補追加を禁止
  if (!getStatusEnabled(dbPath) && container.querySelector('.cell-value')) {
    showStatus('このシートは1セル1値運用です（ステータス機能オフ）');
    return;
  }
  const addBtn = container.querySelector('.cell-add-btn');
  if (addBtn) addBtn.style.display = 'none';

  const ptc = dbPath ? getPropertyTypes(dbPath)[propName] : null;
  const type = ptc?.type || 'text';

  const cancel = () => {
    container.querySelectorAll('.cell-inline-input,.cell-inline-select,.cell-inline-dd,.cell-date-toggle,.cell-date-editor').forEach(el => el.remove());
    if (addBtn) { addBtn.style.display = ''; delete addBtn.dataset.editingHidden; }
    setActiveCell(td);
  };

  const pos = _cellPos(td);
  const saveAndRestore = async (value, moveTo) => {
    if (!value && value !== 'false') { cancel(); return; }
    try {
      const result = await _apiPostValue(entityPath, propName, value, '案', '');
      const filePath = result?.path || '';
      let cascadeClears = [];
      const bidirectionalCtx = ((type === 'relation' || type === 'multi-relation') && ptc?.bidirectional)
        ? { entityPath, propName, ptc }
        : null;
      if (bidirectionalCtx && typeof _applyBidirectionalRelationSync === 'function') {
        try {
          await _applyBidirectionalRelationSync({
            sourceDbPath: dbPath,
            entityPath,
            propName,
            ptc,
            oldValue: '',
            newValue: value,
          });
        } catch (e) {
          showStatus('双方向リレーションの同期に失敗: ' + (e?.message || e), true);
        }
      }
      if ((type === 'relation' || type === 'multi-relation')
          && typeof _clearCascadeDependentValues === 'function') {
        cascadeClears = await _clearCascadeDependentValues(entityPath, propName, '', value);
      }
      if (filePath) {
        const candIdx = result?.candidate_index;
        const undoFn = (candIdx != null)
          ? async () => {
            await _apiPutValue({file: filePath, property: propName, candidate_index: candIdx}, { _delete: true });
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
              await _restoreCascadeDependentValues(entityPath, cascadeClears);
            }
            await selectDatabase(dbPath, undefined, { silent: true });
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
              await _restoreCascadeDependentValues(entityPath, cascadeClears);
            }
            await selectDatabase(dbPath, undefined, { silent: true });
          };
        historyPush('値追加: ' + propName + '=' + value,
          undoFn,
          async () => {
            await _apiPostValue(entityPath, propName, value, '案', '');
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
              await _redoCascadeDependentValues(entityPath, cascadeClears);
            }
            await selectDatabase(dbPath, undefined, { silent: true });
          },
          _dbScope()
        );
      }
      if ((type === 'relation' || type === 'multi-relation')
          && typeof _upsertLocalPivotValue === 'function'
          && typeof _finalizeRelationCellUpdate === 'function') {
        _upsertLocalPivotValue(entityPath, propName, null, value, {
          file: filePath,
          property: propName,
          candidate_index: result?.candidate_index,
          status: '案',
          note: '',
        });
        await _finalizeRelationCellUpdate(td, entityPath, propName, ptc, cascadeClears.map(c => c.propName));
        return;
      }
      // 楽観的増分更新: pivotData をローカルで更新してからセル DOM だけ書き換える
      // フォールバック条件 (group化中等) では従来通り全再描画
      if (state.pivotData?.entities) {
        const _entName = entityPath.replace(/\.md$/, '').split('/').pop();
        const _entData = state.pivotData.entities[_entName];
        if (_entData) {
          if (!Array.isArray(_entData[propName])) _entData[propName] = [];
          _entData[propName].push({
            property: propName,
            value: value,
            status: '案',
            note: '',
            file: filePath,
            candidate_index: result?.candidate_index,
          });
        }
      }
      const _refreshed = typeof _tryRefreshPivotCellLocal === 'function'
        && _tryRefreshPivotCellLocal(td, entityPath, propName);
      if (!_refreshed) {
        await selectDatabase(dbPath, undefined, { silent: true });
      }
      _restoreCellPos(pos, moveTo);
    } catch(e) { cancel(); }
  };

  // --- チェックボックス: クリック即座にtrue/false ---
  if (type === 'checkbox') {
    saveAndRestore('true', null);
    return;
  }

  // --- セレクト: ドロップダウン表示 ---
  if (type === 'select') {
    const dd = document.createElement('div');
    dd.className = 'cell-inline-dd status-dropdown';
    // 解除（入力キャンセル）
    const clearItem = document.createElement('div');
    clearItem.className = 'status-dropdown-item';
    clearItem.style.cssText = 'color:var(--fg2);font-style:italic;';
    clearItem.textContent = '解除';
    clearItem.addEventListener('click', () => { dd.remove(); cancel(); });
    dd.appendChild(clearItem);
    (ptc.options || []).forEach(opt => {
      const item = document.createElement('div');
      item.className = 'status-dropdown-item';
      item.textContent = opt;
      item.addEventListener('click', () => { dd.remove(); saveAndRestore(opt, null); });
      dd.appendChild(item);
    });
    // 「新しい選択肢を入力」
    const addItem = document.createElement('div');
    addItem.className = 'status-dropdown-item';
    addItem.style.color = 'var(--fg2)';
    addItem.innerHTML = lucide('plus', 12) + ' 新しい値を入力';
    addItem.addEventListener('click', () => {
      dd.remove();
      _createTextInput('select');
    });
    dd.appendChild(addItem);
    const rect = td.getBoundingClientRect();
    const _zi = _getZoom();
    dd.style.position = 'fixed';
    dd.style.left = (rect.left / _zi) + 'px';
    dd.style.top = (rect.bottom / _zi + 2) + 'px';
    dd.style.minWidth = (rect.width / _zi) + 'px';
    document.body.appendChild(dd);
    clampPopupToViewport(dd);
    _enableDropdownKeyNav(dd, '.status-dropdown-item');
    setTimeout(() => {
      const closer = (e) => { if (!dd.contains(e.target)) { dd.remove(); cancel(); document.removeEventListener('pointerdown', closer); } };
      document.addEventListener('pointerdown', closer);
    }, 0);
    return;
  }

  // --- マルチセレクト: テキスト入力（カンマ区切り） ---
  if (type === 'multi-select') {
    _createTextInput('multi-select');
    return;
  }

  // --- ユーザー: ドロップダウンでユーザー選択 ---
  if (type === 'user' || type === 'multi-user') {
    _showUserDropdown(td, null, entityPath, propName, '', type === 'multi-user', {
      onCancel: cancel,
      status: '案',
    });
    return;
  }

  // --- リレーション: ドロップダウンで参照先DBエントリ選択 ---
  if (type === 'relation' || type === 'multi-relation') {
    const isMulti = type === 'multi-relation';
    (async () => {
      // 自己参照対応: relationDbが空文字の場合は現在のDBを参照
      const isSelfRef = (ptc.relationDb === '' && ptc.relationDb !== undefined);
      const relDb = isSelfRef ? dbPath : (ptc.relationDb || '');
      if (!relDb) { showStatus('参照先シートが未設定です。プロパティ型設定で指定してください。', true); cancel(); return; }
      // entry = { name, id }
      let entryList = [];
      let refEntities = {};
      try {
        const data = await apiFetch('/pivot?path=' + encodeURIComponent(relDb));
        if (typeof _setRelationMapCache === 'function') _setRelationMapCache(relDb, data);
        refEntities = data.entities || {};
        entryList = Object.entries(refEntities).map(([name, props]) => ({ name, id: props._id || name }));
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
      if (entryList.length === 0) {
        showStatus('参照先シートにエントリがありません: ' + relDb, true); cancel(); return;
      }
      const dd = document.createElement('div');
      dd.className = 'cell-inline-dd status-dropdown';
      dd.style.cssText = 'max-height:250px;overflow-y:auto;min-width:180px;';
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
      const renderList = (filter) => {
        listDiv.innerHTML = '';
        const filtered = filter ? entryList.filter(e => e.name.toLowerCase().includes(filter.toLowerCase())) : entryList;
        filtered.forEach(entry => {
          const item = document.createElement('div');
          item.className = 'dd-nav-item';
          item.style.cssText = 'padding:3px 8px;cursor:pointer;font-size:12px;';
          item.textContent = entry.name;
          if (selected.includes(entry.id)) item.style.color = 'var(--accent)';
          item.onmouseenter = () => { item.style.background = 'var(--bg4)'; };
          item.onmouseleave = () => { item.style.background = ''; };
          item.addEventListener('click', () => {
            if (isMulti) {
              const si = selected.indexOf(entry.id);
              if (si >= 0) { selected.splice(si, 1); item.style.color = ''; }
              else { selected.push(entry.id); item.style.color = 'var(--accent)'; }
            } else {
              closeDropdown();
              saveAndRestore(entry.id, null);
            }
          });
          listDiv.appendChild(item);
        });
        if (filtered.length === 0) {
          const empty = document.createElement('div');
          empty.style.cssText = 'padding:6px 8px;color:var(--fg2);font-size:12px;font-style:italic;';
          empty.textContent = '該当なし';
          listDiv.appendChild(empty);
        }
      };
      renderList('');
      search.oninput = () => renderList(search.value);
      dd.appendChild(listDiv);
      if (isMulti) {
        const doneBtn = document.createElement('div');
        doneBtn.style.cssText = 'padding:3px 8px;text-align:center;cursor:pointer;font-size:12px;font-weight:bold;color:var(--accent);border-top:1px solid var(--border);';
        doneBtn.innerHTML = lucide('check', 12) + ' 確定';
        doneBtn.addEventListener('click', () => {
          closeDropdown();
          if (selected.length) saveAndRestore(selected.join(', '), null);
          else cancel();
        });
        dd.appendChild(doneBtn);
      }
      const rect = td.getBoundingClientRect();
      const _zr = _getZoom();
      dd.style.position = 'fixed'; dd.style.left = (rect.left / _zr) + 'px'; dd.style.top = (rect.bottom / _zr + 2) + 'px';
      document.body.appendChild(dd);
      clampPopupToViewport(dd);
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
    if (!editor.mode?.withTime && !editor.mode?.range && editor.startInput) {
      editor.startInput.addEventListener('change', commit);
    }
    editor.root.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); commit(); }
      if (e.key === 'Escape') { e.preventDefault(); committed = true; restoreAddBtn(); cancel(); }
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
    const isPlainText = !forType || forType === 'text';
    const inp = document.createElement(isPlainText ? 'textarea' : 'input');
    inp.className = isPlainText ? 'cell-inline-input cell-inline-input--textarea' : 'cell-inline-input';
    if (!isPlainText) inp.type = 'text';
    if (isPlainText) inp.rows = 1;
    inp.placeholder = forType === 'url' ? 'https://...' : forType === 'multi-select' ? '値1, 値2, ...' : '値を入力';
    inp.style.cssText = 'width:100%;padding:3px 6px;background:var(--bg2);color:var(--fg);border:1px solid var(--accent);border-radius:3px;font-size:12px;box-sizing:border-box;';
    container.insertBefore(inp, addBtn);
    if (isPlainText) _autosizeInlineTextarea(inp);
    inp.focus();
    _attachCommitHandlers(inp, saveAndRestore, cancel);
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
      const allowNewline = inp.tagName === 'TEXTAREA' && e.key === 'Enter' && e.shiftKey && !e.ctrlKey && !e.metaKey;
      if (e.key === 'Enter' && !allowNewline) { e.preventDefault(); commit('down'); }
      else if (e.key === 'Tab') { e.preventDefault(); commit(e.shiftKey ? 'left' : 'right'); }
      else if (e.key === 'Escape') { e.preventDefault(); committed = true; cancelFn(); }
    });
    inp.addEventListener('blur', () => commit(null));
  }
}

// 列をインラインで挿入（ダイアログなし）
function insertPropertyInline(refProp, direction) {
  const dbPath = state.currentDbPath;
  if (!dbPath) return;
  const order = getColOrder(dbPath) || [...(state.pivotData?.properties || [])];
  let idx = 1, name = 'プロパティ';
  while (order.includes(name)) { idx++; name = 'プロパティ' + idx; }
  const refIdx = order.indexOf(refProp);
  if (refIdx >= 0) {
    const insertIdx = direction === 'left' ? refIdx : refIdx + 1;
    order.splice(insertIdx, 0, name);
  } else {
    order.push(name);
  }
  setColOrder(dbPath, order, { skipHistory: true });
  setPropertyType(dbPath, name, { type: 'text' });
  renderPivot();
  // 挿入後にヘッダーをインラインリネームモードに
  setTimeout(() => {
    const _ctx = _currentPaneState();
    const th = _paneEl(_ctx, '#' + (_ctx.tableId || 'pivot-table') + ` thead th[data-prop="${name}"]`);
    if (th) startHeaderInlineRename(th, name, dbPath);
  }, 30);
}

// エントリのメインステータスを判定（最も優先度の高いステータス）
function getEntityMainStatus(entityData) {
  const order = ['掲載済み', '採用', '案', 'ボツ'];
  let best = 'ボツ';
  for (const propVals of Object.values(entityData)) {
    if (!Array.isArray(propVals)) continue;
    for (const v of propVals) {
      const idx = order.indexOf(v.status);
      if (idx >= 0 && idx < order.indexOf(best)) best = v.status;
    }
  }
  return best;
}

// 複数条件フィルタ適用
function applyAdvancedFilters(values, propName, filters) {
  const propFilters = filters.filter(f => f.property === propName || f.property === '*');
  if (propFilters.length === 0) return values;
  return values.filter(v => {
    return propFilters.every(f => {
      const target = f.field === 'status' ? v.status : v.value;
      switch (f.operator) {
        case 'equals': return target === f.value;
        case 'not_equals': return target !== f.value;
        case 'contains': return target && target.includes(f.value);
        case 'not_contains': return !target || !target.includes(f.value);
        case 'empty': return !target || target.trim() === '';
        case 'not_empty': return target && target.trim() !== '';
        default: return true;
      }
    });
  });
}

// フッター集計行
function renderPivotFooter(visibleProps, entitiesMap, entityNames, pinnedCols, savedWidths, propTypes, ctx) {
  ctx = ctx || _currentPaneState();
  const _ftblId = ctx.tableId || 'pivot-table';
  const tfoot = _paneEl(ctx, '#' + _ftblId + ' tfoot');
  if (!tfoot) return;
  tfoot.innerHTML = '';
  const dbPath = ctx.dbPath || state.currentDbPath;
  const countTypes = getCountTypes(dbPath);

  // フッター表示トグル（localStorageで管理）
  const showFooter = typeof getShowFooter === 'function' ? getShowFooter(dbPath) : (getDbViewConfig(dbPath).showFooter || false);
  if (!showFooter) return;

  const tr = document.createElement('tr');
  tr.setAttribute('role', 'row');
  const tdLabel = document.createElement('td');
  tdLabel.className = 'col-entity';
  tdLabel.setAttribute('role', 'rowheader');
  tdLabel.setAttribute('aria-label', '集計');
  tdLabel.textContent = '集計';
  tdLabel.style.fontStyle = 'italic';
  const _footerEntW = (savedWidths && savedWidths['__entity__']) || 120;
  tdLabel.style.width = _footerEntW + 'px';
  tdLabel.style.minWidth = _footerEntW + 'px';
  tr.appendChild(tdLabel);

  let pLeftOffset = _footerEntW;
  visibleProps.forEach(propName => {
    const td = document.createElement('td');
    td.setAttribute('role', 'cell');
    td.setAttribute('aria-label', `集計 / ${propName}`);
    if (pinnedCols.includes(propName)) {
      td.classList.add('col-pinned');
      td.style.left = pLeftOffset + 'px';
      pLeftOffset += (savedWidths[propName] || 100);
    }

    const countType = countTypes[propName] || 'none';
    const fPtc = propTypes?.[propName];
    // 拡張集計エンジン使用（gb-db-aggregate.js）
    const resolvedType = fPtc?.type || (typeof inferPropertyType === 'function' ? inferPropertyType(propName, entitiesMap, entityNames) : 'text');
    const result = typeof calcAggregation === 'function'
      ? calcAggregation(propName, entitiesMap, entityNames, countType, fPtc)
      : calcColumnCount(propName, entitiesMap, entityNames, countType, fPtc);

    const wrapper = document.createElement('div');
    wrapper.style.cssText = 'display:flex;align-items:center;gap:4px;';
    const sel = document.createElement('select');
    sel.className = 'count-type-select';
    // 型に応じた集計タイプ一覧を取得
    const aggTypes = typeof getAggregationTypesForProperty === 'function'
      ? getAggregationTypesForProperty(resolvedType)
      : [{key:'none',label:'-'},{key:'count',label:'件数'},{key:'unique',label:'ユニーク'},{key:'empty',label:'空'},{key:'not_empty',label:'非空'}];
    aggTypes.forEach(opt => {
      const o = document.createElement('option');
