/* ==============================
   gb-subpanel.js: 右サイドバー常設「サブパネル」

   計画書: app/docs/subpanel-floatpanel-dialog-keyboard-plan_2026-07-31.md
     「確定仕様 > サブパネル」「実装構成 > 右レールとタブ」節

   右レールの固定タブ(`subpanel`)本体。パネル自体は常設だが、表示対象は
   一時状態（レイアウト保存・作品ファイルへは保存しない）。一度に1件表示し、
   別の対象を開くと置換する。同一セッション中の戻る/進む履歴を持つ。

   外枠(見出し・戻る/進む・「メインパネルで開く」・本文)は `createRootElement()`
   が生成する持続DOM（#gb-subpanel-root）で、gb-pane-bridge.part01.part01.js の
   `_createLegacyStorage()` から他の固定右レール項目(preview/detail等)と
   同じ仕組みで初回生成・退避・移動される。内容の表示は GBFloatPanel と同じ
   「共通副画面ホスト」契約（`GBPaneBridge.mountVirtualPane(pane, contentEl,
   { surface: 'subpanel' })`）を使う仮想ペインマウントで行う。
   ============================== */

const GBSubPanel = (() => {
  const ROOT_ID = 'gb-subpanel-root';
  const CONTENT_ID = 'gb-subpanel-content';
  const INNER_PANE_ID = 'gb-subpanel-inner-pane';
  const EMPTY_MESSAGE = 'リンクのメニューから「右サイドバーで開く」を選ぶと、ここに表示されます。';
  const DB_VIEW_TYPES = new Set(['database', 'db', 'pivot', 'tree', 'gallery', 'kanban', 'timeline', 'chart', 'graph', 'form']);
  const MAX_HISTORY = 50;

  let _root = null;
  let _titleIconEl = null;
  let _titleTextEl = null;
  let _backBtn = null;
  let _forwardBtn = null;
  let _promoteBtn = null;
  let _closeContentBtn = null;
  let _pathBarEl = null;
  let _contentEl = null;
  let _pane = null;
  let _current = null;
  let _navHistory = [];
  let _navIndex = -1;
  let _opSeq = 0;
  let _loadFailureObserver = null;

  function _basename(path) {
    return String(path || '').split(/[\\/]/).filter(Boolean).pop() || '';
  }

  function _toolLabel(type) {
    if (typeof GBPaneBridge !== 'undefined' && typeof GBPaneBridge.toolLabel === 'function') {
      return GBPaneBridge.toolLabel(type) || type || '';
    }
    return type || '';
  }

  function _tabIcon(type) {
    if (typeof GBTabs !== 'undefined' && typeof GBTabs.tabIcon === 'function') return GBTabs.tabIcon(type);
    return 'panelRight';
  }

  function _isMobileDrawerEnabled() {
    const drawer = window.MeldexCloudMobileSideDrawer;
    return !!(drawer && typeof drawer.isEnabled === 'function' && drawer.isEnabled());
  }

  // スマートフォンでは固定右レールを増やさず、同じ仮想ペインDOMを既存の
  // 右サイドドロワーへ一時移動する。旧 openBoardLink() プレビューへは委譲しない。
  function _openMobileDrawer(entry) {
    const drawer = window.MeldexCloudMobileSideDrawer;
    if (!_isMobileDrawerEnabled() || !entry?.path || typeof drawer.openElement !== 'function') return false;
    const root = _ensureRootInDocument();
    if (!root?.parentNode) return false;
    return drawer.openElement('サブパネル', root, {
      kind: 'panel',
      beforeClose: _closeForMobileDrawer,
    }) === true;
  }

  function _mainPaneId() {
    if (typeof GBPaneDefaultLayout !== 'undefined' && typeof GBPaneDefaultLayout.resolveMainPaneId === 'function') {
      const paneId = GBPaneDefaultLayout.resolveMainPaneId({ contentOnly: true });
      if (paneId) return paneId;
    }
    return (typeof GBLayout !== 'undefined' ? GBLayout.activePane : '') || '';
  }

  // ---- 対象の正規化（既に解決済みならそのまま使い、未解決ならルーターへ委ねる） ----
  async function _normalizeTarget(target) {
    let entry;
    if (target && typeof target === 'object' && target.type) {
      entry = {
        type: target.type,
        path: String(target.path || '').trim(),
        label: target.label || _basename(target.path) || _toolLabel(target.type),
        state: target.state || {},
        external: !!target.external,
      };
    } else if (typeof GBLinkRouter === 'undefined' || typeof GBLinkRouter.resolveAsync !== 'function') {
      const path = (target && typeof target === 'object') ? String(target.path || '').trim() : String(target || '').trim();
      entry = { type: 'unsupported', path, label: _basename(path), state: {} };
    } else {
      entry = await GBLinkRouter.resolveAsync(target);
    }
    if (entry.path && typeof GBLinkRouter !== 'undefined' && typeof GBLinkRouter.isExternalUrl === 'function'
        && GBLinkRouter.isExternalUrl(entry.path)) {
      entry.external = true;
    }
    if (!entry.external && entry.path && entry.type !== 'unsupported'
        && typeof GBLinkRouter !== 'undefined' && typeof GBLinkRouter.checkAvailability === 'function') {
      entry.availability = await GBLinkRouter.checkAvailability(entry.path);
    }
    return entry;
  }

  // ---- 保存キューのflush（対象置換・戻る/進む・閉じる・メイン昇格の前に必須） ----
  async function _flushBeforeTransition(entry) {
    if (!entry || !entry.path) return { ok: true };
    const type = entry.type || '';
    try {
      if (type === 'page' && typeof flushPendingEditorAutosave === 'function') {
        const settled = await Promise.resolve(flushPendingEditorAutosave());
        const failed = Array.isArray(settled) && settled.some(item => item?.status === 'rejected');
        return { ok: !failed };
      }
      if (type === 'entity' && _contentEl) {
        const entityRoot = _contentEl.querySelector('[data-meldex-entity-detail]');
        const controller = entityRoot?._meldexEntityDetailController;
        if (controller && typeof controller.flush === 'function') {
          const ok = await controller.flush();
          return { ok: ok !== false };
        }
        return { ok: true };
      }
      if (DB_VIEW_TYPES.has(type)) {
        if (typeof waitForPendingDbValueMutations === 'function') await waitForPendingDbValueMutations(entry.path);
        if (typeof flushPendingDbPropertySettings === 'function') await flushPendingDbPropertySettings(entry.path);
        if (typeof flushPendingDbViewConfigBackendSave === 'function') await flushPendingDbViewConfigBackendSave(entry.path);
        if (typeof waitForPendingDbValueMutations === 'function') await waitForPendingDbValueMutations(entry.path);
        return { ok: true };
      }
      if (type === 'board') {
        if (typeof bd !== 'undefined' && bd?.dirty && bd?.path === entry.path && typeof bdSave === 'function') {
          if (window._bdTimer) clearTimeout(window._bdTimer);
          window._bdTimer = null;
          const ok = await Promise.resolve(bdSave());
          return { ok: ok !== false };
        }
        return { ok: true };
      }
      // シナリオ: ScriptNoteComponent.flush()（gb-tool-scriptnote.js）が公開する
      // 遷移前flush契約。保留中の自動保存タイマーを即座に実行し保存する。
      if (type === 'scriptnote') {
        const tabId = _pane?.tabs?.[0]?.id || '';
        if (tabId && typeof getComponentInstance === 'function') {
          const comp = getComponentInstance(tabId);
          if (comp && typeof comp.flush === 'function') {
            const ok = await comp.flush();
            return { ok: ok !== false };
          }
        }
        return { ok: true };
      }
    } catch (e) {
      return { ok: false };
    }
    return { ok: true };
  }

  // ---- 既存内容の破棄（GBFloatPanel の _retractCurrentContent 相当） ----
  function _retractCurrentContent(options) {
    const opts = options || {};
    if (!_contentEl) return Promise.resolve();
    _stopLoadFailureObserver();
    const content = _contentEl;
    const disposals = [...content.querySelectorAll('[data-meldex-entity-detail]')]
      .map(root => Promise.resolve(root._meldexEntityDetailController?.dispose?.()).catch(() => false));
    return Promise.allSettled(disposals).then(() => {
      if (_pane) {
        if (typeof GBPaneBridge !== 'undefined' && typeof GBPaneBridge.retractPaneContent === 'function') {
          GBPaneBridge.retractPaneContent(_pane.id);
        }
        const tabId = _pane.tabs?.[0]?.id || '';
        if (tabId && typeof removeComponentInstance === 'function') removeComponentInstance(tabId);
        if (typeof GBLayout !== 'undefined' && GBLayout.paneMap) delete GBLayout.paneMap[_pane.id];
      }
      _pane = null;
      content.replaceChildren();
      if (opts.remount && typeof GBPaneBridge !== 'undefined' && typeof GBPaneBridge.mountAllPanes === 'function') {
        GBPaneBridge.mountAllPanes();
      }
    });
  }

  // flush → 中断判定 → 既存内容の破棄、を経てから fn() で次の状態を描画する共通ガード。
  // seq は「読込中に別対象が選択された」「操作が別の操作に追い越された」場合に
  // 古い方の続きを打ち切るための世代トークン。
  async function _guardedTransition(seq, fn) {
    const flushResult = await _flushBeforeTransition(_current);
    if (seq !== _opSeq) return false;
    if (!flushResult.ok) {
      if (typeof showStatus === 'function') showStatus('保存を確認できませんでした。もう一度お試しください', true);
      return false;
    }
    await _retractCurrentContent({ remount: true });
    if (seq !== _opSeq) return false;
    return fn();
  }

  function _pushHistory(entry) {
    _navHistory.length = _navIndex + 1;
    _navHistory.push(entry);
    _navIndex = _navHistory.length - 1;
    if (_navHistory.length > MAX_HISTORY) {
      const overflow = _navHistory.length - MAX_HISTORY;
      _navHistory.splice(0, overflow);
      _navIndex -= overflow;
    }
  }

  function _updateNavUi() {
    if (_backBtn) _backBtn.disabled = _navIndex <= 0;
    if (_forwardBtn) _forwardBtn.disabled = _navIndex >= _navHistory.length - 1;
  }

  function _updateHeader(entry) {
    if (_titleIconEl) _titleIconEl.innerHTML = typeof lucide === 'function' ? lucide(_tabIcon(entry.type), 16) : '';
    if (_titleTextEl) _titleTextEl.textContent = entry.label || _toolLabel(entry.type);
    if (_promoteBtn) _promoteBtn.hidden = !entry.path || entry.type === 'unsupported';
    if (_closeContentBtn) _closeContentBtn.hidden = false;
    if (_pathBarEl) {
      _pathBarEl.textContent = entry.path ? _basename(entry.path) : '';
      _pathBarEl.title = entry.path || '';
      _pathBarEl.style.display = entry.path ? '' : 'none';
    }
    if (typeof replaceIcons === 'function') replaceIcons();
  }

  function _renderErrorState(entry, message) {
    if (!_contentEl) return;
    _stopLoadFailureObserver();
    _contentEl.replaceChildren();
    const box = document.createElement('div');
    box.className = 'gb-subpanel-error';
    box.dataset.testid = 'gb-subpanel-error';
    const msg = document.createElement('div');
    msg.className = 'gb-subpanel-error-message';
    msg.textContent = message;
    box.appendChild(msg);
    if (entry.path) {
      const pathLine = document.createElement('div');
      pathLine.className = 'gb-subpanel-error-path';
      pathLine.textContent = entry.path;
      box.appendChild(pathLine);
    }
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'gb-subpanel-error-retry';
    retry.dataset.testid = 'gb-subpanel-retry';
    retry.dataset.e2eId = 'gb-subpanel-retry';
    retry.textContent = '再読み込み';
    retry.addEventListener('click', async () => {
      if (retry.disabled) return;
      retry.disabled = true;
      retry.setAttribute('aria-busy', 'true');
      const opened = await open(entry);
      // 成功時はエラーDOMごと置き換わる。保存失敗や別操作による中断で
      // このボタンが残った場合だけ、再操作できる状態へ戻す。
      if (opened === false && retry.isConnected) {
        retry.disabled = false;
        retry.removeAttribute('aria-busy');
      }
    });
    box.appendChild(retry);
    _contentEl.appendChild(box);
    if (typeof replaceIcons === 'function') replaceIcons();
  }

  function _createInnerPane(entry) {
    const tab = typeof GBTabs !== 'undefined' && typeof GBTabs.createTab === 'function'
      ? GBTabs.createTab(entry.label, entry.type, entry.path || '', entry.state || null)
      : {
        id: 'subpanel-tab-' + Date.now().toString(36),
        type: entry.type,
        label: entry.label || '(無題)',
        path: entry.path || '',
        state: entry.state || {},
      };
    return { id: INNER_PANE_ID, type: 'pane', tabs: [tab], activeTabIndex: 0 };
  }

  function _registerPaneMap() {
    if (!_pane || !_contentEl || typeof GBLayout === 'undefined' || !GBLayout.paneMap) return;
    GBLayout.paneMap[_pane.id] = { node: _pane, el: _root, contentEl: _contentEl };
  }

  function _mountVirtualEntry(entry) {
    _pane = _createInnerPane(entry);
    _registerPaneMap();
    if (typeof GBPaneBridge === 'undefined' || typeof GBPaneBridge.mountVirtualPane !== 'function') return false;
    return GBPaneBridge.mountVirtualPane(_pane, _contentEl, { surface: 'subpanel' });
  }

  function _mountEntity(entry) {
    const root = document.createElement('div');
    root.className = 'gb-subpanel-entity-root';
    root.dataset.gbSubpanelEntityRoot = 'true';
    _contentEl.appendChild(root);
    if (window.MeldexEntityDetail?.mount) {
      window.MeldexEntityDetail.mount({ root, path: entry.path, surface: 'subpanel' });
      return true;
    }
    root.textContent = 'エントリを表示できません';
    return false;
  }

  function _stopLoadFailureObserver() {
    _loadFailureObserver?.disconnect?.();
    _loadFailureObserver = null;
  }

  function _hasReportedLoadFailure() {
    return !!_contentEl?.querySelector?.('[data-load-failed="1"]');
  }

  function _watchForLoadFailure(entry) {
    _stopLoadFailureObserver();
    if (typeof MutationObserver === 'undefined' || !_contentEl) return;
    const watchedPath = entry.path;
    let handling = false;
    const handle = async () => {
      if (handling || !_hasReportedLoadFailure() || _current?.path !== watchedPath) return;
      handling = true;
      const seq = ++_opSeq;
      await _retractCurrentContent({ remount: true });
      if (seq !== _opSeq || _current?.path !== watchedPath) return;
      _renderErrorState(entry, 'ファイルを読み込めませんでした');
      _current = entry;
    };
    _loadFailureObserver = new MutationObserver(() => { handle(); });
    _loadFailureObserver.observe(_contentEl, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['data-load-failed'],
    });
    Promise.resolve().then(handle);
  }

  function _renderTarget(entry) {
    if (!_contentEl) return;
    _contentEl.replaceChildren();
    _updateHeader(entry);
    if (entry.availability?.checked && entry.availability.exists === false) {
      _renderErrorState(entry, 'ファイルが見つかりません');
      _current = entry;
      return;
    }
    if (entry.type === 'unsupported') {
      _renderErrorState(entry, 'この形式はサブパネルに対応していません');
      _current = entry;
      return;
    }
    if (entry.type === 'entity') {
      const mounted = _mountEntity(entry);
      _current = entry;
      if (!mounted) {
        _renderErrorState(entry, '読み込みに失敗しました');
        return;
      }
      _watchForLoadFailure(entry);
      return;
    }
    const mounted = _mountVirtualEntry(entry);
    _current = entry;
    if (!mounted) {
      _renderErrorState(entry, '読み込みに失敗しました');
      return;
    }
    _watchForLoadFailure(entry);
  }

  function _showEmptyState() {
    if (!_contentEl) return;
    _stopLoadFailureObserver();
    _contentEl.replaceChildren();
    const empty = document.createElement('div');
    empty.className = 'gb-subpanel-empty';
    empty.dataset.testid = 'gb-subpanel-empty';
    empty.textContent = EMPTY_MESSAGE;
    _contentEl.appendChild(empty);
    if (_titleTextEl) _titleTextEl.textContent = 'サブパネル';
    if (_titleIconEl) _titleIconEl.innerHTML = typeof lucide === 'function' ? lucide('panelRight', 16) : '';
    if (_promoteBtn) _promoteBtn.hidden = true;
    if (_closeContentBtn) _closeContentBtn.hidden = true;
    if (_pathBarEl) _pathBarEl.style.display = 'none';
    _updateNavUi();
    if (typeof replaceIcons === 'function') replaceIcons();
  }

  // ---- 持続DOMの生成（初回のみ。gb-pane-bridge.part01.part01.js の
  //      _createLegacyStorage() から呼ばれる。以後は他の固定右レール項目と
  //      同じ仕組みで退避・移動される） ----
  function createRootElement() {
    if (_root) return _root;
    const root = document.createElement('section');
    root.id = ROOT_ID;
    root.className = 'gb-subpanel';
    root.dataset.testid = 'gb-subpanel-root';
    root.style.cssText = 'display:flex;flex-direction:column;flex:1;overflow:hidden;';

    const titlebar = document.createElement('div');
    titlebar.className = 'gb-subpanel-titlebar';

    const title = document.createElement('div');
    title.className = 'gb-subpanel-title';
    _titleIconEl = document.createElement('span');
    _titleIconEl.className = 'gb-subpanel-title-icon';
    _titleTextEl = document.createElement('span');
    _titleTextEl.className = 'gb-subpanel-title-text';
    title.append(_titleIconEl, _titleTextEl);

    const actions = document.createElement('div');
    actions.className = 'gb-subpanel-actions';

    _backBtn = document.createElement('button');
    _backBtn.type = 'button';
    _backBtn.className = 'gb-subpanel-button gb-subpanel-nav-btn';
    _backBtn.dataset.testid = 'gb-subpanel-back';
    _backBtn.dataset.e2eId = 'gb-subpanel-back';
    _backBtn.title = '戻る';
    _backBtn.setAttribute('aria-label', '戻る');
    _backBtn.innerHTML = typeof lucide === 'function' ? lucide('chevron-left', 16) : '←';
    _backBtn.disabled = true;
    _backBtn.addEventListener('click', () => navBack());

    _forwardBtn = document.createElement('button');
    _forwardBtn.type = 'button';
    _forwardBtn.className = 'gb-subpanel-button gb-subpanel-nav-btn';
    _forwardBtn.dataset.testid = 'gb-subpanel-forward';
    _forwardBtn.dataset.e2eId = 'gb-subpanel-forward';
    _forwardBtn.title = '進む';
    _forwardBtn.setAttribute('aria-label', '進む');
    _forwardBtn.innerHTML = typeof lucide === 'function' ? lucide('chevron-right', 16) : '→';
    _forwardBtn.disabled = true;
    _forwardBtn.addEventListener('click', () => navForward());

    // 計画書「文字が見える『メインパネルで開く』ボタン」— アイコンのみにしない。
    _promoteBtn = document.createElement('button');
    _promoteBtn.type = 'button';
    _promoteBtn.className = 'gb-subpanel-button gb-subpanel-promote-btn';
    _promoteBtn.dataset.testid = 'gb-subpanel-promote';
    _promoteBtn.dataset.e2eId = 'gb-subpanel-promote';
    _promoteBtn.title = 'メインパネルで開く';
    _promoteBtn.hidden = true;
    const promoteIcon = document.createElement('span');
    promoteIcon.className = 'gb-subpanel-promote-icon';
    promoteIcon.setAttribute('aria-hidden', 'true');
    promoteIcon.innerHTML = typeof lucide === 'function' ? lucide('panelTop', 14) : '';
    const promoteLabel = document.createElement('span');
    promoteLabel.className = 'gb-subpanel-promote-label';
    promoteLabel.textContent = 'メインパネルで開く';
    _promoteBtn.append(promoteIcon, promoteLabel);
    _promoteBtn.addEventListener('click', () => promoteToMainPane());

    _closeContentBtn = document.createElement('button');
    _closeContentBtn.type = 'button';
    _closeContentBtn.className = 'gb-subpanel-button';
    _closeContentBtn.dataset.testid = 'gb-subpanel-close-content';
    _closeContentBtn.dataset.e2eId = 'gb-subpanel-close-content';
    _closeContentBtn.title = '閉じる';
    _closeContentBtn.setAttribute('aria-label', '表示中の内容を閉じる');
    _closeContentBtn.hidden = true;
    _closeContentBtn.innerHTML = typeof lucide === 'function' ? lucide('x', 16) : 'x';
    _closeContentBtn.addEventListener('click', () => closeContent());

    actions.append(_backBtn, _forwardBtn, _promoteBtn, _closeContentBtn);
    titlebar.append(title, actions);

    _pathBarEl = document.createElement('div');
    _pathBarEl.className = 'gb-subpanel-pathbar';
    _pathBarEl.style.display = 'none';

    _contentEl = document.createElement('div');
    _contentEl.id = CONTENT_ID;
    _contentEl.className = 'gb-subpanel-content';
    _contentEl.dataset.testid = 'gb-subpanel-content';

    root.append(titlebar, _pathBarEl, _contentEl);
    _root = root;
    _showEmptyState();
    if (typeof replaceIcons === 'function') replaceIcons();
    return root;
  }

  function _ensureRoot() {
    return _root || createRootElement();
  }

  function _ensureRootInDocument() {
    const root = _ensureRoot();
    if (root.parentNode || !document.body?.appendChild) return root;
    let storage = typeof document.getElementById === 'function' ? document.getElementById('legacy-views') : null;
    if (!storage) {
      storage = document.createElement('div');
      storage.id = 'legacy-views';
      storage.style.display = 'none';
      document.body.appendChild(storage);
    }
    root.style.display = 'none';
    storage.appendChild(root);
    return root;
  }

  async function _closeForMobileDrawer() {
    if (!_current) {
      _showEmptyState();
      return true;
    }
    const seq = ++_opSeq;
    return _guardedTransition(seq, () => {
      _current = null;
      _navHistory = [];
      _navIndex = -1;
      _showEmptyState();
      return true;
    });
  }

  // ---- 公開API ----

  async function open(target) {
    const seq = ++_opSeq;
    let entry;
    try {
      entry = await _normalizeTarget(target);
    } catch (e) {
      const fallbackPath = (target && typeof target === 'object') ? String(target.path || '') : String(target || '');
      entry = { type: 'unsupported', path: fallbackPath, label: _basename(fallbackPath), state: {} };
    }
    if (seq !== _opSeq) return false; // 読込中に別対象が選択された
    if (entry.external) return false; // 外部URL/mailto/tel等は呼び出し元の既存ルールに委ねる
    if (!entry.path) return false;
    const mobile = _isMobileDrawerEnabled();
    if (mobile) _ensureRootInDocument();
    else _ensureRoot();
    const transitioned = await _guardedTransition(seq, () => {
      _pushHistory(entry);
      _renderTarget(entry);
      _updateNavUi();
      return true;
    });
    if (!transitioned) return false;
    return mobile ? _openMobileDrawer(entry) : true;
  }

  async function closeContent() {
    if (!_current) return true;
    const drawer = window.MeldexCloudMobileSideDrawer;
    if (_isMobileDrawerEnabled() && drawer?.isOpen?.() && typeof drawer.close === 'function') {
      return (await drawer.close()) !== false;
    }
    const seq = ++_opSeq;
    return _guardedTransition(seq, () => {
      _current = null;
      _navHistory = [];
      _navIndex = -1;
      _showEmptyState();
      return true;
    });
  }

  async function navBack() {
    if (_navIndex <= 0) return false;
    const seq = ++_opSeq;
    const targetIndex = _navIndex - 1;
    const entry = _navHistory[targetIndex];
    return _guardedTransition(seq, () => {
      _navIndex = targetIndex;
      _renderTarget(entry);
      _updateNavUi();
      return true;
    });
  }

  async function navForward() {
    if (_navIndex >= _navHistory.length - 1) return false;
    const seq = ++_opSeq;
    const targetIndex = _navIndex + 1;
    const entry = _navHistory[targetIndex];
    return _guardedTransition(seq, () => {
      _navIndex = targetIndex;
      _renderTarget(entry);
      _updateNavUi();
      return true;
    });
  }

  // 「メインパネルで開く」: 保存flush後、必ず新規タブを作ってアクティブ化する
  // （GBTabs.addTab の第6引数 options.forceNewTab=true が重複防止を全てスキップする）。
  async function promoteToMainPane() {
    if (!_current || !_current.path) return false;
    const seq = ++_opSeq;
    const flushResult = await _flushBeforeTransition(_current);
    if (seq !== _opSeq) return false;
    if (!flushResult.ok) {
      if (typeof showStatus === 'function') showStatus('保存を確認できませんでした。もう一度お試しください', true);
      return false;
    }
    const paneId = _mainPaneId();
    if (!paneId || typeof GBTabs === 'undefined' || typeof GBTabs.addTab !== 'function') {
      if (typeof showStatus === 'function') showStatus('メインパネルを取得できませんでした', true);
      return false;
    }
    // 昇格直前にライブ状態を取得してからマージする（GBFloatPanel._openInMainPane と
    // 同じ流儀）。_current.state はエントリ解決時点のスナップショットのため、そのまま
    // 渡すと昇格直前までのコンポーネント内部状態（スクロール位置・選択範囲など）が
    // 失われる。getState が無い/例外の場合は従来どおり _current.state のみを使う。
    let promotedState = _current.state || null;
    const sourceTabId = _pane?.tabs?.[0]?.id || '';
    if (_current.type !== 'entity' && sourceTabId && typeof getComponentInstance === 'function') {
      try {
        const comp = getComponentInstance(sourceTabId);
        if (comp && typeof comp.getState === 'function') {
          const liveState = comp.getState();
          if (liveState) promotedState = { ...(_current.state || {}), ...liveState };
        }
      } catch (e) { /* 取得失敗時は _current.state のまま使う */ }
    }
    const tabId = GBTabs.addTab(paneId, _current.label, _current.type, _current.path, { ...(promotedState || {}) }, { forceNewTab: true });
    if (!tabId) {
      if (typeof showStatus === 'function') showStatus('メインパネルへ開けませんでした', true);
      return false;
    }
    const actualPaneId = typeof GBTabs.findPaneIdForTab === 'function'
      ? (GBTabs.findPaneIdForTab(tabId) || paneId)
      : paneId;
    if (typeof GBTabs.activateTab === 'function') GBTabs.activateTab(actualPaneId, tabId);
    if (typeof GBLayout !== 'undefined' && typeof GBLayout.setActivePane === 'function') GBLayout.setActivePane(actualPaneId, { sync: true });
    // PCでは元のサブパネルを残す。スマートフォンではドロワーを閉じて新規メインタブを見せる。
    if (_isMobileDrawerEnabled() && typeof window.MeldexCloudMobileSideDrawer?.close === 'function') {
      const closed = await window.MeldexCloudMobileSideDrawer.close();
      if (closed === false) return false;
    }
    return true;
  }

  function isOpen() {
    return !!_current;
  }

  function getCurrentTarget() {
    return _current ? { ..._current } : null;
  }

  return {
    open,
    close: closeContent,
    navBack,
    navForward,
    promoteToMainPane,
    createRootElement,
    isOpen,
    getCurrentTarget,
  };
})();

if (typeof window !== 'undefined') window.GBSubPanel = GBSubPanel;
