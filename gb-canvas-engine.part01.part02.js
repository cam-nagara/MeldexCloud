    });
  }
  const hasLinks = bd.nodes.some(n => n.link);
  if (hasLinks) {
    fm += 'links:\n';
    bd.nodes.forEach((n,i) => { if (n.link) fm += `  n${i}: ${n.link}\n`; });
  }
  const hasLinkTypes = bd.nodes.some(n => n.link && n.linkType);
  if (hasLinkTypes) {
    fm += 'linkTypes:\n';
    bd.nodes.forEach((n,i) => { if (n.link && n.linkType) fm += `  n${i}: ${n.linkType}\n`; });
  }
  // PureRef属性
  const hasTransforms = bd.nodes.some(n => n.flipH || n.flipV || n.rotate || (n.opacity != null && n.opacity < 1) || n.locked);
  if (hasTransforms) {
    fm += 'transforms:\n';
    bd.nodes.forEach((n,i) => {
      const parts = [];
      if (n.flipH) parts.push('flipH: true');
      if (n.flipV) parts.push('flipV: true');
      if (n.rotate) parts.push('rotate: ' + n.rotate);
      if (n.opacity != null && n.opacity < 1) parts.push('opacity: ' + n.opacity);
      if (n.locked) parts.push('locked: true');
      if (parts.length) fm += `  n${i}: {${parts.join(', ')}}\n`;
    });
  }
  if (bd._bgColor) fm += 'canvasBg: "' + bd._bgColor + '"\n';
  if (bd._fileStyle && Object.keys(bd._fileStyle).length > 0) {
    fm += 'style:\n';
    for (const [k, v] of Object.entries(bd._fileStyle)) {
      fm += `  ${k}: ${JSON.stringify(String(v == null ? '' : v))}\n`;
    }
  }
  if (bd._numbering) fm += 'numbering: true\n';
  // Xmindメタ（note, checked, progress, markers, shape, font）
  const cardOverrideMetaKeys = [
    'shape', 'fontSize', 'fontBold', 'fontItalic', 'textColor', 'textStrokeColor',
    'textStrokeWidth', 'borderColor', 'borderWidth', 'borderRadius', 'cardStyle',
    'cloudBumpWidth', 'cloudBumpHeight', 'cloudSideWidth', 'cloudOffset',
    'cloudSubBumpRatio', 'cloudSubWidthRatio', 'cloudSubHeightRatio',
  ];
  const hasXmindMeta = bd.nodes.some(n =>
    (n.note != null && n.note !== '')
    || hasOwn(n, 'checked')
    || hasOwn(n, 'progress')
    || (n.markers && Object.keys(n.markers).length)
    || cardOverrideMetaKeys.some(key => hasOwn(n, key))
    || !!n.imageSourcePath
    || hasOwn(n, '_autoStyle')
    || hasOwn(n, '_followChildren')
    || hasOwn(n, '_userBgColor')
    || hasOwn(n, '_userFontSize')
    || hasOwn(n, '_userFontBold')
    || hasOwn(n, '_userW')
    || hasOwn(n, '_userCardStyle')
    || n.collapsed
    || n.minimized);
  if (hasXmindMeta) {
    fm += 'xmind:\n';
    bd.nodes.forEach((n,i) => {
      const parts = [];
      if (n.note != null && n.note !== '') parts.push('note: ' + fmtJsonString(n.note));
      if (hasOwn(n, 'checked')) parts.push('checked: ' + (n.checked ? 'true' : 'false'));
      if (hasOwn(n, 'progress')) parts.push('progress: ' + (+n.progress || 0));
      if (n.markers && Object.keys(n.markers).length) parts.push('markers: ' + JSON.stringify(n.markers));
      if (hasOwn(n, 'shape')) parts.push('shape: ' + fmtJsonString(n.shape));
      if (hasOwn(n, 'fontSize')) parts.push('fontSize: ' + (+n.fontSize || 0));
      if (hasOwn(n, 'fontBold')) parts.push('fontBold: ' + (n.fontBold ? 'true' : 'false'));
      if (hasOwn(n, 'fontItalic')) parts.push('fontItalic: ' + (n.fontItalic ? 'true' : 'false'));
      if (hasOwn(n, 'textColor')) parts.push('textColor: ' + fmtJsonString(n.textColor));
      if (hasOwn(n, 'textStrokeColor')) parts.push('textStrokeColor: ' + fmtJsonString(n.textStrokeColor));
      if (hasOwn(n, 'textStrokeWidth')) parts.push('textStrokeWidth: ' + (+n.textStrokeWidth || 0));
      if (hasOwn(n, 'borderColor')) parts.push('borderColor: ' + fmtJsonString(n.borderColor));
      if (hasOwn(n, 'borderWidth')) parts.push('borderWidth: ' + (+n.borderWidth || 0));
      if (hasOwn(n, 'borderRadius')) parts.push('borderRadius: ' + (+n.borderRadius || 0));
      if (hasOwn(n, 'cardStyle')) parts.push('cardStyle: ' + fmtJsonString(n.cardStyle));
      if (hasOwn(n, 'cloudBumpWidth')) parts.push('cloudBumpWidth: ' + (+n.cloudBumpWidth || 0));
      if (hasOwn(n, 'cloudBumpHeight')) parts.push('cloudBumpHeight: ' + (+n.cloudBumpHeight || 0));
      if (hasOwn(n, 'cloudSideWidth')) parts.push('cloudSideWidth: ' + (+n.cloudSideWidth || 0));
      if (hasOwn(n, 'cloudOffset')) parts.push('cloudOffset: ' + (+n.cloudOffset || 0));
      if (hasOwn(n, 'cloudSubBumpRatio')) parts.push('cloudSubBumpRatio: ' + (+n.cloudSubBumpRatio || 0));
      if (hasOwn(n, 'cloudSubWidthRatio')) parts.push('cloudSubWidthRatio: ' + (+n.cloudSubWidthRatio || 0));
      if (hasOwn(n, 'cloudSubHeightRatio')) parts.push('cloudSubHeightRatio: ' + (+n.cloudSubHeightRatio || 0));
      if (hasOwn(n, 'imageSourcePath') && n.imageSourcePath) parts.push('imageSourcePath: ' + fmtJsonString(n.imageSourcePath));
      if (hasOwn(n, '_autoStyle')) parts.push('autoStyle: ' + (n._autoStyle ? 'true' : 'false'));
      if (hasOwn(n, '_followChildren')) parts.push('followChildren: ' + (n._followChildren ? 'true' : 'false'));
      if (hasOwn(n, '_userBgColor')) parts.push('userBgColor: ' + (n._userBgColor ? 'true' : 'false'));
      if (hasOwn(n, '_userFontSize')) parts.push('userFontSize: ' + (n._userFontSize ? 'true' : 'false'));
      if (hasOwn(n, '_userFontBold')) parts.push('userFontBold: ' + (n._userFontBold ? 'true' : 'false'));
      if (hasOwn(n, '_userW')) parts.push('userW: ' + (n._userW ? 'true' : 'false'));
      if (hasOwn(n, '_userCardStyle')) parts.push('userCardStyle: ' + (n._userCardStyle ? 'true' : 'false'));
      if (n.collapsed) parts.push('collapsed: true');
      if (n.minimized) parts.push('minimized: true');
      if (parts.length) fm += `  n${i}: {${parts.join(', ')}}\n`;
    });
  }
  // バルーン
  const hasBalloons = bd.nodes.some(n => n.balloon);
  if (hasBalloons) {
    fm += 'balloons:\n';
    bd.nodes.forEach((n,i) => { if (n.balloon) fm += `  n${i}: {tailX: ${n.tailX||0}, tailY: ${n.tailY||0}${n.balloonChild ? ', child: true' : ''}}\n`; });
  }
  // ステータス定義
  if (bd.statuses && bd.statuses.length) {
    fm += 'statusDefs:\n';
    bd.statuses.forEach(s => {
      fm += '  - ' + JSON.stringify({
        name: s.name || '',
        color: s.color || '#888',
        opacity: Number.isFinite(+s.opacity) ? +s.opacity : 1,
        border: s.border || '',
      }) + '\n';
    });
  }
  // グループ
  if (bd.groups && bd.groups.length) {
    fm += 'groups:\n';
    bd.groups.forEach(g => {
      fm += `  - {name: ${fmtJsonString(g.name)}, nodes: [${g.nodeIds.map(id=>m[id]).filter(Boolean).join(', ')}]}\n`;
    });
  }
  if (bd.cardStyles && bd.cardStyles.length) {
    fm += 'cardStyles:\n';
    bd.cardStyles.forEach(style => { fm += `  - ${JSON.stringify(style)}\n`; });
  }
  if (bd.lineStyles && bd.lineStyles.length) {
    fm += 'lineStyles:\n';
    bd.lineStyles.forEach(style => { fm += `  - ${JSON.stringify(style)}\n`; });
  }
  if (bd.depthStyles && bd.depthStyles.length) {
    fm += 'depthStyles:\n';
    bd.depthStyles.forEach(style => { fm += `  - ${JSON.stringify(style)}\n`; });
  }
  const displayFiltersForSave = typeof bdNormalizeDisplayFilters === 'function'
    ? bdNormalizeDisplayFilters(bd.displayFilters)
    : (bd.displayFilters || {});
  const defaultDisplayFilters = typeof BD_DEFAULT_DISPLAY_FILTERS !== 'undefined' ? BD_DEFAULT_DISPLAY_FILTERS : {};
  const hasDisplayFilterOverrides = !!displayFiltersForSave && Object.keys(displayFiltersForSave)
    .some(key => displayFiltersForSave[key] !== defaultDisplayFilters[key]);
  if (bd.activeCardStyle || bd.activeLineStyle || bd._stylePresetSeedVersion || bd.themeId || bd._showShadow || bd._textRotateOnLine || hasDisplayFilterOverrides) {
    fm += 'boardUi:\n';
    if (bd.activeCardStyle) fm += `  activeCardStyle: ${bd.activeCardStyle}\n`;
    if (bd.activeLineStyle) fm += `  activeLineStyle: ${bd.activeLineStyle}\n`;
    if (bd._stylePresetSeedVersion) fm += `  stylePresetSeedVersion: ${bd._stylePresetSeedVersion}\n`;
    if (bd.themeId) fm += `  themeId: ${bd.themeId}\n`;
    if (bd._showShadow) fm += `  showShadow: true\n`;
    if (bd._textRotateOnLine) fm += `  textRotateOnLine: true\n`;
    if (hasDisplayFilterOverrides) fm += `  displayFilters: ${JSON.stringify(displayFiltersForSave)}\n`;
  }
  if (bd.connections.length) {
    fm += 'connections:\n';
    bd.connections.forEach(c => {
      const fmt = (v) => Number.isFinite(+v) ? (+v).toFixed(2).replace(/\.?0+$/, '') : '0';
      const fmtPoint = (point) => {
        const p = bdNormalizeConnectionPoint(point);
        if (!p) return '[0,0]';
        return `[${fmt(p.x)},${fmt(p.y)}]`;
      };
      const endpointParts = [];
      if (c.id) endpointParts.push(`id: ${fmtJsonString(c.id)}`);
      if (c.from && m[c.from]) endpointParts.push(`from: ${m[c.from]}`);
      else if (bdNormalizeConnectionPoint(c.fromPoint)) endpointParts.push(`fromPoint: ${fmtPoint(c.fromPoint)}`);
      if (c.to && m[c.to]) endpointParts.push(`to: ${m[c.to]}`);
      else if (bdNormalizeConnectionPoint(c.toPoint)) endpointParts.push(`toPoint: ${fmtPoint(c.toPoint)}`);
      if (endpointParts.length < 2) return;
      let s = `  - {${endpointParts.join(', ')}`;
      // arrow は明示的に設定されているときだけ書き出す。空文字列は「矢印なし」として保存する。
      if (hasOwn(c, 'arrow')) {
        const arrow = c.arrow === true ? 'end' : ((c.arrow === false || c.arrow === '') ? 'none' : String(c.arrow || 'none'));
        s += `, arrow: ${arrow}`;
      }
      if (c.label) s += `, label: ${fmtJsonString(c.label)}`;
      if (hasOwn(c, 'style')) s += `, style: ${fmtJsonString(c.style)}`;
      if (hasOwn(c, 'color')) s += `, color: ${fmtJsonString(c.color)}`;
      // v0.5.320: pathType を 3 種 (curve/straight/orthogonal) に統合して書き出す。
      // curve は既定のため省略、straight/orthogonal のみ明示。
      if (hasOwn(c, 'pathType') || hasOwn(c, 'straight')) {
        const pathType = c.pathType === 'free-bezier' ? 'curve'
          : c.pathType === 'orthogonal-curve' ? 'orthogonal'
          : c.pathType === 'orthogonal' ? 'orthogonal'
          : (c.pathType === 'straight' || c.straight) ? 'straight' : 'curve';
        s += `, pathType: ${pathType}`;
      }
      if (c.hidden) s += ', hidden: true';
      if (hasOwn(c, 'width') && Number.isFinite(+c.width)) s += ', width: ' + (+c.width);
      if (c.styleRef) s += ', styleRef: ' + c.styleRef;
      if (c.semanticId) s += ', semanticId: ' + c.semanticId;
      if (hasOwn(c, 'labelTextColor')) s += `, labelTextColor: ${fmtJsonString(c.labelTextColor)}`;
      if (hasOwn(c, 'labelBgColor')) s += `, labelBgColor: ${fmtJsonString(c.labelBgColor)}`;
      if (hasOwn(c, 'labelBorderColor')) s += `, labelBorderColor: ${fmtJsonString(c.labelBorderColor)}`;
      if (hasOwn(c, 'labelBorderWidth') && Number.isFinite(+c.labelBorderWidth)) s += `, labelBorderWidth: ${+c.labelBorderWidth}`;
      if (hasOwn(c, 'fontBold')) s += `, fontBold: ${c.fontBold ? 'true' : 'false'}`;
      if (hasOwn(c, 'fontItalic')) s += `, fontItalic: ${c.fontItalic ? 'true' : 'false'}`;
      // テキスト表示・沿線回転・自動反転・縁取り太さ (default と異なる場合のみ書き出し)
      if (hasOwn(c, 'textVisible')) s += `, textVisible: ${c.textVisible ? 'true' : 'false'}`;
      if (hasOwn(c, 'textAlongPath')) s += `, textAlongPath: ${c.textAlongPath ? 'true' : 'false'}`;
      if (hasOwn(c, 'textAutoFlip')) s += `, textAutoFlip: ${c.textAutoFlip ? 'true' : 'false'}`;
      if (hasOwn(c, 'textShadowWidth') && Number.isFinite(+c.textShadowWidth)) {
        const textShadowWidth = +c.textShadowWidth;
        if (textShadowWidth !== 0 || hasOwn(c, 'textShadowWidth')) s += `, textShadowWidth: ${textShadowWidth}`;
      }
      if (hasOwn(c, 'textShadowColor')) s += `, textShadowColor: ${fmtJsonString(c.textShadowColor)}`;
      if (c.fromAnchor) s += `, fromAnchor: ${c.fromAnchor}`;
      if (c.toAnchor) s += `, toAnchor: ${c.toAnchor}`;
      if (Number.isFinite(+c.branchRatio)) s += `, branchRatio: ${+c.branchRatio}`;
      if (Number.isFinite(+c.cornerRadius)) s += `, cornerRadius: ${+c.cornerRadius}`;
      if (Array.isArray(c.controlPoints) && c.controlPoints.length === 2
          && c.controlPoints[0] && c.controlPoints[1]) {
        const cp = c.controlPoints;
        s += `, controlPoints: [${fmt(cp[0].dx)},${fmt(cp[0].dy)},${fmt(cp[1].dx)},${fmt(cp[1].dy)}]`;
      }
      fm += s + '}\n';
    });
  }
  if (typeof bdSerializeLlmSemanticsFrontmatter === 'function') {
    fm += bdSerializeLlmSemanticsFrontmatter(bd.llmSemantics, { nodeIdMap: m });
  }
  if (bd._preservedFrontmatter) fm += bd._preservedFrontmatter.replace(/\n+$/, '') + '\n';
  fm += '---\n';
  const _escapeBoardHeadingText = (s) => String(s == null ? '' : s).replace(/^(\[img\])/, '\\$1');
  const _escapeBody = (s) => String(s == null ? '' : s).replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').map(line => {
    if (line === '') return '\\';
    if (/^\\+$/.test(line)) return '\\' + line;
    return line.replace(/^(\\*#\s)/, '\\$1');
  }).join('\n');
  let body = '';
  bd.nodes.forEach(n => {
    if (n.img) { body += '# [img]' + n.img + '\n'; if (n.text) body += _escapeBody(n.text) + '\n'; }
    else {
      const lines = n.text.split('\n');
      body += '# ' + _escapeBoardHeadingText(lines[0]) + '\n';
      if (lines.length > 1) body += _escapeBody(lines.slice(1).join('\n')) + '\n';
    }
    body += '\n';
  });
  const llmContext = typeof bdBuildLlmContextMarkdown === 'function' ? bdBuildLlmContextMarkdown(bd, { nodeIdMap: m }) : '';
  return fm + body + llmContext;
}

