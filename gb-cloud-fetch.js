(function () {
  if (window.__MeldexCloudFetchInstalled) return;
  window.__MeldexCloudFetchInstalled = true;
  const nativeFetch = window.fetch.bind(window);

  function jsonResponse(payload, status) {
    return new Response(JSON.stringify(payload), {
      status: status || 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  async function readRequestBody(input, init) {
    if (init?.body != null) return init.body;
    if (input instanceof Request) {
      const clone = input.clone();
      const type = clone.headers.get('content-type') || '';
      if (type.includes('application/json') || type.includes('text/')) return clone.text();
      return clone.arrayBuffer();
    }
    return undefined;
  }

  function awaitCloudOperationWithSignal(operation, signal) {
    if (!signal) return operation;
    if (signal.aborted) return Promise.reject(new DOMException('操作が中断されました', 'AbortError'));
    return new Promise((resolve, reject) => {
      const onAbort = () => {
        signal.removeEventListener('abort', onAbort);
        reject(new DOMException('操作が中断されました', 'AbortError'));
      };
      signal.addEventListener('abort', onAbort, { once: true });
      Promise.resolve(operation).then(
        value => {
          signal.removeEventListener('abort', onAbort);
          resolve(value);
        },
        error => {
          signal.removeEventListener('abort', onAbort);
          reject(error);
        },
      );
    });
  }

  const CLOUD_VIDEO_THUMBNAIL_EXTENSIONS = new Set([
    'mp4', 'm4v', 'mov', 'webm', 'ogv', 'avi', 'mkv', 'wmv', 'mpg', 'mpeg',
  ]);
  const cloudVideoThumbnailCache = new Map();

  function _isCloudVideoPath(path) {
    const clean = String(path || '').split(/[?#]/, 1)[0];
    const dot = clean.lastIndexOf('.');
    return dot >= 0 && CLOUD_VIDEO_THUMBNAIL_EXTENSIONS.has(clean.slice(dot + 1).toLowerCase());
  }

  function _waitForVideoEvent(video, eventName, timeoutMs) {
    return new Promise((resolve, reject) => {
      let timer = 0;
      const finish = (callback, value) => {
        clearTimeout(timer);
        video.removeEventListener(eventName, onReady);
        video.removeEventListener('error', onError);
        callback(value);
      };
      const onReady = () => finish(resolve);
      const onError = () => finish(reject, new Error('動画のフレームを読み込めません'));
      video.addEventListener(eventName, onReady);
      video.addEventListener('error', onError);
      timer = setTimeout(() => finish(reject, new Error('動画サムネイルの生成がタイムアウトしました')), timeoutMs);
    });
  }

  function _canvasToJpeg(canvas) {
    return new Promise((resolve, reject) => {
      canvas.toBlob(blob => {
        if (blob) resolve(blob);
        else reject(new Error('動画サムネイルを画像化できません'));
      }, 'image/jpeg', 0.84);
    });
  }

  async function _videoFileToThumbnail(file, requestedSize) {
    const video = document.createElement('video');
    const objectUrl = URL.createObjectURL(file);
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    try {
      const loaded = _waitForVideoEvent(video, 'loadeddata', 15000);
      video.src = objectUrl;
      video.load();
      await loaded;

      const duration = Number(video.duration);
      if (Number.isFinite(duration) && duration > 0.5) {
        const seeked = _waitForVideoEvent(video, 'seeked', 8000);
        video.currentTime = Math.min(1, duration * 0.1);
        await seeked;
      }

      const sourceWidth = Math.max(1, video.videoWidth || 1);
      const sourceHeight = Math.max(1, video.videoHeight || 1);
      const size = Math.max(64, Math.min(1024, Number(requestedSize) || 384));
      const scale = Math.min(1, size / Math.max(sourceWidth, sourceHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(sourceWidth * scale));
      canvas.height = Math.max(1, Math.round(sourceHeight * scale));
      const context = canvas.getContext('2d');
      if (!context) throw new Error('動画サムネイルの描画先を作成できません');
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      return await _canvasToJpeg(canvas);
    } finally {
      video.removeAttribute('src');
      video.load();
      URL.revokeObjectURL(objectUrl);
    }
  }

  async function _cloudVideoThumbnail(relativePath, provider, requestedSize) {
    const size = Math.max(64, Math.min(1024, Number(requestedSize) || 384));
    const cacheKey = relativePath + '\n' + size;
    let pending = cloudVideoThumbnailCache.get(cacheKey);
    if (!pending) {
      pending = provider.downloadAsFile(relativePath)
        .then(file => _videoFileToThumbnail(file, size));
      cloudVideoThumbnailCache.set(cacheKey, pending);
      pending.catch(() => cloudVideoThumbnailCache.delete(cacheKey));
      while (cloudVideoThumbnailCache.size > 24) {
        cloudVideoThumbnailCache.delete(cloudVideoThumbnailCache.keys().next().value);
      }
    }
    return pending;
  }

  // シートの画像列などが持つ `_media/blobs/...` は「ホームフォルダからの相対」で
  // 記録されている（デスクトップ版はホームフォルダを基準に解決する）。クラウド版は
  // ソースフォルダ直下として探していたため、実体が
  // `<ソースフォルダ>/<ホームフォルダ>/_media/...` にあると必ず見つからず、
  // シートの画像がすべて壊れた画像として表示されていた。
  // ホームフォルダ基準 → 従来どおりのソースフォルダ直下、の順で探す。
  function _cloudHomeFolderPath() {
    try {
      if (typeof _homeFolderPath === 'string' && _homeFolderPath) return _homeFolderPath;
    } catch (_) { /* 未定義の環境（単独アプリ等）では localStorage を見る */ }
    try {
      const stored = JSON.parse(localStorage.getItem('meldex-cloud-home-folder') || 'null');
      return String(stored?.path || '');
    } catch (_) {
      return '';
    }
  }

  function _mediaPathCandidates(relativePath) {
    const clean = String(relativePath || '').replace(/\\/g, '/').replace(/^\/+/, '');
    if (!clean.startsWith('_media/')) return [clean];
    const home = _cloudHomeFolderPath().replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
    if (!home) return [clean];
    const homeRelative = `${home}/${clean}`;
    return homeRelative === clean ? [clean] : [homeRelative, clean];
  }

  async function _downloadMediaFile(provider, relativePath) {
    const candidates = _mediaPathCandidates(relativePath);
    let lastError = null;
    for (const candidate of candidates) {
      try {
        return await provider.downloadAsFile(candidate);
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError || new Error('ファイルを取得できませんでした: ' + relativePath);
  }

  async function providerResponse(url) {
    const provider = window.MeldexStorageAdapter?.getProvider?.();
    if (!provider) throw new Error('Dropbox provider が未初期化です');
    const relativePath = String(url.searchParams.get('path') || '').replace(/^\/+/, '');
    if (url.pathname.endsWith('/file-raw') || url.pathname.endsWith('/media/file')) {
      const file = await _downloadMediaFile(provider, relativePath);
      return new Response(typeof file.stream === 'function' ? file.stream() : await file.arrayBuffer(), {
        status: 200,
        headers: { 'Content-Type': file.type || 'application/octet-stream' },
      });
    }
    if (url.pathname.endsWith('/thumbnail')) {
      try {
        if (_isCloudVideoPath(relativePath)) {
          const thumbnail = await _cloudVideoThumbnail(relativePath, provider, url.searchParams.get('size'));
          return new Response(thumbnail, {
            status: 200,
            headers: { 'Content-Type': thumbnail.type || 'image/jpeg' },
          });
        }
        const file = await _downloadMediaFile(provider, relativePath);
        return new Response(await file.arrayBuffer(), {
          status: 200,
          headers: { 'Content-Type': file.type || 'application/octet-stream' },
        });
      } catch (error) {
        console.warn('Dropboxファイルのサムネイルを生成できませんでした', error);
        return new Response('', { status: 404 });
      }
    }
    if (url.pathname.endsWith('/file-meta')) {
      for (const candidate of _mediaPathCandidates(relativePath)) {
        const stat = await provider.statPath(candidate).catch(() => null);
        if (stat) {
          return jsonResponse({
            created: stat.modified,
            modified: stat.modified,
            size: stat.size,
          });
        }
      }
      return new Response('', { status: 404 });
    }
    return null;
  }

  function _normalizeUploadPath(path) {
    return String(path || '').replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+/g, '/');
  }

  function _basename(path) {
    const clean = _normalizeUploadPath(path).replace(/\/+$/, '');
    return clean.split('/').pop() || clean || 'file';
  }

  function _mediaFileUrl(path) {
    return '/api/media/file?path=' + encodeURIComponent(_normalizeUploadPath(path));
  }

  function _imageExtFromBytes(bytes, filename, contentType) {
    const nameExt = String(filename || '').split('.').pop().toLowerCase();
    let detected = '';
    if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) detected = 'png';
    else if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) detected = 'jpeg';
    else if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) detected = 'gif';
    else if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) detected = 'webp';
    else {
      const head = new TextDecoder().decode(bytes.slice(0, Math.min(bytes.length, 512))).trimStart().toLowerCase();
      if (head.startsWith('<svg') || (head.startsWith('<?xml') && head.includes('<svg'))) detected = 'svg';
    }
    if (!detected) throw new Error('画像ファイルのみアップロードできます');
    const normalizedExt = nameExt === 'jpg' ? 'jpeg' : nameExt;
    if (['png', 'jpeg', 'gif', 'webp', 'svg'].includes(normalizedExt) && normalizedExt !== detected) {
      throw new Error('画像ファイルの拡張子と内容が一致しません');
    }
    const content = String(contentType || '').toLowerCase();
    const matchesContent = detected === 'jpeg' ? (content.includes('jpeg') || content.includes('jpg')) : content.includes(detected);
    if (!['png', 'jpeg', 'gif', 'webp', 'svg'].includes(normalizedExt) && contentType && !matchesContent) {
      throw new Error('画像ファイルの種類を確認できません');
    }
    return detected;
  }

  async function _sha256Hex(bytes) {
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest)).map(value => value.toString(16).padStart(2, '0')).join('');
  }

  async function mediaUploadResponse(body) {
    if (!(body instanceof FormData)) throw new Error('画像アップロードにはFormDataが必要です');
    const file = body.get('file');
    if (!(file instanceof File) && !(file instanceof Blob)) throw new Error('画像ファイルがありません');
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!bytes.length) throw new Error('空のファイルはアップロードできません');
    const filename = _basename(file.name || 'image');
    const ext = _imageExtFromBytes(bytes, filename, file.type || '');
    const hash = await _sha256Hex(bytes);
    const shard = hash.slice(0, 2);
    const src = `_media/blobs/${shard}/${hash}.${ext}`;
    const provider = window.MeldexStorageAdapter?.getProvider?.();
    if (!provider?.uploadBytes) throw new Error('Dropbox provider が未初期化です');
    await provider.uploadBytes(src, bytes);
    return jsonResponse({
      ok: true,
      hash,
      content_hash: hash,
      filename,
      src,
      thumb: src,
      url: _mediaFileUrl(src),
      thumb_url: _mediaFileUrl(src),
      width: null,
      height: null,
      size: bytes.length,
    });
  }

  function apiRequestPath(url) {
    const pathname = String(url?.pathname || '');
    const marker = pathname.lastIndexOf('/api');
    const relative = marker >= 0 ? pathname.slice(marker + 4) : pathname;
    return (relative || '') + String(url?.search || '');
  }

  function _serverApiUrl(apiPath) {
    const apiBase = window.MeldexRuntimeAdapter?.getServerApiBaseUrl?.() || '';
    if (!apiBase) return '';
    const base = apiBase.replace(/\/+$/, '') + '/';
    return new URL(String(apiPath || '').replace(/^\/+/, ''), base).toString();
  }

  function _storedAuthToken() {
    try {
      return localStorage.getItem('meldex-auth-token') || localStorage.getItem('crossfolio-auth-token') || '';
    } catch {
      return '';
    }
  }

  function _isConfiguredServerApiUrl(url) {
    const apiBase = window.MeldexRuntimeAdapter?.getServerApiBaseUrl?.() || '';
    if (!apiBase) return false;
    try {
      const base = new URL(apiBase);
      const basePath = base.pathname.replace(/\/+$/, '') + '/';
      const path = String(url?.pathname || '').replace(/\/+$/, '') + '/';
      return url.origin === base.origin && path.startsWith(basePath);
    } catch {
      return false;
    }
  }

  async function _serverFetch(input, init, url) {
    const apiPath = apiRequestPath(url);
    const remoteUrl = _serverApiUrl(apiPath);
    if (!remoteUrl) throw new Error('Meldex共有サーバーの接続先が未設定です');
    const method = init?.method || (input instanceof Request ? input.method : 'GET');
    const headers = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined));
    const token = _storedAuthToken();
    if (token && !headers.has('Authorization')) headers.set('Authorization', 'Bearer ' + token);
    headers.delete('X-Meldex-Local-Token');
    const nextInit = { ...(init || {}), method, headers };
    if (input instanceof Request && init?.body == null && !['GET', 'HEAD'].includes(String(method || '').toUpperCase())) {
      nextInit.body = await input.clone().arrayBuffer();
    }
    nextInit.credentials = 'omit';
    return nativeFetch(remoteUrl, nextInit);
  }

  window.fetch = async function patchedFetch(input, init) {
    const requestUrl = input instanceof Request ? input.url : input;
    const url = new URL(requestUrl, document.baseURI || window.location.href);
    const isSameOrigin = url.origin === window.location.origin;
    const isApiPath = /\/api(\/|$)/.test(url.pathname);
    if (window.MeldexRuntimeAdapter?.isServerMode?.() && isApiPath && (isSameOrigin || _isConfiguredServerApiUrl(url))) {
      return _serverFetch(input, init, url);
    }
    if (!isSameOrigin || !isApiPath || !window.MeldexRuntimeAdapter?.isDropboxMode?.()) {
      return nativeFetch(input, init);
    }

    try {
      const rawResponse = await providerResponse(url);
      if (rawResponse) return rawResponse;
      const method = init?.method || (input instanceof Request ? input.method : 'GET');
      const body = await readRequestBody(input, init);
      const apiPath = apiRequestPath(url);
      const apiUrl = new URL('http://local' + apiPath);
      if (apiUrl.pathname === '/media/upload' && String(method || 'GET').toUpperCase() === 'POST') {
        return await mediaUploadResponse(body);
      }
      if (apiUrl.pathname === '/chat/stream' && String(method || 'GET').toUpperCase() === 'POST' && window.MeldexLlmClient?.streamChatAsResponse) {
        const payload = typeof body === 'string' ? JSON.parse(body || '{}') : (body || {});
        return await window.MeldexLlmClient.streamChatAsResponse(payload, { signal: init?.signal });
      }
      const data = await awaitCloudOperationWithSignal(window.MeldexDataAccess.requestJson(
        apiPath,
        {
          method,
          body,
          headers: init?.headers || (input instanceof Request ? input.headers : undefined),
          signal: init?.signal,
        }
      ), init?.signal);
      if ((apiUrl.pathname === '/cal/sync/ical/export' || apiUrl.pathname === '/calendar-db/ical/export') && data?.content != null) {
        return new Response(String(data.content || ''), {
          status: 200,
          headers: {
            'Content-Type': data.mime || 'text/calendar;charset=utf-8',
            'Content-Disposition': `attachment; filename="${String(data.filename || 'meldex-calendar.ics').replace(/"/g, '')}"`,
          },
        });
      }
      return jsonResponse(data);
    } catch (err) {
      const status = Math.max(400, Math.min(599, Number(err?.status || err?.status_code || 501) || 501));
      const detail = {
        message: err?.message || String(err),
        code: err?.code || '',
        route: err?.route || '',
        lock_entry: err?.lock_entry || null,
        unlock_hint: err?.unlock_hint || '',
      };
      return jsonResponse({ error: detail.message, detail }, status);
    }
  };

  // `_media/...`（ホームフォルダ相対）の探索先候補。画像URLを組み立てる
  // gb-cloud-file-url.js からも同じ規則を使うため公開する。
  window.MeldexCloudMediaPath = {
    candidates: _mediaPathCandidates,
    homeFolderPath: _cloudHomeFolderPath,
  };
})();
