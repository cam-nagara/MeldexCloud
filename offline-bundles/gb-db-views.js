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
  const defaultPanel = cfg.defaultPanel || 'main';

  const o = document.createElement('div');
  o.className = 'modal-overlay';
  o.innerHTML = `<div class="modal db-config-modal">
    <h3>シート設定</h3>
    <div class="modal-body db-config-modal-body">
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
              <option value="float"${defaultPanel === 'float' ? ' selected' : ''}>フロートパネル</option>
              <option value="sidebar"${defaultPanel === 'sidebar' ? ' selected' : ''}>サイドバー</option>
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
      <div id="dbcfg-calendar-mapping-anchor"></div>
    </div>
    <div class="btn-row" style="justify-content:space-between;">
      <button id="dbcfg-template" style="font-size:12px;">テンプレートを適用...</button>
      <div style="display:flex;gap:8px;">
        <button data-action="this.closest('.modal-overlay').remove()">キャンセル</button>
        <button class="primary" id="dbcfg-save">保存</button>
      </div>
    </div>
  </div>`;
  document.body.appendChild(o);

  // 添付ファイルの整理
  const attachBtn = o.querySelector('#dbcfg-attachments');
  if (attachBtn && typeof showSheetAttachmentCleanupModal === 'function') {
    attachBtn.addEventListener('click', () => { o.remove(); showSheetAttachmentCleanupModal(dbPath); });
  } else if (attachBtn) {
    attachBtn.style.display = 'none';
  }

  // テンプレートボタン
  const tmplBtn = o.querySelector('#dbcfg-template');
  if (tmplBtn && typeof showTemplateGalleryModal === 'function') {
    tmplBtn.addEventListener('click', () => { o.remove(); showTemplateGalleryModal(dbPath); });
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

  o.querySelector('#dbcfg-grid-border')?.addEventListener('click', () => {
    if (typeof showGridBorderModal === 'function') showGridBorderModal(localCtx);
  });
  const conditionalColorButton = o.querySelector('#dbcfg-conditional-color');
  conditionalColorButton?.addEventListener('click', () => {
    if (typeof showConditionalColorPickerModal === 'function') showConditionalColorPickerModal(dbPath, localCtx, conditionalColorButton);
  });

  o.querySelector('#dbcfg-save').addEventListener('click', async () => {
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
        showStatus(e?.message || 'カレンダー連携設定の保存に失敗しました', true);
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
      return;
    }
    o.remove();
    showStatus('シート設定を保存しました');
    await selectDatabase(dbPath, localCtx, {
      silent: true,
      skipRecent: true,
      skipNavPush: true,
      skipSaveLastView: true,
    });
    if (typeof _ptReloadOtherDbContexts === 'function') {
      await _ptReloadOtherDbContexts(dbPath, localCtx);
    }
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
function getGroupBy(dbPath, ctx) {
  return getCurrentDbViewTypeSpecific(dbPath, 'pivot', { ctx })?.groupBy || null;
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
  if (!list.length) return ['empty', 'not_contains', 'not_equals'].includes(filter.operator);
  if (filter.operator === 'not_equals' || filter.operator === 'not_contains') {
    return list.every(v => _dbValueMatchesAdvancedFilter(v, filter));
  }
  return list.some(v => _dbValueMatchesAdvancedFilter(v, filter));
}

// 互換テスト用: function _dbFilterValuesForCurrentView(values)
function _dbFilterValuesForCurrentView(values, filterMode) {
  const list = Array.isArray(values) ? values : [];
  return typeof filterValues === 'function' ? filterValues(list, undefined, filterMode) : list;
}

function _dbEntityPassesAdvancedFilters(entityData, filters, filterMode) {
  if (!Array.isArray(filters) || filters.length === 0) return true;
  return filters.every(filter => {
    if (filter.property === '*') {
      const allValues = Object.values(entityData || {})
        // 互換テスト用: .flatMap(vals => Array.isArray(vals) ? _dbFilterValuesForCurrentView(vals) : [])
        .flatMap(vals => Array.isArray(vals) ? _dbFilterValuesForCurrentView(vals, filterMode) : [])
        .filter(v => v && typeof v === 'object');
      return _dbValuesMatchAdvancedFilter(allValues, filter);
    }
    // 互換テスト用: const values = _dbFilterValuesForCurrentView(entityData?.[filter.property] || []);
    const values = _dbFilterValuesForCurrentView(entityData?.[filter.property] || [], filterMode);
    return _dbValuesMatchAdvancedFilter(values, filter);
  });
}

function _isKanbanGroupableProperty(dbPath, propName) {
  const ptc = getPropertyTypes(dbPath)[propName] || {};
  if (ptc.source) return false;
  if (['formula', 'rollup', 'button', 'multi-source-relation', 'chat'].includes(ptc.type || '')) return false;
  return !checkColumnEditable(dbPath, propName);
}

function _kanbanStatusDefs(dbPath) {
  const preferredOrder = ['掲載済み', '採用', '案', 'ボツ'];
  const sourceList = (typeof getStatusList === 'function') ? getStatusList(dbPath) : [];
  const rawList = Array.isArray(sourceList) && sourceList.length
    ? sourceList
    : preferredOrder.map(name => ({ name, color: typeof _getStatusColor === 'function' ? _getStatusColor(name, dbPath) : '' }));
  const byName = new Map();
  rawList.forEach(item => {
    const name = String(item?.name ?? item ?? '').trim();
    if (!name || byName.has(name)) return;
    const color = item?.color || (typeof _getStatusColor === 'function' ? _getStatusColor(name, dbPath) : '');
    byName.set(name, { name, color });
  });
  const ordered = [];
  const seen = new Set();
  const push = (name) => {
    if (!byName.has(name) || seen.has(name)) return;
    ordered.push(byName.get(name));
    seen.add(name);
  };
  preferredOrder.forEach(push);
  rawList.forEach(item => push(String(item?.name ?? item ?? '').trim()));
  return ordered.length ? ordered : preferredOrder.map(name => ({ name, color: '' }));
}

function _kanbanEntityMainStatus(entityData, dbPath) {
  const order = _kanbanStatusDefs(dbPath).map(item => item.name);
  let best = '';
  let bestIdx = Infinity;
  Object.values(entityData || {}).forEach(propVals => {
    if (!Array.isArray(propVals)) return;
    propVals.forEach(v => {
      const status = String(v?.status || '採用').trim() || '採用';
      let idx = order.indexOf(status);
      if (idx < 0) idx = order.length;
      if (idx < bestIdx) {
        best = status;
        bestIdx = idx;
      }
    });
  });
  return best || order[0] || '採用';
}

function _kanbanValueRef(valueObj, propName) {
  return {
    file: valueObj?.file,
    property: valueObj?.property || propName,
    candidate_index: valueObj?.candidate_index,
  };
}

function _kanbanStatusMoveTargets(entityData, dbPath) {
  const entries = [];
  Object.entries(entityData || {}).forEach(([propName, propVals]) => {
    if (!Array.isArray(propVals)) return;
    propVals.forEach(v => {
      if (!v || typeof v !== 'object') return;
      const old = String(v.status || '採用').trim() || '採用';
      entries.push({ val: v, ref: _kanbanValueRef(v, propName), old, propName });
    });
  });
  const adopted = entries.filter(item => item.old === '採用' || item.old === '掲載済み');
  if (adopted.length) return adopted;
  const mainStatus = _kanbanEntityMainStatus(entityData, dbPath);
  return entries.filter(item => item.old === mainStatus);
}

async function _rollbackKanbanStatusMove(statusWriteOps, autoFillOps) {
  if (typeof _undoAutoFillStatusOps === 'function') {
    try { await _undoAutoFillStatusOps(autoFillOps); } catch {}
  }
  for (const op of [...(statusWriteOps || [])].reverse()) {
    try { await _apiPutValue(op.ref || op.val, { new_status: op.old }); } catch {}
  }
}

function _kanbanAdoptedValueForWrite(values) {
  if (typeof getAdoptedValueForWrite === 'function') return getAdoptedValueForWrite(values);
  const list = Array.isArray(values) ? values : [];
  return list.find(v => ['採用', '掲載済み'].includes(v?.status || '採用')) || null;
}

/* ==============================
   ギャラリービュー
   ============================== */
function _dbViewSurfaceEl(ctx, selector, id) {
  if (ctx && ctx.containerEl) {
    const scoped = ctx.containerEl.querySelector(selector);
    if (scoped) return scoped;
  }
  return document.getElementById(id) || document.querySelector(selector);
}

function _galleryImageSrcFromValue(rawValue, dbPath, entityName) {
  const items = typeof parseImagePropertyValue === 'function' ? parseImagePropertyValue(rawValue) : [];
  if (items.length && typeof _imageSrc === 'function') {
    // 動画・PDFはカバー画像にできないので、画像の添付があればそれを使う
    const cover = typeof _attachmentKind === 'function'
      ? items.find(item => _attachmentKind(item) === 'image')
      : items[0];
    return cover ? _imageSrc(cover, true) : '';
  }
  const text = String(rawValue || '').trim();
  if (!text || !/\.(png|jpe?g|gif|webp|svg|bmp)$/i.test(text)) return '';
  if (/^(https?:|data:|blob:|\/)/.test(text)) return text;
  return '/api/file-raw?path=' + encodeURIComponent(dbPath + '/' + entityName + '/' + text);
}

function _dbCardImageItemsFromValues(vals) {
  if (typeof parseImagePropertyValue !== 'function') return [];
  for (const val of vals || []) {
    const items = parseImagePropertyValue(val?.value);
    if (items.length) return items;
  }
  return [];
}

function _appendDbCardImagePreview(root, items, options = {}) {
  if (!root || !Array.isArray(items) || !items.length || typeof _imageSrc !== 'function') return false;
  const wrap = document.createElement('div');
  wrap.className = 'db-card-image-preview ' + (options.className || '');
  if (options.propName) wrap.title = options.propName;
  const thumbCount = typeof _normalizeDbCardImageThumbCount === 'function'
    ? _normalizeDbCardImageThumbCount(options.thumbCount)
    : Math.max(1, Math.min(12, Math.round(Number(options.thumbCount || 3) || 3)));
  const thumbColumns = Math.max(1, Math.min(4, Math.round(Number(options.columns || Math.min(3, thumbCount)) || 3)));
  wrap.dataset.thumbCount = String(thumbCount);
  wrap.style.setProperty('--db-card-thumb-columns', String(thumbColumns));
  let appended = 0;
  items.slice(0, thumbCount).forEach((item, idx) => {
    const mediaKind = typeof _attachmentKind === 'function'
      ? _attachmentKind(item)
      : String(item?.asset_kind || item?.media_type || '').toLowerCase();
    // thumb_url は新方式では動画にも入る（生ファイル）ので、本物の縮小画像だけを preview として扱う
    const hasPreview = !!(item?.preview_url || item?.preview_src || item?.preview_image_url);
    if (mediaKind !== 'image' && !hasPreview) {
      const placeholder = document.createElement('div');
      placeholder.className = 'db-card-media-placeholder';
      placeholder.dataset.imageIndex = String(idx);
      const icon = mediaKind === 'video' ? 'video' : 'fileText';
      const caption = mediaKind === 'video' ? '動画' : (mediaKind === 'pdf' ? 'PDF' : 'ファイル');
      placeholder.innerHTML = (typeof lucide === 'function' ? lucide(icon, 16) : '') + `<span>${caption}</span>`;
      placeholder.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        if (typeof openImagePropertyItemInViewer === 'function') openImagePropertyItemInViewer(item);
      });
      wrap.appendChild(placeholder);
      appended += 1;
      return;
    }
    const src = _imageSrc(item, true);
    if (!src) return;
    const img = document.createElement('img');
    img.loading = 'lazy';
    img.decoding = 'async';
    img.fetchPriority = 'low';
    img.src = src;
    img.alt = item.caption || item.filename || options.propName || '画像';
    img.dataset.imageIndex = String(idx);
    img.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (typeof openImagePropertyItemInViewer === 'function') openImagePropertyItemInViewer(item);
    });
    wrap.appendChild(img);
    appended += 1;
  });
  if (!appended) return false;
  if (items.length > appended) {
    const more = document.createElement('span');
    more.className = 'db-card-image-more';
    more.textContent = '+' + (items.length - appended);
    wrap.appendChild(more);
  }
  root.appendChild(wrap);
  return true;
}

