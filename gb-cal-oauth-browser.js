/* ==============================
   gb-cal-oauth-browser.js: ブラウザ完結OAuth（PKCE）共通フロー

   Cloud外部カレンダー連携 Phase 5・案A（app/docs/production-management-ux-improvement-plan-2026-08-04.md §6.5）。
   Google Calendar / Microsoft Calendar の認可コード+PKCEフローを、サーバー無し
   （静的ホスティング）でブラウザだけで完結させるための共通土台。

   役割:
   - PKCE の code_verifier / code_challenge 生成（gb-dropbox-auth.js の
     _randomToken / _sha256Base64Url と同じ方式。Web Cryptoのみに依存し、
     フォールバック実装は持たない — gb-llm-keys-store.js と同じ方針）
   - ポップアップを開いて oauth-callback.html からの通知（postMessage /
     BroadcastChannel の両方）を待つ共通フロー
   - state の照合（CSRF対策。フラグメント/クエリどちら経由でもここで必ず検証する）
   - Google / Microsoft のトークンエンドポイントへの交換・更新リクエスト
     （呼び出し元 gb-cal-cloud-sync.js が実際のフィールドマッピング・保存を担当）

   このファイルは秘密情報をログ出力しない。トークンをURLへ載せない
   （認可コードはpostMessage/BroadcastChannel経由のみで受け渡す）。
   ============================== */
