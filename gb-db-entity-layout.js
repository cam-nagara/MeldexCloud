/* gb-db-entity-layout.js: エントリレイアウト（シートのエントリ編集画面の自由配置レイアウト）
   - データモデルと永続化: view_config 内の entityLayouts / entityTabOrder / currentEntityTab。
     ビュー設定と同じ getDbViewConfig/saveDbViewConfig（localStorage即時 + デバウンスPUT）に乗せる。
     バックエンドは view_config の中身を不透明に素通しするため、デスクトップ/Cloud/単独版の
     どの保存経路でも追加改修なしで永続化される（2026-08-19 実装時に確認済み）。
   - 「列一覧 ⇄ エントリレイアウト」タブ行: D&D並べ替え・リネーム・複製・削除・追加。
     エントリを開いた直後は entityTabOrder の先頭タブを表示する（並び順=初期表示、2026-08-13確定）。
   - キャンバス描画は gb-db-entity-layout-canvas.js、セル内容は gb-db-entity-layout-cells.js が担当。
   - 旧バージョン互換: すべて追加のみのフィールド。旧版は view_config 内の未知キーを温存したまま
     無視して読み込める（既存の entityPropsCollapsed 等と同じ扱い）。 */
'use strict';

const EL_COLUMNS_TAB_ID = 'columns';
const EL_DEFAULT_CANVAS_W = 1000;
const EL_DEFAULT_CANVAS_H = 700;
const EL_CANVAS_MIN = 200;
const EL_CANVAS_MAX = 8000;
const EL_CELL_TYPES = ['field', 'label', 'image', 'divider', 'chart'];
const EL_CELL_MIN_SIZE = 24;

function _elGenId(prefix) {
  return (prefix || 'el') + '-' + Date.now().toString(36) + '-' + Math.floor(Math.random() * 1679616).toString(36);
}