function _appendFirstDbCardImagePreview(root, entityData, propNames, propTypes, ctx, options = {}) {
  if (!root || !entityData || !Array.isArray(propNames)) return false;
  const seen = new Set();
  for (const propName of propNames) {
    if (!propName || seen.has(propName)) continue;
    seen.add(propName);
    const ptc = propTypes?.[propName] || {};
    if (ptc.type && ptc.type !== 'image') continue;
    const vals = filterValues(entityData[propName] || [], undefined, ctx?.filter);
    const imageItems = _dbCardImageItemsFromValues(vals);
    if (imageItems.length && _appendDbCardImagePreview(root, imageItems, { ...options, propName })) {
      return true;
    }
  }
  return false;
}

function _getGalleryConfig(dbPath, ctx) {
  const cfg = getCurrentDbViewTypeSpecific(dbPath, 'gallery', { ctx }) || {};
  const displayCfg = typeof _dbCardViewDisplayConfig === 'function'
    ? _dbCardViewDisplayConfig(cfg)
    : { cardImageThumbCount: 3, cardPropLineCount: 1 };
  return {
    showEntryName: cfg.showEntryName !== false,
    cardProps: Object.prototype.hasOwnProperty.call(cfg, 'cardProps') && Array.isArray(cfg.cardProps) ? cfg.cardProps : null,
    ...displayCfg,
  };
}

