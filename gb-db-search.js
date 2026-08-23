/* ==============================
   gb-db-search.js: シート横断構造検索
   全シートのエントリ名+プロパティ値をフリーワードで横断検索
   ============================== */

/**
 * シート横断検索を実行する
 * @param {string} query - 検索キーワード
 * @param {string} scope - 特定シートパス（空=全シート）
 * @returns {Promise<object>} smart-dbレスポンス
 */
async function doDbSearch(query, scope, fallbackSheetPaths) {
  if (!query) return { entities: [] };
  const params = new URLSearchParams({ q: query, filters: '[]' });
  let sources = [];
  if (scope) {
    sources = [{ kind: 'sheet', path: scope }];
    params.set('scope', scope);
  } else {
    const roots = await apiFetch('/outliner-roots').catch(() => []);
    sources = (Array.isArray(roots) ? roots : [])
      .filter(root => root && root.visible !== false && root.path)
      .map(root => ({ kind: 'folder', path: root.path }));
    if (!sources.length) {
      sources = Array.from(new Set(Array.from(fallbackSheetPaths || []).filter(Boolean)))
        .map(path => ({ kind: 'sheet', path }));
    }
  }
  params.set('sources', JSON.stringify(sources));
  return await apiFetch('/smart-db?' + params.toString());
}

/* --- 現在のシート内検索/置換バー --- */

let _dbFindState = {
  bar: null,
  ctx: null,
  dbPath: '',
  query: '',
  matches: [],
  index: -1,
};

function _dbFindCssEscape(value) {
  return MeldexEscape.cssIdent(value);
}

function _dbFindCurrentCtx() {
  return (typeof _currentPaneState === 'function' ? _currentPaneState() : null) || {};
}

function _dbFindData(ctx, dbPath) {
  if (ctx?.dbPath === dbPath && ctx.pivotData) return ctx.pivotData;
  if (state.currentDbPath === dbPath && state.pivotData) return state.pivotData;
  return ctx?.pivotData || state.pivotData || null;
}

function _dbFindRoot(ctx) {
  return (typeof _paneEl === 'function' && (_paneEl(ctx, '.pivot-view') || _paneEl(ctx, '#db-view-container')))
    || document.getElementById('pivot-view')
    || document.getElementById('db-view-container')
    || document.body;
}

function _positionDbFindBar() {
  const bar = _dbFindState.bar;
  if (!bar) return;
  const root = _dbFindRoot(_dbFindState.ctx);
  const rect = root.getBoundingClientRect?.() || { top: 0, right: document.documentElement.clientWidth };
  const width = bar.offsetWidth || 420;
  const top = Math.max(8, rect.top + 8);
  const left = Math.max(8, rect.right - width - 16);
  bar.style.top = top + 'px';
  bar.style.left = left + 'px';
  bar.style.right = '';
  if (typeof clampPopupToViewport === 'function') clampPopupToViewport(bar);
}

