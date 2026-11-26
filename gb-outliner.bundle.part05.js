      }
    } catch (reason) {
      results.push({ status: 'rejected', reason });
      if (typeof options.onFailure === 'function') {
        try { options.onFailure(item, reason); } catch {}
      }
    }
  }
  return results;
}

function _removeOutlinerNodesForPaths(paths) {
  const deletedPaths = (paths || []).map(_normalizeOutlinerPathForCompare).filter(Boolean);
  if (!deletedPaths.length) return;
  // 同じ項目はホーム、ワークスペース、固定ソース、仮想化ツリーなど複数面に
  // 現れ得る。コンテナIDを限定すると削除中の複製だけが残るため、安定pathを
  // 持つ全ツリーノードを同時に隠す。
  if (typeof GBOutlinerVirtualRender !== 'undefined') {
    GBOutlinerVirtualRender.removeMatchingPaths?.(path => {
      const normalizedPath = _normalizeOutlinerPathForCompare(path);
      return deletedPaths.some(dp => _isOutlinerPathWithin(normalizedPath, dp)
        || normalizedPath.endsWith('/' + dp) || normalizedPath.includes('/' + dp + '/'));
    });
  }
  const allTreeNodes = document.querySelectorAll('.tree-node');
  allTreeNodes.forEach(nodeEl => {
    const path = nodeEl?._nodeData?.path || nodeEl?.dataset?.path || nodeEl?._virtualPath || '';
    if (!path) return;
    const normalizedPath = _normalizeOutlinerPathForCompare(path);
    if (deletedPaths.some(dp => (
      _isOutlinerPathWithin(normalizedPath, dp)
      || normalizedPath.endsWith('/' + dp)
      || normalizedPath.includes('/' + dp + '/')
    ))) {
      if (typeof _unregisterTreeSubtree === 'function') _unregisterTreeSubtree(nodeEl);
      nodeEl.remove();
    }
  });
}

function _removeFolderItemsForPaths(paths) {
  const canonical = value => {
    const path = _normalizeOutlinerPathForCompare(value);
    const absolute = input => /^(?:[a-z]:\/|\/)/i.test(input);
    const base = _normalizeOutlinerPathForCompare(typeof state !== 'undefined' ? state.vaultPath : '');
    const resolved = path && !absolute(path) && base && absolute(base) ? base + '/' + path : path;
    return /^[a-z]:\//i.test(resolved) ? resolved.toLowerCase() : resolved;
  };
  const deletedPaths = (paths || []).map(canonical).filter(Boolean);
  if (!deletedPaths.length) return;
  const matches = path => deletedPaths.some(dp => _isOutlinerPathWithin(canonical(path), dp));

  // フォルダの表示は面（メイン／サブパネル）ごとに状態を持つ。削除した項目は、表示しているすべての面から外す。
  const applyToSurface = () => {
  const independentSurface = typeof _folderIsIndependentSurface === 'function' && _folderIsIndependentSurface();
  const surfaceCards = typeof _folderGridEl === 'function'
    ? (_folderGridEl()?.querySelectorAll('.fv-item') || [])
    : document.querySelectorAll('#folder-grid .fv-item');
  let removedCards = 0;
  surfaceCards.forEach(itemEl => {
    const path = itemEl?.dataset?.path || '';
    if (path && matches(path)) { itemEl.remove(); removedCards += 1; }
  });
  if (independentSurface && !removedCards
      && !(typeof _folderItems !== 'undefined' && Array.isArray(_folderItems) && _folderItems.some(item => matches(item?.path)))
      && !globalThis.MeldexFolderLarge?.active?.()) return;

  if (typeof _folderItems !== 'undefined' && Array.isArray(_folderItems)) {
    _folderItems = _folderItems.filter(item => !matches(item?.path));
  }
  if (typeof _folderVisibleItems !== 'undefined' && Array.isArray(_folderVisibleItems)) {
    _folderVisibleItems = _folderVisibleItems.filter(item => !matches(item?.path));
  }
  if (typeof _folderSelectedItems !== 'undefined' && Array.isArray(_folderSelectedItems)) {
    _folderSelectedItems = _folderSelectedItems.filter(item => !matches(item?.path));
  }
  if (typeof _folderSelected !== 'undefined' && _folderSelected && matches(_folderSelected.path)) {
    _folderSelected = _folderSelectedItems?.[_folderSelectedItems.length - 1] || null;
  }

  const countEl = independentSurface ? null : document.getElementById('folder-item-count');
  if (countEl && typeof _folderVisibleItems !== 'undefined' && typeof _folderItems !== 'undefined') {
    countEl.textContent = _folderVisibleItems.length + (_folderItems.length !== _folderVisibleItems.length ? ' / ' + _folderItems.length : '') + ' 項目';
  }
  if (typeof _syncFolderCheckboxes === 'function') _syncFolderCheckboxes();
  if (typeof _updateFolderBulkBar === 'function') _updateFolderBulkBar();
  // 大きなフォルダの表示は位置で並べているので、外したカードの分は一覧を取り直して詰める
  if (globalThis.MeldexFolderLarge?.active?.()) { globalThis.MeldexFolderLarge.refresh(); return; }
  if (typeof _scheduleWaterfallLayout === 'function') _scheduleWaterfallLayout();
  };
  if (typeof _folderForEachSurface === 'function') _folderForEachSurface(applyToSurface);
  else applyToSurface();
}

function _markOutlinerDeletePending(paths, options = {}) {
  const pendingPaths = _setOutlinerDeletePending(paths, true);
  if (!pendingPaths.length) return pendingPaths;
  _removeOutlinerNodesForPaths(pendingPaths);
  _removeFolderItemsForPaths(pendingPaths);
  if (!options.preserveReferences && typeof purgeAppPathReferences === 'function') {
    purgeAppPathReferences(pendingPaths);
  }
  return pendingPaths;
}

function _clearOutlinerDeletePending(paths) {
  return _setOutlinerDeletePending(paths, false);
}

