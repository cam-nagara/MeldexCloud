/**
 * Meldex Tool Menu
 * 各ツールのツールバー左端に表示するメニューボタンの共通機能
 */

function _toolMenuVisibleItems(menu) {
  return [...(menu?.querySelectorAll?.('.gb-context-menu-item') || [])]
    .filter(item => {
      if (!(item instanceof HTMLElement) || item.disabled || item.classList.contains('disabled')) return false;
      const rect = item.getBoundingClientRect();
      const style = getComputedStyle(item);
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    });
}

function _toolMenuAppendIcon(row, iconName) {
  if (!iconName) return;
  const icon = document.createElement('span');
  icon.className = 'menu-icon';
  icon.innerHTML = lucide(iconName, 14);
  row.appendChild(icon);
}

function _toolMenuAppendLabel(row, label) {
  const labelEl = document.createElement('span');
  labelEl.className = 'menu-label';
  labelEl.textContent = label || '';
  row.appendChild(labelEl);
}

function _toolMenuAppendShortcut(row, shortcut) {
  const shortcutEl = document.createElement('span');
  shortcutEl.className = 'menu-shortcut';
  shortcutEl.textContent = shortcut || '';
  row.appendChild(shortcutEl);
  return shortcutEl;
}

function _toolMenuFocusMove(menu, direction) {
  const items = _toolMenuVisibleItems(menu);
  if (!items.length) return;
  const currentIndex = Math.max(0, items.indexOf(document.activeElement));
  const nextIndex = direction === 'last'
    ? items.length - 1
    : direction === 'first'
      ? 0
      : (currentIndex + direction + items.length) % items.length;
  items[nextIndex]?.focus?.();
}

// ツールメニュー項目を描画する（サブメニュー対応）
function _renderToolMenuItems(container, items, isSubmenu, rootMenu) {
  const rootDd = rootMenu || container;
  const closeRootMenu = (restoreFocus = false) => {
    if (typeof rootDd?._cleanup === 'function') rootDd._cleanup({ restoreFocus });
    else document.querySelectorAll('.tool-menu-dropdown').forEach(m => m.remove());
  };
  items.forEach(item => {
    if (item.separator) {
      const sep = document.createElement('div');
      sep.className = 'gb-context-menu-sep ab-dropdown-sep';
      sep.setAttribute('role', 'separator');
      container.appendChild(sep);
      return;
    }
    if (item.submenu) {
      // サブメニュートリガー
      const wrap = document.createElement('div');
      wrap.className = 'tool-menu-submenu-wrap';
      const trigger = document.createElement('button');
      trigger.type = 'button';
      trigger.className = 'gb-context-menu-item ab-dropdown-item tool-menu-submenu-trigger';
      trigger.setAttribute('role', 'menuitem');
      trigger.setAttribute('aria-haspopup', 'menu');
      trigger.setAttribute('aria-expanded', 'false');
      _toolMenuAppendIcon(trigger, item.icon);
      _toolMenuAppendLabel(trigger, item.label);
      const arrow = _toolMenuAppendShortcut(trigger, '');
      arrow.innerHTML = lucide('chevronRight', 12);
      const sub = document.createElement('div');
      sub.className = 'gb-context-menu ab-dropdown ab-sub-menu tool-menu-dropdown tool-menu-submenu';
      sub.setAttribute('role', 'menu');
      sub.setAttribute('aria-label', item.label || 'サブメニュー');
      sub.style.cssText = 'display:none;min-width:200px;';
      _renderToolMenuItems(sub, item.submenu, true, rootDd);
      attachHoverSubmenu(trigger, sub);
      trigger.addEventListener('mouseenter', () => trigger.setAttribute('aria-expanded', 'true'));
      trigger.addEventListener('mouseleave', () => {
        setTimeout(() => {
          if (!sub.isConnected || getComputedStyle(sub).display === 'none') trigger.setAttribute('aria-expanded', 'false');
        }, 220);
      });
      wrap.appendChild(trigger);
      wrap.appendChild(sub);
      container.appendChild(wrap);
      return;
    }
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'gb-context-menu-item ab-dropdown-item';
    el.setAttribute('role', 'menuitem');
    if (item.shortcut) {
      _toolMenuAppendLabel(el, item.label);
      _toolMenuAppendShortcut(el, item.shortcut);
    } else if (item.icon) {
      _toolMenuAppendIcon(el, item.icon);
      _toolMenuAppendLabel(el, item.label);
    } else {
      el.textContent = item.label;
    }
    if (item.disabled) {
      el.disabled = true;
      el.classList.add('disabled');
      el.setAttribute('aria-disabled', 'true');
    }
    el.addEventListener('click', () => {
      const actionContext = { trigger: rootDd?._sourceButton || null, menuItem: el };
      closeRootMenu(false);
      item.action?.(actionContext);
    });
    container.appendChild(el);
  });
}

// ツールメニューを生成・表示する共通関数
function _resolveToolMenuButton(event) {
  const rawTarget = event?.target;
  if (rawTarget?.closest) {
    const direct = rawTarget.closest('.tool-menu-btn');
    if (direct) return direct;
  }
  if (typeof event?.composedPath === 'function') {
    const path = event.composedPath();
    for (const node of path) {
      if (node?.classList?.contains?.('tool-menu-btn')) return node;
      if (node?.closest) {
        const nested = node.closest('.tool-menu-btn');
        if (nested) return nested;
      }
    }
  }
  if (document.activeElement?.closest) {
    return document.activeElement.closest('.tool-menu-btn');
  }
  return null;
}

