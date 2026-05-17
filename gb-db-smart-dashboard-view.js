/* スマートシート内ダッシュボードビュー */

const SMART_DB_DASHBOARD_MAX_DEPTH = 3;
const _smartDbDashboardDbMetadataCache = {};

function getSmartDbActiveView(def) {
  const target = def || state.currentSmartDb;
  if (!target || target.activeView !== 'dashboard') return 'table';
  return 'dashboard';
}

function getSmartDbDashboardView(def) {
  const target = def || state.currentSmartDb;
  if (!target) return null;
  if (typeof normalizeSmartDbDefinition === 'function') normalizeSmartDbDefinition(target);
  if (!target.views.dashboard || typeof target.views.dashboard !== 'object' || Array.isArray(target.views.dashboard)) {
    target.views.dashboard = { widgets: [] };
  }
  if (!Array.isArray(target.views.dashboard.widgets)) target.views.dashboard.widgets = [];
  return target.views.dashboard;
}

async function setSmartDbActiveView(viewName) {
  const def = state.currentSmartDb;
  if (!def) return;
  def.activeView = viewName === 'dashboard' ? 'dashboard' : 'table';
  if (def.activeView === 'dashboard') getSmartDbDashboardView(def);
  try {
    if (typeof saveSmartDbDef === 'function') await saveSmartDbDef(def);
  } catch (e) {
    showStatus('スマートシートの保存に失敗しました: ' + e.message, true);
  }
  renderSmartDbActiveView();
}

function renderSmartDbViewTabs() {
  const root = document.getElementById('smart-db-view-tabs');
  if (!root) return;
  const active = getSmartDbActiveView();
  root.querySelectorAll('[data-smart-db-view]').forEach(btn => {
    const isActive = btn.dataset.smartDbView === active;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
  });
}

function renderSmartDbActiveView() {
  const tableArea = document.getElementById('smart-db-table-area');
  const dashboardArea = document.getElementById('smart-db-dashboard-area');
  const active = getSmartDbActiveView();
  if (tableArea) tableArea.hidden = active !== 'table';
  if (dashboardArea) dashboardArea.hidden = active !== 'dashboard';
  renderSmartDbViewTabs();
  if (active === 'dashboard') renderSmartDbDashboardView();
}

function normalizeSmartSheetAsDbLike(result) {
  const rows = Array.isArray(result?.entities) ? result.entities : [];
  const entities = {};
  const usedKeys = new Set();
  rows.forEach(row => {
    const baseName = String(row?.name || row?.path || 'entry');
    let key = baseName;
    let suffix = 2;
    while (usedKeys.has(key)) key = baseName + ' (' + suffix++ + ')';
    usedKeys.add(key);
    const props = {};
    Object.entries(row?.matched_props || {}).forEach(([prop, vals]) => {
      props[prop] = Array.isArray(vals) ? vals : [];
    });
    props._path = row?.path || '';
    props._db_path = row?.db_path || '';
    props._db_name = row?.db_name || '';
    props._root_name = row?.root_name || '';
    entities[key] = props;
  });
  const propSet = new Set();
  rows.forEach(row => Object.keys(row?.matched_props || {}).forEach(prop => propSet.add(prop)));
  return {
    entities,
    properties: Array.from(propSet),
    filter_properties: Array.isArray(result?.filter_properties) ? result.filter_properties : Array.from(propSet),
    new_format: true,
    source_type: 'smart-sheet',
    total_dbs_scanned: result?.total_dbs_scanned || 0,
  };
}

function normalizeGlobalIndexAsDbLike(result) {
  const files = Array.isArray(result?.files) ? result.files : [];
  const entities = {};
  const columns = ['category', 'type', 'source', 'path', 'size', 'modified', 'backlinks'];
  const labels = {
    category: '種別',
    type: 'タイプ',
    source: 'ソース',
    path: 'パス',
    size: 'サイズ',
    modified: '更新日',
    backlinks: '被リンク',
  };
  files.forEach((file, idx) => {
    const name = String(file?.name || file?.path || file?.abs_path || `file-${idx + 1}`);
    const key = entities[name] ? `${name} (${idx + 1})` : name;
    const filePath = file?.path || file?.abs_path || '';
    entities[key] = {
      [labels.category]: [{ value: file?.category || '', status: '採用' }],
      [labels.type]: [{ value: file?.type || '', status: '採用' }],
      [labels.source]: [{ value: file?.source_name || file?.root_name || '', status: '採用' }],
      [labels.path]: [{ value: filePath, status: '採用' }],
      [labels.size]: [{ value: file?.size ?? '', status: '採用' }],
      [labels.modified]: [{ value: file?.modified || '', status: '採用' }],
      [labels.backlinks]: [{ value: _smartDbDashboardBacklinkCount(file), status: '採用' }],
      _path: filePath,
      _abs_path: file?.abs_path || filePath,
      _category: file?.category || '',
      _file_type: file?.type || '',
    };
  });
  return {
    entities,
    properties: columns.map(k => labels[k]),
    filter_properties: columns.map(k => labels[k]),
    new_format: true,
    source_type: 'global-index',
    total_dbs_scanned: result?.total || files.length,
  };
}