function _outlinerTrashRefFromResponse(response) {
  if (!response?.trash_name) return null;
  return { trash_name: response.trash_name, trash_root: response.trash_root || '' };
}

function _outlinerTrashRefsToNames(refs) {
  return (refs || []).map(ref => ref?.trash_name).filter(Boolean);
}

// ---- ゴミ箱からの復元 ----
// 戻し先に同じ名前の項目がある時、本体は黙って上書きも別名にもせず「競合」を返す（409 RESTORE_CONFLICT）。
// ここで利用者に「置き換え／スキップ／両方残す」を選んでもらい、選んだ扱いを付けて送り直す。
// 多数の復元（多数の削除の取り消し）は、この件数ずつに分けて /outliner/restore-batch へ送る。
const OUTLINER_RESTORE_BATCH_CHUNK = 100;
const OUTLINER_RESTORE_BATCH_MIN = 8;
let _outlinerRestoreBatchUnsupported = false;

function _outlinerRestoreConflictDetail(source) {
  const detail = source?.payload?.detail?.code ? source.payload.detail : source?.detail;
  if (detail && typeof detail === 'object' && detail.code === 'RESTORE_CONFLICT') return detail;
  // Cloud（Dropbox）の経路は、エラーそのものに種別を持たせて返す
  const code = source?.code || source?.meldexCode || source?.error?.code || source?.error?.meldexCode;
  if (code === 'RESTORE_CONFLICT') {
    return { code, message: String(source?.message || source?.error?.message || ''), choices: ['skip', 'keep_both'] };
  }
  return null;
}

// 同じ名前の項目がある時の選択（共通のダイアログ部品）。{ policy: 'replace'|'skip'|'keep_both', applyAll } を返す。
// 閉じた・中止した時は null（呼び出し側は、残りを戻さずゴミ箱に残す）。
function askRestoreConflict(detail, remaining = 0) {
  if (typeof window.GBUI?.createModal !== 'function') return Promise.resolve(null);
  const choices = Array.isArray(detail?.choices) && detail.choices.length ? detail.choices : ['skip', 'keep_both'];
  return new Promise(resolve => {
    const opener = document.activeElement;
    const message = document.createElement('div');
    message.className = 'gb-restore-conflict-message';
    const conflictName = detail?.name || detail?.original_path || '';
    // シートのトピック（行）は、名前とIDのどちらかが重なると戻せない。扱いの説明もトピック用にする。
    const isRow = detail?.row === true;
    const unavailable = detail?.unavailable && typeof detail.unavailable === 'object' ? detail.unavailable : {};
    message.textContent = conflictName
      ? (isRow ? `復元先のシートに「${conflictName}」が既にあります。どうしますか？` : `復元先に「${conflictName}」が既にあります。どうしますか？`)
      : `${detail?.message || '復元先に同じ名前の項目があります'}。どうしますか？`;
    const where = document.createElement('div');
    where.className = 'gb-section-desc';
    where.textContent = String(detail?.original_path || '');
    const body = [message, where];
    let applyAll = null;
    if (remaining > 0) {
      const label = document.createElement('label');
      label.className = 'gb-restore-conflict-apply-all';
      applyAll = document.createElement('input');
      applyAll.type = 'checkbox';
      applyAll.dataset.e2eId = 'restore-conflict-apply-all';
      label.append(applyAll, document.createTextNode(` 残りの同じ名前の項目（${remaining} 件）にも同じ操作をする`));
      body.push(label);
    }
    let answer = null;
    let modalApi = null;
    const button = (policy, text, help, primary) => {
      const element = document.createElement('button');
      element.type = 'button';
      element.className = 'gb-btn gb-btn-sm' + (primary ? ' gb-btn-primary' : '');
      element.textContent = text;
      element.dataset.e2eId = 'restore-conflict-' + policy;
      // 補足は共通のツールチップで出す（本文に長い説明を置かない）
      element.setAttribute('data-gb-tooltip', help);
      element.setAttribute('aria-label', `${text}（${help}）`);
      element.addEventListener('click', () => {
        answer = policy === 'cancel' ? null : { policy, applyAll: !!applyAll?.checked };
        modalApi.close(policy);
      });
      return element;
    };
    // 安全に選べない扱いは、押せないボタンとして残し、理由を共通のツールチップで示す
    const unavailableButton = (policy, text, reason) => {
      const wrap = document.createElement('span');
      wrap.className = 'gb-restore-conflict-unavailable';
      wrap.tabIndex = 0;
      wrap.dataset.e2eId = 'restore-conflict-' + policy + '-unavailable';
      wrap.setAttribute('role', 'note');
      wrap.setAttribute('data-gb-tooltip', reason);
      wrap.setAttribute('aria-label', `${text}は選べません（${reason}）`);
      const element = document.createElement('button');
      element.type = 'button';
      element.className = 'gb-btn gb-btn-sm';
      element.textContent = text;
      element.disabled = true;
      element.dataset.e2eId = 'restore-conflict-' + policy;
      wrap.append(element);
      return wrap;
    };
    const footer = [button('cancel', '中止', '残りは戻さず、ゴミ箱に残します')];
    footer.push(button('skip', 'スキップ', 'この項目は戻さず、ゴミ箱に残します'));
    if (choices.includes('replace')) {
      footer.push(button('replace', '置き換え', isRow ? '今あるトピックをゴミ箱へ移してから戻します' : '今ある方をゴミ箱へ移してから戻します'));
    } else if (unavailable.replace) footer.push(unavailableButton('replace', '置き換え', String(unavailable.replace)));
    if (choices.includes('keep_both')) {
      footer.push(button('keep_both', '両方残す', isRow ? '「名前_2」のような別の名前のトピックとして戻します' : '「名前 (2)」のような別の名前で戻します', true));
    } else if (unavailable.keep_both) footer.push(unavailableButton('keep_both', '両方残す', String(unavailable.keep_both)));
    modalApi = window.GBUI.createModal({
      id: 'gb-restore-conflict',
      title: '同じ名前の項目があります',
      body,
      footer,
      variant: 'standard',
      extraClass: 'gb-confirm',
      geometryKey: 'restore-conflict',
      initialFocus: () => [...footer].reverse().find(element => element.tagName === 'BUTTON') || footer[0],
      returnFocus: () => opener,
      closeLabel: '復元を中止',
      closeOnEsc: true,
      closeOnOverlay: false,
      onClose: () => resolve(answer),
    });
    modalApi.modal?.setAttribute?.('role', 'alertdialog');
    modalApi.open();
  });
}

