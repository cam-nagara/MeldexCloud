(function () {
  'use strict';

  function plainValue(values) {
    const items = Array.isArray(values) ? values : values == null ? [] : [values];
    const adopted = items.find(value => value && typeof value === 'object' && ['採用', '掲載済み'].includes(value.status));
    const value = adopted ?? items[0] ?? '';
    return String(value && typeof value === 'object' ? value.value ?? '' : value);
  }

  function resolve(propertyType, entityData) {
    const source = propertyType?.optionSource;
    if (!source || source.kind !== 'row-page-range') return null;
    const api = window.MeldexProductionPageStructure;
    if (!api) return null;
    const count = plainValue(entityData?.[source.countProperty || 'ページ数']) || source.fallbackCount || api.FALLBACK_COUNT;
    const startSide = plainValue(entityData?.[source.sideProperty || '開始ページの位置']) || source.defaultSide || api.LEFT;
    const options = source.mode === 'spread'
      ? api.spreadOptions(count, startSide)
      : api.pageOptions(count);
    return { options, count: Number(count), startSide };
  }

  window.MeldexDbDynamicOptions = { plainValue, resolve };
})();
/* インライン編集・キーボードナビゲーション — gb-database.js から分離 */

function _dbInlineIsComposing(e) {
  return !!(e && (e.isComposing || e.keyCode === 229));
}

function _dbInlineConsumeImeBoundaryKey(e) {
  if (!e) return false;
  const justEnded = e.target?.dataset?.dbImeJustEnded === '1'
    || e.currentTarget?.dataset?.dbImeJustEnded === '1';
  if (!justEnded) return false;
  if (['Enter', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' ', 'Spacebar', 'Escape'].includes(e.key)) {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation?.();
  }
  return true;
}

// フォーカスが外れたときの確定を、入力欄内の操作で誤発火させないための共通処理。
// blur に直結して確定すると、入力中の文字と文字の間をクリックしただけ（キャレット移動だけのつもり）や、
// 日本語変換の確定操作で入力が閉じてしまう。gb-db-cell-ui.js の scheduleBlurFinish と同じ方針を、
// シート内の各インライン入力（セル・列見出し・ビュー名など）へ共通化したもの。
// keepFocusWithin: フォーカスが移っても確定させたくない周辺UI（書式ポップアップ等）のセレクタ。
function attachInlineBlurCommit(inp, commit, options = {}) {
  if (!inp || typeof commit !== 'function') return;
  let composing = false;
  let pendingBlur = false;
  let finished = false;
  const keepSelector = options.keepFocusWithin || '';
  const commitAfterFocusCheck = () => {
    setTimeout(() => {
      if (finished || composing) return;
      const active = document.activeElement;
      if (active === inp || inp.contains(active)) return;
      if (keepSelector && active?.closest?.(keepSelector)) return;
      finished = true;
      commit();
    }, 0);
  };
  inp.addEventListener('compositionstart', () => { composing = true; });
  inp.addEventListener('compositionend', () => {
    composing = false;
    inp.dataset.dbImeJustEnded = '1';
    setTimeout(() => { delete inp.dataset.dbImeJustEnded; }, 0);
    if (!pendingBlur) return;
    pendingBlur = false;
    commitAfterFocusCheck();
  });
  inp.addEventListener('blur', () => {
    if (composing) {
      pendingBlur = true;
      return;
    }
    commitAfterFocusCheck();
  });
}

// ctxOverride: 呼び出し側が既に持っているペインctxを直接渡すためのオプション引数。
// 埋め込みシート（gb-tool-calendar-production-sheet-embed.js）はグローバル _panes
// レジストリに未登録のため、_dbPaneContextFromEvent()（DOM祖先探索 + レジストリ参照）は
// 常に解決に失敗し、メイン画面側の別ペイン（またはnull）へ誤って解決され得る
// （showColHeaderMenu() と同根。2026-07-15 フェーズD1で確認）。
function startHeaderInlineRename(th, oldName, dbPath, ctxOverride) {
  if (th.querySelector('.th-rename-input')) return;
  const ctx = ctxOverride || (typeof _dbPaneContextFromEvent === 'function'
    ? _dbPaneContextFromEvent(th, { dbPath })
    : (typeof _currentPaneState === 'function' ? _currentPaneState() : null));
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
      restoreActiveCellByProp(oldName, ctx);
      return;
    }
    const pivotData = (ctx && ctx.pivotData) || state.pivotData;
    const liveProps = typeof filterDeletedDbProperties === 'function'
      ? filterDeletedDbProperties(targetDbPath, pivotData?.properties || [])
      : (pivotData?.properties || []);
    const existingProps = [
      ...liveProps,
      ...(getColOrder(targetDbPath, { ctx }) || []),
      ...Object.keys(getPropertyTypes(targetDbPath, ctx) || {}),
    ];
    if (existingProps.some(name => name === newName && name !== oldName)) {
      showStatus('同名の列が既にあります: ' + newName, true);
      renderPivot(ctx);
      restoreActiveCellByProp(oldName, ctx);
      return;
    }
    try {
      if (typeof renameDbProperty === 'function') {
        await renameDbProperty(targetDbPath, oldName, newName, ctx);
      }
    } catch (err) {
      showStatus(
        err?.resultUnknown
          ? '列名変更の保存結果を確認できません。再読み込み後の表示を確認してください。'
          : '列名の変更に失敗: ' + (err?.message || err),
        true
      );
      renderPivot(ctx);
      const currentProps = (ctx?.pivotData || state.pivotData)?.properties || [];
      restoreActiveCellByProp(currentProps.includes(newName) ? newName : oldName, ctx);
      return;
    }
    const selected = _getSelectedColumns(targetDbPath).map(name => name === oldName ? newName : name);
    _setSelectedColumns(targetDbPath, selected, newName);
    renderPivot(ctx);
    restoreActiveCellByProp(newName, ctx);
  };
  inp.addEventListener('keydown', (e) => {
    if (_dbInlineIsComposing(e)) return;
    if (_dbInlineConsumeImeBoundaryKey(e)) return;
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    if (e.key === 'Escape') { committed = true; renderPivot(ctx); restoreActiveCellByProp(oldName, ctx); }
    if (e.key === 'Tab') { e.preventDefault(); commit(); }
  });
  attachInlineBlurCommit(inp, commit);
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
  if (!dbPath) return;
  setTimeout(() => {
    if (typeof _dbEntityCreateIsEditing === 'function' && _dbEntityCreateIsEditing(ctx)) return;
    const reload = window.GbDbEntryIdentity
      ? window.GbDbEntryIdentity.reload(ctx, dbPath)
      : selectDatabase(dbPath, ctx, {
          silent: true,
          skipRecent: true,
          skipNavPush: true,
          skipSaveLastView: true,
          skipAutoVersion: true,
        });
    Promise.resolve(reload).then(() => {
      if (typeof _dbEntityCreateIsEditing === 'function' && _dbEntityCreateIsEditing(ctx)) return;
      setTimeout(() => {
        if (typeof _dbEntityCreateIsEditing === 'function' && _dbEntityCreateIsEditing(ctx)) return;
        restoreActiveCellByEntityName(entityName, ctx);
      }, 50);
    }).catch(() => {});
  }, 0);
}

function _dbCommitEntityRenameLocalFirst(ctx, td, nameSpan, oldName, newName, dbPath) {
  // 楽観再描画より前に manualOrder も同じ名前へ付け替える。
  // 画面だけ先に新名へ変わって manualOrder が旧名のままだと、保存完了まで一度末尾へ落ちる。
  // 保存失敗時は呼び出し側が newName → oldName で本関数を再実行するため、順序も同時に戻る。
  if (typeof _dbRenameLocalRefs === 'function') {
    _dbRenameLocalRefs(dbPath, oldName, newName);
  }
  const changed = _dbApplyEntityRenameLocally(ctx, dbPath, oldName, newName);
  if (changed && typeof renderPivot === 'function') {
    renderPivot(ctx);
    setTimeout(() => restoreActiveCellByEntityName(newName, ctx), 50);
    return true;
  }
  const tr = td?.closest?.('tr');
  if (tr) tr.dataset.entityName = newName;
  if (nameSpan) {
    nameSpan.textContent = newName;
    nameSpan.style.display = '';
  }
  td?.querySelector?.('.entity-rename-input')?.remove?.();
  setTimeout(() => restoreActiveCellByEntityName(newName, ctx), 50);
  return false;
}

function startEntityInlineRename(td, nameSpan, oldName, dbPath) {
  if (td.querySelector('.entity-rename-input')) return;
  // 行インデックスを記憶
  const _renCtx = _dbResolveEntityRenameContext(td, dbPath);
  const _renTblId = (_renCtx && _renCtx.tableId) || 'pivot-table';
  const table = _paneEl(_renCtx, '#' + _renTblId)
    || (!_renCtx ? document.getElementById('pivot-table') : null);
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
      restoreActiveCellByRow(rowIdx, 'entity', 0, _renCtx);
      return;
    }
    // 同名エントリが既にあれば、楽観適用で既存エントリを上書きしないようここで弾く
    // （サーバも 409 で拒否するが、待たずに即フィードバックする）。
    const _renEntities = (_renCtx && _renCtx.pivotData && _renCtx.pivotData.entities)
      || (typeof state !== 'undefined' && state.pivotData ? state.pivotData.entities : null) || {};
    if (Object.prototype.hasOwnProperty.call(_renEntities, newName)) {
      if (typeof showStatus === 'function') showStatus('同じ名前のエントリが既にあります: ' + newName, true);
      renderPivot(_renCtx);
      restoreActiveCellByRow(rowIdx, 'entity', 0, _renCtx);
      return;
    }
    const stableEntryId = _renEntities?.[oldName]?._id || _renEntities?.[oldName]?.entry_id || '';
    // 楽観的更新: サーバ保存を待たず、その場で新名を表示する（列名変更と同じ即時反映）。
    // 保存に失敗したら catch で旧名へ戻す。
    _dbCommitEntityRenameLocalFirst(_renCtx, td, nameSpan, oldName, newName, dbPath);
    try {
      const renamePath = typeof _dbResolveEntityPathForRename === 'function'
        ? await _dbResolveEntityPathForRename(dbPath, oldName)
        : _entityPath(dbPath, oldName);
      await window.GbDbEntryIdentity.rename({
        dbPath, oldName, newName, path: renamePath, ctx: _renCtx,
        entryId: stableEntryId,
      });
      _dbUndoRename(dbPath, oldName, newName, _renCtx);
      _dbRefreshEntityRenameInBackground(_renCtx, dbPath, newName);
    } catch(e) {
      // 通信結果不明では、サーバー側だけ成功した変更を画面から消さない。
      if (!e?.resultUnknown) _dbCommitEntityRenameLocalFirst(_renCtx, td, nameSpan, newName, oldName, dbPath);
      if (typeof showStatus === 'function') {
        showStatus(e?.resultUnknown ? '保存結果を確認できません。再読み込みで確認します' : '名前の変更に失敗しました', true);
      }
      if (e?.resultUnknown) _dbRefreshEntityRenameInBackground(_renCtx, dbPath, newName);
      restoreActiveCellByRow(rowIdx, 'entity', 0, _renCtx);
    }
  };
  inp.addEventListener('keydown', (e) => {
    if (_dbInlineIsComposing(e)) return;
    if (_dbInlineConsumeImeBoundaryKey(e)) return;
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    if (e.key === 'Escape') { committed = true; renderPivot(_renCtx); restoreActiveCellByRow(rowIdx, 'entity', 0, _renCtx); }
    if (e.key === 'Tab') {
      e.preventDefault();
      // Tab: 確定して同じ行の次のセルへ（エントリ名列の位置に関わらず「最初のプロパティ列」へ）
      committed = true;
      const newName = inp.value.trim();
      const doAfter = () => restoreActiveCellByRow(rowIdx, 'first-prop', 0, _renCtx);
      if (!newName || newName === oldName) { renderPivot(_renCtx); doAfter(); return; }
      const _renEntitiesTab = (_renCtx && _renCtx.pivotData && _renCtx.pivotData.entities)
        || (typeof state !== 'undefined' && state.pivotData ? state.pivotData.entities : null) || {};
      if (Object.prototype.hasOwnProperty.call(_renEntitiesTab, newName)) {
        if (typeof showStatus === 'function') showStatus('同じ名前のエントリが既にあります: ' + newName, true);
        renderPivot(_renCtx); doAfter(); return;
      }
      const stableEntryId = _renEntitiesTab?.[oldName]?._id || _renEntitiesTab?.[oldName]?.entry_id || '';
      // 楽観的更新: 先に新名を表示してからサーバ保存
      _dbCommitEntityRenameLocalFirst(_renCtx, td, nameSpan, oldName, newName, dbPath);
      const renamePathPromise = typeof _dbResolveEntityPathForRename === 'function'
        ? _dbResolveEntityPathForRename(dbPath, oldName)
        : Promise.resolve(_entityPath(dbPath, oldName));
      renamePathPromise.then(renamePath => window.GbDbEntryIdentity.rename({
        dbPath, oldName, newName, path: renamePath, ctx: _renCtx,
        entryId: stableEntryId,
      })).then(() => {
        _dbUndoRename(dbPath, oldName, newName, _renCtx);
        _dbRefreshEntityRenameInBackground(_renCtx, dbPath, newName);
        setTimeout(doAfter, 50);
      }).catch((error) => {
        if (!error?.resultUnknown) _dbCommitEntityRenameLocalFirst(_renCtx, td, nameSpan, newName, oldName, dbPath);
        if (typeof showStatus === 'function') {
          showStatus(error?.resultUnknown ? '保存結果を確認できません。再読み込みで確認します' : '名前の変更に失敗しました', true);
        }
        if (error?.resultUnknown) _dbRefreshEntityRenameInBackground(_renCtx, dbPath, newName);
        doAfter();
      });
    }
  });
  attachInlineBlurCommit(inp, commit);
}

// アクティブセル復元ヘルパー
function restoreActiveCellByProp(propName, ctxOverride) {
  setTimeout(() => {
    const table = _currentPivotTable(ctxOverride);
    if (!table) return;
    const dataRows = _currentPivotRows(ctxOverride);
    // プロパティ名からcolIdxを特定
    const thAll = Array.from(table.querySelectorAll('thead th'));
    const colIdx = thAll.findIndex(th => th.dataset.prop === propName);
    if (colIdx >= 0 && dataRows.length > 0) {
      const cell = dataRows[0].children[colIdx];
      if (cell) setActiveCell(cell);
    }
  }, 30);
}

function restoreActiveCellByRow(rowIdx, colIdx, _attempt, ctxOverride) {
  setTimeout(() => {
    const table = _currentPivotTable(ctxOverride);
    if (!table) return;
    const dataRows = _currentPivotRows(ctxOverride);
    // Step 2: チャンク分割中で目的の rowIdx がまだ生成されていない可能性。
    // 進行中なら最大 30 回 (約1.5秒) リトライ
    const ctx = ctxOverride || ((typeof _currentPaneState === 'function') ? _currentPaneState() : null);
    const attempt = _attempt || 0;
    if (rowIdx >= dataRows.length && ctx && ctx._renderInProgress && attempt < 30) {
      restoreActiveCellByRow(rowIdx, colIdx, attempt + 1, ctx);
      return;
    }
    const row = dataRows[Math.min(rowIdx, dataRows.length - 1)];
    if (row) {
      // colIdx には数値インデックスの他に、エントリ名列は位置が固定でないため
      // 'entity' / 'first-prop' の指定も受け付ける（クラス/属性ベースで解決する）。
      let cell;
      if (colIdx === 'entity') {
        cell = row.querySelector('.col-entity');
      } else if (colIdx === 'first-prop') {
        cell = row.children[typeof _dbFirstPropertyColIndex === 'function' ? _dbFirstPropertyColIndex(row) : 1];
      } else {
        // colIdx が見つからない場合はエントリ名列へ（位置は並べ替えで変わり得るのでクラスで探す）
        cell = row.children[colIdx] || row.querySelector('.col-entity');
      }
      if (cell) setActiveCell(cell);
    }
  }, 30);
}

