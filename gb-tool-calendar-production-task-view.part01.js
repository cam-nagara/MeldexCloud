/* gb-tool-calendar-production-task-view.js: schedule production task workspace
 * シート表を埋め込んで直接編集し、作品別タスクリストの切替だけを表の直上に置く。
 * 管理リストはカレンダー共通の上段タブから開き、制作操作は共通ツールバーへ集約する。
 * 選択中リストは component state と tab.state の双方へ保存して再構築後も復元する。
 */
(function() {
  'use strict';

  if (typeof CalendarComponent === 'undefined') return;

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
        // 制作管理UX改善計画（2026-08-04）§6-1: 未セットアップ判定（undefined=未確認、
        // true=開始済み、false=未セットアップ=空状態カードを表示中）。
        productionReady: undefined,
        productionReadyChecking: false,
      };
    }
    return component._productionTaskState;
  }

  // /production-management/status は _ensure_existing_or_template を呼ばない唯一の読み取り
  // のため、これで未セットアップと確認できたら taskSheets() 等の自己修復読み取りを呼ばず、
  // 空状態カードだけを表示する。checkReady が無いAPI実装（テスト用の簡易スタブ等）では
  // ゲート自体を素通りし、既存どおりの挙動にfail-openする。
  function ensureProductionReadyGate(component, state) {
    if (state.productionReady === true) return true;
    const checkReady = window.MeldexProductionApi?.checkReady;
    if (typeof checkReady !== 'function') { state.productionReady = true; return true; }
    if (state.productionReady === false || state.productionReadyChecking) return false;
    state.productionReadyChecking = true;
    checkReady().then(ready => {
      state.productionReadyChecking = false;
      state.productionReady = !!ready;
      component._renderProductionTaskView();
    }).catch(() => {
      state.productionReadyChecking = false;
      state.productionReady = true;
      component._renderProductionTaskView();
    });
    return false;
  }

  function renderProductionEmptyState(component, state) {
    if (!state.embedHostEl) return;
    state.listBarEl?.replaceChildren();
    state.embed?.setVisible(false);
    state.allView?.setVisible(false);
    // 依頼8の追加調査で判明した実バグの修正: ensureWorkspaceMounted() は必ずこの関数より先に
    // 呼ばれており、埋め込みシートは既にここへマウント済み（display:none で非表示にしただけ）。
    // 埋め込みシートの containerEl は「非表示時もDOMから外さない」制約を持つ
    // （gb-tool-calendar-production-sheet-embed.js の _setVisible。detachすると
    // _resolveDatabasePaneContext() がグローバルstateへ静かにフォールバックし、以後
    // setVisible(true)しても復帰しない）。かつて embedHostEl 全体を replaceChildren() で
    // 置き換えていたため、この制約に反して埋め込みシートのDOMごと外れてしまい、
    // 未セットアップ判定→開始操作後もタスクリストが永久に表示されない不具合があった
    // （制作管理UX改善計画 2026-08-04 §6-1 空状態カード追加時に再発を確認・修正）。
    // 空状態カードは埋め込みシートの兄弟として追加し、カード自身だけを追跡して差し替える。
    state._emptyStateCardEl?.remove();
    state._emptyStateCardEl = null;
    if (state.productionReadyChecking) return;
    const card = window.MeldexProductionManagementActions?.emptyStateCard?.(() => {
      state.productionReady = true;
      component._renderProductionTaskView();
    });
    if (card) {
      state.embedHostEl.appendChild(card);
      state._emptyStateCardEl = card;
    }
  }

  // 他の画面（管理操作パネル）から制作管理を開始した場合も、このタスクリスト面の
  // 空状態を解除して再読み込みする。
  if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    document.addEventListener('meldex:production-management-started', () => {
      if (typeof forEachComponent !== 'function' || typeof CalendarComponent === 'undefined') return;
      forEachComponent(instance => {
        const state = instance instanceof CalendarComponent ? instance._productionTaskState : null;
        if (!state || state.productionReady === true) return;
        state.productionReady = true;
        state.productionReadyChecking = false;
        if (instance._surface === 'productionTasks' && typeof instance._renderProductionTaskView === 'function') {
          instance._renderProductionTaskView();
        }
      });
    });
  }

  // 旧「かんたん割当／自動割り当て」ボタンは廃止し、割当再計算へ一本化した（2026-08-05
  // ユーザー判断）。ここでは割当再計算ボタンの状態だけを同期する。
  function syncQuickPlanToolbar(component, state) {
    // フル再計算エンジン（割当再計算）はCloud（Dropboxモード）にも移植済み
    // （production-management-ux-improvement-plan-2026-08-04.md §4-1）。
    // dropboxMode による無効化は撤去し、Desktop/Cloud両対応にする。
    const recalculateButton = component.el?.querySelector?.('[data-e2e-id="gb-production-task-recalculate"]');
    if (recalculateButton) {
      recalculateButton.disabled = false;
      recalculateButton.title = '割当再計算';
      recalculateButton.setAttribute('aria-label', '割当再計算');
    }
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
        // 「すべて」は全作品を横断するフラット表（単一dbPath前提の汎用シート表示操作とは
        // 別実装）のため、こちらのツールバーボタンは読み込み待ち(aria-busy)ではなく
        // 明示的に無効として案内する。絞り込み・並べ替えは表の上のコントロールで行う。
        button.disabled = true;
        button.setAttribute('aria-busy', 'false');
        button.title = 'すべてタブでは表の上の絞り込み・並べ替えを利用してください';
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
        // 「作品タブで開く」導線: フラット表の作品セルから作品別タブへジャンプする
        onOpenWork: sheet => selectTaskList(component, state, sheet),
        // 行クリック: フラット表はセル直接編集を持たないため、既存のタスク詳細サイドバーを
        // 強制的に開く（作品別タブでは埋め込みシート自体が編集場所のため通常は抑止される）
        onOpenTask: row => window.MeldexProductionSidebar?.openTask?.(row, component, { forceDetail: true }),
      });
    }
    if (!state.allView.isMounted()) state.allView.mount(state.embedHostEl);
    state.embed?.setVisible(false);
    state.allView.setVisible(true);
    // 作品ドロップダウン・作品セルの「作品タブで開く」導線用に、タブバーの並び順に合わせて
    // シート一覧を渡す（閉じたタブのシートも末尾に含める）
    const tabsModule = window.MeldexProductionListTabs;
    const arranged = tabsModule ? tabsModule.arrange(state.sheets, state.pmRootPath) : null;
    const orderedSheets = arranged ? arranged.visible.concat(arranged.hidden) : state.sheets;
    const opened = await state.allView.open(orderedSheets, {
      pmRoot: state.pmRootPath,
      refresh: options.refreshCurrent === true,
    });
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