// --- リンクツールチップ ---
let _linkTooltipEl = null;
let _linkTooltipOwnerNode = null;
let _linkTooltipTimer = null;
let _linkTooltipToken = 0;
let _linkTooltipSuppressedNode = null;

function _isLinkTooltipSuppressed(nodeDiv) {
  if (!_linkTooltipSuppressedNode) return false;
  if (!document.documentElement.contains(_linkTooltipSuppressedNode)) {
    _linkTooltipSuppressedNode = null;
    return false;
  }
  return nodeDiv === _linkTooltipSuppressedNode || _linkTooltipSuppressedNode.contains(nodeDiv);
}

function _showLinkTooltip(nodeDiv, linkPath, linkType) {
  if (_linkTooltipSuppressedNode && !_linkTooltipSuppressedNode.contains(nodeDiv)) _linkTooltipSuppressedNode = null;
  if (_isLinkTooltipSuppressed(nodeDiv)) return;
  const token = ++_linkTooltipToken;
  clearTimeout(_linkTooltipTimer);
  _linkTooltipTimer = setTimeout(async () => {
    try {
      const resp = await fetch(API_BASE + '/file?path=' + encodeURIComponent(linkPath));
      if (!resp.ok) return;
      const data = await resp.json();
      let text = typeof bdBuildPreviewSummary === 'function'
        ? bdBuildPreviewSummary(linkPath, data.content || '', linkType)
        : (data.content || '');
      text = text.substring(0, 300);
      if (text.length >= 300) text += '\u2026';

      if (token !== _linkTooltipToken || !document.documentElement.contains(nodeDiv)) return;
      if (_linkTooltipOwnerNode && document.documentElement.contains(_linkTooltipOwnerNode)) {
        _linkTooltipOwnerNode.removeAttribute('aria-describedby');
      }
      _linkTooltipOwnerNode = null;
      if (_linkTooltipEl) { _linkTooltipEl.remove(); _linkTooltipEl = null; }
      const tip = document.createElement('div');
      tip.className = 'bd-link-tooltip';
      tip.id = 'bd-link-tooltip-' + token;
      tip.setAttribute('role', 'tooltip');
      tip.setAttribute('aria-hidden', 'false');
      tip.textContent = text || '(\u7a7a)';
      const rect = nodeDiv.getBoundingClientRect();
      const z = (typeof _getZoom === 'function') ? _getZoom() : (parseFloat(document.documentElement.style.zoom) || 1);
      tip.style.left = (rect.left / z) + 'px';
      tip.style.top = (rect.bottom / z + 4) + 'px';
      tip.style.maxWidth = Math.max(180, Math.min(400, window.innerWidth / z - rect.left / z - 20)) + 'px';
      document.body.appendChild(tip);
      if (typeof clampPopupToViewport === 'function') clampPopupToViewport(tip);
      _linkTooltipEl = tip;
      _linkTooltipOwnerNode = nodeDiv;
      nodeDiv.setAttribute('aria-describedby', tip.id);
    } catch {}
  }, 500);
}

