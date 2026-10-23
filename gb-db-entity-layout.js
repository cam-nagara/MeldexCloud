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
const EL_CELL_TYPES = ['field', 'label', 'image', 'divider', 'chart', 'subform'];
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
  return globalThis.MeldexDbTopicLayoutStyle?.normalizeCellStyleContract
    ? globalThis.MeldexDbTopicLayoutStyle.normalizeCellStyleContract(out)
    : out;
}

// レイアウト1件を正規化する。未知の追加フィールドは温存する。
function _elNormalizeLayout(layout) {
  const src = _elIsObj(layout) ? layout : {};
  const out = { ...src };
  out.id = typeof src.id === 'string' && src.id ? src.id : _elGenId('el');
  out.name = String(src.name || '').trim() || 'レイアウト';
  const size = _elIsObj(src.canvasSize) ? src.canvasSize : {};
  out.canvasSize = {
    ...size,
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
  // 初期表示は一覧性の高い列一覧にする。
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
  _elMutateState(dbPath, 'トピックレイアウト: 追加', '', (state) => {
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
  if (typeof showStatus === 'function') showStatus('トピックレイアウトを追加しました');
  if (typeof rerender === 'function') rerender();
}

async function _elRenameLayout(grid, entityPath, dbPath, layoutId, rerender) {
  if (!_elCanMutateGrid(grid)) return;
  const state = _elGetState(dbPath);
  const layout = state?.layouts.find(l => l.id === layoutId);
  if (!layout) return;
  const input = typeof cfPrompt === 'function'
    ? await cfPrompt('トピックレイアウト名', layout.name, { okLabel: '変更' })
    : null;
  if (input == null) return;
  if (!_elCanMutateGrid(grid)) return;
  const name = String(input).trim();
  if (!name) {
    if (typeof showStatus === 'function') showStatus('名前を入力してください', true);
    return;
  }
  _elMutateState(dbPath, 'トピックレイアウト: 名前変更', layout.name + ' → ' + name, (st) => {
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
  _elMutateState(dbPath, 'トピックレイアウト: 複製', source.name + ' → ' + name, (st) => {
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
  if (typeof showStatus === 'function') showStatus('トピックレイアウトを複製しました: ' + name);
  if (typeof rerender === 'function') rerender();
}

async function _elDeleteLayout(grid, entityPath, dbPath, layoutId, rerender) {
  if (!_elCanMutateGrid(grid)) return;
  const state = _elGetState(dbPath);
  const layout = state?.layouts.find(l => l.id === layoutId);
  if (!layout) return;
  // 削除は確認ダイアログ必須（プロジェクト共通ルール）。取り消し履歴からも復元できる。
  const confirmed = typeof cfConfirm === 'function'
    ? await cfConfirm('トピックレイアウト「' + layout.name + '」を削除しますか？')
    : false;
  if (!confirmed) return;
  if (!_elCanMutateGrid(grid)) return;
  _elMutateState(dbPath, 'トピックレイアウト: 削除', layout.name, (st) => {
    const idx = st.layouts.findIndex(l => l.id === layoutId);
    if (idx < 0) return false;
    st.layouts.splice(idx, 1);
    st.tabOrder = st.tabOrder.filter(id => id !== layoutId);
    if (st.currentTab === layoutId) st.currentTab = st.tabOrder[0] || EL_COLUMNS_TAB_ID;
  }, _elRestoreOption(grid, rerender));
  const session = _elSession(grid, entityPath);
  if (session.tab === layoutId) session.tab = null; // 次描画で並び順先頭タブへ戻す
  if (typeof showStatus === 'function') showStatus('トピックレイアウトを削除しました: ' + layout.name);
  if (typeof rerender === 'function') rerender();
}

function _elReorderTabs(grid, dbPath, fromId, toId, placeAfter, rerender) {
  if (!_elCanMutateGrid(grid)) return;
  if (!fromId || !toId || fromId === toId) return;
  _elMutateState(dbPath, 'トピックレイアウト: タブ並べ替え', '', (st) => {
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
function _elShowExportMenu(anchorBtn, grid, context) {
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
  if (globalThis.MeldexDbTopicLayoutStyle && context?.layoutId) {
    items.push(
      { key: 'export-template', label: 'トピックレイアウトを保存', icon: 'save', run: () => _elDownloadTopicLayoutTemplate(context) },
      { key: 'import-template', label: 'トピックレイアウトを読み込む', icon: 'upload', run: () => _elChooseTopicLayoutTemplate(context) },
      { key: 'save-shared-template', label: '共有テンプレートへ保存', icon: 'library', run: () => _elSaveTopicLayoutToSharedLibrary(context) },
      { key: 'load-shared-template', label: '共有テンプレートから読み込む', icon: 'folderOpen', run: () => _elLoadTopicLayoutFromSharedLibrary(context) },
    );
  }
  _elShowActionMenu(anchorBtn, items, 'entity-layout-export-menu');
}

function _elTopicLayoutColumns(dbPath, pivotData) {
  const data = pivotData || state?.pivotData || {};
  const types = typeof getPropertyTypes === 'function' ? getPropertyTypes(dbPath) || {} : {};
  return (Array.isArray(data.properties) ? data.properties : Object.keys(data.properties || {})).map(name => ({
    id: String(types[name]?.property_id || types[name]?.id || types[name]?.columnId || ''), name: String(name),
    type: String(types[name]?.type || 'text'),
    ...(['select', 'multi-select'].includes(types[name]?.type) && Array.isArray(types[name].options)
      ? { options: types[name].options.slice() } : {}),
  }));
}

function _elDownloadTopicLayoutTemplate(context) {
  const layout = _elGetState(context.dbPath)?.layouts.find(item => item.id === context.layoutId);
  if (!layout) return;
  const api = globalThis.MeldexDbTopicLayoutStyle;
  const template = api.exportTemplate(layout, _elTopicLayoutColumns(context.dbPath, context.pivotData));
  const blob = new Blob([JSON.stringify(template, null, 2)], { type: 'application/json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = layout.name.replace(/[\\/:*?"<>|]+/g, '_') + api.TEMPLATE_EXTENSION;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 0);
}

function _elChooseTopicLayoutTemplate(context) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,.meldex-topic-layout.json,application/json';
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      const template = JSON.parse(await file.text());
      let imported = null;
      _elMutateState(context.dbPath, 'トピックレイアウト: 読み込み', file.name, state => {
        imported = globalThis.MeldexDbTopicLayoutStyle.importTemplate(template, state.layouts, _elTopicLayoutColumns(context.dbPath, context.pivotData));
        if (!imported.added) return false;
        state.layouts.push(imported.layout);
        state.tabOrder.push(imported.layout.id);
        state.currentTab = imported.layout.id;
      }, _elRestoreOption(context.grid, context.rerender));
      if (!imported?.added) {
        if (typeof showStatus === 'function') showStatus('同名のトピックレイアウトが既にあります', true);
        return;
      }
      const unresolved = imported.mappings.filter(item => item.match === 'unresolved').length;
      if (typeof showStatus === 'function') showStatus(unresolved ? `読み込みました（未割り当ての列: ${unresolved}件）` : 'トピックレイアウトを読み込みました');
      context.rerender?.();
    } catch (error) {
      if (typeof showStatus === 'function') showStatus('トピックレイアウトを読み込めません: ' + (error?.message || error), true);
    }
  });
  input.click();
}

async function _elSaveTopicLayoutToSharedLibrary(context) {
  const api = globalThis.MeldexDbTopicLayoutStyle;
  const layout = _elGetState(context.dbPath)?.layouts.find(item => item.id === context.layoutId);
  if (!api || !layout) return;
  try {
    const template = api.exportTemplate(layout, _elTopicLayoutColumns(context.dbPath, context.pivotData));
    const result = api.saveSharedTemplateToLibrary
      ? await api.saveSharedTemplateToLibrary(template)
      : api.saveSharedTemplate(template);
    if (typeof showStatus === 'function') {
      const message = !result.saved
        ? '同名の共有テンプレートが既にあります'
        : result.shared === false
          ? '共有先を利用できないため、この端末に保存しました'
          : '共有テンプレートへ保存しました';
      showStatus(message, !result.saved || result.shared === false);
    }
  } catch (error) {
    if (typeof showStatus === 'function') showStatus('共有テンプレートへ保存できません: ' + (error?.message || error), true);
  }
}

async function _elLoadTopicLayoutFromSharedLibrary(context) {
  const api = globalThis.MeldexDbTopicLayoutStyle;
  const library = api?.loadSharedTemplateLibrary
    ? await api.loadSharedTemplateLibrary()
    : { source: 'device-cache', templates: api?.loadSharedTemplates?.() || [] };
  const templates = library.templates || [];
  if (!templates.length) {
    if (typeof showStatus === 'function') showStatus('保存済みの共有テンプレートはありません', true);
    return;
  }
  const choices = templates.map(item => String(item.layout?.name || '')).filter(Boolean);
  const selected = typeof cfPrompt === 'function'
    ? await cfPrompt('読み込む共有テンプレート名', choices[0], { okLabel: '読み込む', description: choices.join(' / ') })
    : choices[0];
  if (selected == null) return;
  const template = templates.find(item => String(item.layout?.name || '') === String(selected).trim());
  if (!template) {
    if (typeof showStatus === 'function') showStatus('指定した共有テンプレートが見つかりません', true);
    return;
  }
  let imported = null;
  _elMutateState(context.dbPath, 'トピックレイアウト: 共有テンプレート読込', template.layout.name, layoutState => {
    imported = api.importTemplate(template, layoutState.layouts, _elTopicLayoutColumns(context.dbPath, context.pivotData));
    if (!imported.added) return false;
    layoutState.layouts.push(imported.layout);
    layoutState.tabOrder.push(imported.layout.id);
    layoutState.currentTab = imported.layout.id;
  }, _elRestoreOption(context.grid, context.rerender));
  if (!imported?.added) {
    if (typeof showStatus === 'function') showStatus('同名のトピックレイアウトが既にあります', true);
    return;
  }
  _elSession(context.grid, context.entityPath).tab = imported.layout.id;
  context.rerender?.();
}

function _elAddPresetLayout(context, template) {
  if (!_elCanMutateGrid(context.grid, context.options)) return;
  const api = globalThis.MeldexDbTopicLayoutStyle;
  let imported;
  _elMutateState(context.dbPath, 'トピックレイアウト: テンプレートから追加', template.layout.name, state => {
    const source = JSON.parse(JSON.stringify(template));
    if (state.layouts.some(item => item.name === source.layout.name)) {
      source.layout.name = _elMakeDuplicateName(source.layout.name, state.layouts);
    }
    imported = api.importTemplate(source, state.layouts, _elTopicLayoutColumns(context.dbPath, context.pivotData));
    if (!imported.added) return false;
    state.layouts.push(imported.layout);
    state.tabOrder.push(imported.layout.id);
    state.currentTab = imported.layout.id;
  }, _elRestoreOption(context.grid, context.rerender));
  if (!imported?.added) return;
  _elSession(context.grid, context.entityPath).tab = imported.layout.id;
  context.rerender?.();
  const missing = imported.mappings.filter(item => item.match === 'unresolved').length;
  if (typeof showStatus === 'function') showStatus(missing ? `追加しました（未割り当ての列: ${missing}件）` : 'テンプレートから追加しました');
}

async function _elShowAddLayoutMenu(anchor, context) {
  if (!_elCanMutateGrid(context.grid, context.options)) return;
  const api = globalThis.MeldexDbTopicLayoutStyle;
  const existing = document.querySelector('.el-preset-popup');
  if (existing) {
    const same = existing._anchor === anchor;
    if (!await existing._requestClose() || same) return;
  }
  if (!api) {
    _elShowActionMenu(anchor, [{ key: 'new', label: '新規に追加', icon: 'plus',
      run: () => _elAddLayout(context.grid, context.entityPath, context.dbPath, context.rerender) }], 'entity-layout-add-menu');
    return;
  }
  _elCloseTabMenus();
  const body = document.createElement('div');
  // 一般メニューの一括remove対象にせず、確認・子ポップアップと未保存ドラフトを自前で管理する。
  body.className = 'el-preset-popup';
  body.dataset.e2eId = 'entity-layout-add-menu';
  body.setAttribute('role', 'dialog');
  body.setAttribute('aria-label', 'トピックレイアウトのテンプレート');
  body.setAttribute('aria-modal', 'false');
  body.tabIndex = -1;
  body._anchor = anchor;
  const addLayout = document.createElement('button'); addLayout.type = 'button';
  addLayout.className = 'el-tab-menu-item'; addLayout.textContent = '新規に追加';
  addLayout.setAttribute('role', 'menuitem'); addLayout.dataset.e2eId = 'entity-layout-tab-menu-new';
  body.appendChild(addLayout);
  const list = document.createElement('div'); list.className = 'el-preset-list';
  list.setAttribute('role', 'menu'); list.setAttribute('aria-label', 'トピックレイアウトのテンプレート');
  body.appendChild(list);
  const actions = document.createElement('div'); actions.className = 'el-preset-actions'; body.appendChild(actions);
  const details = document.createElement('div'); details.className = 'el-preset-details'; details.hidden = true;
  body.appendChild(details);
  const nameRow = document.createElement('label'); nameRow.className = 'el-preset-name-row';
  nameRow.textContent = 'テンプレート名';
  const name = document.createElement('input'); name.type = 'text'; name.setAttribute('aria-label', 'テンプレート名');
  nameRow.appendChild(name); details.appendChild(nameRow);
  const editor = document.createElement('div'); editor.className = 'el-preset-editor'; details.appendChild(editor);
  const message = document.createElement('div'); message.className = 'el-preset-message';
  message.setAttribute('role', 'status'); body.appendChild(message);
  const builtins = globalThis.MeldexDbTopicLayoutPresets?.getTemplates() || [];
  let templates = api.loadSharedTemplates(), previous = null, draft = null, dirty = false, busy = false, closing = false, selectedBuiltin = false;
  let libraryVersion = 0;
  const allTemplates = () => [...builtins, ...templates];
  const report = (text, error = false) => { message.textContent = text; message.dataset.error = String(error); };
  const canEdit = () => _elCanMutateGrid(context.grid, context.options) && context.grid.isConnected && body.isConnected;
  const discard = async () => !dirty || (typeof cfConfirm === 'function' && await cfConfirm('保存していないテンプレートの変更を破棄しますか？'));
  const position = () => {
    if (!body.isConnected || !anchor.isConnected) return;
    if (typeof positionPopup === 'function') positionPopup(body, anchor.getBoundingClientRect(), { gap: 4 });
  };
  const closePopup = () => {
    body._cleanup(); body.remove();
    anchor.setAttribute('aria-expanded', 'false');
    if (typeof focusMeldexDropdownTrigger === 'function') focusMeldexDropdownTrigger(anchor);
    else if (anchor.isConnected) anchor.focus({ preventScroll: true });
  };
  body._requestClose = async () => {
    if (busy || closing) return false;
    closing = true;
    try { if (!await discard()) return false; closePopup(); return true; }
    finally { closing = false; }
  };
  const syncControls = () => {
    name.disabled = busy || !draft;
    body.querySelectorAll('button').forEach(btn => { btn.disabled = busy; });
    save.disabled = busy || !draft || details.hidden;
    remove.disabled = busy || !previous;
    for (const key of ['duplicate', 'export', 'edit'])
      actions.querySelector('[data-e2e-id="entity-layout-preset-' + key + '"]').disabled = busy || !draft;
    actions.querySelector('[data-e2e-id="entity-layout-preset-current"]').disabled = busy || !context.layoutId || context.layoutId === EL_COLUMNS_TAB_ID;
  };
  const render = () => {
    _elCloseEditPopups();
    editor.replaceChildren();
    if (!draft || details.hidden) return;
    const editingDraft = draft;
    _elRenderLayoutBody(editor, context.pivotData, context.entityPath, {
      ...context.options, readOnly: false,
      layoutDraft: { layout: draft.layout, session: { editMode: true }, onChange() {
        if (!busy && draft === editingDraft && canEdit()) dirty = true;
      }, persist(mutator) {
        if (busy || draft !== editingDraft || !canEdit()) return null;
        if (mutator(draft.layout) === false) return null;
        dirty = true; return draft.layout;
      } },
    }, context.dbPath, draft.layout.id, render);
    position();
  };
  const choose = (template, saved = null, edit = true, builtin = false) => {
    selectedBuiltin = builtin;
    previous = saved && !builtin ? JSON.parse(JSON.stringify(saved)) : null;
    draft = JSON.parse(JSON.stringify(template));
    draft.layout = _elNormalizeLayout(draft.layout);
    name.value = draft.layout.name; dirty = !saved;
    details.hidden = !edit; body.classList.toggle('is-editing', edit);
    report(edit ? '配置や書式を編集し、「保存」で確定します。' : 'テンプレートを選ぶとシートに追加します。');
    render(); refresh(); syncControls(); position();
    if (edit) name.focus({ preventScroll: true });
  };
  const editTemplate = (template, builtin) => {
    if (!builtin) { choose(template, template); return; }
    const copy = JSON.parse(JSON.stringify(template));
    copy.layout.name = _elMakeDuplicateName(copy.layout.name, allTemplates().map(item => item.layout));
    choose(copy);
    report('標準テンプレートを複製して編集します。「保存」で追加します。');
  };
  const refresh = () => {
    list.replaceChildren();
    if (!allTemplates().length) {
      const empty = document.createElement('div'); empty.className = 'el-preset-empty';
      empty.textContent = '保存済みテンプレートはありません'; list.appendChild(empty);
    }
    allTemplates().forEach(template => {
      const builtin = builtins.includes(template);
      const row = document.createElement('div'); row.className = 'el-preset-item';
      row.dataset.presetSource = builtin ? 'builtin' : 'user';
      row.classList.toggle('active', builtin
        ? selectedBuiltin && draft?.layout.name === template.layout.name
        : !selectedBuiltin && previous?.layout.name === template.layout.name);
      row.setAttribute('role', 'none');
      const apply = document.createElement('button'); apply.type = 'button'; apply.className = 'el-preset-apply';
      apply.setAttribute('role', 'menuitem'); apply.setAttribute('aria-label', template.layout.name);
      const preview = document.createElement('span'); preview.className = 'el-preset-preview'; preview.setAttribute('aria-hidden', 'true');
      const layout = _elNormalizeLayout(template.layout);
      for (const cell of layout.cells) {
        const block = document.createElement('span'); block.className = 'el-preset-preview-cell';
        block.style.left = (cell.x / layout.canvasSize.w * 100) + '%';
        block.style.top = (cell.y / layout.canvasSize.h * 100) + '%';
        block.style.width = (cell.w / layout.canvasSize.w * 100) + '%';
        block.style.height = (cell.h / layout.canvasSize.h * 100) + '%';
        preview.appendChild(block);
      }
      const label = document.createElement('span'); label.textContent = template.layout.name;
      apply.append(preview, label);
      if (builtin) apply.setAttribute('aria-description', '標準テンプレート');
      apply.addEventListener('click', async () => {
        if (canEdit() && await body._requestClose()) _elAddPresetLayout(context, template);
      });
      const edit = document.createElement('button'); edit.type = 'button'; edit.className = 'gb-btn gb-btn-icon';
      const editLabel = template.layout.name + (builtin ? 'を複製して編集' : 'を編集');
      edit.setAttribute('aria-label', editLabel); edit.title = editLabel;
      edit.innerHTML = typeof lucide === 'function' ? lucide('pencil', 14) : '編集';
      edit.addEventListener('click', async () => { if (!busy && await discard() && canEdit()) editTemplate(template, builtin); });
      row.appendChild(apply);
      if (builtin) {
        const badge = document.createElement('span'); badge.className = 'el-preset-badge'; badge.textContent = '標準';
        row.appendChild(badge);
      }
      row.appendChild(edit); list.appendChild(row);
    });
  };
  const newDraft = () => api.exportTemplate(_elNormalizeLayout({ name: '新しいテンプレート' }), _elTopicLayoutColumns(context.dbPath, context.pivotData));
  const button = (key, label, icon, run) => {
    const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'gb-btn gb-btn-icon';
    btn.innerHTML = typeof lucide === 'function' ? lucide(icon, 16) : label;
    btn.title = label; btn.setAttribute('aria-label', label); btn.dataset.e2eId = 'entity-layout-preset-' + key;
    btn.addEventListener('click', async () => {
      if (busy || (key !== 'close' && !canEdit())) return;
      try { await run(); } catch (error) { report(error?.message || String(error), true); }
    });
    actions.appendChild(btn);
    return btn;
  };
  button('new', '追加', 'plus', async () => { if (await discard() && canEdit()) choose(newDraft()); });
  button('duplicate', '複製', 'copy', async () => {
    if (!draft || !await discard()) return;
    const copy = JSON.parse(JSON.stringify(draft));
    copy.layout.name = _elMakeDuplicateName(name.value, allTemplates().map(item => item.layout));
    choose(copy);
  });
  button('current', '現在のレイアウトから追加', 'layoutTemplate', async () => {
    const layout = _elGetState(context.dbPath)?.layouts.find(item => item.id === context.layoutId);
    if (!layout) { report('先にトピックレイアウトのタブを選んでください', true); return; }
    if (await discard()) choose(api.exportTemplate(layout, _elTopicLayoutColumns(context.dbPath, context.pivotData)));
  });
  button('edit', '選択中のテンプレートを編集', 'pencil', async () => {
    if (draft && selectedBuiltin) { editTemplate(draft, true); return; }
    if (draft) { details.hidden = false; body.classList.add('is-editing'); render(); syncControls(); position(); name.focus(); }
  });
  button('export', 'ファイルに保存', 'download', () => {
    if (!draft) return;
    const template = JSON.parse(JSON.stringify(draft)); template.layout.name = name.value.trim();
    const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob([JSON.stringify(template, null, 2)], { type: 'application/json' }));
    link.download = (template.layout.name || 'テンプレート').replace(/[\\/:*?"<>|]+/g, '_') + api.TEMPLATE_EXTENSION;
    link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 0);
  });
  button('import', 'ファイルから読込', 'upload', () => {
    const input = document.createElement('input'); input.type = 'file'; input.accept = '.json,application/json';
    input.addEventListener('change', async () => {
      try {
        if (!input.files?.[0] || !body.isConnected) return;
        const template = JSON.parse(await input.files[0].text());
        api.importTemplate(template, [], _elTopicLayoutColumns(context.dbPath, context.pivotData));
        if (await discard() && body.isConnected) choose(template);
      } catch (error) { report('読み込めません: ' + (error?.message || error), true); }
    }); input.click();
  });
  const remove = button('delete', '削除', 'trash2', async () => {
    if (!previous || !canEdit() || !await cfConfirm('テンプレート「' + previous.layout.name + '」を削除しますか？')) return;
    if (!canEdit()) return;
    await persist(null);
  });
  remove.classList.add('danger');
  const persist = async template => {
    libraryVersion += 1; // 開いた直後の旧読込結果で、保存後の一覧を巻き戻さない。
    busy = true; editor.inert = true;
    const controls = [...body.querySelectorAll('input, button')];
    controls.forEach(item => { item.disabled = true; });
    try {
      const result = await api.changeSharedTemplateInLibrary(previous, template);
      templates = result.templates;
      if (template) choose(template, template);
      else if (allTemplates().length) {
        const first = allTemplates()[0]; choose(first, first, false, builtins.includes(first));
      }
      else { previous = null; draft = null; dirty = false; name.value = ''; details.hidden = true; body.classList.remove('is-editing'); render(); }
      refresh(); report(template
        ? (result.shared ? 'テンプレートを保存しました。' : 'この端末にテンプレートを保存しました。')
        : (result.shared ? 'テンプレートを削除しました。' : 'この端末のテンプレートを削除しました。'));
    } finally {
      busy = false; editor.inert = false; controls.forEach(item => { item.disabled = false; });
      syncControls();
    }
  };
  const save = button('save', '保存', 'save', async () => {
    if (!draft || !canEdit()) return;
    const template = JSON.parse(JSON.stringify(draft));
    template.layout.name = name.value.trim();
    if (!template.layout.name) { report('テンプレート名を入力してください', true); name.focus(); return; }
    await persist(template);
  });
  remove.before(save);
  const close = button('close', '閉じる', 'x', () => body._requestClose());
  close.classList.add('el-preset-close');
  name.addEventListener('input', () => { dirty = true; });
  addLayout.addEventListener('click', async () => {
    if (canEdit() && await body._requestClose()) _elAddLayout(context.grid, context.entityPath, context.dbPath, context.rerender);
  });
  const childPopupSelector = '.el-edit-popup, .gb-palette, .gb-palette-popup, [aria-modal="true"], dialog[open]';
  const insideChildPopup = target => !!target?.closest?.(childPopupSelector);
  const onPointerDown = event => {
    if (!body.contains(event.target) && !anchor.contains(event.target) && !insideChildPopup(event.target)) body._requestClose();
  };
  const onKeyDown = event => {
    const childOpen = [...document.querySelectorAll(childPopupSelector)]
      .some(popup => popup.getClientRects().length > 0);
    if (insideChildPopup(event.target) || childOpen) return;
    // 見出しのインライン編集は、その入力自身にEscapeの取消を任せる。
    if (event.isComposing || event.keyCode === 229 || event.target?.closest?.('.el-label-input')) return;
    if (event.key === 'Escape') {
      event.preventDefault(); event.stopPropagation(); body._requestClose();
    }
    if ((list.contains(event.target) || event.target === addLayout) && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      const buttons = [addLayout, ...list.querySelectorAll('button:not(:disabled)')];
      const index = buttons.indexOf(document.activeElement);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
        : (index + (event.key === 'ArrowUp' ? -1 : 1) + buttons.length) % buttons.length;
      buttons[next]?.focus();
    }
  };
  body._cleanup = () => {
    document.removeEventListener('pointerdown', onPointerDown);
    document.removeEventListener('keydown', onKeyDown, true);
    window.removeEventListener('resize', position);
    _elCloseEditPopups();
  };
  document.body.appendChild(body);
  anchor.setAttribute('aria-expanded', 'true');
  document.addEventListener('pointerdown', onPointerDown);
  document.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('resize', position);
  // 標準と端末キャッシュはすぐ使える。共有先の読込で操作や閉じるボタンを塞がない。
  refresh();
  if (allTemplates().length) {
    const first = allTemplates()[0]; choose(first, first, false, builtins.includes(first));
  } else { report('テンプレートを読み込んでいます…'); }
  syncControls(); position(); addLayout.focus({ preventScroll: true });
  const initialLibraryVersion = libraryVersion;
  try {
    const library = await api.loadSharedTemplateLibrary();
    if (!body.isConnected || libraryVersion !== initialLibraryVersion) return;
    templates = library.templates; refresh();
    if (!draft && allTemplates().length) {
      const first = allTemplates()[0]; choose(first, first, false, builtins.includes(first));
    }
    else if (!draft) { report('保存済みテンプレートはありません。「追加」から作成できます。'); }
    if (library.error) report('共有先を読み込めませんでした。標準とこの端末のテンプレートを表示しています。', true);
  } catch (error) { report('テンプレートを読み込めません: ' + (error?.message || error), true); }
  finally { syncControls(); position(); }
}

function _elShowActionMenu(anchorBtn, items, menuE2eId) {
  _elCloseTabMenus();
  const menu = document.createElement('div');
  menu.className = 'gb-context-menu el-tab-menu';
  menu.dataset.e2eId = menuE2eId;
  menu.setAttribute('role', 'menu');
  menu._setItems = entries => {
    const focusedKey = menu.contains(document.activeElement) ? document.activeElement.dataset.e2eId : '';
    menu.replaceChildren(); entries.forEach(item => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'el-tab-menu-item' + (item.danger ? ' danger' : '');
    btn.dataset.e2eId = 'entity-layout-tab-menu-' + item.key;
    btn.setAttribute('role', 'menuitem');
    btn.innerHTML = typeof lucide === 'function' ? lucide(item.icon, 14) : '';
    const label = document.createElement('span'); label.textContent = item.label; btn.appendChild(label);
    btn.addEventListener('click', () => {
      close();
      item.run();
    });
    menu.appendChild(btn);
    });
    if (focusedKey) Array.from(menu.querySelectorAll('button')).find(btn => btn.dataset.e2eId === focusedKey)?.focus({ preventScroll: true });
  };
  menu._setItems(items);
  document.body.appendChild(menu);
  const cleanupFns = [];
  anchorBtn.setAttribute('aria-expanded', 'true');
  menu._cleanup = () => {
    anchorBtn.setAttribute('aria-expanded', 'false');
    cleanupFns.splice(0).forEach(off => off());
  };
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
    if (!menu.isConnected) return;
    const onPointerDown = (ev) => {
      if (!menu.contains(ev.target) && ev.target !== anchorBtn && !anchorBtn.contains(ev.target)) close();
    };
    const onKeyDown = (ev) => {
      if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); close(); }
      if (menu.contains(ev.target) && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(ev.key)) {
        ev.preventDefault(); ev.stopPropagation();
        const buttons = Array.from(menu.querySelectorAll('button'));
        const i = buttons.indexOf(document.activeElement);
        const next = ev.key === 'Home' ? 0 : ev.key === 'End' ? buttons.length - 1
          : (i + (ev.key === 'ArrowUp' ? -1 : 1) + buttons.length) % buttons.length;
        buttons[next]?.focus({ preventScroll: true });
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown, true);
    cleanupFns.push(() => document.removeEventListener('pointerdown', onPointerDown));
    cleanupFns.push(() => document.removeEventListener('keydown', onKeyDown, true));
  }, 0);
  requestAnimationFrame(() => { try { menu.querySelector('button')?.focus({ preventScroll: true }); } catch { /* ignore */ } });
  return menu;
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
  tabs.setAttribute('aria-label', 'トピックの表示切替');
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
    addBtn.className = 'el-tab-add gb-btn gb-btn-icon';
    addBtn.dataset.e2eId = 'entity-layout-add';
    addBtn.title = 'トピックレイアウトを追加';
    addBtn.setAttribute('aria-label', 'トピックレイアウトを追加');
    addBtn.setAttribute('aria-haspopup', 'dialog');
    addBtn.innerHTML = typeof lucide === 'function' ? lucide('plus', 14) : '+';
    addBtn.addEventListener('click', () => {
      _elShowAddLayoutMenu(addBtn, { grid, entityPath, dbPath, rerender, pivotData: data, layoutId: activeTab, options });
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
    exportBtn.className = 'el-export-btn gb-btn gb-btn-icon';
    exportBtn.dataset.e2eId = 'entity-layout-export-btn';
    exportBtn.title = 'レイアウトを書き出し';
    exportBtn.setAttribute('aria-label', 'レイアウトを書き出し');
    exportBtn.setAttribute('aria-haspopup', 'menu');
    exportBtn.innerHTML = typeof lucide === 'function' ? lucide('download', 14) : '↓';
    exportBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      _elShowExportMenu(exportBtn, grid, { grid, entityPath, dbPath, layoutId: activeTab, rerender, pivotData: data });
    });
    actions.appendChild(exportBtn);

    const editBtn = document.createElement('button');
    if (readOnly) session.editMode = false;
    editBtn.type = 'button';
    editBtn.className = 'el-edit-toggle gb-btn gb-btn-icon' + (session.editMode ? ' active' : '');
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
    menuBtn.className = 'el-tab-menu-btn gb-btn gb-btn-icon';
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
      // 設定保存による再描画が同じフレームに重なっても、退避した旧タブへ
      // フォーカスしない。別エントリ・別タブへ進んだ予約も破棄する。
      if (!grid.isConnected || _elSessionByGrid.get(grid) !== session || session.tab !== focusTabId) return;
      const focusTab = Array.from(grid.querySelectorAll(':scope > .el-tabbar .el-tabs > .el-tab'))
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
