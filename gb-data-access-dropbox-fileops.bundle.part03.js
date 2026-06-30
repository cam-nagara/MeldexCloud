          deleted_at: String(meta?.deleted_at || ''),
        });
      }
      return { items };
    }

    if (pathname === '/trash/restore' && method === 'POST') {
      const provider = await _requirePwaProvider('readwrite');
      const name = _validateItemName(body?.name || '', 'name');
      const source = await _resolveEntryHandle(provider, _joinPath(PWA_TRASH_DIR, name));
      if (!source) throw new Error('ゴミ箱に見つかりません');
      const originalPath = _normalizeFolderPath((await _readJsonSafe(provider, _joinPath(PWA_TRASH_DIR, name + '._trash_meta.json'), {}))?.original_path || '');
      const baseDest = originalPath || name;
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
      await _moveEntry(provider, _joinPath(PWA_TRASH_DIR, name), destPath);
      await _removeEntry(provider, _joinPath(PWA_TRASH_DIR, name + '._trash_meta.json')).catch(() => {});
      return { ok: true, restored_to: destPath };
    }

    if (pathname === '/trash/delete' && method === 'POST') {
      const provider = await _requirePwaProvider('readwrite');
      const name = _validateItemName(body?.name || '', 'name');
      const target = await _resolveEntryHandle(provider, _joinPath(PWA_TRASH_DIR, name));
      if (!target) return { ok: true };
      await _removeEntry(provider, _joinPath(PWA_TRASH_DIR, name));
      await _removeEntry(provider, _joinPath(PWA_TRASH_DIR, name + '._trash_meta.json')).catch(() => {});
      return { ok: true };
    }

    if (pathname === '/trash/empty' && method === 'POST') {
      const provider = await _requirePwaProvider('readwrite');
      const trash = await _resolveEntryHandle(provider, PWA_TRASH_DIR);
      if (!trash || trash.kind !== 'directory') return { ok: true };
      const entries = await _listDirectoryEntries(provider, PWA_TRASH_DIR);
      for (const entry of entries) {
        await _removeEntry(provider, _joinPath(PWA_TRASH_DIR, entry.name)).catch(() => {});
      }
      return { ok: true };
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
})();
