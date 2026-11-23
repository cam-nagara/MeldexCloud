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
    'meldex-core.js': { file: 'meldex-core.bundle.js', hash: '1ba65d966880', parts: { 'meldex-core.bundle.part01.js': '3c4c3c1221e5', 'meldex-core.bundle.part02.js': 'bea6fe13fdef', 'meldex-core.bundle.part03.js': 'b7d065a94905', 'meldex-core.bundle.part04.js': 'eba64e8ecb59', 'meldex-core.bundle.part05.js': 'f679da630ccb' } },
    'gb-app.js': { file: 'gb-app.bundle.js', hash: '891b9b29a7ef', parts: { 'gb-app.bundle.part01.js': 'eff796b060e9', 'gb-app.bundle.part02.js': 'c12645bd2e20', 'gb-app.bundle.part03.js': '17f9c9aa6811', 'gb-app.bundle.part04.js': 'f527e72db8e1', 'gb-app.bundle.part05.js': '0a45c97aea83', 'gb-app.bundle.part06.js': '417551d1d4a1', 'gb-app.bundle.part07.js': 'a76390640e49' } },
    'gb-theme-manager.js': { file: 'gb-theme-manager.bundle.js', hash: 'ad1b53cd4da7', parts: { 'gb-theme-manager.bundle.part01.js': '4f7bb919a532', 'gb-theme-manager.bundle.part02.js': '80548a1e119f', 'gb-theme-manager.bundle.part03.js': '5fa6086dffb8', 'gb-theme-manager.bundle.part04.js': '91ff67796578' } },
    'gb-outliner.js': { file: 'gb-outliner.bundle.js', hash: '0fdb050340c6', parts: { 'gb-outliner.bundle.part01.js': '044f6dfd7146', 'gb-outliner.bundle.part02.js': '5210454aa542', 'gb-outliner.bundle.part03.js': '8793dbc907c9', 'gb-outliner.bundle.part04.js': '527e304611d8', 'gb-outliner.bundle.part05.js': '22c7a78dafb2', 'gb-outliner.bundle.part06.js': 'af671458366a', 'gb-outliner.bundle.part07.js': '98c24500a30d', 'gb-outliner.bundle.part08.js': 'db1944e3cb78' } },
    'gb-data-access-dropbox-fileops.js': { file: 'gb-data-access-dropbox-fileops.bundle.js', hash: 'dc879a72b410', parts: { 'gb-data-access-dropbox-fileops.bundle.part01.js': 'c8f6cbdb779d', 'gb-data-access-dropbox-fileops.bundle.part02.js': 'f6828493c456', 'gb-data-access-dropbox-fileops.bundle.part03.js': 'bd923ceb790c', 'gb-data-access-dropbox-fileops.bundle.part04.js': 'ccade547bdac', 'gb-data-access-dropbox-fileops.bundle.part05.js': 'a93864e29b07', 'gb-data-access-dropbox-fileops.bundle.part06.js': '9b821092180c', 'gb-data-access-dropbox-fileops.bundle.part07.js': '8229a6a41f20' } },
    'gb-cloud-mobile-editbar.js': { file: 'gb-cloud-mobile-editbar.bundle.js', hash: '6a75f8a662cc', parts: { 'gb-cloud-mobile-editbar.bundle.part01.js': 'f2081ca2f162', 'gb-cloud-mobile-editbar.bundle.part02.js': '6b3059a02461' } },
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
