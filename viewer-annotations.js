/* viewer-annotations.js — Meldexビューワー: アノテート（メモ描画）コントローラー（統合層）。
   計画書: app/docs/viewer-stability-common-ui-plan-2026-07-31.md「実装変更 > 3. アノテートの画像追従」
   実体（画像固有ピクセル座標のシーン管理・描画・付箋・旧座標互換）は以下へ分割済み:
     - viewer-annotation-scene.js  … シーン構築・座標変換・ストローク描画/消しゴム
     - viewer-annotation-notes.js  … 新座標系(media-pixel-v1)の付箋＋しっぽ
     - viewer-annotation-legacy.js … coordinateSpaceを持たない旧アノテートの後方互換表示
   本ファイルの役割:
     - フロートパネル（viewer-annotation-toolbar.js。Meldex本体の #ann-toolbar と同じ部品構成）と
       上記シーンエンジンを繋ぐ薄い統合層。
     - 単一の公開アノテートコントローラー window.MeldexViewerAnnotations を提供する
       （toggle/setState/load/getSceneState。親画面・単独版・右クリックメニュー・Aキー・
       右サイドバーから共通利用）。
     - Meldex本体の右下フロートボタン（親画面）から、現在表示中のビューワーiframeへ
       アノテート状態を配送するpostMessage経路（新設: viewer-ann-set-state）を受信する。
       送信元は event.source === window.parent と同一オリジンを検証してから適用する。
       逆方向（iframe→親）には viewer-ann-state-changed / viewer-ann-save-result を送る
       （親側の対応する受信処理は gb-annotations.part01.part01.js 側で追加、報告参照）。
   注意: 既存アノテート（coordinateSpaceを持たない旧座標）は破壊的変換をしない
   （viewer-annotation-legacy.js が担当。新規描画・保存時のみ media-pixel-v1 を付与する）。 */
