/* ビュー管理・ギャラリー・カンバン・タイムライン — gb-database.js から分離 */

/* ==============================
   複数ビュー管理
   ============================== */
function getSavedViews(dbPath) { return getDbViewConfig(dbPath).savedViews || []; }
function setSavedViews(dbPath, views, options = {}) {
  const c = getDbViewConfig(dbPath);
  c.savedViews = views;
  const label = options.historyLabel || options.label || '';
  saveDbViewConfig(dbPath, c, {
    historyLabel: label,
    historyDetail: options.detail || '',
    skipHistory: options.skipHistory === true || !label,
  });
}
function getCurrentViewIdx(dbPath) { return getDbViewConfig(dbPath).currentViewIdx ?? -1; }
function setCurrentViewIdx(dbPath, idx, options = {}) {
  const c = getDbViewConfig(dbPath);
  c.currentViewIdx = idx;
  const label = options.historyLabel || options.label || '';
  saveDbViewConfig(dbPath, c, {
    historyLabel: label,
    historyDetail: options.detail || '',
    skipHistory: options.skipHistory === true || !label,
  });
}

const VIEW_TYPES = [
  {mode:'pivot', icon:'table', label:'テーブル'},
  {mode:'gallery', icon:'layoutGrid', label:'ギャラリー'},
  {mode:'kanban', icon:'columns', label:'カンバン'},
  {mode:'calendar', icon:'calendar', label:'カレンダー'},
  {mode:'timeline', icon:'clock', label:'タイムライン'},
  {mode:'chart', icon:'barChart2', label:'チャート'},
  {mode:'graph', icon:'gitBranch', label:'グラフ'},
  {mode:'form', icon:'clipboardList', label:'フォーム'},
];

function startSavedViewInlineRename(tab, idx, ctx) {
  ctx = ctx || _currentPaneState();
  const dbPath = ctx.dbPath || state.currentDbPath;
  const views = getSavedViews(dbPath);
  const view = views[idx];
  if (!tab || !view) return;
  const input = document.createElement('input');
  input.type = 'text';
  input.value = view.name;
  input.style.cssText = 'width:80px;font-size:12px;padding:1px 4px;background:var(--bg);color:var(--fg);border:1px solid var(--accent);border-radius:2px;';
  tab.innerHTML = '';
  tab.appendChild(input);
  input.focus();
  input.select();
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    const nv = input.value.trim() || view.name;
    const views2 = getSavedViews(dbPath);
    if (views2[idx]) {
      views2[idx].name = nv;
      setSavedViews(dbPath, views2, { label: 'シート表示: ビュー名変更', detail: nv });
    }
    renderDbViewTabs(ctx);
  };
  input.addEventListener('blur', finish);
  input.addEventListener('keydown', (ke) => {
    if (ke.key === 'Enter') input.blur();
    if (ke.key === 'Escape') { input.value = view.name; input.blur(); }
  });
}

function _getViewAddMenuGroups(isCalendarCapable) {
  const groupModes = [
    ['pivot', 'gallery', 'kanban'],
    ['calendar', 'timeline'],
    ['chart', 'graph'],
    ['form'],
  ];
  return groupModes.map(group => group
    .map(mode => VIEW_TYPES.find(vt => vt.mode === mode))
    .filter(vt => vt && (isCalendarCapable || vt.mode !== 'calendar')));
}

function _appendDbViewSelectOption(select, value, label, selected) {
  const option = document.createElement('option');
  option.value = value;
  option.textContent = label;
  option.selected = !!selected;
  select.appendChild(option);
}

function _renderDbViewSelect(select, ctx, views, curIdx) {
  if (!select) return;
  select.innerHTML = '';
  const dbPath = ctx.dbPath || state.currentDbPath;
  const e2eScope = String(ctx?.paneId || ctx?.id || dbPath || 'main').replace(/[^\w-]/g, '_');
  select.dataset.e2eId = `db-view-select-${e2eScope}`;
  (views || []).forEach((v, i) => {
    const label = String(v?.name || '').trim() || 'ビュー ' + (i + 1);
    _appendDbViewSelectOption(select, 'saved:' + i, label, curIdx === i);
  });
  if (!views || views.length === 0) {
    _appendDbViewSelectOption(select, '', 'ビューなし', true);
    select.disabled = true;
  } else {
    select.disabled = false;
  }
  select.onchange = () => {
    const value = select.value || '';
    if (value.startsWith('saved:')) {
      const idx = parseInt(value.slice('saved:'.length), 10);
      if (!Number.isNaN(idx)) loadSavedView(idx, ctx);
      return;
    }
  };
}

function _dbViewToolbarActionHost(tabs) {
  const root = tabs?.closest?.('#tb-db');
  return root?.querySelector?.('.db-toolbar-actions-right') || tabs;
}

function _prepareDbViewToolbarActions(tabs) {
  const host = _dbViewToolbarActionHost(tabs);
  if (host && host !== tabs) {
    host.querySelectorAll('[data-db-view-toolbar-action="1"]').forEach(el => el.remove());
  }
  return host || tabs;
}

function _markDbViewToolbarAction(btn) {
  btn.dataset.dbViewToolbarAction = '1';
  btn.classList.add('db-view-toolbar-action');
  return btn;
}

function _bindDbViewTabsWheelScroll(tabs) {
  if (!tabs || tabs.dataset.dbWheelScrollBound === '1') return;
  tabs.dataset.dbWheelScrollBound = '1';
  tabs.addEventListener('wheel', (e) => {
    if (tabs.scrollWidth <= tabs.clientWidth) return;
    const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    if (!delta) return;
    tabs.scrollLeft += delta;
    e.preventDefault();
  }, { passive: false });
}

function _clearDbViewTabDropIndicator(tabs) {
  const scope = tabs || document;
  scope.querySelectorAll?.('.view-tab.db-view-drop-before, .view-tab.db-view-drop-after')
    .forEach(tab => tab.classList.remove('db-view-drop-before', 'db-view-drop-after', 'drag-over-tab'));
}

function _dbViewTabDropSide(tab, event) {
  const rect = tab.getBoundingClientRect();
  const x = typeof event?.clientX === 'number' ? event.clientX : rect.left + rect.width / 2;
  return x < rect.left + rect.width / 2 ? 'before' : 'after';
}

function _markDbViewTabDropIndicator(tab, event) {
  const tabs = tab?.closest?.('.db-view-tabs');
  if (!tab || !tabs) return 'after';
  _clearDbViewTabDropIndicator(tabs);
  const side = _dbViewTabDropSide(tab, event);
  tab.classList.add('drag-over-tab', side === 'before' ? 'db-view-drop-before' : 'db-view-drop-after');
  return side;
}

function _dbViewDropTargetIndex(fromIdx, overIdx, side) {
  let targetIdx = side === 'after' ? overIdx + 1 : overIdx;
  if (fromIdx < targetIdx) targetIdx--;
  return Math.max(0, targetIdx);
}

function _syncDbToolbarFilterButtonIcon() {
  const btn = document.getElementById('btn-filter');
  if (!btn || btn.dataset.dbFilterLucideReady === '1' || typeof lucide !== 'function') return;
  const badge = btn.querySelector('#filter-badge');
  btn.innerHTML = lucide('filter', 16);
  if (badge) btn.appendChild(badge);
  btn.dataset.dbFilterLucideReady = '1';
}

function _defaultDbSavedViewName(viewMode, index = 0) {
  const mode = _normalizeDbViewModeValue(viewMode || 'pivot');
  const base = VIEW_TYPES.find(vt => vt.mode === mode)?.label || 'ビュー';
  return index > 0 ? base + ' ' + (index + 1) : base;
}

