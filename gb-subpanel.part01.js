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
   同じ仕組みで初回生成・退避・移動される。内容は右サイドバーの共通表示面へ
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
  let _sheetEmbed = null;
  let _sheetEmbedSeq = 0;
  let _sheetTheftObserver = null;

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
    return 'panelRightDashed';
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
      const targetState = target.state && typeof target.state === 'object' ? target.state : {};
      entry = {
        type: target.type,
        path: String(target.path || '').trim(),
        label: target.label || _basename(target.path) || _toolLabel(target.type),
        state: {
          ...targetState,
          ...(target.calendarFile != null ? { calendarFile: !!target.calendarFile } : {}),
          ...(target.mediaType ? { mediaType: target.mediaType } : {}),
          ...(target.viewerUrl ? { viewerUrl: target.viewerUrl } : {}),
          ...(target.urlExternal != null ? { urlExternal: !!target.urlExternal } : {}),
        },
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
    // 比較（compare）は合成パス、エントリ（entity）はSQLite上の論理.mdパスを取り得るため、
    // 物理ファイルの実在確認には乗せない。各レンダラーが現役APIで読み込み、そこで
    // 実在しない場合のエラーを表示する。
    if (!entry.external && entry.path && entry.type !== 'unsupported' && entry.type !== 'compare' && entry.type !== 'entity'
        && typeof GBLinkRouter !== 'undefined' && typeof GBLinkRouter.checkAvailability === 'function') {
      entry.availability = await GBLinkRouter.checkAvailability(entry.path);
    }
    if (entry.type === 'timer' && !entry.state?._timerFileLoaded && entry.availability?.exists !== false) {
      try {
        const base = typeof API_BASE !== 'undefined' ? API_BASE : '';
        const response = await fetch(base + '/file-raw?path=' + encodeURIComponent(entry.path), { cache: 'no-store' });
        if (!response.ok) throw new Error('HTTP ' + response.status);
        const contract = window.MeldexTimerFileContract;
        if (!contract?.parse) throw new Error('タイマーファイル契約を初期化できません');
        const normalized = contract.parse(await response.text());
        entry.state = {
          ...normalized.timer,
          ...entry.state,
          _timerFileLoaded: true,
          _timerFileStyle: normalized.style,
        };
        if (normalized.name && (!target || typeof target !== 'object' || !target.label)) entry.label = normalized.name;
      } catch (error) {
        entry.loadError = error?.message || 'タイマーファイルを読み込めませんでした';
      }
    }
    return entry;
  }

  function _captureSelection(root) {
    const selection = window.getSelection?.();
    if (!root || !selection || selection.rangeCount === 0) return null;
    const range = selection.getRangeAt(0);
    if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;
    const offsetOf = (node, offset) => {
      const probe = document.createRange();
      probe.selectNodeContents(root);
      probe.setEnd(node, offset);
      return probe.toString().length;
    };
    return { start: offsetOf(range.startContainer, range.startOffset), end: offsetOf(range.endContainer, range.endOffset) };
  }

  function _restoreSelection(root, saved) {
    if (!root || !saved || typeof document.createTreeWalker !== 'function') return;
    const locate = target => {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let remaining = Math.max(0, Number(target) || 0);
      let node = walker.nextNode();
      while (node) {
        if (remaining <= node.data.length) return { node, offset: remaining };
        remaining -= node.data.length;
        node = walker.nextNode();
      }
      return { node: root, offset: root.childNodes.length };
    };
    try {
      const start = locate(saved.start);
      const end = locate(saved.end);
      const range = document.createRange();
      range.setStart(start.node, start.offset);
      range.setEnd(end.node, end.offset);
      const selection = window.getSelection?.();
      selection?.removeAllRanges();
      selection?.addRange(range);
    } catch { /* DOMが変わった場合はスクロールだけ復元する */ }
  }

  function _surfaceScrollState(root) {
    if (!root) return null;
    return { left: root.scrollLeft || 0, top: root.scrollTop || 0 };
  }

  function _applySurfaceScroll(root, state) {
    if (!root || !state) return;
    root.scrollLeft = Number(state.left) || 0;
    root.scrollTop = Number(state.top) || 0;
  }

  function _sheetViewElements(root) {
    if (!root) return [];
    return [...root.querySelectorAll('.pivot-view,.tree-view,.gallery-view,.kanban-view,.timeline-view,.chart-view,.graph-view,.form-view,.smart-db-view')];
  }

  function _captureViewerFrameState(frame) {
    try {
      const win = frame?.contentWindow;
      const scene = win?.MeldexViewerScene;
      if (!scene) return null;
      const media = win.MeldexViewerVideo?.getCurrentVideoElement?.()
        || win.MeldexViewerAudio?.getCurrentAudioElement?.();
      return {
        index: scene.getIndex?.() || 0,
        zoom: scene.getZoom?.() || 1,
        panX: scene.getPanX?.() || 0,
        panY: scene.getPanY?.() || 0,
        rotateDeg: scene.getRotateDeg?.() || 0,
        mediaTime: Number(media?.currentTime) || 0,
        mediaPlaying: !!media && !media.paused && !media.ended,
      };
    } catch { return null; }
  }

  function _captureCurrentEntryState() {
    if (!_current) return null;
    let live = {};
    const tabId = _pane?.tabs?.[0]?.id || '';
    if (tabId && typeof getComponentInstance === 'function') {
      try {
        const componentState = getComponentInstance(tabId)?.getState?.();
        if (componentState && typeof componentState === 'object') live = { ...live, ...componentState };
      } catch { /* 専用表示面の取得を続ける */ }
    }
    const noteRoot = _contentEl?.querySelector('.gb-subpanel-note-content');
    const csvRoot = _contentEl?.querySelector('.gb-subpanel-csv-root');
    const folderRoot = _contentEl?.querySelector('.gb-subpanel-folder-root');
    const viewerFrame = _contentEl?.querySelector('.gb-subpanel-viewer-frame');
    if (noteRoot) live._subpanelSurface = { scroll: _surfaceScrollState(noteRoot), selection: _captureSelection(noteRoot) };
    else if (csvRoot) live._subpanelSurface = { scroll: _surfaceScrollState(csvRoot) };
    else if (folderRoot) live._subpanelSurface = { scroll: _surfaceScrollState(folderRoot) };
    else if (_sheetEmbed?.ctx || DB_VIEW_TYPES.has(_current.type) || _current.type === 'smart-db') {
      const sheetCtx = _sheetEmbed?.ctx || (_pane?.id && typeof getPaneContext === 'function' ? getPaneContext(_pane.id) : null);
      live.viewMode = sheetCtx?.viewMode || live.viewMode || _current.type;
      live.selectedEntities = [...(sheetCtx?._selectedEntities || [])];
      live._subpanelSurface = {
        views: _sheetViewElements(_sheetEmbed?.containerEl || _contentEl).map(el => ({
          className: [...el.classList].find(name => name.endsWith('-view')) || '',
          scroll: _surfaceScrollState(el),
        })),
      };
    } else if (viewerFrame) {
      live._viewerState = _captureViewerFrameState(viewerFrame);
    }
    _current.state = { ...(_current.state || {}), ...live };
    if (_pane?.tabs?.[0]) _pane.tabs[0].state = { ..._current.state };
    if (_navIndex >= 0 && _navHistory[_navIndex]) _navHistory[_navIndex].state = { ..._current.state };
    return _current.state;
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
      // CSV: _csvDirty/_csvPathは単一のグローバル変数（縮小スコープ）。このサブパネル
      // 対象を離れる時点でも _csvPath がまだこの対象を指していれば（=他へ奪われて
      // いなければ）、保留中の自動保存を即座に確定させる。openCsvFile()自身の
      // 「前のCSVをflushしてから開く」経路が働かない対象外への遷移（閉じる等）を
      // ここで担う（board/scriptnoteと同じ理由）。
      if (type === 'csv') {
        if (typeof _csvDirty !== 'undefined' && _csvDirty && typeof _csvPath !== 'undefined'
            && _csvPath === entry.path && typeof saveCsv === 'function') {
          if (typeof _csvAutoSaveTimer !== 'undefined') clearTimeout(_csvAutoSaveTimer);
          const ok = await saveCsv();
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

  // ---- 既存内容の破棄 ----
  function _retractCurrentContent(options) {
    const opts = options || {};
    if (!_contentEl) return Promise.resolve();
    _stopLoadFailureObserver();
    const content = _contentEl;
    // 比較は openCompareView() 内で container._compareResizeCleanup に window resize
    // リスナーの解除関数を積む（gb-compare.js）。サブパネルは対象切替のたびに専用
    // コンテナごと作り直す（使い回さない）ため、ここで明示的に解除しないとリスナーが
    // 破棄済みDOMを握ったまま蓄積し続ける（メイン画面側は同一containerを使い回すため
    // 問題にならない）。
    content.querySelectorAll('.gb-subpanel-compare-root').forEach(root => {
      root._compareResizeCleanup?.();
    });
    // シート専用埋め込み（MeldexProductionSheetEmbed）はDOM監視/書き込みガード用の
    // リスナー・Observerを持つため、DOM除去任せにせずdestroy()で明示的に解放する
    // （ctx.destroyedも立ち、進行中のselectDatabase()読込を安全に打ち切れる）。
    if (_sheetEmbed) {
      try { _sheetEmbed.destroy(); } catch { /* 失敗しても後続のDOM除去で片付く */ }
      _sheetEmbed = null;
    }
    _stopSheetTheftObserver();
    const disposals = [...content.querySelectorAll('[data-meldex-entity-detail]')]
      .map(root => Promise.resolve(root._meldexEntityDetailController?.dispose?.()).catch(() => false));
    return Promise.allSettled(disposals).then(() => {
      _teardownVirtualPane();
      content.replaceChildren();
      if (opts.remount && typeof GBPaneBridge !== 'undefined' && typeof GBPaneBridge.mountAllPanes === 'function') {
        GBPaneBridge.mountAllPanes();
      }
    });
  }

  // サブパネルの仮想パネル登録（_mountVirtualEntry/_registerPaneMap）の後始末。
  // シートが共有コンテナをメインへ奪還された際の即時切替（_switchSheetToIndependent）と、
  // 通常の対象切替（_retractCurrentContent）の両方から呼ぶ2つ目の呼び出し元ができたため関数化した。
  function _teardownVirtualPane() {
    if (_pane) {
      if (typeof GBPaneBridge !== 'undefined' && typeof GBPaneBridge.retractPaneContent === 'function') {
        GBPaneBridge.retractPaneContent(_pane.id);
      }
      const tabId = _pane.tabs?.[0]?.id || '';
      if (tabId && typeof removeComponentInstance === 'function') removeComponentInstance(tabId);
      if (typeof GBLayout !== 'undefined' && GBLayout.paneMap) delete GBLayout.paneMap[_pane.id];
    }
    _pane = null;
  }

  // flush → 中断判定 → 既存内容の破棄、を経てから fn() で次の状態を描画する共通ガード。
  // seq は「読込中に別対象が選択された」「操作が別の操作に追い越された」場合に
  // 古い方の続きを打ち切るための世代トークン。
  async function _guardedTransition(seq, fn) {
    _captureCurrentEntryState();
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

  // 通知を出した側（gb-folder.part01.part01.js の openFolder() 内 _folderShowTakeoverNotice、
  // gb-csv-viewer.js の openCsvFile() 内 _csvShowTakeoverNotice）は、直前の描画先（メイン等）へ
  // 「切り替わりました」通知を書き込むだけで、pane-bridge側の「この面に最後に描いた内容」の
  // 記録（dataset.gbLegacyView/gbLegacyPath）までは更新しない。そのため通知を受け取った側の
  // タブへ戻っても再読込が走らず、案内表示のまま残ってしまう（2026-08-19 AGENT_INBOX）。
  // 取り合いを起こす側＝サブパネルが、共有シングルトン（_folderPath/_csvPath）を書き換える
  // 直前にこの記録を無効化しておくことで、そのタブへ戻った時点で needsLiveReload が真になり
  // 自動的に再読込されるようにする（層をまたぐため GBPaneBridge の公開入口を使う。
  // 判定ロジック自体は増やさず、pane-bridge側の既存の needsLiveReload 比較に委ねる）。
  function _invalidateTakenOverRenderState(viewName, previousPath, nextPath) {
    if (!previousPath || previousPath === nextPath) return;
    if (typeof GBPaneBridge === 'undefined' || typeof GBPaneBridge.invalidateLegacyRenderState !== 'function') return;
    GBPaneBridge.invalidateLegacyRenderState(viewName, previousPath);
  }

  // CSV（csv-view）も「1つしかない表示領域」の1つ（Phase B-2）。ただしCSVの編集状態
  // （_csvPath/_csvData等）はシートのctxと違い、gb-csv-viewer.js内の生グローバル変数
  // のまま（縮小スコープ・2026-08-19ユーザー承認）。完全な同時独立編集はせず、
  // 描画先（DOM）だけを専用化して取り合いを解消する。別ファイルへの切替時は
  // openCsvFile側が直前の描画先へ「切り替わりました」通知を出す。
  function _mountCsv(entry) {
    if (typeof openCsvFile !== 'function') return false;
    _invalidateTakenOverRenderState('csv', typeof _csvPath !== 'undefined' ? _csvPath : '', entry.path);
    const root = document.createElement('div');
    root.className = 'gb-subpanel-csv-root';
    root.dataset.testid = 'gb-subpanel-csv-root';
    root.style.cssText = 'display:flex;flex-direction:column;flex:1;overflow:auto;min-height:0;';
    _contentEl.appendChild(root);
    openCsvFile(entry.label || _basename(entry.path), entry.path, {
      containerEl: root,
      skipShowView: true,
      skipGlobalUi: true,
      skipStateView: true,
      skipNavPush: true,
      skipSaveLastView: true,
      skipRecent: true,
      skipHighlight: true,
    }).then(ok => {
      if (ok === false && _current === entry) _renderErrorState(entry, 'CSVを読み込めませんでした');
      else if (_current === entry) _applySurfaceScroll(root, entry.state?._subpanelSurface?.scroll);
    }).catch(() => {
      if (_current === entry) _renderErrorState(entry, 'CSVを読み込めませんでした');
    });
    return true;
  }

  // ノート（page-view/page-content）も「1つしかない表示領域」の1つ（Phase B-2）。
  // openPage()にopts.containerElを追加し、独立DOMへ直接描画・独立して編集イベント
  // （IME・貼り付け・自動保存）を配線するようにした（gb-editor.part01.part01.js の
  // _wireNoteEditableElement / _openPageLoadSeq のpc単位化を参照）。タイトルバー・
  // 目次・オプション対象等のメイン画面専用UIは触らない（縮小スコープ）。
  // window._noteAutoSaveTimer は引き続き単一のグローバルタイマーのため、メインと
  // サブパネルを同時に編集すると片方のdebounceが再スケジュールされることがあるが、
  // blur時保存が主経路のためデータ消失はしない（既知の制約）。
  function _mountNote(entry) {
    if (typeof openPage !== 'function') return false;
    const root = document.createElement('div');
    root.className = 'gb-subpanel-note-content';
    root.dataset.testid = 'gb-subpanel-note-content';
    root.contentEditable = 'true';
    root.style.cssText = 'flex:1;overflow-y:auto;overscroll-behavior:contain;min-height:0;padding:16px;line-height:1.7;outline:none;';
    _contentEl.appendChild(root);
    openPage(entry.label || _basename(entry.path), entry.path, {
      containerEl: root,
      skipShowView: true,
      skipGlobalUi: true,
      skipStateView: true,
      skipNavPush: true,
      skipSaveLastView: true,
      skipRecent: true,
      skipHighlight: true,
      skipHistoryScope: true,
    }).then(ok => {
      if (ok === false && _current === entry) _renderErrorState(entry, 'ノートを読み込めませんでした');
      else if (_current === entry) {
        _applySurfaceScroll(root, entry.state?._subpanelSurface?.scroll);
        _restoreSelection(root, entry.state?._subpanelSurface?.selection);
      }
    }).catch(() => {
      if (_current === entry) _renderErrorState(entry, 'ノートを読み込めませんでした');
    });
    if (window.MeldexSetupEditableDropHandler) window.MeldexSetupEditableDropHandler(root);
    return true;
  }

  // フォルダ（folder-view/folder-grid）も「1つしかない表示領域」の1つ（Phase B-2）。
  // フォルダの状態（_folderPath/_folderItems/_folderSelected等）はCSVと同じく
  // ctxへ分離されていない生のグローバル変数のまま（縮小スコープ・2026-08-19
  // ユーザー承認）。完全な同時独立編集はせず、描画先（DOM）だけを専用化して
  // 取り合いを解消する。別フォルダへの切替時は openFolder() 側
  // （_folderShowTakeoverNotice、gb-folder.part01.part01.js）が直前の描画先へ
  // 「切り替わりました」通知を出す。フォルダは削除・リネーム・タグ付け等の操作が
  // すべて即時のAPI呼び出しで完結し、保留中の自動保存やdirty状態を持たないため、
  // _flushBeforeTransition() にフォルダ用の分岐は追加していない（flushすべき
  // 保留編集が存在しない）。
  function _mountFolder(entry) {
    if (typeof openFolder !== 'function') return false;
    _invalidateTakenOverRenderState('folder', typeof _folderPath !== 'undefined' ? _folderPath : '', entry.path);
    const root = document.createElement('div');
    root.className = 'gb-subpanel-folder-root';
    root.dataset.testid = 'gb-subpanel-folder-root';
    // displayは指定しない: renderFolderGrid()（gb-folder.part01.part01.js）が
    // レイアウトmode class（grid-layout/list-layout/waterfall-layout/hflow-layout）を
    // container.classNameへ付与し、gb-subpanel.cssの対応ルールがdisplay:grid/flex等を
    // 決める。ここでinline displayを設定すると常勝してしまい、モード切替が効かなくなる。
    root.style.cssText = 'flex:1 1 auto;overflow:auto;min-height:0;';
    _contentEl.appendChild(root);
    openFolder(entry.label || _basename(entry.path), entry.path, {
      containerEl: root,
      skipShowView: true,
      skipGlobalUi: true,
      skipNavPush: true,
      skipSaveLastView: true,
      skipHighlight: true,
      silent: true,
    }).then(ok => {
      if (ok === false && _current === entry) _renderErrorState(entry, 'フォルダを読み込めませんでした');
      else if (_current === entry) _applySurfaceScroll(root, entry.state?._subpanelSurface?.scroll);
    }).catch(() => {
      if (_current === entry) _renderErrorState(entry, 'フォルダを読み込めませんでした');
    });
    return true;
  }

  // シート系はPhase B-2の縮小スコープ対象（比較・CSV・ノート・フォルダ）に含まれず、B-1は
  // 共有#db-view-container/#pivot-tableの再ドッキングまでしか対応していない。メインに
  // 別のシートが既に開いていると静止画＋引っ越し方式が働き操作不能になる（不採用・計画書
  // 確定済み）。取り合いが起きる場合だけ、制作管理の埋め込みシートが使う独立描画の仕組み
  // （MeldexProductionSheetEmbed、ctx.embedded=trueでstate.*へ一切触れない）へ切り替える。
  // 取り合いが無ければ既存のB-1機構（常に独立化すると既存テストのID固定と衝突する）。
  function _sheetSharedContainerClaimedElsewhere() {
    const existing = document.getElementById('db-view-container');
    if (!existing || !existing.isConnected) return false;
    if (_root && _root.contains(existing)) return false; // 既にサブパネル自身が所有中
    const storage = document.getElementById('legacy-views');
    if (storage && storage.contains(existing)) return false; // 誰も使っていない（退避先）
    const rect = existing.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0; // 他の面（メイン等）が実際に表示中
  }

  function _mountSheetIndependent(entry) {
    if (typeof window.MeldexProductionSheetEmbed?.create !== 'function') return false;
    const instance = window.MeldexProductionSheetEmbed.create({ idSuffix: 'subpanel-' + (++_sheetEmbedSeq) });
    const mounted = instance.mount(_contentEl);
    if (!mounted) return false;
    _sheetEmbed = instance;
    const requestedViewMode = entry.state?.calendarFile
      ? 'timeline'
      : (entry.state?.viewMode || (DB_VIEW_TYPES.has(entry.type) && !['database', 'db'].includes(entry.type) ? entry.type : ''));
    instance.open(entry.path, { requestedViewMode }).then(ok => {
      if (ok === false && _current === entry) _renderErrorState(entry, 'シートを読み込めませんでした');
      else if (_current === entry) {
        if (Array.isArray(entry.state?.selectedEntities)) {
          instance.ctx._selectedEntities = new Set(entry.state.selectedEntities);
        }
        for (const saved of (entry.state?._subpanelSurface?.views || [])) {
          const el = saved.className ? instance.containerEl?.querySelector('.' + saved.className) : null;
          _applySurfaceScroll(el, saved.scroll);
        }
      }
    }).catch(() => {
      if (_current === entry) _renderErrorState(entry, 'シートを読み込めませんでした');
    });
    return true;
  }

  function _stopSheetTheftObserver() {
    _sheetTheftObserver?.disconnect?.();
    _sheetTheftObserver = null;
  }

  // 絶対/相対のどちらで来ても末尾一致で同一ファイルとみなす（E2E側のpathMatchesと同じ考え方）。
  function _sheetPathsRefEqual(a, b) {
    const na = String(a || '').replace(/\\/g, '/').replace(/\/+$/, '');
    const nb = String(b || '').replace(/\\/g, '/').replace(/\/+$/, '');
    if (!na || !nb) return false;
    return na === nb || na.endsWith('/' + nb) || nb.endsWith('/' + na);
  }

  // 順序が逆（サブパネルが共有コンテナを先に使い、後からメインが同じシート系タブを
  // アクティブ化/再読込する）だと、メイン側 selectDatabase() の ctx は自分のパネル領域を
  // 指すが、その領域には#pivot-tableが物理的に存在しない（サブパネル側にある）ため、
  // 内部の _paneEl() が document.getElementById() へフォールバックし、DOMを動かさずに
  // サブパネル側の実体へ直接メインのデータを上書きする（実測で確認済み。db-view-container
  // 自体は移動しないため、単純なDOM離脱検知だけでは捕まらない）。この「動かないまま中身だけ
  // 奪われる」ケースを、共有のグローバル状態 state.currentDbPath が自分のentry.pathと
  // 食い違うことで検知する（フォルダ/CSVの単一グローバル変数と同じ考え方）。加えて
  // 通常の離脱（_sheetSharedContainerClaimedElsewhere）も引き続き見る。
  function _watchSheetContainerTheft(entry) {
    _stopSheetTheftObserver();
    if (typeof MutationObserver === 'undefined' || !_contentEl) return;
    const check = () => {
      if (_current !== entry) { _stopSheetTheftObserver(); return; }
      const stateStolen = typeof state !== 'undefined' && state.currentDbPath
        && !_sheetPathsRefEqual(state.currentDbPath, entry.path);
      if (!stateStolen && !_sheetSharedContainerClaimedElsewhere()) return;
      _stopSheetTheftObserver();
      _teardownVirtualPane();
      _contentEl.replaceChildren();
      // 共有コンテナを解放した直後にメイン側の再マウントを一度促す。メインの
      // selectDatabase()呼び出し自体は既に完了済み（正しいデータを取得済み）だが、
      // _paneElのグローバルフォールバックにより物理的に誤った場所（サブパネル側）へ
      // 描画されていたため、解放後にmountAllPanes()を呼ぶとメイン自身のペインが
      // _showLegacyViewInPane経由で共有コンテナ（＝取得済みの正しい内容）を
      // 正しく引き取り直せる。
      if (typeof GBPaneBridge !== 'undefined' && typeof GBPaneBridge.mountAllPanes === 'function') {
        GBPaneBridge.mountAllPanes();
      }
      if (!_mountSheetIndependent(entry)) _renderErrorState(entry, 'シートを読み込めませんでした');
    };
    _sheetTheftObserver = new MutationObserver(check);
    _sheetTheftObserver.observe(_contentEl, { childList: true, subtree: true });
  }

  function _mountSheet(entry) {
    if (_sheetSharedContainerClaimedElsewhere()) return _mountSheetIndependent(entry);
    const mounted = _mountVirtualEntry(entry);
    if (mounted) {
      _watchSheetContainerTheft(entry);
      [0, 80, 220].forEach(delay => setTimeout(() => {
        if (_current !== entry) return;
        const sheetCtx = _pane?.id && typeof getPaneContext === 'function' ? getPaneContext(_pane.id) : null;
        if (sheetCtx && Array.isArray(entry.state?.selectedEntities)) {
          sheetCtx._selectedEntities = new Set(entry.state.selectedEntities);
        }
        for (const saved of (entry.state?._subpanelSurface?.views || [])) {
          const el = saved.className ? _contentEl?.querySelector('.' + saved.className) : null;
          _applySurfaceScroll(el, saved.scroll);
        }
      }, delay));
    }
    return mounted;
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