function _dbFindRegex(query) {
  const escaped = String(query || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return escaped ? new RegExp(escaped, 'gi') : null;
}

function _dbFindValueRef(dbPath, entityName, propName, val, rawIndex, pivotData) {
  return {
    file: val?.file || _entityPath(dbPath, entityName, pivotData),
    property: val?.property || propName,
    candidate_index: val?.candidate_index != null ? val.candidate_index : rawIndex,
    value: val?.value,
    status: val?.status,
  };
}

function _dbFindVisibleProps(dbPath, pivotData) {
  let props = Array.isArray(pivotData?.properties) ? pivotData.properties : [];
  if (typeof filterDeletedDbProperties === 'function') props = filterDeletedDbProperties(dbPath, props);
  const hidden = typeof getHiddenCols === 'function'
    ? getHiddenCols(dbPath, { ctx: _dbFindState.ctx })
    : [];
  return props.filter(propName => !hidden.includes(propName));
}

function _dbFindCollectMatches(query, ctx, dbPath) {
  const pivotData = _dbFindData(ctx, dbPath);
  const entities = pivotData?.entities || {};
  const props = _dbFindVisibleProps(dbPath, pivotData);
  const needle = String(query || '').toLowerCase();
  if (!needle) return [];
  const matches = [];
  const propTypes = typeof getPropertyTypes === 'function' ? getPropertyTypes(dbPath, ctx) : {};
  const advFilters = typeof getAdvancedFilters === 'function' ? getAdvancedFilters(dbPath, { ctx }) : [];
  const columnValueFilters = typeof getColumnValueFilters === 'function' ? getColumnValueFilters(dbPath, { ctx }) : {};
  const entityNames = typeof _dbSortedEntityNames === 'function'
    ? _dbSortedEntityNames(pivotData, dbPath, ctx, {
        applyAdvancedFilters: true,
        propTypes,
        advFilters,
        columnValueFilters,
        filterMode: ctx?.filter,
      })
    : Object.keys(entities);
  entityNames.forEach(entityName => {
    const entityText = String(entityName || '');
    let pos = 0;
    while ((pos = entityText.toLowerCase().indexOf(needle, pos)) >= 0) {
      matches.push({ kind: 'entity', entityName, text: entityText, start: pos, end: pos + query.length });
      pos += query.length;
    }
    const entityData = entities[entityName] || {};
    props.forEach(propName => {
      const rawValues = Array.isArray(entityData[propName]) ? entityData[propName] : [];
      const values = typeof filterValues === 'function' ? filterValues(rawValues, undefined, ctx?.filter) : rawValues;
      values.forEach(val => {
        const text = _dbSearchValueText(val?.value);
        if (!text) return;
        let valuePos = 0;
        while ((valuePos = text.toLowerCase().indexOf(needle, valuePos)) >= 0) {
          const rawIndex = Math.max(0, rawValues.indexOf(val));
          matches.push({
            kind: 'value',
            entityName,
            propName,
            text,
            start: valuePos,
            end: valuePos + query.length,
            valObj: _dbFindValueRef(dbPath, entityName, propName, val, rawIndex, pivotData),
          });
          valuePos += query.length;
        }
      });
    });
  });
  return matches;
}

function _dbFindClearCurrentMark() {
  document.querySelectorAll('.db-find-current-cell').forEach(el => el.classList.remove('db-find-current-cell'));
  document.querySelectorAll('mark.db-find-current-text').forEach(mark => {
    const parent = mark.parentNode;
    mark.replaceWith(document.createTextNode(mark.textContent || ''));
    parent?.normalize?.();
  });
}

function _dbFindCellForMatch(match) {
  const root = _dbFindRoot(_dbFindState.ctx);
  const row = root.querySelector(`tbody tr[data-entity-name="${_dbFindCssEscape(match.entityName)}"]`)
    || document.querySelector(`tbody tr[data-entity-name="${_dbFindCssEscape(match.entityName)}"]`);
  if (!row) return null;
  if (match.kind === 'entity') return row.querySelector('.col-entity') || row.firstElementChild;
  return row.querySelector(`td[data-prop-name="${_dbFindCssEscape(match.propName)}"]`);
}

function _dbFindEnsureMatchRendered(match) {
  const ctx = _dbFindState.ctx;
  if (!ctx || !match?.entityName || _dbFindCellForMatch(match)) return false;
  if (typeof _dbRevealVirtualEntityRow === 'function' && _dbRevealVirtualEntityRow(ctx, match.entityName)) return true;
  return false;
}

function _dbFindOccurrenceInCell(match) {
  const index = _dbFindState.index;
  let occurrence = 0;
  for (let i = 0; i < index; i++) {
    const candidate = _dbFindState.matches[i];
    if (candidate.kind !== match.kind || candidate.entityName !== match.entityName) continue;
    if (match.kind === 'value' && candidate.propName !== match.propName) continue;
    occurrence++;
  }
  return occurrence;
}

function _dbFindMarkText(cell, query, occurrence) {
  const needle = String(query || '').toLocaleLowerCase('ja');
  if (!cell || !needle) return null;
  const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent || !node.nodeValue) return NodeFilter.FILTER_REJECT;
      if (parent.closest('mark.db-find-current-text,button,input,textarea,select,script,style')) {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  let remaining = Math.max(0, Number(occurrence) || 0);
  let node;
  while ((node = walker.nextNode())) {
    const text = String(node.nodeValue || '');
    const lower = text.toLocaleLowerCase('ja');
    let offset = 0;
    while (offset <= lower.length - needle.length) {
      const found = lower.indexOf(needle, offset);
      if (found < 0) break;
      if (remaining > 0) {
        remaining--;
        offset = found + Math.max(1, needle.length);
        continue;
      }
      const before = text.slice(0, found);
      const matchText = text.slice(found, found + needle.length);
      const after = text.slice(found + needle.length);
      const mark = document.createElement('mark');
      mark.className = 'db-find-current-text';
      mark.textContent = matchText;
      mark.setAttribute('aria-current', 'true');
      const fragment = document.createDocumentFragment();
      if (before) fragment.appendChild(document.createTextNode(before));
      fragment.appendChild(mark);
      if (after) fragment.appendChild(document.createTextNode(after));
      node.replaceWith(fragment);
      return mark;
    }
  }
  return null;
}

function _dbFindRevealCell(match) {
  const cell = match ? _dbFindCellForMatch(match) : null;
  if (!cell) return false;
  cell.classList.add('db-find-current-cell');
  const mark = _dbFindMarkText(cell, _dbFindState.query, _dbFindOccurrenceInCell(match));
  (mark || cell).scrollIntoView({ behavior: 'auto', block: 'center', inline: 'center' });
  if (typeof setActiveCell === 'function' && match.kind === 'value') setActiveCell(cell, { scroll: false });
  return true;
}

function _dbFindRevealWhenRendered(match, attempt = 0) {
  const current = _dbFindState.matches[_dbFindState.index];
  if (!current || current !== match || !_dbFindState.bar?.isConnected) return;
  if (_dbFindRevealCell(match)) return;
  if (attempt < 40) setTimeout(() => _dbFindRevealWhenRendered(match, attempt + 1), attempt < 5 ? 0 : 30);
}

function _dbFindUpdateStatus() {
  const count = _dbFindState.bar?.querySelector?.('[data-db-find-count]');
  if (!count) return;
  const total = _dbFindState.matches.length;
  count.textContent = total ? `${_dbFindState.index + 1}/${total}` : '0/0';
}

function _dbFindShowCurrent() {
  _dbFindClearCurrentMark();
  const match = _dbFindState.matches[_dbFindState.index];
  if (match && _dbFindEnsureMatchRendered(match)) _dbFindRevealWhenRendered(match);
  else if (match && !_dbFindRevealCell(match)) _dbFindRevealWhenRendered(match);
  _dbFindUpdateStatus();
}

function _dbFindRun(direction = 1) {
  const input = _dbFindState.bar?.querySelector?.('[data-db-find-query]');
  const query = String(input?.value || '');
  const sameQuery = query === _dbFindState.query && _dbFindState.matches.length > 0;
  if (!query) {
    _dbFindState.query = '';
    _dbFindState.matches = [];
    _dbFindState.index = -1;
    _dbFindClearCurrentMark();
    _dbFindUpdateStatus();
    return;
  }
  if (!sameQuery) {
    _dbFindState.query = query;
    _dbFindState.matches = _dbFindCollectMatches(query, _dbFindState.ctx, _dbFindState.dbPath);
    _dbFindState.index = direction >= 0 ? 0 : _dbFindState.matches.length - 1;
  } else {
    _dbFindState.index = (_dbFindState.index + (direction >= 0 ? 1 : -1) + _dbFindState.matches.length) % _dbFindState.matches.length;
  }
  if (!_dbFindState.matches.length) _dbFindState.index = -1;
  _dbFindShowCurrent();
}

function closeDbFindReplace() {
  _dbFindClearCurrentMark();
  _dbFindState.bar?.remove?.();
  window.removeEventListener('resize', _positionDbFindBar);
  _dbFindState = { bar: null, ctx: null, dbPath: '', query: '', matches: [], index: -1 };
}

function _setDbFindMode(mode) {
  const replaceMode = String(mode || '').toLowerCase() === 'replace';
  _dbFindState.bar?.classList.toggle('replace-open', replaceMode);
}

function openDbFindReplace(mode = 'find') {
  const ctx = _dbFindCurrentCtx();
  const dbPath = ctx?.dbPath || state.currentDbPath || '';
  if (!dbPath) return false;
  if (_dbFindState.bar) {
    _dbFindState.ctx = ctx;
    _dbFindState.dbPath = dbPath;
    _setDbFindMode(mode);
    _positionDbFindBar();
    _dbFindState.bar.querySelector('[data-db-find-query]')?.focus();
    return true;
  }

  const bar = document.createElement('div');
  bar.className = 'db-find-bar';
  bar.innerHTML = `
    <textarea data-db-find-query rows="1" placeholder="検索..."></textarea>
    <span data-db-find-count class="db-find-count">0/0</span>
    <button type="button" data-db-find-prev title="前へ">↑</button>
    <button type="button" data-db-find-next title="次へ">↓</button>
    <textarea data-db-find-replace rows="1" placeholder="置換..."></textarea>
    <button type="button" data-db-find-replace-one title="置換">置換</button>
    <button type="button" data-db-find-replace-all title="全置換">全置換</button>
    <button type="button" data-db-find-close title="検索を閉じる">×</button>
  `;
  document.body.appendChild(bar);
  _dbFindState = { bar, ctx, dbPath, query: '', matches: [], index: -1 };
  _setDbFindMode(mode);
  _positionDbFindBar();

  const queryInput = bar.querySelector('[data-db-find-query]');
  const replaceInput = bar.querySelector('[data-db-find-replace]');
  const autoResize = (ta) => {
    const lines = String(ta.value || '').split('\n').length;
    ta.rows = Math.min(Math.max(1, lines), 5);
    ta.classList.toggle('multiline', lines > 1);
  };
  let queryComposing = false;
  queryInput.addEventListener('input', () => {
    autoResize(queryInput);
    if (!queryInput.value) _dbFindRun(1);
  });
  queryInput.addEventListener('compositionstart', () => { queryComposing = true; });
  queryInput.addEventListener('compositionend', () => {
    queryComposing = false;
    autoResize(queryInput);
    _dbFindRun(1);
  });
  replaceInput.addEventListener('input', () => autoResize(replaceInput));
  queryInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); closeDbFindReplace(); return; }
    if ((e.ctrlKey || e.metaKey) && String(e.key || '').toLowerCase() === 'h') { e.preventDefault(); _setDbFindMode('replace'); return; }
    if (e.key === 'Enter') {
      if (queryComposing || e.isComposing || e.keyCode === 229) return;
      e.preventDefault();
      _dbFindRun(e.shiftKey ? -1 : 1);
    }
  });
  replaceInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); closeDbFindReplace(); return; }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); _dbFindReplaceCurrent(); }
  });
  bar.querySelector('[data-db-find-prev]').addEventListener('click', () => _dbFindRun(-1));
  bar.querySelector('[data-db-find-next]').addEventListener('click', () => _dbFindRun(1));
  bar.querySelector('[data-db-find-replace-one]').addEventListener('click', () => _dbFindReplaceCurrent());
  bar.querySelector('[data-db-find-replace-all]').addEventListener('click', () => _dbFindReplaceAll());
  bar.querySelector('[data-db-find-close]').addEventListener('click', () => closeDbFindReplace());
  window.addEventListener('resize', _positionDbFindBar, { passive: true });
  setTimeout(() => queryInput.focus(), 0);
  return true;
}

