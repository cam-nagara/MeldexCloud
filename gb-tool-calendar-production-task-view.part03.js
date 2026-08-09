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

  CalendarComponent.prototype._openProductionRecalculate = function(trigger) {
    // フル再計算エンジンはCloud（Dropboxモード）にも移植済み（production-management-ux-
    // improvement-plan-2026-08-04.md §4-1）。Desktop限定ガードは撤去した。
    if (typeof window.openProductionRecalculate !== 'function') {
      notify('自動割り当て画面を初期化できませんでした', true);
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
    if (!ensureProductionReadyGate(this, state)) {
      renderProductionEmptyState(this, state);
      return;
    }
    // 空状態カードは埋め込みシートを detach せず兄弟として追加している（renderProductionEmptyState
    // 参照）。準備完了後はカードだけを取り除く（埋め込みシート側は setVisible(true) で復帰する）。
    if (state._emptyStateCardEl) {
      state._emptyStateCardEl.remove();
      state._emptyStateCardEl = null;
    }
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
