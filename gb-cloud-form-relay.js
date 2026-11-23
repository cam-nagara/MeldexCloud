/* 公開フォーム クラウド中継アダプタの共通入口 */

const MeldexCloudFormRelay = (() => {
  const adapters = new Map();

  function register(name, adapter) {
    if (!name || !adapter) return;
    adapters.set(name, adapter);
  }

  function get(name) {
    return adapters.get(name) || null;
  }

  async function submit(name, payload, options) {
    const adapter = get(name);
    if (!adapter || typeof adapter.submit !== 'function') {
      throw new Error('クラウド中継アダプタが未設定です: ' + name);
    }
    return adapter.submit(payload, options || {});
  }

  const MAX_BYTES = 12 * 1024 * 1024;
  const encode = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes)));
  function decode(value) {
    if (typeof value !== 'string' || value.length > MAX_BYTES * 2) throw new Error('回答の形式・容量が不正です');
    return Uint8Array.from(atob(value), character => character.charCodeAt(0));
  }
  const randomId = () => crypto.randomUUID().replace(/-/g, '');
  const validId = value => typeof value === 'string' && /^[a-f0-9]{32}$/.test(value);
  async function generation(sourceId, token) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([sourceId || '', token || ''])));
    return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
  }
  async function receiptFingerprint(cfg, fields) {
    const values = Object.entries(fields).sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
    const bytes = new TextEncoder().encode(JSON.stringify([cfg.form_source_id || '', cfg.form_submit_token || '', values]));
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
  }
  async function normalizeImages(fields, types, save) {
    const result = { ...fields };
    for (const [name, value] of Object.entries(fields)) {
      if (types[name]?.type !== 'image' || !value.trim()) continue;
      const images = JSON.parse(value);
      if (!Array.isArray(images) || images.length > 100) throw new Error('画像の形式・個数が不正です');
      const output = [];
      for (const image of images) {
        if (!/^data:image\/(png|jpeg|gif|webp);base64,/.test(image?.data_url || '')) throw new Error('回答画像の形式が不正です');
        const bytes = decode(image.data_url.split(',')[1]);
        const ext = window.MeldexSheetAttachments.detectContentExt(bytes, image.filename || '', image.type || '');
        const digest = await crypto.subtle.digest('SHA-256', bytes);
        const hash = [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
        const path = await save(bytes, ext, hash);
        output.push({ path, src: path, url: path, thumb: path, thumb_url: path,
          kind: 'image', hash, content_hash: hash, filename: String(image.filename || ('画像.' + ext)), size: bytes.length });
      }
      result[name] = JSON.stringify(output);
    }
    return result;
  }
  async function withReceipt(cfg, id, fields, io, task) {
    if (!cfg.receipt_store?.path) return task();
    const path = cfg.receipt_store.path.replace(/\/$/, '') + '/' + id + '.json';
    const fingerprint = await receiptFingerprint(cfg, fields);
    const previous = await io.read(path);
    if (previous) {
      const saved = JSON.parse(previous.content);
      if (saved.fileType !== 'meldex-form-receipt' || saved.schema_version !== 1 || saved.submission_id !== id || saved.fingerprint !== fingerprint)
        throw Object.assign(new Error('回答の処理済み記録が一致しません'), { status: 409 });
      if (saved.state === 'applied') return { ok: true, replayed: true };
    }
    const result = await task();
    await io.write(path, JSON.stringify({ fileType: 'meldex-form-receipt', schema_version: 1,
      submission_id: id, fingerprint, state: 'applied' }), previous?.etag || null);
    return result;
  }
  async function createChannel() {
    const pair = await crypto.subtle.generateKey({ name: 'RSA-OAEP', modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['encrypt', 'decrypt']);
    return { id: randomId(), publicKey: await crypto.subtle.exportKey('jwk', pair.publicKey),
      privateKey: await crypto.subtle.exportKey('jwk', pair.privateKey) };
  }
  async function encrypt(channel, payload, submissionId = randomId()) {
    if (!validId(channel.id) || !validId(submissionId)) throw new Error('受付番号が不正です');
    const bytes = new TextEncoder().encode(JSON.stringify(payload));
    if (bytes.length > MAX_BYTES) throw new Error('回答の容量が上限を超えています');
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
    const publicKey = await crypto.subtle.importKey('jwk', channel.publicKey,
      { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['encrypt']);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const epoch = await generation(payload.form_source_id, payload.token);
    const aad = new TextEncoder().encode(channel.id + ':' + submissionId + ':' + epoch);
    const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad }, key, bytes));
    // Encode in chunks: spreading a multi-megabyte image exhausts the JS stack.
    let binary = '';
    for (let offset = 0; offset < ciphertext.length; offset += 16384)
      binary += String.fromCharCode(...ciphertext.subarray(offset, offset + 16384));
    return { version: 1, channel_id: channel.id, submission_id: submissionId, generation: epoch,
      wrapped_key: encode(await crypto.subtle.encrypt('RSA-OAEP', publicKey, await crypto.subtle.exportKey('raw', key))),
      iv: encode(iv), ciphertext: btoa(binary) };
  }
  function validateEnvelope(envelope) {
    if (envelope?.version !== 1 || !validId(envelope.channel_id) || !validId(envelope.submission_id)
      || envelope.generation !== undefined && !/^[a-f0-9]{64}$/.test(envelope.generation)
      || typeof envelope.ciphertext !== 'string' || envelope.ciphertext.length > MAX_BYTES * 1.4
      || typeof envelope.wrapped_key !== 'string' || envelope.wrapped_key.length > 1024
      || typeof envelope.iv !== 'string' || envelope.iv.length !== 16) throw new Error('回答の形式・容量が不正です');
    return envelope;
  }
  async function decrypt(channel, envelope) {
    validateEnvelope(envelope);
    if (envelope.channel_id !== channel.id) throw new Error('受付先が異なります');
    const privateKey = await crypto.subtle.importKey('jwk', channel.privateKey,
      { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['decrypt']);
    const raw = await crypto.subtle.decrypt('RSA-OAEP', privateKey, decode(envelope.wrapped_key));
    const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['decrypt']);
    const aad = new TextEncoder().encode(channel.id + ':' + envelope.submission_id + (envelope.generation ? ':' + envelope.generation : ''));
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: decode(envelope.iv), additionalData: aad }, key, decode(envelope.ciphertext));
    return JSON.parse(new TextDecoder().decode(plain));
  }
  function queuePath(artifactPath, channelId, submissionId) {
    const path = String(artifactPath || '').replace(/\\/g, '/');
    if (!path.endsWith('.html') || path.split('/').some(part => part === '..' || part === '.')
      || !validId(channelId) || submissionId && !validId(submissionId)) throw new Error('公開ファイルの場所が不正です');
    const parent = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) + '/' : '';
    return parent + '_meldex-form-responses/' + channelId + (submissionId ? '/' + submissionId + '.json' : '');
  }
  function publicationConfig(content) {
    const match = String(content || '').match(/<script\b[^>]*\bid=["']meldex-publish-cfg["'][^>]*>([\s\S]*?)<\/script>/i);
    if (!match) throw new Error('公開フォームの設定がありません');
    return JSON.parse(match[1]);
  }
  async function resolveArtifactPath(artifactPath, folderId, io) {
    if (!folderId) return artifactPath; // Existing publications keep their original path contract.
    if (!/^id:[A-Za-z0-9_-]+$/.test(folderId) || typeof io.resolveFolder !== 'function') throw new Error('共有先の識別番号を確認できません');
    const slash = artifactPath.lastIndexOf('/');
    const folder = await io.resolveFolder(folderId, slash < 0 ? '' : artifactPath.slice(0, slash));
    return (folder ? folder.replace(/\/$/, '') + '/' : '') + artifactPath.slice(slash + 1);
  }
  async function accept({ artifactPath, artifactFolderId, envelope }, io) {
    validateEnvelope(envelope);
    artifactPath = await resolveArtifactPath(artifactPath, artifactFolderId, io);
    const published = publicationConfig((await io.read(artifactPath)).content);
    if (!published.form_submit_enabled || published.intake?.channel_id !== envelope.channel_id
      || published.intake?.generation && published.intake.generation !== envelope.generation)
      throw new Error('このフォームは受付停止中です');
    const path = queuePath(artifactPath, envelope.channel_id, envelope.submission_id);
    const content = JSON.stringify(envelope);
    try { await io.write(path, content); }
    catch (error) {
      if (error.status !== 409 || (await io.read(path)).content !== content) throw error;
    }
    return { ok: true, queued: true, submission_id: envelope.submission_id };
  }
  async function drain(binding, io) {
    const result = { imported: 0, blocked: 0, failed: 0 };
    const prefix = queuePath(binding.artifactPath, binding.channel.id);
    const files = await io.list(prefix);
    const candidates = files.filter(file => {
      const path = file.path || '', id = path.slice(path.lastIndexOf('/') + 1).replace(/\.json$/, '');
      return validId(id) && path === prefix + '/' + id + '.json' && !io.hasReceipt(id);
    }).sort((a, b) => a.path.localeCompare(b.path));
    const cursor = io.cursor?.() || '';
    const next = candidates.findIndex(file => file.path > cursor);
    const start = next < 0 ? 0 : next;
    let remaining = 100;
    for (let offset = 0; offset < candidates.length && remaining-- > 0; offset++) {
      const file = candidates[(start + offset) % candidates.length];
      const path = file.path || '';
      const id = path.slice(path.lastIndexOf('/') + 1).replace(/\.json$/, '');
      io.advance?.(path);
      try {
        const envelope = JSON.parse((await io.read(path)).content);
        if (envelope.submission_id !== id) throw new Error('受付番号が異なります');
        const response = await decrypt(binding.channel, envelope);
        if (!binding.token || response.token !== binding.token || response.form_source_id !== binding.sourceId) { result.blocked++; continue; }
        await io.import({ ...response, source_path: binding.sourcePath, submission_id: id });
        io.receipt(id); result.imported++;
      } catch (error) { result.failed++; io.onError?.(error, path); }
    }
    return result;
  }
  function appIo(channelId) {
    const key = 'meldex-form-receipts:' + channelId;
    return {
      read: path => apiFetch('/file?path=' + encodeURIComponent(path), { silentError: true }),
      write: (path, content) => apiPut('/file?path=' + encodeURIComponent(path), { content, create_only: true }),
      list: async path => {
        try {
          const items = await apiFetch('/browse?path=' + encodeURIComponent(path) + '&all_files=true', { silentError: true });
          return Array.isArray(items) ? items : items.items || [];
        } catch (error) { if (error.status === 404) return []; throw error; }
      },
      import: body => apiPost('/form-publication/import', body),
      resolveFolder: async (id, hint) => (await apiFetch('/file-path?id=' + encodeURIComponent(id) + '&hint=' + encodeURIComponent(hint), { silentError: true })).path,
      hasReceipt: id => localStorage.getItem(key + ':' + id) === '1',
      receipt: id => localStorage.setItem(key + ':' + id, '1'),
      cursor: () => localStorage.getItem(key + ':cursor') || '',
      advance: path => { try { localStorage.setItem(key + ':cursor', path); } catch (_) { /* Import remains idempotent without a cursor. */ } },
    };
  }
  async function drainApp(app) {
    const store = app.store, sourcePath = app.path, cfg = store?.doc.publish;
    if (app._formIntakeBusy || !cfg?.form_submit_enabled || !cfg.intake_channel || !cfg.html_vault_path) return null;
    app._formIntakeBusy = true;
    try {
      if (!app.store.doc.sheet.id && !globalThis.MeldexExportSave?.isBrowserDataContext?.()) {
        if (app.store.dirty || app.store.pending) return null;
        const prepared = await apiPost('/form-publication/prepare', { path: app.path });
        if (app.store !== store || app.path !== sourcePath || app.store.doc.publish !== cfg) return null;
        app._update(doc => { doc.sheet.id = prepared.sheet_id; doc.sheet.path = prepared.sheet_path; }, { history: false });
        if (!await app.flush()) throw new Error('回答先の識別番号を保存できません');
      }
      return await drain({ sourcePath, artifactPath: cfg.html_vault_path, channel: cfg.intake_channel,
        token: cfg.form_submit_token, sourceId: cfg.form_source_id }, appIo(cfg.intake_channel.id));
    } finally { app._formIntakeBusy = false; }
  }
  function openIntake(intake) {
    const url = new URL(intake.cloud_url);
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname)))
      throw new Error('回答受付にはHTTPSのCloud URLを指定してください');
    const nonce = randomId(); url.hash = 'meldex-form-intake=' + nonce;
    const popup = window.open(url.href, '_blank');
    if (!popup) throw new Error('Cloudの回答受付画面を開けません。ポップアップを許可して再送してください');
    return { popup, nonce, origin: url.origin };
  }
  async function submitViaCloud(intake, payload, opened) {
    const target = opened || openIntake(intake);
    const payloadKey = JSON.stringify([intake.channel_id, payload]);
    if (submitViaCloud.pending?.key !== payloadKey) submitViaCloud.pending = {
      key: payloadKey, envelope: await encrypt({ id: intake.channel_id, publicKey: intake.public_key }, payload, payload.submission_id || randomId()) };
    const envelope = submitViaCloud.pending.envelope;
    return new Promise((resolve, reject) => {
      const finish = (error, value) => {
        clearInterval(timer); clearTimeout(timeout); window.removeEventListener('message', receive);
        error ? reject(error) : resolve(value);
      };
      const receive = event => {
        if (event.source !== target.popup || event.origin !== target.origin || event.data?.nonce !== target.nonce
          || event.data?.type !== 'meldex-form-intake-result') return;
        if (event.data.ok) { submitViaCloud.pending = null; finish(null, event.data); }
        else finish(new Error(event.data.error || '回答を保存できませんでした'));
      };
      const send = () => {
        if (target.popup.closed) { finish(new Error('受付画面が閉じられました。入力は残っています')); return; }
        target.popup.postMessage({ type: 'meldex-form-intake', nonce: target.nonce, artifactPath: intake.artifact_path, artifactFolderId: intake.folder_id || '', envelope }, target.origin);
      };
      const timer = setInterval(send, 500), timeout = setTimeout(() => finish(new Error('受付を確認できません。Cloudへのログイン後に再送してください')), 300000);
      window.addEventListener('message', receive); send();
    });
  }
  function installIntakeBridge() {
    const nonce = location.hash.match(/^#meldex-form-intake=([a-f0-9]{32})$/)?.[1];
    if (!nonce || !window.opener) return;
    let busy = false, completed = null;
    window.addEventListener('message', async event => {
      if (event.source !== window.opener || event.data?.type !== 'meldex-form-intake' || event.data.nonce !== nonce) return;
      const reply = result => event.source.postMessage({ type: 'meldex-form-intake-result', nonce, ...result }, event.origin === 'null' ? '*' : event.origin);
      if (completed) { reply(completed); return; }
      if (busy || !window.GBUI?.createModal || typeof apiFetch !== 'function') return;
      busy = true;
      try {
        const io = appIo(event.data.envelope?.channel_id);
        const request = { ...event.data, artifactPath: await resolveArtifactPath(event.data.artifactPath, event.data.artifactFolderId, io), artifactFolderId: '' };
        const content = (await io.read(request.artifactPath)).content;
        const cfg = publicationConfig(content);
        if (!cfg.form_submit_enabled || cfg.intake?.channel_id !== event.data.envelope?.channel_id
          || cfg.intake?.generation && cfg.intake.generation !== event.data.envelope?.generation) throw new Error('受付が停止・変更されています');
        const body = document.createElement('p');
        body.textContent = '「' + (cfg.title || '公開フォーム') + '」の回答を、ログイン中のDropboxから送信します。回答は作成者だけが読める形で保存されます。';
        const status = document.createElement('p'); status.setAttribute('role', 'status');
        const wrapper = document.createElement('div'); wrapper.append(body, status);
        const send = document.createElement('button'); send.className = 'gb-btn gb-btn-primary'; send.textContent = '回答を送信'; send.dataset.e2eId = 'form-intake-send';
        let saving = false;
        const modal = GBUI.createModal({ id: 'form-intake', title: '回答の送信', body: wrapper, footer: send,
          onBeforeClose: () => !saving, onClose: () => { if (!completed) { reply({ ok: false, error: '送信を取り消しました' }); busy = false; } } });
        send.addEventListener('click', async () => {
          if (saving) return; saving = true; send.disabled = true;
          try {
            completed = await accept(request, io); reply(completed);
            status.textContent = '回答を受け付けました。この画面を閉じられます。';
          } catch (error) { status.textContent = '保存できません: ' + (error.userMessage || error.message) + '。ログイン・共有権限を確認して再試行してください。'; }
          finally { saving = false; send.disabled = !!completed; }
        });
        modal.open();
      } catch (error) { reply({ ok: false, error: error.userMessage || error.message }); busy = false; }
    });
  }
  function publicRuntimeSource() {
    return 'const MeldexCloudFormRelay=(()=>{const MAX_BYTES=' + MAX_BYTES + ';'
      + 'const encode=' + encode.toString() + ';const randomId=' + randomId.toString() + ';const validId=' + validId.toString() + ';'
      + generation.toString() + encrypt.toString() + openIntake.toString() + submitViaCloud.toString()
      + ';return {openIntake,submitViaCloud};})();';
  }
  if (typeof window !== 'undefined' && typeof location !== 'undefined') installIntakeBridge();
  return { register, get, submit, createChannel, encrypt, decrypt, queuePath, publicationConfig, accept, drain,
    appIo, drainApp, openIntake, submitViaCloud, publicRuntimeSource, generation, receiptFingerprint, withReceipt, normalizeImages, MAX_BYTES };
})();
if (typeof window !== 'undefined') window.MeldexCloudFormRelay = MeldexCloudFormRelay;
if (typeof module === 'object' && module.exports) module.exports = MeldexCloudFormRelay;