async function _dbFindRefreshAfterChange(preferredIndex = 0) {
  const { dbPath, ctx, query } = _dbFindState;
  if (typeof selectDatabase === 'function') {
    await selectDatabase(dbPath, ctx, {
      silent: true,
      skipRecent: true,
      skipNavPush: true,
      skipSaveLastView: true,
    });
  } else if (typeof renderPivot === 'function') {
    renderPivot(ctx);
  }
  _dbFindState.matches = _dbFindCollectMatches(query, ctx, dbPath);
  _dbFindState.index = _dbFindState.matches.length ? Math.min(Math.max(0, preferredIndex), _dbFindState.matches.length - 1) : -1;
  _dbFindShowCurrent();
}

async function _dbFindRenameEntity(match, nextName) {
  const dbPath = _dbFindState.dbPath;
  const ctx = _dbFindState.ctx;
  const pivotData = _dbFindData(ctx, dbPath);
  const cleanName = String(nextName || '').trim();
  if (!cleanName) throw new Error('エントリ名を空にはできません');
  if (cleanName !== match.entityName && pivotData?.entities && Object.prototype.hasOwnProperty.call(pivotData.entities, cleanName)) {
    throw new Error('同じエントリ名が既にあります: ' + cleanName);
  }
  await window.GbDbEntryIdentity.rename({
    dbPath,
    oldName: match.entityName,
    newName: cleanName,
    path: _entityPath(dbPath, match.entityName, pivotData),
    ctx,
    entryId: pivotData?.entities?.[match.entityName]?._id || '',
  });
  if (typeof _dbUndoRename === 'function') _dbUndoRename(dbPath, match.entityName, cleanName, ctx);
}

