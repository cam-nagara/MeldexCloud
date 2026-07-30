/* Dropbox-static routes for the unified Meldex tag dictionary. */
(function () {
  'use strict';

  const internals = window.__MeldexPwaDataAccessInternals;
  const handlers = window.__MeldexPwaDataAccessExtensions;
  if (!internals || !Array.isArray(handlers)) return;
  const tagCsv = window.MeldexDropboxTagCsv;
  const tagSafety = window.MeldexDropboxTagSafety;
  const assetIdentity = window.MeldexDropboxAssetIdentity || {
    async resolveAsset(_provider, store, path) {
      return { store, asset: { asset_id: '', provider_id: '', path } };
    },
    assignmentFor(store, path) {
      const ids = [...(store.assignments?.[path] || [])];
      return {
        ids,
        autoIds: [...(store.auto_assignments?.[path] || [])].filter(id => ids.includes(id)),
        source: ids.length ? 'legacy' : 'none',
      };
    },
    projectAssignment(store) { return store; },
  };
  const requiredCsvMethods = ['parseCsv', 'mergeCsv', 'ensureDictionary', 'importCsv'];
  if (!tagCsv || requiredCsvMethods.some(name => typeof tagCsv[name] !== 'function')) {
    throw new Error('gb-data-access-dropbox-tag-csv.js を先に読み込んでください');
  }
  if (!tagSafety) {
    throw new Error('gb-data-access-dropbox-tag-safety.js を先に読み込んでください');
  }

  const {
    NOT_HANDLED,
    _normalizeFolderPath,
    _joinPath,
    _basename,
    _requirePwaProvider,
    _readJsonSafe,
    _listDirectoryEntries,
    _removeEntry,
    _resolveEntryHandle,
    _requireUnlockedPath,
  } = internals;

  const CATALOG_FILE = '.meldex/auto-tag-dictionary.v1.json';
  const CATALOG_CONFLICT_FILE = '.meldex/auto-tag-dictionary.conflict.v1.json';
  const CATALOG_RECOVERY_DIR = '.meldex/auto-tag-recovery';
  const ASSIGNMENTS_FILE = '.meldex/global-tags.json';
  const ASSIGNMENTS_RECOVERY_DIR = '.meldex/global-tag-recovery';
  const DICTIONARY_FOLDER = '自動タグ辞書';
  const DICTIONARY_NOTE = `${DICTIONARY_FOLDER}/${DICTIONARY_FOLDER}.md`;
  const DEFAULT_PRESET = '標準';
  const catalogNormalizer = window.MeldexDropboxTagCatalogNormalizer;
  if (!catalogNormalizer) {
    throw new Error('gb-dropbox-tag-catalog-normalizer.js を先に読み込んでください');
  }
  const {
    asBool,
    cleanName,
    identity,
    normalizeCatalog,
    nowIso,
    randomId,
    sortIndex,
    stringList,
  } = catalogNormalizer;

  class AssignmentRollbackMarkerWriteError extends Error {
    constructor(message, recoveryPath, cause) {
      super(message);
      this.name = 'AssignmentRollbackMarkerWriteError';
      this.recoveryPath = String(recoveryPath || '');
      this.cause = cause;
    }
  }

  function catalogResponse(catalog) {
    const normalized = normalizeCatalog(catalog);
    const presetNames = [...new Set(normalized.tags.flatMap(tag => tag.presets || [DEFAULT_PRESET]))]
      .sort((a, b) => String(a).localeCompare(String(b), 'ja'));
    return {
      ok: true,
      tags: normalized.tags,
      groups: normalized.groups,
      preset_names: presetNames.length ? presetNames : [DEFAULT_PRESET],
      db_path: DICTIONARY_FOLDER,
      source_folder: '',
      catalog_path: CATALOG_FILE,
      sync_pending: normalized.sync_pending,
      sync_conflict: normalized.sync_conflict,
      mutation_blocked: normalized.mutation_blocked,
      conflict_resolution_available: normalized.conflict_resolution_available,
      warning: normalized.warning,
      recovery_path: normalized.recovery_path,
    };
  }

  async function ensureDirectory(provider, path) {
    if (typeof provider.ensureDirectory === 'function') {
      await provider.ensureDirectory(path);
      return;
    }
    const parts = _normalizeFolderPath(path).split('/').filter(Boolean);
    let current = '';
    for (const part of parts) {
      current = _joinPath(current, part);
      await provider.getDirectoryHandle(current, { create: true });
    }
  }

  async function pruneCatalogRecovery(provider) {
    await tagSafety.pruneRecoveryFiles(
      provider,
      CATALOG_RECOVERY_DIR,
      _listDirectoryEntries,
      _removeEntry,
      12,
    );
  }

  async function readCatalog(provider) {
    const payload = await _readJsonSafe(provider, CATALOG_FILE, null);
    const catalog = normalizeCatalog(payload || { version: 1, tags: [], groups: [] });
    const marker = await _readJsonSafe(provider, CATALOG_CONFLICT_FILE, null);
    if (marker?.active) {
      catalog.sync_pending = true;
      catalog.sync_conflict = true;
      catalog.mutation_blocked = true;
      catalog.conflict_resolution_available = false;
      catalog.warning = String(
        marker.warning
        || 'クラウド版とデスクトップ版のタグ辞書が競合しています。デスクトップ版のタグパネルで解消してください。',
      );
    } else {
      const recovery = await findPendingAssignmentRollback(provider);
      if (recovery) {
        catalog.sync_pending = true;
        catalog.sync_conflict = true;
        catalog.mutation_blocked = true;
        catalog.conflict_resolution_available = false;
        catalog.recovery_path = recovery.path;
        catalog.warning = (
          `ファイルのタグ変更が保存された可能性があります。`
          + `復旧データを確認するまでタグ編集を停止しています。`
          + ` 復旧データ: ${recovery.path}`
        );
      }
    }
    return catalog;
  }

  async function findPendingAssignmentRollback(provider) {
    if (typeof _listDirectoryEntries !== 'function') return null;
    let entries;
    try {
      entries = await _listDirectoryEntries(provider, ASSIGNMENTS_RECOVERY_DIR);
    } catch {
      return null;
    }
    const candidates = (Array.isArray(entries) ? entries : [])
      .filter(entry => /^.+-assignment-rollback\.json$/i.test(String(entry?.name || '')))
      .sort((left, right) => String(right?.name || '').localeCompare(String(left?.name || '')));
    for (const entry of candidates) {
      const path = _joinPath(
        ASSIGNMENTS_RECOVERY_DIR,
        String(entry?.name || ''),
      );
      const payload = await _readJsonSafe(provider, path, null);
      if (
        payload?.kind === 'assignment-rollback'
        && payload?.requires_edit_block === true
      ) {
        return { path, payload };
      }
    }
    return null;
  }

  function reverseCatalogPublish(current, before, published) {
    return tagSafety.reverseCatalogPublish(current, before, published, normalizeCatalog, nowIso);
  }

  async function writeCatalogRollbackRecovery(provider, before, published, current) {
    await ensureDirectory(provider, CATALOG_RECOVERY_DIR);
    const path = `${CATALOG_RECOVERY_DIR}/${Date.now()}-${randomId().slice(0, 12)}-rollback.json`;
    const payload = {
      version: 1,
      kind: 'catalog-rollback',
      created_at: nowIso(),
      before,
      published,
      current,
    };
    if (typeof provider.writeJson === 'function') await provider.writeJson(path, payload);
    else await provider.writeText(path, JSON.stringify(payload, null, 2) + '\n');
    await pruneCatalogRecovery(provider);
    return path;
  }

  async function writeAssignmentRollbackRecovery(
    provider,
    before,
    published,
    current,
    conflict,
  ) {
    await ensureDirectory(provider, ASSIGNMENTS_RECOVERY_DIR);
    const path = `${ASSIGNMENTS_RECOVERY_DIR}/${Date.now()}-${randomId().slice(0, 12)}-assignment-rollback.json`;
    const payload = {
      version: 1,
      kind: 'assignment-rollback',
      created_at: nowIso(),
      requires_edit_block: true,
      before,
      published,
      current,
    };
    if (typeof provider.writeJson === 'function') await provider.writeJson(path, payload);
    else await provider.writeText(path, JSON.stringify(payload, null, 2) + '\n');

    const rollbackId = randomId();
    const warning = (
      `${conflict?.warning || 'タグ辞書の同期競合が発生しました。'} `
      + `ファイルのタグ変更が保存された可能性があります。復旧データ: ${path}`
    );
    const block = currentMarker => ({
      ...(currentMarker && typeof currentMarker === 'object' ? currentMarker : {}),
      version: 1,
      active: true,
      conflict_id: (
        currentMarker?.active && currentMarker?.conflict_id
          ? currentMarker.conflict_id
          : rollbackId
      ),
      kind: 'assignment-rollback',
      assignment_rollback_path: path,
      warning,
      updated_at: nowIso(),
    });
    try {
      if (typeof provider.writeJsonMerged === 'function') {
        await provider.writeJsonMerged(CATALOG_CONFLICT_FILE, block, {
          fallbackValue: { version: 1, active: false },
          retries: 5,
        });
      } else {
        const marker = block(
          await _readJsonSafe(provider, CATALOG_CONFLICT_FILE, null),
        );
        if (typeof provider.writeJson === 'function') {
          await provider.writeJson(CATALOG_CONFLICT_FILE, marker);
        } else {
          await provider.writeText(
            CATALOG_CONFLICT_FILE,
            JSON.stringify(marker, null, 2) + '\n',
          );
        }
      }
    } catch (error) {
      throw new AssignmentRollbackMarkerWriteError(
        `タグ変更の復旧データは保存しましたが、編集停止情報を保存できませんでした。`
        + ` 復旧データ: ${path}`,
        path,
        error,
      );
    }
    try {
      const cleared = current => ({
        ...(current && typeof current === 'object' ? current : payload),
        requires_edit_block: false,
      });
      if (typeof provider.writeJsonMerged === 'function') {
        await provider.writeJsonMerged(
          path,
          cleared,
          { fallbackValue: payload, retries: 5 },
        );
      } else {
        const value = cleared(await _readJsonSafe(provider, path, payload));
        if (typeof provider.writeJson === 'function') {
          await provider.writeJson(path, value);
        } else {
          await provider.writeText(path, JSON.stringify(value, null, 2) + '\n');
        }
      }
    } catch {
      // marker is active; keeping the recovery block true is the safe fallback.
    }
    return path;
  }

  async function writeCatalog(provider, updater) {
    await ensureDirectory(provider, '.meldex');
    const conflict = await _readJsonSafe(provider, CATALOG_CONFLICT_FILE, null);
    if (conflict?.active) {
      throw new Error(
        conflict.warning
        || 'タグ辞書の同期競合をデスクトップ版のタグパネルで解消してから編集してください',
      );
    }
    if (typeof _requireUnlockedPath === 'function') {
      await _requireUnlockedPath(provider, CATALOG_FILE, { action: 'tag-dictionary-update' });
    }
    let latest = null;
    let previous = null;
    const apply = async current => {
      const activeConflict = await _readJsonSafe(
        provider,
        CATALOG_CONFLICT_FILE,
        null,
      );
      if (activeConflict?.active) {
        throw new Error(
          activeConflict.warning
          || 'タグ辞書の同期競合をデスクトップ版のタグパネルで解消してから編集してください',
        );
      }
      const catalog = normalizeCatalog(current || { version: 1, tags: [], groups: [] });
      previous = structuredClone(catalog);
      const next = updater(catalog);
      latest = normalizeCatalog(next || catalog);
      if (!latest.desktop_mirror_signature && catalog.desktop_mirror_signature) {
        latest.desktop_mirror_signature = catalog.desktop_mirror_signature;
      }
      if (latest.desktop_sheet_mtime_ns < 0 && catalog.desktop_sheet_mtime_ns >= 0) {
        latest.desktop_sheet_mtime_ns = catalog.desktop_sheet_mtime_ns;
      }
      if (!latest.desktop_base && catalog.desktop_base) {
        latest.desktop_base = structuredClone(catalog.desktop_base);
      }
      latest.updated_at = nowIso();
      return latest;
    };
    const recoverySource = await _readJsonSafe(provider, CATALOG_FILE, null);
    if (recoverySource && typeof recoverySource === 'object') {
      await ensureDirectory(provider, CATALOG_RECOVERY_DIR);
      const recoveryPath = `${CATALOG_RECOVERY_DIR}/${Date.now()}-${randomId().slice(0, 12)}.json`;
      if (typeof provider.writeJson === 'function') {
        await provider.writeJson(recoveryPath, recoverySource);
      } else {
        await provider.writeText(recoveryPath, JSON.stringify(recoverySource, null, 2) + '\n');
      }
      await pruneCatalogRecovery(provider);
    }
    if (typeof provider.writeJsonMerged === 'function') {
      await provider.writeJsonMerged(CATALOG_FILE, apply, {
        fallbackValue: { version: 1, updated_at: '', tags: [], groups: [] },
        retries: 5,
      });
    } else {
      await apply(await _readJsonSafe(provider, CATALOG_FILE, null));
      if (typeof provider.writeJson === 'function') await provider.writeJson(CATALOG_FILE, latest);
      else await provider.writeText(CATALOG_FILE, JSON.stringify(latest, null, 2) + '\n');
    }
    const conflictAfter = await _readJsonSafe(provider, CATALOG_CONFLICT_FILE, null);
    if (conflictAfter?.active) {
      const expectedConflictId = String(conflictAfter.conflict_id || '');
      let rollbackUnresolved = false;
      let rollbackSkipped = false;
      let rollbackCurrent = null;
      const rollback = async current => {
        rollbackCurrent = current && typeof current === 'object'
          ? structuredClone(current)
          : { version: 1, tags: [], groups: [] };
        const activeMarker = await _readJsonSafe(
          provider,
          CATALOG_CONFLICT_FILE,
          null,
        );
        if (
          !expectedConflictId
          || !activeMarker?.active
          || String(activeMarker.conflict_id || '') !== expectedConflictId
        ) {
          rollbackSkipped = true;
          return normalizeCatalog(rollbackCurrent);
        }
        const reversed = reverseCatalogPublish(current, previous, latest);
        rollbackUnresolved = rollbackUnresolved || reversed.unresolved;
        return reversed.catalog;
      };
      try {
        if (typeof provider.writeJsonMerged === 'function') {
          await provider.writeJsonMerged(CATALOG_FILE, rollback, {
            fallbackValue: { version: 1, updated_at: '', tags: [], groups: [] },
            retries: 5,
          });
        } else {
          const restored = await rollback(
            await _readJsonSafe(provider, CATALOG_FILE, null),
          );
          if (typeof provider.writeJson === 'function') await provider.writeJson(CATALOG_FILE, restored);
          else await provider.writeText(CATALOG_FILE, JSON.stringify(restored, null, 2) + '\n');
        }
      } catch (rollbackError) {
        let recoveryPath = '';
        try {
          recoveryPath = await writeCatalogRollbackRecovery(
            provider,
            previous,
            latest,
            rollbackCurrent,
          );
        } catch (_recoveryError) {
          // The active conflict marker still blocks further edits.
        }
        throw new Error(
          `${conflictAfter.warning || 'タグ辞書の同期競合が発生しました。'} `
          + `変更が保存された可能性があります。デスクトップ版で競合を解消してください。`
          + (recoveryPath ? ` 復旧データ: ${recoveryPath}` : ''),
        );
      }
      if (rollbackSkipped) {
        throw new Error(
          'タグ辞書の競合状態が更新されたため、古い競合による巻き戻しは行いませんでした。'
          + '内容を再読み込みしてください',
        );
      }
      if (rollbackUnresolved) {
        const current = await _readJsonSafe(provider, CATALOG_FILE, null);
        let recoveryPath = '';
        try {
          recoveryPath = await writeCatalogRollbackRecovery(
            provider,
            previous,
            latest,
            current,
          );
        } catch (_recoveryError) {
          // The active conflict marker still blocks further edits.
        }
        throw new Error(
          `${conflictAfter.warning || 'タグ辞書の同期競合が発生しました。'} `
          + `同じ項目が同時に変更されたため、変更が保存された可能性があります。`
          + (recoveryPath ? ` 復旧データ: ${recoveryPath}` : ''),
        );
      }
      throw new Error(
        conflictAfter.warning
        || 'タグ辞書の同期競合をデスクトップ版のタグパネルで解消してから編集してください',
      );
    }
    return latest;
  }

  function safeTargetPath(value) {
    const path = _normalizeFolderPath(value);
    if (!path || path.split('/').includes('..')) throw new Error('対象のパスが不正です');
    return path;
  }

  async function readAssignments(provider) {
    const current = await _readJsonSafe(provider, ASSIGNMENTS_FILE, {});
    return tagSafety.normalizeAssignmentStore(current);
  }

  async function writeAssignments(provider, updater) {
    await ensureDirectory(provider, '.meldex');
    const conflict = await _readJsonSafe(provider, CATALOG_CONFLICT_FILE, null);
    if (conflict?.active) {
      throw new Error(
        conflict.warning
        || 'タグ辞書の同期競合をデスクトップ版のタグパネルで解消してからタグを編集してください',
      );
    }
    if (typeof _requireUnlockedPath === 'function') {
      await _requireUnlockedPath(provider, ASSIGNMENTS_FILE, { action: 'tag-assignment-update' });
    }
    let latest = null;
    let previous = null;
    const apply = async current => {
      const activeConflict = await _readJsonSafe(
        provider,
        CATALOG_CONFLICT_FILE,
        null,
      );
      if (activeConflict?.active) {
        throw new Error(
          activeConflict.warning
          || 'タグ辞書の同期競合をデスクトップ版のタグパネルで解消してからタグを編集してください',
        );
      }
      const base = tagSafety.normalizeAssignmentStore(current);
      previous = structuredClone(base);
      latest = updater(base) || base;
      latest.updated_at = nowIso();
      latest.assignment_revision = randomId();
      return latest;
    };
    if (typeof provider.writeJsonMerged === 'function') {
      await provider.writeJsonMerged(ASSIGNMENTS_FILE, apply, {
        fallbackValue: { version: 5, assignments: {}, auto_assignments: {} },
        retries: 5,
      });
    } else {
      await apply(await _readJsonSafe(provider, ASSIGNMENTS_FILE, null));
      if (typeof provider.writeJson === 'function') await provider.writeJson(ASSIGNMENTS_FILE, latest);
      else await provider.writeText(ASSIGNMENTS_FILE, JSON.stringify(latest, null, 2) + '\n');
    }
    const conflictAfter = await _readJsonSafe(provider, CATALOG_CONFLICT_FILE, null);
    if (conflictAfter?.active) {
      let rollbackCurrent = null;
      let rollbackUnresolved = false;
      const rollback = current => {
        const source = current && typeof current === 'object' ? { ...current } : {};
        rollbackCurrent = structuredClone(source);
        const reversed = tagSafety.reverseAssignmentStore(source, previous, latest);
        rollbackUnresolved = rollbackUnresolved || reversed.unresolved;
        return {
          ...reversed.store,
          updated_at: nowIso(),
          assignment_revision: randomId(),
        };
      };
      try {
        if (typeof provider.writeJsonMerged === 'function') {
          await provider.writeJsonMerged(ASSIGNMENTS_FILE, rollback, {
            fallbackValue: { version: 4, assignments: {}, auto_assignments: {} },
            retries: 5,
          });
        } else {
          const restored = rollback(await _readJsonSafe(provider, ASSIGNMENTS_FILE, null));
          if (typeof provider.writeJson === 'function') await provider.writeJson(ASSIGNMENTS_FILE, restored);
          else await provider.writeText(ASSIGNMENTS_FILE, JSON.stringify(restored, null, 2) + '\n');
        }
      } catch (rollbackError) {
        let recoveryPath = '';
        try {
          recoveryPath = await writeAssignmentRollbackRecovery(
            provider,
            previous,
            latest,
            rollbackCurrent,
            conflictAfter,
          );
        } catch (recoveryError) {
          recoveryPath = String(recoveryError?.recoveryPath || '');
          // The original active conflict marker still blocks further edits.
        }
        throw new Error(
          `${conflictAfter.warning || 'タグ辞書の同期競合が発生しました。'} `
          + `ファイルのタグ変更が保存された可能性があります。`
          + (recoveryPath ? ` 復旧データ: ${recoveryPath}` : ''),
        );
      }
      if (rollbackUnresolved) {
        const recoveryPath = await writeAssignmentRollbackRecovery(
          provider,
          previous,
          latest,
          rollbackCurrent,
          conflictAfter,
        );
        throw new Error(
          `${conflictAfter.warning || 'タグ辞書の同期競合が発生しました。'} `
          + `ファイルのタグ変更が保存された可能性があります。`
          + ` 復旧データ: ${recoveryPath}`,
        );
      }
      throw new Error(
        conflictAfter.warning
        || 'タグ辞書の同期競合をデスクトップ版のタグパネルで解消してからタグを編集してください',
      );
    }
    return latest;
  }

  function tagForValue(catalog, value) {
    const id = String(value?.id || value?.name || value || '').trim();
    const key = identity(id);
    return catalog.tags.find(tag => tag.id === id || identity(tag.name) === key) || null;
  }

  function requireCatalogMutable(catalog) {
    if (!catalog?.mutation_blocked) return;
    throw new Error(
      catalog.warning
      || 'タグ辞書の同期競合をデスクトップ版のタグパネルで解消してからタグを編集してください',
    );
  }

  async function ensureTargetTags(provider, catalog, values) {
    const requested = Array.isArray(values) ? values : [values];
    const created = [];
    let saved = catalog;
    if (requested.some(value => !tagForValue(catalog, value))) {
      saved = await writeCatalog(provider, current => {
        requested.forEach(value => {
          if (tagForValue(current, value)) return;
          const source = value && typeof value === 'object' ? value : { name: value };
          const tag = {
            id: randomId(),
            name: source.name || value,
            aliases: source.aliases || [],
            presets: source.presets || [DEFAULT_PRESET],
            auto_assign: false,
            color: source.color || '',
            description: source.description || '',
            group_id: source.group_id || null,
            sort_index: source.sort_index || 0,
          };
          current.tags.push(tag);
          created.push(tag);
        });
        return current;
      });
    }
    return {
      before: catalog,
      catalog: saved,
      created: created.map(tag => saved.tags.find(item => item.id === tag.id)).filter(Boolean),
      tags: requested.map(value => tagForValue(saved, value)).filter(Boolean),
    };
  }

  async function compensateTargetTagCreation(provider, ensured, error) {
    await tagSafety.compensateCreatedTags(provider, {
      created: ensured.created,
      before: ensured.before,
      published: ensured.catalog,
      originalMessage: String(error?.message || error || 'タグを保存できませんでした'),
      catalogPath: CATALOG_FILE,
      assignmentsPath: ASSIGNMENTS_FILE,
      markerPath: CATALOG_CONFLICT_FILE,
      recoveryDirectory: CATALOG_RECOVERY_DIR,
      normalizeCatalog,
      readJson: _readJsonSafe,
      nowIso,
      randomId,
      ensureDirectory,
      pruneRecovery: pruneCatalogRecovery,
    });
  }

  async function route({ method, body, url, pathname }) {
    if (!pathname.startsWith('/global-tags')
      && !pathname.startsWith('/global-tag-groups')
      && !pathname.startsWith('/auto-tag/dictionary')
      && pathname !== '/auto-tag/presets') return NOT_HANDLED;
    const provider = await _requirePwaProvider(method === 'GET' ? 'read' : 'readwrite');
    const query = url?.searchParams || new URL('http://local' + pathname).searchParams;

    if (pathname === '/global-tags' && method === 'GET') return catalogResponse(await readCatalog(provider));
    if (pathname === '/global-tags' && method === 'POST') {
      let created;
      const saved = await writeCatalog(provider, catalog => {
        created = {
          id: randomId(),
          name: body?.name,
          aliases: body?.aliases || body?.alias || [],
          presets: body?.presets || body?.preset_names || [DEFAULT_PRESET],
          auto_assign: body?.auto_assign || body?.autoAssign || false,
          color: body?.color || '',
          description: body?.description || '',
          group_id: body?.group_id || null,
          sort_index: body?.sort_index || 0,
        };
        return { ...catalog, tags: [...catalog.tags, created] };
      });
      created = saved.tags.find(tag => tag.id === created.id);
      return { ok: true, tag: created, tags: saved.tags, groups: saved.groups };
    }
    if (pathname === '/global-tags/order' && method === 'PATCH') {
      const updates = Array.isArray(body?.updates) ? body.updates : [];
      if (!updates.length) throw new Error('並べ替えるタグを指定してください');
      const saved = await writeCatalog(provider, catalog => {
        const byId = new Map(catalog.tags.map(tag => [String(tag.id), tag]));
        const groupIds = new Set(catalog.groups.map(group => String(group.id)));
        const seen = new Set();
        updates.forEach(update => {
          const id = String(update?.id || '');
          if (!id || seen.has(id)) throw new Error('タグの指定が重複または不足しています');
          const target = byId.get(id);
          if (!target) throw new Error('タグが見つかりません');
          seen.add(id);
          if (Object.hasOwn(update, 'group_id')) {
            const groupId = String(update.group_id || '');
            if (groupId && !groupIds.has(groupId)) throw new Error('移動先のグループが見つかりません');
            target.group_id = groupId || null;
          }
          if (Object.hasOwn(update, 'sort_index')) target.sort_index = sortIndex(update.sort_index);
        });
        return catalog;
      });
      return { ok: true, tags: saved.tags, groups: saved.groups };
    }
    const tagMatch = pathname.match(/^\/global-tags\/([^/]+)$/);
    const isTagItemRoute = tagMatch && !['target', 'search'].includes(decodeURIComponent(tagMatch[1]));
    if (isTagItemRoute && method === 'PATCH') {
      const id = decodeURIComponent(tagMatch[1]);
      const saved = await writeCatalog(provider, catalog => {
        const target = catalog.tags.find(tag => tag.id === id);
        if (!target) throw new Error('タグが見つかりません');
        Object.entries(body || {}).forEach(([key, value]) => {
          const normalizedKey = key === 'autoAssign' ? 'auto_assign' : key === 'preset_names' ? 'presets' : key;
          if (['name', 'aliases', 'presets', 'auto_assign', 'color', 'description', 'group_id', 'sort_index'].includes(normalizedKey)) {
            target[normalizedKey] = value;
          }
        });
        return catalog;
      });
      return { ok: true, tag: saved.tags.find(tag => tag.id === id), tags: saved.tags, groups: saved.groups };
    }
    if (isTagItemRoute && method === 'DELETE') {
      const id = decodeURIComponent(tagMatch[1]);
      const saved = await writeCatalog(provider, catalog => {
        if (!catalog.tags.some(tag => tag.id === id)) throw new Error('タグが見つかりません');
        return { ...catalog, tags: catalog.tags.filter(tag => tag.id !== id) };
      });
      await writeAssignments(provider, store => {
        return tagSafety.removeTagEverywhere(store, id);
      });
      return { ok: true, tags: saved.tags, groups: saved.groups };
    }

    if (pathname === '/global-tag-groups' && method === 'GET') return catalogResponse(await readCatalog(provider));
    if (pathname === '/global-tag-groups' && method === 'POST') {
      let created;
      const saved = await writeCatalog(provider, catalog => {
        created = {
          id: randomId(),
          name: body?.name,
          parent_id: body?.parent_id || null,
          color: body?.color || '',
          description: body?.description || '',
          sort_index: body?.sort_index || 0,
          collapsed: body?.collapsed || false,
        };
        return { ...catalog, groups: [...catalog.groups, created] };
      });
      created = saved.groups.find(group => group.id === created.id);
      return { ok: true, group: created, tags: saved.tags, groups: saved.groups };
    }
    if (pathname === '/global-tag-groups/order' && method === 'PATCH') {
      const updates = Array.isArray(body?.updates) ? body.updates : [];
      if (!updates.length) throw new Error('並べ替えるタググループを指定してください');
      const saved = await writeCatalog(provider, catalog => {
        const byId = new Map(catalog.groups.map(group => [String(group.id), group]));
        const seen = new Set();
        updates.forEach(update => {
          const id = String(update?.id || '');
          if (!id || seen.has(id)) throw new Error('タググループの指定が重複または不足しています');
          const target = byId.get(id);
          if (!target) throw new Error('グループが見つかりません');
          seen.add(id);
          if (Object.hasOwn(update, 'parent_id')) target.parent_id = update.parent_id || null;
          if (Object.hasOwn(update, 'sort_index')) target.sort_index = sortIndex(update.sort_index);
        });
        for (const id of byId.keys()) {
          const visited = new Set([id]);
          let parentId = String(byId.get(id)?.parent_id || '');
          while (parentId) {
            if (!byId.has(parentId)) throw new Error('親グループが見つかりません');
            if (visited.has(parentId)) throw new Error('グループの階層が循環しています');
            visited.add(parentId);
            parentId = String(byId.get(parentId)?.parent_id || '');
          }
        }
        return catalog;
      });
      return { ok: true, tags: saved.tags, groups: saved.groups };
    }
    const groupMatch = pathname.match(/^\/global-tag-groups\/([^/]+)$/);
    if (groupMatch && method === 'PATCH') {
      const id = decodeURIComponent(groupMatch[1]);
      const saved = await writeCatalog(provider, catalog => {
        const target = catalog.groups.find(group => group.id === id);
        if (!target) throw new Error('グループが見つかりません');
        Object.entries(body || {}).forEach(([key, value]) => {
          if (['name', 'parent_id', 'color', 'description', 'sort_index', 'collapsed'].includes(key)) target[key] = value;
        });
        return catalog;
      });
      return { ok: true, group: saved.groups.find(group => group.id === id), tags: saved.tags, groups: saved.groups };
    }
    if (groupMatch && method === 'DELETE') {
      const id = decodeURIComponent(groupMatch[1]);
      const saved = await writeCatalog(provider, catalog => {
        const target = catalog.groups.find(group => group.id === id);
        if (!target) throw new Error('グループが見つかりません');
        catalog.groups.forEach(group => { if (group.parent_id === id) group.parent_id = target.parent_id || null; });
        catalog.tags.forEach(tag => { if (tag.group_id === id) tag.group_id = null; });
        catalog.groups = catalog.groups.filter(group => group.id !== id);
        return catalog;
      });
      return { ok: true, tags: saved.tags, groups: saved.groups };
    }

    if (pathname === '/auto-tag/dictionary' && method === 'GET') return catalogResponse(await readCatalog(provider));
    if (pathname === '/auto-tag/dictionary/ensure' && method === 'POST') {
      return tagCsv.ensureDictionary(provider, {
        ensureDirectory,
        resolveEntryHandle: _resolveEntryHandle,
        writeCatalog,
        dictionaryFolder: DICTIONARY_FOLDER,
        dictionaryNote: DICTIONARY_NOTE,
        catalogFile: CATALOG_FILE,
      });
    }
    if (pathname === '/auto-tag/dictionary/import' && method === 'POST') {
      return tagCsv.importCsv(provider, body, {
        identity,
        randomId,
        stringList,
        asBool,
        sortIndex,
        normalizeCatalog,
        defaultPreset: DEFAULT_PRESET,
        writeCatalog,
        catalogResponse,
        dictionaryFolder: DICTIONARY_FOLDER,
      });
    }
    if (pathname === '/auto-tag/presets' && method === 'GET') {
      const response = catalogResponse(await readCatalog(provider));
      return { ok: true, preset_names: response.preset_names, builtins: [] };
    }

    if (pathname === '/global-tags/target') {
      const catalog = await readCatalog(provider);
      if (method === 'GET') {
        const path = safeTargetPath(query.get('path') || '');
        const store = await readAssignments(provider);
        const resolved = await assetIdentity.resolveAsset(provider, store, path, { create: true });
        const assignment = assetIdentity.assignmentFor(store, path, resolved.asset.asset_id);
        const ids = assignment.ids;
        return {
          ok: true,
          path,
          asset_id: resolved.asset.asset_id,
          assignment_source: assignment.source,
          source_folder: '',
          tags: ids.map(id => catalog.tags.find(tag => tag.id === id)).filter(Boolean),
          auto_tag_ids: assignment.autoIds,
          sync_pending: catalog.sync_pending,
          sync_conflict: catalog.sync_conflict,
          mutation_blocked: catalog.mutation_blocked,
          conflict_resolution_available: catalog.conflict_resolution_available,
          warning: catalog.warning,
        };
      }
      if (method === 'POST') {
        requireCatalogMutable(catalog);
        const path = safeTargetPath(body?.path || '');
        const resolved = await assetIdentity.resolveAsset(
          provider,
          await readAssignments(provider),
          path,
          { create: true },
        );
        const ensured = await ensureTargetTags(provider, catalog, body?.tag || body?.name);
        const tag = ensured.tags[0];
        try {
          const store = await writeAssignments(provider, current => {
            const updated = tagSafety.promoteManualTag(current, path, tag.id);
            return assetIdentity.projectAssignment(
              updated,
              path,
              resolved.asset,
              updated.assignments[path] || [],
              updated.auto_assignments[path] || [],
            );
          });
          return { ok: true, path, asset_id: resolved.asset.asset_id, source_folder: '', tags: store.assignments[path].map(id => ensured.catalog.tags.find(item => item.id === id)).filter(Boolean) };
        } catch (error) {
          await compensateTargetTagCreation(provider, ensured, error);
          throw error;
        }
      }
      if (method === 'PUT') {
        requireCatalogMutable(catalog);
        const path = safeTargetPath(body?.path || '');
        const resolved = await assetIdentity.resolveAsset(
          provider,
          await readAssignments(provider),
          path,
          { create: true },
        );
        const ensured = await ensureTargetTags(provider, catalog, Array.isArray(body?.tags) ? body.tags : []);
        const ids = ensured.tags.map(tag => tag.id);
        try {
          await writeAssignments(provider, current => {
            const updated = tagSafety.setManualTags(current, path, ids);
            return assetIdentity.projectAssignment(updated, path, resolved.asset, ids, []);
          });
          return { ok: true, path, asset_id: resolved.asset.asset_id, source_folder: '', tags: ids.map(id => ensured.catalog.tags.find(tag => tag.id === id)).filter(Boolean) };
        } catch (error) {
          await compensateTargetTagCreation(provider, ensured, error);
          throw error;
        }
      }
      if (method === 'DELETE') {
        requireCatalogMutable(catalog);
        const path = safeTargetPath(query.get('path') || '');
        const resolved = await assetIdentity.resolveAsset(
          provider,
          await readAssignments(provider),
          path,
          { create: true },
        );
        const tag = tagForValue(catalog, query.get('tag') || '');
        const store = await writeAssignments(provider, current => {
          const updated = tagSafety.removeTargetTag(current, path, tag?.id);
          return assetIdentity.projectAssignment(
            updated,
            path,
            resolved.asset,
            updated.assignments[path] || [],
            updated.auto_assignments[path] || [],
          );
        });
        return { ok: true, path, asset_id: resolved.asset.asset_id, source_folder: '', tags: (store.assignments[path] || []).map(id => catalog.tags.find(tag => tag.id === id)).filter(Boolean) };
      }
    }
    if (pathname === '/global-tags/search' && method === 'GET') {
      const catalog = await readCatalog(provider);
      const tag = tagForValue(catalog, query.get('tag') || '');
      const store = await readAssignments(provider);
      const results = tag ? Object.entries(store.assignments)
        .filter(([, ids]) => Array.isArray(ids) && ids.includes(tag.id))
        .map(([path, ids]) => ({
          path,
          name: _basename(path),
          type: '',
          tags: ids.map(id => catalog.tags.find(item => item.id === id)).filter(Boolean),
        })) : [];
      return { ok: true, tag: query.get('tag') || '', source_folder: '', results, total: results.length };
    }
    return NOT_HANDLED;
  }

  handlers.push(route);
  window.MeldexDropboxTagDictionary = {
    catalogFile: CATALOG_FILE,
    normalizeCatalog,
    parseCsv: tagCsv.parseCsv,
    readCatalog,
    writeCatalog,
    requireCatalogMutable,
    helpers: {
      cleanName,
      identity,
      nowIso,
      randomId,
      sortIndex,
      stringList,
    },
  };
})();
