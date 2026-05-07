
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
      Object.assign(config, await _ensureBidirectionalRelationConfig(state.currentDbPath, propName, config));
    } catch (e) {
      showStatus('双方向リレーション設定に失敗: ' + (e?.message || e), true);
      return;
    }
  }
  if (typeof _disableBidirectionalRelationConfig === 'function') {
    try {
      await _disableBidirectionalRelationConfig(state.currentDbPath, propName, prev, config);
    } catch (e) {
      showStatus('双方向リレーション解除に失敗: ' + (e?.message || e), true);
      return;
    }
  }

  setPropertyType(state.currentDbPath, propName, config);
  _ptSetState(scope, config, window._ptExistingValues || [], propName);
  const overlay = scope.closest?.('.modal-overlay');
  if (overlay) overlay.remove();
  // 数式キャッシュをクリア
  if (type === 'formula') {
    for (const k in _formulaCache) delete _formulaCache[k];
  }
  renderPivot();
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
  const data = state.pivotData;
  if (!data || !data.entities) { resultEl.textContent = 'データがありません'; return; }
  const firstEntity = Object.keys(data.entities)[0];
  if (!firstEntity) { resultEl.textContent = 'エントリがありません'; return; }
  const entityData = data.entities[firstEntity];
  const result = formulaEvalForEntity(src, entityData);
  if (result.error) {
    const loc = Number.isFinite(result.errorPos) ? '（位置 ' + (result.errorPos + 1) + '）' : '';
    resultEl.innerHTML = '<span style="color:var(--red);">エラー' + loc + ': ' + esc(result.error) + '</span>';
  } else {
    resultEl.innerHTML = '<span style="color:var(--green);">' + esc(firstEntity) + ' → ' + esc(String(result.value)) + '</span>';
  }
}