function _smartDbDashboardBacklinkCount(file) {
  return file?.backlinks_count
    ?? file?.backlink_count
    ?? file?.backlink_file_count
    ?? file?.backlinks
    ?? '';
}

function _smartDbDashboardGlobalIndexResult(result, def) {
  let files = Array.isArray(result?.files) ? result.files.slice() : [];
  if (def && typeof applyGlobalIndexFilters === 'function') {
    files = applyGlobalIndexFilters(files, def.filters || []);
  }
  if (def && typeof applyGlobalIndexSort === 'function') {
    files = applyGlobalIndexSort(files, def.sortBy || 'modified', def.sortDir || 'desc');
  }
  return {
    ...(result || {}),
    files,
    filtered_total: files.length,
  };
}

async function resolveWidgetData(source, opts) {
  const options = opts || {};
  const normalized = _normalizeSmartDbWidgetSource(source);
  if (!normalized.path) return { ok: false, error: 'ソース未設定' };
  if (normalized.kind === 'sheet') {
    const data = await fetchRelatedDbData(normalized.path);
    if (!data || !data.entities) return { ok: false, error: '参照先シートを取得できません' };
    return { ok: true, data, source: normalized };
  }
  if (normalized.kind !== 'smart-sheet') return { ok: false, error: '未対応のソース種別です' };
  const depth = Number(options.depth || 0);
  if (depth >= SMART_DB_DASHBOARD_MAX_DEPTH) return { ok: false, error: 'スマートシート参照が深すぎます' };
  const currentPath = state.currentSmartDb?._filePath || '';
  if (currentPath && normalized.path === currentPath && state.smartDbData) {
    const data = state.currentSmartDb?.sourceType === 'all-files'
      ? normalizeGlobalIndexAsDbLike(_smartDbDashboardGlobalIndexResult(state.smartDbData, state.currentSmartDb))
      : normalizeSmartSheetAsDbLike(state.smartDbData);
    return { ok: true, data, source: normalized };
  }
  const loaded = await _loadSmartSheetForWidget(normalized.path);
  if (!loaded.ok) return loaded;
  if (loaded.def?.sourceType === 'all-files') {
    const result = await (typeof loadGlobalIndexData === 'function' ? loadGlobalIndexData(loaded.def) : Promise.resolve({ files: [], total: 0 }));
    return { ok: true, data: normalizeGlobalIndexAsDbLike(_smartDbDashboardGlobalIndexResult(result, loaded.def)), source: normalized };
  }
  const url = '/smart-db?filters=' + encodeURIComponent(JSON.stringify(loaded.def.filters || []));
  const result = await apiFetch(url);
  return { ok: true, data: normalizeSmartSheetAsDbLike(result), source: normalized };
}

async function _loadSmartSheetForWidget(path) {
  try {
    const data = await apiFetch('/file?path=' + encodeURIComponent(path));
    const def = typeof normalizeSmartDbDefinition === 'function'
      ? normalizeSmartDbDefinition(JSON.parse(data.content || '{}'))
      : JSON.parse(data.content || '{}');
    return { ok: true, def };
  } catch (e) {
    return { ok: false, error: '参照先スマートシートを取得できません' };
  }
}

function renderSmartDbDashboardView() {
  const area = document.getElementById('smart-db-dashboard-area');
  if (!area) return;
  area.innerHTML = '';
  const header = document.createElement('div');
  header.className = 'smart-db-dashboard-toolbar';
  const title = document.createElement('div');
  title.className = 'smart-db-dashboard-title';
  title.textContent = state.currentSmartDb?.name || 'スマートシート';
  header.appendChild(title);
  const addBtn = document.createElement('button');
  addBtn.className = 'tb-icon-btn';
  addBtn.title = 'ウィジェットを追加';
  addBtn.dataset.e2eId = 'smart-db-add-widget-' + (state.currentSmartDb?.id || '');
  addBtn.innerHTML = '<span class="ico ico-plus"></span>';
  addBtn.addEventListener('click', () => showSmartDbWidgetEditor());
  header.appendChild(addBtn);
  area.appendChild(header);

  const view = getSmartDbDashboardView();
  const widgets = _normalizeSmartDbWidgets(view?.widgets || []);
  if (view) view.widgets = widgets;
  const grid = document.createElement('div');
  grid.className = 'smart-db-dashboard-grid';
  area.appendChild(grid);

  if (widgets.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'smart-db-dashboard-empty';
    empty.textContent = 'ウィジェットがありません';
    grid.appendChild(empty);
    return;
  }
  widgets.forEach(widget => grid.appendChild(_createSmartDbWidgetCard(widget)));
}

