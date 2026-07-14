/* gb-board-style-manager.part01.js: split from gb-board-style-manager.js */
/* gb-board-style-manager.js: board style managers and filter popup */

// ============================================================
// グローバルスタイルデフォルト (全ボード共通)
// ============================================================
// 「デフォルトとして保存」を押すと、per-board の style._default に加えて
// localStorage にも記録し、新しいボードを開いたときに自動マージされる。
const BD_GLOBAL_CARD_STYLE_DEFAULTS_KEY = 'meldex-bd-global-card-style-defaults';
const BD_GLOBAL_LINE_STYLE_DEFAULTS_KEY = 'meldex-bd-global-line-style-defaults';
const BD_GLOBAL_DEPTH_STYLES_KEY        = 'meldex-bd-global-depth-styles';

function bdCaptureGlobalStyleDefaults() {
  const read = key => {
    try { return localStorage.getItem(key); }
    catch { return null; }
  };
  return {
    card: read(BD_GLOBAL_CARD_STYLE_DEFAULTS_KEY),
    line: read(BD_GLOBAL_LINE_STYLE_DEFAULTS_KEY),
    depth: read(BD_GLOBAL_DEPTH_STYLES_KEY),
  };
}

function bdRestoreGlobalStyleDefaults(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return false;
  const pairs = [
    [BD_GLOBAL_CARD_STYLE_DEFAULTS_KEY, snapshot.card],
    [BD_GLOBAL_LINE_STYLE_DEFAULTS_KEY, snapshot.line],
    [BD_GLOBAL_DEPTH_STYLES_KEY, snapshot.depth],
  ];
  pairs.forEach(([key, value]) => {
    try {
      if (value === null || value === undefined) localStorage.removeItem(key);
      else localStorage.setItem(key, String(value));
    } catch {}
  });
  return true;
}

function _bdGlobalStyleDefaultsKey(kind) {
  return kind === 'card' ? BD_GLOBAL_CARD_STYLE_DEFAULTS_KEY
       : kind === 'line' ? BD_GLOBAL_LINE_STYLE_DEFAULTS_KEY
       : '';
}

// { styleId: styleSnapshot (without id/_default), ... }
function _bdReadGlobalStyleDefaults(kind) {
  const key = _bdGlobalStyleDefaultsKey(kind);
  if (!key) return {};
  try {
    const raw = JSON.parse(localStorage.getItem(key) || 'null');
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  } catch {
    return {};
  }
}

function _bdWriteGlobalStyleDefaults(kind, map) {
  const key = _bdGlobalStyleDefaultsKey(kind);
  if (!key) return;
  try {
    if (map && Object.keys(map).length) localStorage.setItem(key, JSON.stringify(map));
    else localStorage.removeItem(key);
  } catch {}
}

function _bdSaveGlobalStyleDefault(kind, style) {
  if (!style || !style.id) return;
  const map = _bdReadGlobalStyleDefaults(kind);
  const snap = _bdCloneStyleForDefault(style);
  if (!snap) return;
  // 名前も保存して、新規ボードで ID 一致時に name を揃えられるようにする
  map[style.id] = { ...snap, name: style.name || '' };
  _bdWriteGlobalStyleDefaults(kind, map);
}

function _bdRemoveGlobalStyleDefault(kind, styleId) {
  if (!styleId) return;
  const map = _bdReadGlobalStyleDefaults(kind);
  if (Object.prototype.hasOwnProperty.call(map, styleId)) {
    delete map[styleId];
    _bdWriteGlobalStyleDefaults(kind, map);
  }
}

function _bdReadGlobalDepthStyles() {
  try {
    const raw = JSON.parse(localStorage.getItem(BD_GLOBAL_DEPTH_STYLES_KEY) || 'null');
    return Array.isArray(raw) ? raw : null;
  } catch {
    return null;
  }
}

function _bdSaveGlobalDepthStyles(styles) {
  try {
    if (Array.isArray(styles) && styles.length) {
      localStorage.setItem(BD_GLOBAL_DEPTH_STYLES_KEY, JSON.stringify(styles));
    } else {
      localStorage.removeItem(BD_GLOBAL_DEPTH_STYLES_KEY);
    }
  } catch {}
}

function _bdBoardStylePackExportPayload() {
  if (typeof bdEnsureBoardUiState === 'function') bdEnsureBoardUiState();
  if (typeof bdEnsureDepthStyles === 'function') bdEnsureDepthStyles();
  const cardStyles = typeof _bdDisplayedManagedStyles === 'function'
    ? _bdDisplayedManagedStyles('card')
    : (bd.cardStyles || []);
  const lineStyles = typeof _bdDisplayedManagedStyles === 'function'
    ? _bdDisplayedManagedStyles('line')
    : (bd.lineStyles || []);
  const depthStyles = typeof bdNormalizeDepthStyles === 'function'
    ? bdNormalizeDepthStyles(bd.depthStyles || [])
    : (bd.depthStyles || []);
  return {
    type: 'meldex-board-style-pack',
    version: 1,
    exportedAt: new Date().toISOString(),
    sourceBoard: bd.path || '',
    stylePresetVersion: typeof BD_STYLE_PRESET_VERSION !== 'undefined' ? BD_STYLE_PRESET_VERSION : 0,
    activeCardStyle: bd.activeCardStyle || '',
    activeLineStyle: bd.activeLineStyle || '',
    cardStyles: _bdClone(cardStyles || []),
    lineStyles: _bdClone(lineStyles || []),
    depthStyles: _bdClone(depthStyles || []),
  };
}

async function bdExportBoardStylePack() {
  if (typeof MeldexExportSave === 'undefined' || typeof MeldexExportSave.saveText !== 'function') {
    if (typeof showStatus === 'function') showStatus('保存ダイアログを初期化できませんでした', true);
    return false;
  }
  const payload = _bdBoardStylePackExportPayload();
  const rawName = typeof MeldexExportSave.guessNameFromPath === 'function'
    ? MeldexExportSave.guessNameFromPath(bd.path || '', 'board')
    : 'board';
  const stem = String(rawName || 'board').replace(/(?:\.board)?\.md$/i, '') || 'board';
  const safeStem = typeof MeldexExportSave.sanitizeTitle === 'function'
    ? MeldexExportSave.sanitizeTitle(stem, 'board')
    : stem.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
  return MeldexExportSave.saveText(JSON.stringify(payload, null, 2), {
    dialogTitle: 'ボードスタイルを書き出し',
    initialfile: `${safeStem}-board-styles.json`,
    extension: '.json',
    filetypes: [['JSON', '*.json'], ['すべてのファイル', '*.*']],
    okMessage: 'ボードスタイルを書き出しました',
    errorMessage: 'ボードスタイルの書き出しに失敗しました',
  });
}

// v0.5.320: pathType を 3 種 (curve/straight/orthogonal) に正規化するヘルパー。
// 旧 free-bezier → curve、旧 orthogonal-curve → orthogonal。
function _bdNormalizePathType(value, fallback) {
  if (value === 'free-bezier') return 'curve';
  if (value === 'orthogonal-curve') return 'orthogonal';
  if (value === 'orthogonal' || value === 'straight' || value === 'curve') return value;
  if (fallback === 'free-bezier') return 'curve';
  if (fallback === 'orthogonal-curve') return 'orthogonal';
  if (['orthogonal', 'straight', 'curve'].includes(fallback)) return fallback;
  return 'curve';
}

const BD_STYLE_FONTMAP_ID = 'bd-style-fontmap';
let _bdStyleFontMapRaf = 0;

function _bdFontFamilyOptions() {
  if (typeof getFontFamilyOptionItems === 'function') return getFontFamilyOptionItems();
  return [{ v: '', l: '共通フォント', style: 'font-family:inherit;' }];
}

function _bdNormalizeFontFamily(value) {
  if (typeof normalizeFontFamilyValue === 'function') return normalizeFontFamilyValue(value);
  const raw = String(value == null ? '' : value).trim();
  if (!raw || ['inherit', 'initial', 'unset', 'revert', 'revert-layer'].includes(raw.toLowerCase())) return '';
  return raw;
}

