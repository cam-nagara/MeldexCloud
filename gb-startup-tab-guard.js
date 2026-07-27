/* ==============================
   gb-startup-tab-guard.js
   Desktop startup guard for restored tabs that point to deleted files.
   ============================== */

const MeldexStartupTabGuard = (() => {
  const AUXILIARY_MAIN_TAB_TYPES = new Set([
    'outliner', 'preview', 'detail', 'version', 'chat', 'timer',
    'history', 'annotation', 'sticky', 'tags', 'search',
  ]);
  const verificationJobs = new Map(); // tabId::type::path -> Promise
  const verifiedPathKeys = new Set();
  let missingTabPruneStarted = false;

  function isDesktopStartupRestoreActive() {
    if (!window._meldexStartupRestoring) return false;
    try {
      const params = new URLSearchParams(window.location.search || '');
      return params.get('desktop') === '1' || document.documentElement?.dataset?.desktopLaunch === '1';
    } catch {
      return false;
    }
  }

  function isExternalStartupPath(path) {
    const value = String(path || '').trim().toLowerCase();
    return /^(https?:|data:|blob:|mailto:|javascript:)/.test(value);
  }

  function startupPathKey(tab, viewName) {
    return [tab?.id || '', viewName || tab?.type || '', tab?.path || ''].join('::');
  }

  function shouldVerifyStartupTabPath(viewName, tab) {
    if (!isDesktopStartupRestoreActive()) return false;
    const path = tab?.path || '';
    if (!path || isExternalStartupPath(path)) return false;
    if (viewName === 'folder') return false;
    if (viewName === 'html' && tab?.state?.urlExternal) return false;
    return [
      'database', 'pivot', 'gallery', 'kanban', 'timeline', 'chart', 'graph', 'form',
      'smart-db', 'entity', 'page', 'media', 'html', 'csv', 'board', 'scriptnote',
      'calendar', 'compare',
    ].includes(viewName);
  }

  async function startupTabPathExists(viewName, tab) {
    const path = tab?.path || '';
    if (!path) return true;
    const base = (typeof API_BASE !== 'undefined') ? API_BASE : '/api';
    const dbViewTypes = new Set(['database', 'pivot', 'gallery', 'kanban', 'timeline', 'chart', 'graph', 'form', 'calendar']);
    const endpoint = dbViewTypes.has(viewName)
      ? (base + '/check-type?path=' + encodeURIComponent(path))
      : (base + '/file-meta?path=' + encodeURIComponent(path));
    try {
      const res = await fetch(endpoint, { cache: 'no-store' });
      if (res.status === 404) return false;
      if (!res.ok) return true;
      if (!dbViewTypes.has(viewName)) return true;
      const data = await res.json().catch(() => null);
      return !!(data && data.type && data.type !== 'unknown');
    } catch {
      return true;
    }
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
    const box = document.createElement('div');
    box.className = 'gb-startup-path-check';
    box.style.cssText = 'display:flex;align-items:center;justify-content:center;flex:1;color:var(--fg2);font-size:13px;min-height:160px;';
    box.textContent = '復元タブのファイルを確認しています...';
    contentEl.replaceChildren(box);
  }

  function deferMount(pane, contentEl, tab, viewName, remount) {
    if (!shouldVerifyStartupTabPath(viewName, tab)) return false;
    const key = startupPathKey(tab, viewName);
    if (verifiedPathKeys.has(key)) return false;
    if (!verificationJobs.has(key)) {
      const promise = startupTabPathExists(viewName, tab).then(exists => {
        verificationJobs.delete(key);
        const current = findPaneWithTabId(tab.id);
        if (!current) return;
        if (!exists) {
          closeMissingTab(tab, viewName);
          return;
        }
        verifiedPathKeys.add(key);
        clearPathCheck(GBLayout.paneMap?.[current.paneId]?.contentEl);
        if (typeof remount === 'function') remount(current.pane);
      }).catch(() => {
        verificationJobs.delete(key);
        verifiedPathKeys.add(key);
        const current = findPaneWithTabId(tab.id);
        if (current) clearPathCheck(GBLayout.paneMap?.[current.paneId]?.contentEl);
        if (current && typeof remount === 'function') remount(current.pane);
      });
      verificationJobs.set(key, promise);
    }
    renderPathCheck(contentEl);
    return true;
  }

  function pruneRestoredTabs() {
    pruneAuxiliaryMainTabs();
    if (missingTabPruneStarted || !isDesktopStartupRestoreActive()) return;
    if (typeof GBLayout === 'undefined' || !GBLayout.root || typeof GBLayout.getAllPanes !== 'function') return;
    missingTabPruneStarted = true;
    const candidates = [];
    GBLayout.getAllPanes(GBLayout.root).forEach(pane => {
      (pane.tabs || []).forEach(tab => {
        if (shouldVerifyStartupTabPath(tab?.type || '', tab)) {
          candidates.push({ tab, viewName: tab.type });
        }
      });
    });
    candidates.forEach(({ tab, viewName }) => {
      startupTabPathExists(viewName, tab).then(exists => {
        if (!exists) closeMissingTab(tab, viewName);
      }).catch(() => {});
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
    deferMount,
    isDesktopStartupRestoreActive,
    pruneAuxiliaryMainTabs,
    pruneRestoredTabs,
    shouldVerifyStartupTabPath,
    startupTabPathExists,
  };
})();

if (typeof window !== 'undefined') {
  window.MeldexStartupTabGuard = MeldexStartupTabGuard;
}
