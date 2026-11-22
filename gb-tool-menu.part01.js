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
      wrap.className = 'gb-context-menu-submenu tool-menu-submenu-wrap';
      const trigger = document.createElement('button');
      trigger.type = 'button';
      trigger.className = 'gb-context-menu-item ab-dropdown-item tool-menu-submenu-trigger';
      trigger.setAttribute('role', 'menuitem');
      trigger.setAttribute('aria-haspopup', 'menu');
      trigger.setAttribute('aria-expanded', 'false');
      // 安定ID: メニューの中の位置（親の表示名/表示名）で決める（同じ画面に同じ項目は1つだけ）。
      trigger.dataset.e2eId = 'tool-menu-item:' + _toolMenuItemPath(container, item.label);
      _toolMenuAppendIcon(trigger, item.icon);
      _toolMenuAppendLabel(trigger, item.label);
      const arrow = _toolMenuAppendShortcut(trigger, '');
      arrow.innerHTML = lucide('chevronRight', 12);
      const sub = document.createElement('div');
      sub.className = 'gb-context-menu ab-dropdown ab-sub-menu tool-menu-dropdown tool-menu-submenu';
      sub.setAttribute('role', 'menu');
      sub.setAttribute('aria-label', item.label || 'サブメニュー');
      sub.dataset.toolMenuPath = _toolMenuItemPath(container, item.label);
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
    el.dataset.e2eId = 'tool-menu-item:' + _toolMenuItemPath(container, item.label);
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