function _elIsObj(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function _elClampNum(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

// セル1件を正規化する。未知の追加フィールド（style等）はそのまま温存する。
function _elNormalizeCell(cell, canvasW, canvasH) {
  const src = _elIsObj(cell) ? cell : {};
  const out = { ...src };
  out.id = typeof src.id === 'string' && src.id ? src.id : _elGenId('cell');
  // 未知のセル種別は温存する（新しい版で作られたデータを旧版が黙って壊さない前方互換ルール。
  // 描画側 _elBuildCellContent が種別名のプレースホルダを出す）
  out.type = typeof src.type === 'string' && src.type ? src.type : 'field';
  out.w = _elClampNum(src.w, EL_CELL_MIN_SIZE, EL_CANVAS_MAX, 220);
  out.h = _elClampNum(src.h, EL_CELL_MIN_SIZE, EL_CANVAS_MAX, 90);
  // x/y はキャンバスサイズでクランプしない（キャンバスを一時的に縮めても座標を
  // 恒久的に失わないため。表示は overflow:hidden で切れるだけで、拡げれば戻る）
  out.x = _elClampNum(src.x, 0, EL_CANVAS_MAX, 20);
  out.y = _elClampNum(src.y, 0, EL_CANVAS_MAX, 20);
  if (out.type === 'field') out.prop = String(src.prop || '');
  if (!_elIsObj(out.style)) out.style = {};
  return out;
}

// レイアウト1件を正規化する。未知の追加フィールドは温存する。
function _elNormalizeLayout(layout) {
  const src = _elIsObj(layout) ? layout : {};
  const out = { ...src };
  out.id = typeof src.id === 'string' && src.id ? src.id : _elGenId('el');
  out.name = String(src.name || '').trim() || 'レイアウト';
  const size = _elIsObj(src.canvasSize) ? src.canvasSize : {};
  out.canvasSize = {
    w: _elClampNum(size.w, EL_CANVAS_MIN, EL_CANVAS_MAX, EL_DEFAULT_CANVAS_W),
    h: _elClampNum(size.h, EL_CANVAS_MIN, EL_CANVAS_MAX, EL_DEFAULT_CANVAS_H),
  };
  out.cells = (Array.isArray(src.cells) ? src.cells : [])
    .map(cell => _elNormalizeCell(cell, out.canvasSize.w, out.canvasSize.h));
  if (!_elIsObj(out.theme)) out.theme = null;
  return out;
}

/* view_config からエントリレイアウト状態を取り出して正規化する（cfgは変更しない）。
   tabOrder は「'columns' をちょうど1つ + 実在するレイアウトidをちょうど1つずつ」に補正する。 */
function _elNormalizeState(cfg) {
  const config = _elIsObj(cfg) ? cfg : {};
  const layouts = (Array.isArray(config.entityLayouts) ? config.entityLayouts : [])
    .filter(_elIsObj)
    .map(_elNormalizeLayout);
  const knownIds = new Set(layouts.map(l => l.id));
  const rawOrder = Array.isArray(config.entityTabOrder) ? config.entityTabOrder : [];
  const tabOrder = [];
  rawOrder.forEach(id => {
    const key = String(id || '');
    if (key === EL_COLUMNS_TAB_ID && !tabOrder.includes(EL_COLUMNS_TAB_ID)) tabOrder.push(EL_COLUMNS_TAB_ID);
    else if (knownIds.has(key) && !tabOrder.includes(key)) tabOrder.push(key);
  });
  if (!tabOrder.includes(EL_COLUMNS_TAB_ID)) tabOrder.unshift(EL_COLUMNS_TAB_ID);
  layouts.forEach(l => { if (!tabOrder.includes(l.id)) tabOrder.push(l.id); });
  let currentTab = String(config.currentEntityTab || '');
  if (currentTab !== EL_COLUMNS_TAB_ID && !knownIds.has(currentTab)) currentTab = tabOrder[0];
  return { layouts, tabOrder, currentTab };
}

// 「レイアウト」「レイアウト 2」…の形式で重複しない既定名を作る
function _elMakeNewLayoutName(layouts) {
  const names = new Set((layouts || []).map(l => String(l?.name || '')));
  const base = 'レイアウト';
  if (!names.has(base)) return base;
  let n = 2;
  while (names.has(base + ' ' + n)) n += 1;
  return base + ' ' + n;
}

// 複製時の既定名（savedViews の複製と同じ「名前 2」方式）
function _elMakeDuplicateName(sourceName, layouts) {
  const names = new Set((layouts || []).map(l => String(l?.name || '')));
  const base = String(sourceName || 'レイアウト').replace(/\s+\d+$/, '') || 'レイアウト';
  let n = 2;
  while (names.has(base + ' ' + n)) n += 1;
  return base + ' ' + n;
}

function _elGetState(dbPath) {
  if (!dbPath || typeof getDbViewConfig !== 'function') return null;
  return _elNormalizeState(getDbViewConfig(dbPath) || {});
}

// Cloud/mobile の権限・容量状態は、画面を開いた後にも変化する。描画時 options だけでなく
// grid の現在状態も毎回見ることで、切替前に開いたポップアップや遅延 callback からの
// 書き込みを止める。
function _elCanMutateGrid(grid, options) {
  return options?.readOnly !== true && grid?.__MeldexRuntimeReadOnly !== true;
}

/* 状態を読み出し→mutator適用→view_configへ書き戻して保存する。
   mutator(state) が false を返した場合は保存しない。
   label があれば localStorage スナップショット方式の取り消し履歴（ビュー設定と共通の仕組み）に載る。 */
function _elMutateState(dbPath, label, detail, mutator, options = {}) {
  if (!dbPath || typeof getDbViewConfig !== 'function' || typeof saveDbViewConfig !== 'function') return null;
  const cfg = getDbViewConfig(dbPath) || {};
  const state = _elNormalizeState(cfg);
  if (typeof mutator === 'function' && mutator(state, cfg) === false) return null;
  const normalized = _elNormalizeState({
    entityLayouts: state.layouts,
    entityTabOrder: state.tabOrder,
    currentEntityTab: state.currentTab,
  });
  cfg.entityLayouts = normalized.layouts;
  cfg.entityTabOrder = normalized.tabOrder;
  cfg.currentEntityTab = normalized.currentTab;
  saveDbViewConfig(dbPath, cfg, {
    historyLabel: label || '',
    historyDetail: detail || '',
    skipHistory: options.skipHistory === true || !label,
    ctx: options.ctx,
    // 取り消し/やり直しで localStorage が巻き戻った後、開いているエントリ画面を再描画する
    onRestore: typeof options.onRestore === 'function' ? options.onRestore : undefined,
    // エントリ画面（フルページタブ）の履歴スコープは共通('')のため、シートの
    // 'db:'スコープに積むとエントリ画面から Ctrl+Z が届かない。共通スコープへ積めば
    // エントリ画面からもシートタブ（スコープ→共通のフォールバック）からも取り消せる
    historyScope: '',
  });
  return normalized;
}

// タブ操作用: 再描画クロージャを取り消し復元時にも安全に呼べる形へ包む
function _elRestoreOption(grid, rerender) {
  return {
    onRestore: () => {
      if (grid?.isConnected && typeof rerender === 'function') rerender();
    },
  };
}

/* --- セッション内状態（描画先コンテナ単位）---
   「エントリを開いた時は並び順の先頭タブ」を実現するため、選択タブは描画先コンテナ+エントリ単位の
   セッション状態として持ち、同一エントリの再描画時のみ維持する。編集モードも同様にセッション限定。 */
const _elSessionByGrid = new WeakMap();

function _elSession(grid, entityPath) {
  let session = _elSessionByGrid.get(grid);
  if (!session || session.entityPath !== entityPath) {
    session = { entityPath, tab: null, editMode: false };
    _elSessionByGrid.set(grid, session);
  }
  return session;
}

function _elResolveActiveTab(grid, entityPath, state, options) {
  const session = _elSession(grid, entityPath);
  if (session.tab === EL_COLUMNS_TAB_ID) return EL_COLUMNS_TAB_ID;
  if (session.tab && state.layouts.some(l => l.id === session.tab)) return session.tab;
  // 幅の狭い面（右サイドバー・モバイルドロワー）では、レイアウトが並び順先頭でも
  // 初期表示は列一覧にする（1000px基準のキャンバスが極小に縮んで読めなくなるため）。
  // タブを押せばレイアウトへ切り替えられる。
  const narrowSurface = options?.surface === 'right-sidebar'
    || grid?.classList?.contains?.('cloud-mobile-side-drawer-props-grid');
  if (narrowSurface) return EL_COLUMNS_TAB_ID;
  return state.tabOrder[0] || EL_COLUMNS_TAB_ID;
}

function _elSelectTab(grid, entityPath, dbPath, tabId, rerender, options = {}) {
  const session = _elSession(grid, entityPath);
  session.tab = tabId;
  // currentEntityTab は「直近に選択していたタブ」の記憶。初期表示の決定には使わない（並び順先頭が優先）
  // 閲覧専用面の表示切替はセッション内だけに留め、共有 view_config を書き換えない。
  if (_elCanMutateGrid(grid, options)) {
    _elMutateState(dbPath, '', '', (state) => { state.currentTab = tabId; }, { skipHistory: true });
  }
  if (typeof rerender === 'function') rerender();
}

/* --- タブ操作 --- */

function _elAddLayout(grid, entityPath, dbPath, rerender) {
  if (!_elCanMutateGrid(grid)) return;
  let newId = '';
  _elMutateState(dbPath, 'エントリレイアウト: 追加', '', (state) => {
    const layout = _elNormalizeLayout({ name: _elMakeNewLayoutName(state.layouts) });
    newId = layout.id;
    state.layouts.push(layout);
    state.tabOrder.push(layout.id);
    state.currentTab = layout.id;
  }, _elRestoreOption(grid, rerender));
  if (!newId) return;
  const session = _elSession(grid, entityPath);
  session.tab = newId;
  session.editMode = true; // 空のレイアウトは編集モードで開き、すぐセルを置ける状態にする
  if (typeof showStatus === 'function') showStatus('エントリレイアウトを追加しました');
  if (typeof rerender === 'function') rerender();
}

async function _elRenameLayout(grid, entityPath, dbPath, layoutId, rerender) {
  if (!_elCanMutateGrid(grid)) return;
  const state = _elGetState(dbPath);
  const layout = state?.layouts.find(l => l.id === layoutId);
  if (!layout) return;
  const input = typeof cfPrompt === 'function'
    ? await cfPrompt('エントリレイアウト名', layout.name, { okLabel: '変更' })
    : null;
  if (input == null) return;
  if (!_elCanMutateGrid(grid)) return;
  const name = String(input).trim();
  if (!name) {
    if (typeof showStatus === 'function') showStatus('名前を入力してください', true);
    return;
  }
  _elMutateState(dbPath, 'エントリレイアウト: 名前変更', layout.name + ' → ' + name, (st) => {
    const target = st.layouts.find(l => l.id === layoutId);
    if (!target) return false;
    target.name = name;
  }, _elRestoreOption(grid, rerender));
  if (typeof rerender === 'function') rerender();
}

async function _elDuplicateLayout(grid, entityPath, dbPath, layoutId, rerender) {
  if (!_elCanMutateGrid(grid)) return;
  const state = _elGetState(dbPath);
  const source = state?.layouts.find(l => l.id === layoutId);
  if (!source) return;
  const defaultName = _elMakeDuplicateName(source.name, state.layouts);
  const input = typeof cfPrompt === 'function'
    ? await cfPrompt('複製後のレイアウト名', defaultName, { okLabel: '複製' })
    : defaultName;
  if (input == null) return;
  if (!_elCanMutateGrid(grid)) return;
  const name = String(input).trim();
  if (!name) {
    if (typeof showStatus === 'function') showStatus('名前を入力してください', true);
    return;
  }
  let newId = '';
  _elMutateState(dbPath, 'エントリレイアウト: 複製', source.name + ' → ' + name, (st) => {
    const src = st.layouts.find(l => l.id === layoutId);
    if (!src) return false;
    const clone = _elNormalizeLayout(JSON.parse(JSON.stringify(src)));
    clone.id = _elGenId('el');
    clone.name = name;
    clone.cells = clone.cells.map(cell => ({ ...cell, id: _elGenId('cell') }));
    newId = clone.id;
    const insertAt = st.tabOrder.indexOf(layoutId);
    st.layouts.push(clone);
    st.tabOrder.splice(insertAt >= 0 ? insertAt + 1 : st.tabOrder.length, 0, clone.id);
    st.currentTab = clone.id;
  }, _elRestoreOption(grid, rerender));
  if (!newId) return;
  _elSession(grid, entityPath).tab = newId;
  if (typeof showStatus === 'function') showStatus('エントリレイアウトを複製しました: ' + name);
  if (typeof rerender === 'function') rerender();
}

async function _elDeleteLayout(grid, entityPath, dbPath, layoutId, rerender) {
  if (!_elCanMutateGrid(grid)) return;
  const state = _elGetState(dbPath);
  const layout = state?.layouts.find(l => l.id === layoutId);
  if (!layout) return;
  // 削除は確認ダイアログ必須（プロジェクト共通ルール）。取り消し履歴からも復元できる。
  const confirmed = typeof cfConfirm === 'function'
    ? await cfConfirm('エントリレイアウト「' + layout.name + '」を削除しますか？')
    : false;
  if (!confirmed) return;
  if (!_elCanMutateGrid(grid)) return;
  _elMutateState(dbPath, 'エントリレイアウト: 削除', layout.name, (st) => {
    const idx = st.layouts.findIndex(l => l.id === layoutId);
    if (idx < 0) return false;
    st.layouts.splice(idx, 1);
    st.tabOrder = st.tabOrder.filter(id => id !== layoutId);
    if (st.currentTab === layoutId) st.currentTab = st.tabOrder[0] || EL_COLUMNS_TAB_ID;
  }, _elRestoreOption(grid, rerender));
  const session = _elSession(grid, entityPath);
  if (session.tab === layoutId) session.tab = null; // 次描画で並び順先頭タブへ戻す
  if (typeof showStatus === 'function') showStatus('エントリレイアウトを削除しました: ' + layout.name);
  if (typeof rerender === 'function') rerender();
}

function _elReorderTabs(grid, dbPath, fromId, toId, placeAfter, rerender) {
  if (!_elCanMutateGrid(grid)) return;
  if (!fromId || !toId || fromId === toId) return;
  _elMutateState(dbPath, 'エントリレイアウト: タブ並べ替え', '', (st) => {
    const order = st.tabOrder.filter(id => id !== fromId);
    const targetIdx = order.indexOf(toId);
    if (targetIdx < 0) return false;
    order.splice(placeAfter ? targetIdx + 1 : targetIdx, 0, fromId);
    st.tabOrder = order;
  }, _elRestoreOption(grid, rerender));
  if (typeof rerender === 'function') rerender();
}

/* --- タブメニュー（名前変更 / 複製 / 削除）--- */

function _elCloseTabMenus() {
  document.querySelectorAll('.el-tab-menu').forEach(el => {
    if (typeof el._cleanup === 'function') el._cleanup();
    el.remove();
  });
}

function _elShowTabMenu(anchorBtn, grid, entityPath, dbPath, layoutId, rerender) {
  const items = [
    { key: 'rename', label: '名前を変更', icon: 'pencil', run: () => _elRenameLayout(grid, entityPath, dbPath, layoutId, rerender) },
    { key: 'duplicate', label: '複製', icon: 'copy', run: () => _elDuplicateLayout(grid, entityPath, dbPath, layoutId, rerender) },
    { key: 'delete', label: '削除', icon: 'trash', danger: true, run: () => _elDeleteLayout(grid, entityPath, dbPath, layoutId, rerender) },
  ];
  _elShowActionMenu(anchorBtn, items, 'entity-layout-tab-menu');
}

/* 書き出しメニュー（HTML / PNG）。実体は既存の書き出しエンジンへ委譲する。
   複数の面（メイン/サブパネル/右サイドバー）で同時にレイアウトを開いていても、
   押されたタブ行の面が書き出されるよう、対象の grid を書き出しエンジンへ引き渡す。 */
function _elShowExportMenu(anchorBtn, grid) {
  window.__meldexEntityLayoutExportRoot = grid || anchorBtn?.closest?.('.entity-props-grid-container') || null;
  const items = [
    {
      key: 'export-html', label: 'HTMLとして保存', icon: 'fileText',
      run: () => {
        if (typeof MeldexExportHtml !== 'undefined' && MeldexExportHtml?.exportCurrentView) {
          MeldexExportHtml.exportCurrentView('entity-layout');
        } else if (typeof showStatus === 'function') showStatus('HTML書き出しを利用できません', true);
      },
    },
    {
      key: 'export-png', label: '画像（PNG）として保存', icon: 'image',
      run: () => {
        if (typeof MeldexExportImage !== 'undefined' && MeldexExportImage?.exportCurrentView) {
          MeldexExportImage.exportCurrentView('entity-layout');
        } else if (typeof showStatus === 'function') showStatus('画像書き出しを利用できません', true);
      },
    },
  ];
  _elShowActionMenu(anchorBtn, items, 'entity-layout-export-menu');
}

function _elShowActionMenu(anchorBtn, items, menuE2eId) {
  _elCloseTabMenus();
  const menu = document.createElement('div');
  menu.className = 'gb-context-menu el-tab-menu';
  menu.dataset.e2eId = menuE2eId;
  menu.setAttribute('role', 'menu');
  items.forEach(item => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'el-tab-menu-item' + (item.danger ? ' danger' : '');
    btn.dataset.e2eId = 'entity-layout-tab-menu-' + item.key;
    btn.setAttribute('role', 'menuitem');
    btn.innerHTML = (typeof lucide === 'function' ? lucide(item.icon, 13) : '') + '<span>' + item.label + '</span>';
    btn.addEventListener('click', () => {
      close();
      item.run();
    });
    menu.appendChild(btn);
  });
  document.body.appendChild(menu);
  const cleanupFns = [];
  menu._cleanup = () => { cleanupFns.splice(0).forEach(off => off()); };
  const close = () => {
    menu._cleanup();
    menu.remove();
    if (typeof focusMeldexDropdownTrigger === 'function') focusMeldexDropdownTrigger(anchorBtn);
    else { try { anchorBtn?.focus?.(); } catch { /* ignore */ } }
  };
  if (typeof positionPopup === 'function') {
    positionPopup(menu, anchorBtn.getBoundingClientRect(), { gap: 4 });
  } else if (typeof clampPopupToViewport === 'function') {
    const rect = anchorBtn.getBoundingClientRect();
    menu.style.left = rect.left + 'px';
    menu.style.top = (rect.bottom + 4) + 'px';
    clampPopupToViewport(menu);
  }
  setTimeout(() => {
    const onPointerDown = (ev) => {
      if (!menu.contains(ev.target) && ev.target !== anchorBtn && !anchorBtn.contains(ev.target)) close();
    };
    const onKeyDown = (ev) => {
      if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); close(); }
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown, true);
    cleanupFns.push(() => document.removeEventListener('pointerdown', onPointerDown));
    cleanupFns.push(() => document.removeEventListener('keydown', onKeyDown, true));
  }, 0);
  requestAnimationFrame(() => { try { menu.querySelector('button')?.focus({ preventScroll: true }); } catch { /* ignore */ } });
}

