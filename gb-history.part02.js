  try {
    const value = Number(localStorage.getItem('history-max'));
    return Number.isFinite(value) && value >= 1 ? Math.min(200, Math.floor(value)) : 50;
  } catch { return 50; }
}
function setHistoryMax(n) {
  const value = Number(n);
  localStorage.setItem('history-max', Number.isFinite(value) ? Math.max(1, Math.min(200, Math.floor(value))) : 50);
}

function _historyPathUnderFolder(path, folderPath) {
  const p = _normalizeVersionComparePath(path);
  const root = _normalizeVersionComparePath(folderPath);
  return !!(p && root && (p === root || p.startsWith(root + '/')));
}

async function _flushPendingEditorVersionTarget(path, folderPath) {
  if (typeof flushPendingEditorAutosave !== 'function') return 0;
  const target = _normalizeVersionComparePath(path);
  const current = typeof getCurrentFilePath === 'function'
    ? _normalizeVersionComparePath(getCurrentFilePath())
    : _normalizeVersionComparePath(document.getElementById('page-content')?.dataset?.path || '');
  if (folderPath ? !_historyPathUnderFolder(current, folderPath) : (target && !_sameVersionTargetPath(current, target))) return 0;
  const raw = await Promise.resolve(flushPendingEditorAutosave());
  // 戻り値が配列でなくても rejection が検知できるよう正規化
  const results = Array.isArray(raw) ? raw : [raw];
  if (results.some(r => r && typeof r === 'object' && r.status === 'rejected')) {
    throw new Error('ノートの未保存内容を保存できませんでした');
  }
  return results.length;
}

async function _flushOpenAppVersionTarget(path, folderPath) {
  let count = await _flushPendingEditorVersionTarget(path, folderPath);
  const matches = p => folderPath ? _historyPathUnderFolder(p, folderPath) : _sameVersionTargetPath(p, path);
  for (const adapter of [window.GBQuickMemoPanel]) {
    if (!folderPath && typeof adapter?.flushVersionTarget === 'function' && await adapter.flushVersionTarget(path)) count++;
  }
  if (typeof bd !== 'undefined' && bd?.path && matches(bd.path) && typeof bdSave === 'function') {
    if (window._bdTimer) { clearTimeout(window._bdTimer); window._bdTimer = null; }
    const ok = await Promise.resolve(bdSave());
    if (ok === false) throw new Error('ボードの未保存内容を保存できませんでした');
    count++;
  }
  if (typeof _csvPath !== 'undefined' && _csvPath && matches(_csvPath) && typeof saveCsv === 'function') {
    const ok = await Promise.resolve(saveCsv());
    if (ok === false) throw new Error('CSVの未保存内容を保存できませんでした');
    count++;
  }
  return count;
}

async function _flushOpenScriptNotesInFolder(folderPath) {
  const tasks = [];
  if (typeof GBLayout === 'undefined' || typeof getComponentInstance !== 'function') return 0;
  (GBLayout.getAllPanes?.(GBLayout.root) || []).forEach(pane => (pane.tabs || []).forEach(tab => {
    if (tab.type !== 'scriptnote') return;
    const comp = getComponentInstance(tab.id);
    const editor = comp?._editor;
    const p = tab.state?.scenarioPath || tab.path || comp?.state?.scenarioPath || editor?._path || '';
    if (editor?.flush && _historyPathUnderFolder(p, folderPath)) tasks.push(Promise.resolve().then(() => editor.flush()));
  }));
  const results = await Promise.allSettled(tasks);
  if (results.some(r => r.status === 'rejected' || r.value === false)) throw new Error('シナリオの未保存内容を保存できませんでした');
  return tasks.length;
}

async function _flushOpenFolderVersionTargets(folderPath) {
  return await _flushOpenAppVersionTarget('', folderPath) + await _flushOpenScriptNotesInFolder(folderPath);
}

async function _refreshOpenScriptNotesInFolder(folderPath, restoredSet) {
  const tasks = [];
  if (typeof GBLayout === 'undefined' || typeof getComponentInstance !== 'function') return 0;
  (GBLayout.getAllPanes?.(GBLayout.root) || []).forEach(pane => (pane.tabs || []).forEach(tab => {
    if (tab.type !== 'scriptnote') return;
    const comp = getComponentInstance(tab.id);
    const p = tab.state?.scenarioPath || tab.path || comp?.state?.scenarioPath || comp?._editor?._path || '';
    if (!comp?._loadScenario || !_historyPathUnderFolder(p, folderPath)) return;
    if (restoredSet?.size && !restoredSet.has(_normalizeVersionComparePath(p))) return;
    tasks.push(Promise.resolve().then(() => comp._loadScenario(p, {
      skipNavPush: true, skipRecent: true, skipAutoVersion: true, skipSaveLastView: true, skipStatus: true,
    })));
  }));
  await Promise.allSettled(tasks);
  return tasks.length;
}

async function _refreshRestoredFolderVersionTargets(folderPath, restoredFiles) {
  const root = _normalizeVersionComparePath(folderPath);
  const restoredSet = new Set((restoredFiles || []).map(file => _normalizeVersionComparePath(root + '/' + file)));
  const current = typeof getCurrentFilePath === 'function' ? getCurrentFilePath() : '';
  if (current && _historyPathUnderFolder(current, root) && (!restoredSet.size || restoredSet.has(_normalizeVersionComparePath(current)))) {
    await _refreshRestoredVersionTarget(current, 'file');
  }
  if (typeof bd !== 'undefined' && bd?.path && _historyPathUnderFolder(bd.path, root) && typeof openBoard === 'function') {
    await Promise.resolve(openBoard(bd.path.split('/').pop()?.replace(/\.\w+$/, '') || '', bd.path, { skipNavPush: true, skipRecent: true, skipAutoVersion: true, skipSaveLastView: true }));
  }
  if (typeof _csvPath !== 'undefined' && _csvPath && _historyPathUnderFolder(_csvPath, root) && typeof openCsvFile === 'function') {
    await Promise.resolve(openCsvFile(_csvPath.split('/').pop() || '', _csvPath, { skipNavPush: true, skipRecent: true, skipAutoVersion: true, skipSaveLastView: true }));
  }
  if (typeof state !== 'undefined' && state.currentDbPath && _historyPathUnderFolder(state.currentDbPath, root) && typeof selectDatabase === 'function') {
    await Promise.resolve(selectDatabase(state.currentDbPath));
  }
  await _refreshOpenScriptNotesInFolder(root, restoredSet);
}

function _getStack(scope) {
  if (!scope) return _historyGlobal;
  if (!_historyStacks[scope]) _historyStacks[scope] = { undo: [], redo: [] };
  return _historyStacks[scope];
}

/* ==============================
   ファイルを消す取り消し・やり直しの守り（2026-11-22 利用者役の探索: データを失う危険）
   「新規作成」の取り消し（作ったファイルをゴミ箱へ）と「削除」のやり直しは、別のファイルを消す。
   シートなどを開いて Ctrl+Z を押した時に、その画面と関係ない別のファイルを確認なしで消さないよう、
   - 作ったファイルをその後に開いたら、作成の記録は操作を始めた画面の履歴から外し、共通（フォルダツリー）の履歴へ移す。
   - 画面の履歴が空で共通の履歴へ落ちる時、そのファイルを消す記録は、開いている画面自身のファイルの時だけ実行する。
   フォルダツリー・ヒストリーパネルからは従来どおり取り消せる。
   ============================== */
function historyMarkFileEffects(entry, effects) {
  if (!entry || !effects) return entry;
  const clean = (list) => (Array.isArray(list) ? list : []).map(p => String(p || '')).filter(Boolean);
  entry.fileEffects = { undoDeletes: clean(effects.undoDeletes), redoDeletes: clean(effects.redoDeletes) };
  return entry;
}

