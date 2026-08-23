/* gb-tool-calendar-production-sheet-embed.js
 * シート（database/pivot）の表画面を、スケジュール等の任意のホスト要素へ
 * 「生きた2つ目のシート表」として埋め込むための独立モジュール。
 *
 * 借用モデル（グローバル #db-view-container を使い回す）には乗らず、下位レンダラー群
 * （renderPivot / showView / selectDatabase）が尊重する ctx.containerEl / ctx.tableId
 * 配線を利用して、独立DOMコンテナ内にシート表一式（thead/tbody・行編集・チェックボックス
 * 複数選択・一括編集バー・保存ビュー・仮想スクロール）をそのまま描画させる。
 *
 * 骨格は旧 gb-split.js の _createPaneDOM()（現在は showView() のペイン経路上書きにより
 * 到達不能な死にコード）を踏襲する。db-view-tabs / db-view-select を（非表示でも）必ず
 * 用意しているのは意図的：renderDbViewTabs() は _paneEl() が containerEl 内で要素を
 * 見つけられないと document.getElementById('db-view-tabs' 等) へフォールバックし、
 * メイン画面のビュータブUIを誤って上書きしてしまうため、その退避経路を塞ぐ目的がある。
 *
 * 画面への組み込み（タスクリスト面の再構成）は行わない。ここでは埋め込み機構と
 * create()/mount()/open() の最小APIのみを提供する。
 *
 * 既知の制約（呼び出し側は把握しておくこと）:
 * - 同一タスクリストシートをメインのシートタブと埋め込みの両方で同時に開いた場合、
 *   相互のライブ同期はしない（タブ切替・面切替時の再読込で追従する設計）。
 */
