/* viewer-open-request.js — Meldexビューワー: 親ウィンドウによるiframe再利用の受け口。
   計画: viewer-stability-common-ui-gap-fix-plan-2026-08-04.md「実装変更 > 7. iframe再利用の受信側」
   分割元: viewer-scene.js（1,000行以内に収めるための責務分割）。
   契約（親側と合意済み）:
     - 初期化完了時に親へ { type: 'viewer-ready' } を送る。
     - 親から { type: 'viewer-open-request', requestId, url } を受け取ったら、対応可能なら
       即座に { type: 'viewer-open-ack', requestId } を返してから（ページ遷移なしで）表示対象を
       差し替える。対応できないパラメータ（archive/native/markup等）の場合は
       { type: 'viewer-open-nack', requestId } を返し、親は従来どおりsrc差し替えにフォールバックする。
     - URL解析・対応可否判定の純粋ロジックは viewer-scene-utils.js（Utils.canReopenWithUrl）、
       実際の状態差し替えは viewer-scene.js（Scene.reopenWithUrl）が担当する。本ファイルは
       postMessageプロトコルの配線だけを担当する。
   公開: なし（副作用のみ。message リスナーと ready 通知の登録） */
(function () {
  'use strict';

  const Utils = window.MeldexViewerSceneUtils;

  function Scene() { return window.MeldexViewerScene; }

  function postToParent(message) {
    if (window.parent === window) return;
    try {
      parent.postMessage(message, Utils.parentMessageTargetOrigin());
    } catch {}
  }

  async function handleOpenRequest(data) {
    const requestId = data?.requestId;
    const url = data?.url;
    if (!Utils.canReopenWithUrl(url)) {
      postToParent({ type: 'viewer-open-nack', requestId });
      return;
    }
    postToParent({ type: 'viewer-open-ack', requestId });
    try {
      await Scene().reopenWithUrl(url);
    } catch {
      // 既にackを返しているため、親は「開き直し要求は受理された」前提で扱う。
      // 失敗時はビューワー側のHUD/読み込み失敗表示で状況を伝える（reopenWithUrl→
      // loadResolvedTarget内で処理済み）。ここでの追加通知はしない。
    }
  }

  window.addEventListener('message', event => {
    if (event.source !== window.parent) return;
    if (event.origin !== location.origin && event.origin !== 'null') return;
    if (event.data?.type === 'viewer-open-request') handleOpenRequest(event.data);
  });

  // 初期化（PDF読み込み・フォルダ一覧取得等）が完了してから親へ通知する。
  // init()は失敗時も早期returnで正常終了するため、readyは成功/失敗に関わらず解決する。
  Scene()?.ready?.then(() => postToParent({ type: 'viewer-ready' }));
})();
