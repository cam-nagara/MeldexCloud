(function () {
  'use strict';

  function isOffline() {
    return navigator.onLine === false;
  }

  function _isCloudMode() {
    return window.MeldexRuntimeAdapter?.isDropboxMode?.()
      || document.body?.dataset?.cloudMode === 'dropbox';
  }

  function _ensureIndicator() {
    const bar = document.getElementById('status-bar');
    if (!bar) return null;
    let node = document.getElementById('sb-offline');
    if (!node) {
      node = document.createElement('span');
      node.id = 'sb-offline';
      node.style.cssText = 'display:none;color:var(--warning,#ffd166);font-size:11px;white-space:nowrap;';
      const shortcuts = document.getElementById('sb-shortcuts');
      if (shortcuts) bar.insertBefore(node, shortcuts);
      else bar.appendChild(node);
    }
    return node;
  }

  function refresh() {
    const node = _ensureIndicator();
    if (!node) return;
    if (isOffline()) {
      node.style.display = '';
      node.textContent = 'オフライン中';
      document.body.dataset.onlineStatus = 'offline';
    } else {
      node.style.display = 'none';
      node.textContent = '';
      document.body.dataset.onlineStatus = 'online';
    }
  }

  function offlineMessage() {
    if (_isCloudMode()) {
      return 'オフライン中です。クラウド保存・検索・閲覧・LLM送信はネット接続後に再試行してください。';
    }
    return 'オフライン中です。編集・保存・検索・閲覧は使えますが、LLM送信はネット接続後に再試行してください。';
  }

  function assertOnlineForLlm() {
    if (!isOffline()) return true;
    const message = offlineMessage();
    if (typeof showStatus === 'function') showStatus(message, true);
    return false;
  }

  window.addEventListener('online', refresh);
  window.addEventListener('offline', refresh);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', refresh, { once: true });
  else refresh();

  window.MeldexOnlineStatus = {
    isOffline,
    refresh,
    offlineMessage,
    assertOnlineForLlm,
  };
})();