function showToolMenu(e, toolType) {
  e.stopPropagation();
  if (window.MeldexCloudMobileEditBar?.openToolMenu?.(toolType, e)) return;
  const btn = _resolveToolMenuButton(e);
  document.querySelectorAll('.tool-menu-dropdown').forEach(el => el.remove());

  const dd = document.createElement('div');
  dd.className = 'gb-context-menu ab-dropdown tool-menu-dropdown';
  dd.dataset.toolMenuRoot = '1';
  dd._sourceButton = btn || null;
  dd.setAttribute('role', 'menu');
  dd.setAttribute('aria-label', 'ツールメニュー');
  dd.style.cssText = 'position:fixed;z-index:9999;min-width:220px;';

  const items = buildToolMenuItems(toolType);
  _renderToolMenuItems(dd, items, false, dd);

  const rect = btn ? btn.getBoundingClientRect() : { left: e.clientX, bottom: e.clientY };
  document.body.appendChild(dd);
  if (typeof positionPopup === 'function') {
    positionPopup(dd, rect, { prefer: 'below', gap: 2 });
  } else if (typeof clampPopupToViewport === 'function') {
    const z = _getZoom();
    dd.style.left = (rect.left / z) + 'px';
    dd.style.top = (rect.bottom / z + 2) + 'px';
    clampPopupToViewport(dd);
  }
  btn?.setAttribute?.('aria-haspopup', 'menu');
  btn?.setAttribute?.('aria-expanded', 'true');
  let pointerHandler = null;
  let keyHandler = null;
  const closeAll = (opts = {}) => {
    document.querySelectorAll('.tool-menu-dropdown').forEach(el => el.remove());
    if (pointerHandler) document.removeEventListener('pointerdown', pointerHandler, true);
    if (keyHandler) document.removeEventListener('keydown', keyHandler, true);
    pointerHandler = null;
    keyHandler = null;
    btn?.setAttribute?.('aria-expanded', 'false');
    if (opts.restoreFocus) btn?.focus?.();
  };
  dd._cleanup = closeAll;
  dd.querySelector('.gb-context-menu-item:not(:disabled)')?.focus?.();

  setTimeout(() => {
    if (!dd.isConnected) return;
    pointerHandler = (ev) => {
      const inAny = [...document.querySelectorAll('.tool-menu-dropdown')].some(m => m.contains(ev.target));
      if (!inAny && ev.target !== btn) {
        closeAll({ restoreFocus: true });
      }
    };
    keyHandler = (ev) => {
      if (ev.key === 'Escape') {
        ev.preventDefault();
        ev.stopPropagation();
        closeAll({ restoreFocus: true });
        return;
      }
      if (ev.key === 'ArrowDown') {
        ev.preventDefault();
        _toolMenuFocusMove(dd, 1);
      } else if (ev.key === 'ArrowUp') {
        ev.preventDefault();
        _toolMenuFocusMove(dd, -1);
      } else if (ev.key === 'Home') {
        ev.preventDefault();
        _toolMenuFocusMove(dd, 'first');
      } else if (ev.key === 'End') {
        ev.preventDefault();
        _toolMenuFocusMove(dd, 'last');
      }
    };
    document.addEventListener('pointerdown', pointerHandler, true);
    document.addEventListener('keydown', keyHandler, true);
  }, 0);
}

// 「最近使ったファイル」サブメニュー項目を構築
function _buildRecentSubmenuItems(toolType) {
  // Phase 1: navHistory はエクスプローラー履歴限定になったため、
  // 「最近使った」は localStorage の RECENT_KEY（addRecent が更新）から取得
  let recent = [];
  try {
    const raw = JSON.parse(localStorage.getItem('meldex-recent') || '[]');
    if (Array.isArray(raw)) recent = raw.slice(0, 8);
  } catch {}
  if (recent.length === 0) {
    return [{ label: '(なし)', disabled: true, action: () => {} }];
  }
  return recent.map(entry => ({
    label: entry.label || entry.path?.split('/').pop() || '',
    action: () => {
      if (entry?.type === 'scenario' && entry.path && typeof openScenarioInScriptNote === 'function') {
        openScenarioInScriptNote(entry.path, entry.label || '');
        return;
      }
      const openEntry = { ...entry, type: entry.type === 'database' ? 'pivot' : entry.type };
      navOpen(openEntry);
    },
  }));
}

// 現在のファイルパス取得
function getCurrentFilePath() {
  const activeTab = (typeof GBTabs !== 'undefined' && typeof GBLayout !== 'undefined') ? GBTabs.getActiveTab(GBLayout.activePane) : null;
  if (activeTab?.type === 'folder') {
    if (activeTab.path) return activeTab.path;
    if (typeof _folderPath !== 'undefined' && _folderPath) return _folderPath;
  }
  if (activeTab?.type === 'scriptnote') {
    const comp = typeof getComponentInstance === 'function' ? getComponentInstance(activeTab.id) : null;
    return comp?.state?.scenarioPath || activeTab.path || null;
  }
  if (activeTab?.path) return activeTab.path;
  if (state?.view === 'page' || state?.view === 'entity') {
    const pc = document.getElementById('page-content');
    if (pc?.dataset.path) return pc.dataset.path;
  }
  if (state?.view === 'pivot' || state?.view === 'tree' || state?.view === 'timeline' || state?.view === 'gallery'
      || state?.view === 'kanban' || state?.view === 'chart' || state?.view === 'graph' || state?.view === 'form') {
    return state.currentDbPath || null;
  }
  if (state?.view === 'board') return state.currentBoardPath || null;
  if (state?.view === 'csv') return (typeof _csvPath !== 'undefined') ? _csvPath : null;
  if (state?.view === 'calendar') return state.currentDbPath || null;
  if (state?.view === 'smart-db') return state.currentSmartDb?._filePath || state.currentDbPath || null;
  if (state?.view === 'folder' && typeof _folderPath !== 'undefined') return _folderPath || null;
  return null;
}

