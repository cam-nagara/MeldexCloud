/* ==============================
   gb-tool-canvas.js: CanvasComponent (v5.0 Phase C)
   canvas.html → JSモジュール変換
   依存: gb-canvas-engine.js, gb-canvas-features.js, gb-canvas-interact.js
   ============================== */

class CanvasComponent extends ToolComponent {
  constructor(paneId, tabId) {
    super(paneId, tabId);
    this._interactionCleanup = null;
    this._keyboardCleanup = null;
    this.idSuffix = _bdComponentIdSuffix(tabId || paneId);
    // multi:true の複数キャンバスタブでグローバル bd を共有しないための dump slot
    this._bdDump = null;
  }

  create() {
    this.el = document.createElement('div');
    this.el.className = 'gb-canvas-root';
    this.el.dataset.bdIdSuffix = this.idSuffix;
    this.el.innerHTML = typeof bdBuildBoardShellMarkup === 'function' ? bdBuildBoardShellMarkup(this.idSuffix) : '';
    if (typeof bdInitBoardShell === 'function') bdInitBoardShell(this.el);
    // 右クリック無効化
    this.el.querySelector('[data-bd-role="canvas"]')?.addEventListener('contextmenu', (e) => e.preventDefault());
    return this.el;
  }

  _ownTab() {
    const paneInfo = (typeof GBLayout !== 'undefined')
      ? GBLayout.findNode?.(GBLayout.root, this.paneId)
      : null;
    return paneInfo?.node?.tabs?.find?.(tab => tab.id === this.tabId)
      || paneInfo?.node?.tabs?.[paneInfo?.node?.activeTabIndex]
      || null;
  }

  _isOwnPaneActive() {
    return this.paneId === (typeof GBLayout !== 'undefined' ? GBLayout.activePane : this.paneId);
  }

  activate() {
    super.activate();
    const isPaneActive = this._isOwnPaneActive();
    if (isPaneActive) _bdSetActiveBoardRootIds(this.el, this.idSuffix);
    // 保存された背景色を復元
    const ownTab = this._ownTab();
    if (ownTab?.type === 'board') {
      this.state.boardPath = ownTab.state?.boardPath || ownTab.path || this.state.boardPath || '';
      this.state.label = ownTab.state?.label || ownTab.label || this.state.label || '';
    }
    if (typeof state !== 'undefined' && isPaneActive) {
      state.view = 'board';
      const activePath = this.state.boardPath || this._bdDump?.bd?.path || ((typeof bd !== 'undefined' && bd.path) ? bd.path : '');
      if (activePath) state.currentBoardPath = activePath;
      if (activePath && typeof startAutoVersion === 'function') startAutoVersion(activePath, 'file');
    }
    const canvas = this.el.querySelector('[data-bd-role="canvas"]');
    const world = this.el.querySelector('[data-bd-role="world"]') || document.getElementById('bd-world');
    if (typeof bdApplyBoardFileStyleAndTheme === 'function') {
      bdApplyBoardFileStyleAndTheme(canvas, world);
    } else if (typeof bdApplyCanvasBackground === 'function') {
      bdApplyCanvasBackground(canvas);
    }
    if (!isPaneActive) {
      // v0.5.338: ここで cleanup すると、pane-bridge の _mountAllPanes 経由で
      // activate() が呼ばれたタイミングで GBLayout.activePane がまだ更新前の場合
      // (= 本来アクティブなペインのはずが isPaneActive:false と判定される) に、
      // 正当な listener (特に dragover/drop) を剥がしてしまう不具合があった。
      // cleanup は必ず deactivate() / destroy() 側で実行されるため、ここでは何もしない。
      return;
    }
    // インタラクション初期化（マウス/キーボードハンドラ）
    if (typeof bdInitInteraction === 'function' && !this._interactionCleanup) {
      this._interactionCleanup = bdInitInteraction(this.el);
    }
    if (typeof bdInitKeyboard === 'function' && !this._keyboardCleanup) {
      this._keyboardCleanup = bdInitKeyboard(this.el);
    }
    // メモオーバーレイ初期化
    if (typeof initIframeMarkup === 'function') {
      const canvas = this.el.querySelector('[data-bd-role="canvas"]');
      if (canvas) initIframeMarkup(canvas);
    }
    // ボードを開く:
    //  - dump があれば restore（複数キャンバスタブ間の state 分離）
    //  - なければ通常の bdOpenBoard で読み込み
    if (this._bdDump) {
      if (typeof bdLoadState === 'function') bdLoadState(this._bdDump);
      this._bdDump = null;
    } else if (this.state.boardPath && bd.path !== this.state.boardPath) {
      bdOpenBoard(this.state.label || '', this.state.boardPath);
    }
  }

  _syncDetailPanel() {
    // pane-bridge の _syncDetailForActivePane から呼ばれる。
    // これを実装しておくことで _clearDetailPaneShell() → switchDetailTab(null)
    // の強制タブリセットを回避し、ボードアクティブ時にユーザーが選んでいた
    // オプションタブ (file-style / board-card / board-line 等) を保持する。
    // 他ツールのタブを非表示にする（board以外のタブを隠す）
    if (typeof showNoteTabs === 'function') showNoteTabs(false);
    if (typeof showDbTabs === 'function') showDbTabs(false);
    if (typeof showCalendarDetailTabs === 'function') showCalendarDetailTabs(false);
    if (typeof showPublishDetailTab === 'function') showPublishDetailTab(false);
    if (typeof hideScriptnoteDetailTabs === 'function') hideScriptnoteDetailTabs();
    if (typeof bdRefreshSelectionDetails === 'function') bdRefreshSelectionDetails(true);
  }