function _normalizeSmartDbWidgets(widgets) {
  return (widgets || []).map((widget, idx) => _normalizeSmartDbWidget(widget, idx));
}

function _normalizeSmartDbWidget(widget, idx) {
  const next = widget && typeof widget === 'object' ? widget : {};
  next.id = next.id || _newSmartDbWidgetId();
  next.type = ['stat', 'progress', 'chart', 'list'].includes(next.type) ? next.type : 'stat';
  next.title = next.title || _defaultSmartDbWidgetTitle(next.type);
  next.source = _normalizeSmartDbWidgetSource(next.source || { kind: 'sheet', path: next.config?.dbPath || '' });
  next.config = next.config && typeof next.config === 'object' ? next.config : {};
  delete next.config.dbPath;
  next.layout = next.layout && typeof next.layout === 'object' ? next.layout : { x: 0, y: idx * 2, w: 12, h: 2 };
  return next;
}

function _normalizeSmartDbWidgetSource(source) {
  const src = source && typeof source === 'object' ? source : {};
  return {
    kind: src.kind === 'smart-sheet' ? 'smart-sheet' : 'sheet',
    path: String(src.path || '').trim(),
  };
}

function _newSmartDbWidgetId() {
  return 'w-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
}

function _defaultSmartDbWidgetTitle(type) {
  return ({ stat: '数値', progress: '進捗', chart: 'チャート', list: 'リスト' })[type] || 'ウィジェット';
}

function _createSmartDbWidgetCard(widget) {
  const card = document.createElement('div');
  card.className = 'smart-db-widget';
  card.dataset.widgetId = widget.id;
  const header = document.createElement('div');
  header.className = 'widget-header';
  const title = document.createElement('div');
  title.className = 'widget-title';
  title.textContent = widget.title || _defaultSmartDbWidgetTitle(widget.type);
  header.appendChild(title);
  const actions = document.createElement('div');
  actions.className = 'widget-actions';
  const editBtn = _smartDbWidgetIconButton('pencil', '編集');
  editBtn.dataset.e2eId = 'smart-db-widget-' + widget.id + '-edit';
  editBtn.addEventListener('click', () => showSmartDbWidgetEditor(widget));
  actions.appendChild(editBtn);
  const delBtn = _smartDbWidgetIconButton('trash2', '削除');
  delBtn.dataset.e2eId = 'smart-db-widget-' + widget.id + '-delete';
  delBtn.addEventListener('click', async () => {
    if (typeof cfConfirm === 'function' && !await cfConfirm('このウィジェットを削除しますか？')) return;
    await removeSmartDbWidget(widget.id);
  });
  actions.appendChild(delBtn);
  header.appendChild(actions);
  card.appendChild(header);

  const content = document.createElement('div');
  content.className = 'widget-content';
  content.textContent = '読み込み中...';
  card.appendChild(content);
  renderSmartDbWidget(widget, content);
  return card;
}

function _smartDbWidgetIconButton(icon, title) {
  const btn = document.createElement('button');
  btn.className = 'tb-icon-btn';
  btn.type = 'button';
  btn.title = title;
  btn.innerHTML = '<span class="ico ico-' + icon + '"></span>';
  return btn;
}

async function renderSmartDbWidget(widget, container) {
  container.innerHTML = '';
  container.classList.remove('smart-db-widget-muted', 'smart-db-widget-error');
  try {
    const resolved = await resolveWidgetData(widget.source);
    if (!resolved.ok) {
      container.textContent = resolved.error;
      container.classList.add('smart-db-widget-muted');
      return;
    }
    switch (widget.type) {
      case 'stat':     return renderSmartDbStatWidget(widget, container, resolved);
      case 'progress': return renderSmartDbProgressWidget(widget, container, resolved);
      case 'chart':    return renderSmartDbChartWidget(widget, container, resolved);
      case 'list':     return renderSmartDbListWidget(widget, container, resolved);
      default:         container.textContent = '不明なタイプ: ' + widget.type;
    }
  } catch (e) {
    container.textContent = '取得失敗: ' + e.message;
    container.classList.add('smart-db-widget-error');
  }
}

