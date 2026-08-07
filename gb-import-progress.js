// gb-import-progress.js — ステータスバーのインポート進捗表示（進捗率・プログレスバー・待機件数）。
// WebClipper・インポート定期実行計画 2026-08-04「バックグラウンドジョブと進捗」節で実装。
//
// 既存の #status-bar DOM（Meldex.html/Meldex-dev.html。meldex-core編集禁止のため
// ランタイムでのみ挿入する）へ、通常メッセージ（#sb-msg）とは独立した進捗欄を追加する。
// 手動実行・定期実行・追いつき実行のいずれも共通ジョブランナー（/api/jobs、
// category=import）を通るため、ここでは種類を問わずポーリングして表示する。
//
// 画面移動・再読み込み後もアクティブなジョブ（queued/running/cancelling）を
// /api/jobs?category=import&active_only=1 から復元できるようにする。
(function () {
  'use strict';

  const POLL_INTERVAL_MS = 1500;
  const CATEGORY = 'import';

  const KIND_LABELS = {
    'notion-sync': 'Notion同期',
    'x-bookmarks': 'Xブックマーク',
    'x-account-posts': 'Xアカウント投稿',
    'external-import': '外部取り込み',
    'pureref-import': 'PureRef取り込み',
    'enex-import': 'ENEX取り込み',
  };

  let _container = null;
  let _pollTimer = null;
  let _lastRenderedJobId = null;

  function _kindLabel(kind) {
    return KIND_LABELS[kind] || kind || 'インポート';
  }

  function _apiAvailable() {
    return typeof apiFetch === 'function';
  }

  function _ensureContainer() {
    if (_container && _container.isConnected) return _container;
    const statusBar = document.getElementById('status-bar');
    if (!statusBar) return null;
    const existing = document.getElementById('sb-import-progress');
    if (existing) {
      _container = existing;
      return _container;
    }
    const wrap = document.createElement('span');
    wrap.id = 'sb-import-progress';
    wrap.className = 'sb-import-progress';
    wrap.style.display = 'none';
    wrap.setAttribute('role', 'status');
    wrap.setAttribute('aria-live', 'polite');
    wrap.innerHTML = `
      <span class="sb-import-progress-label" data-e2e-id="import-progress-label"></span>
      <span class="sb-import-progress-bar-track"><span class="sb-import-progress-bar-fill" data-e2e-id="import-progress-bar"></span></span>
      <span class="sb-import-progress-queue" data-e2e-id="import-progress-queue"></span>
    `;
    const shortcuts = document.getElementById('sb-shortcuts');
    if (shortcuts && shortcuts.parentNode === statusBar) {
      statusBar.insertBefore(wrap, shortcuts);
    } else {
      statusBar.appendChild(wrap);
    }
    _container = wrap;
    return _container;
  }

  function _percent(progress) {
    if (!progress) return null;
    const total = Number(progress.total);
    const processed = Number(progress.processed) || 0;
    if (!Number.isFinite(total) || total <= 0) return null;
    return Math.max(0, Math.min(100, Math.round((processed / total) * 100)));
  }

  // 進捗率は単調増加で表示し、保存完了時のみ100%にする
  // （WebClipper・インポート定期実行計画 2026-08-04「バックグラウンドジョブと進捗」節）。
  let _lastPercentByJob = {};

  function _monotonicPercent(jobId, rawPercent, status) {
    if (status === 'done') {
      _lastPercentByJob[jobId] = 100;
      return 100;
    }
    if (rawPercent == null) return _lastPercentByJob[jobId] != null ? _lastPercentByJob[jobId] : null;
    const previous = _lastPercentByJob[jobId];
    const next = previous != null ? Math.max(previous, rawPercent) : rawPercent;
    // 完了前は100%を先取りしない（保存完了時のみ100%にする）
    _lastPercentByJob[jobId] = Math.min(next, 99);
    return _lastPercentByJob[jobId];
  }

  function _renderJob(job, queuedCount) {
    const el = _ensureContainer();
    if (!el) return;
    const label = el.querySelector('.sb-import-progress-label');
    const fill = el.querySelector('.sb-import-progress-bar-fill');
    const queue = el.querySelector('.sb-import-progress-queue');
    if (!job) {
      el.style.display = 'none';
      _lastRenderedJobId = null;
      return;
    }
    el.style.display = '';
    const kindText = _kindLabel(job.kind);
    const target = job.label ? `${kindText}: ${job.label}` : kindText;
    const isQueued = job.status === 'queued';
    const rawPercent = _percent(job.progress);
    const percent = isQueued ? 0 : _monotonicPercent(job.id, rawPercent, job.status);
    if (isQueued) {
      label.textContent = `取り込み待ち: ${target}`;
    } else if (percent == null) {
      const phase = job.progress?.phase || '準備中';
      label.textContent = `取り込み: ${target} ${phase}`;
    } else {
      label.textContent = `取り込み: ${target} ${percent}%`;
    }
    if (fill) {
      fill.style.width = (percent == null ? 0 : percent) + '%';
      fill.classList.toggle('sb-import-progress-bar-indeterminate', percent == null && !isQueued);
    }
    queue.textContent = queuedCount > 0 ? `待機中 ${queuedCount}件` : '';
    _lastRenderedJobId = job.id;
  }

  function _pickActiveJob(jobs) {
    // running優先、次にcancelling、最後にqueued。複数あれば開始が早いものを表示。
    const priority = { running: 0, cancelling: 1, queued: 2 };
    const active = jobs.filter(j => j.status === 'running' || j.status === 'cancelling' || j.status === 'queued');
    active.sort((a, b) => {
      const pa = priority[a.status] ?? 9;
      const pb = priority[b.status] ?? 9;
      if (pa !== pb) return pa - pb;
      return (a.started_at || a.queued_at || 0) - (b.started_at || b.queued_at || 0);
    });
    return active;
  }

  async function _poll() {
    if (!_apiAvailable()) return;
    try {
      const data = await apiFetch(`/jobs?category=${encodeURIComponent(CATEGORY)}&active_only=1`, { silentError: true });
      const jobs = Array.isArray(data?.jobs) ? data.jobs : [];
      const active = _pickActiveJob(jobs);
      if (!active.length) {
        _renderJob(null, 0);
        return;
      }
      const [current, ...rest] = active;
      _renderJob(current, rest.length);
    } catch (e) {
      // ポーリング失敗は静かに無視する（次回ポーリングで回復すれば表示が戻る）
    }
  }

  function start() {
    if (_pollTimer) return;
    _poll();
    _pollTimer = setInterval(_poll, POLL_INTERVAL_MS);
  }

  function stop() {
    if (_pollTimer) {
      clearInterval(_pollTimer);
      _pollTimer = null;
    }
  }

  function _injectCSS() {
    if (document.getElementById('gb-import-progress-css-fallback')) return;
    // 通常は gb-import-progress.css（Meldex-dev.html に登録済み）を使うが、
    // 単体HTML等で読み込まれなかった場合のフォールバックとして最低限のスタイルを注入する。
    if (document.querySelector('link[href$="gb-import-progress.css"]')) return;
    const style = document.createElement('style');
    style.id = 'gb-import-progress-css-fallback';
    style.textContent = `
      .sb-import-progress { display:flex; align-items:center; gap:6px; font-size:11px; color:var(--fg2); white-space:nowrap; }
      .sb-import-progress-bar-track { width:60px; height:6px; border-radius:3px; background:var(--border); overflow:hidden; flex-shrink:0; }
      .sb-import-progress-bar-fill { display:block; height:100%; background:var(--accent); width:0%; transition:width .3s ease; }
      .sb-import-progress-bar-indeterminate { width:40% !important; animation:sb-import-progress-indeterminate 1.2s ease-in-out infinite; }
      @keyframes sb-import-progress-indeterminate { 0% { margin-left:0; } 50% { margin-left:60%; } 100% { margin-left:0; } }
      .sb-import-progress-queue { color:var(--fg2); }
    `;
    document.head.appendChild(style);
  }

  function _init() {
    _injectCSS();
    _ensureContainer();
    start();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _init);
  } else {
    _init();
  }

  window.MeldexImportProgress = { start, stop, poll: _poll };
})();
