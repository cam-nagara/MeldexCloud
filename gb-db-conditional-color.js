/* シート条件付きカラー — gb-db-props.js から分離 */

function getConditionalColors(dbPath, options = {}) { return getCurrentDbViewConfigEntry(dbPath, { ctx: options.ctx || null })?.conditionalColors || {}; }
function setConditionalColors(dbPath, colors, options = {}) {
  _saveCurrentDbViewField(dbPath, options.label || 'シート表示: 条件付きカラー', options.detail || '', options, (v) => {
    v.conditionalColors = colors;
  });
}

function _conditionalColorContext(dbPath, ctx) {
  if (ctx) return ctx;
  if (typeof _dbFindPaneContextForPath === 'function') return _dbFindPaneContextForPath(dbPath);
  return null;
}

function _conditionalColorPivotData(dbPath, ctx) {
  const paneCtx = _conditionalColorContext(dbPath, ctx);
  if (paneCtx?.pivotData) return paneCtx.pivotData;
  if (state.currentDbPath === dbPath) return state.pivotData;
  return null;
}

function _conditionalColorRules(colors, propName) {
  if (!colors || !Object.prototype.hasOwnProperty.call(colors, propName)) return [];
  return Array.isArray(colors[propName]) ? colors[propName] : [];
}

let _conditionalColorDialogSeq = 0;
let _conditionalColorRowSeq = 0;

function _conditionalColorTrigger(triggerEl) {
  if (triggerEl && typeof triggerEl.focus === 'function') return triggerEl;
  const active = document.activeElement;
  return active && typeof active.focus === 'function' ? active : null;
}

function _focusConditionalColorTrigger(triggerEl) {
  if (!triggerEl || typeof triggerEl.focus !== 'function' || !triggerEl.isConnected) return;
  try {
    triggerEl.focus({ preventScroll: true });
  } catch {
    try { triggerEl.focus(); } catch {}
  }
}

function _closeConditionalColorOverlay(overlay, triggerEl = null, options = {}) {
  if (!overlay || !overlay.isConnected) return;
  if (typeof overlay._conditionalColorCleanup === 'function') overlay._conditionalColorCleanup();
  overlay.remove();
  if (options.restoreFocus === false) return;
  _focusConditionalColorTrigger(triggerEl);
  setTimeout(() => _focusConditionalColorTrigger(triggerEl), 0);
  setTimeout(() => _focusConditionalColorTrigger(triggerEl), 60);
}

function _bindConditionalColorDismiss(overlay, modal, triggerEl) {
  if (!overlay || !modal) return;
  const onPointerDown = (e) => {
    if (e.target !== overlay) return;
    _closeConditionalColorOverlay(overlay, triggerEl);
  };
  const onKeyDown = (e) => {
    if (e.key !== 'Escape' || !overlay.isConnected) return;
    e.preventDefault();
    e.stopPropagation();
    _closeConditionalColorOverlay(overlay, triggerEl);
  };
  overlay.addEventListener('pointerdown', onPointerDown);
  document.addEventListener('keydown', onKeyDown, true);
  overlay._conditionalColorCleanup = () => {
    overlay.removeEventListener('pointerdown', onPointerDown);
    document.removeEventListener('keydown', onKeyDown, true);
    overlay._conditionalColorCleanup = null;
  };
}

function _enhanceConditionalColorOverlay(overlay, modal, triggerEl, focusTarget = null) {
  _bindConditionalColorDismiss(overlay, modal, triggerEl);
  document.body.appendChild(overlay);
  if (typeof GBModalShell !== 'undefined' && GBModalShell?.enhanceAll) GBModalShell.enhanceAll();
  requestAnimationFrame(() => {
    try {
      (focusTarget || modal)?.focus?.({ preventScroll: true });
    } catch {
      try { (focusTarget || modal)?.focus?.(); } catch {}
    }
  });
}

