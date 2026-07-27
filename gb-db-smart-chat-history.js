/* 読み取り専用システムスマートシート「チャット履歴」 */

(function () {
  'use strict';

  const COLUMN_META = {
    title: { label: 'タイトル', operators: ['contains', 'not_contains', 'equals', 'not_equals', 'empty', 'not_empty'] },
    created: { label: '作成日時', operators: ['after', 'before', 'equals', 'empty', 'not_empty'] },
    modified: { label: '最終更新日時', operators: ['after', 'before', 'equals', 'empty', 'not_empty'] },
    targetPath: { label: '対象ファイル', operators: ['contains', 'not_contains', 'equals', 'not_equals', 'empty', 'not_empty'] },
    provider: { label: 'プロバイダー', operators: ['contains', 'not_contains', 'equals', 'not_equals', 'empty', 'not_empty'] },
    model: { label: 'モデル', operators: ['contains', 'not_contains', 'equals', 'not_equals', 'empty', 'not_empty'] },
    messageCount: { label: 'メッセージ数', operators: ['equals', 'greater_than', 'less_than'] },
    path: { label: '履歴ファイルの保存場所', operators: ['contains', 'not_contains', 'equals', 'not_equals'] },
  };
  const DEFAULT_COLUMNS = Object.keys(COLUMN_META);
  const OPERATOR_LABELS = {
    contains: '含む',
    not_contains: '含まない',
    equals: '等しい',
    not_equals: '等しくない',
    empty: '空',
    not_empty: '空でない',
    after: 'より後',
    before: 'より前',
    greater_than: 'より大きい',
    less_than: 'より小さい',
  };

  function _isChatHistoryDef(def) {
    return def?.sourceType === 'chat-history';
  }

  function _scopeValues() {
    return {
      sourceFolder: typeof _chatSourceFolderValue === 'function' ? _chatSourceFolderValue() : '',
      workspaceId: typeof _chatWorkspaceIdValue === 'function' ? _chatWorkspaceIdValue() : '',
    };
  }

  function _scopeKey(scope) {
    return scope.workspaceId ? `workspace:${scope.workspaceId}` : `source:${scope.sourceFolder}`;
  }

  function _scopeId(scope) {
    const key = _scopeKey(scope);
    const suffix = typeof _smartDbStableIdPart === 'function'
      ? _smartDbStableIdPart(key)
      : encodeURIComponent(key).replace(/%/g, '').slice(0, 64);
    return `system-chat-history-${suffix}`;
  }

  function _historyUrl(def) {
    const params = new URLSearchParams();
    if (def.workspaceId) params.set('workspace_id', def.workspaceId);
    else if (def.sourceFolder) params.set('source_folder', def.sourceFolder);
    const query = params.toString();
    return '/chat/history' + (query ? `?${query}` : '');
  }

  function _dateLabel(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) return raw;
    return parsed.toLocaleString('ja-JP', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
  }

  function _calendarDateKey(value) {
    const raw = String(value || '').trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) return raw.slice(0, 10);
    const pad = number => String(number).padStart(2, '0');
    return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}`;
  }

  function _titleLabel(item) {
    const title = String(item?.title || '').trim();
    if (title) return title;
    const name = String(item?.path || '').split(/[\\/]/).pop() || '';
    return name.replace(/\.md$/i, '') || '無題のチャット';
  }

  function _displayValue(item, column) {
    if (column === 'title') return _titleLabel(item);
    if (column === 'created' || column === 'modified') return _dateLabel(item?.[column]);
    if (column === 'messageCount') return String(Number(item?.messageCount || 0));
    return String(item?.[column] || '');
  }

  function _filterMatch(filter, item) {
    const column = filter?.column;
    if (!COLUMN_META[column]) return true;
    const raw = column === 'title' ? _titleLabel(item) : item?.[column];
    const operation = filter.operator || 'contains';
    const expected = String(filter.value == null ? '' : filter.value).trim();
    const text = String(raw == null ? '' : raw);
    const normalized = text.toLocaleLowerCase('ja-JP');
    const normalizedExpected = expected.toLocaleLowerCase('ja-JP');
    if (operation === 'empty') return !text.trim();
    if (operation === 'not_empty') return !!text.trim();
    if (operation === 'contains') return normalized.includes(normalizedExpected);
    if (operation === 'not_contains') return !normalized.includes(normalizedExpected);
    if (operation === 'equals') {
      if (column === 'messageCount') return Number(raw || 0) === Number(expected);
      if ((column === 'created' || column === 'modified') && /^\d{4}-\d{2}-\d{2}$/.test(expected)) {
        return _calendarDateKey(text) === expected;
      }
      return normalized === normalizedExpected;
    }
    if (operation === 'not_equals') return normalized !== normalizedExpected;
    if (operation === 'greater_than') return Number(raw || 0) > Number(expected);
    if (operation === 'less_than') return Number(raw || 0) < Number(expected);
    if (operation === 'after' || operation === 'before') {
      const actualTime = Date.parse(text);
      const expectedTime = Date.parse(expected);
      const left = Number.isFinite(actualTime) ? actualTime : text;
      const right = Number.isFinite(expectedTime) ? expectedTime : expected;
      return operation === 'after' ? left > right : left < right;
    }
    return true;
  }

  function _filteredRows(items, def) {
    const filters = Array.isArray(def.filters) ? def.filters : [];
    return (Array.isArray(items) ? items : []).filter(item => filters.every(filter => _filterMatch(filter, item)));
  }

  function _sortValue(item, column) {
    const raw = column === 'title' ? _titleLabel(item) : item?.[column];
    if (column === 'messageCount') return Number(raw || 0);
    if (column === 'created' || column === 'modified') {
      const timestamp = Date.parse(raw);
      if (Number.isFinite(timestamp)) return timestamp;
    }
    return String(raw == null ? '' : raw);
  }

  function _sortedRows(items, def) {
    const column = COLUMN_META[def.sortBy] ? def.sortBy : 'modified';
    const direction = def.sortDir === 'asc' ? 1 : -1;
    return items.slice().sort((a, b) => {
      const left = _sortValue(a, column);
      const right = _sortValue(b, column);
      const leftEmpty = left === '';
      const rightEmpty = right === '';
      if (leftEmpty !== rightEmpty) return leftEmpty ? 1 : -1;
      if (typeof left === 'number' && typeof right === 'number') return (left - right) * direction;
      return String(left).localeCompare(String(right), 'ja', { numeric: true, sensitivity: 'base' }) * direction;
    });
  }

  function _visibleColumns(def) {
    const columns = Array.isArray(def.columns) ? def.columns.filter(column => COLUMN_META[column]) : [];
    return columns.length ? columns : DEFAULT_COLUMNS.slice();
  }

  function _bindKeyboardActivate(element, callback) {
    if (typeof _smartDbBindKeyboardActivate === 'function') {
      _smartDbBindKeyboardActivate(element, callback);
      return;
    }
    element.addEventListener('keydown', event => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      callback(event);
    });
  }

  function _openChat(item, def) {
    if (typeof openSavedChat !== 'function') return;
    const source = def.workspaceId ? undefined : def.sourceFolder;
    openSavedChat(item.path, '', source);
  }

  function _openTarget(event, item) {
    event.preventDefault();
    event.stopPropagation();
    if (!item.targetPath || typeof openLink !== 'function') return;
    const label = String(item.targetPath).split(/[\\/]/).pop() || item.targetPath;
    openLink(item.targetPath, label);
  }

  function _ensureNotice(table) {
    const area = table?.closest?.('#smart-db-table-area');
    if (!area) return null;
    let notice = area.querySelector('#chat-history-sheet-notice');
    if (!notice) {
      notice = document.createElement('div');
      notice.id = 'chat-history-sheet-notice';
      notice.className = 'chat-history-sheet-notice';
      notice.dataset.e2eId = 'chat-history-sheet-notice';
      notice.setAttribute('role', 'status');
      area.insertBefore(notice, table);
    }
    return notice;
  }

  function _renderNotice(data, visibleCount) {
    const table = document.getElementById('smart-db-table');
    const notice = _ensureNotice(table);
    if (!notice) return;
    notice.hidden = false;
    const unreadable = Number(data?.unreadableCount || 0);
    const loadError = data?.loadError === true;
    notice.classList.toggle('is-warning', unreadable > 0 || loadError);
    notice.textContent = loadError
      ? `${visibleCount} / ${Number(data?.total || 0)}件の前回取得分を表示しています。最新の履歴を読み込めませんでした。ツールバーの「再読み込み」で再試行できます。`
      : unreadable > 0
        ? `${visibleCount} / ${Number(data?.total || 0)}件を表示しています。読み込めなかった履歴が${unreadable}件あります。`
        : `${visibleCount} / ${Number(data?.total || 0)}件を表示しています。履歴ファイルは変更されません。`;
  }

  function _createHeader(def, columns) {
    const row = document.createElement('tr');
    columns.forEach(column => {
      const meta = COLUMN_META[column];
      const header = document.createElement('th');
      header.className = 'chat-history-sheet-header';
      header.tabIndex = 0;
      header.dataset.e2eId = `chat-history-sort-${column}`;
      header.setAttribute('role', 'button');
      header.setAttribute('aria-label', `${meta.label}で並び替え`);
      header.setAttribute('aria-sort', def.sortBy === column ? (def.sortDir === 'asc' ? 'ascending' : 'descending') : 'none');
      header.textContent = meta.label + (def.sortBy === column ? (def.sortDir === 'asc' ? ' ▲' : ' ▼') : '');
      const sort = async () => {
        const current = def.sortBy === column;
        def.sortBy = column;
        def.sortDir = current ? (def.sortDir === 'asc' ? 'desc' : 'asc') : 'asc';
        if (typeof saveSmartDbDef === 'function') await saveSmartDbDef(def, { skipVersionDirty: true });
        renderChatHistorySmartDbTable(def);
      };
      header.addEventListener('click', sort);
      _bindKeyboardActivate(header, sort);
      row.appendChild(header);
    });
    return row;
  }

  function _createCell(item, column) {
    const cell = document.createElement('td');
    cell.className = `chat-history-sheet-cell chat-history-sheet-cell-${column}`;
    const value = _displayValue(item, column);
    if (column === 'targetPath' && item.targetPath) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'chat-history-sheet-link';
      button.dataset.e2eId = `chat-history-target-${typeof _smartDbStableIdPart === 'function' ? _smartDbStableIdPart(item.id) : 'item'}`;
      button.textContent = value;
      button.title = value;
      button.addEventListener('click', event => _openTarget(event, item));
      cell.appendChild(button);
    } else {
      cell.textContent = value || '—';
      if (column === 'path' || column === 'targetPath') cell.title = value;
    }
    return cell;
  }

  function _createRow(item, index, def, columns) {
    const row = document.createElement('tr');
    row.className = 'chat-history-sheet-row';
    row.tabIndex = 0;
    row.dataset.e2eId = `chat-history-row-${index}-${typeof _smartDbStableIdPart === 'function' ? _smartDbStableIdPart(item.id) : index}`;
    row.setAttribute('role', 'button');
    row.setAttribute('aria-label', `チャットを開く: ${_titleLabel(item)}`);
    row.addEventListener('click', () => _openChat(item, def));
    _bindKeyboardActivate(row, event => {
      if (event?.target !== row) return;
      _openChat(item, def);
    });
    columns.forEach(column => row.appendChild(_createCell(item, column)));
    return row;
  }

  function renderChatHistorySmartDbTable(def) {
    const table = document.getElementById('smart-db-table');
    const head = table?.querySelector('thead');
    const body = table?.querySelector('tbody');
    if (!table || !head || !body) return;
    if (typeof disposeSmartDbVirtualRows === 'function') disposeSmartDbVirtualRows(table);
    head.replaceChildren();
    body.replaceChildren();

    const data = state.smartDbData || { items: [], total: 0, unreadableCount: 0 };
    const columns = _visibleColumns(def);
    const rows = _sortedRows(_filteredRows(data.items || [], def), def);
    head.appendChild(_createHeader(def, columns));
    _renderNotice(data, rows.length);

    if (!rows.length) {
      const row = document.createElement('tr');
      const cell = document.createElement('td');
      cell.className = 'chat-history-sheet-empty';
      cell.colSpan = columns.length;
      cell.textContent = data.loadError
        ? '履歴を読み込めませんでした。ツールバーの「再読み込み」で再試行してください'
        : Number(data.total || 0)
          ? '条件に一致する履歴がありません'
          : '履歴がありません';
      row.appendChild(cell);
      body.appendChild(row);
    } else if (!(typeof renderSmartDbVirtualRows === 'function' && renderSmartDbVirtualRows({
      table,
      tbody: body,
      rows,
      colSpan: columns.length,
      rowHeight: 38,
      renderRow: (item, index) => _createRow(item, index, def, columns),
    }))) {
      rows.forEach((item, index) => body.appendChild(_createRow(item, index, def, columns)));
    }
    if (typeof showStatus === 'function') {
      const unreadable = Number(data.unreadableCount || 0);
      showStatus(`${rows.length} / ${Number(data.total || 0)} 件${unreadable ? `（読み込み失敗 ${unreadable}件）` : ''}`, unreadable > 0);
    }
  }

  async function loadChatHistorySmartDbData(def) {
    const data = await apiFetch(_historyUrl(def));
    return {
      items: Array.isArray(data?.items) ? data.items : [],
      total: Number(data?.total || 0),
      unreadableCount: Number(data?.unreadableCount || 0),
      scopeKey: def.scopeKey,
    };
  }

  async function openChatHistorySheet(options) {
    const openOptions = options || {};
    const scope = _scopeValues();
    if (!scope.sourceFolder && !scope.workspaceId) {
      if (typeof _chatRequireSourceFolder === 'function') _chatRequireSourceFolder();
      return false;
    }
    const id = _scopeId(scope);
    const saved = typeof getSavedSmartDbs === 'function'
      ? getSavedSmartDbs().find(item => item?.id === id)
      : null;
    const def = {
      ...(saved || {}),
      id,
      type: 'smart-db',
      systemView: true,
      sourceType: 'chat-history',
      name: 'チャット履歴',
      scopeKey: _scopeKey(scope),
      sourceFolder: scope.sourceFolder,
      workspaceId: scope.workspaceId,
      filters: Array.isArray(saved?.filters) ? saved.filters : [],
      columns: Array.isArray(saved?.columns) && saved.columns.length ? saved.columns : DEFAULT_COLUMNS.slice(),
      sortBy: COLUMN_META[saved?.sortBy] ? saved.sortBy : 'modified',
      sortDir: saved?.sortDir === 'asc' ? 'asc' : 'desc',
      activeView: 'table',
      created: saved?.created || new Date().toISOString(),
    };
    if (typeof normalizeSmartDbDefinition === 'function') normalizeSmartDbDefinition(def);
    if (typeof saveSmartDbDef === 'function') await saveSmartDbDef(def, { skipVersionDirty: true });
    if (typeof selectSmartDb === 'function') {
      const selectOptions = { skipRecent: true };
      if (openOptions.refreshExistingView) {
        Object.assign(selectOptions, {
          silent: true,
          skipNavPush: true,
          skipSaveLastView: true,
          skipAutoVersion: true,
          skipHistoryScope: true,
        });
      }
      await selectSmartDb(id, def, selectOptions);
      return true;
    }
    return false;
  }

  function _modalCloseHandler(overlay, restoreTarget) {
    if (typeof _smartDbAttachOverlayDismiss === 'function') return _smartDbAttachOverlayDismiss(overlay, restoreTarget);
    const close = () => overlay.remove();
    overlay.addEventListener('pointerdown', event => {
      if (event.target === overlay) close();
    });
    return close;
  }

  function _createFilterRow(filter, index) {
    const row = document.createElement('div');
    row.className = 'chat-history-filter-row';
    row.dataset.e2eId = `chat-history-filter-row-${index}`;
    row.setAttribute('role', 'group');
    row.setAttribute('aria-label', `チャット履歴の条件${index + 1}`);

    const column = document.createElement('select');
    column.className = 'gb-select';
    column.dataset.field = 'column';
    column.dataset.e2eId = `chat-history-filter-column-${index}`;
    Object.entries(COLUMN_META).forEach(([key, meta]) => {
      const option = document.createElement('option');
      option.value = key;
      option.textContent = meta.label;
      option.selected = key === (filter?.column || 'title');
      column.appendChild(option);
    });

    const operator = document.createElement('select');
    operator.className = 'gb-select';
    operator.dataset.field = 'operator';
    operator.dataset.e2eId = `chat-history-filter-operator-${index}`;
    const fillOperators = () => {
      const current = operator.value || filter?.operator || '';
      operator.replaceChildren();
      const values = COLUMN_META[column.value]?.operators || ['contains'];
      values.forEach(key => {
        const option = document.createElement('option');
        option.value = key;
        option.textContent = OPERATOR_LABELS[key] || key;
        option.selected = key === current;
        operator.appendChild(option);
      });
    };
    fillOperators();
    column.addEventListener('change', fillOperators);

    const value = document.createElement('input');
    value.className = 'gb-input';
    value.dataset.field = 'value';
    value.dataset.e2eId = `chat-history-filter-value-${index}`;
    value.value = String(filter?.value == null ? '' : filter.value);
    value.placeholder = '値';
    const syncValueType = () => {
      value.type = column.value === 'messageCount'
        ? 'number'
        : (column.value === 'created' || column.value === 'modified')
          ? 'date'
          : 'text';
    };
    syncValueType();
    column.addEventListener('change', syncValueType);

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'gb-btn gb-btn-sm gb-btn-icon gb-btn-danger';
    remove.dataset.e2eId = `chat-history-filter-remove-${index}`;
    remove.setAttribute('aria-label', `チャット履歴の条件${index + 1}を削除`);
    remove.innerHTML = typeof lucide === 'function' ? lucide('x', 14) : '×';
    remove.addEventListener('click', () => row.remove());
    row.append(column, operator, value, remove);
    return row;
  }

  function showChatHistorySmartDbFilterModal(smartDbId) {
    const def = typeof _findSmartDbDefinition === 'function' ? _findSmartDbDefinition(smartDbId) : null;
    if (!_isChatHistoryDef(def)) return;
    const restoreTarget = typeof _smartDbActiveElement === 'function' ? _smartDbActiveElement() : document.activeElement;
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.dataset.e2eId = 'chat-history-filter-overlay';
    const dialog = document.createElement('div');
    dialog.className = 'modal cond-modal chat-history-settings-modal';
    dialog.dataset.e2eId = 'chat-history-filter-dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'chat-history-filter-title');

    const title = document.createElement('h3');
    title.id = 'chat-history-filter-title';
    title.className = 'gb-modal-title';
    title.textContent = 'チャット履歴の絞り込み';
    const description = document.createElement('p');
    description.className = 'gb-section-desc';
    description.textContent = 'すべての条件に一致する履歴を表示します。履歴ファイル自体は変更されません。';
    const rowsHost = document.createElement('div');
    rowsHost.className = 'chat-history-filter-list';
    rowsHost.dataset.e2eId = 'chat-history-filter-list';
    (def.filters || []).forEach((filter, index) => rowsHost.appendChild(_createFilterRow(filter, index)));
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'gb-btn gb-btn-sm';
    add.dataset.e2eId = 'chat-history-filter-add';
    add.textContent = '＋ 条件を追加';
    add.addEventListener('click', () => rowsHost.appendChild(_createFilterRow({}, rowsHost.children.length)));
    const actions = document.createElement('div');
    actions.className = 'btn-row';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'gb-btn gb-btn-sm';
    cancel.dataset.e2eId = 'chat-history-filter-cancel';
    cancel.textContent = 'キャンセル';
    const save = document.createElement('button');
    save.type = 'button';
    save.className = 'gb-btn gb-btn-sm gb-btn-primary primary';
    save.dataset.e2eId = 'chat-history-filter-save';
    save.textContent = '適用';
    actions.append(cancel, save);
    dialog.append(title, description, rowsHost, add, actions);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
    const close = _modalCloseHandler(overlay, restoreTarget);
    cancel.addEventListener('click', close);
    save.addEventListener('click', async () => {
      def.filters = Array.from(rowsHost.children).map(row => ({
        column: row.querySelector('[data-field="column"]')?.value || 'title',
        operator: row.querySelector('[data-field="operator"]')?.value || 'contains',
        value: row.querySelector('[data-field="value"]')?.value || '',
      }));
      if (typeof saveSmartDbDef === 'function') await saveSmartDbDef(def, { skipVersionDirty: true });
      renderChatHistorySmartDbTable(def);
      close();
    });
    if (typeof _smartDbFocusFirstDialogControl === 'function') _smartDbFocusFirstDialogControl(overlay);
  }

  function showChatHistorySmartDbColumnsModal() {
    const def = state.currentSmartDb;
    if (!_isChatHistoryDef(def)) return;
    const restoreTarget = document.querySelector('[data-e2e-id="chat-history-columns"]') || document.activeElement;
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.dataset.e2eId = 'chat-history-columns-overlay';
    const dialog = document.createElement('div');
    dialog.className = 'modal chat-history-settings-modal';
    dialog.dataset.e2eId = 'chat-history-columns-dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'chat-history-columns-title');
    const title = document.createElement('h3');
    title.id = 'chat-history-columns-title';
    title.className = 'gb-modal-title';
    title.textContent = 'チャット履歴の表示項目';
    const list = document.createElement('div');
    list.className = 'chat-history-column-list';
    const selected = new Set(_visibleColumns(def));
    Object.entries(COLUMN_META).forEach(([key, meta]) => {
      const label = document.createElement('label');
      label.className = 'chat-history-column-option';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.value = key;
      input.checked = selected.has(key);
      input.dataset.e2eId = `chat-history-column-${key}`;
      label.append(input, document.createTextNode(meta.label));
      list.appendChild(label);
    });
    const actions = document.createElement('div');
    actions.className = 'btn-row';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'gb-btn gb-btn-sm';
    cancel.textContent = 'キャンセル';
    const save = document.createElement('button');
    save.type = 'button';
    save.className = 'gb-btn gb-btn-sm gb-btn-primary primary';
    save.dataset.e2eId = 'chat-history-columns-save';
    save.textContent = '適用';
    actions.append(cancel, save);
    dialog.append(title, list, actions);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
    const close = _modalCloseHandler(overlay, restoreTarget);
    cancel.addEventListener('click', close);
    save.addEventListener('click', async () => {
      const columns = Array.from(list.querySelectorAll('input:checked')).map(input => input.value);
      if (!columns.length) {
        if (typeof showStatus === 'function') showStatus('表示する項目を1つ以上選択してください', true);
        return;
      }
      def.columns = columns;
      if (typeof saveSmartDbDef === 'function') await saveSmartDbDef(def, { skipVersionDirty: true });
      renderChatHistorySmartDbTable(def);
      close();
    });
    if (typeof _smartDbFocusFirstDialogControl === 'function') _smartDbFocusFirstDialogControl(overlay);
  }

  function configureChatHistorySmartDbToolbar(def) {
    const toolbar = document.querySelector('#smart-db-view .smart-db-toolbar');
    if (!toolbar) return;
    const isChatHistory = _isChatHistoryDef(def);
    const table = document.getElementById('smart-db-table');
    if (table) table.setAttribute('aria-label', isChatHistory ? 'チャット履歴' : 'スマートシート');
    const notice = document.getElementById('chat-history-sheet-notice');
    if (notice) notice.hidden = !isChatHistory;
    const menu = toolbar.querySelector('[data-action*="showToolMenu"]');
    const reveal = toolbar.querySelector('[data-action*="revealCurrentInFolderTree"]');
    const dashboard = toolbar.querySelector('[data-smart-db-view="dashboard"]');
    [menu, reveal, dashboard].forEach(control => {
      if (control) control.hidden = isChatHistory;
    });
    const reload = toolbar.querySelector('[data-e2e-id="smart-db-reload-current"]');
    if (reload) {
      if (!reload.dataset.chatHistoryOriginalAction) {
        reload.dataset.chatHistoryOriginalAction = reload.getAttribute('data-action') || '';
      }
      reload.setAttribute(
        'data-action',
        isChatHistory ? 'refreshOpenChatHistorySheet()' : reload.dataset.chatHistoryOriginalAction,
      );
    }
    let columns = toolbar.querySelector('[data-e2e-id="chat-history-columns"]');
    if (!columns) {
      columns = document.createElement('button');
      columns.type = 'button';
      columns.className = 'tb-icon-btn';
      columns.dataset.e2eId = 'chat-history-columns';
      columns.title = '表示項目';
      columns.setAttribute('aria-label', 'チャット履歴の表示項目');
      columns.innerHTML = '<span class="ico ico-columns3"></span>';
      columns.addEventListener('click', showChatHistorySmartDbColumnsModal);
      toolbar.insertBefore(columns, reload || null);
    }
    columns.hidden = !isChatHistory;
  }

  async function refreshOpenChatHistorySheet() {
    const def = state.currentSmartDb;
    if (!_isChatHistoryDef(def) || typeof selectSmartDb !== 'function') return false;
    const scope = _scopeValues();
    if (!scope.sourceFolder && !scope.workspaceId) return false;
    if (_scopeKey(scope) !== def.scopeKey) {
      return openChatHistorySheet({ refreshExistingView: true });
    }
    await selectSmartDb(def.id, def, {
      silent: true,
      forceRefresh: true,
      skipNavPush: true,
      skipRecent: true,
      skipSaveLastView: true,
      skipAutoVersion: true,
      skipHistoryScope: true,
    });
    return true;
  }

  window.CHAT_HISTORY_COLUMNS = COLUMN_META;
  window.configureChatHistorySmartDbToolbar = configureChatHistorySmartDbToolbar;
  window.loadChatHistorySmartDbData = loadChatHistorySmartDbData;
  window.openChatHistorySheet = openChatHistorySheet;
  window.refreshOpenChatHistorySheet = refreshOpenChatHistorySheet;
  window.renderChatHistorySmartDbTable = renderChatHistorySmartDbTable;
  window.showChatHistorySmartDbColumnsModal = showChatHistorySmartDbColumnsModal;
  window.showChatHistorySmartDbFilterModal = showChatHistorySmartDbFilterModal;
})();
