/* viewer-media-seek.js — 下端ツールバーのシークバーを、動画・音声の再生位置に使う。

   これまでシークバー（#seek-bar）はフォルダ内の画像の位置（0〜枚数-1）専用だった。
   動画を開いた時もそのまま表示されるため、ドラッグしても再生位置が動かず「操作できない」
   状態になっていた（単独ビューワーで動画を1本だけ開くと最大値0で、何も起きない）。
   動画・音声を表示している間だけシークバーと件数表示を再生位置・再生時間へ切り替える。

   ネイティブの <video controls> のシークバーは画面下端に出るため、下端ツールバーと
   重なって掴みにくい。こちらは常に下端ツールバー上にあり、どの表示倍率でも同じ位置になる。

   公開: window.MeldexViewerMediaSeek */
(function () {
  'use strict';

  const MEDIA_EVENTS = [
    'loadedmetadata', 'durationchange', 'timeupdate', 'seeked', 'play', 'pause', 'ended', 'emptied',
  ];

  let dragging = false;

  function seekBar() { return document.getElementById('seek-bar'); }
  function counter() { return document.getElementById('counter'); }
  function activeMedia() { return document.querySelector('.layer.show video, .layer.show audio'); }

  // 長さが確定していない（ストリーミング等でInfinity/NaN）場合は再生位置モードにしない。
  function usableDuration(media) {
    const duration = Number(media?.duration);
    return Number.isFinite(duration) && duration > 0 ? duration : 0;
  }

  function formatTime(seconds) {
    const total = Math.max(0, Math.floor(Number(seconds) || 0));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const rest = total % 60;
    const pad = value => String(value).padStart(2, '0');
    return hours > 0 ? `${hours}:${pad(minutes)}:${pad(rest)}` : `${minutes}:${pad(rest)}`;
  }

  // 動画・音声を表示中ならシークバー・件数表示を再生位置へ切り替えて true を返す。
  // 画像・PDFでは何もせず false を返し、viewer-scene.js 側の枚数表示に任せる。
  function syncControls() {
    const bar = seekBar();
    if (!bar) return false;
    const media = activeMedia();
    const duration = usableDuration(media);
    if (!duration) {
      delete bar.dataset.seekMode;
      return false;
    }
    bar.dataset.seekMode = 'media';
    bar.min = '0';
    bar.max = String(duration);
    bar.step = '0.05';
    if (!dragging) bar.value = String(Math.min(duration, Math.max(0, media.currentTime || 0)));
    const label = counter();
    if (label) label.textContent = `${formatTime(bar.value)} / ${formatTime(duration)}`;
    return true;
  }

  function isMediaMode() {
    return seekBar()?.dataset.seekMode === 'media';
  }

  // シークバーの input から呼ぶ。再生位置を動かせた時だけ true を返す。
  function seekTo(value) {
    const media = activeMedia();
    const duration = usableDuration(media);
    if (!duration) return false;
    const next = Math.min(duration, Math.max(0, Number(value) || 0));
    if (Number.isFinite(next)) media.currentTime = next;
    syncControls();
    return true;
  }

  // buildVideoElement / buildAudioElement から呼ぶ。
  function attach(media) {
    if (!media || media._viewerMediaSeekAttached) return media;
    media._viewerMediaSeekAttached = true;
    const update = () => { if (media.closest('.layer.show')) syncControls(); };
    MEDIA_EVENTS.forEach(name => media.addEventListener(name, update));
    return media;
  }

  // ドラッグ中は再生の timeupdate でつまみを戻さない。
  function installDragGuard() {
    const bar = seekBar();
    if (!bar) return;
    bar.addEventListener('pointerdown', () => { dragging = true; });
    document.addEventListener('pointerup', () => { dragging = false; });
    document.addEventListener('pointercancel', () => { dragging = false; });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', installDragGuard, { once: true });
  } else {
    installDragGuard();
  }

  window.MeldexViewerMediaSeek = { attach, syncControls, isMediaMode, seekTo, formatTime };
})();
