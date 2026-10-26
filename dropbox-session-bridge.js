(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const broker = window.MeldexDropboxSessionBroker;
  async function localTransfer() {
    const handoff = window.MeldexDropboxHomeHandoff;
    const exported = await handoff.prepareExport(handoff.requestFromUrl());
    $('session-bridge-account').textContent = '接続先: ' + exported.accountId;
    $('session-bridge-code').textContent = exported.userCode;
    $('session-bridge-confirm').hidden = false;
    $('session-bridge-status').textContent = 'ホーム画面のMeldexにも同じ番号が表示されていることを確認してください。';
    const button = $('session-bridge-approve');
    button.disabled = false;
    button.onclick = event => {
      if (!event.isTrusted || window.top !== window.self) return;
      if (Date.now() >= exported.expiresAt) {
        button.disabled = true;
        $('session-bridge-status').textContent = '有効時間が過ぎました。ホーム画面のMeldexからもう一度開いてください。';
        return;
      }
      if (!navigator.clipboard?.writeText) {
        $('session-bridge-status').textContent = 'このChromeでは引継ぎ情報を渡せません。Chromeを更新してお試しください。';
        return;
      }
      // Only ciphertext is copied. No credential is placed in a URL or Cookie.
      navigator.clipboard.writeText(exported.text).then(() => {
        button.disabled = true;
        $('session-bridge-status').textContent = '準備できました。ホーム画面のMeldexへ戻り、「引継ぎを完了」を押してください。';
      }).catch(() => {
        $('session-bridge-status').textContent = '引継ぎ情報を渡せませんでした。この画面で、もう一度ボタンを押してください。';
      });
    };
  }
  async function start() {
    $('session-bridge-retry').hidden = true;
    $('session-bridge-confirm').hidden = true;
    if (window.top !== window.self) {
      $('session-bridge-status').textContent = '接続済みChromeの通常の画面で、引継ぎページを開いてください。';
      return;
    }
    if (new URLSearchParams(location.hash.slice(1)).has('handoff') && window.MeldexDropboxHomeHandoff?.isEnabled?.()) {
      try { await localTransfer(); }
      catch (error) {
        $('session-bridge-status').textContent = error.code === 'handoff_source_disconnected'
          ? 'Meldexに接続済みのChromeで、このページを開いてください。元の接続と下書きは保持しています。'
          : '引継ぎ情報を確認できませんでした。ホーム画面のMeldexから、もう一度開いてください。';
        $('session-bridge-retry').hidden = false;
      }
      return;
    }
    if (!broker?.isEnabled()) {
      $('session-bridge-status').textContent = 'この配信先では、接続を引き継ぐ準備がまだ完了していません。';
      return;
    }
    try {
      const id = new URLSearchParams(location.hash.slice(1)).get('request');
      if (!id || !/^[A-Za-z0-9_-]{20,64}$/.test(id)) throw new Error('invalid_request');
      const session = await window.MeldexDropboxAuth.getSession();
      if (!window.MeldexDropboxAuth.hasConnection(session)) {
        $('session-bridge-status').textContent = 'Meldexに接続済みのChromeで、このページを開いてください。';
        return;
      }
      const detail = await broker.inspectHandoff(id);
      let user = session.account?.name?.display_name;
      if (!user) {
        try { const info = await window.MeldexDropboxAuth.getCurrentAccount(false); user = info?.name?.display_name || info?.email; } catch {}
      }
      $('session-bridge-account').textContent = user ? '接続先: ' + user : '接続先: ' + detail.accountId;
      $('session-bridge-code').textContent = detail.userCode;
      $('session-bridge-confirm').hidden = false;
      $('session-bridge-status').textContent = '番号と移行先を確認すると、接続を引き継げます。';
      const button = $('session-bridge-approve');
      button.disabled = false;
      button.onclick = async event => {
        if (!event.isTrusted) return;
        if (window.top !== window.self) return;
        button.disabled = true;
        try {
          await broker.approveHandoff(id, detail.userCode);
          $('session-bridge-status').textContent = '接続を引き継ぎました。ホーム画面のMeldexへ戻ってください。';
        } catch {
          button.disabled = false;
          $('session-bridge-status').textContent = '引継ぎを完了できませんでした。通信状態と有効時間を確認してください。';
        }
      };
    } catch {
      $('session-bridge-status').textContent = '接続情報を確認できませんでした。元の画面の入力や下書きは保持されています。';
      $('session-bridge-retry').hidden = false;
    }
  }
  $('session-bridge-retry').addEventListener('click', start);
  start();
})();
