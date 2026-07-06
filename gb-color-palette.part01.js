/* gb-color-palette.js: 統一カラーパレット + カスタムカラー管理 (v7.0) */
/* PALETTE_COLORS, PALETTE_BG_COLORS は meldex-core.js または呼び出し元で定義済み */

// ============================================================
// CSS注入（一度だけ）
// ============================================================
(function injectPaletteCSS() {
  if (document.getElementById('gb-palette-css')) return;
  const style = document.createElement('style');
  style.id = 'gb-palette-css';
  style.textContent = `
.gb-palette {
  display: flex; flex-direction: column; gap: 4px; padding: 8px;
  background: var(--ui-popup-bg, var(--bg3)); border: 1px solid var(--border); border-radius: 6px;
  width: calc(24px * 8 + 3px * 7 + 16px);
  box-shadow: 0 4px 16px rgba(0,0,0,0.5);
}
.gb-palette-popup { position: fixed; z-index: 10100; }
.gb-palette-grid {
  display: flex; flex-wrap: wrap; gap: 3px;
  width: calc(24px * 8 + 3px * 7);
}
.gb-palette-matrix {
  display: flex; flex-direction: column; gap: 3px;
  width: calc(24px * 8 + 3px * 7);
}
.gb-palette-row-swatches { display: flex; flex-wrap: wrap; gap: 3px; width: calc(24px * 8 + 3px * 7); }
.gb-palette-section-heading { font-size: 10px; color: var(--fg2); line-height: 1.4; padding: 4px 0 2px; border-top: 1px solid var(--border); margin-top: 2px; }
.gb-palette-section-heading:first-child { border-top: 0; margin-top: 0; padding-top: 0; }
.gb-swatch {
  width: 24px; height: 24px; border-radius: 3px; cursor: pointer;
  border: 2px solid transparent; box-sizing: border-box; flex-shrink: 0;
}
.gb-swatch:hover { border-color: var(--ui-border-strong, #fff); }
.gb-swatch:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.gb-swatch.selected { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); }
.gb-swatch.active { border-color: var(--accent); }
.gb-swatch[draggable="true"] { cursor: grab; }
.gb-swatch[draggable="true"]:active { cursor: grabbing; }
.gb-swatch.drag-over-left { box-shadow: -2px 0 0 0 var(--accent); }
.gb-swatch.drag-over-right { box-shadow: 2px 0 0 0 var(--accent); }
.gb-color-swatch {
  --gb-swatch-size: 24px; --gb-swatch-radius: 4px; --gb-swatch-border-width: 2px;
  width: var(--gb-swatch-size); height: var(--gb-swatch-size);
  display: inline-block; padding: 0;
  border: var(--gb-swatch-border-width) solid var(--border);
  border-radius: var(--gb-swatch-radius); box-sizing: border-box;
  flex-shrink: 0; cursor: pointer; appearance: none;
  background-color: var(--bg); background-repeat: no-repeat;
  background-position: center; background-size: cover; vertical-align: middle;
}
.gb-color-swatch:hover { border-color: var(--accent); }
.gb-color-swatch:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.gb-color-swatch--toolbar { --gb-swatch-size: 22px; --gb-swatch-radius: 4px; --gb-swatch-border-width: 1px; }
.gb-color-swatch--field { --gb-swatch-size: 24px; --gb-swatch-radius: 4px; --gb-swatch-border-width: 2px; }
.gb-color-swatch--inline { --gb-swatch-size: 18px; --gb-swatch-radius: 999px; --gb-swatch-border-width: 1px; }
.gb-color-swatch--status { --gb-swatch-size: 22px; --gb-swatch-radius: 999px; --gb-swatch-border-width: 2px; }
.gb-color-swatch--detail { --gb-swatch-size: 32px; --gb-swatch-radius: 8px; --gb-swatch-border-width: 1px; }
.gb-color-swatch--round { --gb-swatch-radius: 999px; }
.gb-palette-sep { width: 100%; border-top: 1px solid var(--border); margin: 2px 0; }
.gb-palette-standard-controls {
  width: 100%; display: flex; flex-direction: column; gap: 3px;
  padding-top: 4px; margin-top: 2px; border-top: 1px solid var(--border); min-width: 0;
}
.gb-palette-section-title {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  font-size: 10px; color: var(--fg2); line-height: 1.2;
}
.gb-palette-standard-toggle {
  flex: 1; min-width: 0; padding: 0; border: 0; background: transparent; color: var(--fg2);
  font: inherit; line-height: 16px; text-align: left; cursor: pointer;
}
.gb-palette-standard-toggle:hover { color: var(--fg); }
.gb-palette-standard-toggle::before { content: '▶'; display: inline-block; width: 12px; color: var(--fg2); }
.gb-palette-standard-toggle[aria-expanded="true"]::before { content: '▼'; }
.gb-palette-standard-body {
  width: 100%; display: flex; flex-direction: column; gap: 3px;
  padding-top: 4px; margin-top: 2px; border-top: 1px solid var(--border); min-width: 0;
}
.gb-palette-standard-body[hidden] { display: none; }
.gb-palette-reset-btn {
  padding: 0 6px; font-size: 10px; line-height: 16px; cursor: pointer;
  color: var(--fg); background: var(--bg); border: 1px solid var(--border); border-radius: 3px;
}
.gb-palette-reset-btn:hover { border-color: var(--accent); background: var(--bg4); }
.gb-palette-sliders {
  width: 100%; display: flex; flex-direction: column; gap: 3px;
  padding-top: 4px; margin-top: 2px; border-top: 1px solid var(--border); min-width: 0;
}
.gb-palette-slider-row {
  display: grid; grid-template-columns: 58px minmax(0, 1fr) 42px;
  align-items: center; column-gap: 4px; min-width: 0;
}
.gb-palette-slider-row label { font-size: 10px; color: var(--fg2); min-width: 0; text-align: right; }
.gb-palette-slider-row input[type="range"] { width: 100%; min-width: 0; height: 14px; cursor: pointer; accent-color: var(--ui-range-fill-bg); }
.gb-palette-slider-row .gb-slider-val {
  font-size: 10px; color: var(--fg); width: 100%; min-width: 0; box-sizing: border-box; text-align: right;
  background: var(--bg); border: 1px solid var(--border); border-radius: 2px;
  padding: 0 2px; -moz-appearance: textfield;
}
.gb-palette-slider-row .gb-slider-val::-webkit-inner-spin-button,
.gb-palette-slider-row .gb-slider-val::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
.gb-palette-picker-row {
  width: 100%; display: flex; align-items: center; gap: 8px;
  padding-top: 6px; margin-top: 2px; border-top: 1px solid var(--border);
}
.gb-palette-picker-row input[type="color"] {
  width: 48px; height: 48px; border: 1px solid var(--border);
  border-radius: 4px; cursor: pointer; padding: 0; flex-shrink: 0;
}
.gb-palette-picker-row .gb-btn-save {
  width: 28px; height: 28px; padding: 0; background: var(--bg4); color: var(--fg);
  border: 1px solid var(--border); border-radius: 3px; cursor: pointer; flex-shrink: 0;
  display: inline-flex; align-items: center; justify-content: center;
}
.gb-palette-picker-row .gb-btn-save:hover { border-color: var(--accent); background: var(--bg5, var(--bg4)); }
.gb-palette-picker-row .gb-btn-eyedropper {
  width: 28px; height: 28px; padding: 0; background: var(--bg4); color: var(--fg);
  border: 1px solid var(--border); border-radius: 3px; cursor: pointer; flex-shrink: 0;
  display: inline-flex; align-items: center; justify-content: center;
}
.gb-palette-picker-row .gb-btn-eyedropper:hover { border-color: var(--accent); background: var(--bg5, var(--bg4)); }
.gb-palette-picker-row .gb-btn-eyedropper:disabled { opacity: 0.5; cursor: not-allowed; }
.gb-palette-picker-row .gb-palette-os-accent-swatch {
  width: 24px; height: 24px; padding: 0; margin: 0;
  background: var(--theme-os-accent, AccentColor); border-color: var(--border);
  appearance: none;
}
.gb-palette-picker-row .gb-palette-os-accent-swatch:hover { border-color: var(--accent); }
.gb-palette-picker-row .gb-palette-os-accent-swatch:disabled { opacity: 0.5; cursor: wait; }
.gb-palette-close-row {
  width: 100%; display: flex; justify-content: flex-end;
  padding-top: 4px; margin-top: 2px; border-top: 1px solid var(--border);
}
.gb-palette-close-row .gb-btn-close {
  padding: 2px 12px; font-size: 12px; background: var(--bg4); color: var(--fg);
  border: 1px solid var(--border); border-radius: 3px; cursor: pointer;
}
.gb-palette-close-row .gb-btn-close:hover { background: var(--bg5, var(--bg4)); border-color: var(--accent); }
@media (max-width: 640px), (pointer: coarse) {
  .gb-palette-popup {
    box-sizing: border-box;
    max-width: calc(100vw - 16px);
    max-height: calc(100dvh - 16px);
    overflow-y: auto;
  }
  .gb-palette {
    width: min(calc(100vw - 32px), calc(44px * 7 + 3px * 6 + 16px));
  }
  .gb-palette-grid,
  .gb-palette-matrix,
  .gb-palette-row-swatches {
    width: min(calc(100vw - 48px), calc(44px * 7 + 3px * 6));
  }
  .gb-swatch {
    width: 44px;
    height: 44px;
  }
  .gb-palette-standard-toggle,
  .gb-palette-reset-btn,
  .gb-palette-picker-row .gb-btn-save,
  .gb-palette-picker-row .gb-btn-eyedropper,
  .gb-palette-close-row .gb-btn-close {
    min-height: 44px;
    font-size: 14px;
  }
  .gb-palette-picker-row {
    flex-wrap: wrap;
  }
  .gb-palette-standard-toggle,
  .gb-palette-reset-btn,
  .gb-palette-picker-row .gb-btn-save,
  .gb-palette-picker-row .gb-btn-eyedropper,
  .gb-palette-picker-row .gb-palette-os-accent-swatch,
  .gb-palette-close-row .gb-btn-close {
    min-width: 44px;
  }
  .gb-palette-picker-row input[type="color"],
  .gb-palette-picker-row .gb-palette-os-accent-swatch {
    width: 44px;
    height: 44px;
  }
  .gb-palette-slider-row {
    grid-template-columns: 44px minmax(0, 1fr) 52px;
    min-height: 44px;
    align-items: center;
  }
  .gb-palette-slider-row input[type="range"] {
    height: 44px;
  }
  .gb-palette-slider-row .gb-slider-val {
    min-height: 44px;
    font-size: 14px;
  }
}
.gb-palette-context-menu {
  position: fixed; z-index: 10200; background: var(--ui-popup-bg, var(--bg3)); border: 1px solid var(--border);
  border-radius: 4px; box-shadow: 0 2px 8px rgba(0,0,0,0.4); padding: 4px; min-width: 96px;
}
.gb-palette-context-menu .gb-context-menu-item {
  width: 100%; border: 0; background: transparent; appearance: none;
  padding: 5px 14px; font: inherit; font-size: 12px; line-height: 1.2;
  text-align: left; color: var(--fg); cursor: pointer;
}
.gb-palette-context-menu .gb-context-menu-item:hover { background: var(--ui-bg-control-active, var(--bg4)); }
.gb-palette-context-menu .gb-context-menu-item.danger { color: var(--ui-danger, var(--red, #d16969)); }
@media (max-width: 640px), (pointer: coarse) {
  .gb-palette-context-menu .gb-context-menu-item {
    min-height: 44px;
    font-size: 14px;
  }
}
`;
  document.head.appendChild(style);
})();

