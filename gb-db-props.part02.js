  }

  items.push({ type: 'sep' });
  items.push({ label: lucide('trash2', 14) + ' プロパティを削除', danger: true, action: () => _deleteColumn(dbPath, propName) });

  _renderColMenuItems(menu, items);

  // マウス位置を原点とするゼロサイズのアンカー矩形で positionPopup を呼ぶと、
  // zoom 補正 + ビューポートクランプが一括処理される。サブメニューの方向反転は
  // attachHoverSubmenu が自動処理する。
  document.body.appendChild(menu);
  positionPopup(menu, { left: e.clientX, right: e.clientX, top: e.clientY, bottom: e.clientY });

  setTimeout(() => {
    const closer = (ev) => {
      const inAny = [...document.querySelectorAll('.gb-context-menu')].some(m => m.contains(ev.target));
      if (!inAny) { closeColHeaderMenu(); document.removeEventListener('pointerdown', closer); }
    };
    document.addEventListener('pointerdown', closer);
  }, 0);
}

// エントリ列の右クリックメニュー
// ギャラリー/カンバンカード右クリックメニュー
function showDbCardContextMenu(e, dbPath, entityName) {
  closeColHeaderMenu();
  const menu = document.createElement('div');
  menu.className = 'gb-context-menu';
  const ep = _entityPath(dbPath, entityName);
  const sourcePaneId = e?.target?.closest?.('.gb-pane')?.dataset?.paneId || '';
  // 上部にリネーム入力欄: エントリ名変更
  _addMenuRenameInput(menu, entityName, (newName) => {
    apiPost('/entity/rename', { path: ep, new_name: newName }).then(() => {
      if (typeof _dbUndoRename === 'function') _dbUndoRename(dbPath, entityName, newName);
      showStatus('名前を変更: ' + newName);
      if (typeof selectDatabase === 'function') selectDatabase(dbPath, undefined, { silent: true });
    }).catch(() => showStatus('名前の変更に失敗', true));
  }, { placeholder: 'エントリ名を変更...' });
  // 依存関係プロパティの有無を確認
  const pts = getPropertyTypes(dbPath);
  const hasDeps = pts && (pts['先行'] || Object.values(pts).some(p => p.pairWith));
  const items = [
    { icon: 'panelRight', label: '詳細を開く', action: () => {
      if (typeof openEntityInSplit === 'function') openEntityInSplit(ep, entityName);
      else selectEntity(ep);
    } },
    { icon: 'layers-2', label: 'サブパネルで開く', action: () => {
      if (typeof openLinkInSubPanel === 'function') openLinkInSubPanel(ep, entityName, { linkType: 'entity', sourcePaneId });
      else selectEntity(ep);
    } },
    { icon: 'messagesSquare', label: 'チャットを開く', action: () => {
      if (typeof openEntityChatForPath === 'function') return openEntityChatForPath(ep);
      if (typeof openFileChat === 'function') return openFileChat(ep);
    } },
    { type: 'sep' },
    ...(hasDeps ? [{ icon: 'gitBranch', label: '依存エントリを作成', action: () => _createDependentEntry(dbPath, entityName) }] : []),
    { icon: 'link2', label: 'パスをコピー', action: () => {
      navigator.clipboard.writeText(ep).then(() => showStatus('パスをコピーしました'));
    }},
    { type: 'sep' },
    { icon: 'trash2', label: 'エントリを削除', danger: true, action: async () => {
      if (!await cfConfirm(entityName + ' を削除しますか？')) return;
      apiPost('/outliner/delete', { path: ep }).then(async () => {
        // Phase 2 §5.3: 連動カレンダーイベントを削除/orphan
        try {
          if (window.GbDbCalendarSync && typeof window.GbDbCalendarSync.onEntryDeleted === 'function') {
            await window.GbDbCalendarSync.onEntryDeleted(dbPath, ep);
          }
        } catch {}
        showStatus('削除しました');
        selectDatabase(dbPath);
      }).catch(() => showStatus('削除に失敗', true));
    }},
  ];
  items.forEach(item => {
    if (item.type === 'sep') { const s = document.createElement('div'); s.className = 'gb-context-menu-sep'; menu.appendChild(s); return; }
    const el = document.createElement('div');
    el.className = 'gb-context-menu-item';
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
  setTimeout(() => {
    const closer = (ev) => {
      const inAny = [...document.querySelectorAll('.gb-context-menu')].some(m => m.contains(ev.target));
      if (!inAny) { closeColHeaderMenu(); document.removeEventListener('pointerdown', closer); }
    };
    document.addEventListener('pointerdown', closer);
  }, 0);
}

/* 枠線設定モーダル（横線/縦線を個別にDB単位で設定） */
function showGridBorderModal() {
  const dbPath = state.currentDbPath;
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

  const o = document.createElement('div');
  o.className = 'modal-overlay';
  o.innerHTML = `<div class="modal gbm-modal">
    <h3>枠線設定</h3>
    <div class="gbm-sections">
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
    </div>
    <div class="btn-row">
      <button id="grid-border-cancel">閉じる</button>
      <button class="primary" id="grid-border-apply">適用</button>
    </div>
  </div>`;
  document.body.appendChild(o);

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

  o.querySelector('#grid-border-cancel').addEventListener('click', () => o.remove());
  o.querySelector('#grid-border-apply').addEventListener('click', () => {
    const c = getDbViewConfig(dbPath);
    const hColor = getColorSwatchValue(hColorInp, '#333333');
    const vColor = getColorSwatchValue(vColorInp, '#333333');
    c.gridH = { width: hWidthSel.value, color: hColor === '#333333' ? '' : hColor };
    c.gridV = { width: vWidthSel.value, color: vColor === '#333333' ? '' : vColor };
    saveDbViewConfig(dbPath, c, { historyLabel: 'シート表示: 枠線設定' });
    o.remove();
    renderPivot();
  });
}

function showEntityColMenu(e) {
  closeColHeaderMenu();
  const dbPath = state.currentDbPath;
  const thumbSize = getThumbnailSize(dbPath);
  const showFooter = typeof getShowFooter === 'function' ? getShowFooter(dbPath) : (getDbViewConfig(dbPath).showFooter || false);
  const statusOn = getStatusEnabled(dbPath);

  const menu = document.createElement('div');
  menu.className = 'gb-context-menu';
  // 上部にリネーム入力欄: DB 名変更
  if (dbPath) {
    const dbName = (dbPath.split('/').pop() || '');
    _addMenuRenameInput(menu, dbName, async (newName) => {
      try {
        const res = await apiPost('/outliner/rename', { old_path: dbPath, new_name: newName, type: 'database' });
        showStatus('シート名を変更しました');
        if (typeof refreshOutliner === 'function') refreshOutliner();
        const newPath = res?.new_path || dbPath.replace(/[^/]+$/, newName);
        if (typeof renameAppPathReferences === 'function') {
          renameAppPathReferences(dbPath, newPath, { label: newName, fileId: res?.file_id, type: 'database' });
        }
        if (typeof selectDatabase === 'function') {
          selectDatabase(newPath, undefined, {
            silent: true,
            skipRecent: true,
            skipNavPush: true,
            skipSaveLastView: false,
          });
        }
      } catch (err) { showStatus('シート名変更失敗: ' + (err.message || err), true); }
    }, { placeholder: 'シート名を変更...' });
  }

  const pinnedColsList = getPinnedCols(dbPath);
  const entityPinned = typeof getEntityColumnPinned === 'function'
    ? getEntityColumnPinned(dbPath)
    : getDbViewConfig(dbPath).entityColumnPinned !== false;
  const items = [
    { type: 'submenu', label: '並び替え', children: _makeDbGlobalSortMenuItems(dbPath) },
    { label: 'フィルタ...', action: () => showUnifiedFilterModal() },
    { type: 'sep' },
    { label: 'プロパティ管理...', action: () => showColVisibilityModal() },
    { label: '+ 依存関係プロパティ', action: () => _addDependencyPairProps(dbPath) },
    { type: 'sep' },
    // 表示設定サブメニュー
    { type: 'submenu', label: lucide('settings2', 14) + ' 表示設定',
      children: [
        { type: 'submenu', label: '集計行', children: [
          { label: (showFooter ? radioMark(true) : '　') + '表示', action: () => { if (typeof setShowFooter === 'function') setShowFooter(dbPath, true); else { const c = getDbViewConfig(dbPath); c.showFooter = true; saveDbViewConfig(dbPath, c, { historyLabel: 'シート表示: 集計行', historyDetail: '表示' }); } renderPivot(); }},
          { label: (!showFooter ? radioMark(true) : '　') + '非表示', action: () => { if (typeof setShowFooter === 'function') setShowFooter(dbPath, false); else { const c = getDbViewConfig(dbPath); c.showFooter = false; saveDbViewConfig(dbPath, c, { historyLabel: 'シート表示: 集計行', historyDetail: '非表示' }); } renderPivot(); }},
        ]},
        { type: 'submenu', label: 'サムネイル', children: [
          { label: (thumbSize === 'large' ? radioMark(true) : '　') + '大', action: () => { setThumbnailSize(dbPath, 'large'); renderPivot(); }},
          { label: (thumbSize !== 'large' ? radioMark(true) : '　') + '小', action: () => { setThumbnailSize(dbPath, 'small'); renderPivot(); }},
        ]},
        { type: 'submenu', label: 'ステータス機能', children: [
          { label: (statusOn ? radioMark(true) : '　') + 'オン（候補値の複数管理 + ステータスドット）', action: () => { setStatusEnabled(dbPath, true); renderPivot(); }},
          { label: (!statusOn ? radioMark(true) : '　') + 'オフ（1セル1値、ステータス UI 非表示）', action: () => { setStatusEnabled(dbPath, false); renderPivot(); }},
        ]},
        { label: '枠線設定...', action: () => showGridBorderModal() },
        { label: '条件付きカラー...', action: () => showConditionalColorPickerModal() },
      ]
    },
    { type: 'sep' },
    { type: 'submenu', label: lucide('pin', 14) + ' エントリ名列の固定', children: [
      { label: (entityPinned ? radioMark(true) : '　') + '固定する', action: () => {
        if (typeof setEntityColumnPinned === 'function') setEntityColumnPinned(dbPath, true);
        else {
          const c = getDbViewConfig(dbPath);
          c.entityColumnPinned = true;
          saveDbViewConfig(dbPath, c, {
            historyLabel: 'シート表示: エントリ名列固定',
            historyDetail: '固定',
          });
        }
        if (typeof renderPivot === 'function') renderPivot();
      }},
      { label: (!entityPinned ? radioMark(true) : '　') + '固定しない', action: () => {
        if (typeof setEntityColumnPinned === 'function') setEntityColumnPinned(dbPath, false);
        else {
          const c = getDbViewConfig(dbPath);
          c.entityColumnPinned = false;
          saveDbViewConfig(dbPath, c, {
            historyLabel: 'シート表示: エントリ名列固定',
            historyDetail: '解除',
          });
        }
        if (typeof renderPivot === 'function') renderPivot();
      }},
    ]},
    ...(pinnedColsList.length > 0 ? [{
      type: 'submenu',
      label: lucide('pinOff', 14) + ' 固定中の列を解除 (' + pinnedColsList.length + ')',
      children: [
        ...pinnedColsList.map(propName => ({
          label: '解除: ' + propName,
          action: () => {
            setPinnedCols(dbPath, getPinnedCols(dbPath).filter(n => n !== propName));
            if (typeof renderPivot === 'function') renderPivot();
          }
        })),
        { type: 'sep' },
        { label: 'すべて解除', action: () => {
            setPinnedCols(dbPath, []);
            if (typeof renderPivot === 'function') renderPivot();
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

  setTimeout(() => {
    const closer = (ev) => {
      const inAny = [...document.querySelectorAll('.gb-context-menu')].some(m => m.contains(ev.target));
      if (!inAny) { closeColHeaderMenu(); document.removeEventListener('pointerdown', closer); }
    };
    document.addEventListener('pointerdown', closer);
  }, 0);
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
function _addDependencyPairProps(dbPath) {
  const pts = getPropertyTypes(dbPath);
  // 既に存在する場合はスキップ
  if (pts['先行'] || pts['後続']) {
    showStatus('依存関係プロパティは既に存在します');
    return;
  }
  setPropertyType(dbPath, '先行', {
    type: 'multi-relation', relationDb: '', pairWith: '後続', dependencyDirection: 'target-to-entry'
  });
  setPropertyType(dbPath, '後続', {
    type: 'multi-relation', relationDb: '', pairWith: '先行', dependencyDirection: 'entry-to-target'
  });
  showStatus('依存関係プロパティを追加しました（先行 / 後続）');
  renderPivot();
}

// 依存エントリを作成
async function _createDependentEntry(dbPath, sourceEntityName, overrideCopyProps) {
  const pts = getPropertyTypes(dbPath);
  const entities = state.pivotData?.entities || {};
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

  const newPath = _entityPath(dbPath, newName);

  // コピー対象プロパティを決定
  const copyProps = overrideCopyProps || _getDependentCopyProps(dbPath, pts);
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
      const sourceBlockingVal = sourceBlockingVals[0];
      try {
        if (sourceBlockingVal) {
          const currentIds = (sourceBlockingVal.value || '').split(',').map(s => s.trim()).filter(Boolean);
          currentIds.push(newId);
          await _apiPutValue(sourceBlockingVal, { new_value: currentIds.join(', ') });
        } else {
          const sourcePath = _entityPath(dbPath, sourceEntityName);
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
  selectDatabase(dbPath);
}

// 依存エントリ作成時のコピー対象プロパティ
function _getDependentCopyProps(dbPath, pts) {
  const config = getDbViewConfig(dbPath);
  if (config.dependentCopyProps && config.dependentCopyProps.length > 0) {
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

// プロパティ管理モーダル（旧: 列の表示/非表示）
function showColVisibilityModal() {
  const dbPath = state.currentDbPath;
  if (!dbPath || !state.pivotData) return;
  const allProps = state.pivotData.properties;
  const hiddenCols = getHiddenCols(dbPath);
  const colOrder = getColOrder(dbPath) || [...allProps];

  // colOrderに入っていない新規プロパティを追加
  allProps.forEach(p => { if (!colOrder.includes(p)) colOrder.push(p); });

  const o = document.createElement('div');
  o.className = 'modal-overlay';

  o.innerHTML = `<div class="modal col-vis-modal">
    <h3>プロパティ管理</h3>
    <div class="col-vis-list" id="col-vis-list"></div>
    <div class="btn-row">
      <button data-action="this.closest('.modal-overlay').remove()">閉じる</button>
      <button class="primary" data-action="applyColVisibility()">適用</button>
    </div>
  </div>`;
  document.body.appendChild(o);

  // D&D対応のリスト生成
  const listEl = o.querySelector('#col-vis-list');
  colOrder.forEach(p => {
    const item = document.createElement('div');
    item.draggable = true;
    item.dataset.prop = p;
    item.className = 'col-vis-item';
    const handle = document.createElement('span');
    handle.textContent = '⠿';
    handle.className = 'col-vis-handle';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.dataset.prop = p;
    cb.checked = !hiddenCols.includes(p);
    const label = document.createElement('span');
    label.textContent = p;
    label.className = 'col-vis-label';
    item.appendChild(handle);
    item.appendChild(cb);
    item.appendChild(label);
    listEl.appendChild(item);
  });
  // D&D
  let dragItem = null;
  listEl.addEventListener('dragstart', (e) => { dragItem = e.target.closest('[data-prop]'); if (dragItem) dragItem.classList.add('is-dragging'); });
  listEl.addEventListener('dragover', (e) => { e.preventDefault(); const t = e.target.closest('[data-prop]'); if (t && t !== dragItem) { const r = t.getBoundingClientRect(); if (e.clientY < r.top + r.height / 2) t.before(dragItem); else t.after(dragItem); }});
  listEl.addEventListener('dragend', () => { if (dragItem) dragItem.classList.remove('is-dragging'); dragItem = null; });
}

function applyColVisibility() {
  const dbPath = state.currentDbPath;
  const listEl = document.getElementById('col-vis-list');
  if (!listEl) return;
  const items = listEl.querySelectorAll('[data-prop]');
  const hidden = [];
  const newOrder = [];
  items.forEach(item => {
    const p = item.dataset.prop;
    newOrder.push(p);
    const cb = item.querySelector('input[type=checkbox]');
    if (cb && !cb.checked) hidden.push(p);
  });
  const before = typeof captureDbViewConfigHistory === 'function' ? captureDbViewConfigHistory(dbPath) : null;
  const c = getDbViewConfig(dbPath);
  const view = typeof _getCurrentDbViewConfigEntryFromConfig === 'function'
    ? _getCurrentDbViewConfigEntryFromConfig(c)
    : null;
  const target = view || c;
  target.hiddenCols = hidden;
  target.colOrder = newOrder;
  saveDbViewConfig(dbPath, c, { skipHistory: true });
  if (typeof pushDbViewConfigHistory === 'function' && typeof captureDbViewConfigHistory === 'function') {
    pushDbViewConfigHistory(dbPath, 'シート表示: プロパティ管理', before, captureDbViewConfigHistory(dbPath));
  }
  document.querySelector('.modal-overlay')?.remove();
  renderPivot();
}

/* 複数条件フィルタモーダル → gb-db-advanced-filter.js に分離 */

/* ==============================
   プロパティ型システム
   ============================== */
// 型定義: text(default), select, multi-select, number, date, checkbox, url
/* プロパティ型・値エディタ → gb-db-property-types.js に分離 */
