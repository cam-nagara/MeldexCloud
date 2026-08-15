/* ==============================
   gb-tool-calendar-production.js: Scheduler production management panel
   ============================== */

(() => {
  if (typeof CalendarComponent === 'undefined') return;

  // 制作管理UX改善計画（2026-08-04）§6-1で導入した「管理操作」パネル（ACTIONS配列＋
  // グルーピング描画）は、df82a68f（2026-08-10、サイドバー5モード再編）でカレンダー
  // ツールバーの「管理操作」ボタンが MeldexProductionSidebar.showActions（allocationモード）
  // へ差し替えられたことで、到達経路を失った（スケジューラー複数アカウント修正計画
  // 2026-08-13 追加スコープで確認・削除）。現在の「割り当て」タブは gb-scheduler-ui.js の
  // renderAllocation が担う。
  const PRODUCTION_SHEET_TABS = [
    { key: 'tasks', id: 'production-task-list', label: 'タスクリスト', icon: 'listTodo' },
    { key: 'works', id: 'production-managed-works', label: 'プロジェクト一覧', icon: 'folderKanban' },
  ];

  function _pmIcon(name, size = 14) {
    return typeof lucide === 'function' ? lucide(name, size) : '';
  }

  function _pmStatus(message, error) {
    if (typeof showStatus === 'function') showStatus(message, !!error);
    else console[error ? 'error' : 'log'](message);
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
      return helpers.container('スケジュール', {
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
    header.textContent = 'スケジュール';
    const body = document.createElement('div');
    body.className = 'cal-option-body';
    detailEl.append(header, body);
    return body;
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
    toolMenuItems: _pmToolMenuItems,
    emptyStateCard: _pmEmptyStateCard,
  });
})();
