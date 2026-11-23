/* Shared, file-scoped viewer preferences and spread geometry. No document reloads. */
(function () {
  'use strict';
  const prefix = 'meldex:viewer-page-state:v1:';
  function read(identity) {
    try { return JSON.parse(localStorage.getItem(prefix + identity) || '{}') || {}; }
    catch (_) { return {}; }
  }
  function write(identity, patch) {
    try {
      localStorage.setItem(prefix + identity, JSON.stringify({ ...read(identity), ...patch }));
      return true;
    } catch (_) { return false; }
  }
  function leadingBlank(mode, firstSide) {
    return mode !== 'single' && firstSide !== (mode === 'manga' ? 'right' : 'left');
  }
  function defaultMode(identity, legacy) {
    if (!['single', 'spread', 'manga'].includes(legacy)) return 'single';
    try {
      const key = 'meldex:viewer-page-legacy-owner:v1';
      const owner = localStorage.getItem(key);
      if (!owner) localStorage.setItem(key, identity);
      return !owner || owner === identity ? legacy : 'single';
    } catch (_) { return 'single'; }
  }
  function pdfStart(index, mode, firstSide) {
    if (mode === 'single') return index;
    const offset = leadingBlank(mode, firstSide) ? 1 : 0;
    return index < offset ? 0 : offset + Math.floor((index - offset) / 2) * 2;
  }
  window.MeldexViewerPageState = { read, write, leadingBlank, pdfStart, defaultMode };
})();