// ============================================================
// カスタムカラー管理（localStorage統一キー）
// ============================================================
const GB_CUSTOM_COLORS_KEY = 'meldex-custom-colors';
const GB_STANDARD_PALETTE_ADJUST_KEY = 'meldex-standard-palette-adjust';
const GB_STANDARD_PALETTE_HUE_MIN = -360;
const GB_STANDARD_PALETTE_HUE_MAX = 360;
const GB_STANDARD_PALETTE_GRAY_PCTS = Object.freeze([0, 17, 33, 50, 67, 83, 100]);
const GB_STANDARD_PALETTE_DEFAULT_ADJUST = Object.freeze({ hueStart: 0, hueEnd: 320, saturation: 50, brightness: 0, contrast: 50 });
const GB_OS_ACCENT_TONES = Object.freeze([
  { tone: 'dark', label: 'OSアクセント（暗）' },
  { tone: 'base', label: 'OSアクセント' },
  { tone: 'light', label: 'OSアクセント（明）' },
]);

(function migrateCustomColors() {
  if (localStorage.getItem('_gb-colors-migrated')) return;
  const OLD_KEYS = ['editor-custom-colors'];
  let merged = [];
  try { merged = JSON.parse(localStorage.getItem(GB_CUSTOM_COLORS_KEY)) || []; } catch {}
  OLD_KEYS.forEach(key => {
    try {
      const old = JSON.parse(localStorage.getItem(key));
      if (Array.isArray(old)) old.forEach(c => { if (!merged.includes(c)) merged.push(c); });
    } catch {}
  });
  try { localStorage.setItem(GB_CUSTOM_COLORS_KEY, JSON.stringify(merged)); localStorage.setItem('_gb-colors-migrated', '1'); } catch {}
})();

