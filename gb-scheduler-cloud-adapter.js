/* gb-scheduler-cloud-adapter.js: Cloud static scheduler API parity adapter. */
(function () {
  'use strict';

  const API_VERSION = '1.0';
  const ENGINE_VERSION = 'production-recalculate/1';
  const PROPOSAL_SCHEMA_VERSION = 1;
  const CANCELLED = new Set(), SNAPSHOT_DOMAINS = Object.freeze(['template', 'classification', 'permission', 'proposal', 'baseline']);
  const ROW_SNAPSHOT_DOMAINS = Object.freeze([
    'calendar-event', 'todo', 'attendance', 'shift', 'weekly-template', 'reverse-sync', 'external-sync-import',
    'calendar-db', 'mapped-db',
  ]);
  const FOLDER_SNAPSHOT_DOMAINS = Object.freeze(['calendar-db', 'mapped-db']);
  const ALL_SNAPSHOT_DOMAINS = Object.freeze([...SNAPSHOT_DOMAINS, ...ROW_SNAPSHOT_DOMAINS]);
  const STORAGE_PREFIXES = Object.freeze({
    proposal: 'scheduler-proposal-', baseline: 'scheduler-baseline-', journal: 'scheduler-adoption-',
    template: 'scheduler-template-', project: 'scheduler-project-', policy: 'scheduler-policy-', version: 'scheduler-version-',
  });
  const CAPABILITIES = ['scheduler.allocate', 'scheduler.proposal.manage', 'scheduler.adopt', 'scheduler.baseline.manage', 'scheduler.settings.manage', 'scheduler.policy.manage'];
  const BUILTIN_MANGA = Object.freeze({
    schemaVersion: 1, id: 'builtin-manga', name: 'マンガ', builtIn: true, status: 'active',
    classifications: [
      { id: 'manga-page', name: 'ページ', status: 'active', effectRole: 'work_order', options: [], legacyPhysicalFields: ['ページ', '見開き'] },
      { id: 'manga-content', name: '作業内容', status: 'active', effectRole: 'duration_multiply', options: [], legacyPhysicalFields: ['作業内容リスト'] },
      { id: 'manga-scale', name: '作業規模', status: 'active', effectRole: 'duration_multiply', options: [], legacyPhysicalFields: ['作業規模リスト', 'カラー', 'コマ'] },
    ],
    generationRules: [], savedViews: [],
    legacyMapping: { projectList: '作品リスト', projectTitle: '作品タイトル', taskList: 'タスクリスト', templateList: 'タスクテンプレート' },
  });

  function currentUser() {
    return String((typeof getUsername === 'function' ? getUsername() : '') || 'anonymous').trim() || 'anonymous';
  }

  const ROLE_DEFAULTS = Object.freeze({
    owner: Object.freeze(Object.fromEntries(CAPABILITIES.map(capability => [capability, true]))), admin: Object.freeze(Object.fromEntries(CAPABILITIES.map(capability => [capability, true]))),
    schedule_manager: Object.freeze(Object.fromEntries(CAPABILITIES.map(capability => [capability, capability !== 'scheduler.policy.manage']))),
    member: Object.freeze(Object.fromEntries(CAPABILITIES.map(capability => [capability, false]))),
    viewer: Object.freeze(Object.fromEntries(CAPABILITIES.map(capability => [capability, false]))),
  });

  async function trustedWorkspaceRole(owner, requestWorkspace = workspaceId(), capturedWorkspace = null) {
    const registry = window.MeldexWorkspaces;
    let workspace = capturedWorkspace;
    if (!workspace && requestWorkspace !== 'cloud-local-workspace' && typeof registry?.load === 'function') {
      try {
        const values = await registry.load({ force: true, silentError: true });
        workspace = (Array.isArray(values) ? values : []).find(item => String(item?.id || '') === requestWorkspace) || null;
      } catch { return 'viewer'; }
    }
    if (!workspace) return requestWorkspace === 'cloud-local-workspace' ? 'owner' : 'viewer';
    const member = (Array.isArray(workspace.members) ? workspace.members : [])
      .find(item => String(item?.name || '').trim() === owner);
    const role = String(member?.role || '').trim().toLowerCase();
    if (role === 'editor') return 'member';
    return Object.prototype.hasOwnProperty.call(ROLE_DEFAULTS, role) ? role : 'viewer';
  }

  function fnv(value) {
    let hash = 2166136261;
    for (const char of String(value || '')) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 16777619); }
    return (hash >>> 0).toString(16).padStart(8, '0');
  }

  function workspaceId() {
    return String(window.MeldexWorkspaces?.getActiveId?.() || 'cloud-local-workspace');
  }

  function recordOwner(prefix, owner, workspace = workspaceId()) {
    return prefix === 'proposal' ? `${workspace}:${owner}` : workspace;
  }

  function safeId(prefix, owner, id) {
    return `${STORAGE_PREFIXES[prefix]}${fnv(owner)}-${fnv(id)}-${String(id || '').replace(/[^A-Za-z0-9_-]/g, '').slice(-48)}`.slice(0, 128);
  }

  function newId(prefix) {
    const random = globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    return `${prefix}-${random}`;
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function canonicalPlacements(rows) {
    return (Array.isArray(rows) ? rows : []).filter(row => row && typeof row === 'object')
      .map(row => structuredClone(row))
      .sort((a, b) => `${a.task_id || ''}\u0000${a.task_path || ''}`.localeCompare(`${b.task_id || ''}\u0000${b.task_path || ''}`));
  }

  function placementKey(row) {
    return String(row?.task_id || row?.task_path || '');
  }

  function normalizeFixedPlacements(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).filter(([key]) => String(key)).map(([key, fixed]) => [String(key), !!fixed]));
  }

  function preserveFixedPlacements(currentRows, recalculatedRows, fixedMap) {
    const locked = new Set(Object.entries(normalizeFixedPlacements(fixedMap)).filter(([, fixed]) => fixed).map(([key]) => key));
    const current = new Map(canonicalPlacements(currentRows).map(row => [placementKey(row), row]));
    const result = canonicalPlacements(recalculatedRows).map(row => locked.has(placementKey(row)) && current.has(placementKey(row))
      ? structuredClone(current.get(placementKey(row))) : row);
    const seen = new Set(result.map(placementKey));
    [...locked].sort().forEach(key => { if (!seen.has(key) && current.has(key)) result.push(structuredClone(current.get(key))); });
    return canonicalPlacements(result);
  }

  function placementProjection(rows) {
    const fields = ['status', 'task_id', 'task_path', 'task_name', 'work_title', 'creation_key', 'user', 'start', 'end', 'hours', 'reason', 'changed', 'before_user', 'before_range', 'after_range', 'color', 'users', 'multi_assignee', 'required_equipment', 'unplaced_code', 'slack_hours', 'critical_path'];
    const segmentFields = ['staff', 'user', 'users', 'start', 'end', 'hours', 'overtime'];
    return canonicalPlacements(rows).map(row => {
      const result = {};
      fields.forEach(key => {
        if (Object.prototype.hasOwnProperty.call(row || {}, key)) result[key] = structuredClone(row[key]);
      });
      if (Array.isArray(row.segments)) {
        result.segments = row.segments.filter(segment => segment && typeof segment === 'object').map(segment => {
          const projected = {};
          segmentFields.forEach(key => {
            if (Object.prototype.hasOwnProperty.call(segment, key)) projected[key] = structuredClone(segment[key]);
          });
          return projected;
        });
      }
      return result;
    }).sort((a, b) => `${a.task_id || ''}\u0000${a.task_path || ''}`.localeCompare(`${b.task_id || ''}\u0000${b.task_path || ''}`));
  }

  function metrics(rows) {
    const values = Array.isArray(rows) ? rows : [];
    const scheduled = values.filter(row => row.status === 'scheduled');
    return {
      scheduled: scheduled.length,
      locked: values.filter(row => row.status === 'locked').length,
      unassigned: values.filter(row => row.status === 'unassigned').length,
      changed: values.filter(row => !!row.changed).length,
      plannedHours: Math.round(scheduled.reduce((sum, row) => sum + Number(row.hours || 0), 0) * 100) / 100,
    };
  }

  function compareRows(baseRows, candidateRows) {
    const byId = rows => new Map(placementProjection(rows).map(row => [String(row.task_id || row.task_path || ''), row]));
    const base = byId(baseRows);
    const candidate = byId(candidateRows);
    const changes = [];
    [...new Set([...base.keys(), ...candidate.keys()])].sort().forEach(taskId => {
      const before = base.get(taskId) || null;
      const after = candidate.get(taskId) || null;
      if (JSON.stringify(before) !== JSON.stringify(after)) changes.push({ taskId, before, after });
    });
    return { same: !changes.length, changes, baseMetrics: metrics(baseRows), candidateMetrics: metrics(candidateRows) };
  }

  async function sourceRevision(rows) {
    const source = placementProjection(rows).map(row => ({
      taskId: row.task_id,
      user: row.before_user,
      range: row.before_range,
    }));
    return window.MeldexSystemStorage.computeRevision(source);
  }

  async function personalAdapter(provider) {
    if (typeof provider?.getSystemStorageAdapter === 'function') return provider.getSystemStorageAdapter();
    const kind = window.MeldexSystemStorage?.SystemStorageKind?.USER_PREFERENCES;
    return window.MeldexDropboxManagementRootResolver.resolveTypedAdapterForProvider(provider, kind, { personalOnly: true });
  }

  async function workspaceAdapter(provider) {
    if (window.MeldexRuntimeAdapter?.isBrowserMode?.() && typeof provider?.getSystemStorageAdapter === 'function') {
      return provider.getSystemStorageAdapter();
    }
    const kind = window.MeldexSystemStorage?.SystemStorageKind?.USER_PREFERENCES;
    return window.MeldexDropboxManagementRootResolver.resolveTypedAdapterForProvider(provider, kind);
  }

  function storageKind(prefix) {
    const kinds = window.MeldexSystemStorage.SystemStorageKind;
    return ({
      proposal: kinds.SCHEDULE_PROPOSALS,
      baseline: kinds.SCHEDULE_BASELINES,
      journal: kinds.SCHEDULE_JOURNALS,
      policy: kinds.SCHEDULE_POLICIES,
      template: kinds.SCHEDULE_TEMPLATES,
      project: kinds.SCHEDULE_PROJECTS,
      version: kinds.VERSIONS,
    })[prefix] || kinds.USER_PREFERENCES;
  }

  async function migrateLegacyProposal(adapter, owner, legacy, workspace) {
    if (!legacy || legacy.payload?.workspaceId) return null;
    let payload = structuredClone(legacy.payload || {});
    let revision = legacy.revision;
    const migration = payload._workspaceMigration && typeof payload._workspaceMigration === 'object'
      ? payload._workspaceMigration : {};
    const claimedWorkspace = String(migration.workspaceId || '');
    if ((claimedWorkspace && claimedWorkspace !== workspace) || migration.state === 'complete') return null;
    if (!claimedWorkspace) {
      payload._workspaceMigration = { workspaceId: workspace, state: 'claimed' };
      const claimed = await adapter.save(storageKind('proposal'), legacy.documentId, payload, { expectedRevision: revision });
      revision = claimed.revision;
    }
    const destinationId = safeId('proposal', recordOwner('proposal', owner, workspace), payload.id);
    let destination = await adapter.load(storageKind('proposal'), destinationId);
    if (!destination) {
      const migrated = { ...structuredClone(payload), workspaceId: workspace };
      delete migrated._workspaceMigration;
      destination = await adapter.save(storageKind('proposal'), destinationId, migrated, { expectedRevision: null });
    }
    await adapter.save(storageKind('proposal'), legacy.documentId, {
      schemaVersion: payload.schemaVersion || 1, id: payload.id, owner,
      _workspaceMigration: { workspaceId: workspace, state: 'complete' },
    }, { expectedRevision: revision });
    return destination;
  }

  async function listRecords(adapter, prefix, owner, workspace = workspaceId()) {
    const records = await adapter.listDocuments(storageKind(prefix));
    const scopedOwner = recordOwner(prefix, owner, workspace);
    const ownerPrefix = `${STORAGE_PREFIXES[prefix]}${fnv(scopedOwner)}-`;
    const legacyPrefix = `${STORAGE_PREFIXES[prefix]}${fnv(owner)}-`;
    const result = records.filter(record => record.documentId.startsWith(ownerPrefix)
      && (prefix === 'proposal' ? String(record.payload?.owner || '') === owner : String(record.payload?.workspaceId || '') === workspace));
    if (prefix !== 'proposal') return result.sort((a, b) => String(a.payload?.id || a.documentId).localeCompare(String(b.payload?.id || b.documentId)));
    for (const record of records.filter(item => item.documentId.startsWith(legacyPrefix) && String(item.payload?.owner || '') === owner && !item.payload?.workspaceId)) {
      const saved = await migrateLegacyProposal(adapter, owner, record, workspace);
      if (saved) result.push(saved);
    }
    return [...new Map(result.filter(record => String(record.payload?.workspaceId || workspace) === workspace).map(record => [record.payload.id, record])).values()]
      .sort((a, b) => String(a.payload?.id || a.documentId).localeCompare(String(b.payload?.id || b.documentId)));
  }

  async function loadRecord(adapter, prefix, owner, id, workspace = workspaceId()) {
    const scopedOwner = recordOwner(prefix, owner, workspace);
    let record = await adapter.load(storageKind(prefix), safeId(prefix, scopedOwner, id));
    if (!record && prefix === 'proposal') {
      const legacy = await adapter.load(storageKind(prefix), safeId(prefix, owner, id));
      if (legacy && !legacy.payload?.workspaceId) {
        record = await migrateLegacyProposal(adapter, owner, legacy, workspace);
      }
    }
    return record && String(record.payload?.id || '') === id
      && (prefix === 'proposal'
        ? String(record.payload?.owner || '') === owner && String(record.payload?.workspaceId || '') === workspace
        : String(record.payload?.workspaceId || '') === workspace) ? record : null;
  }

  function conflictError(error) {
    if (error instanceof window.MeldexSystemStorage.SystemStorageConflictError) {
      error.status = 409;
      error.code = 'scheduler_revision_conflict';
      error.message = '別の環境で案が更新されています。再読み込みしてください';
    }
    return error;
  }

  async function saveRecord(adapter, prefix, owner, payload, expectedRevision, workspace = workspaceId()) {
    try {
      const normalized = { ...payload, workspaceId: workspace };
      return await adapter.save(storageKind(prefix), safeId(prefix, recordOwner(prefix, owner, workspace), payload.id), normalized, { expectedRevision });
    } catch (error) {
      throw conflictError(error);
    }
  }

  async function loadDefinition(adapter, prefix, id, workspace = workspaceId()) {
    return adapter.load(storageKind(prefix), safeId(prefix, workspace, id));
  }

  async function saveDefinition(adapter, prefix, payload, expectedRevision, workspace = workspaceId()) {
    try {
      return await adapter.save(storageKind(prefix), safeId(prefix, workspace, payload.id), { ...payload, workspaceId: workspace }, { expectedRevision });
    } catch (error) { throw conflictError(error); }
  }

  async function listDefinitions(adapter, prefix, workspace = workspaceId()) {
    const records = await adapter.listDocuments(storageKind(prefix));
    const expectedPrefix = `${STORAGE_PREFIXES[prefix]}${fnv(workspace)}-`;
    return records.filter(record => record.documentId.startsWith(expectedPrefix) && record.payload?.workspaceId === workspace)
      .sort((a, b) => String(a.payload?.id || a.payload?.projectId || a.documentId)
        .localeCompare(String(b.payload?.id || b.payload?.projectId || b.documentId)));
  }

  function normalizeSnapshotDomains(value, fallback = SNAPSHOT_DOMAINS) {
    if (value == null) return [...fallback];
    if (!Array.isArray(value) || !value.length) {
      const error = new Error('domains には復元対象を1件以上指定してください'); error.status = 422; throw error;
    }
    const domains = [...new Set(value.map(item => String(item || '').trim()))].sort();
    const unknown = domains.filter(item => !ALL_SNAPSHOT_DOMAINS.includes(item));
    if (unknown.length) {
      const error = new Error(`未対応の復元対象です: ${unknown.join(', ')}`); error.status = 422; throw error;
    }
    return domains;
  }

  async function rowRestoreAdapter(requestContext) {
    const rowFactory = window.MeldexSchedulerRowRestoreCloudAdapter;
    const folderFactory = window.MeldexSchedulerFolderRestoreCloudAdapter;
    if (!rowFactory?.create) {
      const error = new Error('Cloudの行復元を利用できません'); error.status = 503; throw error;
    }
    const rows = await rowFactory.create(requestContext);
    const folders = folderFactory?.create ? await folderFactory.create(requestContext) : null;
    if (folders && rows.identity !== folders.identity) {
      const error = new Error('Cloudの復元先境界が一致しません'); error.status = 409; throw error;
    }
    const selected = domain => {
      if (FOLDER_SNAPSHOT_DOMAINS.includes(domain) && !folders) {
        const error = new Error('Cloudのフォルダー復元を利用できません'); error.status = 503; throw error;
      }
      return FOLDER_SNAPSHOT_DOMAINS.includes(domain) ? folders : rows;
    };
    return Object.freeze({
      identity: rows.identity,
      scope: !folders || rows.scope === folders.scope ? rows.scope : `${rows.scope}+${folders.scope}`,
      captureDomain(domain) { return selected(domain).captureDomain(domain); },
      enumerateTargets(domain) { return selected(domain).enumerateTargets(domain); },
      createVersion(domain, targets, label, capture) { return selected(domain).createVersion(domain, targets, label, capture); },
      targetRevisions(domain, targets) { return selected(domain).targetRevisions(domain, targets); },
      derivedRevision(domain) { return selected(domain).derivedRevision(domain); },
      restoreTarget(domain, version, targets, target, expected, options) {
        return selected(domain).restoreTarget(domain, version, targets, target, expected, options);
      },
    });
  }

  function snapshotDocumentId(scope, owner, snapshotId, workspace = workspaceId()) {
    const namespace = scope === 'personal' ? `${workspace}:${owner}` : workspace;
    return safeId('version', namespace, `${scope}-${snapshotId}`);
  }

  async function templateSelectedRevision(payload, domains) {
    const selected = {};
    if (domains.includes('template')) {
      Object.entries(payload || {}).forEach(([key, value]) => { if (key !== 'classifications') selected[key] = structuredClone(value); });
    }
    if (domains.includes('classification')) selected.classifications = structuredClone(payload?.classifications || []);
    return window.MeldexSystemStorage.computeRevision(selected);
  }

  async function metadataRecordRevisions(adapter, definitions, owner, snapshot, domains, workspace) {
    const result = {};
    if (domains.includes('proposal')) {
      const current = new Map((await listRecords(adapter, 'proposal', owner, workspace)).map(item => [String(item.payload.id), item.revision]));
      for (const item of snapshot.personal.proposals || []) if (item?.id) current.set(String(item.id), current.get(String(item.id)) || null);
      for (const id of [...current.keys()].sort()) result[`proposal:${id}`] = current.get(id);
    }
    if (domains.includes('template') || domains.includes('classification')) {
      const current = new Map((await listDefinitions(definitions, 'template', workspace)).map(item => [String(item.payload.id), item]));
      const ids = new Set(current.keys());
      if (domains.includes('template')) for (const item of snapshot.shared.templates || []) if (item?.id) ids.add(String(item.id));
      if (domains.includes('classification')) for (const item of snapshot.shared.classifications || []) if (item?.templateId) ids.add(String(item.templateId));
      for (const id of [...ids].sort()) result[`template:${id}`] = current.has(id) ? await templateSelectedRevision(current.get(id).payload, domains) : null;
    }
    if (domains.includes('template')) {
      const current = new Map((await listDefinitions(definitions, 'project', workspace)).map(item => [String(item.payload.projectId), item.revision]));
      for (const item of snapshot.shared.projects || []) if (item?.projectId) current.set(String(item.projectId), current.get(String(item.projectId)) || null);
      for (const id of [...current.keys()].sort()) result[`project:${id}`] = current.get(id);
    }
    if (domains.includes('permission')) result['policy:capability-policy'] = (await loadDefinition(definitions, 'policy', 'capability-policy', workspace))?.revision || null;
    if (domains.includes('baseline')) {
      const current = new Map((await listRecords(definitions, 'baseline', owner, workspace)).map(item => [String(item.payload.id), item.revision]));
      for (const item of snapshot.shared.baselines || []) if (item?.id) current.set(String(item.id), current.get(String(item.id)) || null);
      for (const id of [...current.keys()].sort()) result[`baseline:${id}`] = current.get(id);
    }
    return Object.fromEntries(Object.entries(result).sort(([left], [right]) => left.localeCompare(right)));
  }

  async function snapshotManifest(adapter, definitions, owner, domains = SNAPSHOT_DOMAINS, workspace = workspaceId()) {
    const [proposals, baselines, templates, projects, policy] = await Promise.all([
      listRecords(adapter, 'proposal', owner, workspace), listRecords(definitions, 'baseline', owner, workspace),
      listDefinitions(definitions, 'template', workspace), listDefinitions(definitions, 'project', workspace),
      loadDefinition(definitions, 'policy', 'capability-policy', workspace),
    ]);
    const manifest = {};
    if (domains.includes('proposal')) manifest.proposals = proposals.map(item => [item.payload?.id, item.revision]);
    if (domains.includes('baseline')) manifest.baselines = baselines.map(item => [item.payload?.id, item.revision]);
    if (domains.includes('template')) manifest.templates = templates.map(item => {
      const payload = structuredClone(item.payload || {}); delete payload.classifications; return payload;
    });
    if (domains.includes('classification')) manifest.classifications = templates.map(item => ({
      templateId: item.payload?.id, classifications: structuredClone(item.payload?.classifications || []),
    }));
    if (domains.includes('template')) manifest.projects = projects.map(item => [item.payload?.id, item.revision]);
    if (domains.includes('permission')) manifest.permission = policy?.revision || null;
    return window.MeldexSystemStorage.computeRevision(manifest);
  }

  async function createSnapshot(adapter, definitions, owner, body = {}, workspace = workspaceId(), requestContext = null) {
    const domains = normalizeSnapshotDomains(body.domains);
    const rowDomains = domains.filter(item => ROW_SNAPSHOT_DOMAINS.includes(item));
    const domainTargets = {};
    const snapshotId = newId('snapshot');
    const createdAt = nowIso();
    const [proposals, baselines, templates, projects, policy] = await Promise.all([
      listRecords(adapter, 'proposal', owner, workspace), listRecords(definitions, 'baseline', owner, workspace),
      listDefinitions(definitions, 'template', workspace), listDefinitions(definitions, 'project', workspace),
      loadDefinition(definitions, 'policy', 'capability-policy', workspace),
    ]);
    const rowVersions = {};
    let rowRestoreScope = '';
    if (rowDomains.length) {
      const rowAdapter = await rowRestoreAdapter(requestContext);
      rowRestoreScope = rowAdapter.scope;
      for (const domain of rowDomains) {
        const capture = await rowAdapter.captureDomain(domain);
        const targets = capture.targets;
        domainTargets[domain] = targets;
        rowVersions[domain] = await rowAdapter.createVersion(domain, targets, String(body.label || 'スケジューラーのバージョン'), capture);
      }
    }
    const personal = {
      schemaVersion: 1, id: snapshotId, scope: 'personal', owner, workspaceId: workspace,
      createdAt, label: String(body.label || 'スケジューラーのバージョン'), domains,
      proposals: domains.includes('proposal') ? proposals.map(item => structuredClone(item.payload)) : [],
    };
    const shared = {
      schemaVersion: 1, id: snapshotId, scope: 'shared', workspaceId: workspace, createdAt,
      label: personal.label, domains,
      templates: domains.includes('template') ? templates.map(item => {
        const payload = structuredClone(item.payload); delete payload.classifications; return payload;
      }) : [],
      classifications: domains.includes('classification') ? templates.map(item => ({
        templateId: item.payload.id, classifications: structuredClone(item.payload.classifications || []),
      })) : [],
      projects: domains.includes('template') ? projects.map(item => structuredClone(item.payload)) : [],
      baselines: domains.includes('baseline') ? baselines.map(item => structuredClone(item.payload)) : [],
      capabilityPolicy: domains.includes('permission') ? structuredClone(policy?.payload || defaultPolicy()) : null,
      rowVersions,
      externalSyncState: 'reference-only',
    };
    await adapter.save(storageKind('version'), snapshotDocumentId('personal', owner, snapshotId, workspace), personal, { expectedRevision: null });
    await definitions.save(storageKind('version'), snapshotDocumentId('shared', owner, snapshotId, workspace), shared, { expectedRevision: null });
    return { ok: true, snapshotId, createdAt, domains, scopes: ['personal', 'shared'],
      rowRestoreScope,
      externalSyncState: 'not-triggered', aggregateComplete: false };
  }

  async function loadSnapshot(adapter, definitions, owner, snapshotId, workspace = workspaceId()) {
    const [personal, shared] = await Promise.all([
      adapter.load(storageKind('version'), snapshotDocumentId('personal', owner, snapshotId, workspace)),
      definitions.load(storageKind('version'), snapshotDocumentId('shared', owner, snapshotId, workspace)),
    ]);
    if (!personal || !shared || personal.payload?.owner !== owner
      || personal.payload?.workspaceId !== workspace || shared.payload?.workspaceId !== workspace
      || personal.payload?.id !== snapshotId || shared.payload?.id !== snapshotId) {
      const error = new Error('スケジューラーのバージョンが見つかりません'); error.status = 404; throw error;
    }
    return { personal: personal.payload, shared: shared.payload };
  }

  async function restorePreview(adapter, definitions, owner, snapshotId, body = {}, workspace = workspaceId(), requestContext = null) {
    const snapshot = await loadSnapshot(adapter, definitions, owner, snapshotId, workspace);
    const available = normalizeSnapshotDomains(snapshot.shared.domains || snapshot.personal.domains || SNAPSHOT_DOMAINS);
    const domains = normalizeSnapshotDomains(body.domains, available);
    if (domains.some(domain => !available.includes(domain))) {
      const error = new Error('このバージョンに含まれない復元対象です'); error.status = 422; throw error;
    }
    const rowDomains = domains.filter(item => ROW_SNAPSHOT_DOMAINS.includes(item));
    const domainTargets = {};
    const rowRevisions = {};
    let providerRootIdentity = '';
    if (rowDomains.length) {
      const rowAdapter = await rowRestoreAdapter(requestContext);
      providerRootIdentity = rowAdapter.identity;
      for (const domain of rowDomains) {
        const reference = snapshot.shared.rowVersions?.[domain];
        if (!reference) { const error = new Error(`${domain} のVersion参照がありません`); error.status = 422; throw error; }
        const currentTargets = await rowAdapter.enumerateTargets(domain);
        const targets = [...new Set([...(reference.targets || []), ...currentTargets])].sort();
        domainTargets[domain] = targets;
        rowRevisions[domain] = await rowAdapter.targetRevisions(domain, targets);
        if (domain === 'attendance' || domain === 'shift') rowRevisions[domain].__derived__ = await rowAdapter.derivedRevision(domain);
      }
    }
    const currentRevision = await snapshotManifest(adapter, definitions, owner, domains, workspace);
    const recordRevisions = await metadataRecordRevisions(adapter, definitions, owner, snapshot, domains, workspace);
    const restoreToken = await window.MeldexSystemStorage.computeRevision({ snapshotId, domains, currentRevision,
      domainTargets, rowRevisions, providerRootIdentity, metadataRecordRevisions: recordRevisions });
    return {
      ok: true, snapshotId, domains, restoreToken, currentRevision, domainTargets, rowRevisions, providerRootIdentity, metadataRecordRevisions: recordRevisions,
      capabilityPolicyIdentity: String(requestContext?.capabilityPolicyIdentity || ''),
      counts: {
        proposals: domains.includes('proposal') ? (snapshot.personal.proposals || []).length : 0,
        templates: domains.includes('template') ? (snapshot.shared.templates || []).length : 0,
        projects: domains.includes('template') ? (snapshot.shared.projects || []).length : 0,
        classifications: domains.includes('classification') ? (snapshot.shared.classifications || snapshot.shared.templates || []).length : 0,
        permissions: domains.includes('permission') ? 1 : 0,
        baselines: domains.includes('baseline') ? (snapshot.shared.baselines || []).length : 0,
        ...Object.fromEntries(Object.keys(domainTargets).map(domain => [domain, Number(snapshot.shared.rowVersions?.[domain]?.itemCount || 0)])),
      },
      externalSyncState: 'review-required-after-restore', willPushExternalCalendars: false,
      aggregateComplete: false,
    };
  }

  async function restoreRecordSet(adapter, prefix, owner, payloads, revisions, completedRecords, desiredRecords, checkpoint, keyName = 'id', workspace = workspaceId(), selectedDomains = [prefix]) {
    const restoredIds = new Set();
    let restored = 0;
    for (const source of payloads) {
      const id = String(source?.[keyName] || '');
      if (!id) continue;
      const payload = { ...structuredClone(source), id: String(source.id || id) };
      if (keyName !== 'id') payload[keyName] = id;
      const revisionKey = `${prefix}:${id}`;
      const operationKey = `${prefix}:restore:${id}`;
      const current = prefix === 'proposal' || prefix === 'baseline'
        ? await loadRecord(adapter, prefix, owner, id, workspace) : await loadDefinition(adapter, prefix, id, workspace);
      if (prefix === 'proposal' && (payload.owner !== owner || payload.workspaceId !== workspace)) continue;
      if (prefix === 'baseline' && payload.workspaceId !== workspace) continue;
      if (completedRecords.has(operationKey)) {
        if (!current || JSON.stringify(current.payload) !== JSON.stringify(payload)) throw Object.assign(new Error('復元済みrecordが別の環境で変更されました'), { status: 409 });
      } else if (current && JSON.stringify(current.payload) === JSON.stringify(payload)) {
        revisions[revisionKey] = current.revision; completedRecords.add(operationKey); await checkpoint();
      } else {
        const observedRevision = prefix === 'template'
          ? (current ? await templateSelectedRevision(current.payload, selectedDomains) : null)
          : (current?.revision || null);
        if (observedRevision !== (revisions[revisionKey] ?? null)) throw Object.assign(new Error('復元対象の確認後に現在の状態が変わりました'), { status: 409 });
        const saved = prefix === 'proposal' || prefix === 'baseline'
          ? await saveRecord(adapter, prefix, owner, payload, current?.revision ?? null, workspace)
          : await saveDefinition(adapter, prefix, payload, current?.revision ?? null, workspace);
        revisions[revisionKey] = prefix === 'template' ? await templateSelectedRevision(saved.payload, selectedDomains) : saved.revision;
        completedRecords.add(operationKey); await checkpoint();
      }
      restoredIds.add(id); restored += 1;
    }
    let archived = 0;
    const currentRecords = prefix === 'proposal' || prefix === 'baseline'
      ? await listRecords(adapter, prefix, owner, workspace) : await listDefinitions(adapter, prefix, workspace);
    for (const current of currentRecords) {
      const id = String(current.payload?.[keyName] || current.payload?.id || '');
      if (!id || restoredIds.has(id)) continue;
      const operationKey = `${prefix}:archive:${id}`;
      if (current.payload?.status === 'archived') {
        const planned = desiredRecords[operationKey];
        if (planned && JSON.stringify(current.payload) !== JSON.stringify(planned)) throw Object.assign(new Error('復元済みrecordが別の環境で変更されました'), { status: 409 });
        if (!completedRecords.has(operationKey)) {
          revisions[`${prefix}:${id}`] = current.revision; completedRecords.add(operationKey); await checkpoint();
        }
        archived += 1; continue;
      }
      const payload = { ...structuredClone(current.payload), status: 'archived' };
      if (!desiredRecords[operationKey]) { desiredRecords[operationKey] = structuredClone(payload); await checkpoint(); }
      if (completedRecords.has(operationKey)) {
        if (JSON.stringify(current.payload) !== JSON.stringify(payload)) throw Object.assign(new Error('復元済みrecordが別の環境で変更されました'), { status: 409 });
      } else {
        const observedRevision = prefix === 'template' ? await templateSelectedRevision(current.payload, selectedDomains) : current.revision;
        if (observedRevision !== revisions[`${prefix}:${id}`]) throw Object.assign(new Error('復元対象の確認後に現在の状態が変わりました'), { status: 409 });
        const saved = prefix === 'proposal' || prefix === 'baseline'
          ? await saveRecord(adapter, prefix, owner, payload, current.revision, workspace)
          : await saveDefinition(adapter, prefix, payload, current.revision, workspace);
        revisions[`${prefix}:${id}`] = prefix === 'template' ? await templateSelectedRevision(saved.payload, selectedDomains) : saved.revision;
        completedRecords.add(operationKey); await checkpoint();
      }
      archived += 1;
    }
    return { restored, archived };
  }

  async function restoreSnapshotRecords(adapter, definitions, owner, snapshot, domains, revisions, completedRecords, desiredRecords, checkpoint, workspace = workspaceId()) {
    const counts = { proposals: 0, templates: 0, classifications: 0, permissions: 0, projects: 0, baselines: 0, archived: 0 };
    if (domains.includes('proposal')) {
      const result = await restoreRecordSet(adapter, 'proposal', owner, snapshot.personal.proposals || [], revisions, completedRecords, desiredRecords, checkpoint, 'id', workspace);
      counts.proposals = result.restored; counts.archived += result.archived;
    }
    if (domains.includes('template')) {
      const payloads = [];
      for (const source of snapshot.shared.templates || []) {
        if (source?.builtIn) continue;
        const current = await loadDefinition(definitions, 'template', String(source?.id || ''), workspace);
        payloads.push({ ...structuredClone(source), classifications: structuredClone(current?.payload?.classifications || []) });
      }
      const templates = await restoreRecordSet(definitions, 'template', owner, payloads, revisions, completedRecords, desiredRecords, checkpoint, 'id', workspace, domains);
      const projects = await restoreRecordSet(definitions, 'project', owner, snapshot.shared.projects || [], revisions, completedRecords, desiredRecords, checkpoint, 'projectId', workspace);
      counts.templates = templates.restored; counts.projects = projects.restored;
      counts.archived += templates.archived + projects.archived;
    }
    if (domains.includes('classification')) {
      const entries = snapshot.shared.classifications || (snapshot.shared.templates || []).map(item => ({
        templateId: item.id, classifications: item.classifications || [],
      }));
      for (const entry of entries) {
        const id = String(entry?.templateId || '');
        if (!id || id === 'builtin-manga') continue;
        const current = await loadDefinition(definitions, 'template', id, workspace);
        if (!current) continue;
        const operationKey = `classification:restore:${id}`;
        const desired = structuredClone(entry.classifications || []);
        if (completedRecords.has(operationKey)) {
          if (JSON.stringify(current.payload.classifications || []) !== JSON.stringify(desired)) throw Object.assign(new Error('復元済みrecordが別の環境で変更されました'), { status: 409 });
        } else if (JSON.stringify(current.payload.classifications || []) === JSON.stringify(desired)) {
          revisions[`template:${id}`] = await templateSelectedRevision(current.payload, domains); completedRecords.add(operationKey); await checkpoint();
        } else {
          if (await templateSelectedRevision(current.payload, domains) !== revisions[`template:${id}`]) throw Object.assign(new Error('復元対象の確認後に現在の状態が変わりました'), { status: 409 });
          const saved = await saveDefinition(definitions, 'template', { ...structuredClone(current.payload), classifications: desired }, current.revision, workspace);
          revisions[`template:${id}`] = await templateSelectedRevision(saved.payload, domains); completedRecords.add(operationKey); await checkpoint();
        }
        counts.classifications += 1;
      }
    }
    if (domains.includes('permission')) {
      const current = await loadDefinition(definitions, 'policy', 'capability-policy', workspace);
      const desired = { ...deepMerge(defaultPolicy(), snapshot.shared.capabilityPolicy || {}), id: 'capability-policy', workspaceId: workspace };
      const operationKey = 'policy:restore:capability-policy';
      if (completedRecords.has(operationKey)) {
        if (!current || JSON.stringify(current.payload) !== JSON.stringify(desired)) throw Object.assign(new Error('復元済みrecordが別の環境で変更されました'), { status: 409 });
      } else if (current && JSON.stringify(current.payload) === JSON.stringify(desired)) {
        revisions['policy:capability-policy'] = current.revision; completedRecords.add(operationKey); await checkpoint();
      } else {
        if ((current?.revision || null) !== (revisions['policy:capability-policy'] ?? null)) throw Object.assign(new Error('復元対象の確認後に現在の状態が変わりました'), { status: 409 });
        const saved = await saveDefinition(definitions, 'policy', desired, current?.revision ?? null, workspace);
        revisions['policy:capability-policy'] = saved.revision; completedRecords.add(operationKey); await checkpoint();
      }
      counts.permissions = 1;
    }
    if (domains.includes('baseline')) {
      const result = await restoreRecordSet(definitions, 'baseline', owner, snapshot.shared.baselines || [], revisions, completedRecords, desiredRecords, checkpoint, 'id', workspace);
      counts.baselines = result.restored; counts.archived += result.archived;
    }
    return counts;
  }

  async function restoreSnapshot(adapter, definitions, owner, snapshotId, body = {}, workspace = workspaceId(), requestContext = null) {
    const assertPolicyCurrent = async () => requestContext?.assertCapabilityPolicyCurrent?.();
    await assertPolicyCurrent();
    const snapshot = await loadSnapshot(adapter, definitions, owner, snapshotId, workspace);
    const available = normalizeSnapshotDomains(snapshot.shared.domains || snapshot.personal.domains || SNAPSHOT_DOMAINS);
    const requestedDomains = normalizeSnapshotDomains(body.domains, available);
    const journalId = `restore-${snapshotId}-${fnv(requestedDomains.join('|'))}`;
    const existing = await loadRecord(definitions, 'journal', owner, journalId, workspace);
    let domainTargets = structuredClone(existing?.payload?.domainTargets || {});
    if (existing?.payload?.stage === 'complete') {
      if (String(body.restoreToken || '') !== String(existing.payload.restoreToken || '')) {
        throw Object.assign(new Error('復元対象の確認後に現在の状態が変わりました'), { status: 409 });
      }
      if (String(existing.payload.completionPolicyIdentity || existing.payload.capabilityPolicyIdentity || '')
        !== String(requestContext?.capabilityPolicyIdentity || '')) {
        throw Object.assign(new Error('復元完了後に権限policyが変更されました'), { status: 409 });
      }
      const completedFolderDomains = FOLDER_SNAPSHOT_DOMAINS.filter(item => existing.payload.domainTargets?.[item]);
      if (completedFolderDomains.length) {
        const completedAdapter = await rowRestoreAdapter(requestContext);
        if (completedAdapter.identity !== existing.payload.providerRootIdentity) {
          throw Object.assign(new Error('復元完了後にCloudの保存先が切り替わりました'), { status: 409 });
        }
        for (const domain of completedFolderDomains) {
          const targets = existing.payload.domainTargets[domain];
          for (const target of targets) {
            await completedAdapter.restoreTarget(domain, snapshot.shared.rowVersions?.[domain], targets, target,
              existing.payload.rowRevisions?.[domain]?.[target], { verifyOnly: true });
          }
        }
      }
      return { ...structuredClone(existing.payload.result), ok: true, resumed: true };
    }
    let preview;
    let journal;
    let saved;
    if (existing?.payload?.stage === 'failed' || existing?.payload?.stage === 'applying') {
      journal = structuredClone(existing.payload);
      const hasProgress = journal.mutationStarted || (journal.completedMetadataRecords || []).length;
      if (hasProgress) {
        if (String(body.restoreToken || '') !== String(journal.restoreToken || '')) {
          if (journal.stage !== 'failed') throw Object.assign(new Error('復元途中のため同じ確認tokenで再開してください'), { status: 409 });
          preview = await restorePreview(adapter, definitions, owner, snapshotId, { domains: requestedDomains }, workspace, requestContext);
          if (String(body.restoreToken || '') !== preview.restoreToken) throw Object.assign(new Error('再確認後のtokenが一致しません'), { status: 409 });
          domainTargets = preview.domainTargets;
          journal = {
            ...journal, stage: 'preparing', restoreToken: preview.restoreToken, currentRevision: preview.currentRevision,
            metadataRecordRevisions: preview.metadataRecordRevisions, domainTargets, rowRevisions: preview.rowRevisions,
            completedRowTargets: [], restored: {}, providerRootIdentity: preview.providerRootIdentity,
            capabilityPolicyIdentity: preview.capabilityPolicyIdentity,
            metadataDesiredRecords: {}, completedMetadataRecords: [], mutationStarted: false, error: '', updatedAt: nowIso(),
          };
          saved = await saveRecord(definitions, 'journal', owner, journal, existing.revision, workspace);
        } else {
          saved = existing;
        }
      } else {
        preview = await restorePreview(adapter, definitions, owner, snapshotId, { domains: requestedDomains }, workspace, requestContext);
        domainTargets = preview.domainTargets;
        if (String(body.restoreToken || '') !== preview.restoreToken) {
          throw Object.assign(new Error('復元対象の確認後に現在の状態が変わりました'), { status: 409 });
        }
        journal = {
          ...journal, stage: 'preparing', restoreToken: preview.restoreToken,
          currentRevision: preview.currentRevision, metadataRecordRevisions: preview.metadataRecordRevisions,
          domainTargets, rowRevisions: preview.rowRevisions, completedRowTargets: [],
          providerRootIdentity: preview.providerRootIdentity,
          capabilityPolicyIdentity: preview.capabilityPolicyIdentity,
          metadataDesiredRecords: {}, completedMetadataRecords: [], beforeSnapshotId: '',
          mutationStarted: false, error: '', updatedAt: nowIso(),
        };
        saved = await saveRecord(definitions, 'journal', owner, journal, existing.revision, workspace);
      }
    } else {
      preview = await restorePreview(adapter, definitions, owner, snapshotId, { domains: requestedDomains }, workspace, requestContext);
      domainTargets = preview.domainTargets;
      if (String(body.restoreToken || '') !== preview.restoreToken) {
        const error = new Error('復元対象の確認後に現在の状態が変わりました'); error.status = 409; throw error;
      }
      journal = {
        schemaVersion: 1, id: journalId, owner, workspaceId: workspace, stage: 'preparing', snapshotId,
        domains: requestedDomains, restoreToken: preview.restoreToken, currentRevision: preview.currentRevision,
        domainTargets, rowRevisions: preview.rowRevisions, completedRowTargets: [],
        providerRootIdentity: preview.providerRootIdentity,
        capabilityPolicyIdentity: preview.capabilityPolicyIdentity,
        metadataRecordRevisions: preview.metadataRecordRevisions, metadataDesiredRecords: {},
        completedMetadataRecords: [], mutationStarted: false, updatedAt: nowIso(),
      };
      saved = await saveRecord(definitions, 'journal', owner, journal, existing?.revision ?? null, workspace);
    }
    if (Object.keys(domainTargets).length) {
      await assertPolicyCurrent();
      const currentRows = await rowRestoreAdapter(requestContext);
      if (currentRows.identity !== journal.providerRootIdentity) {
        throw Object.assign(new Error('復元中にCloudの保存先が切り替わりました'), { status: 409 });
      }
      // Folder targets are all preflighted before the first target mutation so
      // aggregate restore cannot leave a partially applied folder set because a
      // later canonical target or Version boundary is invalid.
      for (const domain of FOLDER_SNAPSHOT_DOMAINS.filter(item => domainTargets[item])) {
        const targets = domainTargets[domain];
        for (const target of targets) {
          await currentRows.restoreTarget(domain, snapshot.shared.rowVersions?.[domain], targets, target,
            journal.rowRevisions?.[domain]?.[target], { preflightOnly: true });
        }
      }
    }
    try {
      if (!journal.beforeSnapshotId) {
        await assertPolicyCurrent();
        const before = await createSnapshot(adapter, definitions, owner, {
          label: '復元前の自動保存', domains: requestedDomains, domainTargets,
        }, workspace, requestContext);
        const currentRevision = await snapshotManifest(adapter, definitions, owner, requestedDomains, workspace);
        if (currentRevision !== journal.currentRevision) {
          const error = new Error('復元対象の確認後に現在の状態が変わりました'); error.status = 409; throw error;
        }
        journal.beforeSnapshotId = before.snapshotId;
      }
      journal = { ...journal, stage: 'applying', mutationStarted: true, updatedAt: nowIso() };
      saved = await saveRecord(definitions, 'journal', owner, journal, saved.revision, workspace);
      const completedRecords = new Set(journal.completedMetadataRecords || []);
      const revisions = { ...(journal.metadataRecordRevisions || {}) };
      const desiredRecords = structuredClone(journal.metadataDesiredRecords || {});
      const checkpoint = async () => {
        journal = { ...journal, completedMetadataRecords: [...completedRecords].sort(), metadataRecordRevisions: { ...revisions },
          metadataDesiredRecords: structuredClone(desiredRecords), updatedAt: nowIso() };
        saved = await saveRecord(definitions, 'journal', owner, journal, saved.revision, workspace);
      };
      await assertPolicyCurrent();
      const metadataDomains = requestedDomains.filter(domain => domain !== 'permission');
      const checkedCheckpoint = async () => { await assertPolicyCurrent(); return checkpoint(); };
      const restored = await restoreSnapshotRecords(adapter, definitions, owner, snapshot, metadataDomains,
        revisions, completedRecords, desiredRecords, checkedCheckpoint, workspace);
      for (const domain of Object.keys(domainTargets)) restored[domain] = Number(journal.restored?.[domain] || 0);
      if (Object.keys(domainTargets).length) {
        const rowAdapter = await rowRestoreAdapter(requestContext);
        if (rowAdapter.identity !== journal.providerRootIdentity) {
          throw Object.assign(new Error('復元中にCloudの保存先が切り替わりました'), { status: 409 });
        }
        for (const [domain, targets] of Object.entries(domainTargets)) {
          const planned = new Set(targets);
          const unreviewed = (await rowAdapter.enumerateTargets(domain)).filter(target => !planned.has(target));
          if (unreviewed.length) throw Object.assign(new Error('確認後に復元対象の行が追加されました'), { status: 409 });
          const expectedDerived = journal.rowRevisions?.[domain]?.__derived__;
          if (expectedDerived && !(journal.completedRowTargets || []).length && await rowAdapter.derivedRevision(domain) !== expectedDerived) {
            throw Object.assign(new Error('確認後に派生予定が変更されました'), { status: 409 });
          }
        }
        const completedTargets = new Set(journal.completedRowTargets || []);
        for (const [domain, targets] of Object.entries(domainTargets)) {
          restored[domain] = Number(restored[domain] || 0);
          for (const target of targets) {
            await assertPolicyCurrent();
            const operationKey = `${domain}:${target}`;
            const expected = journal.rowRevisions?.[domain]?.[target];
            if (completedTargets.has(operationKey)) {
              await rowAdapter.restoreTarget(domain, snapshot.shared.rowVersions?.[domain], targets, target, expected, { verifyOnly: true });
              continue;
            }
            const result = await rowAdapter.restoreTarget(domain, snapshot.shared.rowVersions?.[domain], targets, target, expected);
            restored[domain] += Number(result.restored || 0);
            completedTargets.add(operationKey);
            journal = { ...journal, restored: structuredClone(restored), completedRowTargets: [...completedTargets].sort(), updatedAt: nowIso() };
            saved = await saveRecord(definitions, 'journal', owner, journal, saved.revision, workspace);
          }
        }
      }
      if (requestedDomains.includes('permission')) {
        await assertPolicyCurrent();
        const permissionCounts = await restoreSnapshotRecords(adapter, definitions, owner, snapshot, ['permission'],
          revisions, completedRecords, desiredRecords, checkpoint, workspace);
        restored.permissions = permissionCounts.permissions;
      }
      const result = {
        ok: true, snapshotId, domains: requestedDomains, beforeSnapshotId: journal.beforeSnapshotId, restored,
        externalSyncState: 'review-required', externalSyncTriggered: false,
      };
      let completionPolicyIdentity = journal.capabilityPolicyIdentity;
      if (requestedDomains.includes('permission')) {
        const completedPolicy = await loadDefinition(definitions, 'policy', 'capability-policy', workspace);
        completionPolicyIdentity = completedPolicy?.revision
          || await window.MeldexSystemStorage.computeRevision(completedPolicy?.payload || defaultPolicy());
      } else {
        await assertPolicyCurrent();
      }
      journal = { ...journal, stage: 'complete', result,
        completionPolicyIdentity,
        updatedAt: nowIso() };
      saved = await saveRecord(definitions, 'journal', owner, journal, saved.revision, workspace);
      return result;
    } catch (error) {
      journal = { ...journal, stage: 'failed', error: String(error?.message || error).slice(0, 500), updatedAt: nowIso() };
      try { await saveRecord(definitions, 'journal', owner, journal, saved.revision, workspace); } catch { /* original error wins */ }
      throw error;
    }
  }

  function defaultPolicy() {
    return { schemaVersion: 1, roleOverrides: {}, userOverrides: {}, history: [], updatedAt: null, updatedBy: null };
  }

  function allowedCapabilities(policy, role, owner, blocked) {
    const normalizedRole = Object.prototype.hasOwnProperty.call(ROLE_DEFAULTS, role) ? role : 'viewer';
    const allowed = { ...ROLE_DEFAULTS[normalizedRole] };
    const applyKnown = values => CAPABILITIES.forEach(capability => {
      if (Object.prototype.hasOwnProperty.call(values || {}, capability)) allowed[capability] = !!values[capability];
    });
    applyKnown(policy?.roleOverrides?.[normalizedRole]);
    applyKnown(policy?.userOverrides?.[owner]);
    if (blocked) CAPABILITIES.forEach(capability => { allowed[capability] = false; });
    return allowed;
  }

  function normalizeTemplate(raw, builtIn = false) {
    const source = structuredClone(raw || {});
    return {
      ...source, schemaVersion: 1, id: String(source.id || newId('template')),
      name: String(source.name || '新しいテンプレート'), builtIn: !!(builtIn || source.builtIn),
      status: source.status === 'archived' ? 'archived' : 'active',
      classifications: Array.isArray(source.classifications) ? source.classifications : [],
      generationRules: Array.isArray(source.generationRules) ? source.generationRules : [],
      savedViews: Array.isArray(source.savedViews) ? source.savedViews : [],
    };
  }

  function normalizeProject(raw, projectId) {
    const source = structuredClone(raw || {});
    return {
      ...source, schemaVersion: 1, projectId: String(projectId),
      primaryTemplateId: String(source.primaryTemplateId || 'builtin-manga'),
      templateOverrides: source.templateOverrides && typeof source.templateOverrides === 'object' ? source.templateOverrides : {},
      addedClassifications: Array.isArray(source.addedClassifications) ? source.addedClassifications : [],
      hiddenClassificationIds: Array.isArray(source.hiddenClassificationIds) ? source.hiddenClassificationIds.map(String) : [],
    };
  }

  function effectiveTemplate(template, settings) {
    const effective = deepMerge(template, settings.templateOverrides || {});
    const hidden = new Set(settings.hiddenClassificationIds || []);
    effective.classifications = (effective.classifications || []).filter(item => !hidden.has(item.id)).concat(settings.addedClassifications || []);
    effective.projectId = settings.projectId;
    return effective;
  }

  function validateTaskValues(template, values) {
    const selected = structuredClone(values || {});
    const warnings = [];
    const classifications = new Map((template.classifications || []).map(item => [item.id, item]));
    Object.entries(selected).forEach(([classificationId, value]) => {
      const classification = classifications.get(classificationId);
      const option = (classification?.options || []).find(item => String(item.id) === String(value));
      if (!classification || classification.status === 'archived' || !option || option.status === 'archived') {
        warnings.push({
          classificationId, value, code: 'incompatible-existing-value',
          message: '現在の設定では選べない既存値です。値は保持されます。',
          replacementOptions: (classification?.options || []).filter(item => item.status !== 'archived').map(item => item.id),
        });
      }
    });
    return { ok: !warnings.length, values: selected, warnings };
  }

  function deepMerge(current, patch) {
    const result = structuredClone(current || {});
    Object.entries(patch || {}).forEach(([key, value]) => {
      result[key] = value && typeof value === 'object' && !Array.isArray(value)
        && result[key] && typeof result[key] === 'object' && !Array.isArray(result[key])
        ? deepMerge(result[key], value) : structuredClone(value);
    });
    return result;
  }

  function withRevision(record) {
    return { ...structuredClone(record.payload), storageRevision: record.revision };
  }

  async function getProposal(adapter, owner, id, workspace) {
    const record = await loadRecord(adapter, 'proposal', owner, id, workspace);
    if (!record) {
      const error = new Error('スケジュール案が見つかりません');
      error.status = 404;
      throw error;
    }
    return record;
  }

  async function nextProposalName(adapter, owner, workspace) {
    const used = new Set((await listRecords(adapter, 'proposal', owner, workspace)).map(record => String(record.payload?.name || '')));
    let index = 1;
    while (used.has(`案${index}`)) index += 1;
    return `案${index}`;
  }

  async function productProgressCost(request, requestContext) {
    const filters = {};
    if (Array.isArray(request?.work_titles) && request.work_titles.length) filters.work_titles = request.work_titles;
    const result = await requestContext.productionRequest('/production-management/tasks/query', { filters, limit: 1000 });
    let rows = Array.isArray(result?.rows) ? result.rows : [];
    if (Array.isArray(request?.task_paths) && request.task_paths.length) {
      const wanted = new Set(request.task_paths.map(path => String(path).replace(/\\/g, '/')));
      rows = rows.filter(row => wanted.has(String(row?.path || '').replace(/\\/g, '/')));
    }
    const staffSnapshot = await requestContext.staffResolver.resolve();
    if (staffSnapshot.duplicates?.length) {
      const duplicate = staffSnapshot.duplicates[0];
      const entries = (duplicate.entries || []).join('、');
      const error = new Error(`ユーザー「${duplicate.user}」が複数のスタッフに設定されています: ${entries}`);
      error.status = 409;
      throw error;
    }
    const staffRows = staffSnapshot.staff || [];
    const rates = new Map(staffRows.flatMap(row => {
      const rate = row?.hourly_rate;
      const numeric = rate === '' || rate == null ? Number.NaN : Number(rate);
      return String(row?.user || '').trim() && Number.isFinite(numeric) && numeric >= 0
        ? [[String(row.user).trim(), numeric]] : [];
    }));
    const missingRates = [];
    let planned = 0;
    rows.forEach(row => {
      const props = row?.properties || {};
      const assignee = String(props['担当者'] || '').trim();
      const rate = rates.get(assignee);
      if (rate == null) {
        missingRates.push({ taskId: String(row?.id || row?.name || ''), assignee });
        return;
      }
      planned += Math.max(0, Number(props['目標作業時間_値']) || 0) * rate;
    });
    const completed = rows.filter(row => String(row?.properties?.['状況'] || '') === '完了').length;
    return {
      progress: { completed, total: rows.length, ratio: rows.length ? completed / rows.length : null },
      cost: {
        planned: missingRates.length ? null : Math.round(planned * 100) / 100,
        actual: null, currency: 'JPY', missingRates,
        actualUnavailableReason: '勤怠実績時間を取得できません',
      },
    };
  }

  function uniqueValues(values) {
    return [...new Set((Array.isArray(values) ? values : (values == null ? [] : [values])).map(String).filter(Boolean))];
  }

  function resolveTemplateEffects(template, values) {
    const result = { durationMultiplier: 1, durationAddHours: 0, assigneeCandidates: [], requiredSkills: [], requiredEquipment: [], dependencies: [] };
    (template?.classifications || []).forEach(classification => {
      const selected = String(values?.[classification.id] || '');
      const option = (classification.options || []).find(item => String(item?.id || '') === selected);
      if (!option) return;
      const role = String(option.effectRole || classification.effectRole || 'display');
      const value = Object.prototype.hasOwnProperty.call(option, 'effectValue') ? option.effectValue : classification.effectValue;
      if (role === 'duration_add') result.durationAddHours += Number(value) || 0;
      else if (role === 'duration_multiply') result.durationMultiplier *= Math.max(0, Number(value) || 1);
      else if (role === 'assignee_candidates') result.assigneeCandidates = uniqueValues([...result.assigneeCandidates, ...uniqueValues(value)]);
      else if (role === 'required_skills') result.requiredSkills = uniqueValues([...result.requiredSkills, ...uniqueValues(value)]);
      else if (role === 'required_equipment') result.requiredEquipment = uniqueValues([...result.requiredEquipment, ...uniqueValues(value)]);
      else if (role === 'dependencies') result.dependencies = uniqueValues([...result.dependencies, ...uniqueValues(value)]);
      else if (role === 'parallel_allowed') result.parallelAllowed = !!value;
      else if (role === 'minimum_slot') result.minimumSlotMinutes = Math.max(1, Math.floor(Number(value) || 10));
      else if (role === 'split_allowed') result.splitAllowed = !!value;
    });
    return result;
  }

  async function connectTemplateEffects(adapter, request, workspace) {
    const taskValues = request?.taskValues;
    if (!taskValues || typeof taskValues !== 'object' || !Object.keys(taskValues).length) return;
    let template = BUILTIN_MANGA;
    if (request.projectId) {
      const project = await loadDefinition(adapter, 'project', request.projectId, workspace);
      const settings = normalizeProject(project?.payload, request.projectId);
      const templateRecord = settings.primaryTemplateId === 'builtin-manga' ? null : await loadDefinition(adapter, 'template', settings.primaryTemplateId, workspace);
      template = effectiveTemplate(normalizeTemplate(templateRecord?.payload || BUILTIN_MANGA), settings);
    } else if (request.templateId && request.templateId !== 'builtin-manga') {
      template = normalizeTemplate((await loadDefinition(adapter, 'template', request.templateId, workspace))?.payload || BUILTIN_MANGA);
    }
    request.taskOptions = structuredClone(request.taskOptions || {});
    request.resolvedTemplateEffects = {};
    Object.entries(taskValues).forEach(([taskId, entry]) => {
      const values = entry && typeof entry === 'object' && Object.prototype.hasOwnProperty.call(entry, 'values') ? entry.values : entry;
      const effects = resolveTemplateEffects(template, values && typeof values === 'object' ? values : {});
      const options = structuredClone(request.taskOptions[taskId] || {});
      const baseHours = entry && typeof entry === 'object' ? (entry.remainingHours ?? entry.estimateHours) : null;
      if (baseHours != null) options.remainingHours = Math.max(0, Number(baseHours) * effects.durationMultiplier + effects.durationAddHours);
      ['assigneeCandidates', 'requiredSkills', 'requiredEquipment', 'dependencies', 'parallelAllowed', 'minimumSlotMinutes', 'splitAllowed'].forEach(key => {
        if (Object.prototype.hasOwnProperty.call(effects, key) && !Object.prototype.hasOwnProperty.call(options, key)) options[key] = structuredClone(effects[key]);
      });
      request.taskOptions[String(taskId)] = options;
      request.resolvedTemplateEffects[String(taskId)] = effects;
    });
  }

  async function createProposal(adapter, owner, body, workspace, requestContext) {
    const request = structuredClone(body || {});
    const aliases = { earliest: 'earliest_completion', fastest: 'earliest_completion', balanced: 'load_balance', 'minimum-overtime': 'minimize_overtime', 'minimum-fragmentation': 'minimize_fragmentation', 'deadline-slack': 'deadline_margin', 'minimum-reassignment': 'minimize_assignee_changes' };
    request.strategy = aliases[request.strategy] || request.strategy || 'recommended';
    request.allowEstimateCompression = false;
    request.allow_estimate_compression = false;
    await connectTemplateEffects(adapter, request, workspace);
    const requestId = String(request.requestId || newId('allocation'));
    delete request.requestId;
    if (CANCELLED.has(requestId)) return { ok: false, requestId, cancelled: true };
    const result = await requestContext.productionRequest('/production-management/recalculate/preview', request);
    if (CANCELLED.has(requestId)) return { ok: false, requestId, cancelled: true };
    const rows = canonicalPlacements(result.rows);
    const timestamp = nowIso();
    const proposal = {
      schemaVersion: PROPOSAL_SCHEMA_VERSION,
      id: newId('proposal'), owner, workspaceId: workspace,
      name: String(body?.name || await nextProposalName(adapter, owner, workspace)),
      status: 'active', parentProposalId: null,
      createdAt: timestamp, updatedAt: timestamp,
      engineVersion: ENGINE_VERSION,
      allocationRequest: request,
      inputRevision: await sourceRevision(rows),
      placements: rows,
      placementRevision: await window.MeldexSystemStorage.computeRevision(placementProjection(rows)),
      fixed: structuredClone(body?.fixed || {}),
      metrics: metrics(rows),
      productSummary: await productProgressCost(request, requestContext),
      warnings: structuredClone(result.warnings || []),
      suggestions: structuredClone(result.suggestions || []),
    };
    const saved = await saveRecord(adapter, 'proposal', owner, proposal, null, workspace);
    return { ok: true, requestId, proposal: withRevision(saved) };
  }

  async function patchProposal(adapter, owner, id, patch, expectedRevision, workspace) {
    const record = await getProposal(adapter, owner, id, workspace);
    if (record.payload.status !== 'active') {
      const error = new Error('採用済みまたは保管済みの案は変更できません');
      error.status = 409;
      throw error;
    }
    if (expectedRevision !== undefined && expectedRevision !== null && expectedRevision !== record.revision) {
      const error = new Error('別の環境で案が更新されています。再読み込みしてください');
      error.status = 409;
      error.code = 'scheduler_revision_conflict';
      throw error;
    }
    const immutable = new Set(['id', 'owner', 'createdAt', 'schemaVersion', 'parentProposalId', 'productSummary']);
    const sanitized = {};
    Object.entries(patch || {}).forEach(([key, value]) => { if (!immutable.has(key)) sanitized[key] = value; });
    const updated = deepMerge(record.payload, sanitized);
    updated.updatedAt = nowIso();
    if (Object.prototype.hasOwnProperty.call(sanitized, 'placements')) {
      updated.placements = canonicalPlacements(updated.placements);
      updated.placementRevision = await window.MeldexSystemStorage.computeRevision(placementProjection(updated.placements));
      updated.metrics = metrics(updated.placements);
    }
    if (Object.prototype.hasOwnProperty.call(sanitized, 'fixedPlacements')) {
      updated.fixedPlacements = normalizeFixedPlacements(sanitized.fixedPlacements);
    }
    const saved = await saveRecord(adapter, 'proposal', owner, updated, record.revision, workspace);
    return { ok: true, proposal: withRevision(saved) };
  }

  async function branchProposal(adapter, owner, id, body, workspace) {
    const record = await getProposal(adapter, owner, id, workspace);
    const timestamp = nowIso();
    const branch = {
      ...structuredClone(record.payload), id: newId('proposal'),
      name: String(body?.name || `${record.payload.name || '案'} のコピー`),
      status: 'active', parentProposalId: id, createdAt: timestamp, updatedAt: timestamp,
    };
    const saved = await saveRecord(adapter, 'proposal', owner, branch, null, workspace);
    return { ok: true, proposal: withRevision(saved) };
  }

  async function recalculateProposal(adapter, owner, id, body, workspace, requestContext) {
    const source = await getProposal(adapter, owner, id, workspace);
    const request = deepMerge(source.payload.allocationRequest || {}, body?.overrides || {});
    const preview = await requestContext.productionRequest('/production-management/recalculate/preview', request);
    const branched = await branchProposal(adapter, owner, id, { name: body?.name || `${source.payload.name || '案'} 再計算` }, workspace);
    return patchProposal(adapter, owner, branched.proposal.id, {
      allocationRequest: request,
      placements: preserveFixedPlacements(source.payload.placements, preview.rows, source.payload.fixedPlacements),
      inputRevision: await sourceRevision(preview.rows),
      engineVersion: ENGINE_VERSION,
      warnings: preview.warnings || [], suggestions: preview.suggestions || [],
    }, branched.proposal.storageRevision, workspace);
  }

  async function adoptionPreview(adapter, owner, id, workspace, requestContext) {
    const proposal = (await getProposal(adapter, owner, id, workspace)).payload;
    const fresh = await requestContext.productionRequest('/production-management/recalculate/preview', proposal.allocationRequest || {});
    const confirmedRevision = await sourceRevision(fresh.rows);
    const conflict = confirmedRevision !== proposal.inputRevision;
    return {
      ok: true, proposalId: id,
      canApply: !conflict && proposal.status === 'active',
      conflicts: conflict ? [{ type: 'confirmed-schedule-changed', message: '案の作成後に確定版が変更されています' }] : [],
      diff: compareRows(fresh.rows, proposal.placements), confirmedRevision,
      proposalInputRevision: proposal.inputRevision,
    };
  }

  async function adoptProposal(adapter, sharedAdapter, owner, id, workspace, requestContext) {
    const proposalRecord = await getProposal(adapter, owner, id, workspace);
    const preview = await adoptionPreview(adapter, owner, id, workspace, requestContext);
    if (!preview.canApply) {
      const error = new Error(preview.conflicts[0]?.message || 'この案は採用できません');
      error.status = 409;
      throw error;
    }
    const adoptionId = `adoption-${fnv(`${owner}:${id}:${proposalRecord.payload.placementRevision}`)}`;
    const existing = await loadRecord(sharedAdapter, 'journal', owner, adoptionId, workspace);
    if (existing?.payload?.stage === 'complete') {
      return { ok: true, resumed: true, adoptionId, baselineId: existing.payload.baselineId };
    }
    if (existing && proposalRecord.payload.status === 'adopted' && proposalRecord.payload.baselineId === existing.payload.baselineId) {
      const adoptedBaseline = await loadRecord(sharedAdapter, 'baseline', owner, existing.payload.baselineId, workspace);
      if (adoptedBaseline?.payload?.status === 'adopted') {
        const complete = { ...existing.payload, stage: 'complete', updatedAt: nowIso() };
        await saveRecord(sharedAdapter, 'journal', owner, complete, existing.revision, workspace);
        return { ok: true, resumed: true, adoptionId, baselineId: existing.payload.baselineId, applied: Number(existing.payload.applied || 0) };
      }
    }
    const baselineId = existing?.payload?.baselineId || newId('baseline');
    let journal = {
      schemaVersion: 1, id: adoptionId, owner, workspaceId: workspace, updatedBy: owner, proposalId: id, baselineId,
      stage: 'prepared', placementRevision: proposalRecord.payload.placementRevision, updatedAt: nowIso(),
    };
    let journalRecord = await saveRecord(sharedAdapter, 'journal', owner, journal, existing?.revision ?? null, workspace);
    const baseline = {
      schemaVersion: 1, id: baselineId, owner, workspaceId: workspace, workspaceKey: workspace, proposalId: id,
      placements: structuredClone(proposalRecord.payload.placements || []),
      placementRevision: proposalRecord.payload.placementRevision,
      confirmedRevisionBefore: preview.confirmedRevision,
      adoptedBy: owner, adoptedAt: nowIso(), status: 'pending',
    };
    const previousBaseline = await loadRecord(sharedAdapter, 'baseline', owner, baselineId, workspace);
    let baselineRecord = await saveRecord(sharedAdapter, 'baseline', owner, baseline, previousBaseline?.revision ?? null, workspace);
    journal = { ...journal, stage: 'applying', updatedAt: nowIso() };
    journalRecord = await saveRecord(sharedAdapter, 'journal', owner, journal, journalRecord.revision, workspace);
    try {
      const finalPreview = await adoptionPreview(adapter, owner, id, workspace, requestContext);
      if (!finalPreview.canApply) {
        const conflict = new Error(finalPreview.conflicts[0]?.message || 'この案は採用できません'); conflict.status = 409; throw conflict;
      }
      const latestProposal = await getProposal(adapter, owner, id, workspace);
      if (latestProposal.revision !== proposalRecord.revision) {
        const conflict = new Error('別の環境で案が更新されています'); conflict.status = 409; throw conflict;
      }
      const placements = proposalRecord.payload.placements || [];
      const applied = placements.length ? await requestContext.productionRequest('/production-management/recalculate/apply', {
        ...(proposalRecord.payload.allocationRequest || {}),
        rows: placements,
        expected_source_revision: proposalRecord.payload.inputRevision,
      }) : { ok: true, applied: 0, unassigned: 0, cloud: true };
      baseline.status = 'adopted';
      baseline.adoptedAt = nowIso();
      baselineRecord = await saveRecord(sharedAdapter, 'baseline', owner, baseline, baselineRecord.revision, workspace);
      await patchProposal(adapter, owner, id, {
        status: 'adopted', adoptedAt: baseline.adoptedAt, baselineId,
      }, proposalRecord.revision, workspace);
      journal = { ...journal, stage: 'proposal-updated', applied: Number(applied.applied || 0), updatedAt: nowIso() };
      journalRecord = await saveRecord(sharedAdapter, 'journal', owner, journal, journalRecord.revision, workspace);
      journal = { ...journal, stage: 'complete', updatedAt: nowIso() };
      await saveRecord(sharedAdapter, 'journal', owner, journal, journalRecord.revision, workspace);
      return { ok: true, adoptionId, baselineId, applied: Number(applied.applied || 0) };
    } catch (error) {
      journal = { ...journal, stage: 'retry-pending', error: String(error?.message || error).slice(0, 500), updatedAt: nowIso() };
      try { await saveRecord(sharedAdapter, 'journal', owner, journal, journalRecord.revision, workspace); } catch { /* original error wins */ }
      throw error;
    }
  }

  function capabilityManifest(writable, owner, role, policy, workspace = workspaceId()) {
    const write = writable !== false;
    const allowed = allowedCapabilities(policy, role, owner, !write);
    return {
      ok: true, apiVersion: API_VERSION, engineVersion: ENGINE_VERSION,
      proposalSchemaVersion: PROPOSAL_SCHEMA_VERSION,
      workspaceId: workspace,
      features: {
        allocationPreview: write, allocationCancel: true, proposalCrud: write,
        proposalBranch: write, proposalRecalculate: write, proposalCompare: true,
        adoptionPreview: true, adoptionApply: write, baselineList: true, baselineCompare: true,
        placementCardFixed: true,
        durableAdoptionJournal: true, aggregateSnapshotRestore: true,
        schedulerSnapshotRestore: true, calendarVersionApiDelegation: true,
        capabilityPolicy: true, genericTemplates: true, legacyProductionManagementAdapters: true,
        unknownFieldPreservation: true,
      },
      actor: { user: owner, role }, allowed,
      policyRevision: null, policy: { writable: write }, cloud: true,
    };
  }

  async function handleRequest({ method, body, url, pathname }, internals) {
    if (!/^\/scheduler(\/|$)/.test(pathname)) return internals.NOT_HANDLED;
    const params = url.searchParams;
    // current_user は互換パラメーターとして届いても認証情報には使わない。
    // 個人案の名前空間は、アプリが確立したローカル本人情報だけで決める。
    const owner = currentUser();
    const requestWorkspace = workspaceId();
    const requestWorkspaceRecord = window.MeldexWorkspaces?.getActiveWorkspace?.() || null;
    if (requestWorkspace !== 'cloud-local-workspace'
      && String(requestWorkspaceRecord?.id || '') !== requestWorkspace) {
      throw Object.assign(new Error('workspace情報を確認できないため操作を開始できません'), { status: 409 });
    }
    const readOnly = method === 'GET' || pathname.endsWith('/adoption/preview') || pathname.includes('/compare/');
    const provider = await internals._requirePwaProvider(readOnly ? 'read' : 'readwrite');
    if (workspaceId() !== requestWorkspace) {
      throw Object.assign(new Error('workspace切替中のため操作を開始できません'), { status: 409 });
    }
    const role = await trustedWorkspaceRole(owner, requestWorkspace, requestWorkspaceRecord);
    if (workspaceId() !== requestWorkspace) {
      throw Object.assign(new Error('workspace切替中のため操作を開始できません'), { status: 409 });
    }
    const requestIdentity = Object.freeze({ workspaceId: requestWorkspace, actor: owner, role });
    const productionRequest = (path, requestBody) => {
      const management = window.MeldexProductionManagement;
      const internals = window.__MeldexPwaDataAccessInternals;
      if (!management || !internals) throw new Error('Cloud制作管理の固定読み込み経路を利用できません');
      if (path === '/production-management/tasks/query') {
        return management.queryCloudTasksWithProvider(provider, internals, requestBody || {});
      }
      if (path === '/production-management/recalculate/preview') {
        return window.MeldexProductionRecalcCloudAdapter.previewCloud(
          provider, internals, requestBody || {}, { ...management.cloudRecalcDeps(), boundStaffResolver: staffResolver },
        );
      }
      if (path === '/production-management/recalculate/apply') {
        return management.withCloudProductionLease(provider, () => (
          window.MeldexProductionRecalcCloudAdapter.applyCloud(
            provider, internals, requestBody || {}, { ...management.cloudRecalcDeps(), boundStaffResolver: staffResolver },
          )
        ));
      }
      throw new Error(`provider固定の制作管理読み込みに未対応の経路です: ${path}`);
    };
    const staffResolver = window.MeldexStaffRegistryCloudTwin?.createBoundStaffResolver?.(provider, requestIdentity);
    if (!staffResolver) throw new Error('Cloudスタッフの固定読み込み経路を利用できません');
    let requestContext = Object.freeze({ ...requestIdentity, provider, productionRequest, staffResolver });
    const adapter = await personalAdapter(provider);
    const blocked = window.MeldexProductionUiAvailability?.current?.().blocked === true;
    const definitions = await workspaceAdapter(provider);
    const policyRecord = await loadDefinition(definitions, 'policy', 'capability-policy', requestContext.workspaceId);
    const capabilityPolicyIdentity = policyRecord?.revision
      || await window.MeldexSystemStorage.computeRevision(policyRecord?.payload || defaultPolicy());
    const assertCapabilityPolicyCurrent = async () => {
      const current = await loadDefinition(definitions, 'policy', 'capability-policy', requestIdentity.workspaceId);
      const currentIdentity = current?.revision
        || await window.MeldexSystemStorage.computeRevision(current?.payload || defaultPolicy());
      if (String(currentIdentity) !== String(capabilityPolicyIdentity)) {
        const error = new Error('復元中に権限policyが変更されました'); error.status = 409;
        error.expectedPolicyIdentity = capabilityPolicyIdentity; error.actualPolicyIdentity = currentIdentity; throw error;
      }
    };
    requestContext = Object.freeze({ ...requestContext, capabilityPolicyIdentity, assertCapabilityPolicyCurrent });
    const allowed = allowedCapabilities(policyRecord?.payload || defaultPolicy(), role, owner, blocked);
    const requireCapability = capability => {
      if (allowed[capability]) return;
      const error = new Error('この操作を行う権限がありません');
      error.status = 403;
      throw error;
    };
    if (pathname === '/scheduler/capabilities' && method === 'GET') {
      const result = capabilityManifest(!blocked, owner, role, policyRecord?.payload || defaultPolicy(), requestWorkspace);
      result.policyRevision = policyRecord?.revision || null;
      return result;
    }
    if (pathname === '/scheduler/capability-policy' && method === 'GET') {
      requireCapability('scheduler.policy.manage');
      return { ok: true, policy: deepMerge(defaultPolicy(), policyRecord?.payload || {}), storageRevision: policyRecord?.revision || null };
    }
    if (pathname === '/scheduler/capability-policy' && method === 'PATCH') {
      requireCapability('scheduler.policy.manage');
      if (body?.expectedRevision != null && body.expectedRevision !== (policyRecord?.revision || null)) {
        const error = new Error('別の環境で能力設定が更新されています'); error.status = 409; throw error;
      }
      const before = deepMerge(defaultPolicy(), policyRecord?.payload || {});
      const policy = deepMerge(defaultPolicy(), deepMerge(before, body?.patch || {}));
      policy.updatedAt = nowIso(); policy.updatedBy = owner;
      policy.history = [...(Array.isArray(before.history) ? before.history : []), {
        actor: owner, changedAt: policy.updatedAt,
        before: { roleOverrides: structuredClone(before.roleOverrides || {}), userOverrides: structuredClone(before.userOverrides || {}) },
        after: { roleOverrides: structuredClone(policy.roleOverrides || {}), userOverrides: structuredClone(policy.userOverrides || {}) },
      }].slice(-100);
      const saved = await saveDefinition(definitions, 'policy', { ...policy, id: 'capability-policy' }, policyRecord?.revision ?? null, requestWorkspace);
      return { ok: true, policy, storageRevision: saved.revision };
    }
    if (pathname === '/scheduler/capability-policy/reset' && method === 'POST') {
      requireCapability('scheduler.policy.manage');
      const before = deepMerge(defaultPolicy(), policyRecord?.payload || {});
      const policy = { ...defaultPolicy(), id: 'capability-policy', updatedAt: nowIso(), updatedBy: owner };
      policy.history = [...(Array.isArray(before.history) ? before.history : []), {
        actor: owner, changedAt: policy.updatedAt,
        before: { roleOverrides: structuredClone(before.roleOverrides || {}), userOverrides: structuredClone(before.userOverrides || {}) },
        after: { roleOverrides: {}, userOverrides: {} },
      }].slice(-100);
      const saved = await saveDefinition(definitions, 'policy', policy, policyRecord?.revision ?? null, requestWorkspace);
      return { ok: true, policy, storageRevision: saved.revision };
    }
    if (pathname === '/scheduler/templates' && method === 'GET') {
      requireCapability('scheduler.settings.manage');
      const custom = (await listDefinitions(definitions, 'template', requestWorkspace)).map(record => ({ ...normalizeTemplate(record.payload), storageRevision: record.revision }));
      return { ok: true, templates: [{ ...normalizeTemplate(BUILTIN_MANGA, true), storageRevision: null }, ...custom.filter(item => params.get('include_archived') === 'true' || item.status !== 'archived')] };
    }
    if (pathname === '/scheduler/templates' && method === 'POST') {
      requireCapability('scheduler.settings.manage');
      const template = { ...normalizeTemplate(body?.template || body), builtIn: false, createdAt: nowIso(), updatedAt: nowIso(), updatedBy: owner };
      const saved = await saveDefinition(definitions, 'template', template, null, requestWorkspace);
      return { ok: true, template: { ...template, storageRevision: saved.revision } };
    }
    const templateMatch = pathname.match(/^\/scheduler\/templates\/([^/]+)(?:\/(clone|archive))?$/);
    if (templateMatch) {
      requireCapability('scheduler.settings.manage');
      const templateId = decodeURIComponent(templateMatch[1]);
      const source = templateId === 'builtin-manga' ? { payload: BUILTIN_MANGA, revision: null } : await loadDefinition(definitions, 'template', templateId, requestWorkspace);
      if (!source) { const error = new Error('テンプレートが見つかりません'); error.status = 404; throw error; }
      if (templateMatch[2] === 'clone' && method === 'POST') {
        const clone = { ...normalizeTemplate(source.payload), id: String(body?.id || newId('template')), name: String(body?.name || `${source.payload.name} のコピー`), builtIn: false, status: 'active', createdAt: nowIso(), updatedAt: nowIso(), updatedBy: owner };
        const saved = await saveDefinition(definitions, 'template', clone, null, requestWorkspace);
        return { ok: true, template: { ...clone, storageRevision: saved.revision } };
      }
      if (templateId === 'builtin-manga') { const error = new Error('組み込みテンプレートは複製して編集してください'); error.status = 409; throw error; }
      if (body?.expectedRevision != null && body.expectedRevision !== source.revision) {
        const error = new Error('別の環境でテンプレートが更新されています'); error.status = 409; throw error;
      }
      const patch = templateMatch[2] === 'archive' ? { status: 'archived' } : (body?.patch || {});
      const updated = { ...normalizeTemplate(deepMerge(source.payload, patch)), updatedAt: nowIso(), updatedBy: owner };
      const saved = await saveDefinition(definitions, 'template', updated, source.revision, requestWorkspace);
      return { ok: true, template: { ...updated, storageRevision: saved.revision } };
    }
    const projectMatch = pathname.match(/^\/scheduler\/projects\/([^/]+)\/settings$/);
    if (projectMatch) {
      requireCapability('scheduler.settings.manage');
      const projectId = decodeURIComponent(projectMatch[1]);
      const source = await loadDefinition(definitions, 'project', projectId, requestWorkspace);
      if (method === 'GET') {
        const settings = normalizeProject(source?.payload, projectId);
        const templateRecord = settings.primaryTemplateId === 'builtin-manga' ? { payload: BUILTIN_MANGA } : await loadDefinition(definitions, 'template', settings.primaryTemplateId, requestWorkspace);
        return { ok: true, settings, effectiveTemplate: effectiveTemplate(normalizeTemplate(templateRecord?.payload || BUILTIN_MANGA), settings), storageRevision: source?.revision || null };
      }
      if (method === 'PUT') {
        if (body?.expectedRevision != null && body.expectedRevision !== (source?.revision || null)) {
          const error = new Error('別の環境でプロジェクト設定が更新されています'); error.status = 409; throw error;
        }
        const settings = { ...normalizeProject(deepMerge(source?.payload || {}, body?.patch || body?.settings || {}), projectId), updatedAt: nowIso(), updatedBy: owner };
        const saved = await saveDefinition(definitions, 'project', { ...settings, id: projectId }, source?.revision ?? null, requestWorkspace);
        const templateRecord = settings.primaryTemplateId === 'builtin-manga' ? { payload: BUILTIN_MANGA } : await loadDefinition(definitions, 'template', settings.primaryTemplateId, requestWorkspace);
        return { ok: true, settings, effectiveTemplate: effectiveTemplate(normalizeTemplate(templateRecord?.payload || BUILTIN_MANGA), settings), storageRevision: saved.revision };
      }
    }
    if (pathname === '/scheduler/tasks/validate' && method === 'POST') {
      requireCapability('scheduler.settings.manage');
      let template = BUILTIN_MANGA;
      if (body?.projectId) {
        const project = await loadDefinition(definitions, 'project', body.projectId, requestWorkspace);
        const settings = normalizeProject(project?.payload, body.projectId);
        const templateRecord = settings.primaryTemplateId === 'builtin-manga' ? { payload: BUILTIN_MANGA } : await loadDefinition(definitions, 'template', settings.primaryTemplateId, requestWorkspace);
        template = effectiveTemplate(normalizeTemplate(templateRecord?.payload || BUILTIN_MANGA), settings);
      } else if (body?.templateId && body.templateId !== 'builtin-manga') {
        template = normalizeTemplate((await loadDefinition(definitions, 'template', body.templateId, requestWorkspace))?.payload || BUILTIN_MANGA);
      }
      return validateTaskValues(template, body?.values);
    }
    if (pathname === '/scheduler/snapshots' && method === 'POST') {
      requireCapability('scheduler.baseline.manage');
      return createSnapshot(adapter, definitions, owner, body || {}, requestWorkspace, requestContext);
    }
    const snapshotMatch = pathname.match(/^\/scheduler\/snapshots\/([^/]+)\/(restore-preview|restore-apply)$/);
    if (snapshotMatch && method === 'POST') {
      requireCapability('scheduler.policy.manage');
      const snapshotId = decodeURIComponent(snapshotMatch[1]);
      if (snapshotMatch[2] === 'restore-preview') return restorePreview(adapter, definitions, owner, snapshotId, body || {}, requestWorkspace, requestContext);
      return restoreSnapshot(adapter, definitions, owner, snapshotId, body || {}, requestWorkspace, requestContext);
    }
    if (pathname === '/scheduler/version-manifest' && method === 'GET') {
      requireCapability('scheduler.proposal.manage');
      const proposals = await listRecords(adapter, 'proposal', owner, requestWorkspace);
      const baselines = await listRecords(definitions, 'baseline', owner, requestWorkspace);
      return {
        ok: true, scope: { personalOwner: owner, workspaceKey: requestWorkspace },
        engineVersion: ENGINE_VERSION,
        proposalRevision: await window.MeldexSystemStorage.computeRevision(proposals.map(record => [record.payload.id, record.revision])),
        baselineRevision: await window.MeldexSystemStorage.computeRevision(baselines.map(record => [record.payload.id, record.revision])),
        externalSyncState: 'unchanged', recoveryJournal: 'durable', cloud: true,
      };
    }
    if (pathname === '/scheduler/allocation/cancel' && method === 'POST') {
      requireCapability('scheduler.allocate');
      const requestId = String(body?.requestId || '');
      if (!requestId) {
        const error = new Error('requestId is required'); error.status = 404; throw error;
      }
      CANCELLED.add(requestId);
      return { ok: true, requestId, cancelled: true };
    }
    if (pathname === '/scheduler/allocation/preview' && method === 'POST') {
      requireCapability('scheduler.allocate');
      return createProposal(adapter, owner, body || {}, requestWorkspace, requestContext);
    }
    if (pathname === '/scheduler/proposals' && method === 'GET') {
      requireCapability('scheduler.proposal.manage');
      let records = await listRecords(adapter, 'proposal', owner, requestWorkspace);
      if (params.get('include_archived') !== 'true') records = records.filter(record => !['archived', 'adopted', 'rejected'].includes(record.payload.status));
      records.sort((a, b) => String(b.payload.updatedAt || '').localeCompare(String(a.payload.updatedAt || '')));
      return { ok: true, proposals: records.map(withRevision), cloud: true };
    }
    const proposalMatch = pathname.match(/^\/scheduler\/proposals\/([^/]+)(?:\/(.*))?$/);
    if (proposalMatch) {
      requireCapability(proposalMatch[2]?.startsWith('adoption/') ? 'scheduler.adopt' : 'scheduler.proposal.manage');
      const id = decodeURIComponent(proposalMatch[1]);
      const action = proposalMatch[2] || '';
      if (!action && method === 'GET') return { ok: true, proposal: withRevision(await getProposal(adapter, owner, id, requestWorkspace)) };
      if (!action && method === 'PATCH') return patchProposal(adapter, owner, id, body?.patch || {}, body?.expectedRevision, requestWorkspace);
      if (!action && method === 'DELETE') return patchProposal(adapter, owner, id, { status: 'archived' }, params.get('expected_revision'), requestWorkspace);
      if (action === 'branch' && method === 'POST') return branchProposal(adapter, owner, id, body || {}, requestWorkspace);
      if (action === 'recalculate' && method === 'POST') return recalculateProposal(adapter, owner, id, body || {}, requestWorkspace, requestContext);
      if (action.startsWith('compare/') && method === 'GET') {
        const otherId = decodeURIComponent(action.slice('compare/'.length));
        const proposal = (await getProposal(adapter, owner, id, requestWorkspace)).payload;
        const other = (await getProposal(adapter, owner, otherId, requestWorkspace)).payload;
        return { ok: true, baseProposalId: otherId, proposalId: id, ...compareRows(other.placements, proposal.placements) };
      }
      if (action === 'adoption/preview' && method === 'POST') return adoptionPreview(adapter, owner, id, requestWorkspace, requestContext);
      if (action === 'adoption/apply' && method === 'POST') return adoptProposal(adapter, definitions, owner, id, requestWorkspace, requestContext);
    }
    if (pathname === '/scheduler/baselines' && method === 'GET') {
      requireCapability('scheduler.baseline.manage');
      const baselines = (await listRecords(definitions, 'baseline', owner, requestWorkspace)).map(record => ({
        ...structuredClone(record.payload), workspaceId: record.payload.workspaceId || requestWorkspace,
        workspaceKey: record.payload.workspaceKey || record.payload.workspaceId || requestWorkspace, storageRevision: record.revision,
      })).sort((a, b) => `${b.adoptedAt || ''}\u0000${b.id || ''}`.localeCompare(`${a.adoptedAt || ''}\u0000${a.id || ''}`));
      return { ok: true, baselines };
    }
    const baselineMatch = pathname.match(/^\/scheduler\/baselines\/([^/]+)\/compare\/([^/]+)$/);
    if (baselineMatch && method === 'GET') {
      requireCapability('scheduler.baseline.manage');
      const baselineId = decodeURIComponent(baselineMatch[1]);
      const proposalId = decodeURIComponent(baselineMatch[2]);
      const baseline = await loadRecord(definitions, 'baseline', owner, baselineId, requestWorkspace);
      if (!baseline) { const error = new Error('ベースラインが見つかりません'); error.status = 404; throw error; }
      const proposal = (await getProposal(adapter, owner, proposalId, requestWorkspace)).payload;
      return { ok: true, baselineId, proposalId, ...compareRows(baseline.payload.placements, proposal.placements) };
    }
    return internals.NOT_HANDLED;
  }

  function install() {
    const internals = window.__MeldexPwaDataAccessInternals;
    const extensions = window.__MeldexPwaDataAccessExtensions;
    if (!internals || !Array.isArray(extensions)) return false;
    if (extensions.some(handler => handler.__meldexSchedulerCloud)) return true;
    const handler = request => handleRequest(request, internals);
    handler.__meldexSchedulerCloud = true;
    extensions.push(handler);
    return true;
  }

  window.MeldexSchedulerCloudAdapter = Object.freeze({
    install, canonicalPlacements, compareRows, metrics,
    _internal: { safeId, sourceRevision, capabilityManifest, trustedWorkspaceRole },
  });
  install();
})();
