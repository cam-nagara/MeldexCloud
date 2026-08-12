/* 複数条件フィルタモーダル — gb-db-props.js から分離 */

// 互換テスト用: function _getAdvancedFilterPropertyNames(dbPath)
function _getAdvancedFilterPropertyNames(dbPath, ctx) {
  const names = [];
  const add = (prop) => {
    if (prop && !names.includes(prop)) names.push(prop);
  };
  ((ctx?.pivotData || state.pivotData)?.properties || []).forEach(add);
  (getColOrder(dbPath, { ctx }) || []).forEach(add);
  Object.keys(getPropertyTypes(dbPath) || {}).forEach(add);
  return typeof filterDeletedDbProperties === 'function' ? filterDeletedDbProperties(dbPath, names) : names;
}

function showAdvancedFilterModal(ctxOrEvent) {
  const ctx = (ctxOrEvent && typeof ctxOrEvent === 'object' && ctxOrEvent.dbPath)
    ? ctxOrEvent
    : (typeof _dbPaneContextFromEvent === 'function'
      ? _dbPaneContextFromEvent(ctxOrEvent?.target || ctxOrEvent?.currentTarget || null, { dbPath: state.currentDbPath })
      : (typeof _currentPaneState === 'function' ? _currentPaneState() : null));
  // 互換テスト用: return showUnifiedFilterModal();
  if (typeof showUnifiedFilterModal === 'function') return showUnifiedFilterModal({ ctx });
  return _showLegacyAdvancedFilterModal(ctx);
}

function _showLegacyAdvancedFilterModal(ctx) {
  const dbPath = ctx?.dbPath || state.currentDbPath;
  const pivotData = ctx?.pivotData || state.pivotData;
  if (!dbPath || !pivotData) return;
  const allProps = _getAdvancedFilterPropertyNames(dbPath, ctx);
  const filters = getAdvancedFilters(dbPath, { ctx });

  if (!globalThis.GBUI?.createModal) throw new Error('複数条件フィルタを初期化できませんでした');
  const existing = document.querySelector('[data-e2e-id="db-advanced-filter-dialog"]');
  if (existing) { existing.focus(); return existing.closest('.gb-modal-overlay')?._dbAdvancedFilterApi || null; }
  const content = document.createElement('div');
  content.className = 'cond-modal-body';
  content.innerHTML = `
      <div id="adv-filter-list" class="cond-list"></div>
      <button type="button" id="adv-filter-add-btn" class="gb-btn gb-btn-sm cond-add-btn">+ 条件を追加</button>`;
  const clearButton = document.createElement('button');
  clearButton.type = 'button'; clearButton.id = 'adv-filter-clear-btn'; clearButton.className = 'gb-btn gb-btn-sm'; clearButton.textContent = '全クリア';
  const cancelButton = document.createElement('button');
  cancelButton.type = 'button'; cancelButton.id = 'adv-filter-cancel-btn'; cancelButton.className = 'gb-btn gb-btn-sm'; cancelButton.textContent = 'キャンセル';
  const applyButton = document.createElement('button');
  applyButton.type = 'button'; applyButton.id = 'adv-filter-apply-btn'; applyButton.className = 'gb-btn gb-btn-sm gb-btn-primary primary'; applyButton.textContent = '適用';
  let busy = false;
  const modalApi = globalThis.GBUI.createModal({
    id: 'db-advanced-filter', title: '複数条件フィルタ', body: content, footer: [clearButton, cancelButton, applyButton],
    variant: 'standard', geometryKey: 'db-advanced-filter', minWidth: '0', initialFocus: '#adv-filter-add-btn',
    returnFocus: document.activeElement instanceof HTMLElement ? document.activeElement : undefined,
    closeLabel: '複数条件フィルタを閉じる', closeOnEsc: true, closeOnOverlay: true,
    onBeforeClose: reason => reason === 'applied' || !busy,
  });
  const o = modalApi.overlay;
  o._dbAdvancedFilterApi = modalApi;
  o.dataset.e2eId = 'db-advanced-filter-overlay';
  modalApi.modal.dataset.e2eId = 'db-advanced-filter-dialog';
  modalApi.modal.classList.add('cond-modal');
  modalApi.modal.style.width = 'min(720px, calc(100vw - 24px))';
  modalApi.body.style.setProperty('overflow-x', 'hidden', 'important');
  o._dbPath = dbPath;
  o._dbCtx = ctx || null;
  const { list } = setupConditionModalLayout(o, '#adv-filter-list');
  if (list) {
    filters.forEach((f, i) => {
      list.appendChild(createAdvancedFilterRowElement(f, i, allProps, dbPath));
    });
  }
  o.querySelector('#adv-filter-add-btn')?.addEventListener('click', (e) => {
    e.preventDefault();
    addAdvFilterRow();
  });
  const run = async (clear) => {
    if (busy) return;
    busy = true;
    [clearButton, cancelButton, applyButton].forEach(button => { button.disabled = true; });
    let ok = false;
    try {
      ok = clear ? await clearAdvFilters(o, { close: false }) : await applyAdvFilters(o, { close: false });
    } catch (error) {
      console.warn('詳細フィルターの保存に失敗:', error);
      showStatus('詳細フィルターの保存に失敗しました: ' + (error?.message || error), true);
    }
    if (ok) { modalApi.close('applied'); return; }
    busy = false;
    [clearButton, cancelButton, applyButton].forEach(button => { button.disabled = false; });
    (clear ? clearButton : applyButton).focus({ preventScroll: true });
  };
  clearButton.addEventListener('click', () => run(true));
  cancelButton.addEventListener('click', () => modalApi.close('cancel'));
  applyButton.addEventListener('click', () => run(false));
  modalApi.open();
  return modalApi;
}

