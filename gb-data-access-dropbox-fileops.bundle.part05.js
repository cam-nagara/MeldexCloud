        const labelName = await _uniqueName(provider, parent, label, '.json');
        const targetPath = _joinPath(parent, labelName + '.json');
        await provider.writeJson(targetPath, {
          type: 'smart-db',
          name: labelName,
          filters: [{ property: 'ステータス', field: 'value', operator: 'equals', value: '進行中' }],
          views: { table: {} },
          activeView: 'table',
          created: new Date().toISOString(),
        });
        return { ok: true, node: { type: _phase1SurfaceType('smart-db', 'file'), label: labelName, path: targetPath } };
      }
      throw new Error(`不正なタイプ: ${type}`);
    }

    if (pathname === '/outliner/rename' && method === 'POST') {
      const provider = await _requirePwaProvider('readwrite');
      const oldPath = _normalizeFolderPath(body?.old_path || '');
      _rejectProductionStructureMutation(oldPath, '名前変更');
      if (window.MeldexProductionSchemaMigration?.isManagedEntryPath?.(oldPath)) {
        throw new Error('制作管理の管理リスト名はシート上のエントリ名から変更してください');
      }
      const newName = _validateItemName(body?.new_name || '', 'new_name');
      const source = await _resolveEntryHandle(provider, oldPath);
      if (!source) throw new Error(`見つかりません: ${oldPath}`);
      const parentPath = _dirname(oldPath);
      const sourceName = _basename(oldPath);
      if (source.kind === 'directory') {
        const newPath = _joinPath(parentPath, newName);
        if (newPath !== oldPath && await _pathExists(provider, newPath)) throw new Error(`既に存在: ${newName}`);
        const annotationPlan = newPath !== oldPath
          ? await _prepareAnnotationsForPathMutation(provider, {
            action: 'rename', oldPath, newPath, isFolder: true,
          }) : [];
        const warnings = [];
        if (newPath !== oldPath) {
          await _moveEntry(provider, oldPath, newPath);
          await _runPostMutationStep(warnings, 'version-history', () => _relocateVersionHistory(provider, oldPath, newPath, true));
          await _runPostMutationStep(warnings, 'csv-sidecars', () => (
            _relocateCsvSidecars(provider, oldPath, newPath, true, false)
          ));
        }
        const oldNotePath = _joinPath(newPath, sourceName + '.md');
        const newNotePath = _joinPath(newPath, newName + '.md');
        if (await _pathExists(provider, oldNotePath) && !await _pathExists(provider, newNotePath)) {
          await _moveEntry(provider, oldNotePath, newNotePath);
          await _runPostMutationStep(warnings, 'folder-note-version-history', () => _relocateVersionHistory(provider, _joinPath(oldPath, sourceName + '.md'), newNotePath, false));
        }
        await _runPostMutationStep(warnings, 'stored-paths', () => (
          typeof _rewriteStoredPathsForProvider === 'function'
            ? _rewriteStoredPathsForProvider(provider, oldPath, newPath, true)
            : Promise.resolve(_rewriteStoredPaths(oldPath, newPath, true))
        ));
        await _runPathMutationHooksSafe({ action: 'rename', oldPath, newPath, isFolder: true }, warnings);
        await _updateAnnotationsForPathMutation(provider, {
          action: 'rename', oldPath, newPath, isFolder: true, annotationPlan,
        });
        let relocate = { rewritten_count: 0, failed_count: 0, rewritten_paths: [], truncated: false };
        await _runPostMutationStep(warnings, 'references', async () => {
          relocate = await _relocateReferences(provider, oldPath, newPath, true);
        });
        return { ok: true, new_path: newPath, file_id: _fnvFileId(newPath), relocate, ..._resultWarnings(warnings) };
      }
      const split = _splitNameAndExt(sourceName);
      const nextPath = _joinPath(parentPath, newName + split.ext);
      if (nextPath !== oldPath && await _pathExists(provider, nextPath)) throw new Error(`既に存在: ${newName + split.ext}`);
      const annotationPlan = nextPath !== oldPath
        ? await _prepareAnnotationsForPathMutation(provider, {
          action: 'rename', oldPath, newPath: nextPath, isFolder: false,
        }) : [];
      if (split.ext === '.md' && String(body?.type || '') === 'page') {
        const original = await provider.readText(oldPath);
        await provider.writeText(oldPath, original.replace(/^# .+/m, '# ' + newName));
      }
      if (nextPath !== oldPath) {
        await _moveEntry(provider, oldPath, nextPath);
      }
      const warnings = [];
      await _runPostMutationStep(warnings, 'version-history', () => _relocateVersionHistory(provider, oldPath, nextPath, false));
      await _runPostMutationStep(warnings, 'csv-sidecar', () => (
        _relocateCsvSidecars(provider, oldPath, nextPath, false, false)
      ));
      await _runPostMutationStep(warnings, 'stored-paths', () => (
        typeof _rewriteStoredPathsForProvider === 'function'
          ? _rewriteStoredPathsForProvider(provider, oldPath, nextPath, false)
          : Promise.resolve(_rewriteStoredPaths(oldPath, nextPath, false))
      ));
      await _runPathMutationHooksSafe({ action: 'rename', oldPath, newPath: nextPath, isFolder: false }, warnings);
      await _updateAnnotationsForPathMutation(provider, {
        action: 'rename', oldPath, newPath: nextPath, isFolder: false, annotationPlan,
      });
      let relocate = { rewritten_count: 0, failed_count: 0, rewritten_paths: [], truncated: false };
      await _runPostMutationStep(warnings, 'references', async () => {
        relocate = await _relocateReferences(provider, oldPath, nextPath, false);
      });
      return { ok: true, new_path: nextPath, file_id: _fnvFileId(nextPath), relocate, ..._resultWarnings(warnings) };
    }

    if (pathname === '/outliner/delete' && method === 'POST') {
      const provider = await _requirePwaProvider('readwrite');
      _rejectProductionStructureMutation(body?.path || '', '削除');
      const confirmationItem = {
        path: body?.path || '', kind: body?.kind === 'folder' ? 'folder' : 'file',
      };
      const consumed = await _consumeCloudDeleteConfirmation(provider, body, [confirmationItem], 'trash');
      return _deleteOutlinerPathToTrash(provider, body?.path || '', {
        item: confirmationItem, receipt: consumed.receipt,
        queryImpact: (_provider, targetItems) => _queryDeleteImpact(_provider, targetItems),
      });
    }

    if (pathname === '/outliner/delete-batch' && method === 'POST') {
      const provider = await _requirePwaProvider('readwrite');
      const items = Array.isArray(body?.items) ? body.items : [];
      for (const item of items) _rejectProductionStructureMutation(item?.path || '', '削除');
      const confirmationItems = items.map(item => ({
        path: item?.path || '', kind: item?.kind === 'folder' ? 'folder' : 'file',
      }));
      const consumed = await _consumeCloudDeleteConfirmation(provider, body, confirmationItems, 'trash');
      const results = [];
      for (const item of confirmationItems) {
        try {
          results.push({ ok: true, value: await _deleteOutlinerPathToTrash(provider, item.path, {
            item, receipt: consumed.receipt,
            queryImpact: (_provider, targetItems) => _queryDeleteImpact(_provider, targetItems),
          }) });
        } catch (error) {
          results.push({ ok: false, error: error?.message || String(error) });
        }
      }
      return { ok: true, results };
    }

    if (pathname === '/outliner/restore' && method === 'POST') {
      const provider = await _requirePwaProvider('readwrite');
      const trashName = _validateItemName(body?.trash_name || '', 'trash_name');
      const trashRoot = await _resolveAllowedTrashRoot(body?.trash_root);
      const trashPath = _joinPath(trashRoot.path, trashName);
      const metaPath = trashPath + '._trash_meta.json';
      const source = await _resolveEntryHandle(provider, trashPath);
      if (!source) throw new Error(`ゴミ箱にありません: ${trashName}`);
      const meta = await _readJsonSafe(provider, metaPath, {});
      const originalPath = await _resolveValidatedTrashRestorePath(trashRoot, meta?.original_path || '');
      if (await _pathExists(provider, originalPath)) throw new Error(`復元先に既にファイルが存在: ${originalPath}`);
      await _moveEntry(provider, trashPath, originalPath);
      const warnings = [];
      const sidecarTrashPath = _normalizeFolderPath(meta?.csv_sidecar_trash_path || '');
      if (sidecarTrashPath && await _pathExists(provider, sidecarTrashPath)) {
        await _runPostMutationStep(warnings, 'csv-sidecar', async () => {
          const sidecarPath = _csvMetadataPath(originalPath);
          await _directoryHandle(provider, _dirname(sidecarPath), true);
          await _moveEntry(provider, sidecarTrashPath, sidecarPath);
          await _rewriteCsvSidecarSource(provider, sidecarPath, originalPath);
        });
      }
      await _runPathMutationHooksSafe({
        action: 'restore', oldPath: trashPath, newPath: originalPath,
        isFolder: source.kind === 'directory',
      }, warnings);
      await _runPostMutationStep(warnings, 'trash-metadata', async () => {
        if (await _pathExists(provider, metaPath)) await _removeEntry(provider, metaPath);
      });
      return { ok: true, restored_path: originalPath, trash_root: trashRoot.path, ..._resultWarnings(warnings) };
    }

/* === gb-data-access-dropbox-fileops-copy-routes.js === */
/* Dropbox Cloud duplicate/save-as route orchestration continuation. */
    async function runCloudIdentityCopyOperation(provider, operation, operationId, payload, source, chooseDestination) {
      if (!operationId) throw Object.assign(new Error('operation_id は必須です'), { status: 400 });
      const journal = window.MeldexCloudCopyOperationJournal;
      if (!journal) throw Object.assign(new Error('Cloudファイル操作履歴を利用できません'), { status: 503 });
      return journal.withFlight(provider, operationId, operation, payload, async identity => {
        let record = await journal.load(provider, operationId, operation, payload, identity);
        if (record?.state === 'completed') return record.result;
        let destPath = String(record?.intent?.destination || '');
        let destName = _basename(destPath);
        if (!record) {
          ({ destPath, destName } = await chooseDestination());
          record = await journal.prepare(provider, operationId, operation, payload, {
            source: payload.path, destination: destPath, kind: source.kind,
            provider_id: '', provider_rev: '', manifest_digest: '', aftercare_completed: [],
          }, identity);
        }
        if (!destPath) throw new Error('prepared Cloudファイル操作の保存先が不正です');
        const proof = record.intent.publish_proof || null;
        const stagingPrefix = `.${_basename(destPath)}.meldex-copy-`;
        const stagingCandidates = proof ? (await _freshDirectEntries(provider, _dirname(destPath)))
          .map(entry => _joinPath(_dirname(destPath), entry.name))
          .filter(path => _basename(path).startsWith(stagingPrefix) && _basename(path).endsWith('.tmp')
            && path === proof.staging_path) : [];
        if (stagingCandidates.length > 1) {
          throw Object.assign(new Error('prepared Cloud複製の一時候補が複数あるため自動再開できません'), { status: 409 });
        }
        const destinationExists = await _freshPathExists(provider, destPath);
        if (destinationExists && stagingCandidates.length) {
          throw Object.assign(new Error('prepared Cloud複製のfinalとstagingが同時に存在します'), { status: 409 });
        }
        if (!destinationExists && stagingCandidates.length === 1) {
          const stagingPath = stagingCandidates[0];
          const stagingProof = source.kind === 'directory'
            ? await _cloudFolderIdentityProof(provider, stagingPath)
            : await _providerObjectIdentity(provider, stagingPath, null).then(value => ({
                provider_id: value.id, provider_rev: value.rev, manifest_digest: '',
              }));
          if (stagingPath !== proof.staging_path || stagingProof.provider_id !== proof.provider_id
              || stagingProof.provider_rev !== proof.provider_rev
              || stagingProof.manifest_digest !== proof.manifest_digest) {
            throw Object.assign(new Error('prepared Cloud複製のstagingがpublish proofと一致しません'), { status: 409 });
          }
          await provider.movePathNoReplace(stagingPath, destPath);
        }
        let ownership = await _providerObjectIdentity(provider, destPath, null).catch(() => null);
        const ownershipComplete = ownership?.id && (source.kind === 'directory' || ownership?.rev);
        if (ownershipComplete && !record.intent.provider_id && proof) {
          const freshProof = source.kind === 'directory'
            ? await _cloudFolderIdentityProof(provider, destPath)
            : { provider_id: ownership.id, provider_rev: ownership.rev, manifest_digest: '' };
          if (freshProof.provider_id !== proof.provider_id
              || freshProof.provider_rev !== proof.provider_rev
              || freshProof.manifest_digest !== proof.manifest_digest) {
            throw Object.assign(new Error('prepared Cloud複製先がpublish proofと一致しません'), { status: 409 });
          }
          record.intent = { ...record.intent, provider_id: ownership.id,
            provider_rev: ownership.rev || '', manifest_digest: freshProof.manifest_digest || '' };
          await journal.updateIntent(provider, operationId, operation, payload, record.intent);
        } else if (!ownershipComplete) {
          const orphan = record.intent.orphan_staging;
          if (orphan?.path) {
            const currentOrphan = await _providerObjectIdentity(provider, orphan.path, null)
              .catch(() => null);
            if (currentOrphan?.id) {
              if (currentOrphan.id !== orphan.provider_id
                  || (orphan.provider_rev && currentOrphan.rev !== orphan.provider_rev)) {
                throw Object.assign(new Error('前回の孤立一時項目がforeign変更されています'), { status: 409 });
              }
              throw Object.assign(new Error('前回の孤立一時項目が保全されています'), {
                status: 503, meldexCode: 'copy_staging_orphan_retained',
              });
            }
            record.intent = { ...record.intent };
            delete record.intent.orphan_staging;
            await journal.updateIntent(provider, operationId, operation, payload, record.intent);
          }
          let transaction;
          try {
            transaction = await _copyPathWithIdentityTransaction(
              provider, payload.path, destPath, source.kind, {
                persistPublishProof: async publishProof => {
                  record.intent = { ...record.intent, publish_proof: publishProof };
                  await journal.updateIntent(provider, operationId, operation, payload, record.intent);
                },
              },
            );
          } catch (error) {
            if (error?.meldexOrphanStaging) {
              record.intent = { ...record.intent,
                orphan_staging: error.meldexOrphanStaging };
              await journal.updateIntent(provider, operationId, operation, payload, record.intent);
            }
            throw error;
          }
          ownership = transaction.ownership;
          if (!ownership?.id || (source.kind !== 'directory' && !ownership?.rev)) {
            throw new Error('Cloud複製先のprovider identityを確認できません');
          }
          record.intent = {
            ...record.intent, provider_id: ownership.id, provider_rev: ownership.rev,
            manifest_digest: transaction.manifest_digest || '',
          };
          await journal.updateIntent(provider, operationId, operation, payload, record.intent);
          record = await journal.load(provider, operationId, operation, payload);
        } else if (ownership.id !== record.intent.provider_id
            || (source.kind !== 'directory' && ownership.rev !== record.intent.provider_rev)) {
          throw Object.assign(new Error('prepared Cloud複製先が後続更新と競合しています'), { status: 409 });
        }
        const folderCheckpoint = source.kind === 'directory'
          ? () => _cloudFolderIdentityProof(provider, destPath) : null;
        if (folderCheckpoint && record.intent.manifest_digest
            && !record.intent.aftercare_in_progress) {
          const current = await folderCheckpoint();
          const expected = record.intent.aftercare_manifest_digest || record.intent.manifest_digest;
          if (current.manifest_digest !== expected) {
            throw Object.assign(new Error('prepared Cloud folder manifestが後続更新と競合しています'), { status: 409 });
          }
        }
        record = await journal.runAftercare(provider, operationId, operation, payload, record, [
          { name: 'csv-sidecars', run: () => _relocateCsvSidecars(
            provider, payload.path, destPath, source.kind === 'directory', true,
          ) },
          { name: 'path-mutation-hooks', run: () => _runPathMutationHooks({
            action: 'copy', oldPath: payload.path, newPath: destPath,
            isFolder: source.kind === 'directory', operationId,
          }) },
          { name: 'identity-claims', run: () => _claimPublishedCloudIdentities(
            provider, destPath, source.kind,
          ) },
        ], folderCheckpoint);
        const result = { ok: true, operation_id: operationId, new_path: destPath,
          new_name: source.kind === 'file' ? _splitNameAndExt(destName).stem : destName,
          provider_id: ownership.id, provider_rev: ownership.rev,
          manifest_digest: record.intent.manifest_digest || '' };
        return journal.complete(provider, operationId, operation, payload, result);
      });
    }
    if (pathname === '/outliner/duplicate' && method === 'POST') {
      const provider = await _requirePwaProvider('readwrite');
      const sourcePath = _normalizeFolderPath(body?.path || '');
      const source = await _resolveEntryHandle(provider, sourcePath);
      if (!source) throw new Error(`見つかりません: ${sourcePath}`);
      const operationId = String(body?.operation_id || '').trim();
      const payload = { path: sourcePath };
      return runCloudIdentityCopyOperation(provider, 'duplicate', operationId, payload, source, async () => {
        const sourceName = _basename(sourcePath); const sourceSplit = _splitNameAndExt(sourceName);
        let destName = source.kind === 'file' ? `${sourceSplit.stem}_copy${sourceSplit.ext}` : `${sourceName}_copy`;
        let destPath = _joinPath(_dirname(sourcePath), destName);
        for (let counter = 2; await _freshPathExists(provider, destPath); counter += 1) {
          destName = source.kind === 'file' ? `${sourceSplit.stem}_copy${counter}${sourceSplit.ext}` : `${sourceName}_copy${counter}`;
          destPath = _joinPath(_dirname(sourcePath), destName);
        }
        await _directoryHandle(provider, _dirname(destPath), true);
        return { destName, destPath };
      });
    }

    if (pathname === '/outliner/save-as' && method === 'POST') {
      const provider = await _requirePwaProvider('readwrite');
      const sourcePath = _normalizeFolderPath(body?.path || '');
      const source = await _resolveEntryHandle(provider, sourcePath);
      if (!source) throw new Error(`見つかりません: ${sourcePath}`);
      const sourceName = _basename(sourcePath); const sourceSplit = _splitNameAndExt(sourceName);
      const newName = _validateItemName(String(body?.new_name || (source.kind === 'file' ? sourceSplit.stem : sourceName)).replace(/[\\/]/g, '').replace(/\.\./g, '').trim(), 'new_name');
      const destFolder = _normalizeFolderPath(body?.dest_folder || _dirname(sourcePath));
      const operationId = String(body?.operation_id || '').trim();
      const payload = { path: sourcePath, new_name: newName, dest_folder: destFolder };
      return runCloudIdentityCopyOperation(provider, 'save-as', operationId, payload, source, async () => {
        let destName = source.kind === 'file' ? newName + sourceSplit.ext : newName;
        let destPath = _joinPath(destFolder, destName);
        for (let counter = 2; await _freshPathExists(provider, destPath); counter += 1) {
          destName = source.kind === 'file' ? `${newName}_${counter}${sourceSplit.ext}` : `${newName}_${counter}`;
          destPath = _joinPath(destFolder, destName);
        }
        await _directoryHandle(provider, destFolder, true);
        return { destName, destPath };
      });
    }

/* === gb-data-access-dropbox-fileops-move-route.js === */
/* gb-data-access-dropbox-fileops move-route continuation. */
    if (pathname === '/outliner/move' && method === 'POST') {
      const provider = await _requirePwaProvider('readwrite');
      const sourcePath = _normalizeFolderPath(body?.path || '');
      const destFolder = _normalizeFolderPath(body?.dest_folder || '');
      _rejectProductionStructureMutation(sourcePath, '移動');
      if (window.MeldexProductionSchemaMigration?.isManagedEntryPath?.(sourcePath)) {
        throw new Error('制作管理の管理リストエントリの配置は変更できません');
      }
      const source = await _resolveEntryHandle(provider, sourcePath);
      const destEntry = await _resolveEntryHandle(provider, destFolder);
      if (!source) throw new Error('見つかりません');
      if (!destEntry || destEntry.kind !== 'directory') throw new Error(`移動先フォルダが見つかりません: ${destFolder}`);
      if (source.kind === 'directory' && (destFolder === sourcePath || destFolder.startsWith(sourcePath + '/'))) throw new Error('フォルダ自身の中には移動できません');
      await _rejectNonEntryIntoSheet(provider, destFolder, sourcePath, source.kind === 'directory');
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
      const annotationPlan = await _prepareAnnotationsForPathMutation(provider, {
        action: 'move', oldPath: sourcePath, newPath: conflict.path,
        isFolder: source.kind === 'directory',
      });
      await _moveEntry(provider, sourcePath, conflict.path);
      const warnings = [];
      await _runPostMutationStep(warnings, 'version-history', () => _relocateVersionHistory(provider, sourcePath, conflict.path, source.kind === 'directory'));
      await _runPostMutationStep(warnings, 'csv-sidecars', () => (
        _relocateCsvSidecars(provider, sourcePath, conflict.path, source.kind === 'directory', false)
      ));
      await _runPostMutationStep(warnings, 'stored-paths', () => (
        typeof _rewriteStoredPathsForProvider === 'function'
          ? _rewriteStoredPathsForProvider(provider, sourcePath, conflict.path, source.kind === 'directory')
          : Promise.resolve(_rewriteStoredPaths(sourcePath, conflict.path, source.kind === 'directory'))
      ));
      await _runPathMutationHooksSafe({ action: 'move', oldPath: sourcePath, newPath: conflict.path, isFolder: source.kind === 'directory' }, warnings);
      await _updateAnnotationsForPathMutation(provider, {
        action: 'move', oldPath: sourcePath, newPath: conflict.path,
        isFolder: source.kind === 'directory', annotationPlan,
      });
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

/* === gb-data-access-dropbox-fileops-identity-claims.js === */
/* gb-data-access-dropbox-fileops identity claim continuation. */
    function _settingsEntryIdForClaim(text) {
      const normalized = String(text || '').replace(/\r\n/g, '\n').replace(/^\ufeff/, '');
      if (!normalized.startsWith('---\n')) return '';
      const end = normalized.indexOf('\n---', 4);
      if (end < 0) return '';
      const values = {};
      for (const line of normalized.slice(4, end).split('\n')) {
        if (!line || /^\s/.test(line) || !line.includes(':')) continue;
        const split = line.indexOf(':');
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
