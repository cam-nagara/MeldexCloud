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
  'multi-link': 'link2',
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
    || (ctx?.containerEl && ctx.containerEl.querySelector?.(`#${MeldexEscape.cssIdent(ctx.tableId || 'pivot-table')}`))
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
      detail: boundaryToken === '__entity__' ? 'トピック名' : boundaryToken,
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