function restoreActiveCellByEntityName(entityName, ctxOverride) {
  const table = _currentPivotTable(ctxOverride);
  if (!table) return;
  const dataRows = _currentPivotRows(ctxOverride);
  for (const row of dataRows) {
    const label = row.querySelector('.entity-name-label');
    if (label && label.textContent === entityName) {
      setActiveCell(row.querySelector('.col-entity'));
      return;
    }
  }
  // Step 2: チャンク分割中で対象行が未生成の可能性。進行中ならポーリングで待機
  const ctx = ctxOverride || ((typeof _currentPaneState === 'function') ? _currentPaneState() : null);
  if (ctx && ctx._renderInProgress) {
    _waitForEntityRow(ctx, entityName, (tr) => setActiveCell(tr.querySelector('.col-entity')));
    return;
  }
  // 見つからなければ先頭行
  if (dataRows.length > 0) setActiveCell(dataRows[0].querySelector('.col-entity'));
}

// 空セルへの直接インライン入力
// セル位置を記憶し、値保存後に復元する共通処理
// D-6: セル位置を {entityName, propName} で保持 (rowIdx/colIdx ではない)
function _cellPos(td) {
  const tr = td.closest('tr');
  const paneCtx = (typeof _dbPaneContextFromEvent === 'function'
    ? _dbPaneContextFromEvent(td)
    : null) || (typeof _currentPaneState === 'function' ? _currentPaneState() : null);
  return {
    entityName: tr?.dataset?.entityName || '',
    propName: td.dataset?.propName || '',
    __paneCtx: paneCtx,
    __dbPath: paneCtx?.dbPath || '',
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
    if (ctx?.destroyed) return;
    const root = _paneEl(ctx, '#' + tblId) || (!ctx ? document : null);
    if (!root) return;
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
    // 保存完了時点のグローバル active pane ではなく、編集開始セルを所有していた
    // pane-local context へ戻す。別paneをクリックした直後に古い保存応答が完了しても、
    // そのpaneの同座標セルへactive枠を奪わない。
    const ctx = pos?.__paneCtx;
    if (!ctx || ctx.destroyed || (pos.__dbPath && ctx.dbPath !== pos.__dbPath)) return;
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
    const td = (propName && tr.querySelector(`td[data-prop-name="${CSS.escape(propName)}"]`)) || tr.querySelector('.col-entity');
    if (td) setActiveCell(td);
  }, 50);
}

