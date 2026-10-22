/* gb-theme-sync.js — テーマ（見た目）の設定をデスクトップ版とクラウド版で共有する。
 *
 * テーマの設定はブラウザの保存領域にしか無く、デスクトップ版（localhost）と
 * クラウド版（公開URL）は別の保存領域だった。そのため片方で整えた色・パレット・
 * フォントがもう片方へ渡る経路が存在せず、「クラウド版のテーマだけ少し違って見える」
 * 状態になっていた（2026-08-07 修正）。
 *
 * ここでは、その人自身のDropbox個人管理領域に置いた1つの記録を正としてやり取りする。
 * 端末側の保存領域は作業用の写しとして残し、開いたときに取り込み、変えたときに書き戻す。
 * Dropboxへ接続していない環境では何もしない（従来どおり端末ごとの設定として動く）。
 */
(function (global) {
  'use strict';

  if (global.MeldexThemeSync) return;

  const DOCUMENT_NAME = 'theme-settings';
  const STATE_KEY = 'meldex-theme-sync-state';
  const PUSH_DELAY_MS = 1200;

  const CHANGE_EVENTS = [
    'meldex-theme-change',
    'meldex-theme-color-set-change',
    'meldex-theme-os-accent-change',
    'meldex-theme-ui-applications-change',
    'meldex-theme-ui-auto-tone-change',
  ];

  let _pushTimer = null;
  let _busy = false;
  let _applyingRemote = false;
  let _pushRequested = false;

  function _manager() {
    return global.MeldexThemeManager;
  }

  function _themeKeys() {
    const keys = _manager()?.THEME_SETTINGS_KEYS;
    return Array.isArray(keys) ? keys.slice() : [];
  }

  function _readLocalValues() {
    const values = {};
    _themeKeys().forEach((key) => {
      try {
        values[key] = localStorage.getItem(key);
      } catch {
        values[key] = null;
      }
    });
    return values;
  }

  // 値そのものの並びから作る短い指紋。「前回同期したときから変わったか」の判定に使う。
  function _signature(values) {
    const keys = Object.keys(values || {}).sort();
    const text = keys.map((key) => `${key}\u0000${values[key] == null ? '' : values[key]}`).join('\u0001');
    let hash = 0x811c9dc5;
    for (let i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return String(hash);
  }

  function _readState() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STATE_KEY) || 'null');
      return (parsed && typeof parsed === 'object') ? parsed : null;
    } catch {
      return null;
    }
  }

  function _writeState(state) {
    try {
      localStorage.setItem(STATE_KEY, JSON.stringify(state));
    } catch { /* 保存できなくても表示は続行する */ }
  }

  function _get(path) {
    if (typeof apiFetch !== 'function') return Promise.resolve(null);
    return apiFetch(path, { silentError: true, skipBrowseCache: true });
  }

  // 競合したら読み直す必要があるので、失敗は呼び出し元へ伝える。
  // silentError はエラーの通知表示を出さないだけで、例外はそのまま返ってくる。
  function _put(path, body) {
    if (typeof apiFetch !== 'function') return Promise.resolve(null);
    return apiFetch(path, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      silentError: true,
    });
  }

  function _remoteSnapshot(values, localValues) {
    // An older client may not know a newly introduced setting. Absence is
    // different from an explicit null (reset), and must not erase that key.
    return Object.fromEntries(_themeKeys().map(key => [key,
      Object.prototype.hasOwnProperty.call(values, key)
        ? (values[key] == null ? null : String(values[key]))
        : localValues[key],
    ]));
  }

  function _recordRemote(response, values) {
    const known = new Set(_themeKeys());
    _writeState({
      revision: response.revision,
      signature: _signature(values),
      updatedAt: response.payload.updatedAt || '',
      values,
      extras: Object.fromEntries(Object.entries(response.payload.values).filter(([key]) => !known.has(key))),
    });
  }

  function _mergePendingValues(localValues, remoteValues, baseline) {
    return Object.fromEntries(_themeKeys().map(key => {
      const hasBaseline = baseline && Object.prototype.hasOwnProperty.call(baseline, key);
      // Legacy sync states have no per-key baseline. Preserve their existing
      // local settings, as for first sync, rather than guessing which was edited.
      const locallyChanged = hasBaseline
        ? localValues[key] !== baseline[key]
        : localValues[key] != null;
      return [key, locallyChanged ? localValues[key] : remoteValues[key]];
    }));
  }

  function _applyRemoteValues(values) {
    const keys = _themeKeys();
    const changed = [];
    _applyingRemote = true;
    try {
      keys.forEach((key) => {
        // Older versions did not sync the migration archive. Its absence in
        // those records must not erase the only remaining custom theme copy.
        if (['meldex-promoted-initial-theme-sources', 'meldex-custom-theme-cleanup-version'].includes(key)
            && !Object.prototype.hasOwnProperty.call(values || {}, key)) return;
        const next = Object.prototype.hasOwnProperty.call(values || {}, key) ? values[key] : null;
        let current = null;
        try { current = localStorage.getItem(key); } catch { current = null; }
        if (current === next) return;
        try {
          if (next == null) localStorage.removeItem(key);
          else localStorage.setItem(key, next);
          changed.push(key);
        } catch { /* 保存できないキーは飛ばす */ }
      });
      if (changed.length && typeof _manager()?.refreshThemeSettingsAfterExternalChange === 'function') {
        _manager().refreshThemeSettingsAfterExternalChange(changed);
      }
    } finally {
      _applyingRemote = false;
    }
    return changed;
  }

  async function pull() {
    const requestedState = _readState();
    const response = await _get(`/personal-preferences/${DOCUMENT_NAME}`);
    if (!response || response.available === false) return { applied: false, available: false };
    if (!response.exists || !response.payload) return { applied: false, available: true, revision: null };

    const rawRemoteValues = response.payload.values;
    if (!rawRemoteValues || typeof rawRemoteValues !== 'object' || Array.isArray(rawRemoteValues)) return { applied: false, available: true, revision: response.revision };

    const localValues = _readLocalValues();
    const remoteValues = _remoteSnapshot(rawRemoteValues, localValues);
    const localSignature = _signature(localValues);
    const remoteSignature = _signature(remoteValues);
    const state = _readState();
    if (state?.revision !== requestedState?.revision || state?.signature !== requestedState?.signature) {
      return { applied: false, available: true, stale: true };
    }
    if (localSignature === remoteSignature) {
      _recordRemote(response, remoteValues);
      return { applied: false, available: true, revision: response.revision };
    }

    const remoteUpdatedAt = String(response.payload.updatedAt || '');
    const syncedUpdatedAt = String(state?.updatedAt || '');

    // この端末で一度も同期していない場合は、どちらが新しいかを比べる材料が無い。
    // 丸ごと取り込むと、まだ同期されていないこの端末の設定を別環境の既定値で
    // 黙って消してしまう。すでにこの端末で決まっている項目は残し、まだ持って
    // いない項目だけを取り込む（不足分を埋める形にして、消えないことを保証する）。
    if (!state) {
      const merged = {};
      _themeKeys().forEach((key) => {
        merged[key] = localValues[key] != null
          ? localValues[key]
          : (Object.prototype.hasOwnProperty.call(remoteValues, key) ? remoteValues[key] : null);
      });
      const mergedChanged = _applyRemoteValues(merged);
      // Record the remote baseline, not the merged local values: any local
      // difference still needs to be written with this revision.
      _recordRemote(response, remoteValues);
      return { applied: mergedChanged.length > 0, available: true, revision: response.revision, changed: mergedChanged, merged: true };
    }

    // Check for local edits even when timestamps are available, including edits
    // made while this GET was pending. Keep edited keys; receive unrelated remote
    // settings. The remote baseline lets push use its exact revision with CAS.
    if (state.signature !== localSignature) {
      const merged = _mergePendingValues(localValues, remoteValues, state.values);
      const changed = _applyRemoteValues(merged);
      _recordRemote(response, remoteValues);
      return { applied: changed.length > 0, available: true, revision: response.revision, changed, pendingLocal: true };
    }

    // 2回目以降。共有側の内容が、この端末が前回やり取りした時点より新しくないなら
    // 取り込まない（同じか古い内容で、この端末の今の見た目を巻き戻さないため）。
    if (syncedUpdatedAt && (remoteUpdatedAt < syncedUpdatedAt
        || (remoteUpdatedAt === syncedUpdatedAt && response.revision === state.revision))) {
      return { applied: false, available: true, revision: response.revision };
    }
    const changed = _applyRemoteValues(remoteValues);
    _recordRemote(response, remoteValues);
    return { applied: changed.length > 0, available: true, revision: response.revision, changed };
  }

  async function push(options) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const values = _readLocalValues();
      const signature = _signature(values);
      const state = _readState();
      if (!options?.force && state && state.signature === signature) return { pushed: false, available: true };
      const initialSnapshot = !state?.revision;
      const payload = { updatedAt: initialSnapshot ? '1970-01-01T00:00:00.000Z' : new Date().toISOString(),
        values: { ...(state?.extras || {}), ...values } };
      let response;
      try {
        response = await _put(`/personal-preferences/${DOCUMENT_NAME}`, {
          payload,
          expectedRevision: state?.revision || null,
          initialSnapshot,
        });
      } catch (err) {
        const conflict = Number(err?.status || err?.statusCode) === 409;
        if (conflict && attempt === 0) {
          const pulled = await pull().catch(() => null);
          if (pulled?.available && !pulled.stale) continue;
        }
        // Failed writes never advance the baseline or discard the local edit.
        return { pushed: false, conflict, error: err };
      }
      if (!response || response.available === false) return { pushed: false, available: false };
      _writeState({ revision: response.revision || '', signature, updatedAt: payload.updatedAt,
        values, extras: state?.extras || {} });
      return { pushed: true, available: true, revision: response.revision || '' };
    }
  }

  function _finishSync() {
    _busy = false;
    if (_pushRequested) {
      _pushRequested = false;
      schedulePush();
    }
  }

  function schedulePush() {
    if (_applyingRemote) return;
    if (_pushTimer) clearTimeout(_pushTimer);
    _pushTimer = setTimeout(() => {
      _pushTimer = null;
      if (_busy) { _pushRequested = true; return; }
      _busy = true;
      push().catch(() => null).finally(_finishSync);
    }, PUSH_DELAY_MS);
  }

  async function syncNow() {
    if (_busy) return null;
    _busy = true;
    try {
      const pulled = await pull();
      if (pulled && pulled.available === false) return pulled;
      const pushed = await push();
      return { pulled, pushed };
    } catch {
      return null;
    } finally {
      _finishSync();
    }
  }

  function start() {
    if (!_manager()?.THEME_SETTINGS_KEYS) return;
    CHANGE_EVENTS.forEach((name) => global.addEventListener(name, schedulePush));
    // 別の環境で変えた見た目を、戻ってきたときに取り込む
    global.addEventListener('focus', () => { syncNow(); });
    syncNow();
  }

  global.MeldexThemeSync = {
    DOCUMENT_NAME,
    STATE_KEY,
    pull,
    push,
    syncNow,
    start,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})(typeof window !== 'undefined' ? window : globalThis);