async function renderSmartDbStatWidget(widget, container, resolved) {
  const cfg = widget.config || {};
  const data = resolved.data;
  const entityNames = Object.keys(data.entities || {});
  let value = entityNames.length;
  if (cfg.property) {
    const propTypes = await _getSmartDbDashboardPropertyTypes(resolved.source);
    const ptc = propTypes?.[cfg.property] || null;
    value = calcAggregation(cfg.property, data.entities, entityNames, cfg.aggregation || 'count', ptc, propTypes);
  }
  const numDiv = document.createElement('div');
  numDiv.className = 'smart-db-stat-value';
  numDiv.textContent = value;
  container.appendChild(numDiv);
}

async function renderSmartDbProgressWidget(widget, container, resolved) {
  const cfg = widget.config || {};
  const data = resolved.data;
  const entityNames = Object.keys(data.entities || {});
  const total = entityNames.length;
  let done = 0;
  if (cfg.doneFilter?.property) {
    entityNames.forEach(en => {
      const vals = filterValues(data.entities[en][cfg.doneFilter.property] || []);
      if (vals.length > 0 && _smartDbDashboardValueText(vals[0].value) === _smartDbDashboardValueText(cfg.doneFilter.value)) done++;
    });
  }
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const text = document.createElement('div');
  text.className = 'smart-db-progress-text';
  text.textContent = done + ' / ' + total + ' (' + pct + '%)';
  container.appendChild(text);
  const barW = 200, barH = 16;
  const svg = svgCreate('svg', { width: barW, height: barH, viewBox: '0 0 ' + barW + ' ' + barH });
  svg.classList.add('smart-db-progress-svg');
  svg.appendChild(svgRect(0, 0, barW, barH, 'var(--bg4)', 8));
  svg.appendChild(svgRect(0, 0, barW * pct / 100, barH, 'var(--accent)', 8));
  container.appendChild(svg);
}

async function renderSmartDbChartWidget(widget, container, resolved) {
  const cfg = widget.config || {};
  const chartConfig = {
    chartType: cfg.chartType || 'bar',
    xProperty: cfg.xProperty || '',
    yAggregation: cfg.yAggregation || 'count',
    yProperty: cfg.yProperty || null,
    palette: cfg.palette || 'default',
    propertyTypes: await _getSmartDbDashboardPropertyTypes(resolved.source),
  };
  const chartData = prepareChartData(resolved.data, chartConfig, resolved.source.path);
  const w = 320, h = 200;
  let svg;
  switch (chartConfig.chartType) {
    case 'pie':  svg = renderPieChart(chartData, w, h); break;
    case 'line': svg = renderLineChart(chartData, w, h); break;
    default:     svg = renderBarChart(chartData, w, h); break;
  }
  container.appendChild(svg);
}

async function renderSmartDbListWidget(widget, container, resolved) {
  const cfg = widget.config || {};
  const data = resolved.data;
  let entityNames = Object.keys(data.entities || {});
  if (cfg.filter?.property) {
    entityNames = entityNames.filter(en => _smartDbDashboardMatchesFilter(data.entities[en], cfg.filter));
  }
  const maxItems = cfg.maxItems || 10;
  const displayProps = cfg.displayProperties || [];
  if (entityNames.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'smart-db-list-empty';
    empty.textContent = '該当なし';
    container.appendChild(empty);
    return;
  }
  const table = document.createElement('table');
  table.className = 'smart-db-list-table';
  entityNames.slice(0, maxItems).forEach(en => {
    const tr = document.createElement('tr');
    tr.className = 'smart-db-list-row';
    tr.addEventListener('click', () => {
      _smartDbDashboardOpenEntity(data, resolved.source, en);
    });
    const tdName = document.createElement('td');
    tdName.className = 'smart-db-list-name';
    tdName.textContent = en;
    tr.appendChild(tdName);
    displayProps.forEach(prop => {
      const td = document.createElement('td');
      td.className = 'smart-db-list-prop';
      const vals = filterValues(data.entities[en][prop] || []);
      const displayValue = vals.length > 0 ? _smartDbDashboardValueText(vals[0].value) : '';
      td.textContent = displayValue;
      if (typeof MeldexAutoLink !== 'undefined' && displayValue.length >= 2) {
        MeldexAutoLink.applyToDom(td, _smartDbDashboardEntityPath(data, resolved.source, en));
        if (td.querySelector('.auto-link')) {
          td.addEventListener('click', (e) => {
            const al = e.target.closest('.auto-link');
            if (al && typeof onAutoLinkClick === 'function') {
              e.stopPropagation();
              onAutoLinkClick(al, e);
            }
          });
        }
      }
      tr.appendChild(td);
    });
    table.appendChild(tr);
  });
  container.appendChild(table);
  if (entityNames.length > maxItems) {
    const more = document.createElement('div');
    more.className = 'smart-db-list-more';
    more.textContent = '他 ' + (entityNames.length - maxItems) + ' 件';
    container.appendChild(more);
  }
}