function showConditionalColorModal(propName, dbPathOverride = '', ctx = null, triggerEl = null) {
  const dbPath = dbPathOverride || state.currentDbPath;
  if (!dbPath) return;
  const trigger = _conditionalColorTrigger(triggerEl);
  if (!propName) { showConditionalColorPickerModal(dbPath, ctx, trigger); return; }
  const colors = getConditionalColors(dbPath, { ctx });
  const rules = _conditionalColorRules(colors, propName);
  const seq = ++_conditionalColorDialogSeq;
  const titleId = `cc-title-${seq}`;
  const descId = `cc-desc-${seq}`;

  const o = document.createElement('div');
  o.className = 'modal-overlay';
  o.dataset.conditionalColorDialog = 'rules';
  o._conditionalColorTrigger = trigger;
  o.innerHTML = `<div class="modal cond-modal" role="dialog" aria-modal="true" aria-labelledby="${titleId}" aria-describedby="${descId}" tabindex="-1" data-e2e-id="conditional-color-dialog">
    <h3 id="${titleId}">条件付きカラー: ${esc(propName)}</h3>
    <div id="${descId}" class="gb-visually-hidden">条件付きカラーのルール設定</div>
    <div class="modal-body cond-modal-body">
      <div id="cc-rules" class="cond-list"></div>
      <button type="button" id="cc-add-rule-btn" class="cond-add-btn gb-btn gb-btn-sm" data-e2e-id="cc-add-rule-btn">+ ルール追加</button>
    </div>
    <div class="btn-row">
      <button type="button" id="cc-cancel-btn" class="gb-btn gb-btn-sm" data-e2e-id="cc-cancel-btn">キャンセル</button>
      <button type="button" id="cc-apply-btn" class="gb-btn gb-btn-sm gb-btn-primary primary" data-e2e-id="cc-apply-btn">適用</button>
    </div>
  </div>`;
  const modal = o.querySelector('.cond-modal');
  const { list: container } = setupConditionModalLayout(o, '#cc-rules');
  rules.forEach(r => addConditionalColorRow(container, r));
  o.querySelector('#cc-add-rule-btn').addEventListener('click', (e) => {
    e.preventDefault();
    addConditionalColorRow(container, null);
  });
  o.querySelector('#cc-cancel-btn').addEventListener('click', () => _closeConditionalColorOverlay(o, trigger));
  o.querySelector('#cc-apply-btn').addEventListener('click', () => applyConditionalColors(propName, dbPath, ctx));
  _enhanceConditionalColorOverlay(o, modal, trigger, modal);
}

function showConditionalColorPickerModal(dbPathOverride = '', ctx = null, triggerEl = null) {
  const dbPath = dbPathOverride || state.currentDbPath;
  if (!dbPath) return;
  const trigger = _conditionalColorTrigger(triggerEl);
  const propTypes = getPropertyTypes(dbPath) || {};
  const props = [];
  const add = (prop) => {
    const type = propTypes[prop]?.type;
    if (prop && !props.includes(prop) && !['button', 'chat', 'multi-source-relation'].includes(type)) props.push(prop);
  };
  (_conditionalColorPivotData(dbPath, ctx)?.properties || []).forEach(add);
  (getColOrder(dbPath, { ctx }) || []).forEach(add);
  Object.keys(propTypes).forEach(add);
  const visibleProps = typeof filterDeletedDbProperties === 'function' ? filterDeletedDbProperties(dbPath, props) : props;
  if (visibleProps.length === 0) {
    showStatus('条件付きカラーを設定できるプロパティがありません', true);
    return;
  }
  const o = document.createElement('div');
  o.className = 'modal-overlay';
  o.dataset.conditionalColorDialog = 'picker';
  o._conditionalColorTrigger = trigger;
  const seq = ++_conditionalColorDialogSeq;
  const titleId = `cc-picker-title-${seq}`;
  const descId = `cc-picker-desc-${seq}`;
  o.innerHTML = `<div class="modal cond-picker-modal" role="dialog" aria-modal="true" aria-labelledby="${titleId}" aria-describedby="${descId}" tabindex="-1" data-e2e-id="conditional-color-picker-dialog" style="min-width:0;width:min(420px, calc(100vw - 32px));max-width:min(420px, calc(100vw - 32px));">
    <h3 id="${titleId}">条件付きカラー</h3>
    <div id="${descId}" class="gb-visually-hidden">条件付きカラーを設定するプロパティの選択</div>
    <div class="field gb-field"><label class="gb-label" for="cc-picker-prop">プロパティ</label>
      <select id="cc-picker-prop" class="gb-select" data-e2e-id="cc-picker-prop" style="width:100%;box-sizing:border-box;">
        ${visibleProps.map(prop => `<option value="${esc(prop)}">${esc(prop)}</option>`).join('')}
      </select>
    </div>
    <div class="btn-row">
      <button type="button" id="cc-picker-cancel" class="gb-btn gb-btn-sm" data-e2e-id="cc-picker-cancel">キャンセル</button>
      <button type="button" id="cc-picker-open" class="gb-btn gb-btn-sm gb-btn-primary primary" data-e2e-id="cc-picker-open">設定</button>
    </div>
  </div>`;
  const modal = o.querySelector('.cond-picker-modal');
  o.querySelector('#cc-picker-cancel')?.addEventListener('click', () => _closeConditionalColorOverlay(o, trigger));
  o.querySelector('#cc-picker-open')?.addEventListener('click', () => {
    const propName = o.querySelector('#cc-picker-prop')?.value || visibleProps[0];
    _closeConditionalColorOverlay(o, trigger, { restoreFocus: false });
    showConditionalColorModal(propName, dbPath, ctx, trigger);
  });
  _enhanceConditionalColorOverlay(o, modal, trigger, o.querySelector('#cc-picker-prop'));
}

