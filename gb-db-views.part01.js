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
function getCurrentViewIdx(dbPath) {
  const cfg = getDbViewConfig(dbPath);
  const views = Array.isArray(cfg.savedViews) ? cfg.savedViews : [];
  const idx = Number.isInteger(cfg.currentViewIdx) ? cfg.currentViewIdx : -1;
  if (idx >= 0 && idx < views.length) return idx;
  return views.length ? 0 : -1;
}
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
  {mode:'tree', icon:'listTree', label:'ツリー'},
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
  if (typeof attachInlineBlurCommit === 'function') attachInlineBlurCommit(input, finish);
  else input.addEventListener('blur', finish);
  input.addEventListener('keydown', (ke) => {
    if (ke.key === 'Enter') input.blur();
    if (ke.key === 'Escape') { input.value = view.name; input.blur(); }
  });
}

function _getViewAddMenuGroups(isCalendarCapable) {
  const groupModes = [
    ['pivot', 'tree', 'gallery', 'kanban'],
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

// タブ行（#db-view-tabs）とツールバー（#tb-db / #sheet-db-toolbar）はDOM上の親子関係を持たない
// 兄弟要素のため、tabs.closest() では見つからない。メイン版・スタンドアロン版のどちらか
// 存在する方のツールバー右側コンテナを直接探す（1画面に片方しか存在しない）。
// ツールバーを持たない埋め込み表示（ctx.embedded）では null を返し、呼び出し側はタブ行への
// 代替配置をせず非表示にする。
function _dbViewToolbarActionHost(tabs, ctx) {
  if (ctx?.embedded) return null;
  return document.querySelector('#tb-db .db-toolbar-actions-right')
    || document.querySelector('#sheet-db-toolbar .db-toolbar-actions-right')
    || null;
}

function _prepareDbViewToolbarActions(tabs, ctx) {
  document.querySelectorAll('.db-toolbar-actions-right [data-db-view-toolbar-action="1"]')
    .forEach(el => el.remove());
  return _dbViewToolbarActionHost(tabs, ctx);
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

// ビュータブの単/ダブルクリック判定用。ビュー選択でタブが同期再描画されるため
// native dblclick が発火しない。クリック間隔を追跡して文字列部分の二度押しを判定する。
let _lastViewTabClick = null;
function renderDbViewTabs(ctx) {
  ctx = ctx || _currentPaneState();
  const dbPath = ctx.dbPath || state.currentDbPath;
  if (!dbPath) return;
  const views = getSavedViews(dbPath);
  const curIdx = Number.isInteger(ctx?.currentViewIdx) ? ctx.currentViewIdx : getCurrentViewIdx(dbPath);
  const tabs = _paneEl(ctx, '.db-view-tabs') || (!ctx ? document.getElementById('db-view-tabs') : null);
  const select = _paneEl(ctx, '.db-view-select') || (!ctx ? document.getElementById('db-view-select') : null);
  _renderDbViewSelect(select, ctx, views, curIdx);
  if (!tabs) {
    console.warn('[Meldex] シートビュータブの表示先が見つからないため、タブ描画をスキップしました。', { dbPath });
    return;
  }
  tabs.innerHTML = '';
  _bindDbViewTabsWheelScroll(tabs);
  _syncDbToolbarFilterButtonIcon();
  const actionHost = _prepareDbViewToolbarActions(tabs, ctx);
  const e2eScope = String(ctx?.paneId || ctx?.id || dbPath || 'main').replace(/[^\w-]/g, '_');
  const calendarInfo = typeof _getCalendarIntegrationInfo === 'function'
    ? _getCalendarIntegrationInfo(dbPath, ctx.pivotData || state.pivotData, ctx)
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
    labelSpan.className = 'view-tab-label';
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
    // 単クリックはビュー選択。文字列部分（.view-tab-label）のダブルクリックはビュー名の
    // インラインリネーム。ビュー選択でタブが同期再描画され native dblclick が発火しないため、
    // クリック間隔をモジュール変数で追跡して二度押しを判定する（「…」ボタンやタブ余白では発火しない）。
    tab.addEventListener('click', (e) => {
      if (e.target === moreBtn || moreBtn.contains(e.target)) return;
      const onLabel = (e.target === labelSpan || labelSpan.contains(e.target));
      if (onLabel) {
        const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
        const paneKey = String(ctx?.paneId || ctx?.id || 'main');
        const last = _lastViewTabClick;
        if (last && last.paneKey === paneKey && last.dbPath === dbPath && last.idx === i && (now - last.t) < 450) {
          _lastViewTabClick = null;
          startSavedViewInlineRename(tab, i, ctx);
          return;
        }
        _lastViewTabClick = { paneKey, dbPath, idx: i, t: now };
      }
      loadSavedView(i, ctx);
    });
    tab.oncontextmenu = (e) => { e.preventDefault(); showViewTabMenu(e, i, false, ctx); };
    if (typeof addLongPressHandler === 'function') {
      addLongPressHandler(tab, (e) => showViewTabMenu(e, i, false, ctx));
    }

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

  // 「シートテンプレート」「シート設定」はビュータブ行から外し、メイン版/スタンドアロン版
  // それぞれのシートツールバー右側（#tb-db / #sheet-db-toolbar の .db-toolbar-actions-right）へ
  // 配置する。ツールバーを持たない埋め込み表示（actionHost が null）では、タブ行への
  // 代替配置をせずどちらも表示しない。
  if (actionHost) {
    // テンプレートボタン
    if (typeof showTemplateGalleryModal === 'function') {
      const tmplBtn = document.createElement('button');
      tmplBtn.className = 'tb-icon-btn';
      _markDbViewToolbarAction(tmplBtn);
      tmplBtn.dataset.e2eId = `db-template-${e2eScope}`;
      tmplBtn.innerHTML = lucide('layoutTemplate', 16);
      tmplBtn.title = 'シートテンプレート';
      tmplBtn.setAttribute('aria-label', 'シートテンプレート');
      tmplBtn.addEventListener('click', () => showTemplateGalleryModal(dbPath));
      actionHost.appendChild(tmplBtn);
    }

    // DB設定ボタン（ギアアイコン）
    const gearBtn = document.createElement('button');
    gearBtn.className = 'tb-icon-btn';
    _markDbViewToolbarAction(gearBtn);
    gearBtn.dataset.e2eId = `db-settings-${e2eScope}`;
    gearBtn.innerHTML = lucide('settings', 16);
    gearBtn.title = 'シート設定';
    gearBtn.setAttribute('aria-label', 'シート設定');
    gearBtn.addEventListener('click', () => _showDbConfigModal(dbPath, ctx));
    actionHost.appendChild(gearBtn);
  }
}

function renderDbNoViewsGuide(ctx) {
  ctx = ctx || _currentPaneState();
  const dbPath = ctx.dbPath || state.currentDbPath;
  if (typeof showView === 'function') showView('pivot', ctx);
  const container = _paneEl(ctx, '.pivot-view') || (!ctx ? document.getElementById('pivot-view') : null);
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
  let dbMetadata = localCtx?.dbPath === dbPath ? localCtx.dbMetadata : null;
  if (!dbMetadata && state.currentDbPath === dbPath) dbMetadata = state.dbMetadata;
  if (!dbMetadata && typeof _getDbMetadataCached === 'function') {
    dbMetadata = await _getDbMetadataCached(dbPath, true);
  }
  if (!dbMetadata) dbMetadata = { property_types: null, calendar_mapping: null };
  const props = pivotData ? pivotData.properties : [];
  const propHints = props.map(p => `{${p}}`).join(', ');

  const activeView = typeof getCurrentDbViewConfigEntry === 'function'
    ? getCurrentDbViewConfigEntry(dbPath, { ctx: localCtx })
    : null;
  const showFooter = activeView ? activeView.showFooter === true : false;
  const thumbnailSize = activeView?.thumbnailSize || 'small';
  const entityPinned = activeView ? activeView.entityColumnPinned !== false : true;
  const statusOn = typeof getStatusEnabled === 'function' ? getStatusEnabled(dbPath) : cfg.statusEnabled === true;
    const defaultPanel = cfg.defaultPanel === 'float' || cfg.defaultPanel === 'sidebar'
      ? 'right-sidebar'
      : (cfg.defaultPanel || 'main');

  if (!globalThis.GBUI?.createModal) throw new Error('シート設定を初期化できませんでした');
  const existingDialog = document.querySelector('[data-e2e-id="db-config-dialog"]');
  if (existingDialog) { existingDialog.focus(); return existingDialog.closest('.gb-modal-overlay')?._dbConfigApi || null; }
  const content = document.createElement('div');
  content.className = 'db-config-modal-body';
  content.innerHTML = `
      <div class="field">
        <label>エントリ名テンプレート ${fieldHelp(`列名を {列名} の形で囲むと、採用値で自動置換されます。空の場合はエントリ名の自動生成を行いません。使用可能: ${propHints || '(列なし)'}`, { e2eId: 'db-entry-name-template-help' })}</label>
        <input id="dbcfg-name-template" type="text" value="${esc(nameTemplate)}" placeholder="例: {キャラ}_{年齢}">
      </div>
      <div class="field" style="margin-top:8px;">
        <label>ステータス一覧</label>
        <div id="dbcfg-status-list" style="font-size:12px;"></div>
        <button id="dbcfg-add-status" style="font-size:11px;margin-top:4px;padding:2px 8px;">+ ステータス追加</button>
      </div>
      <div class="field dbcfg-display-settings" style="margin-top:8px;">
        <label>表示設定</label>
        <div class="dbcfg-display-grid">
          <label class="dbcfg-check-row"><input id="dbcfg-show-footer" type="checkbox"${showFooter ? ' checked' : ''}> 集計行を表示</label>
          <label class="dbcfg-check-row"><input id="dbcfg-entity-pinned" type="checkbox"${entityPinned ? ' checked' : ''}> エントリ名列を固定</label>
          <label class="dbcfg-check-row"><input id="dbcfg-status-enabled" type="checkbox"${statusOn ? ' checked' : ''}> ステータス機能</label>
          <label class="dbcfg-inline-field">サムネイル
            <select id="dbcfg-thumbnail-size">
              <option value="small"${thumbnailSize !== 'large' ? ' selected' : ''}>小</option>
              <option value="large"${thumbnailSize === 'large' ? ' selected' : ''}>大</option>
            </select>
          </label>
          <div class="dbcfg-inline-field">エントリの開き方 ${fieldHelp('エントリ名の横のボタンで開く先を指定します', { e2eId: 'db-entry-open-mode-help' })}
            <select id="dbcfg-default-panel">
              <option value="main"${defaultPanel === 'main' ? ' selected' : ''}>メインパネル</option>
              <option value="right-sidebar"${defaultPanel === 'right-sidebar' ? ' selected' : ''}>右サイドバー</option>
            </select>
          </div>
        </div>
        <div class="dbcfg-display-actions">
          <button type="button" id="dbcfg-grid-border">枠線設定...</button>
          <button type="button" id="dbcfg-conditional-color">条件付きカラー...</button>
        </div>
      </div>
      <div class="field" style="margin-top:8px;">
        <label>依存エントリ作成時のコピー対象</label>
        <div id="dbcfg-copy-props" style="max-height:120px;overflow-y:auto;font-size:12px;"></div>
      </div>
      <div class="field" style="margin-top:8px;">
        <label>添付ファイル ${fieldHelp('このシートに貼った画像・動画・PDFの置き場です。セルから外したファイルも残るため、ここで使われていないものを確認して削除できます', { e2eId: 'db-attachments-help' })}</label>
        <div class="dbcfg-display-actions">
          <button type="button" id="dbcfg-attachments">添付ファイルを整理...</button>
        </div>
      </div>
      <div id="dbcfg-calendar-mapping-anchor"></div>`;
  const templateButton = document.createElement('button');
  templateButton.type = 'button'; templateButton.id = 'dbcfg-template'; templateButton.className = 'gb-btn gb-btn-sm'; templateButton.textContent = 'テンプレートを適用...';
  const footerSpacer = document.createElement('span');
  footerSpacer.style.flex = '1';
  const cancelButton = document.createElement('button');
  cancelButton.type = 'button'; cancelButton.className = 'gb-btn gb-btn-sm'; cancelButton.textContent = 'キャンセル';
  const saveButton = document.createElement('button');
  saveButton.type = 'button'; saveButton.className = 'gb-btn gb-btn-sm gb-btn-primary primary'; saveButton.id = 'dbcfg-save'; saveButton.textContent = '保存';
  let busy = false;
  let childOpen = false;
  const modalApi = globalThis.GBUI.createModal({
    id: 'db-config', title: 'シート設定', body: content,
    footer: [templateButton, footerSpacer, cancelButton, saveButton],
    variant: 'standard', geometryKey: 'db-config', minWidth: '0', initialFocus: '#dbcfg-name-template',
    returnFocus: document.activeElement instanceof HTMLElement ? document.activeElement : undefined,
    closeLabel: 'シート設定を閉じる', closeOnEsc: true, closeOnOverlay: true,
    onBeforeClose: reason => reason === 'saved' || (!busy && !childOpen),
  });
  const o = modalApi.overlay;
  o._dbConfigApi = modalApi;
  o.dataset.e2eId = 'db-config-overlay';
  modalApi.modal.dataset.e2eId = 'db-config-dialog';
  modalApi.modal.classList.add('db-config-modal');
  modalApi.modal.style.width = 'min(780px, calc(100vw - 24px))';
  modalApi.body.style.setProperty('overflow-x', 'hidden', 'important');
  content.querySelectorAll('.dbcfg-check-row').forEach(row => { row.style.minHeight = '44px'; });
  cancelButton.addEventListener('click', () => modalApi.close('cancel'));

  function openChildDialog(trigger, launch) {
    if (busy || childOpen) return;
    childOpen = true;
    const before = new Set(document.querySelectorAll('.gb-modal-overlay, .modal-overlay'));
    // タッチ操作では click 前にボタンへ focus が移らないため、子モーダル自身の
    // returnFocus も確実に親側の起動ボタンを指すよう、起動前に明示しておく。
    trigger?.focus?.({ preventScroll: true });
    try { launch(); } catch (error) { childOpen = false; throw error; }
    queueMicrotask(() => {
      const child = Array.from(document.querySelectorAll('.gb-modal-overlay, .modal-overlay'))
        .reverse().find(node => node !== o && !before.has(node));
      if (!child) { childOpen = false; trigger?.focus?.({ preventScroll: true }); return; }
      const observer = new MutationObserver(() => {
        if (child.isConnected) return;
        observer.disconnect(); childOpen = false; trigger?.focus?.({ preventScroll: true });
      });
      observer.observe(document.body, { childList: true, subtree: true });
    });
  }

  // 添付ファイルの整理
  const attachBtn = o.querySelector('#dbcfg-attachments');
  if (attachBtn && typeof showSheetAttachmentCleanupModal === 'function') {
    attachBtn.addEventListener('click', () => openChildDialog(attachBtn, () => showSheetAttachmentCleanupModal(dbPath)));
  } else if (attachBtn) {
    attachBtn.style.display = 'none';
  }

  // テンプレートボタン
  const tmplBtn = templateButton;
  if (tmplBtn && typeof showTemplateGalleryModal === 'function') {
    tmplBtn.addEventListener('click', () => openChildDialog(tmplBtn, () => showTemplateGalleryModal(dbPath)));
  } else if (tmplBtn) {
    tmplBtn.style.display = 'none';
  }

  // ステータス一覧エディタ
  const statusDiv = o.querySelector('#dbcfg-status-list');
  function _createStatusRow(name, color, index = 0, statusId = '') {
    const rowKey = 'dbcfg-status-' + index;
    const row = document.createElement('div');
    row.dataset.originalStatusName = name || '';
    row.dataset.statusId = statusId || globalThis.GbDbSchemaMutation?.newId?.('status') || '';
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
      const { row } = _createStatusRow(st.name, st.color, index, st.status_id || st.id || '');
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
  const pts = getPropertyTypes(dbPath, localCtx);
  const hasSavedCopyProps = Array.isArray(cfg.dependentCopyProps);
  const currentCopy = hasSavedCopyProps ? cfg.dependentCopyProps : [];
  const defaultCopy = typeof _getDependentCopyProps === 'function' ? _getDependentCopyProps(dbPath, pts) : [];
  for (const p of props) {
    const ptc = pts[p] || {};
    if (ptc.pairWith) continue; // ペアプロパティは除外
    if (!['relation', 'multi-relation', 'select', 'multi-select', 'number'].includes(ptc.type || '')) continue;
    const checked = hasSavedCopyProps ? currentCopy.includes(p) : defaultCopy.includes(p);
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
      || (typeof getCalendarMapping === 'function' ? getCalendarMapping(dbPath, { ctx: localCtx }) : null);
    _renderCalendarMappingConfigSection(
      o.querySelector('#dbcfg-calendar-mapping-anchor'),
      dbPath,
      props,
      pts,
      currentCalendarMapping || null
    );
  }

  o.querySelector('#dbcfg-grid-border')?.addEventListener('click', event => {
    if (typeof showGridBorderModal === 'function') openChildDialog(event.currentTarget, () => showGridBorderModal(localCtx));
  });
  const conditionalColorButton = o.querySelector('#dbcfg-conditional-color');
  conditionalColorButton?.addEventListener('click', () => {
    if (typeof showConditionalColorPickerModal === 'function') openChildDialog(conditionalColorButton, () => showConditionalColorPickerModal(dbPath, localCtx, conditionalColorButton));
  });

  saveButton.addEventListener('click', async () => {
    if (busy || childOpen) return;
    busy = true;
    [templateButton, cancelButton, saveButton, attachBtn, o.querySelector('#dbcfg-grid-border'), conditionalColorButton]
      .filter(Boolean).forEach(button => { button.disabled = true; });
    const finishRetry = () => {
      busy = false;
      [templateButton, cancelButton, saveButton, attachBtn, o.querySelector('#dbcfg-grid-border'), conditionalColorButton]
        .filter(Boolean).forEach(button => { button.disabled = false; });
      saveButton.focus({ preventScroll: true });
    };
    const c = _cloneDbViewObject(getDbViewConfig(dbPath));
    c.entryNameTemplate = o.querySelector('#dbcfg-name-template').value.trim();
    const targetView = typeof _getCurrentDbViewConfigEntryFromConfig === 'function'
      ? _getCurrentDbViewConfigEntryFromConfig(c, { ctx: localCtx })
      : null;
    const viewSettingsTarget = targetView || c;
    viewSettingsTarget.showFooter = !!o.querySelector('#dbcfg-show-footer')?.checked;
    viewSettingsTarget.entityColumnPinned = o.querySelector('#dbcfg-entity-pinned')?.checked !== false;
    viewSettingsTarget.thumbnailSize = o.querySelector('#dbcfg-thumbnail-size')?.value || 'small';
    c.statusEnabled = !!o.querySelector('#dbcfg-status-enabled')?.checked;
    c.defaultPanel = o.querySelector('#dbcfg-default-panel')?.value || 'main';
    // ステータス一覧の保存
    const statusList = [];
    const statusRenameMap = new Map();
    const originalStatuses = getStatusList(dbPath);
    let statusMigration = null;
    statusDiv.querySelectorAll('div').forEach(row => {
      const name = row.querySelector('.dbcfg-st-name')?.value?.trim();
      const colorEl = row.querySelector('.dbcfg-st-color');
      const color = colorEl?.dataset?.color || '#888888';
      if (name) {
        const originalName = String(row.dataset.originalStatusName || '').trim();
        if (originalName && originalName !== name) statusRenameMap.set(originalName, name);
        statusList.push({ name, color, status_id: row.dataset.statusId || undefined });
      }
    });
    if (new Set(statusList.map(status => status.name)).size !== statusList.length) {
      showStatus('同じ名前のステータスは複数登録できません', true);
      finishRetry();
      return;
    }
    const presentOriginalNames = new Set(
      Array.from(statusDiv.querySelectorAll(':scope > div'))
        .map(row => String(row.dataset.originalStatusName || '').trim())
        .filter(Boolean)
    );
    const removedStatuses = originalStatuses
      .map(status => status.name)
      .filter(name => !presentOriginalNames.has(name) && !statusRenameMap.has(name));
    if (globalThis.GbDbSchemaMutation) {
      try {
        const migration = await globalThis.GbDbSchemaMutation.migrateStatuses({
          dbPath,
          pivotData: localCtx?.pivotData || state.pivotData,
          mapping: statusRenameMap,
          removed: removedStatuses,
        });
        statusMigration = migration;
        migration.preserved.forEach(name => {
          if (!statusList.some(status => status.name === name)) {
            const oldStatus = originalStatuses.find(status => status.name === name) || {};
            statusList.push({
              name,
              color: oldStatus.color || '#888888',
              status_id: oldStatus.status_id || oldStatus.id || globalThis.GbDbSchemaMutation.newId('status'),
            });
          }
        });
        if (migration.preserved.length) {
          showStatus('使用中のステータスは削除せず維持しました: ' + migration.preserved.join('、'));
        }
      } catch (e) {
        showStatus('ステータス値の移行に失敗: ' + (e?.message || e), true);
        finishRetry();
        return;
      }
    }
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
        try { await statusMigration?.rollback?.(); } catch (rollbackError) {
          console.error('カレンダー連携検証失敗後のステータス値復旧に失敗:', rollbackError);
        }
        showStatus(e?.message || 'カレンダー連携設定の保存に失敗しました', true);
        finishRetry();
        return;
      }
    }
    _setDbCalendarMappingFallbackOnViews(c, calendarMapping);
    try {
      if (globalThis.GbDbSchemaMutation) {
        await globalThis.GbDbSchemaMutation.saveMetadata(dbPath, {
          calendar_mapping: calendarMapping,
          view_config: c,
        }, localCtx);
      } else {
        await apiPut('/db-metadata?path=' + encodeURIComponent(dbPath), {
          calendar_mapping: calendarMapping,
          view_config: c,
        });
      }
      saveDbViewConfig(dbPath, c, { skipBackend: true, ctx: localCtx });
      if (state.currentDbPath === dbPath && state.dbMetadata) state.dbMetadata.calendar_mapping = calendarMapping;
      if (typeof _invalidateDbMetadataCache === 'function') _invalidateDbMetadataCache(dbPath);
    } catch (e) {
      try { await statusMigration?.rollback?.(); } catch (rollbackError) {
        console.error('ステータス値のロールバックに失敗:', rollbackError);
      }
      c.statusList = originalStatuses;
      showStatus('シート設定の保存に失敗したため、ステータス変更を元に戻しました', true);
      finishRetry();
      return;
    }
    modalApi.close('saved');
    try {
      await selectDatabase(dbPath, localCtx, {
        silent: true,
        skipRecent: true,
        skipNavPush: true,
        skipSaveLastView: true,
      });
      if (typeof _ptReloadOtherDbContexts === 'function') {
        await _ptReloadOtherDbContexts(dbPath, localCtx);
      }
    } catch (error) {
      console.warn('シート設定保存後の表示更新に失敗:', error);
      showStatus('シート設定は保存しましたが、表示を更新できませんでした', true);
      return;
    }
    showStatus('シート設定を保存しました');
  });
  modalApi.open();
  return modalApi;
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
    name = name.split(ph).join(val);
  }
  return name.trim() || null;
}



function _makeDbViewStateFromCurrent(dbPath, viewMode, name, ctx) {
  const cfg = getDbViewConfig(dbPath);
  const activeView = typeof getCurrentDbViewConfigEntry === 'function'
    ? getCurrentDbViewConfigEntry(dbPath, { ctx })
    : null;
  const paneData = ctx?.dbPath === dbPath ? ctx.pivotData : null;
  const viewState = {
    name,
    viewMode,
    hiddenCols: _cloneDbViewArray(activeView?.hiddenCols),
    pinnedCols: _cloneDbViewArray(activeView?.pinnedCols),
    colOrder: activeView?.colOrder == null ? null : _cloneDbViewValue(activeView.colOrder, null),
    advancedFilters: _cloneDbViewArray(activeView?.advancedFilters),
    columnValueFilters: _cloneDbViewObject(activeView?.columnValueFilters),
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
    const rawProps = paneData?.properties || state.pivotData?.properties || [];
    const props = typeof filterDeletedDbProperties === 'function' ? filterDeletedDbProperties(dbPath, rawProps) : rawProps;
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
  const rawProps = pivotData?.properties || state.pivotData?.properties || [];
  const props = typeof filterDeletedDbProperties === 'function' ? filterDeletedDbProperties(dbPath, rawProps) : rawProps;
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
      return { chartType: 'bar', xProperty: '', yAggregation: 'count', yProperty: null, showLabels: true, showLegend: true, palette: 'single', singleColor: '' };
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
  const mode = viewMode || getCurrentViewMode(dbPath, { ctx }) || 'pivot';
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
  const duplicate = _makeDbViewStateFromCurrent(dbPath, mode, name, ctx);
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
  ctx.currentViewIdx = idx;
  if (Object.prototype.hasOwnProperty.call(v, 'filter') && typeof setFilter === 'function') {
    setFilter(v.filter || 'disabled', { skipReload: true, dbPath, ctx });
  }
  if (!options.skipHistory && typeof pushDbViewConfigHistory === 'function' && typeof captureDbViewConfigHistory === 'function') {
    pushDbViewConfigHistory(dbPath, 'シート表示: ビュー適用', before, captureDbViewConfigHistory(dbPath), v.name || '');
  }

  const targetView = v.viewMode === 'calendar' ? 'timeline' : (v.viewMode || 'pivot');
  ctx.viewMode = targetView;
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
    ? _getCalendarIntegrationInfo(dbPath, ctx.pivotData || state.pivotData, ctx)
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
