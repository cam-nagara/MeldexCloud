        operation: 'permanent-delete', payload: { name, trash_root: trashRoot.path },
        prepare: async () => {
          const entry = await _resolveEntryHandle(provider, trashPath);
          const meta = await _readJsonSafe(provider, metaPath, null);
          const originalPath = _normalizeFolderPath(meta?.original_path || '');
          if (!entry || !originalPath) throw new Error('削除元情報を確認できないため完全削除できません');
          const confirmationItems = [{
            path: originalPath, kind: entry.kind === 'directory' ? 'folder' : 'file',
            physicalPath: trashPath,
          }];
          const consumed = await _consumeCloudDeleteConfirmation(provider, body, confirmationItems, 'permanent');
          const collected = await _collectCloudIdentityCandidates(
            provider, trashPath, entry.kind, originalPath,
            { includeCompletedImageClaims: true },
          );
          return { trash_path: trashPath, meta_path: metaPath, original_path: originalPath,
            source_kind: entry.kind, confirmation_items: confirmationItems,
            receipt: consumed.receipt, identity_claims: {
              boundary: collected.boundary, target_path: collected.target_path, items: collected.items,
            } };
        },
        steps: intent => [{ name: 'physical-delete', run: async () => {
          const current = await _resolveEntryHandle(provider, intent.trash_path);
          if (!current) return { ok: true, already_missing: true };
          await window.MeldexCloudDeleteConfirmation.revalidateProviderDelete({
            provider, receipt: intent.receipt, items: intent.confirmation_items,
          });
          await _removeEntry(provider, intent.trash_path);
          return { ok: true };
        } }, { name: 'identity-claims', run: () => (
          _tombstoneCollectedCloudIdentities(intent.identity_claims, provider)
        ) }],
        result: () => ({ ok: true, trash_root: trashRoot.path }),
      });
      const warnings = [];
      await _runPostMutationStep(warnings, 'trash-metadata', async () => {
        if (await _pathExists(provider, metaPath)) await _removeEntry(provider, metaPath);
      });
      return { ...result, ..._resultWarnings(warnings) };
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
      const durable = window.MeldexCloudIdentityClaimAftercare?.durableDelete;
      if (!durable) throw Object.assign(new Error('完全削除journalを利用できません'), { status: 503 });
      try { return await durable(provider, {
        operationId: body?.confirmationToken || body?.confirmation_token,
        operation: 'empty-trash', payload: { trash_roots: roots.map(root => root.path) },
        prepare: async () => {
          const confirmationItems = [];
          const entries = [];
          for (const trashRoot of roots) {
            const trash = await _resolveEntryHandle(provider, trashRoot.path);
            if (!trash || trash.kind !== 'directory') continue;
            for (const entry of await _listDirectoryEntries(provider, trashRoot.path)) {
              if (entry.name.endsWith('._trash_meta.json')) continue;
              const itemPath = _joinPath(trashRoot.path, entry.name);
              const metaPath = itemPath + '._trash_meta.json';
              const meta = await _readJsonSafe(provider, metaPath, null);
              const originalPath = _normalizeFolderPath(meta?.original_path || '');
              if (!originalPath) throw new Error('削除元情報を確認できない項目があるためゴミ箱を空にできません');
              confirmationItems.push({ path: originalPath,
                kind: entry.handle.kind === 'directory' ? 'folder' : 'file', physicalPath: itemPath });
              const collected = await _collectCloudIdentityCandidates(
                provider, itemPath, entry.handle.kind, originalPath,
                { includeCompletedImageClaims: true },
              );
              entries.push({ trash_path: itemPath, meta_path: metaPath,
                identity_claims: { boundary: collected.boundary,
                  target_path: collected.target_path, items: collected.items } });
            }
          }
          const consumed = confirmationItems.length
            ? await _consumeCloudDeleteConfirmation(provider, body, confirmationItems, 'permanent') : null;
          return { confirmation_items: confirmationItems, receipt: consumed?.receipt || null, entries };
        },
        steps: intent => intent.entries.flatMap((entry, index) => [{
          name: `${index}:physical-delete`, run: async () => {
            if (!(await _pathExists(provider, entry.trash_path))) return { ok: true, already_missing: true };
            if (!intent.receipt) throw new Error('削除直前の確認情報がありません');
            await window.MeldexCloudDeleteConfirmation.revalidateProviderDelete({
              provider, receipt: intent.receipt,
              items: intent.confirmation_items.filter(item => item.physicalPath === entry.trash_path),
            });
            await _removeEntry(provider, entry.trash_path);
            return { ok: true };
          },
        }, { name: `${index}:identity-claims`, run: () => (
          _tombstoneCollectedCloudIdentities(entry.identity_claims, provider)
        ) }, { name: `${index}:trash-metadata`, run: async () => {
          if (await _pathExists(provider, entry.meta_path)) await _removeEntry(provider, entry.meta_path);
          return { ok: true };
        } }]),
        result: intent => ({ ok: true, removed: intent.entries.length,
          trash_roots: roots.map(root => root.path) }),
      }); } catch (cause) {
        const error = new Error('ゴミ箱を完全に空にできませんでした（1件）');
        error.code = 'trash_empty_partial_failure';
        error.failures = [{ trash_root: '', name: '', error: cause?.message || String(cause) }];
        throw error;
      }
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
  window.MeldexCloudIdentityCopyTransaction = Object.freeze({
    copyPath: _copyPathWithIdentityTransaction,
  });
})();