function getActiveScriptNoteComponent() {
  const activeTab = (typeof GBTabs !== 'undefined' && typeof GBLayout !== 'undefined') ? GBTabs.getActiveTab(GBLayout.activePane) : null;
  if (activeTab?.type === 'scriptnote') {
    return typeof getComponentInstance === 'function' ? getComponentInstance(activeTab.id) : null;
  }
  const detailTabId = window._detailScriptNoteTabId;
  if (detailTabId && typeof getComponentInstance === 'function') {
    const comp = getComponentInstance(detailTabId);
    if (comp?._editor?.doc) return comp;
  }
  return null;
}

function isScriptNotePath(path = '') {
  return /(\.mel-scenario|\.scriptnote\.json)$/i.test(String(path || '').trim());
}

function isScriptNoteBrowseItem(item) {
  return !!(item && (item.type === 'scriptnote' || isScriptNotePath(item.path || '')));
}

function isScenarioBrowseItem(item) {
  if (!item) return false;
  if (isScriptNoteBrowseItem(item)) return false;
  return item.type === 'scenario';
}

function getScriptNoteLabelFromPath(path = '', fallback = '') {
  const raw = String(path || '').trim();
  if (!raw) return fallback || 'シナリオ';
  const fileName = raw.split('/').pop() || raw.split('\\').pop() || raw;
  return fileName.replace(/\.mel-scenario$/i, '').replace(/\.scriptnote\.json$/i, '').replace(/\.[^./\\]+$/i, '') || fallback || 'シナリオ';
}

async function _probeJsonFile(path) {
  try {
    const data = await apiFetch('/file?path=' + encodeURIComponent(path));
    try {
      return { exists: true, parsed: JSON.parse(data?.content || '{}'), parseError: null };
    } catch (error) {
      return { exists: true, parsed: null, parseError: error };
    }
  } catch (error) {
    if (error?.status === 404) return { exists: false, parsed: null, error };
    return { exists: true, parsed: null, error, inaccessible: true };
  }
}

async function _resolveScriptNoteTargetFromScenario(sourcePath, label = '') {
  const sourceData = await apiFetch('/file?path=' + encodeURIComponent(sourcePath));
  const parsed = JSON.parse(sourceData?.content || '{}');
  if (typeof isScriptNoteFileDoc === 'function' && isScriptNoteFileDoc(parsed)) {
    return { path: sourcePath, label: getScriptNoteLabelFromPath(sourcePath, label), created: false };
  }
  if (!Array.isArray(parsed?.rows)) throw new Error('シナリオファイルとして読み込めません');
  if (typeof convertScenarioDocToScriptNoteDoc !== 'function') throw new Error('シナリオ形式への変換機能が見つかりません');
  const basePath = typeof suggestScriptNotePath === 'function'
    ? suggestScriptNotePath(sourcePath, parsed?.title || label || '')
    : String(sourcePath || '').replace(/\.(json|csv|xlsx|xls)$/i, '') + '.scriptnote.json';
  let candidatePath = basePath;
  for (let i = 0; i < 20; i++) {
    const probe = await _probeJsonFile(candidatePath);
    if (!probe.exists) {
      const exportDoc = convertScenarioDocToScriptNoteDoc(parsed, { sourcePath });
      await apiPut('/file?path=' + encodeURIComponent(candidatePath), {
        content: JSON.stringify(exportDoc, null, 2),
        create_only: true,
      });
      return { path: candidatePath, label: getScriptNoteLabelFromPath(candidatePath, label), created: true };
    }
    if (typeof isScriptNoteFileDoc === 'function' && isScriptNoteFileDoc(probe.parsed)) {
      return { path: candidatePath, label: getScriptNoteLabelFromPath(candidatePath, label), created: false };
    }
    candidatePath = basePath.replace(/\.scriptnote\.json$/i, ` (${i + 2}).scriptnote.json`);
  }
  throw new Error('保存先のシナリオファイルを決められませんでした');
}

function getScriptNoteTargetPaneId() {
  if (typeof GBLayout === 'undefined') return null;
  const mainPaneId = typeof GBPaneDefaultLayout !== 'undefined' && typeof GBPaneDefaultLayout.resolveMainPaneId === 'function'
    ? GBPaneDefaultLayout.resolveMainPaneId({ contentOnly: true })
    : '';
  if (mainPaneId) return mainPaneId;
  const activePaneId = GBLayout.activePane;
  if (!activePaneId) return null;
  const paneInfo = GBLayout.findNode?.(GBLayout.root, activePaneId);
  const activeTab = paneInfo?.node?.tabs?.[paneInfo.node.activeTabIndex] || null;
  if (activeTab && activeTab.type === 'outliner') {
    const allPanes = typeof GBLayout.getAllPanes === 'function' ? GBLayout.getAllPanes(GBLayout.root) : [];
    for (const pane of allPanes) {
      if (!pane || pane.id === activePaneId) continue;
      const tab = pane.tabs?.[pane.activeTabIndex] || null;
      if (!tab || tab.type !== 'outliner') return pane.id;
    }
  }
  return activePaneId;
}

