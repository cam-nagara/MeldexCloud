/* 自動タグ付けの長時間ジョブ表示。
   実行開始後は画面遷移に依存せずポーリングし、Meldexの他の操作を妨げない。 */
(function () {
  'use strict';

  const STORAGE_KEY = 'meldex.autoTag.activeJobs.v1';
  const POLL_INTERVAL_MS = 1200;
  const SUCCESS_DISMISS_MS = 1800;
  const jobs = new Map();
  const successDismissTimers = new Map();
  let tray = null;
  let minimized = false;

  function icon(name, size) {
    return typeof lucide === 'function' ? lucide(name, size || 14) : '';
  }

  function activeJobIds() {
    return [...jobs.values()]
      .filter(job => ['running', 'cancelling'].includes(job.status))
      .map(job => job.id);
  }

  function persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(activeJobIds()));
    } catch (_) {
      // 保存容量不足やプライベートモードでも、現在のジョブ表示と処理は継続する。
    }
  }


  function progressText(job) {
    const progress = job.progress || {};
    const processed = Number(progress.processed) || 0;
    const hasTotal = progress.total !== null
      && progress.total !== undefined
      && Number.isFinite(Number(progress.total));
    const total = hasTotal ? Number(progress.total) : null;
    if (job.status === 'done') {
      const result = job.result || {};
      return `${Number(result.succeeded || 0).toLocaleString('ja-JP')}件完了`
        + (result.skipped ? `・${Number(result.skipped).toLocaleString('ja-JP')}件対象外` : '')
        + (result.failed ? `・${Number(result.failed).toLocaleString('ja-JP')}件失敗` : '');
    }
    if (job.status === 'error') {
      const result = job.result || {};
      const assigned = Number(result.assigned ?? result.changed ?? 0) || 0;
      const unprocessed = Number(result.unprocessed || 0) || 0;
      const partial = result.fatal_error
        ? `・${assigned.toLocaleString('ja-JP')}件保存済み・${unprocessed.toLocaleString('ja-JP')}件未処理`
        : '';
      return (job.error || '処理に失敗しました') + partial;
    }
    if (job.status === 'cancelled') {
      const result = job.result || {};
      const assigned = Number(result.assigned ?? result.changed ?? 0) || 0;
      const failed = Number(result.failed || 0) || 0;
      return `処理を中止しました・${assigned.toLocaleString('ja-JP')}件保存済み`
        + (failed ? `・${failed.toLocaleString('ja-JP')}件失敗` : '');
    }
    if (progress.message) return progress.message;
    if (hasTotal) {
      return `${processed.toLocaleString('ja-JP')} / ${total.toLocaleString('ja-JP')}件`;
    }
    return `${processed.toLocaleString('ja-JP')}件を確認しました`;
  }

  function jobRowHtml(job) {
    const progress = job.progress || {};
    const processed = Number(progress.processed) || 0;
    const hasTotal = progress.total !== null
      && progress.total !== undefined
      && Number.isFinite(Number(progress.total));
    const total = hasTotal ? Number(progress.total) : null;
    const percent = hasTotal && total > 0
      ? Math.max(0, Math.min(100, processed / total * 100))
      : 0;
    const running = ['running', 'cancelling'].includes(job.status);
    const stats = running && hasTotal
      ? [
        `${processed.toLocaleString('ja-JP')} / ${total.toLocaleString('ja-JP')}件`,
        progress.rate ? `${Number(progress.rate).toFixed(1)}件/秒` : '',
        progress.eta_seconds ? `残り約${window.formatJobEta(progress.eta_seconds)}` : '',
      ].filter(Boolean).join('・')
      : '';
    const failureSamples = Array.isArray(job.result?.failure_samples)
      ? job.result.failure_samples
      : [];
    const terminalPhase = {
      done: Number(job.result?.failed || 0) > 0 ? '一部失敗' : '完了',
      error: '失敗',
      cancelled: '中止',
    }[job.status];
    const phase = String(terminalPhase || progress.phase || (running ? '処理中' : ''));
    const failureDetails = !running && failureSamples.length
      ? `
        <details class="at-job-failures">
          <summary>失敗した項目を確認（${Number(job.result?.failed || failureSamples.length).toLocaleString('ja-JP')}件）</summary>
          <ul>
            ${failureSamples.map(item => `
              <li>
                <strong>${window.esc(item.stage || 'タグ処理')}</strong>
                <span title="${window.esc(item.path || '')}">${window.esc(item.path || '対象不明')}</span>
                <small>${window.esc(item.message || '詳細なし')}</small>
              </li>
            `).join('')}
          </ul>
        </details>
      `
      : '';
    return `
      <article class="at-job at-job--${window.esc(job.status)}${Number(job.result?.failed || 0) > 0 ? ' at-job--partial' : ''}" data-at-job-id="${window.esc(job.id)}">
        <div class="at-job-head">
          <strong>${window.esc(job.label || 'タグ処理')}</strong>
          <span>${window.esc(phase)}</span>
        </div>
        <div class="at-job-progress" role="progressbar"
          aria-valuemin="0"${hasTotal ? ` aria-valuemax="${window.esc(total)}"` : ''}
          aria-valuenow="${window.esc(processed)}">
          <span style="width:${percent}%"></span>
        </div>
        <p class="at-job-message" aria-live="polite">${window.esc(progressText(job))}</p>
        ${stats ? `<p class="at-job-stats">${window.esc(stats)}</p>` : ''}
        ${progress.current ? `<p class="at-job-current" title="${window.esc(progress.current)}">${window.esc(progress.current)}</p>` : ''}
        ${failureDetails}
        <div class="at-job-actions">
          ${running
            ? `<button type="button" class="gb-btn gb-btn-xs gb-btn-quiet" data-at-job-cancel="${window.esc(job.id)}">${icon('square', 12)} 中止</button>`
            : `<button type="button" class="gb-btn gb-btn-xs gb-btn-quiet" data-at-job-dismiss="${window.esc(job.id)}">${icon('x', 12)} 閉じる</button>`}
        </div>
      </article>
    `;
  }

  function ensureTray() {
    if (tray?.isConnected) return tray;
    tray = document.createElement('section');
    tray.className = 'at-job-tray';
    tray.setAttribute('aria-label', '自動タグ付けの進捗');
    tray.dataset.e2eId = 'auto-tag-job-tray';
    document.body.appendChild(tray);
    return tray;
  }

  function render() {
    const host = ensureTray();
    const rows = [...jobs.values()];
    const hasFailures = rows.some(job => (
      job.status === 'error' || Number(job.result?.failed || 0) > 0
    ));
    host.hidden = rows.length === 0;
    host.classList.toggle('at-job-tray--minimized', minimized);
    host.innerHTML = `
      <header class="at-job-tray-head">
        <strong>${icon('tags', 14)} タグ処理</strong>
        <span>${activeJobIds().length ? `${activeJobIds().length}件実行中` : (hasFailures ? '要確認' : '完了')}</span>
        <button type="button" class="gb-btn gb-btn-icon gb-btn-xs" data-at-job-minimize
          aria-label="${minimized ? '進捗を展開' : '進捗を折りたたむ'}">
          ${icon(minimized ? 'chevronUp' : 'chevronDown', 14)}
        </button>
      </header>
      <div class="at-job-list">${rows.map(jobRowHtml).join('')}</div>
    `;
    host.querySelector('[data-at-job-minimize]')?.addEventListener('click', () => {
      minimized = !minimized;
      render();
    });
    host.querySelectorAll('[data-at-job-cancel]').forEach(button => {
      button.addEventListener('click', () => cancel(button.dataset.atJobCancel));
    });
    host.querySelectorAll('[data-at-job-dismiss]').forEach(button => {
      button.addEventListener('click', () => {
        clearTimeout(successDismissTimers.get(button.dataset.atJobDismiss));
        successDismissTimers.delete(button.dataset.atJobDismiss);
        jobs.delete(button.dataset.atJobDismiss);
        persist();
        render();
      });
    });
  }

  function scheduleSuccessfulDismiss(job) {
    if (job?.status !== 'done' || Number(job?.result?.failed || 0) > 0) return;
    clearTimeout(successDismissTimers.get(job.id));
    const timer = setTimeout(() => {
      successDismissTimers.delete(job.id);
      const current = jobs.get(job.id);
      if (current?.status !== 'done' || Number(current?.result?.failed || 0) > 0) return;
      jobs.delete(job.id);
      persist();
      render();
    }, SUCCESS_DISMISS_MS);
    successDismissTimers.set(job.id, timer);
  }

  function notifyFinished(job) {
    window.MeldexGlobalTags?.invalidateTagsCatalogCache?.();
    window.MeldexGlobalTags?.invalidateTargetTagsCache?.();
    if (typeof _folderRefreshTags === 'function' && typeof _folderItems !== 'undefined') {
      void _folderRefreshTags(_folderItems, { rerender: true, all: true }).catch(error => {
        console.warn('[Meldex] タグ処理後のフォルダタグ更新に失敗しました', error);
      });
    }
    window.MeldexTagManagement?.refresh?.(false);
    document.dispatchEvent(new CustomEvent('meldex:auto-tag-job-finished', { detail: job }));
    document.dispatchEvent(new CustomEvent('meldex:tag-job-finished', { detail: job }));
    const isReset = job.kind === 'global-tag-reset';
    if (job.status === 'done') {
      const result = job.result || {};
      const message = isReset
        ? `${Number(result.succeeded || 0).toLocaleString('ja-JP')}件のタグをリセットしました`
        : `${Number(result.succeeded || 0).toLocaleString('ja-JP')}件の自動タグ付けが完了しました`;
      if (typeof showStatus === 'function') showStatus(message, !!result.failed);
      scheduleSuccessfulDismiss(job);
    } else if (job.status === 'cancelled' && typeof showStatus === 'function') {
      const result = job.result || {};
      const assigned = Number(result.assigned ?? result.changed ?? 0) || 0;
      const failed = Number(result.failed || 0) || 0;
      const message = `${isReset ? 'タグのリセット' : '自動タグ付け'}を中止しました: ${assigned.toLocaleString('ja-JP')}件保存済み`
        + (failed ? `・${failed.toLocaleString('ja-JP')}件失敗` : '');
      showStatus(message, failed > 0);
    } else if (job.status === 'error' && typeof showStatus === 'function') {
      showStatus(`${isReset ? 'タグのリセット' : '自動タグ付け'}に失敗しました: ` + progressText(job), true);
    }
  }

  async function poll(jobId) {
    while (jobs.has(jobId)) {
      let snapshot;
      try {
        snapshot = await apiFetch('/jobs/' + encodeURIComponent(jobId), { silentError: true });
      } catch (error) {
        const current = jobs.get(jobId);
        if (!current) return;
        if (error?.isTimeout) {
          await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
          continue;
        }
        current.status = 'error';
        current.error = error?.userMessage || error?.message || String(error);
        persist();
        render();
        notifyFinished(current);
        return;
      }
      jobs.set(jobId, { ...jobs.get(jobId), ...snapshot, id: jobId });
      persist();
      render();
      if (!['running', 'cancelling'].includes(snapshot.status)) {
        notifyFinished(jobs.get(jobId));
        return;
      }
      await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
    }
  }

  async function startEndpoint(endpoint, payload, options) {
    const started = await apiPost(endpoint, payload || {}, { silentError: true });
    if (!started?.job_id) return started;
    const job = {
      id: started.job_id,
      status: started.status || 'running',
      kind: options?.kind || started.kind || 'auto-tag',
      label: options?.label || payload?.label || payload?.path
        || `${Array.isArray(payload?.targets) ? payload.targets.length : 0}件`,
      progress: { processed: 0, total: null, phase: '準備中', message: options?.preparing || '自動タグ付けを準備しています' },
    };
    jobs.set(job.id, job);
    persist();
    render();
    poll(job.id);
    if (typeof showStatus === 'function') showStatus(options?.started || '自動タグ付けをバックグラウンドで開始しました');
    return { ...started, background: true };
  }

  function start(payload, options) {
    return startEndpoint('/global-tags/auto-tag', payload, options);
  }

  // Phase 8(2026-08-14自動タグ付け計画): Web Clipperが保存した画像の
  // 待ち行列をまとめて処理する。対象は待ち行列のパスに固定されるため、
  // 呼び出し側はソースフォルダだけを渡す。
  function startPendingQueue(sourceFolder, options) {
    return startEndpoint('/auto-tag/pending/run', { source_folder: sourceFolder }, {
      ...options,
      label: options?.label || 'Web Clipperの画像認識',
    });
  }

  function startReset(payload, options) {
    return startEndpoint('/global-tags/reset', payload, {
      ...options,
      kind: 'global-tag-reset',
      preparing: 'タグのリセットを準備しています',
      started: 'タグの一括リセットをバックグラウンドで開始しました',
    });
  }

  async function cancel(jobId) {
    const job = jobs.get(jobId);
    if (!job || !['running', 'cancelling'].includes(job.status)) return;
    job.status = 'cancelling';
    job.progress = { ...job.progress, phase: '中止中', message: '安全に中止できる位置まで処理しています' };
    render();
    try {
      await apiPost('/jobs/' + encodeURIComponent(jobId) + '/cancel', {}, { silentError: true });
    } catch (error) {
      job.status = 'error';
      job.error = '中止要求を送信できませんでした: ' + (error?.userMessage || error?.message || error);
      render();
    }
  }

  function restore() {
    let ids = [];
    try {
      ids = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    } catch (_) {
      // 壊れた端末内キャッシュは復元せず、サーバー側の実行自体には影響させない。
    }
    (Array.isArray(ids) ? ids : []).forEach(id => {
      if (!id || jobs.has(id)) return;
      jobs.set(id, {
        id,
        status: 'running',
        label: 'タグ処理',
        progress: { processed: 0, total: null, phase: '状態を確認中', message: '' },
      });
      poll(id);
    });
    render();
  }

  window.MeldexAutoTagJobs = {
    start,
    startReset,
    startPendingQueue,
    cancel,
    restore,
    snapshot: () => [...jobs.values()].map(job => ({ ...job })),
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', restore, { once: true });
  } else {
    restore();
  }
})();