// ゴミ箱の項目（{trash_name, trash_root}）を元の場所へ戻す。結果は refs と同じ並びで、
// { ok:true, value } / { ok:true, skipped:true }（戻さなかった。ゴミ箱に残る）/ { ok:false, error, status, detail }。
// options:
//   allowMissingOriginal  元の場所の記録が無い古い項目も戻す（ゴミ箱の画面からの復元）
//   singleRequest(ref, policy)  1件ずつ送る時の要求 { path, body }（ゴミ箱の画面は従来の /trash/restore を使う）
//   onProgress(done, total)     まとめて送った塊が済むたび
async function restoreTrashRefsWithConflicts(refs, options = {}) {
  const list = Array.isArray(refs) ? refs : [];
  const outcomes = new Array(list.length).fill(null);
  const attempts = new Array(list.length).fill(0);
  const ask = typeof options.ask === 'function' ? options.ask : askRestoreConflict;
  const itemFor = (index, policy) => ({
    trash_name: list[index].trash_name,
    ...(list[index].trash_root ? { trash_root: list[index].trash_root } : {}),
    ...(policy ? { conflict_policy: policy } : {}),
    ...(options.allowMissingOriginal ? { allow_missing_original: true } : {}),
  });
  const singleRequestFor = (index, policy) => {
    const custom = typeof options.singleRequest === 'function' ? options.singleRequest(list[index], policy) : null;
    return custom?.path ? custom : { path: '/outliner/restore', body: itemFor(index, policy) };
  };
  const failed = (error, status, detail) => ({
    ok: false, status: status || error?.status || 0, detail: detail ?? error?.payload?.detail ?? null,
    error: error || new Error(String(detail?.message || detail || '復元できませんでした')),
  });
  const sendSingles = async (indexes, policyFor) => {
    for (const index of indexes) {
      try {
        const request = singleRequestFor(index, policyFor(index));
        const value = await apiPost(request.path, request.body, { silentError: true });
        outcomes[index] = { ok: true, value, skipped: !!value?.skipped };
      } catch (error) {
        outcomes[index] = failed(error);
      }
    }
  };
  const send = async (indexes, policyFor) => {
    indexes.forEach(index => { attempts[index] += 1; });
    const useBatch = () => !_outlinerRestoreBatchUnsupported && indexes.length >= OUTLINER_RESTORE_BATCH_MIN
      && !window.MeldexRuntimeAdapter?.isDropboxMode?.();
    if (!useBatch()) { await sendSingles(indexes, policyFor); return; }
    for (let start = 0; start < indexes.length; start += OUTLINER_RESTORE_BATCH_CHUNK) {
      const chunk = indexes.slice(start, start + OUTLINER_RESTORE_BATCH_CHUNK);
      if (_outlinerRestoreBatchUnsupported) { await sendSingles(chunk, policyFor); continue; }
      try {
        const payload = await apiPost('/outliner/restore-batch', {
          items: chunk.map(index => itemFor(index, policyFor(index))),
        }, { silentError: true, timeoutMs: 600000 });
        const results = Array.isArray(payload?.results) ? payload.results : [];
        chunk.forEach((index, offset) => {
          const row = results[offset];
          if (row?.ok) outcomes[index] = { ok: true, value: row.value || {}, skipped: !!row.skipped };
          else outcomes[index] = failed(null, row?.status, row?.detail ?? '復元の結果を確認できませんでした');
        });
        if (typeof options.onProgress === 'function') options.onProgress(Math.min(start + chunk.length, indexes.length), indexes.length);
      } catch (error) {
        if (error?.status === 404 || error?.status === 405) {
          // 古い本体: まとめての復元が無い。1件ずつ送る。
          _outlinerRestoreBatchUnsupported = true;
          await sendSingles(chunk, policyFor);
        } else {
          chunk.forEach(index => { outcomes[index] = failed(error); });
        }
      }
    }
  };

  await send(list.map((_, index) => index).filter(index => list[index]?.trash_name), () => '');
  let applyAllPolicy = '';
  for (;;) {
    const conflicts = outcomes
      .map((outcome, index) => (outcome && !outcome.ok && _outlinerRestoreConflictDetail(outcome) && attempts[index] < 4 ? index : -1))
      .filter(index => index >= 0);
    if (!conflicts.length) break;
    const decided = new Map();
    for (let position = 0; position < conflicts.length; position += 1) {
      const index = conflicts[position];
      const detail = _outlinerRestoreConflictDetail(outcomes[index]);
      const choices = Array.isArray(detail.choices) ? detail.choices : [];
      let policy = applyAllPolicy && choices.includes(applyAllPolicy) ? applyAllPolicy : '';
      if (!policy) {
        const answer = await ask(detail, conflicts.length - position - 1);
        if (!answer) {
          // 中止: 残りは戻さない（ゴミ箱に残る）
          conflicts.slice(position).forEach(rest => { outcomes[rest] = { ok: true, skipped: true, conflict: true }; });
          break;
        }
        policy = answer.policy;
        if (answer.applyAll) applyAllPolicy = policy;
      }
      if (policy === 'skip') outcomes[index] = { ok: true, skipped: true, conflict: true };
      else decided.set(index, policy);
    }
    if (!decided.size) break;
    await send([...decided.keys()], index => decided.get(index));
  }
  return outcomes;
}

if (typeof window !== 'undefined') {
  window.MeldexRestoreConflict = {
    ask: askRestoreConflict,
    detail: _outlinerRestoreConflictDetail,
    restoreTrashRefs: restoreTrashRefsWithConflicts,
  };
}