function _smartDbDashboardMatchesFilter(entity, filter) {
  const vals = filterValues(entity?.[filter.property] || []);
  if (vals.length === 0) return filter.operator === 'empty';
  const v = _smartDbDashboardValueText(vals[0].value);
  const target = _smartDbDashboardValueText(filter.value);
  switch (filter.operator) {
    case 'equals': return v === target;
    case 'not_equals': return v !== target;
    case 'contains': return v && v.includes(target);
    case 'not_contains': return !v || !v.includes(target);
    case 'empty': return !v || v.trim() === '';
    case 'not_empty': return v && v.trim() !== '';
    default: return true;
  }
}

function _smartDbDashboardEntityPath(data, source, entityName) {
  const entity = data.entities?.[entityName] || {};
  if (entity._path) return entity._path;
  return data.new_format ? source.path + '/' + entityName + '.md' : source.path + '/' + entityName;
}

function _smartDbDashboardOpenEntity(data, source, entityName) {
  const entity = data.entities?.[entityName] || {};
  const entityPath = _smartDbDashboardEntityPath(data, source, entityName);
  if (!entityPath) return;
  const category = entity._category || '';
  const label = entityName.split(/[\\/]/).pop().replace(/\.\w+$/, '');
  if ((category === 'scriptnote' || category === 'scenario') && typeof openScenarioInScriptNote === 'function') {
    openScenarioInScriptNote(entityPath, label);
    return;
  }
  if (category === 'board' && typeof openBoard === 'function') {
    openBoard(label, entityPath);
    return;
  }
  if (typeof selectEntity === 'function') selectEntity(entityPath);
}

