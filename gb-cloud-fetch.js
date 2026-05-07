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
    if (url.pathname.endsWith('/file-raw')) {
      const file = await provider.downloadAsFile(relativePath);
      return new Response(await file.arrayBuffer(), {
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
      return jsonResponse({ error: err?.message || String(err) }, 501);
    }
  };
})();
