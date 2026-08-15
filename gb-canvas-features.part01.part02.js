    textStrokeWidth: 0,
    ...overrides,
  };
}
const BD_DEFAULT_DEPTH_STYLES = [
  _BD_DEPTH_CARD(5, { name: '階層1 矩形', cardStyleRef: 'card-theme-rect', lineStyleRef: 'line-theme-standard', fontSize: 16, fontBold: true, width: 200, shape: 'rect', defaultText: 'カード', line: _BD_DEPTH_LINE(5) }),
  _BD_DEPTH_CARD(3, { name: '階層2 楕円', cardStyleRef: 'card-theme-ellipse', lineStyleRef: 'line-theme-standard', fontSize: 14, fontBold: true, width: 180, shape: 'ellipse', borderRadius: 999, defaultText: 'サブカード', line: _BD_DEPTH_LINE(3) }),
  _BD_DEPTH_CARD(0, { name: '階層3 矩形強調', cardStyleRef: 'card-theme-rect', lineStyleRef: 'line-theme-alert', fontSize: 13, fontBold: true, width: 180, shape: 'rect', borderRadius: 8, defaultText: '項目', line: _BD_DEPTH_LINE(0, { width: 4 }) }),
  _BD_DEPTH_CARD(1, { name: '階層4 八角', cardStyleRef: 'card-theme-octagon', lineStyleRef: 'line-theme-dashed', fontSize: 13, fontBold: false, width: 180, shape: 'octagon', borderRadius: 0, defaultText: '詳細', line: _BD_DEPTH_LINE(1, { width: 2, style: 'dashed' }) }),
  _BD_DEPTH_CARD(4, { name: '階層5 ピル', cardStyleRef: 'card-theme-pill', lineStyleRef: 'line-theme-straight', fontSize: 12, fontBold: true, width: 180, shape: 'pill', borderRadius: 999, defaultText: 'メモ', line: _BD_DEPTH_LINE(4, { pathType: 'straight' }) }),
  _BD_DEPTH_CARD(6, { name: '階層6 八角', cardStyleRef: 'card-theme-octagon', lineStyleRef: 'line-theme-emphasis', fontSize: 12, fontBold: true, width: 180, shape: 'octagon', borderRadius: 0, defaultText: '補足', line: _BD_DEPTH_LINE(6, { width: 5, arrow: 'both' }) }),
  _BD_DEPTH_CARD(2, { name: '階層7 雲', cardStyleRef: 'card-theme-cloud', lineStyleRef: 'line-theme-thin', fontSize: 12, fontBold: true, width: 190, shape: 'cloud', borderRadius: 0, defaultText: '注目', cloudBumpWidth: 44, cloudBumpHeight: 16, cloudSideWidth: 14, cloudOffset: 0.45, cloudSubWidthRatio: 55, cloudSubHeightRatio: 50, line: _BD_DEPTH_LINE(2, { width: 1, arrow: '', pathType: 'straight' }) }),
  _BD_DEPTH_CARD(7, { name: '階層8 雲', cardStyleRef: 'card-theme-cloud', lineStyleRef: 'line-theme-reference', fontSize: 12, fontBold: false, width: 190, shape: 'cloud', borderRadius: 0, defaultText: 'メモ', cloudBumpWidth: 44, cloudBumpHeight: 16, cloudSideWidth: 14, cloudOffset: 0.45, cloudSubWidthRatio: 55, cloudSubHeightRatio: 50, line: _BD_DEPTH_LINE(7, { width: 2, style: 'dashed', arrow: 'start', pathType: 'straight' }) }),
  _BD_DEPTH_CARD(4, { name: '階層9 もやもや', cardStyleRef: 'card-theme-fluffy', lineStyleRef: 'line-theme-curve', fontSize: 12, fontBold: false, width: 190, shape: 'fluffy', borderRadius: 0, defaultText: '補足', cloudBumpWidth: 38, cloudBumpHeight: 14, cloudSideWidth: 12, cloudOffset: 0.5, cloudSubWidthRatio: 45, cloudSubHeightRatio: 45, line: _BD_DEPTH_LINE(4, { pathType: 'curve' }) }),
  _BD_DEPTH_CARD(0, { name: '階層10 トゲ直線', cardStyleRef: 'card-theme-thorn', lineStyleRef: 'line-theme-alert', fontSize: 12, fontBold: true, width: 190, shape: 'thorn', borderRadius: 0, defaultText: '注意', cloudBumpWidth: 28, cloudBumpHeight: 18, cloudSideWidth: 10, cloudOffset: 0.5, cloudSubWidthRatio: 0, cloudSubHeightRatio: 0, line: _BD_DEPTH_LINE(0, { width: 4 }) }),
  _BD_DEPTH_CARD(6, { name: '階層11 トゲ曲線', cardStyleRef: 'card-theme-thorn-curve', lineStyleRef: 'line-theme-loop', fontSize: 12, fontBold: true, width: 190, shape: 'thorn-curve', borderRadius: 0, defaultText: '分岐', cloudBumpWidth: 30, cloudBumpHeight: 18, cloudSideWidth: 10, cloudOffset: 0.5, cloudSubWidthRatio: 0, cloudSubHeightRatio: 0, line: _BD_DEPTH_LINE(6, { arrow: 'both', pathType: 'curve' }) }),
];

