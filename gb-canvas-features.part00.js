/* gb-canvas-features.part00.js: board theme color helpers */
(function (global) {
  'use strict';

  const FALLBACK_THEME_COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899'];

  function readableTextColor(bgColor) {
    const hex = typeof bgColor === 'string' && bgColor.match(/^#([0-9a-f]{6})$/i) ? bgColor : '';
    if (!hex) return '';
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return (r * 0.299 + g * 0.587 + b * 0.114) > 150 ? '#1e1e1e' : '#ffffff';
  }

  // --- 役割色の塗り方（初期搭載スタイル用） ---
  // テーマ色セットのどの色を使うか（_themeColorIndex）に加え、塗り方（_themeTone）で
  // 「塗りつぶし / 淡い色 / 枠だけ / 枠なし」を表す。淡い色はボード背景の明暗に合わせて作る。
  function parseColor(value) {
    const raw = String(value || '').trim();
    let m = raw.match(/^#([0-9a-f]{3})$/i);
    if (m) return m[1].split('').map(ch => parseInt(ch + ch, 16));
    m = raw.match(/^#([0-9a-f]{6})(?:[0-9a-f]{2})?$/i);
    if (m) return [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16));
    m = raw.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i);
    if (m) return [1, 2, 3].map(i => Math.max(0, Math.min(255, Math.round(+m[i]))));
    return null;
  }

  function toHex(rgb) {
    return '#' + rgb.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
  }

  function mixColor(color, base, ratioToBase) {
    const a = parseColor(color);
    const b = parseColor(base);
    if (!a || !b) return color || '';
    const t = Math.max(0, Math.min(1, ratioToBase));
    return toHex(a.map((v, i) => v * (1 - t) + b[i] * t));
  }

  function boardBackgroundColor() {
    let bg = '';
    try { if (typeof global._bdBoardThemeBackgroundColor === 'function') bg = global._bdBoardThemeBackgroundColor(); } catch (_) { bg = ''; }
    if (!parseColor(bg) && typeof global.getCssVar === 'function') bg = global.getCssVar('--bd-bg') || global.getCssVar('--bg') || '';
    return parseColor(bg) ? bg : '';
  }

  function isDarkColor(color) {
    const rgb = parseColor(color);
    if (!rgb) return false;
    return (rgb[0] * 0.299 + rgb[1] * 0.587 + rgb[2] * 0.114) < 128;
  }

  function themeTone(color, tone, options = {}) {
    const bg = options.background || boardBackgroundColor();
    const dark = options.dark != null ? !!options.dark : isDarkColor(bg);
    const base = parseColor(bg) ? bg : (dark ? '#111419' : '#ffffff');
    const ink = dark ? '#e5e7eb' : '#1f2937';
    switch (tone) {
      case 'tint':
        return { bgColor: dark ? mixColor(color, base, 0.72) : mixColor(color, '#ffffff', 0.84), borderColor: color, textColor: ink, lineColor: color };
      case 'outline':
        return { bgColor: dark ? mixColor(color, base, 0.9) : '#ffffff', borderColor: color, textColor: ink, lineColor: color };
      case 'plain':
        return { bgColor: 'transparent', borderColor: 'transparent', textColor: '', lineColor: color };
      case 'muted':
        return { bgColor: mixColor(color, base, 0.6), borderColor: mixColor(color, base, 0.45), textColor: ink, lineColor: mixColor(color, base, 0.45) };
      default:
        return { bgColor: color, borderColor: color, textColor: readableTextColor(color) || ink, lineColor: color };
    }
  }

  // 役割色: 0赤 1橙 2黄 3緑 4水 5青 6紫 7桃 の色相を、テーマ色セットの中から最も近い色で解決する。
  // テーマごとに色の並び順が違うため、位置（palette[index]）で選ぶと「課題＝赤」等の意味が崩れる。
  const ROLE_HUES = [2, 30, 50, 130, 185, 215, 270, 325];

  function hueSat(color) {
    const rgb = parseColor(color);
    if (!rgb) return null;
    const [r, g, b] = rgb.map(v => v / 255);
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const d = max - min;
    const l = (max + min) / 2;
    const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
    let h = 0;
    if (d) {
      if (max === r) h = 60 * (((g - b) / d) % 6);
      else if (max === g) h = 60 * ((b - r) / d + 2);
      else h = 60 * ((r - g) / d + 4);
    }
    return { h: (h + 360) % 360, s };
  }

  function themeRoleColor(index, palette) {
    const colors = Array.isArray(palette) && palette.length ? palette : FALLBACK_THEME_COLORS;
    const target = ROLE_HUES[Math.abs(Math.floor(+index || 0)) % ROLE_HUES.length];
    let best = '';
    let bestScore = Infinity;
    colors.forEach(color => {
      const hs = hueSat(color);
      if (!hs) return;
      const diff = Math.abs(hs.h - target);
      const score = Math.min(diff, 360 - diff) + (hs.s < 0.18 ? 400 : 0);
      if (score < bestScore) { bestScore = score; best = color; }
    });
    return best || colors[Math.abs(Math.floor(+index || 0)) % colors.length] || '#3b82f6';
  }

  function getThemeColorSet(board) {
    if (global.MeldexThemeManager && typeof global.MeldexThemeManager.getBoardThemeColorSet === 'function') {
      const palette = global.MeldexThemeManager.getBoardThemeColorSet(board);
      if (Array.isArray(palette) && palette.length) return palette;
    }
    return FALLBACK_THEME_COLORS.slice();
  }

  function buildDefaultDepthStyles(baseStyles, emptyDepthLine, board) {
    const palette = getThemeColorSet(board);
    const emptyLine = typeof emptyDepthLine === 'function' ? emptyDepthLine : () => ({});
    return (Array.isArray(baseStyles) ? baseStyles : []).map((style, index) => {
      const rawValue = style && style._themeColorIndex;
      const rawThemeIndex = Number.isFinite(+rawValue) ? +rawValue : index;
      const themeIndex = Math.max(0, Math.floor(rawThemeIndex));
      const color = (style._themeTone ? themeRoleColor(themeIndex, palette) : palette[themeIndex % palette.length]) || style.bgColor || '';
      const line = style?.line && typeof style.line === 'object' ? { ...style.line } : {};
      const toned = themeTone(color, style._themeTone || 'solid');
      const lineIndex = Number.isFinite(+line._themeColorIndex) ? Math.max(0, Math.floor(+line._themeColorIndex)) : themeIndex;
      const lineBase = (style._themeTone ? themeRoleColor(lineIndex, palette) : palette[lineIndex % palette.length]) || color;
      const lineColor = themeTone(lineBase, line._themeTone || 'solid').lineColor || line.color || '';
      delete line._themeColorIndex;
      delete line._themeTone;
      const next = {
        ...style,
        bgColor: toned.bgColor,
        textColor: toned.textColor || style.textColor || '',
        borderColor: toned.borderColor,
        line: { ...emptyLine(), ...line, color: lineColor },
      };
      delete next._themeTone;
      return next;
    });
  }

  function parentChildHighlightPalette() {
    return getThemeColorSet(typeof bd !== 'undefined' ? bd : undefined);
  }

  function parentChildGroups(options = {}) {
    if (typeof bd === 'undefined' || !Array.isArray(bd.nodes)) return new Map();
    const palette = parentChildHighlightPalette();
    if (!palette.length) return new Map();
    const hiddenIds = options.hiddenIds instanceof Set ? options.hiddenIds : new Set();
    const drillRoot = options.drillRoot || '';
    const drillScope = new Set();
    if (drillRoot) {
      drillScope.add(drillRoot);
      if (typeof bdDescendants === 'function') bdDescendants(drillRoot).forEach(id => drillScope.add(id));
    }
    const isVisible = node => node && !hiddenIds.has(node.id) && (!drillRoot || drillScope.has(node.id));
    const rootOf = node => {
      let cur = node;
      let guard = 0;
      const guardLimit = Math.max(50, bd.nodes.length + 1);
      const seen = new Set();
      while (cur?.parent && guard < guardLimit) {
        if (seen.has(cur.id)) break;
        seen.add(cur.id);
        const parent = bd.nodes.find(v => v.id === cur.parent);
        if (!parent) break;
        cur = parent;
        guard += 1;
      }
      return cur?.id || '';
    };
    const groups = new Map();
    bd.nodes.forEach(node => {
      if (!isVisible(node)) return;
      const rootId = rootOf(node);
      if (!rootId) return;
      if (!groups.has(rootId)) groups.set(rootId, []);
      groups.get(rootId).push(node.id);
    });
    const result = new Map();
    [...groups.keys()].filter(rootId => (groups.get(rootId) || []).length >= 2).sort().forEach((rootId, index) => {
      const color = palette[index % palette.length];
      groups.get(rootId).forEach(id => result.set(id, color));
    });
    return result;
  }

  function normalizeConnectionArrow(conn) {
    const rawArrow = conn && Object.prototype.hasOwnProperty.call(conn, 'arrow')
      ? conn.arrow
      : (typeof global.bdGetConnectionStyle === 'function' ? global.bdGetConnectionStyle(conn)?.arrow : conn?.arrow);
    if (rawArrow === true) return 'end';
    if (rawArrow === 'end' || rawArrow === 'start' || rawArrow === 'both') return rawArrow;
    return '';
  }

  function defaultStructureArrow(structure) {
    return structure === 'flowchart' ? 'end' : '';
  }

  function createStructureConnection(fromId, toId, structure) {
    const arrow = defaultStructureArrow(structure);
    if (typeof global.bdCreateConnectionWithStyle === 'function') {
      return global.bdCreateConnectionWithStyle(fromId, toId, { arrow });
    }
    return {
      id: typeof global.bdId === 'function' ? global.bdId() : '',
      from: fromId || '',
      to: toId || '',
      label: '',
      style: '',
      arrow,
    };
  }

  function pickFallbackLinkifyRoot(selectedIds) {
    const indeg = new Map();
    selectedIds.forEach(id => indeg.set(id, 0));
    (bd.connections || []).forEach(conn => {
      if (!selectedIds.has(conn.from) || !selectedIds.has(conn.to)) return;
      const arrow = normalizeConnectionArrow(conn);
      if (arrow === 'end') indeg.set(conn.to, (indeg.get(conn.to) || 0) + 1);
      else if (arrow === 'start') indeg.set(conn.from, (indeg.get(conn.from) || 0) + 1);
    });
    const zeroIn = [...selectedIds].filter(id => (indeg.get(id) || 0) === 0);
    if (zeroIn.length === 1) return zeroIn[0];
    if (bd._activeNode && selectedIds.has(bd._activeNode)) return bd._activeNode;
    return [...selectedIds][0] || '';
  }

  async function linkifySelectionToTree(rootId) {
    if (typeof bd === 'undefined' || !bd.selected || bd.selected.size < 2) {
      showStatus('2枚以上選択してください', true);
      return { assigned: 0, unreachable: 0, skippedContained: 0, skippedUser: false };
    }
    const selectedIds = new Set([...bd.selected]);
    const containedIds = new Set([...selectedIds].filter(id => !!bd.nodes.find(v => v.id === id)?.contained));
    const eligibleIds = new Set([...selectedIds].filter(id => !containedIds.has(id)));
    if (eligibleIds.size < 2) {
    showStatus('内包トピックはラインから親子化の対象外です', true);
      return { assigned: 0, unreachable: 0, skippedContained: containedIds.size, skippedUser: false };
    }
    if (!eligibleIds.has(rootId)) rootId = pickFallbackLinkifyRoot(eligibleIds);
    if (!rootId) {
      showStatus('ルート候補が見つかりません', true);
      return { assigned: 0, unreachable: 0, skippedContained: containedIds.size, skippedUser: false };
    }
    const hasExistingParent = [...eligibleIds].some(id => {
      const node = bd.nodes.find(v => v.id === id);
      return !!(node && node.parent);
    });
    if (hasExistingParent) {
    const ok = await cfConfirm('選択内に既に親子関係が設定されているトピックがあります。ラインに基づき上書きしますか？');
      if (!ok) return { assigned: 0, unreachable: 0, skippedContained: 0, skippedUser: true };
    }
    const adjacency = new Map();
    eligibleIds.forEach(id => adjacency.set(id, []));
    (bd.connections || []).forEach(conn => {
      if (!eligibleIds.has(conn.from) || !eligibleIds.has(conn.to)) return;
      const arrow = normalizeConnectionArrow(conn);
      if (arrow === 'end' || arrow === '' || arrow === 'both') adjacency.get(conn.from)?.push(conn.to);
      if (arrow === 'start' || arrow === '' || arrow === 'both') adjacency.get(conn.to)?.push(conn.from);
    });
    if (![...adjacency.values()].some(list => list.length > 0)) {
      showStatus('選択内にラインがないため親子化できませんでした', true);
      return { assigned: 0, unreachable: eligibleIds.size - 1, skippedContained: containedIds.size, skippedUser: false };
    }

    bdPushUndo();
    eligibleIds.forEach(id => {
      const node = bd.nodes.find(v => v.id === id);
      if (node) node.parent = '';
    });
    const visited = new Set([rootId]);
    const queue = [rootId];
    let assigned = 0;
    let skippedContained = containedIds.size;
    while (queue.length) {
      const current = queue.shift();
      (adjacency.get(current) || []).forEach(next => {
        if (visited.has(next)) return;
        const node = bd.nodes.find(v => v.id === next);
        if (!node) return;
        visited.add(next);
        node.parent = current;
        assigned += 1;
        queue.push(next);
      });
    }
    const unreachable = Math.max(0, eligibleIds.size - visited.size);
    const hasConnEitherWay = (a, b) => (bd.connections || []).some(conn =>
      (conn.from === a && conn.to === b) || (conn.from === b && conn.to === a));
    visited.forEach(id => {
      const node = bd.nodes.find(v => v.id === id);
      if (!node?.parent) return;
      if (hasConnEitherWay(node.parent, node.id)) return;
      const conn = typeof bdCreateConnectionWithStyle === 'function'
        ? bdCreateConnectionWithStyle(node.parent, node.id, { arrow: '' })
        : { from: node.parent, to: node.id, arrow: '', label: '', style: '' };
      bd.connections.push(conn);
    });
    // ツリーに構造があれば整列 (ルートまたは中間カードいずれかに設定あり)
    const hasAnyStructure = [...visited].some(id => {
      const node = bd.nodes.find(v => v.id === id);
      if (!node) return false;
      if (node.structure) return true;
      return typeof bdStructureOf === 'function' && !!bdStructureOf(id);
    });
    if (bd.autoAlign !== false && hasAnyStructure && typeof bdRequestAutoLayout === 'function') bdRequestAutoLayout(rootId);
    else if (bd.autoAlign !== false && hasAnyStructure && typeof bdAutoLayout === 'function') bdAutoLayout(rootId);
    bdRender();
    bdDirty();
    if (assigned === 0) {
      showStatus('選択内にラインがないため親子化できませんでした', true);
    } else {
  const parts = [`親子化: ${assigned} 件のトピックに親を設定しました`];
      if (unreachable) parts.push(`到達不能 ${unreachable} 件`);
  if (skippedContained) parts.push(`内包トピックスキップ ${skippedContained} 件`);
      showStatus(parts.join(' / '));
    }
    return { assigned, unreachable, skippedContained, skippedUser: false };
  }

  global.bdGetThemeColorSet = getThemeColorSet;
  global.bdReadableTextColor = readableTextColor;
  global.bdThemeTone = themeTone;
  global.bdThemeRoleColor = themeRoleColor;
  global.bdMixColor = mixColor;
  global.bdBuildDefaultDepthStyles = buildDefaultDepthStyles;
  global.bdDefaultStructureArrow = defaultStructureArrow;
  global.bdCreateStructureConnection = createStructureConnection;
  global._bdParentChildGroups = parentChildGroups;
  global.bdLinkifySelectionToTree = linkifySelectionToTree;
})(window);
