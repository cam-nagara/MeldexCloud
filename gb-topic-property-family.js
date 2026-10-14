(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MeldexTopicPropertyFamily = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const DECISIONS = Object.freeze({
    COMMONIZE: 'commonize-existing',
    KEEP_SEPARATE: 'keep-separate',
    CANCEL: 'cancel',
  });
  const TYPE_ALIASES = Object.freeze({
    string: 'text', textarea: 'text', 'long-text': 'text',
    integer: 'number', float: 'number', decimal: 'number',
    select: 'select', 'multi-select': 'multi-select',
    relation: 'relation', user: 'user', image: 'image',
    link: 'multi-link', url: 'multi-link', links: 'multi-link', 'multi-link': 'multi-link',
    formula: 'calculation', computed: 'calculation',
  });

  function clone(value) {
    if (value === undefined) return undefined;
    if (typeof structuredClone === 'function') return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
  }

  function object(value, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new TypeError(`${label} must be an object`);
    }
    return value;
  }

  function requiredString(value, label) {
    if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${label} is required`);
    return value.trim();
  }

  function sha256Hex(text) {
    const bytes = new TextEncoder().encode(text);
    const length = Math.ceil((bytes.length + 9) / 64) * 64;
    const padded = new Uint8Array(length);
    padded.set(bytes);
    padded[bytes.length] = 0x80;
    const view = new DataView(padded.buffer);
    const bitLength = bytes.length * 8;
    view.setUint32(length - 8, Math.floor(bitLength / 0x100000000), false);
    view.setUint32(length - 4, bitLength >>> 0, false);
    const constants = [
      0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
      0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
      0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
      0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
      0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
      0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
      0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
      0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
    ];
    const hash = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
      0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    const words = new Uint32Array(64);
    const rotate = (value, bits) => (value >>> bits) | (value << (32 - bits));
    for (let offset = 0; offset < length; offset += 64) {
      for (let index = 0; index < 16; index += 1) words[index] = view.getUint32(offset + index * 4, false);
      for (let index = 16; index < 64; index += 1) {
        const s0 = rotate(words[index - 15], 7) ^ rotate(words[index - 15], 18) ^ (words[index - 15] >>> 3);
        const s1 = rotate(words[index - 2], 17) ^ rotate(words[index - 2], 19) ^ (words[index - 2] >>> 10);
        words[index] = (words[index - 16] + s0 + words[index - 7] + s1) >>> 0;
      }
      let [a, b, c, d, e, f, g, h] = hash;
      for (let index = 0; index < 64; index += 1) {
        const s1 = rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25);
        const choice = (e & f) ^ (~e & g);
        const first = (h + s1 + choice + constants[index] + words[index]) >>> 0;
        const s0 = rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22);
        const majority = (a & b) ^ (a & c) ^ (b & c);
        const second = (s0 + majority) >>> 0;
        [h, g, f, e, d, c, b, a] = [g, f, e, (d + first) >>> 0, c, b, a, (first + second) >>> 0];
      }
      [a, b, c, d, e, f, g, h].forEach((value, index) => { hash[index] = (hash[index] + value) >>> 0; });
    }
    return hash.map((value) => value.toString(16).padStart(8, '0')).join('');
  }

  function legacyPropertyFamilyId(documentId, propertyId) {
    const document = requiredString(documentId, 'documentId');
    const property = requiredString(propertyId, 'propertyId');
    return `legacy-${sha256Hex(`${document}\0${property}`).slice(0, 24)}`;
  }

  function canonicalType(value) {
    const type = requiredString(value, 'columnType').toLowerCase().replaceAll('_', '-');
    return TYPE_ALIASES[type] || type;
  }

  function typeSettings(column) {
    const source = object(column, 'column');
    const canonical = canonicalType(source.columnType || source.type);
    const config = source.typeConfig || source.config || {};
    if (canonical === 'select' || canonical === 'multi-select') {
      return { options: clone(config.options === undefined ? null : config.options) };
    }
    if (canonical === 'relation') return { relationSetId: config.relationSetId || null,
      targetKinds: clone(config.targetKinds === undefined ? null : config.targetKinds) };
    if (canonical === 'user') return { workspaceId: config.workspaceId || null,
      multiple: config.multiple === undefined ? null : config.multiple };
    if (canonical === 'image') return { assetScope: config.assetScope || null,
      multiple: config.multiple === undefined ? null : config.multiple };
    if (canonical === 'multi-link') return {
      allowedSchemes: clone(config.allowedSchemes === undefined ? null : config.allowedSchemes),
      multiple: config.multiple === undefined ? null : config.multiple,
    };
    if (canonical === 'calculation') return { expression: config.expression || null,
      resultType: config.resultType || null };
    return {};
  }

  function stableSettings(value) {
    const keys = Object.keys(value).sort();
    return JSON.stringify(keys.reduce((result, key) => {
      result[key] = value[key];
      return result;
    }, {}));
  }

  function normalizeColumn(value) {
    const source = object(value, 'column');
    const result = clone(source);
    result.columnId = requiredString(source.columnId || source.id, 'column.columnId');
    result.name = requiredString(source.name, 'column.name');
    result.normalizedName = result.name.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
    result.columnType = canonicalType(source.columnType || source.type);
    result.type = result.columnType;
    result.propertyFamilyId = source.propertyFamilyId == null
      ? null : requiredString(source.propertyFamilyId, 'column.propertyFamilyId');
    result.typeSettings = typeSettings(source);
    const completeConfig = source.typeConfig === undefined ? (source.config || {}) : source.typeConfig;
    result.typeConfig = clone(object(completeConfig, 'column.typeConfig'));
    result.readOnly = result.columnType === 'calculation' || source.readOnly === true;
    return result;
  }

  function normalizePropertyValue(value) {
    const source = object(value, 'TopicPropertyValue');
    const result = clone(source);
    result.propertyFamilyId = requiredString(source.propertyFamilyId, 'propertyFamilyId');
    result.columnType = canonicalType(source.columnType || source.type);
    result.value = clone(source.value);
    result.displayName = typeof source.displayName === 'string' ? source.displayName : '';
    result.typeConfig = clone(object(source.typeConfig === undefined ? {} : source.typeConfig,
      'TopicPropertyValue.typeConfig'));
    result.origins = clone(Array.isArray(source.origins) ? source.origins : []);
    return result;
  }

  function compatibleTypes(left, right) {
    const first = normalizeColumn(left);
    const second = normalizeColumn(right);
    return first.columnType === second.columnType
      && stableSettings(first.typeSettings) === stableSettings(second.typeSettings);
  }

  function findCandidates(editedColumn, existingColumns) {
    const edited = normalizeColumn(editedColumn);
    return (Array.isArray(existingColumns) ? existingColumns : [])
      .map(normalizeColumn)
      .filter((candidate) => candidate.columnId !== edited.columnId
        && candidate.normalizedName === edited.normalizedName
        && !(edited.propertyFamilyId && candidate.propertyFamilyId === edited.propertyFamilyId)
        && compatibleTypes(edited, candidate));
  }

  function columnDecisionModel(editedColumn, existingColumns, context) {
    const edited = normalizeColumn(editedColumn);
    const candidates = findCandidates(edited, existingColumns);
    return {
      required: candidates.length > 0,
      trigger: context?.trigger || 'column-confirm',
      editedColumn: edited,
      candidates,
      choices: candidates.length ? [
        { id: DECISIONS.COMMONIZE, label: '既存の列と共通化' },
        { id: DECISIONS.KEEP_SEPARATE, label: '同名の別の列として保持' },
        { id: DECISIONS.CANCEL, label: 'キャンセル' },
      ] : [],
    };
  }

  function applyColumnDecision(model, decision, candidateId, newFamilyId) {
    if (!model?.required) return { status: 'unchanged', column: clone(model?.editedColumn) };
    if (decision === DECISIONS.CANCEL) return { status: 'cancelled', column: clone(model.editedColumn) };
    if (decision === DECISIONS.KEEP_SEPARATE) {
      const column = clone(model.editedColumn);
      column.propertyFamilyId = requiredString(newFamilyId || column.propertyFamilyId,
        'new propertyFamilyId');
      return { status: 'kept-separate', column };
    }
    if (decision !== DECISIONS.COMMONIZE) throw new TypeError('unknown column decision');
    const candidate = model.candidates.find((item) => item.columnId === candidateId);
    if (!candidate) throw new TypeError('selected candidate was not found');
    const familyId = candidate.propertyFamilyId || requiredString(newFamilyId, 'shared propertyFamilyId');
    const sourceFamilyId = model.editedColumn.propertyFamilyId;
    return {
      status: 'commonized',
      candidate: { ...clone(candidate), propertyFamilyId: familyId },
      column: { ...clone(model.editedColumn), propertyFamilyId: familyId },
      binding: sourceFamilyId ? {
        sourcePropertyFamilyId: sourceFamilyId,
        targetPropertyFamilyId: familyId,
        sourceColumn: clone(model.editedColumn),
        targetColumn: clone(candidate),
        confirmed: true,
      } : null,
    };
  }

  function valuesForColumns(propertyValues, columns) {
    const byFamily = new Map((Array.isArray(propertyValues) ? propertyValues : [])
      .map(normalizePropertyValue).map((value) => [value.propertyFamilyId, value]));
    return (Array.isArray(columns) ? columns : []).map(normalizeColumn).map((column) => {
      const familyId = column.propertyFamilyId && byFamily.has(column.propertyFamilyId)
        ? column.propertyFamilyId
        : column.sourcePropertyFamilyId && byFamily.has(column.sourcePropertyFamilyId)
          ? column.sourcePropertyFamilyId : '';
      return {
        column,
        propertyValue: familyId ? clone(byFamily.get(familyId) || null) : null,
        value: familyId ? clone(byFamily.get(familyId).value) : null,
      };
    });
  }

  return Object.freeze({
    DECISIONS,
    canonicalType,
    normalizeColumn,
    normalizePropertyValue,
    compatibleTypes,
    findCandidates,
    columnDecisionModel,
    applyColumnDecision,
    valuesForColumns,
    legacyPropertyFamilyId,
  });
}));