function _bdCssAttr(value) {
  return String(value == null ? '' : value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function _bdAppendFontRule(rules, selector, value) {
  const fontFamily = _bdNormalizeFontFamily(value);
  if (!fontFamily) return;
  rules.push(`${selector}{--bd-style-font-family:${fontFamily};}`);
}

function bdUpdateStyleFontMap() {
  if (typeof document === 'undefined' || typeof bd === 'undefined') return;
  let styleEl = document.getElementById(BD_STYLE_FONTMAP_ID);
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = BD_STYLE_FONTMAP_ID;
    document.head.appendChild(styleEl);
  }
  const worldSelector = '[data-bd-role="world"]';
  const rules = [];
  (bd.cardStyles || []).forEach(style => {
    const id = style?.id || '';
    if (!id) return;
    _bdAppendFontRule(rules, `${worldSelector} [data-style-id="${_bdCssAttr(id)}"]`, style.fontFamily);
  });
  (bd.lineStyles || []).forEach(style => {
    const id = style?.id || '';
    if (!id) return;
    _bdAppendFontRule(rules, `${worldSelector} [data-line-style-id="${_bdCssAttr(id)}"]`, style.fontFamily);
  });
  (bd.depthStyles || []).forEach((style, index) => {
    _bdAppendFontRule(rules, `${worldSelector} [data-depth-style-index="${index}"]`, style?.fontFamily);
    _bdAppendFontRule(rules, `${worldSelector} [data-depth-line-style-index="${index}"]`, style?.line?.fontFamily);
  });
  styleEl.textContent = rules.join('\n');
}

function bdScheduleFontStyleMapUpdate() {
  if (typeof requestAnimationFrame !== 'function') {
    bdUpdateStyleFontMap();
    return;
  }
  if (_bdStyleFontMapRaf) cancelAnimationFrame(_bdStyleFontMapRaf);
  _bdStyleFontMapRaf = requestAnimationFrame(() => {
    _bdStyleFontMapRaf = 0;
    bdUpdateStyleFontMap();
  });
}

function _bdApplyStyleFieldChange(kind, style, field, value) {
  if (!style) return;
  const markNodeOverride = () => {
    if (typeof bd === 'undefined' || !Array.isArray(bd.nodes) || !bd.nodes.includes(style)) return;
    if (field === 'width') style._userW = true;
    else if (field === 'bgColor') style._userBgColor = true;
    else if (field === 'fontSize') style._userFontSize = true;
    else if (field === 'fontBold') style._userFontBold = true;
  };
  if (field === 'fontFamily') {
    style.fontFamily = _bdNormalizeFontFamily(value);
    return;
  }
  if (kind === 'card') {
    if (['borderWidth', 'borderRadius', 'fontSize', 'width', 'textStrokeWidth'].includes(field)) {
      const num = parseInt(value, 10) || 0;
      if (field === 'width') style[field] = Math.max(40, num);
      else if (field === 'fontSize') style[field] = Math.max(8, num);
      else if (field === 'textStrokeWidth') style[field] = Math.max(0, Math.min(12, num));
      else style[field] = Math.max(0, num);
      markNodeOverride();
      return;
    }
    if (['cloudBumpWidth', 'cloudBumpHeight', 'cloudSideWidth'].includes(field)) {
      const num = parseInt(value, 10) || 0;
      if (field === 'cloudBumpWidth') style[field] = Math.max(8, Math.min(200, num));
      else if (field === 'cloudBumpHeight') style[field] = Math.max(2, Math.min(100, num));
      else style[field] = Math.max(2, Math.min(100, num));
      return;
    }
    if (field === 'cloudOffset') {
      // UI は 0〜100 (%) で渡されるので 0〜1 に正規化
      const num = parseInt(value, 10);
      const pct = Number.isFinite(num) ? Math.max(0, Math.min(100, num)) : 50;
      style[field] = pct / 100;
      return;
    }
    if (field === 'cloudSubWidthRatio' || field === 'cloudSubHeightRatio') {
      // 0〜100 (%) の整数で保存。両方が > 0 のときだけ小山が現れる。
      const num = parseInt(value, 10);
      style[field] = Number.isFinite(num) ? Math.max(0, Math.min(100, num)) : 0;
      return;
    }
    if (field === 'shape') {
      // v0.5.251: 'rect' を空文字列 ('') に変換すると、bdToMd の `if (n.shape)` 真偽値
      // チェックで override が永続化されない (保存/再読込で消える)。'rect' をそのまま
      // 格納し、レンダリング側は「どの if 分岐にもマッチしない」デフォルト = rect 扱いする。
      style[field] = value;
      markNodeOverride();
      return;
    }
    style[field] = value;
    markNodeOverride();
    return;
  }
  if (field === 'width') {
    style.width = Math.max(0, parseInt(value, 10) || 0);
  } else if (field === 'pathType') {
    // v0.5.320: 3 種に統合。旧 free-bezier → curve、旧 orthogonal-curve → orthogonal。
    if (value === 'free-bezier') style.pathType = 'curve';
    else if (value === 'orthogonal-curve') style.pathType = 'orthogonal';
    else if (value === 'orthogonal') style.pathType = 'orthogonal';
    else if (value === 'straight') style.pathType = 'straight';
    else style.pathType = 'curve';
    delete style.straight;
  } else if (field === 'branchRatio') {
    const num = parseFloat(value);
    if (Number.isFinite(num)) style.branchRatio = Math.max(0.05, Math.min(0.95, num));
    else delete style.branchRatio;
  } else if (field === 'cornerRadius') {
    const num = parseFloat(value);
    if (Number.isFinite(num)) style.cornerRadius = Math.max(0, Math.min(40, num));
    else delete style.cornerRadius;
  } else if (field === 'straight') {
    style.pathType = value === true || value === 'true' ? 'straight' : 'curve';
    delete style.straight;
  } else if (field === 'textVisible' || field === 'textAlongPath' || field === 'textAutoFlip') {
    style[field] = !!value;
  } else if (field === 'textShadowWidth') {
    const num = parseFloat(value);
    style.textShadowWidth = Number.isFinite(num) ? Math.max(0, Math.min(10, num)) : 0;
  } else if (field === 'labelBorderWidth') {
    const num = parseFloat(value);
    style.labelBorderWidth = Number.isFinite(num) ? Math.max(0, Math.min(10, num)) : 0;
  } else {
    style[field] = value;
  }
}

function _bdStyleFieldNeedsFullRebuild(kind, field) {
  if (kind === 'card') return field === 'shape';
  if (kind === 'line') return field === 'pathType' || field === 'textAlongPath' || field === 'textVisible';
  return false;
}

// 共通ヘルパー: カードスタイルの色系フィールドをリセット（計画書 §4-2）
function _bdResetCardColors(style) {
  style.bgColor = '';
  style.textColor = '';
  style.textStrokeColor = '';
  style.borderColor = '';
}

// スタイルの「ユーザー定義デフォルト」用スナップショットを作る。
// id / name / _default 自身は除外し、値プロパティだけコピーする。
function _bdCloneStyleForDefault(style) {
  if (!style || typeof style !== 'object') return null;
  const snap = {};
  for (const key of Object.keys(style)) {
    if (key === 'id' || key === 'name' || key === '_default') continue;
    snap[key] = style[key];
  }
  return snap;
}

// スタイルを初期設定に戻す。
// 優先順位:
// 1. style._default (このボード内で「+」/「保存」で記録した値) があればそれに戻す
// 2. グローバルデフォルト (localStorage) に id 一致するエントリがあればそれに戻す
// 3. BD_DEFAULT_*_STYLES の id 一致する定義があればそれに戻す (ビルトインの初期値)
// 4. どれもない場合は色系のみリセット (カスタムスタイルへの救済措置)
function _bdResetStyleToDefault(kind, style) {
  if (!style) return;
  if (style._default && typeof style._default === 'object') {
    Object.keys(style).forEach(key => {
      if (key === 'id' || key === 'name' || key === '_default') return;
      delete style[key];
    });
    Object.keys(style._default).forEach(key => {
      if (key === 'id' || key === 'name' || key === '_default') return;
      style[key] = style._default[key];
    });
    return;
  }
  const globals = _bdReadGlobalStyleDefaults(kind);
  const globalDef = style.id && globals[style.id];
  if (globalDef && typeof globalDef === 'object') {
    Object.keys(style).forEach(key => {
      if (key === 'id' || key === 'name' || key === '_default') return;
      delete style[key];
    });
    Object.keys(globalDef).forEach(key => {
      if (key === 'id' || key === 'name' || key === '_default') return;
      style[key] = globalDef[key];
    });
    // 次回以降のリセットを早くするため per-board _default にも反映
    style._default = _bdCloneStyleForDefault(style);
    return;
  }
  const defaults = kind === 'card'
    ? (typeof bdDefaultCardStylesForBoard === 'function' ? bdDefaultCardStylesForBoard(typeof bd !== 'undefined' ? bd : undefined) : BD_DEFAULT_CARD_STYLES)
    : (typeof bdDefaultLineStylesForBoard === 'function' ? bdDefaultLineStylesForBoard(typeof bd !== 'undefined' ? bd : undefined) : BD_DEFAULT_LINE_STYLES);
  const def = (defaults || []).find(d => d && d.id === style.id);
  if (def) {
    Object.keys(style).forEach(key => {
      if (key === 'id') return;
      delete style[key];
    });
    Object.keys(def).forEach(key => {
      if (key === 'id') return;
      style[key] = def[key];
    });
    return;
  }
  if (kind === 'card') _bdResetCardColors(style);
  else {
    style.color = '';
    style.labelTextColor = '';
    style.labelBgColor = '';
    style.labelBorderColor = '';
  }
}

function _bdShapeOpts() {
  const shapes = (typeof BD_SHAPES !== 'undefined' ? BD_SHAPES : ['rect']);
  return shapes.map(s => ({
    v: s,
    l: (typeof BD_SHAPE_LABELS !== 'undefined' && BD_SHAPE_LABELS[s]) || s,
  }));
}

function _bdGetBoardCustomStyleId(kind) {
  return kind === 'card' ? 'card-custom' : 'line-custom';
}

// ノード/接続単位の自動 fork スタイル (card-custom / card-custom-<nodeId> / line-custom / line-custom-<connId>) を判定する。
// これらは詳細パネルの編集時に内部的に作られるフォークで、ユーザー向けスタイル管理ダイアログには出さない。
function _bdIsCustomStyleId(kind, id) {
  if (!id) return false;
  const prefix = kind === 'card' ? 'card-custom' : 'line-custom';
  return id === prefix || id.startsWith(prefix + '-');
}

// スタイル管理ダイアログの一覧に表示するスタイル群を取り出す（カスタム fork を除外）。
function _bdDisplayedManagedStyles(kind) {
  const styles = kind === 'card' ? bd.cardStyles : bd.lineStyles;
  return (styles || []).filter(style => style && !_bdIsCustomStyleId(kind, style.id));
}

// 既存スタイルと名前が衝突しないように連番サフィックスを付与する。
function _bdMakeUniqueStyleName(baseName, styles, excludeId) {
  const trimmed = String(baseName || '').trim() || 'スタイル';
  const names = new Set();
  (styles || []).forEach(style => {
    if (!style || style.id === excludeId) return;
    if (style.name) names.add(String(style.name));
  });
  if (!names.has(trimmed)) return trimmed;
  for (let i = 2; i < 10000; i++) {
    const candidate = `${trimmed} ${i}`;
    if (!names.has(candidate)) return candidate;
  }
  return trimmed;
}

// 指定スタイルがボード上で何個のカード/接続から参照されているか数える。
function _bdCountStyleUsage(kind, styleId) {
  if (!styleId || typeof bd === 'undefined') return 0;
  if (kind === 'card') return (bd.nodes || []).filter(node => node && node.cardStyle === styleId).length;
  return (bd.connections || []).filter(conn => conn && conn.styleRef === styleId).length;
}

// ボード詳細パネルでスタイル編集が始まった瞬間に、既存スタイルを保護するため
// 現在 active なスタイルを fork してカスタム化する。
// 既にカスタムが active ならそのまま返す。
// 注意: bdGetCardStyleById/bdGetLineStyleById は内部で bdEnsureBoardUiState を再呼び
// 出して bd.cardStyles 配列を新オブジェクトに置換するため、ここでは使わず
// 直接 find する（古い配列参照を持ち続けないため）。
function _bdEnsureBoardCustomStyle(kind) {
  bdEnsureBoardUiState();
  const customId = _bdGetBoardCustomStyleId(kind);
  const styles = kind === 'card' ? bd.cardStyles : bd.lineStyles;
  const activeRef = kind === 'card' ? 'activeCardStyle' : 'activeLineStyle';
  if (bd[activeRef] === customId) {
    return styles.find(s => s.id === customId) || null;
  }
  const source = styles.find(s => s.id === bd[activeRef]) || styles[0];
  if (!source) return null;
  const next = _bdClone(source);
  next.id = customId;
  next.name = 'カスタム';
  const customIndex = styles.findIndex(s => s.id === customId);
  if (customIndex >= 0) styles.splice(customIndex, 1, next);
  else styles.push(next);
  bd[activeRef] = customId;
  return next;
}

async function _bdSaveBoardStyleAsNew(kind) {
  const activeRef = kind === 'card' ? 'activeCardStyle' : 'activeLineStyle';
  // bdGetCardStyleById/bdGetLineStyleById が内部で bdEnsureBoardUiState を呼んで
  // bd.cardStyles/bd.lineStyles を新配列に差し替えるため、source 取得後に配列参照を固定してはいけない。
  // push 時点で bd.cardStyles / bd.lineStyles を直接参照する。
  const source = kind === 'card' ? bdGetCardStyleById(bd[activeRef]) : bdGetLineStyleById(bd[activeRef]);
  if (!source) return null;
  const baseName = source.name && source.name !== 'カスタム'
    ? `${source.name} 2`
    : (kind === 'card' ? '新しいカードスタイル' : '新しいラインスタイル');
  const input = await cfPrompt(kind === 'card' ? 'カードスタイル名' : 'ラインスタイル名', baseName);
  if (input == null) return null;
  const name = String(input).trim();
  if (!name) return null;
  if (typeof bdPushUndo === 'function') bdPushUndo();
  const next = _bdClone(source);
  next.id = _bdNormalizeStyleId(`${kind}-style-${Date.now().toString(36)}`, `${kind}-style`);
  next.name = name;
  // 保存時点の値を「ユーザー定義デフォルト」として記録（リセットで戻る先）
  next._default = _bdCloneStyleForDefault(next);
  if (kind === 'card') bd.cardStyles.push(next);
  else bd.lineStyles.push(next);
  bd[activeRef] = next.id;
  bdDirty();
  bdRender();
  bdRefreshBoardToolbar();
  if (typeof bdRefreshSelectionDetails === 'function') bdRefreshSelectionDetails(true);
  showStatus(`${kind === 'card' ? 'カードスタイル' : 'ラインスタイル'}「${name}」として保存しました`, false, { showSaveDialog: true });
  return next;
}

function _bdSaveCurrentBoardStyle(kind) {
  bdEnsureBoardUiState();
  const activeRef = kind === 'card' ? 'activeCardStyle' : 'activeLineStyle';
  const style = kind === 'card' ? bdGetCardStyleById(bd[activeRef]) : bdGetLineStyleById(bd[activeRef]);
  if (!style) return;
  if (typeof bdPushUndo === 'function') bdPushUndo();
  // 保存時も現在値を「ユーザー定義デフォルト」として更新（以降のリセットで戻る先）
  style._default = _bdCloneStyleForDefault(style);
  // 全ボード共通のグローバルデフォルトにも保存 (他のボードを開いたときも反映される)
  _bdSaveGlobalStyleDefault(kind, style);
  bdDirty();
  showStatus(`${kind === 'card' ? 'カードスタイル' : 'ラインスタイル'}「${style.name}」をデフォルトとして保存しました`, false, { showSaveDialog: true });
}

// ノード個別のカードスタイルをカスタム化する。
// ノード固有の override が設定されている場合は effective style を base にカスタムを作成し、
// そのノードに割り当て、override をクリアする。
function _bdEnsureNodeCardCustomStyle(node) {
  if (!node) return null;
  bdEnsureBoardUiState();
  const customId = 'card-custom-' + node.id;
  if (node.cardStyle === customId) {
    const existing = bd.cardStyles.find(s => s.id === customId);
    if (existing) return existing;
  }
  const eff = typeof bdGetNodeStyle === 'function' ? bdGetNodeStyle(node) : {};
  const next = {
    id: customId,
    name: 'カスタム',
    bgColor: eff.bgColor || '',
    textColor: eff.textColor || '',
    textStrokeColor: eff.textStrokeColor || '',
    borderColor: eff.borderColor || '',
    borderWidth: Number.isFinite(+eff.borderWidth) ? +eff.borderWidth : 0,
    borderRadius: Number.isFinite(+eff.borderRadius) ? +eff.borderRadius : 6,
    fontSize: Number.isFinite(+eff.fontSize) ? +eff.fontSize : 13,
    fontBold: !!eff.fontBold,
    fontItalic: !!eff.fontItalic,
    textStrokeWidth: Number.isFinite(+eff.textStrokeWidth) ? +eff.textStrokeWidth : 0,
    shape: eff.shape || '',
    width: Number.isFinite(+eff.width) ? +eff.width : 160,
  };
  const idx = bd.cardStyles.findIndex(s => s.id === customId);
  if (idx >= 0) bd.cardStyles.splice(idx, 1, next);
  else bd.cardStyles.push(next);
  if (typeof bdSetNodeCardStyleRef === 'function') bdSetNodeCardStyleRef(node, customId, { clearOverrides: true });
  else {
    if (typeof bdClearCardStyleOverrides === 'function') bdClearCardStyleOverrides(node);
    node.cardStyle = customId;
    node._userCardStyle = true;
  }
  return next;
}

function _bdEnsureConnectionLineCustomStyle(conn) {
  if (!conn) return null;
  bdEnsureBoardUiState();
  const customId = 'line-custom-' + conn.id;
  if (conn.styleRef === customId) {
    const existing = bd.lineStyles.find(s => s.id === customId);
    if (existing) return existing;
  }
  const eff = typeof bdGetConnectionStyle === 'function' ? bdGetConnectionStyle(conn) : {};
  const next = {
    id: customId,
    name: 'カスタム',
    color: eff.color || '',
    width: Number.isFinite(+eff.width) ? +eff.width : 0,
    style: eff.style === 'dashed' ? 'dashed' : '',
    arrow: ['end', 'start', 'both', ''].includes(eff.arrow) ? eff.arrow : 'end',
    pathType: _bdNormalizePathType(eff.pathType),
  };
  const idx = bd.lineStyles.findIndex(s => s.id === customId);
  if (idx >= 0) bd.lineStyles.splice(idx, 1, next);
  else bd.lineStyles.push(next);
  if (typeof bdClearConnectionStyleOverrides === 'function') bdClearConnectionStyleOverrides(conn);
  conn.styleRef = customId;
  return next;
}

function _bdCardStyleSnapshotFromNode(node, fallback) {
  const eff = typeof bdGetNodeStyle === 'function' ? bdGetNodeStyle(node) : {};
  return {
    ..._bdClone(fallback || {}),
    bgColor: eff.bgColor ?? fallback?.bgColor ?? '',
    textColor: eff.textColor ?? fallback?.textColor ?? '',
    textStrokeColor: eff.textStrokeColor ?? fallback?.textStrokeColor ?? '',
    borderColor: eff.borderColor ?? fallback?.borderColor ?? '',
    borderWidth: Number.isFinite(+eff.borderWidth) ? +eff.borderWidth : (Number.isFinite(+(fallback?.borderWidth)) ? +fallback.borderWidth : 0),
    borderRadius: Number.isFinite(+eff.borderRadius) ? +eff.borderRadius : (Number.isFinite(+(fallback?.borderRadius)) ? +fallback.borderRadius : 6),
    fontSize: Number.isFinite(+eff.fontSize) ? +eff.fontSize : (Number.isFinite(+(fallback?.fontSize)) ? +fallback.fontSize : 13),
    fontBold: !!eff.fontBold,
    fontItalic: !!eff.fontItalic,
    fontFamily: _bdNormalizeFontFamily(eff.fontFamily ?? fallback?.fontFamily ?? ''),
    textStrokeWidth: Number.isFinite(+eff.textStrokeWidth) ? +eff.textStrokeWidth : (Number.isFinite(+(fallback?.textStrokeWidth)) ? +fallback.textStrokeWidth : 0),
    shape: eff.shape ?? fallback?.shape ?? '',
    width: Number.isFinite(+eff.width) ? +eff.width : (Number.isFinite(+(fallback?.width)) ? +fallback.width : 160),
    // v0.5.251: 雲/トゲ/もやもや用パラメータも effective 値で反映
    cloudBumpWidth: Number.isFinite(+eff.cloudBumpWidth) ? +eff.cloudBumpWidth : (Number.isFinite(+(fallback?.cloudBumpWidth)) ? +fallback.cloudBumpWidth : 40),
    cloudBumpHeight: Number.isFinite(+eff.cloudBumpHeight) ? +eff.cloudBumpHeight : (Number.isFinite(+(fallback?.cloudBumpHeight)) ? +fallback.cloudBumpHeight : 16),
    cloudSideWidth: Number.isFinite(+eff.cloudSideWidth) ? +eff.cloudSideWidth : (Number.isFinite(+(fallback?.cloudSideWidth)) ? +fallback.cloudSideWidth : 12),
    cloudOffset: Number.isFinite(+eff.cloudOffset) ? +eff.cloudOffset : (Number.isFinite(+(fallback?.cloudOffset)) ? +fallback.cloudOffset : 0.5),
    cloudSubWidthRatio: Number.isFinite(+eff.cloudSubWidthRatio) ? +eff.cloudSubWidthRatio : (Number.isFinite(+(fallback?.cloudSubWidthRatio)) ? +fallback.cloudSubWidthRatio : 0),
    cloudSubHeightRatio: Number.isFinite(+eff.cloudSubHeightRatio) ? +eff.cloudSubHeightRatio : (Number.isFinite(+(fallback?.cloudSubHeightRatio)) ? +fallback.cloudSubHeightRatio : 0),
  };
}

function _bdLineStyleSnapshotFromConnection(conn, fallback) {
  const eff = typeof bdGetConnectionStyle === 'function' ? bdGetConnectionStyle(conn) : {};
  const hasOwn = key => conn && Object.prototype.hasOwnProperty.call(conn, key);
  const valueOrFallback = (key, defaultValue = '') => (
    hasOwn(key) ? conn[key] : (eff[key] ?? fallback?.[key] ?? defaultValue)
  );
  const arrow = ['end', 'start', 'both', ''].includes(eff.arrow) ? eff.arrow : (fallback?.arrow || 'end');
  const pathType = _bdNormalizePathType(eff.pathType, fallback?.pathType);
  return {
    ..._bdClone(fallback || {}),
    color: valueOrFallback('color'),
    width: Number.isFinite(+eff.width) ? +eff.width : (Number.isFinite(+(fallback?.width)) ? +fallback.width : 0),
    style: valueOrFallback('style') === 'dashed' ? 'dashed' : '',
    arrow,
    pathType,
    branchRatio: Number.isFinite(+eff.branchRatio) ? Math.max(0.05, Math.min(0.95, +eff.branchRatio)) : (Number.isFinite(+fallback?.branchRatio) ? Math.max(0.05, Math.min(0.95, +fallback.branchRatio)) : 0.3),
    cornerRadius: Number.isFinite(+eff.cornerRadius) ? Math.max(0, Math.min(40, +eff.cornerRadius)) : (Number.isFinite(+fallback?.cornerRadius) ? Math.max(0, Math.min(40, +fallback.cornerRadius)) : 0),
    labelTextColor: valueOrFallback('labelTextColor'),
    labelBgColor: valueOrFallback('labelBgColor'),
    labelBorderColor: valueOrFallback('labelBorderColor'),
    labelBorderWidth: Number.isFinite(+eff.labelBorderWidth) ? +eff.labelBorderWidth : (Number.isFinite(+fallback?.labelBorderWidth) ? +fallback.labelBorderWidth : 0),
    fontBold: eff.fontBold !== undefined ? !!eff.fontBold : !!fallback?.fontBold,
    fontItalic: eff.fontItalic !== undefined ? !!eff.fontItalic : !!fallback?.fontItalic,
    fontFamily: _bdNormalizeFontFamily(eff.fontFamily ?? fallback?.fontFamily ?? ''),
    textVisible: eff.textVisible !== undefined ? !!eff.textVisible : (fallback?.textVisible !== undefined ? !!fallback.textVisible : true),
    textAlongPath: eff.textAlongPath !== undefined ? !!eff.textAlongPath : !!fallback?.textAlongPath,
    textAutoFlip: eff.textAutoFlip !== undefined ? !!eff.textAutoFlip : (fallback?.textAutoFlip !== undefined ? !!fallback.textAutoFlip : true),
    textShadowWidth: Number.isFinite(+eff.textShadowWidth) ? +eff.textShadowWidth : (Number.isFinite(+fallback?.textShadowWidth) ? +fallback.textShadowWidth : 0),
    textShadowColor: valueOrFallback('textShadowColor'),
  };
}

async function _bdSaveNodeCardStyleAsNew(node) {
  if (!node) return null;
  bdEnsureBoardUiState();
  const base = bdGetCardStyleById(node.cardStyle || bd.activeCardStyle);
  const source = _bdCardStyleSnapshotFromNode(node, base);
  const baseName = source.name && source.name !== 'カスタム' ? `${source.name} 2` : '新しいカードスタイル';
  const input = await cfPrompt('カードスタイル名', baseName);
  if (input == null) return null;
  const name = String(input).trim();
  if (!name) return null;
  if (typeof bdPushUndo === 'function') bdPushUndo();
  const next = _bdClone(source);
  next.id = _bdNormalizeStyleId(`card-style-${Date.now().toString(36)}`, 'card-style');
  next.name = name;
  // 保存時点の値を「ユーザー定義デフォルト」として記録（リセットで戻る先）
  next._default = _bdCloneStyleForDefault(next);
  bd.cardStyles.push(next);
  if (typeof bdSetNodeCardStyleRef === 'function') bdSetNodeCardStyleRef(node, next.id, { clearOverrides: true });
  else {
    node.cardStyle = next.id;
    if (typeof bdClearCardStyleOverrides === 'function') bdClearCardStyleOverrides(node);
    node._userCardStyle = true;
  }
  bdDirty();
  bdRender();
  bdRefreshBoardToolbar();
  if (typeof bdRefreshSelectionDetails === 'function') bdRefreshSelectionDetails(true);
  showStatus(`カードスタイル「${name}」として保存しました`, false, { showSaveDialog: true });
  return next;
}

async function _bdSaveConnectionLineStyleAsNew(conn) {
  if (!conn) return null;
  bdEnsureBoardUiState();
  const base = bdGetLineStyleById(conn.styleRef || bd.activeLineStyle);
  const source = _bdLineStyleSnapshotFromConnection(conn, base);
  const baseName = source.name && source.name !== 'カスタム' ? `${source.name} 2` : '新しいラインスタイル';
  const input = await cfPrompt('ラインスタイル名', baseName);
  if (input == null) return null;
  const name = String(input).trim();
  if (!name) return null;
  if (typeof bdPushUndo === 'function') bdPushUndo();
  const next = _bdClone(source);
  next.id = _bdNormalizeStyleId(`line-style-${Date.now().toString(36)}`, 'line-style');
  next.name = name;
  // 保存時点の値を「ユーザー定義デフォルト」として記録（リセットで戻る先）
  next._default = _bdCloneStyleForDefault(next);
  bd.lineStyles.push(next);
  conn.styleRef = next.id;
  if (typeof bdClearConnectionStyleOverrides === 'function') bdClearConnectionStyleOverrides(conn);
  bdDirty();
  bdRender();
  bdRefreshBoardToolbar();
  if (typeof bdRefreshSelectionDetails === 'function') bdRefreshSelectionDetails(true);
  showStatus(`ラインスタイル「${name}」として保存しました`, false, { showSaveDialog: true });
  return next;
}

// v0.5.251: カードの個別オーバーライドを共通スタイルに伝播する。
// 詳細パネル編集で node に蓄積された overrides を style にコピーし、node 側は削除する。
// これで同じスタイルを参照する他のカードにも変更が反映される。
// `bdClearCardStyleOverrides` のキー一覧と同期すること (width は n.w が別管理なので除外)。
const _BD_CARD_OVERRIDE_KEYS = [
  'bgColor', 'textColor', 'borderColor', 'borderWidth', 'borderRadius',
  'fontSize', 'fontBold', 'fontItalic', 'textStrokeColor', 'textStrokeWidth',
  'shape',
  'cloudBumpWidth', 'cloudBumpHeight', 'cloudSideWidth', 'cloudOffset',
  'cloudSubBumpRatio', 'cloudSubWidthRatio', 'cloudSubHeightRatio',
];
function _bdSaveCurrentNodeCardStyle(node) {
  if (!node) return;
  bdEnsureBoardUiState();
  const style = bdGetCardStyleById(node.cardStyle || bd.activeCardStyle);
  if (!style) return;
  if (typeof bdPushUndo === 'function') bdPushUndo();
  // node の overrides を style にコピー → node 側は削除
  let copied = 0;
  _BD_CARD_OVERRIDE_KEYS.forEach(key => {
    if (Object.prototype.hasOwnProperty.call(node, key)) {
      style[key] = node[key];
      delete node[key];
      copied += 1;
    }
  });
  // 保存時も現在値を「ユーザー定義デフォルト」として更新（以降のリセットで戻る先）
  style._default = _bdCloneStyleForDefault(style);
  _bdSaveGlobalStyleDefault('card', style);
  if (typeof bdRender === 'function') bdRender();
  bdDirty();
  if (typeof bdRefreshSelectionDetails === 'function') bdRefreshSelectionDetails(true);
  showStatus(copied > 0
    ? `カードスタイル「${style.name}」をデフォルトとして保存しました (同じスタイルの他のカードにも反映)`
    : `カードスタイル「${style.name}」は既に保存済みです`, false, { showSaveDialog: true });
}

const _BD_LINE_OVERRIDE_KEYS = [
  'color', 'width', 'style', 'arrow', 'straight', 'pathType',
  'branchRatio', 'cornerRadius',
  'labelTextColor', 'labelBgColor', 'labelBorderColor', 'labelBorderWidth',
  'fontBold', 'fontItalic',
  'textVisible', 'textAlongPath', 'textAutoFlip', 'textShadowWidth', 'textShadowColor',
];
function _bdSaveCurrentConnectionLineStyle(conn) {
  if (!conn) return;
  bdEnsureBoardUiState();
  const style = bdGetLineStyleById(conn.styleRef || bd.activeLineStyle);
  if (!style) return;
  if (typeof bdPushUndo === 'function') bdPushUndo();
  // conn の overrides を style にコピー → conn 側は削除
  let copied = 0;
  _BD_LINE_OVERRIDE_KEYS.forEach(key => {
    if (Object.prototype.hasOwnProperty.call(conn, key)) {
      style[key] = conn[key];
      delete conn[key];
      copied += 1;
    }
  });
  style._default = _bdCloneStyleForDefault(style);
  _bdSaveGlobalStyleDefault('line', style);
  if (typeof bdDrawConns === 'function') bdDrawConns();
  bdDirty();
  if (typeof bdRefreshSelectionDetails === 'function') bdRefreshSelectionDetails(true);
  showStatus(copied > 0
    ? `ラインスタイル「${style.name}」をデフォルトとして保存しました (同じスタイルの他のラインにも反映)`
    : `ラインスタイル「${style.name}」は既に保存済みです`, false, { showSaveDialog: true });
}

/**
 * カード/ラインのスタイルフィールドを DOM として構築する。
 * 計画書 §4-2/§4-3 の横並び構造に対応（gb-fmt-popup-row）。
 *
 * @param {HTMLElement} container 配置先コンテナ（innerHTML はクリアされる）
 * @param {'card'|'line'} kind
 * @param {Object} style 対象のスタイルオブジェクト（直接更新される）
 * @param {() => void} onChange 変更後コールバック
 * @param {{beforeEdit?: () => Object|null}} [options] beforeEdit が返したスタイルがあれば、
 *        編集はそのスタイルに対して行う（ボード詳細パネルでカスタム化に使用）
 */
function _bdBuildStyleFields(container, kind, style, onChange, options) {
  if (!container || !style) return;
  container.innerHTML = '';
  const fmt = window.gbFmt;
  if (!fmt) { container.textContent = '書式UI未ロード'; return; }
  const emit = (field) => { try { onChange && onChange(field); } catch (_) {} };
  const editTarget = () => {
    if (options && typeof options.beforeEdit === 'function') {
      const next = options.beforeEdit();
      if (next) return next;
    }
    return style;
  };
  // v0.5.251: name は「スタイルそのもののメタデータ」なので、常に shared style に書き込む。
  // 詳細パネルでは editTarget が node/conn (個別 override) を返すため、name だけは別経路で共有スタイルを参照する。
  const nameEditTarget = () => {
    if (options && typeof options.nameEditTarget === 'function') {
      const next = options.nameEditTarget();
      if (next) return next;
    }
    return style;
  };
  const setField = (field, value) => {
    if (field === 'name') {
      const nameTarget = nameEditTarget();
      if (!nameTarget) return;
      const trimmed = String(value == null ? '' : value).trim();
      if (trimmed === nameTarget.name) return;
      if (!trimmed) { emit(); return; }
      if (typeof bdPushUndo === 'function') bdPushUndo();
      nameTarget.name = trimmed;
      emit(field);
      return;
    }
    // 複数ターゲット一括適用: editTargets() が配列を返したら、全ターゲットに同じ変更を適用する。
    // editTargets が指定されていれば (空配列でも) 単一編集にフォールバックしない。
    // undo は 1 回だけ積む（まとめて戻せるように）。
    if (options && typeof options.editTargets === 'function') {
      const multi = options.editTargets();
      if (Array.isArray(multi) && multi.length) {
        if (typeof bdPushUndo === 'function') bdPushUndo();
        multi.forEach(t => { if (t) _bdApplyStyleFieldChange(kind, t, field, value); });
        emit(field);
      }
      return;
    }
    const target = editTarget();
    if (!target) return;
    if (typeof bdPushUndo === 'function') bdPushUndo();
    _bdApplyStyleFieldChange(kind, target, field, value);
    emit(field);
  };

  // E2E 互換のため、各フィールドに data-bd-style-field="<fieldName>" を付与する。
  // [app/gb-e2e-actions-extra.js](app/gb-e2e-actions-extra.js) が modal.querySelector で参照する。
  const e2eScope = (options && options.e2eScope) || kind;
  const tag = (field) => (el) => {
    if (!el || !el.setAttribute) return el;
    const e2eId = `bd-style-${e2eScope}-${field}`;
    const nested = el.matches?.('input,select,textarea,button')
      ? [el]
      : [...el.querySelectorAll('input,select,textarea,button')];
    if (nested.length) {
      el.setAttribute('data-bd-style-field-container', field);
    } else {
      el.setAttribute('data-bd-style-field', field);
    }
    el.setAttribute('data-e2e-id', e2eId);
    if (!el.getAttribute('aria-label') && !el.textContent.trim()) {
      el.setAttribute('aria-label', el.getAttribute('title') || field);
    }
    nested.forEach((node, index) => {
      node.setAttribute('data-bd-style-field', field);
      node.setAttribute('data-e2e-id', index === 0 ? e2eId : `${e2eId}-${index + 1}`);
      if (!node.getAttribute('aria-label')) {
        node.setAttribute('aria-label', node.getAttribute('title') || el.getAttribute('title') || field);
      }
    });
    return el;
  };
  const showFontFamily = !(options && options.hideFontFamily);

  // --- 名前行（独立行）---
  // hideName が指定されている or 複数ターゲット編集 (editTargets) の場合は名前行を表示しない。
  const hideName = !!(options && (options.hideName || typeof options.editTargets === 'function'));
  if (!hideName) {
    const nameRow = document.createElement('div');
    nameRow.className = 'bd-style-name-row';
    const nameLbl = document.createElement('span');
    nameLbl.className = 'gb-fmt-label';
    nameLbl.textContent = 'スタイル名';
    const nameInp = document.createElement('input');
    nameInp.type = 'text';
    nameInp.value = style.name || '';
    nameInp.className = 'bd-style-name-input';
    nameInp.setAttribute('data-bd-style-field', 'name');
    nameInp.setAttribute('data-e2e-id', `bd-style-${e2eScope}-name`);
    nameInp.setAttribute('aria-label', 'スタイル名');
    nameInp.addEventListener('change', () => setField('name', nameInp.value));
    nameRow.append(nameLbl, nameInp);
    container.appendChild(nameRow);
  }

  if (kind === 'card') {
    // --- Row 1: 色 + 書式 + サイズ ---
    // 並び順: 背景色 → 枠線色 → 文字色 → 文字フチ色。
    // 文字色・文字フチ色スウォッチは背景を bgColor に揃え、実際の見え方をプレビュー。
    const row1 = fmt.makeRow({ wrap: true });
    row1.appendChild(tag('bgColor')(fmt.makeSwatchBg({ title: '背景色', color: style.bgColor || '', onPick: (c) => setField('bgColor', c) })));
    row1.appendChild(tag('borderColor')(fmt.makeSwatchBg({ title: '枠線色', color: style.borderColor || '', onPick: (c) => setField('borderColor', c) })));
    row1.appendChild(tag('textColor')(fmt.makeSwatchText({ title: '文字色', color: style.textColor || '', iconName: 'type', bgColor: style.bgColor || '', onPick: (c) => setField('textColor', c) })));
    row1.appendChild(tag('textStrokeColor')(fmt.makeSwatchText({ title: '文字フチ色', color: style.textStrokeColor || '', iconName: 'typeOutline', bgColor: style.bgColor || '', onPick: (c) => setField('textStrokeColor', c) })));
    row1.appendChild(tag('fontBold')(fmt.makeToggle({ html: '<b>B</b>', title: '太字', active: !!style.fontBold, onToggle: (on) => setField('fontBold', on) })));
    row1.appendChild(tag('fontItalic')(fmt.makeToggle({ html: '<i>I</i>', title: '斜体', active: !!style.fontItalic, onToggle: (on) => setField('fontItalic', on) })));
    const fontSizeInp = fmt.makeNumInput({ title: '文字サイズ', value: style.fontSize, min: 8, max: 72, onChange: (v) => setField('fontSize', v == null ? '' : v) });
    tag('fontSize')(fontSizeInp);
    row1.appendChild(fmt.makeGroup([fmt.makeLabel('文字'), fontSizeInp, fmt.makeLabel('px')]));
    if (showFontFamily) {
      const fontFamilySel = fmt.makeSelect({ opts: _bdFontFamilyOptions(), value: _bdNormalizeFontFamily(style.fontFamily), onChange: (v) => setField('fontFamily', v) });
      tag('fontFamily')(fontFamilySel);
      row1.appendChild(fmt.makeGroup([fmt.makeLabel('フォント'), fontFamilySel]));
    }
    container.appendChild(row1);

    // --- Row 2: カード固有 (フチ幅 / 枠線 / [標準幅] / 形状 / [角丸]) ---
    //   - 標準幅: 新規カード作成時の初期幅に使われる。選択済みの既存カードには無意味なので
    //     hideDefaultWidth=true のとき非表示 (既存カード選択時の詳細パネル用途)。
    //   - 角丸: 矩形 (rect) のとき以外は形状が独自に輪郭を決めるため無意味。rect のときだけ表示。
    const row2 = fmt.makeRow({ wrap: true });
    const tswInp = fmt.makeNumInput({ title: '文字フチ幅', value: style.textStrokeWidth || 0, min: 0, max: 12, onChange: (v) => setField('textStrokeWidth', v == null ? 0 : v) });
    tag('textStrokeWidth')(tswInp);
    row2.appendChild(fmt.makeGroup([fmt.makeLabel('フチ幅'), tswInp, fmt.makeLabel('px')]));
    const bwInp = fmt.makeNumInput({ title: '枠線太さ', value: style.borderWidth, min: 0, max: 20, onChange: (v) => setField('borderWidth', v == null ? 0 : v) });
    tag('borderWidth')(bwInp);
    row2.appendChild(fmt.makeGroup([fmt.makeLabel('枠線'), bwInp, fmt.makeLabel('px')]));
    if (!(options && options.hideDefaultWidth)) {
      const wInp = fmt.makeNumInput({ title: '標準幅', value: style.width || 160, min: 40, max: 600, onChange: (v) => setField('width', v == null ? 160 : v), width: 76 });
      tag('width')(wInp);
      row2.appendChild(fmt.makeGroup([fmt.makeLabel('標準幅'), wInp, fmt.makeLabel('px')]));
    }
    const shpSel = fmt.makeSelect({ opts: _bdShapeOpts(), value: style.shape || 'rect', onChange: (v) => setField('shape', v) });
    tag('shape')(shpSel);
    row2.appendChild(fmt.makeGroup([fmt.makeLabel('形状'), shpSel]));
    const isRectShape = !style.shape || style.shape === 'rect';
    if (isRectShape) {
      const brInp = fmt.makeNumInput({ title: '角丸', value: style.borderRadius, min: 0, max: 64, onChange: (v) => setField('borderRadius', v == null ? 0 : v) });
      tag('borderRadius')(brInp);
      row2.appendChild(fmt.makeGroup([fmt.makeLabel('角丸'), brInp, fmt.makeLabel('px')]));
    }
    container.appendChild(row2);

    // 選択色・カーソル色はカードスタイル単位ではなくボード全体の設定 (bd.selectionColor / bd.caretColor) に移行。
    // カードスタイル UI からは除外し、ボード詳細パネル (選択なし時) で設定する。

    // --- Row 3 (雲型・トゲ型用): 山の幅 / 山の高さ / ズラし量 / 小山サイズ ---
    //   「張り出し」(cloudSideWidth) は楕円ベースに変更した v0.5.190 以降実際の描画に使われていないため UI から除外。
    if (style.shape === 'cloud' || style.shape === 'thorn' || style.shape === 'thorn-curve' || style.shape === 'fluffy') {
      const row3 = fmt.makeRow({ wrap: true });
      const cbw = fmt.makeNumInput({ title: '山の幅', value: style.cloudBumpWidth ?? 40, min: 8, max: 200, onChange: (v) => setField('cloudBumpWidth', v == null ? 40 : v) });
      tag('cloudBumpWidth')(cbw);
      row3.appendChild(fmt.makeGroup([fmt.makeLabel('山の幅'), cbw, fmt.makeLabel('px')]));
      const cbh = fmt.makeNumInput({ title: '山の高さ', value: style.cloudBumpHeight ?? 16, min: 2, max: 100, onChange: (v) => setField('cloudBumpHeight', v == null ? 16 : v) });
      tag('cloudBumpHeight')(cbh);
      row3.appendChild(fmt.makeGroup([fmt.makeLabel('山の高さ'), cbh, fmt.makeLabel('px')]));
      // ズラし量は 0〜100 (%) の整数で UI 表示し、内部では 0〜1 に正規化
      const offsetPct = Math.round((style.cloudOffset ?? 0.5) * 100);
      const coOff = fmt.makeNumInput({ title: 'ズラし量 (%)', value: offsetPct, min: 0, max: 100, onChange: (v) => setField('cloudOffset', v == null ? 50 : v) });
      tag('cloudOffset')(coOff);
      row3.appendChild(fmt.makeGroup([fmt.makeLabel('ズラし量'), coOff, fmt.makeLabel('%')]));
      // 小山サイズ比率 — メイン山の幅・高さを別々の % で縮小して小山とする。両方 > 0 で小山が現れる。
      const subWPct = Math.max(0, Math.min(100, Math.round(+(style.cloudSubWidthRatio ?? 0))));
      const subWInp = fmt.makeNumInput({ title: '小山の幅 (メイン山に対する %)', value: subWPct, min: 0, max: 100, onChange: (v) => setField('cloudSubWidthRatio', v == null ? 0 : v) });
      tag('cloudSubWidthRatio')(subWInp);
      row3.appendChild(fmt.makeGroup([fmt.makeLabel('小山幅'), subWInp, fmt.makeLabel('%')]));
      const subHPct = Math.max(0, Math.min(100, Math.round(+(style.cloudSubHeightRatio ?? 0))));
      const subHInp = fmt.makeNumInput({ title: '小山の高さ (メイン山に対する %)', value: subHPct, min: 0, max: 100, onChange: (v) => setField('cloudSubHeightRatio', v == null ? 0 : v) });
      tag('cloudSubHeightRatio')(subHInp);
      row3.appendChild(fmt.makeGroup([fmt.makeLabel('小山高'), subHInp, fmt.makeLabel('%')]));
      container.appendChild(row3);
    }
    // リセットボタンは詳細パネルの style-row に移動 (2026-04-18)
    return;
  }

  // kind === 'line'
  // --- Row 1: 色 + 太さ + ライン種 + 矢印 ---
  const lrow1 = fmt.makeRow({ wrap: true });
  lrow1.appendChild(tag('color')(fmt.makeSwatchBg({ title: '色', color: style.color || '', onPick: (c) => setField('color', c) })));
  const lwInp = fmt.makeNumInput({ title: '太さ', value: style.width, min: 0, max: 20, onChange: (v) => setField('width', v == null ? 0 : v) });
  tag('width')(lwInp);
  lrow1.appendChild(fmt.makeGroup([fmt.makeLabel('太さ'), lwInp, fmt.makeLabel('px')]));
  const lstyleSel = fmt.makeSelect({
    opts: [{ v: '', l: '実線' }, { v: 'dashed', l: '破線' }],
    value: style.style === 'dashed' ? 'dashed' : '',
    onChange: (v) => setField('style', v),
  });
  tag('style')(lstyleSel);
  lrow1.appendChild(fmt.makeGroup([fmt.makeLabel('種類'), lstyleSel]));
  const larrowSel = fmt.makeSelect({
    opts: [{ v: '', l: 'なし' }, { v: 'end', l: '順方向' }, { v: 'start', l: '逆方向' }, { v: 'both', l: '双方向' }],
    value: style.arrow || '',
    onChange: (v) => setField('arrow', v),
  });
  tag('arrow')(larrowSel);
  lrow1.appendChild(fmt.makeGroup([fmt.makeLabel('矢印'), larrowSel]));
  container.appendChild(lrow1);

  // --- Row 2: 形状 ---
  const lrow2 = fmt.makeRow({ wrap: true });
  // v0.5.320: pathType は 3 種 (curve/straight/orthogonal) に統合。
  // 旧 free-bezier は curve、旧 orthogonal-curve は orthogonal として表示。
  let curPath = style.pathType || (style.straight ? 'straight' : 'curve');
  if (curPath === 'free-bezier') curPath = 'curve';
  else if (curPath === 'orthogonal-curve') curPath = 'orthogonal';
  const lpathSel = fmt.makeSelect({
    opts: [
      { v: 'curve', l: '曲線' },
      { v: 'straight', l: '直線' },
      { v: 'orthogonal', l: '直角線' },
    ],
    value: curPath,
    onChange: (v) => setField('pathType', v),
  });
  tag('pathType')(lpathSel);
  lrow2.appendChild(fmt.makeGroup([fmt.makeLabel('形状'), lpathSel]));
  // v0.5.320: 直角線のパラメータ (コーナー半径 / 分岐位置)。pathType='orthogonal' のときのみ活性化
  // makeNumInput は整数のみ扱うため、branchRatio は % (5-95) で保持し、保存時に /100 する
  if (curPath === 'orthogonal') {
    const cornerInput = fmt.makeNumInput({ title: 'コーナー半径 (px)', value: Number.isFinite(+style.cornerRadius) ? +style.cornerRadius : 0, min: 0, max: 40, onChange: (v) => setField('cornerRadius', v == null ? 0 : v) });
    tag('cornerRadius')(cornerInput);
    lrow2.appendChild(fmt.makeGroup([fmt.makeLabel('コーナー半径'), cornerInput, fmt.makeLabel('px')]));
    const branchPct = Math.round((Number.isFinite(+style.branchRatio) ? +style.branchRatio : 0.3) * 100);
    const branchInput = fmt.makeNumInput({ title: '分岐位置 (%)', value: branchPct, min: 5, max: 95, onChange: (v) => setField('branchRatio', v == null ? 0.3 : Math.max(0.05, Math.min(0.95, v / 100))) });
    tag('branchRatio')(branchInput);
    lrow2.appendChild(fmt.makeGroup([fmt.makeLabel('分岐位置'), branchInput, fmt.makeLabel('%')]));
  }
  container.appendChild(lrow2);
  // ライン選択色はラインスタイル単位ではなくボード全体の設定 (bd.selectionColor) に移行。

  // --- ラベル（テキスト）のスタイル ---
  const textVisible = style.textVisible !== undefined ? !!style.textVisible : true;
  const textAlongPath = style.textAlongPath !== undefined ? !!style.textAlongPath : false;
  const textAutoFlip = style.textAutoFlip !== undefined ? !!style.textAutoFlip : true;
  const textShadowWidth = Number.isFinite(+style.textShadowWidth) ? +style.textShadowWidth : 0;
  const labelBorderWidth = Number.isFinite(+style.labelBorderWidth) ? +style.labelBorderWidth : 0;

  // --- Row 2.5: テキスト表示オン/オフ (テキスト設定直前に配置) ---
  const lrowTextToggle = fmt.makeRow({ wrap: true });
  const textVisibleCb = tag('textVisible')(fmt.makeCheckbox({
    text: 'テキスト', title: 'テキスト表示', checked: textVisible, onChange: (on) => setField('textVisible', on),
  }));
  lrowTextToggle.appendChild(textVisibleCb);
  container.appendChild(lrowTextToggle);

  // --- Row 3: テキスト書式 (背景 / 枠線色 / 枠線太さ / 文字色 / 太字 / 斜体 / 縁取 / フォント) ---
  // 並び順: 背景色 → 枠線色 → 枠線太さ → 文字色 → 太字 → 斜体 → 縁取(太さ + 色) → フォント
  const lrow3 = fmt.makeRow({ wrap: true });
  lrow3.appendChild(fmt.makeLabel('テキスト'));
  const labelBgSw = tag('labelBgColor')(fmt.makeSwatchBg({ title: 'テキスト背景色', color: style.labelBgColor || '', onPick: (c) => setField('labelBgColor', c) }));
  const labelBorderSw = tag('labelBorderColor')(fmt.makeSwatchBg({ title: 'テキスト枠線色', color: style.labelBorderColor || '', onPick: (c) => setField('labelBorderColor', c) }));
  lrow3.appendChild(labelBgSw);
  lrow3.appendChild(labelBorderSw);
  const labelBorderWInp = fmt.makeNumInput({ title: 'テキスト枠線太さ', value: labelBorderWidth, min: 0, max: 10, onChange: (v) => setField('labelBorderWidth', v == null ? 0 : v) });
  tag('labelBorderWidth')(labelBorderWInp);
  const labelBorderWGroup = fmt.makeGroup([fmt.makeLabel('枠線'), labelBorderWInp, fmt.makeLabel('px')]);
  lrow3.appendChild(labelBorderWGroup);
  lrow3.appendChild(tag('labelTextColor')(fmt.makeSwatchText({ title: 'テキスト文字色', color: style.labelTextColor || '', iconName: 'type', bgColor: style.labelBgColor || '', onPick: (c) => setField('labelTextColor', c) })));
  // ラインテキストの太字 / 斜体
  lrow3.appendChild(tag('fontBold')(fmt.makeToggle({ html: '<b>B</b>', title: '太字', active: !!style.fontBold, onToggle: (on) => setField('fontBold', on) })));
  lrow3.appendChild(tag('fontItalic')(fmt.makeToggle({ html: '<i>I</i>', title: '斜体', active: !!style.fontItalic, onToggle: (on) => setField('fontItalic', on) })));
  // 縁取 (斜体の後ろ、テキスト色・沿線回転とは独立)
  const shadowInp = fmt.makeNumInput({ title: '縁取り太さ', value: textShadowWidth, min: 0, max: 5, onChange: (v) => setField('textShadowWidth', v == null ? 0 : v) });
  tag('textShadowWidth')(shadowInp);
  const shadowColorSw = fmt.makeSwatchBg({ title: 'テキスト縁取り色', color: style.textShadowColor || '', onPick: (c) => setField('textShadowColor', c) });
  tag('textShadowColor')(shadowColorSw);
  lrow3.appendChild(fmt.makeGroup([fmt.makeLabel('縁取'), shadowInp, fmt.makeLabel('px'), shadowColorSw]));
  if (showFontFamily) {
    const lineFontFamilySel = fmt.makeSelect({ opts: _bdFontFamilyOptions(), value: _bdNormalizeFontFamily(style.fontFamily), onChange: (v) => setField('fontFamily', v) });
    tag('fontFamily')(lineFontFamilySel);
    lrow3.appendChild(fmt.makeGroup([fmt.makeLabel('フォント'), lineFontFamilySel]));
  }
  container.appendChild(lrow3);
  // 沿線回転 ON のときは labelBgColor / labelBorderColor / labelBorderWidth を非活性化
  // (SVG textPath では背景 / 枠線を描画できない)
  if (textAlongPath) {
    [labelBgSw, labelBorderSw, labelBorderWInp].forEach(el => {
      if (!el) return;
      el.disabled = true;
      el.style.opacity = '0.4';
      el.style.cursor = 'not-allowed';
    });
    labelBgSw.title = 'テキスト背景色 (沿線回転 ON のときは使用されません)';
    labelBorderSw.title = 'テキスト枠線色 (沿線回転 ON のときは使用されません)';
    labelBorderWInp.title = 'テキスト枠線太さ (沿線回転 ON のときは使用されません)';
  }

  // --- Row 4: 沿線回転 / 自動反転 ---
  const lrow4 = fmt.makeRow({ wrap: true });
  const alongCb = tag('textAlongPath')(fmt.makeCheckbox({
    text: '沿線回転', title: '沿線回転', checked: textAlongPath, onChange: (on) => setField('textAlongPath', on),
  }));
  lrow4.appendChild(alongCb);
  const flipCb = tag('textAutoFlip')(fmt.makeCheckbox({
    text: '自動反転', title: '自動反転 (90〜270°で読みやすい向きへ)', checked: textAutoFlip, onChange: (on) => setField('textAutoFlip', on),
  }));
  if (!textAlongPath) flipCb.style.opacity = '0.4';
  lrow4.appendChild(flipCb);
  container.appendChild(lrow4);
  // textVisible=false の時、他のテキスト系項目全体の透明度を下げる (視覚的な非活性化)
  if (!textVisible) {
    [lrow3, lrow4].forEach(row => {
      [...row.children].forEach(el => { el.style.opacity = '0.4'; });
    });
  }

  // 「テキストをラインに合わせる」はボードツールバー（フィルタメニュー）の表示トグルへ移行
  // （D-4、計画書 §4-3-A）
  // リセットボタンは詳細パネルの style-row に移動 (2026-04-18)
}

function bdDepthStyleLabel(index, total) {
  const nextIndex = Math.max(0, index | 0);
  const count = Math.max(1, total | 0);
  if (nextIndex === count - 1) return `深さ${nextIndex}+`;
  return `深さ${nextIndex}`;
}

function bdDepthStyleDisplayName(style, index, total) {
  const custom = String(style?.name || '').trim();
  if (custom) return custom;
  return `階層 ${Math.max(0, index | 0) + 1}`;
}

function _bdDepthStyleTooltip(style, index, total) {
  const label = bdDepthStyleDisplayName(style, index, total) || bdDepthStyleLabel(index, total);
  const fontSize = Math.max(8, +style?.fontSize || 13);
  const width = Math.max(40, +style?.width || 160);
  return `${label}\n文字 ${fontSize}px / 幅 ${width}px`;
}

function _bdDepthStylePreviewHtml(style) {
  const cardHtml = _bdCardStylePreviewHtml({
    bgColor: style?.bgColor || '',
    textColor: style?.textColor || '',
    borderColor: style?.borderColor || '',
    borderWidth: Number.isFinite(+style?.borderWidth) ? +style.borderWidth : 0,
    borderRadius: Number.isFinite(+style?.borderRadius) ? +style.borderRadius : 8,
    fontBold: !!style?.fontBold,
    fontItalic: !!style?.fontItalic,
    fontFamily: style?.fontFamily || '',
    textStrokeColor: style?.textStrokeColor || '',
    textStrokeWidth: Number.isFinite(+style?.textStrokeWidth) ? +style.textStrokeWidth : 0,
    shape: style?.shape || '',
    cloudBumpWidth: Number.isFinite(+style?.cloudBumpWidth) ? +style.cloudBumpWidth : 40,
    cloudBumpHeight: Number.isFinite(+style?.cloudBumpHeight) ? +style.cloudBumpHeight : 16,
    cloudSideWidth: Number.isFinite(+style?.cloudSideWidth) ? +style.cloudSideWidth : 12,
    cloudOffset: Number.isFinite(+style?.cloudOffset) ? +style.cloudOffset : 0.5,
    cloudSubWidthRatio: Number.isFinite(+style?.cloudSubWidthRatio) ? +style.cloudSubWidthRatio : 0,
    cloudSubHeightRatio: Number.isFinite(+style?.cloudSubHeightRatio) ? +style.cloudSubHeightRatio : 0,
  }).replace('Aa', '深');
  // 階層間ラインのプレビューを横に並べる。style.line が空（未設定）でも既定の薄いラインは出す。
  const linePreviewStyle = {
    color: style?.line?.color || '',
    width: Number.isFinite(+style?.line?.width) && +style.line.width > 0 ? +style.line.width : 2,
    style: style?.line?.style || '',
    arrow: style?.line?.arrow || '',
    pathType: style?.line?.pathType || 'curve',
    fontFamily: style?.line?.fontFamily || '',
  };
  const lineHtml = _bdLineStylePreviewHtml(linePreviewStyle);
  return `<span class="bd-depth-preview-group"><span class="bd-depth-preview-swatch">${cardHtml}</span><span class="bd-depth-preview-swatch bd-depth-preview-line">${lineHtml}</span></span>`;
}

function _bdNextStyle(kind, styles) {
  const cardDefaults = typeof bdDefaultCardStylesForBoard === 'function'
    ? bdDefaultCardStylesForBoard(typeof bd !== 'undefined' ? bd : undefined)
    : BD_DEFAULT_CARD_STYLES;
  const lineDefaults = typeof bdDefaultLineStylesForBoard === 'function'
    ? bdDefaultLineStylesForBoard(typeof bd !== 'undefined' ? bd : undefined)
    : BD_DEFAULT_LINE_STYLES;
  const seed = kind === 'card' ? _bdClone(cardDefaults[0]) : _bdClone(lineDefaults[0]);
  const baseName = kind === 'card' ? '新しいカードスタイル' : '新しいラインスタイル';
  seed.name = _bdMakeUniqueStyleName(baseName, styles);
  seed.id = _bdNormalizeStyleId(`${kind}-style-${Date.now().toString(36)}`, `${kind}-style`);
  styles.push(seed);
  return seed;
}

function _bdApplyAllAutoStyles() {
  if (typeof bdApplyAutoStyle !== 'function') return;
  bd.nodes.filter(node => node._autoStyle).forEach(node => bdApplyAutoStyle(node.id));
}
/* gb-board-style-manager.part02.js: split from gb-board-style-manager.js */
// ============================================================
//  In-panel スタイル管理タブ & ドロップダウンポップアップ
// ============================================================

// ドロップダウンポップアップ (card/line 用)。ピッカー要素をアンカーにして
// 上または下にスタイル一覧 + アクションボタンを表示する。
let _bdStyleManagerPopup = null;
let _bdStyleManagerPopupAnchor = null;
let _bdStyleManagerPopupCloseHandler = null;
let _bdStyleManagerPopupDragId = null;
// 階層別スタイルタブで編集中の階層 index を保存する。
// bdRefreshSelectionDetails(true) → clearBoardDetailTabContent() でタブ DOM が
// 一旦空にされ、_bdEnsureBoardStyleManagerTabs() が再描画する際、selectedIndex を
// 渡さないと既定の 0 (階層1) に戻ってしまうため、UI 状態として保持する。
let _bdLastDepthEditIndex = 0;
// カードスタイル / ラインスタイルタブで編集中のスタイル id も同様に保存する。
// 何も選んでいない (= active) ときは null。selectedId 未指定時のフォールバックに使う。
let _bdLastCardEditId = null;
let _bdLastLineEditId = null;

function _bdSetStyleManagerPopupAnchorState(anchor, expanded) {
  if (!anchor?.setAttribute) return;
  anchor.setAttribute('aria-haspopup', 'dialog');
  anchor.setAttribute('aria-expanded', expanded ? 'true' : 'false');
}

function _bdCloseStyleManagerPopup(options) {
  const anchor = _bdStyleManagerPopupAnchor;
  _bdSetStyleManagerPopupAnchorState(anchor, false);
  _bdStyleManagerPopup?.remove();
  _bdStyleManagerPopup = null;
  _bdStyleManagerPopupAnchor = null;
  if (_bdStyleManagerPopupCloseHandler) {
    document.removeEventListener('pointerdown', _bdStyleManagerPopupCloseHandler);
    _bdStyleManagerPopupCloseHandler = null;
  }
  if (options?.restoreFocus) _bdFocusStyleManagerPopupAnchor(anchor);
}

function _bdConfigureStyleManagerPopup(popup, label, anchorEl) {
  if (!popup) return;
  popup.setAttribute('role', 'dialog');
  popup.setAttribute('aria-label', label);
  popup.setAttribute('aria-modal', 'false');
  popup.tabIndex = -1;
  _bdSetStyleManagerPopupAnchorState(anchorEl, true);
}

function _bdStyleManagerPopupItems(popup) {
  return [...(popup?.querySelectorAll?.('.bd-style-list-item') || [])]
    .filter(item => item.isConnected && item.offsetParent !== null);
}

function _bdMoveStyleManagerPopupFocus(popup, direction) {
  const items = _bdStyleManagerPopupItems(popup);
  if (!items.length) return;
  const currentIndex = items.indexOf(document.activeElement);
  const nextIndex = currentIndex < 0
    ? (direction > 0 ? 0 : items.length - 1)
    : (currentIndex + direction + items.length) % items.length;
  items[nextIndex].focus();
}

function _bdBindStyleManagerPopupKeys(popup, getAnchor) {
  if (!popup || popup.dataset.bdStyleManagerKeys === '1') return;
  popup.dataset.bdStyleManagerKeys = '1';
  popup.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      event.preventDefault();
      _bdCloseStyleManagerPopup({ restoreFocus: true });
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      const targetItem = event.target?.closest?.('.bd-style-list-item');
      if (targetItem || event.target === popup) {
        event.preventDefault();
        _bdMoveStyleManagerPopupFocus(popup, event.key === 'ArrowDown' ? 1 : -1);
      }
      return;
    }
    if ((event.key === 'Enter' || event.key === ' ') && event.target?.closest?.('.bd-style-list-item')) {
      event.preventDefault();
      event.target.closest('.bd-style-list-item')?.click();
    }
  });
  popup.addEventListener('focusout', () => {
    const anchor = typeof getAnchor === 'function' ? getAnchor() : _bdStyleManagerPopupAnchor;
    _bdSetStyleManagerPopupAnchorState(anchor, !!popup.isConnected);
  });
}

