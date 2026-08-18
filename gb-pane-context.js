/* ==============================
   PaneContext: ペインコンテキスト管理
   Phase 0 で定義のみ。Phase 2 でスプリットビュー実装時に本格利用。
   ============================== */

/**
 * PaneContext: 各ペインが持つビュー固有の状態
 * Phase 2 でメインビューを2ペインに分割する際、各ペインが独立した
 * DB選択状態・表示データ・ビューモードを持てるようにする。
 */
class PaneContext {
  constructor(paneId) {
    this.paneId = paneId;           // 'main' | 'pane-a' | 'pane-b'
    this.dbPath = null;             // 現在選択中のDBフォルダパス
    this.entityPath = null;         // 現在選択中のエントリパス
    this.pagePath = null;           // 現在選択中のページパス
    this.boardPath = null;          // 現在選択中のボードパス
    this.pivotData = null;          // /pivot APIレスポンス
    this.filter = 'disabled';       // ステータスフィルタ
    this.viewMode = 'welcome';      // 現在のビューモード
    this.smartDb = null;            // スマートDB定義
    this.smartDbData = null;        // スマートDBデータ
    this.containerEl = null;        // このペインのDOMコンテナ
    this.tableId = null;            // ペイン固有のテーブルID
    this.destroyed = false;         // 破棄後の非同期応答を無効化
    this.generation = 0;            // 読込・フォーカス復元の寿命世代
    this.hostController = null;     // 埋め込み画面の直列化コントローラー
    this._selectedEntities = new Set(); // D-5: ピボット行の選択状態 (entityName ベース)
  }
}

// ペイン管理
const _panes = {};                  // { paneId: PaneContext }
let _activePane = null;             // 現在フォーカスのあるPaneContext

function getActivePane() { return _activePane; }
function setActivePane(paneId) { _activePane = _panes[paneId] || null; }
function getPaneContext(paneId) { return _panes[paneId]; }
function getAllPanes() { return _panes; }

/** ペインコンテキストを生成して登録 */
function createPaneContext(paneId) {
  const ctx = new PaneContext(paneId);
  _panes[paneId] = ctx;
  if (!_activePane) _activePane = ctx;
  return ctx;
}

/** ペインコンテキストを破棄 (D-5: 一括編集バーの clean up を含む) */
function destroyPaneContext(paneId) {
  // 当該ペインに紐付いた選択フロートメニューを除去
  document.querySelectorAll(`.db-bulk-edit-bar[data-pane-id="${paneId}"], .db-cell-bulk-bar[data-pane-id="${paneId}"], [data-selection-float-pane-id="${paneId}"]`).forEach(bar => bar.remove());
  // Step 2: チャンク分割レンダリング中なら中断トークンを無効化
  const ctx = _panes[paneId];
  if (ctx) {
    ctx.destroyed = true;
    ctx.generation = (ctx.generation || 0) + 1;
    ctx._renderToken = null;
    ctx._renderInProgress = false;
    if (ctx._dragSelectPointerUp) {
      document.removeEventListener('pointerup', ctx._dragSelectPointerUp);
      document.removeEventListener('pointercancel', ctx._dragSelectPointerUp);
      ctx._dragSelectPointerUp = null;
    }
    ctx._dragSelectState = null;
  }
  if (_activePane === _panes[paneId]) _activePane = null;
  delete _panes[paneId];
}

/** ペイン内のDOM要素を取得（明示ctxは決してdocumentへフォールバックしない） */
function _paneEl(ctx, selector) {
  if (ctx) {
    if (ctx.destroyed) return null;
    if (!ctx.containerEl) return (ctx.embedded || ctx.strictRoot) ? null : document.querySelector(selector);
    return ctx.containerEl.querySelector(selector);
  }
  return document.querySelector(selector);
}

/** ペイン内のDOM要素をID指定で取得 */
function _paneElById(ctx, id) {
  if (ctx) {
    if (ctx.destroyed) return null;
    if (!ctx.containerEl) return (ctx.embedded || ctx.strictRoot) ? null : document.getElementById(id);
    return ctx.containerEl.querySelector('#' + id);
  }
  return document.getElementById(id);
}

