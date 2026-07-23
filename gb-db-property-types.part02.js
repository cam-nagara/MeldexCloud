    ${_renderCalendarSyncEditor(current.calendarSync || null)}`;
    _bindCalendarSyncEditor(scope);
    const srcSel = _ptGet('pt-date-source', scope);
    const rangeCb = _ptGet('pt-date-range', scope);
    const rangeNote = _ptGet('pt-date-range-note', scope);
    const syncCb = _ptGet('pt-calsync-enabled', scope);
    const syncBody = _ptGet('pt-calsync-body', scope);
    const refreshDateSourceUi = () => {
      if (!rangeCb || !rangeNote) return;
      if (_ptIsAutoDateSource(srcSel.value)) {
        rangeCb.disabled = true;
        rangeCb.checked = false;
        rangeNote.style.display = '';
        if (syncCb) {
          syncCb.disabled = true;
          syncCb.checked = false;
        }
        if (syncBody) syncBody.style.display = 'none';
      } else {
        rangeCb.disabled = false;
        rangeNote.style.display = 'none';
        if (syncCb) syncCb.disabled = false;
        if (syncBody && syncCb?.checked) syncBody.style.display = '';
      }
      _ptRefreshAutoFillVisibility(scope);
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
    const accept = Array.isArray(options.accept) ? options.accept.filter(ext => String(ext).toLowerCase() !== 'svg').join(', ') : 'png, jpg, jpeg, gif, webp';
    const uploadThumbSize = Math.max(64, Math.min(1024, parseInt(options.thumbnail_size, 10) || 256));
    const cellHeight = Math.max(32, Math.min(320, parseInt(options.cell_height ?? options.cell_thumbnail_size, 10) || Math.min(96, uploadThumbSize)));
    optDiv.innerHTML = `<div class="field"><label>最大枚数</label>
      <input id="pt-image-max-count" class="gb-num-input" type="number" min="1" max="100" value="${esc(options.max_count == null ? '' : options.max_count)}" placeholder="空欄 = 100">
    </div>
    <div class="field"><label>許可する拡張子</label>
      <input id="pt-image-accept" type="text" value="${esc(accept)}" placeholder="png, jpg, webp">
    </div>
    <div class="field"><label>表の画像高さ(px)</label>
      <input id="pt-image-cell-height" class="gb-num-input" type="number" min="32" max="320" value="${esc(cellHeight)}">
    </div>
    <div class="field"><label>保存サムネイルサイズ(px)</label>
      <input id="pt-image-thumb-size" class="gb-num-input" type="number" min="64" max="1024" value="${esc(uploadThumbSize)}">
    </div>`;
  } else {
    optDiv.innerHTML = '';
  }

  // Phase 3 §5.1 / §12.1: 全型共通の自動初期値設定（autoFillOnCreate）。
  // $ 接頭辞で動的評価: $today / $now / $currentUser / $version（§15.4.2）
  const curAutoCreate = (current.autoFillOnCreate != null) ? String(current.autoFillOnCreate) : '';
  const autoFillBlock = document.createElement('div');
  autoFillBlock.id = 'pt-auto-fill-block';
  autoFillBlock.className = 'gb-section-head';
  autoFillBlock.style.cssText = 'margin-top:12px;border-top:1px solid var(--border);padding-top:8px;';
  autoFillBlock.innerHTML = `
    <div class="field"><label>新規エントリ作成時の初期値 ${fieldHelp('$today / $now / $currentUser / $version が使えます。空欄なら自動入力しません')}</label>
      <input id="pt-auto-fill-on-create" type="text" value="${esc(curAutoCreate)}" placeholder="例: $now / $currentUser / $version / 提案">
    </div>
  `;
  optDiv.appendChild(autoFillBlock);
  _ptRefreshAutoFillVisibility(scope);
}

function _ptIsAutoDateSource(source) {
  return source === 'created' || source === 'modified';
}

function _ptIsReadOnlySource(root) {
  const scope = _ptResolveRoot(root);
  const type = _ptReadUiType(scope);
  if (type === 'date') return _ptIsAutoDateSource(_ptGet('pt-date-source', scope)?.value || '');
  if (type === 'user' || type === 'multi-user') return (_ptGet('pt-user-source', scope)?.value || '') === 'modified_by';
  return false;
}

function _ptRefreshAutoFillVisibility(root) {
  const scope = _ptResolveRoot(root);
  const block = _ptGet('pt-auto-fill-block', scope);
  if (!block) return;
  block.hidden = _ptIsReadOnlySource(scope);
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

async function applyPropertyType(propName, root, options = {}) {
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
    if (typeof collectDbOptionColors === 'function') {
      const optionColors = collectDbOptionColors(scope, prev.optionColors, config.options);
      if (optionColors && Object.keys(optionColors).length) config.optionColors = optionColors;
    }
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
    if (!_ptIsAutoDateSource(src) && _ptGet('pt-date-range', scope)?.checked) config.range = true;
  } else if (type === 'user' || type === 'multi-user') {
    const src = _ptGet('pt-user-source', scope)?.value || '';
    if (src) config.source = src;
  } else if (type === 'image') {
    const maxRaw = _ptGet('pt-image-max-count', scope)?.value || '';
    const maxCount = maxRaw ? Math.max(1, Math.min(100, parseInt(maxRaw, 10) || 100)) : null;
    const acceptRaw = _ptGet('pt-image-accept', scope)?.value || '';
    const accept = acceptRaw.split(',').map(s => s.trim().toLowerCase().replace(/^\./, '')).filter(Boolean);
    const cellHeight = Math.max(32, Math.min(320, parseInt(_ptGet('pt-image-cell-height', scope)?.value || '96', 10) || 96));
    const thumbSize = Math.max(64, Math.min(1024, parseInt(_ptGet('pt-image-thumb-size', scope)?.value || '256', 10) || 256));
    config.options = {
      max_count: maxCount,
      accept: accept.length ? accept.filter(ext => ext !== 'svg') : ['png', 'jpg', 'jpeg', 'gif', 'webp'],
      cell_height: cellHeight,
      thumbnail_size: thumbSize,
    };
  }

  // Phase 3 §5.1: calendarSync（date 型のみ）
  if (type === 'date') {
    let cs = null;
    try { cs = _ptIsAutoDateSource(config.source) ? null : _collectCalendarSyncConfig(scope); }
    catch { return; /* バリデーションエラーは既に showStatus 済み */ }
    if (cs) config.calendarSync = cs;
  }

  // Phase 3 §12.1: autoFillOnCreate（全型共通。既存の autoFillOnStatus とは独立して共存）
  const autoCreateRaw = _ptIsReadOnlySource(scope) ? '' : (_ptGet('pt-auto-fill-on-create', scope)?.value?.trim() || '');
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
    Promise.resolve(savePromise).then(() => apiPost('/media/rebuild-refs', {})).catch(() => {});
  }
  const overlay = scope.closest?.('.modal-overlay');
  if (overlay) overlay.remove();
  // 数式キャッシュをクリア
  if (type === 'formula') {
    for (const k in _formulaCache) delete _formulaCache[k];
  }
  if (options.render !== false) renderPivot(ctx);
  try {
    await savePromise;
  } catch (e) {
    showStatus('列設定の保存に失敗: ' + (e?.message || e), true);
    return null;
  }
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
  const stateInfo = _ptState(root);
  const props = stateInfo.pivotData?.properties || state.pivotData?.properties || [];
  if (!Array.isArray(props)) return [];
  const dbPath = stateInfo.dbPath || state.currentDbPath || '';
  return typeof filterDeletedDbProperties === 'function' ? filterDeletedDbProperties(dbPath, props) : props;
}

function _ptFormulaTemplates() {
  return [
    { label: 'if', snippet: 'if(prop("状態") == "完了", "完了", "未完了")' },
    { label: '日時差', snippet: 'dateBetween(now(), prop("開始日時"), "days")' },
    { label: '表示形式', snippet: 'format(prop("数値"), "#,##0.00")' },
  ];
}

function _ptBuildFormulaOptionsHtml(current, root) {
  const props = _ptFormulaProps(root);
  const propButtons = props.length
    ? props.map(p => '<button type="button" class="pt-small-btn" data-formula-prop="' + esc(p) + '">prop("' + esc(_formulaPropLiteral(p, '"')) + '")</button>').join('')
    : '<span class="pt-hint">利用可能な列がありません</span>';
  const templateButtons = _ptFormulaTemplates()
    .map(t => '<button type="button" class="pt-small-btn" data-formula-template="' + esc(t.snippet) + '">' + esc(t.label) + '</button>')
    .join('');
  return `<div class="field"><label>数式（Notion互換構文） ${fieldHelp('使用可能: prop("名前"), if, let/lets, and, or, not, empty, contains, replace, floor, round, mod, toNumber, format, year, month, day, dateBetween, dateSubtract, now, +, -, *, /, >, <, ==, !=')}</label>
    <textarea id="pt-formula-src" class="pt-formula-textarea" rows="8">${esc(current.formula||'')}</textarea>
    <div class="pt-formula-tools" aria-label="数式テンプレート">${templateButtons}</div>
    <div class="pt-formula-props" aria-label="列候補">${propButtons}</div>
    <pre id="pt-formula-preview" class="pt-formula-preview" aria-label="数式シンタックスプレビュー"></pre>
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
      _ptInsertFormulaText(textarea, 'prop("' + _formulaPropLiteral(prop, '"') + '")');
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
    const entityColumnLabel = typeof _dbEntityColumnDisplayLabel === 'function'
      ? _dbEntityColumnDisplayLabel(dbPath, { ctx })
      : 'エントリ名';
    const pinned = typeof getEntityColumnPinned === 'function'
      ? getEntityColumnPinned(dbPath, { ctx })
      : getDbViewConfig(dbPath).entityColumnPinned !== false;
    // 制作管理シートのエントリ名列は固定名（変更不可）
    const labelLocked = typeof isProductionManagementSheetPath === 'function'
      && isProductionManagementSheetPath(dbPath);
    target.innerHTML = `<div class="db-prop-settings" data-db-property-settings-root>
      <div class="gb-section-head">${esc(entityColumnLabel)}列</div>
      <div class="field"><label for="entity-column-name-display">列名</label><input id="entity-column-name-display" type="text" value="${esc(entityColumnLabel)}"${labelLocked ? ' disabled' : ''} aria-label="列名"${labelLocked ? '' : ' placeholder="エントリ名"'}></div>
      ${labelLocked ? '<div class="gb-info-box">制作管理に必要な列のため、列名は変更できません。</div>' : ''}
      <div class="field"><label class="pt-check-label">
        <input id="entity-column-pinned" type="checkbox" ${pinned ? 'checked' : ''}>
        列を固定
      </label></div>
    </div>`;
    if (!labelLocked) {
      const labelInput = target.querySelector('#entity-column-name-display');
      let skipCommit = false;
      const commitLabel = () => {
        if (skipCommit) { skipCommit = false; return; }
        if (typeof setEntityColumnLabel !== 'function' || !labelInput) return;
        // 表示中のラベルと同じなら保存しない（開いて閉じただけで履歴を汚さない）
        if (labelInput.value.trim() === entityColumnLabel) return;
        setEntityColumnLabel(dbPath, labelInput.value, { ctx });
        if (typeof renderPivot === 'function') renderPivot(ctx);
      };
      labelInput?.addEventListener('keydown', (e) => {
        if (e.isComposing || e.keyCode === 229) return;
        if (e.key === 'Enter') { e.preventDefault(); labelInput.blur(); }
        else if (e.key === 'Escape') { e.preventDefault(); skipCommit = true; labelInput.value = entityColumnLabel; labelInput.blur(); }
      });
      labelInput?.addEventListener('blur', commitLabel);
    }
    target.querySelector('#entity-column-pinned')?.addEventListener('change', function() {
      if (typeof setEntityColumnPinned === 'function') {
        setEntityColumnPinned(dbPath, !!this.checked, { ctx });
      } else {
        const c = getDbViewConfig(dbPath);
        c.entityColumnPinned = !!this.checked;
        saveDbViewConfig(dbPath, c, {
          historyLabel: `シート表示: ${entityColumnLabel}列固定`,
          historyDetail: this.checked ? '固定' : '解除',
        });
      }
      if (typeof renderPivot === 'function') renderPivot(ctx);
    });
    return;
  }
  const types = getPropertyTypes(dbPath);
  if (typeof isProductionManagementSheetPath === 'function' && isProductionManagementSheetPath(dbPath)) {
    const current = types[propName] || { type: 'text' };
    const typeLabel = typeof getPropertyTypeMenuItems === 'function'
      ? (getPropertyTypeMenuItems().find(item => item.type === current.type)?.label || current.type || 'テキスト')
      : (current.type || 'テキスト');
    target.innerHTML = `<div class="db-prop-settings" data-db-property-settings-root>
      <div class="gb-section-head">${esc(propName)}列</div>
      <div class="field"><label>列名</label><input type="text" value="${esc(propName)}" disabled aria-label="列名"></div>
      <div class="field"><label>列タイプ</label><input type="text" value="${esc(typeLabel)}" disabled aria-label="列タイプ"></div>
      <div class="gb-info-box">制作管理に必要な列のため変更できません ${fieldHelp('列名と列タイプは変更できませんが、並べ替え・ソート・非表示・列幅の調整は利用できます')}</div>
    </div>`;
    return;
  }
  const colOrder = typeof getColOrder === 'function' ? getColOrder(dbPath, { ctx }) : null;
  const availableProps = [
    ...new Set([
      ...(pivotData?.properties || []),
      ...(Array.isArray(colOrder) ? colOrder : []),
      ...Object.keys(types || {}),
    ]),
  ];
  const visibleAvailableProps = typeof filterDeletedDbProperties === 'function'
    ? filterDeletedDbProperties(dbPath, availableProps)
    : availableProps;
  if (visibleAvailableProps.length && !visibleAvailableProps.includes(propName)) {
    target.innerHTML = `<div class="gb-empty-placeholder" style="padding:16px;">列を選択してください</div>`;
    return;
  }

  const current = types[propName] || { type: 'text' };
  const scopeId = 'tab-' + Math.random().toString(36).slice(2, 8);
  target.innerHTML = `<div class="db-prop-settings" data-pt-root>
    <div class="gb-section-head">列設定</div>
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
    <div class="pt-autosave-status" aria-live="polite"></div>
  </div>`;
  const root = target.querySelector('[data-pt-root]');
  _ptSetState(root, current, _propertySettingsExistingValues(propName, pivotData), propName, dbPath, pivotData, ctx);
  onPropertyTypeChange(root);
  _bindDbPropertySettingsAutosave(root, propName);
}

