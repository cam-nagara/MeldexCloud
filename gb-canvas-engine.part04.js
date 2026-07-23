/* gb-canvas-engine.part04.js */
  // 接続線もコピー（選択ノード間のもの）
  (_bdClipboardConnections || []).forEach(c => {
    if (idMap[c.from] && idMap[c.to]) bd.connections.push({
      id: bdId(),
      from:idMap[c.from],
      to:idMap[c.to],
      arrow:c.arrow,
      label:c.label,
      style:c.style,
      semanticId:c.semanticId,
      styleRef:c.styleRef,
      width:c.width,
      straight:c.straight,
      pathType:c.pathType,
      hidden:c.hidden,
      color:c.color,
      labelTextColor:c.labelTextColor,
      labelBgColor:c.labelBgColor,
      labelBorderColor:c.labelBorderColor,
      labelBorderWidth:c.labelBorderWidth,
      fontBold:c.fontBold,
      fontItalic:c.fontItalic,
      fontFamily:c.fontFamily,
      textVisible:c.textVisible,
      textAlongPath:c.textAlongPath,
      textAutoFlip:c.textAutoFlip,
      textShadowWidth:c.textShadowWidth,
      textShadowColor:c.textShadowColor,
      fromAnchor:c.fromAnchor,
      toAnchor:c.toAnchor,
      branchRatio:c.branchRatio,
      cornerRadius:c.cornerRadius,
      controlPoints: Array.isArray(c.controlPoints) && c.controlPoints.length === 2
        ? [{ dx: c.controlPoints[0].dx, dy: c.controlPoints[0].dy },
           { dx: c.controlPoints[1].dx, dy: c.controlPoints[1].dy }]
        : undefined,
    });
  });
  // 新ノードを選択
  bd.selected = new Set(newNodes.map(n=>n.id));
  bdClearConnectionSelection();
  bdRender(); bdDirty();
  showStatus(newNodes.length + '\u500b\u306e\u30ce\u30fc\u30c9\u3092\u30da\u30fc\u30b9\u30c8\u3057\u307e\u3057\u305f');
}

