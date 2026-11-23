      if (!dataUrl) throw new Error('data は必須です');
      const ts = _versionTimestamp();
      const configuredFolder = String(body?.target_path || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
      const targetPath = _joinPath(configuredFolder || 'スクリーンショット', `screenshot_${ts}.png`);
      let screenshotBytes = _decodeUploadData(dataUrl);
      const sourceTarget = String(body?.source_target || body?.sourceTarget || '').trim();
      const sourceLink=window.GBScreenshotPng.validate(body?.source_link,sourceTarget);
      if(sourceLink)screenshotBytes=window.GBScreenshotPng.embed(screenshotBytes,sourceLink);
      const annotationTarget = sourceTarget || targetPath;
      // アノテートrecordはbytes publish前に確定させ、identity claimと同じ
      // prepare済みintentへ連動書込みとして持たせる(固有形式付随物廃止・
      // 管理データ一元化計画 §10.1)。これによりアノテート書込みの失敗も
      // aftercare_pending化され、identity claimと同じdrain/復帰対象になる。
      const annRecord = _mergeAnnotationRecord(null, {
        type: 'screenshot',
        target_path: annotationTarget,
        user: _currentUserName(body),
        data: {
          path: targetPath,
          mode: String(body?.mode || ''),
          width: body?.width || null,
          height: body?.height || null,
          source_file: sourceTarget ? _basename(sourceTarget) : null,
          ...(sourceLink?{source_link:sourceLink}:{}),
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
      if (!existing) throw new Error('アノテートが見つかりません');
      const modified = existing.modified || existing.modified_at || existing.created || existing.created_at || '';
      if (body?.expected_modified && modified !== body.expected_modified) {
        const error = new Error('他の画面で更新されたためアノテートを変更できません');
        error.status = 409; throw error;
      }
      const updateBody = {};
      ANNOTATION_UPDATE_KEYS.forEach((key) => {
        if (Object.prototype.hasOwnProperty.call(body || {}, key)) updateBody[key] = body[key];
      });
      const record = _mergeAnnotationRecord(existing, updateBody, { id, now: _nowIso() });
      await _writeAnnotationRecord(provider, record, { expectedModified: modified });
      return { ok: true, modified: record.modified };
    }
    if (/^\/annotations\/[^/]+$/.test(pathname) && method === 'DELETE') {
      const provider = await _requirePwaProvider('readwrite');
      const id = _safeId(pathname.split('/').pop(), 'annotation id');
      await _deleteAnnotationRecordFully(provider, id, { expectedModified: url.searchParams.get('expected_modified') || '' });
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
      return _readFolderVersion(provider, url.searchParams.get('path') || '', url.searchParams.get('version') || '', true);
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
        include_annotations: !!body?.include_annotations,
        metadata: _snapshotActorMetadata(actor, actor, body?.auto ? 'periodic_auto' : 'manual', '', null, ''),
      });
    }
    if (pathname === '/version/restore-folder' && method === 'POST') {
      const provider = await _requirePwaProvider('readwrite');
      return _restoreFolderVersion(provider, body?.path || '', body?.version || '', body || {});
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
      return _restoreFileVersion(provider, body?.path || '', body?.version || '', body || {});
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
      let parent = _normalizeFolderPath(body?.parent || '');
      const type = String(body?.type || '');
      if (type === 'form-app') {
        const home = await window.MeldexDataAccess.requestJson('/home-folder', { method: 'GET' });
        const personal = _normalizeFolderPath(home?.path || '');
        if (!personal || home.exists === false || personal.split('/').some(part => part === '..' || part === '.'))
          throw new Error('個人のホームを設定してください');
        if (parent.split('/').some(part => part === '..' || part === '.')
          || parent !== personal && !parent.startsWith(personal + '/')) parent = personal;
      }
      const titleHelper = window.GBPathUtils?.displayTitle;
      const managed = ['page','board','database','calendar','scriptnote','form-app','map'].includes(type);
      const title = managed && titleHelper ? titleHelper.validate(body?.label || '無題') : null;
      const label = title !== null ? titleHelper.storageName(title) : _validateItemName(body?.label || '無題', 'label');
      const shown = name => title !== null && title !== label ? title : name;
      const titled = (text, path) => title !== null && title !== label ? titleHelper.write(text,title,path,type) : text;
      const createText = async (path, text) => {
        if (typeof provider.uploadBytesConditional !== 'function') {
          throw Object.assign(new Error('新規ファイルの安全な作成を利用できません'), { status: 503, code: 'strict_cas_unavailable' });
        }
        const identity = window.MeldexDocumentIdentity;
        const format = identity?.formatForPath?.(path, text);
        const content = format ? identity.ensureDocumentId(text, format).text : text;
        return provider.uploadBytesConditional(path, new TextEncoder().encode(content), null);
      };
      const blockedCreate = {
        database: ['シート', 'Phase 4'],
        calendar: ['カレンダー', 'Phase 3'],
      }[type];
      if (blockedCreate) throw new Error(_phaseUnsupported(blockedCreate[0], blockedCreate[1]).error);
      if (type === 'folder') {
        const labelName = await _uniqueName(provider, parent, label, '');
        const targetPath = _joinPath(parent, labelName);
        await _directoryHandle(provider, targetPath, true);
        return { ok: true, node: { type: 'folder', label: shown(labelName), path: targetPath, children: [] } };
      }
      if (type === 'page') {
        const labelName = await _uniqueName(provider, parent, label, '.md');
        const targetPath = _joinPath(parent, labelName + '.md');
        await createText(targetPath, titled(`# ${shown(labelName)}\n\n`, targetPath));
        return { ok: true, node: { type: 'page', label: shown(labelName), path: targetPath } };
      }
      if (type === 'database') {
        const labelName = await _uniqueName(provider, parent, label, '');
        const targetPath = _joinPath(parent, labelName);
        await _directoryHandle(provider, targetPath, true);
        await provider.writeText(_joinPath(targetPath, labelName + '.md'), `# ${labelName}\n\n`);
        return { ok: true, node: { type: _phase1SurfaceType('database', 'directory'), label: shown(labelName), path: targetPath } };
      }
      if (type === 'scriptnote') {
        const labelName = await _uniqueName(provider, parent, label, '.mel-scenario');
        const targetPath = _joinPath(parent, labelName + '.mel-scenario');
        await createText(targetPath, JSON.stringify({
          fileType: 'meldex-scriptnote',
          schema_version: 4,
          version: 1,
          title: shown(labelName),
          ...(title !== null && title !== label ? {display_title:title} : {}),
          layoutMode: 'manga',
          editor: { viewMode: 'horizontal', wrapMode: true, textWidth: 20, lineHeight: 1.5, letterSpacing: 0.02, fontH: '', fontV: '', colors: null },
          scenarioTypes: [],
          characters: [],
          characterDb: [],
          notes: [],
          rows: [],
          source: { importedFrom: '', modeName: 'マンガ縦書き' },
        }, null, 2));
        return { ok: true, node: { type: 'scriptnote', label: shown(labelName), path: targetPath } };
      }
      if (type === 'form-app') {
        const labelName = await _uniqueName(provider, parent, label, '.mel-form');
        const targetPath = _joinPath(parent, labelName + '.mel-form');
        const createdSheet = await window.MeldexDataAccess.requestJson('/outliner/add', {
          method: 'POST', headers, body: { type: 'database', parent, label: labelName + 'のシート' },
        });
        const sheetPath = createdSheet?.node?.path;
        if (!sheetPath) throw new Error('シートを作成できませんでした');
        let content = JSON.stringify({fileType:'meldex-form',schema_version:1,title:shown(labelName),sheet:{path:sheetPath},layout:null,formConfig:{mode:'entry'}},null,2);
        content = titled(content,targetPath);
        if (window.MeldexDocumentIdentity) content = window.MeldexDocumentIdentity.ensureDocumentId(content,'form').text;
        try {
          await window.MeldexDataAccess.requestJson('/db-metadata?path=' + encodeURIComponent(sheetPath), {
            method: 'PUT', headers, body: { default_form_path: targetPath },
          });
          await window.MeldexDataAccess.requestJson('/file?path=' + encodeURIComponent(targetPath), {
            method: 'PUT', headers, body: { content, create_only: true },
          });
        } catch (error) {
          // A remote write may have committed before its response was lost.
          // Retain the sheet rather than risk deleting a form's answer data.
          error.userMessage = 'フォームの作成を確認できませんでした。シートは「' + sheetPath + '」に残っています。';
          throw error;
        }
        return {ok:true,node:{type:'form-app',label:shown(labelName),path:targetPath}};
      }
      if (type === 'map') {
        const labelName = await _uniqueName(provider, parent, label, '.mel-map');
        const targetPath = _joinPath(parent, labelName + '.mel-map');
        if (typeof internals._requireUnlockedPath !== 'function') throw new Error('編集ロックを確認できません');
        await internals._requireUnlockedPath(provider, parent, { action: 'outliner-add-parent' });
        await internals._requireUnlockedPath(provider, targetPath, { action: 'outliner-add-map' });
        const doc = window.MeldexMapDocument.create(shown(labelName));
        await createText(targetPath, titled(JSON.stringify(doc, null, 2), targetPath));
        return { ok: true, node: { type: 'map', label: shown(labelName), path: targetPath } };
      }
      if (type === 'board') {
        const labelName = await _uniqueName(provider, parent, label, '.mel-board');
        const targetPath = _joinPath(parent, labelName + '.mel-board');
        let boardContent = '---\ntype: board\nschema_version: 1\n---\n';
        boardContent = titled(boardContent, targetPath);
        if (window.MeldexDocumentIdentity) boardContent = window.MeldexDocumentIdentity.ensureDocumentId(boardContent, 'board').text;
        await createText(targetPath, boardContent);
        return { ok: true, node: { type: _phase1SurfaceType('board', 'file'), label: shown(labelName), path: targetPath } };
      }
      if (type === 'calendar') {
        const labelName = await _uniqueName(provider, parent, label, '');
        const targetPath = _joinPath(parent, labelName);
        await _directoryHandle(provider, targetPath, true);
        await provider.writeText(_joinPath(targetPath, labelName + '.md'), `---\ntype: calendar-db\n---\n# ${labelName}\n\n`);
        return { ok: true, node: { type: _phase1SurfaceType('calendar', 'directory'), label: shown(labelName), path: targetPath } };
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
      const titleHelper = window.GBPathUtils?.displayTitle;
      const source = await _resolveEntryHandle(provider, oldPath);
      if (!source) throw new Error(`見つかりません: ${oldPath}`);
      // タイトル＝ファイル名（デスクトップ版の /api/outliner/rename と同じ規則）。
      // 使えない文字は置き換えたファイル名にし、元の表記は表示タイトルに残す。
      let titleOnly = false;
      let newName = '';
      let displayName = '';
      let keepDisplayTitle = false;
      if (titleHelper && ['page','board','database','calendar','scenario','scriptnote','timer','form-app'].includes(body?.type)) {
        displayName = titleHelper.validate(body?.new_name);
        const currentStem = source.kind === 'directory' ? _basename(oldPath) : _splitNameAndExt(_basename(oldPath)).stem;
        const fileName = titleHelper.storageName(displayName);
        titleOnly = body?.title_only === true || fileName === currentStem;
        newName = titleOnly ? displayName : fileName;
        if (!titleOnly) {
          const existingTitlePath = source.kind === 'directory' ? _joinPath(oldPath,_basename(oldPath)+'.md') : oldPath;
          let hadDisplayTitle = false;
          if (source.kind !== 'directory' || await _pathExists(provider,existingTitlePath)) {
            hadDisplayTitle = !!titleHelper.read(await provider.readText(existingTitlePath),existingTitlePath);
          }
          keepDisplayTitle = hadDisplayTitle || displayName !== fileName;
        }
      } else {
        newName = _validateItemName(body?.new_name || '', 'new_name');
      }
      if (titleOnly) {
        const titlePath = source.kind === 'directory' ? _joinPath(oldPath,_basename(oldPath)+'.md') : oldPath;
        const loaded = await window.MeldexDataAccess.requestJson('/file?path='+encodeURIComponent(titlePath),{method:'GET'});
        const content = titleHelper.write(loaded.content,newName,titlePath,body?.type);
        const saved = await window.MeldexDataAccess.requestJson('/file?path='+encodeURIComponent(titlePath),{
          method:'PUT',headers,body:{content,display_title:newName,if_match_etag:loaded.etag,transport_revision:loaded.transport_revision},
        });
        return {...saved,ok:true,new_path:oldPath,new_name:newName,title_only:true,file_id:_fnvFileId(oldPath)};
      }
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
        await _runPostMutationStep(warnings, 'folder-note', async () => {
          const oldNotePath = _joinPath(newPath, sourceName + '.md');
          const newNotePath = _joinPath(newPath, newName + '.md');
          if (await _pathExists(provider, oldNotePath) && !await _pathExists(provider, newNotePath)) {
            await _moveEntry(provider, oldNotePath, newNotePath);
            await _runPostMutationStep(warnings, 'folder-note-version-history', () => _relocateVersionHistory(provider, _joinPath(oldPath, sourceName + '.md'), newNotePath, false));
          }
          if (keepDisplayTitle && await _pathExists(provider, newNotePath)) {
            await provider.writeText(newNotePath, titleHelper.write(await provider.readText(newNotePath), displayName, newNotePath, body?.type));
          }
        });
        await _runPostMutationStep(warnings, 'stored-paths', () => (
          typeof _rewriteStoredPathsForProvider === 'function'
            ? _rewriteStoredPathsForProvider(provider, oldPath, newPath, true)
            : Promise.resolve(_rewriteStoredPaths(oldPath, newPath, true))
        ));
        await _runPathMutationHooksSafe({ action: 'rename', oldPath, newPath, isFolder: true }, warnings);
        await _runPostMutationStep(warnings, 'annotations', () => _updateAnnotationsForPathMutation(provider, {
          action: 'rename', oldPath, newPath, isFolder: true, annotationPlan,
        }));
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
        const heading = displayName || newName;
        // デスクトップ版（meldex_api_outliner の re.sub(r"^# .+", count=1)）と同じく、
        // ファイル先頭が見出しの時だけ書き換える。以前は m フラグで本文中の最初の
        // 「# 見出し」を探していたため、frontmatter付きノートの本文見出しを名前で
        // 上書きしていた（実データ388件が該当）。
        await provider.writeText(oldPath, original.replace(/^# .+/, () => '# ' + heading));
      }
      if (keepDisplayTitle) {
        await provider.writeText(oldPath, titleHelper.write(await provider.readText(oldPath), displayName, oldPath, body?.type));
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
      await _runPostMutationStep(warnings, 'annotations', () => _updateAnnotationsForPathMutation(provider, {
        action: 'rename', oldPath, newPath: nextPath, isFolder: false, annotationPlan,
      }));
      let relocate = { rewritten_count: 0, failed_count: 0, rewritten_paths: [], truncated: false };
      await _runPostMutationStep(warnings, 'references', async () => {
        relocate = await _relocateReferences(provider, oldPath, nextPath, false);
      });
      return { ok: true, new_path: nextPath, file_id: _fnvFileId(nextPath), relocate, ..._resultWarnings(warnings) };
    }

/* === gb-data-access-dropbox-fileops-file-revision.js === */
/* Dropbox Cloud file identity/revision helpers continuation (hoisted declarations used by the /file routes in part02). */
    function _preserveNoteTextFormat(text, original) {
      const bom = original.startsWith('\uFEFF') ? '\uFEFF' : '';
      original = original.replace(/^\uFEFF/, '');
      text = String(text).replace(/^\uFEFF/, '');
      const endings = original.match(/\r\n|\r|\n/g) || [];
      if (!endings.length) return bom + text;
      const counts = new Map();
      for (const ending of endings) counts.set(ending, (counts.get(ending) || 0) + 1);
      const majority = [...counts].sort((a, b) => b[1] - a[1])[0][0];
      const normalized = text.replace(/\r\n?/g, '\n');
      if (counts.size === 1) return bom + normalized.replace(/\n/g, majority);
      const split = value => (value.match(/[^\r\n]*(?:\r\n|\r|\n|$)/g) || []).filter(Boolean)
        .map(line => { const end = /(?:\r\n|\r|\n)$/.exec(line)?.[0] || ''; return [line.slice(0, line.length - end.length), end]; });
      const old = split(original), next = split(normalized);
      const result = next.map(line => line[1] ? majority : '');
      const keep = (a, b) => { if (result[b]) result[b] = old[a][1] || majority; };
      // Match unchanged edges and unique lines (patience anchors). Repeated-line
      // gaps of equal size keep their positional endings; new lines use majority.
      // Uniform files, including large notes, take the linear fast path above.
      const segments = [[0, old.length, 0, next.length]];
      while (segments.length) {
        let [a, b, c, d] = segments.pop();
        while (a < b && c < d && old[a][0] === next[c][0]) keep(a++, c++);
        while (a < b && c < d && old[b-1][0] === next[d-1][0]) keep(--b, --d);
        if (a === b || c === d) continue;
        const indices = (rows, start, end) => {
          const map = new Map();
          for (let i = start; i < end; i++) map.set(rows[i][0], map.has(rows[i][0]) ? -1 : i);
          return map;
        };
        const left = indices(old, a, b), right = indices(next, c, d), pairs = [];
        for (const [line, i] of left) if (i >= 0 && right.get(line) >= 0) pairs.push([i, right.get(line)]);
        const tails = [], previous = [];
        for (let i = 0; i < pairs.length; i++) {
          let lo = 0, hi = tails.length;
          while (lo < hi) { const mid = (lo + hi) >>> 1; if (pairs[tails[mid]][1] < pairs[i][1]) lo = mid + 1; else hi = mid; }
          previous[i] = lo ? tails[lo-1] : -1; tails[lo] = i;
        }
        if (!tails.length) { if (b-a === d-c) for (let i = 0; i < b-a; i++) keep(a+i, c+i); continue; }
        const anchors = [];
        for (let i = tails[tails.length-1]; i >= 0; i = previous[i]) anchors.push(pairs[i]);
        for (const [i, j] of anchors.reverse()) { segments.push([a, i, c, j]); keep(i, j); a = i+1; c = j+1; }
        segments.push([a, b, c, d]);
      }
      return bom + next.map((line, i) => line[0] + result[i]).join('');
    }

    function _pwaFileTransport() {
      return window.MeldexRuntimeAdapter?.isBrowserMode?.() ? 'browser-local' : 'dropbox-rev';
    }

    async function _fileIdentityAndRevision(provider, filePath, entry, etag, writeMeta, fileContent) {
      let meta = writeMeta?.meta || writeMeta || null;
      if (!meta?.id && typeof provider?.getMetadata === 'function') {
        meta = await provider.getMetadata(filePath).catch(() => meta);
      }
      if (!meta?.id) {
        const stat = typeof provider?.statPath === 'function'
          ? await provider.statPath(filePath).catch(() => null)
          : null;
        meta = stat?.meta || meta;
      }
      const token = String(etag || '');
      const providerId = String(meta?.id || '');
      const identity = window.MeldexDocumentIdentity;
      let content = fileContent;
      if (content == null && identity?.formatForPath?.(filePath) && typeof provider?.readText === 'function') {
        content = await provider.readText(filePath).catch(() => '');
      }
      const identityContent = /\.md$/i.test(filePath) ? String(content || '').replace(/\r\n?/g, '\n') : content;
      const identityFormat = identity?.formatForPath?.(filePath, identityContent);
      const documentId = identityFormat
        ? String(identity?.readDocumentId?.(String(identityContent || ''), identityFormat) || '')
        : '';
      return {
        etag: token,
        transport_revision: { transport: _pwaFileTransport(), token },
        ...(documentId ? {
          document_id: documentId,
          document_key: `document:${documentId}`,
        } : {}),
        ...(providerId ? {
          provider_id: providerId,
          ...(!documentId ? { document_key: `dropbox-item:${providerId}` } : {}),
        } : {}),
      };
    }

    function _throwPreconditionRequired(filePath, currentEtag) {
      const error = new Error('既存ファイルを更新するには読込時のrevisionが必要です');
      error.status = 428;
      error.code = 'precondition_required';
      error.meldexCode = 'precondition_required';
      error.detail = {
        code: 'precondition_required',
        path: _normalizeFolderPath(filePath),
        current_etag: String(currentEtag || ''),
      };
      throw error;
    }

    function _dropboxTransportRevisionToken(bodyValue) {
      const expectedTransport = _pwaFileTransport();
      const revision = bodyValue?.transport_revision || bodyValue?.transportRevision || '';
      let transport = '';
      let token = '';
      if (revision && typeof revision === 'object') {
        transport = String(revision.transport || revision.kind || expectedTransport);
        token = String(revision.token || revision.revision || revision.etag || '').trim();
      } else {
        const raw = String(revision || '').trim();
        if (raw.startsWith('local-etag:')) transport = 'local-etag';
        else if (raw.startsWith('browser-local:')) {
          transport = 'browser-local';
          token = raw.slice('browser-local:'.length);
        }
        else if (raw.startsWith('dropbox-rev:')) {
          transport = 'dropbox-rev';
          token = raw.slice('dropbox-rev:'.length);
        } else {
          transport = expectedTransport;
          token = raw;
        }
      }
      if (transport && transport !== expectedTransport) {
        const error = new Error('異なる保存経路のrevisionは使用できません');
        error.status = 400; error.code = 'transport_mismatch'; error.meldexCode = 'transport_mismatch';
        error.detail = { code: 'transport_mismatch', expected_transport: expectedTransport, actual_transport: transport };
        throw error;
      }
      return token;
    }

    async function _readFileSnapshot(provider, filePath, entry) {
      if (typeof provider.readBytesSnapshot === 'function') {
        const snapshot = await provider.readBytesSnapshot(filePath);
        return { bytes: snapshot.bytes, etag: String(snapshot.revision || '') };
      }
      if (typeof provider.readBytesFresh === 'function') {
        const snapshot = await provider.readBytesFresh(filePath);
        return { bytes: snapshot.bytes, etag: String(snapshot.revision || '') };
      }
      const before = await _fileEtag(provider, filePath, entry);
      const bytes = new TextEncoder().encode(await provider.readText(filePath));
      const after = await _fileEtag(provider, filePath, entry);
      if (!before || before !== after) _throwEtagConflict(filePath, before, after);
      return { bytes, etag: after };
    }

    function _savedNoteMetadata(filePath, content) {
      content = String(content || '').replace(/\r\n?/g, '\n');
      if (window.MeldexDocumentIdentity?.formatForPath?.(filePath, content) !== 'note') return {};
      return { saved_frontmatter: /^(?:\uFEFF)?---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/.exec(content)?.[0] || '' };
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
          // publish前の証明は既に永続化済み。所有情報は直後のaftercare開始と一緒に、効果の実行前に確定する。
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
        // 実体と公開前の復旧証明を確認済み。後処理中の表示だけを先に通知する。
        try {
          window.dispatchEvent?.(new CustomEvent('meldex:copy-published', { detail: {
            operation_id: operationId, source_path: payload.path, new_path: destPath,
            new_name: source.kind === 'file' ? _splitNameAndExt(destName).stem : destName,
          } }));
        } catch (error) { console.warn('[copy] 公開済みの表示通知に失敗', error); }
        record = await journal.runAftercare(provider, operationId, operation, payload, record, [
          { name: 'csv-sidecars', noop: source.kind !== 'directory' && !/\.csv$/i.test(payload.path), run: () => _relocateCsvSidecars(
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
