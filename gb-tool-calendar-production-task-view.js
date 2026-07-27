/* gb-tool-calendar-production-task-view.js: schedule production task workspace
 * シート表を埋め込んで直接編集し、作品別タスクリストの切替だけを表の直上に置く。
 * 管理リストはカレンダー共通の上段タブから開き、制作操作は共通ツールバーへ集約する。
 * 選択中リストは component state と tab.state の双方へ保存して再構築後も復元する。
 */
(function() {
  'use strict';

  if (typeof CalendarComponent === 'undefined') return;

  const QUICK_WORK_TITLE = '新しい制作';
  const MANAGED_LISTS = [
    ['works', '作品設定', '作品リスト'],
    ['targets', '作業対象', '作業対象リスト'],
    ['contents', '作業内容', '作業内容リスト'],
    ['scales', '作業規模', '作業規模リスト'],
  ];

  function api() {
    if (!window.MeldexProductionApi) throw new Error('制作管理APIを初期化できませんでした');
    return window.MeldexProductionApi;
  }

  function icon(name, size = 14) {
    const span = document.createElement('span');
    span.className = 'gb-production-task-icon';
    if (typeof lucide === 'function') span.innerHTML = lucide(name, size);
    return span;
  }

  function notify(message, error = false) {
    if (typeof showStatus === 'function') showStatus(message, error);
  }

  function ensureProductionWritable(options) {
    return window.MeldexProductionUiAvailability?.ensureWritable?.(options) !== false;
  }

  function syncWriteAvailability(state) {
    const availability = window.MeldexProductionUiAvailability?.current?.()
      || { blocked: false, reason: '', kind: '' };
    if (state.root) {
      if (availability.blocked) state.root.dataset.productionWriteBlocked = availability.kind || 'blocked';
      else delete state.root.dataset.productionWriteBlocked;
    }
    if (state.writeAvailabilityEl) {
      state.writeAvailabilityEl.hidden = !availability.blocked;
      state.writeAvailabilityEl.textContent = availability.blocked
        ? `${availability.reason}。表示、選択、フィルタ、並べ替えは利用できます。`
        : '';
    }
    return availability;
  }

  function prop(row, name) {
    return row?.properties?.[name] ?? '';
  }

  function currentUser() {
    return typeof getUsername === 'function' ? String(getUsername() || '').trim() : '';
  }

  function localDateTime(date) {
    const pad = value => String(value).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  function initialDeadline() {
    const date = new Date();
    date.setDate(date.getDate() + 1);
    while (date.getDay() === 0 || date.getDay() === 6) date.setDate(date.getDate() + 1);
    date.setHours(18, 0, 0, 0);
    return localDateTime(date);
  }

  function makeButton(label, iconName, handler, primary = false) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'gb-production-task-button' + (primary ? ' primary' : '');
    if (iconName) button.appendChild(icon(iconName));
    button.appendChild(document.createTextNode(label));
    if (handler) button.addEventListener('click', handler);
    return button;
  }

  // ---------------------------------------------------------------------
  // state
  // ---------------------------------------------------------------------

  function stateFor(component) {
    if (!component._productionTaskState) {
      component._productionTaskState = {
        root: null,
        listBarEl: null,
        writeAvailabilityEl: null,
        embedHostEl: null,
        embed: null,
        allView: null,
        quickDialog: null,
        sheets: [],
        pmRootPath: '',
        sheetsLoaded: false,
        sheetsLoading: false,
        sheetsError: '',
        sheetsLoadSeq: 0,
        workMeta: {},
        selection: null,
        pendingTabKey: '',
        lastTaskSheetName: component.state?.productionTaskLastSheetName || '',
        // タスクリスト面で最後に見ていたのが「すべて」か作品別か（surfaceタブ往復時の復元用）
        lastTasksMode: component.state?.productionTaskSelection?.kind === 'all' ? 'all' : '',
        addingList: false,
        quickPreview: null,
        quickPreviewSignature: '',
        quickPreviewRequestId: 0,
      };
    }
    return component._productionTaskState;
  }

  function syncQuickPlanToolbar(component, state) {
    const button = component.el?.querySelector?.('[data-e2e-id="gb-production-quick-open"]');
    const dropboxMode = !!window.MeldexRuntimeAdapter?.isDropboxMode?.();
    const recalculateButton = component.el?.querySelector?.('[data-e2e-id="gb-production-task-recalculate"]');
    if (recalculateButton) {
      recalculateButton.disabled = dropboxMode;
      recalculateButton.title = dropboxMode ? '再計算はデスクトップ版で実行してください' : '再計算';
      recalculateButton.setAttribute('aria-label', dropboxMode ? '再計算（デスクトップ版のみ）' : '再計算');
    }
    if (!button) return;
    const taskSelected = state.selection?.kind === 'task';
    const allSelected = state.selection?.kind === 'all';
    const managedSelected = state.selection?.kind === 'managed' || !!managedListInfo(state.pendingTabKey);
    const ready = !dropboxMode && state.sheetsLoaded && !state.sheetsLoading && taskSelected;
    button.disabled = !ready;
    button.setAttribute('aria-busy', state.sheetsLoading ? 'true' : 'false');
    button.title = dropboxMode ? 'かんたん割当はデスクトップ版で実行してください'
      : ready ? 'かんたん割当'
      : allSelected ? 'かんたん割当は作品別のタブで利用できます'
      : managedSelected ? 'かんたん割当はタスクリストで利用できます'
      : (state.sheetsError ? 'タスクリストを読み込めませんでした' : 'タスクリストを読み込み中');
    button.setAttribute('aria-label', dropboxMode ? 'かんたん割当（デスクトップ版のみ）' : 'かんたん割当');
  }

  function productionSheetDisplayReady(state) {
    const path = String(state.selection?.path || '');
    const ctx = state.embed?.ctx;
    return !!path && !state.sheetsLoading
      && state.embed?.getCurrentPath?.() === path
      && ctx?.dbPath === path
      && !!ctx.pivotData;
  }

  function syncSheetDisplayToolbar(component, state) {
    const ready = productionSheetDisplayReady(state);
    const allSelected = state.selection?.kind === 'all';
    ['gb-production-sheet-auto-fit', 'gb-production-sheet-column-display-order', 'gb-production-sheet-filter', 'gb-production-sheet-sort'].forEach(id => {
      const button = component.el?.querySelector?.(`[data-e2e-id="${id}"]`);
      if (!button) return;
      if (allSelected) {
        // 「すべて」は複数シートの縦積み表示のため、単一シート前提の表示操作は
        // 読み込み待ち(aria-busy)ではなく明示的に無効として案内する。
        button.disabled = true;
        button.setAttribute('aria-busy', 'false');
        button.title = '列幅調整・フィルタ・並べ替えは作品別のタブで利用できます';
        return;
      }
      button.disabled = !ready;
      button.setAttribute('aria-busy', ready ? 'false' : 'true');
      if (!ready) button.title = '表示中のシートを読み込んでから利用できます';
      else button.title = button.getAttribute('aria-label') || '';
    });
  }

  function managedListInfo(managedKey) {
    return MANAGED_LISTS.find(([key]) => key === managedKey) || null;
  }

  function managedPath(state, sheetName) {
    return state.pmRootPath ? `${state.pmRootPath}/シート/${sheetName}` : '';
  }

  function buildWorkMeta(listData) {
    const meta = {};
    (listData?.rows || []).forEach(row => {
      const title = row.name || prop(row, '作品タイトル_話数');
      if (!title) return;
      const labels = String(prop(row, '階層ラベル') || '').split(/[,、]/).map(part => part.trim()).filter(Boolean).slice(0, 3);
      meta[title] = {
        classification_labels: labels,
        classification_count: Number(prop(row, '階層数')) || labels.length,
      };
    });
    return meta;
  }

  // ---------------------------------------------------------------------
  // sheet-list / work-meta loading
  // ---------------------------------------------------------------------

  async function loadSheetsAndMeta(component, state, options = {}) {
    if (state.sheetsLoading && !options.force) return;
    const seq = ++state.sheetsLoadSeq;
    state.sheetsLoading = true;
    state.sheetsError = '';
    syncQuickPlanToolbar(component, state);
    syncSheetDisplayToolbar(component, state);
    renderListBar(component, state);
    try {
      let sheetData;
      let workData;
      if (typeof api().taskCreateCatalog === 'function') {
        try {
          const snapshot = await api().taskCreateCatalog();
          sheetData = { root: snapshot?.root || '', sheets: snapshot?.task_sheets || [] };
          workData = snapshot?.works || { rows: [] };
        } catch (_error) {
          // Compatibility for Cloud providers from before the combined catalog read.
        }
      }
      if (!sheetData) {
        [sheetData, workData] = await Promise.all([
          api().taskSheets(),
          api().list('作品リスト', { limit: 1000 }).catch(() => ({ rows: [] })),
        ]);
      }
      if (seq !== state.sheetsLoadSeq) return;
      state.sheets = Array.isArray(sheetData?.sheets) ? sheetData.sheets : [];
      state.pmRootPath = String(sheetData?.root || '').replace(/[\\/]+$/, '');
      state.workMeta = buildWorkMeta(workData);
      state.sheetsLoaded = true;
      ensureSelectionDefault(component, state);
    } catch (error) {
      if (seq !== state.sheetsLoadSeq) return;
      state.sheetsError = error?.message || 'タスクリストを読み込めませんでした';
    } finally {
      if (seq === state.sheetsLoadSeq) state.sheetsLoading = false;
    }
    syncQuickPlanToolbar(component, state);
    syncSheetDisplayToolbar(component, state);
    renderListBar(component, state);
    component._syncSurfaceControls?.();
    if (state.selection) openSelectionIfNeeded(component, state);
    else state.allView?.setVisible(false);
  }

  function preferredTaskSheet(component, state) {
    const sheetName = state.lastTaskSheetName || component.state?.productionTaskLastSheetName || '';
    return state.sheets.find(sheet => sheet.sheet_name === sheetName) || state.sheets[0] || null;
  }

  function ensureSelectionDefault(component, state) {
    const requestedTab = state.pendingTabKey;
    if (requestedTab === 'tasks') {
      if (state.lastTasksMode === 'all' && state.sheets.length) {
        selectAllLists(component, state, { persist: false, open: false });
        return;
      }
      const sheet = preferredTaskSheet(component, state);
      if (sheet) selectTaskList(component, state, sheet, { persist: false, open: false });
      else { state.pendingTabKey = ''; state.selection = null; }
      return;
    }
    if (requestedTab) {
      const managed = managedListInfo(requestedTab);
      if (managed) { selectManagedList(component, state, managed, { persist: false, open: false }); return; }
      state.pendingTabKey = '';
    }
    if (state.selection) {
      if (state.selection.kind === 'all') {
        if (state.sheets.length) return;
        state.selection = null;
      } else {
        if (state.selection.kind === 'managed') {
          const managed = managedListInfo(state.selection.managedKey);
          if (managed) {
            state.selection.path = managedPath(state, managed[2]);
            return;
          }
        }
        if (state.sheets.some(sheet => sheet.sheet_name === state.selection.sheetName)) return;
      }
    }
    const pending = component.state?.productionTaskSelection;
    if (pending?.kind === 'all' && state.sheets.length) {
      selectAllLists(component, state, { persist: false, open: false });
      return;
    }
    if (pending?.kind === 'managed') {
      const managed = managedListInfo(pending.managedKey);
      if (managed) { selectManagedList(component, state, managed, { persist: false, open: false }); return; }
    } else if (pending?.kind === 'task' && pending.sheetName) {
      const sheet = state.sheets.find(item => item.sheet_name === pending.sheetName);
      if (sheet) { selectTaskList(component, state, sheet, { persist: false, open: false }); return; }
    }
    if (state.sheets.length) selectTaskList(component, state, state.sheets[0], { persist: false, open: false });
    else state.selection = null;
  }

  // ---------------------------------------------------------------------
  // selection
  // ---------------------------------------------------------------------

  function selectTaskList(component, state, sheet, options = {}) {
    state.addingList = false;
    state.pendingTabKey = '';
    state.lastTaskSheetName = sheet.sheet_name;
    state.lastTasksMode = 'sheet';
    state.selection = { kind: 'task', workTitle: sheet.work_title || sheet.sheet_name, sheetName: sheet.sheet_name, path: sheet.dir, label: sheet.work_title || sheet.sheet_name };
    renderListBar(component, state);
    component._syncSurfaceControls?.();
    syncQuickPlanToolbar(component, state);
    syncSheetDisplayToolbar(component, state);
    if (options.persist !== false) persistSelection(component, state);
    if (options.open !== false) {
      return openSelectionIfNeeded(component, state, { refreshCurrent: options.refreshCurrent === true });
    }
    return Promise.resolve(true);
  }

  // 「すべて」: 全作品のタスクリストを縦積みで一括表示する（各ブロックはその場で編集可能）
  function selectAllLists(component, state, options = {}) {
    if (!state.sheets.length) return Promise.resolve(false);
    state.addingList = false;
    state.pendingTabKey = '';
    state.lastTasksMode = 'all';
    state.selection = { kind: 'all', label: 'すべて', workTitle: '', sheetName: '', path: '' };
    renderListBar(component, state);
    component._syncSurfaceControls?.();
    syncQuickPlanToolbar(component, state);
    syncSheetDisplayToolbar(component, state);
    if (options.persist !== false) persistSelection(component, state);
    if (options.open !== false) {
      return openSelectionIfNeeded(component, state, { refreshCurrent: options.refreshCurrent === true });
    }
    return Promise.resolve(true);
  }

  // selectManagedList 自体は async 関数だが、await を使わないため呼び出しと
  // 同じ同期ターン内で完了する（作品設定/作業対象/作業内容/作業規模タブの
  // 選択タイミングに余計な非同期の一拍を持ち込まない）。
  async function selectManagedList(component, state, managedInfo, options = {}) {
    const [key, label, sheetName] = managedInfo;
    state.addingList = false;
    state.pendingTabKey = '';
    state.selection = { kind: 'managed', managedKey: key, label, sheetName, path: managedPath(state, sheetName) };
    renderListBar(component, state);
    component._syncSurfaceControls?.();
    syncQuickPlanToolbar(component, state);
    syncSheetDisplayToolbar(component, state);
    if (options.persist !== false) persistSelection(component, state);
    if (options.open !== false) openSelectionIfNeeded(component, state);
  }

  function persistSelection(component, state) {
    if (!component.state) return;
    component.state.productionTaskSelection = state.selection ? {
      kind: state.selection.kind,
      workTitle: state.selection.workTitle || '',
      sheetName: state.selection.sheetName || '',
      managedKey: state.selection.managedKey || '',
    } : null;
    component.state.productionTaskLastSheetName = state.lastTaskSheetName || '';
    if (typeof component._persistViewToTabState === 'function') component._persistViewToTabState(component._view);
  }

  function persistPendingTab(component, state, key) {
    if (!component.state) return;
    component.state.productionTaskSelection = key === 'tasks'
      ? (state.lastTasksMode === 'all'
        ? { kind: 'all', workTitle: '', sheetName: '', managedKey: '' }
        : { kind: 'task', workTitle: '', sheetName: state.lastTaskSheetName || '', managedKey: '' })
      : { kind: 'managed', workTitle: '', sheetName: '', managedKey: key };
    component.state.productionTaskLastSheetName = state.lastTaskSheetName || '';
    component._persistViewToTabState?.(component._view);
  }

  async function openSelectionIfNeeded(component, state, options = {}) {
    syncSheetDisplayToolbar(component, state);
    if (!state.selection || !state.embed) return false;
    if (state.selection.kind === 'all') return openAllView(component, state, options);
    state.allView?.setVisible(false);
    state.embed.setVisible(true);
    if (!state.selection.path) {
      notify('制作管理の保存場所を確認できませんでした', true);
      return false;
    }
    const currentPath = state.embed.getCurrentPath();
    const currentReady = currentPath === state.selection.path
      && state.embed.ctx?.dbPath === state.selection.path
      && !!state.embed.ctx?.pivotData;
    if (currentReady) {
      if (options.refreshCurrent === true) {
        const refreshed = !!(await state.embed.refresh());
        syncSheetDisplayToolbar(component, state);
        return refreshed;
      }
      syncSheetDisplayToolbar(component, state);
      return true;
    }
    // 先行する open() が後発の選択に追い越された場合、getCurrentPath() だけが
    // 一致して ctx.pivotData が空のまま残ることがある。同一パスでも実データが
    // 揃っていなければ必ず再読込し、空表示を固定化させない。
    const opened = !!(await state.embed.open(state.selection.path, {
      forceReload: currentPath === state.selection.path,
    }));
    syncSheetDisplayToolbar(component, state);
    return opened;
  }

  // 「すべて」表示用の縦積みビューを開く（インスタンスは初回選択時に生成して使い回す）
  async function openAllView(component, state, options = {}) {
    if (!window.MeldexProductionAllView) {
      notify('すべて表示を初期化できませんでした', true);
      return false;
    }
    if (!state.allView) {
      state.allView = window.MeldexProductionAllView.create({
        idSuffix: (component.tabId || component.paneId || 'production') + '-all',
      });
    }
    if (!state.allView.isMounted()) state.allView.mount(state.embedHostEl);
    state.embed?.setVisible(false);
    state.allView.setVisible(true);
    // ブロック順はタブバーの並び順に合わせる（閉じたタブのシートも末尾に含めて表示する）
    const tabsModule = window.MeldexProductionListTabs;
    const arranged = tabsModule ? tabsModule.arrange(state.sheets, state.pmRootPath) : null;
    const orderedSheets = arranged ? arranged.visible.concat(arranged.hidden) : state.sheets;
    const opened = await state.allView.open(orderedSheets, { refresh: options.refreshCurrent === true });
    syncSheetDisplayToolbar(component, state);
    return opened;
  }

  async function refreshEmbedAfterMutation(component) {
    const state = stateFor(component);
    if (state.selection?.kind === 'all') {
      if (!state.allView?.isMounted?.()) return { ok: true, skipped: true };
      return { ok: !!(await state.allView.refresh()) };
    }
    if (!state.embed || !state.embed.getCurrentPath()) return { ok: true, skipped: true };
    const ok = await state.embed.refresh();
    return { ok: !!ok };
  }

  // ---------------------------------------------------------------------
  // list switch bar (rebuilt in place, without touching the embed)
  // ---------------------------------------------------------------------

  function listSwitchButton(label, active, e2eId, onSelect) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'gb-production-list-switch-btn' + (active ? ' is-active' : '');
    button.setAttribute('role', 'tab');
    button.setAttribute('aria-selected', active ? 'true' : 'false');
    button.tabIndex = active ? 0 : -1;
    button.dataset.e2eId = e2eId;
    button.textContent = label;
    button.addEventListener('click', onSelect);
    return button;
  }

  function buildAddListControl(component, state) {
    const wrap = document.createElement('span');
    wrap.className = 'gb-production-list-switch-add';
    if (!state.addingList) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'gb-production-list-switch-btn gb-production-list-switch-add-btn';
      button.title = 'タスクリストを追加';
      button.setAttribute('aria-label', 'タスクリストを追加');
      button.dataset.e2eId = 'gb-production-list-switch-add-open';
      button.appendChild(icon('plus', 14));
      window.MeldexProductionUiAvailability?.markWriteControl?.(button);
      button.addEventListener('click', () => {
        state.addingList = true;
        renderListBar(component, state);
        state.listBarEl?.querySelector('[data-e2e-id="gb-production-list-switch-add-input"]')?.focus();
      });
      wrap.appendChild(button);
      return wrap;
    }
    const form = document.createElement('form');
    form.className = 'gb-production-list-switch-add-form';
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = '作品名（新しいタスクリスト）';
    input.dataset.e2eId = 'gb-production-list-switch-add-input';
    input.setAttribute('aria-label', '新しいタスクリストの作品名');
    window.MeldexProductionUiAvailability?.markWriteControl?.(input);
    const cancel = () => { state.addingList = false; renderListBar(component, state); };
    input.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); cancel(); }
    });
    const confirmBtn = document.createElement('button');
    confirmBtn.type = 'submit';
    confirmBtn.className = 'gb-production-list-switch-add-confirm';
    confirmBtn.dataset.e2eId = 'gb-production-list-switch-add-confirm';
    confirmBtn.setAttribute('aria-label', '追加を確定');
    confirmBtn.appendChild(icon('check', 14));
    window.MeldexProductionUiAvailability?.markWriteControl?.(confirmBtn);
    window.MeldexProductionUiAvailability?.markWriteForm?.(form);
    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'gb-production-list-switch-add-cancel';
    cancelBtn.setAttribute('aria-label', 'キャンセル');
    cancelBtn.appendChild(icon('x', 14));
    cancelBtn.addEventListener('click', cancel);
    form.append(input, confirmBtn, cancelBtn);
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (!ensureProductionWritable()) return;
      const workTitle = input.value.trim();
      if (!workTitle) { input.focus(); return; }
      confirmBtn.disabled = true;
      cancelBtn.disabled = true;
      input.disabled = true;
      try {
        const created = await api().createTaskSheet({ work_title: workTitle });
        state.addingList = false;
        await loadSheetsAndMeta(component, state, { force: true });
        const sheet = state.sheets.find(item => item.sheet_name === created.sheet_name)
          || { sheet_name: created.sheet_name, work_title: created.work_title, dir: created.dir };
        selectTaskList(component, state, sheet);
        notify(`「${sheet.work_title}」のタスクリストを追加しました`);
      } catch (error) {
        notify(error?.message || 'タスクリストを追加できませんでした', true);
        confirmBtn.disabled = false;
        cancelBtn.disabled = false;
        input.disabled = false;
        input.focus();
      }
    });
    wrap.appendChild(form);
    return wrap;
  }

  function renderListBar(component, state) {
    const bar = state.listBarEl;
    if (!bar) return;
    const managedActive = !!managedListInfo(state.pendingTabKey) || state.selection?.kind === 'managed';
    bar.hidden = managedActive;
    bar.replaceChildren();
    if (managedActive) return;
    if (state.sheetsLoading && !state.sheetsLoaded) {
      const loading = document.createElement('span');
      loading.className = 'gb-production-list-switch-loading';
      loading.textContent = 'タスクリストを読み込み中…';
      bar.appendChild(loading);
      return;
    }
    if (state.sheetsError && !state.sheetsLoaded) {
      const error = document.createElement('span');
      error.className = 'gb-production-list-switch-error';
      error.textContent = state.sheetsError;
      bar.appendChild(error);
      bar.appendChild(makeButton('再試行', 'refreshCw', () => loadSheetsAndMeta(component, state, { force: true })));
      return;
    }
    const tabsModule = window.MeldexProductionListTabs || null;
    const arranged = tabsModule
      ? tabsModule.arrange(state.sheets, state.pmRootPath)
      : { visible: state.sheets, hidden: [] };
    if (state.sheets.length) {
      const allButton = listSwitchButton('すべて', state.selection?.kind === 'all', 'gb-production-list-switch-all', () => selectAllLists(component, state));
      // classList はテスト用DOMスタブに無いため className 連結で付与する
      allButton.className += ' gb-production-list-switch-all-btn';
      allButton.title = '全作品のタスクリストをまとめて表示';
      bar.appendChild(allButton);
    }
    arranged.visible.forEach((sheet, index) => {
      const active = state.selection?.kind === 'task' && state.selection.sheetName === sheet.sheet_name;
      // 作品名など日本語主体の文字列を潰さないよう、Unicodeの文字/数字はそのまま保持する
      // (ASCII限定の置換だと別作品同士のe2e-idが衝突し得るため)。
      const e2eId = 'gb-production-list-switch-task-' + sheet.sheet_name.replace(/[^\p{L}\p{N}_-]+/gu, '-');
      const button = listSwitchButton(sheet.work_title || sheet.sheet_name, active, e2eId, () => selectTaskList(component, state, sheet));
      tabsModule?.decorateTab(button, {
        sheetName: sheet.sheet_name,
        pmRoot: state.pmRootPath,
        sheets: state.sheets,
        canSwapLeft: index > 0,
        canSwapRight: index < arranged.visible.length - 1,
        onChanged: () => {
          renderListBar(component, state);
          // 「すべて」表示中はブロック順もタブ順へ即追従させる
          if (state.selection?.kind === 'all') openSelectionIfNeeded(component, state);
        },
        onHide: () => hideListTab(component, state, sheet),
      });
      bar.appendChild(button);
    });
    bar.appendChild(buildAddListControl(component, state));
    if (tabsModule && arranged.hidden.length) {
      bar.appendChild(tabsModule.buildHiddenMenuButton(arranged.hidden, {
        pmRoot: state.pmRootPath,
        sheets: state.sheets,
        onReopen: sheet => selectTaskList(component, state, sheet),
      }));
    }
    if (state.selection?.kind === 'task') {
      const structureButton = makeButton(
        'タスク構成を更新',
        'panelsTopLeft',
        event => openTaskStructureDialog(component, state, event.currentTarget),
      );
      structureButton.dataset.e2eId = 'gb-production-task-structure-open';
      structureButton.title = '作品設定のページ数・見開きページを未着手タスクへ反映';
      window.MeldexProductionUiAvailability?.markWriteControl?.(structureButton);
      bar.appendChild(structureButton);
    }
  }

  // タブを閉じる＝リスト切替バーからの非表示（タスクリスト本体は削除しない）。
  // 表示中のタブを閉じた場合は「すべて」へ退避して、表が空にならないようにする。
  function hideListTab(component, state, sheet) {
    const tabsModule = window.MeldexProductionListTabs;
    if (!tabsModule?.hideTab(state.pmRootPath, state.sheets, sheet.sheet_name)) return;
    notify(`「${sheet.work_title || sheet.sheet_name}」のタブを閉じました。「＋」の隣のボタンから再表示できます`);
    if (state.selection?.kind === 'task' && state.selection.sheetName === sheet.sheet_name) {
      selectAllLists(component, state);
      return;
    }
    renderListBar(component, state);
  }

  function openTaskStructureDialog(component, state, trigger) {
    if (!ensureProductionWritable()) return null;
    const workTitle = String(state.selection?.workTitle || '').trim();
    if (!workTitle || !window.GBUI?.createModal) {
      notify('作品別タスクリストを選択してから実行してください', true);
      return null;
    }
    const panel = document.createElement('section');
    panel.className = 'gb-production-quick-plan';
    panel.dataset.e2eId = 'gb-production-task-structure-dialog';
    const intro = document.createElement('p');
    intro.textContent = `「${workTitle}」のページ数・見開き設定を、未着手タスクへ反映します。進行中・完了・予定済み・実績あり・固定済みのタスクは変更しません。`;
    const summary = document.createElement('div');
    summary.className = 'gb-production-bulk-summary';
    summary.setAttribute('role', 'status');
    summary.setAttribute('aria-live', 'polite');
    summary.textContent = '変更内容を確認しています…';
    const detail = document.createElement('p');
    detail.className = 'gb-production-bulk-result';
    detail.setAttribute('role', 'alert');
    panel.append(intro, summary, detail);

    const cancel = makeButton('閉じる', 'x');
    const apply = makeButton('この構成に更新', 'check', null, true);
    apply.dataset.e2eId = 'gb-production-task-structure-apply';
    apply.disabled = true;
    let preview = null;
    let busy = true;
    const dialog = window.GBUI.createModal({
      title: 'タスク構成を更新',
      body: panel,
      footer: [cancel, apply],
      closeLabel: 'タスク構成の更新を閉じる',
      closeOnOverlay: false,
      closeOnEsc: false,
      extraClass: 'gb-production-modal',
    });
    const setBusy = value => {
      busy = !!value;
      dialog.modal.setAttribute('aria-busy', busy ? 'true' : 'false');
      cancel.disabled = busy;
      apply.disabled = busy || !preview?.apply_allowed;
      apply.textContent = busy ? '処理中…' : 'この構成に更新';
    };
    const close = () => { if (!busy) dialog.close?.(); };
    cancel.addEventListener('click', close);
    apply.addEventListener('click', async () => {
      if (!preview?.fingerprint || busy) return;
      setBusy(true);
      detail.textContent = '';
      try {
        const result = await api().applyTaskStructure({
          work_title: workTitle,
          fingerprint: preview.fingerprint,
        });
        await loadSheetsAndMeta(component, state, { force: true });
        await component._showProductionTaskWork?.(workTitle);
        document.dispatchEvent(new CustomEvent('meldex:production-task-updated', {
          detail: { workTitle, sourceComponent: component, structureUpdated: true },
        }));
        notify(
          `${Number(result.created || 0).toLocaleString('ja-JP')}件を作成し、`
          + `${Number(result.archived || 0).toLocaleString('ja-JP')}件をアーカイブしました。`
          + '必要に応じて「再計算」を実行してください。',
        );
        busy = false;
        dialog.close?.();
      } catch (error) {
        detail.textContent = error?.message || 'タスク構成を更新できませんでした。もう一度プレビューしてください。';
        setBusy(false);
      }
    });
    document.body.appendChild(dialog.overlay);
    window.GBModalShell?.enhanceOverlay?.(dialog.overlay);
    setBusy(true);
    api().previewTaskStructure({ work_title: workTitle }).then((data) => {
      preview = data;
      const units = (data.page_units || []).join('、');
      summary.textContent = [
        `ページ単位: ${units || '変更なし'}`,
        `新規 ${Number(data.create_count || 0)}件`,
        `アーカイブ ${Number(data.archive_count || 0)}件`,
        `保護して維持 ${Number(data.protected_count || 0)}件`,
        `変更なし ${Number(data.unchanged_count || 0)}件`,
      ].join(' ／ ');
      detail.textContent = data.protected_count
        ? '作業中・予定済みなどの保護対象は元の構成のまま残ります。'
        : data.apply_allowed ? '内容を確認して「この構成に更新」を押してください。' : '更新が必要なタスクはありません。';
      setBusy(false);
    }).catch((error) => {
      detail.textContent = error?.message || '変更内容を確認できませんでした。';
      setBusy(false);
    });
    return dialog;
  }

  // ---------------------------------------------------------------------
  // quick plan dialog (かんたん割当)
  // ---------------------------------------------------------------------

  function openQuickPlanDialog(component, state, trigger) {
    if (state.quickDialog?.modal?.isConnected) {
      state.quickDialog.modal.focus?.();
      return state.quickDialog;
    }
    const focusSource = trigger || (
      typeof HTMLElement !== 'undefined' && document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null
    );
    if (!window.GBUI?.createModal) {
      notify('かんたん割当画面を初期化できませんでした', true);
      return null;
    }
    if (!state.sheetsLoaded || state.sheetsLoading || state.selection?.kind !== 'task') {
      notify(state.selection?.kind === 'all' ? 'かんたん割当は作品別のタブで利用できます'
        : state.selection?.kind === 'managed' ? 'かんたん割当はタスクリストで利用できます'
        : (state.sheetsError || 'タスクリストを読み込み中です'), !!state.sheetsError);
      return null;
    }
    const panel = document.createElement('section');
    panel.className = 'gb-production-quick-plan';
    panel.dataset.e2eId = 'gb-production-quick-plan';

    const form = document.createElement('form');
    form.className = 'gb-production-quick-plan-form';
    const taskLabel = document.createElement('label');
    const taskLabelText = document.createElement('span');
    taskLabelText.className = 'gb-production-quick-field-label';
    taskLabelText.textContent = 'タスク数';
    const taskCount = document.createElement('input');
    taskCount.type = 'number';
    taskCount.min = '1';
    taskCount.max = '1000';
    taskCount.step = '1';
    taskCount.value = '1';
    taskCount.required = true;
    taskCount.dataset.e2eId = 'gb-production-quick-count';
    taskLabel.append(taskLabelText, taskCount);
    const deadlineLabel = document.createElement('label');
    const deadlineLabelText = document.createElement('span');
    deadlineLabelText.className = 'gb-production-quick-field-label';
    deadlineLabelText.textContent = '締切日時';
    const deadline = document.createElement('input');
    deadline.type = 'datetime-local';
    deadline.value = initialDeadline();
    deadline.required = true;
    deadline.dataset.e2eId = 'gb-production-quick-deadline';
    deadlineLabel.append(deadlineLabelText, deadline);
    const preview = makeButton('割り当て案を作成', 'sparkles', null, true);
    preview.type = 'submit';
    preview.dataset.e2eId = 'gb-production-quick-preview';
    form.append(taskLabel, deadlineLabel, preview);

    const details = document.createElement('details');
    details.className = 'gb-production-quick-advanced';
    const summary = document.createElement('summary');
    const summaryIcon = icon('chevronRight', 14);
    summaryIcon.classList.add('gb-production-quick-chevron');
    summary.append(summaryIcon, document.createTextNode('詳細設定'));
    const workLabel = document.createElement('label');
    const workLabelText = document.createElement('span');
    workLabelText.className = 'gb-production-quick-field-label';
    workLabelText.textContent = '作品（任意）';
    const work = document.createElement('select');
    work.dataset.e2eId = 'gb-production-quick-work';
    const blank = document.createElement('option');
    blank.value = '';
    blank.textContent = '新しい制作として作成';
    work.appendChild(blank);
    const currentWorkTitle = state.selection?.kind === 'task' ? (state.selection.workTitle || '') : '';
    const workNames = new Set(Object.keys(state.workMeta || {}));
    if (currentWorkTitle) workNames.add(currentWorkTitle);
    [...workNames].sort((a, b) => a.localeCompare(b, 'ja', { numeric: true })).forEach(name => {
      const option = document.createElement('option');
      option.value = name;
      option.textContent = name;
      work.appendChild(option);
    });
    work.value = currentWorkTitle;
    workLabel.append(workLabelText, work);
    details.append(summary, workLabel);

    const assumption = document.createElement('div');
    assumption.className = 'gb-production-assumption-note';
    const user = currentUser();
    assumption.appendChild(icon('info'));
    const note = document.createElement('span');
    note.textContent = '自動で前提を補いました';
    assumption.appendChild(note);
    assumption.insertAdjacentHTML('beforeend', ' ' + fieldHelp(`担当者は${user || '現在のユーザー（未確認）'}のみ。勤務時間は登録シフト、標準勤務時間の順で使い、未設定なら平日9:00〜18:00（12:00〜13:00休憩・残業なし）を一時利用します。`));

    const result = document.createElement('div');
    result.className = 'gb-production-quick-result';
    result.dataset.e2eId = 'gb-production-quick-result';
    const apply = makeButton('この案を適用', 'check', null, true);
    apply.dataset.e2eId = 'gb-production-quick-apply';
    apply.disabled = true;
    const dismiss = makeButton('閉じる', 'x');
    dismiss.dataset.e2eId = 'gb-production-quick-cancel';

    const hasMeaningfulFocus = active => !!(
      active
      && active.isConnected
      && active !== document.body
      && active !== document.documentElement
      && active !== focusSource
      && active.getClientRects?.().length
    );

    const restoreFocus = () => {
      // モーダル中はスマホ用メニューボタンがhiddenになるため、除去後の状態を先に同期する。
      window.MeldexCloudMobile?.refresh?.();
      window.MeldexCloudMobileEditBar?.refresh?.();
      if (!focusSource?.isConnected || focusSource.disabled) return true;
      const active = document.activeElement;
      if (hasMeaningfulFocus(active)) return true;
      if (focusSource.hidden || !focusSource.getClientRects?.().length) return false;
      try { focusSource?.focus?.({ preventScroll: true }); } catch (_error) { focusSource?.focus?.(); }
      return document.activeElement === focusSource;
    };
    const restoreFocusAfterClose = () => {
      // GBUI.close() は onClose の後で overlay を外す。次のタスクで戻すことで、
      // ブラウザが「フォーカス中のモーダルを除去した」後に行うBODYへの復帰と競合しない。
      // その後もスマホのキーボード終了・editbar同期が落ち着く間だけ状態を見守る。
      let remaining = 12;
      const retry = () => {
        if (remaining-- > 0) window.setTimeout?.(attempt, 50);
      };
      const attempt = () => {
        // モバイルではGBModalShellが退場アニメーション後にoverlayを実際に除去する。
        // closing中の閉じるボタンへフォーカスが残っていても、除去完了まで待つ。
        if (dialog?.overlay?.isConnected) {
          retry();
          return;
        }
        if (!focusSource?.isConnected || focusSource.disabled) return;
        const active = document.activeElement;
        if (hasMeaningfulFocus(active)) return;
        if (active !== focusSource) restoreFocus();
        retry();
      };
      if (typeof queueMicrotask === 'function') queueMicrotask(attempt);
      else Promise.resolve().then(attempt);
    };
    let dialog = null;
    let closed = false;
    let applying = false;
    let headerCloseButton = null;
    const close = (force = false) => {
      if (applying && !force) return;
      dialog?.close?.();
    };
    const setApplying = value => {
      applying = !!value;
      dismiss.disabled = applying;
      if (headerCloseButton) headerCloseButton.disabled = applying;
    };
    dismiss.addEventListener('click', () => close());

    const payload = () => ({
      mode: 'equal_until_deadline',
      staff_scope: 'current_user',
      current_user: currentUser(),
      task_count: Number(taskCount.value),
      deadline: deadline.value,
      // 対象未選択時も既存作品を横断しない。バックエンドはこの仮作品へ
      // 不足分のタスクを作成し、task_count 件だけを割り当てる。
      work_title: work.value || QUICK_WORK_TITLE,
    });
    const payloadSignature = () => JSON.stringify(payload());
    const invalidatePreview = () => {
      state.quickPreviewRequestId += 1;
      state.quickPreview = null;
      state.quickPreviewSignature = '';
      apply.disabled = true;
      preview.disabled = false;
      result.replaceChildren();
    };
    taskCount.addEventListener('input', invalidatePreview);
    deadline.addEventListener('input', invalidatePreview);
    work.addEventListener('change', invalidatePreview);
    form.addEventListener('submit', async event => {
      event.preventDefault();
      const requestedPayload = payload();
      const requestedSignature = JSON.stringify(requestedPayload);
      const requestId = ++state.quickPreviewRequestId;
      state.quickPreview = null;
      state.quickPreviewSignature = '';
      apply.disabled = true;
      preview.disabled = true;
      result.replaceChildren();
      try {
        const data = await api().recalculateEqual(requestedPayload);
        if (requestId !== state.quickPreviewRequestId || requestedSignature !== payloadSignature()) return;
        state.quickPreview = data;
        state.quickPreviewSignature = requestedSignature;
        renderQuickResult(component, state, result, data, { taskCount, deadline, apply, close });
      } catch (error) {
        if (requestId !== state.quickPreviewRequestId) return;
        const errorText = document.createElement('p');
        errorText.className = 'is-error';
        errorText.textContent = error?.message || '割り当て案を作成できませんでした';
        result.appendChild(errorText);
      } finally {
        if (requestId === state.quickPreviewRequestId) preview.disabled = false;
      }
    });
    apply.addEventListener('click', async event => {
      const button = event.currentTarget;
      const approvedPayload = payload();
      const approvedSignature = JSON.stringify(approvedPayload);
      if (!state.quickPreview?.apply_allowed || !state.quickPreviewSignature || state.quickPreviewSignature !== approvedSignature) {
        invalidatePreview();
        notify('条件が変わったため、割り当て案をもう一度作成してください', true);
        return;
      }
      button.disabled = true;
      preview.disabled = true;
      taskCount.disabled = true;
      deadline.disabled = true;
      work.disabled = true;
      setApplying(true);
      let appliedSuccessfully = false;
      try {
        const applied = await api().recalculateEqual(approvedPayload, { apply: true });
        if (applied?.blocked) throw new Error('締切までの空き時間が足りないため適用しませんでした');
        notify(`${Number(applied?.applied || 0)}件の担当者と時間を割り当てました`);
        appliedSuccessfully = true;
        state.quickPreview = null;
        state.quickPreviewSignature = '';
        const [, calendarRefresh] = await Promise.all([refreshEmbedAfterMutation(component), refreshCalendarEvents(component)]);
        if (calendarRefresh?.ok === false) {
          notify('割り当ては完了しましたが、カレンダーを再読み込みできませんでした。カレンダーを再読み込みしてください', true);
        }
      } catch (error) {
        notify(error?.message || '割り当てを適用できませんでした', true);
      } finally {
        if (appliedSuccessfully) close(true);
        else {
          setApplying(false);
          preview.disabled = false;
          taskCount.disabled = false;
          deadline.disabled = false;
          work.disabled = false;
          button.disabled = !state.quickPreview?.apply_allowed || state.quickPreviewSignature !== payloadSignature();
        }
      }
    });
    panel.append(form, details, assumption, result);
    dialog = window.GBUI.createModal({
      title: 'かんたん割当',
      body: panel,
      footer: [dismiss, apply],
      closeLabel: 'かんたん割当を閉じる',
      closeOnOverlay: false,
      closeOnEsc: false,
      extraClass: 'gb-production-modal',
      onClose: () => {
        if (closed) return;
        closed = true;
        state.quickPreviewRequestId += 1;
        if (state.quickDialog?.overlay === dialog?.overlay) state.quickDialog = null;
        restoreFocusAfterClose();
      },
    });
    dialog.overlay.classList.add('gb-production-modal-overlay');
    dialog.overlay.dataset.e2eId = 'production-quick-plan-dialog-overlay';
    dialog.modal.classList.add('gb-production-quick-plan-dialog');
    dialog.modal.style.setProperty('--gb-production-modal-width', '680px');
    dialog.modal.dataset.e2eId = 'production-quick-plan-dialog';
    dialog.header.classList.add('gb-production-modal-header');
    dialog.body.classList.add('gb-production-modal-body');
    dialog.footer.classList.add('gb-production-modal-footer', 'gb-production-quick-footer');
    dialog.footer.dataset.modalFooter = '1';
    const quickPlanTitleEl = dialog.header.querySelector('.gb-modal-title');
    quickPlanTitleEl?.classList.add('gb-production-title');
    quickPlanTitleEl?.insertAdjacentHTML('beforeend', ' ' + fieldHelp('現在のユーザーへ、締切までの空き時間を15分単位で均等に割り当てます。'));
    headerCloseButton = dialog.header.querySelector('.gb-modal-close');
    if (headerCloseButton) headerCloseButton.dataset.e2eId = 'production-quick-plan-dialog-close';
    dialog.overlay.addEventListener('click', event => {
      if (event.target === dialog.overlay) close();
    });
    dialog.modal.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        close();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = [...dialog.modal.querySelectorAll(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'
      )].filter(element => !element.hidden && element.getAttribute('aria-hidden') !== 'true' && element.getClientRects().length > 0);
      if (!focusable.length) {
        event.preventDefault();
        dialog.modal.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    });
    document.body.appendChild(dialog.overlay);
    state.quickPreview = null;
    state.quickPreviewSignature = '';
    state.quickDialog = dialog;
    window.GBModalShell?.enhanceOverlay?.(dialog.overlay);
    window.requestAnimationFrame?.(() => taskCount.focus?.());
    return state.quickDialog;
  }

  function renderQuickResult(component, state, host, data, controls) {
    host.replaceChildren();
    const summary = document.createElement('div');
    summary.className = 'gb-production-quick-summary';
    const scheduled = Number(data?.summary?.scheduled || 0);
    const locked = Number(data?.summary?.locked || 0);
    const unassigned = Number(data?.summary?.unassigned || 0);
    summary.textContent = data?.apply_allowed
      ? `${scheduled}件を割り当てます${locked ? `（${locked}件は固定のまま）` : ''}`
      : `${unassigned}件を割り当てられません`;
    host.appendChild(summary);

    const assumptions = Array.isArray(data?.assumptions) ? data.assumptions : [];
    if (assumptions.length) {
      const list = document.createElement('dl');
      list.className = 'gb-production-assumption-list';
      assumptions.forEach(item => {
        const term = document.createElement('dt');
        term.textContent = item.label || item.code || '前提';
        const value = document.createElement('dd');
        value.textContent = item.value || '—';
        if (item.source === 'fallback') value.className = 'is-auto';
        list.append(term, value);
      });
      host.appendChild(list);
    }

    if (!data?.apply_allowed) {
      controls.apply.disabled = true;
      const solutions = document.createElement('div');
      solutions.className = 'gb-production-quick-solutions';
      const label = document.createElement('strong');
      label.textContent = '解決するには';
      const extend = makeButton('締切を延ばす', 'calendarClock', () => controls.deadline.focus());
      const reduce = makeButton('タスク数を減らす', 'listMinus', () => controls.taskCount.focus());
      const hours = makeButton('勤務時間を設定する', 'settings2', async () => {
        controls.close?.();
        const opened = await window.MeldexUserRegistry?.openSheet?.();
        if (!opened) notify('スタッフ管理シートを開けませんでした', true);
      });
      solutions.append(label, extend, reduce, hours);
      host.appendChild(solutions);
      return;
    }
    controls.apply.disabled = false;
  }

  async function refreshCalendarEvents(component) {
    if (typeof component?._loadEvents !== 'function') return { ok: true, skipped: true };
    try {
      return await component._loadEvents() || { ok: true };
    } catch (error) {
      return { ok: false, stale: false, error };
    }
  }

  // ---------------------------------------------------------------------
  // workspace build / mount (rootを再利用し、面切替をまたいで表の状態を保持する)
  // ---------------------------------------------------------------------

  // テンプレートカードを埋め込みシートへドロップ→現在のタスクリストへ追加(計画書5.2章)。
  // カレンダー面用の _bindProductionTemplateDnD (component.el 全体・capture段階) は、対象が
  // .gb-cal-week-cell 等のカレンダーセルでなければ何もしないため(calendarDrop()がnullを返す)、
  // ここで embedHost 単位に bubble 段階のハンドラーを別途登録しても競合しない。
  // 「リストへ追加」ボタンと同じ制約(管理リスト表示中は不可)をドロップにも適用する。
  function bindEmbedTemplateDrop(component, state) {
    if (state.embedHostEl._productionTemplateDropBound) return;
    state.embedHostEl._productionTemplateDropBound = true;
    const host = state.embedHostEl;
    // 「すべて」表示中もドロップ可（作品未確定のため、作成時に作品選択を促す）
    const canDropHere = () => state.selection?.kind === 'task' || state.selection?.kind === 'all';
    host.addEventListener('dragover', event => {
      if (!window.MeldexProductionTemplates?.hasDrag?.(event.dataTransfer) || !canDropHere()) return;
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = 'copy';
      host.classList.add('is-production-template-drop-target');
    });
    host.addEventListener('dragleave', event => {
      if (!host.contains(event.relatedTarget)) host.classList.remove('is-production-template-drop-target');
    });
    host.addEventListener('drop', event => {
      const payload = window.MeldexProductionTemplates?.readDrag?.(event.dataTransfer);
      host.classList.remove('is-production-template-drop-target');
      if (!payload || !canDropHere()) return;
      event.preventDefault();
      event.stopPropagation();
      if (!ensureProductionWritable()) return;
      component._createProductionTaskFromTemplate(payload, { surface: 'list' }, {});
    });
  }

  function buildWorkspace(component, state) {
    const root = document.createElement('div');
    root.className = 'gb-production-task-view gb-production-task-workspace';
    root.dataset.e2eId = 'gb-production-task-workspace';

    const listBar = document.createElement('div');
    listBar.className = 'gb-production-list-switch';
    listBar.setAttribute('role', 'tablist');
    listBar.setAttribute('aria-label', '作品別タスクリスト');
    listBar.dataset.e2eId = 'gb-production-list-switch';
    listBar.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      const tabs = [...listBar.querySelectorAll('[role="tab"]')].filter(tab => !tab.disabled);
      const index = tabs.indexOf(event.target.closest('[role="tab"]'));
      if (index < 0 || !tabs.length) return;
      event.preventDefault();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1
        : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      tabs[next].focus();
      tabs[next].click();
    });
    state.listBarEl = listBar;

    const embedHost = document.createElement('div');
    embedHost.className = 'gb-production-embed-host';
    embedHost.dataset.e2eId = 'gb-production-embed-host';
    state.embedHostEl = embedHost;

    const availabilityNotice = document.createElement('div');
    availabilityNotice.className = 'gb-production-write-availability';
    availabilityNotice.setAttribute('role', 'status');
    availabilityNotice.setAttribute('aria-live', 'polite');
    availabilityNotice.dataset.e2eId = 'gb-production-write-availability';
    availabilityNotice.hidden = true;
    state.writeAvailabilityEl = availabilityNotice;

    root.append(listBar, availabilityNotice, embedHost);
    component._contentEl.replaceChildren(root);
    state.root = root;

    state.embed = window.MeldexProductionSheetEmbed.create({ idSuffix: component.tabId || component.paneId || 'production' });
    state.embed.mount(embedHost);
    bindEmbedTemplateDrop(component, state);

    renderListBar(component, state);
    syncWriteAvailability(state);
    return root;
  }

  function ensureWorkspaceMounted(component, state) {
    if (!state.root) {
      buildWorkspace(component, state);
      return;
    }
    if (state.root.parentElement !== component._contentEl) {
      component._contentEl.replaceChildren(state.root);
    }
  }

  // ---------------------------------------------------------------------
  // CalendarComponent prototype
  // ---------------------------------------------------------------------

  CalendarComponent.prototype._productionTaskContext = function() {
    const state = stateFor(this);
    return {
      workTitle: state.selection?.kind === 'task' ? (state.selection.workTitle || '') : '',
      classification: {},
      isManagedList: state.selection?.kind === 'managed',
    };
  };

  CalendarComponent.prototype._productionActiveTabKey = function() {
    if (this._surface !== 'productionTasks') return 'calendar';
    const state = stateFor(this);
    if (state.pendingTabKey === 'tasks' || managedListInfo(state.pendingTabKey)) return state.pendingTabKey;
    const selection = state.selection || this.state?.productionTaskSelection;
    return selection?.kind === 'managed' && managedListInfo(selection.managedKey) ? selection.managedKey : 'tasks';
  };

  CalendarComponent.prototype._selectProductionTab = function(key) {
    const tabKey = key === 'calendar' || key === 'tasks' || managedListInfo(key) ? key : 'tasks';
    const state = stateFor(this);
    if (tabKey === 'calendar') {
      state.pendingTabKey = '';
      this.setSurface('calendar');
      return true;
    }
    if (this._surface !== 'productionTasks') {
      const switched = this.setSurface('productionTasks', () => this._selectProductionTab(tabKey));
      if (switched === false || switched === undefined) return false;
      if (this._surface !== 'productionTasks') return false;
    }
    state.pendingTabKey = tabKey;
    state.selection = null;
    persistPendingTab(this, state, tabKey);
    if (state.sheetsLoaded) {
      ensureSelectionDefault(this, state);
      if (state.selection) openSelectionIfNeeded(this, state);
    } else {
      renderListBar(this, state);
      this._syncSurfaceControls?.();
      syncQuickPlanToolbar(this, state);
      if (!state.sheetsLoading) loadSheetsAndMeta(this, state);
    }
    return true;
  };

  CalendarComponent.prototype._openProductionQuickPlan = function(trigger) {
    if (window.MeldexRuntimeAdapter?.isDropboxMode?.()) {
      notify('かんたん割当はデスクトップ版で実行してください', true);
      return false;
    }
    return openQuickPlanDialog(this, stateFor(this), trigger);
  };

  CalendarComponent.prototype._openProductionRecalculate = function(trigger) {
    if (window.MeldexRuntimeAdapter?.isDropboxMode?.()) {
      notify('再計算はデスクトップ版で実行してください', true);
      return false;
    }
    if (typeof window.openProductionRecalculate !== 'function') {
      notify('再計算画面を初期化できませんでした', true);
      return;
    }
    const state = stateFor(this);
    // 管理リスト（作業対象/作業内容/作業規模/スタッフ）を表示中は、選択行が
    // タスクファイルではないため再計算対象として渡さない。
    // 「すべて」表示中は全ブロックの選択行を集約して渡す。
    const selectedTaskPaths = state.selection?.kind === 'task'
      ? (state.embed?.getSelectedEntryPaths?.() || [])
      : state.selection?.kind === 'all'
        ? (state.allView?.getSelectedEntryPaths?.() || [])
        : [];
    window.openProductionRecalculate({ trigger, selectedTaskPaths });
  };

  CalendarComponent.prototype._runProductionSheetDisplayAction = function(action, trigger) {
    const state = stateFor(this);
    const ctx = state.embed?.ctx;
    const dbPath = String(state.selection?.path || '');
    if (!productionSheetDisplayReady(state) || !ctx || ctx.dbPath !== dbPath) {
      notify('表示中のシートを読み込んでから操作してください', true);
      return false;
    }
    if (action === 'sheetAutoFit' && typeof autoFitCurrentSheetColumns === 'function') {
      autoFitCurrentSheetColumns(trigger, ctx, dbPath);
      return true;
    }
    if (action === 'sheetColumnDisplayOrder' && typeof showColumnDisplayOrderModal === 'function') {
      showColumnDisplayOrderModal(ctx);
      return true;
    }
    if (action === 'sheetFilter' && typeof showUnifiedFilterModal === 'function') {
      showUnifiedFilterModal({ ctx, event: trigger });
      return true;
    }
    if (action === 'sheetSort' && typeof showDbSortMenu === 'function') {
      showDbSortMenu({ currentTarget: trigger, target: trigger }, ctx, dbPath);
      return true;
    }
    notify('シート表示操作を初期化できませんでした', true);
    return false;
  };

  CalendarComponent.prototype._productionSheetDisplayReady = function() {
    return productionSheetDisplayReady(stateFor(this));
  };

  CalendarComponent.prototype._renderProductionTaskView = function() {
    const state = stateFor(this);
    if (typeof this._bindProductionTemplateDnD === 'function') this._bindProductionTemplateDnD();
    ensureWorkspaceMounted(this, state);
    if (state.selection?.kind === 'all' && state.allView?.isMounted?.()) {
      state.embed?.setVisible(false);
      state.allView.setVisible(true);
    } else {
      state.allView?.setVisible(false);
      state.embed?.setVisible(true);
    }
    window.MeldexProductionSidebar?.syncTaskListSurface?.(this);
    syncQuickPlanToolbar(this, state);
    syncSheetDisplayToolbar(this, state);
    syncWriteAvailability(state);
    if (!state.sheetsLoaded && !state.sheetsLoading) loadSheetsAndMeta(this, state);
    else if (state.selection) openSelectionIfNeeded(this, state);
    if (!this._productionTaskUpdateHandler) {
      this._productionTaskUpdateHandler = event => {
        // 一括作成の発火元は、対象シートを既に明示的に開き直している。同じ475行を
        // イベント経由でもう一度読み込まず、別コンポーネントだけを同期する。
        if (event?.detail?.sourceComponent === this) return;
        if (this._surface === 'productionTasks') {
          refreshEmbedAfterMutation(this).catch(error => notify(error?.message || 'タスクリストを更新できませんでした', true));
        }
      };
      document.addEventListener('meldex:production-task-updated', this._productionTaskUpdateHandler);
    }
    if (!this._productionWriteAvailabilityHandler) {
      this._productionWriteAvailabilityHandler = () => syncWriteAvailability(stateFor(this));
      document.addEventListener('meldex:production-write-availability-changed', this._productionWriteAvailabilityHandler);
    }
  };

  // 「更新」ボタン・カレンダーのリロード操作から呼ばれる: リスト一覧と埋め込みシートの
  // 両方を最新化する。
  CalendarComponent.prototype._refreshProductionTaskEmbed = async function() {
    const state = stateFor(this);
    await Promise.all([
      loadSheetsAndMeta(this, state, { force: true }),
      refreshEmbedAfterMutation(this),
    ]);
  };

  // 一括作成後は、作成対象の作品別シートを選択して結果をその場で確認できるようにする。
  CalendarComponent.prototype._showProductionTaskWork = async function(workTitle) {
    const requested = String(workTitle || '').trim();
    if (!requested) return false;
    if (this._surface !== 'productionTasks') this.setSurface('productionTasks');
    const state = stateFor(this);
    await loadSheetsAndMeta(this, state, { force: true });
    const sheet = state.sheets.find(item => String(item?.work_title || '').trim() === requested);
    if (!sheet) return false;
    return await selectTaskList(this, state, sheet, { refreshCurrent: true });
  };

  // カレンダー面へ切り替えた時は破棄せず非表示にするだけに留める(埋め込みシートのctx・
  // 未保存の入力状態を保持したまま。実際には calendar 側の描画が _contentEl を書き換えて
  // ワークスペース全体をDOMから切り離すが、参照は保持しているため次回タスク面へ戻った際に
  // 同じ埋め込みインスタンスへ再アタッチできる)。
  CalendarComponent.prototype._hideProductionTaskEmbed = function() {
    const state = this._productionTaskState;
    if (state?.embed?.isMounted?.()) state.embed.setVisible(false);
    if (state?.allView?.isMounted?.()) state.allView.setVisible(false);
  };

  CalendarComponent.prototype._createProductionTaskFromTemplate = async function(template, drop = {}, context = {}) {
    if (!ensureProductionWritable()) return null;
    const state = stateFor(this);
    let work = context.workTitle || (state.selection?.kind === 'task' ? state.selection.workTitle : '') || '';
    if (!work) {
      work = await window.MeldexProductionTemplates?.chooseWork?.(Object.keys(state.workMeta || {}), '');
      if (!work) return null;
    }
    const classification = context.classification || {};
    let data;
    try {
      data = await api().fromTemplate({
        template_id: template?.templateId || '',
        template_path: template?.templatePath || '',
        work_title: work,
        classification,
        drop,
        current_user: currentUser(),
      });
    } catch (error) {
      notify(error?.message || 'テンプレートからタスクを追加できませんでした', true);
      return null;
    }
    notify(`「${data?.row?.name || '制作タスク'}」を追加しました`);
    await refreshEmbedAfterMutation(this);
    if (drop.surface === 'calendar') {
      const calendarRefresh = await refreshCalendarEvents(this);
      if (calendarRefresh?.ok === false) {
        notify('タスクは追加しましたが、カレンダーを再読み込みできませんでした。カレンダーを再読み込みしてください', true);
      } else if (this._surface === 'calendar') {
        this._render();
      }
    }
    // タスクリスト面はシート表そのものが編集場所なので、同じ内容の右詳細を重ねて開かない。
    // 表が見えないカレンダー配置時だけ、作成結果の詳細を右側へ表示する。
    if (data?.row && drop.surface === 'calendar') window.MeldexProductionSidebar?.openTask?.(data.row, this);
    return data;
  };

  const baseDestroy = CalendarComponent.prototype.destroy;
  CalendarComponent.prototype.destroy = function() {
    if (this._productionTaskUpdateHandler) {
      document.removeEventListener('meldex:production-task-updated', this._productionTaskUpdateHandler);
      this._productionTaskUpdateHandler = null;
    }
    if (this._productionWriteAvailabilityHandler) {
      document.removeEventListener('meldex:production-write-availability-changed', this._productionWriteAvailabilityHandler);
      this._productionWriteAvailabilityHandler = null;
    }
    const state = this._productionTaskState;
    state?.quickDialog?.close?.();
    this._productionTaskCreateDialog?.close?.();
    this._productionTaskCreateDialog = null;
    if (state?.embed) {
      state.embed.destroy();
      state.embed = null;
    }
    if (state?.allView) {
      state.allView.destroy();
      state.allView = null;
    }
    if (state) state.root = null;
    return baseDestroy.call(this);
  };
})();
