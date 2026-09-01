/* ==============================
   gb-user-registry.js: スタッフ管理シート（正本）の読み口プロバイダ

   ユーザーアカウント一元管理 計画書 Phase 1〜3
   （docs/user-account-unification-plan-2026-07-18.md §5.4）

   apiFetch/apiPost/apiPut に統一されているため、デスクトップ/クラウド静的の
   両方で同じ実装が動く（クラウド静的では apiFetch が gb-cloud-fetch.js で
   モンキーパッチされ、window.MeldexDataAccess.requestJson 経由になる）。

   責務: 正本シートの設定（置き場所）取得・変更、スタッフ一覧の取得（キャッシュ
   付き）、スタッフ行の作成・更新（fill-only 対応）、一意制約の簡易チェック、
   変更通知、正本シートを開く導線。
   ============================== */
(function () {
  'use strict';

  const STAFF_CACHE_TTL_MS = 15000;

  let _configCache = null; // { path, updated }
  let _staffCache = null; // { staff: [...], duplicates: [...], loadedAt }
  const _listeners = [];

  function _normPath(path) {
    return String(path || '').replace(/\\/g, '/').replace(/\/+$/, '');
  }

  function _notify() {
    _listeners.slice().forEach((cb) => {
      try { cb(); } catch (e) { console.warn('MeldexUserRegistry: onChange listener failed', e); }
    });
  }

  function _applyConfigResult(result) {
    _configCache = { path: String(result?.path || ''), updated: String(result?.updated || '') };
    return _configCache;
  }

  function _applyStaffResult(result) {
    _applyConfigResult(result);
    _staffCache = {
      staff: Array.isArray(result?.staff) ? result.staff : [],
      duplicates: Array.isArray(result?.duplicates) ? result.duplicates : [],
      loadedAt: Date.now(),
    };
    return _staffCache;
  }

  async function getConfig(opts) {
    const force = !!(opts && opts.force);
    if (!force && _configCache) return _configCache;
    const result = await apiFetch('/staff-registry/config');
    return _applyConfigResult(result);
  }

  // 同期アクセス用: ネットワーク待ちができない呼び出し元
  // （gb-tool-calendar-production-task-view.js の managedPath 等、UIの
  // 選択状態を同期的に組み立てる箇所）のために、ウォームアップ済みキャッシュを
  // そのまま返す。未ウォームアップ時は空文字を返す（自己修復・後続の
  // getConfig() 呼び出しでの再解決に委ねる。isRegistryPathSync と同じ方針）。
  function getConfigSync() {
    return _configCache ? { ..._configCache } : { path: '', updated: '' };
  }

  // 同期チェック用: getSchemaProtectionLevel() 等、ネットワーク待ちができない
  // 呼び出し元のために primeConfigCache() でウォームアップ済みのキャッシュを見る。
  // 未ウォームアップ時は false を返す（自己修復が安全網のため実害は小さい。
  // 計画書§5.2「自己修復」参照）。
  function isRegistryPathSync(dbPath) {
    if (!_configCache || !_configCache.path || !dbPath) return false;
    return _normPath(dbPath) === _normPath(_configCache.path);
  }

  async function primeConfigCache() {
    try { await getConfig({ force: true }); } catch (e) { /* ソースフォルダ未設定時などは静かに諦める */ }
  }

  async function ensure() {
    const result = await apiPost('/staff-registry/ensure', {});
    _applyStaffResult(result);
    // 初回作成でスタッフが1件も無い場合、現在ユーザーを1行目として登録する
    // （ダイアログなしの自動作成。計画書§5.1）。fill-only のため既存行があれば
    // 何もしない（起動時 self-upsert・Phase 2 と同じ契約）。
    if (_staffCache.staff.length === 0 && typeof getUsername === 'function') {
      const me = String(getUsername() || '').trim();
      if (me && me !== 'anonymous') {
        try {
          await upsertStaff({ user: me, display: me, user_type: 'account' }, { fillOnly: true });
          await listStaff({ force: true });
        } catch (e) { console.warn('MeldexUserRegistry: self-registration failed', e); }
      }
    }
    return { path: _configCache.path, updated: _configCache.updated, staff: _staffCache.staff, duplicates: _staffCache.duplicates };
  }

  async function listStaff(opts) {
    const force = !!(opts && opts.force);
    if (!force && _staffCache && (Date.now() - _staffCache.loadedAt) < STAFF_CACHE_TTL_MS) {
      return _staffCache.staff;
    }
    const result = await apiFetch('/staff-registry/list');
    _applyStaffResult(result);
    return _staffCache.staff;
  }

  function listDuplicatesSync() {
    return _staffCache ? _staffCache.duplicates.slice() : [];
  }

  async function findByUser(name, opts) {
    const wanted = String(name || '').trim();
    if (!wanted) return null;
    const staff = await listStaff(opts);
    return staff.find((row) => row.user === wanted) || null;
  }

  // クライアント側の簡易重複チェック（計画書§5.3・§5.8）。書き込み前のUIヒント
  // 用途で、確定的な一意制約はバックエンド（meldex_staff_registry_service.
  // ensure_unique_user）が担う。
  function validateUniqueUser(user, excludeEntryName) {
    const wanted = String(user || '').trim();
    if (!wanted || !_staffCache) return null;
    return _staffCache.staff.find((row) => row.user === wanted && row.entry_name !== excludeEntryName) || null;
  }

  async function upsertStaff(entry, opts) {
    const options = opts || {};
    const body = Object.assign({}, entry || {}, { fill_only: !!options.fillOnly });
    const result = await apiPost('/staff-registry/upsert', body);
    invalidate();
    _notify();
    return result?.staff || null;
  }

  async function addVirtualUser(display) {
    const name = String(display || '').trim();
    if (!name) throw new Error('仮ユーザーの表示名を入力してください');
    return upsertStaff({ display: name, user_type: 'virtual' });
  }

  async function setUserWorkspace(userOrId, workspaceId, included) {
    const identity = String(userOrId || '').trim();
    const targetWorkspaceId = String(workspaceId || '').trim();
    if (!identity || !targetWorkspaceId) throw new Error('ユーザーとワークスペースを指定してください');
    const users = await listStaff({ force: true });
    const row = users.find(item => item.user_id === identity || item.user === identity || item.display === identity);
    if (!row) throw new Error('ユーザーが見つかりません');
    const workspaceIds = new Set(Array.isArray(row.workspace_ids) ? row.workspace_ids : []);
    if (included) workspaceIds.add(targetWorkspaceId);
    else workspaceIds.delete(targetWorkspaceId);
    return upsertStaff({
      user: row.user,
      user_id: row.user_id,
      user_type: row.user_type || 'account',
      display: row.display || row.user,
      role: row.role,
      work_hours: row.work_hours,
      break_hours: row.break_hours,
      hourly_rate: row.hourly_rate,
      holidays: row.holidays,
      active_from: row.active_from,
      active_to: row.active_to,
      google_url: row.google_url,
      caldav_url: row.caldav_url,
      sync_enabled: row.sync_enabled,
      note: row.note,
      workspace_ids: [...workspaceIds],
    });
  }

  function invalidate() {
    _staffCache = null;
  }

  async function relocate(path) {
    const result = await apiPut('/staff-registry/config', { path: String(path || '') });
    _applyConfigResult(result);
    invalidate();
    _notify();
    return _configCache;
  }

  async function openSheet() {
    const config = await getConfig().catch(() => null);
    if (!config || !config.path) {
      if (typeof showStatus === 'function') showStatus('ユーザー管理シートの場所が未設定です。設定の「ユーザー」を開いて初期化してください', true);
      return false;
    }
    if (typeof closeSettingsModalRestoringTheme === 'function') closeSettingsModalRestoringTheme();
    if (typeof showView === 'function') showView('database');
    if (typeof selectDatabase === 'function') {
      await selectDatabase(config.path);
      return true;
    }
    if (typeof openFolder === 'function') {
      await openFolder('ユーザー管理', config.path, {});
      return true;
    }
    return false;
  }

  function onChange(cb) {
    if (typeof cb === 'function') _listeners.push(cb);
  }

  window.MeldexUserRegistry = {
    getConfig,
    getConfigSync,
    isRegistryPathSync,
    primeConfigCache,
    ensure,
    listStaff,
    listDuplicatesSync,
    findByUser,
    validateUniqueUser,
    upsertStaff,
    addVirtualUser,
    setUserWorkspace,
    invalidate,
    relocate,
    openSheet,
    onChange,
  };
})();
