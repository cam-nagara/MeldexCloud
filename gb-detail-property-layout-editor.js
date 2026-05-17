/* エントリ詳細プロパティレイアウト */
const _propertyLayoutMetadataCache = {};
const _PROPERTY_LAYOUT_GLOBAL_TEMPLATES_KEY = 'gb:property-layout-templates';

function _propertyLayoutPathKey(dbPath) {
  return String(dbPath || '').replace(/\\/g, '/');
}

function _propertyLayoutIsCurrentDb(dbPath) {
  return typeof _ptIsCurrentDbPath === 'function'
    ? _ptIsCurrentDbPath(dbPath)
    : (!dbPath || !state.currentDbPath || _propertyLayoutPathKey(dbPath) === _propertyLayoutPathKey(state.currentDbPath));
}

function _propertyLayoutCachedMetadata(dbPath) {
  if (_propertyLayoutIsCurrentDb(dbPath)) {
    return {
      property_layout: state.dbMetadata?.property_layout || null,
      property_layout_templates: Array.isArray(state.dbMetadata?.property_layout_templates) ? state.dbMetadata.property_layout_templates : [],
    };
  }
  return _propertyLayoutMetadataCache[_propertyLayoutPathKey(dbPath)] || null;
}

function _propertyLayoutSetCachedMetadata(dbPath, metadata) {
  const next = {
    property_layout: metadata?.property_layout || null,
    property_layout_templates: Array.isArray(metadata?.property_layout_templates) ? metadata.property_layout_templates : [],
  };
  if (_propertyLayoutIsCurrentDb(dbPath)) {
    if (!state.dbMetadata) state.dbMetadata = {};
    state.dbMetadata.property_layout = next.property_layout;
    state.dbMetadata.property_layout_templates = next.property_layout_templates;
  } else {
    _propertyLayoutMetadataCache[_propertyLayoutPathKey(dbPath)] = next;
  }
  return next;
}

async function _loadPropertyLayoutMetadata(dbPath, options = {}) {
  if (!dbPath) return _propertyLayoutSetCachedMetadata(dbPath, {});
  if (!options.force) {
    const cached = _propertyLayoutCachedMetadata(dbPath);
    if (cached) return cached;
  }
  try {
    const metadata = await apiFetch('/db-metadata?path=' + encodeURIComponent(dbPath));
    return _propertyLayoutSetCachedMetadata(dbPath, metadata || {});
  } catch (err) {
    console.warn('property_layout 読み込み失敗:', err);
    return _propertyLayoutCachedMetadata(dbPath) || {};
  }
}

async function getPropertyLayoutForEdit(dbPath, allProps) {
  await _loadPropertyLayoutMetadata(dbPath, { force: !_propertyLayoutIsCurrentDb(dbPath) });
  return getPropertyLayout(dbPath, allProps);
}

function normalizePropertyLayout(layout, allProps) {
  const src = layout && typeof layout === 'object' ? layout : {};
  const existing = new Set(Array.isArray(allProps) ? allProps : []);
  const order = Array.isArray(src.order) ? src.order.filter(p => !existing.size || existing.has(p)) : [];
  if (existing.size) {
    allProps.forEach(p => { if (!order.includes(p)) order.push(p); });
  }
  const hidden = Array.isArray(src.hidden) ? src.hidden.filter(p => !existing.size || existing.has(p)) : [];
  const groups = Array.isArray(src.groups)
    ? src.groups.map(g => ({
      title: String(g?.title || '').trim(),
      props: Array.isArray(g?.props) ? g.props.filter(p => !existing.size || existing.has(p)) : [],
    })).filter(g => g.title || g.props.length)
    : [];
  return { order, hidden, groups };
}

function getPropertyLayout(dbPath, allProps) {
  const backend = _propertyLayoutCachedMetadata(dbPath)?.property_layout || null;
  const local = dbPath && typeof getDbViewConfig === 'function' ? getDbViewConfig(dbPath).propertyLayout : null;
  return normalizePropertyLayout(backend || local || null, allProps || []);
}

