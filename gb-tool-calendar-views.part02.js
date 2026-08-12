
CalendarComponent.prototype._saveTask = async function(editId, overlay) {
  this._pushUndo(editId ? 'ToDo編集' : 'ToDo作成');
  const o = overlay;
  const data = {
    title: o.querySelector('.tk-title').value, status: o.querySelector('.tk-status').value,
    priority: o.querySelector('.tk-priority').value, due_date: o.querySelector('.tk-due').value,
    assignee: o.querySelector('.tk-assignee').value,
    estimated_hours: parseFloat(o.querySelector('.tk-est').value) || 0,
    actual_hours: parseFloat(o.querySelector('.tk-act').value) || 0,
    description: o.querySelector('.tk-desc').value, user: this._getUser(),
  };
  o.remove();
  try {
    if (editId) await apiPut('/cal/tasks/' + editId, data); else await apiPost('/cal/tasks', data);
    await this._loadTasks(); this._render(); this._renderTodayTasks();
    this._showStatus('ToDoを保存しました');
  } catch { this._showStatus('保存に失敗', true); }
};

CalendarComponent.prototype._deleteTask = async function(id) {
  if (typeof cfConfirm === 'function' && !await cfConfirm('このToDoを削除しますか？')) return false;
  this._pushUndo('ToDo削除');
  try {
    await apiFetch('/cal/tasks/' + id, { method: 'DELETE' });
    await this._loadTasks();
    this._render();
    this._renderTodayTasks();
    this._showStatus('削除しました');
    return true;
  } catch {
    return false;
  }
};

function _gbCalTransitionDialog(modalApi, reason, openNext) {
  if (!modalApi?.close?.(reason)) return false;
  const continueAfterRemoval = () => {
    if (modalApi.overlay?.isConnected) {
      setTimeout(continueAfterRemoval, 40);
      return;
    }
    openNext?.();
  };
  continueAfterRemoval();
  return true;
}

