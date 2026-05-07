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
  // 当該ペインに紐付いた db-bulk-edit-bar を document.body から除去
  const bar = document.body.querySelector(`.db-bulk-edit-bar[data-pane-id="${paneId}"]`);
  if (bar) bar.remove();
  // Step 2: チャンク分割レンダリング中なら中断トークンを無効化
  const ctx = _panes[paneId];
  if (ctx) {
    ctx._renderToken = null;
    ctx._renderInProgress = false;
  }
  if (_activePane === _panes[paneId]) _activePane = null;
  delete _panes[paneId];
}

/** ペイン内のDOM要素を取得（ctx.containerEl内を検索、なければdocument） */
function _paneEl(ctx, selector) {
  if (ctx && ctx.containerEl) return ctx.containerEl.querySelector(selector);
  return document.querySelector(selector);
}

/** ペイン内のDOM要素をID指定で取得 */
function _paneElById(ctx, id) {
  if (ctx && ctx.containerEl) return ctx.containerEl.querySelector('#' + id);
  return document.getElementById(id);
}

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

function _currentPaneState() {
  if (_activePane) return _activePane;
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

if (typeof window !== 'undefined') {
  window.GBPaneState = GBPaneState;
}
