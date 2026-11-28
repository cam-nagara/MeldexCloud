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
