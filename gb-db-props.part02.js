  }

  items.push({ type: 'sep' });
  items.push({ label: lucide('trash2', 14) + ' プロパティを削除', danger: true, action: () => _deleteColumn(dbPath, propName, ctx) });

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

function _getEntryNameAutoPropertyColumns(dbPath, ctx) {
  const pivotData = (typeof _dbPivotDataForContext === 'function' ? _dbPivotDataForContext(ctx) : null) || state.pivotData || {};
  const allProps = Array.isArray(pivotData.properties) ? pivotData.properties : [];
  const hiddenCols = typeof getHiddenCols === 'function' ? (getHiddenCols(dbPath, { ctx }) || []) : [];
  const ordered = [];
  const add = (name) => {
    const prop = String(name || '').trim();
    if (!prop || ordered.includes(prop)) return;
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
  const props = _getEntryNameAutoPropertyColumns(targetDbPath, ctx);
  if (!props.length) {
    showStatus('名前に使える列がありません', true);
    return;
  }
  document.querySelectorAll('.modal-overlay[data-e2e-id="db-entry-name-autogen-dialog"]').forEach(el => el.remove());
  const defaults = new Set(_getDefaultEntryNameAutoProperties(props));
  const scopeLabel = entryPath ? (entityName || '選択エントリ') : '列全体';
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.dataset.e2eId = 'db-entry-name-autogen-dialog';
  overlay.innerHTML = `
    <div class="modal gbm-modal" style="max-width:520px">
      <h3>エントリ名を自動生成</h3>
      <div class="gbm-section">
        <div class="gbm-section-label">対象</div>
        <div class="muted" data-e2e-id="db-entry-name-autogen-scope">${esc(scopeLabel)}</div>
      </div>
      <div class="gbm-section">
        <div class="gbm-section-label">名前に使う列</div>
        <div class="gb-entry-name-autogen-list" data-e2e-id="db-entry-name-autogen-columns"></div>
      </div>
      <div class="btn-row">
        <button type="button" data-action="cancel">キャンセル</button>
        <button type="button" class="primary" data-action="run" data-e2e-id="db-entry-name-autogen-run">生成</button>
      </div>
    </div>`;
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
  overlay.querySelector('[data-action="cancel"]').addEventListener('click', () => overlay.remove());
  overlay.querySelector('[data-action="run"]').addEventListener('click', async (ev) => {
    const runBtn = ev.currentTarget;
    const propertyNames = [...overlay.querySelectorAll('input[type="checkbox"]:checked')].map(el => el.value);
    if (!propertyNames.length) {
      showStatus('名前に使う列を選択してください', true);
      return;
    }
    runBtn.disabled = true;
    const oldText = runBtn.textContent;
    runBtn.textContent = '生成中...';
    try {
      const payload = { db_path: targetDbPath, property_names: propertyNames };
      if (entryPath) payload.entry_path = entryPath;
      const res = await apiPost('/entity/auto-name', payload);
      if (typeof applyDbAutoEntityRenameResponse === 'function') applyDbAutoEntityRenameResponse(res);
      overlay.remove();
      const count = Number(res?.renamed_count || 0);
      showStatus(count ? `エントリ名を自動生成しました: ${count}件` : '生成できるエントリ名がありませんでした');
      if (typeof selectDatabase === 'function') {
        await selectDatabase(targetDbPath, ctx, { silent: true, skipRecent: true, skipNavPush: true });
      } else if (typeof renderPivot === 'function') {
        renderPivot(ctx);
      }
    } catch (err) {
      showStatus('エントリ名の自動生成に失敗: ' + (err?.message || err), true);
      runBtn.disabled = false;
      runBtn.textContent = oldText;
    }
  });
  document.body.appendChild(overlay);
}

// エントリ列の右クリックメニュー
// ギャラリー/カンバンカード右クリックメニュー
function showDbCardContextMenu(e, dbPath, entityName, propName) {
  closeColHeaderMenu();
  const ctx = typeof _dbPaneContextFromEvent === 'function'
    ? _dbPaneContextFromEvent(e?.target || e?.currentTarget, { dbPath })
    : null;
  const targetDbPath = ctx?.dbPath || dbPath || state.currentDbPath;
  const pivotData = (typeof _dbPivotDataForContext === 'function' ? _dbPivotDataForContext(ctx) : null) || state.pivotData;
  const menu = document.createElement('div');
  menu.className = 'gb-context-menu';
  const ep = _entityPath(targetDbPath, entityName, pivotData);
  const sourcePaneId = e?.target?.closest?.('.gb-pane')?.dataset?.paneId || '';
  // 上部にリネーム入力欄: エントリ名変更
  _addMenuRenameInput(menu, entityName, (newName) => {
    apiPost('/entity/rename', { path: ep, new_name: newName }).then(() => {
      if (typeof _dbUndoRename === 'function') _dbUndoRename(targetDbPath, entityName, newName, ctx);
      showStatus('名前を変更: ' + newName);
      if (typeof selectDatabase === 'function') selectDatabase(targetDbPath, ctx, { silent: true });
    }).catch(() => showStatus('名前の変更に失敗', true));
  }, { placeholder: 'エントリ名を変更...' });
  // 依存関係プロパティの有無を確認
  const pts = getPropertyTypes(targetDbPath);
  const hasDeps = _hasDependencyPairProps(pts);
  const items = [
    { icon: 'sparkles', label: 'エントリ名を自動生成...', e2eId: 'db-entry-row-autoname', action: () => {
      _showEntryNameAutoGeneratePopup({ dbPath: targetDbPath, ctx, entityName, entryPath: ep });
    } },
    { type: 'sep' },
    { icon: 'fileText', label: '詳細を開く', action: () => {
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
    ...(hasDeps ? [{ icon: 'gitBranch', label: '依存エントリを作成', action: () => _createDependentEntry(targetDbPath, entityName, undefined, ctx) }] : []),
    ...(propName && typeof startCellInlineAdd === 'function' ? [{ icon: 'plus', label: '候補値を追加', action: () => {
      const paneRoot = e?.target?.closest?.('.gb-pane') || document.body;
      const row = paneRoot.querySelector('tr[data-entity-name="' + CSS.escape(entityName) + '"]');
      const td = row?.querySelector('td[data-prop-name="' + CSS.escape(propName) + '"]');
      if (td) startCellInlineAdd(td, ep, entityName, propName);
    } }] : []),
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
            await window.GbDbCalendarSync.onEntryDeleted(targetDbPath, ep);
          }
        } catch {}
        showStatus('削除しました');
        selectDatabase(targetDbPath, ctx);
      }).catch(() => showStatus('削除に失敗', true));
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
  setTimeout(() => {
    const closer = (ev) => {
      const inAny = [...document.querySelectorAll('.gb-context-menu')].some(m => m.contains(ev.target));
      if (!inAny) { closeColHeaderMenu(); document.removeEventListener('pointerdown', closer); }
    };
    document.addEventListener('pointerdown', closer);
  }, 0);
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
    renderPivot(ctx);
  });
}

