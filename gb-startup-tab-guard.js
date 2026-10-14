/* ==============================
   gb-startup-tab-guard.js
   Startup guard for restored tabs that are missing or temporarily inaccessible.
   ============================== */

const MeldexStartupTabGuard = (() => {
  const AUXILIARY_MAIN_TAB_TYPES = new Set([
    'outliner', 'preview', 'detail', 'version', 'chat',
    'history', 'annotation', 'sticky', 'tags', 'search',
  ]);
  const verificationJobs = new Map(); // tabId::type::path -> Promise
  const verifiedPathKeys = new Set();
  let missingTabPruneStarted = false;

  function isStartupRestoreActive() {
    if (!window._meldexStartupRestoring) return false;
    return true;
  }

  // Kept for callers that still use the old name. Startup restoration is now
  // guarded consistently in Desktop, Cloud, and mobile routes.
  function isDesktopStartupRestoreActive() {
    return isStartupRestoreActive();
  }

  function currentRestoreEnvironment() {
    try {
      if (window.matchMedia?.('(max-width: 600px)')?.matches) return 'mobile';
      const params = new URLSearchParams(window.location?.search || '');
      if (params.get('desktop') === '1' || document.documentElement?.dataset?.desktopLaunch === '1') return 'desktop';
      if (document.body?.dataset?.cloudMode || document.documentElement?.dataset?.cloudMode) return 'cloud';
    } catch {}
    return 'desktop';
  }

  function isExternalStartupPath(path) {
    const value = String(path || '').trim().toLowerCase();
    return /^(https?:|data:|blob:|mailto:|javascript:)/.test(value);
  }

  function startupPathKey(tab, viewName) {
    return [tab?.id || '', viewName || tab?.type || '', tab?.path || ''].join('::');
  }

  function shouldVerifyStartupTabPath(viewName, tab) {
    const recovery = tab?.state?.startupRecovery;
    if (!isStartupRestoreActive() && recovery?.environment !== currentRestoreEnvironment()) return false;
    const path = tab?.path || '';
    if (!path || isExternalStartupPath(path)) return false;
    if (viewName === 'folder') return false;
    if (viewName === 'html' && tab?.state?.urlExternal) return false;
    return [
      'database', 'pivot', 'tree', 'gallery', 'kanban', 'timeline', 'gantt', 'chart', 'graph', 'form',
      'entity', 'page', 'media', 'html', 'csv', 'board', 'scriptnote',
      'calendar', 'compare',
    ].includes(viewName);
  }

  async function inspectStartupTabPath(viewName, tab) {
    const path = tab?.path || '';
    if (!path) return { state: 'available' };
    const base = (typeof API_BASE !== 'undefined') ? API_BASE : '/api';
    const dbViewTypes = new Set(['database', 'pivot', 'tree', 'gallery', 'kanban', 'timeline', 'gantt', 'chart', 'graph', 'form', 'calendar']);
    const endpoint = dbViewTypes.has(viewName)
      ? (base + '/check-type?path=' + encodeURIComponent(path))
      : (base + '/file-meta?path=' + encodeURIComponent(path));
    try {
      const res = await fetch(endpoint, { cache: 'no-store' });
      if (res.status === 404) return { state: 'missing', status: 404 };
      if (res.status === 401 || res.status === 403) return { state: 'forbidden', status: res.status };
      if (!res.ok) return { state: 'retryable', status: res.status };
      if (!dbViewTypes.has(viewName)) return { state: 'available' };
      const data = await res.json().catch(() => null);
      return data && data.type && data.type !== 'unknown'
        ? { state: 'available' }
        : { state: 'missing', status: 404 };
    } catch (error) {
      return { state: 'retryable', status: 0, message: error?.message || '' };
    }
  }

  async function startupTabPathExists(viewName, tab) {
    return (await inspectStartupTabPath(viewName, tab)).state !== 'missing';
  }

  function findPaneWithTabId(tabId) {
    if (typeof GBLayout === 'undefined' || !GBLayout.root || typeof GBLayout.getAllPanes !== 'function') return null;
    for (const pane of GBLayout.getAllPanes(GBLayout.root)) {
      const idx = (pane.tabs || []).findIndex(t => t?.id === tabId);
      if (idx >= 0) return { pane, paneId: pane.id, index: idx };
    }
    return null;
  }

  function closeMissingTab(tab, viewName) {
    const hit = findPaneWithTabId(tab?.id || '');
    if (!hit || typeof GBTabs === 'undefined' || typeof GBTabs.closeTab !== 'function') return false;
    GBTabs.closeTab(hit.paneId, tab.id, { skipHistory: true });
    if (typeof showStatus === 'function') {
      showStatus('削除済みの復元タブを閉じました: ' + (tab.label || tab.path || viewName || 'ファイル'));
    }
    return true;
  }

  function clearPathCheck(contentEl) {
    const checks = contentEl?.querySelectorAll?.(':scope > .gb-startup-path-check') || [];
    checks.forEach(el => el.remove());
  }

  function renderPathCheck(contentEl) {
    if (!contentEl) return;
    clearPathCheck(contentEl);
    if (getComputedStyle(contentEl).position === 'static') contentEl.style.position = 'relative';
    const box = document.createElement('div');
    box.className = 'gb-startup-path-check';
    box.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:var(--fg2);background:var(--bg);font-size:13px;min-height:160px;z-index:7;';
    box.textContent = '復元タブのファイルを確認しています...';
    contentEl.appendChild(box);
  }

  function setRecoveryState(tab, inspection) {
    tab.state = tab.state && typeof tab.state === 'object' ? tab.state : {};
    if (inspection?.state === 'forbidden' || inspection?.state === 'retryable') {
      tab.state.startupRecovery = {
        state: inspection.state,
        status: Number(inspection.status || 0),
        environment: currentRestoreEnvironment(),
      };
    } else {
      delete tab.state.startupRecovery;
    }
    GBLayout.saveLayout?.({ immediate: true });
  }

  function activateAnotherTab(tab) {
    const hit = findPaneWithTabId(tab?.id || '');
    if (!hit) return;
    const alternative = (hit.pane.tabs || []).find(candidate => candidate?.id !== tab.id && !candidate?.state?.startupRecovery);
    if (alternative && typeof GBTabs !== 'undefined') GBTabs.activateTab?.(hit.paneId, alternative.id);
  }

  function renderRecovery(contentEl, tab, viewName, inspection) {
    if (!contentEl) return;
    clearPathCheck(contentEl);
    if (getComputedStyle(contentEl).position === 'static') contentEl.style.position = 'relative';
    const box = document.createElement('div');
    box.className = 'gb-startup-path-check gb-startup-path-recovery';
    box.style.cssText = 'position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;color:var(--fg2);background:var(--bg);font-size:13px;min-height:160px;padding:24px;text-align:center;z-index:7;';
    const forbidden = inspection?.state === 'forbidden';
    const title = document.createElement('strong');
    title.style.color = 'var(--fg)';
    title.textContent = forbidden ? 'このノートを開く権限がありません' : 'このノートを読み込めませんでした';
    const reason = document.createElement('div');
    reason.textContent = forbidden
      ? '権限を確認してから再試行するか、別のノートを選んでください。'
      : '通信または保存先の一時的な問題です。タブは保持されています。';
    const actions = document.createElement('div');
    actions.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;justify-content:center;';
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.textContent = '再試行';
    retry.addEventListener('click', () => retryTab(tab, viewName));
    const another = document.createElement('button');
    another.type = 'button';
    another.textContent = '別のノートを選ぶ';
    another.addEventListener('click', () => activateAnotherTab(tab));
    actions.append(retry, another);
    box.append(title, reason, actions);
    contentEl.appendChild(box);
  }

  function isActiveTab(hit, tabId) {
    return !!hit && hit.pane?.tabs?.[hit.pane.activeTabIndex]?.id === tabId;
  }

  function verifyTab(tab, viewName, remount, { force = false } = {}) {
    const key = startupPathKey(tab, viewName);
    if (force) {
      verifiedPathKeys.delete(key);
      verificationJobs.delete(key);
    }
    if (verificationJobs.has(key)) return verificationJobs.get(key);
    const promise = inspectStartupTabPath(viewName, tab).then(inspection => {
      verificationJobs.delete(key);
      const current = findPaneWithTabId(tab.id);
      if (!current) return inspection;
      if (inspection.state === 'missing') {
        closeMissingTab(tab, viewName);
        return inspection;
      }
      setRecoveryState(tab, inspection);
      const contentEl = GBLayout.paneMap?.[current.paneId]?.contentEl;
      if (inspection.state === 'available') {
        verifiedPathKeys.add(key);
        if (isActiveTab(current, tab.id)) {
          clearPathCheck(contentEl);
          remount?.(current.pane);
        }
      } else if (isActiveTab(current, tab.id)) {
        renderRecovery(contentEl, tab, viewName, inspection);
      }
      return inspection;
    });
    verificationJobs.set(key, promise);
    return promise;
  }

  function retryTab(tab, viewName) {
    const hit = findPaneWithTabId(tab?.id || '');
    if (!hit) return;
    const contentEl = GBLayout.paneMap?.[hit.paneId]?.contentEl;
    renderPathCheck(contentEl);
    verifyTab(tab, viewName, () => GBLayout.render?.(), { force: true });
  }

  function deferMount(pane, contentEl, tab, viewName, remount) {
    if (!shouldVerifyStartupTabPath(viewName, tab)) return false;
    const key = startupPathKey(tab, viewName);
    const recovery = tab?.state?.startupRecovery;
    if (!isStartupRestoreActive() && recovery?.environment === currentRestoreEnvironment()) {
      renderRecovery(contentEl, tab, viewName, recovery);
      return true;
    }
    if (verifiedPathKeys.has(key)) return false;
    verifyTab(tab, viewName, remount);
    renderPathCheck(contentEl);
    return true;
  }

  function pruneRestoredTabs() {
    if (missingTabPruneStarted || !isStartupRestoreActive()) return;
    if (typeof GBLayout === 'undefined' || !GBLayout.root || typeof GBLayout.getAllPanes !== 'function') return;
    missingTabPruneStarted = true;
    // 復元レイアウトの補助タブ除去は起動時の一度だけ行う。ペイン再描画のたびに
    // 実行すると、起動後に「メインパネルで開く」で追加したタイマー等まで直後に消える。
    pruneAuxiliaryMainTabs();
    const candidates = [];
    GBLayout.getAllPanes(GBLayout.root).forEach(pane => {
      (pane.tabs || []).forEach(tab => {
        if (shouldVerifyStartupTabPath(tab?.type || '', tab)) {
          candidates.push({ tab, viewName: tab.type });
        }
      });
    });
    candidates.forEach(({ tab, viewName }) => {
      verifyTab(tab, viewName);
    });
  }

  function pruneAuxiliaryMainTabs() {
    if (typeof GBLayout === 'undefined' || !GBLayout.root || typeof GBLayout.getAllPanes !== 'function') return false;
    let changed = false;
    GBLayout.getAllPanes(GBLayout.root).forEach(pane => {
      if (!(pane?.meldexRole === 'main' || pane?.id === 'pane-main')) return;
      const tabs = Array.isArray(pane.tabs) ? pane.tabs : [];
      const kept = tabs.filter(tab => !AUXILIARY_MAIN_TAB_TYPES.has(tab?.type || ''));
      if (kept.length === tabs.length) return;
      pane.tabs = kept;
      if (!pane.tabs.length && typeof GBTabs !== 'undefined' && typeof GBTabs.createTab === 'function') {
        pane.tabs.push(GBTabs.createTab('フォルダ', 'folder', ''));
      }
      pane.activeTabIndex = Math.max(0, Math.min(pane.activeTabIndex || 0, pane.tabs.length - 1));
      changed = true;
    });
    if (!changed) return false;
    if (typeof GBLayout.render === 'function') GBLayout.render();
    if (typeof GBLayout.saveLayout === 'function') GBLayout.saveLayout({ immediate: true });
    if (typeof showStatus === 'function') showStatus('メインパネルの補助パネルタブを閉じました');
    return true;
  }

  return {
    closeMissingTab,
    currentRestoreEnvironment,
    deferMount,
    inspectStartupTabPath,
    isDesktopStartupRestoreActive,
    isStartupRestoreActive,
    pruneAuxiliaryMainTabs,
    pruneRestoredTabs,
    shouldVerifyStartupTabPath,
    startupTabPathExists,
  };
})();

if (typeof window !== 'undefined') {
  window.MeldexStartupTabGuard = MeldexStartupTabGuard;
}
