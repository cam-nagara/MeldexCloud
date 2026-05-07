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
      const color = palette[themeIndex % palette.length] || style.bgColor || '';
      const line = style?.line && typeof style.line === 'object' ? style.line : {};
      return {
        ...style,
        bgColor: color,
        textColor: readableTextColor(color) || style.textColor || '',
        borderColor: color,
        line: { ...emptyLine(), ...line, color: color || line.color || '' },
      };
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
      const seen = new Set();
      while (cur?.parent && guard < 50) {
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
    if (conn?.arrow === true) return 'end';
    if (conn?.arrow === 'end' || conn?.arrow === 'start' || conn?.arrow === 'both') return conn.arrow;
    return '';
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
      showStatus('内包カードはラインから親子化の対象外です', true);
      return { assigned: 0, unreachable: 0, skippedContained: containedIds.size, skippedUser: false };
    }
    if (!eligibleIds.has(rootId)) rootId = pickFallbackLinkifyRoot(eligibleIds);
    if (!rootId) {
      showStatus('ルート候補が見つかりません', true);
      return { assigned: 0, unreachable: 0, skippedContained: containedIds.size, skippedUser: false };
    }
    const hasExistingParent = [...eligibleIds].some(id => {
      if (id === rootId) return false;
      const node = bd.nodes.find(v => v.id === id);
      return !!(node && node.parent);
    });
    if (hasExistingParent) {
      const ok = await cfConfirm('選択内に既に親子関係が設定されているカードがあります。ラインに基づき上書きしますか？');
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
    const rootNode = bd.nodes.find(v => v.id === rootId);
    if (rootNode) rootNode.parent = '';
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
    const hasAnyStructure = rootNode?.structure
      || (Array.isArray(bd.nodes) && bd.nodes.some(n => n.structure && (bdRoot(n.id)?.id === rootId)));
    if (hasAnyStructure && typeof bdAutoLayout === 'function') bdAutoLayout(rootId);
    bdRender();
    bdDirty();
    if (assigned === 0) {
      showStatus('選択内にラインがないため親子化できませんでした', true);
    } else {
      const parts = [`親子化: ${assigned} 件のカードに親を設定しました`];
      if (unreachable) parts.push(`到達不能 ${unreachable} 件`);
      if (skippedContained) parts.push(`内包カードスキップ ${skippedContained} 件`);
      showStatus(parts.join(' / '));
    }
    return { assigned, unreachable, skippedContained, skippedUser: false };
  }

  global.bdGetThemeColorSet = getThemeColorSet;
  global.bdReadableTextColor = readableTextColor;
  global.bdBuildDefaultDepthStyles = buildDefaultDepthStyles;
  global._bdParentChildGroups = parentChildGroups;
  global.bdLinkifySelectionToTree = linkifySelectionToTree;
})(window);
