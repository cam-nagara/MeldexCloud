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
// 列名変更の旧名→新名をシートごとに覚える。列メニューは開いた時点の列名を持つため、
// 列名変更の反映前に開いたメニューから「右に列を挿入」すると、基準列が見つからずに
// 末尾へ追加されていた（列名変更の待ち時間中に続けて挿入すると再現）。
const _dbColumnRenameAliases = new Map();

function _dbRememberColumnRename(dbPath, oldName, newName) {
  const key = String(dbPath || '');
  if (!key || !oldName || !newName || oldName === newName) return () => {};
  let aliases = _dbColumnRenameAliases.get(key);
  if (!aliases) { aliases = new Map(); _dbColumnRenameAliases.set(key, aliases); }
  aliases.set(oldName, newName);
  // 新名を別の列が旧名として使い直す場合に循環しないよう、新名側の古い対応は消す。
  if (aliases.get(newName) === oldName) aliases.delete(newName);
  return function forget() {
    if (aliases.get(oldName) === newName) aliases.delete(oldName);
  };
}

// 列名変更の保存が終わるまで、同じシートの列挿入を待たせる。待たずに挿入すると、旧名を含む
// 古い列定義で新しい列を書き込み、列の型の保存と列名変更がサーバーで競合した（409）。
// 併せて、新しい列の仮の名前に変更中の旧名を使わない（insertPropertyInline）ことと、古い
// 保存応答で手元の列定義を戻さない（GbDbSchemaMutation の世代確認）ことで、列定義が失われる
// 不具合（2026-11-18 再現: 3回続けた挿入で列が1つだけ残った）を防ぐ。
const _dbColumnRenameLocalGates = new Map();

function _dbOpenColumnRenameGate(dbPath) {
  const key = String(dbPath || '');
  let release = () => {};
  const promise = new Promise(resolve => { release = resolve; });
  const gate = { promise, released: false };
  _dbColumnRenameLocalGates.set(key, gate);
  return () => {
    if (gate.released) return;
    gate.released = true;
    if (_dbColumnRenameLocalGates.get(key) === gate) _dbColumnRenameLocalGates.delete(key);
    release();
  };
}

function _dbPendingColumnRenameGate(dbPath) {
  const gate = _dbColumnRenameLocalGates.get(String(dbPath || ''));
  return gate && !gate.released ? gate.promise : null;
}

function _dbResolveCurrentColumnName(dbPath, name, existingNames) {
  const aliases = _dbColumnRenameAliases.get(String(dbPath || ''));
  const existing = Array.isArray(existingNames) ? existingNames : null;
  if (existing && existing.includes(name)) return name;
  let current = name;
  for (let hop = 0; aliases && hop < 16 && aliases.has(current); hop += 1) {
    current = aliases.get(current);
    if (existing && existing.includes(current)) return current;
  }
  return existing ? name : current;
}


