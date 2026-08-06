/* viewer-annotations.js — Meldexビューワー: 注釈（メモ描画）コントローラー（統合層）。
   計画書: app/docs/viewer-stability-common-ui-plan-2026-07-31.md「実装変更 > 3. 注釈の画像追従」
   実体（画像固有ピクセル座標のシーン管理・描画・付箋・旧座標互換）は以下へ分割済み:
     - viewer-annotation-scene.js  … シーン構築・座標変換・ストローク描画/消しゴム
     - viewer-annotation-notes.js  … 新座標系(media-pixel-v1)の付箋＋しっぽ
     - viewer-annotation-legacy.js … coordinateSpaceを持たない旧注釈の後方互換表示
   本ファイルの役割:
     - ツールバー（既存の createMarkupToolbar、meldex-core.js／事前ビルド済みバンドル経由）と
       上記シーンエンジンを繋ぐ薄い統合層。
     - 単一の公開注釈コントローラー window.MeldexViewerAnnotations を提供する
       （toggle/setState/load/getSceneState。親画面・単独版・右クリックメニュー・Aキー・
       右サイドバーから共通利用）。
     - Meldex本体の右下フロートボタン（親画面）から、現在表示中のビューワーiframeへ
       注釈状態を配送するpostMessage経路（新設: viewer-ann-set-state）を受信する。
       送信元は event.source === window.parent と同一オリジンを検証してから適用する。
       逆方向（iframe→親）には viewer-ann-state-changed / viewer-ann-save-result を送る
       （親側の対応する受信処理は gb-annotations.part01.part01.js 側で追加、報告参照）。
   注意: 既存注釈（coordinateSpaceを持たない旧座標）は破壊的変換をしない
   （viewer-annotation-legacy.js が担当。新規描画・保存時のみ media-pixel-v1 を付与する）。 */
(function () {
  'use strict';

  let _toolbar = null;
  // 親から最後に受け取った viewer-ann-set-state の完全スナップショット。シーン再構築のたびに
  // 再適用する（ビューワー残課題修正計画 2026-08-04「3. 注釈座標と親画面連携」）。
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
    return scene.isPdf() ? (scene.getPdfPath() || '') : (scene.getSingleFile() || scene.getItems()?.[scene.getIndex()]?.path || '');
  }
  function _currentPageIndex() {
    const scene = Scene();
    return scene && scene.isPdf() ? scene.getIndex() : null;
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
  // 「今開いている画像の注釈を読み込み終えた」タイミングを間接的に把握できる）。
  window.__viewerAnnotationReportSave = function reportSaveResult(ok, action, error) {
    _postToParent({
      type: 'viewer-ann-save-result',
      ok: !!ok,
      action: action || '',
      targetPath: _currentTargetPath(),
      pageIndex: _currentPageIndex(),
      error: error ? String(error?.message || error) : '',
      errorCode: ok ? '' : _classifyErrorCode(error),
    });
  };

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

  // createMarkupToolbar（meldex-core.part03.js、共通・編集不可）は内部に固定色ミニパレット
  // （sa-markup-palette、PALETTE_COLORSのみ・カスタムカラー非対応）を持つ。ビューワー残課題修正
  // 計画 2026-08-04「4. 共通カラーパレット」に合わせ、生成後に色ボタンのクリックハンドラだけを
  // 共通 openColorPalette（gb-color-palette.js）へ外部から差し替える（.onclickの単純上書きのため
  // 元ハンドラの副作用は残らない）。
  function _wireCommonColorPalette(toolbarEl, bridge) {
    if (typeof openColorPalette !== 'function') return;
    const colorBtn = toolbarEl.querySelector('.sa-markup-color-btn');
    const swatch = toolbarEl.querySelector('.sa-markup-color-swatch');
    if (!colorBtn) return;
    colorBtn.onclick = () => {
      openColorPalette(colorBtn, bridge.ann.color, (color) => {
        bridge.setColor(color);
        if (swatch) swatch.style.background = color;
      });
    };
  }

  function ensureToolbar() {
    if (_toolbar) return;
    const bridge = {
      get ann() { return SceneEngine().ann(); },
      toggle(active) { setState(active === undefined ? !SceneEngine().ann().active : !!active); },
      setTool(tool) { SceneEngine().setTool(tool); },
      setColor(color) { SceneEngine().setColor(color); },
      setOpacity(opacity) { SceneEngine().setOpacity(opacity); },
    };
    _toolbar = createMarkupToolbar(bridge, document.body);
    _wireCommonColorPalette(_toolbar, bridge);
  }

  function setState(active) {
    ensureToolbar();
    const willActivate = !!active;
    if (willActivate === !!SceneEngine().ann().active) return willActivate;
    SceneEngine().setState(willActivate);
    if (_toolbar) _toolbar.style.display = willActivate ? 'flex' : 'none';
    if (willActivate) SceneEngine().rebuild();
    _notifyParentStateChanged();
    return willActivate;
  }

  function toggle(force) {
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

  // 明示的な再読み込み要求。path は現在のシーン群のいずれかに一致する場合のみ意味を持つ
  // （新設計ではシーンは「今表示中の画像/ページ」に紐づくため、任意パスの単独読み込みは扱わない）。
  function load(path) {
    ensureToolbar();
    if (path) {
      const found = SceneEngine().findSceneByPath(path);
      if (!found) return;
    }
    SceneEngine().rebuild();
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
    SceneEngine()?.rebuild?.().then(() => {
      // シーン再構築後（対象パス/ページが変わった可能性がある）、保持している最新スナップショットを
      // 現在の対象と照合し、一致する場合だけ再適用する（不一致データを別ファイルへ適用しない）。
      if (_lastSnapshot && _snapshotMatchesCurrentTarget(_lastSnapshot)) _applySnapshot(_lastSnapshot);
      _notifyParentStateChanged();
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
    if (!currentPath || msg.targetPath !== currentPath) return false;
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
  }

  window.addEventListener('message', (ev) => {
    if (!_isTrustedParentMessage(ev)) return;
    const msg = ev.data;
    if (!msg || msg.type !== 'viewer-ann-set-state') return;
    _lastSnapshot = msg;
    if (!_snapshotMatchesCurrentTarget(msg)) return;
    _applySnapshot(msg);
  });

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
        message: drawing ? '描画中の注釈を確定しています' : '',
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
  });

  window.MeldexViewerAnnotations = {
    toggle, setState, load, getSceneState,
    toggleFromShortcut, isActive, isDrawing,
    resetPointerPath, onSceneChanged,
  };
})();
