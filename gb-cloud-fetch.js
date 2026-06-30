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

  async function providerResponse(url) {
    const provider = window.MeldexStorageAdapter?.getProvider?.();
    if (!provider) throw new Error('Dropbox provider が未初期化です');
    const relativePath = String(url.searchParams.get('path') || '').replace(/^\/+/, '');
    if (url.pathname.endsWith('/file-raw') || url.pathname.endsWith('/media/file')) {
      const file = await provider.downloadAsFile(relativePath);
      return new Response(typeof file.stream === 'function' ? file.stream() : await file.arrayBuffer(), {
        status: 200,
        headers: { 'Content-Type': file.type || 'application/octet-stream' },
      });
    }
    if (url.pathname.endsWith('/thumbnail')) {
      try {
        const file = await provider.downloadAsFile(relativePath);
        return new Response(await file.arrayBuffer(), {
          status: 200,
          headers: { 'Content-Type': file.type || 'application/octet-stream' },
        });
      } catch {
        return new Response('', { status: 404 });
      }
    }
    if (url.pathname.endsWith('/file-meta')) {
      const stat = await provider.statPath(relativePath);
      if (!stat) return new Response('', { status: 404 });
      return jsonResponse({
        created: stat.modified,
        modified: stat.modified,
        size: stat.size,
      });
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

  window.fetch = async function patchedFetch(input, init) {
    const requestUrl = input instanceof Request ? input.url : input;
    const url = new URL(requestUrl, document.baseURI || window.location.href);
    const isSameOrigin = url.origin === window.location.origin;
    const isApiPath = /\/api(\/|$)/.test(url.pathname);
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
      const data = await window.MeldexDataAccess.requestJson(
        apiPath,
        {
          method,
          body,
          headers: init?.headers || (input instanceof Request ? input.headers : undefined),
        }
      );
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
})();
