/* gb-board-ui.js: flattened split script for static cloud hosting. */
/* Source chunk: gb-board-ui.part01.js */
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

function _bdReplaceBuiltinStyleSet(styles, builtins, legacyMap) {
  const legacyIds = new Set(Object.keys(legacyMap || {}));
  const builtinIds = new Set((builtins || []).map(style => style && style.id).filter(Boolean));
  const custom = (Array.isArray(styles) ? styles : []).filter(style =>
    style && !legacyIds.has(style.id) && !builtinIds.has(style.id));
  return [..._bdClone(builtins || []), ...custom];
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
    { fontSize: 16, fontBold: true, width: 200, bgColor: 'var(--bg4)', defaultText: 'カード' },
    { fontSize: 14, fontBold: true, width: 170, bgColor: 'var(--bg3)', defaultText: 'サブカード' },
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
  const mapCard = id => _bdMapLegacyStyleId(id, BD_LEGACY_CARD_STYLE_ID_MAP) || cardFallbackId;
  const mapLine = id => _bdMapLegacyStyleId(id, BD_LEGACY_LINE_STYLE_ID_MAP) || lineFallbackId;

  bd.cardStyles = _bdReplaceBuiltinStyleSet(bd.cardStyles, cardBuiltins, BD_LEGACY_CARD_STYLE_ID_MAP);
  bd.lineStyles = _bdReplaceBuiltinStyleSet(bd.lineStyles, lineBuiltins, BD_LEGACY_LINE_STYLE_ID_MAP);
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
          name: style.name || 'カード',
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
    cloudSubWidthRatio: node?.cloudSubWidthRatio !== undefined ? node.cloudSubWidthRatio : (style?.cloudSubWidthRatio ?? 0),
    cloudSubHeightRatio: node?.cloudSubHeightRatio !== undefined ? node.cloudSubHeightRatio : (style?.cloudSubHeightRatio ?? 0),
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
  return {
    color: conn?.color || style?.color || themeLineColor || '',
    width: hasWidth ? conn.width : (style?.width ?? 0),
    style: conn?.style || style?.style || '',
    arrow: hasArrow ? conn.arrow : (style?.arrow ?? 'end'),
    pathType: hasPathType
      ? (conn?.pathType === 'free-bezier' ? 'curve' : conn?.pathType === 'orthogonal-curve' ? 'orthogonal' : conn?.pathType === 'orthogonal' ? 'orthogonal' : ((conn?.pathType === 'straight' || conn?.straight) ? 'straight' : 'curve'))
      : (style?.pathType === 'free-bezier' ? 'curve' : style?.pathType === 'orthogonal-curve' ? 'orthogonal' : style?.pathType === 'orthogonal' ? 'orthogonal' : ((style?.pathType === 'straight' || style?.straight) ? 'straight' : 'curve')),
    labelTextColor: conn?.labelTextColor || style?.labelTextColor || '',
    labelBgColor: conn?.labelBgColor || style?.labelBgColor || '',
    labelBorderColor: conn?.labelBorderColor || style?.labelBorderColor || '',
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
    textShadowColor: conn?.textShadowColor || style?.textShadowColor || '',
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
  ].forEach(key => delete node[key]);
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
  'cardStyle',
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
    if (Object.prototype.hasOwnProperty.call(srcNode, key) && srcNode[key] !== undefined && srcNode[key] !== '') {
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
    const child = bdCreateNodeWithStyle('', nx, ny, { ...bdInheritStyleOpts(parentNode), parent: parentId });
    bd.nodes.push(child);
    bd.connections.push({ from: parentId, to: child.id, arrow: effectiveStructure === 'flowchart' });
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
    const sib = bdCreateNodeWithStyle('', nx, ny, { ...bdInheritStyleOpts(selNode), parent: parentId });
    const insertIndex = bd.nodes.findIndex(node => node.id === selId);
    if (insertIndex >= 0) bd.nodes.splice(insertIndex + 1, 0, sib);
    else bd.nodes.push(sib);
    bd.connections.push({ from: parentId, to: sib.id, arrow: effectiveStructure === 'flowchart' });
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
  showStatus('リンクカードを追加: ' + (label || node.text || path));
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
  const rawPath = await cfPrompt('リンクカードのリンク先パス', '');
  if (rawPath == null) return null;
  const path = rawPath.trim();
  if (!path) return null;
  const fallback = path.split(/[/\\]/).pop() || path;
  const rawLabel = await cfPrompt('カード名', fallback);
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
    id: bdId(),
    from: fromId || '',
    to: toId || '',
    label: nextOpts.label || '',
    styleRef: styleId || '',
  };
  if (!conn.from && nextOpts.fromPoint) conn.fromPoint = bdNormalizeConnectionPoint(nextOpts.fromPoint);
  if (!conn.to && nextOpts.toPoint) conn.toPoint = bdNormalizeConnectionPoint(nextOpts.toPoint);
  if (nextOpts.arrow !== undefined) conn.arrow = nextOpts.arrow;
  if (nextOpts.style !== undefined) conn.style = nextOpts.style;
  if (nextOpts.color !== undefined) conn.color = nextOpts.color;
  if (nextOpts.hidden) conn.hidden = true;
  if (nextOpts.pathType !== undefined) conn.pathType = nextOpts.pathType === 'free-bezier' ? 'curve'
    : nextOpts.pathType === 'orthogonal-curve' ? 'orthogonal'
    : nextOpts.pathType === 'orthogonal' ? 'orthogonal'
    : nextOpts.pathType === 'straight' ? 'straight' : 'curve';
  else if (nextOpts.straight !== undefined) conn.pathType = nextOpts.straight ? 'straight' : 'curve';
  if (nextOpts.width !== undefined) conn.width = nextOpts.width;
  return conn;
}

function bdCreateConnection(fromId, toId, opts) {
  // v0.5.333: 自己ループ (fromId === toId) も許可。
  // 自己ループは形状別既定経路 (曲線: 左上象限ループ / 直角線: L 字 2 段迂回) で描画される。
  const draft = { from: fromId || '', to: toId || '', fromPoint: opts?.fromPoint, toPoint: opts?.toPoint };
  if (!bdConnectionHasEndpoint(draft, 'from') || !bdConnectionHasEndpoint(draft, 'to')) return null;
  // v0.5.250: 同じカードペア間の複数ラインを許可 (相関図用)。
  // 以前は (from,to) or (to,from) が存在すると null を返していた制約を撤去。
  const conn = bdCreateConnectionWithStyle(fromId, toId, opts);
  bd.connections.push(conn);
  if (typeof bdMarkConnectionDirty === 'function') bdMarkConnectionDirty(conn.id, 'create-connection');
  else if (typeof bdDrawConns === 'function') bdDrawConns({ connIds: [conn.id], reason: 'create-connection' });
  if (typeof bdDirty === 'function') bdDirty();
  return conn;
}

function bdMarkerIconHtml(marker, size) {
  const nextSize = size || 12;
  const color = marker?.color || 'currentColor';
  const box = `width="${nextSize}" height="${nextSize}" viewBox="0 0 24 24"`;
  // カスタム描画の図形は r=7 程度で viewBox の半分強しか占めないため、
  // ステータスドット (14x14 べた塗り) と視覚サイズを揃えるべく scale 1.6 を
  // 中心 (12,12) まわりに掛けて shape を viewBox ほぼ一杯まで引き延ばす
  // (matrix: e = f = 12*(1-1.6) = -7.2)。
  const wrap = (inner) => `<svg ${box} fill="none" xmlns="http://www.w3.org/2000/svg"><g transform="matrix(1.6 0 0 1.6 -7.2 -7.2)">${inner}</g></svg>`;
  switch (marker?.icon) {
    case 'circle':
      return wrap(`<circle cx="12" cy="12" r="7" fill="${_bdEscAttr(color)}" stroke="${_bdEscAttr(color)}" stroke-width="2"/>`);
    case 'square':
      return wrap(`<rect x="5" y="5" width="14" height="14" rx="2" fill="${_bdEscAttr(color)}" stroke="${_bdEscAttr(color)}" stroke-width="2"/>`);
    case 'checkSquare':
      return wrap(`<rect x="4.5" y="4.5" width="15" height="15" rx="2" fill="${_bdEscAttr(color)}" stroke="${_bdEscAttr(color)}" stroke-width="2"/><path d="M8 12.5L11 15.5L16.5 9.5" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>`);
    case 'flag':
      return wrap(`<path d="M6 4V20" stroke="${_bdEscAttr(color)}" stroke-width="2" stroke-linecap="round"/><path d="M7 5H17L14 10L17 15H7Z" fill="${_bdEscAttr(color)}" stroke="${_bdEscAttr(color)}" stroke-width="2" stroke-linejoin="round"/>`);
    case 'star':
      return wrap(`<path d="M12 4L14.5 9.2L20 10L16 14L17.2 19.5L12 16.5L6.8 19.5L8 14L4 10L9.5 9.2Z" fill="${_bdEscAttr(color)}" stroke="${_bdEscAttr(color)}" stroke-width="2" stroke-linejoin="round"/>`);
    case 'lightbulb':
      return wrap(`<path d="M9 17H15" stroke="${_bdEscAttr(color)}" stroke-width="2" stroke-linecap="round"/><path d="M10 20H14" stroke="${_bdEscAttr(color)}" stroke-width="2" stroke-linecap="round"/><path d="M8 10A4 4 0 1 1 16 10C16 11.8 14.8 13 13.8 14.2C13.2 14.9 13 15.4 13 16H11C11 15.4 10.8 14.9 10.2 14.2C9.2 13 8 11.8 8 10Z" fill="${_bdEscAttr(color)}" stroke="${_bdEscAttr(color)}" stroke-width="2" stroke-linejoin="round"/>`);
    case 'alertTriangle':
      return wrap(`<path d="M12 4L20 19H4Z" fill="${_bdEscAttr(color)}" stroke="${_bdEscAttr(color)}" stroke-width="2" stroke-linejoin="round"/><path d="M12 9V13" stroke="#fff" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="16.5" r="1.2" fill="#fff"/>`);
    case 'helpCircle':
      // helpCircle は r=9 で既にエッジ付近のため、scale 1.6 だとクリップが大きくなる。
      // scale 無しで描画し (他マーカーと同等の視覚サイズになる)。
      return `<svg ${box} fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="11" fill="${_bdEscAttr(color)}" stroke="${_bdEscAttr(color)}" stroke-width="2"/><path d="M9.5 9.5A2.7 2.7 0 0 1 12 8C13.6 8 14.8 9 14.8 10.5C14.8 11.5 14.3 12.1 13.4 12.7C12.6 13.2 12.2 13.7 12.2 14.5" stroke="#fff" stroke-width="2" stroke-linecap="round"/><circle cx="12.2" cy="17.3" r="1" fill="#fff"/></svg>`;
    default:
      return typeof lucide === 'function'
        ? lucide(marker?.icon || 'circle', nextSize).replace(/fill="none"/g, `fill="${_bdEscAttr(color)}"`)
        : (typeof lucide === 'function' ? lucide('circleDot', nextSize) : '●');
  }
}

let _bdStylePickerMenu = null;
let _bdStylePickerCloseHandler = null;
let _bdStylePickerAnchor = null;

function bdCloseStylePicker(options) {
  const focusTarget = options?.focusTarget || null;
  _bdStylePickerMenu?.remove();
  _bdStylePickerMenu = null;
  _bdStylePickerAnchor = null;
  if (_bdStylePickerCloseHandler) {
    document.removeEventListener('pointerdown', _bdStylePickerCloseHandler);
    _bdStylePickerCloseHandler = null;
  }
  if (focusTarget && typeof focusMeldexDropdownTrigger === 'function') focusMeldexDropdownTrigger(focusTarget);
}

function _bdStylePickerPreview(kind, style) {
  return _bdStylePickerLargePreviewHtml(kind, style);
}

function _bdToolbarRoot() {
  return (typeof bdGetActiveBoardRoot === 'function' ? bdGetActiveBoardRoot() : null)
    || document.querySelector('.gb-canvas-root')
    || document;
}

function _bdToolbarControl(root, controlName, fallbackId) {
  const scope = root || _bdToolbarRoot();
  return scope?.querySelector?.(`[data-bd-control="${controlName}"]`)
    || scope?.querySelector?.(`[id^="${fallbackId}"]`)
    || document.getElementById(fallbackId)
    || document.querySelector(`[data-bd-control="${controlName}"]`);
}

