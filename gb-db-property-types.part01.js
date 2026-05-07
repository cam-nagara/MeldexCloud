/* プロパティ型・値エディタ — gb-db-props.js から分離 */

function getPropertyTypes(dbPath) {
  // バックエンド（フォルダノート）を優先: property_types キーが存在すればそれを使う
  if (state.dbMetadata && 'property_types' in state.dbMetadata && state.dbMetadata.property_types !== null) {
    const backendTypes = state.dbMetadata.property_types || {};
    if (Object.keys(backendTypes).length > 0) return backendTypes;
    const localTypes = getDbViewConfig(dbPath).propertyTypes || {};
    return Object.keys(localTypes).length > 0 ? localTypes : backendTypes;
  }
  // フォールバック: localStorage（後方互換、オフライン対応）
  return getDbViewConfig(dbPath).propertyTypes || {};
}
function setPropertyType(dbPath, propName, typeConfig) {
  // localStorage にキャッシュ（従来通り）
  const c = getDbViewConfig(dbPath);
  if (!c.propertyTypes) c.propertyTypes = {};
  c.propertyTypes[propName] = typeConfig;
  saveDbViewConfig(dbPath, c);
  // state.dbMetadata にも反映
  if (state.dbMetadata) {
    if (!state.dbMetadata.property_types) state.dbMetadata.property_types = {};
    state.dbMetadata.property_types[propName] = typeConfig;
  }
  // バックエンドに永続保存
  return _savePropertyTypesToBackend(dbPath);
}

// 列を削除（設定のみ）: 候補値データは各エントリに残る
async function _deleteColumn(dbPath, propName) {
  if (!dbPath || !propName) return;
  const ok = await cfConfirm(
    `列「${propName}」を削除します。\n\n既存の候補値データはエントリに残りますが、表示されなくなります。\n（再度同名のプロパティを追加すれば値は復活します）\n\n削除しますか？`
  );
  if (!ok) return;

  // undo用スナップショット
  const oldCfg = JSON.parse(JSON.stringify(getDbViewConfig(dbPath)));
  const oldPT = (typeof getPropertyTypes === 'function' ? getPropertyTypes(dbPath)?.[propName] : null) || oldCfg.propertyTypes?.[propName];

  const c = getDbViewConfig(dbPath);
  _deleteViewConfigPropReferences(c, propName);
  (c.savedViews || []).forEach(view => _deleteViewConfigPropReferences(view, propName));
  if (c.propertyTypes) delete c.propertyTypes[propName];
  if (c.columnLocks) {
    delete c.columnLocks[propName];
    if (Object.keys(c.columnLocks).length === 0) delete c.columnLocks;
  }
  if (c.entryPropOrder) c.entryPropOrder = c.entryPropOrder.filter(n => n !== propName);
  if (c.propertyLayout && typeof removePropertyLayoutReferences === 'function') {
    c.propertyLayout = removePropertyLayoutReferences(c.propertyLayout, propName);
  }
  saveDbViewConfig(dbPath, c);

  // state.dbMetadata にも反映
  if (state.dbMetadata?.property_types) delete state.dbMetadata.property_types[propName];
  if (state.dbMetadata?.property_layout && typeof removePropertyLayoutReferences === 'function') {
    state.dbMetadata.property_layout = removePropertyLayoutReferences(state.dbMetadata.property_layout, propName);
  }

  // バックエンドに保存
  if (typeof updatePropertyLayoutForDelete === 'function') await updatePropertyLayoutForDelete(dbPath, propName);
  const savePromise = _savePropertyTypesToBackend(dbPath);
  if (oldPT?.type === 'image') {
    Promise.resolve(savePromise).then(() => apiPost('/media/rebuild-refs', {})).then(() => apiPost('/media/gc', {})).catch(() => {});
  }

  // Undo/Redo
  if (typeof historyPush === 'function' && typeof _dbScope === 'function') {
    historyPush('列削除: ' + propName,
      () => { // undo: 設定を復元
        saveDbViewConfig(dbPath, oldCfg);
        if (state.dbMetadata) {
          if (!state.dbMetadata.property_types) state.dbMetadata.property_types = {};
          if (oldPT) state.dbMetadata.property_types[propName] = oldPT;
        }
        _savePropertyTypesToBackend(dbPath);
        selectDatabase(dbPath);
      },
      () => { // redo: 再削除
        _deleteColumnNoConfirm(dbPath, propName);
      },
      _dbScope()
    );
  }

  selectDatabase(dbPath);
  showStatus(`列「${propName}」を削除しました`);
  // 列削除 → 該当 sheet_col/sheet_cell コメントを孤児化 (annotation_unification_plan.md §5.3)
  apiPost('/annotations/orphan-by-target', {
    target_kind: 'sheet_col',
    target_file: dbPath,
    item_id: propName,
    cascade_container: true,
  }).catch(() => {});
}

// 確認なしで列削除（redo用）
function _deleteColumnNoConfirm(dbPath, propName) {
  const c = getDbViewConfig(dbPath);
  const oldPT = (typeof getPropertyTypes === 'function' ? getPropertyTypes(dbPath)?.[propName] : null) || c.propertyTypes?.[propName];
  _deleteViewConfigPropReferences(c, propName);
  (c.savedViews || []).forEach(view => _deleteViewConfigPropReferences(view, propName));
  if (c.propertyTypes) delete c.propertyTypes[propName];
  if (c.columnLocks) { delete c.columnLocks[propName]; if (Object.keys(c.columnLocks).length === 0) delete c.columnLocks; }
  if (c.entryPropOrder) c.entryPropOrder = c.entryPropOrder.filter(n => n !== propName);
  if (c.propertyLayout && typeof removePropertyLayoutReferences === 'function') {
    c.propertyLayout = removePropertyLayoutReferences(c.propertyLayout, propName);
  }
  saveDbViewConfig(dbPath, c);
  if (state.dbMetadata?.property_types) delete state.dbMetadata.property_types[propName];
  if (state.dbMetadata?.property_layout && typeof removePropertyLayoutReferences === 'function') {
    state.dbMetadata.property_layout = removePropertyLayoutReferences(state.dbMetadata.property_layout, propName);
  }
  if (typeof updatePropertyLayoutForDelete === 'function') updatePropertyLayoutForDelete(dbPath, propName);
  const savePromise = _savePropertyTypesToBackend(dbPath);
  if (oldPT?.type === 'image') {
    Promise.resolve(savePromise).then(() => apiPost('/media/rebuild-refs', {})).then(() => apiPost('/media/gc', {})).catch(() => {});
  }
  selectDatabase(dbPath);
}