(function () {
  'use strict';

  const CALLBACK_CHANNEL_NAME = 'meldex-cal-oauth-callback-v1';
  const CALLBACK_MESSAGE_TYPE = 'meldex-cal-oauth-callback';
  const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
  const POPUP_POLL_MS = 500;

  function _webCrypto() {
    const api = globalThis.crypto;
    if (!api?.subtle || !api?.getRandomValues) throw new Error('このブラウザではWeb Cryptoを利用できないため、OAuth認証を実行できません');
    return api;
  }

  function _base64UrlBytes(bytes) {
    let raw = '';
    new Uint8Array(bytes || []).forEach((value) => { raw += String.fromCharCode(value); });
    const b64 = (typeof btoa === 'function' ? btoa(raw) : Buffer.from(raw, 'binary').toString('base64'));
    return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }

  function randomToken(byteLength) {
    const bytes = new Uint8Array(byteLength || 32);
    _webCrypto().getRandomValues(bytes);
    return _base64UrlBytes(bytes);
  }

  async function sha256Base64Url(text) {
    const data = new TextEncoder().encode(String(text || ''));
    const digest = await _webCrypto().subtle.digest('SHA-256', data);
    return _base64UrlBytes(new Uint8Array(digest));
  }

  // --- PKCE ------------------------------------------------------------

  async function generatePkce() {
    const verifier = randomToken(48);
    const challenge = await sha256Base64Url(verifier);
    return { verifier, challenge, method: 'S256' };
  }

  function generateState() {
    return randomToken(24);
  }

  function redirectUri() {
    // <現在のorigin>/oauth-callback.html。サブパス配信（例: /app/）でも
    // 相対解決できるよう現在のスクリプトの場所ではなく document.baseURI を基準にする。
    try {
      return new URL('oauth-callback.html', document.baseURI || window.location.href).href;
    } catch {
      return window.location.origin + '/oauth-callback.html';
    }
  }

  // --- ポップアップ + コールバック待受 -------------------------------------

  function openBlankPopup(label) {
    // ポップアップブロッカー回避のため、URLが決まる前（PKCE生成やAPI呼び出しの前）に
    // クリックハンドラから同期的に呼び出すことを想定した「空ポップアップを先に開く」関数。
    const popup = window.open('', 'meldex-cal-oauth', 'width=520,height=680,noopener=no,noreferrer=no');
    if (!popup) {
      throw new Error(`ポップアップがブロックされました。ブラウザの設定で${label || 'このサイト'}のポップアップを許可してください`);
    }
    try {
      popup.document.title = 'Meldex 認証';
      popup.document.body.innerHTML = '<p style="font-family:sans-serif;color:#888;text-align:center;margin-top:40vh;">読み込み中…</p>';
    } catch {}
    return popup;
  }

  function navigatePopup(popup, url) {
    if (!popup || popup.closed) throw new Error('認証用ウィンドウが閉じられました');
    popup.location.href = url;
  }

  function awaitCallback(popup, expectedState, options = {}) {
    const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : DEFAULT_TIMEOUT_MS;
    return new Promise((resolve, reject) => {
      let settled = false;
      let channel = null;
      let pollTimer = 0;
      let timeoutTimer = 0;

      const cleanup = () => {
        if (settled) return;
        settled = true;
        window.removeEventListener('message', onMessage);
        try { channel?.close(); } catch {}
        if (pollTimer) clearInterval(pollTimer);
        if (timeoutTimer) clearTimeout(timeoutTimer);
      };

      const finish = (err, payload) => {
        if (settled) return;
        cleanup();
        try { if (popup && !popup.closed) popup.close(); } catch {}
        if (err) reject(err);
        else resolve(payload);
      };

      const handlePayload = (payload) => {
        if (!payload || typeof payload !== 'object') return;
        if (payload.error) {
          finish(new Error(payload.errorDescription || payload.error_description || payload.error));
          return;
        }
        if (!payload.code) return;
        if (String(payload.state || '') !== String(expectedState || '')) {
          finish(new Error('認証の状態確認(state)が一致しませんでした。もう一度お試しください'));
          return;
        }
        finish(null, { code: payload.code, state: payload.state });
      };

      const onMessage = (event) => {
        if (event.origin !== window.location.origin) return;
        const data = event.data;
        if (!data || data.type !== CALLBACK_MESSAGE_TYPE) return;
        handlePayload(data.payload);
      };
      window.addEventListener('message', onMessage);

      try {
        if (typeof BroadcastChannel === 'function') {
          channel = new BroadcastChannel(CALLBACK_CHANNEL_NAME);
          channel.addEventListener('message', (event) => {
            const data = event?.data;
            if (!data || data.type !== CALLBACK_MESSAGE_TYPE) return;
            handlePayload(data.payload);
          });
        }
      } catch {
        channel = null;
      }

      // ユーザーがポップアップを閉じた場合の検知（コールバックが届かないまま放置しない）。
      pollTimer = setInterval(() => {
        if (popup && popup.closed) finish(new Error('認証がキャンセルされました（ウィンドウが閉じられました）'));
      }, POPUP_POLL_MS);

      timeoutTimer = setTimeout(() => {
        finish(new Error('認証の待機時間が切れました。もう一度お試しください'));
      }, timeoutMs);
    });
  }

  // --- Google ------------------------------------------------------------

  const GOOGLE_AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
  const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
  const GOOGLE_CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar';

  function buildGoogleAuthUrl({ clientId, redirectUri: uri, state, challenge, scope }) {
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: uri,
      response_type: 'code',
      scope: scope || GOOGLE_CALENDAR_SCOPE,
      access_type: 'offline',
      prompt: 'consent',
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
    });
    return GOOGLE_AUTH_ENDPOINT + '?' + params.toString();
  }

  async function _postForm(url, data) {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(data).toString(),
    });
    let payload = null;
    try { payload = await response.json(); } catch { payload = null; }
    if (!response.ok) {
      const message = payload?.error_description || payload?.error || `HTTP ${response.status}`;
      const error = new Error(message);
      error.status = response.status;
      error.code = payload?.error || '';
      throw error;
    }
    return payload || {};
  }

  async function exchangeGoogleToken({ code, verifier, clientId, clientSecret, redirectUri: uri }) {
    return _postForm(GOOGLE_TOKEN_ENDPOINT, {
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: uri,
      grant_type: 'authorization_code',
      code_verifier: verifier,
    });
  }

  async function refreshGoogleToken({ refreshToken, clientId, clientSecret }) {
    return _postForm(GOOGLE_TOKEN_ENDPOINT, {
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
    });
  }

  async function authorizeGoogle({ clientId, clientSecret, scope, popup, timeoutMs }) {
    if (!clientId || !clientSecret) throw new Error('Client IDとClient Secretを入力してください');
    const win = popup || openBlankPopup('Google');
    const { verifier, challenge } = await generatePkce();
    const state = generateState();
    const uri = redirectUri();
    const authUrl = buildGoogleAuthUrl({ clientId, redirectUri: uri, state, challenge, scope });
    navigatePopup(win, authUrl);
    const { code } = await awaitCallback(win, state, { timeoutMs });
    const token = await exchangeGoogleToken({ code, verifier, clientId, clientSecret, redirectUri: uri });
    return { token, clientId, clientSecret };
  }

  // --- Microsoft (SPA / PKCE。クライアントシークレット不要) ------------------

  function microsoftAuthEndpoint(tenant) {
    return `https://login.microsoftonline.com/${encodeURIComponent(tenant || 'common')}/oauth2/v2.0/authorize`;
  }

  function microsoftTokenEndpoint(tenant) {
    return `https://login.microsoftonline.com/${encodeURIComponent(tenant || 'common')}/oauth2/v2.0/token`;
  }

  const MICROSOFT_CALENDAR_SCOPE = 'offline_access User.Read Calendars.ReadWrite';

  function buildMicrosoftAuthUrl({ clientId, tenant, redirectUri: uri, state, challenge, scope }) {
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: uri,
      response_type: 'code',
      response_mode: 'query',
      scope: scope || MICROSOFT_CALENDAR_SCOPE,
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
    });
    return microsoftAuthEndpoint(tenant) + '?' + params.toString();
  }

  async function exchangeMicrosoftToken({ code, verifier, clientId, tenant, redirectUri: uri, scope }) {
    return _postForm(microsoftTokenEndpoint(tenant), {
      code,
      client_id: clientId,
      redirect_uri: uri,
      grant_type: 'authorization_code',
      code_verifier: verifier,
      scope: scope || MICROSOFT_CALENDAR_SCOPE,
    });
  }

  async function refreshMicrosoftToken({ refreshToken, clientId, tenant, scope }) {
    return _postForm(microsoftTokenEndpoint(tenant), {
      refresh_token: refreshToken,
      client_id: clientId,
      grant_type: 'refresh_token',
      scope: scope || MICROSOFT_CALENDAR_SCOPE,
    });
  }

  async function authorizeMicrosoft({ clientId, tenant, scope, popup, timeoutMs }) {
    if (!clientId) throw new Error('Application (client) IDを入力してください');
    const win = popup || openBlankPopup('Microsoft');
    const { verifier, challenge } = await generatePkce();
    const state = generateState();
    const uri = redirectUri();
    const authUrl = buildMicrosoftAuthUrl({ clientId, tenant, redirectUri: uri, state, challenge, scope });
    navigatePopup(win, authUrl);
    const { code } = await awaitCallback(win, state, { timeoutMs });
    const token = await exchangeMicrosoftToken({ code, verifier, clientId, tenant, redirectUri: uri, scope });
    return { token, clientId, tenant: tenant || 'common' };
  }

  window.MeldexCalOAuthBrowser = {
    CALLBACK_CHANNEL_NAME,
    CALLBACK_MESSAGE_TYPE,
    generatePkce,
    generateState,
    redirectUri,
    randomToken,
    sha256Base64Url,
    openBlankPopup,
    navigatePopup,
    awaitCallback,
    google: {
      SCOPE: GOOGLE_CALENDAR_SCOPE,
      buildAuthUrl: buildGoogleAuthUrl,
      exchangeToken: exchangeGoogleToken,
      refreshToken: refreshGoogleToken,
      authorize: authorizeGoogle,
    },
    microsoft: {
      SCOPE: MICROSOFT_CALENDAR_SCOPE,
      buildAuthUrl: buildMicrosoftAuthUrl,
      exchangeToken: exchangeMicrosoftToken,
      refreshToken: refreshMicrosoftToken,
      authorize: authorizeMicrosoft,
    },
  };
})();
