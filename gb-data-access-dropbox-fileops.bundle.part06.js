        const key = line.slice(0, split).trim();
        if (Object.prototype.hasOwnProperty.call(values, key)) return '';
        values[key] = line.slice(split + 1).trim().replace(/^(?:"([\s\S]*)"|'([\s\S]*)')$/, '$1$2');
      }
      return values.type === 'settings-entry' ? String(values.id || '').trim() : '';
    }

    async function _collectCloudIdentityCandidates(
      provider, path, sourceKind, sourceLocatorRoot = path, options = {},
    ) {
      const stack = [{ path, kind: sourceKind }];
      let visited = 0;
      const items = [];
      const imageCopies = [];
      while (stack.length) {
        const item = stack.pop();
        visited += 1;
        if (visited > 1000) throw new Error('identity claim対象が1000項目を超えました');
        if (item.kind === 'directory') {
          const children = await _freshDirectEntries(provider, item.path, 1000);
          children.forEach(child => stack.push({ path: _joinPath(item.path, child.name), kind: child.kind }));
          continue;
        }
        const suffix = item.path === path ? '' : item.path.slice(path.length).replace(/^\/+/, '');
        const sourceLocator = suffix ? _joinPath(sourceLocatorRoot, suffix) : sourceLocatorRoot;
        const isImageCopy = /\.(?:apng|jpe?g|png|webp)$/i.test(sourceLocator);
        const imageAftercare = window.MeldexCreatedImageIdentityAftercare;
        if (isImageCopy) {
          if (!imageAftercare?.imagePath?.(sourceLocator)) {
            throw Object.assign(new Error('Cloud画像identity aftercareを利用できません'), { status: 503 });
          }
          if (options.includeCompletedImageClaims) {
            if (!imageAftercare.lookupCompleted) {
              throw Object.assign(new Error('Cloud画像completed identityを参照できません'), { status: 503 });
            }
            const completed = await imageAftercare.lookupCompleted(
              provider, item.path, sourceLocator,
            );
            if (completed) {
              items.push(completed);
              continue;
            }
          }
          imageCopies.push({ path: item.path, source_locator: sourceLocator });
          continue;
        }
        if (!/\.(?:md|mel-board|mel-scenario|mel-timer|mel-sheet)$/i.test(sourceLocator)) {
          continue;
        }
        if (typeof provider.readBytesFresh !== 'function') throw new Error('Dropbox bytes fresh read契約を利用できません');
        const read = await provider.readBytesFresh(item.path);
        const text = new TextDecoder('utf-8', { fatal: true }).decode(read.bytes);
        const entryId = /\.md$/i.test(sourceLocator) ? _settingsEntryIdForClaim(text) : '';
        let kind = entryId ? 'entry' : '';
        let uid = entryId;
        if (!uid) {
          const identity = window.MeldexDocumentIdentity;
          const format = identity?.formatForPath?.(sourceLocator, text);
          uid = format ? String(identity.readDocumentId(text, format) || '') : '';
          kind = uid ? 'document' : '';
        }
        if (!uid) continue;
        const meta = await _providerObjectIdentity(provider, item.path, null);
        if (!meta?.id || !meta?.rev || String(read.revision || '') !== String(meta.rev)) {
          throw Object.assign(new Error('Dropbox bytes readback後にprovider identityが変更されました'), { status: 409 });
        }
        items.push({ kind, uid, provider_revision: meta.rev, canonical: {
          provider: 'dropbox', provider_id: meta.id, source_locator: sourceLocator,
        } });
      }
      if (!items.length) return { adapter: null, boundary: '', target_path: path, items, image_copies: imageCopies };
      const claims = window.MeldexIdentityClaims;
      const contract = window.MeldexSystemStorage;
      if (!claims || !contract) throw new Error('identity claim契約を利用できません');
      const adapter = await _managementAdapterForProvider(provider, contract.SystemStorageKind.IDENTITY_CLAIMS, path);
      const boundary = adapter.describe().boundary;
      if (items.some(item => item.boundary && item.boundary !== boundary)) {
        throw Object.assign(new Error('Cloud画像claimの保存境界が一致しません'), { status: 409 });
      }
      return { adapter, boundary, target_path: path, items,
        image_copies: imageCopies };
    }

    async function _claimPublishedCloudImageCopy(provider, item) {
      const aftercare = window.MeldexCreatedImageIdentityAftercare;
      if (!aftercare?.prepare || !aftercare?.record) {
        throw Object.assign(new Error('Cloud画像identity aftercareを利用できません'), { status: 503 });
      }
      if (typeof provider.readBytesFresh !== 'function') {
        throw new Error('Dropbox bytes fresh read契約を利用できません');
      }
      const read = await provider.readBytesFresh(item.path);
      const meta = await _providerObjectIdentity(provider, item.path, null);
      if (!meta?.id || !meta?.rev || String(read.revision || '') !== String(meta.rev)) {
        throw Object.assign(new Error('Dropbox画像readback後にprovider identityが変更されました'), { status: 409 });
      }
      const encodedBytes = new Uint8Array(read.bytes);
      const prepared = await aftercare.prepare(provider, item.path, encodedBytes, {
        filename: _basename(item.source_locator), source: 'cloud-copy',
        stableIntent: `cloud-copy-derivative:${meta.id}`,
      });
      const result = await aftercare.record(provider, item.path, encodedBytes, { prepared });
      if (result?.aftercare_pending) {
        throw Object.assign(new Error('Cloud画像identity claimが再試行待ちです'), {
          status: 503, meldexCode: 'cloud_image_copy_claim_pending',
        });
      }
      return result;
    }

    async function _claimPublishedCloudIdentities(provider, path, sourceKind) {
      const collected = await _collectCloudIdentityCandidates(provider, path, sourceKind);
      for (const item of collected.items) {
        await window.MeldexIdentityClaims.claimIdentity(
          collected.adapter, collected.boundary, item.kind, item.uid, item.canonical,
        );
      }
      for (const item of collected.image_copies) {
        await _claimPublishedCloudImageCopy(provider, item);
      }
      return { ok: true, claimed: collected.items.length + collected.image_copies.length };
    }

    async function _tombstoneCollectedCloudIdentities(collected, provider = null) {
      let adapter = collected.adapter;
      if (!adapter && collected.items.length) {
        adapter = await _managementAdapterForProvider(
          provider,
          window.MeldexSystemStorage.SystemStorageKind.IDENTITY_CLAIMS,
          collected.target_path,
        );
        if (adapter.describe().boundary !== collected.boundary) {
          throw Object.assign(new Error('削除claimの保存境界が変更されています'), { status: 409 });
        }
      }
      for (const item of collected.items) {
        await window.MeldexIdentityClaims.tombstoneIdentity(
          adapter, collected.boundary, item.kind, item.uid, item.canonical,
        );
        if (item.provider_locator) {
          if (!window.MeldexIdentityClaims.tombstoneProviderLocator) {
            throw new Error('Cloud画像provider locator tombstone契約を利用できません');
          }
          await window.MeldexIdentityClaims.tombstoneProviderLocator(
            adapter, collected.boundary, item.kind, item.uid, item.canonical,
            item.provider_locator,
          );
        }
      }
      return { ok: true, tombstoned: collected.items.length };
    }

    window.MeldexCloudIdentityClaimAftercare = Object.freeze({
      collect: _collectCloudIdentityCandidates,
      claimPublished: _claimPublishedCloudIdentities,
      tombstoneCollected: _tombstoneCollectedCloudIdentities,
      durableDelete: async (provider, options) => {
        const operationId = String(options?.operationId || '').trim();
        if (!operationId) throw Object.assign(new Error('confirmationToken は必須です'), { status: 409 });
        const operation = String(options.operation || 'permanent-delete');
        const payload = options.payload || {};
        const journal = window.MeldexCloudCopyOperationJournal;
        return journal.withFlight(provider, operationId, operation, payload, async identity => {
          let record = await journal.load(provider, operationId, operation, payload, identity);
          if (record?.state === 'completed') return record.result;
          if (!record) {
            const intent = await options.prepare();
            record = await journal.prepare(provider, operationId, operation, payload,
              { ...intent, aftercare_completed: [] }, identity);
          }
          record = await journal.runAftercare(
            provider, operationId, operation, payload, record, options.steps(record.intent),
          );
          return journal.complete(
            provider, operationId, operation, payload,
            { ...options.result(record.intent), operation_id: operationId },
          );
        });
      },
    });

/* === gb-data-access-dropbox-fileops-trash-routes.js === */
/* gb-data-access-dropbox-fileops-trash-routes.js
 * Dropbox static runtime: trash listing, restore, permanent delete, empty,
 * and the terminal capability fallbacks. Continues the shared fileops IIFE.
 */
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
              trash_path: entryPath,
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
      await _runPathMutationHooksSafe({
        action: 'restore', oldPath: trashPath, newPath: destPath,
        isFolder: source.kind === 'directory',
      }, warnings);
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
      const durable = window.MeldexCloudIdentityClaimAftercare?.durableDelete;
      if (!durable) throw Object.assign(new Error('完全削除journalを利用できません'), { status: 503 });
      const result = await durable(provider, {
        operationId: body?.confirmationToken || body?.confirmation_token,
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
