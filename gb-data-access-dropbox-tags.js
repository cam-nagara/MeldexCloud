/* Dropbox-static routes for the unified Meldex tag dictionary. */
(function () {
  'use strict';

  const internals = window.__MeldexPwaDataAccessInternals;
  const handlers = window.__MeldexPwaDataAccessExtensions;
  if (!internals || !Array.isArray(handlers)) return;
  const tagCsv = window.MeldexDropboxTagCsv;
  const tagSafety = window.MeldexDropboxTagSafety;
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

  class AssignmentRollbackMarkerWriteError extends Error {
    constructor(message, recoveryPath, cause) {
      super(message);
      this.name = 'AssignmentRollbackMarkerWriteError';
      this.recoveryPath = String(recoveryPath || '');
      this.cause = cause;
    }
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function randomId() {
    if (globalThis.crypto?.randomUUID) return crypto.randomUUID().replace(/-/g, '');
    return `${Date.now().toString(36)}${Math.random().toString(16).slice(2)}`;
  }

  function identity(value) {
    return String(value || '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('ja');
  }

  function cleanName(value, label) {
    const name = String(value || '').trim().replace(/\s+/g, ' ');
    if (!name) throw new Error(`${label || '名前'}を入力してください`);
    if (name.length > 80) throw new Error(`${label || '名前'}が長すぎます`);
    return name;
  }

  function stringList(value, separators) {
    const values = Array.isArray(value) ? value : [value];
    const seen = new Set();
    const result = [];
    values.forEach(raw => String(raw || '').split(separators || /[\r\n,]+/).forEach(part => {
      const text = String(part || '').trim().replace(/\s+/g, ' ').slice(0, 80);
      const key = identity(text);
      if (text && !seen.has(key)) {
        seen.add(key);
        result.push(text);
      }
    }));
    return result;
  }

  function sortIndex(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.trunc(parsed) : 0;
  }

  function asBool(value) {
    if (typeof value === 'boolean') return value;
    return ['1', 'true', 'yes', 'on', 'はい', '有効'].includes(String(value || '').trim().toLocaleLowerCase('ja'));
  }

  function normalizeCatalog(raw) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const groups = (Array.isArray(source.groups) ? source.groups : []).map(item => ({
      id: String(item?.id || randomId()),
      name: cleanName(item?.name, 'グループ名'),
      parent_id: String(item?.parent_id || '').trim() || null,
      color: String(item?.color || '').trim(),
      description: String(item?.description || '').trim(),
      sort_index: sortIndex(item?.sort_index),
      collapsed: asBool(item?.collapsed),
    }));
    const tags = (Array.isArray(source.tags) ? source.tags : []).map(item => ({
      id: String(item?.id || randomId()),
      name: cleanName(item?.name, 'タグ名'),
      aliases: stringList(item?.aliases),
      presets: stringList(item?.presets, /[\r\n,;]+/).length
        ? stringList(item?.presets, /[\r\n,;]+/)
        : [DEFAULT_PRESET],
      auto_assign: asBool(item?.auto_assign),
      color: String(item?.color || '').trim(),
      description: String(item?.description || '').trim(),
      group_id: String(item?.group_id || '').trim() || null,
      sort_index: sortIndex(item?.sort_index),
    }));

    const allIds = new Set();
    groups.concat(tags).forEach(item => {
      if (allIds.has(item.id)) throw new Error(`内部ID「${item.id}」が重複しています`);
      allIds.add(item.id);
    });
    const groupById = Object.fromEntries(groups.map(group => [group.id, group]));
    const siblingNames = new Set();
    groups.forEach(group => {
      if (group.parent_id && !groupById[group.parent_id]) throw new Error(`「${group.name}」の親グループが見つかりません`);
      if (group.parent_id === group.id) throw new Error('グループ自身を親にはできません');
      const siblingKey = `${group.parent_id || ''}\n${identity(group.name)}`;
      if (siblingNames.has(siblingKey)) throw new Error(`同じ階層にグループ「${group.name}」が重複しています`);
      siblingNames.add(siblingKey);
      const seen = new Set([group.id]);
      let cursor = group.parent_id;
      while (cursor) {
        if (seen.has(cursor)) throw new Error(`グループ「${group.name}」の階層が循環しています`);
        seen.add(cursor);
        cursor = groupById[cursor]?.parent_id || null;
      }
    });

    const tagNames = new Map();
    tags.forEach(tag => {
      if (tag.group_id && !groupById[tag.group_id]) throw new Error(`「${tag.name}」の親グループが見つかりません`);
      const key = identity(tag.name);
      if (tagNames.has(key)) throw new Error(`タグの正式名「${tag.name}」が重複しています`);
      tagNames.set(key, tag.id);
    });
    const aliasNames = new Map();
    tags.forEach(tag => {
      const ownName = identity(tag.name);
      tag.aliases = tag.aliases.filter(alias => {
        const key = identity(alias);
        if (!key || key === ownName) return false;
        if (tagNames.has(key) && tagNames.get(key) !== tag.id) {
          throw new Error(`別名「${alias}」が別のタグの正式名と重複しています`);
        }
        if (aliasNames.has(key) && aliasNames.get(key) !== tag.id) {
          throw new Error(`別名「${alias}」が複数のタグで重複しています`);
        }
        aliasNames.set(key, tag.id);
        return true;
      });
    });
    const compare = (a, b) => a.sort_index - b.sort_index || String(a.name).localeCompare(String(b.name), 'ja');
    groups.sort(compare);
    tags.sort(compare);
    const desktopBase = source.desktop_base && typeof source.desktop_base === 'object'
      ? {
          tags: Array.isArray(source.desktop_base.tags) ? structuredClone(source.desktop_base.tags) : [],
          groups: Array.isArray(source.desktop_base.groups) ? structuredClone(source.desktop_base.groups) : [],
        }
      : null;
    return {
      version: 1,
      updated_at: String(source.updated_at || nowIso()),
      desktop_mirror_signature: String(source.desktop_mirror_signature || ''),
      desktop_sheet_mtime_ns: Number.isFinite(Number(source.desktop_sheet_mtime_ns))
        ? Number(source.desktop_sheet_mtime_ns)
        : -1,
      desktop_base: desktopBase,
      sync_pending: !!source.sync_pending,
      sync_conflict: !!source.sync_conflict,
      mutation_blocked: !!source.mutation_blocked,
      conflict_resolution_available: !!source.conflict_resolution_available,
      warning: String(source.warning || ''),
      recovery_path: String(source.recovery_path || ''),
      tags,
      groups,
    };
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
    return {
      version: 3,
      assignments: current?.assignments && typeof current.assignments === 'object' ? current.assignments : {},
      updated_at: String(current?.updated_at || ''),
    };
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
      const base = {
        ...(current && typeof current === 'object' ? current : {}),
        version: 3,
        assignments: current?.assignments && typeof current.assignments === 'object' ? { ...current.assignments } : {},
      };
      previous = structuredClone(base);
      latest = updater(base) || base;
      latest.updated_at = nowIso();
      latest.assignment_revision = randomId();
      return latest;
    };
    if (typeof provider.writeJsonMerged === 'function') {
      await provider.writeJsonMerged(ASSIGNMENTS_FILE, apply, {
        fallbackValue: { version: 3, assignments: {} },
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
        const currentAssignments = source.assignments && typeof source.assignments === 'object'
          ? { ...source.assignments }
          : {};
        const beforeAssignments = previous?.assignments && typeof previous.assignments === 'object'
          ? previous.assignments
          : {};
        const publishedAssignments = latest?.assignments && typeof latest.assignments === 'object'
          ? latest.assignments
          : {};
        const reversed = tagSafety.reverseAssignments(
          currentAssignments,
          beforeAssignments,
          publishedAssignments,
        );
        rollbackUnresolved = rollbackUnresolved || reversed.unresolved;
        return {
          ...source,
          version: 3,
          assignments: reversed.assignments,
          updated_at: nowIso(),
          assignment_revision: randomId(),
        };
      };
      try {
        if (typeof provider.writeJsonMerged === 'function') {
          await provider.writeJsonMerged(ASSIGNMENTS_FILE, rollback, {
            fallbackValue: { version: 3, assignments: {} },
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
        Object.keys(store.assignments).forEach(path => {
          const ids = (store.assignments[path] || []).filter(tagId => tagId !== id);
          if (ids.length) store.assignments[path] = ids;
          else delete store.assignments[path];
        });
        return store;
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
        const ids = Array.isArray(store.assignments[path]) ? store.assignments[path] : [];
        return {
          ok: true,
          path,
          source_folder: '',
          tags: ids.map(id => catalog.tags.find(tag => tag.id === id)).filter(Boolean),
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
        const ensured = await ensureTargetTags(provider, catalog, body?.tag || body?.name);
        const tag = ensured.tags[0];
        try {
          const store = await writeAssignments(provider, current => {
            const ids = new Set(Array.isArray(current.assignments[path]) ? current.assignments[path] : []);
            ids.add(tag.id);
            current.assignments[path] = [...ids];
            return current;
          });
          return { ok: true, path, source_folder: '', tags: store.assignments[path].map(id => ensured.catalog.tags.find(item => item.id === id)).filter(Boolean) };
        } catch (error) {
          await compensateTargetTagCreation(provider, ensured, error);
          throw error;
        }
      }
      if (method === 'PUT') {
        requireCatalogMutable(catalog);
        const path = safeTargetPath(body?.path || '');
        const ensured = await ensureTargetTags(provider, catalog, Array.isArray(body?.tags) ? body.tags : []);
        const ids = ensured.tags.map(tag => tag.id);
        try {
          await writeAssignments(provider, current => {
            if (ids.length) current.assignments[path] = [...new Set(ids)];
            else delete current.assignments[path];
            return current;
          });
          return { ok: true, path, source_folder: '', tags: ids.map(id => ensured.catalog.tags.find(tag => tag.id === id)).filter(Boolean) };
        } catch (error) {
          await compensateTargetTagCreation(provider, ensured, error);
          throw error;
        }
      }
      if (method === 'DELETE') {
        requireCatalogMutable(catalog);
        const path = safeTargetPath(query.get('path') || '');
        const tag = tagForValue(catalog, query.get('tag') || '');
        const store = await writeAssignments(provider, current => {
          const ids = (current.assignments[path] || []).filter(id => id !== tag?.id);
          if (ids.length) current.assignments[path] = ids;
          else delete current.assignments[path];
          return current;
        });
        return { ok: true, path, source_folder: '', tags: (store.assignments[path] || []).map(id => catalog.tags.find(tag => tag.id === id)).filter(Boolean) };
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
  };
})();