function openScenarioInScriptNote(path, label = '', opts) {
  if (!path || typeof GBTabs === 'undefined' || typeof getComponentInstance !== 'function') return false;
  const _openOpts = opts || {};
  (async () => {
    const paneId = getScriptNoteTargetPaneId();
    if (!paneId) throw new Error('シナリオエディタの表示先が見つかりません');
    const target = isScriptNotePath(path)
      ? { path, label: getScriptNoteLabelFromPath(path, label), created: false }
      : await _resolveScriptNoteTargetFromScenario(path, label);
    const tabLabel = target.label || 'シナリオ';
    const tabState = { scenarioPath: target.path, label: tabLabel };
    if (!_openOpts.skipHighlight && !target.created) highlightOutlinerNode(target.path);
    // フォルダツリー経由の場合、新タブを追加するのではなくアクティブタブを置換する
    let tabId;
    if (_openOpts.fromExplorer) {
      const pInfo = GBLayout.findNode?.(GBLayout.root, paneId);
      const pNode = pInfo?.node;
      const activeTab = pNode?.tabs?.[pNode.activeTabIndex];
      if (activeTab) {
        // 同パス同タイプならそのまま再利用
        if (activeTab.type === 'scriptnote' && activeTab.path === target.path) {
          tabId = activeTab.id;
        } else {
          // アクティブタブを置換
          if (typeof removeComponentInstance === 'function') removeComponentInstance(activeTab.id);
          activeTab.type = 'scriptnote';
          activeTab.label = tabLabel;
          activeTab.path = target.path;
          activeTab.icon = GBTabs.tabIcon('scriptnote');
          activeTab.state = tabState;
          tabId = activeTab.id;
          GBLayout.render();
        }
      } else {
        tabId = GBTabs.addTab(paneId, tabLabel, 'scriptnote', target.path, tabState);
      }
    } else {
      tabId = GBTabs.addTab(paneId, tabLabel, 'scriptnote', target.path, tabState);
    }
    if (!tabId) throw new Error('シナリオタブを作成できません');
    const paneInfo = GBLayout.findNode?.(GBLayout.root, paneId);
    const tab = paneInfo?.node?.tabs?.find?.(item => item.id === tabId) || null;
    if (tab) {
      tab.state = { ...(tab.state || {}), ...tabState };
      GBLayout.saveLayout?.();
    }
    if (_openOpts.fromExplorer && typeof GBLayout.render === 'function') GBLayout.render();
    // navPush はタブ内 _loadScenario → openScenarioInScriptNote 内で呼ばれるため、ここでは不要
    const loadIntoTab = (attempt = 0) => {
      const comp = getComponentInstance(tabId);
      if (!comp || typeof comp._loadScenario !== 'function') {
        if (attempt < 40) setTimeout(() => loadIntoTab(attempt + 1), 50);
        else showStatus('シナリオタブの初期化に失敗しました', true);
        return;
      }
      // activate()が正しいpathで既にロード済みならスキップ
      if (!_openOpts.forceReload && comp._hasLoadedScenarioPath?.(target.path) && comp._hasRenderedScriptNoteDom?.()) return;
      if (typeof comp.restoreState === 'function' && !comp._editor?.doc) comp.restoreState(tabState);
      comp._loadScenario(target.path, { skipNavPush: true });
    };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => loadIntoTab());
    else setTimeout(() => loadIntoTab(), 0);
    if (target.created) {
      if (typeof loadOutliner === 'function') {
        Promise.resolve()
          .then(() => loadOutliner())
          .then(() => {
            if (!_openOpts.skipHighlight) highlightOutlinerNode(target.path);
          })
          .catch(() => {});
      } else if (!_openOpts.skipHighlight) {
        setTimeout(() => highlightOutlinerNode(target.path), 0);
      }
      showStatus(`シナリオファイルを作成して開きました: ${tabLabel}`);
    }
  })().catch(err => {
    showStatus('シナリオエディタを開けませんでした: ' + (err?.message || err), true);
  });
  return true;
}

function _toolMenuModalIcon(name, size) {
  return typeof lucide === 'function' ? lucide(name, size || 14) : '';
}

function _restoreToolMenuModalFocus(trigger) {
  if (!trigger?.isConnected || typeof trigger.focus !== 'function') return;
  try { trigger.focus({ preventScroll: true }); } catch { try { trigger.focus(); } catch {} }
}

function _setScriptNoteOpenMessage(host, text, depth = 0, isError = false) {
  if (!host) return;
  const message = document.createElement('div');
  message.className = 'scriptnote-open-message' + (isError ? ' is-error' : '');
  message.style.setProperty('--scriptnote-open-indent', (depth * 16 + 8) + 'px');
  message.textContent = text;
  host.replaceChildren(message);
}