function bdOpenStylePicker(kind, anchorEl, options) {
  if (!anchorEl) return;
  if (_bdStylePickerMenu) {
    if (_bdStylePickerAnchor === anchorEl) {
      bdCloseStylePicker();
      return;
    }
    bdCloseStylePicker();
  }
  bdEnsureBoardUiState();
  const opts = options || {};
  const styles = kind === 'card' ? bd.cardStyles : bd.lineStyles;
  const activeId = opts.currentId !== undefined ? opts.currentId : (kind === 'card' ? bd.activeCardStyle : bd.activeLineStyle);
  const menu = document.createElement('div');
  menu.className = 'ab-dropdown tool-menu-dropdown bd-style-picker-menu';
  menu.innerHTML = styles.map(style => `
    <button type="button" class="bd-style-picker-item${style.id === activeId ? ' active' : ''}" data-bd-style-pick="${_bdEscAttr(style.id)}">
      <span class="bd-style-picker-preview">${_bdStylePickerPreview(kind, style)}</span>
      <span class="bd-style-picker-label">${esc(style.name)}</span>
    </button>`).join('');
  document.body.appendChild(menu);
  _bdStylePickerMenu = menu;
  _bdStylePickerAnchor = anchorEl;
  const rect = anchorEl.getBoundingClientRect();
  { const z = _getZoom(); menu.style.left = (rect.left / z) + 'px'; menu.style.top = (rect.bottom / z + 4) + 'px'; }
  const box = menu.getBoundingClientRect();
  { const z = _getZoom(); if (box.right > window.innerWidth) menu.style.left = Math.max(4, (window.innerWidth - box.width - 4) / z) + 'px';
  if (box.bottom > window.innerHeight) menu.style.top = Math.max(4, (rect.top - box.height - 4) / z) + 'px'; }
  const getFreshTrigger = () => (typeof opts.refreshAnchor === 'function' ? opts.refreshAnchor() : null) || (anchorEl.isConnected ? anchorEl : null);
  const applyPick = (styleId, closeMenu) => {
    opts.currentId = styleId;
    if (typeof opts.onPick === 'function') opts.onPick(styleId);
    else if (kind === 'card') bd.activeCardStyle = styleId;
    else bd.activeLineStyle = styleId;
    bdRefreshBoardToolbar();
    if (closeMenu) bdCloseStylePicker({ focusTarget: getFreshTrigger });
    if (typeof opts.onAfterPick === 'function') opts.onAfterPick(styleId);
    if (typeof bindMeldexDropdownKeySwitch === 'function') bindStyleKeySwitch(getFreshTrigger());
    if (typeof focusMeldexDropdownTrigger === 'function') focusMeldexDropdownTrigger(getFreshTrigger);
    showStatus(`${kind === 'card' ? 'カード' : 'ライン'}スタイルを選択: ${styles.find(style => style.id === styleId)?.name || ''}`);
  };
  const bindStyleKeySwitch = trigger => {
    if (typeof bindMeldexDropdownKeySwitch !== 'function' || !trigger) return;
    bindMeldexDropdownKeySwitch(trigger, {
      getItems: () => (kind === 'card' ? bd.cardStyles : bd.lineStyles).map(style => ({ value: style.id, style })),
      getCurrentValue: () => opts.currentId || (kind === 'card' ? bd.activeCardStyle : bd.activeLineStyle),
      onSelect: item => applyPick(item.value, false),
      getFreshTrigger,
    });
  };
  bindStyleKeySwitch(anchorEl);
  menu.querySelectorAll('[data-bd-style-pick]').forEach(btn => {
    btn.addEventListener('click', () => applyPick(btn.dataset.bdStylePick || '', true));
  });
  setTimeout(() => {
    _bdStylePickerCloseHandler = event => {
      if (_bdStylePickerMenu && !_bdStylePickerMenu.contains(event.target) && !anchorEl.contains(event.target)) {
        bdCloseStylePicker();
      }
    };
    document.addEventListener('pointerdown', _bdStylePickerCloseHandler);
  }, 0);
}

function bdRefreshBoardToolbar(root) {
  bdEnsureBoardUiState();
  const toolbarRoot = root || _bdToolbarRoot();
  const cardStyle = bdGetCardStyleById(bd.activeCardStyle);
  const lineStyle = bdGetLineStyleById(bd.activeLineStyle);

  const cardPreview = _bdToolbarControl(toolbarRoot, 'card-style-preview', 'bd-card-style-preview');
  if (cardPreview) cardPreview.innerHTML = _bdCardStylePreviewHtml(cardStyle);
  const cardStyleBtn = _bdToolbarControl(toolbarRoot, 'card-style-select', 'bd-card-style-select');
  if (cardStyleBtn) cardStyleBtn.title = `カードスタイル: ${cardStyle?.name || ''}`.trim();
  const linePreview = _bdToolbarControl(toolbarRoot, 'line-style-preview', 'bd-line-style-preview');
  if (linePreview) linePreview.innerHTML = _bdLineStylePreviewHtml(lineStyle);
  const lineStyleBtn = _bdToolbarControl(toolbarRoot, 'line-style-select', 'bd-line-style-select');
  if (lineStyleBtn) lineStyleBtn.title = `ラインスタイル: ${lineStyle?.name || ''}`.trim();

  toolbarRoot.querySelectorAll?.('.bd-tool-btn[data-bd-tool]')?.forEach(btn => {
    btn.classList.toggle('active', bd.tool === btn.dataset.bdTool);
  });

  const onlyOnWhenTrueKeys = ['highlightParentChildGroups'];
  const hiddenCount = Object.entries(bd.displayFilters)
    .filter(([key, value]) => !onlyOnWhenTrueKeys.includes(key) && value === false)
    .length
    + onlyOnWhenTrueKeys.reduce((acc, key) => acc + (bd.displayFilters[key] === true ? 1 : 0), 0);
  const badge = _bdToolbarControl(toolbarRoot, 'filter-badge', 'bd-filter-badge');
  if (badge) {
    badge.style.display = hiddenCount ? '' : 'none';
    badge.textContent = hiddenCount ? String(hiddenCount) : '';
  }

  const canvas = (typeof bdGetBoardElement === 'function')
    ? bdGetBoardElement('canvas', toolbarRoot)
    : document.getElementById('bd-canvas');
  if (canvas) {
    canvas.dataset.bdTool = bd.tool || 'select';
    canvas.classList.toggle('bd-tool-add-card', bd.tool === 'add-card');
    canvas.classList.toggle('bd-tool-add-line', bd.tool === 'add-line');
    canvas.classList.toggle('bd-tool-erase', bd.tool === 'erase');
  }
}

function bdSetTool(tool) {
  bdEnsureBoardUiState();
  bd.tool = bd.tool === tool ? 'select' : tool;
  if (bd.tool !== 'add-line') {
    bd.connecting = null;
    bd._connLabel = '';
    bd._connOrigin = null;
  }
  bdRefreshBoardToolbar();
  if (bd.tool === 'select') showStatus('選択ツール');
  else if (bd.tool === 'add-card') showStatus('カード追加ツール');
  else if (bd.tool === 'add-line') showStatus('ライン追加ツール');
  else if (bd.tool === 'erase') showStatus('消しゴムツール');
}

function _bdUpdateBoardTabMeta(oldPath, newPath, newLabel) {
  if (typeof GBLayout === 'undefined' || typeof GBLayout.getAllPanes !== 'function') return;
  let changed = false;
  GBLayout.getAllPanes(GBLayout.root).forEach(pane => {
    (pane.tabs || []).forEach(tab => {
      if (tab.type !== 'board' || tab.path !== oldPath) return;
      tab.path = newPath;
      tab.label = newLabel;
      tab.state = Object.assign({}, tab.state || {}, { boardPath: newPath, label: newLabel });
      changed = true;
    });
  });
  if (changed) {
    GBLayout.render();
    GBLayout.saveLayout();
  }
}

async function _bdRenameBoardFile(newName) {
  const oldPath = bd.path || (typeof state !== 'undefined' ? state.currentBoardPath : '') || '';
  const nextName = String(newName || '').trim();
  if (!oldPath || !nextName) return false;
  const currentName = (oldPath.split('/').pop() || '').replace(/\.[^.]+$/i, '');
  if (nextName === currentName) return true;
  const res = await apiPost('/outliner/rename', { old_path: oldPath, new_name: nextName, type: 'board' });
  const newPath = String(res?.new_path || '').trim();
  if (!newPath) throw new Error('リネーム結果が不正です');
  if (typeof _renameTreeNode === 'function') _renameTreeNode(oldPath, newPath, nextName, res?.file_id);
  bd.path = newPath;
  if (typeof state !== 'undefined') state.currentBoardPath = newPath;
  const titleEl = _bdToolbarControl(_bdToolbarRoot(), 'title', 'bd-title');
  if (titleEl) titleEl.textContent = nextName;
  if (typeof saveLastView === 'function') saveLastView({ type: 'board', label: nextName, path: newPath });
  _bdUpdateBoardTabMeta(oldPath, newPath, nextName);
  if (typeof handleRelocateResponse === 'function') handleRelocateResponse(res);
  return true;
}

function _bdStartInlineBoardTitleEdit(titleEl) {
  if (!titleEl || titleEl.dataset.bdEditing === '1') return;
  const currentText = titleEl.textContent.trim() || (bd.path ? bd.path.split('/').pop().replace(/\.[^.]+$/i, '') : '無題');
  titleEl.dataset.bdEditing = '1';
  const input = document.createElement('input');
  input.type = 'text';
  input.value = currentText;
  input.className = 'tb-file-title--input';
  input.style.cssText = 'width:100%;box-sizing:border-box;padding:0 var(--ui-space-3);border:1px solid var(--ui-accent);border-radius:var(--ui-radius-xs);background:var(--ui-bg-app);color:inherit;font:inherit;height:var(--ui-h-xs);outline:none;';
  titleEl.textContent = '';
  titleEl.appendChild(input);
  input.focus();
  input.select();
  let finished = false;
  const finish = async (commit) => {
    if (finished) return;
    finished = true;
    titleEl.dataset.bdEditing = '0';
    const draft = input.value.trim();
    titleEl.textContent = currentText;
    if (!commit) return;
    if (!draft) {
      showStatus('ボード名が空です', true);
      return;
    }
    try {
      await _bdRenameBoardFile(draft);
      titleEl.textContent = draft;
      showStatus('ボード名を変更しました');
    } catch (e) {
      titleEl.textContent = currentText;
      showStatus('ボード名の変更に失敗: ' + (e?.message || ''), true);
    }
  };
  input.addEventListener('keydown', event => {
    event.stopPropagation();
    if (event.key === 'Enter') {
      event.preventDefault();
      finish(true);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      finish(false);
    }
  });
  input.addEventListener('blur', () => { finish(true); });
}

