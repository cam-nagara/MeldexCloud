(function (global) {
  'use strict';

  const OVERLAY_SELECTOR = '[data-e2e-id="board-open-overlay"]';

  function _button(label, className, e2eId) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    button.textContent = label;
    if (e2eId) button.dataset.e2eId = e2eId;
    return button;
  }

  function _entryRow(entry, onOpen) {
    const path = String(entry?.path || '');
    const row = _button('', 'bsa-file-row', 'board-open-file-row');
    row.dataset.path = path;
    row.title = path;
    const name = document.createElement('span');
    name.className = 'bsa-file-name';
    name.textContent = path.split('/').pop() || path;
    const meta = document.createElement('span');
    meta.className = 'bsa-file-path';
    meta.textContent = path.includes('/') ? path.replace(/\/[^/]*$/, '') : '保存場所直下';
    row.append(name, meta);
    row.addEventListener('click', () => onOpen(path));
    return row;
  }

  function _stateMessage(message, kind) {
    const state = document.createElement('div');
    state.className = 'bsa-open-state' + (kind ? ` bsa-open-state-${kind}` : '');
    state.setAttribute('role', kind === 'error' ? 'alert' : 'status');
    state.textContent = message;
    return state;
  }

  function open(options = {}) {
    const existing = document.querySelector(OVERLAY_SELECTOR);
    if (existing?._boardStandaloneOpenDialogApi?.isOpen?.()) {
      existing._boardStandaloneOpenDialogApi.modal.focus?.();
      return existing._boardStandaloneOpenDialogApi;
    }
    if (!global.GBUI?.createModal || typeof options.loadEntries !== 'function' || typeof options.onOpen !== 'function') {
      throw new Error('ボードを開くダイアログを初期化できませんでした');
    }

    const trigger = options.trigger || document.activeElement;
    const content = document.createElement('div');
    content.className = 'bsa-open-content';
    const listHost = document.createElement('div');
    listHost.className = 'bsa-open-list-host';
    const status = document.createElement('div');
    status.className = 'bsa-open-status';
    status.dataset.e2eId = 'board-open-status';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    content.append(listHost, status);
    const closeButton = _button('閉じる', 'gb-btn gb-btn-sm', 'board-open-close');
    let openBusy = false;
    let loadGeneration = 0;
    let entries = [];
    const modalApi = global.GBUI.createModal({
      id: 'board-standalone-open-dialog',
      titleId: 'bsa-open-title',
      title: 'ボードを開く',
      body: content,
      footer: closeButton,
      variant: 'standard',
      extraClass: 'bsa-open-modal',
      geometryKey: 'board-standalone-open-dialog',
      minWidth: '0',
      initialFocus: () => listHost.querySelector('.bsa-file-row, [data-e2e-id="board-open-retry"]') || closeButton,
      returnFocus: () => trigger,
      closeLabel: 'ボード一覧を閉じる',
      closeOnEsc: true,
      closeOnOverlay: true,
      onBeforeClose: reason => !openBusy || ['opened', 'test-cleanup'].includes(reason),
      onClose: () => { loadGeneration += 1; },
    });
    modalApi.overlay.classList.add('modal-overlay', 'bsa-open-overlay');
    modalApi.overlay.dataset.e2eId = 'board-open-overlay';
    modalApi.overlay._boardStandaloneOpenDialogApi = modalApi;
    modalApi.modal.dataset.e2eId = 'board-open-dialog';
    modalApi.footer.dataset.e2eId = 'board-open-footer';
    modalApi.header.querySelector('.gb-modal-close')?.setAttribute('data-e2e-id', 'board-open-header-close');

    const setStatus = (message, error = false) => {
      status.textContent = message || '';
      status.classList.toggle('bsa-open-status-error', error);
      status.hidden = !message;
    };
    const setRowsDisabled = (disabled) => {
      listHost.querySelectorAll('.bsa-file-row').forEach(row => { row.disabled = disabled; });
    };
    const renderEntries = () => {
      listHost.replaceChildren();
      if (!entries.length) {
        listHost.appendChild(_stateMessage('この保存先にボードファイルはありません。', 'empty'));
        return;
      }
      const list = document.createElement('div');
      list.className = 'bsa-open-list';
      list.setAttribute('role', 'list');
      entries.forEach(entry => list.appendChild(_entryRow(entry, openPath)));
      listHost.appendChild(list);
    };
    const renderLoadError = (error) => {
      listHost.replaceChildren();
      const panel = document.createElement('div');
      panel.className = 'bsa-open-error-panel';
      panel.appendChild(_stateMessage(error?.message || 'ボード一覧を読み込めませんでした。', 'error'));
      const retry = _button('再試行', 'gb-btn gb-btn-sm gb-btn-primary', 'board-open-retry');
      retry.addEventListener('click', loadEntries);
      panel.appendChild(retry);
      listHost.appendChild(panel);
    };
    async function loadEntries() {
      const generation = ++loadGeneration;
      listHost.replaceChildren(_stateMessage('ボード一覧を読み込んでいます…', 'loading'));
      setStatus('');
      try {
        const loaded = await options.loadEntries();
        if (!modalApi.isOpen() || generation !== loadGeneration) return;
        entries = Array.isArray(loaded) ? loaded : [];
        renderEntries();
        requestAnimationFrame(() => (listHost.querySelector('.bsa-file-row') || closeButton).focus?.());
      } catch (error) {
        if (!modalApi.isOpen() || generation !== loadGeneration) return;
        renderLoadError(error);
      }
    }
    async function openPath(path) {
      if (openBusy || !path) return;
      openBusy = true;
      setRowsDisabled(true);
      setStatus(`ボードを開いています: ${path.split('/').pop() || path}`);
      try {
        const result = await options.onOpen(path);
        if (!modalApi.isOpen()) return;
        if (result === true || result?.opened === true) {
          modalApi.close('opened');
          return;
        }
        if (result?.cancelled) setStatus('未保存の変更は破棄されませんでした。別のボードを選べます。');
        else setStatus('ボードを開けませんでした。別のファイルを選ぶか、もう一度お試しください。', true);
      } catch (error) {
        if (modalApi.isOpen()) setStatus(error?.message || 'ボードを開けませんでした。', true);
      } finally {
        openBusy = false;
        if (modalApi.isOpen()) setRowsDisabled(false);
      }
    }

    closeButton.addEventListener('click', () => modalApi.close('cancel'));
    modalApi.open();
    loadEntries();
    return modalApi;
  }

  global.BoardStandaloneOpenDialog = Object.freeze({ open });
})(window);
