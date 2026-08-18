/* gb-sheet-entry-attachments.js:
   シート全ファイル取込・エントリ添付のフロントエンド共通モジュール (Phase 2 & Phase 3)。
   フォルダツリー、フォルダパネル、開いているシートビューからのD&D取込、
   およびエントリ詳細での添付表示・操作を集約する。 */
(function (global) {
  'use strict';

  function _normalizePath(path) {
    return String(path || '').replace(/\\/g, '/').replace(/\/+$/, '');
  }

  function _icon(name, size = 14) {
    return typeof lucide === 'function' ? lucide(name, size) : '';
  }

  function formatBytes(bytes) {
    if (bytes == null || isNaN(bytes)) return '';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  function getAttachmentIcon(kind, name) {
    const ext = (name || '').split('.').pop()?.toLowerCase();
    if (kind === 'image' || ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'].includes(ext)) return 'image';
    if (kind === 'pdf' || ext === 'pdf') return 'fileText';
    if (kind === 'board' || ext === 'mel-board') return 'layout';
    if (kind === 'scenario' || ext === 'mel-scenario') return 'bookOpen';
    if (kind === 'sheet' || ['mel-sheet', 'csv', 'tsv'].includes(ext)) return 'table';
    if (kind === 'video' || ['mp4', 'webm', 'mov'].includes(ext)) return 'film';
    if (kind === 'folder') return 'folder';
    return 'file';
  }

  function openAttachment(item, entryPath) {
    const path = item.path;
    const name = item.name || path.split('/').pop();
    const ext = name.split('.').pop()?.toLowerCase();

    // Meldex内部形式
    if (ext === 'mel-board' && typeof openBoard === 'function') {
      openBoard(name.replace(/\.mel-board$/, ''), path);
      return;
    }
    if (ext === 'mel-scenario' && typeof openScenario === 'function') {
      openScenario(name.replace(/\.mel-scenario$/, ''), path);
      return;
    }
    if ((ext === 'mel-sheet' || ext === 'csv') && typeof selectDatabase === 'function') {
      selectDatabase(path);
      return;
    }
    if (ext === 'md' && typeof openPage === 'function') {
      openPage(name.replace(/\.md$/, ''), path);
      return;
    }

    // ビューワー（画像・PDF・動画等）
    if (typeof openViewer === 'function' || typeof window.openViewer === 'function') {
      const viewerFn = typeof openViewer === 'function' ? openViewer : window.openViewer;
      const fileUrl = window.MeldexResourceUrl?.fileRaw?.(path) || ('/api/file-raw?path=' + encodeURIComponent(path));
      viewerFn(name, fileUrl, ext, path);
      return;
    }

    // サブパネル・リンクルーター
    if (window.GBSubPanel && typeof window.GBSubPanel.open === 'function') {
      window.GBSubPanel.open(path);
      return;
    }

    // フォールバック: 別タブで開く
    window.open('/api/file-raw?path=' + encodeURIComponent(path), '_blank');
  }

  /**
   * シートへのD&Dを受理できるか判定する。
   */
  function canAcceptSheetDrop(event, sheetPath) {
    if (!event || !sheetPath) return false;
    if (typeof isItemLocked === 'function' && isItemLocked(sheetPath)) return false;
    const types = Array.from(event.dataTransfer?.types || []);
    const hasFiles = types.includes('Files');
    const hasMeldexNode = types.includes('application/x-meldex-node')
      || (typeof MeldexDnD !== 'undefined' && MeldexDnD.hasDropKind(event, 'node'));
    return hasFiles || hasMeldexNode;
  }

  /**
   * シート上でのdragover共通処理。
   */
  function handleSheetDragOver(event, sheetPath, element) {
    if (!canAcceptSheetDrop(event, sheetPath)) return false;
    event.preventDefault();
    event.stopPropagation();
    const isAlt = !!event.altKey;
    const types = Array.from(event.dataTransfer?.types || []);
    const isOsDrop = types.includes('Files') && !types.includes('application/x-meldex-node');
    event.dataTransfer.dropEffect = isAlt ? 'link' : (isOsDrop ? 'copy' : 'move');
    if (element) {
      element.classList.add('gb-sheet-dropzone-active');
    }
    return true;
  }

  function handleSheetDragLeave(event, element) {
    if (element) {
      element.classList.remove('gb-sheet-dropzone-active');
    }
  }

  /**
   * OSファイルツリー（webkitEntries等）からフラットなFileリストを取得する。
   */
  async function _extractFilesFromDataTransfer(dataTransfer) {
    if (!dataTransfer) return [];
    if (dataTransfer.items && dataTransfer.items.length > 0 && typeof dataTransfer.items[0].webkitGetAsEntry === 'function') {
      const files = [];
      const queue = [];
      for (let i = 0; i < dataTransfer.items.length; i++) {
        const entry = dataTransfer.items[i].webkitGetAsEntry();
        if (entry) queue.push(entry);
      }
      async function readEntry(entry) {
        if (entry.isFile) {
          return new Promise((resolve) => {
            entry.file(f => { files.push(f); resolve(); }, () => resolve());
          });
        }
        if (entry.isDirectory) {
          const dirReader = entry.createReader();
          const entries = await new Promise((resolve) => {
            dirReader.readEntries(results => resolve(results || []), () => resolve([]));
          });
          for (const child of entries) {
            await readEntry(child);
          }
        }
      }
      for (const item of queue) {
        await readEntry(item);
      }
      if (files.length > 0) return files;
    }
    if (dataTransfer.files && dataTransfer.files.length > 0) {
      return Array.from(dataTransfer.files);
    }
    return [];
  }

  /**
   * シートへドロップされたファイル/ノードを取り込んでエントリを作成する。
   */
  async function intakeDropToSheet(sheetPath, event, options = {}) {
    const normSheet = _normalizePath(sheetPath);
    if (!normSheet) return 0;
    if (typeof isItemLocked === 'function' && isItemLocked(normSheet)) {
      if (typeof showStatus === 'function') showStatus('編集ロック中のシートには取り込めません', true);
      return 0;
    }

    event.preventDefault();
    event.stopPropagation();
    const isAlt = !!event.altKey;
    const mode = isAlt ? 'link' : (options.mode || 'move');
    const types = Array.from(event.dataTransfer?.types || []);
    const isOsDrop = types.includes('Files') && !types.includes('application/x-meldex-node');

    const progress = window.MeldexImportProgress;
    let ok = 0;
    let failed = 0;
    const failures = [];

    if (isOsDrop) {
      const files = await _extractFilesFromDataTransfer(event.dataTransfer);
      if (files.length === 0) {
        if (typeof showStatus === 'function') showStatus('取り込めるファイルがありません', true);
        return 0;
      }
      progress?.beginOperation?.('ファイルを取り込み中', files.length);
      try {
        for (const file of files) {
          try {
            const formData = new FormData();
            formData.append('sheet_path', normSheet);
            formData.append('file', file);
            formData.append('mode', mode);
            if (options.metadataColumns) {
              formData.append('metadata_columns', JSON.stringify(options.metadataColumns));
            }
            const res = await apiPostForm('/sheet-entry/upload-intake', formData);
            if (res?.ok) ok += 1;
            else { failed += 1; failures.push({ name: file.name, error: res?.error || '取込失敗' }); }
          } catch (err) {
            failed += 1;
            failures.push({ name: file.name, error: err });
          }
          progress?.updateOperation?.(ok + failed);
        }
      } finally {
        progress?.finishOperation?.();
      }
    } else {
      // Meldex内D&D
      const resolved = typeof MeldexDnD !== 'undefined' ? await MeldexDnD.resolveDropData(event, 'node') : null;
      let items = [];
      if (resolved?.payload?.items) {
        items = resolved.payload.items;
      } else if (typeof _folderDragPayloadItemsFromEvent === 'function') {
        items = _folderDragPayloadItemsFromEvent(event, resolved?.payload);
      } else if (typeof draggedNodes !== 'undefined' && draggedNodes && draggedNodes.length) {
        items = draggedNodes.map(n => n._nodeData).filter(Boolean);
      } else if (typeof draggedNode !== 'undefined' && draggedNode?._nodeData) {
        items = [draggedNode._nodeData];
      }

      const validItems = items.filter(item => {
        const p = _normalizePath(item.path);
        return p && p !== normSheet && !p.startsWith(normSheet + '/');
      });

      if (validItems.length === 0) {
        if (typeof showStatus === 'function') showStatus('取り込める項目がありません', true);
        if (resolved) MeldexDnD.failDrop(resolved);
        return 0;
      }

      progress?.beginOperation?.(isAlt ? 'リンクエントリを作成中' : 'エントリとして取り込み中', validItems.length);
      try {
        for (const item of validItems) {
          try {
            const res = await apiPost('/sheet-entry/intake', {
              sheet_path: normSheet,
              source_path: item.path,
              mode: mode,
              metadata_columns: options.metadataColumns || undefined,
              entry_name: item.name || undefined,
            });
            if (res?.ok) ok += 1;
            else { failed += 1; failures.push({ name: item.name || item.path, error: res?.error || '取込失敗' }); }
          } catch (err) {
            failed += 1;
            failures.push({ name: item.name || item.path, error: err });
          }
          progress?.updateOperation?.(ok + failed);
        }
      } finally {
        progress?.finishOperation?.();
      }
      if (resolved && ok > 0) MeldexDnD.completeDrop(resolved);
      else if (resolved) MeldexDnD.failDrop(resolved);
    }

    if (ok > 0) {
      if (typeof loadOutliner === 'function') {
        loadOutliner({ force: true, reason: 'sheet-entry-intake' });
      }
      // 開いているシートがあれば再読込
      if (typeof selectDatabase === 'function' && window.activeDatabasePath === normSheet) {
        selectDatabase(normSheet, { silent: true });
      }
    }

    const first = failures[0];
    const reason = String(first?.error?.userMessage || first?.error?.message || first?.error || '');
    const actionLabel = isAlt ? 'リンク' : '取込';
    if (typeof showStatus === 'function') {
      showStatus(
        failed > 0
          ? `${ok}件をエントリとして${actionLabel}し、${failed}件は失敗しました${reason ? `（${reason}）` : ''}`
          : `${ok}件を「${normSheet.split('/').pop()}」へエントリとして${actionLabel}しました`,
        failed > 0 && ok === 0
      );
    }

    return ok;
  }

  /**
   * エントリ詳細画面に添付ファイル一覧・追加・削除・プレビューセクションを描画する (Phase 3)。
   */
  function renderEntryAttachmentsSection(container, data, entryPath, options = {}) {
    const section = document.createElement('section');
    section.className = 'meldex-entity-attachments-section';
    section.dataset.e2eId = 'entity-attachments-section';

    const header = document.createElement('div');
    header.className = 'meldex-entity-attachments-header';

    const title = document.createElement('div');
    title.className = 'meldex-entity-attachments-title';
    title.innerHTML = `${_icon('paperclip', 14)} <span>添付ファイル</span>`;

    header.appendChild(title);

    const attachments = Array.isArray(data?.entry_attachments) ? data.entry_attachments : [];

    if (!options.readOnly) {
      const addContainer = document.createElement('div');
      addContainer.className = 'meldex-entity-attachment-add-container';
      addContainer.style.position = 'relative';

      const addBtn = document.createElement('button');
      addBtn.type = 'button';
      addBtn.className = 'entity-create-action-btn meldex-entity-attachment-add-btn';
      addBtn.dataset.e2eId = 'entity-attachment-add-btn';
      addBtn.title = 'ファイルを添付または新規作成';
      addBtn.innerHTML = `${_icon('plus', 12)} <span>添付を追加</span>`;

      const fileInput = document.createElement('input');
      fileInput.type = 'file';
      fileInput.multiple = true;
      fileInput.style.display = 'none';

      fileInput.addEventListener('change', async (e) => {
        const files = Array.from(e.target.files || []);
        if (files.length === 0) return;
        for (const file of files) {
          try {
            const formData = new FormData();
            formData.append('entry_path', entryPath);
            formData.append('file', file);
            formData.append('mode', 'move');
            await apiPostForm('/sheet-entry/upload-intake', formData);
          } catch (err) {
            if (typeof showStatus === 'function') showStatus('添付の追加に失敗しました: ' + (err.message || err), true);
          }
        }
        if (typeof showStatus === 'function') showStatus(`${files.length}件のファイルを添付しました`);
        if (typeof options.onReload === 'function') options.onReload();
      });

      async function handleCreateNew(type, defaultLabel) {
        const label = prompt(`新規${defaultLabel}の名前を入力してください:`, defaultLabel);
        if (label == null) return;
        try {
          const res = await apiPost('/sheet-entry/create-file', {
            entry_path: entryPath,
            type: type,
            label: label.trim() || defaultLabel,
            expected_revision: data?.revision != null ? data.revision : undefined,
          });
          if (res?.ok) {
            if (typeof showStatus === 'function') showStatus(`「${label}」を作成して添付しました`);
            if (typeof options.onReload === 'function') options.onReload();
          }
        } catch (err) {
          if (typeof showStatus === 'function') showStatus('新規作成に失敗しました: ' + (err.message || err), true);
        }
      }

      function showAddMenu(event) {
        event.stopPropagation();
        const existing = document.querySelector('.meldex-entity-attachment-menu');
        if (existing) {
          existing.remove();
          return;
        }

        const menu = document.createElement('div');
        menu.className = 'meldex-entity-attachment-menu ab-dropdown-menu';
        menu.style.position = 'absolute';
        menu.style.top = '100%';
        menu.style.right = '0';
        menu.style.zIndex = '1000';
        menu.style.background = 'var(--bg-panel, #252526)';
        menu.style.border = '1px solid var(--border-color, #3c3c3c)';
        menu.style.borderRadius = '4px';
        menu.style.boxShadow = '0 4px 12px rgba(0,0,0,0.3)';
        menu.style.padding = '4px 0';
        menu.style.minWidth = '180px';

        const menuItems = [
          { icon: 'paperclip', label: 'ファイルを選択...', action: () => fileInput.click() },
          { divider: true },
          { icon: 'table', label: '新規シート', action: () => handleCreateNew('database', 'シート') },
          { icon: 'bookOpen', label: '新規シナリオ', action: () => handleCreateNew('scriptnote', 'シナリオ') },
          { icon: 'layout', label: '新規ボード', action: () => handleCreateNew('board', 'ボード') },
          { icon: 'folder', label: '新規フォルダ', action: () => handleCreateNew('folder', 'フォルダ') },
          { icon: 'table', label: '新規スマートシート', action: () => handleCreateNew('smart-db', 'スマートシート') },
        ];

        menuItems.forEach((item) => {
          if (item.divider) {
            const sep = document.createElement('div');
            sep.style.height = '1px';
            sep.style.background = 'var(--border-color, #3c3c3c)';
            sep.style.margin = '4px 0';
            menu.appendChild(sep);
            return;
          }
          const row = document.createElement('button');
          row.type = 'button';
          row.className = 'ab-dropdown-item';
          row.style.display = 'flex';
          row.style.alignItems = 'center';
          row.style.gap = '8px';
          row.style.width = '100%';
          row.style.padding = '6px 12px';
          row.style.border = 'none';
          row.style.background = 'transparent';
          row.style.color = 'inherit';
          row.style.cursor = 'pointer';
          row.style.textAlign = 'left';
          row.style.fontSize = '12px';
          row.innerHTML = `${_icon(item.icon, 14)} <span>${item.label}</span>`;
          row.addEventListener('click', () => {
            menu.remove();
            item.action();
          });
          menu.appendChild(row);
        });

        const closeHandler = (e) => {
          if (!menu.contains(e.target) && e.target !== addBtn) {
            menu.remove();
            document.removeEventListener('pointerdown', closeHandler);
          }
        };
        setTimeout(() => document.addEventListener('pointerdown', closeHandler), 0);

        addContainer.appendChild(menu);
      }

      addBtn.addEventListener('click', showAddMenu);
      addContainer.appendChild(addBtn);
      addContainer.appendChild(fileInput);
      header.appendChild(addContainer);
    }

    section.appendChild(header);

    const list = document.createElement('div');
    list.className = 'meldex-entity-attachments-list';

    if (attachments.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'meldex-entity-attachments-empty';
      empty.textContent = '添付ファイルはありません（ファイルをドロップして添付）';
      list.appendChild(empty);
    } else {
      attachments.forEach((item) => {
        const row = document.createElement('div');
        row.className = 'meldex-entity-attachment-item';
        row.dataset.attachmentId = item.id;

        const iconBox = document.createElement('span');
        iconBox.className = 'meldex-entity-attachment-icon';
        iconBox.innerHTML = _icon(getAttachmentIcon(item.kind, item.name), 14);

        const nameSpan = document.createElement('span');
        nameSpan.className = 'meldex-entity-attachment-name';
        nameSpan.textContent = item.name || item.path.split('/').pop();
        nameSpan.title = 'クリックして開く: ' + (item.path || '');
        nameSpan.addEventListener('click', (e) => {
          e.stopPropagation();
          openAttachment(item, entryPath);
        });

        const sizeSpan = document.createElement('span');
        sizeSpan.className = 'meldex-entity-attachment-size';
        sizeSpan.textContent = formatBytes(item.size);

        row.appendChild(iconBox);
        row.appendChild(nameSpan);
        row.appendChild(sizeSpan);

        if (!options.readOnly) {
          const delBtn = document.createElement('button');
          delBtn.type = 'button';
          delBtn.className = 'meldex-entity-attachment-del-btn';
          delBtn.title = '添付を解除';
          delBtn.innerHTML = _icon('trash2', 12);
          delBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            if (!confirm(`添付「${item.name || item.path}」を解除しますか？`)) return;
            try {
              const res = await apiPost('/sheet-entry/detach', {
                entry_path: entryPath,
                attachment_id: item.id,
                delete_file: item.mode !== 'link',
                expected_revision: data?.revision != null ? data.revision : undefined,
              });
              if (res?.ok) {
                if (res.delete_warning) {
                  const warnDetail = typeof res.delete_warning === 'string' ? res.delete_warning : JSON.stringify(res.delete_warning);
                  const msg = warnDetail.includes('一時退避ファイルの確定削除に失敗しました')
                    ? `添付情報は解除されましたが、${warnDetail}`
                    : `添付情報は解除されましたが、一時退避ファイルの確定削除に失敗しました: ${warnDetail}`;
                  if (typeof showStatus === 'function') showStatus(msg, true);
                } else {
                  if (typeof showStatus === 'function') showStatus('添付を解除しました');
                }
                if (typeof options.onReload === 'function') options.onReload();
              }
            } catch (err) {
              if (typeof showStatus === 'function') showStatus('添付の解除に失敗しました: ' + (err.message || err), true);
            }
          });
          row.appendChild(delBtn);
        }

        list.appendChild(row);
      });
    }

    // 添付セクションへのファイルドロップ
    if (!options.readOnly) {
      section.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.stopPropagation();
        section.classList.add('gb-attachment-dropzone-active');
        e.dataTransfer.dropEffect = e.altKey ? 'link' : 'copy';
      });
      section.addEventListener('dragleave', () => {
        section.classList.remove('gb-attachment-dropzone-active');
      });
      section.addEventListener('drop', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        section.classList.remove('gb-attachment-dropzone-active');
        const files = Array.from(e.dataTransfer.files || []);
        if (files.length > 0) {
          for (const file of files) {
            const formData = new FormData();
            formData.append('entry_path', entryPath);
            formData.append('file', file);
            formData.append('mode', e.altKey ? 'link' : 'move');
            await apiPostForm('/sheet-entry/upload-intake', formData);
          }
          if (typeof showStatus === 'function') showStatus(`${files.length}件のファイルを添付しました`);
          if (typeof options.onReload === 'function') options.onReload();
        }
      });
    }

    section.appendChild(list);
    container.appendChild(section);
    return section;
  }

  /**
   * コンテナ（開いているシートビューなど）にD&Dハンドラをバインドする。
   */
  function bindSheetContainer(container, getSheetPath) {
    if (!container || container._sheetDropBound) return;
    container._sheetDropBound = true;

    container.addEventListener('dragover', (e) => {
      const sheetPath = typeof getSheetPath === 'function' ? getSheetPath() : getSheetPath;
      if (!sheetPath) return;
      handleSheetDragOver(e, sheetPath, container);
    });

    container.addEventListener('dragleave', (e) => {
      handleSheetDragLeave(e, container);
    });

    container.addEventListener('drop', (e) => {
      const sheetPath = typeof getSheetPath === 'function' ? getSheetPath() : getSheetPath;
      if (!sheetPath) return;
      handleSheetDragLeave(e, container);
      intakeDropToSheet(sheetPath, e);
    });
  }

  function initAutoBinding() {
    if (typeof document === 'undefined' || typeof document.getElementById !== 'function') return;
    const el = document.getElementById('db-view-container');
    if (el) {
      bindSheetContainer(el, () => window.activeDatabasePath || window.currentDbPath || '');
    }
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', initAutoBinding);
    } else {
      initAutoBinding();
    }
  }

  /**
   * FormDataをPOSTするヘルパー。
   */
  async function apiPostForm(endpoint, formData) {
    const url = '/api' + (endpoint.startsWith('/') ? endpoint : '/' + endpoint);
    const headers = {};
    if (typeof LOCAL_API_TOKEN !== 'undefined' && LOCAL_API_TOKEN) {
      headers['Authorization'] = 'Bearer ' + LOCAL_API_TOKEN;
    }
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: formData,
    });
    if (!response.ok) {
      let message = 'HTTP ' + response.status;
      try {
        const body = await response.json();
        if (body?.detail) message = typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail);
      } catch {}
      throw new Error(message);
    }
    return response.json();
  }

  function _httpError(status, message) {
    const err = new Error(message || `HTTP ${status}`);
    err.status = status;
    err.httpStatus = status;
    return err;
  }

  function _validateAttachmentPathToDelete(targetPath, entryPath, frontmatter) {
    if (typeof targetPath !== 'string' || !targetPath.trim()) {
      return null;
    }
    const raw = targetPath.trim();
    if (raw.startsWith('/') || raw.startsWith('\\') || raw.startsWith('//') || raw.startsWith('\\\\') || /^[a-zA-Z]:/.test(raw)) {
      return null;
    }

    const normRaw = raw.replace(/\\/g, '/');
    const rawSegments = normRaw.split('/');
    for (const seg of rawSegments) {
      if (!seg || seg === '.' || seg === '..') {
        return null;
      }
    }

    const normEntry = _normalizePath(entryPath);
    const entrySegments = normEntry.split('/').filter(Boolean);
    if (entrySegments.length === 0) return null;
    const sheetSegments = entrySegments.slice(0, -1);
    const entryId = String(frontmatter?.id || (entrySegments[entrySegments.length - 1] || '').replace(/\.md$/, '')).replace(/[^a-zA-Z0-9_-]/g, '_');
    if (!entryId) return null;

    const allowedSegments = [...sheetSegments, '_attachments', entryId];
    if (rawSegments.length <= allowedSegments.length) {
      return null;
    }
    for (let i = 0; i < allowedSegments.length; i++) {
      if (rawSegments[i] !== allowedSegments[i]) {
        return null;
      }
    }

    return rawSegments.join('/');
  }

  const _entryLocks = new Map();

  async function _withEntryLock(entryPath, fn) {
    const key = _normalizePath(entryPath);
    const prev = _entryLocks.get(key) || Promise.resolve();
    let release;
    const current = new Promise(resolve => { release = resolve; });
    _entryLocks.set(key, current);

    try {
      await prev;
    } catch (_) {}

    try {
      return await fn();
    } finally {
      if (_entryLocks.get(key) === current) {
        _entryLocks.delete(key);
      }
      release();
    }
  }

  // Phase 5: Cloud static (PWA/Dropbox) 用のデータアクセス拡張ハンドラ
  async function _handleSheetEntryCloudRequest(ctx) {
    const { method, pathname, body, url } = ctx;
    if (!pathname || !pathname.startsWith('/sheet-entry/')) return undefined;

    const provider = window.MeldexStorageAdapter?.getProvider?.();
    if (!provider) throw new Error('ブラウザの保存先が未初期化です');
    const frontmatterLite = window.MeldexCloudFrontmatterLite;
    if (!frontmatterLite) throw new Error('Cloud frontmatter lite が読み込まれていません');

    const normMethod = String(method || 'GET').toUpperCase();

    if (pathname === '/sheet-entry/attachments' && normMethod === 'GET') {
      const entryPath = url.searchParams.get('entry_path') || url.searchParams.get('path');
      if (!entryPath) throw _httpError(400, 'entry_path は必須です');
      const { frontmatter } = await frontmatterLite.readFrontmatter(provider, entryPath);
      const attachments = Array.isArray(frontmatter?.entry_attachments) ? frontmatter.entry_attachments : [];
      const resolved = [];
      for (const item of attachments) {
        const stat = await provider.statPath(item.path).catch(() => null);
        resolved.push({
          ...item,
          exists: !!stat,
          size: stat?.size ?? item.size,
        });
      }
      return {
        ok: true,
        entry_path: entryPath,
        revision: Number(frontmatter?.meldex_revision || 0),
        attachments: resolved,
      };
    }

    if (pathname === '/sheet-entry/detach' && normMethod === 'POST') {
      const payload = typeof body === 'string' ? JSON.parse(body || '{}') : (body || {});
      const entryPath = payload.entry_path || payload.path;
      const attachmentId = payload.attachment_id;
      const deleteFile = !!payload.delete_file;
      const expectedRevision = payload.expected_revision;

      if (!entryPath) throw _httpError(400, 'entry_path は必須です');
      if (!attachmentId) throw _httpError(400, 'attachment_id は必須です');

      return _withEntryLock(entryPath, async () => {
        const { frontmatter, body: textBody } = await frontmatterLite.readFrontmatter(provider, entryPath);
        const currentRevision = Number(frontmatter?.meldex_revision || 0);
        if (expectedRevision != null && Number(expectedRevision) !== currentRevision) {
          throw _httpError(409, 'このエントリは他の端末で更新されています');
        }

        const attachments = Array.isArray(frontmatter?.entry_attachments) ? frontmatter.entry_attachments : [];
        const target = attachments.find(a => a.id === attachmentId);
        if (!target) {
          throw _httpError(404, '指定された添付が見つかりません');
        }
        const remaining = attachments.filter(a => a.id !== attachmentId);

        let normTargetToDelete = null;
        if (deleteFile && target && target.mode !== 'link') {
          const validated = _validateAttachmentPathToDelete(target.path, entryPath, frontmatter);
          if (!validated) {
            throw _httpError(400, 'エントリ専用の添付領域外のファイルは削除できません');
          }
          normTargetToDelete = validated;
        }

        let targetExists = false;
        if (normTargetToDelete) {
          if (typeof provider.statPath === 'function') {
            try {
              const stat = await provider.statPath(normTargetToDelete);
              targetExists = !!stat;
            } catch (statErr) {
              const is404 = (typeof frontmatterLite?.isNotFoundError === 'function' && frontmatterLite.isNotFoundError(statErr)) ||
                            /not[ -]?found|404|no such/i.test(statErr?.message || statErr?.name || '');
              if (is404) {
                targetExists = false;
              } else {
                // stat非404エラー（ネットワーク切断、認可エラー等）は事前検知して失敗させる
                throw statErr;
              }
            }
          } else {
            targetExists = true;
          }
        }

        const updated = {
          ...frontmatter,
          entry_attachments: remaining,
          meldex_revision: currentRevision + 1,
        };

        // メタデータ/CAS書き込みを先に実行（失敗時にファイルを失わない）
        await provider.writeText(entryPath, frontmatterLite.frontmatterText(updated, textBody));

        // メタデータ保存成功後に物理削除を実行
        if (normTargetToDelete && targetExists && typeof provider.deletePath === 'function') {
          try {
            await provider.deletePath(normTargetToDelete);
          } catch (delErr) {
            const is404 = (typeof frontmatterLite?.isNotFoundError === 'function' && frontmatterLite.isNotFoundError(delErr)) ||
                          /not[ -]?found|404|no such/i.test(delErr?.message || delErr?.name || '');
            if (!is404) {
              // 物理削除失敗時はメタデータを復元（ロールバック）
              let compErr = null;
              try {
                await provider.writeText(entryPath, frontmatterLite.frontmatterText(frontmatter, textBody));
              } catch (cErr) {
                compErr = cErr;
              }

              if (compErr) {
                // 物理削除失敗かつ補償復元も失敗した場合は複合報告
                const combined = _httpError(
                  500,
                  `添付ファイル物理削除に失敗し (${delErr.message || delErr})、メタデータ復元にも失敗しました (${compErr.message || compErr})`
                );
                combined.originalError = delErr;
                combined.compensationError = compErr;
                throw combined;
              }
              throw delErr;
            }
          }
        }

        return {
          ok: true,
          detached_id: attachmentId,
          revision: currentRevision + 1,
          remaining_count: remaining.length,
        };
      });
    }

    if (pathname === '/sheet-entry/create-file' && normMethod === 'POST') {
      const payload = typeof body === 'string' ? JSON.parse(body || '{}') : (body || {});
      const entryPath = payload.entry_path || payload.path;
      let itemType = String(payload.type || '').trim().toLowerCase();
      const label = String(payload.label || payload.name || '無題').trim() || '無題';
      const expectedRevision = payload.expected_revision;

      if (!entryPath) throw _httpError(400, 'entry_path は必須です');
      if (!itemType) throw _httpError(400, 'type は必須です');

      const typeAlias = {
        sheet: 'database',
        db: 'database',
        scenario: 'scriptnote',
        script: 'scriptnote',
        smartsheet: 'smart-db',
        smart_sheet: 'smart-db',
      };
      itemType = typeAlias[itemType] || itemType;

      const { frontmatter, body: textBody } = await frontmatterLite.readFrontmatter(provider, entryPath);
      const currentRevision = Number(frontmatter?.meldex_revision || 0);
      if (expectedRevision != null && Number(expectedRevision) !== currentRevision) {
        throw _httpError(409, 'このエントリは他の端末で更新されています');
      }

      const sheetDir = entryPath.split('/').slice(0, -1).join('/');
      const entryId = String(frontmatter?.id || entryPath.split('/').pop().replace(/\.md$/, '')).replace(/[^a-zA-Z0-9_-]/g, '_');
      const attachmentDir = `${sheetDir}/_attachments/${entryId}`;

      // ユニーク名解決
      async function uniqueName(base, ext) {
        let cand = ext ? `${base}${ext}` : base;
        let idx = 1;
        while (await provider.statPath(`${attachmentDir}/${cand}`).catch(() => null)) {
          cand = ext ? `${base} (${idx})${ext}` : `${base} (${idx})`;
          idx += 1;
        }
        return cand;
      }

      let createdPath = '';
      let kind = 'file';

      if (itemType === 'folder') {
        const name = await uniqueName(label, '');
        createdPath = `${attachmentDir}/${name}`;
        kind = 'folder';
        await provider.mkdir(createdPath);
      } else if (itemType === 'database') {
        const name = await uniqueName(label, '');
        createdPath = `${attachmentDir}/${name}`;
        kind = 'sheet';
        const notePath = `${createdPath}/${name}.md`;
        const content = `---\ntype: settings-db\nschema_version: 1\nstorage: markdown\n---\n# ${name}\n\n`;
        await provider.writeText(notePath, content);
      } else if (itemType === 'scriptnote') {
        const name = await uniqueName(label, '.mel-scenario');
        createdPath = `${attachmentDir}/${name}`;
        kind = 'scenario';
        const emptyDoc = {
          fileType: 'meldex-scriptnote',
          schema_version: 3,
          version: 1,
          title: name.replace(/\.mel-scenario$/, ''),
          layoutMode: 'manga',
          editor: { viewMode: 'horizontal', wrapMode: true, textWidth: 20, lineHeight: 1.5, letterSpacing: 0.02 },
          scenarioTypes: [], characters: [], characterDb: [], notes: [], rows: [],
          source: { importedFrom: '', modeName: 'マンガ縦書き' },
        };
        await provider.writeText(createdPath, JSON.stringify(emptyDoc, null, 2));
      } else if (itemType === 'board') {
        const name = await uniqueName(label, '.mel-board');
        createdPath = `${attachmentDir}/${name}`;
        kind = 'board';
        const boardContent = `---\ntype: board\nschema_version: 1\nxmind:\n  n0: {autoStyle: true}\n---\n# ${name.replace(/\.mel-board$/, '')}\n\n`;
        await provider.writeText(createdPath, boardContent);
      } else if (itemType === 'smart-db') {
        const name = await uniqueName(label, '.mel-sheet');
        createdPath = `${attachmentDir}/${name}`;
        kind = 'smart-sheet';
        const smartDoc = {
          type: 'smart-db',
          schema_version: 1,
          name: name.replace(/\.mel-sheet$/, ''),
          sourceType: 'db-entities',
          sources: [],
          filters: [{ property: 'ステータス', field: 'value', operator: 'equals', value: '進行中' }],
          views: { table: {} },
          activeView: 'table',
          created: new Date().toISOString(),
        };
        await provider.writeText(createdPath, JSON.stringify(smartDoc, null, 2));
      } else {
        throw _httpError(400, `未対応のファイルタイプです: ${itemType}`);
      }

      const attId = 'att_' + (global.crypto?.randomUUID ? global.crypto.randomUUID().replace(/-/g, '') : String(Date.now()));
      const attachmentItem = {
        id: attId,
        path: createdPath,
        name: createdPath.split('/').pop(),
        kind: kind,
        mode: 'move',
        created_at: new Date().toISOString(),
      };

      const attachments = Array.isArray(frontmatter?.entry_attachments) ? frontmatter.entry_attachments : [];
      const updated = {
        ...frontmatter,
        entry_attachments: [...attachments, attachmentItem],
        meldex_revision: currentRevision + 1,
      };

      try {
        await provider.writeText(entryPath, frontmatterLite.frontmatterText(updated, textBody));
      } catch (err) {
        try { await provider.deletePath(createdPath); } catch (_) {}
        throw err;
      }

      return {
        ok: true,
        entry_path: entryPath,
        attachment: attachmentItem,
        revision: currentRevision + 1,
      };
    }

    if (pathname === '/sheet-entry/intake' && normMethod === 'POST') {
      const payload = typeof body === 'string' ? JSON.parse(body || '{}') : (body || {});
      const sheetPath = payload.sheet_path || payload.path;
      const sourcePath = payload.source_path;
      const mode = payload.mode || 'move';
      const entryName = payload.entry_name || payload.name || sourcePath.split('/').pop().replace(/\.[^.]+$/, '');
      const metadataCols = payload.metadata_columns;

      if (!sheetPath) throw _httpError(400, 'sheet_path は必須です');
      if (!sourcePath) throw _httpError(400, 'source_path は必須です');

      const entryFile = `${sheetPath}/${entryName}.md`;
      const entryId = 'ent_' + (global.crypto?.randomUUID ? global.crypto.randomUUID().replace(/-/g, '') : String(Date.now()));
      const attachmentDir = `${sheetPath}/_attachments/${entryId}`;

      let targetPath = sourcePath;
      let finalMode = mode;

      if (mode === 'move' || mode === 'copy') {
        const filename = sourcePath.split('/').pop();
        targetPath = `${attachmentDir}/${filename}`;
        if (mode === 'move') {
          await provider.movePath(sourcePath, targetPath);
        } else {
          const fileData = await provider.downloadAsFile(sourcePath);
          await provider.uploadBytes(targetPath, new Uint8Array(await fileData.arrayBuffer()));
        }
      }

      const stat = await provider.statPath(targetPath).catch(() => null);
      const attId = 'att_' + (global.crypto?.randomUUID ? global.crypto.randomUUID().replace(/-/g, '') : String(Date.now()));
      const attachmentItem = {
        id: attId,
        path: targetPath,
        name: targetPath.split('/').pop(),
        kind: getAttachmentIcon(null, targetPath),
        mode: finalMode,
        created_at: new Date().toISOString(),
        size: stat?.size,
      };

      const entryFm = {
        type: 'settings-entry',
        id: entryId,
        meldex_revision: 1,
        entry_attachments: [attachmentItem],
        properties: {},
      };

      if (metadataCols && typeof metadataCols === 'object') {
        for (const [semantic, def] of Object.entries(metadataCols)) {
          const prop = def?.property;
          if (prop) {
            let val = semantic === 'name' ? attachmentItem.name : (semantic === 'kind' ? attachmentItem.kind : (semantic === 'size' ? attachmentItem.size : null));
            if (val != null) {
              entryFm.properties[prop] = [{ value: val, status: '採用', created: new Date().toISOString() }];
            }
          }
        }
      }

      await provider.writeText(entryFile, frontmatterLite.frontmatterText(entryFm, ''));
      return {
        ok: true,
        entry_path: entryFile,
        entry_name: entryName,
        attachment: attachmentItem,
      };
    }

    if (pathname === '/sheet-entry/attach' && normMethod === 'POST') {
      const payload = typeof body === 'string' ? JSON.parse(body || '{}') : (body || {});
      const entryPath = payload.entry_path || payload.path;
      const sourcePath = payload.source_path;
      const mode = payload.mode || 'move';
      const expectedRevision = payload.expected_revision;

      if (!entryPath) throw _httpError(400, 'entry_path は必須です');
      if (!sourcePath) throw _httpError(400, 'source_path は必須です');

      const { frontmatter, body: textBody } = await frontmatterLite.readFrontmatter(provider, entryPath);
      const currentRevision = Number(frontmatter?.meldex_revision || 0);
      if (expectedRevision != null && Number(expectedRevision) !== currentRevision) {
        throw _httpError(409, 'このエントリは他の端末で更新されています');
      }

      const sheetDir = entryPath.split('/').slice(0, -1).join('/');
      const entryId = String(frontmatter?.id || entryPath.split('/').pop().replace(/\.md$/, '')).replace(/[^a-zA-Z0-9_-]/g, '_');
      const attachmentDir = `${sheetDir}/_attachments/${entryId}`;

      let targetPath = sourcePath;
      if (mode === 'move') {
        const filename = sourcePath.split('/').pop();
        targetPath = `${attachmentDir}/${filename}`;
        await provider.movePath(sourcePath, targetPath);
      } else if (mode === 'copy') {
        const filename = sourcePath.split('/').pop();
        targetPath = `${attachmentDir}/${filename}`;
        const fileData = await provider.downloadAsFile(sourcePath);
        await provider.uploadBytes(targetPath, new Uint8Array(await fileData.arrayBuffer()));
      }

      const stat = await provider.statPath(targetPath).catch(() => null);
      const attId = 'att_' + (global.crypto?.randomUUID ? global.crypto.randomUUID().replace(/-/g, '') : String(Date.now()));
      const attachmentItem = {
        id: attId,
        path: targetPath,
        name: targetPath.split('/').pop(),
        kind: getAttachmentIcon(null, targetPath),
        mode: mode,
        created_at: new Date().toISOString(),
        size: stat?.size,
      };

      const attachments = Array.isArray(frontmatter?.entry_attachments) ? frontmatter.entry_attachments : [];
      const updated = {
        ...frontmatter,
        entry_attachments: [...attachments, attachmentItem],
        meldex_revision: currentRevision + 1,
      };

      await provider.writeText(entryPath, frontmatterLite.frontmatterText(updated, textBody));
      return {
        ok: true,
        entry_path: entryPath,
        attachment: attachmentItem,
        revision: currentRevision + 1,
      };
    }

    return undefined;
  }

  if (typeof window !== 'undefined') {
    window.__MeldexPwaDataAccessExtensions = window.__MeldexPwaDataAccessExtensions || [];
    window.__MeldexPwaDataAccessExtensions.push(_handleSheetEntryCloudRequest);
  }

  global.MeldexSheetEntryAttachments = {
    canAcceptSheetDrop,
    handleSheetDragOver,
    handleSheetDragLeave,
    intakeDropToSheet,
    renderEntryAttachmentsSection,
    bindSheetContainer,
    openAttachment,
    getAttachmentIcon,
    apiPostForm,
    _handleSheetEntryCloudRequest,
  };
})(window);
