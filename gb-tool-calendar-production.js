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
    { label: '再計算', icon: 'refreshCw', fn: 'openProductionRecalculate' },
    { label: 'メンバーを追加', icon: 'userPlus', fn: 'openProductionStaffAdd' },
    { label: '外部カレンダーへ送信', icon: 'send', fn: 'runProductionExternalSync' },
    { label: '書き出す', icon: 'fileOutput', fn: 'openProductionExport' },
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
    if (typeof window[action.fn] !== 'function') button.disabled = true;
    const icon = document.createElement('span');
    icon.className = 'gb-cal-production-action-icon';
    icon.innerHTML = _pmIcon(action.icon, 14);
    const label = document.createElement('span');
    label.textContent = action.label;
    button.append(icon, label);
    button.addEventListener('click', () => _pmRunAction(action));
    return button;
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

  function _pmTaskPathFromEvent(ev) {
    const description = String(ev?.description || '');
    const match = description.match(/元シート:\s*([^\n\r]+)/);
    return match ? match[1].trim() : '';
  }

  CalendarComponent.prototype._openProductionTaskEvent = function (ev) {
    const body = _pmOptionBody({ select: true });
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

  CalendarComponent.prototype._renderProductionManagementPanel = function (body) {
    if (!body) return;
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
    this._renderProductionManagementPanel(body);
  };

  window.openProductionManagementPanel = function () {
    const component = _pmFindCalendarComponent();
    if (!component || typeof component._showProductionManagementPanel !== 'function') {
      _pmStatus('スケジューラーを開いてから制作管理を開いてください', true);
      return;
    }
    component._showProductionManagementPanel();
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
})();