async function _dbFindReplaceCurrent() {
  const query = String(_dbFindState.bar?.querySelector?.('[data-db-find-query]')?.value || '');
  if (query !== _dbFindState.query || !_dbFindState.matches.length) _dbFindRun(1);
  const match = _dbFindState.matches[_dbFindState.index];
  if (!match) return;
  const replacement = String(_dbFindState.bar?.querySelector?.('[data-db-find-replace]')?.value || '');
  const nextText = match.text.slice(0, match.start) + replacement + match.text.slice(match.end);
  try {
    if (match.kind === 'entity') {
      await _dbFindRenameEntity(match, nextText);
    } else {
      const oldValue = String(match.valObj.value ?? '');
      await _apiPutValue(match.valObj, { new_value: nextText, __source: 'sheet-find-replace' });
      if (typeof _dbUndoValue === 'function') {
        _dbUndoValue('シート置換: ' + match.propName, match.valObj, oldValue, nextText, undefined, undefined, {
          dbPath: _dbFindState.dbPath,
          ctx: _dbFindState.ctx,
        });
      }
    }
    await _dbFindRefreshAfterChange(_dbFindState.index);
  } catch (e) {
    if (typeof showStatus === 'function') showStatus(e?.message || '置換に失敗しました', true);
  }
}