function _setGalleryDisplayProps(dbPath, cfg, options = {}) {
  const next = {
    ...cfg,
    cardProps: Array.isArray(cfg.cardProps) ? cfg.cardProps : [],
    showEntryName: cfg.showEntryName !== false,
    ...(typeof _dbCardViewDisplayConfig === 'function' ? _dbCardViewDisplayConfig(cfg) : {}),
  };
  setCurrentDbViewTypeSpecific(dbPath, 'gallery', next, {
    ctx: options.ctx || null,
    historyLabel: options.label || 'シート表示: ギャラリー表示列',
    detail: options.detail || '',
    skipHistory: options.skipHistory === true,
  });
}

function _galleryDefaultCardProps(visibleProps) {
  return (visibleProps || []).slice(0, 4);
}

function _showGalleryDisplayPropsMenu(anchor, dbPath, cfg, props, ctx) {
  document.querySelectorAll('.gallery-card-props-menu').forEach(el => el.remove());
  const menu = document.createElement('div');
  menu.className = 'gb-context-menu tl-card-props-menu gallery-card-props-menu';
  menu.style.cssText = 'position:fixed;z-index:10000;min-width:240px;max-height:340px;overflow:auto;padding:6px;';
  let ordered = Array.isArray(cfg.cardProps) ? [...cfg.cardProps].filter(prop => props.includes(prop)) : [];
  let showEntryName = cfg.showEntryName !== false;
  let { cardImageThumbCount, cardPropLineCount } = typeof _dbCardViewDisplayConfig === 'function'
    ? _dbCardViewDisplayConfig(cfg)
    : { cardImageThumbCount: 3, cardPropLineCount: 1 };
  const save = (detail) => {
    _setGalleryDisplayProps(dbPath, { ...cfg, cardProps: ordered, showEntryName, cardImageThumbCount, cardPropLineCount }, { ctx, detail });
    renderGallery(ctx);
  };
  if (typeof _appendDbDisplayPropOption === 'function') {
    _appendDbDisplayPropOption(menu, 'エントリ名', showEntryName, {
      onToggle(checked) {
        showEntryName = checked;
        save('エントリ名');
      },
    });
    if (typeof _appendDbCardDisplayControls === 'function') {
      _appendDbCardDisplayControls(menu, { cardImageThumbCount, cardPropLineCount }, (next, detail) => {
        cardImageThumbCount = next.cardImageThumbCount;
        cardPropLineCount = next.cardPropLineCount;
        save(detail);
      });
    }
    props.forEach(prop => {
      _appendDbDisplayPropOption(menu, prop, ordered.includes(prop), {
        canMoveUp: ordered.indexOf(prop) > 0,
        canMoveDown: ordered.indexOf(prop) >= 0 && ordered.indexOf(prop) < ordered.length - 1,
        onToggle(checked) {
          ordered = checked ? [...ordered, prop].filter((name, idx, arr) => arr.indexOf(name) === idx) : ordered.filter(name => name !== prop);
          save(prop);
        },
        onMove(delta) {
          const idx = ordered.indexOf(prop);
          const nextIdx = idx + delta;
          if (idx < 0 || nextIdx < 0 || nextIdx >= ordered.length) return;
          [ordered[idx], ordered[nextIdx]] = [ordered[nextIdx], ordered[idx]];
          save(prop);
        },
      });
    });
  }
  document.body.appendChild(menu);
  if (typeof attachMeldexDropdownCloseButton === 'function') {
    attachMeldexDropdownCloseButton(menu, {
      trigger: anchor,
      className: 'gallery-card-props-menu-close',
      attr: 'data-gallery-card-props-close',
    });
  }
  if (typeof _positionTimelineCardPropsMenu === 'function') _positionTimelineCardPropsMenu(menu, anchor);
  else if (typeof positionPopup === 'function') positionPopup(menu, anchor.getBoundingClientRect());
  setTimeout(() => {
    const closer = (ev) => {
      if (!menu.contains(ev.target) && ev.target !== anchor && !anchor.contains(ev.target)) {
        menu.remove();
        document.removeEventListener('pointerdown', closer);
      }
    };
    document.addEventListener('pointerdown', closer);
  }, 0);
}