function showScriptNoteOpenModal(mode = 'open', options = {}) {
  const isImport = mode === 'import';
  const existing = document.querySelector(`.gb-scriptnote-open-overlay[data-scriptnote-open-mode="${isImport ? 'import' : 'open'}"]`);
  if (existing?._scriptNoteOpenModalApi?.isOpen?.()) {
    existing._scriptNoteOpenModalApi.modal.focus?.({ preventScroll: true });
    return existing._scriptNoteOpenModalApi;
  }
  if (typeof window.GBUI?.createModal !== 'function') {
    throw new Error('シナリオ選択を初期化できませんでした。');
  }
  const trigger = options.trigger
    || document.activeElement?.closest?.('.tool-menu-btn, button, [role="button"], [tabindex]')
    || null;
  const activeComp = getActiveScriptNoteComponent();
  const selectedTreeNode = document.querySelector('.tree-node-row.active')?.closest?.('.tree-node')?._nodeData || null;
  const selectedFromTree = (isImport && isScenarioBrowseItem(selectedTreeNode)) || (!isImport && isScriptNoteBrowseItem(selectedTreeNode));
  const activePath = activeComp?.state?.scenarioPath || '';
  const activeLabel = activeComp?.state?.label || '';
  const canReuseActivePath = isImport ? !isScriptNotePath(activePath) : isScriptNotePath(activePath);
  let selectedPath = selectedFromTree
    ? selectedTreeNode.path
    : (canReuseActivePath ? activePath : '');
  let selectedLabel = selectedFromTree
    ? (selectedTreeNode.name || '')
    : (canReuseActivePath ? activeLabel : '');
  const content = document.createElement('div');
  content.innerHTML = `
      <div class="field gb-scriptnote-open-field">
        <label id="scriptnote-open-tree-label" class="gb-scriptnote-open-label">フォルダツリーから${isImport ? '旧シナリオ' : 'シナリオ'}を選択</label>
        <div id="scriptnote-open-tree" class="gb-scriptnote-open-tree" role="group" aria-labelledby="scriptnote-open-tree-label" data-e2e-id="tool-menu-scriptnote-open-tree"></div>
      </div>
      <div id="scriptnote-open-selection" class="gb-scriptnote-open-selection" aria-live="polite"></div>
      <div class="gb-scriptnote-open-hint">
        ${isImport ? 'フォルダを展開して旧シナリオファイル(.scenario.json)を選択してください。選択した旧シナリオからシナリオファイルを作成して開きます。' : 'フォルダを展開してシナリオファイルを選択してください。'}
      </div>`;
  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.id = 'scriptnote-open-cancel';
  cancelBtn.className = 'gb-btn gb-btn-sm';
  cancelBtn.textContent = 'キャンセル';
  const openBtn = document.createElement('button');
  openBtn.type = 'button';
  openBtn.id = 'scriptnote-open-ok';
  openBtn.className = 'gb-btn gb-btn-sm gb-btn-primary';
  openBtn.disabled = true;
  openBtn.textContent = isImport ? '作成して開く' : '開く';
  const modalApi = window.GBUI.createModal({
    id: isImport ? 'scriptnote-import-dialog' : 'scriptnote-open-dialog',
    titleId: 'scriptnote-open-title',
    title: isImport ? '旧シナリオからインポート' : 'シナリオを開く',
    body: [...content.childNodes],
    footer: [cancelBtn, openBtn],
    variant: 'standard',
    extraClass: 'gb-scriptnote-open-modal',
    geometryKey: isImport ? 'scriptnote-import-dialog' : 'scriptnote-open-dialog',
    minWidth: '0',
    initialFocus: '#scriptnote-open-tree',
    returnFocus: () => trigger,
    closeLabel: isImport ? '旧シナリオからインポートを閉じる' : 'シナリオを開くを閉じる',
    closeOnEsc: true,
    closeOnOverlay: true,
  });
  const overlay = modalApi.overlay;
  overlay.classList.add('modal-overlay', 'gb-scriptnote-open-overlay');
  overlay.dataset.scriptnoteOpenMode = isImport ? 'import' : 'open';
  overlay.dataset.e2eId = isImport ? 'tool-menu-scriptnote-import-overlay' : 'tool-menu-scriptnote-open-overlay';
  overlay._scriptNoteOpenModalApi = modalApi;
  modalApi.modal.dataset.e2eId = isImport ? 'tool-menu-scriptnote-import-dialog' : 'tool-menu-scriptnote-open-dialog';
  modalApi.header.classList.add('gb-scriptnote-open-header');
  modalApi.header.dataset.modalHeader = '1';
  modalApi.body.classList.add('gb-scriptnote-open-body');
  modalApi.footer.classList.add('gb-scriptnote-open-footer');
  modalApi.footer.dataset.modalFooter = '1';
  const titleElement = modalApi.header.querySelector('.gb-modal-title');
  titleElement?.classList.add('gb-scriptnote-open-title');
  if (titleElement) {
    const icon = document.createElement('span');
    icon.className = 'gb-scriptnote-open-title-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.innerHTML = _toolMenuModalIcon(isImport ? 'scenario' : 'bookOpenText', 16);
    titleElement.prepend(icon);
  }
  const closeBtn = modalApi.header.querySelector('.gb-modal-close');
  if (closeBtn) {
    closeBtn.id = 'scriptnote-open-close';
    closeBtn.classList.add('gb-scriptnote-open-close');
    closeBtn.dataset.e2eId = 'tool-menu-scriptnote-open-close';
  }
  const treeHost = modalApi.body.querySelector('#scriptnote-open-tree');
  const selectionEl = modalApi.body.querySelector('#scriptnote-open-selection');
  const close = () => modalApi.close('programmatic');
  const submit = () => {
    if (!selectedPath) {
      showStatus(`${isImport ? 'インポートする旧シナリオ' : '開くシナリオファイル'}を選択してください`, true);
      return;
    }
    if (!isImport && !isScriptNotePath(selectedPath)) {
      showStatus('開く... ではシナリオファイルだけを選択できます。旧シナリオは「旧シナリオからインポート...」を使ってください', true);
      return;
    }
    modalApi.close('opened');
    const label = selectedLabel || getScriptNoteLabelFromPath(selectedPath, '');
    if (!isImport && loadScenarioIntoActiveScriptNote(selectedPath, label)) return;
    if (openScenarioInScriptNote(selectedPath, label)) return;
    showStatus('シナリオを開けませんでした', true);
  };
  const updateSelection = (path, label, rowEl) => {
    selectedPath = path || '';
    selectedLabel = label || '';
    treeHost.querySelectorAll('.scriptnote-open-row.is-selected').forEach(el => {
      el.classList.remove('is-selected');
      el.setAttribute('aria-selected', 'false');
    });
    if (rowEl) {
      rowEl.classList.add('is-selected');
      rowEl.setAttribute('aria-selected', 'true');
    }
    selectionEl.textContent = selectedPath
      ? `選択中: ${selectedLabel || selectedPath.split('/').pop().replace(/\.\w+$/, '')}`
      : '選択中: なし';
    openBtn.disabled = !selectedPath;
  };
  const buildBrowseUrl = (path, rootPath) => {
    let url = '/browse?path=' + encodeURIComponent(path) + '&all_files=true';
    if (rootPath) url += '&root=' + encodeURIComponent(rootPath);
    return url;
  };
  const createNodeRow = (item, depth, rootPath) => {
    const wrapper = document.createElement('div');
    const row = document.createElement('div');
    row.className = 'scriptnote-open-row';
    const itemLabel = item.name || item.label || item.path?.split('/').pop() || '';
    const rowKey = String(item.path || itemLabel || 'item').replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'item';
    row.dataset.e2eId = 'scriptnote-open-row-' + rowKey;
    row.dataset.scriptnoteOpenPath = item.path || '';
    row.style.setProperty('--scriptnote-open-indent', (depth * 16 + 4) + 'px');
    const isFolder = item.type === 'folder' || item._isRoot;
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'scriptnote-open-toggle';
    toggle.dataset.e2eId = 'scriptnote-open-toggle-' + rowKey;
    toggle.dataset.scriptnoteOpenPath = item.path || '';
    if (isFolder) toggle.innerHTML = lucide('chevronRight', 10); else toggle.textContent = '';
    toggle.setAttribute('aria-label', isFolder ? 'フォルダを展開: ' + itemLabel : 'フォルダではありません');
    if (!isFolder) {
      toggle.disabled = true;
      toggle.tabIndex = -1;
      toggle.setAttribute('aria-hidden', 'true');
    }
    const label = document.createElement('div');
    label.className = 'scriptnote-open-row-label';
    label.textContent = itemLabel;
    const isSelectableItem = isImport ? isScenarioBrowseItem(item) : isScriptNoteBrowseItem(item);
    row.classList.toggle('is-selectable', isSelectableItem);
    row.classList.toggle('is-muted', !isFolder && !isSelectableItem);
    row.appendChild(toggle);
    row.appendChild(label);
    wrapper.appendChild(row);
    const children = document.createElement('div');
    children.className = 'scriptnote-open-children';
    children.hidden = true;
    wrapper.appendChild(children);

    if (isFolder) {
      row.setAttribute('role', 'button');
      row.tabIndex = 0;
      row.setAttribute('aria-expanded', 'false');
      row.setAttribute('aria-label', 'フォルダを展開: ' + itemLabel);
      const toggleFolder = async () => {
        const willOpen = children.hidden;
        row.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
        if (!willOpen) {
          children.hidden = true;
          toggle.innerHTML = lucide('chevronRight', 10);
          return;
        }
        toggle.innerHTML = lucide('chevronDown', 10);
        children.hidden = false;
        if (children.dataset.loaded === 'true') return;
        _setScriptNoteOpenMessage(children, '読み込み中...', depth + 1);
        try {
          const items = await apiFetch(buildBrowseUrl(item.path, rootPath));
          const visibleItems = (items || [])
            .filter(child => child && (child.type === 'folder' || (isImport ? isScenarioBrowseItem(child) : isScriptNoteBrowseItem(child))))
            .sort((a, b) => {
              const af = a.type === 'folder' ? 0 : 1;
              const bf = b.type === 'folder' ? 0 : 1;
              if (af !== bf) return af - bf;
              return String(a.name || '').localeCompare(String(b.name || ''), 'ja');
            });
          children.innerHTML = '';
          if (!visibleItems.length) {
            _setScriptNoteOpenMessage(children, isImport ? '旧シナリオなし' : 'シナリオなし', depth + 1);
          } else {
            visibleItems.forEach(child => children.appendChild(createNodeRow(child, depth + 1, rootPath)));
          }
          children.dataset.loaded = 'true';
        } catch {
          _setScriptNoteOpenMessage(children, '読み込み失敗', depth + 1, true);
        }
      };
      toggle.addEventListener('click', (e) => { e.stopPropagation(); toggleFolder(); });
      row.addEventListener('click', toggleFolder);
      row.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        toggleFolder();
      });
    } else {
      row.setAttribute('role', 'button');
      row.tabIndex = isSelectableItem ? 0 : -1;
      row.setAttribute('aria-selected', selectedPath && item.path === selectedPath ? 'true' : 'false');
      row.setAttribute('aria-label', itemLabel);
      row.addEventListener('click', () => updateSelection(item.path, item.name || '', row));
      row.addEventListener('dblclick', () => {
        updateSelection(item.path, item.name || '', row);
        submit();
      });
      row.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        updateSelection(item.path, item.name || '', row);
        if (e.key === 'Enter') submit();
      });
      if (selectedPath && item.path === selectedPath) updateSelection(item.path, item.name || '', row);
    }
    return wrapper;
  };
  const renderTree = async () => {
    _setScriptNoteOpenMessage(treeHost, '読み込み中...');
    try {
      const roots = await apiFetch('/outliner-roots');
      treeHost.innerHTML = '';
      if (!Array.isArray(roots) || !roots.length) {
        _setScriptNoteOpenMessage(treeHost, 'フォルダツリーがありません');
        return;
      }
      roots.forEach(root => {
        const rootNode = { ...root, type: 'folder', _isRoot: true };
        treeHost.appendChild(createNodeRow(rootNode, 0, root.path));
      });
      if (!selectedPath) updateSelection('', '', null);
    } catch {
      _setScriptNoteOpenMessage(treeHost, 'フォルダツリーの読み込みに失敗しました', 0, true);
    }
  };
  cancelBtn.addEventListener('click', () => modalApi.close('cancel'));
  openBtn.addEventListener('click', submit);
  modalApi.modal.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !openBtn.disabled && !e.target.closest('button')) submit();
  });
  renderTree();
  modalApi.open();
  return modalApi;
}