function _bdPrepareStyleManagerPopupControls(popup) {
  popup?.querySelectorAll?.('.bd-detail-style-action').forEach(button => {
    const label = button.getAttribute('aria-label') || button.getAttribute('title') || button.textContent.trim();
    if (label) button.setAttribute('aria-label', label);
  });
}

function _bdStyleManagerPopupCloseButtonHtml() {
  if (typeof meldexDropdownCloseButtonHtml === 'function') {
    return meldexDropdownCloseButtonHtml({ className: 'bd-detail-style-action bd-style-manager-popup-close', attr: 'data-bd-popup-close' });
  }
  const closeIcon = typeof lucide === 'function' ? lucide('x', 14) : 'x';
  return `<button type="button" class="bd-detail-style-action bd-style-manager-popup-close" data-bd-popup-close title="閉じる" aria-label="閉じる">${closeIcon}</button>`;
}

function _bdFocusStyleManagerPopupAnchor(resolveAnchor) {
  const focus = () => { const el = typeof resolveAnchor === 'function' ? resolveAnchor() : resolveAnchor; if (!el?.isConnected || typeof el.focus !== 'function') return; try { el.focus({ preventScroll: true }); } catch (_) { el.focus(); } };
  focus(); setTimeout(focus, 0); if (typeof requestAnimationFrame === 'function') requestAnimationFrame(focus);
}

