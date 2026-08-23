/* Google data import for the static Cloud surface. Secrets stay in IndexedDB. */
(function () {
  'use strict';

  const internals = window.__MeldexPwaDataAccessInternals;
  const CONFIG_KEY = 'meldex-google-import-cloud-config-v1';
  const RUNTIME_KEY = 'meldex-google-import-cloud-runtime-v1';
  const TOKEN_KEY = 'google-import';
  const DRIVE = 'https://www.googleapis.com/drive/v3';
  const SHEETS = 'https://sheets.googleapis.com/v4';
  const FORMS = 'https://forms.googleapis.com/v1/forms';
  const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me';
  const PEOPLE = 'https://people.googleapis.com/v1/people/me/connections';
  const MIME = Object.freeze({
    docs: 'application/vnd.google-apps.document', sheets: 'application/vnd.google-apps.spreadsheet',
    slides: 'application/vnd.google-apps.presentation', forms: 'application/vnd.google-apps.form',
  });
  const SCOPES = Object.freeze({
    docs: 'https://www.googleapis.com/auth/drive.readonly',
    sheets: 'https://www.googleapis.com/auth/drive.readonly',
    slides: 'https://www.googleapis.com/auth/drive.readonly',
    forms: 'https://www.googleapis.com/auth/forms.body.readonly https://www.googleapis.com/auth/forms.responses.readonly',
    gmail: 'https://www.googleapis.com/auth/gmail.readonly',
    contacts: 'https://www.googleapis.com/auth/contacts.readonly',
  });

  function defaults() {
    return {
      destination: { path: '', name: '現在のソースフォルダ' },
      targets: { docs: true, sheets: true, slides: false, forms: false, gmail: false, contacts: false, takeout: false },
      options: { shared_items: false, shared_drive_ids: [], original_snapshots: false, gmail_labels: [], gmail_after: '' },
      schedule: { type: 'off' }, run_state: { status: 'never', last_started_at: '', last_finished_at: '', last_result: null },
    };
  }
  function readLocal(key, fallback) { try { return JSON.parse(localStorage.getItem(key) || '') || fallback; } catch { return fallback; } }
  function writeLocal(key, value) { localStorage.setItem(key, JSON.stringify(value)); }
  function config() {
    const raw = readLocal(CONFIG_KEY, {}); const base = defaults();
    return { ...base, ...raw, destination: { ...base.destination, ...(raw.destination || {}) }, targets: { ...base.targets, ...(raw.targets || {}) }, options: { ...base.options, ...(raw.options || {}) }, schedule: { ...base.schedule, ...(raw.schedule || {}) }, run_state: { ...base.run_state, ...(raw.run_state || {}) } };
  }
  function runtime() { const value = readLocal(RUNTIME_KEY, {}); return { driveTokens: { ...(value.driveTokens || {}), ...(value.driveToken ? { user: value.driveToken } : {}) }, gmailHistoryId: String(value.gmailHistoryId || ''), contactsSyncToken: String(value.contactsSyncToken || ''), items: { ...(value.items || {}) } }; }
  function clientId() { return String(globalThis.MELDEX_GOOGLE_IMPORT_CLIENT_ID || document.querySelector('meta[name="meldex-google-import-client-id"]')?.content || '').trim(); }
  function tokenStore() { const store = window.MeldexCalOAuthTokenStore; if (!store) throw Object.assign(new Error('OAuth秘密情報の端末保護ストアを利用できません'), { status: 503 }); return store; }
  function canManage() { const state = window.MeldexRuntimeAdapter?.getWorkspaceState?.() || {}; const role = String(state.access?.role || state.access || state.role || '').toLowerCase(); return state.isOwner === true || role === 'owner' || role === 'admin' || !role; }
  async function provider(mode) { if (!internals?._requirePwaProvider) throw new Error('Cloudストレージを利用できません'); return internals._requirePwaProvider(mode || 'read'); }
  function safe(value, fallback) { return String(value || '').replace(/[<>:"\\|?*\u0000-\u001f/]/g, '_').replace(/[. ]+$/g, '').slice(0, 100) || fallback; }
  function join() { return Array.from(arguments).map(v => String(v || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')).filter(Boolean).join('/'); }
  function frontmatter(fm, body) { if (window.MeldexCloudFrontmatterLite?.frontmatterText) return window.MeldexCloudFrontmatterLite.frontmatterText(fm, body || ''); return `---\n${Object.entries(fm).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join('\n')}\n---\n${body || ''}`; }

  async function secrets() { return (await tokenStore().getSecrets(TOKEN_KEY)) || {}; }
  async function saveSecrets(value) { const result = await tokenStore().setSecrets(TOKEN_KEY, value); if (!result?.ok) throw new Error('OAuth秘密情報を保存できません'); }
  async function accessToken(force) {
    const current = await secrets();
    if (!force && current.access_token && Number(current.expires_at || 0) > Date.now() + 60000) return current.access_token;
    if (!current.refresh_token) throw Object.assign(new Error('Googleへ再接続してください'), { status: 401 });
    const refreshed = await window.MeldexCalOAuthBrowser.google.refreshToken({ refreshToken: current.refresh_token, clientId: current.client_id });
    const next = { ...current, ...refreshed, refresh_token: refreshed.refresh_token || current.refresh_token, expires_at: Date.now() + Math.max(60, Number(refreshed.expires_in || 3600)) * 1000 };
    await saveSecrets(next); return next.access_token;
  }
  async function request(url, options = {}, retry = 0) {
    const headers = { Accept: 'application/json', ...(options.headers || {}), Authorization: 'Bearer ' + await accessToken(false) };
    const response = await fetch(url, { ...options, headers });
    if (response.status === 401 && retry === 0) { await accessToken(true); return request(url, options, 1); }
    if ((response.status === 429 || response.status >= 500) && retry < 3) { await new Promise(resolve => setTimeout(resolve, 250 * (2 ** retry))); return request(url, options, retry + 1); }
    if (!response.ok) { const detail = await response.json().catch(() => null); const error = new Error(detail?.error?.message || `Google APIエラー(${response.status})`); error.status = response.status; throw error; }
    return response;
  }
  async function json(url, options) { return (await request(url, options)).json(); }
  async function pages(url, key, params) { const rows = []; let pageToken = ''; do { const q = new URLSearchParams({ ...(params || {}), ...(pageToken ? { pageToken } : {}) }); const data = await json(url + '?' + q); rows.push(...(Array.isArray(data[key]) ? data[key] : [])); pageToken = String(data.nextPageToken || ''); } while (pageToken); return rows; }

  function selectedScopes(cfg) { return Array.from(new Set(Object.keys(cfg.targets).filter(key => cfg.targets[key] && SCOPES[key]).map(key => SCOPES[key]))).join(' '); }
  async function authorize() {
    if (!canManage()) throw Object.assign(new Error('Google連携を設定できるのは管理者のみです'), { status: 403 });
    const id = clientId(); if (!id) throw new Error('Google OAuthの実行時設定がありません');
    const popup = window.MeldexCalOAuthBrowser.openBlankPopup('Google');
    const { token } = await window.MeldexCalOAuthBrowser.google.authorize({ clientId: id, scope: selectedScopes(config()), popup });
    const old = await secrets(); await saveSecrets({ client_id: id, access_token: token.access_token, refresh_token: token.refresh_token || old.refresh_token || '', expires_at: Date.now() + Number(token.expires_in || 3600) * 1000, scope: token.scope || '' });
    return getPayload();
  }
  async function disconnect() { await tokenStore().deleteSecrets(TOKEN_KEY); return getPayload(); }

  async function getPayload() {
    const cfg = config(); const secret = await secrets().catch(() => ({})); const id = clientId();
    const reasons = []; if (!id) reasons.push('Google OAuthの実行時設定がありません'); if (!globalThis.crypto?.subtle || !globalThis.indexedDB) reasons.push('端末保護ストアを利用できません');
    return { config: cfg, connection: { connected: !!(secret.access_token || secret.refresh_token) }, capabilities: { surface: 'cloud', can_connect: !reasons.length, can_import: !reasons.length, phase: 6, reason: reasons.join('。') }, source_folders: [{ path: '', name: '現在のソースフォルダ' }] };
  }
  async function patchConfig(patch) { if (!canManage()) throw Object.assign(new Error('設定を変更できるのは管理者のみです'), { status: 403 }); const current = config(); const next = { ...current, ...(patch || {}), destination: { ...current.destination, ...(patch?.destination || {}) }, targets: { ...current.targets, ...(patch?.targets || {}) }, options: { ...current.options, ...(patch?.options || {}) }, schedule: { ...current.schedule, ...(patch?.schedule || {}) } }; writeLocal(CONFIG_KEY, next); return getPayload(); }
  async function listSharedDrives() { return pages(`${DRIVE}/drives`, 'drives', { pageSize: '100', fields: 'nextPageToken,drives(id,name)' }); }

  async function ensureDir(store, path) { if (store.ensureDirectory) await store.ensureDirectory(path); else if (store.mkdir) await store.mkdir(path).catch(() => {}); }
  async function textHash(value) {
    const bytes = new TextEncoder().encode(String(value || ''));
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, '0')).join('');
  }
  async function readImportState(store, path) {
    try { return JSON.parse(await store.readText(path)) || {}; } catch { return {}; }
  }
  async function writeImportState(store, path, value) {
    await store.writeText(path, JSON.stringify(value, null, 2) + '\n');
  }
  async function writeExport(store, path, url) {
    if (!store.overwriteBytes) throw new Error('このCloudストレージはバイナリの保存に対応していません');
    const response = await request(url, { headers: { Accept: 'application/octet-stream' } });
    const declaredSize = Number(response.headers.get('content-length') || 0);
    if (declaredSize > 10 * 1024 * 1024) throw new Error('Google書き出しの上限（10MB）を超えています');
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > 10 * 1024 * 1024) throw new Error('Google書き出しの上限（10MB）を超えています');
    await store.overwriteBytes(path, bytes);
    return path;
  }
  async function writeManagedNote(store, root, kind, row, markdown) {
    const dir = join(root, kind); await ensureDir(store, dir); const path = join(dir, `${safe(row.name, 'Googleデータ')}_${String(row.id).slice(0, 12)}.md`);
    let old = ''; try { old = await store.readText(path); } catch {}
    const managed = `<!-- meldex-import:start source=google id=${row.id} -->\n${markdown}\n<!-- meldex-import:end -->`;
    const body = /<!-- meldex-import:start[\s\S]*?<!-- meldex-import:end -->/.test(old) ? old.replace(/<!-- meldex-import:start[\s\S]*?<!-- meldex-import:end -->/, managed) : `# ${row.name}\n\n${managed}\n\n## メモ\n`;
    await store.writeText(path, frontmatter({ type: 'imported-note', source: kind, external_id: row.id, external_updated_at: row.modifiedTime || '', external_status: 'available' }, body.replace(/^---[\s\S]*?---\s*/, ''))); return path;
  }
  function cellInfo(cell) {
    const effective = cell.effectiveValue || {}, format = String(cell.effectiveFormat?.numberFormat?.type || '').toUpperCase();
    let value = '', type = 'empty';
    if ('numberValue' in effective) { value = effective.numberValue; type = /DATE|TIME/.test(format) ? 'date' : 'number'; }
    else if ('boolValue' in effective) { value = !!effective.boolValue; type = 'boolean'; }
    else if ('errorValue' in effective) { value = cell.formattedValue || effective.errorValue?.message || ''; type = 'error'; }
    else if ('stringValue' in effective || cell.formattedValue) { value = effective.stringValue ?? cell.formattedValue ?? ''; type = 'text'; }
    return { value, type, formula: String(cell.userEnteredValue?.formulaValue || '') };
  }
  async function writeSheet(store, root, row) {
    const fields = 'spreadsheetId,properties(title),sheets(properties(sheetId,title),data(rowData(values(effectiveValue,effectiveFormat(numberFormat(type)),formattedValue,userEnteredValue))))';
    const book = await json(`${SHEETS}/spreadsheets/${encodeURIComponent(row.id)}?includeGridData=true&fields=${encodeURIComponent(fields)}`);
    const base = join(root, 'Googleスプレッドシート', `${safe(book.properties?.title || row.name, 'スプレッドシート')}_${String(row.id).slice(0, 12)}`); await ensureDir(store, base);
    const statePath = join(base, '_google-import-state.json');
    const state = await readImportState(store, statePath); state.rows = state.rows || {};
    const manifestPath = join(base, 'Googleスプレッドシート.md');
    await store.writeText(manifestPath, frontmatter({ type: 'imported-note', source: 'google-sheets', external_id: row.id, external_updated_at: row.modifiedTime || '', external_status: 'available' }, `# ${book.properties?.title || row.name}\n`));
    for (const sheet of book.sheets || []) {
      const id = String(sheet.properties?.sheetId || '0'), title = String(sheet.properties?.title || 'シート'); const dir = join(base, `${safe(title, 'シート')}_${id}`); await ensureDir(store, dir);
      const rows = (sheet.data || []).flatMap(grid => grid.rowData || []).map(data => (data.values || []).map(cellInfo)); const headers = rows[0] || [];
      const propertyTypes = Object.fromEntries(headers.slice(1).map((header, column) => {
        const name = String(header?.value || `列 ${column + 2}`);
        const sample = rows.slice(1).map(values => values[column + 1]).find(value => value && value.type !== 'empty');
        return [name, { type: sample?.type || 'text', source: 'google-sheets' }];
      }));
      await store.writeText(join(dir, `${safe(title, 'シート')}_${id}.md`), frontmatter({ type: 'settings-db', schema_version: 1, storage: 'sqlite', display_name: title, source: 'google-sheets', google_spreadsheet_id: row.id, google_sheet_id: id, property_types: propertyTypes }, `# ${title}\n`));
      for (let index = 1; index < rows.length; index += 1) {
        const values = rows[index], name = String(values[0]?.value || `行 ${index + 1}`), properties = {};
        headers.slice(1).forEach((header, column) => {
          const cell = values[column + 1]; if (!cell || cell.type === 'empty') return;
          properties[String(header?.value || `列 ${column + 2}`)] = [{ value: cell.value, status: '採用', note: '', source: 'google-sheets', google_value_type: cell.type, google_formula: cell.formula }];
        });
        const entryPath = join(dir, `${String(index + 1).padStart(6, '0')}_${safe(name, '行')}.md`);
        const nextText = frontmatter({ type: 'settings-entry', category: title, source: 'google-sheets', external_status: 'available', google_spreadsheet_id: row.id, google_sheet_id: id, google_row_number: index + 1, properties }, '');
        let oldText = ''; try { oldText = await store.readText(entryPath); } catch {}
        const oldHash = oldText ? await textHash(oldText) : '', nextHash = await textHash(nextText), previousHash = String(state.rows[entryPath] || '');
        if (oldText && oldHash !== nextHash && (!previousHash || oldHash !== previousHash)) {
          const conflictDir = join(base, '_import-conflicts'); await ensureDir(store, conflictDir);
          const conflictPath = join(conflictDir, `${safe(title, 'シート')}_${id}_${String(index + 1).padStart(6, '0')}_${Date.now()}.md`);
          await store.writeText(conflictPath, oldText);
        }
        await store.writeText(entryPath, nextText); state.rows[entryPath] = nextHash;
      }
    }
    state.updated_at = new Date().toISOString(); await writeImportState(store, statePath, state);
    return manifestPath;
  }
  async function writeRows(store, root, kind, documentId, title, headers, rows, options = {}) {
    const base = join(root, kind, `${safe(title, kind)}_${String(documentId).slice(0, 12)}`, `データ_${safe(documentId, 'data')}`); await ensureDir(store, base);
    const statePath = join(base, '_google-import-state.json'); const state = await readImportState(store, statePath); state.rows = state.rows || {};
    await store.writeText(join(base, `データ_${safe(documentId, 'data')}.md`), frontmatter({ type: 'settings-db', schema_version: 1, storage: 'sqlite', display_name: title, source: kind, external_id: documentId, property_types: Object.fromEntries(headers.slice(1).map(name => [name, { type: 'text', source: kind }])) }, `# ${title}\n`));
    for (let index = 0; index < rows.length; index += 1) {
      const values = rows[index], properties = {}, rowId = String(values[options.idIndex || 0] || index + 1), rowName = String(values[options.nameIndex ?? 0] || rowId);
      headers.slice(1).forEach((header, column) => { const value = values[column + 1]; if (value !== '' && value != null) properties[header] = [{ value, status: '採用', note: '', source: kind }]; });
      const entryPath = join(base, `${safe(rowName, '行')}_${safe(rowId, String(index + 1))}.md`);
      const nextText = frontmatter({ type: 'settings-entry', category: title, source: kind, external_id: `${documentId}:${rowId}`, properties }, '');
      let oldText = ''; try { oldText = await store.readText(entryPath); } catch {}
      const oldHash = oldText ? await textHash(oldText) : '', nextHash = await textHash(nextText), previousHash = String(state.rows[entryPath] || '');
      if (oldText && oldHash !== nextHash && (!previousHash || oldHash !== previousHash)) {
        const conflictDir = join(base, '_import-conflicts'); await ensureDir(store, conflictDir);
        await store.writeText(join(conflictDir, `${safe(rowName, '行')}_${safe(rowId, String(index + 1))}_${Date.now()}.md`), oldText);
      }
      await store.writeText(entryPath, nextText); state.rows[entryPath] = nextHash;
    }
    state.updated_at = new Date().toISOString(); await writeImportState(store, statePath, state);
    return base;
  }
  async function writeForm(store, root, row) {
    const form = await json(`${FORMS}/${encodeURIComponent(row.id)}`); const questions = (form.items || []).filter(item => item.questionItem?.question?.questionId).map(item => ({ id: item.questionItem.question.questionId, title: item.title || item.questionItem.question.questionId }));
    const responses = await pages(`${FORMS}/${encodeURIComponent(row.id)}/responses`, 'responses', { pageSize: '5000' });
    const lines = [`# ${form.info?.title || row.name}`, '', ...(questions.map(item => `- ${item.title} (\`${item.id}\`)`))]; const path = await writeManagedNote(store, root, 'Googleフォーム', row, lines.join('\n'));
    const answerText = answer => [...(answer?.textAnswers?.answers || []).map(value => value.value || ''), ...(answer?.fileUploadAnswers?.answers || []).map(value => value.fileName || value.fileId || '')].join('\n');
    const rows = responses.map(response => [response.responseId || '', response.lastSubmittedTime || response.createTime || '', response.respondentEmail || '', ...questions.map(question => answerText(response.answers?.[question.id]))]);
    await writeRows(store, root, 'Googleフォーム回答', `form-${row.id}`, `${form.info?.title || row.name} 回答`, ['回答ID', '回答日時', '回答者', ...questions.map(value => value.title)], rows);
    return path;
  }
  async function markUnavailable(store, item) {
    const lite = window.MeldexCloudFrontmatterLite;
    if (!item?.path || !lite?.readFrontmatter || !lite?.frontmatterText) return false;
    const parsed = await lite.readFrontmatter(store, item.path);
    await store.writeText(item.path, lite.frontmatterText({ ...(parsed.frontmatter || {}), external_status: 'unavailable', external_unavailable_at: new Date().toISOString() }, parsed.body || ''));
    return true;
  }
  async function gmailThreadIds(cfg, rt) {
    if (!rt.gmailHistoryId) return (await pages(`${GMAIL}/threads`, 'threads', { maxResults: '500', ...(cfg.options.gmail_after ? { q: `after:${cfg.options.gmail_after}` } : {}) })).map(row => row.id);
    const ids = new Set(); let pageToken = '';
    try { do { const q = new URLSearchParams({ startHistoryId: rt.gmailHistoryId, maxResults: '500', ...(pageToken ? { pageToken } : {}) }); const data = await json(`${GMAIL}/history?${q}`); for (const history of data.history || []) for (const key of ['messages', 'messagesAdded', 'messagesDeleted', 'labelsAdded', 'labelsRemoved']) for (const value of history[key] || []) { const message = value.message || value; if (message.threadId) ids.add(message.threadId); } pageToken = data.nextPageToken || ''; } while (pageToken); return Array.from(ids); } catch (error) { if (error.status !== 404) throw error; rt.gmailHistoryId = ''; return gmailThreadIds(cfg, rt); }
  }
  function base64UrlBytes(value) {
    const raw = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
    const decoded = atob(raw + '='.repeat((4 - raw.length % 4) % 4));
    return Uint8Array.from(decoded, char => char.charCodeAt(0));
  }
  function gmailPlainText(part) {
    const own = part?.mimeType === 'text/plain' && part.body?.data
      ? new TextDecoder().decode(base64UrlBytes(part.body.data)) : '';
    return [own, ...(part?.parts || []).map(gmailPlainText)].filter(Boolean).join('\n');
  }
  async function writeGmailThread(store, root, threadId) {
    const thread = await json(`${GMAIL}/threads/${encodeURIComponent(threadId)}?format=full`);
    const first = thread.messages?.[0] || {}, headers = first.payload?.headers || [];
    const subject = headers.find(header => String(header.name).toLowerCase() === 'subject')?.value || '件名なし';
    const path = await writeManagedNote(store, root, 'Gmail', { id: threadId, name: subject, modifiedTime: first.internalDate || '' }, (thread.messages || []).map(message => gmailPlainText(message.payload || {})).join('\n\n---\n\n'));
    if (store.overwriteBytes) {
      const attachmentDir = join(root, 'Gmail', '_eml', safe(subject, '件名なし') + '_' + safe(threadId, 'thread')); await ensureDir(store, attachmentDir);
      for (const message of thread.messages || []) {
        const messageId = String(message.id || 'message'); const raw = await json(`${GMAIL}/messages/${encodeURIComponent(messageId)}?format=raw`);
        await store.overwriteBytes(join(attachmentDir, `${safe(messageId, 'message')}.eml`), base64UrlBytes(raw.raw || ''));
      }
    }
    return path;
  }
  async function contactRows(rt) {
    const rows = []; let pageToken = '', nextSyncToken = '';
    try { do { const q = new URLSearchParams({ personFields: 'names,emailAddresses,phoneNumbers,organizations,addresses,biographies,metadata', pageSize: '1000', ...(rt.contactsSyncToken ? { syncToken: rt.contactsSyncToken } : { requestSyncToken: 'true' }), ...(pageToken ? { pageToken } : {}) }); const data = await json(`${PEOPLE}?${q}`); rows.push(...(data.connections || [])); pageToken = data.nextPageToken || ''; nextSyncToken = data.nextSyncToken || nextSyncToken; } while (pageToken); } catch (error) { if (rt.contactsSyncToken && (error.status === 400 || error.status === 410)) { rt.contactsSyncToken = ''; return contactRows(rt); } throw error; }
    return { rows, nextSyncToken };
  }
  async function listDriveFiles(cfg, rt) {
    const fields = 'nextPageToken,newStartPageToken,changes(fileId,removed,file(id,name,mimeType,modifiedTime,shared,ownedByMe,webViewLink))';
    const scopes = [{ key: 'user', driveId: '' }, ...(cfg.options.shared_drive_ids || []).map(driveId => ({ key: `drive:${driveId}`, driveId }))];
    const files = [], removed = [], nextTokens = { ...(rt.driveTokens || {}) };
    for (const scope of scopes) {
      const driveParams = scope.driveId ? { driveId: scope.driveId, supportsAllDrives: 'true' } : {};
      let nextToken = String(nextTokens[scope.key] || '');
      if (nextToken) {
        let page = nextToken;
        try {
          do {
            const q = new URLSearchParams({ pageSize: '1000', includeRemoved: 'true', fields, pageToken: page, ...driveParams });
            const data = await json(`${DRIVE}/changes?${q}`);
            for (const change of data.changes || []) { if (change.removed || !change.file) removed.push({ id: change.fileId, scope: scope.key }); else files.push({ ...change.file, _meldexScope: scope.key }); }
            page = data.nextPageToken || ''; nextToken = data.newStartPageToken || nextToken;
          } while (page);
        } catch (error) { if (error.status !== 410) throw error; nextToken = ''; }
      }
      if (!nextToken) {
        const corpus = scope.driveId ? { corpora: 'drive', driveId: scope.driveId, includeItemsFromAllDrives: 'true', supportsAllDrives: 'true' } : { corpora: 'user', includeItemsFromAllDrives: 'true' };
        const listed = await pages(`${DRIVE}/files`, 'files', { q: 'trashed = false', pageSize: '1000', fields: 'nextPageToken,files(id,name,mimeType,modifiedTime,shared,ownedByMe,webViewLink)', ...corpus });
        files.push(...listed.map(row => ({ ...row, _meldexScope: scope.key })));
        const q = new URLSearchParams(driveParams); const token = await json(`${DRIVE}/changes/startPageToken${String(q) ? '?' + q : ''}`); nextToken = token.startPageToken || '';
      }
      nextTokens[scope.key] = nextToken;
    }
    const visible = cfg.options.shared_items ? files : files.filter(row => !(row._meldexScope === 'user' && row.shared === true && row.ownedByMe !== true));
    return { files: visible, removed, nextTokens };
  }
  async function run() {
    if (!canManage()) throw Object.assign(new Error('取り込みを実行できるのは管理者のみです'), { status: 403 }); const cfg = config(); const store = await provider('readwrite'); const rt = runtime();
    cfg.run_state = { ...cfg.run_state, status: 'running', last_started_at: new Date().toISOString() }; writeLocal(CONFIG_KEY, cfg);
    const about = await json(`${DRIVE}/about?fields=user(displayName,emailAddress)`); const account = about.user?.emailAddress || about.user?.displayName || 'Googleアカウント'; const root = join(cfg.destination.path, '外部取り込み', 'Google', safe(account, 'Googleアカウント')); await ensureDir(store, root);
    const discovered = await listDriveFiles(cfg, rt); const enabled = new Set(Object.keys(cfg.targets).filter(key => cfg.targets[key])); const result = { ok: true, imported: 0, updated: 0, skipped: 0, failed: 0, warnings: [], failures: [] };
    for (const row of discovered.files) {
      const target = Object.keys(MIME).find(key => MIME[key] === row.mimeType); if (!target || !enabled.has(target)) continue;
      try {
        let path = '';
        if (target === 'docs') {
          const text = await (await request(`${DRIVE}/files/${encodeURIComponent(row.id)}/export?mimeType=text%2Fplain`, { headers: { Accept: 'text/plain' } })).text();
          path = await writeManagedNote(store, root, 'Googleドキュメント', row, text);
          if (cfg.options.original_snapshots) await writeExport(store, join(root, 'Googleドキュメント', `${safe(row.name, 'Googleドキュメント')}_${String(row.id).slice(0, 12)}.docx`), `${DRIVE}/files/${encodeURIComponent(row.id)}/export?mimeType=application%2Fvnd.openxmlformats-officedocument.wordprocessingml.document`);
        } else if (target === 'sheets') {
          path = await writeSheet(store, root, row);
          if (cfg.options.original_snapshots) await writeExport(store, join(root, 'Googleスプレッドシート', `${safe(row.name, 'スプレッドシート')}_${String(row.id).slice(0, 12)}.xlsx`), `${DRIVE}/files/${encodeURIComponent(row.id)}/export?mimeType=application%2Fvnd.openxmlformats-officedocument.spreadsheetml.sheet`);
        } else if (target === 'slides') {
          path = await writeManagedNote(store, root, 'Googleスライド', row, `Googleスライドのバックアップです。\n\n- 更新日時: ${row.modifiedTime || '不明'}`);
          await writeExport(store, join(root, 'Googleスライド', `${safe(row.name, 'Googleスライド')}_${String(row.id).slice(0, 12)}.pdf`), `${DRIVE}/files/${encodeURIComponent(row.id)}/export?mimeType=application%2Fpdf`);
          if (cfg.options.original_snapshots) await writeExport(store, join(root, 'Googleスライド', `${safe(row.name, 'Googleスライド')}_${String(row.id).slice(0, 12)}.pptx`), `${DRIVE}/files/${encodeURIComponent(row.id)}/export?mimeType=application%2Fvnd.openxmlformats-officedocument.presentationml.presentation`);
        } else if (target === 'forms') path = await writeForm(store, root, row);
        rt.items[row.id] = { path, target, scope: row._meldexScope || 'user' }; result.updated += 1;
      } catch (error) { result.failed += 1; result.failures.push({ id: row.id, name: row.name, message: error.message }); }
    }
    for (const removed of discovered.removed) {
      try { if (await markUnavailable(store, rt.items[removed.id])) result.updated += 1; else result.skipped += 1; }
      catch (error) { result.failed += 1; result.failures.push({ id: removed.id, name: 'Google Driveから利用不可', message: error.message }); }
    }
    if (cfg.targets.gmail) { const ids = await gmailThreadIds(cfg, rt); for (const threadId of ids) { try { await writeGmailThread(store, root, threadId); result.updated += 1; } catch (error) { result.failed += 1; result.failures.push({ id: threadId, name: 'Gmail', message: error.message }); } } if (!result.failed) { const profile = await json(`${GMAIL}/profile`); rt.gmailHistoryId = String(profile.historyId || rt.gmailHistoryId); } }
    if (cfg.targets.contacts) { try { const contacts = await contactRows(rt); const rows = contacts.rows.map(person => [person.resourceName || '', person.names?.[0]?.displayName || person.resourceName || '連絡先', person.emailAddresses?.[0]?.value || '', person.phoneNumbers?.[0]?.value || '', person.organizations?.[0]?.name || '', person.addresses?.[0]?.formattedValue || '', !!person.metadata?.deleted]); await writeRows(store, root, 'Google連絡先', 'google-contacts', 'Google連絡先', ['連絡先ID', '名前', 'メール', '電話', '組織', '住所', '削除済み'], rows, { idIndex: 0, nameIndex: 1 }); rt.contactsSyncToken = contacts.nextSyncToken || rt.contactsSyncToken; result.updated += rows.length; } catch (error) { result.failed += 1; result.failures.push({ id: 'contacts', name: 'Google連絡先', message: error.message }); } }
    if (cfg.targets.takeout) result.warnings.push('Google Takeoutは容量を安全に確認できるデスクトップ版で取り込んでください');
    if (!result.failed) { rt.driveTokens = discovered.nextTokens; writeLocal(RUNTIME_KEY, rt); }
    cfg.run_state = { ...cfg.run_state, status: result.failed ? 'partial' : 'success', last_finished_at: new Date().toISOString(), last_result: result }; writeLocal(CONFIG_KEY, cfg); return result;
  }

  window.MeldexGoogleImportCloud = { getPayload, patchConfig, authorize, disconnect, run, listSharedDrives, _internal: { listDriveFiles, writeSheet, writeManagedNote, accessToken } };
})();
