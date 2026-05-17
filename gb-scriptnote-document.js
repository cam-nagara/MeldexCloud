/* gb-scriptnote-document.js: シナリオ文書の正規化・旧データ移行・直列化 */

const SCRIPTNOTE_DEFAULT_LAYOUT_MODE = 'manga';
const SCRIPTNOTE_LEGACY_PAGE_BREAK_BY_MODE = {
  manga: ['めくり', '改ページ', '柱'],
  drama: ['シーン見出し', '場面転換', '柱'],
  afureko: ['シーン見出し', '場面転換', 'Aパート', 'Bパート', 'Cパート', '柱'],
  stage: ['第一幕', '第二幕', '第三幕', '場', '柱'],
};
const SCRIPTNOTE_LEGACY_SUMMARY_NAMES = ['プロット'];

function _scriptNotePlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function _scriptNoteLayoutOrDefault(layout) {
  if (typeof _scriptNoteNormalizeLayout === 'function') return _scriptNoteNormalizeLayout(layout);
  return ['manga', 'drama', 'afureko', 'stage'].includes(layout) ? layout : SCRIPTNOTE_DEFAULT_LAYOUT_MODE;
}

function _scriptNoteNormalizeRows(rows, now) {
  const normalized = Array.isArray(rows) ? rows.map((row, index) => {
    const item = _scriptNotePlainObject(row);
    return {
      id: item.id || `sn-${now}-${index}`,
      role: String(item.role || ''),
      status: String(item.status || ''),
      text: String(item.text || ''),
      columns: _scriptNotePlainObject(item.columns),
    };
  }) : [];
  if (normalized.length) return normalized;
  return [{ id: `sn-${now}-0`, role: '', status: '', text: '', columns: {} }];
}

function createScriptNoteDoc(parsed = {}, options = {}) {
  const src = _scriptNotePlainObject(parsed);
  const now = Number.isFinite(options.now) ? options.now : Date.now();
  const editor = { wrapMode: true, statusEnabled: false, ..._scriptNotePlainObject(src.editor) };
  if (editor.baseTextLineHeight != null && editor.baseTextLineHeight !== '') {
    if (editor.baseTextLineHeightH == null || editor.baseTextLineHeightH === '') editor.baseTextLineHeightH = editor.baseTextLineHeight;
    if (editor.baseTextLineHeightV == null || editor.baseTextLineHeightV === '') editor.baseTextLineHeightV = editor.baseTextLineHeight;
  }
  if (editor.baseTextLetterSpacing != null && editor.baseTextLetterSpacing !== '') {
    if (editor.baseTextLetterSpacingH == null || editor.baseTextLetterSpacingH === '') editor.baseTextLetterSpacingH = editor.baseTextLetterSpacing;
    if (editor.baseTextLetterSpacingV == null || editor.baseTextLetterSpacingV === '') editor.baseTextLetterSpacingV = editor.baseTextLetterSpacing;
  }
  return {
    fileType: src.fileType || (typeof SCRIPTNOTE_FILE_TYPE !== 'undefined' ? SCRIPTNOTE_FILE_TYPE : 'meldex-scriptnote'),
    schema_version: Number.isFinite(Number(src.schema_version)) ? Number(src.schema_version) : 1,
    version: src.version || (typeof SCRIPTNOTE_FILE_VERSION !== 'undefined' ? SCRIPTNOTE_FILE_VERSION : 1),
    title: String(src.title || ''),
    layoutMode: _scriptNoteLayoutOrDefault(src.layoutMode),
    // wrapMode の既定値は true。ツールバー状態と保存形式を一致させる。
    editor,
    characters: Array.isArray(src.characters) ? src.characters : [],
    characterDb: Array.isArray(src.characterDb) ? src.characterDb : [],
    notes: Array.isArray(src.notes) ? src.notes : [],
    rubyRules: Array.isArray(src.rubyRules) ? src.rubyRules : [],
    rows: _scriptNoteNormalizeRows(src.rows, now),
    source: _scriptNotePlainObject(src.source),
  };
}

function applyLegacyScriptNoteDocMigrations(doc, options = {}) {
  if (!doc || typeof doc !== 'object') return doc;
  const legacyDetectKindByName = typeof options.legacyDetectKindByName === 'function'
    ? options.legacyDetectKindByName
    : (() => 'dialogue');
  const layoutMode = _scriptNoteLayoutOrDefault(doc.layoutMode);
  const legacyBreakNames = SCRIPTNOTE_LEGACY_PAGE_BREAK_BY_MODE[layoutMode] || SCRIPTNOTE_LEGACY_PAGE_BREAK_BY_MODE[SCRIPTNOTE_DEFAULT_LAYOUT_MODE];
  const characters = Array.isArray(doc.characters) ? doc.characters : [];
  const editor = _scriptNotePlainObject(doc.editor);
  doc.editor = editor;

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

  return doc;
}

function serializeScriptNoteDoc(doc) {
  if (!doc || typeof doc !== 'object') return null;
  return {
    fileType: doc.fileType || (typeof SCRIPTNOTE_FILE_TYPE !== 'undefined' ? SCRIPTNOTE_FILE_TYPE : 'meldex-scriptnote'),
    schema_version: Number.isFinite(Number(doc.schema_version)) ? Number(doc.schema_version) : 1,
    version: doc.version || (typeof SCRIPTNOTE_FILE_VERSION !== 'undefined' ? SCRIPTNOTE_FILE_VERSION : 1),
    title: String(doc.title || ''),
    layoutMode: _scriptNoteLayoutOrDefault(doc.layoutMode),
    editor: { ..._scriptNotePlainObject(doc.editor) },
    characters: Array.isArray(doc.characters) ? doc.characters : [],
    characterDb: Array.isArray(doc.characterDb) ? doc.characterDb : [],
    notes: Array.isArray(doc.notes) ? doc.notes : [],
    rubyRules: Array.isArray(doc.rubyRules) ? doc.rubyRules : [],
    rows: _scriptNoteNormalizeRows(doc.rows, Date.now()),
    source: _scriptNotePlainObject(doc.source),
  };
}

function createScriptNoteRowIdSet(doc) {
  return new Set((Array.isArray(doc?.rows) ? doc.rows : [])
    .map((row) => row?.id)
    .filter(Boolean));
}
