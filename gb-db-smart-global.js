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
        if (typeof saveSmartDbDef === 'function') {
          saveSmartDbDef(def, { skipVersionDirty: true }).then(() => {
            _runSmartDbBasePostCommitEffects(def, { skipVersionDirty: true });
          }).catch(error => showStatus('並び順の保存に失敗しました: ' + error.message, true));
        }
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
    if (!window.GBUI?.createModal) throw new Error('全件インデックスのフィルタ設定を初期化できませんでした');
    const existingDialog = document.querySelector('[data-e2e-id="global-index-filter-dialog"]');
    if (existingDialog) {
      existingDialog.focus();
      return existingDialog.closest('.gb-modal-overlay')?._globalIndexFilterApi || null;
    }
    const content = document.createElement('div');
    content.className = 'cond-modal-body';

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
        <button type="button" class="gb-btn gb-btn-sm gb-btn-icon gb-btn-danger cond-del-btn global-index-filter-remove" data-global-index-action="remove-filter-row" data-e2e-id="global-index-filter-${esc(rowId)}-remove" aria-label="${esc(controlLabel)}を削除" title="${esc(controlLabel)}を削除" style="min-width:44px;">${lucide('x', 14)}</button>
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

    content.innerHTML = `<div class="field"><label for="gif-name">名前</label><input id="gif-name" class="gb-input" type="text" value="${esc(def.name)}" data-e2e-id="global-index-filter-name" aria-label="全件インデックス名"></div>
      <div id="gif-desc" class="gb-section-desc global-index-filter-desc">フィルタ条件（AND: すべて一致）</div>
      <div id="gif-filters" class="cond-list" role="list" aria-label="全件インデックスのフィルタ条件">${filtersHtml}</div>
      <button type="button" class="gb-btn gb-btn-sm cond-add-btn global-index-filter-add-row" data-global-index-action="add-filter-row" data-e2e-id="global-index-filter-add-row" aria-label="全件インデックスの条件を追加">${lucide('plus', 14)}<span>条件追加</span></button>`;
    const cancelButton = document.createElement('button');
    cancelButton.type = 'button';
    cancelButton.className = 'gb-btn gb-btn-sm';
    cancelButton.dataset.e2eId = 'global-index-filter-cancel';
    cancelButton.textContent = 'キャンセル';
    const saveButton = document.createElement('button');
    saveButton.type = 'button';
    saveButton.className = 'gb-btn gb-btn-sm gb-btn-primary primary';
    saveButton.dataset.e2eId = 'global-index-filter-save';
    saveButton.textContent = '保存';
    const footer = document.createElement('div');
    footer.className = 'btn-row';
    footer.append(cancelButton, saveButton);
    let saving = false;
    const modalApi = window.GBUI.createModal({
      id: 'global-index-filter',
      title: '全件インデックス フィルタ設定',
      body: content,
      footer,
      variant: 'standard',
      extraClass: 'global-index-filter-modal',
      geometryKey: 'smart-db-global-index-filter',
      minWidth: '0',
      initialFocus: () => content.querySelector('[data-e2e-id="global-index-filter-name"]'),
      returnFocus: restoreTarget || undefined,
      closeLabel: '全件インデックスのフィルタ設定を閉じる',
      closeOnEsc: true,
      closeOnOverlay: true,
      onBeforeClose: reason => reason === 'saved' || !saving,
    });
    modalApi.overlay.dataset.e2eId = 'global-index-filter-overlay';
    modalApi.overlay._globalIndexFilterApi = modalApi;
    modalApi.modal.dataset.e2eId = 'global-index-filter-dialog';
    modalApi.header.querySelector('.gb-modal-close').dataset.e2eId = 'global-index-filter-close';
    modalApi.modal.classList.add('cond-modal');
    modalApi.modal.setAttribute('aria-describedby', 'gif-desc');
    modalApi.modal.style.width = 'min(720px, calc(100vw - 24px))';
    modalApi.body.style.setProperty('overflow-x', 'hidden', 'important');
    if (typeof setupConditionModalLayout === 'function') setupConditionModalLayout(modalApi.overlay, '#gif-filters');
    const filtersHost = content.querySelector('#gif-filters');
    filtersHost.addEventListener('change', (ev) => {
      if (ev.target?.matches?.('[data-field="column"]')) refreshRowForColumn(ev.target.closest('.sdf-row'));
    });
    content.addEventListener('click', (ev) => {
      const actionEl = ev.target?.closest?.('[data-global-index-action]');
      if (!actionEl || !content.contains(actionEl)) return;
      const action = actionEl.dataset.globalIndexAction;
      if (action === 'remove-filter-row') actionEl.closest('.sdf-row')?.remove();
      else if (action === 'add-filter-row') filtersHost.insertAdjacentHTML('beforeend', rowHtml({}, -1));
    });
    cancelButton.addEventListener('click', () => modalApi.close('cancel'));
    saveButton.addEventListener('click', async () => {
      if (saving) return;
      saving = true;
      saveButton.disabled = true;
      cancelButton.disabled = true;
      const name = content.querySelector('#gif-name').value.trim() || '無題';
      const rows = filtersHost.querySelectorAll('.sdf-row');
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
      let committed = false;
      try {
        if (typeof saveSmartDbDef === 'function') await saveSmartDbDef(nextDef);
        committed = true;
        const baseErrors = _runSmartDbBasePostCommitEffects(nextDef, { skipListRender: true });
        const applyError = _applySmartDbCommittedDefinition(def, nextDef);
        if (applyError) baseErrors.push(applyError);
        const steps = [
          {
            label: '履歴の更新',
            run: () => {
              if (typeof pushSmartDbDefinitionHistory === 'function') {
                pushSmartDbDefinitionHistory('スマートシート: フィルタ保存', before, nextDef, nextDef.name);
              }
            },
          },
          {
            label: '一覧の更新',
            run: () => {
              if (typeof renderSmartDbList === 'function') renderSmartDbList();
            },
          },
        ];
        if (state.currentSmartDb?.id === smartDbId && typeof selectSmartDb === 'function') {
          steps.push({ label: '全件インデックスの再読み込み', run: () => selectSmartDb(smartDbId, nextDef) });
        }
        const postErrors = await _runSmartDbPostCommitSteps('フィルタ', steps, baseErrors);
        if (!postErrors.length) showStatus('フィルタを保存しました');
        modalApi.close('saved');
      } catch (e) {
        if (!committed) {
          try { showStatus('保存失敗: ' + e.message, true); }
          catch (statusError) { console.error('全件インデックスの保存失敗を表示できませんでした:', statusError); }
        } else {
          await _runSmartDbPostCommitSteps('フィルタ', [], [_smartDbPostCommitError('保存後の状態反映', e)]);
          try { modalApi.close('saved'); }
          catch (closeError) { console.error('保存済みの全件インデックス編集画面を閉じられませんでした:', closeError); }
        }
      } finally {
        saving = false;
        if (saveButton.isConnected) saveButton.disabled = false;
        if (cancelButton.isConnected) cancelButton.disabled = false;
        if (!committed && saveButton.isConnected) saveButton.focus({ preventScroll: true });
      }
    });
    modalApi.open();
    return modalApi;
  }
  window.showGlobalIndexFilterModal = showGlobalIndexFilterModal;
})();