function _smartDbDashboardValueText(value) {
  if (value == null) return '';
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

async function _getSmartDbDashboardPropertyTypes(source) {
  const normalized = _normalizeSmartDbWidgetSource(source);
  if (normalized.kind !== 'sheet' || !normalized.path) return {};
  if (_smartDbDashboardDbMetadataCache[normalized.path]) return _smartDbDashboardDbMetadataCache[normalized.path];
  try {
    const meta = await apiFetch('/db-metadata?path=' + encodeURIComponent(normalized.path));
    _smartDbDashboardDbMetadataCache[normalized.path] = meta?.property_types || meta?.propertyTypes || meta || {};
  } catch (e) {
    _smartDbDashboardDbMetadataCache[normalized.path] = {};
  }
  return _smartDbDashboardDbMetadataCache[normalized.path];
}

async function removeSmartDbWidget(widgetId) {
  const view = getSmartDbDashboardView();
  if (!view) return;
  const before = (typeof _captureSmartDbHistorySnapshot === 'function')
    ? _captureSmartDbHistorySnapshot(state.currentSmartDb)
    : null;
  const previousWidgets = JSON.parse(JSON.stringify(view.widgets || []));
  const beforeLength = (view.widgets || []).length;
  view.widgets = (view.widgets || []).filter(w => w.id !== widgetId);
  if (view.widgets.length === beforeLength) return;
  try {
    if (typeof saveSmartDbDef === 'function') await saveSmartDbDef(state.currentSmartDb);
    if (typeof pushSmartDbDefinitionHistory === 'function') {
      pushSmartDbDefinitionHistory('スマートシート: ウィジェット削除', before, state.currentSmartDb, state.currentSmartDb?.name || '');
    }
    renderSmartDbDashboardView();
  } catch (e) {
    view.widgets = previousWidgets;
    renderSmartDbDashboardView();
    showStatus('スマートシートの保存に失敗しました: ' + e.message, true);
  }
}

function showSmartDbWidgetEditor(existingWidget) {
  const view = getSmartDbDashboardView();
  if (!view) return;
  const widget = _normalizeSmartDbWidget(existingWidget ? JSON.parse(JSON.stringify(existingWidget)) : {
    id: _newSmartDbWidgetId(),
    type: 'stat',
    title: '',
    source: { kind: 'sheet', path: '' },
    config: {},
  }, view.widgets.length);

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  const modal = document.createElement('div');
  modal.className = 'smart-db-widget-editor-modal';
  modal.classList.add('modal');
  overlay.appendChild(modal);

  const h3 = document.createElement('h3');
  h3.textContent = existingWidget ? 'ウィジェット編集' : 'ウィジェット追加';
  h3.className = 'smart-db-modal-title';
  modal.appendChild(h3);

  const titleInput = _appendTextField(modal, 'タイトル', widget.title, '例: 総エピソード数');
  const typeSel = _appendSelectField(modal, 'タイプ', [
    ['stat', '数値（統計値）'],
    ['progress', 'プログレスバー'],
    ['chart', 'チャート'],
    ['list', 'フィルタリスト'],
  ], widget.type);

  const sourceKind = _appendSelectField(modal, '参照ソース', [
    ['sheet', 'シート'],
    ['smart-sheet', 'スマートシート'],
  ], widget.source.kind);
  const sourceField = document.createElement('div');
  sourceField.className = 'field';
  const sourceLabel = document.createElement('label');
  sourceLabel.textContent = '参照ファイル';
  sourceField.appendChild(sourceLabel);
  const sourceRow = document.createElement('div');
  sourceRow.className = 'smart-db-source-row';
  const sourceInput = document.createElement('input');
  sourceInput.type = 'text';
  sourceInput.readOnly = true;
  sourceInput.value = widget.source.path || '';
  sourceInput.className = 'smart-db-source-input';
  sourceRow.appendChild(sourceInput);
  const pickBtn = document.createElement('button');
  pickBtn.type = 'button';
  pickBtn.textContent = '選択...';
  pickBtn.addEventListener('click', () => showSmartDbSourcePicker(sourceKind.value, sourceInput.value, selected => {
    sourceInput.value = selected.path;
    sourceKind.value = selected.kind;
  }));
  sourceRow.appendChild(pickBtn);
  sourceField.appendChild(sourceRow);
  modal.appendChild(sourceField);

  const configDiv = document.createElement('div');
  modal.appendChild(configDiv);
  function renderConfig() {
    _renderSmartDbWidgetConfig(configDiv, typeSel.value, widget.config || {});
  }
  typeSel.addEventListener('change', renderConfig);
  renderConfig();

  const btnRow = document.createElement('div');
  btnRow.className = 'smart-db-modal-buttons';
  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.textContent = 'キャンセル';
  cancelBtn.addEventListener('click', () => overlay.remove());
  btnRow.appendChild(cancelBtn);
  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.className = 'primary';
  saveBtn.textContent = '保存';
  saveBtn.addEventListener('click', async () => {
    const before = (typeof _captureSmartDbHistorySnapshot === 'function')
      ? _captureSmartDbHistorySnapshot(state.currentSmartDb)
      : null;
    const previousWidgets = JSON.parse(JSON.stringify(view.widgets || []));
    widget.title = titleInput.value.trim() || _defaultSmartDbWidgetTitle(typeSel.value);
    widget.type = typeSel.value;
    widget.source = { kind: sourceKind.value === 'smart-sheet' ? 'smart-sheet' : 'sheet', path: sourceInput.value.trim() };
    widget.config = _collectSmartDbWidgetConfig(widget.type);
    const idx = view.widgets.findIndex(w => w.id === widget.id);
    if (idx >= 0) view.widgets[idx] = widget;
    else view.widgets.push(widget);
    try {
      if (typeof saveSmartDbDef === 'function') await saveSmartDbDef(state.currentSmartDb);
      if (typeof pushSmartDbDefinitionHistory === 'function') {
        const label = existingWidget ? 'スマートシート: ウィジェット編集' : 'スマートシート: ウィジェット追加';
        pushSmartDbDefinitionHistory(label, before, state.currentSmartDb, widget.title);
      }
      overlay.remove();
      renderSmartDbDashboardView();
    } catch (e) {
      view.widgets = previousWidgets;
      showStatus('スマートシートの保存に失敗しました: ' + e.message, true);
    }
  });
  btnRow.appendChild(saveBtn);
  modal.appendChild(btnRow);
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
}

function _appendTextField(parent, labelText, value, placeholder) {
  const field = document.createElement('div');
  field.className = 'field';
  const label = document.createElement('label');
  label.textContent = labelText;
  field.appendChild(label);
  const input = document.createElement('input');
  input.type = 'text';
  input.value = value || '';
  input.placeholder = placeholder || '';
  field.appendChild(input);
  parent.appendChild(field);
  return input;
}

function _appendSelectField(parent, labelText, options, value) {
  const field = document.createElement('div');
  field.className = 'field';
  const label = document.createElement('label');
  label.textContent = labelText;
  field.appendChild(label);
  const select = document.createElement('select');
  options.forEach(([key, text]) => {
    const opt = document.createElement('option');
    opt.value = key;
    opt.textContent = text;
    if (key === value) opt.selected = true;
    select.appendChild(opt);
  });
  field.appendChild(select);
  parent.appendChild(field);
  return select;
}

function _renderSmartDbWidgetConfig(container, type, cfg) {
  container.innerHTML = '';
  if (type === 'stat') {
    container.appendChild(_configText('wc-prop', 'プロパティ（空=エントリ数）', cfg.property || ''));
    container.appendChild(_configSelect('wc-agg', '集計', ['count', 'sum', 'average', 'min', 'max'], cfg.aggregation || 'count'));
  } else if (type === 'progress') {
    container.appendChild(_configText('wc-done-prop', '完了判定プロパティ', cfg.doneFilter?.property || '', '例: ステータス'));
    container.appendChild(_configText('wc-done-val', '完了判定値', cfg.doneFilter?.value || '', '例: 掲載済み'));
  } else if (type === 'chart') {
    container.appendChild(_configSelect('wc-chart-type', 'チャートタイプ', ['bar', 'pie', 'line'], cfg.chartType || 'bar'));
    container.appendChild(_configText('wc-xprop', 'X軸プロパティ', cfg.xProperty || ''));
    container.appendChild(_configText('wc-yprop', 'Y軸プロパティ（任意）', cfg.yProperty || ''));
    container.appendChild(_configSelect('wc-yagg', 'Y軸集計', ['count', 'sum', 'average', 'min', 'max'], cfg.yAggregation || 'count'));
  } else if (type === 'list') {
    container.appendChild(_configText('wc-filter-prop', 'フィルタプロパティ', cfg.filter?.property || ''));
    container.appendChild(_configSelect('wc-filter-op', 'フィルタ演算子', ['equals', 'not_equals', 'contains', 'not_contains', 'empty', 'not_empty'], cfg.filter?.operator || 'equals'));
    container.appendChild(_configText('wc-filter-val', 'フィルタ値', cfg.filter?.value || ''));
    container.appendChild(_configText('wc-display-props', '表示プロパティ（カンマ区切り）', (cfg.displayProperties || []).join(', ')));
    container.appendChild(_configText('wc-max', '最大表示数', cfg.maxItems || 10));
  }
}

function _configText(id, labelText, value, placeholder) {
  const field = document.createElement('div');
  field.className = 'field';
  const label = document.createElement('label');
  label.textContent = labelText;
  field.appendChild(label);
  const input = document.createElement('input');
  input.id = id;
  input.type = id === 'wc-max' ? 'number' : 'text';
  input.value = value == null ? '' : value;
  input.placeholder = placeholder || '';
  if (id === 'wc-max') {
    input.min = '1';
    input.max = '100';
  }
  field.appendChild(input);
  return field;
}

function _configSelect(id, labelText, options, value) {
  const field = document.createElement('div');
  field.className = 'field';
  const label = document.createElement('label');
  label.textContent = labelText;
  field.appendChild(label);
  const select = document.createElement('select');
  select.id = id;
  options.forEach(key => {
    const opt = document.createElement('option');
    opt.value = key;
    opt.textContent = key;
    if (key === value) opt.selected = true;
    select.appendChild(opt);
  });
  field.appendChild(select);
  return field;
}

function _collectSmartDbWidgetConfig(type) {
  const cfg = {};
  if (type === 'stat') {
    cfg.property = document.getElementById('wc-prop')?.value || '';
    cfg.aggregation = document.getElementById('wc-agg')?.value || 'count';
  } else if (type === 'progress') {
    const prop = document.getElementById('wc-done-prop')?.value || '';
    const val = document.getElementById('wc-done-val')?.value || '';
    if (prop) cfg.doneFilter = { property: prop, value: val };
  } else if (type === 'chart') {
    cfg.chartType = document.getElementById('wc-chart-type')?.value || 'bar';
    cfg.xProperty = document.getElementById('wc-xprop')?.value || '';
    cfg.yProperty = document.getElementById('wc-yprop')?.value || '';
    cfg.yAggregation = document.getElementById('wc-yagg')?.value || 'count';
  } else if (type === 'list') {
    const prop = document.getElementById('wc-filter-prop')?.value || '';
    if (prop) {
      cfg.filter = {
        property: prop,
        operator: document.getElementById('wc-filter-op')?.value || 'equals',
        value: document.getElementById('wc-filter-val')?.value || '',
      };
    }
    cfg.displayProperties = (document.getElementById('wc-display-props')?.value || '').split(',').map(s => s.trim()).filter(Boolean);
    cfg.maxItems = Math.max(1, parseInt(document.getElementById('wc-max')?.value || '10', 10) || 10);
  }
  return cfg;
}

function showSmartDbSourcePicker(kind, currentPath, onSelect) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  const modal = document.createElement('div');
  modal.className = 'smart-db-source-picker-modal';
  modal.classList.add('modal');
  const title = document.createElement('h3');
  title.textContent = kind === 'smart-sheet' ? 'スマートシートを選択' : 'シートを選択';
  title.className = 'smart-db-modal-title';
  modal.appendChild(title);
  const list = document.createElement('div');
  list.className = 'smart-db-source-picker';
  modal.appendChild(list);
  const footer = document.createElement('div');
  footer.className = 'smart-db-source-picker-footer';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.textContent = 'キャンセル';
  cancel.addEventListener('click', () => overlay.remove());
  footer.appendChild(cancel);
  modal.appendChild(footer);
  overlay.appendChild(modal);
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
  _loadSmartDbSourcePickerItems(list, kind, currentPath, selected => {
    onSelect(selected);
    overlay.remove();
  });
}

