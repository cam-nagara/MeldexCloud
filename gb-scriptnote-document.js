/* gb-scriptnote-document.js: シナリオ文書の正規化・旧データ移行・直列化 */

const SCRIPTNOTE_DEFAULT_LAYOUT_MODE = 'manga';
const SCRIPTNOTE_SCHEMA_VERSION = 3;
const SCRIPTNOTE_LEGACY_PAGE_BREAK_BY_MODE = {
  manga: ['めくり', '改ページ', '柱'],
  drama: ['シーン見出し', '場面転換', '柱'],
  afureko: ['シーン見出し', '場面転換', 'Aパート', 'Bパート', 'Cパート', '柱'],
  stage: ['第一幕', '第二幕', '第三幕', '場', '柱'],
};
const SCRIPTNOTE_LEGACY_SUMMARY_NAMES = ['プロット'];
const SCRIPTNOTE_DEFAULT_TYPE_BG = '#333333';

function _scriptNotePlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function _scriptNoteRoleModel() {
  return typeof globalThis !== 'undefined' ? globalThis.GBScriptNoteRoleModel : null;
}

function _scriptNoteLayoutOrDefault(layout) {
  if (typeof _scriptNoteNormalizeLayout === 'function') return _scriptNoteNormalizeLayout(layout);
  return ['manga', 'drama', 'afureko', 'stage'].includes(layout) ? layout : SCRIPTNOTE_DEFAULT_LAYOUT_MODE;
}

function _scriptNoteNormalizeRows(rows, now) {
  const normalized = Array.isArray(rows) ? rows.map((row, index) => {
    const item = _scriptNotePlainObject(row);
    return {
      ...item,
      id: item.id || `sn-${now}-${index}`,
      role: String(item.role || ''),
      ...(item.roleRef && typeof item.roleRef === 'object'
        ? { roleRef: { ...item.roleRef } }
        : (!item.role ? { roleRef: { kind: 'none', id: 'none' } } : {})),
      status: String(item.status || ''),
      text: String(item.text || ''),
      columns: _scriptNotePlainObject(item.columns),
    };
  }) : [];
  if (normalized.length) return normalized;
  return [{
    id: `sn-${now}-0`,
    role: '',
    roleRef: { kind: 'none', id: 'none' },
    status: '',
    text: '',
    columns: {},
  }];
}

function createScriptNoteDefaultType() {
  return {
    isTypeDefault: true,
    name: '',
    gutter2Style: { bgColor: SCRIPTNOTE_DEFAULT_TYPE_BG },
    roleStyle: { bgColor: SCRIPTNOTE_DEFAULT_TYPE_BG },
    textStyle: { bgColor: SCRIPTNOTE_DEFAULT_TYPE_BG },
  };
}

function createScriptNoteNoneType() {
  return {
    isRoleNone: true,
    name: '',
    gutterStyle: { bgColor: 'transparent' },
    gutter2Style: { bgColor: 'transparent' },
  };
}

function ensureScriptNoteNoneType(editor) {
  const target = _scriptNotePlainObject(editor);
  let current = _scriptNotePlainObject(target.noneType);
  if (current !== target.noneType) {
    current = createScriptNoteNoneType();
    target.noneType = current;
  }
  current.isRoleNone = true;
  current.name = '';
  ['gutterStyle', 'gutter2Style'].forEach((key) => {
    let style = _scriptNotePlainObject(current[key]);
    if (style !== current[key]) {
      style = {};
      current[key] = style;
    }
    if (!Object.prototype.hasOwnProperty.call(style, 'bgColor')) style.bgColor = 'transparent';
  });
  return current;
}

function ensureScriptNoteDefaultType(editor) {
  const target = _scriptNotePlainObject(editor);
  let current = _scriptNotePlainObject(target.defaultType);
  if (current !== target.defaultType) {
    current = createScriptNoteDefaultType();
    target.defaultType = current;
  }
  // 書式ポップアップはこのオブジェクトを参照したまま Undo スナップショットを
  // 作るため、正規化時に参照を差し替えず同じオブジェクトを更新する。
  current.isTypeDefault = true;
  current.name = '';
  let roleStyle = _scriptNotePlainObject(current.roleStyle);
  if (roleStyle !== current.roleStyle) {
    roleStyle = {};
    current.roleStyle = roleStyle;
  }
  let textStyle = _scriptNotePlainObject(current.textStyle);
  if (textStyle !== current.textStyle) {
    textStyle = {};
    current.textStyle = textStyle;
  }
  let gutter2Style = _scriptNotePlainObject(current.gutter2Style);
  if (gutter2Style !== current.gutter2Style) {
    gutter2Style = {};
    current.gutter2Style = gutter2Style;
  }
  if (!Object.prototype.hasOwnProperty.call(gutter2Style, 'bgColor')) gutter2Style.bgColor = SCRIPTNOTE_DEFAULT_TYPE_BG;
  if (!Object.prototype.hasOwnProperty.call(roleStyle, 'bgColor')) roleStyle.bgColor = SCRIPTNOTE_DEFAULT_TYPE_BG;
  if (!Object.prototype.hasOwnProperty.call(textStyle, 'bgColor')) textStyle.bgColor = SCRIPTNOTE_DEFAULT_TYPE_BG;
  return current;
}

