(function () {
  'use strict';

  const SIGNATURE_DIR = '_meldex/integrity';
  const AUDIT_LOG_PATH = '_meldex/audit-log.json';
  const MAX_AUDIT_ROWS = 500;
  const AUDIT_LOG_DOCUMENT_ID = 'knowledge-audit-log';

  function _internals() {
    return window.__MeldexPwaDataAccessInternals || {};
  }

  function _normalizeScope(scope) {
    return String(scope || '').trim().replace(/[^a-z0-9_.-]+/gi, '_') || 'default';
  }

  // options.managementAdapter: 署名の保存先アダプターを明示指定する(省略時は
  // 接続中ルートの管理領域)。編集ロックのように管理データ本体が対象文書パスで
  // 個人/共有スコープへ振り分けられる場合、署名も同じスコープの管理領域に
  // 置かないと、別スコープの署名で上書き・誤検証されてしまうために使う。
  async function _managementRecord(provider, documentId, options = {}) {
    const kind = window.MeldexSystemStorage?.SystemStorageKind?.AUDIT_INTEGRITY;
    if (!provider || !kind) {
      throw new Error('監査・整合性データの管理領域が未初期化です');
    }
    let adapter = options.managementAdapter || null;
    if (!adapter) {
      const resolver = window.MeldexDropboxManagementRootResolver;
      if (!resolver?.resolveTypedAdapterForProvider) {
        throw new Error('監査・整合性データの管理領域が未初期化です');
      }
      adapter = await resolver.resolveTypedAdapterForProvider(provider, kind);
    }
    const record = await adapter.load(kind, documentId);
    return { adapter, kind, record };
  }

  async function _saveManagementRecord(provider, documentId, payload, options = {}) {
    let lastError = null;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const current = await _managementRecord(provider, documentId, options);
      try {
        return await current.adapter.save(current.kind, documentId, payload(current.record?.payload || null), {
          expectedRevision: current.record?.revision ?? null,
        });
      } catch (error) {
        lastError = error;
        if (error?.name !== 'SystemStorageConflictError' && error?.code !== 'system_storage_conflict') throw error;
      }
    }
    throw lastError;
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

  function _auditId() {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    return 'audit-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
  }

  function _auditKey(row) {
    return String(row?.audit_id || [row?.type || '', row?.at || '', row?.user || '', JSON.stringify(_stable(row || {}))].join('\n'));
  }

  function _mergeAuditRows() {
    const merged = new Map();
    Array.from(arguments).forEach(rows => {
      (Array.isArray(rows) ? rows : []).forEach(row => {
        if (!row || typeof row !== 'object') return;
        merged.set(_auditKey(row), row);
      });
    });
    return [...merged.values()]
      .sort((a, b) => String(a?.at || '').localeCompare(String(b?.at || '')) || _auditKey(a).localeCompare(_auditKey(b)))
      .slice(-MAX_AUDIT_ROWS);
  }

  async function hmac(payload, options = {}) {
    const key = await window.MeldexOwnerKeyStore?.importHmacKey?.(options);
    if (!key) return '';
    const data = new TextEncoder().encode(stableStringify(payload));
    const sig = await crypto.subtle.sign('HMAC', key, data);
    return _bytesToHex(new Uint8Array(sig));
  }

  async function readSignature(provider, scope, options = {}) {
    const { _joinPath, _readJsonSafe } = _internals();
    if (!provider || typeof _readJsonSafe !== 'function') return null;
    const documentId = `knowledge-signature-${_normalizeScope(scope)}`;
    let managed = null;
    try {
      managed = await _managementRecord(provider, documentId, options);
    } catch {
      // 管理領域を解決・読取できない場合でも署名読取自体は失敗させない。
      // 旧パスフォールバック(下記)へ倒し、そこにも無ければ「署名なし」として
      // 検証側が安全側(書込ブロック)に判定する。
      managed = null;
    }
    if (managed && managed.record?.payload) return managed.record.payload;
    // 旧パス(_meldex/integrity)は接続中ルート配下にしか存在しない。別スコープの
    // 管理領域を明示指定された読取で接続中ルートの旧署名を混ぜると誤検証になる
    // ため、フォールバックは接続中スコープの読取に限定する。
    if (options.skipLegacyFallback) return null;
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
    await _saveManagementRecord(provider, `knowledge-signature-${entry.scope}`, () => entry, {
      managementAdapter: meta.managementAdapter || null,
    });
    return { ok: true, ...entry };
  }

  async function verify(provider, scope, payload, options = {}) {
    const signature = await readSignature(provider, scope, options);
    const key = options.rawKey || await window.MeldexOwnerKeyStore?.getRawKey?.({ create: false });
    if (!signature?.hmac) {
      return { ok: false, missing: true, missing_key: !key, reason: 'signature-missing', signature };
    }
    if (!key) {
      window.MeldexOwnerKeyRecovery?.notifyMissingOwnerKey?.('署名済みデータを検証する管理者鍵がこの端末にありません。');
      return { ok: false, missing_key: true, reason: 'owner-key-missing', signature };
    }
    const digest = await hmac(payload, { create: false, rawKey: key });
    return { ok: digest === signature.hmac, expected: signature.hmac, actual: digest, signature };
  }

  async function verifyStrict(provider, scope, payload, options = {}) {
    const result = await verify(provider, scope, payload, options);
    if (result?.ok === true && result.skipped) return { ...result, ok: false, strict: true };
    return result;
  }

  async function recordAudit(provider, type, entry = {}) {
    const { _readJsonSafe } = _internals();
    if (!provider || typeof provider.writeJson !== 'function') return { ok: false };
    const managed = await _managementRecord(provider, AUDIT_LOG_DOCUMENT_ID);
    const beforeRows = Array.isArray(managed.record?.payload?.rows)
      ? managed.record.payload.rows
      : await _readJsonSafe(provider, AUDIT_LOG_PATH, []).catch(() => []);
    const auditEntry = {
      audit_id: _auditId(),
      type: String(type || 'event'),
      at: new Date().toISOString(),
      user: typeof getUsername === 'function' ? getUsername() : '',
      ...entry,
    };
    let nextRows = [];
    await _saveManagementRecord(provider, AUDIT_LOG_DOCUMENT_ID, current => {
      const latestRows = Array.isArray(current?.rows) ? current.rows : beforeRows;
      nextRows = _mergeAuditRows(beforeRows, latestRows, [auditEntry]);
      return { version: 1, rows: nextRows, updatedAt: new Date().toISOString() };
    });
    await sign(provider, 'audit_log', nextRows, { signer: auditEntry.user }).catch(() => null);
    return { ok: true, count: nextRows.length };
  }

  async function readAudit(provider, type = '') {
    const { _readJsonSafe } = _internals();
    const managed = await _managementRecord(provider, AUDIT_LOG_DOCUMENT_ID);
    const rows = Array.isArray(managed.record?.payload?.rows)
      ? managed.record.payload.rows
      : await _readJsonSafe(provider, AUDIT_LOG_PATH, []).catch(() => []);
    const list = Array.isArray(rows) ? rows : [];
    if (list.length) {
      const verification = await verify(provider, 'audit_log', list);
      if (verification?.ok === false) throw new Error('監査ログの署名検証に失敗しました');
    }
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