function renderDbViewTabs(ctx) {
  ctx = ctx || _currentPaneState();
  const dbPath = ctx.dbPath || state.currentDbPath;
  if (!dbPath) return;
  const views = getSavedViews(dbPath);
  const curIdx = getCurrentViewIdx(dbPath);
  const tabs = _paneEl(ctx, '.db-view-tabs') || document.getElementById('db-view-tabs');
  const select = _paneEl(ctx, '.db-view-select') || document.getElementById('db-view-select');
  _renderDbViewSelect(select, ctx, views, curIdx);
  if (!tabs) {
    console.warn('[Meldex] シートビュータブの表示先が見つからないため、タブ描画をスキップしました。', { dbPath });
    return;
  }
  tabs.innerHTML = '';
  _bindDbViewTabsWheelScroll(tabs);
  _syncDbToolbarFilterButtonIcon();
  const actionHost = _prepareDbViewToolbarActions(tabs);
  const e2eScope = String(ctx?.paneId || ctx?.id || dbPath || 'main').replace(/[^\w-]/g, '_');
  const calendarInfo = typeof _getCalendarIntegrationInfo === 'function'
    ? _getCalendarIntegrationInfo(dbPath, ctx.pivotData || state.pivotData)
    : { kind: !!(ctx.pivotData?.calendar_db || state.dbMetadata?.calendar_mapping) ? 'calendar-db' : 'none' };
  const isCalendarCapable = calendarInfo.kind !== 'none';

  // ビュー（D&D対応 + ダブルクリックでリネーム + ホバーで...ボタン）
  views.forEach((v, i) => {
    const tab = document.createElement('button');
    tab.className = 'view-tab' + (curIdx === i ? ' active' : '');
    tab.dataset.e2eId = `db-saved-view-${e2eScope}-${i}`;
    tab.style.position = 'relative';
    const vtDef = VIEW_TYPES.find(vt => vt.mode === (v.viewMode || 'pivot'));
    const labelSpan = document.createElement('span');
    labelSpan.innerHTML = (vtDef ? lucide(vtDef.icon, 12) + ' ' : '') + esc(v.name);
    tab.appendChild(labelSpan);
    // ホバー時の「...」ボタン
    const moreBtn = document.createElement('span');
    moreBtn.className = 'view-tab-more';
    moreBtn.dataset.e2eId = `db-saved-view-more-${e2eScope}-${i}`;
    moreBtn.innerHTML = lucide('moreHorizontal', 14);
    moreBtn.style.cssText = 'margin-left:4px;opacity:0;padding:0 2px;border-radius:2px;cursor:pointer;display:inline-flex;align-items:center;transition:opacity 0.1s;';
    moreBtn.title = 'ビュー操作';
    moreBtn.addEventListener('mouseenter', () => { moreBtn.style.background = 'var(--bg4)'; });
    moreBtn.addEventListener('mouseleave', () => { moreBtn.style.background = ''; });
    moreBtn.addEventListener('click', (e) => { e.stopPropagation(); showViewTabMenu(e, i, true, ctx); });
    tab.appendChild(moreBtn);
    tab.addEventListener('mouseenter', () => { moreBtn.style.opacity = '1'; });
    tab.addEventListener('mouseleave', () => { moreBtn.style.opacity = '0'; });
    tab.addEventListener('click', (e) => { if (e.target === moreBtn || moreBtn.contains(e.target)) return; loadSavedView(i, ctx); });
    tab.oncontextmenu = (e) => { e.preventDefault(); showViewTabMenu(e, i, false, ctx); };
    if (typeof addLongPressHandler === 'function') {
      addLongPressHandler(tab, (e) => showViewTabMenu(e, i, false, ctx));
    }

    // ダブルクリック: インラインリネーム
    tab.ondblclick = (e) => {
      e.stopPropagation();
      startSavedViewInlineRename(tab, i, ctx);
    };

    // D&D: タブ順序入れ替え
    tab.draggable = true;
    tab.addEventListener('dragstart', (e) => {
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/x-view-idx', String(i));
        e.dataTransfer.setData('text/x-view-db-path', dbPath);
      }
      tab.classList.add('dragging');
    });
    tab.addEventListener('dragend', () => {
      tab.classList.remove('dragging');
      _clearDbViewTabDropIndicator(tabs);
    });
    tab.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
      _markDbViewTabDropIndicator(tab, e);
    });
    tab.addEventListener('dragleave', (e) => {
      if (e.relatedTarget && tab.contains(e.relatedTarget)) return;
      tab.classList.remove('drag-over-tab', 'db-view-drop-before', 'db-view-drop-after');
    });
    tab.addEventListener('drop', (e) => {
      e.preventDefault();
      const side = _dbViewTabDropSide(tab, e);
      _clearDbViewTabDropIndicator(tabs);
      const fromIdx = parseInt(e.dataTransfer?.getData('text/x-view-idx'), 10);
      const fromDbPath = e.dataTransfer?.getData('text/x-view-db-path');
      if (fromDbPath !== dbPath || isNaN(fromIdx) || fromIdx === i) return;
      const views2 = getSavedViews(dbPath);
      if (fromIdx < 0 || fromIdx >= views2.length || i < 0 || i >= views2.length) return;
      const insertIdx = Math.min(_dbViewDropTargetIndex(fromIdx, i, side), views2.length - 1);
      if (insertIdx === fromIdx) return;
      const moved = views2.splice(fromIdx, 1)[0];
      if (!moved) return;
      views2.splice(insertIdx, 0, moved);
      const before = typeof captureDbViewConfigHistory === 'function' ? captureDbViewConfigHistory(dbPath) : null;
      setSavedViews(dbPath, views2, { skipHistory: true });
      // currentViewIdxも調整
      let ci = getCurrentViewIdx(dbPath);
      if (ci === fromIdx) ci = insertIdx;
      else if (fromIdx < ci && insertIdx >= ci) ci--;
      else if (fromIdx > ci && insertIdx <= ci) ci++;
      setCurrentViewIdx(dbPath, ci, { skipHistory: true });
      if (typeof pushDbViewConfigHistory === 'function' && typeof captureDbViewConfigHistory === 'function') {
        pushDbViewConfigHistory(dbPath, 'シート表示: ビュー並び替え', before, captureDbViewConfigHistory(dbPath));
      }
      renderDbViewTabs(ctx);
    });

    tabs.appendChild(tab);
  });

  // + ボタン（ビュータイプ選択ドロップダウン付き）
  const addBtn = document.createElement('button');
  addBtn.className = 'view-tab-add tb-icon-btn';
  _markDbViewToolbarAction(addBtn);
  addBtn.dataset.e2eId = `db-view-add-${e2eScope}`;
  addBtn.innerHTML = lucide('plus', 16);
  addBtn.title = 'ビューを追加';
  addBtn.addEventListener('click', (e) => {
    if (typeof closeColHeaderMenu === 'function') closeColHeaderMenu();
    e.preventDefault();
    e.stopPropagation();
    const menu = document.createElement('div');
    menu.className = 'gb-context-menu';
    _getViewAddMenuGroups(isCalendarCapable).forEach((group, groupIndex, groups) => {
      group.forEach(vt => {
        const item = document.createElement('div');
        item.className = 'gb-context-menu-item';
        item.innerHTML = lucide(vt.icon, 14) + ' ' + vt.label + ' ビューを追加';
        item.addEventListener('click', (ev) => { menu.remove(); doSaveViewWithTypeDirect(vt.mode, vt.label, { ctx, event: ev }); });
        menu.appendChild(item);
      });
      if (group.length > 0 && groups.slice(groupIndex + 1).some(next => next.length > 0)) {
        const sep = document.createElement('div');
        sep.className = 'gb-context-menu-sep';
        menu.appendChild(sep);
      }
    });
    const rect = addBtn.getBoundingClientRect();
    { const z = _getZoom(); menu.style.left = (rect.left / z) + 'px'; menu.style.top = (rect.bottom / z + 2) + 'px'; }
    document.body.appendChild(menu);
    clampPopupToViewport(menu);
    setTimeout(() => {
      const closer = (ev) => { if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener('pointerdown', closer); } };
      document.addEventListener('pointerdown', closer);
    }, 0);
  });
  tabs.appendChild(addBtn);

  // テンプレートボタン
  if (typeof showTemplateGalleryModal === 'function') {
    const tmplBtn = document.createElement('button');
    tmplBtn.className = 'view-tab-add tb-icon-btn';
    _markDbViewToolbarAction(tmplBtn);
    tmplBtn.dataset.e2eId = `db-template-${e2eScope}`;
    tmplBtn.innerHTML = lucide('layoutTemplate', 16);
    tmplBtn.title = 'シートテンプレート';
    tmplBtn.addEventListener('click', () => showTemplateGalleryModal(dbPath));
    actionHost.appendChild(tmplBtn);
  }

  // DB設定ボタン（ギアアイコン）
  const gearBtn = document.createElement('button');
  gearBtn.className = 'view-tab-add tb-icon-btn';
  _markDbViewToolbarAction(gearBtn);
  gearBtn.dataset.e2eId = `db-settings-${e2eScope}`;
  gearBtn.innerHTML = lucide('settings', 16);
  gearBtn.title = 'シート設定';
  gearBtn.addEventListener('click', () => _showDbConfigModal(dbPath, ctx));
  actionHost.appendChild(gearBtn);
}

