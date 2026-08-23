/* board-standalone-stubs.js
 * 単独ボードアプリ用のグローバル変数スタブ。
 * Meldex 本体で当然のように使われているグローバル（state, GBLayout, GBTabs 等）を
 * 最小限の no-op で用意し、ボード関連スクリプトがエラーを出さずに読み込めるようにする。
 *
 * 重要: 単独アプリ用。Meldex.html 本体では絶対に読み込まないこと。
 *       本ファイルは meldex-core.js より後、ボード関連スクリプトより前に読み込む。
 */
(function () {
  'use strict';

  if (typeof window === 'undefined') return;

  // --- state ----------------------------------------------------------------
  // Meldex 本体の state オブジェクトの最小相当。
  if (typeof window.state === 'undefined') {
    window.state = {
      vaultPath: null,
      currentDbPath: null,
      currentEntityPath: null,
      currentPagePath: null,
      currentBoardPath: null,
      currentSmartDb: null,
      smartDbData: null,
      pivotData: null,
      filter: 'disabled',
      view: 'board',
    };
  }

  // --- showStatus -----------------------------------------------------------
  // 既存ステータスバー実装の代わりに、画面下のトースト 1 つにメッセージを流す。
  const previousShowStatus = typeof window.showStatus === 'function' ? window.showStatus : null;
  if (!window.showStatus?._bsaToast) {
    const showBoardToast = function (message, isError) {
      try {
        const toast = document.getElementById('board-toast');
        if (!toast) {
          if (previousShowStatus) previousShowStatus(message, isError);
          return;
        }
        toast.textContent = String(message || '');
        toast.classList.toggle('error', !!isError);
        toast.classList.add('visible');
        clearTimeout(window._boardToastTimer);
        window._boardToastTimer = setTimeout(() => {
          toast.classList.remove('visible');
        }, isError ? 6000 : 3500);
      } catch (e) {
        // フォールバック: コンソールに出すだけ
        if (isError) console.error(message); else console.log(message);
      }
    };
    showBoardToast._bsaToast = true;
    window.showStatus = showBoardToast;
  }

  if (typeof window.cfConfirm !== 'function') {
    window.cfConfirm = function (message) {
      if (typeof window.showConfirmDialog === 'function') {
        return new Promise((resolve) => {
          window.showConfirmDialog(String(message || ''), () => resolve(true), () => resolve(false));
        });
      }
      return Promise.resolve(typeof window.confirm !== 'function' || window.confirm(String(message || '')));
    };
  }

  if (typeof window.cfPrompt !== 'function') {
    let promptSeq = 0;
    window.cfPrompt = function (message, defaultValue, options) {
      const opts = options || {};
      const okLabel = opts.okLabel || '決定';
      const cancelLabel = opts.cancelLabel || 'キャンセル';
      if (typeof window.GBUI?.createModal !== 'function') {
        const nativeValue = typeof window.prompt === 'function'
          ? window.prompt(String(message || ''), String(defaultValue ?? ''))
          : null;
        return Promise.resolve(nativeValue);
      }
      return new Promise(resolve => {
        const restoreFocusTo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        const idBase = 'bsa-cf-prompt-' + (++promptSeq);
        const messageNode = document.createElement('div');
        messageNode.className = 'gb-confirm-message';
        messageNode.id = idBase + '-message';
        messageNode.textContent = String(message || '');
        const input = document.createElement('input');
        input.type = 'text';
        input.id = '_gb-prompt-input';
        input.className = 'gb-confirm-input';
        input.value = String(defaultValue ?? '');
        const cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.id = '_gb-cancel';
        cancel.className = 'gb-btn gb-btn-sm';
        cancel.textContent = cancelLabel;
        const ok = document.createElement('button');
        ok.type = 'button';
        ok.id = '_gb-ok';
        ok.className = 'gb-btn gb-btn-sm gb-btn-primary';
        ok.textContent = okLabel;
        let result = null;
        const modalApi = window.GBUI.createModal({
          id: idBase,
          titleId: idBase + '-title',
          title: '入力',
          body: [messageNode, input],
          footer: [cancel, ok],
          variant: 'standard',
          extraClass: 'gb-confirm',
          geometryKey: 'board-standalone-prompt',
          minWidth: '0',
          initialFocus: () => input,
          returnFocus: () => restoreFocusTo,
          closeLabel: '入力をキャンセル',
          closeOnEsc: true,
          closeOnOverlay: true,
          onClose: () => resolve(result),
        });
        modalApi.overlay.classList.add('modal-overlay', 'bsa-cf-prompt-overlay');
        modalApi.overlay.dataset.e2eId = 'cf-prompt-overlay';
        modalApi.modal.classList.add('bsa-cf-prompt-dialog');
        modalApi.modal.dataset.e2eId = 'cf-prompt-dialog';
        modalApi.modal.dataset.dialogType = 'cf-prompt';
        modalApi.modal.setAttribute('aria-label', '入力');
        modalApi.modal.setAttribute('aria-describedby', messageNode.id);
        modalApi.footer.classList.add('gb-confirm-actions');
        const finish = (value, reason) => {
          result = value;
          modalApi.close(reason);
        };
        ok.addEventListener('click', () => finish(input.value, 'submit'));
        cancel.addEventListener('click', () => finish(null, 'cancel'));
        input.addEventListener('keydown', event => {
          if (event.key === 'Enter') {
            event.preventDefault();
            finish(input.value, 'submit');
          }
        });
        modalApi.open();
        requestAnimationFrame(() => {
          input.focus?.({ preventScroll: true });
          input.select();
        });
      });
    };
  }

  if (typeof window.getUsername !== 'function') {
    window.getUsername = function () {
      try {
        const saved = JSON.parse(localStorage.getItem('meldex-user') || '{}');
        const name = String(saved?.name || '').trim();
        if (name) return name;
      } catch (e) {}
      return 'Board';
    };
  }

  if (typeof window.getUserAvatarHtml !== 'function') {
    window.getUserAvatarHtml = function (username, size) {
      const label = String(username || '?').trim().charAt(0).toUpperCase() || '?';
      const px = Math.max(12, Math.min(48, Number(size) || 16));
      const safeLabel = window.MeldexEscape.html(label);
      return '<span class="gb-avatar-initial" style="width:' + px + 'px;height:' + px + 'px;font-size:' + Math.max(9, Math.round(px * 0.56)) + 'px;">' + safeLabel + '</span>';
    };
  }

  // --- レイアウト・タブシステムのダミー ---------------------------------------
  // ボードは GBLayout.activePane や GBTabs.getActiveTab を参照するが、
  // 単独アプリにはペイン分割もタブも無いので、常に「ペイン 1 つ・タブ 1 つ」を返す。
  function _standaloneBoardTab() {
    const path = String((window.state && window.state.currentBoardPath) || (window.bd && window.bd.path) || '');
    const label = path ? (path.split('/').pop() || path) : '新規ボード';
    return {
      id: 'board-standalone-tab',
      type: 'board',
      path,
      label,
      state: { boardPath: path, label },
    };
  }

  if (typeof window.GBLayout === 'undefined') {
    const PANE_ID = 'board-standalone-pane';
    const paneNode = { id: PANE_ID, tabs: [], activeTabIndex: 0 };
    let bulkSourceTab = null;
    const refreshPaneNode = function () {
      paneNode.tabs = [_standaloneBoardTab(), ...(bulkSourceTab ? [bulkSourceTab] : [])];
      paneNode.activeTabIndex = 0;
      return paneNode;
    };
    window._bsaSetBulkSourceTab = function (tab) {
      bulkSourceTab = tab && typeof tab === 'object' ? { ...tab, _standaloneBulkSource: true } : null;
      return refreshPaneNode();
    };
    window.GBLayout = {
      activePane: PANE_ID,
      root: paneNode,
      paneMap: { [PANE_ID]: paneNode },
      getAllPanes: function () { return [refreshPaneNode()]; },
      findNode: function (_root, paneId) {
        if (!paneId || paneId === PANE_ID) return { node: refreshPaneNode(), parent: null };
        return null;
      },
      isMaximized: function () { return false; },
      maximizePane: function () {},
      restoreMaximizedPane: function () {},
    };
    window._BOARD_STANDALONE_PANE_ID = PANE_ID;
  }

  if (typeof window.GBTabs === 'undefined') {
    window.GBTabs = {
      getActiveTab: function () {
        return _standaloneBoardTab();
      },
      getTabs: function () {
        return [this.getActiveTab()];
      },
      activateTab: function () {},
      closeTab: function () {},
    };
  }

  if (typeof window.showAddOutlinerItem !== 'function') {
    window.showAddOutlinerItem = function (type) {
      if (type === 'board' && window.MeldexBoardStandalone?.createNewBoard) {
        return window.MeldexBoardStandalone.createNewBoard();
      }
      return null;
    };
  }

  if (typeof window.getComponentInstance !== 'function') {
    window.getComponentInstance = function () { return null; };
  }

  // ToolComponent / CanvasComponent はクラス継承の親。
  // 単独アプリでは create() 等を呼ばないが、`extends ToolComponent` の評価時に
  // クラス自体が存在しないと SyntaxError になるため、空のクラスを置く。
  if (typeof window.ToolComponent === 'undefined') {
    window.ToolComponent = class ToolComponent {
      constructor(paneId, tabId) {
        this.paneId = paneId;
        this.tabId = tabId;
        this.el = null;
        this.state = {};
      }
      create() { return null; }
      activate() {}
      deactivate() {}
      destroy() {}
    };
  }

  // 本体のコンポーネント登録 API。単独アプリでは使わない（直接 bdOpenBoard を呼ぶ）。
  if (typeof window.registerToolComponent !== 'function') {
    window.registerToolComponent = function () {};
  }
  if (typeof window.unregisterToolComponent !== 'function') {
    window.unregisterToolComponent = function () {};
  }
  if (typeof window.getToolComponentConfig !== 'function') {
    window.getToolComponentConfig = function () { return null; };
  }

  // --- テーマ系フォールバック ------------------------------------------------
  // 通常は board-standalone.html が本体と同じ gb-theme-manager.js を先に読む。
  // 配布物の欠落などで読み込めなかった場合だけ、ボード内の themeId を失わない
  // 最小フォールバックを置く（可視操作を成功扱いする no-op にはしない）。
  if (typeof window.MeldexThemeManager === 'undefined') {
    window.MeldexThemeManager = {
      applyBoardThemeRuntime: function () {
        window.showStatus?.('テーマ機能を読み込めませんでした。アプリを再読み込みしてください', true);
        return false;
      },
      getActiveTheme: function () { return null; },
      getActiveBoardTheme: function () { return null; },
      getAllThemes: function () { return []; },
      getCustomThemes: function () { return []; },
      getDefaultThemeId: function () { return ''; },
      getThemeById: function () { return null; },
      getThemeColorSet: function () { return null; },
      getBoardThemeColorSet: function () { return null; },
      themeOptionsHtml: function () { return ''; },
      setBoardTheme: function (boardState, themeId) {
        if (boardState) boardState.themeId = String(themeId || '');
        if (typeof window.bdApplyBoardFileStyleAndTheme === 'function') {
          const canvas = document.getElementById('bd-canvas');
          const world = document.getElementById('bd-world');
          window.bdApplyBoardFileStyleAndTheme(canvas, world);
        }
        if (typeof window.bdRender === 'function') window.bdRender();
        if (typeof window.bdDirty === 'function') window.bdDirty();
        if (typeof window.showStatus === 'function') window.showStatus('テーマを更新しました');
      },
    };
  }
  if (typeof window.MeldexThemeMigration === 'undefined') {
    window.MeldexThemeMigration = {
      migrateBoardState: function () {},
    };
  }

  // --- ファイルスタイル -------------------------------------------------------
  // 本体の applyFileStyleToPanel と同じ公開契約で、保存済みCSS変数とテーマ参照を
  // ボード面だけへ適用する。適用済みキーを記録し、別ファイルを開いた時に確実に戻す。
  const FILE_STYLE_DATASET_KEY = 'fileStyleAppliedVars';
  function _bsaFileStyleVariables(style) {
    if (!style || typeof style !== 'object' || Array.isArray(style)) return {};
    const vars = {};
    const themeId = String(style.__themeId || style.themeId || '');
    const theme = themeId ? window.MeldexThemeManager?.getThemeById?.(themeId) : null;
    Object.assign(vars, theme?.ui?.cssVars || {});
    const palette = theme ? window.MeldexThemeManager?.getThemeColorSet?.(theme) : null;
    if (Array.isArray(palette)) {
      for (let i = 0; i < 10 && palette.length; i += 1) {
        vars[`--theme-palette-${i}`] = palette[i % palette.length];
      }
    }
    Object.entries(style).forEach(([key, value]) => {
      if (key.startsWith('--') && value !== '' && value != null) vars[key] = value;
    });
    return vars;
  }
  function _bsaClearFileStyleElement(element) {
    if (!element) return;
    String(element.dataset?.[FILE_STYLE_DATASET_KEY] || '')
      .split(',').map(key => key.trim()).filter(Boolean)
      .forEach(key => element.style.removeProperty(key));
    if (element.dataset) delete element.dataset[FILE_STYLE_DATASET_KEY];
  }
  if (typeof window.applyFileStyleToPanel !== 'function') {
    window.applyFileStyleToPanel = function (style, panelId) {
      const element = panelId === 'bd-canvas' && typeof window.bdGetBoardElement === 'function'
        ? window.bdGetBoardElement('canvas')
        : document.getElementById(panelId);
      if (!element) return false;
      _bsaClearFileStyleElement(element);
      const applied = [];
      Object.entries(_bsaFileStyleVariables(style)).forEach(([key, value]) => {
        element.style.setProperty(key, String(value));
        applied.push(key);
      });
      if (applied.length) element.dataset[FILE_STYLE_DATASET_KEY] = applied.join(',');
      return true;
    };
  }
  if (typeof window.clearFileStyleForPanel !== 'function') {
    window.clearFileStyleForPanel = function (panelId) {
      const element = panelId === 'bd-canvas' && typeof window.bdGetBoardElement === 'function'
        ? window.bdGetBoardElement('canvas')
        : document.getElementById(panelId);
      _bsaClearFileStyleElement(element);
    };
  }
  if (typeof window.clearFileStyle !== 'function') {
    window.clearFileStyle = function () {
      window.clearFileStyleForPanel('bd-canvas');
    };
  }

  // --- ヒストリー・自動バージョン -----------------------------------------------
  if (typeof window.startAutoVersion !== 'function') {
    window.startAutoVersion = function () {};
  }
  if (typeof window.stopAutoVersion !== 'function') {
    window.stopAutoVersion = function () {};
  }
  if (typeof window.markAutoVersionDirty !== 'function') {
    window.markAutoVersionDirty = function () {};
  }

  // board-standalone は共通履歴（gb-history.js）を読み込まない（bdUndo/bdRedo が持つ
  // 自己完結スタックへ意図的にフォールバックさせる設計、取り消し・やり直しボタン展開
  // フェーズ3-3の完了記録を参照）。しかし Ctrl+Z/Ctrl+Y の中央ハンドラ（gb-shortcuts.js）
  // は共通ルーター meldexUndo()/meldexRedo() を呼ぶため、それが未定義のままだと
  // ツールバーのボタンは動くのにキーボードショートカットだけ反応しない状態になる。
  // ここでは bdUndo/bdRedo（自己完結スタック版）へそのまま委譲する薄い実装を用意する
  // （取り消し・やり直しボタン展開 フェーズ5、v0.6.205）。
  if (typeof window.meldexUndo !== 'function') {
    window.meldexUndo = function () { if (typeof bdUndo === 'function') bdUndo(); };
  }
  if (typeof window.meldexRedo !== 'function') {
    window.meldexRedo = function () { if (typeof bdRedo === 'function') bdRedo(); };
  }
  // ツールバーの取り消し・やり直しボタン（data-undo-button / data-redo-button）の
  // disabled 状態を _bdUndoStack/_bdRedoStack の長さから一括更新する。
  // bdPushUndo/bdUndo/bdRedo/bdClearUndoStacks は既にこの名前の関数を呼ぶ実装になっている
  // （gb-canvas-engine.part04.js）。
  if (typeof window.updateUndoRedoButtonStates !== 'function') {
    window.updateUndoRedoButtonStates = function () {
      const canUndo = typeof _bdUndoStack !== 'undefined' && _bdUndoStack.length > 0;
      const canRedo = typeof _bdRedoStack !== 'undefined' && _bdRedoStack.length > 0;
      document.querySelectorAll('[data-undo-button]').forEach((btn) => { btn.disabled = !canUndo; });
      document.querySelectorAll('[data-redo-button]').forEach((btn) => { btn.disabled = !canRedo; });
    };
  }

  // --- 詳細パネル系のダミー ---------------------------------------------------
  // ボードは選択カードの詳細を右側パネルに表示しようとする。
  // 単独アプリでは右側パネルが無いので、関連関数はすべて no-op で吸収。
  const detailNoOps = [
    'showNoteTabs', 'showDbTabs', 'showCalendarDetailTabs',
    'showPublishDetailTab', 'hideScriptnoteDetailTabs',
    'switchDetailTab', 'openDetailPanel', 'closeDetailPanel',
  ];
  detailNoOps.forEach((name) => {
    if (typeof window[name] !== 'function') window[name] = function () {};
  });

  function _standaloneCurrentBoardPath() {
    return String((typeof window.bd !== 'undefined' && window.bd?.path)
      || window.state?.currentBoardPath
      || '').trim();
  }

  function _ensureStandaloneRightSidebar() {
    try {
      const api = window.MeldexBoardStandalone;
      if (api && typeof api.isOptionsPanelVisible === 'function' && !api.isOptionsPanelVisible()) {
        api.toggleOptionsPanel?.();
      }
    } catch (e) {}
  }

  function _clearPreviewPane() {
    const pane = document.getElementById('gb-preview-pane');
    if (pane) pane.textContent = '';
    return pane;
  }

  // 右サイドバー「ビューワー」区画は、リンクプレビュー（#gb-preview-pane）と
  // コメント一覧（#rp-annotation、本体と同じ構造。gb-right-panel.js 同梱で
  // loadRpAnnotationList() 等をそのまま使う）を hidden 属性で切り替えて共有する。
  function _showBoardViewerMode(mode) {
    const preview = document.getElementById('gb-preview-pane');
    const annotation = document.getElementById('rp-annotation');
    if (preview) preview.hidden = mode === 'annotation';
    if (annotation) annotation.hidden = mode !== 'annotation';
  }

  function _showBoardViewerPreview() {
    _showBoardViewerMode('preview');
  }
  window.showBoardViewerPreview = _showBoardViewerPreview;

  // 簡易フォールバック（本体版 loadRpAnnotationList/gb-right-panel.js が
  // 何らかの理由で読み込まれていない場合の保険。通常は本体版が
  // window.loadRpAnnotationList を上書きするため使われない）。
  async function _renderStandaloneAnnotationListFallback() {
    _ensureStandaloneRightSidebar();
    _showBoardViewerMode('annotation');
    const list = document.getElementById('rp-ann-list');
    if (!list) return false;
    list.textContent = '';
    const title = document.createElement('div');
    title.className = 'bd-preview-card';
    const path = _standaloneCurrentBoardPath();
    let rows = [];
    try {
      const query = path ? '?target=' + encodeURIComponent(path) + '&limit=200' : '?limit=200';
      rows = await window.apiFetch('/annotations' + query);
    } catch (e) {}
    const comments = (Array.isArray(rows) ? rows : [])
      .filter(row => row && row.type === 'comment')
      .sort((a, b) => String(b.modified || b.created || '').localeCompare(String(a.modified || a.created || '')));
    if (!comments.length) {
      const empty = document.createElement('div');
      empty.className = 'bd-preview-body';
      empty.textContent = 'コメントはありません。';
      title.appendChild(empty);
    } else {
      comments.forEach(row => {
        const item = document.createElement('div');
        item.className = 'bd-preview-body';
        item.style.whiteSpace = 'pre-wrap';
        item.style.borderTop = '1px solid var(--border)';
        item.style.paddingTop = '8px';
        item.style.marginTop = '8px';
        item.textContent = String(row.body || row.data || '').trim() || '(空)';
        title.appendChild(item);
      });
    }
    list.appendChild(title);
    return true;
  }

  function _openStandalonePanel(tabName) {
    if (tabName === 'annotation') {
      _ensureStandaloneRightSidebar();
      _showBoardViewerMode('annotation');
      if (typeof window.loadRpAnnotationList === 'function') window.loadRpAnnotationList();
      else _renderStandaloneAnnotationListFallback();
      return true;
    }
    if (tabName === 'preview' || tabName === 'detail') {
      _ensureStandaloneRightSidebar();
      return true;
    }
    return false;
  }

  // gb-right-panel.js（loadRpAnnotationList等のコメント一覧本体ロジック目的で同梱）は
  // 本体の3カラム右パネル（#right-panel, #right-resize-handle）の存在を前提に
  // toggleRightPanelTab/openRightPanelTab を再定義してしまい、単独版ボードでは
  // 存在しない要素への null 参照で例外になる。board-standalone-app.js（最後に読み込む）
  // 側でこの関数を単独版向けに上書きし直すため、ここでは _openStandalonePanel を
  // 公開しておく。
  window._bsaOpenStandalonePanel = _openStandalonePanel;

  if (typeof window.openRightPanelTab !== 'function') {
    window.openRightPanelTab = function (tabName) { return _openStandalonePanel(tabName); };
  }
  if (typeof window.toggleRightPanelTab !== 'function') {
    window.toggleRightPanelTab = function (tabName) { return _openStandalonePanel(tabName); };
  }
  if (typeof window.loadRpAnnotationList !== 'function') {
    window.loadRpAnnotationList = function () { return _renderStandaloneAnnotationListFallback(); };
  }

  function _standaloneOpenLinkedPath(path, label, options) {
    _ensureStandaloneRightSidebar();
    _showBoardViewerMode('preview');
    if (typeof window.bdShowLinkedSelectionPreview === 'function') {
      window.bdShowLinkedSelectionPreview(path, options?.linkType || options?.type || '');
      return true;
    }
    const pane = _clearPreviewPane();
    if (!pane) return false;
    const card = document.createElement('div');
    card.className = 'bd-preview-card';
    const title = document.createElement('div');
    title.className = 'bd-preview-title';
    title.textContent = label || path || 'リンク';
    const body = document.createElement('div');
    body.className = 'bd-preview-path';
    body.textContent = String(path || '');
    card.append(title, body);
    pane.appendChild(card);
    return true;
  }
  window._bsaOpenLinkedPathInSidebar = _standaloneOpenLinkedPath;

  function _showStandaloneLinkDestinationDialog(path, label, options) {
    const targetPath = String(path || '').trim();
    if (!targetPath) {
      window.showStatus?.('リンク先が指定されていません', true);
      return false;
    }
    const parity = window.MeldexStandaloneParity;
    if (typeof parity?.openTarget !== 'function' || typeof window.GBUI?.createModal !== 'function') {
      window.showStatus?.('表示先を選択する機能を読み込めませんでした。アプリを再読み込みしてください', true);
      return false;
    }
    const existing = document.querySelector('[data-e2e-id="board-standalone-link-destination-overlay"]');
    if (existing?._boardStandaloneLinkDestinationApi?.isOpen?.()) {
      existing._boardStandaloneLinkDestinationApi.modal.focus?.();
      return true;
    }
    const description = document.createElement('p');
    description.className = 'bsa-link-destination-description';
    description.textContent = `${String(label || targetPath)} をどこに表示するか選んでください。`;
    const actions = document.createElement('div');
    actions.className = 'standalone-parity-actions';
    const reason = document.createElement('div');
    reason.className = 'bsa-link-destination-reason';
    reason.dataset.e2eId = 'board-standalone-link-destination-reason';
    reason.setAttribute('role', 'status');
    reason.setAttribute('aria-live', 'polite');
    const content = document.createElement('div');
    content.className = 'bsa-link-destination-content';
    content.append(description, actions, reason);
    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'gb-btn';
    back.dataset.e2eId = 'board-standalone-open-back';
    back.textContent = '戻る';
    const focusReturn = document.activeElement;
    let openBusy = false;
    const modalApi = window.GBUI.createModal({
      id: 'board-standalone-link-destination',
      titleId: 'board-standalone-link-destination-title',
      title: '表示先を選択',
      body: content,
      footer: back,
      variant: 'standard',
      extraClass: 'standalone-parity-dialog',
      geometryKey: 'board-standalone-link-destination',
      minWidth: '0',
      initialFocus: () => actions.querySelector('button:not([disabled])') || back,
      returnFocus: () => focusReturn,
      closeLabel: '表示先の選択を閉じる',
      closeOnEsc: true,
      closeOnOverlay: true,
      onBeforeClose: closeReason => !openBusy || ['opened', 'test-cleanup'].includes(closeReason),
    });
    modalApi.overlay.classList.add('modal-overlay', 'standalone-parity-overlay', 'bsa-link-destination-overlay');
    modalApi.overlay.dataset.e2eId = 'board-standalone-link-destination-overlay';
    modalApi.overlay._boardStandaloneLinkDestinationApi = modalApi;
    modalApi.modal.classList.add('bsa-link-destination-dialog');
    modalApi.modal.dataset.e2eId = 'board-standalone-link-destination-dialog';
    modalApi.modal.dataset.path = targetPath;
    modalApi.header.querySelector('.gb-modal-close')?.setAttribute(
      'data-e2e-id',
      'board-standalone-link-destination-header-close',
    );
    const target = {
      path: targetPath,
      label: String(label || ''),
      linkType: String(options?.linkType || options?.type || ''),
    };
    const destinationButtons = [];
    const setReason = (message, error = false) => {
      reason.textContent = message || '';
      reason.classList.toggle('bsa-link-destination-reason-error', error);
    };
    const setBusy = busy => {
      openBusy = busy;
      destinationButtons.forEach(button => {
        button.disabled = busy || button.dataset.capabilityDisabled === '1';
      });
      back.disabled = busy;
      modalApi.modal.setAttribute('aria-busy', busy ? 'true' : 'false');
    };
    const setCapabilityAvailable = (button, available) => {
      button.dataset.capabilityDisabled = available ? '0' : '1';
      button.disabled = openBusy || !available;
    };
    const addDestination = (destination, text, primary) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = primary ? 'gb-btn gb-btn-primary' : 'gb-btn';
      button.dataset.e2eId = `board-standalone-open-${destination}`;
      button.textContent = text;
      button.style.minWidth = '44px';
      button.style.minHeight = '44px';
      button.addEventListener('click', async () => {
        if (openBusy) return;
        setBusy(true);
        setReason(`${text}を開いています…`);
        try {
          const opened = await parity.openTarget(target, destination, {
            label: target.label,
            linkType: target.linkType,
          });
          if (!modalApi.isOpen()) return;
          if (opened !== false) {
            modalApi.close('opened');
            return;
          }
          setReason('この表示先を利用できません。別の表示先を選んでください。', true);
        } catch (error) {
          if (modalApi.isOpen()) setReason(error?.message || 'リンク先を開けませんでした。', true);
        } finally {
          if (modalApi.isOpen()) setBusy(false);
        }
      });
      actions.appendChild(button);
      destinationButtons.push(button);
      return button;
    };
    addDestination('float', '現在の副画面で開く', true);
    const newButton = addDestination('new', '新規ウィンドウで開く', false);
    const mainButton = addDestination('main', 'Meldex本体で開く', false);
    back.addEventListener('click', () => modalApi.close('back'));
    modalApi.open();

    const nativeMode = new URLSearchParams(window.location?.search || '').get('native') === '1';
    if (nativeMode && typeof parity.capabilities !== 'function') {
      setCapabilityAvailable(newButton, false);
      setCapabilityAvailable(mainButton, false);
      reason.textContent = 'アプリの起動可否を確認できません。Meldexを再起動してください。';
    } else if (nativeMode) {
      setCapabilityAvailable(newButton, false);
      setCapabilityAvailable(mainButton, false);
      reason.textContent = '利用できるアプリを確認しています…';
      Promise.resolve(parity.capabilities()).then(capabilities => {
        if (!modalApi.isOpen()) return;
        const allowed = Array.isArray(capabilities?.allowedTargets) ? capabilities.allowedTargets : [];
        const resolvedType = String(parity.resolveTarget?.(targetPath, target)?.type || target.linkType || '');
        const targetApp = ({
          page: 'note',
          document: 'note',
          scriptnote: 'scenario',
          scenario: 'scenario',
          board: 'board',
          pivot: 'sheet',
          database: 'sheet',
          sheet: 'sheet',
          tree: 'sheet',
          gallery: 'sheet',
          kanban: 'sheet',
          timeline: 'sheet',
          chart: 'sheet',
          graph: 'sheet',
          timer: 'timer',
          media: 'viewer',
          html: 'viewer',
        })[resolvedType] || '';
        const mainAvailable = capabilities?.targets?.main?.available === true && allowed.includes('main');
        const targetAvailable = !!targetApp
          && capabilities?.targets?.[targetApp]?.available === true
          && allowed.includes(targetApp);
        setCapabilityAvailable(mainButton, mainAvailable);
        setCapabilityAvailable(newButton, targetAvailable);
        reason.textContent = mainAvailable || !newButton.disabled
          ? ''
          : (capabilities?.targets?.[targetApp]?.reason
            || capabilities?.targets?.main?.reason
            || capabilities?.error?.message
            || `対応するアプリを利用できません${targetApp ? `（${targetApp}）` : ''}`);
      }).catch(error => {
        if (!modalApi.isOpen()) return;
        setReason(error?.message || '利用できるアプリを確認できませんでした。', true);
      });
    }
    return true;
  }
  window._bsaShowLinkDestinationDialog = _showStandaloneLinkDestinationDialog;

  if (typeof window.openLinkInFloatPanel !== 'function') {
    window.openLinkInFloatPanel = function (path, label, options) {
      return _standaloneOpenLinkedPath(path, label, options || {});
    };
  }
  if (typeof window.openLink !== 'function') {
    window.openLink = function (path, label) {
      return _standaloneOpenLinkedPath(path, label, {});
    };
  }
  if (typeof window.navOpen !== 'function') {
    window.navOpen = function (entry) {
      if (!entry) return false;
      return _standaloneOpenLinkedPath(entry.path || '', entry.label || entry.name || '', { linkType: entry.type || '' });
    };
  }

  if (typeof window.addCommentHere !== 'function') {
    window.addCommentHere = async function (override) {
      const ctx = override || {};
      const body = await window.cfPrompt('コメント本文', '', { okLabel: '追加' });
      const text = String(body || '').trim();
      if (!text) return false;
      const filePath = String(ctx.filePath || _standaloneCurrentBoardPath());
      try {
        await window.apiPost('/annotations', {
          type: 'comment',
          target_path: filePath,
          target_kind: String(ctx.targetKind || ''),
          target_ref: ctx.targetRef || {},
          body: text,
          data: { type: 'comment', text },
        });
        if (typeof window.showStatus === 'function') window.showStatus('コメントを追加しました');
        return true;
      } catch (e) {
        if (typeof window.showStatus === 'function') window.showStatus('コメント追加に失敗しました', true);
        return false;
      }
    };
  }

  // --- リンク先タイプ判定の API 代替 ------------------------------------------
  // 本体ではサーバー /api/check-type に問い合わせるが、単独アプリでは拡張子から推測のみ。
  if (typeof window._bdFetchLinkedType !== 'function') {
    window._bdFetchLinkedType = async function () { return ''; };
  }
  if (typeof window.applyAutoLinks !== 'function') {
    window.applyAutoLinks = function (html) { return html; };
  }
  if (typeof window.getFontFamilyOptions !== 'function') {
    window.getFontFamilyOptions = function (currentValue) {
      const cur = String(currentValue || '');
      const selected = cur ? '' : ' selected';
      return '<option value=""' + selected + '>既定に従う</option>'
        + '<option value="system-ui, sans-serif"' + (cur === 'system-ui, sans-serif' ? ' selected' : '') + '>システム</option>';
    };
  }
  if (typeof window.normalizeFontFamilyValue !== 'function') {
    window.normalizeFontFamilyValue = function (value) { return String(value || '').trim(); };
  }

  // --- アイコン関数の素朴な保険 ----------------------------------------------
  // 通常は vendor/lucide-icons.js が lucide() を提供するが、読み込み失敗時の保険。
  if (typeof window.lucide !== 'function') {
    window.lucide = function () { return ''; };
  }

  // --- 重い処理前のローディング表示（任意機能） --------------------------------
  if (typeof window.showLoadingBeforeHeavyWork !== 'function') {
    window.showLoadingBeforeHeavyWork = async function () {};
  }

  // --- 単独アプリ向けの「読み込み中ガード」-------------------------------------
  // 本体には navNavigating 等のフラグがある。ボードは参照しないが、安全のため定義。
  if (typeof window.navNavigating === 'undefined') window.navNavigating = false;

  // --- ブロードキャスト系（複数ウィンドウ間通信）の no-op -----------------------
  if (typeof window.GBBroadcast === 'undefined') {
    window.GBBroadcast = {
      post: function () {},
      on: function () { return function () {}; },
    };
  }
  if (typeof window.MeldexBroadcast === 'undefined') {
    window.MeldexBroadcast = {
      copyMeldexLink: async function (label, path, type) {
        const text = `[${String(label || path || 'リンク')}](${String(path || '')})`;
        try {
          if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(text);
          } else {
            const ta = document.createElement('textarea');
            ta.value = text;
            ta.style.position = 'fixed';
            ta.style.left = '-9999px';
            document.body.appendChild(ta);
            ta.focus();
            ta.select();
            document.execCommand('copy');
            ta.remove();
          }
          return true;
        } catch (e) {
          return false;
        }
      },
    };
  }
})();
