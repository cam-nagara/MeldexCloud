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

window.addEventListener('meldex:font-catalog-updated', () => {
  document.querySelectorAll('select.bd-font-family-select').forEach(select => {
    select._gbFmtSetOptions?.(_bdFontFamilyOptions(), select._gbFmtSelectedValue ?? select.value);
  });
});

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
  _bdRenderKeepingDetailTab();
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
  _bdRenderKeepingDetailTab();
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
  _bdRenderKeepingDetailTab();
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
  if (typeof _bdRenderKeepingDetailTab === 'function') _bdRenderKeepingDetailTab();
  bdDirty();
  if (typeof bdRefreshSelectionDetails === 'function') bdRefreshSelectionDetails(true);
  showStatus(copied > 0
    ? `カードスタイル「${style.name}」をデフォルトとして保存しました (同じスタイルの他のトピックにも反映)`
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
      fontFamilySel.classList.add('bd-font-family-select');
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
