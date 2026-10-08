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
  if (overlay._conditionalColorModalApi?.close) {
    overlay._conditionalColorModalApi.close(options.reason || 'programmatic');
    return;
  }
  if (typeof overlay._conditionalColorCleanup === 'function') overlay._conditionalColorCleanup();
  overlay.remove();
  if (options.restoreFocus === false) return;
  _focusConditionalColorTrigger(triggerEl);
  setTimeout(() => _focusConditionalColorTrigger(triggerEl), 0);
  setTimeout(() => _focusConditionalColorTrigger(triggerEl), 60);
}

function _conditionalColorButton(id, text, primary = false) {
  const button = document.createElement('button');
  button.type = 'button';
  button.id = id;
  button.dataset.e2eId = id;
  button.className = `gb-btn gb-btn-sm${primary ? ' gb-btn-primary primary' : ''}`;
  button.textContent = text;
  return button;
}

function _conditionalColorDescription(id, text) {
  const description = document.createElement('div');
  description.id = `${id}-description`;
  description.className = 'gb-visually-hidden';
  description.textContent = text;
  return description;
}

function _configureConditionalColorDialog(modalApi, options) {
  modalApi.overlay.classList.add('modal-overlay');
  modalApi.overlay.dataset.conditionalColorDialog = options.kind;
  modalApi.overlay._conditionalColorTrigger = options.trigger;
  modalApi.overlay._conditionalColorModalApi = modalApi;
  modalApi.modal.dataset.e2eId = options.e2eId;
  modalApi.modal.setAttribute('aria-describedby', options.description.id);
  const headerClose = modalApi.header.querySelector('.gb-modal-close');
  if (headerClose) headerClose.dataset.e2eId = `conditional-color-${options.kind}-close-icon`;
  modalApi.open();
  return modalApi;
}

function showConditionalColorModal(propName, dbPathOverride = '', ctx = null, triggerEl = null) {
  const dbPath = dbPathOverride || state.currentDbPath;
  if (!dbPath) return;
  const trigger = _conditionalColorTrigger(triggerEl);
  if (!propName) { showConditionalColorPickerModal(dbPath, ctx, trigger); return; }
  const colors = getConditionalColors(dbPath, { ctx });
  const rules = _conditionalColorRules(colors, propName);
  const seq = ++_conditionalColorDialogSeq;
  const body = document.createElement('div');
  body.className = 'modal-body cond-modal-body';
  body.innerHTML = `<div id="cc-rules" class="cond-list"></div>
    <button type="button" id="cc-add-rule-btn" class="cond-add-btn gb-btn gb-btn-sm" data-e2e-id="cc-add-rule-btn">+ ルール追加</button>`;
  const cancelBtn = _conditionalColorButton('cc-cancel-btn', 'キャンセル');
  const applyBtn = _conditionalColorButton('cc-apply-btn', '適用', true);
  const dialogId = `conditional-color-rules-dialog-${seq}`;
  const description = _conditionalColorDescription(dialogId, '条件付きカラーのルール設定');
  const modalApi = window.GBUI.createModal({
    id: dialogId,
    title: `条件付きカラー: ${propName}`,
    body: [description, body],
    footer: [cancelBtn, applyBtn],
    variant: 'standard',
    extraClass: 'cond-modal',
    geometryKey: 'conditional-color-rules',
    initialFocus: '#cc-add-rule-btn',
    returnFocus: trigger || undefined,
  });
  _configureConditionalColorDialog(modalApi, {
    kind: 'rules',
    description,
    trigger,
    e2eId: 'conditional-color-dialog',
  });
  const o = modalApi.overlay;
  const { list: container } = setupConditionModalLayout(o, '#cc-rules');
  rules.forEach(r => addConditionalColorRow(container, r));
  o.querySelector('#cc-add-rule-btn').addEventListener('click', (e) => {
    e.preventDefault();
    addConditionalColorRow(container, null);
  });
  cancelBtn.addEventListener('click', () => modalApi.close('cancel'));
  applyBtn.addEventListener('click', () => applyConditionalColors(propName, dbPath, ctx));
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
    showStatus('条件付きカラーを設定できる列がありません', true);
    return;
  }
  const seq = ++_conditionalColorDialogSeq;
  const body = document.createElement('div');
  body.innerHTML = `<div class="field gb-field"><label class="gb-label" for="cc-picker-prop">列</label>
      <select id="cc-picker-prop" class="gb-select" data-e2e-id="cc-picker-prop" style="width:100%;box-sizing:border-box;">
        ${visibleProps.map(prop => `<option value="${esc(prop)}">${esc(prop)}</option>`).join('')}
      </select>
    </div>`;
  const cancelBtn = _conditionalColorButton('cc-picker-cancel', 'キャンセル');
  const openBtn = _conditionalColorButton('cc-picker-open', '設定', true);
  const dialogId = `conditional-color-picker-dialog-${seq}`;
  const description = _conditionalColorDescription(dialogId, '条件付きカラーを設定する列の選択');
  const modalApi = window.GBUI.createModal({
    id: dialogId,
    title: '条件付きカラー',
    body: [description, body],
    footer: [cancelBtn, openBtn],
    variant: 'standard',
    extraClass: 'cond-picker-modal',
    geometryKey: 'conditional-color-picker',
    initialFocus: '#cc-picker-prop',
    returnFocus: trigger || undefined,
  });
  _configureConditionalColorDialog(modalApi, {
    kind: 'picker',
    description,
    trigger,
    e2eId: 'conditional-color-picker-dialog',
  });
  modalApi.modal.style.minWidth = '0';
  modalApi.modal.style.width = 'min(420px, calc(100vw - 32px))';
  modalApi.modal.style.maxWidth = 'min(420px, calc(100vw - 32px))';
  cancelBtn.addEventListener('click', () => modalApi.close('cancel'));
  openBtn.addEventListener('click', () => {
    const propName = body.querySelector('#cc-picker-prop')?.value || visibleProps[0];
    modalApi.close('replace');
    showConditionalColorModal(propName, dbPath, ctx, trigger);
  });
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
  (renderTargets.length ? renderTargets : [null]).forEach(renderCtx => {
    if (typeof _renderCurrentDbView === 'function') _renderCurrentDbView(renderCtx, dbPath);
    else if (typeof renderPivot === 'function') renderPivot(renderCtx);
  });
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
