(function () {
  'use strict';

  let _lastNotifyAt = 0;
  let _activeRecoveryModal = null;

  function _esc(value) {
    if (typeof esc === 'function') return esc(value);
    return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function _todayStamp() {
    const now = new Date();
    const pad = value => String(value).padStart(2, '0');
    return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
  }

  function _downloadText(filename, text) {
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function _status(root, text, error) {
    const node = root?.querySelector?.('[data-owner-key-recovery-status]');
    if (!node) return;
    node.textContent = text || '';
    node.classList.toggle('is-error', !!error);
  }

  function _isOwner() {
    return window.MeldexKnowledgeCloudStore?.role?.() === 'owner'
      || window.MeldexRuntimeAdapter?.getWorkspaceState?.()?.isOwner === true;
  }

  async function _resignAll() {
    const provider = window.MeldexStorageAdapter?.getProvider?.() || null;
    if (provider && window.MeldexKnowledgeIntegrity?.resignAll) {
      return window.MeldexKnowledgeIntegrity.resignAll(provider);
    }
    return { signed: [] };
  }

  async function _verifyCandidateRawKey(rawKey) {
    const provider = window.MeldexStorageAdapter?.getProvider?.() || null;
    const targets = window.MeldexKnowledgeIntegrity?.targets || [];
    if (!provider || !targets.length || !window.MeldexKnowledgeSignature?.verify) return { checked: 0 };
    let checked = 0;
    const failed = [];
    for (const target of targets) {
      const signature = await window.MeldexKnowledgeSignature?.readSignature?.(provider, target.scope).catch(() => null);
      if (!signature?.hmac) continue;
      let payload = null;
      try {
        const raw = await provider.readText(target.path);
        payload = JSON.parse(String(raw || 'null'));
      } catch {
        continue;
      }
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) continue;
      const result = await window.MeldexKnowledgeSignature.verify(provider, target.scope, payload, { rawKey });
      checked += 1;
      if (result?.ok === false) failed.push(target.label || target.scope);
    }
    if (failed.length) throw new Error(`入力された鍵は既存署名と一致しません: ${failed.slice(0, 5).join('、')}`);
    return { checked };
  }

  async function _deriveVerifiedPassphrase(passphrase) {
    const store = window.MeldexOwnerKeyStore;
    const attempts = [];
    const currentRaw = await store?.deriveRawFromPassphrase?.(passphrase);
    if (currentRaw) attempts.push({ raw: currentRaw, label: '現在の保存先' });
    const legacySalt = store?.LEGACY_KDF_SALT || '';
    if (legacySalt) {
      const legacyRaw = await store?.deriveRawFromPassphrase?.(passphrase, legacySalt).catch(() => '');
      if (legacyRaw && legacyRaw !== currentRaw) attempts.push({ raw: legacyRaw, label: '旧形式', legacy: true });
    }
    let lastError = null;
    for (const attempt of attempts) {
      try {
        const verification = await _verifyCandidateRawKey(attempt.raw);
        return { ...attempt, verification };
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError || new Error('管理者鍵を復旧できませんでした');
  }

  async function _setFromPassphrase(root) {
    if (!_isOwner()) return _status(root, '管理者のみ実行できます。', true);
    const pass = root.querySelector('[data-owner-key-recovery-passphrase]')?.value || '';
    if (!pass) return _status(root, 'パスフレーズを入力してください。', true);
    try {
      const candidate = await _deriveVerifiedPassphrase(pass);
      await window.MeldexOwnerKeyStore?.setRawKey?.(candidate.raw);
      const result = await _resignAll();
      const suffix = candidate.legacy ? '旧形式のパスフレーズから復旧し、現在の暗号化形式で保存しました。' : '管理者鍵を復旧しました。';
      _status(root, `${suffix}再署名: ${(result?.signed || []).length}件`);
    } catch (err) {
      _status(root, err?.message || String(err), true);
    }
  }

  async function _importRaw(root) {
    if (!_isOwner()) return _status(root, '管理者のみ実行できます。', true);
    const value = root.querySelector('[data-owner-key-recovery-raw]')?.value?.trim() || '';
    if (!value) return _status(root, 'バックアップの管理者鍵を貼り付けてください。', true);
    try {
      const raw = window.MeldexOwnerKeyStore?.normalizeRawKey?.(value);
      if (!raw) throw new Error('管理者鍵を復旧できませんでした');
      await _verifyCandidateRawKey(raw);
      await window.MeldexOwnerKeyStore?.setRawKey?.(raw);
      const result = await _resignAll();
      _status(root, `バックアップ鍵を復旧しました。再署名: ${(result?.signed || []).length}件`);
    } catch (err) {
      _status(root, err?.message || String(err), true);
    }
  }

  async function _exportBackup(root) {
    if (!_isOwner()) return _status(root, '管理者のみ実行できます。', true);
    try {
      const raw = await window.MeldexOwnerKeyStore?.getRawKey?.({ create: false });
      if (!raw) return _status(root, '管理者鍵が未設定です。先に復旧または作成してください。', true);
      const pass = root.querySelector('[data-owner-key-recovery-passphrase]')?.value || '';
      const text = [
        'Meldex 管理者鍵バックアップ',
        `作成日時: ${new Date().toISOString()}`,
        '',
        '復旧用パスフレーズ:',
        pass || '(このバックアップには保存されていません)',
        '',
        '管理者鍵:',
        raw,
        '',
        '保存方式:',
        'この端末では、管理者鍵は保存先ごとのsaltを使って暗号化され、ブラウザのIndexedDBに保存されます。',
        '復旧用パスフレーズは現在の保存先で同じ管理者鍵を再導出するためのものです。',
        '',
        '復旧手順:',
        '1. Meldexの設定から「管理者鍵 / 改竄検知」を開く',
        '2. 「復旧UI」でパスフレーズまたは管理者鍵を入力する',
        '3. 署名検証を実行し、NGが残らないことを確認する',
      ].join('\n');
      _downloadText(`meldex-owner-key-recovery-${_todayStamp()}.txt`, text);
      _status(root, '管理者鍵バックアップを保存しました。');
    } catch (err) {
      _status(root, err?.message || String(err), true);
    }
  }

  function showRecoveryDialog(options = {}) {
    _activeRecoveryModal?.close?.('replaced');
    const minLength = window.MeldexOwnerKeyStore?.PASSPHRASE_MIN_LENGTH || 12;
    const reason = String(options.reason || '');
    const owner = _isOwner();
    const disabled = owner ? '' : 'disabled';
    const trigger = options.trigger && document.contains(options.trigger) ? options.trigger : document.activeElement;
    const content = document.createElement('div');
    content.innerHTML = `
        <div class="gb-section-desc gb-owner-key-recovery-reason">${_esc(reason || '署名検証に必要な管理者鍵がこの端末にありません。')}</div>
        <section class="gb-section gb-section--boxed gb-owner-key-recovery-section">
          <div class="gb-section-title">パスフレーズから復旧</div>
          <div class="gb-section-desc">管理者が決めた${_esc(minLength)}文字以上のパスフレーズから、現在の保存先用の管理者鍵を再生成します。</div>
          <label class="gb-field-row gb-owner-key-recovery-passphrase-row">
            <span class="gb-label gb-owner-key-label">パスフレーズ</span>
            <input type="password" class="gb-input gb-owner-key-recovery-passphrase" data-owner-key-recovery-passphrase data-e2e-id="owner-key-recovery-passphrase" aria-label="管理者鍵復旧パスフレーズ" ${disabled} autocomplete="new-password">
            <button type="button" class="gb-btn gb-btn-sm gb-owner-key-recovery-action" data-owner-key-recovery-action="derive" ${disabled} data-e2e-id="owner-key-recovery-derive" aria-label="パスフレーズから復旧">復旧</button>
          </label>
        </section>
        <section class="gb-section gb-section--boxed gb-owner-key-recovery-section">
          <div class="gb-section-title">バックアップ鍵から復旧</div>
          <textarea class="gb-input gb-owner-key-recovery-raw" data-owner-key-recovery-raw data-e2e-id="owner-key-recovery-raw" rows="3" ${disabled} aria-label="バックアップの管理者鍵" placeholder="バックアップファイルの管理者鍵を貼り付け"></textarea>
          <div class="gb-field-row gb-owner-key-recovery-actions">
            <button type="button" class="gb-btn gb-btn-sm gb-owner-key-recovery-action" data-owner-key-recovery-action="import" ${disabled} data-e2e-id="owner-key-recovery-import" aria-label="バックアップ鍵を復旧">鍵を復旧</button>
            <button type="button" class="gb-btn gb-btn-sm gb-btn-quiet gb-owner-key-recovery-action" data-owner-key-recovery-action="export" ${disabled} data-e2e-id="owner-key-recovery-export" aria-label="管理者鍵バックアップを保存">バックアップ保存</button>
          </div>
        </section>
        <div class="gb-section-desc gb-owner-key-recovery-status" data-owner-key-recovery-status data-e2e-id="owner-key-recovery-status" role="status" aria-live="polite"></div>
    `;
    const modalApi = window.GBUI.createModal({
      id: 'owner-key-recovery',
      title: '管理者鍵の復旧',
      body: [...content.childNodes],
      variant: 'mobile-sheet',
      extraClass: 'gb-owner-key-recovery-dialog',
      initialFocus: owner ? '[data-owner-key-recovery-passphrase]' : '[data-owner-key-recovery-close]',
      returnFocus: trigger || undefined,
      closeLabel: '管理者鍵の復旧を閉じる',
      closeOnEsc: true,
      closeOnOverlay: true,
      onClose: (_reason, api) => {
        if (_activeRecoveryModal === api) _activeRecoveryModal = null;
      },
    });
    _activeRecoveryModal = modalApi;
    const overlay = modalApi.overlay;
    overlay.classList.add('modal-overlay');
    overlay.dataset.ownerKeyRecovery = '1';
    overlay.dataset.e2eId = 'owner-key-recovery-overlay';
    modalApi.modal.classList.add('modal');
    modalApi.modal.dataset.e2eId = 'owner-key-recovery-dialog';
    modalApi.header.classList.add('gb-owner-key-dialog-header');
    const close = modalApi.header.querySelector('.gb-modal-close');
    close?.classList.add('gb-btn', 'gb-btn-sm', 'gb-btn-icon', 'gb-owner-key-dialog-close');
    close?.setAttribute('data-owner-key-recovery-close', '');
    close?.setAttribute('data-e2e-id', 'owner-key-recovery-close');
    modalApi.body.classList.add('gb-owner-key-recovery-body');
    modalApi.body.dataset.e2eId = 'owner-key-recovery-body';
    overlay.addEventListener('click', event => {
      const action = event.target?.closest?.('[data-owner-key-recovery-action]')?.dataset?.ownerKeyRecoveryAction;
      if (action === 'derive') _setFromPassphrase(overlay);
      if (action === 'import') _importRaw(overlay);
      if (action === 'export') _exportBackup(overlay);
    });
    if (!owner) _status(overlay, '管理者のみ実行できます。', true);
    modalApi.open();
    return overlay;
  }

  function notifyMissingOwnerKey(reason) {
    const now = Date.now();
    if (now - _lastNotifyAt < 30000) return;
    _lastNotifyAt = now;
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => showRecoveryDialog({ reason }), { once: true });
    } else {
      showRecoveryDialog({ reason });
    }
  }

  async function ensureOwnerKeyOrPrompt(reason) {
    const key = await window.MeldexOwnerKeyStore?.getRawKey?.({ create: false });
    if (key) return true;
    notifyMissingOwnerKey(reason);
    return false;
  }

  window.MeldexOwnerKeyRecovery = {
    showRecoveryDialog,
    notifyMissingOwnerKey,
    ensureOwnerKeyOrPrompt,
  };
})();
