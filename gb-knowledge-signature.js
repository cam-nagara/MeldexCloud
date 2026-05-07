(function () {
  'use strict';

  const SIGNATURE_DIR = '_meldex/integrity';
  const AUDIT_LOG_PATH = '_meldex/audit-log.json';
  const MAX_AUDIT_ROWS = 500;

  function _internals() {
    return window.__MeldexPwaDataAccessInternals || {};
  }

  function _normalizeScope(scope) {
    return String(scope || '').trim().replace(/[^a-z0-9_.-]+/gi, '_') || 'default';
  }

  function _stable(value) {
    if (value == null || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map(_stable);
    const out = {};
    Object.keys(value).sort().forEach(key => {
      if (key === 'hmac' || key === 'signed_at' || key === 'signature') return;
      out[key] = _stable(value[key]);
    });
    return out;
  }

  function stableStringify(value) {
    return JSON.stringify(_stable(value));
  }

  function _bytesToHex(bytes) {
    return Array.from(bytes || []).map(byte => byte.toString(16).padStart(2, '0')).join('');
  }

  async function hmac(payload, options = {}) {
    const key = await window.MeldexOwnerKeyStore?.importHmacKey?.(options);
    if (!key) return '';
    const data = new TextEncoder().encode(stableStringify(payload));
    const sig = await crypto.subtle.sign('HMAC', key, data);
    return _bytesToHex(new Uint8Array(sig));
  }

  async function readSignature(provider, scope) {
    const { _joinPath, _readJsonSafe } = _internals();
    if (!provider || typeof _readJsonSafe !== 'function') return null;
    return _readJsonSafe(provider, _joinPath(SIGNATURE_DIR, _normalizeScope(scope) + '.json'), null);
  }

  async function sign(provider, scope, payload, meta = {}) {
    const { _joinPath } = _internals();
    if (!provider || typeof provider.writeJson !== 'function') return { ok: false, skipped: true };
    const digest = await hmac(payload, { create: true });
    const entry = {
      scope: _normalizeScope(scope),
      hmac: digest,
      signed_at: new Date().toISOString(),
      signer: meta.signer || '',
      version: 1,
    };
    await provider.writeJson(_joinPath(SIGNATURE_DIR, entry.scope + '.json'), entry);
    return { ok: true, ...entry };
  }

  async function verify(provider, scope, payload) {
    const signature = await readSignature(provider, scope);
    const key = await window.MeldexOwnerKeyStore?.getRawKey?.({ create: false });
    if (!key) {
      if (signature?.hmac) {
        window.MeldexOwnerKeyRecovery?.notifyMissingOwnerKey?.('署名済みデータを検証する管理者鍵がこの端末にありません。');
        return { ok: false, missing_key: true, reason: 'owner-key-missing', signature };
      }
      return { ok: true, skipped: true, missing_key: true, reason: 'owner-key-missing', signature };
    }
    if (!signature?.hmac) return { ok: false, missing: true, signature };
    const digest = await hmac(payload, { create: false });
    return { ok: digest === signature.hmac, expected: signature.hmac, actual: digest, signature };
  }

  async function verifyStrict(provider, scope, payload) {
    const result = await verify(provider, scope, payload);
    if (result?.ok === true && result.skipped) return { ...result, ok: false, strict: true };
    return result;
  }

  async function recordAudit(provider, type, entry = {}) {
    const { _readJsonSafe } = _internals();
    if (!provider || typeof provider.writeJson !== 'function') return { ok: false };
    const rows = await _readJsonSafe(provider, AUDIT_LOG_PATH, []).catch(() => []);
    const nextRows = Array.isArray(rows) ? rows : [];
    nextRows.push({
      type: String(type || 'event'),
      at: new Date().toISOString(),
      user: typeof getUsername === 'function' ? getUsername() : '',
      ...entry,
    });
    while (nextRows.length > MAX_AUDIT_ROWS) nextRows.shift();
    await provider.writeJson(AUDIT_LOG_PATH, nextRows);
    return { ok: true, count: nextRows.length };
  }

  async function readAudit(provider, type = '') {
    const { _readJsonSafe } = _internals();
    const rows = await _readJsonSafe(provider, AUDIT_LOG_PATH, []).catch(() => []);
    const list = Array.isArray(rows) ? rows : [];
    const wanted = String(type || '').trim();
    return wanted ? list.filter(row => row?.type === wanted) : list;
  }

  window.MeldexKnowledgeSignature = {
    stableStringify,
    hmac,
    sign,
    verify,
    verifyStrict,
    readSignature,
    recordAudit,
    readAudit,
  };
})();
