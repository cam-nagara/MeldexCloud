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
    'meldex-core.js': { file: 'meldex-core.bundle.js', hash: 'c56f13ef4e8c', parts: { 'meldex-core.bundle.part01.js': '7c7f67904db7', 'meldex-core.bundle.part02.js': 'c4fc8c79af29', 'meldex-core.bundle.part03.js': 'a91e9f39722a', 'meldex-core.bundle.part04.js': 'eba6db49b276', 'meldex-core.bundle.part05.js': 'c7c66994947e' } },
    'gb-app.js': { file: 'gb-app.bundle.js', hash: '8bfcbd1e4373', parts: { 'gb-app.bundle.part01.js': '25d749d78a8f', 'gb-app.bundle.part02.js': '406527bee583', 'gb-app.bundle.part03.js': '715ea7e792f6', 'gb-app.bundle.part04.js': 'b491c6d6c9a3', 'gb-app.bundle.part05.js': '39c58e12ad97', 'gb-app.bundle.part06.js': '2611b7975cb9', 'gb-app.bundle.part07.js': 'a09101aced3b' } },
    'gb-theme-manager.js': { file: 'gb-theme-manager.bundle.js', hash: '50def04d8e72', parts: { 'gb-theme-manager.bundle.part01.js': 'b77adf787e59', 'gb-theme-manager.bundle.part02.js': '16531854e71e', 'gb-theme-manager.bundle.part03.js': 'ea1451ca03b1', 'gb-theme-manager.bundle.part04.js': '1096bf57eafa' } },
    'gb-outliner.js': { file: 'gb-outliner.bundle.js', hash: '87b5c5545f03', parts: { 'gb-outliner.bundle.part01.js': '55ff09a93cec', 'gb-outliner.bundle.part02.js': '1d4414360c10', 'gb-outliner.bundle.part03.js': '9fbf03ccf26e', 'gb-outliner.bundle.part04.js': '8f1257b322f7', 'gb-outliner.bundle.part05.js': '1bc171fa65a5', 'gb-outliner.bundle.part06.js': 'ad541e31fbcb', 'gb-outliner.bundle.part07.js': '0eb3465aa9de' } },
    'gb-data-access-dropbox-fileops.js': { file: 'gb-data-access-dropbox-fileops.bundle.js', hash: '03bb5530b408', parts: { 'gb-data-access-dropbox-fileops.bundle.part01.js': 'b8eb7566ddaf', 'gb-data-access-dropbox-fileops.bundle.part02.js': '0e9f98d8227e', 'gb-data-access-dropbox-fileops.bundle.part03.js': '9ee42e5a363b', 'gb-data-access-dropbox-fileops.bundle.part04.js': '18b0fe421320', 'gb-data-access-dropbox-fileops.bundle.part05.js': '79ff3a6b0752', 'gb-data-access-dropbox-fileops.bundle.part06.js': '9966673ab887', 'gb-data-access-dropbox-fileops.bundle.part07.js': 'a854e41a6bb4' } },
    'gb-cloud-mobile-editbar.js': { file: 'gb-cloud-mobile-editbar.bundle.js', hash: '6e09eaed40f0', parts: { 'gb-cloud-mobile-editbar.bundle.part01.js': '586766663be9', 'gb-cloud-mobile-editbar.bundle.part02.js': '64decc0d2762' } },
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