function _ptFormulaProps() {
  const props = state.pivotData?.properties || [];
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
  const props = _ptFormulaProps();
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
  const tokens = formulaTokenize(src);
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
  preview.innerHTML = _ptHighlightFormula(textarea.value || '');
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

/* ==============================
   条件付きカラー
   ============================== */
function getConditionalColors(dbPath) { return getDbViewConfig(dbPath).conditionalColors || {}; }
function setConditionalColors(dbPath, colors) { const c = getDbViewConfig(dbPath); c.conditionalColors = colors; saveDbViewConfig(dbPath, c); }

function showConditionalColorModal(propName) {
  const dbPath = state.currentDbPath;
  if (!dbPath) return;
  if (!propName) { showConditionalColorPickerModal(); return; }
  const colors = getConditionalColors(dbPath);
  const rules = colors[propName] || [];

  const o = document.createElement('div');
  o.className = 'modal-overlay';
  o.innerHTML = `<div class="modal cond-modal">
    <h3>条件付きカラー: ${esc(propName)}</h3>
    <div id="cc-rules" class="cond-list"></div>
    <button type="button" id="cc-add-rule-btn" class="cond-add-btn">+ ルール追加</button>
    <div class="btn-row">
      <button type="button" id="cc-cancel-btn">キャンセル</button>
      <button type="button" id="cc-apply-btn" class="primary">適用</button>
    </div>
  </div>`;
  document.body.appendChild(o);
  window._ccPropName = propName;
  const container = o.querySelector('#cc-rules');
  if (container) {
    container.style.display = 'flex';
    container.style.flexDirection = 'column';
    container.style.gap = '8px';
    container.style.minWidth = '0';
  }
  rules.forEach(r => addConditionalColorRow(container, r));
  // 直接 addEventListener でバインド (data-action 委譲経路の不具合回避)
  o.querySelector('#cc-add-rule-btn').addEventListener('click', (e) => {
    e.preventDefault();
    addConditionalColorRow(container, null);
  });
  o.querySelector('#cc-cancel-btn').addEventListener('click', () => o.remove());
  o.querySelector('#cc-apply-btn').addEventListener('click', () => applyConditionalColors(propName));
}

function showConditionalColorPickerModal() {
  const dbPath = state.currentDbPath;
  if (!dbPath) return;
  const propTypes = getPropertyTypes(dbPath) || {};
  const props = [];
  const add = (prop) => {
    const type = propTypes[prop]?.type;
    if (prop && !props.includes(prop) && !['button', 'chat', 'multi-source-relation'].includes(type)) props.push(prop);
  };
  (state.pivotData?.properties || []).forEach(add);
  (getColOrder(dbPath) || []).forEach(add);
  Object.keys(propTypes).forEach(add);
  if (props.length === 0) {
    showStatus('条件付きカラーを設定できるプロパティがありません', true);
    return;
  }
  const o = document.createElement('div');
  o.className = 'modal-overlay';
  o.innerHTML = `<div class="modal" style="min-width:360px;">
    <h3>条件付きカラー</h3>
    <div class="field"><label>プロパティ</label>
      <select id="cc-picker-prop" class="gb-select" style="width:100%;">
        ${props.map(prop => `<option value="${esc(prop)}">${esc(prop)}</option>`).join('')}
      </select>
    </div>
    <div class="btn-row">
      <button type="button" id="cc-picker-cancel">キャンセル</button>
      <button type="button" id="cc-picker-open" class="primary">設定</button>
    </div>
  </div>`;
  document.body.appendChild(o);
  o.querySelector('#cc-picker-cancel')?.addEventListener('click', () => o.remove());
  o.querySelector('#cc-picker-open')?.addEventListener('click', () => {
    const propName = o.querySelector('#cc-picker-prop')?.value || props[0];
    o.remove();
    showConditionalColorModal(propName);
  });
}

function addConditionalColorRule() { addConditionalColorRow(document.getElementById('cc-rules'), null); }

function addConditionalColorRow(container, rule) {
  if (!container) return;
  const row = document.createElement('div');
  row.className = 'cc-row';
  row.dataset.ccRow = '1';
  row.style.cssText = 'display:block;width:100%;min-width:0;padding:8px;border:1px solid var(--ui-border, var(--border));border-radius:6px;background:var(--ui-bg-panel, var(--bg3));box-sizing:border-box;';
  const ops = [['contains','含む'],['equals','一致'],['not_equals','不一致'],['empty','空'],['not_empty','非空']];

  const head = document.createElement('div');
  head.style.cssText = 'display:flex;align-items:center;justify-content:flex-end;margin:0 0 8px;';
  const delBtn = document.createElement('button');
  delBtn.type = 'button';
  delBtn.className = 'cc-del-btn cond-del-btn';
  delBtn.textContent = '削除';
  delBtn.style.cssText = 'padding:4px 10px;min-height:32px;';
  delBtn.addEventListener('click', () => row.remove());
  head.appendChild(delBtn);
  row.appendChild(head);

  const opEl = document.createElement('select');
  opEl.className = 'cc-op gb-select';
  styleConditionControl(opEl);
  ops.forEach(([value, label]) => {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = label;
    if ((!rule && value === 'contains') || rule?.op === value) opt.selected = true;
    opEl.appendChild(opt);
  });
  row.appendChild(createConditionFieldBlock('条件', opEl));

  const valEl = document.createElement('input');
  valEl.className = 'cc-val';
  valEl.type = 'text';
  valEl.placeholder = '値';
  valEl.value = rule?.value || '';
  styleConditionControl(valEl, 'font-size:12px;padding:2px 4px;');
  row.appendChild(createConditionFieldBlock('値', valEl));

  const colorRow = document.createElement('div');
  colorRow.style.cssText = 'display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap;';

  const bgSwatch = document.createElement('button');
  bgSwatch.type = 'button';
  bgSwatch.className = 'cc-bg gb-fmt-swatch-bg';
  bgSwatch.dataset.color = rule?.bg || '#2980b9';
  bgSwatch.title = '背景色';
  colorRow.appendChild(createConditionFieldBlock('背景色', bgSwatch));

  const fgSwatch = document.createElement('button');
  fgSwatch.type = 'button';
  fgSwatch.className = 'cc-fg gb-fmt-swatch-fg';
  fgSwatch.dataset.color = rule?.fg || '#ffffff';
  fgSwatch.title = '文字色';
  colorRow.appendChild(createConditionFieldBlock('文字色', fgSwatch));
  row.appendChild(colorRow);

  container.appendChild(row);
  if (typeof bindColorSwatch === 'function') {
    bindColorSwatch(bgSwatch, () => getColorSwatchValue(bgSwatch, rule?.bg || '#2980b9'), (nextColor) => {
      setColorSwatchValue(bgSwatch, nextColor || '#2980b9');
    });
    bindColorSwatch(fgSwatch, () => getColorSwatchValue(fgSwatch, rule?.fg || '#ffffff'), (nextColor) => {
      setColorSwatchValue(fgSwatch, nextColor || '#ffffff');
    });
  }
}
// グローバル明示公開 (executeAction 委譲経路の互換性のため)
window.addConditionalColorRule = addConditionalColorRule;
window.addConditionalColorRow = addConditionalColorRow;

function applyConditionalColors(propName) {
  const dbPath = state.currentDbPath;
  const rows = document.querySelectorAll('#cc-rules [data-cc-row]');
  const rules = [];
  rows.forEach(row => {
    rules.push({
      op: row.querySelector('.cc-op').value,
      value: row.querySelector('.cc-val').value,
      bg: getColorSwatchValue(row.querySelector('.cc-bg'), '#2980b9'),
      fg: getColorSwatchValue(row.querySelector('.cc-fg'), '#ffffff'),
    });
  });
  const colors = getConditionalColors(dbPath);
  if (rules.length > 0) colors[propName] = rules;
  else delete colors[propName];
  setConditionalColors(dbPath, colors);
  document.querySelector('.modal-overlay').remove();
  renderPivot();
}

function getCellColor(value, propName, dbPath) {
  const colors = getConditionalColors(dbPath);
  const rules = colors[propName];
  if (!rules) return null;
  const v = value || '';
  for (const r of rules) {
    let match = false;
    switch (r.op) {
      case 'contains': match = v.includes(r.value); break;
      case 'equals': match = v === r.value; break;
      case 'not_equals': match = v !== r.value; break;
      case 'empty': match = !v || v.trim() === ''; break;
      case 'not_empty': match = v && v.trim() !== ''; break;
    }
    if (match) return { bg: r.bg, fg: r.fg };
  }
  return null;
}

// 日付値の表示用フォーマット: 時刻部分があれば "YYYY-MM-DD HH:MM" で表示
function _formatDateDisplay(v, ptc) {
  if (typeof _dbDateFormatDisplay === 'function') return _dbDateFormatDisplay(v, ptc);
  if (!v || typeof v !== 'string') return v || '';
  const m = v.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);
  if (m) return m[1] + ' ' + m[2];
  return v;
}
// ストア値からinput用の値に変換（datetime-local形式: "YYYY-MM-DDTHH:MM"）
function _toInputDateValue(v, wantTime) {
  if (typeof _dbDateToInputValue === 'function') return _dbDateToInputValue(v, wantTime);
  if (!v || typeof v !== 'string') return '';
  if (wantTime) {
    // datetime-local expects "YYYY-MM-DDTHH:MM"
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v)) return v.substring(0, 16);
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v + 'T00:00';
    return v;
  } else {
    // date input expects "YYYY-MM-DD"
    if (/^\d{4}-\d{2}-\d{2}/.test(v)) return v.substring(0, 10);
    return v;
  }
}