async function _loadSmartDbSourcePickerItems(container, kind, currentPath, onSelect) {
  container.textContent = '読み込み中...';
  try {
    const roots = await apiFetch('/outliner-roots');
    container.innerHTML = '';
    const rootList = Array.isArray(roots) ? roots : [];
    if (rootList.length === 0) {
      await _renderSmartDbSourceFolder(container, '', kind, currentPath, onSelect, 0);
      return;
    }
    rootList.forEach(root => {
      const rootPath = root.path || root.root || root;
      _renderSmartDbSourceFolder(container, '', kind, currentPath, onSelect, 0, rootPath);
    });
  } catch (e) {
    container.textContent = '候補を取得できません';
  }
}

async function _renderSmartDbSourceFolder(container, path, kind, currentPath, onSelect, depth, rootPath) {
  const url = '/browse?path=' + encodeURIComponent(path || '') + '&all_files=true' + (rootPath ? '&root=' + encodeURIComponent(rootPath) : '');
  const items = await apiFetch(url);
  const list = Array.isArray(items) ? items : [];
  list.forEach(item => _appendSmartDbSourcePickerRow(container, item, kind, currentPath, onSelect, depth, rootPath));
}

function _appendSmartDbSourcePickerRow(container, item, kind, currentPath, onSelect, depth, rootPath) {
  const row = document.createElement('div');
  row.className = 'smart-db-source-picker-row';
  row.dataset.depth = String(Math.min(depth, 6));
  const openBtn = document.createElement('button');
  openBtn.type = 'button';
  openBtn.className = 'tb-icon-btn';
  openBtn.title = item.type === 'folder' ? '展開' : '選択';
  openBtn.innerHTML = '<span class="ico ico-' + (item.type === 'folder' ? 'chevronRight' : 'file') + '"></span>';
  row.appendChild(openBtn);
  const label = document.createElement('span');
  label.textContent = item.name || item.path || '';
  label.className = 'smart-db-source-picker-label';
  row.appendChild(label);
  const chooseBtn = document.createElement('button');
  chooseBtn.type = 'button';
  chooseBtn.textContent = '選択';
  const canSelectDirectly = _smartDbSourceCandidate(item, kind);
  chooseBtn.hidden = !canSelectDirectly;
  if (canSelectDirectly) chooseBtn.addEventListener('click', () => onSelect({ kind, path: item.path }));
  row.appendChild(chooseBtn);
  if (item.path === currentPath) row.classList.add('selected');
  container.appendChild(row);

  if (item.type === 'folder') {
    openBtn.addEventListener('click', async () => {
      if (row.dataset.open === '1') return;
      row.dataset.open = '1';
      openBtn.innerHTML = '<span class="ico ico-chevronDown"></span>';
      if (kind === 'sheet') {
        chooseBtn.hidden = false;
        chooseBtn.addEventListener('click', async e => {
          e.stopPropagation();
          const type = await _checkSmartDbSourceType(item.path);
          if (type !== 'database') {
            showStatus('シートではありません', true);
            return;
          }
          onSelect({ kind: 'sheet', path: item.path });
        }, { once: true });
      }
      await _renderSmartDbSourceFolder(container, item.path, kind, currentPath, onSelect, depth + 1, rootPath);
    });
    label.classList.add('is-folder');
    label.addEventListener('click', () => openBtn.click());
  } else {
    openBtn.addEventListener('click', () => {
      if (_smartDbSourceCandidate(item, kind)) onSelect({ kind, path: item.path });
    });
  }
}

function _smartDbSourceCandidate(item, kind) {
  const path = String(item?.path || '').toLowerCase();
  if (kind === 'smart-sheet') return path.endsWith('.smart-db.json') || item.type === 'smart-db';
  return false;
}

async function _checkSmartDbSourceType(path) {
  try {
    const result = await apiFetch('/check-type?path=' + encodeURIComponent(path));
    return result?.type || 'unknown';
  } catch {
    return 'unknown';
  }
}
