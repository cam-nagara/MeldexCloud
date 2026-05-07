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
    el.innerHTML = item.label;
    if (item.danger) el.classList.add('danger');
    if (item.action) el.addEventListener('click', (ev) => { ev.stopPropagation(); closeColHeaderMenu(); item.action(); });
    container.appendChild(el);
  });
}

function _getDbSortConfigForView(dbPath) {
  return (typeof getDbSortConfig === 'function' ? getDbSortConfig(dbPath) : getDbViewConfig(dbPath).sortConfig)
    || { key: 'name', dir: 'asc' };
}

function _applyDbSortConfigForView(dbPath, sortConfig, detail) {
  if (typeof setDbSortConfig === 'function') {
    setDbSortConfig(dbPath, sortConfig, { detail });
  } else {
    const c = getDbViewConfig(dbPath);
    c.sortConfig = { ...sortConfig };
    saveDbViewConfig(dbPath, c, { historyLabel: 'シート表示: 並び替え', historyDetail: detail || '' });
  }
  renderPivot();
}

function _makeDbGlobalSortMenuItems(dbPath) {
  const sc = _getDbSortConfigForView(dbPath);
  const items = [
    { label: (sc.key === 'name' && sc.dir === 'asc' ? radioMark(true) : '　') + '名前 昇順', action: () => _applyDbSortConfigForView(dbPath, { key: 'name', dir: 'asc' }, '名前 昇順') },
    { label: (sc.key === 'name' && sc.dir === 'desc' ? radioMark(true) : '　') + '名前 降順', action: () => _applyDbSortConfigForView(dbPath, { key: 'name', dir: 'desc' }, '名前 降順') },
    { label: (sc.key === 'manual' ? radioMark(true) : '　') + 'マニュアル', action: () => _applyDbSortConfigForView(dbPath, { key: 'manual', dir: 'asc' }, 'マニュアル') },
  ];
  if (state.pivotData?.properties?.length) {
    items.push({ type: 'sep' });
    state.pivotData.properties.forEach(p => {
      items.push({ label: (sc.key === p ? radioMark(true) : '　') + p, action: () => {
        const dir = sc.key === p && sc.dir === 'asc' ? 'desc' : 'asc';
        _applyDbSortConfigForView(dbPath, { key: p, dir }, p + ' ' + (dir === 'asc' ? '昇順' : '降順'));
      }});
    });
  }
  return items;
}

function showDbSortMenu(e) {
  closeColHeaderMenu();
  closeAllDropdowns();
  const dbPath = state.currentDbPath;
  if (!dbPath) return;
  const menu = document.createElement('div');
  menu.className = 'gb-context-menu';
  _renderColMenuItems(menu, _makeDbGlobalSortMenuItems(dbPath));
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
  const dbPath = state.currentDbPath;
  const pinnedCols = getPinnedCols(dbPath);
  const groupBy = getGroupBy(dbPath);

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
    if (typeof renderPivot === 'function') renderPivot();
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
        action: () => {
          if (ti.type === currentUiType && currentType === currentUiType) return;
          let opts = undefined;
          if (ti.type === 'select' || ti.type === 'multi-select') {
            const existingValues = new Set();
            if (state.pivotData) {
              Object.values(state.pivotData.entities).forEach(ent => {
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
            Promise.resolve(savePromise).then(() => apiPost('/media/rebuild-refs', {})).then(() => apiPost('/media/gc', {})).catch(() => {});
          }
          renderPivot();
        }
      }))
    },
    // プロパティ型の設定（relation先DB・数式・ボタン等の詳細設定）
    { label: lucide('settings', 14) + ' プロパティ型の設定...', action: () => showPropertyTypeModal(propName) },
    { type: 'sep' },
    // 並び替え（この列を基準に）
    { type: 'submenu', label: lucide('arrowUpDown', 14) + ' 並び替え', children: (() => {
      const sc = _getDbSortConfigForView(dbPath);
      return [
        { label: (sc.key === propName && sc.dir === 'asc' ? radioMark(true) : '　') + 'この列で昇順', action: () => _applyDbSortConfigForView(dbPath, { key: propName, dir: 'asc' }, propName + ' 昇順') },
        { label: (sc.key === propName && sc.dir === 'desc' ? radioMark(true) : '　') + 'この列で降順', action: () => _applyDbSortConfigForView(dbPath, { key: propName, dir: 'desc' }, propName + ' 降順') },
      ];
    })() },
    { type: 'submenu', label: 'このプロパティでグループ化', children: [
      { label: (groupBy === propName ? radioMark(true) : '　') + 'グループ化する', action: () => { setGroupBy(dbPath, propName); renderPivot(); }},
      { label: (groupBy !== propName ? radioMark(true) : '　') + 'グループ化しない', action: () => { setGroupBy(dbPath, null); renderPivot(); }},
    ]},
    { type: 'sep' },
    // 列操作サブメニュー
    { type: 'submenu', label: lucide('columns', 14) + ' 列操作',
      children: [
        { label: '\u2190 左に列を挿入', action: () => insertPropertyInline(propName, 'left') },
        { label: '\u2192 右に列を挿入', action: () => insertPropertyInline(propName, 'right') },
        { label: lucide('ruler', 14) + ' 列幅を数値指定...', action: () => _showBulkColumnWidthModal(propName) },
        { type: 'submenu', label: '列を固定', children: [
          { label: (pinnedCols.includes(propName) ? radioMark(true) : '　') + '固定する', action: () => {
            const pc = getPinnedCols(dbPath);
            if (!pc.includes(propName)) setPinnedCols(dbPath, [...pc, propName]);
            renderPivot();
          }},
          { label: (!pinnedCols.includes(propName) ? radioMark(true) : '　') + '固定しない', action: () => {
            const pc = getPinnedCols(dbPath);
            if (pc.includes(propName)) setPinnedCols(dbPath, pc.filter(c => c !== propName));
            renderPivot();
          }},
        ]},
        { label: 'この列を非表示', action: () => {
          const hc = getHiddenCols(dbPath);
          if (!hc.includes(propName)) setHiddenCols(dbPath, [...hc, propName]);
          renderPivot();
        }},
      ]
    },
    { label: '条件付きカラー...', action: () => showConditionalColorModal(propName) },
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
      action: () => { setColumnLock(dbPath, propName, l.key); renderPivot(); }
    }))
  });

  // date型: ステータス連動設定
  if (currentType === 'date') {
    const curAuto = currentPtc.autoFillOnStatus || '';
    items.push({ type: 'sep' });
    items.push({
      label: lucide('clock', 14) + ' ステータス連動' + (curAuto ? ': ' + curAuto : ''),
      action: () => {
        _showAutoFillStatusInput(dbPath, propName, currentPtc, curAuto);
      }
    });
