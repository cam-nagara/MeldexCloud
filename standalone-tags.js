/* Unified tag-dictionary entry point for Meldex standalone apps. */
(function () {
  'use strict';

  if (typeof window === 'undefined') return;
  let button = null;
  let overlay = null;
  let targetRow = null;
  let targetEditor = null;
  let targetPath = '';
  let observer = null;

  function isCloudMode() {
    return window.MeldexStandaloneCloud?.isCloudMode?.() === true
      || document.documentElement?.hasAttribute('data-standalone-cloud') === true;
  }

  function isCloudConnected() {
    if (!isCloudMode()) return true;
    return window.MeldexStandaloneCloud?.getStatus?.()?.connected === true;
  }

  function createButton() {
    const node = document.createElement('button');
    node.type = 'button';
    node.className = 'sa-tags-button';
    node.dataset.saTagsButton = '1';
    node.dataset.e2eId = 'standalone-tags-button';
    node.title = 'タグ辞書';
    node.setAttribute('aria-label', 'タグ辞書');
    node.setAttribute('aria-haspopup', 'dialog');
    node.innerHTML = '<span class="ico ico-tags" aria-hidden="true"></span>';
    node.addEventListener('click', () => {
      if (typeof window.runStandaloneFileAction === 'function') {
        window.runStandaloneFileAction('タグ辞書を開く', openDialog);
      } else {
        openDialog();
      }
    });
    return node;
  }

  function insertionPoint() {
    const explicit = document.querySelector('[data-sa-profile-slot]');
    if (explicit) return { parent: explicit, before: explicit.querySelector('[data-sa-profile-badge]') };
    const header = document.querySelector('header.sa-toolbar');
    if (header) return { parent: header, before: header.querySelector('[data-sa-profile-badge]') };
    const board = document.querySelector('#board-canvas-root [data-bd-role="toolbar-top"]');
    if (board) return { parent: board, before: board.querySelector('.sa-mtb-more-btn') };
    const viewer = document.querySelector('#controls');
    if (viewer) return { parent: viewer, before: viewer.querySelector('#btn-default-apps') };
    return null;
  }

  function updateVisibility() {
    if (button) button.hidden = false;
    if (targetRow) targetRow.hidden = !targetPath;
  }

  function ensureTargetRow() {
    if (targetRow?.isConnected) return true;
    const header = document.querySelector('header.sa-toolbar');
    const viewerControls = document.getElementById('controls');
    if (!header?.parentNode && !viewerControls?.parentNode) return false;
    targetRow = document.createElement('section');
    targetRow.className = 'sa-inline-tags' + (viewerControls ? ' sa-inline-tags-viewer' : '');
    targetRow.dataset.e2eId = 'standalone-inline-tags';
    targetRow.setAttribute('aria-label', 'このファイルのタグ');
    targetEditor = document.createElement('div');
    targetEditor.className = 'sa-inline-tags-editor';
    targetRow.appendChild(targetEditor);
    if (header?.parentNode) header.insertAdjacentElement('afterend', targetRow);
    else viewerControls.insertAdjacentElement('beforebegin', targetRow);
    updateVisibility();
    return true;
  }

  function setTargetPath(path) {
    targetPath = String(path || '').replace(/\\/g, '/');
    if (!ensureTargetRow()) return;
    targetRow.hidden = !targetPath;
    targetEditor.dataset.globalTagsTargetPath = targetPath;
    if (targetPath && typeof window.renderGlobalTagTargetEditor === 'function') {
      window.renderGlobalTagTargetEditor(targetEditor, targetPath, { compact: true, boxed: false });
    } else {
      targetEditor.replaceChildren();
    }
  }

  function insertButton() {
    if (button?.isConnected) {
      updateVisibility();
      return true;
    }
    const target = insertionPoint();
    if (!target) return false;
    button = createButton();
    target.parent.insertBefore(button, target.before || null);
    updateVisibility();
    return true;
  }

  function watchInsertion() {
    if (insertButton()) return;
    if (observer || !document.body) return;
    observer = new MutationObserver(() => {
      if (insertButton()) {
        observer.disconnect();
        observer = null;
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function closeDialog(options) {
    if (!overlay) return;
    const previous = overlay;
    overlay = null;
    previous.remove();
    document.removeEventListener('keydown', onKeydown, true);
    if (options?.restoreFocus !== false) button?.focus?.();
  }

  function onKeydown(event) {
    if (event.key === 'Escape' && overlay) {
      event.preventDefault();
      closeDialog();
    }
  }

  async function openDialog() {
    if (overlay) return;
    if (typeof window.renderTagManagementTab !== 'function') {
      throw new Error('タグ辞書画面を読み込めませんでした');
    }
    overlay = document.createElement('div');
    overlay.className = 'sa-tags-overlay';
    overlay.dataset.e2eId = 'standalone-tags-overlay';
    overlay.addEventListener('pointerdown', event => {
      if (event.target === overlay) closeDialog();
    });

    const dialog = document.createElement('section');
    dialog.className = 'sa-tags-dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'sa-tags-title');
    const head = document.createElement('header');
    head.className = 'sa-tags-dialog-head';
    const title = document.createElement('h2');
    title.id = 'sa-tags-title';
    title.className = 'sa-tags-dialog-title';
    title.textContent = 'タグ辞書';
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'sa-tags-dialog-close';
    close.dataset.e2eId = 'standalone-tags-close';
    close.setAttribute('aria-label', '閉じる');
    close.innerHTML = '<span class="ico ico-x" aria-hidden="true"></span>';
    close.addEventListener('click', () => closeDialog());
    head.append(title, close);

    const body = document.createElement('div');
    body.className = 'sa-tags-dialog-body';
    body.dataset.e2eId = 'standalone-tags-body';
    dialog.append(head, body);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
    document.addEventListener('keydown', onKeydown, true);
    close.focus();
    await window.renderTagManagementTab(body);
  }

  function initialize() {
    watchInsertion();
    ensureTargetRow();
    window.addEventListener('meldex:standalone-cloud-ready', () => {
      insertButton();
      updateVisibility();
    });
    window.addEventListener('meldex:standalone-auth-changed', updateVisibility);
  }

  window.MeldexStandaloneTags = {
    open: openDialog,
    close: closeDialog,
    refresh: updateVisibility,
    setTargetPath,
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, { once: true });
  else initialize();
})();
