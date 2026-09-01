/* gb-sheet-attachment-cleanup.js:
   シートの添付ファイルを一覧して、どこからも使われていないものを整理する画面。
   セルから外しても実ファイルは残す仕様のため、ここが唯一の削除導線になる。
   削除はゴミ箱へ移動する通常の削除経路（/outliner/delete-batch）を通すので、
   参照が残っているファイルには既存の削除前警告がそのまま効く。 */
(function () {
  'use strict';

  let cleanupState = null;

  function _formatSize(bytes) {
    const size = Number(bytes || 0);
    if (size < 1024) return size + ' B';
    if (size < 1024 * 1024) return (size / 1024).toFixed(1) + ' KB';
    if (size < 1024 * 1024 * 1024) return (size / (1024 * 1024)).toFixed(1) + ' MB';
    return (size / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
  }

  function _iconFor(kind) {
    if (typeof lucide !== 'function') return '';
    if (kind === 'video') return lucide('film', 15);
    if (kind === 'pdf') return lucide('fileText', 15);
    if (kind === 'image') return lucide('image', 15);
    return lucide('file', 15);
  }

  function _sheetName(dbPath) {
    return String(dbPath || '').replace(/\\/g, '/').replace(/\/+$/, '').split('/').pop() || 'シート';
  }

  function _button(label, id, variant = '') {
    const button = document.createElement('button');
    button.type = 'button';
    button.id = id;
    button.dataset.e2eId = id;
    button.className = 'gb-btn gb-btn-sm' + (variant ? ' gb-btn-' + variant : '');
    button.textContent = label;
    return button;
  }

  function _setStatus(message, isError = false) {
    const current = cleanupState;
    if (!current) return;
    current.statusEl.textContent = String(message || '');
    current.statusEl.dataset.error = isError ? 'true' : 'false';
  }

  function _syncControls() {
    const current = cleanupState;
    if (!current) return;
    const busy = current.busyDepth > 0;
    current.modal.setAttribute('aria-busy', busy ? 'true' : 'false');
    if (!busy) current.modal.removeAttribute('aria-busy');
    current.unusedOnlyEl.disabled = busy;
    current.openFolderBtn.disabled = busy;
    current.deleteBtn.disabled = busy || current.selected.size === 0;
    current.listEl.querySelectorAll('input[type="checkbox"]').forEach(input => { input.disabled = busy; });
    current.deleteBtn.textContent = current.selected.size
      ? `選択した${current.selected.size}件を削除`
      : '選択したものを削除';
  }

  function _beginBusy() {
    if (!cleanupState) return;
    cleanupState.busyDepth += 1;
    _syncControls();
  }

  function _endBusy() {
    if (!cleanupState) return;
    cleanupState.busyDepth = Math.max(0, cleanupState.busyDepth - 1);
    _syncControls();
  }

  function _render() {
    const current = cleanupState;
    if (!current) return;
    const unusedOnly = current.unusedOnlyEl.checked;
    const items = current.payload.items.filter(item => (unusedOnly ? !item.used : true));
    current.listEl.replaceChildren();
    if (!current.payload.items.length || !items.length) {
      const empty = document.createElement('div');
      empty.className = 'gb-attachment-cleanup-empty';
      empty.dataset.e2eId = 'sheet-attachment-cleanup-empty';
      empty.textContent = current.payload.items.length
        ? '使われていない添付ファイルはありません'
        : 'このシートに添付ファイルはありません';
      current.listEl.appendChild(empty);
      _syncControls();
      return;
    }
    items.forEach((item, index) => {
      const row = document.createElement('label');
      row.className = 'gb-attachment-cleanup-row' + (item.used ? ' is-used' : '');
      row.dataset.e2eId = `sheet-attachment-cleanup-row-${index}`;

      const check = document.createElement('input');
      check.type = 'checkbox';
      check.id = `sheet-attachment-cleanup-select-${index}`;
      check.dataset.e2eId = check.id;
      check.dataset.path = String(item.path || '');
      check.checked = current.selected.has(item.path);
      check.addEventListener('change', () => {
        if (check.checked) current.selected.add(item.path);
        else current.selected.delete(item.path);
        _syncControls();
      });
      row.htmlFor = check.id;
      row.appendChild(check);

      const icon = document.createElement('span');
      icon.className = 'gb-attachment-cleanup-icon';
      icon.innerHTML = _iconFor(item.kind);
      row.appendChild(icon);

      const name = document.createElement('span');
      name.className = 'gb-attachment-cleanup-name';
      name.textContent = item.name;
      name.title = item.path;
      row.appendChild(name);

      const meta = document.createElement('span');
      meta.className = 'gb-attachment-cleanup-meta';
      meta.textContent = _formatSize(item.size);
      row.appendChild(meta);

      const usage = document.createElement('span');
      usage.className = 'gb-attachment-cleanup-state';
      usage.textContent = item.used ? '使用中' : '未使用';
      row.appendChild(usage);
      current.listEl.appendChild(row);
    });
    _syncControls();
  }

  async function _reload(options = {}) {
    const current = cleanupState;
    if (!current) return false;
    _beginBusy();
    current.listEl.replaceChildren();
    const loading = document.createElement('div');
    loading.className = 'gb-attachment-cleanup-empty';
    loading.dataset.e2eId = 'sheet-attachment-cleanup-loading';
    loading.textContent = '読み込み中...';
    current.listEl.appendChild(loading);
    try {
      const next = await apiFetch('/sheet-attachments?path=' + encodeURIComponent(current.path));
      current.payload = next || { items: [] };
      current.payload.items = Array.isArray(current.payload.items) ? current.payload.items : [];
      if (!options.preserveSelection) current.selected.clear();
      else {
        const livePaths = new Set(current.payload.items.map(item => item.path));
        [...current.selected].forEach(path => { if (!livePaths.has(path)) current.selected.delete(path); });
      }
      current.summaryEl.textContent = `${_sheetName(current.path)}: 全${current.payload.items.length}件 / 未使用${current.payload.unused_count || 0}件 / ${_formatSize(current.payload.total_size)}`;
      if (!options.keepStatus) _setStatus('');
      _render();
      return true;
    } catch (error) {
      current.payload = { items: [], unused_count: 0, folder: '', total_size: 0 };
      current.selected.clear();
      current.summaryEl.textContent = `${_sheetName(current.path)}: 読み込み失敗`;
      _setStatus(error?.userMessage || error?.message || '添付ファイルを読み込めませんでした', true);
      _render();
      return false;
    } finally {
      _endBusy();
    }
  }

  async function _confirmDelete(message) {
    if (typeof cfConfirm === 'function') {
      return !!await cfConfirm(message, { danger: true, okLabel: 'ゴミ箱へ移動', cancelLabel: 'キャンセル' });
    }
    return confirm(message);
  }

  async function _deleteSelected() {
    const current = cleanupState;
    if (!current || !current.selected.size || current.busyDepth) return;
    const targets = current.payload.items.filter(item => current.selected.has(item.path));
    const usedCount = targets.filter(item => item.used).length;
    const lines = [`添付ファイル${targets.length}件をゴミ箱へ移動します。`];
    if (usedCount) lines.push(`このうち${usedCount}件は現在シートで使われています。削除すると表示できなくなります。`);
    let confirmation = null;
    if (window.MeldexDeleteImpactWarning?.confirmDeleteWithImpact) {
      confirmation = await window.MeldexDeleteImpactWarning.confirmDeleteWithImpact(
        targets.map(item => ({ path: item.path, kind: 'file' })),
        lines.join('\n'),
        { danger: true, okLabel: 'ゴミ箱へ移動', cancelLabel: 'キャンセル', operation: 'trash' },
      );
    } else {
      confirmation = await _confirmDelete(lines.join('\n'));
    }
    if (!confirmation) {
      _setStatus('削除を取り消しました');
      return;
    }

    _setStatus('添付ファイルをゴミ箱へ移動しています...');
    _beginBusy();
    try {
      const confirmationPayload = typeof window.MeldexDeleteImpactWarning?.confirmationPayload === 'function'
        ? window.MeldexDeleteImpactWarning.confirmationPayload(confirmation)
        : {};
      const result = await apiPost('/outliner/delete-batch', {
        items: targets.map(item => ({ path: item.path })),
        ...confirmationPayload,
      });
      const failed = Array.isArray(result?.failed) ? result.failed : [];
      if (failed.length) {
        const detail = failed.map(item => item?.detail || item?.status || '').filter(Boolean).join(' / ');
        _setStatus(`${failed.length}件を削除できませんでした${detail ? `: ${detail}` : ''}`, true);
      } else {
        _setStatus(`添付ファイル${targets.length}件をゴミ箱へ移動しました`);
      }
      await _reload({ keepStatus: true, preserveSelection: failed.length > 0 });
    } catch (error) {
      _setStatus(error?.userMessage || error?.message || '削除に失敗しました', true);
    } finally {
      _endBusy();
    }
  }

  async function showSheetAttachmentCleanupModal(dbPath) {
    const returnFocus = document.activeElement instanceof HTMLElement && document.activeElement !== document.body
      ? document.activeElement
      : null;
    const path = String(dbPath || (typeof state !== 'undefined' ? state.currentDbPath : '') || '');
    if (!path) {
      if (typeof showStatus === 'function') showStatus('シートが開かれていません', true);
      return null;
    }
    if (cleanupState?.modalApi?.isOpen?.()) return cleanupState.overlay;
    if (typeof window.GBUI?.createModal !== 'function') {
      throw new Error('共通ダイアログを初期化できませんでした。');
    }

    const body = document.createElement('div');
    body.className = 'gb-attachment-cleanup-body';
    body.dataset.e2eId = 'sheet-attachment-cleanup-body';
    const toolbar = document.createElement('div');
    toolbar.className = 'gb-attachment-cleanup-toolbar';
    const filter = document.createElement('label');
    filter.className = 'gb-attachment-cleanup-filter';
    const unusedOnlyEl = document.createElement('input');
    unusedOnlyEl.id = 'gb-attach-unused-only';
    unusedOnlyEl.dataset.e2eId = 'sheet-attachment-cleanup-unused-only';
    unusedOnlyEl.type = 'checkbox';
    unusedOnlyEl.checked = true;
    filter.appendChild(unusedOnlyEl);
    filter.appendChild(document.createTextNode('使われていないものだけ表示'));
    const summaryEl = document.createElement('span');
    summaryEl.id = 'gb-attach-summary';
    summaryEl.dataset.e2eId = 'sheet-attachment-cleanup-summary';
    summaryEl.className = 'gb-section-desc';
    toolbar.appendChild(filter);
    toolbar.appendChild(summaryEl);
    const listEl = document.createElement('div');
    listEl.id = 'gb-attach-list';
    listEl.dataset.e2eId = 'sheet-attachment-cleanup-list';
    listEl.className = 'gb-attachment-cleanup-list';
    body.appendChild(toolbar);
    body.appendChild(listEl);

    const footer = document.createElement('div');
    footer.className = 'gb-attachment-cleanup-footer';
    const openFolderBtn = _button('保存先のフォルダを開く', 'gb-attach-open-folder');
    const statusEl = document.createElement('div');
    statusEl.className = 'gb-section-desc gb-attachment-cleanup-status';
    statusEl.dataset.e2eId = 'sheet-attachment-cleanup-status';
    statusEl.setAttribute('role', 'status');
    const closeBtn = _button('閉じる', 'gb-attach-close');
    const deleteBtn = _button('選択したものを削除', 'gb-attach-delete', 'danger');
    deleteBtn.disabled = true;
    footer.appendChild(openFolderBtn);
    footer.appendChild(statusEl);
    footer.appendChild(closeBtn);
    footer.appendChild(deleteBtn);

    let modalApi = null;
    modalApi = window.GBUI.createModal({
      id: 'sheet-attachment-cleanup',
      title: '添付ファイルの整理',
      body,
      footer,
      variant: 'mobile-sheet',
      extraClass: 'gb-attachment-cleanup-modal',
      geometryKey: 'sheet-attachment-cleanup',
      initialFocus: '#gb-attach-unused-only',
      returnFocus: returnFocus || undefined,
      closeOnEsc: true,
      closeOnOverlay: true,
      onBeforeClose: () => Number(cleanupState?.busyDepth || 0) === 0,
      onClose: () => {
        if (cleanupState?.modalApi === modalApi) cleanupState = null;
      },
    });
    const overlay = modalApi.overlay;
    const modal = modalApi.modal;
    overlay.dataset.e2eId = 'sheet-attachment-cleanup-overlay';
    modal.dataset.e2eId = 'sheet-attachment-cleanup-dialog';
    const headerClose = modalApi.header.querySelector('.gb-modal-close');
    if (headerClose) headerClose.dataset.e2eId = 'sheet-attachment-cleanup-header-close';

    cleanupState = {
      modalApi,
      overlay,
      modal,
      path,
      payload: { items: [], unused_count: 0, folder: '', total_size: 0 },
      selected: new Set(),
      busyDepth: 0,
      listEl,
      summaryEl,
      unusedOnlyEl,
      deleteBtn,
      openFolderBtn,
      statusEl,
    };

    unusedOnlyEl.addEventListener('change', () => {
      cleanupState?.selected.clear();
      _setStatus('');
      _render();
    });
    openFolderBtn.addEventListener('click', () => {
      const current = cleanupState;
      if (!current?.payload.folder) {
        _setStatus('添付フォルダはまだありません');
        return;
      }
      const folder = current.payload.folder;
      modalApi.close('action');
      if (typeof revealPathInFolderTree === 'function') revealPathInFolderTree(folder);
      else if (typeof showStatus === 'function') showStatus(folder);
    });
    closeBtn.addEventListener('click', () => modalApi.close('button'));
    deleteBtn.addEventListener('click', _deleteSelected);

    modalApi.open();
    await _reload();
    return overlay;
  }

  window.showSheetAttachmentCleanupModal = showSheetAttachmentCleanupModal;
})();
