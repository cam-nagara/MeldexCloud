/* gb-db-filter-dialog.js — ツールバーの統合フィルタダイアログ（ステータス/条件/列の値フィルター）。
   gb-db-table.js（part01）から抽出。シート表示・ビュー状態計画 2026-08-04 で実装。

   - ステータスフィルタ・条件フィルタ・列の値フィルターは同じ保存ビュー状態として扱い、
     setDbFilterState() で一度の保存操作にまとめる（Undo/Redo も1操作になる）。
   - 列の値フィルター（列ヘッダー側の gb-db-column-filter.js が主導する状態）もこのダイアログで
     一覧・編集・解除できるようにし、列ヘッダー側とは同じ保存先を読み書きすることで同期する。
   - ダイアログ内の DOM 検索・閉じる操作は対象ダイアログ（.gb-unified-filter-overlay）へ限定する。
   - 複数ペインやイベント引数なしのツールバー起動でも、現在のシート/ビューを解決できるよう
     ctx 解決を一箇所（_ufResolveContext）にまとめる。

   このファイルの関数はプロジェクト全体の慣習どおりグローバル関数として宣言する（IIFEで閉じない）。 */

// イベント引数なし起動（ツールバーの data-action="showUnifiedFilterModal()"）や
// 複数ペイン環境でも、対象シート/ビューを確実に解決する。
function _ufResolveContext(options = {}) {
  const ctx = options.ctx
    || (typeof _dbPaneContextFromEvent === 'function' ? _dbPaneContextFromEvent(options.event, { dbPath: state.currentDbPath }) : null)
    || (typeof _currentPaneState === 'function' ? _currentPaneState() : null);
  const dbPath = ctx?.dbPath || state.currentDbPath;
  return { ctx, dbPath };
}

function _ufCloseOverlay(overlay, reason = 'programmatic') {
  if (!overlay) return false;
  if (overlay._ufModalApi?.close) return overlay._ufModalApi.close(reason);
  overlay.remove();
  return true;
}

