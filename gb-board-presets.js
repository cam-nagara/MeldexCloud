/* gb-board-presets.js: Board presets, toolbar markup, style previews */

const BD_STYLE_PRESET_VERSION = 10;
const BD_PRESET_THEME_COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899'];

function _bdPresetClone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function _bdPresetThemeColor(index) {
  const palette = BD_PRESET_THEME_COLORS;
  return palette[Math.abs(index | 0) % palette.length] || '#3b82f6';
}

function _bdPresetReadableTextColor(bgColor) {
  const hex = typeof bgColor === 'string' && bgColor.match(/^#([0-9a-f]{6})$/i) ? bgColor : '';
  if (!hex) return '';
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return (r * 0.299 + g * 0.587 + b * 0.114) > 150 ? '#1e1e1e' : '#ffffff';
}

function _bdPresetSafeCssColor(value, fallback = '') {
  const raw = String(value == null ? '' : value).trim();
  if (!raw) return fallback;
  if (raw.length > 120 || /[<>{};\\]/.test(raw) || /url\s*\(|expression\s*\(|@/i.test(raw)) return fallback;
  if (/^#[0-9a-f]{3,8}$/i.test(raw)) return raw;
  if (/^(?:rgba?|hsla?)\([0-9a-z\s.,%/+:-]+\)$/i.test(raw)) return raw;
  if (/^var\(--[A-Za-z0-9_-]+(?:\s*,\s*(?:#[0-9a-f]{3,8}|[A-Za-z]+|(?:rgba?|hsla?)\([0-9a-z\s.,%/+:-]+\)))?\)$/i.test(raw)) return raw;
  if (/^(?:transparent|currentColor|Canvas|CanvasText|AccentColor|AccentColorText)$/i.test(raw)) return raw;
  return /^[A-Za-z]+$/.test(raw) ? raw : fallback;
}

function _bdPresetSafeFontFamily(value) {
  const normalized = typeof normalizeFontFamilyValue === 'function'
    ? normalizeFontFamilyValue(value)
    : String(value == null ? '' : value).trim();
  if (!normalized || normalized.length > 160) return '';
  if (/[<>{};\\]/.test(normalized) || /url\s*\(|expression\s*\(|@/i.test(normalized)) return '';
  return normalized;
}

function _bdPresetClampedNumber(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function _bdPresetBoardThemeColors(board) {
  const palette = typeof bdGetThemeColorSet === 'function' ? bdGetThemeColorSet(board) : null;
  return Array.isArray(palette) && palette.length ? palette : BD_PRESET_THEME_COLORS.slice();
}

function _bdPresetThemeIndex(style, fallbackIndex) {
  const rawValue = style && style._themeColorIndex;
  const raw = Number.isFinite(+rawValue) ? +rawValue : fallbackIndex;
  return Math.max(0, Math.floor(raw));
}

function _bdPresetThemeColorForStyle(style, fallbackIndex, palette) {
  const colors = Array.isArray(palette) && palette.length ? palette : BD_PRESET_THEME_COLORS;
  return colors[_bdPresetThemeIndex(style, fallbackIndex) % colors.length] || style?.bgColor || style?.color || '';
}

function _bdApplyThemeColorToCardStyle(style, color) {
  if (!style || !color) return style;
  style.bgColor = color;
  style.borderColor = color;
  const textColor = typeof bdReadableTextColor === 'function'
    ? bdReadableTextColor(color)
    : _bdPresetReadableTextColor(color);
  if (textColor) style.textColor = textColor;
  return style;
}

function bdDefaultCardStylesForBoard(board) {
  const palette = _bdPresetBoardThemeColors(board);
  return (BD_DEFAULT_CARD_STYLES || []).map((source, index) => {
    const style = _bdPresetClone(source);
    const color = _bdPresetThemeColorForStyle(style, index, palette);
    delete style._themeColorIndex;
    return _bdApplyThemeColorToCardStyle(style, color);
  });
}

function bdDefaultLineStylesForBoard(board) {
  const palette = _bdPresetBoardThemeColors(board);
  return (BD_DEFAULT_LINE_STYLES || []).map((source, index) => {
    const style = _bdPresetClone(source);
    const color = _bdPresetThemeColorForStyle(style, index, palette);
    delete style._themeColorIndex;
    if (color) style.color = color;
    return style;
  });
}

const BD_DEFAULT_CARD_STYLES = [
  {
    id: 'card-theme-rect',
    name: '矩形',
    _themeColorIndex: 5,
    bgColor: _bdPresetThemeColor(5),
    textColor: _bdPresetReadableTextColor(_bdPresetThemeColor(5)),
    borderColor: _bdPresetThemeColor(5),
    borderWidth: 2,
    borderRadius: 8,
    fontSize: 13,
    fontBold: true,
    fontItalic: false,
    shape: 'rect',
    width: 180,
    textStrokeColor: '',
    textStrokeWidth: 0,
  },
  {
    id: 'card-theme-ellipse',
    name: '楕円',
    _themeColorIndex: 3,
    bgColor: _bdPresetThemeColor(3),
    textColor: _bdPresetReadableTextColor(_bdPresetThemeColor(3)),
    borderColor: _bdPresetThemeColor(3),
    borderWidth: 2,
    borderRadius: 999,
    fontSize: 13,
    fontBold: false,
    fontItalic: false,
    shape: 'ellipse',
    width: 180,
    textStrokeColor: '',
    textStrokeWidth: 0,
  },
  {
    id: 'card-theme-pill',
    name: 'ピル',
    _themeColorIndex: 4,
    bgColor: _bdPresetThemeColor(4),
    textColor: _bdPresetReadableTextColor(_bdPresetThemeColor(4)),
    borderColor: _bdPresetThemeColor(4),
    borderWidth: 2,
    borderRadius: 999,
    fontSize: 13,
    fontBold: true,
    fontItalic: false,
    shape: 'pill',
    width: 190,
    textStrokeColor: '',
    textStrokeWidth: 0,
  },
  {
    id: 'card-theme-octagon',
    name: '八角',
    _themeColorIndex: 6,
    bgColor: _bdPresetThemeColor(6),
    textColor: _bdPresetReadableTextColor(_bdPresetThemeColor(6)),
    borderColor: _bdPresetThemeColor(6),
    borderWidth: 2,
    borderRadius: 0,
    fontSize: 13,
    fontBold: true,
    fontItalic: false,
    shape: 'octagon',
    width: 190,
    textStrokeColor: '',
    textStrokeWidth: 0,
  },
  {
    id: 'card-theme-cloud',
    name: '雲',
    _themeColorIndex: 7,
    bgColor: _bdPresetThemeColor(7),
    textColor: _bdPresetReadableTextColor(_bdPresetThemeColor(7)),
    borderColor: _bdPresetThemeColor(7),
    borderWidth: 2,
    borderRadius: 0,
    fontSize: 13,
    fontBold: false,
    fontItalic: false,
    shape: 'cloud',
    width: 190,
    textStrokeColor: '',
    textStrokeWidth: 0,
    cloudBumpWidth: 44,
    cloudBumpHeight: 16,
    cloudSideWidth: 14,
    cloudOffset: 0.45,
    cloudSubWidthRatio: 55,
    cloudSubHeightRatio: 50,
  },
  {
    id: 'card-theme-fluffy',
    name: 'もやもや',
    _themeColorIndex: 4,
    bgColor: _bdPresetThemeColor(4),
    textColor: _bdPresetReadableTextColor(_bdPresetThemeColor(4)),
    borderColor: _bdPresetThemeColor(4),
    borderWidth: 2,
    borderRadius: 0,
    fontSize: 13,
    fontBold: false,
    fontItalic: false,
    shape: 'fluffy',
    width: 190,
    textStrokeColor: '',
    textStrokeWidth: 0,
    cloudBumpWidth: 38,
    cloudBumpHeight: 14,
    cloudSideWidth: 12,
    cloudOffset: 0.5,
    cloudSubWidthRatio: 45,
    cloudSubHeightRatio: 45,
  },
  {
    id: 'card-theme-thorn',
    name: 'トゲ直線',
    _themeColorIndex: 0,
    bgColor: _bdPresetThemeColor(0),
    textColor: _bdPresetReadableTextColor(_bdPresetThemeColor(0)),
    borderColor: _bdPresetThemeColor(0),
    borderWidth: 2,
    borderRadius: 0,
    fontSize: 13,
    fontBold: true,
    fontItalic: false,
    shape: 'thorn',
    width: 190,
    textStrokeColor: '',
    textStrokeWidth: 0,
    cloudBumpWidth: 28,
    cloudBumpHeight: 18,
    cloudSideWidth: 10,
    cloudOffset: 0.5,
    cloudSubWidthRatio: 0,
    cloudSubHeightRatio: 0,
  },
  {
    id: 'card-theme-thorn-curve',
    name: 'トゲ曲線',
    _themeColorIndex: 6,
    bgColor: _bdPresetThemeColor(6),
    textColor: _bdPresetReadableTextColor(_bdPresetThemeColor(6)),
    borderColor: _bdPresetThemeColor(6),
    borderWidth: 2,
    borderRadius: 0,
    fontSize: 13,
    fontBold: true,
    fontItalic: false,
    shape: 'thorn-curve',
    width: 190,
    textStrokeColor: '',
    textStrokeWidth: 0,
    cloudBumpWidth: 30,
    cloudBumpHeight: 18,
    cloudSideWidth: 10,
    cloudOffset: 0.5,
    cloudSubWidthRatio: 0,
    cloudSubHeightRatio: 0,
  },
];

const BD_DEFAULT_LINE_STYLES = [
  {
    id: 'line-theme-standard',
    name: '標準',
    _themeColorIndex: 5,
    color: _bdPresetThemeColor(5),
    width: 3,
    style: '',
    arrow: 'end',
    pathType: 'orthogonal',
    branchRatio: 0.3,
    cornerRadius: 5,
    labelBorderWidth: 0,
    textShadowWidth: 0,
    textShadowColor: '',
  },
  {
    id: 'line-theme-straight',
    name: '直線',
    _themeColorIndex: 3,
    color: _bdPresetThemeColor(3),
    width: 3,
    style: '',
    arrow: 'end',
    pathType: 'straight',
    labelBorderWidth: 0,
    textShadowWidth: 0,
    textShadowColor: '',
  },
  {
    id: 'line-theme-curve',
    name: '曲線',
    _themeColorIndex: 4,
    color: _bdPresetThemeColor(4),
    width: 3,
    style: '',
    arrow: 'end',
    pathType: 'curve',
    labelBorderWidth: 0,
    textShadowWidth: 0,
    textShadowColor: '',
  },
  {
    id: 'line-theme-dashed',
    name: '破線',
    _themeColorIndex: 1,
    color: _bdPresetThemeColor(1),
    width: 2,
    style: 'dashed',
    arrow: '',
    pathType: 'orthogonal',
    branchRatio: 0.3,
    cornerRadius: 5,
    labelBorderWidth: 0,
    textShadowWidth: 0,
    textShadowColor: '',
  },
  {
    id: 'line-theme-emphasis',
    name: '強調',
    _themeColorIndex: 6,
    color: _bdPresetThemeColor(6),
    width: 5,
    style: '',
    arrow: 'both',
    pathType: 'orthogonal',
    branchRatio: 0.3,
    cornerRadius: 5,
    labelBorderWidth: 0,
    textShadowWidth: 0,
    textShadowColor: '',
  },
  {
    id: 'line-theme-reference',
    name: '参照',
    _themeColorIndex: 7,
    color: _bdPresetThemeColor(7),
    width: 2,
    style: 'dashed',
    arrow: 'start',
    pathType: 'straight',
    labelBorderWidth: 0,
    textShadowWidth: 0,
    textShadowColor: '',
  },
  {
    id: 'line-theme-alert',
    name: '注意',
    _themeColorIndex: 0,
    color: _bdPresetThemeColor(0),
    width: 4,
    style: '',
    arrow: 'end',
    pathType: 'orthogonal',
    branchRatio: 0.3,
    cornerRadius: 5,
    labelBorderWidth: 0,
    textShadowWidth: 0,
    textShadowColor: '',
  },
  {
    id: 'line-theme-thin',
    name: '細線',
    _themeColorIndex: 2,
    color: _bdPresetThemeColor(2),
    width: 1,
    style: '',
    arrow: '',
    pathType: 'straight',
    labelBorderWidth: 0,
    textShadowWidth: 0,
    textShadowColor: '',
  },
  {
    id: 'line-theme-loop',
    name: '往復',
    _themeColorIndex: 6,
    color: _bdPresetThemeColor(6),
    width: 3,
    style: '',
    arrow: 'both',
    pathType: 'curve',
    labelBorderWidth: 0,
    textShadowWidth: 0,
    textShadowColor: '',
  },
  {
    id: 'line-theme-manual-curve',
    name: '手動曲線',
    _themeColorIndex: 4,
    color: _bdPresetThemeColor(4),
    width: 3,
    style: '',
    arrow: 'end',
    pathType: 'curve',
    labelBorderWidth: 0,
    textShadowWidth: 0,
    textShadowColor: '',
  },
];

const BD_DEFAULT_DISPLAY_FILTERS = {
  showConnections: true,
  showConnLabels: true,
  showStatus: true,
  showProgress: true,
  showMarkers: true,
  showNotes: true,
  showLinkBadges: true,
  showMenuButtons: true,
  showImageNames: true,
  highlightParentChildGroups: false,
};

function _bdNormalizeIconName(name) {
  const raw = String(name || '').trim();
  if (!raw) return '';
  const aliases = {
    'mouse-pointer': 'mousePointer',
    'credit-card': 'creditCard',
  };
  return aliases[raw] || raw.replace(/-([a-z])/g, (_, chr) => chr.toUpperCase());
}

function _bdIcon(name, size) {
  const iconName = _bdNormalizeIconName(name);
  const nextSize = size || 14;
  if (typeof LUCIDE !== 'undefined' && LUCIDE[iconName] && typeof lucide === 'function') {
    return lucide(iconName, nextSize);
  }
  return '';
}

function bdBuildBoardShellMarkup(idSuffix = '') {
  const idFor = (base) => idSuffix ? `${base}-${idSuffix}` : base;
  return `
    <div class="gb-toolbar gb-toolbar-board" data-bd-role="toolbar-top">
      <button type="button" class="tb-icon-btn tool-menu-btn bd-toolbar-btn bd-toolbar-icon-btn" title="メニュー" data-action="showToolMenu(event,'board')">${_bdIcon('menu', 16)}</button>
      <button type="button" class="tb-icon-btn bd-toolbar-btn bd-toolbar-icon-btn" title="フォルダツリーで表示" data-action="revealCurrentInFolderTree('board', event)">${_bdIcon('folderTree', 16)}</button>
      <span id="${idFor('bd-title')}" class="tb-title tb-file-title bd-toolbar-title" data-bd-control="title"></span>
      <div class="sep"></div>
      <button type="button" data-bd-tool="select" class="tb-icon-btn bd-toolbar-btn bd-toolbar-icon-btn bd-tool-btn" title="選択ツール">${_bdIcon('mouse-pointer', 16)}</button>
      <div class="sep"></div>
      <button type="button" data-bd-tool="add-card" class="tb-icon-btn bd-toolbar-btn bd-toolbar-icon-btn bd-tool-btn" title="カード追加">${_bdIcon('credit-card', 16)}</button>
      <button type="button" id="${idFor('bd-card-style-select')}" class="bd-toolbar-btn bd-style-picker-trigger" data-bd-control="card-style-select" data-bd-action="pick-card-style" title="カードスタイル">
        <span id="${idFor('bd-card-style-preview')}" class="bd-style-preview" data-bd-control="card-style-preview"></span>
        <span class="bd-style-picker-caret">${lucide('chevronDown', 10)}</span>
      </button>
      <button type="button" data-bd-action="manage-card-styles" class="tb-icon-btn bd-toolbar-btn" title="カードスタイル管理">${_bdIcon('settings2', 16)}</button>
      <div class="sep"></div>
      <button type="button" data-bd-tool="add-line" class="tb-icon-btn bd-toolbar-btn bd-toolbar-icon-btn bd-tool-btn" title="ライン追加">${_bdIcon('spline', 16)}</button>
      <button type="button" id="${idFor('bd-line-style-select')}" class="bd-toolbar-btn bd-style-picker-trigger" data-bd-control="line-style-select" data-bd-action="pick-line-style" title="ラインスタイル">
        <span id="${idFor('bd-line-style-preview')}" class="bd-style-preview bd-style-preview-line" data-bd-control="line-style-preview"></span>
        <span class="bd-style-picker-caret">${lucide('chevronDown', 10)}</span>
      </button>
      <button type="button" data-bd-action="manage-line-styles" class="tb-icon-btn bd-toolbar-btn" title="ラインスタイル管理">${_bdIcon('settings2', 16)}</button>
      <div class="sep"></div>
      <button type="button" data-bd-tool="erase" class="tb-icon-btn bd-toolbar-btn bd-toolbar-icon-btn bd-tool-btn" title="消しゴム">${_bdIcon('eraser', 16)}</button>
      <div class="tb-spacer"></div>
      <button type="button" data-bd-action="filters" class="tb-icon-btn bd-toolbar-btn bd-toolbar-icon-btn" title="フィルタ" style="position:relative;">${_bdIcon('funnel', 16)}<span id="${idFor('bd-filter-badge')}" class="bd-filter-badge tb-badge" data-bd-control="filter-badge" style="display:none;position:absolute;top:-4px;right:-4px;"></span></button>
      <button type="button" data-bd-action="reload" class="tb-icon-btn bd-toolbar-btn bd-toolbar-icon-btn" title="再読み込み">${_bdIcon('refreshCw', 16)}</button>
      <button type="button" data-bd-action="find-replace" class="tb-icon-btn bd-toolbar-btn bd-toolbar-icon-btn" title="検索と置換">${_bdIcon('search', 16)}</button>
      <button type="button" data-bd-action="detail" class="tb-icon-btn bd-toolbar-btn bd-toolbar-icon-btn" title="オプションを開く">${_bdIcon('panelRight', 16)}</button>
    </div>
    <div id="${idFor('bd-canvas')}" data-bd-role="canvas" data-gb-tooltip-disabled="true" tabindex="0" aria-label="ボードキャンバス" title="ボードキャンバス" style="position:relative;flex:1;overflow:hidden;outline:none;background:var(--bd-bg,var(--content-bg,var(--bg)));" oncontextmenu="return false;">
      <div id="${idFor('bd-world')}" data-bd-role="world" style="position:absolute;transform-origin:0 0;">
        <svg id="${idFor('bd-svg')}" data-bd-role="svg"></svg>
        <div id="${idFor('bd-nodes')}" data-bd-role="nodes"></div>
        <div id="${idFor('bd-resize-layer')}" data-bd-role="resize-layer"></div>
      </div>
    </div>
    <div class="gb-toolbar gb-toolbar-board bd-toolbar-bottom" data-bd-role="toolbar-bottom">
      <div class="bd-toolbar-group">
        <input id="${idFor('bd-zoom-slider')}" class="tb-range bd-toolbar-range" data-bd-control="zoom-slider" type="range" min="10" max="500" value="100" title="ズーム">
        <span id="${idFor('bd-zoom-label')}" class="tb-range-label bd-toolbar-meta" data-bd-control="zoom-label" data-bd-action="zoom-select" title="表示倍率を選択">100%</span>
        <button type="button" class="tb-icon-btn bd-toolbar-btn bd-toolbar-icon-btn" data-bd-action="zoom-out" title="縮小">${_bdIcon('zoomOut', 16)}</button>
        <button type="button" class="tb-icon-btn bd-toolbar-btn bd-toolbar-icon-btn" data-bd-action="zoom-in" title="拡大">${_bdIcon('zoomIn', 16)}</button>
        <button type="button" class="tb-icon-btn bd-toolbar-btn bd-toolbar-icon-btn" data-bd-action="zoom-100" title="100%">${_bdIcon('square', 16)}</button>
        <button type="button" class="tb-icon-btn bd-toolbar-btn bd-toolbar-icon-btn" data-bd-action="fit" title="全体表示">${_bdIcon('maximize', 16)}</button>
      </div>
      <div class="sep"></div>
      <div class="bd-toolbar-group">
        <input id="${idFor('bd-rot-slider')}" class="tb-range bd-toolbar-range bd-toolbar-range-rot" data-bd-control="rot-slider" type="range" min="-180" max="180" value="0" title="回転">
        <span id="${idFor('bd-rot-label')}" class="tb-range-label bd-toolbar-meta" data-bd-control="rot-label">0°</span>
        <button type="button" class="tb-icon-btn bd-toolbar-btn" data-bd-action="reset-rotation" title="回転をリセット">${_bdIcon('disc', 16)}</button>
      </div>
    </div>`;
}

function bdGetActiveBoardRoot() {
  if (typeof GBLayout !== 'undefined' && typeof GBTabs !== 'undefined' && typeof getComponentInstance === 'function') {
    const tab = GBTabs.getActiveTab?.(GBLayout.activePane);
    const comp = tab ? getComponentInstance(tab.id) : null;
    if (comp?.el?.querySelector?.('[data-bd-role="canvas"]')) return comp.el;
  }
  const activePane = (typeof GBLayout !== 'undefined' && GBLayout.activePane)
    ? document.querySelector(`.gb-pane[data-pane-id="${GBLayout.activePane}"] .gb-pane-content`)
    : null;
  const paneRoot = activePane?.querySelector?.('.gb-canvas-root');
  if (paneRoot) return paneRoot;
  return document.querySelector('.gb-canvas-root') || document;
}

function bdGetBoardElement(role, root) {
  const idMap = {
    canvas: 'bd-canvas',
    world: 'bd-world',
    svg: 'bd-svg',
    nodes: 'bd-nodes',
    'resize-layer': 'bd-resize-layer',
  };
  const scope = root || bdGetActiveBoardRoot();
  return scope?.querySelector?.(`[data-bd-role="${role}"]`)
    || document.querySelector(`[data-bd-role="${role}"]`)
    || document.getElementById(idMap[role] || role);
}

function _bdCardPreviewShapeStyle(shape, radius) {
  const nextRadius = Math.max(0, +radius || 0);
  if (shape === 'ellipse') return `border-radius:999px / 70%;`;
  // 雲型プレビュー: 実カードは Catmull-Rom 曲線で描く滑らかな雲型。
  // 小サイズのプレビューでは山を 4 つに集約し、角を丸く見せるため peak/valley
  // を control point 的な位置に置く。底面は緩いカーブで膨らませる。
  if (shape === 'cloud') return 'border-radius:0;clip-path:polygon(0% 55%, 8% 30%, 20% 40%, 30% 15%, 45% 30%, 55% 10%, 70% 30%, 80% 15%, 92% 35%, 100% 55%, 92% 78%, 78% 90%, 60% 80%, 45% 95%, 28% 85%, 12% 92%, 3% 75%);';
  // もやもやプレビュー: 実カードはごく緩やかな波状で楕円に近い。border-radius で
  // ベース形状を楕円に寄せ、clip-path で軽い波打ちを表現する。山の数は 6 程度。
  if (shape === 'fluffy') return 'border-radius:999px / 60%;clip-path:polygon(50% 3%, 70% 8%, 88% 16%, 96% 30%, 92% 50%, 96% 70%, 88% 84%, 70% 92%, 50% 97%, 30% 92%, 12% 84%, 4% 70%, 8% 50%, 4% 30%, 12% 16%, 30% 8%);';
  // トゲ型 (直線) プレビュー: 4 方向スパイク + 中間に浅い谷を配置して 8 点で表現。
  // 実カードと同じ基本形だが、プレビュー縦横比に合わせて peak を中心寄りに調整。
  if (shape === 'thorn') return 'border-radius:0;clip-path:polygon(50% 0%, 62% 32%, 100% 50%, 62% 68%, 50% 100%, 38% 68%, 0% 50%, 38% 32%);';
  // トゲ型 (曲線) プレビュー: 実カードは各 peak-valley 間に内側へへこむ中間点を
  // 挟むため、プレビューも 12 点でくぼみを 1 点ずつ付加して爆発型を近似する。
  if (shape === 'thorn-curve') return 'border-radius:0;clip-path:polygon(50% 4%, 60% 26%, 78% 22%, 96% 50%, 78% 78%, 60% 74%, 50% 96%, 40% 74%, 22% 78%, 4% 50%, 22% 22%, 40% 26%);';
  if (shape === 'octagon') return 'border-radius:0;clip-path:polygon(12% 0%, 88% 0%, 100% 12%, 100% 88%, 88% 100%, 12% 100%, 0% 88%, 0% 12%);';
  if (shape === 'pill') return 'border-radius:999px;';
  return `border-radius:${nextRadius}px;`;
}

function _bdIsPathPreviewShape(shape) {
  return shape === 'cloud' || shape === 'thorn' || shape === 'thorn-curve' || shape === 'fluffy';
}

function _bdPreviewPathData(pathStr) {
  return String(pathStr || '').replace(/^path\(['"]?/, '').replace(/['"]?\)$/, '');
}

function _bdCardPreviewPathData(shape, style) {
  const w = 120;
  const h = 64;
  const opts = {
    bumpW: Number.isFinite(+style.cloudBumpWidth) ? +style.cloudBumpWidth : 40,
    bumpH: Number.isFinite(+style.cloudBumpHeight) ? +style.cloudBumpHeight : 16,
    sideW: Number.isFinite(+style.cloudSideWidth) ? +style.cloudSideWidth : 12,
    offset: Number.isFinite(+style.cloudOffset) ? +style.cloudOffset : 0.5,
    radius: Number.isFinite(+style.borderRadius) ? +style.borderRadius : 6,
    subWidth: Number.isFinite(+style.cloudSubWidthRatio) ? +style.cloudSubWidthRatio : 0,
    subHeight: Number.isFinite(+style.cloudSubHeightRatio) ? +style.cloudSubHeightRatio : 0,
  };
  const fn = shape === 'thorn-curve' ? (typeof _bdThornCurveClipPath === 'function' ? _bdThornCurveClipPath : null)
           : shape === 'thorn' ? (typeof _bdThornClipPath === 'function' ? _bdThornClipPath : null)
           : shape === 'fluffy' ? (typeof _bdFluffyClipPath === 'function' ? _bdFluffyClipPath : null)
           : (typeof _bdCloudClipPath === 'function' ? _bdCloudClipPath : null);
  const generated = fn ? fn(w, h, opts) : '';
  return { d: _bdPreviewPathData(generated), w, h };
}

function _bdCardPathShapePreviewHtml(style, common) {
  const shape = style.shape || 'cloud';
  const path = _bdCardPreviewPathData(shape, style);
  if (!path.d) return '';
  const fill = _bdPresetSafeCssColor(style.bgColor, 'var(--bg4)');
  const borderColor = _bdPresetSafeCssColor(style.borderColor, 'rgba(148,163,184,0.55)');
  const textColor = _bdPresetSafeCssColor(style.textColor, 'var(--fg)');
  const borderWidth = _bdPresetClampedNumber(style.borderWidth, 0, 0, 24);
  const strokeAttrs = borderWidth > 0
    ? `stroke="${_bdEscAttr(borderColor)}" stroke-width="${borderWidth * 2}"`
    : 'stroke="none"';
  const joinAttrs = shape === 'thorn' || shape === 'thorn-curve'
    ? 'stroke-linejoin="miter" stroke-miterlimit="40"'
    : 'stroke-linejoin="round"';
  return `<span class="bd-style-card-preview bd-style-card-preview--path-shape" style="background:transparent;color:${_bdEscAttr(textColor)};border:0;border-radius:0;overflow:visible;position:relative;font-weight:${style.fontBold ? '700' : '500'};font-style:${style.fontItalic ? 'italic' : 'normal'};${common.fontCss}${common.shadowCss}"><svg class="bd-style-card-preview-shape" viewBox="0 0 ${path.w} ${path.h}" preserveAspectRatio="none" overflow="visible" aria-hidden="true" focusable="false"><path d="${_bdEscAttr(path.d)}" fill="${_bdEscAttr(fill)}" ${strokeAttrs} ${joinAttrs} paint-order="stroke fill"/></svg><span class="bd-style-card-preview-text">Aa</span></span>`;
}

// テキストフチを text-shadow の多方向重ねで擬似描画する。
// - 外周 60 方向 (半径 w): 滑らかな円形フチの輪郭を作る
// - 中周 24 方向 (半径 w × 0.66): 太いフチの内側を埋める (w ≥ 2 のとき)
// - 内周 12 方向 (半径 w × 0.33): さらに中心寄りを埋めて中抜けを防ぐ (w ≥ 3 のとき)
// - 各影に 0.15px の極小 blur: ピクセル境界の離散感だけ吸収し、視覚的ボケは感じない
function _bdTextOutlineShadow(width, color) {
  const w = Math.max(0, +width || 0);
  if (w <= 0 || !color) return '';
  const shadows = [];
  const blur = '0.15px';
  const rings = [
    { steps: 60, radius: w, offset: 0 },
  ];
  if (w >= 2) rings.push({ steps: 24, radius: w * 0.66, offset: Math.PI / 24 });
  if (w >= 3) rings.push({ steps: 12, radius: w * 0.33, offset: 0 });
  for (const r of rings) {
    for (let i = 0; i < r.steps; i++) {
      const rad = (i * 2 * Math.PI) / r.steps + r.offset;
      const dx = (Math.cos(rad) * r.radius).toFixed(2);
      const dy = (Math.sin(rad) * r.radius).toFixed(2);
      shadows.push(`${dx}px ${dy}px ${blur} ${color}`);
    }
  }
  return shadows.join(', ');
}

function _bdCardStylePreviewHtml(style) {
  if (!style) return '<span class="bd-style-card-preview"></span>';
  const bgColor = _bdPresetSafeCssColor(style.bgColor, 'var(--bg4)');
  const textColor = _bdPresetSafeCssColor(style.textColor, 'var(--fg)');
  const borderColor = _bdPresetSafeCssColor(style.borderColor, 'rgba(148,163,184,0.55)');
  const borderWidth = _bdPresetClampedNumber(style.borderWidth, 0, 0, 24);
  // 文字フチはスタイルの textStrokeWidth をそのまま使う (実カードと同じ比率感)。
  // フォントサイズは CSS 側 (`.bd-style-card-preview` / `-large` / `-list-preview` /
  // `.bd-style-editor-preview`) で箇所ごとに制御する。インラインで font-size を入れると
  // CSS を上書きしてスタイル管理ダイアログ等の大型プレビューが小さくなる副作用が出る。
  const strokeWidth = _bdPresetClampedNumber(style.textStrokeWidth, 0, 0, 12);
  const strokeColor = _bdPresetSafeCssColor(style.textStrokeColor, 'transparent');
  const shapeStyle = _bdCardPreviewShapeStyle(style.shape || 'rect', style.borderRadius);
  const textShadow = strokeWidth > 0 ? _bdTextOutlineShadow(strokeWidth, strokeColor) : '';
  const shadowCss = textShadow ? `text-shadow:${_bdEscAttr(textShadow)};` : '';
  const safeFontFamily = _bdPresetSafeFontFamily(style.fontFamily);
  const fontCss = safeFontFamily ? `font-family:${_bdEscAttr(safeFontFamily)};` : '';
  if (_bdIsPathPreviewShape(style.shape || '')) {
    const pathHtml = _bdCardPathShapePreviewHtml(style, { fontCss, shadowCss });
    if (pathHtml) return pathHtml;
  }
  return `<span class="bd-style-card-preview" style="background:${_bdEscAttr(bgColor)};color:${_bdEscAttr(textColor)};border:${borderWidth}px solid ${_bdEscAttr(borderColor)};${shapeStyle}font-weight:${style.fontBold ? '700' : '500'};font-style:${style.fontItalic ? 'italic' : 'normal'};${fontCss}${shadowCss}">Aa</span>`;
}

function _bdLineStylePreviewHtml(style) {
  if (!style) return '<span class="bd-style-line-preview-empty"></span>';
  const color = _bdPresetSafeCssColor(style.color, 'var(--accent)');
  const strokeWidth = _bdPresetClampedNumber(style.width, 2, 0, 24);
  const dash = style.style === 'dashed' ? 'stroke-dasharray="6 3"' : '';
  // v0.5.320: 旧 free-bezier → curve、orthogonal-curve → orthogonal に統合。
  // 直角線のコーナー半径 >0 ならプレビューでも角丸表示。
  const rawPath = style.pathType;
  const pathType = (rawPath === 'straight' || style.straight) ? 'straight'
    : (rawPath === 'orthogonal' || rawPath === 'orthogonal-curve') ? 'orthogonal'
    : 'curve';
  const corner = Number.isFinite(+style.cornerRadius) ? +style.cornerRadius : (rawPath === 'orthogonal-curve' ? 12 : 0);
  const d = pathType === 'orthogonal'
    ? (corner > 0 ? 'M6,14 L24,14 Q28,14 28,10 Q28,6 32,6 L50,6' : 'M6,14 L28,14 L28,6 L50,6')
    : pathType === 'straight'
      ? 'M6,10 L50,10'
      : 'M6,14 C18,4 38,4 50,14';
  const markerSize = Math.max(7, Math.min(12, strokeWidth * 2.2 + 2));
  const refX = Math.max(1, Math.min(markerSize * 0.25, Math.max(1.4, strokeWidth * 0.8)));
  const markerId = `bd-preview-arrow-${Math.random().toString(36).slice(2, 8)}`;
  const pathId = `bd-preview-path-${Math.random().toString(36).slice(2, 8)}`;
  const marker = `<marker id="${markerId}" markerWidth="${markerSize}" markerHeight="${markerSize}" refX="${refX}" refY="${markerSize / 2}" orient="auto-start-reverse" markerUnits="userSpaceOnUse"><path d="M0,0 L${markerSize - 1},${markerSize / 2} L0,${markerSize} Z" fill="${_bdEscAttr(color)}"/></marker>`;
  const markerAttrs = strokeWidth > 0 ? [
    (style.arrow === 'start' || style.arrow === 'both') ? `marker-start="url(#${markerId})"` : '',
    (style.arrow === 'end' || style.arrow === 'both') ? `marker-end="url(#${markerId})"` : '',
  ].filter(Boolean).join(' ') : '';
  // Phase 6: textVisible=true なら「Aa」サンプル文字を表示
  const textVisible = style.textVisible !== undefined ? !!style.textVisible : true;
  const textAlongPath = !!style.textAlongPath;
  const textShadowWidth = _bdPresetClampedNumber(style.textShadowWidth, 0, 0, 12);
  const textShadowColor = _bdPresetSafeCssColor(style.textShadowColor, '');
  const labelTextColor = _bdPresetSafeCssColor(style.labelTextColor, 'var(--fg2)');
  const labelBgColor = _bdPresetSafeCssColor(style.labelBgColor, '');
  const labelBorderColor = _bdPresetSafeCssColor(style.labelBorderColor, '');
  const labelBorderWidth = _bdPresetClampedNumber(style.labelBorderWidth, 0, 0, 12);
  let labelSvg = '';
  if (textVisible) {
    const strokeAttr = textShadowWidth > 0
      ? `paint-order="stroke" stroke="${_bdEscAttr(textShadowColor)}" stroke-width="${textShadowWidth * 2}" stroke-linejoin="round"`
      : '';
    const safeFontFamily = _bdPresetSafeFontFamily(style.fontFamily);
    const fontAttr = safeFontFamily ? `style="font-family:${_bdEscAttr(safeFontFamily)};"` : '';
    if (textAlongPath) {
      labelSvg = `<text text-anchor="middle" dominant-baseline="middle" fill="${_bdEscAttr(labelTextColor)}" font-size="9" ${fontAttr} ${strokeAttr}><textPath href="#${pathId}" startOffset="50%">Aa</textPath></text>`;
    } else {
      // HTML ラベルと揃えて background / 枠線もプレビューに反映する。
      // 背景 rect → 枠線 rect → テキスト (上から重ねる) の順で <g>。
      const rectW = 14, rectH = 12;
      const rectX = 28 - rectW / 2, rectY = 12 - rectH / 2 - 0.5;
      const bgRect = labelBgColor
        ? `<rect x="${rectX}" y="${rectY}" width="${rectW}" height="${rectH}" rx="2" ry="2" fill="${_bdEscAttr(labelBgColor)}" />`
        : '';
      const borderRect = (labelBorderColor && labelBorderWidth > 0)
        ? `<rect x="${rectX}" y="${rectY}" width="${rectW}" height="${rectH}" rx="2" ry="2" fill="none" stroke="${_bdEscAttr(labelBorderColor)}" stroke-width="${labelBorderWidth}" />`
        : '';
      labelSvg = `${bgRect}${borderRect}<text x="28" y="12" text-anchor="middle" dominant-baseline="middle" fill="${_bdEscAttr(labelTextColor)}" font-size="9" ${fontAttr} ${strokeAttr}>Aa</text>`;
    }
  }
  return `<svg width="62" height="20" viewBox="0 0 56 20" fill="none" xmlns="http://www.w3.org/2000/svg"><defs>${marker}</defs><path id="${pathId}" d="${d}" stroke="${_bdEscAttr(color)}" stroke-width="${strokeWidth}" ${dash} stroke-linecap="${style.arrow ? 'butt' : 'round'}" stroke-linejoin="round" ${markerAttrs}/>${labelSvg}</svg>`;
}

function _bdStylePickerLargePreviewHtml(kind, style) {
  if (kind === 'card') return _bdCardStylePreviewHtml(style).replace('bd-style-card-preview', 'bd-style-card-preview bd-style-card-preview-large');
  return _bdLineStylePreviewHtml(style).replace('<svg ', '<svg class="bd-style-line-preview-large" ');
}