function showScriptNoteImportModal(options = {}) {
  return showScriptNoteOpenModal('import', options);
}

function loadScenarioIntoActiveScriptNote(path, label = '') {
  const comp = getActiveScriptNoteComponent();
  if (!comp || typeof comp._loadScenario !== 'function' || !path || !isScriptNotePath(path)) return false;
  comp._loadScenario(path);
  return true;
}

// エクスポートヘルパー
function _buildExportOptions(path, type, format) {
  const baseName = (typeof MeldexExportSave !== 'undefined' && typeof MeldexExportSave.guessNameFromPath === 'function')
    ? MeldexExportSave.guessNameFromPath(path, '無題')
    : ((String(path || '').split('/').pop() || String(path || '').split('\\').pop() || '無題'));
  const stem = baseName.replace(/\.[^.]+$/, '') || '無題';
  if (type === 'file') {
    const ext = (baseName.match(/(\.[^.]+)$/)?.[1]) || '.txt';
    return {
      url: '/api/file?path=' + encodeURIComponent(path) + '&download=1',
      filename: baseName,
      extension: ext,
      dialogTitle: '名前を付けて保存',
      filetypes: [['すべてのファイル', '*.*']],
      okMessage: 'ファイルを保存しました',
      errorMessage: 'ファイルの保存に失敗しました',
      path,
    };
  }
  const formatMap = {
    note: {
      md: { ext: '.md', label: 'Markdown', filetypes: [['Markdownファイル', '*.md'], ['すべてのファイル', '*.*']] },
      html: { ext: '.html', label: 'HTML', filetypes: [['HTMLファイル', '*.html'], ['すべてのファイル', '*.*']] },
      docx: { ext: '.docx', label: 'Word', filetypes: [['Wordファイル', '*.docx'], ['すべてのファイル', '*.*']] },
    },
    db: {
      csv: { ext: '.csv', label: 'CSV', filetypes: [['CSVファイル', '*.csv'], ['すべてのファイル', '*.*']] },
      html: { ext: '.html', label: 'HTML', filetypes: [['HTMLファイル', '*.html'], ['すべてのファイル', '*.*']] },
      xlsx: { ext: '.xlsx', label: 'Excel', filetypes: [['Excelファイル', '*.xlsx'], ['すべてのファイル', '*.*']] },
    },
    canvas: {
      html: { ext: '.html', label: 'HTML', filetypes: [['HTMLファイル', '*.html'], ['すべてのファイル', '*.*']] },
      svg: { ext: '.svg', label: 'SVG画像', filetypes: [['SVGファイル', '*.svg'], ['すべてのファイル', '*.*']] },
      md: { ext: '.md', label: 'Markdown', filetypes: [['Markdownファイル', '*.md'], ['すべてのファイル', '*.*']] },
    },
  };
  const info = formatMap[type]?.[format];
  if (!info) return null;
  // ノートが縦書き表示のときは、書き出し結果にも組方向を反映する（追加のみのパラメータ）
  const verticalParam = (type === 'note' && window.MeldexNoteWritingMode?.isActive?.()) ? '&vertical=1' : '';
  return {
    url: '/export/' + type + '?path=' + encodeURIComponent(path) + '&format=' + format + verticalParam,
    filename: stem + info.ext,
    extension: info.ext,
    dialogTitle: `${info.label}として保存`,
    filetypes: info.filetypes,
    okMessage: `${info.label} として保存しました`,
    errorMessage: `${info.label} の保存に失敗しました`,
    path,
    title: stem,
  };
}

