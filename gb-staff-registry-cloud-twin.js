/* ==============================
   gb-staff-registry-cloud-twin.js: 正本「スタッフ管理シート」のクラウド静的版twin

   ユーザーアカウント一元管理 計画書 Phase 1-4
   （docs/user-account-unification-plan-2026-07-18.md）

   デスクトップ版のサーバーAPI（meldex_api_staff_registry.py /
   meldex_staff_registry_service.py）が正本の意味論を持つ。このファイルは
   同じ5ルート（config GET/PUT・ensure・list・upsert）を、Dropboxブラウザ
   完結版（サーバー無し）向けに __MeldexPwaDataAccessExtensions ハンドラとして
   再実装する（gb-production-management.part01.js の
   _pmInstallCloudHandler と同じ配線パターン）。

   正本シートは通常のフォルダ型シート（フォルダノート + 1スタッフ=1個別.md）
   であり、gb-data-access-dropbox-expanded.part01.js の _ensureFolderNote が
   作る「storage: sqlite 集約ストア」方式のsettings-dbとは別物（デスクトップ版と
   同じVaultを共有する必要があるため）。フォルダノートのfrontmatterはPythonの
   meldex_frontmatter.write_frontmatter が書くYAMLと相互互換な「行ごとに
   JSON.stringify した値」形式（JSONはYAML flow styleのサブセット）で書く。

   デスクトップとの既知の差異（設計判断。詳細は同計画書の実装ログ参照）:
   - デスクトップは複数の「ソースフォルダ」（load_outliner_roots）を横断して
     正本を自動発見・既定作成できるが、クラウド静的版は1つのDropbox接続 =
     1つのワークスペースルートしか持たない（gb-production-management.js が
     制作管理フォルダをワークスペース直下に直接作るのと同じ前提）。そのため
     自動発見・既定作成はワークスペース直下（相対パス ''）だけを対象にする。
   - 設定の保存先は editor-config.json ではなく、既存の /ui-config twin
     （gb-data-access.part01.js の PWA_UI_CONFIG_KEY）と同じ localStorage
     キーを使う（計画書§5.1）。/ui-config 自体のGET/PUTはオブジェクト全体を
     置き換えるため、ここでは同じキーを読み書きしつつ staff_registry
     サブキーだけをマージする（他のUI設定を巻き戻さない）。
   - YAML-lite フロントマターの読み書きと書き込み権限エラー判定は
     gb-cloud-frontmatter-lite.js（共有ヘルパー、2026-07-20にproduction-management側と統合）へ委譲する。
   ============================== */