function _isLinkTooltipVisible() {
  return !!(_linkTooltipEl && document.documentElement.contains(_linkTooltipEl));
}

function _hideLinkTooltip(options = {}) {
  _linkTooltipToken++;
  clearTimeout(_linkTooltipTimer);
  if (_linkTooltipOwnerNode && document.documentElement.contains(_linkTooltipOwnerNode)) {
    _linkTooltipOwnerNode.removeAttribute('aria-describedby');
  }
  _linkTooltipOwnerNode = null;
  if (_linkTooltipEl) { _linkTooltipEl.remove(); _linkTooltipEl = null; }
  if (options.suppressNode && document.documentElement.contains(options.suppressNode)) {
    _linkTooltipSuppressedNode = options.suppressNode;
  } else if (options.clearSuppression !== false) {
    _linkTooltipSuppressedNode = null;
  }
}

// --- 雲型のクリップパスを動的生成 (楕円ベース + 丸い山) ---
// カードの中心に楕円を配置し、その周囲に半円状の丸い山を並べる。
// 各山は cubic Bezier 1 本で描画。制御点は弦に対して純粋に垂直方向
// （外向き）に伸ばし、magnitude = (4/3) × BUMP_H とする。これにより:
//   - 山は弦に対して対称な半円状の膨らみになり、尖らない
//   - Bezier の t=0.5 の位置がちょうど「弦の中点 + BUMP_H × 垂直外向き」＝peak になる
//   - 隣接する山との間で接線が反転し、谷が自然な V 字の cusp になる（雲らしい境界）
// opts:
//   bumpW:  山の平均幅 (周長基準, px, default 40)。山の個数 = round(周長 / bumpW)
//   bumpH:  山の高さ (弦の中点から外向きの膨らみ, px, default 16)
//   offset: 山の位相ズラし量 (0.0〜1.0, default 0.5)
//   sideW / radius: 未使用 (楕円ベースでは意味を持たない)
function _bdCloudClipPath(width, height, opts) {
  if (!(width > 4) || !(height > 4)) return '';
  const BUMP_W = Math.max(8, opts?.bumpW || 40);
  const BUMP_H = Math.max(2, opts?.bumpH || 16);
  const OFFSET = Math.max(0, Math.min(1, opts?.offset ?? 0.5));
  // 小山比率 (0〜100%)。幅・高さを個別に設定。両方 > 0 のとき小山が現れる。
  const SUB_W_PCT = Math.max(0, Math.min(100, +opts?.subWidth || 0));
  const SUB_H_PCT = Math.max(0, Math.min(100, +opts?.subHeight || 0));
  const SUB_ENABLED = SUB_W_PCT > 0 && SUB_H_PCT > 0;
  const SUB_W_RATIO = SUB_W_PCT / 100;
  const SUB_H_RATIO = SUB_H_PCT / 100;

  const cx = width / 2;
  const cy = height / 2;
  const effBumpH = Math.min(BUMP_H, Math.min(cx, cy) - 2);
  if (effBumpH < 2) return '';
  const rx = cx - effBumpH;
  const ry = cy - effBumpH;

  const hVal = Math.pow((rx - ry) / (rx + ry), 2);
  const perim = Math.PI * (rx + ry) * (1 + 3 * hVal / (10 + Math.sqrt(4 - 3 * hVal)));

  // 1 スロット = メイン山 (+ 任意で小山)。メイン山は BUMP_W 幅を保ち、小山は BUMP_W*SUB_W_RATIO 幅。
  const slotWidth = SUB_ENABLED ? BUMP_W * (1 + SUB_W_RATIO) : BUMP_W;
  const numSlots = Math.max(SUB_ENABLED ? 3 : 6, Math.round(perim / slotWidth));
  const numBumps = SUB_ENABLED ? numSlots * 2 : numSlots;
  const periodAngle = (2 * Math.PI) / numSlots;
  const angleMain = SUB_ENABLED ? periodAngle / (1 + SUB_W_RATIO) : periodAngle;
  const angleSub = SUB_ENABLED ? angleMain * SUB_W_RATIO : 0;
  const baseAngle = -Math.PI / 2 + OFFSET * periodAngle;

  const ellipsePoint = (t) => ({
    x: cx + rx * Math.cos(t),
    y: cy + ry * Math.sin(t),
  });

  const fmt = (n) => n.toFixed(2);
  let angle = baseAngle;
  const v0 = ellipsePoint(angle);
  let d = `M ${fmt(v0.x)} ${fmt(v0.y)}`;

  for (let i = 0; i < numBumps; i++) {
    const isSub = SUB_ENABLED && (i % 2 === 1);
    const bumpAngle = isSub ? angleSub : angleMain;
    const hMul = isSub ? SUB_H_RATIO : 1;
    const mLen = (4 / 3) * effBumpH * hMul;

    const tStart = angle;
    const tEnd = angle + bumpAngle;
    angle = tEnd;
    const vStart = ellipsePoint(tStart);
    const vEnd = ellipsePoint(tEnd);

    const mx = (vStart.x + vEnd.x) / 2;
    const my = (vStart.y + vEnd.y) / 2;
    const chordX = vEnd.x - vStart.x;
    const chordY = vEnd.y - vStart.y;
    const chordLen = Math.hypot(chordX, chordY);
    if (chordLen < 0.001) continue;
    let perpX = -chordY / chordLen;
    let perpY = chordX / chordLen;
    if (perpX * (mx - cx) + perpY * (my - cy) < 0) { perpX = -perpX; perpY = -perpY; }

    const offX = mLen * perpX;
    const offY = mLen * perpY;
    const p1x = vStart.x + offX;
    const p1y = vStart.y + offY;
    const p2x = vEnd.x + offX;
    const p2y = vEnd.y + offY;

    d += ` C ${fmt(p1x)} ${fmt(p1y)}, ${fmt(p2x)} ${fmt(p2y)}, ${fmt(vEnd.x)} ${fmt(vEnd.y)}`;
  }
  d += ' Z';
  return `path('${d}')`;
}