function _scriptNoteStylesEqual(left, right) {
  const a = _scriptNotePlainObject(left);
  const b = _scriptNotePlainObject(right);
  const keys = Array.from(new Set([...Object.keys(a), ...Object.keys(b)])).sort();
  return keys.every(key => a[key] === b[key]);
}

function _scriptNoteMigrateUnifiedGutterStyles(doc) {
  if (!doc || typeof doc !== 'object') return;
  const editor = _scriptNotePlainObject(doc.editor);
  const characters = Array.isArray(doc.scenarioTypes) && doc.scenarioTypes.length ? doc.scenarioTypes
    : (Array.isArray(doc.characters) ? doc.characters : []);
  const countConfig = _scriptNotePlainObject(editor.countConfig);
  const columnStyles = _scriptNotePlainObject(editor.columnStyles);
  const columnAllRules = _scriptNotePlainObject(editor.columnAllRules);
  const hasScopedGutterStyles = Number(editor.gutterStyleScopeVersion || 0) >= 2;
  editor.columnStyles = columnStyles;
  const defs = [
    { id: '_gutter', legacy: 'gutterStyle', count: 'primaryStyle', fallback: null },
    { id: '_gutter2', legacy: 'gutter2Style', count: 'secondaryStyle', fallback: { bgColor: SCRIPTNOTE_DEFAULT_TYPE_BG } },
  ];
  defs.forEach(def => {
    const allRule = _scriptNotePlainObject(columnAllRules[def.id]);
    const current = _scriptNotePlainObject(columnStyles[def.id]);
    const countStyle = _scriptNotePlainObject(countConfig[def.count]);
    const legacyStyles = characters
      .map(chara => _scriptNotePlainObject(_scriptNotePlainObject(chara)[def.legacy]))
      .filter(style => Object.keys(style).length);
    const hasExplicitGlobalStyle = Object.keys(current).length || Object.keys(allRule).length || Object.keys(countStyle).length;
    const commonLegacyStyle = !hasScopedGutterStyles && !hasExplicitGlobalStyle && legacyStyles.length
      && legacyStyles.every(style => _scriptNoteStylesEqual(style, legacyStyles[0]))
      ? legacyStyles[0]
      : null;
    const merged = { ...(def.fallback || {}), ...(commonLegacyStyle || {}), ...allRule, ...current, ...countStyle };
    // 開いている書式ポップアップが保持する参照を壊さないよう、既存オブジェクトを
    // その場で更新する。これにより Undo 取得直後の変更も保存対象へ確実に入る。
    Object.keys(current).forEach(key => delete current[key]);
    Object.assign(current, merged);
    if (Object.keys(current).length) columnStyles[def.id] = current;
    // 直前の一元設定版は、互換用として全体設定を各タイプへ同値コピーしていた。
    // 未識別の旧データだけ同値コピーを除去し、異なる値はタイプ別上書きとして保持する。
    if (!hasScopedGutterStyles) {
      characters.forEach(chara => {
        const item = _scriptNotePlainObject(chara);
        const roleStyle = _scriptNotePlainObject(item[def.legacy]);
        const effectiveRoleStyle = { ...(def.fallback || {}), ...roleStyle };
        if (Object.keys(roleStyle).length && _scriptNoteStylesEqual(effectiveRoleStyle, current)) delete item[def.legacy];
      });
    }
    delete countConfig[def.count];
    delete columnAllRules[def.id];
  });
  editor.gutterStyleScopeVersion = 2;
  if (Object.keys(countConfig).length) editor.countConfig = countConfig;
  else delete editor.countConfig;
  if (Object.keys(columnAllRules).length) editor.columnAllRules = columnAllRules;
  else delete editor.columnAllRules;
  doc.editor = editor;
}

