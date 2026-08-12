/* gb-settings-cli-usage.js: truthful local CLI plan and remaining-limit UI */
(function () {
  'use strict';

  const PROVIDER_LABELS = { codex: 'Codex CLI', claude_code: 'Claude Code', antigravity_cli: 'Antigravity CLI' };
  const PLAN_LABELS = { pro: 'Pro', plus: 'Plus', team: 'Team', max: 'Max' };

  function isDesktopCliSurface() {
    return !(window.MeldexRuntimeAdapter?.isPwaMode?.()
      || ['browser', 'dropbox', 'server'].includes(document.body?.dataset?.cloudMode || ''));
  }

  function planLabel(value) {
    const raw = String(value || '').trim();
    return PLAN_LABELS[raw.toLowerCase()] || raw || '取得不可';
  }
  function windowLabel(info) {
    const minutes = Number(info?.window_minutes || 0);
    if (minutes === 10080) return '7日間';
    if (minutes === 300) return '5時間';
    if (minutes > 0 && minutes % 1440 === 0) return `${minutes / 1440}日間`;
    if (minutes > 0 && minutes % 60 === 0) return `${minutes / 60}時間`;
    return info?.name || '利用上限';
  }
  function resetLabel(timestamp) {
    const value = Number(timestamp || 0);
    if (!value) return '';
    try { return new Date(value * 1000).toLocaleString('ja-JP'); } catch { return ''; }
  }
  function usageRowHtml(key, usage) {
    const label = PROVIDER_LABELS[key] || key;
    const windows = Array.isArray(usage?.windows) ? usage.windows : [];
    if (!windows.length) return '';
    const bars = windows.length ? windows.map(item => {
      const remaining = Math.max(0, Math.min(100, Number(item?.remaining_percent || 0)));
      const reset = resetLabel(item?.resets_at);
      const shown = remaining.toFixed(remaining % 1 ? 1 : 0);
      return `<div style="margin-top:6px;"><div style="display:flex;justify-content:space-between;gap:8px;font-size:11px;color:var(--fg2);"><span>${_settingsCliEsc(windowLabel(item))}</span><span>残り ${_settingsCliEsc(shown)}%${reset ? `／${_settingsCliEsc(reset)}に更新` : ''}</span></div><div role="progressbar" aria-label="${_settingsCliEsc(label)} ${_settingsCliEsc(windowLabel(item))}の残り使用量" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${_settingsCliEsc(remaining)}" style="height:7px;margin-top:3px;background:var(--bg3);border:1px solid var(--border);border-radius:999px;overflow:hidden;"><span style="display:block;width:${_settingsCliEsc(remaining)}%;height:100%;background:var(--accent);"></span></div></div>`;
    }).join('') : `<div aria-label="${_settingsCliEsc(label)}の残り使用量は取得できません" style="height:7px;margin-top:7px;background:repeating-linear-gradient(135deg,var(--bg3),var(--bg3) 6px,var(--border) 6px,var(--border) 8px);border:1px solid var(--border);border-radius:999px;"></div>`;
    return `<section data-cli-usage-provider="${_settingsCliEsc(key)}" style="padding:8px 10px;border:1px solid var(--border);border-radius:6px;background:var(--bg2);"><div style="display:flex;justify-content:space-between;gap:8px;align-items:center;"><strong style="font-size:12px;">${_settingsCliEsc(label)}</strong><span style="font-size:11px;color:var(--fg2);">プラン: ${_settingsCliEsc(planLabel(usage?.plan))}</span></div>${bars}${usage?.message ? `<div style="margin-top:6px;font-size:11px;color:var(--fg2);">${_settingsCliEsc(usage.message)}</div>` : ''}</section>`;
  }
  function selectedProvider() {
    return String(window._chatState?.provider || document.getElementById('chat-provider')?.value || '').trim();
  }
  function usagePanelHtml(payload, compact = false, providerKey = selectedProvider()) {
    const providers = payload?.providers || {};
    const body = Object.prototype.hasOwnProperty.call(PROVIDER_LABELS, providerKey)
      ? usageRowHtml(providerKey, providers[providerKey] || {})
      : '';
    return body ? `<div class="meldex-cli-usage-list" style="display:grid;gap:${compact ? 6 : 8}px;">${body}</div>` : '';
  }
  async function fetchUsage() {
    if (!isDesktopCliSurface()) throw new Error('CLIはデスクトップ版で設定してください。');
    return apiFetch('/cli-chat/usage', { silentError: true });
  }
  async function renderSettingsUsage(root) {
    const scope = root?.querySelector ? root : document;
    const host = scope.querySelector('#settings-cli-usage-status');
    if (!host) return;
    host.innerHTML = '<div class="gb-section-desc">プランと残り使用量を確認中...</div>';
    try { host.innerHTML = usagePanelHtml(await fetchUsage()) || ''; }
    catch (error) { host.innerHTML = `<div class="gb-section-desc" style="color:var(--fg2);">この環境ではCLIの利用量を確認できません。${_settingsCliEsc(error?.message || '')}</div>`; }
  }
  function extendSettingsRenderer() {
    if (typeof _renderCliChatSettingsContainer !== 'function' || _renderCliChatSettingsContainer.__usageExtended) return;
    const original = _renderCliChatSettingsContainer;
    const extended = function (container, config) {
      original(container, config);
      container.querySelector('#settings-cli-usage-status')?.remove();
      if (!isDesktopCliSurface()) return;
      const relay = container.querySelector('#settings-workspace-cli-relay-container');
      const section = document.createElement('section');
      section.id = 'settings-cli-usage-status';
      section.setAttribute('aria-label', 'CLIのプランと残り使用量');
      section.style.marginTop = '12px';
      section.innerHTML = '<div class="gb-section-desc">プランと残り使用量を確認中...</div>';
      container.insertBefore(section, relay || null);
      renderSettingsUsage(container.closest('.modal-overlay') || document);
    };
    extended.__usageExtended = true;
    _renderCliChatSettingsContainer = extended;
  }

  let popup = null;
  async function showCliUsagePopup(event) {
    event?.preventDefault?.(); event?.stopPropagation?.();
    if (popup) { popup.remove(); popup = null; return; }
    const button = event?.currentTarget || document.getElementById('chat-cli-usage-btn');
    if (!button) return;
    popup = document.createElement('div');
    popup.className = 'gb-context-menu chat-cli-usage-popup';
    popup.setAttribute('role', 'dialog');
    popup.setAttribute('aria-label', '残り使用量');
    popup.style.cssText = 'position:fixed;z-index:10080;width:min(360px,calc(100vw - 16px));max-height:min(520px,calc(100vh - 16px));overflow:auto;padding:10px;box-sizing:border-box;';
    popup.innerHTML = '<div class="gb-section-desc">プランと残り使用量を確認中...</div>';
    document.body.appendChild(popup);
    const rect = button.getBoundingClientRect();
    if (typeof positionPopup === 'function') positionPopup(popup, rect, { prefer: 'top', gap: 4 });
    else { popup.style.left = `${Math.max(8, rect.left)}px`; popup.style.bottom = `${Math.max(8, innerHeight - rect.top + 4)}px`; }
    const close = pointerEvent => {
      if (popup && !popup.contains(pointerEvent.target) && pointerEvent.target !== button) {
        popup.remove(); popup = null; document.removeEventListener('pointerdown', close, true);
      }
    };
    setTimeout(() => document.addEventListener('pointerdown', close, true), 0);
    try {
      const body = usagePanelHtml(await fetchUsage(), true);
      if (!body) { popup?.remove(); popup = null; return; }
      if (popup) popup.innerHTML = body;
    }
    catch (error) { if (popup) popup.textContent = `この環境ではCLIの利用量を確認できません。${error?.message || ''}`; }
  }
  function installChatControls() {
    const provider = selectedProvider();
    const providerSelect = document.getElementById('chat-provider');
    if (providerSelect && providerSelect.dataset.cliUsageBound !== '1') {
      providerSelect.dataset.cliUsageBound = '1';
      providerSelect.addEventListener('change', () => setTimeout(installChatControls, 0));
    }
    if (!isDesktopCliSurface() || !Object.prototype.hasOwnProperty.call(PROVIDER_LABELS, provider)) {
      document.getElementById('chat-cli-usage-btn')?.remove();
      if (popup) { popup.remove(); popup = null; }
      return;
    }
    const controls = document.querySelector('#chat-composer .chat-composer-controls');
    if (!controls || document.getElementById('chat-cli-usage-btn')) return;
    const button = document.createElement('button');
    button.id = 'chat-cli-usage-btn'; button.type = 'button'; button.title = '残り使用量';
    button.setAttribute('aria-label', '残り使用量');
    button.style.cssText = 'padding:2px 6px;background:var(--bg3);color:var(--fg2);border:1px solid var(--border);border-radius:3px;cursor:pointer;display:flex;align-items:center;justify-content:center;';
    button.innerHTML = typeof lucide === 'function' ? lucide('chartNoAxesCombined', 14) : '残量';
    button.addEventListener('click', showCliUsagePopup);
    controls.appendChild(button);
  }

  extendSettingsRenderer(); installChatControls();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', installChatControls, { once: true });
  if (document.body && typeof MutationObserver === 'function') {
    new MutationObserver(installChatControls).observe(document.body, {
      attributes: true,
      attributeFilter: ['data-cloud-mode'],
    });
  }
  window.showCliUsagePopup = showCliUsagePopup;
  window.MeldexCliUsageUi = { fetchUsage, renderSettingsUsage, showCliUsagePopup, isDesktopCliSurface };
})();