// --- トゲ型 (直線) のクリップパスを動的生成 (楕円ベース) ---
// カードの中心に楕円を配置し、その周囲に放射状に尖った山を並べる形状。
// 雲型と同じパラメータを共有するが、ベース形状が矩形でなく楕円。
// opts:
//   bumpW:  山の平均幅 (周長基準, px, default 40)。山の個数 = round(周長 / bumpW)
//   bumpH:  トゲの高さ (楕円の外側に radial 方向で張り出す量, px, default 16)
//   offset: 山の位相ズラし量 (0.0〜1.0, default 0.5)。基準角度を stepAngle * OFFSET だけ回転
//   sideW / radius: 未使用 (楕円ベースでは左右辺区別も角丸も不要)
// path は valley と peak をアンカーに持つ直線 (L) の連続。完全な polygon 相当で、peak が鋭く尖り、
// 輪郭も曲線にならない。
function _bdThornClipPath(width, height, opts) {
  if (!(width > 4) || !(height > 4)) return '';
  const BUMP_W = Math.max(8, opts?.bumpW || 40);
  const BUMP_H = Math.max(2, opts?.bumpH || 16);
  const OFFSET = Math.max(0, Math.min(1, opts?.offset ?? 0.5));
  const SUB_W_PCT = Math.max(0, Math.min(100, +opts?.subWidth || 0));
  const SUB_H_PCT = Math.max(0, Math.min(100, +opts?.subHeight || 0));
  const SUB_ENABLED = SUB_W_PCT > 0 && SUB_H_PCT > 0;
  const SUB_W_RATIO = SUB_W_PCT / 100;
  const SUB_H_RATIO = SUB_H_PCT / 100;

  const cx = width / 2;
  const cy = height / 2;
  const effBumpH = Math.min(BUMP_H, Math.min(cx, cy) - 2);
  if (effBumpH < 2) return '';
  const rx = cx - effBumpH;
  const ry = cy - effBumpH;

  const hVal = Math.pow((rx - ry) / (rx + ry), 2);
  const perim = Math.PI * (rx + ry) * (1 + 3 * hVal / (10 + Math.sqrt(4 - 3 * hVal)));

  const slotWidth = SUB_ENABLED ? BUMP_W * (1 + SUB_W_RATIO) : BUMP_W;
  const numSlots = Math.max(SUB_ENABLED ? 3 : 6, Math.round(perim / slotWidth));
  const numBumps = SUB_ENABLED ? numSlots * 2 : numSlots;
  const periodAngle = (2 * Math.PI) / numSlots;
  const angleMain = SUB_ENABLED ? periodAngle / (1 + SUB_W_RATIO) : periodAngle;
  const angleSub = SUB_ENABLED ? angleMain * SUB_W_RATIO : 0;
  const baseAngle = -Math.PI / 2 + OFFSET * periodAngle;

  const ellipsePoint = (t) => ({
    x: cx + rx * Math.cos(t),
    y: cy + ry * Math.sin(t),
  });
  const peakAt = (t, hMul) => ({
    x: cx + (rx + effBumpH * hMul) * Math.cos(t),
    y: cy + (ry + effBumpH * hMul) * Math.sin(t),
  });

  const fmt = (n) => n.toFixed(2);
  let angle = baseAngle;
  const v0 = ellipsePoint(angle);
  let d = `M ${fmt(v0.x)} ${fmt(v0.y)}`;
  for (let i = 0; i < numBumps; i++) {
    const isSub = SUB_ENABLED && (i % 2 === 1);
    const bumpAngle = isSub ? angleSub : angleMain;
    const hMul = isSub ? SUB_H_RATIO : 1;
    const tMid = angle + bumpAngle / 2;
    angle += bumpAngle;
    const vEnd = ellipsePoint(angle);
    const peak = peakAt(tMid, hMul);
    d += ` L ${fmt(peak.x)} ${fmt(peak.y)} L ${fmt(vEnd.x)} ${fmt(vEnd.y)}`;
  }
  d += ' Z';
  return `path('${d}')`;
}

