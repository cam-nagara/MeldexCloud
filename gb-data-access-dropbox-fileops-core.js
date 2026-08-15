/* gb-data-access-dropbox-fileops-core.js
 *
 * gb-data-access-dropbox-fileops.* の共通土台(internals分割取り出し・パス変更
 * フック・trash・CSVサイドカー移設・その他の汎用ヘルパー)。
 *
 * 固有形式付随物廃止・管理データ一元化計画 Phase 0 監査ノート§5「切り出し範囲の
 * 決定」に基づき、`gb-data-access-dropbox-fileops.part01.part01.js`(1074行、
 * 1000行超過)を責務別へ分割した際の①パス変更フック・trash・CSVサイドカー
 * クラスタ。分割後もこのファイル単体では完結しない(このファイルは
 * `(function(){...` を開くだけで閉じない。閲覧ロック・注釈・版・競合バックアップの
 * 各兄弟ファイル(gb-data-access-dropbox-fileops-annotations.js 等)と
 * gb-data-access-dropbox-fileops.part01.part02.js / .part02.js が同じ関数
 * スコープの続きとして連結され、最後に part02.js が `})();` で閉じる。
 * これは既存の `gb-data-access-dropbox-fileops-folder-versions.js` と同じ
 * 「IIFEを開かない継続ファイル」方式であり、build_split_bundles.py が
 * 単純にテキスト結合するだけの分割(1000行ルール用の物理分割。実行時の
 * モジュール境界ではない)である前提と一致する。
 *
 * 計画書: app/docs/proprietary-format-sidecar-cleanup-plan-2026-07-31.md
 * 監査ノート: app/docs/proprietary-format-sidecar-cleanup-audit-2026-08-01/notes.md
 *
 * ## このファイルの追加分(Phase 4)
 *
 * 閲覧ロック(view-lock)の読み書きを、`_meldex/view-locks/*.json` への直接読み書き
 * から、共通ストレージ層(gb-system-storage.js 経由、種別 view-locks)へ載せ替える。
 * 旧パスは読取フォールバックとしてのみ残す(移行はPhase 5)。
 */
