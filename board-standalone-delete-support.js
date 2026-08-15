/* Bounded identity and trash operations for the board File System Access provider. */
(function () {
  'use strict';

  const MAX_ENTRIES = 20000;
  const MAX_PATH_BYTES = 4 * 1024 * 1024;

  function _failure(message, status = 503) {
    return Object.assign(new Error(message), { status });
  }

  async function _folderRevision(directory) {
    const rows = [];
    let pathBytes = 0;
    async function walk(parent, prefix) {
      for await (const [name, entry] of parent.entries()) {
        const child = prefix ? `${prefix}/${name}` : name;
        pathBytes += new TextEncoder().encode(child).byteLength;
        if (rows.length >= MAX_ENTRIES || pathBytes > MAX_PATH_BYTES) {
          throw _failure('削除対象フォルダの確認上限を超えました');
        }
        if (entry.kind === 'directory') {
          rows.push([child, 'folder', 0, 0]);
          await walk(entry, child);
        } else {
          const file = await entry.getFile();
          rows.push([child, 'file', file.size, file.lastModified]);
        }
      }
    }
    await walk(directory, '');
    rows.sort((a, b) => a[0].localeCompare(b[0]));
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(rows)));
    const revision = [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
    return { revision, descendantCount: rows.length };
  }

  async function confirmationMetadata({ rootHandle, path, splitPath }) {
    const split = splitPath(path);
    let parent = rootHandle;
    for (const part of split.parts) parent = await parent.getDirectoryHandle(part, { create: false });
    try {
      const file = await (await parent.getFileHandle(split.filename, { create: false })).getFile();
      return { kind: 'file', id: `file:${path}`, revision: `${file.size}:${file.lastModified}`, size: file.size };
    } catch (_) {
      let directory;
      try { directory = await parent.getDirectoryHandle(split.filename, { create: false }); }
      catch (_) { return null; }
      return { kind: 'directory', id: `folder:${path}`, ...(await _folderRevision(directory)) };
    }
  }

  async function _copy(entry, destination, name) {
    if (entry.kind === 'file') {
      const target = await destination.getFileHandle(name, { create: true });
      const writable = await target.createWritable();
      await writable.write(await entry.getFile());
      await writable.close();
      return;
    }
    const childDestination = await destination.getDirectoryHandle(name, { create: true });
    for await (const [childName, child] of entry.entries()) await _copy(child, childDestination, childName);
  }

  function _operationId() {
    if (!crypto?.randomUUID) throw _failure('安全なゴミ箱識別子を生成できません');
    return crypto.randomUUID();
  }

  async function _writeJsonFile(directory, name, value) {
    const handle = await directory.getFileHandle(name, { create: true });
    const writable = await handle.createWritable();
    await writable.write(JSON.stringify(value));
    await writable.close();
  }

  async function _cleanupOwnedCopy(trash, names, operationId) {
    try {
      const marker = await trash.getFileHandle(names.marker, { create: false });
      const payload = JSON.parse(await (await marker.getFile()).text());
      if (payload?.operation_id !== operationId) return;
    } catch (_) { return; }
    await _removeAndConfirmMissing(trash, names.destination, { recursive: true });
    await _removeAndConfirmMissing(trash, names.metadata);
    await _removeAndConfirmMissing(trash, names.marker);
  }

  function _isMissingLookup(error) {
    return error?.name === 'NotFoundError' || error?.name === 'TypeMismatchError';
  }

  async function _confirmMissing(directory, name) {
    for (const getter of ['getFileHandle', 'getDirectoryHandle']) {
      try {
        await directory[getter](name, { create: false });
        throw _failure(`補償対象が残っています: ${name}`);
      } catch (error) {
        if (!_isMissingLookup(error)) throw error;
      }
    }
  }

  async function _removeAndConfirmMissing(directory, name, options = {}) {
    try { await directory.removeEntry(name, options); }
    catch (error) { if (error?.name !== 'NotFoundError') throw error; }
    await _confirmMissing(directory, name);
  }

  async function _cleanupAndRethrow(error, trash, names, operationId) {
    try { await _cleanupOwnedCopy(trash, names, operationId); }
    catch (cleanupError) {
      try { Object.defineProperty(error, 'cleanupError', { value: cleanupError, enumerable: true }); }
      catch (_) { throw new AggregateError([error, cleanupError], error?.message || '削除補償に失敗しました'); }
    }
    throw error;
  }

  async function moveToTrash({ rootHandle, path, splitPath, now = () => new Date(), revalidateBeforeRemove }) {
    const { parts, filename } = splitPath(path);
    if (!filename || filename === '_trash' || parts[0] === '_trash') throw _failure('この項目はゴミ箱へ移動できません', 409);
    let parent = rootHandle;
    for (const part of parts) parent = await parent.getDirectoryHandle(part, { create: false });
    const source = await parent.getDirectoryHandle(filename, { create: false })
      .catch(async () => parent.getFileHandle(filename, { create: false }));
    const trash = await rootHandle.getDirectoryHandle('_trash', { create: true });
    const operationId = _operationId();
    const trashName = `${filename}.${operationId}`;
    const names = {
      destination: trashName,
      metadata: `${trashName}._trash_meta.json`,
      marker: `${trashName}._meldex_operation.json`,
    };
    try {
      await _writeJsonFile(trash, names.marker, { operation_id: operationId });
      await _copy(source, trash, trashName);
      await _writeJsonFile(trash, names.metadata, {
        original_path: path, deleted_at: now().toISOString(), operation_id: operationId,
      });
    } catch (error) {
      await _cleanupAndRethrow(error, trash, names, operationId);
    }
    try {
      if (typeof revalidateBeforeRemove !== 'function') throw _failure('削除直前の再確認を利用できません');
      await revalidateBeforeRemove();
      await parent.removeEntry(filename, { recursive: source.kind === 'directory' });
    } catch (error) {
      await _cleanupAndRethrow(error, trash, names, operationId);
    }
    await trash.removeEntry(names.marker).catch(() => {});
    return trashName;
  }

  window.MeldexBoardStandaloneDeleteSupport = Object.freeze({ confirmationMetadata, moveToTrash });
})();