function _normalizeCustomColor(c) {
  const text = typeof c === 'string' ? c.trim() : '';
  if (!text) return '';
  if (text.toLowerCase() === 'transparent') return 'transparent';
  if (/^#[0-9a-f]{3}$/i.test(text) || /^#[0-9a-f]{6}$/i.test(text)) return text;
  if (/^rgba?\(/i.test(text)) return text;
  return '';
}

function getCustomColors() {
  try {
    const raw = JSON.parse(localStorage.getItem(GB_CUSTOM_COLORS_KEY)) || [];
    const seen = new Set();
    return (Array.isArray(raw) ? raw : []).map(_normalizeCustomColor).filter(c => {
      if (!c) return false;
      const key = c.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  } catch { return []; }
}
function _refreshCustomColorsAfterHistory() {
  document.querySelectorAll('.gb-palette').forEach(palette => palette.remove());
}
function _saveCustomColors(colors, options) {
  const before = (typeof captureLocalStorageSettings === 'function')
    ? captureLocalStorageSettings([GB_CUSTOM_COLORS_KEY])
    : null;
  try { localStorage.setItem(GB_CUSTOM_COLORS_KEY, JSON.stringify(colors)); } catch {}
  if (before && options?.skipHistory !== true && typeof pushLocalStorageSettingsHistory === 'function') {
    pushLocalStorageSettingsHistory(
      options?.label || '設定: カスタムカラー変更',
      before,
      captureLocalStorageSettings([GB_CUSTOM_COLORS_KEY]),
      options?.detail || '',
      _refreshCustomColorsAfterHistory
    );
  }
}
function saveCustomColor(color) {
  const next = _normalizeCustomColor(color);
  if (!next) return;
  const colors = getCustomColors();
  if (!colors.some(c => c.toLowerCase() === next.toLowerCase())) colors.push(next);
  _saveCustomColors(colors, { label: '設定: カスタムカラー追加', detail: next });
}
function removeCustomColor(color) {
  const target = _normalizeCustomColor(color).toLowerCase();
  _saveCustomColors(
    getCustomColors().filter(c => c.toLowerCase() !== target),
    { label: '設定: カスタムカラー削除', detail: target }
  );
}

function _clampPaletteAdjustValue(value, min, max, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(min, Math.min(max, Math.round(num)));
}

function normalizeStandardPaletteAdjust(adjust) {
  const src = adjust && typeof adjust === 'object' ? adjust : {};
  const hasOwn = key => Object.prototype.hasOwnProperty.call(src, key);
  const hasRange = hasOwn('hueStart') || hasOwn('hueEnd');
  const isLegacy = !hasRange && hasOwn('hue');
  const legacyHue = _clampPaletteAdjustValue(src.hue, -180, 180, 0);
  const hueStartFallback = GB_STANDARD_PALETTE_DEFAULT_ADJUST.hueStart + (isLegacy ? legacyHue : 0);
  const hueEndFallback = GB_STANDARD_PALETTE_DEFAULT_ADJUST.hueEnd + (isLegacy ? legacyHue : 0);
  const rawSaturation = isLegacy ? GB_STANDARD_PALETTE_DEFAULT_ADJUST.saturation + (Number(src.saturation) || 0) : src.saturation;
  const rawContrast = isLegacy ? 50 + ((Number(src.contrast) || 0) / 2) : src.contrast;
  return {
    hueStart: _clampPaletteAdjustValue(src.hueStart, GB_STANDARD_PALETTE_HUE_MIN, GB_STANDARD_PALETTE_HUE_MAX, hueStartFallback),
    hueEnd: _clampPaletteAdjustValue(src.hueEnd, GB_STANDARD_PALETTE_HUE_MIN, GB_STANDARD_PALETTE_HUE_MAX, hueEndFallback),
    saturation: _clampPaletteAdjustValue(rawSaturation, 0, 100, GB_STANDARD_PALETTE_DEFAULT_ADJUST.saturation),
    brightness: _clampPaletteAdjustValue(src.brightness, -100, 100, 0),
    contrast: _clampPaletteAdjustValue(rawContrast, 0, 100, GB_STANDARD_PALETTE_DEFAULT_ADJUST.contrast),
  };
}

function getStandardPaletteAdjust() {
  try {
    return normalizeStandardPaletteAdjust(JSON.parse(localStorage.getItem(GB_STANDARD_PALETTE_ADJUST_KEY) || '{}'));
  } catch {
    return normalizeStandardPaletteAdjust();
  }
}

function _refreshStandardPaletteAdjustAfterHistory() {
  const nextAdjust = getStandardPaletteAdjust();
  document.dispatchEvent(new CustomEvent('gb-standard-palette-adjust-change', { detail: nextAdjust }));
  if (typeof computeThemeColorSetFromSlots === 'function'
    && typeof MeldexThemeManager !== 'undefined'
    && typeof MeldexThemeManager.setThemeColorSet === 'function') {
    const nextColorSet = computeThemeColorSetFromSlots(nextAdjust);
    MeldexThemeManager.setThemeColorSet(nextColorSet, { save: false, immediateTargets: true, skipHistory: true });
  }
  const editor = document.getElementById('settings-theme-editor');
  if (editor && typeof refreshSettingsThemeStylePreviews === 'function') refreshSettingsThemeStylePreviews(editor);
}

function setStandardPaletteAdjust(adjust, options) {
  const opts = options || {};
  const next = normalizeStandardPaletteAdjust(adjust);
  const before = (opts.save !== false && typeof captureLocalStorageSettings === 'function')
    ? captureLocalStorageSettings([GB_STANDARD_PALETTE_ADJUST_KEY])
    : null;
  if (opts.save !== false) {
    try { localStorage.setItem(GB_STANDARD_PALETTE_ADJUST_KEY, JSON.stringify(next)); } catch {}
  }
  if (before && opts.skipHistory !== true && typeof pushLocalStorageSettingsHistory === 'function') {
    pushLocalStorageSettingsHistory(
      opts.label || '設定: 標準パレット調整',
      before,
      captureLocalStorageSettings([GB_STANDARD_PALETTE_ADJUST_KEY]),
      opts.detail || '',
      _refreshStandardPaletteAdjustAfterHistory
    );
  }
  document.dispatchEvent(new CustomEvent('gb-standard-palette-adjust-change', { detail: next }));
  return next;
}

function resetStandardPaletteAdjust(options) {
  return setStandardPaletteAdjust(GB_STANDARD_PALETTE_DEFAULT_ADJUST, options);
}

// ============================================================
// カラーユーティリティ
// ============================================================
function calcBgColor(c) {
  const r = parseInt(c.slice(1, 3), 16), g = parseInt(c.slice(3, 5), 16), b = parseInt(c.slice(5, 7), 16);
  const mix = v => Math.round((v * 0.6 + 128 * 0.4) * 0.5);
  return '#' + [mix(r), mix(g), mix(b)].map(v => v.toString(16).padStart(2, '0')).join('');
}

function parseColorToHexAlpha(val) {
  if (!val || val === 'transparent') return { hex: '#000000', alpha: 0 };
  if (val.startsWith('#')) {
    const hex = val.length === 4 ? '#' + val[1] + val[1] + val[2] + val[2] + val[3] + val[3] : val;
    return { hex, alpha: 1 };
  }
  const m = val.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)/);
  if (m) {
    const hex = '#' + [m[1], m[2], m[3]].map(n => parseInt(n).toString(16).padStart(2, '0')).join('');
    return { hex, alpha: m[4] !== undefined ? parseFloat(m[4]) : 1 };
  }
  return { hex: '#000000', alpha: 1 };
}

function _colorValueToHex(color) {
  const raw = String(color || '').trim();
  if (!raw || raw.toLowerCase() === 'transparent') return '';
  if (/^#[0-9a-f]{3}$/i.test(raw) || /^#[0-9a-f]{6}$/i.test(raw) || /^rgba?\(/i.test(raw)) {
    const parsed = parseColorToHexAlpha(raw);
    return parsed.alpha > 0 && /^#[0-9a-f]{6}$/i.test(parsed.hex) ? parsed.hex.toLowerCase() : '';
  }
  return '';
}

function _customColorSelectionValue(color) {
  const normalized = _normalizeCustomColor(color);
  if (!normalized) return null;
  if (normalized === 'transparent') return { hex: '#000000', isTransparent: true };
  const parsed = parseColorToHexAlpha(normalized);
  if (parsed.alpha <= 0) return { hex: '#000000', isTransparent: true };
  return /^#[0-9a-f]{6}$/i.test(parsed.hex) ? { hex: parsed.hex.toLowerCase(), isTransparent: false } : null;
}

function _computedCssColorToHex(cssColor) {
  if (typeof document === 'undefined' || typeof getComputedStyle !== 'function') return '';
  const host = document.body || document.documentElement;
  if (!host || typeof document.createElement !== 'function') return '';
  const probe = document.createElement('span');
  probe.style.cssText = 'position:fixed;left:-9999px;top:-9999px;width:1px;height:1px;pointer-events:none;';
  probe.style.color = cssColor;
  if (!probe.style.color) return '';
  host.appendChild(probe);
  const computed = getComputedStyle(probe).color;
  probe.remove();
  return _colorValueToHex(computed);
}

function _documentCssVarColorToHex(varName) {
  if (typeof document === 'undefined' || typeof getComputedStyle !== 'function' || !document.documentElement) return '';
  return _colorValueToHex(getComputedStyle(document.documentElement).getPropertyValue(varName));
}

function _mixHexColors(baseHex, mixHex, percent) {
  const base = _colorValueToHex(baseHex), mix = _colorValueToHex(mixHex);
  if (!base || !mix) return base || mix || '';
  const t = _clampPalettePct(percent) / 100;
  const read = (hex, offset) => parseInt(hex.slice(offset, offset + 2), 16);
  const part = offset => Math.round((read(base, offset) * (1 - t)) + (read(mix, offset) * t)).toString(16).padStart(2, '0');
  return '#' + part(1) + part(3) + part(5);
}

function getPaletteOsAccentColor() {
  if (typeof MeldexThemeManager !== 'undefined' && typeof MeldexThemeManager.getOsAccentColor === 'function') {
    const managerColor = _colorValueToHex(MeldexThemeManager.getOsAccentColor());
    if (managerColor) return managerColor;
  }
  return _documentCssVarColorToHex('--theme-os-accent');
}

async function resolvePaletteOsAccentColor() {
  const current = getPaletteOsAccentColor();
  if (current) return current;
  if (typeof MeldexThemeManager !== 'undefined' && typeof MeldexThemeManager.refreshOsAccentColor === 'function') {
    try {
      const refreshed = await MeldexThemeManager.refreshOsAccentColor();
      return _colorValueToHex(refreshed) || getPaletteOsAccentColor();
    } catch {
      return getPaletteOsAccentColor();
    }
  }
  return _computedCssColorToHex('AccentColor');
}

function getPaletteOsAccentVariants(color) {
  const base = _colorValueToHex(color) || getPaletteOsAccentColor();
  const contrast = typeof getStandardPaletteAdjust === 'function' ? getStandardPaletteAdjust().contrast : GB_STANDARD_PALETTE_DEFAULT_ADJUST.contrast;
  const keep = 100 - _clampPalettePct(contrast);
  return GB_OS_ACCENT_TONES.map(info => ({
    ...info,
    color: base ? (info.tone === 'dark' ? _mixHexColors(base, '#000000', contrast) : info.tone === 'light' ? _mixHexColors(base, '#ffffff', contrast) : base) : '',
    fallback: info.tone === 'dark'
      ? `color-mix(in srgb, var(--theme-os-accent, AccentColor) ${keep}%, black ${contrast}%)`
      : info.tone === 'light'
      ? `color-mix(in srgb, var(--theme-os-accent, AccentColor) ${keep}%, white ${contrast}%)`
      : 'var(--theme-os-accent, AccentColor)',
  }));
}

function hexAlphaToRgba(hex, alpha) {
  if (alpha >= 1) return hex;
  if (alpha <= 0) return 'transparent';
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function _hexToHsb(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255, g = parseInt(hex.slice(3, 5), 16) / 255, b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d > 0) { if (max === r) h = ((g - b) / d + 6) % 6; else if (max === g) h = (b - r) / d + 2; else h = (r - g) / d + 4; h *= 60; }
  return { h: Math.round(h), s: Math.round((max === 0 ? 0 : d / max) * 100), b: Math.round(max * 100) };
}

function _hsbToHex(h, s, b) {
  s /= 100; b /= 100;
  const c = b * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = b - c;
  let r1, g1, b1;
  if (h < 60) { r1 = c; g1 = x; b1 = 0; } else if (h < 120) { r1 = x; g1 = c; b1 = 0; }
  else if (h < 180) { r1 = 0; g1 = c; b1 = x; } else if (h < 240) { r1 = 0; g1 = x; b1 = c; }
  else if (h < 300) { r1 = x; g1 = 0; b1 = c; } else { r1 = c; g1 = 0; b1 = x; }
  const toHex = v => Math.round((v + m) * 255).toString(16).padStart(2, '0');
  return '#' + toHex(r1) + toHex(g1) + toHex(b1);
}

function _wrapHue(hue) {
  return ((Math.round(hue) % 360) + 360) % 360;
}

function _clampPalettePct(value) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function _paletteLerp(a, b, t) {
  return a + ((b - a) * t);
}

function _grayFromBlackPct(pct) {
  const v = Math.max(0, Math.min(255, Math.round(255 * (1 - (pct / 100)))));
  const hex = v.toString(16).padStart(2, '0');
  return '#' + hex + hex + hex;
}

function _adjustBlackPctForContrast(pct, contrast) {
  const ratio = _clampPalettePct(contrast);
  if (ratio <= 50) return 50 + ((pct - 50) * (ratio / 50));
  const t = (ratio - 50) / 50;
  if (pct < 50) return pct * (1 - t);
  if (pct > 50) return pct + ((100 - pct) * t);
  return 50;
}

function _standardPaletteHueAt(adjust, index) {
  const t = index / 7;
  return _wrapHue(_paletteLerp(adjust.hueStart, adjust.hueEnd, t));
}

function _standardPaletteBaseBrightness(adjust) {
  return _clampPalettePct(62 + adjust.brightness);
}

function _standardPaletteColorRows(adjust) {
  const rows = { light: [], middle: [], dark: [] };
  const sat = _clampPalettePct(adjust.saturation);
  const midB = _standardPaletteBaseBrightness(adjust);
  const contrast = _clampPalettePct(adjust.contrast) / 100;
  // 明度スライダーが高いとき、旧式の darkB = midB * (1-contrast) では
  // コントラスト=50 で常に midB の半分に沈み込み「明度 100 でも暗い」と感じる問題があった。
  // 暗行のスプレッドを contrast^2 * 100 として、明度側の伸びに追従しつつ
  // コントラスト=100 ではクランプで黒まで届くようにする。
  const darkSpread = 100 * contrast * contrast;
  const lightB = _clampPalettePct(midB + ((100 - midB) * contrast));
  const darkB = _clampPalettePct(midB - darkSpread);
  const lightSat = _clampPalettePct(sat * (1 - contrast));
  for (let i = 0; i < 8; i += 1) {
    const hue = _standardPaletteHueAt(adjust, i);
    rows.middle.push(_hsbToHex(hue, sat, midB));
    rows.light.push(_hsbToHex(hue, lightSat, lightB));
    rows.dark.push(_hsbToHex(hue, sat, darkB));
  }
  return rows;
}

function getStandardPaletteSwatches(adjust, options) {
  const opts = options || {};
  const includeThemeSlots = opts.themeSlots !== false;
  const nextAdjust = normalizeStandardPaletteAdjust(adjust || getStandardPaletteAdjust());
  const extraSlots = typeof getThemeColorExtraSlotSettings === 'function' ? getThemeColorExtraSlotSettings() : {};
  const applyExtra = (row, col, color, title) => {
    const override = extraSlots[`${row}-${col}`];
    return override ? { color: override, title: override, row, index: col, custom: true } : { color, title: title || color, row, index: col };
  };
  const swatches = GB_STANDARD_PALETTE_GRAY_PCTS.map((basePct, idx) => {
    const blackPct = Math.round(_adjustBlackPctForContrast(basePct, nextAdjust.contrast));
    const color = _grayFromBlackPct(blackPct);
    const col = idx + 1; // 行1 col 0 は透明、col 1-7 がグレー
    const override = extraSlots[`1-${col}`];
    return override
      ? { color: override, title: override, blackPct, row: 1, index: col, custom: true }
      : { color, title: `黒 ${blackPct}%`, blackPct, row: 1, index: col };
  });
  const rows = _standardPaletteColorRows(nextAdjust);
  rows.light.forEach((color, index) => swatches.push(applyExtra(2, index, color)));
  const themeSlots = includeThemeSlots && typeof getThemeColorSlotSettings === 'function'
    ? getThemeColorSlotSettings()
    : [];
  rows.middle.forEach((color, index) => {
    const slot = themeSlots[index];
    if (!slot) {
      swatches.push({ color, title: color, row: 3, index });
      return;
    }
    const displayColor = slot.applyAdjust === false || typeof adjustStandardPaletteColor !== 'function'
      ? slot.color
      : adjustStandardPaletteColor(slot.color, nextAdjust);
    swatches.push({
      color: displayColor,
      title: `テーマカラー ${index + 1}: ${displayColor}`,
      row: 3,
      index,
      themeSlot: true,
      custom: true,
    });
  });
  rows.dark.forEach((color, index) => swatches.push(applyExtra(4, index, color)));
  return swatches;
}

function adjustStandardPaletteColor(hex, adjust) {
  if (!hex || !String(hex).startsWith('#')) return hex;
  const nextAdjust = normalizeStandardPaletteAdjust(adjust || getStandardPaletteAdjust());
  const hsb = _hexToHsb(hex);
  if (hsb.s === 0) {
    const blackPct = _clampPalettePct(100 - hsb.b);
    return _grayFromBlackPct(_adjustBlackPctForContrast(blackPct, nextAdjust.contrast));
  }
  const hueShift = nextAdjust.hueStart - GB_STANDARD_PALETTE_DEFAULT_ADJUST.hueStart;
  const contrastFactor = nextAdjust.contrast / 50;
  const nextH = _wrapHue(hsb.h + hueShift);
  const nextS = _clampPalettePct(hsb.s + nextAdjust.saturation - GB_STANDARD_PALETTE_DEFAULT_ADJUST.saturation);
  const contrastedB = 50 + ((hsb.b - 50) * contrastFactor);
  const nextB = _clampPalettePct(contrastedB + nextAdjust.brightness);
  return _hsbToHex(nextH, nextS, nextB);
}

function getStandardPaletteColors(adjust) {
  return getStandardPaletteSwatches(adjust).map(swatch => swatch.color);
}

function getColorSwatchValue(el, fallback) {
  if (!el) return fallback || '';
  const val = el.dataset.color;
  return typeof val === 'string' ? val : (fallback || '');
}

function setColorSwatchValue(el, color) {
  if (!el) return '';
  const next = color == null ? '' : String(color).trim();
  const isChecker = !next || next === 'transparent';
  el.dataset.color = next;
  el.classList.toggle('is-empty', !next);
  el.classList.toggle('is-transparent', next === 'transparent');
  el.style.background = ''; el.style.backgroundSize = ''; el.style.backgroundPosition = '';
  if (isChecker) {
    el.style.background = 'linear-gradient(45deg, rgba(148,163,184,0.38) 25%, transparent 25%, transparent 75%, rgba(148,163,184,0.38) 75%),linear-gradient(45deg, rgba(148,163,184,0.38) 25%, transparent 25%, transparent 75%, rgba(148,163,184,0.38) 75%)';
    el.style.backgroundSize = '8px 8px'; el.style.backgroundPosition = '0 0,4px 4px';
  } else { el.style.background = next; }
  return next;
}

function _isNativePaletteControl(el) {
  const tag = String(el?.tagName || '').toLowerCase();
  return tag === 'button' || tag === 'input' || tag === 'select' || tag === 'textarea' || tag === 'a';
}

function _setPaletteSwatchControl(el, label, onActivate) {
  if (!el) return;
  if (!_isNativePaletteControl(el)) {
    el.tabIndex = 0;
    if (typeof el.setAttribute === 'function') el.setAttribute('role', 'button');
  }
  const currentLabel = typeof el.getAttribute === 'function' ? el.getAttribute('aria-label') : '';
  if (label && !currentLabel && typeof el.setAttribute === 'function') el.setAttribute('aria-label', label);
  if (el._gbPaletteSwatchKeyHandler && typeof el.removeEventListener === 'function') {
    el.removeEventListener('keydown', el._gbPaletteSwatchKeyHandler);
  }
  if (typeof onActivate === 'function') {
    el._gbPaletteSwatchKeyHandler = (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      event.stopPropagation();
      onActivate(event);
    };
    if (typeof el.addEventListener === 'function') el.addEventListener('keydown', el._gbPaletteSwatchKeyHandler);
  }
}

function bindColorSwatch(el, getCurrentColor, onSelect) {
  if (!el) return null;
  const readCurrent = typeof getCurrentColor === 'function' ? getCurrentColor : () => (getCurrentColor == null ? '' : getCurrentColor);
  const applySelected = typeof onSelect === 'function' ? onSelect : () => {};
  const refresh = (color) => setColorSwatchValue(el, color);
  refresh(readCurrent());
  if (el._gbColorSwatchClickHandler) {
    el.removeEventListener('click', el._gbColorSwatchClickHandler);
  }
  el._gbColorSwatchClickHandler = (ev) => {
    ev.preventDefault();
    openColorPalette(el, readCurrent(), (color) => {
      refresh(color);
      applySelected(color, el);
    });
  };
  el.addEventListener('click', el._gbColorSwatchClickHandler);
  const label = typeof el.getAttribute === 'function' ? el.getAttribute('aria-label') : '';
  _setPaletteSwatchControl(el, label || el.title || '色を選択', el._gbColorSwatchClickHandler);
  return refresh;
}

// ============================================================
// 統一カラーパレット — ポップアップ
// ============================================================
let _gbPalettePopup = null;
let _gbPaletteOutsideHandler = null;
let _gbPaletteKeyHandler = null;

function closeColorPalette() {
  if (_gbPalettePopup) { _gbPalettePopup.remove(); _gbPalettePopup = null; }
  document.querySelectorAll('.gb-palette-context-menu, .gb-ctx-menu').forEach(menu => menu.remove());
  if (_gbPaletteOutsideHandler) { document.removeEventListener('pointerdown', _gbPaletteOutsideHandler, true); _gbPaletteOutsideHandler = null; }
  if (_gbPaletteKeyHandler) { document.removeEventListener('keydown', _gbPaletteKeyHandler, true); _gbPaletteKeyHandler = null; }
}

function openColorPalette(anchorEl, currentColor, onSelect) {
  closeColorPalette();
  const palette = _buildPaletteElement(currentColor, onSelect, closeColorPalette);
  palette.classList.add('gb-palette-popup');
  document.body.appendChild(palette);
  _gbPalettePopup = palette;
  if (typeof positionPopup === 'function') positionPopup(palette, anchorEl.getBoundingClientRect());
  else { const rect = anchorEl.getBoundingClientRect(); const z = (typeof _getZoom === 'function') ? _getZoom() : 1; palette.style.left = (rect.left / z) + 'px'; palette.style.top = (rect.bottom / z + 4) + 'px'; }
  _gbPaletteOutsideHandler = (ev) => { if (_gbPalettePopup && !_gbPalettePopup.contains(ev.target) && !ev.target.closest?.('.gb-palette-context-menu, .gb-ctx-menu') && ev.target !== anchorEl) closeColorPalette(); };
  _gbPaletteKeyHandler = (ev) => {
    if (ev.key !== 'Escape' || !_gbPalettePopup) return;
    if (document.querySelector('.gb-palette-context-menu, .gb-ctx-menu')) return;
    ev.preventDefault();
    closeColorPalette();
  };
  setTimeout(() => document.addEventListener('pointerdown', _gbPaletteOutsideHandler, true), 0);
  setTimeout(() => document.addEventListener('keydown', _gbPaletteKeyHandler, true), 0);
}

// ============================================================
// 統一カラーパレット — インライン
// ============================================================
function createInlineColorGrid(currentColor, onSelect) {
  const { hex: curHex } = parseColorToHexAlpha(currentColor);
  const isDefault = !currentColor;
  const grid = document.createElement('div');
  grid.style.cssText = 'display:flex;flex-wrap:wrap;gap:3px;padding:4px;width:calc(24px*8+3px*7);';
  const defSwatch = document.createElement('div');
  defSwatch.className = 'gb-swatch' + (isDefault ? ' active' : '');
  defSwatch.style.background = 'var(--bg4)'; defSwatch.title = 'デフォルト';
  const selectDefault = () => onSelect('');
  defSwatch.addEventListener('click', selectDefault);
  _setPaletteSwatchControl(defSwatch, 'デフォルトを選択', selectDefault);
  grid.appendChild(defSwatch);
  getStandardPaletteSwatches().forEach(info => {
    const c = info.color;
    const swatch = document.createElement('div');
    swatch.className = 'gb-swatch' + (!isDefault && c.toLowerCase() === curHex.toLowerCase() ? ' active' : '');
    swatch.style.background = c; swatch.title = info.title || c;
    const selectStandard = () => onSelect(c);
    swatch.addEventListener('click', selectStandard);
    _setPaletteSwatchControl(swatch, `${info.title || c}を選択`, selectStandard);
    grid.appendChild(swatch);
  });
  getCustomColors().forEach(c => {
    const swatch = document.createElement('div');
    swatch.className = 'gb-swatch' + (!isDefault && c.toLowerCase() === curHex.toLowerCase() ? ' active' : '');
    if (c === 'transparent') {
      swatch.style.cssText = 'background:linear-gradient(45deg,#666 25%,transparent 25%,transparent 75%,#666 75%),linear-gradient(45deg,#666 25%,transparent 25%,transparent 75%,#666 75%);background-size:6px 6px;background-position:0 0,3px 3px;';
    } else {
      swatch.style.background = c;
    }
    swatch.title = c;
    const selectCustom = () => onSelect(c);
    swatch.addEventListener('click', selectCustom);
    _setPaletteSwatchControl(swatch, `カスタムカラー ${c} を選択`, selectCustom);
    grid.appendChild(swatch);
  });
  return grid;
}

// ============================================================
// 内部: パレット要素の構築
// ============================================================
function _buildPaletteElement(currentColor, onChange, onClose) {
  const { hex: curHex } = parseColorToHexAlpha(currentColor);
  const isTransparent = !currentColor || currentColor === 'transparent';

  let selectedHex = isTransparent ? '#000000' : curHex;
  let selectedIsTransparent = isTransparent;
  let selectedCustomIdx = -1;
  let selectedPresetIdx = -1;
  let selectedOsAccentTone = '';
  let standardAdjust = getStandardPaletteAdjust();
  if (!isTransparent) {
    const initCustoms = getCustomColors();
    const initIdx = initCustoms.findIndex(c => _colorValueToHex(c).toLowerCase() === curHex.toLowerCase());
    if (initIdx >= 0) selectedCustomIdx = initIdx;
    if (selectedCustomIdx < 0) {
      const initPresetIdx = getStandardPaletteColors(standardAdjust).findIndex(c => c.toLowerCase() === curHex.toLowerCase());
      if (initPresetIdx >= 0) selectedPresetIdx = initPresetIdx;
    }
  }
  let hsb = _hexToHsb(selectedHex);

  const palette = document.createElement('div');
  palette.className = 'gb-palette';
  function reclampPalette() {
    if (typeof clampPopupToViewport !== 'function') return;
    const requestFrame = (typeof window !== 'undefined' && window.requestAnimationFrame) || (fn => setTimeout(fn, 0));
    requestFrame(() => { if (palette.isConnected) clampPopupToViewport(palette); });
  }

  function currentOutputColor() {
    if (selectedIsTransparent) return 'transparent';
    return _hsbToHex(hsb.h, hsb.s, hsb.b);
  }
  function currentHex() { return _hsbToHex(hsb.h, hsb.s, hsb.b); }
  function applyLive() { if (typeof onChange === 'function') onChange(currentOutputColor()); }

  function selectSwatch(hex, isTransp, customIdx, presetIdx) {
    selectedHex = hex; selectedIsTransparent = isTransp; selectedCustomIdx = customIdx; selectedPresetIdx = presetIdx ?? -1;
    selectedOsAccentTone = '';
    if (!isTransp) { hsb = _hexToHsb(hex); } else { hsb = { h: 0, s: 0, b: 0 }; }
    updateSliders(); updatePicker(); updateSwatchHighlights();
    applyLive();
  }

  // --- テーマカラーセット ---
  const themeSectionHeading = document.createElement('div');
  themeSectionHeading.className = 'gb-palette-section-heading';
  themeSectionHeading.textContent = 'テーマカラーセット';
  palette.appendChild(themeSectionHeading);

  const presetMatrix = document.createElement('div');
  presetMatrix.className = 'gb-palette-matrix';
  palette.appendChild(presetMatrix);

  function renderPresetGrid(refreshHighlights) {
    presetMatrix.innerHTML = '';
    const all = getStandardPaletteSwatches(standardAdjust);
    const rowKeys = [1, 2, 3, 4];
    rowKeys.forEach(rowNum => {
      const items = all.filter(s => s.row === rowNum);
      if (rowNum !== 1 && !items.length) return;
      const swatchesEl = document.createElement('div');
      swatchesEl.className = 'gb-palette-row-swatches gb-palette-row-swatches--flat';
      if (rowNum === 1) {
        const transSwatch = document.createElement('div');
        transSwatch.className = 'gb-swatch';
        transSwatch.dataset.type = 'transparent';
        transSwatch.style.cssText = 'background:linear-gradient(45deg,#666 25%,transparent 25%,transparent 75%,#666 75%),linear-gradient(45deg,#666 25%,transparent 25%,transparent 75%,#666 75%);background-size:6px 6px;background-position:0 0,3px 3px;';
        transSwatch.title = '透明';
        const selectTransparent = () => selectSwatch('#000000', true, -1, -1);
        transSwatch.addEventListener('click', selectTransparent);
        _setPaletteSwatchControl(transSwatch, '透明を選択', selectTransparent);
        swatchesEl.appendChild(transSwatch);
      }
      items.forEach((info) => {
        const c = info.color;
        const swatch = document.createElement('div');
        swatch.className = 'gb-swatch';
        swatch.dataset.type = 'preset';
        swatch.dataset.hex = c.toLowerCase();
        const presetIdx = all.indexOf(info);
        swatch.dataset.presetIdx = String(presetIdx);
        swatch.style.background = c;
        swatch.title = info.title || c;
        const selectPreset = () => selectSwatch(c, false, -1, presetIdx);
        swatch.addEventListener('click', selectPreset);
        _setPaletteSwatchControl(swatch, `${info.title || c}を選択`, selectPreset);
        swatchesEl.appendChild(swatch);
      });
      presetMatrix.appendChild(swatchesEl);
    });
    if (refreshHighlights) updateSwatchHighlights();
  }
  renderPresetGrid(false);

  // 標準色調整スライダーは設定ダイアログのテーマタブに移動。
  // ポップアップでは表示のみ。スライダー変更を外部で反映するためイベントを購読。
  function _onStandardPaletteAdjustChange(ev) {
    standardAdjust = normalizeStandardPaletteAdjust(ev?.detail || getStandardPaletteAdjust());
    renderPresetGrid(true);
    refreshOsAccentSwatches(undefined, { applySelected: true });
    updateSwatchHighlights();
  }
  if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    document.addEventListener('gb-standard-palette-adjust-change', _onStandardPaletteAdjustChange);
  }

  // --- カスタムカラーセット ---
  const customSectionHeading = document.createElement('div');
  customSectionHeading.className = 'gb-palette-section-heading';
  customSectionHeading.textContent = 'カスタムカラーセット';
  palette.appendChild(customSectionHeading);

  const customGrid = document.createElement('div'); customGrid.className = 'gb-palette-grid';
  palette.appendChild(customGrid);

  let dragIdx = -1;

  function renderCustomGrid() {
    customGrid.innerHTML = '';
    const customs = getCustomColors();
    customSectionHeading.hidden = customs.length === 0;
    customs.forEach((c, i) => {
      const swatch = document.createElement('div');
      swatch.className = 'gb-swatch'; swatch.dataset.type = 'custom';
      swatch.dataset.hex = c.toLowerCase(); swatch.dataset.customIdx = String(i);
      if (c === 'transparent') {
        swatch.style.cssText = 'background:linear-gradient(45deg,#666 25%,transparent 25%,transparent 75%,#666 75%),linear-gradient(45deg,#666 25%,transparent 25%,transparent 75%,#666 75%);background-size:6px 6px;background-position:0 0,3px 3px;';
      } else {
        swatch.style.background = c;
      }
      swatch.title = c; swatch.draggable = true;
      swatch.dataset.e2eId = `color-palette-custom-${i}`;
      swatch.tabIndex = 0;
      swatch.setAttribute('role', 'button');
      swatch.setAttribute('aria-label', `カスタムカラー ${c} を選択`);

      const selectCustomSwatch = () => {
        const selected = _customColorSelectionValue(c);
        if (!selected) return;
        selectSwatch(selected.hex, selected.isTransparent, i);
      };
      swatch.addEventListener('click', selectCustomSwatch);

      // 右クリック/長押し → コンテキストメニュー
      const openSwatchCtxMenu = (e) => {
        e.preventDefault();
        e.stopPropagation?.();
        document.querySelectorAll('.gb-palette-context-menu, .gb-ctx-menu').forEach(m => m.remove());
        const menu = document.createElement('div');
        menu.className = 'gb-context-menu gb-palette-context-menu';
        menu.setAttribute('role', 'menu');
        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'gb-context-menu-item danger';
        del.dataset.e2eId = 'color-palette-custom-delete';
        del.setAttribute('role', 'menuitem');
        del.textContent = '削除';
        del.addEventListener('click', () => {
          menu.remove();
          removeCustomColor(c);
          if (selectedCustomIdx === i) selectedCustomIdx = -1;
          else if (selectedCustomIdx > i) selectedCustomIdx--;
          renderCustomGrid(); updateSwatchHighlights();
        });
        menu.appendChild(del);
        document.body.appendChild(menu);
        const swatchRect = swatch.getBoundingClientRect();
        const pointX = Number.isFinite(e.clientX) && e.clientX > 0 ? e.clientX : swatchRect.left + swatchRect.width / 2;
        const pointY = Number.isFinite(e.clientY) && e.clientY > 0 ? e.clientY : swatchRect.top + swatchRect.height / 2;
        const pointRect = { left: pointX, right: pointX, top: pointY, bottom: pointY };
        if (typeof positionPopup === 'function') positionPopup(menu, pointRect, { prefer: 'below', gap: 4 });
        else {
          const z = typeof _getZoom === 'function' ? _getZoom() : 1;
          menu.style.left = (pointX / z) + 'px'; menu.style.top = (pointY / z) + 'px';
          if (typeof clampPopupToViewport === 'function') clampPopupToViewport(menu);
        }
        del.focus({ preventScroll: true });
        setTimeout(() => {
          const closeCtx = (ev) => { if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener('pointerdown', closeCtx, true); document.removeEventListener('keydown', keyCtx, true); } };
          const keyCtx = (ev) => { if (ev.key === 'Escape') { ev.preventDefault(); menu.remove(); document.removeEventListener('pointerdown', closeCtx, true); document.removeEventListener('keydown', keyCtx, true); swatch.focus({ preventScroll: true }); } };
          document.addEventListener('pointerdown', closeCtx, true);
          document.addEventListener('keydown', keyCtx, true);
        }, 0);
      };
      swatch.addEventListener('contextmenu', openSwatchCtxMenu);
      if (typeof addLongPressHandler === 'function') {
        addLongPressHandler(swatch, openSwatchCtxMenu);
      }
      swatch.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          selectCustomSwatch();
        } else if (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)) {
          openSwatchCtxMenu(event);
        }
      });

      // D&D
      swatch.addEventListener('dragstart', (e) => { dragIdx = i; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', ''); swatch.style.opacity = '0.4'; });
      swatch.addEventListener('dragend', () => { dragIdx = -1; swatch.style.opacity = ''; customGrid.querySelectorAll('.gb-swatch').forEach(s => s.classList.remove('drag-over-left', 'drag-over-right')); });
      swatch.addEventListener('dragover', (e) => {
        if (dragIdx < 0 || dragIdx === i) return;
        e.preventDefault(); e.dataTransfer.dropEffect = 'move';
        const rect = swatch.getBoundingClientRect(), mid = rect.left + rect.width / 2;
        swatch.classList.toggle('drag-over-left', e.clientX < mid);
        swatch.classList.toggle('drag-over-right', e.clientX >= mid);
      });
      swatch.addEventListener('dragleave', () => swatch.classList.remove('drag-over-left', 'drag-over-right'));
      swatch.addEventListener('drop', (e) => {
        e.preventDefault(); swatch.classList.remove('drag-over-left', 'drag-over-right');
        if (dragIdx < 0 || dragIdx === i) return;
        const colors = getCustomColors();
        const selectedColor = selectedCustomIdx >= 0 && selectedCustomIdx < colors.length ? colors[selectedCustomIdx] : null;
        const item = colors.splice(dragIdx, 1)[0];
        let insertAt = e.clientX < swatch.getBoundingClientRect().left + swatch.getBoundingClientRect().width / 2 ? i : i + 1;
        if (dragIdx < i) insertAt--;
        colors.splice(insertAt, 0, item);
        _saveCustomColors(colors);
        if (selectedCustomIdx === dragIdx) selectedCustomIdx = insertAt;
        else if (selectedColor) selectedCustomIdx = colors.indexOf(selectedColor);
        dragIdx = -1; renderCustomGrid(); updateSwatchHighlights();
      });

      customGrid.appendChild(swatch);
    });
  }
  renderCustomGrid();

  // --- スライダー（色相/彩度/明度）---
  const sliderSection = document.createElement('div');
  sliderSection.className = 'gb-palette-sliders';

  function makeSlider(labelText, min, max, value, onChange) {
    const row = document.createElement('div'); row.className = 'gb-palette-slider-row';
    const lbl = document.createElement('label'); lbl.textContent = labelText;
    const sliderKey = ({ '色相': 'hue', '彩度': 'saturation', '明度': 'brightness' }[labelText] || labelText).toString();
    const slider = document.createElement('input');
    slider.type = 'range'; slider.min = String(min); slider.max = String(max); slider.value = String(value);
    slider.dataset.e2eId = `color-palette-${sliderKey}-range`;
    slider.setAttribute('aria-label', `${labelText}を調整`);
    const valInput = document.createElement('input');
    valInput.type = 'number'; valInput.className = 'gb-slider-val';
    valInput.min = String(min); valInput.max = String(max); valInput.value = String(value);
    valInput.dataset.e2eId = `color-palette-${sliderKey}-value`;
    valInput.setAttribute('aria-label', `${labelText}の数値`);
    slider.addEventListener('input', () => { valInput.value = slider.value; onChange(parseInt(slider.value)); });
    valInput.addEventListener('change', () => {
      let v = parseInt(valInput.value) || 0;
      v = Math.max(min, Math.min(max, v));
      valInput.value = v; slider.value = v; globalThis.GBUI?.refreshRangeFill?.(slider); onChange(v);
    });
    row.append(lbl, slider, valInput);
    return { row, slider, valInput };
  }

  // --- ピッカー行（スライダーの上）---
  const pickerRow = document.createElement('div');
  pickerRow.className = 'gb-palette-picker-row';
  const picker = document.createElement('input');
  picker.type = 'color'; picker.value = selectedHex; picker.title = 'カラーピッカー';
  picker.dataset.e2eId = 'color-palette-picker';
  picker.setAttribute('aria-label', 'カラーピッカー');
  const onPickerChange = () => {
    hsb = _hexToHsb(picker.value);
    selectedIsTransparent = false; selectedCustomIdx = -1; selectedPresetIdx = -1;
    selectedOsAccentTone = '';
    updateSliders(); updateSwatchHighlights();
    applyLive();
  };
  picker.addEventListener('input', onPickerChange);
  picker.addEventListener('change', onPickerChange);

  const saveBtn = document.createElement('button');
  saveBtn.className = 'gb-btn-save';
  saveBtn.dataset.e2eId = 'color-palette-custom-add';
  saveBtn.innerHTML = typeof lucide === 'function' ? lucide('plus', 14) : '+';
  saveBtn.title = 'カスタムカラーに追加（選択中のカスタム色があれば上書き）';
  saveBtn.setAttribute('aria-label', 'カスタムカラーに追加');
  saveBtn.addEventListener('click', () => {
    const hex = selectedIsTransparent ? 'transparent' : currentHex();
    const customs = getCustomColors();
    if (selectedCustomIdx >= 0 && selectedCustomIdx < customs.length) {
      customs[selectedCustomIdx] = hex; _saveCustomColors(customs);
    } else {
      saveCustomColor(hex);
      const nextCustoms = getCustomColors();
      selectedCustomIdx = nextCustoms.findIndex(c => c.toLowerCase() === hex.toLowerCase());
    }
    selectedPresetIdx = -1;
    renderCustomGrid(); updateSwatchHighlights();
  });

  const eyedropBtn = document.createElement('button');
  eyedropBtn.className = 'gb-btn-eyedropper';
  eyedropBtn.dataset.e2eId = 'color-palette-eyedropper';
  eyedropBtn.type = 'button';
  eyedropBtn.title = '画面上から色を拾う';
  eyedropBtn.setAttribute('aria-label', '画面上から色を拾う');
  eyedropBtn.innerHTML = typeof lucide === 'function' ? lucide('pipette', 14) : '💧';
  const eyedropperSupported = typeof window !== 'undefined' && typeof window.EyeDropper === 'function';
  if (!eyedropperSupported) {
    eyedropBtn.disabled = true;
    eyedropBtn.title = 'このブラウザはカラーピッカーAPIに対応していません';
  }
  eyedropBtn.addEventListener('click', async () => {
    if (!eyedropperSupported) return;
    try {
      const ed = new window.EyeDropper();
      const result = await ed.open();
      const pickedHex = parseColorToHexAlpha(result?.sRGBHex).hex;