function _ptSplitSelectOptionsFromTextarea(scope) {
  const textarea = _ptGet('pt-select-options', scope);
  if (!textarea) return null;
  return textarea.value.split('\n').map(s => s.trim()).filter(Boolean);
}

function _ptApplyFastLocalSettings(root) {
  const scope = _ptResolveRoot(root);
  const type = _ptReadUiType(scope);
  if (type !== 'select' && type !== 'multi-select') return false;
  const options = _ptSplitSelectOptionsFromTextarea(scope);
  if (!options) return false;
  const stateInfo = _ptState(scope);
  const dbPath = stateInfo.dbPath || state.currentDbPath || '';
  const propName = scope._ptAutosavePropName || stateInfo.propName;
  if (!dbPath || !propName) return false;

  const prev = stateInfo.current || getPropertyTypes(dbPath)?.[propName] || {};
  const config = { ...prev, type, options };
  if (typeof collectDbOptionColors === 'function') {
    const optionColors = collectDbOptionColors(scope, prev.optionColors, options);
    if (optionColors && Object.keys(optionColors).length) config.optionColors = optionColors;
    else delete config.optionColors;
  }
  const cfg = getDbViewConfig(dbPath);
  if (cfg) {
    if (!cfg.propertyTypes) cfg.propertyTypes = {};
    cfg.propertyTypes[propName] = config;
  }
  const targetMetadata = typeof _ptMetadataForDbPath === 'function' ? _ptMetadataForDbPath(dbPath) : null;
  if (targetMetadata) {
    if (!targetMetadata.property_types) targetMetadata.property_types = {};
    targetMetadata.property_types[propName] = config;
    const isCurrent = typeof _ptIsCurrentDbPath === 'function'
      ? _ptIsCurrentDbPath(dbPath)
      : dbPath === state.currentDbPath;
    if (isCurrent) state.dbMetadata = targetMetadata;
  }
  const ctx = stateInfo.ctx || _ptContextForDbPath(dbPath);
  if (ctx?.dbMetadata) {
    if (!ctx.dbMetadata.property_types) ctx.dbMetadata.property_types = {};
    ctx.dbMetadata.property_types[propName] = config;
  }
  _ptSetState(scope, config, stateInfo.existing, propName, dbPath, stateInfo.pivotData, ctx || stateInfo.ctx);
  return true;
}