function _buildGalleryToolbar(dbPath, galleryCfg, visibleProps, activeCardProps, ctx) {
  const toolbar = document.createElement('div');
  toolbar.className = 'db-card-view-toolbar gallery-card-view-toolbar';
  const displayPropsBtn = document.createElement('button');
  displayPropsBtn.type = 'button';
  displayPropsBtn.className = 'tl-nav-btn db-card-view-toolbar-btn';
  displayPropsBtn.title = 'カードに表示する列';
  displayPropsBtn.dataset.e2eId = 'gallery-display-props';
  displayPropsBtn.innerHTML = (typeof lucide === 'function' ? lucide('listPlus', 12) + ' ' : '') + '表示列' + (activeCardProps.length ? ' (' + activeCardProps.length + ')' : '');
  displayPropsBtn.addEventListener('click', (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    _showGalleryDisplayPropsMenu(ev.currentTarget, dbPath, { ...galleryCfg, cardProps: activeCardProps }, visibleProps, ctx);
  });
  toolbar.appendChild(displayPropsBtn);
  return toolbar;
}

function renderGallery(ctx) {
  ctx = ctx || _currentPaneState();
  const data = ctx.pivotData || state.pivotData;
  const container = _dbViewSurfaceEl(ctx, '.gallery-view', 'gallery-view');
  if (!container) {
    if (typeof showStatus === 'function') showStatus('シートのギャラリー表示領域を準備できませんでした。シートを開き直してください。', true);
    return;
  }
  container.style.display = 'flex';
  if (!data || !data.entities) { container.innerHTML = '<div style="padding:40px;text-align:center;color:var(--fg2);">データがありません</div>'; return; }

  const dbPath = ctx.dbPath || state.currentDbPath;
  const hiddenCols = getHiddenCols(dbPath, { ctx });
  const advFilters = getAdvancedFilters(dbPath, { ctx });
  const columnValueFilters = typeof getColumnValueFilters === 'function' ? getColumnValueFilters(dbPath, { ctx }) : {};
  const propTypes = getPropertyTypes(dbPath);
  const colOrder = getColOrder(dbPath, { ctx });
  const entitiesMap = data.entities;
  const entityNames = typeof _dbSortedEntityNames === 'function'
    ? _dbSortedEntityNames(data, dbPath, ctx, { applyAdvancedFilters: true, advFilters, columnValueFilters, propTypes })
    : Object.keys(entitiesMap)
      .filter(name => _dbEntityPassesAdvancedFilters(entitiesMap[name], advFilters, ctx?.filter)
        && (typeof _dbEntityPassesColumnValueFilters !== 'function'
          || _dbEntityPassesColumnValueFilters(name, entitiesMap[name], columnValueFilters, dbPath, ctx, ctx?.filter)))
      .sort();
  ctx._lastEntityNames = [...entityNames];
  if (entityNames.length === 0) {
    if (typeof _dbRenderEmptyStateWithCreate === 'function') {
      _dbRenderEmptyStateWithCreate(container, 'image', 'エントリがありません', 'エントリを追加して開始してください', ctx);
    } else {
      renderEmptyState(container, 'image', 'エントリがありません', 'エントリを追加して開始してください');
    }
    return;
  }
  // colOrder適用（renderPivotと同じ順序ロジック）
  let orderedProps = colOrder ? colOrder.filter(p => data.properties.includes(p)) : [...data.properties];
  data.properties.forEach(p => { if (!orderedProps.includes(p)) orderedProps.push(p); });
  if (typeof filterDeletedDbProperties === 'function') orderedProps = filterDeletedDbProperties(dbPath, orderedProps);
  const visibleProps = orderedProps.filter(p => !hiddenCols.includes(p));
  const galleryCfg = _getGalleryConfig(dbPath, ctx);
  const activeCardProps = Array.isArray(galleryCfg.cardProps) ? galleryCfg.cardProps : _galleryDefaultCardProps(visibleProps);

  const toolbar = _buildGalleryToolbar(dbPath, galleryCfg, visibleProps, activeCardProps, ctx);
  const grid = document.createElement('div');
  grid.className = 'gallery-grid';

  entityNames.forEach(entityName => {
    const entityData = entitiesMap[entityName];
    const card = document.createElement('div');
    card.className = 'gallery-card';
    card.dataset.entity = entityName;
    card.dataset.entityName = entityName;
    card.dataset.meldexEntityPath = _entityPath(dbPath, entityName, ctx?.pivotData);
    card.draggable = true;
    card.addEventListener('dragstart', (event) => {
      window.MeldexBoardTransfer?.setEntityDragData?.(
        event.dataTransfer,
        dbPath,
        entityName,
        card.dataset.meldexEntityPath,
      );
      if (event.dataTransfer) event.dataTransfer.effectAllowed = 'copy';
    });
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
    card.style.setProperty('--db-card-prop-lines', String(galleryCfg.cardPropLineCount));
    card.appendChild(moreBtn);

    let title = null;
    if (galleryCfg.showEntryName !== false) {
      title = document.createElement('div');
      title.className = 'gallery-card-title';
      title.textContent = entityName;
      card.appendChild(title);
    }

    // プロパティ一覧（先頭4件）
    const propsDiv = document.createElement('div');
    propsDiv.className = 'gallery-card-props';
    let shown = 0;
    const cardPropNames = Array.isArray(galleryCfg.cardProps)
      ? galleryCfg.cardProps.filter(propName => visibleProps.includes(propName))
      : _galleryDefaultCardProps(visibleProps);
    // 画像は「カードに表示する列」で有効な画像型列だけを対象にする。未選択列や別列からの
    // 補完（フィルタリングされていない全画像型列の走査・拡張子推測によるフォールバック）は行わない。
    // 有効な画像型列が複数ある場合は、列の表示順に、各列のサムネ数（cardImageThumbCount）まで
    // 個別に並べる（総数の上限は「サムネ数×有効な画像型列数」）。
    const selectedImageCols = cardPropNames.filter(propName => propTypes[propName]?.type === 'image');
    for (const propName of cardPropNames) {
      // sourceプロパティ: メタデータから表示
      const ptcG = propTypes[propName];
      if (ptcG?.type === 'image') continue; // 画像はループの外でまとめて表示する
      let displayVal = '';
      if (ptcG && ptcG.source) {
        const metaKey = '_' + ptcG.source;
        const mv = entityData[metaKey] || '';
        if ((ptcG.source === 'created' || ptcG.source === 'modified') && mv) displayVal = mv.replace('T', ' ').substring(0, 16);
        else displayVal = mv || '';
      } else {
        const vals = filterValues(entityData[propName] || [], undefined, ctx?.filter);
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
        // 互換テスト用: _dbRichAppendValuePreview(valSpan, filterValues(entityData[propName] || []));
        _dbRichAppendValuePreview(valSpan, filterValues(entityData[propName] || [], undefined, ctx?.filter));
      } else {
        valSpan.textContent = displayVal;
      }
      propRow.appendChild(valSpan);
      propsDiv.appendChild(propRow);
      shown++;
    }
    // 有効な画像型列が無ければ画像領域は表示しない。列の表示順（cardPropNames の順序）で、
    // 各列ごとに独立したサムネブロックを追加する（列ごとに cardImageThumbCount 枚まで）。
    selectedImageCols.forEach(propName => {
      const vals = filterValues(entityData[propName] || [], undefined, ctx?.filter);
      const imageItems = _dbCardImageItemsFromValues(vals);
      if (!imageItems.length) return;
      _appendDbCardImagePreview(card, imageItems, {
        className: 'gallery-card-image-preview',
        thumbCount: galleryCfg.cardImageThumbCount,
        columns: Math.min(2, galleryCfg.cardImageThumbCount),
        propName,
      });
    });
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
        link.addEventListener('click', (e) => { e.stopPropagation(); navigateToEntity(r.entity, link.dataset.dbPath || dbPath, ctx); });
        relDiv.appendChild(link);
      });
      card.appendChild(relDiv);
    }

    grid.appendChild(card);
  });

  container.innerHTML = '';
  container.appendChild(toolbar);
  container.appendChild(grid);
}