async function _restoreOutlinerDeleteRecords(records) {
  const restored = [];
  const failures = [];
  const skipped = [];
  const pending = (records || []).filter(record => record?.deleted && record.trashRef?.trash_name);
  const outcomes = await restoreTrashRefsWithConflicts(pending.map(record => record.trashRef));
  pending.forEach((record, index) => {
    const outcome = outcomes[index];
    if (outcome?.ok && outcome.skipped) {
      skipped.push(record);   // 利用者が戻さないと選んだ（ゴミ箱に残る）
    } else if (outcome?.ok) {
      const result = outcome.value;
      record.currentPath = result?.restored_to || result?.restored_path || record.item.path;
      record.deleted = false;
      restored.push(result);
    } else {
      const error = outcome?.error || new Error('復元できませんでした');
      failures.push({ record, error });
    }
  });
  return { restored, failures, skipped };
}

async function _runOutlinerDeleteHistoryRefresh(refresh, phase, result, refreshSuccessfulRedo = false) {
  // Successful Redo already updated the tree model and DOM through pending deletion.
  if (phase === 'redo' && !result?.failedCount && !result?.skippedCount && !refreshSuccessfulRedo) return;
  if (typeof refresh === 'function') {
    await refresh(phase, result);
    return;
  }
  const jobs = [];
  if (typeof loadOutliner === 'function') jobs.push(Promise.resolve(loadOutliner()).catch(() => {}));
  if (typeof renderHomeFolderTree === 'function') jobs.push(Promise.resolve(renderHomeFolderTree()).catch(() => {}));
  if (typeof renderWorkspaceSidebar === 'function') jobs.push(Promise.resolve(renderWorkspaceSidebar()).catch(() => {}));
  if (typeof _folderPath !== 'undefined' && _folderPath && typeof openFolder === 'function') {
    jobs.push(Promise.resolve(openFolder(_folderPath.split('/').pop() || _folderPath, _folderPath, { ...(typeof _folderSurfaceOpts === 'function' ? _folderSurfaceOpts() : {}),
      skipShowView: true,
      skipSaveLastView: true,
      skipNavPush: true,
      skipHighlight: true,
      skipGlobalUi: true,
    })).catch(() => {}));
  }
  await Promise.allSettled(jobs);
}

// ファイル・フォルダ・シートを作る操作（新規作成・別名で保存・複製）を取り消せるようにする（2026-11-21 ユーザー決定）。
// 取り消しは作ったものをゴミ箱へ移し、やり直しはゴミ箱から戻す（通常の削除と同じ参照の確認を通す）。
function pushCreatedOutlinerItemHistory(item, label, options = {}) {
  if (typeof historyPush !== 'function' || !item?.path) return null;
  const current = { ...item };
  let trashRef = null;
  // 種類の決め方は通常の削除（_deleteOutlinerTargetsSequentially）と同じ（シートは file として扱う）
  const kind = current.kind === 'folder' || current.type === 'folder' ? 'folder' : 'file';
  const refresh = async (phase) => {
    if (typeof options.refresh === 'function') { await options.refresh(phase, current); return; }
    await _runOutlinerDeleteHistoryRefresh(null, 'undo', {});
  };
  const entry = historyPush(label,
    async () => {
      const warning = typeof MeldexDeleteImpactWarning !== 'undefined' ? MeldexDeleteImpactWarning : null;
      const confirmation = warning?.authorizeReversibleDelete
        ? await warning.authorizeReversibleDelete([{ path: current.path, kind }])
        : { confirmed: true, operation: 'trash' };
      if (!confirmation) throw new Error('参照の確認ができなかったため取り消しを中止しました');
      const [result] = await _deleteOutlinerTargetsSequentially([{ ...current, kind }], { confirmation });
      if (result?.status !== 'fulfilled') throw new Error(String(result?.reason?.message || result?.reason || '作ったものをゴミ箱へ移せませんでした'));
      trashRef = _outlinerTrashRefFromResponse(result.value);
      if (!trashRef) throw new Error('作ったものをゴミ箱へ移せませんでした');
      if (typeof options.onUndo === 'function') { try { await options.onUndo(current); } catch {} }
      await refresh('undo');
    },
    async () => {
      if (!trashRef) throw new Error('ゴミ箱の項目が見つかりません');
      const restored = await apiPost('/outliner/restore', {
        trash_name: trashRef.trash_name,
        ...(trashRef.trash_root ? { trash_root: trashRef.trash_root } : {}),
      });
      current.path = restored?.restored_to || restored?.restored_path || current.path;
      trashRef = null;
      await refresh('redo');
    },
    options.scope ?? (typeof _historyActiveScope !== 'undefined' ? _historyActiveScope : ''));
  // 取り消すと作ったファイルを消す。別の画面からの Ctrl+Z で消さないための印（共通履歴の守りが使う）。
  if (typeof historyMarkFileEffects === 'function') historyMarkFileEffects(entry, { undoDeletes: [current.path] });
  return entry;
}

// 多数の項目の削除は、この件数ずつに分けて送る（参照の確認 → /outliner/delete-batch を塊ごとに行う）。
// 1回の要求に数千件を載せると、応答までの間に進み具合が分からず、時間切れになると全体の結果が分からなくなる。
const OUTLINER_DELETE_BATCH_CHUNK = 100;

function _outlinerDeleteNeedsChunks(targets, options) {
  return !options?.confirmation && targets.length > OUTLINER_DELETE_BATCH_CHUNK
    && typeof MeldexDeleteImpactWarning !== 'undefined' && !window.MeldexRuntimeAdapter?.isDropboxMode?.();
}