// 型対応インラインセル入力
// D-7: ctx を最初に取得して state 参照を排除。Undo callback は closure 内 dbPath を使う
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
  const isPickerReplacementType = ['select', 'multi-select', 'common-tags', 'relation', 'multi-relation', 'user', 'multi-user', 'link'].includes(type);
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
  if (type === 'link') {
    if (typeof startDbLinkCellEdit === 'function') {
      startDbLinkCellEdit({
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
          showStatus('エントリの作成に失敗: ' + (e?.message || e), true);
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

// 列をインラインで挿入（ダイアログなし）
// typeConfig を渡すとその列タイプで作成する（未指定なら従来どおりテキスト列）
function insertPropertyInline(refProp, direction, ctxOrDbPath, typeConfig) {
  const ctx = (typeof ctxOrDbPath === 'object' && ctxOrDbPath)
    ? ctxOrDbPath
    : (typeof _dbPaneContextFromEvent === 'function'
      ? _dbPaneContextFromEvent(null, { dbPath: typeof ctxOrDbPath === 'string' ? ctxOrDbPath : state.currentDbPath })
      : (typeof _currentPaneState === 'function' ? _currentPaneState() : null));
  const dbPath = (typeof ctxOrDbPath === 'string' ? ctxOrDbPath : '') || (ctx && ctx.dbPath) || state.currentDbPath;
  if (!dbPath) return;
  const pivotData = (ctx && ctx.pivotData) || state.pivotData;
  const fallbackOrder = typeof filterDeletedDbProperties === 'function'
    ? filterDeletedDbProperties(dbPath, pivotData?.properties || [])
    : [...(pivotData?.properties || [])];
  const order = getColOrder(dbPath, { ctx }) || fallbackOrder;
  // 新しい列の初期名は typeConfig.initialName があればそれを優先する。
  // 無ければ選んだ列タイプ名にする（型未指定はテキスト）。
  const _hasTypeConfig = !!(typeConfig && typeof typeConfig === 'object');
  const _newColType = (_hasTypeConfig && typeConfig.type) ? typeConfig.type : 'text';
  const _initialName = (_hasTypeConfig && typeof typeConfig.initialName === 'string') ? typeConfig.initialName.trim() : '';
  const base = _initialName || (typeof getPropertyTypeLabel === 'function' ? getPropertyTypeLabel(_newColType) : '') || 'テキスト';
  let idx = 1, name = base;
  while (order.includes(name)) { idx++; name = base + idx; }
  const refIdx = order.indexOf(refProp);
  if (refIdx >= 0) {
    const insertIdx = direction === 'left' ? refIdx : refIdx + 1;
    order.splice(insertIdx, 0, name);
  } else {
    order.push(name);
  }
  setColOrder(dbPath, order, { skipHistory: true, ctx });
  // typeConfig.initialName は列名決定のみに使うヒントであり、列タイプ設定として保存しない。
  const typeConfigToSave = _hasTypeConfig ? { ...typeConfig } : { type: 'text' };
  delete typeConfigToSave.initialName;
  setPropertyType(dbPath, name, typeConfigToSave, ctx);
  if (typeof _renderCurrentDbView === 'function') _renderCurrentDbView(ctx, dbPath);
  else renderPivot(ctx);
  // 挿入後にヘッダーをインラインリネームモードに
  setTimeout(() => {
    const _ctx = ctx || _currentPaneState();
    const th = _paneEl(_ctx, '#' + (_ctx.tableId || 'pivot-table') + ` thead th[data-prop="${name}"]`);
    // _ctx を渡さないと startHeaderInlineRename() が _dbPaneContextFromEvent() で再解決し、
    // 埋め込みシート（グローバル _panes レジストリ未登録）の場合はメイン画面側の別ペインへ
    // 誤って解決され得る（showColHeaderMenu 系と同根。2026-07-15 徹底チェックで発見）。
    if (th) startHeaderInlineRename(th, name, dbPath, _ctx);
    else {
      const treeHeader = _ctx?.containerEl?.querySelector?.(`.db-tree-header-cell[data-db-col-token="${CSS.escape(name)}"]`)
        || document.querySelector(`.tree-view .db-tree-header-cell[data-db-col-token="${CSS.escape(name)}"]`);
      if (treeHeader && typeof showColHeaderMenu === 'function') {
        const rect = treeHeader.getBoundingClientRect();
        showColHeaderMenu({
          target: treeHeader,
          currentTarget: treeHeader,
          clientX: rect.right,
          clientY: rect.bottom,
        }, name, 0, _ctx, dbPath, {
          omitGroupBy: true,
          includeManualSort: true,
        });
        setTimeout(() => document.querySelector('.gb-context-menu input')?.focus(), 0);
      }
    }
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
function _closePivotAggregationDropdowns(scope) {
  const paneId = scope?.paneId
    || scope?.dataset?.dbPaneId
    || scope?.closest?.('[data-pane-id]')?.dataset?.paneId
    || '';
  const paneRoot = scope?.containerEl
    || scope?.closest?.('[data-pane-id]')
    || document;
  paneRoot.querySelectorAll('.count-type-select[aria-expanded="true"]').forEach(el => {
    el.setAttribute('aria-expanded', 'false');
  });
  document.querySelectorAll('.count-type-dropdown').forEach(el => {
    if (paneId && el.dataset.dbPaneId !== paneId) return;
    el.remove();
  });
}

function _pivotAggregationLabel(aggTypes, key) {
  return (aggTypes || []).find(opt => opt.key === key)?.label || '-';
}

function _openPivotAggregationDropdown(anchor, aggTypes, currentKey, onSelect, ctx) {
  if (!anchor || !Array.isArray(aggTypes)) return;
  closeAllDropdowns(ctx || anchor);
  _closePivotAggregationDropdowns(ctx || anchor);
  const dd = document.createElement('div');
  dd.className = 'status-dropdown count-type-dropdown';
  if (ctx?.paneId) dd.dataset.dbPaneId = ctx.paneId;
  dd.setAttribute('role', 'listbox');
  dd.setAttribute('aria-label', '集計タイプ');

  aggTypes.forEach(opt => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'status-dropdown-item count-type-dropdown-item';
    item.setAttribute('role', 'option');
    item.setAttribute('aria-selected', opt.key === currentKey ? 'true' : 'false');
    item.textContent = opt.label;
    if (opt.key === currentKey) item.classList.add('selected');
    item.addEventListener('click', () => {
      _closePivotAggregationDropdowns(ctx || anchor);
      if (typeof onSelect === 'function') onSelect(opt.key);
      anchor.focus?.();
    });
    dd.appendChild(item);
  });

  document.body.appendChild(dd);
  if (typeof positionPopup === 'function') {
    positionPopup(dd, anchor.getBoundingClientRect(), { prefer: 'above', gap: 2 });
  } else {
    const rect = anchor.getBoundingClientRect();
    const z = typeof _getZoom === 'function' ? _getZoom() : 1;
    dd.style.position = 'fixed';
    dd.style.left = (rect.left / z) + 'px';
    dd.style.top = (rect.top / z - dd.offsetHeight - 2) + 'px';
    if (typeof clampPopupToViewport === 'function') clampPopupToViewport(dd);
  }
  if (typeof _enableDropdownKeyNav === 'function') _enableDropdownKeyNav(dd, '.count-type-dropdown-item');

  setTimeout(() => {
    const closer = (e) => {
      if (dd.contains(e.target) || anchor.contains?.(e.target)) return;
      _closePivotAggregationDropdowns(ctx || anchor);
      document.removeEventListener('pointerdown', closer);
    };
    document.addEventListener('pointerdown', closer);
  }, 0);
}

function renderPivotFooter(visibleProps, entitiesMap, entityNames, pinnedCols, savedWidths, propTypes, ctx, footerOptions) {
  ctx = ctx || _currentPaneState();
  const _ftblId = ctx.tableId || 'pivot-table';
  const tfoot = _paneEl(ctx, '#' + _ftblId + ' tfoot');
  if (!tfoot) return;
  tfoot.innerHTML = '';
  const dbPath = ctx.dbPath || state.currentDbPath;
  const filterMode = ctx.filter ?? state.filter ?? 'disabled';
  const countTypes = getCountTypes(dbPath, { ctx });

  // フッター表示トグル（localStorageで管理）
  const showFooter = typeof getShowFooter === 'function' ? getShowFooter(dbPath, { ctx }) : (getDbViewConfig(dbPath).showFooter || false);
  if (!showFooter) return;

  const { renderedCols, entityColumnPinned, pinnedOffsets, entityWidth } = footerOptions || {};
  // 幅はヘッダー・データ行と同じ CSS 変数から取る（ズレると固定列だけ横にずれる）
  const rowControlsWidth = typeof _dbRowControlsWidth === 'function'
    ? _dbRowControlsWidth(_paneEl(ctx, '#' + _ftblId))
    : 56;

  const tr = document.createElement('tr');
  tr.setAttribute('role', 'row');

  // 行先頭コントロール列に対応する空セル（列数を揃えるため）
  const tdControls = document.createElement('td');
  tdControls.className = 'col-row-controls';
  tdControls.setAttribute('role', 'cell');
  tdControls.setAttribute('aria-hidden', 'true');
  tr.appendChild(tdControls);

  const tdLabel = document.createElement('td');
  tdLabel.className = 'col-entity';
  tdLabel.dataset.dbColToken = '__entity__';
  tdLabel.setAttribute('role', 'rowheader');
  tdLabel.setAttribute('aria-label', '集計');
  tdLabel.textContent = '集計';
  tdLabel.style.fontStyle = 'italic';
  const _footerEntW = entityWidth || (savedWidths && savedWidths['__entity__']) || 120;
  tdLabel.style.width = _footerEntW + 'px';
  tdLabel.style.minWidth = _footerEntW + 'px';
  tdLabel.style.maxWidth = _footerEntW + 'px';

  // フェーズ2: エントリ名列（集計ラベル）も他の列と同じ並べ替え順序（renderedCols）で配置する
  const cols = Array.isArray(renderedCols) && renderedCols.length ? renderedCols : ['__entity__', ...visibleProps];
  const effectivePinnedOffsets = pinnedOffsets || (typeof _dbPinnedColumnOffsets === 'function'
    ? _dbPinnedColumnOffsets(cols, pinnedCols, entityColumnPinned, savedWidths, _footerEntW, rowControlsWidth)
    : {});
  cols.forEach(token => {
    if (token === '__entity__') {
      const entityLeft = effectivePinnedOffsets.__entity__;
      const entityShouldStick = entityColumnPinned && Number.isFinite(entityLeft);
      tdLabel.style.position = entityShouldStick ? 'sticky' : '';
      tdLabel.style.left = entityShouldStick ? entityLeft + 'px' : '';
      tr.appendChild(tdLabel);
      return;
    }
    const propName = token;
    const td = document.createElement('td');
    td.dataset.dbColToken = propName;
    td.setAttribute('role', 'cell');
    td.setAttribute('aria-label', `集計 / ${propName}`);
    if (pinnedCols.includes(propName)) {
      td.classList.add('col-pinned');
      const pinnedLeft = effectivePinnedOffsets[propName];
      if (Number.isFinite(pinnedLeft)) td.style.left = pinnedLeft + 'px';
    }

    const countType = countTypes[propName] || 'none';
    const fPtc = propTypes?.[propName];
    // 拡張集計エンジン使用（gb-db-aggregate.js）
    const resolvedType = fPtc?.type || (typeof inferPropertyType === 'function' ? inferPropertyType(propName, entitiesMap, entityNames, filterMode) : 'text');
    const needsAsyncAggregation = fPtc?.type === 'rollup' && typeof calcAggregationAsync === 'function';
    const result = needsAsyncAggregation ? '計算中...' : (typeof calcAggregation === 'function'
      ? calcAggregation(propName, entitiesMap, entityNames, countType, fPtc, propTypes, filterMode)
      : calcColumnCount(propName, entitiesMap, entityNames, countType, fPtc, propTypes, filterMode));

    const wrapper = document.createElement('div');
    wrapper.style.cssText = 'display:flex;align-items:center;gap:4px;';
    // 型に応じた集計タイプ一覧を取得
    const aggTypes = typeof getAggregationTypesForProperty === 'function'
      ? getAggregationTypesForProperty(resolvedType)
      : [{key:'none',label:'-'},{key:'count',label:'件数'},{key:'unique',label:'ユニーク'},{key:'empty',label:'空'},{key:'not_empty',label:'非空'}];
    const sel = document.createElement('button');
    sel.type = 'button';
    sel.className = 'count-type-select';
    sel.setAttribute('aria-haspopup', 'listbox');
    sel.setAttribute('aria-expanded', 'false');
    sel.setAttribute('aria-label', `集計タイプ / ${propName}`);
    sel.textContent = _pivotAggregationLabel(aggTypes, countType);
    sel.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      sel.setAttribute('aria-expanded', 'true');
      _openPivotAggregationDropdown(sel, aggTypes, countType, (nextType) => {
        sel.setAttribute('aria-expanded', 'false');
        setCountType(dbPath, propName, nextType, { ctx });
        renderPivot(ctx);
      }, ctx);
    });
    wrapper.appendChild(sel);

    if (countType !== 'none') {
      const span = document.createElement('span');
      span.textContent = result;
      wrapper.appendChild(span);
      if (needsAsyncAggregation) {
        calcAggregationAsync(propName, entitiesMap, entityNames, countType, fPtc, propTypes, filterMode, { dbPath, sourceDbPath: dbPath })
          .then(value => { if (span.isConnected) span.textContent = value; })
          .catch(() => { if (span.isConnected) span.textContent = '-'; });
      }
    }
    td.appendChild(wrapper);
    tr.appendChild(td);
  });
  // ＋プロパティ列の空セル
  const tdAddFoot = document.createElement('td');
  tdAddFoot.className = 'col-add-prop-cell';
  tdAddFoot.setAttribute('role', 'cell');
  tr.appendChild(tdAddFoot);
  tfoot.appendChild(tr);
}

function calcColumnCount(propName, entitiesMap, entityNames, type, ptc, propTypes, filterMode) {
  if (type === 'none') return '';
  let count = 0, uniqueSet = new Set(), empty = 0, notEmpty = 0;
  entityNames.forEach(en => {
    // 数式プロパティの場合、計算結果で集計
    if (ptc && ptc.type === 'formula' && ptc.formula) {
      const result = formulaEvalForEntity(ptc.formula, entitiesMap[en], { propTypes });
      const v = result.error ? '' : String(result.value);
      if (!v || v === '') empty++;
      else { notEmpty++; count++; uniqueSet.add(v); }
    } else {
      const vals = filterValues(entitiesMap[en][propName] || [], undefined, filterMode);
      if (vals.length === 0) empty++;
      else { notEmpty++; vals.forEach(v => { count++; uniqueSet.add(v.value); }); }
    }
  });
  switch (type) {
    case 'count': return count;
    case 'unique': return uniqueSet.size;
    case 'empty': return empty;
    case 'not_empty': return notEmpty;
    default: return '';
  }
}

// アクティブセル管理
let activeCell = null;
let rangeAnchorCell = null;
let dbCellClipboard = null;
let dbCellClipboardAt = 0;
const DB_CELL_INTERNAL_CLIPBOARD_TTL_MS = 30 * 60 * 1000;
let dbCellBulkBarRaf = 0;
let dbActiveCellSeq = 0;

function _scrollDbActiveCellIntoView(td) {
  if (!td) return;
  const table = td.closest?.('table');
  const scroller = td.closest?.('.pivot-view, #pivot-view') || table?.closest?.('.pivot-view, #pivot-view')
    || (typeof _getDbViewScrollContainer === 'function' ? _getDbViewScrollContainer(null, 'pivot') : null);
  if (!scroller) {
    td.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    return;
  }
  const cellRect = td.getBoundingClientRect?.();
  const scrollRect = scroller.getBoundingClientRect?.();

  if (!cellRect || !scrollRect || cellRect.width <= 0 || cellRect.height <= 0) return;
  const headerRect = table?.querySelector?.('thead')?.getBoundingClientRect?.();
  const headerHeight = headerRect && headerRect.bottom > scrollRect.top && headerRect.top < scrollRect.bottom
    ? Math.max(0, headerRect.height)
    : 0;
  const cellIndex = td.parentElement ? Array.from(td.parentElement.children).indexOf(td) : -1;
  const isEntityCell = td.classList.contains('col-entity');
  // 行先頭コントロール列（＋/ハンドル/チェックボックス）は常に固定表示。
  const controlsRect = table.querySelector('tbody tr:not(.group-header-row):not(.new-entity-row):not(.new-entity-spacer-row):not(.db-virtual-spacer-row) td.col-row-controls')?.getBoundingClientRect?.();
  // エントリ名列は「先頭にある間」だけ固定表示（entity-col-unpinned クラスで判定）。
  // 対象セル自身がエントリ名列の場合は、自分自身の幅を左端リミットに含めない。
  const entityPinned = !!table && !table.classList.contains('entity-col-unpinned');
  const entityRect = entityPinned && !isEntityCell && cellIndex > 0
    ? table.querySelector('tbody tr:not(.group-header-row):not(.new-entity-row):not(.new-entity-spacer-row):not(.db-virtual-spacer-row) td.col-entity')?.getBoundingClientRect?.()
    : null;
  const pad = 4;
  const topLimit = scrollRect.top + headerHeight + pad;
  const bottomLimit = scrollRect.bottom - pad;
  const leftLimit = scrollRect.left + (controlsRect?.width || 0) + (entityRect?.width || 0) + pad;
  const rightLimit = scrollRect.right - pad;
  let deltaTop = 0;
  let deltaLeft = 0;
  if (cellRect.top < topLimit) deltaTop = cellRect.top - topLimit;
  else if (cellRect.bottom > bottomLimit) deltaTop = cellRect.bottom - bottomLimit;
  if (cellRect.left < leftLimit) deltaLeft = cellRect.left - leftLimit;
  else if (cellRect.right > rightLimit) deltaLeft = cellRect.right - rightLimit;
  if (deltaTop) scroller.scrollTop += deltaTop;
  if (deltaLeft) scroller.scrollLeft += deltaLeft;
}

function _scheduleDbActiveCellScroll(td) {
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(() => _scrollDbActiveCellIntoView(td));
  } else {
    setTimeout(() => _scrollDbActiveCellIntoView(td), 0);
  }
}

function _clearDbCellRangeSelection(table) {
  (table || document).querySelectorAll('.db-range-selected').forEach(cell => {
    cell.classList.remove('db-range-selected');
    cell.removeAttribute('aria-selected');
  });
}

function _dbCellCoords(table, td) {
  if (!table || !td) return null;
  const tr = td.parentElement;
  let rows = Array.from(table.querySelectorAll('tbody tr:not(.group-header-row):not(.new-entity-row):not(.new-entity-spacer-row):not(.db-virtual-spacer-row)'));
  const virtualRows = typeof _dbVirtualStateForTable === 'function' ? _dbVirtualStateForTable(table) : null;
  if (virtualRows) {
    const rowByName = new Map(rows.map(rowEl => [rowEl.dataset.entityName || '', rowEl]));
    rows = (virtualRows.entityNames || []).map(name => rowByName.get(name) || null);
  }
  const row = virtualRows && tr?.dataset?.entityName
    ? virtualRows.entityNames.indexOf(tr.dataset.entityName)
    : rows.indexOf(tr);
  const col = tr ? Array.from(tr.children).indexOf(td) : -1;
  if (row < 0 || col < 0) return null;
  return { row, col, rows };
}

function _dbCellAt(table, rowIdx, colIdx) {
  const rows = Array.from(table.querySelectorAll('tbody tr:not(.group-header-row):not(.new-entity-row):not(.new-entity-spacer-row):not(.db-virtual-spacer-row)'));
  const virtualRows = typeof _dbVirtualStateForTable === 'function' ? _dbVirtualStateForTable(table) : null;
  if (virtualRows) {
    const entityName = virtualRows.entityNames?.[rowIdx];
    if (!entityName) return null;
    const cssName = typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
      ? CSS.escape(entityName)
      : String(entityName).replace(/["\\]/g, '\\$&');
    const row = table.querySelector(`tbody tr[data-entity-name="${cssName}"]`);
    if (!row) {
      if (typeof _dbRequestVirtualCellReveal === 'function') _dbRequestVirtualCellReveal(table, rowIdx, colIdx);
      return null;
    }
    const maxCol = row.children.length - 2;
    if (colIdx < 0 || colIdx > maxCol) return null;
    return row.children[colIdx] || null;
  }
  if (rowIdx < 0 || rowIdx >= rows.length) return null;
  const row = rows[rowIdx];
  if (!row) return null;
  const maxCol = row.children.length - 2;
  if (colIdx < 0 || colIdx > maxCol) return null;
  return row.children[colIdx] || null;
}

function _markDbCellRange(table, anchor, target) {
  if (!table || !anchor || !target) return;
  const a = _dbCellCoords(table, anchor);
  const b = _dbCellCoords(table, target);
  if (!a || !b) return;
  _clearDbCellRangeSelection(table);
  const [rowStart, rowEnd] = a.row < b.row ? [a.row, b.row] : [b.row, a.row];
  const [colStart, colEnd] = a.col < b.col ? [a.col, b.col] : [b.col, a.col];
  for (let r = rowStart; r <= rowEnd; r += 1) {
    const tr = a.rows[r];
    if (!tr) continue;
    const maxCol = tr.children.length - 2;
    for (let c = Math.max(colStart, DB_ROW_CONTROLS_COL_COUNT); c <= Math.min(colEnd, maxCol); c += 1) {
      const cell = tr.children[c];
      if (!cell || cell.classList.contains('col-add-prop-cell') || cell.classList.contains('col-row-controls')) continue;
      cell.classList.add('db-range-selected');
      cell.setAttribute('aria-selected', 'true');
    }
  }
  _scheduleDbCellBulkBarUpdate(table);
}

function _setDbCellRangeSelected(cell, selected) {
  if (!cell || cell.classList.contains('col-add-prop-cell') || cell.classList.contains('col-row-controls')) return;
  cell.classList.toggle('db-range-selected', !!selected);
  if (selected) cell.setAttribute('aria-selected', 'true');
  else cell.removeAttribute('aria-selected');
  _scheduleDbCellBulkBarUpdate(cell.closest('table'));
}

function _dbSelectedDataCells(table, includeActive = true) {
  const cells = Array.from((table || document).querySelectorAll('tbody td.db-range-selected[data-prop-name]'));
  if (includeActive && activeCell?.dataset?.propName && activeCell.closest('table') === table && !cells.includes(activeCell)) {
    cells.push(activeCell);
  }
  cells.sort((a, b) => {
    const ca = _dbCellCoords(table, a);
    const cb = _dbCellCoords(table, b);
    if (!ca || !cb) return 0;
    return ca.row === cb.row ? ca.col - cb.col : ca.row - cb.row;
  });
  return cells;
}

function _dbCellBulkPaneId(table) {
  const ctx = _dbContextForCell(activeCell || table);
  return (ctx && ctx.paneId) || table?.closest?.('[data-pane-id]')?.dataset?.paneId || 'main';
}

function _dbCellBulkBarsFor(table) {
  const paneId = _dbCellBulkPaneId(table);
  return Array.from(document.querySelectorAll(`.db-cell-bulk-bar[data-pane-id="${paneId}"]`));
}

function _hideDbCellBulkBar(table) {
  _dbCellBulkBarsFor(table).forEach(bar => bar.remove());
}

function _clearDbCellSelection(table) {
  _clearDbCellRangeSelection(table);
  rangeAnchorCell = null;
  if (activeCell) {
    activeCell.classList.remove('active-cell');
    activeCell.tabIndex = -1;
  }
  activeCell = null;
  _hideDbCellBulkBar(table);
}

function _dbHasInternalCellClipboard() {
  return !!(dbCellClipboard && Array.isArray(dbCellClipboard.cells)
    && dbCellClipboard.cells.length
    && Date.now() - dbCellClipboardAt < DB_CELL_INTERNAL_CLIPBOARD_TTL_MS);
}

function _dbCellBulkPaneHostFrom(el) {
  const host = el?.closest?.('.gb-pane-content,.pane-content,[data-pane-id]');
  if (!host) return null;
  if (!host.matches?.('#pivot-view,.pivot-view')) return host;
  return host.parentElement?.closest?.('.gb-pane-content,.pane-content,[data-pane-id]') || null;
}

function _dbCellBulkHost(table) {
  const ctx = _dbContextForCell(table) || _dbContextForCell(activeCell);
  const ctxHost = _dbCellBulkPaneHostFrom(ctx?.containerEl);
  if (ctxHost) return ctxHost;
  const paneHost = _dbCellBulkPaneHostFrom(table);
  if (paneHost) return paneHost;
  const pivotHost = table?.closest?.('#pivot-view,.pivot-view');
  const pivotPaneHost = _dbCellBulkPaneHostFrom(pivotHost?.parentElement);
  if (pivotPaneHost) return pivotPaneHost;
  return table?.closest?.('#main-views')
    || document.getElementById('main-views')
    || document.body;
}

function _dbBulkPasteStartCell(table) {
  const selected = _dbSelectedDataCells(table, false);
  if (selected.length > 0) return selected[0];
  const visual = _dbCurrentVisualActiveCell();
  if (visual?.dataset?.propName && table?.contains?.(visual)) return visual;
  return activeCell?.dataset?.propName && table?.contains?.(activeCell) ? activeCell : null;
}

// 複数選択セルの候補値ステータスを一括変更する（選択中の全セルが候補値ちょうど1個・編集可能・
// ステータス機能ONのときだけ対象。1つでも 0個/2個以上/編集不可のセルがあれば null を返しボタンを出さない）。
function _dbBulkStatusTargets(table, ctx) {
  if (!ctx) return null;
  const dbPath = ctx.dbPath || state.currentDbPath || '';
  if (!dbPath || typeof getStatusEnabled !== 'function' || !getStatusEnabled(dbPath)) return null;
  const data = ctx.pivotData || state.pivotData;
  if (!data || !data.entities) return null;
  const cells = _dbSelectedDataCells(table, true);
  if (cells.length <= 1) return null;
  const targets = [];
  for (const td of cells) {
    if (typeof _dbCellAllowsPaste === 'function' && !_dbCellAllowsPaste(td, ctx)) return null;
    const { entityName, propName } = _dbCellEntityAndProp(td);
    const values = data.entities?.[entityName]?.[propName];
    if (!Array.isArray(values) || values.length !== 1) return null;
    targets.push({ td, entityName, propName, val: values[0] });
  }
  return targets.length ? targets : null;
}

// 同一エントリファイル内の複数値へ順にステータスを書き込む。1件書き込むとエントリのリビジョンが
// 上がるため、同ファイルの後続書き込みへ最新リビジョンを引き継がないと 409 競合で弾かれる
// （複数セルが同じ行＝同じエントリに属する一括変更で必ず発生する）。取り消し/やり直し時は各値の
// entry_revision が直前バッチの書き込み順でズレているため、先に同一ファイルの最新リビジョンを
// 集約し、最初の書き込みから正しい baseRevision を使う。
async function _dbWriteStatusesThreaded(items, statusFor) {
  const revByFile = {};
  for (const it of items) {
    const val = it && (it.val || it);
    if (!val || !val.file) continue;
    const r = Number(val.entry_revision ?? val.revision);
    if (Number.isInteger(r) && (revByFile[val.file] == null || r > revByFile[val.file])) revByFile[val.file] = r;
  }
  for (const it of items) {
    const val = it && (it.val || it);
    if (!val) continue;
    const f = val.file;
    if (f && revByFile[f] != null) val.entry_revision = revByFile[f];
    const st = statusFor(it);
    await _apiPutValue(val, { new_status: st });
    val.status = st;
    if (f && val.entry_revision != null) revByFile[f] = val.entry_revision;
  }
}

async function _dbApplyBulkCellStatus(table, ctx, targets, newStatus) {
  if (!Array.isArray(targets) || !targets.length) return;
  const dbPath = (ctx && ctx.dbPath) || state.currentDbPath || '';
  const snapshots = targets.map(t => ({ val: t.val, oldStatus: t.val?.status ?? '' }));
  try {
    await _dbWriteStatusesThreaded(targets, () => newStatus);
  } catch (e) {
    if (typeof showStatus === 'function') showStatus('ステータスの一括変更に失敗しました', true);
    if (dbPath) await selectDatabase(dbPath, ctx || undefined, { silent: true });
    return;
  }
  // 取り消し（1操作で全セルを元に戻す）。同一エントリ内の複数値もリビジョンを引き継いで書き込む。
  if (typeof historyPush === 'function') {
    const scope = typeof _dbScope === 'function' ? _dbScope(dbPath) : ('db:' + String(dbPath || '').split('/').pop());
    const applyAll = async (statusFor) => {
      await _dbWriteStatusesThreaded(snapshots, statusFor);
      if (dbPath) await selectDatabase(dbPath, ctx || undefined, { silent: true });
    };
    historyPush(
      'ステータス一括変更: ' + newStatus + ' (' + snapshots.length + ' 件)',
      () => applyAll(s => s.oldStatus),
      () => applyAll(() => newStatus),
      scope
    );
  }
  if (typeof showStatus === 'function') showStatus('ステータスを一括変更: ' + newStatus + ' (' + targets.length + ' 件)');
  if (dbPath) await selectDatabase(dbPath, ctx || undefined, { silent: true });
}

function _dbShowBulkCellStatusMenu(anchorEl, table) {
  const ctx = _dbContextForCell(table) || _dbContextForCell(activeCell);
  const targets = _dbBulkStatusTargets(table, ctx);
  if (!targets) {
    if (typeof showStatus === 'function') showStatus('候補値が1つのセルだけを選択してください');
    return;
  }
  const dbPath = (ctx && ctx.dbPath) || state.currentDbPath || '';
  if (typeof closeAllDropdowns === 'function') closeAllDropdowns(ctx || anchorEl);
  const dd = document.createElement('div');
  dd.className = 'status-dropdown';
  if (ctx?.paneId) dd.dataset.dbPaneId = ctx.paneId;
  const statuses = typeof getStatusList === 'function' ? getStatusList(dbPath) : [];
  statuses.forEach(stObj => {
    const st = stObj.name;
    const item = document.createElement('div');
    item.className = 'status-dropdown-item';
    const dot = document.createElement('span');
    dot.style.cssText = 'width:8px;height:8px;border-radius:50%;display:inline-block;';
    dot.style.background = stObj.color;
    item.appendChild(dot);
    item.appendChild(document.createTextNode(' ' + st));
    item.addEventListener('click', () => {
      if (typeof closeAllDropdowns === 'function') closeAllDropdowns(ctx || anchorEl);
      _dbApplyBulkCellStatus(table, ctx, targets, st).catch(() => {
        if (typeof showStatus === 'function') showStatus('ステータスの一括変更に失敗しました', true);
      });
    });
    dd.appendChild(item);
  });
  document.body.appendChild(dd);
  if (typeof positionPopup === 'function' && anchorEl) {
    positionPopup(dd, anchorEl.getBoundingClientRect());
  } else if (anchorEl) {
    const rect = anchorEl.getBoundingClientRect();
    dd.style.position = 'fixed';
    dd.style.left = rect.left + 'px';
    dd.style.top = (rect.bottom + 2) + 'px';
    if (typeof clampPopupToViewport === 'function') clampPopupToViewport(dd);
  }
}

function _updateDbCellBulkBar(table) {
  const targetTable = table || activeCell?.closest?.('table') || (typeof _currentPivotTable === 'function' ? _currentPivotTable() : null);
  if (!targetTable || !targetTable.isConnected) {
    _hideDbCellBulkBar(targetTable);
    return;
  }
  const selected = _dbSelectedDataCells(targetTable, true);
  if (selected.length <= 1) {
    _hideDbCellBulkBar(targetTable);
    return;
  }

  const paneId = _dbCellBulkPaneId(targetTable);
  const host = _dbCellBulkHost(targetTable);
  let bar = document.querySelector(`.db-cell-bulk-bar[data-pane-id="${paneId}"]`);
  if (!bar) {
    bar = document.createElement('div');
    bar.className = 'db-cell-bulk-bar gb-selection-float-bar';
    bar.dataset.paneId = paneId;
    bar.dataset.selectionFloatPaneId = paneId;
    bar.dataset.e2eId = 'db-cell-bulk-bar-' + paneId;
    bar.addEventListener('pointerdown', event => event.stopPropagation());
    (host || document.body).appendChild(bar);
  }
  if (window.GBSelectionFloatMenu) {
    window.GBSelectionFloatMenu.bindDrag(bar, { host });
    window.GBSelectionFloatMenu.resetPosition(bar, { host, anchor: targetTable, zIndex: '510' });
  }
  bar.innerHTML = '';
  if (window.GBSelectionFloatMenu) {
    bar.appendChild(window.GBSelectionFloatMenu.createDragHandle());
  }

  const label = document.createElement('span');
  label.className = 'db-cell-bulk-count gb-selection-float-count';
  label.textContent = selected.length + ' セル選択中';
  bar.appendChild(label);

  const makeButton = (labelText, e2eId, onClick, options = {}) => {
    const btn = window.GBSelectionFloatMenu
      ? window.GBSelectionFloatMenu.button(labelText, {
          e2eId: e2eId + '-' + paneId,
          danger: options.danger,
          muted: options.muted,
          onClick,
        })
      : document.createElement('button');
    if (!window.GBSelectionFloatMenu) {
      btn.type = 'button';
      btn.textContent = labelText;
      btn.dataset.e2eId = e2eId + '-' + paneId;
      btn.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        onClick();
      });
    }
    bar.appendChild(btn);
    return btn;
  };

  makeButton('コピー', 'db-cell-bulk-copy', () => {
    _dbCopySelectedCells(targetTable).catch(() => {
      if (typeof showStatus === 'function') showStatus('セルのコピーに失敗しました', true);
    });
  });
  makeButton('貼り付け', 'db-cell-bulk-paste', () => {
    _dbPasteClipboardCells(targetTable, _dbBulkPasteStartCell(targetTable)).catch(() => {
      if (typeof showStatus === 'function') showStatus('セルの貼り付けに失敗しました', true);
    });
  });
  // ステータス一括変更（選択中の全セルが候補値ちょうど1個・ステータス機能ONのときだけ表示）
  const _bulkStatusCtx = _dbContextForCell(targetTable) || _dbContextForCell(activeCell);
  if (_dbBulkStatusTargets(targetTable, _bulkStatusCtx)) {
    const statusBtn = makeButton('ステータス変更', 'db-cell-bulk-status', () => {
      _dbShowBulkCellStatusMenu(statusBtn, targetTable);
    });
  }
  makeButton('削除', 'db-cell-bulk-delete', () => {
    _dbClearSelectedCells(targetTable).catch(() => {
      if (typeof showStatus === 'function') showStatus('セルの削除に失敗しました', true);
    });
  }, { danger: true });
  makeButton('選択解除', 'db-cell-bulk-clear', () => _clearDbCellSelection(targetTable), { muted: true });
}

function _scheduleDbCellBulkBarUpdate(table) {
  if (table && table.isConnected) _updateDbCellBulkBar(table);
  if (dbCellBulkBarRaf) cancelAnimationFrame(dbCellBulkBarRaf);
  dbCellBulkBarRaf = requestAnimationFrame(() => {
    dbCellBulkBarRaf = 0;
    _updateDbCellBulkBar(table);
  });
}

function selectDbCellFromPointer(td, event) {
  const table = td?.closest?.('table');
  if (!table || !td?.dataset?.propName) return;
  if (event?.shiftKey || event?.ctrlKey || event?.metaKey) {
    _dbCloseTransientUiForCellRangeSelection();
  }
  if (event?.shiftKey) {
    const anchor = rangeAnchorCell || activeCell || td;
    rangeAnchorCell = anchor;
    setActiveCell(td, { preserveRange: true });
    _markDbCellRange(table, anchor, td);
    return;
  }
  if (event?.ctrlKey || event?.metaKey) {
    const previousActive = activeCell && activeCell.closest?.('table') === table ? activeCell : null;
    const wasSelected = td.classList.contains('db-range-selected');
    if (previousActive && previousActive !== td && previousActive.dataset?.propName) {
      _setDbCellRangeSelected(previousActive, true);
    }
    if (!rangeAnchorCell) rangeAnchorCell = activeCell || td;
    setActiveCell(td, { preserveRange: true });
    _setDbCellRangeSelected(td, previousActive === td ? !wasSelected : true);
    return;
  }
  setActiveCell(td);
}

function _dbPointerDataCell(event) {
  const target = event?.target;
  if (!target || typeof target.closest !== 'function') return null;
  const td = target.closest('td[data-prop-name]');
  if (!td || !td.isConnected) return null;
  if (td.closest('tr.new-entity-row, tr.new-entity-spacer-row, tr.group-header-row')) return null;
  // .cell-add-btn は各セルの pointerdown ハンドラ（gb-db-table.part02.js:540）も除外している。
  // document capture の当リスナが先に発火して選択へ横取りすると、＋ボタン本来のクリックが潰れるため、
  // ここでも同じ除外を掛ける。（.cell-select-val は pointerdown では除外しない＝チップ上からの押下でも
  // セル選択/範囲ドラッグを開始できるようにする。値の編集はチップ自身の click ハンドラで開く）
  if (target.closest('.cell-add-btn,.status-dot,.cell-checkbox,.chat-prop-cell,.db-action-btn,.cell-inline-input,.cell-inline-select,.cell-inline-dd,.cell-date-editor')) return null;
  return td;
}

document.addEventListener('pointerdown', (event) => {
  if (event.defaultPrevented || event._dbCellPointerHandled) return;
  const td = _dbPointerDataCell(event);
  if (!td) return;
  event._dbCellPointerHandled = true;
  if (event.shiftKey || event.ctrlKey || event.metaKey) {
    td._dbModifierPointerSelectionHandledUntil = Date.now() + 300;
    selectDbCellFromPointer(td, event);
  } else {
    setActiveCell(td, { scroll: false });
  }
}, true);

try {
  window.__meldexSetActiveCell = setActiveCell;
  window.__meldexSelectDbCellFromPointer = selectDbCellFromPointer;
} catch {}

function _dbRestoreCellAddButtonsIfIdle(td) {
  if (!td || !td.querySelectorAll) return;
  if (td.querySelector('.cell-inline-input,.cell-inline-select,.cell-inline-dd,.cell-date-editor')) return;
  td.querySelectorAll('.cell-add-btn[data-editing-hidden]').forEach(btn => {
    btn.style.display = '';
    delete btn.dataset.editingHidden;
  });
}

function _dbRemoveNodeIfAttached(el) {
  try {
    if (el?.parentNode) el.remove();
  } catch {}
}

function _dbCloseTransientUiForCellRangeSelection() {
  document.querySelectorAll('.status-dropdown,.cell-inline-dd,.user-dropdown,.gb-context-menu').forEach(_dbRemoveNodeIfAttached);
  document.querySelectorAll('.cell-add-btn[data-editing-hidden]').forEach(btn => {
    btn.style.display = '';
    delete btn.dataset.editingHidden;
  });
}

function _dbCancelCellInlineEditors(td) {
  if (!td || !td.querySelectorAll) return;
  td.querySelectorAll('.cell-inline-input,.cell-inline-select,.cell-inline-dd,.cell-date-toggle,.cell-date-editor').forEach(_dbRemoveNodeIfAttached);
  td.querySelectorAll('.entity-rename-input').forEach(inp => {
    const host = inp.closest?.('td.col-entity') || td;
    const label = host?.querySelector?.('.entity-name-label');
    const moreBtn = host?.querySelector?.('.entity-row-more-btn');
    const relDiv = host?.querySelector?.('.relation-links');
    if (label) label.style.display = '';
    if (moreBtn) moreBtn.style.display = '';
    if (relDiv) relDiv.style.display = '';
    _dbRemoveNodeIfAttached(inp);
  });
  td.querySelectorAll('.cell-add-btn[data-editing-hidden]').forEach(btn => {
    btn.style.display = '';
    delete btn.dataset.editingHidden;
  });
}

function _dbDeactivateActiveCell(cell) {
  if (!cell) return;
  _dbRestoreCellAddButtonsIfIdle(cell);
  cell.classList?.remove('active-cell');
  delete cell.dataset.dbActiveSeq;
  if (cell.tabIndex === 0) cell.tabIndex = -1;
}

function _dbCurrentVisualActiveCell() {
  const focused = document.activeElement?.closest?.('td.col-entity,td[data-prop-name]');
  if (focused?.isConnected && focused.classList.contains('active-cell')) return focused;
  const visual = Array.from(document.querySelectorAll('td.active-cell'))
    .filter(cell => cell?.isConnected)
    .sort((a, b) => Number(b.dataset.dbActiveSeq || 0) - Number(a.dataset.dbActiveSeq || 0))[0];
  if (visual?.isConnected) return visual;
  if (activeCell?.isConnected && activeCell.classList?.contains('active-cell')) return activeCell;
  return visual?.isConnected ? visual : null;
}

function setActiveCell(td, options = {}) {
  const table = td?.closest?.('table') || activeCell?.closest?.('table') || null;
  if (!options.preserveRange) {
    _clearDbCellRangeSelection(table);
    rangeAnchorCell = null;
  }
  const previous = activeCell;
  if (previous) _dbDeactivateActiveCell(previous);
  document.querySelectorAll('td.active-cell').forEach(cell => {
    if (cell !== td) _dbDeactivateActiveCell(cell);
  });
  activeCell = td;
  if (td) {
    _dbRestoreCellAddButtonsIfIdle(td);
    td.classList.add('active-cell');
    td.dataset.dbActiveSeq = String(++dbActiveCellSeq);
    td.tabIndex = 0;
    td.focus?.({ preventScroll: true });
    try {
      window.__meldexLastSetActiveCell = {
        propName: td.dataset?.propName || '',
        entityName: td.closest?.('tr')?.dataset?.entityName || '',
        seq: td.dataset.dbActiveSeq || '',
        stack: (new Error()).stack || '',
      };
    } catch {}
    if (options.scroll !== false) {
      _scrollDbActiveCellIntoView(td);
      _scheduleDbActiveCellScroll(td);
    }
  }
  _scheduleDbCellBulkBarUpdate(table);
}

function _dbContextForCell(cell) {
  if (typeof _dbPaneContextFromEvent === 'function') {
    return _dbPaneContextFromEvent(cell, { dbPath: state.currentDbPath });
  }
  return typeof _currentPaneState === 'function' ? _currentPaneState() : null;
}

function _dbCellEntityAndProp(td) {
  const entityName = td?.closest?.('tr')?.dataset?.entityName || '';
  const propName = td?.dataset?.propName || '';
  return { entityName, propName };
}

function _dbCellPrimaryValue(td, ctx) {
  const { entityName, propName } = _dbCellEntityAndProp(td);
  const data = (ctx && ctx.pivotData) || state.pivotData;
  const values = data?.entities?.[entityName]?.[propName] || [];
  const filtered = typeof filterValues === 'function' ? filterValues(values) : values;
  return filtered?.[0] || null;
}

function _dbCellPropertyType(td, ctx) {
  const propName = td?.dataset?.propName || '';
  const dbPath = (ctx && ctx.dbPath) || state.currentDbPath || '';
  if (!propName || !dbPath || typeof getPropertyTypes !== 'function') return null;
  const ptc = getPropertyTypes(dbPath)?.[propName] || null;
  return ptc?.type ? { ...ptc, type: String(ptc.type).replace(/_/g, '-') } : ptc;
}

function _dbCellUsesPickerEditor(ptc) {
  const type = String(ptc?.type || '').replace(/_/g, '-');
  return !!ptc && ['select', 'multi-select', 'common-tags', 'relation', 'multi-relation', 'user', 'multi-user', 'link'].includes(type);
}

function _dbCellHasAnyValue(td, ctx) {
  const value = _dbCellPrimaryValue(td, ctx);
  if (value && String(value.value ?? '').trim() !== '') return true;
  const container = td?.querySelector?.('.cell-values');
  if (!container) return false;
  return !!container.querySelector('.cell-value,.value-text,.value-url,.cell-select-val,.multi-select-tag,.relation-link,.multi-select-tags,.cell-checkbox,.gb-image-thumb');
}

function _dbOpenExistingCellValueEditor(td, ctx) {
  const target = td?.querySelector?.('.cell-select-val,.relation-link,.multi-select-tags,.user-chip,.value-text,.value-url');
  if (!target) return false;
  target.click();
  return true;
}

function _dbOpenExistingCellValueEditorFromData(td, ctx) {
  const ptc = _dbCellPropertyType(td, ctx);
  const value = _dbCellPrimaryValue(td, ctx);
  if (!ptc || !value) return _dbOpenExistingCellValueEditor(td, ctx);
  const { entityName, propName } = _dbCellEntityAndProp(td);
  const dbPath = (ctx && ctx.dbPath) || state.currentDbPath || '';
  const entityPath = typeof _entityPath === 'function'
    ? _entityPath(dbPath, entityName, (ctx && ctx.pivotData) || state.pivotData)
    : `${dbPath}/${entityName}.md`;
  const type = String(ptc.type || '').replace(/_/g, '-');
  if ((type === 'select' || type === 'multi-select' || type === 'link') && typeof startCellInlineAdd === 'function') {
    startCellInlineAdd(td, entityPath, entityName, propName);
    return true;
  }
  if ((type === 'relation' || type === 'multi-relation') && typeof _showRelationDropdown === 'function') {
    _showRelationDropdown(td, value, entityPath, propName, { ...ptc, type, __sourceDbPath: dbPath }, type === 'multi-relation');
    return true;
  }
  return _dbOpenExistingCellValueEditor(td, ctx);
}

function _dbStartCellInlineEditor(td, options = {}) {
  if (!td || td.classList?.contains('col-entity')) return false;
  // 編集開始を新しいフォーカス所有権として記録する。直前の非同期保存が遅れて
  // 同じセルを復元しても、この編集や続くTab移動を上書きしないようにする。
  if (typeof setActiveCell === 'function') setActiveCell(td, { scroll: false });
  const ctx = typeof _dbPaneContextFromEvent === 'function'
    ? _dbPaneContextFromEvent(td, { dbPath: state.currentDbPath })
    : (typeof _currentPaneState === 'function' ? _currentPaneState() : null);
  const tr = td.closest?.('tr');
  const entityName = tr?.dataset?.entityName || tr?.querySelector?.('.entity-name-label')?.textContent || '';
  const propName = td.dataset?.propName || '';
  const dbPath = (ctx && ctx.dbPath) || state.currentDbPath || '';
  if (!entityName || !propName || !dbPath || typeof startCellInlineAdd !== 'function') return false;
  const ptc = _dbCellPropertyType(td, ctx);
  const hasValue = _dbCellHasAnyValue(td, ctx);
  if (options.preferExistingValue && hasValue && _dbOpenExistingCellValueEditorFromData(td, ctx)) return true;
  const entityPath = typeof _entityPath === 'function'
    ? _entityPath(dbPath, entityName, (ctx && ctx.pivotData) || state.pivotData)
    : `${dbPath}/${entityName}.md`;
  startCellInlineAdd(td, entityPath, entityName, propName);
  return true;
}

function _dbIsNativeEditingElement(el) {
  return !!(el && el.isConnected !== false && (
    el.contentEditable === 'true' ||
    el.tagName === 'INPUT' ||
    el.tagName === 'TEXTAREA' ||
    el.tagName === 'SELECT'
  ));
}

function _dbIsInternalRangePasteShortcut(e) {
  return (e.ctrlKey || e.metaKey) && !e.altKey && String(e.key || '').toLowerCase() === 'v'
    && _dbHasInternalCellClipboard()
    && Array.isArray(dbCellClipboard.cells) && dbCellClipboard.cells.length > 1;
}

function _dbActiveNativeEditingCell() {
  const el = document.activeElement;
  if (!_dbIsNativeEditingElement(el)) return null;
  return el.closest?.('td.col-entity,td[data-prop-name]') || null;
}

function _dbActiveNativeElementInTransientUi() {
  const el = document.activeElement;
  return !!(_dbIsNativeEditingElement(el) && el.closest?.('.status-dropdown,.cell-inline-dd,.user-dropdown,.gb-context-menu'));
}

function _dbShortcutEventCell(e) {
  return e?.target?.closest?.('td.col-entity,td[data-prop-name]') || null;
}

function _dbShouldRouteShortcutFromStaleNativeEditor(e) {
  const activeEl = document.activeElement;
  if (!_dbIsNativeEditingElement(activeEl) || _dbActiveNativeElementInTransientUi()) return false;
  const editingCell = _dbActiveNativeEditingCell();
  const eventCell = _dbShortcutEventCell(e);
  if (!editingCell || !eventCell || editingCell === eventCell || e.target === activeEl) return false;
  const key = String(e.key || '');
  const isNavigationKey = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab', 'Enter', 'F2'].includes(key);
  if (!isNavigationKey) return false;
  if (activeEl.classList?.contains('entity-rename-input')) {
    const currentName = editingCell.closest?.('tr')?.dataset?.entityName || '';
    if (activeEl.value.trim() !== currentName) return false;
  }
  return true;
}

function _dbCancelStaleNativeEditorForSheetShortcut(e) {
  if (!_dbShouldRouteShortcutFromStaleNativeEditor(e)) return false;
  const editingCell = _dbActiveNativeEditingCell();
  const eventCell = _dbShortcutEventCell(e);
  if (editingCell) _dbCancelCellInlineEditors(editingCell);
  if (eventCell) setActiveCell(eventCell, { preserveRange: true, scroll: false });
  return true;
}

function _dbShouldBypassNativeEditorForSheetShortcut(e) {
  const editingCell = _dbActiveNativeEditingCell();
  if (!editingCell) return false;
  if (_dbIsInternalRangePasteShortcut(e)) return true;
  const key = String(e.key || '').toLowerCase();
  const isCopy = (e.ctrlKey || e.metaKey) && !e.altKey && key === 'c';
  const isDelete = (e.key === 'Delete' || e.key === 'Backspace') && !e.ctrlKey && !e.metaKey && !e.altKey;
  if (!isCopy && !isDelete) return false;
  const table = _dbRangeSelectionTable() || editingCell.closest?.('table');
  return !!(table && _dbSelectedDataCells(table, true).length > 1);
}

function _dbCancelNativeEditorForSheetShortcut(e) {
  if (!_dbShouldBypassNativeEditorForSheetShortcut(e)) return false;
  const editingCell = _dbActiveNativeEditingCell();
  if (editingCell) {
    _dbCancelCellInlineEditors(editingCell);
    setActiveCell(editingCell, { preserveRange: true, scroll: false });
  }
  return true;
}

function _dbShortcutShouldCloseTransientUi(e) {
  if (!e) return false;
  // ドロップダウンの検索・新規値入力欄やメニュー内のリネーム入力にフォーカスがある間は、
  // Delete/Backspace/Ctrl+C/V をネイティブのテキスト編集として扱い、ポップアップを閉じない。
  const _ae = document.activeElement;
  if (_ae && _dbIsNativeEditingElement(_ae) && _dbActiveNativeElementInTransientUi()) return false;
  const isInternalRangePaste = _dbIsInternalRangePasteShortcut(e);
  if (_dbIsNativeEditingElement(document.activeElement) && !_dbActiveNativeElementInTransientUi() && !isInternalRangePaste && !_dbShouldBypassNativeEditorForSheetShortcut(e)) return false;
  if ((e.ctrlKey || e.metaKey) && !e.altKey && ['c', 'v'].includes(String(e.key || '').toLowerCase())) return true;
  return (e.key === 'Delete' || e.key === 'Backspace') && !e.ctrlKey && !e.metaKey && !e.altKey;
}

function _dbBlockForTransientUi(e) {
  const transient = Array.from(document.querySelectorAll('.status-dropdown, .cell-inline-dd, .user-dropdown, .gb-context-menu'));
  if (!transient.length) return false;
  if (!_dbShortcutShouldCloseTransientUi(e)) return true;
  transient.forEach(_dbRemoveNodeIfAttached);
  document.querySelectorAll('.cell-add-btn[data-editing-hidden]').forEach(btn => {
    btn.style.display = '';
    delete btn.dataset.editingHidden;
  });
  return false;
}
function _dbRangeSelectionTable() {
  const selectedCell = Array.from(document.querySelectorAll('tbody td.db-range-selected[data-prop-name]'))
    .find(cell => cell?.isConnected);
  return selectedCell?.closest?.('table') || null;
}

function _dbKeyboardActiveTable(options = {}) {
  const selectedTable = _dbRangeSelectionTable();
  if (options.preferSelection && selectedTable) return selectedTable;
  const visualCell = _dbCurrentVisualActiveCell();
  const focusedTable = document.activeElement?.closest?.('table');
  const selectedCell = document.querySelector('tbody td.db-range-selected[data-prop-name]');
  if (state.view !== 'pivot' && !activeCell?.closest?.('table') && !visualCell?.closest?.('table') && !selectedCell?.closest?.('table')) return null;
  let table = visualCell?.closest?.('table') || focusedTable || activeCell?.closest?.('table') || selectedCell?.closest?.('table') || _currentPivotTable();
  if (table && !table.isConnected) table = _currentPivotTable();
  return table || null;
}

function _dbKeyboardActiveCell(table, eventTarget = null) {
  const visual = _dbCurrentVisualActiveCell();
  if (visual && (!table || table.contains(visual))) return visual;
  const eventCell = eventTarget?.closest?.('td.col-entity,td[data-prop-name]');
  if (eventCell && table?.contains?.(eventCell)) return eventCell;
  const focused = document.activeElement?.closest?.('td.col-entity,td[data-prop-name]');
  if (focused && table?.contains?.(focused)) return focused;
  const selected = table?.querySelector?.('tbody td.db-range-selected[data-prop-name]');
  if (selected) return selected;
  return activeCell && table?.contains?.(activeCell) ? activeCell : null;
}

function _dbVisibleDataRows(table) {
  return Array.from(table?.querySelectorAll?.('tbody tr:not(.new-entity-row):not(.new-entity-spacer-row):not(.db-virtual-spacer-row):not(.group-header-row)') || [])
    .filter(row => {
      if (!row?.isConnected) return false;
      const style = typeof getComputedStyle === 'function' ? getComputedStyle(row) : null;
      return !style || (style.display !== 'none' && style.visibility !== 'hidden' && style.visibility !== 'collapse');
    });
}

function _dbHandleCellEditorKey(e, colIdx, targetCell) {
  if (typeof _dbInlineIsComposing === 'function' && _dbInlineIsComposing(e)) return false;
  const cell = targetCell || activeCell;
  // 行先頭コントロール列（常に colIdx 0）は対象外。エントリ名列は位置に関わらずクラスで判定する
  // （フェーズ2でエントリ名列も並べ替え可能になり、colIdx が固定でなくなったため）。
  if (!cell || colIdx < DB_ROW_CONTROLS_COL_COUNT || cell.classList.contains('col-entity')) return false;
  if ((e.key === 'Enter' || e.key === 'F2') && !e.ctrlKey && !e.metaKey && !e.altKey) {
    e.preventDefault();
    _dbStartCellInlineEditor(cell, { preferExistingValue: true });
    return true;
  }
  if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
    const ctx = typeof _dbContextForCell === 'function' ? _dbContextForCell(cell) : null;
    const type = String(_dbCellPropertyType(cell, ctx)?.type || '').replace(/_/g, '-');
    if (type === 'select' || type === 'multi-select') {
      e.preventDefault();
      _dbStartCellInlineEditor(cell, { preferExistingValue: true });
      return true;
    }
  }
  return false;
}
function _dbCellClipboardValue(td, ctx) {
  const value = _dbCellPrimaryValue(td, ctx);
  if (value && value.value != null) return String(value.value);
  return '';
}

function _dbMakeClipboardFromCells(table, cells, ctx) {
  const coords = cells.map(cell => ({ cell, coords: _dbCellCoords(table, cell) })).filter(item => item.coords);
  if (!coords.length) return null;
  const minRow = Math.min(...coords.map(item => item.coords.row));
  const minCol = Math.min(...coords.map(item => item.coords.col));
  const payloadCells = coords.map(({ cell, coords }) => {
    const valueRef = _dbCellPrimaryValue(cell, ctx);
    return {
      rowOffset: coords.row - minRow,
      colOffset: coords.col - minCol,
      propName: cell.dataset.propName || '',
      value: valueRef && valueRef.value != null ? String(valueRef.value) : _dbCellClipboardValue(cell, ctx),
      status: valueRef?.status || '採用',
      note: valueRef?.note || '',
    };
  });
  const rowCount = Math.max(...payloadCells.map(cell => cell.rowOffset)) + 1;
  const colCount = Math.max(...payloadCells.map(cell => cell.colOffset)) + 1;
  const rows = Array.from({ length: rowCount }, () => Array.from({ length: colCount }, () => ''));
  payloadCells.forEach(cell => { rows[cell.rowOffset][cell.colOffset] = cell.value; });
  return { cells: payloadCells, rowCount, colCount, text: rows.map(row => row.join('\t')).join('\n') };
}

async function _dbCopySelectedCells(table) {
  const ctx = _dbContextForCell(activeCell || table);
  const cells = _dbSelectedDataCells(table, true);
  const clipboard = _dbMakeClipboardFromCells(table, cells, ctx);
  if (!clipboard) return false;
  dbCellClipboard = clipboard;
  dbCellClipboardAt = Date.now();
  try {
    await navigator.clipboard?.writeText?.(clipboard.text);
  } catch {}
  if (typeof showStatus === 'function') showStatus(`${clipboard.cells.length} 件のセルをコピーしました`);
  return true;
}

function _dbClipboardFromText(text, propName) {
  const lines = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  while (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  const rows = lines.map(line => String(line).split('\t'));
  const colCount = Math.max(1, ...rows.map(row => row.length));
  const cells = [];
  rows.forEach((row, rowOffset) => {
    for (let colOffset = 0; colOffset < colCount; colOffset += 1) {
      cells.push({
        rowOffset,
        colOffset,
        propName,
        value: row[colOffset] || '',
        status: '採用',
        note: '',
      });
    }
  });
  return { cells, rowCount: rows.length, colCount, text: rows.map(row => {
    const normalized = [...row];
    while (normalized.length < colCount) normalized.push('');
    return normalized.join('\t');
  }).join('\n') };
}

function _dbCellAllowsPaste(td, ctx) {
  const dbPath = (ctx && ctx.dbPath) || state.currentDbPath || '';
  const propName = td?.dataset?.propName || '';
  const ptc = dbPath && propName && typeof getPropertyTypes === 'function' ? getPropertyTypes(dbPath)[propName] : null;
  if (!td || !propName || ptc?.source) return false;
  if (ptc && ['formula', 'rollup', 'button', 'multi-source-relation', 'chat'].includes(ptc.type)) return false;
  return !(typeof checkColumnEditable === 'function' && checkColumnEditable(dbPath, propName));
}

function _dbSnapshotCellValues(entityData, propName) {
  return Array.isArray(entityData?.[propName])
    ? entityData[propName].map(v => ({ ...v }))
    : [];
}

function _dbRestoreCellValues(entityData, propName, snapshot) {
  if (!entityData || !propName) return;
  entityData[propName] = (snapshot || []).map(v => ({ ...v }));
}

function _dbRefreshClipboardTargetCell(td, entityPath, propName, ctx) {
  const dbPath = (ctx && ctx.dbPath) || state.currentDbPath || '';
  const ptc = dbPath && propName && typeof getPropertyTypes === 'function' ? getPropertyTypes(dbPath)[propName] : null;
  if (typeof _refreshPivotRelationCell === 'function'
      && _refreshPivotRelationCell(td, entityPath, propName, ptc, { dbPath, ctx })) {
    if (typeof _refreshDerivedCellsInRow === 'function') {
      _refreshDerivedCellsInRow(td, entityPath, { dbPath, ctx });
    }
    return true;
  }
  return typeof _tryRefreshPivotCellLocal === 'function'
    && _tryRefreshPivotCellLocal(td, entityPath, propName, { dbPath, ctx });
}

function _dbCanPersistCellValueRef(valueRef) {
  const file = String(valueRef?.file || '').trim().replace(/\\/g, '/').toLowerCase();
  return !!file && file.endsWith('.md');
}

async function _dbDeleteValueRef(valueRef, propName) {
  if (!valueRef?.file) return;
  const ref = { ...valueRef, property: valueRef.property || propName };
  if (!_dbCanPersistCellValueRef(ref)) return;
  if (ref.candidate_index != null) {
    await _apiPutValue(ref, { _delete: true });
  } else {
    await apiPost('/outliner/delete', { path: ref.file });
  }
}

function _dbDeleteOrderForCellSnapshot(snapshot) {
  return [...(snapshot || [])].sort((a, b) => {
    const af = a?.file || '';
    const bf = b?.file || '';
    const ap = a?.property || '';
    const bp = b?.property || '';
    if (af !== bf) return af.localeCompare(bf);
    if (ap !== bp) return ap.localeCompare(bp);
    const ai = Number.isInteger(a?.candidate_index) ? a.candidate_index : -1;
    const bi = Number.isInteger(b?.candidate_index) ? b.candidate_index : -1;
    return bi - ai;
  });
}

function _dbCellMutationGroupKey(target, ctx) {
  const td = target?.target || target;
  const { entityName } = _dbCellEntityAndProp(td);
  const dbPath = (ctx && ctx.dbPath) || state.currentDbPath || '';
  return `${dbPath}\n${entityName || ''}`;
}

// 一括セル保存で同時に飛ばす /api/value リクエスト数の上限。エントリ（行）が異なる
// セルは本来並列に保存できるが、無制限に並列化すると単一ライターのシート SQLite へ
// 書き込みが殺到し、ロック待ちが積み上がってかえって遅く・タイムアウトしやすくなる。
const DB_CELL_SAVE_CONCURRENCY = 3;

// items を最大 limit 並列で worker に通し、結果を元の順序で返す簡易プール。
async function _dbRunWithConcurrencyLimit(items, limit, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;
  async function runner() {
    while (true) {
      const current = nextIndex++;
      if (current >= items.length) return;
      results[current] = await worker(items[current], current);
    }
  }
  const poolSize = Math.min(Math.max(1, limit), items.length);
  const runners = [];
  for (let i = 0; i < poolSize; i++) runners.push(runner());
  await Promise.all(runners);
  return results;
}

async function _dbRunCellMutationsByEntity(targets, ctx, mutate) {
  const groups = new Map();
  (targets || []).forEach(item => {
    const key = _dbCellMutationGroupKey(item, ctx);

    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  });
  // 群（同一エントリ）内は従来どおり直列。群どうしは並列だが同時実行数を上限で平準化する。
  const groupedResults = await _dbRunWithConcurrencyLimit(
    Array.from(groups.values()),
    DB_CELL_SAVE_CONCURRENCY,
    async group => {
      const results = [];
      for (const item of group) {
        results.push(await mutate(item));
      }
      return results;
    },
  );
  return groupedResults.flat();
}

function _dbYieldCellBatchPaint() {
  return new Promise(resolve => {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => resolve());
    else setTimeout(resolve, 0);
  });
}

function _dbPrepareClearCellValues(td, ctx) {
  const { entityName, propName } = _dbCellEntityAndProp(td);
  const dbPath = (ctx && ctx.dbPath) || state.currentDbPath || '';
  const data = (ctx && ctx.pivotData) || state.pivotData;
  if (!entityName || !propName || !dbPath || !_dbCellAllowsPaste(td, ctx)) return null;
  const entityPath = typeof _entityPath === 'function' ? _entityPath(dbPath, entityName, data) : `${dbPath}/${entityName}.md`;
  const entityData = data?.entities?.[entityName];
  if (!entityData || !Array.isArray(entityData[propName]) || entityData[propName].length === 0) return null;
  const snapshot = _dbSnapshotCellValues(entityData, propName);
  entityData[propName] = [];
  const refreshed = _dbRefreshClipboardTargetCell(td, entityPath, propName, ctx);
  if (!refreshed && ctx) ctx._clipboardPasteNeedsRefresh = true;
  return {
    target: td,
    entityPath,
    propName,
    persist: async () => {
      for (const valueRef of _dbDeleteOrderForCellSnapshot(snapshot)) {
        await _dbDeleteValueRef(valueRef, propName);
      }
    },
    rollback: () => {
      _dbRestoreCellValues(entityData, propName, snapshot);
      _dbRefreshClipboardTargetCell(td, entityPath, propName, ctx);
    },
  };
}

async function _dbClearCellValues(td, ctx) {
  const op = _dbPrepareClearCellValues(td, ctx);
  if (!op) return false;
  try {
    await op.persist();
    return true;
  } catch (err) {
    op.rollback();
    throw err;
  }
}

function _dbPrepareWriteClipboardCellValue(td, value, ctx, meta = {}) {
  const { entityName, propName } = _dbCellEntityAndProp(td);
  const dbPath = (ctx && ctx.dbPath) || state.currentDbPath || '';
  const data = (ctx && ctx.pivotData) || state.pivotData;
  if (!entityName || !propName || !dbPath || !_dbCellAllowsPaste(td, ctx)) return null;
  const entityPath = typeof _entityPath === 'function' ? _entityPath(dbPath, entityName, data) : `${dbPath}/${entityName}.md`;
  const entityData = data?.entities?.[entityName];
  if (!entityData) return null;
  if (!Array.isArray(entityData[propName])) entityData[propName] = [];
  if (String(value ?? '') === '') return _dbPrepareClearCellValues(td, ctx);
  const snapshot = _dbSnapshotCellValues(entityData, propName);
  const existing = _dbCellPrimaryValue(td, ctx);
  const existingRef = existing ? { ...existing, property: existing.property || propName } : null;
  const status = meta.status || existing?.status || '採用';
  const note = meta.note || existing?.note || '';
  let localValue = null;
  if (typeof _upsertLocalPivotValue === 'function') {
    localValue = _upsertLocalPivotValue(entityPath, propName, existing, value, {
      file: existing?.file || '',
      property: propName,
      candidate_index: existing?.candidate_index,
      status,
      note,
    }, ctx);
  } else if (existing) {
    existing.value = value;
    existing.status = status;
    existing.note = note;
    localValue = existing;
  } else {
    localValue = { property: propName, value, status, note, file: '', candidate_index: null };
    entityData[propName].push(localValue);
  }
  const refreshed = _dbRefreshClipboardTargetCell(td, entityPath, propName, ctx);
  if (!refreshed && ctx) ctx._clipboardPasteNeedsRefresh = true;
  return {
    target: td,
    entityPath,
    propName,
    persist: async () => {
      if (existing && _dbCanPersistCellValueRef(existingRef)) {
        await _apiPutValue(existingRef, { new_value: value });
        existing.value = value;
        existing.property = propName;
        if (existingRef?.file) existing.file = existingRef.file;
        if (existingRef?.candidate_index !== undefined) existing.candidate_index = existingRef.candidate_index;
        delete existing.rich_html;
        if (localValue && localValue !== existing) {
          localValue.file = existing.file;
          localValue.candidate_index = existing.candidate_index;
        }
        _dbRefreshClipboardTargetCell(td, entityPath, propName, ctx);
        return;
      }
      const result = await _apiPostValue(entityPath, propName, value, status, note);
      if (localValue) {
        localValue.file = result?.path || entityPath;
        localValue.candidate_index = result?.candidate_index;
        localValue.property = propName;
      }
      _dbRefreshClipboardTargetCell(td, entityPath, propName, ctx);
    },
    rollback: () => {
      _dbRestoreCellValues(entityData, propName, snapshot);
      _dbRefreshClipboardTargetCell(td, entityPath, propName, ctx);
    },
  };
}

async function _dbWriteClipboardCellValue(td, value, ctx, meta = {}) {
  const op = _dbPrepareWriteClipboardCellValue(td, value, ctx, meta);
  if (!op) return false;
  try {
    await op.persist();
    return true;
  } catch (err) {
    op.rollback();
    throw err;
  }
}

async function _dbPersistPreparedCellMutations(ops, ctx, debug) {
  return _dbRunCellMutationsByEntity(ops, ctx, async op => {
    try {
      await op.persist();
      return 1;
    } catch (err) {
      try { op.rollback(); } catch {}
      if (debug?.errors) {
        debug.errors.push({
          target: _dbCellPasteDebugRef(op.target),
          message: err?.message || String(err || ''),
        });
      }
      return -1;
    }
  });
}

function _dbPasteTargetsFromClipboard(table, startCell, clipboard) {
  const start = _dbCellCoords(table, startCell);
  if (!start || !clipboard?.cells?.length) return [];
  return clipboard.cells.map(src => {
    const target = _dbCellAt(table, start.row + src.rowOffset, start.col + src.colOffset);
    if (!target || !target.dataset?.propName) return null;
    return { target, value: src.value, status: src.status, note: src.note };
  }).filter(Boolean);
}

function _dbCellPasteDebugRef(td) {
  if (!td) return null;
  return {
    entityName: td.closest?.('tr')?.dataset?.entityName || '',
    propName: td.dataset?.propName || '',
    text: td.textContent || '',
  };
}

function _dbRecordCellPasteKeydownDebug(phase, e, table, keyCell, extra = {}) {
  try {
    window.__meldexLastCellPasteKeydownDebug = {
      phase,
      defaultPrevented: !!e?.defaultPrevented,
      key: e?.key || '',
      target: _dbCellPasteDebugRef(e?.target?.closest?.('td.col-entity,td[data-prop-name]')),
      keyCell: _dbCellPasteDebugRef(keyCell),
      visualCell: _dbCellPasteDebugRef(_dbCurrentVisualActiveCell()),
      activeCell: _dbCellPasteDebugRef(activeCell),
      focusedCell: _dbCellPasteDebugRef(document.activeElement?.closest?.('td.col-entity,td[data-prop-name]')),
      tableFound: !!table,
      ...extra,
    };
  } catch {}
}

async function _dbPasteClipboardCells(table, startCellOverride = null) {
  const visualStartCell = _dbCurrentVisualActiveCell();
  const pasteStartCell = startCellOverride?.dataset?.propName
    ? startCellOverride
    : (visualStartCell?.dataset?.propName ? visualStartCell : activeCell);
  if (!pasteStartCell?.dataset?.propName || !table) return false;
  if (pasteStartCell !== activeCell) setActiveCell(pasteStartCell, { preserveRange: true, scroll: false });
  const ctx = _dbContextForCell(pasteStartCell);
  const activePos = _dbCellEntityAndProp(pasteStartCell);
  let clipboard = dbCellClipboard;
  let systemText = '';
  const preferInternalClipboard = _dbHasInternalCellClipboard();
  if (!preferInternalClipboard) {
    try { systemText = await navigator.clipboard?.readText?.() || ''; } catch {}
  }
  if (systemText && !preferInternalClipboard && (!clipboard || systemText !== clipboard.text)) {
    clipboard = _dbClipboardFromText(systemText, pasteStartCell.dataset.propName);
  }
  if (!clipboard && !systemText) return false;
  if (!clipboard) {
    clipboard = _dbClipboardFromText(systemText, pasteStartCell.dataset.propName);
  }
  const selected = _dbSelectedDataCells(table, false);
  let targets = [];
  if (clipboard?.cells?.length === 1 && selected.length > 1) {
    targets = selected.map(target => ({
      target,
      value: clipboard.cells[0].value,
      status: clipboard.cells[0].status,
      note: clipboard.cells[0].note,
    }));
  } else {
    targets = _dbPasteTargetsFromClipboard(table, pasteStartCell, clipboard);
  }
  const pasteDebug = {
    startedAt: Date.now(),
    startCell: _dbCellPasteDebugRef(pasteStartCell),
    clipboardCells: Array.isArray(clipboard?.cells) ? clipboard.cells.map(cell => ({
      rowOffset: cell.rowOffset,
      colOffset: cell.colOffset,
      propName: cell.propName || '',
      value: cell.value || '',
      status: cell.status || '',
    })) : [],
    rawTargets: targets.map(item => ({ target: _dbCellPasteDebugRef(item.target), value: item.value || '', status: item.status || '' })),
    allowedTargets: [],
    written: 0,
    errors: [],
  };
  targets = targets.filter(item => _dbCellAllowsPaste(item.target, ctx));
  pasteDebug.allowedTargets = targets.map(item => ({ target: _dbCellPasteDebugRef(item.target), value: item.value || '', status: item.status || '' }));
  try { window.__meldexLastCellPasteDebug = pasteDebug; } catch {}
  if (!targets.length) {
    if (typeof showStatus === 'function') showStatus('貼り付けできるセルがありません', true);
    return false;
  }
  const ops = [];
  for (const item of targets) {
    try {
      const op = _dbPrepareWriteClipboardCellValue(item.target, item.value, ctx, item);
      if (op) ops.push(op);
    } catch (err) {
      pasteDebug.errors.push({
        target: _dbCellPasteDebugRef(item.target),
        message: err?.message || String(err || ''),
      });
    }
  }
  const written = ops.length;
  pasteDebug.written = written;
  const dbPath = (ctx && ctx.dbPath) || state.currentDbPath || '';
  const needsRefresh = !!ctx?._clipboardPasteNeedsRefresh;
  if (ctx) delete ctx._clipboardPasteNeedsRefresh;
  if (!needsRefresh) {
    setActiveCell(pasteStartCell, { preserveRange: true, scroll: false });
  }
  await _dbYieldCellBatchPaint();
  const saveResults = await _dbPersistPreparedCellMutations(ops, ctx, pasteDebug);
  const failed = saveResults.filter(value => value < 0).length;
  if (needsRefresh && dbPath && typeof selectDatabase === 'function') {
    selectDatabase(dbPath, ctx, { silent: true })
      .then(() => {
        if (typeof _restoreCellPos === 'function') _restoreCellPos(activePos, null);
      })
      .catch(() => {});
  }
  if (typeof showStatus === 'function') {
    showStatus(`${written - failed} 件のセルに貼り付けました${failed > 0 ? '（失敗 ' + failed + ' 件）' : ''}`, failed > 0);
  }
  return written > 0;
}

async function _dbClearSelectedCells(table) {
  const selected = _dbSelectedDataCells(table, true);
  if (!selected.length) return false;
  const ctx = _dbContextForCell(activeCell || selected[0] || table);
  const targets = selected.filter(cell => _dbCellAllowsPaste(cell, ctx));
  if (!targets.length) {
    if (typeof showStatus === 'function') showStatus('削除できるセルがありません', true);
    return false;
  }
  const ops = [];
  for (const target of targets) {
    try {
      const op = _dbPrepareClearCellValues(target, ctx);
      if (op) ops.push(op);
    } catch {
      // ローカル準備に失敗したセルは保存対象に含めない
    }
  }
  const cleared = ops.length;
  const dbPath = (ctx && ctx.dbPath) || state.currentDbPath || '';
  const needsRefresh = !!ctx?._clipboardPasteNeedsRefresh;
  if (ctx) delete ctx._clipboardPasteNeedsRefresh;
  await _dbYieldCellBatchPaint();
  const clearResults = await _dbPersistPreparedCellMutations(ops, ctx, null);
  const failed = clearResults.filter(value => value < 0).length;
  if (needsRefresh && dbPath && typeof selectDatabase === 'function') {
    selectDatabase(dbPath, ctx, { silent: true }).catch(() => {});
  }
  if (typeof showStatus === 'function') {
    showStatus(`${cleared - failed} 件のセルを削除しました${failed > 0 ? '（失敗 ' + failed + ' 件）' : ''}`, failed > 0);
  }
  return cleared > 0;
}

document.addEventListener('keydown', (e) => {
  if (typeof _dbInlineIsComposing === 'function' && _dbInlineIsComposing(e)) {
    // IMEへ既定動作は渡したまま、シート内外のキー処理へ伝播させない。
    e.stopPropagation();
    e.stopImmediatePropagation?.();
    return;
  }
  if (typeof _dbInlineConsumeImeBoundaryKey === 'function' && _dbInlineConsumeImeBoundaryKey(e)) return;
  const bypassNativeSheetShortcut = _dbShouldBypassNativeEditorForSheetShortcut(e);
  const nativeInTransientUi = _dbActiveNativeElementInTransientUi();
  const routedStaleNativeEditor = _dbCancelStaleNativeEditorForSheetShortcut(e);
  if (_dbIsNativeEditingElement(document.activeElement) && !nativeInTransientUi && !bypassNativeSheetShortcut && !routedStaleNativeEditor) return;
  if (_dbBlockForTransientUi(e)) return;
  if (bypassNativeSheetShortcut) _dbCancelNativeEditorForSheetShortcut(e);
  if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'v' && _dbHasInternalCellClipboard()) {
    const table = _dbKeyboardActiveTable();
    const keyCell = _dbKeyboardActiveCell(table, e.target);
    _dbRecordCellPasteKeydownDebug('inline-priority', e, table, keyCell);
    if (table && keyCell?.dataset?.propName) {
      e.preventDefault();
      if (keyCell !== activeCell) setActiveCell(keyCell, { preserveRange: true, scroll: false });
      try {
        _dbCancelCellInlineEditors(keyCell);
      } catch (err) {
        _dbRecordCellPasteKeydownDebug('inline-priority-cancel-editor-error', e, table, keyCell, {
          error: err?.message || String(err || ''),
        });
      }
      const pastePromise = _dbPasteClipboardCells(table, keyCell);
      _dbRecordCellPasteKeydownDebug('inline-priority-dispatched', e, table, keyCell, {
        pastePromise: !!pastePromise,
      });
      pastePromise.catch((err) => {
        _dbRecordCellPasteKeydownDebug('inline-priority-error', e, table, keyCell, {
          error: err?.message || String(err || ''),
        });
        if (typeof showStatus === 'function') showStatus('セルの貼り付けに失敗しました', true);
      });
      return;
    }
  }
  if (e.defaultPrevented) return;
  const table = _dbKeyboardActiveTable();
  const keyCell = _dbKeyboardActiveCell(table, e.target);
  if (!table || !keyCell) return;
  if (keyCell !== activeCell) setActiveCell(keyCell, { preserveRange: true, scroll: false });
  const tr = keyCell.parentElement;
  if (!tr || !table.contains(tr)) return;
  const colIdx = Array.from(tr.children).indexOf(keyCell);
  // エントリ名セルの Enter → インライン名称編集開始 (通常セルの Enter/F2 編集と対称)。
  // 既存の Enter 処理 (_dbHandleCellEditorKey) より前で分岐し、非該当時はそのまま下へ流す。
  if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey && !e.altKey && keyCell.classList.contains('col-entity')
      && typeof startEntityInlineRename === 'function') {
    e.preventDefault();
    const nameSpan = keyCell.querySelector('.entity-name-label');
    const oldName = nameSpan ? nameSpan.textContent : '';
    const renameCtx = typeof _dbPaneContextFromEvent === 'function'
      ? _dbPaneContextFromEvent(keyCell, { dbPath: state.currentDbPath })
      : (typeof _currentPaneState === 'function' ? _currentPaneState() : null);
    const dbPath = (renameCtx && renameCtx.dbPath) || state.currentDbPath || '';
    startEntityInlineRename(keyCell, nameSpan, oldName, dbPath);
    return;
  }
  _dbHandleCellEditorKey(e, colIdx, keyCell);
}, true);

