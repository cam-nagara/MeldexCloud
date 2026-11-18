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
