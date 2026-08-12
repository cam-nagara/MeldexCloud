/* gb-split-loader.js: split script loader */
(function (global) {
  const PREBUILT_SPLIT_BUNDLES = {
    'meldex-core.js': { file: 'meldex-core.bundle.js', hash: '40730587f764', parts: { 'meldex-core.bundle.part01.js': '5159bf786674', 'meldex-core.bundle.part02.js': 'f31d8f5b27ba', 'meldex-core.bundle.part03.js': '27c2d3c7d0d6', 'meldex-core.bundle.part04.js': '7f91bffd0253', 'meldex-core.bundle.part05.js': 'bbcce126dd06' } },
    'gb-app.js': { file: 'gb-app.bundle.js', hash: '603ded213a44', parts: { 'gb-app.bundle.part01.js': '4d0d9ebc78f1', 'gb-app.bundle.part02.js': '599240f2db12', 'gb-app.bundle.part03.js': 'b36fae294e4c', 'gb-app.bundle.part04.js': '15888e34c6e5', 'gb-app.bundle.part05.js': 'b8d045237824', 'gb-app.bundle.part06.js': '809ba75bc83e' } },
    'gb-theme-manager.js': { file: 'gb-theme-manager.bundle.js', hash: '4c6e0411acb4', parts: { 'gb-theme-manager.bundle.part01.js': '27f61c9cb779', 'gb-theme-manager.bundle.part02.js': '3ca29548a5cb', 'gb-theme-manager.bundle.part03.js': '2cc74afb23d7', 'gb-theme-manager.bundle.part04.js': '5913dc6c1659' } },
    'gb-outliner.js': { file: 'gb-outliner.bundle.js', hash: 'cab80d10d8f6', parts: { 'gb-outliner.bundle.part01.js': '486e92559dbb', 'gb-outliner.bundle.part02.js': '9293f65108d4', 'gb-outliner.bundle.part03.js': '37810031042e', 'gb-outliner.bundle.part04.js': '2ae78fbad6e6', 'gb-outliner.bundle.part05.js': '45cbc1ddacd4', 'gb-outliner.bundle.part06.js': '27b352f93275' } },
    'gb-data-access-dropbox-fileops.js': { file: 'gb-data-access-dropbox-fileops.bundle.js', hash: 'e2df0b8c458b', parts: { 'gb-data-access-dropbox-fileops.bundle.part01.js': '9b590c99c487', 'gb-data-access-dropbox-fileops.bundle.part02.js': '3967168ce845', 'gb-data-access-dropbox-fileops.bundle.part03.js': '18ee2a226097', 'gb-data-access-dropbox-fileops.bundle.part04.js': 'd7df7b200264' } },
    'gb-cloud-mobile-editbar.js': { file: 'gb-cloud-mobile-editbar.bundle.js', hash: 'ecfc14f17d7b', parts: { 'gb-cloud-mobile-editbar.bundle.part01.js': '8eb0ca269072', 'gb-cloud-mobile-editbar.bundle.part02.js': 'fcc9e3ef6bc0' } },
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