function styleConditionControl(el, extraCss = '') {
  if (!el) return el;
  el.style.cssText = `display:block;width:100%;min-width:0;min-height:32px;box-sizing:border-box;${extraCss}`;
  return el;
}

function setupConditionModalLayout(overlay, listSelector) {
  const modal = overlay?.querySelector('.cond-modal');
  const body = overlay?.querySelector('.cond-modal-body');
  const list = overlay?.querySelector(listSelector);
  const addBtn = overlay?.querySelector('.cond-add-btn');
  if (modal) {
    modal.style.width = 'min(720px, 80vw)';
    modal.style.height = 'min(560px, 80vh)';
  }
  if (body) {
    body.style.display = 'flex';
    body.style.flexDirection = 'column';
    body.style.gap = '8px';
    body.style.flex = '1 1 auto';
    body.style.minHeight = '0';
  }
  if (list) {
    list.style.display = 'flex';
    list.style.flexDirection = 'column';
    list.style.gap = '8px';
    list.style.flex = '1 1 auto';
    list.style.minHeight = '140px';
    list.style.minWidth = '0';
    list.style.margin = '0';
    list.style.padding = '4px';
    list.style.overflowY = 'auto';
    list.style.border = '1px solid var(--ui-border, var(--border))';
    list.style.borderRadius = '6px';
    list.style.background = 'var(--ui-bg-app, var(--bg))';
    list.style.boxSizing = 'border-box';
  }
  if (addBtn) {
    addBtn.style.marginBottom = '0';
    addBtn.style.flex = '0 0 auto';
  }
  return { modal, body, list, addBtn };
}

function closeConditionModal(listSelector) {
  document.querySelector(listSelector)?.closest('.modal-overlay')?.remove();
}

function createConditionFieldBlock(labelText, control) {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:block;margin:0 0 8px;';
  const label = document.createElement(control?.id ? 'label' : 'div');
  if (control?.id) {
    label.setAttribute('for', control.id);
    label.className = 'gb-label';
  }
  label.textContent = labelText;
  label.style.cssText = 'font-size:11px;color:var(--ui-fg-muted, var(--fg2));margin:0 0 4px;';
  wrap.appendChild(label);
  wrap.appendChild(control);
  return wrap;
}

