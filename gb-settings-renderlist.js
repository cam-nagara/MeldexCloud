/* Owner-only RenderList bridge setup in Meldex settings. */
(function initRenderListSettings(global) {
  'use strict';

  function escapeHtml(value) {
    return global.MeldexEscape?.html?.(String(value ?? '')) ?? String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  }

  function notify(message, error = false) {
    if (typeof global.showStatus === 'function') global.showStatus(String(message || ''), error);
  }

  async function refresh(section) {
    try {
      const status = await apiFetch('/renderlist-connector/status', { silentError: true });
      const target = section.querySelector('[data-renderlist-status]');
      if (!target) return;
      target.textContent = status?.configured
        ? `接続済み · ${status.libraryId || ''} · 最終同期 ${status.lastSyncAt || '未実行'} · command ${status.pendingCommands || 0}件`
        : '未接続';
      target.dataset.error = status?.error ? '1' : '0';
      if (status?.error) target.textContent += ` · ${status.error}`;
    } catch (error) {
      const target = section.querySelector('[data-renderlist-status]');
      if (target) target.textContent = '接続状態を取得できません';
    }
  }

  function render(modal) {
    const panel = modal?.querySelector?.('.settings-panel[data-panel="全般"]');
    if (!panel || panel.querySelector('[data-settings-renderlist]')) return;
    const section = document.createElement('section');
    section.className = 'gb-section gb-section--boxed settings-section-wide';
    section.dataset.settingsView = 'renderlist';
    section.dataset.settingsRenderlist = '1';
    section.innerHTML = `
      <div class="gb-section-title">RenderList連携</div>
      <div class="gb-section-desc">RenderListが表示したpairing secretを一度だけ登録します。連携は選択したSMB/NASフォルダだけを使い、LAN待受ポートは開きません。</div>
      <div class="gb-section-desc" data-renderlist-status>接続状態を確認中...</div>
      <label class="gb-field"><span class="gb-label">Bridge root</span><input class="gb-input" data-renderlist-bridge-root placeholder="\\\\NAS\\RenderList\\bridge"></label>
      <label class="gb-field"><span class="gb-label">Analytics Library root</span><input class="gb-input" data-renderlist-analytics-root placeholder="\\\\NAS\\RenderList\\analytics-library"></label>
      <label class="gb-field"><span class="gb-label">分析シート保存先（任意）</span><input class="gb-input" data-renderlist-sheet-root placeholder="未指定時はホームフォルダ/RenderList分析"></label>
      <label class="gb-field"><span class="gb-label">Workspace ID（確認用）</span><input class="gb-input" data-renderlist-workspace-id></label>
      <label class="gb-field"><span class="gb-label">Pairing secret</span><input class="gb-input" type="password" autocomplete="new-password" data-renderlist-secret></label>
      <div class="gb-field-row">
        <button type="button" class="gb-btn gb-btn-sm" data-renderlist-pair>接続する</button>
        <button type="button" class="gb-btn gb-btn-sm" data-renderlist-sync>今すぐ同期</button>
        <button type="button" class="gb-btn gb-btn-sm gb-btn-quiet" data-renderlist-snapshot>全状態を再要求</button>
        <button type="button" class="gb-btn gb-btn-sm gb-btn-quiet" data-renderlist-disconnect>接続解除</button>
      </div>`;
    panel.appendChild(section);
    section.querySelector('[data-renderlist-pair]')?.addEventListener('click', async () => {
      const body = {
        bridgeRoot: section.querySelector('[data-renderlist-bridge-root]')?.value?.trim() || '',
        analyticsRoot: section.querySelector('[data-renderlist-analytics-root]')?.value?.trim() || '',
        analyticsSheetRoot: section.querySelector('[data-renderlist-sheet-root]')?.value?.trim() || '',
        workspaceId: section.querySelector('[data-renderlist-workspace-id]')?.value?.trim() || '',
        pairingSecret: section.querySelector('[data-renderlist-secret]')?.value?.trim() || '',
      };
      if (!body.bridgeRoot || !body.analyticsRoot || !body.pairingSecret) return notify('Bridge root、Analytics Library root、pairing secretを入力してください', true);
      try {
        await apiFetch('/renderlist-connector/pair', { method: 'POST', body });
        section.querySelector('[data-renderlist-secret]').value = '';
        notify('RenderListと接続しました');
        await refresh(section);
      } catch (error) { notify(error?.message || 'RenderList接続に失敗しました', true); }
    });
    section.querySelector('[data-renderlist-sync]')?.addEventListener('click', async () => {
      try { await apiFetch('/renderlist-connector/sync', { method: 'POST', body: {} }); notify('RenderListを同期しました'); await refresh(section); }
      catch (error) { notify(error?.message || 'RenderList同期に失敗しました', true); }
    });
    section.querySelector('[data-renderlist-snapshot]')?.addEventListener('click', async () => {
      try { await apiFetch('/renderlist-connector/request-snapshot', { method: 'POST', body: {} }); notify('RenderListへ全状態を要求しました'); }
      catch (error) { notify(error?.message || 'snapshot要求に失敗しました', true); }
    });
    section.querySelector('[data-renderlist-disconnect]')?.addEventListener('click', async () => {
      if (!global.confirm('このMeldex端末のRenderList接続設定と保護credentialを削除します。共有データは削除しません。')) return;
      try { await apiFetch('/renderlist-connector/disconnect', { method: 'POST', body: {} }); notify('RenderList接続を解除しました'); await refresh(section); }
      catch (error) { notify(error?.message || 'RenderList接続解除に失敗しました', true); }
    });
    refresh(section);
    if (typeof global._applySettingsNavigationView === 'function' && modal.dataset.settingsActivePageId) {
      const target = global.resolveSettingsNavigationTarget?.(modal.dataset.settingsActiveTabId || '導入・アプリ連携', { pageId: modal.dataset.settingsActivePageId });
      if (target) global._applySettingsNavigationView(modal, target);
    }
  }

  const observer = new MutationObserver(() => {
    document.querySelectorAll('.settings-modal').forEach(render);
  });
  const start = () => {
    observer.observe(document.documentElement, { childList: true, subtree: true });
    document.querySelectorAll('.settings-modal').forEach(render);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
  global.MeldexRenderListSettings = Object.freeze({ render, refresh });
})(window);
