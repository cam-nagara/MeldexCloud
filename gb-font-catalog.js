/* gb-font-catalog.js: Meldex 全体で共有する OS フォント一覧 */
(function (global) {
  'use strict';

  const PRESET_FONTS = Object.freeze([
    { name: 'Noto Sans JP（デフォルト・同梱）', family: '' },
    { name: 'Segoe UI', family: "'Segoe UI', sans-serif" },
    { name: 'Yu Gothic UI', family: "'Yu Gothic UI', sans-serif" },
    { name: 'Meiryo', family: "'Meiryo', sans-serif" },
    { name: 'Noto Sans JP', family: "'Noto Sans JP', sans-serif" },
  ]);
  const FALLBACK_CANDIDATES = Object.freeze([
    'Hiragino Kaku Gothic ProN', 'Hiragino Kaku Gothic Pro', 'Hiragino Sans',
    'Hiragino Maru Gothic ProN', 'Hiragino Mincho ProN', 'Helvetica Neue', 'Helvetica',
    'Avenir Next', 'Avenir', 'Optima', 'Palatino', 'Menlo', 'Monaco', 'Meiryo UI',
    'MS PGothic', 'MS Gothic', 'MS PMincho', 'MS Mincho', 'Yu Mincho', 'BIZ UDGothic',
    'BIZ UDPGothic', 'BIZ UDMincho', 'BIZ UDPMincho', 'UD デジタル 教科書体 N-R',
    'Consolas', 'Calibri', 'Cambria', 'Roboto', 'Noto Sans CJK JP', 'Noto Serif CJK JP',
    'Noto Serif JP', 'Droid Sans', 'Droid Serif', 'Arial', 'Arial Black', 'Verdana',
    'Tahoma', 'Trebuchet MS', 'Times New Roman', 'Times', 'Georgia', 'Garamond',
    'Courier New', 'Courier', 'Impact',
  ]);
  const _families = new Map();
  let _fontDetectionCtx = null;
  let _localFetchStarted = false;
  let _localFontAccessStarted = false;

  function normalizeFontFamilyValue(value) {
    const raw = String(value == null ? '' : value).trim();
    if (!raw) return '';
    const lower = raw.toLowerCase();
    if (['inherit', 'initial', 'unset', 'revert', 'revert-layer'].includes(lower)) return '';
    if (/[<>{};\\]/.test(raw)) return '';
    return raw;
  }

  function _escapeHtml(value) {
    if (typeof global.esc === 'function') return global.esc(value);
    return String(value).replace(/[&<>"']/g, char => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[char]));
  }

  function _cssFamily(name) {
    const safe = String(name || '').trim();
    return safe ? `${JSON.stringify(safe)}, sans-serif` : '';
  }

  function _addFamilies(values) {
    let changed = false;
    (Array.isArray(values) ? values : []).forEach(value => {
      const name = String(value || '').trim();
      if (!name || name.startsWith('@') || name.length > 200) return;
      const key = name.toLocaleLowerCase();
      if (_families.has(key)) return;
      _families.set(key, name);
      changed = true;
    });
    if (changed) global.dispatchEvent?.(new CustomEvent('meldex:font-catalog-updated'));
    return changed;
  }

  function _isFontInstalled(name) {
    if (!_fontDetectionCtx) {
      try { _fontDetectionCtx = document.createElement('canvas').getContext('2d'); } catch { return false; }
    }
    if (!_fontDetectionCtx) return false;
    const text = 'mmmmmmmmmmlli1I0Oあいうえお日本語サンプル';
    for (const base of ['monospace', 'sans-serif', 'serif']) {
      _fontDetectionCtx.font = `72px ${base}`;
      const baseWidth = _fontDetectionCtx.measureText(text).width;
      _fontDetectionCtx.font = `72px ${JSON.stringify(name)}, ${base}`;
      if (Math.abs(_fontDetectionCtx.measureText(text).width - baseWidth) > 0.01) return true;
    }
    return false;
  }

  function _loadDetectedFallbacks() {
    _addFamilies(FALLBACK_CANDIDATES.filter(name => {
      try { return _isFontInstalled(name); } catch { return false; }
    }));
  }

  async function _loadLocalApiFonts() {
    if (_localFetchStarted) return;
    _localFetchStarted = true;
    const host = String(global.location?.hostname || '').toLowerCase();
    if (!['127.0.0.1', 'localhost', '::1'].includes(host)) return;
    try {
      const response = await fetch('/api/system-fonts', { cache: 'no-store' });
      if (!response.ok) return;
      const payload = await response.json();
      _addFamilies(payload?.families);
    } catch {
      // Cloud/PWA や停止中のローカルサーバーでは利用できないため、候補検出へフォールバックする。
    }
  }

  async function requestLocalFontAccess() {
    if (_localFontAccessStarted || typeof global.queryLocalFonts !== 'function') return;
    _localFontAccessStarted = true;
    try {
      const fonts = await global.queryLocalFonts();
      _addFamilies(fonts.map(font => font?.family));
    } catch {
      // 権限拒否は正常な選択肢。次のユーザー操作で再試行できる状態へ戻す。
      _localFontAccessStarted = false;
    }
  }

  function _ensureCatalogRefresh() {
    void _loadLocalApiFonts();
    if (global.navigator?.userActivation?.isActive) void requestLocalFontAccess();
  }

  function getDetectedSystemFonts() {
    _ensureCatalogRefresh();
    return [..._families.values()]
      .sort((a, b) => a.localeCompare(b, 'ja'))
      .map(name => ({ name, family: _cssFamily(name) }));
  }

  function getFontFamilyOptionItems() {
    const seen = new Set();
    const items = [{ v: '', l: '共通フォント', style: 'font-family:inherit;' }];
    PRESET_FONTS.filter(item => item.family).forEach(item => {
      if (seen.has(item.family)) return;
      seen.add(item.family);
      items.push({ v: item.family, l: item.name, style: `font-family:${item.family};` });
    });
    getDetectedSystemFonts().forEach(item => {
      if (seen.has(item.family)) return;
      seen.add(item.family);
      items.push({ v: item.family, l: item.name, style: `font-family:${item.family};`, group: 'システムフォント' });
    });
    return items;
  }

  function getFontFamilyOptions(currentValue) {
    const current = normalizeFontFamilyValue(currentValue);
    let output = '';
    let group = null;
    const items = getFontFamilyOptionItems();
    items.forEach(item => {
      const nextGroup = item.group || null;
      if (nextGroup !== group) {
        if (group) output += '</optgroup>';
        if (nextGroup) output += `<optgroup label="${_escapeHtml(nextGroup)}">`;
        group = nextGroup;
      }
      output += `<option value="${_escapeHtml(item.v)}" style="${_escapeHtml(item.style)}"${item.v === current ? ' selected' : ''}>${_escapeHtml(item.l)}</option>`;
    });
    if (group) output += '</optgroup>';
    if (current && !items.some(item => item.v === current)) {
      output += `<option value="${_escapeHtml(current)}" style="font-family:${_escapeHtml(current)};" selected>${_escapeHtml(current)}（現在の設定）</option>`;
    }
    return output;
  }

  function getUIFontOptions() {
    const current = document.documentElement.style.getPropertyValue('--ui-font') || '';
    const preset = PRESET_FONTS.map(item => `<option value="${_escapeHtml(item.family)}" style="font-family:${item.family || 'inherit'};"${item.family === current ? ' selected' : ''}>${_escapeHtml(item.name)}</option>`).join('');
    const system = getDetectedSystemFonts();
    const systemHtml = system.length
      ? `<optgroup label="システムフォント">${system.map(item => `<option value="${_escapeHtml(item.family)}" style="font-family:${_escapeHtml(item.family)};"${item.family === current ? ' selected' : ''}>${_escapeHtml(item.name)}</option>`).join('')}</optgroup>`
      : '';
    const known = PRESET_FONTS.some(item => item.family === current) || system.some(item => item.family === current);
    const currentHtml = current && !known
      ? `<option value="${_escapeHtml(current)}" style="font-family:${_escapeHtml(current)};" selected>${_escapeHtml(current)}（現在の設定）</option>`
      : '';
    return preset + systemHtml + currentHtml;
  }

  _loadDetectedFallbacks();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _loadLocalApiFonts, { once: true });
  } else {
    void _loadLocalApiFonts();
  }

  global.MeldexFontCatalog = Object.freeze({ getFamilies: () => [..._families.values()], refresh: requestLocalFontAccess });
  global.getDetectedSystemFonts = getDetectedSystemFonts;
  global.getFontFamilyOptionItems = getFontFamilyOptionItems;
  global.getFontFamilyOptions = getFontFamilyOptions;
  global.getUIFontOptions = getUIFontOptions;
  global.normalizeFontFamilyValue = normalizeFontFamilyValue;
  global.loadGoogleFontForUI = function () {};
})(window);