function createAdvancedFilterRowElement(f, idx, allProps, dbPathOverride = '') {
  const dbPath = dbPathOverride || state.currentDbPath;
  const pts = getPropertyTypes(dbPath);
  const filterable = allProps.filter(p => !pts[p] || (pts[p].type !== 'button' && pts[p].type !== 'multi-source-relation' && pts[p].type !== 'chat'));
  const savedProp = f?.property || '*';
  const propOptions = ['*', ...filterable];
  if (savedProp !== '*' && !propOptions.includes(savedProp)) propOptions.push(savedProp);
  const ops = [['equals','一致'],['not_equals','不一致'],['contains','含む'],['not_contains','含まない'],['empty','空'],['not_empty','非空']];

  const row = document.createElement('div');
  row.className = 'adv-filter-row';
  row.dataset.idx = String(idx);
  row.dataset.advFilterRow = '1';
  row.style.cssText = 'display:block;width:100%;min-width:0;padding:8px;border:1px solid var(--ui-border, var(--border));border-radius:6px;background:var(--ui-bg-panel, var(--bg3));box-sizing:border-box;';

  const head = document.createElement('div');
  head.style.cssText = 'display:flex;align-items:center;justify-content:flex-end;margin:0 0 8px;';
  const delBtn = document.createElement('button');
  delBtn.type = 'button';
  delBtn.className = 'cond-del-btn';
  delBtn.textContent = '削除';
  delBtn.style.cssText = 'padding:4px 10px;min-height:32px;';
  delBtn.addEventListener('click', () => row.remove());
  head.appendChild(delBtn);
  row.appendChild(head);

  const fieldSel = document.createElement('select');
  fieldSel.className = 'af-field gb-select';
  styleConditionControl(fieldSel);
  [['value', '値'], ['status', 'ステータス']].forEach(([value, label]) => {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = label;
    if ((!f && value === 'value') || f?.field === value) opt.selected = true;
    fieldSel.appendChild(opt);
  });
  row.appendChild(createConditionFieldBlock('対象', fieldSel));

  const propSel = document.createElement('select');
  propSel.className = 'af-prop gb-select';
  styleConditionControl(propSel);
  propOptions.forEach((prop) => {
    const opt = document.createElement('option');
    opt.value = prop;
    opt.textContent = prop === '*' ? 'すべての列' : propOptions.includes(prop) && !filterable.includes(prop) ? prop + '（削除済み）' : prop;
    if (savedProp === prop) opt.selected = true;
    propSel.appendChild(opt);
  });
  if (!f) propSel.value = '*';
  row.appendChild(createConditionFieldBlock('列', propSel));

  const opSel = document.createElement('select');
  opSel.className = 'af-op gb-select';
  styleConditionControl(opSel);
  ops.forEach(([value, label]) => {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = label;
    if ((!f && value === 'equals') || f?.operator === value) opt.selected = true;
    opSel.appendChild(opt);
  });
  row.appendChild(createConditionFieldBlock('条件', opSel));

  const valInput = document.createElement('input');
  valInput.className = 'af-val';
  valInput.type = 'text';
  valInput.placeholder = '値';
  valInput.value = f?.value ?? '';
  styleConditionControl(valInput, 'font-size:12px;padding:2px 4px;');
  row.appendChild(createConditionFieldBlock('値', valInput));

  const commonTagsDatalist = document.createElement('datalist');
  commonTagsDatalist.id = 'adv-filter-common-tags-dl-' + idx + '-' + Date.now().toString(36);
  row.appendChild(commonTagsDatalist);
  const _refreshCommonTagsValueField = () => {
    const isCommonTags = propSel.value !== '*' && pts[propSel.value]?.type === 'common-tags';
    if (isCommonTags) {
      valInput.setAttribute('list', commonTagsDatalist.id);
      valInput.placeholder = 'タグ名の一部を入力';
      if (window.MeldexGlobalTags?.loadTagsCached) {
        window.MeldexGlobalTags.loadTagsCached().then(data => {
          if (!commonTagsDatalist.isConnected) return;
          commonTagsDatalist.textContent = '';
          (Array.isArray(data?.tags) ? data.tags : []).forEach(tag => {
            const opt = document.createElement('option');
            opt.value = tag.name || '';
            commonTagsDatalist.appendChild(opt);
          });
        }).catch(() => {});
      }
    } else {
      valInput.removeAttribute('list');
      valInput.placeholder = '値';
    }
  };
  propSel.addEventListener('change', _refreshCommonTagsValueField);
  _refreshCommonTagsValueField();

  return row;
}

function addAdvFilterRow() {
  const list = document.getElementById('adv-filter-list');
  const overlay = list?.closest?.('.modal-overlay');
  const dbPath = overlay?._dbPath || state.currentDbPath;
  const ctx = overlay?._dbCtx || null;
  const allProps = _getAdvancedFilterPropertyNames(dbPath, ctx);
  if (!list) return;
  list.appendChild(createAdvancedFilterRowElement(null, list.children.length, allProps, dbPath));
}