// テーブルキーボードナビゲーション
// セル単位のキー操作。Enter/F2 は分割パネル中でもアクティブセルの型別エディタを直接開く。
// Ctrl+Enter / Ctrl+Shift+Enter などのコマンド系は gb-shortcuts.js に委譲する。
document.addEventListener('keydown', (e) => {
  const setNavDebug = (extra) => {
    try {
      window.__meldexLastSheetNavDebug = {
        key: e.key,
        phase: extra?.phase || '',
        reason: extra?.reason || '',
        ...extra,
      };
    } catch {}
  };
  if (e.defaultPrevented) return;
  if (typeof _dbInlineIsComposing === 'function' && _dbInlineIsComposing(e)) {
    e.stopPropagation();
    e.stopImmediatePropagation?.();
    return;
  }
  if (typeof _dbInlineConsumeImeBoundaryKey === 'function' && _dbInlineConsumeImeBoundaryKey(e)) return;
  // ドロップダウンやメニューが開いている場合はそちらのキーナビに任せる
  const nativeInTransientUi = _dbActiveNativeElementInTransientUi();
  const routedStaleNativeEditor = _dbCancelStaleNativeEditorForSheetShortcut(e);
  if (_dbIsNativeEditingElement(document.activeElement) && !nativeInTransientUi && !routedStaleNativeEditor) {
    setNavDebug({ phase: 'before-table', reason: 'native-editor-active', activeTag: document.activeElement?.tagName || '', activeClass: String(document.activeElement?.className || '') });
    return;
  }
  if (_dbBlockForTransientUi(e)) {
    setNavDebug({ phase: 'before-table', reason: 'transient-ui-blocked' });
    return;
  }
  const shortcutKey = String(e.key || '').toLowerCase();
  const preferSelectionTable = ((e.ctrlKey || e.metaKey) && !e.altKey && (shortcutKey === 'c' || shortcutKey === 'v'))
    || ((e.key === 'Delete' || e.key === 'Backspace') && !e.ctrlKey && !e.metaKey && !e.altKey);
  let table = _dbKeyboardActiveTable({ preferSelection: preferSelectionTable });
  if (state.view !== 'pivot' && !table) {
    setNavDebug({ phase: 'table', reason: 'not-pivot-no-table', view: state.view || '' });
    return;
  }
  if (!table) {
    setNavDebug({ phase: 'table', reason: 'no-table', view: state.view || '' });
    return;
  }
  let dataRows = _dbVisibleDataRows(table);

  let keyCell = _dbKeyboardActiveCell(table, e.target);
  if (!keyCell) {
    setNavDebug({ phase: 'cell', reason: 'no-key-cell', dataRowsLength: dataRows.length });
    if (dataRows.length > 0 && dataRows[0].children.length > DB_ROW_CONTROLS_COL_COUNT) {
      setActiveCell(dataRows[0].children[DB_ROW_CONTROLS_COL_COUNT]);
    }
    return;
  }
  if (keyCell !== activeCell) setActiveCell(keyCell, { preserveRange: true, scroll: false });

  const tr = keyCell.parentElement;
  const rowIdx = dataRows.indexOf(tr);
  if (rowIdx < 0) {
    setNavDebug({
      phase: 'row',
      reason: 'row-not-visible-data-row',
      dataRowsLength: dataRows.length,
      entityName: tr?.dataset?.entityName || '',
      propName: keyCell?.dataset?.propName || '',
    });
    activeCell = null;
    rangeAnchorCell = null;
    if (dataRows.length > 0 && dataRows[0].children.length > DB_ROW_CONTROLS_COL_COUNT) setActiveCell(dataRows[0].children[DB_ROW_CONTROLS_COL_COUNT]);
    return;
  }
  const cells = Array.from(tr.children);
  const colIdx = cells.indexOf(keyCell);
  const maxCol = cells.length - 2;
  const isLastRow = rowIdx === dataRows.length - 1;
  setNavDebug({
    phase: 'ready',
    rowIdx,
    colIdx,
    maxCol,
    isLastRow,
    dataRowsLength: dataRows.length,
    entityName: tr?.dataset?.entityName || '',
    propName: keyCell?.dataset?.propName || '',
  });

  if (_dbHandleCellEditorKey(e, colIdx, keyCell)) return;

  if (e.key === 'Escape' && _dbSelectedDataCells(table, true).length > 1) {
    e.preventDefault();
    _clearDbCellSelection(table);
    return;
  }

  if ((e.key === 'Delete' || e.key === 'Backspace') && !e.ctrlKey && !e.metaKey && !e.altKey) {
    const selectedForDelete = _dbSelectedDataCells(table, true);
    if (selectedForDelete.length > 0) {
      e.preventDefault();
      _dbClearSelectedCells(table).catch(() => {
        if (typeof showStatus === 'function') showStatus('セルの削除に失敗しました', true);
      });
      return;
    }
  }

  if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'c') {
    e.preventDefault();
    _dbCopySelectedCells(table).catch(() => {
      if (typeof showStatus === 'function') showStatus('セルのコピーに失敗しました', true);
    });
    return;
  }

  if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'v') {
    e.preventDefault();
    _dbRecordCellPasteKeydownDebug('navigation', e, table, keyCell);
    const pastePromise = _dbPasteClipboardCells(table, keyCell);
    _dbRecordCellPasteKeydownDebug('navigation-dispatched', e, table, keyCell, {
      pastePromise: !!pastePromise,
    });
    pastePromise.catch((err) => {
      _dbRecordCellPasteKeydownDebug('navigation-error', e, table, keyCell, {
        error: err?.message || String(err || ''),
      });
      if (typeof showStatus === 'function') showStatus('セルの貼り付けに失敗しました', true);
    });
    return;
  }

  if (e.shiftKey && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
    e.preventDefault();
    const anchor = rangeAnchorCell || keyCell;
    rangeAnchorCell = anchor;
    let targetRow = rowIdx;
    let targetCol = colIdx;
    if (e.key === 'ArrowUp') targetRow = e.ctrlKey || e.metaKey ? 0 : rowIdx - 1;
    else if (e.key === 'ArrowDown') targetRow = e.ctrlKey || e.metaKey ? dataRows.length - 1 : rowIdx + 1;
    else if (e.key === 'ArrowLeft') targetCol = e.ctrlKey || e.metaKey ? DB_ROW_CONTROLS_COL_COUNT : Math.max(DB_ROW_CONTROLS_COL_COUNT, colIdx - 1);
    else if (e.key === 'ArrowRight') targetCol = e.ctrlKey || e.metaKey ? maxCol : colIdx + 1;
    const targetCell = _dbCellAt(table, targetRow, targetCol);
    if (targetCell && !targetCell.classList.contains('col-add-prop-cell') && !targetCell.classList.contains('col-row-controls')) {
      setActiveCell(targetCell, { preserveRange: true });
      _markDbCellRange(table, anchor, targetCell);
    }
    return;
  }

  let nextRow = rowIdx, nextCol = colIdx;

  if (e.key === 'ArrowUp') {
    nextRow = Math.max(0, rowIdx - 1);
    e.preventDefault();
  }
  else if (e.key === 'ArrowDown') {
    if (isLastRow) {
      e.preventDefault();
      try {
        window.__meldexLastSheetNavDebug = {
          action: 'arrow-down-create',
          rowIdx,
          dataRowsLength: dataRows.length,
          entityName: tr?.dataset?.entityName || '',
          propName: keyCell?.dataset?.propName || '',
        };
      } catch {}
      triggerNewEntity(table, dataRows, colIdx);
      return;
    }
    nextRow = rowIdx + 1;
    e.preventDefault();
  }
  else if (e.key === 'ArrowLeft') { nextCol = Math.max(DB_ROW_CONTROLS_COL_COUNT, colIdx - 1); e.preventDefault(); }
  else if (e.key === 'ArrowRight') { nextCol = Math.min(maxCol, colIdx + 1); e.preventDefault(); }
  else if (e.key === 'Tab') {
    e.preventDefault();
    if (e.shiftKey) {
      nextCol = colIdx - 1;
      if (nextCol < DB_ROW_CONTROLS_COL_COUNT) { nextCol = maxCol; nextRow = rowIdx - 1; }
      nextRow = Math.max(0, nextRow);
    } else {
      nextCol = colIdx + 1;
      if (nextCol > maxCol) {
        // 行末で次の行へ折り返す際は、エントリ名列の位置に関わらず「最初のプロパティ列」へ移動する
        // （毎行エントリ名の位置で止まると Tab によるデータ連続入力の妨げになるため）。
        const firstPropCol = _dbFirstPropertyColIndex(tr);
        if (isLastRow) { triggerNewEntity(table, dataRows, firstPropCol); return; }
        nextCol = firstPropCol; nextRow = rowIdx + 1;
      }
    }
    nextRow = Math.min(dataRows.length - 1, nextRow);
  }
  else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) return;
  else return;

  rangeAnchorCell = null;
  _clearDbCellRangeSelection(table);
  const targetRow = dataRows[nextRow];
  if (targetRow) {
    const targetCell = targetRow.children[nextCol];
    if (targetCell && !targetCell.classList.contains('col-add-prop-cell') && !targetCell.classList.contains('col-row-controls')) setActiveCell(targetCell);
  }
}, true);