const GBSelectionFloatMenu = (() => {
  const DRAG_HANDLE_CLASS = 'gb-selection-float-drag';

  function hostFor(anchor, fallback) {
    if (fallback && fallback !== document) return fallback;
    const el = anchor && typeof anchor.closest === 'function' ? anchor : null;
    return el?.closest?.('.gb-pane-content,.pane-content,#folder-view,.gb-tool-calendar,.sn2-host,#pivot-view,#main-views')
      || document.getElementById('main-views')
      || document.body;
  }

  function prepareHost(host) {
    if (!host || host === document.body) return document.body;
    host.classList?.add('gb-selection-float-host');
    const computed = window.getComputedStyle ? window.getComputedStyle(host) : null;
    if (computed && computed.position === 'static') {
      host.dataset.selectionFloatPosition = 'relative';
      host.style.position = 'relative';
    }
    return host;
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function resetPosition(bar, options = {}) {
    if (!bar) return;
    if (bar.dataset.selectionFloatDragged === '1' && !options.force) return;
    const host = prepareHost(options.host || hostFor(options.anchor, options.fallback));
    const fixed = host === document.body;
    bar.classList.add('gb-selection-float-bar');
    bar.classList.toggle('is-fixed', fixed);
    bar.style.position = fixed ? 'fixed' : 'absolute';
    bar.style.left = '50%';
    bar.style.top = '';
    bar.style.right = '';
    bar.style.bottom = fixed ? 'max(24px, env(safe-area-inset-bottom))' : '12px';
    bar.style.transform = 'translateX(-50%)';
    bar.style.maxWidth = fixed ? 'calc(100vw - 16px)' : 'calc(100% - 16px)';
    bar.style.zIndex = options.zIndex || '';
    if (bar.parentElement !== host) host.appendChild(bar);
  }

  function createDragHandle(label = 'ドラッグで移動') {
    const handle = document.createElement('button');
    handle.type = 'button';
    handle.className = DRAG_HANDLE_CLASS;
    handle.dataset.e2eId = 'selection-float-drag';
    handle.title = label;
    handle.setAttribute('aria-label', label);
    const iconMarkup = typeof lucide === 'function'
      ? lucide('gripVertical', 14)
      : '<span class="ico ico-gripVertical" aria-hidden="true"></span>';
    handle.innerHTML = `<span class="gb-selection-float-drag-icon" aria-hidden="true">${iconMarkup}</span>`;
    return handle;
  }

  function ensureDragHandle(bar, label) {
    let handle = bar?.querySelector?.('.' + DRAG_HANDLE_CLASS);
    if (!handle && bar) {
      handle = createDragHandle(label);
      bar.insertBefore(handle, bar.firstChild);
    }
    return handle;
  }

  function bindDrag(bar, options = {}) {
    if (!bar || bar.dataset.selectionFloatDragBound === '1') return;
    bar.dataset.selectionFloatDragBound = '1';
    bar.addEventListener('pointerdown', event => event.stopPropagation());
    bar.addEventListener('click', event => event.stopPropagation());
    bar.addEventListener('click', event => {
      const btn = event.target?.closest?.('button');
      if (btn && !btn.classList.contains(DRAG_HANDLE_CLASS)) pulseButton(btn);
    }, true);
    bar.addEventListener('pointerdown', event => {
      const handle = event.target?.closest?.('.' + DRAG_HANDLE_CLASS);
      if (!handle) return;
      event.preventDefault();
      event.stopPropagation();
      const host = prepareHost(options.host || bar.parentElement || document.body);
      const fixed = host === document.body;
      const hostRect = fixed
        ? { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight }
        : host.getBoundingClientRect();
      const barRect = bar.getBoundingClientRect();
      const startX = event.clientX;
      const startY = event.clientY;
      const startLeft = barRect.left - hostRect.left;
      const startTop = barRect.top - hostRect.top;
      bar.classList.add('is-dragging');
      bar.style.position = fixed ? 'fixed' : 'absolute';
      bar.style.bottom = 'auto';
      bar.style.transform = 'none';
      try { handle.setPointerCapture?.(event.pointerId); } catch {}

      const move = ev => {
        const nextLeft = clamp(startLeft + ev.clientX - startX, 6, Math.max(6, hostRect.width - barRect.width - 6));
        const nextTop = clamp(startTop + ev.clientY - startY, 6, Math.max(6, hostRect.height - barRect.height - 6));
        bar.style.left = fixed ? `${nextLeft}px` : `${nextLeft}px`;
        bar.style.top = fixed ? `${nextTop}px` : `${nextTop}px`;
        bar.dataset.selectionFloatDragged = '1';
      };
      const done = ev => {
        bar.classList.remove('is-dragging');
        try { handle.releasePointerCapture?.(ev.pointerId); } catch {}
        document.removeEventListener('pointermove', move, true);
        document.removeEventListener('pointerup', done, true);
        document.removeEventListener('pointercancel', done, true);
      };
      document.addEventListener('pointermove', move, true);
      document.addEventListener('pointerup', done, true);
      document.addEventListener('pointercancel', done, true);
    }, true);
  }

  function pulseButton(button) {
    if (!button || button.disabled) return;
    button.classList.add('is-pressed');
    button.dataset.pressed = '1';
    clearTimeout(button._selectionFloatPressedTimer);
    button._selectionFloatPressedTimer = setTimeout(() => {
      button.classList.remove('is-pressed');
      delete button.dataset.pressed;
    }, 220);
  }

  function bindActionButton(button, action) {
    if (!button) return button;
    button.classList.add('gb-selection-float-button');
    button.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      if (button.disabled) return;
      pulseButton(button);
      let result;
      try {
        result = action?.(event);
      } catch (error) {
        button.removeAttribute('aria-busy');
        throw error;
      }
      if (result && typeof result.then === 'function') {
        button.setAttribute('aria-busy', 'true');
        result.finally(() => button.removeAttribute('aria-busy'));
      }
    });
    return button;
  }

  function button(label, options = {}) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = label;
    if (options.e2eId) btn.dataset.e2eId = options.e2eId;
    if (options.title) btn.title = options.title;
    if (options.danger) btn.classList.add('danger');
    if (options.muted) btn.classList.add('muted');
    return bindActionButton(btn, options.onClick);
  }

  return {
    bindDrag,
    bindActionButton,
    button,
    createDragHandle,
    ensureDragHandle,
    hostFor,
    resetPosition,
    pulseButton,
  };
})();