// --- アンドゥ/リドゥ ---
// v0.6.198 フェーズ3-3: 本体アプリ（gb-history.js を読み込む環境）では bdPushUndo/bdUndo/
// bdRedo/bdClearUndoStacks は 'board:<パス>' スコープの共通履歴（historyPush/historyUndo/
// historyRedo）へ委譲し、履歴パネルとも連動する。単独起動アプリ（board-standalone.html 等、
// gb-history.js を読み込まない）では historyPush 等が未定義のため、従来どおり
// _bdUndoStack/_bdRedoStack の自己完結スタックにフォールバックする（挙動を変えない後方互換）。
const _bdUndoStack = [], _bdRedoStack = [], _BD_UNDO_MAX = 30;
function _bdHasCommonHistory() {
  return typeof historyPush === 'function' && typeof historyUndo === 'function' && typeof historyRedo === 'function';
}
function _bdHistoryScope(path) {
  const p = path != null ? path : (typeof bd !== 'undefined' ? bd.path : '');
  return 'board:' + String(p || '').replace(/\\/g, '/');
}
function _bdSnapshot() {
  return JSON.stringify({
    nodes: bd.nodes,
    connections: bd.connections,
    groups: bd.groups,
    cardStyles: bd.cardStyles,
    lineStyles: bd.lineStyles,
    depthStyles: bd.depthStyles,
    activeCardStyle: bd.activeCardStyle,
    activeLineStyle: bd.activeLineStyle,
    stylePresetSeedVersion: bd._stylePresetSeedVersion || 0,
    themeId: bd.themeId || '',
    statuses: bd.statuses,
    displayFilters: bd.displayFilters,
    tagFilter: bd.tagFilter,
    globalStyleDefaults: typeof bdCaptureGlobalStyleDefaults === 'function' ? bdCaptureGlobalStyleDefaults() : null,
    _numbering: bd._numbering || false,
    _bgColor: bd._bgColor || '',
    _fileStyle: bd._fileStyle || null,
    llmSemantics: bd.llmSemantics || (typeof bdDefaultLlmSemantics === 'function' ? bdDefaultLlmSemantics() : null),
    _showShadow: !!bd._showShadow,
    _textRotateOnLine: !!bd._textRotateOnLine,
    gapSiblings: bd.gapSiblings ?? null,
    gapLevels: bd.gapLevels ?? null,
    autoAlign: bd.autoAlign !== false,
  });
}
function bdPushUndo(label) {
  const _bdUndoPerf = typeof bdPerfStart === 'function' ? bdPerfStart('bdPushUndo') : 0;
  if (typeof bdClearUndoCoalesce === 'function') bdClearUndoCoalesce();
  if (_bdHasCommonHistory()) {
    const snap = _bdSnapshot();
    historyPush(label || 'ボード編集', () => {
      _bdApplySnapshot(JSON.parse(snap));
      if (typeof bdRender === 'function') bdRender();
      if (typeof bdDirty === 'function') bdDirty();
    }, null, _bdHistoryScope());
  } else {
    _bdUndoStack.push(_bdSnapshot()); if(_bdUndoStack.length>_BD_UNDO_MAX) _bdUndoStack.shift(); _bdRedoStack.length=0;
  }
  if (typeof bdPerfEnd === 'function') bdPerfEnd('bdPushUndo', _bdUndoPerf);
  if (typeof updateUndoRedoButtonStates === 'function') updateUndoRedoButtonStates();
}
function bdClearUndoStacks(path) {
  if (_bdHasCommonHistory() && typeof _historyStacks !== 'undefined') {
    const stack = _historyStacks[_bdHistoryScope(path)];
    if (stack) { stack.undo.length = 0; stack.redo.length = 0; }
  }
  _bdUndoStack.length = 0; _bdRedoStack.length = 0;
  if (typeof updateUndoRedoButtonStates === 'function') updateUndoRedoButtonStates();
}
function _bdApplySnapshot(s) {
  bd.nodes = s.nodes; bd.connections = s.connections; bd.groups = s.groups || [];
  bd.cardStyles = s.cardStyles || bd.cardStyles;
  bd.lineStyles = s.lineStyles || bd.lineStyles;
  bd.depthStyles = s.depthStyles || bd.depthStyles;
  bd.activeCardStyle = s.activeCardStyle || bd.activeCardStyle;
  bd.activeLineStyle = s.activeLineStyle || bd.activeLineStyle;
  bd._stylePresetSeedVersion = s.stylePresetSeedVersion || 0;
  bd.themeId = s.themeId || '';
  if (s.statuses !== undefined) bd.statuses = s.statuses;
  if (s.displayFilters !== undefined) bd.displayFilters = s.displayFilters || {};
  if (s.tagFilter !== undefined) bd.tagFilter = Array.isArray(s.tagFilter) ? s.tagFilter : [];
  if (s.globalStyleDefaults !== undefined && typeof bdRestoreGlobalStyleDefaults === 'function') {
    bdRestoreGlobalStyleDefaults(s.globalStyleDefaults);
  }
  if (s._numbering !== undefined) bd._numbering = !!s._numbering;
  if (s.llmSemantics !== undefined) bd.llmSemantics = s.llmSemantics || (typeof bdDefaultLlmSemantics === 'function' ? bdDefaultLlmSemantics() : null);
  if (s._showShadow !== undefined) bd._showShadow = !!s._showShadow;
  if (s._textRotateOnLine !== undefined) bd._textRotateOnLine = !!s._textRotateOnLine;
  if (s.gapSiblings !== undefined) bd.gapSiblings = s.gapSiblings;
  if (s.gapLevels !== undefined) bd.gapLevels = s.gapLevels;
  if (s.autoAlign !== undefined) bd.autoAlign = !!s.autoAlign;
  if (s._bgColor !== undefined) {
    bd._bgColor = s._bgColor || '';
  }
  // 後方互換: 旧スナップショットの _fileTheme も読み取る
  if (s._fileStyle !== undefined) bd._fileStyle = s._fileStyle || null;
  else if (s._fileTheme !== undefined) bd._fileStyle = s._fileTheme || null;
  if (typeof bdLoadBoardBackgroundFromStyle === 'function') bdLoadBoardBackgroundFromStyle();
  const canvasEl = document.getElementById('bd-canvas');
  if (typeof bdApplyBoardFileStyleAndTheme === 'function') {
    bdApplyBoardFileStyleAndTheme(canvasEl, document.getElementById('bd-world'));
  } else if (canvasEl) {
    if (typeof bdApplyCanvasBackground === 'function') bdApplyCanvasBackground(canvasEl);
    else canvasEl.style.background = bd._bgColor || '';
  }
  bd.selected = new Set(); bd.editing = null; bdClearConnectionSelection();
  bdEnsureConnectionRuntime(bd.connections);
}
function bdUndo() {
  if (_bdHasCommonHistory()) { historyUndo(_bdHistoryScope()); return; }
  if (!_bdUndoStack.length) return;
  _bdRedoStack.push(_bdSnapshot());
  _bdApplySnapshot(JSON.parse(_bdUndoStack.pop()));
  bdRender(); bdDirty();
  showStatus('\u5143\u306b\u623b\u3057\u307e\u3057\u305f');
  if (typeof updateUndoRedoButtonStates === 'function') updateUndoRedoButtonStates();
}
function bdRedo() {
  if (_bdHasCommonHistory()) { historyRedo(_bdHistoryScope()); return; }
  if (!_bdRedoStack.length) return;
  _bdUndoStack.push(_bdSnapshot());
  _bdApplySnapshot(JSON.parse(_bdRedoStack.pop()));
  bdRender(); bdDirty();
  showStatus('\u3084\u308a\u76f4\u3057\u307e\u3057\u305f');
  if (typeof updateUndoRedoButtonStates === 'function') updateUndoRedoButtonStates();
}

