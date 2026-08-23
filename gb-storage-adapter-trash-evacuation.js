/* gb-storage-adapter-trash-evacuation.js
 * DropboxStorageProvider.evacuatePathToTrash(): 実Dropbox完全復元の削除全廃
 * (ゴミ箱退避方式、app/docs/scheduler-dropbox-restore-trash-evacuation_plan_2026-08-20.md)
 * が使う削除代替プリミティブ。part01.js を1500行未満に保つため別ファイルへ分離し、
 * split loader (gb-storage-adapter.js) の一部として part01/part02 の後に読み込む。
 */
(function () {
  'use strict';

  function _normalize(path) {
    return String(path || '')
      .replace(/\\/g, '/')
      .replace(/^\/+/, '')
      .replace(/\/+/g, '/')
      .replace(/^\.\//, '')
      .replace(/\/$/, '');
  }

  function _join() {
    return Array.from(arguments).map(_normalize).filter(Boolean).join('/');
  }

  function _basename(path) {
    const normalized = _normalize(path);
    if (!normalized) return '';
    const index = normalized.lastIndexOf('/');
    return index >= 0 ? normalized.slice(index + 1) : normalized;
  }

  const DropboxStorageProvider = window.MeldexStorageAdapter?.DropboxStorageProvider;
  if (!DropboxStorageProvider) throw new Error('gb-storage-adapter.js (part01/part02) is not loaded');

  // fresh-readで現状を確認し、ゴミ箱ルート配下のユニーク名へ ._trash_meta.json と
  // 共に no-replace移動する。物理削除は一切行わない(既存ゴミ箱UI・/trash/restore が
  // そのまま個別復元に使える)。ディレクトリは中身ごと1回のmoveで退避する。
  DropboxStorageProvider.prototype.evacuatePathToTrash = async function evacuatePathToTrash(fullPath, expectedRevision, marker) {
    const normalized = _normalize(fullPath);
    const before = await this.getMetadata(normalized);
    if (!before) return { evacuated: false, missing: true };
    const isDirectory = before['.tag'] === 'folder';
    const beforeRevision = String(before.rev || '');
    const beforeContentHash = isDirectory ? '' : String(before.content_hash || '');
    const matchedExpected = expectedRevision == null || beforeRevision === String(expectedRevision);

    const registry = window.MeldexSourceFolderRegistry;
    const parsedSource = registry?.parseSourcePath?.(normalized);
    const trashRoot = parsedSource && typeof registry?.sourcePath === 'function'
      ? registry.sourcePath(parsedSource.sourceId, '_trash')
      : '_trash';
    await this.ensureDirectory(trashRoot);
    const baseName = _basename(normalized);
    const dot = baseName.lastIndexOf('.');
    const stem = dot > 0 ? baseName.slice(0, dot) : baseName;
    const ext = dot > 0 ? baseName.slice(dot) : '';
    let destPath = _join(trashRoot, baseName);
    for (let counter = 1; await this.getMetadata(destPath); counter += 1) {
      const suffix = `_${String(counter).padStart(4, '0')}`;
      destPath = _join(trashRoot, isDirectory ? `${baseName}${suffix}` : `${stem}${suffix}${ext}`);
      if (counter > 9999) throw new Error('ゴミ箱内の退避先名を決定できません');
    }
    const metaPath = `${destPath}._trash_meta.json`;
    const metaBytes = new TextEncoder().encode(JSON.stringify({
      original_path: normalized,
      trash_root: trashRoot,
      deleted_at: new Date().toISOString(),
      evacuation_marker: marker?.name || '',
      evacuation_reason: 'scheduler-folder-restore',
    }, null, 2));
    await this._uploadBytesWithMode(metaPath, metaBytes, 'add');
    try {
      await this.movePathNoReplace(normalized, destPath);
    } catch (error) {
      await this.deletePath(metaPath).catch(() => {});
      throw error;
    }
    let afterContentHash = beforeContentHash;
    let contentStable = true;
    if (!isDirectory) {
      const after = await this.getMetadata(destPath);
      afterContentHash = String(after?.content_hash || '');
      contentStable = afterContentHash === beforeContentHash;
    }
    return {
      evacuated: true,
      kind: isDirectory ? 'directory' : 'file',
      trashPath: destPath,
      trashRoot,
      beforeRevision,
      beforeContentHash,
      afterContentHash,
      matchedExpected,
      contentStable,
    };
  };
})();
