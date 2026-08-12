/* プロパティ管理・モーダル・表示設定 — gb-database.js から分離 */

// プロパティタイプ → Lucideアイコン名マッピング
const PROP_TYPE_ICON = {
  text: 'alignLeft',
  furigana: 'superscript',
  number: 'hash',
  select: 'layoutList',
  'multi-select': 'layoutList',
  'common-tags': 'tags',
  checkbox: 'checkSquare',
  color: 'palette',
  date: 'calendar',
  url: 'externalLink', // 旧type:urlの読込互換
  link: 'externalLink',
  image: 'image',
  relation: 'link2',
  'multi-relation': 'link2',
  user: 'user',
  'multi-user': 'users',
  formula: 'sigma',
  rollup: 'workflow',
  button: 'play',
  'multi-source-relation': 'database',
  chat: 'messagesSquare',
};

/* pivot 同期・relation キャッシュ helper は gb-db-pivot-sync.js が単一実装。 */

/* ==============================
   モーダル: 新規エントリ追加
   ============================== */
// エントリ作成テンプレート管理
function getEntityTemplates(dbPath) {
  const fid = _pathToFileId(dbPath);
  if (fid) { try { const v = localStorage.getItem('entityTemplates:' + fid); if (v) return JSON.parse(v); } catch {} }
  try { return JSON.parse(localStorage.getItem('entityTemplates:' + (dbPath || ''))) || []; } catch { return []; }
}
function saveEntityTemplates(dbPath, templates) {
  const fid = _pathToFileId(dbPath);
  localStorage.setItem('entityTemplates:' + (fid || dbPath || ''), JSON.stringify(templates));
}

/* ==============================
   カラムヘッダーコンテキストメニュー
   ============================== */
function closeColHeaderMenu() {
  document.querySelectorAll('.gb-context-menu').forEach(el => el.remove());
  const cleanup = closeColHeaderMenu._dismissCleanup;
  delete closeColHeaderMenu._dismissCleanup;
  if (typeof cleanup === 'function') cleanup();
}

function _installColHeaderMenuDismissHandlers() {
  setTimeout(() => {
    if (!document.querySelector('.gb-context-menu')) return;
    const cleanup = () => {
      document.removeEventListener('pointerdown', pointerCloser);
      document.removeEventListener('keydown', keyCloser);
      if (closeColHeaderMenu._dismissCleanup === cleanup) delete closeColHeaderMenu._dismissCleanup;
    };
    const pointerCloser = event => {
      const inAny = [...document.querySelectorAll('.gb-context-menu')].some(menu => menu.contains(event.target));
      if (inAny) return;
      closeColHeaderMenu();
      cleanup();
    };
    const keyCloser = event => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      closeColHeaderMenu();
      cleanup();
    };
    document.addEventListener('pointerdown', pointerCloser);
    document.addEventListener('keydown', keyCloser);
    if (typeof closeColHeaderMenu._dismissCleanup === 'function') closeColHeaderMenu._dismissCleanup();
    closeColHeaderMenu._dismissCleanup = cleanup;
  }, 0);
}

// メニュー上部にリネーム入力欄を挿入する共通ヘルパー
// onRename(newValue) は newValue !== currentValue かつ非空のときだけ呼ばれる
function _addMenuRenameInput(menu, currentValue, onRename, opts) {
  const placeholder = (opts && opts.placeholder) || '名前を変更...';
  const wrap = document.createElement('div');
  wrap.className = 'gb-menu-rename-row';
  const inp = document.createElement('input');
  inp.type = 'text';
  inp.value = currentValue || '';
  inp.placeholder = placeholder;
  inp.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') {
      e.preventDefault();
      const newVal = inp.value.trim();
      if (typeof closeColHeaderMenu === 'function') closeColHeaderMenu();
      menu.remove();
      if (newVal && newVal !== currentValue) onRename(newVal);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      if (typeof closeColHeaderMenu === 'function') closeColHeaderMenu();
      menu.remove();
    }
  });
  // クリックでメニューが閉じないようイベント伝播をストップ
  wrap.addEventListener('pointerdown', (e) => e.stopPropagation());
  wrap.addEventListener('click', (e) => e.stopPropagation());
  wrap.appendChild(inp);
  menu.insertBefore(wrap, menu.firstChild);
  if (opts && opts.autoFocus === true) {
    setTimeout(() => { inp.focus(); }, 0);
  }
  return inp;
}

function _renderColMenuItems(container, itemList) {
  itemList.forEach(item => {
    if (item.type === 'sep') {
      const sep = document.createElement('div');
      sep.className = 'gb-context-menu-sep';
      container.appendChild(sep);
      return;
    }
    if (item.type === 'custom') {
      // 任意DOM（例: 折り返し設定サブメニューの最大行数入力）。build() が要素を返す。
      const el = typeof item.build === 'function' ? item.build() : item.el;
      if (el) container.appendChild(el);
      return;
    }
    if (item.type === 'submenu') {
      const wrapper = document.createElement('div');
      const el = document.createElement('div');
      el.className = 'gb-context-menu-item';
      if (item.e2eId) el.dataset.e2eId = item.e2eId;
      el.innerHTML = item.label + submenuArrow();
      const sub = document.createElement('div');
      sub.className = 'gb-context-menu gb-context-submenu';
      sub.style.display = 'none';
      _renderColMenuItems(sub, item.children);
      attachHoverSubmenu(el, sub);
      wrapper.appendChild(el);
      wrapper.appendChild(sub);
      container.appendChild(wrapper);
      return;
    }
    const el = document.createElement('div');
    el.className = 'gb-context-menu-item';
    if (item.e2eId) el.dataset.e2eId = item.e2eId;
    el.innerHTML = item.label;
    if (item.disabled) {
      el.classList.add('disabled');
      el.setAttribute('aria-disabled', 'true');
    }
    if (item.danger) el.classList.add('danger');
    if (item.action && !item.disabled) el.addEventListener('click', (ev) => { ev.stopPropagation(); closeColHeaderMenu(); item.action(ev, el); });
    container.appendChild(el);
  });
}

function _dbOrderedPropertyNamesForMenu(dbPath, ctx) {
  const pivotData = (typeof _dbPivotDataForContext === 'function' ? _dbPivotDataForContext(ctx) : null)
    || ctx?.pivotData
    || state.pivotData
    || {};
  const allProps = Array.isArray(pivotData.properties) ? pivotData.properties : [];
  const propTypes = typeof getPropertyTypes === 'function' ? (getPropertyTypes(dbPath, ctx) || {}) : {};
  const colOrder = typeof getColOrder === 'function' ? (getColOrder(dbPath, { ctx }) || []) : [];
  const ordered = [];
  const add = (name) => {
    const prop = String(name || '').trim();
    if (typeof isDbPropertyDeleted === 'function' && isDbPropertyDeleted(dbPath, prop)) return;
    if (!prop || ordered.includes(prop)) return;
    ordered.push(prop);
  };
  colOrder.forEach(add);
  allProps.forEach(add);
  Object.keys(propTypes).forEach(add);
  return ordered;
}

function _refreshDbColumnMenuView(ctx, dbPath) {
  if (typeof _renderCurrentDbView === 'function') _renderCurrentDbView(ctx, dbPath);
  else if (typeof renderPivot === 'function') renderPivot(ctx);
}

function _dbRenderedColumnTokensForPinning(ctx, dbPath, eventTarget) {
  const table = eventTarget?.closest?.('table')
    || (ctx?.containerEl && ctx.containerEl.querySelector?.(`#${CSS.escape(ctx.tableId || 'pivot-table')}`))
    || document.getElementById(ctx?.tableId || 'pivot-table');
  const domTokens = table
    ? [...table.querySelectorAll('thead th[data-db-col-token]')]
      .map(cell => cell.dataset.dbColToken)
      .filter(Boolean)
    : [];
  if (domTokens.length) return [...new Set(domTokens)];

  const hidden = new Set(typeof getHiddenCols === 'function' ? (getHiddenCols(dbPath, { ctx }) || []) : []);
  const configuredOrder = typeof getColOrder === 'function' ? (getColOrder(dbPath, { ctx }) || []) : [];
  const visibleProps = _dbOrderedPropertyNamesForMenu(dbPath, ctx).filter(propName => !hidden.has(propName));
  const tokens = configuredOrder.includes('__entity__')
    ? configuredOrder.filter(token => token === '__entity__' || visibleProps.includes(token))
    : ['__entity__'];
  if (!tokens.includes('__entity__')) tokens.unshift('__entity__');
  visibleProps.forEach(propName => {
    if (!tokens.includes(propName)) tokens.push(propName);
  });
  return [...new Set(tokens)];
}

function _dbPinnedRangeForMenu(ctx, dbPath, eventTarget) {
  const renderedCols = _dbRenderedColumnTokensForPinning(ctx, dbPath, eventTarget);
  const pinnedCols = typeof getPinnedCols === 'function' ? getPinnedCols(dbPath, { ctx }) : [];
  const entityPinned = typeof getEntityColumnPinned === 'function'
    ? getEntityColumnPinned(dbPath, { ctx })
    : true;
  const state = typeof getPinnedColumnRangeState === 'function'
    ? getPinnedColumnRangeState(renderedCols, pinnedCols, entityPinned)
    : {
      pinnedTokens: renderedCols.filter(token => token === '__entity__' ? entityPinned : pinnedCols.includes(token)),
      pinnedCols,
      entityColumnPinned: entityPinned,
    };
  return { renderedCols, ...state };
}

function _dbSetPinnedRangeFromMenu(ctx, dbPath, renderedCols, boundaryToken, on) {
  if (typeof setPinnedColumnRange === 'function') {
    setPinnedColumnRange(dbPath, renderedCols, boundaryToken, on, {
      ctx,
      detail: boundaryToken === '__entity__' ? 'エントリ名' : boundaryToken,
    });
  }
  _refreshDbColumnMenuView(ctx, dbPath);
}

function _makeHiddenColumnMenuItems(dbPath, ctx) {
  const hiddenCols = typeof getHiddenCols === 'function' ? (getHiddenCols(dbPath, { ctx }) || []) : [];
  const hiddenOrdered = _dbOrderedPropertyNamesForMenu(dbPath, ctx).filter(propName => hiddenCols.includes(propName));
  hiddenCols.forEach(propName => { if (!hiddenOrdered.includes(propName)) hiddenOrdered.push(propName); });
  if (!hiddenOrdered.length) return [{ label: '非表示の列はありません', disabled: true }];
  const showOne = (propName) => {
    const current = getHiddenCols(dbPath, { ctx }) || [];
    setHiddenCols(dbPath, current.filter(name => name !== propName), { ctx, detail: propName });
    _refreshDbColumnMenuView(ctx, dbPath);
  };
  return [
    ...hiddenOrdered.map(propName => ({
      label: lucide('eye', 14) + ' 表示: ' + esc(propName),
      action: () => showOne(propName),
    })),
    { type: 'sep' },
    {
      label: lucide('eye', 14) + ' すべて表示',
      action: () => {
        setHiddenCols(dbPath, [], { ctx, detail: 'すべて表示' });
        _refreshDbColumnMenuView(ctx, dbPath);
      },
    },
  ];
}

