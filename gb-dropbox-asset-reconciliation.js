/* Explicit Dropbox delta reconciliation. No network or storage I/O runs at startup.
 *
 * ファイル参照整合性・削除警告・全ファイルバックリンク実装計画 Phase 6
 * (外部移動・多端末、6c. Dropbox delta接続)。
 * 計画書: app/docs/file-reference-integrity-and-backlinks-plan-2026-07-31.md §13
 *
 * Cloud/Dropboxのバックリンク(`_queryBacklinks`/`gb-data-access.part01.js`)は
 * 永続索引を持たず、参照元候補の全workspaceをその場でライブ走査する設計
 * (Phase3実装ノート notes.md §7.2)。そのため「同一path置換」への誤接続防止
 * (target側)はasset識別レイヤー(gb-dropbox-asset-identity.js)が既に担って
 * おり、本ファイルが新たに何かをする必要はない。
 *
 * 唯一欠けていたのは「移動でpath文字列が変わった時、他ファイルが本文中に
 * 持つ旧pathの文字列を書き換える」処理(`_relocateReferences`。内部
 * Meldex操作の`/outliner/move`は既に呼んでいるが、Dropbox delta由来の
 * 外部移動確定〈applyExactMoves〉・ユーザーが確認したambiguous移動候補
 * 〈applyCandidate〉はこれを呼んでいなかった)。新しい同期プロトコルは
 * 作らず、既存の`_relocateReferences`をこの2箇所へ接続するだけ。
 * (copy/replacement/missingは対象pathの文字列が変化しないため対象外)
 */
