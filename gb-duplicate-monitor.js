/* 重複ファイルの背景スキャン、保存後アラート、解決ダイアログ。 */
(function () {
  'use strict';

  const ALERT_POLL_MS = 2500;
  const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'tiff', 'tif', 'ico', 'svg']);
  const TYPE_LABELS = {
    exact_file: ['完全同一ファイル', 'gb-badge-danger'],
    exact_image: ['同一画像', 'gb-badge-danger'],
    similar_image: ['類似画像', 'gb-badge-warn'],
  };
  const alertQueue = [];
  const queuedAlertIds = new Set();
  let activeAlertModal = null;
  let alertPollTimer = null;
  let monitorStarted = false;

  function safeText(value) {
    return String(value == null ? '' : value);
  }

  function filePath(file) {
    return safeText(file?.rel_path || file?.path || file?.file_path);
  }

  function fileName(file) {
    const path = filePath(file).replace(/\\/g, '/');
    return safeText(file?.name || path.split('/').pop() || '名前なし');
  }

  function fileLocation(file) {
    const path = filePath(file).replace(/\\/g, '/');
    const slash = path.lastIndexOf('/');
    return safeText(file?.location || file?.folder || (slash >= 0 ? path.slice(0, slash) : 'ソースフォルダ'));
  }

  function isImage(file) {
    if (typeof file?.is_image === 'boolean') return file.is_image;
    const extension = fileName(file).split('.').pop().toLowerCase();
    return IMAGE_EXTENSIONS.has(extension);
  }

  function isExisting(file) {
    return file?.existing === true
      || file?.is_existing === true
      || file?.origin === 'existing'
      || file?.role === 'existing';
  }

  function modifiedText(value) {
    if (!value) return '更新日時不明';
    const numeric = Number(value);
    const date = new Date(Number.isFinite(numeric) ? (numeric < 1e12 ? numeric * 1000 : numeric) : value);
    if (Number.isNaN(date.getTime())) return '更新日時不明';
    return new Intl.DateTimeFormat('ja-JP', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
  }

  function normalizeType(type) {
    if (TYPE_LABELS[type]) return type;
    if (type === 'exact') return 'exact_file';
    if (type === 'similar') return 'similar_image';
    return 'exact_file';
  }

  function normalizeGroup(group) {
    let files = Array.isArray(group?.files)
      ? group.files
      : (Array.isArray(group?.images) ? group.images : (Array.isArray(group?.items) ? group.items : []));
    if (!files.length && Array.isArray(group?.paths)) {
      files = group.paths.map(path => ({ path }));
    }
    return {
      ...group,
      type: normalizeType(group?.match_type || group?.result_type || group?.type),
      files,
    };
  }

  function normalizeGroups(payload) {
    let groups = Array.isArray(payload?.groups)
      ? payload.groups
      : (payload?.group ? [payload.group] : []);
    if (!groups.length && Array.isArray(payload?.paths)) groups = [payload];
    return groups.map(normalizeGroup).filter(group => group.files.length > 1);
  }

  function selectedIndex(group, automatic) {
    if (automatic) {
      const existingIndex = group.files.findIndex(isExisting);
      if (existingIndex >= 0) return existingIndex;
    }
    const recommendedIndex = group.files.findIndex(file => file?.recommended === true);
    return recommendedIndex >= 0 ? recommendedIndex : 0;
  }

  function itemVisual(file) {
    const path = filePath(file);
    const name = fileName(file);
    if (isImage(file)) {
      const src = API_BASE + '/thumb?path=' + encodeURIComponent(path) + '&size=180';
      return `<div class="dup-item-thumb"><img src="${src}" alt="${esc(name)}" data-dup-image></div>`;
    }
    return `<div class="dup-item-thumb dup-item-file-icon" aria-hidden="true">${lucide('file', 32)}</div>`;
  }

  function itemHtml(file, groupIndex, fileIndex, checked, automatic) {
    const path = filePath(file);
    const hasSize = file?.size !== undefined && file?.size !== null && Number.isFinite(Number(file.size));
    const size = hasSize
      ? (typeof formatFileSize === 'function' ? formatFileSize(Number(file.size)) : `${Number(file.size)} bytes`)
      : 'サイズ不明';
    const dimension = isImage(file) && file?.width
      ? `${Number(file.width)}×${Number(file.height)}`
      : '';
    const selectedLabel = automatic && isExisting(file) ? '既存ファイル（初期選択）' : (checked ? '残す' : '選択');
    return `<div class="dup-item${checked ? ' dup-item-selected' : ''}" role="button" tabindex="0"
      aria-pressed="${checked ? 'true' : 'false'}" aria-label="${esc(fileName(file))}を残す"
      data-dup-item data-group="${groupIndex}" data-index="${fileIndex}" data-path="${esc(path)}"
      data-existing="${isExisting(file) ? '1' : '0'}"
      data-e2e-id="duplicate-item-${groupIndex}-${fileIndex}">
      ${itemVisual(file)}
      <div class="dup-item-info">
        <div class="dup-item-name" title="${esc(path)}">${esc(fileName(file))}</div>
        <div class="dup-item-location" title="${esc(fileLocation(file))}">${esc(fileLocation(file))}</div>
        <div class="dup-item-meta">${dimension ? `${dimension} / ` : ''}${esc(size)}</div>
        <div class="dup-item-meta">${esc(modifiedText(file?.modified || file?.mtime || file?.updated_at))}</div>
        <div class="dup-item-radio">
          <input type="radio" name="dup-keep-${groupIndex}" value="${fileIndex}" ${checked ? 'checked' : ''}
            data-dup-radio data-group="${groupIndex}" data-index="${fileIndex}"
            aria-label="${esc(fileName(file))}を残す">
          <span class="${automatic && isExisting(file) ? 'dup-item-rec-label' : 'dup-item-keep-label'}">${selectedLabel}</span>
        </div>
      </div>
    </div>`;
  }

  function groupHtml(group, groupIndex, automatic) {
    const type = TYPE_LABELS[group.type] || TYPE_LABELS.exact_file;
    const initialIndex = selectedIndex(group, automatic);
    const items = group.files.map((file, fileIndex) => (
      itemHtml(file, groupIndex, fileIndex, fileIndex === initialIndex, automatic)
    )).join('');
    return `<section class="dup-group" data-group="${groupIndex}">
      <div class="dup-group-header">
        <span class="gb-badge ${type[1]}">${type[0]}</span>
        <span class="dup-group-title">グループ ${groupIndex + 1}</span>
        <span class="dup-group-count">${group.files.length}件</span>
        <span class="dup-group-spacer"></span>
        <button type="button" class="gb-btn gb-btn-xs gb-btn-primary" data-dup-resolve data-group="${groupIndex}"
          data-e2e-id="duplicate-resolve-group-${groupIndex}"
          aria-label="グループ ${groupIndex + 1} の選択したファイルを残す">選択したファイルを残す</button>
      </div>
      <div class="dup-group-body">${items}</div>
    </section>`;
  }

  function createOverlay(options) {
    const overlay = document.createElement('div');
    overlay._dupReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    overlay.className = 'modal-overlay dup-monitor-overlay';
    overlay.dataset.folderPath = options.folderPath || '';
    overlay.innerHTML = `<div class="gb-modal dup-monitor-modal" role="dialog" aria-modal="true"
      aria-labelledby="${options.titleId}" data-e2e-id="${options.e2eId}">
      <header class="gb-modal-header">
        <h3 id="${options.titleId}" class="gb-modal-title">${esc(options.title)}</h3>
        <button type="button" class="gb-modal-close" aria-label="閉じる" title="閉じる"
          data-dup-close data-e2e-id="${options.e2eId}-close">${lucide('x', 14)}</button>
      </header>
      <div class="gb-modal-body">
        <div class="dup-progress" data-dup-progress>
          <div class="dup-progress-row">
            <span class="gb-section-desc" data-dup-status aria-live="polite">${esc(options.status || '')}</span>
            <span class="dup-progress-count" data-dup-progress-count></span>
          </div>
          <progress max="100" value="0" data-dup-progress-bar aria-label="処理の進捗"></progress>
        </div>
        <div class="dup-results" data-dup-results></div>
      </div>
      <footer class="gb-modal-footer">
        <button type="button" class="gb-btn gb-btn-sm" data-dup-keep-all hidden>すべて残す</button>
        <button type="button" class="gb-btn gb-btn-sm gb-btn-warn" data-dup-cancel hidden>中止</button>
        <button type="button" class="gb-btn gb-btn-sm" data-dup-close>閉じる</button>
      </footer>
    </div>`;
    document.body.appendChild(overlay);
    setTimeout(() => {
      const firstAction = overlay.querySelector(
        '[data-dup-cancel]:not([hidden]):not(:disabled),'
        + '[data-dup-keep-all]:not([hidden]):not(:disabled),'
        + '[data-dup-close]:not(:disabled)'
      );
      firstAction?.focus();
    }, 0);
    return overlay;
  }

  function setProgress(overlay, progress) {
    if (!overlay?.isConnected) return;
    const status = overlay.querySelector('[data-dup-status]');
    const count = overlay.querySelector('[data-dup-progress-count]');
    const bar = overlay.querySelector('[data-dup-progress-bar]');
    const processed = Number(progress?.processed) || 0;
    const total = Number(progress?.total) || 0;
    const percent = total > 0 ? Math.max(0, Math.min(100, Math.round(processed * 100 / total))) : 0;
    if (status) status.textContent = progress?.message || progress?.phase || '重複ファイルを確認中…';
    if (count) count.textContent = total > 0 ? `${processed}/${total}` : (processed > 0 ? `${processed}件` : '');
    if (bar) {
      if (total > 0) {
        bar.value = percent;
        bar.removeAttribute('data-indeterminate');
      } else {
        bar.removeAttribute('value');
        bar.dataset.indeterminate = '1';
      }
    }
  }

  function renderResults(overlay, payload, automatic) {
    const groups = normalizeGroups(payload);
    overlay._dupGroups = groups;
    overlay.dataset.automatic = automatic ? '1' : '0';
    const status = overlay.querySelector('[data-dup-status]');
    const results = overlay.querySelector('[data-dup-results]');
    const progress = overlay.querySelector('[data-dup-progress]');
    const keepAll = overlay.querySelector('[data-dup-keep-all]');
    if (progress) progress.classList.add('dup-progress-complete');
    if (!groups.length) {
      if (status) status.textContent = `${Number(payload?.total_files ?? payload?.total_images) || 0}件を確認しました`;
      if (results) results.innerHTML = '<div class="gb-empty-placeholder">重複ファイルは見つかりませんでした</div>';
      return groups;
    }
    const duplicateCount = Number(payload?.total_duplicates)
      || groups.reduce((total, group) => total + Math.max(0, group.files.length - 1), 0);
    if (status) status.textContent = `${groups.length}グループ / ${duplicateCount}件の重複を検出`;
    if (results) results.innerHTML = groups.map((group, index) => groupHtml(group, index, automatic)).join('');
    if (keepAll) keepAll.hidden = false;
    bindResultActions(overlay);
    return groups;
  }

  function chooseItem(item) {
    const group = item?.closest('.dup-group');
    if (!group) return;
    group.querySelectorAll('[data-dup-item]').forEach(candidate => {
      const selected = candidate === item;
      candidate.classList.toggle('dup-item-selected', selected);
      candidate.setAttribute('aria-pressed', selected ? 'true' : 'false');
      const radio = candidate.querySelector('[data-dup-radio]');
      if (radio) radio.checked = selected;
      const label = candidate.querySelector('.dup-item-rec-label,.dup-item-keep-label');
      if (label) {
        const existing = candidate.dataset.existing === '1';
        const automatic = candidate.closest('.dup-monitor-overlay')?.dataset.automatic === '1';
        label.className = automatic && existing ? 'dup-item-rec-label' : 'dup-item-keep-label';
        label.textContent = selected
          ? (automatic && existing ? '既存ファイル（選択中）' : '残す')
          : (automatic && existing ? '既存ファイル' : '選択');
      }
    });
  }

  function bindResultActions(overlay) {
    if (overlay.dataset.dupResultsBound === '1') return;
    overlay.dataset.dupResultsBound = '1';
    overlay.querySelectorAll('[data-dup-image]').forEach(image => {
      image.addEventListener('error', () => {
        image.alt = '画像を表示できません';
        image.hidden = true;
        const thumb = image.closest('.dup-item-thumb');
        if (!thumb || thumb.querySelector('.dup-image-error')) return;
        const message = document.createElement('span');
        message.className = 'dup-image-error';
        message.textContent = '画像を表示できません';
        thumb.appendChild(message);
      }, { once: true });
    });
    overlay.addEventListener('click', event => {
      const radio = event.target.closest?.('[data-dup-radio]');
      if (radio) {
        event.stopPropagation();
        chooseItem(radio.closest('[data-dup-item]'));
        return;
      }
      const item = event.target.closest?.('[data-dup-item]');
      if (item) {
        chooseItem(item);
        return;
      }
      const resolve = event.target.closest?.('[data-dup-resolve]');
      if (resolve) resolveGroup(overlay, Number(resolve.dataset.group), resolve);
    });
    overlay.addEventListener('keydown', event => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      const item = event.target.closest?.('[data-dup-item]');
      if (!item) return;
      event.preventDefault();
      chooseItem(item);
    });
  }

  async function resolveGroup(overlay, groupIndex, button) {
    const group = overlay._dupGroups?.[groupIndex];
    const groupElement = overlay.querySelector(`.dup-group[data-group="${groupIndex}"]`);
    const radio = groupElement?.querySelector(`input[name="dup-keep-${groupIndex}"]:checked`);
    if (!group || !radio) {
      showStatus('残すファイルを選択してください', true);
      return;
    }
    const keepIndex = Number(radio.value);
    const keepFile = group.files[keepIndex];
    const replaceFiles = group.files.filter((_, index) => index !== keepIndex);
    const confirmed = await cfConfirm(
      `「${fileName(keepFile)}」を残し、ほかの${replaceFiles.length}件をゴミ箱へ移動しますか？\n\n` +
      '自動では削除されません。この操作を確定した場合だけ整理します。'
    );
    if (!confirmed) return;
    button.disabled = true;
    try {
      const res = await apiPost('/duplicate-resolve', {
        keep: filePath(keepFile),
        replace: replaceFiles.map(filePath),
        match_type: group.type,
        threshold: 10,
      });
      const results = Array.isArray(res?.results) ? res.results : [];
      const succeeded = results.filter(result => result.status === 'replaced').length;
      const failed = results.filter(result => result.status !== 'replaced').length;
      if (failed === 0 && succeeded === replaceFiles.length) {
        groupElement.classList.add('dup-group-resolved');
        button.innerHTML = lucide('check', 12) + ' 解決済み';
        showStatus(`${succeeded}件を整理しました`);
      } else {
        button.disabled = false;
        button.textContent = '失敗したため再試行';
        showStatus(`${succeeded}件を整理 / ${failed}件は整理できませんでした`, true);
      }
      await refreshFolder(overlay.dataset.folderPath || '');
    } catch (error) {
      button.disabled = false;
      button.textContent = '失敗したため再試行';
      showStatus('重複ファイルを整理できませんでした: ' + userError(error), true);
    }
  }

  async function refreshFolder(folderPath) {
    if (typeof renderFolderGrid === 'function' && folderPath
      && typeof _folderPath !== 'undefined' && _folderPath === folderPath) {
      _folderItems = await apiFetch('/browse?path=' + encodeURIComponent(folderPath) + '&detail=true&all_files=true');
      renderFolderGrid();
    } else if (typeof loadOutliner === 'function') {
      await loadOutliner();
    }
  }

  function userError(error) {
    const status = Number(error?.errorStatus || error?.status);
    if (status === 403) return 'このフォルダを変更する権限がありません。';
    if (status === 404) return '対象のファイルが見つかりません。フォルダを再読み込みしてください。';
    if (error?.isTimeout) return '通信に時間がかかっています。接続を確認して、もう一度お試しください。';
    const message = safeText(error?.message || error);
    if (/Pillow/i.test(message)) return '画像の確認機能を利用できません。Meldexを再起動してください。';
    return message || '処理を完了できませんでした。もう一度お試しください。';
  }

  function bindOverlayChrome(overlay, options) {
    const cancel = overlay.querySelector('[data-dup-cancel]');
    const requestCancellation = () => {
      if (!options.controller || options.finished()) return false;
      if (cancel) cancel.disabled = true;
      const status = overlay.querySelector('[data-dup-status]');
      if (status) status.textContent = '中止しています…';
      options.controller.abort();
      return true;
    };
    const close = () => {
      if (requestCancellation()) return;
      const returnFocus = overlay._dupReturnFocus;
      overlay.remove();
      if (!overlay._dupCloseHandled) {
        overlay._dupCloseHandled = true;
        Promise.resolve(options.onClose?.()).catch(() => {});
      }
      if (returnFocus?.isConnected && typeof returnFocus.focus === 'function') {
        setTimeout(() => returnFocus.focus(), 0);
      }
      if (overlay === activeAlertModal) {
        activeAlertModal = null;
        setTimeout(drainAlertQueue, 0);
      }
    };
    overlay.querySelectorAll('[data-dup-close]').forEach(button => button.addEventListener('click', close));
    if (cancel) {
      if (options.controller) {
        cancel.hidden = false;
        cancel.addEventListener('click', requestCancellation);
      } else {
        cancel.remove();
      }
    }
    overlay.querySelector('[data-dup-keep-all]')?.addEventListener('click', close);
    overlay.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        close();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = [...overlay.querySelectorAll(
        'button:not([disabled]):not([hidden]),input:not([disabled]):not([hidden]),'
        + '[href],[tabindex]:not([tabindex="-1"])'
      )].filter(element => element.getClientRects().length > 0);
      if (!focusable.length) {
        event.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    });
  }

  async function openManualScan(folderPath) {
    if (!isLocalDuplicateMode()) {
      showStatus('重複検出はデスクトップ版のローカルフォルダで利用できます', true);
      return null;
    }
    const controller = new AbortController();
    let finished = false;
    const overlay = createOverlay({
      folderPath,
      titleId: 'duplicate-scan-title',
      e2eId: 'duplicate-scan-modal',
      title: '重複ファイルを確認',
      status: 'スキャンを開始しています…',
    });
    bindOverlayChrome(overlay, { controller, finished: () => finished });
    try {
      const payload = await runBackgroundJob('/duplicate-scan', { path: folderPath, threshold: 10 }, {
        signal: controller.signal,
        onProgress: progress => setProgress(overlay, progress),
      });
      finished = true;
      const cancel = overlay.querySelector('[data-dup-cancel]');
      if (cancel) cancel.remove();
      if (overlay.isConnected) renderResults(overlay, payload || {}, false);
      return payload;
    } catch (error) {
      finished = true;
      if (!overlay.isConnected) return null;
      const cancel = overlay.querySelector('[data-dup-cancel]');
      if (cancel) cancel.remove();
      const status = overlay.querySelector('[data-dup-status]');
      if (error?.name === 'AbortError') {
        if (status) status.textContent = 'スキャンを中止しました';
      } else if (error?.name === 'CancelRequestError') {
        if (status) {
          status.textContent = '中止要求を送信できませんでした。処理は裏側で続いている可能性があります。';
          status.classList.add('dup-status-error');
        }
      } else {
        if (status) status.textContent = '重複ファイルを確認できませんでした: ' + userError(error);
        status?.classList.add('dup-status-error');
      }
      return null;
    }
  }

  function alertIdentity(alert, index) {
    return safeText(alert?.id || alert?.alert_id || `anonymous-${index}-${JSON.stringify(alert)}`);
  }

  function enqueueAlerts(alerts) {
    const fresh = [];
    (Array.isArray(alerts) ? alerts : []).forEach((alert, index) => {
      const id = alertIdentity(alert, index);
      if (queuedAlertIds.has(id)) return;
      queuedAlertIds.add(id);
      fresh.push({ ...alert, _alertId: id });
    });
    if (fresh.length) alertQueue.push(fresh);
    drainAlertQueue();
  }

  function hasBlockingModal() {
    return [...document.querySelectorAll('.modal-overlay')].some(overlay => overlay !== activeAlertModal);
  }

  async function acknowledgeAlerts(alerts) {
    const ids = alerts.map(alert => alert._alertId).filter(id => !id.startsWith('anonymous-'));
    if (!ids.length) return;
    await Promise.allSettled(ids.map(id => (
      apiPost('/duplicate-alerts/' + encodeURIComponent(id) + '/ack', {}, { silentError: true })
    )));
  }

  function drainAlertQueue() {
    if (activeAlertModal || !alertQueue.length || hasBlockingModal()) return;
    const alerts = alertQueue.shift();
    const payload = {
      groups: alerts.flatMap(alert => normalizeGroups(alert)),
      total_duplicates: alerts.reduce((total, alert) => total + (Number(alert?.total_duplicates) || 0), 0),
    };
    if (!payload.groups.length) {
      alerts.forEach(alert => queuedAlertIds.delete(alert._alertId));
      return;
    }
    const overlay = createOverlay({
      titleId: 'duplicate-alert-title',
      e2eId: 'duplicate-alert-modal',
      title: alerts.length > 1 ? `保存後に見つかった重複（${alerts.length}件）` : '保存後に重複が見つかりました',
      status: '既存ファイルを選択しています。必要な場合だけ整理してください。',
    });
    activeAlertModal = overlay;
    bindOverlayChrome(overlay, {
      controller: null,
      finished: () => true,
      onClose: () => acknowledgeAlerts(alerts),
    });
    renderResults(overlay, payload, true);
  }

  async function pollAlerts() {
    if (!isLocalDuplicateMode()) {
      stopMonitorForTests();
      return;
    }
    try {
      const payload = await apiFetch('/duplicate-alerts', { silentError: true });
      enqueueAlerts(Array.isArray(payload) ? payload : payload?.alerts);
    } catch (_) {
      // 起動直後や一時的なオフラインでは次のpollで回復させる。
    }
  }

  async function startMonitor() {
    if (!isLocalDuplicateMode()) {
      stopMonitorForTests();
      monitorStarted = false;
      return;
    }
    if (monitorStarted) return;
    monitorStarted = true;
    try {
      await apiPost('/duplicate-monitor/start', {}, { silentError: true });
    } catch (_) {
      // 監視開始失敗は手動スキャンを妨げない。次回起動時に再試行する。
    }
    await pollAlerts();
    if (!isLocalDuplicateMode()) {
      stopMonitorForTests();
      monitorStarted = false;
      return;
    }
    if (!alertPollTimer) alertPollTimer = setInterval(pollAlerts, ALERT_POLL_MS);
  }

  function stopMonitorForTests() {
    if (alertPollTimer) clearInterval(alertPollTimer);
    alertPollTimer = null;
  }

  function isLocalDuplicateMode() {
    const runtime = window.MeldexRuntimeAdapter;
    if (runtime?.isPwaMode?.() || runtime?.isDropboxMode?.() || runtime?.isServerMode?.()) return false;
    const mode = safeText(runtime?.getMode?.() || document.body?.dataset?.cloudMode).toLowerCase();
    return mode !== 'dropbox' && mode !== 'server';
  }

  function handleRuntimeModeChange() {
    if (isLocalDuplicateMode()) {
      startMonitor();
    } else {
      stopMonitorForTests();
      monitorStarted = false;
    }
  }

  window.MeldexDuplicateMonitor = {
    openManualScan,
    pollNow: pollAlerts,
    start: startMonitor,
    _test: {
      normalizeGroups,
      enqueueAlerts,
      drainAlertQueue,
      stop: stopMonitorForTests,
      isPolling: () => Boolean(alertPollTimer),
    },
  };

  const observer = new MutationObserver(() => {
    if (!activeAlertModal && alertQueue.length) setTimeout(drainAlertQueue, 0);
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('meldex:mode-changed', handleRuntimeModeChange);
  window.addEventListener('load', () => setTimeout(startMonitor, 0), { once: true });
})();
