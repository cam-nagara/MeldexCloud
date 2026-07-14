/* インライン編集・キーボードナビゲーション — gb-database.js から分離 */

function _dbInlineIsComposing(e) {
  return !!(e && (e.isComposing || e.keyCode === 229));
}

function startHeaderInlineRename(th, oldName, dbPath) {
  if (th.querySelector('.th-rename-input')) return;
  const ctx = typeof _dbPaneContextFromEvent === 'function'
    ? _dbPaneContextFromEvent(th, { dbPath })
    : (typeof _currentPaneState === 'function' ? _currentPaneState() : null);
  const targetDbPath = (ctx && ctx.dbPath) || dbPath || state.currentDbPath;
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
      renderPivot(ctx);
      restoreActiveCellByProp(oldName);
      return;
    }
    const pivotData = (ctx && ctx.pivotData) || state.pivotData;
    const liveProps = typeof filterDeletedDbProperties === 'function'
      ? filterDeletedDbProperties(targetDbPath, pivotData?.properties || [])
      : (pivotData?.properties || []);
    const existingProps = [
      ...liveProps,
      ...(getColOrder(targetDbPath, { ctx }) || []),
      ...Object.keys(getPropertyTypes(targetDbPath) || {}),
    ];
    if (existingProps.some(name => name === newName && name !== oldName)) {
      showStatus('同名のプロパティが既にあります: ' + newName, true);
      renderPivot(ctx);
      restoreActiveCellByProp(oldName);
      return;
    }
    try {
      if (typeof renameDbProperty === 'function') {
        await renameDbProperty(targetDbPath, oldName, newName);
      }
    } catch (err) {
      showStatus('プロパティ名の変更に失敗: ' + (err?.message || err), true);
      renderPivot(ctx);
      restoreActiveCellByProp(oldName);
      return;
    }
    const selected = _getSelectedColumns(targetDbPath).map(name => name === oldName ? newName : name);
    _setSelectedColumns(targetDbPath, selected, newName);
    renderPivot(ctx);
    restoreActiveCellByProp(newName);
  };
  inp.addEventListener('keydown', (e) => {
    if (_dbInlineIsComposing(e)) return;
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    if (e.key === 'Escape') { committed = true; renderPivot(ctx); restoreActiveCellByProp(oldName); }
    if (e.key === 'Tab') { e.preventDefault(); commit(); }
  });
  inp.addEventListener('blur', commit);
}

function _dbResolveEntityRenameContext(anchorEl, dbPath) {
  if (typeof _dbPaneContextFromEvent === 'function') {
    const ctx = _dbPaneContextFromEvent(anchorEl, { dbPath });
    if (ctx) return ctx;
  }
  return typeof _currentPaneState === 'function' ? _currentPaneState() : null;
}

function _dbApplyEntityRenameLocally(ctx, dbPath, oldName, newName) {
  if (!oldName || !newName || oldName === newName) return false;
  const targets = [];
  const addTarget = (target) => {
    if (target && !targets.includes(target)) targets.push(target);
  };
  addTarget(ctx);
  if (typeof state !== 'undefined' && state.currentDbPath === dbPath) addTarget(state);
  let changed = false;
  targets.forEach(target => {
    const entities = target?.pivotData?.entities;
    if (entities && Object.prototype.hasOwnProperty.call(entities, oldName)) {
      entities[newName] = entities[oldName] || {};
      delete entities[oldName];
      changed = true;
    }
    if (Array.isArray(target?._lastEntityNames)) {
      target._lastEntityNames = target._lastEntityNames.map(name => name === oldName ? newName : name);
    }
  });
  return changed;
}

function _dbRefreshEntityRenameInBackground(ctx, dbPath, entityName) {
  if (!dbPath || typeof selectDatabase !== 'function') return;
  setTimeout(() => {
    if (typeof _dbEntityCreateIsEditing === 'function' && _dbEntityCreateIsEditing(ctx)) return;
    Promise.resolve(selectDatabase(dbPath, ctx, {
      silent: true,
      skipRecent: true,
      skipNavPush: true,
      skipSaveLastView: true,
      skipAutoVersion: true,
    })).then(() => {
      if (typeof _dbEntityCreateIsEditing === 'function' && _dbEntityCreateIsEditing(ctx)) return;
      setTimeout(() => {
        if (typeof _dbEntityCreateIsEditing === 'function' && _dbEntityCreateIsEditing(ctx)) return;
        restoreActiveCellByEntityName(entityName);
      }, 50);
    }).catch(() => {});
  }, 0);
}

function _dbCommitEntityRenameLocalFirst(ctx, td, nameSpan, oldName, newName, dbPath) {
  const changed = _dbApplyEntityRenameLocally(ctx, dbPath, oldName, newName);
  if (changed && typeof renderPivot === 'function') {
    renderPivot(ctx);
    setTimeout(() => restoreActiveCellByEntityName(newName), 50);
    return true;
  }
  const tr = td?.closest?.('tr');
  if (tr) tr.dataset.entityName = newName;
  if (nameSpan) {
    nameSpan.textContent = newName;
    nameSpan.style.display = '';
  }
  td?.querySelector?.('.entity-rename-input')?.remove?.();
  setTimeout(() => restoreActiveCellByEntityName(newName), 50);
  return false;
}

