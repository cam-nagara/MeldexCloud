/* gb-theme-coloring-rule.js: board theme coloring rule engine */
(function (global) {
  'use strict';

  const FALLBACK_PALETTE = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899'];

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function normalizeHex(color) {
    if (typeof color !== 'string') return '';
    const raw = color.trim();
    const short = raw.match(/^#([0-9a-f]{3})$/i);
    if (short) {
      return '#' + short[1].split('').map(ch => ch + ch).join('').toLowerCase();
    }
    const full = raw.match(/^#([0-9a-f]{6})$/i);
    return full ? ('#' + full[1].toLowerCase()) : '';
  }

  function hexToRgb(color) {
    const hex = normalizeHex(color);
    if (!hex) return null;
    return {
      r: parseInt(hex.slice(1, 3), 16),
      g: parseInt(hex.slice(3, 5), 16),
      b: parseInt(hex.slice(5, 7), 16),
    };
  }

  function rgbToHex(r, g, b) {
    return '#' + [r, g, b].map(v => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('');
  }

  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0, s = 0;
    const l = (max + min) / 2;
    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      switch (max) {
        case r: h = (g - b) / d + (g < b ? 6 : 0); break;
        case g: h = (b - r) / d + 2; break;
        default: h = (r - g) / d + 4; break;
      }
      h /= 6;
    }
    return { h: h * 360, s, l };
  }

  function hslToRgb(h, s, l) {
    h = ((h % 360) + 360) % 360 / 360;
    s = clamp(s, 0, 1);
    l = clamp(l, 0, 1);
    if (s === 0) {
      const v = l * 255;
      return { r: v, g: v, b: v };
    }
    const hueToRgb = (p, q, t) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    return {
      r: hueToRgb(p, q, h + 1 / 3) * 255,
      g: hueToRgb(p, q, h) * 255,
      b: hueToRgb(p, q, h - 1 / 3) * 255,
    };
  }

  function withAlpha(color, alpha) {
    const rgb = hexToRgb(color);
    if (!rgb) return color || '';
    return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${clamp(alpha, 0, 1)})`;
  }

  function shiftColor(color, rule, depthOffset) {
    const rgb = hexToRgb(color);
    if (!rgb) return color;
    const hsl = rgbToHsl(rgb.r, rgb.g, rgb.b);
    const next = hslToRgb(
      hsl.h + (+rule.hueShiftStep || 0) * depthOffset,
      hsl.s,
      hsl.l + (+rule.lightnessShiftStep || 0) * depthOffset
    );
    return rgbToHex(next.r, next.g, next.b);
  }

  function getNodeDepth(board, node) {
    let depth = 0;
    let cur = node;
    const seen = new Set();
    while (cur && cur.parent && depth < 100) {
      if (seen.has(cur.id)) break;
      seen.add(cur.id);
      const parent = (board.nodes || []).find(v => v.id === cur.parent);
      if (!parent) break;
      cur = parent;
      depth += 1;
    }
    return depth;
  }

  function getAncestorAtDepth(board, node, targetDepth) {
    const chain = [];
    let cur = node;
    const seen = new Set();
    while (cur && chain.length < 100) {
      if (seen.has(cur.id)) break;
      seen.add(cur.id);
      chain.unshift(cur);
      if (!cur.parent) break;
      cur = (board.nodes || []).find(v => v.id === cur.parent);
    }
    return chain[targetDepth] || chain[chain.length - 1] || node;
  }

  function getSiblingIndex(board, node) {
    if (!node) return 0;
    const siblings = (board.nodes || [])
      .filter(v => (v.parent || '') === (node.parent || ''))
      .sort((a, b) => {
        const ay = Number.isFinite(+a.y) ? +a.y : 0;
        const by = Number.isFinite(+b.y) ? +b.y : 0;
        if (ay !== by) return ay - by;
        const ax = Number.isFinite(+a.x) ? +a.x : 0;
        const bx = Number.isFinite(+b.x) ? +b.x : 0;
        return ax - bx;
      });
    return Math.max(0, siblings.findIndex(v => v.id === node.id));
  }

  function computeNodeColor(board, node, theme) {
    const rule = theme?.board?.coloringRule;
    if (!rule || rule.enabled === false) return '';
    const themePalette = global.MeldexThemeManager?.getBoardThemeColorSet?.(board) || global.MeldexThemeManager?.getThemeColorSet?.(theme);
    const palette = Array.isArray(themePalette) && themePalette.length
      ? themePalette
      : (Array.isArray(rule.palette) && rule.palette.length ? rule.palette : FALLBACK_PALETTE);
    const startDepth = Math.max(0, +rule.startDepth || 0);
    const depth = getNodeDepth(board, node);
    if (depth < startDepth) return '';

    const basisNode = rule.siblingShift === false ? getAncestorAtDepth(board, node, 0) : getAncestorAtDepth(board, node, startDepth);
    let index = getSiblingIndex(board, basisNode);
    const depthOffset = Math.max(0, depth - startDepth);
    const depthShift = rule.depthShift || 'propagate';
    if (depthShift === 'paletteLoop') index += depthOffset;

    const baseColor = palette[index % palette.length];
    if (depthShift === 'propagate' && depthOffset > 0) {
      return withAlpha(baseColor, rule.propagateAlpha == null ? 0.55 : +rule.propagateAlpha);
    }
    if (depthShift === 'hueShift' || depthShift === 'lightnessShift') {
      return shiftColor(baseColor, rule, depthOffset);
    }
    return baseColor;
  }

  function hasOwn(obj, key) {
    return !!obj && Object.prototype.hasOwnProperty.call(obj, key);
  }

  function resolveNodeStyle(args) {
    const board = args?.board;
    const node = args?.node;
    const base = { ...(args?.baseStyle || {}) };
    if (!board || !node) return base;
    const theme = global.MeldexThemeManager?.getActiveBoardTheme?.(board);
    const boardTheme = theme?.board || {};
    const color = computeNodeColor(board, node, theme);
    const applyTo = boardTheme.coloringRule?.applyTo || 'background';

    if (!hasOwn(node, 'bgColor') && color && applyTo !== 'border') base.bgColor = color;
    else if (!hasOwn(node, 'bgColor') && !base.bgColor && boardTheme.nodeBgColor) base.bgColor = boardTheme.nodeBgColor;

    if (!hasOwn(node, 'textColor') && !base.textColor && boardTheme.nodeTextColor) base.textColor = boardTheme.nodeTextColor;

    if (!hasOwn(node, 'borderColor')) {
      if (color && (applyTo === 'border' || applyTo === 'background-border')) base.borderColor = normalizeHex(color) || color;
      else if (!base.borderColor && boardTheme.nodeBorderColor) base.borderColor = boardTheme.nodeBorderColor;
    }
    if (!hasOwn(node, 'borderWidth') && base.borderColor && (!base.borderWidth || +base.borderWidth <= 0)) {
      base.borderWidth = boardTheme.nodeBorderWidth ?? 1;
    }
    return base;
  }

  global.MeldexThemeColoring = {
    FALLBACK_PALETTE,
    computeNodeColor,
    resolveNodeStyle,
    normalizeHex,
    withAlpha,
  };
})(window);
