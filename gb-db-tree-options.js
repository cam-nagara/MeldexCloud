/* ツリービューのオプションパネルと共通ツールバー連携。 */

function _dbTreeIsCurrentView(ctx, dbPath) {
  ctx = ctx || (typeof _currentPaneState === 'function' ? _currentPaneState() : null);
  dbPath = dbPath || ctx?.dbPath || state?.currentDbPath;
  if (!dbPath) return false;
  if (typeof _dbCurrentViewModeForContext === 'function') {
    return _dbCurrentViewModeForContext(ctx, dbPath) === 'tree';
  }
  return typeof getCurrentViewMode === 'function' && getCurrentViewMode(dbPath, { ctx }) === 'tree';
}

function _dbTreeSetOptionTabVisible(visible, ctx) {
  const rpDetail = document.getElementById('rp-detail');
  if (rpDetail && typeof _ensureDetailTabShell === 'function') _ensureDetailTabShell(rpDetail);
  document.querySelectorAll('.detail-tab-db-tree').forEach(tab => { tab.hidden = !visible; });
  if (!visible && typeof _currentDetailTab !== 'undefined' && _currentDetailTab === 'db-tree'
      && typeof switchDetailTab === 'function') {
    switchDetailTab(null);
  }
  if (visible) _dbTreeRenderOptionPanel(ctx);
}

function _dbTreeOpenOptions(ctx) {
  if (typeof _openDetailRightPanel === 'function') _openDetailRightPanel();
  _dbTreeSetOptionTabVisible(true, ctx);
  if (typeof switchDetailTab === 'function') switchDetailTab('db-tree');
}

function _dbTreeRenderSettings(host, dbPath, ctx, config, properties) {
  const section = document.createElement('section');
  section.className = 'db-tree-option-section';
  const heading = document.createElement('h3');
  heading.textContent = 'ツリービュー設定';
  const hint = document.createElement('p');
  hint.textContent = '階層に使う列を選びます。この設定は現在のビューに保存されます。';
  section.append(heading, hint);
  const fields = [
    ['parentProp', '親を表す列', true],
    ['orderProp', '並び順の列', false],
    ['labelProp', '表示名の列', false],
    ['typeProp', '種類の列', false],
    ['colorProp', '色の列', false],
    ['collapsedProp', '折りたたみの列', false],
  ];
  const selects = {};
  fields.forEach(([key, label, required]) => {
    const row = document.createElement('label');
    row.textContent = label;
    const select = document.createElement('select');
    if (!required) {
      const none = document.createElement('option');
      none.value = '';
      none.textContent = '使用しない';
      select.appendChild(none);
    }
    properties.forEach(propName => {
      const option = document.createElement('option');
      option.value = propName;
      option.textContent = propName;
      select.appendChild(option);
    });
    select.value = config[key] || '';
    row.appendChild(select);
    section.appendChild(row);
    selects[key] = select;
  });
  const actions = document.createElement('div');
  actions.className = 'db-tree-settings-actions';
  const apply = document.createElement('button');
  apply.type = 'button';
  apply.className = 'primary';
  apply.textContent = '適用';
  apply.addEventListener('click', () => {
    const next = { ...config };
    Object.entries(selects).forEach(([key, select]) => { next[key] = select.value; });
    if (!next.parentProp) {
      showStatus('親を表す列を選択してください', true);
      return;
    }
    setDbTreeViewConfig(dbPath, next, ctx);
    renderDbTreeView(ctx);
  });
  actions.appendChild(apply);
  section.appendChild(actions);
  host.appendChild(section);
}

function _dbTreeRenderOptionPanel(ctx) {
  const host = document.getElementById('detail-tab-db-tree');
  if (!host) return;
  ctx = ctx || (typeof _currentPaneState === 'function' ? _currentPaneState() : null);
  const data = ctx?.pivotData || state?.pivotData;
  const dbPath = ctx?.dbPath || state?.currentDbPath;
  if (!data?.entities || !dbPath || !_dbTreeIsCurrentView(ctx, dbPath)) return;
  const config = getDbTreeViewConfig(dbPath, ctx);
  const properties = Array.from(new Set([
    ...(data.properties || []),
    ...Object.keys(getPropertyTypes(dbPath, ctx) || {}),
  ])).filter(prop => typeof isDbPropertyDeleted !== 'function' || !isDbPropertyDeleted(dbPath, prop));
  host.textContent = '';
  _dbTreeRenderSettings(host, dbPath, ctx, config, properties);
  const detailsSection = document.createElement('section');
  detailsSection.className = 'db-tree-option-section';
  const heading = document.createElement('h3');
  heading.textContent = '選択中のエントリ';
  const details = document.createElement('div');
  const stateInfo = ctx?._dbTreeViewState;
  const model = ctx?._dbTreeViewModel;
  _dbTreeRenderDetails(details, model?.byEntity?.get(stateInfo?.selected), dbPath, ctx, config);
  detailsSection.append(heading, details);
  host.appendChild(detailsSection);
}