async function _dbFindReplaceAll() {
  const queryInput = _dbFindState.bar?.querySelector?.('[data-db-find-query]');
  const query = String(queryInput?.value || '');
  if (!_dbFindRegex(query)) return;
  if (query !== _dbFindState.query || !_dbFindState.matches.length) _dbFindRun(1);
  const replacement = String(_dbFindState.bar?.querySelector?.('[data-db-find-replace]')?.value || '');
  const matches = _dbFindCollectMatches(query, _dbFindState.ctx, _dbFindState.dbPath);
  const valueTasks = new Map();
  const entityTasks = new Map();

  matches.forEach(match => {
    if (match.kind === 'entity') {
      entityTasks.set(match.entityName, match.text.replace(_dbFindRegex(query), replacement));
      return;
    }
    const key = [match.valObj.file, match.valObj.property, match.valObj.candidate_index].join('\n');
    if (!valueTasks.has(key)) {
      const oldValue = String(match.valObj.value ?? '');
      valueTasks.set(key, { match, oldValue, nextValue: oldValue.replace(_dbFindRegex(query), replacement) });
    }
  });

  let count = 0;
  try {
    const pivotData = _dbFindData(_dbFindState.ctx, _dbFindState.dbPath);
    const entityNames = new Set(Object.keys(pivotData?.entities || {}));
    const plannedEntityNames = new Set();
    for (const [oldName, rawNewName] of entityTasks.entries()) {
      const newName = String(rawNewName || '').trim();
      if (!newName) throw new Error('エントリ名を空にはできません');
      if (oldName === newName) continue;
      if (plannedEntityNames.has(newName)) throw new Error('置換後のエントリ名が重複します: ' + newName);
      if (entityNames.has(newName)) throw new Error('同じエントリ名が既にあります: ' + newName);
      plannedEntityNames.add(newName);
    }
    for (const item of valueTasks.values()) {
      if (item.oldValue === item.nextValue) continue;
      await _apiPutValue(item.match.valObj, { new_value: item.nextValue, __source: 'sheet-find-replace-all' });
      if (typeof _dbUndoValue === 'function') {
        _dbUndoValue('シート全置換: ' + item.match.propName, item.match.valObj, item.oldValue, item.nextValue, undefined, undefined, {
          dbPath: _dbFindState.dbPath,
          ctx: _dbFindState.ctx,
        });
      }
      count++;
    }
    for (const [oldName, newName] of entityTasks.entries()) {
      if (oldName === newName) continue;
      await _dbFindRenameEntity({ kind: 'entity', entityName: oldName, text: oldName }, newName);
      count++;
    }
    await _dbFindRefreshAfterChange(0);
    if (typeof showStatus === 'function') showStatus(count + '件置換しました');
  } catch (e) {
    if (typeof showStatus === 'function') showStatus(e?.message || '全置換に失敗しました', true);
  }
}