async function _deleteOutlinerTargetsInChunks(targets, options = {}) {
  const progress = window.MeldexImportProgress;
  const token = progress?.beginOperation?.('ファイルを削除中', targets.length, { delayMs: 0, kind: 'file-delete' });
  const results = [];
  let stopped = null;
  try {
    for (let start = 0; start < targets.length; start += OUTLINER_DELETE_BATCH_CHUNK) {
      const chunk = targets.slice(start, start + OUTLINER_DELETE_BATCH_CHUNK);
      if (stopped) {
        chunk.forEach(item => { try { options.onFailure?.(item, stopped); } catch {} results.push({ status: 'rejected', reason: stopped }); });
        continue;
      }
      // 参照の確認は塊ごとに取る（確認の控えは、その塊の項目にだけ有効）
      const confirmation = await MeldexDeleteImpactWarning.authorizeReversibleDelete(chunk.map(item => ({
        path: item.path, kind: item.type === 'folder' || item.kind === 'folder' ? 'folder' : 'file',
        ...(item.assetId ? { assetId: item.assetId } : {}),
      })));
      if (!confirmation) {
        // 確認できなかった塊と、その後の塊は削除しない（すでに削除した塊は成功のまま扱う）
        stopped = '参照の確認に失敗したため削除を中止しました';
        chunk.forEach(item => { try { options.onFailure?.(item, stopped); } catch {} results.push({ status: 'rejected', reason: stopped }); });
        continue;
      }
      if (typeof purgeAppPathReferences === 'function') purgeAppPathReferences(chunk.map(item => item.path));
      const chunkResults = await _deleteOutlinerTargetsSequentially(chunk, { ...options, confirmation });
      results.push(...chunkResults);
      progress?.updateOperation?.(results.length, null, token);
    }
  } finally {
    const failed = results.filter(result => result.status !== 'fulfilled').length + Math.max(0, targets.length - results.length);
    progress?.finishOperation?.(token, {
      failed,
      label: failed ? '削除' : `${targets.length}件を削除しました`,
      summary: failed ? `${targets.length - failed}件を削除・${failed}件は削除できませんでした（元の場所に残っています）` : '',
    });
  }
  return results;
}