function _dbTreeAutoFitColumns(ctx, dbPath) {
  ctx = ctx || (typeof _currentPaneState === 'function' ? _currentPaneState() : null);
  const data = ctx?.pivotData || state.pivotData;
  dbPath = dbPath || ctx?.dbPath || state.currentDbPath;
  if (!data?.entities || !dbPath) return;
  const config = getDbTreeViewConfig(dbPath, ctx);
  const viewConfig = getDbViewConfig(dbPath);
  const viewIndex = typeof _getCurrentDbViewIndexFromConfig === 'function'
    ? _getCurrentDbViewIndexFromConfig(viewConfig, { ctx })
    : Number(viewConfig?.currentViewIdx) || 0;
  const currentView = Array.isArray(viewConfig?.savedViews) ? viewConfig.savedViews[viewIndex] : viewConfig;
  if (!currentView) return;
  const before = typeof captureDbViewConfigHistory === 'function' ? captureDbViewConfigHistory(dbPath) : null;
  const properties = Array.isArray(data.properties) ? data.properties : [];
  const hidden = typeof getHiddenCols === 'function' ? getHiddenCols(dbPath, { ctx }) : [];
  const excluded = new Set([
    config.labelProp,
    config.parentProp,
    config.orderProp,
    config.collapsedProp,
    '内部ID',
  ].filter(Boolean));
  const visibleProps = properties.filter(prop => !hidden.includes(prop) && !excluded.has(prop));
  const nodes = ctx._dbTreeViewModel?.nodes || _dbTreeBuildModel(data, dbPath, ctx, config).nodes;
  const charsFor = (texts, header) => typeof _dbAutoWidthCharsForTexts === 'function'
    ? _dbAutoWidthCharsForTexts(texts, header)
    : Math.min(48, Math.max(6, ...[header, ...texts].map(value => [...String(value || '')].length)));
  const pxFor = chars => typeof _dbWidthPxFromChars === 'function'
    ? _dbWidthPxFromChars(chars)
    : Math.max(80, Math.min(640, chars * 12 + 28));
  currentView.colWidths = { ...(currentView.colWidths || {}) };
  const labelKey = config.labelProp || '__entity__';
  currentView.colWidths[labelKey] = Math.max(180, pxFor(charsFor(nodes.map(node => node.label), labelKey)) + 48);
  visibleProps.forEach(propName => {
    const values = nodes.map(node => _dbTreeDisplayValue(
      _dbTreeFirstValue(node.entityData, propName, ctx?.filter ?? state.filter ?? 'disabled'),
    ));
    currentView.colWidths[propName] = pxFor(charsFor(values, propName));
  });
  saveDbViewConfig(dbPath, viewConfig, { skipHistory: true, ctx });
  if (before && typeof pushDbViewConfigHistory === 'function' && typeof captureDbViewConfigHistory === 'function') {
    pushDbViewConfigHistory(dbPath, 'シート表示: 列幅自動調整', before, captureDbViewConfigHistory(dbPath), 'ツリーの全列');
  }
  renderDbTreeView(ctx);
  showStatus('ツリービューの列幅を自動調整しました');
}

function _dbTreeInstallAutoFitAdapter() {
  if (typeof window === 'undefined' || typeof window.autoFitCurrentSheetColumns !== 'function') return;
  const original = window.autoFitCurrentSheetColumns;
  if (original._dbTreeAware) return;
  const wrapped = function (event, ctxOverride, dbPathOverride) {
    const ctx = ctxOverride || (typeof _dbPaneContextFromEvent === 'function'
      ? _dbPaneContextFromEvent(event, { dbPath: dbPathOverride || state.currentDbPath })
      : (typeof _currentPaneState === 'function' ? _currentPaneState() : null));
    const dbPath = dbPathOverride || ctx?.dbPath || state.currentDbPath;
    if (_dbTreeIsCurrentView(ctx, dbPath)) return _dbTreeAutoFitColumns(ctx, dbPath);
    return original.apply(this, arguments);
  };
  wrapped._dbTreeAware = true;
  wrapped._dbTreeOriginal = original;
  window.autoFitCurrentSheetColumns = wrapped;
}

if (typeof window !== 'undefined') {
  window._dbTreeIsCurrentView = _dbTreeIsCurrentView;
  window._dbTreeSetOptionTabVisible = _dbTreeSetOptionTabVisible;
  _dbTreeInstallAutoFitAdapter();
}