// 列名の変更で重なった同名の列が、今のビューでどう見えていないか: 'hidden'（非表示）/ 'deleted'（削除済み）/ ''（見えている）。
function _dbColumnNameConflictKind(dbPath, name, ctx) {
  try {
    if (typeof isDbPropertyDeleted === 'function' && isDbPropertyDeleted(dbPath, name)) return 'deleted';
    const cfg = typeof getDbViewConfig === 'function' ? getDbViewConfig(dbPath) : null;
    const idx = typeof _getCurrentDbViewIndexFromConfig === 'function' ? _getCurrentDbViewIndexFromConfig(cfg, { ctx }) : (cfg?.currentViewIdx || 0);
    const view = (cfg?.savedViews || [])[idx] || cfg || {};
    if ((view.hiddenCols || []).includes(name)) return 'hidden';
  } catch (_) { /* 判定できない時は従来の文言 */ }
  return '';
}
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
    'right:6px',
    'top:50%',
    'transform:translateY(-50%)',
    'width:auto',
    'max-width:calc(100% - 12px)',
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
  // 列名の入力中は見出しの幅いっぱいを使う（「所属 コピー 2」が「コピー2」までしか見えなかった）。
  // 「…」ボタンは場所を残したまま見えなくする（寸法は変えない）。
  const moreBtn = th.querySelector('.th-more-btn');
  if (moreBtn) moreBtn.style.visibility = 'hidden';
  const restoreMoreBtn = () => { if (moreBtn) moreBtn.style.visibility = ''; };
  inp.addEventListener('blur', () => setTimeout(() => { if (!inp.isConnected) restoreMoreBtn(); }, 0));
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
      // 同じ名前の列が見えていない時（このビューで非表示・削除済み）は、そうと分かる短い文言にし、
      // 非表示の列は列管理をその列名で絞り込んで開き、その場で表示できるようにする（2026-11-21 報告）。
      const kind = _dbColumnNameConflictKind(targetDbPath, newName, ctx);
      if (kind === 'hidden') showStatus(`非表示の列「${newName}」があります`, true);
      else if (kind === 'deleted') showStatus(`削除済みの列「${newName}」と同じ名前です`, true);
      else showStatus('同名の列が既にあります: ' + newName, true);
      renderPivot(ctx);
      restoreActiveCellByProp(oldName, ctx);
      if (kind === 'hidden' && typeof openDbViewColumnManager === 'function') {
        try {
          const cfg = getDbViewConfig(targetDbPath);
          const idx = typeof _getCurrentDbViewIndexFromConfig === 'function' ? _getCurrentDbViewIndexFromConfig(cfg, { ctx }) : (cfg.currentViewIdx || 0);
          const anchor = (ctx?.containerEl || document).querySelector?.(`thead th[data-prop="${CSS.escape(oldName)}"]`) || null;
          openDbViewColumnManager(idx, ctx, anchor, { initialQuery: newName });
        } catch (_) { /* 文言だけで知らせる */ }
      }
      return;
    }
    // 保存の完了を待たずに、見出しへ新しい列名をすぐ出す（失敗・取り消し時は描き直しで戻る）。
    inp.remove();
    restoreMoreBtn();
    if (label) {
      label.textContent = newName;
      label.style.display = '';
    }
    th.classList.add('is-column-renaming');
    th.setAttribute('aria-busy', 'true');
    // オプションパネルの列設定タブの列名欄も、確定の時点で新しい名前にする（保存失敗・中止で戻す）。
    const syncPanels = (from, to, phase) => {
      if (typeof _ptSyncColumnRenameToPanels === 'function') _ptSyncColumnRenameToPanels(targetDbPath, from, to, phase);
    };
    syncPanels(oldName, newName, 'preview');
    const forgetRename = _dbRememberColumnRename(targetDbPath, oldName, newName);
    const releaseRenameGate = _dbOpenColumnRenameGate(targetDbPath);
    // 別の列の列名を入力中なら、描き直しでその入力欄を消さない（その列の確定時に描き直す）。
    const otherRenameActive = () => !!(ctx?.containerEl || document).querySelector?.('.th-rename-input');
    const renderUnlessEditing = (activeProp) => {
      if (otherRenameActive()) return;
      renderPivot(ctx);
      restoreActiveCellByProp(activeProp, ctx);
    };
    try {
      if (typeof renameDbProperty === 'function') {
        if (window.MeldexTopicPlacementUI?.renameColumn) {
          const renamed = await window.MeldexTopicPlacementUI.renameColumn({
            dbPath: targetDbPath, oldName, newName, ctx, viewId: ctx?.currentViewId,
            rename: () => renameDbProperty(targetDbPath, oldName, newName, ctx),
            rollback: () => renameDbProperty(targetDbPath, newName, oldName, ctx),
          });
          if (!renamed) {
            releaseRenameGate();
            forgetRename();
            syncPanels(newName, oldName, 'reverted');
            if (label && label.isConnected) label.textContent = oldName;
            th.classList.remove('is-column-renaming');
            th.removeAttribute('aria-busy');
            renderUnlessEditing(oldName);
            return;
          }
        } else {
          await renameDbProperty(targetDbPath, oldName, newName, ctx);
        }
      }
    } catch (err) {
      releaseRenameGate();
      showStatus(
        err?.resultUnknown
          ? '列名変更の保存結果を確認できません。再読み込み後の表示を確認してください。'
          : '列名の変更に失敗: ' + (err?.message || err),
        true
      );
      const currentProps = (ctx?.pivotData || state.pivotData)?.properties || [];
      const kept = currentProps.includes(newName) ? newName : oldName;
      if (kept === oldName) {
        forgetRename();
        syncPanels(newName, oldName, 'reverted');
      }
      if (label && label.isConnected) label.textContent = kept;
      th.classList.remove('is-column-renaming');
      th.removeAttribute('aria-busy');
      renderUnlessEditing(kept);
      return;
    }
    releaseRenameGate();
    th.classList.remove('is-column-renaming');
    th.removeAttribute('aria-busy');
    const selected = _getSelectedColumns(targetDbPath).map(name => name === oldName ? newName : name);
    _setSelectedColumns(targetDbPath, selected, newName);
    renderUnlessEditing(newName);
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
  // selectDatabase は取得開始時に pivotData を空にする。連続追加の途中では
  // 使用せず、作成後と同じ入力・保存を守る再読込へまとめる。
  void _dbReloadAfterEntityCreate(ctx, dbPath);
}

