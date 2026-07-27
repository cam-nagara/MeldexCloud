/* Mobile-first Meldex folder drawer shared by standalone Cloud apps. */
(function () {
  'use strict';

  const state = {
    initialized: false,
    open: false,
    busy: false,
    pendingCount: 0,
    requestGeneration: 0,
    currentPath: '',
    entries: [],
    selectedPath: '',
    searchQuery: '',
    picker: null,
    dialogResolve: null,
    dialogLastFocus: null,
    lastFocus: null,
    refs: {},
  };

  function _runtime() {
    return window.MeldexStandaloneCloud;
  }

  function _isCloud() {
    return document.documentElement?.hasAttribute('data-standalone-cloud') === true;
  }

  function _el(tag, attributes, text) {
    const node = document.createElement(tag);
    Object.entries(attributes || {}).forEach(([name, value]) => {
      if (value == null) return;
      if (name === 'className') node.className = value;
      else if (name === 'hidden') node.hidden = !!value;
      else if (name === 'type') node.type = value;
      else node.setAttribute(name, String(value));
    });
    if (text != null) node.textContent = String(text);
    return node;
  }

  function _button(label, className, action) {
    const button = _el('button', { type: 'button', className, 'data-sa-tree-action': action }, label);
    return button;
  }

  function _append(parent) {
    Array.prototype.slice.call(arguments, 1).forEach((child) => parent.appendChild(child));
    return parent;
  }

  function _createDom() {
    const refs = state.refs;
    refs.toggle = _button('Meldexファイル', 'sa-workspace-toggle', 'toggle');
    refs.toggle.setAttribute('aria-controls', 'sa-workspace-drawer');
    refs.toggle.setAttribute('aria-expanded', 'false');
    refs.toggle.setAttribute('aria-label', 'Meldexの保存先フォルダを開く');

    refs.backdrop = _el('div', { className: 'sa-workspace-backdrop', hidden: true });
    refs.drawer = _el('aside', {
      id: 'sa-workspace-drawer', className: 'sa-workspace-drawer', role: 'dialog',
      'aria-modal': 'true', 'aria-labelledby': 'sa-workspace-title', tabindex: '-1', hidden: true,
    });
    refs.header = _el('header', { className: 'sa-workspace-header' });
    refs.title = _el('h2', { id: 'sa-workspace-title' }, 'Meldexファイル');
    refs.close = _button('閉じる', 'sa-workspace-close', 'close');
    _append(refs.header, refs.title, refs.close);

    refs.auth = _el('section', { className: 'sa-workspace-auth', 'aria-labelledby': 'sa-auth-title', hidden: true });
    refs.authTitle = _el('h3', { id: 'sa-auth-title' }, 'Dropboxに接続');
    refs.authText = _el('p', {}, 'Meldexクラウドのファイルを開くにはDropboxへ接続してください。');
    refs.authOpen = _button('Dropboxの接続画面を開く', 'sa-workspace-primary', 'auth-open');
    refs.authLink = _el('a', { className: 'sa-workspace-auth-link', target: '_blank', rel: 'noopener noreferrer', hidden: true }, '接続画面をもう一度開く');
    refs.codeLabel = _el('label', { for: 'sa-workspace-auth-code' }, 'Dropboxに表示されたコード');
    refs.authCode = _el('input', {
      id: 'sa-workspace-auth-code', type: 'text', inputmode: 'text', autocomplete: 'one-time-code',
      autocapitalize: 'none', spellcheck: 'false', placeholder: 'コードを貼り付け',
    });
    refs.authSubmit = _button('コードで接続', 'sa-workspace-primary', 'auth-submit');
    refs.authStatus = _el('div', { className: 'sa-workspace-status', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' });
    _append(refs.auth, refs.authTitle, refs.authText, refs.authOpen, refs.authLink,
      refs.codeLabel, refs.authCode, refs.authSubmit, refs.authStatus);

    refs.main = _el('div', { className: 'sa-workspace-main' });
    refs.sourceBar = _el('div', { className: 'sa-workspace-source-bar' });
    refs.sourceLabel = _el('label', { for: 'sa-workspace-source' }, '保存先');
    refs.source = _el('select', { id: 'sa-workspace-source', 'aria-label': '保存先を切り替える' });
    refs.addSource = _button('保存先を追加', 'sa-workspace-secondary', 'source-add');
    refs.refresh = _button('更新', 'sa-workspace-icon-action', 'refresh');
    _append(refs.sourceBar, refs.sourceLabel, refs.source, refs.addSource, refs.refresh);

    refs.breadcrumbs = _el('nav', { className: 'sa-workspace-breadcrumbs', 'aria-label': '現在のフォルダ' });
    refs.searchForm = _el('form', { className: 'sa-workspace-search', role: 'search' });
    refs.searchLabel = _el('label', { for: 'sa-workspace-search-input', className: 'sa-visually-hidden' }, 'ファイルとフォルダを検索');
    refs.searchInput = _el('input', {
      id: 'sa-workspace-search-input', type: 'search', enterkeyhint: 'search',
      placeholder: 'ファイルとフォルダを検索', autocomplete: 'off',
    });
    refs.searchButton = _button('検索', 'sa-workspace-secondary', 'search');
    refs.searchClear = _button('検索を解除', 'sa-workspace-secondary', 'search-clear');
    refs.searchClear.hidden = true;
    _append(refs.searchForm, refs.searchLabel, refs.searchInput, refs.searchButton, refs.searchClear);

    refs.createBar = _el('div', { className: 'sa-workspace-create-bar' });
    refs.createFolder = _button('新しいフォルダ', 'sa-workspace-secondary', 'create-folder');
    refs.createFile = _button('新しいファイル', 'sa-workspace-secondary', 'create-file');
    _append(refs.createBar, refs.createFolder, refs.createFile);

    refs.status = _el('div', { className: 'sa-workspace-status', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' });
    refs.list = _el('div', { className: 'sa-workspace-list', role: 'tree', 'aria-label': 'Meldexのフォルダとファイル', tabindex: '0' });
    refs.empty = _el('div', { className: 'sa-workspace-empty', hidden: true }, 'このフォルダには項目がありません。');

    refs.actions = _el('div', { className: 'sa-workspace-item-actions' });
    refs.openItem = _button('開く', 'sa-workspace-primary', 'open-item');
    refs.duplicate = _button('複製', 'sa-workspace-secondary', 'duplicate');
    refs.move = _button('移動', 'sa-workspace-secondary', 'move');
    refs.remove = _button('削除', 'sa-workspace-danger', 'delete');
    _append(refs.actions, refs.openItem, refs.duplicate, refs.move, refs.remove);

    refs.picker = _el('footer', { className: 'sa-workspace-picker', hidden: true });
    refs.saveNameLabel = _el('label', { for: 'sa-workspace-save-name' }, 'ファイル名');
    refs.saveName = _el('input', {
      id: 'sa-workspace-save-name', type: 'text', enterkeyhint: 'done', autocomplete: 'off', spellcheck: 'false',
    });
    refs.pickerCancel = _button('キャンセル', 'sa-workspace-secondary', 'picker-cancel');
    refs.pickerConfirm = _button('選択', 'sa-workspace-primary', 'picker-confirm');
    _append(refs.picker, refs.saveNameLabel, refs.saveName, refs.pickerCancel, refs.pickerConfirm);

    _append(refs.main, refs.sourceBar, refs.breadcrumbs, refs.searchForm, refs.createBar,
      refs.status, refs.list, refs.empty, refs.actions, refs.picker);
    _append(refs.drawer, refs.header, refs.auth, refs.main);

    refs.dialogBackdrop = _el('div', { className: 'sa-workspace-dialog-backdrop', hidden: true });
    refs.dialog = _el('form', {
      className: 'sa-workspace-dialog', role: 'alertdialog', 'aria-modal': 'true',
      'aria-labelledby': 'sa-workspace-dialog-title', 'aria-describedby': 'sa-workspace-dialog-message', hidden: true,
    });
    refs.dialogTitle = _el('h3', { id: 'sa-workspace-dialog-title' });
    refs.dialogMessage = _el('p', { id: 'sa-workspace-dialog-message' });
    refs.dialogLabel = _el('label', { for: 'sa-workspace-dialog-input', hidden: true });
    refs.dialogInput = _el('input', { id: 'sa-workspace-dialog-input', type: 'text', autocomplete: 'off', hidden: true });
    refs.dialogActions = _el('div', { className: 'sa-workspace-dialog-actions' });
    refs.dialogCancel = _button('キャンセル', 'sa-workspace-secondary', 'dialog-cancel');
    refs.dialogConfirm = _button('実行', 'sa-workspace-primary', 'dialog-confirm');
    _append(refs.dialogActions, refs.dialogCancel, refs.dialogConfirm);
    _append(refs.dialog, refs.dialogTitle, refs.dialogMessage, refs.dialogLabel, refs.dialogInput, refs.dialogActions);

    document.body.append(refs.toggle, refs.backdrop, refs.drawer, refs.dialogBackdrop, refs.dialog);
  }

  function _setStatus(message, error) {
    const node = state.refs.status;
    if (!node) return;
    node.textContent = String(message || '');
    node.classList.toggle('is-error', !!error);
    if (state.refs.authStatus) {
      state.refs.authStatus.textContent = String(message || '');
      state.refs.authStatus.classList.toggle('is-error', !!error);
    }
  }

  function _syncBusyControls() {
    const refs = state.refs;
    const busy = state.busy;
    if (!refs.source) return;
    refs.source.disabled = busy || refs.source.options.length === 0;
    [
      refs.addSource, refs.refresh, refs.searchInput, refs.searchButton, refs.searchClear,
      refs.createFolder, refs.createFile, refs.pickerConfirm, refs.saveName, refs.authSubmit,
    ].forEach((control) => { if (control) control.disabled = busy; });
    const hasSelection = !!_selectedItem();
    [refs.openItem, refs.duplicate, refs.move, refs.remove].forEach((control) => {
      if (control) control.disabled = busy || !hasSelection;
    });
    refs.list?.querySelectorAll('.sa-workspace-row-button').forEach((button) => { button.disabled = busy; });
    refs.breadcrumbs?.querySelectorAll('[data-sa-tree-action="crumb"]').forEach((button) => { button.disabled = busy; });
  }

  function _setBusy(busy, message) {
    state.pendingCount = Math.max(0, state.pendingCount + (busy ? 1 : -1));
    state.busy = state.pendingCount > 0;
    state.refs.drawer?.setAttribute('aria-busy', state.busy ? 'true' : 'false');
    state.refs.main?.classList.toggle('is-busy', state.busy);
    _syncBusyControls();
    if (message && busy) _setStatus(message, false);
  }

  function _isFolder(item) {
    return item?.kind === 'directory' || ['folder', 'database', 'calendar'].includes(String(item?.type || ''));
  }

  function _allowed(item) {
    if (_isFolder(item)) return true;
    const extensions = state.picker?.extensions || [];
    if (!extensions.length) return true;
    const lower = String(item?.path || item?.name || '').toLowerCase();
    return extensions.some((extension) => lower.endsWith(String(extension).toLowerCase()));
  }

  function _selectedItem() {
    return state.entries.find((item) => item.path === state.selectedPath) || null;
  }

  function _renderSources() {
    const select = state.refs.source;
    select.replaceChildren();
    const runtime = _runtime();
    runtime.getRoots().forEach((root) => {
      const option = _el('option', { value: root.id }, root.name || 'Meldex');
      option.selected = root.id === runtime.getActiveRoot()?.id;
      select.appendChild(option);
    });
    _syncBusyControls();
  }

  function _renderBreadcrumbs() {
    const nav = state.refs.breadcrumbs;
    nav.replaceChildren();
    const runtime = _runtime();
    const root = runtime.getActiveRoot();
    if (!root) return;
    const base = runtime.normalizePath(root.path);
    const current = runtime.normalizePath(state.currentPath || base);
    const relative = current === base ? '' : current.startsWith(base + '/') ? current.slice(base.length + 1) : runtime.displayPath(current);
    const rootButton = _button(root.name || 'Meldex', 'sa-workspace-crumb', 'crumb');
    rootButton.dataset.path = base;
    nav.appendChild(rootButton);
    let path = base;
    relative.split('/').filter(Boolean).forEach((part) => {
      nav.appendChild(_el('span', { 'aria-hidden': 'true' }, '/'));
      path = runtime.joinPath(path, part);
      const button = _button(part, 'sa-workspace-crumb', 'crumb');
      button.dataset.path = path;
      nav.appendChild(button);
    });
    _syncBusyControls();
  }

  function _renderList() {
    const list = state.refs.list;
    list.replaceChildren();
    const visible = state.entries.filter(_allowed);
    visible.forEach((item) => {
      const folder = _isFolder(item);
      const row = _el('div', {
        className: 'sa-workspace-row' + (item.path === state.selectedPath ? ' is-selected' : ''),
        role: 'treeitem', 'aria-selected': item.path === state.selectedPath ? 'true' : 'false',
      });
      row.dataset.path = item.path;
      row.dataset.kind = folder ? 'folder' : 'file';
      const icon = _el('span', {
        className: 'sa-workspace-row-icon ' + (folder ? 'is-folder' : 'is-file'),
        'aria-hidden': 'true',
      });
      const label = _el('span', { className: 'sa-workspace-row-label' }, item.name || _runtime().basename(item.path));
      const type = _el('span', { className: 'sa-workspace-row-type' }, folder ? 'フォルダ' : 'ファイル');
      const button = _button('', 'sa-workspace-row-button', 'row');
      button.setAttribute('aria-label', `${item.name || '項目'}、${folder ? 'フォルダ' : 'ファイル'}`);
      button.append(icon, label, type);
      row.appendChild(button);
      list.appendChild(row);
    });
    state.refs.empty.hidden = visible.length !== 0;
    const selected = _selectedItem();
    const hasSelection = !!selected;
    state.refs.openItem.disabled = !hasSelection || state.busy;
    state.refs.duplicate.disabled = !hasSelection || state.busy;
    state.refs.move.disabled = !hasSelection || state.busy;
    state.refs.remove.disabled = !hasSelection || state.busy;
    state.refs.openItem.textContent = _isFolder(selected) ? 'フォルダを開く' : 'ファイルを開く';
    _syncBusyControls();
  }

  function _renderPicker() {
    const picker = state.picker;
    state.refs.picker.hidden = !picker;
    state.refs.saveName.hidden = picker?.mode !== 'save';
    state.refs.saveNameLabel.hidden = picker?.mode !== 'save';
    if (!picker) return;
    state.refs.title.textContent = picker.title || 'Meldexファイル';
    state.refs.pickerConfirm.textContent = picker.mode === 'open' ? '選択したファイルを開く'
      : picker.mode === 'save' ? 'ここに保存' : 'このフォルダを選択';
    if (picker.mode === 'save') state.refs.saveName.value = picker.suggestedName || '';
    _syncBusyControls();
  }

  function _renderAuth(status) {
    const connected = !!status?.connected;
    state.refs.auth.hidden = connected;
    state.refs.main.hidden = !connected;
    if (connected) {
      _renderSources();
      const active = _runtime().getActiveRoot();
      if (!state.currentPath) state.currentPath = active?.path || '';
    }
  }

  function _rootIdentity() {
    const root = _runtime().getActiveRoot();
    return {
      id: String(root?.id || ''),
      path: _runtime().normalizePath(root?.path || ''),
    };
  }

  function _beginListRequest(kind, targetPath, query) {
    const root = _rootIdentity();
    return {
      generation: ++state.requestGeneration,
      kind,
      rootId: root.id,
      rootPath: root.path,
      basePath: _runtime().normalizePath(state.currentPath || ''),
      targetPath: _runtime().normalizePath(targetPath || ''),
      baseSearchQuery: state.searchQuery,
      query: String(query || ''),
    };
  }

  function _isCurrentRequest(request) {
    if (!request || request.generation !== state.requestGeneration) return false;
    const root = _rootIdentity();
    if (root.id !== request.rootId || root.path !== request.rootPath) return false;
    if (_runtime().normalizePath(state.currentPath || '') !== request.basePath) return false;
    if (state.searchQuery !== request.baseSearchQuery) return false;
    if (request.kind === 'search' && state.refs.searchInput.value.trim() !== request.query) return false;
    return true;
  }

  function _invalidateListRequests() {
    state.requestGeneration++;
  }

  async function _loadCurrent(options) {
    const targetPath = _runtime().normalizePath(options?.path || state.currentPath || '');
    if (!targetPath) return null;
    const request = _beginListRequest('browse', targetPath, '');
    _setBusy(true, options?.message || 'フォルダを読み込んでいます…');
    try {
      const entries = await _runtime().browse(request.targetPath);
      if (!_isCurrentRequest(request)) return null;
      if (!Array.isArray(entries)) throw new Error('フォルダの一覧を読み取れませんでした');
      state.currentPath = request.targetPath;
      state.entries = entries;
      state.selectedPath = !options?.clearSelection && state.entries.some((item) => item.path === state.selectedPath)
        ? state.selectedPath : '';
      state.searchQuery = '';
      state.refs.searchInput.value = '';
      state.refs.searchClear.hidden = true;
      _renderBreadcrumbs();
      _renderList();
      _setStatus(`${state.entries.length}件`, false);
      return true;
    } catch (error) {
      if (!_isCurrentRequest(request)) return null;
      _setStatus(`フォルダを読み込めませんでした: ${error?.message || String(error)}`, true);
      return false;
    } finally {
      _setBusy(false);
    }
  }

  async function refresh() {
    const status = await _runtime().ensureReady({ requireConnection: false });
    _renderAuth(status);
    if (status.connected) await _loadCurrent();
    return status;
  }

  function open(options) {
    if (!state.initialized) init();
    state.lastFocus = document.activeElement;
    state.open = true;
    state.refs.backdrop.hidden = false;
    state.refs.drawer.hidden = false;
    state.refs.toggle.setAttribute('aria-expanded', 'true');
    document.body.classList.add('sa-workspace-open');
    if (options?.title) state.refs.title.textContent = options.title;
    if (options?.refresh !== false) {
      refresh().catch((error) => _setStatus(error?.message || String(error), true));
    }
    queueMicrotask(() => (state.refs.close || state.refs.drawer).focus());
  }

  function close(options) {
    if (state.picker && !options?.keepPicker) _finishPicker(null, true);
    state.open = false;
    state.refs.backdrop.hidden = true;
    state.refs.drawer.hidden = true;
    state.refs.toggle.setAttribute('aria-expanded', 'false');
    document.body.classList.remove('sa-workspace-open');
    state.refs.title.textContent = 'Meldexファイル';
    if (state.lastFocus?.focus) state.lastFocus.focus();
  }

  function toggle() {
    if (state.open) close();
    else open();
  }

  async function _navigate(path) {
    await _loadCurrent({ path: _runtime().normalizePath(path), clearSelection: true });
  }

  async function _activateSelected() {
    const item = _selectedItem();
    if (!item) return;
    if (_isFolder(item)) {
      await _navigate(item.path);
      return;
    }
    if (state.picker?.mode === 'open') {
      await _finishPicker({ path: item.path, item });
      return;
    }
    const extensions = _runtime().getAppSpec().extensions || [];
    if (!extensions.some((extension) => String(item.path).toLowerCase().endsWith(String(extension).toLowerCase()))) {
      throw new Error('このアプリで開ける形式のファイルを選択してください');
    }
    window.dispatchEvent(new CustomEvent('meldex:standalone-file-open-request', { detail: { path: item.path, item } }));
    close();
  }

  function _ensureExtension(name, picker) {
    const clean = String(name || '').replace(/[\\/]/g, '').replace(/\.\./g, '').trim();
    if (!clean) throw new Error('ファイル名を入力してください');
    const lower = clean.toLowerCase();
    if ((picker.extensions || []).some((extension) => lower.endsWith(String(extension).toLowerCase()))) return clean;
    return clean + (picker.defaultExtension || '');
  }

  async function _confirmPicker() {
    const picker = state.picker;
    if (!picker) return;
    if (picker.mode === 'folder') {
      await _finishPicker({ path: state.currentPath, name: _runtime().basename(state.currentPath) });
      return;
    }
    if (picker.mode === 'open') {
      const item = _selectedItem();
      if (!item || _isFolder(item)) throw new Error('開くファイルを選択してください');
      await _finishPicker({ path: item.path, item });
      return;
    }
    const name = _ensureExtension(state.refs.saveName.value, picker);
    const path = _runtime().joinPath(state.currentPath, name);
    const existing = state.entries.find((item) => _runtime().basename(item.path).toLowerCase() === name.toLowerCase());
    let etag = '';
    if (existing) {
      if (_isFolder(existing)) throw new Error('同じ名前のフォルダがあります');
      const confirmed = await _showDialog({
        title: 'ファイルを上書きしますか？',
        message: `${name} は既にあります。別の端末で更新されている場合は上書きせず競合を通知します。`,
        confirmLabel: '上書きする', danger: true,
      });
      if (!confirmed) return;
      etag = String((await _runtime().readText(path)).etag || '');
      if (!etag) throw new Error('更新情報を取得できないため、安全に上書きできません。もう一度開き直してください。');
    }
    await _finishPicker({ path, name, etag, existing: !!existing });
  }

  function _snapshotView() {
    const active = _runtime().getActiveRoot();
    return {
      rootId: String(active?.id || ''),
      currentPath: state.currentPath,
      entries: state.entries.map((item) => ({ ...item })),
      selectedPath: state.selectedPath,
      searchQuery: state.searchQuery,
      searchInputValue: state.refs.searchInput.value,
      searchClearHidden: state.refs.searchClear.hidden,
      listScrollTop: Number(state.refs.list.scrollTop || 0),
      statusMessage: state.refs.status.textContent,
      statusError: state.refs.status.classList.contains('is-error'),
    };
  }

  async function _restoreView(snapshot, options) {
    if (!snapshot) return;
    const active = _runtime().getActiveRoot();
    if (snapshot.rootId && String(active?.id || '') !== snapshot.rootId) {
      await _runtime().setActiveRoot(snapshot.rootId);
    }
    state.currentPath = snapshot.currentPath;
    state.entries = snapshot.entries.map((item) => ({ ...item }));
    state.selectedPath = snapshot.selectedPath;
    state.searchQuery = snapshot.searchQuery;
    state.refs.searchInput.value = snapshot.searchInputValue;
    state.refs.searchClear.hidden = snapshot.searchClearHidden;
    _renderSources();
    _renderBreadcrumbs();
    _renderList();
    state.refs.list.scrollTop = snapshot.listScrollTop;
    if (options?.restoreStatus !== false) _setStatus(snapshot.statusMessage, snapshot.statusError);
  }

  async function _startPicker(mode, options) {
    if (state.picker) await _finishPicker(null, true);
    const viewSnapshot = _snapshotView();
    return new Promise((resolve) => {
      const active = _runtime().getActiveRoot();
      state.picker = {
        mode, resolve, title: options?.title || '', extensions: options?.extensions || [],
        defaultExtension: options?.defaultExtension || '', suggestedName: options?.suggestedName || '',
        keepOpen: !!options?.keepOpen, viewSnapshot,
      };
      _renderPicker();
      open({ title: state.picker.title, refresh: false });
      _loadCurrent({
        path: _runtime().normalizePath(options?.startPath || active?.path || ''),
        clearSelection: true,
      }).catch((error) => _setStatus(error?.message || String(error), true));
    });
  }

  async function _finishPicker(result, cancelled) {
    const picker = state.picker;
    if (!picker) return;
    state.picker = null;
    _invalidateListRequests();
    let restoreError = null;
    if (cancelled && picker.viewSnapshot) {
      try {
        await _restoreView(picker.viewSnapshot);
      } catch (error) {
        restoreError = error;
      }
    }
    _renderPicker();
    state.refs.title.textContent = 'Meldexファイル';
    if (!picker.keepOpen) close({ keepPicker: true });
    if (restoreError) _setStatus(`元のフォルダ表示へ戻せませんでした: ${restoreError?.message || String(restoreError)}`, true);
    picker.resolve(cancelled ? null : result);
  }

  function pickOpen(options) {
    return _startPicker('open', options || {});
  }

  function pickSaveAs(options) {
    return _startPicker('save', options || {});
  }

  function pickFolder(options) {
    return _startPicker('folder', options || {});
  }

  function _showDialog(options) {
    if (state.dialogResolve) state.dialogResolve(null);
    const refs = state.refs;
    state.dialogLastFocus = document.activeElement;
    refs.dialogTitle.textContent = options?.title || '確認';
    refs.dialogMessage.textContent = options?.message || '';
    refs.dialogConfirm.textContent = options?.confirmLabel || '実行';
    refs.dialogConfirm.className = options?.danger ? 'sa-workspace-danger' : 'sa-workspace-primary';
    const withInput = options && Object.prototype.hasOwnProperty.call(options, 'inputValue');
    refs.dialogLabel.hidden = !withInput;
    refs.dialogInput.hidden = !withInput;
    refs.dialogLabel.textContent = options?.inputLabel || '名前';
    refs.dialogInput.value = withInput ? String(options.inputValue || '') : '';
    refs.dialogBackdrop.hidden = false;
    refs.dialog.hidden = false;
    return new Promise((resolve) => {
      state.dialogResolve = resolve;
      queueMicrotask(() => (withInput ? refs.dialogInput : refs.dialogCancel).focus());
    });
  }

  function _finishDialog(confirmed) {
    const resolve = state.dialogResolve;
    if (!resolve) return;
    const restoreFocus = state.dialogLastFocus;
    const value = confirmed ? (state.refs.dialogInput.hidden ? true : state.refs.dialogInput.value.trim()) : null;
    state.dialogResolve = null;
    state.dialogLastFocus = null;
    state.refs.dialog.hidden = true;
    state.refs.dialogBackdrop.hidden = true;
    resolve(value);
    (restoreFocus?.isConnected ? restoreFocus : state.refs.drawer).focus();
  }

  async function _createFolder() {
    const name = await _showDialog({ title: '新しいフォルダ', message: 'フォルダ名を入力してください。', inputLabel: 'フォルダ名', inputValue: '新しいフォルダ', confirmLabel: '作成' });
    if (!name) return;
    _setBusy(true, 'フォルダを作成しています…');
    try {
      await _runtime().createFolder(state.currentPath, name);
      await _loadCurrent();
      _setStatus('フォルダを作成しました。', false);
    } catch (error) {
      _setStatus(error?.message || String(error), true);
    } finally { _setBusy(false); }
  }

  async function _createFile() {
    const spec = _runtime().getAppSpec();
    const name = await _showDialog({ title: '新しいファイル', message: `${spec.title}のファイルを作成します。`, inputLabel: 'ファイル名', inputValue: spec.defaultFilename, confirmLabel: '作成' });
    if (!name) return;
    _setBusy(true, 'ファイルを作成しています…');
    try {
      const result = await _runtime().createFile(state.currentPath, name);
      await _loadCurrent();
      state.selectedPath = result.path;
      _renderList();
      _setStatus('ファイルを作成しました。', false);
    } catch (error) {
      _setStatus(error?.message || String(error), true);
    } finally { _setBusy(false); }
  }

  async function _duplicate() {
    const item = _selectedItem();
    if (!item) return;
    _setBusy(true, '複製しています…');
    try {
      const result = await _runtime().duplicate(item.path);
      await _loadCurrent();
      state.selectedPath = result?.new_path || '';
      _renderList();
      _setStatus('複製しました。', false);
    } catch (error) { _setStatus(error?.message || String(error), true); }
    finally { _setBusy(false); }
  }

  async function _remove() {
    const item = _selectedItem();
    if (!item) return;
    const confirmed = await _showDialog({
      title: '削除しますか？',
      message: `${item.name || _runtime().basename(item.path)} をMeldexのゴミ箱へ移動します。`,
      confirmLabel: 'ゴミ箱へ移動', danger: true,
    });
    if (!confirmed) return;
    _setBusy(true, 'ゴミ箱へ移動しています…');
    try {
      await _runtime().deletePath(item.path);
      state.selectedPath = '';
      await _loadCurrent();
      _setStatus('ゴミ箱へ移動しました。', false);
    } catch (error) { _setStatus(error?.message || String(error), true); }
    finally { _setBusy(false); }
  }

  async function _move() {
    const item = _selectedItem();
    if (!item) return;
    const sourceRootId = String(_runtime().getActiveRoot()?.id || '');
    const sourceFolder = state.currentPath;
    const picked = await pickFolder({ title: '移動先フォルダを選択', startPath: _runtime().getActiveRoot()?.path, keepOpen: true });
    if (!picked?.path) return;
    _setBusy(true, '移動しています…');
    let moved = false;
    let operationError = null;
    let restoreError = null;
    try {
      await _runtime().move(item.path, picked.path);
      moved = true;
    } catch (error) {
      operationError = error;
    }
    try {
      if (sourceRootId && String(_runtime().getActiveRoot()?.id || '') !== sourceRootId) {
        await _runtime().setActiveRoot(sourceRootId);
      }
      const loaded = await _loadCurrent({ path: sourceFolder, clearSelection: true });
      if (loaded !== true) {
        state.currentPath = sourceFolder;
        state.entries = [];
        state.selectedPath = '';
        state.searchQuery = '';
        state.refs.searchClear.hidden = true;
        _renderBreadcrumbs();
        _renderList();
        throw new Error(state.refs.status.textContent || '元の保存先を読み込めませんでした');
      }
    } catch (error) {
      restoreError = error;
    }
    if (moved && !restoreError) _setStatus('移動しました。', false);
    else if (moved) {
      _setStatus(`移動しましたが、元の保存先を表示できませんでした: ${restoreError?.message || String(restoreError)}`, true);
    } else {
      const message = operationError?.message || String(operationError || '移動できませんでした');
      const restoreMessage = restoreError ? ` 元の保存先も再表示できませんでした: ${restoreError?.message || String(restoreError)}` : '';
      _setStatus(message + restoreMessage, true);
    }
    _setBusy(false);
  }

  async function _search() {
    const query = state.refs.searchInput.value.trim();
    if (!query) return _loadCurrent();
    const active = _runtime().getActiveRoot();
    const request = _beginListRequest('search', state.currentPath, query);
    _setBusy(true, '検索しています…');
    try {
      const response = await _runtime().search(query, { path: active?.path || state.currentPath });
      if (!_isCurrentRequest(request)) return null;
      const entries = Array.isArray(response)
        ? response
        : response && (response.entries || response.items || response.results);
      if (!Array.isArray(entries)) throw new Error('検索結果を読み取れませんでした');
      const metadata = (Array.isArray(response) ? response.metadata : response) || {};
      const warnings = Array.isArray(metadata.warnings) ? metadata.warnings : [];
      const warning = metadata.warning || warnings[0]?.message || '';
      const failed = Math.max(0, Number(metadata.failed || 0));
      const partial = !!metadata.partial || !!warning || failed > 0;
      const truncated = !!metadata.truncated;
      state.entries = entries;
      state.searchQuery = query;
      state.selectedPath = '';
      state.refs.searchClear.hidden = false;
      _renderList();
      let message = `${state.entries.length}件見つかりました。`;
      if (partial) message += ` 一部を検索できませんでした${failed ? `（${failed}件）` : ''}。`;
      if (truncated) message += ' 上限まで表示しています。';
      _setStatus(message, false);
      return true;
    } catch (error) {
      if (!_isCurrentRequest(request)) return null;
      _setStatus(`検索できませんでした: ${error?.message || String(error)}`, true);
      return false;
    }
    finally { _setBusy(false); }
  }

  async function _addSource() {
    let picked = null;
    if (window.MeldexDropboxFolderPicker?.pickFolder) {
      picked = await window.MeldexDropboxFolderPicker.pickFolder({
        title: 'Dropboxからソースフォルダを追加',
      });
    } else {
      const path = await _showDialog({ title: '保存先を追加', message: 'Dropbox内のフォルダパスを入力してください。例: /MeldexVault', inputLabel: 'Dropbox内のフォルダパス', inputValue: '/MeldexVault', confirmLabel: '次へ' });
      if (path) {
        picked = {
          path,
          name: String(path).split('/').filter(Boolean).pop() || 'Meldex',
          namespaceKind: 'home',
        };
      }
    }
    if (!picked?.path) return;
    const name = await _showDialog({ title: '表示名', message: 'この保存先を画面に表示する名前です。', inputLabel: '表示名', inputValue: picked.name || 'Meldex', confirmLabel: '追加' });
    if (!name) return;
    const snapshot = _snapshotView();
    _setBusy(true, '保存先を追加しています…');
    try {
      const root = await _runtime().addSource(
        picked.path,
        name,
        { namespaceKind: picked.namespaceKind },
      );
      _renderSources();
      const loaded = await _loadCurrent({ path: root.path, clearSelection: true });
      if (loaded === false) {
        const message = state.refs.status.textContent;
        await _restoreView(snapshot, { restoreStatus: false });
        _setStatus(message, true);
      } else if (loaded === true) {
        _setStatus('保存先を追加しました。', false);
      }
    } catch (error) { _setStatus(error?.message || String(error), true); }
    finally { _setBusy(false); }
  }

  async function _selectSource(sourceId) {
    if (state.busy) return;
    const snapshot = _snapshotView();
    _invalidateListRequests();
    _setBusy(true, '保存先を切り替えています…');
    try {
      const root = await _runtime().setActiveRoot(sourceId);
      _renderSources();
      const loaded = await _loadCurrent({ path: root.path, clearSelection: true });
      if (loaded === false) {
        const message = state.refs.status.textContent;
        await _restoreView(snapshot, { restoreStatus: false });
        _setStatus(message, true);
      }
    } catch (error) {
      _setStatus(`保存先を切り替えられませんでした: ${error?.message || String(error)}`, true);
    } finally {
      _setBusy(false);
    }
  }

  async function _authOpen() {
    let popup = null;
    try { popup = window.open('about:blank', '_blank'); } catch { /* Popup blocking is handled by the visible fallback link. */ }
    try {
      const auth = await _runtime().beginManualAuth();
      state.refs.authLink.href = auth.authorizationUrl;
      state.refs.authLink.hidden = false;
      if (popup) {
        try { popup.opener = null; } catch { /* noopener is also enforced on the fallback link. */ }
        popup.location.replace(auth.authorizationUrl);
      } else {
        _setStatus('「接続画面をもう一度開く」を押してください。', false);
      }
      state.refs.authCode.focus();
    } catch (error) {
      try { popup?.close(); } catch { /* A browser-blocked popup has nothing to close. */ }
      _setStatus(error?.message || String(error), true);
    }
  }

  async function _authSubmit() {
    _setBusy(true, 'Dropboxへ接続しています…');
    try {
      const status = await _runtime().exchangeManualCode(state.refs.authCode.value);
      state.refs.authCode.value = '';
      _renderAuth(status);
      await _loadCurrent({ path: _runtime().getActiveRoot()?.path || '', clearSelection: true });
      _setStatus('Dropboxへ接続しました。', false);
    } catch (error) { _setStatus(error?.message || String(error), true); }
    finally { _setBusy(false); }
  }

  async function _handleAction(action, target) {
    if (state.busy && !['close', 'dialog-cancel', 'picker-cancel'].includes(action)) return;
    if (action === 'toggle') return toggle();
    if (action === 'close') return close();
    if (action === 'refresh') return _loadCurrent();
    if (action === 'crumb') return _navigate(target.dataset.path);
    if (action === 'row') {
      const row = target.closest('.sa-workspace-row');
      state.selectedPath = row?.dataset.path || '';
      _renderList();
      return;
    }
    if (action === 'open-item') return _activateSelected();
    if (action === 'create-folder') return _createFolder();
    if (action === 'create-file') return _createFile();
    if (action === 'duplicate') return _duplicate();
    if (action === 'delete') return _remove();
    if (action === 'move') return _move();
    if (action === 'source-add') return _addSource();
    if (action === 'search') return _search();
    if (action === 'search-clear') { state.refs.searchInput.value = ''; return _loadCurrent(); }
    if (action === 'picker-confirm') return _confirmPicker().catch((error) => _setStatus(error?.message || String(error), true));
    if (action === 'picker-cancel') return _finishPicker(null, true);
    if (action === 'dialog-confirm') return _finishDialog(true);
    if (action === 'dialog-cancel') return _finishDialog(false);
    if (action === 'auth-open') return _authOpen();
    if (action === 'auth-submit') return _authSubmit();
  }

  function _focusables(container) {
    return [...container.querySelectorAll('button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])')]
      .filter((node) => !node.hidden && node.offsetParent !== null);
  }

  function _handleKeydown(event) {
    if (!state.open && state.refs.dialog.hidden) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      if (!state.refs.dialog.hidden) _finishDialog(false);
      else close();
      return;
    }
    const container = !state.refs.dialog.hidden ? state.refs.dialog : state.refs.drawer;
    if (event.key === 'Tab') {
      const nodes = _focusables(container);
      if (!nodes.length) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
    if (!state.busy && event.key === 'Enter' && document.activeElement?.closest?.('.sa-workspace-row')) {
      event.preventDefault();
      state.selectedPath = document.activeElement.closest('.sa-workspace-row')?.dataset.path || '';
      _renderList();
      _activateSelected().catch((error) => _setStatus(error?.message || String(error), true));
    }
    if (!state.busy && ['ArrowDown', 'ArrowUp'].includes(event.key) && document.activeElement?.closest?.('.sa-workspace-row')) {
      event.preventDefault();
      const rows = [...state.refs.list.querySelectorAll('.sa-workspace-row')];
      const current = document.activeElement.closest('.sa-workspace-row');
      const offset = event.key === 'ArrowDown' ? 1 : -1;
      const next = rows[Math.max(0, Math.min(rows.length - 1, rows.indexOf(current) + offset))];
      state.selectedPath = next?.dataset.path || state.selectedPath;
      _renderList();
      [...state.refs.list.querySelectorAll('.sa-workspace-row')]
        .find((row) => row.dataset.path === state.selectedPath)
        ?.querySelector('.sa-workspace-row-button')?.focus();
    }
  }

  function _bind() {
    document.addEventListener('click', (event) => {
      const target = event.target.closest?.('[data-sa-tree-action]');
      if (!target) return;
      event.preventDefault();
      Promise.resolve(_handleAction(target.dataset.saTreeAction, target))
        .catch((error) => _setStatus(error?.message || String(error), true));
    });
    state.refs.backdrop.addEventListener('click', () => close());
    state.refs.list.addEventListener('dblclick', (event) => {
      if (state.busy) return;
      const row = event.target.closest?.('.sa-workspace-row');
      if (!row) return;
      state.selectedPath = row.dataset.path || '';
      _renderList();
      _activateSelected().catch((error) => _setStatus(error?.message || String(error), true));
    });
    state.refs.searchForm.addEventListener('submit', (event) => {
      event.preventDefault();
      if (!state.busy) _search();
    });
    state.refs.dialog.addEventListener('submit', (event) => { event.preventDefault(); _finishDialog(true); });
    state.refs.authCode.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !state.busy) { event.preventDefault(); _authSubmit(); }
    });
    state.refs.saveName.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        if (!state.busy) _confirmPicker().catch((error) => _setStatus(error?.message || String(error), true));
      }
    });
    state.refs.source.addEventListener('change', () => {
      if (!state.busy) _selectSource(state.refs.source.value);
    });
    document.addEventListener('keydown', _handleKeydown, true);
    window.addEventListener('meldex:standalone-workspace-mutated', () => {
      if (state.open && !state.busy) _loadCurrent().catch(() => {});
    });
    const updateViewport = () => {
      const height = window.visualViewport?.height || window.innerHeight;
      document.documentElement.style.setProperty('--sa-visual-height', `${Math.round(height)}px`);
    };
    window.visualViewport?.addEventListener('resize', updateViewport);
    window.visualViewport?.addEventListener('scroll', updateViewport);
    window.addEventListener('resize', updateViewport);
    updateViewport();
  }

  async function init() {
    if (!_isCloud()) return { initialized: false, cloud: false };
    if (state.initialized) return { initialized: true, cloud: true };
    if (!_runtime()) throw new Error('standalone-cloud-runtime.js が先に読み込まれていません');
    _createDom();
    _bind();
    state.initialized = true;
    try {
      const status = await _runtime().init();
      _renderAuth(status);
      if (status.connected) {
        state.currentPath = _runtime().getActiveRoot()?.path || '';
        _renderBreadcrumbs();
      }
    } catch (error) {
      _setStatus(error?.message || String(error), true);
      _renderAuth({ connected: false });
    }
    return { initialized: true, cloud: true };
  }

  const workspaceTreeApi = {
    init,
    open,
    close,
    toggle,
    refresh,
    pickOpen,
    pickSaveAs,
    pickFolder,
    getCurrentPath: () => state.currentPath,
    getSelection: () => _selectedItem(),
  };
  if (window.__MELDEX_STANDALONE_WORKSPACE_TREE_TEST__) {
    workspaceTreeApi.__test = {
      state,
      loadCurrent: _loadCurrent,
      search: _search,
      startPicker: _startPicker,
      finishPicker: _finishPicker,
      snapshotView: _snapshotView,
      restoreView: _restoreView,
      move: _move,
      renderView: () => { _renderSources(); _renderBreadcrumbs(); _renderList(); _renderPicker(); },
    };
  }
  window.MeldexStandaloneWorkspaceTree = workspaceTreeApi;

  if (_isCloud()) {
    const start = () => init().catch(() => {});
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
    else queueMicrotask(start);
  }
})();