function addConditionalColorRule() { addConditionalColorRow(document.getElementById('cc-rules'), null); }

function _conditionalColorRuleNeedsValue(op) {
  return op === 'contains' || op === 'equals' || op === 'not_equals';
}

function addConditionalColorRow(container, rule) {
  if (!container) return;
  const seq = ++_conditionalColorRowSeq;
  const row = document.createElement('div');
  row.className = 'cc-row';
  row.dataset.ccRow = '1';
  row.dataset.e2eId = 'cc-rule-row';
  row.style.cssText = 'display:block;width:100%;min-width:0;padding:8px;border:1px solid var(--ui-border, var(--border));border-radius:6px;background:var(--ui-bg-panel, var(--bg3));box-sizing:border-box;';
  const ops = [['contains', '含む'], ['equals', '一致'], ['not_equals', '不一致'], ['empty', '空'], ['not_empty', '非空']];

  const head = document.createElement('div');
  head.style.cssText = 'display:flex;align-items:center;justify-content:flex-end;margin:0 0 8px;';
  const delBtn = document.createElement('button');
  delBtn.type = 'button';
  delBtn.className = 'cc-del-btn cond-del-btn gb-btn gb-btn-sm gb-btn-danger';
  delBtn.dataset.e2eId = 'cc-delete-rule-btn';
  delBtn.textContent = '削除';
  delBtn.style.cssText = 'padding:4px 10px;min-height:32px;';
  delBtn.addEventListener('click', () => row.remove());
  head.appendChild(delBtn);
  row.appendChild(head);

  const opEl = document.createElement('select');
  opEl.id = `cc-op-${seq}`;
  opEl.className = 'cc-op gb-select';
  opEl.dataset.e2eId = 'cc-rule-op';
  styleConditionControl(opEl);
  ops.forEach(([value, label]) => {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = label;
    if ((!rule && value === 'not_empty') || rule?.op === value) opt.selected = true;
    opEl.appendChild(opt);
  });
  row.appendChild(createConditionFieldBlock('条件', opEl));

  const valEl = document.createElement('input');
  valEl.id = `cc-val-${seq}`;
  valEl.className = 'cc-val gb-input';
  valEl.dataset.e2eId = 'cc-rule-value';
  valEl.type = 'text';
  valEl.placeholder = '値';
  valEl.value = rule?.value ?? '';
  styleConditionControl(valEl, 'font-size:12px;padding:2px 4px;');
  row.appendChild(createConditionFieldBlock('値', valEl));

  const colorRow = document.createElement('div');
  colorRow.style.cssText = 'display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap;';

  const bgSwatch = document.createElement('button');
  bgSwatch.type = 'button';
  bgSwatch.id = `cc-bg-${seq}`;
  bgSwatch.className = 'cc-bg gb-fmt-swatch gb-fmt-swatch-bg';
  bgSwatch.dataset.e2eId = 'cc-bg-swatch';
  bgSwatch.dataset.color = rule?.bg || '#2980b9';
  bgSwatch.title = '背景色';
  bgSwatch.setAttribute('aria-label', '背景色');
  colorRow.appendChild(createConditionFieldBlock('背景色', bgSwatch));

  const fgSwatch = document.createElement('button');
  fgSwatch.type = 'button';
  fgSwatch.id = `cc-fg-${seq}`;
  fgSwatch.className = 'cc-fg gb-fmt-swatch gb-fmt-swatch-fg';
  fgSwatch.dataset.e2eId = 'cc-fg-swatch';
  fgSwatch.dataset.color = rule?.fg || '#ffffff';
  fgSwatch.title = '文字色';
  fgSwatch.setAttribute('aria-label', '文字色');
  colorRow.appendChild(createConditionFieldBlock('文字色', fgSwatch));
  row.appendChild(colorRow);

  container.appendChild(row);
  if (typeof setColorSwatchValue === 'function') {
    setColorSwatchValue(bgSwatch, rule?.bg || '#2980b9');
    setColorSwatchValue(fgSwatch, rule?.fg || '#ffffff');
  }
  if (typeof bindColorSwatch === 'function') {
    bindColorSwatch(bgSwatch, () => getColorSwatchValue(bgSwatch, rule?.bg || '#2980b9'), (nextColor) => {
      setColorSwatchValue(bgSwatch, nextColor || '#2980b9');
    });
    bindColorSwatch(fgSwatch, () => getColorSwatchValue(fgSwatch, rule?.fg || '#ffffff'), (nextColor) => {
      setColorSwatchValue(fgSwatch, nextColor || '#ffffff');
    });
  }
}

