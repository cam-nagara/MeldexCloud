/* Atomic, retry-safe batch folder-link routes shared by Cloud/PWA surfaces. */
const _folderLinkBatchFlights = new Map();
const _FOLDER_LINK_REQUEST_LIMIT = 512;

function _folderLinkBatchSummary(operation, requestId, results) {
  const summary = { ok: !results.some(row => row.status === 'failed'), operation, request_id: requestId, results };
  ['created', 'removed', 'unchanged', 'failed'].forEach(status => {
    summary[`${status}_count`] = results.filter(row => row.status === status).length;
  });
  return summary;
}

function _folderLinkBatchFingerprint(operation, body) {
  return JSON.stringify({
    operation,
    folder_path: _normalizeFolderPath(body?.folder_path || ''),
    folder_id: String(body?.folder_id || '').trim(),
    items: (Array.isArray(body?.items) ? body.items : []).map(item => ({
      file_path: _normalizeFolderPath(item?.file_path || item?.path || ''),
      file_id: String(item?.file_id || '').trim(),
    })),
  });
}

function _assertFolderLinkRequestFingerprint(record, operation, fingerprint, scopeId) {
  if (record && (record.operation !== operation || record.fingerprint !== fingerprint || record.scope_id !== scopeId)) {
    throw new Error('同じ request_id を異なるリンク操作へ再利用できません');
  }
}

async function _resolveCloudLinkFolder(provider, body) {
  const requestedPath = _normalizeFolderPath(body?.folder_path || '');
  let folderId = String(body?.folder_id || '').trim();
  let folderPath = requestedPath;
  if (folderId) {
    const byId = _normalizeFolderPath(await _findPathByFileId(provider, folderId));
    if (!byId) throw new Error('folder_id に対応するフォルダが見つかりません');
    if (requestedPath && requestedPath !== byId) throw new Error('folder_path と folder_id が同じフォルダを指していません');
    folderPath = byId;
  }
  const folderEntry = await _resolveEntryHandle(provider, folderPath);
  if (!folderPath || !folderEntry || folderEntry.kind !== 'directory') throw new Error('リンク先フォルダが見つかりません');
  const canonicalId = _fnvFileId(folderPath);
  if (folderId && folderId !== canonicalId) throw new Error('folder_id が現在のフォルダ識別子と一致しません');
  folderId = canonicalId;
  if (typeof isItemLocked === 'function' && isItemLocked(folderPath)) throw new Error('編集ロック中のフォルダにはリンクを変更できません');
  return { folderPath, folderId };
}

function _cloudFolderLinkMatches(link, fileId, folderPath, folderId) {
  return link.file_id === fileId && (link.folder_id === folderId || (!link.folder_id && link.folder_path === folderPath));
}

async function _validateFolderLinkBatch(provider, operation, body) {
  const { folderPath, folderId } = await _resolveCloudLinkFolder(provider, body);
  const inputItems = Array.isArray(body?.items) ? body.items : [];
  if (!inputItems.length) throw new Error('items は1件以上必要です');
  const validated = [];
  const validationFailures = [];
  for (const input of inputItems) {
    const filePath = _normalizeFolderPath(input?.file_path || input?.path || '');
    let fileId = String(input?.file_id || '').trim();
    try {
      if (operation === 'add') {
        const entry = await _resolveEntryHandle(provider, filePath);
        if (!entry) throw new Error('ファイル/フォルダが見つかりません');
        if (entry.kind === 'directory' && (filePath === folderPath || folderPath.startsWith(`${filePath}/`))) {
          throw new Error('元フォルダ自身またはその配下にはリンクできません');
        }
      }
      fileId = fileId || (filePath ? _fnvFileId(filePath) : '');
      if (!fileId) throw new Error('file_id が見つかりません');
      validated.push({ file_path: filePath, file_id: fileId });
    } catch (error) {
      validationFailures.push({ file_path: filePath, file_id: fileId, folder_path: folderPath, folder_id: folderId, status: 'failed', error: error?.message || String(error) });
    }
  }
  return { folderPath, folderId, validated, validationFailures };
}