// エントリ名列がどこにあっても「最初のプロパティ列」の実DOM列インデックスを返す。
// プロパティセルは data-prop-name 属性を持つが、行先頭コントロール列・エントリ名列は持たない。
function _dbFirstPropertyColIndex(tr) {
  if (!tr) return DB_ROW_CONTROLS_COL_COUNT;
  const cells = Array.from(tr.children);
  const idx = cells.findIndex(td => td.hasAttribute('data-prop-name'));
  return idx >= 0 ? idx : DB_ROW_CONTROLS_COL_COUNT;
}

// 新規エントリ追加（キーボード用）
async function triggerNewEntity(table, dataRows, focusCol) {
  const ctx = typeof _dbPaneContextFromEvent === 'function'
    ? _dbPaneContextFromEvent(table, { dbPath: state.currentDbPath })
    : (typeof _currentPaneState === 'function' ? _currentPaneState() : null);
  const _db = (ctx && ctx.dbPath) || state.currentDbPath;
  if (!_db) return;
  const focusOwner = typeof _dbCurrentVisualActiveCell === 'function'
    ? _dbCurrentVisualActiveCell()
    : activeCell;
  const focusSeq = Number(focusOwner?.dataset?.dbActiveSeq || dbActiveCellSeq || 0);
  const focusOwnerKey = {
    entityName: focusOwner?.closest?.('tr')?.dataset?.entityName || '',
    propName: focusOwner?.dataset?.propName || '',
  };
  const shouldKeepCreateFocus = () => {
    const currentActive = typeof _dbCurrentVisualActiveCell === 'function'
      ? _dbCurrentVisualActiveCell()
      : activeCell;
    if (!currentActive?.isConnected) return false;
    const currentSeq = Number(currentActive?.dataset?.dbActiveSeq || 0);
    if (currentSeq > focusSeq && currentActive !== focusOwner) return false;
    if (focusOwner?.isConnected) return currentActive === focusOwner;
    return (currentActive.closest?.('tr')?.dataset?.entityName || '') === focusOwnerKey.entityName
      && (currentActive.dataset?.propName || '') === focusOwnerKey.propName;
  };
  const focusCreatedRow = (newRow, name, allowImmediate = false) => {
    if (!allowImmediate && !shouldKeepCreateFocus()) return;
    // エントリ名列は並べ替え可能で位置が固定でないため、クラスで探す（列インデックスに依存しない）。
    const entityTd = newRow.querySelector('.col-entity');
    const td = focusCol ? (newRow.children[focusCol] || entityTd) : entityTd;
    if (td) setActiveCell(td);
    if (!focusCol || td === entityTd) {
      const label = newRow.querySelector('.entity-name-label');
      if (label) startEntityInlineRename(td || entityTd, label, name, _db);
    }
  };
  if (typeof _dbCreateEntityOptimistic === 'function') {
    const visibleOrder = (Array.isArray(dataRows) ? dataRows : [])
      .map(row => row?.dataset?.entityName || '')
      .filter(Boolean);
    const created = _dbCreateEntityOptimistic(ctx, _db, { baseName: '無題', position: 'append', baselineOrder: visibleOrder });
    const immediateRow = typeof _dbFindEntityRow === 'function' ? _dbFindEntityRow(created.renderCtx || ctx, created.name) : null;
    if (immediateRow) focusCreatedRow(immediateRow, created.name, true);
    else _waitForEntityRow(created.renderCtx || ctx, created.name, (newRow) => focusCreatedRow(newRow, created.name));
    try {
      const saved = await created.promise;
      if (saved.name !== created.name && typeof _dbRenameOptimisticEntityLocally === 'function') {
        _dbRenameOptimisticEntityLocally(created.renderCtx || ctx, _db, created.name, saved.name);
      }
      if (typeof _dbScheduleEntityCreatePostSync === 'function') {
        _dbScheduleEntityCreatePostSync(_db, [{ name: saved.name, path: saved.path, response: saved.response }], created.renderCtx || ctx);
      }
    } catch (e) {
      // タイムアウト等でも作成済みのことがあるため、撤去前に確認する
      const recovered = typeof _dbRecoverEntityCreateAfterError === 'function'
        ? await _dbRecoverEntityCreateAfterError(created.renderCtx || ctx, _db, created)
        : null;
      if (recovered) {
        if (typeof showStatus === 'function') showStatus('エントリを追加しました');
      } else {
        if (typeof _dbRemoveCreatedEntitiesLocally === 'function') _dbRemoveCreatedEntitiesLocally(created.renderCtx || ctx, _db, [created.name]);
        if (typeof showStatus === 'function') showStatus('エントリ作成に失敗: ' + (e?.message || e), true);
      }
    }
    return;
  }
  const pivotData = (ctx && ctx.pivotData) || state.pivotData;
  const existing = pivotData ? Object.keys(pivotData.entities || {}) : [];
  try {
    const created = typeof _apiCreateEntityWithUniqueName === 'function'
      ? await _apiCreateEntityWithUniqueName(_db, existing)
      : null;
    const r = created?.response || await apiPost('/entity/create', { parent_path: _db, name: '無題' });
    const name = created?.name || '無題';
    const createdPath = created?.path || (r && (r.path || r.entry_path)) || `${_db}/${name}.md`;
    if (typeof _shouldRunFrontendAutoFillOnCreate !== 'function' || _shouldRunFrontendAutoFillOnCreate(r)) {
      try { await _autoFillOnCreate(_db, createdPath, {}); } catch {}
    }
    historyPush('エントリ追加: ' + name,
      async () => {
        const result = await window.GbDbEntryIdentity.deleteEntries({
          dbPath: _db,
          ctx,
          entries: [{
            name,
            path: createdPath || _entityPath(_db, name),
            entryId: String(r?.entry_id || r?.id || ''),
          }],
          source: 'entry-create-undo',
        });
        if (result.failures.length) throw result.failures[0].error;
      },
      async () => {
        const redo = await apiPost('/entity/create', { parent_path: _db, name });
        const redoPath = (redo && (redo.path || redo.entry_path)) || `${_db}/${name}.md`;
        if (typeof _shouldRunFrontendAutoFillOnCreate !== 'function' || _shouldRunFrontendAutoFillOnCreate(redo)) {
          try { await _autoFillOnCreate(_db, redoPath, {}); } catch {}
        }
        await selectDatabase(_db, ctx);
      },
      typeof _dbScopeForPath === 'function'
        ? _dbScopeForPath(_db)
        : (typeof _dbScope === 'function' ? _dbScope(_db) : 'db:' + String(_db).replace(/\\/g, '/'))
    );
    await selectDatabase(_db, ctx);
    // Step 2: チャンク分割中は新規行が遅れて DOM に出現する可能性があるため、待機
    const _ctxNew = ctx || ((typeof _currentPaneState === 'function') ? _currentPaneState() : null);
    const immediateRow = typeof _dbFindEntityRow === 'function' ? _dbFindEntityRow(_ctxNew, name) : null;
    if (immediateRow) focusCreatedRow(immediateRow, name, true);
    else _waitForEntityRow(_ctxNew, name, (newRow) => focusCreatedRow(newRow, name));
  } catch(e) { /* error shown */ }
}