function bdInitBoardShell(root) {
  if (!root || root.dataset.bdShellReady === '1') return;
  root.dataset.bdShellReady = '1';
  root.addEventListener('click', event => {
    const btn = event.target.closest('[data-bd-action],[data-bd-tool]');
    if (!btn || !root.contains(btn)) return;
    if (!['pick-card-style', 'pick-line-style'].includes(btn.dataset.bdAction || '')) bdCloseStylePicker();
    if (btn.dataset.bdTool) {
      bdSetTool(btn.dataset.bdTool);
      return;
    }
    switch (btn.dataset.bdAction) {
      case 'zoom-in':
        bdZoom(0.1);
        break;
      case 'zoom-out':
        bdZoom(-0.1);
        break;
      case 'zoom-100':
        bd.zoom = 1;
        bdTransform();
        break;
      case 'fit':
        bdFitAll();
        break;
      case 'zoom-select':
        if (typeof bdShowZoomMenu === 'function') bdShowZoomMenu(btn);
        break;
      case 'reset-rotation':
        bdResetRotation();
        break;
      case 'bg-color':
        if (typeof bdPickBoardBackgroundColor === 'function') {
          bdPickBoardBackgroundColor(btn);
        } else if (typeof openColorPalette === 'function') {
          openColorPalette(btn, bd._bgColor || '', color => {
            bd._bgColor = color || '';
            const canvas = document.getElementById('bd-canvas');
            if (canvas) canvas.style.background = color || 'var(--bg)';
            const swatch = document.getElementById('bd-bg-swatch');
            if (swatch) setColorSwatchValue(swatch, color || '');
            if (typeof bdDirty === 'function') bdDirty();
            if (typeof bdMarkExtrasDirty === 'function') {
              bdMarkExtrasDirty({ minimap: true, boardUi: true }, 'bg-color');
              if (typeof bdScheduleBoardUpdates === 'function') bdScheduleBoardUpdates();
            }
          });
        }
        break;
      case 'manage-card-styles':
        bdOpenCardStyleManager();
        break;
      case 'pick-card-style':
        bdOpenStylePicker('card', btn, {
          currentId: bd.activeCardStyle,
          onPick(styleId) {
            if (typeof bdAreAllCardsSelected === 'function' && bdAreAllCardsSelected()) {
              bdPushUndo();
              _bdAssignCardStyleToNodes([...bd.selected], styleId);
            } else {
              bd.activeCardStyle = styleId || '';
            }
          },
          onAfterPick() {
            bdRender();
            bdDirty();
            if (typeof bdRefreshSelectionDetails === 'function') bdRefreshSelectionDetails(true);
          },
        });
        break;
      case 'manage-line-styles':
        bdOpenLineStyleManager();
        break;
      case 'pick-line-style':
        bdOpenStylePicker('line', btn, {
          currentId: bd.activeLineStyle,
          onPick(styleId) {
            if (typeof bdAreAllLinesSelected === 'function' && bdAreAllLinesSelected()) {
              bdPushUndo();
              _bdAssignLineStyleToConnections(typeof bdGetSelectedConnectionIds === 'function' ? bdGetSelectedConnectionIds() : [], styleId);
            } else {
              bd.activeLineStyle = styleId || '';
            }
          },
          onAfterPick() {
            bdDrawConns();
            bdDirty();
            if (typeof bdRefreshSelectionDetails === 'function') bdRefreshSelectionDetails(true);
          },
        });
        break;
      case 'find-replace':
        if (typeof bdOpenFindBar === 'function') bdOpenFindBar('replace');
        break;
      case 'reload':
        if (typeof reloadCurrentOpenFile === 'function') reloadCurrentOpenFile(event);
        else if (typeof bd !== 'undefined' && bd.path && typeof bdOpenBoard === 'function') bdOpenBoard(bd.label || '', bd.path);
        break;
      case 'detail':
        try {
          const cfg = typeof _getDetailPanelCfg === 'function' ? _getDetailPanelCfg() : {};
          if (cfg.visible !== true) {
            if (typeof toggleOptionPanel === 'function') toggleOptionPanel();
            else if (typeof toggleDetailPanel === 'function') toggleDetailPanel();
          }
        } catch {}
        if (typeof bdRefreshSelectionDetails === 'function') bdRefreshSelectionDetails(true);
        break;
      case 'filters':
        bdOpenFilterMenu(btn);
        break;
    }
  });
  _bdToolbarControl(root, 'zoom-slider', 'bd-zoom-slider')?.addEventListener('input', function onZoomInput() {
    bd.zoom = this.value / 100;
    bdTransform();
  });
  _bdToolbarControl(root, 'rot-slider', 'bd-rot-slider')?.addEventListener('input', function onRotationInput() {
    bd.rotation = +this.value;
    bdTransform();
  });
  const canvasEl = root.querySelector('[data-bd-role="canvas"]');
  const worldEl = root.querySelector('[data-bd-role="world"]') || document.getElementById('bd-world');
  if (typeof bdApplyBoardFileStyleAndTheme === 'function') {
    bdApplyBoardFileStyleAndTheme(canvasEl, worldEl);
  } else if (typeof bdApplyCanvasBackground === 'function') {
    bdApplyCanvasBackground(canvasEl);
  }
  const titleEl = _bdToolbarControl(root, 'title', 'bd-title');
  if (titleEl) {
    titleEl.title = 'ダブルクリックでファイル名を変更';
    titleEl.addEventListener('dblclick', event => {
      event.preventDefault();
      event.stopPropagation();
      _bdStartInlineBoardTitleEdit(titleEl);
    });
  }
  bdRefreshBoardToolbar(root);
}

function _bdColorSwatchStyle(value) {
  const next = String(value || '').trim();
  if (!next) {
    return 'background:linear-gradient(45deg, rgba(148,163,184,0.38) 25%, transparent 25%, transparent 75%, rgba(148,163,184,0.38) 75%),linear-gradient(45deg, rgba(148,163,184,0.38) 25%, transparent 25%, transparent 75%, rgba(148,163,184,0.38) 75%);background-size:8px 8px;background-position:0 0,4px 4px;';
  }
  return `background:${_bdEscAttr(next)};`;
}

function _bdColorFieldHtml(label, field, value, buttonAttr, resetAttr) {
  const nextValue = String(value || '').trim();
  const isTextColor = field === 'textColor';
  const isStrokeColor = field === 'textStrokeColor';
  const iconSvg = isTextColor ? (typeof lucide === 'function' ? lucide('type', 14) : 'T')
    : isStrokeColor ? (typeof lucide === 'function' ? lucide('typeOutline', 14) : 'T')
    : '';
  const gbFmtClass = (isTextColor || isStrokeColor) ? 'gb-fmt-swatch-fg' : 'gb-fmt-swatch-bg';
  const styleStr = (isTextColor || isStrokeColor)
    ? `color:${nextValue || 'var(--fg)'};`
    : _bdColorSwatchStyle(nextValue);
  return `<label class="bd-detail-field"><span>${esc(label)}</span><span class="bd-detail-swatch-row"><button type="button" class="bd-color-swatch gb-fmt-swatch ${gbFmtClass}${nextValue ? ' is-set' : ''}" style="${styleStr}" ${buttonAttr}="${_bdEscAttr(field)}" title="${esc(label)}">${iconSvg}</button><button type="button" class="gb-fmt-reset bd-detail-reset-btn" ${resetAttr}="${_bdEscAttr(field)}" ${nextValue ? '' : 'disabled'}>リセット</button></span></label>`;
}

function _bdRangeFieldHtml(label, field, value, min, max, step, attrName) {
  const attr = attrName || 'data-bd-field';
  const nextValue = Number.isFinite(+value) ? +value : 0;
  return `<label class="bd-detail-field bd-detail-field-range"><span>${esc(label)}</span><span class="bd-detail-range"><input type="range" min="${_bdEscAttr(min)}" max="${_bdEscAttr(max)}" step="${_bdEscAttr(step)}" value="${_bdEscAttr(nextValue)}" ${attr}="${_bdEscAttr(field)}" data-bd-sync-key="${_bdEscAttr(field)}" data-e2e-id="bd-range-${_bdEscAttr(field)}-slider" aria-label="${_bdEscAttr(`${label} スライダー`)}"><input type="number" min="${_bdEscAttr(min)}" max="${_bdEscAttr(max)}" step="${_bdEscAttr(step)}" value="${_bdEscAttr(nextValue)}" ${attr}="${_bdEscAttr(field)}" data-bd-sync-key="${_bdEscAttr(field)}" data-e2e-id="bd-range-${_bdEscAttr(field)}-number" aria-label="${_bdEscAttr(`${label} 数値`)}"></span></label>`;
}

function _bdDetailStyleTriggerHtml(kind, styleId, attrName) {
  const style = kind === 'card' ? bdGetCardStyleById(styleId) : bdGetLineStyleById(styleId);
  // ドロップダウンのアイテムプレビューと同じ HTML を使用（サイズも揃える）
  const preview = _bdStylePickerLargePreviewHtml(kind, style);
  return `<button type="button" class="bd-detail-style-trigger" ${attrName}="${_bdEscAttr(style?.id || '')}"><span class="bd-detail-style-trigger-preview bd-style-picker-preview">${preview}</span><span class="bd-detail-style-trigger-label">${esc(style?.name || '')}</span><span class="bd-style-picker-caret">${lucide('chevronDown', 10)}</span></button>`;
}

function _bdStyleSummaryHtml(kind, style) {
  if (!style) return '';
  if (kind === 'card') {
    return `<div class="bd-style-summary-card">
      <div class="bd-style-summary-grid">
        <div><span>背景</span><span class="bd-inline-swatch gb-color-swatch gb-color-swatch--inline" style="${_bdColorSwatchStyle(style.bgColor || '')}"></span></div>
        <div><span>文字</span><span class="bd-inline-swatch gb-color-swatch gb-color-swatch--inline" style="${_bdColorSwatchStyle(style.textColor || '')}"></span></div>
        <div><span>文字フチ</span><span class="bd-inline-swatch gb-color-swatch gb-color-swatch--inline" style="${_bdColorSwatchStyle(style.textStrokeColor || '')}"></span></div>
        <div><span>枠線</span><span class="bd-inline-swatch gb-color-swatch gb-color-swatch--inline" style="${_bdColorSwatchStyle(style.borderColor || '')}"></span></div>
        <div><span>フチ幅</span><span>${Math.max(0, +style.textStrokeWidth || 0)}px</span></div>
        <div><span>太さ</span><span>${Math.max(0, +style.borderWidth || 0)}px</span></div>
        <div><span>角丸</span><span>${Math.max(0, +style.borderRadius || 0)}px</span></div>
        <div><span>文字</span><span>${Math.max(8, +style.fontSize || 13)}px${style.fontBold ? ' / 太字' : ''}${style.fontItalic ? ' / 斜体' : ''}</span></div>
      </div>
    </div>`;
  }
  return `<div class="bd-style-summary-card">
    <div class="bd-style-summary-grid">
      <div><span>色</span><span class="bd-inline-swatch gb-color-swatch gb-color-swatch--inline" style="${_bdColorSwatchStyle(style.color || '')}"></span></div>
      <div><span>太さ</span><span>${Math.max(0, +style.width || 0)}px</span></div>
      <div><span>ライン種</span><span>${style.style === 'dashed' ? '破線' : '実線'}</span></div>
      <div><span>矢印</span><span>${style.arrow === 'both' ? '双方向' : style.arrow === 'start' ? '逆方向' : style.arrow === 'end' ? '順方向' : 'なし'}</span></div>
      <div><span>形状</span><span>${(style.pathType === 'orthogonal' || style.pathType === 'orthogonal-curve') ? '直角線' : style.pathType === 'straight' ? '直線' : '曲線'}</span></div>
    </div>
  </div>`;
}

function _bdSyncRangeInputs(root, fieldAttr) {
  const attr = fieldAttr || 'data-bd-field';
  root.querySelectorAll(`[${attr}][data-bd-sync-key]`).forEach(input => {
    input.addEventListener('input', () => {
      const field = input.getAttribute(attr);
      const syncKey = input.dataset.bdSyncKey;
      root.querySelectorAll(`[${attr}="${field}"][data-bd-sync-key="${syncKey}"]`).forEach(other => {
        if (other !== input) {
          other.value = input.value;
          globalThis.GBUI?.refreshRangeFill?.(other);
        }
      });
    });
  });
}

function _bdAssignCardStyleToNodes(nodeIds, styleId) {
  const ids = [...new Set((nodeIds || []).filter(Boolean))];
  if (!ids.length) return false;
  ids.forEach(nodeId => {
    const node = bd.nodes.find(item => item.id === nodeId);
    if (!node) return;
    node.cardStyle = styleId || '';
    bdClearCardStyleOverrides(node);
  });
  if (styleId) bd.activeCardStyle = styleId;
  return true;
}

function _bdAssignLineStyleToConnections(connIds, styleId) {
  const ids = [...new Set((connIds || []).filter(Boolean))];
  if (!ids.length) return false;
  ids.forEach(connId => {
    const conn = typeof bdGetConnectionById === 'function' ? bdGetConnectionById(connId) : null;
    if (!conn) return;
    conn.styleRef = styleId || '';
    bdClearConnectionStyleOverrides(conn);
  });
  if (styleId) bd.activeLineStyle = styleId;
  return true;
}

function _bdSelectionSummaryHtml() {
  const nodeCount = bd.selected.size;
  const connIds = typeof bdGetSelectedConnectionIds === 'function' ? bdGetSelectedConnectionIds() : [];
  const connCount = connIds.length;
  if (!nodeCount && !connCount) return '';
  const hintParts = [];
  if (nodeCount) hintParts.push(`${nodeCount} 件のカード`);
  if (connCount) hintParts.push(`${connCount} 本のライン`);
  const cardStyle = bdGetCardStyleById(bd.activeCardStyle);
  const lineStyle = bdGetLineStyleById(bd.activeLineStyle);
  return `
    <div class="bd-detail-panel" data-bd-detail-root="selection">
      <div class="bd-detail-heading">複数選択</div>
      <div class="bd-detail-hint">${hintParts.join(' / ')} が選択されています。</div>
      ${nodeCount ? `<div class="bd-detail-section">
        <div class="bd-detail-section-title">カード一括変更</div>
        <label class="bd-detail-field bd-detail-field-wide"><span>カードスタイル</span>${_bdDetailStyleTriggerHtml('card', bd.activeCardStyle, 'data-bd-selection-card-style-pick')}</label>
        <div class="bd-detail-field bd-detail-field-wide"><span>スタイル</span>${_bdStyleSummaryHtml('card', cardStyle)}</div>
      </div>` : ''}
      ${connCount ? `<div class="bd-detail-section">
        <div class="bd-detail-section-title">ライン一括変更</div>
        <label class="bd-detail-field bd-detail-field-wide"><span>ラインスタイル</span>${_bdDetailStyleTriggerHtml('line', bd.activeLineStyle, 'data-bd-selection-line-style-pick')}</label>
        <div class="bd-style-summary-card"><div class="bd-style-editor-fields bd-style-editor-fields--fmt" data-bd-selection-line-style-fields></div></div>
      </div>` : ''}
    </div>`;
}

