
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

// === シフトモーダル ===
CalendarComponent.prototype._showShiftModal = function(user, date, editId) {
  const existing = editId ? this._shifts.find(s => s.id === editId) : null;
  const shiftType = existing?.type || 'work';
  const shiftDate = existing?.date || date || this._localDateStr(this._date);
  const startValue = shiftType === 'work' ? (existing?.start_time || '09:00') : '';
  const endValue = shiftType === 'work' ? (existing?.end_time || '18:00') : '';
  const o = document.createElement('div'); o.className = 'gb-cal-modal-overlay';
  o.innerHTML = `<div class="gb-cal-modal" style="min-width:350px;"><h3>${existing?'シフト編集':'新規シフト'}</h3>
<div class="field"><label>ユーザー</label><input class="sh-user" value="${esc(user||existing?.user||this._getUser())}"></div>
<div class="field"><label>日付</label><input class="sh-date" type="date" value="${shiftDate}"></div>
<div style="display:flex;gap:8px;"><div class="field" style="flex:1;"><label>開始</label><input class="sh-start" type="time" value="${startValue}"></div>
<div class="field" style="flex:1;"><label>終了</label><input class="sh-end" type="time" value="${endValue}"></div></div>
<div class="field"><label>種別</label><select class="sh-type"><option value="work" ${shiftType==='work'?'selected':''}>勤務</option><option value="off" ${shiftType==='off'?'selected':''}>休み</option><option value="holiday" ${shiftType==='holiday'?'selected':''}>祝日</option></select></div>
<div class="field"><label>メモ</label><textarea class="sh-note" rows="3">${esc(existing?.note||'')}</textarea></div>
<div class="btn-row">${existing?'<button class="sh-delete" style="color:var(--red);">削除</button>':''}<button class="sh-cancel">キャンセル</button><button class="primary sh-save">保存</button></div></div>`;
  document.body.appendChild(o);
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
  o.querySelector('.sh-type')?.addEventListener('change', syncTimeState);
  syncTimeState();
  o.querySelector('.sh-save').addEventListener('click', () => this._saveShift(editId, o));
  o.querySelector('.sh-cancel').addEventListener('click', () => o.remove());
  if (existing) {
    o.querySelector('.sh-delete').addEventListener('click', async () => {
      if (await this._deleteShift(existing.id)) o.remove();
    });
  }
};

CalendarComponent.prototype._saveShift = async function(editId, o) {
  const type = o.querySelector('.sh-type').value;
  const date = o.querySelector('.sh-date').value;
  if (!date) {
    this._showStatus('日付を入力してください', true);
    o.querySelector('.sh-date')?.focus();
    return;
  }
  const data = {
    user: o.querySelector('.sh-user').value.trim() || this._getUser(),
    date,
    start_time: type === 'work' ? (o.querySelector('.sh-start').value || '09:00') : '',
    end_time: type === 'work' ? (o.querySelector('.sh-end').value || '18:00') : '',
    type,
    note: o.querySelector('.sh-note').value,
  };
  const shiftId = editId || this._newShiftId?.() || ('shift_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8));
  const snapshot = this._shiftMutationSnapshot?.();
  o.remove();
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
  } catch {
    if (snapshot && typeof this._restoreShiftMutationSnapshot === 'function') this._restoreShiftMutationSnapshot(snapshot);
    this._showStatus('保存に失敗', true);
  }
};

