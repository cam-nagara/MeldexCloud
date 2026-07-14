/* gb-split-loader.js: split script loader */
(function (global) {
  const PREBUILT_SPLIT_BUNDLES = {
    'meldex-core.js': { file: 'meldex-core.bundle.js', hash: 'b94e246ef06e', parts: { 'meldex-core.bundle.part01.js': '224c6a6c37e9', 'meldex-core.bundle.part02.js': '58253347b07c', 'meldex-core.bundle.part03.js': '265dd18c7c87', 'meldex-core.bundle.part04.js': '3b860519d54a' } },
    'gb-app.js': { file: 'gb-app.bundle.js', hash: '96fc6abb8f9a', parts: { 'gb-app.bundle.part01.js': 'e3f11e2a5d74', 'gb-app.bundle.part02.js': 'cae1d562cf50', 'gb-app.bundle.part03.js': 'bbc2177096e3', 'gb-app.bundle.part04.js': '84280101fba8', 'gb-app.bundle.part05.js': '786da3ac0d25', 'gb-app.bundle.part06.js': '43d3632c9ac7', 'gb-app.bundle.part07.js': '41cf87c67b5f' } },
    'gb-theme-manager.js': { file: 'gb-theme-manager.bundle.js', hash: 'be556b9ef132', parts: { 'gb-theme-manager.bundle.part01.js': 'b27937ac630b', 'gb-theme-manager.bundle.part02.js': '95519e276884', 'gb-theme-manager.bundle.part03.js': '287af8d88185', 'gb-theme-manager.bundle.part04.js': 'fd95778f4ad8' } },
    'gb-outliner.js': { file: 'gb-outliner.bundle.js', hash: '1f47edaf5f49', parts: { 'gb-outliner.bundle.part01.js': '4d098ffc4129', 'gb-outliner.bundle.part02.js': '58706c00861b', 'gb-outliner.bundle.part03.js': '19bf96f48b74', 'gb-outliner.bundle.part04.js': '250428a9a3bd', 'gb-outliner.bundle.part05.js': '64ce186de591' } },
    'gb-data-access-dropbox-fileops.js': { file: 'gb-data-access-dropbox-fileops.bundle.js', hash: 'dcbbbb29ff1c', parts: { 'gb-data-access-dropbox-fileops.bundle.part01.js': '05960c3aaf0e', 'gb-data-access-dropbox-fileops.bundle.part02.js': '442866339ab8', 'gb-data-access-dropbox-fileops.bundle.part03.js': 'd0bc9d98446e' } },
    'gb-cloud-mobile-editbar.js': { file: 'gb-cloud-mobile-editbar.bundle.js', hash: '6a3270ae5c28', parts: { 'gb-cloud-mobile-editbar.bundle.part01.js': '36ea42b5e3a4', 'gb-cloud-mobile-editbar.bundle.part02.js': 'b7aeaf7e93c7' } },
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
    const chunkPattern = /['"]([^'"]+\.part\d+(?:\.part\d+)?\.js)['"]/g;
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
