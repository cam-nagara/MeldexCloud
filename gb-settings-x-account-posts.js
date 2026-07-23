/* X account post import settings */
(function () {
  'use strict';

  const ROOT_ID = 'x-account-posts-settings-container';
  const USERNAME_RE = /^[A-Za-z0-9_]{1,15}$/;
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

  async function syncAccountPosts() {
    if (syncInFlight || typeof apiPost !== 'function' || typeof runBackgroundJob !== 'function') return;
    const raw = document.getElementById('x-account-posts-username')?.value || '';
    const username = normalizeUsername(raw);
    if (!username) {
      setStatus('Xのユーザー名（@なし）またはプロフィールURLを入力してください。', true);
      document.getElementById('x-account-posts-username')?.focus();
      return;
    }
    setBusy(true);
    setStatus(`@${username} のポストを取得しています。件数が多い場合は時間がかかります。`, false);
    try {
      const data = await runBackgroundJob(
        '/x-bookmarks/account-posts/sync',
        { username },
        {
          onProgress: (progress) => {
            setStatus(formatJobProgress(progress, { unit: '件保存済み', defaultPhase: '取得中' }), false);
          },
        }
      );
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
      if (detail && typeof detail === 'object' && (detail.message || detail.partial_result)) {
        const partial = detail.partial_result;
        const saved = partial?.fetched
          ? ` この実行では${partial.fetched}件を取得し、新規${partial.created || 0}件、更新${partial.updated || 0}件を保存済みです。`
          : '';
        const retry = detail.retry_at ? ` 再実行目安: ${retryAtText(detail.retry_at)}` : '';
        setStatus(`${detail.message || 'X APIの取得上限に達しました'}${saved}${retry}`, true);
      } else {
        setStatus('保存できませんでした: ' + (error?.userMessage || error?.message || error), true);
      }
    } finally {
      setBusy(false);
    }
  }

  function renderXAccountPostsSettings(scope) {
    const container = (scope || document).querySelector?.('#' + ROOT_ID) || document.getElementById(ROOT_ID);
    if (!container) return;
    if (container.dataset.rendered === '1') {
      loadConnectionStatus();
      return;
    }
    container.dataset.rendered = '1';
    container.innerHTML = `
      <div class="gb-section-desc">指定した閲覧可能なアカウントのポストを、返信・リポストを含めて画像つきのシートへ保存します。 ${fieldHelp('取得できるのは最新3,200件までです。')}</div>
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
  }

  window.renderXAccountPostsSettings = renderXAccountPostsSettings;
})();
