/* standalone-stubs.js: small Meldex globals for standalone app pages. */
(function () {
  'use strict';

  if (!window.state) {
    window.state = {
      view: '',
      currentPagePath: '',
      currentBoardPath: '',
      currentDbPath: '',
      currentEntityPath: '',
    };
  }

  function _icon(name, size) {
    return typeof window.lucide === 'function' ? window.lucide(name, size || 16) : '';
  }
  window.saIcon = _icon;

  const existingShowStatus = window.showStatus;
  window.showStatus = function (message, isError) {
    const toast = document.getElementById('standalone-toast');
    if (!toast) {
      if (typeof existingShowStatus === 'function') {
        existingShowStatus(message, isError);
      } else if (isError) {
        console.error(message);
      } else {
        console.log(message);
      }
      return;
    }
    toast.textContent = String(message || '');
    toast.classList.toggle('error', !!isError);
    toast.classList.add('visible');
    clearTimeout(window._standaloneToastTimer);
    window._standaloneToastTimer = setTimeout(() => toast.classList.remove('visible'), isError ? 6500 : 3600);
  };

  window.runStandaloneFileAction = async function (label, action) {
    try {
      return await action();
    } catch (error) {
      window.showStatus(String(label || '操作') + 'できません: ' + (error?.message || error || '不明なエラー'), true);
      return null;
    }
  };

  window.showLoading = window.showLoading || function (message) {
    const overlay = document.getElementById('standalone-loading');
    const text = document.getElementById('standalone-loading-text');
    if (text) text.textContent = String(message || '読み込んでいます...');
    if (overlay) overlay.classList.add('visible');
  };

  window.hideLoading = window.hideLoading || function () {
    document.getElementById('standalone-loading')?.classList.remove('visible');
  };

  window.showLoadingBeforeHeavyWork = window.showLoadingBeforeHeavyWork || async function (_content, message) {
    if (message) window.showLoading(message);
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  };

  window.cfConfirm = window.cfConfirm || function (message) {
    return Promise.resolve(typeof window.confirm !== 'function' || window.confirm(String(message || '')));
  };

  window.cfPrompt = window.cfPrompt || function (message, defaultValue) {
    return Promise.resolve(typeof window.prompt === 'function' ? window.prompt(String(message || ''), String(defaultValue || '')) : null);
  };

  window.showView = window.showView || function (view) {
    state.view = view;
  };
  window.isItemLocked = window.isItemLocked || function () { return false; };
  window.addRecent = window.addRecent || function () {};
  window.saveLastView = window.saveLastView || function () {};
  window.navPush = window.navPush || function () {};
  window.highlightOutlinerNode = window.highlightOutlinerNode || function () {};
  window.startAutoVersion = window.startAutoVersion || function () {};
  window.stopAutoVersion = window.stopAutoVersion || function () {};
  window.markAutoVersionDirty = window.markAutoVersionDirty || function () {};
  window.applyAutoLinks = window.applyAutoLinks || function (html) { return html; };
  window.renameAppPathReferences = window.renameAppPathReferences || function () {};
  window.handleRelocateResponse = window.handleRelocateResponse || function () {};
  window._renameTreeNode = window._renameTreeNode || function () {};
  window._orphanRemovedNoteLines = window._orphanRemovedNoteLines || function () {};
  window._updateLinkedPreview = window._updateLinkedPreview || function () {};
  window._showFileInfoInDetailPanel = window._showFileInfoInDetailPanel || function () {};
  window._syncDetailPanel = window._syncDetailPanel || function () {};
  window.syncNoteTocLayout = window.syncNoteTocLayout || function () {};
  window.updateNoteToc = window.updateNoteToc || function () {};
  window._getFrontmatterToc = window._getFrontmatterToc || function () { return undefined; };
  window.openMedia = window.openMedia || function () {};
  window._getZoom = window._getZoom || function () { return 1; };

  if (!window.MeldexDraftRecovery) {
    window.MeldexDraftRecovery = {
      queueDraft: function () {},
      saveDraft: function () {},
      markSynced: async function () {},
    };
  }
  if (!window.MeldexSaveSafety) {
    window.MeldexSaveSafety = {
      clearConflict: function () {},
      markConflict: function () {},
    };
  }
  if (!window.MeldexDisplayLayers) {
    window.MeldexDisplayLayers = {
      isEnabled: function () { return false; },
      scheduleIdle: function (fn) { setTimeout(fn, 0); },
    };
  }

  const historyStacks = new Map();
  function _scopeKey(scope) { return String(scope || 'default'); }
  window.historyPush = window.historyPush || function (label, undo, redo, scope, detail) {
    const key = _scopeKey(scope);
    const stack = historyStacks.get(key) || { undo: [], redo: [] };
    stack.undo.push({ label, undo, redo, detail });
    if (stack.undo.length > 100) stack.undo.shift();
    stack.redo.length = 0;
    historyStacks.set(key, stack);
  };
  window.historyUndo = window.historyUndo || function (scope) {
    const stack = historyStacks.get(_scopeKey(scope));
    const item = stack?.undo.pop();
    if (!item) return false;
    try { if (typeof item.undo === 'function') item.undo(); } finally { stack.redo.push(item); }
    return true;
  };
  window.historyRedo = window.historyRedo || function (scope) {
    const stack = historyStacks.get(_scopeKey(scope));
    const item = stack?.redo.pop();
    if (!item) return false;
    try { if (typeof item.redo === 'function') item.redo(); } finally { stack.undo.push(item); }
    return true;
  };
  window.historySetScope = window.historySetScope || function () {};
  window.captureLocalStorageSettings = window.captureLocalStorageSettings || function () { return {}; };
  window.restoreLocalStorageSettings = window.restoreLocalStorageSettings || function () {};
  window._normalizeLocalStorageSettingsSnapshots = window._normalizeLocalStorageSettingsSnapshots || function (before, after) {
    return { before: before || {}, after: after || {} };
  };
  window.isLocalStorageSettingsHistorySuppressed = window.isLocalStorageSettingsHistorySuppressed || function () { return false; };

  window.showToolMenu = window.showToolMenu || function () {};
  window.revealCurrentInFolderTree = window.revealCurrentInFolderTree || function () {
    window.showStatus('単独アプリではフォルダツリーを表示しません');
  };
  window._sn2SepAcquire = window._sn2SepAcquire || function () {};
  window._sn2SepRelease = window._sn2SepRelease || function () {};
  window.showFileStyleTab = window.showFileStyleTab || function () {};
  window.renderFileStyleTab = window.renderFileStyleTab || function () {};
  window.toggleOptionPanel = window.toggleOptionPanel || function () {};
  window.toggleDetailPanel = window.toggleDetailPanel || function () {};
  window.switchDetailTab = window.switchDetailTab || function () {};
  window.positionPopup = window.positionPopup || function (popup, rect) {
    if (!popup || !rect) return;
    const width = popup.offsetWidth || 220;
    const height = popup.offsetHeight || 120;
    const left = Math.max(8, Math.min(window.innerWidth - width - 8, rect.left));
    const top = Math.max(8, Math.min(window.innerHeight - height - 8, rect.bottom + 4));
    popup.style.left = left + 'px';
    popup.style.top = top + 'px';
  };

  window.registerToolComponent = window.registerToolComponent || function () {};
  window.forEachComponent = window.forEachComponent || function () {};

  window.attachStandaloneMenu = function (button, menu) {
    if (!button || !menu) return;
    if (menu.id) button.setAttribute('aria-controls', menu.id);
    button.setAttribute('aria-haspopup', 'menu');
    button.setAttribute('aria-expanded', 'false');
    if (!menu.getAttribute('role')) menu.setAttribute('role', 'menu');
    menu.querySelectorAll('button').forEach(item => {
      if (!item.getAttribute('role')) item.setAttribute('role', 'menuitem');
    });
    menu.querySelectorAll('.sa-menu-sep').forEach(item => {
      if (!item.getAttribute('role')) item.setAttribute('role', 'separator');
    });
    const close = (restoreFocus) => {
      menu.classList.remove('open');
      button.setAttribute('aria-expanded', 'false');
      if (restoreFocus) {
        try { button.focus({ preventScroll: true }); } catch { button.focus(); }
      }
    };
    button.addEventListener('click', event => {
      event.stopPropagation();
      const rect = button.getBoundingClientRect();
      const willOpen = !menu.classList.contains('open');
      menu.classList.toggle('open', willOpen);
      button.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
      if (willOpen) {
        window.positionPopup(menu, rect);
        const first = menu.querySelector('button:not([disabled])');
        try { first?.focus?.({ preventScroll: true }); } catch { first?.focus?.(); }
      }
    });
    document.addEventListener('pointerdown', event => {
      if (!menu.contains(event.target) && event.target !== button) close(false);
    });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && menu.classList.contains('open')) close(true);
    });
    menu.addEventListener('click', event => {
      if (event.target.closest('button')) close(false);
    });
  };
})();