// 型に応じたセル描画
function createTypedValueElement(val, entityPath, propName, thumbSize, propTypeConfig) {
  if (!propTypeConfig || propTypeConfig.type === 'text') {
    return createValueElement(val, entityPath, propName, thumbSize);
  }

  // ボタン型: 値なし、ボタンのみ表示
  if (propTypeConfig.type === 'button') {
    const row = document.createElement('div');
    row.className = 'cell-value';
    const btn = document.createElement('button');
    btn.className = 'db-action-btn';
    btn.textContent = propTypeConfig.label || '実行';
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const dbPath = state.currentDbPath;
      const entityName = entityPath.replace(/\.md$/, '').split('/').pop();
      _executeButtonActions(dbPath, entityName, propTypeConfig.actions || []);
    });
    row.appendChild(btn);
    return row;
  }

  const row = document.createElement('div');
  row.className = 'cell-value' + (val.status === 'ボツ' ? ' status-botsu' : '');
  _setupCellValueDrag(row, val, entityPath, propName);

  // Status dot（採用状況フィルタ無効時 or DB側でステータス機能 OFF の場合は非表示）
  if (state.filter !== 'disabled' && getStatusEnabled(state.currentDbPath)) {
    const dot = document.createElement('span');
    dot.className = 'status-dot';
    dot.style.background = _getStatusColor(val.status, state.currentDbPath);
    dot.title = val.status || '案';
    dot.addEventListener('click', (e) => { e.stopPropagation(); showStatusDropdown(dot, val, entityPath, propName); });
    row.appendChild(dot);
  }

  // 共通「...」ホバーボタン（全型に削除等のコンテキストメニュー）
  row.style.position = 'relative';
  const moreBtn = document.createElement('span');
  moreBtn.className = 'cell-value-more';
  moreBtn.style.cssText = 'position:absolute;right:28px;top:50%;transform:translateY(-50%);display:none;cursor:pointer;padding:0 2px;color:var(--fg2);background:var(--bg3);border-radius:3px;z-index:2;';
  moreBtn.innerHTML = lucide('ellipsis', 12);
  moreBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    _showValueContextMenu(e, val, entityPath, propName);
  });
  row.appendChild(moreBtn);
  row.addEventListener('mouseenter', () => { moreBtn.style.display = ''; });
  row.addEventListener('mouseleave', () => { moreBtn.style.display = 'none'; });

  const v = val.value || '';
  const type = propTypeConfig.type;

  if (type === 'checkbox') {
    const cb = document.createElement('span');
    cb.className = 'cell-checkbox';
    cb.textContent = (v === 'true' || v === 'はい' || v === '1' || v === 'yes') ? '\u2611' : '\u2610';
    cb.addEventListener('click', async (e) => {
      e.stopPropagation();
      const lockMsg = checkColumnEditable(state.currentDbPath, propName);
      if (lockMsg) { showStatus(lockMsg); return; }
      const isChecked = v === 'true' || v === 'はい' || v === '1' || v === 'yes';
      const nv = isChecked ? 'false' : 'true';
      try {
        await _apiPutValue(val, { new_value: nv });
        _dbUndoValue('チェック: ' + v + ' → ' + nv, val, v, nv);
        val.value = nv;
        cb.textContent = nv === 'true' ? '\u2611' : '\u2610';
        showStatus(nv === 'true' ? '\u2611 チェック' : '\u2610 チェック解除');
        // Step 3: 部分更新化 (checkbox) — 条件付き書式 / フィルタ・グループ・ソート再評価のため
        if (typeof _refreshAfterCellEdit === 'function') _refreshAfterCellEdit(cb, entityPath, propName);
      } catch (e) {}
    });
    row.appendChild(cb);
    return row;
  }

  if (type === 'date') {
    const span = document.createElement('span');
    span.className = 'cell-date value-text';
    span.textContent = _formatDateDisplay(v, propTypeConfig);
    span.addEventListener('click', () => {
      const lockMsg = checkColumnEditable(state.currentDbPath, propName);
      if (lockMsg) { showStatus(lockMsg); return; }
      if (span.querySelector('.cell-date-editor')) return;
      const editor = typeof _dbDateCreateEditor === 'function'
        ? _dbDateCreateEditor(v, propTypeConfig, {
          layout: 'inline',
          className: 'cell-date-editor',
          rootStyle: 'display:flex;align-items:center;gap:4px;flex-wrap:wrap;width:calc(100% - 28px);',
          inputStyle: 'flex:1 1 0;min-width:130px;padding:3px 6px;background:var(--bg2);color:var(--fg);border:1px solid var(--accent);border-radius:3px;font-size:12px;box-sizing:border-box;',
          inputClassName: 'value-input cell-date-input',
        })
        : null;
      if (!editor) return;
      span.textContent = '';
      span.appendChild(editor.root);
      // 編集中は同セル内の「...」「+」を隠す
      const moreBtn = row.querySelector('.cell-value-more');
      if (moreBtn) moreBtn.style.display = 'none';
      const td = row.closest('td');
      const addBtn = td ? td.querySelector('.cell-add-btn') : null;
      if (addBtn) { addBtn.dataset.editingHidden = '1'; addBtn.style.display = 'none'; }
      const restoreBtns = () => {
        if (addBtn && addBtn.dataset.editingHidden) { addBtn.style.display = ''; delete addBtn.dataset.editingHidden; }
        if (moreBtn) moreBtn.style.display = 'none';
      };
      editor.focus();
      let done = false;
      const finish = async () => {
        if (done) return;
        done = true;
        restoreBtns();
        const nv = editor.getValue();
        span.textContent = _formatDateDisplay(nv || v, propTypeConfig);
        const oldNormalized = typeof _dbDateNormalizeForCompare === 'function'
          ? _dbDateNormalizeForCompare(v, propTypeConfig)
          : _toInputDateValue(v, editor.mode?.withTime);
        if (nv !== oldNormalized) {
          try {
            await _apiPutValue(val, { new_value: nv });
            _dbUndoValue(propName + ': ' + v + ' → ' + nv, val, v, nv);
            val.value = nv;
            // Step 3: 部分更新化 (ソート対象列等のフォールバックは _tryRefreshPivotCellLocal 内で判定)
            _refreshAfterCellEdit(span, entityPath, propName);
          } catch (e) { span.textContent = _formatDateDisplay(v, propTypeConfig); }
        }
      };
      editor.root.addEventListener('focusout', (e) => {
        if (editor.contains(e.relatedTarget)) return;
        finish();
      });
      if (!editor.mode?.withTime && !editor.mode?.range && editor.startInput) {
        editor.startInput.addEventListener('change', finish);
      }
      editor.root.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); finish(); }
        if (e.key === 'Escape') { e.preventDefault(); done = true; restoreBtns(); span.textContent = _formatDateDisplay(v, propTypeConfig); }
      });
    });
    row.appendChild(span);
    return row;
  }

  if (type === 'number') {
    const span = document.createElement('span');
    span.className = 'cell-number value-text';
    span.textContent = v;
    span.addEventListener('click', () => startInlineEdit(span, val, entityPath, propName));
    row.appendChild(span);
    if (propTypeConfig.unit) {
      const unit = document.createElement('span');
      unit.className = 'value-unit';
      unit.textContent = propTypeConfig.unit;
      row.appendChild(unit);
    }
    return row;
  }

  if (type === 'url') {
    if (/^https?:\/\//.test(v)) {
      const link = document.createElement('a');
      link.className = 'value-url';
      link.href = v;
      link.target = '_blank';
      link.rel = 'noopener';
      try { link.textContent = new URL(v).hostname + '\u2026'; } catch { link.textContent = v; }
      link.addEventListener('click', (e) => e.stopPropagation());
      row.appendChild(link);
    } else {
      const txt = document.createElement('span');
      txt.className = 'value-text';
      txt.textContent = v;
      txt.addEventListener('click', () => startInlineEdit(txt, val, entityPath, propName));
      row.appendChild(txt);
    }
    return row;
  }

  if (type === 'select') {
    const span = document.createElement('span');
    span.className = 'cell-select-val';
    span.textContent = v;
    span.style.cursor = 'pointer';
    span.addEventListener('click', (e) => {
      e.stopPropagation();
      showSelectDropdown(span, val, entityPath, propName, propTypeConfig.options || []);
    });
    row.appendChild(span);
    return row;
  }

  if (type === 'multi-select') {
    const tags = v.split(',').map(s => s.trim()).filter(Boolean);
    const tagContainer = document.createElement('div');
    tagContainer.className = 'multi-select-tags';
    tagContainer.style.cssText = 'display:flex;flex-wrap:wrap;gap:3px;cursor:pointer;';
    tags.forEach(t => {
      const tag = document.createElement('span');
      tag.className = 'multi-select-tag';
      tag.textContent = t;
      tagContainer.appendChild(tag);
    });
    // クリックでインライン編集（カンマ区切り）
    tagContainer.addEventListener('click', (e) => {
      e.stopPropagation();
      const lockMsg = checkColumnEditable(state.currentDbPath, propName);
      if (lockMsg) { showStatus(lockMsg); return; }
      if (tagContainer.querySelector('input')) return;
      tagContainer.innerHTML = '';
      const inp = document.createElement('input');
      inp.type = 'text';
      inp.value = tags.join(', ');
      inp.style.cssText = 'width:100%;padding:2px 4px;background:var(--bg2);color:var(--fg);border:1px solid var(--accent);border-radius:3px;font-size:12px;';
      tagContainer.appendChild(inp);
      inp.focus();
      inp.select();
      let done = false;
      const finish = async () => {
        if (done) return; done = true;
        const nv = inp.value.trim();
        if (nv === v || !nv) { _refreshAfterCellEdit(tagContainer, entityPath, propName); return; }
        try {
          await _apiPutValue(val, { new_value: nv });
          _dbUndoValue(propName + ': ' + v + ' → ' + nv, val, v, nv);
          val.value = nv;
          // Step 3: 部分更新化 (multi-select)
          _refreshAfterCellEdit(tagContainer, entityPath, propName);
        } catch(e) { _refreshAfterCellEdit(tagContainer, entityPath, propName); }
      };
      inp.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') { ev.preventDefault(); finish(); }
        if (ev.key === 'Escape') { ev.preventDefault(); done = true; _refreshAfterCellEdit(tagContainer, entityPath, propName); }
      });
      inp.addEventListener('blur', finish);
    });
    row.appendChild(tagContainer);
    return row;
  }

  if (type === 'user') {
    const span = document.createElement('span');
    span.className = 'cell-user-val';
    span.style.cssText = 'display:inline-flex;align-items:center;gap:4px;cursor:pointer;padding:2px 6px;border-radius:3px;font-size:12px;';
    if (v) {
      span.innerHTML = _userAvatarSmall(v) + ' ' + esc(v);
    } else {
      span.textContent = '—';
      span.style.color = 'var(--fg2)';
    }
    span.addEventListener('click', (e) => {
      e.stopPropagation();
      const lockMsg = checkColumnEditable(state.currentDbPath, propName);
      if (lockMsg) { showStatus(lockMsg); return; }
      _showUserDropdown(span, val, entityPath, propName, v, false);
    });
    row.appendChild(span);
    return row;
  }

  if (type === 'multi-user') {
    const container = document.createElement('div');
    container.className = 'multi-user-tags';
    container.style.cssText = 'display:flex;flex-wrap:wrap;gap:2px;cursor:pointer;';
    const users = v ? v.split(',').map(s => s.trim()).filter(Boolean) : [];
    if (users.length === 0) {
      container.textContent = '—';
      container.style.color = 'var(--fg2)';
      container.style.fontSize = '12px';
      container.style.padding = '2px';
    }
    users.forEach(u => {
      const tag = document.createElement('span');
      tag.className = 'multi-user-tag';
      tag.style.cssText = 'display:inline-flex;align-items:center;gap:3px;padding:1px 6px;border-radius:10px;font-size:11px;background:var(--bg3);border:1px solid var(--border);';
      tag.innerHTML = _userAvatarSmall(u) + ' ' + esc(u);
      container.appendChild(tag);
    });
    container.addEventListener('click', (e) => {
      e.stopPropagation();
      const lockMsg = checkColumnEditable(state.currentDbPath, propName);
      if (lockMsg) { showStatus(lockMsg); return; }
      _showUserDropdown(container, val, entityPath, propName, v, true);
    });
    row.appendChild(container);
    return row;
  }

  if (type === 'relation') {
    const span = document.createElement('span');
    span.className = 'relation-link';
    span.textContent = v || '(未選択)';
    span.style.cursor = 'pointer';
    // 自己参照対応: relationDb === '' なら現在のDBを使う
    const _relDb = (propTypeConfig.relationDb === '' ? state.currentDbPath : propTypeConfig.relationDb) || '';
    span.dataset.dbPath = _relDb;
    span.dataset.entityId = v;
    // キャッシュ済みなら同期表示、未解決時のみ非同期フォロー
    if (v && _relDb) {
      const display = _getRelationDisplayInfo(v, _relDb);
      span.textContent = display.label || v;
      span.dataset.entityName = display.label || v;
      if (!display.resolved) {
        _resolveRelationName(v, _relDb).then(name => {
          span.textContent = name;
          span.dataset.entityName = name || v;
        });
      }
      // カスケード不整合警告
      if (propTypeConfig.cascadeFrom) {
        _validateCascadeValue(v, entityPath, propTypeConfig).then(valid => {
          if (!valid) {
            span.style.background = 'rgba(255,100,100,0.15)';
            span.title = '依存元（' + propTypeConfig.cascadeFrom + '）の値と一致しません';
          }
        });
      }
    }
    span.addEventListener('click', (e) => {
      e.stopPropagation();
      const lockMsg = checkColumnEditable(state.currentDbPath, propName);
      if (lockMsg) { showStatus(lockMsg); return; }
      _showRelationDropdown(span, val, entityPath, propName, propTypeConfig, false);
    });
    if (v) span.ondblclick = (e) => {
      e.stopPropagation();
      const name = _resolveRelationNameSync(v, _relDb);
      navigateToEntity(name);
    };
    row.appendChild(span);
    return row;
  }

  if (type === 'multi-relation') {
    const ids = v.split(',').map(s => s.trim()).filter(Boolean);
    const tagContainer = document.createElement('div');
    tagContainer.className = 'multi-select-tags';
    tagContainer.style.cssText = 'display:flex;flex-wrap:wrap;gap:3px;cursor:pointer;';
    // 自己参照対応: relationDb === '' なら現在のDBを使う
    const _relDbM = (propTypeConfig.relationDb === '' ? state.currentDbPath : propTypeConfig.relationDb) || '';
    ids.forEach(idOrName => {
      const tag = document.createElement('span');
      tag.className = 'relation-link';
      const display = _relDbM ? _getRelationDisplayInfo(idOrName, _relDbM) : { label: idOrName, resolved: true };
      tag.textContent = display.label || idOrName;
      tag.dataset.dbPath = _relDbM;
      tag.dataset.entityId = idOrName;
      tag.dataset.entityName = display.label || idOrName;
      if (_relDbM && !display.resolved) {
        _resolveRelationName(idOrName, _relDbM).then(name => {
          tag.textContent = name;
          tag.dataset.entityName = name || idOrName;
        });
      }
      tag.ondblclick = (e) => {
        e.stopPropagation();
        const name = _resolveRelationNameSync(idOrName, _relDbM);
        navigateToEntity(name);
      };
      tagContainer.appendChild(tag);
    });
    tagContainer.addEventListener('click', (e) => {
      e.stopPropagation();
      const lockMsg = checkColumnEditable(state.currentDbPath, propName);
      if (lockMsg) { showStatus(lockMsg); return; }
      _showRelationDropdown(tagContainer, val, entityPath, propName, propTypeConfig, true);
    });
    row.appendChild(tagContainer);
    return row;
  }

  // マルチソースリレーション型
  if (type === 'multi-source-relation') {
    const tagContainer = document.createElement('div');
    tagContainer.className = 'msr-tags';
    const entries = _parseMsrValue(v);
    const sources = propTypeConfig.sources || [];

    if (entries.length === 0 && propTypeConfig.mode !== 'auto') {
      tagContainer.textContent = '—';
      tagContainer.style.cssText = 'color:var(--fg2);font-size:12px;padding:2px;cursor:pointer;';
    }

    entries.forEach(entry => {
      const tag = document.createElement('span');
      tag.className = 'msr-tag';
      // DBラベルバッジ
      const srcIdx = sources.findIndex(s => s.db === entry.db);
      const label = (srcIdx >= 0 && sources[srcIdx].label) ? sources[srcIdx].label : (entry.db.split('/').pop() || '?');
      const badge = document.createElement('span');
      badge.className = 'msr-badge msr-badge-' + Math.max(0, Math.min(srcIdx, 4));
      badge.textContent = label;
      tag.appendChild(badge);
      // エントリ名（非同期解決）
      const nameSpan = document.createElement('span');
      nameSpan.className = 'msr-name';
      const display = entry.db ? _getRelationDisplayInfo(entry.id, entry.db) : { label: entry.id, resolved: true };
      nameSpan.textContent = display.label || entry.id;
      if (entry.db && !display.resolved) {
        _resolveRelationName(entry.id, entry.db).then(name => { nameSpan.textContent = name; });
      }
      tag.appendChild(nameSpan);
      // ダブルクリック → ナビゲーション
      tag.ondblclick = async (e) => {
        e.stopPropagation();
        const name = await _resolveRelationName(entry.id, entry.db);
        if (name && typeof navigateToEntity === 'function') navigateToEntity(name, entry.db);
      };
      tagContainer.appendChild(tag);
    });

    // 自動モード: 読取専用
    if (propTypeConfig.mode === 'auto') {
      tagContainer.title = '自動収集（読み取り専用）';
    } else {
      // 手動モード: クリックでドロップダウン
      tagContainer.style.cursor = 'pointer';
      tagContainer.addEventListener('click', (e) => {
        e.stopPropagation();
        _showMsrDropdown(tagContainer, val, entityPath, propName, propTypeConfig);
      });
    }
    row.appendChild(tagContainer);
    return row;
  }

  // チャット型
  if (type === 'chat') {
    const container = document.createElement('div');
    container.className = 'chat-prop-cell';
    container.style.cssText = 'display:flex;flex-wrap:wrap;gap:3px;align-items:center;';
    const chatPaths = v ? v.split(',').map(s => s.trim()).filter(Boolean) : [];

    if (chatPaths.length === 0) {
      // チャットなし: ＋ボタンのみ
      const addBtn = document.createElement('button');
      addBtn.className = 'db-chat-add-btn';
      addBtn.innerHTML = lucide('plus', 12) + ' チャット';
      addBtn.style.cssText = 'display:inline-flex;align-items:center;gap:2px;padding:2px 8px;font-size:11px;background:var(--bg3);color:var(--fg2);border:1px solid var(--border);border-radius:3px;cursor:pointer;';
      addBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        _createEntityChat(entityPath, val, propName);
      });
      container.appendChild(addBtn);
    } else {
      // チャットあり: チャット名リンク + ＋ボタン
      chatPaths.forEach(cp => {
        const chatName = cp.split('/').pop().replace(/\.md$/, '');
        const link = document.createElement('span');
        link.className = 'chat-prop-link';
        link.textContent = chatName;
        link.dataset.chatPropPath = cp;
        link.dataset.gbTooltipDisabled = 'true';
        link.style.cssText = 'display:inline-flex;align-items:center;gap:2px;padding:1px 6px;font-size:11px;background:var(--bg3);border-radius:3px;cursor:pointer;color:var(--accent);';
        link.innerHTML = '<span style="opacity:0.7;">' + lucide('messagesSquare', 11) + '</span> ' + esc(chatName);
        link.addEventListener('click', (e) => {
          e.stopPropagation();
          _openEntityChat(cp);
        });
        container.appendChild(link);
      });
      // ＋ボタン
      const addMore = document.createElement('span');
      addMore.style.cssText = 'cursor:pointer;color:var(--fg2);padding:0 2px;';
      addMore.innerHTML = lucide('plus', 12);
      addMore.title = 'チャットを追加';
      addMore.addEventListener('click', (e) => {
        e.stopPropagation();
        _createEntityChat(entityPath, val, propName);
      });
      container.appendChild(addMore);
    }
    row.appendChild(container);
    return row;
  }

  // fallback
  return createValueElement(val, entityPath, propName, thumbSize);
}