function _bdDefaultDepthStyles() {
  if (typeof bdBuildDefaultDepthStyles === 'function') {
    return bdBuildDefaultDepthStyles(BD_DEFAULT_DEPTH_STYLES, _BD_EMPTY_DEPTH_LINE, typeof bd !== 'undefined' ? bd : undefined);
  }
  return BD_DEFAULT_DEPTH_STYLES.map(style => ({ ...style, line: { ..._BD_EMPTY_DEPTH_LINE() } }));
}

// 階層別スタイルで扱うカード全項目 (オプションパネル基本タブと同じ項目セット)
// 雲型 / トゲ型 のシェイプ固有パラメータ (cloudBumpWidth 等) は depth.shape が cloud 系のときのみ
// _bdApplyDepthCardFieldsToNode 内で追加適用するため、ここには含めない。
const _BD_DEPTH_CARD_FIELDS = [
  'bgColor', 'textColor', 'borderColor', 'borderWidth', 'borderRadius',
  'fontSize', 'fontBold', 'fontItalic', 'textStrokeColor', 'textStrokeWidth',
  'shape', 'width',
];
const _BD_DEPTH_CLOUD_FIELDS = [
  'cloudBumpWidth', 'cloudBumpHeight', 'cloudOffset',
  'cloudSubWidthRatio', 'cloudSubHeightRatio',
];
const _BD_CLOUD_SHAPES = new Set(['cloud', 'thorn', 'thorn-curve', 'fluffy']);
const _BD_REMOVED_DEPTH_CARD_STYLE_REFS = {
  'card-theme-diamond': 'card-theme-rect',
  'card-theme-hexagon': 'card-theme-octagon',
  'card-theme-star': 'card-theme-cloud',
};

function _bdNormalizeDepthCardStyleRef(value) {
  const id = String(value || '').trim();
  if (!id) return '';
  if (typeof _bdMapLegacyStyleId === 'function' && typeof BD_LEGACY_CARD_STYLE_ID_MAP !== 'undefined') {
    return _bdMapLegacyStyleId(id, BD_LEGACY_CARD_STYLE_ID_MAP);
  }
  return _BD_REMOVED_DEPTH_CARD_STYLE_REFS[id] || id;
}

function _bdNormalizeDepthCardShape(value) {
  const shape = String(value || '').trim();
  if (!shape || shape === 'rect') return shape;
  if (typeof BD_SHAPES !== 'undefined' && BD_SHAPES.includes(shape)) return shape;
  return '';
}
const _BD_DEPTH_LINE_FIELDS = [
  'color', 'width', 'style', 'arrow', 'pathType',
  'branchRatio', 'cornerRadius',
  'labelBgColor', 'labelBorderColor', 'labelBorderWidth', 'labelTextColor',
  'fontBold', 'fontItalic', 'fontFamily',
  'textVisible', 'textAlongPath', 'textAutoFlip', 'textShadowWidth', 'textShadowColor',
];

