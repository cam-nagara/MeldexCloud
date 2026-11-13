/* gb-data-access-dropbox-fileops move-route continuation. */
    if (pathname === '/outliner/move' && method === 'POST') {
      const provider = await _requirePwaProvider('readwrite');
      const sourcePath = _normalizeFolderPath(body?.path || '');
      const destFolder = _normalizeFolderPath(body?.dest_folder || '');
      _rejectProductionStructureMutation(sourcePath, '移動');
      if (window.MeldexProductionSchemaMigration?.isManagedEntryPath?.(sourcePath)) {
        throw new Error('制作管理の管理リストトピックの配置は変更できません');
      }
      const source = await _resolveEntryHandle(provider, sourcePath);
      const destEntry = await _resolveEntryHandle(provider, destFolder);
      if (!source) throw new Error('見つかりません');
      if (!destEntry || destEntry.kind !== 'directory') throw new Error(`移動先フォルダが見つかりません: ${destFolder}`);
      if (source.kind === 'directory' && (destFolder === sourcePath || destFolder.startsWith(sourcePath + '/'))) throw new Error('フォルダ自身の中には移動できません');
      await _rejectNonEntryIntoSheet(provider, destFolder, sourcePath, source.kind === 'directory');
      if (destFolder === _dirname(sourcePath)) {
        return {
          ok: true,
          unchanged: true,
          new_path: sourcePath,
          new_name: source.kind === 'file' ? _splitNameAndExt(_basename(sourcePath)).stem : _basename(sourcePath),
          file_id: _fnvFileId(sourcePath),
          relocate: { rewritten_count: 0, failed_count: 0, rewritten_paths: [], truncated: false },
        };
      }
      const conflict = await _moveConflictName(provider, destFolder, _basename(sourcePath), source.kind === 'file');
      const annotationPlan = await _prepareAnnotationsForPathMutation(provider, {
        action: 'move', oldPath: sourcePath, newPath: conflict.path,
        isFolder: source.kind === 'directory',
      });
      await _moveEntry(provider, sourcePath, conflict.path);
      const warnings = [];
      await _runPostMutationStep(warnings, 'version-history', () => _relocateVersionHistory(provider, sourcePath, conflict.path, source.kind === 'directory'));
      await _runPostMutationStep(warnings, 'csv-sidecars', () => (
        _relocateCsvSidecars(provider, sourcePath, conflict.path, source.kind === 'directory', false)
      ));
      await _runPostMutationStep(warnings, 'stored-paths', () => (
        typeof _rewriteStoredPathsForProvider === 'function'
          ? _rewriteStoredPathsForProvider(provider, sourcePath, conflict.path, source.kind === 'directory')
          : Promise.resolve(_rewriteStoredPaths(sourcePath, conflict.path, source.kind === 'directory'))
      ));
      await _runPathMutationHooksSafe({ action: 'move', oldPath: sourcePath, newPath: conflict.path, isFolder: source.kind === 'directory' }, warnings);
      await _runPostMutationStep(warnings, 'annotations', () => _updateAnnotationsForPathMutation(provider, {
        action: 'move', oldPath: sourcePath, newPath: conflict.path,
        isFolder: source.kind === 'directory', annotationPlan,
      }));
      let relocate = { rewritten_count: 0, failed_count: 0, rewritten_paths: [], truncated: false };
      await _runPostMutationStep(warnings, 'references', async () => {
        relocate = await _relocateReferences(provider, sourcePath, conflict.path, source.kind === 'directory');
      });
      return {
        ok: true,
        new_path: conflict.path,
        new_name: source.kind === 'file' ? _splitNameAndExt(_basename(conflict.path)).stem : _basename(conflict.path),
        file_id: _fnvFileId(conflict.path),
        relocate,
        ..._resultWarnings(warnings),
      };
    }

    // 一括改名の物理移動はproviderがまとめて行い、副作用はこの同一操作IDの
    // aftercareへ集約する。単件/outliner/moveをファイル数分呼ばない。
    if (!window.MeldexCloudBatchRenameAftercare) {
      window.MeldexCloudBatchRenameAftercare = {
        async prepare({ provider, entries, direction }) {
          const plans = new Map();
          for (const entry of entries || []) {
            const oldPath = direction === 'reverse' ? entry.destination : entry.source;
            const newPath = direction === 'reverse' ? entry.source : entry.destination;
            const annotationPlan = await _prepareAnnotationsForPathMutation(provider, {
              action: 'rename', oldPath, newPath, isFolder: false,
            });
            plans.set(oldPath, annotationPlan);
          }
          return plans;
        },
        async apply({ provider, entries, operationId, direction, prepared }) {
          const warnings = [];
          const mappings = (entries || []).map(entry => ({
            oldPath: direction === 'reverse' ? entry.destination : entry.source,
            newPath: direction === 'reverse' ? entry.source : entry.destination,
            isFolder: false,
          }));
          await _runPostMutationStep(warnings, 'version-history', async () => {
            if (!mappings.length) return;
            await _awaitPendingEditFinalizations();
            const kind = window.MeldexSystemStorage.SystemStorageKind.VERSIONS;
            const adapter = await _managementAdapterForProvider(provider, kind, mappings[0].oldPath);
            const records = await adapter.listDocuments(kind);
            for (const record of records) {
              const current = _normalizeFolderPath(record?.payload?.original_relative_path || '');
              const mapping = mappings.find(row => row.oldPath === current);
              if (!mapping) continue;
              await adapter.save(kind, record.documentId, { ...record.payload, original_relative_path: mapping.newPath }, { expectedRevision: record.revision });
            }
          });
          await _runPostMutationStep(warnings, 'stored-paths', () => (
            typeof _rewriteStoredPathsBatchForProvider === 'function'
              ? _rewriteStoredPathsBatchForProvider(provider, mappings)
              : Promise.all(mappings.map(row => _rewriteStoredPathsForProvider(provider, row.oldPath, row.newPath, false)))
          ));
          for (const entry of entries || []) {
            const oldPath = direction === 'reverse' ? entry.destination : entry.source;
            const newPath = direction === 'reverse' ? entry.source : entry.destination;
            await _runPostMutationStep(warnings, 'csv-sidecars', () => _relocateCsvSidecars(provider, oldPath, newPath, false, false));
            await _runPathMutationHooksSafe({ action: 'rename', oldPath, newPath, isFolder: false, operationId }, warnings);
            await _runPostMutationStep(warnings, 'annotations', () => _updateAnnotationsForPathMutation(provider, {
              action: 'rename', oldPath, newPath, isFolder: false,
              annotationPlan: prepared?.get?.(oldPath),
            }));
          }
          let relocate = { rewritten_count: 0, failed_count: 0, rewritten_paths: [], truncated: false };
          await _runPostMutationStep(warnings, 'references', async () => {
            relocate = typeof _relocateReferencesBatch === 'function'
              ? await _relocateReferencesBatch(provider, mappings)
              : await _relocateReferences(provider, mappings[0]?.oldPath, mappings[0]?.newPath, false);
          });
          for (const mapping of mappings) {
            window.MeldexDocumentSaveCoordinator?.rebindDocumentPathPrefix?.(mapping.oldPath, mapping.newPath);
          }
          window.dispatchEvent(new CustomEvent('meldex:batch-paths-renamed', {
            detail: { operationId, direction, entries: (entries || []).map(entry => ({ source: entry.source, destination: entry.destination })) },
          }));
          return { ok: warnings.length === 0, warnings, relocate };
        },
      };
    }
    if (pathname === '/outliner/batch-rename-aftercare' && method === 'POST') {
      const provider = await _requirePwaProvider('readwrite');
      const entries = Array.isArray(body?.entries) ? body.entries : [];
      if (!entries.length || entries.length > 10000) throw new Error('一括変更mapが不正です');
      const operationId = String(body?.operation_id || '');
      if (!/^[a-f0-9]{32}$/.test(operationId)) throw new Error('一括変更の操作IDが不正です');
      const direction = body?.direction === 'reverse' ? 'reverse' : 'forward';
      if (body?.phase === 'prepare') {
        const token = await window.MeldexCloudBatchRenameAftercare.prepare({ provider, entries, operationId, direction });
        // 同一タブ内だけで物理移動直後まで保持する。永続化すべき計画・状態は
        // typed journal側が正本で、アノテートのCAS読取結果は短命である。
        window.__MeldexBatchRenameAftercareTokens ||= new Map();
        window.__MeldexBatchRenameAftercareTokens.set(operationId + ':' + direction, token);
        return { ok: true, token: operationId + ':' + direction };
      }
      if (body?.phase === 'apply') {
        const key = operationId + ':' + direction;
        const prepared = window.__MeldexBatchRenameAftercareTokens?.get?.(key) || null;
        window.__MeldexBatchRenameAftercareTokens?.delete?.(key);
        return window.MeldexCloudBatchRenameAftercare.apply({ provider, entries, operationId, direction, prepared });
      }
      throw new Error('一括変更aftercareの段階が不正です');
    }
