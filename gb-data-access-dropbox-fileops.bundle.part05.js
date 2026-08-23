
    if (pathname === '/upload-file' && method === 'POST') {
      const provider = await _requirePwaProvider('readwrite');
      const imageAftercare = window.MeldexCreatedImageIdentityAftercare;
      if (!imageAftercare?.prepare || !imageAftercare?.record
          || !imageAftercare?.cancel || !imageAftercare?.drainPrepared) {
        throw new Error('Cloud画像identity aftercareが読み込まれていません');
      }
      const drainedIdentity = await imageAftercare.drainPrepared(provider);
      const targetDir = _normalizeFolderPath(url.searchParams.get('path') || body?.dir || '');
      const rawName = String(body?.filename || body?.name || 'file').split(/[\\/]/).pop();
      const fileName = _validateItemName(rawName || 'file', 'filename');
      const split = _splitNameAndExt(fileName);
      let targetName = fileName;
      let targetPath = _joinPath(targetDir, targetName);
      for (let counter = 1; await _pathExists(provider, targetPath); counter += 1) {
        targetName = `${split.stem}_${counter}${split.ext}`;
        targetPath = _joinPath(targetDir, targetName);
      }
      if (_isProductionFolderNotePath(targetPath)) {
        throw new Error('制作管理の列定義ファイルは汎用アップロードから変更できません');
      }
      const uploadBytes = _decodeUploadData(body?.data || '');
      if (_productionReservedEntryProperties(targetPath).length && /\.md$/i.test(targetPath)) {
        _rejectProductionLegacyEntryContent(targetPath, new TextDecoder().decode(uploadBytes));
      }
      let identity = null;
      if (/\.(?:apng|jpe?g|png|webp)$/i.test(targetPath)) {
        const prepared = await imageAftercare.prepare(provider, targetPath, uploadBytes, {
          source: 'upload-file', filename: targetName,
        });
        if (prepared.publish_required) {
          try {
            await _writeBytes(provider, targetPath, uploadBytes);
          } catch (error) {
            await imageAftercare.cancel(provider, prepared, error?.message).catch(console.warn);
            throw error;
          }
        }
        identity = await imageAftercare.record(
          provider, targetPath, uploadBytes, { source: 'upload-file', prepared },
        );
      } else {
        await _writeBytes(provider, targetPath, uploadBytes);
      }
      return {
        ok: true, path: targetPath, name: targetName,
        aftercare_pending: !!identity?.aftercare_pending || drainedIdentity.blocked > 0,
      };
    }

    if (pathname === '/file-meta' && method === 'GET') {
      const provider = await _requirePwaProvider('read');
      const targetPath = _normalizeFolderPath(url.searchParams.get('path') || '');
      const entry = await _resolveEntryHandle(provider, targetPath);
      if (!entry) throw new Error(`ファイルまたはフォルダが見つかりません: ${targetPath}`);
      if (entry.kind === 'directory') {
        const directoryStats = typeof provider.statPath === 'function'
          ? await provider.statPath(targetPath).catch(() => null)
          : null;
        return {
          created: directoryStats?.created || directoryStats?.modified || '',
          modified: directoryStats?.modified || '',
          kind: 'folder',
        };
      }
      const stats = await _fileStats(entry.handle);
      return {
        created: stats.modified,
        modified: stats.modified,
        size: stats.size,
        kind: 'file',
      };
    }

    if (pathname === '/folder-links' && method === 'GET') {
      const provider = await _requirePwaProvider('read');
      let folderPath = _normalizeFolderPath(url.searchParams.get('folder') || '');
      const folderId = String(url.searchParams.get('folder_id') || '').trim();
      if (!folderPath && folderId) folderPath = await _findPathByFileId(provider, folderId);
      const result = [];
      for (const link of (await _folderLinksForProvider(provider)).filter((row) => (folderId ? row.folder_id === folderId : row.folder_path === folderPath))) {
        result.push({
          file_id: link.file_id,
          path: link.path,
          name: _displayLabelForPath(link.path, ''),
          exists: !!(await _resolveEntryHandle(provider, link.path)),
          linked: true,
          link_folder_path: link.folder_path || folderPath,
        });
      }
      return result;
    }

    const folderLinkRoute = internals._handleFolderLinkBatchRoute;
    const folderLinkBatchResult = typeof folderLinkRoute === 'function'
      ? await folderLinkRoute(pathname, method, body) : undefined;
    if (folderLinkBatchResult !== undefined) return folderLinkBatchResult;

    if (pathname === '/folder-links/add' && method === 'POST') {
      const filePath = _normalizeFolderPath(body?.file_path || '');
      if (typeof folderLinkRoute !== 'function') throw new Error('フォルダリンク一括処理を利用できません');
      const batch = await folderLinkRoute('/folder-links/batch/add', 'POST', {
        ...body,
        items: [{ file_path: filePath }],
        request_id: String(body?.request_id || `single-add-${Date.now()}-${Math.random()}`),
      });
      const row = batch.results[0];
      if (row?.status === 'failed') throw new Error(row.error || 'リンク登録に失敗しました');
      return { ok: true, file_id: row.file_id, folder_path: row.folder_path, folder_id: row.folder_id, created: row.status === 'created' };
    }

    if (pathname === '/folder-links/remove' && method === 'POST') {
      const fileId = String(body?.file_id || '').trim();
      if (typeof folderLinkRoute !== 'function') throw new Error('フォルダリンク一括処理を利用できません');
      const batch = await folderLinkRoute('/folder-links/batch/remove', 'POST', {
        ...body,
        items: [{ file_id: fileId, file_path: _normalizeFolderPath(body?.file_path || '') }],
        request_id: String(body?.request_id || `single-remove-${Date.now()}-${Math.random()}`),
      });
      const row = batch.results[0];
      if (row?.status === 'failed') throw new Error(row.error || 'リンク解除に失敗しました');
      return { ok: true, removed: row.status === 'removed' };
    }

    if (pathname === '/file-folders' && method === 'GET') {
      const filePath = _normalizeFolderPath(url.searchParams.get('path') || '');
      const result = [];
      const physical = _dirname(filePath);
      if (physical) result.push({ folder: physical, type: 'physical' });
      const fileId = filePath ? _fnvFileId(filePath) : '';
      const provider = await _requirePwaProvider('read');
      (await _folderLinksForProvider(provider)).filter((link) => link.file_id === fileId).forEach((link) => {
        result.push({ folder: link.folder_path, type: 'link', file_id: fileId, added_at: link.added_at || '' });
      });
      return result;
    }

    if (pathname === '/backlinks' && method === 'GET' && url.searchParams.get('target')) {
      const provider = await _requirePwaProvider('read');
      return _queryBacklinks(provider, url.searchParams.get('target') || '');
    }

    if (pathname === '/backlinks/rebuild' && method === 'POST') return { ok: true, mode: 'live-scan' };
    if (pathname === '/backlinks/update' && method === 'POST') {
      const normalizedPath = _normalizeFolderPath(body?.path || '');
      if (!normalizedPath) return { ok: false, error: 'path required' };
      return { ok: true, path: normalizedPath };
    }

    if (pathname === '/references/delete-impact' && method === 'POST') {
      // ファイル参照整合性・削除警告・全ファイルバックリンク実装計画 Phase 4:
      // 削除確認ダイアログの被参照警告(gb-delete-impact-warning.js)向け。
      // Desktop側 /api/references/delete-impact の Cloud（Dropbox直結）等価。
      const provider = await _requirePwaProvider('read');
      const items = Array.isArray(body?.items) ? body.items : [];
      const gate = window.MeldexCloudDeleteConfirmation;
      if (!gate?.prepareProviderDelete) {
        const error = new Error('削除確認の永続ストレージを利用できません');
        error.status = 503;
        throw error;
      }
      return gate.prepareProviderDelete({
        provider, items, operation: body?.operation,
        queryImpact: (currentProvider, currentItems) => _queryDeleteImpact(currentProvider, currentItems),
      });
    }

    if (pathname === '/annotations' && method === 'GET') {
      const provider = await _requirePwaProvider('read');
      const targetPath = _normalizeFolderPath(url.searchParams.get('target') || '');
      const targetId = String(url.searchParams.get('target_id') || '').trim();
      const annId = String(url.searchParams.get('ann_id') || '').trim();
      const user = String(url.searchParams.get('user') || '').trim();
      const annType = String(url.searchParams.get('ann_type') || '').trim();
      const limitValue = Number(url.searchParams.get('limit') || 200);
      const limit = Number.isFinite(limitValue) ? Math.floor(limitValue) : 200;
      let rows = (await _listAnnotationRecords(provider, {
        annId, targetId, targetPath, user, annType, limit, bulk: true,
      })).map(_annotationRow);
      if (annId) rows = rows.filter(row => String(row.id || '') === annId);
      else if (targetId) rows = rows.filter(row => String(row.target_id || '') === targetId);
      else if (targetPath) rows = rows.filter(row => _normalizeFolderPath(row.target_path || '') === targetPath);
      if (user) rows = rows.filter(row => String(row.user || '') === user);
      if (annType) rows = rows.filter(row => String(row.type || '') === annType);
      rows.sort((a, b) => String(b.created || '').localeCompare(String(a.created || '')));
      return limit > 0 ? rows.slice(0, limit) : rows;
    }
    if (pathname === '/annotations' && method === 'POST') {
      const provider = await _requirePwaProvider('readwrite');
      const now = _nowIso();
      const record = _mergeAnnotationRecord(null, body || {}, { id: _randomId('ann'), now });
      await _writeAnnotationRecord(provider, record);
      return { ok: true, id: record.id, created: record.created };
    }
    if (pathname === '/annotations/restore' && method === 'POST') {
      const provider = await _requirePwaProvider('readwrite');
      const id = body?.id ? _safeId(body.id, 'annotation id') : _randomId('ann');
      const existing = await _readAnnotationRecord(provider, id, body?.target_path || '');
      const record = _mergeAnnotationRecord(existing, { ...(body || {}), id }, { id, now: _nowIso() });
      if (body?.created) {
        record.created = body.created;
        record.created_at = body.created_at || body.created;
      }
      if (body?.modified) {
        record.modified = body.modified;
        record.modified_at = body.modified_at || body.modified;
      }
      await _writeAnnotationRecord(provider, record);
      return { ok: true, id: record.id };
    }
    if (pathname === '/annotations/orphan-by-target' && method === 'POST') {
      const provider = await _requirePwaProvider('readwrite');
      const now = _nowIso();
      const targetFileName = _basename(body?.target_file || '');
      const cascade = !!body?.cascade_container;
      let directCount = 0;
      let cascadeCount = 0;
      const records = await _listAnnotationRecords(provider);
      for (const record of records) {
        const matchedWithoutCascade = _annotationMatchesOrphan(record, body || {}, false);
        const matchedWithCascade = !matchedWithoutCascade && _annotationMatchesOrphan(record, body || {}, cascade);
        if (!matchedWithoutCascade && !matchedWithCascade) continue;
        record.orphan = 1;
        record.orphaned_at = now;
        record.target_file_name = targetFileName;
        if (body?.target_snapshot && !record.target_snapshot) record.target_snapshot = body.target_snapshot;
        record.modified = now;
        record.modified_at = now;
        if (matchedWithoutCascade) directCount += 1;
        else cascadeCount += 1;
        await _writeAnnotationRecord(provider, record);
      }
      return { ok: true, orphaned: directCount, cascade_orphaned: cascadeCount };
    }
    if (pathname === '/annotation/screenshot' && method === 'POST') {
      const provider = await _requirePwaProvider('readwrite');
      const imageAftercare = window.MeldexCreatedImageIdentityAftercare;
      if (!imageAftercare?.prepare || !imageAftercare?.record
          || !imageAftercare?.cancel || !imageAftercare?.drainPrepared) {
        throw new Error('Cloud画像identity aftercareが読み込まれていません');
      }
      const drainedIdentity = await imageAftercare.drainPrepared(provider);
      const dataUrl = String(body?.data || '');
      if (!dataUrl) throw new Error('data は必須です');
      const ts = _versionTimestamp();
      const configuredFolder = String(body?.target_path || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
      const targetPath = _joinPath(configuredFolder || 'スクリーンショット', `screenshot_${ts}.png`);
      const screenshotBytes = _decodeUploadData(dataUrl);
      const sourceTarget = String(body?.source_target || body?.sourceTarget || '').trim();
      const annotationTarget = sourceTarget || targetPath;
      // 注釈recordはbytes publish前に確定させ、identity claimと同じ
      // prepare済みintentへ連動書込みとして持たせる(固有形式付随物廃止・
      // 管理データ一元化計画 §10.1)。これにより注釈書込みの失敗も
      // aftercare_pending化され、identity claimと同じdrain/復帰対象になる。
      const annRecord = _mergeAnnotationRecord(null, {
        type: 'screenshot',
        target_path: annotationTarget,
        user: (typeof _currentUserName !== 'undefined' && _currentUserName) ? _currentUserName : 'local',
        data: {
          path: targetPath,
          mode: String(body?.mode || ''),
          width: body?.width || null,
          height: body?.height || null,
          source_file: sourceTarget ? _basename(sourceTarget) : null,
        },
      }, { id: _randomId('ann'), now: _nowIso() });
      const prepared = await imageAftercare.prepare(provider, targetPath, screenshotBytes, {
        source: 'annotation-screenshot', filename: _basename(targetPath),
        linkedWrite: { kind: 'annotation-record', payload: annRecord },
      });
      if (prepared.publish_required) {
        try {
          await _writeBytes(provider, targetPath, screenshotBytes);
        } catch (error) {
          await imageAftercare.cancel(provider, prepared, error?.message).catch(console.warn);
          throw error;
        }
      }
      const identity = await imageAftercare.record(
        provider, targetPath, screenshotBytes, { source: 'annotation-screenshot', prepared },
      );
      return {
        ok: true, path: targetPath,
        id: annRecord.id, annotation_id: annRecord.id,
        aftercare_pending: !!identity.aftercare_pending || drainedIdentity.blocked > 0,
      };
    }
    if (/^\/annotations\/[^/]+$/.test(pathname) && method === 'PUT') {
      const provider = await _requirePwaProvider('readwrite');
      const id = _safeId(pathname.split('/').pop(), 'annotation id');
      const existing = await _readAnnotationRecord(provider, id);
      if (!existing) throw new Error('注釈が見つかりません');
      const updateBody = {};
      ANNOTATION_UPDATE_KEYS.forEach((key) => {
        if (Object.prototype.hasOwnProperty.call(body || {}, key)) updateBody[key] = body[key];
      });
      const record = _mergeAnnotationRecord(existing, updateBody, { id, now: _nowIso() });
      await _writeAnnotationRecord(provider, record);
      return { ok: true };
    }
    if (/^\/annotations\/[^/]+$/.test(pathname) && method === 'DELETE') {
      const provider = await _requirePwaProvider('readwrite');
      const id = _safeId(pathname.split('/').pop(), 'annotation id');
      await _deleteAnnotationRecordFully(provider, id);
      return { ok: true };
    }

    if (pathname === '/view-lock' && method === 'GET') {
      const provider = await _requirePwaProvider('read');
      const viewKey = String(url.searchParams.get('view_key') || '').trim();
      if (!viewKey) throw new Error('view_key required');
      return _readViewLockRecord(provider, viewKey);
    }
    if (pathname === '/view-lock' && method === 'PUT') {
      const provider = await _requirePwaProvider('readwrite');
      const viewKey = String(body?.view_key || '').trim();
      if (!viewKey) throw new Error('view_key required');
      const locked = _annotationFlag(body?.locked);
      const entry = {
        view_key: viewKey,
        target_path: _normalizeFolderPath(body?.target_path || ''),
        pane_id: String(body?.pane_id || ''),
        target_kind: String(body?.target_kind || ''),
        locked,
        state: body?.state && typeof body.state === 'object' ? body.state : {},
        locked_at: locked ? _nowIso() : '',
        locked_by: String(body?.locked_by || ''),
      };
      await _writeViewLockRecord(provider, viewKey, entry);
      return { ok: true, view_key: viewKey, locked };
    }

    if (/^\/version\/(list-db|read-db|save-db|restore-db)/.test(pathname)) return _phaseUnsupported('シート履歴', 'Phase 4');
    if (pathname === '/version/list-folder' && method === 'GET') {
      const provider = await _requirePwaProvider('read');
      return _listFolderVersions(provider, url.searchParams.get('path') || '');
    }
    if (pathname === '/version/read-folder' && method === 'GET') {
      const provider = await _requirePwaProvider('read');
      return _readFolderVersion(provider, url.searchParams.get('path') || '', url.searchParams.get('version') || '');
    }
    if (pathname === '/version/read-folder-file' && method === 'GET') {
      const provider = await _requirePwaProvider('read');
      return _readFolderVersionFile(provider, url.searchParams.get('path') || '', url.searchParams.get('version') || '', url.searchParams.get('file') || '');
    }
    if (pathname === '/version/save-folder' && method === 'POST') {
      const provider = await _requirePwaProvider('readwrite');
      const actor = _versionActor(url, body);
      return _saveFolderVersion(provider, body?.path || '', {
        label: body?.label || '', auto: !!body?.auto,
        metadata: _snapshotActorMetadata(actor, actor, body?.auto ? 'periodic_auto' : 'manual', '', null, ''),
      });
    }
    if (pathname === '/version/restore-folder' && method === 'POST') {
      const provider = await _requirePwaProvider('readwrite');
      return _restoreFolderVersion(provider, body?.path || '', body?.version || '');
    }
    if (pathname === '/version/delete-folder' && method === 'POST') {
      const provider = await _requirePwaProvider('readwrite');
      return _deleteFolderVersion(provider, body?.path || '', body?.version || '');
    }
    if (pathname === '/version/undelete-folder' && method === 'POST') {
      const provider = await _requirePwaProvider('readwrite');
      return _undeleteFolderVersion(provider, body?.path || '', body?.token || '');
    }
    if (pathname === '/version/list' && method === 'GET') {
      const provider = await _requirePwaProvider('read');
      return _listFileVersions(provider, url.searchParams.get('path') || '');
    }
    if (pathname === '/version/read' && method === 'GET') {
      const provider = await _requirePwaProvider('read');
      return _readFileVersion(provider, url.searchParams.get('path') || '', url.searchParams.get('version') || '');
    }
    if (pathname === '/version/save' && method === 'POST') {
      const provider = await _requirePwaProvider('readwrite');
      const actor = _versionActor(url, body);
      return _saveFileVersion(provider, body?.path || '', {
        label: body?.label || '', auto: !!body?.auto, max_auto: body?.max_auto,
        metadata: _snapshotActorMetadata(actor, actor, body?.auto ? 'periodic_auto' : 'manual', '', null, ''),
      });
    }
    if (pathname === '/version-panel/timeline' && method === 'GET') {
      const provider = await _requirePwaProvider('read');
      return _buildCloudVersionTimeline(provider, url);
    }
    if (pathname === '/version/restore' && method === 'POST') {
      const provider = await _requirePwaProvider('readwrite');
      return _restoreFileVersion(provider, body?.path || '', body?.version || '');
    }
    if (pathname === '/version/delete' && method === 'POST') {
      const provider = await _requirePwaProvider('readwrite');
      return _deleteFileVersion(provider, body?.path || '', body?.version || '');
    }
    if (pathname === '/version/undelete' && method === 'POST') {
      const provider = await _requirePwaProvider('readwrite');
      return _undeleteFileVersion(provider, body?.path || '', body?.token || '');
    }

    if (/^\/cal(\/|$)/.test(pathname)) {
      if (method === 'GET') {
        if (pathname === '/cal/sync/status') return { enabled: false, configured: false, unsupported: true };
        return [];
      }
      return _phaseUnsupported('カレンダー', 'Phase 3');
    }
    if (/^\/calendar-db(\/|$)/.test(pathname)) {
      if (method === 'GET') return [];
      return _phaseUnsupported('カレンダー', 'Phase 3');
    }
    if (/^\/chat\/(list|search)/.test(pathname) && method === 'GET') return [];
    if (pathname === '/chat/load' && method === 'GET') return { messages: [], title: '', unsupported: true };
    if (pathname === '/chat/save' && method === 'POST') return _phaseUnsupported('チャット', 'Phase 3');
    if (pathname === '/chat/stream' && method === 'POST') return _phaseUnsupported('チャット', 'Phase 3');
    if (/^\/collab\/(rooms|messages)/.test(pathname) && method === 'GET') return [];
    if (/^\/collab\//.test(pathname)) return _phaseUnsupported('チャット', 'Phase 3');

    if (pathname === '/outliner/add' && method === 'POST') {
      const provider = await _requirePwaProvider('readwrite');
      const parent = _normalizeFolderPath(body?.parent || '');
      const label = _validateItemName(body?.label || '無題', 'label');
      const type = String(body?.type || '');
      const blockedCreate = {
        database: ['シート', 'Phase 4'],
        calendar: ['カレンダー', 'Phase 3'],
        'smart-db': ['スマートシート', 'Phase 4'],
      }[type];
      if (blockedCreate) throw new Error(_phaseUnsupported(blockedCreate[0], blockedCreate[1]).error);
      if (type === 'folder') {
        const labelName = await _uniqueName(provider, parent, label, '');
        const targetPath = _joinPath(parent, labelName);
        await _directoryHandle(provider, targetPath, true);
        return { ok: true, node: { type: 'folder', label: labelName, path: targetPath, children: [] } };
      }
      if (type === 'page') {
        const labelName = await _uniqueName(provider, parent, label, '.md');
        const targetPath = _joinPath(parent, labelName + '.md');
        await provider.writeText(targetPath, `# ${labelName}\n\n`);
        return { ok: true, node: { type: 'page', label: labelName, path: targetPath } };
      }
      if (type === 'database') {
        const labelName = await _uniqueName(provider, parent, label, '');
        const targetPath = _joinPath(parent, labelName);
        await _directoryHandle(provider, targetPath, true);
        await provider.writeText(_joinPath(targetPath, labelName + '.md'), `# ${labelName}\n\n`);
        return { ok: true, node: { type: _phase1SurfaceType('database', 'directory'), label: labelName, path: targetPath } };
      }
      if (type === 'scriptnote') {
        const labelName = await _uniqueName(provider, parent, label, '.scriptnote.json');
        const targetPath = _joinPath(parent, labelName + '.scriptnote.json');
        await provider.writeJson(targetPath, {
          fileType: 'meldex-scriptnote',
          schema_version: 3,
          version: 1,
          title: labelName,
          layoutMode: 'manga',
          editor: { viewMode: 'horizontal', wrapMode: true, textWidth: 20, lineHeight: 1.5, letterSpacing: 0.02, fontH: '', fontV: '', colors: null },
          scenarioTypes: [],
          characters: [],
          characterDb: [],
          notes: [],
          rows: [],
          source: { importedFrom: '', modeName: 'マンガ縦書き' },
        });
        return { ok: true, node: { type: 'scriptnote', label: labelName, path: targetPath } };
      }
      if (type === 'board') {
        const labelName = await _uniqueName(provider, parent, label, '.mel-board');
        const targetPath = _joinPath(parent, labelName + '.mel-board');
        let boardContent = `---\ntype: board\nxmind:\n  n0: {autoStyle: true}\n---\n# ${labelName}\n\n`;
        if (window.MeldexDocumentIdentity) boardContent = window.MeldexDocumentIdentity.ensureDocumentId(boardContent, 'board').text;
        await provider.writeText(targetPath, boardContent);
        return { ok: true, node: { type: _phase1SurfaceType('board', 'file'), label: labelName, path: targetPath } };
      }
      if (type === 'calendar') {
        const labelName = await _uniqueName(provider, parent, label, '');
        const targetPath = _joinPath(parent, labelName);
        await _directoryHandle(provider, targetPath, true);
        await provider.writeText(_joinPath(targetPath, labelName + '.md'), `---\ntype: calendar-db\n---\n# ${labelName}\n\n`);
        return { ok: true, node: { type: _phase1SurfaceType('calendar', 'directory'), label: labelName, path: targetPath } };
      }
      if (type === 'smart-db') {
        const labelName = await _uniqueName(provider, parent, label, '.json');
        const targetPath = _joinPath(parent, labelName + '.json');
        await provider.writeJson(targetPath, {
          type: 'smart-db',
          name: labelName,
          filters: [{ property: 'ステータス', field: 'value', operator: 'equals', value: '進行中' }],
          views: { table: {} },
          activeView: 'table',
          created: new Date().toISOString(),
        });
        return { ok: true, node: { type: _phase1SurfaceType('smart-db', 'file'), label: labelName, path: targetPath } };
      }
      throw new Error(`不正なタイプ: ${type}`);
    }

    if (pathname === '/outliner/rename' && method === 'POST') {
      const provider = await _requirePwaProvider('readwrite');
      const oldPath = _normalizeFolderPath(body?.old_path || '');
      _rejectProductionStructureMutation(oldPath, '名前変更');
      if (window.MeldexProductionSchemaMigration?.isManagedEntryPath?.(oldPath)) {
        throw new Error('制作管理の管理リスト名はシート上のトピック名から変更してください');
      }
      const newName = _validateItemName(body?.new_name || '', 'new_name');
      const source = await _resolveEntryHandle(provider, oldPath);
      if (!source) throw new Error(`見つかりません: ${oldPath}`);
      const parentPath = _dirname(oldPath);
      const sourceName = _basename(oldPath);
      if (source.kind === 'directory') {
        const newPath = _joinPath(parentPath, newName);
        if (newPath !== oldPath && await _pathExists(provider, newPath)) throw new Error(`既に存在: ${newName}`);
        const annotationPlan = newPath !== oldPath
          ? await _prepareAnnotationsForPathMutation(provider, {
            action: 'rename', oldPath, newPath, isFolder: true,
          }) : [];
        const warnings = [];
        if (newPath !== oldPath) {
          await _moveEntry(provider, oldPath, newPath);
          await _runPostMutationStep(warnings, 'version-history', () => _relocateVersionHistory(provider, oldPath, newPath, true));
          await _runPostMutationStep(warnings, 'csv-sidecars', () => (
            _relocateCsvSidecars(provider, oldPath, newPath, true, false)
          ));
        }
        const oldNotePath = _joinPath(newPath, sourceName + '.md');
        const newNotePath = _joinPath(newPath, newName + '.md');
        if (await _pathExists(provider, oldNotePath) && !await _pathExists(provider, newNotePath)) {
          await _moveEntry(provider, oldNotePath, newNotePath);
          await _runPostMutationStep(warnings, 'folder-note-version-history', () => _relocateVersionHistory(provider, _joinPath(oldPath, sourceName + '.md'), newNotePath, false));
        }
        await _runPostMutationStep(warnings, 'stored-paths', () => (
          typeof _rewriteStoredPathsForProvider === 'function'
            ? _rewriteStoredPathsForProvider(provider, oldPath, newPath, true)
            : Promise.resolve(_rewriteStoredPaths(oldPath, newPath, true))
        ));
        await _runPathMutationHooksSafe({ action: 'rename', oldPath, newPath, isFolder: true }, warnings);
        await _updateAnnotationsForPathMutation(provider, {
          action: 'rename', oldPath, newPath, isFolder: true, annotationPlan,
        });
        let relocate = { rewritten_count: 0, failed_count: 0, rewritten_paths: [], truncated: false };
        await _runPostMutationStep(warnings, 'references', async () => {
          relocate = await _relocateReferences(provider, oldPath, newPath, true);
        });
        return { ok: true, new_path: newPath, file_id: _fnvFileId(newPath), relocate, ..._resultWarnings(warnings) };
      }
      const split = _splitNameAndExt(sourceName);
      const nextPath = _joinPath(parentPath, newName + split.ext);
      if (nextPath !== oldPath && await _pathExists(provider, nextPath)) throw new Error(`既に存在: ${newName + split.ext}`);
      const annotationPlan = nextPath !== oldPath
        ? await _prepareAnnotationsForPathMutation(provider, {
          action: 'rename', oldPath, newPath: nextPath, isFolder: false,
        }) : [];
      if (split.ext === '.md' && String(body?.type || '') === 'page') {
        const original = await provider.readText(oldPath);
        await provider.writeText(oldPath, original.replace(/^# .+/m, '# ' + newName));
      }
      if (nextPath !== oldPath) {
        await _moveEntry(provider, oldPath, nextPath);
      }
      const warnings = [];
      await _runPostMutationStep(warnings, 'version-history', () => _relocateVersionHistory(provider, oldPath, nextPath, false));
      await _runPostMutationStep(warnings, 'csv-sidecar', () => (
        _relocateCsvSidecars(provider, oldPath, nextPath, false, false)
      ));
      await _runPostMutationStep(warnings, 'stored-paths', () => (
        typeof _rewriteStoredPathsForProvider === 'function'
          ? _rewriteStoredPathsForProvider(provider, oldPath, nextPath, false)
          : Promise.resolve(_rewriteStoredPaths(oldPath, nextPath, false))
      ));
      await _runPathMutationHooksSafe({ action: 'rename', oldPath, newPath: nextPath, isFolder: false }, warnings);
      await _updateAnnotationsForPathMutation(provider, {
        action: 'rename', oldPath, newPath: nextPath, isFolder: false, annotationPlan,
      });
      let relocate = { rewritten_count: 0, failed_count: 0, rewritten_paths: [], truncated: false };
      await _runPostMutationStep(warnings, 'references', async () => {
        relocate = await _relocateReferences(provider, oldPath, nextPath, false);
      });
      return { ok: true, new_path: nextPath, file_id: _fnvFileId(nextPath), relocate, ..._resultWarnings(warnings) };
    }

    if (pathname === '/outliner/delete' && method === 'POST') {
      const provider = await _requirePwaProvider('readwrite');
      _rejectProductionStructureMutation(body?.path || '', '削除');
      const confirmationItem = {
        path: body?.path || '', kind: body?.kind === 'folder' ? 'folder' : 'file',
      };
      const consumed = await _consumeCloudDeleteConfirmation(provider, body, [confirmationItem], 'trash');
      return _deleteOutlinerPathToTrash(provider, body?.path || '', {
        item: confirmationItem, receipt: consumed.receipt,
        queryImpact: (_provider, targetItems) => _queryDeleteImpact(_provider, targetItems),
      });
    }

    if (pathname === '/outliner/delete-batch' && method === 'POST') {
      const provider = await _requirePwaProvider('readwrite');
      const items = Array.isArray(body?.items) ? body.items : [];
      for (const item of items) _rejectProductionStructureMutation(item?.path || '', '削除');
      const confirmationItems = items.map(item => ({
        path: item?.path || '', kind: item?.kind === 'folder' ? 'folder' : 'file',
      }));
      const consumed = await _consumeCloudDeleteConfirmation(provider, body, confirmationItems, 'trash');
      const results = [];
      for (const item of confirmationItems) {
        try {
          results.push({ ok: true, value: await _deleteOutlinerPathToTrash(provider, item.path, {
            item, receipt: consumed.receipt,
            queryImpact: (_provider, targetItems) => _queryDeleteImpact(_provider, targetItems),
          }) });
        } catch (error) {
          results.push({ ok: false, error: error?.message || String(error) });
        }
      }
      return { ok: true, results };
    }

    if (pathname === '/outliner/restore' && method === 'POST') {
      const provider = await _requirePwaProvider('readwrite');
      const trashName = _validateItemName(body?.trash_name || '', 'trash_name');
      const trashRoot = await _resolveAllowedTrashRoot(body?.trash_root);
      const trashPath = _joinPath(trashRoot.path, trashName);
      const metaPath = trashPath + '._trash_meta.json';
      const source = await _resolveEntryHandle(provider, trashPath);
      if (!source) throw new Error(`ゴミ箱にありません: ${trashName}`);
      const meta = await _readJsonSafe(provider, metaPath, {});
      const originalPath = await _resolveValidatedTrashRestorePath(trashRoot, meta?.original_path || '');
      if (await _pathExists(provider, originalPath)) throw new Error(`復元先に既にファイルが存在: ${originalPath}`);
      await _moveEntry(provider, trashPath, originalPath);
      const warnings = [];
      const sidecarTrashPath = _normalizeFolderPath(meta?.csv_sidecar_trash_path || '');
      if (sidecarTrashPath && await _pathExists(provider, sidecarTrashPath)) {
        await _runPostMutationStep(warnings, 'csv-sidecar', async () => {
          const sidecarPath = _csvMetadataPath(originalPath);
          await _directoryHandle(provider, _dirname(sidecarPath), true);
          await _moveEntry(provider, sidecarTrashPath, sidecarPath);
          await _rewriteCsvSidecarSource(provider, sidecarPath, originalPath);
        });
      }
      await _runPathMutationHooksSafe({
        action: 'restore', oldPath: trashPath, newPath: originalPath,
        isFolder: source.kind === 'directory',
      }, warnings);
      await _runPostMutationStep(warnings, 'trash-metadata', async () => {
        if (await _pathExists(provider, metaPath)) await _removeEntry(provider, metaPath);
      });
      return { ok: true, restored_path: originalPath, trash_root: trashRoot.path, ..._resultWarnings(warnings) };
    }

/* === gb-data-access-dropbox-fileops-copy-routes.js === */
/* Dropbox Cloud duplicate/save-as route orchestration continuation. */
    async function runCloudIdentityCopyOperation(provider, operation, operationId, payload, source, chooseDestination) {
      if (!operationId) throw Object.assign(new Error('operation_id は必須です'), { status: 400 });
      const journal = window.MeldexCloudCopyOperationJournal;
      if (!journal) throw Object.assign(new Error('Cloudファイル操作履歴を利用できません'), { status: 503 });
      return journal.withFlight(provider, operationId, operation, payload, async identity => {
        let record = await journal.load(provider, operationId, operation, payload, identity);
        if (record?.state === 'completed') return record.result;
        let destPath = String(record?.intent?.destination || '');
        let destName = _basename(destPath);
        if (!record) {
          ({ destPath, destName } = await chooseDestination());
          record = await journal.prepare(provider, operationId, operation, payload, {
            source: payload.path, destination: destPath, kind: source.kind,
            provider_id: '', provider_rev: '', manifest_digest: '', aftercare_completed: [],
          }, identity);
        }
        if (!destPath) throw new Error('prepared Cloudファイル操作の保存先が不正です');
        const proof = record.intent.publish_proof || null;
        const stagingPrefix = `.${_basename(destPath)}.meldex-copy-`;
        const stagingCandidates = proof ? (await _freshDirectEntries(provider, _dirname(destPath)))
          .map(entry => _joinPath(_dirname(destPath), entry.name))
          .filter(path => _basename(path).startsWith(stagingPrefix) && _basename(path).endsWith('.tmp')
            && path === proof.staging_path) : [];
        if (stagingCandidates.length > 1) {
          throw Object.assign(new Error('prepared Cloud複製の一時候補が複数あるため自動再開できません'), { status: 409 });
        }
        const destinationExists = await _freshPathExists(provider, destPath);
        if (destinationExists && stagingCandidates.length) {
          throw Object.assign(new Error('prepared Cloud複製のfinalとstagingが同時に存在します'), { status: 409 });
        }
        if (!destinationExists && stagingCandidates.length === 1) {
          const stagingPath = stagingCandidates[0];
          const stagingProof = source.kind === 'directory'
            ? await _cloudFolderIdentityProof(provider, stagingPath)
            : await _providerObjectIdentity(provider, stagingPath, null).then(value => ({
                provider_id: value.id, provider_rev: value.rev, manifest_digest: '',
              }));
          if (stagingPath !== proof.staging_path || stagingProof.provider_id !== proof.provider_id
              || stagingProof.provider_rev !== proof.provider_rev
              || stagingProof.manifest_digest !== proof.manifest_digest) {
            throw Object.assign(new Error('prepared Cloud複製のstagingがpublish proofと一致しません'), { status: 409 });
          }
          await provider.movePathNoReplace(stagingPath, destPath);
        }
        let ownership = await _providerObjectIdentity(provider, destPath, null).catch(() => null);
        const ownershipComplete = ownership?.id && (source.kind === 'directory' || ownership?.rev);
        if (ownershipComplete && !record.intent.provider_id && proof) {
          const freshProof = source.kind === 'directory'
            ? await _cloudFolderIdentityProof(provider, destPath)
            : { provider_id: ownership.id, provider_rev: ownership.rev, manifest_digest: '' };
          if (freshProof.provider_id !== proof.provider_id
              || freshProof.provider_rev !== proof.provider_rev
              || freshProof.manifest_digest !== proof.manifest_digest) {
            throw Object.assign(new Error('prepared Cloud複製先がpublish proofと一致しません'), { status: 409 });
          }
          record.intent = { ...record.intent, provider_id: ownership.id,
            provider_rev: ownership.rev || '', manifest_digest: freshProof.manifest_digest || '' };
          await journal.updateIntent(provider, operationId, operation, payload, record.intent);
        } else if (!ownershipComplete) {
          const orphan = record.intent.orphan_staging;
          if (orphan?.path) {
            const currentOrphan = await _providerObjectIdentity(provider, orphan.path, null)
              .catch(() => null);
            if (currentOrphan?.id) {
              if (currentOrphan.id !== orphan.provider_id
                  || (orphan.provider_rev && currentOrphan.rev !== orphan.provider_rev)) {
                throw Object.assign(new Error('前回の孤立一時項目がforeign変更されています'), { status: 409 });
              }
              throw Object.assign(new Error('前回の孤立一時項目が保全されています'), {
                status: 503, meldexCode: 'copy_staging_orphan_retained',
              });
            }
            record.intent = { ...record.intent };
            delete record.intent.orphan_staging;
            await journal.updateIntent(provider, operationId, operation, payload, record.intent);
          }
          let transaction;
          try {
            transaction = await _copyPathWithIdentityTransaction(
              provider, payload.path, destPath, source.kind, {
                persistPublishProof: async publishProof => {
                  record.intent = { ...record.intent, publish_proof: publishProof };
                  await journal.updateIntent(provider, operationId, operation, payload, record.intent);
                },
              },
            );
          } catch (error) {
            if (error?.meldexOrphanStaging) {
              record.intent = { ...record.intent,
                orphan_staging: error.meldexOrphanStaging };
              await journal.updateIntent(provider, operationId, operation, payload, record.intent);
            }
            throw error;
          }
          ownership = transaction.ownership;
          if (!ownership?.id || (source.kind !== 'directory' && !ownership?.rev)) {
            throw new Error('Cloud複製先のprovider identityを確認できません');
          }
          record.intent = {
            ...record.intent, provider_id: ownership.id, provider_rev: ownership.rev,
            manifest_digest: transaction.manifest_digest || '',
          };
          await journal.updateIntent(provider, operationId, operation, payload, record.intent);
          record = await journal.load(provider, operationId, operation, payload);
        } else if (ownership.id !== record.intent.provider_id
            || (source.kind !== 'directory' && ownership.rev !== record.intent.provider_rev)) {
          throw Object.assign(new Error('prepared Cloud複製先が後続更新と競合しています'), { status: 409 });
        }
        const folderCheckpoint = source.kind === 'directory'
          ? () => _cloudFolderIdentityProof(provider, destPath) : null;
        if (folderCheckpoint && record.intent.manifest_digest
            && !record.intent.aftercare_in_progress) {
          const current = await folderCheckpoint();
          const expected = record.intent.aftercare_manifest_digest || record.intent.manifest_digest;
          if (current.manifest_digest !== expected) {
            throw Object.assign(new Error('prepared Cloud folder manifestが後続更新と競合しています'), { status: 409 });
          }
        }
        record = await journal.runAftercare(provider, operationId, operation, payload, record, [
          { name: 'csv-sidecars', run: () => _relocateCsvSidecars(
            provider, payload.path, destPath, source.kind === 'directory', true,
          ) },
          { name: 'path-mutation-hooks', run: () => _runPathMutationHooks({
            action: 'copy', oldPath: payload.path, newPath: destPath,
            isFolder: source.kind === 'directory', operationId,
          }) },
          { name: 'identity-claims', run: () => _claimPublishedCloudIdentities(
            provider, destPath, source.kind,
          ) },
        ], folderCheckpoint);
        const result = { ok: true, operation_id: operationId, new_path: destPath,
          new_name: source.kind === 'file' ? _splitNameAndExt(destName).stem : destName,
          provider_id: ownership.id, provider_rev: ownership.rev,
          manifest_digest: record.intent.manifest_digest || '' };
        return journal.complete(provider, operationId, operation, payload, result);
      });
    }
    if (pathname === '/outliner/duplicate' && method === 'POST') {
      const provider = await _requirePwaProvider('readwrite');
      const sourcePath = _normalizeFolderPath(body?.path || '');
      const source = await _resolveEntryHandle(provider, sourcePath);
      if (!source) throw new Error(`見つかりません: ${sourcePath}`);
      const operationId = String(body?.operation_id || '').trim();
      const payload = { path: sourcePath };
      return runCloudIdentityCopyOperation(provider, 'duplicate', operationId, payload, source, async () => {
        const sourceName = _basename(sourcePath); const sourceSplit = _splitNameAndExt(sourceName);
        let destName = source.kind === 'file' ? `${sourceSplit.stem}_copy${sourceSplit.ext}` : `${sourceName}_copy`;
        let destPath = _joinPath(_dirname(sourcePath), destName);
        for (let counter = 2; await _freshPathExists(provider, destPath); counter += 1) {
          destName = source.kind === 'file' ? `${sourceSplit.stem}_copy${counter}${sourceSplit.ext}` : `${sourceName}_copy${counter}`;
          destPath = _joinPath(_dirname(sourcePath), destName);
        }
        await _directoryHandle(provider, _dirname(destPath), true);
        return { destName, destPath };
      });
    }

    if (pathname === '/outliner/save-as' && method === 'POST') {
      const provider = await _requirePwaProvider('readwrite');
      const sourcePath = _normalizeFolderPath(body?.path || '');
      const source = await _resolveEntryHandle(provider, sourcePath);
      if (!source) throw new Error(`見つかりません: ${sourcePath}`);
      const sourceName = _basename(sourcePath); const sourceSplit = _splitNameAndExt(sourceName);
      const newName = _validateItemName(String(body?.new_name || (source.kind === 'file' ? sourceSplit.stem : sourceName)).replace(/[\\/]/g, '').replace(/\.\./g, '').trim(), 'new_name');
      const destFolder = _normalizeFolderPath(body?.dest_folder || _dirname(sourcePath));
      const operationId = String(body?.operation_id || '').trim();
      const payload = { path: sourcePath, new_name: newName, dest_folder: destFolder };
      return runCloudIdentityCopyOperation(provider, 'save-as', operationId, payload, source, async () => {
        let destName = source.kind === 'file' ? newName + sourceSplit.ext : newName;
        let destPath = _joinPath(destFolder, destName);
        for (let counter = 2; await _freshPathExists(provider, destPath); counter += 1) {
          destName = source.kind === 'file' ? `${newName}_${counter}${sourceSplit.ext}` : `${newName}_${counter}`;
          destPath = _joinPath(destFolder, destName);
        }
        await _directoryHandle(provider, destFolder, true);
        return { destName, destPath };
      });
    }

/* === gb-data-access-dropbox-fileops-move-route.js === */
/* gb-data-access-dropbox-fileops move-route continuation. */
    if (pathname === '/outliner/move' && method === 'POST') {
      const provider = await _requirePwaProvider('readwrite');
      const sourcePath = _normalizeFolderPath(body?.path || '');
      const destFolder = _normalizeFolderPath(body?.dest_folder || '');
      _rejectProductionStructureMutation(sourcePath, '移動');
      if (window.MeldexProductionSchemaMigration?.isManagedEntryPath?.(sourcePath)) {
        throw new Error('制作管理の管理リストエントリの配置は変更できません');
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
      await _updateAnnotationsForPathMutation(provider, {
        action: 'move', oldPath: sourcePath, newPath: conflict.path,
        isFolder: source.kind === 'directory', annotationPlan,
      });
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

/* === gb-data-access-dropbox-fileops-identity-claims.js === */
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