// --- トゲ型 (曲線) のクリップパスを動的生成 (楕円ベース) ---
// 既存のトゲ型 (直線) と違い、各トゲの左右側面が内向きにくぼむ曲線で鋭い先端を作る爆発フキダシ風。
//
// 設計方針 (peak アンカー方式):
//   - path のアンカーポイントは peak のみ。valley はアンカーを置かず、
//     隣接 peak 間を結ぶ cubic Bezier の「谷」として暗黙的に発生する。
//   - これで valley 近辺の接線問題 (連続・不連続どちらでも出る弊害) が構造的に発生しない。
//   - peak は path 上で接線不連続となり、必ず鋭い尖りになる。
//   - 隣接 peak 間 Bezier の制御点を「peak 相手方向 × TPULL + 中心方向 × DEPTH」で配置して
//     2 peak 間に内向きに凹む谷を自然に作る。
// パラメータは _bdThornClipPath と同一 (共通スタイル設定を流用)。
function _bdThornCurveClipPath(width, height, opts) {
  if (!(width > 4) || !(height > 4)) return '';
  const BUMP_W = Math.max(8, opts?.bumpW || 40);
  const BUMP_H = Math.max(2, opts?.bumpH || 16);
  const OFFSET = Math.max(0, Math.min(1, opts?.offset ?? 0.5));
  const SUB_W_PCT = Math.max(0, Math.min(100, +opts?.subWidth || 0));
  const SUB_H_PCT = Math.max(0, Math.min(100, +opts?.subHeight || 0));
  const SUB_ENABLED = SUB_W_PCT > 0 && SUB_H_PCT > 0;
  const SUB_W_RATIO = SUB_W_PCT / 100;
  const SUB_H_RATIO = SUB_H_PCT / 100;
  // 制御点を相手 peak 方向に引き寄せる距離比 (弦長 peak-peak × TPULL)。0.5 で cubic の定石位置に近い。
  const TPULL = 0.33;
  // 谷の深さ (effBumpH × DEPTH_RATIO)。制御点を中心方向にこの距離だけオフセットし、谷の底の深さを決める。
  const DEPTH_RATIO = 0.9;

  const cx = width / 2;
  const cy = height / 2;
  const effBumpH = Math.min(BUMP_H, Math.min(cx, cy) - 2);
  if (effBumpH < 2) return '';
  const rx = cx - effBumpH;
  const ry = cy - effBumpH;

  const hVal = Math.pow((rx - ry) / (rx + ry), 2);
  const perim = Math.PI * (rx + ry) * (1 + 3 * hVal / (10 + Math.sqrt(4 - 3 * hVal)));

  const slotWidth = SUB_ENABLED ? BUMP_W * (1 + SUB_W_RATIO) : BUMP_W;
  const numSlots = Math.max(SUB_ENABLED ? 3 : 6, Math.round(perim / slotWidth));
  const numBumps = SUB_ENABLED ? numSlots * 2 : numSlots;
  const periodAngle = (2 * Math.PI) / numSlots;
  const angleMain = SUB_ENABLED ? periodAngle / (1 + SUB_W_RATIO) : periodAngle;
  const angleSub = SUB_ENABLED ? angleMain * SUB_W_RATIO : 0;
  const baseAngle = -Math.PI / 2 + OFFSET * periodAngle;

  const peakAt = (t, hMul) => ({
    x: cx + (rx + effBumpH * hMul) * Math.cos(t),
    y: cy + (ry + effBumpH * hMul) * Math.sin(t),
  });

  // 各 peak の座標と個別の hMul を事前計算する。
  // 1 主山ごとのサイクル: 主山 peak → (小山 peak) → 次の主山 peak ...。
  // 角度の配置は直線トゲ / 雲型と同じ (角度的に等間隔なスロット。小山は主山の合間)。
  const peaks = [];
  let angle = baseAngle;
  for (let i = 0; i < numBumps; i++) {
    const isSub = SUB_ENABLED && (i % 2 === 1);
    const bumpAngle = isSub ? angleSub : angleMain;
    const hMul = isSub ? SUB_H_RATIO : 1;
    const tMid = angle + bumpAngle / 2;
    angle += bumpAngle;
    peaks.push(peakAt(tMid, hMul));
  }

  const fmt = (n) => n.toFixed(2);
  let d = `M ${fmt(peaks[0].x)} ${fmt(peaks[0].y)}`;
  for (let i = 0; i < numBumps; i++) {
    const p0 = peaks[i];
    const p1 = peaks[(i + 1) % numBumps];

    // 弦 p0 → p1 の中点から中心へ向かう単位ベクトル
    const mx = (p0.x + p1.x) / 2;
    const my = (p0.y + p1.y) / 2;
    const dxc = cx - mx;
    const dyc = cy - my;
    const lenc = Math.hypot(dxc, dyc);
    const inX = lenc > 0.001 ? dxc / lenc : 0;
    const inY = lenc > 0.001 ? dyc / lenc : 0;

    // 2 peak 間 cubic の制御点:
    //   c1 = p0 + (p1 - p0) × TPULL + inDir × depth
    //   c2 = p1 + (p0 - p1) × TPULL + inDir × depth
    // 両制御点を中心方向に depth ずつオフセットすることで、Bezier の中間が中心寄りに凹み、谷になる。
    const depth = effBumpH * DEPTH_RATIO;
    const c1x = p0.x + (p1.x - p0.x) * TPULL + inX * depth;
    const c1y = p0.y + (p1.y - p0.y) * TPULL + inY * depth;
    const c2x = p1.x + (p0.x - p1.x) * TPULL + inX * depth;
    const c2y = p1.y + (p0.y - p1.y) * TPULL + inY * depth;

    d += ` C ${fmt(c1x)} ${fmt(c1y)}, ${fmt(c2x)} ${fmt(c2y)}, ${fmt(p1.x)} ${fmt(p1.y)}`;
  }
  d += ' Z';
  return `path('${d}')`;
}