async function deleteOutlinerItemsWithHistory(items, options = {}) {
  const requestedTargets = (Array.isArray(items) ? items : []).filter(item => item && item.path);
  if (requestedTargets.some(item => item.linked)) {
    if (typeof showStatus === 'function') showStatus('リンク表示中の項目は実ファイルとして削除できません。表示中のフォルダからリンク解除してください', true);
    return { targets: [], requestedTargets, succeeded: [], skipped: requestedTargets, failed: [], failedCount: 0, deletedCount: 0, deletedPaths: [], trashNames: [], trashRefs: [] };
  }
  const targets = _prepareOutlinerDeleteTargets(requestedTargets);
  if (!targets.length) {
    return { targets: [], requestedTargets, succeeded: [], skipped: [], failedCount: 0, deletedCount: 0, deletedPaths: [], trashNames: [] };
  }

  const targetPaths = targets.map(item => item.path).filter(Boolean);
  // 履歴の枠は操作の時点で取る（画面からは先に消えるので、保存の完了を待たずに Ctrl+Z を押すと、
  // 削除ではなくその前の操作が取り消されていた: 2026-11-22 M-014 フォルダツリー網羅テスト。v0.7.529 のシートと同じ型）。
  // 枠は取り消し・やり直しの側で中身が入るまで待たれる。削除できなかった時は枠を外す。
  const historyReservation = typeof historyReserve === 'function'
    ? historyReserve(options.label || (targets.length + ' 件を削除'), options.scope || '', options.detail || targetPaths.join(', '))
    : null;
  try {
  _markOutlinerDeletePending(targetPaths, { preserveReferences: true });
  if (typeof options.onOptimisticDelete === 'function') {
    try { options.onOptimisticDelete(targets); } catch {}
  }

  // 件数が多い時は、参照の確認と削除を塊ごとに行う（呼び出し元が確認済みの控えを渡した時は、従来どおり1回で送る）
  const deleteInChunks = typeof _outlinerDeleteNeedsChunks === 'function' && _outlinerDeleteNeedsChunks(targets, options);
  const confirmation = deleteInChunks ? { confirmed: true, operation: 'trash', chunked: true } : options.confirmation || (typeof MeldexDeleteImpactWarning !== 'undefined'
    ? await MeldexDeleteImpactWarning.authorizeReversibleDelete(targets.map(item => ({
      path: item.path, kind: item.type === 'folder' || item.kind === 'folder' ? 'folder' : 'file',
      ...(item.assetId ? { assetId: item.assetId } : {}),
    }))) : { confirmed: true, operation: 'trash' });
  if (!confirmation) {
    _clearOutlinerDeletePending(targetPaths);
    const failed = targets.map(item => ({ ...item, error: '参照の確認に失敗したため削除を中止しました' }));
    await _runOutlinerDeleteHistoryRefresh(options.refresh, 'failure', { failed, failedPaths: targetPaths });
    historyReservation?.cancel();
    return { targets, requestedTargets, succeeded: [], skipped: [], failed, failedCount: targets.length, deletedCount: 0, deletedPaths: [], trashNames: [], trashRefs: [] };
  }
  // 確認が済むまでは、未保存のエディタやタブの参照を保つ（塊ごとに削除する時は、塊の確認が済んでから外す）。
  if (!deleteInChunks && typeof purgeAppPathReferences === 'function') purgeAppPathReferences(targetPaths);

  const results = await (deleteInChunks ? _deleteOutlinerTargetsInChunks : _deleteOutlinerTargetsSequentially)(targets, {
    ...(deleteInChunks ? {} : { confirmation }),
    onSuccess: (item, response) => {
      if (typeof options.onItemDeleted === 'function') options.onItemDeleted(item, response);
    },
    onFailure: (item, reason) => {
      if (typeof options.onItemDeleteFailed === 'function') options.onItemDeleteFailed(item, reason);
    },
  });
  const succeeded = [];
  const skipped = [];
  const failed = [];
  results.forEach((result, index) => {
    const trashRef = result.status === 'fulfilled' ? _outlinerTrashRefFromResponse(result.value) : null;
    if (!trashRef) {
      if (result.status === 'fulfilled' && result.value?.ok) skipped.push(targets[index]);
      else failed.push({ ...targets[index], error: result.reason });
      return;
    }
    succeeded.push({ ...targets[index], ...trashRef });
  });
  const deletedPaths = succeeded.map(item => item.path);
  const deletedCount = requestedTargets.filter(item => deletedPaths.some(path => _isOutlinerPathWithin(item.path, path))).length || succeeded.length;
  const failedCount = targets.length - succeeded.length - skipped.length;
  _clearOutlinerDeletePending(targetPaths);
  if (deletedPaths.length && typeof purgeAppPathReferences === 'function') {
    purgeAppPathReferences(deletedPaths);
  }
  if (failed.length) {
    await _runOutlinerDeleteHistoryRefresh(options.refresh, 'failure', {
      succeeded,
      skipped,
      failed,
      deletedPaths,
      failedPaths: failed.map(item => item.path),
    });
  }

  const deleteRecords = succeeded.map(item => ({
    item,
    currentPath: item.path,
    deleted: true,
    trashRef: _outlinerTrashRefFromResponse(item),
  }));
  let trashRefs = deleteRecords.filter(record => record.deleted).map(record => record.trashRef).filter(Boolean);
  let trashNames = _outlinerTrashRefsToNames(trashRefs);
  if (succeeded.length && typeof historyPush === 'function') {
    const label = options.label || (succeeded.length + ' 件を削除');
    const detail = options.detail || succeeded.map(item => item.path).join(', ');
    const pushDeleteEntry = () => historyPush(
      label,
      async () => {
        const { restored, failures: restoreFailures } = await _restoreOutlinerDeleteRecords(deleteRecords);
        trashRefs = deleteRecords.filter(record => record.deleted).map(record => record.trashRef).filter(Boolean);
        trashNames = _outlinerTrashRefsToNames(trashRefs);
        await _runOutlinerDeleteHistoryRefresh(options.refresh, 'undo', {
          succeeded,
          deletedPaths: deleteRecords.filter(record => record.deleted).map(record => record.currentPath),
          trashNames,
          failedCount: restoreFailures.length,
        });
        if (restoreFailures.length) {
          throw new Error(`${restoreFailures.length} 件を復元できませんでした。成功した項目は再試行しません`);
        }
        if (typeof showStatus === 'function') {
          const kept = deleteRecords.filter(record => record.deleted).length;
          showStatus(restored.length + ' 件を復元しました' + (kept ? `（${kept} 件は戻さず、ゴミ箱に残しました）` : ''));
        }
      },
      async () => {
        const pendingRecords = deleteRecords.filter(record => !record.deleted);
        if (!pendingRecords.length) return true;
        const redoTargets = pendingRecords.map(record => ({
          path: record.currentPath,
          kind: record.item.type === 'folder' || record.item.kind === 'folder' ? 'folder' : 'file',
          ...(record.item.assetId ? { assetId: record.item.assetId } : {}),
        }));
        const confirmed = typeof MeldexDeleteImpactWarning !== 'undefined'
          ? await MeldexDeleteImpactWarning.authorizeReversibleDelete(redoTargets)
          : { confirmed: true, operation: 'trash' };
        if (!confirmed) throw new Error('削除の参照確認に失敗しました');
        const confirmationPayload = typeof MeldexDeleteImpactWarning !== 'undefined'
          ? MeldexDeleteImpactWarning.confirmationPayload(confirmed)
          : {};
        const redoFailures = [];
        let redoSkippedCount = 0;
        const pendingPaths = pendingRecords.map(record => record.currentPath);
        if (pendingPaths.length) _markOutlinerDeletePending(pendingPaths);
        for (const record of pendingRecords) {
          const item = record.item;
          const res = await apiPost('/outliner/delete', {
            path: record.currentPath,
            kind: item.type === 'folder' || item.kind === 'folder' ? 'folder' : 'file',
            ...(item.assetId ? { assetId: item.assetId } : {}),
            ...confirmationPayload,
          }).catch(error => {
            redoFailures.push({ item, error });
            return null;
          });
          const ref = _outlinerTrashRefFromResponse(res);
          if (ref) {
            record.trashRef = ref;
            record.deleted = true;
          }
          else if (res) redoFailures.push({ item, error: new Error('取り消しに必要なゴミ箱情報がありません') });
        }
        if (pendingPaths.length) _clearOutlinerDeletePending(pendingPaths);
        trashRefs = deleteRecords.filter(record => record.deleted).map(record => record.trashRef).filter(Boolean);
        trashNames = _outlinerTrashRefsToNames(trashRefs);
        const redonePaths = pendingRecords.filter(record => record.deleted).map(record => record.currentPath);
        if (redonePaths.length && typeof purgeAppPathReferences === 'function') {
          purgeAppPathReferences(redonePaths);
        }
        await _runOutlinerDeleteHistoryRefresh(options.refresh, 'redo', { succeeded, deletedPaths: redonePaths, trashNames, failedCount: redoFailures.length, skippedCount: redoSkippedCount }, !!options.refreshSuccessfulRedo);
        if (redoFailures.length) {
          throw new Error(`${redoFailures.length} 件の削除をやり直せませんでした。成功した項目は再試行しません`);
        }
        if (typeof showStatus === 'function') showStatus(trashNames.length + ' 件を削除しました');
      },
      options.scope || '',
      detail
    );
    const deleteEntry = historyReservation ? historyReservation.capture(pushDeleteEntry) : pushDeleteEntry();
    // やり直すと同じファイルをもう一度消す（共通履歴の守りが使う）。
    if (typeof historyMarkFileEffects === 'function') historyMarkFileEffects(deleteEntry, { redoDeletes: succeeded.map(item => item.path) });
  } else {
    historyReservation?.cancel();
  }

  return { targets, requestedTargets, succeeded, skipped, failed, failedCount, deletedCount, deletedPaths, trashNames, trashRefs };
  } catch (error) {
    _clearOutlinerDeletePending(targetPaths);
    try { await _runOutlinerDeleteHistoryRefresh(options.refresh, 'failure', { failedPaths: targetPaths }); } catch {}
    historyReservation?.cancel();
    throw error;
  }
}

