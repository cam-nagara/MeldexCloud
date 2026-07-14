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
      return new Promise(resolve => {
        const restoreFocusTo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        const idBase = 'bsa-cf-prompt-' + (++promptSeq);
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.style.zIndex = '300';
        overlay.dataset.e2eId = 'cf-prompt-overlay';
        const dialog = document.createElement('div');
        dialog.className = 'gb-confirm';
        dialog.id = idBase + '-dialog';
        dialog.dataset.e2eId = 'cf-prompt-dialog';
        dialog.setAttribute('role', 'dialog');
        dialog.setAttribute('aria-modal', 'true');
        dialog.setAttribute('aria-label', '入力');
        dialog.setAttribute('aria-describedby', idBase + '-message');
        const body = document.createElement('div');
        body.className = 'gb-confirm-message';
        body.id = idBase + '-message';
        body.textContent = String(message || '');
        const input = document.createElement('input');
        input.type = 'text';
        input.id = '_gb-prompt-input';
        input.className = 'gb-confirm-input';
        input.value = String(defaultValue ?? '');
        const actions = document.createElement('div');
        actions.className = 'gb-confirm-actions';
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
        actions.append(cancel, ok);
        dialog.append(body, input, actions);
        overlay.appendChild(dialog);
        document.body.appendChild(overlay);
        let done = false;
        const cleanup = value => {
          if (done) return;
          done = true;
          overlay.remove();
          document.removeEventListener('keydown', onDocumentKeydown, true);
          const restoreFocus = () => {
            if (restoreFocusTo?.isConnected && !overlay.contains(restoreFocusTo)) restoreFocusTo.focus?.();
          };
          restoreFocus();
          setTimeout(restoreFocus, 0);
          resolve(value);
        };
        function onDocumentKeydown(event) {
          if (event.key !== 'Escape') return;
          event.preventDefault();
          cleanup(null);
        }
        ok.addEventListener('click', () => cleanup(input.value));
        cancel.addEventListener('click', () => cleanup(null));
        overlay.addEventListener('click', event => { if (event.target === overlay) cleanup(null); });
        input.addEventListener('keydown', event => {
          if (event.key === 'Enter') {
            event.preventDefault();
            cleanup(input.value);
          }
          if (event.key === 'Escape') {
            event.preventDefault();
            cleanup(null);
          }
        });
        document.addEventListener('keydown', onDocumentKeydown, true);
        input.focus();
        input.select();
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
      const safeLabel = typeof window.esc === 'function'
        ? window.esc(label)
        : label.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
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
    const refreshPaneNode = function () {
      paneNode.tabs = [_standaloneBoardTab()];
      paneNode.activeTabIndex = 0;
      return paneNode;
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

  // --- テーマ系のダミー -----------------------------------------------------
  if (typeof window.MeldexThemeManager === 'undefined') {
    window.MeldexThemeManager = {
      applyBoardThemeRuntime: function () {},
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

  // --- ファイルスタイル系のダミー ---------------------------------------------
  // 本体ではノート/ボード固有のテーマを部分適用する仕組みがあるが、単独アプリでは不要。
  if (typeof window.applyFileStyleToPanel !== 'function') {
    window.applyFileStyleToPanel = function () {};
  }
  if (typeof window.clearFileStyleForPanel !== 'function') {
    window.clearFileStyleForPanel = function () {};
  }
  if (typeof window.clearFileStyle !== 'function') {
    window.clearFileStyle = function () {};
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

  async function _renderStandaloneAnnotationList() {
    _ensureStandaloneRightSidebar();
    const pane = _clearPreviewPane();
    if (!pane) return false;
    const title = document.createElement('div');
    title.className = 'bd-preview-card';
    const head = document.createElement('div');
    head.className = 'bd-preview-title';
    head.textContent = 'コメント一覧';
    title.appendChild(head);
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
    pane.appendChild(title);
    return true;
  }

  function _openStandalonePanel(tabName) {
    if (tabName === 'annotation') {
      _renderStandaloneAnnotationList();
      return true;
    }
    if (tabName === 'preview' || tabName === 'detail') {
      _ensureStandaloneRightSidebar();
      return true;
    }
    return false;
  }

  if (typeof window.openRightPanelTab !== 'function') {
    window.openRightPanelTab = function (tabName) { return _openStandalonePanel(tabName); };
  }
  if (typeof window.toggleRightPanelTab !== 'function') {
    window.toggleRightPanelTab = function (tabName) { return _openStandalonePanel(tabName); };
  }
  if (typeof window.loadRpAnnotationList !== 'function') {
    window.loadRpAnnotationList = function () { return _renderStandaloneAnnotationList(); };
  }

  function _standaloneOpenLinkedPath(path, label, options) {
    _ensureStandaloneRightSidebar();
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

  if (typeof window.openLinkInSubPanel !== 'function') {
    window.openLinkInSubPanel = function (path, label, options) {
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