function _bdClampStyleManagerPopupToViewport(popup) {
  if (!popup?.getBoundingClientRect) return;
  const margin = 4;
  const viewportWidth = document.documentElement.clientWidth || window.innerWidth || 0;
  const viewportHeight = document.documentElement.clientHeight || window.innerHeight || 0;
  if (!viewportWidth || !viewportHeight) return;

  let rect = popup.getBoundingClientRect();
  const maxVisibleHeight = Math.max(120, viewportHeight - margin * 2);
  for (let i = 0; i < 4 && rect.height > maxVisibleHeight + 1; i += 1) {
    const computedMax = parseFloat(getComputedStyle(popup).maxHeight || '');
    const currentLimit = Number.isFinite(computedMax) && computedMax > 0 ? computedMax : rect.height;
    const cssToVisualRatio = Number.isFinite(computedMax) && computedMax > 0
      ? computedMax / Math.max(1, rect.height)
      : 1;
    const nextLimit = Math.min(currentLimit, Math.max(120, maxVisibleHeight * cssToVisualRatio * 0.98));
    popup.style.maxHeight = nextLimit + 'px';
    popup.style.height = nextLimit + 'px';
    popup.style.overflowY = 'auto';
    rect = popup.getBoundingClientRect();
  }

  const maxVisibleWidth = Math.max(160, viewportWidth - margin * 2);
  for (let i = 0; i < 4 && rect.width > maxVisibleWidth + 1; i += 1) {
    const computedMax = parseFloat(getComputedStyle(popup).maxWidth || '');
    const currentLimit = Number.isFinite(computedMax) && computedMax > 0 ? computedMax : rect.width;
    const cssToVisualRatio = Number.isFinite(computedMax) && computedMax > 0
      ? computedMax / Math.max(1, rect.width)
      : 1;
    const nextLimit = Math.min(currentLimit, Math.max(160, maxVisibleWidth * cssToVisualRatio * 0.98));
    popup.style.maxWidth = nextLimit + 'px';
    popup.style.width = nextLimit + 'px';
    popup.style.overflowX = 'auto';
    rect = popup.getBoundingClientRect();
  }

  let left = rect.left;
  let top = rect.top;
  if (rect.right > viewportWidth - margin) left = Math.max(margin, viewportWidth - rect.width - margin);
  if (rect.bottom > viewportHeight - margin) top = Math.max(margin, viewportHeight - rect.height - margin);
  if (left < margin) left = margin;
  if (top < margin) top = margin;
  popup.style.left = left + 'px';
  popup.style.top = top + 'px';
}