// 互換テスト用: async function _refreshAdvancedFilterResults(dbPath)
async function _refreshAdvancedFilterResults(dbPath, ctx) {
  // 互換テスト用: if (typeof _updateFilterBadge === 'function') _updateFilterBadge();
  if (typeof _updateFilterBadge === 'function') _updateFilterBadge({ dbPath, ctx });
  if (!dbPath) return;
  // 互換テスト用: const mode = getCurrentViewMode(dbPath);
  const mode = getCurrentViewMode(dbPath, { ctx });
  if (mode === 'pivot') {
    renderPivot(ctx);
  } else if (typeof selectDatabase === 'function') {
    await selectDatabase(dbPath, ctx, { silent: true });
  }
}

async function applyAdvFilters(rootOverlay = null, options = {}) {
  const overlay = rootOverlay || document.querySelector('#adv-filter-list')?.closest?.('.modal-overlay');
  const dbPath = overlay?._dbPath || state.currentDbPath;
  const ctx = overlay?._dbCtx || null;
  const rows = overlay?.querySelectorAll('#adv-filter-list [data-adv-filter-row]') || document.querySelectorAll('#adv-filter-list [data-adv-filter-row]');
  const filters = [];
  rows.forEach(row => {
    const field = row.querySelector('.af-field').value;
    const prop = row.querySelector('.af-prop').value;
    const op = row.querySelector('.af-op').value;
    let val = row.querySelector('.af-val').value;
    if (dbPath && window.MeldexGlobalTags?.resolveCommonTagsFilterValueSync) {
      val = window.MeldexGlobalTags.resolveCommonTagsFilterValueSync(dbPath, prop, val);
    }
    filters.push({ field, property: prop, operator: op, value: val });
  });
  const before = getAdvancedFilters(dbPath, { ctx });
  const beforeHistory = typeof captureDbViewConfigHistory === 'function' ? captureDbViewConfigHistory(dbPath) : null;
  try {
    setAdvancedFilters(dbPath, filters, { ctx, skipHistory: true });
    await _refreshAdvancedFilterResults(dbPath, ctx);
  } catch (error) {
    setAdvancedFilters(dbPath, before, { ctx, skipHistory: true });
    try { await _refreshAdvancedFilterResults(dbPath, ctx); } catch (restoreError) {
      console.warn('フィルタ適用失敗後の表示復元に失敗:', restoreError);
    }
    showStatus('フィルタの適用に失敗しました: ' + (error?.message || error), true);
    return false;
  }
  if (beforeHistory && typeof captureDbViewConfigHistory === 'function' && typeof pushDbViewConfigHistory === 'function') {
    pushDbViewConfigHistory(dbPath, 'シート表示: 複数条件フィルタ', beforeHistory, captureDbViewConfigHistory(dbPath));
  }
  if (options.close !== false) closeConditionModal('#adv-filter-list');
  return true;
}

async function clearAdvFilters(rootOverlay = null, options = {}) {
  const overlay = rootOverlay || document.querySelector('#adv-filter-list')?.closest?.('.modal-overlay');
  const dbPath = overlay?._dbPath || state.currentDbPath;
  const ctx = overlay?._dbCtx || null;
  const before = getAdvancedFilters(dbPath, { ctx });
  const beforeHistory = typeof captureDbViewConfigHistory === 'function' ? captureDbViewConfigHistory(dbPath) : null;
  try {
    setAdvancedFilters(dbPath, [], { ctx, skipHistory: true });
    await _refreshAdvancedFilterResults(dbPath, ctx);
  } catch (error) {
    setAdvancedFilters(dbPath, before, { ctx, skipHistory: true });
    try { await _refreshAdvancedFilterResults(dbPath, ctx); } catch (restoreError) {
      console.warn('フィルタ全クリア失敗後の表示復元に失敗:', restoreError);
    }
    showStatus('フィルタの全クリアに失敗しました: ' + (error?.message || error), true);
    return false;
  }
  if (beforeHistory && typeof captureDbViewConfigHistory === 'function' && typeof pushDbViewConfigHistory === 'function') {
    pushDbViewConfigHistory(dbPath, 'シート表示: 複数条件フィルタ', beforeHistory, captureDbViewConfigHistory(dbPath));
  }
  if (options.close !== false) closeConditionModal('#adv-filter-list');
  return true;
}
