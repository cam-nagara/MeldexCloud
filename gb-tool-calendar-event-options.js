/* ==============================
   gb-tool-calendar-event-options.js: Event option form and CRUD
   ============================== */

(() => {
  if (typeof CalendarComponent === 'undefined' || !window.MeldexCalendarOptions) return;
  const {
    DEFAULT_EVENT_COLOR,
    _calEsc,
    _calIcon,
    _calLocalInputValue,
    _calLocalDateInputValue,
    _calSetEventDateInputMode,
    _calOptionContainer,
    _calField,
    _calBindSwatch,
    _calGetSwatchValue,
    _calEventCreator,
    _calUserListFromValue,
  } = window.MeldexCalendarOptions;

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
      color_override: null,
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
    } catch (error) {
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
      if (!this._calUserIsAdmin?.()) {
        this._showStatus('実績の修正は管理者に依頼してください', true);
        return;
      }
      if (typeof this._showAttendanceCorrectionModal === 'function') {
        this._showAttendanceCorrectionModal(ev);
        return;
      }
      this._showStatus('実績の修正画面を読み込めませんでした', true);
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
    const usesCalendarColor = ev?.uses_calendar_color !== false && !String(ev?.color_override || '').trim();
    const eventColor = ev?.color || this._eventColorDefault();
    body.dataset.calEventMembers = JSON.stringify(_calUserListFromValue(ev?.members));
    body.innerHTML = `
      ${_calField('タイトル', `<input data-e2e-id="calendar-event-title" data-cal-event-title type="text" aria-label="タイトル" value="${_calEsc(ev?.title || '')}" placeholder="イベント名">`)}
      ${_calField('', `<label class="cal-option-check"><input data-e2e-id="calendar-event-allday" data-cal-event-allday type="checkbox" aria-label="終日" ${isAllDay ? 'checked' : ''}> 終日</label>`)}
      ${_calField('開始', `<input data-e2e-id="calendar-event-start" data-cal-event-start type="${isAllDay ? 'date' : 'datetime-local'}" aria-label="開始" value="${_calEsc(isAllDay ? _calLocalDateInputValue(this, ev?.start || defaultStart, now) : startVal)}">`)}
      ${_calField('終了', `<input data-e2e-id="calendar-event-end" data-cal-event-end type="${isAllDay ? 'date' : 'datetime-local'}" aria-label="終了" value="${_calEsc(isAllDay ? _calLocalDateInputValue(this, ev?.end || defaultEnd || ev?.start || defaultStart, new Date(now.getTime() + 3600000)) : endVal)}">`)}
      ${calOpts ? _calField('カレンダー', `<select data-e2e-id="calendar-event-calendar" data-cal-event-calendar class="gb-select" aria-label="カレンダー">${calOpts}</select>`) : ''}
      ${_calField('作成者', `<select data-e2e-id="calendar-event-creator" data-cal-event-creator class="gb-select" aria-label="作成者"><option value="${_calEsc(creator)}">${_calEsc(creator || 'anonymous')}</option></select>`)}
      ${_calField('参加ユーザー', `<div data-cal-event-members class="cal-option-members"><span style="color:var(--fg2);font-size:12px;">読み込み中...</span></div>`)}
      ${_calField('色', `<select data-e2e-id="calendar-event-color-mode" data-cal-event-color-mode class="gb-select" aria-label="イベント色の使い方">
        <option value="calendar" ${usesCalendarColor ? 'selected' : ''}>カレンダーの色を使用</option>
        <option value="custom" ${usesCalendarColor ? '' : 'selected'}>個別の色</option>
      </select><button type="button" data-e2e-id="calendar-event-color" data-cal-event-color class="gb-color-swatch gb-color-swatch--field" data-color="${_calEsc(eventColor)}" title="個別の色"></button>`)}
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
        ${ev?.id ? '<button type="button" data-e2e-id="calendar-event-history" data-cal-event-history>版を見る</button><button type="button" data-e2e-id="calendar-event-comment-list" data-cal-event-comment-list>コメント一覧</button><button type="button" data-e2e-id="calendar-event-comment-add" data-cal-event-comment>コメントを追加</button>' : ''}
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
    const colorMode = body.querySelector('[data-cal-event-color-mode]');
    const colorSwatch = body.querySelector('[data-cal-event-color]');
    _calBindSwatch(colorSwatch, eventColor);
    const updateColorMode = () => {
      const inherits = colorMode?.value !== 'custom';
      if (colorSwatch) {
        colorSwatch.disabled = inherits;
        colorSwatch.setAttribute('aria-disabled', inherits ? 'true' : 'false');
      }
      if (inherits) {
        const selected = (this._calendars || []).find(item => item.id === calendarSelect?.value);
        if (selected?.color) {
          colorSwatch.dataset.color = selected.color;
          colorSwatch.style.background = selected.color;
        }
      }
    };
    colorMode?.addEventListener('change', updateColorMode);
    calendarSelect?.addEventListener('change', updateColorMode);
    updateColorMode();
    this._populateEventUserControls(body, ev);
    body.querySelector('[data-cal-event-save]')?.addEventListener('click', () => this._saveEventOptions(ev.id, body));
    body.querySelector('[data-cal-event-delete]')?.addEventListener('click', () => this._deleteEventFromOptions(ev.id));
    body.querySelector('[data-cal-event-history]')?.addEventListener('click', event => {
      window.MeldexCalendarItemHistory?.open('event', ev.id, {
        returnFocus: event.currentTarget,
        onRestored: async () => {
          await this._loadEvents();
          this._renderCalendarList?.();
          this._render();
          const restored = (this._events || []).find(item => item.id === ev.id);
          if (restored) this._showEventOptionsPanel(restored);
          else body.innerHTML = '<div class="cal-option-empty">この版では予定が存在しません</div>';
          this._showStatus('予定を復元しました');
        },
      }).catch(error => this._showStatus(error?.message || '予定の版を開けませんでした', true));
    });
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
    if (['production-task', 'renderlist', 'attendance', 'shift', 'shift-break'].includes(source)) {
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
      color_override: body.querySelector('[data-cal-event-color-mode]')?.value === 'custom'
        ? _calGetSwatchValue(body.querySelector('[data-cal-event-color]'), '')
        : null,
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
    if (this.el) {
      this.el.dataset.eventSaveState = 'pending';
      this.el.dataset.eventSaveMessage = '';
    }
    try {
      await apiPut('/cal/events/' + editId, data);
      if (this.el) this.el.dataset.eventSaveState = 'saved';
      this._showStatus('イベントを保存しました');
      this._loadEvents?.().then(() => this._render()).catch(() => {});
    } catch (error) {
      const failureDetail = String(error?.userMessage || error?.message || '').trim();
      if (this.el) {
        this.el.dataset.eventSaveState = 'error';
        this.el.dataset.eventSaveMessage = failureDetail || 'イベントの保存に失敗しました';
      }
      if (beforeEvent) {
        this._events = (this._events || []).map(event => (event.id === editId ? beforeEvent : event));
      }
      this._renderCalendarList?.();
      this._render();
      this._showStatus(
        failureDetail ? `イベントの保存に失敗しました: ${failureDetail}` : 'イベントの保存に失敗しました',
        true,
      );
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
    if (isShift && this._shiftMutationStateUnknown) {
      this._showStatus('前回のシフト保存結果を確認できません。カレンダーを再読み込みしてください', true);
      return;
    }
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
    let acknowledged = false;
    try {
      const result = isShift
        ? await apiFetch('/cal/shifts/' + encodeURIComponent(shiftId), { method: 'DELETE' })
        : await apiFetch('/cal/events/' + encodeURIComponent(id), { method: 'DELETE' });
      if (result && result.ok === false) throw new Error(result.message || '削除に失敗');
      acknowledged = true;
      apiPost('/annotations/orphan-by-target', {
        target_kind: 'calendar_event',
        target_file: evRef?.calendar_id || '_calendar',
        item_id: id,
        cascade_container: true,
      }).catch(() => {});
      if (isShift && typeof this._refreshShiftStateAfterMutation === 'function') {
        await this._refreshShiftStateAfterMutation();
      } else {
        this._loadEvents?.().then(() => this._render()).catch(() => {});
      }
      this._showStatus('削除しました');
    } catch (error) {
      if (isShift && acknowledged) {
        console.error('削除済みシフトの再読込に失敗しました', error);
        this._showStatus('シフトは削除されましたが、再読み込みに失敗しました', true);
        return;
      }
      if (isShift) {
        const outcome = await this._reconcileShiftMutationAfterError?.(shiftId, 'delete');
        if (outcome === 'applied') {
          if (body) body.innerHTML = '<div class="cal-option-empty">イベントを削除しました</div>';
          this._showStatus('削除しました');
          return;
        }
        if (outcome === 'unknown') {
          if (body) body.innerHTML = '<div class="cal-option-empty">削除結果を確認できません。カレンダーを再読み込みしてください</div>';
          this._showStatus('シフト削除結果を確認できません。カレンダーを再読み込みしてください', true);
          return;
        }
      }
      this._events = beforeEvents;
      this._shifts = beforeShifts;
      this._setSelectedEvents?.(beforeSelected, beforeLast);
      this._renderCalendarList?.();
      this._render();
      if (body) body.innerHTML = '<div class="cal-option-empty">削除に失敗しました</div>';
      this._showStatus('削除に失敗', true);
    }
  };

})();
