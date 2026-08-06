/* Dropbox-backed /file route used by the standalone Cloud applications. */
(function (root) {
  'use strict';

  function _identityFormat(path) {
    return root.MeldexDocumentIdentity?.formatForPath?.(path);
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
    const format = _identityFormat(path);
    if (!format) return;
    const source = await provider.readText(path);
    const regenerated = root.MeldexDocumentIdentity.regenerateDocumentId(source, format);
    if (regenerated?.changed) await provider.writeText(path, regenerated.text);
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
      const documentId = _readDocumentId(content, _identityFormat(filePath));
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
    const format = _identityFormat(filePath);
    const existingDocumentId = format && metadata
      ? _readDocumentId(await provider.readText(filePath), format)
      : '';
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

  root.MeldexStandaloneCloudFileRoutes = Object.freeze({
    handle,
    regenerateCopiedDocumentIdentity,
    fileAsDataUrl,
    installApiGlobals,
  });
})(window);
