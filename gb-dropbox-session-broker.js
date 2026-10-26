/* Dropbox session transport for iOS Home Screen launches. */
(function () {
  'use strict';
  const PROFILE_KEY = 'meldex-dropbox-session-profile-v1';
  const PENDING_KEY = 'meldex-dropbox-session-handoff-v1';
  const DISCONNECTED_KEY = 'meldex-dropbox-session-disconnected-v1';
  const LOGOUT_KEY = 'meldex-dropbox-session-logout-pending-v1';
  const REPLACEMENT_KEY = 'meldex-dropbox-session-authorized-account-v1';
  let meta = null, access = null, account = null, initPromise = null, accessPromise = null;
  let settingsPromise = Promise.resolve(), settingsTimer = 0, pendingSettings = null;
  let epoch = 0, settingsError = null;

  function problem(code, status) {
    return Object.assign(new Error(code), { code, status: status || 0, meldexSessionError: true });
  }
  function read(key, fallback) {
    try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
  }
  function write(key, value) {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  }
  function isIos() {
    return /iPhone|iPad|iPod/i.test(String(navigator.userAgent || ''))
      || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }
  function isInstalled() {
    return navigator.standalone === true || window.matchMedia?.('(display-mode: standalone)')?.matches === true;
  }
  function baseUrl() { return new URL('.', document.baseURI || location.href); }
  function apiBase() {
    const config = window.MeldexCloudRuntimeConfig?.dropbox || {};
    const external = String(config.sessionBrokerUrl || '').trim();
    const path = String(config.sessionBrokerApiPath || '').trim();
    if (external) {
      if (path || !window.MeldexDropboxSessionProof) return null;
      try {
        const url = new URL(external);
        if (url.protocol !== 'https:' || url.origin === location.origin || url.username || url.password || url.search || url.hash
          || !/^\/(?:[A-Za-z0-9_-]+\/)*api\/pwa-session\/?$/.test(url.pathname)) return null;
        return new URL(url.href.replace(/\/$/, '') + '/');
      } catch { return null; }
    }
    if (!/^api\/pwa-session\/?$/.test(path)) return null;
    const url = new URL(path.replace(/\/$/, '') + '/', baseUrl());
    return url.origin === location.origin && url.protocol === 'https:' ? url : null;
  }
  function isEnabled() {
    if (!isIos() || location.protocol !== 'https:' || !apiBase()) return false;
    const params = new URLSearchParams(location.search);
    if (params.get('desktop') === '1' || params.get('safeMode') === '1') return false;
    if (params.has('dataAccessMode') && params.get('dataAccessMode') !== 'dropbox') return false;
    const runtime = window.MeldexRuntimeAdapter;
    if (!meta && !initPromise && kind() !== 'bridge' && read(PROFILE_KEY, '')
      && runtime?.hasStoredMode?.() && runtime?.getMode?.() === 'browser') return false;
    return true;
  }
  function kind() {
    if (/dropbox-session-bridge\.html$/i.test(location.pathname)) return 'bridge';
    if (!isInstalled()) return 'browser';
    return document.documentElement?.getAttribute('data-standalone-cloud') === 'quick-memo'
      || /(?:quick-memo)(?:\/|\.html)/i.test(location.pathname) ? 'memo' : 'main';
  }
  function validateMeta(value) {
    if (value?.protocol !== 'meldex-pwa-session' || value?.version !== 1
      || typeof value.csrf !== 'string' || !/^[a-f0-9]{64}$/.test(value.csrf)
      || typeof value.connected !== 'boolean') throw problem('session_service_invalid');
    if (value.connected && (typeof value.accountId !== 'string' || !value.accountId
      || !value.settings || typeof value.settings !== 'object')) throw problem('session_service_invalid');
    if (value.connected) {
      const s = value.settings;
      if (!Number.isInteger(value.settingsVersion) || value.settingsVersion < 1
        || !['home', 'team_root'].includes(s.vaultNamespace) || !['developer', 'custom'].includes(s.appMode)
        || typeof s.customAppKey !== 'string' || ['vaultPath', 'settingsPath'].some(key =>
          typeof s[key] !== 'string' || !s[key].startsWith('/') || s[key].length > 512
          || s[key].includes('\\') || s[key].split('/').includes('..') || /[\x00-\x1f]/.test(s[key]))) throw problem('session_service_invalid');
    }
    return value;
  }
  async function request(path, body, retryCsrf = true, boundAccount = meta?.connected ? meta.accountId : '') {
    const base = apiBase();
    if (!base) throw problem('session_service_unconfigured');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    try {
      const headers = { 'X-Meldex-Client': 'meldex-session-v1' };
      if (boundAccount) headers['X-Meldex-Account'] = boundAccount;
      const options = { credentials: 'same-origin', redirect: 'error', cache: 'no-store', referrerPolicy: 'no-referrer', headers, signal: controller.signal };
      if (body !== undefined) {
        options.method = 'POST';
        headers['Content-Type'] = 'application/json';
        headers['X-CSRF-Token'] = meta?.csrf || '';
        options.body = JSON.stringify(body);
      }
      const url = new URL(path, base).href;
      const proof = String(window.MeldexCloudRuntimeConfig?.dropbox?.sessionBrokerUrl || '').trim()
        ? window.MeldexDropboxSessionProof : null;
      const proofSession = proof ? await proof.prepare(base.href, url, options) : null;
      const response = await fetch(url, options);
      let value;
      try { value = await response.json(); } catch { throw problem('session_service_invalid', response.status); }
      if (response.status === 403 && value?.error === 'csrf_rejected' && retryCsrf) {
        meta = validateMeta(await request('bootstrap', undefined, false));
        return request(path, body, false, boundAccount);
      }
      if (!response.ok) throw problem(String(value?.error || 'session_service_failed'), response.status);
      if (proof) value = await proof.accept(base.href, value, proofSession);
      return value;
    } catch (error) {
      if (error.meldexSessionError) throw error;
      throw problem('session_service_unavailable');
    } finally { clearTimeout(timer); }
  }
  function signature(settings) {
    return JSON.stringify(['vaultPath', 'settingsPath', 'vaultNamespace', 'appMode', 'customAppKey']
      .map(key => String(settings?.[key] || '')));
  }
  function profile() {
    try { return JSON.parse(read(PROFILE_KEY, 'null')); } catch { return null; }
  }
  function remember() {
    if (!meta?.connected) return;
    write(PROFILE_KEY, JSON.stringify({ accountId: meta.accountId, version: meta.settingsVersion,
      signature: signature(meta.settings) }));
  }
  async function saveSettings(settings, expectedVersion) {
    const currentEpoch = epoch;
    let value;
    try { value = validateMeta(await request('settings', { settings, expectedVersion })); }
    catch (error) {
      if (error.code !== 'settings_changed') throw error;
      value = validateMeta(await request('bootstrap'));
      if (signature(value.settings) !== signature(settings)) throw error;
    }
    if (currentEpoch !== epoch) throw problem('session_changed', 409);
    if (meta?.accountId !== value.accountId) throw problem('account_change_rejected', 409);
    meta = value;
    remember();
    settingsError = null;
  }
  async function completePendingLogout() {
    const target = read(LOGOUT_KEY, '');
    if (!target) return;
    meta = validateMeta(await request('bootstrap'));
    if (meta.connected && meta.accountId === target) await request('logout', { scope: 'this_app' });
    meta = access = account = null;
    write(LOGOUT_KEY, null);
  }
  async function boot(raw, settings) {
    await completePendingLogout();
    if (read(DISCONNECTED_KEY, '') === '1') return null;
    meta = validateMeta(await request('bootstrap'));
    const rawAccount = String(raw?.accountId || raw?.account?.account_id || '');
    const replacement = rawAccount && read(REPLACEMENT_KEY, '') === rawAccount;
    if (meta.connected && rawAccount && rawAccount !== meta.accountId && !replacement) throw problem('account_change_rejected', 409);
    if (raw?.refreshToken && (!meta.connected || (replacement && meta.accountId !== rawAccount))) {
      meta = validateMeta(await request('import', {
        refreshToken: raw.refreshToken, appKey: raw.appKey,
        accountId: rawAccount, settings, replace: !!replacement,
      }));
      const importedAccount = meta.accountId;
      meta = validateMeta(await request('bootstrap'));
      if (!meta.connected || meta.accountId !== importedAccount) throw problem('session_cookie_unavailable');
    }
    if (meta.connected && replacement && meta.accountId === rawAccount) write(REPLACEMENT_KEY, null);
    if (meta.connected) {
      const appKind = kind() === 'bridge' ? 'browser' : kind();
      meta = validateMeta(await request('activate', { kind: appKind }));
      const saved = profile();
      const localChanged = saved?.accountId === meta.accountId && saved.signature !== signature(settings);
      if ((raw?.refreshToken || localChanged) && signature(settings) !== signature(meta.settings)) {
        const expected = localChanged ? saved.version : meta.settingsVersion;
        await saveSettings(settings, expected);
      }
      remember();
    }
    return session();
  }
  function isTransient(error) {
    return !error.status || error.status >= 500 || error.status === 404;
  }
  async function restore(raw, settings) {
    if (!isEnabled()) return raw;
    if (!initPromise) initPromise = boot(raw, settings).catch(error => { initPromise = null; throw error; });
    try { await initPromise; }
    catch (error) {
      if (raw?.refreshToken && isTransient(error) && read(DISCONNECTED_KEY, '') !== '1') return raw;
      throw error;
    }
    return session();
  }
  function session() {
    if (read(DISCONNECTED_KEY, '') === '1' || !meta?.connected) return null;
    return { connected: true, authTransport: 'broker', accountId: meta.accountId,
      accessToken: access?.accessToken || '', expiresAt: access?.expiresAt || 0,
      appKey: meta.appKey || '', account,
      settings: { ...meta.settings } };
  }
  async function validSession(force = false) {
    if (!session()) throw problem('session_restore_required', 401);
    if (!force && access?.expiresAt > Date.now() + 120000) return { ...session(), ...access };
    if (!accessPromise) {
      const currentEpoch = epoch, expectedAccount = meta.accountId;
      accessPromise = request('access', { force, generation: access?.generation }).then(value => {
        if (currentEpoch !== epoch || read(DISCONNECTED_KEY, '') === '1') throw problem('session_changed', 409);
        if (value.accountId !== expectedAccount || typeof value.accessToken !== 'string' || !value.accessToken
          || !Number.isFinite(value.expiresAt)) throw problem('account_change_rejected', 409);
        access = value;
        return { ...session(), ...access };
      }).catch(error => { access = null; throw error; }).finally(() => { accessPromise = null; });
    }
    return accessPromise;
  }
  function setAccount(value) {
    if (String(value?.account_id || '') !== meta?.accountId) throw problem('account_change_rejected', 409);
    account = value;
  }
  function queueSettings(settings) {
    if (!isEnabled() || !meta?.connected || read(DISCONNECTED_KEY, '') === '1') return;
    pendingSettings = { ...settings };
    clearTimeout(settingsTimer);
    settingsTimer = setTimeout(() => flushSettings().catch(() => {}), 100);
  }
  async function flushSettings() {
    clearTimeout(settingsTimer);
    if (pendingSettings) {
      const value = pendingSettings;
      pendingSettings = null;
      settingsPromise = settingsPromise.catch(() => {}).then(async () => {
        if (!session()) throw problem('session_changed', 409);
        if (signature(value) !== signature(meta.settings)) await saveSettings(value, meta.settingsVersion);
      }).catch(error => {
        settingsError = error;
        pendingSettings = pendingSettings || value;
        try { window.dispatchEvent(new CustomEvent('meldex:dropbox-session-settings-error', { detail: { code: error.code } })); } catch {}
        throw error;
      });
    }
    await settingsPromise;
    if (settingsError) throw settingsError;
  }
  function resetAfterAuthorization(authorizedAccount) {
    epoch += 1;
    initPromise = accessPromise = meta = access = account = null;
    write(DISCONNECTED_KEY, null);
    write(LOGOUT_KEY, null);
    if (authorizedAccount) write(REPLACEMENT_KEY, authorizedAccount);
  }
  async function logout(expectedAccount) {
    epoch += 1;
    access = account = null;
    write(DISCONNECTED_KEY, '1');
    const target = expectedAccount || meta?.accountId || read(LOGOUT_KEY, '') || profile()?.accountId;
    if (target) write(LOGOUT_KEY, target);
    clearTimeout(settingsTimer);
    pendingSettings = null;
    await settingsPromise.catch(() => {});
    await completePendingLogout();
    initPromise = accessPromise = null;
    write(PROFILE_KEY, null);
    write(REPLACEMENT_KEY, null);
    try { sessionStorage.removeItem(PENDING_KEY); } catch {}
  }
  function pending() {
    try {
      const value = JSON.parse(sessionStorage.getItem(PENDING_KEY) || 'null');
      return value?.expiresAt > Date.now() && value.kind === kind() ? value : null;
    } catch { return null; }
  }
  async function createHandoff() {
    const saved = pending();
    if (saved) return saved;
    if (!meta) meta = validateMeta(await request('bootstrap'));
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    const receiverProof = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const value = await request('handoff/create', { kind: kind() === 'memo' ? 'memo' : 'main', receiverProof });
    if (typeof value.id !== 'string' || !/^[A-Za-z0-9_-]{20,64}$/.test(value.id)
      || !/^\d{6}$/.test(value.userCode) || !Number.isFinite(value.expiresAt)) throw problem('session_service_invalid');
    const bridge = new URL('dropbox-session-bridge.html', baseUrl());
    bridge.hash = new URLSearchParams({ request: value.id }).toString();
    const result = { ...value, kind: kind(), receiverProof, bridgeUrl: bridge.href };
    sessionStorage.setItem(PENDING_KEY, JSON.stringify(result));
    return result;
  }
  async function redeemHandoff() {
    const value = pending();
    if (!value) throw problem('handoff_expired', 410);
    const body = { id: value.id, receiverProof: value.receiverProof };
    const result = await request('handoff/redeem', body);
    if (result.state === 'pending') return false;
    meta = validateMeta(result);
    const expected = meta.accountId;
    meta = validateMeta(await request('bootstrap'));
    if (!meta.connected || meta.accountId !== expected) throw problem('session_cookie_unavailable');
    await request('handoff/ack', body);
    sessionStorage.removeItem(PENDING_KEY);
    write(DISCONNECTED_KEY, null);
    remember();
    initPromise = Promise.resolve(session());
    try { window.dispatchEvent(new CustomEvent('meldex:dropbox-auth-session-changed', {
      detail: { connected: true, accountId: meta.accountId, remote: false },
    })); } catch {}
    return true;
  }
  async function prepareLaunch(options) {
    if (!isEnabled()) return;
    let raw;
    try { raw = await window.MeldexDropboxAuth.getSession(); }
    catch (error) {
      if (!isInstalled() || !window.MeldexDropboxSessionRestore?.wait) throw error;
      await window.MeldexDropboxSessionRestore.wait({ ...options, initialError: error });
      await window.MeldexDropboxAuth.getSession();
      return;
    }
    if (raw && !isManaged(raw)) return; // Existing direct connection remains usable during a service outage.
    if (raw) return;
    if (kind() === 'browser' || kind() === 'bridge') return;
    if (!window.MeldexDropboxSessionRestore?.wait) throw problem('session_restore_ui_missing');
    await window.MeldexDropboxSessionRestore.wait(options);
    await window.MeldexDropboxAuth.getSession();
  }
  async function prepareInstall() {
    if (!isEnabled()) return;
    const current = await window.MeldexDropboxAuth.getSession();
    if (current && !isManaged(current)) throw problem('session_service_unavailable');
    if (current) await flushSettings();
  }
  function isManaged(value) { return value?.authTransport === 'broker' && value?.connected === true; }
  window.MeldexDropboxSessionBroker = {
    isEnabled, isInstalled, kind, restore, session, validSession, setAccount,
    queueSettings, flushSettings, resetAfterAuthorization, logout, createHandoff, redeemHandoff,
    prepareLaunch, prepareInstall, isManaged,
    resetHandoff: () => sessionStorage.removeItem(PENDING_KEY),
    inspectHandoff: id => request('handoff/inspect', { id }),
    approveHandoff: (id, userCode) => request('handoff/approve', { id, userCode, confirmed: true }),
  };
})();