// depth.line は「指定なし」(空 / 0 / undefined) を保持する。空値のフィールドは
// _bdApplyDepthLineFieldsToConn でスキップされ、ツリー内のラインは既存値を保ったままになる。
function _bdNormalizeDepthLine(raw, _fallback) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const out = {
    color: src.color != null ? String(src.color) : '',
    width: Number.isFinite(+src.width) ? Math.max(0, Math.min(20, +src.width)) : 0,
    style: src.style === 'dashed' ? 'dashed' : '',
    arrow: ['end', 'start', 'both'].includes(src.arrow) ? src.arrow : '',
    // v0.5.320: pathType を 3 種 (curve/straight/orthogonal) に統合。旧 free-bezier は curve、
    // 旧 orthogonal-curve は orthogonal に自動変換。
    pathType: (() => {
      const pt = src.pathType;
      if (pt === 'free-bezier') return 'curve';
      if (pt === 'orthogonal-curve') return 'orthogonal';
      if (['curve', 'straight', 'orthogonal'].includes(pt)) return pt;
      return '';
    })(),
    labelBgColor: src.labelBgColor != null ? String(src.labelBgColor) : '',
    labelBorderColor: src.labelBorderColor != null ? String(src.labelBorderColor) : '',
    labelTextColor: src.labelTextColor != null ? String(src.labelTextColor) : '',
    fontFamily: typeof normalizeFontFamilyValue === 'function' ? normalizeFontFamilyValue(src.fontFamily) : String(src.fontFamily || ''),
    textShadowColor: src.textShadowColor != null ? String(src.textShadowColor) : '',
  };
  if (src.fontBold !== undefined) out.fontBold = !!src.fontBold;
  if (src.fontItalic !== undefined) out.fontItalic = !!src.fontItalic;
  // boolean / 数値の「未指定」は undefined のまま残す (指定時のみキーを持たせる)
  if (src.textVisible !== undefined) out.textVisible = !!src.textVisible;
  if (src.textAlongPath !== undefined) out.textAlongPath = !!src.textAlongPath;
  if (src.textAutoFlip !== undefined) out.textAutoFlip = !!src.textAutoFlip;
  if (Number.isFinite(+src.textShadowWidth)) out.textShadowWidth = Math.max(0, Math.min(10, +src.textShadowWidth));
  if (Number.isFinite(+src.labelBorderWidth)) out.labelBorderWidth = Math.max(0, Math.min(10, +src.labelBorderWidth));
  // v0.5.324: 直角線パラメータを保持
  if (Number.isFinite(+src.branchRatio)) out.branchRatio = Math.max(0.05, Math.min(0.95, +src.branchRatio));
  if (Number.isFinite(+src.cornerRadius)) out.cornerRadius = Math.max(0, Math.min(40, +src.cornerRadius));
  return out;
}

