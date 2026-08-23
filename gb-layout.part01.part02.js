          );
        }
      });
      if (resolved && openedFromDrop > 0) MeldexDnD.completeDrop(resolved);
      else if (resolved) MeldexDnD.failDrop(resolved);
    });

    pane.appendChild(tabBar);

    // コンテンツエリア
    const content = document.createElement('div');
    content.className = 'gb-pane-content';
    pane.appendChild(content);

    // ペインクリックでアクティブ化。ナビペイン本文の通常クリックは作業ペインを保持する。
    // 通常の行クリック等は click 配信が終わるまで同期副作用を遅延し、
    // 同一クリック内でコンテンツDOMが差し替わらないようにする。
    pane.addEventListener('pointerdown', (e) => {
      if (e.button === 0) _blurFocusedChatInputForWorkPanePointer(node, e.target);
      if (e.button === 0 && _isPassivePaneActiveTab(node) && e.target.closest('.gb-pane-content, .gb-pane-tabs')) return;
      if (_activePane === node.id) return;
      if (e.target.closest('.gb-legacy-snapshot-host')) {
        _activatePaneAfterCurrentPointerClick(node.id);
        return;
      }
      if (e.button === 0 && _isPaneWorkContentPointerTarget(e.target)) {
        _activatePaneAfterCurrentPointerClick(node.id);
        return;
      }
      if (e.button === 0 && _isPaneInteractivePointerTarget(e.target)) {
        if (e.target.closest('.gb-pane-content')) {
          _activatePaneAfterCurrentPointerClick(node.id);
          return;
        }
        setActivePane(node.id, { skipCallback: true });
        return;
      }
      if (e.button === 0 && _shouldPreserveActivePaneForNavContentPointer(node, e.target)) return;
      if (e.button !== 0) { setActivePane(node.id, { sync: true }); return; }
      _activatePaneAfterCurrentPointerClick(node.id);
    }, true);

    // ペインマップに登録
    _paneMap[node.id] = { node, el: pane, contentEl: content };
    _updatePaneNavButtons(node.id);

    // タブは自然幅 -> ラベル付き最小72px -> アイコンのみ、の順で縮退する。
    // compact 化してもなお溢れる場合だけ tabsScroll が横スクロールで対応する。
    if (typeof ResizeObserver === 'function') {
      const updateCompact = () => {
        tabBar.classList.remove('gb-tabs-shrink', 'gb-tabs-compact');
        // class 変更後のレイアウトを反映させるため強制 reflow
        void tabsScroll.offsetWidth;
        if (tabsScroll.scrollWidth > tabsScroll.clientWidth + 1) {
          tabBar.classList.add('gb-tabs-shrink');
          void tabsScroll.offsetWidth;
          if (tabsScroll.scrollWidth > tabsScroll.clientWidth + 1) {
            tabBar.classList.remove('gb-tabs-shrink');
            tabBar.classList.add('gb-tabs-compact');
          }
        }
        const iconOnly = tabBar.classList.contains('gb-tabs-compact');
        tabsScroll.querySelectorAll('.gb-tab').forEach((tabEl) => {
          const title = tabEl.dataset.tabTitle || tabEl.querySelector('.gb-tab-label')?.textContent || 'タブ';
          tabEl.title = iconOnly ? title : '';
          tabEl.setAttribute('aria-label', title);
        });
      };
      const ro = new ResizeObserver(updateCompact);
      ro.observe(tabsScroll);
      _paneMap[node.id].observer = ro;
    }

    return pane;
  }

  function refreshPaneTabs(paneId) {
    if (!_layoutEl || !paneId) return false;
    if (_isMobileLayout() || _maximizedPaneId) return false;
    const currentInfo = _paneMap[paneId];
    const currentPaneEl = currentInfo?.el;
    const currentContentEl = currentInfo?.contentEl;
    if (!currentPaneEl || !currentContentEl || !currentPaneEl.isConnected) return false;
    const found = findNode(_root, paneId);
    const node = found?.node;
    if (!node || node.type !== 'pane') return false;
    const oldTabBar = currentPaneEl.querySelector(':scope > .gb-pane-tabs');
    if (!oldTabBar) return false;

    if (currentInfo.observer && typeof currentInfo.observer.disconnect === 'function') {
      currentInfo.observer.disconnect();
    }
    const renderedPane = renderPane(node, 0);
    const renderedInfo = _paneMap[paneId] || {};
    const newTabBar = renderedPane.querySelector(':scope > .gb-pane-tabs');
    if (!newTabBar) {
      _paneMap[paneId] = currentInfo;
      return false;
    }

    currentPaneEl.className = renderedPane.className;
    currentPaneEl.dataset.paneId = renderedPane.dataset.paneId || paneId;
    currentPaneEl.dataset.paneLocked = renderedPane.dataset.paneLocked || (node.locked ? '1' : '0');
    if (renderedPane.dataset.meldexRole) {
      currentPaneEl.dataset.meldexRole = renderedPane.dataset.meldexRole;
    } else {
      delete currentPaneEl.dataset.meldexRole;
    }
    oldTabBar.replaceWith(newTabBar);
    _paneMap[paneId] = {
      ...renderedInfo,
      node,
      el: currentPaneEl,
      contentEl: currentContentEl,
      observer: renderedInfo.observer,
    };
    _updatePaneNavButtons(paneId);
    if (typeof replaceIcons === 'function') replaceIcons(currentPaneEl);
    return true;
  }