function renderDbNoViewsGuide(ctx) {
  ctx = ctx || _currentPaneState();
  const dbPath = ctx.dbPath || state.currentDbPath;
  if (typeof showView === 'function') showView('pivot', ctx);
  const container = _paneEl(ctx, '.pivot-view') || document.getElementById('pivot-view');
  if (!container) return;
  container.innerHTML = '';
  const guide = document.createElement('div');
  guide.className = 'db-no-views-guide';
  guide.style.cssText = 'min-height:260px;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:12px;color:var(--fg2);';
  const title = document.createElement('div');
  title.style.cssText = 'font-size:18px;font-weight:600;color:var(--fg);';
  title.textContent = 'ビューがありません';
  const desc = document.createElement('div');
  desc.style.cssText = 'font-size:13px;';
  desc.textContent = '+ボタンでビューを追加してください';
  const add = document.createElement('button');
  add.className = 'gb-btn primary';
  add.style.cssText = 'display:inline-flex;align-items:center;gap:6px;padding:8px 14px;';
  add.innerHTML = lucide('plus', 16) + ' ビューを追加';
  add.addEventListener('click', (ev) => doSaveViewWithTypeDirect('pivot', 'テーブル', { ctx, event: ev }));
  guide.appendChild(title);
  guide.appendChild(desc);
  guide.appendChild(add);
  container.appendChild(guide);
}

/* ==============================
   DB設定モーダル（エントリ名テンプレート等）
   ============================== */
function _setDbCalendarMappingFallbackOnViews(cfg, mapping) {
  const views = Array.isArray(cfg?.savedViews) ? cfg.savedViews : [];
  views.forEach(view => {
    if (!view || typeof view !== 'object') return;
    if (typeof _ensureDbViewTypeSpecific === 'function') _ensureDbViewTypeSpecific(view, cfg);
    if (!view.typeSpecific || typeof view.typeSpecific !== 'object' || Array.isArray(view.typeSpecific)) view.typeSpecific = {};
    if (!view.typeSpecific.calendar || typeof view.typeSpecific.calendar !== 'object' || Array.isArray(view.typeSpecific.calendar)) view.typeSpecific.calendar = {};
    view.typeSpecific.calendar.mapping = mapping ? _cloneDbViewObject(mapping) : {};
  });
  if (cfg && Object.prototype.hasOwnProperty.call(cfg, 'calendarMapping')) delete cfg.calendarMapping;
}

async function _showDbConfigModal(dbPath, ctx) {
  const cfg = getDbViewConfig(dbPath);
  const nameTemplate = cfg.entryNameTemplate || '';

  const localCtx = ctx || _currentPaneState();
  let pivotData = localCtx?.dbPath === dbPath ? localCtx.pivotData : null;
  if (!pivotData && state.currentDbPath === dbPath) pivotData = state.pivotData;
  if (!pivotData) {
    try { pivotData = await apiFetch('/pivot?path=' + encodeURIComponent(dbPath)); } catch { pivotData = null; }
  }
  let dbMetadata = state.currentDbPath === dbPath ? state.dbMetadata : null;
  if (!dbMetadata && typeof _getDbMetadataCached === 'function') {
    dbMetadata = await _getDbMetadataCached(dbPath, true);
  }
  if (!dbMetadata) dbMetadata = { property_types: null, calendar_mapping: null };
  const props = pivotData ? pivotData.properties : [];
  const propHints = props.map(p => `{${p}}`).join(', ');

  const o = document.createElement('div');
  o.className = 'modal-overlay';
  o.innerHTML = `<div class="modal" style="min-width:450px;">
    <h3>シート設定</h3>
    <div class="field">
      <label>エントリ名テンプレート</label>
      <input id="dbcfg-name-template" type="text" value="${esc(nameTemplate)}" placeholder="例: {キャラ}_{年齢}">
      <div style="font-size:11px;color:var(--fg2);margin-top:4px;">
        プロパティ名を <code>{プロパティ名}</code> で囲むと、採用値で自動置換されます。<br>
        空の場合はエントリ名の自動生成を行いません。<br>
        使用可能: ${esc(propHints) || '(プロパティなし)'}
      </div>
    </div>
    <div class="field" style="margin-top:8px;">
      <label>ステータス一覧</label>
      <div id="dbcfg-status-list" style="font-size:12px;"></div>
      <button id="dbcfg-add-status" style="font-size:11px;margin-top:4px;padding:2px 8px;">+ ステータス追加</button>
    </div>
    <div class="field" style="margin-top:8px;">
      <label>依存エントリ作成時のコピー対象</label>
      <div id="dbcfg-copy-props" style="max-height:120px;overflow-y:auto;font-size:12px;"></div>
    </div>
    <div id="dbcfg-calendar-mapping-anchor"></div>
    <div class="btn-row" style="justify-content:space-between;">
      <button id="dbcfg-template" style="font-size:12px;">テンプレートを適用...</button>
      <div style="display:flex;gap:8px;">
        <button data-action="this.closest('.modal-overlay').remove()">キャンセル</button>
        <button class="primary" id="dbcfg-save">保存</button>
      </div>
    </div>
  </div>`;
  document.body.appendChild(o);

  // テンプレートボタン
  const tmplBtn = o.querySelector('#dbcfg-template');
  if (tmplBtn && typeof showTemplateGalleryModal === 'function') {
    tmplBtn.addEventListener('click', () => { o.remove(); showTemplateGalleryModal(dbPath); });
  } else if (tmplBtn) {
    tmplBtn.style.display = 'none';
  }

  // ステータス一覧エディタ
  const statusDiv = o.querySelector('#dbcfg-status-list');
  function _createStatusRow(name, color, index = 0) {
    const rowKey = 'dbcfg-status-' + index;
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:4px;margin-bottom:3px;';
    // カラースウォッチ（共通カラーパレット）
    const swatch = document.createElement('button');
    swatch.type = 'button';
    swatch.className = 'dbcfg-st-color gb-color-swatch gb-color-swatch--status';
    swatch.dataset.color = color || '#888888';
    swatch.dataset.e2eId = rowKey + '-color';
    swatch.setAttribute('aria-label', 'ステータス色 ' + (name || index + 1));
    bindColorSwatch(swatch, () => getColorSwatchValue(swatch, color || '#888888'), (nextColor) => {
      setColorSwatchValue(swatch, nextColor || '#888888');
    });
    row.appendChild(swatch);
    const nameInput = document.createElement('input');
    nameInput.type = 'text'; nameInput.value = name || '';
    nameInput.placeholder = 'ステータス名';
    nameInput.style.cssText = 'flex:1;padding:2px 4px;font-size:12px;background:var(--bg);color:var(--fg);border:1px solid var(--border);border-radius:3px;';
    nameInput.className = 'dbcfg-st-name';
    nameInput.dataset.e2eId = rowKey + '-name';
    row.appendChild(nameInput);
    const delBtn = document.createElement('button');
    delBtn.innerHTML = lucide('x', 12); delBtn.title = '削除';
    delBtn.dataset.e2eId = rowKey + '-delete';
    delBtn.setAttribute('aria-label', 'ステータスを削除 ' + (name || index + 1));
    delBtn.style.cssText = 'padding:1px 6px;font-size:12px;cursor:pointer;color:var(--fg2);';
    delBtn.addEventListener('click', () => row.remove());
    row.appendChild(delBtn);
    return { row, nameInput };
  }
  function _renderStatusEditor() {
    statusDiv.innerHTML = '';
    getStatusList(dbPath).forEach((st, index) => {
      const { row } = _createStatusRow(st.name, st.color, index);
      statusDiv.appendChild(row);
    });
  }
  _renderStatusEditor();
  o.querySelector('#dbcfg-add-status')?.addEventListener('click', () => {
    const { row, nameInput } = _createStatusRow('', '#888888', statusDiv.querySelectorAll(':scope > div').length);
    statusDiv.appendChild(row);
    nameInput.focus();
  });

  // コピー対象プロパティのチェックボックスを動的生成
  const copyPropsDiv = o.querySelector('#dbcfg-copy-props');
  const pts = getPropertyTypes(dbPath);
  const currentCopy = cfg.dependentCopyProps || [];
  const defaultCopy = typeof _getDependentCopyProps === 'function' ? _getDependentCopyProps(dbPath, pts) : [];
  for (const p of props) {
    const ptc = pts[p] || {};
    if (ptc.pairWith) continue; // ペアプロパティは除外
    if (!['relation', 'multi-relation', 'select', 'multi-select', 'number'].includes(ptc.type || '')) continue;
    const checked = currentCopy.length > 0 ? currentCopy.includes(p) : defaultCopy.includes(p);
    const lbl = document.createElement('label');
    lbl.style.cssText = 'display:flex;align-items:center;gap:4px;padding:2px 0;cursor:pointer;';
    const cb = document.createElement('input');
    cb.type = 'checkbox'; cb.checked = checked; cb.dataset.prop = p;
    lbl.appendChild(cb);
    lbl.appendChild(document.createTextNode(p));
    copyPropsDiv.appendChild(lbl);
  }

  if (typeof _renderCalendarMappingConfigSection === 'function') {
    const currentCalendarMapping = dbMetadata?.calendar_mapping
      || (typeof getCalendarMapping === 'function' ? getCalendarMapping(dbPath) : null);
    _renderCalendarMappingConfigSection(
      o.querySelector('#dbcfg-calendar-mapping-anchor'),
      dbPath,
      props,
      pts,
      currentCalendarMapping || null
    );
  }

  o.querySelector('#dbcfg-save').addEventListener('click', async () => {
    const c = getDbViewConfig(dbPath);
    c.entryNameTemplate = o.querySelector('#dbcfg-name-template').value.trim();
    // ステータス一覧の保存
    const statusList = [];
    statusDiv.querySelectorAll('div').forEach(row => {
      const name = row.querySelector('.dbcfg-st-name')?.value?.trim();
      const colorEl = row.querySelector('.dbcfg-st-color');
      const color = colorEl?.dataset?.color || '#888888';
      if (name) statusList.push({ name, color });
    });
    c.statusList = statusList;
    // コピー対象プロパティの保存
    const checkedProps = [];
    copyPropsDiv.querySelectorAll('input[type="checkbox"]').forEach(cb => {
      if (cb.checked) checkedProps.push(cb.dataset.prop);
    });
    c.dependentCopyProps = checkedProps;
    let calendarMapping = null;
    if (typeof _collectCalendarMappingConfig === 'function') {
      try {
        calendarMapping = _collectCalendarMappingConfig(o);
      } catch (e) {
        showStatus(e?.message || 'カレンダー連携設定の保存に失敗しました', true);
        return;
      }
    }
    _setDbCalendarMappingFallbackOnViews(c, calendarMapping);
    saveDbViewConfig(dbPath, c);
    try {
      await apiPut('/db-metadata?path=' + encodeURIComponent(dbPath), {
        calendar_mapping: calendarMapping
      });
      if (state.currentDbPath === dbPath && state.dbMetadata) state.dbMetadata.calendar_mapping = calendarMapping;
      if (typeof _invalidateDbMetadataCache === 'function') _invalidateDbMetadataCache(dbPath);
    } catch (e) {
      showStatus('カレンダー連携設定の保存に失敗しました', true);
      return;
    }
    o.remove();
    showStatus('シート設定を保存しました');
    if (state.currentDbPath) await selectDatabase(state.currentDbPath);
  });
}