async function savePropertyLayout(dbPath, layout) {
  if (!dbPath) return false;
  const normalized = normalizePropertyLayout(layout);
  try {
    await apiPut('/db-metadata?path=' + encodeURIComponent(dbPath), { property_layout: normalized });
    const cfg = getDbViewConfig(dbPath);
    cfg.propertyLayout = normalized;
    cfg.entryPropOrder = normalized.order;
    saveDbViewConfig(dbPath, cfg);
    const metadata = _propertyLayoutCachedMetadata(dbPath) || {};
    _propertyLayoutSetCachedMetadata(dbPath, { ...metadata, property_layout: normalized });
    return true;
  } catch (err) {
    console.warn('property_layout 保存失敗:', err);
    showStatus('プロパティレイアウトを保存できませんでした', true);
    return false;
  }
}

function applyPropertyLayout(propNames, layout) {
  const source = Array.isArray(propNames) ? propNames : [];
  const normalized = normalizePropertyLayout(layout, source);
  const hidden = new Set(normalized.hidden || []);
  const ordered = normalized.order.filter(p => source.includes(p) && !hidden.has(p));
  source.forEach(p => { if (!ordered.includes(p) && !hidden.has(p)) ordered.push(p); });
  if (!normalized.groups?.length) return [{ title: '', props: ordered }];
  const used = new Set();
  const groups = [];
  normalized.groups.forEach(group => {
    const props = (group.props || []).filter(p => ordered.includes(p) && !used.has(p));
    props.forEach(p => used.add(p));
    if (props.length) groups.push({ title: group.title || '', props });
  });
  const rest = ordered.filter(p => !used.has(p));
  if (rest.length) groups.push({ title: '', props: rest });
  return groups;
}

function renamePropertyLayoutReferences(layout, oldName, newName) {
  const next = normalizePropertyLayout(layout);
  const rename = p => p === oldName ? newName : p;
  next.order = next.order.map(rename);
  next.hidden = next.hidden.map(rename);
  next.groups = next.groups.map(g => ({ ...g, props: (g.props || []).map(rename) }));
  return normalizePropertyLayout(next);
}

function removePropertyLayoutReferences(layout, propName) {
  const next = normalizePropertyLayout(layout);
  const keep = p => p !== propName;
  next.order = next.order.filter(keep);
  next.hidden = next.hidden.filter(keep);
  next.groups = next.groups.map(g => ({ ...g, props: (g.props || []).filter(keep) })).filter(g => g.title || g.props.length);
  return normalizePropertyLayout(next);
}

async function updatePropertyLayoutForRename(dbPath, oldName, newName) {
  if (!dbPath || !oldName || !newName || oldName === newName) return;
  const current = await getPropertyLayoutForEdit(dbPath);
  await savePropertyLayout(dbPath, renamePropertyLayoutReferences(current, oldName, newName));
}

async function updatePropertyLayoutForDelete(dbPath, propName) {
  if (!dbPath || !propName) return;
  const current = await getPropertyLayoutForEdit(dbPath);
  await savePropertyLayout(dbPath, removePropertyLayoutReferences(current, propName));
}

function isPropertyLayoutEditMode(dbPath) {
  return sessionStorage.getItem('gb:prop-layout-edit:' + (dbPath || '')) === '1';
}

function setPropertyLayoutEditMode(dbPath, enabled) {
  const key = 'gb:prop-layout-edit:' + (dbPath || '');
  if (enabled) sessionStorage.setItem(key, '1');
  else sessionStorage.removeItem(key);
}

function _nextLayoutTemplateName(existing) {
  const names = new Set((existing || []).map(t => t.name));
  let i = 1;
  while (names.has('レイアウト ' + i)) i++;
  return 'レイアウト ' + i;
}

