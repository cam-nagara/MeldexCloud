/* ==============================
   gb-tool-calendar-production.js: Scheduler production management panel
   ============================== */

(() => {
  if (typeof CalendarComponent === 'undefined') return;

  // 制作管理UX改善計画（2026-08-04）§6-1:
  // - 「制作管理を始める」ボタンは廃止（未セットアップ時のみ空状態カードとして別途表示する）。
  // - 「担当者と時間を割り当て」（即時実行）は廃止し、「割当再計算」
  //   （旧ラベル「再計算」「予定を組み直す」。プレビュー→適用の2段階で unassigned_only スコープも選べる）へ統合した。
  // - 「メンバーを追加」は正本『スタッフ管理シート』を開く導線へ変更。
  // 各操作には表示グループ（schedule=スケジュール / data=データ）を持たせる。
  const ACTIONS = [
    { label: 'タスクを作成', icon: 'listPlus', fn: 'openProductionTaskCreate', group: 'schedule' },
    { label: 'シフトを取り込む', icon: 'fileInput', fn: 'openProductionShiftImport', group: 'schedule' },
    // フル再計算エンジンはCloud（Dropboxモード）にも移植済み（production-management-ux-
    // improvement-plan-2026-08-04.md §4-1）。desktopOnlyフラグは撤去した。
    { label: '自動割り当て', icon: 'refreshCw', fn: 'openProductionRecalculate', group: 'schedule' },
    { label: 'スタッフ管理シートを開く', icon: 'userPlus', fn: 'openProductionStaffRegistrySheet', group: 'data' },
    // Google送信はCloud（Dropboxモード）にも移植済み（production-management-ux-improvement-
    // plan-2026-08-04.md §4-4）。CalDAV送信はDesktop限定のままだが、ボタン自体は両方で表示し、
    // 未接続時は結果メッセージで案内する（「クラウド版では未対応」の行き止まり表示にしない）。
    { label: '外部カレンダーへ送信', icon: 'send', fn: 'runProductionExternalSync', group: 'data' },
    { label: '書き出す', icon: 'fileOutput', fn: 'openProductionExport', group: 'data' },
  ];
  const ACTION_GROUPS = [
    { key: 'schedule', label: 'スケジュール' },
    { key: 'data', label: 'データ' },
  ];
  // 中央のシート表示や共通ツールバーと重複しない、制作管理固有の操作だけを
  // 右側の「管理操作」に残す。タスク作成は一覧/共通ツールバーから行う。「割当再計算」
  // （旧「担当者と時間を割り当て」＋「再計算」＋「予定を組み直す」の統合先）はこのパネルの
  // 「スケジュール」グループに残す（§6-1）。
  const MANAGEMENT_ACTIONS = ACTIONS.filter(action => action.fn !== 'openProductionTaskCreate');
  const PRODUCTION_SHEET_TABS = [
    { key: 'tasks', id: 'production-task-list', label: 'タスクリスト', icon: 'listTodo' },
    { key: 'works', id: 'production-managed-works', label: '作品設定', icon: 'bookOpen' },
    { key: 'targets', id: 'production-managed-targets', label: '作業対象', icon: 'crosshair' },
    { key: 'contents', id: 'production-managed-contents', label: '作業内容', icon: 'listChecks' },
    { key: 'scales', id: 'production-managed-scales', label: '作業規模', icon: 'gauge' },
  ];

  function _pmIcon(name, size = 14) {
    return typeof lucide === 'function' ? lucide(name, size) : '';
  }

  function _pmStatus(message, error) {
    if (typeof showStatus === 'function') showStatus(message, !!error);
    else console[error ? 'error' : 'log'](message);
  }

  function _pmIsDropboxMode() {
    return !!window.MeldexRuntimeAdapter?.isDropboxMode?.();
  }

  function _pmDesktopOnlyReason(action) {
    if (!action?.desktopOnly || !_pmIsDropboxMode()) return '';
    return `${action.label}はデスクトップ版で実行してください`;
  }

  function _pmActionWrites(action) {
    return action?.fn !== 'openProductionExport';
  }

  function _pmOpenOptionPanel(select) {
    if (select === false) return;
    if (typeof _openDetailRightPanel === 'function') {
      _openDetailRightPanel();
      return;
    }
    if (typeof openRightPanelTab === 'function') openRightPanelTab('detail');
  }

  function _pmOptionBody(options = {}) {
    _pmOpenOptionPanel(options.select !== false);
    const helpers = window.MeldexCalendarOptionPanel || {};
    if (typeof helpers.container === 'function') {
      return helpers.container('制作管理', {
        tabId: 'calendar-production',
        select: options.select !== false,
      });
    }
    const detailEl = typeof _resolveDetailEl === 'function' ? _resolveDetailEl() : document.getElementById('rp-detail');
    if (!detailEl) return null;
    detailEl.style.display = '';
    detailEl.replaceChildren();
    const header = document.createElement('div');
    header.className = 'cal-option-header';
    header.textContent = '制作管理';
    const body = document.createElement('div');
    body.className = 'cal-option-body';
    detailEl.append(header, body);
    return body;
  }

  function _pmRunAction(action) {
    const unavailableReason = _pmDesktopOnlyReason(action);
    if (unavailableReason) {
      _pmStatus(unavailableReason, true);
      return;
    }
    if (_pmActionWrites(action) && window.MeldexProductionUiAvailability?.ensureWritable?.() === false) return;
    const fn = window[action.fn];
    if (typeof fn !== 'function') {
      _pmStatus(`${action.label}を初期化できませんでした`, true);
      return;
    }
    try {
      const result = fn();
      if (result && typeof result.catch === 'function') {
        result.catch(error => _pmStatus(error?.message || String(error), true));
      }
    } catch (error) {
      _pmStatus(error?.message || String(error), true);
    }
  }

  function _pmActionButton(action) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'gb-cal-production-action';
    const unavailableReason = _pmDesktopOnlyReason(action);
    if (typeof window[action.fn] !== 'function' || unavailableReason) button.disabled = true;
    if (unavailableReason) {
      button.title = unavailableReason;
      button.setAttribute('aria-label', `${action.label}（デスクトップ版のみ）`);
    }
    const icon = document.createElement('span');
    icon.className = 'gb-cal-production-action-icon';
    icon.innerHTML = _pmIcon(action.icon, 14);
    const label = document.createElement('span');
    label.textContent = unavailableReason ? `${action.label}（デスクトップ版のみ）` : action.label;
    button.dataset.productionAction = action.fn;
    button.dataset.e2eId = 'gb-production-management-action-' + action.fn.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
    button.append(icon, label);
    button.addEventListener('click', () => _pmRunAction(action));
    if (_pmActionWrites(action)) window.MeldexProductionUiAvailability?.markWriteControl?.(button);
    return button;
  }

  // 制作管理UX改善計画（2026-08-04）§6-1: 未セットアップ時（/production-management/status の
  // ready===false）だけ表示する空状態カード。管理操作パネルとタスクリスト面の両方から
  // 再利用する（gb-tool-calendar-production-task-view.js）ため window 経由で公開する。
  function _pmEmptyStateCard(onStarted) {
    const card = document.createElement('div');
    card.className = 'gb-production-empty-state';
    card.dataset.e2eId = 'gb-production-empty-state';
    const iconEl = document.createElement('span');
    iconEl.className = 'gb-production-empty-state-icon';
    iconEl.innerHTML = _pmIcon('hammer', 22);
    const message = document.createElement('p');
    message.textContent = 'この保管場所には、まだ制作管理のデータがありません';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'gb-btn gb-btn-sm gb-btn-primary';
    button.dataset.e2eId = 'gb-production-empty-state-start';
    button.append(document.createTextNode('制作管理を始める'));
    window.MeldexProductionUiAvailability?.markWriteControl?.(button);
    button.addEventListener('click', async () => {
      if (window.MeldexProductionUiAvailability?.ensureWritable?.() === false) return;
      button.disabled = true;
      try {
        const result = await window.openProductionManagementStart?.();
        if (result) {
          window.MeldexProductionApi?.invalidateReady?.();
          document.dispatchEvent(new CustomEvent('meldex:production-management-started'));
          onStarted?.(result);
        }
      } catch (error) {
        _pmStatus(error?.message || String(error), true);
      } finally {
        button.disabled = false;
      }
    });
    card.append(iconEl, message, button);
    return card;
  }

  function _pmRenderActionGroups(host) {
    ACTION_GROUPS.forEach(groupDef => {
      const groupActions = MANAGEMENT_ACTIONS.filter(action => (action.group || '') === groupDef.key);
      if (!groupActions.length) return;
      const section = document.createElement('div');
      section.className = 'gb-production-actions-group';
      section.dataset.e2eId = 'gb-production-actions-group-' + groupDef.key;
      const heading = document.createElement('div');
      heading.className = 'gb-production-actions-group-label';
      heading.textContent = groupDef.label;
      const actions = document.createElement('div');
      actions.className = 'gb-cal-production-actions gb-production-management-actions';
      groupActions.forEach(action => actions.appendChild(_pmActionButton(action)));
      section.append(heading, actions);
      host.appendChild(section);
    });
  }

  function _pmRenderManagementActions(host) {
    if (!host) return;
    const renderSeq = (host.__pmActionsRenderSeq = (host.__pmActionsRenderSeq || 0) + 1);
    host.replaceChildren();
    const loading = document.createElement('p');
    loading.className = 'gb-production-management-actions-note';
    loading.textContent = '読み込み中…';
    host.appendChild(loading);
    const readyPromise = window.MeldexProductionApi?.checkReady ? window.MeldexProductionApi.checkReady() : Promise.resolve(true);
    readyPromise.then(ready => {
      if (host.__pmActionsRenderSeq !== renderSeq) return;
      host.replaceChildren();
      if (!ready) {
        host.appendChild(_pmEmptyStateCard(() => _pmRenderManagementActions(host)));
        return;
      }
      const intro = document.createElement('p');
      intro.className = 'gb-production-management-actions-note';
      const availability = window.MeldexProductionUiAvailability?.current?.() || { blocked: false, reason: '' };
      if (availability.blocked) {
        intro.textContent = `${availability.reason}。ここでは内容の確認と書き出しだけを利用できます。`;
      } else {
        intro.innerHTML = '管理操作 ' + fieldHelp('初期設定、割り当て、外部連携など、表編集では行えない操作です。');
      }
      host.appendChild(intro);
      _pmRenderActionGroups(host);
    });
  }

  function _pmFindCalendarComponent() {
    if (typeof GBTabs !== 'undefined' && typeof getComponentInstance === 'function') {
      const paneId = typeof GBLayout !== 'undefined' ? GBLayout.activePane : null;
      const activeTab = typeof GBTabs.getActiveTab === 'function' ? GBTabs.getActiveTab(paneId) : null;
      if (activeTab?.type === 'calendar') {
        const active = getComponentInstance(activeTab.id);
        if (active instanceof CalendarComponent) return active;
      }
    }
    const rightPanelCalendar = document.getElementById('rp-calendar')?._calComponent;
    if (rightPanelCalendar instanceof CalendarComponent) return rightPanelCalendar;
    let fallback = null;
    if (typeof forEachComponent === 'function') {
      forEachComponent((instance) => {
        if (!fallback && instance instanceof CalendarComponent) fallback = instance;
      });
    }
    return fallback;
  }

  function _pmRunCalendarToolbarAction(component, action) {
    if (!component || typeof component._handleAction !== 'function') return false;
    const mobileMainButton = document.getElementById('cloud-mobile-main-button');
    // スマホ用メニューを選んだ直後は、下シートの開閉に伴う refresh の途中で
    // メニューボタンが一時的に hidden になることがある。DOM上に残る同ボタンを
    // 起点として保持し、モーダル終了後のフォーカスを非表示のPC用ボタンへ戻さない。
    const mobileEditingUi = document.body?.dataset?.cloudMobileEditingUi === '1';
    const anchor = (mobileEditingUi && mobileMainButton?.isConnected
      ? mobileMainButton
      : component.el?.querySelector?.(`[data-cal-action="${action}"]`))
      || null;
    component._handleAction(action, anchor);
    return true;
  }

  function _pmToolMenuItems() {
    const component = _pmFindCalendarComponent();
    if (!component) return [];
    const root = component.el;
    const rootStyle = root && typeof getComputedStyle === 'function' ? getComputedStyle(root) : null;
    if (!root?.isConnected || root.hidden || !root.getClientRects?.().length || rootStyle?.display === 'none' || rootStyle?.visibility === 'hidden') return [];
    const taskListSurface = component._surface === 'productionTasks';
    const writeAvailability = window.MeldexProductionUiAvailability?.current?.() || { blocked: false, reason: '' };
    const sheetDisplayReady = !!component._productionSheetDisplayReady?.();
    const activeKey = taskListSurface
      ? (component._productionActiveTabKey?.() || 'tasks')
      : 'calendar';
    const selectTab = key => {
      if (typeof component._selectProductionTab === 'function') return component._selectProductionTab(key);
      return component.setSurface?.(key === 'calendar' ? 'calendar' : 'productionTasks');
    };
    const items = taskListSurface ? [{
      id: 'production-calendar', label: 'カレンダーに戻る', icon: 'calendarDays',
      action: () => selectTab('calendar'),
    }] : [];
    PRODUCTION_SHEET_TABS.forEach(tab => {
      const active = activeKey === tab.key;
      items.push({
        id: tab.id,
        label: active ? `${tab.label}（表示中）` : tab.label,
        icon: tab.icon,
        active,
        disabled: active,
        action: () => selectTab(tab.key),
      });
    });
    // 通常のカレンダー面では各シートへの入口だけに絞る。
    if (!taskListSurface) return items;
    items.push(
      {
        id: 'production-sheet-auto-fit', label: '列幅自動調整', icon: 'columns3',
        disabled: !sheetDisplayReady,
        action: () => _pmRunCalendarToolbarAction(component, 'sheetAutoFit'),
      },
      {
        id: 'production-sheet-column-display-order', label: '列の表示と順序', icon: 'listChecks',
        disabled: !sheetDisplayReady,
        action: () => _pmRunCalendarToolbarAction(component, 'sheetColumnDisplayOrder'),
      },
      {
        id: 'production-sheet-filter', label: 'フィルタ', icon: 'filter',
        disabled: !sheetDisplayReady,
        action: () => _pmRunCalendarToolbarAction(component, 'sheetFilter'),
      },
      {
        id: 'production-sheet-sort', label: '並び替え', icon: 'arrowUpDown',
        disabled: !sheetDisplayReady,
        action: () => _pmRunCalendarToolbarAction(component, 'sheetSort'),
      },
      {
        id: 'production-bulk-create', label: writeAvailability.blocked ? `タスクを一括作成（${writeAvailability.reason}）` : 'タスクを一括作成', icon: 'listPlus',
        disabled: writeAvailability.blocked,
        action: () => _pmRunCalendarToolbarAction(component, 'bulkCreateTasks'),
      },
      {
        id: 'production-templates', label: 'テンプレート', icon: 'layoutTemplate',
        action: () => _pmRunCalendarToolbarAction(component, 'template'),
      },
      {
        // フル再計算エンジンはCloud（Dropboxモード）にも移植済み（production-management-ux-
        // improvement-plan-2026-08-04.md §4-1）。dropboxModeでも無効化しない。
        id: 'production-recalculate', label: '自動割り当て', icon: 'calculator',
        action: () => _pmRunCalendarToolbarAction(component, 'recalculate'),
      },
      {
        id: 'production-management', label: '管理操作', icon: 'settings2',
        action: () => _pmRunCalendarToolbarAction(component, 'productionManagement'),
      },
      {
        id: 'production-refresh', label: '再読み込み', icon: 'refreshCw',
        action: () => _pmRunCalendarToolbarAction(component, 'reload'),
      },
    );
    return items;
  }

  function _pmTaskPathFromEvent(ev) {
    const description = String(ev?.description || '');
    const match = description.match(/元シート:\s*([^\n\r]+)/);
    return match ? match[1].trim() : '';
  }

  // 通常操作から到達しないフォールバック実装だった gb-tool-calendar-production-panel.js
  // （MeldexProductionPanel）は削除済み（制作管理UX改善計画2026-08-04 §6-1）。実装は常に
  // gb-tool-calendar-production-sidebar.js（MeldexProductionSidebar）が担う。
  CalendarComponent.prototype._openProductionTaskEvent = function (ev) {
    const body = _pmOptionBody({ select: true });
    if (body && window.MeldexProductionSidebar?.openTaskEvent) {
      window.MeldexProductionSidebar.openTaskEvent(body, ev, this);
      return true;
    }
    const path = _pmTaskPathFromEvent(ev);
    if (path && typeof openPage === 'function') {
      openPage(ev?.title || '制作管理タスク', path);
      return true;
    }
    _pmStatus('制作管理タスクの元シートを開けませんでした', true);
    return false;
  };

  CalendarComponent.prototype._renderProductionManagementPanel = function (body, options = {}) {
    if (!body) return;
    if (window.MeldexProductionSidebar?.render) {
      window.MeldexProductionSidebar.render(body, { mode: options.mode || 'detail', component: this });
      return;
    }
    _pmStatus('制作管理パネルを初期化できませんでした', true);
  };

  CalendarComponent.prototype._showProductionManagementPanel = function (options = {}) {
    const body = _pmOptionBody({ select: options.select !== false });
    if (!body) {
      _pmStatus('制作管理パネルを表示できませんでした', true);
      return;
    }
    this._renderProductionManagementPanel(body, options);
  };

  window.openProductionManagementPanel = function () {
    const component = _pmFindCalendarComponent();
    if (!component || typeof component._showProductionManagementPanel !== 'function') {
      _pmStatus('スケジュールを開いてから制作管理を開いてください', true);
      return;
    }
    component._showProductionManagementPanel({ mode: 'actions' });
  };

  window.openProductionTaskListSheet = async function () {
    if (!window.MeldexProductionApi?.summary || typeof selectDatabase !== 'function') {
      _pmStatus('タスクリストシートを開けませんでした', true);
      return;
    }
    try {
      const summary = await window.MeldexProductionApi.summary();
      const root = String(summary?.root || '').replace(/[\\/]+$/, '');
      if (!root) throw new Error('制作管理の場所を確認できませんでした');
      await selectDatabase(root + '/シート/タスクリスト', null, { fromExplorer: true });
    } catch (error) {
      _pmStatus(error?.message || 'タスクリストシートを開けませんでした', true);
    }
  };

  // 「メンバーを追加」（旧: openProductionStaffAddダイアログ）は正本『スタッフ管理シート』を
  // 開く導線へ変更した（制作管理UX改善計画2026-08-04 §6-1）。追加自体は開いたシート側の
  // 通常の行追加操作で行う。
  window.openProductionStaffRegistrySheet = async function () {
    if (!window.MeldexUserRegistry || typeof selectDatabase !== 'function') {
      _pmStatus('スタッフ管理シートを開けませんでした', true);
      return;
    }
    try {
      let config = await window.MeldexUserRegistry.getConfig();
      if (!config?.path && typeof window.MeldexUserRegistry.ensure === 'function') {
        const ensured = await window.MeldexUserRegistry.ensure();
        config = { path: ensured?.path || '' };
      }
      if (!config?.path) throw new Error('スタッフ管理シートの場所を確認できませんでした');
      await selectDatabase(config.path, null, { fromExplorer: true });
    } catch (error) {
      _pmStatus(error?.message || 'スタッフ管理シートを開けませんでした', true);
    }
  };

  document.addEventListener('meldex:detail-tab-switched', (event) => {
    if (event.detail?.tab !== 'calendar-production') return;
    if (window.__MeldexSuppressCalendarTabAutoRender) return;
    const component = _pmFindCalendarComponent();
    if (component && typeof component._showProductionManagementPanel === 'function') {
      component._showProductionManagementPanel({ select: false });
    }
  });

  window.MeldexProductionManagementActions = Object.freeze({
    render: _pmRenderManagementActions,
    toolMenuItems: _pmToolMenuItems,
    emptyStateCard: _pmEmptyStateCard,
  });
})();
