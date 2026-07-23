  try { return parseInt(localStorage.getItem('history-max')) || 50; } catch { return 50; }
}
function setHistoryMax(n) { localStorage.setItem('history-max', n); }

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
  const smartPath = typeof state !== 'undefined' ? state.currentSmartDb?._filePath : '';
  if (smartPath && matches(smartPath) && typeof saveSmartDbDef === 'function') {
    await Promise.resolve(saveSmartDbDef(state.currentSmartDb));
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
  renderHistoryList();
  renderHistoryPanel();
}

function _historyScopeDisplayName(scope) {
  const raw = scope ? scope.split(':').slice(1).join(':') : '';
  // パスの場合はファイル名のみ表示
  return raw.includes('/') ? raw.split('/').pop() : raw;
}

function _historyDisplayParts(entry) {
  const label = String(entry?.label || '');
  const explicitDetail = String(entry?.detail || '').trim();
  if (explicitDetail) return { title: label, detail: explicitDetail };
  const colonIdx = label.indexOf(': ');
  if (colonIdx >= 0) return { title: label.slice(0, colonIdx), detail: label.slice(colonIdx + 2) };
  return { title: label, detail: '' };
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
   - db:（シート）スコープは通常のプロパティ編集が既に正しい undo/redo クロージャを
     push時点で用意しているため、ここには登録しない（登録すると個々の編集が持つ
     正しいredoが毎回スナップショット差し替えで上書きされ、退行してしまうため）。
   ============================== */
const _historySnapshotProviders = {};
function historyRegisterSnapshotProvider(scopePrefix, provider) {
  if (!scopePrefix || !provider || typeof provider.capture !== 'function' || typeof provider.restore !== 'function') return;
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

// scriptnote: 既存の capture/restore をそのまま登録する（挙動不変のリファクタ）。
historyRegisterSnapshotProvider('scriptnote:', {
  capture: (scope) => (typeof _captureScriptnoteState === 'function' ? _captureScriptnoteState(scope) : null),
  restore: (state, scope) => { if (typeof _restoreScriptnoteState === 'function') _restoreScriptnoteState(state, scope); },
});

// board: ボード全体のスナップショット（gb-canvas-engine.part04.js の _bdSnapshot/_bdApplySnapshot）。
// bdPushUndo() は独自スタックへの直接pushをやめ、'board:<パス>' スコープでこのプロバイダ
// 経由の共通履歴へ統合する（フェーズ3-3）。
historyRegisterSnapshotProvider('board:', {
  capture: () => (typeof _bdSnapshot === 'function' ? _bdSnapshot() : null),
  restore: (snap) => {
    if (snap == null || typeof _bdApplySnapshot !== 'function') return;
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

// アクションを記録（undoFnとredoFnはasync可、scopeはオプション）
function historyPush(label, undoFn, redoFn, scope, detail) {
  const s = _getStack(scope);
  s.undo.push({ label, detail: detail || '', undo: undoFn, redo: redoFn, time: Date.now(), scope: scope || '' });
  const max = getHistoryMax();
  while (s.undo.length > max) s.undo.shift();
  s.redo.length = 0;
  // 新規アクション後はグローバル redo も破棄する（スコープ push でも redo 履歴は無効化される）
  if (scope && _historyGlobal && _historyGlobal !== s) {
    _historyGlobal.redo.length = 0;
  }
  renderHistoryList();
  renderHistoryPanel();
}

async function historyUndo(scope) {
  const targetScope = _resolveHistoryScopeArg(scope, arguments.length);
  let actualScope = targetScope;
  let s = _getStack(actualScope);
  if (s.undo.length === 0 && actualScope && _allowGlobalHistoryFallback(scope, arguments.length) && _historyGlobal.undo.length) {
    actualScope = '';
    s = _historyGlobal;
  }
  if (s.undo.length === 0) {
    showStatus('元に戻す操作がありません'); return;
  }
  const entry = s.undo.pop();
  // undo関数がnullのエントリ（ログ専用）はスキップして次を試行
  if (!entry.undo) {
    s.redo.push(entry);
    showStatus('↩ ' + entry.label + '（復元不可）');
    renderHistoryList();
    renderHistoryPanel();
    return;
  }
  // スナップショット型スコープ（scriptnote:/board: 等）: undo 前の状態を毎回キャプチャして
  // redo に差し替える。過去の _redoCaptured フラグは undo/redo 往復で state が乖離する
  // 原因になったため廃止。registerされたプロバイダのcapture/restoreは対象スコープの
  // 「絶対状態」を扱う前提のため、何度再キャプチャしても安全（フェーズ3で一般化）。
  const undoProvider = _findHistorySnapshotProvider(actualScope);
  if (undoProvider) {
    const redoState = await Promise.resolve(undoProvider.capture(actualScope));
    entry.redo = () => Promise.resolve(undoProvider.restore(redoState, actualScope));
  }
  try { await entry.undo(); } catch(e) { showStatus('Undo失敗: ' + e.message, true); s.undo.push(entry); return; }
  s.redo.push(entry);
  showStatus('↩ ' + entry.label);
  renderHistoryList();
  renderHistoryPanel();
}

async function historyRedo(scope) {
  const targetScope = _resolveHistoryScopeArg(scope, arguments.length);
  let actualScope = targetScope;
  let s = _getStack(actualScope);
  if (s.redo.length === 0 && actualScope && _allowGlobalHistoryFallback(scope, arguments.length) && _historyGlobal.redo.length) {
    actualScope = '';
    s = _historyGlobal;
  }
  if (s.redo.length === 0) {
    showStatus('やり直す操作がありません'); return;
  }
  const entry = s.redo.pop();
  // redo関数がnullのエントリ（ログ専用）はスキップ
  if (!entry.redo) {
    s.undo.push(entry);
    showStatus('↪ ' + entry.label + '（復元不可）');
    renderHistoryList();
    renderHistoryPanel();
    return;
  }
  // スナップショット型スコープ: redo 前の状態を毎回キャプチャして undo に差し替える
  const redoProvider = _findHistorySnapshotProvider(actualScope);
  if (redoProvider) {
    const undoState = await Promise.resolve(redoProvider.capture(actualScope));
    entry.undo = () => Promise.resolve(redoProvider.restore(undoState, actualScope));
  }
  try { await entry.redo(); } catch(e) { showStatus('Redo失敗: ' + e.message, true); s.redo.push(entry); return; }
  s.undo.push(entry);
  showStatus('↪ ' + entry.label);
  renderHistoryList();
  renderHistoryPanel();
}

function renderHistoryList() {
  // ボタンの有効/無効更新は履歴パネルDOM（#rp-history-list）の有無に関わらず必ず行う。
  // 単独起動アプリ（履歴パネルを持たない）でもツールバーのボタン状態を追随させるため、
  // 早期returnより前に呼ぶ（v0.6.205、単独アプリ展開フェーズ5）。
  if (typeof updateUndoRedoButtonStates === 'function') updateUndoRedoButtonStates();
  const el = document.getElementById('rp-history-list');
  if (!el) return;

  const allUndo = [];
  const allRedo = [];
  const seenUndo = new Set();
  const seenRedo = new Set();
  const collect = (stack, target, seen) => {
    if (!stack) return;
    stack.forEach(entry => {
      if (seen.has(entry)) return;
      seen.add(entry);
      target.push(entry);
    });
  };

  const activeStack = _historyActiveScope ? _getStack(_historyActiveScope) : null;
  if (activeStack) {
    collect(activeStack.undo, allUndo, seenUndo);
    collect(activeStack.redo, allRedo, seenRedo);
  }
  collect(_historyGlobal.undo, allUndo, seenUndo);
  collect(_historyGlobal.redo, allRedo, seenRedo);
  Object.entries(_historyStacks).forEach(([scope, stack]) => {
    if (scope === _historyActiveScope) return;
    collect(stack.undo, allUndo, seenUndo);
    collect(stack.redo, allRedo, seenRedo);
  });

  allUndo.sort((a, b) => b.time - a.time);
  allRedo.sort((a, b) => b.time - a.time);

  const formatScopeTag = (scope) => {
    if (!scope) return '';
    const label = scope.includes(':') ? scope.split(':').slice(1).join(':') : scope;
    return `<span class="gb-hp-scope-tag">${esc(label)}</span> `;
  };

  let html = '';
  allRedo.forEach(e => {
    const parts = _historyDisplayParts(e);
    html += `<div class="gb-hp-entry gb-hp-entry-redo">↪ ${formatScopeTag(e.scope)}${esc(parts.title)}`
      + (parts.detail ? `<div class="gb-hp-detail">${esc(parts.detail)}</div>` : '')
      + `</div>`;
  });
  html += `<div class="gb-hp-current">${lucide('play', 10)} 現在</div>`;
  allUndo.forEach(e => {
    const time = new Date(e.time).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const parts = _historyDisplayParts(e);
    html += `<div class="gb-hp-entry gb-hp-entry-undo">`
      + `${formatScopeTag(e.scope)}<span class="gb-hp-title">${esc(parts.title)}</span>`
      + `<span class="gb-hp-time">${time}</span>`
      + (parts.detail ? `<div class="gb-hp-detail">${esc(parts.detail)}</div>` : '')
      + `</div>`;
  });
  if (allUndo.length === 0 && allRedo.length === 0) {
    html = `<div class="gb-hp-empty">操作履歴がありません<div class="gb-hp-empty-hint">このヒストリーは現在の起動中のみ保持されます。シートの永続ログは「編集履歴」を使ってください。</div></div>`;
  }
  el.innerHTML = html;
}
// === 操作履歴パネル（詳細パネルのタブ） ===
let _historyPanelFilter = 'current'; // 'current' | 'all'

function renderHistoryPanel() {
  const el = document.getElementById('detail-tab-op-history');
  if (!el) return;

  // 全スコープの全エントリを収集
  const allEntries = [];
  const collectFrom = (stack, type) => {
    stack.forEach((e, i) => allEntries.push({ ...e, _type: type, _idx: i, _stack: stack }));
  };

  if (_historyPanelFilter === 'current' && _historyActiveScope) {
    const s = _getStack(_historyActiveScope);
    collectFrom(s.undo, 'undo');
    collectFrom(s.redo, 'redo');
  } else {
    // 全スコープ
    collectFrom(_historyGlobal.undo, 'undo');
    collectFrom(_historyGlobal.redo, 'redo');
    for (const [, s] of Object.entries(_historyStacks)) {
      collectFrom(s.undo, 'undo');
      collectFrom(s.redo, 'redo');
    }
  }

  // 時系列ソート（新しい順）
  allEntries.sort((a, b) => b.time - a.time);

  // undo/redoの境界を特定（最新のundoエントリが「現在位置」）
  const undoEntries = allEntries.filter(e => e._type === 'undo');
  const redoEntries = allEntries.filter(e => e._type === 'redo');

  // フィルタUI
  const scopeLabel = _historyActiveScope ? _historyScopeDisplayName(_historyActiveScope) : 'すべて';
  let html = `<div class="gb-hp-toolbar">
    <select id="hp-filter" class="gb-select gb-select-sm" style="flex:1;"
      data-onchange="this.value==='all'?(_historyPanelFilter='all'):(_historyPanelFilter='current');renderHistoryPanel()">
      <option value="current"${_historyPanelFilter==='current'?' selected':''}>現在: ${esc(scopeLabel)}</option>
      <option value="all"${_historyPanelFilter==='all'?' selected':''}>すべて</option>
    </select>
    <button class="gb-btn gb-btn-xs gb-btn-quiet" data-action="historyPanelClear()">クリア</button>
  </div>`;

  // redo（将来に戻す操作）
  redoEntries.forEach(e => {
    const time = new Date(e.time).toLocaleTimeString('ja-JP', { hour:'2-digit', minute:'2-digit', second:'2-digit' });
    const icon = _hpScopeIcon(e.scope);
    const scopeTag = (_historyPanelFilter === 'all' && e.scope) ? `<span class="gb-hp-scope-tag">${esc(_historyScopeDisplayName(e.scope))}</span> ` : '';
    html += `<div class="gb-hp-entry gb-hp-entry-redo">
      ${icon}${scopeTag}<span class="gb-hp-label">${esc(e.label)}</span>
      <span class="gb-hp-time">${time}</span>
    </div>`;
  });

  // 現在位置マーカー
  html += `<div class="gb-hp-current">${lucide('play', 12)} 現在</div>`;

  // undo（過去の操作）
  undoEntries.forEach((e, i) => {
    const time = new Date(e.time).toLocaleTimeString('ja-JP', { hour:'2-digit', minute:'2-digit', second:'2-digit' });
    const icon = _hpScopeIcon(e.scope);
    const clickable = e.undo !== null;
    const scopeTag = (_historyPanelFilter === 'all' && e.scope) ? `<span class="gb-hp-scope-tag">${esc(_historyScopeDisplayName(e.scope))}</span> ` : '';
    const cls = clickable ? 'gb-hp-entry gb-hp-entry-undo gb-hp-entry-clickable' : 'gb-hp-entry gb-hp-entry-undo gb-hp-entry-disabled';
    const steps = e._stack.length - e._idx;
    const action = clickable ? _historyActionAttrs('historyPanelJump', [steps, e.scope || '']) : '';
    html += `<div class="${cls}" ${action}>
      ${icon}${scopeTag}<span class="gb-hp-label">${esc(e.label)}</span>
      <span class="gb-hp-time">${time}</span>
    </div>`;
  });

  if (undoEntries.length === 0 && redoEntries.length === 0) {
    html += `<div class="gb-hp-empty">操作履歴がありません<div class="gb-hp-empty-hint">このヒストリーは現在の起動中のみ保持されます。シートの永続ログは「編集履歴」を使ってください。</div></div>`;
  }
  el.innerHTML = html;
}

function _hpScopeIcon(scope) {
  if (!scope) return '';
  const s = scope.split(':')[0];
  const name = s === 'scriptnote' ? 'bookOpenText' : s === 'db' ? 'database' : s === 'page' ? 'fileEdit' : 'file';
  return typeof lucide === 'function' ? lucide(name, 12) + ' ' : '';
}

async function historyPanelJump(steps, scope) {
  if (steps <= 0) return;
  const targetScope = arguments.length >= 2 ? (scope || '') : _historyActiveScope;
  if (steps >= 3) {
    const ok = await cfConfirm(steps + '件の操作を元に戻しますか？');
    if (!ok) return;
  }
  for (let i = 0; i < steps; i++) {
    await historyUndo(targetScope);
  }
}

function historyPanelClear() {
  if (_historyPanelFilter === 'all' || !_historyActiveScope) {
    _historyGlobal.undo.length = 0;
    _historyGlobal.redo.length = 0;
    Object.values(_historyStacks).forEach(s => {
      s.undo.length = 0;
      s.redo.length = 0;
    });
  } else {
    const s = _getStack(_historyActiveScope);
    s.undo.length = 0;
    s.redo.length = 0;
  }
  renderHistoryList();
  renderHistoryPanel();
  showStatus('操作履歴をクリアしました');
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
  if (typeof _activeCalendarShortcutComponent !== 'function') return '';
  const component = _activeCalendarShortcutComponent();
  if (!component || component._surface !== 'productionTasks') return '';
  const embed = component._productionTaskState && component._productionTaskState.embed;
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
  if (typeof _activeCalendarShortcutComponent !== 'function') return null;
  const component = _activeCalendarShortcutComponent();
  if (!component || component._surface === 'productionTasks') return null;
  return component;
}

// gb-app.js の showView() 内 isDbViewName と同一のビューモード一覧（ローカル関数の
// ため直接参照できない）。シート（データベース）が実際に画面表示されている時に
// state.view が取り得る値の全集合。showView() を経由しない他ツールへの切替では
// state.view はこの集合外の値（'csv'/'page'/'entity'/'board'/'folder' 等）になる。
const _MELDEX_DB_VIEW_MODES = ['pivot', 'gallery', 'kanban', 'timeline', 'chart', 'graph', 'form', 'smart-db', 'calendar', 'tasks', 'shifts'];

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
    if (typeof component._undo === 'function') component._undo();
    return;
  }
  if (typeof historyCanUndo === 'function' && historyCanUndo(_MELDEX_SCHEDULE_SETTINGS_HISTORY_SCOPE) && typeof historyUndo === 'function') {
    historyUndo(_MELDEX_SCHEDULE_SETTINGS_HISTORY_SCOPE);
  }
}

function _meldexScheduleRedo() {
  const component = _meldexScheduleActiveComponent();
  if (!component) return;
  const scope = typeof _schedHistoryScope === 'function' ? _schedHistoryScope(component) : '';
  if (scope && typeof historyCanRedo === 'function' && historyCanRedo(scope)) {
    if (typeof component._redo === 'function') component._redo();
    return;
  }
  if (typeof historyCanRedo === 'function' && historyCanRedo(_MELDEX_SCHEDULE_SETTINGS_HISTORY_SCOPE) && typeof historyRedo === 'function') {
    historyRedo(_MELDEX_SCHEDULE_SETTINGS_HISTORY_SCOPE);
  }
}

function meldexUndo() {
  const ctx = _meldexUndoRedoContext();
  if (ctx === 'board') { if (typeof bdUndo === 'function') bdUndo(); return; }
  if (ctx === 'embedded-sheet') { if (typeof historyUndo === 'function') historyUndo(_meldexProductionEmbedHistoryScope()); return; }
  if (ctx === 'schedule') { _meldexScheduleUndo(); return; }
  if (ctx === 'calendar') { if (typeof _calUndo === 'function') _calUndo(); return; }
  if (typeof historyUndo === 'function') historyUndo();
}

function meldexRedo() {
  const ctx = _meldexUndoRedoContext();
  if (ctx === 'board') { if (typeof bdRedo === 'function') bdRedo(); return; }
  if (ctx === 'embedded-sheet') { if (typeof historyRedo === 'function') historyRedo(_meldexProductionEmbedHistoryScope()); return; }
  if (ctx === 'schedule') { _meldexScheduleRedo(); return; }
  if (ctx === 'calendar') { if (typeof _calRedo === 'function') _calRedo(); return; }
  if (typeof historyRedo === 'function') historyRedo();
}

// 共通履歴のみを対象にした有効/無効判定。scope省略時は historyUndo/historyRedo と
// 同じ規則（アクティブスコープ→空ならグローバルへフォールバック）で判定する。
function historyCanUndo(scope) {
  const targetScope = _resolveHistoryScopeArg(scope, arguments.length);
  const s = _getStack(targetScope);
  if (s.undo.length > 0) return true;
  if (targetScope && _allowGlobalHistoryFallback(scope, arguments.length)) return _historyGlobal.undo.length > 0;
  return false;
}

function historyCanRedo(scope) {
  const targetScope = _resolveHistoryScopeArg(scope, arguments.length);
  const s = _getStack(targetScope);
  if (s.redo.length > 0) return true;
  if (targetScope && _allowGlobalHistoryFallback(scope, arguments.length)) return _historyGlobal.redo.length > 0;
  return false;
}

// meldexUndo/meldexRedo と同じ分岐で有効/無効を判定する（ツールバーボタンの disabled 制御用）。
// board はフェーズ3-3、schedule（スケジュールタブ本体, 系統(A)）はv0.6.199で共通履歴
// （'board:<パス>' / 'schedule:<tabId>' スコープ）へ統合済みのため historyCanUndo/historyCanRedo
// 経由で判定する。calendar（系統(B), シートのカレンダー表示モード、未移行）のみ独自スタックの
// length を直接参照する暫定分岐が残る。
function meldexCanUndo() {
  const ctx = _meldexUndoRedoContext();
  if (ctx === 'board') return typeof _bdHistoryScope === 'function' ? historyCanUndo(_bdHistoryScope()) : (typeof _bdUndoStack !== 'undefined' && _bdUndoStack.length > 0);
  if (ctx === 'embedded-sheet') return historyCanUndo(_meldexProductionEmbedHistoryScope());
  if (ctx === 'schedule') return _meldexScheduleCanUndo();
  if (ctx === 'calendar') return typeof _calUndoStack !== 'undefined' && _calUndoStack.length > 0;
  return historyCanUndo();
}

function meldexCanRedo() {
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
function updateUndoRedoButtonStates() {
  const canUndo = meldexCanUndo();
  const canRedo = meldexCanRedo();
  document.querySelectorAll('[data-undo-button]').forEach(btn => { btn.disabled = !canUndo; });
  document.querySelectorAll('[data-redo-button]').forEach(btn => { btn.disabled = !canRedo; });
}
