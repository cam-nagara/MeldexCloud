      }
    } else if (data.children) {
      node.children = data.children;
    }
    if (data.type !== 'entity') {
      tree.push(node);
    }
  });
  return tree;
}

async function saveOutlinerTree() {
  // ルートフォルダベースではファイルシステムがツリー構造そのもの。
  // D&Dによる並べ替えは localStorage のマニュアル順として永続化する。
}

function _normalizeOutlinerPathForCompare(path) {
  return String(path || '').replace(/\\/g, '/').replace(/\/+$/, '');
}

function _isOutlinerPathWithin(path, basePath) {
  const normalizedPath = _normalizeOutlinerPathForCompare(path);
  const normalizedBase = _normalizeOutlinerPathForCompare(basePath);
  if (!normalizedPath || !normalizedBase) return false;
  if (normalizedPath === normalizedBase || normalizedPath.startsWith(normalizedBase + '/')) return true;
  return false;
}

// /outliner-roots のGET直後に呼び、以後の in-place 書き換え（名前変更・パス変更）に
// 影響されないディープコピーの控えを作る。フォルダツリー右クリックの「名前を変更」
// 「パスを変更」は取得した root オブジェクトを直接書き換えるため、浅いコピーでは
// baseRoots が変更後の値と同じになってしまい、サーバー側の台帳削除印(tombstone)
// 判定の基準として使えない。
function _cloneOutlinerRootsForBase(roots) {
  try {
    return JSON.parse(JSON.stringify(Array.isArray(roots) ? roots : []));
  } catch {
    return [];
  }
}

// フォルダツリー右クリック（名前を変更・このソースフォルダの登録を解除・パスを変更）から
// /outliner-roots を保存する共通ヘルパー。baseRoots には直前のGETで実際に見ていた
// 一覧のディープコピー（_cloneOutlinerRootsForBase の戻り値）を渡すこと。
// これを送らないと、共有台帳合流分（他端末・クラウド版が追加したroot）の削除が
// サーバー側で検出できず、次回のフォルダツリー読み込みで復活してしまう。
async function _putOutlinerRootsWithBase(nextRoots, baseRoots) {
  return apiPut('/outliner-roots', { roots: nextRoots, baseRoots });
}

const _outlinerPendingDeletePaths = new Set();

function _isOutlinerFreeLayoutUiEnabled() {
  if (typeof GBLayout === 'undefined') return true;
  return typeof GBLayout.isFreeLayoutUiEnabled === 'function'
    ? !!GBLayout.isFreeLayoutUiEnabled()
    : true;
}

function isOutlinerDeletePendingPath(path) {
  const normalizedPath = _normalizeOutlinerPathForCompare(path);
  if (!normalizedPath || !_outlinerPendingDeletePaths.size) return false;
  for (const pendingPath of _outlinerPendingDeletePaths) {
    if (_isOutlinerPathWithin(normalizedPath, pendingPath)) return true;
  }
  return false;
}

function _setOutlinerDeletePending(paths, pending) {
  const normalizedPaths = (paths || []).map(_normalizeOutlinerPathForCompare).filter(Boolean);
  normalizedPaths.forEach(path => {
    if (pending) _outlinerPendingDeletePaths.add(path);
    else _outlinerPendingDeletePaths.delete(path);
  });
  return normalizedPaths;
}

function _prepareOutlinerDeleteTargets(items) {
  const seen = new Set();
  const unique = (Array.isArray(items) ? items : [])
    .filter(item => item && item.path)
    .map(item => ({
      name: item.name || item.label || String(item.path).split('/').pop() || '',
      path: item.path,
      type: item.type || 'page',
      ...((item.assetId || item.asset_id) ? { assetId: String(item.assetId || item.asset_id) } : {}),
      _comparePath: _normalizeOutlinerPathForCompare(item.path),
    }))
    .filter(item => {
      if (!item._comparePath || seen.has(item._comparePath)) return false;
      seen.add(item._comparePath);
      return true;
    })
    .sort((a, b) => a._comparePath.split('/').length - b._comparePath.split('/').length);
  const roots = [];
  unique.forEach(item => {
    if (roots.some(root => _isOutlinerPathWithin(item._comparePath, root._comparePath))) return;
    roots.push(item);
  });
  return roots.map(({ _comparePath, ...item }) => item);
}