async function _exportFile(type, format) {
  const path = getCurrentFilePath();
  if (!path) return;
  const spec = _buildExportOptions(path, type, format);
  if (!spec || typeof MeldexExportSave === 'undefined' || typeof MeldexExportSave.saveUrl !== 'function') {
    showStatus('保存ダイアログを初期化できませんでした', true);
    return;
  }
  await MeldexExportSave.saveUrl(spec.url, spec);
}

// 現在のビューを閉じる
function closeCurrentView() {
  const activePaneId = typeof GBLayout !== 'undefined' ? GBLayout.activePane : null;
  const activeTab = (typeof GBTabs !== 'undefined' && typeof GBTabs.getActiveTab === 'function')
    ? GBTabs.getActiveTab(activePaneId)
    : null;
  if (activePaneId && activeTab && typeof GBTabs !== 'undefined' && typeof GBTabs.closeTab === 'function') {
    GBTabs.closeTab(activePaneId, activeTab.id);
    return;
  }
  showView('welcome');
}

// パスをクリップボードにコピー
function _copyCurrentFilePath() {
  const path = getCurrentFilePath();
  if (!path) return;
  const base = typeof state !== 'undefined' ? (state.vaultPath || '') : '';
  const copyPath = window.GBPathUtils?.resolveForClipboard?.(path, base) ?? path;
  navigator.clipboard.writeText(copyPath).then(() => {
    showStatus('パスをコピーしました');
  }).catch(() => {
    showStatus('パスのコピーに失敗しました', true);
  });
}