const _BD_MARKER_CATEGORY_LABELS = {
  priority: '優先度',
  flag: 'フラグ',
};
function _bdMarkerSelectHtml(node, category, markers) {
  const current = node.markers?.[category];
  const options = [`<option value="">なし</option>`].concat(
    markers.map((marker, index) => `<option value="${index}" ${current === index ? 'selected' : ''}>${esc(marker.label)}</option>`),
  );
  const label = _BD_MARKER_CATEGORY_LABELS[category] || category;
  return `<label class="bd-detail-field"><span>${esc(label)}</span><select data-bd-field="marker:${_bdEscAttr(category)}">${options.join('')}</select></label>`;
}

function _bdNodeCheckboxValue(node) {
  if (node.checked === true) return 'true';
  if (node.checked === false) return 'false';
  return '';
}

function _bdNodeStatusOptions(node) {
  const names = typeof bdStatusNames === 'function' ? bdStatusNames() : [''];
  return names
    .map(status => `<option value="${_bdEscAttr(status)}" ${node.status === status ? 'selected' : ''}>${esc(status || 'なし')}</option>`)
    .join('');
}

function _bdShapeOptions(node) {
  const currentShape = (node && node.id && typeof bdGetNodeStyle === 'function')
    ? (bdGetNodeStyle(node)?.shape || node.shape || 'rect')
    : ((node && node.shape) || 'rect');
  const shapes = (typeof BD_SHAPES !== 'undefined' ? BD_SHAPES : ['rect']).map(shape => ({
    value: shape,
    label: (typeof BD_SHAPE_LABELS !== 'undefined' && BD_SHAPE_LABELS[shape]) || shape,
  }));
  return shapes
    .map(shape => `<option value="${_bdEscAttr(shape.value)}" ${currentShape === shape.value ? 'selected' : ''}>${esc(shape.label)}</option>`)
    .join('');
}

function _bdStructureOptions(node) {
  // 構造 '' (未設定) は「親に従う」= ルートカードに設定された構造を継承する意味。
  // ルートカードで '' のままなら自動レイアウトが掛からない (= 従来の「自由配置」相当)。
  const entries = _bdStructureEntries();
  return entries
    .map(entry => `<option value="${_bdEscAttr(entry.key)}" ${String(node.structure || '') === entry.key ? 'selected' : ''}>${esc(entry.label)}</option>`)
    .join('');
}

function _bdStructureEntries() {
  return [{ key: '', label: '親に従う' }].concat(
    Object.entries(typeof BD_STRUCTURES !== 'undefined' ? BD_STRUCTURES : {}).map(([key, label]) => ({ key, label })),
  );
}

function _bdStructureLabel(node) {
  const current = String(node?.structure || '');
  const entry = _bdStructureEntries().find(item => item.key === current);
  return entry?.label || current || '親に従う';
}

function _bdStructureHintHtml(node) {
  const label = _bdStructureLabel(node);
  const hasOwnStructure = !!String(node?.structure || '');
  const body = hasOwnStructure
    ? `このカード以下のサブツリーに「${esc(label)}」を適用します。親カードの構造には従いません。`
    : '親カードがある場合は親の構造を継承します。親がないカード、または親側にも設定がない場合は自由配置です。';
  return `<div class="bd-detail-hint bd-detail-structure-hint"><div class="bd-detail-hint-current">現在の選択: ${esc(label)}</div><div class="bd-detail-hint-body">${body}</div></div>`;
}

function _bdCardStyleOptions(node) {
  bdEnsureBoardUiState();
  return bd.cardStyles
    .map(style => `<option value="${_bdEscAttr(style.id)}" ${node.cardStyle === style.id ? 'selected' : ''}>${esc(style.name)}</option>`)
    .join('');
}

let _bdLastNodeDetailPanels = null;

// 現在 active な詳細タブを、新しい選択でも引き継げる形に解決する。
// - file-style / backlinks はボード全般で常に利用可能なので、選択タイプに関わらず保持する
// - supportable に含まれるときはそのまま保持
// - 該当しない場合は fallback (既定: file-style = テーマ)
function _bdResolveCurrentBoardTab(supportable, fallback) {
  const cur = (typeof _currentDetailTab !== 'undefined') ? _currentDetailTab : null;
  if (cur === 'file-style' || cur === 'backlinks') return cur;
  if (Array.isArray(supportable) && supportable.includes(cur)) return cur;
  return fallback || 'file-style';
}

function _bdNodePanelHtml(node, title, sections) {
  return `

/* Source chunk: gb-board-ui.part02.js */
    <div class="bd-detail-panel" data-bd-detail-root="node" data-node-id="${_bdEscAttr(node.id)}">
      ${sections.join('')}
    </div>`;
}

function _bdCanRenderDetailPanel() {
  const detailHost = document.getElementById('rp-detail');
  if (detailHost?.closest('.gb-pane-content')) return true;
  return typeof _getDetailPanelCfg === 'function' ? !!_getDetailPanelCfg().visible : false;
}

function _bdCanUseBoardDetailTabs() {
  const detailHost = document.getElementById('rp-detail');
  if (!detailHost?.closest('.gb-pane-content')) return false;
  if (typeof _ensureDetailTabShell === 'function') _ensureDetailTabShell(detailHost);
  return !!detailHost.querySelector('#detail-tab-board-card')
    && typeof setBoardDetailTabContent === 'function'
    && typeof showBoardTabs === 'function'
    && typeof switchDetailTab === 'function';
}

function _bdEnsureBoardFileStyleTab() {
  if (typeof showFileStyleTab === 'function') showFileStyleTab(true);
  if (typeof renderFileStyleTab === 'function') renderFileStyleTab('board');
}

// カード選択時: カードタブに集約した HTML を入れ、カードタブを表示してアクティブに。
// ラインタブは非表示にする (選択中に同時に存在する場合のみライン側が別途上書きする)。
// スタイル管理タブ (カード/ライン/階層別スタイル) はボード表示中は常に出す。
function _bdSetNodeDetailTabs(node, cardHtml, options = {}) {
  if (typeof setBoardDetailTabContent === 'function') {
    setBoardDetailTabContent({ card: cardHtml, line: '' });
  }
  if (typeof showNoteTabs === 'function') showNoteTabs(false);
  if (typeof showDbTabs === 'function') showDbTabs(false);
  if (typeof showBoardTabs === 'function') showBoardTabs({ card: true, line: false, cardStyle: true, lineStyle: true, depthStyle: true });
  _bdEnsureBoardFileStyleTab();
  _bdEnsureBoardStyleManagerTabs();
  // 選択操作時は必ず「カード」タブへ移動する。スタイル編集などの内部再描画では
  // ユーザーが開いている file-style / backlinks / board-note / スタイル管理タブを維持する。
  const nextTab = options.activate === true
    ? 'board-card'
    : (typeof _bdResolveCurrentBoardTab === 'function'
      ? _bdResolveCurrentBoardTab(['board-card', 'board-note', 'board-card-style', 'board-line-style', 'board-depth-style'], 'board-card')
      : 'board-card');
  if (typeof switchDetailTab === 'function') switchDetailTab(nextTab);
}

// ライン選択時: ラインタブに HTML を入れ、ラインタブを表示してアクティブに。
function _bdSetConnDetailTab(connHtml, options = {}) {
  if (typeof setBoardDetailTabContent === 'function') {
    setBoardDetailTabContent({ card: '', line: connHtml });
  }
  if (typeof showNoteTabs === 'function') showNoteTabs(false);
  if (typeof showDbTabs === 'function') showDbTabs(false);
  if (typeof showBoardTabs === 'function') showBoardTabs({ card: false, line: true, cardStyle: true, lineStyle: true, depthStyle: true });
  _bdEnsureBoardFileStyleTab();
  _bdEnsureBoardStyleManagerTabs();
  const nextTab = options.activate === true
    ? 'board-line'
    : (typeof _bdResolveCurrentBoardTab === 'function'
      ? _bdResolveCurrentBoardTab(['board-line', 'board-note', 'board-card-style', 'board-line-style', 'board-depth-style'], 'board-line')
      : 'board-line');
  if (typeof switchDetailTab === 'function') switchDetailTab(nextTab);
}

// 何も選択されていない (ボード全体) 時: カード / ライン タブは非表示、テーマタブをアクティブに。
// スタイル管理タブはボード表示中は常に出す。
function _bdSetBoardPrimaryTab() {
  if (typeof setBoardDetailTabContent === 'function') {
    setBoardDetailTabContent({ card: '', line: '' });
  }
  if (typeof showNoteTabs === 'function') showNoteTabs(false);
  if (typeof showDbTabs === 'function') showDbTabs(false);
  if (typeof showBoardTabs === 'function') showBoardTabs({ card: false, line: false, cardStyle: true, lineStyle: true, depthStyle: true });
  _bdEnsureBoardFileStyleTab();
  _bdEnsureBoardStyleManagerTabs();
  // デフォルトはテーマタブ。ユーザーが backlinks / board-note / スタイル管理タブを選んでいた場合は尊重。
  const nextTab = typeof _bdResolveCurrentBoardTab === 'function'
    ? _bdResolveCurrentBoardTab(['board-note', 'board-card-style', 'board-line-style', 'board-depth-style'], 'file-style')
    : 'file-style';
  if (typeof switchDetailTab === 'function') switchDetailTab(nextTab);
}

// 3つのスタイル管理タブ (カードスタイル / ラインスタイル / 階層別スタイル) のコンテンツを
// 初期化 / 再描画する。各タブは一度レンダー済みなら以後のイベント反映で済むため毎回は再描画しない。
function _bdEnsureBoardStyleManagerTabs() {
  const renderers = [
    { id: 'detail-tab-board-card-style', kind: 'card' },
    { id: 'detail-tab-board-line-style', kind: 'line' },
    { id: 'detail-tab-board-depth-style', kind: 'depth' },
  ];
  renderers.forEach(entry => {
    const el = document.getElementById(entry.id);
    if (!el) return;
    // 既にレンダー済みなら skip (子要素が存在する)
    if (el.childElementCount > 0) return;
    if (entry.kind === 'depth') {
      if (typeof _bdRenderDepthStyleInPanel === 'function') _bdRenderDepthStyleInPanel(el);
    } else {
      if (typeof _bdRenderStyleManagerInPanel === 'function') _bdRenderStyleManagerInPanel(entry.kind, el, null);
    }
  });
}

function _bdRenderBoardPrimaryDetail() {
  if (_bdCanUseBoardDetailTabs()) {
    _bdSetBoardPrimaryTab();
    return;
  }
  // タブ機能が無い古い環境: テーマ表示のみ (ボード全体設定 UI は廃止)
  if (typeof showDetailPanel === 'function') showDetailPanel('');
}

function _bdRenderNodeDetailPanels(node, panels, options = {}) {
  const cardHtml = (panels && panels.contentHtml) || '';
  if (_bdCanUseBoardDetailTabs()) {
    _bdSetNodeDetailTabs(node, cardHtml, options);
    return;
  }
  if (typeof showDetailPanel === 'function') showDetailPanel(cardHtml);
}

