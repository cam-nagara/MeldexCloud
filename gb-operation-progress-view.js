/* MeldexOperationProgressの共通表示。
   開始場所とバックグラウンドトレイを同じ状態から描画する。 */
(function () {
  'use strict';

  const originNodes = new Map();
  let tray = null;
  let modalHost = null;
  let liveRegion = null;
  let trayLayoutRoot = null;
  let trayLayoutObserver = null;
  let trayPositionFrame = 0;

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
    if (operation.status === 'unknown') return '結果未確認';
    if (operation.status === 'cancelled') return '中止しました';
    if (operation.status === 'succeeded') return '完了';
    const phase = operation.phase || '処理中';
    if (operation.mode === 'determinate' && operation.percent != null) {
      return phase + ' ' + operation.percent + '%';
    }
    return phase;
  }

  function _detailText(operation) {
    if (operation.error) return operation.error;
    if (operation.summary) return operation.summary;
    const parts = [];
    if (operation.mode === 'determinate' && operation.total > 0) {
      parts.push(Math.min(operation.processed, operation.total) + '/' + operation.total + '件');
    } else if (operation.processed > 0) {
      parts.push(operation.processed + '件確認済み');
    }
    if (operation.currentItem) parts.push(operation.currentItem);
    if (operation.message) parts.push(operation.message);
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
    if (tray) { _syncTrayHost(); return tray; }
    tray = document.createElement('section');
    tray.id = 'meldex-operation-tray';
    tray.className = 'meldex-operation-tray';
    tray.dataset.e2eId = 'operation-progress-tray';
    tray.setAttribute('aria-label', '進行中の処理');
    tray.hidden = true;
    document.body.appendChild(tray);
    _syncTrayHost();
    return tray;
  }

  function _syncTrayHost(preferred) {
    if (!tray) return;
    // Native modal dialogs occupy the browser top layer, above every z-index.
    // Keep the same tray inside the active dialog so it remains visible and
    // interactive, then return it to body on close (even if the dialog is removed).
    if (preferred?.matches('dialog:modal')) modalHost = preferred;
    if (!modalHost?.matches('dialog:modal') || !modalHost.isConnected) {
      modalHost = Array.from(document.querySelectorAll('dialog:modal')).at(-1) || null;
    }
    const host = modalHost || document.body;
    if (tray.parentElement !== host) host.appendChild(tray);
  }

  function _syncTrayPosition() {
    if (!tray?.isConnected || tray.hidden) return;
    tray.style.removeProperty('bottom');
    tray.style.removeProperty('--meldex-operation-available-height');
    const rail = document.querySelector('.gb-dock-fixed-right .gb-dock-bar-right');
    const rect = rail?.getBoundingClientRect();
    // チャットは右レールの外側に開くため、レールの実座標を基準にする。
    const zoom = typeof _getZoom === 'function' ? _getZoom()
      : (parseFloat(getComputedStyle(document.documentElement).zoom) || 1);
    if (rect?.width && rect.height) {
      const inset = Math.max(0, (window.innerWidth - rect.left) / zoom);
      tray.style.setProperty('--meldex-operation-right-inset', (inset + 8) + 'px');
    } else {
      tray.style.removeProperty('--meldex-operation-right-inset');
    }
    // 前面表示を維持したまま、設定の「閉じる」等の操作を覆わない。
    const box = tray.getBoundingClientRect();
    let actionTop = window.innerHeight;
    for (const button of document.querySelectorAll('.gb-modal-footer button, .gb-modal-shell-footer button, [data-modal-footer] button, .gb-confirm-actions button')) {
      const action = button.getBoundingClientRect();
      if (action.width && action.height && action.left < box.right && action.right > box.left
          && action.top < box.bottom && action.bottom > box.top) actionTop = Math.min(actionTop, action.top);
    }
    if (actionTop > 112 && actionTop < window.innerHeight) {
      tray.style.bottom = ((window.innerHeight - actionTop + 8) / zoom) + 'px';
      tray.style.setProperty('--meldex-operation-available-height', ((actionTop - 16) / zoom) + 'px');
    }
  }

  function _scheduleTrayPosition() {
    if (!tray?.isConnected || tray.hidden || trayPositionFrame) return;
    trayPositionFrame = requestAnimationFrame(function () {
      trayPositionFrame = 0;
      _syncTrayPosition();
    });
  }

  function _watchTrayLayout() {
    const root = document.getElementById('gb-layout-root');
    if (root === trayLayoutRoot) return;
    trayLayoutObserver?.disconnect();
    trayLayoutRoot = root;
    if (!root) return;
    trayLayoutObserver ||= new MutationObserver(_scheduleTrayPosition);
    // 開閉でレールDOMが置き換わる。寸法だけの変更は共通リサイズ通知で追従する。
    trayLayoutObserver.observe(root, { childList: true, subtree: true });
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
      summary.textContent = '結果と対処方法を確認（' + (operation.detailCount || operation.details.length) + '件）';
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

    if (operation.cancellable || operation.retryable || operation.status === 'failed' || operation.status === 'partial' || operation.status === 'unknown') {
      const actions = document.createElement('div');
      actions.className = 'meldex-operation-actions';
      if (operation.settingsPanel && typeof showSettingsModal === 'function') {
        const open = document.createElement('button');
        open.type = 'button';
        open.dataset.action = 'open-operation-settings';
        open.textContent = operation.settingsPanel + 'の設定を開く';
        open.addEventListener('click', async function () {
          await showSettingsModal({ panel: operation.settingsPanel });
        });
        actions.appendChild(open);
      }
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
      if (operation.status === 'failed' || operation.status === 'partial' || operation.status === 'unknown') {
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
    const previousScroll = el.querySelector('.meldex-operation-list')?.scrollTop || 0;
    const expanded = new Set(Array.from(el.querySelectorAll('.meldex-operation-row')).filter(function (row) {
      return row.querySelector('details')?.open;
    }).map(function (row) { return row.dataset.operationId; }));
    const active = document.activeElement;
    const focusedId = el.contains(active) ? active.closest('.meldex-operation-row')?.dataset.operationId : null;
    const focusedAction = focusedId ? (active.dataset.action || (active.tagName === 'SUMMARY' ? 'summary' : '')) : '';
    const visible = operations.filter(function (operation) { return operation.showInTray; });
    if (!visible.length) {
      el.hidden = true;
      el.replaceChildren();
      trayLayoutObserver?.disconnect();
      trayLayoutRoot = null;
      return;
    }
    const header = document.createElement('div');
    header.className = 'meldex-operation-tray-header';
    const title = document.createElement('span');
    const needsAttention = visible.some(function (op) { return op.status === 'failed' || op.status === 'partial' || op.status === 'unknown'; });
    const hasActive = visible.some(function (op) { return op.status === 'running' || op.status === 'queued' || op.status === 'cancelling'; });
    title.textContent = needsAttention
      ? '確認が必要な処理'
      : (hasActive ? (visible.length > 1 ? '進行中の処理 ' + visible.length + '件' : '進行中') : '完了した処理');
    header.appendChild(title);
    const list = document.createElement('div');
    list.className = 'meldex-operation-list';
    visible.slice(0, 6).forEach(function (operation) {
      const row = _operationRow(operation, false);
      const details = row.querySelector('details');
      if (details && expanded.has(operation.id)) details.open = true;
      list.appendChild(row);
    });
    el.replaceChildren(header, list);
    el.hidden = false;
    _watchTrayLayout();
    _syncTrayPosition();
    list.scrollTop = previousScroll;
    if (focusedAction) {
      const row = Array.from(list.children).find(function (node) { return node.dataset.operationId === focusedId; });
      const control = focusedAction === 'summary' ? row?.querySelector('summary')
        : Array.from(row?.querySelectorAll('[data-action]') || []).find(function (node) { return node.dataset.action === focusedAction; });
      control?.focus({ preventScroll: true });
    }
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
    _renderOrigins(operations);
    if (detail?.operation && (detail.reason === 'failed' || detail.reason === 'partial' || detail.reason === 'succeeded')) {
      const op = detail.operation;
      _ensureLiveRegion().textContent = op.label + ': ' + _statusLabel(op) + (_detailText(op) ? '。' + _detailText(op) : '');
    }
  }

  function _init() {
    if (!window.MeldexOperationProgress || !document.body) return;
    new MutationObserver(function (records) {
      for (const record of records) {
        if (record.target.tagName === 'DIALOG') _syncTrayHost(record.target);
      }
    }).observe(document.body, { attributes: true, attributeFilter: ['open'], subtree: true });
    new MutationObserver(_scheduleTrayPosition).observe(document.body, { childList: true });
    window.addEventListener('resize', _scheduleTrayPosition);
    window.addEventListener('gb:layout-viewport-resize', _scheduleTrayPosition);
    window.MeldexOperationProgress.subscribe(_render);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _init, { once: true });
  else _init();
})();
