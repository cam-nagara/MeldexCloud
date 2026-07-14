/* Path boundary policy for Meldex standalone Cloud apps. */
(function () {
  'use strict';

  const DENIED_CODE = 'standalone_path_denied';
  const SPECIALIZED_EXTENSIONS = ['.board.md', '.scriptnote.json', '.smart-db.json', '.timer.json'];

  class StandaloneCloudPathError extends Error {
    constructor(message, detail) {
      super(message || 'この保存先は、登録済みのMeldexフォルダの外にあるため操作できません。');
      this.name = 'StandaloneCloudPathError';
      this.code = DENIED_CODE;
      this.detail = detail || null;
    }
  }

  function normalizePath(value) {
    const raw = String(value || '').trim().replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+/g, '/');
    if (!raw) return '';
    const parts = raw.split('/').filter(Boolean);
    if (parts.some((part) => part === '.' || part === '..' || /[\u0000-\u001f]/.test(part))) {
      throw new StandaloneCloudPathError('保存場所のパスが不正です', { path: raw });
    }
    return parts.join('/');
  }

  function joinPath() {
    return Array.from(arguments).map(normalizePath).filter(Boolean).join('/');
  }

  function dirname(path) {
    const normalized = normalizePath(path);
    const index = normalized.lastIndexOf('/');
    return index < 0 ? '' : normalized.slice(0, index);
  }

  function basename(path) {
    const normalized = normalizePath(path);
    return normalized.slice(normalized.lastIndexOf('/') + 1);
  }

  function fileNameMatches(name, extensions) {
    const lower = String(name || '').toLowerCase();
    if (!extensions?.length) return true;
    const allowed = extensions.map((extension) => String(extension).toLowerCase());
    const specialized = SPECIALIZED_EXTENSIONS.find((extension) => lower.endsWith(extension));
    if (specialized && !allowed.includes(specialized)) return false;
    return allowed.some((extension) => lower.endsWith(extension));
  }

  function splitName(name) {
    const value = String(name || '');
    const known = ['.scriptnote.json', '.smart-db.json', '.timer.json', '.mel-scenario', '.mel-board', '.mel-sheet', '.mel-timer'];
    const suffix = known.find((extension) => value.toLowerCase().endsWith(extension));
    if (suffix) return { stem: value.slice(0, -suffix.length), extension: value.slice(-suffix.length) };
    const index = value.lastIndexOf('.');
    return index > 0 ? { stem: value.slice(0, index), extension: value.slice(index) } : { stem: value, extension: '' };
  }

  function ensureExtension(name, spec) {
    const safe = String(name || spec.defaultFilename).replace(/[\\/]/g, '').replace(/\.\./g, '').trim() || spec.defaultFilename;
    return fileNameMatches(safe, spec.extensions) ? safe : safe + spec.defaultExtension;
  }

  function _physicalPath(value) {
    let normalized = String(value || '').trim().replace(/\\/g, '/').replace(/\/+/g, '/');
    if (!normalized) return '';
    if (!normalized.startsWith('/')) normalized = '/' + normalized;
    if (normalized.length > 1) normalized = normalized.replace(/\/+$/, '');
    return normalized.toLowerCase();
  }

  function _deny(action, path, reason) {
    const label = String(action || '操作');
    throw new StandaloneCloudPathError(`${label}できない保存場所です。Meldexの登録済みフォルダ内を選択してください。`, {
      action: label, path: String(path || ''), reason: reason || 'outside_registered_root',
    });
  }

  function create(options) {
    if (typeof options?.getRoots !== 'function' || typeof options?.getAppSpec !== 'function') {
      throw new StandaloneCloudPathError('保存先の境界確認を初期化できません', { reason: 'missing_context' });
    }

    function normalizeRoot(root) {
      const id = String(root?.id || root?.sourceId || '').trim();
      const path = normalizePath(root?.path || '');
      const canonicalPath = id ? `__dropbox_root__/${encodeURIComponent(id)}` : '';
      if (!id || path !== canonicalPath) return null;
      return { ...root, id, sourceId: id, path };
    }

    function rootList(getter) {
      const values = typeof getter === 'function' ? getter() : [];
      return (Array.isArray(values) ? values : [])
        .map(normalizeRoot)
        .filter(Boolean)
        .sort((left, right) => right.path.length - left.path.length);
    }

    function roots() { return rootList(options.getRoots); }
    function protectedRoots() { return rootList(options.getAllRoots || options.getRoots); }

    function match(path) {
      const normalized = normalizePath(path);
      if (!normalized) return null;
      for (const root of roots()) {
        if (normalized === root.path) return { path: normalized, root, isRoot: true };
        if (normalized.startsWith(root.path + '/')) return { path: normalized, root, isRoot: false };
      }
      return null;
    }

    function assertInside(path, settings) {
      const found = match(path);
      if (!found) _deny(settings?.action, path, 'outside_registered_root');
      if (found.isRoot && settings?.allowRoot === false) _deny(settings?.action, path, 'registered_root');
      const relative = found.isRoot ? '' : found.path.slice(found.root.path.length + 1);
      if (settings?.allowInternal !== true && relative.split('/').some((part) => part.startsWith('.') || part.startsWith('_'))) {
        _deny(settings?.action, path, 'internal_path');
      }
      return found;
    }

    function allowsInside(path, settings) {
      try { return !!assertInside(path, settings); } catch { return false; }
    }

    function assertFolder(path, action) {
      return assertInside(path, { allowRoot: true, action: action || 'フォルダを表示' }).path;
    }

    function assertTrashRoot(path) {
      const normalized = normalizePath(path);
      const matched = protectedRoots().find((root) => normalized === joinPath(root.path, '_trash'));
      if (!matched) _deny('ゴミ箱を復元', path, 'invalid_trash_root');
      return normalized;
    }

    function restoreDestination(trashRoot, originalPath) {
      const validatedTrashRoot = assertTrashRoot(trashRoot);
      const targetRoot = protectedRoots().find((root) => validatedTrashRoot === joinPath(root.path, '_trash'));
      const original = normalizePath(originalPath);
      const parts = original.split('/');
      let sourceId = '';
      try { sourceId = decodeURIComponent(parts[1] || ''); } catch { _deny('復元', original, 'invalid_original_source'); }
      if (parts[0] !== '__dropbox_root__' || !sourceId || parts[1] !== encodeURIComponent(sourceId)) {
        _deny('復元', original, 'invalid_original_source');
      }
      const relative = parts.slice(2);
      if (!relative.length || relative.some((part) => part.startsWith('.') || part.startsWith('_'))) {
        _deny('復元', original, 'invalid_original_relative_path');
      }
      return assertMutableSource(joinPath(targetRoot.path, relative.join('/')), '復元');
    }

    function assertFile(path, settings) {
      const found = assertInside(path, { allowRoot: false, action: settings?.action || 'ファイルを開く' });
      const extensions = settings?.extensions || options.getAppSpec()?.extensions || [];
      if (settings?.requireExtension !== false && !fileNameMatches(found.path, extensions)) {
        _deny(settings?.action || 'ファイルを開く', found.path, 'extension_not_allowed');
      }
      return found.path;
    }

    function physicalPath(path, found) {
      const normalized = normalizePath(path);
      if (typeof options.resolveDropboxPath === 'function') {
        try {
          const resolved = _physicalPath(options.resolveDropboxPath(normalized));
          if (resolved) return resolved;
        } catch { /* Fall back to the loaded root snapshot below. */ }
      }
      const matchResult = found || match(normalized);
      if (!matchResult) return '';
      const rootPhysical = _physicalPath(matchResult.root?.dropboxPath || '');
      if (!rootPhysical) return '';
      const relative = normalized === matchResult.root.path ? '' : normalized.slice(matchResult.root.path.length + 1);
      return _physicalPath(relative ? `${rootPhysical}/${relative}` : rootPhysical);
    }

    function assertMutableSource(path, action) {
      const found = assertInside(path, { allowRoot: false, action: action || '項目を変更' });
      const sourcePhysical = physicalPath(found.path, found);
      if (!sourcePhysical) _deny(action, found.path, 'physical_path_unresolved');
      for (const root of protectedRoots()) {
        const registeredPhysical = _physicalPath(root.dropboxPath || '');
        if (!registeredPhysical) _deny(action, found.path, 'registered_physical_path_unresolved');
        if (sourcePhysical === registeredPhysical
            || (sourcePhysical !== '/' && registeredPhysical.startsWith(sourcePhysical + '/'))) {
          _deny(action, found.path, 'registered_root_physical_alias');
        }
      }
      return found.path;
    }

    function authorizeRequest(request) {
      const endpoint = String(request?.endpoint || '');
      const method = String(request?.method || 'GET').toUpperCase();
      const body = request?.body && typeof request.body === 'object' ? request.body : {};
      const queryPath = normalizePath(request?.queryPath || '');
      if (endpoint === '/browse' && method === 'GET') return assertFolder(queryPath, 'フォルダを表示');
      if (endpoint === '/search' && method === 'GET') return assertFolder(queryPath, 'フォルダを検索');
      if (endpoint === '/file-meta' && method === 'GET') {
        return assertFile(queryPath, { action: 'ファイル情報を確認', requireExtension: false });
      }
      if (endpoint === '/file' && method === 'GET') {
        return assertFile(queryPath, { action: 'ファイルを読み込み', requireExtension: false });
      }
      if (endpoint === '/file' && (method === 'PUT' || method === 'POST')) {
        return assertFile(queryPath, { action: 'ファイルを保存' });
      }
      if (endpoint === '/upload-file' && method === 'POST') {
        const folder = assertFolder(queryPath || body.dir || '', 'ファイルを追加');
        return assertFile(joinPath(folder, body.filename || body.name || ''), {
          action: 'ファイルを追加', requireExtension: false,
        });
      }
      if (endpoint === '/outliner/add' && method === 'POST') {
        const parent = assertFolder(body.parent || '', '項目を追加');
        const name = String(body.label || '新しいフォルダ').replace(/[\\/]/g, '').trim() || '新しいフォルダ';
        return assertInside(joinPath(parent, name), { allowRoot: false, action: '項目を追加' }).path;
      }
      if (endpoint === '/outliner/rename' && method === 'POST') {
        const source = assertMutableSource(body.old_path || body.path || '', '名前を変更');
        const parent = assertFolder(dirname(source), '名前を変更');
        const name = String(body.new_name || '').replace(/[\\/]/g, '').trim();
        const extension = splitName(basename(source)).extension;
        assertInside(joinPath(parent, name), { allowRoot: false, action: '名前を変更' });
        return assertInside(joinPath(parent, name + extension), { allowRoot: false, action: '名前を変更' }).path;
      }
      if (endpoint === '/outliner/delete' && method === 'POST') {
        return assertMutableSource(body.path || '', '削除');
      }
      if (endpoint === '/outliner/delete-batch' && method === 'POST') {
        const items = Array.isArray(body.items) ? body.items : [];
        items.forEach((item) => assertMutableSource(item?.path || '', '削除'));
        return items.map((item) => normalizePath(item.path));
      }
      if (endpoint === '/outliner/restore' && method === 'POST') {
        return assertMutableSource(body.path || body.original_path || '', '復元');
      }
      if (endpoint === '/outliner/duplicate' && method === 'POST') {
        const source = assertMutableSource(body.path || '', '複製');
        return assertFolder(dirname(source), '複製');
      }
      if (endpoint === '/outliner/save-as' && method === 'POST') {
        const source = assertMutableSource(body.path || '', '名前を付けて保存');
        const destination = assertFolder(body.dest_folder || dirname(source), '名前を付けて保存');
        const split = splitName(basename(source));
        const name = String(body.new_name || split.stem).replace(/[\\/]/g, '').trim();
        assertInside(joinPath(destination, name), { allowRoot: false, action: '名前を付けて保存' });
        return assertInside(joinPath(destination, name + split.extension), {
          allowRoot: false, action: '名前を付けて保存',
        }).path;
      }
      if (endpoint === '/outliner/move' && method === 'POST') {
        const source = assertMutableSource(body.path || '', '移動');
        const destination = assertFolder(body.dest_folder || '', '移動');
        const sourcePhysical = physicalPath(source);
        const destinationPhysical = _physicalPath(`${physicalPath(destination)}/${basename(source)}`);
        if (!sourcePhysical || !destinationPhysical || destinationPhysical === sourcePhysical
            || destinationPhysical.startsWith(sourcePhysical + '/')) {
          _deny('移動', destination, 'self_or_descendant_destination');
        }
        return destination;
      }
      return null;
    }

    function initialFile(path, extensions) {
      try {
        return assertFile(path, { action: 'ファイルを開く', extensions });
      } catch {
        return '';
      }
    }

    return Object.freeze({
      roots, protectedRoots, match, assertInside, allowsInside, assertFolder, assertTrashRoot, restoreDestination,
      assertFile, assertMutableSource,
      authorizeRequest, initialFile, physicalPath,
    });
  }

  window.MeldexStandaloneCloudPathPolicy = Object.freeze({
    DENIED_CODE, StandaloneCloudPathError, normalizePath, joinPath, dirname, basename,
    fileNameMatches, splitName, ensureExtension, create,
  });
})();
