/* gb-board-ui.js: Board toolbar, styles, filters, preview, detail panel */

function _bdClone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function _bdEscAttr(value) {
  return esc(String(value == null ? '' : value)).replace(/"/g, '&quot;');
}

function _bdNormalizeStyleId(value, prefix) {
  const base = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return base || prefix;
}

function _bdEnsureUniqueStyleIds(styles, prefix) {
  const seen = new Set();
  styles.forEach((style, index) => {
    let nextId = _bdNormalizeStyleId(style.id || style.name || `${prefix}-${index + 1}`, `${prefix}-${index + 1}`);
    while (seen.has(nextId)) nextId += '-x';
    style.id = nextId;
    seen.add(nextId);
  });
}

function _bdMergeBuiltinStyles(styles, builtins) {
  const merged = styles.slice();
  const existingIds = new Set(merged.map(style => style.id).filter(Boolean));
  builtins.forEach(style => {
    if (!existingIds.has(style.id)) merged.push(_bdClone(style));
  });
  return merged;
}

function _bdBuiltinCardStylesForBoard() {
  return typeof bdDefaultCardStylesForBoard === 'function'
    ? bdDefaultCardStylesForBoard(typeof bd !== 'undefined' ? bd : undefined)
    : _bdClone(BD_DEFAULT_CARD_STYLES);
}

function _bdBuiltinLineStylesForBoard() {
  return typeof bdDefaultLineStylesForBoard === 'function'
    ? bdDefaultLineStylesForBoard(typeof bd !== 'undefined' ? bd : undefined)
    : _bdClone(BD_DEFAULT_LINE_STYLES);
}

const BD_LEGACY_CARD_STYLE_ID_MAP = {
  'card-default': 'card-theme-rect',
  'card-accent': 'card-theme-pill',
  'card-outline': 'card-theme-octagon',
  'card-note': 'card-theme-cloud',
  'card-dark': 'card-theme-octagon',
  'card-danger': 'card-theme-rect',
  'card-soft': 'card-theme-ellipse',
  'card-octagon': 'card-theme-octagon',
  'card-theme-diamond': 'card-theme-rect',
  'card-theme-hexagon': 'card-theme-octagon',
  'card-theme-star': 'card-theme-cloud',
};

const BD_REMOVED_CARD_SHAPES = new Set(['diamond', 'hexagon', 'star']);

function _bdNormalizeCardShapeValue(value) {
  const shape = String(value || '').trim();
  if (!shape || shape === 'rect') return shape;
  if (BD_REMOVED_CARD_SHAPES.has(shape)) return '';
  if (typeof BD_SHAPES !== 'undefined' && !BD_SHAPES.includes(shape)) return '';
  return shape;
}

function _bdNormalizeRemovedCardShapesInBoard() {
  const normalizeObject = (obj) => {
    if (!obj || typeof obj !== 'object' || obj.shape === undefined) return;
    const next = _bdNormalizeCardShapeValue(obj.shape);
    if (next) obj.shape = next;
    else delete obj.shape;
  };
  (bd.cardStyles || []).forEach(normalizeObject);
  (bd.nodes || []).forEach(normalizeObject);
  (bd.depthStyles || []).forEach(style => {
    normalizeObject(style);
    if (style?.card && typeof style.card === 'object') normalizeObject(style.card);
  });
}

const BD_LEGACY_LINE_STYLE_ID_MAP = {
  'line-default': 'line-theme-standard',
  'line-dashed': 'line-theme-dashed',
  'line-emphasis': 'line-theme-emphasis',
  'line-curve': 'line-theme-curve',
  'line-reference': 'line-theme-reference',
  'line-warning': 'line-theme-alert',
  'line-thin': 'line-theme-thin',
  'line-loop': 'line-theme-loop',
  'line-manual-curve': 'line-theme-manual-curve',
};

const BD_LEGACY_CARD_STYLE_DEFAULTS = Object.fromEntries([
  ['card-default', ['標準', '#f5f5f5', '#1f2937', '#94a3b8', 1, 6, 13, false, false, '', 160, '', 0]],
  ['card-accent', ['強調', '#80a8c4', '#ffffff', '#54789e', 1, 10, 13, true, false, '', 180, '', 0]],
  ['card-outline', ['アウトライン', 'transparent', '#e5e7eb', '#80a8c4', 2, 14, 13, false, false, '', 180, '', 0]],
  ['card-note', ['付箋', '#c4b880', '#3d342c', '#9e9454', 1, 8, 13, false, false, '', 180, '', 0]],
  ['card-dark', ['ダーク', '#1f2937', '#f8fafc', '#64748b', 1, 10, 13, true, false, '', 180, '', 0]],
  ['card-danger', ['警告', '#c48080', '#3d2c2c', '#9e5454', 1, 12, 13, true, false, '', 180, '', 0]],
  ['card-soft', ['ソフト', '#80c4a8', '#2c3d35', '#549e7e', 1, 18, 13, false, false, '', 180, '', 0]],
  ['card-octagon', ['八角', '#8c80c4', '#ffffff', '#6a549e', 1, 0, 13, true, false, 'octagon', 190, '', 0]],
].map(([id, v]) => [id, { id, name: v[0], bgColor: v[1], textColor: v[2], borderColor: v[3], borderWidth: v[4], borderRadius: v[5], fontSize: v[6], fontBold: v[7], fontItalic: v[8], shape: v[9], width: v[10], textStrokeColor: v[11], textStrokeWidth: v[12] }]));

const BD_LEGACY_LINE_STYLE_DEFAULTS = Object.fromEntries([
  ['line-default', ['標準', '#80a8c4', 2, '', 'end', 'curve']],
  ['line-dashed', ['補助', '#94a3b8', 2, 'dashed', '', 'straight']],
  ['line-emphasis', ['強調', '#c49e80', 4, '', 'both', 'straight']],
  ['line-curve', ['曲線', '#80c4a8', 3, '', 'end', 'curve']],
  ['line-reference', ['参照', '#80a8c4', 2, 'dashed', 'start', 'straight']],
  ['line-warning', ['警告', '#c48080', 3, '', 'end', 'straight']],
  ['line-thin', ['細線', '#94a3b8', 1, '', '', 'straight']],
  ['line-loop', ['往復', '#8c80c4', 3, '', 'both', 'curve']],
  ['line-manual-curve', ['曲線 (手動)', '#80c4a8', 3, '', 'end', 'curve']],
].map(([id, v]) => [id, { id, name: v[0], color: v[1], width: v[2], style: v[3], arrow: v[4], pathType: v[5] }]));

function _bdStyleValueDiffersFromDefault(value, expected) {
  if (typeof expected === 'number') return Number.isFinite(+value) && +value !== expected;
  if (typeof expected === 'boolean') return !!value !== expected;
  return String(value == null ? '' : value) !== String(expected == null ? '' : expected);
}

function _bdLegacyStyleHasCustomValues(style, legacyDefault) {
  if (!style || !legacyDefault) return false;
  if (style._default && typeof style._default === 'object') return true;
  if (Object.keys(legacyDefault).some(key =>
    Object.prototype.hasOwnProperty.call(style, key)
    && _bdStyleValueDiffersFromDefault(style[key], legacyDefault[key])
  )) return true;
  return Object.keys(style).some(key => {
    if (key === '_default' || Object.prototype.hasOwnProperty.call(legacyDefault, key)) return false;
    const value = style[key];
    if (value === undefined || value === null || value === '') return false;
    if (typeof value === 'number') return value !== 0;
    return true;
  });
}

function _bdMakeUniqueLegacyStyleId(style, mappedId, usedIds) {
  const legacySuffix = _bdNormalizeStyleId(style?.id || 'legacy', 'legacy');
  const base = _bdNormalizeStyleId(`${mappedId || 'style'}-${legacySuffix}`, `${mappedId || 'style'}-legacy`);
  let next = base;
  let index = 2;
  while (usedIds.has(next)) next = `${base}-${index++}`;
  usedIds.add(next);
  return next;
}

function _bdReplaceBuiltinStyleSet(styles, builtins, legacyMap, legacyDefaults) {
  const legacyIds = new Set(Object.keys(legacyMap || {}));
  const builtinIds = new Set((builtins || []).map(style => style && style.id).filter(Boolean));
  const usedIds = new Set(builtinIds);
  const legacyRefMap = {};
  const custom = [];
  (Array.isArray(styles) ? styles : []).forEach(style => {
    if (!style) return;
    if (legacyIds.has(style.id)) {
      const mappedId = _bdMapLegacyStyleId(style.id, legacyMap) || (builtins || [])[0]?.id || '';
      if (_bdLegacyStyleHasCustomValues(style, legacyDefaults?.[style.id])) {
        const preserved = _bdClone(style);
        preserved.id = _bdMakeUniqueLegacyStyleId(style, mappedId, usedIds);
        preserved.name = preserved.name ? `${preserved.name} (旧)` : '旧スタイル';
        if (!preserved._default && legacyDefaults?.[style.id]) preserved._default = _bdClone(legacyDefaults[style.id]);
        custom.push(preserved);
        legacyRefMap[style.id] = preserved.id;
      } else {
        legacyRefMap[style.id] = mappedId;
      }
      return;
    }
    if (builtinIds.has(style.id)) return;
    const cloned = _bdClone(style);
    if (usedIds.has(cloned.id)) cloned.id = _bdMakeUniqueLegacyStyleId(cloned, cloned.id || 'style', usedIds);
    else usedIds.add(cloned.id);
    custom.push(cloned);
  });
  return { styles: [..._bdClone(builtins || []), ...custom], legacyRefMap };
}

function _bdMapLegacyStyleId(value, map) {
  return map && Object.prototype.hasOwnProperty.call(map, value) ? map[value] : value;
}

function _bdDepthLineHasValue(line) {
  if (!line || typeof line !== 'object') return false;
  return Object.keys(line).some(key => {
    const value = line[key];
    if (value === undefined || value === null || value === '') return false;
    if (typeof value === 'number') return value !== 0;
    if (typeof value === 'boolean') return true;
    return true;
  });
}

function _bdIsLegacyDefaultDepthStyles(styles) {
  if (!Array.isArray(styles) || styles.length !== 5) return false;
  const defaults = [
    { fontSize: 16, fontBold: true, width: 200, bgColor: 'var(--bg4)', defaultText: 'トピック' },
    { fontSize: 14, fontBold: true, width: 170, bgColor: 'var(--bg3)', defaultText: 'サブトピック' },
    { fontSize: 13, fontBold: false, width: 150, bgColor: '', defaultText: '項目' },
    { fontSize: 12, fontBold: false, width: 130, bgColor: '', defaultText: '詳細' },
    { fontSize: 11, fontBold: false, width: 120, bgColor: '', defaultText: 'メモ' },
  ];
  return styles.every((style, index) => {
    const def = defaults[index];
    if (!style || typeof style !== 'object') return false;
    if (style.name || style.cardStyleRef || style.lineStyleRef || style.shape) return false;
    if (style.textColor || style.borderColor || style.textStrokeColor) return false;
    if (Number.isFinite(+style.borderWidth) && +style.borderWidth !== 0) return false;
    if (Number.isFinite(+style.textStrokeWidth) && +style.textStrokeWidth !== 0) return false;
    if ((style.defaultText || '') !== def.defaultText) return false;
    if (Number.isFinite(+style.fontSize) && +style.fontSize !== def.fontSize) return false;
    if (!!style.fontBold !== def.fontBold) return false;
    if (Number.isFinite(+style.width) && +style.width !== def.width) return false;
    if ((style.bgColor || '') !== def.bgColor) return false;
    return !_bdDepthLineHasValue(style.line);
  });
}

function _bdApplyV9BuiltinStyleMigration(cardBuiltins, lineBuiltins) {
  const cardFallbackId = cardBuiltins[0]?.id || '';
  const lineFallbackId = lineBuiltins[0]?.id || '';
  const replacedCards = _bdReplaceBuiltinStyleSet(bd.cardStyles, cardBuiltins, BD_LEGACY_CARD_STYLE_ID_MAP, BD_LEGACY_CARD_STYLE_DEFAULTS);
  const replacedLines = _bdReplaceBuiltinStyleSet(bd.lineStyles, lineBuiltins, BD_LEGACY_LINE_STYLE_ID_MAP, BD_LEGACY_LINE_STYLE_DEFAULTS);
  const mapCard = id => replacedCards.legacyRefMap[id] || _bdMapLegacyStyleId(id, BD_LEGACY_CARD_STYLE_ID_MAP) || cardFallbackId;
  const mapLine = id => replacedLines.legacyRefMap[id] || _bdMapLegacyStyleId(id, BD_LEGACY_LINE_STYLE_ID_MAP) || lineFallbackId;

  bd.cardStyles = replacedCards.styles;
  bd.lineStyles = replacedLines.styles;
  _bdNormalizeRemovedCardShapesInBoard();

  if (bd.activeCardStyle) bd.activeCardStyle = mapCard(bd.activeCardStyle);
  if (bd.activeLineStyle) bd.activeLineStyle = mapLine(bd.activeLineStyle);
  if (Array.isArray(bd.nodes)) {
    bd.nodes.forEach(node => {
      if (node?.cardStyle) node.cardStyle = mapCard(node.cardStyle);
    });
  }
  if (Array.isArray(bd.connections)) {
    bd.connections.forEach(conn => {
      if (conn?.styleRef) conn.styleRef = mapLine(conn.styleRef);
    });
  }
  if (!Array.isArray(bd.depthStyles) || !bd.depthStyles.length || _bdIsLegacyDefaultDepthStyles(bd.depthStyles)) {
    bd.depthStyles = typeof bdNormalizeDepthStyles === 'function' ? bdNormalizeDepthStyles([]) : [];
  } else {
    bd.depthStyles.forEach(style => {
      if (!style || typeof style !== 'object') return;
      if (style.cardStyleRef) style.cardStyleRef = mapCard(style.cardStyleRef);
      if (style.lineStyleRef) style.lineStyleRef = mapLine(style.lineStyleRef);
    });
  }
  if (typeof _bdRemoveGlobalStyleDefault === 'function') {
    Object.keys(BD_LEGACY_CARD_STYLE_ID_MAP).forEach(id => _bdRemoveGlobalStyleDefault('card', id));
    Object.keys(BD_LEGACY_LINE_STYLE_ID_MAP).forEach(id => _bdRemoveGlobalStyleDefault('line', id));
  }
}

// 新規ボード初期化 / ビルトインスタイルを追加した直後に呼び、保存されたグローバル
// デフォルト (localStorage) を該当 id のスタイルへ上書きマージする。per-board で
// 既に _default が設定されているスタイルは「そのボード専用にカスタムされたもの」と
// 見なしてグローバル上書きをスキップする。
// 注意: 本関数は style._default を書き込まない。_default を書き込むと、次回同じボードを
// 開いたときに _default が残っていて global が再適用されなくなり、他ボードで変更した
// global が伝播しなくなる不具合になる。リセット時は _bdResetStyleToDefault が
// _default → global → BD_DEFAULT の順で参照するため、_default 未設定でも global に戻れる。
function _bdApplyGlobalDefaultsToStyleArray(kind, styles) {
  if (!Array.isArray(styles) || !styles.length) return styles;
  if (typeof _bdReadGlobalStyleDefaults !== 'function') return styles;
  const globals = _bdReadGlobalStyleDefaults(kind);
  if (!globals || !Object.keys(globals).length) return styles;
  styles.forEach(style => {
    if (!style || !style.id) return;
    const g = globals[style.id];
    if (!g || typeof g !== 'object') return;
    if (style._default) return; // このボードで既にカスタムされている
    Object.keys(g).forEach(key => {
      if (key === 'id' || key === '_default') return;
      // name はグローバルが持っていれば追従、なければ既存維持
      if (key === 'name' && (!g.name || typeof g.name !== 'string')) return;
      style[key] = g[key];
    });
  });
  return styles;
}

function bdApplyStylePresetMigration() {
  if (typeof bd === 'undefined') return;
  const currentVersion = Number.isFinite(+bd._stylePresetSeedVersion) ? +bd._stylePresetSeedVersion : 0;
  if (currentVersion >= BD_STYLE_PRESET_VERSION) return;
  // 再帰防止: マイグレーション処理中に bdEnsureBoardUiState が再帰呼び出しされても
  // ここでは early return するように、先にバージョンを上げておく。
  // （マイグレーション内の処理で bdGetCardStyleById 等を呼ばない設計だが、念のため）
  if (bd._migrating) return;
  bd._migrating = true;
  try {
  const cardBuiltins = _bdBuiltinCardStylesForBoard();
  const lineBuiltins = _bdBuiltinLineStylesForBoard();
  const nextCardStyles = Array.isArray(bd.cardStyles) && bd.cardStyles.length
    ? _bdMergeBuiltinStyles(bd.cardStyles, cardBuiltins)
    : _bdClone(cardBuiltins);
  const nextLineStyles = Array.isArray(bd.lineStyles) && bd.lineStyles.length
    ? _bdMergeBuiltinStyles(bd.lineStyles, lineBuiltins)
    : _bdClone(lineBuiltins);
  // グローバルデフォルトをマージ (ユーザーが他のボードで「デフォルトとして保存」した
  // 値を、このボードのビルトインスタイルにも反映させる)
  _bdApplyGlobalDefaultsToStyleArray('card', nextCardStyles);
  _bdApplyGlobalDefaultsToStyleArray('line', nextLineStyles);
  bd.cardStyles = nextCardStyles;
  bd.lineStyles = nextLineStyles;
  // v9/v10 マイグレーション: 旧ビルトインカード/ラインスタイルを削除し、
  // テーマカラー対応の新しい初期搭載スタイルへ参照を移す。
  // v10 では削除済みのダイヤ/六角/星スタイルも同じ経路で除去する。
  if (currentVersion < 10) {
    _bdApplyV9BuiltinStyleMigration(cardBuiltins, lineBuiltins);
  }
  // v4 マイグレーション: 旧 shadow / textRotate を OR 集約してボード表示トグルへ昇格
  // 計画書: docs/format-popup-ui-unification-plan.md §4-3-A
  if (currentVersion < 4) {
    if (!bd._showShadow) {
      const anyShadow = bd.cardStyles.some(s => s && s.shadow)
        || (Array.isArray(bd.nodes) && bd.nodes.some(n => n && n.shadow));
      if (anyShadow) bd._showShadow = true;
    }
    if (!bd._textRotateOnLine) {
      const anyRot = bd.lineStyles.some(s => s && s.textRotate)
        || (Array.isArray(bd.connections) && bd.connections.some(c => c && c.textRotate));
      if (anyRot) bd._textRotateOnLine = true;
    }
    bd.cardStyles.forEach(s => { if (s) delete s.shadow; });
    bd.lineStyles.forEach(s => { if (s) delete s.textRotate; });
    if (Array.isArray(bd.nodes)) bd.nodes.forEach(n => { if (n) delete n.shadow; });
    if (Array.isArray(bd.connections)) bd.connections.forEach(c => { if (c) delete c.textRotate; });
  }
  // v5 マイグレーション: ビルトインスタイル (BD_DEFAULT_*_STYLES に id 一致するもの) の
  // 色を BD_DEFAULT で強制上書き。途中で BD_DEFAULT 色を共通カラーパレット準拠に変更したが
  // 保存ファイル側に旧色が残っている問題を解消する。
  if (currentVersion < 5) {
    bd.cardStyles.forEach(style => {
      if (!style?.id) return;
      const def = cardBuiltins.find(d => d && d.id === style.id);
      if (!def) return;
      style.bgColor = def.bgColor;
      style.textColor = def.textColor;
      style.borderColor = def.borderColor;
      if (def.textStrokeColor !== undefined) style.textStrokeColor = def.textStrokeColor;
    });
    bd.lineStyles.forEach(style => {
      if (!style?.id) return;
      const def = lineBuiltins.find(d => d && d.id === style.id);
      if (!def) return;
      style.color = def.color;
    });
  }
  // v8 マイグレーション: ライン文字の縁取り / ラベル枠線太さは「未設定なら 0」。
  // 旧 fallback の 1px が保存済みビルトインスタイルに残ると、何も設定していない
  // ラインテキストが白い縁取りで重なったように見えるため、ビルトインだけ既定値へ戻す。
  if (currentVersion < 8) {
    bd.lineStyles.forEach(style => {
      if (!style?.id) return;
      const def = lineBuiltins.find(d => d && d.id === style.id);
      if (!def || style._default) return;
      if (!Number.isFinite(+style.textShadowWidth) || +style.textShadowWidth === 1) style.textShadowWidth = 0;
      if (!Number.isFinite(+style.labelBorderWidth) || +style.labelBorderWidth === 1) style.labelBorderWidth = 0;
      if (!style.textShadowColor) style.textShadowColor = '';
    });
  }
  // v6 マイグレーション: 各 node/connection の個別 override を「カスタム」スタイルに変換。
  // 旧仕様で node.bgColor 等の override で見た目を変えていたデータを、
  // 「card-custom-{node.id}」「line-custom-{conn.id}」というスタイルに昇格させ、
  // node.cardStyle / conn.styleRef に割り当てる（override は削除）。
  // 注意: bdGetNodeStyle/bdGetConnectionStyle は内部で bdEnsureBoardUiState を呼ぶため
  // 再帰呼び出しを起こす。ここでは override + base style を直接合成する。
  if (currentVersion < 6) {
    const cardOverrideKeys = ['bgColor', 'textColor', 'borderColor', 'borderWidth', 'borderRadius',
      'fontSize', 'fontBold', 'fontItalic', 'textStrokeColor', 'textStrokeWidth', 'shape'];
    const lineOverrideKeys = ['color', 'width', 'style', 'arrow', 'pathType', 'straight', 'branchRatio', 'cornerRadius'];
    if (Array.isArray(bd.nodes)) {
      bd.nodes.forEach(node => {
        if (!node?.id) return;
        const hasOverride = cardOverrideKeys.some(key => node[key] !== undefined);
        if (!hasOverride) return;
        const baseId = node.cardStyle || bd.activeCardStyle || bd.cardStyles[0]?.id;
        const base = bd.cardStyles.find(s => s && s.id === baseId) || bd.cardStyles[0] || {};
        const pick = (key, fallback) => (node[key] !== undefined ? node[key] : (base[key] !== undefined ? base[key] : fallback));
        const customId = 'card-custom-' + node.id;
        const custom = {
          id: customId,
          name: 'カスタム',
          bgColor: pick('bgColor', '') || '',
          textColor: pick('textColor', '') || '',
          borderColor: pick('borderColor', '') || '',
          borderWidth: Number.isFinite(+pick('borderWidth', 0)) ? Math.max(0, +pick('borderWidth', 0)) : 0,
          borderRadius: Number.isFinite(+pick('borderRadius', 6)) ? Math.max(0, +pick('borderRadius', 6)) : 6,
          fontSize: Number.isFinite(+pick('fontSize', 13)) ? Math.max(8, +pick('fontSize', 13)) : 13,
          fontBold: !!pick('fontBold', false),
          fontItalic: !!pick('fontItalic', false),
          textStrokeColor: pick('textStrokeColor', '') || '',
          textStrokeWidth: Number.isFinite(+pick('textStrokeWidth', 0)) ? Math.max(0, +pick('textStrokeWidth', 0)) : 0,
          shape: pick('shape', '') || '',
          width: Number.isFinite(+(node.w || base.width)) ? Math.max(40, +(node.w || base.width || 160)) : 160,
        };
        const idx = bd.cardStyles.findIndex(s => s && s.id === customId);
        if (idx >= 0) bd.cardStyles.splice(idx, 1, custom);
        else bd.cardStyles.push(custom);
        node.cardStyle = customId;
        cardOverrideKeys.forEach(key => delete node[key]);
      });
    }
    if (Array.isArray(bd.connections)) {
      bd.connections.forEach(conn => {
        if (!conn?.id) return;
        const hasOverride = lineOverrideKeys.some(key => conn[key] !== undefined);
        if (!hasOverride) return;
        const baseId = conn.styleRef || bd.activeLineStyle || bd.lineStyles[0]?.id;
        const base = bd.lineStyles.find(s => s && s.id === baseId) || bd.lineStyles[0] || {};
        const pick = (key, fallback) => (conn[key] !== undefined ? conn[key] : (base[key] !== undefined ? base[key] : fallback));
        const customId = 'line-custom-' + conn.id;
        const rawArrow = conn.arrow !== undefined ? conn.arrow : base.arrow;
        const rawPath = conn.pathType !== undefined
          ? conn.pathType
          : (conn.straight ? 'straight' : (base.pathType !== undefined ? base.pathType : (base.straight ? 'straight' : 'curve')));
        const custom = {
          id: customId,
          name: 'カスタム',
          color: pick('color', '') || '',
          width: Number.isFinite(+pick('width', 0)) ? Math.max(0, +pick('width', 0)) : 0,
          style: pick('style', '') === 'dashed' ? 'dashed' : '',
          arrow: ['end', 'start', 'both', ''].includes(rawArrow) ? rawArrow : 'end',
          pathType: rawPath === 'orthogonal' ? 'orthogonal'
            : rawPath === 'orthogonal-curve' ? 'orthogonal'
            : rawPath === 'free-bezier' ? 'curve'
            : rawPath === 'straight' ? 'straight'
            : 'curve',
        };
        const idx = bd.lineStyles.findIndex(s => s && s.id === customId);
        if (idx >= 0) bd.lineStyles.splice(idx, 1, custom);
        else bd.lineStyles.push(custom);
        conn.styleRef = customId;
        lineOverrideKeys.forEach(key => delete conn[key]);
      });
    }
  }
  bd._stylePresetSeedVersion = BD_STYLE_PRESET_VERSION;
  } finally {
    delete bd._migrating;
  }
}

function bdNormalizeCardStyles(styles) {
  const defaults = _bdBuiltinCardStylesForBoard();
  const base = Array.isArray(styles) && styles.length
    ? styles.map(style => {
        const n = {
          id: style.id || '',
          name: style.name || 'トピック',
          bgColor: style.bgColor || '',
          textColor: style.textColor || '',
          borderColor: style.borderColor || '',
          borderWidth: Number.isFinite(+style.borderWidth) ? Math.max(0, +style.borderWidth) : 0,
          borderRadius: Number.isFinite(+style.borderRadius) ? Math.max(0, +style.borderRadius) : 6,
          fontSize: Number.isFinite(+style.fontSize) ? Math.max(8, +style.fontSize) : 13,
          fontBold: !!style.fontBold,
          fontItalic: !!style.fontItalic,
          fontFamily: typeof normalizeFontFamilyValue === 'function' ? normalizeFontFamilyValue(style.fontFamily) : (style.fontFamily || ''),
          textStrokeColor: style.textStrokeColor || '',
          textStrokeWidth: Number.isFinite(+style.textStrokeWidth) ? Math.max(0, +style.textStrokeWidth) : 0,
          // selectionColor / caretColor はボード全体設定 (bd.selectionColor / bd.caretColor) に移行したため
          // カードスタイルからは削除。旧データに残っていても読み込み時は無視する。
          shape: _bdNormalizeCardShapeValue(style.shape),
          width: Number.isFinite(+style.width) ? Math.max(40, +style.width) : 160,
          // 雲型パラメータ: 明示的に入っていれば保持、なければ undefined (fallback されて default が効く)
          cloudBumpWidth: Number.isFinite(+style.cloudBumpWidth) ? Math.max(8, Math.min(200, +style.cloudBumpWidth)) : undefined,
          cloudBumpHeight: Number.isFinite(+style.cloudBumpHeight) ? Math.max(2, Math.min(100, +style.cloudBumpHeight)) : undefined,
          cloudSideWidth: Number.isFinite(+style.cloudSideWidth) ? Math.max(2, Math.min(100, +style.cloudSideWidth)) : undefined,
          cloudOffset: Number.isFinite(+style.cloudOffset) ? Math.max(0, Math.min(1, +style.cloudOffset)) : undefined,
          // 幅・高さ別の小山比率。旧 cloudSubBumpRatio を migrate する: 新フィールドが無く旧値があれば両方にコピー
          cloudSubWidthRatio: Number.isFinite(+style.cloudSubWidthRatio)
            ? Math.max(0, Math.min(100, +style.cloudSubWidthRatio))
            : (Number.isFinite(+style.cloudSubBumpRatio) ? Math.max(0, Math.min(100, +style.cloudSubBumpRatio)) : undefined),
          cloudSubHeightRatio: Number.isFinite(+style.cloudSubHeightRatio)
            ? Math.max(0, Math.min(100, +style.cloudSubHeightRatio))
            : (Number.isFinite(+style.cloudSubBumpRatio) ? Math.max(0, Math.min(100, +style.cloudSubBumpRatio)) : undefined),
        };
        // ユーザー定義のデフォルトスナップショットは保持する（リセット対象）
        if (style._default && typeof style._default === 'object') n._default = _bdClone(style._default);
        return n;
      })
    : _bdClone(defaults);
  _bdEnsureUniqueStyleIds(base, 'card-style');
  return base;
}

function bdNormalizeLineStyles(styles) {
  // 保存値に欠けているキーがあれば、id 一致する BD_DEFAULT_LINE_STYLES から補完する。
  // （古い保存ファイルで pathType 等が抜けている場合、定数 'curve' に補完されると
  //  リセット後の BD_DEFAULT 値（'straight' 等）と差が出る問題への対策）
  const defaults = _bdBuiltinLineStylesForBoard();
  const base = Array.isArray(styles) && styles.length
    ? styles.map(style => {
        const def = (defaults || []).find(d => d && d.id === style.id);
        const fallbackArrow = def?.arrow ?? 'end';
        const fallbackPath = def?.pathType ?? 'curve';
        const n = {
          id: style.id || '',
          name: style.name || def?.name || 'ライン',
          color: style.color || def?.color || '',
          width: Number.isFinite(+style.width)
            ? Math.max(0, +style.width)
            : (Number.isFinite(+def?.width) ? +def.width : 0),
          style: style.style === 'dashed'
            ? 'dashed'
            : (style.style === '' ? '' : (def?.style ?? '')),
          arrow: ['end', 'start', 'both', ''].includes(style.arrow)
            ? style.arrow
            : fallbackArrow,
          pathType: style.pathType === 'free-bezier'
            ? 'curve'
            : style.pathType === 'orthogonal' || style.pathType === 'orthogonal-curve'
              ? 'orthogonal'
              : (style.pathType === 'straight' || style.straight)
                ? 'straight'
                : (style.pathType === 'curve' ? 'curve' : (fallbackPath === 'free-bezier' ? 'curve' : fallbackPath === 'orthogonal-curve' ? 'orthogonal' : fallbackPath)),
          // 選択色はボード全体の bd.selectionColor に移行したため、lineStyle からは削除
        };
        // ラベル系 / テキスト系フィールドをスタイルに保持する (bdRenderStyleManager で編集可能なため、
        // normalize で捨ててしまうと管理ダイアログ経由の変更が消えてしまう)。
        if (style.labelTextColor != null) n.labelTextColor = String(style.labelTextColor);
        if (style.labelBgColor != null) n.labelBgColor = String(style.labelBgColor);
        if (style.labelBorderColor != null) n.labelBorderColor = String(style.labelBorderColor);
        if (Number.isFinite(+style.labelBorderWidth)) n.labelBorderWidth = Math.max(0, Math.min(10, +style.labelBorderWidth));
        if (style.fontBold !== undefined) n.fontBold = !!style.fontBold;
        if (style.fontItalic !== undefined) n.fontItalic = !!style.fontItalic;
        if (style.fontFamily !== undefined) n.fontFamily = typeof normalizeFontFamilyValue === 'function' ? normalizeFontFamilyValue(style.fontFamily) : String(style.fontFamily || '');
        if (style.textVisible !== undefined) n.textVisible = !!style.textVisible;
        if (style.textAlongPath !== undefined) n.textAlongPath = !!style.textAlongPath;
        if (style.textAutoFlip !== undefined) n.textAutoFlip = !!style.textAutoFlip;
        if (Number.isFinite(+style.textShadowWidth)) n.textShadowWidth = Math.max(0, Math.min(10, +style.textShadowWidth));
        if (style.textShadowColor != null) n.textShadowColor = String(style.textShadowColor);
        // v0.5.324: 直角線パラメータを保持 (normalize で捨てると「入力→再描画で 0 に戻る」不具合)
        if (Number.isFinite(+style.branchRatio)) n.branchRatio = Math.max(0.05, Math.min(0.95, +style.branchRatio));
        if (Number.isFinite(+style.cornerRadius)) n.cornerRadius = Math.max(0, Math.min(40, +style.cornerRadius));
        // ユーザー定義のデフォルトスナップショットは保持する（リセット対象）
        if (style._default && typeof style._default === 'object') n._default = _bdClone(style._default);
        return n;
      })
    : _bdClone(defaults);
  _bdEnsureUniqueStyleIds(base, 'line-style');
  return base;
}

function bdNormalizeDisplayFilters(filters) {
  return { ...BD_DEFAULT_DISPLAY_FILTERS, ...(filters || {}) };
}

function bdEnsureBoardUiState() {
  if (typeof bd === 'undefined') return;
  bdApplyStylePresetMigration();
  bd.cardStyles = bdNormalizeCardStyles(bd.cardStyles);
  bd.lineStyles = bdNormalizeLineStyles(bd.lineStyles);
  // ボード初回ロード時にグローバルデフォルトを各ビルトインスタイルへ適用する。
  // 既に適用済みフラグが立っていれば重複適用しない (ユーザーがこのボードでカスタム
  // した後に他ボードで global を変更した場合、既存カスタムを上書きしない)
  if (!bd._globalStyleDefaultsApplied) {
    _bdApplyGlobalDefaultsToStyleArray('card', bd.cardStyles);
    _bdApplyGlobalDefaultsToStyleArray('line', bd.lineStyles);
    bd._globalStyleDefaultsApplied = true;
  }
  if (typeof bdEnsureDepthStyles === 'function') bdEnsureDepthStyles();
  bd.displayFilters = bdNormalizeDisplayFilters(bd.displayFilters);
  if (!bd.activeCardStyle || !bd.cardStyles.some(style => style.id === bd.activeCardStyle)) {
    bd.activeCardStyle = bd.cardStyles[0]?.id || '';
  }
  if (!bd.activeLineStyle || !bd.lineStyles.some(style => style.id === bd.activeLineStyle)) {
    bd.activeLineStyle = bd.lineStyles[0]?.id || '';
  }
  if (!['select', 'add-card', 'add-line', 'erase'].includes(bd.tool)) {
    bd.tool = 'select';
  }
}

function bdGetCardStyleById(styleId) {
  bdEnsureBoardUiState();
  return bd.cardStyles.find(style => style.id === styleId) || bd.cardStyles[0] || null;
}

function bdGetLineStyleById(styleId) {
  bdEnsureBoardUiState();
  return bd.lineStyles.find(style => style.id === styleId) || bd.lineStyles[0] || null;
}

function bdGetNodeStyle(node) {
  const style = bdGetCardStyleById(node?.cardStyle);
  const nodeCloudSubWidthRatio = node?.cloudSubWidthRatio !== undefined ? node.cloudSubWidthRatio : node?.cloudSubBumpRatio;
  const nodeCloudSubHeightRatio = node?.cloudSubHeightRatio !== undefined ? node.cloudSubHeightRatio : node?.cloudSubBumpRatio;
  const baseStyle = {
    bgColor: node?.bgColor !== undefined ? node.bgColor : (style?.bgColor || ''),
    textColor: node?.textColor !== undefined ? node.textColor : (style?.textColor || ''),
    borderColor: node?.borderColor !== undefined ? node.borderColor : (style?.borderColor || ''),
    borderWidth: node?.borderWidth !== undefined ? node.borderWidth : (style?.borderWidth ?? 0),
    borderRadius: node?.borderRadius !== undefined ? node.borderRadius : (style?.borderRadius ?? 6),
    fontSize: node?.fontSize !== undefined ? node.fontSize : (style?.fontSize ?? 13),
    fontBold: node?.fontBold !== undefined ? !!node.fontBold : !!style?.fontBold,
    fontItalic: node?.fontItalic !== undefined ? !!node.fontItalic : !!style?.fontItalic,
    fontFamily: style?.fontFamily || '',
    shadow: !!bd._showShadow,
    textStrokeColor: node?.textStrokeColor !== undefined ? node.textStrokeColor : (style?.textStrokeColor || ''),
    textStrokeWidth: node?.textStrokeWidth !== undefined ? node.textStrokeWidth : (style?.textStrokeWidth ?? 0),
    // v0.5.251: shape は空文字列 ('') = rect を意味する override 値として有効。
    // `||` を使うと '' が falsy 扱いになり override が効かないため、hasOwnProperty 相当の
    // `!== undefined` でチェックする (他のフィールドと同じ扱い)。
    shape: (typeof _bdNormalizeCardShapeValue === 'function'
      ? _bdNormalizeCardShapeValue(node?.shape !== undefined ? node.shape : (style?.shape || ''))
      : (node?.shape !== undefined ? node.shape : (style?.shape || ''))),
    width: node?.w || style?.width || 160,
    // 雲型用パラメータ (shape === 'cloud' のときのみ意味を持つ)
    cloudBumpWidth: node?.cloudBumpWidth !== undefined ? node.cloudBumpWidth : (style?.cloudBumpWidth ?? 40),
    cloudBumpHeight: node?.cloudBumpHeight !== undefined ? node.cloudBumpHeight : (style?.cloudBumpHeight ?? 16),
    cloudSideWidth: node?.cloudSideWidth !== undefined ? node.cloudSideWidth : (style?.cloudSideWidth ?? 12),
    cloudOffset: node?.cloudOffset !== undefined ? node.cloudOffset : (style?.cloudOffset ?? 0.5),
    // 小山サイズ比率 (0-100%)。メイン山に対する幅・高さ個別のスケール。両方 > 0 で小山が現れる。
    cloudSubWidthRatio: nodeCloudSubWidthRatio !== undefined ? nodeCloudSubWidthRatio : (style?.cloudSubWidthRatio ?? 0),
    cloudSubHeightRatio: nodeCloudSubHeightRatio !== undefined ? nodeCloudSubHeightRatio : (style?.cloudSubHeightRatio ?? 0),
  };
  if (typeof MeldexThemeColoring !== 'undefined' && typeof MeldexThemeColoring.resolveNodeStyle === 'function') {
    return MeldexThemeColoring.resolveNodeStyle({ board: bd, node, baseStyle });
  }
  return baseStyle;
}

function bdGetConnectionStyle(conn) {
  const style = bdGetLineStyleById(conn?.styleRef);
  const themeLineColor = (typeof MeldexThemeManager !== 'undefined' && typeof MeldexThemeManager.getActiveBoardTheme === 'function')
    ? (MeldexThemeManager.getActiveBoardTheme(bd)?.board?.lineColor || '')
    : '';
  const hasArrow = conn && Object.prototype.hasOwnProperty.call(conn, 'arrow');
  const hasWidth = conn && Object.prototype.hasOwnProperty.call(conn, 'width');
  const hasPathType = conn && (Object.prototype.hasOwnProperty.call(conn, 'pathType') || Object.prototype.hasOwnProperty.call(conn, 'straight'));
  const hasLineValue = key => conn && Object.prototype.hasOwnProperty.call(conn, key);
  return {
    color: hasLineValue('color') ? conn.color : (style?.color || themeLineColor || ''),
    width: hasWidth ? conn.width : (style?.width ?? 0),
    style: hasLineValue('style') ? (conn.style === 'dashed' ? 'dashed' : '') : (style?.style || ''),
    arrow: hasArrow ? conn.arrow : (style?.arrow ?? 'end'),
    pathType: hasPathType
      ? (conn?.pathType === 'free-bezier' ? 'curve' : conn?.pathType === 'orthogonal-curve' ? 'orthogonal' : conn?.pathType === 'orthogonal' ? 'orthogonal' : ((conn?.pathType === 'straight' || conn?.straight) ? 'straight' : 'curve'))
      : (style?.pathType === 'free-bezier' ? 'curve' : style?.pathType === 'orthogonal-curve' ? 'orthogonal' : style?.pathType === 'orthogonal' ? 'orthogonal' : ((style?.pathType === 'straight' || style?.straight) ? 'straight' : 'curve')),
    labelTextColor: hasLineValue('labelTextColor') ? conn.labelTextColor : (style?.labelTextColor || ''),
    labelBgColor: hasLineValue('labelBgColor') ? conn.labelBgColor : (style?.labelBgColor || ''),
    labelBorderColor: hasLineValue('labelBorderColor') ? conn.labelBorderColor : (style?.labelBorderColor || ''),
    // ラインテキストの太字 / 斜体
    fontBold: conn?.fontBold !== undefined ? !!conn.fontBold : !!style?.fontBold,
    fontItalic: conn?.fontItalic !== undefined ? !!conn.fontItalic : !!style?.fontItalic,
    fontFamily: style?.fontFamily || '',
    textRotate: !!bd._textRotateOnLine,
    // Free Bezier テキスト関連 (Phase 5-3/5-4): conn > style > デフォルト
    textVisible: conn?.textVisible !== undefined
      ? !!conn.textVisible
      : (style?.textVisible !== undefined ? !!style.textVisible : true),
    textAlongPath: conn?.textAlongPath !== undefined
      ? !!conn.textAlongPath
      : (style?.textAlongPath !== undefined ? !!style.textAlongPath : false),
    textAutoFlip: conn?.textAutoFlip !== undefined
      ? !!conn.textAutoFlip
      : (style?.textAutoFlip !== undefined ? !!style.textAutoFlip : true),
    textShadowWidth: Number.isFinite(+conn?.textShadowWidth)
      ? Math.max(0, +conn.textShadowWidth)
      : (Number.isFinite(+style?.textShadowWidth) ? Math.max(0, +style.textShadowWidth) : 0),
    textShadowColor: hasLineValue('textShadowColor') ? conn.textShadowColor : (style?.textShadowColor || ''),
    labelBorderWidth: Number.isFinite(+conn?.labelBorderWidth)
      ? Math.max(0, +conn.labelBorderWidth)
      : (Number.isFinite(+style?.labelBorderWidth) ? Math.max(0, +style.labelBorderWidth) : 0),
    // v0.5.323: 直角線パラメータを effective に含める (conn > style > default)
    branchRatio: Number.isFinite(+conn?.branchRatio)
      ? Math.max(0.05, Math.min(0.95, +conn.branchRatio))
      : (Number.isFinite(+style?.branchRatio) ? Math.max(0.05, Math.min(0.95, +style.branchRatio)) : 0.3),
    cornerRadius: Number.isFinite(+conn?.cornerRadius)
      ? Math.max(0, Math.min(40, +conn.cornerRadius))
      : (Number.isFinite(+style?.cornerRadius) ? Math.max(0, Math.min(40, +style.cornerRadius)) : 0),
  };
}

function bdClearCardStyleOverrides(node) {
  [
    'bgColor',
    'textColor',
    'borderColor',
    'borderWidth',
    'borderRadius',
    'fontSize',
    'fontBold',
    'fontItalic',
    'textStrokeColor',
    'textStrokeWidth',
    'shape',
    'cloudBumpWidth',
    'cloudBumpHeight',
    'cloudSideWidth',
    'cloudOffset',
    'cloudSubBumpRatio',
    'cloudSubWidthRatio',
    'cloudSubHeightRatio',
    '_userBgColor',
    '_userFontSize',
    '_userFontBold',
    '_userW',
  ].forEach(key => delete node[key]);
}

function bdSetNodeCardStyleRef(node, styleId, options = {}) {
  if (!node) return false;
  node.cardStyle = styleId || '';
  if (options.clearOverrides !== false && typeof bdClearCardStyleOverrides === 'function') {
    bdClearCardStyleOverrides(node);
  }
  if (styleId) node._userCardStyle = true;
  else delete node._userCardStyle;
  return true;
}

function bdCreateNodeWithStyle(text, x, y, opts) {
  bdEnsureBoardUiState();
  const nextOpts = { ...(opts || {}) };
  const hasParent = !!nextOpts.parent;
  const hasExplicitAutoStyle = Object.prototype.hasOwnProperty.call(nextOpts, '_autoStyle');
  const hasExplicitStructure = Object.prototype.hasOwnProperty.call(nextOpts, 'structure');
  const isPlainRootCard = !hasParent && !nextOpts.link && !nextOpts.img;
  if (isPlainRootCard && !hasExplicitAutoStyle) nextOpts._autoStyle = true;
  if (isPlainRootCard && !hasExplicitStructure) nextOpts.structure = 'logic';
  if (!Object.prototype.hasOwnProperty.call(nextOpts, 'cardStyle') && bd.activeCardStyle) {
    nextOpts.cardStyle = bd.activeCardStyle;
  }
  const style = bdGetCardStyleById(nextOpts.cardStyle);
  const width = nextOpts.w || style?.width || (nextOpts.img ? 240 : 160);
  // デフォルト高さ = 一行ぶん (padding 8+8 + fontSize * line-height 1.5)。
  // 画像カードは画像の natural size に合わせるため h=0 を維持。明示値 (nextOpts.h) があればそれ優先。
  const fontSize = Number.isFinite(+style?.fontSize) ? +style.fontSize : 13;
  const oneLineHeight = Math.ceil(fontSize * 1.5) + 16;
  const height = nextOpts.h || (nextOpts.img ? 0 : oneLineHeight);
  delete nextOpts.w;
  delete nextOpts.h;
  const node = bdNode(text || '', x, y, width, height, nextOpts);
  if (node._autoStyle && typeof _bdApplyDepthCardFieldsToNode === 'function' && typeof bdGetAutoStyleForDepth === 'function') {
    _bdApplyDepthCardFieldsToNode(node, bdGetAutoStyleForDepth(0));
  }
  return node;
}

// 選択中カードを起点に Enter / Tab / Ctrl+Enter で新カードを追加する際、
// 「同じスタイル」を継承するための opts を組み立てる。
// cardStyle (スタイル ID) と、各カードに保存されている個別 override (フォント / 色 / 形状 等) を写す。
// 内容系 (text/img/link/linkType) と状態系 (locked/collapsed/minimized/contained/note 等) はコピーしない。
const _BD_INHERIT_STYLE_KEYS = [
  'cardStyle', '_userCardStyle',
  'bgColor', 'textColor', 'borderColor', 'borderWidth', 'borderRadius',
  'fontSize', 'fontBold', 'fontItalic',
  'textStrokeColor', 'textStrokeWidth',
  'shape',
  'cloudBumpWidth', 'cloudBumpHeight', 'cloudSideWidth', 'cloudOffset',
  'cloudSubBumpRatio', 'cloudSubWidthRatio', 'cloudSubHeightRatio',
];
function bdInheritStyleOpts(srcNode) {
  const opts = {};
  if (!srcNode) return opts;
  _BD_INHERIT_STYLE_KEYS.forEach(key => {
    if (Object.prototype.hasOwnProperty.call(srcNode, key) && srcNode[key] !== undefined) {
      opts[key] = srcNode[key];
    }
  });
  // 幅は手動リサイズされている可能性があるため継承する。
  // 高さは新規カードが空テキスト想定のため bdCreateNodeWithStyle 側の 1 行分計算に任せる。
  if (Number.isFinite(+srcNode.w) && +srcNode.w > 0) opts.w = +srcNode.w;
  return opts;
}

// 選択中カードに子カードを追加する。Ctrl+Enter / Tab / コンテキストメニューから呼ばれる。
// 親と同じスタイルを継承し、追加直後はインライン編集を発火させない (F2 で編集開始)。
function bdAddChildToSelected() {
  const perf = typeof bdPerfStart === 'function' ? bdPerfStart('bdAddChildToSelected') : 0;
  if (typeof bdBeginFastBoardMutation === 'function') bdBeginFastBoardMutation();
  try {
    if (typeof bd === 'undefined' || bd.editing) return null;
    if (bd.selected.size !== 1) return null;
    const parentId = [...bd.selected][0];
    const parentNode = bd.nodes.find(n => n.id === parentId);
    if (!parentNode) return null;
    const el = document.getElementById('bdn-' + parentId);
    const pw = el ? el.offsetWidth : (parentNode.w || 160);
    const ph = el ? el.offsetHeight : (parentNode.h || 36);
    const G = (typeof bdLayoutGaps === 'function') ? bdLayoutGaps() : { sibling: 40, level: 60 };
    const root = bdRoot(parentId);
    // 中間カードで structure が明示設定されている場合はそれを優先 (コミット c33a3a6)。
    // bdStructureOf が 自分→親→… と遡って最初の非空を返すので、親のサブツリーに適用される構造を得る。
    const effectiveStructure = (typeof bdStructureOf === 'function') ? bdStructureOf(parentId) : (root?.structure || '');
    const isTreeStructure = effectiveStructure === 'tree';
    // 構造方向に応じて配置位置を決定 (右展開 / 下展開 / 左展開 を考慮)
    // mindmap は放射状で親ノード位置に応じて展開方向が変わるため、
    // bdTreeDirection の動的判定に委ねる（logic / timeline / flowchart / orgchart / tree は固定）
    const dir = (effectiveStructure === 'flowchart' || effectiveStructure === 'orgchart' || effectiveStructure === 'tree') ? 'down'
      : (effectiveStructure === 'logic' || effectiveStructure === 'timeline') ? 'right'
      : (typeof bdTreeDirection === 'function') ? bdTreeDirection(parentId) : 'right';
    let nx = parentNode.x + pw + G.level;
    let ny = parentNode.y;
    if (isTreeStructure) { nx = parentNode.x + G.level; ny = parentNode.y + ph + G.sibling; }
    else if (dir === 'down') { nx = parentNode.x; ny = parentNode.y + ph + G.level; }
    else if (dir === 'up') { nx = parentNode.x; ny = parentNode.y - ph - G.level; }
    else if (dir === 'left') { nx = parentNode.x - pw - G.level; ny = parentNode.y; }
    bdPushUndo();
    // 課題6・18-案A: 起点 (最も近い _autoStyle カード) が効いていれば深さ別スタイルを
    // 挿入前に同期適用する。従来は親の見た目をコピーするだけで、220〜420ms 後の自動整列
    // (bdApplyAutoStyle) が深さ別スタイルへ書き換えるまで「既定→適用」の二段階に見えていた。
    const anchor = (typeof _bdNearestAutoStyleAnchor === 'function') ? _bdNearestAutoStyleAnchor(parentId) : null;
    const useDepthStyle = !!anchor && typeof bdGetAutoStyleForDepth === 'function' && typeof _bdApplyDepthCardFieldsToNode === 'function';
    const parentDepth = (typeof _bdAnchorRelativeDepth === 'function') ? _bdAnchorRelativeDepth(parentId, anchor) : 0;
    const childDepthStyle = useDepthStyle ? bdGetAutoStyleForDepth(parentDepth + 1, anchor) : null;
    // 階層別スタイル未使用ツリーでは現行どおり親の見た目を継承する。
    const childOpts = childDepthStyle ? { parent: parentId } : { ...bdInheritStyleOpts(parentNode), parent: parentId };
    const child = bdCreateNodeWithStyle('', nx, ny, childOpts);
    if (childDepthStyle) _bdApplyDepthCardFieldsToNode(child, childDepthStyle);
    bd.nodes.push(child);
    const conn = typeof bdCreateStructureConnection === 'function'
      ? bdCreateStructureConnection(parentId, child.id, effectiveStructure)
      : bdCreateConnectionWithStyle(parentId, child.id, { arrow: effectiveStructure === 'flowchart' ? 'end' : '' });
    if (childDepthStyle && typeof _bdApplyDepthLineFieldsToConn === 'function') {
      _bdApplyDepthLineFieldsToConn(conn, bdGetAutoStyleForDepth(parentDepth, anchor));
    }
    bd.connections.push(conn);
    // ツリー全体に構造が一つも無い場合 (= bdStructureOf が '' を返す)、ルートに既定を書き込む。
    // 中間カードの構造設定が既に効いている場合はここには入らない。
    if (!effectiveStructure && root && !root.structure) {
      // 既に下方向に展開している場合は flowchart、それ以外は mindmap を既定とする
      root.structure = (dir === 'down' || dir === 'up') ? 'flowchart' : 'mindmap';
    }
    if (typeof bdAppendFastNode !== 'function' || !bdAppendFastNode(child)) {
      if (typeof bdRequestFullRender === 'function') bdRequestFullRender('add-child-fallback');
      else bdRender();
    }
    if (typeof bdMarkNodeDirty === 'function') bdMarkNodeDirty(child.id, 'add-child');
    if (typeof bdMarkConnectionsDirtyByNodes === 'function') bdMarkConnectionsDirtyByNodes([parentId, child.id], 'add-child');
    if (typeof bdMarkSelectionDirty === 'function') bdMarkSelectionDirty([parentId, child.id], 'add-child');
    if (typeof bdMarkExtrasDirty === 'function') bdMarkExtrasDirty({ minimap: true, boardUi: true, comments: [child.id] }, 'add-child');
    // ルート構造 or 中間カード構造のいずれかがあれば自動整列をリクエスト。
    // bdAutoLayout はツリー内の structure-set ノードを DFS で見つけて個別適用するため root.id 起点で OK。
    const treeHasStructure = root?.structure || effectiveStructure;
    if (treeHasStructure && root) {
      if (typeof bdRequestAutoLayout === 'function') bdRequestAutoLayout(root.id);
      else bdAutoLayout(root.id);
    }
    bdSelect(child.id);
    bdDirty();
    return child;
  } finally {
    if (typeof bdEndFastBoardMutation === 'function') bdEndFastBoardMutation();
    if (typeof bdPerfEnd === 'function') bdPerfEnd('bdAddChildToSelected', perf);
  }
}

// 選択中カードと同階層 (同じ親を持つ) の新規カードを追加する。Enter / コンテキストメニューから呼ばれる。
// ルートカード (親なし) の場合は同階層追加できないため null を返す。
function bdAddSiblingToSelected() {
  const perf = typeof bdPerfStart === 'function' ? bdPerfStart('bdAddSiblingToSelected') : 0;
  if (typeof bdBeginFastBoardMutation === 'function') bdBeginFastBoardMutation();
  try {
    if (typeof bd === 'undefined' || bd.editing) return null;
    if (bd.selected.size !== 1) return null;
    const selId = [...bd.selected][0];
    const selNode = bd.nodes.find(n => n.id === selId);
    if (!selNode || !selNode.parent) return null;
    const parentId = selNode.parent;
    const el = document.getElementById('bdn-' + selNode.id);
    const sibH = el ? el.offsetHeight : (selNode.h || 36);
    const sibW = el ? el.offsetWidth : (selNode.w || 160);
    const G = (typeof bdLayoutGaps === 'function') ? bdLayoutGaps() : { sibling: 40, level: 60 };
    const root = bdRoot(parentId);
    // 中間カード構造 (c33a3a6) を尊重: 親に適用される有効 structure を取得。
    const effectiveStructure = (typeof bdStructureOf === 'function') ? bdStructureOf(parentId) : (root?.structure || '');
    const isTreeStructure = effectiveStructure === 'tree';
    // mindmap は放射状で親ノード位置に応じて展開方向が変わるため、
    // bdTreeDirection の動的判定に委ねる（logic / timeline / flowchart / orgchart / tree は固定）
    const dir = (effectiveStructure === 'flowchart' || effectiveStructure === 'orgchart' || effectiveStructure === 'tree') ? 'down'
      : (effectiveStructure === 'logic' || effectiveStructure === 'timeline') ? 'right'
      : (typeof bdTreeDirection === 'function') ? bdTreeDirection(parentId) : 'right';
    // 兄弟は構造の「展開方向」に対して直交方向に並ぶ。
    // 右展開 / 左展開 → 兄弟は縦に並ぶ → 選択カードの下に追加
    // 下展開 / 上展開 → 兄弟は横に並ぶ → 選択カードの右に追加
    let nx = selNode.x;
    let ny = selNode.y + sibH + G.sibling;
    if (!isTreeStructure && (dir === 'down' || dir === 'up')) {
      nx = selNode.x + sibW + G.sibling;
      ny = selNode.y;
    }
    bdPushUndo();
    // 課題6・18-案A: 起点 (最も近い _autoStyle カード) が効いていれば深さ別スタイルを
    // 挿入前に同期適用する。兄弟は selNode と同じ親を共有する = selNode 自身の子孫ではないため、
    // 起点解決は parentId 起点で行う (selId 起点で解決すると、selNode 自身が起点カードだった
    // 場合に selNode 自身の「深さ0」を誤って兄弟へ適用してしまう)。無ければ従来どおり
    // 選択カードの見た目を継承する。
    const anchor = (typeof _bdNearestAutoStyleAnchor === 'function') ? _bdNearestAutoStyleAnchor(parentId) : null;
    const useDepthStyle = !!anchor && typeof bdGetAutoStyleForDepth === 'function' && typeof _bdApplyDepthCardFieldsToNode === 'function';
    const parentDepth = (typeof _bdAnchorRelativeDepth === 'function') ? _bdAnchorRelativeDepth(parentId, anchor) : 0;
    const sibDepthStyle = useDepthStyle ? bdGetAutoStyleForDepth(parentDepth + 1, anchor) : null;
    const sibOpts = sibDepthStyle ? { parent: parentId } : { ...bdInheritStyleOpts(selNode), parent: parentId };
    const sib = bdCreateNodeWithStyle('', nx, ny, sibOpts);
    if (sibDepthStyle) _bdApplyDepthCardFieldsToNode(sib, sibDepthStyle);
    const insertIndex = bd.nodes.findIndex(node => node.id === selId);
    if (insertIndex >= 0) bd.nodes.splice(insertIndex + 1, 0, sib);
    else bd.nodes.push(sib);
    const conn = typeof bdCreateStructureConnection === 'function'
      ? bdCreateStructureConnection(parentId, sib.id, effectiveStructure)
      : bdCreateConnectionWithStyle(parentId, sib.id, { arrow: effectiveStructure === 'flowchart' ? 'end' : '' });
    if (sibDepthStyle && typeof _bdApplyDepthLineFieldsToConn === 'function') {
      _bdApplyDepthLineFieldsToConn(conn, bdGetAutoStyleForDepth(parentDepth, anchor));
    }
    bd.connections.push(conn);
    if (typeof bdAppendFastNode !== 'function' || !bdAppendFastNode(sib)) {
      if (typeof bdRequestFullRender === 'function') bdRequestFullRender('add-sibling-fallback');
      else bdRender();
    }
    if (typeof bdMarkNodeDirty === 'function') bdMarkNodeDirty(sib.id, 'add-sibling');
    if (typeof bdMarkConnectionsDirtyByNodes === 'function') bdMarkConnectionsDirtyByNodes([parentId, sib.id], 'add-sibling');
    if (typeof bdMarkSelectionDirty === 'function') bdMarkSelectionDirty([selId, sib.id], 'add-sibling');
    if (typeof bdMarkExtrasDirty === 'function') bdMarkExtrasDirty({ minimap: true, boardUi: true, comments: [sib.id] }, 'add-sibling');
    let diffLayoutApplied = false;
    const treeHasStructure = root?.structure || effectiveStructure;
    if (treeHasStructure && root) {
      if (typeof bdApplySiblingDifferentialLayout === 'function') {
        const diffLayout = bdApplySiblingDifferentialLayout({
          sibling: sib,
          selectedNode: selNode,
          parentId,
          root,
          direction: isTreeStructure ? 'right' : dir,
          gap: G.sibling,
        });
        diffLayoutApplied = !!diffLayout?.applied;
      }
      if (!diffLayoutApplied && typeof bdDrawConns === 'function') {
        bdDrawConns({ nodeIds: [parentId, sib.id], reason: 'add-sibling-fallback' });
      }
      // 差分レイアウトで位置確保した後も、カード高さ差による整列ズレを解消するため
      // 常に全体整列をリクエストする（bdRequestAutoLayout はデバウンス+rAFされる）。
      if (typeof bdRequestAutoLayout === 'function') bdRequestAutoLayout(root.id, BD_FAST_SIBLING_AUTO_LAYOUT_DELAY_MS);
      else bdAutoLayout(root.id);
    } else if (typeof bdDrawConns === 'function') {
      bdDrawConns({ nodeIds: [parentId, sib.id], reason: 'add-sibling' });
    }
    bdSelect(sib.id);
    bdDirty();
    return sib;
  } finally {
    if (typeof bdEndFastBoardMutation === 'function') bdEndFastBoardMutation();
    if (typeof bdPerfEnd === 'function') bdPerfEnd('bdAddSiblingToSelected', perf);
  }
}

function bdCreateLinkCardNode(path, x, y, label, opts) {
  const nextPath = String(path || '').trim();
  if (!nextPath) return null;
  const fileName = nextPath.split(/[/\\]/).pop() || nextPath;
  const text = String(label || fileName).trim() || fileName;
  const nextOpts = { ...(opts || {}), link: nextPath };
  if (nextOpts.linkType) nextOpts.linkType = String(nextOpts.linkType).trim();
  else if (typeof _bdInferLinkType === 'function') nextOpts.linkType = _bdInferLinkType(nextPath, '');
  if (!Object.prototype.hasOwnProperty.call(nextOpts, 'w')) nextOpts.w = nextOpts.img ? 240 : 200;
  return bdCreateNodeWithStyle(text, x, y, nextOpts);
}

function bdAddLinkCardAt(x, y, path, label, opts) {
  const node = bdCreateLinkCardNode(path, x, y, label, opts);
  if (!node) return null;
  bdPushUndo();
  bd.nodes.push(node);
  if (typeof bdAppendFastNode !== 'function' || !bdAppendFastNode(node)) {
    if (typeof bdRequestFullRender === 'function') bdRequestFullRender('add-link-card-fallback');
    else bdRender();
  }
  if (typeof bdMarkNodeDirty === 'function') bdMarkNodeDirty(node.id, 'add-link-card');
  if (typeof bdMarkExtrasDirty === 'function') bdMarkExtrasDirty({ minimap: true, boardUi: true, comments: [node.id] }, 'add-link-card');
  bdSelect(node.id);
  bdDirty();
  showStatus('リンクトピックを追加: ' + (label || node.text || path));
  return node;
}

async function bdPromptAddLinkCardAt(x, y) {
  if (typeof showLinkInsertModal === 'function') {
    showLinkInsertModal(null, (result) => {
      if (result.type === 'file') {
        bdAddLinkCardAt(x, y, result.path, result.name, { linkType: result.fileType || '' });
      } else if (result.type === 'url') {
        const label = result.url.split('/').pop() || result.url;
        bdAddLinkCardAt(x, y, result.url, label);
      }
    });
    return;
  }
  // フォールバック: モーダルが未ロードの場合
  const rawPath = await cfPrompt('リンクトピックのリンク先パス', '');
  if (rawPath == null) return null;
  const path = rawPath.trim();
  if (!path) return null;
  const fallback = path.split(/[/\\]/).pop() || path;
  const rawLabel = await cfPrompt('トピック名', fallback);
  if (rawLabel == null) return null;
  const label = rawLabel.trim() || fallback;
  return bdAddLinkCardAt(x, y, path, label);
}

function bdGetCanvasCenterWorld() {
  const canvas = document.getElementById('bd-canvas');
  const rect = canvas?.getBoundingClientRect();
  if (!rect) return { x: 120, y: 120 };
  return {
    x: (rect.width / 2 - bd.panX) / bd.zoom,
    y: (rect.height / 2 - bd.panY) / bd.zoom,
  };
}

function bdCreateConnectionWithStyle(fromId, toId, opts) {
  bdEnsureBoardUiState();
  const nextOpts = { ...(opts || {}) };
  const styleId = nextOpts.styleRef !== undefined ? nextOpts.styleRef : bd.activeLineStyle;
  const conn = {