function bdNormalizeDepthStyles(styles) {
  const defaults = _bdDefaultDepthStyles();
  const source = Array.isArray(styles) && styles.length ? styles : defaults;
  const normalized = source.map((entry, index) => {
    const fallback = defaults[Math.min(index, defaults.length - 1)] || defaults[0];
    const raw = entry || fallback;
    const out = {
      name: raw.name != null ? String(raw.name).trim() : (fallback.name || ''),
      cardStyleRef: raw.cardStyleRef != null ? _bdNormalizeDepthCardStyleRef(raw.cardStyleRef) : '',
      lineStyleRef: raw.lineStyleRef != null ? String(raw.lineStyleRef) : '',
      fontSize: Number.isFinite(+raw.fontSize) ? Math.max(8, Math.min(72, +raw.fontSize)) : fallback.fontSize,
      fontBold: raw.fontBold !== undefined ? !!raw.fontBold : fallback.fontBold,
      fontItalic: raw.fontItalic !== undefined ? !!raw.fontItalic : !!fallback.fontItalic,
      fontFamily: typeof normalizeFontFamilyValue === 'function' ? normalizeFontFamilyValue(raw.fontFamily) : String(raw.fontFamily || ''),
      width: Number.isFinite(+raw.width) ? Math.max(40, Math.min(600, +raw.width)) : fallback.width,
      bgColor: raw.bgColor != null ? String(raw.bgColor) : fallback.bgColor,
      textColor: raw.textColor != null ? String(raw.textColor) : (fallback.textColor || ''),
      borderColor: raw.borderColor != null ? String(raw.borderColor) : (fallback.borderColor || ''),
      borderWidth: Number.isFinite(+raw.borderWidth) ? Math.max(0, Math.min(20, +raw.borderWidth)) : (Number.isFinite(+fallback.borderWidth) ? +fallback.borderWidth : 0),
      borderRadius: Number.isFinite(+raw.borderRadius) ? Math.max(0, Math.min(64, +raw.borderRadius)) : (Number.isFinite(+fallback.borderRadius) ? +fallback.borderRadius : 6),
      textStrokeColor: raw.textStrokeColor != null ? String(raw.textStrokeColor) : '',
      textStrokeWidth: Number.isFinite(+raw.textStrokeWidth) ? Math.max(0, Math.min(12, +raw.textStrokeWidth)) : 0,
      shape: raw.shape != null ? _bdNormalizeDepthCardShape(raw.shape) : '',
      // 雲型 / トゲ型 / もやもや型で使われるパラメータ (shape が 'cloud' 等のときのみ意味を持つ)
      cloudBumpWidth: Number.isFinite(+raw.cloudBumpWidth) ? Math.max(8, Math.min(200, +raw.cloudBumpWidth)) : 40,
      cloudBumpHeight: Number.isFinite(+raw.cloudBumpHeight) ? Math.max(2, Math.min(100, +raw.cloudBumpHeight)) : 16,
      cloudOffset: Number.isFinite(+raw.cloudOffset) ? Math.max(0, Math.min(1, +raw.cloudOffset)) : 0.5,
      cloudSubWidthRatio: Number.isFinite(+raw.cloudSubWidthRatio) ? Math.max(0, Math.min(100, +raw.cloudSubWidthRatio)) : 0,
      cloudSubHeightRatio: Number.isFinite(+raw.cloudSubHeightRatio) ? Math.max(0, Math.min(100, +raw.cloudSubHeightRatio)) : 0,
      defaultText: raw.defaultText != null ? String(raw.defaultText) : (fallback.defaultText || 'カード'),
      line: _bdNormalizeDepthLine(raw.line, fallback.line),
    };
    return out;
  });
  return normalized.length ? normalized : defaults.map(style => ({ ...style, line: { ..._bdNormalizeDepthLine(style.line, style.line) } }));
}

function bdEnsureDepthStyles() {
  if (!Array.isArray(bd.depthStyles) || !bd.depthStyles.length) {
    // 空の場合は、ユーザーが「デフォルトとして保存」していればそれを、なければ BD_DEFAULT を使う
    const globalDepth = typeof _bdReadGlobalDepthStyles === 'function' ? _bdReadGlobalDepthStyles() : null;
    const globalIsLegacy = typeof _bdIsLegacyDefaultDepthStyles === 'function' && _bdIsLegacyDefaultDepthStyles(globalDepth);
    if (Array.isArray(globalDepth) && globalDepth.length && !globalIsLegacy) {
      bd.depthStyles = bdNormalizeDepthStyles(globalDepth);
      bd._globalDepthStylesApplied = true;
    } else {
      bd.depthStyles = bdNormalizeDepthStyles([]);
    }
  } else {
    bd.depthStyles = bdNormalizeDepthStyles(bd.depthStyles);
  }
  return bd.depthStyles;
}

// 課題18-案A: 自分自身から親方向へ辿り、最初に見つかった _autoStyle 保持カード
// (= 階層別スタイルの起点) を返す。無ければ null。
// 「絶対ルート決め打ち」だった各所 (bdAddChildToSelected 等) はこの関数の戻り値を起点として使う。
function _bdNearestAutoStyleAnchor(nodeId) {
  if (typeof bd === 'undefined' || !nodeId) return null;
  let cur = bd.nodes.find(v => v.id === nodeId);
  const seen = new Set();
  while (cur) {
    if (cur._autoStyle) return cur;
    if (seen.has(cur.id) || !cur.parent) break;
    seen.add(cur.id);
    cur = bd.nodes.find(v => v.id === cur.parent);
  }
  return null;
}

