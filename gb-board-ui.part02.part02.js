        });
      } else { lineFieldsEl.textContent = 'ラインスタイル未設定'; console.warn('[board detail] no line style available'); }
    }
    root.querySelector('[data-bd-action="save-card-style-as-new"]')?.addEventListener('click', () => _bdSaveBoardStyleAsNew('card'));
    root.querySelector('[data-bd-action="save-line-style-as-new"]')?.addEventListener('click', () => _bdSaveBoardStyleAsNew('line'));
    root.querySelector('[data-bd-action="save-card-style"]')?.addEventListener('click', () => _bdSaveCurrentBoardStyle('card'));
    root.querySelector('[data-bd-action="save-line-style"]')?.addEventListener('click', () => _bdSaveCurrentBoardStyle('line'));
    root.querySelector('[data-bd-action="reset-card-style"]')?.addEventListener('click', () => {
      const style = bd.cardStyles.find(s => s.id === bd.activeCardStyle) || bd.cardStyles[0] || null;
      if (!style) return;
      bdPushUndo();
      _bdResetStyleToDefault('card', style);
      rerenderBoardDetail();
      showStatus(`カードスタイル「${style.name}」をデフォルトに戻しました`);
    });
    root.querySelector('[data-bd-action="reset-line-style"]')?.addEventListener('click', () => {
      const style = bd.lineStyles.find(s => s.id === bd.activeLineStyle) || bd.lineStyles[0] || null;
      if (!style) return;
      bdPushUndo();
      _bdResetStyleToDefault('line', style);
      rerenderBoardDetail();
      showStatus(`ラインスタイル「${style.name}」をデフォルトに戻しました`);
    });
    root.querySelector('[data-bd-action="manage-card-styles"]')?.addEventListener('click', () => bdOpenCardStyleManager());
    root.querySelector('[data-bd-action="manage-line-styles"]')?.addEventListener('click', () => bdOpenLineStyleManager());
    root.querySelector('[data-bd-action="export-board-styles"]')?.addEventListener('click', () => {
      if (typeof bdExportBoardStylePack === 'function') bdExportBoardStylePack();
      else if (typeof showStatus === 'function') showStatus('ボードスタイル書き出し機能を初期化できませんでした', true);
    });
    root.querySelector('[data-bd-action="manage-statuses"]')?.addEventListener('click', () => {
      if (typeof bdManageStatuses === 'function') bdManageStatuses();
    });
    root.querySelector('[data-bd-action="manage-depth-styles"]')?.addEventListener('click', () => {
      if (typeof bdOpenDepthStyleManager === 'function') bdOpenDepthStyleManager();
    });
    root.querySelector('[data-bd-action="apply-depth-theme-colors"]')?.addEventListener('click', () => {
      if (typeof bdApplyThemeColorsToDepthStyles !== 'function') return;
      if (typeof bdPushUndo === 'function') bdPushUndo();
      bdApplyThemeColorsToDepthStyles({ applyLineColor: true });
      if (typeof bdApplyAutoStyle === 'function') bd.nodes.filter(node => node._autoStyle).forEach(node => bdApplyAutoStyle(node.id));
      if (typeof bdRender === 'function') bdRender();
      bdDirty();
      if (typeof bdRefreshSelectionDetails === 'function') bdRefreshSelectionDetails(true);
      showStatus('テーマカラーを階層別スタイルに適用しました');
    });
    // 階層別スタイル: 選択した階層を管理ダイアログで開く
    root.querySelector('[data-bd-board-depth-style-pick]')?.addEventListener('change', event => {
      const idx = parseInt(event.target.value, 10);
      if (Number.isFinite(idx)) window._bdPendingDepthStyleIndex = idx;
      if (typeof bdOpenDepthStyleManager === 'function') bdOpenDepthStyleManager();
    });
    // 階層別スタイル: デフォルトとして保存
    root.querySelector('[data-bd-action="save-depth-styles"]')?.addEventListener('click', () => {
      if (typeof bdEnsureDepthStyles === 'function') bdEnsureDepthStyles();
      const snapshot = typeof bdNormalizeDepthStyles === 'function'
        ? bdNormalizeDepthStyles(bd.depthStyles || [])
        : (bd.depthStyles || []).slice();
      if (typeof bdPushUndo === 'function') bdPushUndo();
      if (typeof _bdSaveGlobalDepthStyles === 'function') _bdSaveGlobalDepthStyles(snapshot);
      showStatus('階層別スタイルをデフォルトとして保存しました', false, { showSaveDialog: true });
    });
    // 階層別スタイル: デフォルトに戻す
    root.querySelector('[data-bd-action="reset-depth-styles"]')?.addEventListener('click', () => {
      if (typeof bdPushUndo === 'function') bdPushUndo();
      const global = typeof _bdReadGlobalDepthStyles === 'function' ? _bdReadGlobalDepthStyles() : null;
      const globalIsLegacy = typeof _bdIsLegacyDefaultDepthStyles === 'function' && _bdIsLegacyDefaultDepthStyles(global);
      if (Array.isArray(global) && global.length && !globalIsLegacy) {
        bd.depthStyles = typeof bdNormalizeDepthStyles === 'function' ? bdNormalizeDepthStyles(global) : global.slice();
        showStatus('保存したデフォルトに戻しました');
      } else {
        bd.depthStyles = typeof bdNormalizeDepthStyles === 'function' ? bdNormalizeDepthStyles([]) : [];
        showStatus('デフォルトは未保存のため、ビルトイン初期値に戻しました');
      }
      if (typeof bdApplyAutoStyle === 'function') bd.nodes.filter(node => node._autoStyle).forEach(node => bdApplyAutoStyle(node.id));
      if (typeof bdRender === 'function') bdRender();
      bdDirty();
      if (typeof bdRefreshSelectionDetails === 'function') bdRefreshSelectionDetails(true);
    });
  });
}

function _bdHasActiveBoardCanvas() {
  const canvas = document.getElementById('bd-canvas');
  return !!(canvas && canvas.isConnected);
}

function bdRefreshSelectionDetails(forceEmpty) {
  if (typeof bd === 'undefined') return;
  if (!_bdHasActiveBoardCanvas()) return;
  if (typeof bdEnsureBoardUiState === 'function') bdEnsureBoardUiState();
  if (!_bdCanRenderDetailPanel()) return;
  const selectedConnIds = typeof bdGetSelectedConnectionIds === 'function' ? bdGetSelectedConnectionIds() : [];
  const activateSelectionTab = forceEmpty !== true;
  if (bd.selected.size === 0 && selectedConnIds.length === 0 && !forceEmpty) {
    // 選択が空白クリック等で解除された場合: カード/ライン タブは非表示、
    // テーマタブをアクティブ (ユーザーが明示的に開いている board-note / backlinks は尊重)。
    if (typeof clearBoardDetailTabContent === 'function') clearBoardDetailTabContent();
    _bdRenderBoardPrimaryDetail();
    return;
  }
  // タブ表示は維持し、コンテンツだけクリアする。作業パネル再アクティブ時に
  // スタイル/拡張タブが基本へ戻ってしまうのを防ぐため。
  if (typeof clearBoardDetailTabContent === 'function') clearBoardDetailTabContent();
  else if (typeof clearBoardDetailTabs === 'function') clearBoardDetailTabs();
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