(function () {
  'use strict';

  const internals = window.__MeldexPwaDataAccessInternals;
  const handlers = window.__MeldexPwaDataAccessExtensions;
  if (!internals || !Array.isArray(handlers)) return;

  const {
    NOT_HANDLED,
    _normalizeFolderPath,
    _joinPath,
    _basename,
    _requirePwaProvider,
    _directoryHandle,
    _resolveEntryHandle,
    _listDirectoryEntries,
    _safeReadJson,
    _safeWriteJson,
  } = internals;

  // gb-data-access.part01.js の PWA_UI_CONFIG_KEY と同じ値（internals経由では
  // 未公開の定数のためここで複製する。値を変更する場合は両方同時に直すこと）。
  const UI_CONFIG_KEY = 'meldex-cloud-ui-config';
  const CONFIG_SUBKEY = 'staff_registry';
  const STAFF_STATUS = '採用';

  function _schema() {
    return window.MeldexStaffRegistrySchema;
  }

  function _nowIso() {
    return new Date().toISOString();
  }

  // ============================================================
  // YAML-lite フロントマター読み書き・権限エラー判定は
  // gb-cloud-frontmatter-lite.js（共有ヘルパー）へ委譲
  // ============================================================

  const {
    isNotFoundError: _srtIsNotFoundError,
    isWriteAccessError: _srtIsWriteAccessError,
    frontmatterText: _srtFrontmatterText,
    readFrontmatter: _srtReadFrontmatter,
  } = window.MeldexCloudFrontmatterLite;

  // ============================================================
  // パス・エントリの下請け
  // ============================================================

  function _srtSafeName(value) {
    return String(value || '無題').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').trim().slice(0, 100) || '無題';
  }

  function _srtRandomHex(len) {
    if (globalThis.crypto?.randomUUID) return crypto.randomUUID().replace(/-/g, '').slice(0, len);
    let hex = '';
    while (hex.length < len) hex += Math.random().toString(16).slice(2);
    return hex.slice(0, len);
  }

  async function _srtDirectoryEntries(provider, path) {
    try {
      return await _listDirectoryEntries(provider, path);
    } catch (error) {
      if (_srtIsNotFoundError(error)) return [];
      throw error;
    }
  }

  async function _srtEntryKind(provider, path) {
    if (typeof provider?.statPath === 'function') {
      const stat = await provider.statPath(path).catch(() => null);
      return stat?.kind || null;
    }
    try {
      const entry = await _resolveEntryHandle(provider, path);
      return entry?.kind || null;
    } catch {
      return null;
    }
  }

  async function _srtPathExists(provider, path) {
    return !!(await _srtEntryKind(provider, path));
  }

  async function _srtIsDirectory(provider, path) {
    return (await _srtEntryKind(provider, path)) === 'directory';
  }

  async function _srtEntryFiles(provider, root) {
    const rootBase = _basename(root);
    const entries = await _srtDirectoryEntries(provider, root);
    return entries
      .filter(e => e?.handle?.kind === 'file' && e.name.endsWith('.md') && e.name !== rootBase + '.md' && !e.name.startsWith('_'))
      .map(e => ({ name: e.name, path: _joinPath(root, e.name), stem: e.name.replace(/\.md$/i, '') }));
  }

  // ============================================================
  // 設定（正本の置き場所）— /ui-config と同じ localStorage キーを共有する
  // ============================================================

  function _srtGetConfig() {
    const cfg = _safeReadJson(UI_CONFIG_KEY, {});
    const raw = cfg && typeof cfg === 'object' ? cfg[CONFIG_SUBKEY] : null;
    if (!raw || typeof raw !== 'object') return { path: '', updated: '' };
    return { path: String(raw.path || ''), updated: String(raw.updated || '') };
  }

  function _srtSetConfig(path) {
    const cfg = _safeReadJson(UI_CONFIG_KEY, {});
    const base = cfg && typeof cfg === 'object' ? { ...cfg } : {};
    const value = { path: _normalizeFolderPath(path || ''), updated: _nowIso() };
    base[CONFIG_SUBKEY] = value;
    _safeWriteJson(UI_CONFIG_KEY, base);
    return value;
  }

  function _srtRole() {
    const state = window.MeldexRuntimeAdapter?.getWorkspaceState?.() || {};
    if (state.isOwner) return 'owner';
    if (state.access === 'viewer') return 'viewer';
    return 'editor';
  }

  function _srtRequireOwner() {
    if (_srtRole() !== 'owner') throw new Error('スタッフ管理シートの保存先変更は管理者のみ可能です');
  }

  // ============================================================
  // 正本の場所解決（自己修復・自動発見・無ダイアログ既定作成）
  //
  // meldex_staff_registry_service.ensure_or_discover_registry_root と同じ
  // 優先順位（設定済み→自動発見→既定作成）だが、クラウド静的版はワークスペース
  // ルートが1つしか無いため「複数ソースフォルダを横断」する部分だけ単純化する。
  // ============================================================

  async function _srtDiscoverExistingRoot(provider) {
    const schema = _schema();
    const entries = await _srtDirectoryEntries(provider, '');
    for (const entry of entries) {
      if (entry?.handle?.kind !== 'directory') continue;
      const name = String(entry.name || '');
      if (!name || name.startsWith('.') || name.startsWith('_')) continue;
      const note = _joinPath(name, name + '.md');
      if (!await _srtPathExists(provider, note)) continue;
      let parsed;
      try { parsed = await _srtReadFrontmatter(provider, note); } catch { continue; }
      if (schema.isStaffRegistryFrontmatter(parsed.frontmatter)) return name;
    }
    return null;
  }

  async function _srtEnsureOrDiscoverRoot(provider) {
    const configured = _normalizeFolderPath(_srtGetConfig().path || '');
    if (configured) {
      await _srtEnsureRegistrySheet(provider, configured);
      return configured;
    }
    const discovered = await _srtDiscoverExistingRoot(provider);
    if (discovered) {
      _srtSetConfig(discovered);
      await _srtEnsureRegistrySheet(provider, discovered);
      return discovered;
    }
    const defaultRoot = _schema().DEFAULT_SHEET_NAME;
    await _directoryHandle(provider, defaultRoot, true);
    _srtSetConfig(defaultRoot);
    await _srtEnsureRegistrySheet(provider, defaultRoot);
    return defaultRoot;
  }

  // ============================================================
  // フォルダノートの自己修復（meldex_staff_registry_service.ensure_registry_sheet）
  // ============================================================

  function _srtSameSpec(a, b) {
    try { return JSON.stringify(a) === JSON.stringify(b); } catch { return a === b; }
  }

  async function _srtEnsureRegistrySheet(provider, root) {
    const schema = _schema();
    await _directoryHandle(provider, root, true);
    const note = _joinPath(root, _basename(root) + '.md');
    const parsed = await _srtReadFrontmatter(provider, note);
    const frontmatter = { ...(parsed.frontmatter || {}) };
    frontmatter.type = 'settings-db';
    if (!frontmatter.schema_version) frontmatter.schema_version = 1;
    frontmatter[schema.REGISTRY_MARKER_KEY] = schema.REGISTRY_MARKER_VALUE;
    const propTypes = { ...(frontmatter.property_types || {}) };
    Object.entries(schema.REQUIRED_PROPERTY_TYPES).forEach(([name, spec]) => {
      if (!_srtSameSpec(propTypes[name], spec)) propTypes[name] = spec;
    });
    frontmatter.property_types = propTypes;
    const viewConfig = frontmatter.view_config;
    if (!viewConfig || typeof viewConfig !== 'object' || !Array.isArray(viewConfig.savedViews) || !viewConfig.savedViews.length) {
      frontmatter.view_config = { savedViews: [{ name: 'テーブル', viewMode: 'pivot' }], currentViewIdx: 0 };
    }
    await provider.writeText(note, _srtFrontmatterText(frontmatter, parsed.body || `# ${_basename(root)}\n\n`));
  }

  // ============================================================
  // スタッフ行の読み書き（meldex_staff_registry_service の対応関数と同型）
  // ============================================================

  function _srtPropValue(frontmatter, propName) {
    const raw = (frontmatter?.properties || {})[propName];
    const values = Array.isArray(raw) ? raw : (raw == null ? [] : [raw]);
    const adopted = values.find(v => v && typeof v === 'object' && (v.status === '採用' || v.status === '掲載済み'));
    const value = adopted !== undefined ? adopted : (values.length ? values[0] : '');
    return String(value && typeof value === 'object' ? (value.value ?? '') : (value ?? ''));
  }

  function _srtRowFromFrontmatter(stem, frontmatter) {
    const schema = _schema();
    return {
      user: _srtPropValue(frontmatter, schema.USER_KEY_PROPERTY),
      entry_name: stem,
      display: _srtPropValue(frontmatter, schema.DISPLAY_NAME_PROPERTY) || stem,
      role: _srtPropValue(frontmatter, '権限'),
      work_hours: _srtPropValue(frontmatter, '作業可能時間'),
      break_hours: _srtPropValue(frontmatter, '休憩時間'),
      hourly_rate: _srtPropValue(frontmatter, '標準時間単価'),
      holidays: _srtPropValue(frontmatter, '休日'),
      active_from: _srtPropValue(frontmatter, '参加開始日'),
      active_to: _srtPropValue(frontmatter, '参加終了日'),
      google_url: _srtPropValue(frontmatter, '外部カレンダーURL（Google）'),
      caldav_url: _srtPropValue(frontmatter, '外部カレンダーURL（CalDAV）'),
      sync_enabled: ['true', 'True', '1'].includes(_srtPropValue(frontmatter, '同期有効')),
      note: _srtPropValue(frontmatter, '備考'),
    };
  }

  async function _srtLoadStaff(provider, root) {
    const schema = _schema();
    const rows = [];
    const duplicates = [];
    const seen = new Map();
    for (const file of await _srtEntryFiles(provider, root)) {
      let parsed;
      try { parsed = await _srtReadFrontmatter(provider, file.path); } catch { continue; }
      const user = _srtPropValue(parsed.frontmatter, schema.USER_KEY_PROPERTY).trim();
      if (!user) continue;
      if (seen.has(user)) duplicates.push({ user, entries: [seen.get(user), file.stem] });
      else seen.set(user, file.stem);
      rows.push(_srtRowFromFrontmatter(file.stem, parsed.frontmatter));
    }
    return { staff: rows, duplicates };
  }

  async function _srtFindStaffPathByUser(provider, root, user) {
    const wanted = String(user || '').trim();
    if (!wanted) return null;
    const schema = _schema();
    for (const file of await _srtEntryFiles(provider, root)) {
      let parsed;
      try { parsed = await _srtReadFrontmatter(provider, file.path); } catch { continue; }
      if (_srtPropValue(parsed.frontmatter, schema.USER_KEY_PROPERTY) === wanted) return file.path;
    }
    return null;
  }

  async function _srtEnsureUniqueUser(provider, root, user, excludePath) {
    const identity = String(user || '').trim();
    if (!identity) return;
    const schema = _schema();
    const excluded = excludePath ? _normalizeFolderPath(excludePath) : null;
    for (const file of await _srtEntryFiles(provider, root)) {
      if (excluded && _normalizeFolderPath(file.path) === excluded) continue;
      let parsed;
      try { parsed = await _srtReadFrontmatter(provider, file.path); } catch { continue; }
      if (_srtPropValue(parsed.frontmatter, schema.USER_KEY_PROPERTY) === identity) {
        const error = new Error(`ユーザー「${identity}」はスタッフ「${file.stem}」に設定済みです`);
        error.status = 409;
        throw error;
      }
    }
  }

  async function _srtFindUnlinkedEntryByDisplay(provider, root, displayName) {
    const wanted = String(displayName || '').trim();
    if (!wanted) return null;
    const schema = _schema();
    for (const file of await _srtEntryFiles(provider, root)) {
      let parsed;
      try { parsed = await _srtReadFrontmatter(provider, file.path); } catch { continue; }
      if (_srtPropValue(parsed.frontmatter, schema.USER_KEY_PROPERTY)) continue;
      if (_srtPropValue(parsed.frontmatter, schema.DISPLAY_NAME_PROPERTY) === wanted || file.stem === wanted) return file.path;
    }
    return null;
  }

  function _srtCandidate(value) {
    return { value: String(value), status: STAFF_STATUS, note: '', created: _nowIso() };
  }

  async function _srtUpsertStaff(provider, root, entry, fillOnly) {
    const schema = _schema();
    const payload = entry || {};
    const user = String(payload.user || '').trim();
    const rawDisplay = String(payload.display || user).trim();
    if (!user && !rawDisplay) {
      const error = new Error('スタッフまたは表示名のいずれかは必須です');
      error.status = 400;
      throw error;
    }
    await _srtEnsureRegistrySheet(provider, root);

    let existingPath = null;
    if (user) {
      existingPath = await _srtFindStaffPathByUser(provider, root, user);
      await _srtEnsureUniqueUser(provider, root, user, existingPath);
    } else {
      existingPath = await _srtFindUnlinkedEntryByDisplay(provider, root, rawDisplay);
    }

    const displayName = rawDisplay || user;
    let currentFrontmatter = {};
    let currentBody = '';
    let path = existingPath;
    if (existingPath) {
      const parsed = await _srtReadFrontmatter(provider, existingPath);
      currentFrontmatter = parsed.frontmatter || {};
      currentBody = parsed.body || '';
    } else {
      const safeName = _srtSafeName(displayName);
      path = _joinPath(root, safeName + '.md');
      let suffix = 2;
      while (await _srtPathExists(provider, path)) {
        path = _joinPath(root, `${safeName}_${suffix}.md`);
        suffix += 1;
      }
    }

    const frontmatter = { ...currentFrontmatter };
    if (!frontmatter.type) frontmatter.type = 'settings-entry';
    if (!frontmatter.id) frontmatter.id = 'ent_' + _srtRandomHex(10);
    frontmatter.category = _basename(root);
    frontmatter.modified = _nowIso();
    const properties = frontmatter.properties && typeof frontmatter.properties === 'object' ? { ...frontmatter.properties } : {};

    const setIfAllowed = (propName, value) => {
      if (value == null || value === '') return;
      if (fillOnly && _srtPropValue({ properties }, propName)) return;
      properties[propName] = [_srtCandidate(value)];
    };
    setIfAllowed(schema.USER_KEY_PROPERTY, user);
    setIfAllowed(schema.DISPLAY_NAME_PROPERTY, payload.display || displayName);
    setIfAllowed('権限', payload.role);
    setIfAllowed('作業可能時間', payload.work_hours);
    setIfAllowed('休憩時間', payload.break_hours);
    setIfAllowed('標準時間単価', payload.hourly_rate);
    setIfAllowed('休日', payload.holidays);
    setIfAllowed('参加開始日', payload.active_from);
    setIfAllowed('参加終了日', payload.active_to);
    setIfAllowed('外部カレンダーURL（Google）', payload.google_url);
    setIfAllowed('外部カレンダーURL（CalDAV）', payload.caldav_url);
    if ('sync_enabled' in payload) setIfAllowed('同期有効', payload.sync_enabled ? 'true' : '');
    setIfAllowed('備考', payload.note);

    frontmatter.properties = properties;
    await provider.writeText(path, _srtFrontmatterText(frontmatter, currentBody));
    const row = _srtRowFromFrontmatter(_basename(path).replace(/\.md$/i, ''), frontmatter);
    row.path = path;
    return row;
  }

  // ============================================================
  // ルート本体
  // ============================================================

  async function _srtSetConfigRoute(body) {
    _srtRequireOwner();
    const path = String(body?.path || '').trim();
    if (!path) {
      const error = new Error('パスは必須です');
      error.status = 400;
      throw error;
    }
    const provider = await _requirePwaProvider('readwrite');
    const normalized = _normalizeFolderPath(path);
    if (await _srtIsDirectory(provider, normalized)) {
      const note = _joinPath(normalized, _basename(normalized) + '.md');
      if (await _srtPathExists(provider, note)) {
        const parsed = await _srtReadFrontmatter(provider, note);
        if (parsed.frontmatter?.type && !_schema().isStaffRegistryFrontmatter(parsed.frontmatter)) {
          const error = new Error('指定先は別の種類のシートです。空の新規フォルダかスタッフ管理シートを指定してください');
          error.status = 409;
          throw error;
        }
      }
    }
    const config = _srtSetConfig(normalized);
    await _srtEnsureRegistrySheet(provider, normalized);
    return { ok: true, ...config };
  }

  async function _srtEnsureRoute() {
    const provider = await _requirePwaProvider('readwrite');
    const root = await _srtEnsureOrDiscoverRoot(provider);
    const result = await _srtLoadStaff(provider, root);
    return { ok: true, ..._srtGetConfig(), ...result };
  }

  async function _srtListRoute() {
    const configured = _normalizeFolderPath(_srtGetConfig().path || '');
    if (!configured) return { ok: true, ..._srtGetConfig(), staff: [], duplicates: [] };
    let provider = await _requirePwaProvider('read');
    if (!await _srtIsDirectory(provider, configured)) {
      return { ok: true, ..._srtGetConfig(), staff: [], duplicates: [] };
    }
    // デスクトップ版は GET list でも自己修復（ensure_registry_sheet）を行うが、
    // クラウド静的版はDropbox共有リンクの閲覧専用ユーザーも一覧を見られるべき
    // なので、書き込み権限が無ければ自己修復だけ諦めて読み取りを続行する
    // （gb-production-management.part01.js の migrateOnFirstDisplay と同じ流儀）。
    try {
      const writableProvider = await _requirePwaProvider('readwrite');
      await _srtEnsureRegistrySheet(writableProvider, configured);
      provider = writableProvider;
    } catch (error) {
      if (!_srtIsWriteAccessError(error)) throw error;
    }
    const result = await _srtLoadStaff(provider, configured);
    return { ok: true, ..._srtGetConfig(), ...result };
  }

  async function _srtUpsertRoute(body) {
    const provider = await _requirePwaProvider('readwrite');
    const root = await _srtEnsureOrDiscoverRoot(provider);
    const payload = { ...(body || {}) };
    const fillOnly = !!payload.fill_only;
    delete payload.fill_only;
    const row = await _srtUpsertStaff(provider, root, payload, fillOnly);
    return { ok: true, staff: row };
  }

  window.MeldexStaffRegistryCloudTwin = Object.freeze({
    createBoundStaffResolver(provider, requestIdentity) {
      if (!provider) throw new Error('Cloudスタッフデータを利用できません');
      const identity = Object.freeze({
        actor: String(requestIdentity?.actor || ''),
        role: String(requestIdentity?.role || ''),
        workspaceId: String(requestIdentity?.workspaceId || ''),
      });
      const configuredPath = _normalizeFolderPath(_srtGetConfig().path || '');
      return Object.freeze({
        identity,
        async resolve() {
          if (!configuredPath || !await _srtIsDirectory(provider, configuredPath)) {
            return { identity, staff: [], duplicates: [] };
          }
          const result = await _srtLoadStaff(provider, configuredPath);
          return { identity, staff: structuredClone(result.staff || []), duplicates: structuredClone(result.duplicates || []) };
        },
      });
    },
  });

  handlers.push(async function _staffRegistryCloudHandler({ method, body, pathname }) {
    if (!/^\/staff-registry(\/|$)/.test(pathname)) return NOT_HANDLED;
    if (pathname === '/staff-registry/config' && method === 'GET') {
      return { ok: true, ..._srtGetConfig() };
    }
    if (pathname === '/staff-registry/config' && method === 'PUT') {
      return _srtSetConfigRoute(body || {});
    }
    if (pathname === '/staff-registry/ensure' && method === 'POST') {
      return _srtEnsureRoute();
    }
    if (pathname === '/staff-registry/list' && method === 'GET') {
      return _srtListRoute();
    }
    if (pathname === '/staff-registry/upsert' && method === 'POST') {
      return _srtUpsertRoute(body || {});
    }
    return NOT_HANDLED;
  });
})();
