  // 比較（compare-view）は「1つしかない表示領域」の1つ（Phase B-2）。メインパネルと
  // 同じ #compare-view を取り合わないよう、専用の独立DOMへ直接描画させる。
  // _renderCompareView() は container 引数のみに依存しており、埋め込みシートと同じく
  // 「描画先を受け取る契約」を既に満たしていたため、openCompareView() へ opts.containerEl /
  // opts.skipShowView を追加するだけで独立描画が成立する（gb-compare.js 参照）。
  function _parseCompareEntry(entry) {
    if (entry?.state?.pathA && entry?.state?.pathB) {
      return { pathA: String(entry.state.pathA), pathB: String(entry.state.pathB) };
    }
    const raw = String(entry?.path || '');
    const rest = raw.startsWith('compare:') ? raw.slice('compare:'.length) : raw;
    const [pathA, pathB] = rest.split('|');
    return { pathA: (pathA || '').trim(), pathB: (pathB || '').trim() };
  }

  function _mountCompare(entry) {
    const { pathA, pathB } = _parseCompareEntry(entry);
    if (!pathA || !pathB || typeof openCompareView !== 'function') return false;
    const root = document.createElement('div');
    root.className = 'gb-subpanel-compare-root';
    root.dataset.testid = 'gb-subpanel-compare-root';
    root.style.cssText = 'display:flex;flex-direction:column;flex:1;overflow:hidden;min-height:0;';
    _contentEl.appendChild(root);
    openCompareView(pathA, pathB, { containerEl: root, skipShowView: true }).then(ok => {
      if (ok === false && _current === entry) _renderErrorState(entry, 'ファイル取得エラー');
    }).catch(() => {
      if (_current === entry) _renderErrorState(entry, 'ファイル取得エラー');
    });
    return true;
  }

  // 音声も画像・動画と同じく隔離ビューワー（iframe、viewer.html）で開く。以前は
  // viewer.htmlに音声再生の実装が無く、除外後のフォールスルー先（_mountVirtualEntry→
  // openMedia()）がメインと共有の#media-contentへ直接書き込むため、メイン再生中に別音声を
  // 開くと<audio>要素ごと破棄され停止する実害があった。viewer.htmlへの音声再生実装
  // （viewer-audio.js、2026-08-19 AGENT_INBOX）により隔離ビューワー経路が使えるように
  // なったため、他のメディア種別と同じ扱いに戻す。
  function _isIsolatedViewerEntry(entry) {
    return !!entry && entry.type === 'media';
  }

  function _isolatedViewerUrl(entry) {
    if (entry.state?.viewerUrl) return entry.state.viewerUrl;
    const mediaType = entry.state?.mediaType || '';
    return mediaType === 'pdf' || /\.pdf$/i.test(entry.path)
      ? '/viewer?pdf=' + encodeURIComponent(entry.path)
      : '/viewer?file=' + encodeURIComponent(entry.path);
  }

  function _mountIsolatedViewer(entry) {
    const frame = document.createElement('iframe');
    frame.className = 'gb-subpanel-viewer-frame';
    frame.dataset.testid = 'gb-subpanel-viewer-frame';
    frame.title = entry.label || _basename(entry.path) || 'ビューワー';
    frame.setAttribute('allow', 'fullscreen');
    const logicalUrl = _isolatedViewerUrl(entry);
    if (typeof _gbPrepareUntrustedIframe === 'function') _gbPrepareUntrustedIframe(frame, logicalUrl);
    frame.addEventListener('load', () => _restoreViewerFrameState(frame, entry.state?._viewerState), { once: true });
    frame.src = window.MeldexResourceUrl?.rewriteInternalUrl?.(logicalUrl) || logicalUrl;
    _contentEl.appendChild(frame);
    return true;
  }

  async function _restoreViewerFrameState(frame, saved) {
    if (!frame || !saved) return;
    try {
      const win = frame.contentWindow;
      const scene = win?.MeldexViewerScene;
      if (!scene) return;
      await Promise.resolve(scene.ready);
      if (Number.isInteger(saved.index)) await Promise.resolve(scene.goToIndex?.(saved.index));
      if (Number.isFinite(Number(saved.zoom))) scene.setZoomAt?.(null, null, Number(saved.zoom));
      scene.setPan?.(Number(saved.panX) || 0, Number(saved.panY) || 0);
      if (Number.isFinite(Number(saved.rotateDeg))) scene.setRotateDeg?.(Number(saved.rotateDeg));
      const media = win.MeldexViewerVideo?.getCurrentVideoElement?.()
        || win.MeldexViewerAudio?.getCurrentAudioElement?.();
      if (media && Number.isFinite(Number(saved.mediaTime))) {
        const applyMedia = () => {
          try { media.currentTime = Math.max(0, Number(saved.mediaTime) || 0); } catch {}
          if (saved.mediaPlaying) media.play?.().catch?.(() => {});
        };
        if (media.readyState >= 1) applyMedia();
        else media.addEventListener('loadedmetadata', applyMedia, { once: true });
      }
    } catch { /* 再生制限や読込途中でも表示自体は継続する */ }
  }

  function _mountHtml(entry) {
    if (typeof openHtmlFile !== 'function') return false;
    const frame = document.createElement('iframe');
    frame.className = 'gb-subpanel-html-frame';
    frame.dataset.testid = 'gb-subpanel-html-frame';
    frame.title = entry.label || _basename(entry.path) || 'HTML';
    frame.addEventListener('load', () => {
      if (frame.src.includes('/file-raw?path=')) frame.dataset.gbHtmlLoaded = 'true';
    });
    _contentEl.appendChild(frame);
    openHtmlFile(entry.label || _basename(entry.path), entry.path, {
      iframeEl: frame,
      skipShowView: true,
      skipGlobalState: true,
      skipGlobalUi: true,
      skipSaveLastView: true,
      skipNavPush: true,
      skipRecent: true,
      skipHighlight: true,
    });
    return true;
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
      if (await _retractCurrentContent({ remount: true }) === false) return;
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
    _renderTargetContent(entry);
    if (!_contentEl || entry.type === 'entity' || entry.loadError || _hasReportedLoadFailure()) return;
    const kind = DB_VIEW_TYPES.has(entry.type) ? 'database' : entry.type;
    _editorOwnership = window.GBEditorHost?.register(_contentEl, {
      editorId: INNER_PANE_ID, path: entry.path, label: entry.label, kind, surface: 'subpanel',
      resolveCtx: () => _sheetEmbed?.ctx || (_pane?.id && typeof getPaneContext === 'function' ? getPaneContext(_pane.id) : null)
        || (kind === 'page' ? { paneId: INNER_PANE_ID, pagePath: entry.path, viewMode: 'page', containerEl: _contentEl } : null),
      resolveComponent: () => typeof getComponentInstance === 'function' ? getComponentInstance(_pane?.tabs?.[0]?.id) : null,
      activate: () => {
        if (['board', 'scriptnote', 'form-app', 'map'].includes(kind)) getComponentInstance(_pane?.tabs?.[0]?.id)?.activate?.();
      },
      syncDetail: () => {
        const component = typeof getComponentInstance === 'function' ? getComponentInstance(_pane?.tabs?.[0]?.id) : null;
        if (component?._syncDetailPanel) component._syncDetailPanel();
        else if (typeof _syncDetailPanel === 'function') void _syncDetailPanel(entry.label, entry.path, kind);
      },
      flush: () => _flushBeforeTransition(entry).then(result => result?.ok !== false),
      reload: async (options = {}) => {
        if (!options.skipFlush && !(await _flushBeforeTransition(entry)).ok) return false;
        if (kind === 'page') return window.GBEditorHost.reloadNote(_contentEl, entry.label, entry.path);
        if (_sheetEmbed) return _sheetEmbed.refresh();
        const component = getComponentInstance(_pane?.tabs?.[0]?.id);
        if (kind === 'scriptnote') return component?._loadScenario(entry.path, { skipNavPush: true, silent: true });
        return component?.reload?.();
      },
      // フォーム・マップは本体と同じ範囲名をコンポーネント自身から取る（書式がずれると取り消しが別範囲へ行く）。
      historyScope: () => ['form-app', 'map'].includes(kind) && typeof getComponentInstance(_pane?.tabs?.[0]?.id)?._historyScope === 'function'
          ? getComponentInstance(_pane?.tabs?.[0]?.id)._historyScope()
        : kind === 'database' && typeof _dbViewConfigHistoryScope === 'function' ? _dbViewConfigHistoryScope(entry.path)
        : kind === 'scriptnote' ? getComponentInstance(_pane?.tabs?.[0]?.id)?._editor?._historyScope?.()
        : kind === 'calendar' && typeof _meldexScheduleTabHistoryScope === 'function' ? _meldexScheduleTabHistoryScope(_pane?.tabs?.[0])
        : kind === 'board' && typeof _bdHistoryScope === 'function' ? _bdHistoryScope(entry.path)
        : kind + ':' + entry.path.replace(/^\/+/, ''),
    });
  }

  function _renderTargetContent(entry) {
    if (!_contentEl) return;
    _contentEl.replaceChildren();
    // シートのツールバーの操作が、この面のシートを対象にする（gb-db-core.js の _dbPaneContextFromEvent）。
    if (!Object.getOwnPropertyDescriptor(_contentEl, '_dbPaneContext')) {
      Object.defineProperty(_contentEl, '_dbPaneContext', { configurable: true,
        get: () => (_current && DB_VIEW_TYPES.has(_current.type) ? (_sheetEmbed?.ctx || (_pane?.id && typeof getPaneContext === 'function' ? getPaneContext(_pane.id) : null)) : null) });
    }
    _updateHeader(entry);
    if (entry.availability?.checked && entry.availability.exists === false) {
      _renderErrorState(entry, 'ファイルが見つかりません');
      _current = entry;
      return;
    }
    if (entry.loadError) {
      _renderErrorState(entry, entry.loadError);
      _current = entry;
      return;
    }
    if (entry.type === 'unsupported') {
      _renderErrorState(entry, entry.retired
        ? 'タイマーは廃止されました。既存ファイルは変更せず、この画面では編集・保存しません。'
        : 'この形式はサブパネルに対応していません');
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
    if (entry.type === 'html' && !entry.external) {
      const mounted = _mountHtml(entry);
      _current = entry;
      if (!mounted) _renderErrorState(entry, 'HTMLを読み込めませんでした');
      return;
    }
    // ビューワーは #html-view をメインパネルと共有しない。共有DOMをサブパネルへ
    // 移動すると、その後のメイン側 openViewer() もサブパネル内iframeを更新してしまう。
    if (_isIsolatedViewerEntry(entry)) {
      _mountIsolatedViewer(entry);
      _current = entry;
      return;
    }
    if (entry.type === 'compare') {
      const mounted = _mountCompare(entry);
      _current = entry;
      if (!mounted) _renderErrorState(entry, '比較対象を読み込めませんでした');
      return;
    }
    if (entry.type === 'csv') {
      const mounted = _mountCsv(entry);
      _current = entry;
      if (!mounted) _renderErrorState(entry, 'CSVを読み込めませんでした');
      return;
    }
    if (entry.type === 'page') {
      const mounted = _mountNote(entry);
      _current = entry;
      if (!mounted) _renderErrorState(entry, 'ノートを読み込めませんでした');
      return;
    }
    if (entry.type === 'folder') {
      const mounted = _mountFolder(entry);
      _current = entry;
      if (!mounted) _renderErrorState(entry, 'フォルダを読み込めませんでした');
      return;
    }
    if (DB_VIEW_TYPES.has(entry.type)) {
      const mounted = _mountSheet(entry);
      _current = entry;
      if (!mounted) { _renderErrorState(entry, 'シートを読み込めませんでした'); return; }
      _watchForLoadFailure(entry);
      return;
    }
    const mounted = _mountVirtualEntry(entry);
    _current = entry;
    if (!mounted) {
      _renderErrorState(entry, '読み込みに失敗しました');
      return;
    }
    if (window.MeldexSetupEditableDropHandler) {
      _contentEl.querySelectorAll('#page-content, #entity-freetext, [contenteditable="true"]').forEach(el => {
        window.MeldexSetupEditableDropHandler(el);
      });
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
    if (_titleIconEl) _titleIconEl.innerHTML = typeof lucide === 'function' ? lucide('panelRightDashed', 16) : '';
    if (_promoteBtn) _promoteBtn.hidden = true;
    if (_closeContentBtn) _closeContentBtn.hidden = true;
    if (_parentLinkHost) { _parentLinkHost.replaceChildren(); _parentLinkHost.hidden = true; }
    _updateNavUi();
    if (typeof replaceIcons === 'function') replaceIcons();
  }

  // フォルダツリー等からドロップされたファイル／フォルダを開く。フォルダツリーのメニューの
  // 「サブパネルで開く」と同じ開き方（openLinkedPathInRightSidebar）を通し、ドロップ独自の開き方を持たない。
  // 独自の開き方を持っていた頃は、シナリオ等の開く対象の指定（scenarioPath等）が付かず、
  // アプリに切り替わるだけでファイルが開かれなかった。
  async function _openDroppedItem(item, options = {}) {
    const path = String(item?.path || '').trim();
    if (!path) return false;
    const label = item.label || item.name || _basename(path);
    if (typeof openLinkedPathInRightSidebar === 'function') {
      return openLinkedPathInRightSidebar(path, label, {
        linkType: item.type || item.toolType || '',
        fromDrop: true,
        subpanelIndex: Number.isInteger(options.index) ? options.index : undefined,
      });
    }
    const target = (typeof MeldexDnD !== 'undefined' && await MeldexDnD.normalizeOpenTargetAsync?.(item)) || { type: item.type, path, label };
    return open(target, options);
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
    _parentLinkHost = document.createElement('span');
    _parentLinkHost.className = 'gb-subpanel-parent-host';
    _parentLinkHost.hidden = true;
    title.append(_parentLinkHost, _titleIconEl, _titleTextEl);
    if (typeof MeldexDnD !== 'undefined' && MeldexDnD.installSurfaceDragSource) {
      MeldexDnD.installSurfaceDragSource(root, title, () => _current, 'right-subpanel');
    }

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

    // 名前は共通ツールチップと支援技術に残し、ヘッダーでは専用アイコンを使う。
    _promoteBtn = document.createElement('button');
    _promoteBtn.type = 'button';
    _promoteBtn.className = 'gb-subpanel-button gb-subpanel-promote-btn';
    _promoteBtn.dataset.testid = 'gb-subpanel-promote';
    _promoteBtn.dataset.e2eId = 'gb-subpanel-promote';
    _promoteBtn.title = 'メインパネルで開く';
    _promoteBtn.setAttribute('aria-label', 'メインパネルで開く');
    _promoteBtn.hidden = true;
    const promoteIcon = document.createElement('span');
    promoteIcon.className = 'gb-subpanel-promote-icon';
    promoteIcon.setAttribute('aria-hidden', 'true');
    promoteIcon.innerHTML = typeof lucide === 'function' ? lucide('squareArrowOutUpLeft', 16) : '';
    _promoteBtn.append(promoteIcon);
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

    _contentEl = document.createElement('div');
    _contentEl.id = CONTENT_ID;
    _contentEl.className = 'gb-subpanel-content';
    _contentEl.dataset.testid = 'gb-subpanel-content';

    root.append(titlebar, _contentEl);
    if (typeof MeldexDnD !== 'undefined' && MeldexDnD.installSurfaceDropTarget) {
      MeldexDnD.installSurfaceDropTarget(root, item => _openDroppedItem(item));
    }
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
    if ((root.parentNode && root.isConnected !== false) || !document.body?.appendChild) return root;
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

  async function _closeForMobileDrawer(options = {}) {
    if (!_current) {
      _showEmptyState();
      return true;
    }
    if (!options.alreadyFlushed) {
      try {
        const flushResult = await _flushBeforeTransition(_current);
        if (!flushResult?.ok) return false;
      } catch {
        return false;
      }
    }
    if (await _retractCurrentContent({ remount: false }) === false) return false;
    _current = null;
    _navHistory = [];
    _navIndex = -1;
    _showEmptyState();
    window.GBEditorHost?.returnToMain?.();
    return true;
  }

  // ---- 公開API ----

  // ボードのリンク計画 (2026-08-13) Phase B-0:
  // サブパネルへ表示するなら、右サイドバーが見える状態になっていなければ意味がない。
  // 呼び出し側それぞれが開こうとする作りをやめ、ここで1回だけ行う。
  // 既定は開く。選択に連動した自動表示（Phase C）だけが reveal:false を渡し、
  // 「すでに開いているときだけ差し替える」挙動になる。
  function _subpanelIsVisible() {
    try {
      const root = document.getElementById(ROOT_ID);
      if (!root || !root.isConnected) return false;
      const rect = root.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    } catch {
      return false;
    }
  }

  function _revealRightSidebar() {
    // すでに見えているなら何もしない。開き直すとレイアウトの再描画が走り、
    // 表示中の内容が作り直されてしまう（内容の置き換え時に消える原因になる）。
    if (_subpanelIsVisible()) return;
    if (window.GBIndependentSubpanel?.open()) return;
    const reveal = window.MeldexRightSidebarReveal?.reveal;
    if (typeof reveal === 'function') {
      reveal('subpanel');
      return;
    }
    if (typeof openRightPanelTab === 'function') openRightPanelTab('subpanel');
  }

  // ---- サブパネルのタブ（メインパネルと同じくファイル／フォルダを1件ずつタブにする） ----
  // 表示の仕組み（保存の確定→退避→描画）は従来の1件表示をそのまま使い、表示中のタブだけを描く。
  // タブの一覧は「サブパネル」の土台タブの state.subTabs としてレイアウトへ保存し、再起動後も残す。
  const TAB_MIME = 'application/x-meldex-subpanel-tab';
  const MAIN_TAB_MIME = 'application/x-meldex-main-tab-reorder';
  let _tabs = [];
  let _activeId = '';
  let _tabSeq = 0;
  let _stripEl = null;
  let _restored = false;

  function _newTabId() { return 'sp-tab-' + Date.now().toString(36) + '-' + (++_tabSeq); }
  function _activeTab() { return _tabs.find(tab => tab.id === _activeId) || null; }
  function _sameTarget(a, b) { return !!(a && b && a.type === b.type && String(a.path || '') === String(b.path || '')); }
  function _hostPane() {
    if (typeof GBLayout === 'undefined' || !GBLayout.root || typeof GBLayout.getAllPanes !== 'function') return null;
    return GBLayout.getAllPanes(GBLayout.root).find(pane => pane?.meldexRole === 'subpanel-workspace') || null;
  }
  function _hostTab() { return _hostPane()?.tabs?.[0] || null; }
  function _portableState(state) {
    if (!state || typeof state !== 'object') return {};
    try {
      const text = JSON.stringify(state);
      return text.length <= 20000 ? JSON.parse(text) : {};
    } catch { return {}; }
  }
  function _persistTabs() {
    const host = _hostTab();
    if (!host) return;
    host.state = {
      ...(host.state || {}),
      subTabs: _tabs.map(tab => {
        const entry = tab.history[tab.index] || tab.entry;
        return { type: entry.type, path: entry.path, label: entry.label, state: _portableState(entry.state) };
      }),
      activeSubTab: Math.max(0, _tabs.findIndex(tab => tab.id === _activeId)),
    };
    try { GBLayout.saveLayout?.(); } catch { /* 保存できなくても表示は続ける */ }
  }
  function _syncActiveHistory() {
    const tab = _activeTab();
    if (!tab) return;
    tab.history = _navHistory;
    tab.index = _navIndex;
    tab.entry = _navHistory[_navIndex] || tab.entry;
  }
  function _useTabHistory(tab) {
    _navHistory = tab ? tab.history : [];
    _navIndex = tab ? tab.index : -1;
  }
  function _restoreTabsFromLayout() {
    if (_restored) return;
    const host = _hostTab();
    if (!host) return;
    _restored = true;
    const saved = Array.isArray(host.state?.subTabs) ? host.state.subTabs : [];
    _tabs = saved.filter(item => item && item.type && item.path).slice(0, 50).map(item => {
      const entry = { type: String(item.type), path: String(item.path), label: item.label || _basename(item.path), state: item.state && typeof item.state === 'object' ? item.state : {} };
      return { id: _newTabId(), entry, history: [entry], index: 0 };
    });
    const index = Math.min(_tabs.length - 1, Math.max(0, Number(host.state?.activeSubTab) || 0));
    _activeId = _tabs[index]?.id || '';
  }

  async function _showTab(tab) {
    if (!tab) return false;
    const seq = ++_opSeq;
    return _guardedTransition(seq, () => {
      _activeId = tab.id;
      _useTabHistory(tab);
      _renderTarget(tab.history[tab.index]);
      _updateNavUi();
      _renderStrip();
      _persistTabs();
      return true;
    });
  }

  async function activateTab(id) {
    const tab = _tabs.find(item => item.id === id);
    if (!tab) return false;
    if (tab.id === _activeId && _current && _sameTarget(_current, tab.history[tab.index])) { _renderStrip(); return true; }
    return _showTab(tab);
  }

  async function open(target, options) {
    const opts = options || {};
    const seq = ++_opSeq;
    _restoreTabsFromLayout();
    // スマホのドロワー表示は _openMobileDrawer が自前で開くため、右レールの操作はしない。
    try {
      if (opts.reveal !== false && !_isMobileDrawerEnabled()) _revealRightSidebar();
    } catch { /* 右レールを開けない環境でも、表示処理そのものは続ける */ }
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
    // 同じファイルのタブがあればそれを表示する（同じファイルを2つのタブで開かない）。
    let tab = _tabs.find(item => _sameTarget(item.history[item.index], entry));
    let added = false;
    if (!tab) {
      tab = { id: _newTabId(), entry, history: [entry], index: 0 };
      const activeIndex = _tabs.findIndex(item => item.id === _activeId);
      const at = Number.isInteger(opts.index) ? Math.max(0, Math.min(_tabs.length, opts.index)) : (activeIndex >= 0 ? activeIndex + 1 : _tabs.length);
      _tabs.splice(at, 0, tab);
      added = true;
    } else {
      tab.history[tab.index] = { ...tab.history[tab.index], ...entry, state: { ...(tab.history[tab.index].state || {}), ...(entry.state || {}) } };
    }
    const transitioned = await _guardedTransition(seq, () => {
      _activeId = tab.id;
      _useTabHistory(tab);
      _renderTarget(tab.history[tab.index]);
      _updateNavUi();
      _renderStrip();
      _persistTabs();
      return true;
    });
    if (!transitioned) {
      // 保存を確認できずに切り替えられなかった時は、追加しただけのタブを残さない。
      if (added && tab.id !== _activeId) _tabs = _tabs.filter(item => item !== tab);
      _renderStrip();
      return false;
    }
    return mobile ? _openMobileDrawer(tab.history[tab.index]) : true;
  }

  // タブを閉じる。表示中のタブなら保存を確定してから閉じ、隣のタブを表示する。
  async function closeTab(id, options = {}) {
    const tab = _tabs.find(item => item.id === id);
    if (!tab) return true;
    if (tab.id !== _activeId) {
      _tabs = _tabs.filter(item => item !== tab);
      _renderStrip(); _persistTabs();
      return true;
    }
    if (options.alreadyFlushed) {
      if (await _retractCurrentContent({ remount: true }) === false) return false;
    } else if (!await _guardedTransition(++_opSeq, () => true)) return false;
    const index = _tabs.indexOf(tab);
    if (index >= 0) _tabs.splice(index, 1);
    _current = null;
    const next = _tabs[index] || _tabs[index - 1] || null;
    if (next) {
      _activeId = next.id;
      _useTabHistory(next);
      _renderTarget(next.history[next.index]);
      _updateNavUi();
    } else {
      _activeId = '';
      _useTabHistory(null);
      _showEmptyState();
      window.GBEditorHost?.returnToMain?.();
    }
    _renderStrip(); _persistTabs();
    return true;
  }

  // メインパネル等へ移すため、保存を確定してからタブを取り出す（取り出したタブの対象を返す）。
  async function takeTab(id) {
    const tab = _tabs.find(item => item.id === id);
    if (!tab) return null;
    const entry = { ...(tab.history[tab.index] || tab.entry) };
    if (tab.id === _activeId) {
      _captureCurrentEntryState();
      const live = _current && _sameTarget(_current, entry) ? { ..._current } : entry;
      if (!await closeTab(id)) return null;
      return live;
    }
    await closeTab(id);
    return entry;
  }

  function _moveTabWithin(id, index) {
    const from = _tabs.findIndex(item => item.id === id);
    if (from < 0) return;
    const [tab] = _tabs.splice(from, 1);
    const at = Math.max(0, Math.min(_tabs.length, index > from ? index - 1 : index));
    _tabs.splice(at, 0, tab);
    _renderStrip(); _persistTabs();
  }

  // タブの「…」と右クリックのメニュー。メインパネルのタブのメニューと同じ部品・同じ項目に、
  // 「メインパネルで開く」を先頭に加える。
  function _showTabMenu(event, tab) {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    const entry = tab.history[tab.index] || tab.entry;
    const index = _tabs.indexOf(tab);
    const menuTab = { id: tab.id, type: entry.type, path: entry.path, label: entry.label };
    const adapter = {
      index,
      count: _tabs.length,
      leadingItems: [{
        label: 'メインパネルで開く', icon: 'squareArrowOutUpLeft',
        disabled: !entry.path || entry.type === 'unsupported',
        action: async () => { if (await activateTab(tab.id)) await promoteToMainPane(); },
      }],
      openInNewWindow: async () => {
        // 保存を確定してから新しいウィンドウで開き、開けた時だけこのタブを閉じる（メインパネルと同じ）。
        if (tab.id === _activeId && !(await _flushBeforeTransition(_current)).ok) {
          if (typeof showStatus === 'function') showStatus('保存を確認できませんでした。もう一度お試しください', true);
          return;
        }
        GBLayout.openTabInNewWindow?.(menuTab, () => { closeTab(tab.id); });
      },
      close: () => closeTab(tab.id),
      closeSide: async side => {
        const at = _tabs.indexOf(tab);
        const targets = _tabs.filter((_, i) => (side === 'left' ? i < at : i > at));
        for (const other of targets) if (!await closeTab(other.id)) return false;
        return true;
      },
      closeOthers: async () => {
        for (const other of [..._tabs]) if (other.id !== tab.id && !await closeTab(other.id)) return false;
        return true;
      },
    };
    if (typeof GBLayout !== 'undefined' && typeof GBLayout.showTabMenu === 'function') {
      GBLayout.showTabMenu(event, _hostPane()?.id || '', menuTab, adapter);
    }
  }

  function _clearStripMarkers(strip) {
    strip.querySelectorAll('.gb-tab-drop-before,.gb-tab-drop-after').forEach(el => el.classList.remove('gb-tab-drop-before', 'gb-tab-drop-after'));
  }

  function _insertIndexAt(strip, clientX) {
    const els = [...strip.querySelectorAll(':scope > .gb-tab')];
    const before = els.find(el => { const r = el.getBoundingClientRect(); return clientX < r.left + r.width / 2; });
    if (!before) return _tabs.length;
    const i = _tabs.findIndex(tab => tab.id === before.dataset.subpanelTabId);
    return i < 0 ? _tabs.length : i;
  }

  function _dropKinds(event) {
    const types = Array.from(event.dataTransfer?.types || []);
    return {
      own: types.includes(TAB_MIME),
      main: types.includes(MAIN_TAB_MIME),
      node: types.includes('application/x-meldex-node') || !!(typeof MeldexDnD !== 'undefined' && MeldexDnD.hasDropKind?.(event, 'node')),
    };
  }

  async function _handleStripDrop(event, strip) {
    const kinds = _dropKinds(event);
    if (!kinds.own && !kinds.main && !kinds.node) return;
    event.preventDefault(); event.stopPropagation();
    _clearStripMarkers(strip);
    const index = _insertIndexAt(strip, event.clientX);
    // サブパネル内の並べ替え
    let own = null;
    try { own = JSON.parse(event.dataTransfer.getData(TAB_MIME) || 'null'); } catch { own = null; }
    if (own?.id) { _moveTabWithin(own.id, index); return; }
    // メインパネルのタブを移す（メイン側の保存を確定して閉じてから、サブパネルで開く）
    let main = null;
    try { main = JSON.parse(event.dataTransfer.getData(MAIN_TAB_MIME) || 'null'); } catch { main = null; }
    if (main?.paneId && main?.tabId && await moveMainTab(main.paneId, main.tabId, { index }) !== null) return;
    // フォルダツリー等からのファイル／フォルダ（1件ずつ）
    const resolved = typeof MeldexDnD !== 'undefined' ? await MeldexDnD.resolveDropData?.(event, 'node') : null;
    let payload = resolved?.payload || null;
    if (!payload) { try { payload = JSON.parse(event.dataTransfer.getData('application/x-meldex-node') || 'null'); } catch { payload = null; } }
    const items = Array.isArray(payload?.items) && payload.items.length ? payload.items : (payload?.path ? [payload] : []);
    if (!items.length) return;
    if (items.length > 1) {
      if (resolved) MeldexDnD.failDrop?.(resolved);
      if (typeof showStatus === 'function') showStatus('複数選択はタブ列へ一括追加できないため、全件を変更しませんでした', true);
      return;
    }
    const ok = await _openDroppedItem(items[0], { index });
    if (resolved) (ok ? MeldexDnD.completeDrop?.(resolved) : MeldexDnD.failDrop?.(resolved));
  }

  // メインパネルのタブをサブパネルへ移す（タブのD&Dとタブのメニュー「サブパネルで開く」で共通）。
  // メイン側の表示状態（スクロール位置など）を引き継ぎ、保存を確定してメインのタブを閉じてから開く。
  // 対象のタブが無い時は null、閉じられなかった・開けなかった時は false を返す。
  async function moveMainTab(paneId, tabId, options = {}) {
    const mainPane = paneId && typeof GBLayout !== 'undefined' ? GBLayout.findNode(GBLayout.root, paneId)?.node : null;
    const mainTab = mainPane?.tabs?.find(tab => tab.id === tabId) || null;
    if (!mainTab?.path) return null;
    let state = { ...(mainTab.state || {}) };
    if (typeof getComponentInstance === 'function') {
      try {
        const live = getComponentInstance(mainTab.id)?.getState?.();
        if (live && typeof live === 'object') state = { ...state, ...live };
      } catch { /* 取得できない時は保存済みの状態を使う */ }
    }
    const target = { type: mainTab.type, path: mainTab.path, label: mainTab.label, state };
    if (await GBTabs.closeTab(paneId, mainTab.id) === false) return false;
    return open(target, { index: options.index });
  }

  function _installStripDrop(strip) {
    if (strip.dataset.subpanelStripDrop === '1') return;
    strip.dataset.subpanelStripDrop = '1';
    strip.addEventListener('dragover', event => {
      const kinds = _dropKinds(event);
      if (!kinds.own && !kinds.main && !kinds.node) return;
      event.preventDefault(); event.stopPropagation();
      event.dataTransfer.dropEffect = kinds.own || kinds.main ? 'move' : 'copy';
      _clearStripMarkers(strip);
      const els = [...strip.querySelectorAll(':scope > .gb-tab')];
      const before = els.find(el => { const r = el.getBoundingClientRect(); return event.clientX < r.left + r.width / 2; });
      if (before) before.classList.add('gb-tab-drop-before'); else els.at(-1)?.classList.add('gb-tab-drop-after');
    });
    strip.addEventListener('dragleave', event => {
      if (strip.contains(event.relatedTarget)) return;
      _clearStripMarkers(strip);
    });
    strip.addEventListener('drop', event => { _handleStripDrop(event, strip); });
  }

  function _renderStrip() {
    // タブバーは描画中（まだ画面に付く前）にも渡されるため、接続を待たずに中身を作る。
    const strip = _stripEl;
    if (!strip) return;
    strip.querySelectorAll(':scope > .gb-tab, :scope > .gb-subpanel-tabs-empty').forEach(el => el.remove());
    // ＋ボタン（メインパネルと同じ「新しいパネルを追加」）は常に最後のタブの次に置く。
    const addButton = strip.querySelector(':scope > .gb-pane-add-tab');
    const place = el => (addButton ? strip.insertBefore(el, addButton) : strip.appendChild(el));
    if (!_tabs.length) {
      const empty = document.createElement('span');
      empty.className = 'gb-subpanel-tabs-empty';
      empty.textContent = 'サブパネル';
      place(empty);
      return;
    }
    const hostId = _hostPane()?.id || 'subpanel';
    for (const tab of _tabs) {
      const entry = tab.history[tab.index] || tab.entry;
      const tabLike = { id: tab.id, type: entry.type, path: entry.path, label: entry.label || _toolLabel(entry.type), icon: _tabIcon(entry.type) };
      const el = typeof GBLayout !== 'undefined' && typeof GBLayout.createPaneTabElement === 'function'
        ? GBLayout.createPaneTabElement(tabLike, {
          active: tab.id === _activeId,
          e2eId: 'subpanel-tab-' + tab.id,
          moreE2eId: 'subpanel-tab-' + tab.id + '-actions',
          onMore: event => _showTabMenu(event, tab),
        })
        : Object.assign(document.createElement('div'), { className: 'gb-tab' + (tab.id === _activeId ? ' active' : ''), textContent: tabLike.label });
      el.dataset.subpanelTabId = tab.id;
      el.dataset.subpanelHost = hostId;
      el.title = entry.path || entry.label || '';
      el.draggable = true;
      el.addEventListener('click', () => { activateTab(tab.id); });
      el.addEventListener('auxclick', event => { if (event.button === 1) { event.preventDefault(); closeTab(tab.id); } });
      el.addEventListener('contextmenu', event => _showTabMenu(event, tab));
      if (typeof addLongPressHandler === 'function') addLongPressHandler(el, event => _showTabMenu(event, tab));
      el.addEventListener('dragstart', event => {
        if (event.target?.closest?.('.gb-tab-more')) { event.preventDefault(); return; }
        event.dataTransfer.setData(TAB_MIME, JSON.stringify({ id: tab.id }));
        if (typeof MeldexDnD !== 'undefined') MeldexDnD.writeNodePayload?.(event.dataTransfer, { name: entry.label, label: entry.label, path: entry.path, type: entry.type }, 'subpanel');
        event.dataTransfer.effectAllowed = 'copyMove';
        if (typeof setLowOpacityDragImage === 'function') setLowOpacityDragImage(event, el, 0.35);
        el.classList.add('dragging');
      });
      el.addEventListener('dragend', () => el.classList.remove('dragging'));
      place(el);
    }
  }

  // パネルのタブバー（gb-layout の renderPane）から呼ばれる。サブパネルの土台タブの代わりに、
  // 開いているファイル／フォルダのタブを並べる。保存済みのタブは、パネルが見えている時に表示する。
  function renderTabStrip(container, node) {
    _restoreTabsFromLayout();
    _stripEl = container;
    container.classList.add('gb-subpanel-tab-strip');
    _installStripDrop(container);
    _renderStrip();
    const active = _activeTab();
    if (active && !node?.collapsed && (!_current || !_sameTarget(_current, active.history[active.index]))) {
      setTimeout(() => {
        if (_activeTab() === active && !_sameTarget(_current, active.history[active.index])) _showTab(active);
      }, 0);
    }
  }

  async function closeContent(options = {}) {
    if (!_current) return true;
    const drawer = window.MeldexCloudMobileSideDrawer;
    if (_isMobileDrawerEnabled() && drawer?.isOpen?.() && typeof drawer.close === 'function') {
      if (options.alreadyFlushed && await _closeForMobileDrawer({ alreadyFlushed: true }) === false) return false;
      return (await drawer.close()) !== false;
    }
    // 表示中のタブを閉じる（ほかのタブは残す）。
    if (_activeId) return closeTab(_activeId, { alreadyFlushed: !!options.alreadyFlushed });
    if (options.alreadyFlushed) {
      if (await _retractCurrentContent({ remount: true }) === false) return false;
      _current = null;
      _useTabHistory(null);
      _showEmptyState();
      window.GBEditorHost?.returnToMain?.();
      return true;
    }
    const seq = ++_opSeq;
    return _guardedTransition(seq, () => {
      _current = null;
      _useTabHistory(null);
      _showEmptyState();
      window.GBEditorHost?.returnToMain?.();
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
      _syncActiveHistory();
      _renderTarget(entry);
      _updateNavUi();
      _renderStrip(); _persistTabs();
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
      _syncActiveHistory();
      _renderTarget(entry);
      _updateNavUi();
      _renderStrip(); _persistTabs();
      return true;
    });
  }

  // 「メインパネルで開く」: 保存flush後、必ず新規タブを作ってアクティブ化する
  // （GBTabs.addTab の第6引数 options.forceNewTab=true が重複防止を全てスキップする）。
  async function promoteToMainPane() {
    if (!_current || !_current.path) return false;
    const seq = ++_opSeq;
    _captureCurrentEntryState();
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
    // 昇格直前にライブ状態を取得してからマージする（メインパネルへの昇格経路と
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
    if (seq !== _opSeq) return false;
    if (await closeContent({ alreadyFlushed: true }) === false) return false;
    // ほかのタブが残っている時はサブパネルを開いたままにする。
    if (!_tabs.length && window.GBIndependentSubpanel?.close && await window.GBIndependentSubpanel.close() === false) return false;
    return true;
  }

  function isOpen() {
    return !!_current;
  }

  // トピック名の変更をタブ名へ反映する。
  function _onEntryLabelChanged() {
    _renderStrip();
    _persistTabs();
  }

  function navState() {
    return { canBack: _navIndex > 0, canForward: _navIndex >= 0 && _navIndex < _navHistory.length - 1 };
  }

  function getCurrentTarget() {
    return _current ? { ..._current } : null;
  }

  function onPathRename(oldPath, newPath, options = {}) {
    window.GBEditorHost?.onPathRename?.(oldPath, newPath, options);
    if (!oldPath || !newPath || typeof _mapRenamedPath !== 'function') return;
    const frame = _contentEl?.querySelector('.gb-subpanel-viewer-frame');
    const viewerState = frame ? _captureViewerFrameState(frame) : null;
    const updateViewerUrl = value => {
      if (!value) return value;
      try {
        const url = new URL(value, location.href);
        let changed = false;
        ['file', 'pdf', 'path'].forEach(key => {
          if (!url.searchParams.has(key)) return;
          const path = url.searchParams.get(key);
          const next = _mapRenamedPath(path, oldPath, newPath);
          if (next !== path) { url.searchParams.set(key, next); changed = true; }
        });
        return changed ? url.href : value;
      } catch { return value; }
    };
    const update = entry => {
      if (!entry) return;
      const exact = entry.path === oldPath;
      _updatePathRefs(entry, APP_PATH_REF_KEYS, oldPath, newPath);
      if (entry.state) _updatePathRefs(entry.state, APP_PATH_REF_KEYS, oldPath, newPath);
      if (entry.state?.viewerUrl) entry.state.viewerUrl = updateViewerUrl(entry.state.viewerUrl);
      if (exact && options.label != null) entry.label = options.label;
    };
    [_current, ..._navHistory, ...(_pane?.tabs || []), ..._tabs.flatMap(tab => [tab.entry, ...tab.history])].forEach(update);
    _renderStrip(); _persistTabs();
    _sheetEmbed?.onPathRename?.(oldPath, newPath)?.catch?.(error => {
      if (typeof showStatus === 'function') showStatus('移動後のシートを確認できませんでした: ' + error.message, true);
    });
    _contentEl?.querySelectorAll('[data-path],[data-db-path],[data-entity-path]').forEach(el => {
      ['path', 'dbPath', 'entityPath'].forEach(key => {
        if (el.dataset[key]) el.dataset[key] = _mapRenamedPath(el.dataset[key], oldPath, newPath);
      });
    });
    if (frame) {
      const url = updateViewerUrl(frame.src);
      if (url !== frame.src) {
        frame.addEventListener('load', () => _restoreViewerFrameState(frame, viewerState), { once: true });
        frame.src = url;
      }
    }
    if (_current) _updateHeader(_current);
  }

  return {
    open,
    flush: async () => (await _flushBeforeTransition(_current)).ok,
    close: closeContent,
    navBack,
    navForward,
    navState,
    promoteToMainPane,
    moveMainTab,
    activateTab,
    closeTab,
    takeTab,
    // すべてのタブを閉じる（保存を確定できないタブがあればそこで止める）。
    closeAll: async () => {
      const drawer = window.MeldexCloudMobileSideDrawer;
      const closeDrawer = _root?.classList.contains('cloud-mobile-side-drawer-panel-content') && drawer?.isOpen?.();
      for (const tab of [..._tabs].reverse()) if (!await closeTab(tab.id)) return false;
      // 最後のタブを閉じると_currentは空になる。外側のドロワーも閉じてメインへ戻す。
      if (closeDrawer) return (await drawer.close()) !== false;
      return closeContent();
    },
    renderTabStrip,
    getTabs: () => _tabs.map(tab => ({ id: tab.id, active: tab.id === _activeId, ...(tab.history[tab.index] || tab.entry) })),
    TAB_MIME,
    createRootElement,
    isOpen,
    getCurrentTarget,
    onPathRename,
  };
})();

if (typeof window !== 'undefined') window.GBSubPanel = GBSubPanel;
