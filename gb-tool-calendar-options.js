/* ==============================
   gb-tool-calendar-options.js: Calendar panel option UI and selection helpers
   ============================== */

(() => {
  if (typeof CalendarComponent === 'undefined') return;

  const EVENT_EDGE_MINUTES = 15;
  const DEFAULT_EVENT_COLOR = '#569cd6';
  const CALENDAR_SETTINGS_SCOPE = 'calendar:settings';
  const CALENDAR_DETAIL_TABS = new Set(['calendar-today', 'calendar-settings', 'calendar-production']);

  function _calEsc(v) {
    return typeof esc === 'function' ? esc(v) : String(v ?? '').replace(/[&<>"']/g, ch => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[ch]);
  }

  function _calIcon(name, size = 14) {
    return typeof lucide === 'function' ? lucide(name, size) : '';
  }

  function _calCssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(value);
    return String(value || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }

  function _calKeyboardFromEditableTarget(event) {
    const target = event?.target instanceof Element ? event.target : null;
    const active = document.activeElement instanceof Element ? document.activeElement : null;
    return !!(
      target?.closest?.('input, textarea, select, [contenteditable="true"], [role="textbox"]') ||
      active?.closest?.('input, textarea, select, [contenteditable="true"], [role="textbox"]')
    );
  }

  function _calLocalInputValue(component, value, fallbackDate) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return String(value) + 'T00:00';
    if (value) return String(value).substring(0, 16);
    const d = fallbackDate || new Date();
    return component._localDateTimeStr(d).substring(0, 16);
  }

  function _calLocalDateInputValue(component, value, fallbackDate) {
    const raw = String(value || '');
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
    if (raw) return raw.substring(0, 10);
    const d = fallbackDate || new Date();
    return component._localDateStr(d);
  }

  function _calSetEventDateInputMode(component, startInput, endInput, allDay) {
    if (!startInput || !endInput) return;
    const startRaw = startInput.value || startInput.dataset.calRawValue || '';
    const endRaw = endInput.value || endInput.dataset.calRawValue || startRaw;
    if (allDay) {
      startInput.type = 'date';
      endInput.type = 'date';
      startInput.value = _calLocalDateInputValue(component, startRaw);
      endInput.value = _calLocalDateInputValue(component, endRaw || startRaw);
    } else {
      startInput.type = 'datetime-local';
      endInput.type = 'datetime-local';
      startInput.value = _calLocalInputValue(component, startRaw);
      endInput.value = _calLocalInputValue(component, endRaw || startRaw);
    }
    startInput.dataset.calRawValue = startInput.value;
    endInput.dataset.calRawValue = endInput.value;
  }

  function _calFindCalendarComponent() {
    if (typeof GBTabs !== 'undefined' && typeof getComponentInstance === 'function') {
      const paneId = typeof GBLayout !== 'undefined' ? GBLayout.activePane : null;
      const activeTab = typeof GBTabs.getActiveTab === 'function' ? GBTabs.getActiveTab(paneId) : null;
      if (activeTab?.type === 'calendar') {
        const active = getComponentInstance(activeTab.id);
        if (active instanceof CalendarComponent) return active;
      }
    }
    let fallback = null;
    if (typeof forEachComponent === 'function') {
      forEachComponent((instance) => {
        if (!fallback && instance instanceof CalendarComponent) fallback = instance;
      });
    }
    return fallback;
  }

  function _calDetailTabId(tabId) {
    return CALENDAR_DETAIL_TABS.has(tabId) ? tabId : 'calendar-today';
  }

  function _calPrepareCalendarDetailShell(detailEl) {
    if (!detailEl) return;
    if (typeof showNoteTabs === 'function') showNoteTabs(false);
    if (typeof showDbTabs === 'function') showDbTabs(false);
    if (typeof showBoardTabs === 'function') showBoardTabs(false);
    if (typeof hideBoardNoteTab === 'function') hideBoardNoteTab();
    if (typeof hideScriptnoteDetailTabs === 'function') hideScriptnoteDetailTabs();
    if (typeof showCalendarDetailTabs === 'function') showCalendarDetailTabs(true);
    if (typeof showFileStyleTab === 'function') showFileStyleTab(true);
    if (typeof renderFileStyleTab === 'function') renderFileStyleTab('calendar');
    if (typeof showPublishDetailTab === 'function') showPublishDetailTab(true);
    document.querySelectorAll('.detail-tab-calendar[data-detail-tab="calendar-today"]').forEach(t => { t.textContent = 'カレンダー'; });
  }

  function _calSelectDetailTab(tabId) {
    if (typeof switchDetailTab !== 'function') return;
    try { window.__MeldexSuppressCalendarTabAutoRender = true; } catch {}
    try { switchDetailTab(_calDetailTabId(tabId)); }
    finally {
      try { window.__MeldexSuppressCalendarTabAutoRender = false; } catch {}
    }
  }

  function _calBuildOptionBody(tabBody, title) {
    tabBody.innerHTML = '';
    const header = document.createElement('div');
    header.className = 'cal-option-header';
    header.textContent = title;
    tabBody.appendChild(header);
    const body = document.createElement('div');
    body.className = 'cal-option-body';
    tabBody.appendChild(body);
    return body;
  }

  function _calOpenDetailPanel() {
    if (typeof _openDetailRightPanel === 'function') {
      return _openDetailRightPanel();
    }
    if (typeof openRightPanelTab === 'function') {
      openRightPanelTab('detail');
      return true;
    }
    if (typeof switchRightTab === 'function') {
      switchRightTab('detail');
      return true;
    }
    return false;
  }

  function _calOptionContainer(title, options = {}) {
    if (options.openPanel !== false) _calOpenDetailPanel();
    const detailEl = typeof _resolveDetailEl === 'function' ? _resolveDetailEl() : document.getElementById('rp-detail');
    if (!detailEl) return null;
    detailEl.style.display = '';
    if (typeof _ensureDetailTabShell === 'function') _ensureDetailTabShell(detailEl);

    const tabId = _calDetailTabId(options.tabId);
    const tabBody = detailEl.querySelector?.('#detail-tab-' + tabId) || null;
    if (tabBody) {
      _calPrepareCalendarDetailShell(detailEl);
      if (options.select !== false) _calSelectDetailTab(tabId);
      return _calBuildOptionBody(tabBody, title);
    }

    detailEl.innerHTML = '';
    if (typeof _buildDpHeader === 'function') {
      const cfg = typeof _getDetailPanelCfg === 'function' ? _getDetailPanelCfg() : {};
      detailEl.appendChild(_buildDpHeader(title, cfg.position || 'right'));
    } else {
      const header = document.createElement('div');
      header.className = 'cal-option-header';
      header.textContent = title;
      detailEl.appendChild(header);
    }
    const body = document.createElement('div');
    body.className = 'cal-option-body';
    detailEl.appendChild(body);
    return body;
  }

  function _calField(label, html) {
    return `<div class="cal-option-field"><label>${label}</label>${html}</div>`;
  }

  window.MeldexCalendarOptionPanel = Object.freeze({
    container: _calOptionContainer,
    field: _calField,
    icon: _calIcon,
    findCalendarComponent: _calFindCalendarComponent,
    syncDetailTabs: _calPrepareCalendarDetailShell,
  });

  function _calBindSwatch(swatch, color) {
    if (!swatch) return;
    const fallback = color || DEFAULT_EVENT_COLOR;
    if (typeof setColorSwatchValue === 'function') setColorSwatchValue(swatch, fallback);
    else swatch.dataset.color = fallback;
    if (typeof bindColorSwatch === 'function') {
      bindColorSwatch(swatch, () => _calGetSwatchValue(swatch, fallback), (nextColor) => {
        if (typeof setColorSwatchValue === 'function') setColorSwatchValue(swatch, nextColor || fallback);
        else swatch.dataset.color = nextColor || fallback;
      });
    }
  }

  function _calGetSwatchValue(swatch, fallback) {
    if (typeof getColorSwatchValue === 'function') return getColorSwatchValue(swatch, fallback);
    return swatch?.dataset?.color || fallback || '';
  }

  function _calSettingsHistoryKeys(keys) {
    const list = Array.isArray(keys) ? keys : [keys];
    return [...new Set(list.filter(Boolean))];
  }

  function _calCaptureSettingsHistory(keys) {
    if (typeof captureLocalStorageSettings !== 'function') return null;
    if (typeof isLocalStorageSettingsHistorySuppressed === 'function'
      && isLocalStorageSettingsHistorySuppressed()) return null;
    return captureLocalStorageSettings(_calSettingsHistoryKeys(keys));
  }

  function _calRefreshSettingsAfterHistory(keys) {
    const changed = new Set(_calSettingsHistoryKeys(keys));
    if (typeof forEachComponent !== 'function') return;
    forEachComponent(component => {
      if (!component || !(component instanceof CalendarComponent)) return;
      if (changed.has('gb-cal-start-day')) {
        component._startDay = parseInt(localStorage.getItem('gb-cal-start-day') || '0', 10) || 0;
      }
      if (changed.has('gb:cal-sidebar-mode') || changed.has('gb:cal-sidebar-only')) {
        component._sidebarMode = localStorage.getItem('gb:cal-sidebar-mode') || (localStorage.getItem('gb:cal-sidebar-only') === 'true' ? 'only' : 'all');
        component._sidebarOnly = component._sidebarMode === 'only';
      }
      if (changed.has('gb:cal-attendance-hidden-source-folders')) {
        component._renderAttendanceSourceSettings?.(component._calendarSettingsBody);
        component._renderAttendanceStatus?.();
      }
      component._applySidebarMode?.();
      component._renderMiniCal?.();
      component._render?.();
    });
  }

  function _calPushSettingsHistory(label, beforeSnapshot, keys, detail) {
    if (!beforeSnapshot || typeof historyPush !== 'function'
      || typeof captureLocalStorageSettings !== 'function'
      || typeof restoreLocalStorageSettings !== 'function'
      || typeof _normalizeLocalStorageSettingsSnapshots !== 'function') return false;
    const keyList = _calSettingsHistoryKeys(keys);
    const snapshots = _normalizeLocalStorageSettingsSnapshots(beforeSnapshot, captureLocalStorageSettings(keyList));
    let beforeKey = '';
    let afterKey = '';
    try {
      beforeKey = JSON.stringify(snapshots.before);
      afterKey = JSON.stringify(snapshots.after);
    } catch {}
    if (beforeKey && beforeKey === afterKey) return false;
    historyPush(
      label || 'スケジュール: 設定変更',
      () => restoreLocalStorageSettings(snapshots.before, _calRefreshSettingsAfterHistory),
      () => restoreLocalStorageSettings(snapshots.after, _calRefreshSettingsAfterHistory),
      CALENDAR_SETTINGS_SCOPE,
      detail || keyList.join(', ')
    );
    return true;
  }

  function _calUserListFromValue(value) {
    let raw = value;
    if (!raw) return [];
    if (typeof raw === 'string') {
      try { raw = JSON.parse(raw); } catch { raw = raw.split(','); }
    }
    if (!Array.isArray(raw)) raw = [raw];
    const seen = new Set();
    return raw.map(item => String(item || '').trim()).filter(name => {
      if (!name || seen.has(name)) return false;
      seen.add(name);
      return true;
    });
  }

  function _calEventCreator(ev, fallback) {
    return String(ev?.creator || ev?.user || fallback || '').trim();
  }

  function _calEventUserNames(ev, fallback) {
    const seen = new Set();
    return [_calEventCreator(ev, fallback), ..._calUserListFromValue(ev?.members)].filter(name => {
      if (!name || seen.has(name)) return false;
      seen.add(name);
      return true;
    });
  }

  function _calAvatarHtml(name, size) {
    const safeName = _calEsc(name);
    const src = window.MeldexDataAccess?.team?.avatarUrl?.(name || 'anonymous', {}) || ('/api/team/avatar/' + encodeURIComponent(name) + '?t=0');
    const style = `width:${size}px;height:${size}px;`;
    const fallback = _calEsc((name || '?').charAt(0).toUpperCase() || '?');
    return `<span class="gb-cal-event-avatar" style="${style}" title="${safeName}"><img src="${src}" alt="" onerror="this.style.display='none';this.nextElementSibling.style.display='inline-flex';"><span>${fallback}</span></span>`;
  }

  CalendarComponent.prototype._eventUserNames = function(ev) {
    return _calEventUserNames(ev, this._getUser());
  };

  CalendarComponent.prototype._eventUserAvatarsHtml = function(ev, size = 14) {
    const names = this._eventUserNames(ev).slice(0, 4);
    if (!names.length) return '';
    return `<span class="gb-cal-event-avatars">${names.map(name => _calAvatarHtml(name, size)).join('')}</span>`;
  };

  // 候補ユーザー一覧はMeldexUserPickerに統一（正本「スタッフ管理シート」+
  // ワークスペースメンバーのマージ。ユーザーアカウント一元管理 計画書 Phase 3、
  // §5.8-3）。_loadTeamGroups() はワークスペース別グルーピング表示用の別機能
  // として維持し、それが使えない場合のフォールバックだけを差し替える。
  CalendarComponent.prototype._loadCalendarUserChoices = async function() {
    const current = this._getUser();
    const users = new Map();
    const add = name => { name = String(name || '').trim(); if (name && !users.has(name)) users.set(name, { name }); };
    add(current);
    if (typeof this._loadTeamGroups === 'function') {
      try {
        const groups = await this._loadTeamGroups();
        groups.forEach(group => (group.members || []).forEach(member => add(member.name)));
        return [...users.values()];
      } catch {}
    }
    if (window.MeldexUserPicker) {
      try {
        const candidates = await window.MeldexUserPicker.getCandidates();
        if (candidates.length) return candidates;
      } catch {}
    }
    return [...users.values()];
  };

  CalendarComponent.prototype._populateEventUserControls = async function(body, ev) {
    const creatorSelect = body.querySelector('[data-cal-event-creator]');
    const membersBox = body.querySelector('[data-cal-event-members]');
    if (!creatorSelect && !membersBox) return;
    const creator = _calEventCreator(ev, this._getUser());
    const selectedMembers = new Set(_calUserListFromValue(ev?.members));
    const users = await this._loadCalendarUserChoices();
    [creator, ...selectedMembers].forEach(name => {
      if (name && !users.some(user => user.name === name)) users.push({ name });
    });
    if (!body.isConnected) return;
    if (creatorSelect) {
      creatorSelect.innerHTML = users.map(user => `<option value="${_calEsc(user.name)}" ${user.name === creator ? 'selected' : ''}>${_calEsc(user.name)}</option>`).join('');
    }
    if (membersBox) {
      membersBox.innerHTML = users.map(user => `<label class="cal-option-member"><input type="checkbox" data-cal-event-member="${_calEsc(user.name)}" data-e2e-id="cal-event-member-${_calEsc(user.name)}" value="${_calEsc(user.name)}" aria-label="${_calEsc(user.name)}" ${selectedMembers.has(user.name) ? 'checked' : ''}> <span>${_calEsc(user.name)}</span></label>`).join('');
    }
  };

  CalendarComponent.prototype._collectEventMemberValues = function(body, creator) {
    const seen = new Set();
    const inputs = [...body.querySelectorAll('[data-cal-event-member]')];
    const source = inputs.length ? inputs.filter(input => input.checked).map(input => input.value) : _calUserListFromValue(body.dataset.calEventMembers || '[]');
    return source.map(input => String(input || '').trim()).filter(name => {
      if (!name || name === creator || seen.has(name)) return false;
      seen.add(name);
      return true;
    });
  };

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
    const sel = this._eventSelection();
    if (sel.has(id)) sel.delete(id);
    else sel.add(id);
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
      check.checked = selectedIds.has(id);
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
        const card = check.closest('[data-event-id]');
        if (!card) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        this._toggleEventSelection(card.dataset.eventId || '');
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
  CalendarComponent.prototype._syncHistoryScope = function() {
    if (typeof historySetScope !== 'function') return;
    const embedScope = typeof _meldexProductionEmbedHistoryScope === 'function' ? _meldexProductionEmbedHistoryScope() : '';
    if (embedScope) { historySetScope(embedScope); return; }
    if (this._surface !== 'productionTasks' && typeof _schedHistoryScope === 'function') {
      historySetScope(_schedHistoryScope(this));
      return;
    }
    historySetScope(CALENDAR_SETTINGS_SCOPE);
  };

  const _origActivate = CalendarComponent.prototype.activate;
  CalendarComponent.prototype.activate = function() {
    _origActivate.call(this);
    this._syncHistoryScope();
  };

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

  CalendarComponent.prototype._syncCalendarToolbarState = function() {
    const sideBtn = this.el?.querySelector?.('[data-cal-action="toggleSidebar"]');
    if (sideBtn) {
      const mode = this._effectiveSidebarOnly() ? 'only' : (this._sidebarEl?.classList.contains('gb-cal-hidden') ? 'hidden' : 'all');
      sideBtn.classList.toggle('active', mode !== 'all');
      sideBtn.dataset.calSidebarMode = mode;
      sideBtn.title = mode === 'all'
        ? 'サイドバーを隠す'
        : mode === 'hidden'
          ? 'サイドバーのみ'
          : 'すべて表示';
      sideBtn.setAttribute('aria-label', sideBtn.title);
    }
    const viewSel = this.el?.querySelector?.('.gb-cal-view-select');
    if (viewSel && viewSel.value !== this._view) viewSel.value = this._view;
    this._syncEventSelectionBar?.();
  };

  CalendarComponent.prototype._effectiveSidebarOnly = function() {
    return !!(this._sidebarMode === 'only' || this._sidebarOnly || this._autoSidebarOnly);
  };

  CalendarComponent.prototype._bindResponsiveSidebarMode = function() {
    if (!this.el || this._calResponsiveObserver || this._calResponsiveResizeHandler) return;
    const update = () => this._applyResponsiveSidebarMode();
    if (window.ResizeObserver) {
      this._calResponsiveObserver = new ResizeObserver(update);
      this._calResponsiveObserver.observe(this.el);
    } else {
      this._calResponsiveResizeHandler = update;
      window.addEventListener('resize', update);
    }
    update();
  };

  CalendarComponent.prototype._applyResponsiveSidebarMode = function() {
    if (!this.el) return;
    const width = this.el.getBoundingClientRect?.().width || this.el.offsetWidth || 0;
    this._autoSidebarOnly = width > 0 && width < 520;
    if (this._autoSidebarOnly) this._sidebarEl?.classList.remove('gb-cal-hidden');
    this._applySidebarMode();
  };

  CalendarComponent.prototype._applySidebarMode = function() {
    if (!this.el) return;
    const mode = this._sidebarMode || (this._sidebarOnly ? 'only' : 'all');
    const effective = this._effectiveSidebarOnly();
    if (!effective) this._sidebarEl?.classList.toggle('gb-cal-hidden', mode === 'hidden');
    else this._sidebarEl?.classList.remove('gb-cal-hidden');
    this.el.classList.toggle('gb-cal-sidebar-only', effective);
    this.el.classList.toggle('gb-cal-sidebar-auto', !!this._autoSidebarOnly);
    const resize = this.el.querySelector('.gb-cal-sidebar-resize');
    if (resize) resize.style.display = (effective || this._sidebarEl?.classList.contains('gb-cal-hidden')) ? 'none' : '';
    this._syncCalendarToolbarState();
  };

  CalendarComponent.prototype._setSidebarMode = function(mode) {
    const normalized = ['all', 'hidden', 'only'].includes(mode) ? mode : 'all';
    const before = _calCaptureSettingsHistory(['gb:cal-sidebar-mode', 'gb:cal-sidebar-only']);
    this._sidebarMode = normalized;
    this._sidebarOnly = normalized === 'only';
    localStorage.setItem('gb:cal-sidebar-mode', normalized);
    localStorage.setItem('gb:cal-sidebar-only', this._sidebarOnly ? 'true' : 'false');
    const detail = normalized === 'hidden' ? 'サイドバーを隠す' : normalized === 'only' ? 'サイドバーのみ' : 'すべて表示';
    _calPushSettingsHistory('スケジュール: サイドバー表示変更', before, ['gb:cal-sidebar-mode', 'gb:cal-sidebar-only'], detail);
    this._applySidebarMode();
  };

  CalendarComponent.prototype._setSidebarOnly = function(on) {
    this._setSidebarMode(on ? 'only' : 'all');
  };

  CalendarComponent.prototype._toggleSidebar = function() {
    const mode = this._effectiveSidebarOnly() ? 'only' : (this._sidebarEl?.classList.contains('gb-cal-hidden') ? 'hidden' : 'all');
    this._setSidebarMode(mode === 'all' ? 'hidden' : mode === 'hidden' ? 'only' : 'all');
  };

  CalendarComponent.prototype._renderCalendarSettingsPanel = function(body) {
    if (!body) return;
    this._calendarSettingsBody = body;
    const opts = [[0, '日曜始まり'], [1, '月曜始まり'], [2, '火曜始まり'], [3, '水曜始まり'], [4, '木曜始まり'], [5, '金曜始まり'], [6, '土曜始まり']]
      .map(([v, label]) => `<option value="${v}" ${v === this._startDay ? 'selected' : ''}>${label}</option>`).join('');
    body.innerHTML = `
      ${_calField('表示', `<label class="cal-option-check"><input type="checkbox" data-cal-settings-sidebar-only ${this._sidebarOnly ? 'checked' : ''}> サイドバーのみ表示</label>`)}
      ${_calField('週の開始曜日', `<select class="gb-select" data-cal-settings-start-day>${opts}</select>`)}
      <div class="cal-option-actions">
        <button type="button" data-cal-settings-action="template">${_calIcon('layoutTemplate')} テンプレート</button>
        <button type="button" data-cal-settings-action="sync">${_calIcon('refreshCw')} 同期</button>
        <button type="button" data-cal-settings-action="timer">${_calIcon('timer')} タイマー</button>
      </div>`;
    this._renderAttendanceSourceSettings?.(body);
    this._renderShiftTemplateSettings?.(body);
    body.querySelector('[data-cal-settings-sidebar-only]')?.addEventListener('change', e => this._setSidebarOnly(e.currentTarget.checked));
    body.querySelector('[data-cal-settings-start-day]')?.addEventListener('change', e => {
      const before = _calCaptureSettingsHistory(['gb-cal-start-day']);
      this._startDay = parseInt(e.currentTarget.value, 10);
      localStorage.setItem('gb-cal-start-day', this._startDay);
      _calPushSettingsHistory('スケジュール: 週の開始曜日変更', before, ['gb-cal-start-day'], String(this._startDay));
      this._render();
      this._renderMiniCal();
    });
    body.querySelectorAll('[data-cal-settings-action]').forEach(btn => {
      btn.addEventListener('click', () => {
        const action = btn.dataset.calSettingsAction;
        if (action === 'template') this._showScheduleTemplateModal();
        else if (action === 'sync') this._showSyncModal();
        else if (action === 'timer') {
          if (typeof openTimerPanel === 'function') openTimerPanel();
          else if (typeof showStatus === 'function') showStatus('タイマーパネルを初期化できませんでした', true);
        }
      });
    });
  };

  CalendarComponent.prototype._showCalendarSettingsPanel = function(options = {}) {
    const body = _calOptionContainer('スケジュール設定', {
      tabId: 'calendar-settings',
      select: options.select !== false,
    });
    if (!body) return;
    this._renderCalendarSettingsPanel(body);
  };

  window.openCalendarSettingsPanel = function() {
    const component = _calFindCalendarComponent();
    if (!component || typeof component._showCalendarSettingsPanel !== 'function') {
      if (typeof showStatus === 'function') showStatus('スケジュールを開いてから設定を開いてください', true);
      return;
    }
    component._showCalendarSettingsPanel();
  };

  document.addEventListener('meldex:detail-tab-switched', (event) => {
    if (event.detail?.tab !== 'calendar-settings') return;
    if (window.__MeldexSuppressCalendarTabAutoRender) return;
    const component = _calFindCalendarComponent();
    if (component && typeof component._showCalendarSettingsPanel === 'function') {
      component._showCalendarSettingsPanel({ select: false });
    }
  });

  CalendarComponent.prototype._createEventQuick = async function(defaultStart, defaultEnd, defaultAllDay) {
    const now = new Date();
    const fallbackStart = defaultStart ? new Date(defaultStart) : now;
    const fallbackEndBase = Number.isNaN(fallbackStart.getTime()) ? now : fallbackStart;
    const start = defaultStart || this._localDateTimeStr(now);
    const end = defaultEnd || this._localDateTimeStr(new Date(fallbackEndBase.getTime() + 3600000));
    const calendarId = this._calendarIdForNewEvent?.() || '';
    const cal = (this._calendars || []).find(c => c.id === calendarId) || this._selectedCalendar?.() || this._firstCalendar();
    const payload = {
      title: '無題',
      start,
      end,
      all_day: defaultAllDay ? 1 : 0,
      color: cal?.color || DEFAULT_EVENT_COLOR,
      calendar_id: cal?.id || '',
      alert_minutes: -1,
      user: this._getUser(),
      creator: this._getUser(),
      members: [],
    };
    const id = window.MeldexCalendarSaveQueue?.newEventId?.() || ('cal-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8));
    payload.id = id;
    const optimisticEvent = { id, ...payload, _optimistic: true, _saveState: 'saving' };
    this._pushUndo('イベント作成');
    this._events = [...(this._events || []), optimisticEvent];
    this._setSelectedEvents([id], id);
    this._render();
    // POSTがタイムアウトしても即座に楽観イベントを破棄しない。保存キュー側で
    // 確認・再試行まで行い、それでも失敗したら「未保存」として画面に保持する。
    const savedId = window.MeldexCalendarSaveQueue
      ? await window.MeldexCalendarSaveQueue.createWithConfirm(this, id, payload)
      : await this._createEventQuickFallback(id, payload);
    if (!savedId) return '';
    await this._loadEvents();
    this._render();
    const created = this._events.find(e => e.id === savedId) || { id: savedId, ...payload };
    this._setSelectedEvents([savedId], savedId);
    this._showEventOptionsPanel(created, defaultStart, defaultEnd, defaultAllDay);
    return savedId;
  };

  // MeldexCalendarSaveQueue が読み込まれていない場合の最小限フォールバック（旧挙動相当）。
  CalendarComponent.prototype._createEventQuickFallback = async function(id, payload) {
    try {
      await apiPost('/cal/events', payload);
      const created = (this._events || []).find(e => e.id === id);
      if (created) { delete created._optimistic; delete created._saveState; }
      this._showStatus('イベントを追加しました');
      return id;
    } catch {
      this._events = (this._events || []).filter(e => e.id !== id);
      this._render();
      this._showStatus('イベント追加に失敗', true);
      return '';
    }
  };

  CalendarComponent.prototype._openEventInPanel = function(editId, defaultStart, defaultEnd, defaultAllDay) {
    if (!editId) {
      this._createEventQuick(defaultStart, defaultEnd, defaultAllDay);
      return;
    }
    const ev = this._events.find(e => e.id === editId);
    if (!ev) return;
    if (typeof _calRecurringInteractionBlocked === 'function' && _calRecurringInteractionBlocked(this, ev)) return;
    if (ev.calendar_source === 'production-task' && typeof this._openProductionTaskEvent === 'function') {
      this._openProductionTaskEvent(ev);
      return;
    }
    if ((ev.calendar_source === 'shift' || ev.calendar_source === 'shift-break') && typeof this._showShiftModal === 'function') {
      const rawShiftId = String(editId || '').startsWith('shift:')
        ? String(editId).slice('shift:'.length)
        : String(ev.external_id || editId || '');
      this._showShiftModal(ev.user || this._getUser(), String(ev.start || '').slice(0, 10), rawShiftId.split(':break:')[0]);
      return;
    }
    if (ev.calendar_source === 'attendance') {
      // 実績イベントは編集パネルを開いても保存できないため、入力後に拒否せず先に案内する
      this._showStatus('自動生成された予定は元データ（出退勤の記録）から編集してください', true);
      return;
    }
    this._setSelectedEvents([editId], editId);
    this._showEventOptionsPanel(ev, defaultStart, defaultEnd, defaultAllDay);
  };

  CalendarComponent.prototype._showEventOptionsPanel = function(ev, defaultStart, defaultEnd, defaultAllDay) {
    const body = _calOptionContainer('イベント設定');
    if (!body) return;
    body._calComponent = this;
    const now = new Date();
    const startVal = _calLocalInputValue(this, ev?.start || defaultStart, now);
    const endVal = _calLocalInputValue(this, ev?.end || defaultEnd, new Date(now.getTime() + 3600000));
    const isAllDay = ev ? !!ev.all_day : !!defaultAllDay;
    // 他のメンバー所有のカレンダーに属するイベントは自分の一覧に該当カレンダーが無い。
    // 所属を黙って「未設定」に落とさないよう、元のIDを保持する選択肢を追加する
    const hasOwnCalendarOption = !ev?.calendar_id || (this._calendars || []).some(c => c.id === ev.calendar_id);
    const calOpts = `<option value="" ${!ev?.calendar_id ? 'selected' : ''}>未設定</option>`
      + (hasOwnCalendarOption ? '' : `<option value="${_calEsc(ev.calendar_id)}" selected>他のメンバーのカレンダー</option>`)
      + (this._calendars || []).map(c => `<option value="${_calEsc(c.id)}" ${ev?.calendar_id === c.id ? 'selected' : ''}>${_calEsc(c.name)}</option>`).join('');
    const creator = _calEventCreator(ev, this._getUser());
    body.dataset.calEventMembers = JSON.stringify(_calUserListFromValue(ev?.members));
    body.innerHTML = `
      ${_calField('タイトル', `<input data-e2e-id="calendar-event-title" data-cal-event-title type="text" aria-label="タイトル" value="${_calEsc(ev?.title || '')}" placeholder="イベント名">`)}
      ${_calField('', `<label class="cal-option-check"><input data-e2e-id="calendar-event-allday" data-cal-event-allday type="checkbox" aria-label="終日" ${isAllDay ? 'checked' : ''}> 終日</label>`)}
      ${_calField('開始', `<input data-e2e-id="calendar-event-start" data-cal-event-start type="${isAllDay ? 'date' : 'datetime-local'}" aria-label="開始" value="${_calEsc(isAllDay ? _calLocalDateInputValue(this, ev?.start || defaultStart, now) : startVal)}">`)}
      ${_calField('終了', `<input data-e2e-id="calendar-event-end" data-cal-event-end type="${isAllDay ? 'date' : 'datetime-local'}" aria-label="終了" value="${_calEsc(isAllDay ? _calLocalDateInputValue(this, ev?.end || defaultEnd || ev?.start || defaultStart, new Date(now.getTime() + 3600000)) : endVal)}">`)}
      ${calOpts ? _calField('カレンダー', `<select data-e2e-id="calendar-event-calendar" data-cal-event-calendar class="gb-select" aria-label="カレンダー">${calOpts}</select>`) : ''}
      ${_calField('作成者', `<select data-e2e-id="calendar-event-creator" data-cal-event-creator class="gb-select" aria-label="作成者"><option value="${_calEsc(creator)}">${_calEsc(creator || 'anonymous')}</option></select>`)}
      ${_calField('メンバー', `<div data-cal-event-members class="cal-option-members"><span style="color:var(--fg2);font-size:12px;">読み込み中...</span></div>`)}
      ${_calField('色', `<button type="button" data-e2e-id="calendar-event-color" data-cal-event-color class="gb-color-swatch gb-color-swatch--field" data-color="${_calEsc(ev?.color || this._eventColorDefault())}" title="イベント色"></button>`)}
      ${_calField('場所', `<input data-e2e-id="calendar-event-location" data-cal-event-location type="text" aria-label="場所" value="${_calEsc(ev?.location || '')}">`)}
      ${_calField('URL', `<input data-e2e-id="calendar-event-url" data-cal-event-url type="url" aria-label="URL" value="${_calEsc(ev?.url || '')}" placeholder="https://...">`)}
      ${_calField('アラーム', `<select data-e2e-id="calendar-event-alert" data-cal-event-alert class="gb-select" aria-label="アラーム">
        <option value="-1" ${(ev?.alert_minutes ?? -1) === -1 ? 'selected' : ''}>なし</option>
        <option value="0" ${ev?.alert_minutes === 0 ? 'selected' : ''}>イベント時</option>
        <option value="5" ${ev?.alert_minutes === 5 ? 'selected' : ''}>5分前</option>
        <option value="15" ${ev?.alert_minutes === 15 ? 'selected' : ''}>15分前</option>
        <option value="30" ${ev?.alert_minutes === 30 ? 'selected' : ''}>30分前</option>
        <option value="60" ${ev?.alert_minutes === 60 ? 'selected' : ''}>1時間前</option>
      </select>`)}
      ${_calField('説明', `<textarea data-e2e-id="calendar-event-desc" data-cal-event-desc rows="3" aria-label="説明">${_calEsc(ev?.description || '')}</textarea>`)}
      <div class="cal-option-actions cal-option-actions--footer">
        <button type="button" class="danger" data-e2e-id="calendar-event-delete" data-cal-event-delete>削除</button>
        <span></span>
        ${ev?.id ? '<button type="button" data-e2e-id="calendar-event-comment-list" data-cal-event-comment-list>コメント一覧</button><button type="button" data-e2e-id="calendar-event-comment-add" data-cal-event-comment>コメントを追加</button>' : ''}
        <button type="button" class="primary" data-e2e-id="calendar-event-save" data-cal-event-save>保存</button>
      </div>`;
    const allDay = body.querySelector('[data-cal-event-allday]');
    const startInput = body.querySelector('[data-cal-event-start]');
    const endInput = body.querySelector('[data-cal-event-end]');
    if (startInput) startInput.dataset.calRawValue = startInput.value || '';
    if (endInput) endInput.dataset.calRawValue = endInput.value || '';
    const calendarSelect = body.querySelector('[data-cal-event-calendar]');
    if (calendarSelect) calendarSelect.dataset.calOriginal = ev?.calendar_id || '';
    allDay?.addEventListener('change', () => {
      _calSetEventDateInputMode(this, startInput, endInput, allDay.checked);
    });
    _calBindSwatch(body.querySelector('[data-cal-event-color]'), ev?.color || this._eventColorDefault());
    this._populateEventUserControls(body, ev);
    body.querySelector('[data-cal-event-save]')?.addEventListener('click', () => this._saveEventOptions(ev.id, body));
    body.querySelector('[data-cal-event-delete]')?.addEventListener('click', () => this._deleteEventFromOptions(ev.id));
    body.querySelector('[data-cal-event-comment]')?.addEventListener('click', (event) => {
      if (typeof addCommentHere !== 'function' || !ev?.id) return;
      const calendarId = ev.calendar_id || body.querySelector('[data-cal-event-calendar]')?.value || '_calendar';
      const snapshot = (body.querySelector('[data-cal-event-title]')?.value || ev.title || '').trim().slice(0, 120);
      addCommentHere({
        targetKind: 'calendar_event',
        filePath: calendarId,
        targetRef: { file: calendarId, eventId: ev.id },
        snapshot,
      }, { anchorEl: event.currentTarget });
    });
    body.querySelector('[data-cal-event-comment-list]')?.addEventListener('click', () => {
      const calendarId = ev?.calendar_id || body.querySelector('[data-cal-event-calendar]')?.value || '_calendar';
      if (typeof CommentBadges !== 'undefined' && typeof CommentBadges.openPanelForFileComments === 'function') {
        CommentBadges.openPanelForFileComments(calendarId);
      }
    });
    setTimeout(() => body.querySelector('[data-cal-event-title]')?.focus(), 0);
  };

  CalendarComponent.prototype._saveEventOptions = async function(editId, body) {
    const evRef = (this._events || []).find(x => x.id === editId);
    const source = String(evRef?.calendar_source || '');
    if (['production-task', 'attendance', 'shift', 'shift-break'].includes(source)) {
      this._showStatus('自動生成された予定は元データから編集してください', true);
      return;
    }
    // 保存中の同一イベントへの多重保存を防ぐ（ロールバック順序の混線防止）
    if (!this._savingEventIds) this._savingEventIds = new Set();
    if (this._savingEventIds.has(editId)) {
      this._showStatus('保存中です。少し待ってからもう一度お試しください');
      return;
    }
    this._pushUndo('イベント編集');
    const creator = body.querySelector('[data-cal-event-creator]')?.value || this._getUser();
    const allDay = body.querySelector('[data-cal-event-allday]')?.checked;
    const startInput = body.querySelector('[data-cal-event-start]');
    const endInput = body.querySelector('[data-cal-event-end]');
    const startValue = allDay ? _calLocalDateInputValue(this, startInput?.value) : (startInput?.value || '');
    const endValue = allDay ? _calLocalDateInputValue(this, endInput?.value || startValue) : (endInput?.value || '');
    const data = {
      title: body.querySelector('[data-cal-event-title]')?.value || '無題',
      start: startValue,
      end: endValue,
      all_day: allDay ? 1 : 0,
      color: _calGetSwatchValue(body.querySelector('[data-cal-event-color]'), ''),
      location: body.querySelector('[data-cal-event-location]')?.value || '',
      url: body.querySelector('[data-cal-event-url]')?.value || '',
      description: body.querySelector('[data-cal-event-desc]')?.value || '',
      alert_minutes: parseInt(body.querySelector('[data-cal-event-alert]')?.value || '-1', 10),
      calendar_id: body.querySelector('[data-cal-event-calendar]')?.value || '',
      user: this._getUser(),
      creator,
      members: this._collectEventMemberValues(body, creator),
    };
    // カレンダー所属が未変更ならフィールド自体を送らない（他メンバー所有カレンダーの所属保持）
    const calendarSelect = body.querySelector('[data-cal-event-calendar]');
    if (calendarSelect && (calendarSelect.dataset.calOriginal || '') === (calendarSelect.value || '')) {
      delete data.calendar_id;
    }
    if (data.alert_minutes >= 0 && 'Notification' in window && Notification.permission === 'default') {
      const permissionRequest = Notification.requestPermission();
      if (permissionRequest && typeof permissionRequest.catch === 'function') permissionRequest.catch(() => {});
    }
    // 楽観的更新: 保存完了を待たずに先に画面へ反映し、保存と再取得は裏で行う
    // （保存に失敗した場合は編集対象イベントだけを元に戻し、サーバー状態を再取得する）
    const beforeEvent = evRef ? { ...evRef } : null;
    this._events = (this._events || []).map(event => (event.id === editId ? { ...event, ...data } : event));
    this._renderCalendarList?.();
    this._render();
    this._savingEventIds.add(editId);
    try {
      await apiPut('/cal/events/' + editId, data);
      this._showStatus('イベントを保存しました');
      this._loadEvents?.().then(() => this._render()).catch(() => {});
    } catch {
      if (beforeEvent) {
        this._events = (this._events || []).map(event => (event.id === editId ? beforeEvent : event));
      }
      this._renderCalendarList?.();
      this._render();
      this._showStatus('保存に失敗', true);
      this._loadEvents?.().then(() => this._render()).catch(() => {});
    } finally {
      this._savingEventIds.delete(editId);
    }
  };

  CalendarComponent.prototype._deleteEventFromOptions = async function(id) {
    // 削除できないイベントは確認ダイアログより前に弾く（同意後に拒否しない）
    const evRef = (this._events || []).find(x => x.id === id);
    const source = String(evRef?.calendar_source || '');
    if (['production-task', 'attendance'].includes(source)) {
      this._showStatus('自動生成された予定は元データから削除してください', true);
      return;
    }
    // 繰り返しの個別回はシリーズ全体と同じIDを持つため、削除の意味を明示して確認する
    const confirmText = evRef?._recurrence_instance
      ? 'これは繰り返しの予定です。繰り返しの予定全体を削除しますか？'
      : 'このイベントを削除しますか？';
    if (typeof cfConfirm === 'function' && !await cfConfirm(confirmText)) return;
    const isShift = source === 'shift' || source === 'shift-break' || String(id || '').startsWith('shift:');
    const rawShiftId = String(id || '').startsWith('shift:')
      ? String(id).slice('shift:'.length)
      : String(evRef?.external_id || id || '');
    const shiftId = rawShiftId.split(':break:')[0];
    const beforeEvents = (this._events || []).map(event => ({ ...event }));
    const beforeShifts = (this._shifts || []).map(shift => ({ ...shift }));
    const beforeSelected = this._eventSelection ? [...this._eventSelection()] : [];
    const beforeLast = this._lastSelectedEventId || '';
    if (!isShift) this._pushUndo('イベント削除');
    if (isShift && shiftId && typeof this._removeShiftOptimistic === 'function') {
      this._removeShiftOptimistic(shiftId);
    } else {
      this._events = (this._events || []).filter(event => event.id !== id);
      this._eventSelection?.().delete(id);
      if (this._lastSelectedEventId === id) this._lastSelectedEventId = '';
    }
    this._renderCalendarList?.();
    this._render();
    const body = _calOptionContainer('カレンダー');
    if (body) body.innerHTML = '<div class="cal-option-empty">イベントを削除しました</div>';
    try {
      const result = isShift
        ? await apiFetch('/cal/shifts/' + encodeURIComponent(shiftId), { method: 'DELETE' })
        : await apiFetch('/cal/events/' + encodeURIComponent(id), { method: 'DELETE' });
      if (result && result.ok === false) throw new Error(result.message || '削除に失敗');
      apiPost('/annotations/orphan-by-target', {
        target_kind: 'calendar_event',
        target_file: evRef?.calendar_id || '_calendar',
        item_id: id,
        cascade_container: true,
      }).catch(() => {});
      if (isShift && typeof this._refreshShiftStateAfterMutation === 'function') {
        this._refreshShiftStateAfterMutation();
      } else {
        this._loadEvents?.().then(() => this._render()).catch(() => {});
      }
      this._showStatus('削除しました');
    } catch {
      this._events = beforeEvents;
      this._shifts = beforeShifts;
      this._setSelectedEvents?.(beforeSelected, beforeLast);
      this._renderCalendarList?.();
      this._render();
      if (body) body.innerHTML = '<div class="cal-option-empty">削除に失敗しました</div>';
      this._showStatus('削除に失敗', true);
    }
  };

  CalendarComponent.prototype._createTaskQuick = async function(options) {
    const opts = options || {};
    this._pushUndo('ToDo作成');
    try {
      const res = await apiPost('/cal/tasks', {
        title: '無題',
        status: opts.status || 'todo',
        priority: opts.priority || 'medium',
        due_date: opts.due_date || '',
        user: this._getUser(),
      });
      await this._loadTasks();
      this._render();
      this._renderTodayTasks();
      const id = res?.id || '';
      if (id) this._showTaskModal(id);
      this._showStatus('ToDoを追加しました');
      return id;
    } catch {
      this._showStatus('ToDo追加に失敗', true);
      return '';
    }
  };

  CalendarComponent.prototype._showTaskModal = function(editId, defaultStatus) {
    if (!editId) {
      this._createTaskQuick({ status: defaultStatus || 'todo' });
      return;
    }
    const task = this._tasks.find(t => t.id === editId);
    if (!task) return;
    this._showTaskOptionsPanel(task);
  };

  CalendarComponent.prototype._showTaskOptionsPanel = function(task) {
    const body = _calOptionContainer('ToDo設定');
    if (!body) return;
    body._calComponent = this;
    const statuses = [['backlog','バックログ'],['todo','未着手'],['in_progress','進行中'],['review','レビュー'],['done','完了']];
    const priorities = [['low','低'],['medium','中'],['high','高'],['urgent','緊急']];
    body.innerHTML = `
      ${_calField('タイトル', `<input data-cal-task-title data-e2e-id="cal-task-title" aria-label="ToDoタイトル" type="text" value="${_calEsc(task.title || '')}" placeholder="ToDo名">`)}
      ${_calField('ステータス', `<select data-cal-task-status data-e2e-id="cal-task-status" aria-label="ToDoステータス" class="gb-select">${statuses.map(([v,l]) => `<option value="${v}" ${(task.status || 'todo') === v ? 'selected' : ''}>${l}</option>`).join('')}</select>`)}
      ${_calField('優先度', `<select data-cal-task-priority data-e2e-id="cal-task-priority" aria-label="ToDo優先度" class="gb-select">${priorities.map(([v,l]) => `<option value="${v}" ${(task.priority || 'medium') === v ? 'selected' : ''}>${l}</option>`).join('')}</select>`)}
      ${_calField('期限', `<input data-cal-task-due data-e2e-id="cal-task-due" aria-label="ToDo期限" type="date" value="${_calEsc(task.due_date || '')}">`)}
      ${_calField('担当者', `<div style="display:flex;gap:4px;align-items:center;">
        <input data-cal-task-assignee data-e2e-id="cal-task-assignee" aria-label="ToDo担当者" type="text" value="${_calEsc(task.assignee || '')}" style="flex:1;min-width:0;">
        <button type="button" class="gb-btn gb-btn-xs gb-btn-quiet" data-cal-task-assignee-picker data-e2e-id="cal-task-assignee-picker" aria-label="担当者候補から選択" title="候補から選択">▾</button>
      </div>`)}
      <div class="cal-option-grid">
        ${_calField('見積(h)', `<input data-cal-task-est data-e2e-id="cal-task-estimated-hours" aria-label="ToDo見積時間" type="number" step="0.5" value="${_calEsc(task.estimated_hours || 0)}">`)}
        ${_calField('実績(h)', `<input data-cal-task-act data-e2e-id="cal-task-actual-hours" aria-label="ToDo実績時間" type="number" step="0.5" value="${_calEsc(task.actual_hours || 0)}">`)}
      </div>
      ${_calField('説明', `<textarea data-cal-task-desc data-e2e-id="cal-task-description" aria-label="ToDo説明" rows="3">${_calEsc(task.description || '')}</textarea>`)}
      <div class="cal-option-actions cal-option-actions--footer">
        <button type="button" class="danger" data-cal-task-delete data-e2e-id="cal-task-delete" aria-label="ToDoを削除">削除</button>
        <span></span>
        <button type="button" class="primary" data-cal-task-save data-e2e-id="cal-task-save" aria-label="ToDoを保存">保存</button>
      </div>`;
    body.querySelector('[data-cal-task-save]')?.addEventListener('click', () => this._saveTaskOptions(task.id, body));
    body.querySelector('[data-cal-task-delete]')?.addEventListener('click', () => this._deleteTaskFromOptions(task.id));
    // ToDo担当者はコンボ型ピッカー（候補選択+自由入力併用。ユーザーアカウント
    // 一元管理 計画書 Phase 3、§5.8）。既存の自由入力値は保存経路（value読み取り）
    // をそのまま使うため壊さない。
    body.querySelector('[data-cal-task-assignee-picker]')?.addEventListener('click', (event) => {
      const input = body.querySelector('[data-cal-task-assignee]');
      if (!input || !window.MeldexUserPicker) return;
      window.MeldexUserPicker.open(event.currentTarget, {
        value: input.value,
        allowFreeText: true,
        onCommit: (name) => { input.value = name; input.focus(); },
      });
    });
    setTimeout(() => body.querySelector('[data-cal-task-title]')?.focus(), 0);
  };

  CalendarComponent.prototype._saveTaskOptions = async function(editId, body) {
    this._pushUndo('ToDo編集');
    const data = {
      title: body.querySelector('[data-cal-task-title]')?.value || '無題',
      status: body.querySelector('[data-cal-task-status]')?.value || 'todo',
      priority: body.querySelector('[data-cal-task-priority]')?.value || 'medium',
      due_date: body.querySelector('[data-cal-task-due]')?.value || '',
      assignee: body.querySelector('[data-cal-task-assignee]')?.value || '',
      estimated_hours: parseFloat(body.querySelector('[data-cal-task-est]')?.value || '0') || 0,
      actual_hours: parseFloat(body.querySelector('[data-cal-task-act]')?.value || '0') || 0,
      description: body.querySelector('[data-cal-task-desc]')?.value || '',
      user: this._getUser(),
    };
    try {
      await apiPut('/cal/tasks/' + editId, data);
      await this._loadTasks();
      this._render();
      this._renderTodayTasks();
      this._showStatus('ToDoを保存しました');
    } catch {
      this._showStatus('保存に失敗', true);
    }
  };

  CalendarComponent.prototype._deleteTaskFromOptions = async function(id) {
    if (await this._deleteTask(id)) {
      const body = _calOptionContainer('カレンダー');
      if (body) body.innerHTML = '<div class="cal-option-empty">ToDoを削除しました</div>';
    }
  };

  CalendarComponent.prototype._calendarHourPx = function(card) {
    const cell = card?.closest?.('.gb-cal-week-cell') || this._contentEl?.querySelector?.('.gb-cal-week-cell');
    const measured = cell?.getBoundingClientRect?.().height || 0;
    return measured > 0 ? measured : 40;
  };

  CalendarComponent.prototype._resizeGroupForEvent = function(eventId) {
    const sel = this._eventSelection();
    if (!sel.has(eventId)) this._setSelectedEvents([eventId], eventId);
    const rendered = new Set(this._renderedEventIds());
    const ids = [...this._eventSelection()].filter(id =>
      (!rendered.size || rendered.has(id)) && (this._events || []).some(ev => ev.id === id)
    );
    if (!ids.includes(eventId)) ids.push(eventId);
    return ids;
  };

  CalendarComponent.prototype._handleResize = function(event, card, ev, evStart, startH, direction) {
    event.stopPropagation();
    event.preventDefault();
    const groupIds = this._resizeGroupForEvent(ev.id);
    const hourPx = this._calendarHourPx(card);
    const snapPx = hourPx / 4;
    const minMs = EVENT_EDGE_MINUTES * 60000;
    const items = groupIds.map(id => {
      const source = this._events.find(item => item.id === id);
      if (!source) return null;
      const sourceStart = new Date(source.start || evStart);
      const sourceEnd = source.end ? new Date(source.end) : new Date(sourceStart.getTime() + 3600000);
      const visibleCards = [...(this._contentEl?.querySelectorAll?.(`[data-event-id="${_calCssEscape(id)}"]`) || [])];
      return {
        ev: source,
        start: sourceStart,
        end: sourceEnd,
        cards: visibleCards.map(el => ({
          el,
          top: parseFloat(el.style.top) || 0,
          height: el.offsetHeight || parseFloat(el.style.height) || Math.max(20, hourPx),
        })),
      };
    }).filter(Boolean);
    if (!items.length) return;

    const startY = event.clientY;
    const clampDelta = (deltaMs) => {
      let next = deltaMs;
      items.forEach(item => {
        const duration = item.end.getTime() - item.start.getTime();
        if (direction === 'top') next = Math.min(next, duration - minMs);
        else next = Math.max(next, minMs - duration);
      });
      return next;
    };
    const deltaToPx = deltaMs => (deltaMs / minMs) * snapPx;
    const pxToDelta = px => Math.round(px / snapPx) * minMs;
    let activeDeltaMs = 0;

    document.body.style.userSelect = 'none';
    card.style.touchAction = 'none';
    const onMove = (moveEvent) => {
      const rawPx = moveEvent.clientY - startY;
      activeDeltaMs = clampDelta(pxToDelta(rawPx));
      const activePx = deltaToPx(activeDeltaMs);
      items.forEach(item => {
        item.cards.forEach(entry => {
          if (direction === 'bottom') {
            entry.el.style.height = Math.max(snapPx, entry.height + activePx) + 'px';
          } else {
            entry.el.style.top = (entry.top + activePx) + 'px';
            entry.el.style.height = Math.max(snapPx, entry.height - activePx) + 'px';
          }
        });
      });
    };
    const onUp = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.body.style.userSelect = '';
      card.style.touchAction = '';
      if (!activeDeltaMs) {
        this._render();
        return;
      }
      // 制作管理UX改善計画（2026-08-04）§6-4: production-task イベントはタスクへの書き戻し
      // （_calApplyEventTimePatch、gb-tool-calendar-views.part01.js）を経由する。
      // シフト・勤怠など他の自動生成イベントは従来どおり409のまま（このヘルパー内で判定）。
      // コミット前レビュー指摘 #5: 選択中の全件がproduction-task（undo対象外）の場合、
      // 元に戻せない偽のUndo記録を積まない。1件でも通常イベントが含まれていれば、
      // その分の復元のために従来どおり記録する。
      if (items.some(item => this._eventIsUndoable(item.ev))) this._pushUndo('イベントリサイズ');
      const updates = items.map(item => {
        if (direction === 'bottom') {
          const nextEnd = new Date(item.end.getTime() + activeDeltaMs);
          return _calApplyEventTimePatch(this, item.ev, { end: this._localDateTimeStr(nextEnd) });
        }
        const nextStart = new Date(item.start.getTime() + activeDeltaMs);
        return _calApplyEventTimePatch(this, item.ev, { start: this._localDateTimeStr(nextStart) });
      });
      Promise.all(updates).then(() => this._loadEvents()).then(() => this._render()).catch(() => {
        this._showStatus('イベントリサイズに失敗', true);
        this._render();
        // 並列更新の部分成功でサーバーと表示が乖離しないよう再同期する
        this._loadEvents?.().then(() => this._render()).catch(() => {});
      });
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  };

  // 詳細パネル版イベントフォーム（gb-detail-panel）を退避してから上書きする。
  // スケジュール未起動時やタイトル付き新規作成（ファイルドロップ等）はこちらへ委譲する
  const _detailPanelEventForm = typeof _showCalEventInDetailPanel === 'function' ? _showCalEventInDetailPanel : null;
  window._showCalEventInDetailPanel = function(ev, calendars, defaultStart, defaultEnd, defaultAllDay, ownerComponent) {
    const owner = ownerComponent || (typeof _calFindCalendarComponent === 'function' ? _calFindCalendarComponent() : null);
    if (owner && typeof owner._showEventOptionsPanel === 'function') {
      if (ev?.id) {
        owner._showEventOptionsPanel(ev, defaultStart, defaultEnd, defaultAllDay);
        return;
      }
      if (!ev || (!ev.title && !ev.description)) {
        owner._createEventQuick(defaultStart, defaultEnd, defaultAllDay);
        return;
      }
    }
    if (_detailPanelEventForm) _detailPanelEventForm(ev, calendars, defaultStart, defaultEnd, defaultAllDay, owner || null);
  };
  try { _showCalEventInDetailPanel = window._showCalEventInDetailPanel; } catch (_) {}
})();
