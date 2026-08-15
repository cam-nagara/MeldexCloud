/* Dropbox-backed /file route used by the standalone Cloud applications. */
(function (root) {
  'use strict';

  function _identityFormat(path, content) {
    return root.MeldexDocumentIdentity?.formatForPath?.(path, content);
  }

  function _readDocumentId(content, format) {
    return format
      ? String(root.MeldexDocumentIdentity?.readDocumentId?.(content, format) || '')
      : '';
  }

  function _revisionPayload(token) {
    return { transport: 'dropbox-rev', token };
  }

  async function regenerateCopiedDocumentIdentity(provider, path) {
    const source = await provider.readText(path);
    const format = _identityFormat(path, source);
    if (!format) return;
    const regenerated = root.MeldexDocumentIdentity.regenerateDocumentId(source, format);
    if (regenerated?.changed) await provider.writeText(path, regenerated.text);
  }

  async function trashWithConfirmation(context) {
    const { provider, body, normalizePath, joinPath, sourceRootPath, basename,
      uniqueProviderPath, requireUnlockedPath } = context;
    const source = normalizePath(body?.path || '');
    const stat = await (provider.statPathFresh?.(source) || provider.statPath(source));
    if (!stat) throw Object.assign(new Error('削除する項目が見つかりません'), { status: 409 });
    const freshKind = stat.kind === 'directory' ? 'folder' : 'file';
    if (body?.kind && body.kind !== freshKind) throw Object.assign(new Error('削除対象の種類が変更されました'), { status: 409 });
    const gate = root.MeldexCloudDeleteConfirmation;
    if (!gate?.consumeProviderDelete || !gate?.revalidateProviderDelete) throw Object.assign(new Error('削除確認の永続ストレージを利用できません'), { status: 503 });
    const consumed = await gate.consumeProviderDelete({ provider, items: [{ path: source, kind: freshKind }], operation: 'trash', confirmations: body?.confirmations, confirmationToken: body?.confirmationToken, graphRevision: body?.graphRevision });
    const trashRoot = joinPath(sourceRootPath(source), '_trash');
    await provider.ensureDirectory(trashRoot);
    const target = await uniqueProviderPath(provider, trashRoot, `${Date.now()}-${basename(source)}`, '-');
    await requireUnlockedPath(target.path, { action: 'delete-trash-destination' }, true);
    await gate.revalidateProviderDelete({ provider, receipt: consumed.receipt });
    await provider.movePath(source, target.path);
    return { ok: true, path: source, trash_path: target.path };
  }

  async function handle(context) {
    const {
      endpoint,
      method,
      body,
      url,
      provider,
      normalizePath,
      ConflictError,
    } = context;
    if (endpoint !== '/file') return { handled: false };

    const filePath = normalizePath(url.searchParams.get('path') || '');
    if (method === 'GET') {
      const metadata = await provider.getMetadata(filePath);
      const token = String(metadata?.rev || metadata?.content_hash || '');
      const providerId = String(metadata?.id || '');
      let identity = providerId
        ? { provider_id: providerId, document_key: 'dropbox-item:' + providerId }
        : {};
      if (url.searchParams.get('metadata_only') === '1') {
        return {
          handled: true,
          value: {
            path: filePath,
            etag: token,
            transport_revision: _revisionPayload(token),
            ...identity,
          },
        };
      }
      const content = await provider.readText(filePath);
      const documentId = _readDocumentId(content, _identityFormat(filePath, content));
      if (documentId) {
        identity = {
          ...identity,
          document_id: documentId,
          document_key: 'document:' + documentId,
        };
      }
      return {
        handled: true,
        value: {
          path: filePath,
          content,
          etag: token,
          transport_revision: _revisionPayload(token),
          ...identity,
        },
      };
    }

    if (method !== 'PUT' && method !== 'POST') return { handled: false };
    const metadata = await provider.refreshMetadata(filePath);
    const currentEtag = String(metadata?.rev || metadata?.content_hash || '');
    const expected = String(body?.if_match_etag || body?.ifMatchEtag || '');
    const createOnly = !!(body?.create_only || body?.createOnly);
    const forceOverwrite = !!(body?.force_overwrite || body?.forceOverwrite);
    if (!metadata && (body?.skip_if_missing || body?.skipIfMissing)) {
      return { handled: true, value: { ok: true, skipped: true, missing: true, etag: '' } };
    }
    if (metadata?.['.tag'] === 'folder') throw new Error('フォルダはファイルとして保存できません');
    if (createOnly && metadata) {
      throw new ConflictError('', { path: filePath, expected: '', current: currentEtag || 'exists' });
    }
    if (metadata && !expected && !forceOverwrite) {
      const error = new Error('既存ファイルの全量更新には読込時のrevisionが必要です');
      error.status = 428;
      error.code = 'precondition_required';
      error.meldexCode = 'precondition_required';
      throw error;
    }
    if (!forceOverwrite && expected && (!metadata || !currentEtag || expected !== currentEtag)) {
      throw new ConflictError('', { path: filePath, expected, current: currentEtag });
    }

    let content = String(body?.content ?? '');
    const incomingFormat = _identityFormat(filePath, content);
    let format = incomingFormat;
    let existingDocumentId = '';
    if (incomingFormat && metadata) {
      const existingContent = await provider.readText(filePath);
      const existingFormat = _identityFormat(filePath, existingContent);
      format = existingFormat === incomingFormat ? incomingFormat : null;
      existingDocumentId = _readDocumentId(existingContent, format);
    }
    if (format) {
      content = root.MeldexDocumentIdentity.ensureDocumentIdForOverwrite(
        content,
        format,
        existingDocumentId,
      ).text;
    }
    const written = await provider.writeText(filePath, content);
    const token = String(written?.rev || written?.content_hash || '');
    const providerId = String(written?.id || metadata?.id || '');
    const documentId = _readDocumentId(content, format);
    return {
      handled: true,
      value: {
        ok: true,
        path: filePath,
        etag: token,
        transport_revision: _revisionPayload(token),
        ...(providerId ? { provider_id: providerId } : {}),
        ...(documentId
          ? { document_id: documentId, document_key: 'document:' + documentId }
          : (providerId ? { document_key: 'dropbox-item:' + providerId } : {})),
      },
    };
  }

  async function fileAsDataUrl(context) {
    const {
      path,
      extensions,
      ensureReady,
      assertFile,
      getProvider,
    } = context;
    await ensureReady({ requireConnection: true });
    const pathOptions = extensions?.length
      ? { action: '画像を読み込み', extensions }
      : { action: '添付ファイルを読み込み', requireExtension: false };
    const normalized = assertFile(path, pathOptions);
    const provider = getProvider();
    if (!provider?.downloadAsFile) throw new Error('ファイルを読み込めません');
    const file = await provider.downloadAsFile(normalized);
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(reader.error || new Error('ファイルを読み込めません'));
      reader.readAsDataURL(file);
    });
  }

  function installApiGlobals(requestJson) {
    const cloudFetch = async (path, opts) => requestJson(path, opts || {});
    cloudFetch._meldexStandaloneCloudAdapter = true;
    root.apiFetch = cloudFetch;
    root.apiPut = (path, body) => cloudFetch(path, { method: 'PUT', body: body || {} });
    root.apiPost = (path, body, options) => cloudFetch(path, { ...(options || {}), method: 'POST', body: body || {} });
    root.apiDelete = (path) => cloudFetch(path, { method: 'DELETE' });
  }

  async function copyWithJournal(options) {
    const { provider, operation, body, source, stat, chooseTarget, normalizePath, dirname } = options;
    const operationId = String(body?.operation_id || '').trim();
    if (!operationId) throw Object.assign(new Error('operation_id は必須です'), { status: 400 });
    const journal = root.MeldexCloudCopyOperationJournal;
    if (!journal) throw Object.assign(new Error('Cloudファイル操作履歴を利用できません'), { status: 503 });
    const payload = operation === 'duplicate' ? { path: source } : {
      path: source, new_name: String(body?.new_name || ''),
      dest_folder: normalizePath(body?.dest_folder || dirname(source)),
    };
    return journal.withFlight(provider, operationId, operation, payload, async identity => {
      let record = await journal.load(provider, operationId, operation, payload, identity);
      if (record?.state === 'completed') return record.result;
      const target = record ? { path: record.intent.destination, name: options.basename(record.intent.destination) }
        : await chooseTarget();
      if (!record) record = await journal.prepare(provider, operationId, operation, payload, {
        source, destination: target.path, kind: stat.kind, provider_id: '', provider_rev: '',
        manifest_digest: '', aftercare_completed: [],
      }, identity);
      let current = await provider.statPath(target.path);
      const currentId = current?.id || current?.meta?.id || '';
      const currentRev = current?.rev || current?.meta?.rev || '';
      if (!currentId || !currentRev) {
        const transaction = await root.MeldexCloudIdentityCopyTransaction.copyPath(
          provider, source, target.path, stat.kind,
        );
        current = transaction.ownership;
        if (!current?.id || !current?.rev) throw new Error('Cloud複製先のprovider ID/revisionを確認できません');
        record.intent = { ...record.intent, provider_id: current.id, provider_rev: current.rev,
          manifest_digest: transaction.manifest_digest || '' };
        await journal.updateIntent(provider, operationId, operation, payload, record.intent);
      } else if (currentId !== record.intent.provider_id || currentRev !== record.intent.provider_rev) {
        throw Object.assign(new Error('prepared Cloud複製先が後続更新と競合しています'), { status: 409 });
      } else current = { id: currentId, rev: currentRev };
      record = await journal.load(provider, operationId, operation, payload, identity);
      const claims = root.MeldexCloudIdentityClaimAftercare;
      if (!claims?.claimPublished) throw Object.assign(new Error('identity claim aftercareを利用できません'), { status: 503 });
      record = await journal.runAftercare(provider, operationId, operation, payload, record, [{
        name: 'identity-claims',
        run: () => claims.claimPublished(provider, target.path, stat.kind),
      }]);
      return journal.complete(provider, operationId, operation, payload, {
        ok: true, operation_id: operationId, new_path: target.path, new_name: target.name,
        provider_id: current.id, provider_rev: current.rev,
        manifest_digest: record.intent.manifest_digest || '',
      });
    });
  }

  root.MeldexStandaloneCloudFileRoutes = Object.freeze({
    handle,
    regenerateCopiedDocumentIdentity,
    trashWithConfirmation,
    fileAsDataUrl,
    installApiGlobals,
    copyWithJournal,
  });
})(window);