async function _loadGlobalPropertyLayoutTemplates() {
  try {
    const res = await apiFetch('/property-layout-templates');
    const templates = Array.isArray(res.templates) ? res.templates : [];
    try { localStorage.setItem(_PROPERTY_LAYOUT_GLOBAL_TEMPLATES_KEY, JSON.stringify(templates)); } catch {}
    return templates;
  } catch {
    try {
      const parsed = JSON.parse(localStorage.getItem(_PROPERTY_LAYOUT_GLOBAL_TEMPLATES_KEY) || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
}

async function _saveGlobalPropertyLayoutTemplates(templates) {
  const normalized = Array.isArray(templates) ? templates : [];
  try {
    await apiPut('/property-layout-templates', { templates: normalized });
  } catch (err) {
    console.warn('property_layout_templates 全体保存失敗。ローカル保存に切り替えます:', err);
  }
  try { localStorage.setItem(_PROPERTY_LAYOUT_GLOBAL_TEMPLATES_KEY, JSON.stringify(normalized)); } catch {}
  return true;
}

function _sheetPropertyLayoutTemplates(dbPath) {
  return _propertyLayoutCachedMetadata(dbPath)?.property_layout_templates || [];
}

async function _saveSheetPropertyLayoutTemplates(dbPath, templates) {
  const normalized = Array.isArray(templates) ? templates : [];
  try {
    await apiPut('/db-metadata?path=' + encodeURIComponent(dbPath), { property_layout_templates: normalized });
    const metadata = _propertyLayoutCachedMetadata(dbPath) || {};
    _propertyLayoutSetCachedMetadata(dbPath, { ...metadata, property_layout_templates: normalized });
    return true;
  } catch (err) {
    console.warn('property_layout_templates 保存失敗:', err);
    showStatus('レイアウトテンプレートを保存できませんでした', true);
    return false;
  }
}

function _ensurePropertyLayoutMetadataForRender(grid, data, entityPath, opts, dbPath) {
  if (!grid || !dbPath || _propertyLayoutCachedMetadata(dbPath) || grid.dataset.propLayoutMetadataLoading === '1') return;
  grid.dataset.propLayoutMetadataLoading = '1';
  _loadPropertyLayoutMetadata(dbPath, { force: true }).then(metadata => {
    delete grid.dataset.propLayoutMetadataLoading;
    if (!metadata || !grid.isConnected || typeof renderEntityPropsGridInto !== 'function') return;
    renderEntityPropsGridInto(grid, data, entityPath, opts);
  }).catch(() => {
    delete grid.dataset.propLayoutMetadataLoading;
  });
}

function renderPropertyLayoutToolbar(grid, data, entityPath, opts) {
  const dbPath = opts?.parentDb || (typeof _entityParentDir === 'function' ? _entityParentDir(entityPath) : '');
  if (!grid || !dbPath) return;
  _ensurePropertyLayoutMetadataForRender(grid, data, entityPath, opts, dbPath);
  const editMode = isPropertyLayoutEditMode(dbPath);
  const toolbar = document.createElement('div');
  toolbar.className = 'gb-prop-layout-toolbar';
  toolbar.dataset.dbPath = dbPath;
  const contextToken = opts.subPanel
    ? 'subpanel'
    : (grid.id || grid.closest?.('[data-pane-id]')?.dataset?.paneId || grid.className || 'main');
  const scopeId = String([dbPath || 'db', entityPath || '', contextToken].filter(Boolean).join('-'))
    .replace(/[^A-Za-z0-9_-]+/g, '-');
  const btn = (label, icon, action) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'gb-btn gb-btn-sm';
    const slug = {
      '完了': 'done',
      '並べ替え': 'reorder',
      'テンプレート保存': 'save-template',
      'テンプレート適用': 'apply-template',
      'リセット': 'reset',
    }[label] || String(label || 'button').replace(/[^A-Za-z0-9_-]+/g, '-');
    b.dataset.e2eId = `prop-layout-${slug}-${scopeId}`;
    b.setAttribute('aria-label', label);
    b.innerHTML = (typeof lucide === 'function' ? lucide(icon, 13) + ' ' : '') + label;
    b.addEventListener('click', action);
    return b;
  };
  toolbar.appendChild(btn(editMode ? '完了' : '並べ替え', editMode ? 'check' : 'listOrdered', () => {
    setPropertyLayoutEditMode(dbPath, !editMode);
    renderEntityPropsGridInto(grid, data, entityPath, opts);
  }));
  if (editMode) {
    const scope = document.createElement('select');
    scope.className = 'gb-select gb-select-sm';
    scope.dataset.e2eId = `prop-layout-scope-${scopeId}`;
    scope.setAttribute('aria-label', 'レイアウト保存範囲');
    scope.innerHTML = '<option value="sheet">シート</option><option value="global">全体</option>';
    toolbar.appendChild(scope);
    toolbar.appendChild(btn('テンプレート保存', 'save', async () => {
      const layout = await getPropertyLayoutForEdit(dbPath, Object.keys(data.properties || {}));
      const now = new Date().toISOString();
      if (scope.value === 'global') {
        const list = await _loadGlobalPropertyLayoutTemplates();
        list.push({ id: 'plt_' + Date.now(), name: _nextLayoutTemplateName(list), scope: 'global', ...layout, created_at: now, modified_at: now });
        await _saveGlobalPropertyLayoutTemplates(list);
      } else {
        await _loadPropertyLayoutMetadata(dbPath, { force: !_propertyLayoutIsCurrentDb(dbPath) });
        const list = _sheetPropertyLayoutTemplates(dbPath).slice();
        list.push({ id: 'plt_' + Date.now(), name: _nextLayoutTemplateName(list), scope: 'sheet', ...layout, created_at: now, modified_at: now });
        if (!await _saveSheetPropertyLayoutTemplates(dbPath, list)) return;
      }
      showStatus('レイアウトテンプレートを保存しました');
    }));
    toolbar.appendChild(btn('テンプレート適用', 'layoutTemplate', async () => {
      await _loadPropertyLayoutMetadata(dbPath, { force: !_propertyLayoutIsCurrentDb(dbPath) });
      const sheet = _sheetPropertyLayoutTemplates(dbPath).map(t => ({ ...t, scope: 'sheet' }));
      const global = (await _loadGlobalPropertyLayoutTemplates()).map(t => ({ ...t, scope: 'global' }));
      const templates = sheet.concat(global);
      if (!templates.length) { showStatus('テンプレートがありません'); return; }
      showPropertyLayoutTemplateMenu(toolbar, templates, async (tmpl) => {
        if (!await savePropertyLayout(dbPath, tmpl)) return;
        renderEntityPropsGridInto(grid, data, entityPath, opts);
        showStatus('レイアウトテンプレートを適用しました');
      });
    }));
    toolbar.appendChild(btn('リセット', 'rotateCcw', async () => {
      if (!await savePropertyLayout(dbPath, { order: Object.keys(data.properties || {}), hidden: [], groups: [] })) return;
      renderEntityPropsGridInto(grid, data, entityPath, opts);
    }));
  }
  grid.appendChild(toolbar);
}

function showPropertyLayoutTemplateMenu(anchor, templates, onSelect) {
  document.querySelectorAll('.gb-prop-layout-template-menu').forEach(el => el.remove());
  const menu = document.createElement('div');
  menu.className = 'gb-context-menu gb-prop-layout-template-menu';
  templates.forEach(tmpl => {
    const item = document.createElement('div');
    item.className = 'gb-context-menu-item';
    item.textContent = (tmpl.scope === 'global' ? '全体: ' : 'シート: ') + (tmpl.name || '無題');
    item.addEventListener('click', () => { menu.remove(); onSelect(tmpl); });
    menu.appendChild(item);
  });
  const rect = anchor.getBoundingClientRect();
  const z = typeof _getZoom === 'function' ? _getZoom() : 1;
  menu.style.left = (rect.left / z) + 'px';
  menu.style.top = (rect.bottom / z + 2) + 'px';
  document.body.appendChild(menu);
  if (typeof clampPopupToViewport === 'function') clampPopupToViewport(menu);
}