const MAIN_CALENDAR_SETTINGS_KEYS = ['main-calendar-path', 'main-calendar-id'];

function _refreshMainCalendarSettingAfterHistory() {
  if (typeof loadOutliner === 'function') loadOutliner();
  if (typeof renderHomeFolderTree === 'function') renderHomeFolderTree();
}

function _captureMainCalendarSettingsHistory() {
  if (typeof captureLocalStorageSettings !== 'function') return null;
  if (typeof isLocalStorageSettingsHistorySuppressed === 'function'
    && isLocalStorageSettingsHistorySuppressed()) return null;
  return captureLocalStorageSettings(MAIN_CALENDAR_SETTINGS_KEYS);
}

function _pushMainCalendarSettingsHistory(label, beforeSnapshot, detail) {
  if (!beforeSnapshot || typeof historyPush !== 'function'
    || typeof captureLocalStorageSettings !== 'function'
    || typeof restoreLocalStorageSettings !== 'function'
    || typeof _normalizeLocalStorageSettingsSnapshots !== 'function') return false;
  const snapshots = _normalizeLocalStorageSettingsSnapshots(
    beforeSnapshot,
    captureLocalStorageSettings(MAIN_CALENDAR_SETTINGS_KEYS)
  );
  let beforeKey = '';
  let afterKey = '';
  try {
    beforeKey = JSON.stringify(snapshots.before);
    afterKey = JSON.stringify(snapshots.after);
  } catch {}
  if (beforeKey && beforeKey === afterKey) return false;
  historyPush(
    label || 'カレンダー: メインカレンダー設定',
    () => restoreLocalStorageSettings(snapshots.before, _refreshMainCalendarSettingAfterHistory),
    () => restoreLocalStorageSettings(snapshots.after, _refreshMainCalendarSettingAfterHistory),
    'calendar:settings',
    detail || ''
  );
  return true;
}

// --- ホバー追加メニュー ---
function _cloudPhase1CreateItems(items) {
  items = (items || []).filter(item => (Array.isArray(item) ? item[1] : item?.type) !== 'map'
    || typeof MeldexMapDocument !== 'undefined' && MeldexMapDocument.isAvailable());
  return window.MeldexCloudBootstrap?.filterPhase1CreateItems?.(items) || items;
}

function _isCloudPhase1BlockedCreateType(type) {
  if (type === 'map' && (typeof MeldexMapDocument === 'undefined' || !MeldexMapDocument.isAvailable())) return true;
  return !!window.MeldexCloudBootstrap?.isPhase1UnsupportedCreateType?.(type);
}

function _showCloudPhase1BlockedCreate(type) {
  if (window.MeldexCloudBootstrap?.showPhase1Unsupported) return window.MeldexCloudBootstrap.showPhase1Unsupported(type);
  showStatus('ブラウザ版Meldexではまだ未対応の作成タイプです', true);
  return false;
}

const _outlinerContextMenuCleanups = new Set();
let _outlinerContextMenuOpenSeq = 0;

function _outlinerEscHtml(value) {
  return MeldexEscape.html(value);
}

function _outlinerMenuIconHtml(icon, size = 14) {
  if (!icon || typeof lucide !== 'function') return '';
  return '<span class="menu-icon">' + lucide(icon, size) + '</span>';
}

function _outlinerCreateContextMenu(label, x, y) {
  const menu = document.createElement('div');
  menu.className = 'gb-context-menu';
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', label);
  menu.style.left = x + 'px';
  menu.style.top = y + 'px';
  return menu;
}

function _outlinerCreateSubmenu(label) {
  const panel = document.createElement('div');
  panel.className = 'gb-context-menu';
  panel.setAttribute('role', 'menu');
  panel.setAttribute('aria-label', label);
  panel.style.cssText = 'display:none;min-width:140px;';
  return panel;
}

function _outlinerAppendMenuItem(menu, options) {
  const item = document.createElement('button');
  item.type = 'button';
  item.dataset.e2eId = options?.e2eId || ('outliner-menu-' + encodeURIComponent(String(options?.label || options?.title || options?.icon || 'item')));
  item.className = 'gb-context-menu-item' + (options?.danger ? ' danger' : '') + (options?.className ? ' ' + options.className : '');
  item.setAttribute('role', options?.role || 'menuitem');
  if (options?.disabled) {
    item.disabled = true;
    item.classList.add('disabled');
  }
  if (options?.title) {
    item.title = options.title;
    item.dataset.gbTooltip = options.title;
  }
  if (options?.checked) {
    item.classList.add('active');
    item.setAttribute('aria-checked', 'true');
  }
  if (options?.html != null) {
    item.innerHTML = options.html;
  } else {
    const iconName = options?.icon === false ? '' : (options?.icon || window.MeldexMenuIcons?.resolve?.(options?.label) || '');
    item.innerHTML = _outlinerMenuIconHtml(iconName) + '<span>' + _outlinerEscHtml(options?.label || '') + '</span>';
  }
  if (options?.hasSubmenu) {
    item.classList.add('has-submenu');
    item.setAttribute('aria-haspopup', 'menu');
    item.setAttribute('aria-expanded', 'false');
  }
  item.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (item.disabled) return;
    if (typeof options?.action === 'function') {
      void _outlinerRunMenuAction(options.action, event, options?.label || options?.title || '');
    }
  });
  menu.appendChild(item);
  return item;
}

// 失敗の理由を、利用者向けの短い文に整える（通信の状態コードや内部の例外名は出さない）。
function _outlinerFailureReason(error) {
  if (!error) return '';
  if (error.name === 'AbortError') return '中断されました';
  const raw = String(error?.userMessage || error?.message || (typeof error === 'string' ? error : '') || '').trim();
  if (/failed to fetch|networkerror|load failed/i.test(raw)) return 'サーバーに接続できませんでした';
  if (error instanceof TypeError || error instanceof ReferenceError || error instanceof SyntaxError || error instanceof RangeError) {
    return '予期しないエラーが発生しました';
  }
  let text = raw
    .replace(/^HTTP\s*\d+\s*:\s*/i, '')
    .replace(/\(\d+秒\)\s*:\s*\S+$/, '')
    .replace(/https?:\/\/\S+/g, '')
    .trim();
  if (text.length > 120) text = text.slice(0, 120) + '…';
  return text;
}

