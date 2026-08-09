/* gb-detail-shortcuts-tab.js
 * オプションパネルの「ショートカットキー」タブ。
 *
 * 一覧・検索・変更・リセットの中身は gb-shortcut-registry.js（設定ダイアログと共通）が持つ。
 * ここは「どのアプリの分を最初に見せるか」を決めて描画を頼むだけ。
 *
 * 初期表示は、いまメインパネルで開いているアプリのショートカットキーだけに絞る。
 * 単独アプリはメインパネルのアプリが固定なので、起動時に
 * window.__meldexAppShortcutScope でスコープを宣言する。
 */
(function (global) {
  'use strict';

  // GBLayout / GBPaneDefaultLayout / state はスクリプト直下の const 宣言なので
  // window のプロパティにはならない。bare 参照を typeof で確認して読む。
  function _layoutApi() {
    return typeof GBLayout !== 'undefined' ? GBLayout : null;
  }

  function _mainPaneActiveTabType() {
    try {
      const layout = _layoutApi();
      if (!layout) return '';
      const defaultLayout = typeof GBPaneDefaultLayout !== 'undefined' ? GBPaneDefaultLayout : null;
      const paneId = defaultLayout?.resolveMainPaneId?.() || layout.activePane || '';
      const pane = paneId ? layout.findNode?.(layout.root, paneId)?.node : null;
      const tab = pane?.tabs?.[pane.activeTabIndex];
      return tab?.type || '';
    } catch {
      return '';
    }
  }

  function _currentViewName() {
    try {
      return (typeof state === 'object' && state) ? String(state.view || '') : '';
    } catch {
      return '';
    }
  }

  function currentShortcutScope() {
    const registry = global.MeldexShortcutRegistry;
    if (!registry) return '';
    if (global.__meldexAppShortcutScope) return String(global.__meldexAppShortcutScope);
    const fromPane = registry.scopeForType(_mainPaneActiveTabType());
    if (fromPane) return fromPane;
    // メインパネルから決められない場合は、画面全体の表示種別で補う
    return registry.scopeForType(_currentViewName()) || '';
  }

  // このタブはどのアプリでも常に出す（他のタブと違い選択中の対象に依存しない）
  function showShortcutsDetailTab() {
    document.querySelectorAll('.detail-tab-shortcuts').forEach(tab => { tab.hidden = false; });
  }

  function renderShortcutsDetailTab() {
    const container = document.getElementById('detail-tab-shortcuts');
    if (!container) return;
    if (!global.MeldexShortcutRegistry) {
      container.innerHTML = '<div class="gb-empty-placeholder">ショートカットキーを読み込めませんでした</div>';
      return;
    }
    global.MeldexShortcutRegistry.renderSettings(container, { scope: currentShortcutScope() });
  }

  global.showShortcutsDetailTab = showShortcutsDetailTab;
  global.renderShortcutsDetailTab = renderShortcutsDetailTab;
  global.currentShortcutScope = currentShortcutScope;
})(typeof window !== 'undefined' ? window : globalThis);
