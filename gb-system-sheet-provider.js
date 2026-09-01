(function () {
  'use strict';

  const providers = new Map();
  const viewStateKey = (providerId, scopeId) => `meldex:system-sheet-view:v1:${providerId}:${scopeId}`;

  function safeViewState(providerId, scopeId) {
    try {
      const parsed = JSON.parse(localStorage.getItem(viewStateKey(providerId, scopeId)) || '{}');
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  function saveViewState(providerId, scopeId, value) {
    try { localStorage.setItem(viewStateKey(providerId, scopeId), JSON.stringify(value || {})); } catch {}
  }

  function registerSystemSheetProvider(provider) {
    const id = String(provider?.providerId || '').trim();
    if (!id || typeof provider.fetchPage !== 'function' || typeof provider.openRow !== 'function') {
      throw new TypeError('システムシート供給元の契約が不正です');
    }
    const rawFetchPage = provider.fetchPage.bind(provider);
    const normalized = Object.freeze({
      ...provider,
      providerId: id,
      columns: Object.freeze([...(provider.columns || [])].map(column => Object.freeze({ ...column }))),
      capabilities: Object.freeze({ readOnly: true, canSaveDocument: false, canMutateRows: false }),
      async fetchPage(request = {}) {
        const result = await rawFetchPage(request);
        const rows = applyLocalQuery(Array.isArray(result?.rows) ? result.rows : [], request, provider.columns || []);
        const offset = Math.max(0, Number.parseInt(request.cursor || '0', 10) || 0);
        const limit = Math.max(1, Math.min(Number(request.limit || 100), 500));
        const page = rows.slice(offset, offset + limit);
        return {
          ...result,
          rows: page,
          total: rows.length,
          nextCursor: offset + page.length < rows.length ? String(offset + page.length) : null,
        };
      },
    });
    providers.set(id, normalized);
    return normalized;
  }

  function applyLocalQuery(rows, request, columns) {
    const allowed = new Set(columns.map(column => String(column?.id || '')));
    const query = String(request.query || '').trim().toLocaleLowerCase('ja-JP');
    const filters = Array.isArray(request.localFilter) ? request.localFilter : [];
    const filtered = rows.filter(row => {
      if (query && !columns.some(column => String(row?.[column.id] ?? '').toLocaleLowerCase('ja-JP').includes(query))) return false;
      return filters.every(filter => {
      const column = String(filter?.column || filter?.property || '');
      if (!allowed.has(column)) return true;
      const left = String(row?.[column] ?? '').toLocaleLowerCase('ja-JP');
      const right = String(filter?.value ?? '').toLocaleLowerCase('ja-JP');
      const operation = String(filter?.operator || 'contains');
      if (operation === 'empty' || operation === 'is_null') return !left;
      if (operation === 'not_empty' || operation === 'not_null') return !!left;
      if (operation === 'equals') return left === right;
      if (operation === 'not_equals') return left !== right;
      if (operation === 'not_contains') return !left.includes(right);
      if (operation === 'greater_than') return Number(row?.[column]) > Number(filter?.value);
      if (operation === 'less_than') return Number(row?.[column]) < Number(filter?.value);
      if (operation === 'after') return left > right;
      if (operation === 'before') return left < right;
      return left.includes(right);
      });
    });
    const sort = request.sort || {};
    const sortColumn = String(sort.column || sort.key || '');
    if (!allowed.has(sortColumn)) return filtered;
    const direction = String(sort.direction || sort.dir || 'asc') === 'desc' ? -1 : 1;
    return filtered.slice().sort((left, right) => String(left?.[sortColumn] ?? '').localeCompare(String(right?.[sortColumn] ?? ''), 'ja', { numeric: true }) * direction);
  }

  function getSystemSheetProvider(providerId) {
    return providers.get(String(providerId || '').trim()) || null;
  }

  function preferredPaneId(options = {}) {
    if (options.paneId) return String(options.paneId);
    if (typeof GBPaneDefaultLayout !== 'undefined' && typeof GBPaneDefaultLayout.resolveMainPaneId === 'function') {
      const mainPaneId = GBPaneDefaultLayout.resolveMainPaneId({ contentOnly: true });
      if (mainPaneId) return mainPaneId;
    }
    if (typeof GBLayout !== 'undefined' && GBLayout.activePane) return GBLayout.activePane;
    return typeof GBLayout !== 'undefined' ? GBLayout.findFirstPane?.(GBLayout.root)?.id || '' : '';
  }

  function openSystemSheetTab(detail, options = {}) {
    if (typeof GBTabs === 'undefined' || typeof GBTabs.addTab !== 'function') return null;
    const paneId = preferredPaneId(options);
    if (!paneId) return null;
    const path = `system-sheet:${detail.providerId}:${detail.scopeId}`;
    const state = {
      providerId: detail.providerId,
      scopeId: detail.scopeId,
      title: detail.title,
      scope: detail.scope,
      viewState: detail.viewState,
    };
    const tabId = GBTabs.addTab(paneId, detail.title || 'システムシート', 'system-sheet', path, state, {
      preferTargetPane: !!options.preferTargetPane,
      forceNewTab: !!options.forceNewTab,
    });
    const component = typeof getComponentInstance === 'function' ? getComponentInstance(tabId) : null;
    if (component && typeof component.restoreState === 'function') {
      component.restoreState(state);
      component.activate?.();
    }
    return tabId;
  }

  function openSystemSheet(providerId, scopeId, options = {}) {
    const provider = getSystemSheetProvider(providerId);
    if (!provider) throw new Error(`システムシート供給元が見つかりません: ${providerId}`);
    const detail = {
      provider,
      providerId: provider.providerId,
      scopeId: String(scopeId || ''),
      title: String(options.title || provider.title || ''),
      scope: options.scope || {},
      viewState: safeViewState(provider.providerId, String(scopeId || '')),
      saveViewState(value) { saveViewState(provider.providerId, String(scopeId || ''), value); },
    };
    detail.tabId = openSystemSheetTab(detail, options);
    window.dispatchEvent(new CustomEvent('meldex:open-system-sheet', { detail }));
    return detail;
  }

  function createElement(tagName, className, text) {
    const element = document.createElement(tagName);
    if (className) element.className = className;
    if (text != null) element.textContent = String(text);
    return element;
  }

  function displayValue(value, column) {
    if (value == null || value === '') return '';
    if (column?.type === 'number' && Number.isFinite(Number(value))) return Number(value).toLocaleString('ja-JP');
    if (Array.isArray(value)) return value.join(', ');
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  }

  class SystemSheetComponent extends ToolComponent {
    constructor(paneId, tabId) {
      super(paneId, tabId);
      this._requestSerial = 0;
      this._rows = [];
      this._nextCursor = null;
    }

    create() {
      this.el = createElement('section', 'gb-system-sheet');
      this.el.style.cssText = 'display:flex;flex:1;min-width:0;min-height:0;flex-direction:column;background:var(--bg);color:var(--fg);overflow:hidden;';
      this.el.setAttribute('aria-label', '読み取り専用システムシート');
      this._toolbar = createElement('div', 'gb-system-sheet-toolbar');
      this._toolbar.style.cssText = 'display:flex;align-items:center;gap:8px;min-height:44px;padding:6px 10px;border-bottom:1px solid var(--border);flex-wrap:wrap;';
      this._title = createElement('strong', 'gb-system-sheet-title');
      this._title.style.cssText = 'min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
      this._readonly = createElement('span', 'gb-system-sheet-readonly', '読み取り専用');
      this._readonly.style.cssText = 'font-size:11px;color:var(--fg2);white-space:nowrap;';
      this._search = createElement('input', 'gb-system-sheet-search');
      this._search.type = 'search';
      this._search.placeholder = 'このシート内を検索';
      this._search.setAttribute('aria-label', 'このシート内を検索');
      this._search.style.cssText = 'margin-left:auto;min-width:120px;max-width:260px;width:34%;height:44px;padding:0 10px;border:1px solid var(--border);border-radius:6px;background:var(--bg2);color:var(--fg);';
      this._refresh = createElement('button', 'gb-system-sheet-refresh', '更新');
      this._refresh.type = 'button';
      this._refresh.style.cssText = 'min-width:44px;min-height:44px;';
      this._columnsButton = createElement('button', 'gb-system-sheet-columns', '列');
      this._columnsButton.type = 'button';
      this._columnsButton.setAttribute('aria-expanded', 'false');
      this._columnsButton.style.cssText = 'min-width:44px;min-height:44px;';
      this._filtersButton = createElement('button', 'gb-system-sheet-filters', '絞込');
      this._filtersButton.type = 'button';
      this._filtersButton.setAttribute('aria-expanded', 'false');
      this._filtersButton.style.cssText = 'min-width:44px;min-height:44px;';
      this._toolbar.append(this._title, this._readonly, this._search, this._columnsButton, this._filtersButton, this._refresh);
      this._controls = createElement('div', 'gb-system-sheet-controls');
      this._controls.hidden = true;
      this._controls.style.cssText = 'padding:8px 10px;border-bottom:1px solid var(--border);background:var(--bg2);overflow:auto;';
      this._status = createElement('div', 'gb-system-sheet-status');
      this._status.style.cssText = 'min-height:28px;padding:5px 10px;color:var(--fg2);font-size:12px;border-bottom:1px solid var(--border);';
      this._scroll = createElement('div', 'gb-system-sheet-scroll');
      this._scroll.style.cssText = 'flex:1;min-height:0;overflow:auto;';
      this._loadMore = createElement('button', 'gb-system-sheet-load-more', 'さらに表示');
      this._loadMore.type = 'button';
      this._loadMore.style.cssText = 'display:none;align-self:center;min-height:44px;margin:8px;padding:0 16px;';
      this.el.append(this._toolbar, this._controls, this._status, this._scroll, this._loadMore);
      this._search.addEventListener('input', () => this._onSearch());
      this._refresh.addEventListener('click', () => this._load({ refresh: true }));
      this._columnsButton.addEventListener('click', () => this._showColumnControls());
      this._filtersButton.addEventListener('click', () => this._showFilterControls());
      this._loadMore.addEventListener('click', () => this._load({ append: true, cursor: this._nextCursor }));
      return this.el;
    }

    restoreState(savedState) {
      const previousProvider = this.state?.providerId;
      const previousScope = this.state?.scopeId;
      super.restoreState(savedState);
      const viewState = this.state?.viewState || {};
      if (this._title) this._title.textContent = this.state?.title || 'システムシート';
      if (this._search) this._search.value = String(viewState.query || '');
      if (this._active && (previousProvider !== this.state?.providerId || previousScope !== this.state?.scopeId)) this._load();
    }

    getState() {
      return {
        ...this.state,
        viewState: { ...(this.state?.viewState || {}), query: String(this._search?.value || '') },
      };
    }

    activate() {
      super.activate();
      if (!this._loadedKey || this._loadedKey !== this._currentKey()) this._load();
    }

    _currentKey() {
      return `${this.state?.providerId || ''}:${this.state?.scopeId || ''}`;
    }

    _provider() {
      return getSystemSheetProvider(this.state?.providerId);
    }

    _saveViewState(patch) {
      this.state.viewState = { ...(this.state.viewState || {}), ...(patch || {}) };
      saveViewState(this.state.providerId, this.state.scopeId, this.state.viewState);
    }

    _visibleColumns(provider) {
      const hidden = new Set(Array.isArray(this.state.viewState?.hiddenColumns) ? this.state.viewState.hiddenColumns : []);
      const visible = provider.columns.filter(column => !hidden.has(column.id));
      return visible.length ? visible : provider.columns.slice(0, 1);
    }

    _closeControls() {
      this._controls.hidden = true;
      this._columnsButton.setAttribute('aria-expanded', 'false');
      this._filtersButton.setAttribute('aria-expanded', 'false');
    }

    _openControls(kind, label) {
      this._controls.replaceChildren();
      this._controls.hidden = false;
      this._controls.setAttribute('role', 'group');
      this._controls.setAttribute('aria-label', label);
      this._columnsButton.setAttribute('aria-expanded', kind === 'columns' ? 'true' : 'false');
      this._filtersButton.setAttribute('aria-expanded', kind === 'filters' ? 'true' : 'false');
      const close = createElement('button', 'gb-system-sheet-controls-close', '閉じる');
      close.type = 'button';
      close.style.cssText = 'min-width:44px;min-height:44px;margin-left:auto;';
      close.addEventListener('click', () => this._closeControls());
      return close;
    }

    _showColumnControls() {
      if (!this._controls.hidden && this._columnsButton.getAttribute('aria-expanded') === 'true') return this._closeControls();
      const provider = this._provider();
      if (!provider) return;
      const close = this._openControls('columns', '表示する列');
      const row = createElement('div', 'gb-system-sheet-column-options');
      row.style.cssText = 'display:flex;align-items:center;gap:8px;flex-wrap:wrap;';
      const hidden = new Set(Array.isArray(this.state.viewState?.hiddenColumns) ? this.state.viewState.hiddenColumns : []);
      provider.columns.forEach(column => {
        const label = createElement('label');
        label.style.cssText = 'display:flex;align-items:center;gap:5px;min-height:44px;';
        const input = createElement('input');
        input.type = 'checkbox';
        input.checked = !hidden.has(column.id);
        input.addEventListener('change', () => {
          const next = new Set(Array.isArray(this.state.viewState?.hiddenColumns) ? this.state.viewState.hiddenColumns : []);
          if (input.checked) next.delete(column.id); else next.add(column.id);
          if (next.size >= provider.columns.length) {
            input.checked = true;
            next.delete(column.id);
          }
          this._saveViewState({ hiddenColumns: [...next] });
          this._render(provider, { unreadableCount: 0 });
        });
        label.append(input, document.createTextNode(column.label || column.id));
        row.appendChild(label);
      });
      row.appendChild(close);
      this._controls.appendChild(row);
    }

    _showFilterControls() {
      if (!this._controls.hidden && this._filtersButton.getAttribute('aria-expanded') === 'true') return this._closeControls();
      const provider = this._provider();
      if (!provider) return;
      const close = this._openControls('filters', '複合フィルター');
      const list = createElement('div', 'gb-system-sheet-filter-list');
      list.style.cssText = 'display:grid;gap:6px;';
      const filters = (Array.isArray(this.state.viewState?.localFilter) ? this.state.viewState.localFilter : []).map(item => ({ ...item }));
      const render = () => {
        list.replaceChildren();
        filters.forEach((filter, index) => list.appendChild(this._filterRow(provider, filters, filter, index, render)));
      };
      render();
      const actions = createElement('div');
      actions.style.cssText = 'display:flex;align-items:center;gap:8px;margin-top:8px;';
      const add = createElement('button', '', '条件を追加');
      add.type = 'button';
      add.style.cssText = 'min-height:44px;';
      add.addEventListener('click', () => { filters.push({ column: provider.columns[0]?.id || '', operator: 'contains', value: '' }); render(); });
      const apply = createElement('button', '', '適用');
      apply.type = 'button';
      apply.style.cssText = 'min-width:52px;min-height:44px;';
      apply.addEventListener('click', () => {
        this._saveViewState({ localFilter: filters.filter(item => item.column && (item.value || ['empty', 'not_empty'].includes(item.operator))) });
        this._closeControls();
        this._load();
      });
      actions.append(add, apply, close);
      this._controls.append(list, actions);
    }

    _filterRow(provider, filters, filter, index, render) {
      const row = createElement('div', 'gb-system-sheet-filter-row');
      row.style.cssText = 'display:grid;grid-template-columns:minmax(110px,1fr) minmax(110px,1fr) minmax(120px,2fr) auto;gap:6px;';
      const column = createElement('select');
      column.style.minHeight = '44px';
      column.setAttribute('aria-label', `条件${index + 1}の列`);
      provider.columns.forEach(item => { const option = createElement('option', '', item.label || item.id); option.value = item.id; column.appendChild(option); });
      column.value = filter.column || provider.columns[0]?.id || '';
      column.addEventListener('change', () => { filter.column = column.value; });
      const operator = createElement('select');
      operator.style.minHeight = '44px';
      operator.setAttribute('aria-label', `条件${index + 1}の比較`);
      [['contains', '含む'], ['not_contains', '含まない'], ['equals', '等しい'], ['not_equals', '等しくない'], ['empty', '空欄'], ['not_empty', '空欄でない'], ['greater_than', 'より大きい'], ['less_than', 'より小さい'], ['after', 'より後'], ['before', 'より前']].forEach(([value, label]) => { const option = createElement('option', '', label); option.value = value; operator.appendChild(option); });
      operator.value = filter.operator || 'contains';
      operator.addEventListener('change', () => { filter.operator = operator.value; value.disabled = ['empty', 'not_empty'].includes(operator.value); });
      const value = createElement('input');
      value.type = 'text';
      value.style.minHeight = '44px';
      value.value = String(filter.value || '');
      value.setAttribute('aria-label', `条件${index + 1}の値`);
      value.disabled = ['empty', 'not_empty'].includes(operator.value);
      value.addEventListener('input', () => { filter.value = value.value; });
      const remove = createElement('button', '', '削除');
      remove.type = 'button';
      remove.setAttribute('aria-label', `条件${index + 1}を削除`);
      remove.style.cssText = 'min-width:44px;min-height:44px;';
      remove.addEventListener('click', () => { filters.splice(index, 1); render(); });
      row.append(column, operator, value, remove);
      return row;
    }

    _onSearch() {
      clearTimeout(this._searchTimer);
      this._searchTimer = setTimeout(() => {
        this.state.viewState = { ...(this.state.viewState || {}), query: String(this._search.value || '') };
        saveViewState(this.state.providerId, this.state.scopeId, this.state.viewState);
        this._load();
      }, 180);
    }

    async _load(options = {}) {
      const provider = this._provider();
      if (!provider) return this._showError('システムシートの供給元を読み込めませんでした');
      const serial = ++this._requestSerial;
      this._status.textContent = '読み込み中…';
      this._refresh.disabled = true;
      try {
        const result = await provider.fetchPage({
          scope: this.state.scope || {},
          cursor: options.cursor || null,
          limit: 100,
          query: String(this._search?.value || ''),
          refresh: !!options.refresh,
          sort: this.state.viewState?.sort || null,
          localFilter: this.state.viewState?.localFilter || [],
        });
        if (serial !== this._requestSerial) return;
        this._rows = options.append ? this._rows.concat(result.rows || []) : (result.rows || []);
        this._nextCursor = result.nextCursor || null;
        this._loadedKey = this._currentKey();
        this._render(provider, result);
      } catch (error) {
        if (serial === this._requestSerial) this._showError(error?.message || 'システムシートを読み込めませんでした');
      } finally {
        if (serial === this._requestSerial) this._refresh.disabled = false;
      }
    }

    _render(provider, result) {
      this._scroll.replaceChildren();
      this._status.style.color = '';
      const table = createElement('table', 'gb-system-sheet-table');
      table.style.cssText = 'width:max-content;min-width:100%;border-collapse:collapse;font-size:13px;';
      const thead = createElement('thead');
      const headerRow = createElement('tr');
      const visibleColumns = this._visibleColumns(provider);
      const activeSort = this.state.viewState?.sort || {};
      visibleColumns.forEach(column => {
        const cell = createElement('th');
        cell.scope = 'col';
        cell.style.cssText = 'position:sticky;top:0;z-index:1;padding:8px 10px;text-align:left;white-space:nowrap;background:var(--bg2);border:1px solid var(--border);';
        const sortButton = createElement('button', '', `${column.label || column.id}${activeSort.column === column.id ? (activeSort.direction === 'desc' ? ' ↓' : ' ↑') : ''}`);
        sortButton.type = 'button';
        sortButton.style.cssText = 'min-height:44px;border:0;background:transparent;color:inherit;font:inherit;font-weight:600;cursor:pointer;';
        sortButton.setAttribute('aria-label', `${column.label || column.id}を${activeSort.column === column.id && activeSort.direction === 'asc' ? '降順' : '昇順'}に並べ替え`);
        sortButton.addEventListener('click', () => {
          const direction = activeSort.column === column.id && activeSort.direction === 'asc' ? 'desc' : 'asc';
          this._saveViewState({ sort: { column: column.id, direction } });
          this._load();
        });
        cell.appendChild(sortButton);
        headerRow.appendChild(cell);
      });
      thead.appendChild(headerRow);
      table.appendChild(thead);
      const tbody = createElement('tbody');
      this._rows.forEach(row => tbody.appendChild(this._renderRow(provider, row, visibleColumns)));
      table.appendChild(tbody);
      this._scroll.appendChild(table);
      if (!this._rows.length) this._scroll.appendChild(createElement('p', 'gb-system-sheet-empty', '表示できる項目はありません'));
      const unreadable = Number(result.unreadableCount || 0);
      this._status.textContent = `${this._rows.length}件を表示${unreadable ? `（読み込めなかった項目: ${unreadable}件）` : ''}`;
      this._loadMore.style.display = this._nextCursor ? '' : 'none';
    }

    _renderRow(provider, row, visibleColumns) {
      const tr = createElement('tr');
      tr.tabIndex = 0;
      tr.style.cursor = 'pointer';
      tr.addEventListener('click', () => provider.openRow(row, { scope: this.state.scope || {} }));
      tr.addEventListener('keydown', event => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        provider.openRow(row, { scope: this.state.scope || {} });
      });
      visibleColumns.forEach(column => {
        const td = createElement('td', '', displayValue(row?.[column.id], column));
        td.style.cssText = 'max-width:360px;padding:8px 10px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;border:1px solid var(--border);';
        tr.appendChild(td);
      });
      return tr;
    }

    _showError(message) {
      this._status.textContent = String(message || '読み込みに失敗しました');
      this._status.style.color = 'var(--danger, #c33)';
      this._loadMore.style.display = 'none';
    }

    destroy() {
      clearTimeout(this._searchTimer);
      this._requestSerial += 1;
      super.destroy();
    }
  }

  function queryParams(scope) {
    const params = new URLSearchParams();
    if (scope.workspaceId) params.set('workspace_id', scope.workspaceId);
    else if (scope.sourceFolder) params.set('source_folder', scope.sourceFolder);
    return params.toString();
  }

  const chatHistory = registerSystemSheetProvider({
    providerId: 'chat-history',
    title: 'チャット履歴',
    columns: [
      ['title', 'タイトル', 'text'], ['created', '作成日時', 'date'], ['modified', '最終更新日時', 'date'],
      ['targetPath', '対象ファイル', 'link'], ['provider', 'プロバイダー', 'text'], ['model', 'モデル', 'text'],
      ['messageCount', 'メッセージ数', 'number'], ['path', '履歴ファイルの保存場所', 'link'],
    ].map(([id, label, type]) => ({ id, label, type })),
    async fetchPage(request = {}) {
      const query = queryParams(request.scope || {});
      const data = await apiFetch('/chat/history' + (query ? `?${query}` : ''));
      return { rows: Array.isArray(data?.items) ? data.items : [], total: Number(data?.total || 0), unreadableCount: Number(data?.unreadableCount || 0) };
    },
    openRow(row, request = {}) {
      if (typeof openSavedChat !== 'function') return false;
      if (!request.scope?.workspaceId && !request.scope?.sourceFolder) {
        openSavedChat(String(row?.path || ''));
        return true;
      }
      openSavedChat(row?.path, '', request.scope?.workspaceId ? undefined : request.scope?.sourceFolder);
      return true;
    },
  });

  const allFiles = registerSystemSheetProvider({
    providerId: 'all-files',
    title: '全ファイル',
    columns: [
      ['name', 'ファイル名', 'text'], ['category', '種別', 'text'], ['root_name', 'ソースフォルダ', 'text'],
      ['root_type', 'ルート種別', 'text'], ['ext', '拡張子', 'text'], ['path', '実態パス', 'link'],
      ['size', 'ファイルサイズ', 'number'], ['modified', '更新日時', 'date'],
      ['backlink_file_count', '被リンク数（ファイル）', 'number'], ['backlink_board_count', '被リンク数（ボード）', 'number'],
    ].map(([id, label, type]) => ({ id, label, type })),
    async fetchPage(request = {}) {
      const data = await apiFetch('/global-index' + (request.refresh ? '?refresh=1' : ''));
      return { rows: Array.isArray(data?.files) ? data.files : [], total: Number(data?.total || 0), unreadableCount: Number(data?.unreadableCount || 0) };
    },
    openRow(row) {
      const path = row?.abs_path || row?.path;
      if (!path || typeof openLink !== 'function') return false;
      openLink(path, row?.name || String(path).split(/[\\/]/).pop());
      return true;
    },
  });

  async function openChatHistorySheet(options = {}) {
    const scope = {
      sourceFolder: typeof _chatSourceFolderValue === 'function' ? _chatSourceFolderValue() : '',
      workspaceId: typeof _chatWorkspaceIdValue === 'function' ? _chatWorkspaceIdValue() : '',
    };
    if (!scope.sourceFolder && !scope.workspaceId) {
      if (typeof _chatRequireSourceFolder === 'function') _chatRequireSourceFolder();
      return false;
    }
    const scopeId = scope.workspaceId ? `workspace:${scope.workspaceId}` : `source:${scope.sourceFolder}`;
    return openSystemSheet(chatHistory.providerId, scopeId, { ...options, title: chatHistory.title, scope });
  }

  function openAllFilesSheet(options = {}) {
    return openSystemSheet(allFiles.providerId, String(options.scopeId || 'all-roots'), { ...options, title: allFiles.title });
  }

  window.MeldexSystemSheets = Object.freeze({ registerSystemSheetProvider, getSystemSheetProvider, openSystemSheet });
  window.openChatHistorySheet = openChatHistorySheet;
  window.openAllFilesSheet = openAllFilesSheet;
  if (typeof registerToolComponent === 'function') {
    registerToolComponent('system-sheet', { cls: SystemSheetComponent, icon: 'db', label: 'システムシート', multi: true });
  }
})();
