    : String(sizeOrText || '').length;
  if (size < threshold) return;
  if (_commonLoadingProgress()) {
    const current = Object.prototype.hasOwnProperty.call(options, 'loading')
      ? options.loading : options.key != null
        ? _loadingOperations.find(lease => lease.group.key === options.key)
        : _loadingOperations[_loadingOperations.length - 1];
    if (!current?.active) return;
    _loadingMessage = _loadingText(msg);
    current.update({ label: _loadingMessage });
    current.showNow();
    await _loadingPaintDelay();
    return;
  }
  if (_loadingCount <= 0 && !_loadingVisible) return;
  _loadingMessage = _loadingText(msg);
  if (_loadingTimer) {
    clearTimeout(_loadingTimer);
    _loadingTimer = null;
  }
  _renderLoadingUi(_loadingMessage);
  await _loadingPaintDelay();
}

// A lease belongs to one invocation; a keyed group is the one visible task.
// Repeated starts for the same target share its bar until every lease ends.
function showLoading(msg, opts) {
  const options = opts || {};
  const key = options.key ?? Symbol('loading');
  let group = _loadingGroups.get(key);
  if (!group) {
    const label = _loadingText(msg);
    const common = _commonLoadingProgress();
    group = { key, label, refs: 0, operation: common?.begin({
      kind: 'loading', label, mode: 'indeterminate', background: false,
      delayMs: 300, showInTray: true, priority: 40,
    }) || null };
    _loadingGroups.set(key, group);
  }
  group.refs++;
  const lease = {
    active: true, group,
    getState: () => group.operation?.getState() || { label: group.label },
    update: patch => { if (lease.active) { group.label = patch.label || group.label; group.operation?.update(patch); } },
    showNow: () => { if (lease.active) group.operation?.showNow(); },
  };
  _loadingOperations.push(lease);
  _loadingCount = _loadingOperations.length;
  _loadingMessage = group.label;
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
let _heartbeatInFlight = null;
let _webclipDirectoryRevision = null;

function _isHeartbeatCloudMode() {
  return window.MeldexRuntimeAdapter?.isBrowserDataMode?.()
    || document.body?.dataset?.cloudMode === 'dropbox'
    || document.body?.dataset?.cloudMode === 'browser';
}

function _sendHeartbeat() {
  if (_heartbeatInFlight) return _heartbeatInFlight;
  _heartbeatInFlight = fetch('/api/heartbeat', { method: 'POST' })
    .then(response => response.ok ? response.json() : null)
    .then(async data => {
      const revision = data?.webclip_directory_revision;
      if (typeof revision !== 'string') return;
      if (_webclipDirectoryRevision === null) { _webclipDirectoryRevision = revision; return; }
      if (_webclipDirectoryRevision === revision) return;
      const isCurrent = () => {
        const active = typeof document === 'undefined' ? null : document.activeElement;
        const input = active?.closest?.('input, textarea, [contenteditable="true"]');
        const controls = ['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file', 'hidden', 'image'];
        return !(active?.isContentEditable || input && !controls.includes(input.type));
      };
      // Recheck after asynchronous tree refresh, too: editing can start meanwhile.
      if (!isCurrent()) return;
      let result;
      if (typeof window.refreshFolderAfterExternalChange === 'function') {
        result = await window.refreshFolderAfterExternalChange({ isCurrent });
      } else if (typeof refreshOutliner === 'function') {
        result = await refreshOutliner({ force: true, coalesce: true, reason: 'webclip-directory-change' });
      } else return;
      if (result === false || Array.isArray(result) && result.some(row => row?.status === 'rejected')) return;
      _webclipDirectoryRevision = revision;
    })
    .catch(() => {})
    .finally(() => { _heartbeatInFlight = null; });
  return _heartbeatInFlight;
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