(function () {
  'use strict';

  const internals = window.__MeldexPwaDataAccessInternals;
  const handlers = window.__MeldexPwaDataAccessExtensions;
  if (!internals || !Array.isArray(handlers)) return;
  const pathMutationHooks = window.__MeldexPwaPathMutationHooks = window.__MeldexPwaPathMutationHooks || [];

  const {
    NOT_HANDLED,
    PWA_HOME_KEY,
    PWA_TRASH_DIR,
    IMAGE_EXTS,
    _safeWriteJson,
    _normalizeFolderPath,
    _joinPath,
    _dirname,
    _basename,
    _splitNameAndExt,
    _boolParam,
    _displayLabelForPath,
    _phase1SurfaceType,
    _extractFrontmatterType,
    _isTextLikePath,
    _folderLinksStore,
    _writeFolderLinksStore,
    _readFolderLinks,
    _readFolderLinksManaged,
    _writeFolderLinks,
    _updateFolderLinksManaged,
    _normalizeOutlinerOperations,
    _managementScopeIdentity,
    _requirePwaProvider,
    _directoryHandle,
    _resolveEntryHandle,
    _listDirectoryEntries,
    _readJsonSafe,
    _fileStats,
    _validateItemName,
    _pathExists,
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
    _relocateReferences,
    _queryBacklinks,
    _queryDeleteImpact,
    _fnvFileId,
    _databaseKind,
  } = internals;

  async function _consumeCloudDeleteConfirmation(provider, body, items, operation) {
    const gate = window.MeldexCloudDeleteConfirmation;
    if (!gate?.consumeProviderDelete) {
      const error = new Error('削除確認の永続ストレージを利用できません');
      error.status = 503;
      throw error;
    }
    return gate.consumeProviderDelete({
      provider, items, operation,
      confirmations: body?.confirmations,
      confirmationToken: body?.confirmationToken || body?.confirmation_token,
      graphRevision: body?.graphRevision || body?.graph_revision,
    });
  }

  function _productionSheetPathParts(path) {
    return _normalizeFolderPath(path).split('/').filter(Boolean);
  }

  function _isProductionFolderNotePath(path) {
    const parts = _productionSheetPathParts(path);
    return parts.length === 4 && parts[0] === '制作管理' && parts[1] === 'シート'
      && !!parts[2] && parts[3] === `${parts[2]}.md`;
  }

  const _rejectProductionStructureMutation = internals._rejectProductionStructureMutation || ((path, action = '変更') => {
    const parts = _productionSheetPathParts(path);
    const protectedPath = (parts.length === 1 && parts[0] === '制作管理')
      || (parts.length === 2 && parts[0] === '制作管理' && parts[1] === 'シート')
      || (parts.length === 3 && parts[0] === '制作管理' && parts[1] === 'シート' && !!parts[2])
      || _isProductionFolderNotePath(path);
    if (protectedPath) throw new Error(`制作管理のシート構造・列定義は${action}できません`);
  });

  // シートの中には「エントリ」しか置けない。シートの実体はフォルダなので、
  // ボード・シナリオ・画像などを落とすと「シートの中にボードがある」壊れた
  // 状態になる。デスクトップ版はサーバー側 meldex_api_outliner.
  // reject_non_entry_into_sheet が必ず通るが、クラウド版（Dropbox接続時）は
  // ブラウザが直接ファイル操作を行いサーバーを介さないため、同じ規則を
  // このIIFE内で明示的に適用する必要がある。判定規則の正本は
  // gb-sheet-attachments.js の MeldexSheetAttachments.itemFitsInSheet に
  // 一本化されているので再実装しない。
  async function _rejectNonEntryIntoSheet(provider, destFolder, sourcePath, isDirectory) {
    if (typeof _databaseKind !== 'function') return;
    let kind = '';
    try {
      kind = await _databaseKind(provider, destFolder);
    } catch {
      return;
    }
    if (kind !== 'settings-db') return;
    const checker = window.MeldexSheetAttachments?.itemFitsInSheet;
    const fits = typeof checker === 'function'
      ? checker({ path: sourcePath, type: isDirectory ? 'folder' : '' })
      : true;
    if (fits) return;
    throw new Error(`シートの中にはエントリだけを置けます。「${_basename(sourcePath)}」はシートの外へ移動してください`);
  }

  const PRODUCTION_RESERVED_ENTRY_PROPERTIES = Object.freeze({
    '作品リスト': Object.freeze(['作品タイトル_話数', '作品タイトル']),
    '作業対象リスト': Object.freeze(['作業対象']),
    '作業内容リスト': Object.freeze(['作業内容']),
    '作業規模リスト': Object.freeze(['作業規模']),
    'スタッフリスト': Object.freeze(['スタッフ名']),
  });

  function _productionReservedEntryProperties(path) {
    const parts = _productionSheetPathParts(path);
    if (parts.length !== 4 || parts[0] !== '制作管理' || parts[1] !== 'シート'
      || !/\.md$/i.test(parts[3]) || parts[3] === `${parts[2]}.md`) return [];
    if (parts[2] === 'タスクリスト' || parts[2] === 'タスクリスト アーカイブ'
      || parts[2].startsWith('タスクリスト_')) return ['タスク名'];
    return PRODUCTION_RESERVED_ENTRY_PROPERTIES[parts[2]] || [];
  }

  const FRONTMATTER_BLOCK_RE = new RegExp('^' + String.fromCharCode(0xFEFF) + '?---\\r?\\n([\\s\\S]*?)\\r?\\n---(?:\\r?\\n|$)');

  function _frontmatterContainsProperty(text, property) {
    const match = String(text || '').match(FRONTMATTER_BLOCK_RE);
    if (!match || !property) return false;
    const frontmatter = match[1];
    const inline = frontmatter.match(/^properties:\s*(\{.*\})\s*$/m);
    if (inline) {
      try {
        const properties = JSON.parse(inline[1]);
        if (properties && typeof properties === 'object' && Object.prototype.hasOwnProperty.call(properties, property)) return true;
      } catch {}
    }
    const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`^\\s+["']?${escaped}["']?\\s*:`, 'm').test(frontmatter);
  }

  function _rejectProductionLegacyEntryContent(path, text) {
    const reserved = _productionReservedEntryProperties(path)
      .find(property => _frontmatterContainsProperty(text, property));
    if (reserved) {
      throw new Error(`「${reserved}」列はエントリ名へ統合済みのため再作成できません`);
    }
  }

  async function _runPathMutationHooks(event) {
    const errors = [];
    for (const hook of pathMutationHooks) {
      try {
        await hook(event);
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length) {
      const error = new Error('パス変更後の保護メタデータ更新に失敗しました');
      error.hookErrors = errors;
      throw error;
    }
  }

  function _postMutationWarning(stage, error) {
    return {
      stage: String(stage || 'post-mutation'),
      message: error?.message || String(error),
      code: error?.code || '',
    };
  }

  async function _runPostMutationStep(warnings, stage, fn) {
    try {
      await fn();
    } catch (error) {
      warnings.push(_postMutationWarning(stage, error));
    }
  }

  async function _runPathMutationHooksSafe(event, warnings) {
    await _runPostMutationStep(warnings, 'path-mutation-hooks', () => _runPathMutationHooks(event));
  }

  function _resultWarnings(warnings) {
    return warnings.length ? { warnings } : {};
  }

  function _isBrowseContainerItem(item) {
    const type = String(item?.type || '');
    return type === 'folder' || type === 'database' || type === 'calendar';
  }

  async function _folderLinksForProvider(provider) {
    return typeof _readFolderLinks === 'function' ? _readFolderLinks(provider) : _folderLinksStore();
  }

  async function _writeFolderLinksForProvider(provider, linksOrUpdater) {
    if (typeof _writeFolderLinks === 'function') return _writeFolderLinks(provider, linksOrUpdater);
    const current = _folderLinksStore();
    const links = typeof linksOrUpdater === 'function' ? linksOrUpdater(current) : linksOrUpdater;
    _writeFolderLinksStore(links);
    return links;
  }

  async function _folderLinksStateForProvider(provider) {
    if (typeof _readFolderLinksManaged !== 'function') {
      throw new Error('フォルダリンク管理データを読み込めません');
    }
    return _readFolderLinksManaged(provider);
  }

  async function _updateFolderLinksStateForProvider(provider, updater) {
    if (typeof _updateFolderLinksManaged !== 'function') {
      throw new Error('フォルダリンク管理データの原子的更新を利用できません');
    }
    return _updateFolderLinksManaged(provider, updater);
  }

  async function _folderLinksManagementScope(provider) {
    const kind = window.MeldexSystemStorage?.SystemStorageKind?.FOLDER_ASSOCIATIONS;
    if (!kind || typeof _managementScopeIdentity !== 'function') {
      throw new Error('フォルダリンク管理データの保存先を識別できません');
    }
    return _managementScopeIdentity(provider, kind);
  }

  async function _allowedTrashRoots() {
    const registry = window.MeldexSourceFolderRegistry;
    const physicalTrashPath = (dropboxPath) => {
      if (typeof registry?.normalizeDropboxPath !== 'function') return '';
      const base = registry.normalizeDropboxPath(dropboxPath || '');
      return base ? `${base === '/' ? '' : base}/_trash` : '';
    };
    const roots = [{
      path: _normalizeFolderPath(PWA_TRASH_DIR),
      name: 'Meldex',
      physicalPath: physicalTrashPath(window.MeldexDropboxAuth?.getVaultPath?.()),
    }];
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
      roots.push({
        path,
        name: String(source.name || source.dropboxPath || source.id).trim() || String(source.id),
        physicalPath: physicalTrashPath(source.dropboxPath),
      });
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

  function _csvMetadataPath(path) {
    if (window.MeldexCsv?.metadataPath) return window.MeldexCsv.metadataPath(path);
    const normalized = String(path || '').replace(/\\/g, '/');
    const slash = normalized.lastIndexOf('/');
    const parent = slash >= 0 ? normalized.slice(0, slash) : '';
    const file = slash >= 0 ? normalized.slice(slash + 1) : normalized;
    const stem = file.replace(/\.csv$/i, '') || 'csv';
    let hash = 0x811c9dc5;
    normalized.toLowerCase().split('').forEach(char => {
      hash ^= char.charCodeAt(0);
      hash = Math.imul(hash, 0x01000193);
    });
    const leaf = `${stem}-${(hash >>> 0).toString(16).padStart(8, '0')}.json`;
    return (parent ? `${parent}/` : '') + `.meldex/csv/${leaf}`;
  }

  async function _rewriteCsvSidecarSource(provider, path, sourcePath) {
    const payload = await _readJsonSafe(provider, path, null);
    if (!payload || typeof payload !== 'object') return;
    payload.sourcePath = sourcePath;
    await provider.writeJson(path, payload);
  }

  async function _relocateCsvSidecars(provider, oldPath, newPath, isFolder, copied) {
    const oldNormalized = _normalizeFolderPath(oldPath);
    const newNormalized = _normalizeFolderPath(newPath);
    async function moveOne(sourcePath, targetPath, sourceCsvPath, copyFile) {
      if (!await _pathExists(provider, sourcePath)) return;
      await _directoryHandle(provider, _dirname(targetPath), true);
      if (sourcePath !== targetPath) {
        if (copyFile) {
          const sourcePayload = await _readJsonSafe(provider, sourcePath, null);
          if (!sourcePayload || typeof sourcePayload !== 'object') throw new Error('CSV列設定を読み込めません');
          const expected = { ...sourcePayload, sourcePath: sourceCsvPath };
          if (await _pathExists(provider, targetPath)) {
            const current = await _readJsonSafe(provider, targetPath, null);
            if (JSON.stringify(_canonicalCloudCopyValue(current)) === JSON.stringify(_canonicalCloudCopyValue(expected))) return;
            throw Object.assign(new Error('CSV列設定の複製先が既存データと競合しています'), { status: 409 });
          }
          if (typeof provider.uploadBytesConditional !== 'function') throw new Error('CSV列設定のcreate-only保存を利用できません');
          await provider.uploadBytesConditional(targetPath, new TextEncoder().encode(JSON.stringify(expected)), null);
          return;
        }
        if (await _pathExists(provider, targetPath)) await _removeEntry(provider, targetPath);
        await _moveEntry(provider, sourcePath, targetPath);
      }
      await _rewriteCsvSidecarSource(provider, targetPath, sourceCsvPath);
    }
    if (!isFolder) {
      if (!/\.csv$/i.test(oldNormalized) || !/\.csv$/i.test(newNormalized)) return;
      await moveOne(
        _csvMetadataPath(oldNormalized),
        _csvMetadataPath(newNormalized),
        newNormalized,
        !!copied,
      );
      return;
    }
    async function walk(folderPath) {
      const entries = await _listDirectoryEntries(provider, folderPath);
      for (const entry of entries) {
        const childPath = entry.path || _joinPath(folderPath, entry.name);
        if (entry.handle.kind === 'directory') {
          if (entry.name === '.meldex') continue;
          await walk(childPath);
          continue;
        }
        if (!/\.csv$/i.test(entry.name)) continue;
        const relativeCsv = childPath.slice(newNormalized.length).replace(/^\/+/, '');
        const oldCsv = _joinPath(oldNormalized, relativeCsv);
        const oldMetadata = _csvMetadataPath(oldCsv);
        const relativeMetadata = oldMetadata.slice(oldNormalized.length).replace(/^\/+/, '');
        await moveOne(
          _joinPath(newNormalized, relativeMetadata),
          _csvMetadataPath(childPath),
          childPath,
          false,
        );
      }
    }
    await walk(newNormalized);
  }

  async function _deleteOutlinerPathToTrash(provider, rawPath, confirmation = {}) {
    const targetPath = _normalizeFolderPath(rawPath || '');
    _rejectProductionStructureMutation(targetPath, '削除');
    const source = await _resolveEntryHandle(provider, targetPath);
    const parsedSource = window.MeldexSourceFolderRegistry?.parseSourcePath?.(targetPath);
    const trashDir = parsedSource
      ? window.MeldexSourceFolderRegistry.sourcePath(parsedSource.sourceId, '_trash')
      : PWA_TRASH_DIR;
    const originalName = _basename(targetPath);
    const split = _splitNameAndExt(originalName);
    let destName = originalName;
    let destPath = _joinPath(trashDir, destName);
    for (let counter = 1; await _pathExists(provider, destPath); counter += 1) {
      destName = source?.kind === 'file'
        ? `${split.stem}_${String(counter).padStart(4, '0')}${split.ext}`
        : `${originalName}_${String(counter).padStart(4, '0')}`;
      destPath = _joinPath(trashDir, destName);
    }
    const metaPath = destPath + '._trash_meta.json';
    const csvSidecarPath = source?.kind === 'file' && /\.csv$/i.test(targetPath)
      ? _csvMetadataPath(targetPath)
      : '';
    const csvSidecarTrashPath = csvSidecarPath && await _pathExists(provider, csvSidecarPath)
      ? destPath + '._csv_meta.json'
      : '';
    const gate = window.MeldexCloudDeleteConfirmation;
    if (!gate?.revalidateProviderDelete || !confirmation?.receipt || !confirmation?.item) {
      throw Object.assign(new Error('削除直前の確認情報がありません'), { status: 409 });
    }
    await gate.revalidateProviderDelete({
      provider, receipt: confirmation.receipt, items: [confirmation.item],
      queryImpact: confirmation.queryImpact,
    });
    // tombstone を含む最初の書き込みは、上のfresh再検証より後に限定する。
    const sheetTombstone = await internals._deleteSheetStoreEntryIfNeeded?.(provider, targetPath);
    if (!source) return { ok: true };
    const annotationPlan = await _prepareAnnotationsForPathMutation(provider, {
      action: 'delete', oldPath: targetPath, newPath: destPath,
      isFolder: source.kind === 'directory',
    });
    try {
      await _directoryHandle(provider, trashDir, true);
      await provider.writeJson(metaPath, {
        original_path: targetPath,
        trash_root: trashDir,
        deleted_at: new Date().toISOString(),
        csv_sidecar_trash_path: csvSidecarTrashPath,
      });
      await _moveEntry(provider, targetPath, destPath);
      if (csvSidecarTrashPath) await _moveEntry(provider, csvSidecarPath, csvSidecarTrashPath);
    } catch (error) {
      if (await _pathExists(provider, destPath) && !await _pathExists(provider, targetPath)) {
        await _moveEntry(provider, destPath, targetPath).catch(() => {});
      }
      if (csvSidecarTrashPath && await _pathExists(provider, csvSidecarTrashPath)) {
        await _directoryHandle(provider, _dirname(csvSidecarPath), true).catch(() => {});
        await _moveEntry(provider, csvSidecarTrashPath, csvSidecarPath).catch(() => {});
      }
      await provider.deletePath(metaPath).catch(() => {});
      if (sheetTombstone) {
        await internals._restoreSheetStoreEntryAfterFailedDelete?.(
          provider, sheetTombstone.dbPath, sheetTombstone.fileName, sheetTombstone.previousRow
        );
      }
      throw error;
    }
    const warnings = [];
    await _runPostMutationStep(warnings, 'stored-paths', () => (
      typeof _removeStoredPathEntriesForProvider === 'function'
        ? _removeStoredPathEntriesForProvider(provider, targetPath, source.kind === 'directory')
        : Promise.resolve(_removeStoredPathEntries(targetPath, source.kind === 'directory'))
    ));
    await _runPathMutationHooksSafe({ action: 'delete', path: targetPath, isFolder: source.kind === 'directory', trashPath: destPath }, warnings);
    await _runPostMutationStep(warnings, 'annotations', () => _updateAnnotationsForPathMutation(provider, {
      action: 'delete',
      oldPath: targetPath,
      isFolder: source.kind === 'directory',
      trashPath: destPath,
      annotationPlan,
    }));
    return { ok: true, trash_name: destName, trash_root: trashDir, ..._resultWarnings(warnings) };
  }

  async function _findPathByFileId(provider, fileId) {
    const wanted = String(fileId || '').trim();
    if (!wanted) return '';
    async function walk(relativePath) {
      const normalized = _normalizeFolderPath(relativePath);
      if (normalized && _fnvFileId(normalized) === wanted) return normalized;
      const entries = await _listDirectoryEntries(provider, normalized);
      for (const entry of entries) {
        if (!entry.name || entry.name.startsWith('.') || entry.name.startsWith('_')) continue;
        const nextPath = entry.path || _joinPath(normalized, entry.name);
        if (_fnvFileId(nextPath) === wanted) return nextPath;
        if (entry.handle.kind === 'directory') {
          const nested = await walk(nextPath);
          if (nested) return nested;
        }
      }
      return '';
    }
    return walk('');
  }

  function _pathLooksLikeBoardMarkdown(path) {
    return /\.board\.md$/i.test(String(path || ''));
  }

  async function _assertNoBoardTypeDowngrade(provider, path, nextContent) {
    let previous = '';
    try {
      previous = await provider.readText(path);
    } catch {}
    const wasBoard = _pathLooksLikeBoardMarkdown(path) || _extractFrontmatterType(previous) === 'board';
    if (!wasBoard || _extractFrontmatterType(nextContent) === 'board') return;
    const error = new Error('既存のボードファイルをノート形式のMarkdownで上書きしようとしたため保存を中止しました');
    error.code = 'board_type_downgrade';
    throw error;
  }

  function _llmConfigShape() {
    return {
      providers: {
        gemini: { configured: false },
        anthropic: { configured: false },
        openai: { configured: false },
      },
    };
  }

  function _phaseUnsupported(feature, phase) {
    return {
      ok: false,
      unsupported: true,
      error: `${feature}はブラウザ版Meldex ${phase} 対象です。現在はフォルダ・ノート・シナリオ・ボードの基本操作を先に安定化しています。`,
    };
  }

  async function _textPreview(provider, filePath, maxChars) {
    const text = await provider.readText(filePath);
    const limit = Number(maxChars || 200000);
    if (text.length <= limit) return { content: text, truncated: false, length: text.length };
    return { content: text.slice(0, limit), truncated: true, length: text.length };
  }

  function _nowIso() {
    return new Date().toISOString();
  }

  function _randomId(prefix) {
    if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
    const random = Math.random().toString(16).slice(2);
    return `${prefix || 'id'}-${Date.now().toString(36)}-${random}`;
  }

  function _safeNamePart(value, fallback) {
    const text = String(value || fallback || 'item')
      .replace(/[\\/:*?"<>|\x00-\x1f]/g, '_')
      .replace(/\s+/g, ' ')
      .trim();
    return (text || fallback || 'item').slice(0, 80);
  }

  function _decodePathPart(value) {
    try {
      return decodeURIComponent(String(value || ''));
    } catch {
      return String(value || '');
    }
  }

  function _safeId(value, field) {
    const id = _decodePathPart(value).trim();
    if (!/^[A-Za-z0-9_.-]+$/.test(id)) throw new Error(`${field || 'id'} が不正です`);
    return id;
  }

  function _safeRelativeFile(value, field) {
    const raw = _decodePathPart(value).replace(/\\/g, '/').replace(/^\/+/, '');
    const parts = raw.split('/').filter(Boolean);
    if (!parts.length || parts.some(part => part === '.' || part === '..')) throw new Error(`${field || 'file'} が不正です`);
    return parts.join('/');
  }

  function _jsonMaybeParse(value, fallback) {
    if (typeof value !== 'string') return value == null ? fallback : value;
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  }

  function _providerObjectRevision(value) {
    const meta = value?.meta || value || {};
    return {
      id: String(meta.id || meta.provider_id || ''),
      rev: String(meta.rev || meta.revision || meta.etag || meta.content_hash || ''),
    };
  }

  // --- 共通ストレージ層への保存先解決(固有形式付随物廃止・管理データ一元化計画 Phase 4) ---
  //
  // gb-dropbox-management-root-resolver.js(現在接続中のルートが個人領域か
  // 参加中の共有ワークスペードかを判定する共通モジュール)へ委譲する。
  // fileops関連モジュール(注釈・閲覧ロック)はここから呼ぶ。gb-file-lock-store.js /
  // gb-active-lock-store.js は別IIFEスコープのため、同じリゾルバーへ
  // window.MeldexDropboxManagementRootResolver 経由で直接アクセスする。

  async function _managementAdapterForProvider(provider, kind, targetPath) {
    const resolver = window.MeldexDropboxManagementRootResolver;
    if (!resolver) throw new Error('gb-dropbox-management-root-resolver.js が読み込まれていません');
    if (kind && typeof resolver.resolveTypedAdapterForProvider === 'function') {
      return resolver.resolveTypedAdapterForProvider(provider, kind, targetPath ? { targetPath } : undefined);
    }
    return resolver.resolveAdapterForProvider(provider, targetPath ? { targetPath } : undefined);
  }

  // --- 閲覧ロック(view-lock。固有形式付随物廃止・管理データ一元化計画 Phase 4) ---
  //
  // 旧実装: `_meldex/view-locks/<viewKeyのfnvハッシュ>.json` への直接読み書き。
  // 新実装: 共通ストレージ層(種別 view-locks、document_id はfnvハッシュ)。
  // 旧パスは読取フォールバックとしてのみ残す(移行はPhase 5)。

  const VIEW_LOCK_DIR = '_meldex/view-locks'; // 旧パス読取フォールバック専用(新規書込では使わない)

  function _viewLockDefault(viewKey) {
    return { view_key: viewKey, target_path: '', pane_id: '', target_kind: '', locked: 0, state: {}, locked_at: '', locked_by: '' };
  }

  async function _readViewLockRecord(provider, viewKey) {
    const docId = _fnvFileId(viewKey);
    const contract = window.MeldexSystemStorage;
    try {
      const adapter = await _managementAdapterForProvider(provider, contract.SystemStorageKind.VIEW_LOCKS, viewKey);
      const record = await adapter.load(contract.SystemStorageKind.VIEW_LOCKS, docId);
      if (record) return record.payload;
    } catch (error) {
      if (!(error instanceof contract.SystemStorageNotFoundError)) {
        // 共通ストレージ層が使えない場合も、旧パスへフォールバックして機能を維持する。
      }
    }
    const legacy = await _readJsonSafe(provider, _joinPath(VIEW_LOCK_DIR, docId + '.json'), null);
    return legacy && typeof legacy === 'object' ? legacy : _viewLockDefault(viewKey);
  }

  async function _writeViewLockRecord(provider, viewKey, entry) {
    const docId = _fnvFileId(viewKey);
    const adapter = await _managementAdapterForProvider(
      provider,
      window.MeldexSystemStorage.SystemStorageKind.VIEW_LOCKS,
      entry?.target_path || viewKey,
    );
    await adapter.save(window.MeldexSystemStorage.SystemStorageKind.VIEW_LOCKS, docId, entry);
    return entry;
  }

  // 注意: このIIFEはここでは閉じない。gb-data-access-dropbox-fileops-conflict-backups.js /
  // gb-data-access-dropbox-fileops-annotations.js / gb-data-access-dropbox-fileops-versions.js /
  // gb-data-access-dropbox-fileops-folder-versions.js / .part01.part02.js / .part02.js が
  // 同じ関数スコープの続きとして連結され、最後に .part02.js が `})();` で閉じる
  // (ファイル冒頭のコメント参照。既存の -folder-versions.js と同じ「継続ファイル」方式)。