  deactivate() {
    super.deactivate();
    // 未保存があれば保存
    if (bd.dirty && bd.path) {
      bdSave();
    }
    // bd の state を自分のインスタンスに dump（次 activate 時に restore する）
    if (typeof bdDumpState === 'function' && bd.path === (this.state.boardPath || bd.path)) {
      this._bdDump = bdDumpState();
    }
    // インタラクション/キーボードハンドラをクリーンアップ（documentレベルのリスナー除去）
    if (this._interactionCleanup) { this._interactionCleanup(); this._interactionCleanup = null; }
    if (this._keyboardCleanup) { this._keyboardCleanup(); this._keyboardCleanup = null; }
    _bdRestoreBoardRootIds(this.el, this.idSuffix);
  }

  destroy() {
    // イベントリスナーのクリーンアップ
    if (this._interactionCleanup) { this._interactionCleanup(); this._interactionCleanup = null; }
    if (this._keyboardCleanup) { this._keyboardCleanup(); this._keyboardCleanup = null; }
    // 未保存があれば保存
    if (bd.dirty && bd.path) {
      bdSave();
    }
    _bdRestoreBoardRootIds(this.el, this.idSuffix);
    super.destroy();
  }

  handleKeyDown(e) {
    // キャンバスがフォーカスされていない場合でも、アクティブコンポーネントならキーを処理
    if (bd.editing) return false; // 編集中はグローバルに委譲しない
    // Ctrl+S: 保存
    if (e.ctrlKey && e.key === 's') { e.preventDefault(); bdSave(); return true; }
    // Ctrl+Z: Undo
    if (e.ctrlKey && e.key === 'z') { e.preventDefault(); bdUndo(); return true; }
    // Ctrl+Y: Redo
    if (e.ctrlKey && e.key === 'y') { e.preventDefault(); bdRedo(); return true; }
    return false;
  }

  restoreState(s) {
    super.restoreState(s);
    if (s) {
      this.state.boardPath = s.boardPath || '';
      this.state.label = s.label || '';
    }
  }

  getState() {
    return {
      boardPath: this.state.boardPath || this._bdDump?.bd?.path || (this._active ? bd.path : ''),
      label: this.state.label || this._bdDump?.bd?.label || '',
    };
  }

  async reload() {
    const path = this.state.boardPath || this._bdDump?.bd?.path || (this._active ? bd.path : '');
    if (!path || typeof bdOpenBoard !== 'function') return false;
    if (this._isOwnPaneActive()) _bdSetActiveBoardRootIds(this.el, this.idSuffix);
    await bdOpenBoard(this.state.label || this._bdDump?.bd?.label || '', path);
    this._bdDump = null;
    return true;
  }
}

const _BD_CANONICAL_IDS = {
  canvas: 'bd-canvas',
  world: 'bd-world',
  svg: 'bd-svg',
  nodes: 'bd-nodes',
  'resize-layer': 'bd-resize-layer',
};

function _bdComponentIdSuffix(value) {
  const raw = String(value || ('bd-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7)));
  return raw.replace(/[^A-Za-z0-9_-]/g, '_');
}

function _bdCanonicalScopedId(id, suffix) {
  const raw = String(id || '');
  const scopedSuffix = suffix ? '-' + suffix : '';
  if (scopedSuffix && raw.endsWith(scopedSuffix)) return raw.slice(0, -scopedSuffix.length);
  return raw;
}

function _bdSetScopedId(el, suffix, active) {
  if (!el || !el.id) return;
  const baseId = el.dataset.bdBaseId || _bdCanonicalScopedId(el.id, suffix);
  if (!baseId || (!baseId.startsWith('bd-') && !baseId.startsWith('bdn-'))) return;
  el.dataset.bdBaseId = baseId;
  el.id = active ? baseId : (suffix ? `${baseId}-${suffix}` : baseId);
}

function _bdSetBoardRootIds(root, suffix, active) {
  if (!root) return;
  root.querySelectorAll?.('[id]')?.forEach(el => _bdSetScopedId(el, suffix, active));
  Object.entries(_BD_CANONICAL_IDS).forEach(([role, baseId]) => {
    const el = root.querySelector?.(`[data-bd-role="${role}"]`);
    if (!el) return;
    el.id = active ? baseId : `${baseId}-${suffix}`;
    el.dataset.bdBaseId = baseId;
  });
}

function _bdRestoreBoardRootIds(root, suffix) {
  _bdSetBoardRootIds(root, suffix || root?.dataset?.bdIdSuffix || '', false);
}

function _bdSetActiveBoardRootIds(root, suffix) {
  document.querySelectorAll('.gb-canvas-root').forEach(otherRoot => {
    if (otherRoot === root) return;
    _bdRestoreBoardRootIds(otherRoot, otherRoot.dataset.bdIdSuffix || '');
  });
  _bdSetBoardRootIds(root, suffix || root?.dataset?.bdIdSuffix || '', true);
}

// コンポーネントレジストリ更新（gb-tool-components.jsの定義を上書き）
registerToolComponent('board', { cls: CanvasComponent, icon: 'presentation', label: 'ボード', multi: true, requiresViewLock: false });
