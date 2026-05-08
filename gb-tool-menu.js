/* gb-tool-menu.js: flattened split script for static cloud hosting. */
/* Source chunk: gb-tool-menu.part01.js */
/**
 * Meldex Tool Menu
 * 各ツールのツールバー左端に表示するメニューボタンの共通機能
 */

// ツールメニュー項目を描画する（サブメニュー対応）
function _renderToolMenuItems(container, items, isSubmenu) {
  const rootDd = isSubmenu ? container.closest('.tool-menu-dropdown') : container;
  items.forEach(item => {
    if (item.separator) {
      const sep = document.createElement('div');
      sep.style.cssText = 'height:1px;background:var(--border);margin:4px 0;';
      container.appendChild(sep);
      return;
    }
    if (item.submenu) {
      // サブメニュートリガー
      const wrap = document.createElement('div');
      wrap.style.cssText = 'position:relative;';
      const trigger = document.createElement('div');
      trigger.className = 'ab-dropdown-item';
      trigger.style.cssText = 'display:flex;align-items:center;';
      if (item.icon) {
        trigger.innerHTML = '<span style="margin-right:6px;opacity:0.7;">' + lucide(item.icon, 14) + '</span>' + esc(item.label) + submenuArrow();
      } else {
        trigger.innerHTML = esc(item.label) + submenuArrow();
      }
      const sub = document.createElement('div');
      sub.className = 'ab-dropdown ab-sub-menu tool-menu-dropdown';
      sub.style.cssText = 'display:none;min-width:200px;';
      _renderToolMenuItems(sub, item.submenu, true);
      attachHoverSubmenu(trigger, sub);
      wrap.appendChild(trigger);
      wrap.appendChild(sub);
      container.appendChild(wrap);
      return;
    }
    const el = document.createElement('div');
    el.className = 'ab-dropdown-item';
    if (item.shortcut) {
      el.style.display = 'flex';
      el.style.alignItems = 'center';
      el.innerHTML = esc(item.label) + '<span style="margin-left:auto;padding-left:16px;color:var(--fg2);font-size:11px;">' + esc(item.shortcut) + '</span>';
    } else if (item.icon) {
      el.innerHTML = '<span style="margin-right:6px;opacity:0.7;">' + lucide(item.icon, 14) + '</span>' + esc(item.label);
    } else {
      el.textContent = item.label;
    }
    if (item.disabled) { el.style.opacity = '0.4'; el.style.pointerEvents = 'none'; }
    el.addEventListener('click', () => { document.querySelectorAll('.tool-menu-dropdown').forEach(m => m.remove()); item.action?.(); });
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
  const btn = _resolveToolMenuButton(e);
  document.querySelectorAll('.tool-menu-dropdown').forEach(el => el.remove());

  const dd = document.createElement('div');
  dd.className = 'ab-dropdown tool-menu-dropdown';
  dd.style.cssText = 'position:fixed;z-index:9999;min-width:220px;';

  const items = buildToolMenuItems(toolType);
  _renderToolMenuItems(dd, items);

  // 位置決め
  const rect = btn ? btn.getBoundingClientRect() : { left: e.clientX, bottom: e.clientY };
  { const z = _getZoom(); dd.style.left = (rect.left / z) + 'px'; dd.style.top = (rect.bottom / z + 2) + 'px'; }
  document.body.appendChild(dd);
  // 画面はみ出し補正
  { const ddRect = dd.getBoundingClientRect(); const z = _getZoom();
  if (ddRect.right > window.innerWidth) dd.style.left = ((window.innerWidth - ddRect.width - 4) / z) + 'px';
  if (ddRect.bottom > window.innerHeight) dd.style.top = ((window.innerHeight - ddRect.height - 4) / z) + 'px'; }

  setTimeout(() => {
    const close = (ev) => {
      const inAny = [...document.querySelectorAll('.tool-menu-dropdown')].some(m => m.contains(ev.target));
      if (!inAny && ev.target !== btn) {
        document.querySelectorAll('.tool-menu-dropdown').forEach(el => el.remove());
        document.removeEventListener('click', close);
      }
    };
    document.addEventListener('click', close);
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
      if (toolType === 'scriptnote' && entry?.type === 'scenario' && entry.path && typeof openScenarioInScriptNote === 'function') {
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
  if (state?.view === 'pivot' || state?.view === 'timeline' || state?.view === 'gallery'
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
  return /\.scriptnote\.json$/i.test(String(path || '').trim());
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
  return fileName.replace(/\.scriptnote\.json$/i, '').replace(/\.\w+$/i, '') || fallback || 'シナリオ';
}

async function _probeJsonFile(path) {
  try {
    const data = await apiFetch('/file?path=' + encodeURIComponent(path));
    return { exists: true, parsed: JSON.parse(data?.content || '{}') };
  } catch {
    return { exists: false, parsed: null };
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
        content: JSON.stringify(exportDoc, null, 2)
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
      if (comp._hasLoadedScenarioPath?.(target.path) && comp._hasRenderedScriptNoteDom?.()) return;
      if (typeof comp.restoreState === 'function') comp.restoreState(tabState);
      comp.state.scenarioPath = target.path;
      comp.state.label = tabLabel;
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

function showScriptNoteOpenModal(mode = 'open') {
  const isImport = mode === 'import';
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
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `<div class="modal" style="min-width:520px;max-width:760px;">
    <h3>${lucide(isImport ? 'scenario' : 'bookOpenText', 18)} ${isImport ? '旧シナリオからインポート' : 'シナリオを開く'}</h3>
    <div class="modal-body" style="display:flex;flex-direction:column;gap:8px;min-height:0;">
      <div class="field" style="display:flex;flex-direction:column;gap:6px;margin-bottom:0;min-height:0;flex:1 1 auto;">
        <label>フォルダツリーから${isImport ? '旧シナリオ' : 'シナリオ'}を選択</label>
        <div id="scriptnote-open-tree" style="flex:1 1 auto;min-height:280px;overflow:auto;border:1px solid var(--border);border-radius:6px;background:var(--bg);padding:8px;"></div>
      </div>
      <div id="scriptnote-open-selection" style="font-size:12px;color:var(--fg2);min-height:1.5em;padding:0 2px;"></div>
      <div style="font-size:11px;color:var(--fg2);line-height:1.6;">
        ${isImport ? 'フォルダを展開して旧シナリオファイル(.scenario.json)を選択してください。選択した旧シナリオからシナリオファイルを作成して開きます。' : 'フォルダを展開してシナリオファイルを選択してください。'}
      </div>
    </div>
    <div class="btn-row">
      <button id="scriptnote-open-cancel" class="btn">キャンセル</button>
      <button id="scriptnote-open-ok" class="primary" disabled>${isImport ? '作成して開く' : '開く'}</button>
    </div>
  </div>`;
  document.body.appendChild(overlay);
  const treeHost = overlay.querySelector('#scriptnote-open-tree');
  const selectionEl = overlay.querySelector('#scriptnote-open-selection');
  const openBtn = overlay.querySelector('#scriptnote-open-ok');
  let onKeyDown = null;
  const close = () => {
    if (onKeyDown) document.removeEventListener('keydown', onKeyDown);
    overlay.remove();
  };
  const submit = () => {
    if (!selectedPath) {
      showStatus(`${isImport ? 'インポートする旧シナリオ' : '開くシナリオファイル'}を選択してください`, true);
      return;
    }
    if (!isImport && !isScriptNotePath(selectedPath)) {
      showStatus('開く... ではシナリオファイルだけを選択できます。旧シナリオは「旧シナリオからインポート...」を使ってください', true);
      return;
    }
    close();
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
      el.style.background = '';
    });
    if (rowEl) {
      rowEl.classList.add('is-selected');
      rowEl.style.background = 'var(--bg3)';
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
    row.style.cssText = 'display:flex;align-items:center;gap:6px;padding:4px 6px 4px ' + (depth * 16 + 4) + 'px;border-radius:4px;cursor:pointer;min-height:26px;';
    row.addEventListener('mouseenter', () => {
      if (!row.classList.contains('is-selected')) row.style.background = 'var(--bg3)';
    });
    row.addEventListener('mouseleave', () => {
      if (!row.classList.contains('is-selected')) row.style.background = '';
    });
    const isFolder = item.type === 'folder' || item._isRoot;
    const toggle = document.createElement('button');
    toggle.type = 'button';
    if (isFolder) toggle.innerHTML = lucide('chevronRight', 10); else toggle.textContent = '';
    toggle.style.cssText = 'width:18px;min-width:18px;height:18px;padding:0;border:none;background:none;color:var(--fg2);cursor:' + (isFolder ? 'pointer' : 'default') + ';';
    const label = document.createElement('div');
    label.textContent = item.name || item.label || item.path?.split('/').pop() || '';
    const isSelectableItem = isImport ? isScenarioBrowseItem(item) : isScriptNoteBrowseItem(item);
    label.style.cssText = 'flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:' + (isSelectableItem ? 'var(--fg)' : 'var(--fg2)') + ';';
    row.appendChild(toggle);
    row.appendChild(label);
    wrapper.appendChild(row);
    const children = document.createElement('div');
    children.style.display = 'none';
    children.style.minWidth = '0';
    wrapper.appendChild(children);

    if (isFolder) {
      const toggleFolder = async () => {
        const willOpen = children.style.display === 'none';
        if (!willOpen) {
          children.style.display = 'none';
          toggle.innerHTML = lucide('chevronRight', 10);
          return;
        }
        toggle.innerHTML = lucide('chevronDown', 10);
        children.style.display = 'block';
        if (children.dataset.loaded === 'true') return;
        children.innerHTML = '<div style="padding:4px 8px;color:var(--fg2);font-size:12px;">読み込み中...</div>';
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
            children.innerHTML = '<div style="padding:4px 8px 4px ' + ((depth + 1) * 16 + 4) + 'px;color:var(--fg2);font-size:12px;">' + (isImport ? '旧シナリオなし' : 'シナリオなし') + '</div>';
          } else {
            visibleItems.forEach(child => children.appendChild(createNodeRow(child, depth + 1, rootPath)));
          }
          children.dataset.loaded = 'true';
        } catch {
          children.innerHTML = '<div style="padding:4px 8px 4px ' + ((depth + 1) * 16 + 4) + 'px;color:var(--red);font-size:12px;">読み込み失敗</div>';
        }
      };
      toggle.addEventListener('click', (e) => { e.stopPropagation(); toggleFolder(); });
      row.addEventListener('click', toggleFolder);
    } else {
      row.addEventListener('click', () => updateSelection(item.path, item.name || '', row));
      row.addEventListener('dblclick', () => {
        updateSelection(item.path, item.name || '', row);
        submit();
      });
      if (selectedPath && item.path === selectedPath) updateSelection(item.path, item.name || '', row);
    }
    return wrapper;
  };
  const renderTree = async () => {
    treeHost.innerHTML = '<div style="padding:8px;color:var(--fg2);font-size:12px;">読み込み中...</div>';
    try {
      const roots = await apiFetch('/outliner-roots');
      treeHost.innerHTML = '';
      if (!Array.isArray(roots) || !roots.length) {
        treeHost.innerHTML = '<div style="padding:8px;color:var(--fg2);font-size:12px;">フォルダツリーがありません</div>';
        return;
      }
      roots.forEach(root => {
        const rootNode = { ...root, type: 'folder', _isRoot: true };
        treeHost.appendChild(createNodeRow(rootNode, 0, root.path));
      });
      if (!selectedPath) updateSelection('', '', null);
    } catch {
      treeHost.innerHTML = '<div style="padding:8px;color:var(--red);font-size:12px;">フォルダツリーの読み込みに失敗しました</div>';
    }
  };
  overlay.querySelector('#scriptnote-open-cancel').addEventListener('click', close);
  openBtn.addEventListener('click', submit);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  onKeyDown = (e) => {
    if (e.key === 'Escape') close();
    if (e.key === 'Enter' && !openBtn.disabled) submit();
  };
  document.addEventListener('keydown', onKeyDown);
  renderTree();
}

function showScriptNoteImportModal() {
  return showScriptNoteOpenModal('import');
}

function loadScenarioIntoActiveScriptNote(path, label = '') {
  const comp = getActiveScriptNoteComponent();
  if (!comp || typeof comp._loadScenario !== 'function' || !path || !isScriptNotePath(path)) return false;
  comp.state.scenarioPath = path;
  comp.state.label = label || comp.state.label || '';
  const activeTab = typeof GBTabs !== 'undefined' && typeof GBTabs.getActiveTab === 'function' ? GBTabs.getActiveTab() : null;
  if (activeTab && activeTab.type === 'scriptnote') {
    activeTab.state = { ...(activeTab.state || {}), scenarioPath: comp.state.scenarioPath, label: comp.state.label };
    GBLayout.saveLayout?.();
  }
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
  return {
    url: '/export/' + type + '?path=' + encodeURIComponent(path) + '&format=' + format,
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

// 辞書ファイル出力（IME辞書形式）
async function _exportDictFile() {
  try {
    const work = typeof getWorkFolder === 'function' ? getWorkFolder() : '';
    const url = work ? '/link-dict?work=' + encodeURIComponent(work) : '/link-dict';
    const data = await apiFetch(url);
    const entries = data.entries || [];
    if (entries.length === 0) { showStatus('辞書に登録するエントリがありません', true); return; }
    // Google日本語入力形式: 読み\t単語\t品詞
    const lines = [];
    for (const e of entries) {
      if (!e.text) continue;
      const reading = e.ruby || '';
      if (!reading) continue;
      lines.push(reading + '\t' + e.text + '\t' + '固有名詞');
    }
    if (lines.length === 0) { showStatus('ふりがな付きエントリがありません', true); return; }
    if (typeof MeldexExportSave === 'undefined' || typeof MeldexExportSave.saveText !== 'function') {
      showStatus('保存ダイアログを初期化できませんでした', true);
      return;
    }
    await MeldexExportSave.saveText(lines.join('\n'), {
      filename: (work ? work.replace(/[\\/]/g, '_') + '_' : '') + 'dictionary.txt',
      extension: '.txt',
      dialogTitle: '辞書ファイルを書き出し',
      filetypes: [['テキストファイル', '*.txt'], ['すべてのファイル', '*.*']],
      bom: true,
      okMessage: `${lines.length}件の辞書エントリを出力しました`,
      errorMessage: '辞書ファイルの出力に失敗しました',
    });
  } catch (e) { showStatus('辞書ファイルの出力に失敗しました', true); }
}

// パスをクリップボードにコピー
function _copyCurrentFilePath() {
  const path = getCurrentFilePath();
  if (!path) return;
  navigator.clipboard.writeText(path).then(() => {
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
  if (!await cfConfirm(`「${name || path}」を削除しますか？`)) return;
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


/* Source chunk: gb-tool-menu.part02.js */
// ツール別メニュー項目
function buildToolMenuItems(toolType) {
  const currentPath = getCurrentFilePath();
  const hasFile = !!currentPath;
  const newItemType = {
    page: 'page', scriptnote: 'scriptnote', database: 'database',
    board: 'board', calendar: 'calendar', csv: 'page',
    'smart-db': 'smart-db', folder: 'page'
  };
  const isFolderTool = toolType === 'folder';

  // --- インポート/エクスポートサブメニュー定義 ---
  const importExport = {
    // HTML 出力は全種別で公開機能に一本化 (メニューからは削除)。
    // 公開したい場合は「公開設定...」「公開を更新」を使う (specific[] 側で提供)。
    page: {
      import: [
        { label: 'Markdownファイルを開く...', action: () => { if (typeof importMarkdownFile === 'function') importMarkdownFile(); }, disabled: !hasFile },
      ],
      export: [
        { label: 'Markdownとして保存...', action: () => _exportFile('note', 'md'), disabled: !hasFile },
        { label: 'Wordとして保存...', action: () => _exportFile('note', 'docx'), disabled: !hasFile },
        { label: '画像（PNG）として保存...', action: () => { if (typeof MeldexExportImage !== 'undefined') MeldexExportImage.exportCurrentView('page'); }, disabled: !hasFile },
        { separator: true },
        { label: 'Markdownをコピー', action: () => {
          const pc = document.getElementById('page-content');
          if (!pc) return;
          const md = typeof htmlToMd === 'function' ? htmlToMd(pc.innerHTML) : pc.innerText;
          navigator.clipboard.writeText(md).then(() => showStatus('マークダウンをコピーしました'));
        }, disabled: !hasFile },
      ],
    },
    scriptnote: {
      import: [
        { label: '旧シナリオからインポート...', action: () => showScriptNoteImportModal() },
      ],
      export: [
        { label: 'シナリオ形式として保存...', action: () => { if (typeof promptSaveCurrentScriptNoteAs === 'function') promptSaveCurrentScriptNoteAs(); }, disabled: !hasFile },
        { label: '画像（PNG）として保存...', action: () => { if (typeof MeldexExportImage !== 'undefined') MeldexExportImage.exportCurrentView('scriptnote'); }, disabled: !hasFile },
        { separator: true },
        { label: 'クリスタ送信', action: () => { if (typeof sn2CopyForClipStudio === 'function') sn2CopyForClipStudio(); }, disabled: !hasFile },
      ],
    },
    database: {
      import: [
        { label: 'CSVからインポート...', action: () => { if (typeof importCsvToDb === 'function') importCsvToDb(); }, disabled: !hasFile },
      ],
      export: [
        { label: 'CSVとして保存...', action: () => _exportFile('db', 'csv'), disabled: !hasFile },
        { label: 'Excelとして保存...', action: () => _exportFile('db', 'xlsx'), disabled: !hasFile },
        { label: '画像（PNG）として保存...', action: () => { if (typeof MeldexExportImage !== 'undefined') MeldexExportImage.exportCurrentView('database'); }, disabled: !hasFile },
        { separator: true },
        { label: '辞書ファイルを出力', action: () => _exportDictFile() },
      ],
    },
    board: {
      export: [
        { label: 'PNG画像として保存', action: () => { if (typeof bdExportImage === 'function') bdExportImage(); }, disabled: !hasFile },
        { label: 'SVG画像として保存...', action: () => _exportFile('canvas', 'svg'), disabled: !hasFile },
        { label: 'Markdownとして保存...', action: () => _exportFile('canvas', 'md'), disabled: !hasFile },
      ],
    },
    calendar: {
      export: [
        { label: '公開を更新', action: () => { if (typeof MeldexExportHtml !== 'undefined') MeldexExportHtml.publishCurrentView('calendar'); }, disabled: !hasFile },
        { label: '画像（PNG）として保存...', action: () => { if (typeof MeldexExportImage !== 'undefined') MeldexExportImage.exportCurrentView('calendar'); }, disabled: !hasFile },
        { separator: true },
        { label: '勤怠CSVとして保存...', action: () => { if (typeof exportAttendanceCsvFromMenu === 'function') exportAttendanceCsvFromMenu(); } },
      ],
    },
    csv: {
      export: [
        { label: '名前を付けて保存...', action: () => _exportFile('file', 'csv'), disabled: !hasFile },
        { label: '公開を更新', action: () => { if (typeof MeldexExportHtml !== 'undefined') MeldexExportHtml.publishCurrentView('csv'); }, disabled: !hasFile },
        { label: '画像（PNG）として保存...', action: () => { if (typeof MeldexExportImage !== 'undefined') MeldexExportImage.exportCurrentView('csv'); }, disabled: !hasFile },
      ],
    },
    'smart-db': {
      export: [
        { label: 'CSVとして保存...', action: () => _exportFile('db', 'csv'), disabled: !hasFile },
        { label: '公開を更新', action: () => { if (typeof MeldexExportHtml !== 'undefined') MeldexExportHtml.publishCurrentView('smart-db'); }, disabled: !hasFile },
        { label: '画像（PNG）として保存...', action: () => { if (typeof MeldexExportImage !== 'undefined') MeldexExportImage.exportCurrentView('smart-db'); }, disabled: !hasFile },
      ],
    },
  };

  // --- サブメニュー組み立て ---
  const ie = importExport[toolType] || {};
  const submenus = [];
  if (ie.import && ie.import.length > 0) {
    submenus.push({ label: 'インポート', icon: (typeof uiTransferIconName === 'function' ? uiTransferIconName('import') : 'download'), submenu: ie.import });
  }
  if (ie.export && ie.export.length > 0) {
    submenus.push({ label: 'エクスポート', icon: (typeof uiTransferIconName === 'function' ? uiTransferIconName('export') : 'upload'), submenu: ie.export });
  }

  // --- ツール固有の項目（サブメニュー以外） ---
  const specific = {
    page: [
      { label: 'オプションを表示', action: () => { if (typeof toggleOptionPanel === 'function') toggleOptionPanel(); else if (typeof toggleDetailPanel === 'function') toggleDetailPanel(); }, disabled: !hasFile },
      { label: '公開設定...', action: () => { if (typeof showPublishSettingsModal === 'function') showPublishSettingsModal(); }, disabled: !hasFile },
      { label: '公開を更新', action: () => { if (typeof publishCurrentPageView === 'function') publishCurrentPageView(); else if (typeof MeldexExportHtml !== 'undefined') MeldexExportHtml.publishCurrentView('page'); }, disabled: !hasFile },
    ],
    scriptnote: [
      { label: '開く...', action: () => showScriptNoteOpenModal() },
      { label: '公開設定...', action: () => { if (typeof showPublishSettingsModal === 'function') showPublishSettingsModal(); }, disabled: !hasFile },
    ],
    database: [
      { label: 'プロパティ管理', action: () => { if (typeof showColVisibilityModal === 'function') showColVisibilityModal(); }, disabled: !hasFile },
      { label: 'シート横断検索', action: () => { if (typeof showDbSearchModal === 'function') showDbSearchModal(); }, disabled: !hasFile },
      { label: '整合性検証', action: () => { if (typeof onValidateClick === 'function') onValidateClick(); }, disabled: !hasFile },
      { label: '検証ルール管理', action: () => { if (typeof showValidationRulesModal === 'function') showValidationRulesModal(state.currentDbPath || currentPath); }, disabled: !hasFile },
      { separator: true },
      { label: '公開設定...', action: () => { if (typeof showPublishSettingsModal === 'function') showPublishSettingsModal(); }, disabled: !hasFile },
    ],
    board: [
      { label: '新規リンクカード: ノート', action: () => {
        if (typeof bdCreateLinkedFileCardAt !== 'function') { showStatus('リンクカード追加機能を読み込めませんでした', true); return; }
        const pos = typeof bdGetCanvasCenterWorld === 'function' ? bdGetCanvasCenterWorld() : { x: 120, y: 120 };
        bdCreateLinkedFileCardAt(pos.x, pos.y, 'page');
      } },
      { label: '新規リンクカード: シート', action: () => {
        if (typeof bdCreateLinkedFileCardAt !== 'function') { showStatus('リンクカード追加機能を読み込めませんでした', true); return; }
        const pos = typeof bdGetCanvasCenterWorld === 'function' ? bdGetCanvasCenterWorld() : { x: 120, y: 120 };
        bdCreateLinkedFileCardAt(pos.x, pos.y, 'database');
      } },
      { label: '新規リンクカード: ボード', action: () => {
        if (typeof bdCreateLinkedFileCardAt !== 'function') { showStatus('リンクカード追加機能を読み込めませんでした', true); return; }
        const pos = typeof bdGetCanvasCenterWorld === 'function' ? bdGetCanvasCenterWorld() : { x: 120, y: 120 };
        bdCreateLinkedFileCardAt(pos.x, pos.y, 'board');
      } },
      { label: '既存ファイルへのリンクカード...', action: () => {
        if (typeof bdPromptAddLinkCardAt !== 'function') { showStatus('リンクカード追加機能を読み込めませんでした', true); return; }
        const pos = typeof bdGetCanvasCenterWorld === 'function' ? bdGetCanvasCenterWorld() : { x: 120, y: 120 };
        bdPromptAddLinkCardAt(pos.x, pos.y);
      } },
      { label: 'シート / スマートシートから一括読込...', action: () => {
        if (typeof bdOpenBulkLinkImport === 'function') bdOpenBulkLinkImport();
      }, disabled: !hasFile },
      { separator: true },
      { label: '公開設定...', action: () => { if (typeof showPublishSettingsModal === 'function') showPublishSettingsModal(); }, disabled: !hasFile },
    ],
    calendar: [
      { label: '新規イベント', action: () => { if (typeof addCalendarEvent === 'function') addCalendarEvent(); } },
      { separator: true },
      { label: '同期設定...', action: () => { if (typeof showCalSyncModal === 'function') showCalSyncModal(); } },
      { label: '公開設定...', action: () => { if (typeof showPublishSettingsModal === 'function') showPublishSettingsModal(); }, disabled: !hasFile },
    ],
    csv: [
      { label: '行を追加', action: () => { if (typeof addCsvRow === 'function') addCsvRow(); }, disabled: !hasFile },
      { label: '列を追加', action: () => { if (typeof addCsvColumn === 'function') addCsvColumn(); }, disabled: !hasFile },
      { separator: true },
      { label: 'シートに変換...', action: () => { if (typeof convertCsvToDb === 'function') convertCsvToDb(); }, disabled: !hasFile },
      { label: '公開設定...', action: () => { if (typeof showPublishSettingsModal === 'function') showPublishSettingsModal(); }, disabled: !hasFile },
    ],
    folder: [
      { label: '現在のフォルダを開く', action: () => { const path = getCurrentFilePath(); if (path && typeof openNative === 'function') openNative(path); }, disabled: !hasFile },
      { label: 'スライドショー', action: () => { if (typeof openFolderSlideshow === 'function') openFolderSlideshow(); }, disabled: !hasFile },
      { separator: true },
      { label: '表示設定', action: () => { if (typeof showFolderDisplaySettings === 'function') showFolderDisplaySettings(); } },
      { label: 'オプションを表示', action: () => { if (typeof showFolderPanelSettings === 'function') showFolderPanelSettings(); } },
    ],
    'smart-db': [
      { label: '公開設定...', action: () => { if (typeof showPublishSettingsModal === 'function') showPublishSettingsModal(); }, disabled: !hasFile },
    ],
  };

  const folderCreateItems = [
    { label: 'フォルダ', icon: 'folder', action: () => _createFolderViewItem('folder') },
    { label: 'ノート', icon: 'page', action: () => _createFolderViewItem('page') },
    { label: 'シナリオ', icon: 'bookOpenText', action: () => _createFolderViewItem('scriptnote') },
    { label: 'シート', icon: 'db', action: () => _createFolderViewItem('database') },
    { label: 'ボード', icon: 'presentation', action: () => _createFolderViewItem('board') },
    { label: 'カレンダー', icon: 'calendar', action: () => _createFolderViewItem('calendar') },
    { label: 'スマートシート', icon: 'databaseSearch', action: () => _createFolderViewItem('smart-db') },
  ];
  const common = isFolderTool
    ? [{ label: '新規作成', icon: 'plus', submenu: folderCreateItems }]
    : [
      { label: '新規作成', action: () => { if (typeof showAddOutlinerItem === 'function') showAddOutlinerItem(newItemType[toolType] || 'page'); } },
    ];

  const fileActions = hasFile && !isFolderTool ? [
    { separator: true },
    { label: '別名で保存...', action: () => _showSaveAsModal(currentPath) },
    { label: 'ファイルを複製', action: () => _duplicateCurrentFile(toolType) },
    { label: 'ファイルを削除', action: () => _deleteCurrentFile(toolType) },
  ] : [];

  const tailPre = [
    { separator: true },
    { label: 'バージョン管理', action: () => { if (typeof openCurrentVersionsTab === 'function') openCurrentVersionsTab(); }, disabled: !hasFile },
    { label: 'パスをコピー', action: () => _copyCurrentFilePath(), disabled: !hasFile },
  ];

  // 最近使ったファイル（サブメニュー化）
  const recentItem = {
    label: '最近使ったファイル',
    icon: 'clock',
    submenu: _buildRecentSubmenuItems(toolType),
  };

  // インポート / エクスポートを「閉じる」の上に配置
  const importExportBlock = submenus.length > 0
    ? [{ separator: true }, ...submenus]
    : [];

  const tailClose = [
    { separator: true },
    { label: '閉じる', action: () => closeCurrentView(), disabled: !hasFile },
  ];

  return [
    ...common,
    ...(specific[toolType] || []),
    ...fileActions,
    ...tailPre,
    { separator: true },
    recentItem,
    ...importExportBlock,
    ...tailClose,
  ];
}

// 別名で保存モーダル
async function _showSaveAsModal(srcPath) {
  if (!srcPath) return;
  const srcName = srcPath.includes('/') ? srcPath.substring(srcPath.lastIndexOf('/') + 1) : srcPath;
  const srcFolder = srcPath.includes('/') ? srcPath.substring(0, srcPath.lastIndexOf('/')) : '';
  // 拡張子を除いた名前
  const baseName = srcName.includes('.') ? srcName.substring(0, srcName.lastIndexOf('.')) : srcName;

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `<div class="modal" style="min-width:420px;max-width:520px;">
    <h3>${lucide('copy', 18)} 別名で保存</h3>
    <div class="field"><label>新しい名前</label><input id="saveas-name" type="text" value="${esc(baseName)}" style="width:100%;"></div>
    <div class="field"><label>保存先フォルダ</label>
      <div id="saveas-folder-display" style="padding:6px 8px;background:var(--bg2);border:1px solid var(--border);border-radius:4px;font-size:12px;cursor:pointer;display:flex;align-items:center;gap:4px;">
        ${lucide('folder', 14)} <span id="saveas-folder-label">${esc(srcFolder || '(ルート)')}</span>
        <span style="margin-left:auto;opacity:0.5;">${lucide('chevronDown', 12)}</span>
      </div>
      <div id="saveas-folder-tree" style="display:none;max-height:200px;overflow-y:auto;border:1px solid var(--border);border-radius:4px;margin-top:4px;background:var(--bg);"></div>
    </div>
    <div class="modal-footer" style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px;">
      <button id="saveas-cancel" class="btn">キャンセル</button>
      <button id="saveas-ok" class="btn btn-primary">保存</button>
    </div>
  </div>`;
  document.body.appendChild(overlay);

  const nameInput = overlay.querySelector('#saveas-name');
  const folderDisplay = overlay.querySelector('#saveas-folder-display');
  const folderTree = overlay.querySelector('#saveas-folder-tree');
  const folderLabel = overlay.querySelector('#saveas-folder-label');
  let selectedFolder = srcFolder;

  nameInput.focus();
  nameInput.select();

  // フォルダツリー表示/非表示
  folderDisplay.addEventListener('click', async () => {
    if (folderTree.style.display === 'none') {
      folderTree.style.display = '';
      await _loadSaveAsFolderTree(folderTree, selectedFolder, (path, label) => {
        selectedFolder = path;
        folderLabel.textContent = label || '(ルート)';
        folderTree.style.display = 'none';
      });
    } else {
      folderTree.style.display = 'none';
    }
  });

  // キャンセル
  overlay.querySelector('#saveas-cancel').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

  // 保存実行
  overlay.querySelector('#saveas-ok').addEventListener('click', async () => {
    const newName = nameInput.value.trim();
    if (!newName) { showStatus('名前を入力してください'); return; }
    try {
      const res = await apiPost('/outliner/save-as', {
        path: srcPath,
        new_name: newName,
        dest_folder: selectedFolder,
      });
      overlay.remove();
      showStatus('「' + (res.new_name || newName) + '」に保存しました', false, { showSaveDialog: true });
      if (typeof loadOutliner === 'function') loadOutliner();
    } catch (e) {
      showStatus('保存に失敗: ' + (e.message || e), true);
    }
  });

  // Enter で保存
  nameInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') overlay.querySelector('#saveas-ok').click();
    if (e.key === 'Escape') overlay.remove();
  });
}

// フォルダツリーを読み込んで表示
async function _loadSaveAsFolderTree(container, currentFolder, onSelect) {
  container.innerHTML = '';

  // ルートフォルダ
  const rootItem = _createFolderRow('(ルート)', '', currentFolder === '', onSelect, 0, 'home');
  container.appendChild(rootItem);

  // ルート直下を読み込み
  await _expandSaveAsFolder(container, '', currentFolder, onSelect, 0);
}

async function _expandSaveAsFolder(container, parentPath, currentFolder, onSelect, depth) {
  try {
    const data = await apiFetch('/browse?path=' + encodeURIComponent(parentPath) + '&sort=name&order=asc');
    const items = Array.isArray(data) ? data : (data.items || []);
    const folders = items.filter(i => i.type === 'folder');
    // parentPathの行の直後に挿入
    const parentRow = container.querySelector('[data-folder-path="' + CSS.escape(parentPath) + '"]');
    let insertAfter = parentRow;
    for (const item of folders) {
      if (container.querySelector('[data-folder-path="' + CSS.escape(item.path) + '"]')) continue;
      const row = _createFolderRow(item.name, item.path, item.path === currentFolder, onSelect, depth + 1, 'folder');
      row.dataset.folderPath = item.path;
      row.dataset.depth = depth + 1;
      // 展開トグル
      const toggle = document.createElement('span');
      toggle.style.cssText = 'cursor:pointer;opacity:0.5;flex-shrink:0;';
      toggle.innerHTML = lucide('chevronRight', 10);
      toggle.addEventListener('click', async (e) => {
        e.stopPropagation();
        const expanded = toggle.dataset.expanded === '1';
        if (expanded) {
          // 子行を削除
          const d = parseInt(row.dataset.depth);
          let next = row.nextElementSibling;
          while (next && parseInt(next.dataset.depth) > d) {
            const rm = next; next = next.nextElementSibling; rm.remove();
          }
          toggle.innerHTML = lucide('chevronRight', 10);
          toggle.dataset.expanded = '0';
        } else {
          await _expandSaveAsFolder(container, item.path, currentFolder, onSelect, depth + 1);
          toggle.innerHTML = lucide('chevronDown', 10);
          toggle.dataset.expanded = '1';
        }
      });
      row.prepend(toggle);
      if (insertAfter && insertAfter.nextSibling) {
        container.insertBefore(row, insertAfter.nextSibling);
      } else {
        container.appendChild(row);
      }
      insertAfter = row;
    }
  } catch (e) { /* ignore */ }
}

function _createFolderRow(name, path, isSelected, onSelect, depth, icon) {
  const row = document.createElement('div');
  row.dataset.folderPath = path;
  row.dataset.depth = depth;
  if (isSelected) row.dataset.selected = '1';
  row.style.cssText = 'padding:4px 8px;padding-left:' + (8 + depth * 16) + 'px;cursor:pointer;font-size:12px;display:flex;align-items:center;gap:4px;border-radius:3px;' +
    (isSelected ? 'background:var(--accent);color:var(--ui-fg-strong);' : '');
  row.innerHTML += lucide(icon || 'folder', 14) + ' ' + esc(name);
  row.addEventListener('click', () => {
    // 選択状態を更新
    row.closest('#saveas-folder-tree').querySelectorAll('[data-folder-path]').forEach(d => {
      delete d.dataset.selected; d.style.background = ''; d.style.color = '';
    });
    row.dataset.selected = '1';
    row.style.background = 'var(--accent)'; row.style.color = 'var(--ui-fg-strong)';
    onSelect(path, name || '(ルート)');
  });
  row.addEventListener('mouseenter', () => { if (!row.dataset.selected) row.style.background = 'var(--bg3)'; });
  row.addEventListener('mouseleave', () => { if (!row.dataset.selected) row.style.background = ''; });
  return row;
}