if (typeof window !== 'undefined') {
  window.openDbFindReplace = openDbFindReplace;
  window.closeDbFindReplace = closeDbFindReplace;
}

/* --- 検索モーダル --- */

/**
 * シート横断検索モーダルを表示
 */
function showDbSearchModal(options) {
  const opts = options || {};
  const preferredScope = opts.scope === 'current' ? (state.currentDbPath || '') : (opts.scope || '');
  const returnFocus = typeof opts.returnFocus === 'function'
    ? opts.returnFocus
    : (opts.returnFocus?.isConnected ? opts.returnFocus : null);
  const body = document.createElement('div');
  body.className = 'gb-db-search-body';

  // ヘッダー
  const header = document.createElement('div');
  header.className = 'gb-db-search-controls';

  const input = document.createElement('input');
  input.type = 'text';
  input.dataset.e2eId = 'db-search-input';
  input.placeholder = 'シート横断検索...（エントリ名・列の値）';

  const scopeSelect = document.createElement('select');
  scopeSelect.dataset.e2eId = 'db-search-scope';
  const optAll = document.createElement('option');
  optAll.value = '';
  optAll.textContent = '全シート';
  scopeSelect.appendChild(optAll);
  // 既知のDBを列挙（フォルダツリーのルートから探索）
  _populateDbScopeOptions(scopeSelect);
  if (preferredScope && !Array.from(scopeSelect.options).some(opt => opt.value === preferredScope)) {
    const optCurrent = document.createElement('option');
    optCurrent.value = preferredScope;
    optCurrent.textContent = '現在のシート';
    scopeSelect.insertBefore(optCurrent, scopeSelect.options[1] || null);
  }
  if (preferredScope) {
    scopeSelect.value = preferredScope;
  }

  header.appendChild(input);
  header.appendChild(scopeSelect);
  body.appendChild(header);

  // 結果エリア
  const resultArea = document.createElement('div');
  resultArea.className = 'gb-db-search-results';
  resultArea.dataset.e2eId = 'db-search-results';
  resultArea.innerHTML = '<div style="text-align:center;padding:40px;color:var(--fg2);">キーワードを入力してEnterで検索</div>';
  body.appendChild(resultArea);

  // フッター
  const statusSpan = document.createElement('span');
  statusSpan.className = 'gb-db-search-status';
  statusSpan.dataset.e2eId = 'db-search-status';
  const exportBtn = document.createElement('button');
  exportBtn.type = 'button';
  exportBtn.className = 'gb-btn gb-btn-sm';
  exportBtn.dataset.e2eId = 'db-search-export';
  exportBtn.textContent = 'CSVエクスポート';
  const setExportVisible = visible => {
    exportBtn.dataset.dbSearchExportVisible = visible ? '1' : '0';
    exportBtn.style.display = visible ? '' : 'none';
    const compact = window.matchMedia?.('(max-width: 600px)')?.matches === true;
    statusSpan.style.display = compact && !visible ? 'none' : '';
    closeBtn.style.flex = compact && !visible ? '1 1 100%' : '';
    closeBtn.style.width = compact && !visible ? '100%' : '';
  };
  exportBtn.addEventListener('click', () => _exportDbSearchCsv(lastResults));
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'gb-btn gb-btn-sm';
  closeBtn.dataset.e2eId = 'db-search-close';
  closeBtn.textContent = '閉じる';
  setExportVisible(false);

  let lastResults = [];
  let searchSeq = 0;
  const modalApi = window.GBUI.createModal({
    id: 'database-cross-sheet-search-dialog',
    title: 'シート横断検索',
    body,
    footer: [statusSpan, exportBtn, closeBtn],
    variant: 'standard',
    extraClass: 'gb-db-search-modal',
    geometryKey: 'database-cross-sheet-search',
    initialFocus: '[data-e2e-id="db-search-input"]',
    returnFocus: returnFocus || undefined,
    onClose: () => { searchSeq += 1; },
  });
  const overlay = modalApi.overlay;
  modalApi.footer.classList.add('gb-db-search-footer');
  overlay.classList.add('modal-overlay');
  overlay.dataset.dbSearchDialog = '1';
  const headerClose = modalApi.header.querySelector('.gb-modal-close');
  if (headerClose) headerClose.dataset.e2eId = 'db-search-close-icon';
  closeBtn.addEventListener('click', () => modalApi.close('close-button'));

  // 検索実行
  async function doSearch() {
    const q = input.value.trim();
    const seq = ++searchSeq;
    if (!q) {
      lastResults = [];
      setExportVisible(false);
      resultArea.innerHTML = '<div style="text-align:center;padding:40px;color:var(--fg2);">キーワードを入力してEnterで検索</div>';
      statusSpan.textContent = '';
      return;
    }
    lastResults = [];
    setExportVisible(false);
    statusSpan.textContent = '検索中...';
    resultArea.innerHTML = '';
    try {
      const knownSheetPaths = Array.from(scopeSelect.options).map(option => option.value).filter(Boolean);
      const data = await doDbSearch(q, scopeSelect.value, knownSheetPaths);
      if (seq !== searchSeq) return;
      lastResults = data.entities || [];
      _renderDbSearchResults(resultArea, lastResults, q, entry => {
        modalApi.close('result-select');
        if (entry.db_path) {
          selectDatabase(entry.db_path).then(() => {
            if (entry.path && typeof selectEntity === 'function') selectEntity(entry.path);
          });
        }
      });
      statusSpan.textContent = lastResults.length + '件（' + (data.total_dbs_scanned || '?') + 'シート検索）';
      setExportVisible(lastResults.length > 0);
    } catch (e) {
      if (seq !== searchSeq) return;
      lastResults = [];
      setExportVisible(false);
      resultArea.innerHTML = '<div style="text-align:center;padding:20px;color:var(--red,#d16969);">検索エラー</div>';
      statusSpan.textContent = 'エラー';
    }
  }

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.isComposing) doSearch();
  });
  modalApi.open();
}