// nodeId から anchor (自分自身または祖先の起点カード) までの階層差を返す。
// anchor は _bdNearestAutoStyleAnchor(nodeId) 等、nodeId の祖先鎖上にあるものを渡すこと。
function _bdAnchorRelativeDepth(nodeId, anchor) {
  if (!anchor || !nodeId) return 0;
  if (nodeId === anchor.id) return 0;
  if (typeof bdParentDepth !== 'function') return 0;
  return Math.max(0, bdParentDepth(nodeId) - bdParentDepth(anchor.id));
}

// 現在唯一選択されているカードが、それ自身「起点」(_autoStyle) であれば返す。それ以外は null。
// 階層別スタイルタブへ「この起点のプリセット」行を出すかどうかの判定に使う。
function _bdSelectedSoleAnchorNode() {
  if (typeof bd === 'undefined' || !(bd.selected instanceof Set) || bd.selected.size !== 1) return null;
  const id = [...bd.selected][0];
  const node = bd.nodes.find(n => n.id === id);
  return node && node._autoStyle ? node : null;
}

// 課題18-案B: 起点カードの depthStyleRef が指す名前付きプリセットが見つからない場合の
// フォールバック警告。同一起点・同一参照IDでの重複警告 (カード追加のたびに出る等) を防ぐため
// bd._depthPresetRefWarned に記録し、初回のみ showStatus する。
function _bdWarnMissingDepthPresetRef(anchorNode, ref) {
  if (typeof bd === 'undefined' || !anchorNode?.id || !ref) return;
  if (!(bd._depthPresetRefWarned instanceof Set)) bd._depthPresetRefWarned = new Set();
  const key = anchorNode.id + '::' + ref;
  if (bd._depthPresetRefWarned.has(key)) return;
  bd._depthPresetRefWarned.add(key);
  if (typeof showStatus === 'function') {
    showStatus('階層別スタイルのプリセットが見つからないため、ボード共通の階層別スタイルを使用しています', true);
  }
}

// 課題18-案B: anchorNode.depthStyleRef が指す名前付きプリセットのスタイル配列を返す。
// 参照が空、またはプリセットが見つからない場合はボード共通の bd.depthStyles にフォールバックする
// (フォールバック時は _bdWarnMissingDepthPresetRef で一度だけ警告)。
function _bdResolveDepthStylesForAnchor(anchorNode) {
  const ref = anchorNode && typeof anchorNode === 'object' ? String(anchorNode.depthStyleRef || '') : '';
  if (ref) {
    const preset = (typeof MeldexBoardDepthPresets !== 'undefined' && typeof MeldexBoardDepthPresets.find === 'function')
      ? MeldexBoardDepthPresets.find(ref)
      : null;
    if (preset && Array.isArray(preset.styles) && preset.styles.length) {
      return bdNormalizeDepthStyles(preset.styles);
    }
    _bdWarnMissingDepthPresetRef(anchorNode, ref);
  }
  return bdEnsureDepthStyles();
}

// depth (0始まり) に対応する階層別スタイルを返す。
// anchorNode を渡すと、その起点に割り当てられたプリセット (depthStyleRef) があればそれを優先し、
// 無ければボード共通の bd.depthStyles にフォールバックする (課題18-案B)。
// anchorNode を渡さない呼び出し (後方互換) は常にボード共通セットを参照する。
function bdGetAutoStyleForDepth(depth, anchorNode) {
  const styles = _bdResolveDepthStylesForAnchor(anchorNode);
  const idx = Math.min(Math.max(0, depth), styles.length - 1);
  const defaults = _bdDefaultDepthStyles();
  return styles[idx] || defaults[defaults.length - 1];
}

function bdApplyThemeColorsToDepthStyles(options = {}) {
  const styles = bdNormalizeDepthStyles(bd.depthStyles || []);
  const defaults = _bdDefaultDepthStyles();
  const rawPalette = typeof bdGetThemeColorSet === 'function' ? bdGetThemeColorSet(bd) : [];
  const palette = Array.isArray(rawPalette) ? rawPalette : [];
  const applyLineColor = options.applyLineColor !== false;
  styles.forEach((style, index) => {
    const fallback = defaults[Math.min(index, defaults.length - 1)] || defaults[0] || {};
    const color = palette[index % Math.max(1, palette.length)] || fallback.bgColor || '';
    if (!color) return;
    style.bgColor = color;
    style.borderColor = color;
    const textColor = typeof bdReadableTextColor === 'function' ? bdReadableTextColor(color) : '';
    if (textColor) style.textColor = textColor;
    if (applyLineColor) {
      if (!style.line || typeof style.line !== 'object') style.line = _BD_EMPTY_DEPTH_LINE();
      style.line.color = color;
    }
  });
  bd.depthStyles = bdNormalizeDepthStyles(styles);
  return bd.depthStyles;
}

