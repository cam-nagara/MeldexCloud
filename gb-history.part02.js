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
  // 台本スコープ: undo 前の状態を毎回キャプチャして redo に差し替える。
  // 過去の _redoCaptured フラグは undo/redo 往復で state が乖離する原因になったため廃止。
  if (actualScope && actualScope.startsWith('scriptnote:') && typeof _captureScriptnoteState === 'function') {
    const redoState = _captureScriptnoteState(actualScope);
    entry.redo = () => { _restoreScriptnoteState(redoState, actualScope); };
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
  // 台本スコープ: redo 前の状態を毎回キャプチャして undo に差し替える
  if (actualScope && actualScope.startsWith('scriptnote:') && typeof _captureScriptnoteState === 'function') {
    const undoState = _captureScriptnoteState(actualScope);
    entry.undo = () => { _restoreScriptnoteState(undoState, actualScope); };
  }
  try { await entry.redo(); } catch(e) { showStatus('Redo失敗: ' + e.message, true); s.redo.push(entry); return; }
  s.undo.push(entry);
  showStatus('↪ ' + entry.label);
  renderHistoryList();
  renderHistoryPanel();
}

function renderHistoryList() {
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

// Ctrl+Z / Ctrl+Y → gb-shortcuts.js の中央ハンドラに移行済み
