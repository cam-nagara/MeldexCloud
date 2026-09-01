/* 利用者コンテンツ画像の読込表示。
   全DOM監視は行わず、各描画境界からtrack()/trackAll()を明示的に呼ぶ。 */
(function () {
  'use strict';

  const tracked = new WeakMap();
  const DEFAULT_DELAY_MS = 220;

  function _label(options) {
    return String(options?.label || '画像を読み込んでいます');
  }

  function _hostFor(img, options) {
    if (options?.host?.nodeType === 1) return options.host;
    const parent = img.parentElement;
    if (parent?.matches?.('[data-meldex-image-host], .embed-media, .tree-thumb-shell, .el-cell-image-content')) return parent;
    return null;
  }

  function createHost(img, options) {
    if (!img || String(img.tagName || '').toLowerCase() !== 'img') return null;
    const existing = _hostFor(img, options);
    if (existing) return existing;
    const opts = options || {};
    const host = document.createElement(opts.tagName || 'span');
    host.className = ['meldex-content-image-host', String(opts.className || '').trim()].filter(Boolean).join(' ');
    host.dataset.meldexImageHost = '1';
    const parent = img.parentNode;
    if (parent) parent.insertBefore(host, img);
    host.appendChild(img);
    return host;
  }

  function track(img, options) {
    if (!img || String(img.tagName || '').toLowerCase() !== 'img') return null;
    const previous = tracked.get(img);
    if (previous) previous.dispose();
    const opts = options || {};
    const host = _hostFor(img, opts);
    const state = {
      img: img,
      host: host,
      source: String(img.currentSrc || img.getAttribute('src') || ''),
      timer: null,
      settled: false,
      decoding: false,
      disposed: false,
      visible: false,
      onLoad: null,
      onError: null,
      onRetry: null,
      onRetryKey: null,
      originalAlt: img.getAttribute('alt'),
      originalAriaLabel: img.getAttribute('aria-label'),
      originalTabIndex: img.getAttribute('tabindex'),
      originalTitle: img.getAttribute('title'),
    };

    function setBusy(value) {
      img.setAttribute('aria-busy', value ? 'true' : 'false');
      if (host) host.setAttribute('aria-busy', value ? 'true' : 'false');
    }

    function show() {
      if (state.settled || state.disposed) return;
      if (!img.isConnected && opts.allowDetached !== true) {
        dispose();
        return;
      }
      state.visible = true;
      img.classList.add('meldex-image-is-loading');
      img.setAttribute('aria-label', img.alt ? img.alt + '（読み込み中）' : _label(opts));
      if (host) host.classList.add('meldex-image-load-host', 'is-loading');
    }

    function cleanupBusy() {
      clearTimeout(state.timer);
      state.timer = null;
      img.classList.remove('meldex-image-is-loading');
      img.removeAttribute('aria-busy');
      if (state.originalAriaLabel !== null) img.setAttribute('aria-label', state.originalAriaLabel);
      else img.removeAttribute('aria-label');
      if (host) {
        host.classList.remove('is-loading');
        host.removeAttribute('aria-busy');
      }
    }

    function restoreInteraction() {
      if (state.originalAlt !== null) img.setAttribute('alt', state.originalAlt);
      else img.removeAttribute('alt');
      if (state.originalTabIndex !== null) img.setAttribute('tabindex', state.originalTabIndex);
      else img.removeAttribute('tabindex');
      if (state.originalTitle !== null) img.setAttribute('title', state.originalTitle);
      else img.removeAttribute('title');
      if (host) delete host.dataset.meldexImageErrorLabel;
    }

    function finish() {
      if (state.settled || state.disposed) return;
      state.settled = true;
      cleanupBusy();
      img.classList.remove('meldex-image-load-error');
      if (host) host.classList.remove('is-error');
      restoreInteraction();
      if (typeof opts.onLoad === 'function') opts.onLoad(img);
    }

    function finishDecoded() {
      if (state.settled || state.disposed || state.decoding) return;
      if (typeof img.decode !== 'function') {
        finish();
        return;
      }
      state.decoding = true;
      Promise.resolve(img.decode()).catch(function () {
        // load済み画像はdecode()がブラウザ都合で失敗しても表示可能なため、読込失敗にはしない。
      }).finally(function () {
        state.decoding = false;
        finish();
      });
    }

    function retry() {
      if (!state.source || state.settled && !img.classList.contains('meldex-image-load-error')) return;
      state.settled = false;
      state.decoding = false;
      img.classList.remove('meldex-image-load-error');
      if (host) host.classList.remove('is-error');
      restoreInteraction();
      setBusy(true);
      state.timer = setTimeout(show, Math.max(0, Number(opts.delayMs ?? DEFAULT_DELAY_MS) || 0));
      const source = state.source;
      img.removeAttribute('src');
      requestAnimationFrame(function () { img.src = source; });
    }

    function fail(error) {
      if (state.settled) return;
      const currentSource = String(img.getAttribute('src') || img.currentSrc || '');
      // 呼び出し元の既存errorハンドラがサムネイルから原寸等へ切り替えた場合は、
      // そのフォールバック読込を新しい試行として追跡する。
      if (state.source && currentSource && currentSource !== state.source) {
        state.source = currentSource;
        clearTimeout(state.timer);
        setBusy(true);
        state.timer = setTimeout(show, Math.max(0, Number(opts.delayMs ?? DEFAULT_DELAY_MS) || 0));
        return;
      }
      // サムネイル待ちなど、track() 後に最初の src が設定される経路では、
      // その最初の取得失敗をフォールバック切替と誤認しない。
      if (!state.source && currentSource) state.source = currentSource;
      state.settled = true;
      cleanupBusy();
      if (opts.errorMode !== 'silent') {
        img.classList.add('meldex-image-load-error');
        const name = state.originalAlt || '画像';
        img.setAttribute('aria-label', name + 'を読み込めません。クリックまたはEnterで再読み込みできます');
        img.setAttribute('alt', name + 'を読み込めません（再読み込み）');
        img.setAttribute('title', 'クリックまたはEnterで再読み込み');
        img.tabIndex = img.tabIndex >= 0 ? img.tabIndex : 0;
        if (host) {
          host.classList.add('meldex-image-load-host', 'is-error');
          host.dataset.meldexImageErrorLabel = '画像を読み込めません・再読み込み';
        }
      }
      if (typeof opts.onError === 'function') opts.onError(error || new Error('画像を読み込めません'));
    }

    function dispose() {
      state.disposed = true;
      state.settled = true;
      clearTimeout(state.timer);
      img.removeEventListener('load', state.onLoad);
      img.removeEventListener('error', state.onError);
      if (state.onRetry) img.removeEventListener('click', state.onRetry);
      if (state.onRetryKey) img.removeEventListener('keydown', state.onRetryKey);
      cleanupBusy();
      img.classList.remove('meldex-image-load-error');
      if (host) host.classList.remove('meldex-image-load-host', 'is-error');
      restoreInteraction();
      if (tracked.get(img)?.state === state) tracked.delete(img);
    }

    state.onLoad = finishDecoded;
    state.onError = fail;
    state.onRetry = function () {
      if (img.classList.contains('meldex-image-load-error')) retry();
    };
    state.onRetryKey = function (event) {
      if (!img.classList.contains('meldex-image-load-error')) return;
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        retry();
      }
    };
    img.addEventListener('load', state.onLoad, { once: false });
    img.addEventListener('error', state.onError, { once: false });
    img.addEventListener('click', state.onRetry);
    img.addEventListener('keydown', state.onRetryKey);
    setBusy(true);
    state.timer = setTimeout(show, Math.max(0, Number(opts.delayMs ?? DEFAULT_DELAY_MS) || 0));

    const api = { state: state, finish: finish, fail: fail, retry: retry, dispose: dispose };
    tracked.set(img, api);
    queueMicrotask(function () {
      if (state.settled || !img.isConnected && opts.allowDetached !== true) return;
      if (img.complete && img.naturalWidth > 0) finishDecoded();
      else if (img.complete && state.source && img.naturalWidth === 0) fail(new Error('画像を読み込めません'));
    });
    return api;
  }

  function trackAll(root, options) {
    if (!root?.querySelectorAll) return [];
    const selector = options?.selector || 'img[data-meldex-content-image]';
    return Array.from(root.querySelectorAll(selector)).map(function (img) {
      const host = img.closest?.('[data-meldex-image-host], .embed-media, .tree-thumb-shell, .el-cell-image-content');
      return track(img, Object.assign({}, options || {}, { host: host || options?.host || null }));
    }).filter(Boolean);
  }

  function get(img) { return tracked.get(img) || null; }

  window.MeldexImageLoading = { track: track, trackAll: trackAll, createHost: createHost, get: get };
})();
