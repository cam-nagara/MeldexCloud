/* gb-split-loader.js: split script loader */
(function (global) {
  const pendingStableCopies = new Map();
  function canonicalStableCopy(value) {
    if (Array.isArray(value)) return value.map(canonicalStableCopy);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.keys(value).filter(key => key !== 'operation_id').sort()
      .map(key => [key, canonicalStableCopy(value[key])]));
  }
  global.MeldexStableCopyOperationIds = Object.freeze({
    prepare(path, body) {
      const payload = body && typeof body === 'object' ? body : {};
      if (payload.operation_id) return { body: payload, key: '' };
      const key = `${String(path || '')}\u0000${JSON.stringify(canonicalStableCopy(payload))}`;
      const operationId = pendingStableCopies.get(key) || crypto.randomUUID();
      pendingStableCopies.set(key, operationId);
      while (pendingStableCopies.size > 256) pendingStableCopies.delete(pendingStableCopies.keys().next().value);
      return { body: { ...payload, operation_id: operationId }, key };
    },
    complete(key) { if (key) pendingStableCopies.delete(key); },
  });
  const PREBUILT_SPLIT_BUNDLES = {
    'meldex-core.js': { file: 'meldex-core.bundle.js', hash: '8a5cb9fa18a0', parts: { 'meldex-core.bundle.part01.js': 'f3ad185b4a49', 'meldex-core.bundle.part02.js': 'a80b640781e2', 'meldex-core.bundle.part03.js': '94e32f812e07', 'meldex-core.bundle.part04.js': 'ef4bd068ca64', 'meldex-core.bundle.part05.js': 'a208b4e6673d' } },
    'gb-app.js': { file: 'gb-app.bundle.js', hash: '2536947d4831', parts: { 'gb-app.bundle.part01.js': 'fd4e4d6461f1', 'gb-app.bundle.part02.js': 'e374de370927', 'gb-app.bundle.part03.js': '46f200eae257', 'gb-app.bundle.part04.js': '975deeb7d2a3', 'gb-app.bundle.part05.js': 'e36bc9ce2879', 'gb-app.bundle.part06.js': '14110f837c67', 'gb-app.bundle.part07.js': '81bcdff2745a' } },
    'gb-theme-manager.js': { file: 'gb-theme-manager.bundle.js', hash: '47197f4d01b4', parts: { 'gb-theme-manager.bundle.part01.js': '29d330501f88', 'gb-theme-manager.bundle.part02.js': '9bc030516ac9', 'gb-theme-manager.bundle.part03.js': '1cb58589e2b6', 'gb-theme-manager.bundle.part04.js': '08a7a2f05f3f' } },
    'gb-outliner.js': { file: 'gb-outliner.bundle.js', hash: '4a661ebcf61e', parts: { 'gb-outliner.bundle.part01.js': '9ecffddd736c', 'gb-outliner.bundle.part02.js': '0341772dd208', 'gb-outliner.bundle.part03.js': '21dc6e0f43bc', 'gb-outliner.bundle.part04.js': '64a9bd758eab', 'gb-outliner.bundle.part05.js': 'c98a63bdc5c3', 'gb-outliner.bundle.part06.js': '172dd6d8d2e0', 'gb-outliner.bundle.part07.js': '91c1a92cd08b' } },
    'gb-data-access-dropbox-fileops.js': { file: 'gb-data-access-dropbox-fileops.bundle.js', hash: '9b9a5be44143', parts: { 'gb-data-access-dropbox-fileops.bundle.part01.js': '22d3b2347d99', 'gb-data-access-dropbox-fileops.bundle.part02.js': '1b9a372c58d1', 'gb-data-access-dropbox-fileops.bundle.part03.js': '8f401580ae12', 'gb-data-access-dropbox-fileops.bundle.part04.js': 'b7d8debd6a84', 'gb-data-access-dropbox-fileops.bundle.part05.js': 'd5877d288600', 'gb-data-access-dropbox-fileops.bundle.part06.js': 'dfd06cf3b329', 'gb-data-access-dropbox-fileops.bundle.part07.js': '80f1b0d07479' } },
    'gb-cloud-mobile-editbar.js': { file: 'gb-cloud-mobile-editbar.bundle.js', hash: '0e64b1e45f57', parts: { 'gb-cloud-mobile-editbar.bundle.part01.js': '9edf34ed3c11', 'gb-cloud-mobile-editbar.bundle.part02.js': '962cc03502e9' } },
  };

  function _resolveChunkUrl(currentScript, chunkName) {
    const base = currentScript?.src || document.baseURI || window.location.href;
    return new URL(chunkName, base).toString();
  }

  function _withFingerprint(url, hash) {
    const devBust = _currentDevBust();
    if (!hash && !devBust) return url;
    const next = new URL(url, window.location.href);
    if (next.protocol === 'file:') return next.toString();
    if (hash) next.searchParams.set('v', hash);
    if (devBust) next.searchParams.set('devBust', devBust);
    return next.toString();
  }

  function _currentDevBust() {
    try {
      const params = new URLSearchParams(window.location.search || '');
      return params.get('devBust') || '';
    } catch (_) {
      return '';
    }
  }

  function _sendChunkRequest(url) {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', url, false);
    try {
      xhr.send(null);
    } catch (e) {
      throw new Error(`split chunk load failed: ${url} (${e?.message || e})`);
    }
    return xhr;
  }

  function _loadChunkText(url) {
    let xhr = _sendChunkRequest(url);
    if (xhr.status === 304) {
      const cacheBust = (url.includes('?') ? '&' : '?') + '_meldex_split_bust=' + Date.now();
      xhr = _sendChunkRequest(url + cacheBust);
    }
    const fileProtocol = (() => {
      try { return new URL(url, window.location.href).protocol === 'file:'; }
      catch { return window.location.protocol === 'file:'; }
    })();
    if (xhr.status >= 200 && xhr.status < 300) return xhr.responseText || '';
    if (xhr.status === 0 && fileProtocol && xhr.responseText) return xhr.responseText;
    throw new Error(`split chunk load failed: ${url} (${xhr.status})`);
  }

  function _executeClassicScript(entryName, source) {
    const script = document.createElement('script');
    script.text = `${source}\n//# sourceURL=${entryName}`;
    const parent = document.head || document.documentElement || document.body;
    if (!parent) throw new Error(`split chunk exec failed: ${entryName} (no script parent)`);
    parent.appendChild(script);
    parent.removeChild(script);
  }

  function _loadPrebuiltBundle(entryName, currentScript) {
    const bundle = PREBUILT_SPLIT_BUNDLES[entryName];
    if (!bundle?.file) return '';
    // Source-level E2E can explicitly bypass generated bundles so changes can be
    // verified before the separately-authorized production build is performed.
    try {
      const params = new URLSearchParams(window.location.search || '');
      if (params.get('splitSource') === '1' || params.get('devBust') === 'split-source') return '';
    } catch (_) {}
    try {
      const url = _withFingerprint(_resolveChunkUrl(currentScript, bundle.file), bundle.hash);
      return _loadChunkText(url);
    } catch (error) {
      try { console.warn('[gb-split-loader] bundle fallback:', entryName, error); } catch {}
      return '';
    }
  }

  function _prebuiltChunkHash(chunkName) {
    for (const bundle of Object.values(PREBUILT_SPLIT_BUNDLES)) {
      if (bundle?.parts && Object.prototype.hasOwnProperty.call(bundle.parts, chunkName)) {
        return bundle.parts[chunkName] || '';
      }
    }
    return '';
  }

  function _extractNestedSplitChunks(entryName, source) {
    if (!source || !source.includes('__loadSplitScript')) return [];
    const escaped = entryName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp("__loadSplitScript\\(\\s*['\"]" + escaped + "['\"]\\s*,\\s*\\[([\\s\\S]*?)\\]\\s*\\)");
    const match = source.match(pattern);
    if (!match) return [];
    const chunks = [];
    const chunkPattern = /['"]([^'"]+\.js)['"]/g;
    let chunkMatch;
    while ((chunkMatch = chunkPattern.exec(match[1]))) chunks.push(chunkMatch[1]);
    return chunks;
  }

  function _splitInlinePrefix(source) {
    const match = source.match(/__loadSplitScript\s*\(\s*['"][^'"]+\.js['"]\s*,\s*\[/);
    if (!match) return '';
    const lines = source.slice(0, match.index).split(/\r?\n/).filter(line => {
      const stripped = line.trim();
      if (!stripped) return false;
      if (stripped.includes('split loader stub')) return false;
      if (stripped.startsWith('if (typeof __loadSplitScript')) return false;
      return true;
    });
    return lines.length ? lines.join('\n') + '\n' : '';
  }

  function _loadChunkSource(currentScript, chunkName, seen) {
    const key = chunkName;
    if (seen.has(key)) throw new Error(`split chunk cycle detected: ${chunkName}`);
    seen.add(key);
    const url = _withFingerprint(_resolveChunkUrl(currentScript, chunkName), _prebuiltChunkHash(chunkName));
    const source = _loadChunkText(url);
    const nested = _extractNestedSplitChunks(chunkName, source);
    if (!nested.length) return source;
    let expanded = _splitInlinePrefix(source);
    for (const nestedChunk of nested) {
      expanded += _loadChunkSource(currentScript, nestedChunk, seen);
      if (!expanded.endsWith('\n')) expanded += '\n';
    }
    return expanded;
  }

  global.__loadSplitScript = function __loadSplitScript(entryName, chunkNames) {
    if (!Array.isArray(chunkNames) || chunkNames.length === 0) return;
    const currentScript = document.currentScript;
    const bundleSource = _loadPrebuiltBundle(entryName, currentScript);
    if (bundleSource) {
      _executeClassicScript(entryName, bundleSource);
      return;
    }
    let source = '';
    for (const chunkName of chunkNames) {
      source += _loadChunkSource(currentScript, chunkName, new Set([entryName]));
      if (!source.endsWith('\n')) source += '\n';
    }
    _executeClassicScript(entryName, source);
  };
})(window);
