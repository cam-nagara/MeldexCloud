/* シート条件付きカラー — gb-db-props.js から分離 */

function getConditionalColors(dbPath) { return getCurrentDbViewConfigEntry(dbPath)?.conditionalColors || {}; }
function setConditionalColors(dbPath, colors, options = {}) {
  _saveCurrentDbViewField(dbPath, options.label || 'シート表示: 条件付きカラー', options.detail || '', options, (v) => {
    v.conditionalColors = colors;
  });
}

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
    <div class="modal-body cond-modal-body">
      <div id="cc-rules" class="cond-list"></div>
      <button type="button" id="cc-add-rule-btn" class="cond-add-btn">+ ルール追加</button>
    </div>
    <div class="btn-row">
      <button type="button" id="cc-cancel-btn">キャンセル</button>
      <button type="button" id="cc-apply-btn" class="primary">適用</button>
    </div>
  </div>`;
  document.body.appendChild(o);
  const { list: container } = setupConditionModalLayout(o, '#cc-rules');
  rules.forEach(r => addConditionalColorRow(container, r));
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

function _conditionalColorRuleNeedsValue(op) {
  return op === 'contains' || op === 'equals' || op === 'not_equals';
}

function addConditionalColorRow(container, rule) {
  if (!container) return;
  const row = document.createElement('div');
  row.className = 'cc-row';
  row.dataset.ccRow = '1';
  row.style.cssText = 'display:block;width:100%;min-width:0;padding:8px;border:1px solid var(--ui-border, var(--border));border-radius:6px;background:var(--ui-bg-panel, var(--bg3));box-sizing:border-box;';
  const ops = [['contains', '含む'], ['equals', '一致'], ['not_equals', '不一致'], ['empty', '空'], ['not_empty', '非空']];

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
    if ((!rule && value === 'not_empty') || rule?.op === value) opt.selected = true;
    opEl.appendChild(opt);
  });
  row.appendChild(createConditionFieldBlock('条件', opEl));

  const valEl = document.createElement('input');
  valEl.className = 'cc-val';
  valEl.type = 'text';
  valEl.placeholder = '値';
  valEl.value = rule?.value ?? '';
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

function applyConditionalColors(propName) {
  const dbPath = state.currentDbPath;
  const rows = document.querySelectorAll('#cc-rules [data-cc-row]');
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
  const colors = getConditionalColors(dbPath);
  if (rules.length > 0) colors[propName] = rules;
  else delete colors[propName];
  setConditionalColors(dbPath, colors);
  closeConditionModal('#cc-rules');
  renderPivot();
}

function getCellColor(value, propName, dbPath) {
  const colors = getConditionalColors(dbPath);
  const rules = colors[propName];
  if (!Array.isArray(rules)) return null;
  const v = value == null ? '' : String(value);
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
