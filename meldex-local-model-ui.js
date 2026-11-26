/* Shared opt-in model fetch/remove confirmation for local viewer engines. */
(function () {
  'use strict';
  function confirm(message, title = 'モデルの確認', actionLabel = '決定') {
    return new Promise(resolve => {
      const body = document.createElement('p'); body.textContent = message; body.style.whiteSpace = 'pre-line';
      const cancel = document.createElement('button'); cancel.className = 'gb-btn'; cancel.textContent = 'キャンセル';
      const ok = document.createElement('button'); ok.className = 'gb-btn gb-btn-primary'; ok.textContent = actionLabel;
      let accepted = false;
      const modal = window.GBUI.createModal({ title, body: [body], footer: [cancel, ok], initialFocus: () => cancel,
        closeOnEsc: true, closeOnOverlay: true, onClose: () => resolve(accepted) });
      cancel.addEventListener('click', () => modal.close('cancel'));
      ok.addEventListener('click', () => { accepted = true; modal.close('confirm'); });
      modal.open();
    });
  }
  window.MeldexLocalModelUI = {
    confirm,
    confirmInstall: ({ description, bytes, title = 'モデルの取得' }) => confirm(`${description}\nモデルを取得しますか？\n${bytes.toLocaleString('ja-JP')} バイト（${(bytes / 1048576).toFixed(1)} MiB）\n途中から再開できます。文書・画像は送信しません。`, title, 'ダウンロード'),
  };
})();