function bdIsCurrentBoardOpenRequest(path) {
  if (typeof state === 'undefined') return true;
  if (state.view && state.view !== 'board') return false;
  const currentPath = typeof _bdNormalizePathForGuard === 'function'
    ? _bdNormalizePathForGuard(state.currentBoardPath || '')
    : String(state.currentBoardPath || '').replace(/\\/g, '/');
  const requestedPath = typeof _bdNormalizePathForGuard === 'function'
    ? _bdNormalizePathForGuard(path || '')
    : String(path || '').replace(/\\/g, '/');
  return !currentPath || !requestedPath || currentPath === requestedPath;
}

const BD_BOARD_OPEN_IO_TIMEOUT_MS = 30000;
let _bdPendingOpenRollback = null;

function _bdTimeoutError(label, timeoutMs) {
  const seconds = Math.max(1, Math.round(timeoutMs / 1000));
  return new Error(label + 'がタイムアウトしました（' + seconds + '秒）');
}

function _bdAwaitWithTimeout(promise, timeoutMs, label) {
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(_bdTimeoutError(label, timeoutMs)), timeoutMs);
  });
  return Promise.race([Promise.resolve(promise), timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

// --- ボード開閉 ---
async function bdOpenBoard(label, path, opts) {
  const openOpts = opts || {};
  const titleEl = document.getElementById('bd-title');
  const prevTitle = titleEl ? titleEl.textContent : '';
  const nextPath = path || '';
  const openSeq = (bd._openSeq || 0) + 1;
  bd._openSeq = openSeq;
  const isCurrentOpenRequest = () => bd._openSeq === openSeq && bdIsCurrentBoardOpenRequest(nextPath);
  clearTimeout(window._bdTimer);
  if (bd.dirty && bd.path && !openOpts.skipDirtySave) {
    let saved = false;
    try {
      saved = await _bdAwaitWithTimeout(bdSave(), BD_BOARD_OPEN_IO_TIMEOUT_MS, '切替前のボード保存');
    } catch (err) {
      if (!isCurrentOpenRequest()) return false;
      if (titleEl) titleEl.textContent = prevTitle;
      showStatus('ボード切替前の保存に失敗しました: ' + (err.message || err), true);
      return false;
    }
    if (!saved) {
      if (!isCurrentOpenRequest()) return false;
      if (titleEl) titleEl.textContent = prevTitle;
      return false;
    }
  }
  if (!isCurrentOpenRequest()) return false;
  const rollback = _bdPendingOpenRollback || {
    title: prevTitle,
    path: bd.path || '',
    loadedBoardPath: bd._loadedBoardPath || '',
    dump: typeof bdDumpState === 'function' ? bdDumpState() : null,
  };
  _bdPendingOpenRollback = rollback;
  if (titleEl) titleEl.textContent = label || '';
  const prevPath = rollback.path || '';
  const prevLoadedBoardPath = rollback.loadedBoardPath || '';
  const prevDump = rollback.dump || null;
  bdClearUndoStacks();
  bd.selected = new Set();
  if (typeof bdCancelLinkedSelectionPreview === 'function') bdCancelLinkedSelectionPreview();
  if (typeof bdCancelLinkedSelectionSync === 'function') bdCancelLinkedSelectionSync();
  bdClearConnectionSelection();
  bd.editing = null;
  bd.connecting = null;
  bd.tool = 'select';
  bd.displayFilters = {};
  bd._stylePresetSeedVersion = 0;
  bd.themeId = '';
  bd._showShadow = false;
  bd._textRotateOnLine = false;
  bd._numbering = false;
  bd.statuses = (typeof BD_DEFAULT_STATUSES !== 'undefined') ? [...BD_DEFAULT_STATUSES] : [];
  bd.statusFilter = '';
  bd.tagFilter = [];
  bd.zoom = 1;
  bd.panX = bd.panY = 0;
  bd.rotation = 0;
  // 前のボードの機能状態をリセット
  bd._bgColor = '';
  bd._bgImage = '';
  bd._bgImageFit = 'contain';
  bd._bgImageScale = 1;
  const _canvasEl = document.getElementById('bd-canvas');
  if (_canvasEl) {
    _canvasEl.style.background = '';
    _canvasEl.style.backgroundImage = '';
  }
  if (typeof _bdDrillRoot !== 'undefined') _bdDrillRoot = null;
  if (typeof _bdFocusSaved !== 'undefined') _bdFocusSaved = null;
  if (typeof MeldexThemeManager !== 'undefined' && typeof MeldexThemeManager.applyBoardThemeRuntime === 'function') {
    MeldexThemeManager.applyBoardThemeRuntime(bd);
  }
  if (typeof _bdSlideshow !== 'undefined' && _bdSlideshow) { clearTimeout(_bdSlideshow.timer); _bdSlideshow = null; }
  bdTransform();
  try {
    const data = await _bdAwaitWithTimeout(
      apiFetch('/file?path=' + encodeURIComponent(nextPath)),
      BD_BOARD_OPEN_IO_TIMEOUT_MS,
      'ボードファイル読み込み'
    );
    if (bd._openSeq !== openSeq || !bdIsCurrentBoardOpenRequest(nextPath)) return false;
    const raw = data.content || '';
    if (typeof showLoadingBeforeHeavyWork === 'function') {
      await showLoadingBeforeHeavyWork(raw, '大きいボードを描画中...');
      if (bd._openSeq !== openSeq || !bdIsCurrentBoardOpenRequest(nextPath)) return false;
    }
    if (typeof _bdIsBoardWritablePath === 'function' && !_bdIsBoardWritablePath(nextPath)) {
      throw new Error('ボードとして開けない拡張子です: ' + nextPath);
    }
    if (typeof _bdRawLooksLikeBoardFile === 'function' && !_bdRawLooksLikeBoardFile(raw)) {
      throw new Error('ボード形式ファイルではありません');
    }
    const parsed = bdParseMd(raw);
    bd.path = nextPath;
    bd._loadedBoardPath = nextPath;
    // フェーズ3-3: 読み込み直後のパスで取り消し履歴スコープを確定させる
    // （読み込み前に呼んだ bdClearUndoStacks() は「切替前のボード」のスコープを掃除するだけ
    //  なので、ここで新パスのスコープも明示的に掃除し、履歴パネルのアクティブスコープを合わせる）。
    if (typeof bdClearUndoStacks === 'function') bdClearUndoStacks(nextPath);
    if (typeof historySetScope === 'function') {
      historySetScope(typeof _bdHistoryScope === 'function' ? _bdHistoryScope(nextPath) : ('board:' + String(nextPath || '').replace(/\\/g, '/')));
    }
    bd._preservedFrontmatter = parsed.preservedFrontmatter || '';
    window.MeldexFileLockBadge?.apply?.(titleEl, nextPath);
    bd.nodes = parsed.nodes || [];
    if (typeof bdNormalizeParentGraph === 'function') bdNormalizeParentGraph(bd.nodes);
    // 新規作成ボードの初期ルートカードには階層別スタイル (_autoStyle) とロジック図を既定で有効化する。
    // 「新規作成直後 = ノード 1 枚 / 親子関係・構造・コネクション・グループ無し / 追加メタ無し」
    // の形状にマッチする場合のみ true を立てる。親子・構造・スタイル等の付加情報が
    // すでに保存されているものには適用しない。
    if (
      bd.nodes.length === 1
      && (parsed.connections?.length || 0) === 0
      && (parsed.groups?.length || 0) === 0
    ) {
      const only = bd.nodes[0];
      const hasExplicitSize = (Number.isFinite(+only.w) && +only.w !== 160)
        || (Number.isFinite(+only.h) && +only.h !== 0);
      const hasBodyText = String(only.text || '').includes('\n');
      const hasAnyMeta = only.parent || only.structure || only.status || only.bgColor
        || only.container || only.contained || only.balloon || only.link || only.linkType || only.img
        || only.cardStyle || only.shape || only.note || only.progress || only.markers
        || only.fontSize || only.fontBold || only.fontItalic || only.textColor
        || only.textStrokeColor || only.borderColor || only.borderWidth || only.borderRadius
        || only.collapsed || only.minimized || only.flipH || only.flipV
        || only.rotate || only.opacity || only.locked
        || only._autoStyle || only._followChildren || hasExplicitSize || hasBodyText;
      if (!hasAnyMeta) {
        only._autoStyle = true;
        only.structure = 'logic';
      }
    }
    bd._lastSavedNodeIds = new Set(bd.nodes.map(n => n.id));
    bd.connections = parsed.connections || [];
    bd.llmSemantics = parsed.llmSemantics || (typeof bdDefaultLlmSemantics === 'function' ? bdDefaultLlmSemantics() : null);
    bdEnsureConnectionRuntime(bd.connections);
    bd.groups = parsed.groups || [];
    bd.statuses = parsed.statusDefs || ((typeof BD_DEFAULT_STATUSES !== 'undefined') ? [...BD_DEFAULT_STATUSES] : []);
    bd.cardStyles = parsed.cardStyles || [];
    bd.lineStyles = parsed.lineStyles || [];
    bd.depthStyles = parsed.depthStyles || [];
    // 新しいボードを開くたびにグローバルデフォルト適用フラグをリセット
    bd._globalStyleDefaultsApplied = false;
    bd._globalDepthStylesApplied = false;
    bd.activeCardStyle = parsed.boardUi?.activeCardStyle || '';
    bd.activeLineStyle = parsed.boardUi?.activeLineStyle || '';
    bd._stylePresetSeedVersion = parsed.boardUi?.stylePresetSeedVersion || 0;
    bd.themeId = parsed.boardUi?.themeId || '';
    bd.displayFilters = parsed.boardUi?.displayFilters || {};
    bd.tagFilter = Array.isArray(parsed.boardUi?.tagFilter) ? parsed.boardUi.tagFilter : [];
    bd._showShadow = !!parsed.boardUi?.showShadow;
    bd._textRotateOnLine = !!parsed.boardUi?.textRotateOnLine;
    if (typeof MeldexThemeMigration !== 'undefined' && typeof MeldexThemeMigration.migrateBoardState === 'function') {
      MeldexThemeMigration.migrateBoardState(bd, parsed.boardUi || {});
    }
    if (typeof bdEnsureBoardUiState === 'function') bdEnsureBoardUiState();
    // テーマ適用: クリア → ファイルテーマ
    bd._fileStyle = parsed.fileTheme || null;
    if (typeof clearFileStyleForPanel === 'function') clearFileStyleForPanel('bd-canvas');
    else if (typeof clearFileStyle === 'function') clearFileStyle();
    if (parsed.fileTheme && typeof applyFileStyleToPanel === 'function') applyFileStyleToPanel(parsed.fileTheme, 'bd-canvas');
    if (typeof bdLoadBoardBackgroundFromStyle === 'function') bdLoadBoardBackgroundFromStyle();
    // スタイルタブ由来の --bd-shadow (新仕様) があれば bd._showShadow と同期。
    // ファイル側が未設定ならテーマ :root の値をフォールバック参照。
    if (bd._fileStyle && bd._fileStyle['--bd-shadow'] !== undefined) {
      const v = bd._fileStyle['--bd-shadow'];
      bd._showShadow = v !== '' && v !== '0';
    } else if (typeof getCssVar === 'function') {
      const t = (getCssVar('--bd-shadow') || '').trim();
      if (t !== '') bd._showShadow = t !== '0';
    }
    // 2026-04-18: レイアウト隙間 / 自動整列 設定の復元。未設定は null (= デフォルト)。
    // bd.gapSiblings/gapLevels が null のとき bdLayoutGaps() がテーマ値をフォールバック参照する。
    bd.gapSiblings = null; bd.gapLevels = null; bd.autoAlign = true;
    if (bd._fileStyle) {
      const gs = parseFloat(bd._fileStyle['--bd-gap-siblings']);
      if (Number.isFinite(gs) && gs >= 0) bd.gapSiblings = gs;
      const gl = parseFloat(bd._fileStyle['--bd-gap-levels']);
      if (Number.isFinite(gl) && gl >= 0) bd.gapLevels = gl;
      if (bd._fileStyle['--bd-auto-align'] !== undefined) {
        bd.autoAlign = bd._fileStyle['--bd-auto-align'] !== '0';
      } else if (typeof getCssVar === 'function') {
        const t = (getCssVar('--bd-auto-align') || '').trim();
        if (t !== '') bd.autoAlign = t !== '0';
      }
    } else if (typeof getCssVar === 'function') {
      const t = (getCssVar('--bd-auto-align') || '').trim();
      if (t !== '') bd.autoAlign = t !== '0';
    }
    bd._id = Math.max(0, ...bd.nodes.map(n => parseInt(n.id?.replace(/\D/g, '')) || 0));
    bd.dirty = false;
    if (typeof bdApplyBoardFileStyleAndTheme === 'function') {
      bdApplyBoardFileStyleAndTheme();
    } else if (typeof bdApplyCanvasBackground === 'function') {
      bdApplyCanvasBackground();
    } else if (bd._bgColor) {
      const canvasEl = document.getElementById('bd-canvas');
      if (canvasEl) canvasEl.style.background = bd._bgColor;
    }
    // _autoStyle が有効なルートカードには、レンダリング前に階層別スタイルを適用しておく。
    // (これをしないと、ボード読込直後は _autoStyle = true だがスタイルが未反映で、
    //  一度チェックを外して再度 ON にするまで反映されない)
    if (typeof bdApplyAutoStyle === 'function') {
      bd.nodes.forEach(n => { if (n._autoStyle) bdApplyAutoStyle(n.id); });
    }
    bdRender();
    bdDrawConns();
    bdDrawFrames();
    if (typeof bdSyncBoardUi === 'function') bdSyncBoardUi(true);
    // ノードが多い場合のみフィット（少ない場合はズーム100%で表示）
    if (bd.nodes.length > 5) bdFitAll();
    else bdTransform();
    showStatus('\u30ad\u30e3\u30f3\u30d0\u30b9: ' + label);
    _bdPendingOpenRollback = null;
    return true;
  } catch (err) {
    if (bd._openSeq !== openSeq || !bdIsCurrentBoardOpenRequest(nextPath)) return false;
    bd.path = prevPath;
    bd._loadedBoardPath = prevLoadedBoardPath;
    if (titleEl) titleEl.textContent = rollback.title || '';
    window.MeldexFileLockBadge?.apply?.(titleEl, prevPath);
    if (prevDump && typeof bdLoadState === 'function') {
      bdLoadState(prevDump);
      if (typeof bdRender === 'function') bdRender();
      if (typeof bdDrawConns === 'function') bdDrawConns();
      if (typeof bdDrawFrames === 'function') bdDrawFrames();
      if (typeof bdSyncBoardUi === 'function') bdSyncBoardUi(true);
    } else {
      const nodesEl = document.getElementById('bd-nodes');
      if (nodesEl) {
        nodesEl.replaceChildren();
        const msg = document.createElement('div');
        msg.style.cssText = 'padding:20px;color:var(--fg2);';
        msg.textContent = '読み込めませんでした: ' + (err.message || err);
        nodesEl.appendChild(msg);
      }
    }
    showStatus('ボード読み込みエラー: ' + (err.message || err), true);
    _bdPendingOpenRollback = null;
    return false;
  }
}

async function bdCloseBoard() {
  // 未保存があれば保存
  if (bd.dirty && bd.path) {
    await bdSave();
  }
}

// --- 複数ボードタブ対応: bd 全体の dump / restore ---
// 複数 CanvasComponent (multi:true) が1個のグローバル bd を共有しているため、
// タブ切替時にアクティブな state をコンポーネント側に dump / restore して独立性を保つ。
function bdDumpState() {
  const keys = Object.keys(bd);
  const snap = {};
  for (const k of keys) {
    const v = bd[k];
    if (v instanceof Set) snap[k] = [...v];
    else snap[k] = v;
  }
  // フェーズ3-3: 共通履歴が有効な環境（本体アプリ）では取り消し履歴は 'board:<パス>' スコープの
  // 共通履歴（グローバルな _historyStacks）に保持され、タブごとにダンプ/復元する必要がない
  // （スコープ文字列がボードごとに独立しているため、タブ切替時も自然に分離される）。
  // 単独起動アプリ（共通履歴なし）のみ、従来どおり自己完結スタックをダンプする。
  const hasCommonHistory = typeof historyPush === 'function' && typeof historyUndo === 'function' && typeof historyRedo === 'function';
  return {
    bd: snap,
    undoStack: hasCommonHistory ? [] : _bdUndoStack.slice(),
    redoStack: hasCommonHistory ? [] : _bdRedoStack.slice(),
    // gb-canvas-features.js のモジュールローカル state も dump
    drillRoot: (typeof _bdDrillRoot !== 'undefined') ? _bdDrillRoot : null,
    // v0.5.285: フォーカスモード廃止につき focusMode は捨てる。focusSaved はセッション内の復元用に残す。
    focusSaved: (typeof _bdFocusSaved !== 'undefined') ? _bdFocusSaved : null,
  };
}

function bdLoadState(dump) {
  if (!dump || !dump.bd) return;
  // 既存プロパティを落とし、dump で作られた set のみにする
  for (const k of Object.keys(bd)) delete bd[k];
  for (const [k, v] of Object.entries(dump.bd)) {
    if (k === 'selected' || k === 'selectedConnIds') {
      bd[k] = new Set(Array.isArray(v) ? v : []);
    } else {
      bd[k] = v;
    }
  }
  // bd の Set プロパティが dump 時に欠けていた場合のフォールバック
  if (!(bd.selected instanceof Set)) bd.selected = new Set();
  if (!(bd.selectedConnIds instanceof Set)) bd.selectedConnIds = new Set();
  if (typeof bdNormalizeParentGraph === 'function') bdNormalizeParentGraph(bd.nodes || []);
  bdEnsureConnectionRuntime(bd.connections || []);
  // undo/redo スタックを復元（共通履歴が有効な環境ではスコープ別に独立して保持されるため、
  // ここでは単独起動アプリ向けの自己完結スタックのみ復元する。dump.undoStack/redoStack は
  // 共通履歴が有効な環境では常に空配列なので forEach は何もしない）。
  _bdUndoStack.length = 0;
  (dump.undoStack || []).forEach(s => _bdUndoStack.push(s));
  _bdRedoStack.length = 0;
  (dump.redoStack || []).forEach(s => _bdRedoStack.push(s));
  // 共通履歴が有効な環境では、復元したボードのパスに合わせてアクティブスコープも切り替える
  // （タブ切替時に historySetScope が呼ばれず履歴パネルが直前のタブのスコープのままになるのを防ぐ）。
  if (typeof historySetScope === 'function' && bd.path) {
    historySetScope(typeof _bdHistoryScope === 'function' ? _bdHistoryScope(bd.path) : ('board:' + String(bd.path).replace(/\\/g, '/')));
  }
  // features.js 側の変数を復元
  if (typeof _bdDrillRoot !== 'undefined') _bdDrillRoot = dump.drillRoot || null;
  if (typeof _bdFocusSaved !== 'undefined') _bdFocusSaved = dump.focusSaved || null;
  if (!bd.themeId && dump.grayscale) bd.themeId = 'builtin-dark';
  if (typeof MeldexThemeMigration !== 'undefined' && typeof MeldexThemeMigration.migrateBoardState === 'function') {
    MeldexThemeMigration.migrateBoardState(bd, dump.bd?.boardUi || {});
  }
  // slideshow は復元しない（タイマー実体の管理が複雑なため、タブ切替で必ず停止する）
  if (typeof _bdSlideshow !== 'undefined' && _bdSlideshow) { clearTimeout(_bdSlideshow.timer); _bdSlideshow = null; }
  // DOM 反映
  const canvasEl = document.getElementById('bd-canvas');
  if (typeof bdLoadBoardBackgroundFromStyle === 'function') bdLoadBoardBackgroundFromStyle();
  if (typeof bdApplyBoardFileStyleAndTheme === 'function') {
    bdApplyBoardFileStyleAndTheme(canvasEl, document.getElementById('bd-world'));
  } else if (canvasEl) {
    if (typeof bdApplyCanvasBackground === 'function') bdApplyCanvasBackground(canvasEl);
    else canvasEl.style.background = bd._bgColor || '';
  }
  const titleEl = document.getElementById('bd-title');
  if (titleEl && bd.path) titleEl.textContent = bd.path.split('/').pop() || '';
  bdTransform();
  bdRender();
  bdDrawConns();
  if (typeof bdDrawFrames === 'function') bdDrawFrames();
  if (typeof bdSyncBoardUi === 'function') bdSyncBoardUi(true);
}

// ==============================
// ミニマップ（ビューワーペイン連携）
// ==============================
/* ミニマップ描画は gb-canvas-minimap.js に分離 */