/* ==============================
   エントリ名自動生成（テンプレートから）
   ============================== */
function _generateEntryName(dbPath, entityName, ctx) {
  const cfg = getDbViewConfig(dbPath);
  const template = cfg.entryNameTemplate;
  const data = (ctx && ctx.dbPath === dbPath ? ctx.pivotData : null)
    || (state.currentDbPath === dbPath ? state.pivotData : null)
    || ctx?.pivotData
    || state.pivotData;
  if (!template || !data) return null;

  const entityData = data.entities?.[entityName];
  if (!entityData) return null;

  let name = template;
  const placeholders = template.match(/\{([^}]+)\}/g) || [];
  for (const ph of placeholders) {
    const propName = ph.slice(1, -1);
    const vals = entityData[propName] || [];
    // 採用値を優先、なければ最初の値
    const adopted = vals.find(v => v.status === '採用') || vals.find(v => v.status === '掲載済み') || vals[0];
    const val = adopted ? adopted.value : '';
    name = name.replace(ph, val);
  }
  return name.trim() || null;
}



function _makeDbViewStateFromCurrent(dbPath, viewMode, name, ctx) {
  const cfg = getDbViewConfig(dbPath);
  const activeView = typeof getCurrentDbViewConfigEntry === 'function'
    ? getCurrentDbViewConfigEntry(dbPath)
    : null;
  const paneData = ctx?.dbPath === dbPath ? ctx.pivotData : null;
  const viewState = {
    name,
    viewMode,
    hiddenCols: _cloneDbViewArray(activeView?.hiddenCols),
    pinnedCols: _cloneDbViewArray(activeView?.pinnedCols),
    colOrder: activeView?.colOrder == null ? null : _cloneDbViewValue(activeView.colOrder, null),
    advancedFilters: _cloneDbViewArray(activeView?.advancedFilters),
    conditionalFormat: !!activeView?.conditionalFormat,
    conditionalColors: _cloneDbViewObject(activeView?.conditionalColors),
    filter: ctx?.filter ?? state.filter,
    sortConfig: activeView?.sortConfig == null ? null : _cloneDbViewValue(activeView.sortConfig, null),
    manualOrder: activeView?.manualOrder == null ? null : _cloneDbViewValue(activeView.manualOrder, null),
    showFooter: activeView?.showFooter === true,
    entityColumnPinned: activeView?.entityColumnPinned !== false,
    countTypes: _cloneDbViewObject(activeView?.countTypes),
    colWidths: _cloneDbViewObject(activeView?.colWidths),
    thumbnailSize: activeView?.thumbnailSize || 'small',
    typeSpecific: _cloneDbViewObject(activeView?.typeSpecific),
  };
  if (typeof _ensureDbViewTypeSpecific === 'function') _ensureDbViewTypeSpecific(viewState, cfg);
  if (viewMode === 'form') {
    const props = paneData?.properties || state.pivotData?.properties || [];
    const propTypes = getPropertyTypes(dbPath) || {};
    const formConfig = typeof makeDefaultFormViewConfig === 'function'
      ? makeDefaultFormViewConfig(props, propTypes)
      : { fields: props, required: [], descriptions: {}, submitLabel: '送信', successMessage: '送信しました' };
    formConfig.id = 'form_' + Date.now();
    if (!viewState.typeSpecific.form) viewState.typeSpecific.form = {};
    viewState.typeSpecific.form.formConfig = formConfig;
  }
  return viewState;
}

function doSaveViewWithTypeDirect(viewMode, label, options = {}) {
  const ctx = options.ctx
    || (typeof _dbPaneContextFromEvent === 'function' ? _dbPaneContextFromEvent(options.event, { dbPath: state.currentDbPath }) : null)
    || _currentPaneState();
  const dbPath = ctx.dbPath || state.currentDbPath;
  const before = typeof captureDbViewConfigHistory === 'function' ? captureDbViewConfigHistory(dbPath) : null;
  const cfg = getDbViewConfig(dbPath);
  const viewState = _makeDbViewStateFromCurrent(dbPath, viewMode, label, ctx);
  const views = getSavedViews(dbPath);
  views.push(viewState);
  cfg.savedViews = views;
  saveDbViewConfig(dbPath, cfg, { skipHistory: true });
  loadSavedView(views.length - 1, ctx, { skipHistory: true });
  if (typeof pushDbViewConfigHistory === 'function' && typeof captureDbViewConfigHistory === 'function') {
    pushDbViewConfigHistory(dbPath, 'シート表示: ビュー追加', before, captureDbViewConfigHistory(dbPath), label || viewMode || '');
  }
}

function _initDbViewTypeSpecific(viewMode, dbPath, pivotData) {
  const props = pivotData?.properties || state.pivotData?.properties || [];
  switch (viewMode) {
    case 'pivot':
      return { groupBy: null };
    case 'gallery':
      return {};
    case 'kanban':
      return { groupBy: '_status' };
    case 'calendar':
      return { mapping: {} };
    case 'timeline':
      return typeof _normalizeDbTimelineTypeSpecific === 'function'
        ? _normalizeDbTimelineTypeSpecific({})
        : { timeProp: '', endProp: '', rowProp: '_entity', scale: 'day', direction: 'horizontal', colWidths: {}, rowHeights: {}, cardProps: [] };
    case 'chart':
      return { chartType: 'bar', xProperty: '', yAggregation: 'count', yProperty: null, showLabels: true, showLegend: true, palette: 'default' };
    case 'graph':
      return { colorProperty: '', showExternalNodes: true, layout: 'force', showLabels: true, showEdgeLabels: false };
    case 'form':
      return {
        formConfig: typeof makeDefaultFormViewConfig === 'function'
          ? makeDefaultFormViewConfig(props, getPropertyTypes(dbPath) || {})
          : { fields: props, required: [], descriptions: {}, submitLabel: '送信', successMessage: '送信しました' },
      };
    default:
      return {};
  }
}

function changeViewType(idx, newType, ctx) {
  ctx = ctx || _currentPaneState();
  const dbPath = ctx.dbPath || state.currentDbPath;
  const cfg = getDbViewConfig(dbPath);
  const views = Array.isArray(cfg.savedViews) ? cfg.savedViews : [];
  const view = views[idx];
  if (!view) return;
  const nextType = _normalizeDbViewModeValue(newType);
  if ((view.viewMode || 'pivot') === nextType) {
    loadSavedView(idx, ctx, { skipHistory: true });
    return;
  }
  const before = typeof captureDbViewConfigHistory === 'function' ? captureDbViewConfigHistory(dbPath) : null;
  if (typeof _ensureDbViewTypeSpecific === 'function') _ensureDbViewTypeSpecific(view, cfg);
  if (!view.typeSpecific || typeof view.typeSpecific !== 'object' || Array.isArray(view.typeSpecific)) view.typeSpecific = {};
  if (!view.typeSpecific[nextType]) {
    view.typeSpecific[nextType] = _initDbViewTypeSpecific(nextType, dbPath, ctx.pivotData || state.pivotData);
  }
  const prevType = view.viewMode || 'pivot';
  view.viewMode = nextType;
  cfg.savedViews = views;
  cfg.currentViewIdx = idx;
  saveDbViewConfig(dbPath, cfg, { skipHistory: true });
  if (typeof pushDbViewConfigHistory === 'function' && typeof captureDbViewConfigHistory === 'function') {
    const detail = (view.name || 'ビュー') + ': ' + prevType + ' → ' + nextType;
    pushDbViewConfigHistory(dbPath, 'シート表示: ビュータイプ変更', before, captureDbViewConfigHistory(dbPath), detail);
  }
  loadSavedView(idx, ctx, { skipHistory: true });
}

