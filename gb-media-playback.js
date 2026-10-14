(function (global) {
  'use strict';

  function _reportUnexpectedPlaybackError(error) {
    if (!error || error.name === 'NotAllowedError' || error.name === 'AbortError') return;
    console.warn('動画の自動再生に失敗しました', error);
  }

  function prepare(video) {
    if (!video) return video;
    video.autoplay = true;
    video.playsInline = true;
    video.setAttribute('autoplay', '');
    video.setAttribute('playsinline', '');
    return video;
  }

  function start(video) {
    prepare(video);
    if (!video || typeof video.play !== 'function') return;
    try {
      const result = video.play();
      if (result && typeof result.catch === 'function') result.catch(_reportUnexpectedPlaybackError);
    } catch (error) {
      _reportUnexpectedPlaybackError(error);
    }
  }

  global.MeldexMediaPlayback = { prepare, start };
})(window);