function _toolMenuNavType(toolType) {
  return {
    page: 'page',
    scriptnote: 'scriptnote',
    database: 'pivot',
    board: 'board',
    calendar: 'calendar',
    csv: 'csv',
    'smart-db': 'smart-db',
    folder: 'folder',
  }[toolType] || 'page';
}

function _toolMenuDisplayName(path, toolType, fallback) {
  if (toolType === 'scriptnote' && typeof getScriptNoteLabelFromPath === 'function') {
    return getScriptNoteLabelFromPath(path, fallback || 'シナリオ');
  }
  const fileName = String(path || '').split('/').pop() || String(path || '').split('\\').pop() || fallback || '';
  return fileName.replace(/\.[^.\\/]+$/, '') || fallback || fileName || '無題';
}

async function _refreshWorkspaceAfterFileMutation() {
  const refreshJobs = [];
  if (typeof loadOutliner === 'function') refreshJobs.push(loadOutliner());
  if (typeof renderHomeFolderTree === 'function') refreshJobs.push(renderHomeFolderTree());
  await Promise.allSettled(refreshJobs);
  if (typeof openFolder === 'function' && typeof _folderPath !== 'undefined' && _folderPath) {
    await openFolder(_folderPath.split('/').pop() || _folderPath, _folderPath, {
      skipShowView: true,
      skipSaveLastView: true,
      skipNavPush: true,
      skipHighlight: true,
      skipGlobalUi: true,
    });
  }
}

async function _createFolderViewItem(type) {
  if (window.MeldexCloudBootstrap?.isPhase1UnsupportedCreateType?.(type)) {
    window.MeldexCloudBootstrap.showPhase1Unsupported?.(type);
    return;
  }
  const parent = (typeof _folderPath !== 'undefined' && _folderPath) ? _folderPath : getCurrentFilePath();
  if (!parent) {
    if (typeof showAddOutlinerItem === 'function') showAddOutlinerItem(type);
    return;
  }
  try {
    const res = await apiPost('/outliner/add', { type, label: '無題', parent });
    const node = res?.node || {};
    const name = node.name || node.label || '無題';
    await _refreshWorkspaceAfterFileMutation();
    if (node.path && node.type !== 'folder' && typeof navOpen === 'function') {
      navOpen({ type: _toolMenuNavType(node.type || type), label: name, path: node.path });
    }
    if (typeof showStatus === 'function') showStatus((node.type === 'folder' ? 'フォルダ' : 'ファイル') + 'を作成しました: ' + name);
  } catch (e) {
    if (typeof showStatus === 'function') showStatus('作成に失敗しました: ' + (e?.message || e || ''), true);
  }
}

async function _duplicateCurrentFile(toolType) {
  const path = getCurrentFilePath();
  if (!path) return;
  try {
    const res = await apiPost('/outliner/duplicate', { path });
    await _refreshWorkspaceAfterFileMutation();
    const duplicatedPath = res?.new_path || '';
    const duplicatedName = _toolMenuDisplayName(duplicatedPath || path, toolType, res?.new_name || '');
    if (duplicatedPath && typeof navOpen === 'function') {
      navOpen({ type: _toolMenuNavType(toolType), label: duplicatedName, path: duplicatedPath });
    }
    showStatus('ファイルを複製しました' + (duplicatedName ? ': ' + duplicatedName : ''));
  } catch (e) {
    showStatus('ファイルの複製に失敗しました: ' + (e?.message || e || ''), true);
  }
}

async function _deleteCurrentFile(toolType) {
  const path = getCurrentFilePath();
  if (!path) return;
  const name = _toolMenuDisplayName(path, toolType, '');
  const confirmMessage = `「${name || path}」を削除しますか？`;
  const confirmed = typeof MeldexDeleteImpactWarning !== 'undefined'
    ? await MeldexDeleteImpactWarning.confirmDeleteWithImpact([{ path, kind: 'file' }], confirmMessage)
    : await cfConfirm(confirmMessage);
  if (!confirmed) return;
  try {
    const result = await deleteOutlinerItemsWithHistory([{ path, name, type: toolType || 'page' }], {
      label: 'ファイル削除',
      detail: path,
      refresh: async () => {
        await _refreshWorkspaceAfterFileMutation();
      },
    });
    if (!result.succeeded.length) throw new Error('削除対象が見つかりませんでした');
    const activePaneId = typeof GBLayout !== 'undefined' ? GBLayout.activePane : null;
    const activeTab = (typeof GBTabs !== 'undefined' && typeof GBTabs.getActiveTab === 'function')
      ? GBTabs.getActiveTab(activePaneId)
      : null;
    if (activePaneId && activeTab?.path === path && typeof GBTabs.closeTab === 'function') {
      GBTabs.closeTab(activePaneId, activeTab.id);
    } else if (typeof closeCurrentView === 'function') {
      closeCurrentView();
    }
    await _refreshWorkspaceAfterFileMutation();
    showStatus('ファイルを削除しました（Undoで戻せます）' + (name ? ': ' + name : ''));
  } catch (e) {
    showStatus('ファイルの削除に失敗しました: ' + (e?.message || e || ''), true);
  }
}