function _bdPositionStyleManagerPopup(popup, anchorEl) {
  if (!popup || !anchorEl?.getBoundingClientRect) return;
  const rect = anchorEl.getBoundingClientRect();
  if (typeof positionPopup === 'function') {
    positionPopup(popup, rect, { prefer: 'below', gap: 4 });
    _bdClampStyleManagerPopupToViewport(popup);
    return;
  }
  const zoom = typeof _getZoom === 'function' ? _getZoom() : 1;
  popup.style.left = (rect.left / zoom) + 'px';
  popup.style.top = (rect.bottom / zoom + 4) + 'px';
  if (typeof clampPopupToViewport === 'function') clampPopupToViewport(popup);
  _bdClampStyleManagerPopupToViewport(popup);
}

// card / line 用のスタイル選択ポップアップ。
// - options.onSelect(styleId): 選択時にタブ側を再描画するコールバック
// - options.kind: 'card' | 'line'
// - options.currentId: 現在タブで表示されているスタイル ID
// - options.refreshAnchor(): 再描画後に最新のアンカー要素 (ピッカーボタン) を返す。
//   タブの full re-render で旧アンカーが DOM 切断されると getBoundingClientRect() が
//   全 0 を返してしまい、ポップアップが画面左上に飛ぶのを防ぐために使う。
function _bdOpenStyleManagerPopup(kind, anchorEl, options) {
  if (!anchorEl) return;
  if (_bdStyleManagerPopup) {
    const same = _bdStyleManagerPopupAnchor === anchorEl;
    _bdCloseStyleManagerPopup();
    if (same) return;
  }
  bdEnsureBoardUiState();
  const opts = options || {};
  let currentAnchor = anchorEl;
  const popup = document.createElement('div');
  popup.className = 'bd-style-manager-popup';
  document.body.appendChild(popup);
  _bdStyleManagerPopup = popup;
  _bdStyleManagerPopupAnchor = currentAnchor;
  _bdConfigureStyleManagerPopup(popup, `${kind === 'card' ? 'カード' : 'ライン'}スタイル管理`, currentAnchor);
  _bdBindStyleManagerPopupKeys(popup, () => typeof opts.refreshAnchor === 'function' ? (opts.refreshAnchor() || currentAnchor) : currentAnchor);

  const render = () => {
    const displayStyles = _bdDisplayedManagedStyles(kind);
    const activeRef = kind === 'card' ? 'activeCardStyle' : 'activeLineStyle';
    const activeStyleId = bd[activeRef] || '';
    const currentId = opts.currentId || activeStyleId;
    const itemLabel = kind === 'card' ? 'カードスタイル' : 'ラインスタイル';
    const plusIcon = typeof lucide === 'function' ? lucide('plus', 14) : '+';
    const copyIcon = typeof lucide === 'function' ? lucide('copy', 14) : '複製';
    const saveIcon = typeof lucide === 'function' ? lucide('save', 14) : '保存';
    const resetIcon = typeof lucide === 'function' ? lucide('rotateCcw', 14) : '戻す';
    const trashIcon = typeof lucide === 'function' ? lucide('trash2', 14) : '削除';
    const previewFn = kind === 'card' ? _bdCardStylePreviewHtml : _bdLineStylePreviewHtml;

    popup.innerHTML = `
      <div class="bd-style-manager-popup-list" role="listbox" aria-label="${_bdEscAttr(itemLabel)}一覧">
        ${displayStyles.map(style => `
          <div class="bd-style-list-item bd-style-list-item--draggable ${style.id === currentId ? 'active' : ''} ${style.id === activeStyleId ? 'is-applied' : ''}"
               data-bd-style-id="${_bdEscAttr(style.id)}" data-bd-style-item="${_bdEscAttr(style.id)}"
               draggable="true" tabindex="0" role="option" aria-selected="${style.id === currentId ? 'true' : 'false'}" aria-label="${_bdEscAttr(style.name || itemLabel)}">
            <span class="bd-style-list-handle" title="ドラッグして並べ替え">⋮⋮</span>
            <span class="bd-style-list-preview">${previewFn(style)}</span>
            <span class="bd-style-list-name">${esc(style.name)}</span>
            ${style.id === activeStyleId ? '<span class="bd-style-applied-mark" title="現在使用中">適用中</span>' : ''}
          </div>
        `).join('')}
      </div>
      <div class="bd-style-manager-popup-actions">
        <button type="button" class="bd-detail-style-action" data-bd-popup-add title="新しい${esc(itemLabel)}を追加" aria-label="新しい${esc(itemLabel)}を追加">${plusIcon}</button>
        <button type="button" class="bd-detail-style-action" data-bd-popup-duplicate title="複製" aria-label="複製">${copyIcon}</button>
        <button type="button" class="bd-detail-style-action" data-bd-popup-save title="現在の設定をデフォルトとして保存" aria-label="現在の設定をデフォルトとして保存">${saveIcon}</button>
        <button type="button" class="bd-detail-style-action" data-bd-popup-reset title="デフォルトに戻す" aria-label="デフォルトに戻す">${resetIcon}</button>
        <button type="button" class="bd-detail-style-action bd-detail-style-action--danger" data-bd-popup-delete title="削除" aria-label="削除" ${displayStyles.length <= 1 ? 'disabled' : ''}>${trashIcon}</button>
        ${_bdStyleManagerPopupCloseButtonHtml()}
      </div>`;

    // 位置決定: アンカーの下に出す (ピッカーが上部にあるので drop-down 優先)。
    // タブが re-render されて旧 anchor が DOM 切断されている場合は refreshAnchor で再取得し、
    // それでも取れなければ最後に有効だった矩形にフォールバックする。
    if (typeof opts.refreshAnchor === 'function') {
      const next = opts.refreshAnchor();
      if (next) {
        currentAnchor = next;
        _bdStyleManagerPopupAnchor = next;
      }
    }
    _bdPositionStyleManagerPopup(popup, currentAnchor);
    _bdSetStyleManagerPopupAnchorState(currentAnchor, true);
    _bdPrepareStyleManagerPopupControls(popup);

    // リスト項目クリックでアクティブ選択変更
    popup.querySelectorAll('[data-bd-style-id]').forEach(item => {
      item.addEventListener('click', () => {
        const id = item.dataset.bdStyleId;
        opts.currentId = id;
        if (typeof opts.onSelect === 'function') opts.onSelect(id);
        render();
      });
    });
    popup.querySelector('[data-bd-popup-close]')?.addEventListener('click', () => {
      _bdCloseStyleManagerPopup({ restoreFocus: true });
    });

    // D&D
    popup.querySelectorAll('[data-bd-style-item]').forEach(item => {
      item.addEventListener('dragstart', event => {
        _bdStyleManagerPopupDragId = item.dataset.bdStyleItem || null;
        item.classList.add('dragging');
        try { event.dataTransfer?.setData('text/plain', _bdStyleManagerPopupDragId || ''); } catch (_) {}
        if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
      });
      item.addEventListener('dragend', () => {
        _bdStyleManagerPopupDragId = null;
        popup.querySelectorAll('[data-bd-style-item]').forEach(el => el.classList.remove('dragging', 'drag-over'));
      });
      item.addEventListener('dragover', event => {
        if (!_bdStyleManagerPopupDragId) return;
        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
        item.classList.add('drag-over');
      });
      item.addEventListener('dragleave', () => { item.classList.remove('drag-over'); });
      item.addEventListener('drop', event => {
        event.preventDefault();
        item.classList.remove('drag-over');
        const draggedId = _bdStyleManagerPopupDragId;
        const targetId = item.dataset.bdStyleItem || '';
        _bdStyleManagerPopupDragId = null;
        if (!draggedId || !targetId || draggedId === targetId) return;
        const arr = kind === 'card' ? bd.cardStyles : bd.lineStyles;
        const fromIdx = arr.findIndex(s => s.id === draggedId);
        const toIdx = arr.findIndex(s => s.id === targetId);
        if (fromIdx < 0 || toIdx < 0) return;
        bdPushUndo();
        const [moved] = arr.splice(fromIdx, 1);
        const finalIdx = fromIdx < toIdx ? toIdx - 1 : toIdx;
        arr.splice(finalIdx, 0, moved);
        bdDirty();
        bdRender();
        bdRefreshBoardToolbar();
        if (typeof bdRefreshSelectionDetails === 'function') bdRefreshSelectionDetails(true);
        render();
        if (typeof opts.onListChange === 'function') opts.onListChange(draggedId);
      });
    });

    const liveArr = () => kind === 'card' ? bd.cardStyles : bd.lineStyles;
    const currentLive = () => liveArr().find(s => s.id === (opts.currentId || activeStyleId)) || liveArr()[0];

    popup.querySelector('[data-bd-popup-add]')?.addEventListener('click', () => {
      bdPushUndo();
      const next = _bdNextStyle(kind, liveArr());
      bdDirty();
      opts.currentId = next.id;
      bdRefreshBoardToolbar();
      if (typeof bdRefreshSelectionDetails === 'function') bdRefreshSelectionDetails(true);
      if (typeof opts.onSelect === 'function') opts.onSelect(next.id);
      render();
    });

    popup.querySelector('[data-bd-popup-duplicate]')?.addEventListener('click', () => {
      const arr = liveArr();
      const live = currentLive(); if (!live) return;
      bdPushUndo();
      const next = _bdClone(live);
      next.id = _bdNormalizeStyleId(`${live.id}-copy-${Date.now().toString(36)}`, `${kind}-style-copy`);
      next.name = _bdMakeUniqueStyleName(`${live.name} コピー`, arr);
      arr.push(next);
      bdDirty();
      opts.currentId = next.id;
      bdRefreshBoardToolbar();
      if (typeof bdRefreshSelectionDetails === 'function') bdRefreshSelectionDetails(true);
      if (typeof opts.onSelect === 'function') opts.onSelect(next.id);
      render();
    });

    popup.querySelector('[data-bd-popup-save]')?.addEventListener('click', () => {
      const live = currentLive(); if (!live) return;
      bdPushUndo();
      live._default = _bdCloneStyleForDefault(live);
      _bdSaveGlobalStyleDefault(kind, live);
      bdDirty();
      showStatus(`${kind === 'card' ? 'カード' : 'ライン'}スタイル「${live.name}」をデフォルトとして保存しました`, false, { showSaveDialog: true });
      render();
    });

    popup.querySelector('[data-bd-popup-reset]')?.addEventListener('click', () => {
      const live = currentLive(); if (!live) return;
      bdPushUndo();
      _bdResetStyleToDefault(kind, live);
      bdDirty();
      bdRender();
      bdRefreshBoardToolbar();
      if (typeof bdRefreshSelectionDetails === 'function') bdRefreshSelectionDetails(true);
      if (typeof opts.onSelect === 'function') opts.onSelect(live.id);
      render();
      showStatus(`${kind === 'card' ? 'カード' : 'ライン'}スタイル「${live.name}」をデフォルトに戻しました`);
    });

    popup.querySelector('[data-bd-popup-delete]')?.addEventListener('click', async () => {
      if (liveArr().length <= 1) return;
      const live = currentLive(); if (!live) return;
      const activeRefKey = kind === 'card' ? 'activeCardStyle' : 'activeLineStyle';
      const unitLabel = kind === 'card' ? 'カード' : 'ライン';
      const usage = _bdCountStyleUsage(kind, live.id);
      const usageMsg = usage > 0 ? `\n\nこのスタイルは ${usage} 個の${unitLabel}で使用中です。削除すると、それらは別のスタイルに切り替わります。` : '';
      const ok = typeof cfConfirm === 'function' ? await cfConfirm(`${kind === 'card' ? 'カード' : 'ライン'}スタイル「${live.name}」を削除しますか？${usageMsg}`) : true;
      if (!ok) return;
      const arr = liveArr();
      const liveIndex = arr.findIndex(style => style.id === live.id);
      if (liveIndex < 0) return;
      bdPushUndo();
      const removedId = arr[liveIndex].id;
      arr.splice(liveIndex, 1);
      _bdRemoveGlobalStyleDefault(kind, removedId);
      const remainingDisplay = _bdDisplayedManagedStyles(kind);
      const fallbackId = remainingDisplay[0]?.id || arr[0]?.id || '';
      if (bd[activeRefKey] === removedId) bd[activeRefKey] = fallbackId;
      if (kind === 'card') {
        (bd.nodes || []).forEach(node => { if (node && node.cardStyle === removedId) node.cardStyle = fallbackId; });
      } else {
        (bd.connections || []).forEach(conn => { if (conn && conn.styleRef === removedId) conn.styleRef = fallbackId; });
      }
      if (typeof _bdReplaceDeletedStyleRefsInDepthStyles === 'function') {
        _bdReplaceDeletedStyleRefsInDepthStyles(kind, removedId, fallbackId);
      }
      bdDirty();
      bdRender();
      bdRefreshBoardToolbar();
      if (typeof bdRefreshSelectionDetails === 'function') bdRefreshSelectionDetails(true);
      opts.currentId = fallbackId;
      if (typeof opts.onSelect === 'function') opts.onSelect(fallbackId);
      render();
      showStatus(`${kind === 'card' ? 'カード' : 'ライン'}スタイル「${live.name}」を削除しました`);
    });
  };

  render();

  setTimeout(() => {
    _bdStyleManagerPopupCloseHandler = event => {
      if (!_bdStyleManagerPopup) return;
      const anchor = _bdStyleManagerPopupAnchor || currentAnchor;
      if (!_bdStyleManagerPopup.contains(event.target) && !(anchor && anchor.contains(event.target))) {
        _bdCloseStyleManagerPopup();
      }
    };
    document.addEventListener('pointerdown', _bdStyleManagerPopupCloseHandler);
  }, 0);
}