function switchDbViewMode(mode, viewIdx, ctx) {
  ctx = ctx || _currentPaneState();
  const dbPath = ctx.dbPath || state.currentDbPath;
  const idx = Number.isInteger(viewIdx) && viewIdx >= 0 ? viewIdx : getCurrentViewIdx(dbPath);
  if (idx >= 0) changeViewType(idx, mode, ctx);
}

function _cloneSavedViewState(view) {
  let cloned = null;
  try {
    cloned = typeof structuredClone === 'function'
      ? structuredClone(view)
      : JSON.parse(JSON.stringify(view || {}));
  } catch {
    cloned = JSON.parse(JSON.stringify(view || {}));
  }
  if (!cloned || typeof cloned !== 'object') cloned = {};
  if (cloned.formConfig) {
    cloned.formConfig.id = 'form_' + Date.now();
  }
  if (cloned.typeSpecific?.form?.formConfig) {
    cloned.typeSpecific.form.formConfig.id = 'form_' + Date.now();
  }
  return cloned;
}

function _makeDuplicateSavedViewName(sourceName, views) {
  const base = String(sourceName || 'ビュー').trim() || 'ビュー';
  const existing = new Set((views || []).map(v => String(v?.name || '').trim()).filter(Boolean));
  let candidate = base + ' コピー';
  let suffix = 2;
  while (existing.has(candidate)) {
    candidate = base + ' コピー ' + suffix;
    suffix += 1;
  }
  return candidate;
}

async function duplicateSavedView(idx, ctx) {
  ctx = ctx || _currentPaneState();
  const dbPath = ctx.dbPath || state.currentDbPath;
  const views = getSavedViews(dbPath);
  const source = views[idx];
  if (!source) return;

  const defaultName = _makeDuplicateSavedViewName(source.name, views);
  const input = typeof cfPrompt === 'function'
    ? await cfPrompt('複製後のビュー名', defaultName, { okLabel: '複製' })
    : defaultName;
  if (input == null) return;
  const name = String(input).trim();
  if (!name) {
    showStatus('名前を入力してください', true);
    return;
  }

  const before = typeof captureDbViewConfigHistory === 'function' ? captureDbViewConfigHistory(dbPath) : null;
  const duplicate = _cloneSavedViewState(source);
  duplicate.name = name;
  const insertIdx = idx + 1;
  views.splice(insertIdx, 0, duplicate);
  setSavedViews(dbPath, views, { skipHistory: true });
  loadSavedView(insertIdx, ctx, { skipHistory: true });
  if (typeof pushDbViewConfigHistory === 'function' && typeof captureDbViewConfigHistory === 'function') {
    const detail = (source.name || 'ビュー') + ' → ' + name;
    pushDbViewConfigHistory(dbPath, 'シート表示: ビュー複製', before, captureDbViewConfigHistory(dbPath), detail);
  }
  showStatus('ビューを複製しました: ' + name);
}

async function duplicateCurrentDbView(viewMode, label, ctx) {
  ctx = ctx || _currentPaneState();
  const dbPath = ctx.dbPath || state.currentDbPath;
  const mode = viewMode || getCurrentViewMode(dbPath) || 'pivot';
  const sourceLabel = String(label || VIEW_TYPES.find(vt => vt.mode === mode)?.label || 'ビュー').trim() || 'ビュー';
  const views = getSavedViews(dbPath);
  const defaultName = _makeDuplicateSavedViewName(sourceLabel, views);
  const input = typeof cfPrompt === 'function'
    ? await cfPrompt('複製後のビュー名', defaultName, { okLabel: '複製' })
    : defaultName;
  if (input == null) return;
  const name = String(input).trim();
  if (!name) {
    showStatus('名前を入力してください', true);
    return;
  }

  const before = typeof captureDbViewConfigHistory === 'function' ? captureDbViewConfigHistory(dbPath) : null;
  const duplicate = _makeDbViewStateFromCurrent(dbPath, mode, name);
  views.push(duplicate);
  setSavedViews(dbPath, views, { skipHistory: true });
  loadSavedView(views.length - 1, ctx, { skipHistory: true });
  if (typeof pushDbViewConfigHistory === 'function' && typeof captureDbViewConfigHistory === 'function') {
    pushDbViewConfigHistory(dbPath, 'シート表示: ビュー複製', before, captureDbViewConfigHistory(dbPath), sourceLabel + ' → ' + name);
  }
  showStatus('ビューを複製しました: ' + name);
}

function loadSavedView(idx, ctx, options = {}) {
  ctx = ctx || _currentPaneState();
  const dbPath = ctx.dbPath || state.currentDbPath;
  const views = getSavedViews(dbPath);
  const v = views[idx];
  if (!v) return;

  const before = options.skipHistory ? null : (typeof captureDbViewConfigHistory === 'function' ? captureDbViewConfigHistory(dbPath) : null);
  setCurrentViewIdx(dbPath, idx, { skipHistory: true });
  if (Object.prototype.hasOwnProperty.call(v, 'filter') && typeof setFilter === 'function') {
    setFilter(v.filter || 'disabled', { skipReload: true });
  }
  if (!options.skipHistory && typeof pushDbViewConfigHistory === 'function' && typeof captureDbViewConfigHistory === 'function') {
    pushDbViewConfigHistory(dbPath, 'シート表示: ビュー適用', before, captureDbViewConfigHistory(dbPath), v.name || '');
  }

  const targetView = v.viewMode === 'calendar' ? 'timeline' : (v.viewMode || 'pivot');
  showView(targetView, ctx);
  if (typeof _renderDbViewTabsSafely === 'function') _renderDbViewTabsSafely(ctx);
  else renderDbViewTabs(ctx);
  if (targetView === 'gallery') renderGallery(ctx);
  else if (targetView === 'kanban') renderKanban(ctx);
  else if (targetView === 'timeline') renderTimeline(ctx);
  else if (targetView === 'chart' && typeof renderChart === 'function') renderChart(ctx);
  else if (targetView === 'graph' && typeof renderGraph === 'function') renderGraph(ctx);
  else if (targetView === 'form' && typeof renderDbFormView === 'function') renderDbFormView(ctx);
  else renderPivot(ctx);
}

