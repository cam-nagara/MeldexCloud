/* meldex-core.js: split loader stub */
(function () {
  function loadSplitScript(entryName, chunkNames) {
    if (typeof __loadSplitScript === 'function') {
      __loadSplitScript(entryName, chunkNames);
      return;
    }
    const currentScript = document.currentScript;
    const base = currentScript?.src || window.location.href;
    let source = '';
    chunkNames.forEach((chunkName) => {
      const xhr = new XMLHttpRequest();
      xhr.open('GET', new URL(chunkName, base).toString(), false);
      xhr.send(null);
      if (!((xhr.status >= 200 && xhr.status < 300) || xhr.status === 0)) {
        throw new Error(`split chunk load failed: ${chunkName} (${xhr.status})`);
      }
      source += xhr.responseText || '';
      if (!source.endsWith('\n')) source += '\n';
    });
    const script = document.createElement('script');
    script.text = `${source}\n//# sourceURL=${entryName}`;
    (document.head || document.documentElement || document.body).appendChild(script).remove();
  }

  loadSplitScript('meldex-core.js', [
    'meldex-core.part01.js',
    'meldex-core.part02.js',
    'meldex-core.part03.js',
  ]);
})();
