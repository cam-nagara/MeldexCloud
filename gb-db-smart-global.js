/* スマートシート「全件インデックス」種別 — Meldex 全ファイルを対象にしたリスト */

(function() {
  'use strict';

  const CATEGORIES = ['image','audio','video','scriptnote','page','board','database','smart-db','calendar','csv','pdf','archive','text','data','entity','chat','other'];
  const ROOT_TYPES = ['vault','home'];

  window.ALL_FILES_COLUMNS = {
    category:                 { label: '種別',       ops: ['equals','not_equals'], values: CATEGORIES },
    root_name:                { label: 'ソースフォルダ', ops: ['equals','not_equals'], values: 'dynamic' },
    root_type:                { label: 'ルート種別', ops: ['equals','not_equals'], values: ROOT_TYPES },
    ext:                      { label: '拡張子',     ops: ['equals','not_equals','contains','not_contains'] },
    name:                     { label: 'ファイル名', ops: ['contains','not_contains','equals'] },
    path:                     { label: '実態パス',   ops: ['contains','not_contains'] },
    backlink_file_count:      { label: '被リンク数(ファイル)', ops: ['equals','greater_than','less_than','is_null','not_null'] },
    backlink_board_count:     { label: '被リンク数(ボード)',   ops: ['equals','greater_than','less_than'] },
    backlink_scriptnote_count:{ label: '被リンク数(シナリオ)', ops: ['equals','greater_than','less_than'] },
    backlink_page_count:      { label: '被リンク数(ページ)',   ops: ['equals','greater_than','less_than'] },
    size:                     { label: 'ファイルサイズ', ops: ['greater_than','less_than','equals'] },
    modified:                 { label: '更新日時',   ops: ['after','before'] }
  };

  const DEFAULT_COLUMNS = ['name','category','root_name','path','size','modified','backlink_file_count','backlink_board_count'];

  function _globalIndexActiveElement() {
    if (typeof _smartDbActiveElement === 'function') return _smartDbActiveElement();
    return document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }

  function _globalIndexRestoreFocus(target) {
    if (typeof _smartDbRestoreFocus === 'function') return _smartDbRestoreFocus(target);
    if (!target || typeof target.focus !== 'function' || !target.isConnected) return;
    try { target.focus({ preventScroll: true }); } catch { target.focus(); }
  }

  function _globalIndexActivationKey(e) {
    if (typeof _smartDbActivationKey === 'function') return _smartDbActivationKey(e);
    return e && !e.isComposing && e.keyCode !== 229 && (e.key === 'Enter' || e.key === ' ');
  }

  function _globalIndexBindKeyboardActivate(el, handler) {
    if (!el || typeof handler !== 'function') return;
    el.addEventListener('keydown', (e) => {
      if (!_globalIndexActivationKey(e)) return;
      e.preventDefault();
      e.stopPropagation();
      handler(e);
    });
  }

  function _globalIndexAttachOverlayDismiss(overlay, restoreTarget) {
    if (typeof _smartDbAttachOverlayDismiss === 'function') return _smartDbAttachOverlayDismiss(overlay, restoreTarget);
    if (!overlay) return () => {};
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      overlay.remove();
      _globalIndexRestoreFocus(restoreTarget);
      setTimeout(() => _globalIndexRestoreFocus(restoreTarget), 0);
    };
    overlay.addEventListener('pointerdown', (ev) => {
      if (ev.target === overlay) close();
    });
    overlay.addEventListener('keydown', (ev) => {
      if (ev.key !== 'Escape') return;
      ev.preventDefault();
      ev.stopPropagation();
      close();
    });
    return close;
  }

  function _globalIndexFocusFirstDialogControl(overlay) {
    if (typeof _smartDbFocusFirstDialogControl === 'function') return _smartDbFocusFirstDialogControl(overlay);
    setTimeout(() => {
      const first = overlay?.querySelector?.('input, select, textarea, button, [role="button"], [tabindex]:not([tabindex="-1"])');
      _globalIndexRestoreFocus(first);
    }, 0);
  }

  function _isAllFilesDef(def) {
    return def && def.sourceType === 'all-files';
  }
  window.isAllFilesSmartDb = _isAllFilesDef;

  function createGlobalIndexSmartDb() {
    const dbs = (typeof getSavedSmartDbs === 'function') ? getSavedSmartDbs() : [];
    let idx = 1, name = '全件インデックス';
    const names = dbs.map(d => d.name);
    while (names.includes(name)) { idx++; name = '全件インデックス' + idx; }
    const id = 'smart-db-' + Date.now();
    const newDb = {
      id, name,
      type: 'smart-db',
      sourceType: 'all-files',
      filters: [],
      sortBy: 'modified',
      sortDir: 'desc',
      columns: DEFAULT_COLUMNS.slice(),
      created: new Date().toISOString(),
    };
    if (typeof normalizeSmartDbDefinition === 'function') normalizeSmartDbDefinition(newDb);
    dbs.push(newDb);
    if (typeof setSavedSmartDbs === 'function') setSavedSmartDbs(dbs);
    if (typeof pushSmartDbDefinitionHistory === 'function') {
      pushSmartDbDefinitionHistory('スマートシート: 作成', null, newDb, newDb.name);
    }
    if (typeof renderSmartDbList === 'function') renderSmartDbList();
    if (typeof selectSmartDb === 'function') selectSmartDb(id);
  }
  window.createGlobalIndexSmartDb = createGlobalIndexSmartDb;

  async function loadGlobalIndexData(def, opts) {
    const forceRefresh = !!(opts && opts.refresh);
    const url = '/global-index' + (forceRefresh ? '?refresh=1' : '');
    try {
      const data = await apiFetch(url);
      return data;
    } catch (e) {
      console.error('[global-index] load failed', e);
      throw e;
    }
  }
  window.loadGlobalIndexData = loadGlobalIndexData;

  function _matchFilter(f, file) {
    const col = f.column;
    if (!col) return true;
    const raw = file[col];
    const op = f.operator || 'equals';
    const v = f.value;
    if (op === 'is_null') return raw === null || raw === undefined;
    if (op === 'not_null') return !(raw === null || raw === undefined);
    if (raw === null || raw === undefined) return op === 'not_equals' || op === 'not_contains';
    const s = String(raw).toLowerCase();
    const vs = String(v == null ? '' : v).toLowerCase();
    switch (op) {
      case 'equals':        return s === vs;
      case 'not_equals':    return s !== vs;
      case 'contains':      return s.includes(vs);
      case 'not_contains':  return !s.includes(vs);
      case 'greater_than':  return Number(raw) > Number(v);
      case 'less_than':     return Number(raw) < Number(v);
      case 'after':         return String(raw) > String(v);
      case 'before':        return String(raw) < String(v);
      default: return true;
    }
  }

  function applyGlobalIndexFilters(files, filters) {
    if (!filters || !filters.length) return files.slice();
    return files.filter(f => filters.every(flt => _matchFilter(flt, f)));
  }
  window.applyGlobalIndexFilters = applyGlobalIndexFilters;

  function applyGlobalIndexSort(files, sortBy, sortDir) {
    if (!sortBy) return files;
    const dir = sortDir === 'asc' ? 1 : -1;
    const out = files.slice();
    out.sort((a, b) => {
      const av = a[sortBy], bv = b[sortBy];
      const an = av == null, bn = bv == null;
      if (an && bn) return 0;
      if (an) return 1;
      if (bn) return -1;
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
      return String(av).localeCompare(String(bv)) * dir;
    });
    return out;
  }
  window.applyGlobalIndexSort = applyGlobalIndexSort;

  function _fmtSize(n) {
    if (n == null) return '';
    if (n < 1024) return n + 'B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + 'KB';
    if (n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + 'MB';
    return (n / 1024 / 1024 / 1024).toFixed(2) + 'GB';
  }

  function _globalIndexStableControlId(prefix, file, rowIndex) {
    const raw = String(file?.abs_path || file?.path || file?.name || rowIndex || 'row');
    let hash = 0;
    for (let i = 0; i < raw.length; i += 1) {
      hash = ((hash << 5) - hash + raw.charCodeAt(i)) | 0;
    }
    const slug = raw
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'file';
    return `${prefix}-${Number.isFinite(rowIndex) ? rowIndex : 0}-${slug}-${Math.abs(hash).toString(36)}`;
  }

  function _openFileByCategory(file) {
    const openPath = file.abs_path || file.path;
    const label = file.name || (String(openPath || '').split('/').pop());
    switch (file.category) {
      case 'scriptnote':
        if (typeof openScenarioInScriptNote === 'function') return openScenarioInScriptNote(openPath, label);
        break;
      case 'board':
        if (typeof openBoard === 'function') return openBoard(label, openPath);
        break;
      case 'page':
      case 'entity':
        if (typeof openPage === 'function') return openPage(label, openPath);
        break;
      case 'database':
        if (typeof selectDatabase === 'function') return selectDatabase(openPath);
        break;
      case 'smart-db':
        if (typeof openSmartDbFile === 'function') return openSmartDbFile(label, openPath);
        break;
      case 'image':
      case 'audio':
      case 'video':
      case 'pdf':
        if (typeof openMedia === 'function') return openMedia(label, openPath, file.category);
        break;
      case 'csv':
        if (typeof openCsvFile === 'function') return openCsvFile(label, openPath);
        break;
    }
    // フォールバック: ページとして開く
    if (typeof openPage === 'function') openPage(label, openPath);
  }

  function renderGlobalIndexTable(def) {
    const table = document.querySelector('#smart-db-table');
    const thead = document.querySelector('#smart-db-table thead');
    const tbody = document.querySelector('#smart-db-table tbody');
    if (!thead || !tbody) return;
    if (typeof disposeSmartDbVirtualRows === 'function') disposeSmartDbVirtualRows(table);
    thead.innerHTML = ''; tbody.innerHTML = '';

    const data = state.smartDbData || { files: [] };
    let files = Array.isArray(data.files) ? data.files.slice() : [];
    files = applyGlobalIndexFilters(files, def.filters || []);
    files = applyGlobalIndexSort(files, def.sortBy || 'modified', def.sortDir || 'desc');

    const columns = Array.isArray(def.columns) && def.columns.length ? def.columns : DEFAULT_COLUMNS;

    // ヘッダ
    const tr = document.createElement('tr');
    columns.forEach(col => {
      const th = document.createElement('th');
      const meta = ALL_FILES_COLUMNS[col];
      const label = meta ? meta.label : col;
      th.textContent = label;
      th.tabIndex = 0;
      th.dataset.e2eId = 'global-index-sort-' + col;
      th.setAttribute('role', 'button');
      th.setAttribute('aria-label', label + 'で並び替え');
      th.setAttribute('aria-pressed', def.sortBy === col ? 'true' : 'false');
      th.setAttribute('aria-sort', def.sortBy === col ? (def.sortDir === 'asc' ? 'ascending' : 'descending') : 'none');
      th.style.cssText = 'padding:6px 10px;text-align:left;border-bottom:2px solid var(--border);color:var(--fg2);font-weight:normal;font-size:12px;white-space:nowrap;position:sticky;top:0;background:var(--bg2);cursor:pointer;';
      const toggleSort = () => {
        const cur = def.sortBy === col;
        def.sortBy = col;
        def.sortDir = cur ? (def.sortDir === 'asc' ? 'desc' : 'asc') : 'asc';
        if (typeof saveSmartDbDef === 'function') saveSmartDbDef(def, { skipVersionDirty: true });
        renderGlobalIndexTable(def);
      };
      th.addEventListener('click', toggleSort);
      _globalIndexBindKeyboardActivate(th, toggleSort);
      if (def.sortBy === col) {
        th.textContent += (def.sortDir === 'asc' ? ' ▲' : ' ▼');
      }
      tr.appendChild(th);
    });
    thead.appendChild(tr);

    // ボディ
    const createGlobalIndexRow = (file, rowIndex) => {
      const row = document.createElement('tr');
      const fileLabel = file?.name || file?.path || file?.abs_path || 'ファイル';
      row.tabIndex = 0;
      row.dataset.e2eId = _globalIndexStableControlId('global-index-table-row', file, rowIndex);
      row.setAttribute('role', 'button');
      row.setAttribute('aria-label', 'ファイルを開く: ' + fileLabel);
      row.style.cssText = 'cursor:pointer;';
      row.onmouseenter = () => { row.style.background = 'rgba(255,255,255,0.04)'; };
      row.onmouseleave = () => { row.style.background = ''; };
      row.addEventListener('click', () => _openFileByCategory(file));
      _globalIndexBindKeyboardActivate(row, () => _openFileByCategory(file));

      columns.forEach(col => {
        const td = document.createElement('td');
        td.style.cssText = 'padding:4px 10px;border-bottom:1px solid var(--border);font-size:12px;';
        let v = file[col];
        if (col === 'size') v = _fmtSize(v);
        else if (col === 'modified' && v) v = String(v).substring(0, 19).replace('T', ' ');
        else if (v == null) v = '—';
        td.textContent = v;
        if (col === 'path') td.title = file.abs_path || '';
        row.appendChild(td);
      });
      return row;
    };

    if (typeof renderSmartDbVirtualRows === 'function' && renderSmartDbVirtualRows({
      table,
      tbody,
      rows: files,
      colSpan: columns.length,
      rowHeight: 34,
      renderRow: createGlobalIndexRow,
    })) {
      if (typeof showStatus === 'function') {
        showStatus(files.length + ' / ' + (data.total || 0) + ' 件');
      }
      return;
    }

    files.forEach((file, index) => {
      tbody.appendChild(createGlobalIndexRow(file, index));
    });

    // カウント表示
    if (typeof showStatus === 'function') {
      showStatus(files.length + ' / ' + (data.total || 0) + ' 件');
    }
  }
  window.renderGlobalIndexTable = renderGlobalIndexTable;

  // sourceType='all-files' 用のフィルタダイアログ
  function showGlobalIndexFilterModal(smartDbId) {
    const restoreTarget = arguments.length > 1 ? arguments[1] : _globalIndexActiveElement();
    const def = (typeof _findSmartDbDefinition === 'function') ? _findSmartDbDefinition(smartDbId) : null;
    if (!def) return;
    const o = document.createElement('div');
    o.className = 'modal-overlay';
    o.dataset.e2eId = 'global-index-filter-overlay';

    function rowHtml(f, idx) {
      const col = f.column || 'category';
      const op = f.operator || 'equals';
      const val = f.value != null ? f.value : '';
      const idxNum = Number(idx);
      const hasNumberedIndex = Number.isFinite(idxNum) && idxNum >= 0;
      const rowId = hasNumberedIndex ? String(idxNum) : ('new-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7));
      const controlLabel = hasNumberedIndex ? `全件インデックス条件${idxNum + 1}` : '全件インデックス新規条件';
      let colOpts = '';
      Object.keys(ALL_FILES_COLUMNS).forEach(k => {
        colOpts += `<option value="${k}"${col === k ? ' selected' : ''}>${esc(ALL_FILES_COLUMNS[k].label)}</option>`;
      });
      const meta = ALL_FILES_COLUMNS[col] || { ops: ['equals'] };
      let opOpts = '';
      meta.ops.forEach(o2 => {
        opOpts += `<option value="${o2}"${op === o2 ? ' selected' : ''}>${esc(o2)}</option>`;
      });
      let valField = '';
      if (Array.isArray(meta.values)) {
        let valOpts = '';
        meta.values.forEach(vv => { valOpts += `<option value="${esc(vv)}"${String(val) === String(vv) ? ' selected' : ''}>${esc(vv)}</option>`; });
        valField = `<select class="gb-select global-index-filter-control" data-field="value" data-e2e-id="global-index-filter-${esc(rowId)}-value" aria-label="${esc(controlLabel)} 値">${valOpts}</select>`;
      } else {
        valField = `<input type="text" class="gb-input global-index-filter-control" value="${esc(val)}" placeholder="値" data-field="value" data-e2e-id="global-index-filter-${esc(rowId)}-value" aria-label="${esc(controlLabel)} 値">`;
      }
      return `<div class="sdf-row global-index-filter-row" data-idx="${esc(rowId)}" data-e2e-id="global-index-filter-${esc(rowId)}-row" role="group" aria-label="${esc(controlLabel)}">
        <select class="gb-select global-index-filter-control" data-field="column" data-e2e-id="global-index-filter-${esc(rowId)}-column" aria-label="${esc(controlLabel)} 項目">${colOpts}</select>
        <select class="gb-select global-index-filter-control" data-field="operator" data-e2e-id="global-index-filter-${esc(rowId)}-operator" aria-label="${esc(controlLabel)} 演算子">${opOpts}</select>
        ${valField}
        <button type="button" class="gb-btn gb-btn-sm gb-btn-icon gb-btn-danger cond-del-btn global-index-filter-remove" data-global-index-action="remove-filter-row" data-e2e-id="global-index-filter-${esc(rowId)}-remove" aria-label="${esc(controlLabel)}を削除" title="${esc(controlLabel)}を削除">${lucide('x', 14)}</button>
      </div>`;
    }

    function refreshRowForColumn(row) {
      if (!row) return;
      const column = row.querySelector('[data-field="column"]')?.value || 'category';
      const currentOp = row.querySelector('[data-field="operator"]')?.value || 'equals';
      const currentValue = row.querySelector('[data-field="value"]')?.value || '';
      const ops = ALL_FILES_COLUMNS[column]?.ops || ['equals'];
      const operator = ops.includes(currentOp) ? currentOp : ops[0];
      row.outerHTML = rowHtml({ column, operator, value: currentValue }, row.dataset.idx || -1);
    }

    let filtersHtml = '';
    (def.filters || []).forEach((f, i) => { filtersHtml += rowHtml(f, i); });

    o.innerHTML = `<div class="modal cond-modal global-index-filter-modal" role="dialog" aria-modal="true" aria-labelledby="gif-title" aria-describedby="gif-desc" data-e2e-id="global-index-filter-dialog">
      <h3 id="gif-title" class="gb-modal-title">全件インデックス フィルタ設定</h3>
      <div class="modal-body cond-modal-body">
        <div class="field"><label for="gif-name">名前</label><input id="gif-name" class="gb-input" type="text" value="${esc(def.name)}" data-e2e-id="global-index-filter-name" aria-label="全件インデックス名"></div>
        <div id="gif-desc" class="gb-section-desc global-index-filter-desc">フィルタ条件（AND: すべて一致）</div>
        <div id="gif-filters" class="cond-list" role="list" aria-label="全件インデックスのフィルタ条件">${filtersHtml}</div>
        <button type="button" id="gif-add-row" class="gb-btn gb-btn-sm cond-add-btn global-index-filter-add-row" data-global-index-action="add-filter-row" data-e2e-id="global-index-filter-add-row" aria-label="全件インデックスの条件を追加">${lucide('plus', 14)}<span>条件追加</span></button>
      </div>
      <div class="btn-row">
        <button type="button" class="gb-btn gb-btn-sm" data-global-index-action="close-modal" data-e2e-id="global-index-filter-cancel">キャンセル</button>
        <button type="button" class="gb-btn gb-btn-sm gb-btn-primary primary" id="gif-save-btn" data-e2e-id="global-index-filter-save">保存</button>
      </div>
    </div>`;
    document.body.appendChild(o);
    if (typeof setupConditionModalLayout === 'function') setupConditionModalLayout(o, '#gif-filters');
    const closeOverlay = _globalIndexAttachOverlayDismiss(o, restoreTarget);
    const filtersHost = document.getElementById('gif-filters');
    filtersHost.addEventListener('change', (ev) => {
      if (ev.target?.matches?.('[data-field="column"]')) refreshRowForColumn(ev.target.closest('.sdf-row'));
    });
    o.addEventListener('click', (ev) => {
      const actionEl = ev.target?.closest?.('[data-global-index-action]');
      if (!actionEl || !o.contains(actionEl)) return;
      const action = actionEl.dataset.globalIndexAction;
      if (action === 'remove-filter-row') actionEl.closest('.sdf-row')?.remove();
      else if (action === 'add-filter-row') document.getElementById('gif-filters')?.insertAdjacentHTML('beforeend', rowHtml({}, -1));
      else if (action === 'close-modal') closeOverlay();
    });
    document.getElementById('gif-save-btn').addEventListener('click', async () => {
      const name = document.getElementById('gif-name').value.trim() || '無題';
      const rows = document.querySelectorAll('#gif-filters .sdf-row');
      const filters = [];
      const before = (typeof _captureSmartDbHistorySnapshot === 'function')
        ? _captureSmartDbHistorySnapshot(def)
        : null;
      rows.forEach(r => {
        const column = r.querySelector('[data-field="column"]').value;
        const operator = r.querySelector('[data-field="operator"]').value;
        const valueEl = r.querySelector('[data-field="value"]');
        const value = valueEl ? valueEl.value : '';
        if (column) filters.push({ column, operator, value });
      });
      const nextDef = typeof normalizeSmartDbDefinition === 'function'
        ? normalizeSmartDbDefinition(JSON.parse(JSON.stringify({ ...def, name, filters })))
        : JSON.parse(JSON.stringify({ ...def, name, filters }));
      if (def._filePath) nextDef._filePath = def._filePath;
      if (def._fileId) nextDef._fileId = def._fileId;
      if (typeof saveSmartDbDef === 'function') {
        try { await saveSmartDbDef(nextDef); } catch (e) { showStatus('保存失敗: ' + e.message, true); return; }
      }
      Object.assign(def, nextDef);
      if (typeof pushSmartDbDefinitionHistory === 'function') {
        pushSmartDbDefinitionHistory('スマートシート: フィルタ保存', before, nextDef, nextDef.name);
      }
      if (typeof renderSmartDbList === 'function') renderSmartDbList();
      showStatus('フィルタを保存しました');
      closeOverlay();
      if (state.currentSmartDb?.id === smartDbId && typeof selectSmartDb === 'function') selectSmartDb(smartDbId, def);
    });
    _globalIndexFocusFirstDialogControl(o);
  }
  window.showGlobalIndexFilterModal = showGlobalIndexFilterModal;
})();