/**
 * 互換レイヤー: グローバルstateへのプロキシ
 * Phase 0-1 では既存コードがグローバルstateを直接参照する。
 * Phase 2 でrenderPivot(ctx)等にPaneContext引数を追加する際、
 * 引数省略時にこの関数でグローバルstateをPaneContext風に返す。
 */
// シングルトン化したフォールバックプロキシ。
// 複数回 _currentPaneState() を呼んでも同じオブジェクトを返すことで、
// チャンク分割レンダリングの中断トークン (_renderToken / _renderInProgress) 等
// ctx に直接書き込まれる状態が次の呼び出しでも参照できるようにする。
let _fallbackPaneProxy = null;
const _paneStateBinding = Object.freeze({
  dbPath: 'currentDbPath',
  entityPath: 'currentEntityPath',
  pagePath: 'currentPagePath',
  boardPath: 'currentBoardPath',
  pivotData: 'pivotData',
  filter: 'filter',
  viewMode: 'view',
  smartDb: 'currentSmartDb',
  smartDbData: 'smartDbData',
});

const GBPaneState = {
  paneLocalKeys: Object.freeze(Object.keys(_paneStateBinding)),
  activePaneMirrorKeys: Object.freeze(Object.values(_paneStateBinding)),
  notes: Object.freeze({
    paneLocal:
      'dbPath/entityPath/pagePath/boardPath/pivotData/filter/viewMode/smartDb/smartDbData は pane-local を正とし、必要時だけ active pane を global state へミラーする。',
    global:
      '認証・テーマ・右パネル・最近使った項目・通知・ワークスペース全体設定は global state/DOM を正とする。',
  }),
  isPaneLocalKey(key) {
    return Object.prototype.hasOwnProperty.call(_paneStateBinding, key);
  },
  getGlobalKey(key) {
    return _paneStateBinding[key] || null;
  },
  read(ctx, key, fallbackValue) {
    const pane = ctx || _currentPaneState();
    if (pane && typeof pane[key] !== 'undefined') return pane[key];
    const globalKey = this.getGlobalKey(key);
    if (globalKey && typeof state !== 'undefined') return state[globalKey];
    return fallbackValue;
  },
  write(ctx, key, value, { syncGlobal = true } = {}) {
    const pane = ctx || _currentPaneState();
    if (pane && this.isPaneLocalKey(key)) {
      pane[key] = value;
    }
    const globalKey = this.getGlobalKey(key);
    if (syncGlobal && globalKey && typeof state !== 'undefined') {
      state[globalKey] = value;
    }
    return value;
  },
};

function _globalPaneState() {
  if (_fallbackPaneProxy) return _fallbackPaneProxy;
  // フォールバック: グローバルstateから擬似PaneContextを返す
  _fallbackPaneProxy = {
    get paneId() { return 'main'; },
    get dbPath() { return state.currentDbPath; },
    set dbPath(v) { state.currentDbPath = v; },
    get entityPath() { return state.currentEntityPath; },
    set entityPath(v) { state.currentEntityPath = v; },
    get pagePath() { return state.currentPagePath; },
    set pagePath(v) { state.currentPagePath = v; },
    get boardPath() { return state.currentBoardPath; },
    set boardPath(v) { state.currentBoardPath = v; },
    get pivotData() { return state.pivotData; },
    set pivotData(v) { state.pivotData = v; },
    get filter() { return state.filter; },
    set filter(v) {
      if (typeof setFilter === 'function') setFilter(v, { skipReload: true });
      else state.filter = v;
    },
    get viewMode() { return state.view; },
    set viewMode(v) { state.view = v; },
    get smartDb() { return state.currentSmartDb; },
    set smartDb(v) { state.currentSmartDb = v; },
    get smartDbData() { return state.smartDbData; },
    set smartDbData(v) { state.smartDbData = v; },
    get containerEl() { return null; }, // v5.0: ペインシステムのshowView()が直接管理
    get tableId() { return 'pivot-table'; },
    // D-5: 単一ペインモードの選択状態シングルトン Set
    get _selectedEntities() {
      if (!state._selectedEntities) state._selectedEntities = new Set();
      return state._selectedEntities;
    },
  };
  return _fallbackPaneProxy;
}

function _currentPaneState() {
  if (_activePane) return _activePane;
  return _globalPaneState();
}

if (typeof window !== 'undefined') {
  window.GBPaneState = GBPaneState;
  window.GBSelectionFloatMenu = GBSelectionFloatMenu;
}
