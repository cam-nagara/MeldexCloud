/* Fresh, bounded Dropbox reads used only by destructive-operation confirmation. */
(function () {
  'use strict';

  function _normalize(path) {
    return String(path || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  }

  function _basename(path) { return _normalize(path).split('/').pop() || ''; }

  function _modifiedMs(value) {
    const parsed = Date.parse(String(value || ''));
    return Number.isFinite(parsed) ? parsed : 0;
  }

  async function statDropbox(provider, relativePath) {
    const normalized = _normalize(relativePath);
    const location = provider._dropboxLocation(normalized);
    let meta;
    try {
      meta = await provider._rpc('files/get_metadata', {
        path: location.path, include_deleted: false,
        include_has_explicit_shared_members: false,
      }, location);
    } catch (error) {
      if (/not_found/i.test(error?.message || '')) return null;
      throw error;
    }
    const modified = meta.server_modified || meta.client_modified || '';
    return { kind: meta['.tag'] === 'folder' ? 'directory' : 'file',
      name: meta.name || _basename(normalized), path: normalized,
      size: Number(meta.size || 0), modified, modifiedMs: _modifiedMs(modified), meta };
  }

  async function walkDropbox(provider, relativePath, limits = {}) {
    const normalized = _normalize(relativePath);
    const maxEntries = Number(limits.maxEntries || 20000);
    const maxPathBytes = Number(limits.maxPathBytes || 4 * 1024 * 1024);
    const sourceId = window.MeldexSourceFolderRegistry?.parseSourcePath?.(normalized)?.sourceId || '';
    const location = provider._dropboxLocation(normalized);
    const rows = [];
    let pathBytes = 0;
    let payload = await provider._rpc('files/list_folder', {
      path: location.path, recursive: true, include_deleted: false,
      include_has_explicit_shared_members: false, include_mounted_folders: true,
    }, location);
    while (true) {
      for (const entry of (payload.entries || [])) {
        if (entry['.tag'] !== 'file' && entry['.tag'] !== 'folder') continue;
        const path = provider._relativeFromDropboxPath(entry.path_display || entry.path_lower || '', sourceId);
        pathBytes += new TextEncoder().encode(path).byteLength;
        if (rows.length >= maxEntries || pathBytes > maxPathBytes) {
          throw Object.assign(new Error('フォルダの確認上限を超えました'), { status: 503 });
        }
        const modified = entry.server_modified || entry.client_modified || '';
        rows.push({ path, kind: entry['.tag'] === 'folder' ? 'directory' : 'file',
          size: Number(entry.size || 0), modified, modifiedMs: _modifiedMs(modified), meta: entry });
      }
      if (!payload.has_more || !payload.cursor) break;
      payload = await provider._rpc('files/list_folder/continue', { cursor: payload.cursor }, location);
    }
    return rows;
  }

  function _parseJson(value) {
    try { return JSON.parse(String(value || '')); } catch (_) { return {}; }
  }

  async function readDropboxTextBounded(provider, relativePath, maxBytes) {
    const normalized = _normalize(relativePath);
    const location = provider._dropboxLocation(normalized);
    const metadata = () => provider._rpc('files/get_metadata', {
      path: location.path, include_deleted: false, include_has_explicit_shared_members: false,
    }, location);
    const before = await metadata();
    if (!Number.isFinite(maxBytes) || maxBytes < 0 || Number(before?.size || 0) > maxBytes) {
      throw Object.assign(new Error('参照影響の読取上限を超えました'), { status: 503 });
    }
    const response = await provider._content('files/download', { path: location.path }, undefined, location);
    const downloaded = _parseJson(response.headers.get('dropbox-api-result'));
    const reader = response.body?.getReader?.();
    if (!reader) throw Object.assign(new Error('Dropboxのbounded読込を利用できません'), { status: 503 });
    const decoder = new TextDecoder();
    let total = 0, text = '';
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      total += chunk.value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw Object.assign(new Error('参照影響の読取上限を超えました'), { status: 503 });
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    const after = await metadata();
    if (!before?.rev || before.rev !== downloaded.rev || before.rev !== after?.rev) {
      throw Object.assign(new Error('Dropboxファイルの読込中に内容が変わりました'), { status: 409, meldexCode: 'etag_conflict' });
    }
    provider._rememberMeta(normalized, after);
    return text;
  }

  const contract = window.MeldexStorageDeleteConfirmationFresh = Object.freeze({
    statDropbox, walkDropbox, readDropboxTextBounded,
  });
  const prototype = window.MeldexStorageAdapter?.DropboxStorageProvider?.prototype;
  if (!prototype) throw new Error('DropboxStorageProvider is not loaded');
  prototype.statPathFresh = function (path) { return contract.statDropbox(this, path); };
  prototype.walkEntriesFresh = function (path, limits) { return contract.walkDropbox(this, path, limits); };
  prototype.readTextBounded = function (path, maxBytes) { return contract.readDropboxTextBounded(this, path, maxBytes); };
})();
