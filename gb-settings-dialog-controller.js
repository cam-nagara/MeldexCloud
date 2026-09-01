/* Meldex settings dialog navigation state machine */
(function initSettingsDialogController(global) {
  'use strict';
  const controllers = new WeakMap();
  const setHidden = (element, hidden) => { if (element) element.hidden = hidden === true; };

  function create(options) {
    const modal = options?.modal;
    if (!modal) throw new Error('settings modal is required');
    const footer = options.footer || modal.querySelector(':scope > .gb-modal-footer, :scope > .gb-modal-shell-footer');
    const mobile = options.mobile === true;
    const state = { level: mobile ? 'categories' : 'page', tabId: '', pageId: '' };
    const categoryList = modal.querySelector('#settings-nav-list');
    const pageList = modal.querySelector('#settings-mobile-page-list');
    const pageListTitle = modal.querySelector('#settings-mobile-page-list-title');
    const pageListItems = modal.querySelector('#settings-mobile-page-list-items');
    const backButton = modal.querySelector('#settings-back-btn');
    const headerText = modal.querySelector('#settings-header-text');

    function setHeader(text) { if (headerText) headerText.textContent = String(text || '設定'); }
    function syncCurrentPage(target) {
      modal.dataset.settingsActiveTabId = target?.tabId || '';
      modal.dataset.settingsActivePageId = target?.pageId || '';
      modal.querySelectorAll('[data-settings-page]').forEach(button => {
        const current = button.dataset.settingsTab === target?.tabId && button.dataset.settingsPage === target?.pageId;
        if (current) button.setAttribute('aria-current', 'page');
        else button.removeAttribute('aria-current');
      });
    }
    function syncFooter(target) {
      const mode = target?.page?.commitMode || 'draft-save';
      setHidden(footer, mobile && state.level !== 'page');
      if (!footer || (mobile && state.level !== 'page')) return;
      const cancel = footer.querySelector('[data-e2e-id="settings-dialog-cancel"]');
      const save = footer.querySelector('[data-e2e-id="settings-dialog-save"]');
      const draft = mode === 'draft-save';
      setHidden(save, !draft);
      if (cancel) cancel.textContent = draft ? 'キャンセル' : '閉じる';
      footer.dataset.settingsCommitMode = mode;
    }
    function showCategories() {
      Object.assign(state, { level: 'categories', tabId: '', pageId: '' });
      modal.querySelectorAll('.settings-panel').forEach(panel => { panel.hidden = true; });
      setHidden(categoryList, false); setHidden(pageList, true); setHidden(backButton, true); setHidden(footer, true);
      setHeader('設定'); options.syncOverlay?.('');
    }
    function showPages(target) {
      Object.assign(state, { level: 'pages', tabId: target.tabId, pageId: '' });
      modal.querySelectorAll('.settings-panel').forEach(panel => { panel.hidden = true; });
      setHidden(categoryList, true); setHidden(pageList, false); setHidden(backButton, false); setHidden(footer, true);
      setHeader(target.tabId);
      if (pageListTitle) pageListTitle.textContent = target.tabId;
      if (pageListItems) {
        pageListItems.replaceChildren();
        target.tab.pages.forEach(page => {
          const button = document.createElement('button');
          button.type = 'button'; button.className = 'settings-mobile-page-item';
          button.dataset.settingsTab = target.tabId; button.dataset.settingsPage = page.id;
          button.dataset.e2eId = `settings-mobile-page-${target.tabId}-${page.id}`;
          button.textContent = page.label;
          button.addEventListener('click', () => open(target.tabId, { pageId: page.id, forcePage: true }));
          pageListItems.appendChild(button);
        });
      }
      options.replaceIcons?.(modal);
    }
    function showPage(target) {
      Object.assign(state, { level: 'page', tabId: target.tabId, pageId: target.pageId });
      setHidden(categoryList, true); setHidden(pageList, true); setHidden(backButton, !mobile);
      options.showTarget(target); setHeader(options.displayName?.(target) || target.pageLabel || target.tabId);
      syncCurrentPage(target); syncFooter(target);
    }
    function open(name, openOptions = {}) {
      const target = options.resolveTarget(name, openOptions);
      if (!target?.tab) return null;
      const explicitPage = Boolean(openOptions.pageId || openOptions.forcePage || String(name || '') !== target.tabId);
      if (mobile && target.tab.pages.length > 1 && !explicitPage) showPages(target);
      else showPage(target);
      return target;
    }
    function back() {
      if (!mobile) return;
      if (state.level === 'page' && state.tabId) {
        const target = options.resolveTarget(state.tabId);
        if (target?.tab?.pages?.length > 1) return showPages(target);
      }
      showCategories();
    }
    const controller = { state, open, back, showCategories, syncCurrentPage };
    controllers.set(modal, controller);
    return controller;
  }
  global.MeldexSettingsDialogController = Object.freeze({ create, get: modal => controllers.get(modal) || null });
})(window);