async function _savePropertyTypesToBackend(dbPath) {
  try {
    const allTypes = getPropertyTypes(dbPath);
    await apiPut('/db-metadata?path=' + encodeURIComponent(dbPath), {
      property_types: allTypes
    });
  } catch (e) {
    console.warn('プロパティ型設定のバックエンド保存に失敗:', e);
  }
}

function _escapeRegExpForPropName(text) {
  return String(text || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function _renameFormulaPropRefs(formula, oldName, newName) {
  if (typeof formula !== 'string' || !oldName) return formula;
  const re = new RegExp('prop\\(\\s*([\\\"\\\'])' + _escapeRegExpForPropName(oldName) + '\\1\\s*\\)', 'g');
  return formula.replace(re, (match, quote) => 'prop(' + quote + newName + quote + ')');
}

function _renamePropertyTypeReferences(cfg, oldName, newName) {
  if (!cfg || typeof cfg !== 'object') return;
  if (cfg.pairWith === oldName) cfg.pairWith = newName;
  if (cfg.cascadeFrom === oldName) cfg.cascadeFrom = newName;
  if (cfg.relationProp === oldName) cfg.relationProp = newName;
  if (cfg.relationDb === '' && cfg.bidirectionalProp === oldName) cfg.bidirectionalProp = newName;
  if (typeof cfg.formula === 'string') cfg.formula = _renameFormulaPropRefs(cfg.formula, oldName, newName);
  if (Array.isArray(cfg.actions)) {
    cfg.actions.forEach(action => {
      if (action.targetProp === oldName) action.targetProp = newName;
      if (Array.isArray(action.copyProps)) action.copyProps = action.copyProps.map(p => p === oldName ? newName : p);
    });
  }
  if (Array.isArray(cfg.sources)) {
    cfg.sources.forEach(src => {
      (src.matchRules || []).forEach(rule => {
        if (rule.myProp === oldName) rule.myProp = newName;
      });
    });
  }
  (cfg.calendarSync?.colorRules || []).forEach(rule => {
    if (rule?.when?.prop === oldName) rule.when.prop = newName;
  });
}

function _deleteViewConfigPropReferences(target, propName) {
  if (!target || typeof target !== 'object' || !propName) return;
  if (Array.isArray(target.colOrder)) target.colOrder = target.colOrder.filter(n => n !== propName);
  if (Array.isArray(target.pinnedCols)) target.pinnedCols = target.pinnedCols.filter(n => n !== propName);
  if (Array.isArray(target.hiddenCols)) target.hiddenCols = target.hiddenCols.filter(n => n !== propName);
  if (target.colWidths?.[propName] !== undefined) delete target.colWidths[propName];
  if (target.countTypes?.[propName] !== undefined) delete target.countTypes[propName];
  if (target.conditionalColors?.[propName] !== undefined) delete target.conditionalColors[propName];
  if (Array.isArray(target.advancedFilters)) {
    target.advancedFilters = target.advancedFilters.filter(filter => filter?.property !== propName && filter?.prop !== propName);
  }
  if (target.sortConfig?.key === propName) delete target.sortConfig;
  if (target.groupBy === propName) target.groupBy = null;
  if (target.entityNameProp === propName) target.entityNameProp = '';
  if (Array.isArray(target.fields)) target.fields = target.fields.filter(n => n !== propName);
  if (target.formConfig) _deleteViewConfigPropReferences(target.formConfig, propName);
  const ts = target.typeSpecific;
  if (ts && typeof ts === 'object') {
    if (ts.pivot?.groupBy === propName) ts.pivot.groupBy = null;
    if (ts.kanban?.groupBy === propName) ts.kanban.groupBy = '_status';
    const mapping = ts.calendar?.mapping;
    if (mapping && typeof mapping === 'object') {
      ['startProp', 'endProp', 'titleProp', 'colorProp', 'descriptionProp', 'locationProp', 'urlProp', 'calendarIdProp'].forEach(key => {
        if (mapping[key] === propName) mapping[key] = '';
      });
    }
    const timeline = ts.timeline;
    if (timeline && typeof timeline === 'object') {
      ['timeProp', 'endProp'].forEach(key => {
        if (timeline[key] === propName) timeline[key] = '';
      });
      if (timeline.rowProp === propName) timeline.rowProp = '_entity';
      if (Array.isArray(timeline.cardProps)) timeline.cardProps = timeline.cardProps.filter(n => n !== propName);
      if (timeline.colWidths?.[propName] !== undefined) delete timeline.colWidths[propName];
    }
    if (ts.chart?.xProperty === propName) ts.chart.xProperty = '';
    if (ts.chart?.yProperty === propName) ts.chart.yProperty = null;
    if (ts.graph?.colorProperty === propName) ts.graph.colorProperty = '';
    if (ts.form?.formConfig) _deleteViewConfigPropReferences(ts.form.formConfig, propName);
  }
  for (const key of ["required"]) {
    if (Array.isArray(target[key])) target[key] = target[key].filter(n => n !== propName);
  }
  for (const key of ["descriptions", "placeholders", "labels"]) {
    if (target[key]?.[propName] !== undefined) delete target[key][propName];
  }
}

function _renameViewConfigPropReferences(target, oldName, newName) {
  if (!target || typeof target !== 'object') return;
  if (Array.isArray(target.colOrder)) target.colOrder = target.colOrder.map(n => n === oldName ? newName : n);
  if (Array.isArray(target.pinnedCols)) target.pinnedCols = target.pinnedCols.map(n => n === oldName ? newName : n);
  if (Array.isArray(target.hiddenCols)) target.hiddenCols = target.hiddenCols.map(n => n === oldName ? newName : n);
  if (target.colWidths?.[oldName] !== undefined) {
    target.colWidths[newName] = target.colWidths[oldName];
    delete target.colWidths[oldName];
  }
  if (target.countTypes?.[oldName] !== undefined) {
    target.countTypes[newName] = target.countTypes[oldName];
    delete target.countTypes[oldName];
  }
  if (target.conditionalColors?.[oldName] !== undefined) {
    target.conditionalColors[newName] = target.conditionalColors[oldName];
    delete target.conditionalColors[oldName];
  }
  if (Array.isArray(target.advancedFilters)) {
    target.advancedFilters.forEach(filter => {
      if (filter?.property === oldName) filter.property = newName;
      if (filter?.prop === oldName) filter.prop = newName;
    });
  }
  if (target.sortConfig?.key === oldName) target.sortConfig.key = newName;
  if (target.groupBy === oldName) target.groupBy = newName;
  if (target.entityNameProp === oldName) target.entityNameProp = newName;
  if (Array.isArray(target.fields)) target.fields = target.fields.map(n => n === oldName ? newName : n);
  if (target.formConfig) _renameViewConfigPropReferences(target.formConfig, oldName, newName);
  const ts = target.typeSpecific;
  if (ts && typeof ts === 'object') {
    if (ts.pivot?.groupBy === oldName) ts.pivot.groupBy = newName;
    if (ts.kanban?.groupBy === oldName) ts.kanban.groupBy = newName;
    const mapping = ts.calendar?.mapping;
    if (mapping && typeof mapping === 'object') {
      ['startProp', 'endProp', 'titleProp', 'colorProp', 'descriptionProp', 'locationProp', 'urlProp', 'calendarIdProp'].forEach(key => {
        if (mapping[key] === oldName) mapping[key] = newName;
      });
    }
    const timeline = ts.timeline;
    if (timeline && typeof timeline === 'object') {
      ['timeProp', 'endProp', 'rowProp'].forEach(key => {
        if (timeline[key] === oldName) timeline[key] = newName;
      });
      if (Array.isArray(timeline.cardProps)) timeline.cardProps = timeline.cardProps.map(n => n === oldName ? newName : n);
      if (timeline.colWidths?.[oldName] !== undefined) {
        timeline.colWidths[newName] = timeline.colWidths[oldName];
        delete timeline.colWidths[oldName];
      }
    }
    if (ts.chart?.xProperty === oldName) ts.chart.xProperty = newName;
    if (ts.chart?.yProperty === oldName) ts.chart.yProperty = newName;
    if (ts.graph?.colorProperty === oldName) ts.graph.colorProperty = newName;
    if (ts.form?.formConfig) _renameViewConfigPropReferences(ts.form.formConfig, oldName, newName);
  }
  for (const key of ["required"]) {
    if (Array.isArray(target[key])) target[key] = target[key].map(n => n === oldName ? newName : n);
  }
  for (const key of ["descriptions", "placeholders", "labels"]) {
    if (target[key]?.[oldName] !== undefined) {
      target[key][newName] = target[key][oldName];
      delete target[key][oldName];
    }
  }
}

async function renameDbProperty(dbPath, oldName, newName) {
  if (!dbPath || !oldName || !newName || oldName === newName) return false;
  const c = getDbViewConfig(dbPath);
  if (Array.isArray(c.colOrder)) c.colOrder = c.colOrder.map(n => n === oldName ? newName : n);
  const pt = getPropertyTypes(dbPath);
  if (pt[oldName]) { pt[newName] = pt[oldName]; delete pt[oldName]; }
  Object.values(pt).forEach(cfg => _renamePropertyTypeReferences(cfg, oldName, newName));
  c.propertyTypes = pt;
  if (c.colWidths?.[oldName] !== undefined) { c.colWidths[newName] = c.colWidths[oldName]; delete c.colWidths[oldName]; }
  if (c.columnLocks?.[oldName]) {
    c.columnLocks[newName] = c.columnLocks[oldName];
    delete c.columnLocks[oldName];
  }
  if (c.countTypes?.[oldName]) {
    c.countTypes[newName] = c.countTypes[oldName];
    delete c.countTypes[oldName];
  }
  if (Array.isArray(c.pinnedCols)) c.pinnedCols = c.pinnedCols.map(n => n === oldName ? newName : n);
  if (Array.isArray(c.hiddenCols)) c.hiddenCols = c.hiddenCols.map(n => n === oldName ? newName : n);
  if (Array.isArray(c.entryPropOrder)) c.entryPropOrder = c.entryPropOrder.map(n => n === oldName ? newName : n);
  if (c.propertyLayout && typeof renamePropertyLayoutReferences === 'function') {
    c.propertyLayout = renamePropertyLayoutReferences(c.propertyLayout, oldName, newName);
  }
  if (Array.isArray(c.advancedFilters)) {
    c.advancedFilters.forEach(filter => {
      if (filter?.property === oldName) filter.property = newName;
      if (filter?.prop === oldName) filter.prop = newName;
    });
  }
  if (c.conditionalColors?.[oldName]) {
    c.conditionalColors[newName] = c.conditionalColors[oldName];
    delete c.conditionalColors[oldName];
  }
  if (c.sortConfig?.key === oldName) c.sortConfig.key = newName;
  if (c.groupBy === oldName) c.groupBy = newName;
  if (c.formConfig) _renameViewConfigPropReferences(c.formConfig, oldName, newName);
  _renameViewConfigPropReferences(c, oldName, newName);
  (c.savedViews || []).forEach(view => _renameViewConfigPropReferences(view, oldName, newName));
  saveDbViewConfig(dbPath, c);
  if (state.dbMetadata) {
    state.dbMetadata.property_types = pt;
    if (state.dbMetadata.property_layout && typeof renamePropertyLayoutReferences === 'function') {
      state.dbMetadata.property_layout = renamePropertyLayoutReferences(state.dbMetadata.property_layout, oldName, newName);
    }
  }
  const entities = state.pivotData?.entities || {};
  for (const ent of Object.values(entities)) {
    const vals = ent?.[oldName];
    if (!Array.isArray(vals)) continue;
    const moveVals = vals.slice().sort((a, b) => (Number(b?.candidate_index) || 0) - (Number(a?.candidate_index) || 0));
    for (const val of moveVals) {
      try { await _apiPutValue(val, { new_property: newName }); } catch {}
    }
    ent[newName] = vals.map(v => ({ ...v, property: newName }));
    delete ent[oldName];
  }
  if (typeof updatePropertyLayoutForRename === 'function') {
    await updatePropertyLayoutForRename(dbPath, oldName, newName);
  }
  await _savePropertyTypesToBackend(dbPath);
  return true;
}

function showPropertyTypeModal(propName) {
  const dbPath = state.currentDbPath;
  if (!dbPath) return;
  const types = getPropertyTypes(dbPath);
  const current = types[propName] || { type: 'text' };

  // Select型の既存オプションを収集
  const existingValues = new Set();
  if (state.pivotData) {
    Object.values(state.pivotData.entities).forEach(ent => {
      (ent[propName] || []).forEach(v => existingValues.add(v.value));
    });
  }

  const o = document.createElement('div');
  o.className = 'modal-overlay';
  const scopeId = 'modal-' + Math.random().toString(36).slice(2, 8);
  o.innerHTML = `<div class="modal pt-modal" data-pt-root>
    <h3>プロパティ型の設定</h3>
    <div class="modal-body">
      <div class="gb-section-desc">プロパティ: ${esc(propName)}</div>
      <div class="field"><label>型</label>
        <select id="pt-type" data-onchange="onPropertyTypeChange(this.closest('[data-pt-root]'))">
          ${renderPropertyTypeOptions(current.type)}
        </select>
      </div>
      ${_renderPropertyMultiplicityControls(current.type, scopeId)}
      <div id="pt-options"></div>
    </div>
    <div class="btn-row">
      <button data-action="this.closest('.modal-overlay').remove()">キャンセル</button>
      <button class="primary" id="modal-pt-apply">適用</button>
    </div>
  </div>`;
  document.body.appendChild(o);
  const root = o.querySelector('[data-pt-root]');
  // propName の ' や \ を保護するため直接バインド
  root.querySelector('#modal-pt-apply').addEventListener('click', () => applyPropertyType(propName, root));

  // 型別オプションを表示
  _ptSetState(root, current, [...existingValues], propName);
  onPropertyTypeChange(root);
}

// DB一覧から選択するピッカー（relation参照先DB・MSRソース用）
let _dbListCache = null;
async function _getAllDatabases() {
  if (_dbListCache) return _dbListCache;
  try { _dbListCache = await apiFetch('/databases'); } catch { _dbListCache = []; }
  return _dbListCache;
}
function _attachDbPicker(input) {
  // inputの隣にピッカーボタンを追加
  if (input.dataset.dbPickerAttached) return;
  input.dataset.dbPickerAttached = '1';
  let row = input.parentNode;
  if (!row || !row.classList || !row.classList.contains('db-picker-input-row')) {
    row = document.createElement('div');
    row.className = 'db-picker-input-row';
    input.parentNode.insertBefore(row, input);
    row.appendChild(input);
  }
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'db-picker-btn';
  btn.innerHTML = lucide('db', 14);
  btn.title = 'シート一覧から選択';
  btn.setAttribute('aria-label', 'シート一覧から選択');
  btn.addEventListener('click', async (e) => {
    e.preventDefault(); e.stopPropagation();
    document.querySelectorAll('.db-picker-popup').forEach(el => el.remove());
    const dbs = await _getAllDatabases();
    const pop = document.createElement('div');
    pop.className = 'db-picker-popup';
    const search = document.createElement('input');
    search.type = 'text'; search.placeholder = 'シート名で検索...';
    pop.appendChild(search);
    const list = document.createElement('div');
    const render = (filter) => {
      list.innerHTML = '';
      const f = (filter || '').toLowerCase();
      const filtered = f ? dbs.filter(d => d.path.toLowerCase().includes(f) || d.name.toLowerCase().includes(f)) : dbs;
      if (filtered.length === 0) {
        const m = document.createElement('div');
        m.className = 'db-picker-empty';
        m.textContent = '該当なし';
        list.appendChild(m);
        return;
      }
      filtered.forEach(d => {
        const item = document.createElement('div');
        item.className = 'dd-nav-item';
        item.innerHTML = `<div class="db-picker-name">${lucide('db', 12)} ${esc(d.name)}</div>`
          + `<div class="db-picker-path">${esc(d.path)}</div>`;
        item.addEventListener('click', () => {
          input.value = d.path;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
          pop.remove();
        });
        list.appendChild(item);
      });
    };
    render('');
    search.addEventListener('input', () => render(search.value));
    pop.appendChild(list);
    const rect = btn.getBoundingClientRect();
    { const z = _getZoom(); pop.style.left = Math.min(rect.left / z, window.innerWidth / z - 440) + 'px'; pop.style.top = (rect.bottom / z + 4) + 'px'; }
    document.body.appendChild(pop);
    clampPopupToViewport(pop);
    setTimeout(() => {
      search.focus();
      const closer = (ev) => { if (!pop.contains(ev.target) && ev.target !== btn) { pop.remove(); document.removeEventListener('pointerdown', closer); } };
      document.addEventListener('pointerdown', closer);
    }, 50);
  });
  row.appendChild(btn);
}

// マルチソースリレーション設定UI描画
function _renderMsrSources(sources, mode, root) {
  const scope = _ptResolveRoot(root);
  const container = _ptGet('pt-msr-sources', scope);
  if (!container) return;
  container.innerHTML = '';
  const myProps = state.pivotData ? state.pivotData.properties : [];

  sources.forEach((src, idx) => {
    const div = document.createElement('div');
    div.className = 'msr-source-row';

    // DB パス
    const dbRow = document.createElement('div');
    dbRow.className = 'msr-field-row';
    dbRow.innerHTML = '<span>シート:</span>';
    const dbInput = document.createElement('input');
    dbInput.type = 'text'; dbInput.className = 'msr-db-input';
    dbInput.value = src.db || ''; dbInput.placeholder = '例: 開発/デバッグリスト';
    dbRow.appendChild(dbInput);
    _attachDbPicker(dbInput);
    div.appendChild(dbRow);

    // ラベル
    const lblRow = document.createElement('div');
    lblRow.className = 'msr-field-row';
    lblRow.innerHTML = '<span>ラベル:</span>';
    const lblInput = document.createElement('input');
    lblInput.type = 'text'; lblInput.className = 'msr-label-input';
    lblInput.value = src.label || ''; lblInput.placeholder = '(シート名から自動生成)';
    lblRow.appendChild(lblInput);
    div.appendChild(lblRow);

    // マッチ条件（自動モード時のみ）
    if (mode === 'auto') {
      const rulesDiv = document.createElement('div');
      rulesDiv.className = 'msr-rules';
      const rulesLabel = document.createElement('div');
      rulesLabel.className = 'msr-rules-label';
      rulesLabel.textContent = 'マッチ条件:';
      rulesDiv.appendChild(rulesLabel);

      const rules = src.matchRules || [];
      rules.forEach((rule, ri) => {
        const ruleRow = document.createElement('div');
        ruleRow.className = 'msr-rule-row';

        // 自DBプロパティ
        const mySelect = document.createElement('select');
        mySelect.className = 'msr-my-prop';
        myProps.forEach(p => { const o = document.createElement('option'); o.value = p; o.textContent = p; if (p === rule.myProp) o.selected = true; mySelect.appendChild(o); });
        ruleRow.appendChild(mySelect);

        ruleRow.appendChild(document.createTextNode(' = 参照先の '));

        // 参照先プロパティ（テキスト入力）
        const remoteInput = document.createElement('input');
        remoteInput.type = 'text'; remoteInput.className = 'msr-remote-prop';
        remoteInput.value = rule.remoteProp || ''; remoteInput.placeholder = 'プロパティ名';
        remoteInput.className = 'msr-remote-prop';
        ruleRow.appendChild(remoteInput);

        // 削除ボタン
        const delRule = document.createElement('button');
        delRule.innerHTML = lucide('x', 12); delRule.className = 'pt-small-btn';
        delRule.addEventListener('click', () => {
          const s = _collectMsrSources(scope);
          s[idx].matchRules.splice(ri, 1);
          _renderMsrSources(s, mode, scope);
        });
        ruleRow.appendChild(delRule);
        rulesDiv.appendChild(ruleRow);
      });

      // + 条件追加
      const addRule = document.createElement('button');
      addRule.textContent = '+ 条件を追加'; addRule.className = 'pt-small-btn';
      addRule.addEventListener('click', () => {
        const s = _collectMsrSources(scope);
        if (!s[idx].matchRules) s[idx].matchRules = [];
        s[idx].matchRules.push({ myProp: '', remoteProp: '' });
        _renderMsrSources(s, mode, scope);
      });
      rulesDiv.appendChild(addRule);
      div.appendChild(rulesDiv);
    }

    // ソース削除
    const delBtn = document.createElement('button');
    delBtn.innerHTML = lucide('x', 12) + ' ソース削除'; delBtn.className = 'pt-small-btn muted';
    delBtn.addEventListener('click', () => {
      const s = _collectMsrSources(scope);
      s.splice(idx, 1);
      _renderMsrSources(s, mode, scope);
    });
    div.appendChild(delBtn);

    container.appendChild(div);
  });
}

// マルチソースリレーション設定をUIから収集
function _collectMsrSources(root) {
  const container = _ptGet('pt-msr-sources', root);
  if (!container) return [];
  const sources = [];
  container.querySelectorAll('.msr-source-row').forEach(row => {
    const src = {
      db: row.querySelector('.msr-db-input')?.value?.trim() || '',
      label: row.querySelector('.msr-label-input')?.value?.trim() || '',
    };
    const rules = [];
    row.querySelectorAll('.msr-rules > div:not(:last-child)').forEach(ruleRow => {
      if (!ruleRow.querySelector('.msr-my-prop')) return;
      rules.push({
        myProp: ruleRow.querySelector('.msr-my-prop')?.value || '',
        remoteProp: ruleRow.querySelector('.msr-remote-prop')?.value || '',
      });
    });
    if (rules.length > 0) src.matchRules = rules;
    sources.push(src);
  });
  return sources;
}

// ボタンプロパティのアクション設定UI描画
function _renderButtonActions(actions, root) {
  const scope = _ptResolveRoot(root);
  const container = _ptGet('pt-btn-actions', scope);
  if (!container) return;
  container.innerHTML = '';
  const allProps = state.pivotData ? state.pivotData.properties : [];
  const actionTypes = [
    { value: 'set-value', label: '値を設定' },
    { value: 'set-current-user', label: '現在のユーザーを設定' },
    { value: 'set-now', label: '現在の日時を設定' },
    { value: 'create-dependent', label: '依存エントリを作成' },
  ];

  actions.forEach((act, idx) => {
    const row = document.createElement('div');
    row.className = 'btn-action-row';

    // アクション型選択
    const typeSelect = document.createElement('select');
    typeSelect.className = 'btn-action-type';
    actionTypes.forEach(at => {
      const opt = document.createElement('option');
      opt.value = at.value; opt.textContent = at.label;
      if (at.value === act.type) opt.selected = true;
      typeSelect.appendChild(opt);
    });
    row.appendChild(typeSelect);

    // パラメータ部分
    const paramDiv = document.createElement('span');
    paramDiv.className = 'btn-action-params';
    const renderParams = (type) => {
      paramDiv.innerHTML = '';
      if (type === 'set-value') {
        const propSel = document.createElement('select');
        propSel.className = 'btn-action-target';
        allProps.forEach(p => { const o = document.createElement('option'); o.value = p; o.textContent = p; if (p === act.targetProp) o.selected = true; propSel.appendChild(o); });
        paramDiv.appendChild(propSel);
        paramDiv.appendChild(document.createTextNode(' = '));
        const valInput = document.createElement('input');
        valInput.type = 'text'; valInput.className = 'btn-action-value';
        valInput.value = act.value || ''; valInput.placeholder = '値';
        paramDiv.appendChild(valInput);
      } else if (type === 'set-current-user' || type === 'set-now') {
        const propSel = document.createElement('select');
        propSel.className = 'btn-action-target';
        allProps.forEach(p => { const o = document.createElement('option'); o.value = p; o.textContent = p; if (p === act.targetProp) o.selected = true; propSel.appendChild(o); });
        paramDiv.appendChild(propSel);
      } else if (type === 'create-dependent') {
        const selected = new Set(Array.isArray(act.copyProps) ? act.copyProps : []);
        const wrap = document.createElement('div');
        wrap.className = 'btn-action-copy-props';
        wrap.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;max-height:96px;overflow:auto;';
        allProps.forEach(p => {
          const lbl = document.createElement('label');
          lbl.style.cssText = 'display:inline-flex;align-items:center;gap:3px;font-size:12px;';
          const cb = document.createElement('input');
          cb.type = 'checkbox';
          cb.className = 'btn-action-copy-prop';
          cb.value = p;
          cb.checked = selected.has(p);
          lbl.appendChild(cb);
          lbl.appendChild(document.createTextNode(p));
          wrap.appendChild(lbl);
        });
        paramDiv.appendChild(wrap);
      }
    };
    renderParams(act.type);
    typeSelect.addEventListener('change', () => {
      act.type = typeSelect.value;
      act.targetProp = ''; act.value = ''; act.copyProps = [];
      renderParams(typeSelect.value);
    });
    row.appendChild(paramDiv);

    // 削除ボタン
    const delBtn = document.createElement('button');
    delBtn.innerHTML = lucide('x', 12); delBtn.title = '削除';
    delBtn.className = 'pt-small-btn muted';
    delBtn.addEventListener('click', () => {
      const acts = _collectButtonActions(scope);
      acts.splice(idx, 1);
      _renderButtonActions(acts, scope);
    });
    row.appendChild(delBtn);

    container.appendChild(row);
  });
}

// ボタンプロパティのアクション設定をUIから収集
function _collectButtonActions(root) {
  const container = _ptGet('pt-btn-actions', root);
  if (!container) return [];
  const actions = [];
  container.querySelectorAll('.btn-action-row').forEach(row => {
    const type = row.querySelector('.btn-action-type')?.value || 'set-value';
    const act = { type };
    if (type === 'set-value') {
      act.targetProp = row.querySelector('.btn-action-target')?.value || '';
      act.value = row.querySelector('.btn-action-value')?.value || '';
    } else if (type === 'set-current-user' || type === 'set-now') {
      act.targetProp = row.querySelector('.btn-action-target')?.value || '';
    } else if (type === 'create-dependent') {
      act.copyProps = [...row.querySelectorAll('.btn-action-copy-prop:checked')].map(cb => cb.value);
    }
    actions.push(act);
  });
  return actions;
}

// ボタンアクション実行エンジン
async function _executeButtonActions(dbPath, entityName, actions) {
  const entityPath = _entityPath(dbPath, entityName);

  for (const action of actions) {
    switch (action.type) {
      case 'set-value': {
        const entityData = state.pivotData?.entities?.[entityName];
        if (!entityData) break;
        const target = getAdoptedValueForWrite(entityData[action.targetProp] || []);
        if (target) {
          const oldVal = target.value;
          await _apiPutValue(target, { new_value: action.value });
          _dbUndoValue(action.targetProp, target, oldVal, action.value);
        } else {
          await _apiPostValue(entityPath, action.targetProp, action.value, '採用', '');
        }
        break;
      }
      case 'set-current-user': {
        const username = typeof getUsername === 'function' ? getUsername() : 'anonymous';
        const entityData = state.pivotData?.entities?.[entityName];
        if (!entityData) break;
        const target = getAdoptedValueForWrite(entityData[action.targetProp] || []);
        if (target) {
          const oldVal = target.value;
          await _apiPutValue(target, { new_value: username });
          _dbUndoValue(action.targetProp, target, oldVal, username);
        } else {
          await _apiPostValue(entityPath, action.targetProp, username, '採用', '');
        }
        break;
      }
      case 'set-now': {
        const propTypes = dbPath ? getPropertyTypes(dbPath) : {};
        const targetPtc = propTypes[action.targetProp] || null;
        const now = typeof _dbDateCurrentValue === 'function'
          ? _dbDateCurrentValue(targetPtc)
          : new Date().toISOString().substring(0, 10);
        const entityData = state.pivotData?.entities?.[entityName];
        if (!entityData) break;
        const target = getAdoptedValueForWrite(entityData[action.targetProp] || []);
        if (target) {
          const oldVal = target.value;
          await _apiPutValue(target, { new_value: now });
          _dbUndoValue(action.targetProp, target, oldVal, now);
        } else {
          await _apiPostValue(entityPath, action.targetProp, now, '採用', '');
        }
        break;
      }
      case 'create-dependent': {
        await _createDependentEntry(dbPath, entityName, action.copyProps);
        break;
      }
    }
  }

  if (state.currentDbPath) selectDatabase(state.currentDbPath);
}

// Phase 3 §5.1: カレンダー連動設定エディタ（date 型プロパティ用）
// calendarSync メタの targetDb / colorRules / テンプレ / onEntryDelete / reverseSync / writeStatus を UI で編集。
// 汎用性（N1）: 特定DB名をハードコードせず、汎用 DB パスピッカーで選択する。
function _renderCalendarSyncEditor(cs) {
  const enabled = !!cs;
  const safe = cs || {};
  const rules = Array.isArray(safe.colorRules) ? safe.colorRules : [];
  const rsObj = safe.reverseSync || {};
  const colorRulesJson = rules.length ? JSON.stringify(rules, null, 2) : '';
  return `
    <div class="gb-section-head" style="margin-top:12px;border-top:1px solid var(--border);padding-top:8px;">
      <label class="pt-check-label">
        <input id="pt-calsync-enabled" type="checkbox" ${enabled ? 'checked' : ''}>
        カレンダー連動を有効にする
      </label>
      <div class="pt-hint">有効にすると、このプロパティに日時を設定したときに対象カレンダーシートへイベントが自動生成されます（Phase 1 §5.2）。</div>
    </div>
    <div id="pt-calsync-body" style="${enabled ? '' : 'display:none;'}padding-left:8px;border-left:2px solid var(--border);margin-top:6px;">
      <div class="field"><label>対象カレンダーシート（フォルダパス）</label>
        <input id="pt-calsync-target-db" type="text" value="${esc(safe.targetDb || '')}" placeholder="例: ShareDevelop/Meldex開発/カレンダー/AI修正スケジュール">
      </div>
      <div class="field"><label>タイトルテンプレート</label>
        <input id="pt-calsync-title-tmpl" type="text" value="${esc(safe.titleTemplate || '{entryName}')}" placeholder="{entryName}">
        <div class="pt-hint">利用可能: {entryName} / {entryPath} / {entryId}</div>
      </div>
      <div class="field"><label>説明テンプレート</label>
        <textarea id="pt-calsync-desc-tmpl" rows="3" placeholder="デバッグリストエントリ: {entryPath}">${esc(safe.descriptionTemplate || '')}</textarea>
        <div class="pt-hint">テンプレ変数に加え、エントリの採用プロパティ名も {プロパティ名} で参照可能。</div>
      </div>
      <div class="field"><label>色ルール (JSON 配列)</label>
        <textarea id="pt-calsync-color-rules" rows="5" placeholder='[
  { "when": { "prop": "進捗", "equals": "完了" }, "color": "#6a9955" },
  { "default": "#569cd6" }
]'>${esc(colorRulesJson)}</textarea>
        <div class="pt-hint">上から評価。最初にマッチしたルールの color を使用。default ルールがフォールバック。</div>
      </div>
      <div class="field"><label>エントリ削除時の挙動</label>
        <select id="pt-calsync-on-entry-delete">
          <option value="deleteEvent" ${(safe.onEntryDelete || 'deleteEvent') === 'deleteEvent' ? 'selected' : ''}>イベントも削除</option>
          <option value="orphan" ${safe.onEntryDelete === 'orphan' ? 'selected' : ''}>孤立マーク（残す）</option>
          <option value="ignore" ${safe.onEntryDelete === 'ignore' ? 'selected' : ''}>何もしない</option>
        </select>
      </div>
      <div class="field"><label>日付クリア時の挙動</label>
        <select id="pt-calsync-on-date-cleared">
          <option value="deleteEvent" ${(safe.onDateCleared || 'deleteEvent') === 'deleteEvent' ? 'selected' : ''}>イベントを削除</option>
          <option value="ignore" ${safe.onDateCleared === 'ignore' ? 'selected' : ''}>何もしない</option>
        </select>
      </div>
      <div class="field">
        <label class="pt-check-label">
          <input id="pt-calsync-reverse-enabled" type="checkbox" ${rsObj.enabled !== false ? 'checked' : ''}>
          カレンダー側の変更を逆方向同期する
        </label>
        <label class="pt-check-label" style="margin-top:4px;">
          <input id="pt-calsync-reverse-skip-rec" type="checkbox" ${rsObj.skipIfRecurrence !== false ? 'checked' : ''}>
          繰り返し化されたイベントは逆方向同期しない（推奨）
        </label>
      </div>
      <div class="field"><label>書き戻し時のステータス</label>
        <input id="pt-calsync-write-status" type="text" value="${esc(safe.writeStatus || '採用')}" placeholder="採用">
      </div>
    </div>
  `;
}

function _bindCalendarSyncEditor(root) {
  const chk = _ptGet('pt-calsync-enabled', root);
  const body = _ptGet('pt-calsync-body', root);
  const tgt = _ptGet('pt-calsync-target-db', root);
  if (chk && body) {
    chk.addEventListener('change', () => { body.style.display = chk.checked ? '' : 'none'; });
  }
  if (tgt && typeof _attachDbPicker === 'function') _attachDbPicker(tgt);
}

// applyPropertyType から呼ばれる。calendarSync セクションの入力値を収集して返す（無効時は null）。
function _collectCalendarSyncConfig(root) {
  const chk = _ptGet('pt-calsync-enabled', root);
  if (!chk || !chk.checked) return null;
  const targetDb = _ptGet('pt-calsync-target-db', root)?.value?.trim() || '';
  if (!targetDb) {
    showStatus('カレンダー連動: 対象カレンダーシートを指定してください', true);
    throw new Error('calendarSync.targetDb is required');
  }
  const titleTemplate = _ptGet('pt-calsync-title-tmpl', root)?.value?.trim() || '{entryName}';
  const descriptionTemplate = _ptGet('pt-calsync-desc-tmpl', root)?.value || '';
  const rulesRaw = _ptGet('pt-calsync-color-rules', root)?.value?.trim() || '';
  let colorRules = [];
  if (rulesRaw) {
    try {
      colorRules = JSON.parse(rulesRaw);
      if (!Array.isArray(colorRules)) throw new Error('配列ではありません');
    } catch (e) {
      showStatus('色ルールのJSONが不正: ' + (e?.message || e), true);
      throw e;
    }
  }
  const onEntryDelete = _ptGet('pt-calsync-on-entry-delete', root)?.value || 'deleteEvent';
  const onDateCleared = _ptGet('pt-calsync-on-date-cleared', root)?.value || 'deleteEvent';
  const reverseSync = {
    enabled: !!_ptGet('pt-calsync-reverse-enabled', root)?.checked,
    syncDate: true,
    syncTitle: false,
    skipIfRecurrence: !!_ptGet('pt-calsync-reverse-skip-rec', root)?.checked,
  };
  const writeStatus = _ptGet('pt-calsync-write-status', root)?.value?.trim() || '採用';
  const out = { targetDb, titleTemplate, descriptionTemplate, onEntryDelete, onDateCleared, reverseSync, writeStatus };
  if (colorRules.length) out.colorRules = colorRules;
  return out;
}

function onPropertyTypeChange(root) {
  const scope = _ptResolveRoot(root);
  window._ptActiveRoot = scope;
  const baseType = _ptGet('pt-type', scope)?.value || 'text';
  const type = _ptReadUiType(scope);
  const optDiv = _ptGet('pt-options', scope);
  if (!optDiv) return;
  const multRow = _ptGet('pt-multiplicity-row', scope);
  if (multRow) {
    multRow.hidden = typeof isPropertyTypeMultiplicityBase === 'function'
      ? !isPropertyTypeMultiplicityBase(baseType)
      : !['select', 'relation', 'user'].includes(baseType);
  }
  const { current, existing, propName: statePropName } = _ptState(scope);

  if (type === 'select' || type === 'multi-select') {
    const opts = current.options || existing;
    optDiv.innerHTML = `<div class="field"><label>選択肢（1行1項目）</label>
      <textarea id="pt-select-options" rows="5">${esc(opts.join('\n'))}</textarea>
    </div>`;
  } else if (type === 'relation' || type === 'multi-relation') {
    // 現在のDBのリレーション型プロパティ一覧（カスケード元の候補）
    const relProps = [];
    const pts = getPropertyTypes(state.currentDbPath);
    if (pts) {
      for (const [p, cfg] of Object.entries(pts)) {
        if ((cfg.type === 'relation' || cfg.type === 'multi-relation') && p !== (statePropName || '')) relProps.push(p);
      }
    }
    const cascadeOpts = relProps.map(p => `<option value="${esc(p)}"${p===(current.cascadeFrom||'')?'selected':''}>${esc(p)}</option>`).join('');
    // ペア候補: 同DB内の他のリレーションプロパティ
    const pairOpts = relProps.map(p => `<option value="${esc(p)}"${p===(current.pairWith||'')?'selected':''}>${esc(p)}</option>`).join('');
    optDiv.innerHTML = `<div class="field"><label>参照先シートフォルダのパス</label>
      <input id="pt-relation-db" type="text" value="${esc(current.relationDb||'')}" placeholder="例: 設定/キャラ（空欄 = 自分自身のシート）">
    </div>
    <div class="field"><label>同一シート内の相互反映先プロパティ</label>
      <select id="pt-pair-with">
        <option value="">(なし)</option>
        ${pairOpts}
      </select>
      <div class="pt-hint">同一シート内の自己参照リレーションで、片方を変更した時に相手側プロパティにも自動反映します</div>
    </div>
    <div class="field"><label>タイムライン依存方向</label>
      <select id="pt-dependency-direction">
        <option value="" ${!current.dependencyDirection?'selected':''}>依存矢印に使わない</option>
        <option value="target-to-entry" ${current.dependencyDirection==='target-to-entry'?'selected':''}>参照先 → このエントリ</option>
        <option value="entry-to-target" ${current.dependencyDirection==='entry-to-target'?'selected':''}>このエントリ → 参照先</option>
      </select>
      <div class="pt-hint">タイムラインの依存矢印で、プロパティ名に依存せず向きを決めます</div>
    </div>
    <div class="field">
      <label class="pt-check-label">
        <input id="pt-bidirectional-enabled" type="checkbox" ${current.bidirectional ? 'checked' : ''}>
        双方向リレーション
      </label>
      <div class="pt-hint">参照先シート側にも対応プロパティを持たせ、どちら側の編集でも相手シートへ反映します。初期値はオフです</div>
    </div>
    <div id="pt-bidirectional-prop-row" class="field"${current.bidirectional ? '' : ' style="display:none;"'}><label>参照先シート側の対応プロパティ</label>
      <input id="pt-bidirectional-prop" type="text" value="${esc(current.bidirectionalProp || statePropName || '')}" placeholder="空欄なら同名">
      <div class="pt-hint">未作成なら自動で作成し、既存なら双方向設定を付与します</div>
    </div>
    <div class="field"><label>絞り込み（カスケード）</label>
      <select id="pt-cascade-from">
        <option value="">(なし)</option>
        ${cascadeOpts}
      </select>
    </div>
    <div id="pt-cascade-key-row" class="field"${current.cascadeFrom?'':' style="display:none;"'}><label>参照先シート側の絞り込みプロパティ</label>
      <input id="pt-cascade-key" type="text" value="${esc(current.cascadeKey||current.cascadeFrom||'')}" placeholder="参照先シート側で照合に使うプロパティ名">
      <div class="pt-hint">参照先シートの各エントリについて、このプロパティの値が依存元の選択値と一致するものだけを候補に出します</div>
    </div>
    <div class="pt-hint">
      指定したシートフォルダ内のエントリ名がドロップダウンに表示されます。
      ${type==='relation'?'単一選択（1つだけ選べます）':'複数選択（カンマ区切りで複数選べます）'}
    </div>`;
    // DBピッカーを参照先DB入力に取り付け
    setTimeout(() => { const dbInput = _ptGet('pt-relation-db', scope); if (dbInput) _attachDbPicker(dbInput); }, 0);
    _ptGet('pt-bidirectional-enabled', scope)?.addEventListener('change', function() {
      const row = _ptGet('pt-bidirectional-prop-row', scope);
      const propInput = _ptGet('pt-bidirectional-prop', scope);
      if (!row || !propInput) return;
      if (this.checked) {
        row.style.display = '';
        if (!propInput.value) propInput.value = statePropName || '';
      } else {
        row.style.display = 'none';
      }
    });
    _ptGet('pt-cascade-from', scope)?.addEventListener('change', function() {
      const keyRow = _ptGet('pt-cascade-key-row', scope);
      const keyInput = _ptGet('pt-cascade-key', scope);
      if (this.value) {
        keyRow.style.display = '';
        if (!keyInput.value) keyInput.value = this.value;
      } else {
        keyRow.style.display = 'none';
        keyInput.value = '';
      }
    });
  } else if (type === 'number') {
    optDiv.innerHTML = `<div class="field"><label>単位（任意）</label>
      <input id="pt-number-unit" type="text" value="${esc(current.unit||'')}" placeholder="例: ページ, cm, kg">
    </div>`;
  } else if (type === 'formula') {
    optDiv.innerHTML = typeof _ptBuildFormulaOptionsHtml === 'function'
      ? _ptBuildFormulaOptionsHtml(current, scope)
      : `<div class="field"><label>数式（Notion互換構文）</label>
        <textarea id="pt-formula-src" class="pt-formula-textarea" rows="8">${esc(current.formula||'')}</textarea>
        <div class="pt-hint">
          使用可能: prop("名前"), if(条件, 真, 偽), let/lets(変数, 値, ..., 本体), and, or, not, empty, contains, replace, floor, round, mod, toNumber, format, year, month, day, dateBetween, dateSubtract, now, +, -, *, /, >, <, ==, !=
        </div>
      </div>
      <div class="field">
        <button data-action="testFormula(this.closest('[data-pt-root]'))" class="pt-small-btn">テスト</button>
        <span id="pt-formula-result" class="pt-hint"></span>
      </div>`;
    if (typeof _ptBindFormulaEditor === 'function') _ptBindFormulaEditor(scope);
  } else if (type === 'rollup' && typeof buildRollupOptionsHtml === 'function') {
    const dbPath = state.currentDbPath;
    const allProps = state.pivotData ? state.pivotData.properties : [];
    const propTypes = getPropertyTypes(dbPath);
    optDiv.innerHTML = buildRollupOptionsHtml(current, allProps, propTypes);
  } else if (type === 'button') {
    optDiv.innerHTML = `<div class="field"><label>ボタンラベル</label>
      <input id="pt-btn-label" type="text" value="${esc(current.label||'実行')}" placeholder="実行">
    </div>
    <div class="field"><label>アクション</label>
      <div id="pt-btn-actions"></div>
      <button id="pt-btn-add-action" class="pt-small-btn">+ アクション追加</button>
    </div>`;
    _renderButtonActions(current.actions || [], scope);
    _ptGet('pt-btn-add-action', scope)?.addEventListener('click', () => {
      const acts = _collectButtonActions(scope);
      acts.push({ type: 'set-value', targetProp: '', value: '' });
      _renderButtonActions(acts, scope);
    });
  } else if (type === 'multi-source-relation') {
    const curMode = current.mode || 'manual';
    optDiv.innerHTML = `<div class="field"><label>モード</label>
      <select id="pt-msr-mode">
        <option value="manual" ${curMode==='manual'?'selected':''}>手動</option>
        <option value="auto" ${curMode==='auto'?'selected':''}>自動</option>
      </select>
    </div>
    <div class="field"><label>ソース</label>
      <div id="pt-msr-sources"></div>
      <button id="pt-msr-add-source" class="pt-small-btn">+ ソース追加</button>
    </div>`;
    _renderMsrSources(current.sources || [], curMode, scope);
    _ptGet('pt-msr-mode', scope)?.addEventListener('change', function() {
      const s = _collectMsrSources(scope);
      _renderMsrSources(s, this.value, scope);
    });
    _ptGet('pt-msr-add-source', scope)?.addEventListener('click', () => {
      const s = _collectMsrSources(scope);
      const mode = _ptGet('pt-msr-mode', scope)?.value || 'manual';
      s.push({ db: '', label: '', matchRules: [] });
      _renderMsrSources(s, mode, scope);
    });
  } else if (type === 'date') {
    const curSource = current.source || '';
    const withTime = !!current.withTime;
    const isRange = !!current.range && curSource !== 'modified';
    optDiv.innerHTML = `<div class="field"><label>データソース</label>
      <select id="pt-date-source">
        <option value="" ${!curSource?'selected':''}>候補値（通常）</option>
        <option value="modified" ${curSource==='modified'?'selected':''}>最終更新日（自動・読み取り専用）</option>
      </select>
    </div>
    <label class="pt-check-label">
      <input id="pt-date-with-time" type="checkbox" ${withTime?'checked':''}>
      時間まで入力可能にする
    </label>
    <label class="pt-check-label">
      <input id="pt-date-range" type="checkbox" ${isRange?'checked':''} ${curSource==='modified'?'disabled':''}>
      開始と終了を持つ期間にする
    </label>
    <div id="pt-date-range-note" class="pt-hint"${curSource==='modified'?'':' style="display:none;"'}>
      最終更新日は単一日時として扱います。
    </div>
