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
    'meldex-core.js': { file: 'meldex-core.bundle.js', hash: '525b2698053f', parts: { 'meldex-core.bundle.part01.js': '6319b76cc9b1', 'meldex-core.bundle.part02.js': '3300b1c5ffd7', 'meldex-core.bundle.part03.js': '570bbe8f05cc', 'meldex-core.bundle.part04.js': 'cd7c8d725981', 'meldex-core.bundle.part05.js': '2bf09617cb49', 'meldex-core.bundle.part06.js': '7213b70fd525' } },
    'gb-app.js': { file: 'gb-app.bundle.js', hash: '7d5c2657e144', parts: { 'gb-app.bundle.part01.js': '527a873de9a7', 'gb-app.bundle.part02.js': '25827e9d48a2', 'gb-app.bundle.part03.js': '30fd9837b5ee', 'gb-app.bundle.part04.js': 'f492cff7449e', 'gb-app.bundle.part05.js': '164da8c5b02a', 'gb-app.bundle.part06.js': 'a28d2a076d21', 'gb-app.bundle.part07.js': 'e511ebc740b0' } },
    'gb-theme-manager.js': { file: 'gb-theme-manager.bundle.js', hash: 'fb9e1997dbe2', parts: { 'gb-theme-manager.bundle.part01.js': 'ebd3511355c6', 'gb-theme-manager.bundle.part02.js': '9f350dc0e5f6', 'gb-theme-manager.bundle.part03.js': 'c7abc148525e', 'gb-theme-manager.bundle.part04.js': '198020453e81' } },
    'gb-outliner.js': { file: 'gb-outliner.bundle.js', hash: 'e99808530415', parts: { 'gb-outliner.bundle.part01.js': '44422cf290a3', 'gb-outliner.bundle.part02.js': 'd44fc90862f5', 'gb-outliner.bundle.part03.js': '7066494430ac', 'gb-outliner.bundle.part04.js': 'd5543a48fd64', 'gb-outliner.bundle.part05.js': '834ad5ce271a', 'gb-outliner.bundle.part06.js': 'a9fd2b102648', 'gb-outliner.bundle.part07.js': '6a7bfd901d99', 'gb-outliner.bundle.part08.js': 'd7ea67cc41aa', 'gb-outliner.bundle.part09.js': '70def11116d6' } },
    'gb-data-access-dropbox-fileops.js': { file: 'gb-data-access-dropbox-fileops.bundle.js', hash: 'da221f09318c', parts: { 'gb-data-access-dropbox-fileops.bundle.part01.js': '26133ac4c082', 'gb-data-access-dropbox-fileops.bundle.part02.js': '66ab5a3f90d8', 'gb-data-access-dropbox-fileops.bundle.part03.js': 'e2989dc177f8', 'gb-data-access-dropbox-fileops.bundle.part04.js': 'dd038bef28b3', 'gb-data-access-dropbox-fileops.bundle.part05.js': 'e101b9b50746', 'gb-data-access-dropbox-fileops.bundle.part06.js': '7368951228bd', 'gb-data-access-dropbox-fileops.bundle.part07.js': '5d5277c6b9ae' } },
    'gb-cloud-mobile-editbar.js': { file: 'gb-cloud-mobile-editbar.bundle.js', hash: '30952f7196ca', parts: { 'gb-cloud-mobile-editbar.bundle.part01.js': '507ed054aca0', 'gb-cloud-mobile-editbar.bundle.part02.js': '8f576960351b', 'gb-cloud-mobile-editbar.bundle.part03.js': 'f4ced88bd074' } },
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