// ツールメニューの項目の安定IDに使う、メニューの中の位置（例: エクスポート/印刷...）。
function _toolMenuItemPath(container, label) {
  const parent = container?.dataset?.toolMenuPath || '';
  return (parent ? parent + '/' : '') + String(label || '').trim();
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

function showToolMenu(e, toolType, component) {
  e.stopPropagation();
  if (component === e) component = null; // gb-events appends the event after explicit arguments.
  if (window.MeldexCloudMobileEditBar?.openToolMenu?.(toolType, e)) return;
  const btn = _resolveToolMenuButton(e);
  const editorHost = window.GBEditorHost?.get();
  if (!component && editorHost && btn?.closest('[data-editor-host]')) {
    component = editorHost.component || { path: editorHost.path, state: { label: editorHost.label } };
  }
  if (!component && typeof getComponentInstance === 'function' && typeof GBTabs !== 'undefined') {
    const subpanel = btn?.closest('#gb-subpanel-root') && window.GBSubPanel?.getCurrentTarget?.();
    const paneId = btn?.closest('[data-pane-id]')?.dataset.paneId;
    const tab = paneId ? GBTabs.getActiveTab(paneId) : null;
    if (subpanel) component = { path: subpanel.path, state: { ...subpanel.state, label: subpanel.label } };
    else if (tab) component = getComponentInstance(tab.id) || { paneId, tabId: tab.id, state: tab.state || {} };
  }
  document.querySelectorAll('.tool-menu-dropdown').forEach(el => {
    if (typeof el._cleanup === 'function') el._cleanup({ restoreFocus: false });
    else el.remove();
  });

  const dd = document.createElement('div');
  dd.className = 'gb-context-menu ab-dropdown tool-menu-dropdown';
  dd.dataset.toolMenuRoot = '1';
  dd._sourceButton = btn || null;
  dd.setAttribute('role', 'menu');
  dd.setAttribute('aria-label', 'ツールメニュー');
  dd.style.cssText = 'position:fixed;z-index:9999;min-width:220px;';

  const items = buildToolMenuItems(toolType, component);
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

  keyHandler = (ev) => {
    // メニューが別の経路で取り除かれていたら、キー操作を横取りせずに後始末だけする。
    if (!dd.isConnected) { closeAll(); return; }
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
  document.addEventListener('keydown', keyHandler, true);

  setTimeout(() => {
    if (!dd.isConnected) return;
    pointerHandler = (ev) => {
      const inAny = [...document.querySelectorAll('.tool-menu-dropdown')].some(m => m.contains(ev.target));
      if (!inAny && ev.target !== btn) {
        closeAll({ restoreFocus: true });
      }
    };
    document.addEventListener('pointerdown', pointerHandler, true);
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
  const editor = window.GBEditorHost?.get();
  if (editor) return editor.path;
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
  if (state?.view === 'folder' && typeof _folderPath !== 'undefined') return _folderPath || null;
  return null;
}

function _toolMenuFileTarget(toolType, component) {
  const editor = window.GBEditorHost?.get();
  if (editor && editor.kind === toolType && (!component || component === editor.component || component.path === editor.path)) {
    return { path: editor.path, label: editor.label, type: toolType };
  }
  const tabs = typeof GBTabs !== 'undefined' ? GBTabs : null;
  const tab = component
    ? (component.paneId && component.tabId ? tabs?.getTabs?.(component.paneId)?.find(item => item.id === component.tabId) : null)
    : tabs?.getActiveTab?.(typeof GBLayout !== 'undefined' ? GBLayout.activePane : undefined);
  const tabType = ['db', 'pivot', 'tree', 'gallery', 'kanban', 'timeline', 'gantt', 'chart', 'graph', 'form'].includes(tab?.type) ? 'database' : tab?.type;
  if (!component && tabType === toolType && typeof getComponentInstance === 'function') component = getComponentInstance(tab.id);
  const stateKey = { page: 'pagePath', database: 'dbPath', board: 'boardPath', csv: 'csvPath',
    calendar: 'calendarPath', scriptnote: 'scenarioPath', 'form-app': 'formPath', map: 'mapPath', folder: 'folderPath' }[toolType];
  const ownPath = toolType === 'scriptnote' ? component?._editor?._path || component?.state?.scenarioPath || component?.path
    : component?.path || component?.state?.[stateKey];
  const path = tab && tabType !== toolType && !component ? ''
    : String(ownPath || tab?.path || (!component ? getCurrentFilePath() : '') || '').trim();
  const label = String(tab?.label || component?.state?.label || path.split(/[\\/]/).pop() || '');
  return { path, label, type: toolType };
}

function getCurrentFileAssetId(path) {
  const activeTab = (typeof GBTabs !== 'undefined' && typeof GBLayout !== 'undefined')
    ? GBTabs.getActiveTab(GBLayout.activePane)
    : null;
  if (activeTab?.path === path) {
    const tabAssetId = activeTab.assetId || activeTab.asset_id;
    if (tabAssetId) return String(tabAssetId);
  }
  const pageContent = document.getElementById('page-content');
  if (pageContent?.dataset?.path === path && pageContent.dataset.assetId) {
    return String(pageContent.dataset.assetId);
  }
  return '';
}

function getActiveScriptNoteComponent() {
  // サブパネル・トピック内のシナリオが操作対象なら、それを使う（_sn2GetActiveEditor と同じ判定）。
  const host = window.GBEditorHost?.get?.();
  if (host?.kind === 'scriptnote' && host.component?._editor?.doc) return host.component;
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
    // 取込先がまだ無いことの確認なので、見つからない時にエラーを画面へ出さない（404 は下で「無い」として扱う）。
    const data = await apiFetch('/file?path=' + encodeURIComponent(path), { silentError: true });
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
    : String(sourcePath || '').replace(/(\.scenario)?\.(json|csv|xlsx|xls)$/i, '') + '.mel-scenario';
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
    // 現行の .mel-scenario と旧拡張子の .scriptnote.json の両方で番号を付ける（同名の別ファイルがある時に同じ候補を試し続けない）。
    candidatePath = basePath.replace(/(\.mel-scenario|\.scriptnote\.json)$/i, ` (${i + 2})$1`);
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
          if (typeof removeComponentInstanceSafely === 'function') {
            if (!await removeComponentInstanceSafely(activeTab.id)) return;
          } else if (typeof removeComponentInstance === 'function'
            && removeComponentInstance(activeTab.id) === false) {
            return;
          }
          activeTab.type = 'scriptnote';
          activeTab.label = tabLabel;
          activeTab.path = target.path;
          activeTab.icon = GBTabs.tabIcon('scriptnote');
          activeTab.state = tabState;
          tabId = activeTab.id;
          GBTabs.updateTab(paneId, activeTab.id, {});
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
    // navPush はタブ内 _loadScenario → openScenarioInScriptNote 内で呼ばれるため、ここでは不要
    const loadIntoTab = (attempt = 0) => {
      const comp = getComponentInstance(tabId);
      if (!comp || typeof comp._loadScenario !== 'function') {
        // 初期化を待つ間に、利用者が別のファイルを開いてこのタブが置き換わった・閉じられた時は、何もしない
        // （置き換わったタブを待ち続けて「初期化に失敗しました」を出していた）。
        const liveTab = GBLayout.findNode?.(GBLayout.root, paneId)?.node?.tabs?.find?.(item => item.id === tabId);
        if (GBLayout.findNode && (!liveTab || liveTab.type !== 'scriptnote')) return;
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
        <div id="scriptnote-open-tree" class="gb-folder-picker-embed gb-scriptnote-open-tree" role="group" aria-labelledby="scriptnote-open-tree-label" data-e2e-id="tool-menu-scriptnote-open-tree"></div>
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
    initialFocus: '#scriptnote-open-tree .gb-folder-picker-search',
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
  const updateSelection = (path, label) => {
    selectedPath = path || '';
    selectedLabel = label || '';
    selectionEl.textContent = selectedPath
      ? `選択中: ${selectedLabel || selectedPath.split('/').pop().replace(/\.\w+$/, '')}`
      : '選択中: なし';
    openBtn.disabled = !selectedPath;
  };
  // フォルダツリーは共通のフォルダ選択部品を埋め込む（UI共通ルール 4.1）
  const isSelectableItem = item => (isImport ? isScenarioBrowseItem(item) : isScriptNoteBrowseItem(item));
  const browser = typeof window.GBFolderPicker?.createBrowser === 'function'
    ? window.GBFolderPicker.createBrowser({
      selectFiles: true,
      selectFolders: false,
      fileFilter: isSelectableItem,
      initialPath: selectedPath,
      revealPath: selectedPath,
      currentLabel: isImport ? '選択中の旧シナリオ:' : '選択中のシナリオ:',
      emptyText: isImport ? 'この階層にフォルダまたは旧シナリオはありません。' : 'この階層にフォルダまたはシナリオはありません。',
      onSelect: selection => {
        if (selection?.kind === 'file') updateSelection(selection.path, selection.name || '');
      },
      onActivate: selection => {
        if (selection?.kind !== 'file') return;
        updateSelection(selection.path, selection.name || '');
        submit();
      },
    })
    : null;
  if (browser) {
    browser.tree.setAttribute('aria-labelledby', 'scriptnote-open-tree-label');
    treeHost.replaceChildren(browser.element);
  } else {
    treeHost.textContent = 'フォルダツリーを表示できませんでした';
  }
  updateSelection(selectedPath, selectedLabel);
  cancelBtn.addEventListener('click', () => modalApi.close('cancel'));
  openBtn.addEventListener('click', submit);
  modalApi.modal.addEventListener('keydown', (e) => {
    // ツリー行のEnterは共通部品側で選択と確定を行う
    if (e.target.closest('.gb-folder-picker-tree, .gb-folder-picker-search-results')) return;
    if (e.key === 'Enter' && !openBtn.disabled && !e.target.closest('button')) submit();
  });
  modalApi.open();
  browser?.start();
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
function closeCurrentView(options) {
  const activePaneId = typeof GBLayout !== 'undefined' ? GBLayout.activePane : null;
  const activeTab = (typeof GBTabs !== 'undefined' && typeof GBTabs.getActiveTab === 'function')
    ? GBTabs.getActiveTab(activePaneId)
    : null;
  if (activePaneId && activeTab && typeof GBTabs !== 'undefined' && typeof GBTabs.closeTab === 'function') {
    GBTabs.closeTab(activePaneId, activeTab.id, options?.skipHistory ? { skipHistory: true } : undefined);
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
    scriptnote: 'scriptnote', 'form-app': 'form-app',
    database: 'pivot',
    board: 'board',
    calendar: 'calendar',
    csv: 'csv',
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

async function _deleteCurrentFile(toolType) {
  const path = getCurrentFilePath();
  if (!path) return;
  const assetId = getCurrentFileAssetId(path);
  const name = _toolMenuDisplayName(path, toolType, '');
  const confirmed = typeof MeldexDeleteImpactWarning !== 'undefined'
    ? await MeldexDeleteImpactWarning.authorizeReversibleDelete([
        { path, kind: 'file', ...(assetId ? { assetId } : {}) },
      ])
    : { confirmed: true, operation: 'trash' };
  if (!confirmed) return;
  try {
    const result = await deleteOutlinerItemsWithHistory([{
      path, name, type: toolType || 'page', ...(assetId ? { assetId } : {}),
    }], {
      confirmation: confirmed,
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
      // タブを閉じるのは削除の結果なので、取り消し履歴には積まない（積むと削除の直後の Ctrl+Z が
      // 削除の取り消しではなく「タブを閉じる」の取り消しになり、削除したファイルのタブだけが戻っていた）。
      GBTabs.closeTab(activePaneId, activeTab.id, { skipHistory: true });
    } else if (typeof closeCurrentView === 'function') {
      closeCurrentView({ skipHistory: true });
    }
    await _refreshWorkspaceAfterFileMutation();
    showStatus('ファイルを削除しました（Undoで戻せます）' + (name ? ': ' + name : ''));
  } catch (e) {
    showStatus('ファイルの削除に失敗しました: ' + (e?.message || e || ''), true);
  }
}

// 辞書ファイル出力（IME辞書形式）。ステータスで出力対象を絞り込める。
let _dictExportInProgress = false;
async function _exportDictFile(options = {}) {
  if (_dictExportInProgress) {
    showStatus('辞書を準備しています。しばらくお待ちください');
    return;
  }
  _dictExportInProgress = true;
  try {
    const fetchProgress = window.MeldexOperationProgress?.begin?.({
      kind: 'dictionary-export',
      label: '辞書データを準備しています',
      mode: 'indeterminate',
      showInTray: true,
      priority: 35,
    });
    if (!fetchProgress) showStatus('辞書を準備中…');
    const work = typeof getWorkFolder === 'function' ? getWorkFolder() : '';
    const url = work ? '/link-dict?work=' + encodeURIComponent(work) : '/link-dict';
    let data;
    try {
      data = await apiFetch(url, { timeoutMs: 120000 });
      fetchProgress?.succeed?.({ summary: '辞書データを準備しました' });
    } catch (error) {
      const message = `辞書データの取得に失敗しました: ${error?.message || '通信エラー'}`;
      if (fetchProgress) fetchProgress.fail({ error: message });
      else showStatus(message, true);
      return;
    }
    const entries = Array.isArray(data?.entries) ? data.entries : [];
    const prepared = _prepareDictExport(entries, new Set());
    if (prepared.statuses.length === 0) {
      showStatus('ルビ付きトピックがありません', true);
      return;
    }
    const STATUS_ORDER = ['採用', '掲載済み', '連載中', '確定', '案', '草稿', '保留', 'ボツ', '(未設定)'];
    const present = prepared.statuses.sort((a, b) => {
      const ia = STATUS_ORDER.indexOf(a), ib = STATUS_ORDER.indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });
    const allowed = await _showDictStatusDialog(present, prepared, options);
    if (!allowed) {
      showStatus('辞書出力をキャンセルしました');
      return;
    }
    let output;
    try {
      output = _prepareDictExport(entries, allowed);
    } catch (error) {
      showStatus(`辞書データの生成に失敗しました: ${error?.message || 'データ形式エラー'}`, true);
      return;
    }
    if (output.lines.length === 0) {
      showStatus('選択したステータスの辞書項目がありません', true);
      return;
    }
    if (typeof MeldexExportSave === 'undefined' || typeof MeldexExportSave.saveText !== 'function') {
      showStatus('保存ダイアログを初期化できませんでした', true);
      return;
    }
    const excluded = [];
    if (output.withoutReading) excluded.push(`ルビなし${output.withoutReading}件`);
    if (output.duplicateCount) excluded.push(`重複${output.duplicateCount}件`);
    await MeldexExportSave.saveText(output.lines.join('\n'), {
        filename: (work ? work.replace(/[\\/]/g, '_') + '_' : '') + 'dictionary.txt',
        extension: '.txt',
        dialogTitle: '辞書ファイルを書き出し',
        filetypes: [['テキストファイル', '*.txt'], ['すべてのファイル', '*.*']],
        bom: true,
        okMessage: `${output.lines.length}件の辞書項目を出力しました${excluded.length ? `（${excluded.join('、')}を除外）` : ''}`,
        cancelMessage: '辞書ファイルの保存をキャンセルしました',
        errorMessage: '辞書ファイルの保存に失敗しました',
    });
  } catch (error) {
    showStatus(`辞書ファイルの出力に失敗しました: ${error?.message || '不明なエラー'}`, true);
  } finally {
    _dictExportInProgress = false;
  }
}