function showUnifiedFilterModal() {
  // スマートシート表示中は state.currentDbPath が null なので、
  // ここで通常シート用ダイアログを開くと保存先が無く条件が消える。
  // スマートシート専用のフィルタ設定ダイアログにルーティングする。
  if (state.currentSmartDb && typeof showSmartDbFilterModal === 'function') {
    showSmartDbFilterModal(state.currentSmartDb.id);
    return;
  }
  const options = arguments[0] || {};
  const { ctx } = _ufResolveContext(options);
  const smartDb = ctx?.smartDb || state.currentSmartDb;
  if (smartDb && typeof showSmartDbFilterModal === 'function') {
    showSmartDbFilterModal(smartDb.id);
    return;
  }
  const dbPath = ctx?.dbPath || state.currentDbPath;
  const filterMode = ctx?.filter ?? state.filter ?? 'disabled';
  const advFilters = dbPath ? getAdvancedFilters(dbPath, { ctx }) : [];
  document.querySelectorAll('.gb-unified-filter-overlay').forEach(el => _ufCloseOverlay(el, 'replace'));
  const returnFocus = document.activeElement instanceof HTMLElement && document.activeElement !== document.body
    ? document.activeElement
    : null;
  const body = document.createElement('div');
  body.className = 'uf-modal-body';
  body.innerHTML = `
    <div style="margin-bottom:12px;">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
        <label style="font-size:12px;color:var(--fg2);display:flex;align-items:center;gap:4px;cursor:pointer;">
          <input type="checkbox" id="uf-status-enabled" ${filterMode !== 'disabled' ? 'checked' : ''}>
          採用状況フィルタ
        </label>
      </div>
      <div id="uf-status-btns" style="display:${filterMode !== 'disabled' ? 'flex' : 'none'};gap:6px;">
        <button type="button" id="uf-all" class="gb-btn gb-btn-sm ${!filterMode || filterMode==='all' || filterMode==='disabled'?'primary':''}" data-action="document.querySelectorAll('#uf-all,#uf-adopted,#uf-nobotsu').forEach(b=>b.classList.remove('primary'));this.classList.add('primary');">全表示</button>
        <button type="button" id="uf-adopted" class="gb-btn gb-btn-sm ${filterMode==='adopted'?'primary':''}" data-action="document.querySelectorAll('#uf-all,#uf-adopted,#uf-nobotsu').forEach(b=>b.classList.remove('primary'));this.classList.add('primary');">採用+掲載済みのみ</button>
        <button type="button" id="uf-nobotsu" class="gb-btn gb-btn-sm ${filterMode==='nobotsu'?'primary':''}" data-action="document.querySelectorAll('#uf-all,#uf-adopted,#uf-nobotsu').forEach(b=>b.classList.remove('primary'));this.classList.add('primary');">ボツ非表示</button>
      </div>
    </div>
    <div style="margin-bottom:12px;">
      <div style="font-size:12px;color:var(--fg2);margin-bottom:4px;">条件フィルタ</div>
      <div id="uf-conditions"></div>
      <button type="button" class="gb-btn gb-btn-sm uf-add-condition" data-action="_ufAddCondition()" style="font-size:11px;margin-top:4px;">+ 条件を追加</button>
    </div>
    <div style="margin-bottom:12px;">
      <div style="font-size:12px;color:var(--fg2);margin-bottom:4px;">列の値フィルター</div>
      <div id="uf-col-filters"></div>
      <div class="uf-column-filter-add" style="display:flex;gap:4px;margin-top:6px;">
        <select id="uf-col-filter-add-select" class="gb-select gb-select-sm" style="flex:1;"></select>
        <button type="button" class="gb-btn gb-btn-sm uf-open-column-filter" data-action="_ufOpenColumnValueFilterFromDialog()" style="font-size:11px;">値を選択...</button>
      </div>
    </div>`;
  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'gb-btn gb-btn-sm';
  cancelBtn.dataset.e2eId = 'unified-filter-cancel';
  cancelBtn.textContent = 'キャンセル';
  const clearBtn = document.createElement('button');
  clearBtn.type = 'button';
  clearBtn.className = 'gb-btn gb-btn-sm';
  clearBtn.dataset.e2eId = 'unified-filter-clear';
  clearBtn.style.color = 'var(--red)';
  clearBtn.textContent = '全解除';
  const applyBtn = document.createElement('button');
  applyBtn.type = 'button';
  applyBtn.className = 'gb-btn gb-btn-sm gb-btn-primary primary';
  applyBtn.dataset.e2eId = 'unified-filter-apply';
  applyBtn.textContent = '適用';
  const modalApi = window.GBUI.createModal({
    id: 'unified-filter-dialog',
    title: 'フィルタ',
    body,
    footer: [cancelBtn, clearBtn, applyBtn],
    variant: 'standard',
    extraClass: 'uf-modal',
    geometryKey: 'unified-filter',
    initialFocus: '#uf-status-enabled',
    returnFocus: returnFocus || undefined,
  });
  const o = modalApi.overlay;
  o.classList.add('modal-overlay', 'gb-unified-filter-overlay');
  o.dataset.ufDbPath = dbPath || '';
  o._ufCtx = ctx || null;
  o._ufModalApi = modalApi;
  modalApi.modal.style.minWidth = 'min(500px, calc(100vw - 24px))';
  const headerClose = modalApi.header.querySelector('.gb-modal-close');
  if (headerClose) headerClose.dataset.e2eId = 'unified-filter-close-icon';
  cancelBtn.addEventListener('click', () => modalApi.close('cancel'));
  clearBtn.addEventListener('click', _ufClear);
  applyBtn.addEventListener('click', _ufApply);
  modalApi.open();
  // 採用状況フィルタのチェックボックス制御
  const sfCb = o.querySelector('#uf-status-enabled');
  const sfBtns = o.querySelector('#uf-status-btns');
  if (sfCb && sfBtns) {
    sfCb.addEventListener('change', () => { sfBtns.style.display = sfCb.checked ? 'flex' : 'none'; });
  }
  // 既存条件を復元
  const condDiv = o.querySelector('#uf-conditions');
  if (advFilters.length) {
    advFilters.forEach(f => condDiv.insertAdjacentHTML('beforeend', _ufConditionRow(f, dbPath, ctx)));
    condDiv.querySelectorAll('.uf-cond').forEach(row => _ufPopulateCommonTagsDatalist(row));
  }
  const initialProperty = String(options.initialProperty || '');
  if (initialProperty && !advFilters.some(filter => filter?.property === initialProperty)) {
    condDiv.insertAdjacentHTML('beforeend', _ufConditionRow({ property: initialProperty, field: 'value', operator: 'equals', value: '' }, dbPath, ctx));
  }
  // 列を切り替えたときに共通タグ列向けの候補(datalist)を切り替える
  condDiv?.addEventListener('change', (e) => {
    const propSelect = e.target?.closest?.('[data-field="property"]');
    if (propSelect) _ufRefreshConditionRowForPropertyChange(propSelect);
  });
  // 列の値フィルター一覧 + 追加用セレクト
  _ufRenderColumnFilterList(o.querySelector('#uf-col-filters'), dbPath, ctx);
  _ufPopulateColumnFilterAddSelect(o.querySelector('#uf-col-filter-add-select'), dbPath, ctx);
}