// === シフトモーダル ===
CalendarComponent.prototype._showShiftModal = function(user, date, editId) {
  const existing = editId ? this._shifts.find(s => s.id === editId) : null;
  const shiftType = existing?.type || 'work';
  const shiftDate = existing?.date || date || this._localDateStr(this._date);
  const startValue = shiftType === 'work' ? (existing?.start_time || '09:00') : '';
  const endValue = shiftType === 'work' ? (existing?.end_time || '18:00') : '';
  const shiftId = editId || this._newShiftId?.() || ('shift_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8));
  const content = document.createElement('div');
  content.innerHTML = `<div id="sh-status" role="status" aria-live="polite"></div>
<div class="field"><label>ユーザー</label><input id="sh-user" class="sh-user" list="sh-user-candidates" value="${esc(user||existing?.user||this._getUser())}"><datalist id="sh-user-candidates"></datalist></div>
<div class="field"><label>日付</label><input id="sh-date" class="sh-date" type="date" value="${shiftDate}"></div>
<div style="display:flex;gap:8px;"><div class="field" style="flex:1;"><label>開始</label><input id="sh-start" class="sh-start" type="time" value="${startValue}"></div>
<div class="field" style="flex:1;"><label>終了</label><input id="sh-end" class="sh-end" type="time" value="${endValue}"></div></div>
<div class="field"><label>種別</label><select id="sh-type" class="sh-type"><option value="work" ${shiftType==='work'?'selected':''}>勤務</option><option value="off" ${shiftType==='off'?'selected':''}>休み</option><option value="holiday" ${shiftType==='holiday'?'selected':''}>祝日</option></select></div>
<div class="field"><label>メモ</label><textarea id="sh-note" class="sh-note" rows="3">${esc(existing?.note||'')}</textarea></div>`;
  const cancelButton = document.createElement('button');
  cancelButton.type = 'button'; cancelButton.id = 'sh-cancel'; cancelButton.className = 'sh-cancel gb-btn gb-btn-sm'; cancelButton.textContent = 'キャンセル';
  const saveButton = document.createElement('button');
  saveButton.type = 'button'; saveButton.id = 'sh-save'; saveButton.className = 'sh-save gb-btn gb-btn-sm gb-btn-primary primary'; saveButton.textContent = '保存';
  const deleteButton = existing ? document.createElement('button') : null;
  if (deleteButton) {
    deleteButton.type = 'button'; deleteButton.id = 'sh-delete'; deleteButton.className = 'sh-delete gb-btn gb-btn-sm gb-btn-danger danger'; deleteButton.textContent = '削除';
  }
  let busy = false, deleteConfirmPending = false;
  const modalApi = window.GBUI.createModal({
    id: 'calendar-tool-shift', title: existing ? 'シフト編集' : '新規シフト', body: [...content.childNodes],
    footer: [deleteButton, cancelButton, saveButton].filter(Boolean), variant: 'standard', geometryKey: 'calendar-tool-shift',
    minWidth: '0', initialFocus: '#sh-user', closeLabel: 'シフト編集を閉じる', closeOnEsc: true, closeOnOverlay: true,
    onBeforeClose: () => !busy,
  });
  const o = modalApi.overlay, panel = modalApi.modal, status = panel.querySelector('#sh-status');
  o.classList.add('gb-cal-modal-overlay'); o.dataset.e2eId = 'calendar-tool-shift-overlay'; o._calendarClose = modalApi.close;
  panel.classList.add('gb-cal-modal'); panel.dataset.e2eId = 'calendar-tool-shift-dialog'; panel.style.cssText = _gbCalModalSizeStyle(350, 'overflow:hidden;');
  const setBusy = (next) => {
    busy = next; panel.setAttribute('aria-busy', next ? 'true' : 'false');
    [saveButton, deleteButton].filter(Boolean).forEach(button => { button.disabled = next; });
  };
  modalApi.open();
  this._fillShiftUserCandidates?.(panel);
  const syncTimeState = () => {
    const isWork = o.querySelector('.sh-type')?.value === 'work';
    const start = o.querySelector('.sh-start');
    const end = o.querySelector('.sh-end');
    if (!start || !end) return;
    start.disabled = end.disabled = !isWork;
    start.style.opacity = end.style.opacity = isWork ? '1' : '0.45';
    if (isWork) {
      if (!start.value) start.value = '09:00';
      if (!end.value) end.value = '18:00';
    } else {
      start.value = '';
      end.value = '';
    }
  };
  panel.querySelector('.sh-type')?.addEventListener('change', syncTimeState);
  syncTimeState();
  saveButton.addEventListener('click', async () => {
    if (busy) return;
    if (!panel.querySelector('.sh-date')?.value) {
      await this._saveShift(editId, panel, shiftId);
      status.textContent = '日付を入力してください。';
      return;
    }
    setBusy(true); status.textContent = '保存中...';
    const saved = await this._saveShift(editId, panel, shiftId);
    if (saved) { setBusy(false); modalApi.close('saved'); return; }
    status.textContent = '保存に失敗しました。入力内容を保ったまま再試行できます。';
    if (modalApi.isOpen()) setBusy(false);
  });
  cancelButton.addEventListener('click', () => modalApi.close('cancel'));
  deleteButton?.addEventListener('click', async () => {
    if (busy || deleteConfirmPending) return;
    deleteConfirmPending = true;
    let confirmed = false;
    try { confirmed = typeof cfConfirm !== 'function' || await cfConfirm('このシフトを削除しますか？'); }
    catch {} finally { deleteConfirmPending = false; }
    if (!confirmed) return;
    setBusy(true); status.textContent = '削除中...';
    const deleted = await this._deleteShift(existing.id, { skipConfirm: true });
    if (deleted) { setBusy(false); modalApi.close('deleted'); return; }
    status.textContent = '削除に失敗しました。もう一度お試しください。';
    if (modalApi.isOpen()) setBusy(false);
  });
};

// シフトモーダルの「ユーザー」欄へ、正本スタッフ管理シート＋ワークスペースメンバーの
// 候補を <datalist> サジェストとして流し込む（表記ゆれ対策）。あくまで補助であり、
// 入力欄自体は free-text のまま（正本に無い未連携の人物も従来どおり直接入力できる）。
CalendarComponent.prototype._fillShiftUserCandidates = async function(o) {
  try {
    const datalist = o.querySelector('#sh-user-candidates');
    if (!datalist || typeof window.MeldexUserPicker?.getCandidates !== 'function') return;
    const candidates = await window.MeldexUserPicker.getCandidates();
    if (!datalist.isConnected) return; // 取得中にモーダルが閉じられていたら反映しない
    datalist.textContent = '';
    (candidates || []).forEach((c) => {
      const name = String(c?.name || '').trim();
      if (!name) return;
      const opt = document.createElement('option');
      opt.value = name;
      datalist.appendChild(opt);
    });
  } catch (e) {
    console.warn('シフトのユーザー候補取得に失敗しました', e);
  }
};

CalendarComponent.prototype._saveShift = async function(editId, o, fixedShiftId) {
  const type = o.querySelector('.sh-type').value;
  const date = o.querySelector('.sh-date').value;
  if (!date) {
    this._showStatus('日付を入力してください', true);
    o.querySelector('.sh-date')?.focus();
    return false;
  }
  const data = {
    user: o.querySelector('.sh-user').value.trim() || this._getUser(),
    date,
    start_time: type === 'work' ? (o.querySelector('.sh-start').value || '09:00') : '',
    end_time: type === 'work' ? (o.querySelector('.sh-end').value || '18:00') : '',
    type,
    note: o.querySelector('.sh-note').value,
  };
  const shiftId = editId || fixedShiftId || this._newShiftId?.() || ('shift_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8));
  const snapshot = this._shiftMutationSnapshot?.();
  if (typeof this._upsertShiftOptimistic === 'function') {
    this._upsertShiftOptimistic({ id: shiftId, ...data, _optimistic: true }, { select: true });
    this._renderCalendarList?.();
    this._render();
  }
  try {
    if (editId) await apiPut('/cal/shifts/' + encodeURIComponent(editId), data);
    else await apiPost('/cal/shifts', { id: shiftId, ...data });
    if (typeof this._upsertShiftOptimistic === 'function') {
      this._upsertShiftOptimistic({ id: shiftId, ...data, _optimistic: false }, { select: true });
      this._renderCalendarList?.();
      this._render();
      this._refreshShiftStateAfterMutation?.();
    } else {
      await Promise.all([this._loadShifts(), this._loadEvents(), this._loadCalendars()]);
      this._renderCalendarList?.();
      this._render();
    }
    this._showStatus('シフトを保存しました');
    return true;
  } catch {
    if (snapshot && typeof this._restoreShiftMutationSnapshot === 'function') this._restoreShiftMutationSnapshot(snapshot);
    this._showStatus('保存に失敗', true);
    return false;
  }
};

CalendarComponent.prototype._deleteShift = async function(id, options = {}) {
  if (!options.skipConfirm && typeof cfConfirm === 'function' && !await cfConfirm('このシフトを削除しますか？')) return false;
  const snapshot = this._shiftMutationSnapshot?.();
  if (typeof this._removeShiftOptimistic === 'function') {
    this._removeShiftOptimistic(id);
    this._renderCalendarList?.();
    this._render();
    try {
      await apiFetch('/cal/shifts/' + encodeURIComponent(id), { method: 'DELETE' });
      this._refreshShiftStateAfterMutation?.();
      this._showStatus('削除しました');
      return true;
    } catch {
      if (snapshot && typeof this._restoreShiftMutationSnapshot === 'function') this._restoreShiftMutationSnapshot(snapshot);
      this._showStatus('削除に失敗', true);
      return false;
    }
  }
  try {
    await apiFetch('/cal/shifts/' + encodeURIComponent(id), { method: 'DELETE' });
    await Promise.all([this._loadShifts(), this._loadEvents(), this._loadCalendars()]);
    this._renderCalendarList?.();
    this._render();
    this._showStatus('削除しました');
    return true;
  } catch {
    return false;
  }
};

// === テンプレートモーダル ===
CalendarComponent.prototype._showScheduleTemplateModal = async function(returnFocus) {
  const owner = returnFocus?.focus ? returnFocus : document.activeElement;
  let allTemplates = [], templates = [];
  const dl = ['日','月','火','水','木','金','土'];
  const addMin = (ts, min) => {
    const match = /^(\d{1,2}):(\d{2})$/.exec(String(ts || ''));
    if (!match) return '--:--';
    const duration = parseInt(min, 10);
    if (!Number.isFinite(duration)) return '--:--';
    const t = parseInt(match[1], 10) * 60 + parseInt(match[2], 10) + duration;
    return String(Math.floor(((t % 1440) + 1440) % 1440 / 60)).padStart(2,'0')+':'+String(((t % 60) + 60) % 60).padStart(2,'0');
  };
  const content = document.createElement('div');
  content.innerHTML = '<div id="tmpl-status" role="status" aria-live="polite"></div><div id="tmpl-list" class="tmpl-list"></div>';
  const createButton = document.createElement('button');
  createButton.type = 'button'; createButton.id = 'tmpl-create'; createButton.className = 'tmpl-create gb-btn gb-btn-sm'; createButton.textContent = '新規テンプレート';
  const closeButton = document.createElement('button');
  closeButton.type = 'button'; closeButton.id = 'tmpl-close'; closeButton.className = 'tmpl-close gb-btn gb-btn-sm'; closeButton.textContent = '閉じる';
  let busy = false, deleteConfirmPending = false;
  const modalApi = window.GBUI.createModal({
    id: 'calendar-tool-template-list', title: '週間テンプレート', body: [...content.childNodes], footer: [createButton, closeButton],
    variant: 'standard', geometryKey: 'calendar-tool-template-list', minWidth: '0', initialFocus: '#tmpl-create', returnFocus: owner,
    closeLabel: '週間テンプレートを閉じる', closeOnEsc: true, closeOnOverlay: true, onBeforeClose: () => !busy,
  });
  const o = modalApi.overlay, panel = modalApi.modal, list = panel.querySelector('#tmpl-list'), status = panel.querySelector('#tmpl-status');
  o.classList.add('gb-cal-modal-overlay'); o.dataset.e2eId = 'calendar-tool-template-list-overlay'; o._calendarClose = modalApi.close;
  panel.classList.add('gb-cal-modal'); panel.dataset.e2eId = 'calendar-tool-template-list-dialog'; panel.style.cssText = _gbCalModalSizeStyle(600, 'overflow:hidden;');
  const setBusy = (next) => {
    busy = next; panel.setAttribute('aria-busy', next ? 'true' : 'false');
    panel.querySelectorAll('button').forEach(button => { if (button !== closeButton) button.disabled = next; });
  };
  let firstLoad = true;
  const render = () => {
    if (!templates.length) {
      list.innerHTML = '<div style="color:var(--cal-muted-fg, var(--fg2));font-size:12px;padding:8px;">テンプレートがありません</div>';
      return;
    }
    list.innerHTML = templates.map(t => {
      const entries = (t.entries || []).map(e => `<div style="font-size:11px;color:var(--cal-muted-fg, var(--fg2));padding:1px 0;">${esc(dl[e.dayOfWeek] || '')} ${esc(e.startTime || '')}〜${esc(addMin(e.startTime,e.duration))} ${esc(e.title || '')}</div>`).join('');
      return `<div style="border:1px solid var(--cal-grid-line, var(--border));background:var(--cal-panel-bg, transparent);border-radius:4px;padding:8px;margin-bottom:8px;"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;"><strong>${esc(t.name)}</strong><div><button type="button" class="tmpl-edit gb-btn gb-btn-sm" data-action="edit" data-tid="${esc(t.id)}">編集</button><button type="button" class="tmpl-del gb-btn gb-btn-sm" data-action="delete" data-tid="${esc(t.id)}" style="color:var(--red);">削除</button><button type="button" class="tmpl-gen gb-btn gb-btn-sm gb-btn-primary primary" data-action="generate" data-tid="${esc(t.id)}">一括生成</button></div></div>${entries}</div>`;
    }).join('');
  };
  const loadTemplates = async () => {
    createButton.disabled = true; status.textContent = '読み込み中...';
    try {
      allTemplates = await apiFetch('/cal/schedule-templates?user=' + encodeURIComponent(this._getUser()));
      templates = (allTemplates || []).filter(template => !(typeof this._isShiftScheduleTemplate === 'function' && this._isShiftScheduleTemplate(template)));
      status.textContent = ''; render();
    } catch {
      status.innerHTML = 'テンプレートを読み込めませんでした。<button id="tmpl-retry" type="button">再試行</button>';
      status.querySelector('#tmpl-retry')?.addEventListener('click', loadTemplates);
    } finally {
      createButton.disabled = false;
      if (firstLoad && modalApi.isOpen() && (document.activeElement === panel || !panel.contains(document.activeElement))) {
        try { createButton.focus({ preventScroll: true }); } catch { createButton.focus(); }
      }
      firstLoad = false;
    }
  };
  modalApi.open();
  closeButton.addEventListener('click', () => modalApi.close('close-button'));
  createButton.addEventListener('click', async () => {
    if (busy) return;
    setBusy(true); status.textContent = '作成中...';
    try {
      const id = await this._createTemplate(allTemplates);
      setBusy(false); _gbCalTransitionDialog(modalApi, 'created', () => this._editTemplate(id, owner));
    } catch {
      status.textContent = '作成に失敗しました。もう一度お試しください。';
      if (modalApi.isOpen()) setBusy(false);
    }
  });
  list.addEventListener('click', async event => {
    const button = event.target.closest('button[data-action]');
    if (!button || busy) return;
    const action = button.dataset.action, tid = button.dataset.tid;
    if (action === 'edit') { _gbCalTransitionDialog(modalApi, 'edit', () => this._editTemplate(tid, owner)); return; }
    if (action === 'delete') {
      if (deleteConfirmPending) return;
      deleteConfirmPending = true;
      let confirmed = false;
      try { confirmed = typeof cfConfirm !== 'function' || await cfConfirm('このテンプレートを削除しますか？'); }
      catch {} finally { deleteConfirmPending = false; }
      if (!confirmed) return;
      setBusy(true); status.textContent = '削除中...';
      try {
        await apiFetch('/cal/schedule-templates/' + encodeURIComponent(tid), { method: 'DELETE' });
        templates = templates.filter(template => String(template.id) !== String(tid)); status.textContent = ''; render();
      } catch { status.textContent = '削除に失敗しました。もう一度お試しください。'; }
      finally { if (modalApi.isOpen()) setBusy(false); }
      return;
    }
    if (action === 'generate') {
      setBusy(true);
      try {
        const generated = await this._generateFromTemplate(tid, null);
        if (generated) { setBusy(false); modalApi.close('generated'); }
      }
      finally { if (modalApi.isOpen()) setBusy(false); }
    }
  });
  await loadTemplates();
};

CalendarComponent.prototype._createTemplate = async function(knownTemplates) {
  const templates = Array.isArray(knownTemplates) ? knownTemplates : await apiFetch('/cal/schedule-templates?user=' + encodeURIComponent(this._getUser()));
  let idx = 1, name = '無題'; const names = templates.map(t => t.name);
  while (names.includes(name)) { idx++; name = '無題' + idx; }
  const res = await apiPost('/cal/schedule-templates', { name, entries: [], user: this._getUser() });
  return res.id;
};

CalendarComponent.prototype._editTemplate = async function(tid, returnFocus) {
  const owner = returnFocus?.focus ? returnFocus : document.activeElement;
  let templates = [];
  try { templates = await apiFetch('/cal/schedule-templates?user=' + encodeURIComponent(this._getUser())); }
  catch { this._showStatus('テンプレートの読み込みに失敗しました', true); this._showScheduleTemplateModal(owner); return; }
  const t = templates.find(x => String(x.id) === String(tid));
  if (!t) { this._showStatus('テンプレートが見つかりません', true); this._showScheduleTemplateModal(owner); return; }
  const dl = ['日','月','火','水','木','金','土'];
  const entryRow = (e) => `<div class="tmpl-entry" style="display:flex;gap:4px;align-items:center;margin-bottom:4px;font-size:12px;">
    <select data-field="dayOfWeek" class="gb-select gb-select-sm">${dl.map((d,i)=>`<option value="${i}" ${(e?.dayOfWeek??0)===i?'selected':''}>${d}</option>`).join('')}</select>
    <input type="time" data-field="startTime" value="${esc(e?.startTime||'09:00')}" style="padding:2px;background:var(--cal-input-bg, var(--bg));color:var(--cal-input-fg, var(--fg));border:1px solid var(--cal-control-border, var(--border));border-radius:3px;">
    <input type="number" data-field="duration" value="${esc(e?.duration||60)}" min="5" step="5" style="width:60px;padding:2px;background:var(--cal-input-bg, var(--bg));color:var(--cal-input-fg, var(--fg));border:1px solid var(--cal-control-border, var(--border));border-radius:3px;" title="分"><span style="color:var(--cal-muted-fg, var(--fg2));">分</span>
    <input type="text" data-field="title" value="${esc(e?.title||'')}" placeholder="タイトル" style="flex:1;padding:2px 4px;background:var(--cal-input-bg, var(--bg));color:var(--cal-input-fg, var(--fg));border:1px solid var(--cal-control-border, var(--border));border-radius:3px;">
    <button type="button" class="tmpl-entry-del" aria-label="エントリを削除" style="background:none;border:none;color:var(--red);cursor:pointer;display:flex;align-items:center;">${lucide('x', 14)}</button></div>`;
  let entriesHtml = (t.entries||[]).map(e => entryRow(e)).join('');
  const content = document.createElement('div');
  content.innerHTML = `<div id="tmpl-edit-status" role="status" aria-live="polite"></div>
    <div class="field"><label>名前</label><input id="tmpl-name" class="tmpl-name" type="text" value="${esc(t.name)}"></div>
    <div style="font-size:12px;color:var(--cal-muted-fg, var(--fg2));margin-bottom:4px;">エントリ（1週間分）</div>
    <div id="tmpl-entries" class="tmpl-entries">${entriesHtml}</div>
    <button id="tmpl-add-entry" type="button" class="tmpl-add-entry gb-btn gb-btn-sm">+ エントリ追加</button>`;
  const cancelButton = document.createElement('button');
  cancelButton.type = 'button'; cancelButton.id = 'tmpl-edit-cancel'; cancelButton.className = 'tmpl-edit-cancel gb-btn gb-btn-sm'; cancelButton.textContent = 'キャンセル';
  const saveButton = document.createElement('button');
  saveButton.type = 'button'; saveButton.id = 'tmpl-edit-save'; saveButton.className = 'tmpl-edit-save gb-btn gb-btn-sm gb-btn-primary primary'; saveButton.textContent = '保存';
  let busy = false;
  const modalApi = window.GBUI.createModal({
    id: 'calendar-tool-template-edit', title: `テンプレート編集: ${t.name}`, body: [...content.childNodes], footer: [cancelButton, saveButton],
    variant: 'standard', geometryKey: 'calendar-tool-template-edit', minWidth: '0', initialFocus: '#tmpl-name', returnFocus: owner,
    closeLabel: 'テンプレート編集を閉じる', closeOnEsc: true, closeOnOverlay: true, onBeforeClose: () => !busy,
  });
  const o = modalApi.overlay, panel = modalApi.modal, status = panel.querySelector('#tmpl-edit-status');
  o.classList.add('gb-cal-modal-overlay'); o.dataset.e2eId = 'calendar-tool-template-edit-overlay'; o._calendarClose = modalApi.close;
  panel.classList.add('gb-cal-modal'); panel.dataset.e2eId = 'calendar-tool-template-edit-dialog'; panel.style.cssText = _gbCalModalSizeStyle(550, 'overflow:hidden;');
  const setBusy = (next) => {
    busy = next; panel.setAttribute('aria-busy', next ? 'true' : 'false');
    [saveButton, panel.querySelector('#tmpl-add-entry')].forEach(button => { if (button) button.disabled = next; });
  };
  modalApi.open();
  panel.querySelector('#tmpl-add-entry').addEventListener('click', () => {
    panel.querySelector('#tmpl-entries').insertAdjacentHTML('beforeend', entryRow({}));
  });
  panel.querySelector('#tmpl-entries').addEventListener('click', event => {
    const button = event.target.closest('.tmpl-entry-del');
    if (button && !busy) button.closest('.tmpl-entry')?.remove();
  });
  cancelButton.addEventListener('click', () => {
    _gbCalTransitionDialog(modalApi, 'cancel', () => this._showScheduleTemplateModal(owner));
  });
  saveButton.addEventListener('click', async () => {
    if (busy) return;
    const name = panel.querySelector('.tmpl-name').value.trim() || '無題';
    const entries = [];
    panel.querySelectorAll('.tmpl-entries .tmpl-entry').forEach(row => {
      entries.push({ dayOfWeek: parseInt(row.querySelector('[data-field="dayOfWeek"]').value), startTime: row.querySelector('[data-field="startTime"]').value, duration: parseInt(row.querySelector('[data-field="duration"]').value) || 60, title: row.querySelector('[data-field="title"]').value.trim() });
    });
    setBusy(true); status.textContent = '保存中...';
    try {
      await apiPut('/cal/schedule-templates/' + encodeURIComponent(tid), { name, entries });
      this._showStatus('テンプレートを保存しました'); setBusy(false);
      _gbCalTransitionDialog(modalApi, 'saved', () => this._showScheduleTemplateModal(owner));
    } catch {
      status.textContent = '保存に失敗しました。入力内容を保ったまま再試行できます。'; this._showStatus('保存に失敗', true);
      if (modalApi.isOpen()) setBusy(false);
    }
  });
};

CalendarComponent.prototype._generateFromTemplate = async function(tid, overlay) {
  const templates = await apiFetch('/cal/schedule-templates?user=' + encodeURIComponent(this._getUser()));
  const t = templates.find(x => x.id === tid);
  if (!t || !t.entries?.length) { this._showStatus('エントリがありません', true); return false; }
  // cfPromptで週数を取得
  const weeksStr = await cfPrompt('何週間分生成しますか？', '4');
  const weeks = parseInt(weeksStr) || 0;
  if (weeks <= 0) return false;
  const entries = (t.entries || []).map(entry => {
    const match = /^(\d{1,2}):(\d{2})$/.exec(String(entry.startTime || ''));
    const dayOfWeek = parseInt(entry.dayOfWeek, 10);
    const duration = Math.max(5, parseInt(entry.duration, 10) || 60);
    if (!match || dayOfWeek < 0 || dayOfWeek > 6) return null;
    return {
      dayOfWeek,
      hour: parseInt(match[1], 10),
      minute: parseInt(match[2], 10),
      duration,
      title: entry.title || '無題',
    };
  });
  if (entries.some(entry => !entry)) {
    this._showStatus('テンプレートの時刻を確認してください', true);
    return false;
  }
  const startDate = new Date(this._date);
  startDate.setDate(startDate.getDate() - ((startDate.getDay() - this._startDay + 7) % 7));
  const calendarId = this._calendarIdForNewEvent();
  const createdIds = [];
  let count = 0;
  this._pushUndo('テンプレート一括生成');
  try {
    for (let w = 0; w < weeks; w++) {
      for (const entry of entries) {
        const d = new Date(startDate);
        d.setDate(d.getDate() + w * 7 + ((entry.dayOfWeek - this._startDay + 7) % 7));
        d.setHours(entry.hour, entry.minute, 0, 0);
        const endD = new Date(d.getTime() + entry.duration * 60000);
        const res = await apiPost('/cal/events', {
          title: entry.title,
          start: this._localDateTimeStr(d),
          end: this._localDateTimeStr(endD),
          calendar_id: calendarId,
          user: this._getUser(),
        });
        if (res?.id) createdIds.push(res.id);
        count++;
      }
    }
  } catch (e) {
    await Promise.all(createdIds.map(id => apiFetch('/cal/events/' + id, { method: 'DELETE' }).catch(() => {})));
    await this._loadEvents();
    this._render();
    this._showStatus('一括生成に失敗しました。作成済み分は取り消しました', true);
    return false;
  }
  if (typeof overlay?._calendarClose === 'function') overlay._calendarClose('generated');
  else overlay?.remove();
  await this._loadEvents(); this._render();
  this._showStatus(`${count}件のイベントを生成しました`);
  return true;
};
