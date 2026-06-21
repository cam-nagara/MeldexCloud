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
    backlink_scriptnote_count:{ label: '被リンク数(台本)',     ops: ['equals','greater_than','less_than'] },
    backlink_page_count:      { label: '被リンク数(ページ)',   ops: ['equals','greater_than','less_than'] },
    size:                     { label: 'サイズ',     ops: ['greater_than','less_than','equals'] },
    modified:                 { label: '更新日時',   ops: ['after','before'] }
  };

  const DEFAULT_COLUMNS = ['name','category','root_name','path','size','modified','backlink_file_count','backlink_board_count'];

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
      th.textContent = meta ? meta.label : col;
      th.style.cssText = 'padding:6px 10px;text-align:left;border-bottom:2px solid var(--border);color:var(--fg2);font-weight:normal;font-size:12px;white-space:nowrap;position:sticky;top:0;background:var(--bg2);cursor:pointer;';
      th.addEventListener('click', () => {
        const cur = def.sortBy === col;
        def.sortBy = col;
        def.sortDir = cur ? (def.sortDir === 'asc' ? 'desc' : 'asc') : 'asc';
        if (typeof saveSmartDbDef === 'function') saveSmartDbDef(def, { skipVersionDirty: true });
        renderGlobalIndexTable(def);
      });
      if (def.sortBy === col) {
        th.textContent += (def.sortDir === 'asc' ? ' ▲' : ' ▼');
      }
      tr.appendChild(th);
    });
    thead.appendChild(tr);

    // ボディ
    const createGlobalIndexRow = (file) => {
      const row = document.createElement('tr');
      row.style.cssText = 'cursor:pointer;';
      row.onmouseenter = () => { row.style.background = 'rgba(255,255,255,0.04)'; };
      row.onmouseleave = () => { row.style.background = ''; };
      row.addEventListener('click', () => _openFileByCategory(file));

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

    files.forEach(file => {
      tbody.appendChild(createGlobalIndexRow(file));
    });

    // カウント表示
    if (typeof showStatus === 'function') {
      showStatus(files.length + ' / ' + (data.total || 0) + ' 件');
    }
  }
  window.renderGlobalIndexTable = renderGlobalIndexTable;

  // sourceType='all-files' 用のフィルタダイアログ
  function showGlobalIndexFilterModal(smartDbId) {
    const def = (typeof _findSmartDbDefinition === 'function') ? _findSmartDbDefinition(smartDbId) : null;
    if (!def) return;
    const o = document.createElement('div');
    o.className = 'modal-overlay';

    function rowHtml(f, idx) {
      const col = f.column || 'category';
      const op = f.operator || 'equals';
      const val = f.value != null ? f.value : '';
      let colOpts = '';
      Object.keys(ALL_FILES_COLUMNS).forEach(k => {
        colOpts += `<option value="${k}"${col === k ? ' selected' : ''}>${esc(ALL_FILES_COLUMNS[k].label)}</option>`;
      });
      const meta = ALL_FILES_COLUMNS[col] || { ops: ['equals'] };
      let opOpts = '';
      meta.ops.forEach(o2 => {
        opOpts += `<option value="${o2}"${op === o2 ? ' selected' : ''}>${esc(o2)}</option>`;
      });
      let valField = `<input type="text" value="${esc(val)}" placeholder="値" data-field="value" style="flex:1;padding:4px;background:var(--bg);color:var(--fg);border:1px solid var(--border);border-radius:3px;font-size:12px;">`;
      if (Array.isArray(meta.values)) {
        let valOpts = '';
        meta.values.forEach(vv => { valOpts += `<option value="${esc(vv)}"${String(val) === String(vv) ? ' selected' : ''}>${esc(vv)}</option>`; });
        valField = `<select class="gb-select" data-field="value" style="flex:1;">${valOpts}</select>`;
      }
      return `<div class="sdf-row" data-idx="${idx}" style="display:flex;gap:4px;align-items:center;margin-bottom:4px;">
        <select class="gb-select" data-field="column" style="flex:1;">${colOpts}</select>
        <select class="gb-select" data-field="operator" style="flex:1;">${opOpts}</select>
        ${valField}
        <button data-action="this.closest('.sdf-row').remove()" style="background:none;border:none;color:var(--red);cursor:pointer;">${lucide('x', 14)}</button>
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

    o.innerHTML = `<div class="modal cond-modal" style="min-width:580px;">
      <h3>全件インデックス フィルタ設定</h3>
      <div class="modal-body cond-modal-body">
        <div class="field"><label>名前</label><input id="gif-name" type="text" value="${esc(def.name)}"></div>
        <div style="margin:0;font-size:12px;color:var(--fg2);">フィルタ条件（AND: すべて一致）</div>
        <div id="gif-filters" class="cond-list">${filtersHtml}</div>
        <button id="gif-add-row" class="cond-add-btn" style="font-size:12px;padding:2px 8px;background:var(--bg3);color:var(--fg2);border:1px solid var(--border);border-radius:3px;cursor:pointer;margin:4px 0;">+ 条件追加</button>
      </div>
      <div class="btn-row" style="margin-top:12px;">
        <button data-action="this.closest('.modal-overlay').remove()">キャンセル</button>
        <button class="primary" id="gif-save-btn">保存</button>
      </div>
    </div>`;
    document.body.appendChild(o);
    if (typeof setupConditionModalLayout === 'function') setupConditionModalLayout(o, '#gif-filters');
    const filtersHost = document.getElementById('gif-filters');
    filtersHost.addEventListener('change', (ev) => {
      if (ev.target?.matches?.('[data-field="column"]')) refreshRowForColumn(ev.target.closest('.sdf-row'));
    });
    document.getElementById('gif-add-row').addEventListener('click', () => {
      document.getElementById('gif-filters').insertAdjacentHTML('beforeend', rowHtml({}, -1));
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
      o.remove();
      if (state.currentSmartDb?.id === smartDbId && typeof selectSmartDb === 'function') selectSmartDb(smartDbId, def);
    });
  }
  window.showGlobalIndexFilterModal = showGlobalIndexFilterModal;
})();