// 指定 kind のスタイル管理をオプションパネルのタブ内にレンダリングする。
// 上部: ピッカーボタン (クリックでドロップダウンポップアップが開く: list + actions)
// 下部: 選択中スタイルの編集フィールド (左カラムの大きなプレビュー枠は廃止)
// mode === 'diff' はフィールド入力途中の再描画用。container.innerHTML を作り直すと
// 入力中の <input> がガベコレされ、フォーカスと IME 変換候補が飛ぶので、
// メタ・ピッカー表示だけを差分更新する。
// style 追加/削除/複製/reset やピッカー経由の選択変更時は 'full' で呼び、全再構築する。
function _bdRenderStyleManagerInPanel(kind, container, selectedId, mode) {
  if (!container) return;
  bdEnsureBoardUiState();
  const activeRef = kind === 'card' ? 'activeCardStyle' : 'activeLineStyle';
  const displayStyles = _bdDisplayedManagedStyles(kind);
  if (!displayStyles.length) {
    container.innerHTML = `<div class="bd-detail-hint">表示できるスタイルがありません。</div>`;
    return;
  }
  // selectedId 未指定時は、最後に編集していた id → active style → 先頭の順で採用する。
  // bdRefreshSelectionDetails(true) によるタブ再描画で active style へ強制復帰しないようにする。
  const lastIdRef = kind === 'card' ? _bdLastCardEditId : _bdLastLineEditId;
  const effectiveId = selectedId || lastIdRef || bd[activeRef] || displayStyles[0].id;
  const selected = displayStyles.find(s => s.id === effectiveId) || displayStyles[0];
  if (kind === 'card') _bdLastCardEditId = selected.id;
  else _bdLastLineEditId = selected.id;
  const itemLabel = kind === 'card' ? 'カードスタイル' : 'ラインスタイル';
  const unitLabel = kind === 'card' ? 'カード' : 'ライン';
  const activeStyleId = bd[activeRef] || '';
  const isSelectedActive = selected.id === activeStyleId;
  const usageCount = _bdCountStyleUsage(kind, selected.id);
  const previewFn = kind === 'card' ? _bdCardStylePreviewHtml : _bdLineStylePreviewHtml;
  const metaText = `${selected.name} ・ ${usageCount > 0 ? `${usageCount} 個の${unitLabel}が使用中` : `使用中の${unitLabel}なし`}${isSelectedActive ? ' ・ 現在使用中' : ''}`;
  const pickerLabelText = `${selected.name}${isSelectedActive ? ' (適用中)' : ''}`;
  const exportIcon = typeof lucide === 'function' ? lucide('download', 14) : '書出';

  if (mode === 'diff' && container.querySelector('[data-bd-style-in-panel]')) {
    const metaEl = container.querySelector('.bd-style-editor-meta');
    if (metaEl) metaEl.textContent = metaText;
    const pickerPreview = container.querySelector('.bd-style-picker-preview');
    if (pickerPreview) pickerPreview.innerHTML = previewFn(selected);
    const pickerLabel = container.querySelector('.bd-style-picker-label');
    if (pickerLabel) pickerLabel.textContent = pickerLabelText;
    const pickerBtn = container.querySelector('[data-bd-style-panel-picker]');
    if (pickerBtn) pickerBtn.dataset.bdCurrentStyleId = selected.id;
    return;
  }

  // プレビュードロップダウン (ピッカー) は最上部、編集フィールドはその下に。
  // 上段の大きなプレビュー枠は削除し、設定項目を縦 1 カラムで詰めて表示する。
  container.innerHTML = `
    <div class="bd-detail-panel bd-style-in-panel" data-bd-style-in-panel="${_bdEscAttr(kind)}">
      <div class="bd-detail-section">
        <div class="bd-detail-section-title">${esc(itemLabel)}一覧を開く</div>
        <button type="button" class="bd-style-panel-picker" data-bd-style-panel-picker="${_bdEscAttr(kind)}" data-bd-current-style-id="${_bdEscAttr(selected.id)}" aria-label="${esc(itemLabel)}一覧を開く" aria-haspopup="dialog" aria-expanded="false">
          <span class="bd-style-picker-preview">${previewFn(selected)}</span>
          <span class="bd-style-picker-label">${esc(pickerLabelText)}</span>
          <span class="bd-style-picker-caret" aria-hidden="true">▾</span>
        </button>
        <button type="button" class="bd-detail-style-action" data-e2e-id="bd-style-panel-export-board-styles" data-bd-style-panel-export-board-styles title="ボードスタイルを書き出し" aria-label="ボードスタイルを書き出し">${exportIcon}</button>
      </div>
      <div class="bd-detail-section">
        <div class="bd-detail-section-title">${esc(itemLabel)}</div>
        <div class="bd-style-editor-fields bd-style-editor-fields--fmt" data-bd-panel-fields></div>
        <div class="bd-style-editor-meta">${esc(metaText)}</div>
      </div>
    </div>`;

  const fieldsEl = container.querySelector('[data-bd-panel-fields]');
  // beforeEdit: bdEnsureBoardUiState / bdNormalize*Styles は呼び出しごとに bd.cardStyles /
  // bd.lineStyles を新配列 + 新オブジェクトへ差し替えるため、closure で掴んだ OLD selected は
  // 1 回目の diff 再レンダー後に orphan になる。2 回目以降のフィールド編集で OLD を
  // mutate すると mutation が bd.*Styles へ伝播せず失われる。毎回 ID から live な参照を
  // 取り直すことで、fields を再構築しない diff モードでも mutation が正しく保存される。
  _bdBuildStyleFields(fieldsEl, kind, selected, (field) => {
    const needsFullRebuild = typeof _bdStyleFieldNeedsFullRebuild === 'function'
      && _bdStyleFieldNeedsFullRebuild(kind, field);
    bdDirty();
    if (field === 'fontFamily') {
      if (typeof bdScheduleFontStyleMapUpdate === 'function') bdScheduleFontStyleMapUpdate();
    } else {
      bdRender();
    }
    _bdRenderStyleManagerInPanel(kind, container, selected.id, needsFullRebuild ? undefined : 'diff');
    bdRefreshBoardToolbar();
    if (typeof bdRefreshSelectionDetails === 'function') bdRefreshSelectionDetails(true);
  }, {
    e2eScope: `${kind}-panel-${selected.id}`,
    beforeEdit: () => {
      const arr = kind === 'card' ? bd.cardStyles : bd.lineStyles;
      return (arr || []).find(s => s.id === selected.id) || (arr || [])[0] || null;
    },
  });

  const pickerBtn = container.querySelector('[data-bd-style-panel-picker]');
  container.querySelector('[data-bd-style-panel-export-board-styles]')?.addEventListener('click', () => {
    if (typeof bdExportBoardStylePack === 'function') bdExportBoardStylePack();
    else if (typeof showStatus === 'function') showStatus('ボードスタイル書き出し機能を初期化できませんでした', true);
  });
  pickerBtn?.addEventListener('click', () => {
    _bdOpenStyleManagerPopup(kind, pickerBtn, {
      currentId: selected.id,
      onSelect: (styleId) => {
        _bdRenderStyleManagerInPanel(kind, container, styleId);
      },
      onListChange: (styleId) => {
        _bdRenderStyleManagerInPanel(kind, container, styleId);
      },
      // タブ再描画でピッカーボタンが新規 DOM に置き換わるため、ポップアップ
      // 位置計算前に最新の DOM を取り直す。これがないと旧ボタンの矩形 (0,0,0,0)
      // が使われてポップアップが画面左上に飛ぶ。
      refreshAnchor: () => container.querySelector('[data-bd-style-panel-picker]'),
    });
  });
  if (typeof bindMeldexDropdownKeySwitch === 'function') {
    bindMeldexDropdownKeySwitch(pickerBtn, {
      getItems: () => _bdDisplayedManagedStyles(kind).map(style => ({ value: style.id, style })),
      getCurrentValue: () => pickerBtn.dataset.bdCurrentStyleId || selected.id,
      onSelect: item => _bdRenderStyleManagerInPanel(kind, container, item.value),
      getFreshTrigger: () => container.querySelector('[data-bd-style-panel-picker]'),
    });
  }
}

function _bdDepthPickerLabel(style, index, total) {
  const name = typeof bdDepthStyleDisplayName === 'function'
    ? bdDepthStyleDisplayName(style, index, total)
    : `階層 ${Math.max(0, index | 0) + 1}`;
  const defaultText = style?.defaultText ? ` (${style.defaultText})` : '';
  return `${name}${defaultText}`;
}

function _bdStyleRefOptions(kind) {
  const styles = typeof _bdDisplayedManagedStyles === 'function'
    ? _bdDisplayedManagedStyles(kind)
    : (kind === 'card' ? (bd.cardStyles || []) : (bd.lineStyles || []));
  const label = kind === 'card' ? '個別カード設定' : '個別ライン設定';
  return [
    { v: '', l: label },
    ...(styles || []).map(style => ({ v: style.id || '', l: style.name || style.id || 'スタイル' })),
  ];
}