function _getUnifiedFilterProperties(dbPath, ctx) {
  const props = [];
  const add = (prop) => {
    if (prop && !props.includes(prop)) props.push(prop);
  };
  const data = (ctx?.dbPath === dbPath ? ctx.pivotData : null) || (state.currentDbPath === dbPath ? state.pivotData : null) || ctx?.pivotData || state.pivotData;
  (data?.properties || []).forEach(add);
  (getColOrder(dbPath, { ctx }) || []).forEach(add);
  Object.keys(getPropertyTypes(dbPath) || {}).forEach(add);
  return typeof filterDeletedDbProperties === 'function' ? filterDeletedDbProperties(dbPath, props) : props;
}

let _ufConditionRowSeq = 0;
function _ufConditionRow(f, dbPath, ctx) {
  const selectedProp = f?.property || '*';
  const props = _getUnifiedFilterProperties(dbPath || state.currentDbPath, ctx);
  if (selectedProp !== '*' && !props.includes(selectedProp)) props.push(selectedProp);
  const propOpts = props.map(p => `<option value="${esc(p)}" ${selectedProp===p?'selected':''}>${esc(p)}</option>`).join('');
  const rowSeq = ++_ufConditionRowSeq;
  const datalistId = 'uf-common-tags-dl-' + rowSeq;
  const resolvedDbPath = dbPath || state.currentDbPath;
  const isCommonTags = selectedProp !== '*' && getPropertyTypes(resolvedDbPath)?.[selectedProp]?.type === 'common-tags';
  const valueListAttr = isCommonTags ? ` list="${datalistId}" placeholder="タグ名の一部を入力"` : '';
  return `<div class="uf-cond" data-uf-common-tags-datalist-id="${datalistId}" style="display:flex;gap:4px;margin-bottom:4px;align-items:center;font-size:12px;">
    <select data-field="field" class="gb-select gb-select-sm"><option value="value" ${f?.field==='value'?'selected':''}>値</option><option value="status" ${f?.field==='status'?'selected':''}>ステータス</option></select>
    <select data-field="property" class="gb-select gb-select-sm" style="flex:1;"><option value="*" ${selectedProp==='*'?'selected':''}>すべての列</option>${propOpts}</select>
    <select data-field="operator" class="gb-select gb-select-sm">
      <option value="contains" ${f?.operator==='contains'?'selected':''}>含む</option>
      <option value="not_contains" ${f?.operator==='not_contains'?'selected':''}>含まない</option>
      <option value="equals" ${f?.operator==='equals'?'selected':''}>一致</option>
      <option value="not_equals" ${f?.operator==='not_equals'?'selected':''}>不一致</option>
      <option value="empty" ${f?.operator==='empty'?'selected':''}>空</option>
      <option value="not_empty" ${f?.operator==='not_empty'?'selected':''}>空でない</option>
    </select>
    <input type="text" data-field="value" class="gb-input gb-input-sm" value="${esc(f?.value ?? '')}" style="padding:2px;width:80px;"${valueListAttr}>
    <datalist id="${datalistId}"></datalist>
    <button type="button" class="gb-btn gb-btn-sm gb-btn-icon uf-remove-condition" aria-label="条件を削除" data-action="this.parentElement.remove()" style="color:var(--red);background:none;border:none;cursor:pointer;display:flex;align-items:center;">${lucide('x', 14)}</button>
  </div>`;
}
// 共通タグ列を対象にした条件行のみ、タグカタログからタグ名の候補を <datalist> に流し込む
// （値そのものはタグID保存のままだが、名前を入力すればID部分一致でヒットするよう候補として名前を提示する）
function _ufPopulateCommonTagsDatalist(rowEl) {
  const datalistId = rowEl?.dataset?.ufCommonTagsDatalistId;
  const datalist = datalistId ? document.getElementById(datalistId) : null;
  if (!datalist || !window.MeldexGlobalTags?.loadTagsCached) return;
  window.MeldexGlobalTags.loadTagsCached().then(data => {
    if (!datalist.isConnected) return;
    datalist.textContent = '';
    (Array.isArray(data?.tags) ? data.tags : []).forEach(tag => {
      const opt = document.createElement('option');
      opt.value = tag.name || '';
      datalist.appendChild(opt);
    });
  }).catch(() => {});
}
function _ufRefreshConditionRowForPropertyChange(propSelect) {
  const row = propSelect?.closest?.('.uf-cond');
  const overlay = propSelect?.closest?.('.gb-unified-filter-overlay');
  if (!row || !overlay) return;
  const dbPath = overlay.dataset.ufDbPath || overlay._ufCtx?.dbPath || state.currentDbPath;
  const propName = propSelect.value;
  const isCommonTags = propName !== '*' && getPropertyTypes(dbPath)?.[propName]?.type === 'common-tags';
  const valueInput = row.querySelector('[data-field="value"]');
  const datalistId = row.dataset.ufCommonTagsDatalistId;
  if (valueInput && datalistId) {
    if (isCommonTags) {
      valueInput.setAttribute('list', datalistId);
      valueInput.placeholder = 'タグ名の一部を入力';
      _ufPopulateCommonTagsDatalist(row);
    } else {
      valueInput.removeAttribute('list');
      valueInput.placeholder = '';
    }
  }
}
function _ufAddCondition() {
  const overlay = document.querySelector('.gb-unified-filter-overlay');
  const html = _ufConditionRow({}, overlay?.dataset.ufDbPath || state.currentDbPath, overlay?._ufCtx || null);
  const conditionsHost = overlay?.querySelector('#uf-conditions');
  if (!conditionsHost) return;
  conditionsHost.insertAdjacentHTML('beforeend', html);
  _ufPopulateCommonTagsDatalist(conditionsHost.lastElementChild);
}

