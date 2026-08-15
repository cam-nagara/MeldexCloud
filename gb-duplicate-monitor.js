/* 重複ファイルの背景スキャン、保存後アラート、解決ダイアログ。 */
(function () {
  'use strict';

  const ALERT_POLL_MS = 2500;
  const alertQueue = [];
  const queuedAlertIds = new Set();
  let activeAlertModal = null;
  let alertPollTimer = null;
  let monitorStarted = false;
  let settingsRenderSeq = 0;
  const folderStateCache = new Map();
  const FOLDER_STATE_CACHE_MS = 15000;

  // 表示整形は gb-duplicate-monitor-format.js が持つ（先に読み込まれる前提）。
  const {
    safeText, filePath, fileName, fileLocation, pathParts, displayPath,
    targetHtml, isImage, isExisting, modifiedText, normalizeType, normalizeGroup,
    normalizeGroups, selectedIndex, itemVisual, itemHtml, groupHtml,
  } = window.MeldexDuplicateFormat;

  function createOverlay(options) {
    const body = document.createElement('div');
    body.className = 'dup-monitor-content';
    body.innerHTML = `<div class="dup-progress" data-dup-progress>
      <div class="dup-progress-target" data-dup-target
        data-e2e-id="duplicate-progress-target"${options.folderPath ? '' : ' hidden'}>${targetHtml(options.folderPath)}</div>
      <div class="dup-progress-row">
        <span class="gb-section-desc" data-dup-status aria-live="polite">${esc(options.status || '')}</span>
        <span class="dup-progress-count" data-dup-progress-count></span>
      </div>
      <progress max="100" value="0" data-dup-progress-bar aria-label="処理の進捗"></progress>
      <div class="dup-progress-stats">
        <span class="dup-progress-percent" data-dup-progress-percent></span>
        <span class="dup-progress-eta" data-dup-progress-eta></span>
      </div>
      <div class="dup-progress-current" data-dup-progress-current hidden></div>
    </div>
    <div class="dup-results" data-dup-results></div>`;

    const footer = document.createElement('div');
    footer.className = 'dup-monitor-footer';
    footer.innerHTML = `<button type="button" class="gb-btn gb-btn-sm" data-dup-keep-all
        data-e2e-id="${options.e2eId}-keep-all" hidden>すべて残す</button>
      <button type="button" class="gb-btn gb-btn-sm gb-btn-warn" data-dup-cancel
        data-e2e-id="${options.e2eId}-cancel" hidden>中止</button>
      <button type="button" class="gb-btn gb-btn-sm" data-dup-close
        data-e2e-id="${options.e2eId}-close-footer">閉じる</button>`;

    let overlay = null;
    const modalApi = window.GBUI.createModal({
      id: options.e2eId,
      titleId: options.titleId,
      title: options.title,
      body,
      footer,
      variant: 'mobile-sheet',
      extraClass: 'dup-monitor-modal',
      geometryKey: options.e2eId,
      initialFocus: modal => modal.querySelector(
        '[data-dup-cancel]:not([hidden]):not(:disabled),'
        + '[data-dup-keep-all]:not([hidden]):not(:disabled),'
        + '[data-dup-close]:not(:disabled)'
      ),
      closeOnEsc: true,
      closeOnOverlay: true,
      onBeforeClose: reason => overlay?._dupOnBeforeClose?.(reason) !== false,
      onClose: reason => overlay?._dupOnClose?.(reason),
    });
    overlay = modalApi.overlay;
    overlay.classList.add('modal-overlay', 'dup-monitor-overlay');
    overlay.dataset.folderPath = options.folderPath || '';
    overlay._dupModalApi = modalApi;
    modalApi.modal.dataset.e2eId = options.e2eId;
    const headerClose = modalApi.header.querySelector('.gb-modal-close');
    if (headerClose) {
      headerClose.dataset.dupClose = '';
      headerClose.dataset.e2eId = `${options.e2eId}-close`;
    }
    modalApi.open();
    return overlay;
  }

  function setProgress(overlay, progress) {
    if (!overlay?.isConnected) return;
    const status = overlay.querySelector('[data-dup-status]');
    const count = overlay.querySelector('[data-dup-progress-count]');
    const bar = overlay.querySelector('[data-dup-progress-bar]');
    const percentText = overlay.querySelector('[data-dup-progress-percent]');
    const etaText = overlay.querySelector('[data-dup-progress-eta]');
    const currentText = overlay.querySelector('[data-dup-progress-current]');
    const processed = Number(progress?.processed) || 0;
    const total = Number(progress?.total) || 0;
    const percent = total > 0 ? Math.max(0, Math.min(100, Math.round(processed * 100 / total))) : 0;
    const rate = Number(progress?.rate) || 0;
    const eta = Number(progress?.eta_seconds);
    if (status) status.textContent = progress?.message || progress?.phase || '重複ファイルを確認中…';
    if (count) {
      count.textContent = total > 0
        ? `${processed.toLocaleString('ja-JP')} / ${total.toLocaleString('ja-JP')}件`
        : (processed > 0 ? `${processed.toLocaleString('ja-JP')}件` : '');
    }
    if (percentText) percentText.textContent = total > 0 ? `${percent}%` : '';
    if (etaText) {
      if (Number.isFinite(eta) && eta > 0) etaText.textContent = `残り約${window.formatJobEta(eta)}`;
      else if (rate > 0) etaText.textContent = `${rate.toFixed(1)}件/秒`;
      else etaText.textContent = '';
    }
    if (currentText) {
      const current = displayPath(progress?.current);
      currentText.textContent = current;
      currentText.title = current;
      currentText.hidden = !current;
    }
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

  // 走査が終わったら、途中経過の数字を残さない（結果の行だけを見せる）。
  function clearProgressDetails(overlay) {
    const progress = overlay?.querySelector('[data-dup-progress]');
    if (progress) progress.classList.add('dup-progress-complete');
    const count = overlay?.querySelector('[data-dup-progress-count]');
    if (count) count.textContent = '';
    const current = overlay?.querySelector('[data-dup-progress-current]');
    if (current) {
      current.textContent = '';
      current.hidden = true;
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
    clearProgressDetails(overlay);
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
    const close = reason => overlay._dupModalApi?.close(reason || 'button');
    overlay._dupOnBeforeClose = () => !requestCancellation();
    overlay._dupOnClose = () => {
      if (!overlay._dupCloseHandled) {
        overlay._dupCloseHandled = true;
        Promise.resolve(options.onClose?.()).catch(() => {});
      }
      if (overlay === activeAlertModal) {
        activeAlertModal = null;
        setTimeout(drainAlertQueue, 0);
      }
    };
    overlay.querySelectorAll('[data-dup-close]:not(.gb-modal-close)')
      .forEach(button => button.addEventListener('click', () => close('button')));
    if (cancel) {
      if (options.controller) {
        cancel.hidden = false;
        cancel.addEventListener('click', requestCancellation);
      } else {
        cancel.remove();
      }
    }
    overlay.querySelector('[data-dup-keep-all]')
      ?.addEventListener('click', () => close('keep-all'));
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
      if (folderPath) {
        try {
          const state = await loadFolderState(folderPath, true);
          if (state?.enabled === false) {
            const status = overlay.querySelector('[data-dup-status]');
            if (status) status.textContent = '自動処理の対象外です。今回は手動でこのフォルダだけ調べます…';
          }
        } catch (_) {
          // 手動確認は設定情報を取得できない場合も続行する。
        }
      }
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
      clearProgressDetails(overlay);
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

  async function loadFolderState(path, force) {
    const key = safeText(path);
    const cached = folderStateCache.get(key);
    if (!force && cached && Date.now() - cached.at < FOLDER_STATE_CACHE_MS) return cached.value;
    const value = await apiFetch('/duplicate-detection/folder-state?path=' + encodeURIComponent(key), {
      silentError: true,
    });
    folderStateCache.set(key, { at: Date.now(), value });
    return value;
  }

  function invalidateFolderStateCache() { folderStateCache.clear(); }
  function notifyTargetChange(path) {
    invalidateFolderStateCache();
    const broadcast = (typeof MeldexBroadcast !== 'undefined' && MeldexBroadcast) || window.GBBroadcast || null;
    broadcast?.send?.('duplicate-targets-changed', { path: safeText(path) });
    window.dispatchEvent(new CustomEvent('meldex:duplicate-targets-changed', {
      detail: { path: safeText(path) },
    }));
  }

  function folderStateLabel(state) {
    if (state?.automatic_available === false) return '自動処理の対象外（ネットワーク上のフォルダ）';
    if (state?.reason) return safeText(state.reason);
    return state?.enabled ? '重複を自動で確認します' : '重複の自動確認から除外しています';
  }
  async function saveFolderState(path, enabled) {
    const response = await apiFetch('/duplicate-detection/folder-state', {
      method: 'PUT',
      body: JSON.stringify({ path, enabled }),
    });
    notifyTargetChange(path);
    return response?.state || null;
  }

  function createFolderTargetRow(item, options) {
    const row = document.createElement('div');
    row.className = options?.compact ? 'dup-folder-target-row dup-folder-target-row-compact' : 'dup-folder-target-row';
    row.dataset.path = safeText(item?.path);

    const disclosure = document.createElement('button');
    disclosure.type = 'button';
    disclosure.className = 'dup-folder-disclosure';
    disclosure.title = item?.has_children ? '子フォルダを表示' : '子フォルダはありません';
    disclosure.setAttribute('aria-label', disclosure.title);
    disclosure.disabled = !item?.has_children;
    disclosure.classList.toggle('dup-folder-disclosure-empty', !item?.has_children);
    disclosure.innerHTML = item?.has_children ? lucide('chevronRight', 14) : '';

    const label = document.createElement('label');
    label.className = 'dup-folder-target-check';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = item?.enabled === true;
    checkbox.disabled = item?.automatic_available === false || options?.globalEnabled === false;
    checkbox.setAttribute('aria-label', `${safeText(item?.name || item?.path)}を重複検出の対象にする`);
    checkbox.dataset.e2eId = `duplicate-target-${safeText(item?.path)}`;
    const name = document.createElement('span');
    name.className = 'dup-folder-target-name';
    name.textContent = safeText(item?.name || displayPath(item?.path, 2) || 'フォルダ');
    label.append(checkbox, name);

    let help = null;
    if (options?.compact && typeof fieldHelp === 'function') {
      const holder = document.createElement('span');
      holder.innerHTML = fieldHelp('このフォルダを自動の重複確認へ含めます。オフでも「今回だけ調べる」は利用できます。');
      help = holder.firstElementChild;
      help.dataset.e2eId = `duplicate-target-help-${safeText(item?.path)}`;
    }
    const reason = document.createElement('span');
    reason.className = 'dup-folder-target-reason';
    const imageCount = Number(item?.indexed?.images);
    const countLabel = Number.isFinite(imageCount) ? ` / 索引済み画像 ${imageCount.toLocaleString('ja-JP')}件` : '';
    reason.textContent = folderStateLabel(item) + countLabel;
    reason.title = reason.textContent;
    row.append(disclosure, label);
    if (help) row.appendChild(help);
    row.appendChild(reason);
    const children = document.createElement('div');
    children.className = 'dup-folder-target-children';
    children.hidden = true;
    const wrapper = document.createElement('div');
    wrapper.className = 'dup-folder-target-node';
    wrapper.append(row, children);

    checkbox.addEventListener('change', async () => {
      const requestedEnabled = checkbox.checked; checkbox.disabled = true;
      try {
        const state = await saveFolderState(item.path, requestedEnabled);
        Object.assign(item, state || { enabled: requestedEnabled });
        checkbox.checked = item.enabled === true;
        reason.textContent = folderStateLabel(item);
        showStatus(checkbox.checked ? '重複検出の対象にしました' : '重複検出の対象外にしました');
      } catch (error) {
        checkbox.checked = !requestedEnabled;
        showStatus('フォルダの設定を変更できませんでした: ' + userError(error), true);
      } finally {
        checkbox.disabled = item?.automatic_available === false || options?.globalEnabled === false;
      }
    });

    disclosure.addEventListener('click', async () => {
      if (children.dataset.loaded === '1') {
        children.hidden = !children.hidden;
        disclosure.innerHTML = lucide(children.hidden ? 'chevronRight' : 'chevronDown', 14);
        return;
      }
      disclosure.disabled = true;
      try {
        const payload = await apiFetch('/duplicate-detection/folders?path=' + encodeURIComponent(item.path));
        renderFolderTargetTree(children, payload?.items || [], {
          globalEnabled: payload?.settings_enabled !== false,
        });
        children.dataset.loaded = '1';
        children.hidden = false;
        disclosure.innerHTML = lucide('chevronDown', 14);
      } catch (error) {
        showStatus('子フォルダを読み込めませんでした: ' + userError(error), true);
      } finally {
        disclosure.disabled = false;
      }
    });
    return wrapper;
  }

  function renderFolderTargetTree(host, items, options) {
    host.replaceChildren();
    if (!items.length) {
      const empty = document.createElement('div');
      empty.className = 'gb-section-desc';
      empty.textContent = '対象にできるローカルフォルダはありません';
      host.appendChild(empty);
      return;
    }
    items.forEach(item => host.appendChild(createFolderTargetRow(item, options)));
  }
  async function renderSettings(root) {
    const host = (root || document).querySelector?.('#settings-duplicate-detection');
    if (!host) return;
    const seq = ++settingsRenderSeq;
    if (!isLocalDuplicateMode()) {
      host.innerHTML = `<section class="gb-section gb-section--boxed">
        <div class="gb-section-title">${lucide('copy', 14)} 重複ファイルの検出</div>
        <div class="gb-section-desc">この設定はデスクトップ版のローカルフォルダで利用できます。</div>
      </section>`;
      return;
    }
    host.innerHTML = `<section class="gb-section gb-section--boxed">
      <div class="gb-section-title">${lucide('copy', 14)} 重複ファイルの検出</div>
      <div class="gb-section-desc">同じファイルや同じ内容の画像を索引化し、追加時に重複を知らせます。自動で削除はしません。</div>
      <div class="gb-section-desc" data-dup-settings-status>設定を読み込んでいます…</div>
    </section>`;
    try {
      const payload = await apiFetch('/duplicate-detection/settings');
      if (seq !== settingsRenderSeq || !host.isConnected) return;
      const settings = payload?.settings || {};
      const watcherAvailable = payload?.watcher_available !== false;
      // Phase 6-2 (6-1): 監視の既定はオフのまま。Meldex外の移動追従に監視が
      // 必要な旨の一回限りの可視案内は gb-duplicate-monitor-watch-changes-intro.js へ分離。
      const watchChangesIntroHtml = window.MeldexDuplicateWatchChangesIntro?.html(settings, watcherAvailable) || '';
      host.innerHTML = `<section class="gb-section gb-section--boxed dup-settings-section">
        <div class="gb-section-title">${lucide('copy', 14)} 重複ファイルの検出</div>
        <div class="gb-section-desc">同じファイルや同じ内容の画像を索引化し、追加時に重複を知らせます。自動で削除はしません。</div>
        <div class="gb-check-help-row">
          <label><input type="checkbox" data-dup-setting="enabled" data-e2e-id="duplicate-setting-enabled" ${settings.enabled !== false ? 'checked' : ''}> 重複を見張る</label>
          ${typeof fieldHelp === 'function' ? fieldHelp('オフにしても手動の「重複を確認」は利用できます。既存ファイルの索引は保持されます。') : ''}
        </div>
        <label class="dup-settings-field"><span>全体を調べ直す間隔</span>
          <select data-dup-setting="refresh_days" data-e2e-id="duplicate-setting-refresh-days">
            <option value="0" ${Number(settings.refresh_days) === 0 ? 'selected' : ''}>自動では調べ直さない</option>
            <option value="1" ${Number(settings.refresh_days) === 1 ? 'selected' : ''}>毎日</option>
            <option value="7" ${Number(settings.refresh_days ?? 7) === 7 ? 'selected' : ''}>7日ごと</option>
            <option value="30" ${Number(settings.refresh_days) === 30 ? 'selected' : ''}>30日ごと</option>
          </select>
        </label>
        ${watchChangesIntroHtml}
        <div class="gb-check-help-row">
          <label><input type="checkbox" data-dup-setting="watch_changes" data-e2e-id="duplicate-setting-watch-changes" ${settings.watch_changes ? 'checked' : ''} ${watcherAvailable ? '' : 'disabled'}> フォルダの変更をすぐ確認</label>
          ${typeof fieldHelp === 'function' ? fieldHelp(watcherAvailable ? 'ファイル追加を監視し、短時間に続いた変更は一つの処理にまとめます。' : 'この環境では変更監視を利用できません。保存や取り込み後の確認と定期更新は利用できます。') : ''}
        </div>
        <div class="gb-section-desc">オンにすると、エクスプローラーなどMeldexの外で行った移動・改名にも、タグ・注釈・版履歴・検索索引・編集ロックが追従します。</div>
        <div class="dup-settings-actions">
          <button type="button" class="gb-btn gb-btn-sm" data-dup-baseline data-e2e-id="duplicate-setting-scan-now">${lucide('scanSearch', 14)} 今すぐ全体を調べる</button>
          <span class="gb-section-desc" data-dup-settings-message aria-live="polite"></span>
        </div>
      </section>
      <section class="gb-section gb-section--boxed dup-settings-section">
        <div class="gb-section-title">${lucide('folderTree', 14)} 対象フォルダ</div>
        <div class="gb-section-desc">親フォルダの設定は子フォルダへ引き継がれます。必要な場所だけ個別に切り替えられます。</div>
        <div class="dup-folder-target-tree" data-dup-folder-tree><div class="gb-section-desc">フォルダを読み込んでいます…</div></div>
      </section>`;

      window.MeldexDuplicateWatchChangesIntro?.bind(host, {
        apiFetch,
        onSaved: async () => { notifyTargetChange(''); await renderSettings(root); },
        onError: (message, error) => showStatus(`${message}: ${userError(error)}`, true),
      });

      const settingInputs = [...host.querySelectorAll('[data-dup-setting]')];
      const saveSettings = async () => {
        const body = {
          enabled: host.querySelector('[data-dup-setting="enabled"]')?.checked !== false,
          refresh_days: Number(host.querySelector('[data-dup-setting="refresh_days"]')?.value || 0),
          watch_changes: host.querySelector('[data-dup-setting="watch_changes"]')?.checked === true,
        };
        settingInputs.forEach(input => { input.disabled = true; });
        try {
          await apiFetch('/duplicate-detection/settings', { method: 'PUT', body: JSON.stringify(body) });
          notifyTargetChange('');
          showStatus('重複検出の設定を保存しました');
          await renderSettings(root);
        } catch (error) {
          showStatus('重複検出の設定を保存できませんでした: ' + userError(error), true);
          settingInputs.forEach(input => { input.disabled = false; });
        }
      };
      settingInputs.forEach(input => input.addEventListener('change', saveSettings));
      host.querySelector('[data-dup-baseline]')?.addEventListener('click', async event => {
        const button = event.currentTarget;
        const message = host.querySelector('[data-dup-settings-message]');
        button.disabled = true;
        if (message) message.textContent = '全体確認を開始しています…';
        try {
          const started = await apiPost('/duplicate-monitor/start', { force: true });
          if (message) message.textContent = started?.status === 'disabled'
            ? '「重複を見張る」をオンにすると全体確認を開始できます。'
            : '全体確認を裏側で開始しました。重複が見つかると通知します。';
        } catch (error) {
          if (message) message.textContent = '開始できませんでした: ' + userError(error);
        } finally {
          button.disabled = false;
        }
      });
      const folders = await apiFetch('/duplicate-detection/folders');
      if (seq !== settingsRenderSeq || !host.isConnected) return;
      renderFolderTargetTree(host.querySelector('[data-dup-folder-tree]'), folders?.items || [], {
        globalEnabled: folders?.settings_enabled !== false,
      });
    } catch (error) {
      if (seq !== settingsRenderSeq || !host.isConnected) return;
      const status = host.querySelector('[data-dup-settings-status]');
      if (status) status.textContent = '設定を読み込めませんでした: ' + userError(error);
    }
  }
  async function renderSingleFolderTarget(host) {
    const path = safeText(host?.dataset?.path);
    if (!path || !host?.isConnected) return;
    host.innerHTML = '<div class="gb-section-desc">重複検出の設定を読み込んでいます…</div>';
    try {
      const state = await loadFolderState(path, false);
      if (!host.isConnected || host.dataset.path !== path) return;
      const item = { ...state, path, name: 'このフォルダを対象にする', has_children: false };
      const section = document.createElement('section');
      section.className = 'gb-section gb-section--boxed dup-folder-option';
      const title = document.createElement('div');
      title.className = 'gb-section-title';
      title.innerHTML = lucide('copy', 14) + ' 重複検出';
      const tree = document.createElement('div');
      tree.appendChild(createFolderTargetRow(item, {
        compact: true,
        globalEnabled: state?.reason !== '重複を見張る設定がオフ',
      }));
      const action = document.createElement('button');
      action.type = 'button';
      action.className = 'gb-btn gb-btn-sm';
      action.dataset.e2eId = `duplicate-manual-scan-${path}`;
      action.innerHTML = lucide('scanSearch', 14) + ' 今回だけ調べる';
      action.addEventListener('click', () => openManualScan(path));
      section.append(title, tree, action);
      host.replaceChildren(section);
    } catch (error) {
      host.innerHTML = `<div class="gb-section-desc">重複検出の設定を読み込めませんでした: ${esc(userError(error))}</div>`;
    }
  }

  function renderFolderTargetControls(root) {
    (root || document).querySelectorAll?.('[data-duplicate-folder-setting][data-path]').forEach(host => {
      renderSingleFolderTarget(host);
    });
  }
  async function refreshOutlinerBadges(root) {
    if (!isLocalDuplicateMode()) return;
    const nodes = [...(root || document).querySelectorAll?.('.tree-node[data-path]') || []].slice(0, 100);
    await Promise.allSettled(nodes.map(async node => {
      if (node._nodeData?.type !== 'folder') return;
      const row = node.querySelector(':scope > .tree-node-row');
      if (!row || row.querySelector(':scope > .dup-folder-excluded-badge')) return;
      const state = await loadFolderState(node.dataset.path, false);
      if (!row.isConnected || state?.enabled !== false) return;
      const badge = document.createElement('span');
      badge.className = 'dup-folder-excluded-badge';
      badge.textContent = '対象外';
      badge.title = folderStateLabel(state);
      row.appendChild(badge);
    }));
  }

  window.MeldexDuplicateMonitor = {
    openManualScan,
    pollNow: pollAlerts,
    renderSettings,
    renderFolderTargetControls,
    refreshOutlinerBadges,
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
  window.addEventListener('meldex:duplicate-targets-changed', () => {
    const settingsHost = document.querySelector('#settings-duplicate-detection');
    if (settingsHost?.isConnected && !settingsHost.closest('[hidden]')) renderSettings(document);
    renderFolderTargetControls(document);
    document.querySelectorAll('.dup-folder-excluded-badge').forEach(badge => badge.remove());
    refreshOutlinerBadges(document);
  });
  window.addEventListener('meldex:outliner-rendered', () => refreshOutlinerBadges(document));
  const duplicateBroadcast = (typeof MeldexBroadcast !== 'undefined' && MeldexBroadcast) || window.GBBroadcast || null;
  duplicateBroadcast?.on?.('duplicate-targets-changed', message => {
    invalidateFolderStateCache();
    window.dispatchEvent(new CustomEvent('meldex:duplicate-targets-changed', {
      detail: { path: safeText(message?.path), remote: true },
    }));
  });
  window.addEventListener('load', () => setTimeout(() => {
    // デスクトップ付箋の小窓には重複の通知先もフォルダツリーも無い。監視は本体側だけが行う。
    if (typeof _isTrayAnnotationHost === 'function' && _isTrayAnnotationHost()) return;
    startMonitor();
    refreshOutlinerBadges(document);
  }, 0), { once: true });
})();
