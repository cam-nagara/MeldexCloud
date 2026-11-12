/* Apply the same saved UI theme in standalone tools and auxiliary windows. */
(function (global) {
  'use strict';
  if (global.MeldexDocumentTheme) return;
  const editedKeys = new Set();
  const CACHE_KEY = 'meldex-document-theme-cache';
  let pending = 0;
  let requestSequence = 0;

  function restoreOverrides() {
    const root = document.documentElement;
    let saved = {};
    try {
      const value = JSON.parse(localStorage.getItem('editor-theme') || '{}');
      if (value && typeof value === 'object' && !Array.isArray(value)) saved = value;
    } catch { /* A damaged local preference must not prevent the tool opening. */ }
    for (const [key, value] of Object.entries(saved)) {
      if (!/^--[a-z0-9-]+$/i.test(key) || typeof value !== 'string') continue;
      root.style.setProperty(key, value);
      editedKeys.add(key);
    }
    syncSurface();
  }
  function syncSurface() {
    const root = document.documentElement;
    const probe = document.createElement('span');
    probe.style.color = 'var(--bg)';
    probe.hidden = true;
    root.appendChild(probe);
    const background = getComputedStyle(probe).color;
    probe.remove();
    const rgb = background.match(/[\d.]+/g)?.slice(0, 3).map(Number);
    if (rgb?.length === 3) root.classList.toggle('light-theme', rgb[0] * .299 + rgb[1] * .587 + rgb[2] * .114 > 128);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta && background) meta.content = background;
  }

  function refresh() {
    pending = 0;
    const manager = global.MeldexThemeManager;
    if (!manager) return;
    // Clear only the overrides this adapter installed; document data and canvas
    // styles are owned by each tool and are never rewritten here.
    for (const key of editedKeys) document.documentElement.style.removeProperty(key);
    editedKeys.clear();
    manager.applyDefaultTheme(manager.getDefaultThemeId(), {
      silent: true, skipHistory: true, preserveStoredThemeUi: true,
    });
    restoreOverrides();
  }

  function schedule() {
    if (!pending) pending = requestAnimationFrame(refresh);
  }
  function applyShared(value) {
    if (value?.available !== true || !value.theme?.ui?.cssVars) return false;
    const manager = global.MeldexThemeManager;
    if (!manager) return false;
    const base = manager.getThemeById(value.theme.id);
    const theme = {...base, ...value.theme, ui:{...base.ui, ...value.theme.ui,
      cssVars:{...manager.getThemeStyleVars(base), ...value.theme.ui.cssVars}}};
    if (!Object.keys(theme.ui.themeUiApplications || {}).length) theme.ui.themeUiApplications=base.ui.themeUiApplications;
    if (!theme.ui.themeColorSet?.length) theme.ui.themeColorSet=base.ui.themeColorSet;
    manager.applyThemeToDocument(theme, {runtimeOnly:true});
    // The snapshot already includes explicit bulk colors. The accent policy
    // must not replace their selected background/foreground during boot.
    for (const [key,color] of Object.entries(value.theme.ui.cssVars)) {
      if (/^--[a-z0-9-]+$/i.test(key) && typeof color === 'string') document.documentElement.style.setProperty(key,color);
    }
    syncSurface();
    return true;
  }
  async function readShared() {
    const sequence = ++requestSequence;
    const before = localStorage.getItem('editor-theme');
    try {
      const value = typeof global.apiFetch === 'function'
        ? await global.apiFetch('/ui-theme', {silentError:true})
        : await fetch('/api/ui-theme', {credentials:'same-origin'}).then(response => response.ok ? response.json() : null);
      if (sequence !== requestSequence || before !== localStorage.getItem('editor-theme')) return;
      if (applyShared(value)) localStorage.setItem(CACHE_KEY, JSON.stringify(value));
      else if (value?.available === false) { localStorage.removeItem(CACHE_KEY); refresh(); }
    } catch { /* Offline documents keep their last readable theme. */ }
  }
  function start() {
    restoreOverrides();
    try { applyShared(JSON.parse(localStorage.getItem(CACHE_KEY) || 'null')); } catch {}
    readShared();
  }
  global.addEventListener('storage', event => {
    const keys = global.MeldexThemeManager?.THEME_SETTINGS_KEYS || [];
    if (event.key === null || event.key === 'editor-theme' || keys.includes(event.key)) {
      requestSequence += 1;
      if (event.key === null || event.key === 'editor-theme') localStorage.removeItem(CACHE_KEY);
      schedule();
    }
  });
  global.addEventListener('meldex-theme-settings-restored', schedule);
  global.addEventListener('meldex-theme-change', restoreOverrides);
  global.addEventListener('focus', readShared);
  global.MeldexDocumentTheme = Object.freeze({refresh, readShared});
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, {once:true});
  else { refresh(); start(); }
}(window));
