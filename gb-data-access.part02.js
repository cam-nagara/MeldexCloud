    _uniqueName,
    _moveConflictName,
    _writeBytes,
    _decodeUploadData,
    _copyEntryHandle,
    _removeEntry,
    _moveEntry,
    _classifyDirectoryType,
    _classifyFileType,
    _buildBrowseItem,
    _sortBrowseItems,
    _linkedItemsForFolder,
    _rewriteStoredPaths,
    _rewriteStoredPathsForProvider,
    _removeStoredPathEntries,
    _removeStoredPathEntriesForProvider,
    _iterateWorkspaceFiles,
    _requireUnlockedPath,
    _relocateReferences,
    _queryBacklinks,
    _queryDeleteImpact,
    _fnvFileId,
  };
  window.__MeldexPwaDataAccessExtensions = window.__MeldexPwaDataAccessExtensions || [];

  const PWA_WORKSPACES_FILE = '_meldex/workspaces.v1.json';
  const PWA_WORKSPACES_DOCUMENT_ID = 'cloud-workspaces';
  const TEAM_MANAGEMENT_DOCUMENT_PREFIX = 'team-members-v1-';

  function _nowIso() {
    return new Date().toISOString();
  }

  function _httpError(status, message) {
    const err = new Error(message || `HTTP ${status}`);
    err.status = status;
    err.httpStatus = status;
    return err;
  }

  function _teamManagementDocumentId(folderPath) {
    // Dropboxのパス比較は大文字小文字を区別しないため、表記差で別レコードを
    // 作らないよう管理IDだけを小文字へ正規化する。
    const relativeFolder = (_normalizeFolderPath(folderPath) || '.').toLowerCase();
    return TEAM_MANAGEMENT_DOCUMENT_PREFIX + _fnvFileId(relativeFolder);
  }

  function _normalizeTeamFile(team) {
    const base = team && typeof team === 'object' && !Array.isArray(team) ? { ...team } : {};
    if (!base.members || typeof base.members !== 'object' || Array.isArray(base.members)) base.members = {};
    return base;
  }

  function _teamStorageKind() {
    const kind = window.MeldexSystemStorage?.SystemStorageKind?.PROFILES_WORKSPACE;
    if (!kind) throw new Error('チームプロフィール管理データ契約が未初期化です');
    return kind;
  }

  async function _readManagedTeamFile(folderPath) {
    const provider = await _requirePwaProvider('read');
    const kind = _teamStorageKind();
    const managed = await _readManagementPayload(
      provider,
      kind,
      _teamManagementDocumentId(folderPath),
    );
    if (managed.payload) return _normalizeTeamFile(managed.payload);
    // 旧ファイルは既存利用者のメンバー情報を失わないために限って併読する。
    // 保存は必ず型付き管理領域へ行い、source folder側は変更しない。
    return _normalizeTeamFile(
      await _readTeamFile(folderPath).catch(() => ({ members: {} })),
    );
  }

  function _isSystemStorageConflict(error) {
    return error?.name === 'SystemStorageConflictError'
      || error?.code === 'system_storage_conflict';
  }

  async function _writeTeamFileMerged(folderPath, updater) {
    const provider = await _requirePwaProvider('readwrite');
    const kind = _teamStorageKind();
    const documentId = _teamManagementDocumentId(folderPath);
    const adapter = await _managementAdapter(provider, kind);
    let lastError = null;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const current = await adapter.load(kind, documentId);
      const team = current?.payload
        ? _normalizeTeamFile(current.payload)
        : _normalizeTeamFile(await _readTeamFile(folderPath).catch(() => ({ members: {} })));
      const next = updater(team);
      if (next === false) return { ok: true, skipped: true };
      try {
        const saved = await adapter.save(
          kind,
          documentId,
          _normalizeTeamFile(next || team),
          { expectedRevision: current?.revision ?? null },
        );
        return { ok: true, record: saved };
      } catch (error) {
        lastError = error;
        if (!_isSystemStorageConflict(error)) throw error;
      }
    }
    throw lastError;
  }

  async function _syncTeamMember(folder, body) {
    const name = String(body?.name || '').trim();
    if (!name) throw new Error('name は必須です');
    const accountId = String(body?.accountId || body?.account_id || '').trim();
    const hasAvatarField = Object.prototype.hasOwnProperty.call(body || {}, 'avatar');
    let avatarForCache = '';
    let wrote = false;
    const result = await _writeTeamFileMerged(folder, team => {
      const members = team.members || {};
      const existing = members[name] && typeof members[name] === 'object' ? { ...members[name] } : {};
      const next = { ...existing };
      let changed = false;
      if (hasAvatarField) {
        const avatar = body?.avatar || '';
        if ((next.avatar || '') !== avatar) {
          next.avatar = avatar;
          changed = true;
        }
      } else if (!Object.prototype.hasOwnProperty.call(next, 'avatar')) {
        next.avatar = '';
      }
      if (accountId) {
        Object.entries(members).forEach(([memberName, info]) => {
          if (memberName !== name && info?.accountId === accountId) {
            delete members[memberName];
            changed = true;
          }
        });
        if (next.accountId !== accountId) {
          next.accountId = accountId;
          changed = true;
        }
      }
      if (!next.role) {
        next.role = 'editor';
        changed = true;
      }
      // last_seen は書き込みが発生する時（＝プロフィールに実変更がある時）だけ
      // 付随して更新する。無変更の起動・閲覧だけで共有Dropboxの管理ファイルを
      // 書き換えないようにするため、経過時間だけを理由にした強制書き込み判定は
      // 廃止した（last_seen の読み手は一覧整形のみで、UI表示には使われていない
      // ため、更新頻度が下がっても実害はない）。
      avatarForCache = next.avatar || '';
      if (!changed) return false;
      next.last_seen = _nowIso();
      members[name] = next;
      team.members = members;
      wrote = true;
      return team;
    });
    _cacheTeamAvatar(name, avatarForCache, folder);
    return { ok: true, skipped: result?.skipped === true || !wrote };
  }

  // 統合したプロフィールの旧名の行を、新しい名前の行へ移してから消す
  // (デスクトップ版 /api/team/merge と同じ契約)。
  //
  // 安全側の契約:
  //   - 権限は残る側の行の値をそのまま維持し、旧行が owner/admin でも継承しない。
  //   - 旧行が自分以外の accountId を持つ場合は他人の行なので触らない。
  //   - 「新しい行を書いてから旧行を消す」の順で2回書き込む。途中で失敗しても
  //     行が消えたままになることはない。
  async function _mergeTeamMember(folder, body) {
    const name = String(body?.name || '').trim();
    const previousName = String(body?.previousName || body?.previous_name || '').trim();
    if (!name) throw new Error('name は必須です');
    if (!previousName || previousName === name) return { ok: true, skipped: true };
    const accountId = String(body?.accountId || body?.account_id || '').trim();

    let moved = false;
    let blocked = false;
    await _writeTeamFileMerged(folder, team => {
      const members = team.members || {};
      const old = members[previousName];
      if (!old || typeof old !== 'object') return false;
      const oldAccountId = String(old.accountId || '').trim();
      // 旧行が別のDropboxアカウントに紐づいているなら他人の行なので触らない。
      // 自分のaccountIdを名乗れない状態でも、accountId付きの行は消さない。
      if (oldAccountId && oldAccountId !== accountId) {
        blocked = true;
        return false;
      }
      const existing = members[name] && typeof members[name] === 'object' ? { ...members[name] } : {};
      const next = { ...existing };
      // role は残る側の値を維持する。旧行からの owner/admin 継承は行わない。
      if (!next.role) next.role = 'editor';
      if (!next.avatar) next.avatar = old.avatar || '';
      if (accountId) next.accountId = accountId;
      else if (!next.accountId && oldAccountId) next.accountId = oldAccountId;
      const lastSeen = [String(next.last_seen || ''), String(old.last_seen || ''), _nowIso()]
        .reduce((a, b) => (a > b ? a : b), '');
      next.last_seen = lastSeen;
      members[name] = next;
      team.members = members;
      moved = true;
      return team;
    });
    if (blocked) throw new Error('他のメンバーの行は移動できません');
    if (!moved) return { ok: true, skipped: true };

    // 新しい行の書き込みが成功してから、旧行を別の書き込みで消す。
    await _writeTeamFileMerged(folder, team => {
      const members = team.members || {};
      if (!members[previousName]) return false;
      delete members[previousName];
      team.members = members;
      return team;
    });
    return { ok: true, merged: true, from: previousName, to: name };
  }

  function _workspaceRole(role, fallback) {
    const value = String(role || '').trim().toLowerCase();
    return ['owner', 'admin', 'member', 'viewer'].includes(value) ? value : (fallback || 'member');
  }

  function _workspaceMember(member, fallbackName) {
    const name = String(member?.name || fallbackName || '').trim();
    if (!name) return null;
    const accountId = String(member?.accountId || member?.account_id || '').trim();
    const row = {
      name,
      role: _workspaceRole(member?.role, 'member'),
      avatar: String(member?.avatar || ''),
      updatedAt: String(member?.updatedAt || member?.updated_at || _nowIso()),
    };
    if (accountId) row.accountId = accountId;
    return row;
  }

  function _localAvatar() {
    try {
      return String(localStorage.getItem('meldex-avatar') || '');
    } catch {
      return '';
    }
  }

  function _workspaceId() {
    return 'ws-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  }

  function _workspaceFolderPath(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const registry = window.MeldexSourceFolderRegistry;
    if (raw.startsWith('/') && registry?.virtualPathFromDropboxPath) {
      return _normalizeFolderPath(registry.virtualPathFromDropboxPath(raw));
    }
    return _normalizeFolderPath(raw);
  }

  function _normalizeCloudWorkspace(raw) {
    const folder = _workspaceFolderPath(raw?.folder || raw?.path || '');
    const id = String(raw?.id || '').trim() || (folder ? _fnvFileId(folder).slice(0, 18) : '');
    if (!id) return null;
    const members = (Array.isArray(raw?.members) ? raw.members : [])
      .map(member => _workspaceMember(member))
      .filter(Boolean);
    return {
      id,
      name: String(raw?.name || _basename(folder) || 'ワークスペース'),
      folder,
      visible: raw?.visible !== false,
      deleted: raw?.deleted === true,
      createdAt: String(raw?.createdAt || raw?.created_at || _nowIso()),
      updatedAt: String(raw?.updatedAt || raw?.updated_at || _nowIso()),
      deletedAt: raw?.deletedAt || raw?.deleted_at || '',
      sourceFolderIds: Array.isArray(raw?.sourceFolderIds) ? raw.sourceFolderIds.map(String) : [],
      members,
    };
  }

  function _normalizeWorkspaceStore(raw) {
    const rows = Array.isArray(raw?.workspaces) ? raw.workspaces : (Array.isArray(raw) ? raw : []);
    return {
      kind: 'meldex-cloud-workspaces',
      version: 1,
      updatedAt: String(raw?.updatedAt || raw?.updated_at || ''),
      workspaces: rows.map(_normalizeCloudWorkspace).filter(Boolean),
    };
  }

  async function _readCloudWorkspaceStore() {
    const provider = await _requirePwaProvider('read');
    const kind = window.MeldexSystemStorage?.SystemStorageKind?.PROFILES_WORKSPACE;
    if (!kind) throw new Error('ワークスペース管理データ契約が未初期化です');
    const managed = await _readManagementPayload(provider, kind, PWA_WORKSPACES_DOCUMENT_ID);
    const data = managed.payload
      || await _readJsonSafe(provider, PWA_WORKSPACES_FILE, { workspaces: [] });
    return _normalizeWorkspaceStore(data);
  }

  async function _resolveCloudWorkspaceFolder(workspaceId) {
    const id = String(workspaceId || '').trim();
    if (!id) return '';
    const store = await _readCloudWorkspaceStore();
    const workspace = store.workspaces.find(item => item?.id === id && item.deleted !== true);
    if (!workspace) throw _httpError(404, 'ワークスペースが見つかりません');
    const folder = _workspaceFolderPath(workspace.folder || '');
    if (!folder) throw _httpError(409, 'ワークスペースのDropboxフォルダが設定されていません');
    return folder;
  }

  window.__MeldexPwaDataAccessInternals._resolveCloudWorkspaceFolder = _resolveCloudWorkspaceFolder;

  async function _updateCloudWorkspaceStore(updater) {
    const provider = await _requirePwaProvider('readwrite');
    let latest = null;
    const apply = current => {
      const store = _normalizeWorkspaceStore(current);
      const next = updater(store);
      if (next === false) return false;
      latest = _normalizeWorkspaceStore(next || store);
      latest.updatedAt = _nowIso();
      return latest;
    };
    const kind = window.MeldexSystemStorage?.SystemStorageKind?.PROFILES_WORKSPACE;
    if (!kind) throw new Error('ワークスペース管理データ契約が未初期化です');
    const result = await _writeManagementPayload(
      provider,
      kind,
      PWA_WORKSPACES_DOCUMENT_ID,
      current => {
        const next = apply(current || { kind: 'meldex-cloud-workspaces', version: 1, workspaces: [] });
        return next === false ? _normalizeWorkspaceStore(current || {}) : next;
      },
    );
    return result ? latest : null;
  }

  function _currentWorkspaceMember(body, role) {
    const name = String(body?.user || body?.name || (typeof getUsername === 'function' ? getUsername() : '') || 'anonymous').trim() || 'anonymous';
    return _workspaceMember({
      name,
      role: role || 'owner',
      avatar: body?.avatar || _localAvatar(),
      accountId: body?.accountId || body?.account_id || '',
      updatedAt: _nowIso(),
    });
  }

  async function _cloudWorkspaceList() {
    const store = await _readCloudWorkspaceStore();
    return { workspaces: store.workspaces.filter(item => item && item.deleted !== true) };
  }

  async function _cloudCreateWorkspace(body) {
    const folder = _workspaceFolderPath(body?.folder || body?.path || '');
    if (!folder) throw _httpError(400, 'ワークスペースにするフォルダを指定してください');
    let created = null;
    await _updateCloudWorkspaceStore(store => {
      if (store.workspaces.some(item => item.deleted !== true && _normalizeFolderPath(item.folder) === folder)) {
        throw _httpError(409, 'このフォルダは既にワークスペースに登録されています');
      }
      const now = _nowIso();
      created = _normalizeCloudWorkspace({
        id: _workspaceId(),
        name: String(body?.name || _basename(folder) || 'ワークスペース').trim(),
        folder,
        visible: true,
        createdAt: now,
        updatedAt: now,
        members: [_currentWorkspaceMember(body, 'owner')].filter(Boolean),
      });
      store.workspaces.push(created);
      return store;
    });
    return { ok: true, workspace: created };
  }

  async function _cloudUpdateWorkspace(id, body) {
    let updated = null;
    await _updateCloudWorkspaceStore(store => {
      const target = store.workspaces.find(item => item.id === id && item.deleted !== true);
      if (!target) throw _httpError(404, 'ワークスペースが見つかりません');
      if (Object.prototype.hasOwnProperty.call(body || {}, 'name')) target.name = String(body.name || target.name || 'ワークスペース').trim();
      if (Object.prototype.hasOwnProperty.call(body || {}, 'folder')) target.folder = _workspaceFolderPath(body.folder || target.folder || '');
      target.updatedAt = _nowIso();
      updated = _normalizeCloudWorkspace(target);
      Object.assign(target, updated);
      return store;
    });
    return { ok: true, workspace: updated };
  }

  async function _cloudDeleteWorkspace(id) {
    await _updateCloudWorkspaceStore(store => {
      const target = store.workspaces.find(item => item.id === id && item.deleted !== true);
      if (!target) throw _httpError(404, 'ワークスペースが見つかりません');
      target.deleted = true;
      target.deletedAt = _nowIso();
      target.updatedAt = target.deletedAt;
      return store;
    });
    return { ok: true };
  }

  async function _cloudUpsertWorkspaceMember(id, name, body) {
    let workspace = null;
    await _updateCloudWorkspaceStore(store => {
      const target = store.workspaces.find(item => item.id === id && item.deleted !== true);
      if (!target) throw _httpError(404, 'ワークスペースが見つかりません');
      const targetName = String(name || '').trim();
      const existingIndex = target.members.findIndex(item => item.name === targetName);
      const existing = existingIndex >= 0 ? target.members[existingIndex] : {};
      const accountId = String(body?.accountId || body?.account_id || existing?.accountId || '').trim();
      const member = _workspaceMember({
        ...existing,
        name: targetName,
        role: body?.role || existing?.role || 'member',
        avatar: Object.prototype.hasOwnProperty.call(body || {}, 'avatar') ? body.avatar : (existing?.avatar || ''),
        accountId,
        updatedAt: _nowIso(),
      }, targetName);
      if (!member) throw _httpError(400, 'メンバー名を指定してください');
      if (accountId) {
        target.members = target.members.filter((item, index) => index === existingIndex || item?.accountId !== accountId);
      }
      const index = target.members.findIndex(item => item.name === member.name);
      if (index >= 0) target.members[index] = { ...target.members[index], ...member };
      else target.members.push(member);
      target.updatedAt = _nowIso();
      workspace = _normalizeCloudWorkspace(target);
      Object.assign(target, workspace);
      return store;
    });
    return { ok: true, workspace };
  }

  async function _cloudRemoveWorkspaceMember(id, name) {
    await _updateCloudWorkspaceStore(store => {
      const target = store.workspaces.find(item => item.id === id && item.deleted !== true);
      if (!target) throw _httpError(404, 'ワークスペースが見つかりません');
      target.members = target.members.filter(member => member.name !== name);
      target.updatedAt = _nowIso();
      return store;
    });
    return { ok: true };
  }

  async function _cloudSyncWorkspaceProfile(id, body) {
    return _cloudUpsertWorkspaceMember(id, String(body?.name || body?.user || (typeof getUsername === 'function' ? getUsername() : 'anonymous')), {
      role: body?.role || 'member',
      avatar: body?.avatar || _localAvatar(),
      accountId: body?.accountId || body?.account_id || '',
    });
  }

  async function _cloudPickWorkspaceFolder() {
    const picker = window.MeldexDropboxFolderPicker?.pickFolder || window.GBFolderPicker?.pickFolder;
    if (typeof picker === 'function') {
      const picked = await picker({ title: 'ワークスペースにするフォルダを選択' });
      const path = _workspaceFolderPath(window.GBFolderPicker?.toSourceRelativePath?.(picked) || picked?.path || picked?.relativePath || '');
      if (path) return { ok: true, path, name: _basename(path) || path };
    }
    return { ok: false, path: '', manual: true };
  }

  // --- 個人設定（テーマなどの見た目）の保存先 ---------------------------------
  // デスクトップ版と同じ「その人自身のDropbox個人管理領域」を読み書きする。
  // どちらの環境から開いても同じ実体を見るため、片方で整えた見た目がもう片方にも届く。
  const PERSONAL_PREFERENCE_DOCUMENTS = new Set(['theme-settings', 'shortcut-settings', 'topic-layout-templates']);

  function _personalPreferenceKind() {
    const contract = window.MeldexSystemStorage;
    if (!contract) throw new Error('gb-system-storage.js が読み込まれていません');
    return contract.SystemStorageKind.USER_PREFERENCES;
  }

  async function _personalPreferenceAdapter() {
    if (_runtime()?.isBrowserMode?.()) {
      const provider = await _requirePwaProvider('read');
      return provider?.getSystemStorageAdapter?.() || null;
    }
    const factory = window.MeldexSystemStorageDropbox;
    const resolver = window.MeldexDropboxManagementRootResolver;
    if (!factory || !resolver?.resolveAdapterForProvider) return null;
    return resolver.resolveAdapterForProvider('dropbox', { personalOnly: true });
  }

  function _assertPersonalPreferenceName(name) {
    const doc = String(name || '').trim();
    if (!PERSONAL_PREFERENCE_DOCUMENTS.has(doc)) throw _httpError(404, `未知の個人設定です: ${name}`);
    return doc;
  }

  async function _readPersonalPreference(name) {
    const doc = _assertPersonalPreferenceName(name);
    let adapter = null;
    try {
      adapter = await _personalPreferenceAdapter();
    } catch {
      adapter = null;
    }
    if (!adapter) return { available: false, exists: false, payload: null, revision: null };
    const record = await adapter.load(_personalPreferenceKind(), doc);
    if (!record) return { available: true, exists: false, payload: null, revision: null };
    return { available: true, exists: true, payload: record.payload, revision: record.revision };
  }

  async function _writePersonalPreference(name, body) {
    const doc = _assertPersonalPreferenceName(name);
    const payload = body?.payload;
    if (!payload || typeof payload !== 'object') throw _httpError(400, 'payload はオブジェクトである必要があります');
    let adapter = null;
    try {
      adapter = await _personalPreferenceAdapter();
    } catch {
      adapter = null;
    }
    if (!adapter) return { available: false, ok: false, revision: null };
    const options = {};
    if (Object.prototype.hasOwnProperty.call(body || {}, 'expectedRevision')) {
      options.expectedRevision = body.expectedRevision || null;
    }
    const record = await adapter.save(_personalPreferenceKind(), doc, payload, options);
    return { available: true, ok: true, revision: record?.revision || null };
  }

  // ---- クラウド直結（端末内保存／Dropboxの両バックエンド）の圧縮・解凍・ZIP閲覧 ----
  // デスクトップ版 app/meldex_archive_service.py と同じ安全上限・巻き戻し方針を
  // gb-archive-zip-engine.js（自己完結ZIPエンジン）+ 既存のfileops抽象で実現する。

  async function _collectFolderFilesForZip(provider, folderPath, arcPrefix, entries) {
    const dirEntries = await _listDirectoryEntries(provider, folderPath);
    for (const entry of dirEntries) {
      const childPath = _joinPath(folderPath, entry.name);
      const childArcName = arcPrefix ? `${arcPrefix}/${entry.name}` : entry.name;
      if (entry.handle.kind === 'directory') {
        await _collectFolderFilesForZip(provider, childPath, childArcName, entries);
      } else {
        const file = await entry.handle.getFile();
        entries.push({ name: childArcName, data: new Uint8Array(await file.arrayBuffer()) });
      }
    }
  }

  function _requireArchiveEngine() {
    const engine = window.MeldexArchiveZipEngine;
    if (!engine) throw _httpError(500, '圧縮・解凍機能を読み込めませんでした。ページを再読み込みしてください');
    return engine;
  }

  async function _archiveCompress(provider, body) {
    const engine = _requireArchiveEngine();
    const rawPaths = Array.isArray(body?.paths) ? body.paths : [body?.path];
    const sourcePaths = rawPaths.map((value) => _normalizeFolderPath(String(value || ''))).filter(Boolean);
    if (!sourcePaths.length) throw _httpError(400, '圧縮対象を指定してください');

    const entries = [];
    for (const sourcePath of sourcePaths) {
      const resolved = await _resolveEntryHandle(provider, sourcePath);
      if (!resolved) throw _httpError(404, '圧縮対象が見つかりません');
      const baseName = _basename(sourcePath);
      if (resolved.kind === 'file') {
        const file = await resolved.handle.getFile();
        entries.push({ name: baseName, data: new Uint8Array(await file.arrayBuffer()) });
      } else {
        await _collectFolderFilesForZip(provider, sourcePath, baseName, entries);
      }
    }

    // 完成したZIPだけを最終名で置く。生成途中のZIPが保存先に残ることはない。
    const zipBytes = await engine.buildZip(entries);

    const rawOutput = String(body?.output_path || body?.outputPath || '').trim();
    let outputDir;
    let outputStem;
    if (rawOutput) {
      const normalizedOutput = _normalizeFolderPath(rawOutput);
      outputDir = _dirname(normalizedOutput);
      outputStem = _splitNameAndExt(_basename(normalizedOutput)).stem || _basename(normalizedOutput);
    } else {
      const first = sourcePaths[0];
      outputDir = _dirname(first);
      const firstStem = _splitNameAndExt(_basename(first)).stem || _basename(first);
      outputStem = firstStem + (sourcePaths.length > 1 ? '_他' : '');
    }
    const finalStem = await _uniqueName(provider, outputDir, outputStem, '.zip');
    const finalName = `${finalStem}.zip`;
    const outputPath = _joinPath(outputDir, finalName);
    await _writeBytes(provider, outputPath, zipBytes);
    return { ok: true, path: outputPath, name: finalName, count: sourcePaths.length };
  }

  async function _archiveReadArchiveBytes(provider, rawArchivePath) {
    const normalizedArchivePath = _normalizeFolderPath(rawArchivePath);
    if (_splitNameAndExt(_basename(normalizedArchivePath)).ext.toLowerCase() !== '.zip') {
      throw _httpError(404, 'ZIPファイルが見つかりません');
    }
    const resolved = await _resolveEntryHandle(provider, normalizedArchivePath);
    if (!resolved || resolved.kind !== 'file') throw _httpError(404, 'ZIPファイルが見つかりません');
    const file = await resolved.handle.getFile();
    const bytes = new Uint8Array(await file.arrayBuffer());
    return { normalizedArchivePath, bytes };
  }

  async function _archiveBrowse(provider, url) {
    const engine = _requireArchiveEngine();
    const { normalizedArchivePath, bytes } = await _archiveReadArchiveBytes(provider, url.searchParams.get('path') || '');
    let parsed;
    try {
      parsed = await engine.parseZip(bytes);
    } catch (error) {
      throw _httpError(error?.status || 400, error?.message || 'ZIPを読み込めませんでした');
    }
    let member;
    try {
      member = engine.normalizeMemberPath(url.searchParams.get('member') || '', { allowRoot: true });
    } catch (error) {
      throw _httpError(error?.status || 400, error?.message || '安全でないZIP内パスです');
    }
    const prefix = member ? `${member}/` : '';
    const childrenByKey = new Map();
    for (const info of parsed.members.values()) {
      if (prefix && !info.name.startsWith(prefix)) continue;
      const remainder = info.name.slice(prefix.length);
      if (!remainder) continue;
      const slashIndex = remainder.indexOf('/');
      const leaf = slashIndex >= 0 ? remainder.slice(0, slashIndex) : remainder;
      const isDir = slashIndex >= 0 || info.isDir;
      const childMember = prefix + leaf;
      const key = leaf.toLowerCase();
      const existing = childrenByKey.get(key);
      if (existing && existing.is_dir !== isDir) {
        throw _httpError(400, `ファイルとフォルダが衝突しています: ${leaf}`);
      }
      if (existing) continue;
      childrenByKey.set(key, {
        name: leaf,
        path: `zip:${normalizedArchivePath}!/${childMember}`,
        type: engine.entryType(leaf, isDir),
        is_dir: isDir,
        size: isDir ? null : info.size,
        modified: info.modifiedIso,
        ext: isDir ? '' : _splitNameAndExt(leaf).ext.toLowerCase(),
        archive_path: normalizedArchivePath,
        archive_member: childMember,
        read_only: true,
      });
    }
    const items = Array.from(childrenByKey.values()).sort((a, b) => {
      if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1;
      return a.name.localeCompare(b.name, 'ja', { sensitivity: 'base' });
    });
    return {
      ok: true,
      archive_path: normalizedArchivePath,
      member,
      name: member ? (member.split('/').pop() || member) : _basename(normalizedArchivePath),
      read_only: true,
      message: 'ZIP内は読み取り専用です',
      items,
    };
  }

  function _archiveBytesToBase64(bytes) {
    let binary = '';
    const chunkSize = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      binary += String.fromCharCode.apply(null, bytes.subarray(offset, offset + chunkSize));
    }
    return btoa(binary);
  }

  async function _archiveFile(provider, url) {
    const engine = _requireArchiveEngine();
    try {
      const result = await engine.readArchiveMemberViaProvider(
        provider,
        url.searchParams.get('path') || '',
        url.searchParams.get('member') || '',
      );
      return {
        ok: true,
        name: result.name,
        mime: result.mime,
        size: result.bytes.length,
        data: `data:${result.mime};base64,${_archiveBytesToBase64(result.bytes)}`,
      };
    } catch (error) {
      throw _httpError(error?.status || 400, error?.message || 'ZIP内のファイルを読み込めませんでした');
    }
  }

  function _archiveExtractDirName(archivePath) {
    const base = _basename(archivePath);
    if (base.toLowerCase().endsWith('.zip')) return base.slice(0, -4);
    return _splitNameAndExt(base).stem || base;
  }

  // 圧縮ファイルからの制作管理シート定義の上書き保護（Cloud版）。
  //
  // デスクトップ版 meldex_api_shell._check_managed_sheet は
  // meldex_production_management_support.production_sheet_folder_note_name を
  // archive_service.extract_zip_archive の target_check に渡し、ZIP内の各メンバーの
  // 「解凍先での最終パス」が「…/制作管理/シート/<シート名>/<シート名>.md」に一致したら
  // 実際の書き込み（一時展開すら）を始める前に 409 で拒否する。ここではその判定規則を
  // JSへ移植し、_archiveExtract でも書き込み開始前（decode/write より前）に同じ判定を行う。
  //
  // 正規化はデスクトップ版 normalized_path_segments / path_segments_match と揃える:
  // 区切り記号の統一（\ → /）、先頭・途中の "."、末尾スラッシュ、".." の字句解決、
  // Unicode NFC正規化、英字の大文字小文字を無視した比較。判定はパスの「末尾4要素」
  // （制作管理/シート/<name>/<name>.md）で行い、vaultのどの階層に制作管理があっても
  // 検出できるようにする（デスクトップ版と同じ仕様）。
  //
  // 既存の gb-data-access-dropbox-fileops-core.js の _isProductionFolderNotePath と
  // gb-data-access-dropbox-expanded.part01.js の _isProductionProtectedStructurePath は
  // どちらも「先頭からの4要素・単純な===比較」で判定しており、(1) 別ファイルのIIFE内に
  // ローカル定義されているためここから参照できない、(2) NFC正規化・大文字小文字無視を
  // 行っていない、という理由でここでは再利用せず、デスクトップ版と厳密に揃えた実装を
  // 別名で用意する（二重実装ではあるが、既存2箇所も既に同種の理由でそれぞれ独立している）。
  const _PM_ROOT_NAME = '制作管理';
  const _PM_SHEETS_DIR = 'シート';

  function _pmNormalizedPathSegments(path) {
    const text = String(path || '').replace(/\\/g, '/');
    const segments = [];
    for (const raw of text.split('/')) {
      const part = raw.trim().normalize('NFC');
      if (!part || part === '.') continue;
      if (part === '..') { segments.pop(); continue; }
      segments.push(part);
    }
    return segments;
  }

  function _pmSegmentsMatch(actual, expected) {
    // Python版の str.casefold() 相当が無いため toLowerCase() で代用する。
    // 比較対象は日本語のフォルダ名（大文字小文字の概念が無い）と ".md" 拡張子のみのため、
    // casefold と toLowerCase の差（一部の特殊文字での展開規則差）は実用上影響しない。
    return String(actual || '').normalize('NFC').toLowerCase()
      === String(expected || '').normalize('NFC').toLowerCase();
  }

  function _pmManagedSheetFolderNoteName(path) {
    const segments = _pmNormalizedPathSegments(path);
    if (segments.length < 4) return '';
    const note = segments[segments.length - 1];
    const sheet = segments[segments.length - 2];
    const sheetsDir = segments[segments.length - 3];
    const root = segments[segments.length - 4];
    if (!sheet) return '';
    if (!_pmSegmentsMatch(root, _PM_ROOT_NAME)) return '';
    if (!_pmSegmentsMatch(sheetsDir, _PM_SHEETS_DIR)) return '';
    return _pmSegmentsMatch(note, `${sheet}.md`) ? sheet : '';
  }

  function _pmIsManagedSheetFolderNotePath(path) {
    return !!_pmManagedSheetFolderNoteName(path);
  }

  async function _archiveExtract(provider, body) {
    const engine = _requireArchiveEngine();
    const rawPath = String(body?.path || '').trim();
    if (!rawPath) throw _httpError(400, '解凍対象を指定してください');
    const normalizedArchivePath = _normalizeFolderPath(rawPath);
    const archiveExt = _splitNameAndExt(_basename(normalizedArchivePath)).ext.toLowerCase();
    if (archiveExt !== '.zip') {
      throw _httpError(400, 'クラウド版ではZIP形式以外の圧縮ファイルは解凍できません。デスクトップ版をご利用ください');
    }
    const archiveHandle = await _resolveEntryHandle(provider, normalizedArchivePath);
    if (!archiveHandle || archiveHandle.kind !== 'file') throw _httpError(404, '圧縮ファイルが見つかりません');
    const archiveFile = await archiveHandle.handle.getFile();
    const archiveBytes = new Uint8Array(await archiveFile.arrayBuffer());

    let parsed;
    try {
      parsed = await engine.parseZip(archiveBytes);
    } catch (error) {
      throw _httpError(error?.status || 400, error?.message || 'ZIPを読み込めませんでした');
    }

    const rawOutputDir = String(body?.output_dir || body?.outputDir || '').trim();
    const outputDir = rawOutputDir
      ? _normalizeFolderPath(rawOutputDir)
      : _joinPath(_dirname(normalizedArchivePath), _archiveExtractDirName(normalizedArchivePath));
    if (!outputDir) throw _httpError(400, '解凍先を決められませんでした');

    const existingOutput = await _resolveEntryHandle(provider, outputDir);
    if (existingOutput) {
      if (existingOutput.kind !== 'directory') throw _httpError(409, `解凍先が既に存在します: ${_basename(outputDir)}`);
      const existingChildren = await _listDirectoryEntries(provider, outputDir);
      if (existingChildren.length) throw _httpError(409, `解凍先が既に存在します: ${_basename(outputDir)}`);
    }
    const outputPreexisted = !!existingOutput;

    // デスクトップ版と同じ保護: 解凍先での最終パスが制作管理シートのフォルダノート
    // （…/制作管理/シート/<シート名>/<シート名>.md）に一致するメンバーが1件でもあれば、
    // 一時展開・書き込みを一切始める前に拒否する。
    for (const info of parsed.members.values()) {
      const finalPath = _joinPath(outputDir, info.name);
      if (_pmIsManagedSheetFolderNotePath(finalPath)) {
        throw _httpError(409, '圧縮ファイルから制作管理のシート定義は上書きできません');
      }
    }

    // 全メンバーを先に検証・復元してから書き込みを始める
    // （壊れたZIP・上限超過なら書き込みを一切始めない）。
    const members = Array.from(parsed.members.values());
    const decodedFiles = [];
    for (const info of members) {
      if (info.isDir) continue;
      let data;
      try {
        data = await engine.extractMember(archiveBytes, info);
      } catch (error) {
        throw _httpError(error?.status || 400, error?.message || 'ZIPの展開に失敗しました');
      }
      decodedFiles.push({ name: info.name, data });
    }

    async function rollback() {
      try {
        if (outputPreexisted) {
          const leftovers = await _listDirectoryEntries(provider, outputDir);
          for (const leftover of leftovers) {
            await _removeEntry(provider, _joinPath(outputDir, leftover.name));
          }
        } else {
          await _removeEntry(provider, outputDir);
        }
      } catch (_) {
        // 巻き戻し自体の失敗は、呼び出し元へ伝える元のエラーを優先する
      }
    }

    try {
      for (const info of members) {
        if (!info.isDir) continue;
        await _directoryHandle(provider, _joinPath(outputDir, info.name), true);
      }
      if (!members.length) await _directoryHandle(provider, outputDir, true);
      for (const file of decodedFiles) {
        await _writeBytes(provider, _joinPath(outputDir, file.name), file.data);
      }
    } catch (error) {
      await rollback();
      throw _httpError(500, `解凍中にエラーが発生しました: ${error?.message || error}`);
    }

    return { ok: true, path: outputDir, name: _basename(outputDir), count: decodedFiles.length };
  }

  async function _handleArchiveRoute(pathname, method, body, url) {
    const provider = await _requirePwaProvider(method === 'GET' ? 'read' : 'readwrite');
    if (pathname === '/archive/compress' && method === 'POST') return _archiveCompress(provider, body);
    if (pathname === '/archive/extract' && method === 'POST') return _archiveExtract(provider, body);
    if (pathname === '/archive/browse' && method === 'GET') return _archiveBrowse(provider, url);
    if (pathname === '/archive/file' && method === 'GET') return _archiveFile(provider, url);
    throw _httpError(404, '未対応のアーカイブ操作です');
  }

  async function _pwaJsonRequest(path, opts) {
    const method = String(opts?.method || 'GET').toUpperCase();
    const body = opts?.body && typeof opts.body === 'string' ? JSON.parse(opts.body) : (opts?.body || {});
    const url = new URL('http://local' + String(path || ''));
    const pathname = url.pathname;

    if (pathname === '/vault' && method === 'GET') return _pwaWorkspaceDescriptor();
    if (pathname === '/vaults' && method === 'GET') {
      const workspace = await _pwaWorkspaceDescriptor();
      return { vaults: workspace.name ? [workspace] : [], current: workspace.path || '' };
    }
    if (pathname === '/outliner-roots' && method === 'GET') return _pwaRoots();
    if (pathname === '/outliner-roots' && method === 'PUT') return _setPwaRoots(body?.roots || []);
    if (pathname === '/home-folder' && method === 'GET') return _pwaHomeFolder();
    if (pathname === '/ui-config' && method === 'GET') return _safeReadJson(PWA_UI_CONFIG_KEY, {});
    if (pathname === '/ui-config' && method === 'PUT') {
      _safeWriteJson(PWA_UI_CONFIG_KEY, body || {});
      return { ok: true };
    }
    if (pathname === '/beta/consent') {
      const consentKey = 'meldex-beta-consent-v1';
      if (method === 'GET') return { consent: _safeReadJson(consentKey, null) };
      if (method === 'PUT') {
        _safeWriteJson(consentKey, body?.consent || null);
        return { ok: true, consent: body?.consent || null };
      }
      if (method === 'DELETE') {
        try { localStorage.removeItem(consentKey); } catch {}
        return { ok: true };
      }
    }
    if (pathname === '/system-fonts' && method === 'GET') return { families: [] };
    if (pathname === '/jobs' && method === 'GET') return { jobs: [] };
    if (pathname === '/startup-ready' && method === 'POST') return { ok: true };
    if (pathname === '/cli-chat/config' && method === 'GET') {
      return { enabled: false, providers: {}, available: false };
    }
    if (pathname === '/settings-db/debug-report/exists' && method === 'GET') return { exists: false };
    if (pathname === '/dropbox-link/status' && method === 'GET') {
      return {
        available: false,
        detected: false,
        activeSyncRoot: '',
        roots: [],
        unsharedLocalFolders: [],
      };
    }
    if (pathname === '/settings-transfer/status' && method === 'GET') {
      return {
        user_data_dir: 'このブラウザの端末内ストレージ',
        items: { config_file: { exists: false }, db_path: { exists: false } },
      };
    }
    if (pathname === '/file-associations/status' && method === 'GET') {
      return { ok: true, supported: false, apps: {} };
    }
    if (pathname === '/team' && method === 'GET') {
      const folder = url.searchParams.get('folder') || '';
      const team = await _readManagedTeamFile(folder);
      Object.entries(team.members || {}).forEach(([name, info]) => _cacheTeamAvatar(name, info?.avatar || '', folder));
      return _toTeamPayload(team);
    }
    if (pathname === '/team/sync' && method === 'POST') {
      const folder = body?.folder || '';
      return _syncTeamMember(folder, body);
    }
    if (pathname === '/team/merge' && method === 'POST') {
      const folder = body?.folder || '';
      return _mergeTeamMember(folder, body);
    }
    if (pathname === '/team/remove' && method === 'POST') {
      const folder = body?.folder || '';
      const name = String(body?.name || '').trim();
      await _writeTeamFileMerged(folder, team => {
        delete team.members[name];
        return team;
      });
      return { ok: true };
    }
    if (pathname === '/workspaces' && method === 'GET') return _cloudWorkspaceList();
    if (pathname === '/workspaces/pick-folder' && method === 'POST') return _cloudPickWorkspaceFolder();
    if (pathname === '/workspaces' && method === 'POST') return _cloudCreateWorkspace(body);
    {
      const syncMatch = pathname.match(/^\/workspaces\/([^/]+)\/sync-profile$/);
      if (syncMatch && method === 'POST') return _cloudSyncWorkspaceProfile(decodeURIComponent(syncMatch[1]), body);
      const memberMatch = pathname.match(/^\/workspaces\/([^/]+)\/members\/([^/]+)$/);
      if (memberMatch && method === 'PUT') return _cloudUpsertWorkspaceMember(decodeURIComponent(memberMatch[1]), decodeURIComponent(memberMatch[2]), body);
      if (memberMatch && method === 'DELETE') return _cloudRemoveWorkspaceMember(decodeURIComponent(memberMatch[1]), decodeURIComponent(memberMatch[2]));
      const itemMatch = pathname.match(/^\/workspaces\/([^/]+)$/);
      if (itemMatch && method === 'PUT') return _cloudUpdateWorkspace(decodeURIComponent(itemMatch[1]), body);
      if (itemMatch && method === 'DELETE') return _cloudDeleteWorkspace(decodeURIComponent(itemMatch[1]));
    }
    if (pathname === '/file-ids' && method === 'POST') {
      const result = {};
      (Array.isArray(body?.paths) ? body.paths : []).forEach((pathValue) => {
        const key = String(pathValue || '');
        result[key] = key ? _fnvFileId(_normalizePath(key)) : null;
      });
      return result;
    }
    if (pathname === '/version' && method === 'GET') {
      const semver = String(window.MeldexCloudRuntimeConfig?.version?.semver || window.MeldexReleaseConfig?.fallbackSemver || '0.5.x').replace(/^v/i, '').split(/\s+/)[0] || '0.5.x';
      const betaLabel = String(window.MeldexReleaseConfig?.betaLabel || 'BETA');
      const variant = _runtime()?.isBrowserMode?.() ? 'browser-local' : 'dropbox';
      return { version: `v${semver} ${betaLabel}`, semver, variant, build: '', commit: '' };
    }
    // ブラウザからはOSのアクセントカラーを読めない。以前は固定の青を返していたが、
    // それは「OSの設定を反映した色」ではないため、デスクトップ版と見た目がずれる原因になる。
    // 取得できないことを正直に返し、テーマ側はブラウザ標準のアクセント色へ委ねる。
    if (pathname === '/os-accent-color' && method === 'GET') return { color: '', available: false };
    if (pathname.startsWith('/personal-preferences/')) {
      const name = pathname.slice('/personal-preferences/'.length);
      if (method === 'GET') return _readPersonalPreference(name);
      if (method === 'PUT') return _writePersonalPreference(name, body);
    }
    if (pathname.startsWith('/archive/')) {
      return _handleArchiveRoute(pathname, method, body, url);
    }

    for (const handler of window.__MeldexPwaDataAccessExtensions || []) {
      const result = await handler({ method, body, url, pathname, headers: opts?.headers });
      if (result !== NOT_HANDLED) return result;
    }
    return NOT_HANDLED;
  }

  async function requestJson(path, opts) {
    const started = performance.now();
    const requestOpts = opts || {};
    const mode = _runtime()?.getMode?.() || 'legacy';
    const logBase = {
      action: String(path || ''),
      method: _requestMethod(requestOpts),
      payload: _summarizePayload(requestOpts.body),
    };
    if (_runtime()?.isBrowserDataMode?.()) {
      const localResult = await _pwaJsonRequest(path, requestOpts);
      if (localResult === NOT_HANDLED) {
        _logCompare({ ...logBase, adapter: `${mode}-unhandled`, durationMs: Math.round(performance.now() - started) });
        const err = new Error('この操作を完了できませんでした。画面を更新してもう一度試してください。');
        err.status = 500;
        err.code = 'cloud_route_unwired';
        err.route = String(path || '');
        throw err;
      }
      _logCompare({ ...logBase, adapter: mode, durationMs: Math.round(performance.now() - started) });
      return localResult;
    }
    const result = await _legacyJsonRequest(path, requestOpts);
    _logCompare({ ...logBase, adapter: 'legacy', durationMs: Math.round(performance.now() - started), mode });
    return result;
  }

  function _teamAvatarUrl(name, query) {
    if (!_runtime()?.isBrowserDataMode?.()) return _resource().teamAvatar(name, query);
    const folder = query?.folder ? _normalizeFolderPath(query.folder) : '';
    return _cachedTeamAvatar(name, folder) || _avatarFallbackUrl(name);
  }

  function _authAvatarUrl(name, query) {
    if (!_runtime()?.isBrowserDataMode?.()) return _resource().authAvatar(name, query);
    if (typeof getUsername === 'function' && getUsername() === name) return localStorage.getItem('meldex-avatar') || _avatarFallbackUrl(name);
    return _avatarFallbackUrl(name);
  }

  window.MeldexDataAccess = {
    requestJson,
    putJson(path, body) {
      return requestJson(path, { method: 'PUT', body });
    },
    postJson(path, body) {
      return requestJson(path, { method: 'POST', body });
    },
    deleteJson(path) {
      return requestJson(path, { method: 'DELETE' });
    },
    bootstrap: {
      getWorkspace() {
        return requestJson('/vault');
      },
      getVault() {
        return requestJson('/vault');
      },
      getRoots() {
        return requestJson('/outliner-roots');
      },
      setRoots(roots) {
        return requestJson('/outliner-roots', { method: 'PUT', body: { roots } });
      },
      getHomeFolder() {
        return requestJson('/home-folder');
      },
      getUiConfig() {
        return requestJson('/ui-config');
      },
      setUiConfig(config) {
        return requestJson('/ui-config', { method: 'PUT', body: config });
      },
    },
    team: {
      syncProfile(payload) {
        return requestJson('/team/sync', { method: 'POST', body: payload });
      },
      listMembers(folder) {
        const query = folder ? ('?folder=' + encodeURIComponent(folder)) : '';
        return requestJson('/team' + query);
      },
      avatarUrl(name, query) {
        return _teamAvatarUrl(name, query);
      },
      authAvatarUrl(name, query) {
        return _authAvatarUrl(name, query);
      },
    },
    fileId: {
      resolvePaths(paths) {
        return requestJson('/file-ids', { method: 'POST', body: { paths } });
      },
      stableIdForPath(path) {
        return path ? _fnvFileId(_normalizePath(path)) : '';
      },
    },
    meta: {
      getVersion() {
        return requestJson('/version');
      },
      getOsAccentColor() {
        return requestJson('/os-accent-color');
      },
    },
  };
})();