function showViewTabMenu(e, idx, fromMoreBtn, ctx) {
  closeColHeaderMenu();
  const menu = document.createElement('div');
  menu.className = 'gb-context-menu';
  ctx = ctx || _currentPaneState();
  const dbPath = ctx.dbPath || state.currentDbPath;
  const viewsCount = getSavedViews(dbPath).length;
  const targetTab = e?.target?.closest?.('.view-tab');
  const calendarInfo = typeof _getCalendarIntegrationInfo === 'function'
    ? _getCalendarIntegrationInfo(dbPath, ctx.pivotData || state.pivotData)
    : { kind: !!(ctx.pivotData?.calendar_db || state.dbMetadata?.calendar_mapping) ? 'calendar-db' : 'none' };
  const isCalendarCapable = calendarInfo.kind !== 'none';
  const currentView = getSavedViews(dbPath)[idx];
  const currentType = currentView?.viewMode || 'pivot';

  const swapViews = (fromIdx, toIdx) => {
    const views = getSavedViews(dbPath);
    if (toIdx < 0 || toIdx >= views.length) return;
    const before = typeof captureDbViewConfigHistory === 'function' ? captureDbViewConfigHistory(dbPath) : null;
    [views[fromIdx], views[toIdx]] = [views[toIdx], views[fromIdx]];
    setSavedViews(dbPath, views, { skipHistory: true });
    // currentViewIdxも追従
    const ci = getCurrentViewIdx(dbPath);
    if (ci === fromIdx) setCurrentViewIdx(dbPath, toIdx, { skipHistory: true });
    else if (ci === toIdx) setCurrentViewIdx(dbPath, fromIdx, { skipHistory: true });
    if (typeof pushDbViewConfigHistory === 'function' && typeof captureDbViewConfigHistory === 'function') {
      pushDbViewConfigHistory(dbPath, 'シート表示: ビュー並び替え', before, captureDbViewConfigHistory(dbPath));
    }
    renderDbViewTabs(ctx);
  };

  const items = [
    { label: '名前を変更', action: () => {
      setTimeout(() => startSavedViewInlineRename(targetTab, idx, ctx), 0);
    }},
    { label: 'このビューを複製...', action: () => duplicateSavedView(idx, ctx) },
    { type: 'sep' },
    {
      type: 'submenu',
      label: lucide('layoutDashboard', 14) + ' ビュータイプを変更',
      children: VIEW_TYPES
        .filter(vt => isCalendarCapable || vt.mode !== 'calendar')
        .map(vt => ({
          label: (vt.mode === currentType ? lucide('check', 14) + ' ' : '<span style="display:inline-block;width:14px;"></span> ') + lucide(vt.icon, 14) + ' ' + vt.label,
          action: () => changeViewType(idx, vt.mode, ctx),
        })),
    },
    { type: 'sep' },
    { label: '左と入れ替え', disabled: idx === 0, action: () => swapViews(idx, idx - 1) },
    { label: '右と入れ替え', disabled: idx >= viewsCount - 1, action: () => swapViews(idx, idx + 1) },
    { type: 'sep' },
    { label: '削除', action: async () => {
      if (!await cfConfirm('このビューを削除しますか？')) return;
      const before = typeof captureDbViewConfigHistory === 'function' ? captureDbViewConfigHistory(dbPath) : null;
      const views = getSavedViews(dbPath);
      views.splice(idx, 1);
      setSavedViews(dbPath, views, { skipHistory: true });
      const curIdx = getCurrentViewIdx(dbPath);
      let nextIdx = curIdx;
      if (curIdx === idx) nextIdx = views.length > 0 ? Math.min(idx, views.length - 1) : -1;
      else if (curIdx > idx) setCurrentViewIdx(dbPath, curIdx - 1, { skipHistory: true });
      if (curIdx === idx) setCurrentViewIdx(dbPath, nextIdx, { skipHistory: true });
      if (typeof pushDbViewConfigHistory === 'function' && typeof captureDbViewConfigHistory === 'function') {
        pushDbViewConfigHistory(dbPath, 'シート表示: ビュー削除', before, captureDbViewConfigHistory(dbPath));
      }
      if (nextIdx >= 0) loadSavedView(nextIdx, ctx, { skipHistory: true });
      else {
        renderDbViewTabs(ctx);
        if (typeof renderDbNoViewsGuide === 'function') renderDbNoViewsGuide(ctx);
      }
    }},
  ];

  _renderDbViewTabMenuItems(menu, items);

  { const z = _getZoom(); menu.style.left = (e.clientX / z) + 'px'; menu.style.top = (e.clientY / z) + 'px'; }
  document.body.appendChild(menu);
  clampPopupToViewport(menu);
  setTimeout(() => {
    const closer = (ev) => {
      if (!menu.contains(ev.target)) { closeColHeaderMenu(); document.removeEventListener('pointerdown', closer); }
    };
    document.addEventListener('pointerdown', closer);
  }, 0);
}

/* ==============================
   グループ化
   ============================== */
function getGroupBy(dbPath) {
  return getCurrentDbViewTypeSpecific(dbPath, 'pivot')?.groupBy || null;
}

function _renderDbViewTabMenuItems(container, itemList) {
  itemList.forEach(item => {
    if (item.type === 'sep') {
      container.appendChild(Object.assign(document.createElement('div'), { className: 'gb-context-menu-sep' }));
      return;
    }
    if (item.type === 'submenu') {
      const wrapper = document.createElement('div');
      const el = document.createElement('div');
      el.className = 'gb-context-menu-item';
      el.innerHTML = item.label + (typeof submenuArrow === 'function' ? submenuArrow() : ' ▸');
      const sub = document.createElement('div');
      sub.className = 'gb-context-menu gb-context-submenu';
      sub.style.display = 'none';
      _renderDbViewTabMenuItems(sub, item.children || []);
      if (typeof attachHoverSubmenu === 'function') attachHoverSubmenu(el, sub);
      else {
        el.addEventListener('mouseenter', () => { sub.style.display = 'block'; });
        wrapper.addEventListener('mouseleave', () => { sub.style.display = 'none'; });
      }
      wrapper.appendChild(el);
      wrapper.appendChild(sub);
      container.appendChild(wrapper);
      return;
    }
    const el = document.createElement('div');
    el.className = 'gb-context-menu-item';
    el.innerHTML = item.label;
    if (item.disabled) {
      el.style.opacity = '0.4';
      el.style.pointerEvents = 'none';
    } else {
      el.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        closeColHeaderMenu();
        try {
          await item.action();
        } catch (err) {
          console.error(err);
          showStatus('ビュー操作に失敗しました: ' + (err?.message || err), true);
        }
      });
    }
    container.appendChild(el);
  });
}
function setGroupBy(dbPath, prop, options = {}) {
  _saveCurrentDbViewField(dbPath, options.label || 'シート表示: グループ化', options.detail || prop || '解除', options, (v) => {
    if (!v.typeSpecific || typeof v.typeSpecific !== 'object' || Array.isArray(v.typeSpecific)) v.typeSpecific = {};
    if (!v.typeSpecific.pivot || typeof v.typeSpecific.pivot !== 'object' || Array.isArray(v.typeSpecific.pivot)) v.typeSpecific.pivot = {};
    v.typeSpecific.pivot.groupBy = prop;
  });
}

// renderPivotに統合（後述のrenderPivot改修で使用）

function _dbValueMatchesAdvancedFilter(valueObj, filter) {
  const target = filter.field === 'status' ? (valueObj?.status || '') : (valueObj?.value || '');
  switch (filter.operator) {
    case 'equals': return target === filter.value;
    case 'not_equals': return target !== filter.value;
    case 'contains': return target && target.includes(filter.value);
    case 'not_contains': return !target || !target.includes(filter.value);
    case 'empty': return !target || String(target).trim() === '';
    case 'not_empty': return target && String(target).trim() !== '';
    default: return true;
  }
}

function _dbValuesMatchAdvancedFilter(values, filter) {
  const list = Array.isArray(values) ? values : [];
  if (!list.length) return filter.operator === 'empty' || filter.operator === 'not_contains';
  if (filter.operator === 'not_equals' || filter.operator === 'not_contains') {
    return list.every(v => _dbValueMatchesAdvancedFilter(v, filter));
  }
  return list.some(v => _dbValueMatchesAdvancedFilter(v, filter));
}

function _dbEntityPassesAdvancedFilters(entityData, filters) {
  if (!Array.isArray(filters) || filters.length === 0) return true;
  return filters.every(filter => {
    if (filter.property === '*') {
      const allValues = Object.values(entityData || {}).flat().filter(v => v && typeof v === 'object');
      return _dbValuesMatchAdvancedFilter(allValues, filter);
    }
    const values = entityData?.[filter.property] || [];
    return _dbValuesMatchAdvancedFilter(values, filter);
  });
}

function _isKanbanGroupableProperty(dbPath, propName) {
  const ptc = getPropertyTypes(dbPath)[propName] || {};
  if (ptc.source) return false;
  if (['formula', 'rollup', 'button', 'multi-source-relation', 'chat'].includes(ptc.type || '')) return false;
  return !checkColumnEditable(dbPath, propName);
}

/* ==============================
   ギャラリービュー
   ============================== */
