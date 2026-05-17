        } catch (err) {
          return {
            ok: false,
            mounted: true,
            access: 'viewer',
            message: `共有フォルダ内の _meldex/ を作成できません。編集権限のあるメンバーで初期セットアップしてください。詳細: ${err?.message || String(err)}`,
            mountInfo,
            rootMeta,
          };
        }
      }
      let access = 'editor';
      let writeCheckPath = `_meldex/.preflight-${Date.now()}.json`;
      try {
        await this.writeJson(writeCheckPath, { ok: true, at: new Date().toISOString() });
        await this.deletePath(writeCheckPath);
      } catch (err) {
        access = 'viewer';
      }
      let vaultMeta = await this.readVaultMetadata();
      if (access === 'editor') {
        try {
          vaultMeta = await this.ensureVaultMetadataOwner(vaultMeta, account);
        } catch {}
      }
      let sourceRegistry = null;
      try {
        sourceRegistry = await _sourceRegistry()?.loadRegistry?.({ writeIfMissing: access === 'editor' });
      } catch {}
      const nextState = {
        kind: 'dropbox',
        name: mountInfo?.name || rootMeta.name || this.getVaultName(),
        path: vaultPath,
        access,
        shared: !!mountInfo,
        accountId: account?.account_id || '',
        accountName: account?.name?.display_name || account?.email || '',
        ownerId: vaultMeta?.ownerId || '',
        ownerName: vaultMeta?.ownerName || '',
        isOwner: this.isCurrentAccountVaultOwner(vaultMeta, account),
        sourceFolders: Array.isArray(sourceRegistry?.roots) ? sourceRegistry.roots.length : 0,
        cursorTopology: {
          vault: 'source-folder-registry',
          liveEvents: 'reserved-events-cursor',
        },
      };
      _runtime()?.setWorkspaceState?.(nextState);
      return {
        ok: true,
        mounted: true,
        access,
        mountInfo,
        account,
        vaultMeta,
        state: nextState,
      };
    }
  }

  const _providers = {
    dropbox: new DropboxStorageProvider(),
    legacy: null,
  };

  function _getLegacyProvider() {
    const ctor = window.MeldexStorageAdapter?.LocalFsStorageProvider;
    if (typeof ctor !== 'function') throw new Error('LocalFS storage provider が未読み込みです');
    if (!_providers.legacy || !(_providers.legacy instanceof ctor)) _providers.legacy = new ctor();
    return _providers.legacy;
  }

  function _activeProvider() {
    return _runtime()?.isDropboxMode?.() ? _providers.dropbox : _getLegacyProvider();
  }

  window.MeldexStorageAdapter = {
    DropboxStorageProvider,
    LocalFsStorageProvider: null,
    isSupported() {
      return _activeProvider().constructor.isSupported();
    },
    getProvider() {
      return _activeProvider();
    },
    async restoreWorkspace() {
      return _activeProvider().restoreWorkspace();
    },
    async clearWorkspace() {
      return _activeProvider().clearWorkspace();
    },
    async ensureWorkspacePermission(mode) {
      return _activeProvider().ensureWorkspacePermission(mode);
    },
    async describeWorkspace() {
      return _activeProvider().getWorkspaceInfo(true);
    },
    async preflight() {
      return _activeProvider().preflight();
    },
  };
})();