// --- もやもや型 (雲型のバリアント、谷が丸くなだらかな波) のクリップパスを動的生成 ---
// v0.5.250 追加。雲型が「山:cubic Bezier / 谷:アンカー (接線不連続で鋭い凹み)」なのに対し、
// もやもやは山・谷ともに滑らかな曲線でつながる。
// 実装: 半径を r(θ) = rBase + amp * cos(numBumps * θ) で角度方向に波打たせ、周上を細かくサンプル。
// サンプル点列を閉じた Catmull-Rom → Cubic Bezier に変換して描画 (C1 連続 = 全アンカーで接線が一致)。
// opts: 雲型と共通 (bumpW, bumpH, offset, subWidth, subHeight)。小山はもやもやでは振幅を細かく変調する副波として扱う。
function _bdFluffyClipPath(width, height, opts) {
  if (!(width > 4) || !(height > 4)) return '';
  const BUMP_W = Math.max(8, opts?.bumpW || 40);
  const BUMP_H = Math.max(2, opts?.bumpH || 16);
  const OFFSET = Math.max(0, Math.min(1, opts?.offset ?? 0.5));
  const SUB_W_PCT = Math.max(0, Math.min(100, +opts?.subWidth || 0));
  const SUB_H_PCT = Math.max(0, Math.min(100, +opts?.subHeight || 0));
  const SUB_ENABLED = SUB_W_PCT > 0 && SUB_H_PCT > 0;
  const SUB_W_RATIO = SUB_W_PCT / 100;
  const SUB_H_RATIO = SUB_H_PCT / 100;

  const cx = width / 2;
  const cy = height / 2;
  const effBumpH = Math.min(BUMP_H, Math.min(cx, cy) - 2);
  if (effBumpH < 2) return '';
  // 基礎楕円: 波の中心線。bumpH の半分だけ内側に置き、山は +amp、谷は -amp で対称に振らせる。
  const rxBase = cx - effBumpH / 2;
  const ryBase = cy - effBumpH / 2;
  if (rxBase <= 1 || ryBase <= 1) return '';
  const amp = effBumpH / 2;
  const rMin = Math.min(rxBase, ryBase);

  const hVal = Math.pow((rxBase - ryBase) / (rxBase + ryBase), 2);
  const perim = Math.PI * (rxBase + ryBase) * (1 + 3 * hVal / (10 + Math.sqrt(4 - 3 * hVal)));
  const numBumps = Math.max(6, Math.round(perim / BUMP_W));

  const periodAngle = (2 * Math.PI) / numBumps;
  const baseAngle = -Math.PI / 2 + OFFSET * periodAngle;
  // 山 1 つあたり 6 サンプル (山頂・谷の間も滑らかに描くため密に取る)
  const steps = numBumps * 6;

  // 副波: 小山設定があれば、主波 numBumps の 2 倍周波で副波を足し込み、輪郭を揺らす。
  const subFreq = SUB_ENABLED ? numBumps * 2 : 0;
  const subAmpRatio = SUB_ENABLED ? SUB_H_RATIO * 0.4 : 0;
  const subWidthShape = SUB_ENABLED ? Math.max(0.35, 2 - SUB_W_RATIO * 1.65) : 1;

  const pts = [];
  for (let i = 0; i < steps; i++) {
    const t = baseAngle + (i / steps) * 2 * Math.PI;
    const phase = t - baseAngle;
    let wave = Math.cos(numBumps * phase);
    if (subFreq > 0) {
      const subWave = Math.cos(subFreq * phase);
      wave += subAmpRatio * Math.sign(subWave) * Math.pow(Math.abs(subWave), subWidthShape);
    }
    const rMul = 1 + (amp / rMin) * wave;
    pts.push({
      x: cx + rxBase * rMul * Math.cos(t),
      y: cy + ryBase * rMul * Math.sin(t),
    });
  }

  const fmt = (n) => n.toFixed(2);
  // 閉じた Catmull-Rom → Cubic Bezier (張力 k = 1/6)。全アンカーで接線が連続になるため山も谷も丸い。
  const n = pts.length;
  let d = `M ${fmt(pts[0].x)} ${fmt(pts[0].y)}`;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n];
    const p1 = pts[i];
    const p2 = pts[(i + 1) % n];
    const p3 = pts[(i + 2) % n];
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${fmt(c1x)} ${fmt(c1y)}, ${fmt(c2x)} ${fmt(c2y)}, ${fmt(p2.x)} ${fmt(p2.y)}`;
  }
  d += ' Z';
  return `path('${d}')`;
}

// --- シェイプに応じたテキスト安全域のパディングを計算 ---
// 楕円・雲型・トゲ型 (直線/曲線) は矩形と違って内側にテキストを収める必要がある。
// 楕円に内接する矩形 (半径の 1/√2 倍) を基準に、bbox 端からの距離をパディングとして返す。
// returns { padX, padY } in px.
function _bdComputeShapePadding(shape, width, height, nodeStyle) {
  if (!(width > 0) || !(height > 0)) return null;
  const cx = width / 2;
  const cy = height / 2;
  let effBumpH = 0;
  if (shape === 'cloud' || shape === 'thorn' || shape === 'thorn-curve' || shape === 'fluffy') {
    const bh = Math.max(2, +(nodeStyle?.cloudBumpHeight) || 16);
    effBumpH = Math.min(bh, Math.min(cx, cy) - 2);
    if (effBumpH < 0) effBumpH = 0;
  }
  // 楕円半径 (cloud/thorn は山の分だけ内側、ellipse は bbox いっぱい)
  const rx = Math.max(1, cx - effBumpH);
  const ry = Math.max(1, cy - effBumpH);
  const SQRT2_INV = Math.SQRT1_2;
  // 内接矩形: 半径 * 1/√2。パディング = 中心との距離 - 内接矩形の半幅
  const padX = Math.max(8, Math.round(cx - rx * SQRT2_INV + 2));
  const padY = Math.max(6, Math.round(cy - ry * SQRT2_INV + 2));
  return { padX, padY };
}

// --- テキストに滑らかな丸フチを SVG filter で適用 ---
// feMorphology (dilate) は SVG 仕様上「矩形カーネル」で膨張するため、フチが太いと角が斜めに
// 切り落とされた (菱形 / 八角形っぽい) 見た目になる。代わりに feGaussianBlur + feComponentTransfer
// (discrete 閾値) の組合せで円形膨張を実現する。
// 流れ:
//   1. テキストアルファをガウシアンブラーで円形にぼかす (ブラーカーネルは等方ガウシアン = 円形)
//   2. feFuncA type="discrete" で閾値処理してぼかしを 2 値化 → 円形に膨張したマスクになる
//   3. マスクを指定色で塗りつぶし、元のテキストと合成
function _bdApplyTextOutline(txt, width, color, nodeKey) {
  if (!txt) return;
  const parent = txt.parentNode;
  if (parent) {
    const old = parent.querySelector(`:scope > svg.bd-txt-outline-svg[data-key="${nodeKey}"]`);
    if (old) old.remove();
  }
  const w = Math.max(0, +width || 0);
  if (w <= 0 || !color || !parent) {
    txt.style.filter = '';
    return;
  }
  const svgNS = 'http://www.w3.org/2000/svg';
  const filterId = `bd-txt-outline-${nodeKey}`;
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('class', 'bd-txt-outline-svg');
  svg.setAttribute('data-key', String(nodeKey));
  svg.setAttribute('aria-hidden', 'true');
  svg.style.cssText = 'position:absolute;width:0;height:0;pointer-events:none;';
  const defs = document.createElementNS(svgNS, 'defs');
  const filter = document.createElementNS(svgNS, 'filter');
  filter.setAttribute('id', filterId);
  // フチがぼかしで広がるため、filter region を広めに確保 (太いフチ対応)
  filter.setAttribute('x', '-50%');
  filter.setAttribute('y', '-50%');
  filter.setAttribute('width', '200%');
  filter.setAttribute('height', '200%');
  filter.setAttribute('color-interpolation-filters', 'sRGB');
  // 1. アルファを円形ガウシアンブラー
  //    stdDeviation を小さめに (w × 0.6) することで細いテキストでも中心アルファが残り、
  //    ブラー後に消えてしまうのを防ぐ。フチ厚さは下の閾値と組み合わせて w に近づくよう調整。
  const blur = document.createElementNS(svgNS, 'feGaussianBlur');
  blur.setAttribute('in', 'SourceAlpha');
  blur.setAttribute('stdDeviation', (w * 0.6).toFixed(3));
  blur.setAttribute('result', 'blurred');
  filter.appendChild(blur);
  // 2. 閾値処理で 2 値化。tableValues="0 1 1 1" → 4 セグメントで先頭のみ 0 → 閾値 0.25。
  //    閾値 0.5 (tableValues="0 1") だと細いテキストでブラー後に α が 0.5 未満になり、
  //    マスクが全て 0 になってフチが消失してしまう。閾値を 0.25 に下げて確実にマスクを残す。
  const threshold = document.createElementNS(svgNS, 'feComponentTransfer');
  threshold.setAttribute('in', 'blurred');
  threshold.setAttribute('result', 'mask');
  const funcA = document.createElementNS(svgNS, 'feFuncA');
  funcA.setAttribute('type', 'discrete');
  funcA.setAttribute('tableValues', '0 1 1 1');
  threshold.appendChild(funcA);
  filter.appendChild(threshold);
  // 3. マスクを指定色で塗りつぶし
  const flood = document.createElementNS(svgNS, 'feFlood');
  flood.setAttribute('flood-color', color);
  flood.setAttribute('result', 'color');
  filter.appendChild(flood);
  const comp = document.createElementNS(svgNS, 'feComposite');
  comp.setAttribute('in', 'color');
  comp.setAttribute('in2', 'mask');
  comp.setAttribute('operator', 'in');
  comp.setAttribute('result', 'outlined');
  filter.appendChild(comp);
  // 4. フチ (下) + 元のテキスト (上) を合成
  const merge = document.createElementNS(svgNS, 'feMerge');
  const mergeNode1 = document.createElementNS(svgNS, 'feMergeNode');
  mergeNode1.setAttribute('in', 'outlined');
  merge.appendChild(mergeNode1);
  const mergeNode2 = document.createElementNS(svgNS, 'feMergeNode');
  mergeNode2.setAttribute('in', 'SourceGraphic');
  merge.appendChild(mergeNode2);
  filter.appendChild(merge);
  defs.appendChild(filter);
  svg.appendChild(defs);
  parent.insertBefore(svg, txt);
  txt.style.filter = `url(#${filterId})`;
}