function createScriptNoteDoc(parsed = {}, options = {}) {
  const input = _scriptNotePlainObject(parsed);
  const roleModel = _scriptNoteRoleModel();
  const src = roleModel
    ? roleModel.normalizeDocument(input, options.roleModelOptions || {})
    : input;
  const now = Number.isFinite(options.now) ? options.now : Date.now();
  const editor = { wrapMode: true, statusEnabled: false, ..._scriptNotePlainObject(src.editor) };
  ensureScriptNoteDefaultType(editor);
  ensureScriptNoteNoneType(editor);
  if (editor.baseTextLineHeight != null && editor.baseTextLineHeight !== '') {
    if (editor.baseTextLineHeightH == null || editor.baseTextLineHeightH === '') editor.baseTextLineHeightH = editor.baseTextLineHeight;
    if (editor.baseTextLineHeightV == null || editor.baseTextLineHeightV === '') editor.baseTextLineHeightV = editor.baseTextLineHeight;
  }
  if (editor.baseTextLetterSpacing != null && editor.baseTextLetterSpacing !== '') {
    if (editor.baseTextLetterSpacingH == null || editor.baseTextLetterSpacingH === '') editor.baseTextLetterSpacingH = editor.baseTextLetterSpacing;
    if (editor.baseTextLetterSpacingV == null || editor.baseTextLetterSpacingV === '') editor.baseTextLetterSpacingV = editor.baseTextLetterSpacing;
  }
  const doc = {
    ...src,
    fileType: src.fileType || (typeof SCRIPTNOTE_FILE_TYPE !== 'undefined' ? SCRIPTNOTE_FILE_TYPE : 'meldex-scriptnote'),
    schema_version: Math.max(
      SCRIPTNOTE_SCHEMA_VERSION,
      Number.isFinite(Number(src.schema_version)) ? Number(src.schema_version) : 1,
    ),
    version: src.version || (typeof SCRIPTNOTE_FILE_VERSION !== 'undefined' ? SCRIPTNOTE_FILE_VERSION : 1),
    title: String(src.title || ''),
    layoutMode: _scriptNoteLayoutOrDefault(src.layoutMode),
    // wrapMode の既定値は true。ツールバー状態と保存形式を一致させる。
    editor,
    scenarioTypes: Array.isArray(src.scenarioTypes) ? src.scenarioTypes : [],
    characters: Array.isArray(src.characters) ? src.characters : [],
    characterDb: Array.isArray(src.characterDb) ? src.characterDb : [],
    notes: Array.isArray(src.notes) ? src.notes : [],
    rubyRules: Array.isArray(src.rubyRules) ? src.rubyRules : [],
    rows: _scriptNoteNormalizeRows(src.rows, now),
    source: _scriptNotePlainObject(src.source),
  };
  if (typeof MeldexRubyPresentation !== 'undefined') {
    MeldexRubyPresentation.ensureDocument(doc, { defaults: options.rubyPresentationDefaults });
  }
  return doc;
}

function applyLegacyScriptNoteDocMigrations(doc, options = {}) {
  if (!doc || typeof doc !== 'object') return doc;
  const legacyDetectKindByName = typeof options.legacyDetectKindByName === 'function'
    ? options.legacyDetectKindByName
    : (() => 'dialogue');
  const layoutMode = _scriptNoteLayoutOrDefault(doc.layoutMode);
  const legacyBreakNames = SCRIPTNOTE_LEGACY_PAGE_BREAK_BY_MODE[layoutMode] || SCRIPTNOTE_LEGACY_PAGE_BREAK_BY_MODE[SCRIPTNOTE_DEFAULT_LAYOUT_MODE];
  const characters = Array.isArray(doc.scenarioTypes) && doc.scenarioTypes.length ? doc.scenarioTypes
    : (Array.isArray(doc.characters) ? doc.characters : []);
  const editor = _scriptNotePlainObject(doc.editor);
  doc.editor = editor;
  ensureScriptNoteDefaultType(editor);
  ensureScriptNoteNoneType(editor);

  characters.forEach((chara) => {
    const item = _scriptNotePlainObject(chara);
    if (item.isDefault) return;
    if (item.isBreak === undefined) {
      if (item.kind === 'break') item.isBreak = true;
      else if (item.name && (legacyBreakNames.includes(item.name) || legacyDetectKindByName(item.name) === 'break')) item.isBreak = true;
    }
    if (item.isSummary === undefined) {
      if (item.kind === 'summary') item.isSummary = true;
      else if (item.name && (SCRIPTNOTE_LEGACY_SUMMARY_NAMES.includes(item.name) || legacyDetectKindByName(item.name) === 'summary')) item.isSummary = true;
    }
  });

  // 旧形式: kind ごとの autoColorConfig を列ごとの autoColorRule に寄せる。
  if (!editor.autoColorRule && editor.autoColorConfig && typeof editor.autoColorConfig === 'object') {
    const cfg = editor.autoColorConfig;
    const pickKind = ['dialogue', 'action', 'heading', 'summary', 'break'].find((kind) => cfg[kind]);
    if (pickKind) {
      const value = cfg[pickKind];
      if (typeof value === 'string') {
        editor.autoColorRule = { _gutter: value, _gutter2: value, _role: value, _text: value };
      } else if (value && typeof value === 'object' && !Array.isArray(value)) {
        editor.autoColorRule = { ...value };
      }
    }
  }

  // 旧形式: actionIndent をト書き系タイプの indent へ転写する。
  if (editor.actionIndent) {
    const oldIndent = editor.actionIndent;
    characters.forEach((chara) => {
      const item = _scriptNotePlainObject(chara);
      if (item.isDefault || item.indent !== undefined) return;
      if (item.kind === 'action' || legacyDetectKindByName(item.name) === 'action') item.indent = oldIndent;
    });
  }

  _scriptNoteMigrateUnifiedGutterStyles(doc);
  const roleModel = _scriptNoteRoleModel();
  if (roleModel) roleModel.ensureDocument(doc, options.roleModelOptions || {});

  return doc;
}

