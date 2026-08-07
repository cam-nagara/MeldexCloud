/* gb-scriptnote-file-style-contract.js: シナリオのファイルスタイル契約（依存なし） */
(function (global) {
  'use strict';

  const KEYS = Object.freeze([
    'borderColor', 'borderWidth', 'baseTextColor', 'baseTextBold', 'baseTextItalic',
    'baseTextFontFamily', 'baseTextFontSize', 'baseTextLineHeight', 'baseTextLetterSpacing',
    'baseTextLineHeightH', 'baseTextLineHeightV', 'baseTextLetterSpacingH', 'baseTextLetterSpacingV',
    'rubyFontSize', 'rubyOffset', 'spreadBorderColor', 'spreadBorderWidth', 'wrapMode',
    'hoverBgColor', 'caretColor', 'caretWidth', 'dragSelectColor', 'selectionColor',
    'selectionTextColor', 'dropIndicatorColor', 'dropIndicatorWidth', 'themeId',
    '__themeName', '__themeSourceId', '__useOsAccentColor',
    '--theme-palette-0', '--theme-palette-1', '--theme-palette-2', '--theme-palette-3',
    '--theme-palette-4', '--theme-palette-5', '--theme-palette-6', '--theme-palette-7',
    '--theme-palette-8', '--theme-palette-9',
  ]);
  const DEFAULTS = Object.freeze({ wrapMode: true });

  function isKey(key) {
    const value = String(key || '').trim();
    return KEYS.includes(value) || value.startsWith('--') || /^__[A-Za-z0-9_-]+$/.test(value);
  }

  function filter(style) {
    if (!style || typeof style !== 'object' || Array.isArray(style)) return {};
    const next = {};
    Object.entries(style).forEach(([key, value]) => {
      if (!isKey(key) || value === undefined || value === null || value === '') return;
      next[key] = value;
    });
    return next;
  }

  global.MeldexScriptnoteFileStyleContract = Object.freeze({
    keys: KEYS,
    defaults: DEFAULTS,
    isKey,
    filter,
  });
})(typeof window !== 'undefined' ? window : globalThis);
