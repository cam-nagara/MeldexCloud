/* Web Clipper owner鍵の端末登録。
 * 信頼済みowner端末で一回限りQRを発行し、Dropbox個人管理領域の
 * AES-GCM暗号文を新端末が取得する。QRにowner鍵本文は含めない。 */
(function attachWebClipOwnerDeviceRegistration(global) {
  'use strict';

  const SCHEMA = 'meldex.webclip-owner-enrollment.v1';
  const DEVICE_SCHEMA = 'meldex.webclip-owner-device.v1';
  // OSへdispatch可能なcustom URIは同一schemeを登録した別アプリに横取りされ得る。
  // QRはアプリ内scannerだけが解釈する非URI payloadに固定する。
  const QR_PREFIX = 'MELDEX-WC1:';
  const TTL_MS = 5 * 60 * 1000;
  const KIND = 'webclip-owner-devices';

  function bytesToBase64Url(value) {
    let raw = '';
    new Uint8Array(value || []).forEach(byte => { raw += String.fromCharCode(byte); });
    return btoa(raw).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }

  function randomToken(size) {
    const bytes = new Uint8Array(size);
    crypto.getRandomValues(bytes);
    return bytes;
  }

  async function sha256Base64Url(value) {
    return bytesToBase64Url(await crypto.subtle.digest('SHA-256', value));
  }

  function ownerAllowed() {
    const runtime = global.MeldexRuntimeAdapter?.getWorkspaceState?.() || {};
    const role = String(runtime.access?.role || runtime.role || runtime.access || '').toLowerCase();
    return global.MeldexKnowledgeCloudStore?.role?.() === 'owner'
      || runtime.isOwner === true || role === 'owner';
  }

  function workspaceContext() {
    const runtime = global.MeldexRuntimeAdapter?.getWorkspaceState?.() || {};
    const scope = global.MeldexOwnerKeyStore?.workspaceScope?.() || {};
    const workspaceId = String(scope.id || runtime.workspaceId || runtime.workspace_id || '').trim();
    const workspaceRoot = String(
      runtime.dropboxPath || runtime.dropbox_path || runtime.workspaceDropboxPath
      || runtime.workspace_root || runtime.rootPath || runtime.path || ''
    ).trim().replace(/\\/g, '/').replace(/\/+$/g, '');
    const namespaceKind = String(runtime.namespaceKind || runtime.namespace_kind || 'home') === 'team_root'
      ? 'team_root' : 'home';
    if (!workspaceId || workspaceId === 'local-device' || !workspaceRoot) {
      throw new Error('共有ワークスペースの安定IDとDropboxパスを確認できません');
    }
    return { workspaceId, workspaceRoot, namespaceKind };
  }

  async function personalAdapter() {
    const provider = global.MeldexStorageAdapter?.getProvider?.();
    const resolver = global.MeldexDropboxManagementRootResolver;
    if (!provider || !resolver?.resolveAdapterForProvider) throw new Error('Dropboxへ接続してください');
    return resolver.resolveAdapterForProvider(provider, { personalOnly: true });
  }

  async function sharedAdapter() {
    const provider = global.MeldexStorageAdapter?.getProvider?.();
    const resolver = global.MeldexDropboxManagementRootResolver;
    if (!provider || !resolver?.resolveAdapterForProvider) throw new Error('Dropboxへ接続してください');
    const adapter = await resolver.resolveAdapterForProvider(provider);
    if (adapter?.environment !== 'dropbox-shared-workspace') {
      throw new Error('対象の共有ワークスペースを開いてください');
    }
    return adapter;
  }

  async function createEnrollment() {
    if (!ownerAllowed()) throw new Error('所有者のみ端末登録QRを発行できます');
    const rawOwnerKey = await global.MeldexOwnerKeyStore?.getRawKey?.({ create: false });
    if (!rawOwnerKey) throw new Error('この端末にowner鍵がありません');
    const workspace = workspaceContext();
    const account = await global.MeldexDropboxAuth?.getCurrentAccount?.(false);
    const accountId = String(account?.account_id || '').trim();
    if (!accountId) throw new Error('Dropbox所有者アカウントを確認できません');
    const id = bytesToBase64Url(randomToken(18));
    const secret = randomToken(32);
    const iv = randomToken(12);
    const expiresAt = new Date(Date.now() + TTL_MS).toISOString();
    const aesKey = await crypto.subtle.importKey('raw', secret, 'AES-GCM', false, ['encrypt']);
    const plaintext = new TextEncoder().encode(JSON.stringify({
      schema: SCHEMA,
      workspace_id: workspace.workspaceId,
      workspace_root: workspace.workspaceRoot,
      namespace_kind: workspace.namespaceKind,
      owner_account_id: accountId,
      owner_key: rawOwnerKey,
    }));
    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(id) }, aesKey, plaintext
    );
    const payload = {
      schema: SCHEMA,
      enrollment_id: id,
      workspace_id: workspace.workspaceId,
      state: 'issued',
      issued_at: new Date().toISOString(),
      expires_at: expiresAt,
      token_hash: await sha256Base64Url(secret),
      cipher: { name: 'AES-GCM', iv: bytesToBase64Url(iv), ciphertext: bytesToBase64Url(ciphertext) },
    };
    const adapter = await personalAdapter();
    await adapter.save(KIND, `enrollment-${id}`, payload, { expectedRevision: null });
    const qrPayload = `${QR_PREFIX}${id}:${bytesToBase64Url(secret)}`;
    return Object.freeze({ id, qrPayload, expiresAt, qrSvg: qrSvg(qrPayload) });
  }

  function deviceSignatureText(device) {
    return [DEVICE_SCHEMA, device.device_id, device.workspace_id, device.owner_account_id,
      device.registered_at, device.status, device.revoked_at || ''].map(value => String(value || '')).join('|');
  }

  async function signDevice(device) {
    const key = await global.MeldexOwnerKeyStore.importHmacKey({ create: false });
    if (!key) throw new Error('owner鍵を確認できません');
    const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(deviceSignatureText(device)));
    return bytesToBase64Url(signature);
  }

  async function listDevices() {
    if (!ownerAllowed()) throw new Error('所有者のみ登録端末を確認できます');
    const records = await (await sharedAdapter()).listDocuments(KIND);
    return records.filter(record => record.payload?.schema === DEVICE_SCHEMA)
      .sort((a, b) => String(b.payload.registered_at || '').localeCompare(String(a.payload.registered_at || '')));
  }

  async function revokeDevice(deviceId) {
    if (!ownerAllowed()) throw new Error('所有者のみ端末を失効できます');
    const id = String(deviceId || '').trim();
    if (!/^[A-Za-z0-9_-]{12,100}$/.test(id)) throw new Error('端末IDが不正です');
    const adapter = await sharedAdapter();
    const documentId = `device-${id}`;
    const current = await adapter.load(KIND, documentId);
    if (!current || current.payload?.schema !== DEVICE_SCHEMA) throw new Error('登録端末が見つかりません');
    if (current.payload.status === 'revoked') return current;
    const next = { ...current.payload, status: 'revoked', revoked_at: new Date().toISOString() };
    next.signature = await signDevice(next);
    return adapter.save(KIND, documentId, next, { expectedRevision: current.revision });
  }

  async function revokeActiveDevicesBeforeOwnerKeyRotation() {
    if (!ownerAllowed()) throw new Error('所有者のみ端末を失効できます');
    let workspace;
    try {
      workspace = workspaceContext();
    } catch (error) {
      // A local-only owner key has no shared device ledger.  Rotation remains
      // available there, but a malformed shared context must still fail closed.
      const scope = global.MeldexOwnerKeyStore?.workspaceScope?.() || {};
      const scopeId = String(scope.id || '').trim();
      if (!scopeId || scopeId === 'local-device') {
        return { revoked: 0, skipped: 'local-device' };
      }
      throw error;
    }
    // Device records are authenticated with the old owner key.  A rotation
    // must not strand an active record that can no longer be revoked.
    const adapter = await sharedAdapter();
    const records = await adapter.listDocuments(KIND);
    const active = records.filter(record => record.payload?.schema === DEVICE_SCHEMA
      && record.payload?.workspace_id === workspace.workspaceId
      && record.payload?.status === 'active');
    for (const record of active) {
      const deviceId = String(record.payload?.device_id || '').trim();
      if (!deviceId) throw new Error('登録端末の識別子を確認できません');
      const documentId = `device-${deviceId}`;
      const next = {
        ...record.payload,
        status: 'revoked',
        revoked_at: new Date().toISOString(),
        revoke_reason: 'owner-key-rotation',
      };
      next.signature = await signDevice(next);
      await adapter.save(KIND, documentId, next, { expectedRevision: record.revision });
    }
    const remaining = (await adapter.listDocuments(KIND)).filter(record => record.payload?.schema === DEVICE_SCHEMA
      && record.payload?.workspace_id === workspace.workspaceId
      && record.payload?.status === 'active');
    if (remaining.length) throw new Error('登録端末をすべて失効できないため鍵ローテーションを中止しました');
    return { revoked: active.length };
  }

  // QR Code Model 2 / Version 5-L / byte mode。外部QRサービスへsecretを送信しない。
  function qrSvg(text) {
    const bytes = new TextEncoder().encode(String(text || ''));
    if (bytes.length > 106) throw new Error('端末登録QRの容量を超えました');
    const bits = [];
    const pushBits = (value, length) => { for (let i = length - 1; i >= 0; i -= 1) bits.push((value >>> i) & 1); };
    pushBits(4, 4); pushBits(bytes.length, 8); bytes.forEach(byte => pushBits(byte, 8));
    for (let i = 0; i < Math.min(4, 108 * 8 - bits.length); i += 1) bits.push(0);
    while (bits.length % 8) bits.push(0);
    const data = [];
    for (let i = 0; i < bits.length; i += 8) data.push(parseInt(bits.slice(i, i + 8).join(''), 2));
    let pad = 0; while (data.length < 108) data.push(pad++ % 2 ? 0x11 : 0xec);
    const exp = new Array(512); const log = new Array(256); let x = 1;
    for (let i = 0; i < 255; i += 1) { exp[i] = x; log[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; }
    for (let i = 255; i < 512; i += 1) exp[i] = exp[i - 255];
    let generator = [1];
    for (let degree = 0; degree < 26; degree += 1) {
      const next = new Array(generator.length + 1).fill(0);
      generator.forEach((coef, index) => {
        next[index] ^= coef;
        next[index + 1] ^= coef ? exp[log[coef] + degree] : 0;
      });
      generator = next;
    }
    const ecc = new Array(26).fill(0);
    data.forEach(value => {
      const factor = value ^ ecc.shift(); ecc.push(0);
      if (factor) generator.slice(1).forEach((coef, i) => { ecc[i] ^= exp[log[factor] + log[coef]]; });
    });
    const streamBits = [];
    data.concat(ecc).forEach(byte => { for (let i = 7; i >= 0; i -= 1) streamBits.push((byte >>> i) & 1); });
    const size = 37; const modules = Array.from({ length: size }, () => new Array(size).fill(null));
    const finder = (row, col) => {
      for (let r = -1; r <= 7; r += 1) for (let c = -1; c <= 7; c += 1) {
        if (row + r < 0 || row + r >= size || col + c < 0 || col + c >= size) continue;
        modules[row + r][col + c] = r >= 0 && r <= 6 && c >= 0 && c <= 6
          && (r === 0 || r === 6 || c === 0 || c === 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4));
      }
    };
    finder(0, 0); finder(size - 7, 0); finder(0, size - 7);
    for (let i = 8; i < size - 8; i += 1) {
      if (modules[i][6] === null) modules[i][6] = i % 2 === 0;
      if (modules[6][i] === null) modules[6][i] = i % 2 === 0;
    }
    for (let r = -2; r <= 2; r += 1) for (let c = -2; c <= 2; c += 1) {
      modules[30 + r][30 + c] = Math.max(Math.abs(r), Math.abs(c)) === 2 || (r === 0 && c === 0);
    }
    const bch = value => { let d = value << 10; const msb = n => 31 - Math.clz32(n); while (msb(d) >= 10) d ^= 0x537 << (msb(d) - 10); return ((value << 10) | d) ^ 0x5412; };
    const format = bch(1 << 3); // L(01), mask 0
    for (let i = 0; i < 15; i += 1) {
      const bit = ((format >> i) & 1) === 1;
      if (i < 6) modules[i][8] = bit; else if (i < 8) modules[i + 1][8] = bit; else modules[size - 15 + i][8] = bit;
      if (i < 8) modules[8][size - i - 1] = bit; else if (i === 8) modules[8][7] = bit; else modules[8][15 - i - 1] = bit;
    }
    modules[size - 8][8] = true;
    let index = 0; let upwards = true;
    for (let col = size - 1; col > 0; col -= 2) {
      if (col === 6) col -= 1;
      for (let offset = 0; offset < size; offset += 1) {
        const row = upwards ? size - 1 - offset : offset;
        for (let side = 0; side < 2; side += 1) {
          const currentCol = col - side;
          if (modules[row][currentCol] !== null) continue;
          const value = index < streamBits.length ? streamBits[index++] === 1 : false;
          modules[row][currentCol] = value !== ((row + currentCol) % 2 === 0);
        }
      }
      upwards = !upwards;
    }
    const quiet = 4; const dimension = size + quiet * 2; let path = '';
    modules.forEach((row, y) => row.forEach((dark, xPos) => { if (dark) path += `M${xPos + quiet} ${y + quiet}h1v1h-1z`; }));
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${dimension} ${dimension}" role="img" aria-label="Web Clipper owner端末登録QR" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/><path d="${path}" fill="#000"/></svg>`;
  }

  global.MeldexWebClipOwnerDeviceRegistration = Object.freeze({
    SCHEMA, DEVICE_SCHEMA, QR_PREFIX, createEnrollment, listDevices, revokeDevice,
    revokeActiveDevicesBeforeOwnerKeyRotation, deviceSignatureText, qrSvg,
  });
})(window);
