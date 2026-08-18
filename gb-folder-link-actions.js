/**
 * Meldex Folder Paste Link Choice & Conversion Actions
 *
 * 設計方針: app/docs/folder-paste-link-choice-and-conversion-plan-2026-08-14.md
 * 責務:
 * - 貼り付け方法の選択ダイアログ（コピー／リンクファイルを作成／キャンセル）
 * - 「今後表示しない」設定と設定画面でのトグル復帰
 * - 貼り付け時の単一ヒストリー（Undo/Redo）接続
 */
(function (global) {
  'use strict';

  const STORAGE_KEY_SUPPRESS_FOLDER_PASTE_LINK_CHOICE = 'meldex_suppress_folder_paste_link_choice';

  function isFolderPasteLinkChoiceSuppressed() {
    try {
      return localStorage.getItem(STORAGE_KEY_SUPPRESS_FOLDER_PASTE_LINK_CHOICE) === 'true';
    } catch (_) {
      return false;
    }
  }

  function setFolderPasteLinkChoiceSuppressed(suppressed) {
    try {
      if (suppressed) {
        localStorage.setItem(STORAGE_KEY_SUPPRESS_FOLDER_PASTE_LINK_CHOICE, 'true');
      } else {
        localStorage.removeItem(STORAGE_KEY_SUPPRESS_FOLDER_PASTE_LINK_CHOICE);
      }
    } catch (_) {}
  }

  function _normalizePath(path) {
    return String(path || '').replace(/\\/g, '/').replace(/\/+$/, '');
  }

  function shouldPromptFolderPasteChoice(items, destFolder, clipMode) {
    if (clipMode === 'cut') return false;
    if (isFolderPasteLinkChoiceSuppressed()) return false;
    if (!items || !items.length || !destFolder) return false;
    const normDest = _normalizePath(destFolder);
    // 同一フォルダ内への貼り付け（複製）はダイアログを出さず通常コピー
    const allSameFolder = items.every(item => {
      const parent = _normalizePath(item.parent || (item.path ? item.path.split(/[\\/]/).slice(0, -1).join('/') : ''));
      return parent === normDest;
    });
    if (allSameFolder) return false;
    return true;
  }

  async function showFolderPasteChoiceModal(options = {}) {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (choice, suppress = false) => {
        if (settled) return;
        settled = true;
        resolve({ choice, suppress });
      };

      const title = '貼り付け方法を選択';
      const body = document.createElement('div');
      body.className = 'folder-paste-choice-body';

      const p1 = document.createElement('p');
      p1.textContent = 'リンクなら容量を増やさず、同じファイルを複数のフォルダに置けます。';
      p1.style.margin = '0';

      const p2 = document.createElement('p');
      p2.textContent = 'どこから開いても同じ元ファイルを編集します。別々に編集する場合はコピーしてください。';
      p2.style.margin = '0';

      const p3 = document.createElement('p');
      p3.textContent = 'Alt＋ドラッグでもリンクファイルを作れます。';
      p3.style.cssText = 'margin:0;font-size:12px;color:var(--fg2);';

      const checkLabel = document.createElement('label');
      checkLabel.className = 'gb-check folder-paste-choice-check';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.id = 'folder-paste-link-suppress-check';
      const checkSpan = document.createElement('span');
      checkSpan.textContent = '今後表示しない（以後はコピー）';
      checkLabel.append(checkbox, checkSpan);

      body.append(p1, p2, p3, checkLabel);

      const footer = document.createElement('div');
      footer.className = 'folder-paste-choice-actions';

      const cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.className = 'gb-btn gb-btn-secondary';
      cancelBtn.dataset.choice = 'cancel';
      cancelBtn.dataset.e2eId = 'folder-paste-choice-cancel';
      cancelBtn.textContent = 'キャンセル';

      const linkBtn = document.createElement('button');
      linkBtn.type = 'button';
      linkBtn.className = 'gb-btn gb-btn-secondary';
      linkBtn.dataset.choice = 'link';
      linkBtn.dataset.e2eId = 'folder-paste-choice-link';
      linkBtn.textContent = 'リンクファイルを作成';

      const copyBtn = document.createElement('button');
      copyBtn.type = 'button';
      copyBtn.className = 'gb-btn gb-btn-primary';
      copyBtn.dataset.choice = 'copy';
      copyBtn.dataset.e2eId = 'folder-paste-choice-copy';
      copyBtn.textContent = 'コピー';

      footer.append(cancelBtn, linkBtn, copyBtn);

      let modalController = null;

      const handleChoice = (choice) => {
        const suppress = checkbox.checked;
        if (choice !== 'cancel' && suppress) {
          setFolderPasteLinkChoiceSuppressed(true);
        }
        if (modalController?.close) {
          modalController.close(choice);
        }
        finish(choice, suppress);
      };

      cancelBtn.addEventListener('click', () => handleChoice('cancel'));
      linkBtn.addEventListener('click', () => handleChoice('link'));
      copyBtn.addEventListener('click', () => handleChoice('copy'));

      if (global.GBUI?.createModal) {
        modalController = global.GBUI.createModal({
          title,
          body,
          footer,
          variant: 'standard',
          geometryKey: 'folder-paste-link-choice',
          closeOnEsc: true,
          closeOnOverlay: true,
          initialFocus: copyBtn,
          onClose: () => {
            if (!settled) {
              finish('cancel', false);
            }
          },
        });
        if (modalController?.open) modalController.open();
      } else {
        const confirmed = confirm(`${title}\n\nリンクなら容量を増やさず、同じファイルを複数のフォルダに置けます。\nリンクファイルを作成しますか？\n[OK] リンクファイルを作成 / [キャンセル] コピー`);
        finish(confirmed ? 'link' : 'copy', false);
      }
    });
  }

  async function executeFolderPasteWithChoice(clip, destFolder, options = {}) {
    if (!clip?.items?.length || !destFolder) return;
    if (typeof _folderToolbarIsLockedPath === 'function' && _folderToolbarIsLockedPath(destFolder)) {
      if (typeof showStatus === 'function') showStatus('編集ロック中のフォルダには貼り付けできません', true);
      return;
    }

    const mode = clip.mode || 'copy';
    const items = clip.items;

    // ダイアログ表示判定
    if (shouldPromptFolderPasteChoice(items, destFolder, mode)) {
      const { choice } = await showFolderPasteChoiceModal({ items, destFolder });
      if (choice === 'cancel') return;
      if (choice === 'link') {
        if (typeof addFolderLinksBatchWithHistory === 'function') {
          const result = await addFolderLinksBatchWithHistory(items, destFolder, options);
          const refresh = typeof options.refresh === 'function' ? options.refresh : (typeof _folderToolbarRefresh === 'function' ? _folderToolbarRefresh : null);
          if (refresh) await refresh();
          const created = result?.created_count || 0;
          const unchanged = result?.unchanged_count || 0;
          const failed = result?.failed_count || 0;
          let msg = '';
          if (created) msg += `${created} 件のリンクを作成しました`;
          if (unchanged) msg += (msg ? '、' : '') + `${unchanged} 件は既にリンク済みです`;
          if (failed) msg += (msg ? '、' : '') + `${failed} 件は失敗しました`;
          if (typeof showStatus === 'function') showStatus(msg || 'リンクを作成しました', failed > 0);
          return;
        }
      }
      // choice === 'copy' の場合は通常コピー処理へ進む
    }

    // cut または copy の実行
    const pastedPaths = [];
    const failed = [];
    let skipped = 0;
    const executedMoves = [];
    const executedCopies = [];

    for (const item of items) {
      try {
        if (item.type === 'folder' && typeof _folderToolbarPathWithin === 'function' && _folderToolbarPathWithin(destFolder, item.path)) {
          failed.push(item);
          continue;
        }
        if (mode === 'cut') {
          const itemParent = item.parent || (typeof _folderToolbarParentPath === 'function' ? _folderToolbarParentPath(item.path) : '');
          const normDest = typeof _folderToolbarNormalizePath === 'function' ? _folderToolbarNormalizePath(destFolder) : destFolder;
          if (itemParent === normDest) {
            skipped++;
            continue;
          }
          if (typeof _folderToolbarPathWithin === 'function' && _folderToolbarPathWithin(destFolder, item.path)) {
            failed.push(item);
            continue;
          }
          const oldPath = item.path;
          const res = await apiPost('/outliner/move', { path: item.path, dest_folder: destFolder });
          if (res?.new_path && typeof renameAppPathReferences === 'function') {
            renameAppPathReferences(oldPath, res.new_path, { label: res.new_name || item.name, fileId: res.file_id, type: item.type || 'page' });
          }
          if (typeof handleRelocateResponse === 'function') handleRelocateResponse(res);
          const newPath = res?.new_path || item.path;
          pastedPaths.push(newPath);
          executedMoves.push({ oldPath, newPath, item, oldParent: itemParent, fileId: res?.file_id || item.file_id });
        } else {
          const res = await apiPost('/outliner/save-as', { path: item.path, dest_folder: destFolder });
          const newPath = res?.new_path || '';
          if (newPath) {
            pastedPaths.push(newPath);
            executedCopies.push({ origPath: item.path, newPath, item });
          }
        }
      } catch (_) {
        failed.push(item);
      }
    }

    if (mode === 'cut') {
      if (typeof _folderToolbarClipboard !== 'undefined') {
        _folderToolbarClipboard = failed.length ? { mode: 'cut', items: failed } : null;
      }
      if (executedMoves.length && typeof historyPush === 'function') {
        const moveUndo = async () => {
          for (const m of executedMoves) {
            try {
              const r = await apiPost('/outliner/move', { path: m.newPath, dest_folder: m.oldParent });
              if (r?.new_path && typeof renameAppPathReferences === 'function') {
                renameAppPathReferences(m.newPath, r.new_path, { label: m.item.name, fileId: m.fileId, type: m.item.type });
              }
            } catch (_) {}
          }
          if (typeof options.refresh === 'function') await options.refresh();
          else if (typeof _folderToolbarRefresh === 'function') await _folderToolbarRefresh();
        };
        const moveRedo = async () => {
          for (const m of executedMoves) {
            try {
              const r = await apiPost('/outliner/move', { path: m.oldPath, dest_folder: destFolder });
              if (r?.new_path && typeof renameAppPathReferences === 'function') {
                renameAppPathReferences(m.oldPath, r.new_path, { label: m.item.name, fileId: m.fileId, type: m.item.type });
              }
            } catch (_) {}
          }
          if (typeof options.refresh === 'function') await options.refresh();
          else if (typeof _folderToolbarRefresh === 'function') await _folderToolbarRefresh();
        };
        historyPush('フォルダ: 切り取り貼り付け', moveUndo, moveRedo, '', `${executedMoves.length} 件 → ${destFolder}`);
      }
    } else {
      if (executedCopies.length && typeof historyPush === 'function') {
        const copyUndo = async () => {
          for (const c of executedCopies) {
            try {
              await apiPost('/outliner/delete', { path: c.newPath });
            } catch (_) {}
          }
          if (typeof options.refresh === 'function') await options.refresh();
          else if (typeof _folderToolbarRefresh === 'function') await _folderToolbarRefresh();
        };
        const copyRedo = async () => {
          for (const c of executedCopies) {
            try {
              await apiPost('/outliner/save-as', { path: c.origPath, dest_folder: destFolder });
            } catch (_) {}
          }
          if (typeof options.refresh === 'function') await options.refresh();
          else if (typeof _folderToolbarRefresh === 'function') await _folderToolbarRefresh();
        };
        historyPush('フォルダ: コピー貼り付け', copyUndo, copyRedo, '', `${executedCopies.length} 件 → ${destFolder}`);
      }
    }

    const refresh = typeof options.refresh === 'function' ? options.refresh : (typeof _folderToolbarRefresh === 'function' ? _folderToolbarRefresh : null);
    if (refresh) await refresh(pastedPaths.filter(Boolean));

    if (failed.length) {
      if (typeof showStatus === 'function') showStatus((pastedPaths.length || 0) + ' 件を貼り付け、' + failed.length + ' 件は失敗しました', true);
    } else if (pastedPaths.length) {
      if (typeof showStatus === 'function') showStatus(pastedPaths.length + ' 件を貼り付けました');
    } else if (skipped) {
      if (typeof showStatus === 'function') showStatus('同じフォルダへの移動のため、変更はありません');
    }
    if (typeof updateFolderToolbarActions === 'function') updateFolderToolbarActions();
  }

  async function materializeFolderLinkWithHistory(filePath, folderPath, options = {}) {
    if (!filePath || !folderPath) return null;
    const confirmed = typeof global.cfConfirm === 'function'
      ? await global.cfConfirm(`「${folderPath}」のリンクを実体化しますか？\n独立したコピーを作成し、以後は別々に編集できるようになります。`)
      : confirm('リンクを実体化しますか？');
    if (!confirmed) return null;

    const fileId = options.fileId || '';
    const ownerToken = options.ownerToken || `mat-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const payload = {
      file_path: filePath,
      folder_path: folderPath,
      file_id: fileId,
      owner_token: ownerToken,
    };

    let res = null;
    try {
      res = await apiPost('/folder-links/materialize', payload);
    } catch (err) {
      if (typeof showStatus === 'function') showStatus('実体化に失敗しました: ' + (err?.message || err || ''), true);
      return null;
    }

    const matPath = res?.materialized_path || '';
    const oldFileId = res?.old_file_id || fileId;

    if (matPath && typeof historyPush === 'function') {
      const undoFn = async () => {
        try {
          await apiPost('/outliner/delete', { path: matPath });
          await apiPost('/folder-links/batch/add', {
            items: [{ file_path: filePath, file_id: oldFileId }],
            folder_path: folderPath,
            owner_token: ownerToken,
          });
        } catch (_) {}
        if (typeof options.refresh === 'function') await options.refresh();
        else if (typeof _folderToolbarRefresh === 'function') await _folderToolbarRefresh();
      };
      const redoFn = async () => {
        try {
          await apiPost('/folder-links/materialize', payload);
        } catch (_) {}
        if (typeof options.refresh === 'function') await options.refresh();
        else if (typeof _folderToolbarRefresh === 'function') await _folderToolbarRefresh();
      };
      historyPush('フォルダリンク: 実体化', undoFn, redoFn, '', `${filePath} → ${matPath}`);
    }

    const refresh = typeof options.refresh === 'function' ? options.refresh : (typeof _folderToolbarRefresh === 'function' ? _folderToolbarRefresh : null);
    if (refresh) await refresh([matPath].filter(Boolean));
    if (typeof showStatus === 'function') showStatus('実体化しました（以後は別々に編集できます）');
    return res;
  }

  async function promoteFolderLinkToSourceWithHistory(filePath, folderPath, options = {}) {
    if (!filePath || !folderPath) return null;
    const confirmed = typeof global.cfConfirm === 'function'
      ? await global.cfConfirm(`物理ファイルを「${folderPath}」へ移し、元の場所にはリンクを残します。\nよろしいですか？（内容は1つのままです）`)
      : confirm('この場所をリンク元にしますか？');
    if (!confirmed) return null;

    const fileId = options.fileId || '';
    const ownerToken = options.ownerToken || `prm-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const payload = {
      file_path: filePath,
      folder_path: folderPath,
      file_id: fileId,
      owner_token: ownerToken,
    };

    let res = null;
    try {
      res = await apiPost('/folder-links/promote-to-source', payload);
    } catch (err) {
      if (typeof showStatus === 'function') showStatus('リンク元化に失敗しました: ' + (err?.message || err || ''), true);
      return null;
    }

    const newSourcePath = res?.new_source_path || '';
    const oldSourcePath = res?.old_source_path || filePath;
    const newLinkFolder = res?.new_link_folder || '';

    if (newSourcePath && typeof historyPush === 'function') {
      const undoFn = async () => {
        try {
          await apiPost('/folder-links/promote-to-source', {
            file_path: newSourcePath,
            folder_path: newLinkFolder,
            file_id: res?.file_id || fileId,
            owner_token: ownerToken,
          });
        } catch (_) {}
        if (typeof options.refresh === 'function') await options.refresh();
        else if (typeof _folderToolbarRefresh === 'function') await _folderToolbarRefresh();
      };
      const redoFn = async () => {
        try {
          await apiPost('/folder-links/promote-to-source', payload);
        } catch (_) {}
        if (typeof options.refresh === 'function') await options.refresh();
        else if (typeof _folderToolbarRefresh === 'function') await _folderToolbarRefresh();
      };
      historyPush('フォルダリンク: リンク元ファイル化', undoFn, redoFn, '', `${oldSourcePath} ⇄ ${newSourcePath}`);
    }

    const refresh = typeof options.refresh === 'function' ? options.refresh : (typeof _folderToolbarRefresh === 'function' ? _folderToolbarRefresh : null);
    if (refresh) await refresh([newSourcePath].filter(Boolean));
    if (typeof showStatus === 'function') showStatus('この場所をリンク元ファイルに設定しました');
    return res;
  }

  global.MeldexFolderLinkActions = {
    isFolderPasteLinkChoiceSuppressed,
    setFolderPasteLinkChoiceSuppressed,
    shouldPromptFolderPasteChoice,
    showFolderPasteChoiceModal,
    executeFolderPasteWithChoice,
    materializeFolderLinkWithHistory,
    promoteFolderLinkToSourceWithHistory,
    STORAGE_KEY_SUPPRESS_FOLDER_PASTE_LINK_CHOICE,
  };
  global.showFolderPasteChoiceModal = showFolderPasteChoiceModal;
  global.shouldPromptFolderPasteChoice = shouldPromptFolderPasteChoice;
  global.executeFolderPasteWithChoice = executeFolderPasteWithChoice;
  global.materializeFolderLinkWithHistory = materializeFolderLinkWithHistory;
  global.promoteFolderLinkToSourceWithHistory = promoteFolderLinkToSourceWithHistory;
})(typeof window !== 'undefined' ? window : globalThis);