function _dbCommitEntityRenameLocalFirst(ctx, td, nameSpan, oldName, newName, dbPath) {
  if (typeof _dbNoteEntityEdit === 'function') _dbNoteEntityEdit(dbPath);
  // 楽観再描画より前に manualOrder も同じ名前へ付け替える。
  // 画面だけ先に新名へ変わって manualOrder が旧名のままだと、保存完了まで一度末尾へ落ちる。
  // 保存失敗時は呼び出し側が newName → oldName で本関数を再実行するため、順序も同時に戻る。
  if (typeof _dbRenameLocalRefs === 'function') {
    _dbRenameLocalRefs(dbPath, oldName, newName);
  }
  const changed = _dbApplyEntityRenameLocally(ctx, dbPath, oldName, newName);
  const ownInput = td?.querySelector?.('.entity-rename-input');
  if (changed && !ownInput?.isConnected && typeof _dbEntityCreateIsEditing === 'function' && _dbEntityCreateIsEditing(ctx)) {
    // 先行保存の失敗で名前を戻す場合も、次の入力欄を全体描画で破棄しない。
    const row = typeof _dbFindEntityRow === 'function' ? _dbFindEntityRow(ctx, oldName) : null;
    if (row) {
      row.dataset.entityName = newName;
      row.querySelectorAll('.entity-name-label').forEach(label => { label.textContent = newName; });
      row.querySelectorAll('[data-entity-name]').forEach(el => { el.dataset.entityName = newName; });
    }
    return true;
  }
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

function _dbPersistEntityInlineRename(ctx, dbPath, oldName, newName, entity) {
  // 作成待ちの間も改名全体を追跡し、再読込がその隙間へ入らないようにする。
  // 作成応答が先に返って実パスが行へ入った分岐でも、旧表示名の予約は必要。
  if (typeof _dbHoldEntityCreateNameReservation === 'function') {
    _dbHoldEntityCreateNameReservation(dbPath, oldName);
  }
  const saved = (async () => {
    if (entity?._topicCanonicalOnly && entity?.topicRef) {
      return window.MeldexTopicPlacementUI.renameProjectedTopic(entity, newName);
    }
    const path = entity?._entry_path || (typeof _dbResolveEntityPathForRename === 'function'
      ? await _dbResolveEntityPathForRename(dbPath, oldName)
      : _entityPath(dbPath, oldName));
    const result = await window.GbDbEntryIdentity.rename({
      dbPath, oldName, newName, path, ctx,
      entryId: entity?._id || entity?.entry_id || '',
    });
    // 更新日時なども確定した1行の応答から反映する。
    if (result?.entity_data && typeof _dbApplyCreatedEntityData === 'function') {
      _dbApplyCreatedEntityData(dbPath, entity, result.entity_data);
    }
    // 作成直後の旧表示名は、改名がサーバーで確定するまで次の作成へ再利用しない。
    // 成功後は新形式の保存名と表示名が独立しているため、通常の採番へ戻せる。
    if (typeof _dbReleaseEntityCreateNameReservation === 'function') {
      _dbReleaseEntityCreateNameReservation(dbPath, oldName);
    }
    return result;
  })();
  return typeof _dbTrackValueMutation === 'function' ? _dbTrackValueMutation(dbPath, saved) : saved;
}

// 名前の変更の取り消し履歴を、確定した時点で積む。取り消し・やり直しは保存の完了を待たずに画面の名前を
// すぐ切り替え、保存（サーバーでの名前の付け替え）はその後に行う。再読込はしない（行が2段階で跳ねていた。
// 2026-11-22 探索）。元の保存が失敗した時は、この履歴を取り除く（画面は確定処理の側で元の名前へ戻す）。
function _dbPushEntityRenameHistoryNow(ctx, dbPath, oldName, newName, savePromise) {
  if (typeof historyPush !== 'function') return null;
  const scope = typeof _dbScope === 'function' ? _dbScope(dbPath) : '';
  const saved = Promise.resolve(savePromise).then(() => true, () => false);
  const entitiesOf = () => (ctx && ctx.pivotData && ctx.pivotData.entities)
    || (typeof state !== 'undefined' && state.currentDbPath === dbPath && state.pivotData ? state.pivotData.entities : null) || {};
  const showLocally = (from, to) => {
    const entities = entitiesOf();
    if (!Object.prototype.hasOwnProperty.call(entities, from) || Object.prototype.hasOwnProperty.call(entities, to)) return;
    _dbCommitEntityRenameLocalFirst(ctx, null, null, from, to, dbPath);
  };
  const run = async (from, to) => {
    // 画面の名前を先に戻すと保存先（ファイル）を名前から引けなくなるので、トピックの記録を先に控える。
    const entity = entitiesOf()[from] || entitiesOf()[to] || null;
    showLocally(from, to);
    if (!(await saved)) return;
    // 元の保存の完了の反映で表示が新しい名前へ戻っていたら、描き直しの前（同じ流れの中）で直す。
    showLocally(from, to);
    try {
      await window.GbDbEntryIdentity.rename({
        dbPath, oldName: from, newName: to, ctx,
        path: entity?._entry_path || '',
        entryId: entity?._id || entity?.entry_id || '',
      });
    } catch (error) {
      showLocally(to, from);
      throw error;
    }
  };
  const entry = historyPush('名前を変更: ' + oldName + ' → ' + newName,
    () => run(newName, oldName),
    () => run(oldName, newName),
    scope);
  saved.then(ok => {
    if (ok || !entry) return;
    const stacks = [];
    if (typeof _getStack === 'function') stacks.push(_getStack(entry.scope));
    if (typeof _historyGlobal !== 'undefined' && _historyGlobal) stacks.push(_historyGlobal);
    stacks.forEach(stack => ['undo', 'redo'].forEach(kind => {
      const index = stack?.[kind]?.indexOf?.(entry);
      if (index >= 0) stack[kind].splice(index, 1);
    }));
    if (typeof renderHistoryList === 'function') renderHistoryList();
    if (typeof renderHistoryPanel === 'function') renderHistoryPanel();
  });
  return entry;
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
  inp.setAttribute('aria-label', `トピック名を変更: ${oldName || '無題'}`);
  // 表示ラベルと同じホスト・左余白を使い、編集開始時に文字が右へ跳ねないようにする。
  inp.style.cssText = 'width:100%;min-width:0;box-sizing:border-box;padding:0 4px;margin:0;background:var(--bg2);color:var(--fg);border:1px solid var(--accent);border-radius:3px;font:inherit;line-height:1.4;';
  const inputHost = nameSpan.parentElement || td;
  inputHost.insertBefore(inp, nameSpan.parentElement ? nameSpan : td.firstChild);
  inp.focus();
  inp.select();
  let committed = false;
  const restoreRejectedDraft = proposedName => {
    if (_renCtx?.dbPath && _renCtx.dbPath !== dbPath) return false;
    if (_renCtx && typeof _currentPaneState === 'function' && _currentPaneState() !== _renCtx) return false;
    if (typeof _dbEntityCreateIsEditing === 'function' && _dbEntityCreateIsEditing(_renCtx)) return false;
    const row = typeof _dbFindEntityRow === 'function' ? _dbFindEntityRow(_renCtx, oldName) : null;
    const cell = row?.querySelector('.col-entity');
    const label = cell?.querySelector('.entity-name-label');
    if (!cell || !label) return false;
    startEntityInlineRename(cell, label, oldName, dbPath);
    const draft = cell.querySelector('.entity-rename-input');
    if (!draft) return false;
    draft.value = proposedName;
    draft.select();
    return true;
  };
  const commit = async (commitOptions = {}) => {
    if (committed) return;
    committed = true;
    const newName = inp.value.trim();
    if (!newName || newName === oldName) {
      if (commitOptions.fromBlur) {
        // 別のセルを押して入力欄から離れた時は、その場で元の表示へ戻すだけにする。全体を描き直して
        // 名前セルへ選択を戻すと、押したセルの選択・編集が消える（追加直後の名前の編集から離れた時など）。
        inp.remove();
        nameSpan.style.display = '';
        if (moreBtn) moreBtn.style.display = '';
        if (relDiv) relDiv.style.display = '';
        return;
      }
      renderPivot(_renCtx);
      restoreActiveCellByRow(rowIdx, 'entity', 0, _renCtx);
      return;
    }
    // 同名エントリが既にあれば、楽観適用で既存エントリを上書きしないようここで弾く
    // （サーバも 409 で拒否するが、待たずに即フィードバックする）。
    const _renEntities = (_renCtx && _renCtx.pivotData && _renCtx.pivotData.entities)
      || (typeof state !== 'undefined' && state.pivotData ? state.pivotData.entities : null) || {};
    if (Object.prototype.hasOwnProperty.call(_renEntities, newName)) {
      if (typeof showStatus === 'function') showStatus('同じ名前のトピックが既にあります: ' + newName, true);
      renderPivot(_renCtx);
      restoreActiveCellByRow(rowIdx, 'entity', 0, _renCtx);
      return;
    }
    const projectedEntity = _renEntities?.[oldName];
    // 楽観的更新: サーバ保存を待たず、その場で新名を表示する（列名変更と同じ即時反映）。
    // 保存に失敗したら catch で旧名へ戻す。
    _dbCommitEntityRenameLocalFirst(_renCtx, td, nameSpan, oldName, newName, dbPath);
    try {
      if (projectedEntity?._topicCanonicalOnly && projectedEntity?.topicRef) {
        await _dbPersistEntityInlineRename(_renCtx, dbPath, oldName, newName, projectedEntity);
        restoreActiveCellByRow(rowIdx, 'entity', 0, _renCtx);
        return;
      }
      const saving = _dbPersistEntityInlineRename(_renCtx, dbPath, oldName, newName, projectedEntity);
      // 取り消しの履歴は確定した時点で積む（保存の完了後に積むと、直後の Ctrl+Z が1つ前の操作を戻していた）。
      _dbPushEntityRenameHistoryNow(_renCtx, dbPath, oldName, newName, saving);
      await saving;
    } catch(e) {
      // 通信結果不明では、サーバー側だけ成功した変更を画面から消さない。
      if (!e?.resultUnknown) _dbCommitEntityRenameLocalFirst(_renCtx, td, nameSpan, newName, oldName, dbPath);
      if (typeof showStatus === 'function') {
        showStatus(e?.resultUnknown ? '保存結果を確認できません。再読み込みで確認します' : '名前の変更に失敗しました', true);
      }
      if (e?.resultUnknown) _dbRefreshEntityRenameInBackground(_renCtx, dbPath, newName);
      if (e?.resultUnknown || !restoreRejectedDraft(newName)) restoreActiveCellByRow(rowIdx, 'entity', 0, _renCtx);
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
        if (typeof showStatus === 'function') showStatus('同じ名前のトピックが既にあります: ' + newName, true);
        renderPivot(_renCtx); doAfter(); return;
      }
      const projectedEntity = _renEntitiesTab?.[oldName];
      // 楽観的更新: 先に新名を表示してからサーバ保存
      _dbCommitEntityRenameLocalFirst(_renCtx, td, nameSpan, oldName, newName, dbPath);
      if (projectedEntity?._topicCanonicalOnly && projectedEntity?.topicRef) {
        _dbPersistEntityInlineRename(_renCtx, dbPath, oldName, newName, projectedEntity)
          .then(() => setTimeout(doAfter, 50))
          .catch((error) => {
            _dbCommitEntityRenameLocalFirst(_renCtx, td, nameSpan, newName, oldName, dbPath);
            if (typeof showStatus === 'function') showStatus(error?.message || '名前の変更に失敗しました', true);
            if (!restoreRejectedDraft(newName)) doAfter();
          });
        return;
      }
      const saving = _dbPersistEntityInlineRename(_renCtx, dbPath, oldName, newName, projectedEntity);
      _dbPushEntityRenameHistoryNow(_renCtx, dbPath, oldName, newName, saving);
      saving.then(() => {
        setTimeout(doAfter, 50);
      }).catch((error) => {
        if (!error?.resultUnknown) _dbCommitEntityRenameLocalFirst(_renCtx, td, nameSpan, newName, oldName, dbPath);
        if (typeof showStatus === 'function') {
          showStatus(error?.resultUnknown ? '保存結果を確認できません。再読み込みで確認します' : '名前の変更に失敗しました', true);
        }
        if (error?.resultUnknown) _dbRefreshEntityRenameInBackground(_renCtx, dbPath, newName);
        if (error?.resultUnknown || !restoreRejectedDraft(newName)) doAfter();
      });
    }
  });
  attachInlineBlurCommit(inp, () => commit({ fromBlur: true }));
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

