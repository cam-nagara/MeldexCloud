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

  function _isDropboxMode() {
    return window.MeldexRuntimeAdapter?.isDropboxMode?.() || document.body?.dataset?.cloudMode === 'dropbox';
  }

  async function _provider() {
    return window.MeldexStorageAdapter?.getProvider?.() || null;
  }

  function _esc(value) {
    if (typeof esc === 'function') return esc(value);
    return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
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
      bar.style.cssText = 'position:fixed;left:12px;right:12px;top:48px;z-index:100000;padding:10px 12px;border:1px solid #8a4d18;border-radius:8px;background:#3b2817;color:#ffd6a6;display:flex;gap:10px;align-items:center;box-shadow:0 10px 30px rgba(0,0,0,.28);';
      document.body.appendChild(bar);
    }
    const labels = (failed || []).map(item => item.label).join('、');
    bar.innerHTML = `
      <div style="flex:1;min-width:0;">ナレッジ署名の検証に失敗しました: ${_esc(labels)}</div>
      <button type="button" data-ki-recover style="padding:5px 10px;border:1px solid #9f6a2f;border-radius:6px;background:#5a3518;color:#fff;cursor:pointer;">復旧</button>
      <button type="button" data-ki-close style="padding:5px 10px;border:1px solid #9f6a2f;border-radius:6px;background:transparent;color:#ffd6a6;cursor:pointer;">閉じる</button>
    `;
    bar.querySelector('[data-ki-recover]')?.addEventListener('click', () => openRecoveryDialog(failed));
    bar.querySelector('[data-ki-close]')?.addEventListener('click', _removeBanner);
  }

  async function _loadVersions(target, root) {
    const box = root.querySelector(`[data-ki-versions="${target.scope}"]`);
    if (!box) return;
    box.textContent = '履歴を読み込み中...';
    try {
      const payload = await window.MeldexDataAccess?.requestJson?.('/version/list?path=' + encodeURIComponent(target.path));
      const versions = Array.isArray(payload) ? payload : [];
      if (!versions.length) {
        box.textContent = '履歴はありません。Dropbox Web の履歴も確認してください。';
        return;
      }
      box.innerHTML = versions.slice(0, 10).map(version => `
        <div style="display:flex;gap:8px;align-items:center;justify-content:space-between;border-top:1px solid var(--border);padding:6px 0;">
          <span>${_esc(version.name)} <span class="gb-section-desc">${_esc(version.created || version.modified || '')}</span></span>
          <button type="button" class="gb-btn gb-btn-xs" data-ki-restore="${_esc(target.scope)}" data-version="${_esc(version.name)}">復元</button>
        </div>
      `).join('');
      box.querySelectorAll('[data-ki-restore]').forEach(btn => {
        btn.addEventListener('click', async () => {
          await window.MeldexDataAccess?.requestJson?.('/version/restore', {
            method: 'POST',
            body: JSON.stringify({ path: target.path, version: btn.dataset.version }),
          });
          await checkAll();
          if (typeof showStatus === 'function') showStatus('復元しました');
        });
      });
    } catch (err) {
      box.textContent = '履歴の取得に失敗: ' + (err?.message || err);
    }
  }

  function openRecoveryDialog(items) {
    const targets = (items && items.length ? items : _lastResult?.failed || TARGETS).map(item => TARGETS.find(target => target.scope === item.scope) || item);
    document.querySelectorAll('.modal-overlay[data-knowledge-integrity-recovery="1"]').forEach(el => el.remove());
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.dataset.knowledgeIntegrityRecovery = '1';
    overlay.innerHTML = `
      <div class="modal" style="width:760px;max-width:94vw;height:620px;max-height:88vh;display:flex;flex-direction:column;">
        <div class="gb-field-row" style="justify-content:space-between;gap:8px;margin-bottom:8px;">
          <h3 style="margin:0;">ナレッジ署名の復旧</h3>
          <button type="button" class="gb-btn gb-btn-sm" data-ki-close>${typeof lucide === 'function' ? lucide('x', 14) : '閉じる'}</button>
        </div>
        <div class="gb-section-desc">Dropboxのファイル履歴から署名検証に失敗したJSONを復元できます。復元後に再検証してください。</div>
        <div style="overflow:auto;min-height:0;flex:1;margin-top:8px;">
          ${targets.map(target => `
            <section class="gb-section gb-section--boxed">
              <div class="gb-field-row" style="justify-content:space-between;gap:8px;">
                <div>
                  <div class="gb-section-title">${_esc(target.label)}</div>
                  <div class="gb-section-desc">${_esc(target.path)}</div>
                </div>
                <button type="button" class="gb-btn gb-btn-sm" data-ki-load="${_esc(target.scope)}">履歴を表示</button>
              </div>
              <div data-ki-versions="${_esc(target.scope)}" class="gb-section-desc"></div>
            </section>
          `).join('')}
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.querySelector('[data-ki-close]')?.addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', event => { if (event.target === overlay) overlay.remove(); });
    overlay.querySelectorAll('[data-ki-load]').forEach(btn => {
      const target = targets.find(item => item.scope === btn.dataset.kiLoad);
      if (target) btn.addEventListener('click', () => _loadVersions(target, overlay));
    });
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