// マルチソースリレーション値パーサ: "db1::id1, db2::id2" → [{ db, id }]
function _parseMsrValue(v) {
  if (!v) return [];
  return v.split(',').map(s => s.trim()).filter(Boolean).map(s => {
    const sep = s.indexOf('::');
    if (sep < 0) return { db: '', id: s };
    return { db: s.substring(0, sep), id: s.substring(sep + 2) };
  });
}

// マルチソースリレーション手動ドロップダウン
async function _showMsrDropdown(anchor, val, entityPath, propName, ptc) {
  closeAllDropdowns();
  const sources = ptc.sources || [];
  if (sources.length === 0) { showStatus('ソースシートが設定されていません', true); return; }

  const dd = document.createElement('div');
  dd.className = 'status-dropdown';
  dd.style.cssText = 'max-height:350px;overflow-y:auto;min-width:250px;';

  // 検索ボックス
  const search = document.createElement('input');
  search.type = 'text'; search.placeholder = 'エントリを検索...';
  search.style.cssText = 'width:100%;padding:4px 6px;margin-bottom:4px;background:var(--bg);color:var(--fg);border:1px solid var(--border);border-radius:3px;font-size:12px;';
  dd.appendChild(search);

  const currentVals = _parseMsrValue(val?.value || '');
  const isSelected = (db, id) => currentVals.some(v => v.db === db && v.id === id);

  const listDiv = document.createElement('div');

  // 全ソースDBのエントリをロード
  const allEntries = []; // { db, id, name, label }
  for (const src of sources) {
    if (!src.db) continue;
    try {
      const map = await _getRelationMap(src.db);
      const label = src.label || src.db.split('/').pop();
      for (const [id, name] of Object.entries(map.idToName)) {
        allEntries.push({ db: src.db, id, name, label });
      }
    } catch {}
  }

  const renderList = (filter) => {
    listDiv.innerHTML = '';
    const filtered = filter ? allEntries.filter(e => e.name.toLowerCase().includes(filter.toLowerCase())) : allEntries;

    // ソースDB別にグループ化
    const groups = {};
    filtered.forEach(e => {
      if (!groups[e.db]) groups[e.db] = { label: e.label, entries: [] };
      groups[e.db].entries.push(e);
    });

    for (const [db, group] of Object.entries(groups)) {
      // グループヘッダー
      const header = document.createElement('div');
      header.style.cssText = 'padding:4px 8px;font-size:11px;font-weight:bold;color:var(--fg2);border-bottom:1px solid var(--border);';
      header.textContent = '── ' + group.label + ' ──';
      listDiv.appendChild(header);

      group.entries.forEach(entry => {
        const sel = isSelected(entry.db, entry.id);
        const item = document.createElement('div');
        item.className = 'dd-nav-item';
        item.style.cssText = 'padding:4px 8px;cursor:pointer;font-size:12px;display:flex;align-items:center;gap:6px;';
        if (sel) item.style.background = 'rgba(86,156,214,0.15)';
        item.onmouseenter = () => { item.style.background = 'var(--bg4)'; };
        item.onmouseleave = () => { item.style.background = sel ? 'rgba(86,156,214,0.15)' : ''; };
        const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = sel;
        item.appendChild(cb);
        item.appendChild(document.createTextNode(entry.name));
        item.addEventListener('click', () => {
          const idx = currentVals.findIndex(v => v.db === entry.db && v.id === entry.id);
          if (idx >= 0) currentVals.splice(idx, 1); else currentVals.push({ db: entry.db, id: entry.id });
          const nv = currentVals.map(v => v.db + '::' + v.id).join(', ');
          const oldVal = val.value || '';
          if (val.file) {
            _apiPutValue(val, { new_value: nv }).then(() => {
              _dbUndoValue(propName, val, oldVal, nv);
            }).catch(() => {});
            renderList(search.value);
          } else {
            // 新規作成後はドロップダウンを閉じてDB再読込（val.file取得のため）
            _apiPostValue(entityPath, propName, nv, '採用', '').then(() => {
              dd.remove();
              if (state.currentDbPath) selectDatabase(state.currentDbPath);
            }).catch(() => {});
          }
        });
        listDiv.appendChild(item);
      });
    }
  };
  renderList('');
