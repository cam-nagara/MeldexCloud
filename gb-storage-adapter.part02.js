        } catch (err) {
          return {
            ok: false,
            mounted: true,
            access: 'viewer',
            message: `共有ワークスペースのMeldex管理データを初期化できません。編集権限のあるメンバーで初期セットアップしてください。詳細: ${err?.message || String(err)}`,
            mountInfo,
            rootMeta,
          };
        }
      }
      let access = 'editor';
      try {
        const resolver = window.MeldexDropboxManagementRootResolver;
        const kind = window.MeldexSystemStorage?.SystemStorageKind?.DIAGNOSTICS;
        if (!resolver?.resolveTypedAdapterForProvider || !kind) {
          throw new Error('Meldex管理データの保存先を安全に判定できません');
        }
        const adapter = await resolver.resolveTypedAdapterForProvider(this, kind);
        const documentId = `preflight-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
        await adapter.save(kind, documentId, { ok: true, at: new Date().toISOString() }, {
          expectedRevision: null,
        });
        await adapter.delete(kind, documentId);
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
    browser: null,
    legacy: null,
  };

  function _getBrowserProvider() {
    const ctor = window.MeldexStorageAdapter?.BrowserStorageProvider;
    if (typeof ctor !== 'function') throw new Error('ブラウザ内ストレージが未読み込みです');
    if (!_providers.browser || !(_providers.browser instanceof ctor)) _providers.browser = new ctor();
    return _providers.browser;
  }

  function _getLegacyProvider() {
    const ctor = window.MeldexStorageAdapter?.LocalFsStorageProvider;
    if (typeof ctor !== 'function') throw new Error('LocalFS storage provider が未読み込みです');
    if (!_providers.legacy || !(_providers.legacy instanceof ctor)) _providers.legacy = new ctor();
    return _providers.legacy;
  }

  function _activeProvider() {
    if (_runtime()?.isDropboxMode?.()) return _providers.dropbox;
    if (_runtime()?.isBrowserMode?.()) return _getBrowserProvider();
    return _getLegacyProvider();
  }

  window.MeldexStorageAdapter = {
    DropboxStorageProvider,
    BrowserStorageProvider: null,
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