function restoreActiveCellByRow(rowIdx, colIdx, _attempt, ctxOverride, _seqAtSchedule) {
  // 予約した後に利用者が別のセルを選んだら戻さない（2026-11-22）。名前の入力を Esc で閉じてすぐ値のセルを選ぶと、
  // 遅れて来た戻しが選択を名前の列へ奪い、続けて打った Tab が名前の列から動いていた。
  const seqAtSchedule = _seqAtSchedule !== undefined ? _seqAtSchedule
    : (typeof dbActiveCellSeq === 'number' ? dbActiveCellSeq : null);
  setTimeout(() => {
    if (seqAtSchedule !== null && typeof dbActiveCellSeq === 'number' && dbActiveCellSeq !== seqAtSchedule) return;
    // 前の保存の完了で、既に始まっている次の入力からフォーカスを奪わない。
    if (typeof _dbEntityCreateIsEditing === 'function' && _dbEntityCreateIsEditing(ctxOverride)) return;
    const table = _currentPivotTable(ctxOverride);
    if (!table) return;
    const dataRows = _currentPivotRows(ctxOverride);
    // Step 2: チャンク分割中で目的の rowIdx がまだ生成されていない可能性。
    // 進行中なら最大 30 回 (約1.5秒) リトライ
    const ctx = ctxOverride || ((typeof _currentPaneState === 'function') ? _currentPaneState() : null);
    const attempt = _attempt || 0;
    if (rowIdx >= dataRows.length && ctx && ctx._renderInProgress && attempt < 30) {
      restoreActiveCellByRow(rowIdx, colIdx, attempt + 1, ctx, seqAtSchedule);
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
  if (typeof _dbEntityCreateIsEditing === 'function' && _dbEntityCreateIsEditing(ctxOverride)) return;
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
    const tr = root.querySelector(`tbody tr[data-entity-name="${MeldexEscape.cssIdent(entityName)}"]`);
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

    // tr を検索（共通の CSS 識別子エスケープで特殊文字を安全に扱う）
    const tr = tbody.querySelector(`tr[data-entity-name="${MeldexEscape.cssIdent(entityName)}"]`);
    if (!tr) {
      // Step 2: チャンク分割中で対象行がまだ生成されていない可能性。
      // 進行中なら短い間隔でリトライ (上限 20回 = 1秒程度)。
      const retryCount = _retryCount || 0;
      if (ctx && ctx._renderInProgress && retryCount < 20) {
        _restoreCellPos(pos, moveTo, retryCount + 1);
      }
      return;
    }
    const td = (propName && tr.querySelector(`td[data-prop-name="${MeldexEscape.cssIdent(propName)}"]`)) || tr.querySelector('.col-entity');
    if (td) setActiveCell(td);
  }, 50);
}

// 型対応インラインセル入力
// D-7: ctx を最初に取得して state 参照を排除。Undo callback は closure 内 dbPath を使う
