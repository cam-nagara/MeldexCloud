/* viewer-audio.js — Meldexビューワー: 音声ファイル表示の責務分離モジュール。
   計画: app/docs/board-link-card-subpanel-and-card-tail-plan-2026-08-13.md「音声の扱い」節
   （2026-08-19 AGENT_INBOX「サブパネル用の音声再生が無い」の完了条件）。
   分割元: viewer-video.js（動画対応と同じ責務分離パターンを踏襲）。
   方針:
     - <audio controls>要素の生成・再生/一時停止イベントとツールバー再生ボタンの同期・
       スライドショー再生中の自動送りだけを担当する（viewer-video.js の buildVideoElement と
       同型）。音声には寸法が無いため viewer-scene.js の applyImageFitStyle() は使わない。
       表示はアイコン+ファイル名+ネイティブ<audio controls>の固定サイズカード
       （.viewer-audio-player、viewer.css）で行う。
     - 先読みはしない（preload="metadata"のみ、動画と同じ理由）。
     - 注釈オーバーレイは viewer-annotation-scene.js が `layer.querySelectorAll('img, canvas')`
       で対象を探すため、audio要素（を包むカードdiv）は動画と同じく自動的に対象外になる。
   公開: window.MeldexViewerAudio */
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

  function isAudioInActiveLayer(audio) {
    return !!audio.closest('.layer.show');
  }

  function onAudioPlay(ev) {
    if (!isAudioInActiveLayer(ev.currentTarget)) return;
    updatePlayButtonIcon(true);
  }

  function onAudioPause(ev) {
    const audio = ev.currentTarget;
    if (audio.ended) return; // ended側で処理する（一瞬pauseも発火するため二重更新を避ける）
    if (!isAudioInActiveLayer(audio)) return;
    updatePlayButtonIcon(false);
  }

  // スライドショー再生中に音声が終了したら次へ送る。手動一時停止中は送らない（動画と同じ）。
  function onAudioEnded(ev) {
    updatePlayButtonIcon(false);
    const audio = ev.currentTarget;
    if (!isAudioInActiveLayer(audio)) return;
    const scene = Scene();
    if (scene?.isPlaying?.()) {
      scene.nextGroup();
      scene.rescheduleSlideshow?.();
    }
  }

  function _reportPlaybackError(error) {
    if (!error || error.name === 'NotAllowedError' || error.name === 'AbortError') return;
    console.warn('音声の再生に失敗しました', error);
  }

  // itemはviewer-scene.jsのitems[]要素（type:'audio'）。srcは表示用に解決済みのURL
  // （呼び出し側でensureItemUrl/displayItemUrl相当の解決を済ませてから渡すこと）。
  // 戻り値は<audio>そのものではなく、アイコン+ファイル名+<audio controls>をまとめた
  // カードdiv（.viewer-audio-player）。layerへはこのカードを追加する。
  function buildAudioElement(item, src, opts = {}) {
    const wrap = document.createElement('div');
    wrap.className = 'viewer-audio-player' + (opts.className ? ' ' + opts.className : '');
    wrap.dataset.testid = 'viewer-audio-player';
    wrap.dataset.e2eId = 'viewer-audio-player';

    const icon = document.createElement('div');
    icon.className = 'viewer-audio-icon';
    icon.setAttribute('aria-hidden', 'true');
    const scene = Scene();
    icon.innerHTML = scene ? scene.icon('music', 40) : '';

    const filename = document.createElement('div');
    filename.className = 'viewer-audio-filename';
    filename.textContent = item?.name || '';

    const audio = document.createElement('audio');
    audio.className = 'viewer-audio-media';
    audio.dataset.e2eId = 'viewer-audio-media';
    audio.controls = true;
    audio.preload = 'metadata'; // 先読みはしない（動画と同じ方針）
    audio.src = src || '';
    audio._viewerItem = item;
    audio.addEventListener('play', onAudioPlay);
    audio.addEventListener('pause', onAudioPause);
    audio.addEventListener('ended', onAudioEnded);

    wrap.append(icon, filename, audio);
    return wrap;
  }

  // メタデータ取得完了を待つ。showGroup()のレイヤー入替タイミング制御に使う（動画と同じ設計）。
  // タイムアウト時はfalseではなくtrueで解決する（読み込みが遅くてもネイティブコントロールで
  // 再生できるため、画像のプレビューURLフォールバックのようなブロッキングは不要）。
  function waitForAudioReady(audio, timeoutMs = 3000) {
    return new Promise(resolve => {
      if (!audio) { resolve(false); return; }
      if (audio.readyState >= 1) { resolve(true); return; } // HAVE_METADATA以上
      let done = false;
      let timer = 0;
      const finish = (ok) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        audio.removeEventListener('loadedmetadata', onReady);
        audio.removeEventListener('error', onError);
        resolve(!!ok);
      };
      const onReady = () => finish(true);
      const onError = () => finish(false);
      timer = setTimeout(() => finish(true), timeoutMs);
      audio.addEventListener('loadedmetadata', onReady, { once: true });
      audio.addEventListener('error', onError, { once: true });
    });
  }

  function getCurrentAudioElement() {
    return document.querySelector('.layer.show audio');
  }

  function startActiveAudioPlayback() {
    const audio = getCurrentAudioElement();
    if (!audio || typeof audio.play !== 'function') return false;
    try {
      const result = audio.play();
      if (result && typeof result.catch === 'function') {
        result.catch(_reportPlaybackError);
      }
      return true;
    } catch (error) {
      _reportPlaybackError(error);
      return false;
    }
  }

  // 現在表示中レイヤーの音声を再生/一時停止する。音声が無ければfalseを返す
  // （呼び出し側=viewer-scene.jsのtogglePlay()はfalseならスライドショーの再生/一時停止へ
  // フォールバックする。動画と同じ契約）。
  function toggleCurrentAudioPlayback() {
    const audio = getCurrentAudioElement();
    if (!audio) return false;
    if (audio.paused || audio.ended) audio.play().catch(_reportPlaybackError);
    else audio.pause();
    return true;
  }

  window.MeldexViewerAudio = {
    buildAudioElement,
    waitForAudioReady,
    getCurrentAudioElement,
    startActiveAudioPlayback,
    toggleCurrentAudioPlayback,
  };
})();
