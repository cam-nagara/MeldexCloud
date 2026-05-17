    ${_renderCalendarSyncEditor(current.calendarSync || null)}`;
    _bindCalendarSyncEditor(scope);
    const srcSel = _ptGet('pt-date-source', scope);
    const rangeCb = _ptGet('pt-date-range', scope);
    const rangeNote = _ptGet('pt-date-range-note', scope);
    const syncCb = _ptGet('pt-calsync-enabled', scope);
    const syncBody = _ptGet('pt-calsync-body', scope);
    const refreshDateSourceUi = () => {
      if (!rangeCb || !rangeNote) return;
      if (srcSel.value === 'modified') {
        rangeCb.disabled = true;
        rangeNote.style.display = '';
        if (syncCb) {
          syncCb.disabled = true;
        }
        if (syncBody) syncBody.style.display = 'none';
      } else {
        rangeCb.disabled = false;
        rangeNote.style.display = 'none';
        if (syncCb) syncCb.disabled = false;
        if (syncBody && syncCb?.checked) syncBody.style.display = '';
      }
    };
    refreshDateSourceUi();
    srcSel?.addEventListener('change', refreshDateSourceUi);
  } else if (type === 'user' || type === 'multi-user') {
    const curSource = current.source || '';
    optDiv.innerHTML = `<div class="field"><label>データソース</label>
      <select id="pt-user-source">
        <option value="" ${!curSource?'selected':''}>候補値（通常）</option>
        <option value="modified_by" ${curSource==='modified_by'?'selected':''}>最終更新者（自動・読み取り専用）</option>
      </select>
    </div>`;
  } else if (type === 'image') {
    const options = current.options || {};
    const accept = Array.isArray(options.accept) ? options.accept.join(', ') : 'png, jpg, jpeg, gif, webp, svg';
    optDiv.innerHTML = `<div class="field"><label>最大枚数</label>
      <input id="pt-image-max-count" type="number" min="1" max="100" value="${esc(options.max_count == null ? '' : options.max_count)}" placeholder="空欄 = 100">
    </div>
    <div class="field"><label>許可する拡張子</label>
      <input id="pt-image-accept" type="text" value="${esc(accept)}" placeholder="png, jpg, webp">
    </div>
    <div class="field"><label>サムネイルサイズ(px)</label>
      <input id="pt-image-thumb-size" type="number" min="64" max="1024" value="${esc(options.thumbnail_size || 256)}">
    </div>`;
  } else {
    optDiv.innerHTML = '';
  }

  // Phase 3 §5.1 / §12.1: 全型共通の自動初期値設定（autoFillOnCreate）。
  // $ 接頭辞で動的評価: $today / $now / $currentUser / $version（§15.4.2）
  const curAutoCreate = (current.autoFillOnCreate != null) ? String(current.autoFillOnCreate) : '';
  const autoFillBlock = document.createElement('div');
  autoFillBlock.className = 'gb-section-head';
  autoFillBlock.style.cssText = 'margin-top:12px;border-top:1px solid var(--border);padding-top:8px;';
  autoFillBlock.innerHTML = `
    <div class="field"><label>新規エントリ作成時の初期値 (autoFillOnCreate)</label>
      <input id="pt-auto-fill-on-create" type="text" value="${esc(curAutoCreate)}" placeholder="例: $now / $currentUser / $version / 提案">
      <div class="pt-hint">$today (日付) / $now (日時) / $currentUser / $version で動的評価。それ以外は静的リテラル。空欄なら無効。</div>
    </div>
  `;
  optDiv.appendChild(autoFillBlock);
}

function _ptResolveRoot(root) {
  if (root && root.querySelector) return root;
  return window._ptActiveRoot || document.querySelector('[data-pt-root]') || document;
}

function _ptGet(id, root) {
  const scope = _ptResolveRoot(root);
  return scope.querySelector ? scope.querySelector('#' + id) : document.getElementById(id);
}

function _ptState(root) {
  const scope = _ptResolveRoot(root);
  const useWindowFallback = scope === document || !scope._ptDbPath;
  const dbPath = scope._ptDbPath || (useWindowFallback ? window._ptDbPath : '') || state.currentDbPath || '';
  const isCurrent = typeof _ptIsCurrentDbPath === 'function'
    ? _ptIsCurrentDbPath(dbPath)
    : (!dbPath || !state.currentDbPath || dbPath === state.currentDbPath);
  return {
    current: scope._ptCurrent || (useWindowFallback ? window._ptCurrent : null) || {},
    existing: scope._ptExistingValues || (useWindowFallback ? window._ptExistingValues : null) || [],
    propName: scope._ptPropName || (useWindowFallback ? window._ptPropName : '') || '',
    dbPath,
    pivotData: scope._ptPivotData || (useWindowFallback ? window._ptPivotData : null) || (isCurrent ? state.pivotData : null) || null,
    ctx: scope._ptCtx || (useWindowFallback ? window._ptCtx : null) || null,
  };
}

function _ptSetState(root, current, existing, propName, dbPath, pivotData, ctx) {
  const scope = _ptResolveRoot(root);
  scope._ptCurrent = current || {};
  scope._ptExistingValues = existing || [];
  scope._ptPropName = propName || '';
  scope._ptDbPath = dbPath || state.currentDbPath || '';
  scope._ptPivotData = pivotData || null;
  scope._ptCtx = ctx || null;
  window._ptCurrent = scope._ptCurrent;
  window._ptExistingValues = scope._ptExistingValues;
  window._ptPropName = scope._ptPropName;
  window._ptDbPath = scope._ptDbPath;
  window._ptPivotData = scope._ptPivotData;
  window._ptCtx = scope._ptCtx;
}

function _ptReadUiType(root) {
  const scope = _ptResolveRoot(root);
  const baseType = _ptGet('pt-type', scope)?.value || 'text';
  const multi = _ptGet('pt-multiplicity-multiple', scope);
  const multiplicity = multi?.checked ? 'multiple' : 'single';
  return typeof composePropertyTypeFromUi === 'function'
    ? composePropertyTypeFromUi(baseType, multiplicity)
    : baseType;
}

function _renderPropertyMultiplicityControls(currentType, scopeId) {
  const currentMultiplicity = typeof getPropertyTypeMultiplicity === 'function'
    ? getPropertyTypeMultiplicity(currentType)
    : 'single';
  const group = 'pt-multiplicity-' + (scopeId || 'default');
  return `<div id="pt-multiplicity-row" class="field" hidden>
    <label>選択数</label>
    <div class="pt-radio-row">
      <label class="pt-check-label"><input id="pt-multiplicity-single" class="gb-radio" type="radio" name="${esc(group)}" value="single" ${currentMultiplicity !== 'multiple' ? 'checked' : ''} data-onchange="onPropertyTypeChange(this.closest('[data-pt-root]'))"> 単一</label>
      <label class="pt-check-label"><input id="pt-multiplicity-multiple" class="gb-radio" type="radio" name="${esc(group)}" value="multiple" ${currentMultiplicity === 'multiple' ? 'checked' : ''} data-onchange="onPropertyTypeChange(this.closest('[data-pt-root]'))"> 複数</label>
    </div>
  </div>`;
}

function _ptContextForDbPath(dbPath) {
  if (typeof _dbFindPaneContextForPath === 'function' && dbPath) return _dbFindPaneContextForPath(dbPath);
  return null;
}

function _ptPivotDataForDbPath(dbPath) {
  const ctx = _ptContextForDbPath(dbPath);
  if (ctx?.pivotData) return ctx.pivotData;
  if (typeof _ptIsCurrentDbPath === 'function' ? _ptIsCurrentDbPath(dbPath) : (!dbPath || dbPath === state.currentDbPath)) {
    return state.pivotData || null;
  }
  return null;
}

function _propertySettingsExistingValues(propName, pivotData) {
  const existingValues = new Set();
  const data = pivotData || state.pivotData;
  if (data?.entities) {
    Object.values(data.entities).forEach(ent => {
      (ent[propName] || []).forEach(v => existingValues.add(v.value));
    });
  }
  return [...existingValues];
}

async function applyPropertyType(propName, root) {
  const scope = _ptResolveRoot(root);
  window._ptActiveRoot = scope;
  const type = _ptReadUiType(scope);
  const config = { type };
  const stateInfo = _ptState(scope);
  const dbPath = stateInfo.dbPath || state.currentDbPath || '';
  const ctx = stateInfo.ctx || _ptContextForDbPath(dbPath);
  const pivotData = stateInfo.pivotData || _ptPivotDataForDbPath(dbPath);
  const prev = stateInfo.current || {};

  if (type === 'select' || type === 'multi-select') {
    const textarea = _ptGet('pt-select-options', scope);
    if (textarea) config.options = textarea.value.split('\n').map(s => s.trim()).filter(Boolean);
  } else if (type === 'relation' || type === 'multi-relation') {
    const dbInput = _ptGet('pt-relation-db', scope);
    if (dbInput) config.relationDb = dbInput.value.trim();
    const pairWith = _ptGet('pt-pair-with', scope)?.value || '';
    if (pairWith) config.pairWith = pairWith;
    const dependencyDirection = _ptGet('pt-dependency-direction', scope)?.value || '';
    if (dependencyDirection) config.dependencyDirection = dependencyDirection;
    const bidirectional = !!_ptGet('pt-bidirectional-enabled', scope)?.checked;
    const bidirectionalProp = _ptGet('pt-bidirectional-prop', scope)?.value?.trim() || propName;
    if (bidirectional) {
      config.bidirectional = true;
      config.bidirectionalProp = bidirectionalProp;
    }
    const cascadeFrom = _ptGet('pt-cascade-from', scope)?.value || '';
    const cascadeKey = _ptGet('pt-cascade-key', scope)?.value || '';
    if (cascadeFrom) { config.cascadeFrom = cascadeFrom; config.cascadeKey = cascadeKey || cascadeFrom; }
  } else if (type === 'number') {
    const unitInput = _ptGet('pt-number-unit', scope);
    if (unitInput) config.unit = unitInput.value.trim();
  } else if (type === 'formula') {
    const src = _ptGet('pt-formula-src', scope);
    if (src) config.formula = src.value;
  } else if (type === 'rollup' && typeof collectRollupConfig === 'function') {
    Object.assign(config, collectRollupConfig(scope));
  } else if (type === 'button') {
    config.label = _ptGet('pt-btn-label', scope)?.value || '実行';
    config.actions = _collectButtonActions(scope);
  } else if (type === 'multi-source-relation') {
    config.mode = _ptGet('pt-msr-mode', scope)?.value || 'manual';
    config.sources = _collectMsrSources(scope);
  } else if (type === 'date') {
    const src = _ptGet('pt-date-source', scope)?.value || '';
    if (src) config.source = src;
    if (_ptGet('pt-date-with-time', scope)?.checked) config.withTime = true;
    if (src !== 'modified' && _ptGet('pt-date-range', scope)?.checked) config.range = true;
  } else if (type === 'user' || type === 'multi-user') {
    const src = _ptGet('pt-user-source', scope)?.value || '';
    if (src) config.source = src;
  } else if (type === 'image') {
    const maxRaw = _ptGet('pt-image-max-count', scope)?.value || '';
    const maxCount = maxRaw ? Math.max(1, Math.min(100, parseInt(maxRaw, 10) || 100)) : null;
    const acceptRaw = _ptGet('pt-image-accept', scope)?.value || '';
    const accept = acceptRaw.split(',').map(s => s.trim().toLowerCase().replace(/^\./, '')).filter(Boolean);
    const thumbSize = Math.max(64, Math.min(1024, parseInt(_ptGet('pt-image-thumb-size', scope)?.value || '256', 10) || 256));
    config.options = {
      max_count: maxCount,
      accept: accept.length ? accept : ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'],
      thumbnail_size: thumbSize,
    };
  }

  // Phase 3 §5.1: calendarSync（date 型のみ）
  if (type === 'date') {
    let cs = null;
    try { cs = config.source === 'modified' ? null : _collectCalendarSyncConfig(scope); }
    catch { return; /* バリデーションエラーは既に showStatus 済み */ }
    if (cs) config.calendarSync = cs;
  }

  // Phase 3 §12.1: autoFillOnCreate（全型共通。既存の autoFillOnStatus とは独立して共存）
  const autoCreateRaw = _ptGet('pt-auto-fill-on-create', scope)?.value?.trim() || '';
  if (autoCreateRaw) config.autoFillOnCreate = autoCreateRaw;
  // 以前の autoFillOnStatus は別UI（gb-db-props.js 793行あたり）で編集されるため、存在すれば保持する
  if (prev.autoFillOnStatus && !('autoFillOnStatus' in config)) {
    config.autoFillOnStatus = prev.autoFillOnStatus;
  }
  // writeStatus もプロパティレベルで保持（autoFillOnCreate/calendarSync 共通）
  if (prev.writeStatus && !('writeStatus' in config)) {
    config.writeStatus = prev.writeStatus;
  }

  if ((type === 'relation' || type === 'multi-relation') && config.bidirectional && typeof _ensureBidirectionalRelationConfig === 'function') {
    try {
      Object.assign(config, await _ensureBidirectionalRelationConfig(dbPath, propName, config));
    } catch (e) {
      showStatus('双方向リレーション設定に失敗: ' + (e?.message || e), true);
      return;
    }
  }
  if (typeof _disableBidirectionalRelationConfig === 'function') {
    try {
      await _disableBidirectionalRelationConfig(dbPath, propName, prev, config);
    } catch (e) {
      showStatus('双方向リレーション解除に失敗: ' + (e?.message || e), true);
      return;
    }
  }

  const savePromise = setPropertyType(dbPath, propName, config);
  _ptSetState(scope, config, _propertySettingsExistingValues(propName, pivotData), propName, dbPath, pivotData, ctx);
  if (prev.type === 'image' && type !== 'image') {
    Promise.resolve(savePromise).then(() => apiPost('/media/rebuild-refs', {})).then(() => apiPost('/media/gc', {})).catch(() => {});
  }
  const overlay = scope.closest?.('.modal-overlay');
  if (overlay) overlay.remove();
  // 数式キャッシュをクリア
  if (type === 'formula') {
    for (const k in _formulaCache) delete _formulaCache[k];
  }
  renderPivot(ctx);
  return config;
}

function testFormula(root) {
  const scope = _ptResolveRoot(root);
  const src = _ptGet('pt-formula-src', scope)?.value || '';
  const resultEl = _ptGet('pt-formula-result', scope);
  if (!resultEl) return;
  if (!src.trim()) { resultEl.textContent = ''; return; }
  if (typeof _ptUpdateFormulaPreview === 'function') _ptUpdateFormulaPreview(scope);
  // 最初のエントリでテスト
  const { dbPath, pivotData } = _ptState(scope);
  const data = pivotData || state.pivotData;
  if (!data || !data.entities) { resultEl.textContent = 'データがありません'; return; }
  const firstEntity = Object.keys(data.entities)[0];
  if (!firstEntity) { resultEl.textContent = 'エントリがありません'; return; }
  const entityData = data.entities[firstEntity];
  let result;
  try {
    result = formulaEvalForEntity(src, entityData, { propTypes: getPropertyTypes(dbPath), dbPath });
  } catch (e) {
    result = { error: e?.message || String(e) };
  }
  if (result.error) {
    const loc = Number.isFinite(result.errorPos) ? '（位置 ' + (result.errorPos + 1) + '）' : '';
    resultEl.innerHTML = '<span style="color:var(--red);">エラー' + loc + ': ' + esc(result.error) + '</span>';
  } else {
    resultEl.innerHTML = '<span style="color:var(--green);">' + esc(firstEntity) + ' → ' + esc(String(result.value)) + '</span>';
  }
}

function _ptFormulaProps(root) {
  const props = _ptState(root).pivotData?.properties || state.pivotData?.properties || [];
  return Array.isArray(props) ? props : [];
}

function _ptFormulaTemplates() {
  return [
    { label: 'if', snippet: 'if(prop("状態") == "完了", "完了", "未完了")' },
    { label: '日付差', snippet: 'dateBetween(now(), prop("開始日"), "days")' },
    { label: '表示形式', snippet: 'format(prop("数値"), "#,##0.00")' },
  ];
}

function _ptBuildFormulaOptionsHtml(current, root) {
  const props = _ptFormulaProps(root);
  const propButtons = props.length
    ? props.map(p => '<button type="button" class="pt-small-btn" data-formula-prop="' + esc(p) + '">prop("' + esc(p) + '")</button>').join('')
    : '<span class="pt-hint">利用可能なプロパティがありません</span>';
  const templateButtons = _ptFormulaTemplates()
    .map(t => '<button type="button" class="pt-small-btn" data-formula-template="' + esc(t.snippet) + '">' + esc(t.label) + '</button>')
    .join('');
  return `<div class="field"><label>数式（Notion互換構文）</label>
    <textarea id="pt-formula-src" class="pt-formula-textarea" rows="8">${esc(current.formula||'')}</textarea>
    <div class="pt-formula-tools" aria-label="数式テンプレート">${templateButtons}</div>
    <div class="pt-formula-props" aria-label="プロパティ候補">${propButtons}</div>
    <pre id="pt-formula-preview" class="pt-formula-preview" aria-label="数式シンタックスプレビュー"></pre>
    <div class="pt-hint">
      使用可能: prop("名前"), if, let/lets, and, or, not, empty, contains, replace, floor, round, mod, toNumber, format, year, month, day, dateBetween, dateSubtract, now, +, -, *, /, >, <, ==, !=
    </div>
  </div>
  <div class="field">
    <button data-action="testFormula(this.closest('[data-pt-root]'))" class="pt-small-btn">テスト</button>
    <span id="pt-formula-result" class="pt-hint"></span>
  </div>`;
}

function _ptInsertFormulaText(textarea, text) {
  if (!textarea) return;
  const start = textarea.selectionStart ?? textarea.value.length;
  const end = textarea.selectionEnd ?? textarea.value.length;
  textarea.value = textarea.value.slice(0, start) + text + textarea.value.slice(end);
  const nextPos = start + text.length;
  textarea.focus();
  textarea.setSelectionRange(nextPos, nextPos);
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
}

function _ptFormulaTokenClass(token) {
  if (token.type === 'str') return 'string';
  if (token.type === 'num') return 'number';
  if (token.type === 'bool') return 'boolean';
  if (token.type === 'id') return 'identifier';
  return 'operator';
}

function _ptHighlightFormula(src) {
  if (!src) return '';
  if (typeof formulaTokenize !== 'function') return esc(src);
  let tokens = [];
  try {
    tokens = formulaTokenize(src);
  } catch {
    return esc(src);
  }
  let cursor = 0;
  let html = '';
  tokens.forEach(token => {
    const start = Number.isFinite(token.pos) ? token.pos : cursor;
    const end = Number.isFinite(token.end) ? token.end : start + String(token.value || '').length;
    if (start > cursor) html += esc(src.slice(cursor, start));
    html += '<span class="pt-formula-token pt-formula-token-' + _ptFormulaTokenClass(token) + '">' + esc(src.slice(start, end)) + '</span>';
    cursor = end;
  });
  if (cursor < src.length) html += esc(src.slice(cursor));
  return html;
}

function _ptUpdateFormulaPreview(root) {
  const scope = _ptResolveRoot(root);
  const textarea = _ptGet('pt-formula-src', scope);
  const preview = _ptGet('pt-formula-preview', scope);
  if (!textarea || !preview) return;
  try {
    preview.innerHTML = _ptHighlightFormula(textarea.value || '');
  } catch {
    preview.textContent = textarea.value || '';
  }
}

function _ptBindFormulaEditor(root) {
  const scope = _ptResolveRoot(root);
  const textarea = _ptGet('pt-formula-src', scope);
  if (!textarea || textarea.dataset.formulaEditorBound) return;
  textarea.dataset.formulaEditorBound = '1';
  textarea.addEventListener('input', () => _ptUpdateFormulaPreview(scope));
  scope.querySelectorAll('[data-formula-prop]').forEach(btn => {
    btn.addEventListener('click', () => {
      const prop = btn.dataset.formulaProp || '';
      _ptInsertFormulaText(textarea, 'prop("' + prop.replace(/"/g, '\\"') + '")');
    });
  });
  scope.querySelectorAll('[data-formula-template]').forEach(btn => {
    btn.addEventListener('click', () => _ptInsertFormulaText(textarea, btn.dataset.formulaTemplate || ''));
  });
  _ptUpdateFormulaPreview(scope);
}

function showDbPropertySettingsForColumn(dbPath, propName, opts) {
  if (!dbPath) return;
  const selected = typeof _getSelectedColumns === 'function' ? _getSelectedColumns(dbPath) : [];
  const effectiveProp = propName || (selected.length === 1 ? selected[0] : '');
  if (typeof state !== 'undefined') state.selectedColumn = effectiveProp ? { dbPath, propName: effectiveProp } : { dbPath, propName: '' };

  const detailEl = typeof _resolveDetailEl === 'function' ? _resolveDetailEl() : document.getElementById('rp-detail');
  if (!detailEl) return;
  if (typeof _ensureDetailTabShell === 'function') _ensureDetailTabShell(detailEl);
  if (typeof showDbTabs === 'function') showDbTabs(true);
  const container = detailEl.querySelector('#detail-tab-db-property-settings');
  if (!container) return;

  const shouldSwitch = !opts || opts.switchTab !== false;
  if (shouldSwitch && typeof switchDetailTab === 'function') switchDetailTab('db-property-settings');
  renderDbPropertySettingsPanel(dbPath, effectiveProp, container);
}

function renderDbPropertySettingsPanel(dbPath, propName, container) {
  const target = container || document.getElementById('detail-tab-db-property-settings');
  if (!target) return;
  if (!propName) {
    target.innerHTML = `<div class="gb-empty-placeholder" style="padding:16px;">列を選択してください</div>`;
    return;
  }
  const ctx = _ptContextForDbPath(dbPath);
  const pivotData = ctx?.pivotData || _ptPivotDataForDbPath(dbPath);
  if (propName === '__entity__') {
    const pinned = typeof getEntityColumnPinned === 'function'
      ? getEntityColumnPinned(dbPath)
      : getDbViewConfig(dbPath).entityColumnPinned !== false;
    target.innerHTML = `<div class="db-prop-settings" data-db-property-settings-root>
      <div class="gb-section-head">エントリ名列</div>
      <div class="field"><label>列名</label><input type="text" value="エントリ名" disabled></div>
      <div class="field"><label class="pt-check-label">
        <input id="entity-column-pinned" type="checkbox" ${pinned ? 'checked' : ''}>
        列を固定
      </label></div>
    </div>`;
    target.querySelector('#entity-column-pinned')?.addEventListener('change', function() {
      if (typeof setEntityColumnPinned === 'function') {
        setEntityColumnPinned(dbPath, !!this.checked);
      } else {
        const c = getDbViewConfig(dbPath);
        c.entityColumnPinned = !!this.checked;
        saveDbViewConfig(dbPath, c, {
          historyLabel: 'シート表示: エントリ名列固定',
          historyDetail: this.checked ? '固定' : '解除',
        });
      }
      if (typeof renderPivot === 'function') renderPivot(ctx);
    });
    return;
  }
  const availableProps = pivotData?.properties || [];
  if (availableProps.length && !availableProps.includes(propName)) {
    target.innerHTML = `<div class="gb-empty-placeholder" style="padding:16px;">列を選択してください</div>`;
    return;
  }

  const types = getPropertyTypes(dbPath);
  const current = types[propName] || { type: 'text' };
  const scopeId = 'tab-' + Math.random().toString(36).slice(2, 8);
  target.innerHTML = `<div class="db-prop-settings" data-pt-root>
    <div class="gb-section-head">プロパティ設定</div>
    <div class="field"><label>列名</label>
      <input id="pt-prop-name" type="text" value="${esc(propName)}" placeholder="列名">
    </div>
    <div class="field"><label>型</label>
      <select id="pt-type" data-onchange="onPropertyTypeChange(this.closest('[data-pt-root]'))">
        ${renderPropertyTypeOptions(current.type)}
      </select>
    </div>
    ${_renderPropertyMultiplicityControls(current.type, scopeId)}
    <div id="pt-options"></div>
    <div class="btn-row">
      <button class="primary" id="pt-settings-apply">適用</button>
      <button id="pt-settings-open-modal">詳細設定...</button>
    </div>
  </div>`;
  const root = target.querySelector('[data-pt-root]');
  _ptSetState(root, current, _propertySettingsExistingValues(propName, pivotData), propName, dbPath, pivotData, ctx);
  onPropertyTypeChange(root);
  root.querySelector('#pt-settings-apply')?.addEventListener('click', () => applyDbPropertySettings(propName, root));
  root.querySelector('#pt-settings-open-modal')?.addEventListener('click', () => showPropertyTypeModal(propName, dbPath, ctx));
}

async function applyDbPropertySettings(originalPropName, root) {
  const scope = _ptResolveRoot(root);
  const stateInfo = _ptState(scope);
  const dbPath = stateInfo.dbPath || state.currentDbPath;
  const ctx = stateInfo.ctx || _ptContextForDbPath(dbPath);
  const pivotData = stateInfo.pivotData || _ptPivotDataForDbPath(dbPath);
  if (!dbPath || !originalPropName) return;
  let propName = originalPropName;
  const nameInput = scope.querySelector('#pt-prop-name');
  const newName = (nameInput?.value || '').trim();
  if (!newName) {
    showStatus('列名を入力してください', true);
    return;
  }
  if (newName !== originalPropName) {
    const existingProps = new Set([
      ...(Array.isArray(pivotData?.properties) ? pivotData.properties : []),
      ...(Array.isArray(getDbViewConfig(dbPath).colOrder) ? getDbViewConfig(dbPath).colOrder : []),
      ...Object.keys(getPropertyTypes(dbPath) || {}),
    ]);
    if (existingProps.has(newName)) {
      showStatus('同じ名前の列が既にあります: ' + newName, true);
      return;
    }
    try {
      const ok = await renameDbProperty(dbPath, originalPropName, newName);
      if (!ok) return;
    } catch (e) {
      showStatus('列名変更に失敗: ' + (e?.message || e), true);
      return;
    }
    propName = newName;
  }
  _ptSetState(scope, getPropertyTypes(dbPath)[propName] || {}, _propertySettingsExistingValues(propName, pivotData), propName, dbPath, pivotData, ctx);
  const savedConfig = await applyPropertyType(propName, scope);
  if (!savedConfig) return;
  if (typeof _setSelectedColumns === 'function') _setSelectedColumns(dbPath, [propName], propName);
  if (typeof state !== 'undefined') state.selectedColumn = { dbPath, propName };
  renderDbPropertySettingsPanel(dbPath, propName);
  showStatus('プロパティ設定を保存しました');
}

/* 型別値エディタ・ドロップダウン → gb-db-value-editors.js に分離 */
