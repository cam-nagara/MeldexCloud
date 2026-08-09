/* sheet-standalone-app.js: 通常シート（settings-dbフォルダ）専用の単独アプリ。 */
(function () {
  'use strict';

  const LAST_SHEET_KEY = 'meldex-sheet-standalone-last-folder-v1';
  const app = { path: '' };

  function qs(id) { return document.getElementById(id); }
  function normalizePath(value) {
    return String(value || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  }
  function folderTitle(path) {
    const value = normalizePath(path);
    return value.split('/').pop() || MeldexStandaloneFS.rootPathLabel?.() || 'シート';
  }
  function safeStorageGet(key) {
    try { return localStorage.getItem(key) || ''; } catch { return ''; }
  }
  function safeStorageSet(key, value) {
    try {
      if (value) localStorage.setItem(key, value);
      else localStorage.removeItem(key);
    } catch { /* プライベートブラウズ等では履歴を保存しない。 */ }
  }

  function showView(viewName, ctx) {
    const resolved = ['calendar', 'tasks', 'shifts'].includes(viewName) ? 'timeline' : viewName;
    const dbViews = ['pivot', 'tree', 'gallery', 'kanban', 'timeline', 'chart', 'graph', 'form', 'calendar', 'tasks', 'shifts'];
    const display = (id, value) => {
      const element = qs(id);
      if (element) element.style.display = value;
    };
    display('welcome-view', resolved === 'welcome' ? 'flex' : 'none');
    display('db-view-container', dbViews.includes(viewName) ? 'flex' : 'none');
    display('pivot-view', resolved === 'pivot' ? '' : 'none');
    display('tree-view', resolved === 'tree' ? 'flex' : 'none');
    display('gallery-view', resolved === 'gallery' ? 'flex' : 'none');
    display('kanban-view', resolved === 'kanban' ? 'flex' : 'none');
    display('timeline-view', resolved === 'timeline' ? '' : 'none');
    display('chart-view', resolved === 'chart' ? 'flex' : 'none');
    display('graph-view', resolved === 'graph' ? 'flex' : 'none');
    display('form-view', resolved === 'form' ? 'flex' : 'none');
    display('entity-view', resolved === 'entity' ? 'flex' : 'none');
    const entityToolbar = qs('entity-rt-toolbar');
    if (entityToolbar) entityToolbar.style.display = resolved === 'entity' ? 'flex' : 'none';
    const toolbar = qs('sheet-db-toolbar');
    if (toolbar) toolbar.hidden = !dbViews.includes(viewName);
    state.view = viewName;
    if (ctx) ctx.viewMode = viewName;
    if (typeof _dbTreeSetOptionTabVisible === 'function') {
      _dbTreeSetOptionTabVisible(resolved === 'tree', ctx);
    }
  }
  window.showView = showView;

  function setPath(path) {
    app.path = normalizePath(path);
    state.currentDbPath = app.path;
    qs('sheet-title-label').value = app.path ? folderTitle(app.path) : 'シート';
    qs('sheet-path-label').textContent = app.path
      ? MeldexStandaloneFS.pathLabel(app.path)
      : 'シートを選択してください';
    safeStorageSet(LAST_SHEET_KEY, app.path);
    window.MeldexStandaloneTags?.setTargetPath?.(app.path);
    syncOptionPanel().catch(error => console.error('sheet option panel sync failed', error));
  }

  async function syncOptionPanel() {
    if (!app.path || typeof _syncDetailPanel !== 'function') return;
    await _syncDetailPanel(folderTitle(app.path), app.path, 'database', {});
    await window.MeldexStandaloneParity?.syncOptionFeatures?.();
  }

  async function readSheetMetadata(path) {
    return apiFetch('/db-metadata?path=' + encodeURIComponent(normalizePath(path)));
  }

  async function assertNormalSheet(path) {
    const normalized = normalizePath(path);
    if (!normalized && window.MeldexStandaloneCloud?.isCloudMode?.()) {
      throw new Error('保存先のルート自体はシートとして開けません');
    }
    const metadata = await readSheetMetadata(normalized);
    if (String(metadata?.type || '') !== 'settings-db') {
      throw new Error('通常のシートではありません。シートとして作成されたフォルダを選択してください');
    }
    return normalized;
  }

  async function openSheetPath(path, options) {
    const normalized = await assertNormalSheet(path);
    if (typeof selectDatabase !== 'function') throw new Error('シートエンジンを読み込めませんでした');
    showLoading(options?.message || 'シートを読み込んでいます...');
    try {
      const result = await selectDatabase(
        normalized,
        null,
        options?.forceReload ? { forceReload: true } : undefined,
      );
      if (!result?.ok) throw result?.error || new Error('シートを読み込めませんでした');
      setPath(normalized);
      showStatus(options?.forceReload ? 'シートを再読み込みしました' : 'シートを開きました');
      return true;
    } finally {
      hideLoading();
    }
  }

  async function pickFolder(title, purpose) {
    if (window.MeldexStandaloneCloud?.isCloudMode?.()) {
      const tree = window.MeldexStandaloneWorkspaceTree;
      if (!tree?.pickFolder) throw new Error('フォルダ選択画面を利用できません');
      const picked = await tree.pickFolder({ title });
      return picked?.path == null ? null : normalizePath(picked.path);
    }
    try {
      const picked = await apiPost('/standalone/pick-folder', { purpose: purpose || 'browse' });
      return picked?.path == null ? null : normalizePath(picked.path);
    } catch (error) {
      if (error?.status === 499) return null;
      throw error;
    }
  }

  function validateSheetName(value) {
    const name = String(value || '').trim();
    if (!name) throw new Error('シート名を入力してください');
    if (/[<>:"/\\|?*\x00-\x1f]/.test(name) || name === '.' || name === '..') {
      throw new Error('シート名に使用できない文字が含まれています');
    }
    return name;
  }

  async function createSheet() {
    const parent = await pickFolder('新しいシートを作成する場所を選択', 'parent');
    if (parent == null) return;
    const entered = await cfPrompt('新しいシート名', '新しいシート');
    if (entered == null) return;
    const label = validateSheetName(entered);
    showLoading('シートを作成しています...');
    try {
      const result = await apiPost('/outliner/add', { type: 'database', parent, label });
      const path = normalizePath(result?.node?.path || result?.path);
      if (!path) throw new Error('作成したシートの場所を確認できませんでした');
      await openSheetPath(path);
    } finally {
      hideLoading();
    }
  }

  async function openSheet() {
    const picked = await pickFolder('開くシートを選択', 'sheet');
    if (picked == null) {
      MeldexStandaloneFS.discardQueuedOpen?.();
      return;
    }
    await openSheetPath(picked);
  }

  function chooseCsvFile() {
    return new Promise(resolve => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.csv,text/csv';
      input.addEventListener('change', () => resolve(input.files?.[0] || null), { once: true });
      input.click();
    });
  }

  async function importCsv() {
    const file = await chooseCsvFile();
    if (!file) return;
    if (!window.MeldexCsvConversion?.openFile) throw new Error('CSV変換機能を読み込めませんでした');
    const parent = await pickFolder('CSVから作るシートの保存先を選択', 'parent');
    if (parent == null) return;
    await window.MeldexCsvConversion.openFile(file, {
      destinationParent: parent,
      onCreated: result => openSheetPath(result.path, {
        forceReload: true,
        message: '作成したシートを表示しています...',
      }),
    });
  }

  async function canReplaceCurrent() {
    const active = document.querySelector(
      '#pivot-table .cell-inline-input, #pivot-table .cell-inline-select, #pivot-table .cell-date-editor input',
    );
    active?.blur?.();
    await new Promise(resolve => setTimeout(resolve, 0));
    const remaining = document.querySelector(
      '#pivot-table .cell-inline-input, #pivot-table .cell-inline-select, #pivot-table .cell-date-editor',
    );
    if (remaining) {
      remaining.querySelector?.('input,textarea,select')?.focus?.();
      showStatus('セルの値を確定できません。入力内容を確認してください', true);
      return false;
    }
    const flushed = await (window.MeldexStandaloneSaveQueue?.flush?.() ?? Promise.resolve(true));
    if (flushed === false) {
      showStatus('保存待ちの変更を確定できないため、シートを切り替えませんでした', true);
      return false;
    }
    return true;
  }

  function csvCell(value) {
    const text = String(value ?? '');
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }

  async function exportCsv() {
    if (!app.path) throw new Error('先にシートを開いてください');
    const pivot = await apiFetch('/pivot?path=' + encodeURIComponent(app.path));
    const properties = Array.isArray(pivot?.properties) ? pivot.properties : [];
    const rows = [['名前', ...properties]];
    Object.entries(pivot?.entities || {}).forEach(([name, entity]) => {
      rows.push([
        name,
        ...properties.map(property => {
          const candidates = Array.isArray(entity?.[property]) ? entity[property] : [];
          return candidates.map(candidate => candidate?.value ?? '').join(' / ');
        }),
      ]);
    });
    const content = '\uFEFF' + rows.map(row => row.map(csvCell).join(',')).join('\r\n');
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${folderTitle(app.path)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    showStatus(`${Math.max(0, rows.length - 1)}件をCSVに書き出しました`);
  }

  async function reloadSheet() {
    if (!app.path) throw new Error('先にシートを開いてください');
    await openSheetPath(app.path, { forceReload: true });
  }

  async function renameCurrentSheet() {
    const input = qs('sheet-title-label');
    if (!input || !app.path) return;
    const previousPath = app.path;
    const previous = folderTitle(previousPath);
    const next = validateSheetName(input.value);
    if (next === previous) return;
    try {
      const result = await apiPost('/outliner/rename', {
        old_path: app.path,
        new_name: next,
        type: 'database',
      });
      const renamedPath = normalizePath(result?.path || result?.new_path || (
        normalizePath(app.path).split('/').slice(0, -1).concat(next).join('/')
      ));
      window.MeldexSheetViewConfigIdentity?.notifyMoved?.(previousPath, renamedPath);
      setPath(renamedPath);
      showStatus('シート名を変更しました');
    } catch (error) {
      input.value = previous;
      throw error;
    }
  }

  function bindTitleEditing() {
    const input = qs('sheet-title-label');
    input?.addEventListener('keydown', event => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      input.blur();
    });
    input?.addEventListener('change', () => {
      window.runStandaloneFileAction('シート名の変更', renameCurrentSheet);
    });
  }

  function bindMenus() {
    attachStandaloneMenu(qs('sheet-menu-button'), qs('sheet-menu'));
    document.addEventListener('click', async event => {
      const action = event.target.closest('[data-sheet-action]')?.dataset.sheetAction;
      if (!action) return;
      if (action === 'new') await window.runStandaloneFileAction('新規作成', createSheet);
      else if (action === 'open') await window.runStandaloneFileAction('シートを開くことが', openSheet);
      else if (action === 'workspace') window.MeldexStandaloneWorkspaceTree?.open?.();
      else if (action === 'importCsv') await window.runStandaloneFileAction('CSVを読み込むことが', importCsv);
      else if (action === 'exportCsv') await window.runStandaloneFileAction('CSVに書き出すことが', exportCsv);
      else if (action === 'reload') await window.runStandaloneFileAction('再読み込み', reloadSheet);
    });
  }

  function bindDbToolbar() {
    const controls = [
      ['sheet-tb-undo', () => window.meldexUndo()],
      ['sheet-tb-redo', () => window.meldexRedo()],
      ['sheet-tb-filter', () => window.showUnifiedFilterModal()],
      ['sheet-tb-sort', event => window.showDbSortMenu(event)],
      ['sheet-tb-cell-wrap', event => window.showDbCellWrapMenu(event)],
      ['sheet-tb-autofit', () => window.autoFitCurrentSheetColumns()],
      ['sheet-tb-columns', () => window.showColumnDisplayOrderModal()],
      ['sheet-tb-reload', reloadSheet],
    ];
    controls.forEach(([id, handler]) => {
      const button = qs(id);
      if (!button) return;
      const dependency = {
        'sheet-tb-undo': 'meldexUndo',
        'sheet-tb-redo': 'meldexRedo',
        'sheet-tb-filter': 'showUnifiedFilterModal',
        'sheet-tb-sort': 'showDbSortMenu',
        'sheet-tb-cell-wrap': 'showDbCellWrapMenu',
        'sheet-tb-autofit': 'autoFitCurrentSheetColumns',
        'sheet-tb-columns': 'showColumnDisplayOrderModal',
      }[id];
      if (dependency && typeof window[dependency] !== 'function') {
        button.hidden = true;
        return;
      }
      button.addEventListener('click', event => {
        Promise.resolve(handler(event)).catch(error => showStatus(error?.message || error, true));
      });
    });
  }

  function bindShortcuts() {
    document.addEventListener('keydown', async event => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      const key = String(event.key || '').toLowerCase();
      if (key === 'n') {
        event.preventDefault();
        await window.runStandaloneFileAction('新規作成', createSheet);
      } else if (key === 'o') {
        event.preventDefault();
        await window.runStandaloneFileAction('シートを開くことが', openSheet);
      } else if (key === 's') {
        event.preventDefault();
        showStatus('シートはセルを編集するたびに自動保存されます');
      }
    });
  }

  function initOptionPanel() {
    // 単独アプリはメインパネルのアプリが固定なので、ショートカット一覧の初期絞り込みを宣言する
    window.__meldexAppShortcutScope = 'database';
    window.MeldexStandaloneOptionPanel?.init({
      storagePrefix: 'meldex-sheet',
      toggleButtonIds: ['sheet-option-panel-button'],
      defaultWidth: 360,
    });
  }

  function initParityAdapter() {
    window.MeldexStandaloneParity?.init?.({
      appId: 'sheet',
      getPath: () => app.path,
      getLabel: () => folderTitle(app.path),
      openCurrent: openSheetPath,
      canReplaceCurrent,
    });
  }

  function bindUi() {
    initOptionPanel();
    initParityAdapter();
    bindMenus();
    bindTitleEditing();
    bindDbToolbar();
    bindShortcuts();
    window.MeldexStandaloneMobileToolbar?.setup({
      toolbar: '#sheet-db-toolbar',
      priority: ['#sheet-tb-undo', '#sheet-tb-redo', '#sheet-tb-filter', '#sheet-tb-sort'],
      keep: [],
      sheetTitle: 'その他',
    });
    window.MeldexStandaloneCloseGuard?.register?.({
      appId: 'sheet-editor',
      getCloseState: () => {
        const active = document.querySelector(
          '#pivot-table .cell-inline-input, #pivot-table .cell-inline-select, #pivot-table .cell-date-editor'
        );
        return {
          appId: 'sheet-editor',
          state: active ? 'editing' : 'clean',
          pendingLocal: !!active,
          saving: false,
          failed: false,
          unnamed: false,
          hasSnapshot: false,
          hasFinalDestination: !!app.path,
          shouldWarn: !!active,
          message: active ? '編集中のセルが確定していません' : '',
        };
      },
      prepareClose: async () => {
        const active = document.querySelector(
          '#pivot-table .cell-inline-input, #pivot-table .cell-inline-select, #pivot-table .cell-date-editor input'
        );
        active?.blur?.();
        await new Promise(resolve => setTimeout(resolve, 0));
        const remaining = document.querySelector(
          '#pivot-table .cell-inline-input, #pivot-table .cell-inline-select, #pivot-table .cell-date-editor'
        );
        if (remaining) {
          remaining.querySelector?.('input,textarea,select')?.focus?.();
          showStatus('セルの値を確定できません。入力内容を確認してください', true);
          return false;
        }
        return window.MeldexStandaloneSaveQueue?.flush?.() ?? true;
      },
      flushLocal: () => window.MeldexStandaloneSaveQueue?.flush?.() ?? Promise.resolve(true),
      flushFinal: () => window.MeldexStandaloneSaveQueue?.flush?.() ?? Promise.resolve(true),
    });
  }

  async function initializeData() {
    await MeldexStandaloneFS.init();
    const requested = normalizePath(new URLSearchParams(location.search).get('open') || '');
    const last = requested || normalizePath(safeStorageGet(LAST_SHEET_KEY));
    if (!last) {
      showView('welcome');
      return;
    }
    try {
      await openSheetPath(last);
    } catch (error) {
      safeStorageSet(LAST_SHEET_KEY, '');
      setPath('');
      showView('welcome');
      showStatus('前回のシートを開けませんでした: ' + (error?.message || error), true);
    }
  }

  window.MeldexStandaloneSheet = {
    createSheet,
    openSheet,
    openSheetPath,
    importCsv,
    exportCsv,
    getCurrentPath: () => app.path,
  };

  document.addEventListener('DOMContentLoaded', () => {
    window.MeldexStandaloneBoot = window.MeldexStandaloneBootstrap.create({
      appId: 'sheet',
      bindUi,
      initialize: initializeData,
      onError: error => showStatus('シートの保存先へ接続できません: ' + (error.message || error) + '。操作すると再試行します。', true),
    });
    window.MeldexStandaloneBoot.start().catch(() => {});
  });
})();
