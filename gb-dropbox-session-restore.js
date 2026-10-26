/* Shared blocking restoration UI. Never opens Dropbox authorization. */
(function () {
  'use strict';
  let waiting = null;
  function element(tag, text, className) {
    const node = document.createElement(tag);
    if (text) node.textContent = text;
    if (className) node.className = className;
    return node;
  }
  function message(error) {
    if (error?.code === 'handoff_clipboard_denied') return 'iPhoneの貼り付け許可が表示されたら許可してください。Chromeで引き継いだ後、「引継ぎを完了」を押せます。';
    if (String(error?.code || '').startsWith('handoff_') && error?.status !== 410) return '引継ぎ情報を確認できませんでした。元の接続と下書きは保持しています。接続済みChromeで同じ番号を確認し、もう一度引き継いでください。';
    if (error?.code === 'settings_changed') return '保存先の設定が別の画面で変更されています。この端末の設定は保持しています。';
    if (error?.code === 'account_change_rejected') return '接続先のアカウントが一致しません。元の接続情報は保持しています。';
    if (error?.status === 410) return '引継ぎの有効時間が過ぎました。もう一度、接続済みChromeから引き継げます。';
    return '接続の復元を待っています。通信状態を確認して、もう一度お試しください。入力や下書きは保持しています。';
  }
  async function wait(options) {
    if (waiting) return waiting;
    waiting = new Promise(resolve => {
      const broker = options?.transport || window.MeldexDropboxSessionBroker;
      const body = element('div', '', 'gb-session-restore-body');
      const status = element('p', 'Dropbox接続を復元しています。');
      status.setAttribute('role', 'status');
      status.setAttribute('aria-live', 'polite');
      const instructions = element('p', '接続済みChromeで、下の番号と移行先を確認してください。');
      const code = element('p', '', 'gb-session-restore-code');
      const link = element('a', 'Chromeの接続を引き継ぐ', 'gb-btn gb-btn-primary gb-session-restore-button');
      link.rel = 'noreferrer';
      const retry = element('button', 'もう一度確認', 'gb-btn gb-session-restore-button');
      retry.type = 'button';
      const finish = element('button', '引継ぎを完了', 'gb-btn gb-btn-primary gb-session-restore-button');
      finish.type = 'button';
      finish.hidden = true;
      const local = element('button', 'この端末内で使う', 'gb-btn gb-session-restore-button');
      local.type = 'button';
      local.hidden = !options?.allowLocal;
      link.hidden = code.hidden = instructions.hidden = retry.hidden = true;
      body.append(status, instructions, code, link, finish, retry, local);
      let modal, nativeDialog, timer = 0, busy = false;
      function close(result) {
        clearTimeout(timer);
        document.removeEventListener('visibilitychange', onVisible);
        window.removeEventListener('online', refresh);
        if (modal) { closing = true; modal.close('restored'); }
        if (nativeDialog) { nativeDialog.close(); nativeDialog.remove(); }
        waiting = null;
        resolve(result);
      }
      let closing = false;
      if (window.GBUI?.createModal) {
        modal = window.GBUI.createModal({
          id: 'dropbox-session-restore', title: 'Dropbox接続を復元', body,
          variant: 'standard', extraClass: 'gb-session-restore-modal',
          initialFocus: 'button', onBeforeClose: () => closing,
        });
        const closeButton = modal.header?.querySelector('.gb-modal-close');
        if (closeButton) closeButton.hidden = true;
        modal.overlay.dataset.e2eId = 'dropbox-session-restore';
        modal.open();
      } else {
        nativeDialog = element('dialog', '', 'gb-session-restore-native');
        const title = element('h2', 'Dropbox接続を復元');
        title.id = 'dropbox-session-restore-title';
        nativeDialog.setAttribute('aria-labelledby', title.id);
        nativeDialog.dataset.e2eId = 'dropbox-session-restore';
        nativeDialog.append(title, body);
        nativeDialog.addEventListener('cancel', event => event.preventDefault());
        document.body.appendChild(nativeDialog);
        nativeDialog.showModal();
      }
      options?.onOpen?.();
      function failed(error) {
        status.textContent = message(error);
        retry.hidden = false;
        if (error?.status === 410) {
          broker.resetHandoff();
          code.hidden = link.hidden = instructions.hidden = true;
          finish.hidden = true;
        }
        retry.focus();
      }
      function schedule() {
        if (broker.manualCompletion) return;
        clearTimeout(timer);
        if (document.visibilityState !== 'hidden') timer = setTimeout(poll, 2000);
      }
      async function poll() {
        if (busy) return;
        busy = true;
        try {
          if (await broker.redeemHandoff()) { close(); return; }
          schedule();
        } catch (error) { failed(error); }
        finally { busy = false; }
      }
      async function refresh() {
        if (busy) return;
        busy = true;
        retry.hidden = true;
        try {
          const session = await (options?.requireValidSession
            ? window.MeldexDropboxAuth.getValidSession() : window.MeldexDropboxAuth.getSession());
          if (window.MeldexDropboxAuth.hasConnection(session)) { close(); return; }
          const pending = await broker.createHandoff();
          const url = new URL(pending.bridgeUrl);
          link.href = 'googlechromes://' + url.host + url.pathname + url.search + url.hash;
          code.textContent = pending.userCode;
          link.hidden = code.hidden = instructions.hidden = false;
          status.textContent = '接続済みChromeから、このMeldexへ接続を引き継げます。';
          if (broker.manualCompletion) {
            finish.hidden = false;
            instructions.textContent = 'Chromeで同じ番号を確認して引き継いだ後、この画面へ戻り「引継ぎを完了」を押してください。貼り付けの許可が表示されたら許可してください。';
          }
          link.focus();
          schedule();
        } catch (error) { failed(error); }
        finally { busy = false; }
      }
      function onVisible() {
        if (broker.manualCompletion) return;
        if (document.visibilityState === 'visible') { clearTimeout(timer); if (link.hidden) refresh(); else poll(); }
        else clearTimeout(timer);
      }
      retry.addEventListener('click', refresh);
      finish.addEventListener('click', event => {
        if (!event.isTrusted || busy) return;
        busy = true;
        // Clipboard access begins before any await, preserving iOS user activation.
        broker.redeemHandoff().then(done => { if (done) close(); }).catch(failed).finally(() => { busy = false; });
      });
      local.addEventListener('click', event => { if (event.isTrusted && !busy) close({ local: true }); });
      document.addEventListener('visibilitychange', onVisible);
      window.addEventListener('online', refresh);
      if (options?.initialError) failed(options.initialError);
      else refresh();
    });
    return waiting;
  }
  window.MeldexDropboxSessionRestore = { wait };
})();