// 列の値フィルター一覧（このダイアログでの表示・編集・解除）
function _ufColumnFilterSummaryEntries(dbPath, ctx) {
  const filters = typeof getColumnValueFilters === 'function' ? getColumnValueFilters(dbPath, { ctx }) : {};
  return Object.entries(filters || {}).filter(([, entry]) => Array.isArray(entry?.selected));
}
function _ufColumnFilterLabel(propName) {
  return propName === '__entity__' ? 'エントリ名' : propName;
}
function _ufRenderColumnFilterList(container, dbPath, ctx) {
  if (!container) return;
  container.innerHTML = '';
  const entries = _ufColumnFilterSummaryEntries(dbPath, ctx);
  if (!entries.length) {
    const empty = document.createElement('div');
    empty.className = 'uf-col-filter-empty';
    empty.textContent = '列の値フィルターはまだありません';
    container.appendChild(empty);
    return;
  }
  entries.forEach(([propName, entry]) => {
    const row = document.createElement('div');
    row.className = 'uf-col-filter-row';
    row.dataset.ufColFilterProp = propName;
    const name = document.createElement('span');
    name.className = 'uf-col-filter-name';
    name.title = _ufColumnFilterLabel(propName);
    name.textContent = `${_ufColumnFilterLabel(propName)}: ${entry.selected.length}件選択中`;
    row.appendChild(name);
    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.textContent = '編集';
    editBtn.dataset.e2eId = 'uf-col-filter-edit';
    editBtn.addEventListener('click', () => _ufEditColumnFilter(dbPath, propName, ctx, editBtn));
    row.appendChild(editBtn);
    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.textContent = '解除';
    clearBtn.dataset.e2eId = 'uf-col-filter-clear';
    clearBtn.style.color = 'var(--red)';
    clearBtn.addEventListener('click', () => {
      if (typeof clearDbColumnValueFilter === 'function') clearDbColumnValueFilter(dbPath, propName, ctx);
      _ufRenderColumnFilterList(container, dbPath, ctx);
    });
    row.appendChild(clearBtn);
    container.appendChild(row);
  });
}
function _ufPopulateColumnFilterAddSelect(select, dbPath, ctx) {
  if (!select) return;
  select.innerHTML = '';
  const props = ['__entity__', ..._getUnifiedFilterProperties(dbPath, ctx)];
  props.forEach(propName => {
    const opt = document.createElement('option');
    opt.value = propName;
    opt.textContent = _ufColumnFilterLabel(propName);
    select.appendChild(opt);
  });
}
// 対象ダイアログを閉じてから列ヘッダーと同じ値選択ポップアップを開く（列ヘッダー側と同じ
// showDbColumnFilterPopup を共有するため、選択状態はここで編集してもヘッダー側にそのまま反映される）。
function _ufEditColumnFilter(dbPath, propName, ctx, sourceBtn) {
  const rect = typeof sourceBtn?.getBoundingClientRect === 'function' ? sourceBtn.getBoundingClientRect() : null;
  document.querySelectorAll('.gb-unified-filter-overlay').forEach(el => _ufCloseOverlay(el, 'open-column-filter'));
  if (typeof showDbColumnFilterPopup !== 'function') return;
  const fakeSource = rect ? { currentTarget: { getBoundingClientRect: () => rect } } : {};
  showDbColumnFilterPopup(fakeSource, propName, ctx, dbPath);
}
function _ufOpenColumnValueFilterFromDialog() {
  const overlay = document.querySelector('.gb-unified-filter-overlay');
  const select = overlay?.querySelector('#uf-col-filter-add-select');
  const propName = select?.value;
  if (!propName) return;
  const dbPath = overlay.dataset.ufDbPath || state.currentDbPath;
  const ctx = overlay._ufCtx || null;
  _ufEditColumnFilter(dbPath, propName, ctx, select);
}