function _getDbSortConfigForView(dbPath, ctx) {
  return (typeof getDbSortConfig === 'function' ? getDbSortConfig(dbPath, { ctx }) : getDbViewConfig(dbPath).sortConfig)
    || { key: 'name', dir: 'asc' };
}

function _applyDbSortConfigForView(dbPath, sortConfig, detail, ctx) {
  const pivotData = ctx?.pivotData
    || ((typeof _ptIsCurrentDbPath === 'function' && _ptIsCurrentDbPath(dbPath)) ? state.pivotData : null);
  const existingManualOrder = typeof getDbManualOrder === 'function'
    ? getDbManualOrder(dbPath, { ctx })
    : getDbViewConfig(dbPath).manualOrder;
  if (sortConfig?.key === 'manual' && !Array.isArray(existingManualOrder) && typeof setDbManualOrder === 'function') {
    const order = typeof _getEntityOrderSnapshot === 'function'
      ? _getEntityOrderSnapshot(ctx, dbPath, pivotData?.entities || {})
      : Object.keys(pivotData?.entities || {});
    setDbManualOrder(dbPath, order, sortConfig, { label: 'シート表示: 並び替え', detail, ctx });
  } else if (typeof setDbSortConfig === 'function') {
    setDbSortConfig(dbPath, sortConfig, { detail, ctx });
  } else {
    const c = getDbViewConfig(dbPath);
    c.sortConfig = { ...sortConfig };
    if (sortConfig?.key === 'manual' && !Array.isArray(c.manualOrder)) {
      c.manualOrder = Object.keys(pivotData?.entities || {});
    }
    saveDbViewConfig(dbPath, c, { historyLabel: 'シート表示: 並び替え', historyDetail: detail || '', ctx });
  }
  if (typeof _renderCurrentDbView === 'function') _renderCurrentDbView(ctx, dbPath);
  else renderPivot(ctx);
}

function _makeDbGlobalSortMenuItems(dbPath, ctx) {
  const sc = _getDbSortConfigForView(dbPath, ctx);
  const pivotData = ctx?.pivotData
    || ((typeof _ptIsCurrentDbPath === 'function' && _ptIsCurrentDbPath(dbPath)) ? state.pivotData : null);
  const items = [
    { label: (sc.key === 'name' && sc.dir === 'asc' ? radioMark(true) : '　') + '名前 昇順', action: () => _applyDbSortConfigForView(dbPath, { key: 'name', dir: 'asc' }, '名前 昇順', ctx) },
    { label: (sc.key === 'name' && sc.dir === 'desc' ? radioMark(true) : '　') + '名前 降順', action: () => _applyDbSortConfigForView(dbPath, { key: 'name', dir: 'desc' }, '名前 降順', ctx) },
    { label: (sc.key === 'manual' ? radioMark(true) : '　') + 'マニュアル', action: () => _applyDbSortConfigForView(dbPath, { key: 'manual', dir: 'asc' }, 'マニュアル', ctx) },
  ];
  if (pivotData?.properties?.length) {
    items.push({ type: 'sep' });
    pivotData.properties.forEach(p => {
      items.push({
        type: 'submenu',
        label: (sc.key === p ? radioMark(true) : '　') + esc(p),
        children: [
          { label: (sc.key === p && sc.dir === 'asc' ? radioMark(true) : '　') + '昇順', action: () => _applyDbSortConfigForView(dbPath, { key: p, dir: 'asc' }, p + ' 昇順', ctx) },
          { label: (sc.key === p && sc.dir === 'desc' ? radioMark(true) : '　') + '降順', action: () => _applyDbSortConfigForView(dbPath, { key: p, dir: 'desc' }, p + ' 降順', ctx) },
        ],
      });
    });
  }
  return items;
}

function showDbSortMenu(e, ctxOverride, dbPathOverride) {
  closeColHeaderMenu();
  const ctx = ctxOverride || (typeof _dbPaneContextFromEvent === 'function'
    ? _dbPaneContextFromEvent(e?.target || e?.currentTarget, { dbPath: dbPathOverride || state.currentDbPath })
    : null);
  closeAllDropdowns(ctx || e?.target || e?.currentTarget);
  const dbPath = dbPathOverride || ctx?.dbPath || state.currentDbPath;
  if (!dbPath) return;
  const menu = document.createElement('div');
  menu.className = 'gb-context-menu';
  _renderColMenuItems(menu, _makeDbGlobalSortMenuItems(dbPath, ctx));
  document.body.appendChild(menu);
  const rect = e?.currentTarget?.getBoundingClientRect?.() || e?.target?.getBoundingClientRect?.();
  if (rect) positionPopup(menu, { left: rect.left, right: rect.right, top: rect.bottom, bottom: rect.bottom });
  else positionPopup(menu, { left: e?.clientX || 0, right: e?.clientX || 0, top: e?.clientY || 0, bottom: e?.clientY || 0 });
  setTimeout(() => {
    const closer = (ev) => {
      const inAny = [...document.querySelectorAll('.gb-context-menu')].some(m => m.contains(ev.target));
      if (!inAny) { closeColHeaderMenu(); document.removeEventListener('pointerdown', closer); }
    };
    document.addEventListener('pointerdown', closer);
  }, 0);
}

// 日時タイプ選択時のサブメニュー項目（通常/作成日時/更新日時）。
// 「列タイプ選択ポップアップ（＋ボタン）」と「左/右に列を挿入」の date 項目から共有する。
function _makeDateColumnMenuChildren(refProp, direction, ctxOrDbPath) {
  const variants = [
    { label: '日時', initialName: '日時', cfg: { type: 'date' } },
    { label: '作成日時', initialName: '作成日時', cfg: { type: 'date', source: 'created' } },
    { label: '更新日時', initialName: '更新日時', cfg: { type: 'date', source: 'modified' } },
  ];
  return variants.map(v => ({
    label: v.label,
    action: () => {
      if (typeof insertPropertyInline === 'function') {
        insertPropertyInline(refProp, direction, ctxOrDbPath, { ...v.cfg, initialName: v.initialName });
      }
    },
  }));
}