function _bdBuildNodeDetailHtml(node) {
  const style = bdGetNodeStyle(node);
  const markerHtml = typeof BD_MARKERS === 'undefined'
    ? ''
    : Object.entries(BD_MARKERS).map(([category, markers]) => _bdMarkerSelectHtml(node, category, markers)).join('');
  const parent = node.parent ? (bd.nodes.find(item => item.id === node.parent)?.text?.split('\n')[0] || node.parent) : 'なし';
  const opacityPct = node.opacity != null ? Math.round(Math.max(0, Math.min(1, node.opacity)) * 100) : 100;
  const title = (node.text || '').split('\n')[0] || '無題カード';
  const plusIcon = typeof lucide === 'function' ? lucide('plus', 14) : '+';
  const saveIcon = typeof lucide === 'function' ? lucide('save', 14) : '保存';
  const resetIcon = typeof lucide === 'function' ? lucide('rotateCcw', 14) : 'リセット';
  const exportIcon = typeof lucide === 'function' ? lucide('upload', 14) : '出力';
  const paletteIcon = typeof lucide === 'function' ? lucide('palette', 14) : '色';
  // カードタブ集約版: 旧「基本/配置/拡張」を 1 タブ内のセクションにまとめる。
  const contentHtml = _bdNodePanelHtml(node, title, [`
      <div class="bd-detail-section">
        <div class="bd-detail-section-title">基本</div>
        <label class="bd-detail-field bd-detail-field-wide"><span>テキスト</span><textarea data-bd-field="text">${esc(node.text || '')}</textarea></label>
        <label class="bd-detail-field bd-detail-field-wide"><span>リンク先</span><input type="text" value="${_bdEscAttr(node.link || '')}" data-bd-field="link"></label>
        ${node.img ? `<label class="bd-detail-field bd-detail-field-wide"><span>画像</span><input type="text" value="${_bdEscAttr(node.img || '')}" data-bd-field="img"></label>` : ''}
      </div>
      <div class="bd-detail-section">
        <div class="bd-detail-section-title">カードスタイル</div>
        <div class="bd-detail-style-row">
          ${_bdDetailStyleTriggerHtml('card', node.cardStyle || bd.activeCardStyle, 'data-bd-node-style-pick')}
          <button type="button" class="bd-detail-style-action" data-bd-action="save-node-card-style-as-new" title="現在の設定を新しいスタイルとして保存">${plusIcon}</button>
          <button type="button" class="bd-detail-style-action" data-bd-action="save-node-card-style" title="選択中スタイルをデフォルトとして保存">${saveIcon}</button>
          <button type="button" class="bd-detail-style-action" data-bd-action="reset-node-card-style" title="スタイルをデフォルトに戻す">${resetIcon}</button>
        </div>
        <div class="bd-style-summary-card"><div class="bd-style-editor-fields bd-style-editor-fields--fmt" data-bd-node-card-style-fields></div></div>
      </div>
      <div class="bd-detail-section">
        <div class="bd-detail-section-title">表示</div>
        <label class="bd-detail-check"><input type="checkbox" data-bd-field="minimized" ${node.minimized ? 'checked' : ''}><span>最小化</span></label>
        <label class="bd-detail-check"><input type="checkbox" data-bd-field="collapsed" ${node.collapsed ? 'checked' : ''}><span>折りたたみ</span></label>
        <label class="bd-detail-check"><input type="checkbox" data-bd-field="locked" ${node.locked ? 'checked' : ''}><span>ロック</span></label>
        <div class="bd-detail-inline-actions">
          <button type="button" class="gb-btn gb-btn-sm" data-bd-action="manage-card-styles">スタイル管理</button>
          ${node.link ? '<button type="button" class="gb-btn gb-btn-sm" data-bd-action="open-link">リンク先を開く</button>' : ''}
        </div>
      </div>
      <div class="bd-detail-section">
        <div class="bd-detail-section-title">カードサイズ</div>
        <label class="bd-detail-field"><span>幅</span><input type="number" class="gb-fmt-num" min="40" value="${Math.round(node.w || style.width || 160)}" data-bd-field="w"></label>
        <label class="bd-detail-field"><span>高さ</span><input type="number" class="gb-fmt-num" min="0" value="${Math.round(node.h || 0)}" data-bd-field="h"></label>
      </div>
      <div class="bd-detail-section">
        <div class="bd-detail-section-title">配置</div>
        <label class="bd-detail-field"><span>X</span><input type="number" class="gb-fmt-num" value="${Math.round(node.x || 0)}" data-bd-field="x"></label>
        <label class="bd-detail-field"><span>Y</span><input type="number" class="gb-fmt-num" value="${Math.round(node.y || 0)}" data-bd-field="y"></label>
        <label class="bd-detail-field"><span>親カード</span><input type="text" value="${_bdEscAttr(parent)}" readonly data-e2e-id="bd-node-parent-label"></label>
        <label class="bd-detail-check"><input type="checkbox" data-bd-field="container" ${node.container ? 'checked' : ''}><span>コンテナ</span></label>
        <label class="bd-detail-check"><input type="checkbox" data-bd-field="_followChildren" ${node._followChildren ? 'checked' : ''}><span>子カード追従</span></label>
        <label class="bd-detail-check"><input type="checkbox" data-bd-field="_autoStyle" ${node._autoStyle ? 'checked' : ''}><span>階層別スタイル</span></label>
        <div class="bd-detail-inline-actions">
          <button type="button" class="gb-btn gb-btn-sm" data-bd-action="manage-depth-styles">階層別スタイルを管理</button>
        </div>
      </div>
      <div class="bd-detail-section">
        <div class="bd-detail-section-title">構造</div>
        <label class="bd-detail-field bd-detail-field-wide"><span>構造</span><select data-bd-field="structure">${_bdStructureOptions(node)}</select></label>
        ${_bdStructureHintHtml(node)}
      </div>
      <div class="bd-detail-section">
        <div class="bd-detail-section-title">変形</div>
        <div class="bd-detail-transform-fields">
          ${_bdRangeFieldHtml('回転', 'rotate', node.rotate || 0, -360, 360, 1)}
          ${_bdRangeFieldHtml('不透明度', 'opacityPct', opacityPct, 0, 100, 1)}
          <div class="bd-detail-transform-checks">
            <label class="bd-detail-check"><input type="checkbox" data-bd-field="flipH" ${node.flipH ? 'checked' : ''}><span>左右反転</span></label>
            <label class="bd-detail-check"><input type="checkbox" data-bd-field="flipV" ${node.flipV ? 'checked' : ''}><span>上下反転</span></label>
          </div>
        </div>
      </div>
      <div class="bd-detail-section">
        <div class="bd-detail-section-title">拡張</div>
        <label class="bd-detail-field"><span>ステータス</span><select data-bd-field="status">${_bdNodeStatusOptions(node)}</select></label>
        ${markerHtml}
        <div class="bd-detail-inline-actions">
          <button type="button" class="gb-btn gb-btn-sm" data-bd-action="manage-statuses">ステータスを管理</button>
        </div>
      </div>`]);
  _bdLastNodeDetailPanels = { nodeId: node.id, contentHtml };
  return contentHtml;
}

function bdClearConnectionStyleOverrides(conn) {
  [
    'color', 'width', 'style', 'arrow', 'straight', 'pathType',
    'branchRatio', 'cornerRadius',
    'labelTextColor', 'labelBgColor', 'labelBorderColor', 'labelBorderWidth',
    'fontBold', 'fontItalic',
    'textVisible', 'textAlongPath', 'textAutoFlip', 'textShadowWidth', 'textShadowColor',
  ].forEach(key => delete conn[key]);
}

function _bdBuildConnectionDetailHtml(conn) {
  const plusIcon = typeof lucide === 'function' ? lucide('plus', 14) : '+';
  const saveIcon = typeof lucide === 'function' ? lucide('save', 14) : '保存';
  const resetIcon = typeof lucide === 'function' ? lucide('rotateCcw', 14) : 'リセット';
  return `
    <div class="bd-detail-panel" data-bd-detail-root="connection" data-conn-id="${_bdEscAttr(conn.id)}">
      <div class="bd-detail-section">
        <div class="bd-detail-section-title">テキスト</div>
        <label class="bd-detail-field bd-detail-field-wide"><span>テキスト</span><textarea data-bd-conn-field="label">${esc(conn.label || '')}</textarea></label>
      </div>
      <div class="bd-detail-section">
        <div class="bd-detail-section-title">ラインスタイル</div>
        <div class="bd-detail-style-row">
          ${_bdDetailStyleTriggerHtml('line', conn.styleRef || bd.activeLineStyle, 'data-bd-conn-style-pick')}
          <button type="button" class="bd-detail-style-action" data-bd-action="save-conn-line-style-as-new" title="現在の設定を新しいスタイルとして保存">${plusIcon}</button>
          <button type="button" class="bd-detail-style-action" data-bd-action="save-conn-line-style" title="選択中スタイルをデフォルトとして保存">${saveIcon}</button>
          <button type="button" class="bd-detail-style-action" data-bd-action="reset-conn-line-style" title="スタイルをデフォルトに戻す">${resetIcon}</button>
        </div>
        <div class="bd-style-summary-card"><div class="bd-style-editor-fields bd-style-editor-fields--fmt" data-bd-conn-line-style-fields></div></div>
        <div class="bd-detail-inline-actions">
          <button type="button" class="gb-btn gb-btn-sm" data-bd-action="manage-line-styles">スタイル管理</button>
        </div>
      </div>
    </div>`;
}

function _bdBuildBoardDetailHtml() {
  // cardStyle/lineStyle は HTML 内で直接使われない（_bdDetailStyleTriggerHtml が
  // ID から再取得する）。bdGet*StyleById の副作用（bdEnsureBoardUiState 連鎖）を
  // 避けるため呼ばない。
  const plusIcon = typeof lucide === 'function' ? lucide('plus', 14) : '+';
  const saveIcon = typeof lucide === 'function' ? lucide('save', 14) : '保存';
  const resetIcon = typeof lucide === 'function' ? lucide('rotateCcw', 14) : 'リセット';
  return `
    <div class="bd-detail-panel" data-bd-detail-root="board">
      <div class="bd-detail-heading">ボード</div>
      <div class="bd-detail-section">
        <div class="bd-detail-section-title">カードスタイル</div>
        <div class="bd-detail-style-row">
          ${_bdDetailStyleTriggerHtml('card', bd.activeCardStyle, 'data-bd-board-card-style-pick')}
          <button type="button" class="bd-detail-style-action" data-bd-action="save-card-style-as-new" title="現在の設定を新しいスタイルとして保存">${plusIcon}</button>
          <button type="button" class="bd-detail-style-action" data-bd-action="save-card-style" title="選択中スタイルをデフォルトとして保存">${saveIcon}</button>
          <button type="button" class="bd-detail-style-action" data-bd-action="reset-card-style" title="スタイルをデフォルトに戻す">${resetIcon}</button>
        </div>
        <div class="bd-style-summary-card"><div class="bd-style-editor-fields bd-style-editor-fields--fmt" data-bd-board-card-style-fields></div></div>
      </div>
      <div class="bd-detail-section">
        <div class="bd-detail-section-title">ラインスタイル</div>
        <div class="bd-detail-style-row">
          ${_bdDetailStyleTriggerHtml('line', bd.activeLineStyle, 'data-bd-board-line-style-pick')}
          <button type="button" class="bd-detail-style-action" data-bd-action="save-line-style-as-new" title="現在の設定を新しいスタイルとして保存">${plusIcon}</button>
          <button type="button" class="bd-detail-style-action" data-bd-action="save-line-style" title="選択中スタイルをデフォルトとして保存">${saveIcon}</button>
          <button type="button" class="bd-detail-style-action" data-bd-action="reset-line-style" title="スタイルをデフォルトに戻す">${resetIcon}</button>
        </div>
        <div class="bd-style-summary-card"><div class="bd-style-editor-fields bd-style-editor-fields--fmt" data-bd-board-line-style-fields></div></div>
      </div>
      <div class="bd-detail-section">
        <div class="bd-detail-section-title">階層別スタイル</div>
        <div class="bd-detail-style-row">
          ${_bdDepthStyleTriggerHtml('data-bd-board-depth-style-pick')}
          <button type="button" class="bd-detail-style-action" data-bd-action="apply-depth-theme-colors" title="テーマカラーを階層別スタイルに適用">${paletteIcon}</button>
          <button type="button" class="bd-detail-style-action" data-bd-action="save-depth-styles" title="階層別スタイル一式を全ボード共通のデフォルトとして保存">${saveIcon}</button>
          <button type="button" class="bd-detail-style-action" data-bd-action="reset-depth-styles" title="保存したデフォルトに戻す (未保存ならビルトイン初期値)">${resetIcon}</button>
        </div>
      </div>
      <div class="bd-detail-section">
        <div class="bd-detail-inline-actions">
          <button type="button" class="gb-btn gb-btn-sm" data-bd-action="manage-card-styles">カードスタイル管理</button>
          <button type="button" class="gb-btn gb-btn-sm" data-bd-action="manage-line-styles">ラインスタイル管理</button>
          <button type="button" class="gb-btn gb-btn-sm" data-bd-action="export-board-styles">${exportIcon} スタイル一式を書き出し</button>
          <button type="button" class="gb-btn gb-btn-sm" data-bd-action="manage-statuses">ステータスを管理</button>
          <button type="button" class="gb-btn gb-btn-sm" data-bd-action="manage-depth-styles">階層別スタイルを管理</button>
        </div>
      </div>
    </div>`;
}

