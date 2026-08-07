/* X account post import settings */
(function () {
  'use strict';

  const ROOT_ID = 'x-account-posts-settings-container';
  const USERNAME_RE = /^[A-Za-z0-9_]{1,15}$/;
  const ACTIVE_JOB_STORAGE_KEY = 'meldex.x-account-posts.active-job.v1';
  let syncInFlight = false;
  let connected = false;

  function icon(name, size) {
    if (typeof lucide === 'function') return lucide(name, size || 14);
    return '';
  }

  function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = String(value || '');
  }

  function setStatus(message, isError) {
    const el = document.getElementById('x-account-posts-status');
    if (!el) return;
    el.textContent = String(message || '');
    el.style.color = isError ? 'var(--red)' : 'var(--fg2)';
  }

  function normalizeUsername(raw) {
    let text = String(raw || '').trim();
    if (/^https?:\/\//i.test(text)) {
      try {
        const url = new URL(text);
        if (!/(^|\.)x\.com$|(^|\.)twitter\.com$/i.test(url.hostname)) return '';
        text = url.pathname.split('/').filter(Boolean)[0] || '';
      } catch (_) {
        return '';
      }
    }
    text = text.replace(/^@+/, '').trim();
    return USERNAME_RE.test(text) ? text : '';
  }

  function updateSavePreview() {
    const raw = document.getElementById('x-account-posts-username')?.value || '';
    const username = normalizeUsername(raw);
    setText('x-account-posts-save-preview', username
      ? `保存先: Xアカウント/@${username}`
      : '保存先: ユーザー名を入力すると表示されます');
    updateControls();
  }

  function updateControls() {
    const raw = document.getElementById('x-account-posts-username')?.value || '';
    const hasValidUsername = !!normalizeUsername(raw);
    const button = document.getElementById('x-account-posts-sync');
    if (button) button.disabled = syncInFlight || !connected || !hasValidUsername;
    const input = document.getElementById('x-account-posts-username');
    if (input) input.disabled = syncInFlight;
  }

  function setBusy(active) {
    syncInFlight = !!active;
    updateControls();
  }

  function readActiveJob() {
    try {
      const value = JSON.parse(localStorage.getItem(ACTIVE_JOB_STORAGE_KEY) || 'null');
      if (!value?.jobId || !normalizeUsername(value.username)) return null;
      return value;
    } catch (_) {
      return null;
    }
  }

  function rememberActiveJob(jobId, username) {
    try {
      localStorage.setItem(ACTIVE_JOB_STORAGE_KEY, JSON.stringify({
        jobId: String(jobId || ''),
        username: normalizeUsername(username),
        startedAt: Date.now(),
      }));
    } catch (_) {
      // 保存状況の復元が使えない環境でも、現在の画面では処理を継続できる。
    }
  }

  function forgetActiveJob(jobId) {
    const active = readActiveJob();
    if (jobId && active?.jobId && active.jobId !== jobId) return;
    try {
      localStorage.removeItem(ACTIVE_JOB_STORAGE_KEY);
    } catch (_) {
      // 追跡情報を消せない環境でも、確定済みの保存結果は変わらない。
    }
  }

  async function loadConnectionStatus() {
    if (typeof apiFetch !== 'function') {
      connected = false;
      setText('x-account-posts-connection', 'X接続状態を確認できません');
      updateControls();
      return;
    }
    try {
      const data = await apiFetch('/x-bookmarks/status', { silentError: true });
      connected = data?.connected === true;
      const username = data?.user?.username ? `@${data.user.username}` : '';
      setText('x-account-posts-connection', connected ? `X接続済み ${username}` : '先に「Xブックマーク」でXへ接続してください');
    } catch (error) {
      connected = false;
      setText('x-account-posts-connection', 'X接続状態を取得できませんでした');
    }
    updateControls();
  }

  function resultSummary(data) {
    let message = `@${data.username} のポストを保存しました。新規${data.created || 0}件、更新${data.updated || 0}件、取得${data.fetched || 0}件。`;
    if (data.skipped) message += ` 保存対象外${data.skipped}件。`;
    if (data.media_failed) message += ` メディア取得失敗${data.media_failed}件。`;
    if (data.stop_reason === 'repeated_pagination_token') message += ' X APIから同じページ情報が返されたため、安全のため停止しました。もう一度実行してください。';
    if (data.api_limit_reached) message += ' X APIの仕様上、最新3,200件が上限です。';
    return message;
  }

  function retryAtText(value) {
    const epoch = Number(value);
    if (Number.isFinite(epoch) && epoch > 0) {
      return new Date(epoch * 1000).toLocaleString('ja-JP');
    }
    return String(value || 'しばらく後');
  }

  function jobProgressText(progress) {
    progress = progress || {};
    const fetched = Number(progress.processed) || 0;
    const saved = Number(progress.succeeded);
    const phase = String(progress.phase || '取得中');
    if (fetched > 0 || (Number.isFinite(saved) && saved > 0)) {
      const savedText = Number.isFinite(saved) ? `${saved}件保存済み` : `${fetched}件取得済み`;
      const fetchedText = Number.isFinite(saved) && fetched !== saved ? `（${fetched}件取得）` : '';
      return `${phase}… ${savedText}${fetchedText}`;
    }
    return progress.message || formatJobProgress(progress, { unit: '件取得済み', defaultPhase: '取得中' });
  }

  function partialResultText(detail) {
    const partial = detail?.partial_result;
    if (!partial || typeof partial !== 'object') return '';
    const created = Number(partial.created) || 0;
    const updated = Number(partial.updated) || 0;
    const fetched = Number(partial.fetched) || 0;
    const saved = Number(partial.saved) || created + updated;
    if (saved <= 0 && fetched <= 0) return '';
    return ` この実行では${fetched}件を取得し、${saved}件を保存済みです（新規${created}件、更新${updated}件）。`;
  }

  async function runAccountPostsJob(username, resumeJobId) {
    setBusy(true);
    setStatus(
      resumeJobId
        ? `@${username} の保存状況を再確認しています。`
        : `@${username} のポストを取得しています。件数が多い場合は1時間以上かかることがあります。`,
      false
    );
    let activeJobId = String(resumeJobId || '');
    try {
      const data = await runBackgroundJob(
        '/x-bookmarks/account-posts/sync',
        { username },
        {
          resumeJobId: activeJobId || undefined,
          // 3,200件と画像を保存すると1時間を超えるため、時間だけを理由に失敗扱いにしない。
          maxPolls: Number.POSITIVE_INFINITY,
          onStarted: (jobId) => {
            activeJobId = String(jobId || '');
            rememberActiveJob(activeJobId, username);
          },
          onProgress: (progress) => {
            setStatus(jobProgressText(progress), false);
          },
          onLongRunning: () => {
            setStatus(`@${username} の保存を続けています。設定画面を閉じても処理は継続します。`, false);
          },
        }
      );
      forgetActiveJob(activeJobId);
      const successMessage = resultSummary(data);
      setStatus(successMessage, false);
      if (typeof loadOutliner === 'function') {
        try {
          await loadOutliner();
        } catch (refreshError) {
          console.warn('Xアカウント保存後のフォルダ一覧更新に失敗しました', refreshError);
          setStatus(successMessage + ' フォルダ一覧を更新できなかったため、画面を再読み込みしてください。', true);
        }
      }
    } catch (error) {
      const detail = error?.errorDetail || error?.payload?.detail;
      const terminalStatus = String(error?.jobStatus?.status || '').toLowerCase();
      const resumedJobMissing = !!resumeJobId
        && /見つかりません|404/.test(String(error?.userMessage || error?.message || error));
      // 完了・失敗・中止が確定した時だけ追跡情報を消す。
      // 一時的な通信失敗ではサーバ側の保存が続いている可能性があるため、再表示時に追跡を再開する。
      if (['error', 'cancelled', 'canceled'].includes(terminalStatus) || resumedJobMissing) {
        forgetActiveJob(activeJobId);
      }
      if (detail && typeof detail === 'object' && (detail.message || detail.partial_result)) {
        const saved = partialResultText(detail);
        const retry = detail.retry_at ? ` 再実行目安: ${retryAtText(detail.retry_at)}` : '';
        setStatus(`${detail.message || 'X APIの取得上限に達しました'}${saved}${retry}`, true);
        if (detail.reason_code === 'x_authentication_required') {
          connected = false;
          await loadConnectionStatus();
        }
      } else if (resumedJobMissing) {
        setStatus('前回の処理状況を取得できませんでした。Meldexの再起動前に保存されたポストはフォルダに残っています。', true);
      } else {
        const suffix = activeJobId
          ? ' 設定画面を開き直すと保存状況の確認を再開します。'
          : '';
        setStatus('保存状況を確認できませんでした: ' + (error?.userMessage || error?.message || error) + suffix, true);
      }
    } finally {
      setBusy(false);
    }
  }

  async function confirmAccountPostsCost(username) {
    const message = `@${username} のポストを最大3,200件まで保存します。\nX APIの従量課金が発生します。料金と残高はX Developer Consoleで確認してください。\n\n続けますか？`;
    if (typeof cfConfirm === 'function') {
      return !!await cfConfirm(message, { okLabel: '保存を開始', cancelLabel: 'キャンセル' });
    }
    return window.confirm(message);
  }

  async function syncAccountPosts() {
    if (syncInFlight || typeof apiPost !== 'function' || typeof runBackgroundJob !== 'function') return;
    const raw = document.getElementById('x-account-posts-username')?.value || '';
    const username = normalizeUsername(raw);
    if (!username) {
      setStatus('Xのユーザー名（@なし）またはプロフィールURLを入力してください。', true);
      document.getElementById('x-account-posts-username')?.focus();
      return;
    }
    if (!await confirmAccountPostsCost(username)) return;
    await runAccountPostsJob(username, '');
  }

  async function resumeActiveJob() {
    const active = readActiveJob();
    if (!active || syncInFlight || typeof runBackgroundJob !== 'function') return;
    const input = document.getElementById('x-account-posts-username');
    if (input && !input.value) {
      input.value = `@${active.username}`;
      updateSavePreview();
    }
    await runAccountPostsJob(active.username, active.jobId);
  }

  function renderXAccountPostsSettings(scope) {
    const container = (scope || document).querySelector?.('#' + ROOT_ID) || document.getElementById(ROOT_ID);
    if (!container) return;
    if (container.dataset.rendered === '1') {
      loadConnectionStatus();
      resumeActiveJob();
      return;
    }
    container.dataset.rendered = '1';
    container.innerHTML = `
      <div class="gb-section-desc">指定した閲覧可能なアカウントのポストを、返信・リポストを含めて画像つきのシートへ保存します。 ${fieldHelp('取得できるのは最新3,200件までです。X APIの従量課金対象で、料金は変更されることがあります。X Developer Consoleで残高と料金を確認してください。', { e2eId: 'x-account-posts-cost-help' })}</div>
      <div class="gb-section-desc">最大3,200件・X APIの従量課金対象です。</div>
      <div id="x-account-posts-connection" class="gb-section-desc">X接続状態を確認中...</div>
      <label class="gb-field">
        <span class="gb-label">保存するXアカウント</span>
        <input id="x-account-posts-username" class="gb-input" type="text" autocomplete="off" placeholder="例: XDevelopers または https://x.com/XDevelopers" data-e2e-id="x-account-posts-username">
      </label>
      <div id="x-account-posts-save-preview" class="gb-section-desc">保存先: ユーザー名を入力すると表示されます</div>
      <div class="gb-field-row" style="justify-content:flex-start;flex-wrap:wrap;margin-top:8px;">
        <button type="button" id="x-account-posts-sync" class="gb-btn gb-btn-sm" data-e2e-id="x-account-posts-sync" disabled>${icon('archive', 14)} 取得できる全ポストを保存</button>
      </div>
      <div id="x-account-posts-status" class="gb-section-desc" role="status" aria-live="polite"></div>
    `;
    const input = container.querySelector('#x-account-posts-username');
    input?.addEventListener('input', updateSavePreview);
    input?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') syncAccountPosts();
    });
    container.querySelector('#x-account-posts-sync')?.addEventListener('click', syncAccountPosts);
    loadConnectionStatus();
    resumeActiveJob();
  }

  window.renderXAccountPostsSettings = renderXAccountPostsSettings;
})();
