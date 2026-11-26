/* Apply the same saved UI theme in standalone tools and auxiliary windows. */
(function (global) {
  'use strict';
  if (global.MeldexDocumentTheme) return;
  const editedKeys = new Set();
  const CACHE_KEY = 'meldex-document-theme-cache';
  let pending = 0;
  let requestSequence = 0;

  // 「OSアクセント」は var(--theme-native-os-accent, AccentColor) で保存される。この値は本体の画面だけが
  // OSから読むため、別画面では AccentColor（ブラウザ既定の明るい青）へ落ちていた（2026-11-24 利用者報告:
  // ビューワーのメインメニューボタンが明るい青）。本体の中の画面は本体の色を、単独の画面はサーバーが
  // 返すOSの色を使う。
  function sameOriginParentRoot() {
    try {
      if (global.parent && global.parent !== global && global.parent.document?.documentElement) {
        return global.parent.document.documentElement;
      }
    } catch { /* 別オリジンの親は読まない */ }
    return null;
  }
  let nativeOsAccent = '';
  function applyNativeOsAccent(color) {
    const value = String(color || '').trim();
    if (/^#[0-9a-f]{6}$/i.test(value)) nativeOsAccent = value.toLowerCase();
    if (nativeOsAccent) document.documentElement.style.setProperty('--theme-native-os-accent', nativeOsAccent);
  }
  // 本体の中に埋め込まれた画面は、本体の表示中の色を正とする（保存済みの写しや古い記録で上書きしない）。
  function followParentTheme() {
    const parentRoot = sameOriginParentRoot();
    if (!parentRoot) { applyNativeOsAccent(''); return false; }
    try {
      const native = getComputedStyle(parentRoot).getPropertyValue('--theme-native-os-accent').trim();
      if (native) document.documentElement.style.setProperty('--theme-native-os-accent', native);
      if (typeof global.inheritParentTheme === 'function') global.inheritParentTheme();
    } catch { /* 親の画面が閉じかけている */ }
    return true;
  }

  function restoreOverrides() {
    const root = document.documentElement;
    let saved = {};
    try {
      const value = JSON.parse(localStorage.getItem('editor-theme') || '{}');
      if (value && typeof value === 'object' && !Array.isArray(value)) saved = value;
    } catch { /* A damaged local preference must not prevent the tool opening. */ }
    for (const [key, value] of Object.entries(saved)) {
      if (!/^--[a-z0-9-]+$/i.test(key) || typeof value !== 'string') continue;
      // A standalone origin may not have the main window's native OS/palette
      // dependencies. Its last saved rendered color is the portable fallback.
      const rendered = saved['_shared-ui-colors']?.[key];
      root.style.setProperty(key, /var\(/i.test(value) && typeof rendered === 'string' ? rendered : value);
      editedKeys.add(key);
    }
    followParentTheme();
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
    applyNativeOsAccent(value?.osAccent);
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
    followParentTheme();
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