/* --- 結果描画 --- */

function _renderDbSearchResults(container, results, query, onSelect) {
  if (results.length === 0) {
    container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--fg2);">一致するエントリなし</div>';
    return;
  }

  const qLower = query.toLowerCase();

  results.forEach(entry => {
    const item = document.createElement('div');
    item.className = 'db-search-result';
    item.dataset.e2eId = 'db-search-result';
    item.tabIndex = 0;

    // エントリ名 + シート名
    const titleRow = document.createElement('div');
    titleRow.className = 'gb-db-search-result-title';
    const nameSpan = document.createElement('span');
    nameSpan.className = 'gb-db-search-result-name';
    nameSpan.style.cssText = 'font-weight:bold;font-size:13px;';
    nameSpan.innerHTML = _highlightMatch(entry.name, qLower);
    titleRow.appendChild(nameSpan);
    const dbBadge = document.createElement('span');
    dbBadge.className = 'gb-db-search-result-badge';
    dbBadge.style.cssText = 'font-size:10px;background:var(--bg4);color:var(--fg2);padding:1px 6px;border-radius:8px;';
    dbBadge.textContent = (entry.root_name ? entry.root_name + '/' : '') + entry.db_name;
    titleRow.appendChild(dbBadge);
    item.appendChild(titleRow);

    // マッチしたプロパティプレビュー
    const props = entry.matched_props || {};
    const propKeys = Object.keys(props).slice(0, 5);
    if (propKeys.length > 0) {
      const propDiv = document.createElement('div');
      propDiv.className = 'gb-db-search-result-props';
      propDiv.style.cssText = 'font-size:11px;color:var(--fg2);margin-top:4px;line-height:1.5;';
      propKeys.forEach(pn => {
        const vals = props[pn] || [];
        const valTexts = vals.slice(0, 3).map(v => _dbSearchValueText(v?.value)).filter(v => v !== '');
        if (valTexts.length > 0) {
          const line = document.createElement('div');
          line.innerHTML = '<b>' + esc(pn) + ':</b> ' + _highlightMatch(valTexts.join(', '), qLower);
          propDiv.appendChild(line);
        }
      });
      item.appendChild(propDiv);
    }

    // クリック → 遷移
    const activate = () => {
      if (typeof onSelect === 'function') onSelect(entry);
    };
    item.addEventListener('click', activate);
    item.addEventListener('keydown', event => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      activate();
    });

    container.appendChild(item);
  });
}

