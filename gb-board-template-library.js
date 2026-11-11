/* gb-board-template-library.js: ボードの初期搭載テンプレート・グループスタイル・サムネイル。
 *
 * テンプレートはボード1枚分の「見た目一式＋トピックの構造」を表す。
 *   style:   { depthPresetId | depthStyles, cardStyles?, lineStyles?, groupStyles?,
 *              activeCardStyle?, activeLineStyle?, bgColor?, fontFamily?, showShadow?, gapSiblings?, gapLevels? }
 *   content: { nodes: [{ key, text, parent, x, y, w, structure, autoStyle, cardStyle, overrides }],
 *              lines: [{ from, to, label, styleRef }], groups: [{ name, nodeKeys, styleRef }] }
 * 適用時は必ず新しいトピックとして作り直す（他のボードとトピックを共有しない）。
 */
(function initMeldexBoardTemplateLibrary(global) {
  'use strict';

  const FALLBACK_PALETTE = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899'];
  const NODE_H = 40;

  function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }

  function boardState() {
    try { if (typeof bd !== 'undefined' && bd && Array.isArray(bd.nodes)) return bd; } catch (_) { /* no board */ }
    return null;
  }

  function palette() {
    const colors = typeof global.bdGetThemeColorSet === 'function' ? global.bdGetThemeColorSet(boardState() || undefined) : null;
    return Array.isArray(colors) && colors.length ? colors : FALLBACK_PALETTE.slice();
  }

  function tone(index, kind) {
    const colors = palette();
    const color = (typeof global.bdThemeRoleColor === 'function' ? global.bdThemeRoleColor(index, colors) : colors[index % colors.length]) || '#3b82f6';
    if (typeof global.bdThemeTone === 'function') return global.bdThemeTone(color, kind);
    return { bgColor: color, borderColor: color, textColor: '#ffffff', lineColor: color };
  }

  // ---------------------------------------------------------------
  //  グループスタイル（初期搭載）
  // ---------------------------------------------------------------
  const GROUP_STYLE_DEFS = [
    { id: 'group-std-frame', name: '標準の枠', idx: 5, kind: 'tint', fields: { backgroundOpacity: 0.35, borderWidth: 1.5, borderStyle: 'solid' } },
    { id: 'group-std-boundary', name: '破線の境界', idx: 5, kind: 'muted', fields: { background: 'transparent', backgroundOpacity: 0, borderWidth: 1.5, borderStyle: 'dashed' } },
    { id: 'group-std-sticky', name: '付箋の島', idx: 2, kind: 'tint', fields: { backgroundOpacity: 0.45, borderWidth: 0, borderStyle: 'solid' } },
    { id: 'group-std-zone', name: '強調ゾーン', idx: 1, kind: 'tint', fields: { backgroundOpacity: 0.4, borderWidth: 2, borderStyle: 'solid' } },
    { id: 'group-std-good', name: '良い点（緑）', idx: 3, kind: 'tint', fields: { backgroundOpacity: 0.4, borderWidth: 1.5, borderStyle: 'solid' } },
    { id: 'group-std-bad', name: '課題（赤）', idx: 0, kind: 'tint', fields: { backgroundOpacity: 0.4, borderWidth: 1.5, borderStyle: 'solid' } },
  ];

  function defaultGroupStyles() {
    return GROUP_STYLE_DEFS.map(def => {
      const toned = tone(def.idx, def.kind);
      return {
        groupStyleId: def.id,
        name: def.name,
        builtin: true,
        visualStyle: {
          background: toned.bgColor, borderColor: toned.borderColor, borderRadius: 12, padding: 18,
          labelColor: toned.borderColor, labelFontSize: 13, labelBold: true, shadow: '',
          ...def.fields,
        },
      };
    });
  }

  // ---------------------------------------------------------------
  //  初期搭載テンプレート
  // ---------------------------------------------------------------
  const CATEGORIES = { basic: '基本', think: '考える・整理', plan: '計画・記録', creative: '創作' };

  // [text, children] 形式の木を content.nodes へ展開する。
  function tree(rootText, children, options = {}) {
    const nodes = [];
    let seq = 0;
    const walk = (entry, parentKey, depth) => {
      const [text, kids, extra] = Array.isArray(entry) ? entry : [entry, [], null];
      const key = `${options.prefix || 't'}${seq++}`;
      nodes.push({ key, text, parent: parentKey, depth, ...(extra || {}) });
      (kids || []).forEach(child => walk(child, key, depth + 1));
    };
    walk([rootText, children, { structure: options.structure || 'mindmap', autoStyle: options.autoStyle !== false, ...(options.root || {}) }], '', 0);
    return nodes;
  }

  // 番号付きの連鎖（フローチャート）: 各手順を前の手順の子にする。
  function chain(steps, options = {}) {
    const nodes = [];
    steps.forEach((step, index) => {
      const [text, extra] = Array.isArray(step) ? step : [step, null];
      nodes.push({
        key: `f${index}`, text, parent: index ? `f${index - 1}` : '', depth: index,
        ...(index === 0 ? { structure: options.structure || 'flowchart', autoStyle: false } : {}),
        ...(extra || {}),
      });
    });
    return nodes;
  }

  const BUILTIN_TEMPLATES = [
    {
      id: 'board-tpl-blank', name: '空白', category: 'basic',
      description: '標準の見た目だけを用意した空のボード。自由に書き始めたい時に。',
      style: { depthPresetId: 'depth-preset-standard' },
      content: { nodes: [] },
    },
    {
      id: 'board-tpl-mindmap', name: 'マインドマップ', category: 'basic', isDefault: true,
      description: '中心テーマから放射状に広げる汎用の型。考えを広げる・全体像を掴む時に。',
      style: { depthPresetId: 'depth-preset-standard' },
      content: { nodes: tree('中心テーマ', [
        ['メイントピック 1', ['サブトピック', 'サブトピック']],
        ['メイントピック 2', ['サブトピック', 'サブトピック']],
        ['メイントピック 3', ['サブトピック']],
        ['メイントピック 4', ['サブトピック']],
      ], { structure: 'mindmap' }) },
    },
    {
      id: 'board-tpl-logic', name: 'ロジック図（論点整理）', category: 'think',
      description: '結論→理由→根拠を左から右へ並べる。主張の筋道を確かめる・説明を組み立てる時に。',
      style: { depthPresetId: 'depth-preset-logic' },
      content: { nodes: tree('結論・主張', [
        ['理由 1', ['根拠', '具体例']],
        ['理由 2', ['根拠', '具体例']],
        ['理由 3', ['根拠']],
      ], { structure: 'logic' }) },
    },
    {
      id: 'board-tpl-org', name: '組織図・分類ツリー', category: 'think',
      description: '上から下へ分類する。組織・チーム構成、カテゴリ分け、目次づくりに。',
      style: { depthPresetId: 'depth-preset-org' },
      content: { nodes: tree('全体', [
        ['部門 A', ['チーム 1', 'チーム 2']],
        ['部門 B', ['チーム 3', 'チーム 4']],
        ['部門 C', ['チーム 5']],
      ], { structure: 'orgchart' }) },
    },
    {
      id: 'board-tpl-flow', name: '手順・フローチャート', category: 'think',
      description: '開始から完了までの手順を矢印でつなぐ。作業手順や処理の流れの説明に。',
      style: { depthPresetId: 'depth-preset-logic', activeLineStyle: 'line-std-flow' },
      content: { nodes: chain([
        ['開始', { cardStyle: 'card-std-milestone' }],
        ['手順 1', { cardStyle: 'card-std-topic' }],
        ['手順 2', { cardStyle: 'card-std-topic' }],
        ['確認', { cardStyle: 'card-std-highlight' }],
        ['完了', { cardStyle: 'card-std-milestone' }],
      ]) },
    },
    {
      id: 'board-tpl-timeline', name: 'タイムライン（予定・年表）', category: 'plan',
      description: '時間の流れに沿って節目と作業を並べる。制作スケジュールや年表に。',
      style: { depthPresetId: 'depth-preset-timeline' },
      content: { nodes: tree('プロジェクト', [
        ['第 1 週', ['企画', '資料集め']],
        ['第 2 週', ['制作']],
        ['第 3 週', ['確認・修正']],
        ['第 4 週', ['公開']],
      ], { structure: 'timeline' }) },
    },
    {
      id: 'board-tpl-meeting', name: '会議メモ', category: 'plan',
      description: '議題・決定事項・課題・次の行動を一枚にまとめる。打ち合わせの記録に。',
      style: { depthPresetId: 'depth-preset-standard' },
      content: { nodes: tree('会議名（日付）', [
        ['議題', ['議題 1', '議題 2']],
        ['決定事項', ['決定 1']],
        ['課題', ['課題 1']],
        ['次の行動', ['担当・期限']],
      ], { structure: 'mindmap' }) },
    },
    {
      id: 'board-tpl-kj', name: 'ブレインストーミング（KJ法）', category: 'think',
      description: '思いつきを付箋に書き出し、近いものを島にまとめる。アイデア出しと整理に。',
      style: { depthPresetId: 'depth-preset-sticky', activeCardStyle: 'card-std-note', activeGroupStyle: 'group-std-sticky' },
      content: {
        nodes: [
          { key: 'title', text: 'テーマ：〇〇を考える', x: 0, y: -60, w: 320, cardStyle: 'card-std-label' },
          { key: 'a1', text: 'アイデア', x: 0, y: 40, cardStyle: 'card-std-note' },
          { key: 'a2', text: 'アイデア', x: 0, y: 110, cardStyle: 'card-std-note' },
          { key: 'a3', text: 'アイデア', x: 0, y: 180, cardStyle: 'card-std-note' },
          { key: 'b1', text: 'アイデア', x: 240, y: 40, cardStyle: 'card-std-note' },
          { key: 'b2', text: 'アイデア', x: 240, y: 110, cardStyle: 'card-std-note' },
          { key: 'c1', text: 'アイデア', x: 480, y: 40, cardStyle: 'card-std-note' },
          { key: 'c2', text: 'アイデア', x: 480, y: 110, cardStyle: 'card-std-note' },
          { key: 'c3', text: 'アイデア', x: 480, y: 180, cardStyle: 'card-std-note' },
          { key: 'u1', text: '未分類', x: 720, y: 40, cardStyle: 'card-std-note' },
        ],
        groups: [
          { name: 'まとまり A', nodeKeys: ['a1', 'a2', 'a3'], styleRef: 'group-std-sticky' },
          { name: 'まとまり B', nodeKeys: ['b1', 'b2'], styleRef: 'group-std-sticky' },
          { name: 'まとまり C', nodeKeys: ['c1', 'c2', 'c3'], styleRef: 'group-std-sticky' },
        ],
      },
    },
    {
      id: 'board-tpl-swot', name: 'SWOT分析', category: 'think',
      description: '強み・弱み・機会・脅威の4つの枠で現状を整理する。企画や戦略の検討に。',
      style: { depthPresetId: 'depth-preset-standard', activeCardStyle: 'card-std-topic' },
      content: {
        nodes: [
          { key: 'title', text: 'SWOT分析：対象', x: 120, y: -70, w: 320, cardStyle: 'card-std-label' },
          { key: 's1', text: '強み', x: 0, y: 30, cardStyle: 'card-std-done' },
          { key: 's2', text: '強み', x: 0, y: 95, cardStyle: 'card-std-done' },
          { key: 'w1', text: '弱み', x: 300, y: 30, cardStyle: 'card-std-issue' },
          { key: 'w2', text: '弱み', x: 300, y: 95, cardStyle: 'card-std-issue' },
          { key: 'o1', text: '機会', x: 0, y: 230, cardStyle: 'card-std-topic' },
          { key: 'o2', text: '機会', x: 0, y: 295, cardStyle: 'card-std-topic' },
          { key: 't1', text: '脅威', x: 300, y: 230, cardStyle: 'card-std-highlight' },
          { key: 't2', text: '脅威', x: 300, y: 295, cardStyle: 'card-std-highlight' },
        ],
        groups: [
          { name: '強み（S）', nodeKeys: ['s1', 's2'], styleRef: 'group-std-good' },
          { name: '弱み（W）', nodeKeys: ['w1', 'w2'], styleRef: 'group-std-bad' },
          { name: '機会（O）', nodeKeys: ['o1', 'o2'], styleRef: 'group-std-frame' },
          { name: '脅威（T）', nodeKeys: ['t1', 't2'], styleRef: 'group-std-zone' },
        ],
      },
    },
    {
      id: 'board-tpl-relations', name: 'キャラクター相関図', category: 'creative',
      description: '人物を配置し、関係をラベル付きのラインで結ぶ。登場人物の関係整理に。',
      style: { depthPresetId: 'depth-preset-standard', activeCardStyle: 'card-std-main', activeLineStyle: 'line-std-relation' },
      content: {
        nodes: [
          { key: 'hero', text: '主人公', x: 260, y: 170, cardStyle: 'card-std-central', w: 200 },
          { key: 'heroine', text: 'ヒロイン', x: 0, y: 0, cardStyle: 'card-std-main' },
          { key: 'rival', text: 'ライバル', x: 560, y: 0, cardStyle: 'card-std-main' },
          { key: 'mentor', text: '師匠', x: 0, y: 350, cardStyle: 'card-std-main' },
          { key: 'enemy', text: '敵', x: 560, y: 350, cardStyle: 'card-std-issue' },
        ],
        lines: [
          { from: 'hero', to: 'heroine', label: '幼なじみ', styleRef: 'line-std-mutual' },
          { from: 'hero', to: 'rival', label: 'ライバル視', styleRef: 'line-std-emphasis' },
          { from: 'mentor', to: 'hero', label: '導く', styleRef: 'line-std-arrow' },
          { from: 'enemy', to: 'hero', label: '狙う', styleRef: 'line-std-conflict' },
          { from: 'rival', to: 'enemy', label: '因縁', styleRef: 'line-std-relation' },
        ],
      },
    },
    {
      id: 'board-tpl-story', name: 'ストーリー構成（起承転結）', category: 'creative',
      description: '起・承・転・結ごとに場面を並べる。話のプロットや構成案づくりに。',
      style: { depthPresetId: 'depth-preset-rainbow' },
      content: { nodes: tree('作品タイトル', [
        ['起', ['導入', '事件の発端']],
        ['承', ['展開']],
        ['転', ['山場']],
        ['結', ['結末']],
      ], { structure: 'logic' }) },
    },
  ].map(template => ({
    schemaVersion: 1, builtin: true, categoryLabel: CATEGORIES[template.category] || '', ...template,
  }));

  // ---------------------------------------------------------------
  //  見た目の解決（サムネイル・適用の共通）
  // ---------------------------------------------------------------
  function depthStylesFor(template) {
    if (Array.isArray(template?.style?.depthStyles) && template.style.depthStyles.length) return template.style.depthStyles;
    const id = template?.style?.depthPresetId;
    const preset = id && global.MeldexBoardDepthPresets?.find ? global.MeldexBoardDepthPresets.find(id) : null;
    if (preset?.styles?.length) return preset.styles;
    return typeof global.bdNormalizeDepthStyles === 'function' ? global.bdNormalizeDepthStyles([]) : [];
  }

  function cardStylesFor(template) {
    if (Array.isArray(template?.style?.cardStyles) && template.style.cardStyles.length) return template.style.cardStyles;
    return typeof global.bdDefaultCardStylesForBoard === 'function' ? global.bdDefaultCardStylesForBoard(boardState() || undefined) : [];
  }

  function lineStylesFor(template) {
    if (Array.isArray(template?.style?.lineStyles) && template.style.lineStyles.length) return template.style.lineStyles;
    return typeof global.bdDefaultLineStylesForBoard === 'function' ? global.bdDefaultLineStylesForBoard(boardState() || undefined) : [];
  }

  function groupStylesFor(template) {
    if (Array.isArray(template?.style?.groupStyles) && template.style.groupStyles.length) return template.style.groupStyles;
    return defaultGroupStyles();
  }

  // ---------------------------------------------------------------
  //  配置（構造ごとの簡易レイアウト。適用直後の仮配置とサムネイルに使う）
  // ---------------------------------------------------------------
  function layout(template) {
    const nodes = clone(template?.content?.nodes || []);
    const byKey = new Map(nodes.map(node => [node.key, node]));
    const childrenOf = key => nodes.filter(node => node.parent === key);
    const depthStyles = depthStylesFor(template);
    const widthAt = node => +node.w || +depthStyles[Math.min(node.depth || 0, Math.max(0, depthStyles.length - 1))]?.width || 170;
    const roots = nodes.filter(node => !node.parent || !byKey.has(node.parent));
    roots.forEach(root => {
      if (Number.isFinite(+root.x) && Number.isFinite(+root.y) && !root.structure) return;
      const structure = root.structure || 'logic';
      const gapL = 56;
      const gapS = 16;
      if (['orgchart', 'tree', 'flowchart'].includes(structure)) {
        if (structure === 'flowchart') {
          let y = 0;
          let node = root;
          while (node) {
            node.x = 0; node.y = y; y += NODE_H + gapL;
            node = childrenOf(node.key)[0];
          }
          return;
        }
        let cursor = 0;
        const place = (node, depth) => {
          const kids = childrenOf(node.key);
          node.y = depth * (NODE_H + gapL);
          if (!kids.length) { node.x = cursor; cursor += widthAt(node) + gapS; return; }
          kids.forEach(kid => place(kid, depth + 1));
          const first = kids[0];
          const last = kids[kids.length - 1];
          node.x = (first.x + last.x + widthAt(last)) / 2 - widthAt(node) / 2;
        };
        place(root, 0);
        return;
      }
      const placeSide = (list, dir, xStart) => {
        let cursor = 0;
        const place = (node, x) => {
          const kids = childrenOf(node.key);
          node.x = dir > 0 ? x : x - widthAt(node);
          if (!kids.length) { node.y = cursor; cursor += NODE_H + gapS; return; }
          const nextX = dir > 0 ? x + widthAt(node) + gapL : x - widthAt(node) - gapL;
          kids.forEach(kid => place(kid, nextX));
          node.y = (kids[0].y + kids[kids.length - 1].y) / 2;
        };
        list.forEach(node => place(node, xStart));
        return cursor;
      };
      const kids = childrenOf(root.key);
      root.x = 0;
      if (structure === 'mindmap' && kids.length > 1) {
        const right = kids.slice(0, Math.ceil(kids.length / 2));
        const left = kids.slice(Math.ceil(kids.length / 2));
        const rightH = placeSide(right, 1, widthAt(root) + gapL);
        const leftH = placeSide(left, -1, -gapL);
        const shift = (rightH - leftH) / 2;
        const leftSet = new Set();
        const collect = node => { leftSet.add(node.key); childrenOf(node.key).forEach(collect); };
        left.forEach(collect);
        nodes.forEach(node => { if (leftSet.has(node.key)) node.y += shift; });
        root.y = (rightH - NODE_H - gapS) / 2;
      } else {
        const h = placeSide(kids, 1, widthAt(root) + gapL);
        root.y = Math.max(0, (h - NODE_H - gapS) / 2);
      }
    });
    nodes.forEach(node => {
      node.x = Number.isFinite(+node.x) ? +node.x : 0;
      node.y = Number.isFinite(+node.y) ? +node.y : 0;
      node.w = widthAt(node);
      node.h = +node.h || NODE_H;
    });
    return nodes;
  }

  // ---------------------------------------------------------------
  //  サムネイル（SVG）
  // ---------------------------------------------------------------
  const SVG_NS = 'http://www.w3.org/2000/svg';

  function svgEl(tag, attrs) {
    const node = document.createElementNS(SVG_NS, tag);
    Object.entries(attrs || {}).forEach(([key, value]) => {
      if (value != null && value !== '') node.setAttribute(key, String(value));
    });
    return node;
  }

  function safeColor(value, fallback) {
    const raw = String(value == null ? '' : value).trim();
    if (/^#[0-9a-f]{3,8}$/i.test(raw) || /^(?:rgba?|hsla?)\([0-9.,%\s/]+\)$/i.test(raw) || raw === 'transparent') return raw;
    return fallback;
  }

  function nodeLook(template, node, depthStyles, cardStyles) {
    if (node.cardStyle) {
      const card = cardStyles.find(style => style.id === node.cardStyle);
      if (card) return { ...card, ...(node.overrides || {}) };
    }
    const depth = depthStyles[Math.min(node.depth || 0, Math.max(0, depthStyles.length - 1))] || {};
    return { ...depth, ...(node.overrides || {}) };
  }

  function backgroundFor(template) {
    const own = template?.style?.bgColor;
    if (own) return safeColor(own, '#ffffff');
    let bg = '';
    try { if (typeof global._bdBoardThemeBackgroundColor === 'function') bg = global._bdBoardThemeBackgroundColor(); } catch (_) { bg = ''; }
    if (!bg && typeof global.getCssVar === 'function') bg = global.getCssVar('--bd-bg') || global.getCssVar('--bg3') || '';
    return safeColor(bg, '#f8fafc');
  }

  function renderThumbnail(template, host, options = {}) {
    const large = options.size === 'large';
    const nodes = layout(template);
    const depthStyles = depthStylesFor(template);
    const cardStyles = cardStylesFor(template);
    const lineStyles = lineStylesFor(template);
    const groupStyles = groupStylesFor(template);
    const bg = backgroundFor(template);
    const svg = svgEl('svg', { viewBox: '0 0 320 200', preserveAspectRatio: 'xMidYMid meet', role: 'img' });
    svg.appendChild(svgEl('rect', { x: 0, y: 0, width: 320, height: 200, fill: bg }));
    if (!nodes.length) {
      const dark = typeof global.bdReadableTextColor === 'function' && global.bdReadableTextColor(/^#/.test(bg) ? bg : '#ffffff') === '#ffffff';
      const ink = dark ? '#94a3b8' : '#64748b';
      svg.appendChild(svgEl('rect', { x: 120, y: 82, width: 80, height: 36, rx: 8, fill: 'none', stroke: ink, 'stroke-width': 1.5, 'stroke-dasharray': '4 3' }));
      const plus = svgEl('text', { x: 160, y: 106, 'text-anchor': 'middle', 'font-size': 20, fill: ink });
      plus.textContent = '+';
      svg.appendChild(plus);
      host.appendChild(svg);
      return svg;
    }
    const groups = template?.content?.groups || [];
    const keyed = new Map(nodes.map(node => [node.key, node]));
    const boxes = [];
    groups.forEach(group => {
      const members = (group.nodeKeys || []).map(key => keyed.get(key)).filter(Boolean);
      if (!members.length) return;
      const pad = 18;
      boxes.push({ group, x1: Math.min(...members.map(n => n.x)) - pad, y1: Math.min(...members.map(n => n.y)) - pad - 16,
        x2: Math.max(...members.map(n => n.x + n.w)) + pad, y2: Math.max(...members.map(n => n.y + n.h)) + pad });
    });
    const xs = nodes.flatMap(node => [node.x, node.x + node.w]).concat(boxes.flatMap(b => [b.x1, b.x2]));
    const ys = nodes.flatMap(node => [node.y, node.y + node.h]).concat(boxes.flatMap(b => [b.y1, b.y2]));
    const minX = Math.min(...xs); const maxX = Math.max(...xs);
    const minY = Math.min(...ys); const maxY = Math.max(...ys);
    const margin = 14;
    const scale = Math.min((320 - margin * 2) / Math.max(1, maxX - minX), (200 - margin * 2) / Math.max(1, maxY - minY), 0.9);
    const ox = (320 - (maxX - minX) * scale) / 2 - minX * scale;
    const oy = (200 - (maxY - minY) * scale) / 2 - minY * scale;
    const tx = x => ox + x * scale;
    const ty = y => oy + y * scale;
    boxes.forEach(box => {
      const style = groupStyles.find(item => item.groupStyleId === box.group.styleRef)?.visualStyle || {};
      const fill = safeColor(style.background, 'transparent');
      svg.appendChild(svgEl('rect', {
        x: tx(box.x1), y: ty(box.y1), width: (box.x2 - box.x1) * scale, height: (box.y2 - box.y1) * scale, rx: 6,
        fill, 'fill-opacity': fill === 'transparent' ? 0 : (style.backgroundOpacity ?? 0.4),
        stroke: safeColor(style.borderColor, '#94a3b8'), 'stroke-width': Math.max(0.6, (+style.borderWidth || 1) * scale),
        'stroke-dasharray': style.borderStyle === 'dashed' ? '4 3' : '',
      }));
    });
    const center = node => ({ x: tx(node.x + node.w / 2), y: ty(node.y + node.h / 2) });
    const drawLine = (from, to, look) => {
      const a = center(from);
      const b = center(to);
      const color = safeColor(look.color, '#94a3b8');
      const width = Math.max(0.7, Math.min(3, (+look.width || 1.5) * scale * 1.2));
      const path = look.pathType === 'orthogonal'
        ? `M${a.x},${a.y} L${(a.x + b.x) / 2},${a.y} L${(a.x + b.x) / 2},${b.y} L${b.x},${b.y}`
        : look.pathType === 'straight'
          ? `M${a.x},${a.y} L${b.x},${b.y}`
          : `M${a.x},${a.y} C${(a.x + b.x) / 2},${a.y} ${(a.x + b.x) / 2},${b.y} ${b.x},${b.y}`;
      svg.appendChild(svgEl('path', { d: path, fill: 'none', stroke: color, 'stroke-width': width, 'stroke-dasharray': look.style === 'dashed' ? '4 3' : '' }));
    };
    nodes.forEach(node => {
      const parent = node.parent ? keyed.get(node.parent) : null;
      if (!parent) return;
      const parentLook = parent.cardStyle ? lineStyles.find(style => style.id === 'line-std-flow') || {}
        : (depthStyles[Math.min(parent.depth || 0, Math.max(0, depthStyles.length - 1))]?.line || {});
      drawLine(parent, node, parentLook);
    });
    (template?.content?.lines || []).forEach(line => {
      const from = keyed.get(line.from);
      const to = keyed.get(line.to);
      if (from && to) drawLine(from, to, lineStyles.find(style => style.id === line.styleRef) || lineStyles[0] || {});
    });
    nodes.forEach(node => {
      const look = nodeLook(template, node, depthStyles, cardStyles);
      const w = node.w * scale;
      const h = node.h * scale;
      const x = tx(node.x);
      const y = ty(node.y);
      const radius = Math.min(h / 2, (+look.borderRadius || 0) * scale);
      const fill = safeColor(look.bgColor, '#e2e8f0');
      svg.appendChild(svgEl('rect', {
        x, y, width: w, height: h, rx: look.shape === 'pill' || look.shape === 'cloud' ? h / 2 : radius,
        fill, stroke: safeColor(look.borderColor, 'transparent'),
        'stroke-width': Math.max(0, Math.min(2.5, (+look.borderWidth || 0) * scale)),
      }));
      const fontSize = Math.max(5, Math.min(large ? 14 : 11, (+look.fontSize || 13) * scale));
      if (fontSize * (large ? 1 : 1.4) < 6.5 && !large) return;
      const text = svgEl('text', {
        x: x + w / 2, y: y + h / 2 + fontSize * 0.35, 'text-anchor': 'middle', 'font-size': fontSize,
        'font-weight': look.fontBold ? 700 : 400,
        fill: safeColor(look.textColor, /^#/.test(bg) && global.bdReadableTextColor ? global.bdReadableTextColor(bg) || '#1f2937' : '#1f2937'),
      });
      const maxChars = Math.max(2, Math.floor(w / (fontSize * 0.95)));
      const label = String(node.text || '');
      text.textContent = label.length > maxChars ? label.slice(0, Math.max(1, maxChars - 1)) + '…' : label;
      svg.appendChild(text);
    });
    host.appendChild(svg);
    return svg;
  }

  global.MeldexBoardTemplateLibrary = Object.freeze({
    CATEGORIES,
    builtinTemplates: () => clone(BUILTIN_TEMPLATES),
    defaultTemplateId: () => (BUILTIN_TEMPLATES.find(item => item.isDefault) || BUILTIN_TEMPLATES[0]).id,
    defaultGroupStyles,
    depthStylesFor, cardStylesFor, lineStylesFor, groupStylesFor,
    layout,
    renderThumbnail,
  });
}(typeof globalThis !== 'undefined' ? globalThis : window));