function _ufApply() {
  const overlay = document.querySelector('.gb-unified-filter-overlay');
  const ctx = overlay?._ufCtx || null;
  const dbPath = overlay?.dataset.ufDbPath || ctx?.dbPath || state.currentDbPath;
  const previousFilterMode = ctx?.filter ?? state.filter ?? 'disabled';
  // ステータスフィルタ
  const sfEnabled = overlay?.querySelector('#uf-status-enabled')?.checked;
  let nextFilter = 'all';
  if (!sfEnabled) nextFilter = 'disabled';
  else if (overlay?.querySelector('#uf-adopted')?.classList.contains('primary')) nextFilter = 'adopted';
  else if (overlay?.querySelector('#uf-nobotsu')?.classList.contains('primary')) nextFilter = 'nobotsu';
  // 条件フィルタ
  const filters = [];
  overlay?.querySelectorAll('.uf-cond').forEach(row => {
    const propName = row.querySelector('[data-field="property"]').value;
    let rawValue = row.querySelector('[data-field="value"]').value;
    if (dbPath && window.MeldexGlobalTags?.resolveCommonTagsFilterValueSync) {
      rawValue = window.MeldexGlobalTags.resolveCommonTagsFilterValueSync(dbPath, propName, rawValue);
    }
    filters.push({
      field: row.querySelector('[data-field="field"]').value,
      property: propName,
      operator: row.querySelector('[data-field="operator"]').value,
      value: rawValue,
    });
  });
  // ステータス/条件フィルタ/列の値フィルターは同じ保存ビュー状態として一度の保存操作で
  // 原子的に永続化する（列の値フィルターはこのダイアログでは変更しないため現状値をそのまま渡す）。
  if (dbPath) {
    const columnValueFilters = typeof getColumnValueFilters === 'function' ? getColumnValueFilters(dbPath, { ctx }) : {};
    if (typeof setDbFilterState === 'function') {
      setDbFilterState(dbPath, { filter: nextFilter, advancedFilters: filters, columnValueFilters }, { ctx, label: 'シート表示: フィルタ' });
    } else {
      setFilter(nextFilter, { skipReload: true, dbPath, ctx });
      setAdvancedFilters(dbPath, filters, { ctx });
    }
  }
  _ufCloseOverlay(overlay, 'apply');
  _updateFilterBadge({ dbPath, filter: ctx?.filter ?? nextFilter, ctx });
  if (dbPath) _ufRefreshTarget(ctx, dbPath, { statusFilterChanged: nextFilter !== previousFilterMode });
}
function _ufClear() {
  const overlay = document.querySelector('.gb-unified-filter-overlay');
  const ctx = overlay?._ufCtx || null;
  const dbPath = overlay?.dataset.ufDbPath || ctx?.dbPath || state.currentDbPath;
  const previousFilterMode = ctx?.filter ?? state.filter ?? 'disabled';
  if (dbPath) {
    if (typeof setDbFilterState === 'function') {
      setDbFilterState(dbPath, { filter: 'disabled', advancedFilters: [], columnValueFilters: {} }, { ctx, label: 'シート表示: フィルタを全解除' });
    } else {
      setFilter('disabled', { skipReload: true, dbPath, ctx });
      setAdvancedFilters(dbPath, [], { ctx });
      if (typeof setColumnValueFilters === 'function') setColumnValueFilters(dbPath, {}, { ctx });
    }
  }
  _ufCloseOverlay(overlay, 'clear');
  _updateFilterBadge({ dbPath, filter: 'disabled', ctx });
  if (dbPath) _ufRefreshTarget(ctx, dbPath, { statusFilterChanged: previousFilterMode !== 'disabled' });
}