function _bdDepthStyleTriggerHtml(pickAttr) {
  const styles = typeof bdEnsureDepthStyles === 'function' ? bdEnsureDepthStyles() : (bd?.depthStyles || []);
  const count = Array.isArray(styles) ? styles.length : 0;
  return `<select class="gb-select bd-detail-style-trigger" ${pickAttr || ''} title="編集する階層を選択">
    ${styles.map((style, idx) => {
      const label = typeof bdDepthStyleDisplayName === 'function' ? bdDepthStyleDisplayName(style, idx, count) : `階層 ${idx + 1}`;
      return `<option value="${idx}">${esc(label)}${style?.defaultText ? ` (${esc(style.defaultText)})` : ''}</option>`;
    }).join('')}
    ${count === 0 ? '<option value="">(未設定)</option>' : ''}
  </select>`;
}

function _bdBindSelectionDetailPanel() {
  const roots = [...document.querySelectorAll('[data-bd-detail-root="selection"]')];
  if (!roots.length) return;
  const nodeIds = [...bd.selected];
  const connIds = typeof bdGetSelectedConnectionIds === 'function' ? bdGetSelectedConnectionIds() : [];
  roots.forEach(root => {
    root.querySelector('[data-bd-selection-card-style-pick]')?.addEventListener('click', event => {
      bdOpenStylePicker('card', event.currentTarget, {
        currentId: bd.activeCardStyle,
        onPick(styleId) {
          if (!nodeIds.length) {
            bd.activeCardStyle = styleId || '';
            return;
          }
          bdPushUndo();
          _bdAssignCardStyleToNodes(nodeIds, styleId);
        },
        onAfterPick() {
          bdRender();
          bdDirty();
          if (typeof bdRefreshSelectionDetails === 'function') bdRefreshSelectionDetails(true);
        },
      });
    });
    root.querySelector('[data-bd-selection-line-style-pick]')?.addEventListener('click', event => {
      bdOpenStylePicker('line', event.currentTarget, {
        currentId: bd.activeLineStyle,
        onPick(styleId) {
          if (!connIds.length) {
            bd.activeLineStyle = styleId || '';
            return;
          }
          bdPushUndo();
          _bdAssignLineStyleToConnections(connIds, styleId);
        },
        onAfterPick() {
          bdDrawConns();
          bdDirty();
          if (typeof bdRefreshSelectionDetails === 'function') bdRefreshSelectionDetails(true);
        },
      });
    });
    // 複数選択ラインの一括フィールド編集。代表ラインの effective スタイルを初期値として表示し、
    // 変更は選択中の全ラインに対して個別 override として書き込む。
    const lineFieldsEl = root.querySelector('[data-bd-selection-line-style-fields]');
    if (lineFieldsEl && connIds.length) {
      bdEnsureBoardUiState();
      const firstConn = typeof bdGetConnectionById === 'function' ? bdGetConnectionById(connIds[0]) : null;
      const wantId = firstConn ? (firstConn.styleRef || bd.activeLineStyle) : bd.activeLineStyle;
      const baseLineStyle = wantId ? (bd.lineStyles.find(s => s.id === wantId) || bd.lineStyles[0] || null) : (bd.lineStyles[0] || null);
      if (firstConn && baseLineStyle) {
        const eff = typeof bdGetConnectionStyle === 'function' ? bdGetConnectionStyle(firstConn) : {};
        const displayStyle = { ...baseLineStyle };
        ['color', 'width', 'style', 'arrow', 'pathType',
         'branchRatio', 'cornerRadius',
         'labelTextColor', 'labelBgColor', 'labelBorderColor', 'labelBorderWidth',
         'fontBold', 'fontItalic',
         'textVisible', 'textAlongPath', 'textAutoFlip', 'textShadowWidth', 'textShadowColor']
          .forEach(key => { if (eff[key] !== undefined) displayStyle[key] = eff[key]; });
        const rerender = () => {
          bdDrawConns();
          bdDirty();
          if (typeof bdRefreshSelectionDetails === 'function') bdRefreshSelectionDetails(true);
        };
        _bdBuildStyleFields(lineFieldsEl, 'line', displayStyle, rerender, {
          editTargets: () => connIds
            .map(id => (typeof bdGetConnectionById === 'function' ? bdGetConnectionById(id) : null))
            .filter(Boolean),
          nameEditTarget: () => null, // 複数選択時は名前編集を無効化
          hideFontFamily: true,
        });
      }
    }
  });
}

function _bdUpdateNodeFromField(node, field, value) {
  switch (field) {
    case 'text':
      node.text = value || '';
      break;
    case 'link':
    case 'img':
    case 'status':
      if (value) node[field] = value;
      else delete node[field];
      break;
    case 'bgColor':
    case 'textColor':
    case 'textStrokeColor':
    case 'borderColor':
      if (value) node[field] = value;
      else delete node[field];
      break;
    case 'fontBold':
    case 'fontItalic':
    case 'collapsed':
    case 'minimized':
    case 'locked':
    case 'container':
    case '_followChildren':
    case '_autoStyle':
    case 'flipH':
    case 'flipV':
      node[field] = !!value;
      break;
    case 'cardStyle':
      node.cardStyle = value || '';
      bdClearCardStyleOverrides(node);
      break;
    case 'checked':
      if (value === '') delete node.checked;
      else node.checked = value === 'true';
      break;
    case 'shape':
      if (!value || value === 'rect') delete node.shape;
      else node.shape = value;
      break;
    case 'structure':
      if (value) node.structure = value;
      else delete node.structure;
      break;
    case 'progress': {
      const pct = Math.max(0, Math.min(100, parseInt(value, 10) || 0));
      if (pct) node.progress = pct;
      else delete node.progress;
      break;
    }
    case 'opacityPct': {
      const pct = Math.max(0, Math.min(100, parseInt(value, 10) || 0));
      if (pct >= 100) delete node.opacity;
      else node.opacity = +(pct / 100).toFixed(2);
      break;
    }
    case 'rotate': {
      const num = parseInt(value, 10);
      if (!Number.isFinite(num) || num === 0) delete node.rotate;
      else node.rotate = Math.max(-360, Math.min(360, num));
      break;
    }
    case 'borderWidth':
    case 'borderRadius':
    case 'fontSize':
    case 'textStrokeWidth':
    case 'x':
    case 'y':
    case 'w':
    case 'h': {
      const num = parseInt(value, 10);
      if (!Number.isFinite(num)) break;
      if (field === 'w') node[field] = Math.max(40, num);
      else if (field === 'fontSize') node[field] = Math.max(8, num);
      else if (field === 'textStrokeWidth') node[field] = Math.max(0, Math.min(12, num));
      else if (field === 'x' || field === 'y') node[field] = num;
      else node[field] = Math.max(0, num);
      break;
    }
    case 'note':
      if (value) node.note = value;
      else delete node.note;
      break;
    default:
      if (field.startsWith('marker:')) {
        const category = field.split(':')[1];
        if (!node.markers) node.markers = {};
        if (value === '') delete node.markers[category];
        else node.markers[category] = parseInt(value, 10);
        if (Object.keys(node.markers).length === 0) delete node.markers;
      }
      break;
  }
}

function _bdUpdateConnectionFromField(conn, field, value) {
  switch (field) {
    case 'label':
      if (String(value || '').trim()) conn.label = String(value).trim();
      else delete conn.label;
      break;
    case 'color':
      if (value) conn.color = value;
      else delete conn.color;
      break;
    case 'width': {
      const num = parseInt(value, 10);
      if (!Number.isFinite(num) || num <= 0) delete conn.width;
      else conn.width = Math.max(1, num);
      break;
    }
    case 'styleRef':
      conn.styleRef = value || '';
      break;
    case 'style':
      if (value === 'dashed') conn.style = 'dashed';
      else delete conn.style;
      break;
    case 'arrow':
      conn.arrow = value || '';
      break;
    case 'pathType':
      // v0.5.320: 3 種に統合。旧 free-bezier → curve、旧 orthogonal-curve → orthogonal。
      conn.pathType = value === 'free-bezier' ? 'curve'
        : value === 'orthogonal-curve' ? 'orthogonal'
        : value === 'orthogonal' ? 'orthogonal'
        : value === 'straight' ? 'straight' : 'curve';
      delete conn.straight;
      break;
    case 'branchRatio': {
      const num = parseFloat(value);
      if (Number.isFinite(num)) conn.branchRatio = Math.max(0.05, Math.min(0.95, num));
      else delete conn.branchRatio;
      break;
    }
    case 'cornerRadius': {
      const num = parseFloat(value);
      if (Number.isFinite(num)) conn.cornerRadius = Math.max(0, Math.min(40, num));
      else delete conn.cornerRadius;
      break;
    }
    case 'straight':
      conn.pathType = value === true || value === 'true' ? 'straight' : 'curve';
      delete conn.straight;
      break;
    case 'hidden':
      if (value) conn.hidden = true;
      else delete conn.hidden;
      break;
    default:
      break;
  }
}

async function _bdOpenLinkedTarget(node, e) {
  if (!node?.link) return;
  const path = String(node.link);
  const label = node.text || path.split('/').pop();
  if (typeof bdOpenLinkedPath === 'function') {
    bdOpenLinkedPath(path, label, { ctrlKey: e?.ctrlKey, linkType: node.linkType });
    return;
  }
  if (typeof openPage === 'function') openPage(label, path);
  else if (typeof openNative === 'function') openNative(path);
}