function _bdApplyStyleRefToDepth(depth, kind, styleId) {
  if (!depth) return;
  const id = String(styleId || '');
  if (kind === 'card') {
    depth.cardStyleRef = id;
    if (!id) return;
    const source = (bd.cardStyles || []).find(style => style && style.id === id);
    const snap = typeof _bdCloneStyleForDefault === 'function'
      ? _bdCloneStyleForDefault(source)
      : (source ? { ...source } : null);
    if (!snap) return;
    Object.keys(snap).forEach(key => { depth[key] = snap[key]; });
    return;
  }
  depth.lineStyleRef = id;
  if (!depth.line || typeof depth.line !== 'object') depth.line = {};
  if (!id) return;
  const source = (bd.lineStyles || []).find(style => style && style.id === id);
  const snap = typeof _bdCloneStyleForDefault === 'function'
    ? _bdCloneStyleForDefault(source)
    : (source ? { ...source } : null);
  if (!snap) return;
  Object.keys(snap).forEach(key => { depth.line[key] = snap[key]; });
}

function _bdReplaceDeletedStyleRefsInDepthStyles(kind, removedId, fallbackId) {
  if (!removedId || typeof bd === 'undefined') return;
  const key = kind === 'card' ? 'cardStyleRef' : 'lineStyleRef';
  (bd.depthStyles || []).forEach(depth => {
    if (!depth || depth[key] !== removedId) return;
    _bdApplyStyleRefToDepth(depth, kind, fallbackId || '');
  });
}

function _bdAppendDepthStyleRefRow(container, kind, selected, liveDepth, onApply) {
  const fmt = window.gbFmt;
  if (!container || !fmt) return;
  const row = fmt.makeRow({ wrap: true });
  row.classList.add('bd-depth-style-ref-row');
  const label = fmt.makeLabel(kind === 'card' ? '元カードスタイル' : '元ラインスタイル');
  const value = kind === 'card' ? (selected.cardStyleRef || '') : (selected.lineStyleRef || '');
  const select = fmt.makeSelect({
    opts: _bdStyleRefOptions(kind),
    value,
    onChange: (nextId) => {
      const live = typeof liveDepth === 'function' ? liveDepth() : selected;
      if (!live) return;
      if (typeof bdPushUndo === 'function') bdPushUndo();
      _bdApplyStyleRefToDepth(live, kind, nextId);
      if (typeof onApply === 'function') onApply();
    },
  });
  select.setAttribute('data-bd-depth-style-ref', kind);
  select.setAttribute('data-e2e-id', `bd-depth-${kind}-style-ref`);
  row.appendChild(label);
  row.appendChild(select);
  container.appendChild(row);
}

// 階層別スタイル用の in-panel 版。mode は _bdRenderStyleManagerInPanel と同じ役割で
// 'diff' のときは入力中のフォーカスを壊さないよう差分更新のみ行う。
function _bdRenderDepthStyleInPanel(container, selectedIndex, mode) {
  if (!container) return;
  if (typeof bdEnsureDepthStyles === 'function') bdEnsureDepthStyles();
  const styles = bd.depthStyles || [];
  if (!styles.length) {
    bd.depthStyles = typeof bdNormalizeDepthStyles === 'function' ? bdNormalizeDepthStyles([]) : [];
  }
  const liveStyles = () => bd.depthStyles || [];
  // selectedIndex 未指定時は、最後に編集していた階層 index を採用する。
  // これがないと bdRefreshSelectionDetails(true) で発生するタブ再描画のたびに
  // 0 (階層1) に戻ってしまい、ライン色等の編集中に「階層1に戻された」ように見える。
  const fallbackIdx = Number.isFinite(+_bdLastDepthEditIndex) ? +_bdLastDepthEditIndex : 0;
  const rawIdx = Number.isFinite(+selectedIndex) ? +selectedIndex : fallbackIdx;
  const idx = Math.max(0, Math.min(rawIdx, liveStyles().length - 1));
  _bdLastDepthEditIndex = idx;
  const selected = liveStyles()[idx] || liveStyles()[0];
  const previewHtml = _bdDepthStylePreviewHtml(selected);
  const pickerLabelText = _bdDepthPickerLabel(selected, idx, liveStyles().length);

  if (mode === 'diff' && container.querySelector('[data-bd-style-in-panel="depth"]')) {
    const pickerPreview = container.querySelector('.bd-style-picker-preview');
    if (pickerPreview) pickerPreview.innerHTML = previewHtml;
    const pickerLabel = container.querySelector('.bd-style-picker-label');
    if (pickerLabel) pickerLabel.textContent = pickerLabelText;
    const pickerBtn = container.querySelector('[data-bd-depth-panel-picker]');
    if (pickerBtn) pickerBtn.dataset.bdDepthCurrentIndex = String(idx);
    const nameInput = container.querySelector('[data-bd-depth-name]');
    if (nameInput && document.activeElement !== nameInput) nameInput.value = selected?.name || '';
    const cardRef = container.querySelector('[data-bd-depth-style-ref="card"]');
    if (cardRef && document.activeElement !== cardRef) cardRef.value = selected?.cardStyleRef || '';
    const lineRef = container.querySelector('[data-bd-depth-style-ref="line"]');
    if (lineRef && document.activeElement !== lineRef) lineRef.value = selected?.lineStyleRef || '';
    return;
  }

  // プレビュードロップダウン (ピッカー) は最上部、編集フィールドはその下に。
  // 上段の大きなプレビュー枠は削除し、設定項目を縦 1 カラムで詰めて表示する。
  container.innerHTML = `
    <div class="bd-detail-panel bd-style-in-panel bd-depth-in-panel" data-bd-style-in-panel="depth">
      <div class="bd-detail-section">
        <div class="bd-detail-section-title">階層一覧を開く</div>
        <div class="bd-detail-style-row">
          <button type="button" class="bd-style-panel-picker" data-bd-depth-panel-picker="depth" data-bd-depth-current-index="${idx}" aria-label="階層一覧を開く" aria-haspopup="dialog" aria-expanded="false">
            <span class="bd-style-picker-preview">${previewHtml}</span>
            <span class="bd-style-picker-label">${esc(pickerLabelText)}</span>
            <span class="bd-style-picker-caret" aria-hidden="true">▾</span>
          </button>
          <button type="button" class="bd-detail-style-action" data-bd-depth-apply-theme title="テーマカラーを階層別スタイルに適用">${typeof lucide === 'function' ? lucide('palette', 14) : '色'}</button>
        </div>
      </div>
      <div class="bd-detail-section">
        <div class="bd-detail-section-title">階層別スタイル</div>
        <div class="bd-style-editor-fields bd-style-editor-fields--fmt bd-depth-fields" data-bd-depth-fields></div>
      </div>
    </div>`;

  const depthFieldsEl = container.querySelector('[data-bd-depth-fields]');
  const applyDepthStyles = (options = {}) => {
    if (typeof bdNormalizeDepthStyles === 'function') bd.depthStyles = bdNormalizeDepthStyles(bd.depthStyles);
    if (!options.fontOnly) _bdApplyAllAutoStyles();
    bdDirty();
    if (options.fontOnly) {
      if (typeof bdScheduleFontStyleMapUpdate === 'function') bdScheduleFontStyleMapUpdate();
    } else {
      bdRender();
    }
    bdRefreshBoardToolbar();
    if (typeof bdRefreshSelectionDetails === 'function') bdRefreshSelectionDetails(true);
  };
  if (depthFieldsEl && selected && window.gbFmt) {
    const depthEmit = (styleKind, field) => {
      const needsFullRebuild = typeof _bdStyleFieldNeedsFullRebuild === 'function'
        && _bdStyleFieldNeedsFullRebuild(styleKind, field);
      applyDepthStyles({ fontOnly: field === 'fontFamily' });
      _bdRenderDepthStyleInPanel(container, idx, needsFullRebuild ? undefined : 'diff');
    };
    // bdNormalizeDepthStyles が applyDepthStyles の度に bd.depthStyles[idx] を新オブジェクトに
    // 差し替えるため、closure の selected / selected.line は 1 回目の diff 再レンダー後に orphan
    // となる。fields を再構築しない diff モードでは、beforeEdit で毎回 idx から live な参照を
    // 取り直さないと 2 回目以降のフィールド編集 mutation が保存されない。
    const liveDepth = () => (bd.depthStyles || [])[idx] || null;
    const fmt = window.gbFmt;

    const nameRow = document.createElement('div');
    nameRow.className = 'bd-style-name-row bd-depth-style-name-row';
    const nameLbl = document.createElement('span');
    nameLbl.className = 'gb-fmt-label';
    nameLbl.textContent = '階層別スタイル名';
    const nameInp = document.createElement('input');
    nameInp.type = 'text';
    nameInp.value = selected.name || '';
    nameInp.placeholder = `階層 ${idx + 1}`;
    nameInp.className = 'bd-style-name-input';
    nameInp.setAttribute('data-bd-depth-name', 'true');
    nameInp.setAttribute('data-e2e-id', `bd-depth-panel-${idx}-name`);
    nameInp.setAttribute('aria-label', '階層別スタイル名');
    nameInp.addEventListener('change', () => {
      const live = liveDepth();
      if (!live) return;
      const nextName = String(nameInp.value || '').trim();
      if ((live.name || '') === nextName) return;
      if (typeof bdPushUndo === 'function') bdPushUndo();
      live.name = nextName;
      depthEmit('', undefined);
    });
    nameRow.append(nameLbl, nameInp);
    depthFieldsEl.appendChild(nameRow);

    // カードスタイル部
    const cardHeader = document.createElement('div');
    cardHeader.className = 'bd-detail-section-title';
    cardHeader.textContent = 'カードスタイル';
    depthFieldsEl.appendChild(cardHeader);
    _bdAppendDepthStyleRefRow(depthFieldsEl, 'card', selected, liveDepth, () => {
      applyDepthStyles();
      _bdRenderDepthStyleInPanel(container, idx);
    });
    const cardFieldsWrap = document.createElement('div');
    cardFieldsWrap.className = 'bd-depth-style-field-group';
    depthFieldsEl.appendChild(cardFieldsWrap);
    _bdBuildStyleFields(cardFieldsWrap, 'card', selected, field => depthEmit('card', field), {
      hideName: true,
      e2eScope: `depth-panel-${idx}-card`,
      beforeEdit: liveDepth,
    });

    // デフォルトテキスト
    const defRow = fmt.makeRow({ wrap: true });
    const defInput = document.createElement('input');
    defInput.type = 'text';
    defInput.value = selected.defaultText != null ? selected.defaultText : 'カード';
    defInput.placeholder = 'カード追加時に自動で入る文字';
    defInput.title = '新規カード追加時のテキスト';
    defInput.style.cssText = 'flex:1;min-width:160px;padding:3px 6px;background:var(--bg);color:var(--fg);border:1px solid var(--border);border-radius:3px;font-size:12px;';
    defInput.addEventListener('change', () => {
      if (typeof bdPushUndo === 'function') bdPushUndo();
      // 同じく orphan 回避のため、書き込み直前に live 参照を取り直す。
      const live = liveDepth();
      if (live) live.defaultText = defInput.value;
      depthEmit('', undefined);
    });
    defRow.appendChild(fmt.makeLabel('デフォルトテキスト'));
    defRow.appendChild(defInput);
    depthFieldsEl.appendChild(defRow);

    // ラインスタイル部
    const lineHeader = document.createElement('div');
    lineHeader.className = 'bd-detail-section-title';
    lineHeader.style.marginTop = '12px';
    lineHeader.textContent = 'ラインスタイル（この階層のカードから出るライン）';
    depthFieldsEl.appendChild(lineHeader);
    _bdAppendDepthStyleRefRow(depthFieldsEl, 'line', selected, liveDepth, () => {
      applyDepthStyles();
      _bdRenderDepthStyleInPanel(container, idx);
    });
    if (!selected.line || typeof selected.line !== 'object') {
      selected.line = { color: '', width: 2, style: '', arrow: 'end', pathType: 'curve' };
    }
    const lineFieldsWrap = document.createElement('div');
    lineFieldsWrap.className = 'bd-depth-style-field-group';
    depthFieldsEl.appendChild(lineFieldsWrap);
    _bdBuildStyleFields(lineFieldsWrap, 'line', selected.line, field => depthEmit('line', field), {
      hideName: true,
      e2eScope: `depth-panel-${idx}-line`,
      beforeEdit: () => {
        const live = liveDepth();
        if (!live) return null;
        if (!live.line || typeof live.line !== 'object') {
          live.line = { color: '', width: 2, style: '', arrow: 'end', pathType: 'curve' };
        }
        return live.line;
      },
    });
  }

  const pickerBtn = container.querySelector('[data-bd-depth-panel-picker]');
  pickerBtn?.addEventListener('click', () => {
    _bdOpenDepthStyleManagerPopup(pickerBtn, {
      currentIndex: idx,
      onSelect: (nextIdx) => {
        _bdLastDepthEditIndex = Math.max(0, Math.min(+nextIdx || 0, (bd.depthStyles || []).length - 1));
        _bdRenderDepthStyleInPanel(container, nextIdx);
      },
      // タブ再描画でピッカーボタンが新規 DOM に置き換わるため、ポップアップ
      // 位置計算前に最新の DOM を取り直す。これがないと旧ボタンの矩形 (0,0,0,0)
      // が使われてポップアップが画面左上に飛ぶ。
      refreshAnchor: () => container.querySelector('[data-bd-depth-panel-picker]'),
    });
  });
  container.querySelector('[data-bd-depth-apply-theme]')?.addEventListener('click', () => {
    if (typeof bdApplyThemeColorsToDepthStyles !== 'function') return;
    if (typeof bdPushUndo === 'function') bdPushUndo();
    bdApplyThemeColorsToDepthStyles({ applyLineColor: true });
    applyDepthStyles();
    _bdRenderDepthStyleInPanel(container, idx);
    if (typeof showStatus === 'function') showStatus('テーマカラーを階層別スタイルに適用しました');
  });
  if (typeof bindMeldexDropdownKeySwitch === 'function') {
    bindMeldexDropdownKeySwitch(pickerBtn, {
      getItems: () => (bd.depthStyles || []).map((style, index) => ({ value: String(index), style })),
      getCurrentValue: () => pickerBtn.dataset.bdDepthCurrentIndex || String(idx),
      onSelect: (_item, nextIndex) => _bdRenderDepthStyleInPanel(container, nextIndex),
      getFreshTrigger: () => container.querySelector('[data-bd-depth-panel-picker]'),
    });
  }
}

