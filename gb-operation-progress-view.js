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
  const trayFrames = new WeakSet();
  const TRAY_MINIMIZED_KEY = 'meldex-operation-tray-minimized';
  let trayMinimized = (function () {
    try { return localStorage.getItem(TRAY_MINIMIZED_KEY) === '1'; } catch (_) { return false; }
  })();
  let lastOperations = [];
  const TRAY_POSITION_KEY = 'meldex-operation-tray-position';
  // 見出しのドラッグで決めた位置（画面右端・下端からの距離。CSS px）。未移動ならnull。
  let trayUserPosition = (function () {
    try {
      const saved = JSON.parse(localStorage.getItem(TRAY_POSITION_KEY) || 'null');
      return saved && Number.isFinite(saved.right) && Number.isFinite(saved.bottom) ? saved : null;
    } catch (_) { return null; }
  })();
  let trayDragSuppressClick = false;
  const TRAY_AVOID_SELECTOR = [
    '.gb-context-menu',
    '[data-meldex-operation-avoid]',
    '#controls.gb-toolbar-viewer',
    '.gb-toolbar',
    '[role="toolbar"]',
    '.gb-modal-footer',
    '.gb-modal-shell-footer',
    '[data-modal-footer]',
    '.gb-confirm-actions',
    '.annotation-fab',
  ].join(', ');

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
    // 見出しが既に結果の言い方（「〜しました」）なら「完了」を重ねない。
    if (operation.status === 'succeeded') return /(?:ました|完了)$/.test(_text(operation.label)) ? '' : '完了';
    const phase = operation.phase || '処理中';
    if (operation.mode === 'determinate' && operation.percent != null) {
      return phase + ' ' + operation.percent + '%';
    }
    return phase;
  }

  function _detailText(operation) {
    const state = _statusLabel(operation);
    const outcome = operation.error || operation.summary;
    if (outcome) return state && !_text(outcome).includes(state) ? state + ' · ' + outcome : outcome;
    const parts = [];
    // 状態と説明は名前の下だけに表示する。同じ工程をmessageが説明して
    // いる場合はmessageを使い、停滞などの状態だけを残す。
    const phase = _text(operation.phase).replace(/^(?:停滞|外部待機):\s*/, '');
    const messageHasPhase = phase && _text(operation.message).includes(phase);
    if (state && !messageHasPhase) parts.push(state);
    if (operation.mode === 'determinate' && operation.total > 0) {
      if (operation.kind === 'download') {
        parts.push((Math.min(operation.processed, operation.total) / 1048576).toFixed(1)
          + ' / ' + (operation.total / 1048576).toFixed(1) + ' MiB');
      } else parts.push(Math.min(operation.processed, operation.total) + '/' + operation.total + '件');
    } else if (operation.processed > 0) {
      parts.push(operation.processed + '件確認済み');
    }
    if (operation.currentItem) parts.push(operation.currentItem);
    if (operation.message) {
      const prefix = messageHasPhase ? _text(operation.phase).match(/^(?:停滞|外部待機):\s*/) : null;
      parts.push((prefix ? prefix[0] : '') + operation.message);
    }
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
    tray.addEventListener('pointerdown', _startTrayDrag);
    document.body.appendChild(tray);
    _syncTrayHost();
    return tray;
  }

  function _syncTrayHost(preferred) {
    if (!tray) return;
    // 設定は通常のGBModalShellであり、トレイをダイアログ本体へ入れる必要はない。
    // オーバーレイ直下の兄弟にすると、viewport右下の通常位置を保ったまま、
    // 暗転より前・移動可能な設定ダイアログより後ろへ重ねられる。
    const settingsHost = preferred?.isConnected
      && preferred?.matches?.('.gb-modal-overlay[data-settings-modal="1"], .modal-overlay[data-settings-modal="1"]')
      ? preferred
      : Array.from(document.querySelectorAll('.gb-modal-overlay[data-settings-modal="1"], .modal-overlay[data-settings-modal="1"]')).at(-1) || null;
    // Native modal dialogs occupy the browser top layer, above every z-index.
    // Keep the same tray inside the active dialog so it remains visible and
    // interactive, then return it to body on close (even if the dialog is removed).
    if (preferred?.matches('dialog:modal')) modalHost = preferred;
    if (!modalHost?.matches('dialog:modal') || !modalHost.isConnected) {
      modalHost = Array.from(document.querySelectorAll('dialog:modal')).at(-1) || null;
    }
    const host = settingsHost || modalHost || document.body;
    if (tray.parentElement !== host) host.appendChild(tray);
  }

  function _wireTrayFrame(frame) {
    if (!frame || trayFrames.has(frame)) return;
    trayFrames.add(frame);
    frame.addEventListener('load', _scheduleTrayPosition);
  }

  function _clipTrayRect(rect, clip) {
    const clipped = {
      left: Math.max(rect.left, clip.left),
      top: Math.max(rect.top, clip.top),
      right: Math.min(rect.right, clip.right),
      bottom: Math.min(rect.bottom, clip.bottom),
    };
    clipped.width = Math.max(0, clipped.right - clipped.left);
    clipped.height = Math.max(0, clipped.bottom - clipped.top);
    return clipped;
  }

  function _collectTrayAvoidRects() {
    const rects = [];
    const visited = new Set();
    const rootClip = { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };

    function visit(doc, transform, clip) {
      if (!doc || visited.has(doc)) return;
      visited.add(doc);
      for (const surface of doc.querySelectorAll(TRAY_AVOID_SELECTOR)) {
        if (doc === document && (surface === tray || tray.contains(surface))) continue;
        // 設定ダイアログはトレイより前面かつ移動可能。設定内のツールバーや
        // フッターを避けてトレイ自体を動かすと「ダイアログ内に表示された」ように
        // 見えるため、通常の右下位置を優先する。
        if (doc === document && surface.closest('.gb-modal-overlay[data-settings-modal="1"], .modal-overlay[data-settings-modal="1"]')) continue;
        const local = surface.getBoundingClientRect();
        const mapped = _clipTrayRect({
          left: transform.left + local.left * transform.scaleX,
          top: transform.top + local.top * transform.scaleY,
          right: transform.left + local.right * transform.scaleX,
          bottom: transform.top + local.bottom * transform.scaleY,
        }, clip);
        if (mapped.width && mapped.height) rects.push(mapped);
      }

      for (const frame of doc.querySelectorAll('iframe')) {
        _wireTrayFrame(frame);
        const local = frame.getBoundingClientRect();
        if (!local.width || !local.height) continue;
        const mappedFrame = _clipTrayRect({
          left: transform.left + local.left * transform.scaleX,
          top: transform.top + local.top * transform.scaleY,
          right: transform.left + local.right * transform.scaleX,
          bottom: transform.top + local.bottom * transform.scaleY,
        }, clip);
        if (!mappedFrame.width || !mappedFrame.height) continue;
        try {
          const childDoc = frame.contentDocument;
          const childWindow = frame.contentWindow;
          if (!childDoc?.documentElement || !childWindow) continue;
          const childWidth = childWindow.innerWidth || frame.clientWidth || local.width;
          const childHeight = childWindow.innerHeight || frame.clientHeight || local.height;
          if (!childWidth || !childHeight) continue;
          visit(childDoc, {
            left: transform.left + local.left * transform.scaleX,
            top: transform.top + local.top * transform.scaleY,
            scaleX: transform.scaleX * local.width / childWidth,
            scaleY: transform.scaleY * local.height / childHeight,
          }, mappedFrame);
        } catch (_) {
          // 外部サイト等のcross-origin iframeは内部を参照できないため安全に無視する。
        }
      }
    }

    visit(document, { left: 0, top: 0, scaleX: 1, scaleY: 1 }, rootClip);
    return rects;
  }

  function _trayZoom() {
    return typeof _getZoom === 'function' ? _getZoom()
      : (parseFloat(getComputedStyle(document.documentElement).zoom) || 1);
  }

  function _trayDragDisabled() {
    return !!window.matchMedia?.('(max-width: 768px), (pointer: coarse)').matches;
  }

  // 見出しをつかんで位置を動かす。ボタン上では開始しない。右下基準で保持するので、
  // 最小化・展開で大きさが変わっても右下の位置は動かない。
  function _startTrayDrag(event) {
    if (event.button !== 0 || _trayDragDisabled()) return;
    const header = event.target.closest?.('.meldex-operation-tray-header');
    if (!header || !tray.contains(header) || event.target.closest('button, a, input, summary')) return;
    const zoom = _trayZoom();
    const start = tray.getBoundingClientRect();
    const startX = event.clientX;
    const startY = event.clientY;
    const startRight = (window.innerWidth - start.right) / zoom;
    const startBottom = (window.innerHeight - start.bottom) / zoom;
    let moved = false;
    tray.classList.add('is-dragging');
    function onMove(ev) {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (!moved && Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
      moved = true;
      ev.preventDefault();
      trayUserPosition = { right: startRight - dx / zoom, bottom: startBottom - dy / zoom };
      _applyTrayUserPosition();
    }
    function onEnd() {
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('pointerup', onEnd, true);
      window.removeEventListener('pointercancel', onEnd, true);
      tray.classList.remove('is-dragging');
      if (!moved) return;
      trayDragSuppressClick = true;
      setTimeout(function () { trayDragSuppressClick = false; }, 0);
      try { localStorage.setItem(TRAY_POSITION_KEY, JSON.stringify(trayUserPosition)); } catch (_) {}
    }
    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('pointerup', onEnd, true);
    window.addEventListener('pointercancel', onEnd, true);
  }

  function _applyTrayUserPosition() {
    if (!tray || !trayUserPosition) return false;
    const zoom = _trayZoom();
    const viewW = window.innerWidth / zoom;
    const viewH = window.innerHeight / zoom;
    const box = tray.getBoundingClientRect();
    const width = box.width / zoom;
    const height = box.height / zoom;
    // 画面外へ出さない（ウィンドウを縮めた時も見える範囲へ戻す）。
    const right = Math.min(Math.max(0, trayUserPosition.right), Math.max(0, viewW - width));
    const bottom = Math.min(Math.max(0, trayUserPosition.bottom), Math.max(0, viewH - Math.min(height, 34)));
    tray.style.right = right + 'px';
    tray.style.bottom = bottom + 'px';
    tray.style.setProperty('--meldex-operation-available-height', Math.max(34, viewH - bottom - 8) + 'px');
    return true;
  }

  function _syncTrayPosition() {
    if (!tray?.isConnected || tray.hidden) return;
    if (trayUserPosition && !_trayDragDisabled()) {
      _applyTrayUserPosition();
      return;
    }
    tray.style.removeProperty('right');
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
    // 前面表示を維持したまま、主要アプリの下部ツールバーや設定の操作領域を覆わない。
    const box = tray.getBoundingClientRect();
    let actionTop = window.innerHeight;
    // 個々のボタンではなく操作面全体を避ける。ビューワーの #controls のように
    // ボタン同士に隙間があるフッターでも、トレイが隙間へ重ならないようにする。
    const obstacles = _collectTrayAvoidRects();
    for (const action of obstacles) {
      if (action.width && action.height && action.left < box.right && action.right > box.left
          && action.top < box.bottom && action.bottom > box.top) actionTop = Math.min(actionTop, action.top);
    }
    if (actionTop > 112 && actionTop < window.innerHeight) {
      tray.style.bottom = ((window.innerHeight - actionTop + 8) / zoom) + 'px';
      tray.style.setProperty('--meldex-operation-available-height', ((actionTop - 16) / zoom) + 'px');
    }
    // A tall menu can start near the top edge, leaving no vertical space.
    // Use a free side of the viewport before covering its retry/undo controls.
    const placed = tray.getBoundingClientRect();
    const overlaps = (candidate, other) => other.width && other.height && candidate.left < other.right
      && candidate.right > other.left && candidate.top < other.bottom && candidate.bottom > other.top;
    if (obstacles.some(other => overlaps(placed, other))) {
      const candidates = [8, ...obstacles.map(other => other.left - placed.width - 8),
        ...obstacles.map(other => other.right + 8)];
      for (const left of candidates) {
        if (left < 8 || left + placed.width > window.innerWidth - 8) continue;
        const candidate = {left, right: left + placed.width, top: placed.top, bottom: placed.bottom};
        if (obstacles.some(other => overlaps(candidate, other))) continue;
        tray.style.right = ((window.innerWidth - candidate.right) / zoom) + 'px';
        break;
      }
    }
  }

  function _scheduleTrayPosition() {
    if (!tray?.isConnected || tray.hidden || trayPositionFrame) return;
    trayPositionFrame = requestAnimationFrame(function () {
      trayPositionFrame = 0;
      _syncTrayPosition();
    });
  }

  const TRAY_POSITION_SELECTOR = 'iframe, .gb-dock-fixed-right, .gb-dock-bar-right, ' + TRAY_AVOID_SELECTOR;
  function _nodeAffectsTrayPosition(node) {
    return node?.nodeType === 1 && (node.matches(TRAY_POSITION_SELECTOR) || !!node.querySelector(TRAY_POSITION_SELECTOR));
  }

  function _recordAffectsTrayPosition(record) {
    return !!record.target?.closest?.('.gb-dock-fixed-right')
      || Array.prototype.some.call(record.addedNodes, _nodeAffectsTrayPosition)
      || Array.prototype.some.call(record.removedNodes, _nodeAffectsTrayPosition);
  }

  function _watchTrayLayout() {
    const root = document.getElementById('gb-layout-root');
    if (root === trayLayoutRoot) return;
    trayLayoutObserver?.disconnect();
    trayLayoutRoot = root;
    if (!root) return;
    // 位置に関わるのは右レールと右下の操作ボタンの出入りだけ。チャットの受信表示や
    // シートの描画のたびに測り直すと、それだけで画面全体の再計算が毎フレーム走る。
    trayLayoutObserver ||= new MutationObserver(function (records) {
      if (records.some(_recordAffectsTrayPosition)) _scheduleTrayPosition();
    });
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
    heading.append(ring, label);
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

    if (!compact && operation.links?.length) {
      const links = document.createElement('div');
      links.className = 'meldex-operation-links';
      operation.links.forEach(function (link, index) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'meldex-operation-link';
        button.dataset.action = 'open-operation-link-' + index;
        button.dataset.e2eId = 'operation-progress-link:' + operation.id + ':' + index;
        button.textContent = link.label;
        button.title = link.title || link.label;
        button.addEventListener('click', function () {
          Promise.resolve().then(function () { return link.open(); }).catch(function (error) {
            console.error('進捗の対象を開けませんでした', error);
            if (typeof showStatus === 'function') showStatus('対象を開けませんでした', true);
          });
        });
        links.appendChild(button);
      });
      row.appendChild(links);
    }

    if (operation.cancellable || operation.retryable || operation.status === 'failed' || operation.status === 'partial' || operation.status === 'unknown') {
      const actions = document.createElement('div');
      actions.className = 'meldex-operation-actions';
      // 確認の項目は「押せば直る操作」1つだけを出す。設定を開くだけのボタンは並べない。
      if (operation.settingsPanel && !operation.attentionKey && typeof showSettingsModal === 'function') {
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
        retry.dataset.e2eId = 'operation-progress-retry:' + operation.id;
        retry.textContent = operation.retryLabel || '再試行';
        retry.addEventListener('click', function () { window.MeldexOperationProgress.retry(operation.id); });
        actions.appendChild(retry);
      }
      if (operation.status === 'failed' || operation.status === 'partial' || operation.status === 'unknown') {
        const dismiss = document.createElement('button');
        dismiss.type = 'button';
        dismiss.dataset.action = 'dismiss-operation-progress';
        dismiss.dataset.e2eId = 'operation-progress-dismiss:' + operation.id;
        dismiss.textContent = '閉じる';
        dismiss.title = operation.attentionKey
          ? '閉じても保存済みの内容は消えません。同じ内容は次回から表示しません'
          : '閉じても保存済みの内容は消えません';
        dismiss.addEventListener('click', function () {
          const key = operation.attentionKey;
          window.MeldexOperationProgress.get(operation.id)?.dispose();
          // 閉じた内容をサーバーへ残し、再起動後や次回の取り込みで同じ内容を出さない。
          if (key && typeof apiPost === 'function') {
            Promise.resolve(apiPost('/import-attention/dismiss', { key: key }, { silentError: true })).catch(function (error) {
              console.error('閉じた記録を残せませんでした', error);
            });
          }
        });
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
    const toggleFocused = el.contains(active) && active.dataset?.action === 'toggle-operation-tray';
    lastOperations = operations;
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
    const activeCount = visible.filter(function (op) { return op.status === 'running' || op.status === 'queued' || op.status === 'cancelling'; }).length;
    title.textContent = needsAttention
      ? '確認が必要な処理'
      : (hasActive ? '進行中の処理 ' + activeCount + '件' : '完了した処理');
    if (trayMinimized && needsAttention && visible.length > 1) title.textContent += ' ' + visible.length + '件';
    title.className = 'meldex-operation-tray-title';
    let hint = null;
    // 最小化中は件数を最後まで読めることを優先し、補足は広げた時だけ出す。
    if (hasActive && !trayMinimized) {
      hint = document.createElement('span');
      hint.className = 'meldex-operation-tray-hint';
      hint.textContent = '他の作業をして大丈夫です';
    }
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'meldex-operation-tray-toggle';
    toggle.dataset.action = 'toggle-operation-tray';
    toggle.dataset.e2eId = 'operation-progress-tray-toggle';
    toggle.setAttribute('aria-expanded', trayMinimized ? 'false' : 'true');
    toggle.setAttribute('aria-label', trayMinimized ? '進捗表示を広げる' : '進捗表示を最小化');
    toggle.title = trayMinimized ? '広げる' : '最小化';
    toggle.innerHTML = trayMinimized
      ? '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M4 10l4-4 4 4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>'
      : '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M3.5 11.5h9" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
    toggle.addEventListener('click', function () {
      trayMinimized = !trayMinimized;
      try { localStorage.setItem(TRAY_MINIMIZED_KEY, trayMinimized ? '1' : '0'); } catch (_) {}
      _renderTray(lastOperations);
      el.querySelector('[data-action="toggle-operation-tray"]')?.focus({ preventScroll: true });
    });
    if (hasActive) {
      const ring = document.createElement('span');
      ring.className = 'meldex-segmented-ring meldex-segmented-ring--small';
      ring.setAttribute('aria-hidden', 'true');
      header.appendChild(ring);
    }
    header.append(title);
    if (hint) header.append(hint);
    header.append(toggle);
    el.classList.toggle('is-minimized', trayMinimized);
    if (trayMinimized) {
      // 最小化中は件数と状態だけを小さく出し、見出しのクリックで広げる。
      header.addEventListener('click', function (event) {
        if (event.target.closest('button')) return;
        if (trayDragSuppressClick) { trayDragSuppressClick = false; return; }
        toggle.click();
      });
      el.replaceChildren(header);
      el.hidden = false;
      _watchTrayLayout();
      _scheduleTrayPosition();
      if (toggleFocused) toggle.focus({ preventScroll: true });
      return;
    }
    const list = document.createElement('div');
    list.className = 'meldex-operation-list';
    // The scrollable tray must retain every retry/cancel action. Truncating
    // the first six records made a seventh failed job impossible to retry.
    visible.forEach(function (operation) {
      const row = _operationRow(operation, false);
      const details = row.querySelector('details');
      if (details && expanded.has(operation.id)) details.open = true;
      list.appendChild(row);
    });
    el.replaceChildren(header, list);
    el.hidden = false;
    _watchTrayLayout();
    _scheduleTrayPosition();
    if (previousScroll) list.scrollTop = previousScroll;
    if (toggleFocused) toggle.focus({ preventScroll: true });
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
      const stateText = _statusLabel(op);
      _ensureLiveRegion().textContent = op.label + (stateText ? ': ' + stateText : '') + (_detailText(op) ? '。' + _detailText(op) : '');
    }
  }

  function _init() {
    if (!window.MeldexOperationProgress || !document.body) return;
    document.querySelectorAll('iframe').forEach(_wireTrayFrame);
    new MutationObserver(function (records) {
      for (const record of records) {
        if (record.target.tagName === 'DIALOG') _syncTrayHost(record.target);
      }
    }).observe(document.body, { attributes: true, attributeFilter: ['open'], subtree: true });
    new MutationObserver(function () {
      _syncTrayHost();
      _scheduleTrayPosition();
    }).observe(document.body, { childList: true });
    window.addEventListener('resize', _scheduleTrayPosition);
    window.addEventListener('meldex-context-menu-layout', _scheduleTrayPosition);
    window.addEventListener('gb:layout-viewport-resize', _scheduleTrayPosition);
    window.MeldexOperationProgress.subscribe(_render);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _init, { once: true });
  else _init();
})();