// --- 雲型のクリップパスと枠線を適用 ---
// カード本体の CSS 背景を透明化し、SVG オーバーレイで雲型の fill (背景色) と
// stroke (枠線) をまとめて描画する。stroke は stroke-width = 2 × borderWidth で
// 描画し、paint-order="stroke fill" で stroke の内側半分を fill が上書きする。
// 結果として stroke の外側半分 (= borderWidth px) だけが可視となり、
// 雲型の輪郭に沿った「外側の枠線」となる。
// clip-path はカード div にかけず、SVG の overflow: visible を利用して
// 外側 stroke がカードの矩形 bbox を超えて描画できるようにする。
function _bdApplyCloudShape(div, pathStr, borderColor, borderWidth, bgColor) {
  const svgNS = 'http://www.w3.org/2000/svg';
  let svg = div.querySelector(':scope > svg.bd-cloud-border-svg');
  const bw = Math.max(0, +borderWidth || 0);
  const bc = borderColor || '';
  const bg = bgColor || '';
  const w = div.offsetWidth || 1;
  const h = div.offsetHeight || 1;
  // clip-path / CSS border / bg は SVG に任せるので透明化・解除
  div.style.clipPath = '';
  div.style.background = 'transparent';
  div.style.borderWidth = '0';
  div.style.borderColor = 'transparent';
  div.style.borderStyle = 'none';
  // 外側 stroke が見切れないよう overflow を解除
  div.style.overflow = 'visible';
  if (bw > 0 && bc || bg) {
    if (!svg) {
      svg = document.createElementNS(svgNS, 'svg');
      svg.setAttribute('class', 'bd-cloud-border-svg');
      svg.setAttribute('preserveAspectRatio', 'none');
      svg.setAttribute('overflow', 'visible');
      svg.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;overflow:visible;z-index:0;';
      const p = document.createElementNS(svgNS, 'path');
      // paint-order="stroke fill": stroke を先に描画 → fill が内側半分を上書き
      // → stroke の外側半分のみが残り、外側の枠線になる
      p.setAttribute('paint-order', 'stroke fill');
      svg.appendChild(p);
      div.insertBefore(svg, div.firstChild);
    }
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    const p = svg.querySelector('path');
    const d = pathStr.replace(/^path\(['"]?/, '').replace(/['"]?\)$/, '');
    p.setAttribute('d', d);
    p.setAttribute('fill', bg || 'transparent');
    // 形状ごとの stroke 接続方式:
    //   - トゲ (直線/曲線): peak を鋭く尖らせたいので miter + 大きな miterlimit
    //     (鋭角で miterlimit を超えて自動 bevel にならないよう miterlimit=40)
    //     曲線トゲも peak がアンカーで接線不連続なので miter が効く。
    //   - その他 (雲など): 角を丸める round
    const shape = div.dataset.shape || '';
    if (shape === 'thorn' || shape === 'thorn-curve') {
      p.setAttribute('stroke-linejoin', 'miter');
      p.setAttribute('stroke-miterlimit', '40');
    } else {
      p.setAttribute('stroke-linejoin', 'round');
      p.removeAttribute('stroke-miterlimit');
    }
    if (bw > 0 && bc) {
      p.setAttribute('stroke', bc);
      // stroke-width = 2*bw → stroke の外側半分 (= bw px) のみが可視となる
      p.setAttribute('stroke-width', String(bw * 2));
    } else {
      p.setAttribute('stroke', 'none');
      p.removeAttribute('stroke-width');
    }
    // v0.5.244 で選択ハイライトを bbox 矩形 (`.bd-selection-rect`) に変更したため、
    // 旧 `.bd-selection-ring` への clipPath 同期は不要になった。
  } else if (svg) {
    svg.remove();
  }
}

// --- レンダリング ---
function bdGetRenderableNodesContainer() {
  const root = (typeof bdGetActiveBoardRoot === 'function') ? bdGetActiveBoardRoot() : null;
  const canvas = (typeof bdGetBoardElement === 'function')
    ? bdGetBoardElement('canvas', root)
    : document.getElementById('bd-canvas');
  const container = (typeof bdGetBoardElement === 'function')
    ? bdGetBoardElement('nodes', root)
    : document.getElementById('bd-nodes');
  if (!canvas || !container || !canvas.isConnected || !container.isConnected) return null;
  if (typeof getComputedStyle === 'function') {
    let el = canvas;
    let guard = 0;
    while (el && el !== document.body && guard < 8) {
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') return null;
      el = el.parentElement;
      guard += 1;
    }
  }
  return container;
}

function bdRender() {
  const _bdRenderPerf = typeof bdPerfStart === 'function' ? bdPerfStart('bdRender') : 0;
  const container = bdGetRenderableNodesContainer();
  if (!container) {
    if (typeof bdPerfEnd === 'function') bdPerfEnd('bdRender', _bdRenderPerf, 'skip:no-active-board-dom');
    return false;
  }
  // 全再描画時はミニマップキャッシュも無効化 (ノード数/スタイルが変わっている可能性)
  if (typeof bdInvalidateMinimapCache === 'function') bdInvalidateMinimapCache();
  container.innerHTML = '';
  const boardRoot = container.closest?.('.gb-canvas-root') || null;
  const boardEl = (role, fallbackId) => boardRoot?.querySelector?.(`[data-bd-role="${role}"]`)
    || ((typeof bdGetBoardElement === 'function') ? bdGetBoardElement(role, boardRoot) : document.getElementById(fallbackId));
  // 影の有無でキャンバスにクラス付与 (ラインの SVG 影を CSS で制御するため)
  const canvasEl = boardEl('canvas', 'bd-canvas');
  if (canvasEl) canvasEl.classList.toggle('bd-shadow-on', !!bd._showShadow);
  if (typeof MeldexThemeManager !== 'undefined' && typeof MeldexThemeManager.applyBoardThemeRuntime === 'function') {
    MeldexThemeManager.applyBoardThemeRuntime(bd, canvasEl, boardEl('world', 'bd-world'));
  }
  if (typeof bdApplyBoardFontVariables === 'function') bdApplyBoardFontVariables(canvasEl, boardEl('world', 'bd-world'));
  if (typeof bdScheduleFontStyleMapUpdate === 'function') bdScheduleFontStyleMapUpdate();
  // 折りたたまれた子孫のIDを収集
  const hiddenIds = new Set();
  bd.nodes.forEach(n => {
    if (n.collapsed) bdDescendants(n.id).forEach(id => hiddenIds.add(id));
  });
  const parentChildGroupColors = (bd.displayFilters?.highlightParentChildGroups === true && typeof _bdParentChildGroups === 'function')
    ? _bdParentChildGroups({
      hiddenIds,
      drillRoot: (typeof _bdDrillRoot !== 'undefined' && _bdDrillRoot) ? _bdDrillRoot : '',
    })
    : new Map();
  const renderContext = typeof bdCreateRenderContext === 'function'
    ? bdCreateRenderContext({ hiddenIds, parentChildGroupColors, fastCardRender: false })
    : { hiddenIds, parentChildGroupColors, fastCardRender: false };
  const renderFrag = document.createDocumentFragment();
  const renderedNodes = [];
  bd.nodes.forEach(n => {
    const div = typeof bdRenderNode === 'function'
      ? bdRenderNode(n, { renderContext })
      : null;
    if (!div) return;
    renderFrag.appendChild(div);
    renderedNodes.push({ n, div });
  });
  container.appendChild(renderFrag);
  renderedNodes.forEach(({ n, div }) => {
    if (typeof bdMeasureNodeElement === 'function') bdMeasureNodeElement(n, div);
    else { n._rw = div.offsetWidth; n._rh = div.offsetHeight; }
  });
  if (typeof bdShouldDeferBoardExtras === 'function' && bdShouldDeferBoardExtras()) {
    if (typeof bdMarkConnectionsDirtyByNodes === 'function') bdMarkConnectionsDirtyByNodes(renderedNodes.map(item => item.n.id), 'render-deferred');
    if (typeof bdMarkSelectionDirty === 'function') bdMarkSelectionDirty(renderedNodes.map(item => item.n.id));
    if (typeof bdMarkExtrasDirty === 'function') bdMarkExtrasDirty({ frames: true, minimap: true, boardUi: true, comments: renderedNodes.map(item => item.n.id) }, 'render-deferred');
    if (typeof bdScheduleBoardUpdates === 'function') bdScheduleBoardUpdates();
    else if (typeof bdRequestBoardExtras === 'function') bdRequestBoardExtras();
  } else {
    bdSyncResizeHandles();
    bdDrawConns();
    bdDrawFrames();
    if (typeof bdSyncBoardUi === 'function') bdSyncBoardUi();
    if (typeof CommentBadges !== 'undefined' && bd.path) {
      try { CommentBadges.refreshBoard(bd.path, container); } catch {}
    }
  }
  if (typeof bdPerfEnd === 'function') bdPerfEnd('bdRender', _bdRenderPerf);
  return true;
}
