(function () {
  'use strict';

  const internals = window.__MeldexPwaDataAccessInternals;
  if (!internals) return;

  const { _pathExists } = internals;
  const TARGETS = [
    { scope: 'knowledge_items', path: '_knowledge/knowledge_items.json', label: '記憶継承' },
    { scope: 'chat_rules', path: '_knowledge/chat_rules.json', label: 'チャットルール' },
    { scope: 'status_policies', path: '_knowledge/status_policies.json', label: 'ステータス別ポリシー' },
    { scope: 'taste_settings', path: '_knowledge/taste_settings.json', label: '感性設定' },
    { scope: 'taste_principles', path: '_knowledge/taste_principles.json', label: '感性原則' },
    { scope: 'taste_feedback', path: '_knowledge/taste_feedback.json', label: '感性フィードバック' },
    { scope: 'memory_directives', path: '_knowledge/memory_directives.json', label: 'メモリ指令' },
    { scope: 'file_locks', path: '_meldex/file_locks.json', label: '編集ロック' },
    { scope: 'audit_log', path: '_meldex/audit-log.json', label: '監査ログ' },
  ];
  const CHECK_INTERVAL_MS = 5 * 60 * 1000;
  let _timer = 0;
  let _initialCheckTimer = 0;
  let _modeObserver = null;
  let _lastResult = null;
  let _recoveryDialog = null;

  function _isDropboxMode() {
    return window.MeldexRuntimeAdapter?.isDropboxMode?.() || document.body?.dataset?.cloudMode === 'dropbox';
  }

  async function _provider() {
    return window.MeldexStorageAdapter?.getProvider?.() || null;
  }

  function _esc(value) {
    return MeldexEscape.html(value);
  }

  function _icon(name, size, fallback) {
    return typeof lucide === 'function' ? lucide(name, size || 14) : _esc(fallback || '');
  }

  function _e2eId(value) {
    return String(value || '').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'item';
  }

  async function _readPayload(provider, target) {
    const exists = typeof _pathExists === 'function' ? await _pathExists(provider, target.path).catch(() => false) : true;
    if (!exists) return { payload: null, missing_store: true };
    try {
      const raw = await provider.readText(target.path);
      const payload = JSON.parse(String(raw || 'null'));
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        return { payload: null, malformed_store: true, error: 'JSON object expected' };
      }
      return { payload, missing_store: false };
    } catch (err) {
      return { payload: null, malformed_store: true, error: err?.message || String(err) };
    }
  }

  async function checkTarget(provider, target) {
    const read = await _readPayload(provider, target);
    if (read.missing_store) return { ...target, ok: true, missing_store: true, verification: { ok: true, skipped: true, reason: 'store-missing' } };
    if (read.malformed_store) return { ...target, ok: false, malformed_store: true, verification: { ok: false, error: read.error || 'broken-json' } };
    const verification = await window.MeldexKnowledgeSignature?.verify?.(provider, target.scope, read.payload).catch(err => ({ ok: false, error: err?.message || String(err) }));
    return { ...target, ok: verification?.ok !== false, verification };
  }

  async function checkAll(provider) {
    const p = provider || await _provider();
    if (!p) return { ok: true, skipped: true, items: [] };
    const items = [];
    for (const target of TARGETS) {
      items.push(await checkTarget(p, target));
    }
    const failed = items.filter(item => item.ok === false);
    const result = { ok: failed.length === 0, items, failed, checked_at: new Date().toISOString() };
    _lastResult = result;
    if (failed.length) showIntegrityBanner(failed);
    else _removeBanner();
    return result;
  }

  async function resignAll(provider) {
    const p = provider || await _provider();
    if (!p) throw new Error('Dropbox provider が未初期化です');
    const signed = [];
    for (const target of TARGETS) {
      const read = await _readPayload(p, target);
      if (!read.payload) continue;
      await window.MeldexKnowledgeSignature?.sign?.(p, target.scope, read.payload, { signer: typeof getUsername === 'function' ? getUsername() : '' });
      signed.push(target.scope);
    }
    await window.MeldexKnowledgeSignature?.recordAudit?.(p, 'owner_key', { action: 'resign-all', scopes: signed }).catch(() => {});
    return { ok: true, signed };
  }

  function _removeBanner() {
    document.getElementById('knowledge-integrity-banner')?.remove();
  }

  function showIntegrityBanner(failed) {
    if (!_isDropboxMode()) return;
    let bar = document.getElementById('knowledge-integrity-banner');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'knowledge-integrity-banner';
      bar.className = 'gb-knowledge-integrity-banner';
      bar.dataset.e2eId = 'knowledge-integrity-banner';
      bar.setAttribute('role', 'alert');
      bar.setAttribute('aria-live', 'polite');
      document.body.appendChild(bar);
    }
    const labels = (failed || []).map(item => item.label).join('、');
    bar.innerHTML = `
      <div class="gb-knowledge-integrity-message">ナレッジ署名の検証に失敗しました: ${_esc(labels)}</div>
      <div class="gb-knowledge-integrity-actions">
        <button type="button" class="gb-btn gb-btn-sm gb-btn-warn" data-ki-recover data-e2e-id="knowledge-integrity-banner-recover" aria-label="ナレッジ署名の復旧を開く">${_icon('history', 14, '')} 復旧</button>
        <button type="button" class="gb-btn gb-btn-sm gb-btn-quiet" data-ki-close data-e2e-id="knowledge-integrity-banner-close" aria-label="ナレッジ署名の警告を閉じる">${_icon('x', 14, '')} 閉じる</button>
      </div>
    `;
    bar.querySelector('[data-ki-recover]')?.addEventListener('click', event => openRecoveryDialog(failed, { trigger: event.currentTarget }));
    bar.querySelector('[data-ki-close]')?.addEventListener('click', _removeBanner);
  }

  async function _confirmRestore(target, versionName) {
    const label = target?.label || '対象ファイル';
    const version = versionName || '選択した履歴';
    const message = `${label}を「${version}」へ復元しますか？現在の内容は上書きされます。`;
    if (typeof cfConfirm === 'function') {
      return await cfConfirm(message, { danger: true, okLabel: '復元', cancelLabel: 'キャンセル' });
    }
    return typeof window.confirm === 'function' ? !!window.confirm(message) : true;
  }

  async function _loadVersions(target, root, options = {}) {
    const box = root.querySelector(`[data-ki-versions="${target.scope}"]`);
    if (!box) return;
    const setBusy = typeof options.setBusy === 'function' ? options.setBusy : () => {};
    setBusy(true);
    box.textContent = '履歴を読み込み中...';
    try {
      const payload = await window.MeldexDataAccess?.requestJson?.('/version/list?path=' + encodeURIComponent(target.path));
      const versions = Array.isArray(payload) ? payload : [];
      if (!versions.length) {
        box.textContent = '履歴はありません。Dropbox Web の履歴も確認してください。';
        return;
      }
      box.innerHTML = versions.slice(0, 10).map(version => `
        <div class="gb-knowledge-integrity-version-row">
          <span class="gb-knowledge-integrity-version-name">${_esc(version.name)} <span class="gb-section-desc">${_esc(version.created || version.modified || '')}</span></span>
          <button type="button" class="gb-btn gb-btn-xs gb-btn-warn" data-ki-restore="${_esc(target.scope)}" data-version="${_esc(version.name)}" data-e2e-id="knowledge-integrity-restore-${_e2eId(target.scope)}-${_e2eId(version.name)}" aria-label="${_esc(target.label)}を${_esc(version.name)}へ復元">復元</button>
        </div>
      `).join('') + `<div class="gb-inline-error gb-knowledge-integrity-error" data-ki-error="${_esc(target.scope)}" data-e2e-id="knowledge-integrity-error-${_e2eId(target.scope)}" role="alert" hidden></div>`;
      box.querySelectorAll('[data-ki-restore]').forEach(btn => {
        btn.addEventListener('click', async () => {
          const versionName = btn.dataset.version || '';
          if (!await _confirmRestore(target, versionName)) return;
          const error = box.querySelector(`[data-ki-error="${target.scope}"]`);
          if (error) {
            error.hidden = true;
            error.textContent = '';
          }
          setBusy(true);
          try {
            await window.MeldexDataAccess?.requestJson?.('/version/restore', {
              method: 'POST',
              body: JSON.stringify({ path: target.path, version: versionName }),
            });
            await checkAll();
            if (typeof showStatus === 'function') showStatus('復元しました');
            const scrollHost = box.closest('.gb-modal-body');
            if (scrollHost) scrollHost.scrollTop = 0;
          } catch (err) {
            if (error) {
              error.textContent = `復元できませんでした: ${err?.message || String(err)}`;
              error.hidden = false;
              error.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
            }
          } finally {
            setBusy(false);
          }
        });
      });
    } catch (err) {
      box.textContent = '履歴の取得に失敗: ' + (err?.message || err);
    } finally {
      setBusy(false);
    }
  }

  function openRecoveryDialog(items, options = {}) {
    const targets = (items && items.length ? items : _lastResult?.failed || TARGETS).map(item => TARGETS.find(target => target.scope === item.scope) || item);
    if (_recoveryDialog?.isOpen?.()) {
      const closed = _recoveryDialog.close('replace');
      if (closed === false) return _recoveryDialog;
    }
    const restoreTarget = options.trigger instanceof HTMLElement
      ? options.trigger
      : (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    const content = document.createElement('div');
    content.className = 'gb-knowledge-integrity-content';
    content.innerHTML = `
      <div class="gb-section-desc">Dropboxのファイル履歴から署名検証に失敗したJSONを復元できます。復元後に再検証してください。</div>
      ${targets.map(target => `
        <section class="gb-section gb-section--boxed gb-knowledge-integrity-target">
          <div class="gb-field-row gb-knowledge-integrity-target-header">
            <div class="gb-knowledge-integrity-target-meta">
              <div class="gb-section-title">${_esc(target.label)}</div>
              <div class="gb-section-desc">${_esc(target.path)}</div>
            </div>
            <button type="button" class="gb-btn gb-btn-sm" data-ki-load="${_esc(target.scope)}" data-e2e-id="knowledge-integrity-load-${_e2eId(target.scope)}" aria-label="${_esc(target.label)}の履歴を表示">履歴を表示</button>
          </div>
          <div data-ki-versions="${_esc(target.scope)}" class="gb-section-desc gb-knowledge-integrity-version-list"></div>
        </section>
      `).join('')}
    `;
    let busy = false;
    let dialogApi = null;
    dialogApi = window.GBUI.createModal({
      id: 'knowledge-integrity-recovery',
      title: 'ナレッジ署名の復旧',
      body: content,
      variant: 'standard',
      extraClass: 'gb-knowledge-integrity-dialog',
      resizable: false,
      initialFocus: '[data-ki-load]',
      returnFocus: restoreTarget,
      closeLabel: 'ナレッジ署名の復旧を閉じる',
      onBeforeClose: () => !busy,
      onClose: () => {
        if (_recoveryDialog === dialogApi) _recoveryDialog = null;
      },
    });
    _recoveryDialog = dialogApi;
    const { overlay } = dialogApi;
    overlay.dataset.knowledgeIntegrityRecovery = '1';
    overlay.dataset.e2eId = 'knowledge-integrity-recovery-overlay';
    dialogApi.modal.dataset.e2eId = 'knowledge-integrity-recovery-dialog';
    dialogApi.header.classList.add('gb-knowledge-integrity-header');
    dialogApi.body.classList.add('gb-knowledge-integrity-dialog-body');
    const closeButton = dialogApi.header.querySelector('.gb-modal-close');
    if (closeButton) {
      closeButton.dataset.kiClose = '';
      closeButton.dataset.e2eId = 'knowledge-integrity-recovery-close';
    }
    const setBusy = value => {
      busy = !!value;
      overlay.setAttribute('aria-busy', busy ? 'true' : 'false');
      overlay.querySelectorAll('button').forEach(button => { button.disabled = busy; });
    };
    overlay.querySelectorAll('[data-ki-load]').forEach(btn => {
      const target = targets.find(item => item.scope === btn.dataset.kiLoad);
      if (target) btn.addEventListener('click', () => _loadVersions(target, overlay, { setBusy }));
    });
    dialogApi.open();
    return dialogApi;
  }

  function stopMonitor() {
    if (_timer) clearInterval(_timer);
    _timer = 0;
    if (_initialCheckTimer) clearTimeout(_initialCheckTimer);
    _initialCheckTimer = 0;
  }

  function _checkOrStop() {
    if (!_isDropboxMode()) {
      stopMonitor();
      return;
    }
    checkAll().catch(() => {});
  }

  function startMonitor() {
    stopMonitor();
    if (!_isDropboxMode()) return;
    _timer = setInterval(() => {
      if (_isDropboxMode()) checkAll().catch(() => {});
      else stopMonitor();
    }, CHECK_INTERVAL_MS);
    _initialCheckTimer = setTimeout(() => {
      _initialCheckTimer = 0;
      _checkOrStop();
    }, 5000);
  }

  function _syncMonitorForMode() {
    if (_isDropboxMode()) startMonitor();
    else stopMonitor();
  }

  function _bindModeObserver() {
    if (_modeObserver || !document.body || typeof MutationObserver === 'undefined') return;
    _modeObserver = new MutationObserver(_syncMonitorForMode);
    _modeObserver.observe(document.body, { attributes: true, attributeFilter: ['data-cloud-mode'] });
  }

  function _initMonitor() {
    _bindModeObserver();
    startMonitor();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _initMonitor, { once: true });
  else _initMonitor();

  window.MeldexKnowledgeIntegrity = {
    targets: TARGETS.map(target => ({ ...target })),
    checkAll,
    checkTarget,
    resignAll,
    startMonitor,
    stopMonitor,
    showIntegrityBanner,
    openRecoveryDialog,
  };
})();
