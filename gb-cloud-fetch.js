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

  function isSystemStorageConflict(err) {
    return err?.name === 'SystemStorageConflictError' || err?.code === 'system_storage_conflict';
  }

  function cloudErrorDetail(err) {
    return {
      message: err?.message || String(err),
      code: err?.code || err?.meldexCode || (isSystemStorageConflict(err) ? 'system_storage_conflict' : ''),
      route: err?.route || '',
      lock_entry: err?.lock_entry || null,
      unlock_hint: err?.unlock_hint || '',
    };
  }

  function cloudErrorStatus(err) {
    const explicit = Number(err?.status || err?.status_code || 0);
    if (explicit) return Math.max(400, Math.min(599, explicit));
    return isSystemStorageConflict(err) ? 409 : 501;
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
    // Desktop Web Clipper also records its legacy _assets files relative to
    // the home folder, rather than the Dropbox source root.
    if (!clean.startsWith('_media/') && !/(^|\/)_assets\//.test(clean)) return [clean];
    if (window.MeldexSourceFolderRegistry?.parseSourcePath?.(clean)) return [clean];
    const home = _cloudHomeFolderPath().replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
    if (!home) return [clean];
    if (clean === home || clean.startsWith(home + '/')) return [clean];
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
    if (!provider) throw new Error('ブラウザの保存先が未初期化です');
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
        if (window.MeldexRuntimeAdapter?.isDropboxMode?.() && window.MeldexPwaFileUrl?.ensureDisplayUrl) {
          const info = await window.MeldexPwaFileUrl.ensureDisplayUrl(url.href);
          return nativeFetch(info.url);
        }
        const file = await _downloadMediaFile(provider, relativePath);
        return new Response(await file.arrayBuffer(), {
          status: 200,
          headers: { 'Content-Type': file.type || 'application/octet-stream' },
        });
      } catch (error) {
        console.warn('保存先ファイルのサムネイルを生成できませんでした', error);
        return new Response('', { status: 404 });
      }
    }
    if (url.pathname.endsWith('/file-meta')) {
      for (const candidate of _mediaPathCandidates(relativePath)) {
        const stat = await provider.statPath(candidate).catch(() => null);
        if (stat) {
          const isFolder = stat.kind === 'directory' || stat.kind === 'folder' || stat.isDir;
          return jsonResponse({
            created: stat.modified,
            modified: stat.modified,
            ...(isFolder ? {} : { size: stat.size }),
            kind: isFolder ? 'folder' : 'file',
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

  // 添付先シートの添付フォルダを決める（デスクトップ版 _resolve_attachment_dir と同じ規則）。
  // フォルダノートへの記録が無ければ、あとで列設定と同じ経路（/db-metadata）で記録する。
  async function _cloudAttachmentTarget(provider, sheetPath) {
    const attachments = window.MeldexSheetAttachments;
    const lite = window.MeldexCloudFrontmatterLite;
    const base = _normalizeUploadPath(sheetPath).replace(/\/+$/, '');
    if (!base || !attachments) return null;
    let frontmatter = {};
    if (lite?.readFrontmatter) {
      const notePath = base + '/' + _basename(base) + '.md';
      try {
        const parsed = await lite.readFrontmatter(provider, notePath);
        frontmatter = parsed?.frontmatter || {};
      } catch (_) {
        frontmatter = {};
      }
    }
    const registered = attachments.attachmentFolderNameFromFrontmatter(frontmatter);
    const folderName = registered || attachments.ATTACHMENT_FOLDER_NAME;
    return { sheetPath: base, folderName, dir: base + '/' + folderName, registered: !!registered };
  }

  async function _registerCloudAttachmentFolder(target) {
    if (!target || target.registered) return;
    // 旧形式シートで添付フォルダが行として現れないよう、シート側へ名前を控える。
    // 失敗しても添付そのものは成立するので、保存を止めない。
    try {
      if (typeof apiPost === 'function') {
        await apiPost('/db-metadata?path=' + encodeURIComponent(target.sheetPath), {
          attachment_folder: target.folderName,
        });
      }
    } catch (error) {
      console.warn('[sheet-attachment] 添付フォルダ名を控えられませんでした', error);
    }
  }

  async function _cloudAttachmentProbe(provider, dir, hash, size) {
    return async (candidate) => {
      const path = dir + '/' + candidate;
      const stat = await provider.statPath(path).catch(() => null);
      if (!stat) return { exists: false, sameContent: false };
      // 大きい動画で無駄なダウンロードをしないよう、まずサイズで振り分ける
      if (Number(stat.size) !== Number(size)) return { exists: true, sameContent: false };
      try {
        const file = await provider.downloadAsFile(path);
        const existing = new Uint8Array(await file.arrayBuffer());
        const attachments = window.MeldexSheetAttachments;
        return { exists: true, sameContent: (await attachments.sha256Hex(existing)) === hash };
      } catch (_) {
        return { exists: true, sameContent: false };
      }
    };
  }

  async function _imagePixelSize(bytes, kind) {
    if (kind !== 'image' || typeof createImageBitmap !== 'function') return { width: null, height: null };
    try {
      const bitmap = await createImageBitmap(new Blob([bytes]));
      const size = { width: bitmap.width, height: bitmap.height };
      if (typeof bitmap.close === 'function') bitmap.close();
      return size;
    } catch (_) {
      return { width: null, height: null };
    }
  }

  async function mediaUploadResponse(body) {
    if (!(body instanceof FormData)) throw new Error('画像アップロードにはFormDataが必要です');
    const file = body.get('file');
    if (!(file instanceof File) && !(file instanceof Blob)) throw new Error('画像ファイルがありません');
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!bytes.length) throw new Error('空のファイルはアップロードできません');
    const provider = window.MeldexStorageAdapter?.getProvider?.();
    if (!provider?.uploadBytes) throw new Error('ブラウザの保存先が未初期化です');
    const identityAftercare = window.MeldexCreatedImageIdentityAftercare;
    if (!identityAftercare?.prepare || !identityAftercare?.record
        || !identityAftercare?.cancel || !identityAftercare?.drainPrepared) {
      throw new Error('Cloud画像identity aftercareが読み込まれていません');
    }
    const drainedIdentity = await identityAftercare.drainPrepared(provider);

    const attachments = window.MeldexSheetAttachments;
    const sheetPath = String(body.get('sheet_path') || '').trim();
    const target = sheetPath && attachments ? await _cloudAttachmentTarget(provider, sheetPath) : null;

    // 添付先シートが分かる場合は、シートフォルダ内へ元のファイル名のまま保存する（新方式）
    if (target) {
      const ext = attachments.detectContentExt(bytes, file.name || '', file.type || '');
      const kind = attachments.mediaKindForExt(ext);
      const hash = await attachments.sha256Hex(bytes);
      const desired = attachments.buildAttachmentFilename(file.name || '', ext);
      const probe = await _cloudAttachmentProbe(provider, target.dir, hash, bytes.length);
      const resolved = await attachments.resolveAttachmentFilename(desired, probe);
      const path = target.dir + '/' + resolved.filename;
      const prepared = kind === 'image' && !resolved.reused
        ? await identityAftercare.prepare(provider, path, bytes, {
          source: 'media-upload-attachment', filename: resolved.filename,
        })
        : null;
      if (!resolved.reused && (!prepared || prepared.publish_required)) {
        try {
          await provider.uploadBytes(path, bytes);
        } catch (error) {
          if (prepared) await identityAftercare.cancel(provider, prepared, error?.message).catch(console.warn);
          throw error;
        }
      }
      const identity = prepared ? await identityAftercare.record(
        provider, path, bytes, { source: 'media-upload-attachment', prepared },
      ) : null;
      await _registerCloudAttachmentFolder(target);
      const pixel = await _imagePixelSize(bytes, kind);
      const thumbSize = parseInt(String(body.get('thumbnail_size') || '256'), 10) || 256;
      return jsonResponse({
        ok: true,
        hash,
        content_hash: hash,
        filename: resolved.filename,
        path,
        src: path,
        thumb: path,
        url: attachments.rawUrlForPath(path),
        thumb_url: kind === 'image' ? attachments.thumbUrlForPath(path, thumbSize) : attachments.rawUrlForPath(path),
        kind,
        width: pixel.width,
        height: pixel.height,
        size: bytes.length,
        aftercare_pending: !!identity?.aftercare_pending || drainedIdentity.blocked > 0,
      });
    }

    const filename = _basename(file.name || 'image');
    const ext = _imageExtFromBytes(bytes, filename, file.type || '');
    const hash = await _sha256Hex(bytes);
    const shard = hash.slice(0, 2);
    const src = `_media/blobs/${shard}/${hash}.${ext}`;
    const prepared = await identityAftercare.prepare(provider, src, bytes, {
      source: 'media-upload-blob', filename,
    });
    if (prepared.publish_required) {
      try {
        await provider.uploadBytes(src, bytes);
      } catch (error) {
        await identityAftercare.cancel(provider, prepared, error?.message).catch(console.warn);
        throw error;
      }
    }
    const identity = await identityAftercare.record(
      provider, src, bytes, { source: 'media-upload-blob', prepared },
    );
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
      aftercare_pending: !!identity.aftercare_pending || drainedIdentity.blocked > 0,
    });
  }

  async function mediaImportPathResponse(body) {
    const payload = typeof body === 'string' ? JSON.parse(body || '{}')
      : (body && typeof body === 'object' ? body : {});
    const sourcePath = String(payload.source_path || '').trim();
    const sheetPath = String(payload.sheet_path || '').trim();
    if (!sourcePath || !sheetPath) throw new Error('元ファイルと添付先シートを指定してください');
    const provider = window.MeldexStorageAdapter?.getProvider?.();
    if (!provider?.downloadAsFile) throw new Error('ブラウザの保存先が未初期化です');
    // `_media/...` と Web Clipper の `_assets/...` はホームフォルダ相対で
    // 保存されることがある。表示時と同じ候補順で読むことで、Cloud の
    // D&D 保持コピーだけがソースフォルダ直下を見て失敗する経路を作らない。
    const source = await _downloadMediaFile(provider, sourcePath);
    const filename = String(payload.filename || source?.name || _basename(sourcePath));
    const file = source instanceof File && source.name === filename
      ? source : new File([source], filename, { type: source?.type || 'application/octet-stream' });
    const form = new FormData();
    form.append('file', file);
    form.append('sheet_path', sheetPath);
    form.append('thumbnail_size', String(payload.thumbnail_size || 256));
    return mediaUploadResponse(form);
  }

  async function mediaPreservePathResponse(body) {
    const payload = typeof body === 'string' ? JSON.parse(body || '{}')
      : (body && typeof body === 'object' ? body : {});
    const sourcePath = String(payload.source_path || payload.path || '').trim();
    if (!sourcePath) throw new Error('元ファイルを指定してください');
    const provider = window.MeldexStorageAdapter?.getProvider?.();
    if (!provider?.downloadAsFile || !provider?.uploadBytes || !provider?.statPath) {
      throw new Error('ブラウザの保存先が未初期化です');
    }
    const attachments = window.MeldexSheetAttachments;
    if (!attachments?.detectContentExt || !attachments?.sha256Hex) {
      throw new Error('添付ファイル処理を利用できません');
    }
    // `_media/...` と Web Clipper の `_assets/...` はホームフォルダ相対で
    // 保存されることがある。表示時と同じ候補順で読むことで、Cloud の
    // D&D 保持コピーだけがソースフォルダ直下を見て失敗する経路を作らない。
    const source = await _downloadMediaFile(provider, sourcePath);
    const bytes = new Uint8Array(await source.arrayBuffer());
    if (!bytes.length) throw new Error('空のファイルは保存できません');
    const displayName = String(payload.filename || source?.name || _basename(sourcePath));
    const ext = attachments.detectContentExt(bytes, displayName, source?.type || '');
    const kind = attachments.mediaKindForExt(ext);
    if (kind !== 'image' && kind !== 'video') {
      throw new Error('貼り付けメディアとして保存できるのは画像と動画だけです');
    }
    const hash = await attachments.sha256Hex(bytes);
    const home = _cloudHomeFolderPath().replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
    const dir = home ? home + '/貼り付けメディア' : '貼り付けメディア';
    // Cloudはprovider横断でprefix列挙を仮定せず、完全hashを保存名にして
    // 元の表示名が違う同一内容も同じ実体へ収束させる。
    const desired = hash + '.' + ext;
    const probe = await _cloudAttachmentProbe(provider, dir, hash, bytes.length);
    const resolved = await attachments.resolveAttachmentFilename(desired, probe);
    const path = dir + '/' + resolved.filename;
    const identityAftercare = window.MeldexCreatedImageIdentityAftercare;
    const prepared = kind === 'image' && !resolved.reused && identityAftercare?.prepare
      ? await identityAftercare.prepare(provider, path, bytes, {
        source: 'pasted-media', filename: resolved.filename,
      })
      : null;
    if (!resolved.reused && (!prepared || prepared.publish_required)) {
      try {
        await provider.uploadBytes(path, bytes);
      } catch (error) {
        if (prepared && identityAftercare?.cancel) {
          await identityAftercare.cancel(provider, prepared, error?.message).catch(console.warn);
        }
        throw error;
      }
    }
    const identity = prepared && identityAftercare?.record
      ? await identityAftercare.record(provider, path, bytes, { source: 'pasted-media', prepared })
      : null;
    return jsonResponse({
      ok: true,
      path,
      filename: resolved.filename,
      display_name: displayName,
      kind,
      content_hash: hash,
      size: bytes.length,
      reused: !!resolved.reused,
      url: attachments.rawUrlForPath(path),
      aftercare_pending: !!identity?.aftercare_pending,
    });
  }

  async function sheetFilesResponse(apiUrl) {
    const sheetPath = String(apiUrl.searchParams.get('path') || '').replace(/\\/g, '/').replace(/\/+$/, '');
    if (!sheetPath) throw new Error('シートを指定してください');
    const provider = window.MeldexStorageAdapter?.getProvider?.();
    if (!provider?.listEntries) throw new Error('ブラウザの保存先が未初期化です');
    const attachment = await _cloudAttachmentTarget(provider, sheetPath);
    const roots = [attachment?.dir, sheetPath + '/_assets'].filter(Boolean);
    const allowed = new Set(['png','jpg','jpeg','gif','webp','bmp','avif','mp4','webm','mov','pdf','html','htm']);
    const items = [];
    for (const root of roots) {
      const queue = [root];
      while (queue.length) {
        const folder = queue.shift();
        let entries;
        try { entries = await provider.listEntries(folder); } catch (_) { continue; }
        for (const entry of entries || []) {
          if (!entry?.name || entry.name.startsWith('.')) continue;
          const path = folder + '/' + entry.name;
          if (entry.kind === 'directory') { queue.push(path); continue; }
          if (entry.kind !== 'file') continue;
          const ext = entry.name.includes('.') ? entry.name.split('.').pop().toLowerCase() : '';
          if (!allowed.has(ext)) continue;
          items.push({
            name: entry.name,
            type: ['mp4','webm','mov'].includes(ext) ? 'video'
              : ext === 'pdf' ? 'document' : ['html','htm'].includes(ext) ? 'html' : 'image',
            path,
            size: entry.size ?? null,
            modified: entry.modified || entry.server_modified || entry.client_modified || '',
            sheet_file_group: root.split('/').pop(),
          });
        }
      }
    }
    items.sort((left, right) => String(left.sheet_file_group).localeCompare(String(right.sheet_file_group))
      || String(left.name).localeCompare(String(right.name)));
    return jsonResponse({ items, sheet_path: sheetPath, count: items.length });
  }

  function _cloudContainedTargetSupported(path, type) {
    if (['database','sheet','page','note','board','scriptnote','scenario','form-app','calendar','schedule','map'].includes(String(type || '').toLowerCase())) return true;
    return ['.md','.mel-board','.board.md','.mel-scenario','.scriptnote.json','.mel-form','.mel-map']
      .some(suffix => String(path || '').toLowerCase().endsWith(suffix));
  }

  function _cloudContainedType(path) {
    const lower = String(path || '').toLowerCase();
    const ext = lower.includes('.') ? lower.split('.').pop() : '';
    if (['png','apng','jpg','jpeg','gif','bmp','webp','svg','ico','avif','tif','tiff','heic','heif','psd','psb'].includes(ext)) return 'image';
    if (['mp4','webm','mov','avi','mkv','m4v'].includes(ext)) return 'video';
    if (['mp3','wav','ogg','flac','m4a','aac'].includes(ext)) return 'audio';
    if (ext === 'pdf' || ['doc','docx','xls','xlsx','ppt','pptx'].includes(ext)) return 'document';
    if (['html','htm'].includes(ext)) return 'html';
    return 'file';
  }

  function _cloudContainedStrings(value, parentKey = '', out = []) {
    const pathKey = /path|src|href|url|file|image|video|audio|media|asset|attachment|thumbnail|poster|background|cover/i;
    if (Array.isArray(value)) {
      value.forEach(child => {
        if (typeof child === 'string') {
          if (pathKey.test(parentKey)) out.push(child);
          else if (/^\s*[\[{]/.test(child)) {
            try { _cloudContainedStrings(JSON.parse(child), parentKey, out); } catch (_) {}
          }
        } else if (child && typeof child === 'object') _cloudContainedStrings(child, parentKey, out);
      });
    } else if (value && typeof value === 'object') {
      Object.entries(value).forEach(([key, child]) => {
        if (typeof child === 'string') {
          if (pathKey.test(key)) out.push(child);
          else if (/^\s*[\[{]/.test(child)) {
            try { _cloudContainedStrings(JSON.parse(child), key, out); } catch (_) {}
          }
        } else if (child && typeof child === 'object') _cloudContainedStrings(child, key, out);
      });
    }
    return out;
  }

  function _cloudContainedReferencePath(raw, documentPath) {
    let value = String(raw || '').trim().replace(/\\/g, '/');
    if (!value || /^(?:data:|blob:|#|mailto:|https?:)/i.test(value)) return [];
    try {
      const url = new URL(value, 'http://local/');
      if (url.searchParams.get('path')) value = decodeURIComponent(url.searchParams.get('path'));
      else value = decodeURIComponent(url.pathname).replace(/^\//, '');
    } catch (_) {
      value = value.split(/[?#]/)[0];
    }
    const parent = String(documentPath || '').replace(/\/[^/]*$/, '');
    const candidates = [];
    if (parent && !value.includes(':') && !value.startsWith('/')) candidates.push(parent + '/' + value.replace(/^\.\//, ''));
    candidates.push(value.replace(/^\//, ''));
    return [...new Set(candidates.map(path => path.split('/').reduce((parts, part) => {
      if (!part || part === '.') return parts;
      if (part === '..') parts.pop(); else parts.push(part);
      return parts;
    }, []).join('/')).filter(Boolean))];
  }

  async function containedFilesData(path, type) {
    path = String(path || '').replace(/\\/g, '/').replace(/\/+$/, '');
    type = String(type || '').toLowerCase();
    if (!path || !_cloudContainedTargetSupported(path, type)) throw new Error('ファイル内表示に対応する対象が見つかりません');
    const provider = window.MeldexStorageAdapter?.getProvider?.();
    if (!provider?.statPath || !provider?.downloadAsFile) throw new Error('ブラウザの保存先が未初期化です');
    const containerName = path.split('/').pop() || path;
    const byPath = new Map();
    const add = async (candidate, reference, group = '') => {
      for (const resolved of _cloudContainedReferencePath(candidate, path)) {
        let stat;
        try { stat = await provider.statPath(resolved); } catch (_) { stat = null; }
        if (!stat || stat.kind === 'directory') continue;
        const existing = byPath.get(resolved);
        if (existing && (!existing.contained_reference || reference)) return;
        byPath.set(resolved, {
          name: resolved.split('/').pop() || resolved,
          type: _cloudContainedType(resolved),
          path: resolved,
          size: stat.size ?? null,
          modified: stat.modified || stat.server_modified || stat.client_modified || '',
          linked: !!reference,
          contained_reference: !!reference,
          contained_by: path,
          contained_by_name: containerName,
          contained_file_group: group || containerName,
          membership_id: path + '::' + resolved,
        });
        return;
      }
    };
    if (['database','sheet'].includes(type)) {
      if (!provider.listEntries) throw new Error('ブラウザの保存先でフォルダ一覧を取得できません');
      const attachment = await _cloudAttachmentTarget(provider, path);
      const roots = [attachment?.dir, path + '/_assets'].filter(Boolean);
      for (const root of roots) {
        const queue = [root];
        while (queue.length) {
          const folder = queue.shift();
          let entries;
          try { entries = await provider.listEntries(folder); } catch (_) { continue; }
          for (const entry of entries || []) {
            if (!entry?.name || entry.name.startsWith('.')) continue;
            const childPath = folder + '/' + entry.name;
            if (entry.kind === 'directory') queue.push(childPath);
            else if (entry.kind === 'file') await add(childPath, false, root.split('/').pop() || '添付ファイル');
          }
        }
      }
      try {
        const pivot = await window.MeldexDataAccess.requestJson('/pivot?path=' + encodeURIComponent(path), { method: 'GET' });
        for (const ref of _cloudContainedStrings(pivot)) await add(ref, true, '参照ファイル');
      } catch (_) {}
    } else {
      const file = await provider.downloadAsFile(path);
      if ((file?.size || 0) > 16 * 1024 * 1024) return { items: [], container_path: path, count: 0 };
      const text = await file.text();
      const refs = [];
      const markdown = /!?\[[^\]]*\]\((?:<)?([^)>\s]+)(?:>)?(?:\s+["'][^"']*["'])?\)/g;
      const html = /\b(?:src|href|poster)\s*=\s*["']([^"']+)["']/gi;
      const css = /\burl\(\s*["']?([^"')]+)/gi;
      for (const pattern of [markdown, html, css]) {
        let match;
        while ((match = pattern.exec(text))) refs.push(match[1]);
      }
      if (/^\s*[\[{]/.test(text)) {
        try { refs.push(..._cloudContainedStrings(JSON.parse(text))); } catch (_) {}
      }
      for (const ref of refs) await add(ref, true, '参照ファイル');
    }
    const items = Array.from(byPath.values()).sort((a, b) => String(a.contained_file_group).localeCompare(String(b.contained_file_group)) || String(a.name).localeCompare(String(b.name)));
    return { items: items.slice(0, 2000), container_path: path, count: Math.min(items.length, 2000) };
  }

  async function containedFilesResponse(apiUrl) {
    return jsonResponse(await containedFilesData(apiUrl.searchParams.get('path'), apiUrl.searchParams.get('type')));
  }

  async function containedFilesBatchResponse(body) {
    const targets = Array.isArray(body?.targets) ? body.targets.slice(0, 5000) : [];
    const items = [];
    const failed = [];
    for (const target of targets) {
      if (!_cloudContainedTargetSupported(target?.path, target?.type)) continue;
      try {
        const result = await containedFilesData(target.path, target.type);
        items.push(...result.items);
      } catch (_) { failed.push({ path: target?.path || '', status: 404 }); }
      if (items.length >= 10000) break;
    }
    return jsonResponse({ items: items.slice(0, 10000), count: Math.min(items.length, 10000), failed: failed.slice(0, 100), truncated: targets.length >= 5000 || items.length >= 10000 });
  }

  async function pathsExistResponse(body) {
    const provider = window.MeldexStorageAdapter?.getProvider?.();
    if (!provider?.statPath) throw new Error('ブラウザの保存先が未初期化です');
    const paths = Array.isArray(body?.paths) ? body.paths.slice(0, 500) : [];
    const results = {};
    await Promise.all(paths.map(async raw => {
      const path = String(raw || '').trim();
      if (!path || Object.prototype.hasOwnProperty.call(results, path)) return;
      try { results[path] = !!(await provider.statPath(path)); }
      catch (_) { results[path] = false; }
    }));
    return jsonResponse({ results });
  }

  function apiRequestPath(url) {
    const pathname = String(url?.pathname || '');
    const marker = pathname.lastIndexOf('/api');
    const relative = marker >= 0 ? pathname.slice(marker + 4) : pathname;
    return (relative || '') + String(url?.search || '');
  }

  window.fetch = async function patchedFetch(input, init) {
    const requestUrl = input instanceof Request ? input.url : input;
    const url = new URL(requestUrl, document.baseURI || window.location.href);
    const isSameOrigin = url.origin === window.location.origin;
    const isApiPath = /\/api(\/|$)/.test(url.pathname);
    const requestHeaders = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined));
    const useNativeE2eHarness = new URLSearchParams(location.search).get('smoke') === '1'
      && requestHeaders.get('X-Meldex-E2E-Native-Fetch') === 'screenshot';
    if (!isSameOrigin || !isApiPath || useNativeE2eHarness || !window.MeldexRuntimeAdapter?.isBrowserDataMode?.()) {
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
      if (apiUrl.pathname === '/media/import-path' && String(method || 'GET').toUpperCase() === 'POST') {
        return await mediaImportPathResponse(body);
      }
      if (apiUrl.pathname === '/media/preserve' && String(method || 'GET').toUpperCase() === 'POST') {
        return await mediaPreservePathResponse(body);
      }
      if (apiUrl.pathname === '/sheet-files' && String(method || 'GET').toUpperCase() === 'GET') {
        return await sheetFilesResponse(apiUrl);
      }
      if (apiUrl.pathname === '/contained-files' && String(method || 'GET').toUpperCase() === 'GET') {
        return await containedFilesResponse(apiUrl);
      }
      if (apiUrl.pathname === '/contained-files/batch' && String(method || 'GET').toUpperCase() === 'POST') {
        return await containedFilesBatchResponse(body);
      }
      if (apiUrl.pathname === '/paths/exist' && String(method || 'GET').toUpperCase() === 'POST') {
        return await pathsExistResponse(body);
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
      const calendarTextExport = apiUrl.pathname === '/cal/sync/ical/export'
        || apiUrl.pathname === '/calendar-db/ical/export'
        || apiUrl.pathname === '/cal/export/attendance-csv';
      if (calendarTextExport && data?.content != null) {
        return new Response(String(data.content || ''), {
          status: 200,
          headers: {
            'Content-Type': data.mime || (apiUrl.pathname.endsWith('attendance-csv') ? 'text/csv;charset=utf-8' : 'text/calendar;charset=utf-8'),
            'Content-Disposition': `attachment; filename="${String(data.filename || (apiUrl.pathname.endsWith('attendance-csv') ? 'attendance.csv' : 'meldex-calendar.ics')).replace(/"/g, '')}"`,
          },
        });
      }
      return jsonResponse(data);
    } catch (err) {
      // 中断（タイムアウト・画面切替・重複要求の取り消し）は「失敗」ではない。
      // ここで 501 のレスポンスに変換すると、呼び出し側（apiFetch）の
      // 「GETの中断はトーストを出さない」判定を素通りしてしまい、ユーザーが
      // 何もしていないのに「操作を完了できませんでした」が出続ける
      // （実機の診断情報で "HTTP 501: 操作が中断されました" として確認）。
      // 本物の fetch と同じく reject させ、中断は中断として扱わせる。
      if (err?.name === 'AbortError' || err?.code === 20) throw err;
      const status = cloudErrorStatus(err);
      const detail = cloudErrorDetail(err);
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