async function _deleteOutlinerTargetsSequentially(targets, options = {}) {
  const batchTargets = (Array.isArray(targets) ? targets : []).filter(item => item && item.path);
  const confirmationPayload = typeof MeldexDeleteImpactWarning !== 'undefined'
    ? MeldexDeleteImpactWarning.confirmationPayload(options.confirmation)
    : {};
  if (batchTargets.length) {
    try {
      const payload = await apiPost('/outliner/delete-batch', {
        items: batchTargets.map(item => ({
          path: item.path,
          kind: item.kind === 'folder' || item.type === 'folder' ? 'folder' : 'file',
          ...(item.assetId ? { assetId: item.assetId } : {}),
          ...((item.entry_id || item.entryId) ? { expected_entry_id: item.entry_id || item.entryId,
            expected_entry_name: item.name || undefined } : {}),
        })),
        ...confirmationPayload,
      }, { silentError: options.silentError === true });
      const batchResults = Array.isArray(payload?.results) ? payload.results : [];
      if (batchResults.length === batchTargets.length) {
        return batchResults.map((entry, index) => {
          const item = batchTargets[index];
          if (entry?.ok) {
            const value = entry.value || { ok: true };
            const trashRef = _outlinerTrashRefFromResponse(value);
            if (trashRef && typeof options.onSuccess === 'function') {
              try { options.onSuccess(item, value); } catch {}
            }
            return { status: 'fulfilled', value };
          }
          const reason = entry?.detail || entry?.error || '削除に失敗しました';
          if (typeof options.onFailure === 'function') {
            try { options.onFailure(item, reason); } catch {}
          }
          return { status: 'rejected', reason };
        });
      }
      throw new Error('削除結果を確認できませんでした。フォルダツリーを更新して状態を確認してください。');
    } catch (reason) {
      // Only an absent legacy endpoint permits a single-item fallback. A token
      // may already be consumed after a conflict, timeout or uncertain response.
      if (![404, 405].includes(Number(reason?.status))) {
        return batchTargets.map(item => {
          try { options.onFailure?.(item, reason); } catch {}
          return { status: 'rejected', reason };
        });
      }
    }
  }
  const results = [];
  for (const item of targets) {
    try {
      const value = await apiPost('/outliner/delete', {
        path: item.path,
        kind: item.kind === 'folder' || item.type === 'folder' ? 'folder' : 'file',
        ...(item.assetId ? { assetId: item.assetId } : {}),
        ...((item.entry_id || item.entryId) ? { expected_entry_id: item.entry_id || item.entryId,
          expected_entry_name: item.name || undefined } : {}),
        ...confirmationPayload,
      }, { silentError: options.silentError === true });
      results.push({ status: 'fulfilled', value });
      const trashRef = _outlinerTrashRefFromResponse(value);
      if (trashRef && typeof options.onSuccess === 'function') {
        try { options.onSuccess(item, value); } catch {}
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
  if (!newPath || oldPath === newPath || typeof _findTreeNodeByPath !== 'function') return;
  const node = _findTreeNodeByPath(oldPath);
  if (!node) return;
  const parent = _findTreeNodeByPath(_outlinerParentPath(newPath));
  const children = parent?.querySelector(':scope > .tree-children');
  if (node.parentElement?.dataset.virtual === 'true') return;
  if (children?.dataset.loaded === 'true' && children.dataset.virtual !== 'true') {
    if (typeof _renameTreeNode === 'function') _renameTreeNode(oldPath, newPath, name, fileId);
    children.appendChild(node);
  } else {
    if (typeof _unregisterTreeSubtree === 'function') _unregisterTreeSubtree(node);
    node.remove();
  }
}

function isOutlinerCopyPendingPath(path) {
  return [..._outlinerPendingCopyPreviews].some(record => typeof _folderDropPathsEqual === 'function'
    ? _folderDropPathsEqual(record.path, path)
    : _normalizeOutlinerPathForCompare(record.path) === _normalizeOutlinerPathForCompare(path));
}

function _outlinerSetCopyPendingNode(node, pending) {
  if (!node) return;
  if (pending && node.dataset.copyPending !== 'true') {
    node._copyPreviewPrevious = { inert: node.inert, opacity: node.style.opacity };
    node.dataset.copyPending = 'true'; node.inert = true; node.style.opacity = '0.62';
    node.setAttribute('aria-busy', 'true');
  } else if (!pending && node.dataset.copyPending === 'true') {
    node.inert = node._copyPreviewPrevious?.inert || false;
    node.style.opacity = node._copyPreviewPrevious?.opacity || '';
    delete node._copyPreviewPrevious; delete node.dataset.copyPending;
    node.removeAttribute('aria-busy');
  }
}

function _beginOutlinerPublishedCopyPreview(item, detail) {
  const path = detail.new_path;
  const parent = _outlinerParentPath(path);
  const same = other => typeof _folderDropPathsEqual === 'function' ? _folderDropPathsEqual(path, other) : path === other;
  const findNode = () => (typeof _findTreeNodeByPath === 'function' ? _findTreeNodeByPath(path) : null)
    || Array.from(document.querySelectorAll('.tree-node[data-path]')).find(node => same(node.dataset.path));
  const hadTree = !!findNode();
  const hadPanel = typeof _folderItems !== 'undefined' && _folderItems.some(row => same(row.path));
  const record = { path }; _outlinerPendingCopyPreviews.add(record);
  let finished = false;
  const finish = outcome => {
    if (finished) return; finished = true; _outlinerPendingCopyPreviews.delete(record);
    if (outcome === 'abandon') return; // 接続切替後の別アカウントの表示には触れない。
    const stillPending = isOutlinerCopyPendingPath(path);
    if (outcome === false && !stillPending) {
      if (!hadPanel && typeof _removeFolderItemsForPaths === 'function') _removeFolderItemsForPaths([path]);
      if (!hadTree && typeof _removeOutlinerNodesForPaths === 'function') _removeOutlinerNodesForPaths([path]);
    }
    _outlinerSetCopyPendingNode(findNode(), stillPending);
    if (typeof _folderPath !== 'undefined' && typeof _folderDropPathsEqual === 'function' && _folderDropPathsEqual(_folderPath, parent)) {
      renderFolderGrid({ preserveSelectedPaths: (typeof _folderSelectedItems !== 'undefined' ? _folderSelectedItems : []).map(row => row.path) });
    }
  };
  try {
    _folderApplySavedDropResults(parent, [{ item: { path, name: detail.new_name || item.name,
      type: item.type || 'page', kind: item.type === 'folder' ? 'folder' : 'file' } }], []);
    _outlinerSetCopyPendingNode(findNode(), true);
  } catch (error) { try { finish(false); } catch {} console.warn('[copy preview] 表示に失敗', error); }
  return finish;
}

function _outlinerRevealCopyDestination(path) {
  const node = (typeof _findTreeNodeByPath === 'function' ? _findTreeNodeByPath(path) : null)
    || Array.from(document.querySelectorAll('.tree-node[data-path]')).find(node => _folderDropPathsEqual(node.dataset.path, path));
  const toggle = node?.querySelector(':scope > .tree-node-row > .tree-toggle');
  if (toggle && toggle.dataset.expanded !== 'true') toggle.click();
}

async function _outlinerPostCopyWithPreview(route, body, item, options = {}) {
  if (typeof window.addEventListener !== 'function' || typeof window.removeEventListener !== 'function') return apiPost(route, body);
  const prepared = window.MeldexStableCopyOperationIds?.prepare?.(route, body)
    || { body: { ...body, operation_id: crypto.randomUUID() }, key: '' };
  const origin = typeof state !== 'undefined' ? state.vaultPath : '';
  let active = true, succeeded = false, finishPreview = null;
  const abandon = () => {
    active = false;
    try { finishPreview?.('abandon'); } catch {} finishPreview = null;
  };
  const published = event => {
    const detail = event.detail || {};
    if (!active || finishPreview || detail.operation_id !== prepared.body.operation_id || !detail.new_path) return;
    if ((typeof state !== 'undefined' ? state.vaultPath : '') !== origin) { abandon(); return; }
    try { finishPreview = _beginOutlinerPublishedCopyPreview(item, detail); }
    catch (error) { console.warn('[copy preview] 表示に失敗', error); }
  };
  window.addEventListener('meldex:copy-published', published);
  window.addEventListener('meldex:dropbox-auth-session-changed', abandon);
  window.addEventListener('meldex:mode-changed', abandon);
  try {
    if (options.revealTreeDestination) _outlinerRevealCopyDestination(body.dest_folder || _outlinerParentPath(body.path));
    const result = await apiPost(route, prepared.body);
    succeeded = result?.ok !== false;
    if (succeeded && active) window.MeldexStableCopyOperationIds?.complete?.(prepared.key);
    return result;
  } finally {
    window.removeEventListener('meldex:copy-published', published);
    window.removeEventListener('meldex:dropbox-auth-session-changed', abandon);
    window.removeEventListener('meldex:mode-changed', abandon);
    try { finishPreview?.(succeeded); } catch (error) { console.warn('[copy preview] 表示の確定に失敗', error); }
  }
}

async function _outlinerDuplicateItems(items, options = {}) {
  const result = { ok: 0, failed: 0, error: null, created: [] };
  // 複製を取り消せるようにする（作ったものをゴミ箱へ移す。2026-11-21 ユーザー決定の「作る操作は取り消せる」。
  // ツール・メニューの複製は記録していたが、フォルダツリー・フォルダパネルの右クリックの複製は記録していなかった:
  // 2026-11-22 M-014 フォルダツリー網羅テスト）。複数を一度に複製した時は1回の取り消しで全部を戻す。
  const historyScope = '';
  const createdItems = [];
  const reservation = typeof historyReserve === 'function' ? historyReserve('複製', historyScope) : null;
  try {
  const targets = Array.from(items || []);
  for (let offset = 0; offset < targets.length; offset += 2) {
    const outcomes = await Promise.all(targets.slice(offset, offset + 2).map(async target => {
      try { return { target, res: await _outlinerPostCopyWithPreview('/outliner/duplicate', { path: target.path }, target, options) }; }
      catch (error) { return { target, error }; }
    }));
    for (const { target, res, error } of outcomes) {
      if (error) { result.failed += 1; if (!result.error) result.error = error; continue; }
      result.ok += 1;
      const createdPath = res?.new_path || '';
      if (createdPath) {
        result.created.push(createdPath);
        createdItems.push({ path: createdPath, type: target.type || '', kind: target.type === 'folder' ? 'folder' : 'file',
          name: res?.new_name || createdPath.split('/').pop() || createdPath });
        try {
          if (typeof _folderApplySavedDropResults === 'function') {
            _folderApplySavedDropResults(_outlinerParentPath(createdPath), [{ item: createdItems[createdItems.length - 1] }], []);
          }
        } catch (error) { console.warn('[duplicate] 保存済みの表示反映に失敗', error); }
      }
    }
  }
  const register = () => {
  if (createdItems.length === 1 && typeof pushCreatedOutlinerItemHistory === 'function') {
    pushCreatedOutlinerItemHistory(createdItems[0], '複製: ' + createdItems[0].name, { scope: historyScope, ...(typeof options.refresh === 'function' ? { refresh: options.refresh } : {}) });
  } else if (createdItems.length > 1) {
    _pushCreatedOutlinerItemsHistory(createdItems, `複製: ${createdItems.length} 件`, historyScope, options);
  }
  };
  if (reservation) reservation.capture(register); else register();
  return result;
  } finally { reservation?.cancel(); }
}

// 複数の作ったものを1つの取り消しの記録にする（取り消し=全部をゴミ箱へ、やり直し=ゴミ箱から全部戻す）。
function _pushCreatedOutlinerItemsHistory(createdItems, label, scope, options = {}) {
  if (typeof historyPush !== 'function' || !createdItems.length) return null;
  const records = createdItems.map(item => ({ ...item, trashRef: null }));
  const refresh = async () => {
    if (typeof options.refresh === 'function') { await options.refresh(); return; }
    await _outlinerSyncFoldersOrReload(records.map(record => _outlinerParentPath(record.path)));
  };
  const entry = historyPush(label,
    async () => {
      // 一部だけ移せた時も、成功した画像のごみ箱参照を保持して残りだけを再試行する。
      const pending = records.filter(record => !record.trashRef);
      if (!pending.length) { await refresh(); return; }
      const targets = pending.map(record => ({ path: record.path, kind: record.kind }));
      const warning = typeof MeldexDeleteImpactWarning !== 'undefined' ? MeldexDeleteImpactWarning : null;
      const confirmation = warning?.authorizeReversibleDelete ? await warning.authorizeReversibleDelete(targets) : { confirmed: true, operation: 'trash' };
      if (!confirmation) throw new Error('参照の確認ができなかったため取り消しを中止しました');
      const results = await _deleteOutlinerTargetsSequentially(targets, { confirmation, silentError: true });
      const failures = [];
      pending.forEach((record, index) => {
        const outcome = results[index];
        const ref = outcome?.status === 'fulfilled' ? _outlinerTrashRefFromResponse(outcome.value) : null;
        if (ref) record.trashRef = ref; else failures.push(record);
      });
      await refresh();
      if (failures.length) throw new Error(`${failures.length} 件をゴミ箱へ移せませんでした`);
    },
    async () => {
      const failures = [];
      for (const record of records) {
        if (!record.trashRef) continue;
        try {
          const restored = await apiPost('/outliner/restore', {
            trash_name: record.trashRef.trash_name,
            ...(record.trashRef.trash_root ? { trash_root: record.trashRef.trash_root } : {}),
          }, { silentError: true });
          record.path = restored?.restored_to || restored?.restored_path || record.path;
          record.trashRef = null;
        } catch (error) { failures.push(error); }
      }
      await refresh();
      if (failures.length) throw new Error(`${failures.length} 件をゴミ箱から戻せませんでした`);
    },
    scope);
  if (typeof historyMarkFileEffects === 'function') historyMarkFileEffects(entry, { undoDeletes: records.map(record => record.path) });
  return entry;
}

function _outlinerReportBatchResult(result, verbDone, failMessage) {
  const reason = result.failed ? _outlinerFailureReason(result.error) : '';
  const suffix = reason ? `：${reason}` : '';
  if (!result.failed) {
    showStatus(`${result.ok}件を${verbDone}`);
  } else if (!result.ok) {
    showStatus(`${failMessage}${suffix}`, true);
  } else {
    showStatus(`${result.ok}件を${verbDone}。${result.failed}件は失敗しました${suffix}`, true);
  }
}

async function _outlinerRunDuplicate(items) {
  const result = await _outlinerDuplicateItems(items);
  if (result.ok > 0) {
    // 複製は元と同じフォルダにできる。そのフォルダだけを差分で反映する（全体の読み直しをしない）。
    try { await _outlinerSyncFoldersOrReload((items || []).map(item => _outlinerParentPath(item.path))); }
    catch (error) { console.error('[outliner duplicate] 表示の更新に失敗', error); }
  }
  _outlinerReportBatchResult(result, '複製しました', '複製に失敗しました');
  return result;
}

// ソースフォルダの表示名変更。失敗は原因つきで表示し、成功表示は保存と再読込の後だけ。
async function _outlinerRenameSourceFolder(nodeData) {
  let reservation = null;
  try {
    const roots = await apiFetch('/outliner-roots');
    const baseRoots = _cloneOutlinerRootsForBase(roots);
    const root = roots.find(r => r.path === nodeData.path);
    if (!root) {
      showStatus('名前を変更できませんでした：ソースフォルダの登録が見つかりません', true);
      return false;
    }
    const newName = await cfPrompt('表示名を入力:', root.name);
    if (!newName) return false;
    reservation = typeof historyReserve === 'function' ? historyReserve('設定: ソースフォルダ表示名', '') : null;
    const before = await captureOutlinerRootsSettingsSnapshot();
    root.name = newName;
    await _putOutlinerRootsWithBase(roots, baseRoots);
    const after = { ...before, roots };
    const register = () => pushOutlinerRootsSettingsHistory('設定: ソースフォルダ表示名', before, after, newName, '');
    if (reservation) reservation.capture(register); else register();
    await loadOutliner();
    showStatus('名前を変更しました');
    return true;
  } catch (error) {
    console.warn('[outliner source folder] 名前の変更に失敗（画面に原因を表示済み）', error);
    _outlinerReportFailure('名前を変更できませんでした', error);
    return false;
  } finally {
    reservation?.cancel();
  }
}

async function _outlinerUnregisterSourceFolder(nodeData) {
  let reservation = null;
  try {
    // 実際に消えるのはフォルダツリーの一覧からだけ。フォルダ本体とファイルは
    // 消えない（gb-settings-cloud-link.js の confirmDeleteSourceFolder と同じ言い回しに揃える）。
    if (!await cfConfirm('ソースフォルダ「' + nodeData.name + '」の登録を解除しますか？\n（フォルダとファイルはそのまま残ります。フォルダツリーの一覧から外れるだけです）', { okLabel: '登録解除' })) return false;
    const roots = await apiFetch('/outliner-roots');
    const baseRoots = _cloneOutlinerRootsForBase(roots);
    const newRoots = roots.filter(r => r.path !== nodeData.path);
    if (newRoots.length === roots.length) {
      showStatus('登録を解除できませんでした：ソースフォルダの登録が見つかりません', true);
      return false;
    }
    reservation = typeof historyReserve === 'function' ? historyReserve('設定: ソースフォルダ登録解除', '') : null;
    const before = await captureOutlinerRootsSettingsSnapshot();
    await _putOutlinerRootsWithBase(newRoots, baseRoots);
    const after = { ...before, roots: newRoots };
    const register = () => pushOutlinerRootsSettingsHistory('設定: ソースフォルダ登録解除', before, after, nodeData.name, '');
    if (reservation) reservation.capture(register); else register();
    await loadOutliner();
    showStatus('ソースフォルダの登録を解除しました');
    return true;
  } catch (error) {
    console.warn('[outliner source folder] 登録解除に失敗（画面に原因を表示済み）', error);
    _outlinerReportFailure('ソースフォルダの登録を解除できませんでした', error);
    return false;
  } finally {
    reservation?.cancel();
  }
}

async function _outlinerCopyLink(nodeData) {
  const linkPath = nodeData?.path;
  if (!linkPath) return false;
  const linkName = nodeData.name || linkPath.split(/[/\\]/).pop() || linkPath;
  if (typeof MeldexBroadcast === 'undefined' || typeof MeldexBroadcast.copyMeldexLink !== 'function') {
    showStatus('リンクをコピーできませんでした：この画面ではコピー機能を使えません', true);
    return false;
  }
  try {
    const ok = await MeldexBroadcast.copyMeldexLink(linkName, linkPath, nodeData.type);
    if (ok) showStatus('リンクをコピーしました');
    else showStatus('リンクをコピーできませんでした：クリップボードに書き込めませんでした', true);
    return !!ok;
  } catch (error) {
    _outlinerReportFailure('リンクをコピーできませんでした', error);
    return false;
  }
}

function _outlinerAppendMenuSeparator(menu) {
  const separator = document.createElement('div');
  separator.className = 'gb-context-menu-sep cm-sep';
  separator.setAttribute('role', 'separator');
  menu.appendChild(separator);
  return separator;
}

function _outlinerAppendSubmenu(menu, label, icon, panel) {
  const trigger = _outlinerAppendMenuItem(menu, { label, icon, hasSubmenu: true, className: 'tree-ctx-item' });
  const setExpanded = (expanded) => trigger.setAttribute('aria-expanded', expanded ? 'true' : 'false');
  trigger.addEventListener('mouseenter', () => setExpanded(true));
  trigger.addEventListener('mouseleave', () => setTimeout(() => {
    if (panel.style.display === 'none') setExpanded(false);
  }, 220));
  trigger.addEventListener('click', () => {
    trigger.dispatchEvent(new MouseEvent('mouseenter', { cancelable: true }));
    setExpanded(true);
  });
  panel.addEventListener('mouseenter', () => setExpanded(true));
  panel.addEventListener('mouseleave', () => setExpanded(false));
  attachHoverSubmenu(trigger, panel);
  return trigger;
}

function _outlinerPlaceContextMenu(menu) {
  document.body.appendChild(menu);
  const rect = menu.getBoundingClientRect();
  const z = _getZoom();
  if (rect.right > window.innerWidth) menu.style.left = ((window.innerWidth - rect.width - 4) / z) + 'px';
  if (rect.bottom > window.innerHeight) menu.style.top = ((window.innerHeight - rect.height - 4) / z) + 'px';
  if (typeof clampPopupToViewport === 'function') clampPopupToViewport(menu);
  const first = menu.querySelector('button.gb-context-menu-item:not(:disabled)');
  first?.focus?.({ preventScroll: true });
  _outlinerBindContextMenuClose(menu);
}

function _outlinerBindContextMenuClose(menu) {
  let removed = false;
  let pointerArmed = false;
  const cleanup = () => {
    if (removed) return;
    removed = true;
    document.removeEventListener('keydown', keyHandler, true);
    if (pointerArmed) document.removeEventListener('pointerdown', pointerHandler, true);
    _outlinerContextMenuCleanups.delete(cleanup);
  };
  const keyHandler = (event) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    closeTreeContextMenu();
  };
  const pointerHandler = (event) => {
    const inAnyMenu = [...document.querySelectorAll('.gb-context-menu')].some(m => m.contains(event.target));
    if (!inAnyMenu) closeTreeContextMenu();
  };
  _outlinerContextMenuCleanups.add(cleanup);
  document.addEventListener('keydown', keyHandler, true);
  pointerArmed = true;
  document.addEventListener('pointerdown', pointerHandler, true);
}

async function _refreshOutlinerSort() {
  const results = await refreshOutliner({ force: true, reason: 'outliner-sort' });
  if (results?.some(result => result.status === 'rejected')) showStatus('並び順を保存しましたが、ツリーの一部を更新できませんでした', true);
  if (typeof renderFolderGrid === 'function' && typeof _folderPath !== 'undefined' && _folderPath) {
    await renderFolderGrid({ preserveSelectedPaths: _folderSelectedItems.map(item => item?.path).filter(Boolean) });
  }
}

function showOutlinerSortMenu(event) {
  event?.preventDefault();
  event?.stopPropagation();
  closeTreeContextMenu();
  const trigger = document.getElementById('btn-tree-sort');
  if (!trigger) return;
  const rect = trigger.getBoundingClientRect();
  const zoom = parseFloat(document.documentElement.style.zoom) || 1;
  const menu = _outlinerCreateContextMenu('フォルダツリーの並べ替え', rect.left / zoom, rect.bottom / zoom);
  menu.dataset.e2eId = 'outliner-sort-menu';
  const current = getSortSettings()._tree || { sort: 'manual', order: 'asc' };
  getFolderSortOptions().forEach(option => {
    const active = current.sort === option.sort && current.order === option.order;
    const button = _outlinerAppendMenuItem(menu, {
      label: option.label, checked: active, role: 'menuitemradio',
      action: async () => {
        closeTreeContextMenu();
        const keys = [SORT_SETTINGS_KEY, MANUAL_ORDER_KEY];
        const before = captureOutlinerSettingsHistory(keys);
        const settings = getSortSettings();
        Object.keys(settings).forEach(key => { settings[key] = { sort: option.sort, order: option.order }; });
        settings._tree = { sort: option.sort, order: option.order };
        localStorage.setItem(SORT_SETTINGS_KEY, JSON.stringify(settings));
        if (typeof pushLocalStorageSettingsHistory === 'function') {
          pushLocalStorageSettingsHistory('フォルダツリー: 並べ替え設定', before,
            captureOutlinerSettingsHistory(keys), option.label, _refreshOutlinerSort);
        }
        await _refreshOutlinerSort();
      },
    });
    button.dataset.sort = option.sort;
    button.dataset.order = option.order;
    button.setAttribute('aria-checked', active ? 'true' : 'false');
  });
  _outlinerPlaceContextMenu(menu);
}

function _showTreeAddMenu(x, y, nodeEl, nodeData) {
  closeTreeContextMenu();
  const menu = _outlinerCreateContextMenu('フォルダツリー新規作成', x, y);
  // シートを選んでいるときは、シートの中に作れる「エントリ」を先頭に出す。
  // ほかの項目はシートの中には作らず、シートと同じ階層に作る。
  if (nodeData?.type === 'database' && nodeData.path) {
    _outlinerAppendMenuItem(menu, {
      label: 'トピック',
      icon: 'plus',
      action: async () => { closeTreeContextMenu(); await addSheetEntryAt(nodeData.path); },
    });
    _outlinerAppendMenuSeparator(menu);
  }
  _cloudPhase1CreateItems([['フォルダ','folder','folder'],['ノート','page','page'],['シナリオ','scriptnote','bookOpenText'],['シート','database','db'],['ボード','board','presentation'],['フォーム','form-app','clipboardList'],['マップ','map','map']]).forEach(([label,type,icon]) => {
    _outlinerAppendMenuItem(menu, {
      label,
      icon,
      action: async () => {
        closeTreeContextMenu();
        await addItemAt(getAddParentPath(nodeEl, nodeData, { insideTarget: true, itemType: type }), type, { anchorNode: nodeEl });
      },
    });
  });
  _outlinerPlaceContextMenu(menu);
}

// --- 右クリックメニュー ---
function closeTreeContextMenu() {
  _outlinerContextMenuOpenSeq += 1;
  _outlinerContextMenuCleanups.forEach(cleanup => {
    try { cleanup(); } catch {}
  });
  _outlinerContextMenuCleanups.clear();
  document.querySelectorAll('.gb-context-menu').forEach(el => el.remove());
}

// gb-path-utils.js（window.GBPathUtils）へ委譲。未ロード時は同等ロジックへフォールバックする。
function _outlinerPathIsAbsolute(path) {
  if (window.GBPathUtils?.isAbsolute) return window.GBPathUtils.isAbsolute(path);
  const value = String(path || '');
  return /^[a-zA-Z]:[\\/]/.test(value) || /^[/\\]{2}/.test(value) || value.startsWith('/');
}

function _outlinerJoinPath(base, rel) {
  if (window.GBPathUtils?.join) return window.GBPathUtils.join(base, rel);
  const left = String(base || '').replace(/[\\/]+$/, '');
  const right = String(rel || '').replace(/^[\\/]+/, '');
  if (!left) return right;
  if (!right) return left;
  return left + '/' + right;
}

function _outlinerNativeClipboardPath(path) {
  if (window.GBPathUtils?.toNativeClipboard) return window.GBPathUtils.toNativeClipboard(path);
  const value = String(path || '');
  if (/^[a-zA-Z]:[\\/]/.test(value)) return value.replace(/\//g, '\\');
  if (/^[/\\]{2}/.test(value)) return '\\\\' + value.replace(/^[/\\]+/, '').replace(/\//g, '\\');
  return value;
}

function _outlinerLocalCopyPath(nodeEl, nodeData) {
  let path = String(nodeData?.path || '');
  if (!path) return '';
  if (!_outlinerPathIsAbsolute(path)) {
    const rootNode = nodeEl?.closest?.('#outliner-tree > .tree-node');
    const rootPath = rootNode?._nodeData?.path || '';
    const base = nodeEl?.closest?.('#body-home') && _homeFolderPath
      ? _homeFolderPath
      : (rootPath || (typeof state !== 'undefined' ? state.vaultPath : ''));
    if (base && _outlinerPathIsAbsolute(base)) path = _outlinerJoinPath(base, path);
  }
  return _outlinerNativeClipboardPath(path);
}

// フォルダツリーの右クリックからのコピー・切り取りの元（貼り付けの後に差分で反映するフォルダを決める）
let _outlinerClipboardOrigin = null;

// フォルダツリーの右クリックの貼り付けの後の反映。貼り付け先（と切り取りの元）のフォルダだけを差分で反映し、
// 全体の読み直しをしない（2026-11-22 M-014: 以前は2〜2.5秒）。フォルダパネルで開いているフォルダも読み直す。
// コピー・切り取りの元がツリー以外（フォルダパネル等）で分からない時は、差分の反映の後にツリー全体を裏で読み直す。
// 取り消し・やり直し（引数なし）の時は従来どおりツリー全体を読み直す。
async function _outlinerRefreshAfterTreePaste(destFolder, pastedPaths) {
  const panelRefresh = async () => {
    if (typeof _folderRefreshCurrentFolder === 'function' && typeof state !== 'undefined' && state.view === 'folder') {
      try { await _folderRefreshCurrentFolder(); } catch (error) { console.warn('[outliner paste] フォルダパネルの更新に失敗', error); }
    }
  };
  if (!Array.isArray(pastedPaths)) {
    if (typeof refreshOutliner === 'function') await refreshOutliner({ force: true, reason: 'outliner-paste-history' });
    await panelRefresh();
    return;
  }
  const origin = _outlinerClipboardOrigin;
  const folders = [destFolder];
  if (origin?.mode === 'cut') origin.paths.forEach(path => folders.push(_outlinerParentPath(path)));
  await _outlinerSyncFoldersOrReload(folders);
  // 次の貼り付けでは、その間にフォルダパネル等でコピー・切り取りされたかもしれないので、元が分からない扱いにする
  _outlinerClipboardOrigin = null;
  await panelRefresh();
  if (!origin && typeof refreshOutliner === 'function') {
    setTimeout(() => { refreshOutliner({ force: true, reason: 'outliner-paste-unknown-origin' }).catch?.(() => {}); }, 0);
  }
}

// フォルダツリーの選択中の項目を削除する（右クリックの削除・Delete キーの共通の入口）。
// 途中の失敗は原因つきで表示する（以前は右クリックの削除ボタンが例外を受け止めず、失敗が画面に出なかった:
// 2026-11-22 M-014 フォルダツリー網羅テスト）。削除済みと対象なしが混ざった時も表示を読み直す。
async function deleteOutlinerTreeSelection() {
  try {
      const targets = treeSelection.getNodeData().filter(item => {
        if (item.type === 'entity' || item._isRoot) return false;
        return item.path && !isItemLocked(item.path);
      });
      if (!targets.length) {
        showStatus('削除できる項目がありません', true);
        return;
      }
      // handleDisplayedFolderLinkDelete は gb-folder-link-batch.js 側の定義。読み込み漏れ等で
      // 未定義の場合にReferenceErrorで削除処理全体が止まらないよう、存在確認してから呼ぶ
      // （2026-08-19 実UI検査: 同スクリプトがMeldex.htmlに読み込まれておらず、フォルダツリーの
      // 削除ボタンがクリックしても無反応のまま静かに失敗していた）。
      const linkedDelete = typeof handleDisplayedFolderLinkDelete === 'function'
        ? await handleDisplayedFolderLinkDelete(targets, '', {
          refresh: async () => {
            if (typeof loadOutliner === 'function') await loadOutliner();
            if (typeof renderHomeFolderTree === 'function') renderHomeFolderTree();
            if (typeof renderWorkspaceSidebar === 'function') renderWorkspaceSidebar();
          },
        })
        : { handled: false, result: null };
      if (linkedDelete.handled) {
        if (linkedDelete.result) treeSelection.clear();
        return;
      }
      const names = targets.map(item => item.name).join('、');
      treeSelection.clear();
      const result = await deleteOutlinerItemsWithHistory(targets, {
        label: targets.length + ' 件を削除',
        detail: names,
        onItemDeleted: (item) => {
          _removeOutlinerNodesForPaths([item.path]);
        },
        refresh: async () => {
          if (typeof loadOutliner === 'function') await loadOutliner();
          if (typeof renderHomeFolderTree === 'function') renderHomeFolderTree();
          if (typeof renderWorkspaceSidebar === 'function') renderWorkspaceSidebar();
        },
      });
      _removeOutlinerNodesForPaths(result.deletedPaths);
      _outlinerRefreshFolderPanelFor((result.deletedPaths || []).map(path => _outlinerParentPath(path)));
      if (result.failedCount) {
        const reason = result.failed?.[0]?.error;
        const detail = typeof reason === 'string' ? reason : reason?.message || reason?.detail?.message || reason?.detail || '';
        showStatus(`${result.deletedCount || result.succeeded.length}件を削除、${result.failedCount}件は失敗しました${detail ? ': ' + detail : ''}`, true);
        loadOutliner();
      } else if (result.succeeded.length) {
        showStatus(`${result.deletedCount || result.succeeded.length}件を削除しました（Undoで戻せます）`);
        // 先に画面から消した中に「見つからなかった」項目が混ざっていたら、実際の状態へ読み直す
        if (result.skipped.length) loadOutliner();
      } else if (result.skipped.length) {
        showStatus('削除対象が見つからなかったため、表示を更新しました', true);
        loadOutliner();
      }
  
  } catch (error) {
    if (typeof console !== 'undefined') console.error('[outliner] 削除に失敗', error);
    _outlinerReportFailure('削除に失敗しました', error);
  }
}

async function showTreeContextMenu(x, y, nodeEl, nodeData, labelEl) {
  closeTreeContextMenu();
  const openSeq = ++_outlinerContextMenuOpenSeq;
  const menu = _outlinerCreateContextMenu('フォルダツリーメニュー', x, y);

  const selectedCount = treeSelection.items.size;
  const isMulti = selectedCount > 1;
  const isFolder = nodeData.type === 'folder';
  const isDB = nodeData.type === 'database';
  const isEntity = nodeData.type === 'entity';

  function addMenuItem(text, onclick, cls, icon, targetMenu = menu) {
    return _outlinerAppendMenuItem(targetMenu, {
      label: text,
      icon,
      danger: cls === 'danger',
      className: cls && cls !== 'danger' ? cls : '',
      action: onclick,
    });
  }
  function addSep() {
    _outlinerAppendMenuSeparator(menu);
  }

  // 複数選択時は先頭に件数見出しを置く（フォルダパネルの複数選択メニューと同じ）。
  if (isMulti) {
    menu.dataset.folderMultiSelection = String(selectedCount);
    const heading = document.createElement('div');
    heading.className = 'gb-context-menu-label';
    heading.dataset.e2eId = 'folder-tree-context-selection-count';
    heading.textContent = `${selectedCount}件を選択中`;
    menu.appendChild(heading);
  }

  const addParent = getAddParentPath(nodeEl, nodeData, { insideTarget: true });
  const contextOperationItems = (isMulti ? treeSelection.getNodeData() : [nodeData])
    .filter(item => item?.path && item.type !== 'entity' && !item._isRoot);
  const editableContextItems = contextOperationItems.filter(item => !isItemLocked(item.path));
  const deleteContextItems = async () => {
    closeTreeContextMenu();
    await deleteOutlinerTreeSelection();
  };

  if (typeof appendFolderOperationButtons === 'function') {
    appendFolderOperationButtons(menu, {
      e2ePrefix: 'folder-tree-context',
      closeMenu: closeTreeContextMenu,
      onCopy: () => { _outlinerClipboardOrigin = { mode: 'copy', paths: contextOperationItems.map(item => item.path) }; folderToolbarCopyItems(contextOperationItems); },
      onCut: () => { _outlinerClipboardOrigin = { mode: 'cut', paths: editableContextItems.map(item => item.path) }; folderToolbarCutItems(contextOperationItems); },
      onPaste: () => folderToolbarPasteToFolder(addParent, { revealTreeDestination: true, refresh: pasted => _outlinerRefreshAfterTreePaste(addParent, pasted) }),
      onDuplicate: () => _outlinerRunDuplicate(editableContextItems),
      onDelete: deleteContextItems,
      copyDisabled: contextOperationItems.length === 0,
      cutDisabled: editableContextItems.length === 0,
      pasteDisabled: !folderToolbarCanPasteTo(addParent),
      duplicateDisabled: editableContextItems.length === 0,
      deleteDisabled: editableContextItems.length === 0,
    });
    addSep();
  }

  if (!isMulti && isEntity && window.MeldexTopicPlacementUI) {
    const topicSource = window.MeldexTopicPlacementUI.treeSource(nodeData);
    if (topicSource) {
      window.MeldexTopicPlacementUI.menuItems(topicSource).forEach(item => {
        addMenuItem(item.label, () => {
          closeTreeContextMenu();
          item.action();
        }, null, item.icon);
      });
      addSep();
    }
  }

  if (isMulti) {
    addMenuItem(`プロパティ（${selectedCount}件）`, () => {
      closeTreeContextMenu();
      return showFolderSelectionProperties(treeSelection.getNodeData(), nodeEl);
    }, null, 'info');
    if (window.isAutoTagRuntimeAvailable?.() === true && contextOperationItems.length) {
      addMenuItem(`自動タグ付け（${selectedCount}件）`, () => {
        closeTreeContextMenu();
        fvBulkAutoTag(contextOperationItems);
      }, null, 'tags');
    }
    addSep();
  }

  // --- 新規作成サブメニュー ---（作成先が押した1項目で決まるため、複数選択時は出さない）
  if (!isMulti && !(addParent && isItemLocked(addParent))) {
    const createPanel = _outlinerCreateSubmenu('フォルダツリー新規作成');
    _outlinerAppendSubmenu(menu, '新規作成', 'plus', createPanel);
    _cloudPhase1CreateItems([['フォルダ','folder','folder'],['ノート','page','page'],['シナリオ','scriptnote','bookOpenText'],['シート','database','db'],['ボード','board','presentation'],['フォーム','form-app','clipboardList'],['マップ','map','map']]).forEach(([label,type,icon]) => {
      _outlinerAppendMenuItem(createPanel, {
        label,
        icon,
        action: async () => { closeTreeContextMenu(); await addItemAt(addParent, type); },
      });
    });
  }
  addSep();

  // --- 開く系は利用頻度が高いため、上部の1つのサブメニューへ集約する ---
  if (!isMulti && nodeData.path && !nodeData._isRoot) {
    const openType = typeof _normalizeOpenTypeForNav === 'function'
      ? _normalizeOpenTypeForNav(nodeData.type)
      : (nodeData.type === 'database' ? 'pivot' : (nodeData.type === 'scenario' ? 'scriptnote' : (nodeData.type || 'page')));
    const openUrl = '/?open=' + encodeURIComponent(openType) + '&path=' + encodeURIComponent(nodeData.path) + '&label=' + encodeURIComponent(nodeData.name || '');
    const canUseRightSidebar = typeof GBPaneBridge === 'undefined'
      || typeof GBPaneBridge.canUseRightSidebarTools !== 'function'
      || typeof GBPaneBridge.surfaceOf !== 'function'
      || GBPaneBridge.canUseRightSidebarTools(GBPaneBridge.surfaceOf(nodeEl));
    const openPanel = _outlinerCreateSubmenu('開く');
    _outlinerAppendSubmenu(menu, '開く', 'folderOpen', openPanel);
    _outlinerAppendMenuItem(openPanel, {
      label: 'メインパネルで開く', icon: 'panelTop', action: () => {
        closeTreeContextMenu();
        window.GBOutlinerActivation?.activateNode(nodeEl);
      },
    });
    _outlinerAppendMenuItem(openPanel, {
      label: '新しいタブで開く', icon: 'externalLink', action: () => {
        closeTreeContextMenu();
        _openInNewTab(nodeData.name || '', nodeData.path, openType);
      },
    });
    if (canUseRightSidebar && typeof openLinkedPathInRightSidebar === 'function') {
      _outlinerAppendMenuItem(openPanel, {
        label: 'サブパネルで開く', icon: 'panelRight', action: () => {
          closeTreeContextMenu();
          openLinkedPathInRightSidebar(nodeData.path, nodeData.name, { linkType: nodeData.type, sourceEl: nodeEl });
        },
      });
    }
    if (typeof openLinkedPathStandalone === 'function'
        && (typeof canOpenLinkedPathStandalone !== 'function' || canOpenLinkedPathStandalone(nodeData.path, nodeData.type))) {
      _outlinerAppendMenuItem(openPanel, {
        label: '単独アプリで開く', icon: 'appWindow', action: () => {
          closeTreeContextMenu();
          openLinkedPathStandalone(nodeData.path, nodeData.name, { linkType: nodeData.type });
        },
      });
    }
    _outlinerAppendMenuItem(openPanel, {
      label: '新しいウィンドウで開く', icon: 'monitor', action: () => {
        closeTreeContextMenu();
        if (typeof _open_app_window_js === 'function') _open_app_window_js(openUrl);
        else window.open(openUrl, '_blank', 'width=1200,height=800,menubar=no,toolbar=no,location=no');
      },
    });
    if (!isFolder && typeof openNative === 'function') {
      const needsExternalApp = !(typeof NATIVE_TYPES !== 'undefined' && NATIVE_TYPES.has(nodeData.type));
      addMenuItem('アプリで開く', () => {
          closeTreeContextMenu();
          openNative(nodeData.path);
        }, null, needsExternalApp ? 'externalLink' : 'appWindow', openPanel);
    }
    if (nodeData.type === 'image') {
      _outlinerAppendMenuItem(openPanel, {
        label: 'ビューワーで開く', icon: 'image', action: () => {
          closeTreeContextMenu();
          if (typeof openViewer === 'function') openViewer('/viewer?file=' + encodeURIComponent(nodeData.path));
        },
      });
      if (typeof openImageInCanvas === 'function') {
        _outlinerAppendMenuItem(openPanel, {
          label: 'ボードで開く', icon: 'presentation', action: () => {
            closeTreeContextMenu();
            openImageInCanvas(nodeData);
          },
        });
      }
    }
    if ((nodeData.type === 'scriptnote') || (typeof isScriptNotePath === 'function' && isScriptNotePath(nodeData.path))) {
      _outlinerAppendMenuItem(openPanel, {
        label: 'シナリオで開く', icon: 'fileText', action: () => {
          closeTreeContextMenu();
          if (typeof openScenarioInScriptNote === 'function' && openScenarioInScriptNote(nodeData.path, nodeData.name || '', { fromExplorer: true })) return;
          showStatus('シナリオエディタを開けませんでした', true);
        },
      });
    } else if (nodeData.type === 'scenario') {
      _outlinerAppendMenuItem(openPanel, {
        label: 'シナリオへ取り込んで開く', icon: 'fileText', action: () => {
          closeTreeContextMenu();
          if (typeof openScenarioInScriptNote === 'function' && openScenarioInScriptNote(nodeData.path, nodeData.name || '', { fromExplorer: true })) return;
          showStatus('シナリオエディタを開けませんでした', true);
        },
      });
    }
    addSep();
  }

  if (!isMulti && nodeData.path && !nodeData._isRoot
      && typeof canShowContainedFiles === 'function' && canShowContainedFiles(nodeData)) {
    addMenuItem('ファイル内のファイルを表示', () => {
      closeTreeContextMenu();
      showContainedFiles(nodeData);
    }, null, 'files');
    addSep();
  }

  // --- 編集ロック ---
  if (!isMulti && window.MeldexFileIcons?.canEdit(nodeData) && !isItemLocked(nodeData.path)) {
    addMenuItem('アイコンを変更', () => {
      closeTreeContextMenu();
      window.MeldexFileIcons.openPicker(nodeData, nodeEl.querySelector('.tree-icon') || nodeEl);
    }, null, 'smile');
    addSep();
  }
  if (!isMulti && nodeData.path && !isEntity) {
    const locked = isItemLocked(nodeData.path);
    const systemLocked = typeof isSystemLockedItem === 'function' && isSystemLockedItem(nodeData.path);
    const canEditLock = typeof isFileLockOwner === 'function' && isFileLockOwner();
    if (systemLocked) {
      const lockedItem = addMenuItem('システム保護', () => {}, null, 'lock');
      lockedItem.style.opacity = '0.65';
      lockedItem.style.cursor = 'default';
      lockedItem.title = 'システム保護中です';
      lockedItem.dataset.gbTooltip = lockedItem.title;
    } else if (!canEditLock) {
      const lockedItem = addMenuItem(locked ? '編集ロック中' : '編集ロック（管理者のみ）', () => {}, null, 'lock');
      lockedItem.style.opacity = '0.65';
      lockedItem.style.cursor = 'default';
      lockedItem.title = '編集ロックの設定は管理者のみ可能です';
      lockedItem.dataset.gbTooltip = lockedItem.title;
    } else {
      const lockPanel = _outlinerCreateSubmenu('編集ロック');
      _outlinerAppendSubmenu(menu, '編集ロック', 'lock', lockPanel);
      [['編集ロックする', true, 'lock'], ['編集ロック解除', false, 'unlock']].forEach(([label, val, icon]) => {
        _outlinerAppendMenuItem(lockPanel, {
          html: radioMark(locked === val) + _outlinerMenuIconHtml(icon, 12) + '<span>' + _outlinerEscHtml(label) + '</span>',
          checked: locked === val,
          action: async () => {
          closeTreeContextMenu();
          const changed = locked !== val ? await toggleItemLock(nodeData.path) : true;
          if (!changed) return;
          const lbl = nodeEl.querySelector('.tree-label');
          if (lbl) lbl.style.fontStyle = isItemLocked(nodeData.path) ? 'italic' : '';
          showStatus(val ? '編集ロックしました' : '編集ロックを解除しました');
          },
        });
      });
    }
  }

  const _locked = nodeData.path ? isItemLocked(nodeData.path) : false;

  // --- メインカレンダーに設定（calendarタイプのみ） ---
  if (!isMulti && nodeData.type === 'calendar' && nodeData.path) {
    const mainCalId = localStorage.getItem('main-calendar-id');
    const mainCalPath = localStorage.getItem('main-calendar-path');
    const nodeFid = _pathToFileId(nodeData.path);
    const isMain = (mainCalId && nodeFid && mainCalId === nodeFid) || mainCalPath === nodeData.path;
    const calPanel = _outlinerCreateSubmenu('メインカレンダー');
    _outlinerAppendSubmenu(menu, 'メインカレンダー', 'calendar', calPanel);
    [['設定する', true], ['解除する', false]].forEach(([label, val]) => {
      _outlinerAppendMenuItem(calPanel, {
        html: radioMark(isMain === val) + '<span>' + _outlinerEscHtml(label) + '</span>',
        checked: isMain === val,
        action: () => {
        closeTreeContextMenu();
        const before = _captureMainCalendarSettingsHistory();
        if (val) {
          localStorage.setItem('main-calendar-path', nodeData.path);
          const mcFid = _pathToFileId(nodeData.path);
          if (mcFid) localStorage.setItem('main-calendar-id', mcFid);
          showStatus(`「${nodeData.name}」をメインカレンダーに設定しました`);
          _pushMainCalendarSettingsHistory('カレンダー: メインカレンダー設定', before, nodeData.path);
        } else {
          localStorage.removeItem('main-calendar-path');
          localStorage.removeItem('main-calendar-id');
          showStatus('メインカレンダー設定を解除しました');
          _pushMainCalendarSettingsHistory('カレンダー: メインカレンダー解除', before, nodeData.path);
        }
        },
      });
    });
  }

  // --- バージョン管理（フォルダのみ） ---
  if (!isMulti && (isFolder || isDB) && nodeData.path) {
    addSep();
    addMenuItem('バージョンを保存', async () => {
      closeTreeContextMenu();
      if (typeof saveFolderVersion !== 'function') {
        showStatus('バージョンを保存できませんでした：この画面ではバージョン管理を使えません', true);
        return;
      }
      await saveFolderVersion(nodeData.path);
    }, null, 'save');
    addMenuItem('バージョン管理', () => {
      closeTreeContextMenu();
      if (typeof openFolderVersionTab === 'function') openFolderVersionTab(nodeData.path);
      else if (typeof openVersionTab === 'function') openVersionTab(nodeData.path, 'folder');
    }, null, 'gitBranch');
  }

  // --- 画像ツール（フォルダのみ） ---
  if (!isMulti && (nodeData.type === 'folder' || nodeData._isRoot) && nodeData.path) {
    addMenuItem('重複画像を検出', () => {
      closeTreeContextMenu();
      showDuplicateScanModal(nodeData.path);
    }, null, 'search');
    addMenuItem('画像インデックスを作成', () => {
      closeTreeContextMenu();
      clipIndexFolder(nodeData.path);
    }, null, 'image');
  }

  // --- 自動タグ付け（フォルダは深い階層まで再帰処理） ---
  if (!isMulti && nodeData.path && !isEntity && window.isAutoTagRuntimeAvailable?.() === true) {
    const recursiveAutoTag = isFolder || !!nodeData._isRoot;
    addMenuItem(
      recursiveAutoTag ? 'フォルダ内すべてを自動タグ付け' : '自動タグ付け',
      () => {
        closeTreeContextMenu();
        if (typeof autoTagFolderTarget === 'function') {
          autoTagFolderTarget(nodeData, { recursive: recursiveAutoTag });
        } else {
          showStatus('自動タグ付けを初期化できませんでした', true);
        }
      },
      null,
      'tags'
    );
  }

  // --- ファイルのチャット（ファイル/DB/エントリのみ） ---
  if (!isMulti && nodeData.path && nodeData.type !== 'folder' && !nodeData._isRoot) {
    addMenuItem('チャットを開く', () => {
      closeTreeContextMenu();
      openFileChat(nodeData.path);
    }, null, 'messageSquare');
  }

  // --- 比較（ファイル全般） ---
  if (!isMulti && nodeData.path && nodeData.type !== 'folder' && !nodeData._isRoot && typeof showCompareModal === 'function') {
    addMenuItem('比較...', () => {
      closeTreeContextMenu();
      showCompareModal(nodeData.path);
    }, null, 'columns');
  }

  // --- この階層を閉じる（大量項目向けUI補助導線。§2.3） ---
  // メニュー構築中に例外が起きても、以降の項目や末尾の_outlinerPlaceContextMenu(menu)を
  // 必ず実行させる（例外1つでメニュー全体が出なくなる事態を避ける）。
  try {
    if (!isMulti && (isFolder || isDB)) {
      const toggleEl = nodeEl.querySelector(':scope > .tree-node-row .tree-toggle');
      if (toggleEl && toggleEl.dataset.expanded === 'true') {
        addMenuItem('この階層を閉じる', () => {
          closeTreeContextMenu();
          window.GBOutlinerVirtualPin?.closeBranch(nodeEl);
        }, null, 'chevronsUp');
      }
    }
  } catch (err) {
    console.error('[showTreeContextMenu] この階層を閉じるメニューの構築に失敗', err);
  }

  // --- リンクをコピー ---
  if (!isMulti && nodeData.path) {
    addMenuItem('リンクをコピー', () => {
      closeTreeContextMenu();
      return _outlinerCopyLink(nodeData);
    }, null, 'link');
  }

  // --- リネーム（F2と同じ共通ヘルパー。単一選択時のみ、エントリ以外、ロック中は無効） ---
  if (!isMulti && !isEntity && !_locked && !nodeData._isRoot) {
    addMenuItem('リネーム', () => {
      closeTreeContextMenu();
      window.GBOutlinerActivation?.startRenameForNode(nodeEl, labelEl, nodeData);
    }, null, 'pencil');
  }

  // --- パスをコピー ---
  {
    const pathTargets = isMulti
      ? [...treeSelection.items]
          .map(node => ({ node, data: node._nodeData }))
          .filter(item => item.data?.path)
      : (nodeData.path ? [{ node: nodeEl, data: nodeData }] : []);
    if (pathTargets.length > 0) {
      const pathLabel = isMulti ? `パスをコピー（${pathTargets.length}件）` : 'パスをコピー';
      addMenuItem(pathLabel, () => {
        closeTreeContextMenu();
        const copyPaths = pathTargets.map(item => _outlinerLocalCopyPath(item.node, item.data)).filter(Boolean);
        const paths = copyPaths.join('\n');
        const msg = pathTargets.length === 1
          ? 'パスをコピーしました: ' + copyPaths[0]
          : `パスをコピーしました（${pathTargets.length}件）`;
        navigator.clipboard.writeText(paths).then(() => {
          showStatus(msg);
        }).catch(() => {
          const ta = document.createElement('textarea');
          ta.value = paths; document.body.appendChild(ta);
          ta.select(); document.execCommand('copy'); ta.remove();
          showStatus(msg);
        });
      }, null, 'clipboardList');
    }
  }

  // --- お気に入り（1項目だけが対象のため単独選択時のみ） ---
  if (!isMulti && !isEntity && nodeData.path) {
    const isFav = getFavorites().some(f => f.path === nodeData.path);
    addMenuItem(isFav ? 'お気に入りを外す' : 'お気に入りに追加', () => {
      closeTreeContextMenu();
      if (isFav) removeFromFavorites(nodeData.path);
      else addToFavorites(nodeData.name, nodeData.path, nodeData.type);
    }, null, isFav ? 'starOff' : 'star');
  }

  // --- エクスポート ---
  if (!isMulti && nodeData.path) {
    const _expItems = [];
    const pushExportItem = (label, url, extension, filetypes) => {
      const baseName = (typeof MeldexExportSave !== 'undefined' && typeof MeldexExportSave.guessNameFromPath === 'function')
        ? MeldexExportSave.guessNameFromPath(nodeData.path, nodeData.name || '無題')
        : (nodeData.name || '無題');
      const stem = String(baseName || '無題').replace(/\.[^.]+$/, '') || '無題';
      _expItems.push({
        label,
        url,
        filename: stem + extension,
        extension,
        filetypes,
      });
    };
    if (nodeData.type === 'database') {
      pushExportItem('CSV', '/export/db?path=' + encodeURIComponent(nodeData.path) + '&format=csv', '.csv', [['CSVファイル', '*.csv'], ['すべてのファイル', '*.*']]);
      pushExportItem('HTML', '/export/db?path=' + encodeURIComponent(nodeData.path) + '&format=html', '.html', [['HTMLファイル', '*.html'], ['すべてのファイル', '*.*']]);
      pushExportItem('Excel', '/export/db?path=' + encodeURIComponent(nodeData.path) + '&format=xlsx', '.xlsx', [['Excelファイル', '*.xlsx'], ['すべてのファイル', '*.*']]);
    } else if (nodeData.type === 'board') {
      pushExportItem('HTML', '/export/canvas?path=' + encodeURIComponent(nodeData.path) + '&format=html', '.html', [['HTMLファイル', '*.html'], ['すべてのファイル', '*.*']]);
      pushExportItem('SVG画像', '/export/canvas?path=' + encodeURIComponent(nodeData.path) + '&format=svg', '.svg', [['SVGファイル', '*.svg'], ['すべてのファイル', '*.*']]);
      pushExportItem('Markdown', '/export/canvas?path=' + encodeURIComponent(nodeData.path) + '&format=md', '.md', [['Markdownファイル', '*.md'], ['すべてのファイル', '*.*']]);
    } else if (nodeData.type === 'page') {
      pushExportItem('テキスト', '/export/note?path=' + encodeURIComponent(nodeData.path) + '&format=txt', '.txt', [['テキストファイル', '*.txt'], ['すべてのファイル', '*.*']]);
      pushExportItem('Markdown', '/export/note?path=' + encodeURIComponent(nodeData.path) + '&format=md', '.md', [['Markdownファイル', '*.md'], ['すべてのファイル', '*.*']]);
      pushExportItem('HTML', '/export/note?path=' + encodeURIComponent(nodeData.path) + '&format=html', '.html', [['HTMLファイル', '*.html'], ['すべてのファイル', '*.*']]);
      pushExportItem('Word', '/export/note?path=' + encodeURIComponent(nodeData.path) + '&format=docx', '.docx', [['Wordファイル', '*.docx'], ['すべてのファイル', '*.*']]);
    }
    if (_expItems.length > 0) {
      // エクスポートサブメニュー
      const exportIconName = typeof uiTransferIconName === 'function' ? uiTransferIconName('export') : 'upload';
      const expPanel = _outlinerCreateSubmenu('エクスポート');
      _outlinerAppendSubmenu(menu, 'エクスポート', exportIconName, expPanel);
      _expItems.forEach(ei => {
        _outlinerAppendMenuItem(expPanel, {
          label: ei.label,
          action: async () => {
          closeTreeContextMenu();
          if (typeof MeldexExportSave === 'undefined' || typeof MeldexExportSave.saveUrl !== 'function') {
            showStatus('保存ダイアログを初期化できませんでした', true);
            return;
          }
          await MeldexExportSave.saveUrl(ei.url, {
            filename: ei.filename,
            extension: ei.extension,
            dialogTitle: `${ei.label}として保存`,
            filetypes: ei.filetypes,
            okMessage: `${ei.label} として保存しました`,
            errorMessage: `${ei.label} の保存に失敗しました`,
            path: nodeData.path,
            title: nodeData.name || '無題',
          });
          },
        });
      });
      addSep();
    }
  }

  // --- 所属フォルダ（リンク登録。1項目だけが対象のため単独選択時のみ） ---
  if (!isMulti && !isEntity && nodeData.path) {
    const linkLabel = nodeData.type === 'folder' ? 'このフォルダへのリンクを作成...' : '所属フォルダを設定...';
    addMenuItem(linkLabel, () => {
      closeTreeContextMenu();
      showAddFolderLinkModal(nodeData.path, null, { historyScope: '' });
    }, null, 'link2');
  }

  // --- 色設定 ---
  addSep();
  {
    const currentColor = getNodeColor(nodeData.path);
    const colorItem = _outlinerAppendMenuItem(menu, {
      html: '',
      action: () => {
        openColorPalette(swatch, currentColor, (c) => {
          closeTreeContextMenu();
          applyColorToSelection(c || null);
        });
      },
    });
    const swatch = document.createElement('span');
    swatch.className = 'gb-color-swatch gb-color-swatch--inline';
    swatch.setAttribute('aria-hidden', 'true');
    setColorSwatchValue(swatch, currentColor || 'var(--fg)');
    colorItem.appendChild(swatch);
    const clbl = document.createElement('span');
    clbl.textContent = isMulti ? `色設定（${selectedCount}件）` : '色設定';
    colorItem.appendChild(clbl);
  }

  // --- ワークスペースルート: ソースフォルダ用メニューは出さない ---
  // （ワークスペースはソースフォルダ設定に保存されないため、出しても無効操作になる）
  if (nodeData._isRoot && !isMulti && (nodeData.rootKind === 'workspace' || nodeData.workspaceId)) {
    addSep();
    addMenuItem('ワークスペースの管理...', () => {
      closeTreeContextMenu();
      if (typeof openWorkspaceSettings === 'function') openWorkspaceSettings();
    }, null, 'usersRound');
  }

  // --- ルートフォルダのパス変更 ---
  if (nodeData._isRoot && !isMulti && !(nodeData.rootKind === 'workspace' || nodeData.workspaceId)) {
    addSep();
    addMenuItem('パスを変更...', async () => {
      closeTreeContextMenu();
      showStatus('フォルダ選択ダイアログを開いています...');
      try {
        const isDropbox = window.MeldexRuntimeAdapter?.isDropboxMode?.();
        const res = isDropbox
          ? await window.MeldexDropboxFolderPicker.pickFolder({ title: 'ソースフォルダの参照先を選択' })
          : await apiFetch('/pick-folder');
        if (!res?.path) { showStatus('キャンセルされました'); return; }
        // outliner_rootsを更新
        const roots = await apiFetch('/outliner-roots');
        const baseRoots = _cloneOutlinerRootsForBase(roots);
        const root = roots.find(r => r.path === nodeData.path);
        if (root) {
          if (isDropbox) {
            const registry = window.MeldexSourceFolderRegistry;
            const sourceId = root.sourceId || root.id || registry.parseSourcePath(root.path)?.sourceId;
            if (!sourceId) throw new Error('ソースフォルダの登録IDを確認できません');
            root.provider = 'dropbox';
            root.id = root.sourceId = sourceId;
            root.dropboxPath = registry.normalizeDropboxPath(res.path);
            root.namespaceKind = registry.normalizeNamespaceKind(res.namespaceKind);
            root.path = registry.sourcePath(sourceId);
            root.name = res.name || res.path.split('/').filter(Boolean).pop();
          } else {
            root.path = res.path;
            root.name = res.path.split(/[/\\]/).pop();
          }
          await _putOutlinerRootsWithBase(roots, baseRoots);
          // The virtual ID remains the same, but cached files/revisions belong
          // to the former physical location and must not follow the new path.
          if (isDropbox) window.MeldexStorageAdapter?.getProvider?.()?._forgetMeta?.(root.path);
          await loadOutliner();
          showStatus('パスを変更しました: ' + res.path);
        }
      } catch (e) { showStatus('パス変更に失敗しました', true); }
    }, null, 'folderPen');