function _scriptNoteSerializedCharacters(doc) {
  const characters = Array.isArray(doc?.characters) ? doc.characters : [];
  return characters.map(chara => {
    const item = { ..._scriptNotePlainObject(chara) };
    if (item.gutterStyle) item.gutterStyle = { ..._scriptNotePlainObject(item.gutterStyle) };
    if (item.gutter2Style) item.gutter2Style = { ..._scriptNotePlainObject(item.gutter2Style) };
    return item;
  });
}

function _scriptNoteSerializedTypes(doc) {
  const types = Array.isArray(doc?.scenarioTypes) ? doc.scenarioTypes : [];
  return types.map(item => {
    const type = { ..._scriptNotePlainObject(item) };
    for (const key of ['gutterStyle', 'gutter2Style', 'roleStyle', 'textStyle', 'customStyles']) {
      if (type[key]) type[key] = { ..._scriptNotePlainObject(type[key]) };
    }
    return type;
  });
}

function serializeScriptNoteDoc(doc) {
  if (!doc || typeof doc !== 'object') return null;
  if (typeof MeldexRubyPresentation !== 'undefined') MeldexRubyPresentation.ensureDocument(doc);
  if (!doc.editor || typeof doc.editor !== 'object' || Array.isArray(doc.editor)) doc.editor = {};
  ensureScriptNoteDefaultType(doc.editor);
  ensureScriptNoteNoneType(doc.editor);
  _scriptNoteMigrateUnifiedGutterStyles(doc);
  const serialized = {
    ...doc,
    fileType: doc.fileType || (typeof SCRIPTNOTE_FILE_TYPE !== 'undefined' ? SCRIPTNOTE_FILE_TYPE : 'meldex-scriptnote'),
    schema_version: Math.max(
      SCRIPTNOTE_SCHEMA_VERSION,
      Number.isFinite(Number(doc.schema_version)) ? Number(doc.schema_version) : 1,
    ),
    version: doc.version || (typeof SCRIPTNOTE_FILE_VERSION !== 'undefined' ? SCRIPTNOTE_FILE_VERSION : 1),
    title: String(doc.title || ''),
    layoutMode: _scriptNoteLayoutOrDefault(doc.layoutMode),
    editor: { ..._scriptNotePlainObject(doc.editor) },
    // 全体既定は editor.columnStyles、タイプ別上書きは各タイプのスタイルへ分離して保存する。
    scenarioTypes: _scriptNoteSerializedTypes(doc),
    characters: _scriptNoteSerializedCharacters(doc),
    characterDb: Array.isArray(doc.characterDb) ? doc.characterDb : [],
    notes: Array.isArray(doc.notes) ? doc.notes : [],
    rubyRules: Array.isArray(doc.rubyRules) ? doc.rubyRules : [],
    ...(doc.rubyPresentation && typeof doc.rubyPresentation === 'object'
      ? { rubyPresentation: { ...doc.rubyPresentation } }
      : {}),
    rows: _scriptNoteNormalizeRows(doc.rows, Date.now()),
    source: _scriptNotePlainObject(doc.source),
  };
  const roleModel = _scriptNoteRoleModel();
  return roleModel ? roleModel.prepareForSave(serialized) : serialized;
}

function createScriptNoteRowIdSet(doc) {
  return new Set((Array.isArray(doc?.rows) ? doc.rows : [])
    .map((row) => row?.id)
    .filter(Boolean));
}
