/* 外部ワークスペース返答AI Phase 4B UI。署名検証済みread-model以外をready表示へ使わない。 */
(function () {
  'use strict';

  const POLICY = 'answer-only-v2';
  const ACTIVE = new Set(['queued', 'assigned', 'validating', 'running', 'posting', 'cancel_pending']);
  const RETRYABLE = new Set(['failed', 'cancelled', 'expired', 'rejected']);
  const STATUS_LABELS = {
    queued: '待機中', assigned: '担当PCを割り当て済み', validating: '安全確認中',
    running: '返答を作成中', posting: '返答を投稿中', done: '完了', failed: '失敗',
    cancelled: '取り消し済み', expired: '期限切れ', rejected: '拒否',
    cancel_pending: '取消を受け付けました',
  };
  const STORAGE_KEY = 'meldex-external-responder-attempts-v2';
  const DEVICE_ID_KEY = 'meldex-external-responder-device-id-v1';
  const OS_NOTICE_KEY = 'meldex-external-responder-os-notices-v1';
  const DB_NAME = 'meldex-external-responder-keys-v1';
  let readiness = null;
  let pollTimer = null;
  let settingsTimer = null;

  const text = (value) => String(value == null ? '' : value);
  const currentWorkspaceId = () => {
    try { return text(typeof _chatWorkspaceIdValue === 'function' ? _chatWorkspaceIdValue() : '').trim(); } catch { return ''; }
  };
  const currentRoom = () => {
    try { return text(typeof _teamCurrentRoom !== 'undefined' ? _teamCurrentRoom : window._teamCurrentRoom).trim(); } catch { return ''; }
  };
  const currentUser = () => {
    try { return text(typeof getUsername === 'function' ? getUsername() : '').trim(); } catch { return ''; }
  };
  const visibleAiPanels = () => [...document.querySelectorAll('[id="chat-llm-panel"]')]
    .filter(panel => !panel.closest('[data-gb-snapshot="true"]'));

  function element(tag, className, value) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (value !== undefined) node.textContent = value;
    return node;
  }

  function deviceId() {
    try {
      let value = localStorage.getItem(DEVICE_ID_KEY);
      if (!value) {
        value = 'web-' + (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36));
        localStorage.setItem(DEVICE_ID_KEY, value);
      }
      return value;
    } catch { return 'web-session-device'; }
  }

  function loadAttempts() {
    try {
      const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      return Array.isArray(value) ? value.filter(item => item && item.request_id && item.attempt_id).slice(-50) : [];
    } catch { return []; }
  }

  function saveAttempts(items) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(items.slice(-50))); } catch {}
  }

  function upsertAttempt(next) {
    const items = loadAttempts();
    const index = items.findIndex(item => item.request_id === next.request_id && item.attempt_id === next.attempt_id);
    if (index >= 0) items[index] = { ...items[index], ...next };
    else items.push(next);
    saveAttempts(items);
    renderRequestCards();
  }

  function query(workspaceId, extra) {
    const params = new URLSearchParams({ workspace_id: workspaceId, ...(extra || {}) });
    return '?' + params.toString();
  }

  function verifiedReadyNode(snapshot) {
    if (!snapshot || snapshot.signature_verified !== true || !/^ed25519:[a-f0-9]{64}$/.test(text(snapshot.owner_key_id))) return null;
    return (Array.isArray(snapshot.nodes) ? snapshot.nodes : []).find(node => (
      node?.signature_verified === true && node?.online === true && node?.accepting === true
      && node?.responder_policy_version === POLICY && node?.capability_status === 'ready'
      && node?.provider_capability_status === 'ready'
    )) || null;
  }

  function readinessView(snapshot, error) {
    if (!currentWorkspaceId()) return { state: 'setup_required', label: '対象ワークスペースを選択', action: '選択後に再確認できます' };
    if (error) return { state: 'error', label: '返答用AIでエラー', action: text(error.message || error) };
    const node = verifiedReadyNode(snapshot);
    if (node) {
      const queue = Math.max(0, Number(node.queue_count || 0));
      return { state: queue ? 'busy' : 'ready', label: queue ? `返答を作成中・${queue}件待ち` : `準備完了・${node.assistant_label || 'CLI'}`, action: '', node };
    }
    if (snapshot?.signature_verified !== true) return { state: 'unsafe', label: '安全設定を確認できません', action: '署名済み状態を確認できないため依頼を開始しません' };
    const nodes = Array.isArray(snapshot.nodes) ? snapshot.nodes : [];
    if (nodes.some(node => node?.provider_capability_status === 'auth_required')) return { state: 'auth_required', label: 'CLIのログインが必要', action: '管理者PCでCLIへログインしてください' };
    if (nodes.some(node => node?.provider_capability_status === 'unsupported')) return { state: 'unsupported', label: 'このCLIは外部返答に未対応', action: '対応providerを管理者PCで選択してください' };
    if (nodes.some(node => node?.capability_status && node.capability_status !== 'ready')) return { state: 'unsafe', label: '安全設定を確認できません', action: '外部依頼の安全ゲートは停止中です' };
    return { state: 'offline', label: '管理者PCは停止中', action: '管理者PCの起動後に処理されます' };
  }

  function currentReadinessView() {
    const workspaceId = currentWorkspaceId();
    if (!workspaceId || readiness?.workspaceId !== workspaceId) return readinessView(null, null);
    return readinessView(readiness.snapshot, readiness.error);
  }

  function ensureStatusUi(panel) {
    let root = panel.querySelector(':scope > .external-responder-status');
    if (root) return root;
    root = element('section', 'external-responder-status');
    root.dataset.e2eId = 'external-responder-status';
    root.setAttribute('role', 'status');
    root.setAttribute('aria-live', 'polite');
    const chip = element('button', 'external-responder-status-chip');
    chip.type = 'button';
    chip.dataset.e2eId = 'external-responder-status-details';
    chip.dataset.externalResponderDetails = '1';
    chip.setAttribute('aria-haspopup', 'dialog');
    chip.setAttribute('aria-label', '返答用AIの詳細を開く');
    chip.addEventListener('keydown', event => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault(); openDetails();
    });
    chip.addEventListener('pointerup', event => {
      if (event.pointerType !== 'touch') return;
      event.preventDefault(); openDetails();
    });
    chip.append(element('span', 'external-responder-status-title', '返答用AI'));
    chip.append(element('span', 'external-responder-status-value', '確認中'));
    root.append(chip);
    const firstRow = panel.firstElementChild;
    if (firstRow?.nextSibling) panel.insertBefore(root, firstRow.nextSibling);
    else panel.append(root);
    return root;
  }

  function renderReadiness() {
    const view = currentReadinessView();
    visibleAiPanels().forEach(panel => {
      const root = ensureStatusUi(panel);
      root.dataset.state = view.state;
      root.querySelector('.external-responder-status-value').textContent = view.label;
      root.querySelector('.external-responder-status-chip').title = view.action || 'ワークスペースチャットへ返答する管理者PCのAI';
    });
  }

  async function refreshReadiness() {
    const workspaceId = currentWorkspaceId();
    if (!workspaceId) { readiness = { workspaceId: '', snapshot: null, error: null }; renderReadiness(); return readiness; }
    try {
      const snapshot = await apiFetch('/workspace-cli/phase4a/presence' + query(workspaceId), { silentError: true });
      readiness = { workspaceId, snapshot, error: null };
    } catch (error) { readiness = { workspaceId, snapshot: null, error }; }
    renderReadiness();
    return readiness;
  }

  function openDetails() {
    document.querySelector('[data-external-responder-dialog]')?.remove();
    const overlay = element('div', 'external-responder-dialog-overlay');
    overlay.dataset.externalResponderDialog = '1';
    const dialog = element('section', 'external-responder-dialog');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'external-responder-dialog-title');
    const title = element('h2', '', '返答用AIの詳細'); title.id = 'external-responder-dialog-title';
    const view = currentReadinessView();
    const status = element('p', 'external-responder-detail-status', view.label);
    const explain = element('p', 'external-responder-detail-copy', view.action || 'ワークスペースチャットへ返答する管理者PCのAIです。');
    const nodes = element('div', 'external-responder-node-list');
    (readiness?.snapshot?.nodes || []).forEach(item => {
      const row = element('div', 'external-responder-node-row');
      row.append(element('strong', '', item.node_name || item.node_id || '管理者PC'));
      row.append(element('span', '', `${item.assistant_label || 'CLI'} / policy ${item.responder_policy_version || '未確認'} / 最終確認 ${item.updated_at || '不明'} / ${Math.max(0, Number(item.queue_count || 0))}件待ち`));
      nodes.append(row);
    });
    if (!nodes.childElementCount) nodes.append(element('p', 'external-responder-detail-copy', '登録済み管理者PCの署名済み状態はありません。'));
    const actions = element('div', 'external-responder-dialog-actions');
    const recheck = element('button', 'gb-btn', '再確認'); recheck.type = 'button'; recheck.dataset.externalResponderRecheck = '1';
    const close = element('button', 'gb-btn', '閉じる'); close.type = 'button'; close.dataset.externalResponderClose = '1';
    actions.append(recheck, close); dialog.append(title, status, explain, nodes, actions); overlay.append(dialog); document.body.append(overlay);
    close.addEventListener('click', () => { overlay.remove(); document.querySelector('[data-external-responder-details]')?.focus(); });
    recheck.addEventListener('click', async () => { await refreshReadiness(); overlay.remove(); openDetails(); });
    overlay.addEventListener('click', event => { if (event.target === overlay) close.click(); });
    dialog.addEventListener('keydown', event => { if (event.key === 'Escape') close.click(); });
    close.focus();
  }

  function requestCardsHost() {
    const panel = [...document.querySelectorAll('[id="chat-team-panel"]')].find(item => !item.closest('[data-gb-snapshot="true"]'));
    if (!panel) return null;
    let host = panel.querySelector('.external-responder-request-cards');
    if (!host) {
      host = element('section', 'external-responder-request-cards');
      host.dataset.e2eId = 'external-responder-request-cards';
      host.setAttribute('aria-label', '自分の管理者AI依頼');
      let composer = panel.querySelector('#team-composer') || panel.lastElementChild;
      while (composer?.parentElement && composer.parentElement !== panel) composer = composer.parentElement;
      panel.insertBefore(host, composer || null);
    }
    return host;
  }

  function statusErrorCopy(item) {
    const code = text(item.rejection_code).toLowerCase();
    if (code.includes('auth')) return '認証: 管理者PCでCLIへログインしてください';
    if (code.includes('quota') || code.includes('limit')) return '利用上限: 時間をおいて再試行してください';
    if (code.includes('attachment')) return '添付: 対応形式とサイズを確認してください';
    if (code.includes('expired')) return '期限切れ: 必要なら新しいattemptで再試行してください';
    if (code.includes('unsafe') || code.includes('policy')) return '安全設定: 管理者へ設定確認を依頼してください';
    return item.status === 'failed' ? '接続: 管理者PCの状態を確認して再試行してください' : '';
  }

  function renderRequestCards() {
    const host = requestCardsHost();
    if (!host) return;
    host.replaceChildren();
    const workspaceId = currentWorkspaceId();
    const room = currentRoom();
    loadAttempts().filter(item => item.workspace_id === workspaceId && (!room || item.room === room)).slice(-5).reverse().forEach(item => {
      const card = element('article', 'external-responder-request-card');
      card.dataset.state = item.status || 'queued';
      card.dataset.requestId = item.request_id;
      const heading = element('div', 'external-responder-request-heading');
      heading.append(element('strong', '', '管理者AIへの依頼'));
      heading.append(element('span', 'external-responder-request-state', STATUS_LABELS[item.status] || item.status || '待機中'));
      card.append(heading);
      const error = statusErrorCopy(item); if (error) card.append(element('p', 'external-responder-request-error', error));
      const actions = element('div', 'external-responder-request-actions');
      if (ACTIVE.has(item.status) && item.status !== 'cancel_pending') {
        const cancel = element('button', 'gb-btn gb-btn-sm', '取り消す'); cancel.type = 'button'; cancel.dataset.requestCancel = '1'; actions.append(cancel);
      } else if (RETRYABLE.has(item.status)) {
        const retry = element('button', 'gb-btn gb-btn-sm', '再試行'); retry.type = 'button'; retry.dataset.requestRetry = '1'; actions.append(retry);
      }
      card.append(actions); host.append(card);
    });
    host.hidden = !host.childElementCount;
  }

  function notifyCompleted(item) {
    const tab = document.getElementById('chat-tab-llm');
    if (tab && !tab.querySelector('.external-responder-unread')) {
      const badge = element('span', 'external-responder-unread', '1'); badge.setAttribute('aria-label', '返答用AIの未読通知1件'); tab.append(badge);
    }
    if (typeof showStatus === 'function') showStatus(item.status === 'done' ? '管理者AIの返答が完了しました' : `管理者AIの依頼は${STATUS_LABELS[item.status] || item.status}です`, item.status !== 'done');
    try {
      if (localStorage.getItem(OS_NOTICE_KEY) === '1' && Notification.permission === 'granted') new Notification('Meldex', { body: '管理者AIの依頼状態が更新されました' });
    } catch {}
  }

  async function pollAttempts() {
    const items = loadAttempts();
    let changed = false;
    for (const item of items.filter(value => ACTIVE.has(value.status))) {
      try {
        const state = await apiFetch('/workspace-cli/phase4a/request-state' + query(item.workspace_id, { request_id: item.request_id, attempt_id: item.attempt_id }), { silentError: true });
        if (state?.signature_verified !== true || state.owner_key_id !== item.owner_key_id) continue;
        if (state.status !== item.status) {
          const wasActive = ACTIVE.has(item.status); item.status = state.status; item.rejection_code = state.rejection_code || ''; changed = true;
          if (wasActive && !ACTIVE.has(item.status)) notifyCompleted(item);
        }
      } catch {}
    }
    if (changed) saveAttempts(items);
    renderRequestCards();
  }

  function openKeyDb() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => request.result.createObjectStore('keys');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function keyRecord(workspaceId) {
    const db = await openKeyDb();
    return new Promise((resolve, reject) => {
      const request = db.transaction('keys').objectStore('keys').get(workspaceId);
      request.onsuccess = () => resolve(request.result || null); request.onerror = () => reject(request.error);
    });
  }

  async function saveKeyRecord(workspaceId, record) {
    const db = await openKeyDb();
    return new Promise((resolve, reject) => {
      const request = db.transaction('keys', 'readwrite').objectStore('keys').put(record, workspaceId);
      request.onsuccess = () => resolve(record); request.onerror = () => reject(request.error);
    });
  }

  async function enrollThisDevice() {
    const workspaceId = currentWorkspaceId();
    if (!workspaceId) throw new Error('対象ワークスペースを選択してください');
    const protocol = window.__MeldexWorkspaceCliSigningProtocol;
    if (!protocol) throw new Error('端末署名機能を利用できません');
    let record = await keyRecord(workspaceId);
    if (!record) {
      const pair = await protocol.generateSigningKey();
      record = { ...pair, device_id: deviceId() };
      await saveKeyRecord(workspaceId, record);
    }
    const now = new Date();
    const payload = {
      type: 'workspace-cli-enrollment-request', version: 1, workspace_id: workspaceId, kind: 'device',
      user_id: currentUser(), device_id: record.device_id, node_id: '', public_key: record.public_key,
      key_id: record.key_id, nonce: crypto.randomUUID(), issued_at: now.toISOString(),
      expires_at: new Date(now.getTime() + 10 * 60 * 1000).toISOString(),
    };
    const signed = await protocol.signEnrollmentRequest(payload, record);
    return apiPost('/workspace-cli/phase4a/enrollments', signed);
  }

  async function sendSignedRequest() {
    const view = currentReadinessView();
    if (!view.node) { if (typeof showStatus === 'function') showStatus(`${view.label}: ${view.action}`, true); return false; }
    const workspaceId = currentWorkspaceId(); const room = currentRoom();
    const input = document.getElementById('team-input'); const requestText = text(input?.value).trim();
    if (!room || !requestText) { if (typeof showStatus === 'function') showStatus('ルームと依頼内容を入力してください', true); return false; }
    const record = await keyRecord(workspaceId);
    if (!record) { if (typeof showStatus === 'function') showStatus('この端末は未登録です。設定から登録してください', true); return false; }
    const prepared = await apiPost('/workspace-cli/phase4a/request-v2/prepare', {
      workspace_id: workspaceId, room, text: requestText, device_id: record.device_id,
      target_node_id: view.node.node_id, context_items: [], attachments: [],
    });
    const signed = await window.__MeldexWorkspaceCliSigningProtocol.signRequestV2(prepared.unsigned_request, record.privateKey, record.key_id);
    const accepted = await apiPost('/workspace-cli/phase4a/request-v2/accept', { signed_request: signed });
    upsertAttempt({ ...accepted, workspace_id: workspaceId, room, status: 'queued', target_node_id: view.node.node_id, device_id: record.device_id, owner_key_id: readiness.snapshot.owner_key_id, created_at: new Date().toISOString() });
    if (input) input.value = '';
    return true;
  }

  async function requestOwnerAction(action, targetId, endpoint, body) {
    const workspaceId = currentWorkspaceId();
    const confirmation = await apiPost('/workspace-cli/phase4a/owner-confirmations', { workspace_id: workspaceId, action, target_id: targetId });
    return apiPost(endpoint, { workspace_id: workspaceId, ...body, confirmation_token: confirmation.confirmation_token });
  }

  function base64Url(bytes) {
    let binary = ''; new Uint8Array(bytes).forEach(byte => { binary += String.fromCharCode(byte); });
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  async function signControlPayload(payload, record) {
    if (!record?.privateKey || record.privateKey.extractable) throw new Error('端末ローカルの非export鍵が必要です');
    const unsigned = { ...(payload || {}), key_id: record.key_id };
    delete unsigned.signature; delete unsigned.signature_scheme;
    const canonical = window.__MeldexWorkspaceCliSigningProtocol?.canonicalize;
    if (typeof canonical !== 'function') throw new Error('端末署名機能を利用できません');
    const signature = await crypto.subtle.sign({ name: 'Ed25519' }, record.privateKey, new TextEncoder().encode(canonical(unsigned)));
    return { ...unsigned, signature_scheme: 'ed25519-v1', signature: base64Url(signature) };
  }

  async function sendSignedControl(item, action) {
    const record = await keyRecord(item.workspace_id);
    if (!record || record.device_id !== item.device_id) throw new Error('この依頼を送った登録端末鍵がありません');
    const prepared = await apiPost('/workspace-cli/phase4a/control-v2/prepare', {
      workspace_id: item.workspace_id, request_id: item.request_id, attempt_id: item.attempt_id,
      action, device_id: record.device_id,
    });
    const signedControl = await signControlPayload(prepared.unsigned_control, record);
    const signedRetry = prepared.unsigned_retry_request
      ? await window.__MeldexWorkspaceCliSigningProtocol.signRequestV2(prepared.unsigned_retry_request, record.privateKey, record.key_id)
      : null;
    return apiPost('/workspace-cli/phase4a/control-v2/accept', {
      signed_control: signedControl, ...(signedRetry ? { signed_retry_request: signedRetry } : {}),
    });
  }

  async function renderSecuritySettings(container) {
    if (!container || container.querySelector('[data-external-responder-security]')) return;
    const section = element('section', 'external-responder-security-settings'); section.dataset.externalResponderSecurity = '1';
    section.append(element('h4', '', '返答用AIの安全設定'));
    const workspaceId = currentWorkspaceId();
    if (!workspaceId) { section.append(element('p', 'gb-section-desc', 'ワークスペースを選択すると端末と管理者PCの許可状態を確認できます。')); container.append(section); return; }
    let model;
    try { model = await apiFetch('/workspace-cli/phase4a/security-settings' + query(workspaceId), { silentError: true }); }
    catch (error) { section.append(element('p', 'gb-section-desc', '所有者だけが安全設定を確認できます: ' + text(error.message || error))); container.append(section); return; }
    if (model?.signature_verified !== true) { section.append(element('p', 'gb-section-desc', '署名済み端末台帳を確認できません。')); container.append(section); return; }
    section.append(element('p', 'gb-section-desc', `policy ${POLICY} / owner ${model.owner_key_id}`));
    const enroll = element('button', 'gb-btn gb-btn-sm', 'この端末を登録申請'); enroll.type = 'button'; enroll.dataset.enrollThisDevice = '1'; section.append(enroll);
    const notice = element('label', 'external-responder-notice-setting');
    const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = localStorage.getItem(OS_NOTICE_KEY) === '1';
    notice.append(checkbox, document.createTextNode(' OS通知を許可する（ブラウザー許可後のみ）')); section.append(notice);
    checkbox.addEventListener('change', async () => {
      if (checkbox.checked && typeof Notification !== 'undefined' && Notification.permission !== 'granted') checkbox.checked = (await Notification.requestPermission()) === 'granted';
      localStorage.setItem(OS_NOTICE_KEY, checkbox.checked ? '1' : '0');
    });
    (model.pending_enrollments || []).forEach(item => {
      const row = element('div', 'external-responder-setting-row');
      row.append(element('span', '', `承認待ち: ${item.kind} ${item.device_id || item.node_id || item.user_id}`));
      const replace = (model.keys || []).some(key => !key.revoked_at && key.kind === item.kind && ((item.kind === 'device' && key.device_id === item.device_id) || (item.kind === 'node' && key.node_id === item.node_id)) && key.key_id !== item.key_id);
      const approve = element('button', 'gb-btn gb-btn-sm', '承認'); approve.type = 'button'; approve.dataset.approveEnrollment = item.enrollment_id; approve.dataset.approvalAction = replace ? 'replace-enrollment' : 'approve-enrollment'; row.append(approve); section.append(row);
    });
    (model.keys || []).forEach(item => {
      const row = element('div', 'external-responder-setting-row');
      row.append(element('span', '', `${item.kind}: ${item.device_id || item.node_id || item.user_id}${item.revoked_at ? '（失効済み）' : ''}`));
      if (!item.revoked_at) { const revoke = element('button', 'gb-btn gb-btn-sm', '失効'); revoke.type = 'button'; revoke.dataset.revokeKey = item.key_id; row.append(revoke); }
      section.append(row);
    });
    container.append(section);
  }

  async function handleClick(event) {
    const target = event.target?.closest?.('button, [data-external-responder-details]'); if (!target) return;
    if (target.dataset.externalResponderDetails !== undefined) { event.preventDefault(); openDetails(); return; }
    if (target.dataset.enrollThisDevice !== undefined) { event.preventDefault(); try { await enrollThisDevice(); showStatus('端末登録を申請しました。所有者の承認後に利用できます'); } catch (error) { showStatus('端末登録に失敗しました: ' + text(error.message || error), true); } return; }
    if (target.dataset.approveEnrollment) { event.preventDefault(); try { await requestOwnerAction(target.dataset.approvalAction, target.dataset.approveEnrollment, '/workspace-cli/phase4a/enrollments/approve', { enrollment_id: target.dataset.approveEnrollment }); showStatus('端末を承認しました'); target.closest('.external-responder-security-settings')?.remove(); } catch (error) { showStatus('承認に失敗しました: ' + text(error.message || error), true); } return; }
    if (target.dataset.revokeKey) { event.preventDefault(); try { await requestOwnerAction('revoke-key', target.dataset.revokeKey, '/workspace-cli/phase4a/enrollments/revoke', { key_id: target.dataset.revokeKey }); showStatus('端末の許可を失効しました'); target.closest('.external-responder-security-settings')?.remove(); } catch (error) { showStatus('失効に失敗しました: ' + text(error.message || error), true); } return; }
    const card = target.closest('.external-responder-request-card'); if (!card) return;
    const item = loadAttempts().find(value => value.request_id === card.dataset.requestId); if (!item) return;
    if (target.dataset.requestCancel !== undefined) { event.preventDefault(); try { const result = await sendSignedControl(item, 'cancel'); upsertAttempt({ ...item, status: result.control_status === 'cancel_requested' ? 'cancel_pending' : (result.state || 'queued') }); } catch (error) { showStatus('取消に失敗しました: ' + text(error.message || error), true); } }
    if (target.dataset.requestRetry !== undefined) { event.preventDefault(); try { const result = await sendSignedControl(item, 'retry'); upsertAttempt({ ...item, ...result, status: result.status || 'queued' }); } catch (error) { showStatus('再試行に失敗しました: ' + text(error.message || error), true); } }
  }

  function clearUnreadOnAiTab(event) {
    if (event.target?.closest?.('#chat-tab-llm')) document.querySelectorAll('.external-responder-unread').forEach(node => node.remove());
  }

  function init() {
    visibleAiPanels().forEach(ensureStatusUi); renderReadiness(); renderRequestCards();
    document.querySelectorAll('#settings-workspace-cli-relay-container').forEach(renderSecuritySettings);
    document.addEventListener('click', handleClick, true); document.addEventListener('click', clearUnreadOnAiTab, true);
    const observer = new MutationObserver((records) => {
      const added = records.flatMap(record => [...record.addedNodes]).filter(node => node.nodeType === 1);
      if (!added.some(node => node.matches?.('#chat-llm-panel,#chat-team-panel,#settings-workspace-cli-relay-container')
        || node.querySelector?.('#chat-llm-panel,#chat-team-panel,#settings-workspace-cli-relay-container'))) return;
      visibleAiPanels().forEach(ensureStatusUi); renderReadiness(); renderRequestCards();
      clearTimeout(settingsTimer); settingsTimer = setTimeout(() => {
        document.querySelectorAll('#settings-workspace-cli-relay-container').forEach(renderSecuritySettings);
      }, 80);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    refreshReadiness(); pollAttempts(); pollTimer = setInterval(() => { refreshReadiness(); pollAttempts(); }, 30000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true }); else init();
  async function sendExternalResponderSignedRequest(event) {
    event?.preventDefault?.(); event?.stopPropagation?.();
    try { return await sendSignedRequest(); } catch (error) { if (typeof showStatus === 'function') showStatus('外部返答用AIへの依頼に失敗しました: ' + text(error.message || error), true); return false; }
  }
  // 管理者AIの短い依頼ボタンは gb-workspace-cli-relay.js の経路を維持する。
  // 外部返答用AIは別概念として専用API名からのみ呼び出し、同名グローバルを上書きしない。
  window.sendExternalResponderSignedRequest = sendExternalResponderSignedRequest;
  window.MeldexExternalResponderUi = Object.freeze({
    refresh: refreshReadiness,
    renderRequestCards,
    enrollThisDevice,
    sendSignedRequest: sendExternalResponderSignedRequest,
  });
})();