// リレーションエントリへのナビゲーション
/* ==============================
   カンバンビュー
   ============================== */
function getKanbanGroupBy(dbPath, ctx) {
  return getCurrentDbViewTypeSpecific(dbPath, 'kanban', { ctx })?.groupBy || '_status';
}
function setKanbanGroupBy(dbPath, prop, options = {}) {
  _saveCurrentDbViewField(dbPath, options.label || 'シート表示: カンバングループ', options.detail || prop || '', options, (v) => {
    if (!v.typeSpecific || typeof v.typeSpecific !== 'object' || Array.isArray(v.typeSpecific)) v.typeSpecific = {};
    if (!v.typeSpecific.kanban || typeof v.typeSpecific.kanban !== 'object' || Array.isArray(v.typeSpecific.kanban)) v.typeSpecific.kanban = {};
    v.typeSpecific.kanban.groupBy = prop;
  });
}

function _getKanbanConfig(dbPath, ctx) {
  const cfg = getCurrentDbViewTypeSpecific(dbPath, 'kanban', { ctx }) || {};
  const displayCfg = typeof _dbCardViewDisplayConfig === 'function'
    ? _dbCardViewDisplayConfig(cfg)
    : { cardImageThumbCount: 3, cardPropLineCount: 1 };
  return {
    groupBy: cfg.groupBy || '_status',
    showEntryName: cfg.showEntryName !== false,
    cardProps: Object.prototype.hasOwnProperty.call(cfg, 'cardProps') && Array.isArray(cfg.cardProps) ? cfg.cardProps : null,
    ...displayCfg,
  };
}

function _setKanbanDisplayProps(dbPath, cfg, options = {}) {
  const next = {
    ...cfg,
    cardProps: Array.isArray(cfg.cardProps) ? cfg.cardProps : [],
    showEntryName: cfg.showEntryName !== false,
    ...(typeof _dbCardViewDisplayConfig === 'function' ? _dbCardViewDisplayConfig(cfg) : {}),
  };
  setCurrentDbViewTypeSpecific(dbPath, 'kanban', next, {
    ctx: options.ctx || null,
    historyLabel: options.label || 'シート表示: カンバン表示列',
    detail: options.detail || '',
    skipHistory: options.skipHistory === true,
  });
}

function _kanbanDefaultCardProps(visibleProps, groupByProp) {
  return (visibleProps || []).filter(propName => propName !== groupByProp).slice(0, 3);
}

function _renderKanbanCardProps(root, card, propNames, ctx, options = {}) {
  const dbPath = ctx?.dbPath || state.currentDbPath;
  const propTypes = dbPath && typeof getPropertyTypes === 'function' ? getPropertyTypes(dbPath) : {};
  propNames.forEach(propName => {
    const vals = filterValues(card.data[propName] || [], undefined, ctx?.filter);
    if (vals.length === 0) return;
    const ptc = propTypes[propName] || {};
    if (ptc?.type === 'image') {
      const imageItems = _dbCardImageItemsFromValues(vals);
      if (imageItems.length) {
        _appendDbCardImagePreview(root, imageItems, {
          className: 'kanban-card-image-preview',
          propName,
          thumbCount: options.cardImageThumbCount,
        });
      }
      return;
    }
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
    root.appendChild(propRow);
  });
}

