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
    if (entry.loadError) {
      _renderErrorState(entry, entry.loadError);
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
    if (typeof MeldexDnD !== 'undefined' && MeldexDnD.installSurfaceDropTarget) {
      MeldexDnD.installSurfaceDropTarget(root, item => {
        const target = MeldexDnD.normalizeOpenTarget?.(item) || item;
        return open(target);
      });
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
    try {
      const flushResult = await _flushBeforeTransition(_current);
      if (!flushResult?.ok) return false;
    } catch {
      return false;
    }
    await _retractCurrentContent({ remount: false });
    _current = null;
    _navHistory = [];
    _navIndex = -1;
    _showEmptyState();
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
    const reveal = window.MeldexRightSidebarReveal?.reveal;
    if (typeof reveal === 'function') {
      reveal('subpanel');
      return;
    }
    if (typeof openRightPanelTab === 'function') openRightPanelTab('subpanel');
  }

  async function open(target, options) {
    const seq = ++_opSeq;
    // スマホのドロワー表示は _openMobileDrawer が自前で開くため、右レールの操作はしない。
    try {
      if ((options || {}).reveal !== false && !_isMobileDrawerEnabled()) _revealRightSidebar();
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
