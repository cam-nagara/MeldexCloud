/* gb-sheet-attachment-cleanup.js:
   シートの添付ファイルを一覧して、どこからも使われていないものを整理する画面。
   セルから外しても実ファイルは残す仕様のため、ここが唯一の削除導線になる。
   削除はゴミ箱へ移動する通常の削除経路（/outliner/delete-batch）を通すので、
   参照が残っているファイルには既存の削除前警告がそのまま効く。 */
(function () {
  'use strict';

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

  async function showSheetAttachmentCleanupModal(dbPath) {
    const path = String(dbPath || (typeof state !== 'undefined' ? state.currentDbPath : '') || '');
    if (!path) {
      if (typeof showStatus === 'function') showStatus('シートが開かれていません', true);
      return;
    }

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `<div class="modal gb-attachment-cleanup-modal">
      <h3>${typeof lucide === 'function' ? lucide('paperclip', 16) : ''} 添付ファイルの整理</h3>
      <div class="modal-body gb-attachment-cleanup-body">
        <div class="gb-attachment-cleanup-toolbar">
          <label class="gb-attachment-cleanup-filter">
            <input id="gb-attach-unused-only" type="checkbox" checked> 使われていないものだけ表示
          </label>
          <span id="gb-attach-summary" class="gb-section-desc"></span>
        </div>
        <div id="gb-attach-list" class="gb-attachment-cleanup-list"></div>
      </div>
      <div class="btn-row" style="justify-content:space-between;">
        <button type="button" id="gb-attach-open-folder">保存先のフォルダを開く</button>
        <div style="display:flex;gap:8px;">
          <button data-action="this.closest('.modal-overlay').remove()">閉じる</button>
          <button class="primary" id="gb-attach-delete" disabled>選択したものを削除</button>
        </div>
      </div>
    </div>`;
    document.body.appendChild(overlay);

    const listEl = overlay.querySelector('#gb-attach-list');
    const summaryEl = overlay.querySelector('#gb-attach-summary');
    const unusedOnlyEl = overlay.querySelector('#gb-attach-unused-only');
    const deleteBtn = overlay.querySelector('#gb-attach-delete');
    const openFolderBtn = overlay.querySelector('#gb-attach-open-folder');
    const selected = new Set();
    let payload = { items: [], unused_count: 0, folder: '', total_size: 0 };

    function _syncDeleteButton() {
      deleteBtn.disabled = selected.size === 0;
      deleteBtn.textContent = selected.size ? `選択した${selected.size}件を削除` : '選択したものを削除';
    }

    function _render() {
      const unusedOnly = !!unusedOnlyEl.checked;
      const items = payload.items.filter(item => (unusedOnly ? !item.used : true));
      listEl.replaceChildren();
      if (!payload.items.length) {
        const empty = document.createElement('div');
        empty.className = 'gb-attachment-cleanup-empty';
        empty.textContent = 'このシートに添付ファイルはありません';
        listEl.appendChild(empty);
        return;
      }
      if (!items.length) {
        const empty = document.createElement('div');
        empty.className = 'gb-attachment-cleanup-empty';
        empty.textContent = '使われていない添付ファイルはありません';
        listEl.appendChild(empty);
        return;
      }
      items.forEach((item) => {
        const row = document.createElement('label');
        row.className = 'gb-attachment-cleanup-row' + (item.used ? ' is-used' : '');
        const check = document.createElement('input');
        check.type = 'checkbox';
        check.checked = selected.has(item.path);
        check.addEventListener('change', () => {
          if (check.checked) selected.add(item.path);
          else selected.delete(item.path);
          _syncDeleteButton();
        });
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

        const state = document.createElement('span');
        state.className = 'gb-attachment-cleanup-state';
        state.textContent = item.used ? '使用中' : '未使用';
        row.appendChild(state);
        listEl.appendChild(row);
      });
    }

    async function _reload() {
      listEl.replaceChildren();
      const loading = document.createElement('div');
      loading.className = 'gb-attachment-cleanup-empty';
      loading.textContent = '読み込み中...';
      listEl.appendChild(loading);
      try {
        payload = await apiFetch('/sheet-attachments?path=' + encodeURIComponent(path)) || { items: [] };
      } catch (error) {
        payload = { items: [], unused_count: 0 };
        if (typeof showStatus === 'function') {
          showStatus(error?.userMessage || error?.message || '添付ファイルを読み込めませんでした', true);
        }
      }
      payload.items = Array.isArray(payload.items) ? payload.items : [];
      selected.clear();
      _syncDeleteButton();
      summaryEl.textContent = `${_sheetName(path)}: 全${payload.items.length}件 / 未使用${payload.unused_count || 0}件 / ${_formatSize(payload.total_size)}`;
      _render();
    }

    unusedOnlyEl.addEventListener('change', _render);

    openFolderBtn.addEventListener('click', () => {
      if (!payload.folder) {
        if (typeof showStatus === 'function') showStatus('添付フォルダはまだありません');
        return;
      }
      overlay.remove();
      if (typeof revealPathInFolderTree === 'function') revealPathInFolderTree(payload.folder);
      else if (typeof showStatus === 'function') showStatus(payload.folder);
    });

    deleteBtn.addEventListener('click', async () => {
      if (!selected.size) return;
      const targets = payload.items.filter(item => selected.has(item.path));
      const usedCount = targets.filter(item => item.used).length;
      const lines = [`添付ファイル${targets.length}件をゴミ箱へ移動します。`];
      if (usedCount) lines.push(`このうち${usedCount}件は現在シートで使われています。削除すると表示できなくなります。`);
      if (!confirm(lines.join('\n'))) return;
      deleteBtn.disabled = true;
      try {
        const result = await apiPost('/outliner/delete-batch', {
          items: targets.map(item => ({ path: item.path })),
        });
        const failed = Array.isArray(result?.failed) ? result.failed : [];
        if (failed.length) {
          if (typeof showStatus === 'function') showStatus(`${failed.length}件を削除できませんでした`, true);
        } else if (typeof showStatus === 'function') {
          showStatus(`添付ファイル${targets.length}件をゴミ箱へ移動しました`);
        }
      } catch (error) {
        if (typeof showStatus === 'function') {
          showStatus(error?.userMessage || error?.message || '削除に失敗しました', true);
        }
      }
      await _reload();
    });

    await _reload();
  }

  window.showSheetAttachmentCleanupModal = showSheetAttachmentCleanupModal;
})();
