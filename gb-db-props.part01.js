/* プロパティ管理・モーダル・表示設定 — gb-database.js から分離 */

// プロパティタイプ → Lucideアイコン名マッピング
const PROP_TYPE_ICON = {
  text: 'alignLeft',
  number: 'hash',
  select: 'tag',
  'multi-select': 'tags',
  checkbox: 'checkSquare',
  date: 'calendar',
  url: 'globe',
  image: 'image',
  relation: 'link2',
  'multi-relation': 'link',
  user: 'user',
  'multi-user': 'users',
  formula: 'sigma',
  rollup: 'sigma',
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
    if (item.action && !item.disabled) el.addEventListener('click', (ev) => { ev.stopPropagation(); closeColHeaderMenu(); item.action(); });
    container.appendChild(el);
  });
}

function _dbOrderedPropertyNamesForMenu(dbPath, ctx) {
  const pivotData = (typeof _dbPivotDataForContext === 'function' ? _dbPivotDataForContext(ctx) : null)
    || ctx?.pivotData
    || state.pivotData
    || {};
  const allProps = Array.isArray(pivotData.properties) ? pivotData.properties : [];
  const propTypes = typeof getPropertyTypes === 'function' ? (getPropertyTypes(dbPath) || {}) : {};
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

function _makeHiddenColumnMenuItems(dbPath, ctx) {
  const hiddenCols = typeof getHiddenCols === 'function' ? (getHiddenCols(dbPath, { ctx }) || []) : [];
  const hiddenOrdered = _dbOrderedPropertyNamesForMenu(dbPath, ctx).filter(propName => hiddenCols.includes(propName));
  hiddenCols.forEach(propName => { if (!hiddenOrdered.includes(propName)) hiddenOrdered.push(propName); });
  if (!hiddenOrdered.length) return [{ label: '非表示の列はありません', disabled: true }];
  const showOne = (propName) => {
    const current = getHiddenCols(dbPath, { ctx }) || [];
    setHiddenCols(dbPath, current.filter(name => name !== propName), { ctx, detail: propName });
    if (typeof renderPivot === 'function') renderPivot(ctx);
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
        if (typeof renderPivot === 'function') renderPivot(ctx);
      },
    },
  ];
}

function _getDbSortConfigForView(dbPath, ctx) {
  return (typeof getDbSortConfig === 'function' ? getDbSortConfig(dbPath, { ctx }) : getDbViewConfig(dbPath).sortConfig)
    || { key: 'name', dir: 'asc' };
}