// 新規プロパティ追加（キーボード用）
function triggerNewProperty(ctxOrDbPath) {
  const ctx = (typeof ctxOrDbPath === 'object' && ctxOrDbPath)
    ? ctxOrDbPath
    : (typeof _dbPaneContextFromEvent === 'function'
      ? _dbPaneContextFromEvent(activeCell, { dbPath: typeof ctxOrDbPath === 'string' ? ctxOrDbPath : state.currentDbPath })
      : (typeof _currentPaneState === 'function' ? _currentPaneState() : null));
  const dbPath = (typeof ctxOrDbPath === 'string' ? ctxOrDbPath : '') || (ctx && ctx.dbPath) || state.currentDbPath;
  if (!dbPath) return;
  const pivotData = (ctx && ctx.pivotData) || state.pivotData;
  const fallbackOrder = typeof filterDeletedDbProperties === 'function'
    ? filterDeletedDbProperties(dbPath, pivotData?.properties || [])
    : [...(pivotData?.properties || [])];
  const order = getColOrder(dbPath, { ctx }) || fallbackOrder;
  // 新しい列の初期名は列タイプ名（この経路はテキスト列）
  const base = (typeof getPropertyTypeLabel === 'function' ? getPropertyTypeLabel('text') : '') || 'テキスト';
  let idx = 1, name = base;
  while (order.includes(name)) { idx++; name = base + idx; }
  order.push(name);
  setColOrder(dbPath, order, { skipHistory: true, ctx });
  setPropertyType(dbPath, name, { type: 'text' });
  renderPivot(ctx);
  setTimeout(() => {
    const _ctx2 = ctx || _currentPaneState();
    const th = _paneEl(_ctx2, '#' + (_ctx2.tableId || 'pivot-table') + ` thead th[data-prop="${name}"]`);
    // _ctx2 を渡さないと startHeaderInlineRename() が独自に ctx を再解決し、直前の
    // setColOrder/setPropertyType が使った ctx/dbPath と食い違う経路が生まれる
    // （embedded ctx を持つ埋め込みシートでは特に、メイン画面側へ誤爆しうる。2026-07-15 徹底チェックで発見）。
    if (th) startHeaderInlineRename(th, name, dbPath, _ctx2);
  }, 30);
}

