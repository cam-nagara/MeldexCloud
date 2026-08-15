function _bdHasActiveBoardCanvas() {
  const canvas = document.getElementById('bd-canvas');
  return !!(canvas && canvas.isConnected);
}

// 課題10-1 (2026-08-14): 以前は選択操作のたびに clearBoardDetailTabContent() が
// カードスタイル/ラインスタイル/階層別スタイルタブの DOM も無条件で全破棄していたため、
// カード移動・追加などスタイルタブと無関係な操作でもスクロール位置が先頭へ戻り、
// フォーカスが失われ、開いていたカラーピッカーの参照が切れていた。カード/ラインタブの
// 内容だけをクリアし、スタイル管理系3タブは維持したまま各タブ自身の差分描画に任せる。
function _bdClearBoardCardLineTabContent() {
  if (typeof setBoardDetailTabContent === 'function') setBoardDetailTabContent({ card: '', line: '' });
}

// 階層別スタイルタブの「起点プリセット行」(課題18-案B) だけは選択中カードに依存するため、
// 選択が実際に変わったときだけ明示的に同期する (差分再描画。フォーカス/スクロールは温存)。
let _bdLastDetailSelectionKey = null;
function _bdSyncDepthStyleTabForSelectionChange() {
  const nodeIds = (typeof bd !== 'undefined' && bd.selected) ? [...bd.selected].sort() : [];
  const connIds = typeof bdGetSelectedConnectionIds === 'function' ? bdGetSelectedConnectionIds().slice().sort() : [];
  const key = nodeIds.join(',') + '|' + connIds.join(',');
  if (key === _bdLastDetailSelectionKey) return;
  _bdLastDetailSelectionKey = key;
  const depthEl = document.getElementById('detail-tab-board-depth-style');
  if (depthEl && depthEl.childElementCount > 0 && typeof _bdRenderDepthStyleInPanel === 'function') {
    _bdRenderDepthStyleInPanel(depthEl, _bdLastDepthEditIndex);
  }
}

function bdRefreshSelectionDetails(forceEmpty) {
  if (typeof bd === 'undefined') return;
  if (!_bdHasActiveBoardCanvas()) return;
  if (typeof bdEnsureBoardUiState === 'function') bdEnsureBoardUiState();
  if (!_bdCanRenderDetailPanel()) return;
  const selectedConnIds = typeof bdGetSelectedConnectionIds === 'function' ? bdGetSelectedConnectionIds() : [];
  const activateSelectionTab = forceEmpty !== true;
  _bdSyncDepthStyleTabForSelectionChange();
  if (bd.selected.size === 0 && selectedConnIds.length === 0 && !forceEmpty) {
    // 選択が空白クリック等で解除された場合: カード/ライン タブは非表示、
    // テーマタブをアクティブ (ユーザーが明示的に開いている board-note / backlinks は尊重)。
    _bdClearBoardCardLineTabContent();
    _bdRenderBoardPrimaryDetail();
    return;
  }
  // タブ表示は維持し、カード/ラインタブのコンテンツだけクリアする。作業パネル再アクティブ時に
  // スタイル/拡張タブが基本へ戻ってしまうのを防ぐため。スタイル管理系3タブは無条件クリアしない
  // (課題10-1: 各タブが自分の差分描画で追従する)。
  _bdClearBoardCardLineTabContent();
  if (bd.selected.size > 1 || selectedConnIds.length > 1 || (bd.selected.size && selectedConnIds.length)) {
    // 複数選択: 概要 HTML はカード側が選択を含むときはカードタブに、
    // ラインのみの複数選択ならラインタブに表示する。
    const html = _bdSelectionSummaryHtml();
    if (bd.selected.size >= 1) {
      if (_bdCanUseBoardDetailTabs()) _bdSetNodeDetailTabs(null, html, { activate: activateSelectionTab });
      else if (typeof showDetailPanel === 'function') showDetailPanel(html);
    } else {
      if (_bdCanUseBoardDetailTabs()) _bdSetConnDetailTab(html, { activate: activateSelectionTab });
      else if (typeof showDetailPanel === 'function') showDetailPanel(html);
    }
    _bdBindSelectionDetailPanel();
    return;
  }
  if (selectedConnIds.length === 1) {
    const conn = typeof bdGetConnectionById === 'function' ? bdGetConnectionById(selectedConnIds[0]) : null;
    if (!conn) {
      if (typeof bdClearConnectionSelection === 'function') bdClearConnectionSelection();
      if (!forceEmpty) return;
      _bdRenderBoardPrimaryDetail();
      return;
    }
    const html = _bdBuildConnectionDetailHtml(conn);
    if (_bdCanUseBoardDetailTabs()) _bdSetConnDetailTab(html, { activate: activateSelectionTab });
    else if (typeof showDetailPanel === 'function') showDetailPanel(html);
    _bdBindConnectionDetailPanel(conn.id);
    return;
  }
  if (bd.selected.size === 0) {
    if (!forceEmpty) return;
    _bdRenderBoardPrimaryDetail();
    return;
  }
  const nodeId = [...bd.selected][0];
  const node = bd.nodes.find(item => item.id === nodeId);
  if (!node) return;
  _bdBuildNodeDetailHtml(node);
  const panels = _bdLastNodeDetailPanels && _bdLastNodeDetailPanels.nodeId === node.id
    ? _bdLastNodeDetailPanels
    : { nodeId: node.id, contentHtml: '' };
  _bdRenderNodeDetailPanels(node, panels, { activate: activateSelectionTab });
  _bdBindNodeDetailPanel(node.id);
}

function bdSyncBoardUi(forceEmptyDetail) {
  const started = typeof bdPerfStart === 'function' ? bdPerfStart('bdSyncBoardUi') : 0;
  bdRefreshBoardToolbar();
  bdRefreshSelectionDetails(forceEmptyDetail);
  if (typeof bdPerfEnd === 'function') bdPerfEnd('bdSyncBoardUi', started);
}

/* スタイルマネージャ / フィルタメニューは gb-board-style-manager.js に分離 */
