/* viewer-video.js — Meldexビューワー: 動画ファイル表示の責務分離モジュール。
   計画: viewer-stability-common-ui-gap-fix-plan-2026-08-04.md「実装変更 > 4. 動画ファイル対応」
   分割元: viewer-scene.js（1,000行以内に収めるための責務分割）。
   方針:
     - <video>要素の生成・再生/一時停止イベントとツールバー再生ボタンの同期・スライドショー再生中の
       自動送りだけを担当する。items[]の管理・フィット計算・ズーム/パン/回転はviewer-scene.js側が
       applyImageFitStyle()を通じて引き続き担当する（本ファイルはvideo要素を作って返すだけ）。
     - 先読みはしない（preload="metadata"のみ）。プレビューURLフォールバックの概念もない
       （動画はfile-rawをそのまま使い、Range対応のFileResponseでネイティブ<video>のシーク/
       ストリーミングに対応済み）。
     - 注釈オーバーレイはviewer-annotation-scene.jsが `layer.querySelectorAll('img, canvas')` で
       対象を探すため、video要素は自動的に対象外になる（無理に対応しない。エラーも出ない）。
   公開: window.MeldexViewerVideo */
(function () {
  'use strict';

  function Scene() { return window.MeldexViewerScene; }

  function updatePlayButtonIcon(playing) {
    const scene = Scene();
    const btn = document.getElementById('btn-play');
    if (!btn || !scene) return;
    btn.innerHTML = scene.icon(playing ? 'pause' : 'play');
    btn.setAttribute('aria-label', playing ? '一時停止' : '再生');
  }

  function isVideoInActiveLayer(video) {
    return !!video.closest('.layer.show');
  }

  function onVideoPlay(ev) {
    if (!isVideoInActiveLayer(ev.currentTarget)) return;
    updatePlayButtonIcon(true);
  }

  function onVideoPause(ev) {
    const video = ev.currentTarget;
    if (video.ended) return; // ended側で処理する（一瞬pauseも発火するため二重更新を避ける）
    if (!isVideoInActiveLayer(video)) return;
    updatePlayButtonIcon(false);
  }

  // スライドショー再生中に動画が終了したら次へ送る。手動一時停止中は送らない。
  function onVideoEnded(ev) {
    updatePlayButtonIcon(false);
    const video = ev.currentTarget;
    if (!isVideoInActiveLayer(video)) return;
    const scene = Scene();
    if (scene?.isPlaying?.()) {
      scene.nextGroup();
      scene.rescheduleSlideshow?.();
    }
  }

  function _reportPlaybackError(error) {
    if (!error || error.name === 'NotAllowedError' || error.name === 'AbortError') return;
    console.warn('動画の再生に失敗しました', error);
  }

  function wireVideoClickToggle(video) {
    if (!video) return video;
    video.addEventListener('click', (ev) => {
      if (!isVideoInActiveLayer(video)) return;
      if (video.paused || video.ended) {
        video.play().catch(_reportPlaybackError);
      } else {
        video.pause();
      }
    });
    return video;
  }

  // itemはviewer-scene.jsのitems[]要素（type:'video'）。srcは表示用に解決済みのURL
  // （呼び出し側でensureItemUrl/displayItemUrl相当の解決を済ませてから渡すこと）。
  function buildVideoElement(item, src, opts = {}) {
    const video = document.createElement('video');
    if (opts.className) video.className = opts.className;
    video.controls = true;
    video.playsInline = true;
    video.preload = 'metadata'; // 先読みはしない（動画は容量が大きいため）
    video.src = src || '';
    video._viewerItem = item;
    video.addEventListener('play', onVideoPlay);
    video.addEventListener('pause', onVideoPause);
    video.addEventListener('ended', onVideoEnded);
    wireVideoClickToggle(video);
    return video;
  }

  // メタデータ取得完了（寸法確定）を待つ。showGroup()のレイヤー入替タイミング制御に使う。
  // タイムアウト時は false ではなく true で解決する（読み込みが遅くてもネイティブコントロールで
  // 再生できるため、画像のプレビューURLフォールバックのようなブロッキングは不要）。
  function waitForVideoReady(video, timeoutMs = 3000) {
    return new Promise(resolve => {
      if (!video) { resolve(false); return; }
      if (video.readyState >= 1) { resolve(true); return; } // HAVE_METADATA以上
      let done = false;
      let timer = 0;
      const finish = (ok) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        video.removeEventListener('loadedmetadata', onReady);
        video.removeEventListener('error', onError);
        resolve(!!ok);
      };
      const onReady = () => finish(true);
      const onError = () => finish(false);
      timer = setTimeout(() => finish(true), timeoutMs);
      video.addEventListener('loadedmetadata', onReady, { once: true });
      video.addEventListener('error', onError, { once: true });
    });
  }

  function getCurrentVideoElement() {
    return document.querySelector('.layer.show video');
  }

  function startActiveVideoPlayback() {
    const video = getCurrentVideoElement();
    if (!video || typeof video.play !== 'function') return false;
    try {
      const result = video.play();
      if (result && typeof result.catch === 'function') {
        result.catch(_reportPlaybackError);
      }
      return true;
    } catch (error) {
      _reportPlaybackError(error);
      return false;
    }
  }

  // 現在表示中レイヤーの動画を再生/一時停止する。動画が無ければ false を返す
  // （呼び出し側=viewer-scene.jsのtogglePlay()はfalseならスライドショーの再生/一時停止へフォールバックする）。
  function toggleCurrentVideoPlayback() {
    const video = getCurrentVideoElement();
    if (!video) return false;
    if (video.paused || video.ended) video.play().catch(_reportPlaybackError);
    else video.pause();
    return true;
  }

  window.MeldexViewerVideo = {
    buildVideoElement,
    waitForVideoReady,
    getCurrentVideoElement,
    startActiveVideoPlayback,
    toggleCurrentVideoPlayback,
    wireVideoClickToggle,
  };
})();