function showEntityColMenu(e) {
  closeColHeaderMenu();
  const ctx = typeof _dbPaneContextFromEvent === 'function'
    ? _dbPaneContextFromEvent(e?.target || e?.currentTarget, { dbPath: state.currentDbPath })
    : null;
  const dbPath = ctx?.dbPath || state.currentDbPath;

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
          selectDatabase(newPath, ctx, {
            silent: true,
            skipRecent: true,
            skipNavPush: true,
            skipSaveLastView: false,
          });
        }
      } catch (err) { showStatus('シート名変更失敗: ' + (err.message || err), true); }
    }, { placeholder: 'シート名を変更...' });
  }

  const pinnedColsList = getPinnedCols(dbPath, { ctx });
  const items = [
    { type: 'submenu', label: '並び替え', children: _makeDbGlobalSortMenuItems(dbPath, ctx) },
    // 互換テスト用: showUnifiedFilterModal()
    { label: 'フィルタ...', action: () => showUnifiedFilterModal({ ctx }) },
    { type: 'sep' },
    { label: lucide('sparkles', 14) + ' エントリ名を自動生成...', e2eId: 'db-entry-column-autoname', action: () => {
      _showEntryNameAutoGeneratePopup({ dbPath, ctx });
    } },
    { type: 'sep' },
    { label: lucide('listChecks', 14) + ' 列の表示と順序...', action: () => showColumnDisplayOrderModal(ctx) },
    {
      type: 'submenu',
      label: lucide('eye', 14) + ' 非表示列を表示',
      children: _makeHiddenColumnMenuItems(dbPath, ctx),
    },
    { label: '+ 依存関係プロパティ', action: () => _addDependencyPairProps(dbPath, ctx) },
    ...(pinnedColsList.length > 0 ? [{
      type: 'sep'
    }, {
      type: 'submenu',
      label: lucide('pinOff', 14) + ' 固定中の列を解除 (' + pinnedColsList.length + ')',
      children: [
        ...pinnedColsList.map(propName => ({
          label: '解除: ' + esc(propName),
          action: () => {
            setPinnedCols(dbPath, getPinnedCols(dbPath, { ctx }).filter(n => n !== propName), { ctx });
            if (typeof renderPivot === 'function') renderPivot(ctx);
          }
        })),
        { type: 'sep' },
        { label: 'すべて解除', action: () => {
            setPinnedCols(dbPath, [], { ctx });
            if (typeof renderPivot === 'function') renderPivot(ctx);
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
function _addDependencyPairProps(dbPath, ctx) {
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
  renderPivot(ctx);
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
  item.draggable = true;
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
  const copyBtn = _dbColumnActionButton('copy', '列を複製: ' + propName, '', '複製');
  const delBtn = _dbColumnActionButton('trash2', '列を削除: ' + propName, 'danger', '削除');
  copyBtn.addEventListener('click', () => _duplicateColumnFromDisplayOrderModal(root, propName, item));
  delBtn.addEventListener('click', () => _deleteColumnFromDisplayOrderModal(root, propName, item));
  actions.appendChild(copyBtn);
  actions.appendChild(delBtn);
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
  saveDbViewConfig(dbPath, c, { skipHistory: true });
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

  const o = document.createElement('div');
  o.className = 'modal-overlay';
  o.dataset.e2eId = 'column-display-order-dialog';

  o.innerHTML = `<div class="modal col-vis-modal">
    <h3>列の表示と順序</h3>
    <div class="col-vis-toolbar">
      <label class="col-vis-new-label" for="col-vis-new-name">列名</label>
      <input id="col-vis-new-name" type="text" placeholder="新しい列名">
      <button type="button" id="col-vis-add">${typeof lucide === 'function' ? lucide('plus', 14) : ''} 追加</button>
    </div>
    <div class="col-vis-summary" id="col-vis-summary"></div>
    <div class="col-vis-list" id="col-vis-list"></div>
    <div class="btn-row">
      <button type="button" id="col-vis-close">閉じる</button>
      <button class="primary" id="col-vis-apply">適用</button>
    </div>
  </div>`;
  document.body.appendChild(o);
  o._dbPath = dbPath;
  o._dbCtx = ctx || null;
  o.querySelector('#col-vis-close')?.addEventListener('click', () => o.remove());
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
  // D&D
  let dragItem = null;
  listEl.addEventListener('dragstart', (e) => {
    if (e.target.closest('button,input')) { e.preventDefault(); return; }
    dragItem = e.target.closest('.col-vis-item[data-prop]');
    if (dragItem) dragItem.classList.add('is-dragging');
  });
  listEl.addEventListener('dragover', (e) => { e.preventDefault(); const t = e.target.closest('.col-vis-item[data-prop]'); if (dragItem && t && t !== dragItem) { const r = t.getBoundingClientRect(); if (e.clientY < r.top + r.height / 2) t.before(dragItem); else t.after(dragItem); }});
  listEl.addEventListener('dragend', () => { if (dragItem) dragItem.classList.remove('is-dragging'); dragItem = null; });
  _updateColumnDisplayOrderModalState(o);
}

// 旧名互換: 実体は「列の表示と順序」ダイアログ。
function showColVisibilityModal(ctxOrDbPath) {
  return showColumnDisplayOrderModal(ctxOrDbPath);
}

function applyColVisibility(root) {
  const saved = _saveColumnDisplayOrderState(root, 'シート表示: 列の表示と順序');
  if (!saved) return;
  (root?.classList?.contains('modal-overlay') ? root : document.querySelector('.modal-overlay'))?.remove();
  renderPivot(saved.ctx);
}

/* 複数条件フィルタモーダル → gb-db-advanced-filter.js に分離 */

/* ==============================
   プロパティ型システム
   ============================== */
// 型定義: text(default), select, multi-select, number, date, checkbox, url
/* プロパティ型・値エディタ → gb-db-property-types.js に分離 */
