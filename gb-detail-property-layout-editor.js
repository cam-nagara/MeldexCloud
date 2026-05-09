/* エントリ詳細プロパティレイアウト */

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
  const backend = state.dbMetadata?.property_layout;
  const local = dbPath && typeof getDbViewConfig === 'function' ? getDbViewConfig(dbPath).propertyLayout : null;
  return normalizePropertyLayout(backend || local || null, allProps || []);
}

async function savePropertyLayout(dbPath, layout) {
  if (!dbPath) return false;
  const normalized = normalizePropertyLayout(layout);
  const cfg = getDbViewConfig(dbPath);
  cfg.propertyLayout = normalized;
  cfg.entryPropOrder = normalized.order;
  saveDbViewConfig(dbPath, cfg);
  if (state.dbMetadata) state.dbMetadata.property_layout = normalized;
  try {
    await apiPut('/db-metadata?path=' + encodeURIComponent(dbPath), { property_layout: normalized });
    return true;
  } catch (err) {
    console.warn('property_layout 保存失敗:', err);
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
  const current = getPropertyLayout(dbPath);
  await savePropertyLayout(dbPath, renamePropertyLayoutReferences(current, oldName, newName));
}

async function updatePropertyLayoutForDelete(dbPath, propName) {
  if (!dbPath || !propName) return;
  const current = getPropertyLayout(dbPath);
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
    return Array.isArray(res.templates) ? res.templates : [];
  } catch {
    return [];
  }
}

async function _saveGlobalPropertyLayoutTemplates(templates) {
  await apiPut('/property-layout-templates', { templates: Array.isArray(templates) ? templates : [] });
}

function _sheetPropertyLayoutTemplates() {
  return Array.isArray(state.dbMetadata?.property_layout_templates) ? state.dbMetadata.property_layout_templates : [];
}

async function _saveSheetPropertyLayoutTemplates(dbPath, templates) {
  if (!state.dbMetadata) state.dbMetadata = {};
  state.dbMetadata.property_layout_templates = templates;
  await apiPut('/db-metadata?path=' + encodeURIComponent(dbPath), { property_layout_templates: templates });
}

function renderPropertyLayoutToolbar(grid, data, entityPath, opts) {
  const dbPath = opts?.parentDb || (typeof _entityParentDir === 'function' ? _entityParentDir(entityPath) : '');
  if (!grid || !dbPath) return;
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
      const layout = getPropertyLayout(dbPath, Object.keys(data.properties || {}));
      const now = new Date().toISOString();
      if (scope.value === 'global') {
        const list = await _loadGlobalPropertyLayoutTemplates();
        list.push({ id: 'plt_' + Date.now(), name: _nextLayoutTemplateName(list), scope: 'global', ...layout, created_at: now, modified_at: now });
        await _saveGlobalPropertyLayoutTemplates(list);
      } else {
        const list = _sheetPropertyLayoutTemplates().slice();
        list.push({ id: 'plt_' + Date.now(), name: _nextLayoutTemplateName(list), scope: 'sheet', ...layout, created_at: now, modified_at: now });
        await _saveSheetPropertyLayoutTemplates(dbPath, list);
      }
      showStatus('レイアウトテンプレートを保存しました');
    }));
    toolbar.appendChild(btn('テンプレート適用', 'layoutTemplate', async () => {
      const sheet = _sheetPropertyLayoutTemplates().map(t => ({ ...t, scope: 'sheet' }));
      const global = (await _loadGlobalPropertyLayoutTemplates()).map(t => ({ ...t, scope: 'global' }));
      const templates = sheet.concat(global);
      if (!templates.length) { showStatus('テンプレートがありません'); return; }
      showPropertyLayoutTemplateMenu(toolbar, templates, async (tmpl) => {
        await savePropertyLayout(dbPath, tmpl);
        renderEntityPropsGridInto(grid, data, entityPath, opts);
        showStatus('レイアウトテンプレートを適用しました');
      });
    }));
    toolbar.appendChild(btn('リセット', 'rotateCcw', async () => {
      await savePropertyLayout(dbPath, { order: Object.keys(data.properties || {}), hidden: [], groups: [] });
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