// 階層別カードフィールドを node に適用する。
// - レガシーの 4 フィールド (fontSize/fontBold/bgColor/width) は従来通り常に上書き
//   (既存動作の互換性維持。_userXxx フラグが立っていればスキップ)
// - 新規フィールド (textColor, borderColor, ..., shape) は「指定なし」(空文字列 / undefined)
//   なら触らない。既存のカード個別設定を保持する
function _bdApplyDepthCardFieldsToNode(node, depthStyle) {
  if (!node || !depthStyle) return;
  if (node._userCardStyle) return;
  const guardKey = (field) => '_user' + field.charAt(0).toUpperCase() + field.slice(1);
  _BD_DEPTH_CARD_FIELDS.forEach(field => {
    const guarded = field === 'width' ? node._userW : node[guardKey(field)];
    if (guarded) return;
    const v = depthStyle[field];
    if (field === 'width') {
      if (Number.isFinite(+v)) node.w = +v;
      return;
    }
    // レガシー 4 フィールド: 従来通り空文字列でも上書き
    if (field === 'fontSize' || field === 'fontBold' || field === 'bgColor') {
      if (v !== undefined) node[field] = v;
      return;
    }
    // 新規フィールド: 「指定なし」なら触らない
    if (v === undefined || v === null) return;
    if (typeof v === 'string' && v === '') return;
    node[field] = v;
  });
  // depth が雲型系シェイプを明示しているときのみ、雲型パラメータも適用する
  if (_BD_CLOUD_SHAPES.has(depthStyle.shape)) {
    _BD_DEPTH_CLOUD_FIELDS.forEach(field => {
      const v = depthStyle[field];
      if (!Number.isFinite(+v)) return;
      node[field] = +v;
    });
  }
}

// 階層別ラインスタイルを conn に適用する。
// - style:'' は実線、arrow:'' は矢印なしとして明示適用する
// - 色などの空文字列 / undefined / width 0 の項目はスキップ (既存のラインの値を保持)
// - styleRef があるラインでも個別 override として書き込む (カードの depth 適用と同じ方針)
// - conn._userLineStyle が立っていればすべてスキップ
function _bdApplyDepthLineFieldsToConn(conn, depthStyle) {
  if (!conn || !depthStyle || !depthStyle.line) return;
  if (conn._userLineStyle) return;
  const L = depthStyle.line;
  if (L.color) conn.color = L.color;
  if (Number.isFinite(+L.width) && +L.width > 0) conn.width = +L.width;
  if (Object.prototype.hasOwnProperty.call(L, 'style') && (L.style === 'dashed' || L.style === '')) conn.style = L.style;
  if (Object.prototype.hasOwnProperty.call(L, 'arrow') && (L.arrow === 'end' || L.arrow === 'start' || L.arrow === 'both' || L.arrow === '')) conn.arrow = L.arrow;
  if (L.pathType) {
    conn.pathType = L.pathType;
    delete conn.straight;
  }
  if (Number.isFinite(+L.branchRatio)) conn.branchRatio = Math.max(0.05, Math.min(0.95, +L.branchRatio));
  if (Number.isFinite(+L.cornerRadius)) conn.cornerRadius = Math.max(0, Math.min(40, +L.cornerRadius));
  if (L.labelBgColor) conn.labelBgColor = L.labelBgColor;
  if (L.labelBorderColor) conn.labelBorderColor = L.labelBorderColor;
  if (Number.isFinite(+L.labelBorderWidth)) conn.labelBorderWidth = +L.labelBorderWidth;
  if (L.labelTextColor) conn.labelTextColor = L.labelTextColor;
  if (L.fontBold !== undefined) conn.fontBold = !!L.fontBold;
  if (L.fontItalic !== undefined) conn.fontItalic = !!L.fontItalic;
  if (L.textVisible === false) conn.textVisible = false;
  else if (L.textVisible === true) conn.textVisible = true;
  if (L.textAlongPath !== undefined) conn.textAlongPath = !!L.textAlongPath;
  if (L.textAutoFlip === false) conn.textAutoFlip = false;
  else if (L.textAutoFlip === true) conn.textAutoFlip = true;
  if (Number.isFinite(+L.textShadowWidth)) conn.textShadowWidth = Math.max(0, Math.min(10, +L.textShadowWidth));
  if (L.textShadowColor) conn.textShadowColor = L.textShadowColor;
}