function _bindDbPropertySettingsAutosave(root, initialPropName) {
  if (!root || root.dataset.ptAutosaveBound) return;
  root.dataset.ptAutosaveBound = '1';
  root._ptAutosavePropName = initialPropName;
  let timer = null;
  let saving = false;
  let queued = false;
  const schedule = (delay = 450) => {
    _ptApplyFastLocalSettings(root);
    const status = root.querySelector('.pt-autosave-status');
    if (status && !saving) status.textContent = '保存待ち...';
    clearTimeout(timer);
    timer = setTimeout(run, delay);
  };
  const run = async () => {
    if (!root.isConnected) return;
    if (saving) {
      queued = true;
      return;
    }
    saving = true;
    const status = root.querySelector('.pt-autosave-status');
    if (status) status.textContent = '保存中...';
    try {
      const result = await applyDbPropertySettings(root._ptAutosavePropName || initialPropName, root, { auto: true });
      if (result?.propName) root._ptAutosavePropName = result.propName;
      if (status) status.textContent = result ? '保存しました' : '';
    } finally {
      saving = false;
      if (queued) {
        queued = false;
        schedule(250);
      }
    }
  };
  root.addEventListener('input', (e) => {
    if (e.target?.closest?.('.db-picker-popup')) return;
    schedule();
  });
  root.addEventListener('change', () => {
    _ptRefreshAutoFillVisibility(root);
    schedule(120);
  });
  root.addEventListener('click', (e) => {
    if (e.target?.closest?.('button')) setTimeout(() => schedule(120), 0);
  });
  root.querySelector('#pt-type')?.addEventListener('change', () => {
    onPropertyTypeChange(root);
    _bindDbPropertySettingsAutosave(root, root._ptAutosavePropName || initialPropName);
    schedule(120);
  });
  // 列名欄は Enter で即確定・Escape で取り消し。既定の 450ms デバウンス待ちを挟まない。
  const nameInput = root.querySelector('#pt-prop-name');
  if (nameInput && !nameInput.dataset.ptNameKeyBound) {
    nameInput.dataset.ptNameKeyBound = '1';
    nameInput.addEventListener('keydown', (e) => {
      if (e.isComposing || e.keyCode === 229) return; // IME変換中は無視
      if (e.key === 'Enter') {
        e.preventDefault();
        clearTimeout(timer);
        _ptApplyFastLocalSettings(root);
        run();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        nameInput.value = root._ptAutosavePropName || initialPropName;
        nameInput.blur();
      }
    });
  }
}