function startEntityInlineRename(td, nameSpan, oldName, dbPath) {
  if (td.querySelector('.entity-rename-input')) return;
  // 行インデックスを記憶
  const _renCtx = _dbResolveEntityRenameContext(td, dbPath);
  const _renTblId = (_renCtx && _renCtx.tableId) || 'pivot-table';
  const table = _paneEl(_renCtx, '#' + _renTblId) || document.getElementById('pivot-table');
  const dataRows = table ? Array.from(table.querySelectorAll('tbody tr:not(.new-entity-row):not(.new-entity-spacer-row):not(.db-virtual-spacer-row):not(.group-header-row)')) : [];
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
  const renameToken = typeof _dbE2eToken === 'function'
    ? _dbE2eToken(oldName)
    : String(oldName || 'entry').replace(/\s+/g, '-').replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '') || 'entry';
  inp.dataset.e2eId = `db-entity-rename-${renameToken}`;
  inp.setAttribute('aria-label', `エントリ名を変更: ${oldName || '無題'}`);
  inp.style.cssText = 'width:calc(100% - 24px);padding:2px 4px;margin-left:20px;background:var(--bg2);color:var(--fg);border:1px solid var(--accent);border-radius:3px;font-size:13px;';
  const inputHost = nameSpan.parentElement || td;
  inputHost.insertBefore(inp, nameSpan.parentElement ? nameSpan : td.firstChild);
  inp.focus();
  inp.select();
  let committed = false;
  const commit = async () => {
    if (committed) return;
    committed = true;
    const newName = inp.value.trim();
    if (!newName || newName === oldName) {
      renderPivot(_renCtx);
      restoreActiveCellByRow(rowIdx, 0);
      return;
    }
    try {
      const renamePath = typeof _dbResolveEntityPathForRename === 'function'
        ? await _dbResolveEntityPathForRename(dbPath, oldName)
        : _entityPath(dbPath, oldName);
      await apiPost('/entity/rename', { path: renamePath, new_name: newName });
      _dbUndoRename(dbPath, oldName, newName, _renCtx);
      _dbCommitEntityRenameLocalFirst(_renCtx, td, nameSpan, oldName, newName, dbPath);
      _dbRefreshEntityRenameInBackground(_renCtx, dbPath, newName);
    } catch(e) {
      renderPivot(_renCtx);
      restoreActiveCellByRow(rowIdx, 0);
    }
  };
  inp.addEventListener('keydown', (e) => {
    if (_dbInlineIsComposing(e)) return;
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    if (e.key === 'Escape') { committed = true; renderPivot(_renCtx); restoreActiveCellByRow(rowIdx, 0); }
    if (e.key === 'Tab') {
      e.preventDefault();
      // Tab: 確定して同じ行の次のセルへ
      committed = true;
      const newName = inp.value.trim();
      const doAfter = () => restoreActiveCellByRow(rowIdx, 1);
      if (!newName || newName === oldName) { renderPivot(_renCtx); doAfter(); return; }
      const renamePathPromise = typeof _dbResolveEntityPathForRename === 'function'
        ? _dbResolveEntityPathForRename(dbPath, oldName)
        : Promise.resolve(_entityPath(dbPath, oldName));
      renamePathPromise.then(renamePath => apiPost('/entity/rename', { path: renamePath, new_name: newName })).then(() => {
        _dbUndoRename(dbPath, oldName, newName, _renCtx);
        _dbCommitEntityRenameLocalFirst(_renCtx, td, nameSpan, oldName, newName, dbPath);
        _dbRefreshEntityRenameInBackground(_renCtx, dbPath, newName);
        setTimeout(doAfter, 50);
      }).catch(() => { renderPivot(_renCtx); doAfter(); });
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
    __sourceCell: td,
    __sourceSeq: Number(td?.dataset?.dbActiveSeq || dbActiveCellSeq || 0),
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
    // 描画フラグが落ちていても、直後の再描画・分割描画で行が後から出ることがある。
    if (attempts < 30) {
      attempts++;
      setTimeout(tick, 50);
    }
  };
  setTimeout(tick, 50);
}

function _restoreCellPos(pos, moveTo, _retryCount) {
  const restoreSeq = Number(pos?.__restoreSeq ?? dbActiveCellSeq ?? 0);
  if (pos && pos.__restoreSeq == null) pos.__restoreSeq = restoreSeq;
  setTimeout(() => {
    const currentActive = typeof _dbCurrentVisualActiveCell === 'function'
      ? _dbCurrentVisualActiveCell()
      : activeCell;
    const currentSeq = Number(currentActive?.dataset?.dbActiveSeq || 0);
    if (currentSeq > restoreSeq) return;
    const sourceCell = pos?.__sourceCell;
    const sourceSeq = Number(pos?.__sourceSeq || 0);
    if (currentActive?.isConnected && sourceCell?.isConnected && currentActive !== sourceCell && currentSeq >= sourceSeq) return;
    if (!currentActive?.isConnected && sourceCell?.isConnected && sourceSeq > 0 && !sourceCell.classList.contains('active-cell')) return;
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
    const hiddenCols = getHiddenCols(dbPath, { ctx }) || [];
    const colOrder = getColOrder(dbPath, { ctx });
    let props = colOrder ? [...colOrder] : [...data.properties];
    props = [...new Set(props)];
    (data.properties || []).forEach(p => { if (!props.includes(p)) props.push(p); });
    const propTypes = getPropertyTypes(dbPath);
    if (propTypes) Object.keys(propTypes).forEach(p => { if (!props.includes(p)) props.push(p); });
    if (typeof filterDeletedDbProperties === 'function') props = filterDeletedDbProperties(dbPath, props);
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