function _bdBindNodeDetailPanel(nodeId) {
  const roots = [...document.querySelectorAll('[data-bd-detail-root="node"]')].filter(root => root.dataset.nodeId === nodeId);
  if (!roots.length) return;
  roots.forEach(root => _bdSyncRangeInputs(root, 'data-bd-field'));
  const applyField = (field, value) => {
    const node = bd.nodes.find(item => item.id === nodeId);
    if (!node) return;
    bdPushUndo();
    _bdUpdateNodeFromField(node, field, value);
    if (field === 'structure' && typeof bdAutoLayout === 'function') {
      // 構造設定: 新しい構造 (非空) ならこのカードをサブルートに再レイアウト。
      // 「親に従う」(空) に戻した場合は、親から再レイアウトが必要なのでルートで実行。
      const targetId = node.structure ? node.id : (typeof bdRoot === 'function' ? bdRoot(node.id)?.id : node.id);
      if (targetId) bdAutoLayout(targetId);
    }
    bdRender();
    bdDirty();
    if (field === 'link' && value) bdShowLinkedSelectionPreview(value);
  };
  roots.forEach(root => {
    root.querySelectorAll('[data-bd-field]').forEach(input => {
      input.addEventListener('change', () => {
        const value = input.type === 'checkbox' ? input.checked : input.value;
        applyField(input.dataset.bdField, value);
      });
    });
    root.querySelectorAll('[data-bd-color-field]').forEach(btn => {
      btn.addEventListener('click', () => {
        const field = btn.dataset.bdColorField;
        const node = bd.nodes.find(item => item.id === nodeId);
        if (!node || typeof openColorPalette !== 'function') return;
        openColorPalette(btn, node[field] || '', color => {
          applyField(field, color || '');
        });
      });
    });
    root.querySelectorAll('[data-bd-reset-field]').forEach(btn => {
      btn.addEventListener('click', () => {
        applyField(btn.dataset.bdResetField, '');
      });
    });
  });
  const node = bd.nodes.find(item => item.id === nodeId);
  const rerenderNodeDetail = () => {
    bdDirty();
    bdRender();
    bdRefreshBoardToolbar();
    if (typeof bdRefreshSelectionDetails === 'function') bdRefreshSelectionDetails(true);
  };
  const styleTrigger = roots.map(root => root.querySelector('[data-bd-node-style-pick]')).find(Boolean);
  styleTrigger?.addEventListener('click', event => {
    const target = bd.nodes.find(item => item.id === nodeId);
    if (!target) return;
    bdOpenStylePicker('card', event.currentTarget, {
      currentId: target.cardStyle || bd.activeCardStyle,
      onPick(styleId) {
        bdPushUndo();
        target.cardStyle = styleId || '';
        bdClearCardStyleOverrides(target);
      },
      onAfterPick() {
        rerenderNodeDetail();
      },
    });
  });
  roots.forEach(root => {
    const cardFieldsEl = root.querySelector('[data-bd-node-card-style-fields]');
    if (cardFieldsEl && node) {
      bdEnsureBoardUiState();
      const wantId = node.cardStyle || bd.activeCardStyle;
      const baseCardStyle = bd.cardStyles.find(s => s.id === wantId) || bd.cardStyles[0] || null;
      if (baseCardStyle) {
        // widget は effective style（base + node の個別 override）を表示する。
        const eff = typeof bdGetNodeStyle === 'function' ? bdGetNodeStyle(node) : {};
        const displayStyle = { ...baseCardStyle };
        ['bgColor', 'textColor', 'borderColor', 'borderWidth', 'borderRadius', 'fontSize',
         'fontBold', 'fontItalic', 'textStrokeColor', 'textStrokeWidth', 'shape', 'width',
         'cloudBumpWidth', 'cloudBumpHeight', 'cloudSideWidth', 'cloudOffset',
         'cloudSubWidthRatio', 'cloudSubHeightRatio']
          .forEach(key => {
            if (eff[key] !== undefined) displayStyle[key] = eff[key];
          });
        // v0.5.251: 詳細パネルの編集は「共通スタイル」ではなく「カード個別のオーバーライド」に書き込む。
        // 同じスタイルを使う他のカードには影響しない。
        // 「選択中スタイルをデフォルトとして保存」(save-node-card-style) でカードのオーバーライドを共通スタイルに
        // 伝播する。
        _bdBuildStyleFields(cardFieldsEl, 'card', displayStyle, rerenderNodeDetail, {
          beforeEdit: () => node,
          nameEditTarget: () => bd.cardStyles.find(s => s.id === wantId) || bd.cardStyles[0] || null,
          // 既存カード選択時は「標準幅」(新規カードの初期幅) は無関係なので非表示
          hideDefaultWidth: true,
          hideFontFamily: true,
        });
      }
    }
    root.querySelector('[data-bd-action="save-node-card-style-as-new"]')?.addEventListener('click', () => {
      const target = bd.nodes.find(item => item.id === nodeId);
      if (target) _bdSaveNodeCardStyleAsNew(target);
    });
    root.querySelector('[data-bd-action="save-node-card-style"]')?.addEventListener('click', () => {
      const target = bd.nodes.find(item => item.id === nodeId);
      if (target) _bdSaveCurrentNodeCardStyle(target);
    });
    root.querySelector('[data-bd-action="reset-node-card-style"]')?.addEventListener('click', () => {
      const target = bd.nodes.find(item => item.id === nodeId);
      if (!target) return;
      const wantId = target.cardStyle || bd.activeCardStyle;
      const style = bd.cardStyles.find(s => s.id === wantId) || bd.cardStyles[0] || null;
      if (!style) return;
      // v0.5.251: 詳細パネルのリセットは「このカードの個別オーバーライドをクリア」= 共通スタイルの
      // 見た目に戻すという意味。共通スタイル自体は変更しない (他のカードに影響しないように)。
      bdPushUndo();
      if (typeof bdClearCardStyleOverrides === 'function') bdClearCardStyleOverrides(target);
      rerenderNodeDetail();
      showStatus(`カードスタイル「${style.name}」の個別設定をクリアしました`);
    });
    root.querySelector('[data-bd-action="manage-card-styles"]')?.addEventListener('click', () => {
      bdOpenCardStyleManager();
    });
    root.querySelector('[data-bd-action="reset-style"]')?.addEventListener('click', () => {
      const target = bd.nodes.find(item => item.id === nodeId);
      if (!target) return;
      bdPushUndo();
      bdClearCardStyleOverrides(target);
      bdRender();
      bdDirty();
    });
    root.querySelector('[data-bd-action="open-link"]')?.addEventListener('click', (e) => {
      const target = bd.nodes.find(item => item.id === nodeId);
      _bdOpenLinkedTarget(target, e);
    });
    root.querySelector('[data-bd-action="manage-statuses"]')?.addEventListener('click', () => {
      if (typeof bdManageStatuses === 'function') bdManageStatuses();
    });
    root.querySelector('[data-bd-action="manage-depth-styles"]')?.addEventListener('click', () => {
      if (typeof bdOpenDepthStyleManager === 'function') bdOpenDepthStyleManager();
    });
  });
}

function _bdBindConnectionDetailPanel(connId) {
  const roots = [...document.querySelectorAll('[data-bd-detail-root="connection"]')].filter(root => root.dataset.connId === connId);
  if (!roots.length) return;
  const applyField = (field, value) => {
    const conn = typeof bdGetConnectionById === 'function' ? bdGetConnectionById(connId) : null;
    if (!conn) return;
    bdPushUndo();
    _bdUpdateConnectionFromField(conn, field, value);
    bdDrawConns();
    bdDirty();
    if (typeof bdRefreshSelectionDetails === 'function') bdRefreshSelectionDetails(true);
  };
  roots.forEach(root => {
    root.querySelectorAll('[data-bd-conn-field]').forEach(input => {
      input.addEventListener('change', () => {
        const value = input.type === 'checkbox' ? input.checked : input.value;
        applyField(input.dataset.bdConnField, value);
      });
    });
    root.querySelectorAll('[data-bd-conn-color-field]').forEach(btn => {
      btn.addEventListener('click', () => {
        const field = btn.dataset.bdConnColorField;
        const conn = typeof bdGetConnectionById === 'function' ? bdGetConnectionById(connId) : null;
        if (!conn || typeof openColorPalette !== 'function') return;
        openColorPalette(btn, conn[field] || '', color => {
          applyField(field, color || '');
        });
      });
    });
    root.querySelectorAll('[data-bd-conn-reset-field]').forEach(btn => {
      btn.addEventListener('click', () => {
        applyField(btn.dataset.bdConnResetField, '');
      });
    });
    const rerenderConnDetail = () => {
      bdDirty();
      bdDrawConns();
      bdRefreshBoardToolbar();
      if (typeof bdRefreshSelectionDetails === 'function') bdRefreshSelectionDetails(true);
    };
    root.querySelector('[data-bd-conn-style-pick]')?.addEventListener('click', event => {
      const trigger = event.currentTarget;
      const conn = typeof bdGetConnectionById === 'function' ? bdGetConnectionById(connId) : null;
      if (!conn) return;
      bdOpenStylePicker('line', trigger, {
        currentId: conn.styleRef || bd.activeLineStyle,
        onPick(styleId) {
          bdPushUndo();
          conn.styleRef = styleId || '';
          bdClearConnectionStyleOverrides(conn);
        },
        onAfterPick() {
          rerenderConnDetail();
        },
      });
    });
    const lineFieldsEl = root.querySelector('[data-bd-conn-line-style-fields]');
    if (lineFieldsEl) {
      const conn = typeof bdGetConnectionById === 'function' ? bdGetConnectionById(connId) : null;
      bdEnsureBoardUiState();
      const wantId = conn ? (conn.styleRef || bd.activeLineStyle) : null;
      const baseLineStyle = wantId ? (bd.lineStyles.find(s => s.id === wantId) || bd.lineStyles[0] || null) : null;
      if (conn && baseLineStyle) {
        // widget は effective style（base + conn の個別 override）を表示する
        const eff = typeof bdGetConnectionStyle === 'function' ? bdGetConnectionStyle(conn) : {};
        const displayStyle = { ...baseLineStyle };
        ['color', 'width', 'style', 'arrow', 'pathType',
         'branchRatio', 'cornerRadius',
         'labelTextColor', 'labelBgColor', 'labelBorderColor', 'labelBorderWidth',
         'fontBold', 'fontItalic',
         'textVisible', 'textAlongPath', 'textAutoFlip', 'textShadowWidth', 'textShadowColor']
          .forEach(key => {
            if (eff[key] !== undefined) displayStyle[key] = eff[key];
          });
        // v0.5.251: 詳細パネルの編集は「共通スタイル」ではなく「ライン個別のオーバーライド」に書き込む。
        // 同じスタイルを使う他のラインには影響しない。
        // 「選択中スタイルをデフォルトとして保存」(save-conn-line-style) でラインのオーバーライドを共通スタイルに
        // 伝播する。
        _bdBuildStyleFields(lineFieldsEl, 'line', displayStyle, rerenderConnDetail, {
          beforeEdit: () => conn,
          nameEditTarget: () => bd.lineStyles.find(s => s.id === wantId) || bd.lineStyles[0] || null,
          hideFontFamily: true,
        });
      }
    }
    root.querySelector('[data-bd-action="save-conn-line-style-as-new"]')?.addEventListener('click', () => {
      const conn = typeof bdGetConnectionById === 'function' ? bdGetConnectionById(connId) : null;
      if (conn) _bdSaveConnectionLineStyleAsNew(conn);
    });
    root.querySelector('[data-bd-action="save-conn-line-style"]')?.addEventListener('click', () => {
      const conn = typeof bdGetConnectionById === 'function' ? bdGetConnectionById(connId) : null;
      if (conn) _bdSaveCurrentConnectionLineStyle(conn);
    });
    root.querySelector('[data-bd-action="reset-conn-line-style"]')?.addEventListener('click', () => {
      const conn = typeof bdGetConnectionById === 'function' ? bdGetConnectionById(connId) : null;
      if (!conn) return;
      const wantId = conn.styleRef || bd.activeLineStyle;
      const style = bd.lineStyles.find(s => s.id === wantId) || bd.lineStyles[0] || null;
      if (!style) return;
      // v0.5.251: 詳細パネルのリセットは「このラインの個別オーバーライドをクリア」= 共通スタイルの
      // 見た目に戻すという意味。共通スタイル自体は変更しない。
      bdPushUndo();
      if (typeof bdClearConnectionStyleOverrides === 'function') bdClearConnectionStyleOverrides(conn);
      rerenderConnDetail();
      showStatus(`ラインスタイル「${style.name}」の個別設定をクリアしました`);
    });
    root.querySelector('[data-bd-action="manage-line-styles"]')?.addEventListener('click', () => {
      bdOpenLineStyleManager();
    });
  });
}