// 「左/右に列を挿入」および「列タイプ選択ポップアップ（＋ボタン）」共通の子項目（列タイプ一覧）。
// 選んだ列タイプでその側に列を挿入する。relation/rollup/formula 等は空で作られ、
// 挿入直後のインラインリネーム後に「列タイプの設定...」で詳細設定する（型変更メニューと同じ流儀）。
// date のみ、通常/作成日時/更新日時を選べるサブメニューを展開する（attachHoverSubmenu、_renderColMenuItems 経由）。
// refProp が現在の列順に存在しない場合（例: null）は末尾に追加される（insertPropertyInline の仕様）。
function _makeInsertColumnTypeChildren(refProp, direction, ctxOrDbPath) {
  const typeItems = typeof getPropertyTypeMenuItems === 'function' ? getPropertyTypeMenuItems() : [];
  return typeItems.map(ti => {
    if (ti.type === 'date') {
      return {
        type: 'submenu',
        label: lucide(ti.icon, 14) + ' ' + ti.label,
        children: _makeDateColumnMenuChildren(refProp, direction, ctxOrDbPath),
      };
    }
    const cfg = ti.type === 'image'
      ? { type: 'image', initialName: ti.label, options: { max_count: null, accept: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'], thumbnail_size: 256 } }
      : { type: ti.type, initialName: ti.label };
    return {
      label: lucide(ti.icon, 14) + ' ' + ti.label,
      action: () => {
        if (typeof insertPropertyInline === 'function') insertPropertyInline(refProp, direction, ctxOrDbPath, cfg);
      },
    };
  });
}

// ctxOverride/dbPathOverride: 呼び出し側（例: gb-db-table.part03.js の列ヘッダ描画クロージャ）
// が、その列ヘッダを実際に描画した ctx/dbPath を直接渡すためのオプション引数。
// _dbPaneContextFromEvent() は `.closest('.gb-pane[data-pane-id]')` によるDOM祖先探索と
// グローバル _panes レジストリ参照でペインを特定するため、埋め込みシート
// （gb-tool-calendar-production-sheet-embed.js。意図的にそのレジストリへ未登録）から
// 開いたメニューでは常に解決に失敗し、グローバルの「現在アクティブなペイン」（メイン画面側の
// 別シート、または何も開いていなければ null）へフォールバックしてしまう（2026-07-15
// フェーズD1で確認）。override を渡せば、この不正確な再解決を経由せず「実際にこの列ヘッダを
// 描画したペイン」を使えるため、列メニューの全操作（並び替え・グループ化・列固定・非表示・
// 型変更・削除・リネーム）が埋め込みシート自身を正しく対象にする。
function showColHeaderMenu(e, propName, colIndex, ctxOverride, dbPathOverride, menuOptions = {}) {
  closeColHeaderMenu();
  const ctx = ctxOverride || (typeof _dbPaneContextFromEvent === 'function'
    ? _dbPaneContextFromEvent(e?.target || e?.currentTarget, { dbPath: dbPathOverride || state.currentDbPath })
    : null);
  closeAllDropdowns(ctx || e?.target || e?.currentTarget);
  const dbPath = dbPathOverride || ctx?.dbPath || state.currentDbPath;
  const productionSchemaLocked = typeof isProductionManagementSheetPath === 'function'
    && isProductionManagementSheetPath(dbPath);
  const productionWriteBlocked = typeof isProductionManagementWriteBlocked === 'function'
    && isProductionManagementWriteBlocked(dbPath, ctx);
  const pinnedRange = _dbPinnedRangeForMenu(ctx, dbPath, e?.target || e?.currentTarget);
  const pinnedCols = pinnedRange.pinnedCols;
  const groupBy = getGroupBy(dbPath, ctx);

  const menu = document.createElement('div');
  menu.className = 'gb-context-menu';
  // 上部にリネーム入力欄: 列名変更（startHeaderInlineRename と同じロジック）
  if (!productionSchemaLocked) {
    _addMenuRenameInput(menu, propName, async (newName) => {
      if (typeof renameDbProperty === 'function') {
        await renameDbProperty(dbPath, propName, newName, ctx);
      }
      // 列選択状態の追従（選択列がリネームされた場合）
      if (typeof _getSelectedColumns === 'function' && typeof _setSelectedColumns === 'function') {
        const selected = _getSelectedColumns(dbPath).map(name => name === propName ? newName : name);
        _setSelectedColumns(dbPath, selected, newName);
      }
      _refreshDbColumnMenuView(ctx, dbPath);
    }, { placeholder: '列名を変更...' });
  }

  const currentPtc = getPropertyTypes(dbPath, ctx)[propName] || { type: 'text' };
  const currentType = currentPtc.type || 'text';
  const currentUiType = typeof getPropertyTypeUiBaseType === 'function' ? getPropertyTypeUiBaseType(currentType) : currentType;
  const colDisplayOverride = typeof getDbColumnCellDisplay === 'function'
    ? getDbColumnCellDisplay(dbPath, propName, ctx)
    : null;
  const columnFilterActive = typeof isDbColumnFilterActive === 'function'
    && isDbColumnFilterActive(dbPath, propName, ctx);

  // プロパティ型サブメニュー項目
  const typeItems = getPropertyTypeMenuItems();

  const items = [
    // プロパティ型（サブメニュー展開）— 選択時は型のみ変更、設定モーダルは開かない
    { type: 'submenu', label: lucide(getPropertyTypeIcon(currentType) || PROP_TYPE_ICON[currentType] || 'alignLeft', 14) + ' 列タイプの変更',
      children: typeItems.map(ti => ({
        label: (ti.type === currentUiType ? radioMark(true) : '\u3000') + lucide(ti.icon, 14) + ' ' + ti.label,
        action: async () => {
          if (ti.type === currentUiType && currentType === currentUiType) return;
          if (currentType === 'image' && ti.type !== 'image') {
            const ok = await (typeof cfConfirm === 'function'
              ? cfConfirm(`画像列「${propName}」を「${ti.label}」に変更します。\n\n画像ファイルは自動削除しませんが、この列では画像として表示されなくなります。\n\n続行しますか？`)
              : Promise.resolve(window.confirm(`画像列「${propName}」を「${ti.label}」に変更しますか？`)));
            if (!ok) return;
          }
          let opts = undefined;
          if (ti.type === 'select' || ti.type === 'multi-select') {
            const existingValues = new Set();
            const pivotData = ctx?.pivotData || state.pivotData;
            if (pivotData?.entities) {
              Object.values(pivotData.entities).forEach(ent => {
                (ent[propName] || []).forEach(v => existingValues.add(v.value));
              });
            }
            opts = [...existingValues];
          }
          const cfg = { type: ti.type };
          if (opts) cfg.options = opts;
          if (ti.type === 'number' && currentPtc.unit) cfg.unit = currentPtc.unit;
          if (ti.type === 'image') cfg.options = { max_count: null, accept: ['png','jpg','jpeg','gif','webp','svg'], thumbnail_size: 256 };
          const beforeCfg = JSON.parse(JSON.stringify((getPropertyTypes(dbPath) || {})[propName] || {}));
          const savePromise = setPropertyType(dbPath, propName, cfg, ctx);
          if (currentType === 'image' && ti.type !== 'image') {
            Promise.resolve(savePromise).then(() => apiPost('/media/rebuild-refs', {})).catch(() => {});
          }
          _refreshDbColumnMenuView(ctx, dbPath);
          // Undo/Redo: クイック型切替も履歴へ積む（型が実際に変わった時のみ。ヘルパー側でゲート）
          if (typeof _ptPushTypeChangeHistory === 'function') _ptPushTypeChangeHistory(dbPath, propName, beforeCfg, cfg, ctx);
        }
      }))
    },
    // プロパティ型の設定（relation先DB・数式・ボタン等の詳細設定）
    { label: lucide('settings', 14) + ' 列タイプの設定...', action: () => showPropertyTypeModal(propName, dbPath, ctx) },
    { type: 'sep' },
    // 左/右に列を挿入（トップレベル。各サブメニューで挿入する列タイプを選ぶ）
    ...(!productionWriteBlocked ? [
      ...(!menuOptions.protectLeftEdge
        ? [{ type: 'submenu', label: '← 左に列を挿入', children: _makeInsertColumnTypeChildren(propName, 'left', ctx || dbPath) }]
        : []),
      { type: 'submenu', label: '→ 右に列を挿入', children: _makeInsertColumnTypeChildren(propName, 'right', ctx || dbPath) },
      { type: 'sep' },
    ] : []),
    {
      label: lucide('filter', 14) + ' この列をフィルター...' + (columnFilterActive ? '（適用中）' : ''),
      action: () => {
        if (typeof showDbColumnFilterPopup === 'function') showDbColumnFilterPopup(e, propName, ctx, dbPath);
      },
    },
    // 並び替え（この列を基準に）
    { type: 'submenu', label: lucide('arrowUpDown', 14) + ' 並び替え', children: (() => {
      const sc = menuOptions.includeManualSort && typeof getDbSortConfig === 'function'
        ? (getDbSortConfig(dbPath, { ctx }) || { key: 'manual', dir: 'asc' })
        : _getDbSortConfigForView(dbPath, ctx);
      return [
        { label: (sc.key === propName && sc.dir === 'asc' ? radioMark(true) : '　') + 'この列で昇順', action: () => _applyDbSortConfigForView(dbPath, { key: propName, dir: 'asc' }, propName + ' 昇順', ctx) },
        { label: (sc.key === propName && sc.dir === 'desc' ? radioMark(true) : '　') + 'この列で降順', action: () => _applyDbSortConfigForView(dbPath, { key: propName, dir: 'desc' }, propName + ' 降順', ctx) },
        ...(menuOptions.includeManualSort ? [
          { type: 'sep' },
          {
            label: (sc.key === 'manual' || !sc.key ? radioMark(true) : '　') + '階層の並び順',
            action: () => _applyDbSortConfigForView(dbPath, { key: 'manual', dir: 'asc' }, '階層の並び順', ctx),
          },
        ] : []),
      ];
    })() },
    ...(!menuOptions.omitGroupBy ? [{ type: 'submenu', label: 'この列でグループ化', children: [
      { label: (groupBy === propName ? radioMark(true) : '　') + 'グループ化する', action: () => { setGroupBy(dbPath, propName, { ctx }); renderPivot(ctx); }},
      { label: (groupBy !== propName ? radioMark(true) : '　') + 'グループ化しない', action: () => { setGroupBy(dbPath, null, { ctx }); renderPivot(ctx); }},
    ]}] : []),
    { type: 'sep' },
    // 列操作サブメニュー
    { type: 'submenu', label: lucide('columns', 14) + ' 列操作',
      children: [
        { label: lucide('ruler', 14) + ' 列幅を数値指定...', action: () => _showBulkColumnWidthModal(propName, ctx || dbPath) },
        // 「列の表示と順序...」はツールバーへ移設（2026-07-19 ユーザー指示）
        { type: 'submenu', label: '列を固定', children: [
          { label: (pinnedCols.includes(propName) ? radioMark(true) : '　') + '固定する', action: () => {
            if (!pinnedCols.includes(propName)) {
              _dbSetPinnedRangeFromMenu(ctx, dbPath, pinnedRange.renderedCols, propName, true);
            }
          }},
          { label: (!pinnedCols.includes(propName) ? radioMark(true) : '　') + '固定しない', action: () => {
            if (pinnedCols.includes(propName)) {
              _dbSetPinnedRangeFromMenu(ctx, dbPath, pinnedRange.renderedCols, propName, false);
            }
          }},
        ]},
        ...(!menuOptions.protectVisibility ? [{ label: 'この列を非表示', action: () => {
          const hc = getHiddenCols(dbPath, { ctx });
          if (!hc.includes(propName)) setHiddenCols(dbPath, [...hc, propName], { ctx });
          _refreshDbColumnMenuView(ctx, dbPath);
        }}] : []),
        {
          type: 'submenu',
          label: lucide('eye', 14) + ' 非表示列を表示',
          children: _makeHiddenColumnMenuItems(dbPath, ctx),
        },
      ]
    },
    { label: '条件付きカラー...', action: (_ev, triggerEl) => showConditionalColorModal(propName, dbPath, ctx, triggerEl) },
    {
      // 折り返し設定（サブメニュー）。親メニューを閉じずにサブメニューとして開く。
      type: 'submenu',
      label: lucide('wrapText', 14) + ' 折り返し設定'
        + (colDisplayOverride
          ? '：' + (colDisplayOverride.overflow === 'wrap' ? `折り返し(${colDisplayOverride.lines}行)` : '切り詰め')
          : ''),
      children: typeof _makeColumnWrapSubmenuItems === 'function'
        ? _makeColumnWrapSubmenuItems(dbPath, propName, ctx)
        : [],
    },
  ];
  // 制作管理の既存列ではスキーマ編集導線を出さない。並び替え以降の表示操作は残す。
  if (productionSchemaLocked) items.splice(0, 3);

  // 編集制限サブメニュー
  const curLock = getColumnLock(dbPath, propName);
  const lockLabels = [
    { key: 'none',   label: '制限なし',       icon: 'lockOpen' },
    { key: 'admin',  label: '管理者のみ編集', icon: 'shield' },
    { key: 'locked', label: 'ロック',         icon: 'lock' },
  ];
  const curLockLabel = lockLabels.find(l => l.key === curLock)?.label || '制限なし';
  if (!productionSchemaLocked) {
    items.push({ type: 'sep' });
    items.push({
      type: 'submenu',
      label: lucide(curLock === 'locked' ? 'lock' : curLock === 'admin' ? 'shield' : 'lockOpen', 14) + ' 編集制限: ' + curLockLabel,
      children: lockLabels.map(l => ({
        label: (curLock === l.key ? radioMark(true) : '\u3000') + lucide(l.icon, 14) + ' ' + l.label,
        action: () => {
          setColumnLock(dbPath, propName, l.key);
          _refreshDbColumnMenuView(ctx, dbPath);
        }
      }))
    });
  }

  // date型: ステータス連動設定
  if (!productionSchemaLocked && currentType === 'date') {
    const curAuto = currentPtc.autoFillOnStatus || '';
    items.push({ type: 'sep' });
    items.push({
      label: lucide('clock', 14) + ' ステータス連動' + (curAuto ? ': ' + esc(curAuto) : ''),
      action: () => {
        _showAutoFillStatusInput(dbPath, propName, currentPtc, curAuto);
      }
    });
  }

  // 制作管理シートでは、必須列を誤って削除できる導線自体を表示しない。
  if (!(typeof isProductionManagementSheetPath === 'function' && isProductionManagementSheetPath(dbPath))) {
    items.push({ type: 'sep' });
    items.push({ label: lucide('trash2', 14) + ' 列を削除', danger: true, action: () => _deleteColumn(dbPath, propName, ctx) });
  }

  _renderColMenuItems(menu, items);

  // マウス位置を原点とするゼロサイズのアンカー矩形で positionPopup を呼ぶと、
  // zoom 補正 + ビューポートクランプが一括処理される。サブメニューの方向反転は
  // attachHoverSubmenu が自動処理する。
  document.body.appendChild(menu);
  positionPopup(menu, { left: e.clientX, right: e.clientX, top: e.clientY, bottom: e.clientY });

  _installColHeaderMenuDismissHandlers();
}

function _getEntryNameAutoPropertyColumns(dbPath, ctx) {
  const pivotData = (typeof _dbPivotDataForContext === 'function' ? _dbPivotDataForContext(ctx) : null) || state.pivotData || {};
  const allProps = Array.isArray(pivotData.properties) ? pivotData.properties : [];
  const hiddenCols = typeof getHiddenCols === 'function' ? (getHiddenCols(dbPath, { ctx }) || []) : [];
  const ordered = [];
  const add = (name) => {
    const prop = String(name || '').trim();
    if (!prop || prop === '__entity__' || ordered.includes(prop)) return;
    if (hiddenCols.includes(prop)) return;
    if (allProps.length && !allProps.includes(prop)) return;
    ordered.push(prop);
  };
  if (typeof getColOrder === 'function') (getColOrder(dbPath, { ctx }) || []).forEach(add);
  allProps.forEach(add);
  return ordered;
}

function _getDefaultEntryNameAutoProperties(props) {
  const preferred = [
    '作品タイトル',
    '作品タイトル_話数',
    'ページ',
    'コマ',
    '作業対象リスト',
    '作業対象',
    '作業内容リスト',
    '作業内容',
    '作業規模リスト',
    '作業規模',
    '対象数',
  ];
  const selected = preferred.filter(name => props.includes(name));
  return selected.length ? selected : props.slice(0, Math.min(3, props.length));
}

function _showEntryNameAutoGeneratePopup({ dbPath, ctx, entityName = '', entryPath = '' } = {}) {
  const targetDbPath = dbPath || ctx?.dbPath || state.currentDbPath;
  if (!targetDbPath) return;
  if (typeof isProductionManagementSheetPath === 'function' && isProductionManagementSheetPath(targetDbPath)) {
    showStatus('制作管理シートではエントリ名の自動生成を使用できません', true);
    return;
  }
  const props = _getEntryNameAutoPropertyColumns(targetDbPath, ctx);
  if (!props.length) {
    showStatus('名前に使える列がありません', true);
    return;
  }
  document.querySelectorAll('.modal-overlay[data-e2e-id="db-entry-name-autogen-dialog"]').forEach(el => el.remove());
  const defaults = new Set(_getDefaultEntryNameAutoProperties(props));
  const scopeLabel = entryPath ? (entityName || '選択エントリ') : '列全体';
  const body = document.createElement('div');
  body.innerHTML = `
    <div class="gbm-section">
      <div class="gbm-section-label">対象</div>
      <div class="muted" data-e2e-id="db-entry-name-autogen-scope">${esc(scopeLabel)}</div>
    </div>
    <div class="gbm-section">
      <div class="gbm-section-label">名前に使う列</div>
      <div class="gb-entry-name-autogen-list" data-e2e-id="db-entry-name-autogen-columns"></div>
    </div>`;
  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.textContent = 'キャンセル';
  cancelBtn.setAttribute('aria-label', 'エントリ名の自動生成をキャンセル');
  const runBtn = document.createElement('button');
  runBtn.type = 'button';
  runBtn.className = 'primary';
  runBtn.textContent = '生成';
  runBtn.dataset.e2eId = 'db-entry-name-autogen-run';
  const modalApi = window.GBUI.createModal({
    id: 'db-entry-name-autogen-dialog',
    title: 'エントリ名を自動生成',
    body,
    footer: [cancelBtn, runBtn],
    variant: 'standard',
    extraClass: 'gbm-modal',
    geometryKey: 'db-entry-name-autogen',
    initialFocus: '[data-e2e-id="db-entry-name-autogen-run"]',
  });
  const overlay = modalApi.overlay;
  overlay.classList.add('modal-overlay');
  overlay.dataset.e2eId = 'db-entry-name-autogen-dialog';
  overlay._dbEntryNameAutoModalApi = modalApi;
  modalApi.modal.classList.add('modal');
  modalApi.modal.style.maxWidth = '520px';
  modalApi.footer.classList.add('btn-row');
  const list = overlay.querySelector('.gb-entry-name-autogen-list');
  props.forEach(prop => {
    const label = document.createElement('label');
    label.className = 'gbm-check-row';
    label.style.display = 'flex';
    label.style.alignItems = 'center';
    label.style.gap = '8px';
    label.style.margin = '6px 0';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.value = prop;
    cb.checked = defaults.has(prop);
    cb.dataset.e2eId = 'db-entry-name-autogen-prop';
    const span = document.createElement('span');
    span.textContent = prop;
    label.appendChild(cb);
    label.appendChild(span);
    list.appendChild(label);
  });
  cancelBtn.addEventListener('click', () => modalApi.close('cancel'));
  runBtn.addEventListener('click', async (ev) => {
    const actionButton = ev.currentTarget;
    const propertyNames = [...overlay.querySelectorAll('input[type="checkbox"]:checked')].map(el => el.value);
    if (!propertyNames.length) {
      showStatus('名前に使う列を選択してください', true);
      return;
    }
    actionButton.disabled = true;
    const oldText = actionButton.textContent;
    actionButton.textContent = '生成中...';
    try {
      const payload = { db_path: targetDbPath, property_names: propertyNames };
      if (entryPath) payload.entry_path = entryPath;
      const res = await apiPost('/entity/auto-name', payload);
      if (typeof applyDbAutoEntityRenameResponse === 'function') applyDbAutoEntityRenameResponse(res);
      modalApi.close('generated');
      const count = Number(res?.renamed_count || 0);
      showStatus(count ? `エントリ名を自動生成しました: ${count}件` : '生成できるエントリ名がありませんでした');
      if (typeof selectDatabase === 'function') {
        await selectDatabase(targetDbPath, ctx, { silent: true, skipRecent: true, skipNavPush: true });
      } else if (typeof renderPivot === 'function') {
        renderPivot(ctx);
      }
    } catch (err) {
      showStatus('エントリ名の自動生成に失敗: ' + (err?.message || err), true);
      actionButton.disabled = false;
      actionButton.textContent = oldText;
    }
  });
  modalApi.open();
}

// エントリ列の右クリックメニュー
// ギャラリー/カンバンカード右クリックメニュー
function showDbCardContextMenu(e, dbPath, entityName, propName) {
  closeColHeaderMenu();
  const ctx = typeof _dbPaneContextFromEvent === 'function'
    ? _dbPaneContextFromEvent(e?.target || e?.currentTarget, { dbPath })
    : null;
  const targetDbPath = ctx?.dbPath || dbPath || state.currentDbPath;
  const productionSchemaLocked = typeof isProductionManagementSheetPath === 'function'
    && isProductionManagementSheetPath(targetDbPath);
  const pivotData = (typeof _dbPivotDataForContext === 'function' ? _dbPivotDataForContext(ctx) : null) || state.pivotData;
  const menu = document.createElement('div');
  menu.className = 'gb-context-menu';
  const ep = _entityPath(targetDbPath, entityName, pivotData);
  const sourcePaneId = e?.target?.closest?.('.gb-pane')?.dataset?.paneId || '';
  // サブパネル内では、右サイドバーで開く・チャットを開く等の
  // 右サイドバー補助操作のUIを表示しない（計画書「右サイドバー操作の制限」節）。
  const canUseRightSidebar = typeof GBPaneBridge === 'undefined' || typeof GBPaneBridge.canUseRightSidebarTools !== 'function'
    || typeof GBPaneBridge.surfaceOf !== 'function'
    || GBPaneBridge.canUseRightSidebarTools(GBPaneBridge.surfaceOf(e?.target || null));
  // 上部にリネーム入力欄: エントリ名変更
  _addMenuRenameInput(menu, entityName, (newName) => {
    window.GbDbEntryIdentity.rename({
      dbPath: targetDbPath,
      oldName: entityName,
      newName,
      path: ep,
      ctx,
      entryId: pivotData?.entities?.[entityName]?._id || '',
    }).then(() => {
      if (typeof _dbUndoRename === 'function') _dbUndoRename(targetDbPath, entityName, newName, ctx);
      if (typeof _renderCurrentDbView === 'function') _renderCurrentDbView(ctx, targetDbPath);
      showStatus('名前を変更: ' + newName);
      if (typeof _dbRefreshEntityRenameInBackground === 'function') {
        _dbRefreshEntityRenameInBackground(ctx, targetDbPath, newName);
      } else if (typeof selectDatabase === 'function') {
        selectDatabase(targetDbPath, ctx, { silent: true });
      }
    }).catch(() => showStatus('名前の変更に失敗', true));
  }, { placeholder: 'エントリ名を変更...' });
  // 依存関係プロパティの有無を確認
  const pts = getPropertyTypes(targetDbPath);
  const hasDeps = _hasDependencyPairProps(pts);
  const isXBookmarkEntry = !!pts?.['ポストID'];
  const items = [
    ...(!productionSchemaLocked ? [{ icon: 'sparkles', label: 'エントリ名を自動生成...', e2eId: 'db-entry-row-autoname', action: () => {
      _showEntryNameAutoGeneratePopup({ dbPath: targetDbPath, ctx, entityName, entryPath: ep });
    } }] : []),
    { type: 'sep' },
    { icon: 'panelLeft', label: 'メインパネルで開く', action: () => {
      if (typeof openLinkInMainPane === 'function') openLinkInMainPane(ep, entityName, { linkType: 'entity' });
      else selectEntity(ep);
    } },
    ...(canUseRightSidebar ? [{ icon: 'panelRight', label: '右サイドバーで開く', action: () => {
      if (typeof openLinkInRightPane === 'function') openLinkInRightPane(ep, entityName, { linkType: 'entity', sourcePaneId, sourceEl: e?.target || null });
      else selectEntity(ep);
    } }] : []),
    ...(canUseRightSidebar ? [{ icon: 'messagesSquare', label: 'チャットを開く', action: () => {
      if (typeof openEntityChatForPath === 'function') return openEntityChatForPath(ep);
      if (typeof openFileChat === 'function') return openFileChat(ep);
    } }] : []),
    ...(isXBookmarkEntry ? [{ icon: 'refreshCw', label: 'Xからこのポストを再インポート', action: async () => {
      try {
        if (typeof window.reimportXBookmarkEntry !== 'function') throw new Error('X再インポート機能を読み込めません');
        await window.reimportXBookmarkEntry(ep);
        await selectDatabase(targetDbPath, ctx, { silent: true, skipNavPush: true });
      } catch (error) {
        showStatus('再インポートに失敗: ' + (error?.userMessage || error?.message || error), true);
      }
    } }] : []),
    { type: 'sep' },
    ...(hasDeps ? [{ icon: 'gitBranch', label: '依存エントリを作成', action: () => _createDependentEntry(targetDbPath, entityName, undefined, ctx) }] : []),
    // 1セル1値で運用するシート（制作管理）では候補値を追加できないため項目を出さない
    // （シート表・エントリ詳細パネルの＋ボタンと同じ扱い）。
    ...(propName && typeof startCellInlineAdd === 'function'
      && !(typeof hidesCandidateStatusUi === 'function' && hidesCandidateStatusUi(targetDbPath))
      ? [{ icon: 'plus', label: '候補値を追加', action: () => {
      const paneRoot = e?.target?.closest?.('.gb-pane') || document.body;
      const row = paneRoot.querySelector('tr[data-entity-name="' + CSS.escape(entityName) + '"]');
      const td = row?.querySelector('td[data-prop-name="' + CSS.escape(propName) + '"]');
      if (td) startCellInlineAdd(td, ep, entityName, propName);
    } }] : []),
    { icon: 'link2', label: 'パスをコピー', action: () => {
      const base = typeof state !== 'undefined' ? (state.vaultPath || '') : '';
      const copyPath = window.GBPathUtils?.resolveForClipboard?.(ep, base) ?? ep;
      navigator.clipboard.writeText(copyPath).then(() => showStatus('パスをコピーしました'));
    }},
    { type: 'sep' },
    { icon: 'trash2', label: 'エントリを削除', danger: true, action: async () => {
      const confirmMessage = entityName + ' を削除しますか？';
      const confirmed = typeof MeldexDeleteImpactWarning !== 'undefined'
        ? await MeldexDeleteImpactWarning.confirmDeleteWithImpact([{ path: ep, kind: 'file' }], confirmMessage)
        : await cfConfirm(confirmMessage);
      if (!confirmed) return;
      const entryId = String(
        ctx?.pivotData?.entities?.[entityName]?._id
        || (state.currentDbPath === targetDbPath ? state.pivotData?.entities?.[entityName]?._id : '')
        || ''
      );
      try {
        const result = await window.GbDbEntryIdentity.deleteEntries({
          dbPath: targetDbPath,
          ctx,
          entries: [{ name: entityName, path: ep, entryId }],
          source: 'context-menu',
        });
        const response = result.responses[0];
        const calendarWarning = typeof _dbDeleteCalendarSyncWarningMessage === 'function'
          ? _dbDeleteCalendarSyncWarningMessage(response)
          : '';
        if (result.failures.length) {
          const error = result.failures[0]?.error;
          showStatus(
            error?.resultUnknown ? '削除結果を確認できませんでした。行を元に戻しました' : '削除に失敗したため、行を元に戻しました',
            true
          );
        } else {
          showStatus(calendarWarning || '削除しました', !!calendarWarning);
        }
      } catch (error) {
        showStatus('削除に失敗: ' + (error?.userMessage || error?.message || error), true);
      }
    }},
  ];
  items.forEach(item => {
    if (item.type === 'sep') { const s = document.createElement('div'); s.className = 'gb-context-menu-sep'; menu.appendChild(s); return; }
    const el = document.createElement('div');
    el.className = 'gb-context-menu-item';
    if (item.e2eId) el.dataset.e2eId = item.e2eId;
    if (item.icon && typeof lucide === 'function') {
      el.innerHTML = lucide(item.icon, 14) + ' ' + item.label;
    } else {
      el.textContent = item.label;
    }
    if (item.danger) el.classList.add('danger');
    el.addEventListener('click', () => { closeColHeaderMenu(); item.action(); });
    menu.appendChild(el);
  });
  // positionPopup() でマウス位置基準の配置 + ビューポートクランプを一括処理
  // (既知バグ #3「手動 zoom 計算残存」の修正)
  document.body.appendChild(menu);
  positionPopup(menu, { left: e.clientX, right: e.clientX, top: e.clientY, bottom: e.clientY });
  _installColHeaderMenuDismissHandlers();
}

function _hasDependencyPairProps(pts) {
  if (!pts || typeof pts !== 'object') return false;
  return Object.values(pts).some(cfg => cfg && cfg.pairWith && cfg.relationDb === '');
}

/* 枠線設定モーダル（横線/縦線を個別にDB単位で設定） */
function showGridBorderModal(ctxOrDbPath) {
  const ctx = ctxOrDbPath && typeof ctxOrDbPath === 'object'
    ? ctxOrDbPath
    : (typeof _currentPaneState === 'function' ? _currentPaneState() : null);
  const dbPath = typeof ctxOrDbPath === 'string' ? ctxOrDbPath : (ctx?.dbPath || state.currentDbPath);
  if (!dbPath) return;
  const cfg = getDbViewConfig(dbPath);
  const gridH = cfg.gridH || { width: '1px', color: '' };
  const gridV = cfg.gridV || { width: '1px', color: '' };

  const widthOptions = [
    { value: 'none', label: '非表示' },
    { value: '1px',  label: '細' },
    { value: '2px',  label: '中' },
    { value: '3px',  label: '太い' },
  ];
  const makeSelect = (id, current) => widthOptions.map(o =>
    `<option value="${o.value}"${o.value === current ? ' selected' : ''}>${o.label}</option>`
  ).join('');

  const body = document.createElement('div');
  body.innerHTML = `<div class="gbm-sections">
      <div>
        <label class="gbm-section-label">横線</label>
        <div class="gbm-section-row">
          <select id="grid-h-width" class="gb-select">
            ${makeSelect('grid-h-width', gridH.width)}
          </select>
          <label class="gbm-small-label">色:</label>
          <button type="button" id="grid-h-color" class="gb-color-swatch gb-color-swatch--field" data-color="${gridH.color || '#333333'}" title="横線の色"></button>
          <button id="grid-h-color-reset" class="gbm-reset-btn">リセット</button>
        </div>
      </div>
      <div>
        <label class="gbm-section-label">縦線</label>
        <div class="gbm-section-row">
          <select id="grid-v-width" class="gb-select">
            ${makeSelect('grid-v-width', gridV.width)}
          </select>
          <label class="gbm-small-label">色:</label>
          <button type="button" id="grid-v-color" class="gb-color-swatch gb-color-swatch--field" data-color="${gridV.color || '#333333'}" title="縦線の色"></button>
          <button id="grid-v-color-reset" class="gbm-reset-btn">リセット</button>
        </div>
      </div>
      <div class="gbm-preview-wrap">
        <div class="gbm-preview-label">プレビュー</div>
        <table id="grid-preview-table" class="gbm-preview-table">
          <tr><td class="gbm-preview-cell">A1</td><td class="gbm-preview-cell">B1</td><td class="gbm-preview-cell">C1</td></tr>
          <tr><td class="gbm-preview-cell">A2</td><td class="gbm-preview-cell">B2</td><td class="gbm-preview-cell">C2</td></tr>
        </table>
      </div>
    </div>`;
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.id = 'grid-border-cancel';
  closeBtn.textContent = '閉じる';
  closeBtn.setAttribute('aria-label', '枠線設定を閉じる');
  const applyBtn = document.createElement('button');
  applyBtn.type = 'button';
  applyBtn.className = 'primary';
  applyBtn.id = 'grid-border-apply';
  applyBtn.textContent = '適用';
  const modalApi = window.GBUI.createModal({
    id: 'grid-border-dialog',
    title: '枠線設定',
    body,
    footer: [closeBtn, applyBtn],
    variant: 'standard',
    extraClass: 'gbm-modal',
    geometryKey: 'db-grid-border',
    initialFocus: '#grid-h-width',
  });
  const o = modalApi.overlay;
  o.classList.add('modal-overlay');
  o.dataset.e2eId = 'grid-border-dialog';
  o._gridBorderModalApi = modalApi;
  modalApi.modal.classList.add('modal');
  modalApi.footer.classList.add('btn-row');
  modalApi.open();

  const hWidthSel = o.querySelector('#grid-h-width');
  const hColorInp = o.querySelector('#grid-h-color');
  const vWidthSel = o.querySelector('#grid-v-width');
  const vColorInp = o.querySelector('#grid-v-color');
  const preview = o.querySelector('#grid-preview-table');
  bindColorSwatch(hColorInp, () => getColorSwatchValue(hColorInp, gridH.color || '#333333'), (nextColor) => {
    setColorSwatchValue(hColorInp, nextColor || '#333333');
    updatePreview();
  });
  bindColorSwatch(vColorInp, () => getColorSwatchValue(vColorInp, gridV.color || '#333333'), (nextColor) => {
    setColorSwatchValue(vColorInp, nextColor || '#333333');
    updatePreview();
  });

  const updatePreview = () => {
    const hW = hWidthSel.value === 'none' ? '0' : hWidthSel.value;
    const vW = vWidthSel.value === 'none' ? '0' : vWidthSel.value;
    const hC = getColorSwatchValue(hColorInp, '#333333');
    const vC = getColorSwatchValue(vColorInp, '#333333');
    // CSS 変数で 4 辺に一括適用。td ごとの罫線はユーザー入力値由来なので
    // インライン style 属性は避けつつ setProperty で動的に渡す。
    preview.querySelectorAll('td').forEach(td => {
      td.style.setProperty('--gbm-border-h', hW + ' solid ' + hC);
      td.style.setProperty('--gbm-border-v', vW + ' solid ' + vC);
    });
  };
  updatePreview();
  hWidthSel.addEventListener('change', updatePreview);
  vWidthSel.addEventListener('change', updatePreview);

  o.querySelector('#grid-h-color-reset').addEventListener('click', () => { setColorSwatchValue(hColorInp, '#333333'); updatePreview(); });
  o.querySelector('#grid-v-color-reset').addEventListener('click', () => { setColorSwatchValue(vColorInp, '#333333'); updatePreview(); });

  closeBtn.addEventListener('click', () => modalApi.close('close-button'));
  applyBtn.addEventListener('click', () => {
    const c = getDbViewConfig(dbPath);
    const hColor = getColorSwatchValue(hColorInp, '#333333');
    const vColor = getColorSwatchValue(vColorInp, '#333333');
    c.gridH = { width: hWidthSel.value, color: hColor === '#333333' ? '' : hColor };
    c.gridV = { width: vWidthSel.value, color: vColor === '#333333' ? '' : vColor };
    saveDbViewConfig(dbPath, c, { historyLabel: 'シート表示: 枠線設定' });
    modalApi.close('apply');
    renderPivot(ctx);
  });
}

function showEntityColMenu(e, ctxOverride, dbPathOverride) {
  closeColHeaderMenu();
  const ctx = ctxOverride || (typeof _dbPaneContextFromEvent === 'function'
    ? _dbPaneContextFromEvent(e?.target || e?.currentTarget, { dbPath: dbPathOverride || state.currentDbPath })
    : null);
  const dbPath = dbPathOverride || ctx?.dbPath || state.currentDbPath;
  const productionSchemaLocked = typeof isProductionManagementSheetPath === 'function'
    && isProductionManagementSheetPath(dbPath);
  const productionWriteBlocked = typeof isProductionManagementWriteBlocked === 'function'
    && isProductionManagementWriteBlocked(dbPath, ctx);

  const menu = document.createElement('div');
  menu.className = 'gb-context-menu';
  // 上部にリネーム入力欄: エントリ名列の列名変更（シート名の変更はフォルダツリー/タブから行う）
  if (dbPath && !productionSchemaLocked) {
    const currentLabel = typeof _dbEntityColumnDisplayLabel === 'function'
      ? _dbEntityColumnDisplayLabel(dbPath, { ctx })
      : 'エントリ名';
    _addMenuRenameInput(menu, currentLabel, async (newName) => {
      const clean = String(newName || '').trim();
      if (!clean) return;
      if (typeof setEntityColumnLabel === 'function') {
        setEntityColumnLabel(dbPath, clean, { ctx });
        showStatus('列名を変更しました');
        _refreshDbColumnMenuView(ctx, dbPath);
      }
    }, { placeholder: 'エントリ名列の名前を変更...' });
  }

  const pinnedRange = _dbPinnedRangeForMenu(ctx, dbPath, e?.target || e?.currentTarget);
  const pinnedTokens = pinnedRange.pinnedTokens;
  const entityPinned = pinnedRange.entityColumnPinned;
  const entityFilterActive = typeof isDbColumnFilterActive === 'function'
    && isDbColumnFilterActive(dbPath, '__entity__', ctx);
  const items = [
    { type: 'submenu', label: '並び替え', children: _makeDbGlobalSortMenuItems(dbPath, ctx) },
    {
      label: lucide('filter', 14) + ' この列をフィルター...' + (entityFilterActive ? '（適用中）' : ''),
      action: () => {
        if (typeof showDbColumnFilterPopup === 'function') showDbColumnFilterPopup(e, '__entity__', ctx, dbPath);
      },
    },
    // 互換テスト用: showUnifiedFilterModal()
    { label: 'すべての条件フィルター...', action: () => showUnifiedFilterModal({ ctx }) },
    { type: 'sep' },
    ...(!productionSchemaLocked ? [{ label: lucide('sparkles', 14) + ' エントリ名を自動生成...', e2eId: 'db-entry-column-autoname', action: () => {
      _showEntryNameAutoGeneratePopup({ dbPath, ctx });
    } }, { type: 'sep' }] : []),
    { type: 'submenu', label: lucide('columns', 14) + ' 列操作', children: [
      { label: lucide('ruler', 14) + ' 列幅を数値指定...', action: () => _showBulkColumnWidthModal('__entity__', ctx || dbPath) },
      // 「列の表示と順序...」はツールバーへ移設（2026-07-19 ユーザー指示）
      { type: 'submenu', label: '列を固定', children: [
        { label: (entityPinned ? radioMark(true) : '　') + '固定する', action: () => {
          if (!entityPinned) {
            _dbSetPinnedRangeFromMenu(ctx, dbPath, pinnedRange.renderedCols, '__entity__', true);
          }
        }},
        { label: (!entityPinned ? radioMark(true) : '　') + '固定しない', action: () => {
          if (entityPinned) {
            _dbSetPinnedRangeFromMenu(ctx, dbPath, pinnedRange.renderedCols, '__entity__', false);
          }
        }},
      ]},
      {
        type: 'submenu',
        label: lucide('eye', 14) + ' 非表示列を表示',
        children: _makeHiddenColumnMenuItems(dbPath, ctx),
      },
    ] },
    // エントリ名列の折り返し設定（通常列と同じサブメニュー。キーは __entity__）
    { type: 'submenu', label: lucide('wrapText', 14) + ' 折り返し設定',
      children: typeof _makeColumnWrapSubmenuItems === 'function'
        ? _makeColumnWrapSubmenuItems(dbPath, '__entity__', ctx)
        : [] },
    ...(!productionSchemaLocked && !productionWriteBlocked
      ? [{ label: '+ 依存関係の列', action: () => _addDependencyPairProps(dbPath, ctx) }]
      : []),
    ...(pinnedTokens.length > 0 ? [{
      type: 'sep'
    }, {
      type: 'submenu',
      label: lucide('pinOff', 14) + ' 固定中の列を解除 (' + pinnedTokens.length + ')',
      children: [
        ...pinnedTokens.map(token => ({
          label: 'ここから解除: ' + esc(token === '__entity__'
            ? (_dbEntityColumnDisplayLabel(dbPath, { ctx }) || 'エントリ名')
            : token),
          action: () => {
            _dbSetPinnedRangeFromMenu(ctx, dbPath, pinnedRange.renderedCols, token, false);
          }
        })),
        { type: 'sep' },
        { label: 'すべて解除', action: () => {
            _dbSetPinnedRangeFromMenu(ctx, dbPath, pinnedRange.renderedCols, pinnedRange.renderedCols[0], false);
          }
        },
      ]
    }] : []),
  ];

  _renderColMenuItems(menu, items);

  // positionPopup() でマウス位置基準の配置 + ビューポートクランプを一括処理。
  // サブメニューの方向反転は attachHoverSubmenu が自動処理する。
  document.body.appendChild(menu);
  positionPopup(menu, { left: e.clientX, right: e.clientX, top: e.clientY, bottom: e.clientY });

  _installColHeaderMenuDismissHandlers();
}

// エントリを追加（無題N を生成して新規作成 → リネーム可能状態にする）
async function _addEntityBelow(dbPath, afterEntity) {
  if (!dbPath) return;
  const entitiesMap = state.pivotData?.entities || {};
  const existing = Object.keys(entitiesMap);
  try {
    const created = typeof _apiCreateEntityWithUniqueName === 'function'
      ? await _apiCreateEntityWithUniqueName(dbPath, existing)
      : null;
    const r = created?.response || await apiPost('/entity/create', { parent_path: dbPath, name: '無題' });
    const name = created?.name || '無題';
    const createdPath = created?.path || (r && (r.path || r.entry_path)) || `${dbPath}/${name}.md`;
    if (typeof _autoFillOnCreate === 'function') {
      if (typeof _shouldRunFrontendAutoFillOnCreate !== 'function' || _shouldRunFrontendAutoFillOnCreate(r)) {
        try { await _autoFillOnCreate(dbPath, createdPath, {}); } catch {}
      }
    }
    await selectDatabase(dbPath, undefined, { silent: true });
    showStatus('エントリを追加しました: ' + name);
    // 行が DOM に出現したらインラインリネームを起動
    const ctx = (typeof _currentPaneState === 'function') ? _currentPaneState() : null;
    if (ctx && typeof _waitForEntityRow === 'function') {
      _waitForEntityRow(ctx, name, (tr) => {
        const label = tr.querySelector('.entity-name-label');
        const td = label?.closest('td');
        if (td && label && typeof startEntityInlineRename === 'function') {
          startEntityInlineRename(td, label, name, dbPath);
        }
      });
    }
  } catch (err) { showStatus('エントリ追加失敗: ' + (err?.message || err), true); }
}

// 依存関係ペアプロパティを一括作成
function _addDependencyPairProps(dbPath, ctx) {
  const pts = getPropertyTypes(dbPath);
  // 既に存在する場合はスキップ
  if (pts['先行'] || pts['後続']) {
    showStatus('依存関係の列は既に存在します');
    return;
  }
  setPropertyType(dbPath, '先行', {
    type: 'multi-relation', relationDb: '', pairWith: '後続', dependencyDirection: 'target-to-entry'
  });
  setPropertyType(dbPath, '後続', {
    type: 'multi-relation', relationDb: '', pairWith: '先行', dependencyDirection: 'entry-to-target'
  });
  showStatus('依存関係の列を追加しました（先行 / 後続）');
  _refreshDbColumnMenuView(ctx, dbPath);
}

// 依存エントリを作成
async function _createDependentEntry(dbPath, sourceEntityName, overrideCopyProps, ctx) {
  const pts = getPropertyTypes(dbPath);
  const pivotData = (typeof _dbPivotDataForContext === 'function' ? _dbPivotDataForContext(ctx) : null) || state.pivotData;
  const entities = pivotData?.entities || {};
  const sourceData = entities[sourceEntityName];
  if (!sourceData) { showStatus('ソースエントリが見つかりません', true); return; }

  // 新しいエントリ名生成（元名_R1, _R2, ...）
  const existingNames = Object.keys(entities);
  let suffix = 1;
  let newName;
  do {
    newName = sourceEntityName + '_R' + suffix;
    suffix++;
  } while (existingNames.includes(newName));

  // エントリ作成
  let created = null;
  try {
    created = await apiPost('/entity/create', { parent_path: dbPath, name: newName });
  } catch (e) { showStatus('エントリ作成に失敗: ' + e, true); return; }

  const newPath = _entityPath(dbPath, newName, pivotData);

  // コピー対象プロパティを決定
  const copyProps = Array.isArray(overrideCopyProps) ? overrideCopyProps : _getDependentCopyProps(dbPath, pts, ctx);
  const dependencyErrors = [];
  // §12.1 Phase 0: autoFillOnCreate 適用（R8: 依存コピー対象プロパティはスキップ）
  if (typeof _autoFillOnCreate === 'function'
      && (typeof _shouldRunFrontendAutoFillOnCreate !== 'function' || _shouldRunFrontendAutoFillOnCreate(created))) {
    const overrides = {};
    for (const p of copyProps) overrides[p] = true;
    try {
      await _autoFillOnCreate(dbPath, newPath, overrides);
    } catch (e) {
      dependencyErrors.push('初期値: ' + (e?.message || e));
    }
  }

  // プロパティ値をコピー
  for (const propName of copyProps) {
    const vals = sourceData[propName];
    if (!vals || !Array.isArray(vals) || vals.length === 0) continue;
    for (const v of vals) {
      if (v?.value) {
        try {
          await _apiPostValue(newPath, propName, v.value, v.status || '採用', v.note || '');
        } catch (e) {
          dependencyErrors.push(propName + ': ' + (e?.message || e));
        }
      }
    }
  }

  // 依存関係設定: 先行/後続のペアを特定
  let blockingProp = null, blockedByProp = null;
  for (const [p, cfg] of Object.entries(pts)) {
    if (cfg.pairWith && cfg.relationDb === '') {
      if (!blockingProp && (!cfg.dependencyDirection || cfg.dependencyDirection === 'target-to-entry')) {
        blockingProp = p;
        blockedByProp = cfg.pairWith;
      }
    }
  }

  if (blockingProp && blockedByProp) {
    try {
      // ソースエントリのIDを取得
      const map = await _getRelationMap(dbPath);
      const sourceId = map.nameToId[sourceEntityName] || sourceEntityName;

      // 新エントリの「後続」にソースのIDを設定
      try {
        await _apiPostValue(newPath, blockedByProp, sourceId, '採用', '');
      } catch (e) {
        dependencyErrors.push(blockedByProp + ': ' + (e?.message || e));
      }

      // ソースの「先行」に新エントリのIDを追加
      _relationCache[dbPath] = null; // キャッシュ無効化して再取得
      const freshMap = await _getRelationMap(dbPath);
      const newId = freshMap.nameToId[newName] || newName;
      const sourceBlockingVals = sourceData[blockingProp] || [];
      const sourceBlockingVal = typeof getAdoptedValueForWrite === 'function'
        ? getAdoptedValueForWrite(sourceBlockingVals)
        : sourceBlockingVals[0];
      try {
        if (sourceBlockingVal) {
          const currentIds = (sourceBlockingVal.value || '').split(',').map(s => s.trim()).filter(Boolean);
          if (!currentIds.includes(newId)) currentIds.push(newId);
          await _apiPutValue(sourceBlockingVal, { new_value: currentIds.join(', ') });
        } else {
          const sourcePath = _entityPath(dbPath, sourceEntityName, pivotData);
          await _apiPostValue(sourcePath, blockingProp, newId, '採用', '');
        }
      } catch (e) {
        dependencyErrors.push(blockingProp + ': ' + (e?.message || e));
      }
    } catch (e) {
      dependencyErrors.push('依存関係: ' + (e?.message || e));
    }
  }

  if (dependencyErrors.length) {
    showStatus('依存エントリを作成しましたが、一部の値保存に失敗: ' + dependencyErrors.slice(0, 3).join(' / '), true);
  } else {
    showStatus('依存エントリを作成: ' + newName);
  }
  selectDatabase(dbPath, ctx);
}

// 依存エントリ作成時のコピー対象プロパティ
function _getDependentCopyProps(dbPath, pts, ctx) {
  const config = (typeof getCurrentDbViewConfigEntry === 'function' ? getCurrentDbViewConfigEntry(dbPath, { ctx }) : null)
    || getDbViewConfig(dbPath);
  if (Array.isArray(config.dependentCopyProps)) {
    return config.dependentCopyProps;
  }
  // デフォルト: リレーション型 + セレクト型（ペアプロパティ・日付・テキストを除外）
  const props = [];
  for (const [p, cfg] of Object.entries(pts)) {
    if (cfg.pairWith) continue;
    if (['relation', 'multi-relation', 'select', 'multi-select'].includes(cfg.type)) {
      props.push(p);
    }
  }
  return props;
}

function _dbColumnDisplayOrderList(dbPath, ctx) {
  if (typeof _dbOrderedPropertyNamesForMenu === 'function') {
    const names = _dbOrderedPropertyNamesForMenu(dbPath, ctx);
    return typeof filterDeletedDbProperties === 'function' ? filterDeletedDbProperties(dbPath, names) : names;
  }
  const pivotData = (typeof _dbPivotDataForContext === 'function' ? _dbPivotDataForContext(ctx) : null)
    || ctx?.pivotData
    || state.pivotData
    || {};
  const ordered = [];
  const add = (name) => {
    const prop = String(name || '').trim();
    if (prop && !(typeof isDbPropertyDeleted === 'function' && isDbPropertyDeleted(dbPath, prop)) && !ordered.includes(prop)) ordered.push(prop);
  };
  (typeof getColOrder === 'function' ? (getColOrder(dbPath, { ctx }) || []) : []).forEach(add);
  (Array.isArray(pivotData.properties) ? pivotData.properties : []).forEach(add);
  Object.keys(typeof getPropertyTypes === 'function' ? (getPropertyTypes(dbPath) || {}) : {}).forEach(add);
  (typeof getHiddenCols === 'function' ? (getHiddenCols(dbPath, { ctx }) || []) : []).forEach(add);
  return ordered;
}

function _updateColumnDisplayOrderModalState(root) {
  const listEl = root?.querySelector?.('#col-vis-list');
  if (!listEl) return;
  const items = [...listEl.querySelectorAll('.col-vis-item[data-prop]')];
  let visibleCount = 0;
  items.forEach(item => {
    const checked = !!item.querySelector('input[type=checkbox]')?.checked;
    if (checked) visibleCount++;
    item.classList.toggle('is-hidden', !checked);
  });
  const summary = root.querySelector('#col-vis-summary');
  if (summary) summary.textContent = `${visibleCount} / ${items.length} 列を表示`;
}

function _dbColumnModalContext(root) {
  const ctx = root?._dbCtx || (typeof _currentPaneState === 'function' ? _currentPaneState() : null);
  const dbPath = root?._dbPath || ctx?.dbPath || state.currentDbPath;
  const pivotData = (typeof _dbPivotDataForContext === 'function' ? _dbPivotDataForContext(ctx) : null) || ctx?.pivotData || state.pivotData;
  return { dbPath, ctx, pivotData };
}

function _dbColumnModalNames(root, dbPath, ctx) {
  const names = new Set(_dbColumnDisplayOrderList(dbPath, ctx));
  root?.querySelectorAll?.('.col-vis-item[data-prop]').forEach(item => {
    if (item.dataset.prop) names.add(item.dataset.prop);
  });
  return names;
}

function _dbUniqueColumnName(baseName, existing) {
  const base = String(baseName || '').trim() || '新しい列';
  let name = base;
  let idx = 2;
  while (existing.has(name)) name = `${base} ${idx++}`;
  return name;
}

function _dbColumnActionButton(icon, title, className, label) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'col-vis-action-btn' + (className ? ' ' + className : '');
  btn.title = title;
  btn.setAttribute('aria-label', title);
  const iconHtml = typeof lucide === 'function' ? lucide(icon, 14) : '';
  const text = document.createElement('span');
  text.className = 'col-vis-action-label';
  text.textContent = label || title;
  btn.innerHTML = iconHtml;
  btn.appendChild(text);
  return btn;
}

function _addColumnDisplayOrderItem(root, propName, checked, afterItem) {
  const listEl = root?.querySelector?.('#col-vis-list');
  if (!listEl || !propName) return null;
  const item = document.createElement('div');
  // 並べ替えは pointer events 実装（showColumnDisplayOrderModal 側）。
  // draggable=true にすると HTML5 ドラッグが先に始まり pointer events が止まるため付けない
  item.dataset.prop = propName;
  item.className = 'col-vis-item';
  const handle = document.createElement('span');
  handle.className = 'col-vis-handle';
  handle.innerHTML = typeof lucide === 'function' ? lucide('gripVertical', 14) : '';
  handle.title = '並べ替え';
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.checked = checked !== false;
  cb.setAttribute('aria-label', '表示: ' + propName);
  cb.addEventListener('change', () => _updateColumnDisplayOrderModalState(root));
  const label = document.createElement('span');
  label.textContent = propName;
  label.className = 'col-vis-label';
  const actions = document.createElement('span');
  actions.className = 'col-vis-actions';
  if (!root?._productionWriteBlocked) {
    const copyBtn = _dbColumnActionButton('copy', '列を複製: ' + propName, '', '複製');
    copyBtn.addEventListener('click', () => _duplicateColumnFromDisplayOrderModal(root, propName, item));
    actions.appendChild(copyBtn);
  }
  if (!root?._productionWriteBlocked
      && !(typeof isProductionManagementSheetPath === 'function' && isProductionManagementSheetPath(root?._dbPath || ''))) {
    const delBtn = _dbColumnActionButton('trash2', '列を削除: ' + propName, 'danger', '削除');
    delBtn.addEventListener('click', () => _deleteColumnFromDisplayOrderModal(root, propName, item));
    actions.appendChild(delBtn);
  }
  item.appendChild(handle);
  item.appendChild(cb);
  item.appendChild(label);
  item.appendChild(actions);
  if (afterItem?.parentNode === listEl) afterItem.after(item);
  else listEl.appendChild(item);
  _updateColumnDisplayOrderModalState(root);
  return item;
}

function _saveColumnDisplayOrderState(root, label) {
  const listEl = root?.querySelector?.('#col-vis-list');
  const dbPath = root?._dbPath || state.currentDbPath;
  if (!listEl || !dbPath) return null;
  const ctx = root?._dbCtx || (typeof _dbFindPaneContextForPath === 'function' ? _dbFindPaneContextForPath(dbPath) : null);
  const before = label && typeof captureDbViewConfigHistory === 'function' ? captureDbViewConfigHistory(dbPath) : null;
  const hidden = [], newOrder = [], seen = new Set();
  listEl.querySelectorAll('.col-vis-item[data-prop]').forEach(item => {
    const p = item.dataset.prop;
    if (!p || seen.has(p)) return;
    seen.add(p);
    newOrder.push(p);
    if (!item.querySelector('input[type=checkbox]')?.checked) hidden.push(p);
  });
  const c = getDbViewConfig(dbPath);
  const view = typeof _getCurrentDbViewConfigEntryFromConfig === 'function' ? _getCurrentDbViewConfigEntryFromConfig(c, { ctx }) : null;
  const target = view || c;
  target.hiddenCols = hidden;
  target.colOrder = newOrder;
  saveDbViewConfig(dbPath, c, { skipHistory: true, ctx });
  if (label && typeof pushDbViewConfigHistory === 'function' && typeof captureDbViewConfigHistory === 'function') {
    pushDbViewConfigHistory(dbPath, label, before, captureDbViewConfigHistory(dbPath), '', () => {
      if (typeof selectDatabase === 'function') return selectDatabase(dbPath, ctx, { silent: true, skipRecent: true, skipNavPush: true, skipSaveLastView: true });
      if (typeof renderPivot === 'function') renderPivot(ctx);
    });
  }
  return { dbPath, ctx };
}

async function _addColumnFromDisplayOrderModal(root) {
  const { dbPath, ctx } = _dbColumnModalContext(root);
  if (!dbPath) return;
  const input = root.querySelector('#col-vis-new-name');
  const name = _dbUniqueColumnName(input?.value || '新しい列', _dbColumnModalNames(root, dbPath, ctx));
  await Promise.resolve(setPropertyType(dbPath, name, { type: 'text' }));
  _addColumnDisplayOrderItem(root, name, true);
  if (input) input.value = '';
  _saveColumnDisplayOrderState(root);
  if (typeof renderPivot === 'function') renderPivot(ctx);
  if (typeof showStatus === 'function') showStatus('列を追加しました: ' + name);
}

function _copyColumnViewConfig(dbPath, fromProp, toProp) {
  const c = getDbViewConfig(dbPath);
  const copy = (target) => {
    if (!target || typeof target !== 'object') return;
    ['colWidths', 'countTypes', 'conditionalColors'].forEach(key => {
      if (target[key]?.[fromProp] !== undefined) {
        if (!target[key] || typeof target[key] !== 'object') target[key] = {};
        target[key][toProp] = JSON.parse(JSON.stringify(target[key][fromProp]));
      }
    });
  };
  copy(c);
  (c.savedViews || []).forEach(copy);
  if (c.columnLocks?.[fromProp]) {
    if (!c.columnLocks) c.columnLocks = {};
    c.columnLocks[toProp] = c.columnLocks[fromProp];
  }
  saveDbViewConfig(dbPath, c, { skipHistory: true });
}

async function _copyColumnValuesForDuplicate(dbPath, pivotData, fromProp, toProp) {
  if (typeof _apiPostValue !== 'function') return { copied: 0, failed: 0 };
  let copied = 0, failed = 0;
  for (const [entityName, ent] of Object.entries(pivotData?.entities || {})) {
    const vals = Array.isArray(ent?.[fromProp]) ? ent[fromProp] : [];
    const entityPath = typeof _entityPath === 'function' ? _entityPath(dbPath, entityName, pivotData) : `${dbPath}/${entityName}.md`;
    for (const v of vals) {
      if (v?.value == null || String(v.value) === '') continue;
      const extra = {};
      if (Array.isArray(v.relations)) extra.relations = v.relations;
      if (Array.isArray(v.published_in)) extra.published_in = v.published_in;
      try { await _apiPostValue(entityPath, toProp, v.value, v.status || '採用', v.note || '', v.rich_html || '', extra); copied++; }
      catch (e) { console.warn('列複製の値コピーに失敗:', e); failed++; }
    }
  }
  return { copied, failed };
}

async function _duplicateColumnFromDisplayOrderModal(root, propName, item) {
  const { dbPath, ctx, pivotData } = _dbColumnModalContext(root);
  if (!dbPath || !propName) return;
  const newName = _dbUniqueColumnName(propName + ' コピー', _dbColumnModalNames(root, dbPath, ctx));
  const pt = JSON.parse(JSON.stringify((getPropertyTypes(dbPath) || {})[propName] || { type: 'text' }));
  await Promise.resolve(setPropertyType(dbPath, newName, pt));
  _copyColumnViewConfig(dbPath, propName, newName);
  _addColumnDisplayOrderItem(root, newName, true, item);
  _saveColumnDisplayOrderState(root);
  const result = await _copyColumnValuesForDuplicate(dbPath, pivotData, propName, newName);
  if (typeof selectDatabase === 'function') await selectDatabase(dbPath, ctx, { silent: true, skipRecent: true, skipNavPush: true });
  else if (typeof renderPivot === 'function') renderPivot(ctx);
  const suffix = result.failed ? `（${result.failed}件失敗）` : '';
  if (typeof showStatus === 'function') showStatus(`列を複製しました: ${newName} / 値 ${result.copied}件${suffix}`, !!result.failed);
}

async function _deleteColumnFromDisplayOrderModal(root, propName, item) {
  const { dbPath, ctx } = _dbColumnModalContext(root);
  if (!dbPath || !propName || typeof _deleteColumn !== 'function') return;
  const deleted = await _deleteColumn(dbPath, propName, ctx);
  if (!deleted) return;
  item?.remove();
  _saveColumnDisplayOrderState(root);
  _updateColumnDisplayOrderModalState(root);
}

function showColumnDisplayOrderModal(ctxOrDbPath) {
  const ctx = ctxOrDbPath && typeof ctxOrDbPath === 'object'
    ? ctxOrDbPath
    : (typeof _currentPaneState === 'function' ? _currentPaneState() : null);
  const dbPath = typeof ctxOrDbPath === 'string' ? ctxOrDbPath : (ctx?.dbPath || state.currentDbPath);
  const pivotData = (typeof _dbPivotDataForContext === 'function' ? _dbPivotDataForContext(ctx) : null) || state.pivotData;
  if (!dbPath || !pivotData) return;
  const hiddenCols = getHiddenCols(dbPath, { ctx });
  const colOrder = _dbColumnDisplayOrderList(dbPath, ctx);
  const productionWriteBlocked = typeof isProductionManagementWriteBlocked === 'function'
    && isProductionManagementWriteBlocked(dbPath, ctx);

  const body = document.createElement('div');
  body.innerHTML = `<div class="col-vis-toolbar" ${productionWriteBlocked ? 'hidden' : ''}>
      <label class="col-vis-new-label" for="col-vis-new-name">列名</label>
      <input id="col-vis-new-name" type="text" placeholder="新しい列名">
      <button type="button" id="col-vis-add">${typeof lucide === 'function' ? lucide('plus', 14) : ''} 追加</button>
    </div>
    <div class="col-vis-summary" id="col-vis-summary"></div>
    <div class="col-vis-list" id="col-vis-list"></div>`;
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.id = 'col-vis-close';
  closeBtn.textContent = '閉じる';
  closeBtn.setAttribute('aria-label', '列の表示と順序を閉じる');
  const applyBtn = document.createElement('button');
  applyBtn.type = 'button';
  applyBtn.className = 'primary';
  applyBtn.id = 'col-vis-apply';
  applyBtn.textContent = '適用';
  const modalApi = window.GBUI.createModal({
    id: 'column-display-order-dialog',
    title: '列の表示と順序',
    body,
    footer: [closeBtn, applyBtn],
    variant: 'standard',
    extraClass: 'col-vis-modal',
    geometryKey: 'db-column-display-order',
    initialFocus: '#col-vis-new-name',
  });
  const o = modalApi.overlay;
  o.classList.add('modal-overlay');
  o.dataset.e2eId = 'column-display-order-dialog';
  o._columnDisplayOrderModalApi = modalApi;
  modalApi.modal.classList.add('modal');
  modalApi.footer.classList.add('btn-row');
  modalApi.open();
  o._dbPath = dbPath;
  o._dbCtx = ctx || null;
  o._productionWriteBlocked = productionWriteBlocked;
  closeBtn.addEventListener('click', () => modalApi.close('close-button'));
  o.querySelector('#col-vis-apply')?.addEventListener('click', () => applyColVisibility(o));
  o.querySelector('#col-vis-add')?.addEventListener('click', async (ev) => {
    const btn = ev.currentTarget;
    btn.disabled = true;
    try { await _addColumnFromDisplayOrderModal(o); }
    finally { if (btn.isConnected) btn.disabled = false; }
  });
  o.querySelector('#col-vis-new-name')?.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    o.querySelector('#col-vis-add')?.click();
  });

  // D&D対応のリスト生成
  const listEl = o.querySelector('#col-vis-list');
  colOrder.forEach(p => {
    _addColumnDisplayOrderItem(o, p, !hiddenCols.includes(p));
  });
  // 並べ替え: pointer events 版。
  // HTML5 DnD はドラッグ中に wheel イベントが届かない仕様のため、
  // 「端超えでもスクロール継続 + ドラッグ中ホイールスクロール」を満たす pointer 実装にする
  // （自動スクロールは MeldexDragAutoScroll 共通基盤）
  let pdrag = null; // { item, pointerId, startX, startY, started }
  const PDRAG_THRESHOLD = 4;
  listEl.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    if (e.target.closest('button,input')) return;
    // タッチはリストのスクロール操作と競合するため、ハンドルからのみ並べ替え開始
    if (e.pointerType === 'touch' && !e.target.closest('.col-vis-handle')) return;
    const item = e.target.closest('.col-vis-item[data-prop]');
    if (!item) return;
    pdrag = { item, pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, started: false };
    // preventDefault はしない（クリック・チェックボックス操作を殺さない）
  });
  listEl.addEventListener('pointermove', (e) => {
    if (!pdrag || e.pointerId !== pdrag.pointerId) return;
    if (!pdrag.started) {
      if (Math.abs(e.clientX - pdrag.startX) + Math.abs(e.clientY - pdrag.startY) < PDRAG_THRESHOLD) return;
      pdrag.started = true;
      pdrag.item.classList.add('is-dragging');
      try { listEl.setPointerCapture(e.pointerId); } catch {}
      window.MeldexDragAutoScroll?.beginPointerSession?.(e.clientX, e.clientY);
    }
    window.MeldexDragAutoScroll?.updatePointer?.(e.clientX, e.clientY);
    // 挿入位置はポインタのY座標基準（リスト外へはみ出している間は先頭/末尾へ寄せる）
    const items = [...listEl.querySelectorAll('.col-vis-item[data-prop]')].filter(it => it !== pdrag.item);
    if (!items.length) return;
    const y = e.clientY;
    const hit = items.find(it => {
      const r = it.getBoundingClientRect();
      return y >= r.top && y <= r.bottom;
    });
    if (hit) {
      const r = hit.getBoundingClientRect();
      if (y < r.top + r.height / 2) hit.before(pdrag.item);
      else hit.after(pdrag.item);
    } else if (y < items[0].getBoundingClientRect().top) {
      items[0].before(pdrag.item);
    } else if (y > items[items.length - 1].getBoundingClientRect().bottom) {
      items[items.length - 1].after(pdrag.item);
    }
  });
  const pdragEnd = (e) => {
    if (!pdrag || (e && e.pointerId !== pdrag.pointerId)) return;
    if (pdrag.started) {
      pdrag.item.classList.remove('is-dragging');
      try { listEl.releasePointerCapture(pdrag.pointerId); } catch {}
      window.MeldexDragAutoScroll?.endPointerSession?.();
    }
    pdrag = null;
  };
  listEl.addEventListener('pointerup', pdragEnd);
  listEl.addEventListener('pointercancel', pdragEnd);
  _updateColumnDisplayOrderModalState(o);
}

// 旧名互換: 実体は「列の表示と順序」ダイアログ。
function showColVisibilityModal(ctxOrDbPath) {
  return showColumnDisplayOrderModal(ctxOrDbPath);
}

function applyColVisibility(root) {
  const saved = _saveColumnDisplayOrderState(root, 'シート表示: 列の表示と順序');
  if (!saved) return;
  const overlay = root?.classList?.contains('modal-overlay') ? root : document.querySelector('.modal-overlay');
  if (overlay?._columnDisplayOrderModalApi) overlay._columnDisplayOrderModalApi.close('apply');
  else overlay?.remove();
  renderPivot(saved.ctx);
}

/* 複数条件フィルタモーダル → gb-db-advanced-filter.js に分離 */

/* ==============================
   プロパティ型システム
   ============================== */
// 型定義: text(default), select, multi-select, number, date, checkbox, link（旧urlは読込互換）
/* プロパティ型・値エディタ → gb-db-property-types.js に分離 */
