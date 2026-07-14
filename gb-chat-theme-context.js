/* Chat theme context for LLM/CLI generation prompts. */
(function(global) {
  'use strict';

  const CHAT_THEME_CONTEXT_COLOR_LIMIT = 12;

  function _chatThemeNormalizeHex(value) {
    if (typeof value !== 'string') return '';
    const raw = value.trim();
    const short = raw.match(/^#([0-9a-f]{3})$/i);
    if (short) return '#' + short[1].split('').map(ch => ch + ch).join('').toLowerCase();
    const full = raw.match(/^#([0-9a-f]{6}|[0-9a-f]{8})$/i);
    return full ? ('#' + full[1].toLowerCase()) : '';
  }

  function _chatThemePaletteFrom(value) {
    const src = Array.isArray(value) ? value : [];
    const out = [];
    const seen = new Set();
    for (const item of src) {
      const color = _chatThemeNormalizeHex(item);
      if (!color || seen.has(color)) continue;
      seen.add(color);
      out.push(color);
      if (out.length >= CHAT_THEME_CONTEXT_COLOR_LIMIT) break;
    }
    return out;
  }

  function _chatThemePaletteFromCss() {
    const styles = global.getComputedStyle?.(global.document?.documentElement);
    if (!styles) return [];
    const colors = [];
    for (let i = 0; i < CHAT_THEME_CONTEXT_COLOR_LIMIT; i += 1) {
      colors.push(styles.getPropertyValue(`--theme-palette-${i}`));
    }
    return _chatThemePaletteFrom(colors);
  }

  function _chatThemeArraysEqual(a, b) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((value, index) => value === b[index]);
  }

  function _chatThemeManagerPalette(manager, themeDef, options) {
    if (!manager || typeof manager.getThemeColorSet !== 'function') return [];
    try {
      return _chatThemePaletteFrom(manager.getThemeColorSet(themeDef || null, options || {}));
    } catch {
      return [];
    }
  }

  function _chatCurrentBoardState() {
    const board = global.bd || global.currentBoard || null;
    return board && typeof board === 'object' ? board : null;
  }

  function chatThemeContextSettings() {
    const manager = global.MeldexThemeManager || null;
    const themeId = typeof manager?.getDefaultThemeId === 'function' ? String(manager.getDefaultThemeId() || '') : '';
    const themeDef = themeId && typeof manager?.getThemeById === 'function' ? manager.getThemeById(themeId) : null;
    const basePalette = _chatThemeManagerPalette(manager, themeDef, { ignoreOsAccent: true });
    const activePalette = _chatThemeManagerPalette(manager, null, {});
    const cssPalette = _chatThemePaletteFromCss();
    const palette = activePalette.length ? activePalette : (basePalette.length ? basePalette : cssPalette);
    const context = {
      theme_id: themeId,
      theme_name: String(themeDef?.name || themeId || ''),
      palette,
    };
    if (basePalette.length && palette.length && !_chatThemeArraysEqual(basePalette, palette)) {
      context.base_palette = basePalette;
    }
    const board = _chatCurrentBoardState();
    if (board && typeof manager?.getBoardThemeColorSet === 'function') {
      let boardPalette = [];
      try {
        boardPalette = _chatThemePaletteFrom(manager.getBoardThemeColorSet(board));
      } catch {
        boardPalette = [];
      }
      if (boardPalette.length) context.board_palette = boardPalette;
      if (board.themeId) context.board_theme_id = String(board.themeId);
    }
    return context;
  }

  global.chatThemeContextSettings = chatThemeContextSettings;
})(window);