function _highlightMatch(text, qLower) {
  const raw = String(text == null ? '' : text);
  const needle = String(qLower == null ? '' : qLower).toLowerCase();
  if (!needle) return esc(raw);
  const lower = raw.toLowerCase();
  let pos = 0;
  let out = '';
  while (pos < raw.length) {
    const idx = lower.indexOf(needle, pos);
    if (idx < 0) break;
    out += esc(raw.slice(pos, idx));
    out += '<span style="background:var(--accent);color:var(--ui-accent-fg, var(--ui-fg-strong));padding:0 2px;border-radius:2px;">'
      + esc(raw.slice(idx, idx + needle.length))
      + '</span>';
    pos = idx + needle.length;
  }
  out += esc(raw.slice(pos));
  return out;
}

function _dbSearchValueText(value) {
  if (value == null) return '';
  if (Array.isArray(value)) return value.map(v => _dbSearchValueText(v)).join(', ');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function _dbSearchCsvSafeValue(value) {
  const text = _dbSearchValueText(value);
  return /^[\s]*[=+\-@]/.test(text) ? "'" + text : text;
}

function _dbSearchCsvCell(value) {
  const text = _dbSearchCsvSafeValue(value);
  return '"' + text.replace(/"/g, '""') + '"';
}

/* --- DBスコープ選択肢を列挙 --- */

function _populateDbScopeOptions(select) {
  // フォルダツリーのツリーからDB型ノードを収集（_nodeDataベース）
  const seen = new Set();
  document.querySelectorAll('#outliner-tree .tree-node').forEach(node => {
    const nd = node._nodeData;
    if (!nd || nd.type !== 'database' || !nd.path) return;
    if (seen.has(nd.path)) return;
    seen.add(nd.path);
    const opt = document.createElement('option');
    opt.value = nd.path;
    opt.textContent = nd.name || nd.path.split('/').pop();
    select.appendChild(opt);
  });
}

/* --- CSVエクスポート --- */

async function _exportDbSearchCsv(results) {
  if (!results || results.length === 0) return;

  // 全プロパティ名を収集
  const allProps = new Set();
  results.forEach(entry => {
    Object.keys(entry.matched_props || {}).forEach(p => allProps.add(p));
  });
  const propList = [...allProps];

  // CSV生成
  const rows = [];
  const header = ['エントリ名', 'シート名', 'ルート', ...propList];
  rows.push(header.map(h => _dbSearchCsvCell(h)).join(','));

  results.forEach(entry => {
    const row = [
      entry.name,
      entry.db_name,
      entry.root_name || '',
    ];
    propList.forEach(p => {
      const vals = (entry.matched_props || {})[p] || [];
      row.push(vals.map(v => _dbSearchValueText(v?.value)).join('; '));
    });
    rows.push(row.map(v => _dbSearchCsvCell(v)).join(','));
  });

  if (typeof MeldexExportSave === 'undefined' || typeof MeldexExportSave.saveText !== 'function') {
    showStatus('保存ダイアログを初期化できませんでした', true);
    return;
  }
  await MeldexExportSave.saveText(rows.join('\n'), {
    filename: 'db-search-results.csv',
    extension: '.csv',
    dialogTitle: '検索結果CSVとして保存',
    filetypes: [['CSVファイル', '*.csv'], ['すべてのファイル', '*.*']],
    bom: true,
    okMessage: '検索結果CSVを保存しました',
    errorMessage: '検索結果CSVの保存に失敗しました',
  });
}