function _showKanbanDisplayPropsMenu(anchor, dbPath, cfg, props, ctx) {
  document.querySelectorAll('.kanban-card-props-menu').forEach(el => el.remove());
  const menu = document.createElement('div');
  menu.className = 'gb-context-menu tl-card-props-menu kanban-card-props-menu';
  menu.style.cssText = 'position:fixed;z-index:10000;min-width:240px;max-height:340px;overflow:auto;padding:6px;';
  let ordered = Array.isArray(cfg.cardProps) ? [...cfg.cardProps].filter(prop => props.includes(prop)) : [];
  let showEntryName = cfg.showEntryName !== false;
  let { cardImageThumbCount, cardPropLineCount } = typeof _dbCardViewDisplayConfig === 'function'
    ? _dbCardViewDisplayConfig(cfg)
    : { cardImageThumbCount: 3, cardPropLineCount: 1 };
  const save = (detail) => {
    _setKanbanDisplayProps(dbPath, { ...cfg, cardProps: ordered, showEntryName, cardImageThumbCount, cardPropLineCount }, { ctx, detail });
    renderKanban(ctx);
  };
  if (typeof _appendDbDisplayPropOption === 'function') {
    _appendDbDisplayPropOption(menu, 'エントリ名', showEntryName, {
      onToggle(checked) {
        showEntryName = checked;
        save('エントリ名');
      },
    });
    if (typeof _appendDbCardDisplayControls === 'function') {
      _appendDbCardDisplayControls(menu, { cardImageThumbCount, cardPropLineCount }, (next, detail) => {
        cardImageThumbCount = next.cardImageThumbCount;
        cardPropLineCount = next.cardPropLineCount;
        save(detail);
      });
    }
    props.forEach(prop => {
      _appendDbDisplayPropOption(menu, prop, ordered.includes(prop), {
        canMoveUp: ordered.indexOf(prop) > 0,
        canMoveDown: ordered.indexOf(prop) >= 0 && ordered.indexOf(prop) < ordered.length - 1,
        onToggle(checked) {
          ordered = checked ? [...ordered, prop].filter((name, idx, arr) => arr.indexOf(name) === idx) : ordered.filter(name => name !== prop);
          save(prop);
        },
        onMove(delta) {
          const idx = ordered.indexOf(prop);
          const nextIdx = idx + delta;
          if (idx < 0 || nextIdx < 0 || nextIdx >= ordered.length) return;
          [ordered[idx], ordered[nextIdx]] = [ordered[nextIdx], ordered[idx]];
          save(prop);
        },
      });
    });
  }
  document.body.appendChild(menu);
  if (typeof attachMeldexDropdownCloseButton === 'function') {
    attachMeldexDropdownCloseButton(menu, {
      trigger: anchor,
      className: 'kanban-card-props-menu-close',
      attr: 'data-kanban-card-props-close',
    });
  }
  if (typeof _positionTimelineCardPropsMenu === 'function') _positionTimelineCardPropsMenu(menu, anchor);
  else if (typeof positionPopup === 'function') positionPopup(menu, anchor.getBoundingClientRect());
  setTimeout(() => {
    const closer = (ev) => {
      if (!menu.contains(ev.target) && ev.target !== anchor && !anchor.contains(ev.target)) {
        menu.remove();
        document.removeEventListener('pointerdown', closer);
      }
    };
    document.addEventListener('pointerdown', closer);
  }, 0);
}

function _buildKanbanToolbar(dbPath, groupByProp, visibleProps, kanbanCfg, activeCardProps, ctx) {
  const toolbar = document.createElement('div');
  toolbar.className = 'db-card-view-toolbar kanban-card-view-toolbar';
  const label = document.createElement('span');
  label.className = 'chart-label';
  label.textContent = 'グループ化';
  toolbar.appendChild(label);

  const sel = document.createElement('select');
  sel.className = 'chart-select';
  sel.dataset.e2eId = 'kanban-group-by-select';
  sel.setAttribute('aria-label', 'カンバンのグループ化');
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
  sel.onchange = () => { setKanbanGroupBy(dbPath, sel.value, { ctx }); renderKanban(ctx); };
  toolbar.appendChild(sel);

  const displayPropsBtn = document.createElement('button');
  displayPropsBtn.type = 'button';
  displayPropsBtn.className = 'tl-nav-btn db-card-view-toolbar-btn';
  displayPropsBtn.title = 'カードに表示する列';
  displayPropsBtn.dataset.e2eId = 'kanban-display-props';
  displayPropsBtn.innerHTML = (typeof lucide === 'function' ? lucide('listPlus', 12) + ' ' : '') + '表示列' + (activeCardProps.length ? ' (' + activeCardProps.length + ')' : '');
  displayPropsBtn.addEventListener('click', (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    _showKanbanDisplayPropsMenu(ev.currentTarget, dbPath, { ...kanbanCfg, groupBy: groupByProp, cardProps: activeCardProps }, visibleProps.filter(p => p !== groupByProp), ctx);
  });
  toolbar.appendChild(displayPropsBtn);
  return toolbar;
}

