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
    'meldex-core.js': { file: 'meldex-core.bundle.js', hash: '29daae6a9da4', parts: { 'meldex-core.bundle.part01.js': 'fb34efe26dbc', 'meldex-core.bundle.part02.js': '108284767da1', 'meldex-core.bundle.part03.js': '3a6f648d84a1', 'meldex-core.bundle.part04.js': 'cb2709f7f51f', 'meldex-core.bundle.part05.js': '1ab3067f6428' } },
    'gb-app.js': { file: 'gb-app.bundle.js', hash: '1adb22a4ce16', parts: { 'gb-app.bundle.part01.js': '3ba7c9103ddc', 'gb-app.bundle.part02.js': 'c5ed78b3cb3a', 'gb-app.bundle.part03.js': 'e2c66d9b2115', 'gb-app.bundle.part04.js': 'e8222eb7a30c', 'gb-app.bundle.part05.js': 'eba94fd7917f', 'gb-app.bundle.part06.js': '4d33b93c8e09' } },
    'gb-theme-manager.js': { file: 'gb-theme-manager.bundle.js', hash: 'd25176d05c93', parts: { 'gb-theme-manager.bundle.part01.js': '270f333f1a00', 'gb-theme-manager.bundle.part02.js': '629ef1e7b54d', 'gb-theme-manager.bundle.part03.js': 'cd5da0d6c04d', 'gb-theme-manager.bundle.part04.js': 'dc168f6ec18e' } },
    'gb-outliner.js': { file: 'gb-outliner.bundle.js', hash: '6d91f37dc804', parts: { 'gb-outliner.bundle.part01.js': '91423ca32a4b', 'gb-outliner.bundle.part02.js': '9bdd39b336ff', 'gb-outliner.bundle.part03.js': '0cf8f74cc186', 'gb-outliner.bundle.part04.js': '361811e88761', 'gb-outliner.bundle.part05.js': 'a5663bbc5f3e', 'gb-outliner.bundle.part06.js': '568238ffb692' } },
    'gb-data-access-dropbox-fileops.js': { file: 'gb-data-access-dropbox-fileops.bundle.js', hash: '34bf988d3f63', parts: { 'gb-data-access-dropbox-fileops.bundle.part01.js': '85eadaba28cf', 'gb-data-access-dropbox-fileops.bundle.part02.js': '622d2283097e', 'gb-data-access-dropbox-fileops.bundle.part03.js': '34afe80cc61f', 'gb-data-access-dropbox-fileops.bundle.part04.js': '72078078ef9e', 'gb-data-access-dropbox-fileops.bundle.part05.js': 'a65ac618d9de', 'gb-data-access-dropbox-fileops.bundle.part06.js': '2d9de3f97f9a' } },
    'gb-cloud-mobile-editbar.js': { file: 'gb-cloud-mobile-editbar.bundle.js', hash: '0888bcbbbb09', parts: { 'gb-cloud-mobile-editbar.bundle.part01.js': '48d15a6ce08d', 'gb-cloud-mobile-editbar.bundle.part02.js': '0f9ed29e6adb' } },
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
