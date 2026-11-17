/* gb-scriptnote-role-model.js: ScriptNote schema v3 のキャラ・タイプ共通モデル */
(function (global) {
  'use strict';

  const SCHEMA_VERSION = 4;
  const NONE_REF = Object.freeze({ kind: 'none', id: 'none' });
  const NONE_LABEL = '（なし）';
  const FUNCTION_NAMES = new Set([
    'セリフ', '心の声', 'モノローグ', 'ナレーション', 'ト書き', '擬音', 'プロット', 'コマ外アノテート', 'コマ外注釈',
    '右ページ', '左ページ', 'めくり', '改ページ', '見開き', '白紙', 'トビラ絵', '大ゴマ', '未完', '柱',
    'シーン見出し', '場面転換', 'Aパート', 'Bパート', 'Cパート',
    '第一幕', '第二幕', '第三幕', '場',
    // 旧エディタの種類推定（_legacyDetectKindByName）で区切り・ト書き扱いだった名前。
    '巻頭カラー', '巻頭見開き', '暗転', '幕間', '動作', '説明', 'ナレ', 'SE', 'BGM', 'テロップ', '地の文', '独白', '傍白',
  ]);
  const TEMPLATE_ROOT_FIELDS = [
    'layoutMode', 'rubyPresentation', 'viewMode', 'pageSettings',
    'templateId', 'templateVersion', 'templatePurpose', 'templateSourceRefs',
  ];

  function plain(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  }

  function clone(value) {
    if (Array.isArray(value)) return value.map(clone);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]));
  }

  function text(value) {
    return String(value == null ? '' : value).trim();
  }

  function hash(value) {
    let result = 2166136261;
    for (const char of String(value || '')) {
      result ^= char.codePointAt(0);
      result = Math.imul(result, 16777619);
    }
    return (result >>> 0).toString(36);
  }

  function idBase(kind, name) {
    const slug = text(name).toLowerCase()
      .normalize('NFKC')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40);
    return `${kind}-${slug || hash(name)}`;
  }

  function uniqueId(kind, name, used) {
    const base = idBase(kind, name);
    let candidate = base;
    let suffix = 2;
    while (used.has(candidate)) candidate = `${base}-${suffix++}`;
    used.add(candidate);
    return candidate;
  }

  function isNoneName(name) {
    const value = text(name);
    return !value || value === NONE_LABEL;
  }

  function isNoneListItem(item) {
    const source = plain(item);
    return !!source.isDefault || !!source.isRoleNone || text(source.name) === NONE_LABEL;
  }

  function isFunctionalLegacy(item, options = {}) {
    const source = plain(item);
    if (source.isDefault || isNoneName(source.name)) return false;
    if (source.isBreak || source.isSummary) return true;
    if (['break', 'summary', 'action', 'heading'].includes(source.kind)) return true;
    if (FUNCTION_NAMES.has(text(source.name))) return true;
    return options.functionalNames instanceof Set && options.functionalNames.has(text(source.name));
  }

  function extractNameColor(item) {
    const source = plain(item);
    const roleStyle = plain(source.roleStyle);
    return text(source.nameColor || roleStyle.textColor || roleStyle.color || source.roleColor || source.textColor || '#d4d4d4');
  }

  function normalizeRef(value) {
    const ref = plain(value);
    const kind = text(ref.kind);
    const id = text(ref.id);
    if (kind === 'none') return { ...NONE_REF };
    if (!['character', 'type'].includes(kind) || !id) return null;
    return { kind, id };
  }

  function findTypeById(doc, id) {
    const key = text(id);
    return (Array.isArray(doc?.scenarioTypes) ? doc.scenarioTypes : [])
      .find(item => text(item?.id) === key) || null;
  }

  function findTypeByName(doc, name) {
    const key = text(name);
    return (Array.isArray(doc?.scenarioTypes) ? doc.scenarioTypes : [])
      .find(item => text(item?.name) === key) || null;
  }

  function findCharacterById(doc, id) {
    const key = text(id);
    return (Array.isArray(doc?.characters) ? doc.characters : [])
      .find(item => text(item?.id) === key) || null;
  }

  function findCharacterByName(doc, name) {
    const key = text(name);
    return (Array.isArray(doc?.characters) ? doc.characters : [])
      .find(item => text(item?.name) === key) || null;
  }

  function assertUniqueIds(doc) {
    const used = new Set();
    for (const item of [...(doc.scenarioTypes || []), ...(doc.characters || [])]) {
      const id = text(item?.id);
      if (!id) continue;
      if (used.has(id)) throw new Error(`役割IDが重複しています: ${id}`);
      used.add(id);
    }
  }

  function normalizeTypes(items, used) {
    return (Array.isArray(items) ? items : [])
      .filter(item => !isNoneListItem(item))
      .map(item => {
        const source = clone(plain(item));
        source.name = text(source.name);
        source.id = text(source.id) || uniqueId('type', source.name, used);
        used.add(source.id);
        return source;
      });
  }

  function normalizeCharacters(items, used) {
    return (Array.isArray(items) ? items : [])
      .filter(item => !isNoneListItem(item))
      .map(item => {
        const source = clone(plain(item));
        source.name = text(source.name);
        source.id = text(source.id) || uniqueId('char', source.name, used);
        source.typeId = text(source.typeId) || null;
        source.nameColor = extractNameColor(source);
        used.add(source.id);
        return source;
      });
  }

  function migrateLegacyItem(item, kind, used) {
    const source = clone(plain(item));
    const name = text(source.name);
    if (kind === 'type') {
      source.name = name;
      source.id = uniqueId('type', name, used);
      delete source.isDefault;
      return source;
    }
    return {
      id: uniqueId('char', name, used),
      name,
      typeId: null,
      nameColor: extractNameColor(source),
      legacyAppearance: source,
    };
  }

  function roleRefForName(doc, name) {
    if (isNoneName(name)) return { ...NONE_REF };
    const character = findCharacterByName(doc, name);
    if (character) return { kind: 'character', id: character.id };
    const type = findTypeByName(doc, name);
    if (type) return { kind: 'type', id: type.id };
    return null;
  }

  function migrateRows(doc, rows, used, options = {}) {
    return (Array.isArray(rows) ? rows : []).map((row, index) => {
      const item = clone(plain(row));
      item.role = String(item.role || '');
      let ref = roleRefForName(doc, item.role);
      if (!ref && item.role) {
        // 旧形式（schema_version なし／v1・v2）は、キャラ一覧に宣言していない役割名を行で
        // 使うことがある。以前は一律にキャラとして作ったため、改ページ・めくり・ト書き等の
        // 機能タイプがキャラになり、ページ区切りやタイプ設定が効かないまま v4 で保存されていた
        // （実データ2ファイル・1,603行）。機能名ならタイプとして作り、区切り等の旧既定は
        // applyLegacyScriptNoteDocMigrations がタイプ側へ付ける。
        if (isFunctionalLegacy({ name: item.role }, options)) {
          const type = migrateLegacyItem({ name: item.role }, 'type', used);
          doc.scenarioTypes.push(type);
          ref = { kind: 'type', id: type.id };
        } else {
          const character = migrateLegacyItem({ name: item.role }, 'character', used);
          doc.characters.push(character);
          ref = { kind: 'character', id: character.id };
        }
      }
      item.roleRef = ref || { ...NONE_REF };
      if (!item.id) item.id = `sn-role-${index}-${hash(item.role + index)}`;
      return item;
    });
  }

  function migrateV2Document(input, options = {}) {
    const source = clone(plain(input));
    const used = new Set();
    const mixed = Array.isArray(source.characters) ? source.characters : [];
    const legacyNone = mixed.find(item => plain(item).isDefault);
    const types = [];
    const characters = [];
    for (const item of mixed) {
      if (isNoneListItem(item)) continue;
      const kind = isFunctionalLegacy(item, options) ? 'type' : 'character';
      (kind === 'type' ? types : characters).push(migrateLegacyItem(item, kind, used));
    }
    // まず従来の共通role形式へ移行し、normalizeV3Documentで分離形式へ上げる。
    source.schema_version = 3;
    source.editor = clone(plain(source.editor));
    if (legacyNone && !source.editor.noneType) {
      source.editor.noneType = { ...clone(plain(legacyNone)), isRoleNone: true, name: '' };
      delete source.editor.noneType.isDefault;
    }
    source.scenarioTypes = types;
    source.characters = characters;
    source.rows = migrateRows(source, source.rows, used, options);
    return normalizeV3Document(source);
  }

  function normalizeV3Document(input) {
    const source = clone(plain(input));
    assertUniqueIds(source);
    // 明示済みIDを先に予約し、欠損IDの自動生成が後続項目のIDと衝突しないようにする。
    const used = new Set(
      [...(source.scenarioTypes || []), ...(source.characters || [])]
        .map(item => text(item?.id))
        .filter(Boolean),
    );
    source.scenarioTypes = normalizeTypes(source.scenarioTypes, used);
    source.characters = normalizeCharacters(source.characters, used);
    source.rows = (Array.isArray(source.rows) ? source.rows : []).map(row => {
      const item = clone(plain(row));
      item.role = String(item.role || '');
      const legacyRef = normalizeRef(item.roleRef) || roleRefForName(source, item.role) || { ...NONE_REF };
      const legacyResolved = resolveRole(source, legacyRef);
      const explicitCharacterRef = normalizeRef(item.characterRef);
      const explicitTypeRef = normalizeRef(item.typeRef);
      const hasCharacterRef = Object.prototype.hasOwnProperty.call(item, 'characterRef');
      const hasTypeRef = Object.prototype.hasOwnProperty.call(item, 'typeRef');
      const character = explicitCharacterRef?.kind === 'character'
        ? findCharacterById(source, explicitCharacterRef.id)
        : (!hasCharacterRef
          ? findCharacterByName(source, item.character)
            || (legacyResolved?.kind === 'character' ? legacyResolved.character : null)
          : null);
      const type = explicitTypeRef?.kind === 'type'
        ? findTypeById(source, explicitTypeRef.id)
        : (!hasTypeRef
          ? findTypeByName(source, item.type)
            || (legacyResolved?.kind === 'type' ? legacyResolved.type : null)
            || (character?.typeId ? findTypeById(source, character.typeId) : null)
          : null);
      item.characterRef = character ? { kind: 'character', id: character.id } : { ...NONE_REF };
      item.character = character?.name || '';
      item.typeRef = type ? { kind: 'type', id: type.id } : { ...NONE_REF };
      item.type = type?.name || '';
      // v3以前の読取側へ渡してもタイプとして解決できる互換ミラー。
      item.roleRef = { ...item.typeRef };
      item.role = item.type;
      return item;
    });
    source.schema_version = Math.max(SCHEMA_VERSION, Number(source.schema_version) || SCHEMA_VERSION);
    return source;
  }

  function normalizeDocument(input, options = {}) {
    const version = Number(plain(input).schema_version) || 1;
    return normalizeV3Document(version < 3 ? migrateV2Document(input, options) : input);
  }

  function ensureDocument(doc, options = {}) {
    if (!doc || typeof doc !== 'object' || Array.isArray(doc)) throw new Error('シナリオ文書が不正です');
    const normalized = normalizeDocument(doc, options);
    for (const key of Object.keys(doc)) delete doc[key];
    Object.assign(doc, normalized);
    return doc;
  }

  function resolveRole(doc, value) {
    const row = plain(value);
    const explicitRef = normalizeRef(row.typeRef || row.roleRef || value);
    if (explicitRef?.kind === 'none') {
      return { kind: 'none', id: NONE_REF.id, name: '', ref: { ...NONE_REF } };
    }
    if (explicitRef?.kind === 'character') {
      const character = findCharacterById(doc, explicitRef.id);
      if (character) return { kind: 'character', id: character.id, name: character.name, character, ref: explicitRef };
    }
    if (explicitRef?.kind === 'type') {
      const type = findTypeById(doc, explicitRef.id);
      if (type) return { kind: 'type', id: type.id, name: type.name, type, ref: explicitRef };
    }
    const name = typeof value === 'string' ? value : row.role;
    const fallback = roleRefForName(doc, name);
    return fallback ? resolveRole(doc, fallback) : null;
  }

  function roleKind(doc, value) {
    return resolveRole(doc, value)?.kind || 'unresolved';
  }

  function defaultAppearance(doc) {
    return clone(plain(plain(doc?.editor).defaultType));
  }

  function resolveRowCharacter(doc, value) {
    const row = plain(value);
    const ref = normalizeRef(row.characterRef);
    if (ref?.kind === 'character') {
      const character = findCharacterById(doc, ref.id);
      if (character) return { kind: 'character', id: character.id, name: character.name, character, ref };
    }
    if (ref?.kind === 'none') return { kind: 'none', id: NONE_REF.id, name: '', ref: { ...NONE_REF } };
    const legacy = normalizeRef(row.roleRef || value);
    if (legacy?.kind === 'character') {
      const character = findCharacterById(doc, legacy.id);
      if (character) return { kind: 'character', id: character.id, name: character.name, character, ref: legacy };
    }
    const character = findCharacterByName(doc, row.character || (typeof value === 'string' ? value : ''));
    return character
      ? { kind: 'character', id: character.id, name: character.name, character, ref: { kind: 'character', id: character.id } }
      : { kind: 'none', id: NONE_REF.id, name: '', ref: { ...NONE_REF } };
  }

  function resolveRowType(doc, value) {
    const row = plain(value);
    const ref = normalizeRef(row.typeRef || row.roleRef || value);
    if (ref?.kind === 'type') {
      const type = findTypeById(doc, ref.id);
      if (type) return { kind: 'type', id: type.id, name: type.name, type, ref };
    }
    if (ref?.kind === 'none' && row.typeRef) return { kind: 'none', id: NONE_REF.id, name: '', ref: { ...NONE_REF } };
    const namedType = findTypeByName(doc, row.type || row.role || (typeof value === 'string' ? value : ''));
    if (namedType) return { kind: 'type', id: namedType.id, name: namedType.name, type: namedType, ref: { kind: 'type', id: namedType.id } };
    const character = resolveRowCharacter(doc, value)?.character;
    const initialType = character?.typeId ? findTypeById(doc, character.typeId) : null;
    if (initialType) return { kind: 'type', id: initialType.id, name: initialType.name, type: initialType, ref: { kind: 'type', id: initialType.id } };
    const unresolvedName = text(row.type || row.role || (typeof value === 'string' ? value : ''));
    return unresolvedName
      ? { kind: 'unresolved', id: '', name: unresolvedName, ref: null }
      : { kind: 'none', id: NONE_REF.id, name: '', ref: { ...NONE_REF } };
  }

  function getEffectiveStyle(doc, value) {
    const resolved = resolveRowType(doc, value);
    if (!resolved) return defaultAppearance(doc);
    if (resolved.kind === 'none') {
      const legacyAppearance = resolveRowCharacter(doc, value)?.character?.legacyAppearance;
      if (legacyAppearance && Object.keys(plain(legacyAppearance)).length) return clone(legacyAppearance);
      return clone(Object.keys(plain(plain(doc?.editor).noneType)).length
        ? plain(doc.editor).noneType
        : defaultAppearance(doc));
    }
    return resolved.kind === 'type' ? clone(resolved.type) : defaultAppearance(doc);
  }

  function getEffectiveRole(doc, value) {
    const resolved = resolveRowType(doc, value);
    const character = resolveRowCharacter(doc, value)?.character || null;
    return { ...resolved, character, type: resolved.type || null, style: getEffectiveStyle(doc, value) };
  }

  function countTypeLinks(doc) {
    const counts = Object.fromEntries((doc.scenarioTypes || []).map(type => [type.id, 0]));
    for (const character of doc.characters || []) {
      if (character.typeId && Object.hasOwn(counts, character.typeId)) counts[character.typeId] += 1;
    }
    return counts;
  }

  function buildRoleChoices(doc) {
    const characters = (doc.characters || []).map(item => ({
      kind: 'character', id: item.id, name: item.name, label: item.name,
      ref: { kind: 'character', id: item.id },
    }));
    const types = (doc.scenarioTypes || []).map(item => ({
        kind: 'type', id: item.id, name: item.name, label: item.name,
        ref: { kind: 'type', id: item.id },
      }));
    return [...characters, ...types, {
      kind: 'none', id: NONE_REF.id, name: '', label: NONE_LABEL, ref: { ...NONE_REF },
    }];
  }

  function buildCharacterChoices(doc) {
    return [...(doc.characters || []).map(item => ({
      kind: 'character', id: item.id, name: item.name, label: item.name,
      ref: { kind: 'character', id: item.id },
    })), { kind: 'none', id: NONE_REF.id, name: '', label: NONE_LABEL, ref: { ...NONE_REF } }];
  }

  function buildTypeChoices(doc) {
    return [...(doc.scenarioTypes || []).map(item => ({
      kind: 'type', id: item.id, name: item.name, label: item.name,
      ref: { kind: 'type', id: item.id },
    })), { kind: 'none', id: NONE_REF.id, name: '', label: NONE_LABEL, ref: { ...NONE_REF } }];
  }

  function assertAvailableName(doc, name, except) {
    const value = text(name);
    if (!value || value === NONE_LABEL) throw new Error('役割名を入力してください');
    const matched = [...(doc.characters || []), ...(doc.scenarioTypes || [])]
      .find(item => item !== except && text(item.name) === value);
    if (matched) throw new Error(`同じ役割名が既にあります: ${value}`);
    return value;
  }

  function ensureCharacterForName(doc, name, options = {}) {
    const value = text(name);
    const current = findCharacterByName(doc, value);
    if (current) return current;
    assertAvailableName(doc, value);
    const used = new Set([...(doc.scenarioTypes || []), ...(doc.characters || [])].map(item => item.id));
    const character = {
      id: uniqueId('char', value, used),
      name: value,
      typeId: null,
      nameColor: text(options.nameColor) || '#d4d4d4',
    };
    doc.characters.push(character);
    return character;
  }

  function assignRowRole(doc, row, target, options = {}) {
    if (!row || typeof row !== 'object') throw new Error('対象行が不正です');
    let resolved = null;
    const targetsNone = target == null
      || (typeof target === 'string' && isNoneName(target))
      || (typeof target === 'object' && target?.kind === 'none');
    if (targetsNone) {
      resolved = resolveRole(doc, NONE_REF);
    } else {
      resolved = resolveRole(doc, target);
      if (!resolved && typeof target === 'string') {
        const character = ensureCharacterForName(doc, target, options);
        resolved = resolveRole(doc, { kind: 'character', id: character.id });
      }
    }
    if (!resolved) throw new Error('指定された役割を確認できません');
    if (resolved.kind === 'character') return assignRowCharacter(doc, row, resolved.ref, options);
    return assignRowType(doc, row, resolved.ref);
  }

  function assignRowCharacter(doc, row, target, options = {}) {
    if (!row || typeof row !== 'object') throw new Error('対象行が不正です');
    // キャラを書き換える前の行タイプを確認する。書き換え後に解決すると、
    // 新キャラの初期タイプ自体が「既存タイプ」に見えて補完できなくなる。
    const currentType = resolveRowType(doc, row);
    const targetsNone = target == null
      || (typeof target === 'string' && isNoneName(target))
      || (typeof target === 'object' && target?.kind === 'none');
    let character = null;
    if (!targetsNone) {
      const resolved = resolveRowCharacter(doc, target);
      character = resolved?.character || (typeof target === 'string' ? ensureCharacterForName(doc, target, options) : null);
      if (!character) throw new Error('指定されたキャラを確認できません');
    }
    row.characterRef = character ? { kind: 'character', id: character.id } : { ...NONE_REF };
    row.character = character?.name || '';
    if (character?.typeId && currentType.kind === 'none') assignRowType(doc, row, { kind: 'type', id: character.typeId });
    return character
      ? { kind: 'character', id: character.id, name: character.name, character, ref: { ...row.characterRef } }
      : { kind: 'none', id: NONE_REF.id, name: '', ref: { ...NONE_REF } };
  }

  function assignRowType(doc, row, target) {
    if (!row || typeof row !== 'object') throw new Error('対象行が不正です');
    const targetsNone = target == null
      || (typeof target === 'string' && isNoneName(target))
      || (typeof target === 'object' && target?.kind === 'none');
    let type = null;
    if (!targetsNone) {
      const ref = normalizeRef(target);
      type = ref?.kind === 'type' ? findTypeById(doc, ref.id)
        : (typeof target === 'string' ? findTypeById(doc, target) || findTypeByName(doc, target) : null);
      if (!type) throw new Error('指定されたタイプを確認できません');
    }
    row.typeRef = type ? { kind: 'type', id: type.id } : { ...NONE_REF };
    row.type = type?.name || '';
    row.roleRef = { ...row.typeRef };
    row.role = row.type;
    const resolved = type
      ? { kind: 'type', id: type.id, name: type.name, type, ref: { ...row.typeRef } }
      : { kind: 'none', id: NONE_REF.id, name: '', ref: { ...NONE_REF } };
    return resolved;
  }

  function setCharacterType(doc, characterValue, typeValue) {
    const character = typeof characterValue === 'string'
      ? findCharacterById(doc, characterValue) || findCharacterByName(doc, characterValue)
      : characterValue;
    if (!character) throw new Error('キャラを確認できません');
    const type = typeValue == null || typeValue === ''
      ? null
      : (typeof typeValue === 'string'
        ? findTypeById(doc, typeValue) || findTypeByName(doc, typeValue)
        : typeValue);
    if (typeValue != null && typeValue !== '' && !type) throw new Error('初期タイプを確認できません');
    character.typeId = type?.id || null;
    if (type) delete character.legacyAppearance;
    return character;
  }

  function syncRoleNames(doc) {
    let updated = 0;
    const unresolved = [];
    for (const row of doc.rows || []) {
      const character = resolveRowCharacter(doc, row);
      const type = resolveRowType(doc, row);
      if (!character || !type) unresolved.push(row.id || '');
      const characterName = character?.kind === 'character' ? character.name : '';
      const typeName = type?.kind === 'type' ? type.name : '';
      if (row.character !== characterName || row.type !== typeName || row.role !== typeName) updated += 1;
      row.character = characterName;
      row.characterRef = character?.kind === 'character' ? { ...character.ref } : { ...NONE_REF };
      row.type = typeName;
      row.typeRef = type?.kind === 'type' ? { ...type.ref } : { ...NONE_REF };
      row.role = typeName;
      row.roleRef = { ...row.typeRef };
    }
    return { updated, unresolved };
  }

  function renameCharacter(doc, value, name) {
    const character = findCharacterById(doc, value) || findCharacterByName(doc, value);
    if (!character) throw new Error('キャラを確認できません');
    character.name = assertAvailableName(doc, name, character);
    return { character, ...syncRoleNames(doc) };
  }

  function renameType(doc, value, name) {
    const type = findTypeById(doc, value) || findTypeByName(doc, value);
    if (!type) throw new Error('タイプを確認できません');
    type.name = assertAvailableName(doc, name, type);
    return { type, ...syncRoleNames(doc) };
  }

  function moveRole(doc, value, destination = {}) {
    const resolved = resolveRole(doc, value);
    if (!resolved || resolved.kind === 'none') throw new Error('並べ替える役割を確認できません');
    const list = resolved.kind === 'type' ? doc.scenarioTypes : doc.characters;
    const item = resolved.kind === 'type' ? resolved.type : resolved.character;
    const from = list.indexOf(item);
    if (from < 0) return false;
    let to;
    if (Number.isInteger(destination.delta)) {
      to = Math.max(0, Math.min(list.length - 1, from + destination.delta));
    } else {
      const targetId = text(destination.beforeId || destination.afterId);
      const target = list.findIndex(candidate => text(candidate?.id) === targetId);
      if (target < 0) return false;
      to = target + (destination.afterId ? 1 : 0);
      if (from < to) to -= 1;
    }
    if (to === from) return false;
    list.splice(from, 1);
    list.splice(to, 0, item);
    return true;
  }

  function countReferences(doc, value) {
    const resolved = resolveRole(doc, value);
    if (!resolved) return { rows: 0, characters: 0, total: 0 };
    const rows = (doc.rows || []).filter(row => {
      const current = resolved.kind === 'character' ? resolveRowCharacter(doc, row) : resolveRowType(doc, row);
      return current?.kind === resolved.kind && current?.id === resolved.id;
    }).length;
    const characters = resolved.kind === 'type'
      ? (doc.characters || []).filter(item => item.typeId === resolved.id).length
      : 0;
    return { rows, characters, total: rows + characters };
  }

  function canDeleteRole(doc, value, replacement) {
    const references = countReferences(doc, value);
    const replacementRole = replacement == null ? null : resolveRole(doc, replacement);
    return {
      allowed: references.total === 0 || !!replacementRole,
      references,
      replacement: replacementRole,
    };
  }

  function deleteRole(doc, value, replacement = null) {
    const resolved = resolveRole(doc, value);
    if (!resolved || resolved.kind === 'none') throw new Error('削除対象を確認できません');
    const references = countReferences(doc, resolved.ref);
    const replacementRole = replacement == null ? null : resolveRole(doc, replacement);
    if (replacementRole?.kind === resolved.kind && replacementRole.id === resolved.id) {
      throw new Error('削除対象自身は置換先に指定できません');
    }
    if (references.total && !replacementRole) {
      throw new Error(`使用中のため削除できません（行${references.rows}件、キャラ${references.characters}件）`);
    }
    if (resolved.kind === 'type' && replacementRole && replacementRole.kind !== 'type') {
      throw new Error('タイプの置換先には別のタイプを指定してください');
    }
    for (const row of doc.rows || []) {
      const current = resolved.kind === 'character' ? resolveRowCharacter(doc, row) : resolveRowType(doc, row);
      if (current?.kind === resolved.kind && current?.id === resolved.id) {
        if (resolved.kind === 'character') assignRowCharacter(doc, row, replacementRole?.ref || NONE_REF);
        else assignRowType(doc, row, replacementRole?.ref || NONE_REF);
      }
    }
    if (resolved.kind === 'type') {
      for (const character of doc.characters || []) {
        if (character.typeId === resolved.id) character.typeId = replacementRole?.id || null;
      }
      const index = doc.scenarioTypes.indexOf(resolved.type);
      if (index >= 0) doc.scenarioTypes.splice(index, 1);
    } else {
      const index = doc.characters.indexOf(resolved.character);
      if (index >= 0) doc.characters.splice(index, 1);
    }
    return { deleted: { kind: resolved.kind, id: resolved.id, name: resolved.name }, replacement: replacementRole, references };
  }

  function templateTypes(template) {
    if (Array.isArray(template?.scenarioTypes)) return clone(template.scenarioTypes);
    return (Array.isArray(template?.characters) ? template.characters : [])
      .filter(item => isFunctionalLegacy(item))
      .map(clone);
  }

  function createTemplate(doc, options = {}) {
    const result = {
      schema_version: SCHEMA_VERSION,
      scenarioTypes: clone(doc.scenarioTypes || []),
      editor: clone(plain(doc.editor)),
    };
    for (const key of [...TEMPLATE_ROOT_FIELDS, ...(options.rootFields || [])]) {
      if (doc[key] !== undefined) result[key] = clone(doc[key]);
    }
    return result;
  }

  function copyTemplateType(local, incoming) {
    const id = local.id;
    const name = local.name;
    for (const key of Object.keys(local)) delete local[key];
    Object.assign(local, clone(incoming), { id, name });
  }

  function applyTemplate(doc, template, options = {}) {
    ensureDocument(doc, options);
    const incomingTypes = templateTypes(template);
    let updated = 0;
    let added = 0;
    const unmatched = [];
    const used = new Set([...(doc.scenarioTypes || []), ...(doc.characters || [])].map(item => item.id));
    for (const incoming of incomingTypes) {
      const source = plain(incoming);
      let local = findTypeById(doc, source.id);
      if (!local) local = findTypeByName(doc, source.name);
      if (local) {
        copyTemplateType(local, source);
        updated += 1;
        continue;
      }
      const name = text(source.name);
      if (!name || findCharacterByName(doc, name)) {
        unmatched.push(name || '名称なし');
        continue;
      }
      const addedType = clone(source);
      addedType.name = name;
      addedType.id = text(source.id) && !used.has(source.id)
        ? source.id
        : uniqueId('type', name, used);
      used.add(addedType.id);
      doc.scenarioTypes.push(addedType);
      added += 1;
    }
    if (template?.editor && typeof template.editor === 'object') doc.editor = clone(template.editor);
    for (const key of [...TEMPLATE_ROOT_FIELDS, ...(options.rootFields || [])]) {
      if (template?.[key] !== undefined) doc[key] = clone(template[key]);
    }
    syncRoleNames(doc);
    return {
      updated, added, preserved: doc.scenarioTypes.length - updated - added,
      unmatched,
      message: `タイプを${updated}件更新、${added}件追加しました${unmatched.length ? `（照合不能${unmatched.length}件）` : ''}`,
    };
  }

  function validateDocument(doc) {
    const errors = [];
    const warnings = [];
    const ids = new Set();
    const names = new Set();
    for (const item of [...(doc.scenarioTypes || []), ...(doc.characters || [])]) {
      const id = text(item?.id);
      const name = text(item?.name);
      if (!id) errors.push('役割IDがありません');
      else if (ids.has(id)) errors.push(`役割IDが重複しています: ${id}`);
      ids.add(id);
      if (!name) errors.push(`役割名がありません: ${id}`);
      else if (names.has(name)) errors.push(`役割名が重複しています: ${name}`);
      names.add(name);
    }
    for (const character of doc.characters || []) {
      if (character.typeId && !findTypeById(doc, character.typeId)) {
        errors.push(`キャラ「${character.name}」の初期タイプが見つかりません`);
      }
    }
    for (const row of doc.rows || []) {
      const character = resolveRowCharacter(doc, row);
      const type = resolveRowType(doc, row);
      if (!character || !type) warnings.push(`行「${row.id || '?'}」のキャラまたはタイプを解決できません`);
      if (row.character !== (character?.kind === 'character' ? character.name : '')) warnings.push(`行「${row.id || '?'}」のキャラ表示名が参照先と一致しません`);
      if (row.type !== (type?.kind === 'type' ? type.name : '')) warnings.push(`行「${row.id || '?'}」のタイプ表示名が参照先と一致しません`);
    }
    return { valid: errors.length === 0, errors, warnings };
  }

  function prepareForSave(doc, options = {}) {
    const output = normalizeDocument(doc, options);
    syncRoleNames(output);
    const result = validateDocument(output);
    if (!result.valid) throw new Error(`シナリオの保存前検査に失敗しました: ${result.errors.join(' / ')}`);
    return output;
  }

  global.GBScriptNoteRoleModel = Object.freeze({
    SCHEMA_VERSION,
    NONE_REF,
    NONE_LABEL,
    normalizeDocument,
    ensureDocument,
    migrateV2Document,
    findTypeById,
    findTypeByName,
    findCharacterById,
    findCharacterByName,
    resolveRole,
    resolveRowCharacter,
    resolveRowType,
    roleKind,
    getEffectiveRole,
    getEffectiveStyle,
    countTypeLinks,
    buildRoleChoices,
    buildCharacterChoices,
    buildTypeChoices,
    assignRowRole,
    assignRowCharacter,
    assignRowType,
    ensureCharacterForName,
    setCharacterType,
    renameCharacter,
    renameType,
    moveRole,
    syncRoleNames,
    countReferences,
    canDeleteRole,
    deleteRole,
    createTemplate,
    applyTemplate,
    validateDocument,
    prepareForSave,
  });
})(typeof globalThis !== 'undefined' ? globalThis : window);
