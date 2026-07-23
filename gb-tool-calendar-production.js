/* ==============================
   gb-tool-calendar-production.js: Scheduler production management panel
   ============================== */

(() => {
  if (typeof CalendarComponent === 'undefined') return;

  const ACTIONS = [
    { label: '制作管理を始める', icon: 'hammer', fn: 'openProductionManagementStart' },
    { label: 'タスクを作成', icon: 'listPlus', fn: 'openProductionTaskCreate' },
    { label: 'シフトを取り込む', icon: 'fileInput', fn: 'openProductionShiftImport' },
    { label: '担当者と時間を割り当て', icon: 'users', fn: 'runProductionAssignment' },
    { label: '再計算', icon: 'refreshCw', fn: 'openProductionRecalculate', desktopOnly: true },
    { label: 'メンバーを追加', icon: 'userPlus', fn: 'openProductionStaffAdd' },
    { label: '外部カレンダーへ送信', icon: 'send', fn: 'runProductionExternalSync', desktopOnly: true },
    { label: '書き出す', icon: 'fileOutput', fn: 'openProductionExport' },
  ];
  // 中央のシート表示や共通ツールバーと重複しない、制作管理固有の操作だけを
  // 右側の「管理操作」に残す。タスク作成と再計算は一覧/共通ツールバーから行う。
  const MANAGEMENT_ACTIONS = ACTIONS.filter(action => !['openProductionTaskCreate', 'openProductionRecalculate'].includes(action.fn));
  const PRODUCTION_SHEET_TABS = [
    { key: 'tasks', id: 'production-task-list', label: 'タスクリスト', icon: 'listTodo' },
    { key: 'works', id: 'production-managed-works', label: '作品設定', icon: 'bookOpen' },
    { key: 'targets', id: 'production-managed-targets', label: '作業対象', icon: 'crosshair' },
    { key: 'contents', id: 'production-managed-contents', label: '作業内容', icon: 'listChecks' },
    { key: 'scales', id: 'production-managed-scales', label: '作業規模', icon: 'gauge' },
    { key: 'staff', id: 'production-managed-staff', label: 'スタッフ', icon: 'users' },
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

  function _pmRenderManagementActions(host) {
    if (!host) return;
    host.replaceChildren();
    const intro = document.createElement('p');
    intro.className = 'gb-production-management-actions-note';
    const availability = window.MeldexProductionUiAvailability?.current?.() || { blocked: false, reason: '' };
    if (availability.blocked) {
      intro.textContent = `${availability.reason}。ここでは内容の確認と書き出しだけを利用できます。`;
    } else {
      intro.innerHTML = '管理操作 ' + fieldHelp('初期設定、割り当て、外部連携など、表編集では行えない操作です。');
    }
    const actions = document.createElement('div');
    actions.className = 'gb-cal-production-actions gb-production-management-actions';
    MANAGEMENT_ACTIONS.forEach(action => actions.appendChild(_pmActionButton(action)));
    host.append(intro, actions);
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
    const dropboxMode = _pmIsDropboxMode();
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
    const quickButton = component.el?.querySelector?.('[data-e2e-id="gb-production-quick-open"]');
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
        id: 'production-quick-plan', label: dropboxMode ? 'かんたん割当（デスクトップ版のみ）' : 'かんたん割当', icon: 'wandSparkles',
        disabled: dropboxMode || !quickButton || quickButton.disabled,
        action: () => _pmRunCalendarToolbarAction(component, 'quickPlan'),
      },
      {
        id: 'production-templates', label: 'テンプレート', icon: 'layoutTemplate',
        action: () => _pmRunCalendarToolbarAction(component, 'template'),
      },
      {
        id: 'production-recalculate', label: dropboxMode ? '再計算（デスクトップ版のみ）' : '再計算', icon: 'calculator',
        disabled: dropboxMode,
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

  CalendarComponent.prototype._openProductionTaskEvent = function (ev) {
    const body = _pmOptionBody({ select: true });
    if (body && window.MeldexProductionSidebar?.openTaskEvent) {
      window.MeldexProductionSidebar.openTaskEvent(body, ev, this);
      return true;
    }
    if (body && window.MeldexProductionPanel?.openTaskEvent) {
      window.MeldexProductionPanel.openTaskEvent(body, ev);
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
    if (window.MeldexProductionPanel?.render) {
      window.MeldexProductionPanel.render(body, { tab: 'summary' });
      return;
    }
    body.replaceChildren();
    const panel = document.createElement('div');
    panel.className = 'gb-cal-production-panel';
    const actions = document.createElement('div');
    actions.className = 'gb-cal-production-actions';
    ACTIONS.forEach(action => actions.appendChild(_pmActionButton(action)));
    panel.appendChild(actions);
    body.appendChild(panel);
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
  });
})();