window.addConditionalColorRule = addConditionalColorRule;
window.addConditionalColorRow = addConditionalColorRow;

function applyConditionalColors(propName, dbPathOverride = '', ctx = null) {
  const dbPath = dbPathOverride || state.currentDbPath;
  if (!dbPath || !propName) return;
  const overlay = typeof document.querySelector === 'function'
    ? (document.querySelector('#cc-rules')?.closest?.('.modal-overlay') || null)
    : null;
  const queryRoot = overlay || document;
  const rows = typeof queryRoot.querySelectorAll === 'function'
    ? queryRoot.querySelectorAll('#cc-rules [data-cc-row]')
    : [];
  const rules = [];
  rows.forEach(row => {
    const op = row.querySelector('.cc-op').value;
    const value = row.querySelector('.cc-val').value;
    if (_conditionalColorRuleNeedsValue(op) && value === '') return;
    rules.push({
      op,
      value,
      bg: getColorSwatchValue(row.querySelector('.cc-bg'), '#2980b9'),
      fg: getColorSwatchValue(row.querySelector('.cc-fg'), '#ffffff'),
    });
  });
  const colors = getConditionalColors(dbPath, { ctx });
  if (rules.length > 0) colors[propName] = rules;
  else if (Object.prototype.hasOwnProperty.call(colors, propName)) delete colors[propName];
  setConditionalColors(dbPath, colors, { ctx });
  if (overlay) _closeConditionalColorOverlay(overlay, overlay._conditionalColorTrigger || null);
  else closeConditionModal('#cc-rules');
  const renderTargets = typeof _dbPaneContextsForPath === 'function'
    ? _dbPaneContextsForPath(dbPath)
    : [_conditionalColorContext(dbPath, ctx)].filter(Boolean);
  if (ctx && !renderTargets.includes(ctx)) renderTargets.unshift(ctx);
  (renderTargets.length ? renderTargets : [null]).forEach(renderCtx => renderPivot(renderCtx));
}

function _conditionalColorText(value) {
  if (Array.isArray(value)) {
    return value.map(v => {
      if (v && typeof v === 'object') return v.value == null ? '' : String(v.value);
      return v == null ? '' : String(v);
    }).join(', ');
  }
  if (value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, 'value')) {
    return value.value == null ? '' : String(value.value);
  }
  const v = value == null ? '' : String(value);
  return v;
}

function getCellColor(value, propName, dbPath, ctx = null) {
  const colors = getConditionalColors(dbPath, { ctx });
  const rules = _conditionalColorRules(colors, propName);
  if (!Array.isArray(rules)) return null;
  const v = _conditionalColorText(value);
  for (const r of rules) {
    const ruleValue = r.value == null ? '' : String(r.value);
    if (_conditionalColorRuleNeedsValue(r.op) && ruleValue === '') continue;
    let match = false;
    switch (r.op) {
      case 'contains': match = v.includes(ruleValue); break;
      case 'equals': match = v === ruleValue; break;
      case 'not_equals': match = v !== ruleValue; break;
      case 'empty': match = !v || v.trim() === ''; break;
      case 'not_empty': match = v && v.trim() !== ''; break;
    }
    if (match) return { bg: r.bg, fg: r.fg };
  }
  return null;
}
