(function () {
  'use strict';

  let _observer = null;
  let _activeAuditTrigger = null;

  function _esc(value) {
    if (typeof esc === 'function') return esc(value);
    return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function _icon(name, size = 14) {
    return typeof lucide === 'function' ? lucide(name, size) : '';
  }

  function _restoreFocus(el) {
    if (!el?.isConnected || typeof el.focus !== 'function') return;
    try { el.focus({ preventScroll: true }); } catch { try { el.focus(); } catch {} }
  }

  function _closeAuditDialog(overlay, trigger = _activeAuditTrigger) {
    if (!overlay?.isConnected) return;
    overlay.remove();
    _activeAuditTrigger = null;
    setTimeout(() => _restoreFocus(trigger), 0);
  }

  async function _promptImportKey() {
    if (typeof cfPrompt === 'function') {
      return await cfPrompt('管理者鍵を貼り付けてください', '', { okLabel: 'インポート' });
    }
    return window.prompt('管理者鍵を貼り付けてください');
  }

  function _isOwner() {
    return window.MeldexKnowledgeCloudStore?.role?.() === 'owner'
      || window.MeldexRuntimeAdapter?.getWorkspaceState?.()?.isOwner === true;
  }

  async function _provider() {
    return window.MeldexStorageAdapter?.getProvider?.() || null;
  }

  function _status(root, text, error) {
    const el = root?.querySelector?.('[data-owner-key-status]');
    if (!el) return;
    el.textContent = text || '';
    el.style.color = error ? 'var(--danger)' : 'var(--fg2)';
  }

  async function _resign(root) {
    const provider = await _provider();
    if (!provider) return { signed: [] };
    const result = await window.MeldexKnowledgeIntegrity?.resignAll?.(provider);
    _status(root, `再署名しました: ${(result?.signed || []).length}件`);
    return result;
  }

  async function _derive(root) {
    if (!_isOwner()) return _status(root, '管理者のみ実行できます', true);
    const pass = root.querySelector('[data-owner-key-passphrase]')?.value || '';
    if (!pass) return _status(root, 'パスフレーズを入力してください', true);
    try {
      await window.MeldexOwnerKeyStore?.deriveFromPassphrase?.(pass);
      await _resign(root);
    } catch (err) {
      _status(root, err?.message || String(err), true);
    }
  }

  async function _rotate(root) {
    if (!_isOwner()) return _status(root, '管理者のみ実行できます', true);
    const ok = typeof cfConfirm === 'function'
      ? await cfConfirm('管理者鍵をローテーションします。既存の署名対象を新しい鍵で再署名しますか？')
      : window.confirm('管理者鍵をローテーションします。既存の署名対象を新しい鍵で再署名しますか？');
    if (!ok) return;
    try {
      await window.MeldexOwnerKeyStore?.createRandomKey?.();
      await _resign(root);
      _status(root, '管理者鍵をローテーションしました');
    } catch (err) {
      _status(root, err?.message || String(err), true);
    }
  }

  async function _export(root) {
    if (!_isOwner()) return _status(root, '管理者のみ実行できます', true);
    try {
      const value = await window.MeldexOwnerKeyStore?.getRawKey?.({ create: false });
      if (!value) return _status(root, '管理者鍵は未設定です', true);
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
        _status(root, '管理者鍵をクリップボードへコピーしました');
      } else {
        window.prompt('管理者鍵', value);
        _status(root, '管理者鍵を表示しました');
      }
    } catch (err) {
      _status(root, err?.message || String(err), true);
    }
  }

  function _openRecovery(root) {
    if (!_isOwner()) return _status(root, '管理者のみ実行できます', true);
    const trigger = arguments[1] || root?.querySelector?.('[data-owner-key-action="recovery"]');
    window.MeldexOwnerKeyRecovery?.showRecoveryDialog?.({ trigger });
  }

  async function _import(root) {
    if (!_isOwner()) return _status(root, '管理者のみ実行できます', true);
    const value = await _promptImportKey();
    if (!value) return;
    try {
      await window.MeldexOwnerKeyStore?.setRawKey?.(value.trim());
      await _resign(root);
      _status(root, '管理者鍵をインポートして再署名しました');
    } catch (err) {
      _status(root, err?.message || String(err), true);
    }
  }

  async function _verify(root) {
    try {
      const result = await window.MeldexKnowledgeIntegrity?.checkAll?.();
      if (!result || result.skipped) return _status(root, 'Dropbox provider が未初期化です', true);
      if (result.ok) return _status(root, `署名検証OK (${result.items.length}件)`);
      const missingKey = (result.failed || []).some(item => item?.verification?.missing_key || item?.verification?.reason === 'owner-key-missing');
      if (missingKey) {
        _status(root, '管理者鍵がこの端末にありません。復旧UIを開いてください。', true);
        if (_isOwner()) window.MeldexOwnerKeyRecovery?.showRecoveryDialog?.({ reason: '署名検証に必要な管理者鍵がこの端末にありません。', trigger: root.querySelector('[data-owner-key-action="verify"]') });
        return;
      }
      _status(root, `署名検証NG: ${result.failed.map(item => item.label).join('、')}`, true);
      window.MeldexKnowledgeIntegrity?.openRecoveryDialog?.(result.failed);
    } catch (err) {
      _status(root, err?.message || String(err), true);
    }
  }

  async function _audit(root, trigger) {
    try {
      const provider = await _provider();
      if (!provider) return _status(root, 'Dropbox provider が未初期化です', true);
      const rows = await window.MeldexKnowledgeSignature?.readAudit?.(provider).catch(() => []) || [];
      _openAuditDialog(rows, { trigger });
      _status(root, `監査ログ ${rows.length}件`);
    } catch (err) {
      _status(root, err?.message || String(err), true);
    }
  }

  function _openAuditDialog(rows, options = {}) {
    document.querySelectorAll('.modal-overlay[data-owner-key-audit="1"]').forEach(el => el.remove());
    const trigger = options.trigger || document.activeElement;
    _activeAuditTrigger = trigger && document.contains(trigger) ? trigger : null;
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.dataset.ownerKeyAudit = '1';
    overlay.dataset.e2eId = 'owner-key-audit-overlay';
    overlay.innerHTML = `
      <div class="modal gb-owner-key-audit-dialog" role="dialog" aria-modal="true" aria-labelledby="owner-key-audit-title" data-e2e-id="owner-key-audit-dialog">
        <div class="gb-modal-header gb-owner-key-dialog-header">
          <h3 id="owner-key-audit-title" class="gb-modal-title">ナレッジ監査ログ</h3>
          <button type="button" class="gb-btn gb-btn-sm gb-btn-icon gb-owner-key-dialog-close" aria-label="監査ログを閉じる" data-owner-key-audit-close data-e2e-id="owner-key-audit-close">${_icon('x', 14) || '閉じる'}</button>
        </div>
        <div class="gb-modal-body gb-owner-key-audit-body" role="list" data-e2e-id="owner-key-audit-body">
          ${(rows || []).slice().reverse().slice(0, 200).map(row => `
            <div class="gb-owner-key-audit-row" role="listitem" data-e2e-id="owner-key-audit-row">
              <div><strong>${_esc(row.type || 'event')}</strong> <span class="gb-section-desc">${_esc(row.at || '')}</span></div>
              <pre class="gb-owner-key-audit-json">${_esc(JSON.stringify(row, null, 2))}</pre>
            </div>
          `).join('') || '<div class="gb-section-desc">監査ログはまだありません。</div>'}
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    const close = () => _closeAuditDialog(overlay, _activeAuditTrigger);
    overlay.querySelector('[data-owner-key-audit-close]')?.addEventListener('click', close);
    overlay.addEventListener('click', event => { if (event.target === overlay) close(); });
    overlay.addEventListener('keydown', event => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      close();
    });
    if (window.GBModalShell?.enhanceOverlay) window.GBModalShell.enhanceOverlay(overlay);
    setTimeout(() => overlay.querySelector('[data-owner-key-audit-close]')?.focus?.({ preventScroll: true }), 0);
    return overlay;
  }

  function _renderSection(panel) {
    if (!panel || panel.querySelector('[data-owner-key-section]')) return;
    const section = document.createElement('section');
    section.className = 'gb-section gb-section--boxed gb-owner-key-section';
    section.dataset.ownerKeySection = '1';
    section.dataset.e2eId = 'owner-key-section';
    section.setAttribute('role', 'region');
    section.setAttribute('aria-labelledby', 'owner-key-section-title');
    const owner = _isOwner();
    section.innerHTML = `
      <div class="gb-section-title gb-owner-key-title" id="owner-key-section-title">${_icon('keyRound', 14)} 管理者鍵 / 改竄検知</div>
      <div class="gb-section-desc">ナレッジ、編集ロック、監査対象JSONのHMAC署名に使う鍵です。鍵はこの端末のブラウザ内に暗号化して保存され、Dropboxには保存されません。</div>
      <label class="gb-field-row gb-owner-key-passphrase-row">
        <span class="gb-label gb-owner-key-label">パスフレーズ</span>
        <input type="password" class="gb-input gb-owner-key-passphrase-input" data-setting="owner-key-passphrase" data-owner-key-passphrase data-e2e-id="owner-key-passphrase" aria-label="管理者鍵パスフレーズ" autocomplete="new-password" ${owner ? '' : 'disabled'} placeholder="${_esc(window.MeldexOwnerKeyStore?.PASSPHRASE_MIN_LENGTH || 12)}文字以上">
        <button type="button" class="gb-btn gb-btn-sm gb-owner-key-action" data-setting="owner-key-derive" data-owner-key-action="derive" data-e2e-id="owner-key-derive" aria-label="パスフレーズから導出して再署名" ${owner ? '' : 'disabled'}>導出して再署名</button>
      </label>
      <div class="gb-field-row gb-owner-key-actions">
        <button type="button" class="gb-btn gb-btn-sm gb-btn-quiet gb-owner-key-action" data-setting="owner-key-verify" data-owner-key-action="verify" data-e2e-id="owner-key-verify" aria-label="署名を検証">署名検証</button>
        <button type="button" class="gb-btn gb-btn-sm gb-btn-quiet gb-owner-key-action" data-setting="owner-key-export" data-owner-key-action="export" ${owner ? '' : 'disabled'} data-e2e-id="owner-key-export" aria-label="管理者鍵をコピー">鍵をコピー</button>
        <button type="button" class="gb-btn gb-btn-sm gb-btn-quiet gb-owner-key-action" data-setting="owner-key-import" data-owner-key-action="import" data-e2e-id="owner-key-import" aria-label="管理者鍵をインポート" ${owner ? '' : 'disabled'}>鍵をインポート</button>
        <button type="button" class="gb-btn gb-btn-sm gb-btn-quiet gb-owner-key-action" data-setting="owner-key-rotate" data-owner-key-action="rotate" data-e2e-id="owner-key-rotate" aria-label="管理者鍵をローテーション" ${owner ? '' : 'disabled'}>鍵ローテーション</button>
        <button type="button" class="gb-btn gb-btn-sm gb-btn-quiet gb-owner-key-action" data-setting="owner-key-audit" data-owner-key-action="audit" data-e2e-id="owner-key-audit" aria-label="監査ログを開く">監査ログ</button>
        <button type="button" class="gb-btn gb-btn-sm gb-btn-quiet gb-owner-key-action" data-setting="owner-key-recovery" data-owner-key-action="recovery" ${owner ? '' : 'disabled'} data-e2e-id="owner-key-recovery" aria-label="管理者鍵の復旧UIを開く">復旧UI</button>
      </div>
      <div class="gb-section-desc gb-owner-key-status" data-owner-key-status data-e2e-id="owner-key-status" role="status" aria-live="polite">${owner ? '管理者権限あり' : '閲覧のみ。鍵更新は管理者のみ可能です。'}</div>
    `;
    section.addEventListener('click', event => {
      const trigger = event.target?.closest?.('[data-owner-key-action]');
      const action = trigger?.dataset?.ownerKeyAction;
      if (!action) return;
      if (action === 'derive') _derive(section);
      if (action === 'rotate') _rotate(section);
      if (action === 'export') _export(section);
      if (action === 'import') _import(section);
      if (action === 'verify') _verify(section);
      if (action === 'audit') _audit(section, trigger);
      if (action === 'recovery') _openRecovery(section, trigger);
    });
    panel.appendChild(section);
  }

  function refreshOwnerKeySettingsSection(root) {
    const scope = root || document;
    scope.querySelectorAll?.('.settings-panel[data-panel="LLM"]').forEach(_renderSection);
  }

  function startObserver() {
    refreshOwnerKeySettingsSection(document);
    if (_observer) _observer.disconnect();
    const callback = mutations => {
      for (const mutation of mutations) {
        mutation.addedNodes?.forEach(node => {
          if (node?.nodeType === 1) refreshOwnerKeySettingsSection(node);
        });
      }
    };
    const filter = mutation => Array.from(mutation.addedNodes || []).some(node => {
      if (node?.nodeType !== 1) return false;
      return node.matches?.('.settings-panel[data-panel="LLM"]') || !!node.querySelector?.('.settings-panel[data-panel="LLM"]');
    });
    if (window.GBMutationBus) {
      _observer = window.GBMutationBus.subscribe('owner-key-settings', { filter, callback, throttle: 50 });
    } else {
      _observer = new MutationObserver(callback);
      _observer.observe(document.body, { childList: true, subtree: true });
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startObserver, { once: true });
  else startObserver();

  window.MeldexOwnerKeyUi = {
    refreshOwnerKeySettingsSection,
    openAuditDialog: _openAuditDialog,
  };
})();
