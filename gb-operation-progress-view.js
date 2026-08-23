/* MeldexOperationProgressの共通表示。
   開始場所、バックグラウンドトレイ、デスクトップのステータスバー要約を同じ状態から描画する。 */
(function () {
  'use strict';

  const originNodes = new Map();
  let tray = null;
  let statusMirror = null;
  let liveRegion = null;

  function _text(value) { return String(value == null ? '' : value); }

  function _formatEta(seconds) {
    const value = Math.max(0, Number(seconds) || 0);
    if (!value) return '';
    if (typeof window.formatJobEta === 'function') return window.formatJobEta(value);
    if (value < 60) return Math.ceil(value) + '秒';
    if (value < 3600) return Math.ceil(value / 60) + '分';
    return (value / 3600).toFixed(1) + '時間';
  }

  function _statusLabel(operation) {
    if (operation.status === 'queued') return '待機中';
    if (operation.status === 'cancelling') return '中止しています';
    if (operation.status === 'failed') return '失敗';
    if (operation.status === 'partial') return '一部失敗';
    if (operation.status === 'cancelled') return '中止しました';
    if (operation.status === 'succeeded') return '完了';
    return operation.phase || '処理中';
  }

  function _detailText(operation) {
    if (operation.error) return operation.error;
    if (operation.summary) return operation.summary;
    if (operation.message) return operation.message;
    const parts = [];
    if (operation.mode === 'determinate' && operation.total > 0) {
      parts.push(Math.min(operation.processed, operation.total) + '/' + operation.total + '件');
    }
    if (operation.currentItem) parts.push(operation.currentItem);
    if (operation.eta) parts.push('残り約' + _formatEta(operation.eta));
    return parts.join(' · ');
  }

  function _createProgressBar(operation, compact) {
    const track = document.createElement('span');
    track.className = 'meldex-operation-bar-track' + (compact ? ' is-compact' : '');
    track.setAttribute('role', 'progressbar');
    track.setAttribute('aria-label', operation.label);
    const fill = document.createElement('span');
    fill.className = 'meldex-operation-bar-fill';
    if (operation.mode === 'determinate' && operation.total > 0) {
      const percent = operation.percent == null ? 0 : operation.percent;
      track.setAttribute('aria-valuemin', '0');
      track.setAttribute('aria-valuemax', '100');
      track.setAttribute('aria-valuenow', String(percent));
      fill.style.width = percent + '%';
    } else {
      track.classList.add('is-indeterminate');
      fill.classList.add('is-indeterminate');
    }
    track.appendChild(fill);
    return track;
  }

  function _ensureTray() {
    if (tray?.isConnected) return tray;
    tray = document.createElement('section');
    tray.id = 'meldex-operation-tray';
    tray.className = 'meldex-operation-tray';
    tray.dataset.e2eId = 'operation-progress-tray';
    tray.setAttribute('aria-label', '進行中の処理');
    tray.hidden = true;
    document.body.appendChild(tray);
    return tray;
  }

  function _ensureLiveRegion() {
    if (liveRegion?.isConnected) return liveRegion;
    liveRegion = document.createElement('div');
    liveRegion.className = 'meldex-operation-live-region';
    liveRegion.setAttribute('role', 'status');
    liveRegion.setAttribute('aria-live', 'polite');
    liveRegion.setAttribute('aria-atomic', 'true');
    document.body.appendChild(liveRegion);
    return liveRegion;
  }

  function _operationRow(operation, compact) {
    const row = document.createElement('article');
    row.className = 'meldex-operation-row is-' + operation.status + (compact ? ' is-compact' : '');
    row.dataset.operationId = operation.id;

    const heading = document.createElement('div');
    heading.className = 'meldex-operation-heading';
    const ring = document.createElement('span');
    ring.className = 'meldex-segmented-ring meldex-segmented-ring--small';
    ring.setAttribute('aria-hidden', 'true');
    if (operation.status !== 'running' && operation.status !== 'queued' && operation.status !== 'cancelling') {
      ring.classList.add('is-static', 'is-' + operation.status);
    }
    const label = document.createElement('span');
    label.className = 'meldex-operation-label';
    label.textContent = operation.label;
    const state = document.createElement('span');
    state.className = 'meldex-operation-state';
    state.textContent = _statusLabel(operation);
    heading.append(ring, label, state);
    row.appendChild(heading);

    if (operation.status === 'running' || operation.status === 'queued' || operation.status === 'cancelling') {
      row.appendChild(_createProgressBar(operation, compact));
    }
    const detailText = _detailText(operation);
    if (detailText) {
      const detail = document.createElement('div');
      detail.className = 'meldex-operation-detail';
      detail.textContent = detailText;
      row.appendChild(detail);
    }

    if (operation.details?.length) {
      const disclosure = document.createElement('details');
      disclosure.className = 'meldex-operation-details';
      const summary = document.createElement('summary');
      summary.textContent = '失敗した項目を確認（' + (operation.detailCount || operation.details.length) + '件）';
      const list = document.createElement('ul');
      operation.details.forEach(function (item) {
        const entry = document.createElement('li');
        const title = [item.stage, item.path].filter(Boolean).join(' · ');
        if (title) {
          const strong = document.createElement('strong');
          strong.textContent = title;
          entry.appendChild(strong);
        }
        if (item.message) {
          const message = document.createElement('span');
          message.textContent = item.message;
          entry.appendChild(message);
        }
        list.appendChild(entry);
      });
      disclosure.append(summary, list);
      row.appendChild(disclosure);
    }

    if (operation.cancellable || operation.retryable || operation.status === 'failed' || operation.status === 'partial') {
      const actions = document.createElement('div');
      actions.className = 'meldex-operation-actions';
      if (operation.cancellable && operation.status !== 'cancelling') {
        const cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.dataset.action = 'cancel-operation-progress';
        cancel.textContent = '中止';
        cancel.addEventListener('click', function () { window.MeldexOperationProgress.requestCancel(operation.id); });
        actions.appendChild(cancel);
      }
      if (operation.retryable && (operation.status === 'failed' || operation.status === 'partial')) {
        const retry = document.createElement('button');
        retry.type = 'button';
        retry.dataset.action = 'retry-operation-progress';
        retry.textContent = '再試行';
        retry.addEventListener('click', function () { window.MeldexOperationProgress.retry(operation.id); });
        actions.appendChild(retry);
      }
      if (operation.status === 'failed' || operation.status === 'partial') {
        const dismiss = document.createElement('button');
        dismiss.type = 'button';
        dismiss.dataset.action = 'dismiss-operation-progress';
        dismiss.textContent = '閉じる';
        dismiss.addEventListener('click', function () { window.MeldexOperationProgress.get(operation.id)?.dispose(); });
        actions.appendChild(dismiss);
      }
      row.appendChild(actions);
    }
    return row;
  }

  function _renderTray(operations) {
    const el = _ensureTray();
    const visible = operations.filter(function (operation) { return operation.showInTray; });
    if (!visible.length) {
      el.hidden = true;
      el.replaceChildren();
      return;
    }
    const header = document.createElement('div');
    header.className = 'meldex-operation-tray-header';
    const title = document.createElement('span');
    const needsAttention = visible.some(function (op) { return op.status === 'failed' || op.status === 'partial'; });
    const hasActive = visible.some(function (op) { return op.status === 'running' || op.status === 'queued' || op.status === 'cancelling'; });
    title.textContent = needsAttention
      ? '確認が必要な処理'
      : (hasActive ? (visible.length > 1 ? '進行中の処理 ' + visible.length + '件' : '進行中') : '完了した処理');
    header.appendChild(title);
    const list = document.createElement('div');
    list.className = 'meldex-operation-list';
    visible.slice(0, 6).forEach(function (operation) { list.appendChild(_operationRow(operation, false)); });
    el.replaceChildren(header, list);
    el.hidden = false;
  }

  function _ensureStatusMirror() {
    if (statusMirror?.isConnected) return statusMirror;
    const statusBar = document.getElementById('status-bar');
    if (!statusBar) return null;
    statusMirror = document.getElementById('sb-import-progress') || document.createElement('span');
    statusMirror.id = 'sb-import-progress';
    statusMirror.className = 'sb-import-progress meldex-operation-status-mirror';
    statusMirror.hidden = true;
    statusMirror.setAttribute('role', 'status');
    if (!statusMirror.parentNode) {
      const shortcuts = document.getElementById('sb-shortcuts');
      statusBar.insertBefore(statusMirror, shortcuts?.parentNode === statusBar ? shortcuts : null);
    }
    return statusMirror;
  }

  function _renderStatus(operations) {
    const el = _ensureStatusMirror();
    if (!el) return;
    const candidates = operations.filter(function (operation) { return operation.showInStatus; });
    if (!candidates.length) {
      el.hidden = true;
      el.replaceChildren();
      return;
    }
    const operation = candidates.find(function (op) { return op.status === 'running' || op.status === 'cancelling'; }) || candidates[0];
    const active = operation.status === 'running' || operation.status === 'queued' || operation.status === 'cancelling';
    const label = document.createElement('span');
    label.className = 'sb-import-progress-label';
    label.textContent = operation.label + ': ' + _statusLabel(operation)
      + (active && operation.percent != null ? ' ' + operation.percent + '%' : '');
    el.replaceChildren(label);
    if (active) el.appendChild(_createProgressBar(operation, true));
    if (candidates.length > 1) {
      const more = document.createElement('span');
      more.className = 'sb-import-progress-queue';
      more.textContent = 'ほか' + (candidates.length - 1) + '件';
      el.appendChild(more);
    }
    el.hidden = false;
  }

  function _clearOrigins(activeIds) {
    originNodes.forEach(function (entry, id) {
      if (activeIds.has(id)) return;
      entry.node.remove();
      if (entry.origin?.isConnected && !Array.from(activeIds).some(function (activeId) {
        return originNodes.get(activeId)?.origin === entry.origin;
      })) entry.origin.removeAttribute('aria-busy');
      originNodes.delete(id);
    });
  }

  function _renderOrigins(operations) {
    const activeIds = new Set();
    operations.forEach(function (operation) {
      const origin = operation.origin;
      if (!origin?.isConnected) return;
      activeIds.add(operation.id);
      origin.setAttribute('aria-busy', operation.status === 'running' || operation.status === 'queued' || operation.status === 'cancelling' ? 'true' : 'false');
      let entry = originNodes.get(operation.id);
      if (!entry) {
        const node = document.createElement('div');
        node.className = 'meldex-operation-origin';
        node.dataset.operationId = operation.id;
        if (operation.originPlacement === 'inside') origin.appendChild(node);
        else origin.insertAdjacentElement('afterend', node);
        entry = { node: node, origin: origin };
        originNodes.set(operation.id, entry);
      }
      entry.node.replaceChildren(_operationRow(operation, true));
    });
    _clearOrigins(activeIds);
  }

  function _render(detail) {
    if (!document.body) return;
    const operations = detail?.operations || window.MeldexOperationProgress.list();
    _renderTray(operations);
    _renderStatus(operations);
    _renderOrigins(operations);
    if (detail?.operation && (detail.reason === 'failed' || detail.reason === 'partial' || detail.reason === 'succeeded')) {
      const op = detail.operation;
      _ensureLiveRegion().textContent = op.label + ': ' + _statusLabel(op) + (_detailText(op) ? '。' + _detailText(op) : '');
    }
  }

  function _init() {
    if (!window.MeldexOperationProgress || !document.body) return;
    window.MeldexOperationProgress.subscribe(_render);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _init, { once: true });
  else _init();
})();
