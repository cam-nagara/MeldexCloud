/* gb-board-bulk-import.js — シート / スマートシートのエントリを一括でリンクカードとしてボードに読み込む。
 *
 * ボード左上メニュー「シート/スマートシートから一括読込...」から起動。
 *   Step 1: 対象 (現在 Meldex で開いているシート / スマートシートのタブ) を選ぶ
 *   Step 2: ビューを選ぶ (ビューのフィルタを適用)
 *   Step 3: 該当エントリを取得 → 先頭の画像プロパティを並行フェッチ → グリッド配置で一括作成
 *
 * 重複: 既に同じエントリを指すリンクカードがあっても再追加する (仕様: 再追加)。
 * リンクカードの挙動: 既存 bdCreateLinkCardNode と同じ (linkType は path から推定)。
 */
(function () {
  'use strict';

  // 対象候補として扱うタブ型。ここに含まれる型のタブがあれば「開いているシート/スマートシート」として列挙する。
  const SUPPORTED_TAB_TYPES = new Set([
    'smart-db', 'database', 'pivot', 'tree', 'gallery', 'kanban', 'timeline', 'chart', 'graph', 'form',
  ]);
  let _activeBulkImportModal = null;

  async function bdOpenBulkLinkImport() {
    if (typeof bd === 'undefined') {
      if (typeof showStatus === 'function') showStatus('ボードが開かれていません', true);
      return;
    }
    const candidates = _collectCandidates();
    if (!candidates.length) {
      if (typeof showStatus === 'function') showStatus('開いているシート / スマートシートのタブがありません', true);
      return;
    }
    _openWizard(candidates);
  }

  // 開いているタブから対象候補を収集する。同じ path の重複は除外する。
  function _collectCandidates() {
    if (typeof GBLayout === 'undefined' || typeof GBLayout.getAllPanes !== 'function') return [];
    const result = [];
    const seen = new Set();
    try {
      GBLayout.getAllPanes(GBLayout.root).forEach(pane => {
        (pane.tabs || []).forEach(tab => {
          const path = tab?.path || '';
          const type = tab?.type || '';
          if (!path || seen.has(path)) return;
          if (SUPPORTED_TAB_TYPES.has(type)) {
            const tabState = (tab.state && typeof tab.state === 'object' && !Array.isArray(tab.state)) ? { ...tab.state } : {};
            result.push({ path, label: tab.label || path, type, tabState, paneId: pane.id || '', tabId: tab.id || '' });
            seen.add(path);
          }
        });
      });
    } catch (_) { /* noop */ }
    return result;
  }

  function _openWizard(candidates) {
    _activeBulkImportModal?.close?.('superseded');
    document.querySelectorAll('.bd-bulk-import-overlay').forEach(existing => existing.remove());
    if (typeof window.GBUI?.createModal !== 'function') {
      if (typeof showStatus === 'function') showStatus('一括読込ダイアログを開けません', true);
      return;
    }
    const restoreFocusTo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const uid = 'bdbl-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
    const descId = uid + '-desc';
    const sourceId = uid + '-source';
    const viewId = uid + '-view';
    const statusId = uid + '-status';
    const body = document.createElement('div');
    body.className = 'bd-bulk-import-content';
    body.innerHTML = `
      <label class="bd-bulk-import-field" for="${sourceId}">
        <span class="bd-bulk-import-label">対象のシート / スマートシート</span>
        <select id="${sourceId}" class="gb-select bd-bulk-import-select" data-bdbl-source></select>
      </label>
      <label class="bd-bulk-import-field" for="${viewId}">
        <span class="bd-bulk-import-label">ビュー ${fieldHelp('選択したビューのフィルタを適用します')}</span>
        <select id="${viewId}" class="gb-select bd-bulk-import-select" data-bdbl-view></select>
      </label>
      <div id="${statusId}" class="bd-bulk-import-status" data-bdbl-status role="status" aria-live="polite"></div>`;
    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'gb-btn gb-btn-sm';
    cancelBtn.dataset.bdblCancel = '';
    cancelBtn.textContent = 'キャンセル';
    const goBtn = document.createElement('button');
    goBtn.type = 'button';
    goBtn.className = 'gb-btn gb-btn-sm gb-btn-primary';
    goBtn.dataset.bdblGo = '';
    goBtn.textContent = '読み込む';
    let busy = false;
    const modalApi = window.GBUI.createModal({
      id: uid,
      title: 'シート / スマートシートから一括読込',
      body,
      footer: [cancelBtn, goBtn],
      variant: 'standard',
      extraClass: 'bd-bulk-import-dialog',
      geometryKey: 'board-bulk-link-import',
      initialFocus: '[data-bdbl-source]',
      returnFocus: restoreFocusTo || undefined,
      closeOnEsc: true,
      closeOnOverlay: true,
      onBeforeClose: reason => !busy || reason === 'complete' || reason === 'superseded',
      onClose: () => {
        if (_activeBulkImportModal === modalApi) _activeBulkImportModal = null;
      },
    });
    _activeBulkImportModal = modalApi;
    const overlay = modalApi.overlay;
    overlay.classList.add('bd-bulk-import-overlay');
    overlay.style.zIndex = '250';
    modalApi.body.id = descId;
    modalApi.modal.setAttribute('aria-describedby', descId);
    modalApi.header.classList.add('bd-bulk-import-header');
    modalApi.header.querySelector('.gb-modal-title')?.classList.add('bd-bulk-import-title');
    modalApi.body.classList.add('gb-confirm-body', 'bd-bulk-import-body');
    modalApi.footer.classList.add('gb-confirm-actions');
    const closeBtn = modalApi.header.querySelector('.gb-modal-close');
    closeBtn?.classList.add('gb-btn', 'gb-btn-sm', 'gb-btn-icon', 'bd-bulk-import-close');
    if (closeBtn) closeBtn.dataset.bdblClose = '';

    const srcSelect = body.querySelector('[data-bdbl-source]');
    const viewSelect = body.querySelector('[data-bdbl-view]');
    const statusEl = body.querySelector('[data-bdbl-status]');

    candidates.forEach((c, i) => {
      const opt = document.createElement('option');
      opt.value = String(i);
      opt.textContent = `${c.label}  —  ${c.path}`;
      srcSelect.appendChild(opt);
    });

    let currentEntries = null;
    // ユーザーが高速にドロップダウンを切り替えると複数の refreshPreview が in-flight になる。
    // 古い fetch の結果が新しい結果を上書きして表示件数と実エントリがずれる事態を防ぐため、
    // 発火ごとに seq を増やし、結果適用前に自分の seq が最新か照合する。
    let previewSeq = 0;

    const setStatus = (text, isError) => {
      statusEl.textContent = text || '';
      statusEl.classList.toggle('is-error', !!isError);
    };

    const setPreviewPending = (pending) => {
      currentEntries = null;
      if (!busy) goBtn.disabled = !!pending;
    };

    const refreshViews = async () => {
      const target = candidates[Number(srcSelect.value || 0)];
      viewSelect.innerHTML = '';
      setPreviewPending(true);
      setStatus('ビューを取得中…');
      const views = await _getViewsFor(target);
      views.forEach((v, i) => {
        const opt = document.createElement('option');
        opt.value = String(i);
        opt.textContent = v.label;
        viewSelect.appendChild(opt);
      });
      viewSelect._views = views;
      viewSelect._target = target;
      await refreshPreview();
    };

    const refreshPreview = async () => {
      const mySeq = ++previewSeq;
      const target = viewSelect._target;
      const views = viewSelect._views || [];
      const v = views[Number(viewSelect.value || 0)];
      setPreviewPending(true);
      if (!target || !v) {
        if (mySeq !== previewSeq) return;
        setStatus('');
        return;
      }
      setStatus('該当トピックを取得中…');
      try {
        const entries = await _fetchEntries(target, v);
        if (mySeq !== previewSeq) return; // より新しい refreshPreview が発火済みなら捨てる
        currentEntries = entries;
        if (!entries || !entries.length) setStatus('該当トピックがありません', true);
        else {
          setStatus(`該当トピック: ${entries.length} 件`);
          if (!busy) goBtn.disabled = false;
        }
      } catch (e) {
        if (mySeq !== previewSeq) return;
        setStatus('取得失敗: ' + (e?.message || e), true);
      }
    };

    srcSelect.addEventListener('change', refreshViews);
    viewSelect.addEventListener('change', refreshPreview);

    const close = (options = {}) => {
      if (busy && !options.force) return;
      modalApi.close(options.force ? 'complete' : 'programmatic');
    };
    cancelBtn.addEventListener('click', () => close());

    goBtn.addEventListener('click', async () => {
      if (busy) return;
      if (!Array.isArray(currentEntries) || !currentEntries.length) {
        setStatus('読み込めるトピックがありません', true);
        return;
      }
      busy = true;
      goBtn.disabled = true;
      cancelBtn.disabled = true;
      setStatus(`${currentEntries.length} 件のリンクトピックを作成中…`);
      try {
        const created = await _executeImport(currentEntries);
        close({ force: true });
        if (typeof showStatus === 'function') showStatus(`${created} 件のリンクトピックを読み込みました`);
      } catch (e) {
        setStatus('読み込みに失敗: ' + (e?.message || e), true);
        goBtn.disabled = false;
        cancelBtn.disabled = false;
        busy = false;
      }
    });

    modalApi.open();
    refreshViews();
  }

  async function _getViewsFor(target) {
    if (!target) return [];
    if (target.type === 'smart-db') {
      // スマートシートはトップレベルの filters が「全体ビュー」として機能する。
      // ユーザー定義ビューの概念はスマートシートには現状ない。
      return [{ label: 'スマートシート全体 (フィルタ適用)', kind: 'smart-all' }];
    }
    // 通常のシート: 「現在のフィルタ」「保存済みビュー」「すべて」を列挙。
    const views = [];
    if (typeof getCurrentDbViewConfigEntry === 'function') {
      views.push({ label: '現在のフィルタ', kind: 'db-current' });
    }
    if (typeof getSavedViews === 'function') {
      try {
        const saved = getSavedViews(target.path) || [];
        saved.forEach((v, idx) => {
          views.push({ label: `ビュー: ${v?.name || '(無題)'}`, kind: 'db-saved', idx });
        });
      } catch (_) { /* noop */ }
    }
    views.push({ label: 'すべて (フィルタ無し)', kind: 'db-all' });
    return views;
  }

  async function _fetchEntries(target, view) {
    if (target.type === 'smart-db') {
      return await _fetchSmartDbEntries(target.path);
    }
    return await _fetchDbEntries(target.path, view);
  }

  async function _fetchSmartDbEntries(path) {
    const def = await _loadSmartDbDefinition(path);
    if (def?.sourceType === 'all-files') {
      const data = await _fetchSmartDbAllFilesData(path, def);
      let files = Array.isArray(data?.files) ? data.files.slice() : [];
      if (typeof applyGlobalIndexFilters === 'function') files = applyGlobalIndexFilters(files, def.filters || []);
      if (typeof applyGlobalIndexSort === 'function') files = applyGlobalIndexSort(files, def.sortBy || 'modified', def.sortDir || 'desc');
      return files
        .filter(file => file && (file.path || file.abs_path))
        .map(file => ({
          path: file.abs_path || file.path,
          name: file.name || String(file.abs_path || file.path || '').split(/[\\/]/).pop() || '',
          source: 'smart-db',
        }));
    }
    const filters = Array.isArray(def?.filters) ? def.filters : [];
    const bulkSources = (typeof _smartDbEffectiveSources === 'function')
      ? _smartDbEffectiveSources(def)
      : (Array.isArray(def?.sources) ? def.sources.filter(s => s && s.path) : []);
    let bulkUrl = '/smart-db?filters=' + encodeURIComponent(JSON.stringify(filters));
    if (bulkSources.length) bulkUrl += '&sources=' + encodeURIComponent(JSON.stringify(bulkSources));
    const payload = _currentSmartDbMatches(path, def) && Array.isArray(state?.smartDbData?.entities)
      ? state.smartDbData
      : await apiFetch(bulkUrl);
    const entities = Array.isArray(payload?.entities) ? payload.entities : [];
    return entities
      .filter(e => e && e.path)
      .map(e => ({ path: e.path, name: e.name || '', source: 'smart-db' }));
  }

  async function _loadSmartDbDefinition(path) {
    const pathText = String(path || '');
    if (pathText.startsWith('smart-db:')) {
      const id = pathText.slice('smart-db:'.length);
      if (state?.currentSmartDb && (state.currentSmartDb.id === id || state.currentSmartDb._filePath === id)) {
        return state.currentSmartDb;
      }
      let saved = [];
      try {
        saved = typeof getSavedSmartDbs === 'function'
          ? getSavedSmartDbs()
          : JSON.parse(localStorage.getItem('smartDbs') || '[]');
      } catch { saved = []; }
      const found = (saved || []).find(d => d?.id === id || d?._filePath === id) || {};
      if (!_isRawSmartDbDefinition(found)) throw new Error('スマートシートが見つかりません');
      return typeof normalizeSmartDbDefinition === 'function' ? normalizeSmartDbDefinition(found) : found;
    }
    const fileData = await apiFetch('/file?path=' + encodeURIComponent(pathText));
    let def = {};
    try { def = JSON.parse(fileData?.content || '{}') || {}; } catch { throw new Error('スマートシートJSONを読み込めません'); }
    if (!_isRawSmartDbDefinition(def)) throw new Error('スマートシート定義が空です');
    if (typeof normalizeSmartDbDefinition === 'function') def = normalizeSmartDbDefinition(def);
    def._filePath = pathText;
    return def;
  }

  function _isRawSmartDbDefinition(def) {
    if (!def || typeof def !== 'object' || Array.isArray(def)) return false;
    if (!Object.keys(def).length) return false;
    return def.type === 'smart-db'
      || def.sourceType === 'all-files'
      || def.sourceType === 'db-entities'
      || Array.isArray(def.filters)
      || !!def.id
      || !!def.name;
  }

  function _currentSmartDbMatches(path, def) {
    const current = state?.currentSmartDb;
    if (!current) return false;
    const pathText = String(path || '');
    return current === def
      || current.id === def?.id
      || (current._filePath && current._filePath === pathText)
      || pathText === 'smart-db:' + current.id;
  }

  async function _fetchSmartDbAllFilesData(path, def) {
    if (_currentSmartDbMatches(path, def) && Array.isArray(state?.smartDbData?.files)) return state.smartDbData;
    if (typeof loadGlobalIndexData === 'function') return await loadGlobalIndexData(def);
    return await apiFetch('/global-index');
  }

  async function _fetchDbEntries(dbPath, view) {
    // 通常シートのエントリは /pivot エンドポイントで取得する。
    // state.filter (採用/不採用/すべて) が current フィルタとして status_filter に反映される。
    // view.kind === 'db-all' はフィルタ無しを要求するので status_filter を渡さない。
    let url = '/pivot?path=' + encodeURIComponent(dbPath);
    const activeView = _dbViewForBulkImport(dbPath, view);
    const statusFilter = _statusFilterParamForBulkImport(dbPath, view, activeView);
    if (statusFilter) url += '&status_filter=' + encodeURIComponent(statusFilter);
    const data = await apiFetch(url);
    const entitiesObj = (data && data.entities && typeof data.entities === 'object') ? data.entities : {};
    const all = Object.keys(entitiesObj).map(name => ({
      path: _resolveDbEntityPathForBulkImport(dbPath, name, data, entitiesObj[name]),
      name,
      source: 'db',
    })).filter(e => !!e.path);
    const advancedFilters = Array.isArray(activeView?.advancedFilters) ? activeView.advancedFilters : [];
    const filtered = advancedFilters.length
      ? all.filter(e => _dbEntityPassesAdvancedFiltersForBulkImport(entitiesObj[e.name], advancedFilters))
      : all;
    return _sortDbEntriesForBulkImport(filtered, entitiesObj, activeView);
  }

  function _dbViewForBulkImport(dbPath, view) {
    if (view?.kind === 'db-current' && typeof getCurrentDbViewConfigEntry === 'function') {
      try { return getCurrentDbViewConfigEntry(dbPath) || null; } catch { return null; }
    }
    if (view?.kind !== 'db-saved' || !Number.isInteger(view.idx) || typeof getSavedViews !== 'function') return null;
    try { return (getSavedViews(dbPath) || [])[view.idx] || null; } catch { return null; }
  }

  function _statusFilterParamForBulkImport(dbPath, view, savedView) {
    if (view?.kind === 'db-all') return '';
    let filterName = '';
    if (view?.kind === 'db-saved' || view?.kind === 'db-current') filterName = String(savedView?.filter || '').trim();
    else if (typeof state !== 'undefined' && dbPath === state.currentDbPath && typeof getFilterParam === 'function') {
      try { return getFilterParam() || ''; } catch { return ''; }
    }
    if (filterName === 'adopted') return '採用,掲載済み';
    if (filterName === 'nobotsu') return '採用,掲載済み,案';
    return '';
  }

  function _resolveDbEntityPathForBulkImport(dbPath, name, pivotData, entityData) {
    const db = String(dbPath || '').replace(/\/+$/, '');
    const embedded = pivotData?.new_format === true ? _entityDataPathForBulkImport(entityData) : '';
    if (embedded) return embedded;
    return pivotData?.new_format === true ? db + '/' + name + '.md' : db + '/' + name;
  }

  function _entityDataPathForBulkImport(entityData) {
    if (!entityData || typeof entityData !== 'object') return '';
    for (const values of Object.values(entityData)) {
      if (!Array.isArray(values)) continue;
      for (const value of values) {
        const file = String(value?.file || '').trim();
        if (file) return file;
      }
    }
    return '';
  }

  function _dbEntityPassesAdvancedFiltersForBulkImport(entityData, filters) {
    if (typeof _dbEntityPassesAdvancedFilters === 'function') {
      return _dbEntityPassesAdvancedFilters(entityData, filters);
    }
    return (filters || []).every(filter => {
      if (filter?.property === '*') {
        const allValues = Object.values(entityData || {}).flat().filter(v => v && typeof v === 'object');
        return _dbValuesMatchAdvancedFilterForBulkImport(allValues, filter);
      }
      return _dbValuesMatchAdvancedFilterForBulkImport(entityData?.[filter?.property] || [], filter);
    });
  }

  function _dbValuesMatchAdvancedFilterForBulkImport(values, filter) {
    const list = Array.isArray(values) ? values : [];
    if (!list.length) return filter?.operator === 'empty' || filter?.operator === 'not_contains';
    if (filter?.operator === 'not_equals' || filter?.operator === 'not_contains') {
      return list.every(value => _dbValueMatchesAdvancedFilterForBulkImport(value, filter));
    }
    return list.some(value => _dbValueMatchesAdvancedFilterForBulkImport(value, filter));
  }

  function _dbValueMatchesAdvancedFilterForBulkImport(valueObj, filter) {
    const target = String(filter?.field === 'status' ? (valueObj?.status || '') : (valueObj?.value || ''));
    const needle = String(filter?.value || '');
    switch (filter?.operator) {
      case 'equals': return target === needle;
      case 'not_equals': return target !== needle;
      case 'contains': return target.includes(needle);
      case 'not_contains': return !target.includes(needle);
      case 'empty': return target.trim() === '';
      case 'not_empty': return target.trim() !== '';
      default: return true;
    }
  }

  function _sortDbEntriesForBulkImport(entries, entitiesObj, view) {
    const sortCfg = view?.sortConfig || null;
    const manualOrder = Array.isArray(view?.manualOrder) ? view.manualOrder : null;
    const out = entries.slice();
    if (sortCfg?.key === 'manual' && manualOrder) {
      out.sort((a, b) => {
        const ia = manualOrder.indexOf(a.name), ib = manualOrder.indexOf(b.name);
        if (ia < 0 && ib < 0) return a.name.localeCompare(b.name);
        if (ia < 0) return 1;
        if (ib < 0) return -1;
        return ia - ib;
      });
      return out;
    }
    if (!sortCfg?.key || sortCfg.key === 'name') {
      out.sort((a, b) => sortCfg?.dir === 'desc' ? b.name.localeCompare(a.name) : a.name.localeCompare(b.name));
      return out;
    }
    out.sort((a, b) => {
      const av = _firstAdoptedValueForBulkImport(entitiesObj[a.name]?.[sortCfg.key]);
      const bv = _firstAdoptedValueForBulkImport(entitiesObj[b.name]?.[sortCfg.key]);
      const cmp = av.localeCompare(bv, undefined, { numeric: true });
      return sortCfg.dir === 'desc' ? -cmp : cmp;
    });
    return out;
  }

  function _firstAdoptedValueForBulkImport(values) {
    if (!Array.isArray(values)) return '';
    const picked = values.find(v => v && (v.status === '採用' || v.status === '掲載済み'))
      || values.find(v => v && v.status === '案')
      || values[0];
    return picked?.value == null ? '' : String(picked.value);
  }

  async function _executeImport(entries) {
    const canvas = document.getElementById('bd-canvas');
    const rect = canvas?.getBoundingClientRect();
    const paneW = (rect && rect.width) || 800;
    const paneH = (rect && rect.height) || 600;
    const zoom = bd.zoom || 1;
    const viewW = paneW / zoom;
    const viewH = paneH / zoom;

    // リンクカードの既定サイズ: 画像付きで w=240 (gb-board-ui.part01.js の bdCreateLinkCardNode 参照)。
    const cardW = 240;
    const cardH = 140;
    const gap = 24;

    const N = entries.length;
    // 列数はパネル縦横比に合わせて決める。N 枚を (cols × rows) に並べた全体形状が、
    // パネルの (viewW × viewH) と似た比率になるよう cols を選ぶ。
    //   cols / rows ≒ (viewW / cardW+gap) / (viewH / cardH+gap) とする近似。
    const cellW = cardW + gap;
    const cellH = cardH + gap;
    const paneAspect = Math.max(0.1, viewW / Math.max(1, viewH));
    const cellAspect = Math.max(0.1, cellW / cellH);
    let cols = Math.max(1, Math.round(Math.sqrt(N * paneAspect / cellAspect)));
    if (cols > N) cols = N;
    const rows = Math.max(1, Math.ceil(N / cols));

    // グリッド全体をパネル中心に寄せる。
    const gridW = cols * cardW + (cols - 1) * gap;
    const gridH = rows * cardH + (rows - 1) * gap;
    const center = (typeof bdGetCanvasCenterWorld === 'function')
      ? bdGetCanvasCenterWorld()
      : { x: 120, y: 120 };
    const startX = center.x - gridW / 2;
    const startY = center.y - gridH / 2;

    // 画像プロパティは並行取得 (最大 6 本)。
    const imgMap = await _fetchImagesParallel(entries.map(e => e.path), 6);

    const createdNodes = [];
    const createdIds = [];
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = startX + col * (cardW + gap);
      const y = startY + row * (cardH + gap);
      const img = imgMap.get(e.path) || '';
      const linkType = (typeof _bdInferLinkType === 'function') ? _bdInferLinkType(e.path, '') : '';
      const node = (typeof bdCreateLinkCardNode === 'function')
        ? bdCreateLinkCardNode(e.path, x, y, e.name || '', { img, linkType, w: cardW })
        : null;
      if (node) {
        createdNodes.push(node);
        createdIds.push(node.id);
      }
    }
    if (typeof bdPushUndo === 'function') bdPushUndo();
    bd.nodes.push(...createdNodes);

    // 大量追加後の一括再描画。bdRequestFullRender があれば優先使用。
    if (typeof bdRequestFullRender === 'function') bdRequestFullRender('bulk-link-import');
    else if (typeof bdRender === 'function') bdRender();
    if (typeof bdMarkExtrasDirty === 'function') {
      bdMarkExtrasDirty({ minimap: true, boardUi: true, frames: true }, 'bulk-link-import');
    }
    if (typeof bdDirty === 'function') bdDirty();

    // 作成した全カードを選択状態にする (続けてまとめて移動やスタイル変更できるように)。
    // 既存ラインの選択は解除、activeNode は最後に作ったカードに寄せる (単一選択時の
    // 挙動に合わせるため; bdSelect が activeNode = id を行うのと同趣旨)。
    if (bd.selected instanceof Set && createdIds.length) {
      if (typeof bdClearConnectionSelection === 'function') bdClearConnectionSelection();
      bd.selected.clear();
      createdIds.forEach(id => bd.selected.add(id));
      bd._activeNode = createdIds[createdIds.length - 1];
      if (typeof bdSyncResizeHandles === 'function') bdSyncResizeHandles();
      if (typeof bdMarkSelectionDirty === 'function') bdMarkSelectionDirty(createdIds, 'bulk-link-import');
    }

    return createdIds.length;
  }

  // path 配列から最初の画像プロパティ URL を並行取得する。
  // Promise.all + 並行制限 (concurrency 本) で過大な fetch を避ける。
  async function _fetchImagesParallel(paths, concurrency) {
    const result = new Map();
    if (!Array.isArray(paths) || !paths.length) return result;
    let cursor = 0;
    const worker = async () => {
      while (cursor < paths.length) {
        const idx = cursor++;
        const path = paths[idx];
        if (!path) continue;
        try {
          const img = await _extractFirstImage(path);
          if (img) result.set(path, img);
        } catch (_) { /* 画像取得失敗は無視して次へ */ }
      }
    };
    const workerCount = Math.max(1, Math.min(concurrency || 1, paths.length));
    await Promise.all(Array.from({ length: workerCount }, () => worker()));
    return result;
  }

  // エントリの /entity レスポンスから最初の画像プロパティ値を抽出する。
  // Meldex のエントリプロパティは { properties: { propName: [{value, status, ...}, ...] } } の
  // 構造で、同じプロパティに複数の候補値 (採用/不採用) が並ぶ。ここでは "採用" / "掲載済み" の
  // 値だけを見て、値文字列が画像拡張子で終わる最初のものを選ぶ。
  // 画像判定は拡張子 (.png/.jpg/.jpeg/.gif/.webp/.svg/.bmp/.avif) ベース。
  async function _extractFirstImage(path) {
    if (!path) return '';
    const imgExt = /\.(png|jpe?g|gif|webp|svg|bmp|avif)(\?.*)?$/i;
    const adopted = (status) => status === '採用' || status === '掲載済み';
    let data;
    try {
      data = await apiFetch('/entity?path=' + encodeURIComponent(path));
    } catch (_) { return ''; }
    const props = (data && typeof data === 'object' && data.properties && typeof data.properties === 'object')
      ? data.properties : null;
    if (props) {
      for (const key of Object.keys(props)) {
        const arr = props[key];
        if (!Array.isArray(arr)) continue;
        for (const entry of arr) {
          if (!entry || typeof entry !== 'object') continue;
          if (!adopted(entry.status)) continue;
          const v = _firstImageCandidate(entry.value, imgExt);
          if (v) return _resolveImageUrl(v, path);
        }
      }
    }
    // フロントマター / props 系の単純 map 形式もフォールバックとして見る
    // (note 系など properties を持たない形式がある場合への備え)。
    const fallbackSources = [];
    if (data && typeof data === 'object') {
      if (data.frontmatter && typeof data.frontmatter === 'object') fallbackSources.push(data.frontmatter);
      if (data.props && typeof data.props === 'object') fallbackSources.push(data.props);
    }
    for (const src of fallbackSources) {
      for (const key of Object.keys(src)) {
        const val = src[key];
        const image = _firstImageCandidate(val, imgExt);
        if (image) return _resolveImageUrl(image, path);
      }
    }
    return '';
  }

  function _firstImageCandidate(value, imgExt) {
    const candidates = _imageCandidateValues(value);
    return candidates.find(v => imgExt.test(v)) || '';
  }

  function _imageCandidateValues(value) {
    if (value == null) return [];
    if (typeof value === 'string') {
      const raw = value.trim();
      if ((raw.startsWith('[') && raw.endsWith(']')) || (raw.startsWith('{') && raw.endsWith('}'))) {
        try { return _imageCandidateValues(JSON.parse(raw)); } catch {}
      }
      return raw ? [raw] : [];
    }
    if (Array.isArray(value)) return value.flatMap(v => _imageCandidateValues(v));
    if (typeof value === 'object') {
      return ['url', 'path', 'file', 'src', 'name']
        .flatMap(key => _imageCandidateValues(value[key]));
    }
    return [];
  }

  // 画像 URL を解決する。http/https/data はそのまま、相対パスは /file-raw 経由に変換する。
  function _resolveImageUrl(val, entryPath) {
    const s = String(val || '').trim();
    if (!s) return '';
    if (/^(https?|data|blob):/i.test(s)) return s;
    if (/^\/(?:api\/)?(?:file-raw|media\/file)\?/i.test(s)) return s;
    if (/^_media\//i.test(s)) return _mediaFileUrlForBulkImport(s);
    const resolvedPath = _resolveRelativeImagePath(s, entryPath);
    if (typeof API_BASE !== 'undefined' && API_BASE) {
      return API_BASE + '/file-raw?path=' + encodeURIComponent(resolvedPath);
    }
    return '/api/file-raw?path=' + encodeURIComponent(resolvedPath);
  }

  function _mediaFileUrlForBulkImport(path) {
    const mediaPath = String(path || '').replace(/^\/+/, '');
    return window.MeldexResourceUrl?.api
      ? window.MeldexResourceUrl.api('/media/file', { path: mediaPath })
      : '/api/media/file?path=' + encodeURIComponent(mediaPath);
  }

  function _resolveRelativeImagePath(imagePath, entryPath) {
    const raw = String(imagePath || '').replace(/\\/g, '/').trim();
    if (!raw || raw.startsWith('/') || /^[a-zA-Z]:\//.test(raw)) return raw.replace(/^\/+/, '');
    const base = String(entryPath || '').replace(/\\/g, '/');
    const slash = base.lastIndexOf('/');
    const dir = base.endsWith('.md') ? base.slice(0, slash) : base;
    return (dir ? dir.replace(/\/+$/, '') + '/' : '') + raw;
  }

  if (window.__MELDEX_BOARD_BULK_IMPORT_TEST__) {
    window.__MELDEX_BOARD_BULK_IMPORT_TEST__.importEntries = _executeImport;
  }
  window.bdOpenBulkLinkImport = bdOpenBulkLinkImport;
})();