CalendarComponent.prototype._deleteShift = async function(id) {
  if (typeof cfConfirm === 'function' && !await cfConfirm('このシフトを削除しますか？')) return false;
  const snapshot = this._shiftMutationSnapshot?.();
  if (typeof this._removeShiftOptimistic === 'function') {
    this._removeShiftOptimistic(id);
    this._renderCalendarList?.();
    this._render();
    apiFetch('/cal/shifts/' + encodeURIComponent(id), { method: 'DELETE' }).then(() => {
      this._refreshShiftStateAfterMutation?.();
      this._showStatus('削除しました');
    }).catch(() => {
      if (snapshot && typeof this._restoreShiftMutationSnapshot === 'function') this._restoreShiftMutationSnapshot(snapshot);
      this._showStatus('削除に失敗', true);
    });
    return true;
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

// === 同期モーダル ===
CalendarComponent.prototype._showSyncModal = async function() {
  let syncStatus = {};
  try { syncStatus = await apiFetch('/cal/sync/status'); } catch {}
  const gC = syncStatus.google?.connected, gA = syncStatus.google?.available;
  const o = document.createElement('div'); o.className = 'gb-cal-modal-overlay';
  o.innerHTML = `<div class="gb-cal-modal" style="min-width:450px;"><h3>カレンダー同期</h3>
<div style="padding:10px;background:var(--cal-panel-bg, var(--bg));border:1px solid var(--cal-grid-line, var(--border));border-radius:4px;margin-bottom:10px;">
  <div style="font-size:13px;font-weight:bold;margin-bottom:8px;">Google Calendar</div>
  <div style="font-size:12px;color:var(--cal-muted-fg, var(--fg2));margin-bottom:8px;">ステータス: ${gC?'<span style="color:var(--green);">接続済み</span>':gA?'未接続':'<span style="color:var(--red);">パッケージ未インストール</span>'}</div>
  ${!gC&&gA?`<div class="field"><label>Client ID</label><input class="sync-gcal-id" type="text" placeholder="Google Cloud Console で取得"></div><div class="field"><label>Client Secret</label><input class="sync-gcal-secret" type="password"></div><button class="sync-gcal-auth" style="font-size:12px;padding:4px 12px;background:var(--cal-accent, var(--accent));color:var(--cal-accent-fg, var(--ui-fg-strong));border:none;border-radius:4px;cursor:pointer;">Google認証開始</button>`:''}
  ${gC?'<div style="display:flex;gap:4px;"><button class="sync-gcal-pull" style="font-size:12px;padding:4px 12px;">← Googleから取得</button><button class="sync-gcal-push" style="font-size:12px;padding:4px 12px;">→ Googleに送信</button></div>':''}
</div>
<div style="padding:10px;background:var(--cal-panel-bg, var(--bg));border:1px solid var(--cal-grid-line, var(--border));border-radius:4px;margin-bottom:10px;">
  <div style="font-size:13px;font-weight:bold;margin-bottom:8px;">iCal / .ics</div>
  <div style="display:flex;gap:4px;flex-wrap:wrap;">
    <button class="sync-ical-import" style="font-size:12px;padding:4px 12px;">.icsインポート</button>
    <button class="sync-ical-export" style="font-size:12px;padding:4px 12px;">.icsエクスポート</button>
  </div>
</div>
<div class="btn-row"><button class="sync-close">閉じる</button></div></div>`;
  document.body.appendChild(o);
  o.querySelector('.sync-close').addEventListener('click', () => o.remove());
  o.querySelector('.sync-gcal-auth')?.addEventListener('click', () => this._googleCalAuth(o));
  o.querySelector('.sync-gcal-pull')?.addEventListener('click', () => this._googleCalPull(o));
  o.querySelector('.sync-gcal-push')?.addEventListener('click', () => this._googleCalPush());
  o.querySelector('.sync-ical-import').addEventListener('click', () => this._icalImport());
  o.querySelector('.sync-ical-export').addEventListener('click', async () => {
    if (typeof MeldexExportSave === 'undefined' || typeof MeldexExportSave.saveUrl !== 'function') {
      this._showStatus('保存ダイアログを初期化できませんでした', true);
      return;
    }
    await MeldexExportSave.saveUrl(API_BASE + '/cal/sync/ical/export', {
      filename: `calendar-${this._localDateStr(new Date())}.ics`,
      extension: '.ics',
      dialogTitle: 'iCal として保存',
      filetypes: [['iCalファイル', '*.ics'], ['すべてのファイル', '*.*']],
      okMessage: 'iCal を保存しました',
      errorMessage: 'iCal の保存に失敗しました',
    });
  });
};

CalendarComponent.prototype._googleCalAuth = async function(o) {
  const id = o.querySelector('.sync-gcal-id')?.value.trim();
  const secret = o.querySelector('.sync-gcal-secret')?.value.trim();
  if (!id || !secret) { this._showStatus('Client IDとSecretを入力してください', true); return; }
  try { const res = await apiPost('/cal/sync/google/auth', { client_id: id, client_secret: secret }); this._showStatus(res.message || '認証成功'); o.remove(); this._showSyncModal(); } catch(e) { this._showStatus('認証失敗: ' + e.message, true); }
};

CalendarComponent.prototype._googleCalPull = async function(o) {
  this._showStatus('Googleカレンダーから取得中...');
  try { const res = await apiPost('/cal/sync/google/pull', {}); this._showStatus(`取得完了: ${res.imported}件インポート, ${res.updated}件更新`); await this._loadEvents(); this._render(); } catch(e) { this._showStatus('同期失敗: ' + e.message, true); }
};

CalendarComponent.prototype._googleCalPush = async function() {
  this._showStatus('Googleカレンダーに送信中...');
  try {
    const res = await apiPost('/cal/sync/google/push', {});
    if ((res.failed || 0) > 0) this._showStatus(`送信一部失敗: ${res.pushed || 0}件送信 / ${res.failed || 0}件失敗`, true);
    else this._showStatus(`送信完了: ${res.pushed}件プッシュ`);
  } catch(e) { this._showStatus('送信失敗: ' + e.message, true); }
};

CalendarComponent.prototype._icalImport = function() {
  const input = document.createElement('input'); input.type = 'file'; input.accept = '.ics,.ical';
  input.addEventListener('change', async () => {
    const file = input.files[0]; if (!file) return;
    const text = await file.text();
    try { const res = await apiPost('/cal/sync/ical/import', { ics: text }); this._showStatus(`iCalインポート完了: ${res.imported}件`); await this._loadEvents(); this._render(); } catch(e) { this._showStatus('インポート失敗: ' + e.message, true); }
  });
  input.click();
};

// === テンプレートモーダル ===
CalendarComponent.prototype._showScheduleTemplateModal = async function() {
  const allTemplates = await apiFetch('/cal/schedule-templates?user=' + encodeURIComponent(this._getUser()));
  const templates = (allTemplates || []).filter(template => !(typeof this._isShiftScheduleTemplate === 'function' && this._isShiftScheduleTemplate(template)));
  const dl = ['日','月','火','水','木','金','土'];
  const addMin = (ts, min) => {
    const match = /^(\d{1,2}):(\d{2})$/.exec(String(ts || ''));
    if (!match) return '--:--';
    const duration = parseInt(min, 10);
    if (!Number.isFinite(duration)) return '--:--';
    const t = parseInt(match[1], 10) * 60 + parseInt(match[2], 10) + duration;
    return String(Math.floor(((t % 1440) + 1440) % 1440 / 60)).padStart(2,'0')+':'+String(((t % 60) + 60) % 60).padStart(2,'0');
  };
  const o = document.createElement('div'); o.className = 'gb-cal-modal-overlay';
  let html = '<div class="gb-cal-modal" style="min-width:600px;max-height:80vh;overflow-y:auto;"><h3>週間テンプレート</h3><div class="tmpl-list">';
  if (!templates.length) html += '<div style="color:var(--cal-muted-fg, var(--fg2));font-size:12px;padding:8px;">テンプレートがありません</div>';
  templates.forEach(t => {
    html += `<div style="border:1px solid var(--cal-grid-line, var(--border));background:var(--cal-panel-bg, transparent);border-radius:4px;padding:8px;margin-bottom:8px;"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;"><strong>${esc(t.name)}</strong><div>`;
    html += `<button class="tmpl-edit" data-tid="${t.id}" style="font-size:11px;padding:2px 8px;margin-right:4px;">編集</button>`;
    html += `<button class="tmpl-del" data-tid="${t.id}" style="font-size:11px;padding:2px 8px;color:var(--red);">削除</button>`;
    html += `<button class="tmpl-gen" data-tid="${t.id}" style="font-size:11px;padding:2px 8px;margin-left:4px;background:var(--cal-accent, var(--accent));color:var(--cal-accent-fg, var(--ui-fg-strong));border:none;border-radius:3px;cursor:pointer;">一括生成</button></div></div>`;
    (t.entries||[]).forEach(e => { html += `<div style="font-size:11px;color:var(--cal-muted-fg, var(--fg2));padding:1px 0;">${dl[e.dayOfWeek]} ${e.startTime}〜${addMin(e.startTime,e.duration)} ${esc(e.title)}</div>`; });
    html += '</div>';
  });
  html += '</div><div class="btn-row"><button class="tmpl-create">新規テンプレート</button><button class="tmpl-close">閉じる</button></div></div>';
  o.innerHTML = html;
  document.body.appendChild(o);
  o.querySelector('.tmpl-close').addEventListener('click', () => o.remove());
  o.querySelector('.tmpl-create').addEventListener('click', () => this._createTemplate(o));
  o.querySelectorAll('.tmpl-edit').forEach(b => b.addEventListener('click', () => { o.remove(); this._editTemplate(b.dataset.tid); }));
  o.querySelectorAll('.tmpl-del').forEach(b => b.addEventListener('click', async () => {
    if (typeof cfConfirm === 'function' && !await cfConfirm('このテンプレートを削除しますか？')) return;
    await apiFetch('/cal/schedule-templates/' + b.dataset.tid, { method: 'DELETE' });
    o.remove();
    this._showScheduleTemplateModal();
  }));
  o.querySelectorAll('.tmpl-gen').forEach(b => b.addEventListener('click', () => this._generateFromTemplate(b.dataset.tid, o)));
};

CalendarComponent.prototype._createTemplate = async function(overlay) {
  const templates = await apiFetch('/cal/schedule-templates?user=' + encodeURIComponent(this._getUser()));
  let idx = 1, name = '無題'; const names = templates.map(t => t.name);
  while (names.includes(name)) { idx++; name = '無題' + idx; }
  const res = await apiPost('/cal/schedule-templates', { name, entries: [], user: this._getUser() });
  overlay.remove();
  this._editTemplate(res.id);
};

CalendarComponent.prototype._editTemplate = async function(tid) {
  const templates = await apiFetch('/cal/schedule-templates?user=' + encodeURIComponent(this._getUser()));
  const t = templates.find(x => x.id === tid);
  if (!t) return;
  const dl = ['日','月','火','水','木','金','土'];
  const o = document.createElement('div'); o.className = 'gb-cal-modal-overlay';
  const entryRow = (e) => `<div class="tmpl-entry" style="display:flex;gap:4px;align-items:center;margin-bottom:4px;font-size:12px;">
    <select data-field="dayOfWeek" class="gb-select gb-select-sm">${dl.map((d,i)=>`<option value="${i}" ${(e?.dayOfWeek??0)===i?'selected':''}>${d}</option>`).join('')}</select>
    <input type="time" data-field="startTime" value="${e?.startTime||'09:00'}" style="padding:2px;background:var(--cal-input-bg, var(--bg));color:var(--cal-input-fg, var(--fg));border:1px solid var(--cal-control-border, var(--border));border-radius:3px;">
    <input type="number" data-field="duration" value="${e?.duration||60}" min="5" step="5" style="width:60px;padding:2px;background:var(--cal-input-bg, var(--bg));color:var(--cal-input-fg, var(--fg));border:1px solid var(--cal-control-border, var(--border));border-radius:3px;" title="分"><span style="color:var(--cal-muted-fg, var(--fg2));">分</span>
    <input type="text" data-field="title" value="${esc(e?.title||'')}" placeholder="タイトル" style="flex:1;padding:2px 4px;background:var(--cal-input-bg, var(--bg));color:var(--cal-input-fg, var(--fg));border:1px solid var(--cal-control-border, var(--border));border-radius:3px;">
    <button class="tmpl-entry-del" style="background:none;border:none;color:var(--red);cursor:pointer;display:flex;align-items:center;">${lucide('x', 14)}</button></div>`;
  let entriesHtml = (t.entries||[]).map(e => entryRow(e)).join('');
  o.innerHTML = `<div class="gb-cal-modal" style="min-width:550px;max-height:80vh;overflow-y:auto;">
    <h3>テンプレート編集: ${esc(t.name)}</h3>
    <div class="field"><label>名前</label><input class="tmpl-name" type="text" value="${esc(t.name)}"></div>
    <div style="font-size:12px;color:var(--cal-muted-fg, var(--fg2));margin-bottom:4px;">エントリ（1週間分）</div>
    <div class="tmpl-entries">${entriesHtml}</div>
    <button class="tmpl-add-entry" style="font-size:12px;padding:2px 8px;margin:4px 0;">+ エントリ追加</button>
    <div class="btn-row"><button class="tmpl-edit-cancel">キャンセル</button><button class="primary tmpl-edit-save">保存</button></div></div>`;
  document.body.appendChild(o);
  o.querySelector('.tmpl-add-entry').addEventListener('click', () => {
    o.querySelector('.tmpl-entries').insertAdjacentHTML('beforeend', entryRow({}));
    o.querySelectorAll('.tmpl-entry-del').forEach(b => b.addEventListener('click', () => b.closest('.tmpl-entry').remove()));
  });
  o.querySelectorAll('.tmpl-entry-del').forEach(b => b.addEventListener('click', () => b.closest('.tmpl-entry').remove()));
  o.querySelector('.tmpl-edit-cancel').addEventListener('click', () => { o.remove(); this._showScheduleTemplateModal(); });
  o.querySelector('.tmpl-edit-save').addEventListener('click', async () => {
    const name = o.querySelector('.tmpl-name').value.trim() || '無題';
    const entries = [];
    o.querySelectorAll('.tmpl-entries .tmpl-entry').forEach(row => {
      entries.push({ dayOfWeek: parseInt(row.querySelector('[data-field="dayOfWeek"]').value), startTime: row.querySelector('[data-field="startTime"]').value, duration: parseInt(row.querySelector('[data-field="duration"]').value) || 60, title: row.querySelector('[data-field="title"]').value.trim() });
    });
    await apiPut('/cal/schedule-templates/' + tid, { name, entries });
    o.remove(); this._showStatus('テンプレートを保存しました'); this._showScheduleTemplateModal();
  });
};

CalendarComponent.prototype._generateFromTemplate = async function(tid, overlay) {
  const templates = await apiFetch('/cal/schedule-templates?user=' + encodeURIComponent(this._getUser()));
  const t = templates.find(x => x.id === tid);
  if (!t || !t.entries?.length) { this._showStatus('エントリがありません', true); return; }
  // cfPromptで週数を取得
  const weeksStr = await cfPrompt('何週間分生成しますか？', '4');
  const weeks = parseInt(weeksStr) || 0;
  if (weeks <= 0) return;
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
    return;
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
    return;
  }
  overlay?.remove();
  await this._loadEvents(); this._render();
  this._showStatus(`${count}件のイベントを生成しました`);
};