function _outlinerReportFailure(message, error) {
  const reason = _outlinerFailureReason(error);
  if (typeof showStatus === 'function') showStatus(reason ? `${message}：${reason}` : message, true);
}

// 右クリックメニューの実行。非同期の処理も待ち、失敗を握り潰さずに原因つきで表示する。
async function _outlinerRunMenuAction(action, event, label) {
  try {
    return await action(event);
  } catch (error) {
    if (typeof console !== 'undefined') console.error('[outliner menu] 実行に失敗', error);
    _outlinerReportFailure(label ? `「${label}」を実行できませんでした` : '操作を実行できませんでした', error);
    return undefined;
  }
}

// 複数項目の複製。部分失敗も件数と最初の原因を返し、表示で握り潰さない。
// フォルダパネルが同じフォルダを開いていれば、そのフォルダを読み直す（ツリーでの作成・改名・削除・複製・移動を
// フォルダパネルにもすぐ出す。以前は次の読み直しまで出ず、改名・削除は出ないままだった: 2026-11-22 M-014 横断の検査）。
function _outlinerFolderPanelShows(folderPaths) {
  if (typeof state === 'undefined' || state.view !== 'folder' || typeof _folderPath === 'undefined' || !_folderPath) return false;
  const current = String(_folderPath).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  return (folderPaths || []).some(path => {
    const p = String(path || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
    return !!p && (p === current || current.endsWith('/' + p) || p.endsWith('/' + current));
  });
}

async function _outlinerRefreshFolderPanelFor(folderPaths) {
  if (!_outlinerFolderPanelShows(folderPaths) || typeof _folderRefreshCurrentFolder !== 'function') return;
  try { await _folderRefreshCurrentFolder(); } catch (error) { console.warn('[outliner] フォルダパネルの更新に失敗しました', error); }
}

// 1つのフォルダの子だけを保存先の一覧に合わせる（複製・貼り付けの後の差分反映）。
// 以前は複製・貼り付けのたびにツリー全体を読み直し、反映まで1.3〜2.5秒かかっていた（app/AGENTS.md の0.3秒の目安を
// 大きく超える。2026-11-22 M-014 フォルダツリー網羅テスト）。開いていない（未読込の）フォルダは何もしない
// （開いた時に読む）。仮想化した大きなフォルダ・読めなかった時は false を返し、呼び出し側が全体を読み直す。
async function _outlinerSyncFolderChildren(folderPath) {
  // ホームフォルダの直下はホームの節に並ぶ（フォルダの行が無い）ので、ホームの節を読み直す
  if (typeof _homeFolderPath !== 'undefined' && _homeFolderPath && String(folderPath) === String(_homeFolderPath)) {
    if (typeof renderHomeFolderTree === 'function') await renderHomeFolderTree({ force: true, reason: 'outliner-sync' });
    return true;
  }
  const parentNode = typeof _findTreeNodeByPath === 'function' ? _findTreeNodeByPath(folderPath) : null;
  if (!parentNode) return true;
  const container = parentNode.querySelector(':scope > .tree-children');
  if (!container || container.dataset.loaded !== 'true') return true;
  if (container.dataset.virtual === 'true') return false;
  const sortCfg = getSortForFolder(folderPath);
  const items = await _outlinerFetchFolderListingForConfirm(folderPath, parentNode, {
    detail: !['manual', 'name'].includes(sortCfg.sort),
  });
  if (!Array.isArray(items) || !container.isConnected) return false;
  const ordered = sortCfg.sort === 'manual' ? _sortItemsByManualOrder(items, folderPath)
    : [...items].sort((a, b) => compareItemsForFolderSort(a, b, sortCfg.sort, sortCfg.order));
  const existing = new Map();
  container.querySelectorAll(':scope > .tree-node').forEach(node => {
    const path = node._nodeData?.path;
    if (path && !node.classList.contains('tree-node-pending-create')) existing.set(path, node);
  });
  const keep = new Set();
  let previous = null;
  for (const item of ordered) {
    if (!item?.path) continue;
    let node = existing.get(item.path);
    if (!node) node = createTreeNodeFromBrowse(item);
    keep.add(node);
    const next = previous ? previous.nextSibling : container.firstChild;
    if (node !== next) container.insertBefore(node, next);
    previous = node;
  }
  existing.forEach(node => {
    if (keep.has(node)) return;
    if (typeof _unregisterTreeSubtree === 'function') _unregisterTreeSubtree(node);
    node.remove();
  });
  return true;
}

// 複数のフォルダを差分で反映し、どれかが差分で反映できなければツリー全体を読み直す。
async function _outlinerSyncFoldersOrReload(folderPaths) {
  const unique = Array.from(new Set((folderPaths || []).map(path => String(path || '')).filter(Boolean)));
  let ok = unique.length > 0;
  for (const path of unique) {
    try { if (!(await _outlinerSyncFolderChildren(path))) ok = false; }
    catch (error) { console.warn('[outliner] 差分の反映に失敗しました', error); ok = false; }
  }
  if (!ok && typeof loadOutliner === 'function') await loadOutliner();
  await _outlinerRefreshFolderPanelFor(unique);
  return ok;
}

function _outlinerParentPath(path) {
  const value = String(path || '').replace(/[\\/]+$/, '');
  const cut = Math.max(value.lastIndexOf('/'), value.lastIndexOf('\\'));
  return cut >= 0 ? value.slice(0, cut) : '';
}

// 保存済みの移動を差分で反映する。失敗した項目の行は動かさず、残りの一覧は後で照合する。
function _outlinerApplyCommittedMove(oldPath, newPath, name, fileId) {