async function applyDbPropertySettings(originalPropName, root, options = {}) {
  const scope = _ptResolveRoot(root);
  const stateInfo = _ptState(scope);
  const dbPath = stateInfo.dbPath || state.currentDbPath;
  const ctx = stateInfo.ctx || _ptContextForDbPath(dbPath);
  const pivotData = stateInfo.pivotData || _ptPivotDataForDbPath(dbPath);
  if (!dbPath || !originalPropName) return null;
  let propName = originalPropName;
  const nameInput = scope.querySelector('#pt-prop-name');
  const newName = (nameInput?.value || '').trim();
  if (!newName) {
    showStatus('列名を入力してください', true);
    return null;
  }
  if (newName !== originalPropName) {
    const rawExistingProps = [
      ...(Array.isArray(pivotData?.properties) ? pivotData.properties : []),
      ...(Array.isArray(getDbViewConfig(dbPath).colOrder) ? getDbViewConfig(dbPath).colOrder : []),
      ...Object.keys(getPropertyTypes(dbPath) || {}),
    ];
    const existingProps = new Set(
      typeof filterDeletedDbProperties === 'function'
        ? filterDeletedDbProperties(dbPath, rawExistingProps)
        : rawExistingProps
    );
    if (existingProps.has(newName)) {
      showStatus('同じ名前の列が既にあります: ' + newName, true);
      return null;
    }
    try {
      const ok = await renameDbProperty(dbPath, originalPropName, newName, ctx);
      if (!ok) return null;
    } catch (e) {
      showStatus('列名変更に失敗: ' + (e?.message || e), true);
      return null;
    }
    propName = newName;
    scope._ptPropName = propName;
  }
  _ptSetState(scope, getPropertyTypes(dbPath)[propName] || {}, _propertySettingsExistingValues(propName, pivotData), propName, dbPath, pivotData, ctx);
  const savedConfig = await applyPropertyType(propName, scope, { render: !options.auto });
  if (!savedConfig) return null;
  if (typeof _setSelectedColumns === 'function') _setSelectedColumns(dbPath, [propName], propName);
  if (typeof state !== 'undefined') state.selectedColumn = { dbPath, propName };
  if (!options.auto) {
    renderDbPropertySettingsPanel(dbPath, propName);
    showStatus('列設定を保存しました');
  }
  return { propName, config: savedConfig };
}

/* 型別値エディタ・ドロップダウン → gb-db-value-editors.js に分離 */