function _bdAutoStyleSignature(value, keys) {
  return keys.map(key => value?.[key]);
}

function bdApplyAutoStyle(rootId) {
  const root = bd.nodes.find(n => n.id === rootId);
  if (!root || !root._autoStyle) return { nodeIds: [], connIds: [] };
  // 課題18-案A: この起点に割り当てられたプリセット (無ければボード共通セット) を1回だけ解決する。
  // 案B の depthStyleRef フォールバック警告もここで1回だけ評価される。
  const styles = _bdResolveDepthStylesForAnchor(root);
  const defaults = _bdDefaultDepthStyles();
  const styleAt = depth => {
    const idx = Math.min(Math.max(0, depth), styles.length - 1);
    return styles[idx] || defaults[defaults.length - 1];
  };
  const nodeDepth = new Map();
  const changedNodeIds = new Set();
  const changedConnIds = new Set();
  const cardKeys = ['cardStyle', 'bgColor', 'textColor', 'borderColor', 'borderWidth', 'borderRadius',
    'fontSize', 'fontBold', 'fontItalic', 'textStrokeColor', 'textStrokeWidth', 'shape', 'w',
    'cloudBumpWidth', 'cloudBumpHeight', 'cloudSideWidth', 'cloudOffset', 'cloudSubWidthRatio',
    'cloudSubHeightRatio'];
  const lineKeys = ['color', 'width', 'style', 'arrow', 'pathType', 'straight', 'branchRatio',
    'cornerRadius', 'labelBgColor', 'labelBorderColor', 'labelBorderWidth', 'labelTextColor',
    'fontBold', 'fontItalic', 'textVisible', 'textAlongPath', 'textAutoFlip', 'textShadowWidth',
    'textShadowColor'];
  function apply(nid, depth) {
    const n = bd.nodes.find(v => v.id === nid); if (!n) return;
    // 課題18-案A: 入れ子の起点 (自分以外の _autoStyle カード) に到達したら、そのカード自身の
    // bdApplyAutoStyle 呼び出しに任せてここで打ち切る。「近い方が勝つ」を、処理順に依存せず
    // データ上で保証する (祖先側の適用が子孫側の起点の値を上書きすることは無い)。
    if (nid !== rootId && n._autoStyle) return;
    nodeDepth.set(nid, depth);
    const before = _bdAutoStyleSignature(n, cardKeys);
    _bdApplyDepthCardFieldsToNode(n, styleAt(depth));
    if (_bdAutoStyleSignature(n, cardKeys).some((value, index) => value !== before[index])) changedNodeIds.add(nid);
    bdChildren(nid).forEach(c => apply(c.id, depth + 1));
  }
  apply(rootId, 0);
  // ライン (親→子) に深さベースのラインスタイルを適用。
  // 補助線・兄弟間ライン・参照線はユーザー個別線として保持する。
  if (Array.isArray(bd.connections)) {
    bd.connections.forEach(c => {
      if (!c) return;
      const d = nodeDepth.get(c.from);
      if (d === undefined) return;
      const toNode = bd.nodes.find(n => n.id === c.to);
      if (!toNode || toNode.parent !== c.from || !nodeDepth.has(c.to)) return;
      const before = _bdAutoStyleSignature(c, lineKeys);
      _bdApplyDepthLineFieldsToConn(c, styleAt(d));
      if (c.id && _bdAutoStyleSignature(c, lineKeys).some((value, index) => value !== before[index])) changedConnIds.add(c.id);
    });
  }
  return { nodeIds: [...changedNodeIds], connIds: [...changedConnIds] };
}