// 列リサイズ
function startColResize(e, th, colIndex, propName) {
  e.preventDefault();
  e.stopPropagation();
  const ctx = typeof _dbPaneContextFromEvent === 'function'
    ? _dbPaneContextFromEvent(th, { dbPath: state.currentDbPath })
    : (typeof _currentPaneState === 'function' ? _currentPaneState() : null);
  const dbPath = (ctx && ctx.dbPath) || state.currentDbPath;
  const table = th?.closest?.('table') || _currentPivotTable(ctx);
  const startX = e.clientX;
  const startW = Math.max(60, parseFloat(th.style.width) || th.getBoundingClientRect?.().width || th.offsetWidth || 100);
  let lastWidth = Math.max(60, Math.round(startW));

  const handle = e.target?.closest?.('.col-resize-handle') || e.target;
  handle.classList.add('active');
  handle.setPointerCapture?.(e.pointerId);

  const applyLiveWidth = (width) => {
    lastWidth = Math.max(60, Math.round(width));
    th.style.width = lastWidth + 'px';
    th.style.minWidth = lastWidth + 'px';
    th.style.maxWidth = lastWidth + 'px';
    setColWidth(colIndex, lastWidth, table);
    if (typeof _dbReflowPinnedColumnOffsets === 'function') _dbReflowPinnedColumnOffsets(table);
  };
  const onMove = (e2) => {
    applyLiveWidth(startW + e2.clientX - startX);
  };
  const onUp = (upEvent) => {
    handle.classList.remove('active');
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    document.removeEventListener('pointercancel', onUp);
    handle.releasePointerCapture?.(upEvent?.pointerId ?? e.pointerId);
    // 幅を永続化
    if (propName && dbPath) {
      setColWidthPersist(dbPath, propName, lastWidth, {
        ctx,
        label: 'シート表示: 列幅',
        detail: propName,
      });
    }
  };
  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup', onUp);
  document.addEventListener('pointercancel', onUp);
}