(function () {
  'use strict';

  const PANE_ID_PREFIX = 'gb-production-sheet-embed-';
  const TABLE_ID_PREFIX = 'pivot-table-';
  const SUBVIEW_CLASSES = ['tree-view', 'gallery-view', 'kanban-view', 'timeline-view', 'chart-view', 'graph-view', 'form-view'];
  const WRITE_GUARD_EVENTS = ['click', 'dblclick', 'contextmenu', 'dragstart', 'dragover', 'drop', 'beforeinput', 'input', 'change', 'keydown', 'paste', 'cut'];
  const WRITE_GUARD_HIDE_SELECTOR = [
    'tr.new-entity-row', '.row-add-btn', '.entity-row-more-btn', '.cell-add-btn',
    '.cell-value-more', '.db-chat-add-btn', '.col-add-prop',
  ].join(',');
  const WRITE_GUARD_DISABLE_SELECTOR = [
    'td[data-prop-name] input:not(.row-select-cb)',
    'td[data-prop-name] select',
    'td[data-prop-name] textarea',
    'td[data-prop-name] button',
    '.db-action-btn',
    '.db-bulk-edit-bar button:not([data-e2e-id^="db-bulk-clear-"])',
    '.db-cell-bulk-bar [data-e2e-id^="db-cell-bulk-paste-"]',
    '.db-cell-bulk-bar [data-e2e-id^="db-cell-bulk-delete-"]',
  ].join(',');
  const WRITE_GUARD_AFFORDANCE_SELECTOR = [
    'td[data-prop-name] [contenteditable="true"]', '.status-dot', '.cell-checkbox',
    '.cell-select-val', '.multi-select-tags', '.multi-user-tags', '.cell-date',
    '.cell-number', '.cell-value-more', '.cell-add-btn', '.db-chat-add-btn',
    '[data-production-write-guard-tabindex]',
  ].join(',');

  // selectDatabase() を containerEl 付き ctx で呼ぶ際、グローバル副作用を抑止するための既定オプション。
  // skipGlobalState は埋め込みの分離契約なので、呼び出し側からは解除できない。
  const DEFAULT_OPEN_SKIP_OPTS = Object.freeze({
    skipSaveLastView: true,
    skipNavPush: true,
    skipRecent: true,
    skipAutoVersion: true,
    skipHistoryScope: true,
    skipHighlight: true,
    skipGlobalUi: true,
    skipGlobalState: true,
  });

  function _logError(instance, message, error) {
    const label = instance && instance.paneId ? instance.paneId : '(unmounted)';
    console.error('[MeldexProductionSheetEmbed] ' + message + ': ' + label, error || '');
  }

  function _sanitizeIdSuffix(raw) {
    const cleaned = String(raw == null ? '' : raw).trim().replace(/[^a-zA-Z0-9_-]+/g, '-');
    return cleaned || ('anon-' + Date.now() + '-' + Math.floor(Math.random() * 1e6));
  }

  /* --- DOM構築（旧 gb-split.js _createPaneDOM() 相当） --- */

  function _createSubview(className, idSuffix) {
    const el = document.createElement('div');
    el.className = className;
    el.id = className + '-' + idSuffix;
    el.style.display = 'none';
    return el;
  }

  function _buildPivotView(idSuffix) {
    const pivotView = document.createElement('div');
    pivotView.className = 'pivot-view';
    pivotView.id = 'pivot-view-' + idSuffix;
    pivotView.style.cssText = 'flex:1;overflow:auto;min-height:0;';
    const table = document.createElement('table');
    table.id = TABLE_ID_PREFIX + idSuffix;
    table.className = 'pivot-table';
    table.appendChild(document.createElement('thead'));
    table.appendChild(document.createElement('tbody'));
    table.appendChild(document.createElement('tfoot'));
    pivotView.appendChild(table);
    return pivotView;
  }

  // db-view-tabs / db-view-select は非表示だが必須（ヘッダコメント参照: フォールバック汚染対策）。
  function _buildViewSwitcher(idSuffix) {
    const switcher = document.createElement('div');
    switcher.className = 'db-pane-view-switcher db-view-switcher';
    switcher.style.display = 'none';
    const tabs = document.createElement('div');
    tabs.id = 'db-view-tabs-' + idSuffix;
    tabs.className = 'db-view-tabs';
    const select = document.createElement('select');
    select.id = 'db-view-select-' + idSuffix;
    select.className = 'tb-select db-view-select';
    select.setAttribute('aria-label', 'ビュー切替（埋め込みシート）');
    switcher.appendChild(tabs);
    switcher.appendChild(select);
    return switcher;
  }

  function _buildDbViewContainer(idSuffix) {
    const dbViewContainer = document.createElement('div');
    dbViewContainer.className = 'db-view-container';
    dbViewContainer.style.cssText = 'display:flex;flex-direction:column;flex:1;min-height:0;overflow:hidden;';
    dbViewContainer.appendChild(_buildViewSwitcher(idSuffix));
    dbViewContainer.appendChild(_buildPivotView(idSuffix));
    SUBVIEW_CLASSES.forEach(className => {
      dbViewContainer.appendChild(_createSubview(className, idSuffix));
    });
    return dbViewContainer;
  }

  function _buildWriteStatus(instance) {
    const status = document.createElement('div');
    status.className = 'gb-production-sheet-embed-write-status';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    status.style.cssText = 'display:none;align-items:center;gap:6px;padding:6px 10px;border-bottom:1px solid var(--border);background:var(--bg2);color:var(--fg2);font-size:14px;';
    const label = document.createElement('span');
    label.className = 'gb-production-sheet-embed-write-status-label';
    status.appendChild(label);
    instance._writeStatusEl = status;
    instance._writeStatusLabelEl = label;
    return status;
  }

  function _buildContainerDOM(instance) {
    const wrapper = document.createElement('div');
    wrapper.className = 'gb-production-sheet-embed';
    wrapper.dataset.paneId = instance.paneId;
    wrapper.style.cssText = 'display:flex;flex-direction:column;height:100%;min-height:0;overflow:hidden;';
    wrapper.appendChild(_buildWriteStatus(instance));
    wrapper.appendChild(_buildDbViewContainer(instance.idSuffix));
    return wrapper;
  }

  // createPaneContext() 相当（PaneContext と同形状）。実際の createPaneContext() は使わない:
  // それはグローバルな _panes レジストリと _activePane シングルトンへ登録してしまい、
  // 他のコード（_currentPaneState() のフォールバック等）から誤って本インスタンスの ctx が
  // 「現在アクティブなペイン」として参照され得るため（グローバル副作用ゼロの要件に反する）。
  function _buildPaneContext(instance) {
    return {
      paneId: instance.paneId,
      // gb-database.part01.js の _resolveDatabasePaneContext() へ「GBLayoutに意図的に
      // 未登録の埋め込み専用ctx」であることを伝えるフラグ。paneId が常に findNode で
      // 見つからないことを理由にメイン画面側のctxへ差し替えられてしまう問題(P0)を防ぐ。
      embedded: true,
      destroyed: false,
      generation: instance._generation,
      hostController: instance,
      dbPath: null,
      entityPath: null,
      pagePath: null,
      boardPath: null,
      pivotData: null,
      filter: 'disabled',
      viewMode: 'welcome',
      smartDb: null,
      smartDbData: null,
      containerEl: instance.containerEl,
      tableId: instance.tableId,
      _selectedEntities: new Set(),
    };
  }

  /* --- インスタンス操作 --- */

  function _cloudWriteAvailability() {
    const shared = window.MeldexProductionUiAvailability?.current?.();
    if (shared && typeof shared.blocked === 'boolean') return shared;
    const dataset = document.body?.dataset || {};
    if (dataset.cloudReadonly === '1') return { blocked: true, reason: '閲覧専用モードのため編集できません', kind: 'readonly' };
    if (dataset.cloudQuotaBlocked === '1') return { blocked: true, reason: 'Dropbox容量が95%を超えているため編集を停止しています', kind: 'quota' };
    return { blocked: false, reason: '', kind: '' };
  }

  function _cachedLockState(path) {
    if (!path || typeof isItemLocked !== 'function') return { locked: false, reason: '' };
    try {
      const locked = !!isItemLocked(path);
      const reason = locked && typeof getItemLockReason === 'function'
        ? String(getItemLockReason(path) || '').trim()
        : '';
      return { locked, reason };
    } catch {
      return { locked: false, reason: '' };
    }
  }

  function _currentWriteGuard(instance) {
    const path = instance._guardPath || instance._currentPath || instance.ctx?.dbPath || '';
    const availability = _cloudWriteAvailability();
    const hasLockCache = typeof isItemLocked === 'function';
    const cachedLock = _cachedLockState(path);
    const lockState = instance._lockState?.path === path ? instance._lockState : null;
    // キャッシュAPIがある場合は現在値を正とする。過去の _lockState をORすると、
    // ロック解除後も埋め込みだけが永久に編集不可になる。
    const locked = hasLockCache ? cachedLock.locked : !!lockState?.locked;
    const lockReason = hasLockCache ? cachedLock.reason : (lockState?.reason || '');
    const reasons = availability.blocked ? [availability.reason] : [];
    if (lockState?.pending && !availability.blocked) reasons.push('編集ロックを確認しています');
    if (lockState?.failed) reasons.push('編集ロックを確認できないため編集を一時停止しています');
    if (locked) reasons.push('編集ロック中' + (lockReason ? ': ' + lockReason : ''));
    return { blocked: reasons.length > 0, locked, path, reason: reasons.join(' / ') };
  }

  function _setGuardHidden(element, blocked) {
    if (!element) return;
    const marker = 'data-production-write-guard-hidden';
    if (blocked) {
      if (!element.hasAttribute?.(marker)) element.setAttribute(marker, element.hidden ? 'existing' : 'guard');
      element.hidden = true;
      return;
    }
    if (element.getAttribute?.(marker) === 'guard') element.hidden = false;
    element.removeAttribute?.(marker);
  }

  function _setGuardDisabled(element, blocked) {
    if (!element) return;
    const marker = 'data-production-write-guard-disabled';
    const ariaMarker = 'data-production-write-guard-aria-disabled';
    if (blocked) {
      if (!element.hasAttribute?.(marker)) element.setAttribute(marker, element.disabled ? 'existing' : 'guard');
      if (!element.hasAttribute?.(ariaMarker)) {
        const currentAria = element.getAttribute?.('aria-disabled');
        element.setAttribute?.(ariaMarker, currentAria == null ? '__none__' : currentAria);
      }
      element.disabled = true;
      element.setAttribute?.('aria-disabled', 'true');
      return;
    }
    if (element.getAttribute?.(marker) === 'guard') element.disabled = false;
    const previousAria = element.getAttribute?.(ariaMarker);
    if (previousAria === '__none__') element.removeAttribute?.('aria-disabled');
    else if (previousAria != null) element.setAttribute?.('aria-disabled', previousAria);
    element.removeAttribute?.(marker);
    element.removeAttribute?.(ariaMarker);
  }

  function _setGuardAffordance(element, blocked) {
    if (!element) return;
    const marker = 'data-production-write-guard-tabindex';
    const ariaMarker = 'data-production-write-guard-affordance-aria';
    if (blocked) {
      if (!element.hasAttribute?.(marker)) {
        const current = element.getAttribute?.('tabindex');
        element.setAttribute?.(marker, current == null ? '__none__' : current);
      }
      if (!element.hasAttribute?.(ariaMarker)) {
        const currentAria = element.getAttribute?.('aria-disabled');
        element.setAttribute?.(ariaMarker, currentAria == null ? '__none__' : currentAria);
      }
      if (element.getAttribute?.('contenteditable') === 'true') {
        element.setAttribute('data-production-write-guard-contenteditable', 'true');
        element.setAttribute('contenteditable', 'false');
      }
      element.setAttribute?.('tabindex', '-1');
      element.setAttribute?.('aria-disabled', 'true');
      return;
    }
    const previous = element.getAttribute?.(marker);
    if (previous === '__none__') element.removeAttribute?.('tabindex');
    else if (previous != null) element.setAttribute?.('tabindex', previous);
    if (element.getAttribute?.('data-production-write-guard-contenteditable') === 'true') {
      element.setAttribute('contenteditable', 'true');
      element.removeAttribute('data-production-write-guard-contenteditable');
    }
    const previousAria = element.getAttribute?.(ariaMarker);
    if (previousAria === '__none__') element.removeAttribute?.('aria-disabled');
    else if (previousAria != null) element.setAttribute?.('aria-disabled', previousAria);
    element.removeAttribute?.(marker);
    element.removeAttribute?.(ariaMarker);
  }

  function _setGuardDraggable(element, blocked) {
    if (!element) return;
    const marker = 'data-production-write-guard-draggable';
    if (blocked) {
      if (!element.hasAttribute?.(marker)) element.setAttribute(marker, element.draggable ? 'true' : 'false');
      element.draggable = false;
      return;
    }
    const previous = element.getAttribute?.(marker);
    if (previous != null) element.draggable = previous === 'true';
    element.removeAttribute?.(marker);
  }

  function _applyWriteGuardToDom(instance, guard) {
    const root = instance.containerEl;
    if (!root) return;
    if (guard.blocked) root.dataset.writeBlocked = '1';
    else delete root.dataset.writeBlocked;
    root.setAttribute('aria-readonly', guard.blocked ? 'true' : 'false');
    root.querySelectorAll?.(WRITE_GUARD_HIDE_SELECTOR).forEach(element => _setGuardHidden(element, guard.blocked));
    root.querySelectorAll?.(WRITE_GUARD_DISABLE_SELECTOR).forEach(element => _setGuardDisabled(element, guard.blocked));
    root.querySelectorAll?.(WRITE_GUARD_AFFORDANCE_SELECTOR).forEach(element => _setGuardAffordance(element, guard.blocked));
    // 行・値のドラッグはデータ書込につながるため止める。列ヘッダのドラッグは
    // ローカル表示順だけを変えるので残す。
    root.querySelectorAll?.('tbody tr[draggable="true"], .cell-value[draggable="true"], [data-production-write-guard-draggable]').forEach(element => _setGuardDraggable(element, guard.blocked));
  }

  function _renderWriteGuard(instance) {
    const wasBlocked = instance._activeWriteGuard?.blocked === true;
    const guard = _currentWriteGuard(instance);
    instance._activeWriteGuard = guard;
    if (instance.ctx) {
      instance.ctx.writeBlocked = guard.blocked;
      instance.ctx.writeBlockedReason = guard.reason;
    }
    const status = instance._writeStatusEl;
    const label = instance._writeStatusLabelEl;
    if (status && label) {
      const nextLabel = guard.blocked ? guard.reason : '';
      // childList を監視しているため、同じ textContent の再代入は自己再発火ループになる。
      if (label.textContent !== nextLabel) label.textContent = nextLabel;
      status.style.display = guard.blocked ? 'flex' : 'none';
      if (instance._writeBadgePath !== guard.path) {
        instance._writeBadgePath = guard.path;
        window.MeldexFileLockBadge?.apply?.(label, guard.path);
      }
    }
    _applyWriteGuardToDom(instance, guard);
    // blocked 中にも選択数などから本来の disabled/hidden 状態は変わり得る。
    // 解除時は古いスナップショットだけに頼らず表を再描画し、DB側の最新状態で再計算する。
    if (wasBlocked && !guard.blocked && !instance._guardReleaseRefreshPending
        && instance._currentPath && instance.ctx?.dbPath === instance._currentPath && instance.ctx?.pivotData) {
      instance._guardReleaseRefreshPending = true;
      Promise.resolve().then(() => {
        instance._guardReleaseRefreshPending = false;
        if (!instance._destroyed && instance.ctx?.dbPath === instance._currentPath
            && typeof renderPivot === 'function') renderPivot(instance.ctx);
      });
    }
    return guard;
  }

  async function _refreshWriteGuard(instance, path) {
    const seq = ++instance._writeGuardSeq;
    instance._guardPath = path || '';
    instance._lockState = { path: instance._guardPath, pending: typeof _ensureLocksLoaded === 'function', locked: false, reason: '', failed: false };
    _renderWriteGuard(instance);
    if (typeof _ensureLocksLoaded === 'function') {
      try {
        await _ensureLocksLoaded();
      } catch {
        if (seq === instance._writeGuardSeq) instance._lockState.failed = true;
      }
    }
    if (seq !== instance._writeGuardSeq || instance._destroyed) return false;
    const lock = _cachedLockState(instance._guardPath);
    instance._lockState = { path: instance._guardPath, pending: false, locked: lock.locked, reason: lock.reason, failed: !!instance._lockState?.failed };
    _renderWriteGuard(instance);
    return true;
  }

  function _writeGuardAllowsEvent(event) {
    const target = event.target;
    const closest = typeof target?.closest === 'function'
      ? selector => {
        try { return target.closest(selector); } catch { return null; }
      }
      : () => null;
    if (closest('.row-select-cb')) return true;
    if (closest('[data-e2e-id^="db-bulk-clear-"], [data-e2e-id^="db-cell-bulk-clear-"], [data-e2e-id^="db-cell-bulk-copy-"]')) return true;
    if (event.type === 'click') {
      if (closest('.col-resize-handle, tr.group-header-row, a[href]')) return true;
      if ((event.shiftKey || event.ctrlKey || event.metaKey) && closest('td[data-prop-name]')) return true;
      if (closest('thead th:not(.col-add-prop)')) return true;
    }
    if (event.type === 'contextmenu' && closest('thead th:not(.col-add-prop)')) return true;
    if (event.type === 'keydown') {
      const key = String(event.key || '');
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown', 'Tab', 'Escape'].includes(key)) return true;
      if ((event.ctrlKey || event.metaKey) && ['a', 'c', 'f'].includes(key.toLowerCase())) return true;
    }
    if (event.type === 'dragstart' && closest('thead th:not(.col-add-prop)')) return true;
    if ((event.type === 'dragover' || event.type === 'drop') && closest('thead th:not(.col-add-prop)')) {
      const types = Array.from(event.dataTransfer?.types || []);
      if (types.includes('text/x-col-name')) return true;
    }
    if (event.type === 'dragstart' && closest('.gb-selection-float-drag')) return true;
    return false;
  }

  function _announceWriteGuard(instance, guard) {
    const now = Date.now();
    if (now - instance._lastWriteGuardAnnouncement < 900) return;
    instance._lastWriteGuardAnnouncement = now;
    if (guard.reason && typeof showStatus === 'function') showStatus(guard.reason, true);
  }

  function _handleWriteGuardEvent(instance, event) {
    const guard = _renderWriteGuard(instance);
    if (!guard.blocked || _writeGuardAllowsEvent(event)) return;
    event.preventDefault?.();
    if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();
    else event.stopPropagation?.();
    _announceWriteGuard(instance, guard);
  }

  function _installWriteGuard(instance) {
    const root = instance.containerEl;
    if (!root) return;
    instance._writeGuardHandler = event => _handleWriteGuardEvent(instance, event);
    WRITE_GUARD_EVENTS.forEach(type => root.addEventListener(type, instance._writeGuardHandler, true));
    if (typeof MutationObserver === 'function') {
      instance._writeGuardDomObserver = new MutationObserver(() => _renderWriteGuard(instance));
      instance._writeGuardDomObserver.observe(root, { childList: true, subtree: true });
      if (document.body) {
        instance._writeGuardBodyObserver = new MutationObserver(() => _renderWriteGuard(instance));
        instance._writeGuardBodyObserver.observe(document.body, {
          attributes: true,
          attributeFilter: ['data-cloud-readonly', 'data-cloud-quota-blocked'],
        });
      }
    }
    _renderWriteGuard(instance);
  }

  function _destroyWriteGuard(instance) {
    if (instance.containerEl && instance._writeGuardHandler) {
      WRITE_GUARD_EVENTS.forEach(type => instance.containerEl.removeEventListener(type, instance._writeGuardHandler, true));
    }
    instance._writeGuardDomObserver?.disconnect?.();
    instance._writeGuardBodyObserver?.disconnect?.();
    window.MeldexFileLockBadge?.apply?.(instance._writeStatusLabelEl, '');
    instance._writeBadgePath = '';
    instance._writeGuardHandler = null;
    instance._writeGuardDomObserver = null;
    instance._writeGuardBodyObserver = null;
  }

  function _mount(instance, hostEl) {
    if (instance._destroyed) {
      _logError(instance, 'destroy 済みインスタンスは再マウントできません');
      return null;
    }
    if (instance._mounted && instance.containerEl) return instance.containerEl;
    if (!hostEl || typeof hostEl.appendChild !== 'function') {
      _logError(instance, 'mount先のホスト要素が不正です');
      return null;
    }
    instance.hostEl = hostEl;
    instance.containerEl = _buildContainerDOM(instance);
    hostEl.appendChild(instance.containerEl);
    instance.ctx = _buildPaneContext(instance);
    // GBLayout のグローバルペインレジストリへ登録せず、埋め込みDOMからだけ
    // コンテキストを解決できるようにする。セル編集や再描画がグローバルstateへ
    // 戻った後も、このシート固有の property_types を失わないために必要。
    instance.containerEl._dbPaneContext = instance.ctx;
    _installWriteGuard(instance);
    if (typeof MutationObserver === 'function') {
      instance._schedulerOverlayObserver = new MutationObserver(() => {
        window.MeldexSchedulerProposalOverlay?.applyTaskTable?.(
          instance.containerEl, window.MeldexSchedulerProposalOverlay?.active?.(),
        );
      });
      instance._schedulerOverlayObserver.observe(instance.containerEl, { childList: true, subtree: true });
    }
    instance._mounted = true;
    return instance.containerEl;
  }

  // 同じ ctx / table を selectDatabase() が直接更新するため、同一埋め込み内では読み込みを
  // 必ず直列化する。generation は未開始の古い要求を省略し、実行中の要求を後発が追い越した
  // 場合はその完了直後に最新要求を描画し直す。これにより応答順に関係なく最後の要求が
  // ctx・表・_currentPath のすべてを所有する。
  async function _performOpen(instance, path, mergedOpts, generation) {
    if (generation !== instance._generation || instance._destroyed) return false;
    // selectDatabase() は旧表示設定の移行を書き込む場合があるため、先にロックを確定し、
    // ctx.writeBlocked を永続化層へ伝えてからシートを読み込む。
    if (!await _refreshWriteGuard(instance, path)) return false;
    if (generation !== instance._generation) return false;
    instance.ctx.generation = generation;
    // 開くパスが直前と異なる場合は、前シートで適用した採用状況フィルタ・保存ビュー選択を
    // 持ち越さない。制作管理シートの既定ビューは filter キーを持たないため、
    // selectDatabase() のフォールバック（gb-database.part01.js の _resolveInitialFilter()
    // 相当）で前シートの ctx.filter がそのまま残ると /pivot?status_filter=... が誤って
    // 適用され0件表示になる（タスクリスト作品タブ切替バグの真因）。シート自身に保存済み
    // フィルタがあれば、直後の selectDatabase() が正しく再適用する。
    if (instance.ctx.dbPath !== path) {
      instance.ctx.filter = 'disabled';
      delete instance.ctx.currentViewIdx;
    }
    try {
      const result = await selectDatabase(path, instance.ctx, mergedOpts);
      if (result === false || result?.ok === false) return false;
    } catch (error) {
      _logError(instance, 'タスクリストの読み込みに失敗しました: ' + path, error);
      if (!mergedOpts.silent && typeof showStatus === 'function') {
        showStatus('タスクリストを読み込めませんでした: ' + (error?.message || error), true);
      }
      return false;
    }
    if (generation !== instance._generation) return false; // 追い越された古い応答は破棄
    if (!await _refreshWriteGuard(instance, path)) return false;
    if (generation !== instance._generation) return false;
    instance._currentPath = path;
    window.MeldexSchedulerProposalOverlay?.applyTaskTable?.(
      instance.containerEl, window.MeldexSchedulerProposalOverlay?.active?.(),
    );
    return true;
  }

  async function _open(instance, dbPath, openOpts) {
    if (instance._destroyed) {
      _logError(instance, 'destroy 済みインスタンスは開けません');
      return false;
    }
    if (!instance.isMounted() || !instance.ctx) {
      _logError(instance, 'open() の前に mount() が必要です');
      return false;
    }
    const path = String(dbPath == null ? '' : dbPath).trim();
    if (!path) {
      _logError(instance, 'dbPath が空です');
      return false;
    }
    if (typeof selectDatabase !== 'function') {
      _logError(instance, 'selectDatabase が未定義です。読み込み順序を確認してください');
      return false;
    }
    const generation = ++instance._generation;
    instance.ctx.generation = generation;
    const mergedOpts = Object.assign({}, DEFAULT_OPEN_SKIP_OPTS, openOpts || {}, {
      skipGlobalState: true,
      embeddedHostDispatch: true,
    });
    const queued = instance._openTail.then(
      () => _performOpen(instance, path, mergedOpts, generation),
      () => _performOpen(instance, path, mergedOpts, generation),
    );
    // 次の要求を先行要求の成否に関係なく実行できる、常に解決する末尾へ正規化する。
    instance._openTail = queued.then(() => undefined, () => undefined);
    return queued;
  }

  function _refresh(instance) {
    if (!instance._currentPath) return Promise.resolve(false);
    return _open(instance, instance._currentPath, { silent: true, forceReload: true });
  }

  function _getSelectedEntryPaths(instance) {
    if (!instance.ctx || !instance.ctx._selectedEntities || instance.ctx._selectedEntities.size === 0) return [];
    const dbPath = instance.ctx.dbPath;
    if (!dbPath) return [];
    if (typeof _entityPath !== 'function') {
      _logError(instance, '_entityPath が未定義です。読み込み順序を確認してください');
      return [];
    }
    const pivotData = instance.ctx.pivotData;
    const paths = [];
    instance.ctx._selectedEntities.forEach(entityName => {
      if (!entityName) return;
      try {
        const resolved = _entityPath(dbPath, entityName, pivotData);
        if (resolved) paths.push(resolved);
      } catch (error) {
        _logError(instance, '選択トピックのパス解決に失敗しました: ' + entityName, error);
      }
    });
    return paths;
  }

  function _setVisible(instance, visible) {
    if (!instance.containerEl) return;
    // このインスタンス単体の表示切替では DOM から外さない（display:none のみ）。
    // 親のsurface切替ではworkspace全体が一時detachされ得るが、明示ctxと専用tableを
    // 保持したまま描画を続け、再attach時に完成済みの表を表示する。
    instance.containerEl.style.display = visible ? 'flex' : 'none';
  }

  function _destroy(instance) {
    if (instance._destroyed) return;
    instance._destroyed = true;
    instance._generation += 1; // 進行中 open() の応答が _currentPath を更新しないようにする
    instance._writeGuardSeq += 1;
    instance._schedulerOverlayObserver?.disconnect?.();
    instance._schedulerOverlayObserver = null;
    _destroyWriteGuard(instance);
    const ctx = instance.ctx;
    if (ctx) {
      ctx.destroyed = true;
      ctx.generation = (ctx.generation || 0) + 1;
      ctx._renderToken = null;
      ctx._renderInProgress = false;
      if (ctx._dragSelectPointerUp) {
        document.removeEventListener('pointerup', ctx._dragSelectPointerUp);
        document.removeEventListener('pointercancel', ctx._dragSelectPointerUp);
        ctx._dragSelectPointerUp = null;
      }
      ctx._dragSelectState = null;
      if (ctx._selectDatabaseInFlight) delete ctx._selectDatabaseInFlight;
    }
    // destroyPaneContext() は data-pane-id="<paneId>" を持つ一括編集バー等の残骸を掃除する。
    // 本インスタンスの ctx は _panes レジストリに未登録のため、_panes 側の処理は無害な no-op。
    if (typeof destroyPaneContext === 'function') {
      try { destroyPaneContext(instance.paneId); } catch (error) { _logError(instance, 'destroyPaneContext に失敗しました', error); }
    }
    if (instance.containerEl && instance.containerEl.parentNode) {
      instance.containerEl._dbPaneContext = null;
      instance.containerEl.parentNode.removeChild(instance.containerEl);
    }
    instance.containerEl = null;
    instance.ctx = null;
    instance.hostEl = null;
    instance._mounted = false;
  }

  /* --- ファクトリ --- */

  function create(options) {
    const opts = options || {};
    const idSuffix = _sanitizeIdSuffix(opts.idSuffix);
    const instance = {
      idSuffix,
      paneId: PANE_ID_PREFIX + idSuffix,
      tableId: TABLE_ID_PREFIX + idSuffix,
      hostEl: null,
      containerEl: null,
      ctx: null,
      _mounted: false,
      _destroyed: false,
      _generation: 0,
      _openTail: Promise.resolve(),
      _writeGuardSeq: 0,
      _guardPath: '',
      _lockState: null,
      _activeWriteGuard: null,
      _writeStatusEl: null,
      _writeStatusLabelEl: null,
      _writeBadgePath: '',
      _writeGuardHandler: null,
      _writeGuardDomObserver: null,
      _writeGuardBodyObserver: null,
      _guardReleaseRefreshPending: false,
      _schedulerOverlayObserver: null,
      _lastWriteGuardAnnouncement: 0,
      _currentPath: null,
    };

    instance.isMounted = function () { return instance._mounted && !instance._destroyed; };
    instance.getCurrentPath = function () { return instance._currentPath; };
    instance.mount = function (hostEl) { return _mount(instance, hostEl); };
    instance.open = function (dbPath, openOpts) { return _open(instance, dbPath, openOpts); };
    instance.refresh = function () { return _refresh(instance); };
    instance.applySchedulerProposal = function (proposal) {
      return window.MeldexSchedulerProposalOverlay?.applyTaskTable?.(instance.containerEl, proposal)
        || { matched: 0, warnings: [] };
    };
    instance.getSelectedEntryPaths = function () { return _getSelectedEntryPaths(instance); };
    instance.setVisible = function (visible) { _setVisible(instance, visible); };
    instance.destroy = function () { _destroy(instance); };

    return instance;
  }

  window.MeldexProductionSheetEmbed = Object.freeze({ create });
})();