(function () {
  'use strict';

  const internals = window.__MeldexPwaDataAccessInternals;
  const handlers = window.__MeldexPwaDataAccessExtensions;
  const identity = window.MeldexDropboxAssetIdentity;
  const recovery = window.MeldexDropboxAssetRecovery;
  const managedJson = window.MeldexDropboxManagedJson;
  if (!internals || !Array.isArray(handlers) || !identity || !managedJson) return;

  const {
    NOT_HANDLED,
    _fnvFileId,
    _normalizeFolderPath,
    _relocateReferences,
    _requirePwaProvider,
    _requireUnlockedPath,
  } = internals;
  const ROOT = '.meldex/asset-recovery';
  const ASSIGNMENTS_FILE = '.meldex/global-tags.json';
  const STATE_FILE = `${ROOT}/dropbox-scan-state.json`;
  const CANDIDATES_FILE = `${ROOT}/dropbox-candidates.json`;
  const INTERNAL_PREFIXES = [
    '.meldex/', '_meldex/', '_meldex_pwa/', '_trash/', '_versions/',
    '_backup/', '_chat/', '_knowledge/', '_models/', '_skills/',
    '自動タグ辞書/',
  ];

  function nowIso() {
    return new Date().toISOString();
  }

  function randomId() {
    if (globalThis.crypto?.randomUUID) return crypto.randomUUID().replace(/-/g, '');
    return `${Date.now().toString(36)}${Math.random().toString(16).slice(2)}`;
  }

  function objectValue(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  }

  function ignoredPath(path) {
    const normalized = identity.normalizePath(path);
    return INTERNAL_PREFIXES.some(prefix => (
      normalized === prefix.slice(0, -1) || normalized.startsWith(prefix)
    ));
  }

  function relativePath(provider, entry) {
    const raw = entry?.path_display || entry?.path_lower || '';
    if (typeof provider?._relativeFromDropboxPath === 'function') {
      return identity.normalizePath(provider._relativeFromDropboxPath(raw, ''));
    }
    return identity.normalizePath(raw);
  }

  function assetAtPath(store, path) {
    const normalized = identity.normalizePath(path);
    return Object.entries(store.asset_locators || {})
      .find(([, value]) => identity.normalizePath(value) === normalized)?.[0] || '';
  }

  function candidateId(kind, assetId, oldPath, newPath) {
    const key = [kind, assetId, oldPath, newPath].map(value => String(value || '')).join('|');
    return String(_fnvFileId ? _fnvFileId(key) : key);
  }

  // ファイル参照整合性計画 Phase 6 (6c): 確定した移動について、他ファイルが
  // 本文中に持つ旧pathの文字列を新pathへ書き換える。失敗しても移動確定
  // そのものは止めない(参照修復だけ失敗しても資産IDの解決で表示を維持し、
  // 再試行できるという計画書§8.2の方針をここにも適用する)。
  async function relocateReferencesSafe(provider, oldPath, newPath, isFolder) {
    if (typeof _relocateReferences !== 'function' || oldPath === newPath) {
      return { rewritten_count: 0, failed_count: 0, rewritten_paths: [] };
    }
    try {
      return await _relocateReferences(provider, oldPath, newPath, !!isFolder);
    } catch (error) {
      return {
        rewritten_count: 0,
        failed_count: 0,
        rewritten_paths: [],
        error: String(error?.message || error || ''),
      };
    }
  }

  function makeCandidate(kind, options) {
    const oldPath = identity.normalizePath(options.oldPath);
    const newPath = identity.normalizePath(options.newPath);
    return {
      candidate_id: candidateId(kind, options.assetId, oldPath, newPath),
      job_id: String(options.jobId || ''),
      kind,
      asset_id: String(options.assetId || ''),
      source_folder: '',
      old_path: oldPath,
      new_path: newPath,
      confidence: options.confidence || 'high',
      status: options.status || 'pending',
      evidence: objectValue(options.evidence),
      result: objectValue(options.result),
      created_at: options.createdAt || nowIso(),
      updated_at: nowIso(),
    };
  }

  async function writeMerged(provider, path, updater, fallbackValue) {
    return managedJson.writeMerged(provider, path, updater, fallbackValue);
  }

  async function writeState(provider, state) {
    await writeMerged(provider, STATE_FILE, () => state, {});
    return state;
  }

  async function readState(provider) {
    return objectValue(await managedJson.read(provider, STATE_FILE, {}));
  }

  async function readCandidates(provider) {
    const raw = objectValue(await managedJson.read(
      provider,
      CANDIDATES_FILE,
      { version: 1, items: {} },
    ));
    return { version: 1, items: objectValue(raw.items) };
  }

  async function mergeCandidates(provider, candidates) {
    if (!candidates.length) return readCandidates(provider);
    return writeMerged(provider, CANDIDATES_FILE, current => {
      const source = objectValue(current);
      const items = { ...objectValue(source.items) };
      candidates.forEach(candidate => {
        const previous = items[candidate.candidate_id];
        items[candidate.candidate_id] = previous
          && !['pending', 'reopened'].includes(String(previous.status || ''))
          ? { ...candidate, status: previous.status, result: previous.result }
          : { ...previous, ...candidate, created_at: previous?.created_at || candidate.created_at };
      });
      return { version: 1, updated_at: nowIso(), items };
    }, { version: 1, items: {} });
  }

  function fingerprint(entry) {
    return {
      content_hash: String(entry?.content_hash || ''),
      size: Number(entry?.size || 0),
      rev: String(entry?.rev || ''),
      modified: String(entry?.server_modified || entry?.client_modified || ''),
    };
  }

  function matchingFingerprint(store, entry) {
    const target = fingerprint(entry);
    if (!target.content_hash) return [];
    return Object.entries(objectValue(store.asset_dropbox_fingerprints))
      .filter(([, value]) => (
        String(value?.content_hash || '') === target.content_hash
        && Number(value?.size || 0) === target.size
      ))
      .map(([assetId, value]) => ({
        asset_id: assetId,
        path: identity.normalizePath(store.asset_locators?.[assetId] || value?.path),
      }));
  }

  async function applyExactMoves(provider, store, entries, jobId) {
    const moves = [];
    for (const entry of entries) {
      if (entry?.['.tag'] === 'deleted' || !entry?.id) continue;
      const path = relativePath(provider, entry);
      if (!path || ignoredPath(path)) continue;
      const assetId = String(store.asset_provider_ids?.[entry.id] || '');
      const oldPath = identity.normalizePath(store.asset_locators?.[assetId]);
      if (!assetId || !oldPath || oldPath === path) continue;
      const event = {
        action: 'move',
        oldPath,
        newPath: path,
        isFolder: entry['.tag'] === 'folder',
        operationId: `dropbox-delta:${jobId}:${entry.id}:${path}`,
      };
      const result = await recovery?.handleMutation?.(event, provider);
      const relocate = await relocateReferencesSafe(provider, oldPath, path, event.isFolder);
      moves.push(makeCandidate('move', {
        jobId,
        assetId,
        oldPath,
        newPath: path,
        confidence: 'exact',
        status: result?.ok === false ? 'pending' : 'applied',
        evidence: { reason: 'dropbox-stable-id', provider_id: entry.id },
        result: { ...(result || { ok: false }), relocate },
      }));
    }
    return moves;
  }

  async function projectMetadata(provider, entries, jobId) {
    const initial = identity.normalizeStore(
      await managedJson.read(provider, ASSIGNMENTS_FILE, {}),
    );
    const candidates = await applyExactMoves(provider, initial, entries, jobId);
    await writeMerged(provider, ASSIGNMENTS_FILE, current => {
      let store = identity.normalizeStore(current);
      store.asset_dropbox_fingerprints = {
        ...objectValue(store.asset_dropbox_fingerprints),
      };
      store.asset_tombstones = { ...objectValue(store.asset_tombstones) };

      entries.forEach(entry => {
        const path = relativePath(provider, entry);
        if (!path || ignoredPath(path)) return;
        if (entry?.['.tag'] === 'deleted') {
          const missingAssetId = assetAtPath(store, path);
          if (missingAssetId) {
            candidates.push(makeCandidate('missing', {
              jobId,
              assetId: missingAssetId,
              oldPath: path,
              confidence: 'high',
              evidence: { reason: 'dropbox-deleted-entry' },
            }));
          }
          return;
        }
        const providerId = String(entry?.id || '');
        let assetId = String(store.asset_provider_ids?.[providerId] || '');
        const pathAssetId = assetAtPath(store, path);
        if (!assetId && pathAssetId) {
          const knownProviderIds = Object.entries(store.asset_provider_ids || {})
            .filter(([, value]) => String(value) === pathAssetId)
            .map(([key]) => key);
          if (providerId && knownProviderIds.length && !knownProviderIds.includes(providerId)) {
            delete store.asset_locators[pathAssetId];
            store.asset_tombstones[pathAssetId] = {
              status: 'missing',
              last_path: path,
              replaced_at: nowIso(),
            };
            const resolved = identity.resolveFromStore(store, path, providerId);
            store = resolved.store;
            assetId = resolved.asset.asset_id;
            candidates.push(makeCandidate('replacement', {
              jobId,
              assetId,
              oldPath: path,
              newPath: path,
              confidence: 'exact',
              status: 'applied',
              evidence: {
                reason: 'same-path-different-dropbox-id',
                replaced_asset_id: pathAssetId,
                provider_id: providerId,
              },
            }));
          } else {
            assetId = pathAssetId;
            if (providerId) store.asset_provider_ids[providerId] = assetId;
          }
        }
        if (!assetId) {
          const matches = matchingFingerprint(store, entry);
          if (matches.length) {
            const selected = matches.length === 1 ? matches[0] : null;
            candidates.push(makeCandidate(selected ? 'copy' : 'ambiguous', {
              jobId,
              assetId: selected?.asset_id || '',
              oldPath: selected?.path || '',
              newPath: path,
              confidence: selected ? 'high' : 'ambiguous',
              evidence: {
                reason: 'dropbox-content-hash',
                provider_id: providerId,
                matches,
              },
            }));
          }
          return;
        }
        store.asset_locators[assetId] = path;
        if (providerId) store.asset_provider_ids[providerId] = assetId;
        store.asset_dropbox_fingerprints[assetId] = {
          ...fingerprint(entry),
          path,
          updated_at: nowIso(),
        };
      });
      return { ...store, version: Math.max(5, Number(store.version || 0)) };
    }, { version: 5, assignments: {}, auto_assignments: {} });
    await mergeCandidates(provider, candidates);
    return candidates;
  }

  async function listPage(provider, cursor) {
    if (cursor) {
      return provider._rpc(
        'files/list_folder/continue',
        { cursor },
        provider._dropboxLocation(''),
      );
    }
    const location = provider._dropboxLocation('');
    return provider._rpc('files/list_folder', {
      path: location.path,
      recursive: true,
      include_deleted: true,
      include_has_explicit_shared_members: false,
      include_mounted_folders: true,
      limit: 2000,
    }, location);
  }

  async function advanceScan(provider, state) {
    if (state.cancel_requested) {
      return writeState(provider, {
        ...state,
        status: 'cancelled',
        updated_at: nowIso(),
      });
    }
    const payload = await listPage(provider, state.cursor || '');
    const entries = Array.isArray(payload?.entries) ? payload.entries : [];
    const candidates = await projectMetadata(provider, entries, state.job_id);
    const next = {
      ...state,
      status: payload?.has_more ? 'running' : 'complete',
      cursor: String(payload?.cursor || ''),
      scanned: Number(state.scanned || 0) + entries.length,
      candidate_count: Number(state.candidate_count || 0) + candidates.length,
      page: Number(state.page || 0) + 1,
      updated_at: nowIso(),
      finished_at: payload?.has_more ? '' : nowIso(),
      cancel_requested: false,
    };
    return writeState(provider, next);
  }

  async function startScan(provider, force) {
    const current = await readState(provider);
    if (!force && ['running', 'cancelled'].includes(String(current.status || ''))) {
      return current;
    }
    const state = {
      job_id: randomId(),
      status: 'running',
      cursor: force ? '' : String(current.cursor || ''),
      scanned: 0,
      candidate_count: 0,
      page: 0,
      cancel_requested: false,
      started_at: nowIso(),
      updated_at: nowIso(),
      finished_at: '',
      provider: 'dropbox',
    };
    await writeState(provider, state);
    return advanceScan(provider, state);
  }

  async function updateCandidate(provider, candidateId, updater) {
    let updated = null;
    await writeMerged(provider, CANDIDATES_FILE, current => {
      const source = objectValue(current);
      const items = { ...objectValue(source.items) };
      if (!items[candidateId]) throw new Error('復旧候補が見つかりません');
      updated = { ...items[candidateId], ...updater(items[candidateId]), updated_at: nowIso() };
      items[candidateId] = updated;
      return { version: 1, updated_at: nowIso(), items };
    }, { version: 1, items: {} });
    return updated;
  }

  async function applyCandidate(provider, candidateId, resolution) {
    const catalog = await readCandidates(provider);
    const candidate = catalog.items[candidateId];
    if (!candidate) throw new Error('復旧候補が見つかりません');
    const choice = String(resolution || candidate.kind || '');
    let result = { ok: true };
    if (choice === 'different') {
      return updateCandidate(provider, candidateId, () => ({
        status: 'dismissed',
        result: { ok: true, resolution: 'different' },
      }));
    }
    if (['move', 'copy'].includes(choice) && candidate.old_path && candidate.new_path) {
      result = await recovery.handleMutation({
        action: choice,
        oldPath: candidate.old_path,
        newPath: candidate.new_path,
        operationId: `dropbox-reconcile:${candidateId}`,
      }, provider);
      // ファイル参照整合性計画 Phase 6: 'copy'は内容が同一(参照先pathの
      // 文字列は変化しない)ため対象外。'move'(ambiguousをユーザーが確認した
      // 場合を含む)のみ、他ファイルの本文中の旧pathを書き換える。
      if (choice === 'move') {
        result = {
          ...result,
          relocate: await relocateReferencesSafe(
            provider, candidate.old_path, candidate.new_path, false,
          ),
        };
      }
    } else if (choice === 'missing' && candidate.asset_id) {
      await writeMerged(provider, ASSIGNMENTS_FILE, current => {
        const store = identity.normalizeStore(current);
        store.asset_tombstones = { ...objectValue(store.asset_tombstones) };
        store.asset_tombstones[candidate.asset_id] = {
          status: 'deleted',
          last_path: candidate.old_path,
          deleted_at: nowIso(),
        };
        return store;
      }, { version: 5 });
    } else if (!['replacement', 'move'].includes(choice)) {
      throw new Error('移動・コピー・別ファイルのいずれかを選択してください');
    }
    return updateCandidate(provider, candidateId, () => ({
      status: result?.ok === false ? 'pending' : 'applied',
      result,
    }));
  }

  async function listJsonFiles(provider, directory) {
    return (await managedJson.list(provider, directory))
      .filter(entry => /\.json$/i.test(String(entry?.name || '')))
      .sort((left, right) => String(right.name || '').localeCompare(String(left.name || '')));
  }

  async function recentEvents(provider, limit = 50) {
    const entries = (await listJsonFiles(provider, `${ROOT}/events`)).slice(0, 6);
    const items = [];
    for (const entry of entries) {
      const ledger = objectValue(await managedJson.read(
        provider,
        `${ROOT}/events/${entry.name}`,
        { events: {} },
      ));
      items.push(...Object.values(objectValue(ledger.events)));
      if (items.length >= limit * 2) break;
    }
    return items
      .sort((left, right) => String(right?.recorded_at || '')
        .localeCompare(String(left?.recorded_at || '')))
      .slice(0, Math.max(1, Math.min(500, Number(limit || 50))));
  }

  async function retryFiles(provider, limit = 500) {
    return (await listJsonFiles(provider, `${ROOT}/retry`))
      .slice(0, Math.max(1, Math.min(2000, Number(limit || 500))));
  }

  async function retryPending(provider, limit = 20) {
    const files = await retryFiles(provider, Math.max(20, Number(limit || 20) * 4));
    let processed = 0;
    let completed = 0;
    let failed = 0;
    for (const entry of files) {
      if (processed >= Math.max(1, Math.min(100, Number(limit || 20)))) break;
      const path = `${ROOT}/retry/${entry.name}`;
      const item = objectValue(await managedJson.read(provider, path, {}));
      if (!['pending', 'failed'].includes(String(item.status || ''))) continue;
      processed += 1;
      const attempts = Number(item.attempts || 0) + 1;
      try {
        await recovery.handleMutation({
          ...objectValue(item.event),
          operationId: String(item?.event?.operationId || item.retry_id || entry.name),
        }, provider);
        await managedJson.write(provider, path, {
          ...item,
          status: 'complete',
          attempts,
          last_error: '',
          completed_at: nowIso(),
          updated_at: nowIso(),
        });
        completed += 1;
      } catch (error) {
        await managedJson.write(provider, path, {
          ...item,
          status: 'failed',
          attempts,
          last_error: String(error?.message || error || '').slice(0, 1000),
          updated_at: nowIso(),
        });
        failed += 1;
      }
    }
    return { ok: failed === 0, processed, completed, failed };
  }

  async function status(provider) {
    const state = await readState(provider);
    const candidates = await readCandidates(provider);
    const [events, retries] = await Promise.all([
      recentEvents(provider, 500),
      retryFiles(provider, 500),
    ]);
    let pendingRetries = 0;
    for (const entry of retries) {
      const item = objectValue(await managedJson.read(
        provider,
        `${ROOT}/retry/${entry.name}`,
        {},
      ));
      if (['pending', 'failed'].includes(String(item.status || ''))) pendingRetries += 1;
    }
    const rows = Object.values(candidates.items);
    const summary = {};
    rows.forEach(item => {
      const key = `${item.status || 'pending'}:${item.confidence || 'ambiguous'}`;
      summary[key] = Number(summary[key] || 0) + 1;
    });
    return {
      job: Object.keys(state).length ? state : null,
      candidates: Object.entries(summary).map(([key, total]) => {
        const [candidateStatus, confidence] = key.split(':');
        return { status: candidateStatus, confidence, total };
      }),
      recovery: {
        events: events.length,
        pending_retries: pendingRetries,
        deleted: rows.filter(item => item.kind === 'missing' && item.status === 'applied').length,
        ambiguous: rows.filter(item => item.confidence === 'ambiguous' && item.status === 'pending').length,
      },
      monitors: [{
        provider: 'dropbox',
        available: true,
        enabled: true,
        mode: 'cursor',
        updated_at: state.updated_at || '',
      }],
      hot_path_io: false,
    };
  }

  async function rebuild(provider, dryRun) {
    let repaired = 0;
    const current = identity.normalizeStore(
      await managedJson.read(provider, ASSIGNMENTS_FILE, {}),
    );
    Object.entries(objectValue(current.legacy_migrations)).forEach(([path, migration]) => {
      if (migration?.status !== 'migrated') return;
      if (Object.hasOwn(current.assignments, path)) repaired += 1;
      if (Object.hasOwn(current.auto_assignments, path)) repaired += 1;
    });
    Object.entries(current.asset_assignments).forEach(([assetId, ids]) => {
      const path = identity.normalizePath(current.asset_locators[assetId]);
      if (path && JSON.stringify(current.assignments[path] || []) !== JSON.stringify(ids || [])) {
        repaired += 1;
      }
    });
    if (!dryRun && repaired) {
      await writeMerged(provider, ASSIGNMENTS_FILE, source => {
        const store = identity.normalizeStore(source);
        Object.entries(objectValue(store.legacy_migrations)).forEach(([path, migration]) => {
          if (migration?.status !== 'migrated') return;
          delete store.assignments[path];
          delete store.auto_assignments[path];
        });
        Object.entries(store.asset_assignments).forEach(([assetId, ids]) => {
          const path = identity.normalizePath(store.asset_locators[assetId]);
          if (!path) return;
          store.assignments[path] = [...ids];
          store.auto_assignments[path] = [...(store.asset_auto_assignments[assetId] || [])];
        });
        return store;
      }, { version: 5 });
    }
    return { ok: true, dry_run: !!dryRun, repaired };
  }

  async function route({ method, body, url, pathname }) {
    if (!pathname.startsWith('/tag-maintenance')) return NOT_HANDLED;
    if (pathname === '/tag-maintenance/portable-uid/capabilities' && method === 'GET') {
      return {
        ok: true,
        embedding: false,
        manifest: false,
        formats: [],
        normal_tagging_requires_embedding: false,
        startup_io: false,
        message: '復旧IDの埋め込みとタグ情報JSONはDesktop版で利用できます',
      };
    }
    const provider = await _requirePwaProvider(method === 'GET' ? 'read' : 'readwrite');
    const query = url?.searchParams || new URL('http://local' + pathname).searchParams;
    if (pathname === '/tag-maintenance/status' && method === 'GET') return status(provider);
    if (pathname === '/tag-maintenance/candidates' && method === 'GET') {
      const state = await readCandidates(provider);
      let items = Object.values(state.items);
      const wanted = String(query.get('status') || '');
      if (wanted) items = items.filter(item => item.status === wanted);
      return { items: items.slice(0, Math.max(1, Math.min(1000, Number(query.get('limit') || 100)))) };
    }
    if (pathname === '/tag-maintenance/events' && method === 'GET') {
      return { items: await recentEvents(provider, Number(query.get('limit') || 50)) };
    }
    if (pathname === '/tag-maintenance/scan' && method === 'POST') {
      return startScan(provider, !!body?.force);
    }
    const scanMatch = pathname.match(/^\/tag-maintenance\/scan\/([^/]+)\/(step|cancel|resume)$/);
    if (scanMatch && method === 'POST') {
      const state = await readState(provider);
      if (String(state.job_id || '') !== decodeURIComponent(scanMatch[1])) {
        throw new Error('差分照合ジョブが見つかりません');
      }
      if (scanMatch[2] === 'step') return advanceScan(provider, state);
      if (scanMatch[2] === 'cancel') {
        return writeState(provider, { ...state, status: 'cancelled', cancel_requested: true, updated_at: nowIso() });
      }
      return advanceScan(provider, { ...state, status: 'running', cancel_requested: false });
    }
    const candidateMatch = pathname.match(/^\/tag-maintenance\/candidates\/([^/]+)\/(apply|status)$/);
    if (candidateMatch && method === 'POST') {
      const candidateIdValue = decodeURIComponent(candidateMatch[1]);
      if (candidateMatch[2] === 'apply') {
        return {
          candidate: await applyCandidate(provider, candidateIdValue, body?.resolution),
          result: { ok: true },
        };
      }
      const nextStatus = String(body?.status || '');
      if (!['dismissed', 'reopened'].includes(nextStatus)) throw new Error('候補の状態が不正です');
      return updateCandidate(provider, candidateIdValue, () => ({ status: nextStatus }));
    }
    if (pathname === '/tag-maintenance/retry' && method === 'POST') {
      return retryPending(provider, body?.limit || 20);
    }
    if (pathname === '/tag-maintenance/rebuild' && method === 'POST') {
      return rebuild(provider, body?.dry_run ?? body?.dryRun ?? true);
    }
    if (pathname.startsWith('/tag-maintenance/monitor/') && method === 'POST') {
      return {
        ok: true,
        enabled: true,
        available: true,
        mode: 'dropbox-cursor',
        message: 'Dropboxの差分確認は明示的な照合時に行います',
      };
    }
    return NOT_HANDLED;
  }

  handlers.push(route);
  window.MeldexDropboxAssetReconciliation = {
    advanceScan,
    applyCandidate,
    projectMetadata,
    startScan,
    status,
  };
})();