// 階層別スタイル用のポップアップ (list + add/save/reset/delete アクション)。
let _bdDepthStyleDragIndex = -1;
function _bdOpenDepthStyleManagerPopup(anchorEl, options) {
  if (!anchorEl) return;
  if (_bdStyleManagerPopup) {
    const same = _bdStyleManagerPopupAnchor === anchorEl;
    _bdCloseStyleManagerPopup();
    if (same) return;
  }
  if (typeof bdEnsureDepthStyles === 'function') bdEnsureDepthStyles();
  const opts = options || {};
  let currentAnchor = anchorEl;
  const popup = document.createElement('div');
  popup.className = 'bd-style-manager-popup bd-depth-manager-popup';
  document.body.appendChild(popup);
  _bdStyleManagerPopup = popup;
  _bdStyleManagerPopupAnchor = currentAnchor;
  _bdConfigureStyleManagerPopup(popup, '階層別スタイル管理', currentAnchor);
  _bdBindStyleManagerPopupKeys(popup, () => typeof opts.refreshAnchor === 'function' ? (opts.refreshAnchor() || currentAnchor) : currentAnchor);

  const applyDepthStyles = (renderCb) => {
    if (typeof bdNormalizeDepthStyles === 'function') bd.depthStyles = bdNormalizeDepthStyles(bd.depthStyles);
    _bdApplyAllAutoStyles();
    bdDirty();
    bdRender();
    bdRefreshBoardToolbar();
    if (typeof bdRefreshSelectionDetails === 'function') bdRefreshSelectionDetails(true);
    if (typeof renderCb === 'function') renderCb();
  };

  const render = () => {
    const styles = bd.depthStyles || [];
    let currentIndex = Math.max(0, Math.min(Number.isFinite(+opts.currentIndex) ? +opts.currentIndex : 0, styles.length - 1));
    const plusIcon = typeof lucide === 'function' ? lucide('plus', 14) : '+';
    const saveIcon = typeof lucide === 'function' ? lucide('save', 14) : '保存';
    const resetIcon = typeof lucide === 'function' ? lucide('rotateCcw', 14) : '戻す';
    const trashIcon = typeof lucide === 'function' ? lucide('trash2', 14) : '削除';
    const paletteIcon = typeof lucide === 'function' ? lucide('palette', 14) : '色';

    popup.innerHTML = `
      <div class="bd-style-manager-popup-list" role="listbox" aria-label="階層別スタイル一覧">
        ${styles.map((style, i) => {
          const tooltip = _bdEscAttr(_bdDepthStyleTooltip(style, i, styles.length));
          return `<div class="bd-style-list-item bd-depth-style-item ${i === currentIndex ? 'active' : ''}" data-bd-depth-select="${i}" data-bd-depth-item="${i}" draggable="true" tabindex="0" role="option" aria-selected="${i === currentIndex ? 'true' : 'false'}" title="${tooltip}" aria-label="${tooltip}">
            <span class="bd-style-list-handle" title="ドラッグして並べ替え">⋮⋮</span>
            <span class="bd-style-list-preview">${_bdDepthStylePreviewHtml(style)}</span>
            <span class="bd-style-list-name">${esc(typeof bdDepthStyleDisplayName === 'function' ? bdDepthStyleDisplayName(style, i, styles.length) : `階層 ${i + 1}`)}</span>
          </div>`;
        }).join('')}
      </div>
      <div class="bd-style-manager-popup-actions">
        <button type="button" class="bd-detail-style-action" data-bd-popup-depth-add title="階層を追加" aria-label="階層を追加">${plusIcon}</button>
        <button type="button" class="bd-detail-style-action" data-bd-popup-depth-theme title="テーマカラーを階層別スタイルに適用" aria-label="テーマカラーを階層別スタイルに適用">${paletteIcon}</button>
        <button type="button" class="bd-detail-style-action" data-bd-popup-depth-save title="現在の階層別スタイル一式を全ボード共通のデフォルトとして保存" aria-label="現在の階層別スタイル一式を全ボード共通のデフォルトとして保存">${saveIcon}</button>
        <button type="button" class="bd-detail-style-action" data-bd-popup-depth-reset title="保存したデフォルトに戻す (未保存ならビルトイン初期値)" aria-label="保存したデフォルトに戻す">${resetIcon}</button>
        <button type="button" class="bd-detail-style-action bd-detail-style-action--danger" data-bd-popup-depth-delete title="削除" aria-label="削除" ${styles.length <= 1 ? 'disabled' : ''}>${trashIcon}</button>
        ${_bdStyleManagerPopupCloseButtonHtml()}
      </div>`;

    if (typeof opts.refreshAnchor === 'function') {
      const next = opts.refreshAnchor();
      if (next) {
        currentAnchor = next;
        _bdStyleManagerPopupAnchor = next;
      }
    }
    _bdPositionStyleManagerPopup(popup, currentAnchor);
    _bdSetStyleManagerPopupAnchorState(currentAnchor, true);
    _bdPrepareStyleManagerPopupControls(popup);

    popup.querySelectorAll('[data-bd-depth-select]').forEach(item => {
      item.addEventListener('click', () => {
        const i = parseInt(item.dataset.bdDepthSelect, 10) || 0;
        opts.currentIndex = i;
        if (typeof opts.onSelect === 'function') opts.onSelect(i);
        render();
      });
    });
    popup.querySelector('[data-bd-popup-close]')?.addEventListener('click', () => {
      _bdCloseStyleManagerPopup({ restoreFocus: true });
    });

    popup.querySelectorAll('[data-bd-depth-item]').forEach(item => {
      item.addEventListener('dragstart', () => {
        _bdDepthStyleDragIndex = parseInt(item.dataset.bdDepthItem, 10);
        item.classList.add('dragging');
      });
      item.addEventListener('dragend', () => {
        _bdDepthStyleDragIndex = -1;
        popup.querySelectorAll('[data-bd-depth-item]').forEach(el => el.classList.remove('dragging', 'drag-over'));
      });
      item.addEventListener('dragover', event => { event.preventDefault(); item.classList.add('drag-over'); });
      item.addEventListener('dragleave', () => item.classList.remove('drag-over'));
      item.addEventListener('drop', event => {
        event.preventDefault();
        item.classList.remove('drag-over');
        const targetIndex = parseInt(item.dataset.bdDepthItem, 10);
        if (!Number.isFinite(_bdDepthStyleDragIndex) || !Number.isFinite(targetIndex)) return;
        const arr = bd.depthStyles || [];
        if (_bdDepthStyleDragIndex === targetIndex || _bdDepthStyleDragIndex < 0 || targetIndex < 0) return;
        if (typeof bdPushUndo === 'function') bdPushUndo();
        const [moved] = arr.splice(_bdDepthStyleDragIndex, 1);
        const finalIndex = _bdDepthStyleDragIndex < targetIndex ? targetIndex - 1 : targetIndex;
        arr.splice(finalIndex, 0, moved);
        opts.currentIndex = finalIndex;
        if (typeof opts.onSelect === 'function') opts.onSelect(finalIndex);
        applyDepthStyles(render);
      });
    });

    popup.querySelector('[data-bd-popup-depth-add]')?.addEventListener('click', () => {
      const styles2 = bd.depthStyles || [];
      const last = styles2[styles2.length - 1] || { fontSize: 13, fontBold: false, width: 160, bgColor: '' };
      if (typeof bdPushUndo === 'function') bdPushUndo();
      const next = _bdClone(last);
      const baseName = (last && last.name) ? `${last.name} 2` : `階層 ${styles2.length + 1}`;
      next.name = typeof _bdMakeUniqueStyleName === 'function'
        ? _bdMakeUniqueStyleName(baseName, styles2)
        : baseName;
      bd.depthStyles.push(next);
      opts.currentIndex = bd.depthStyles.length - 1;
      if (typeof opts.onSelect === 'function') opts.onSelect(opts.currentIndex);
      applyDepthStyles(render);
    });

    popup.querySelector('[data-bd-popup-depth-theme]')?.addEventListener('click', () => {
      if (typeof bdApplyThemeColorsToDepthStyles !== 'function') return;
      if (typeof bdPushUndo === 'function') bdPushUndo();
      bdApplyThemeColorsToDepthStyles({ applyLineColor: true });
      opts.currentIndex = currentIndex;
      if (typeof opts.onSelect === 'function') opts.onSelect(currentIndex);
      applyDepthStyles(render);
      if (typeof showStatus === 'function') showStatus('テーマカラーを階層別スタイルに適用しました');
    });

    popup.querySelector('[data-bd-popup-depth-delete]')?.addEventListener('click', async () => {
      if ((bd.depthStyles || []).length <= 1) return;
      const deleteIndex = Math.max(0, Math.min(Number.isFinite(+opts.currentIndex) ? +opts.currentIndex : 0, bd.depthStyles.length - 1));
      const target = bd.depthStyles[deleteIndex] || {};
      const label = typeof bdDepthStyleDisplayName === 'function'
        ? bdDepthStyleDisplayName(target, deleteIndex, bd.depthStyles.length)
        : (target.name || `階層 ${deleteIndex + 1}`);
      const ok = typeof cfConfirm === 'function'
        ? await cfConfirm(`階層別スタイル「${label}」を削除しますか？`)
        : (typeof confirm === 'function' ? confirm(`階層別スタイル「${label}」を削除しますか？`) : true);
      if (!ok) return;
      if (typeof bdPushUndo === 'function') bdPushUndo();
      bd.depthStyles.splice(deleteIndex, 1);
      opts.currentIndex = Math.max(0, Math.min(deleteIndex, bd.depthStyles.length - 1));
      if (typeof opts.onSelect === 'function') opts.onSelect(opts.currentIndex);
      applyDepthStyles(render);
    });

    popup.querySelector('[data-bd-popup-depth-save]')?.addEventListener('click', () => {
      if (typeof bdPushUndo === 'function') bdPushUndo();
      const snapshot = typeof bdNormalizeDepthStyles === 'function'
        ? bdNormalizeDepthStyles(bd.depthStyles)
        : (bd.depthStyles || []).slice();
      _bdSaveGlobalDepthStyles(snapshot);
      showStatus('階層別スタイルをデフォルトとして保存しました', false, { showSaveDialog: true });
    });

    popup.querySelector('[data-bd-popup-depth-reset]')?.addEventListener('click', () => {
      if (typeof bdPushUndo === 'function') bdPushUndo();
      const global = _bdReadGlobalDepthStyles();
      const globalIsLegacy = typeof _bdIsLegacyDefaultDepthStyles === 'function' && _bdIsLegacyDefaultDepthStyles(global);
      if (Array.isArray(global) && global.length && !globalIsLegacy) {
        bd.depthStyles = typeof bdNormalizeDepthStyles === 'function' ? bdNormalizeDepthStyles(global) : global.slice();
        showStatus('保存したデフォルトに戻しました');
      } else {
        bd.depthStyles = typeof bdNormalizeDepthStyles === 'function' ? bdNormalizeDepthStyles([]) : [];
        showStatus('デフォルトは未保存のため、ビルトイン初期値に戻しました');
      }
      opts.currentIndex = 0;
      if (typeof opts.onSelect === 'function') opts.onSelect(0);
      applyDepthStyles(render);
    });
  };

  render();
  setTimeout(() => {
    _bdStyleManagerPopupCloseHandler = event => {
      if (!_bdStyleManagerPopup) return;
      const anchor = _bdStyleManagerPopupAnchor || currentAnchor;
      if (!_bdStyleManagerPopup.contains(event.target) && !(anchor && anchor.contains(event.target))) {
        _bdCloseStyleManagerPopup();
      }
    };
    document.addEventListener('pointerdown', _bdStyleManagerPopupCloseHandler);
  }, 0);
}

// 旧モーダルは廃止し、オプションパネルの階層別スタイルタブに切り替える (コミットC)。
// window._bdPendingDepthStyleIndex が明示的に指定されていればそのインデックスを初期選択として
// タブを再描画する。未指定の場合は現在の描画状態を尊重し、強制的にインデックス 0 へリセットしない。
function bdOpenDepthStyleManager() {
  if (typeof bdEnsureDepthStyles === 'function') bdEnsureDepthStyles();
  if (typeof _bdEnsureBoardStyleManagerTabs === 'function') _bdEnsureBoardStyleManagerTabs();
  if (typeof showBoardTabs === 'function') showBoardTabs({ depthStyle: true });
  const pendingIndex = Number.isInteger(window?._bdPendingDepthStyleIndex) ? window._bdPendingDepthStyleIndex : null;
  window._bdPendingDepthStyleIndex = null;
  const el = document.getElementById('detail-tab-board-depth-style');
  if (el && typeof _bdRenderDepthStyleInPanel === 'function') {
    if (pendingIndex !== null) {
      // 呼び出し側が明示的に index を指定 → その階層を初期選択にして再描画
      _bdRenderDepthStyleInPanel(el, pendingIndex);
    } else if (el.childElementCount === 0) {
      // 初回レンダー時のみインデックス 0 で描画。既に描画済みの場合は現在の選択を保つ。
      _bdRenderDepthStyleInPanel(el, 0);
    }
  }
  if (typeof switchDetailTab === 'function') switchDetailTab('board-depth-style');
}

// 旧モーダルは廃止し、オプションパネルのカードスタイルタブに切り替える (コミットC)。
// タブコンテンツは _bdEnsureBoardStyleManagerTabs() 経由で _bdRenderStyleManagerInPanel が描画する。
function bdOpenCardStyleManager() {
  bdEnsureBoardUiState();
  if (typeof _bdEnsureBoardStyleManagerTabs === 'function') _bdEnsureBoardStyleManagerTabs();
  if (typeof showBoardTabs === 'function') showBoardTabs({ cardStyle: true });
  if (typeof switchDetailTab === 'function') switchDetailTab('board-card-style');
}

function bdOpenLineStyleManager() {
  bdEnsureBoardUiState();
  if (typeof _bdEnsureBoardStyleManagerTabs === 'function') _bdEnsureBoardStyleManagerTabs();
  if (typeof showBoardTabs === 'function') showBoardTabs({ lineStyle: true });
  if (typeof switchDetailTab === 'function') switchDetailTab('board-line-style');
}

function bdOpenFilterMenu(anchor) {
  if (typeof bdEnsureBoardUiState === 'function') bdEnsureBoardUiState();
  bdCloseStylePicker();
  document.querySelectorAll('.gb-context-menu').forEach(menu => menu.remove());
  const menu = document.createElement('div');
  menu.className = 'gb-context-menu';
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', 'ボード表示フィルタ');
  menu.style.cssText = 'position:fixed;z-index:10000;';
  const rect = anchor.getBoundingClientRect();
  anchor.setAttribute('aria-haspopup', 'menu');
  anchor.setAttribute('aria-expanded', 'true');
  let closeHandler = null;
  const closeMenu = (restoreFocus = false) => {
    menu.remove();
    anchor.setAttribute('aria-expanded', 'false');
    if (closeHandler) {
      document.removeEventListener('pointerdown', closeHandler);
      closeHandler = null;
    }
    if (restoreFocus && typeof focusMeldexDropdownTrigger === 'function') focusMeldexDropdownTrigger(anchor);
  };
  const prepareToggleRow = (row, checked) => {
    row.className = 'gb-context-menu-item';
    row.tabIndex = 0;
    row.setAttribute('role', 'menuitemcheckbox');
    row.setAttribute('aria-checked', checked ? 'true' : 'false');
    row.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        row.click();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        closeMenu(true);
      }
    });
  };
  menu.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeMenu(true);
    }
  });
  // 表示フィルタ: 既定 true / OFF で非表示
  const labels = {
    showConnections: 'ライン',
    showConnLabels: 'ラインテキスト',
    showStatus: 'ステータス',
    showProgress: '進捗バー',
    showMarkers: 'マーカー',
    showNotes: 'ノート印',
    showLinkBadges: 'リンク印',
    showMenuButtons: '... ボタン',
    showImageNames: '画像ファイル名',
  };
  Object.entries(labels).forEach(([key, label]) => {
    const row = document.createElement('div');
    const checked = bd.displayFilters[key] !== false;
    prepareToggleRow(row, checked);
    row.innerHTML = `${radioMark(checked)}${esc(label)}`;
    row.addEventListener('click', () => {
      bd.displayFilters[key] = !(bd.displayFilters[key] !== false);
      closeMenu(true);
      bdRender();
      bdDirty();
    });
    menu.appendChild(row);
  });
  // 表示モード: 既定 false / ON で有効（計画書 §4-3-A）
  const modes = [
    { key: '_showShadow', label: 'カード影' },
    { key: '_textRotateOnLine', label: 'ライン上テキスト回転' },
  ];
  modes.forEach(({ key, label }) => {
    const row = document.createElement('div');
    const checked = !!bd[key];
    prepareToggleRow(row, checked);
    row.innerHTML = `${radioMark(checked)}${esc(label)}`;
    row.addEventListener('click', () => {
      bd[key] = !bd[key];
      closeMenu(true);
      bdRender();
      bdDirty();
    });
    menu.appendChild(row);
  });
  const relationSep = document.createElement('div');
  relationSep.className = 'bd-cm-sep';
  menu.appendChild(relationSep);
  {
    const key = 'highlightParentChildGroups';
    const row = document.createElement('div');
    const checked = bd.displayFilters[key] === true;
    prepareToggleRow(row, checked);
    row.innerHTML = `${radioMark(checked)}${esc('親子関係ハイライト')}`;
    row.addEventListener('click', () => {
      bd.displayFilters[key] = bd.displayFilters[key] !== true;
      closeMenu(true);
      bdRender();
      bdDirty();
    });
    menu.appendChild(row);
  }
  document.body.appendChild(menu);
  if (typeof attachMeldexDropdownCloseButton === 'function') {
    attachMeldexDropdownCloseButton(menu, {
      trigger: anchor,
      close: () => closeMenu(false),
    });
  }
  if (typeof positionPopup === 'function') positionPopup(menu, rect);
  else {
    const z = typeof _getZoom === 'function' ? _getZoom() : 1;
    menu.style.left = (rect.left / z) + 'px';
    menu.style.top = (rect.bottom / z + 4) + 'px';
    if (typeof clampPopupToViewport === 'function') clampPopupToViewport(menu);
  }
  setTimeout(() => {
    closeHandler = event => {
      if (!menu.contains(event.target)) {
        closeMenu(false);
      }
    };
    document.addEventListener('pointerdown', closeHandler);
  }, 0);
  requestAnimationFrame(() => {
    if (menu.isConnected) menu.querySelector('.gb-context-menu-item')?.focus?.();
  });
}