/* --- タブ行の構築 ---
   renderEntityPropsGridInto から呼ばれる。dbPath が無い（シート配下でない）エントリでは null を返し、
   従来どおり列一覧のみの表示になる。戻り値: { el, activeTab }。 */
function _elBuildTabBar(grid, data, entityPath, options, dbPath, rerender) {
  if (!dbPath) return null;
  const state = _elGetState(dbPath);
  if (!state) return null;
  // 再描画のたびに、前回の描画に紐付いたポップアップ・メニュー・ResizeObserverを確実に始末する
  // （取り消し復元や候補値追加の自動再描画で grid が作り直されても、古い layout への
  // 書き込みポップアップや監視が残らないようにする）
  _elCloseTabMenus();
  if (typeof _elCloseEditPopups === 'function') _elCloseEditPopups();
  if (grid._elViewportObserver) {
    try { grid._elViewportObserver.disconnect(); } catch { /* ignore */ }
    grid._elViewportObserver = null;
  }
  const activeTab = _elResolveActiveTab(grid, entityPath, state, options);
  const session = _elSession(grid, entityPath);
  const readOnly = options?.readOnly === true;

  const bar = document.createElement('div');
  bar.className = 'el-tabbar';
  bar.dataset.e2eId = 'entity-layout-tabbar';

  const tabs = document.createElement('div');
  tabs.className = 'el-tabs';
  tabs.setAttribute('role', 'tablist');
  tabs.setAttribute('aria-label', 'エントリの表示切替');
  bar.appendChild(tabs);

  const tabDefs = state.tabOrder.map(id => (
    id === EL_COLUMNS_TAB_ID
      ? { id, name: '列一覧' }
      : { id, name: state.layouts.find(l => l.id === id)?.name || 'レイアウト' }
  ));
  tabDefs.forEach(def => {
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.className = 'el-tab' + (def.id === activeTab ? ' active' : '');
    tab.dataset.e2eId = 'entity-layout-tab';
    tab.dataset.tabId = def.id;
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-selected', def.id === activeTab ? 'true' : 'false');
    tab.tabIndex = def.id === activeTab ? 0 : -1;
    tab.draggable = !readOnly;
    const label = document.createElement('span');
    label.className = 'el-tab-label';
    label.textContent = def.name;
    tab.appendChild(label);
    tab.addEventListener('click', () => {
      _elCloseTabMenus();
      if (def.id !== activeTab) _elSelectTab(grid, entityPath, dbPath, def.id, rerender, { readOnly });
    });
    tab.addEventListener('keydown', (e) => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) return;
      const allTabs = Array.from(tabs.querySelectorAll('.el-tab'));
      const currentIdx = allTabs.indexOf(tab);
      if (currentIdx < 0 || allTabs.length < 2) return;
      e.preventDefault();
      let nextIdx = currentIdx;
      if (e.key === 'Home') nextIdx = 0;
      else if (e.key === 'End') nextIdx = allTabs.length - 1;
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') nextIdx = (currentIdx - 1 + allTabs.length) % allTabs.length;
      else nextIdx = (currentIdx + 1) % allTabs.length;
      const nextTab = allTabs[nextIdx];
      session.pendingTabFocus = nextTab?.dataset?.tabId || '';
      nextTab?.click?.();
    });
    if (def.id !== EL_COLUMNS_TAB_ID && !readOnly) {
      tab.addEventListener('dblclick', (e) => {
        e.preventDefault();
        _elRenameLayout(grid, entityPath, dbPath, def.id, rerender);
      });
    }
    // D&D並べ替え（「列一覧」タブも並べ替え対象。先頭に置いたタブが初期表示になる）
    tab.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/x-el-tab', def.id);
      e.dataTransfer.effectAllowed = 'move';
      tab.classList.add('dragging');
    });
    tab.addEventListener('dragend', () => {
      tab.classList.remove('dragging');
      tabs.querySelectorAll('.el-tab').forEach(t => t.classList.remove('el-drop-before', 'el-drop-after'));
    });
    tab.addEventListener('dragover', (e) => {
      if (!e.dataTransfer.types.includes('text/x-el-tab')) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const rect = tab.getBoundingClientRect();
      const after = e.clientX > rect.left + rect.width / 2;
      tab.classList.toggle('el-drop-before', !after);
      tab.classList.toggle('el-drop-after', after);
    });
    tab.addEventListener('dragleave', () => {
      tab.classList.remove('el-drop-before', 'el-drop-after');
    });
    tab.addEventListener('drop', (e) => {
      if (!e.dataTransfer.types.includes('text/x-el-tab')) return;
      e.preventDefault();
      const fromId = e.dataTransfer.getData('text/x-el-tab');
      const rect = tab.getBoundingClientRect();
      const after = e.clientX > rect.left + rect.width / 2;
      _elReorderTabs(grid, dbPath, fromId, def.id, after, rerender);
    });
    tabs.appendChild(tab);
  });

  if (!readOnly) {
    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'el-tab-add gb-btn gb-btn-sm gb-btn-icon';
    addBtn.dataset.e2eId = 'entity-layout-add';
    addBtn.title = 'エントリレイアウトを追加';
    addBtn.setAttribute('aria-label', 'エントリレイアウトを追加');
    addBtn.innerHTML = typeof lucide === 'function' ? lucide('plus', 14) : '+';
    addBtn.addEventListener('click', () => {
      _elCloseTabMenus();
      _elAddLayout(grid, entityPath, dbPath, rerender);
    });
    // tablist（.el-tabs）の外に置く: スマホ幅の共通タブドロップダウン化が
    // [role=tablist] を丸ごと隠すため、中に置くと追加手段が消える（2026-08-20レビュー指摘）
    bar.appendChild(addBtn);
  }

  // アクティブなレイアウトタブ用の操作（書き出し + 編集モード切替 + タブメニュー）
  if (activeTab !== EL_COLUMNS_TAB_ID) {
    const actions = document.createElement('div');
    actions.className = 'el-tab-actions';

    const exportBtn = document.createElement('button');
    exportBtn.type = 'button';
    exportBtn.className = 'el-export-btn gb-btn gb-btn-sm gb-btn-icon';
    exportBtn.dataset.e2eId = 'entity-layout-export-btn';
    exportBtn.title = 'レイアウトを書き出し';
    exportBtn.setAttribute('aria-label', 'レイアウトを書き出し');
    exportBtn.setAttribute('aria-haspopup', 'menu');
    exportBtn.innerHTML = typeof lucide === 'function' ? lucide('download', 14) : '↓';
    exportBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      _elShowExportMenu(exportBtn, grid);
    });
    actions.appendChild(exportBtn);

    const editBtn = document.createElement('button');
    if (readOnly) session.editMode = false;
    editBtn.type = 'button';
    editBtn.className = 'el-edit-toggle gb-btn gb-btn-sm gb-btn-icon' + (session.editMode ? ' active' : '');
    editBtn.dataset.e2eId = 'entity-layout-edit-toggle';
    const editLabel = session.editMode ? 'レイアウト編集を終了' : 'レイアウトを編集';
    editBtn.title = editLabel;
    editBtn.setAttribute('aria-label', editLabel);
    editBtn.setAttribute('aria-pressed', session.editMode ? 'true' : 'false');
    editBtn.innerHTML = typeof lucide === 'function' ? lucide(session.editMode ? 'check' : 'pencil', 14) : '編';
    editBtn.addEventListener('click', () => {
      _elCloseTabMenus();
      session.editMode = !session.editMode;
      if (typeof rerender === 'function') rerender();
    });
    if (!readOnly) actions.appendChild(editBtn);

    const menuBtn = document.createElement('button');
    menuBtn.type = 'button';
    menuBtn.className = 'el-tab-menu-btn gb-btn gb-btn-sm gb-btn-icon';
    menuBtn.dataset.e2eId = 'entity-layout-tab-menu-btn';
    menuBtn.title = 'レイアウトの操作';
    menuBtn.setAttribute('aria-label', 'レイアウトの操作');
    menuBtn.setAttribute('aria-haspopup', 'menu');
    menuBtn.innerHTML = typeof lucide === 'function' ? lucide('moreHorizontal', 14) : '…';
    menuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      _elShowTabMenu(menuBtn, grid, entityPath, dbPath, activeTab, rerender);
    });
    if (!readOnly) actions.appendChild(menuBtn);
    bar.appendChild(actions);
  }

  if (session.pendingTabFocus) {
    const focusTabId = session.pendingTabFocus;
    session.pendingTabFocus = '';
    requestAnimationFrame(() => {
      const focusTab = Array.from(tabs.querySelectorAll('.el-tab'))
        .find(candidate => candidate.dataset.tabId === focusTabId);
      try { focusTab?.focus({ preventScroll: true }); } catch { /* ignore */ }
    });
  }

  return { el: bar, activeTab };
}

/* --- 公開API --- */
if (typeof window !== 'undefined') {
  window.GBEntityLayout = {
    COLUMNS_TAB_ID: EL_COLUMNS_TAB_ID,
    buildTabBar: _elBuildTabBar,
    renderLayoutBody: (grid, data, entityPath, options, dbPath, layoutId, rerender) => {
      if (typeof _elRenderLayoutBody === 'function') {
        _elRenderLayoutBody(grid, data, entityPath, options, dbPath, layoutId, rerender);
      }
    },
    getState: _elGetState,
    mutateState: _elMutateState,
    session: _elSession,
  };
}