function _historyNormalizeFilePath(path) {
  return String(path || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

// 履歴のスコープ（'db:<パス>' 'note:<パス>' など）が指すファイル。ファイルを持たないスコープは ''。
function _historyScopeFilePath(scope) {
  const text = String(scope || '');
  const at = text.indexOf(':');
  if (at <= 0) return '';
  if (/^(calendar|schedule|outliner|form|settings):/.test(text)) return '';
  return _historyNormalizeFilePath(text.slice(at + 1));
}

function _historySameFile(a, b) {
  const x = _historyNormalizeFilePath(a), y = _historyNormalizeFilePath(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const strip = (p) => {
    // シートのフォルダノート（<フォルダ>/<フォルダ名>.md）はフォルダと同じものとして扱う。
    const m = p.match(/^(.*\/)?([^/]+)\/\2\.md$/);
    return m ? (m[1] || '') + m[2] : p;
  };
  const sx = strip(x), sy = strip(y);
  if (sx === sy) return true;
  // 保存先の基準の違い（絶対パスと相対パス）を吸収する。
  return sx.endsWith('/' + sy) || sy.endsWith('/' + sx);
}

function _historyEntryDeletesOtherFile(entry, direction, scope) {
  const paths = entry?.fileEffects?.[direction === 'undo' ? 'undoDeletes' : 'redoDeletes'] || [];
  if (!paths.length) return false;
  const own = _historyScopeFilePath(scope);
  return paths.some(path => !own || !_historySameFile(path, own));
}

// 共通の履歴へ落ちてよいか（ファイルを持つ画面から、別のファイルを消す記録へは落ちない）。
function _historyGlobalFallbackAllowed(direction, scope) {
  const top = _historyGlobal[direction][_historyGlobal[direction].length - 1];
  if (!top) return false;
  // 同じ画面から共通の履歴へ落ちて取り消した記録は、同じ画面からやり直せる（取り消しとやり直しの対称）。
  // ノートを開いたままフォルダツリーで削除→Ctrl+Z で戻した後、Ctrl+Y が「やり直す操作がありません」になっていた
  // （2026-11-22 M-014 フォルダツリー網羅テスト）。別の画面から落ちる時は従来どおり止める。
  if (scope && top._historyFallbackScope === scope) return true;
  return !_historyEntryDeletesOtherFile(top, direction, scope);
}

// 作ったファイルを開いたら、作成の記録を他の画面の履歴から共通の履歴へ移す。
function _historyDetachFileEntriesForOpenedScope(scope) {
  const own = _historyScopeFilePath(scope);
  if (!own) return;
  let moved = false;
  Object.entries(_historyStacks).forEach(([otherScope, stack]) => {
    if (!stack || otherScope === scope) return;
    ['undo', 'redo'].forEach(kind => {
      const keep = [];
      stack[kind].forEach(entry => {
        const paths = [...(entry?.fileEffects?.undoDeletes || []), ...(entry?.fileEffects?.redoDeletes || [])];
        if (!entry?._historyPending && paths.some(path => _historySameFile(path, own))) {
          entry.scope = '';
          _historyGlobal[kind].push(entry);
          moved = true;
        } else {
          keep.push(entry);
        }
      });
      stack[kind] = keep;
    });
  });
  if (moved) {
    ['undo', 'redo'].forEach(kind => _historyGlobal[kind].sort((a, b) => (a?.id || 0) - (b?.id || 0)));
  }
}

function _resolveHistoryScopeArg(scope, argCount) {
  if (argCount <= 0) return _historyActiveScope;
  if (scope && typeof Event !== 'undefined' && scope instanceof Event) return _historyActiveScope;
  if (scope && typeof scope === 'object' && typeof scope.preventDefault === 'function' && 'target' in scope) {
    return _historyActiveScope;
  }
  return scope;
}

function _allowGlobalHistoryFallback(scope, argCount) {
  if (argCount <= 0) return true;
  if (scope && typeof Event !== 'undefined' && scope instanceof Event) return true;
  return !!(scope && typeof scope === 'object' && typeof scope.preventDefault === 'function' && 'target' in scope);
}

// アクティブスコープを設定（DBやツール切り替え時に呼ぶ）
function historySetScope(scope) {
  _historyActiveScope = scope || '';
  _historyDetachFileEntriesForOpenedScope(_historyActiveScope);
  renderHistoryList();
  renderHistoryPanel();
}

function _historyScopeDisplayName(scope) {
  if (String(scope || '').startsWith('form:')) {
    const host = globalThis.GBEditorHost?.get();
    return host?.kind === 'form-app' && host.historyScope?.() === scope ? (host.label || 'フォーム') : 'フォーム';
  }
  if (!scope) return '共通操作';
  const text = String(scope);
  const at = text.indexOf(':');
  const kind = at > 0 ? text.slice(0, at) : '';
  let raw = at > 0 ? text.slice(at + 1) : text;
  // シートなどは内部の識別番号で記録される。利用者には対象の名前だけを見せる（識別番号・保存先の絶対パスは出さない）。
  if (raw && !/[\\/]/.test(raw) && typeof _fileIdToPath === 'function') {
    try { raw = _fileIdToPath(raw) || raw; } catch {}
  }
  if (/[\\/]/.test(raw)) {
    const name = raw.replace(/\\/g, '/').replace(/\/+$/, '').split('/').pop() || '';
    return name.replace(/\.md$/i, '') || raw;
  }
  if (/^[0-9a-f]{8,}$/i.test(raw) || !raw) {
    const kindNames = { db: 'シート', page: 'ノート', note: 'ノート', scriptnote: 'シナリオ', board: 'ボード', csv: 'CSV', map: 'マップ' };
    return kindNames[kind] || '対象';
  }
  return raw;
}

function _historyDisplayParts(entry) {
  const label = String(entry?.label || '');
  const explicitDetail = String(entry?.detail || '').trim();
  if (explicitDetail) return { title: label, detail: explicitDetail };
  const colonIdx = label.indexOf(': ');
  if (colonIdx >= 0) return { title: label.slice(0, colonIdx), detail: label.slice(colonIdx + 2) };
  return { title: label, detail: '' };
}

function _historyNewestFirst(a, b) {
  return b.time - a.time || (b.id || 0) - (a.id || 0);
}

function summarizeHistoryTextChange(beforeText, afterText) {
  const before = String(beforeText || '');
  const after = String(afterText || '');
  if (before === after) return '内容を更新';
  const diff = typeof textDiff === 'function' ? textDiff(before, after) : [];
  let add = 0;
  let del = 0;
  diff.forEach(part => {
    if (part.type === 'add' && part.text.trim()) add += 1;
    if (part.type === 'del' && part.text.trim()) del += 1;
  });
  if (add === 0 && del === 0) return '内容を更新';
  if (add > 0 && del > 0) return `追記 ${add} 行 / 削除 ${del} 行`;
  if (add > 0) return `追記 ${add} 行`;
  return `削除 ${del} 行`;
}

let _localStorageSettingsHistoryRestoring = 0;

function isLocalStorageSettingsHistoryRestoring() {
  return _localStorageSettingsHistoryRestoring > 0;
}

function isLocalStorageSettingsHistorySuppressed() {
  const globalSuppress = typeof window !== 'undefined'
    && Number(window.__meldexSuppressLocalStorageSettingsHistory || 0) > 0;
  return isLocalStorageSettingsHistoryRestoring() || globalSuppress;
}

function captureLocalStorageSettings(keys) {
  const list = [...new Set((Array.isArray(keys) ? keys : []).filter(Boolean))];
  const storage = {};
  list.forEach(key => {
    try { storage[key] = localStorage.getItem(key); }
    catch { storage[key] = null; }
  });
  return { keys: list, storage };
}

function _normalizeLocalStorageSettingsSnapshots(beforeSnapshot, afterSnapshot) {
  const keys = [...new Set([
    ...(beforeSnapshot?.keys || Object.keys(beforeSnapshot?.storage || {})),
    ...(afterSnapshot?.keys || Object.keys(afterSnapshot?.storage || {})),
  ].filter(Boolean))];
  const normalize = snapshot => {
    const storage = {};
    keys.forEach(key => {
      storage[key] = Object.prototype.hasOwnProperty.call(snapshot?.storage || {}, key)
        ? snapshot.storage[key]
        : null;
    });
    return { keys: keys.slice(), storage };
  };
  return { before: normalize(beforeSnapshot), after: normalize(afterSnapshot) };
}

function restoreLocalStorageSettings(snapshot, onRestore) {
  if (!snapshot?.storage) return false;
  const keys = snapshot.keys || Object.keys(snapshot.storage);
  _localStorageSettingsHistoryRestoring += 1;
  try {
    keys.forEach(key => {
      const value = Object.prototype.hasOwnProperty.call(snapshot.storage, key) ? snapshot.storage[key] : null;
      if (value === null || value === undefined) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    });
    if (typeof onRestore === 'function') onRestore(keys.slice(), snapshot);
    try {
      window.dispatchEvent(new CustomEvent('meldex-local-storage-settings-restored', {
        detail: { keys: keys.slice() },
      }));
    } catch {}
  } finally {
    _localStorageSettingsHistoryRestoring -= 1;
  }
  return true;
}

function pushLocalStorageSettingsHistory(label, beforeSnapshot, afterSnapshot, detail, onRestore) {
  if (typeof historyPush !== 'function' || isLocalStorageSettingsHistorySuppressed()) return false;
  if (!beforeSnapshot?.storage || !afterSnapshot?.storage) return false;
  const snapshots = _normalizeLocalStorageSettingsSnapshots(beforeSnapshot, afterSnapshot);
  let beforeKey = '';
  let afterKey = '';
  try {
    beforeKey = JSON.stringify(snapshots.before);
    afterKey = JSON.stringify(snapshots.after);
  } catch {}
  if (beforeKey && beforeKey === afterKey) return false;
  const scope = (typeof _historyActiveScope !== 'undefined') ? _historyActiveScope : '';
  historyPush(
    label || '設定変更',
    () => restoreLocalStorageSettings(snapshots.before, onRestore),
    () => restoreLocalStorageSettings(snapshots.after, onRestore),
    scope,
    detail || ''
  );
  return true;
}

function withLocalStorageSettingsHistory(label, keys, mutator, detail, onRestore) {
  const before = captureLocalStorageSettings(keys);
  const result = typeof mutator === 'function' ? mutator() : undefined;
  const after = captureLocalStorageSettings(keys);
  pushLocalStorageSettingsHistory(label, before, after, detail, onRestore);
  return result;
}

/* ==============================
   スナップショット・プロバイダ（フェーズ3-1: scriptnote特例の一般化）
   - historyUndo/historyRedo が「対象スコープの現在の絶対状態」をcapture/restoreできる
     ようにするための登録テーブル。scriptnote 特例（_captureScriptnoteState/
     _restoreScriptnoteState）はそのままプロバイダとして登録し、挙動を変えない。
   - board（フェーズ3-3）は 'board:<パス>' スコープ全体を対象に同じ仕組みへ乗せる。
   - db:（シート）は保存完了待ちだけを登録する。各編集のundo/redoは保持し、
     全体スナップショットへの差し替えは行わない。
   ============================== */
const _historySnapshotProviders = {};
function historyRegisterSnapshotProvider(scopePrefix, provider) {
  if (!scopePrefix || !provider) return;
  const snapshots = typeof provider.capture === 'function' && typeof provider.restore === 'function';
  const prepareOnly = typeof provider.prepare === 'function' && provider.capture == null && provider.restore == null;
  if (!snapshots && !prepareOnly) return;
  _historySnapshotProviders[scopePrefix] = provider;
}
function _findHistorySnapshotProvider(scope) {
  if (!scope) return null;
  let bestPrefix = '';
  let bestProvider = null;
  for (const prefix in _historySnapshotProviders) {
    if (scope.startsWith(prefix) && prefix.length > bestPrefix.length) {
      bestPrefix = prefix;
      bestProvider = _historySnapshotProviders[prefix];
    }
  }
  return bestProvider;
}

// シートは複数セルの保存と履歴登録が完了してからUndo/Redoを選ぶ。
historyRegisterSnapshotProvider('db:', {
  prepare: scope => {
    if (typeof waitForPendingDbValueMutations !== 'function') return true;
    const paths = [typeof state !== 'undefined' ? state.currentDbPath : ''];
    if (typeof getAllPanes === 'function') {
      for (const pane of Object.values(getAllPanes() || {})) paths.push(pane?.dbPath || pane?.currentDbPath || '');
    }
    const path = paths.find(value => value && typeof _dbScopeForPath === 'function' && _dbScopeForPath(value) === scope);
    return waitForPendingDbValueMutations(path || '');
  },
});

// scriptnote: 既存の capture/restore をそのまま登録する。
historyRegisterSnapshotProvider('scriptnote:', {
  prepare: (scope) => typeof _sn2PrepareHistoryNavigation !== 'function' || _sn2PrepareHistoryNavigation(scope),
  capture: (scope) => (typeof _captureScriptnoteState === 'function' ? _captureScriptnoteState(scope) : null),
  restore: (state, scope) => typeof _restoreScriptnoteState === 'function' ? _restoreScriptnoteState(state, scope) : false,
});

// board: ボード全体のスナップショット（gb-canvas-engine.part04.js の _bdSnapshot/_bdApplySnapshot）。
// bdPushUndo() は独自スタックへの直接pushをやめ、'board:<パス>' スコープでこのプロバイダ
// 経由の共通履歴へ統合する（フェーズ3-3）。
historyRegisterSnapshotProvider('board:', {
  prepare: () => {
    if (typeof bd !== 'undefined' && bd.editing && typeof bdFinishEdit === 'function') bdFinishEdit();
    return true;
  },
  capture: () => (typeof _bdSnapshot === 'function' ? _bdSnapshot() : null),
  restore: (snap) => {
    if (snap == null || typeof _bdApplySnapshot !== 'function') return false;
    _bdApplySnapshot(JSON.parse(snap));
    if (typeof bdRender === 'function') bdRender();
    if (typeof bdDirty === 'function') bdDirty();
  },
});

// schedule: 「スケジュール」タブ本体（系統(A) CalendarComponent, gb-tool-calendar.js）の
// 予定/ToDo編集スナップショット（events/tasks/eventWindow の3点セット）。
// _pushUndo() は独自スタックへの直接pushをやめ、'schedule:<tabId>' スコープでこのプロバイダ
// 経由の共通履歴へ統合する（v0.6.199、フェーズ3-2の実質置き換え）。
// システム(B)（シートを「カレンダー表示モード」で開いた時の _calUndoStack 系, 'calendar:' 系の
// スコープとは無関係。あちらは本プロバイダの対象外で無変更）。
historyRegisterSnapshotProvider('schedule:', {
  capture: (scope) => (typeof _schedCaptureSnapshot === 'function' ? _schedCaptureSnapshot(scope) : null),
  restore: (snap, scope) => (typeof _schedRestoreSnapshot === 'function' ? _schedRestoreSnapshot(snap, scope) : undefined),
});

// map: 大きいマップ文書のRedo状態は最初のUndo時に遅延取得する。通常編集のたびに
// before/afterを二重保持せず、共通履歴の一方向エントリを安全に補完する。
historyRegisterSnapshotProvider('map:', {
  capture: (scope) => globalThis.MeldexMapHistorySnapshots?.capture?.(scope) ?? null,
  restore: (snap, scope) => globalThis.MeldexMapHistorySnapshots?.restore?.(snap, scope) ?? false,
});

// アクションを記録（undoFnとredoFnはasync可、scopeはオプション）
let _historyEntrySequence = 0;
let _historyBusy = false;

function _historyIsBusy() {
  return _historyBusy || (typeof _calHistoryBusy !== 'undefined' && _calHistoryBusy);
}

// 確定（操作）の順で取り消せるよう、保存の完了を待たずに履歴の枠だけ先に取る予約。
// 保存完了時に fill()／capture() で中身を入れ、保存失敗時は cancel() で枠を取り除く。
// 中身が入るまで、その枠の取り消し・やり直しは順番待ちのまま保存完了を待つ。
let _historyCaptureReservation = null;

function historyReserve(label, scope, detail) {
  const entry = historyPush(label, null, null, scope, detail);
  let settle = null;
  entry._historyPending = new Promise(resolve => { settle = resolve; });
  let finished = false;
  const finish = () => {
    finished = true;
    delete entry._historyPending;
    settle();
    renderHistoryList();
    renderHistoryPanel();
  };
  const reservation = {
    entry,
    get finished() { return finished; },
    fill(undoFn, redoFn, nextLabel, nextDetail) {
      if (finished) return entry;
      entry.undo = undoFn;
      entry.redo = redoFn;
      if (nextLabel) entry.label = nextLabel;
      if (nextDetail) entry.detail = nextDetail;
      finish();
      return entry;
    },
    // 中で呼ばれる最初の historyPush をこの枠へ入れる（既存の履歴登録関数をそのまま使うため）。
    capture(fn) {
      if (finished) return fn();
      const previous = _historyCaptureReservation;
      _historyCaptureReservation = reservation;
      try { return fn(); }
      finally {
        _historyCaptureReservation = previous;
        if (!finished) reservation.cancel();
      }
    },
    cancel() {
      if (finished) return;
      const stacks = [_getStack(entry.scope), _historyGlobal];
      stacks.forEach(stack => {
        ['undo', 'redo'].forEach(kind => {
          const index = stack[kind].indexOf(entry);
          if (index >= 0) stack[kind].splice(index, 1);
        });
      });
      finish();
    },
  };
  return reservation;
}

function historyPush(label, undoFn, redoFn, scope, detail) {
  const reservation = _historyCaptureReservation;
  if (reservation && !reservation.finished && (reservation.entry.scope || '') === (scope || '')) {
    _historyCaptureReservation = null;
    return reservation.fill(undoFn, redoFn, label, detail);
  }
  const s = _getStack(scope);
  const entry = { id: ++_historyEntrySequence, label, detail: detail || '', undo: undoFn, redo: redoFn, time: Date.now(), scope: scope || '' };
  s.undo.push(entry);
  const max = getHistoryMax();
  while (s.undo.length > max) s.undo.shift();
  s.redo.length = 0;
  // 新規アクション後はグローバル redo も破棄する（スコープ push でも redo 履歴は無効化される）
  if (scope && _historyGlobal && _historyGlobal !== s) {
    _historyGlobal.redo.length = 0;
  }
  renderHistoryList();
  renderHistoryPanel();
  return entry;
}

async function historyUndo(scope) {
  const targetScope = _resolveHistoryScopeArg(scope, arguments.length);
  return _historyNavigate('undo', targetScope, _allowGlobalHistoryFallback(scope, arguments.length));
}

async function historyRedo(scope) {
  const targetScope = _resolveHistoryScopeArg(scope, arguments.length);
  return _historyNavigate('redo', targetScope, _allowGlobalHistoryFallback(scope, arguments.length));
}

// 取り消し・やり直しの実行中に押された取り消し・やり直しは捨てずに順番待ちにし、
// 前の1件が終わってから1件ずつ実行する（保存待ち中の連打で1手分が消えていた）。
const _historyNavigationQueue = [];

function _historyNavigate(direction, targetScope, allowFallback) {
  // カレンダー表示モードの独自履歴の実行中は、共通履歴側に順番待ちを流す担当がいないため従来どおり見送る。
  if (!_historyBusy && _historyIsBusy()) return Promise.resolve(false);
  return new Promise(resolve => {
    _historyNavigationQueue.push({ direction, targetScope, allowFallback, resolve });
    if (!_historyBusy) _historyRunNavigationQueue();
  });
}

async function _historyRunNavigationQueue() {
  if (_historyBusy) return;
  _historyBusy = true;
  try {
    renderHistoryList();
    renderHistoryPanel();
    while (_historyNavigationQueue.length) {
      const request = _historyNavigationQueue.shift();
      let result = false;
      try { result = await _historyReplayEntry(request.direction, request.targetScope, request.allowFallback); }
      catch { result = false; }
      request.resolve(result);
    }
  } finally {
    _historyBusy = false;
    renderHistoryList();
    renderHistoryPanel();
  }
}

async function _historyPrepareNavigation(scope) {
  const result = _findHistorySnapshotProvider(scope)?.prepare?.(scope);
  return (await result) !== false;
}

// 履歴は復元が成功するまで元のスタックへ残す。取得・復元失敗も同じ境界で扱う。
async function _historyReplayEntry(direction, targetScope, allowFallback, prepared = false) {
  let actualScope = targetScope;
  let s = _getStack(actualScope);
  const opposite = direction === 'undo' ? 'redo' : 'undo';
  try {
    // 同期のprepareは従来どおり同期実行し、非同期のprepareだけ完了を待つ。
    if (!prepared) {
      const preparation = _findHistorySnapshotProvider(actualScope)?.prepare?.(actualScope);
      if ((preparation?.then ? await preparation : preparation) === false) return false;
    }
    if (_historyHasPendingTop(direction, actualScope, allowFallback)) {
      await _historyWaitForPendingTop(direction, actualScope, allowFallback);
    }
    if (s[direction].length === 0 && actualScope && allowFallback && _historyGlobal[direction].length
        && _historyGlobalFallbackAllowed(direction, actualScope)) {
      actualScope = '';
      s = _historyGlobal;
    }
    const source = s[direction];
    const entry = source[source.length - 1];
    if (!entry) {
      showStatus(direction === 'undo' ? '元に戻す操作がありません' : 'やり直す操作がありません');
      return false;
    }
    if (typeof entry[direction] !== 'function') {
      showStatus(entry.label + '（復元不可）', true);
      return false;
    }
    let inverse = entry[opposite];
    const provider = _findHistorySnapshotProvider(actualScope);
    if (typeof provider?.capture === 'function' && typeof inverse !== 'function') {
      const snapshot = await provider.capture(actualScope);
      if (snapshot == null) throw new Error('復元対象の現在の状態を取得できません');
      inverse = () => provider.restore(snapshot, actualScope);
    }
    const outcome = await _historyRunReplayStep(() => entry[direction]());
    if (outcome === false) throw new Error('復元が完了しませんでした');
    const index = source.indexOf(entry);
    // 待機中の新しい編集・再読込で分岐した場合は、古いRedoを復活させない。
    const unchanged = index === source.length - 1 && index >= 0;
    if (index >= 0) source.splice(index, 1);
    if (unchanged) {
      entry[opposite] = inverse;
      // 画面のスコープから共通の履歴へ落ちて実行した時は、その画面を覚えておく（逆向きを同じ画面から許すため）。
      entry._historyFallbackScope = (actualScope === '' && targetScope) ? targetScope : '';
      s[opposite].push(entry);
      while (s[opposite].length > getHistoryMax()) s[opposite].shift();
    }
    showStatus(outcome?.historyWarning || (direction === 'undo' ? '↩ ' : '↪ ') + entry.label, !!outcome?.historyWarning);
    return true;
  } catch (error) {
    showStatus((direction === 'undo' ? 'Undo失敗: ' : 'Redo失敗: ') + (error?.message || error), true);
    return false;
  }
}

function _historyPendingTop(direction, targetScope, allowFallback) {
  let stack = _getStack(targetScope)[direction];
  if (!stack.length && targetScope && allowFallback && _historyGlobalFallbackAllowed(direction, targetScope)) stack = _historyGlobal[direction];
  const top = stack[stack.length - 1];
  return top?._historyPending ? top : null;
}

function _historyHasPendingTop(direction, targetScope, allowFallback) {
  return !!_historyPendingTop(direction, targetScope, allowFallback);
}

// 取り消し・やり直しの対象（スタックの先頭）が予約中なら、中身が入るか取り除かれるまで待つ。
async function _historyWaitForPendingTop(direction, targetScope, allowFallback) {
  for (let guard = 0; guard < 1000; guard += 1) {
    const top = _historyPendingTop(direction, targetScope, allowFallback);
    if (!top) return;
    await top._historyPending;
  }
}

// 取り消し・やり直しの中で動く処理（列の削除・復元に伴う表示設定の保存など）が設定の履歴を
// 別に積み、やり直しの記録を消さないよう、その間だけ設定の履歴を止める（既存の抑止の仕組みを使う）。
async function _historyRunReplayStep(fn) {
  const hasWindow = typeof window !== 'undefined';
  if (hasWindow) window.__meldexSuppressLocalStorageSettingsHistory = Number(window.__meldexSuppressLocalStorageSettingsHistory || 0) + 1;
  try { return await fn(); }
  finally {
    if (hasWindow) window.__meldexSuppressLocalStorageSettingsHistory = Math.max(0, Number(window.__meldexSuppressLocalStorageSettingsHistory || 0) - 1);
  }
}

// === ヒストリー（右サイドバー）の一覧 ===
// 表示範囲: 'current' = 開いている対象の操作（＋その画面から Ctrl+Z / Ctrl+Y で続けて届く共通操作）／'all' = 起動中の全対象
let _historyPanelFilter = 'current';

const HISTORY_PANEL_HELP = '起動中に行った操作だけを記録します。Meldexを閉じたりページを再読み込みしたりすると消えます。保存点からの復元は「バージョン管理」を使います。';

// 対象の画面から Ctrl+Z（undo）／Ctrl+Y（redo）で続けて届く共通の履歴（次に実行されるものから順）。
// 実際の取り消し・やり直しと同じ判定（別のファイルを消す記録の手前で止まる）を使い、見た目と動きを一致させる。
function _historyReachableGlobal(direction, scope) {
  const reached = [];
  if (!scope) return reached;
  const stack = _historyGlobal[direction];
  for (let i = stack.length - 1; i >= 0; i -= 1) {
    const entry = stack[i];
    if (_historyEntryDeletesOtherFile(entry, direction, scope)) break;
    reached.push(entry);
    if (typeof entry[direction] !== 'function' && !entry._historyPending) break;
  }
  return reached;
}

function _historyPanelModel(filter = _historyPanelFilter) {
  const scope = _historyActiveScope;
  const undo = [];
  const redo = [];
  if (filter === 'all') {
    const seen = new Set();
    const stacks = [['', _historyGlobal], ...Object.entries(_historyStacks)];
    stacks.forEach(([stackScope, stack]) => {
      if (!stack) return;
      [['undo', undo], ['redo', redo]].forEach(([kind, rows]) => {
        stack[kind].forEach((entry, index) => {
          if (seen.has(entry)) return;
          seen.add(entry);
          rows.push({ entry, scope: stackScope, shared: false, steps: stack[kind].length - index });
        });
      });
    });
    undo.sort((a, b) => _historyNewestFirst(a.entry, b.entry));
    redo.sort((a, b) => _historyNewestFirst(a.entry, b.entry));
    return { undo, redo };
  }
  const own = _getStack(scope);
  const ownUndo = own.undo.map((entry, index) => ({ entry, scope, shared: false, steps: own.undo.length - index }));
  const ownRedo = own.redo.map((entry) => ({ entry, scope, shared: false }));
  ownUndo.sort((a, b) => _historyNewestFirst(a.entry, b.entry));
  ownRedo.sort((a, b) => _historyNewestFirst(a.entry, b.entry));
  // 共通の履歴は、対象の操作をすべて戻した後（undo）／すべてやり直した後（redo）に届く。
  const sharedUndo = _historyReachableGlobal('undo', scope).map(entry => ({ entry, scope: '', shared: true }));
  const sharedRedo = _historyReachableGlobal('redo', scope).map(entry => ({ entry, scope: '', shared: true }));
  sharedUndo.sort((a, b) => _historyNewestFirst(a.entry, b.entry));
  sharedRedo.sort((a, b) => _historyNewestFirst(a.entry, b.entry));
  // 「現在」に近い側ほど先に実行される。やり直し側は下（現在の直上）が先、元に戻す側は上（現在の直下）が先。
  return { undo: [...ownUndo, ...sharedUndo], redo: [...sharedRedo, ...ownRedo] };
}

function _historyRowTime(entry) {
  return new Date(entry.time).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function _historyRowTag(row, filter) {
  if (row.shared) return '<span class="gb-hp-scope-tag">共通</span> ';
  if (filter !== 'all') return '';
  return `<span class="gb-hp-scope-tag">${esc(_historyScopeDisplayName(row.scope))}</span> `;
}

function _historyPanelHtml(filterId) {
  const filter = _historyPanelFilter === 'all' ? 'all' : 'current';
  const busy = _historyIsBusy();
  const model = _historyPanelModel(filter);
  const scopeLabel = _historyScopeDisplayName(_historyActiveScope);
  let html = `<div class="gb-hp-toolbar">
    <select id="${esc(filterId)}" aria-label="履歴の表示範囲" class="gb-select gb-select-sm gb-hp-filter"
      data-onchange="this.value==='all'?(_historyPanelFilter='all'):(_historyPanelFilter='current');renderHistoryList();renderHistoryPanel()">
      <option value="current"${filter === 'current' ? ' selected' : ''}>現在: ${esc(scopeLabel)}</option>
      <option value="all"${filter === 'all' ? ' selected' : ''}>すべて</option>
    </select>
    <button type="button" class="gb-btn gb-btn-xs gb-btn-quiet" data-action="confirmHistoryPanelClear()"${busy ? ' disabled' : ''}>クリア</button>
  </div>`;
  if (!model.undo.length && !model.redo.length) {
    const help = typeof fieldHelp === 'function' ? ' ' + fieldHelp(HISTORY_PANEL_HELP, { size: 12 }) : '';
    return html + `<div class="gb-hp-empty">操作履歴がありません${help}</div>`;
  }
  // やり直し側（「現在」より上）。一覧からは実行しない（Ctrl+Y / 進む を使う）。
  model.redo.forEach(row => {
    const parts = _historyDisplayParts(row.entry);
    html += `<div class="gb-hp-entry gb-hp-entry-redo">`
      + `${_hpScopeIcon(row.scope)}${_historyRowTag(row, filter)}<span class="gb-hp-label">${esc(parts.title)}</span>`
      + `<span class="gb-hp-time">${_historyRowTime(row.entry)}</span>`
      + (parts.detail ? `<span class="gb-hp-detail">${esc(parts.detail)}</span>` : '')
      + `</div>`;
  });
  html += `<div class="gb-hp-current">${typeof lucide === 'function' ? lucide('play', 12) : ''} 現在</div>`;
  // 元に戻す側。行を押す（Enter / Space でも可）と、その操作までまとめて戻す。
  model.undo.forEach(row => {
    const entry = row.entry;
    const parts = _historyDisplayParts(entry);
    const clickable = typeof entry.undo === 'function' || !!entry._historyPending;
    const cls = clickable ? 'gb-hp-entry gb-hp-entry-undo gb-hp-entry-clickable' : 'gb-hp-entry gb-hp-entry-undo gb-hp-entry-disabled';
    let action = '';
    if (clickable) {
      action = (filter === 'current' && row.shared)
        ? _historyActionAttrs('historyPanelJumpThroughShared', [entry.id])
        : _historyActionAttrs('historyPanelJump', [row.steps, row.scope || '', entry.id]);
    }
    const tag = clickable ? 'button' : 'div';
    const title = clickable ? ` title="${esc('ここまで元に戻す: ' + parts.title)}"` : '';
    html += `<${tag} class="${cls}" data-e2e-id="history-panel-entry:${esc(row.scope || 'shared')}:${esc(String(entry.id))}"${clickable ? ' type="button"' : ''}${title} ${action}${clickable && busy ? ' disabled' : ''}>`
      + `${_hpScopeIcon(row.scope)}${_historyRowTag(row, filter)}<span class="gb-hp-label">${esc(parts.title)}</span>`
      + `<span class="gb-hp-time">${_historyRowTime(entry)}</span>`
      + (parts.detail ? `<span class="gb-hp-detail">${esc(parts.detail)}</span>` : '')
      + `</${tag}>`;
  });
  return html;
}

function renderHistoryList() {
  // ボタンの有効/無効更新は履歴パネルDOM（#rp-history-list）の有無に関わらず必ず行う。
  // 単独起動アプリ（履歴パネルを持たない）でもツールバーのボタン状態を追随させるため、
  // 早期returnより前に呼ぶ（v0.6.205、単独アプリ展開フェーズ5）。
  if (typeof updateUndoRedoButtonStates === 'function') updateUndoRedoButtonStates();
  const el = document.getElementById('rp-history-list');
  if (!el) return;
  const html = _historyPanelHtml('rp-history-filter');
  el.innerHTML = html;
}

// 旧・詳細パネルのタブ（#detail-tab-op-history）。現在の画面には無く、同じ一覧を描く。
function renderHistoryPanel() {
  const el = document.getElementById('detail-tab-op-history');
  if (!el) return;
  const html = _historyPanelHtml('hp-filter');
  el.innerHTML = html;
}

function _hpScopeIcon(scope) {
  if (!scope) return '';
  const s = scope.split(':')[0];
  const name = s === 'scriptnote' ? 'bookOpenText' : s === 'db' ? 'database' : s === 'page' ? 'fileEdit' : 'file';
  return typeof lucide === 'function' ? lucide(name, 12) + ' ' : '';
}

async function historyPanelJump(steps, scope, entryId) {
  if (!Number.isSafeInteger(steps) || steps <= 0 || _historyIsBusy()) return false;
  const targetScope = arguments.length >= 2 ? (scope || '') : _historyActiveScope;
  const initialStack = _getStack(targetScope);
  const selected = entryId == null ? initialStack.undo[initialStack.undo.length - steps]
    : initialStack.undo.find(entry => entry.id === entryId);
  if (!selected) return false;
  _historyBusy = true;
  try {
    renderHistoryList();
    renderHistoryPanel();
    if (steps >= 3) {
      const ok = await cfConfirm(steps + '件の操作を元に戻しますか？');
      if (!ok) return false;
    }
    // ヒストリーパネルの「すべて」フィルタから、いま画面に無い別スコープの項目を
    // 巻き戻すことがある。適用前に対象タブを画面へ出す（パネル取り違え対策）。
    if (typeof _meldexPrepareHistoryScopeTarget === 'function') {
      const prep = await _meldexPrepareHistoryScopeTarget(targetScope);
      if (!prep.ok) { if (typeof showStatus === 'function') showStatus('対象の文書が開かれていないため元に戻せません', true); return false; }
    }
    if (!await _historyPrepareNavigation(targetScope)) return false;
    // 予約中（保存待ち）の枠は中身が入るか取り除かれるまで待ってから戻す範囲を決める。
    const pendingEntries = initialStack.undo.map(entry => entry._historyPending).filter(Boolean);
    if (pendingEntries.length) await Promise.all(pendingEntries);
    const index = initialStack.undo.indexOf(selected);
    if (index < 0) return false;
    const planned = initialStack.undo.slice(index).reverse();
    for (const entry of planned) {
      // 保存待ち中に新しい操作が入ったら、その操作まで勝手に巻き戻さない。
      if (initialStack.undo[initialStack.undo.length - 1] !== entry) return false;
      if (!await _historyReplayEntry('undo', targetScope, false, true)) return false;
    }
    return true;
  } catch (error) {
    showStatus('Undo失敗: ' + (error?.message || error), true);
    return false;
  } finally {
    _historyBusy = false;
    renderHistoryList();
    renderHistoryPanel();
    // 一括の取り消し中に押された取り消し・やり直しを、終わった後に順番に流す。
    if (_historyNavigationQueue.length) _historyRunNavigationQueue();
  }
}

// 「現在」表示の「共通」行を押した時: 開いている対象の操作をすべて戻してから、共通の操作をその行まで戻す。
// Ctrl+Z を続けて押した時と同じ順番・同じ判定で戻す。
async function historyPanelJumpThroughShared(entryId) {
  if (_historyIsBusy()) return false;
  const scope = _historyActiveScope;
  if (!scope) return false;
  const ownStack = _getStack(scope);
  const selected = _historyGlobal.undo.find(entry => entry.id === entryId);
  if (!selected || !_historyReachableGlobal('undo', scope).includes(selected)) return false;
  _historyBusy = true;
  try {
    renderHistoryList();
    renderHistoryPanel();
    const total = ownStack.undo.length + (_historyGlobal.undo.length - _historyGlobal.undo.indexOf(selected));
    if (total >= 3) {
      const ok = await cfConfirm(total + '件の操作を元に戻しますか？');
      if (!ok) return false;
    }
    if (!await _historyPrepareNavigation(scope)) return false;
    const pendingEntries = [...ownStack.undo, ..._historyGlobal.undo].map(entry => entry._historyPending).filter(Boolean);
    if (pendingEntries.length) await Promise.all(pendingEntries);
    const ownPlanned = ownStack.undo.slice().reverse();
    for (const entry of ownPlanned) {
      // 待っている間に新しい操作が入ったら、その操作まで勝手に巻き戻さない。
      if (ownStack.undo[ownStack.undo.length - 1] !== entry) return false;
      if (!await _historyReplayEntry('undo', scope, false, true)) return false;
    }
    const index = _historyGlobal.undo.indexOf(selected);
    if (index < 0 || ownStack.undo.length) return false;
    const sharedPlanned = _historyGlobal.undo.slice(index).reverse();
    for (const entry of sharedPlanned) {
      if (_historyGlobal.undo[_historyGlobal.undo.length - 1] !== entry) return false;
      if (!_historyGlobalFallbackAllowed('undo', scope)) return false;
      if (!await _historyReplayEntry('undo', '', false, true)) return false;
    }
    return true;
  } catch (error) {
    showStatus('Undo失敗: ' + (error?.message || error), true);
    return false;
  } finally {
    _historyBusy = false;
    renderHistoryList();
    renderHistoryPanel();
    if (_historyNavigationQueue.length) _historyRunNavigationQueue();
  }
}

async function confirmHistoryPanelClear() {
  if (_historyIsBusy()) return false;
  const scope = _historyActiveScope;
  const all = _historyPanelFilter === 'all';
  const ok = await cfConfirm(all ? 'すべての操作履歴をクリアしますか？編集内容は変わりません。'
    : '現在の対象の操作履歴をクリアしますか？編集内容は変わりません。');
  return ok ? historyPanelClear(scope, all) : false;
}

function historyPanelClear(scope = _historyActiveScope, all = _historyPanelFilter === 'all') {
  if (_historyIsBusy()) return false;
  if (all) {
    _historyGlobal.undo.length = 0;
    _historyGlobal.redo.length = 0;
    Object.values(_historyStacks).forEach(s => {
      s.undo.length = 0;
      s.redo.length = 0;
    });
  } else {
    const s = _getStack(scope);
    s.undo.length = 0;
    s.redo.length = 0;
  }
  renderHistoryList();
  renderHistoryPanel();
  showStatus('操作履歴をクリアしました');
  return true;
}

/* ==============================
   タブ→履歴スコープ解決（v0.7.056、パネル取り違えバグ修正）
   タブ切替のたびに _historyActiveScope をアクティブペインのアクティブタブへ
   追随させるためのヘルパー。パネルシステム経由のタブ読み込み
   （_bridgeOpenOpts / _bridgePassiveOpenOpts）は skipHistoryScope:true のため
   historySetScope() を呼ばない。従来はこれが原因で、タブを切り替えても
   _historyActiveScope が「最後にフォルダツリー等から直接開いたシート」に
   貼り付いたままになり、Ctrl+Z が画面と別のシートに効くことがあった。
   ここではスコープ文字列を再定義せず、各ツールの既存スコープ生成関数
   （_dbViewConfigHistoryScope / _bdHistoryScope / _schedHistoryScope /
   ScriptNoteEditor._historyScope）をそのまま呼ぶ。
   ============================== */
function _meldexDbTabHistoryScope(tab) {
  const path = tab?.path || '';
  if (!path) return '';
  return typeof _dbViewConfigHistoryScope === 'function' ? _dbViewConfigHistoryScope(path) : ('db:' + path);
}
function _meldexCsvTabHistoryScope(tab) {
  const path = tab?.path || '';
  return path ? ('csv:' + path) : '';
}
function _meldexBoardTabHistoryScope(tab) {
  const path = tab?.path || '';
  return typeof _bdHistoryScope === 'function' ? _bdHistoryScope(path) : ('board:' + path);
}
function _meldexScriptNoteTabHistoryScope(tab) {
  if (typeof getComponentInstance !== 'function') return '';
  const editor = getComponentInstance(tab?.id)?._editor;
  return (editor && typeof editor._historyScope === 'function') ? editor._historyScope() : '';
}
function _meldexScheduleTabHistoryScope(tab) {
  if (typeof getComponentInstance !== 'function' || typeof _schedHistoryScope !== 'function') return '';
  const comp = getComponentInstance(tab?.id);
  const embed = comp?._surface === 'productionTasks' && comp._productionTaskState?.embed;
  const path = embed?.getCurrentPath?.();
  if (path) return typeof _dbViewConfigHistoryScope === 'function' ? _dbViewConfigHistoryScope(path) : 'db:' + String(path).replace(/\\/g, '/');
  return comp ? _schedHistoryScope(comp) : '';
}
function _meldexPageTabHistoryScope(tab) {
  const path = String(tab?.path || tab?.state?.path || '').replace(/\\/g, '/').replace(/^\/+/, '');
  return path ? `page:${path}` : '';
}
function _meldexMapTabHistoryScope(tab) {
  const path = String(tab?.path || tab?.state?.mapPath || '').replace(/\\/g, '/');
  return path ? `map:${path}` : '';
}

function _meldexFormAppTabHistoryScope(tab) {
  const path = String(tab?.path || tab?.state?.formPath || '').replace(/\\/g, '/').replace(/^\/+/, '');
  return path ? `form-app:${path}` : '';
}

// 共通履歴（スコープなし）を使うタブ種別。
function _meldexCommonHistoryTabScope() { return ''; }

// タブ種別 → スコープ解決関数。ここに無い種別（フォルダツリー/チャット/アノテート/検索/
// タイマー/ヒストリーパネル等の道具パネル）は「スコープ変更なし」を意味し、
// _meldexResolveActiveTabHistoryScope() は null を返す。
const _MELDEX_TAB_HISTORY_SCOPE_RESOLVERS = Object.freeze({
  database: _meldexDbTabHistoryScope,
  pivot: _meldexDbTabHistoryScope,
  gallery: _meldexDbTabHistoryScope,
  kanban: _meldexDbTabHistoryScope,
  timeline: _meldexDbTabHistoryScope,
  chart: _meldexDbTabHistoryScope,
  graph: _meldexDbTabHistoryScope,
  form: _meldexDbTabHistoryScope,
  csv: _meldexCsvTabHistoryScope,
  board: _meldexBoardTabHistoryScope,
  scriptnote: _meldexScriptNoteTabHistoryScope,
  calendar: _meldexScheduleTabHistoryScope,
  page: _meldexPageTabHistoryScope,
  map: _meldexMapTabHistoryScope,
  'form-app': _meldexFormAppTabHistoryScope,
  entity: _meldexCommonHistoryTabScope,
  media: _meldexCommonHistoryTabScope,
  html: _meldexCommonHistoryTabScope,
  folder: _meldexCommonHistoryTabScope,
  welcome: _meldexCommonHistoryTabScope,
  compare: _meldexCommonHistoryTabScope,
});

function _meldexActiveTabForPane(paneId) {
  if (typeof GBLayout === 'undefined' || !GBLayout.root || typeof GBLayout.findNode !== 'function') return null;
  const targetPaneId = paneId || GBLayout.activePane;
  if (!targetPaneId) return null;
  const node = GBLayout.findNode(GBLayout.root, targetPaneId)?.node;
  if (!node || !Array.isArray(node.tabs)) return null;
  return node.tabs[node.activeTabIndex] || null;
}

// アクティブペインのアクティブタブに対応する履歴スコープを返す。
// 戻り値 null は「このタブ種別は履歴スコープを持たない（道具パネル等）」ことを示し、
// 呼び出し側は現在の _historyActiveScope をそのまま維持すること。
function _meldexResolveActiveTabHistoryScope(paneId) {
  const editor = globalThis.GBEditorHost?.get();
  if (editor && !paneId) return editor.historyScope?.() || null;
  const tab = _meldexActiveTabForPane(paneId);
  if (!tab || !tab.type) return null;
  const resolver = _MELDEX_TAB_HISTORY_SCOPE_RESOLVERS[tab.type];
  if (!resolver) return null;
  try { return resolver(tab) || ''; } catch { return ''; }
}

// タブ切替・レイアウト再描画の合流点から呼ぶ。スコープに変化が無ければ
// historySetScope()（renderHistoryList/Panel の再描画を伴う）を呼ばない。
function _meldexSyncActiveTabHistoryScope() {
  if (typeof historySetScope !== 'function') return;
  const scope = _meldexResolveActiveTabHistoryScope();
  if (scope !== null && scope !== _historyActiveScope) historySetScope(scope);
}

// 指定スコープに対応するタブを全パネル・全タブから探す（ヒストリーパネルの
// 「すべて」フィルタから別スコープを明示指定して巻き戻す場合、対象タブが
// いま画面に無いことがあるため）。同じ解決関数マップを使い、スコープ文字列の
// 組み立てを再定義しない。
function _meldexFindTabForHistoryScope(scope) {
  if (!scope || typeof GBLayout === 'undefined' || !GBLayout.root || typeof GBLayout.getAllPanes !== 'function') return null;
  const panes = GBLayout.getAllPanes(GBLayout.root) || [];
  for (const pane of panes) {
    for (const tab of (pane.tabs || [])) {
      const resolver = _MELDEX_TAB_HISTORY_SCOPE_RESOLVERS[tab.type];
      if (!resolver) continue;
      let tabScope = '';
      try { tabScope = resolver(tab) || ''; } catch { tabScope = ''; }
      if (tabScope && tabScope === scope) return { paneId: pane.id, tabId: tab.id };
    }
  }
  return null;
}

// v5.0 パネルシステム（GBLayout/GBTabs）が実在するかどうか。単独起動アプリや
// 一部のテスト環境ではそもそも存在しない（単一ビュー前提のため「他のタブへ
// 切り替える」という概念自体が無い）。
function _meldexHasPaneLayout() {
  return typeof GBLayout !== 'undefined' && !!GBLayout.root
    && typeof GBLayout.getAllPanes === 'function' && typeof GBLayout.findNode === 'function';
}

// board:/csv: スコープの復元は、宛先の識別子を持たない「いま読み込まれている
// ものが対象」という前提の実装になっている（_bdApplySnapshot は bd.nodes 等を
// 無条件に上書き、_csvRestoreSnapshot は _csvData を無条件に上書き。どちらも
// scriptnote:/schedule: のようにスナップショット自体から対象を
// 逆引きしない）。そのため、タブ切替直後・対象の非同期再読み込み
// （bdOpenBoard()/openCsvFile() の await apiFetch 区間）が終わる前に取り消しを
// 適用すると、対象のシート/ボードの内容が「まだ読み込み中の別のボード/CSV」
// へ書き込まれてしまう（v0.7.056、_meldexPrepareHistoryScopeTarget 追加に伴い
// 新たに顕在化したため同時に対処）。sheet系（db:）は値編集がAPI経由の
// 対象パス指定書き込みのため対象外（無関係な対象を汚染しない）。
const _MELDEX_LIVE_SCOPE_GETTERS = Object.freeze({
  'board:': () => (typeof bd !== 'undefined' && typeof _bdHistoryScope === 'function') ? _bdHistoryScope(bd.path) : null,
  'csv:': () => (typeof _csvHistoryScope === 'function') ? _csvHistoryScope() : null,
  'map:': () => {
    if (typeof getComponentInstance !== 'function') return null;
    const tab = _meldexActiveTabForPane();
    const component = tab?.type === 'map' ? getComponentInstance(tab.id) : null;
    return component?.store && typeof component._historyScope === 'function' ? component._historyScope() : null;
  },
});

function _meldexRiskyLiveScopePrefix(scope) {
  return Object.keys(_MELDEX_LIVE_SCOPE_GETTERS).find(prefix => scope.startsWith(prefix)) || null;
}

function _meldexSleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// 対象スコープの「いま読み込まれているものが対象」実装が、実際にそのスコープの
// データへ追いつくまで待つ。ポーリング間隔30ms・最大3秒（ローカルAPI想定で
// 通常は数十msで揃う）。タイムアウトした場合は false を返し、呼び出し側は
// 適用を中止して通知すること（黙って別データへ書き込むより安全側）。
async function _meldexWaitForLiveScopeSettle(scope, timeoutMs = 3000) {
  const prefix = _meldexRiskyLiveScopePrefix(scope);
  if (!prefix) return true;
  const getter = _MELDEX_LIVE_SCOPE_GETTERS[prefix];
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (getter() === scope) return true;
    await _meldexSleep(30);
  }
  return getter() === scope;
}

// 取り消し・やり直しの適用前に、対象スコープのタブが画面上のアクティブタブに
// なっていることを保証する。すでに表示中なら何もしない。見つかった場合は
// タブを切り替え、切り替えたことが分かるよう switched を立てる（Step2のタブ切替
// フックが _historyActiveScope を追随させるため、以後の historySetScope 呼び出しは
// 不要）。切り替えた対象が board:/csv: スコープの場合は、その非同期再読み込みが
// 実際に追いつくまで待ってから返す（上記コメント参照）。対象タブが見つからない
// 場合（閉じた後等）や、切り替え後に追いつかなかった場合は ok:false を返し、
// 呼び出し側は適用を中止して通知すること。共通履歴（scope===''）や、パネル
// システム自体が無い環境（単独起動アプリ等、判定不能）は常に ok:true とする
// （誤って正常な取り消しをブロックしない）。
async function _meldexPrepareHistoryScopeTarget(scope) {
  if (!scope || !_meldexHasPaneLayout()) return { ok: true, switched: false };
  if (!/^(db|board|csv|scriptnote|schedule|page|map):/.test(scope)) return { ok: true, switched: false };
  if (_meldexResolveActiveTabHistoryScope() === scope) return { ok: await _meldexWaitForLiveScopeSettle(scope), switched: false };
  const match = _meldexFindTabForHistoryScope(scope);
  if (!match) return { ok: false, switched: false };
  if (typeof GBTabs === 'undefined' || typeof GBTabs.activateTab !== 'function') return { ok: true, switched: false };
  GBTabs.activateTab(match.paneId, match.tabId);
  const settled = await _meldexWaitForLiveScopeSettle(scope);
  return { ok: settled, switched: true };
}

/* ==============================
   共通 Undo/Redo ルーター（取り消し・やり直しボタン展開 v0.6.196〜）
   - Ctrl+Z/Ctrl+Y（gb-shortcuts.part01.js）とツールバーの取り消し・やり直しボタンの
     どちらからも呼ばれる共通の入口。埋め込みシート → スケジュール → board残留 → 系統(B) →
     共通履歴、の振り分けをここに集約する（以前は gb-shortcuts.part01.js の
     global.undo/global.redo にハードコードされていた）。
   - activeElement 判定（contentEditable/INPUT/TEXTAREA でブラウザ既定へ委譲）は
     ショートカット側にのみ残す。ツールバーボタンはクリック時点でフォーカスが
     ボタンへ移るため、この判定をここに入れると挙動が変わってしまう。
   - フェーズ3-3（ボードの共通履歴統合）完了: board は 'board:<パス>' スコープの共通履歴
     へ完全移行した。bdUndo/bdRedo/historyCanUndo('board:...')経由になったため、
     独自スタック（_bdUndoStack等）を直接参照する分岐は撤去済み。
   - フェーズ3-2の実質置き換え（v0.6.199、系統(A)統合）: 「スケジュール」タブ本体
     （CalendarComponent, gb-tool-calendar.js）自身の予定/ToDo編集（this._undoStack系）を
     'schedule:<tabId>' スコープの共通履歴へ統合した（gb-tool-calendar.js の
     _pushUndo/_undo/_redo、および本ファイルの historyRegisterSnapshotProvider('schedule:', …)
     参照）。システム(B)（シートを「カレンダー表示モード」で開いた時の _calUndoStack系,
     下記の calendar 分岐）とは完全に別物で無変更。
   - board残留バグの修正（v0.6.199）: 従来は `state.view === 'board'` の判定を最優先していたため、
     ボードタブ表示後にスケジュールタブへ切り替えても（CalendarComponent.activate() は
     state.view を更新しないため）state.view が 'board' に残留し、スケジュールタブの
     Ctrl+Z がボードへ誤って発火し得た。ヒューリスティックな state.view 判定より、
     実際にアクティブなタブを明示的に確認する埋め込みシート判定・スケジュール判定を
     先に評価するよう順序を変更し解消した（下記 _meldexUndoRedoContext 参照）。
   - フェーズ4: 制作管理（スケジューラー）タブが埋め込みシート面（タスクリスト/管理リスト）を
     表示している間は、埋め込みシートの 'db:<パス>' スコープへ委譲する
     （CalendarComponent.handleKeyDown は Ctrl+Z の実処理経路として到達しないため
     ここが唯一の介入点。詳細は _meldexProductionEmbedHistoryScope() 参照）。

   系統(B)（未着手・現状維持）: gb-calendar.part01.part01.js の
   _calUndoStack/_calPushUndo/_calUndo/_calRedo（シートを「カレンダー表示モード」で開いた
   ときの独自実装, isCalendarDb() で判定）は本セッションでは変更しない。長期的な扱い
   （統合・廃止）は別課題として AGENT_INBOX に残す。

   isCalendarDb()状態残留バグの修正（v0.6.207）: isCalendarDb() は
   `state.pivotData.calendar_db` の値だけを見ており、この値はカレンダー表示モードの
   シートを閉じて別ツール（CSV等）へ切り替えても selectDatabase() 以外の経路
   （showView()等）ではクリアされないため残留する。一方 `state.view` は
   ツール切替のたびに showView() が確実に更新する（CSVなら 'csv' 等）。
   従来はこの残留した `state.pivotData` だけを見て系統(B)へルーティングして
   いたため、カレンダー表示シートを開いた後にCSV等へ切り替えても取り消し・
   やり直しが誤って系統(B)（_calUndo/_calRedo）へ向かっていた
   （2026-07-19 フェーズ6検証で発見、AGENT_INBOX記録）。
   `_meldexCalendarSheetActive()` で「isCalendarDb()が真、かつ state.view が
   シート表示系のビューモードである」ことを併せて要求し、実際にカレンダー表示
   シートがアクティブな時だけ系統(B)へルーティングするよう厳密化した。
   ============================== */
function _meldexProductionEmbedHistoryScope() {
  const editor = globalThis.GBEditorHost?.get();
  const component = editor ? (editor.kind === 'calendar' ? editor.component : null)
    : typeof _activeCalendarShortcutComponent === 'function' ? _activeCalendarShortcutComponent() : null;
  if (!component || component._surface !== 'productionTasks') return '';
  const taskState = component._productionTaskState;
  if (taskState?.allView?.isMounted?.() && ['all', 'task'].includes(taskState.selection?.kind)) return '';
  const embed = taskState && taskState.embed;
  const path = embed && typeof embed.getCurrentPath === 'function' ? embed.getCurrentPath() : '';
  if (!path) return '';
  return typeof _dbViewConfigHistoryScope === 'function'
    ? _dbViewConfigHistoryScope(path)
    : ('db:' + String(path).replace(/\\/g, '/'));
}

// gb-tool-calendar-options.js の CALENDAR_SETTINGS_SCOPE と同一の文字列（IIFE内のローカル
// const のため直接参照できない）。スケジュールタブ自身の予定/ToDo編集の取り消し履歴が
// 空のときに、既存のスケジュール設定（サイドバー表示・週開始曜日等）の取り消しへ
// フォールバックするための参照専用の重複定義。
const _MELDEX_SCHEDULE_SETTINGS_HISTORY_SCOPE = 'calendar:settings';

// アクティブなタブが「スケジュール」タブ本体（系統(A)）で、かつ埋め込みシート面
// （制作管理タスクリスト等、productionTasks）を表示していない場合にそのコンポーネントを返す。
// productionTasks 面は上の _meldexProductionEmbedHistoryScope() が別途処理するため対象外にする。
function _meldexScheduleActiveComponent() {
  const editor = globalThis.GBEditorHost?.get();
  const component = editor ? (editor.kind === 'calendar' ? editor.component : null)
    : typeof _activeCalendarShortcutComponent === 'function' ? _activeCalendarShortcutComponent() : null;
  if (!component) return null;
  if (component._surface === 'productionTasks') {
    const taskState = component._productionTaskState;
    if (!taskState?.allView?.isMounted?.() || !['all', 'task'].includes(taskState.selection?.kind)) return null;
  }
  return component;
}

// gb-app.js の showView() 内 isDbViewName と同一のビューモード一覧（ローカル関数の
// ため直接参照できない）。シート（データベース）が実際に画面表示されている時に
// state.view が取り得る値の全集合。showView() を経由しない他ツールへの切替では
// state.view はこの集合外の値（'csv'/'page'/'entity'/'board'/'folder' 等）になる。
const _MELDEX_DB_VIEW_MODES = ['pivot', 'tree', 'gallery', 'kanban', 'timeline', 'gantt', 'chart', 'graph', 'form', 'calendar', 'tasks', 'shifts'];

// isCalendarDb()（系統(B)判定）は `state.pivotData.calendar_db` の残留値だけを見るため、
// カレンダー表示モードのシートを閉じて別ツールへ切り替えた後も真のままになり得る
// （state.pivotData をクリアする経路が selectDatabase() 系にしか無いため）。
// ここで state.view がシート表示系のビューモードであることも併せて要求し、
// 「実際に今アクティブなのがカレンダー表示モードのシートか」を厳密化する
// （v0.6.207、詳細は上のルーターコメント参照）。
function _meldexCalendarSheetActive() {
  if (typeof isCalendarDb !== 'function' || !isCalendarDb()) return false;
  if (typeof state === 'undefined' || !state) return false;
  return _MELDEX_DB_VIEW_MODES.includes(state.view);
}

function _meldexUndoRedoContext() {
  const editor = globalThis.GBEditorHost?.get();
  if (editor) {
    if (editor.kind === 'board') return 'board';
    if (editor.kind === 'calendar') return _meldexProductionEmbedHistoryScope() ? 'embedded-sheet' : 'schedule';
    return 'history';
  }
  if (_meldexProductionEmbedHistoryScope()) return 'embedded-sheet';
  if (_meldexScheduleActiveComponent()) return 'schedule';
  if (typeof state !== 'undefined' && state && state.view === 'board') return 'board';
  if (_meldexCalendarSheetActive()) {
    const mode = typeof getCalendarMode === 'function' ? getCalendarMode(state.currentDbPath) : 'month';
    if (mode !== 'timeline') return 'calendar';
  }
  return 'history';
}

// スケジュールタブ自身の 'schedule:<tabId>' スコープを優先し、そこに取り消せる操作が
// 無い場合のみ 'calendar:settings'（設定変更）へフォールバックする。
function _meldexScheduleUndo() {
  const component = _meldexScheduleActiveComponent();
  if (!component) return;
  const scope = typeof _schedHistoryScope === 'function' ? _schedHistoryScope(component) : '';
  if (scope && typeof historyCanUndo === 'function' && historyCanUndo(scope)) {
    if (typeof component._undo === 'function') return component._undo();
    return false;
  }
  if (typeof historyCanUndo === 'function' && historyCanUndo(_MELDEX_SCHEDULE_SETTINGS_HISTORY_SCOPE) && typeof historyUndo === 'function') {
    return historyUndo(_MELDEX_SCHEDULE_SETTINGS_HISTORY_SCOPE);
  }
}

function _meldexScheduleRedo() {
  const component = _meldexScheduleActiveComponent();
  if (!component) return;
  const scope = typeof _schedHistoryScope === 'function' ? _schedHistoryScope(component) : '';
  if (scope && typeof historyCanRedo === 'function' && historyCanRedo(scope)) {
    if (typeof component._redo === 'function') return component._redo();
    return false;
  }
  if (typeof historyCanRedo === 'function' && historyCanRedo(_MELDEX_SCHEDULE_SETTINGS_HISTORY_SCOPE) && typeof historyRedo === 'function') {
    return historyRedo(_MELDEX_SCHEDULE_SETTINGS_HISTORY_SCOPE);
  }
}

// 開いているファイルの名前の変更・移動の後は、タブの履歴スコープ（page:<新しいパス> 等）が変わるのに、
// _historyActiveScope が古いパスのまま残ることがある（タブの切替が無いので追随の合流点を通らない）。
// その古いスコープのタブはもう無いので「開かれていない」と断っていた（2026-11-22 M-014 フォルダツリー網羅テスト:
// ツリーでクリックして開いたノートを F2 で改名→Ctrl+Z が効かない）。対象のタブが見つからず、いまのアクティブタブが
// 別のスコープを持つ時は、アクティブタブのスコープへ合わせる（改名・移動の履歴は共通履歴にあり、そこへ戻れる）。
function _meldexResyncStaleHistoryScope(scope) {
  if (!scope || !_meldexHasPaneLayout()) return scope;
  if (!/^(db|board|csv|scriptnote|schedule|page|map):/.test(scope)) return scope;
  if (globalThis.GBEditorHost?.get()) return scope;
  if (_meldexFindTabForHistoryScope(scope)) return scope;
  const live = _meldexResolveActiveTabHistoryScope();
  if (live === null || live === scope) return scope;
  if (typeof historySetScope === 'function') historySetScope(live);
  return live;
}

async function meldexUndo() {
  if ((globalThis.GBAnnotationSurfaces?.usesHistory?.() ?? globalThis.GBAnnotationSurfaces?.isOpen())) return globalThis.GBAnnotationSurfaces.undo();
  const ctx = _meldexUndoRedoContext();
  if (ctx === 'board') { if (typeof bdUndo === 'function') return bdUndo(); return false; }
  if (ctx === 'embedded-sheet') { if (typeof historyUndo === 'function') return historyUndo(_meldexProductionEmbedHistoryScope()); return false; }
  if (ctx === 'schedule') return _meldexScheduleUndo();
  if (ctx === 'calendar') { if (typeof _calUndo === 'function') return _calUndo(); return false; }
  if (typeof historyUndo !== 'function') return;
  const scope = _meldexResyncStaleHistoryScope(globalThis.GBEditorHost?.get()?.historyScope?.() ?? _historyActiveScope);
  // 通常は _historyActiveScope が既にアクティブタブへ追随済み（Step2）のため
  // ここでの切替は基本的に発生しない。念のための保険（例: スコープ同期漏れ）。
  if (typeof _meldexPrepareHistoryScopeTarget === 'function') {
    const prep = await _meldexPrepareHistoryScopeTarget(scope);
    if (!prep.ok) { if (typeof showStatus === 'function') showStatus('対象のファイルが開かれていないため元に戻せません', true); return; }
  }
  return _historyNavigate('undo', scope, true);
}

async function meldexRedo() {
  if ((globalThis.GBAnnotationSurfaces?.usesHistory?.() ?? globalThis.GBAnnotationSurfaces?.isOpen())) return globalThis.GBAnnotationSurfaces.redo();
  const ctx = _meldexUndoRedoContext();
  if (ctx === 'board') { if (typeof bdRedo === 'function') return bdRedo(); return false; }
  if (ctx === 'embedded-sheet') { if (typeof historyRedo === 'function') return historyRedo(_meldexProductionEmbedHistoryScope()); return false; }
  if (ctx === 'schedule') return _meldexScheduleRedo();
  if (ctx === 'calendar') { if (typeof _calRedo === 'function') return _calRedo(); return false; }
  if (typeof historyRedo !== 'function') return;
  const scope = _meldexResyncStaleHistoryScope(globalThis.GBEditorHost?.get()?.historyScope?.() ?? _historyActiveScope);
  if (typeof _meldexPrepareHistoryScopeTarget === 'function') {
    const prep = await _meldexPrepareHistoryScopeTarget(scope);
    if (!prep.ok) { if (typeof showStatus === 'function') showStatus('対象のファイルが開かれていないためやり直せません', true); return; }
  }
  return _historyNavigate('redo', scope, true);
}

// 共通履歴のみを対象にした有効/無効判定。scope省略時は historyUndo/historyRedo と
// 同じ規則（アクティブスコープ→空ならグローバルへフォールバック）で判定する。
// 予約中（保存待ち）の枠も、保存完了を待って戻せるので「戻せる」と扱う。
function _historyEntryCanReplay(entry, direction) {
  return !!entry && (typeof entry[direction] === 'function' || !!entry._historyPending);
}

function historyCanUndo(scope) {
  if (_historyIsBusy()) return false;
  const targetScope = _resolveHistoryScopeArg(scope, arguments.length);
  const s = _getStack(targetScope);
  if (s.undo.length > 0) return _historyEntryCanReplay(s.undo[s.undo.length - 1], 'undo');
  if (targetScope && _allowGlobalHistoryFallback(scope, arguments.length) && _historyGlobalFallbackAllowed('undo', targetScope)) return _historyEntryCanReplay(_historyGlobal.undo[_historyGlobal.undo.length - 1], 'undo');
  return false;
}

function historyCanRedo(scope) {
  if (_historyIsBusy()) return false;
  const targetScope = _resolveHistoryScopeArg(scope, arguments.length);
  const s = _getStack(targetScope);
  if (s.redo.length > 0) return _historyEntryCanReplay(s.redo[s.redo.length - 1], 'redo');
  if (targetScope && _allowGlobalHistoryFallback(scope, arguments.length) && _historyGlobalFallbackAllowed('redo', targetScope)) return _historyEntryCanReplay(_historyGlobal.redo[_historyGlobal.redo.length - 1], 'redo');
  return false;
}

// meldexUndo/meldexRedo と同じ分岐で有効/無効を判定する（ツールバーボタンの disabled 制御用）。
// board はフェーズ3-3、schedule（スケジュールタブ本体, 系統(A)）はv0.6.199で共通履歴
// （'board:<パス>' / 'schedule:<tabId>' スコープ）へ統合済みのため historyCanUndo/historyCanRedo
// 経由で判定する。calendar（系統(B), シートのカレンダー表示モード、未移行）のみ独自スタックの
// length を直接参照する暫定分岐が残る。
function meldexCanUndo() {
  if (_historyBusy || (typeof _calHistoryBusy !== 'undefined' && _calHistoryBusy)) return false;
  if ((globalThis.GBAnnotationSurfaces?.usesHistory?.() ?? globalThis.GBAnnotationSurfaces?.isOpen())) return historyCanUndo(globalThis.GBAnnotationSurfaces.historyScope());
  const ctx = _meldexUndoRedoContext();
  if (ctx === 'board') return typeof _bdHistoryScope === 'function' ? historyCanUndo(_bdHistoryScope()) : (typeof _bdUndoStack !== 'undefined' && _bdUndoStack.length > 0);
  if (ctx === 'embedded-sheet') return historyCanUndo(_meldexProductionEmbedHistoryScope());
  if (ctx === 'schedule') return _meldexScheduleCanUndo();
  if (ctx === 'calendar') return typeof _calUndoStack !== 'undefined' && _calUndoStack.length > 0;
  return historyCanUndo();
}

function meldexCanRedo() {
  if (_historyBusy || (typeof _calHistoryBusy !== 'undefined' && _calHistoryBusy)) return false;
  if ((globalThis.GBAnnotationSurfaces?.usesHistory?.() ?? globalThis.GBAnnotationSurfaces?.isOpen())) return historyCanRedo(globalThis.GBAnnotationSurfaces.historyScope());
  const ctx = _meldexUndoRedoContext();
  if (ctx === 'board') return typeof _bdHistoryScope === 'function' ? historyCanRedo(_bdHistoryScope()) : (typeof _bdRedoStack !== 'undefined' && _bdRedoStack.length > 0);
  if (ctx === 'embedded-sheet') return historyCanRedo(_meldexProductionEmbedHistoryScope());
  if (ctx === 'schedule') return _meldexScheduleCanRedo();
  if (ctx === 'calendar') return typeof _calRedoStack !== 'undefined' && _calRedoStack.length > 0;
  return historyCanRedo();
}

function _meldexScheduleCanUndo() {
  const component = _meldexScheduleActiveComponent();
  if (!component) return false;
  if (typeof _schedHasCommonHistory === 'function' && _schedHasCommonHistory()) {
    const scope = typeof _schedHistoryScope === 'function' ? _schedHistoryScope(component) : '';
    return !!(scope && historyCanUndo(scope)) || historyCanUndo(_MELDEX_SCHEDULE_SETTINGS_HISTORY_SCOPE);
  }
  return Array.isArray(component._undoStack) && component._undoStack.length > 0;
}

function _meldexScheduleCanRedo() {
  const component = _meldexScheduleActiveComponent();
  if (!component) return false;
  if (typeof _schedHasCommonHistory === 'function' && _schedHasCommonHistory()) {
    const scope = typeof _schedHistoryScope === 'function' ? _schedHistoryScope(component) : '';
    return !!(scope && historyCanRedo(scope)) || historyCanRedo(_MELDEX_SCHEDULE_SETTINGS_HISTORY_SCOPE);
  }
  return Array.isArray(component._redoStack) && component._redoStack.length > 0;
}

// 全ツールバー・履歴パネルの取り消し・やり直しボタンの有効/無効を一括更新する。
// 目印は data-undo-button / data-redo-button。ノート・自由記述欄（ブラウザ標準undo）は
// 判定手段が無いため対象外＝常時有効のまま（この属性を付けない）。
function _meldexHistoryButtonCan(button, direction, fallback) {
  if ((globalThis.GBAnnotationSurfaces?.usesHistory?.() ?? globalThis.GBAnnotationSurfaces?.isOpen())) return fallback;
  const owner = globalThis.GBEditorHost?.ownerOf?.(button);
  const paneId = button.closest?.('.gb-pane')?.dataset.paneId;
  if (!owner && (!paneId || (typeof GBLayout !== 'undefined' && paneId === GBLayout.activePane && !globalThis.GBEditorHost?.get()))) return fallback;
  const scope = owner ? owner.historyScope?.() : _meldexResolveActiveTabHistoryScope(paneId);
  if (scope == null) return fallback;
  const ctx = owner?.ctx || (typeof getPaneContext === 'function' ? getPaneContext(paneId) : null);
  if (ctx?.pivotData?.calendar_db && ctx.viewMode === 'calendar'
      && (typeof getCalendarMode !== 'function' || getCalendarMode(ctx.dbPath) !== 'timeline')) {
    if (typeof _calHistoryBusy !== 'undefined' && _calHistoryBusy) return false;
    return direction === 'undo' ? typeof _calUndoStack !== 'undefined' && _calUndoStack.length > 0
      : typeof _calRedoStack !== 'undefined' && _calRedoStack.length > 0;
  }
  const can = direction === 'undo' ? historyCanUndo : historyCanRedo;
  return can(scope) || (String(scope).startsWith('schedule:') && can(_MELDEX_SCHEDULE_SETTINGS_HISTORY_SCOPE));
}
function updateUndoRedoButtonStates() {
  const canUndo = meldexCanUndo();
  const canRedo = meldexCanRedo();
  document.querySelectorAll('[data-undo-button]').forEach(btn => {
    const disabled = !_meldexHistoryButtonCan(btn, 'undo', canUndo);
    if (btn.disabled !== disabled) btn.disabled = disabled;
  });
  document.querySelectorAll('[data-redo-button]').forEach(btn => {
    const disabled = !_meldexHistoryButtonCan(btn, 'redo', canRedo);
    if (btn.disabled !== disabled) btn.disabled = disabled;
  });
}
