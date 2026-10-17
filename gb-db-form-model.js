/* Shared form semantics. Layout coordinates and topic values remain independent. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MeldexDbFormModel = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const clone = value => JSON.parse(JSON.stringify(value));
  const object = value => value && typeof value === 'object' && !Array.isArray(value);
  const unique = values => [...new Set((Array.isArray(values) ? values : []).filter(value => typeof value === 'string' && value))];
  const scalarTypes = new Set(['text', 'long-text', 'number', 'date', 'checkbox', 'select', 'multi-select']);
  function layoutFields(layout) {
    return unique((layout?.cells || []).filter(cell => cell.type === 'field').map(cell => cell.prop));
  }
  function normalize(source, fields) {
    const src = object(source) ? clone(source) : {};
    if (Number(src.schemaVersion) > 1) throw new Error('新しい版のフォーム設定です。更新してから編集してください');
    const available = unique(fields || src.fields || []);
    const order = Array.isArray(src.fields) ? unique(src.fields).filter(name => available.includes(name)) : available;
    return { ...src, schemaVersion: 1, fields: order,
      required: unique(src.required || []).filter(name => order.includes(name)),
      labels: object(src.labels) ? src.labels : {}, descriptions: object(src.descriptions) ? src.descriptions : {},
      placeholders: object(src.placeholders) ? src.placeholders : {},
      rules: (Array.isArray(src.rules) ? src.rules : []).filter(rule => object(rule) && order.includes(rule.property)),
    };
  }
  function forLayout(layout, fallback) {
    return normalize(layout?.formConfig || fallback, layoutFields(layout));
  }
  function ruleFor(config, name, sheetRules = []) {
    const result = { required: (config?.required || []).includes(name) };
    (sheetRules || []).filter(rule => rule?.enabled !== false && (rule.property || rule.config?.property) === name && !rule.config?.statusFilter).forEach(rule => {
      if (rule.type === 'required') result.required = true;
      if (rule.type === 'range_check') {
        if (rule.min !== undefined && rule.min !== '') result.min = rule.min;
        if (rule.max !== undefined && rule.max !== '') result.max = rule.max;
      }
    });
    const merged = Object.assign({}, result, (config?.rules || []).find(rule => rule.property === name) || {});
    merged.required = result.required || merged.required === true;
    return merged;
  }
  function validate(name, value, type, rule) {
    const label = name || '項目';
    const raw = value == null ? '' : String(value).trim();
    if (rule?.required && (type === 'checkbox' ? !['true', '1'].includes(raw) : !raw)) return label + ' は必須です';
    if (!raw) return '';
    if (type === 'number') {
      const number = Number(raw.replace(/,/g, ''));
      if (!Number.isFinite(number)) return label + ' は数値を入力してください';
      if (rule?.min !== undefined && rule.min !== '' && number < Number(rule.min)) return label + ' は ' + rule.min + ' 以上で入力してください';
      if (rule?.max !== undefined && rule.max !== '' && number > Number(rule.max)) return label + ' は ' + rule.max + ' 以下で入力してください';
    }
    if (rule?.minLength > 0 && [...raw].length < rule.minLength) return label + ' は ' + rule.minLength + ' 文字以上で入力してください';
    if (rule?.maxLength !== undefined && rule.maxLength !== '' && Number(rule.maxLength) >= 0 && [...raw].length > Number(rule.maxLength)) return label + ' は ' + rule.maxLength + ' 文字以内で入力してください';
    return '';
  }
  function validateDefinition(config) {
    for (const rule of config?.rules || []) {
      for (const key of ['min', 'max', 'minLength', 'maxLength']) {
        if (rule[key] !== undefined && rule[key] !== '' && !Number.isFinite(Number(rule[key]))) return rule.property + ': 入力範囲は数値を指定してください';
        if (key.endsWith('Length') && rule[key] !== undefined && rule[key] !== '' && (!Number.isInteger(Number(rule[key])) || Number(rule[key]) < 0)) return rule.property + ': 文字数は0以上の整数を指定してください';
      }
      if (rule.min !== undefined && rule.max !== undefined && Number(rule.min) > Number(rule.max)
        || rule.minLength !== undefined && rule.maxLength !== undefined && Number(rule.minLength) > Number(rule.maxLength)) return rule.property + ': 最小値は最大値以下にしてください';
    }
    return '';
  }
  function orderedCells(layout) {
    const order = forLayout(layout).fields;
    return (layout?.cells || []).map((cell, index) => ({ cell, index })).sort((a, b) => {
      const rank = item => item.cell.type === 'field' && order.includes(item.cell.prop) ? order.indexOf(item.cell.prop) : order.length + item.index;
      return rank(a) - rank(b) || a.index - b.index;
    }).map(item => item.cell);
  }
  function arrange(cells, selectedIds, action, groupId) {
    const output = clone(cells || []);
    const selected = output.filter(cell => selectedIds.includes(cell.id));
    if (action === 'lock' || action === 'unlock') {
      selected.forEach(cell => { cell.locked = action === 'lock'; }); return output;
    }
    const items = selected.filter(cell => !cell.locked);
    if (action === 'group' || action === 'ungroup') {
      items.forEach(cell => { if (action === 'group') cell.groupId = groupId; else delete cell.groupId; }); return output;
    }
    if (items.length < 2) return output;
    const left = Math.min(...items.map(cell => cell.x)), top = Math.min(...items.map(cell => cell.y));
    const right = Math.max(...items.map(cell => cell.x + cell.w)), bottom = Math.max(...items.map(cell => cell.y + cell.h));
    const width = items[0].w, height = items[0].h;
    items.forEach(cell => {
      if (action === 'left') cell.x = left;
      if (action === 'right') cell.x = right - cell.w;
      if (action === 'top') cell.y = top;
      if (action === 'bottom') cell.y = bottom - cell.h;
      if (action === 'center') cell.x = Math.round((left + right - cell.w) / 2);
      if (action === 'middle') cell.y = Math.round((top + bottom - cell.h) / 2);
      if (action === 'width') cell.w = width;
      if (action === 'height') cell.h = height;
    });
    if (items.length > 2 && ['horizontal', 'vertical'].includes(action)) {
      const axis = action === 'horizontal' ? 'x' : 'y', size = axis === 'x' ? 'w' : 'h';
      const sorted = [...items].sort((a, b) => a[axis] - b[axis]);
      const first = sorted[0][axis], last = sorted.at(-1)[axis] + sorted.at(-1)[size];
      const gap = (last - first - sorted.reduce((sum, cell) => sum + cell[size], 0)) / (items.length - 1);
      let position = first;
      sorted.forEach(cell => { cell[axis] = Math.max(0, Math.round(position)); position += cell[size] + gap; });
    }
    return output;
  }
  return Object.freeze({ normalize, forLayout, layoutFields, ruleFor, validate, validateDefinition, orderedCells, arrange,
    supportsScalar: type => scalarTypes.has(type || 'text') });
});
