/* gb-shortcut-registry.js
 * ショートカットキーの一覧・カスタム設定・設定UIを、キーの配送（中央ハンドラ）から
 * 切り離して全アプリで共有するためのモジュール。
 *
 * - Meldex本体・ノート・シナリオ・シート・ボードは gb-shortcuts.js が全体の一覧を
 *   ここへ登録し、配送も gb-shortcuts.js 側で行う。
 * - ビューワー・クイックメモのように自前でキーを処理するアプリは、gb-shortcuts.js を
 *   読み込まずに registerLocal() で自分のキーだけ登録し、matchEvent() で判定に使う。
 *   これで「どのアプリでもオプションパネルからショートカットを確認・変更できる」状態に
 *   しつつ、そのアプリに存在しない操作を一覧へ出さずに済む。
 *
 * カスタム値は後方互換のため localStorage の 'meldex-custom-shortcuts' に保存する。
 * 同期用の更新時刻・clientId・reset墓標は別のローカル状態へ保持し、個人設定
 * shortcut-settings とID単位でマージする。
 */
(function (global) {
  'use strict';

  const STORAGE_KEY = 'meldex-custom-shortcuts';
  const SYNC_DOCUMENT_NAME = 'shortcut-settings';
  const SYNC_STATE_KEY = 'meldex-shortcut-sync-state';
  const SYNC_ENABLED_KEY = 'meldex-shortcut-sync-enabled';
  const SYNC_CLIENT_ID_KEY = 'meldex-shortcut-sync-client-id';
  const SYNC_MIGRATED_KEY = 'meldex-shortcut-sync-migrated-v1';
  const SYNC_PUSH_DELAY_MS = 900;
  const MODIFIER_KEYS = new Set(['control', 'shift', 'alt', 'meta']);
  // Shift+数字キーの記号→数字マッピング（US配列基準）
  const SHIFT_DIGIT_MAP = { '!': '1', '@': '2', '#': '3', '$': '4', '%': '5', '^': '6', '&': '7', '*': '8', '(': '9', ')': '0' };

  const SCOPE_ORDER = ['global', 'note', 'scenario', 'database', 'board', 'calendar', 'csv', 'folder', 'viewer', 'chat', 'annotation', 'comment', 'tray', 'quickmemo', 'timer', 'panelset'];
  const SCOPE_LABELS = {
    global: '全体',
    note: 'ノート',
    scenario: 'シナリオ',
    database: 'シート',
    board: 'ボード',
    calendar: 'スケジュール',
    csv: 'CSV',
    folder: 'フォルダ',
    viewer: 'ビューワー',
    chat: 'チャット',
    annotation: '注釈',
    comment: 'コメント',
    tray: '常駐アプリ',
    quickmemo: 'クイックメモ',
    timer: 'タイマー',
    panelset: 'パネルセット',
  };

  // メインパネルで開いているアプリの種類 → ショートカットのスコープ。
  // オプションパネルのショートカットタブは、既定でこのスコープだけに絞って表示する。
  const TYPE_TO_SCOPE = {
    page: 'note',
    entity: 'note',
    note: 'note',
    db: 'database',
    database: 'database',
    pivot: 'database',
    tree: 'database',
    gallery: 'database',
    kanban: 'database',
    timeline: 'database',
    chart: 'database',
    graph: 'database',
    'smart-db': 'database',
    scriptnote: 'scenario',
    scenario: 'scenario',
    board: 'board',
    canvas: 'board',
    calendar: 'calendar',
    csv: 'csv',
    folder: 'folder',
    outliner: 'folder',
    preview: 'viewer',
    media: 'viewer',
    viewer: 'viewer',
    chat: 'chat',
    'quick-memo': 'quickmemo',
    quickmemo: 'quickmemo',
    timer: 'timer',
  };

  const definitions = {};
  let _syncPushTimer = null;
  let _syncBusy = false;
  let _applyingSyncedBindings = false;

  function _esc(value) {
    if (typeof global.esc === 'function') return global.esc(String(value == null ? '' : value));
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function register(defs, options) {
    if (!defs || typeof defs !== 'object') return;
    const local = options?.local === true;
    for (const [id, def] of Object.entries(defs)) {
      if (!def || typeof def !== 'object') continue;
      definitions[id] = {
        key: String(def.key || ''),
        label: String(def.label || id),
        scope: String(def.scope || 'global'),
        local,
      };
    }
  }

  function registerLocal(defs) {
    register(defs, { local: true });
  }

  function defaults() {
    return JSON.parse(JSON.stringify(definitions));
  }

  function getCustom() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); } catch { return {}; }
  }

  function _parseObject(text, fallback) {
    try {
      const value = JSON.parse(text || 'null');
      return value && typeof value === 'object' && !Array.isArray(value) ? value : fallback;
    } catch { return fallback; }
  }

  function _clientId() {
    let value = '';
    try { value = String(localStorage.getItem(SYNC_CLIENT_ID_KEY) || ''); } catch {}
    if (value) return value;
    value = `shortcut-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    try { localStorage.setItem(SYNC_CLIENT_ID_KEY, value); } catch {}
    return value;
  }

  function isSyncEnabled() {
    try { return localStorage.getItem(SYNC_ENABLED_KEY) !== '0'; } catch { return true; }
  }

  function _readSyncState() {
    let state = {};
    try { state = _parseObject(localStorage.getItem(SYNC_STATE_KEY), {}); } catch {}
    return {
      schemaVersion: 1,
      revision: String(state.revision || ''),
      needsPush: state.needsPush === true,
      bindings: _normalizeBindings(state.bindings),
    };
  }

  function _writeSyncState(state) {
    const normalized = {
      schemaVersion: 1,
      revision: String(state?.revision || ''),
      needsPush: state?.needsPush === true,
      bindings: _normalizeBindings(state?.bindings),
    };
    try { localStorage.setItem(SYNC_STATE_KEY, JSON.stringify(normalized)); } catch {}
    return normalized;
  }

  function _normalizeBinding(value) {
    if (!value || typeof value !== 'object') return null;
    const reset = value.reset === true;
    const key = reset ? '' : normalizeKeyDef(value.key || '');
    if (!reset && !key) return null;
    return {
      key,
      updatedAt: String(value.updatedAt || ''),
      clientId: String(value.clientId || ''),
      reset,
    };
  }

  function _normalizeBindings(bindings) {
    const result = {};
    if (!bindings || typeof bindings !== 'object') return result;
    Object.entries(bindings).forEach(([id, value]) => {
      const normalized = _normalizeBinding(value);
      if (normalized) result[String(id)] = normalized;
    });
    return result;
  }

  function _newerBinding(left, right) {
    if (!left) return right || null;
    if (!right) return left;
    const leftText = String(left.updatedAt || '');
    const rightText = String(right.updatedAt || '');
    const leftTime = Date.parse(leftText);
    const rightTime = Date.parse(rightText);
    if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) return leftTime > rightTime ? left : right;
    if ((!Number.isFinite(leftTime) || !Number.isFinite(rightTime)) && leftText !== rightText) return leftText > rightText ? left : right;
    return String(left.clientId || '') >= String(right.clientId || '') ? left : right;
  }

  function mergeBindings(localBindings, remoteBindings) {
    const local = _normalizeBindings(localBindings);
    const remote = _normalizeBindings(remoteBindings);
    const merged = {};
    new Set([...Object.keys(local), ...Object.keys(remote)]).forEach((id) => {
      const winner = _newerBinding(local[id], remote[id]);
      if (winner) merged[id] = { ...winner };
    });
    return merged;
  }

  function _bindingsEqual(left, right) {
    return JSON.stringify(_normalizeBindings(left)) === JSON.stringify(_normalizeBindings(right));
  }

  function _migrateLegacyOnce() {
    try {
      if (localStorage.getItem(SYNC_MIGRATED_KEY) === '1') return _readSyncState();
    } catch {}
    const state = _readSyncState();
    const legacy = getCustom();
    const timestamp = new Date().toISOString();
    const clientId = _clientId();
    let migrated = false;
    Object.entries(legacy).forEach(([id, value]) => {
      if (state.bindings[id]) return;
      const key = normalizeKeyDef(value?.key || '');
      if (key) {
        state.bindings[id] = { key, updatedAt: timestamp, clientId, reset: false };
        migrated = true;
      }
    });
    if (migrated) state.needsPush = true;
    _writeSyncState(state);
    try { localStorage.setItem(SYNC_MIGRATED_KEY, '1'); } catch {}
    return state;
  }

  function _recordLocalChanges(before, after) {
    if (_applyingSyncedBindings) return;
    const state = _migrateLegacyOnce();
    const timestamp = new Date().toISOString();
    const clientId = _clientId();
    new Set([...Object.keys(before || {}), ...Object.keys(after || {})]).forEach((id) => {
      const beforeKey = normalizeKeyDef(before?.[id]?.key || '');
      const afterKey = normalizeKeyDef(after?.[id]?.key || '');
      if (beforeKey === afterKey) return;
      state.bindings[id] = afterKey
        ? { key: afterKey, updatedAt: timestamp, clientId, reset: false }
        : { key: '', updatedAt: timestamp, clientId, reset: true };
    });
    state.needsPush = true;
    _writeSyncState(state);
    scheduleSyncPush();
  }

  function _applyBindings(bindings) {
    const current = getCustom();
    const next = { ...current };
    Object.entries(_normalizeBindings(bindings)).forEach(([id, value]) => {
      if (value.reset) delete next[id];
      else next[id] = { key: value.key };
    });
    if (JSON.stringify(current) === JSON.stringify(next)) return false;
    _applyingSyncedBindings = true;
    try { saveCustom(next, { skipHistory: true, skipSync: true }); }
    finally { _applyingSyncedBindings = false; }
    _refreshOpenSettings();
    return true;
  }

  function _syncGet() {
    if (typeof global.apiFetch !== 'function' && typeof apiFetch !== 'function') return Promise.resolve(null);
    const fetcher = typeof global.apiFetch === 'function' ? global.apiFetch : apiFetch;
    return fetcher(`/personal-preferences/${SYNC_DOCUMENT_NAME}`, { silentError: true });
  }

  function _syncPut(body) {
    if (typeof global.apiFetch !== 'function' && typeof apiFetch !== 'function') return Promise.resolve(null);
    const fetcher = typeof global.apiFetch === 'function' ? global.apiFetch : apiFetch;
    return fetcher(`/personal-preferences/${SYNC_DOCUMENT_NAME}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body), silentError: true,
    });
  }

  async function pullShortcutSettings() {
    if (!isSyncEnabled()) return { enabled: false, applied: false };
    const response = await _syncGet();
    if (!response || response.available === false) return { available: false, applied: false };
    const state = _migrateLegacyOnce();
    const remoteBindings = _normalizeBindings(response.payload?.bindings);
    const merged = mergeBindings(state.bindings, remoteBindings);
    const remoteNeedsMerge = !_bindingsEqual(merged, remoteBindings);
    _writeSyncState({ revision: response.revision || '', bindings: merged, needsPush: remoteNeedsMerge || state.needsPush });
    const applied = _applyBindings(merged);
    if (remoteNeedsMerge) scheduleSyncPush();
    return { available: true, applied, revision: response.revision || '', remoteNeedsMerge };
  }

  async function _pushAttempt(retryConflict) {
    const state = _migrateLegacyOnce();
    if (!state.needsPush) return { available: true, pushed: false };
    try {
      const response = await _syncPut({
        payload: { schemaVersion: 1, bindings: state.bindings },
        expectedRevision: state.revision || null,
      });
      if (!response || response.available === false) return { available: false, pushed: false };
      _writeSyncState({ revision: response.revision || '', bindings: state.bindings, needsPush: false });
      return { available: true, pushed: true, revision: response.revision || '' };
    } catch (error) {
      const conflict = Number(error?.status || error?.response?.status || 0) === 409
        || /(?:HTTP\s*)?409|競合/.test(String(error?.message || ''));
      if (!retryConflict || !conflict) return { pushed: false, conflict, offline: !conflict, error };
      const remote = await _syncGet();
      if (!remote || remote.available === false) return { available: false, pushed: false, error };
      const latest = _readSyncState();
      const merged = mergeBindings(latest.bindings, remote.payload?.bindings);
      _writeSyncState({ revision: remote.revision || '', bindings: merged, needsPush: true });
      _applyBindings(merged);
      return _pushAttempt(false);
    }
  }

  async function pushShortcutSettings() {
    if (!isSyncEnabled()) return { enabled: false, pushed: false };
    return _pushAttempt(true);
  }

  async function syncNow() {
    if (_syncBusy || !isSyncEnabled()) return null;
    _syncBusy = true;
    try {
      const pulled = await pullShortcutSettings();
      if (pulled?.available === false) return { pulled };
      const pushed = await pushShortcutSettings();
      return { pulled, pushed };
    } catch (error) {
      return { error };
    } finally { _syncBusy = false; }
  }

  function scheduleSyncPush() {
    if (!isSyncEnabled() || _applyingSyncedBindings) return;
    if (_syncPushTimer) clearTimeout(_syncPushTimer);
    _syncPushTimer = setTimeout(() => {
      _syncPushTimer = null;
      if (_syncBusy) return;
      _syncBusy = true;
      pushShortcutSettings().catch(() => null).finally(() => { _syncBusy = false; });
    }, SYNC_PUSH_DELAY_MS);
  }

  function setSyncEnabled(enabled) {
    try { localStorage.setItem(SYNC_ENABLED_KEY, enabled ? '1' : '0'); } catch {}
    if (enabled) syncNow();
    _refreshOpenSettings();
  }

  // 設定変更後に、開いている全部のショートカット一覧（設定ダイアログ／オプションパネル）を描き直す
  function _refreshOpenSettings() {
    if (typeof global._updateAllTooltips === 'function') global._updateAllTooltips();
    if (typeof global.updateScriptnoteShortcutStatusbar === 'function') global.updateScriptnoteShortcutStatusbar();
    document.querySelectorAll('[data-shortcut-settings-host]').forEach(host => {
      renderSettings(host, { scope: host.dataset.shortcutSettingsScope || '', boxed: host.dataset.shortcutSettingsBoxed === '1' });
    });
  }

  function saveCustom(custom, options) {
    const previousCustom = getCustom();
    const before = (typeof global.captureLocalStorageSettings === 'function')
      ? global.captureLocalStorageSettings([STORAGE_KEY])
      : null;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(custom)); } catch { /* 保存できない環境では変更を持ち越さない */ }
    if (typeof global.updateScriptnoteShortcutStatusbar === 'function') global.updateScriptnoteShortcutStatusbar();
    if (typeof global.updateDatabaseShortcutStatusbar === 'function') global.updateDatabaseShortcutStatusbar();
    if (typeof global.updateCsvShortcutStatusbar === 'function') global.updateCsvShortcutStatusbar();
    if (before && options?.skipHistory !== true && typeof global.pushLocalStorageSettingsHistory === 'function') {
      const after = global.captureLocalStorageSettings([STORAGE_KEY]);
      const refreshAfterHistory = (_keys, restoredSnapshot) => {
        const restoredCustom = getCustom();
        const restoredRaw = restoredSnapshot?.storage?.[STORAGE_KEY] ?? null;
        const beforeRaw = before?.storage?.[STORAGE_KEY] ?? null;
        const otherCustom = restoredRaw === beforeRaw ? (custom || {}) : previousCustom;
        _recordLocalChanges(otherCustom, restoredCustom);
        _refreshOpenSettings();
      };
      global.pushLocalStorageSettingsHistory(
        options?.label || '設定: ショートカット変更',
        before,
        after,
        options?.detail || '',
        refreshAfterHistory
      );
    }
    if (options?.skipSync !== true) _recordLocalChanges(previousCustom, custom || {});
  }

  function effective() {
    const custom = getCustom();
    const result = defaults();
    for (const [id, overrides] of Object.entries(custom)) {
      if (result[id]) result[id].key = overrides.key;
    }
    return result;
  }

  function keyFor(id) {
    const custom = getCustom();
    if (custom[id]) return custom[id].key;
    return definitions[id]?.key || '';
  }

  // === キー判定 ===

  function normalizeKeyEvent(e) {
    const rawKey = typeof e?.key === 'string' ? e.key : '';
    if (!rawKey) return null;
    const key = rawKey.toLowerCase();
    if (MODIFIER_KEYS.has(key)) return null;
    const mods = [];
    if (e.altKey) mods.push('alt');
    if (e.ctrlKey || e.metaKey) mods.push('ctrl');
    if (e.shiftKey) mods.push('shift');
    let mainKey = key;
    if (mainKey === ' ') mainKey = 'space';
    if (mainKey === '+') {
      mainKey = '=';
      const shiftIdx = mods.indexOf('shift');
      if (shiftIdx >= 0) mods.splice(shiftIdx, 1);
    }
    if (e.shiftKey && e.code === 'Backquote') mainKey = '`';
    // Shift+数字キー: e.keyは記号になるが、e.codeから元の数字を復元
    if (e.shiftKey && e.code && e.code.startsWith('Digit')) mainKey = e.code.charAt(5);
    // Shift+記号キーのフォールバック（e.codeが使えない場合）
    if (e.shiftKey && SHIFT_DIGIT_MAP[mainKey]) mainKey = SHIFT_DIGIT_MAP[mainKey];
    return [...mods, mainKey].join('+');
  }

  function normalizeKeyDef(keyDef) {
    const parts = String(keyDef || '').toLowerCase().replace(/\s/g, '').split('+');
    const mods = [];
    let mainKey = '';
    for (const part of parts) {
      if (['ctrl', 'shift', 'alt', 'meta'].includes(part)) mods.push(part);
      else mainKey = part;
    }
    mods.sort();
    return [...mods, mainKey].join('+');
  }

  // 表示用: "ctrl+shift+a" → "Ctrl+Shift+A"
  function formatKey(keyStr) {
    if (!keyStr) return '';
    return String(keyStr).split('+').map(part => {
      if (part === 'ctrl') return 'Ctrl';
      if (part === 'shift') return 'Shift';
      if (part === 'alt') return 'Alt';
      if (part === 'meta') return 'Meta';
      if (part === 'arrowup') return '↑';
      if (part === 'arrowdown') return '↓';
      if (part === 'arrowleft') return '←';
      if (part === 'arrowright') return '→';
      if (part === 'browserback') return '戻るボタン';
      if (part === 'browserforward') return '進むボタン';
      if (part === 'escape') return 'Esc';
      if (part === 'enter') return 'Enter';
      if (part === 'delete') return 'Del';
      if (part === 'backspace') return 'BS';
      if (part === 'tab') return 'Tab';
      if (part === 'space') return 'Space';
      if (part.length === 1) return part.toUpperCase();
      return part.charAt(0).toUpperCase() + part.slice(1);
    }).join('+');
  }

  function keyDisplay(keyStr) {
    return keyStr ? formatKey(keyStr) : '未設定';
  }

  // 押されたキーに対応するショートカットIDを返す（自前でキーを処理するアプリ用）。
  // scopes を渡すとその範囲だけを見る。
  function matchEvent(e, scopes) {
    const pressed = normalizeKeyEvent(e);
    if (!pressed) return '';
    const allowed = Array.isArray(scopes) && scopes.length ? scopes : null;
    const shortcuts = effective();
    for (const [id, def] of Object.entries(shortcuts)) {
      if (!def.key) continue;
      if (allowed && !allowed.includes(def.scope)) continue;
      if (normalizeKeyDef(def.key) === pressed) return id;
    }
    return '';
  }

  function conflict(selfId, newKey) {
    const shortcuts = effective();
    const selfScope = shortcuts[selfId]?.scope;
    for (const [id, def] of Object.entries(shortcuts)) {
      if (id === selfId || !def.key) continue;
      if (normalizeKeyDef(def.key) !== newKey) continue;
      if (def.scope === selfScope || def.scope === 'global' || selfScope === 'global') return def;
    }
    return null;
  }

  function scopeLabel(scope) {
    return SCOPE_LABELS[scope] || scope;
  }

  function scopeForType(type) {
    return TYPE_TO_SCOPE[String(type || '').toLowerCase()] || '';
  }

  // === 設定UI ===
  // 4階層規則（.gb-section → .gb-section-title → .gb-field-row → .gb-field-inline）に従う。
  // 設定ダイアログでは枠付き（boxed）、オプションパネルでは枠なしで使う。

  function _displayScope(id, def) {
    if (id.startsWith('panelset.')) return 'panelset';
    return def.scope || 'global';
  }

  function _groups(shortcuts, custom) {
    const grouped = Object.fromEntries(SCOPE_ORDER.map(scope => [scope, []]));
    for (const [id, def] of Object.entries(shortcuts)) {
      const displayScope = _displayScope(id, def);
      if (!grouped[displayScope]) grouped[displayScope] = [];
      grouped[displayScope].push({ id, displayScope, ...def, isCustom: !!custom[id] });
    }
    return grouped;
  }

  function applyFilter(container) {
    const query = (container.querySelector('[data-shortcut-search]')?.value || '').trim().toLowerCase();
    const selectedScope = container.querySelector('[data-shortcut-scope-filter]')?.value || 'all';
    container.querySelectorAll('.shortcut-row').forEach(row => {
      const matchesScope = selectedScope === 'all'
        || (selectedScope === 'current' && ['global', container.dataset.shortcutCurrentScope].includes(row.dataset.scope))
        || row.dataset.scope === selectedScope;
      const matchesSearch = !query || (row.dataset.search || '').includes(query);
      row.hidden = !(matchesScope && matchesSearch);
    });
    container.querySelectorAll('.shortcut-group').forEach(group => {
      const visibleCount = Array.from(group.querySelectorAll('.shortcut-row')).filter(row => !row.hidden).length;
      group.hidden = visibleCount === 0;
      const count = group.querySelector('.shortcut-group-count');
      if (count) count.textContent = visibleCount + '件';
    });
    const empty = container.querySelector('[data-shortcut-empty]');
    if (empty) empty.hidden = !!container.querySelector('.shortcut-group:not([hidden])');
  }

  function _scopeOptionsHtml(scopeOptions, previousScope, currentScope) {
    let html = '<option value="all"' + (previousScope === 'all' ? ' selected' : '') + '>すべて</option>';
    if (currentScope && currentScope !== 'global') {
      html += '<option value="current"' + (previousScope === 'current' ? ' selected' : '') + '>Meldex共通＋'
        + _esc(scopeLabel(currentScope)) + '</option>';
    }
    for (const [scope, items] of scopeOptions) {
      html += '<option value="' + _esc(scope) + '"' + (previousScope === scope ? ' selected' : '') + '>'
        + _esc(scopeLabel(scope)) + ' (' + items.length + ')</option>';
    }
    return html;
  }

  function _rowHtml(item) {
    const status = item.isCustom ? 'カスタム' : '既定';
    const label = scopeLabel(item.displayScope);
    const searchText = [item.label, item.id, item.key, label].join(' ').toLowerCase();
    let html = '<div class="shortcut-row gb-field-row" data-id="' + _esc(item.id) + '" data-scope="' + _esc(item.displayScope)
      + '" data-search="' + _esc(searchText) + '">';
    html += '<span class="shortcut-label gb-label" title="' + _esc(item.id) + '">' + _esc(item.label) + '</span>';
    html += '<span class="shortcut-status' + (item.isCustom ? ' is-custom' : '') + '">' + status + '</span>';
    html += '<kbd class="shortcut-key' + (item.isCustom ? ' is-custom' : '') + '" data-id="' + _esc(item.id)
      + '" data-e2e-id="shortcut-key-' + _esc(item.id)
      + '" tabindex="0" role="button" title="クリックして変更" aria-label="' + _esc(item.label) + 'のキーを変更">'
      + _esc(keyDisplay(item.key)) + '</kbd>';
    if (item.isCustom) {
      html += '<button type="button" class="shortcut-reset gb-btn gb-btn-xs gb-btn-quiet" data-id="' + _esc(item.id)
        + '" data-e2e-id="shortcut-reset-' + _esc(item.id) + '" title="デフォルトに戻す" aria-label="'
        + _esc(item.label) + 'をデフォルトに戻す">✕</button>';
    } else {
      html += '<span class="shortcut-reset-spacer"></span>';
    }
    return html + '</div>';
  }

  function _groupHtml(scope, items) {
    let html = '<div class="shortcut-group" data-scope="' + _esc(scope) + '">';
    html += '<div class="shortcut-group-head">';
    html += '<span>' + _esc(scopeLabel(scope)) + '</span>';
    html += '<span class="shortcut-group-count gb-section-desc">' + items.length + '件</span>';
    html += '</div>';
    html += items.map(_rowHtml).join('');
    return html + '</div>';
  }

  function _startKeyCapture(kbd, container) {
    const original = kbd.textContent;
    kbd.textContent = 'キーを入力...';
    kbd.classList.add('is-capturing');
    const finish = (text) => {
      kbd.textContent = text;
      kbd.classList.remove('is-capturing');
    };
    const handler = (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === 'Escape') {
        document.removeEventListener('keydown', handler, true);
        finish(keyDisplay(effective()[kbd.dataset.id]?.key || '') || original);
        return;
      }
      const newKey = normalizeKeyEvent(event);
      if (!newKey) return; // 修飾キー単体は無視（入力継続）
      const id = kbd.dataset.id;
      const hit = conflict(id, newKey);
      if (hit) {
        document.removeEventListener('keydown', handler, true);
        kbd.textContent = '競合: ' + hit.label;
        setTimeout(() => finish(keyDisplay(effective()[id]?.key || '')), 1500);
        return;
      }
      const custom = getCustom();
      // デフォルトと同じなら削除（カスタム扱いにしない）
      if (normalizeKeyDef(definitions[id]?.key || '') === newKey) delete custom[id];
      else custom[id] = { key: newKey };
      saveCustom(custom);
      document.removeEventListener('keydown', handler, true);
      renderSettings(container, container._shortcutSettingsOptions || {});
      if (typeof global._updateAllTooltips === 'function') global._updateAllTooltips();
    };
    document.addEventListener('keydown', handler, true);
  }

  // container に一覧を描画する。
  // options.scope: 初期の絞り込みスコープ（'' なら すべて）
  // options.boxed: 設定ダイアログ用の枠付き表示にするか
  function renderSettings(container, options) {
    if (!container) return;
    const opts = options || {};
    const previousCurrentScope = container.dataset.shortcutCurrentScope || '';
    if (previousCurrentScope && previousCurrentScope !== (opts.scope || '')) {
      container.dataset.shortcutScopeUserChoice = '0';
    }
    container._shortcutSettingsOptions = opts;
    container.dataset.shortcutSettingsHost = '1';
    container.dataset.shortcutSettingsScope = opts.scope || '';
    container.dataset.shortcutSettingsBoxed = opts.boxed ? '1' : '0';
    container.dataset.shortcutCurrentScope = opts.scope || '';

    const shortcuts = effective();
    const custom = getCustom();
    const grouped = _groups(shortcuts, custom);
    const scopeOptions = Object.entries(grouped).filter(([, items]) => items.length);
    const previousSearch = container.querySelector('[data-shortcut-search]')?.value || '';
    // 既定は「いま開いているアプリの分だけ」。ただしユーザーが絞り込みを自分で
    // 変えた後は、アプリを切り替えてもその選択を尊重する。
    const autoScope = (opts.scope && grouped[opts.scope]?.length) ? 'current' : 'all';
    const previousScope = container.dataset.shortcutScopeUserChoice === '1'
      ? (container.querySelector('[data-shortcut-scope-filter]')?.value || autoScope)
      : autoScope;

    let html = '<section class="gb-section shortcut-settings-wrap'
      + (opts.boxed ? ' gb-section--boxed' : ' gb-section--detail') + '">';
    html += '<div class="gb-section-title">ショートカットキー</div>';
    html += '<label class="gb-field-row shortcut-sync-toggle"><input type="checkbox" class="gb-checkbox" data-shortcut-sync-enabled data-e2e-id="shortcut-sync-enabled"'
      + (isSyncEnabled() ? ' checked' : '') + '>この環境の変更を他のMeldexと連動</label>';
    html += '<div class="gb-field-row shortcut-settings-filter">';
    html += '<input class="gb-input" type="text" placeholder="検索" data-shortcut-search'
      + (opts.boxed ? ' id="shortcut-search"' : '') + ' value="' + _esc(previousSearch) + '">';
    html += '<select class="gb-select" data-shortcut-scope-filter' + (opts.boxed ? ' id="shortcut-scope-filter"' : '') + '>';
    html += _scopeOptionsHtml(scopeOptions, previousScope, opts.scope || '');
    html += '</select>';
    html += '<button type="button" class="gb-btn gb-btn-sm" data-shortcut-reset-all'
      + (opts.boxed ? ' id="shortcut-reset-all"' : '') + '>すべてリセット</button>';
    html += '</div>';
    html += scopeOptions.map(([scope, items]) => _groupHtml(scope, items)).join('');
    html += '<div class="gb-section-desc" data-shortcut-empty' + (opts.boxed ? ' id="shortcut-empty"' : '')
      + ' hidden>該当するショートカットがありません</div>';
    html += '</section>';
    container.innerHTML = html;

    container.querySelectorAll('.shortcut-key').forEach(kbd => {
      kbd.addEventListener('click', () => _startKeyCapture(kbd, container));
      kbd.addEventListener('keydown', event => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        _startKeyCapture(kbd, container);
      });
    });

    container.querySelectorAll('.shortcut-reset').forEach(button => {
      button.addEventListener('click', () => {
        const next = getCustom();
        delete next[button.dataset.id];
        saveCustom(next);
        renderSettings(container, opts);
        if (typeof global._updateAllTooltips === 'function') global._updateAllTooltips();
      });
    });

    container.querySelector('[data-shortcut-reset-all]')?.addEventListener('click', async () => {
      const confirmFn = typeof global.cfConfirm === 'function' ? global.cfConfirm : null;
      if (confirmFn && !await confirmFn('すべてのショートカットをデフォルトに戻しますか？')) return;
      saveCustom({});
      renderSettings(container, opts);
      if (typeof global._updateAllTooltips === 'function') global._updateAllTooltips();
    });

    container.querySelector('[data-shortcut-search]')?.addEventListener('input', () => applyFilter(container));
    container.querySelector('[data-shortcut-sync-enabled]')?.addEventListener('change', event => {
      setSyncEnabled(event.currentTarget.checked);
    });
    container.querySelector('[data-shortcut-scope-filter]')?.addEventListener('change', () => {
      container.dataset.shortcutScopeUserChoice = '1';
      applyFilter(container);
    });
    applyFilter(container);
  }

  function _startSync() {
    _migrateLegacyOnce();
    global.addEventListener?.('focus', () => { syncNow(); });
    global.addEventListener?.('online', () => { syncNow(); });
    global.addEventListener?.('storage', event => {
      if (event.key === STORAGE_KEY && !_applyingSyncedBindings) {
        _refreshOpenSettings();
        scheduleSyncPush();
      }
    });
    const periodicSync = global.setInterval?.(() => { syncNow(); }, 60000);
    periodicSync?.unref?.();
    syncNow();
  }

  global.MeldexShortcutRegistry = Object.freeze({
    register,
    registerLocal,
    defaults,
    effective,
    getCustom,
    saveCustom,
    keyFor,
    normalizeKeyEvent,
    normalizeKeyDef,
    formatKey,
    keyDisplay,
    matchEvent,
    conflict,
    scopeLabel,
    scopeForType,
    renderSettings,
    applyFilter,
    isSyncEnabled,
    setSyncEnabled,
    mergeBindings,
    pullShortcutSettings,
    pushShortcutSettings,
    syncNow,
    scheduleSyncPush,
    SYNC_DOCUMENT_NAME,
    SYNC_STATE_KEY,
    SYNC_ENABLED_KEY,
    SCOPE_LABELS,
    SCOPE_ORDER,
  });

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _startSync, { once: true });
    else _startSync();
  }
})(typeof window !== 'undefined' ? window : globalThis);