function renderGallery(ctx) {
  ctx = ctx || _currentPaneState();
  const data = ctx.pivotData || state.pivotData;
  const container = _paneEl(ctx, '.gallery-view') || document.getElementById('gallery-view');
  if (!container) {
    if (typeof showStatus === 'function') showStatus('シートのギャラリー表示領域を準備できませんでした。シートを開き直してください。', true);
    return;
  }
  if (!data || !data.entities) { container.innerHTML = '<div style="padding:40px;text-align:center;color:var(--fg2);">データがありません</div>'; return; }

  const dbPath = ctx.dbPath || state.currentDbPath;
  const hiddenCols = getHiddenCols(dbPath);
  const advFilters = getAdvancedFilters(dbPath);
  const propTypes = getPropertyTypes(dbPath);
  const colOrder = getColOrder(dbPath);
  const entitiesMap = data.entities;
  const entityNames = Object.keys(entitiesMap)
    .filter(name => _dbEntityPassesAdvancedFilters(entitiesMap[name], advFilters))
    .sort();
  if (entityNames.length === 0) { renderEmptyState(container, 'image', 'エントリがありません', '下部の入力欄から追加してください'); return; }
  // colOrder適用（renderPivotと同じ順序ロジック）
  let orderedProps = colOrder ? colOrder.filter(p => data.properties.includes(p)) : [...data.properties];
  data.properties.forEach(p => { if (!orderedProps.includes(p)) orderedProps.push(p); });
  const visibleProps = orderedProps.filter(p => !hiddenCols.includes(p));

  const grid = document.createElement('div');
  grid.className = 'gallery-grid';

  entityNames.forEach(entityName => {
    const entityData = entitiesMap[entityName];
    const card = document.createElement('div');
    card.className = 'gallery-card';
    card.dataset.entity = entityName;
    card.addEventListener('click', () => openEntityInSplit(_entityPath(dbPath, entityName), entityName));
    card.addEventListener('dblclick', (ev) => {
      ev.stopPropagation();
      if (typeof _navPushWithViewState === 'function') _navPushWithViewState(ctx, entityName);
      selectEntity(_entityPath(dbPath, entityName));
    });
    card.addEventListener('contextmenu', (e) => { e.preventDefault(); showDbCardContextMenu(e, dbPath, entityName); });
    if (typeof addLongPressHandler === 'function') {
      addLongPressHandler(card, (e) => showDbCardContextMenu(e, dbPath, entityName));
    }

    // タッチ用メニューボタン
    const moreBtn = document.createElement('span');
    moreBtn.className = 'card-more-btn';
    moreBtn.innerHTML = lucide('moreHorizontal', 12);
    moreBtn.title = 'メニュー';
    moreBtn.style.cssText = 'position:absolute;top:4px;right:4px;cursor:pointer;font-size:14px;color:var(--fg2);padding:2px 4px;border-radius:3px;z-index:5;';
    moreBtn.addEventListener('click', (e) => { e.stopPropagation(); showDbCardContextMenu(e, dbPath, entityName); });
    card.style.position = 'relative';
    card.appendChild(moreBtn);

    // タイトル
    const title = document.createElement('div');
    title.className = 'gallery-card-title';
    title.textContent = entityName;
    card.appendChild(title);

    // 画像プロパティがあればサムネイル
    for (const propName of visibleProps) {
      const vals = filterValues(entityData[propName] || []);
      for (const val of vals) {
        if (/\.(png|jpe?g|gif|webp|svg|bmp)$/i.test(val.value)) {
          const img = document.createElement('img');
          img.className = 'gallery-card-thumb';
          img.src = '/api/file-raw?path=' + encodeURIComponent(dbPath + '/' + entityName + '/' + val.value);
          img.onerror = () => img.remove();
          card.insertBefore(img, title.nextSibling);
          break;
        }
      }
    }

    // プロパティ一覧（先頭4件）
    const propsDiv = document.createElement('div');
    propsDiv.className = 'gallery-card-props';
    let shown = 0;
    for (const propName of visibleProps) {
      if (shown >= 4) break;
      // sourceプロパティ: メタデータから表示
      const ptcG = propTypes[propName];
      let displayVal = '';
      if (ptcG && ptcG.source) {
        const metaKey = '_' + ptcG.source;
        const mv = entityData[metaKey] || '';
        if (ptcG.source === 'modified' && mv) displayVal = mv.replace('T', ' ').substring(0, 16);
        else displayVal = mv || '';
      } else {
        const vals = filterValues(entityData[propName] || []);
        if (vals.length === 0) continue;
        displayVal = vals.map(v => v.value).join(', ');
      }
      if (!displayVal) continue;
      const propRow = document.createElement('div');
      propRow.className = 'gallery-card-prop';
      const nameSpan = document.createElement('span');
      nameSpan.className = 'gallery-card-prop-name';
      nameSpan.textContent = propName + ':';
      propRow.appendChild(nameSpan);
      const valSpan = document.createElement('span');
      valSpan.className = 'gallery-card-prop-val';
      if (!ptcG?.source && typeof _dbRichAppendValuePreview === 'function') {
        _dbRichAppendValuePreview(valSpan, filterValues(entityData[propName] || []));
      } else {
        valSpan.textContent = displayVal;
      }
      propRow.appendChild(valSpan);
      propsDiv.appendChild(propRow);
      shown++;
    }
    card.appendChild(propsDiv);

    // リレーション表示
    const allRelations = [];
    Object.values(entityData).forEach(vals => {
      if (!Array.isArray(vals)) return;
      vals.forEach(v => {
        if (v.relations && v.relations.length > 0) {
          v.relations.forEach(r => allRelations.push(r));
        }
      });
    });
    if (allRelations.length > 0) {
      const relDiv = document.createElement('div');
      relDiv.className = 'relation-links';
      relDiv.style.marginTop = '6px';
      allRelations.slice(0, 3).forEach(r => {
        const link = document.createElement('span');
        link.className = 'relation-link';
        link.textContent = (r.entity || '') + (r.role ? ' (' + r.role + ')' : '');
        link.dataset.dbPath = r.db_path || r.dbPath || r.database || dbPath;
        link.dataset.entityName = r.entity || '';
        link.addEventListener('click', (e) => { e.stopPropagation(); navigateToEntity(r.entity, link.dataset.dbPath || dbPath); });
        relDiv.appendChild(link);
      });
      card.appendChild(relDiv);
    }

    grid.appendChild(card);
  });

  container.innerHTML = '';
  container.appendChild(grid);
}

// リレーションエントリへのナビゲーション
/* ==============================
   カンバンビュー
   ============================== */
function getKanbanGroupBy(dbPath) {
  return getCurrentDbViewTypeSpecific(dbPath, 'kanban')?.groupBy || '_status';
}
function setKanbanGroupBy(dbPath, prop, options = {}) {
  _saveCurrentDbViewField(dbPath, options.label || 'シート表示: カンバングループ', options.detail || prop || '', options, (v) => {
    if (!v.typeSpecific || typeof v.typeSpecific !== 'object' || Array.isArray(v.typeSpecific)) v.typeSpecific = {};
    if (!v.typeSpecific.kanban || typeof v.typeSpecific.kanban !== 'object' || Array.isArray(v.typeSpecific.kanban)) v.typeSpecific.kanban = {};
    v.typeSpecific.kanban.groupBy = prop;
  });
}