// 保存直後の不要な全再読込を避ける: ステータスフィルタ（サーバー側の status_filter クエリ）が
// 実際に変わった時だけバックエンド再読込（selectDatabase）を行う。条件/列の値フィルターだけの
// 変更はローカル状態のみで再描画する（フィルタ判定はクライアント側で完結するため）。
function _ufRefreshTarget(ctx, dbPath, options = {}) {
  if (options.statusFilterChanged !== true) {
    if (typeof _updateFilterBadge === 'function') _updateFilterBadge({ dbPath, ctx });
    if (typeof _renderCurrentDbView === 'function') _renderCurrentDbView(ctx, dbPath);
    else if (typeof renderPivot === 'function') renderPivot(ctx);
    return;
  }
  // 埋め込みシートは通常ペインのレジストリに登録されない。selectDatabase() を直接
  // 呼ぶとグローバルの現在シートを一時的に上書きしてしまうため、埋め込みを所有する
  // ホストコントローラー（gb-tool-calendar-production-sheet-embed.js の instance）が
  // あればその open() 経由で再読込する。status_filter はサーバー側で適用されるため、
  // renderPivot() だけのローカル再描画では反映されない（併発バグの修正）。
  if (ctx?.embedded && ctx.hostController?.open) {
    ctx.hostController.open(dbPath, { forceReload: true, silent: true });
    return;
  }
  if (ctx?.embedded && typeof renderPivot === 'function') {
    renderPivot(ctx);
    return;
  }
  selectDatabase(dbPath, ctx);
}
