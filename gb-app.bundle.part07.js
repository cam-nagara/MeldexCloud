  if (!group.operation) {
    if (_loadingVisible) _renderLoadingUi(_loadingMessage);
    else if (!_loadingTimer) _loadingTimer = setTimeout(() => {
      _loadingTimer = null;
      if (_loadingCount > 0) _renderLoadingUi(_loadingMessage);
    }, 300);
  }
  return lease;
}

function hideLoading(lease) {
  // No-argument calls retain legacy stack semantics. An explicit missing or
  // already completed lease must never dismiss another invocation's task.
  const current = arguments.length ? lease : _loadingOperations[_loadingOperations.length - 1];
  if (!current?.active) return;
  const index = _loadingOperations.indexOf(current);
  if (index < 0) return;
  _loadingOperations.splice(index, 1);
  current.active = false;
  const group = current.group;
  if (--group.refs === 0) {
    _loadingGroups.delete(group.key);
    group.operation?.succeed({ dismissMs: 0 });
  }
  _loadingCount = _loadingOperations.length;
  _loadingMessage = _loadingOperations[_loadingCount - 1]?.group.label || '';
  if (_loadingCount === 0) {
    clearTimeout(_loadingTimer);
    _loadingTimer = null;
    if (_loadingVisible) _hideLoadingUi();
  } else if (_loadingVisible) _renderLoadingUi(_loadingMessage);
}

function hideLoadingMessage(msg) {
  const expected = _loadingText(msg);
  const current = [..._loadingOperations].reverse().find(lease => lease.getState()?.label === expected);
  if (!current) return false;
  hideLoading(current);
  return true;
}

function trackIframeLoading(iframe, msg, opts) {
  const options = opts || {};
  if (!iframe) return;
  // A replaced iframe with the same id is still the same visible loading slot.
  const key = iframe.id || iframe;
  _iframeLoadingTrackers.get(key)?.();
  if (options.silent || options.skipGlobalUi) return;
  const loading = showLoading(msg || 'ビューアを読み込み中...', { key });
  let done = false;
  let timer = null;
  const finish = () => {
    if (done) return;
    done = true;
    if (timer) clearTimeout(timer);
    iframe.removeEventListener('load', finish);
    iframe.removeEventListener('error', finish);
    if (_iframeLoadingTrackers.get(key) === finish) _iframeLoadingTrackers.delete(key);
    hideLoading(loading);
  };
  _iframeLoadingTrackers.set(key, finish);
  iframe.addEventListener('load', finish);
  iframe.addEventListener('error', finish);
  timer = setTimeout(finish, Number.isFinite(options.timeoutMs) ? options.timeoutMs : 15000);
}

// サーバーへの定期ハートビート（exe版: ブラウザ閉じたらサーバー自動終了用）
let _heartbeatTimer = null;

function _isHeartbeatCloudMode() {
  return window.MeldexRuntimeAdapter?.isBrowserDataMode?.()
    || document.body?.dataset?.cloudMode === 'dropbox'
    || document.body?.dataset?.cloudMode === 'browser';
}

function _sendHeartbeat() {
  fetch('/api/heartbeat', { method: 'POST' }).catch(() => {});
}

function _startHeartbeat() {
  _sendHeartbeat();
  if (_heartbeatTimer) return;
  _heartbeatTimer = setInterval(_sendHeartbeat, 10000);
}

function _stopHeartbeat() {
  if (!_heartbeatTimer) return;
  clearInterval(_heartbeatTimer);
  _heartbeatTimer = null;
}

function _syncHeartbeatForVisibility() {
  if (_isHeartbeatCloudMode()) {
    _stopHeartbeat();
    return;
  }
  _startHeartbeat();
}

document.addEventListener('visibilitychange', _syncHeartbeatForVisibility);
if (document.body && typeof MutationObserver !== 'undefined') {
  new MutationObserver(_syncHeartbeatForVisibility).observe(document.body, {
    attributes: true,
    attributeFilter: ['data-cloud-mode'],
  });
}
_syncHeartbeatForVisibility();