function renderKanban(ctx) {
  ctx = ctx || _currentPaneState();
  const data = ctx.pivotData || state.pivotData;
  const container = _paneEl(ctx, '.kanban-view') || document.getElementById('kanban-view');
  if (!container) {
    if (typeof showStatus === 'function') showStatus('シートのカンバン表示領域を準備できませんでした。シートを開き直してください。', true);
    return;
  }
  if (!data || !data.entities) { container.innerHTML = '<div style="padding:40px;text-align:center;color:var(--fg2);">データがありません</div>'; return; }

  const dbPath = ctx.dbPath || state.currentDbPath;
  const entitiesMap = data.entities;
  const advFilters = getAdvancedFilters(dbPath);
  const entityNames = Object.keys(entitiesMap)
    .filter(name => _dbEntityPassesAdvancedFilters(entitiesMap[name], advFilters))
    .sort();
  if (entityNames.length === 0) { renderEmptyState(container, 'columns', 'エントリがありません', '下部の入力欄から追加してください'); return; }
  const hiddenCols = getHiddenCols(dbPath);
  const colOrder = getColOrder(dbPath);
  let orderedProps = colOrder ? colOrder.filter(p => data.properties.includes(p)) : [...data.properties];
  data.properties.forEach(p => { if (!orderedProps.includes(p)) orderedProps.push(p); });
  const visibleProps = orderedProps.filter(p => !hiddenCols.includes(p));
  let groupByProp = getKanbanGroupBy(dbPath);
  if (groupByProp !== '_status' && !_isKanbanGroupableProperty(dbPath, groupByProp)) {
    groupByProp = '_status';
    setKanbanGroupBy(dbPath, groupByProp, { skipHistory: true });
  }

  // グループ化: ステータスまたはSelect型プロパティで分類
  const columns = new Map();

  if (groupByProp === '_status') {
    // ステータスベースのカンバン
    const statusOrder = ['掲載済み', '採用', '案', 'ボツ'];
    statusOrder.forEach(st => columns.set(st, []));

    entityNames.forEach(entityName => {
      const entityData = entitiesMap[entityName];
      const mainStatus = getEntityMainStatus(entityData);
      if (!columns.has(mainStatus)) columns.set(mainStatus, []);
      columns.get(mainStatus).push({ name: entityName, data: entityData, status: mainStatus });
    });
  } else {
    // プロパティベースのカンバン
    entityNames.forEach(entityName => {
      const entityData = entitiesMap[entityName];
      const vals = filterValues(entityData[groupByProp] || []);
      const groupKey = vals.length > 0 ? vals[0].value : '(未設定)';
      if (!columns.has(groupKey)) columns.set(groupKey, []);
      columns.get(groupKey).push({ name: entityName, data: entityData, groupValue: groupKey });
    });
  }

  // ヘッダー: グループ化プロパティ選択
  const header = document.createElement('div');
  header.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:8px;flex-shrink:0;';
  const label = document.createElement('span');
  label.style.cssText = 'font-size:12px;color:var(--fg2);';
  label.textContent = 'グループ化:';
  header.appendChild(label);

  const sel = document.createElement('select');
  sel.className = 'gb-select';
  const optStatus = document.createElement('option');
  optStatus.value = '_status'; optStatus.textContent = 'ステータス';
  if (groupByProp === '_status') optStatus.selected = true;
  sel.appendChild(optStatus);
  visibleProps.filter(p => _isKanbanGroupableProperty(dbPath, p)).forEach(p => {
    const opt = document.createElement('option');
    opt.value = p; opt.textContent = p;
    if (groupByProp === p) opt.selected = true;
    sel.appendChild(opt);
  });
  sel.onchange = () => { setKanbanGroupBy(dbPath, sel.value); renderKanban(ctx); };
  header.appendChild(sel);

  // ボード描画
  const board = document.createElement('div');
  board.className = 'kanban-board';

  const statusColors = { '掲載済み': '#6a9955', '採用': '#6fa8dc', '案': '#ce9178', 'ボツ': '#969696' };

  columns.forEach((cards, colKey) => {
    const col = document.createElement('div');
    col.className = 'kanban-column';

    // カラムヘッダー
    const colHeader = document.createElement('div');
    colHeader.className = 'kanban-column-header';
    if (groupByProp === '_status' && statusColors[colKey]) {
      const dot = document.createElement('span');
      dot.className = 'kanban-dot';
      dot.style.background = statusColors[colKey];
      colHeader.appendChild(dot);
    }
    const colTitle = document.createElement('span');
    colTitle.textContent = colKey;
    colHeader.appendChild(colTitle);
    const countBadge = document.createElement('span');
    countBadge.className = 'kanban-count';
    countBadge.textContent = cards.length;
    colHeader.appendChild(countBadge);
    col.appendChild(colHeader);

    // カラムボディ（カード一覧 + D&Dドロップ先）
    const colBody = document.createElement('div');
    colBody.className = 'kanban-column-body';
    colBody.dataset.column = colKey;

    // D&D: ドロップ先
    colBody.addEventListener('dragover', (e) => { e.preventDefault(); colBody.classList.add('drag-over'); });
    colBody.addEventListener('dragleave', () => colBody.classList.remove('drag-over'));
    colBody.addEventListener('drop', async (e) => {
      e.preventDefault();
      colBody.classList.remove('drag-over');
      const entityName = e.dataTransfer.getData('text/x-kanban-entity');
      if (!entityName) return;

      // ロックチェック（プロパティベースのグループ化の場合）
      if (groupByProp !== '_status') {
        const lockMsg = checkColumnEditable(dbPath, groupByProp);
        if (lockMsg) { showStatus(lockMsg); return; }
      }

      if (groupByProp === '_status') {
        // ステータスベース: 全プロパティの採用値のステータスを変更
        const entityData = entitiesMap[entityName];
        const oldStatuses = [];
        try {
          for (const [propName, propVals] of Object.entries(entityData)) {
            if (!Array.isArray(propVals)) continue;
            for (const v of propVals) {
              const oldStatus = v.status || '採用';
              if (['採用', '掲載済み', '案', 'ボツ'].includes(oldStatus)) {
                oldStatuses.push({ val: v, old: oldStatus, propName });
                await _apiPutValue(v, { new_status: colKey });
                if (typeof _autoFillOnStatusChange === 'function') {
                  const entityPath = _entityPath(dbPath, entityName);
                  await _autoFillOnStatusChange(entityPath, propName, colKey, dbPath);
                }
              }
            }
          }
        } catch(err) {
          showStatus('ステータス更新に失敗: ' + (err.message || err), true);
          await selectDatabase(dbPath);
          return;
        }
        if (oldStatuses.length > 0) {
          historyPush('カンバン移動: ' + entityName + ' → ' + colKey,
            async () => { for (const s of oldStatuses) { try { await _apiPutValue(s.val, { new_status: s.old }); } catch {} } await selectDatabase(dbPath); },
            async () => { for (const s of oldStatuses) { try { await _apiPutValue(s.val, { new_status: colKey }); } catch {} } await selectDatabase(dbPath); },
            _dbScope()
          );
        }
      } else {
        // プロパティベース: 該当プロパティの採用値を変更
        const entityData = entitiesMap[entityName];
        const rawVals = entityData[groupByProp] || [];
        // 案/ボツの先頭候補を書き換えないよう、採用値のみを対象にする
        const adopted = typeof filterValues === 'function'
          ? filterValues(rawVals, '採用')
          : rawVals.filter(v => (v?.status || '採用') === '採用');
        if (adopted.length > 0) {
          const target = adopted[0];
          const oldVal = target.value || '';
          try {
            if (colKey === '(未設定)') await _apiPutValue(target, { _delete: true });
            else await _apiPutValue(target, { new_value: colKey });
          } catch(err) {
            showStatus('値の更新に失敗: ' + (err.message || err), true);
            await selectDatabase(dbPath);
            return;
          }
          if (colKey !== '(未設定)') _dbUndoValue('カンバン移動: ' + entityName, target, oldVal, colKey);
        } else if (rawVals.length === 0) {
          // 値が存在しない場合は新規に採用値を追加
          if (colKey !== '(未設定)') {
            try { await _apiPostValue(_entityPath(dbPath, entityName), groupByProp, colKey, '採用', ''); } catch(err) { showStatus('値の更新に失敗: ' + (err.message || err), true); await selectDatabase(dbPath); return; }
          }
        }
      }
      showStatus(entityName + ' → ' + colKey);
      selectDatabase(dbPath);
    });

    // カード描画
    cards.forEach(card => {
      const cardEl = document.createElement('div');
      cardEl.className = 'kanban-card';
      cardEl.dataset.entity = card.name;
      cardEl.draggable = true;

      // D&D: ドラッグ開始
      cardEl.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/x-kanban-entity', card.name);
        e.dataTransfer.effectAllowed = 'move';
        cardEl.classList.add('dragging');
      });
      cardEl.addEventListener('dragend', () => cardEl.classList.remove('dragging'));

      // クリック: サイドバーに詳細表示
      cardEl.addEventListener('click', () => openEntityInSplit(_entityPath(dbPath, card.name), card.name));
      cardEl.addEventListener('dblclick', (ev) => {
        ev.stopPropagation();
        if (typeof _navPushWithViewState === 'function') _navPushWithViewState(ctx, card.name);
        selectEntity(_entityPath(dbPath, card.name));
      });
      cardEl.addEventListener('contextmenu', (e) => { e.preventDefault(); showDbCardContextMenu(e, dbPath, card.name); });
      if (typeof addLongPressHandler === 'function') {
        addLongPressHandler(cardEl, (e) => showDbCardContextMenu(e, dbPath, card.name));
      }

      // タッチ用メニューボタン
      const moreBtn = document.createElement('span');
      moreBtn.className = 'card-more-btn';
      moreBtn.innerHTML = lucide('moreHorizontal', 12);
      moreBtn.title = 'メニュー';
      moreBtn.style.cssText = 'position:absolute;top:4px;right:4px;cursor:pointer;font-size:14px;color:var(--fg2);padding:2px 4px;border-radius:3px;z-index:5;';
      moreBtn.addEventListener('click', (e) => { e.stopPropagation(); showDbCardContextMenu(e, dbPath, card.name); });
      cardEl.style.position = 'relative';
      cardEl.appendChild(moreBtn);

      // タイトル
      const title = document.createElement('div');
      title.className = 'kanban-card-title';
      title.textContent = card.name;
      cardEl.appendChild(title);

      // プロパティプレビュー（先頭3件）
      const propsDiv = document.createElement('div');
      propsDiv.className = 'kanban-card-props';
      let shown = 0;
      for (const propName of visibleProps) {
        if (shown >= 3) break;
        if (propName === groupByProp) continue; // グループ化プロパティは表示不要
        const vals = filterValues(card.data[propName] || []);
        if (vals.length === 0) continue;
        const propRow = document.createElement('div');
        propRow.className = 'kanban-card-prop';
        const nameSpan = document.createElement('span');
        nameSpan.className = 'kanban-card-prop-name';
        nameSpan.textContent = propName + ': ';
        propRow.appendChild(nameSpan);
        if (typeof _dbRichAppendValuePreview === 'function') {
          _dbRichAppendValuePreview(propRow, vals);
        } else {
          propRow.appendChild(document.createTextNode(vals.map(v => v.value).join(', ')));
        }
        propsDiv.appendChild(propRow);
        shown++;
      }
      cardEl.appendChild(propsDiv);

      colBody.appendChild(cardEl);
    });

    col.appendChild(colBody);
    board.appendChild(col);
  });

  container.innerHTML = '';
  container.appendChild(header);
  container.appendChild(board);
}

/* ==============================
   タイムラインビュー
   ============================== */
