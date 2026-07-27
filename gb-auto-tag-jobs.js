/* 自動タグ付けの長時間ジョブ表示。
   実行開始後は画面遷移に依存せずポーリングし、Meldexの他の操作を妨げない。 */
(function () {
  'use strict';

  const STORAGE_KEY = 'meldex.autoTag.activeJobs.v1';
  const POLL_INTERVAL_MS = 1200;
  const jobs = new Map();
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

  function formatDuration(seconds) {
    const value = Math.max(0, Number(seconds) || 0);
    if (value < 60) return Math.ceil(value) + '秒';
    if (value < 3600) return Math.ceil(value / 60) + '分';
    if (value < 86400) return (value / 3600).toFixed(value < 36000 ? 1 : 0) + '時間';
    return (value / 86400).toFixed(1) + '日';
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
    if (job.status === 'error') return job.error || '処理に失敗しました';
    if (job.status === 'cancelled') return '処理を中止しました';
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
        progress.eta_seconds ? `残り約${formatDuration(progress.eta_seconds)}` : '',
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
                <strong>${window.esc(item.stage || '自動タグ付け')}</strong>
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
          <strong>${window.esc(job.label || '自動タグ付け')}</strong>
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
        <strong>${icon('tags', 14)} 自動タグ付け</strong>
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
        jobs.delete(button.dataset.atJobDismiss);
        persist();
        render();
      });
    });
  }

  function notifyFinished(job) {
    window.MeldexGlobalTags?.invalidateTagsCatalogCache?.();
    if (typeof _folderEnsureTags === 'function' && typeof _folderItems !== 'undefined') {
      _folderEnsureTags(_folderItems, { rerender: true });
    }
    window.MeldexTagManagement?.refresh?.(false);
    document.dispatchEvent(new CustomEvent('meldex:auto-tag-job-finished', { detail: job }));
    if (job.status === 'done') {
      const result = job.result || {};
      const message = `${Number(result.succeeded || 0).toLocaleString('ja-JP')}件の自動タグ付けが完了しました`;
      if (typeof showStatus === 'function') showStatus(message, !!result.failed);
    } else if (job.status === 'error' && typeof showStatus === 'function') {
      showStatus('自動タグ付けに失敗しました: ' + (job.error || ''), true);
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

  async function start(payload, options) {
    const started = await apiPost('/global-tags/auto-tag', payload || {}, { silentError: true });
    if (!started?.job_id) return started;
    const job = {
      id: started.job_id,
      status: started.status || 'running',
      label: options?.label || payload?.label || payload?.path
        || `${Array.isArray(payload?.targets) ? payload.targets.length : 0}件`,
      progress: { processed: 0, total: null, phase: '準備中', message: '自動タグ付けを準備しています' },
    };
    jobs.set(job.id, job);
    persist();
    render();
    poll(job.id);
    if (typeof showStatus === 'function') showStatus('自動タグ付けをバックグラウンドで開始しました');
    return { ...started, background: true };
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
        label: '自動タグ付け',
        progress: { processed: 0, total: null, phase: '状態を確認中', message: '' },
      });
      poll(id);
    });
    render();
  }

  window.MeldexAutoTagJobs = {
    start,
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
