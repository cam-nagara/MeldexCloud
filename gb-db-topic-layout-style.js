(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MeldexDbTopicLayoutStyle = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const TEMPLATE_FORMAT = 'meldex-topic-layout/v1';
  const TEMPLATE_EXTENSION = '.meldex-topic-layout.json';
  const SHARED_LIBRARY_KEY = 'meldex.topic-layout-templates.v1';
  const SHARED_LIBRARY_DOCUMENT = 'topic-layout-templates';
  const SHARED_LIBRARY_SCHEMA_VERSION = 1;
  const IMAGE_EMBED_MAX_BYTES = 500 * 1024;
  const LINE_STYLES = new Set(['none', 'solid', 'dashed', 'dotted', 'double']);
  const SHADOWS = new Set(['none', 'small', 'medium']);
  const CAPTION_MODES = new Set(['full', 'icon-only', 'hidden']);
  const VALUE_FIELDS = new Set(['value', 'values', 'entity', 'entityData', 'topic', 'topicRecord', 'record']);

  function clone(value) {
    if (value === undefined) return undefined;
    if (typeof structuredClone === 'function') return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
  }

  function object(value) { return !!value && typeof value === 'object' && !Array.isArray(value); }
  function number(value, fallback, min, max) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, parsed));
  }

  function normalizeFrameStyle(value) {
    const source = object(value) ? value : {};
    const output = clone(source);
    output.lineStyle = LINE_STYLES.has(source.lineStyle) ? source.lineStyle : 'solid';
    output.lineWidth = number(source.lineWidth, output.lineStyle === 'none' ? 0 : 1, 0, 20);
    output.lineColor = typeof source.lineColor === 'string' ? source.lineColor : '';
    output.radius = number(source.radius, 4, 0, 200);
    output.shadow = SHADOWS.has(source.shadow) ? source.shadow : 'none';
    output.padding = number(source.padding, 8, 0, 100);
    return output;
  }

  function normalizeBackground(value, legacyBgColor) {
    const source = object(value) ? value : {};
    const output = clone(source);
    const explicitColor = typeof source.color === 'string' ? source.color : '';
    output.color = explicitColor || (typeof legacyBgColor === 'string' ? legacyBgColor : '');
    output.transparent = source.transparent === true;
    return output;
  }

  function normalizeCaptionMode(value) {
    return CAPTION_MODES.has(value) ? value : 'full';
  }

  function normalizeCellStyleContract(cell) {
    const source = object(cell) ? cell : {};
    const output = clone(source);
    const legacyStyle = object(source.style) ? clone(source.style) : {};
    output.style = legacyStyle;
    output.frameStyle = normalizeFrameStyle(source.frameStyle);
    output.background = normalizeBackground(source.background, legacyStyle.bgColor);
    output.captionMode = normalizeCaptionMode(source.captionMode);
    return output;
  }

  function applyCellStyle(element, cell, options) {
    if (!element || !element.style) return normalizeCellStyleContract(cell);
    const normalized = normalizeCellStyleContract(cell);
    const frame = normalized.frameStyle;
    const background = normalized.background;
    element.style.borderStyle = frame.lineStyle === 'none' ? 'none' : frame.lineStyle;
    element.style.borderWidth = frame.lineStyle === 'none' ? '0' : `${frame.lineWidth}px`;
    element.style.borderColor = frame.lineColor || 'var(--el-border, var(--border))';
    element.style.borderRadius = `${frame.radius}px`;
    if (typeof element.style.setProperty === 'function') {
      element.style.setProperty('--topic-layout-cell-padding', `${frame.padding}px`);
    }
    element.style.boxShadow = frame.shadow === 'medium'
      ? '0 8px 24px rgba(0,0,0,.24)'
      : frame.shadow === 'small' ? '0 2px 8px rgba(0,0,0,.16)' : 'none';
    element.style.background = background.transparent ? 'transparent' : (background.color || '');
    const editBoundary = frame.lineStyle === 'none' && options && options.editMode === true;
    if (element.classList && typeof element.classList.toggle === 'function') {
      element.classList.toggle('topic-layout-edit-boundary', editBoundary);
    }
    return normalized;
  }

  function applyCaptionMode(captionElement, captionTextElement, valueElement, cell, accessibleName) {
    const mode = normalizeCaptionMode(cell && cell.captionMode);
    const label = String(accessibleName || (cell && cell.prop) || '列');
    if (captionElement) {
      captionElement.hidden = mode === 'hidden';
      captionElement.dataset.captionMode = mode;
      captionElement.setAttribute('aria-label', label);
    }
    if (captionTextElement) captionTextElement.hidden = mode !== 'full';
    if (valueElement) valueElement.setAttribute('aria-label', label);
    return mode;
  }

  function createStyleControls(doc, cell, onChange) {
    if (!doc || typeof doc.createElement !== 'function') throw new TypeError('document is required');
    let current = normalizeCellStyleContract(cell);
    const root = doc.createElement('div');
    root.className = 'topic-layout-cell-style-controls';
    const emit = () => { if (typeof onChange === 'function') onChange(clone(current)); };
    const select = (label, value, choices, update) => {
      const control = doc.createElement('select');
      for (const [key, text] of choices) {
        const option = doc.createElement('option'); option.value = key; option.textContent = text; control.appendChild(option);
      }
      control.value = value;
      control.addEventListener('change', () => { update(control.value); emit(); });
      appendControlRow(doc, root, label, control);
    };
    const input = (label, type, value, update, attributes) => {
      const control = doc.createElement('input'); control.type = type; control.value = String(value ?? '');
      for (const [key, attributeValue] of Object.entries(attributes || {})) control.setAttribute(key, String(attributeValue));
      control.addEventListener('change', () => { update(type === 'number' ? Number(control.value) : control.value); emit(); });
      appendControlRow(doc, root, label, control);
    };
    select('枠線', current.frameStyle.lineStyle,
      [['none', 'なし'], ['solid', '実線'], ['dashed', '破線'], ['dotted', '点線'], ['double', '二重線']],
      value => { current.frameStyle.lineStyle = value; });
    input('枠線の幅', 'number', current.frameStyle.lineWidth, value => { current.frameStyle.lineWidth = number(value, 1, 0, 20); }, { min: 0, max: 20 });
    input('枠線の色', 'text', current.frameStyle.lineColor, value => { current.frameStyle.lineColor = value; });
    input('角丸', 'number', current.frameStyle.radius, value => { current.frameStyle.radius = number(value, 0, 0, 200); }, { min: 0, max: 200 });
    select('影', current.frameStyle.shadow, [['none', 'なし'], ['small', '小'], ['medium', '中']], value => { current.frameStyle.shadow = value; });
    input('内側余白', 'number', current.frameStyle.padding, value => { current.frameStyle.padding = number(value, 8, 0, 100); }, { min: 0, max: 100 });
    input('背景色', 'text', current.background.color, value => { current.background.color = value; });
    const transparent = doc.createElement('input'); transparent.type = 'checkbox'; transparent.checked = current.background.transparent;
    transparent.addEventListener('change', () => { current.background.transparent = transparent.checked; emit(); });
    appendControlRow(doc, root, '背景を透明にする', transparent);
    select('キャプション', current.captionMode,
      [['full', 'アイコンと列名'], ['icon-only', 'アイコンのみ'], ['hidden', '非表示']],
      value => { current.captionMode = value; });
    return root;
  }

  function appendControlRow(doc, root, labelText, control) {
    const label = doc.createElement('label'); label.className = 'el-popup-row';
    const text = doc.createElement('span'); text.textContent = labelText; label.appendChild(text); label.appendChild(control); root.appendChild(label);
  }

  function sanitizeTemplateCell(cell) {
    const normalized = normalizeCellStyleContract(cell);
    for (const field of VALUE_FIELDS) delete normalized[field];
    return normalized;
  }

  function sanitizeTemplateLayout(layout) {
    if (!object(layout)) throw new TypeError('layout must be an object');
    const output = clone(layout);
    for (const field of VALUE_FIELDS) delete output[field];
    output.name = String(layout.name || '').trim() || 'トピックレイアウト';
    output.cells = (Array.isArray(layout.cells) ? layout.cells : []).map(sanitizeTemplateCell);
    return output;
  }

  function exportTemplate(layout, columns, options) {
    const template = {
      format: TEMPLATE_FORMAT,
      schemaVersion: 1,
      layout: sanitizeTemplateLayout(layout),
      columns: (Array.isArray(columns) ? columns : []).map(column => ({
        id: String(column && column.id || ''),
        name: String(column && column.name || ''),
      })),
    };
    if (object(options) && object(options.metadata)) template.metadata = clone(options.metadata);
    return template;
  }

  function listTemplateUploadImages(template) {
    const layout = template && template.layout;
    return (Array.isArray(layout && layout.cells) ? layout.cells : [])
      .filter(cell => cell?.type === 'image' && cell.image?.source === 'upload' && (cell.image.path || cell.image.url))
      .map(cell => ({ layoutName: String(layout.name || ''), cellId: String(cell.id || ''), path: String(cell.image.path || ''), cell }));
  }

  function mapTemplateColumns(template, targetColumns) {
    const sourceColumns = new Map((Array.isArray(template && template.columns) ? template.columns : [])
      .map(column => [String(column && column.id || ''), column]));
    const targets = Array.isArray(targetColumns) ? targetColumns : [];
    const byId = new Map(targets.filter(column => column && column.id).map(column => [String(column.id), column]));
    const byName = new Map();
    for (const column of targets) {
      const name = String(column && column.name || '');
      if (!name) continue;
      if (!byName.has(name)) byName.set(name, []);
      byName.get(name).push(column);
    }
    const mappings = [];
    const layout = template && template.layout;
    for (const cell of Array.isArray(layout && layout.cells) ? layout.cells : []) {
      if (cell.type !== 'field') continue;
      const sourceId = String(cell.columnId || cell.propId || '');
      const sourceColumn = sourceColumns.get(sourceId);
      const sourceName = String(cell.prop || cell.columnName || (sourceColumn && sourceColumn.name) || '');
      let target = sourceId ? byId.get(sourceId) : null;
      let match = target ? 'id' : '';
      if (!target && sourceName && (byName.get(sourceName) || []).length === 1) {
        target = byName.get(sourceName)[0];
        match = 'name';
      }
      mappings.push({ cellId: String(cell.id || ''), sourceId, sourceName, target: clone(target || null), match: match || 'unresolved' });
    }
    return mappings;
  }

  function importTemplate(template, currentLayouts, targetColumns, options) {
    if (!object(template) || template.format !== TEMPLATE_FORMAT || !object(template.layout)) {
      throw new TypeError('トピックレイアウトテンプレートの形式が不正です');
    }
    const layouts = Array.isArray(currentLayouts) ? currentLayouts : [];
    const layout = sanitizeTemplateLayout(template.layout);
    if (layouts.some(item => String(item && item.name || '') === layout.name)) {
      return { added: false, reason: 'duplicate-name', layout: null, mappings: mapTemplateColumns(template, targetColumns) };
    }
    const opts = object(options) ? options : {};
    const idFactory = typeof opts.idFactory === 'function'
      ? opts.idFactory
      : prefix => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    layout.id = idFactory('layout');
    const mappings = mapTemplateColumns(template, targetColumns);
    const mappingByCell = new Map(mappings.map(item => [item.cellId, item]));
    layout.cells = layout.cells.map(cell => {
      const output = clone(cell);
      const sourceCellId = String(cell.id || '');
      output.id = idFactory('cell');
      const mapping = mappingByCell.get(sourceCellId);
      if (cell.type === 'field') {
        if (mapping && mapping.target) {
          output.columnId = String(mapping.target.id || '');
          output.prop = String(mapping.target.name || '');
          delete output.unresolvedColumn;
        } else {
          output.unresolvedColumn = { id: mapping && mapping.sourceId || '', name: mapping && mapping.sourceName || '' };
        }
      }
      return output;
    });
    return { added: true, reason: '', layout, mappings };
  }

  function _templateStorage(storage) {
    if (storage && typeof storage.getItem === 'function' && typeof storage.setItem === 'function') return storage;
    try { return globalThis.localStorage || null; } catch { return null; }
  }

  function loadSharedTemplates(storage) {
    const target = _templateStorage(storage);
    if (!target) return [];
    try {
      const parsed = JSON.parse(target.getItem(SHARED_LIBRARY_KEY) || '[]');
      return Array.isArray(parsed)
        ? parsed.filter(item => object(item) && item.format === TEMPLATE_FORMAT && object(item.layout)).map(clone)
        : [];
    } catch {
      return [];
    }
  }

  function saveSharedTemplate(template, storage) {
    if (!object(template) || template.format !== TEMPLATE_FORMAT || !object(template.layout)) {
      throw new TypeError('トピックレイアウトテンプレートの形式が不正です');
    }
    const target = _templateStorage(storage);
    if (!target) throw new Error('共有テンプレートの保存先を利用できません');
    const templates = loadSharedTemplates(target);
    const name = String(template.layout.name || '').trim();
    if (templates.some(item => String(item.layout?.name || '').trim() === name)) {
      return { saved: false, reason: 'duplicate-name', templates };
    }
    templates.push(clone(template));
    target.setItem(SHARED_LIBRARY_KEY, JSON.stringify(templates));
    return { saved: true, reason: '', templates };
  }

  function removeSharedTemplate(name, storage) {
    const target = _templateStorage(storage);
    if (!target) throw new Error('共有テンプレートの保存先を利用できません');
    const normalizedName = String(name || '').trim();
    const templates = loadSharedTemplates(target);
    const next = templates.filter(item => String(item.layout?.name || '').trim() !== normalizedName);
    if (next.length === templates.length) return { removed: false, templates };
    target.setItem(SHARED_LIBRARY_KEY, JSON.stringify(next));
    return { removed: true, templates: next };
  }

  function _sharedLibraryFetcher(explicitFetcher) {
    if (typeof explicitFetcher === 'function') return explicitFetcher;
    return typeof globalThis.apiFetch === 'function' ? globalThis.apiFetch : null;
  }

  function _validSharedTemplates(value) {
    return (Array.isArray(value) ? value : [])
      .filter(item => object(item) && item.format === TEMPLATE_FORMAT && object(item.layout))
      .map(clone);
  }

  function _mergeSharedTemplates(primary, fallback) {
    const output = [];
    const names = new Set();
    [..._validSharedTemplates(primary), ..._validSharedTemplates(fallback)].forEach((template) => {
      const name = String(template.layout?.name || '').trim();
      if (!name || names.has(name)) return;
      names.add(name);
      output.push(template);
    });
    return output;
  }

  function _cacheSharedTemplates(templates, storage) {
    const target = _templateStorage(storage);
    if (!target) return false;
    target.setItem(SHARED_LIBRARY_KEY, JSON.stringify(_validSharedTemplates(templates)));
    return true;
  }

  async function _readSharedLibrary(fetcher) {
    const response = await fetcher(`/personal-preferences/${SHARED_LIBRARY_DOCUMENT}`, { silentError: true });
    const payload = object(response?.payload) ? response.payload : {};
    return {
      available: response?.available !== false,
      exists: response?.exists === true,
      revision: response?.revision || null,
      templates: _validSharedTemplates(payload.templates),
    };
  }

  async function loadSharedTemplateLibrary(options) {
    const opts = object(options) ? options : {};
    const cached = loadSharedTemplates(opts.storage);
    const fetcher = _sharedLibraryFetcher(opts.fetcher);
    if (!fetcher) return { available: false, source: 'device-cache', revision: null, templates: cached };
    try {
      const remote = await _readSharedLibrary(fetcher);
      if (!remote.available) return { ...remote, source: 'device-cache', templates: cached };
      const templates = _mergeSharedTemplates(remote.templates, cached);
      _cacheSharedTemplates(templates, opts.storage);
      return { ...remote, source: 'personal-library', templates };
    } catch (error) {
      return { available: false, source: 'device-cache', revision: null, templates: cached, error };
    }
  }

  function _isConflict(error) {
    return Number(error?.status || error?.response?.status || 0) === 409
      || /(?:HTTP\s*)?409|競合/.test(String(error?.message || ''));
  }

  async function _putSharedLibrary(fetcher, templates, revision) {
    return fetcher(`/personal-preferences/${SHARED_LIBRARY_DOCUMENT}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, silentError: true,
      body: JSON.stringify({
        payload: { schemaVersion: SHARED_LIBRARY_SCHEMA_VERSION, templates: _validSharedTemplates(templates) },
        expectedRevision: revision || null,
      }),
    });
  }

  async function saveSharedTemplateToLibrary(template, options) {
    if (!object(template) || template.format !== TEMPLATE_FORMAT || !object(template.layout)) {
      throw new TypeError('トピックレイアウトテンプレートの形式が不正です');
    }
    const opts = object(options) ? options : {};
    const name = String(template.layout.name || '').trim();
    const fetcher = _sharedLibraryFetcher(opts.fetcher);
    const saveToDevice = (templates) => {
      _cacheSharedTemplates(templates, opts.storage);
      return { saved: true, shared: false, source: 'device-cache', templates };
    };
    if (!fetcher) {
      const cached = loadSharedTemplates(opts.storage);
      if (cached.some(item => String(item.layout?.name || '').trim() === name)) {
        return { saved: false, shared: false, reason: 'duplicate-name', templates: cached };
      }
      return saveToDevice([...cached, clone(template)]);
    }

    for (let attempt = 0; attempt < 2; attempt += 1) {
      let remote;
      try {
        remote = await _readSharedLibrary(fetcher);
      } catch (error) {
        if (attempt === 0 && _isConflict(error)) continue;
        const cached = loadSharedTemplates(opts.storage);
        if (cached.some(item => String(item.layout?.name || '').trim() === name)) {
          return { saved: false, shared: false, reason: 'duplicate-name', templates: cached, error };
        }
        return { ...saveToDevice([...cached, clone(template)]), error };
      }
      const current = _mergeSharedTemplates(remote.templates, loadSharedTemplates(opts.storage));
      if (current.some(item => String(item.layout?.name || '').trim() === name)) {
        return { saved: false, shared: remote.available, reason: 'duplicate-name', templates: current };
      }
      const next = [...current, clone(template)];
      if (!remote.available) return saveToDevice(next);
      try {
        const saved = await _putSharedLibrary(fetcher, next, remote.revision);
        if (saved?.available === false) return saveToDevice(next);
        _cacheSharedTemplates(next, opts.storage);
        return { saved: true, shared: true, source: 'personal-library', revision: saved?.revision || null, templates: next };
      } catch (error) {
        if (attempt === 0 && _isConflict(error)) continue;
        return { ...saveToDevice(next), error };
      }
    }
    throw new Error('共有テンプレートの競合を解消できませんでした');
  }

  return Object.freeze({
    CAPTION_MODES: Object.freeze([...CAPTION_MODES]),
    LINE_STYLES: Object.freeze([...LINE_STYLES]),
    SHADOWS: Object.freeze([...SHADOWS]),
    IMAGE_EMBED_MAX_BYTES,
    SHARED_LIBRARY_KEY,
    SHARED_LIBRARY_DOCUMENT,
    TEMPLATE_EXTENSION,
    TEMPLATE_FORMAT,
    applyCaptionMode,
    applyCellStyle,
    createStyleControls,
    exportTemplate,
    importTemplate,
    loadSharedTemplateLibrary,
    loadSharedTemplates,
    listTemplateUploadImages,
    mapTemplateColumns,
    normalizeBackground,
    normalizeCaptionMode,
    normalizeCellStyleContract,
    normalizeFrameStyle,
    removeSharedTemplate,
    saveSharedTemplate,
    saveSharedTemplateToLibrary,
    sanitizeTemplateLayout,
  });
});
