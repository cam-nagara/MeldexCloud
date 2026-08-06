(function () {
  'use strict';

  const internals = window.__MeldexPwaDataAccessInternals;
  const handlers = window.__MeldexPwaDataAccessExtensions;
  if (!internals || !Array.isArray(handlers)) return;

  const {
    NOT_HANDLED,
    _normalizeFolderPath,
    _joinPath,
    _dirname,
    _basename,
    _splitNameAndExt,
    _readJsonSafe,
    _validateItemName,
    _pathExists,
    _resolveEntryHandle,
    _moveConflictName,
    _fnvFileId,
    PWA_TRASH_DIR,
  } = internals;

  const STORE_PATH = '_meldex/file_locks.json'; // 旧パス読取フォールバック専用(新規書込では使わない。移行はPhase 5)
  const STORE_DOCUMENT_ID = 'file-lock-store';
  const SIGNATURE_SCOPE = 'file_locks';
  const SYSTEM_EXCLUDED = new Set(['_chat', '_skills', '_models', '_knowledge', '.meldex', '_meldex', '.trash', '_trash']);
  const REASON_TEMPLATES = ['確定済み', '公開済み', 'レビュー中', 'アーカイブ', '編集禁止'];

  // --- 共通ストレージ層(固有形式付随物廃止・管理データ一元化計画 Phase 4) -----------
  //
  // 保存先: `_meldex/file_locks.json` への直接読み書きから、共通ストレージ層
  // (種別 edit-locks、document_id 固定 'file-lock-store')へ載せ替える。
  // 監査ノート確認済みのとおり、この編集ロックはCloud/PWA専用でPC本体は
  // 別実装(meldex_file_locks.py、SQLite)を使うため、PCとの相互運用は不要。
  // 旧パスは読取フォールバックとしてのみ残す(移行はPhase 5)。
  //
  // ストアは管理スコープ(個人領域 / 参加中の各共有ワークスペース)ごとに1つ。
  // 対象文書パスから gb-dropbox-management-root-resolver.js の
  // resolveManagementScopeForPath でスコープを決め、共有ソース配下の文書の
  // ロックは共有管理領域のストアへ、entryのパスはそのスコープの正準形
  // (個人=ホーム同期ルート相対 / 共有=ワークスペードルート相対)で保存する。
  // 一覧のようにスコープを一意に決められない操作は resolveManagementScopesForProvider
  // で全スコープを集約する。HMAC署名(MeldexKnowledgeSignature)もストアと同じ
  // スコープの管理領域へ置く(別スコープの署名で相互に上書き・誤検証しないため)。

  function _resolver() {
    const resolver = window.MeldexDropboxManagementRootResolver;
    if (!resolver) throw new Error('gb-dropbox-management-root-resolver.js が読み込まれていません');
    return resolver;
  }

  async function _scopeForPath(provider, targetPath) {
    return _resolver().resolveManagementScopeForPath(provider, targetPath);
  }

  async function _allScopes(provider) {
    return _resolver().resolveManagementScopesForProvider(provider);
  }

  function _canonicalForScope(scope, localPath) {
    return _normalizeFolderPath(scope.toCanonicalPath(_normalizeFolderPath(localPath)));
  }

  // entryの正準パス(一義)。path_space === 'root' の新形式entryは保存済みの値が
  // そのまま正準形。旧形式entry(path_spaceなし)は書いたクライアントの接続ルート
  // 相対のローカルパスなので、「そのentryが載っているストアのスコープ」で解釈を
  // 一つに決める: 接続中スコープのストアにある旧entryは自分のローカルパスとして
  // 正準化し、非接続スコープ(共有ソース等)のストアにある旧entryは、そのルートへ
  // 直接接続していたクライアントが書いたもの(ローカル=正準)として扱う。
  // 二重解釈(両方を候補にする)は、別ソースの同名フォルダとの誤一致・誤解除を
  // 生むため行わない。
  function _entryCanonicalForms(entry, scope) {
    const stored = _normalizeFolderPath(entry?.path || '');
    if (!stored) return [];
    if (!scope || entry?.path_space === 'root' || !scope.isConnectedRootScope) return [stored];
    try {
      const reinterpreted = _canonicalForScope(scope, stored);
      return [reinterpreted || stored];
    } catch {
      return [stored]; // スコープ外のパスは正準化できない(保存値のまま照合する)。
    }
  }

  function _localizedEntry(entry, scope) {
    if (!scope || !entry) return entry;
    // 接続中スコープの旧形式entryは保存値が既にローカルパスなので変換しない。
    if (entry.path_space !== 'root' && scope.isConnectedRootScope) return entry;
    try {
      const local = _normalizeFolderPath(scope.toLocalPath(entry.path));
      if (local && local !== entry.path) {
        // 消費側(フォルダツリーのロック表示・編集抑止)は normalized_path と
        // file_id をローカルパス空間で照合するため、path だけでなく両方を
        // ローカルパス基準へ再計算して返す。
        return {
          ...entry,
          path: local,
          normalized_path: _normalize(local),
          file_id: _fnvFileId ? _fnvFileId(local) : entry.file_id,
        };
      }
    } catch {
      // 逆変換できない場合は保存済みのパスをそのまま表示する。
    }
    return entry;
  }

  function _role() {
    const state = window.MeldexRuntimeAdapter?.getWorkspaceState?.() || {};
    if (state.isOwner) return 'owner';
    if (state.access === 'viewer') return 'viewer';
    return 'editor';
  }

  function _requireOwner() {
    if (_role() !== 'owner') throw new Error('編集ロックの設定は管理者のみ可能です');
  }

  function _normalize(path) {
    return _normalizeFolderPath(path).toLowerCase();
  }

  function _isSystemExcluded(path) {
    const parts = _normalize(path).split('/').filter(Boolean);
    return parts.some(part => SYSTEM_EXCLUDED.has(part));
  }

  async function _allowedTrashRoots() {
    const roots = [{ path: _normalizeFolderPath(PWA_TRASH_DIR), name: 'Meldex' }];
    const registry = window.MeldexSourceFolderRegistry;
    if (typeof registry?.loadRegistry !== 'function' || typeof registry?.sourcePath !== 'function') return roots;
    let payload;
    try {
      payload = await registry.loadRegistry({ writeIfMissing: false });
    } catch (error) {
      const wrapped = new Error('ソースフォルダのゴミ箱設定を確認できませんでした');
      wrapped.code = 'trash_roots_unavailable';
      wrapped.cause = error;
      throw wrapped;
    }
    const seen = new Set(roots.map((root) => root.path));
    for (const source of Array.isArray(payload?.roots) ? payload.roots : []) {
      if (!source || source.deleted === true || !source.id) continue;
      const path = _normalizeFolderPath(registry.sourcePath(source.id, '_trash'));
      if (!path || seen.has(path)) continue;
      seen.add(path);
      roots.push({ path, name: String(source.name || source.dropboxPath || source.id) });
    }
    return roots;
  }

  async function _resolveAllowedTrashRoot(rawRoot) {
    const raw = String(rawRoot || '').trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    if (raw.split('/').some((part) => part === '.' || part === '..')) {
      const error = new Error('許可されていないゴミ箱です');
      error.code = 'invalid_trash_root';
      throw error;
    }
    const requested = _normalizeFolderPath(raw || PWA_TRASH_DIR);
    const matched = (await _allowedTrashRoots()).find((root) => root.path === requested);
    if (matched) return matched;
    const error = new Error('許可されていないゴミ箱です');
    error.code = 'invalid_trash_root';
    throw error;
  }

  function _invalidTrashRestorePath() {
    return Object.assign(new Error('元の保存先が安全な復元先ではありません'), {
      code: 'invalid_trash_original_path', status: 400,
    });
  }

  function _safeTrashRestoreRelativePath(rawPath) {
    const raw = String(rawPath || '').trim().replace(/\\/g, '/');
    const segments = raw.split('/');
    if (!raw || raw.startsWith('/') || segments.some((segment) => !segment
      || segment === '.' || segment === '..' || segment.startsWith('.') || segment.startsWith('_'))) throw _invalidTrashRestorePath();
    const normalized = _normalizeFolderPath(raw);
    if (!normalized || normalized !== raw) throw _invalidTrashRestorePath();
    return normalized;
  }

  async function _resolveValidatedTrashRestorePath(trashRoot, originalPath, fallbackPath = '') {
    const registry = window.MeldexSourceFolderRegistry;
    const rootPath = _normalizeFolderPath(trashRoot?.path || '');
    const rawOriginal = String(originalPath || '').trim().replace(/\\/g, '/');
    const candidate = rawOriginal || String(fallbackPath || '').trim().replace(/\\/g, '/');
    if (!candidate || candidate.startsWith('/')) throw _invalidTrashRestorePath();
    const parsedRoot = registry?.parseSourcePath?.(rootPath);
    const parsedOriginal = registry?.parseSourcePath?.(candidate);
    if (parsedRoot) {
      if (parsedRoot.relativePath !== '_trash' || typeof registry?.sourcePath !== 'function') throw _invalidTrashRestorePath();
      const relativePath = _safeTrashRestoreRelativePath(parsedOriginal ? parsedOriginal.relativePath : candidate);
      return registry.sourcePath(parsedRoot.sourceId, relativePath);
    }
    if (rootPath !== _normalizeFolderPath(PWA_TRASH_DIR)) throw _invalidTrashRestorePath();
    if (!parsedOriginal) return _safeTrashRestoreRelativePath(candidate);
    const relativePath = _safeTrashRestoreRelativePath(parsedOriginal.relativePath);
    const allowedSourceIds = new Set((await _allowedTrashRoots())
      .map((root) => registry?.parseSourcePath?.(root.path)?.sourceId || '').filter(Boolean));
    if (!allowedSourceIds.has(parsedOriginal.sourceId) || typeof registry?.sourcePath !== 'function') throw _invalidTrashRestorePath();
    return registry.sourcePath(parsedOriginal.sourceId, relativePath);
  }

  function _pathOrAncestorEntry(entries, canonicalTarget, scope) {
    const target = _normalize(canonicalTarget);
    if (!target) return null;
    return (entries || []).find(entry => _entryCanonicalForms(entry, scope).some((form) => {
      const base = form.toLowerCase();
      return base && (target === base || target.startsWith(base + '/'));
    })) || null;
  }

  function _descendantEntry(entries, canonicalTarget, scope) {
    const target = _normalize(canonicalTarget);
    if (!target) return null;
    return (entries || []).find(entry => _entryCanonicalForms(entry, scope).some((form) => {
      const base = form.toLowerCase();
      return base && (base === target || base.startsWith(target + '/'));
    })) || null;
  }

  function _cleanEntry(entry) {
    const path = _normalizeFolderPath(entry?.path || '');
    if (!path) return null;
    const normalized = _normalize(path);
    const cleaned = {
      path,
      normalized_path: normalized,
      file_id: String(entry?.file_id || (_fnvFileId ? _fnvFileId(path) : '')),
      locked_by: String(entry?.locked_by || ''),
      locked_at: String(entry?.locked_at || new Date().toISOString()),
      lock_reason: String(entry?.lock_reason || entry?.reason || '').trim(),
    };
    // 'root' = 管理スコープの正準パス(個人=ホーム同期ルート相対 / 共有=
    // ワークスペードルート相対)で保存された新形式。旧形式entry(接続ルート
    // 相対のローカルパス)にはこのフィールドが無く、照合時に再解釈する。
    if (entry?.path_space === 'root') cleaned.path_space = 'root';
    return cleaned;
  }

  async function _readLegacyRawStoreData(provider) {
    const exists = await _pathExists(provider, STORE_PATH).catch(() => false);
    if (!exists) return { data: { entries: [] }, found: false, revision: null };
    return { data: await _readJsonSafe(provider, STORE_PATH, { entries: [] }), found: true, revision: null };
  }

  async function _readRawStoreData(provider, scope) {
    if (scope) {
      try {
        const record = await scope.adapter.load(window.MeldexSystemStorage.SystemStorageKind.EDIT_LOCKS, STORE_DOCUMENT_ID);
        if (record) return { data: record.payload, found: true, revision: record.revision ?? null };
      } catch {
        // 「読めなかった」は「無かった」と区別する(loadFailed)。空ストア扱いの
        // まま書込へ進むと、全置換保存で既存ロックを消してしまうため、書込側は
        // loadFailed で拒否する。接続中スコープの読取は旧パスへフォールバック
        // して機能を維持する。
        if (!scope.isConnectedRootScope) {
          return { data: { entries: [] }, found: false, revision: null, loadFailed: true };
        }
        const legacy = await _readLegacyRawStoreData(provider);
        return { ...legacy, loadFailed: true };
      }
      // 新ストア未作成。旧パス(_meldex/file_locks.json)は接続中ルート配下に
      // しか存在しないため、別スコープ(共有ソース等)の読取へは混ぜない。
      if (!scope.isConnectedRootScope) return { data: { entries: [] }, found: false, revision: null };
    }
    return _readLegacyRawStoreData(provider);
  }

  async function _readStore(provider, scope) {
    const { data, found, revision, loadFailed } = await _readRawStoreData(provider, scope);
    if (!found) {
      return {
        entries: [],
        updated_at: '',
        revision: revision ?? null,
        loadFailed: !!loadFailed,
        verification: loadFailed
          ? { ok: false, reason: 'store-unavailable' }
          : { ok: true, skipped: true, reason: 'store-missing' },
      };
    }
    const entries = (Array.isArray(data?.entries) ? data.entries : []).map(_cleanEntry).filter(Boolean);
    const payload = { entries, updated_at: String(data?.updated_at || '') };
    const verifyOptions = scope
      ? { managementAdapter: scope.adapter, skipLegacyFallback: !scope.isConnectedRootScope }
      : undefined;
    const verification = await window.MeldexKnowledgeSignature?.verify?.(provider, SIGNATURE_SCOPE, payload, verifyOptions).catch(err => ({ ok: false, error: err?.message || String(err) }));
    return { ...payload, revision: revision ?? null, loadFailed: !!loadFailed, verification };
  }

  // スコープを解決できない場合(台帳破損等)も読取は継続する(旧パスのみ)。
  // 書込側は _assertStoreVerifiedForWrite / スコープ解決の例外で従来どおり
  // 安全側(拒否)に倒れる。
  async function _readStoreForTarget(provider, path) {
    let scope = null;
    try {
      scope = await _scopeForPath(provider, path);
    } catch {
      scope = null;
    }
    return { scope, store: await _readStore(provider, scope) };
  }

  function _assertStoreVerifiedForWrite(store) {
    if (store?.loadFailed) {
      // 既存ストアを読めていない状態で全置換保存すると既存ロックを消してしまう。
      const err = new Error('編集ロック情報を読み込めなかったため、ロック設定を更新できません');
      err.status = 503;
      err.code = 'lock_store_unavailable';
      throw err;
    }
    const verification = store?.verification;
    if (verification && verification.ok === false && !verification.skipped) {
      const err = new Error('編集ロック情報の署名検証に失敗したため、ロック設定を更新できません');
      err.status = 409;
      err.lock_verification = verification;
      throw err;
    }
  }

  async function _signStorePayload(provider, payload, scope) {
    if (typeof window.MeldexKnowledgeSignature?.sign !== 'function') {
      throw new Error('編集ロック情報の署名機能を読み込めませんでした');
    }
    const signature = await window.MeldexKnowledgeSignature.sign(provider, SIGNATURE_SCOPE, payload, {
      signer: typeof getUsername === 'function' ? getUsername() : '',
      managementAdapter: scope ? scope.adapter : null,
    });
    if (!signature?.ok || !signature.hmac) {
      throw new Error('編集ロック情報の署名を保存できませんでした');
    }
    return signature;
  }

  async function _writeStore(provider, scope, entries, audit, expectedRevision) {
    const payload = {
      entries: entries.map(_cleanEntry).filter(Boolean).sort((a, b) => a.normalized_path.localeCompare(b.normalized_path)),
      updated_at: new Date().toISOString(),
    };
    // CAS付き全置換: 読取時のrevision(未作成ならnull=create-only)を期待値に
    // して保存し、読取と保存の間の他クライアント更新を黙って上書きしない。
    await scope.adapter.save(window.MeldexSystemStorage.SystemStorageKind.EDIT_LOCKS, STORE_DOCUMENT_ID, payload, {
      expectedRevision: expectedRevision === undefined ? null : expectedRevision,
    });
    const signature = await _signStorePayload(provider, payload, scope);
    if (audit) await window.MeldexKnowledgeSignature?.recordAudit?.(provider, 'file_lock', audit).catch(() => {});
    return { ...payload, signature };
  }

  // 読取→判定→CAS保存を、競合時は読み直して最大5回まで再試行する。
  // updater(store) は false(変更なし) または { entries, result } を返す。
  async function _mutateLockStore(provider, scope, updater) {
    const contract = window.MeldexSystemStorage;
    const MAX_ATTEMPTS = 5;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      const store = await _readStore(provider, scope);
      _assertStoreVerifiedForWrite(store);
      const change = await updater(store);
      if (change === false) return undefined;
      try {
        await _writeStore(provider, scope, change.entries, change.audit, store.revision);
        return change.result;
      } catch (error) {
        if (contract && error instanceof contract.SystemStorageConflictError && attempt < MAX_ATTEMPTS - 1) continue;
        throw error;
      }
    }
    return undefined;
  }

  async function list(provider, query = '') {
    let scopes = null;
    try {
      scopes = await _allScopes(provider);
    } catch {
      scopes = null; // スコープ一覧を確定できない場合は旧パスのみの縮退読取。
    }
    const entries = [];
    let verification = null;
    let failedVerification = null;
    for (const scope of scopes || [null]) {
      const store = await _readStore(provider, scope);
      entries.push(...store.entries.map(entry => _localizedEntry(entry, scope)));
      if (!verification) verification = store.verification;
      if (!failedVerification && store.verification && store.verification.ok === false && !store.verification.skipped) {
        failedVerification = store.verification;
      }
    }
    const q = String(query || '').trim().toLowerCase();
    const filtered = q
      ? entries.filter(entry => `${entry.path} ${entry.lock_reason} ${entry.locked_by}`.toLowerCase().includes(q))
      : entries;
    return { entries: filtered, count: filtered.length, verification: failedVerification || verification };
  }

  async function check(provider, path) {
    const { scope, store } = await _readStoreForTarget(provider, path);
    const target = scope ? _canonicalForScope(scope, path) : _normalizeFolderPath(path);
    const entry = _pathOrAncestorEntry(store.entries, target, scope);
    const localized = entry ? _localizedEntry(entry, scope) : null;
    return { locked: !!entry, entry: localized, lock_reason: entry?.lock_reason || '', verification: store.verification };
  }

  async function requireUnlocked(provider, path, options = {}) {
    const localTarget = _normalizeFolderPath(path || options.path || '');
    if (!localTarget || _isSystemExcluded(localTarget)) return { ok: true, locked: false };
    const { scope, store } = await _readStoreForTarget(provider, localTarget);
    if (store.loadFailed) {
      // ロック台帳を読めない間は「ロックなし」と断定できない(特に共有スコープ
      // では他メンバーの編集ロックを素通りさせない)。安全側で変更を拒否する。
      const err = new Error('編集ロック情報を確認できないため変更できません: ' + localTarget);
      err.status = 503;
      err.code = 'lock_store_unavailable';
      throw err;
    }
    if (store.verification && store.verification.ok === false && !store.verification.skipped) {
      const err = new Error('編集ロック情報の署名検証に失敗しました');
      err.lock_verification = store.verification;
      throw err;
    }
    const target = scope ? _canonicalForScope(scope, localTarget) : localTarget;
    const entry = _pathOrAncestorEntry(store.entries, target, scope)
      || (options.includeDescendants ? _descendantEntry(store.entries, target, scope) : null);
    if (!entry) return { ok: true, locked: false };
    const err = new Error('編集ロック中のため変更できません: ' + localTarget);
    err.status = 423;
    err.lock_reason = entry.lock_reason || '';
    err.lock_entry = _localizedEntry(entry, scope);
    err.unlock_hint = '管理者が編集ロックを解除してから再実行してください。';
    throw err;
  }

  function _isDropboxConflictName(name) {
    const normalized = String(name || '').toLowerCase();
    return /\bconflicted\s+copy\b/.test(normalized) || /競合.*コピー/.test(normalized);
  }

  function _originalPathForConflict(conflictPath) {
    const normalized = _normalizeFolderPath(conflictPath);
    const name = _basename(normalized);
    const match = /^(.*)\s+\((?:[^)]*conflicted\s+copy[^)]*|[^)]*競合[^)]*コピー[^)]*)\)(\.[^.]*)?$/i.exec(name);
    if (!match) return '';
    const originalName = `${match[1]}${match[2] || ''}`.trim();
    return originalName ? _joinPath(_dirname(normalized), originalName) : '';
  }

  async function _uploadTargetPath(provider, url, body) {
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
    return targetPath;
  }

  async function _guardRename(provider, body) {
    const oldPath = _normalizeFolderPath(body?.old_path || '');
    const newName = _validateItemName(body?.new_name || '', 'new_name');
    const source = await _resolveEntryHandle(provider, oldPath);
    if (!source) return;
    await requireUnlocked(provider, oldPath, { action: 'rename-source', includeDescendants: source.kind === 'directory' });
    const parentPath = _dirname(oldPath);
    const sourceName = _basename(oldPath);
    const nextPath = source.kind === 'directory'
      ? _joinPath(parentPath, newName)
      : _joinPath(parentPath, newName + _splitNameAndExt(sourceName).ext);
    if (nextPath !== oldPath) await requireUnlocked(provider, nextPath, { action: 'rename-destination' });
  }

  async function _guardTrashRestore(provider, body) {
    const name = _validateItemName(body?.name || '', 'name');
    const trashRoot = await _resolveAllowedTrashRoot(body?.trash_root);
    const sourcePath = _joinPath(trashRoot.path, name);
    const source = await _resolveEntryHandle(provider, sourcePath);
    if (!source) return;
    const meta = await _readJsonSafe(provider, sourcePath + '._trash_meta.json', {});
    const baseDest = await _resolveValidatedTrashRestorePath(trashRoot, meta?.original_path || '', name);
    let destPath = baseDest;
    if (await _pathExists(provider, destPath)) {
      const split = _splitNameAndExt(_basename(baseDest));
      const baseDir = _dirname(baseDest);
      for (let counter = 1; await _pathExists(provider, destPath); counter += 1) {
        const stem = source.kind === 'directory' ? _basename(baseDest).replace(/_\d{4}$/, '') : split.stem;
        destPath = source.kind === 'directory'
          ? _joinPath(baseDir, `${stem}_restored_${String(counter).padStart(4, '0')}`)
          : _joinPath(baseDir, `${stem}_restored_${String(counter).padStart(4, '0')}${split.ext}`);
      }
    }
    await requireUnlocked(provider, destPath, { action: 'trash-restore', includeDescendants: source.kind === 'directory' });
  }

  async function _guardOutlinerRestore(provider, body) {
    const trashName = _validateItemName(body?.trash_name || '', 'trash_name');
    const trashRoot = await _resolveAllowedTrashRoot(body?.trash_root);
    const sourcePath = _joinPath(trashRoot.path, trashName);
    const source = await _resolveEntryHandle(provider, sourcePath);
    if (!source) return;
    const meta = await _readJsonSafe(provider, sourcePath + '._trash_meta.json', {});
    const originalPath = await _resolveValidatedTrashRestorePath(trashRoot, meta?.original_path || '');
    await requireUnlocked(provider, originalPath, { action: 'restore', includeDescendants: source.kind === 'directory' });
  }

  async function _guardDuplicate(provider, body) {
    const sourcePath = _normalizeFolderPath(body?.path || '');
    const source = await _resolveEntryHandle(provider, sourcePath);
    if (!source) return;
    const sourceName = _basename(sourcePath);
    const sourceSplit = _splitNameAndExt(sourceName);
    let destName = source.kind === 'file' ? `${sourceSplit.stem}_copy${sourceSplit.ext}` : `${sourceName}_copy`;
    let destPath = _joinPath(_dirname(sourcePath), destName);
    for (let counter = 2; await _pathExists(provider, destPath); counter += 1) {
      destName = source.kind === 'file' ? `${sourceSplit.stem}_copy${counter}${sourceSplit.ext}` : `${sourceName}_copy${counter}`;
      destPath = _joinPath(_dirname(sourcePath), destName);
    }
    await requireUnlocked(provider, destPath, { action: 'duplicate-destination', includeDescendants: source.kind === 'directory' });
  }

  async function _guardSaveAs(provider, body) {
    const sourcePath = _normalizeFolderPath(body?.path || '');
    const source = await _resolveEntryHandle(provider, sourcePath);
    if (!source) return;
    const sourceName = _basename(sourcePath);
    const sourceSplit = _splitNameAndExt(sourceName);
    const newName = String(body?.new_name || (source.kind === 'file' ? sourceSplit.stem : sourceName)).replace(/[\\/]/g, '').replace(/\.\./g, '').trim();
    if (!newName) throw new Error('不正なファイル名です');
    const destFolder = _normalizeFolderPath(body?.dest_folder || _dirname(sourcePath));
    let destName = source.kind === 'file' ? newName + sourceSplit.ext : newName;
    let destPath = _joinPath(destFolder, destName);
    for (let counter = 2; await _pathExists(provider, destPath); counter += 1) {
      destName = source.kind === 'file' ? `${newName}_${counter}${sourceSplit.ext}` : `${newName}_${counter}`;
      destPath = _joinPath(destFolder, destName);
    }
    await requireUnlocked(provider, destPath, { action: 'save-as-destination', includeDescendants: source.kind === 'directory' });
  }

  async function _guardMove(provider, body) {
    const sourcePath = _normalizeFolderPath(body?.path || '');
    const destFolder = _normalizeFolderPath(body?.dest_folder || '');
    const source = await _resolveEntryHandle(provider, sourcePath);
    if (!source) return;
    await requireUnlocked(provider, sourcePath, { action: 'move-source', includeDescendants: source.kind === 'directory' });
    const destEntry = await _resolveEntryHandle(provider, destFolder);
    if (!destEntry || destEntry.kind !== 'directory') return;
    const conflict = await _moveConflictName(provider, destFolder, _basename(sourcePath), source.kind === 'file');
    await requireUnlocked(provider, conflict.path, { action: 'move-destination', includeDescendants: source.kind === 'directory' });
  }

  async function _guardConflictResolve(provider, body) {
    const conflictPath = _normalizeFolderPath(body?.conflict_path || '');
    const action = String(body?.action || '');
    if (!conflictPath || !_isDropboxConflictName(_basename(conflictPath))) return;
    const originalPath = _originalPathForConflict(conflictPath);
    if (action === 'keep_original') {
      await requireUnlocked(provider, conflictPath, { action: 'conflict-remove' });
    } else if (action === 'keep_conflict') {
      if (originalPath) await requireUnlocked(provider, originalPath, { action: 'conflict-apply' });
      await requireUnlocked(provider, conflictPath, { action: 'conflict-remove' });
    }
  }

  async function guardMutationRequest({ method, body, url, pathname }) {
    if (method === 'GET') return;
    const guardedPaths = new Set([
      '/file',
      '/upload-file',
      '/cloud/conflict-resolve',
      '/outliner/add',
      '/outliner/rename',
      '/outliner/delete',
      '/outliner/delete-batch',
      '/outliner/restore',
      '/outliner/duplicate',
      '/outliner/save-as',
      '/outliner/move',
      '/version/restore',
      '/version/restore-folder',
      '/trash/restore',
    ]);
    if (!guardedPaths.has(pathname)) return;
    const provider = await internals._requirePwaProvider('readwrite');
    if (pathname === '/file' && (method === 'PUT' || method === 'POST')) {
      await requireUnlocked(provider, url.searchParams.get('path') || '', { action: 'write' });
    } else if (pathname === '/upload-file' && method === 'POST') {
      await requireUnlocked(provider, await _uploadTargetPath(provider, url, body || {}), { action: 'upload' });
    } else if (pathname === '/cloud/conflict-resolve' && method === 'POST') {
      await _guardConflictResolve(provider, body || {});
    } else if (pathname === '/outliner/add' && method === 'POST') {
      await requireUnlocked(provider, body?.parent || '', { action: 'create' });
    } else if (pathname === '/outliner/rename' && method === 'POST') {
      await _guardRename(provider, body || {});
    } else if (pathname === '/outliner/delete' && method === 'POST') {
      const targetPath = _normalizeFolderPath(body?.path || '');
      const source = await _resolveEntryHandle(provider, targetPath);
      await requireUnlocked(provider, targetPath, { action: 'delete', includeDescendants: source?.kind === 'directory' });
    } else if (pathname === '/outliner/delete-batch' && method === 'POST') {
      const items = Array.isArray(body?.items) ? body.items : [];
      for (const item of items) {
        const targetPath = _normalizeFolderPath(item?.path || '');
        if (!targetPath) continue;
        const source = await _resolveEntryHandle(provider, targetPath);
        await requireUnlocked(provider, targetPath, { action: 'delete', includeDescendants: source?.kind === 'directory' });
      }
    } else if (pathname === '/outliner/restore' && method === 'POST') {
      await _guardOutlinerRestore(provider, body || {});
    } else if (pathname === '/outliner/duplicate' && method === 'POST') {
      await _guardDuplicate(provider, body || {});
    } else if (pathname === '/outliner/save-as' && method === 'POST') {
      await _guardSaveAs(provider, body || {});
    } else if (pathname === '/outliner/move' && method === 'POST') {
      await _guardMove(provider, body || {});
    } else if (pathname === '/version/restore' && method === 'POST') {
      await requireUnlocked(provider, body?.path || '', { action: 'version-restore' });
    } else if (pathname === '/version/restore-folder' && method === 'POST') {
      await requireUnlocked(provider, body?.path || '', { action: 'folder-version-restore', includeDescendants: true });
    } else if (pathname === '/trash/restore' && method === 'POST') {
      await _guardTrashRestore(provider, body || {});
    }
  }

  async function setLock(provider, body = {}) {
    _requireOwner();
    const localPath = _normalizeFolderPath(body.path || '');
    if (!localPath) throw new Error('path は必須です');
    if (_isSystemExcluded(localPath)) throw new Error('システムフォルダは編集ロックできません');
    const scope = await _scopeForPath(provider, localPath); // 書込はスコープ不明時に拒否(安全側)
    const canonical = _canonicalForScope(scope, localPath);
    const entry = _cleanEntry({
      path: canonical,
      path_space: 'root',
      file_id: body.file_id,
      lock_reason: body.reason || body.lock_reason,
      locked_by: typeof getUsername === 'function' ? getUsername() : '',
      locked_at: new Date().toISOString(),
    });
    if (!entry) throw new Error('path は必須です');
    const targetLower = entry.normalized_path;
    const result = await _mutateLockStore(provider, scope, (store) => {
      const next = store.entries.filter(row => row.file_id !== entry.file_id
        && !_entryCanonicalForms(row, scope).some(form => form.toLowerCase() === targetLower));
      next.push(entry);
      return {
        entries: next,
        audit: { action: 'lock', path: localPath, reason: entry.lock_reason },
        result: { ok: true, entry: _localizedEntry(entry, scope) },
      };
    });
    return result || { ok: true, entry: _localizedEntry(entry, scope) };
  }

  async function unlock(provider, path) {
    _requireOwner();
    const localPath = _normalizeFolderPath(path || '');
    if (!localPath) throw new Error('path は必須です');
    const scope = await _scopeForPath(provider, localPath);
    const target = _canonicalForScope(scope, localPath).toLowerCase();
    const result = await _mutateLockStore(provider, scope, (store) => {
      const before = store.entries.length;
      const next = store.entries.filter(row => !_entryCanonicalForms(row, scope).some(form => form.toLowerCase() === target));
      return {
        entries: next,
        audit: { action: 'unlock', path: localPath, removed: before - next.length },
        result: { ok: true, removed: before - next.length },
      };
    });
    return result || { ok: true, removed: 0 };
  }

  function _rewriteEntriesForMutation(entries, scope, event, canonicalOld, canonicalNew) {
    const base = canonicalOld.toLowerCase();
    const isFolder = !!event.isFolder;
    let changed = false;
    const kept = [];
    const moved = [];
    for (const row of entries) {
      const forms = _entryCanonicalForms(row, scope);
      const matched = forms.find((form) => {
        const cur = form.toLowerCase();
        return base && (cur === base || (isFolder && cur.startsWith(base + '/')));
      });
      if (!matched) {
        kept.push(row);
        continue;
      }
      changed = true;
      if (event.action === 'delete') continue;
      const nextPath = matched.toLowerCase() === base
        ? canonicalNew
        : canonicalNew + matched.slice(canonicalOld.length);
      moved.push({
        ...row,
        path: nextPath,
        path_space: 'root',
        normalized_path: _normalize(nextPath),
        file_id: _fnvFileId ? _fnvFileId(nextPath) : row.file_id,
      });
    }
    return { changed, kept, moved };
  }

  async function rewriteForPathMutation(provider, event = {}) {
    if (!provider || !event) return;
    const oldPath = _normalizeFolderPath(event.oldPath || event.path || '');
    const newPath = _normalizeFolderPath(event.newPath || '');
    if (!oldPath || (event.action !== 'delete' && !newPath)) return;
    let oldScope = null;
    let canonicalOld = '';
    try {
      oldScope = await _scopeForPath(provider, oldPath);
      canonicalOld = _canonicalForScope(oldScope, oldPath);
    } catch {
      return; // スコープを判定できない場合はロック台帳を書き換えない(ロックは残す=安全側)。
    }
    let newScope = null;
    let canonicalNew = '';
    if (event.action !== 'delete') {
      try {
        newScope = await _scopeForPath(provider, newPath);
        canonicalNew = _canonicalForScope(newScope, newPath);
      } catch {
        return;
      }
    }
    const audit = { action: 'path-mutation', path: oldPath, new_path: newPath, mutation: event.action || '' };
    if (!newScope || newScope.scopeKey === oldScope.scopeKey) {
      await _mutateLockStore(provider, oldScope, (store) => {
        const { changed, kept, moved } = _rewriteEntriesForMutation(store.entries, oldScope, event, canonicalOld, canonicalNew);
        if (!changed) return false;
        return { entries: [...kept, ...moved], audit, result: { ok: true } };
      });
      return;
    }
    // スコープをまたぐ移動: 先に移動先ストアへ追加し、成功後に移動元から除く
    // (途中失敗時は両方に残る=ロックが外れない方向へ倒す)。
    const preview = _rewriteEntriesForMutation((await _readStore(provider, oldScope)).entries, oldScope, event, canonicalOld, canonicalNew);
    if (!preview.changed) return;
    if (preview.moved.length) {
      await _mutateLockStore(provider, newScope, (destStore) => {
        const movedLower = new Set(preview.moved.map(row => row.normalized_path));
        const destKept = destStore.entries.filter(row => !_entryCanonicalForms(row, newScope).some(form => movedLower.has(form.toLowerCase())));
        return { entries: [...destKept, ...preview.moved], audit, result: { ok: true } };
      });
    }
    await _mutateLockStore(provider, oldScope, (store) => {
      const { changed, kept } = _rewriteEntriesForMutation(store.entries, oldScope, event, canonicalOld, canonicalNew);
      if (!changed) return false;
      return { entries: kept, audit, result: { ok: true } };
    });
  }

  handlers.push(async function _dropboxFileLockHandler({ method, body, url, pathname }) {
    if (pathname === '/file-lock' && method === 'GET') {
      const provider = await internals._requirePwaProvider('read');
      return list(provider, url.searchParams.get('q') || url.searchParams.get('search') || '');
    }
    if (pathname === '/file-lock/check' && method === 'GET') {
      const provider = await internals._requirePwaProvider('read');
      return check(provider, url.searchParams.get('path') || '');
    }
    if (pathname === '/file-lock' && method === 'PUT') {
      const provider = await internals._requirePwaProvider('readwrite');
      return setLock(provider, body || {});
    }
    if (pathname === '/file-lock' && method === 'DELETE') {
      const provider = await internals._requirePwaProvider('readwrite');
      return unlock(provider, url.searchParams.get('path') || body?.path || '');
    }
    if (pathname === '/file-lock/templates' && method === 'GET') return { templates: REASON_TEMPLATES.slice() };
    if (pathname === '/file-lock/audit' && method === 'GET') {
      const provider = await internals._requirePwaProvider('read');
      const rows = await window.MeldexKnowledgeSignature?.readAudit?.(provider, 'file_lock').catch(() => []) || [];
      return { items: rows, count: rows.length };
    }
    await guardMutationRequest({ method, body, url, pathname });
    return NOT_HANDLED;
  });

  window.__MeldexPwaPathMutationHooks = window.__MeldexPwaPathMutationHooks || [];
  window.__MeldexPwaPathMutationHooks.push(async event => {
    const provider = await internals._requirePwaProvider('readwrite').catch(() => null);
    if (provider) await rewriteForPathMutation(provider, event);
  });

  window.MeldexFileLockStore = {
    list,
    check,
    requireUnlocked,
    setLock,
    unlock,
    rewriteForPathMutation,
    guardMutationRequest,
    reasonTemplates: REASON_TEMPLATES.slice(),
  };
})();
