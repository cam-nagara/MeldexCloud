        if (await _pathExists(provider, metaPath)) await _removeEntry(provider, metaPath);
      });
      return { ok: true, restored_path: originalPath, trash_root: trashRoot.path, ..._resultWarnings(warnings) };
    }

    if (pathname === '/outliner/duplicate' && method === 'POST') {
      const provider = await _requirePwaProvider('readwrite');
      const sourcePath = _normalizeFolderPath(body?.path || '');
      const source = await _resolveEntryHandle(provider, sourcePath);
      if (!source) throw new Error(`見つかりません: ${sourcePath}`);
      const sourceName = _basename(sourcePath);
      const sourceSplit = _splitNameAndExt(sourceName);
      let destName = source.kind === 'file' ? `${sourceSplit.stem}_copy${sourceSplit.ext}` : `${sourceName}_copy`;
      let destPath = _joinPath(_dirname(sourcePath), destName);
      for (let counter = 2; await _pathExists(provider, destPath); counter += 1) {
        destName = source.kind === 'file' ? `${sourceSplit.stem}_copy${counter}${sourceSplit.ext}` : `${sourceName}_copy${counter}`;
        destPath = _joinPath(_dirname(sourcePath), destName);
      }
      const destDirHandle = await _directoryHandle(provider, _dirname(destPath), true);
      await _copyEntryHandle(source.handle, destDirHandle, _basename(destPath));
      return { ok: true, new_path: destPath, new_name: destName };
    }

    if (pathname === '/outliner/save-as' && method === 'POST') {
      const provider = await _requirePwaProvider('readwrite');
      const sourcePath = _normalizeFolderPath(body?.path || '');
      const source = await _resolveEntryHandle(provider, sourcePath);
      if (!source) throw new Error(`見つかりません: ${sourcePath}`);
      const sourceName = _basename(sourcePath);
      const sourceSplit = _splitNameAndExt(sourceName);
      let newName = String(body?.new_name || (source.kind === 'file' ? sourceSplit.stem : sourceName)).replace(/[\\/]/g, '').replace(/\.\./g, '').trim();
      newName = _validateItemName(newName, 'new_name');
      const destFolder = _normalizeFolderPath(body?.dest_folder || _dirname(sourcePath));
      let destName = source.kind === 'file' ? newName + sourceSplit.ext : newName;
      let destPath = _joinPath(destFolder, destName);
      for (let counter = 2; await _pathExists(provider, destPath); counter += 1) {
        destName = source.kind === 'file' ? `${newName}_${counter}${sourceSplit.ext}` : `${newName}_${counter}`;
        destPath = _joinPath(destFolder, destName);
      }
      const destDirHandle = await _directoryHandle(provider, destFolder, true);
      await _copyEntryHandle(source.handle, destDirHandle, _basename(destPath));
      return { ok: true, new_path: destPath, new_name: source.kind === 'file' ? _splitNameAndExt(destName).stem : destName };
    }

    if (pathname === '/outliner/move' && method === 'POST') {
      const provider = await _requirePwaProvider('readwrite');
      const sourcePath = _normalizeFolderPath(body?.path || '');
      const destFolder = _normalizeFolderPath(body?.dest_folder || '');
      const source = await _resolveEntryHandle(provider, sourcePath);
      const destEntry = await _resolveEntryHandle(provider, destFolder);
      if (!source) throw new Error('見つかりません');
      if (!destEntry || destEntry.kind !== 'directory') throw new Error(`移動先フォルダが見つかりません: ${destFolder}`);
      if (source.kind === 'directory' && (destFolder === sourcePath || destFolder.startsWith(sourcePath + '/'))) throw new Error('フォルダ自身の中には移動できません');
      if (destFolder === _dirname(sourcePath)) {
        return {
          ok: true,
          unchanged: true,
          new_path: sourcePath,
          new_name: source.kind === 'file' ? _splitNameAndExt(_basename(sourcePath)).stem : _basename(sourcePath),
          file_id: _fnvFileId(sourcePath),
          relocate: { rewritten_count: 0, failed_count: 0, rewritten_paths: [], truncated: false },
        };
      }
      const conflict = await _moveConflictName(provider, destFolder, _basename(sourcePath), source.kind === 'file');
      await _moveEntry(provider, sourcePath, conflict.path);
      const warnings = [];
      await _runPostMutationStep(warnings, 'version-history', () => _relocateVersionHistory(provider, sourcePath, conflict.path, source.kind === 'directory'));
      await _runPostMutationStep(warnings, 'stored-paths', () => (
        typeof _rewriteStoredPathsForProvider === 'function'
          ? _rewriteStoredPathsForProvider(provider, sourcePath, conflict.path, source.kind === 'directory')
          : Promise.resolve(_rewriteStoredPaths(sourcePath, conflict.path, source.kind === 'directory'))
      ));
      await _runPathMutationHooksSafe({ action: 'move', oldPath: sourcePath, newPath: conflict.path, isFolder: source.kind === 'directory' }, warnings);
      await _runPostMutationStep(warnings, 'annotations', () => _updateAnnotationsForPathMutation(provider, { action: 'move', oldPath: sourcePath, newPath: conflict.path, isFolder: source.kind === 'directory' }));
      let relocate = { rewritten_count: 0, failed_count: 0, rewritten_paths: [], truncated: false };
      await _runPostMutationStep(warnings, 'references', async () => {
        relocate = await _relocateReferences(provider, sourcePath, conflict.path, source.kind === 'directory');
      });
      return {
        ok: true,
        new_path: conflict.path,
        new_name: source.kind === 'file' ? _splitNameAndExt(_basename(conflict.path)).stem : _basename(conflict.path),
        file_id: _fnvFileId(conflict.path),
        relocate,
        ..._resultWarnings(warnings),
      };
    }

    if (pathname === '/trash' && method === 'GET') {
      const provider = await _requirePwaProvider('read');
      const items = [];
      const warnings = [];
      let allowedRoots;
      try {
        allowedRoots = await _allowedTrashRoots();
      } catch (error) {
        allowedRoots = [{ path: _normalizeFolderPath(PWA_TRASH_DIR), name: 'Meldex', physicalPath: '' }];
        warnings.push({
          trash_root: '', trash_root_name: '', stage: 'trash-roots',
          message: error?.message || String(error), code: error?.code || '',
        });
      }
      const rootsByPath = new Map(allowedRoots.map((root) => [root.path, root]));
      const sourceRootsByPhysical = new Map(allowedRoots.filter((root) => (
        window.MeldexSourceFolderRegistry?.parseSourcePath?.(root.path)
      )).map((root) => [String(root.physicalPath || root.path).toLowerCase(), root]));
      const listedPhysicalRoots = new Set();
      for (const trashRoot of allowedRoots) {
        const physicalKey = String(trashRoot.physicalPath || trashRoot.path).toLowerCase();
        if (listedPhysicalRoots.has(physicalKey)) continue;
        try {
          const trashEntry = await _resolveEntryHandle(provider, trashRoot.path);
          if (!trashEntry || trashEntry.kind !== 'directory') {
            listedPhysicalRoots.add(physicalKey);
            continue;
          }
          const entries = await _listDirectoryEntries(provider, trashRoot.path);
          listedPhysicalRoots.add(physicalKey);
          for (const entry of entries) {
            if (entry.name.endsWith('._trash_meta.json')) continue;
            const entryPath = _joinPath(trashRoot.path, entry.name);
            const meta = await _readJsonSafe(provider, entryPath + '._trash_meta.json', {});
            let size = 1;
            if (entry.handle.kind === 'directory') {
              size = await _countFolderEntriesIncludingTrash(provider, entryPath).catch(() => 0);
            }
            const metaHasVirtualSource = window.MeldexSourceFolderRegistry?.parseSourcePath?.(
              meta?.trash_root || meta?.original_path || '',
            );
            const declaredTrashRoot = rootsByPath.get(_normalizeFolderPath(meta?.trash_root || ''));
            const declaredPhysicalKey = String(declaredTrashRoot?.physicalPath || declaredTrashRoot?.path || '').toLowerCase();
            const itemTrashRoot = (declaredTrashRoot && declaredPhysicalKey === physicalKey ? declaredTrashRoot : null)
              || (metaHasVirtualSource ? sourceRootsByPhysical.get(physicalKey) : null)
              || trashRoot;
            items.push({
              name: entry.name,
              type: entry.handle.kind === 'directory' ? 'folder' : 'file',
              size,
              original_path: String(meta?.original_path || ''),
              deleted_at: String(meta?.deleted_at || ''),
              trash_root: itemTrashRoot.path,
              trash_root_name: itemTrashRoot.name,
            });
          }
        } catch (error) {
          warnings.push({
            trash_root: trashRoot.path, trash_root_name: trashRoot.name, stage: 'trash-list',
            message: error?.message || String(error), code: error?.code || '',
          });
        }
      }
      return warnings.length
        ? { items, warnings, partial: true, failed: warnings.length }
        : { items };
    }

    if (pathname === '/trash/restore' && method === 'POST') {
      const provider = await _requirePwaProvider('readwrite');
      const name = _validateItemName(body?.name || '', 'name');
      const trashRoot = await _resolveAllowedTrashRoot(body?.trash_root);
      const trashPath = _joinPath(trashRoot.path, name);
      const metaPath = trashPath + '._trash_meta.json';
      const source = await _resolveEntryHandle(provider, trashPath);
      if (!source) throw new Error('ゴミ箱に見つかりません');
      const meta = await _readJsonSafe(provider, metaPath, {});
      const baseDest = await _resolveValidatedTrashRestorePath(trashRoot, meta?.original_path || '', name);
      let destPath = baseDest;
      if (await _pathExists(provider, destPath)) {
        const split = _splitNameAndExt(_basename(baseDest));
        const baseDir = _dirname(baseDest);
        for (let counter = 1; await _pathExists(provider, destPath); counter += 1) {
          const stem = source.kind === 'directory' ? _basename(baseDest).replace(/_\d{4}$/, '') : split.stem;
          const nextName = source.kind === 'directory'
            ? `${stem}_restored_${String(counter).padStart(4, '0')}`
            : `${stem}_restored_${String(counter).padStart(4, '0')}${split.ext}`;
          destPath = _joinPath(baseDir, nextName);
        }
      }
      await _moveEntry(provider, trashPath, destPath);
      const warnings = [];
      await _runPostMutationStep(warnings, 'trash-metadata', async () => {
        if (await _pathExists(provider, metaPath)) await _removeEntry(provider, metaPath);
      });
      return { ok: true, restored_to: destPath, trash_root: trashRoot.path, ..._resultWarnings(warnings) };
    }

    if (pathname === '/trash/delete' && method === 'POST') {
      const provider = await _requirePwaProvider('readwrite');
      const name = _validateItemName(body?.name || '', 'name');
      const trashRoot = await _resolveAllowedTrashRoot(body?.trash_root);
      const trashPath = _joinPath(trashRoot.path, name);
      const metaPath = trashPath + '._trash_meta.json';
      if (await _resolveEntryHandle(provider, trashPath)) await _removeEntry(provider, trashPath);
      const warnings = [];
      await _runPostMutationStep(warnings, 'trash-metadata', async () => {
        if (await _pathExists(provider, metaPath)) await _removeEntry(provider, metaPath);
      });
      return { ok: true, trash_root: trashRoot.path, ..._resultWarnings(warnings) };
    }

    if (pathname === '/trash/empty' && method === 'POST') {
      const provider = await _requirePwaProvider('readwrite');
      const requestedRoots = body?.trash_root
        ? [await _resolveAllowedTrashRoot(body.trash_root)]
        : await _allowedTrashRoots();
      const seenPhysicalRoots = new Set();
      const roots = requestedRoots.filter((root) => {
        const key = String(root.physicalPath || root.path).toLowerCase();
        if (seenPhysicalRoots.has(key)) return false;
        seenPhysicalRoots.add(key);
        return true;
      });
      const failures = [];
      let removed = 0;
      for (const trashRoot of roots) {
        try {
          const trash = await _resolveEntryHandle(provider, trashRoot.path);
          if (!trash || trash.kind !== 'directory') continue;
          const entries = await _listDirectoryEntries(provider, trashRoot.path);
          const entryNames = new Set(entries.map((entry) => entry.name));
          const handled = new Set();
          for (const entry of entries) {
            if (handled.has(entry.name)) continue;
            const isMeta = entry.name.endsWith('._trash_meta.json');
            const itemName = isMeta ? entry.name.slice(0, -'._trash_meta.json'.length) : entry.name;
            if (isMeta && entryNames.has(itemName)) continue;
            try {
              await _removeEntry(provider, _joinPath(trashRoot.path, entry.name));
              removed += 1;
            } catch (error) {
              failures.push({ trash_root: trashRoot.path, name: entry.name, error: error?.message || String(error) });
              if (!isMeta) handled.add(entry.name + '._trash_meta.json');
              continue;
            }
            if (isMeta) continue;
            const metaName = entry.name + '._trash_meta.json';
            handled.add(metaName);
            if (!entryNames.has(metaName)) continue;
            try {
              await _removeEntry(provider, _joinPath(trashRoot.path, metaName));
              removed += 1;
            } catch (error) {
              failures.push({ trash_root: trashRoot.path, name: metaName, error: error?.message || String(error) });
            }
          }
        } catch (error) {
          failures.push({ trash_root: trashRoot.path, name: '', error: error?.message || String(error) });
        }
      }
      if (failures.length) {
        const error = new Error(`ゴミ箱を完全に空にできませんでした（${failures.length}件）`);
        error.code = 'trash_empty_partial_failure';
        error.failures = failures;
        error.removed = removed;
        throw error;
      }
      return { ok: true, removed, trash_roots: roots.map((root) => root.path) };
    }

    if (pathname === '/server-info' && method === 'GET') return { local_ip: 'ブラウザ版ではローカルIPは利用しません' };
    if (pathname === '/autostart' && method === 'GET') return { supported: false, enabled: false };
    if (pathname === '/autostart' && method === 'POST') return { ok: false, supported: false };
    if (pathname === '/chat/config' && method === 'GET') return _llmConfigShape();
    if (pathname === '/chat/config' && (method === 'PUT' || method === 'POST')) return { ok: false, unsupported: true };
    if (pathname === '/extensions/status' && method === 'GET') return { pillow: false, clip: false, caldav: false };
    if (pathname === '/extensions/install' && method === 'POST') return { ok: false, error: 'ブラウザ版では拡張インストールに対応していません' };
    if (pathname === '/caldav/info' && method === 'GET') return { url: '', instructions: { iphone: '', thunderbird: '', google: '' } };
    if (pathname === '/caldav/sync-to-ics' && method === 'POST') return { ok: false, synced: 0 };
    if (pathname === '/caldav/sync-from-ics' && method === 'POST') return { ok: false, imported: 0, updated: 0 };
    if (pathname === '/auth/users' && method === 'GET') return [];
    if (pathname === '/auth/me' && method === 'GET') {
      const username = url.searchParams.get('username') || 'anonymous';
      const state = window.MeldexRuntimeAdapter?.getWorkspaceState?.() || {};
      return { user: username, username, role: state.access === 'viewer' ? 'viewer' : 'editor' };
    }
    if (pathname === '/pick-folder' && method === 'GET') return { ok: false, needManualInput: true };

    return NOT_HANDLED;
  });
})();
