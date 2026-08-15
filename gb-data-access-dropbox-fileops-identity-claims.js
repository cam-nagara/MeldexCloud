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