(function () {
  'use strict';

  let _toolbar = null;
  let _sharedToolbar = false;
  function _usesParentToolbar() {
    try { return window.parent !== window && !!window.parent.GBAnnotationSurfaces?.enabled(); } catch { return false; }
  }
  const _incidentKey = 'meldex:sheet-incidents';
  const _recentIncidents = new Map();
  function _recordSaveIncident(kind, method, startedAt, error) {
    // 本文・画像・パス・エラー文は記録しない。既存の自己記録と同じ安全な項目だけ。
    const op = 'viewer.annotations.' + method.toLowerCase();
    const fingerprint = kind + ':' + op;
    const now = Date.now();
    if (now - (_recentIncidents.get(fingerprint) || 0) < 10000) return;
    _recentIncidents.set(fingerprint, now);
    const cloud = !!window.MeldexRuntimeAdapter?.isBrowserDataMode?.();
    const surface = window.MeldexStandaloneNative ? 'standalone' : cloud ? (window.innerWidth <= 767 ? 'mobile' : 'cloud') : 'desktop';
    const entry = { kind, op, endpoint: '/annotations', method, ms: now - startedAt,
      status: Number(error?.status || error?.httpStatus) || 0, errorType: error ? 'Error' : 'stalled',
      surface, time: new Date().toISOString() };
    try {
      const old = JSON.parse(localStorage.getItem(_incidentKey) || '[]');
      localStorage.setItem(_incidentKey, JSON.stringify([...(Array.isArray(old) ? old : []), entry].slice(-200)));
    } catch {}
    try {
      if (window.parent !== window && window.parent.MeldexDiagnostics?.recordSheetIncident) {
        if (!window.parent.MeldexRuntimeAdapter?.isBrowserDataMode?.()) window.parent.MeldexDiagnostics.recordSheetIncident(kind, entry);
      } else if (!window.MeldexStandaloneNative && !window.MeldexRuntimeAdapter?.isBrowserDataMode?.()) {
        window.apiFetch('/diagnostics/sheet-incident', { method: 'POST', body: JSON.stringify(entry),
          headers: { 'Content-Type': 'application/json' }, silentError: true }).catch(() => {});
      }
    } catch {}
  }
  async function _watchAnnotationSave(method, run) {
    const startedAt = Date.now();
    const timer = setTimeout(() => {
      _recordSaveIncident('stalled', method, startedAt);
      window.MeldexViewerScene?.flashStatus?.('アノテートの保存が終わっていません', 10000);
      if (_usesParentToolbar()) window.parent.showStatus?.('アノテートの保存が終わっていません', true);
    }, 30000);
    try { return await run(); }
    catch (error) {
      if (error && typeof error === 'object') error.requireRemoteCommit = true;
      _recordSaveIncident('save-failed', method, startedAt, error);
      throw error;
    }
    finally { clearTimeout(timer); }
  }
  // Embedded annotations use the owning shell's API boundary, including its
  // active edit lock. Other viewer requests and standalone windows stay local.
  function _installSharedAnnotationApi() {
    for (const name of ['apiFetch', 'apiPost', 'apiPut', 'apiDelete']) {
      const original = window[name];
      if (typeof original !== 'function') continue;
      window[name] = function(path, ...args) {
        const annotation = /^\/(?:api\/)?annotations(?:[/?]|$)/.test(String(path || ''));
        // 注釈の履歴・描画には保存先が返す正式なidが必要。送信待ちを保存成功へ
        // 置き換えず、失敗を描画側へ返して選択・プレビューを再試行可能に保つ。
        if (annotation) {
          const optionsIndex = name === 'apiPost' || name === 'apiPut' ? 1 : 0;
          args[optionsIndex] = { ...(args[optionsIndex] || {}), requireRemoteCommit: true };
        }
        const run = () => {
          if (annotation && _usesParentToolbar() && typeof window.parent[name] === 'function') return window.parent[name](path, ...args);
          return original.call(this, path, ...args);
        };
        const method = { apiPost: 'POST', apiPut: 'PUT', apiDelete: 'DELETE' }[name];
        return annotation && method ? _watchAnnotationSave(method, run) : run();
      };
    }
  }
  _installSharedAnnotationApi();
  // Cloud Viewer classification is installed before this controller loads.
  // Seed the gate synchronously so ?markup=1 and parent messages cannot open the
  // toolbar during the short interval before DOMContentLoaded applies it again.
  const _startupAvailability = window.MeldexViewerCloudFileOpen?.annotationCapability?.();
  let _availability = _startupAvailability
    ? { available: !!_startupAvailability.available, reason: String(_startupAvailability.reason || '') }
    : { available: true, reason: '' };
  // 親から最後に受け取った viewer-ann-set-state の完全スナップショット。シーン再構築のたびに
  // 再適用する（ビューワー残課題修正計画 2026-08-04「3. アノテート座標と親画面連携」）。
  let _lastSnapshot = null;

  function SceneEngine() { return window.MeldexViewerAnnotationScene; }
  function Scene() { return window.MeldexViewerScene; }

  function _postToParent(msg) {
    if (window.parent === window) return;
    try {
      const utils = window.MeldexViewerSceneUtils;
      const origin = utils?.parentMessageTargetOrigin?.() || '*';
      window.parent.postMessage(msg, origin);
    } catch {}
  }

  // 現在表示中の対象パス（画像パスまたはPDFパス）。
  function _currentTargetPath() {
    const scene = Scene();
    if (!scene) return '';
    if (scene.isPdf()) {
      const index = Number(scene.getIndex()) || 0;
      return SceneEngine()?.getScenes?.().find(entry => entry.pageIndex === index)?.path
        || (scene.getPdfPath() ? scene.getPdfPath() + '#page=' + (index + 1) : '');
    }
    return SceneEngine()?.getScenes?.()[0]?.path || scene.getItems()?.[scene.getIndex()]?.path || scene.getSingleFile() || '';
  }
  function _currentPageIndex() {
    const scene = Scene();
    return scene && scene.isPdf() ? scene.getIndex() : null;
  }

  function _unavailableReason() {
    if (!_availability.available) return _availability.reason || 'このファイルではアノテートを保存できません';
    return /^blob:/i.test(_currentTargetPath())
      ? 'ブラウザーで直接開いたファイルのアノテートは保存できません。Cloud版本体で開いてください'
      : '';
  }

  // apiPost/apiPut/apiDelete が投げるエラーを機械可読なコードへ分類する（meldex-core.js の
  // apiFetch は HTTP エラーに error.status を付与する）。
  function _classifyErrorCode(error) {
    if (!error) return '';
    if (error.isTimeout || error.name === 'AbortError') return 'timeout';
    const status = Number(error.status);
    if (Number.isFinite(status) && status > 0) {
      if (status === 401 || status === 403) return 'forbidden';
      if (status === 404) return 'not_found';
      if (status === 409) return 'conflict';
      if (status >= 500) return 'server_error';
      return 'http_error';
    }
    if (error instanceof TypeError || /network|failed to fetch/i.test(String(error?.message || error))) return 'network_error';
    return 'unknown_error';
  }

  // scene/notes/legacy の各保存経路から呼ばれる共有フック（「読み込み結果、保存結果を配送する」の
  // 保存結果側。読み込み結果は setState(true)/onSceneChanged 完了時の viewer-ann-state-changed で
  // 代替する — シーン再構築のたびに現在の active/drawing 状態を親へ通知することで、親側は
  // 「今開いている画像のアノテートを読み込み終えた」タイミングを間接的に把握できる）。
  const localHistory = [], localRedo = [];
  let localHistoryBusy = false;
  async function replayLocalHistory(redo) {
    if (localHistoryBusy || window.parent !== window) return false;
    const from = redo ? localRedo : localHistory, to = redo ? localHistory : localRedo;
    const entry = from.at(-1);
    if (!entry) return false;
    const desired = redo ? entry.after : entry.before, previous = redo ? entry.before : entry.after;
    localHistoryBusy = true;
    try {
      if (desired) await window.apiPost('/annotations/restore', { ...desired,
        ...(previous ? { expected_modified: previous.modified || previous.created } : { expected_absent: true }) });
      else await window.apiDelete('/annotations/' + encodeURIComponent(previous.id)
        + '?expected_modified=' + encodeURIComponent(previous.modified || previous.created || ''));
      from.pop(); to.push(entry);
      await SceneEngine().rebuild();
      window.dispatchEvent(new CustomEvent('meldex-viewer-annotations-changed'));
      return true;
    } catch (error) { SceneEngine().viewerAnnotationSaveFailed(error, 'アノテートの履歴を適用できませんでした'); return false; }
    finally { localHistoryBusy = false; }
  }
  document.addEventListener('keydown', event => {
    if (window.parent !== window || !(event.ctrlKey || event.metaKey) || event.altKey
      || event.target.closest?.('input,textarea,[contenteditable=true]')) return;
    const key = event.key.toLowerCase();
    if (key !== 'z' && key !== 'y') return;
    event.preventDefault(); event.stopImmediatePropagation();
    void replayLocalHistory(key === 'y' || event.shiftKey);
  }, true);
  window.__viewerAnnotationReportSave = function reportSaveResult(ok, action, error, result, history) {
    if (ok && history && window.parent === window && !localHistoryBusy) {
      localHistory.push(structuredClone(history)); localRedo.length = 0;
    }
    if (ok) window.dispatchEvent(new CustomEvent('meldex-viewer-annotations-changed'));
    _postToParent({
      type: 'viewer-ann-save-result',
      ok: !!ok,
      action: action || '',
      highlightRequestId: result?.highlightRequestId || '',
      targetPath: history?.after?.target_path || history?.before?.target_path || _currentTargetPath(),
      pageIndex: _currentPageIndex(),
      annotationRevision: ok ? String(result?.annotationRevision || '') : '',
      invalidatedTargets: ok && Array.isArray(result?.invalidatedTargets) ? result.invalidatedTargets : [],
      history: ok && history && typeof history === 'object' ? history : null,
      error: error ? String(error?.message || error) : '',
      errorCode: ok ? '' : _classifyErrorCode(error),
    });
  };

  document.addEventListener('pointerdown', () => { if (_usesParentToolbar()) _postToParent({ type: 'viewer-ann-pointer-target', targetPath: _currentTargetPath() }); }, true);

  function _notifyParentStateChanged() {
    const a = SceneEngine()?.ann?.() || {};
    _postToParent({
      type: 'viewer-ann-state-changed',
      active: !!a.active,
      visible: a.visible !== false,
      drawing: !!a.drawing,
      targetPath: _currentTargetPath(),
      pageIndex: _currentPageIndex(),
    });
  }

  // フロートパネルは Meldex本体の #ann-toolbar と同じ部品構成で作る
  // （viewer-annotation-toolbar.js）。色は本体と同じ共通カラーパレット
  // （gb-color-palette.js の openColorPalette）を開く。以前は meldex-core.js の
  // createMarkupToolbar()（固定8色のミニパレット・太さ/不透明度なし）だったため本体と揃っていなかった。
  function _syncToolbar() {
    _toolbar?.syncFromState(SceneEngine().ann());
  }

  function ensureToolbar() {
    if (_toolbar) return;
    const controller = {
      setTool(tool) { SceneEngine().setTool(tool); _syncToolbar(); },
      setColor(color) { SceneEngine().setColor(color); _syncToolbar(); },
      setOpacity(opacity) { SceneEngine().setOpacity(opacity); },
      setWidth(tool, width) { SceneEngine().setWidth(tool, width); },
      toggleVisible() { SceneEngine().setVisible(SceneEngine().ann().visible === false); _syncToolbar(); },
      clearAll() { SceneEngine().clearAll(); },
      close() { setState(false); },
      openColorPicker(anchor) {
        const engine = SceneEngine();
        if (typeof openColorPalette !== 'function') return;
        openColorPalette(anchor, engine.ann().color, (color) => {
          engine.setColor(color);
          _syncToolbar();
        });
      },
    };
    _toolbar = window.MeldexViewerAnnotationToolbar.create(controller);
    _syncToolbar();
  }

  // 下端ツールバーのアノテートボタンの押下状態を合わせる。
  function _syncToolbarButton(active) {
    const button = document.getElementById('btn-annotation');
    if (!button) return;
    button.classList.toggle('active', !!active);
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
  }

  function setState(active) {
    ensureToolbar();
    const willActivate = !!active;
    const unavailable = willActivate ? _unavailableReason() : '';
    const anchor = document.getElementById('btn-annotation');
    if (unavailable) {
      SceneEngine().setState(false);
      _toolbar?.setVisible(false);
      _syncToolbarButton(false);
      if (typeof window.showStatus === 'function') window.showStatus(unavailable, true);
      _notifyParentStateChanged();
      return false;
    }
    if (willActivate === !!SceneEngine().ann().active) {
      _toolbar?.setVisible(willActivate && !_sharedToolbar, anchor);
      _syncToolbarButton(willActivate);
      return willActivate;
    }
    SceneEngine().setState(willActivate);
    _toolbar?.setVisible(willActivate && !_sharedToolbar, anchor);
    _syncToolbar();
    _syncToolbarButton(willActivate);
    if (willActivate) SceneEngine().rebuild();
    _notifyParentStateChanged();
    return willActivate;
  }

  function toggle(force) {
    if (_usesParentToolbar()) { _postToParent({ type: 'viewer-ann-open-menu', targetPath: _currentTargetPath() }); return true; }
    ensureToolbar();
    const next = typeof force === 'boolean' ? force : !SceneEngine().ann().active;
    return setState(next);
  }

  // 'A'キー用: 描画中（ドラッグでストローク作成中等）は誤爆させない。
  function toggleFromShortcut() {
    const a = SceneEngine()?.ann?.();
    if (!a?.active || !a?.drawing) toggle();
  }

  function isActive() { return !!SceneEngine()?.ann?.()?.active; }
  function isDrawing() { return !!SceneEngine()?.ann?.()?.drawing; }

  function setAvailability(available, reason) {
    _availability = { available: !!available, reason: String(reason || '') };
    const button = document.getElementById('btn-annotation');
    if (button) button.hidden = !_availability.available;
    if (!_availability.available && SceneEngine()?.ann?.()?.active) setState(false);
    return { ..._availability };
  }

  // 明示的な再読み込み要求。path は現在のシーン群のいずれかに一致する場合のみ意味を持つ
  // （新設計ではシーンは「今表示中の画像/ページ」に紐づくため、任意パスの単独読み込みは扱わない）。
  function load(path) {
    ensureToolbar();
    if (path) {
      const found = SceneEngine().findSceneByPath(path);
      if (!found) return Promise.resolve(false);
    }
    return SceneEngine().rebuild();
  }

  function getSceneState() {
    const scene = Scene();
    const engine = SceneEngine();
    const scenes = engine?.getScenes?.() || [];
    const a = engine?.ann?.() || {};
    return {
      active: isActive(),
      visible: a.visible !== false,
      drawing: isDrawing(),
      path: scenes[0]?.path || '',
      paths: scenes.map(s => s.path),
      targetPath: _currentTargetPath(),
      pageIndex: _currentPageIndex(),
      mode: scene.getMode(),
      index: scene.getIndex(),
      total: scene.getItems().length,
      tool: a.tool,
      color: a.color,
      opacity: a.opacity,
      widths: { ...(a.widths || {}) },
    };
  }

  // viewer-scene.js の showGroup() からのコールバック（画像ロード・レイヤー入替後）。
  function resetPointerPath() { /* 新設計ではシーン単位でイベントを受けるため不要（互換のため残置） */ }
  function onSceneChanged() {
    window.MeldexViewerScreenshotSource?.load?.();
    SceneEngine()?.rebuild?.().then(() => {
      // シーン再構築後（対象パス/ページが変わった可能性がある）、保持している最新スナップショットを
      // 現在の対象と照合し、一致する場合だけ再適用する（不一致データを別ファイルへ適用しない）。
      if (_lastSnapshot && _snapshotMatchesCurrentTarget(_lastSnapshot)) _applySnapshot(_lastSnapshot);
      _notifyParentStateChanged();
      window.dispatchEvent(new CustomEvent('meldex-viewer-annotations-changed'));
    });
  }

  // ============================================================
  // 親画面（Meldex本体）からのpostMessage受信
  // ============================================================
  function _isTrustedParentMessage(ev) {
    if (!ev) return false;
    if (window.parent === window || ev.source !== window.parent) return false;
    try {
      const origin = window.location?.origin || '';
      if (origin && origin !== 'null' && ev.origin !== origin) return false;
    } catch { return false; }
    return true;
  }

  // targetPath未指定の場合は「現在表示中の画像/PDFへ適用」という後方互換の挙動を維持する。
  // 指定されている場合は現在の対象パス（PDFはpageIndexも）と厳密一致した時だけ適用する。
  function _snapshotMatchesCurrentTarget(msg) {
    if (!msg || !msg.targetPath) return true;
    const currentPath = _currentTargetPath();
    if (!currentPath) return false;
    const legacyPdfFile = Scene()?.isPdf?.() && !/#page=\d+$/i.test(msg.targetPath)
      && currentPath.replace(/#page=\d+$/i, '') === msg.targetPath;
    if (msg.targetPath !== currentPath && !legacyPdfFile) return false;
    if (msg.pageIndex != null && Scene()?.isPdf?.()) {
      return Number(msg.pageIndex) === _currentPageIndex();
    }
    return true;
  }

  function _applySnapshot(msg) {
    ensureToolbar();
    const engine = SceneEngine();
    if (msg.tool) engine.setTool(msg.tool);
    if (msg.color) engine.setColor(msg.color);
    if (msg.opacity != null) engine.setOpacity(msg.opacity);
    if (msg.widths) Object.assign(engine.ann().widths, msg.widths);
    if (msg.visible !== undefined) engine.setVisible(msg.visible);
    setState(!!msg.active);
    _syncToolbar();
  }

  window.addEventListener('message', (ev) => {
    if (!_isTrustedParentMessage(ev)) return;
    const msg = ev.data;
    if (!msg || msg.type !== 'viewer-ann-set-state') return;
    _sharedToolbar = !!msg.sharedToolbar;
    _lastSnapshot = msg;
    if (!_snapshotMatchesCurrentTarget(msg)) return;
    _applySnapshot(msg);
  });

  // 常駐アプリの注釈パレットは、同じ撮影操作で開いたスクリーンショットだけを
  // 操作する。targetPath を照合した同一オリジン BroadcastChannel 以外は受けない。
  let _trayScreenshotAnnotationChannel = null;
  const viewerParams = new URLSearchParams(location.search);
  const trayScreenshotPath = viewerParams.get('tray_screenshot') === '1'
    ? String(viewerParams.get('file') || '').trim()
    : '';
  if (trayScreenshotPath && typeof BroadcastChannel === 'function') {
    _trayScreenshotAnnotationChannel = new BroadcastChannel('meldex-tray-screenshot-annotation');
    _trayScreenshotAnnotationChannel.addEventListener('message', event => {
      const msg = event?.data;
      if (!msg || msg.type !== 'tray-screenshot-annotation-state') return;
      if (String(msg.targetPath || '') !== trayScreenshotPath) return;
      _lastSnapshot = msg;
      Promise.resolve(Scene()?.ready).then(() => {
        if (_snapshotMatchesCurrentTarget(msg)) _applySnapshot(msg);
      });
    });
    window.addEventListener('pagehide', () => {
      try { _trayScreenshotAnnotationChannel?.close(); } catch {}
      _trayScreenshotAnnotationChannel = null;
    }, { once: true });
  }

  window.MeldexStandaloneCloseGuard?.register?.({
    appId: 'viewer-metadata',
    getCloseState() {
      const drawing = isDrawing();
      return {
        appId: 'viewer-metadata',
        state: drawing ? 'editing' : 'clean',
        pendingLocal: drawing,
        saving: drawing,
        failed: false,
        unnamed: false,
        hasSnapshot: !drawing,
        hasFinalDestination: true,
        shouldWarn: drawing,
        message: drawing ? '描画中のアノテートを確定しています' : '',
      };
    },
    async prepareClose() {
      const flushed = SceneEngine()?.flushDrawing?.();
      if (flushed) await new Promise(resolve => setTimeout(resolve, 0));
      return !isDrawing();
    },
    flushLocal() {
      return window.MeldexStandaloneOfflineOutbox?.readQueue?.().then(() => true, () => false) ?? true;
    },
    flushFinal() {
      return window.MeldexStandaloneSaveQueue?.flush?.() ?? true;
    },
  });

  // ?markup=1 での自動起動。シーンの初期読み込み完了を待ってから開く。
  const autoMarkup = new URLSearchParams(location.search).get('markup') === '1';
  (Scene()?.ready || Promise.resolve()).then(() => {
    if (autoMarkup) toggle(true);
    else if (!SceneEngine()?.getScenes?.().length) onSceneChanged();
  });

  window.MeldexViewerAnnotations = {
    toggle, setState, load, getSceneState,
    currentTargetPath: _currentTargetPath,
    setAvailability,
    toggleFromShortcut, isActive, isDrawing,
    resetPointerPath, onSceneChanged,
    canUndo: () => !localHistoryBusy && localHistory.length > 0,
    canRedo: () => !localHistoryBusy && localRedo.length > 0,
  };
})();
