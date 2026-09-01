/* ==============================
   gb-tool-calendar-event-selection.js: Event selection and bulk actions
   ============================== */

(() => {
  if (typeof CalendarComponent === 'undefined' || !window.MeldexCalendarOptions) return;
  const {
    DEFAULT_EVENT_COLOR,
    _calEsc,
    _calIcon,
    _calCssEscape,
    _calKeyboardFromEditableTarget,
  } = window.MeldexCalendarOptions;

  CalendarComponent.prototype._isCalVisible = function(ev) {
    if (this._calendars.length === 0 || !ev?.calendar_id) return true;
    if (this._visibleCalIds.has(ev.calendar_id)) return true;
    const calendarKnown = this._calendars.some(cal => cal.id === ev.calendar_id);
    return !calendarKnown && this._eventUserNames(ev).includes(this._getUser());
  };

  CalendarComponent.prototype._firstCalendar = function() {
    return (this._calendars || []).find(c => this._visibleCalIds?.has(c.id)) || (this._calendars || [])[0] || null;
  };

  CalendarComponent.prototype._eventColorDefault = function() {
    return this._firstCalendar()?.color || DEFAULT_EVENT_COLOR;
  };

  CalendarComponent.prototype._eventSelection = function() {
    if (!this._selectedEventIds) this._selectedEventIds = new Set();
    return this._selectedEventIds;
  };

  CalendarComponent.prototype._selectedEventRecords = function() {
    const eventsById = new Map((this._events || []).map(ev => [String(ev?.id || ''), ev]));
    const sel = this._eventSelection();
    const records = [];
    [...sel].forEach(id => {
      const ev = eventsById.get(String(id || ''));
      if (ev) records.push(ev);
      else sel.delete(id);
    });
    if (!records.length) this._lastSelectedEventId = '';
    return records;
  };

  CalendarComponent.prototype._renderedEventIds = function() {
    const ids = [];
    this._contentEl?.querySelectorAll?.('[data-event-id]').forEach(card => {
      const id = card.dataset.eventId || '';
      if (id && !ids.includes(id)) ids.push(id);
    });
    return ids;
  };

  CalendarComponent.prototype._setSelectedEvents = function(ids, lastId) {
    const sel = this._eventSelection();
    sel.clear();
    (ids || []).filter(Boolean).forEach(id => sel.add(id));
    this._lastSelectedEventId = lastId || ids?.[ids.length - 1] || '';
    this._syncEventSelectionDom();
  };

  CalendarComponent.prototype._toggleEventSelection = function(id) {
    this._setEventSelectionState(id, !this._eventSelection().has(id));
  };

  CalendarComponent.prototype._setEventSelectionState = function(id, selected) {
    if (!id) return;
    const sel = this._eventSelection();
    if (selected) sel.add(id);
    else sel.delete(id);
    this._lastSelectedEventId = id;
    this._syncEventSelectionDom();
  };

  CalendarComponent.prototype._selectEventRange = function(id) {
    const order = this._renderedEventIds();
    const anchor = this._lastSelectedEventId || id;
    const a = order.indexOf(anchor), b = order.indexOf(id);
    if (a < 0 || b < 0) {
      this._setSelectedEvents([id], id);
      return;
    }
    const [from, to] = a < b ? [a, b] : [b, a];
    this._setSelectedEvents(order.slice(from, to + 1), id);
  };

  CalendarComponent.prototype._syncEventSelectionDom = function() {
    const records = this._selectedEventRecords();
    const selectedIds = new Set(records.map(ev => String(ev?.id || '')));
    this._contentEl?.classList?.toggle?.('gb-cal-has-event-selection', selectedIds.size > 0);
    this._contentEl?.querySelectorAll?.('[data-event-id]').forEach(card => {
      const id = card.dataset.eventId || '';
      card.classList.toggle('gb-cal-event-selected', selectedIds.has(id));
      let check = card.querySelector(':scope > .gb-cal-event-select-check');
      if (!check) {
        check = document.createElement('input');
        check.type = 'checkbox';
        check.className = 'gb-cal-event-select-check';
        check.setAttribute('aria-label', '選択');
        card.insertBefore(check, card.firstChild);
      }
      const selected = selectedIds.has(id);
      check.checked = selected;
      check.setAttribute('aria-checked', selected ? 'true' : 'false');
      check.classList.toggle('is-selected', selected);
    });
    this._syncAnalogClockSelectionDom?.();
    this._syncEventSelectionBar?.(records);
  };

  CalendarComponent.prototype._clearEventSelection = function() {
    this._setSelectedEvents([], '');
    this._closeEventCardMenu?.();
  };

  CalendarComponent.prototype._eventSource = function(ev) {
    return String(ev?.calendar_source || '');
  };

  CalendarComponent.prototype._eventIsShiftManaged = function(ev) {
    const source = this._eventSource(ev);
    return source === 'shift' || source === 'shift-break' || String(ev?.id || '').startsWith('shift:');
  };

  CalendarComponent.prototype._shiftIdFromEvent = function(ev) {
    const raw = String(ev?.id || '').startsWith('shift:')
      ? String(ev.id).slice('shift:'.length)
      : String(ev?.external_id || ev?.id || '');
    return raw.split(':break:')[0];
  };

  CalendarComponent.prototype._eventCanBulkDelete = function(ev) {
    if (!ev || ev._recurrence_instance) return false;
    return !['production-task', 'attendance'].includes(this._eventSource(ev));
  };

  CalendarComponent.prototype._eventCanBulkDuplicate = function(ev) {
    if (!ev || ev._recurrence_instance) return false;
    if (this._eventIsShiftManaged(ev)) return false;
    return !['production-task', 'attendance'].includes(this._eventSource(ev));
  };

  CalendarComponent.prototype._eventDuplicatePayload = function(ev) {
    const title = String(ev?.title || '無題');
    const alertMinutes = Number(ev?.alert_minutes);
    return {
      title: title.endsWith(' コピー') ? title : title + ' コピー',
      start: ev?.start || '',
      end: ev?.end || '',
      all_day: ev?.all_day ? 1 : 0,
      color: ev?.color || this._eventColorDefault(),
      description: ev?.description || '',
      location: ev?.location || '',
      url: ev?.url || '',
      recurrence: ev?.recurrence || '',
      calendar_id: ev?.calendar_id || '',
      alert_minutes: Number.isFinite(alertMinutes) ? alertMinutes : -1,
      user: this._getUser(),
      creator: this._getUser(),
      members: Array.isArray(ev?.members) ? ev.members : [],
    };
  };

  CalendarComponent.prototype._deletePlanForSelectedEvents = function(records) {
    const eventIds = [];
    const shiftIds = new Set();
    let blocked = 0;
    (records || []).forEach(ev => {
      if (!this._eventCanBulkDelete(ev)) {
        blocked += 1;
        return;
      }
      if (this._eventIsShiftManaged(ev)) {
        const shiftId = this._shiftIdFromEvent(ev);
        if (shiftId) shiftIds.add(shiftId);
        else blocked += 1;
        return;
      }
      if (ev?.id && !eventIds.includes(ev.id)) eventIds.push(ev.id);
    });
    return { eventIds, shiftIds: [...shiftIds], blocked };
  };

  CalendarComponent.prototype._duplicateSelectedEvents = async function() {
    const selected = this._selectedEventRecords();
    const targets = selected.filter(ev => this._eventCanBulkDuplicate(ev));
    const skipped = selected.length - targets.length;
    if (!targets.length) {
      this._showStatus('複製できるイベントがありません', true);
      return;
    }
    this._pushUndo('イベント一括複製');
    const createdIds = [];
    try {
      for (const ev of targets) {
        const result = await apiPost('/cal/events', this._eventDuplicatePayload(ev));
        if (result?.id) createdIds.push(result.id);
      }
      await this._loadEvents();
      this._setSelectedEvents(createdIds, createdIds[createdIds.length - 1] || '');
      this._render();
      const suffix = skipped ? `（${skipped}件は複製対象外）` : '';
      this._showStatus(`${createdIds.length} 件を複製しました${suffix}`);
    } catch (error) {
      await Promise.all(createdIds.map(id => apiFetch('/cal/events/' + encodeURIComponent(id), { method: 'DELETE' }).catch(() => {})));
      await this._loadEvents();
      this._render();
      this._showStatus(error?.message || '複製に失敗しました', true);
    }
  };

  CalendarComponent.prototype._deleteSelectedEvents = async function() {
    const selected = this._selectedEventRecords();
    const plan = this._deletePlanForSelectedEvents(selected);
    const targetCount = plan.eventIds.length + plan.shiftIds.length;
    if (!targetCount) {
      this._showStatus('削除できるイベントがありません', true);
      return;
    }
    const skippedText = plan.blocked ? `\n${plan.blocked}件は元データ管理または繰り返し予定のため削除しません。` : '';
    if (typeof cfConfirm === 'function' && !await cfConfirm(`${targetCount} 件を削除しますか？${skippedText}`)) return;
    const beforeEvents = (this._events || []).map(event => ({ ...event }));
    const beforeShifts = (this._shifts || []).map(shift => ({ ...shift }));
    const beforeSelected = [...this._eventSelection()];
    const beforeLast = this._lastSelectedEventId || '';
    const deletedEventMeta = new Map(plan.eventIds.map(id => [id, beforeEvents.find(event => event.id === id) || null]));
    const eventIdSet = new Set(plan.eventIds);
    this._pushUndo('イベント一括削除');
    this._events = (this._events || []).filter(event => !eventIdSet.has(event.id));
    plan.shiftIds.forEach(shiftId => {
      if (typeof this._removeShiftOptimistic === 'function') this._removeShiftOptimistic(shiftId);
      else this._events = (this._events || []).filter(event => {
        const raw = String(event?.id || '').startsWith('shift:') ? String(event.id).slice('shift:'.length) : String(event?.external_id || event?.id || '');
        return raw.split(':break:')[0] !== shiftId;
      });
    });
    this._clearEventSelection();
    this._renderCalendarList?.();
    this._render();
    try {
      await Promise.all([
        ...plan.eventIds.map(id => apiFetch('/cal/events/' + encodeURIComponent(id), { method: 'DELETE' })),
        ...plan.shiftIds.map(shiftId => apiFetch('/cal/shifts/' + encodeURIComponent(shiftId), { method: 'DELETE' })),
      ]);
      plan.eventIds.forEach(id => {
        apiPost('/annotations/orphan-by-target', {
          target_kind: 'calendar_event',
          target_file: deletedEventMeta.get(id)?.calendar_id || '_calendar',
          item_id: id,
          cascade_container: true,
        }).catch(() => {});
      });
      if (plan.shiftIds.length && typeof this._refreshShiftStateAfterMutation === 'function') {
        this._refreshShiftStateAfterMutation();
      } else {
        this._loadEvents?.().then(() => this._render()).catch(() => {});
      }
      const suffix = plan.blocked ? `（${plan.blocked}件は対象外）` : '';
      this._showStatus(`${targetCount} 件を削除しました${suffix}`);
    } catch (error) {
      this._events = beforeEvents;
      this._shifts = beforeShifts;
      this._setSelectedEvents(beforeSelected, beforeLast);
      this._renderCalendarList?.();
      this._render();
      this._showStatus(error?.message || '削除に失敗しました', true);
      // 並列削除の部分成功でサーバーと表示が乖離しないよう再同期する
      if (plan.shiftIds.length && typeof this._refreshShiftStateAfterMutation === 'function') {
        this._refreshShiftStateAfterMutation();
      } else {
        this._loadEvents?.().then(() => this._render()).catch(() => {});
      }
    }
  };

  CalendarComponent.prototype._eventBulkButton = function(label, icon, handler, options = {}) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'gb-cal-event-bulk-button gb-selection-float-button' + (options.danger ? ' danger' : '') + (options.primary ? ' primary' : '');
    button.disabled = !!options.disabled;
    button.title = options.title || label;
    button.innerHTML = `${_calIcon(icon, 13)}<span>${_calEsc(label)}</span>`;
    button.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      if (button.disabled) return;
      window.GBSelectionFloatMenu?.pulseButton?.(button);
      const result = handler();
      if (result && typeof result.catch === 'function') result.catch(error => this._showStatus(error?.message || String(error), true));
    });
    return button;
  };

  CalendarComponent.prototype._eventBulkBarId = function() {
    if (!this._calendarBulkBarId) {
      this._calendarBulkBarId = 'cal-event-bulk-' + Math.random().toString(36).slice(2);
    }
    return this._calendarBulkBarId;
  };

  CalendarComponent.prototype._eventBulkAnchorRect = function(selected) {
    const visibleCards = [];
    (selected || []).forEach(ev => {
      const id = String(ev?.id || '');
      if (!id) return;
      this._contentEl?.querySelectorAll?.(`[data-event-id="${_calCssEscape(id)}"]`).forEach(card => visibleCards.push(card));
    });
    const anchor = visibleCards[visibleCards.length - 1]
      || this.el?.querySelector?.(':scope > .gb-toolbar-cal')
      || this.el;
    return anchor?.getBoundingClientRect?.() || { left: 16, right: 16, top: 48, bottom: 48 };
  };

  CalendarComponent.prototype._positionEventSelectionBar = function(selected) {
    selected = selected || this._selectedEventRecords();
    const bar = document.querySelector(`.gb-cal-event-bulk-bar[data-calendar-bulk-id="${this._eventBulkBarId()}"]`);
    if (!bar || !this.el) return;
    bar.style.maxHeight = '';
    bar.style.overflowY = '';
    if (window.GBSelectionFloatMenu) {
      window.GBSelectionFloatMenu.bindDrag(bar, { host: this.el });
      window.GBSelectionFloatMenu.resetPosition(bar, { host: this.el, anchor: this._contentEl, zIndex: '10002' });
    } else {
      bar.style.bottom = '';
      bar.style.maxWidth = Math.max(260, Math.min(this.el.getBoundingClientRect().width - 24, window.innerWidth - 16)) + 'px';
      if (typeof positionPopup === 'function') {
        positionPopup(bar, this._eventBulkAnchorRect(selected), { prefer: 'below', gap: 6 });
      } else if (typeof clampPopupToViewport === 'function') {
        const rect = this._eventBulkAnchorRect(selected);
        const zoom = (typeof _getZoom === 'function' ? _getZoom() : 1) || 1;
        bar.style.left = (rect.left / zoom) + 'px';
        bar.style.top = (rect.bottom / zoom + 6) + 'px';
        clampPopupToViewport(bar);
      }
    }
  };

  CalendarComponent.prototype._setEventBulkBarTracking = function(enabled) {
    if (enabled && !this._calendarBulkBarTracking) {
      this._calendarBulkBarTracking = true;
      this._calendarBulkBarPositionHandler = () => this._positionEventSelectionBar();
      window.addEventListener('resize', this._calendarBulkBarPositionHandler);
      document.addEventListener('scroll', this._calendarBulkBarPositionHandler, true);
    } else if (!enabled && this._calendarBulkBarTracking) {
      this._calendarBulkBarTracking = false;
      window.removeEventListener('resize', this._calendarBulkBarPositionHandler);
      document.removeEventListener('scroll', this._calendarBulkBarPositionHandler, true);
      this._calendarBulkBarPositionHandler = null;
    }
  };

  CalendarComponent.prototype._removeEventSelectionBar = function() {
    document.querySelector(`.gb-cal-event-bulk-bar[data-calendar-bulk-id="${this._eventBulkBarId()}"]`)?.remove();
    this._setEventBulkBarTracking(false);
  };

  CalendarComponent.prototype._syncEventSelectionBar = function(records) {
    if (!this.el || !document.body) return;
    const selected = records || this._selectedEventRecords();
    let bar = document.querySelector(`.gb-cal-event-bulk-bar[data-calendar-bulk-id="${this._eventBulkBarId()}"]`);
    if (selected.length <= 1) {
      if (bar) bar.remove();
      this._setEventBulkBarTracking(false);
      return;
    }
    if (!bar) {
      bar = document.createElement('div');
      bar.className = 'gb-cal-event-bulk-bar gb-selection-float-bar';
      bar.dataset.calendarBulkId = this._eventBulkBarId();
      bar.dataset.e2eId = 'cal-event-bulk-bar';
      this.el.appendChild(bar);
    }
    if (window.GBSelectionFloatMenu) {
      window.GBSelectionFloatMenu.bindDrag(bar, { host: this.el });
    }
    const canDuplicate = selected.some(ev => this._eventCanBulkDuplicate(ev));
    const canDelete = selected.some(ev => this._eventCanBulkDelete(ev));
    const count = document.createElement('span');
    count.className = 'gb-cal-event-bulk-count gb-selection-float-count';
    count.textContent = `${selected.length} 件選択中`;
    const children = [
      count,
      this._eventBulkButton('複製', 'copy', () => this._duplicateSelectedEvents(), { disabled: !canDuplicate, title: '選択中のイベントを複製' }),
      this._eventBulkButton('削除', 'trash2', () => this._deleteSelectedEvents(), { danger: true, disabled: !canDelete, title: '選択中のイベントを削除' }),
      this._eventBulkButton('選択解除', 'x', () => this._clearEventSelection(), { title: '選択を解除' }),
    ];
    if (window.GBSelectionFloatMenu) children.unshift(window.GBSelectionFloatMenu.createDragHandle());
    bar.hidden = false;
    bar.replaceChildren(...children);
    this._positionEventSelectionBar(selected);
    this._setEventBulkBarTracking(true);
  };

  CalendarComponent.prototype._bindCalendarBulkKeyboard = function() {
    if (this._calendarBulkKeyHandler) return;
    this._calendarBulkKeyHandler = (event) => {
      if (event.defaultPrevented || _calKeyboardFromEditableTarget(event)) return;
      const target = event.target instanceof Element ? event.target : null;
      const active = document.activeElement instanceof Element ? document.activeElement : null;
      const relevant = !!(
        this.el?.contains(target) ||
        this.el?.contains(active) ||
        this.el?.matches?.(':hover')
      );
      if (!relevant || !this._selectedEventRecords().length) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        this._clearEventSelection();
      } else if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        this._deleteSelectedEvents();
      } else if ((event.ctrlKey || event.metaKey) && String(event.key || '').toLowerCase() === 'd') {
        event.preventDefault();
        this._duplicateSelectedEvents();
      }
    };
    document.addEventListener('keydown', this._calendarBulkKeyHandler, true);
  };

  CalendarComponent.prototype._bindCalendarSelection = function() {
    if (!this._contentEl || this._calendarSelectionBound) return;
    this._calendarSelectionBound = true;
    this._contentEl.addEventListener('click', (event) => {
      if (event.target.closest?.('[data-cal-event-more]')) return;
      const check = event.target.closest?.('.gb-cal-event-select-check');
      if (check) {
        // checkbox自身の既定切替を残し、直後のchangeだけを選択状態の正本にする。
        // click時にpreventDefaultしてJSでも反転すると、ブラウザが既定処理を巻き戻す際に
        // checkedだけが元へ戻り、Set・複製カード・bulk barと不整合になる。
        event.stopImmediatePropagation();
        return;
      }
      const card = event.target.closest?.('[data-event-id]');
      if (!card) return;
      const id = card.dataset.eventId || '';
      if (!id) return;
      if (event.shiftKey) {
        event.preventDefault();
        event.stopImmediatePropagation();
        this._selectEventRange(id);
      } else if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        event.stopImmediatePropagation();
        this._toggleEventSelection(id);
      } else {
        this._setSelectedEvents([id], id);
      }
    }, true);
    this._contentEl.addEventListener('change', (event) => {
      const check = event.target.closest?.('.gb-cal-event-select-check');
      if (!check) return;
      const card = check.closest('[data-event-id]');
      if (!card) return;
      event.stopImmediatePropagation();
      this._setEventSelectionState(card.dataset.eventId || '', !!check.checked);
    }, true);
  };

  const _origCreate = CalendarComponent.prototype.create;
  CalendarComponent.prototype.create = function() {
    const el = _origCreate.call(this);
    this._bindCalendarSelection();
    this._bindCalendarBulkKeyboard();
    this._bindResponsiveSidebarMode();
    if (typeof applyCalendarPanelStyle === 'function') applyCalendarPanelStyle();
    this._applySidebarMode();
    return el;
  };

  const _origDestroy = CalendarComponent.prototype.destroy;
  CalendarComponent.prototype.destroy = function() {
    if (this._calResponsiveObserver) this._calResponsiveObserver.disconnect();
    this._calResponsiveObserver = null;
    if (this._calResponsiveResizeHandler) window.removeEventListener('resize', this._calResponsiveResizeHandler);
    this._calResponsiveResizeHandler = null;
    if (this._calendarBulkKeyHandler) document.removeEventListener('keydown', this._calendarBulkKeyHandler, true);
    this._calendarBulkKeyHandler = null;
    this._removeEventSelectionBar?.();
    _origDestroy.call(this);
  };

  // v0.6.199: アクティブ履歴スコープを、現在表示中の面に応じて切り替える。
  // - 制作管理タスクリスト面（埋め込みシート）表示中: 埋め込みシートの 'db:<パス>' スコープ
  //   （_meldexProductionEmbedHistoryScope() と同じ解決規則。フェーズ4から流用）
  // - それ以外（カレンダー面・ToDo/シフト/時計等）: このタブ自身の 'schedule:<tabId>' スコープ
  //   （系統(A)の予定/ToDo編集用。gb-tool-calendar.js 参照）
  // - 埋め込みシート未マウント等でどちらも解決できない場合: 従来どおり 'calendar:settings'
  //   （サイドバー表示・週開始曜日等のスケジュール設定用スコープ。この関数が置き換える前の
  //   activate() が無条件に設定していたのと同じフォールバック値）

  CalendarComponent.prototype._closeEventCardMenu = function() {
    document.querySelectorAll('.gb-cal-event-card-menu').forEach(menu => menu.remove());
  };

  CalendarComponent.prototype._showEventCardMenu = function(anchor, eventId) {
    if (!anchor || !eventId) return;
    const ev = (this._events || []).find(item => item?.id === eventId);
    if (!ev) return;
    this._closeEventCardMenu();
    const menu = document.createElement('div');
    menu.className = 'gb-context-menu gb-cal-event-card-menu';
    menu.dataset.e2eId = 'calendar-event-card-menu';
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', 'イベントメニュー');
    menu.style.position = 'fixed';
    menu.style.zIndex = '10003';
    let closePointer = null;
    let closeKey = null;
    const closeMenu = (restoreFocus = false) => {
      menu.remove();
      if (closePointer) document.removeEventListener('pointerdown', closePointer, true);
      if (closeKey) document.removeEventListener('keydown', closeKey, true);
      closePointer = null;
      closeKey = null;
      if (restoreFocus && anchor.isConnected) {
        try { anchor.focus({ preventScroll: true }); } catch { anchor.focus?.(); }
      }
    };
    const addItem = (label, icon, handler, options = {}) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'gb-context-menu-item' + (options.danger ? ' danger' : '') + (options.disabled ? ' disabled' : '');
      item.dataset.calEventCardAction = options.action || label;
      item.setAttribute('role', 'menuitem');
      item.disabled = !!options.disabled;
      item.innerHTML = `${_calIcon(icon, 14)}<span>${_calEsc(label)}</span>`;
      item.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        if (item.disabled) return;
        closeMenu(false);
        handler();
      });
      menu.appendChild(item);
    };
    const addSeparator = () => {
      const sep = document.createElement('div');
      sep.className = 'gb-context-menu-separator';
      sep.style.cssText = 'height:1px;background:var(--border);margin:4px 2px;';
      menu.appendChild(sep);
    };
    const selected = this._selectedEventRecords();
    const selectionIds = new Set(selected.map(item => String(item?.id || '')));
    if (selected.length > 1 && selectionIds.has(String(eventId))) {
      addItem(`${selected.length}件を複製`, 'copy', () => this._duplicateSelectedEvents(), {
        action: 'duplicate-selection',
        disabled: !selected.some(item => this._eventCanBulkDuplicate(item)),
      });
      addItem(`${selected.length}件を削除`, 'trash2', () => this._deleteSelectedEvents(), {
        action: 'delete-selection',
        danger: true,
        disabled: !selected.some(item => this._eventCanBulkDelete(item)),
      });
      addItem('選択解除', 'x', () => this._clearEventSelection(), { action: 'clear-selection' });
      addSeparator();
    }
    addItem('開く', 'fileText', () => this._openEventInPanel(eventId), { action: 'open' });
    const source = String(ev.calendar_source || '');
    const lockedGenerated = ['production-task', 'attendance'].includes(source);
    addItem(lockedGenerated ? '元データから編集' : '削除', lockedGenerated ? 'lock' : 'trash2', () => this._deleteEventFromOptions(eventId), {
      action: lockedGenerated ? 'locked-source' : 'delete',
      danger: !lockedGenerated,
      disabled: lockedGenerated,
    });
    document.body.appendChild(menu);
    if (typeof positionPopup === 'function') {
      positionPopup(menu, anchor.getBoundingClientRect());
    } else {
      const rect = anchor.getBoundingClientRect();
      const z = typeof _getZoom === 'function' ? _getZoom() : 1;
      menu.style.left = (rect.right / z + 4) + 'px';
      menu.style.top = (rect.top / z) + 'px';
      if (typeof clampPopupToViewport === 'function') clampPopupToViewport(menu);
    }
    setTimeout(() => {
      closePointer = (event) => {
        if (!menu.contains(event.target) && event.target !== anchor) {
          closeMenu(false);
        }
      };
      closeKey = (event) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        event.stopPropagation();
        closeMenu(true);
      };
      document.addEventListener('pointerdown', closePointer, true);
      document.addEventListener('keydown', closeKey, true);
    }, 0);
  };

  const _origRender = CalendarComponent.prototype._render;
  CalendarComponent.prototype._render = function() {
    _origRender.call(this);
    this._syncEventSelectionDom();
    this._syncCalendarToolbarState();
  };

})();