function setColWidth(colIndex, width, table) {
  // ヘッダー・本文・集計行を同じピクセル幅で固定する。
  table = table || _currentPivotTable();
  if (!table) return;
  const nextWidth = Math.max(60, Math.round(Number(width) || 60));
  table.querySelectorAll('thead tr, tbody tr, tfoot tr').forEach(tr => {
    const cell = tr.children[colIndex];
    if (cell) {
      cell.style.width = nextWidth + 'px';
      cell.style.minWidth = nextWidth + 'px';
      cell.style.maxWidth = nextWidth + 'px';
    }
  });
}

function _showBulkColumnWidthModal(propName, ctxOrDbPath) {
  const ctx = (typeof ctxOrDbPath === 'object' && ctxOrDbPath)
    ? ctxOrDbPath
    : (typeof _dbPaneContextFromEvent === 'function'
      ? _dbPaneContextFromEvent(activeCell, { dbPath: typeof ctxOrDbPath === 'string' ? ctxOrDbPath : state.currentDbPath })
      : (typeof _currentPaneState === 'function' ? _currentPaneState() : null));
  const dbPath = (typeof ctxOrDbPath === 'string' ? ctxOrDbPath : '') || (ctx && ctx.dbPath) || state.currentDbPath;
  if (!dbPath) return;
  let targets = _getSelectedColumns(dbPath);
  if (!targets.length || !targets.includes(propName)) {
    targets = [propName];
    _setSelectedColumns(dbPath, targets, propName);
  }
  const widths = getColWidths(dbPath, { ctx });
  const firstWidth = Number(widths[targets[0]] || 100);
  const sameWidth = targets.every(name => Number(widths[name] || 100) === firstWidth);

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `<div class="modal" style="min-width:360px;">
    <h3>列幅を指定</h3>
    <div style="margin:8px 0;color:var(--fg2);font-size:12px;line-height:1.6;">対象: ${targets.map(name => esc(name)).join(' / ')}</div>
    <div class="field">
      <label>幅 (px)</label>
      <input id="bulk-col-width-input" type="number" min="60" step="1" value="${sameWidth ? firstWidth : ''}" placeholder="${sameWidth ? '' : '現在は列ごとに異なります'}" style="width:100%;padding:6px 8px;">
    </div>
    <div class="btn-row" style="margin-top:12px;">
      <button data-action="this.closest('.modal-overlay').remove()">キャンセル</button>
      <button class="primary" id="bulk-col-width-apply">適用</button>
    </div>
  </div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  overlay.querySelector('#bulk-col-width-apply')?.addEventListener('click', () => {
    const input = overlay.querySelector('#bulk-col-width-input');
    const raw = (input?.value || '').trim();
    const parsed = parseInt(raw, 10);
    if (!raw || Number.isNaN(parsed)) {
      showStatus('幅を入力してください', true);
      return;
    }
    const value = Math.max(60, parsed);
    const before = typeof captureDbViewConfigHistory === 'function' ? captureDbViewConfigHistory(dbPath) : null;
    targets.forEach(name => setColWidthPersist(dbPath, name, value, { skipHistory: true, ctx }));
    if (typeof pushDbViewConfigHistory === 'function' && typeof captureDbViewConfigHistory === 'function') {
      pushDbViewConfigHistory(dbPath, 'シート表示: 列幅', before, captureDbViewConfigHistory(dbPath), targets.join(' / '));
    }
    overlay.remove();
    if (typeof _renderCurrentDbView === 'function') _renderCurrentDbView(ctx, dbPath);
    else if (typeof renderPivot === 'function') renderPivot(ctx);
  });
  setTimeout(() => overlay.querySelector('#bulk-col-width-input')?.focus(), 30);
}

/* DB Undo/Redo ヘルパー（scope = 'db:' + dbPath で開いているDB単位） */