function _applyFolderLinkBatch(currentLinks, operation, validated, folderPath, folderId) {
  const next = currentLinks.map(link => ({ ...link }));
  const results = validated.map(item => {
    const result = { ...item, folder_path: folderPath, folder_id: folderId };
    const index = next.findIndex(link => _cloudFolderLinkMatches(link, item.file_id, folderPath, folderId));
    if (operation === 'add') {
      if (index >= 0) {
        if (!next[index].folder_id) next[index] = { ...next[index], folder_path: folderPath, folder_id: folderId };
        result.status = 'unchanged';
      } else {
        next.push({ ...item, path: item.file_path, name: _displayLabelForPath(item.file_path, ''), folder_path: folderPath, folder_id: folderId, added_at: new Date().toISOString() });
        result.status = 'created';
      }
    } else if (index < 0) result.status = 'unchanged';
    else {
      next.splice(index, 1);
      result.status = 'removed';
    }
    return result;
  });
  return { links: next, results };
}

async function _executeFolderLinkBatch(provider, operation, body, scopeId, fingerprint) {
  const requestId = String(body?.request_id || '').trim();
  if (requestId) {
    const current = await _folderLinksStateForProvider(provider);
    if (!Array.isArray(current?.requests)) throw new Error('フォルダリンクの再試行履歴が破損しています');
    const previous = current.requests.find(record => record.request_id === requestId);
    _assertFolderLinkRequestFingerprint(previous, operation, fingerprint, scopeId);
    if (previous) return previous.result;
  }
  const { folderPath, folderId, validated, validationFailures } = await _validateFolderLinkBatch(provider, operation, body);
  const committed = await _updateFolderLinksStateForProvider(provider, (state) => {
    if (!Array.isArray(state?.links) || !Array.isArray(state?.requests)) {
      throw new Error('フォルダリンクの再試行履歴が破損しています');
    }
    const previous = requestId ? state.requests.find(record => record.request_id === requestId) : null;
    _assertFolderLinkRequestFingerprint(previous, operation, fingerprint, scopeId);
    if (previous) return { ...state, result: previous.result };
    const applied = _applyFolderLinkBatch(state.links, operation, validated, folderPath, folderId);
    const result = _folderLinkBatchSummary(operation, requestId, applied.results.concat(validationFailures));
    const requests = requestId ? [...state.requests, {
      request_id: requestId,
      operation,
      fingerprint,
      scope_id: scopeId,
      result,
      saved_at: new Date().toISOString(),
    }].slice(-_FOLDER_LINK_REQUEST_LIMIT) : state.requests;
    return { links: applied.links, requests, result };
  });
  return committed.result;
}

async function _handleFolderLinkBatchRoute(pathname, method, body) {
  const operation = pathname === '/folder-links/batch/add' && method === 'POST' ? 'add'
    : (pathname === '/folder-links/batch/remove' && method === 'POST' ? 'remove' : '');
  if (!operation) return undefined;
  const provider = await _requirePwaProvider('readwrite');
  const scopeId = await _folderLinksManagementScope(provider);
  const requestId = String(body?.request_id || '').trim();
  const fingerprint = _folderLinkBatchFingerprint(operation, body);
  const key = `${scopeId}:${requestId}`;
  if (requestId) {
    const flight = _folderLinkBatchFlights.get(key);
    _assertFolderLinkRequestFingerprint(flight, operation, fingerprint, scopeId);
    if (flight) return flight.promise;
  }
  const promise = _executeFolderLinkBatch(provider, operation, body, scopeId, fingerprint);
  if (requestId) _folderLinkBatchFlights.set(key, { operation, fingerprint, scope_id: scopeId, promise });
  try { return await promise; }
  finally { if (requestId) _folderLinkBatchFlights.delete(key); }
}

// Generated split parts execute at separate script boundaries in real browsers.
// Export through the established internals object instead of relying on a cross-part lexical binding.
if (globalThis.__MeldexPwaDataAccessInternals) {
  globalThis.__MeldexPwaDataAccessInternals._handleFolderLinkBatchRoute = _handleFolderLinkBatchRoute;
}
