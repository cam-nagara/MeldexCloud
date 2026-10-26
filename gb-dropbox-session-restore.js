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
    if (error?.code === 'settings_changed') return '保存先の設定が別の画面で変更されています。この端末の設定は保持しています。';
    if (error?.code === 'account_change_rejected') return '接続先のアカウントが一致しません。元の接続情報は保持しています。';
    if (error?.status === 410) return '引継ぎの有効時間が過ぎました。もう一度、接続済みChromeから引き継げます。';
    return '接続の復元を待っています。通信状態を確認して、もう一度お試しください。入力や下書きは保持しています。';
  }
  async function wait(options) {
    if (waiting) return waiting;
    waiting = new Promise(resolve => {
      const broker = window.MeldexDropboxSessionBroker;
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
      link.hidden = code.hidden = instructions.hidden = retry.hidden = true;
      body.append(status, instructions, code, link, retry);
      let modal, nativeDialog, timer = 0, busy = false;
      function close() {
        clearTimeout(timer);
        document.removeEventListener('visibilitychange', onVisible);
        window.removeEventListener('online', refresh);
        if (modal) { closing = true; modal.close('restored'); }
        if (nativeDialog) { nativeDialog.close(); nativeDialog.remove(); }
        waiting = null;
        resolve();
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
        }
        retry.focus();
      }
      function schedule() {
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
          const session = await window.MeldexDropboxAuth.getSession();
          if (window.MeldexDropboxAuth.hasConnection(session)) { close(); return; }
          const pending = await broker.createHandoff();
          const url = new URL(pending.bridgeUrl);
          link.href = 'googlechromes://' + url.host + url.pathname + url.search + url.hash;
          code.textContent = pending.userCode;
          link.hidden = code.hidden = instructions.hidden = false;
          status.textContent = '接続済みChromeから、このMeldexへ接続を引き継げます。';
          link.focus();
          schedule();
        } catch (error) { failed(error); }
        finally { busy = false; }
      }
      function onVisible() {
        if (document.visibilityState === 'visible') { clearTimeout(timer); if (link.hidden) refresh(); else poll(); }
        else clearTimeout(timer);
      }
      retry.addEventListener('click', refresh);
      document.addEventListener('visibilitychange', onVisible);
      window.addEventListener('online', refresh);
      if (options?.initialError) failed(options.initialError);
      else refresh();
    });
    return waiting;
  }
  window.MeldexDropboxSessionRestore = { wait };
})();