function renderKanban(ctx) {
  ctx = ctx || _currentPaneState();
  const data = ctx.pivotData || state.pivotData;
  const container = _dbViewSurfaceEl(ctx, '.kanban-view', 'kanban-view');
  if (!container) {
    if (typeof showStatus === 'function') showStatus('シートのカンバン表示領域を準備できませんでした。シートを開き直してください。', true);
    return;
  }
  container.style.display = 'flex';
  if (!data || !data.entities) { container.innerHTML = '<div style="padding:40px;text-align:center;color:var(--fg2);">データがありません</div>'; return; }

  const dbPath = ctx.dbPath || state.currentDbPath;
  const entitiesMap = data.entities;
  const advFilters = getAdvancedFilters(dbPath, { ctx });
  const columnValueFilters = typeof getColumnValueFilters === 'function' ? getColumnValueFilters(dbPath, { ctx }) : {};
  const propTypes = getPropertyTypes(dbPath);
  const entityNames = typeof _dbSortedEntityNames === 'function'
    ? _dbSortedEntityNames(data, dbPath, ctx, { applyAdvancedFilters: true, advFilters, columnValueFilters, propTypes })
    : Object.keys(entitiesMap)
      .filter(name => _dbEntityPassesAdvancedFilters(entitiesMap[name], advFilters, ctx?.filter)
        && (typeof _dbEntityPassesColumnValueFilters !== 'function'
          || _dbEntityPassesColumnValueFilters(name, entitiesMap[name], columnValueFilters, dbPath, ctx, ctx?.filter)))
      .sort();
  ctx._lastEntityNames = [...entityNames];
  if (entityNames.length === 0) {
    if (typeof _dbRenderEmptyStateWithCreate === 'function') {
      _dbRenderEmptyStateWithCreate(container, 'columns', 'エントリがありません', 'エントリを追加して開始してください', ctx);
    } else {
      renderEmptyState(container, 'columns', 'エントリがありません', 'エントリを追加して開始してください');
    }
    return;
  }
  const hiddenCols = getHiddenCols(dbPath, { ctx });
  const colOrder = getColOrder(dbPath, { ctx });
  let orderedProps = colOrder ? colOrder.filter(p => data.properties.includes(p)) : [...data.properties];
  data.properties.forEach(p => { if (!orderedProps.includes(p)) orderedProps.push(p); });
  if (typeof filterDeletedDbProperties === 'function') orderedProps = filterDeletedDbProperties(dbPath, orderedProps);
  const visibleProps = orderedProps.filter(p => !hiddenCols.includes(p));
  const kanbanCfg = _getKanbanConfig(dbPath, ctx);
  let groupByProp = kanbanCfg.groupBy || getKanbanGroupBy(dbPath, ctx);
  if (groupByProp !== '_status' && !_isKanbanGroupableProperty(dbPath, groupByProp)) {
    groupByProp = '_status';
    setKanbanGroupBy(dbPath, groupByProp, { ctx, skipHistory: true });
  }

  // グループ化: ステータスまたはSelect型プロパティで分類
  const columns = new Map();

  if (groupByProp === '_status') {
    // ステータスベースのカンバン
    const statusDefs = _kanbanStatusDefs(dbPath);
    statusDefs.forEach(st => columns.set(st.name, []));

    entityNames.forEach(entityName => {
      const entityData = entitiesMap[entityName];
      const mainStatus = _kanbanEntityMainStatus(entityData, dbPath);
      if (!columns.has(mainStatus)) columns.set(mainStatus, []);
      columns.get(mainStatus).push({ name: entityName, data: entityData, status: mainStatus });
    });
  } else {
    // プロパティベースのカンバン
    entityNames.forEach(entityName => {
      const entityData = entitiesMap[entityName];
      const vals = filterValues(entityData[groupByProp] || [], undefined, ctx?.filter);
      const groupKey = vals.length > 0 ? vals[0].value : '(未設定)';
      if (!columns.has(groupKey)) columns.set(groupKey, []);
      columns.get(groupKey).push({ name: entityName, data: entityData, groupValue: groupKey });
    });
  }

  const activeCardProps = Array.isArray(kanbanCfg.cardProps) ? kanbanCfg.cardProps : _kanbanDefaultCardProps(visibleProps, groupByProp);
  const toolbar = _buildKanbanToolbar(dbPath, groupByProp, visibleProps, kanbanCfg, activeCardProps, ctx);

  // ボード描画
  const board = document.createElement('div');
  board.className = 'kanban-board';

  const statusColors = new Map(_kanbanStatusDefs(dbPath).map(st => [st.name, st.color]));

  columns.forEach((cards, colKey) => {
    const col = document.createElement('div');
    col.className = 'kanban-column';

    // カラムヘッダー
    const colHeader = document.createElement('div');
    colHeader.className = 'kanban-column-header';
    let optionHeaderColor = '';
    if (groupByProp === '_status') {
      const dot = document.createElement('span');
      dot.className = 'kanban-dot';
      dot.style.background = statusColors.get(colKey) || (typeof _getStatusColor === 'function' ? _getStatusColor(colKey, dbPath) : '#888');
      colHeader.appendChild(dot);
    } else if (typeof createDbOptionColorDot === 'function' && typeof getDbOptionColor === 'function') {
      const groupPtc = propTypes[groupByProp];
      if (groupPtc && (groupPtc.type === 'select' || groupPtc.type === 'multi-select')) {
        optionHeaderColor = getDbOptionColor(groupPtc, colKey);
        const optionDot = createDbOptionColorDot(optionHeaderColor);
        if (optionDot) { optionDot.classList.add('kanban-dot'); colHeader.appendChild(optionDot); }
      }
    }
    if (typeof applyDbOptionHeaderColor === 'function') applyDbOptionHeaderColor(colHeader, optionHeaderColor);
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
        // ステータスベース: 代表候補だけを変更し、案/ボツなどの別候補を巻き込まない
        const entityData = entitiesMap[entityName];
        const statusWriteOps = [];
        const autoFillOps = [];
        try {
          const statusTargets = _kanbanStatusMoveTargets(entityData, dbPath);
          for (const target of statusTargets) {
            if (target.old === colKey) continue;
            await _apiPutValue(target.ref, { new_status: colKey });
            statusWriteOps.push(target);
            if (typeof _autoFillOnStatusChange === 'function') {
              const entityPath = _entityPath(dbPath, entityName);
              const ops = await _autoFillOnStatusChange(entityPath, target.propName, colKey, dbPath, { ctx });
              if (Array.isArray(ops)) autoFillOps.push(...ops);
            }
          }
        } catch(err) {
          await _rollbackKanbanStatusMove(statusWriteOps, autoFillOps);
          showStatus('ステータス更新に失敗: ' + (err.message || err), true);
          await selectDatabase(dbPath, ctx);
          return;
        }
        if (statusWriteOps.length > 0) {
          historyPush('カンバン移動: ' + entityName + ' → ' + colKey,
            async () => {
              if (typeof _undoAutoFillStatusOps === 'function') await _undoAutoFillStatusOps(autoFillOps);
              for (const s of [...statusWriteOps].reverse()) { try { await _apiPutValue(s.ref, { new_status: s.old }); } catch {} }
              await selectDatabase(dbPath, ctx);
            },
            async () => {
              for (const s of statusWriteOps) { try { await _apiPutValue(s.ref, { new_status: colKey }); } catch {} }
              if (typeof _redoAutoFillStatusOps === 'function') await _redoAutoFillStatusOps(autoFillOps);
              await selectDatabase(dbPath, ctx);
            },
            _dbScope(dbPath)
          );
        }
      } else {
        // プロパティベース: 該当プロパティの採用値を変更
        const entityData = entitiesMap[entityName];
        const rawVals = entityData[groupByProp] || [];
        // 案/ボツの先頭候補を書き換えないよう、採用/掲載済みの代表候補だけを対象にする
        const target = _kanbanAdoptedValueForWrite(rawVals);
        if (target) {
          const oldVal = target.value || '';
          try {
            if (colKey === '(未設定)') {
              const ok = await (typeof cfConfirm === 'function'
                ? cfConfirm(`「${entityName}」の「${groupByProp}」を未設定にします。\n\n現在の値は削除されますが、元に戻せるよう履歴へ記録します。続行しますか？`)
                : Promise.resolve(window.confirm(`「${entityName}」の値を未設定にしますか？`)));
              if (!ok) return;
              const oldStatus = target.status || '採用';
              const oldNote = target.note || '';
              const oldRichHtml = target.rich_html || '';
              const oldRelations = Array.isArray(target.relations) ? JSON.parse(JSON.stringify(target.relations)) : [];
              const oldPublishedIn = Array.isArray(target.published_in) ? JSON.parse(JSON.stringify(target.published_in)) : [];
              const entityPath = _entityPath(dbPath, entityName);
              let currentRef = { file: target.file, entry_path: entityPath, property: target.property || groupByProp, candidate_index: target.candidate_index };
              await _apiPutValue(target, { _delete: true });
              historyPush('カンバン移動: ' + entityName,
                async () => {
                  const result = await _apiPostValue(entityPath, groupByProp, oldVal, oldStatus, oldNote, oldRichHtml, {
                    relations: oldRelations,
                    published_in: oldPublishedIn,
                    created: target.created || '',
                  });
                  currentRef = { file: result?.path || result?.file || currentRef.file, entry_path: entityPath, property: result?.property || groupByProp, candidate_index: result?.candidate_index };
                  await selectDatabase(dbPath, ctx);
                },
                async () => { await _apiPutValue(currentRef, { _delete: true }); await selectDatabase(dbPath, ctx); },
                _dbScope(dbPath)
              );
            } else {
              await _apiPutValue(target, { new_value: colKey });
              _dbUndoValue('カンバン移動: ' + entityName, target, oldVal, colKey);
            }
          } catch(err) {
            showStatus('値の更新に失敗: ' + (err.message || err), true);
            await selectDatabase(dbPath, ctx);
            return;
          }
        } else {
          // 値が存在しない場合は新規に採用値を追加
          if (colKey !== '(未設定)') {
            try {
              const entityPath = _entityPath(dbPath, entityName);
              const result = await _apiPostValue(entityPath, groupByProp, colKey, '採用', '');
              let createdRef = { file: result?.path || result?.file, entry_path: entityPath, property: result?.property || groupByProp, candidate_index: result?.candidate_index };
              if (createdRef.file) {
                historyPush('カンバン移動: ' + entityName,
                  async () => { await _apiPutValue(createdRef, { _delete: true }); await selectDatabase(dbPath, ctx); },
                  async () => {
                    const redo = await _apiPostValue(entityPath, groupByProp, colKey, '採用', '');
                    createdRef = { file: redo?.path || redo?.file || createdRef.file, entry_path: entityPath, property: redo?.property || groupByProp, candidate_index: redo?.candidate_index };
                    await selectDatabase(dbPath, ctx);
                  },
                  _dbScope(dbPath)
                );
              }
            } catch(err) { showStatus('値の更新に失敗: ' + (err.message || err), true); await selectDatabase(dbPath, ctx); return; }
          }
        }
      }
      showStatus(entityName + ' → ' + colKey);
      selectDatabase(dbPath, ctx);
    });

    // カード描画
    cards.forEach(card => {
      const cardEl = document.createElement('div');
      cardEl.className = 'kanban-card';
      cardEl.dataset.entity = card.name;
      cardEl.dataset.entityName = card.name;
      cardEl.dataset.meldexEntityPath = _entityPath(dbPath, card.name, ctx?.pivotData);
      cardEl.draggable = true;

      // D&D: ドラッグ開始
      cardEl.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/x-kanban-entity', card.name);
        window.MeldexBoardTransfer?.setEntityDragData?.(
          e.dataTransfer,
          dbPath,
          card.name,
          cardEl.dataset.meldexEntityPath,
        );
        e.dataTransfer.effectAllowed = 'copyMove';
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
      cardEl.style.setProperty('--db-card-prop-lines', String(kanbanCfg.cardPropLineCount));
      cardEl.appendChild(moreBtn);

      if (kanbanCfg.showEntryName !== false) {
        const title = document.createElement('div');
        title.className = 'kanban-card-title';
        title.textContent = card.name;
        cardEl.appendChild(title);
      }

      const propsDiv = document.createElement('div');
      propsDiv.className = 'kanban-card-props';
      const cardPropNames = Array.isArray(kanbanCfg.cardProps)
        ? kanbanCfg.cardProps.filter(propName => visibleProps.includes(propName) && propName !== groupByProp)
        : _kanbanDefaultCardProps(visibleProps, groupByProp);
      _renderKanbanCardProps(propsDiv, card, cardPropNames, ctx, {
        cardImageThumbCount: kanbanCfg.cardImageThumbCount,
      });
      cardEl.appendChild(propsDiv);

      colBody.appendChild(cardEl);
    });

    col.appendChild(colBody);
    board.appendChild(col);
  });

  container.innerHTML = '';
  container.appendChild(toolbar);
  container.appendChild(board);
}

/* ==============================
   タイムラインビュー
   ============================== */
