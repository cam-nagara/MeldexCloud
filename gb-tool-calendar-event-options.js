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

  // ---- 保存を押す前の入力の退避（シートの「未保存の入力」と同じ扱い。v0.7.523 のセルと揃える） ----
  // 予定のオプションで入力して「保存」を押す前に、再読み込み・画面を閉じると入力が知らせなく消えていた。
  // 画面を離れる時（pagehide / beforeunload）に、変えた入力を予定ごとに端末へ退避し、同じ予定のオプションを
  // 開いた時に入力欄へ戻して「未保存の入力があります」と出す。保存・削除・破棄で消す。
  const DRAFT_KEY = 'meldex:cal-event-draft:v1';
  const DRAFT_FIELDS = [
    ['title', '[data-cal-event-title]'], ['start', '[data-cal-event-start]'], ['end', '[data-cal-event-end]'],
    ['location', '[data-cal-event-location]'], ['url', '[data-cal-event-url]'], ['description', '[data-cal-event-desc]'],
  ];
  const _calDraftStore = () => {
    try { return JSON.parse(localStorage.getItem(DRAFT_KEY) || '{}') || {}; } catch { return {}; }
  };
  const _calDraftWrite = (store) => {
    try {
      if (Object.keys(store).length) localStorage.setItem(DRAFT_KEY, JSON.stringify(store));
      else localStorage.removeItem(DRAFT_KEY);
      return true;
    } catch { return false; }
  };
  const _calDraftKey = (component, id) => `${component?._getUser?.() || ''}|${id}`;
  function _calEventDraftClear(component, id, capturedKey = '') {
    if (!id) return;
    const store = _calDraftStore();
    const key = capturedKey || _calDraftKey(component, id);
    if (store[key]) { delete store[key]; _calDraftWrite(store); }
  }
  function _calEventDraftStashOpenBodies() {
    const store = _calDraftStore();
    document.querySelectorAll('[data-cal-event-title]').forEach(titleInput => {
      const owner = titleInput._calEventDraftOwner;
      if (!owner || !owner.dirty || !owner.eventId) return;
      const values = {};
      DRAFT_FIELDS.forEach(([name, selector]) => {
        const el = owner.body.querySelector(selector);
        if (el) values[name] = el.value;
      });
      store[owner.draftKey || _calDraftKey(owner.component, owner.eventId)] = { values, savedAt: new Date().toISOString() };
    });
    return _calDraftWrite(store);
  }
  if (!window.__meldexCalEventDraftBound && typeof window.addEventListener === 'function') {
    window.__meldexCalEventDraftBound = true;
    window.addEventListener('pagehide', () => _calEventDraftStashOpenBodies());
    window.addEventListener('beforeunload', () => _calEventDraftStashOpenBodies());
  }
  CalendarComponent.prototype._bindEventOptionDraft = function(body, ev) {
    if (!ev?.id) return;
    const titleInput = body.querySelector('[data-cal-event-title]');
    if (!titleInput) return;
    const owner = { component: this, eventId: ev.id, body, dirty: false, draftKey: _calDraftKey(this, ev.id) };
    titleInput._calEventDraftOwner = owner;
    body._calEventDraftOwner = owner;
    DRAFT_FIELDS.forEach(([, selector]) => {
      body.querySelector(selector)?.addEventListener('input', () => { owner.dirty = true; });
    });
    const draft = _calDraftStore()[_calDraftKey(this, ev.id)];
    if (!draft?.values) return;
    DRAFT_FIELDS.forEach(([name, selector]) => {
      const el = body.querySelector(selector);
      if (el && typeof draft.values[name] === 'string' && el.value !== draft.values[name]) el.value = draft.values[name];
    });
    owner.dirty = true;
    const notice = document.createElement('div');
    notice.className = 'cal-option-draft-notice';
    notice.setAttribute('role', 'status');
    notice.dataset.e2eId = 'calendar-event-draft-notice';
    const text = document.createElement('span');
    text.textContent = '未保存の入力があります。「保存」で反映します';
    const discard = document.createElement('button');
    discard.type = 'button';
    discard.dataset.e2eId = 'calendar-event-draft-discard';
    discard.textContent = '入力を破棄';
    discard.addEventListener('click', () => {
      _calEventDraftClear(this, ev.id, owner.draftKey);
      const current = (this._events || []).find(item => item.id === ev.id);
      if (current) this._showEventOptionsPanel(current);
    });
    notice.append(text, discard);
    body.insertBefore(notice, body.firstChild);
    this._showStatus('未保存の入力があります（「保存」で反映します）');
  };

  // 取り消しの履歴の枠を操作した時点で取る（保存の完了後に積むと、保存中の Ctrl+Z が1つ前の別の操作を取り消す）。
  // 保存が成功したら commit()、失敗・無変化なら cancel()（失敗した操作の偽の履歴を残さない）。
  // 共通履歴が無い環境では、従来どおり commit() の時点で自己完結スタックへ積む。
  // options.undo / options.redo を渡すと、写し全体の復元ではなくその操作だけを戻す・やり直す（予定の作成など）。
  CalendarComponent.prototype._reserveUndo = function(label, options = {}) {
    const snapshot = this._captureUndoSnapshot();
    // ほかの予定の作成が保存中（未確定）の時点の写しでも、その予定を「写しに無い」扱いにしない。
    // 未確定の印を外して写しに残す（外さないと復元で保存済みになったその予定まで消していた）。
    snapshot.events = (snapshot.events || []).map(ev => {
      if (!ev || !(ev._optimistic || ev._saveState)) return ev;
      const { _optimistic, _saveState, ...rest } = ev;
      return rest;
    });
    const canReserve = typeof _schedHasCommonHistory === 'function' && _schedHasCommonHistory() && typeof historyReserve === 'function';
    const reservation = canReserve ? historyReserve(label, _schedHistoryScope(this)) : null;
    let settled = false;
    return {
      snapshot,
      commit: () => {
        if (settled) return;
        settled = true;
        if (reservation && typeof options.undo === 'function') reservation.fill(options.undo, typeof options.redo === 'function' ? options.redo : null, label);
        else if (reservation) reservation.fill(() => this._restoreSnapshot(snapshot), null, label);
        else this._pushUndo(label, snapshot);
        this._notifyParentHistory?.();
      },
      cancel: () => {
        if (settled) return;
        settled = true;
        reservation?.cancel();
        this._notifyParentHistory?.();
      },
    };
  };

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
    // 履歴の枠は操作の時点で取り、保存が確定した時だけ中身を入れる（失敗・未保存の作成の偽の履歴を残さない）。
    // 作成の取り消しは「この予定だけを消す」、やり直しは「この予定だけを作り直す」（写し全体の復元にしない。
    // 続けて作った別の予定が保存中の時点の写しを戻すと、その予定まで消えていた）。
    let lastContent = null;
    const undo = this._reserveUndo('イベント作成', {
      undo: async () => {
        // やり直しで消す直前の内容（作成後の編集を含む）へ戻せるよう、手元の最新の値を取っておく。
        const latest = (this._events || []).find(e => e.id === id && !e._recurrence_instance);
        if (latest) {
          const { created, modified, uid, ical_uid, recurrence_id, original_start, _optimistic, _saveState, ...data } = latest;
          lastContent = data;
        }
        await apiFetch('/cal/events/' + encodeURIComponent(id), { method: 'DELETE' });
        this._eventSelection?.().delete(id);
        await this._loadEvents();
        this._render();
      },
      redo: async () => {
        await apiPost('/cal/events', { ...payload, ...(lastContent || {}), user: this._getUser(), id });
        await this._loadEvents();
        this._render();
      },
    });
    this._events = [...(this._events || []), optimisticEvent];
    this._setSelectedEvents([id], id);
    this._render();
    // 保存を待たずにオプションを開き、すぐ題名を入力できるようにする（操作から0.3秒以内）。
    // 保存中に押した「保存」「削除」は、作成の保存が終わるまで待ってから送る（_saveEventOptions / _deleteEventFromOptions）。
    this._showEventOptionsPanel(optimisticEvent, defaultStart, defaultEnd, defaultAllDay);
    // POSTがタイムアウトしても即座に楽観イベントを破棄しない。保存キュー側で
    // 確認・再試行まで行い、それでも失敗したら「未保存」として画面に保持する。
    const savedId = window.MeldexCalendarSaveQueue
      ? await window.MeldexCalendarSaveQueue.createWithConfirm(this, id, payload)
      : await this._createEventQuickFallback(id, payload);
    const local = savedId ? (this._events || []).find(e => e.id === savedId) : null;
    // 未保存（裏で再試行中）の予定は保存が確定していないので履歴に残さない。
    if (savedId && !window.MeldexCalendarSaveQueue?.isPendingEvent?.(local)) undo.commit();
    else undo.cancel();
    if (!savedId) {
      // 作成を取りやめた予定のオプションが開いたままなら、その旨に差し替える（消えた予定へ保存させない）。
      const openTitle = Array.from(document.querySelectorAll('[data-cal-event-title]')).find(el => el._calEventDraftOwner?.eventId === id);
      const openBody = openTitle?._calEventDraftOwner?.body;
      if (openBody) openBody.innerHTML = '<div class="cal-option-empty">イベントを追加できませんでした</div>';
      return '';
    }
    await this._loadEvents();
    this._render();
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
    const ev = this._events.find(e => e.id === editId && (!defaultStart || e.start === defaultStart));
    if (!ev) return;
    if (ev._recurrence_instance) return this._showRecurringOccurrenceEditor(ev);
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

  CalendarComponent.prototype._showRecurringOccurrenceEditor = async function(ev) {
    const userError = message => Object.assign(new Error(message), { userMessage: message, calendarOccurrenceLocal: true });
    const contextKey = () => {
      const runtime = window.MeldexRuntimeAdapter;
      const ws = runtime?.getWorkspaceState?.() || {};
      return JSON.stringify([this._getUser(), typeof state === 'undefined' ? '' : state.vaultPath || '',
        runtime?.getMode?.() || '', window.MeldexWorkspaces?.getActiveId?.() || ws.workspaceId || ws.workspace_id || '',
        ws.path || ws.folder || '', ws.access || ws.role || '', ws.accountId || ws.account_id || '',
        ws.securityScopeId || ws.security_scope_id || '']);
    };
    const openedContext = contextKey();
    const assertContext = () => {
      if (this._destroyed || openedContext !== contextKey()) throw userError('保存先または利用者が切り替わりました。現在の画面から開き直してください');
    };
    let current;
    try {
      current = await apiFetch('/cal/history/event/' + encodeURIComponent(ev.id));
      assertContext();
      if (!current.current || !ev._calendar_revision || current.currentRevision !== ev._calendar_revision) {
        throw userError('表示後に予定が変更されています。カレンダーを再読み込みしてから開き直してください');
      }
    } catch (error) {
      this._showStatus(error?.calendarOccurrenceLocal ? error.userMessage : 'この回の現在の予定を読み込めませんでした。少し待ってから開き直してください', true);
      return null;
    }
    const rule = typeof current.current.recurrence === 'string' ? JSON.parse(current.current.recurrence) : structuredClone(current.current.recurrence);
    const originalAt = new Date(ev.original_start || ev.start);
    const pad = n => String(n).padStart(2, '0');
    const key = `${originalAt.getFullYear()}-${pad(originalAt.getMonth() + 1)}-${pad(originalAt.getDate())}T${pad(originalAt.getHours())}:${pad(originalAt.getMinutes())}`;
    const body = document.createElement('div');
    body.className = 'gb-scheduler-allocation-form gb-scheduler-occurrence-form';
    const explanation = document.createElement('p');
    explanation.className = 'gb-section-desc';
    explanation.textContent = 'この回だけを変更します。ほかの回の日時や内容は変わりません。';
    body.appendChild(explanation);
    const inputs = {};
    const add = (name, label, type, value, draftAttribute) => {
      const field = document.createElement('label'); field.className = 'gb-scheduler-field';
      const caption = document.createElement('span'); caption.textContent = label;
      const input = document.createElement(type === 'textarea' ? 'textarea' : 'input');
      if (type !== 'textarea') input.type = type;
      input.className = 'gb-input'; input.value = value || ''; input.dataset.e2eId = 'calendar-occurrence-' + name;
      input.setAttribute('aria-label', label); input.setAttribute(draftAttribute, '');
      field.append(caption, input); body.appendChild(field); inputs[name] = input;
    };
    const day = !!ev.all_day;
    add('title', '予定名', 'text', ev.title, 'data-cal-event-title');
    add('start', '開始', day ? 'date' : 'datetime-local', day ? _calLocalDateInputValue(this, ev.start) : _calLocalInputValue(this, ev.start), 'data-cal-event-start');
    add('end', '終了', day ? 'date' : 'datetime-local', day ? _calLocalDateInputValue(this, ev.end) : _calLocalInputValue(this, ev.end), 'data-cal-event-end');
    add('location', '場所', 'text', ev.location, 'data-cal-event-location');
    add('description', '説明', 'textarea', ev.description, 'data-cal-event-desc');
    const initialValues = Object.fromEntries(Object.entries(inputs).map(([name, input]) => [name, input.value]));
    const draftId = ev.id + '@' + key + '@' + openedContext;
    this._bindEventOptionDraft(body, { id: draftId });
    body.querySelector('[data-e2e-id="calendar-event-draft-discard"]')?.addEventListener('click', () => {
      Object.entries(inputs).forEach(([name, input]) => { input.value = initialValues[name]; });
      body._calEventDraftOwner.dirty = false;
      body.querySelector('.cal-option-draft-notice')?.remove();
    });
    let saving = false, feedback = null, expectedRevision = current.currentRevision;
    const modal = window.GBUI.createModal({ title: '繰り返し予定のこの回を変更', body,
      variant: innerWidth <= 700 ? 'mobile-sheet' : 'standard', extraClass: 'gb-scheduler-modal',
      onBeforeClose: () => { if (saving) return false; _calEventDraftStashOpenBodies(); return true; } });
    modal.modal.dataset.e2eId = 'calendar-occurrence-dialog';
    const makeButton = (text, name, primary = false) => {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = text;
      button.className = 'gb-btn gb-btn-sm gb-scheduler-button' + (primary ? ' gb-btn-primary' : '');
      button.dataset.e2eId = 'calendar-occurrence-' + name; return button;
    };
    const close = makeButton('閉じる', 'close');
    close.addEventListener('click', () => modal.close('cancel'));
    const save = makeButton('この回を保存', 'save', true);
    const write = async nextRule => {
      assertContext();
      this._loadEventsSeq = (this._loadEventsSeq || 0) + 1;
      const result = await apiPut('/cal/events/' + encodeURIComponent(ev.id), { recurrence: JSON.stringify(nextRule), expectedRevision });
      assertContext();
      if (!result.revision) throw userError('予定は保存しましたが、保存した版を確認できません。現在の予定を開き直してください');
      expectedRevision = result.revision;
      try { await this._loadEvents(); this._render(); }
      catch { return { historyWarning: '予定は保存しましたが、表示を更新できませんでした。カレンダーを再読み込みしてください' }; }
      return true;
    };
    const submit = async () => {
      if (saving) return;
      let reservation = null;
      try {
        assertContext();
        const start = inputs.start.value, end = inputs.end.value;
        if (!inputs.title.value.trim() || !start || !end || (day ? end < start : new Date(end) <= new Date(start))) {
          throw userError('予定名と開始・終了を確認してください。終了は開始より後にしてください');
        }
        const after = structuredClone(rule);
        after.overrides = { ...(rule.overrides || {}), [key]: {
          title: inputs.title.value, start, end, location: inputs.location.value, description: inputs.description.value,
        } };
        saving = true; save.disabled = close.disabled = true;
        reservation = this._reserveUndo('繰り返し予定の一回変更', { undo: () => write(rule), redo: () => write(after) });
        const outcome = await write(after);
        reservation.commit();
        _calEventDraftClear(this, draftId, body._calEventDraftOwner.draftKey); body._calEventDraftOwner.dirty = false;
        saving = false; modal.close('saved');
        this._showStatus(outcome?.historyWarning || 'この回の予定を保存しました', !!outcome?.historyWarning);
      } catch (error) {
        reservation?.cancel();
        const message = Number(error?.status) === 409 ? '別の環境で予定が更新されています。入力を残して閉じ、カレンダーを再読み込みして確認してください'
          : error?.calendarOccurrenceLocal ? error.userMessage : 'この回の予定を保存できませんでした。入力は残っています。少し待って再試行してください';
        if (!feedback) {
          feedback = window.GBUI.createInlineError({ message, onRetry: submit });
          feedback.dataset.e2eId = 'calendar-occurrence-error';
          body.insertBefore(feedback, inputs.title.closest('label'));
        }
        else feedback.setMessage(message);
        feedback.title = String(error?.message || '');
        modal.body.scrollTop = 0;
      } finally { saving = false; save.disabled = close.disabled = false; }
    };
    save.addEventListener('click', submit);
    modal.footer.append(close, save); modal.modal.appendChild(modal.footer); modal.open();
    return modal;
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
    this._bindEventOptionDraft(body, ev);
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
    // 作成の保存がまだ終わっていない予定は、作成の保存（保存キューの順番）が済んでから更新する。
    if (window.MeldexCalendarSaveQueue?.isPendingEvent?.(evRef) && typeof window.MeldexCalendarSaveQueue.enqueue === 'function') {
      this._savingEventIds.add(editId);
      try { await window.MeldexCalendarSaveQueue.enqueue(() => null); } finally { this._savingEventIds.delete(editId); }
    }
    // 取り消しの履歴の枠は操作の時点で取り、保存が成功した時だけ中身を入れる（失敗した操作の偽履歴は残さない）
    const undo = this._reserveUndo('イベント編集');
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
    // 編集前に始まった読取応答で、保存後の値やRedo用の写しを巻き戻さない。
    this._loadEventsSeq = (this._loadEventsSeq || 0) + 1;
    this._events = (this._events || []).map(event => (event.id === editId ? { ...event, ...data } : event));
    this._renderCalendarList?.();
    this._render();
    this._savingEventIds.add(editId);
    if (this.el) {
      this.el.dataset.eventSaveState = 'pending';
      this.el.dataset.eventSaveMessage = '';
    }
    try {
      // 同じ予定への移動・伸縮の保存と順番を守る（予定ごとに直列）。30秒終わらない保存は自己記録へ残す。
      if (typeof window._calSerialEventPut === 'function') {
        await window._calSerialEventPut(editId, data, 'event-save');
      } else {
        const savePromise = apiPut('/cal/events/' + editId, data);
        await (window.MeldexDiagnostics?.watchScheduleTask?.('event-save', savePromise) ?? savePromise);
      }
      undo.commit();
      if (this.el) this.el.dataset.eventSaveState = 'saved';
      _calEventDraftClear(this, editId);
      if (body._calEventDraftOwner) body._calEventDraftOwner.dirty = false;
      this._showStatus('イベントを保存しました');
      this._loadEvents?.().then(() => this._render()).catch(() => {});
    } catch (error) {
      undo.cancel();
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
    const isShift = source === 'shift' || source === 'shift-break' || String(id || '').startsWith('shift:');
    // 通常イベントは即時削除＋Undoとする。Undo対象外のシフトと、1件の表示から
    // シリーズ全体へ作用する繰り返し予定だけは、不可逆・広域操作として確認を残す。
    if ((isShift || evRef?._recurrence_instance) && typeof cfConfirm === 'function') {
      const confirmText = evRef?._recurrence_instance
        ? 'これは繰り返しの予定です。繰り返しの予定全体を削除しますか？'
        : 'このシフトを削除しますか？';
      if (!await cfConfirm(confirmText)) return;
    }
    // 作成の保存がまだ終わっていない予定は、作成の保存（保存キューの順番）が済んでから消す。
    if (!isShift && window.MeldexCalendarSaveQueue?.isPendingEvent?.(evRef) && typeof window.MeldexCalendarSaveQueue.enqueue === 'function') {
      await window.MeldexCalendarSaveQueue.enqueue(() => null);
    }
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
    const undoable = !isShift && this._eventIsUndoable?.(evRef);
    // 取り消しの履歴の枠は操作の時点で取り、削除が成功した時だけ中身を入れる。
    const undo = undoable ? this._reserveUndo('イベント削除') : null;
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
        : await (() => {
          const deletePromise = apiFetch('/cal/events/' + encodeURIComponent(id), { method: 'DELETE' });
          return window.MeldexDiagnostics?.watchScheduleTask?.('event-delete', deletePromise) ?? deletePromise;
        })();
      if (result && result.ok === false) throw new Error(result.message || '削除に失敗');
      acknowledged = true;
      _calEventDraftClear(this, id);
      undo?.commit();
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
      if (!acknowledged) undo?.cancel();
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