function _applyDbSortConfigForView(dbPath, sortConfig, detail, ctx) {
  if (typeof setDbSortConfig === 'function') {
    setDbSortConfig(dbPath, sortConfig, { detail, ctx });
  } else {
    const c = getDbViewConfig(dbPath);
    c.sortConfig = { ...sortConfig };
    saveDbViewConfig(dbPath, c, { historyLabel: 'シート表示: 並び替え', historyDetail: detail || '' });
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

function showDbSortMenu(e) {
  closeColHeaderMenu();
  closeAllDropdowns();
  const ctx = typeof _dbPaneContextFromEvent === 'function'
    ? _dbPaneContextFromEvent(e?.target || e?.currentTarget, { dbPath: state.currentDbPath })
    : null;
  const dbPath = ctx?.dbPath || state.currentDbPath;
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

function showColHeaderMenu(e, propName, colIndex) {
  closeColHeaderMenu();
  closeAllDropdowns();
  const ctx = typeof _dbPaneContextFromEvent === 'function'
    ? _dbPaneContextFromEvent(e?.target || e?.currentTarget, { dbPath: state.currentDbPath })
    : null;
  const dbPath = ctx?.dbPath || state.currentDbPath;
  const pinnedCols = getPinnedCols(dbPath, { ctx });
  const groupBy = getGroupBy(dbPath, ctx);

  const menu = document.createElement('div');
  menu.className = 'gb-context-menu';
  // 上部にリネーム入力欄: 列名変更（startHeaderInlineRename と同じロジック）
  _addMenuRenameInput(menu, propName, async (newName) => {
    if (typeof renameDbProperty === 'function') {
      await renameDbProperty(dbPath, propName, newName);
    }
    // 列選択状態の追従（選択列がリネームされた場合）
    if (typeof _getSelectedColumns === 'function' && typeof _setSelectedColumns === 'function') {
      const selected = _getSelectedColumns(dbPath).map(name => name === propName ? newName : name);
      _setSelectedColumns(dbPath, selected, newName);
    }
    if (typeof renderPivot === 'function') renderPivot(ctx);
  }, { placeholder: '列名を変更...' });

  const currentPtc = getPropertyTypes(dbPath)[propName] || { type: 'text' };
  const currentType = currentPtc.type || 'text';
  const currentUiType = typeof getPropertyTypeUiBaseType === 'function' ? getPropertyTypeUiBaseType(currentType) : currentType;

  // プロパティ型サブメニュー項目
  const typeItems = getPropertyTypeMenuItems();

  const items = [
    // プロパティ型（サブメニュー展開）— 選択時は型のみ変更、設定モーダルは開かない
    { type: 'submenu', label: lucide(getPropertyTypeIcon(currentType) || PROP_TYPE_ICON[currentType] || 'alignLeft', 14) + ' プロパティ型の変更',
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
          const savePromise = setPropertyType(dbPath, propName, cfg);
          if (currentType === 'image' && ti.type !== 'image') {
            Promise.resolve(savePromise).then(() => apiPost('/media/rebuild-refs', {})).catch(() => {});
          }
          renderPivot(ctx);
        }
      }))
    },
    // プロパティ型の設定（relation先DB・数式・ボタン等の詳細設定）
    { label: lucide('settings', 14) + ' プロパティ型の設定...', action: () => showPropertyTypeModal(propName, dbPath, ctx) },
    { type: 'sep' },
    // 並び替え（この列を基準に）
    { type: 'submenu', label: lucide('arrowUpDown', 14) + ' 並び替え', children: (() => {
      const sc = _getDbSortConfigForView(dbPath, ctx);
      return [
        { label: (sc.key === propName && sc.dir === 'asc' ? radioMark(true) : '　') + 'この列で昇順', action: () => _applyDbSortConfigForView(dbPath, { key: propName, dir: 'asc' }, propName + ' 昇順', ctx) },
        { label: (sc.key === propName && sc.dir === 'desc' ? radioMark(true) : '　') + 'この列で降順', action: () => _applyDbSortConfigForView(dbPath, { key: propName, dir: 'desc' }, propName + ' 降順', ctx) },
      ];
    })() },
    { type: 'submenu', label: 'このプロパティでグループ化', children: [
      { label: (groupBy === propName ? radioMark(true) : '　') + 'グループ化する', action: () => { setGroupBy(dbPath, propName, { ctx }); renderPivot(ctx); }},
      { label: (groupBy !== propName ? radioMark(true) : '　') + 'グループ化しない', action: () => { setGroupBy(dbPath, null, { ctx }); renderPivot(ctx); }},
    ]},
    { type: 'sep' },
    // 列操作サブメニュー
    { type: 'submenu', label: lucide('columns', 14) + ' 列操作',
      children: [
        { label: '\u2190 左に列を挿入', action: () => insertPropertyInline(propName, 'left', ctx || dbPath) },
        { label: '\u2192 右に列を挿入', action: () => insertPropertyInline(propName, 'right', ctx || dbPath) },
        { label: lucide('ruler', 14) + ' 列幅を数値指定...', action: () => _showBulkColumnWidthModal(propName, dbPath) },
        { label: lucide('listChecks', 14) + ' 列の表示と順序...', action: () => showColumnDisplayOrderModal(ctx) },
        { type: 'submenu', label: '列を固定', children: [
          { label: (pinnedCols.includes(propName) ? radioMark(true) : '　') + '固定する', action: () => {
            const pc = getPinnedCols(dbPath, { ctx });
            if (!pc.includes(propName)) setPinnedCols(dbPath, [...pc, propName], { ctx });
            renderPivot(ctx);
          }},
          { label: (!pinnedCols.includes(propName) ? radioMark(true) : '　') + '固定しない', action: () => {
            const pc = getPinnedCols(dbPath, { ctx });
            if (pc.includes(propName)) setPinnedCols(dbPath, pc.filter(c => c !== propName), { ctx });
            renderPivot(ctx);
          }},
        ]},
        { label: 'この列を非表示', action: () => {
          const hc = getHiddenCols(dbPath, { ctx });
          if (!hc.includes(propName)) setHiddenCols(dbPath, [...hc, propName], { ctx });
          renderPivot(ctx);
        }},
        {
          type: 'submenu',
          label: lucide('eye', 14) + ' 非表示列を表示',
          children: _makeHiddenColumnMenuItems(dbPath, ctx),
        },
      ]
    },
    { label: '条件付きカラー...', action: () => showConditionalColorModal(propName, dbPath, ctx) },
  ];

  // 編集制限サブメニュー
  const curLock = getColumnLock(dbPath, propName);
  const lockLabels = [
    { key: 'none',   label: '制限なし',       icon: 'lockOpen' },
    { key: 'admin',  label: '管理者のみ編集', icon: 'shield' },
    { key: 'locked', label: 'ロック',         icon: 'lock' },
  ];
  const curLockLabel = lockLabels.find(l => l.key === curLock)?.label || '制限なし';
  items.push({ type: 'sep' });
  items.push({
    type: 'submenu',
    label: lucide(curLock === 'locked' ? 'lock' : curLock === 'admin' ? 'shield' : 'lockOpen', 14) + ' 編集制限: ' + curLockLabel,
    children: lockLabels.map(l => ({
      label: (curLock === l.key ? radioMark(true) : '\u3000') + lucide(l.icon, 14) + ' ' + l.label,
      action: () => { setColumnLock(dbPath, propName, l.key); renderPivot(ctx); }
    }))
  });

  // date型: ステータス連動設定
  if (currentType === 'date') {
    const curAuto = currentPtc.autoFillOnStatus || '';
    items.push({ type: 'sep' });
    items.push({
      label: lucide('clock', 14) + ' ステータス連動' + (curAuto ? ': ' + esc(curAuto) : ''),
      action: () => {
        _showAutoFillStatusInput(dbPath, propName, currentPtc, curAuto);
      }
    });