function _bdBindBoardDetailPanel() {
  const roots = [...document.querySelectorAll('[data-bd-detail-root="board"]')];
  if (!roots.length) return;
  // 注意: bdGetCardStyleById/bdGetLineStyleById は内部で bdEnsureBoardUiState を呼んで
  // bd.cardStyles/bd.lineStyles を新配列に置換する。両方を別々に呼ぶと cardStyle 取得後に
  // bd.cardStyles が再生成され、cardStyle 参照が「古い配列内のオブジェクト」になり、
  // 編集が bd.cardStyles に反映されない。bdEnsureBoardUiState を1回だけ呼んで直接 find する。
  bdEnsureBoardUiState();
  const cardStyle = bd.cardStyles.find(s => s.id === bd.activeCardStyle) || bd.cardStyles[0] || null;
  const lineStyle = bd.lineStyles.find(s => s.id === bd.activeLineStyle) || bd.lineStyles[0] || null;
  const rerenderBoardDetail = () => {
    bdDirty();
    bdRender();
    bdRefreshBoardToolbar();
    if (typeof bdRefreshSelectionDetails === 'function') bdRefreshSelectionDetails(true);
  };
  roots.forEach(root => {
    root.querySelectorAll('[data-bd-board-color-field]').forEach(btn => {
      btn.addEventListener('click', () => {
        if (typeof bdPickBoardBackgroundColor === 'function') bdPickBoardBackgroundColor(btn);
        else if (typeof openColorPalette === 'function') {
          const current = bd._bgColor || '';
          openColorPalette(btn, current, color => {
            bd._bgColor = color || '';
            const canvas = document.getElementById('bd-canvas');
            const swatch = document.getElementById('bd-bg-swatch');
            if (canvas) canvas.style.background = bd._bgColor || 'var(--bg)';
            if (swatch) setColorSwatchValue(swatch, bd._bgColor || '');
            bdDirty();
            if (typeof bdRefreshSelectionDetails === 'function') bdRefreshSelectionDetails(true);
            if (typeof bdMarkExtrasDirty === 'function') {
              bdMarkExtrasDirty({ minimap: true, boardUi: true }, 'bg-color');
              if (typeof bdScheduleBoardUpdates === 'function') bdScheduleBoardUpdates();
            }
          });
        }
      });
    });
    root.querySelectorAll('[data-bd-board-reset-field]').forEach(btn => {
      btn.addEventListener('click', () => {
        if (typeof bdSetBoardBackgroundColor === 'function') bdSetBoardBackgroundColor('');
        else {
          bd._bgColor = '';
          const canvas = document.getElementById('bd-canvas');
          const swatch = document.getElementById('bd-bg-swatch');
          if (canvas) canvas.style.background = 'var(--bg)';
          if (swatch) setColorSwatchValue(swatch, '');
          bdDirty();
          if (typeof bdRefreshSelectionDetails === 'function') bdRefreshSelectionDetails(true);
          if (typeof bdMarkExtrasDirty === 'function') {
            bdMarkExtrasDirty({ minimap: true, boardUi: true }, 'bg-reset');
            if (typeof bdScheduleBoardUpdates === 'function') bdScheduleBoardUpdates();
          }
        }
      });
    });
    root.querySelector('[data-bd-action="set-bg-image"]')?.addEventListener('click', () => {
      if (typeof bdChooseBoardBackgroundImage === 'function') bdChooseBoardBackgroundImage();
    });
    root.querySelector('[data-bd-action="clear-bg-image"]')?.addEventListener('click', () => {
      if (typeof bdClearBoardBackgroundImage === 'function') bdClearBoardBackgroundImage();
    });
    root.querySelector('[data-bd-board-bg-fit]')?.addEventListener('change', event => {
      if (typeof bdSetBoardBackgroundImageFit === 'function') bdSetBoardBackgroundImageFit(event.currentTarget.value);
    });
    root.querySelector('[data-bd-board-card-style-pick]')?.addEventListener('click', event => {
      bdOpenStylePicker('card', event.currentTarget, {
        currentId: bd.activeCardStyle,
        onPick(styleId) { bd.activeCardStyle = styleId || ''; },
        onAfterPick() { rerenderBoardDetail(); },
      });
    });
    root.querySelector('[data-bd-board-line-style-pick]')?.addEventListener('click', event => {
      bdOpenStylePicker('line', event.currentTarget, {
        currentId: bd.activeLineStyle,
        onPick(styleId) { bd.activeLineStyle = styleId || ''; },
        onAfterPick() { rerenderBoardDetail(); },
      });
    });
    const cardFieldsEl = root.querySelector('[data-bd-board-card-style-fields]');
    if (cardFieldsEl) {
      const targetCard = cardStyle || bd.cardStyles[0] || null;
      if (targetCard) {
        // bdEnsureBoardUiState が bd.cardStyles を都度新オブジェクトに差し替えるため、
        // バインド時の参照は古くなる。beforeEdit で常に現在の参照を取り直す。
        _bdBuildStyleFields(cardFieldsEl, 'card', targetCard, rerenderBoardDetail, {
          beforeEdit: () => bd.cardStyles.find(s => s.id === bd.activeCardStyle) || bd.cardStyles[0] || null,
        });
      } else { cardFieldsEl.textContent = 'カードスタイル未設定'; console.warn('[board detail] no card style available'); }
    }
    const lineFieldsEl = root.querySelector('[data-bd-board-line-style-fields]');
    if (lineFieldsEl) {
      const targetLine = lineStyle || bd.lineStyles[0] || null;
      if (targetLine) {
        _bdBuildStyleFields(lineFieldsEl, 'line', targetLine, rerenderBoardDetail, {
          beforeEdit: () => bd.lineStyles.find(s => s.id === bd.activeLineStyle) || bd.lineStyles[0] || null,
        });
      } else { lineFieldsEl.textContent = 'ラインスタイル未設定'; console.warn('[board detail] no line style available'); }
    }
    root.querySelector('[data-bd-action="save-card-style-as-new"]')?.addEventListener('click', () => _bdSaveBoardStyleAsNew('card'));
    root.querySelector('[data-bd-action="save-line-style-as-new"]')?.addEventListener('click', () => _bdSaveBoardStyleAsNew('line'));
    root.querySelector('[data-bd-action="save-card-style"]')?.addEventListener('click', () => _bdSaveCurrentBoardStyle('card'));
    root.querySelector('[data-bd-action="save-line-style"]')?.addEventListener('click', () => _bdSaveCurrentBoardStyle('line'));
    root.querySelector('[data-bd-action="reset-card-style"]')?.addEventListener('click', () => {
      const style = bd.cardStyles.find(s => s.id === bd.activeCardStyle) || bd.cardStyles[0] || null;
      if (!style) return;
      bdPushUndo();
      _bdResetStyleToDefault('card', style);
      rerenderBoardDetail();
      showStatus(`カードスタイル「${style.name}」をデフォルトに戻しました`);
    });
    root.querySelector('[data-bd-action="reset-line-style"]')?.addEventListener('click', () => {
      const style = bd.lineStyles.find(s => s.id === bd.activeLineStyle) || bd.lineStyles[0] || null;
      if (!style) return;
      bdPushUndo();
      _bdResetStyleToDefault('line', style);
      rerenderBoardDetail();
      showStatus(`ラインスタイル「${style.name}」をデフォルトに戻しました`);
    });
    root.querySelector('[data-bd-action="manage-card-styles"]')?.addEventListener('click', () => bdOpenCardStyleManager());
    root.querySelector('[data-bd-action="manage-line-styles"]')?.addEventListener('click', () => bdOpenLineStyleManager());
    root.querySelector('[data-bd-action="export-board-styles"]')?.addEventListener('click', () => {
      if (typeof bdExportBoardStylePack === 'function') bdExportBoardStylePack();
      else if (typeof showStatus === 'function') showStatus('ボードスタイル書き出し機能を初期化できませんでした', true);
    });
    root.querySelector('[data-bd-action="manage-statuses"]')?.addEventListener('click', () => {
      if (typeof bdManageStatuses === 'function') bdManageStatuses();
    });
    root.querySelector('[data-bd-action="manage-depth-styles"]')?.addEventListener('click', () => {
      if (typeof bdOpenDepthStyleManager === 'function') bdOpenDepthStyleManager();
    });
    root.querySelector('[data-bd-action="apply-depth-theme-colors"]')?.addEventListener('click', () => {
      if (typeof bdApplyThemeColorsToDepthStyles !== 'function') return;
      if (typeof bdPushUndo === 'function') bdPushUndo();
      bdApplyThemeColorsToDepthStyles({ applyLineColor: true });
      if (typeof bdApplyAutoStyle === 'function') bd.nodes.filter(node => node._autoStyle).forEach(node => bdApplyAutoStyle(node.id));
      if (typeof bdRender === 'function') bdRender();
      bdDirty();
      if (typeof bdRefreshSelectionDetails === 'function') bdRefreshSelectionDetails(true);
      showStatus('テーマカラーを階層別スタイルに適用しました');
    });
    // 階層別スタイル: 選択した階層を管理ダイアログで開く
    root.querySelector('[data-bd-board-depth-style-pick]')?.addEventListener('change', event => {
      const idx = parseInt(event.target.value, 10);
      if (Number.isFinite(idx)) window._bdPendingDepthStyleIndex = idx;
      if (typeof bdOpenDepthStyleManager === 'function') bdOpenDepthStyleManager();
    });
    // 階層別スタイル: デフォルトとして保存
    root.querySelector('[data-bd-action="save-depth-styles"]')?.addEventListener('click', () => {
      if (typeof bdEnsureDepthStyles === 'function') bdEnsureDepthStyles();
      const snapshot = typeof bdNormalizeDepthStyles === 'function'
        ? bdNormalizeDepthStyles(bd.depthStyles || [])
        : (bd.depthStyles || []).slice();
      if (typeof bdPushUndo === 'function') bdPushUndo();
      if (typeof _bdSaveGlobalDepthStyles === 'function') _bdSaveGlobalDepthStyles(snapshot);
      showStatus('階層別スタイルをデフォルトとして保存しました', false, { showSaveDialog: true });
    });
    // 階層別スタイル: デフォルトに戻す
    root.querySelector('[data-bd-action="reset-depth-styles"]')?.addEventListener('click', () => {
      if (typeof bdPushUndo === 'function') bdPushUndo();
      const global = typeof _bdReadGlobalDepthStyles === 'function' ? _bdReadGlobalDepthStyles() : null;
      const globalIsLegacy = typeof _bdIsLegacyDefaultDepthStyles === 'function' && _bdIsLegacyDefaultDepthStyles(global);
      if (Array.isArray(global) && global.length && !globalIsLegacy) {
        bd.depthStyles = typeof bdNormalizeDepthStyles === 'function' ? bdNormalizeDepthStyles(global) : global.slice();
        showStatus('保存したデフォルトに戻しました');
      } else {
        bd.depthStyles = typeof bdNormalizeDepthStyles === 'function' ? bdNormalizeDepthStyles([]) : [];
        showStatus('デフォルトは未保存のため、ビルトイン初期値に戻しました');
      }
      if (typeof bdRender === 'function') bdRender();
      bdDirty();
      if (typeof bdRefreshSelectionDetails === 'function') bdRefreshSelectionDetails(true);
    });
  });
}

function bdRefreshSelectionDetails(forceEmpty) {
  if (typeof bd === 'undefined') return;
  if (!document.getElementById('bd-canvas') && !bd.path && !bd.nodes.length && !bd.connections.length) return;
  if (typeof bdEnsureBoardUiState === 'function') bdEnsureBoardUiState();
  if (!_bdCanRenderDetailPanel()) return;
  const selectedConnIds = typeof bdGetSelectedConnectionIds === 'function' ? bdGetSelectedConnectionIds() : [];
  const activateSelectionTab = forceEmpty !== true;
  if (bd.selected.size === 0 && selectedConnIds.length === 0 && !forceEmpty) {
    // 選択が空白クリック等で解除された場合: カード/ライン タブは非表示、
    // テーマタブをアクティブ (ユーザーが明示的に開いている board-note / backlinks は尊重)。
    if (typeof clearBoardDetailTabContent === 'function') clearBoardDetailTabContent();
    _bdRenderBoardPrimaryDetail();
    return;
  }
  // タブ表示は維持し、コンテンツだけクリアする。作業パネル再アクティブ時に
  // スタイル/拡張タブが基本へ戻ってしまうのを防ぐため。
  if (typeof clearBoardDetailTabContent === 'function') clearBoardDetailTabContent();
  else if (typeof clearBoardDetailTabs === 'function') clearBoardDetailTabs();
  if (bd.selected.size > 1 || selectedConnIds.length > 1 || (bd.selected.size && selectedConnIds.length)) {
    // 複数選択: 概要 HTML はカード側が選択を含むときはカードタブに、
    // ラインのみの複数選択ならラインタブに表示する。
    const html = _bdSelectionSummaryHtml();
    if (bd.selected.size >= 1) {
      if (_bdCanUseBoardDetailTabs()) _bdSetNodeDetailTabs(null, html, { activate: activateSelectionTab });
      else if (typeof showDetailPanel === 'function') showDetailPanel(html);
    } else {
      if (_bdCanUseBoardDetailTabs()) _bdSetConnDetailTab(html, { activate: activateSelectionTab });
      else if (typeof showDetailPanel === 'function') showDetailPanel(html);
    }
    _bdBindSelectionDetailPanel();
    return;
  }
  if (selectedConnIds.length === 1) {
    const conn = typeof bdGetConnectionById === 'function' ? bdGetConnectionById(selectedConnIds[0]) : null;
    if (!conn) {
      if (typeof bdClearConnectionSelection === 'function') bdClearConnectionSelection();
      if (!forceEmpty) return;
      _bdRenderBoardPrimaryDetail();
      return;
    }
    const html = _bdBuildConnectionDetailHtml(conn);
    if (_bdCanUseBoardDetailTabs()) _bdSetConnDetailTab(html, { activate: activateSelectionTab });
    else if (typeof showDetailPanel === 'function') showDetailPanel(html);
    _bdBindConnectionDetailPanel(conn.id);
    return;
  }
  if (bd.selected.size === 0) {
    if (!forceEmpty) return;
    _bdRenderBoardPrimaryDetail();
    return;
  }
  const nodeId = [...bd.selected][0];
  const node = bd.nodes.find(item => item.id === nodeId);
  if (!node) return;
  _bdBuildNodeDetailHtml(node);
  const panels = _bdLastNodeDetailPanels && _bdLastNodeDetailPanels.nodeId === node.id
    ? _bdLastNodeDetailPanels
    : { nodeId: node.id, contentHtml: '' };
  _bdRenderNodeDetailPanels(node, panels, { activate: activateSelectionTab });
  _bdBindNodeDetailPanel(node.id);
}

function bdSyncBoardUi(forceEmptyDetail) {
  const started = typeof bdPerfStart === 'function' ? bdPerfStart('bdSyncBoardUi') : 0;
  bdRefreshBoardToolbar();
  bdRefreshSelectionDetails(forceEmptyDetail);
  if (typeof bdPerfEnd === 'function') bdPerfEnd('bdSyncBoardUi', started);
}

/* スタイルマネージャ / フィルタメニューは gb-board-style-manager.js に分離 */
