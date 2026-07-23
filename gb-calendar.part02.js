    try {
      await _saveMappedCalendarDates(dbPath, { _mapped: true, entityName: data.entityName, entityPath: data.entityPath, name: data.name }, newStart, newEnd, { preserveMissingEndIfZeroDuration: true });
      showStatus('日時を更新しました');
    } catch(err){ showStatus('移動に失敗',true); }
    return;
  }
  _calPushUndo('イベント移動');
  try{
    await apiPut('/calendar-db/events/'+encodeURIComponent(data.name),{
      db_path:dbPath,
      start:_toCalendarApiValue(newStart, false),
      end:_toCalendarApiValue(newEnd, false),
    });
    await _calendarNotifyEventSaved(data, {
      ...data,
      start: _toCalendarApiValue(newStart, false),
      end: _toCalendarApiValue(newEnd, false),
      allDay: false,
    });
    await _refreshCalendarDb(dbPath);
  }catch(err){showStatus('移動に失敗',true);}
}

// 候補ユーザー一覧はMeldexUserPickerに統一（正本「スタッフ管理シート」+
// ワークスペースメンバーのマージ。ユーザーアカウント一元管理 計画書 Phase 3、§5.8-2）。
async function _calendarLoadUserChoices() {
  if (window.MeldexUserPicker) {
    try {
      const candidates = await window.MeldexUserPicker.getCandidates();
      if (candidates.length) return candidates;
    } catch {}
  }
  const users = new Map();
  const add = name => { name = String(name || '').trim(); if (name && !users.has(name)) users.set(name, { name }); };
  add(_getUser());
  return [...users.values()];
}
function _calendarUserFields(prefix, ev) {
  const creator = _calendarEventCreator(ev);
  return `
    <div class="field"><label>作成者</label><select id="${prefix}-creator" class="gb-select"><option value="${esc(creator)}">${esc(creator || 'anonymous')}</option></select></div>
    <div class="field"><label>メンバー</label><div id="${prefix}-members" class="cal-option-members"><span style="color:var(--fg2);font-size:12px;">読み込み中...</span></div></div>`;
}
async function _populateCalendarEventUserControls(root, prefix, ev) {
  const creatorSelect = root.querySelector('#' + prefix + '-creator');
  const membersBox = root.querySelector('#' + prefix + '-members');
  if (!creatorSelect && !membersBox) return;
  const creator = _calendarEventCreator(ev);
  const selectedMembers = new Set(_calendarEventMembers(ev));
  const users = await _calendarLoadUserChoices();
  [creator, ...selectedMembers].forEach(name => {
    if (name && !users.some(user => user.name === name)) users.push({ name });
  });
  if (!root.isConnected) return;
  if (creatorSelect) creatorSelect.innerHTML = users.map(user => `<option value="${esc(user.name)}" ${user.name === creator ? 'selected' : ''}>${esc(user.name)}</option>`).join('');
  if (membersBox) membersBox.innerHTML = users.map(user => `<label class="cal-option-member"><input type="checkbox" class="${prefix}-member" value="${esc(user.name)}" data-e2e-id="${prefix}-member-${esc(user.name)}" aria-label="${esc(user.name)}" ${selectedMembers.has(user.name) ? 'checked' : ''}> <span>${esc(user.name)}</span></label>`).join('');
}
function _collectCalendarEventMembers(root, prefix, creator) {
  const seen = new Set();
  const inputs = [...root.querySelectorAll('.' + prefix + '-member')];
  const source = inputs.length ? inputs.filter(input => input.checked).map(input => input.value) : _calendarUserList(root.dataset.calEventMembers || '[]');
  return source.map(input => String(input || '').trim()).filter(name => {
    if (!name || name === creator || seen.has(name)) return false;
    seen.add(name);
    return true;
  });
}
function _calendarEventInputApiValue(value, allDay) {
  const parsed = _parseCalendarDateValue(value);
  return _toCalendarApiValue(parsed, !!allDay) || String(value || '');
}
function _calendarTaskStatusColor(status) {
  return {
    backlog: '#7a8494',
    todo: '#569cd6',
    in_progress: '#d19a66',
    review: '#c678dd',
    done: '#98c379',
  }[status] || '#569cd6';
}

function _calendarSafeCssColor(value, fallback = '') {
  const text = String(value || '').trim();
  if (!text || /["'<>;]/.test(text)) return fallback;
  if (/^#[0-9a-f]{3,8}$/i.test(text)) return text;
  if (/^var\(--[a-z0-9_-]+\)$/i.test(text)) return text;
  if (/^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}(?:\s*,\s*(?:0|1|0?\.\d+))?\s*\)$/i.test(text)) return text;
  return fallback;
}

function _calendarSafeTintColor(value) {
  const color = _calendarSafeCssColor(value, '');
  if (!color) return '';
  if (/^#[0-9a-f]{6}$/i.test(color)) return color + '33';
  return color;
}

function _calendarModalSizeStyle(minWidth, extra, options) {
  const width = Math.max(240, Number(minWidth) || 400);
  const zoom = Math.max(0.1, (typeof _getZoom === 'function' ? _getZoom() : parseFloat(document.documentElement?.style?.zoom || '')) || 1);
  const viewportWidth = Math.floor(window.visualViewport?.width || window.innerWidth || document.documentElement?.clientWidth || width + 16);
  const viewportHeight = Math.floor(window.visualViewport?.height || window.innerHeight || document.documentElement?.clientHeight || 720);
  const safeWidth = Math.max(240, Math.min(width, viewportWidth - 16));
  const safeHeight = Math.max(180, Math.floor((viewportHeight - 56) / zoom));
  const overflow = extra == null ? 'overflow-y:auto;' : String(extra);
  const height = options?.forceHeight ? `height:${safeHeight}px;` : '';
  return `min-width:0;min-height:0;width:${safeWidth}px;max-width:${safeWidth}px;max-height:${safeHeight}px;${height}${overflow}`;
}

function _showCalendarEventDetailPanel(dbPath, ev) {
  if (!ev) return;
  if (ev._mapped && typeof _openMappedCalendarEventPanel === 'function') {
    _openMappedCalendarEventPanel(dbPath, ev);
    return;
  }
  if (typeof _openDetailRightPanel === 'function') {
    _openDetailRightPanel();
  } else if (typeof _getDetailPanelCfg === 'function' && typeof toggleOptionPanel === 'function') {
    if (_getDetailPanelCfg().visible !== true) toggleOptionPanel();
  } else if (typeof toggleOptionPanel === 'function') {
    toggleOptionPanel();
  } else if (typeof toggleDetailPanel === 'function') {
    toggleDetailPanel();
  }
  const detailRoot = typeof _resolveDetailEl === 'function' ? _resolveDetailEl() : document.getElementById('rp-detail');
  if (!detailRoot) {
    _openEventEditPanel(dbPath, ev);
    return;
  }
  if (typeof _ensureDetailTabShell === 'function') _ensureDetailTabShell(detailRoot);
  if (typeof showBoardTabs === 'function') showBoardTabs(false);
  if (typeof hideBoardNoteTab === 'function') hideBoardNoteTab();
  if (typeof hideScriptnoteDetailTabs === 'function') hideScriptnoteDetailTabs();
  if (typeof showNoteTabs === 'function') showNoteTabs(false);
  if (typeof showDbTabs === 'function') showDbTabs(false);
  if (typeof showCalendarDetailTabs === 'function') showCalendarDetailTabs(true);
  if (typeof showFileStyleTab === 'function') showFileStyleTab(true);
  if (typeof renderFileStyleTab === 'function') renderFileStyleTab('calendar');
  if (typeof showPublishDetailTab === 'function') showPublishDetailTab(true);
  if (typeof switchDetailTab === 'function') switchDetailTab('calendar-today');
  const titleEl = detailRoot.querySelector('#split-right-title');
  if (titleEl) titleEl.textContent = ev.name || 'イベント詳細';
  const tabContent = detailRoot.querySelector('#detail-tab-calendar-today');
  if (!tabContent) {
    _openEventEditPanel(dbPath, ev);
    return;
  }
  const rec = _recParse(ev);
  const recType = rec.type || '';
  tabContent.innerHTML = '';
  const body = document.createElement('div');
  body.style.cssText = 'flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:10px;';
  body.dataset.calEventMembers = JSON.stringify(_calendarEventMembers(ev));
  body.innerHTML = `
    <div class="field"><label>タイトル</label><input id="cal-detail-title" value="${esc(ev.name || '')}" placeholder="イベント名"></div>
    <div class="field"><label><input id="cal-detail-allday" type="checkbox" ${ev.allDay ? 'checked' : ''}> 終日</label></div>
    <div class="field"><label>開始</label><input id="cal-detail-start" type="datetime-local" value="${_toCalendarInputValue(ev._origStart || ev.start)}" ${ev.allDay ? 'disabled style="opacity:0.4"' : ''}></div>
    <div class="field"><label>終了</label><input id="cal-detail-end" type="datetime-local" value="${_toCalendarInputValue(ev._origEnd || ev.end || ev.start)}" ${ev.allDay ? 'disabled style="opacity:0.4"' : ''}></div>
    <div class="field"><label>色</label><button type="button" id="cal-detail-color" class="gb-color-swatch gb-color-swatch--field" data-color="${esc(ev.color || '#569cd6')}" title="イベント色"></button></div>
    <div class="field"><label>場所</label><input id="cal-detail-location" value="${esc(ev.location || '')}"></div>
    <div class="field"><label>URL</label><input id="cal-detail-url" type="url" value="${esc(ev.url || '')}" placeholder="https://..."></div>
    <div class="field"><label>説明</label><textarea id="cal-detail-desc" rows="4">${esc(ev.description || '')}</textarea></div>
    <div class="field"><label>アラーム</label>
      <select id="cal-detail-alert">
        <option value="-1" ${Number(ev.alertMinutes)===-1?'selected':''}>なし</option>
        <option value="0" ${Number(ev.alertMinutes)===0?'selected':''}>イベント時</option>
        <option value="5" ${Number(ev.alertMinutes)===5?'selected':''}>5分前</option>
        <option value="10" ${Number(ev.alertMinutes)===10?'selected':''}>10分前</option>
        <option value="15" ${Number(ev.alertMinutes)===15?'selected':''}>15分前</option>
        <option value="30" ${Number(ev.alertMinutes)===30?'selected':''}>30分前</option>
        <option value="60" ${Number(ev.alertMinutes)===60?'selected':''}>1時間前</option>
      </select>
    </div>
    <div class="field"><label>繰り返し</label>
      <select id="cal-detail-rec-type">
        <option value="">なし</option>
        <option value="daily" ${recType==='daily'?'selected':''}>毎日</option>
        <option value="weekly" ${recType==='weekly'?'selected':''}>毎週</option>
        <option value="monthly" ${recType==='monthly'?'selected':''}>毎月</option>
        <option value="yearly" ${recType==='yearly'?'selected':''}>毎年</option>
      </select>
      <div id="cal-detail-rec-opts" style="${recType?'':'display:none;'}margin-top:6px;">
        <label style="font-size:11px;">間隔: <input id="cal-detail-rec-interval" type="number" min="1" value="${rec.interval||1}" style="width:56px;"></label>
        <label style="font-size:11px;margin-left:8px;">終了日: <input id="cal-detail-rec-end" type="date" value="${rec.endDate||''}"></label>
        <div id="cal-detail-rec-days" style="margin-top:6px;font-size:11px;${recType==='weekly'?'':'display:none;'}">
          ${['日','月','火','水','木','金','土'].map((d,i)=>`<label style="margin-right:4px;"><input type="checkbox" class="cal-detail-rec-dow" value="${i}" ${(rec.daysOfWeek||[]).includes(i)?'checked':''}> ${d}</label>`).join('')}
        </div>
      </div>
    </div>
    <div class="field"><label>カレンダー</label><input id="cal-detail-calendar" value="${esc(ev.calendarId || 'default')}" placeholder="default"></div>
    ${_calendarUserFields('cal-detail', ev)}
    ${ev.linkedEntryPath ? `
    <div class="field">
      <label>元エントリ <span style="font-size:10px;color:var(--fg2);margin-left:6px;">${ev.linkedAutoGenerated ? '(自動生成)' : ''}</span></label>
      <div style="display:flex;gap:6px;align-items:center;">
        <div style="flex:1;font-size:11px;color:var(--fg2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(ev.linkedEntryPath)}</div>
        <button id="cal-detail-open-entry" type="button">元エントリを開く</button>
      </div>
    </div>
    ` : ''}
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:6px;">
      <button class="danger" id="cal-detail-delete">削除</button>
      <button id="cal-detail-save" class="primary">更新</button>
    </div>
  `;
  tabContent.appendChild(body);
  _populateCalendarEventUserControls(body, 'cal-detail', ev);
  const colorSwatch = body.querySelector('#cal-detail-color');
  bindColorSwatch(colorSwatch, () => getColorSwatchValue(colorSwatch, ev.color || '#569cd6'), (nextColor) => {
    setColorSwatchValue(colorSwatch, nextColor || '#569cd6');
  });
  const toggleAllDayInputs = () => {
    const disabled = body.querySelector('#cal-detail-allday')?.checked;
    ['cal-detail-start', 'cal-detail-end'].forEach(id => {
      const input = body.querySelector('#' + id);
      if (!input) return;
      input.disabled = !!disabled;
      input.style.opacity = disabled ? '0.4' : '1';
    });
  };
  body.querySelector('#cal-detail-allday')?.addEventListener('change', toggleAllDayInputs);
  body.querySelector('#cal-detail-open-entry')?.addEventListener('click', () => {
    // Phase 1 §5.4: リンク元 settings-entry を開く
    const p = ev.linkedEntryPath;
    if (!p) return;
    if (typeof selectEntity === 'function') {
      selectEntity(p);
    } else if (window.GbEditor && typeof window.GbEditor.selectEntity === 'function') {
      window.GbEditor.selectEntity(p);
    }
  });
  body.querySelector('#cal-detail-rec-type')?.addEventListener('change', function() {
    body.querySelector('#cal-detail-rec-opts').style.display = this.value ? '' : 'none';
    body.querySelector('#cal-detail-rec-days').style.display = this.value === 'weekly' ? '' : 'none';
  });
  body.querySelector('#cal-detail-save')?.addEventListener('click', async () => {
    const title = body.querySelector('#cal-detail-title').value.trim() || '無題イベント';
    const creator = body.querySelector('#cal-detail-creator')?.value || _getUser();
    const allDay = body.querySelector('#cal-detail-allday').checked;
    const startRaw = body.querySelector('#cal-detail-start').value;
    const endRaw = body.querySelector('#cal-detail-end').value || startRaw;
    const start = _calendarEventInputApiValue(startRaw, allDay);
    const end = _calendarEventInputApiValue(endRaw, allDay);
    const alertMinutes = parseInt(body.querySelector('#cal-detail-alert').value, 10);
    let recurrence = '';
    const recMode = body.querySelector('#cal-detail-rec-type').value;
    if (recMode) {
      const nextRec = {
        type: recMode,
        interval: parseInt(body.querySelector('#cal-detail-rec-interval').value, 10) || 1,
        endDate: body.querySelector('#cal-detail-rec-end').value || '',
      };
      if (recMode === 'weekly') nextRec.daysOfWeek = [...body.querySelectorAll('.cal-detail-rec-dow:checked')].map(cb => parseInt(cb.value, 10));
      recurrence = JSON.stringify(nextRec);
    }
    _calPushUndo('イベント編集');
    try {
      const result = await apiPut('/calendar-db/events/' + encodeURIComponent(ev.name), {
        db_path: dbPath,
        title,
        start,
        end,
        all_day: allDay,
        color: getColorSwatchValue(colorSwatch, ev.color || ''),
        location: body.querySelector('#cal-detail-location').value,
        url: body.querySelector('#cal-detail-url').value,
        description: body.querySelector('#cal-detail-desc').value,
        alert_minutes: alertMinutes,
        calendar_id: body.querySelector('#cal-detail-calendar').value || 'default',
        creator,
        members: _collectCalendarEventMembers(body, 'cal-detail', creator),
        recurrence,
      });
      // Phase 2 §5.5: 逆方向同期（Calendar→Entry）。自動生成イベントなら元エントリの
      // 日付プロパティを更新する。繰り返し化されたイベントはスキップ（reverseSync.skipIfRecurrence）。
      try {
        if (window.GbDbCalendarSync && typeof window.GbDbCalendarSync.onEventSaved === 'function') {
          await window.GbDbCalendarSync.onEventSaved({
            prev: ev,
            next: { ...ev, title, start, end, allDay, recurrence },
          });
        }
      } catch {}
      const savedName = result?.name || result?.id || (result?.path ? String(result.path).split(/[/\\]/).pop().replace(/\.md$/i, '') : '');
      await _refreshCalendarDb(dbPath);
      const nextEvent = (_calRenderState.allEvents || []).find(item => (savedName && item.name === savedName) || item.name === title)
        || { ...ev, name: title, allDay, color: getColorSwatchValue(colorSwatch, ev.color || ''), creator, members: _collectCalendarEventMembers(body, 'cal-detail', creator) };
      _showCalendarEventDetailPanel(dbPath, nextEvent);
      showStatus('イベントを更新しました');
    } catch {
      showStatus('イベントの更新に失敗しました', true);
    }
  });
  body.querySelector('#cal-detail-delete')?.addEventListener('click', async () => {
    if (!await cfConfirm((ev.name || 'イベント') + ' を削除しますか？')) return;
    _calPushUndo('イベント削除');
    try {
      await apiDelete('/calendar-db/events/' + encodeURIComponent(ev.name) + '?db_path=' + encodeURIComponent(dbPath));
      await _refreshCalendarDb(dbPath);
      if (typeof clearDetailPanel === 'function') await clearDetailPanel();
      showStatus('イベントを削除しました');
    } catch {
      showStatus('イベントの削除に失敗しました', true);
    }
  });
  setTimeout(() => body.querySelector('#cal-detail-title')?.focus(), 40);
}

/* ==============================
   イベント編集パネル（完全版）
   ============================== */
function _openEventEditPanel(dbPath, ev, defStart, defEnd, defAllDay, defCalendarId) {
  if (ev?._mapped && typeof _openMappedCalendarEventPanel === 'function') {
    _openMappedCalendarEventPanel(dbPath, ev);
    return;
  }
  if (!_calRenderState.info?.canCreateEvents && !ev) {
    showStatus('このDBではカレンダーから新規作成できません');
    return;
  }
  document.querySelectorAll('.modal-overlay').forEach(existing => {
    if (existing.querySelector?.('#ep-title')) existing.remove();
  });
  // v5.0: モーダルオーバーレイで編集（旧detail-panelは廃止済み）
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  const panel = document.createElement('div');
  panel.className = 'modal';
  panel.style.cssText = _calendarModalSizeStyle(450);
  panel.dataset.calEventMembers = JSON.stringify(_calendarEventMembers(ev));
  overlay.appendChild(panel);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
  const isNew=!ev;
  const title=isNew?'':ev.name;
  const _toLocalDT=(dt)=>{const y=dt.getFullYear(),m=_p2(dt.getMonth()+1),d=_p2(dt.getDate()),h=_p2(dt.getHours()),mi=_p2(dt.getMinutes());return `${y}-${m}-${d}T${h}:${mi}`;};
  // 繰り返し展開インスタンスの場合は元の日時で編集（繰り返しルール自体を編集）
  const evStart=isNew?null:(ev._origStart||ev.start);
  const evEnd=isNew?null:(ev._origEnd||ev.end);
  const start=isNew?_toLocalDT(defStart||new Date()):_toLocalDT(evStart);
  const end=isNew?_toLocalDT(defEnd||new Date(Date.now()+3600000)):_toLocalDT(evEnd);
  const allDay=isNew?!!defAllDay:ev.allDay;
  const color=isNew?'#569cd6':ev.color;
  const loc=isNew?'':(ev.location||'');
  const url=isNew?'':(ev.url||'');
  const desc=isNew?'':(ev.description||'');
  const alertMin=isNew?-1:(ev.alertMinutes ?? -1);
  const calId=isNew?(defCalendarId||'default'):(ev.calendarId||'default');
  const rec=isNew?{}:_recParse(ev);
  const recType=rec.type||'';

  panel.innerHTML=`<div style="padding:12px;overflow-y:auto;">
    <h3 style="margin:0 0 12px;">${isNew?'新規イベント':'イベント編集'}</h3>
    <div class="field"><label>タイトル</label><input id="ep-title" value="${esc(title)}" placeholder="イベント名"></div>
    <div class="field"><label><input id="ep-allday" type="checkbox" ${allDay?'checked':''}> 終日</label></div>
    <div class="field"><label>開始</label><input id="ep-start" type="datetime-local" value="${start}" ${allDay?'disabled style="opacity:0.4"':''}></div>
    <div class="field"><label>終了</label><input id="ep-end" type="datetime-local" value="${end}" ${allDay?'disabled style="opacity:0.4"':''}></div>
    <div class="field"><label>色</label><button type="button" id="ep-color" class="gb-color-swatch gb-color-swatch--field" data-color="${esc(color || '')}" title="イベント色"></button></div>
    <div class="field"><label>場所</label><input id="ep-location" value="${esc(loc)}"></div>
    <div class="field"><label>URL</label><input id="ep-url" type="url" value="${esc(url)}" placeholder="https://..."></div>
    <div class="field"><label>説明</label><textarea id="ep-desc" rows="3">${esc(desc)}</textarea></div>
    <div class="field"><label>アラーム</label>
      <select id="ep-alert"><option value="-1" ${alertMin===-1?'selected':''}>なし</option><option value="0" ${alertMin===0?'selected':''}>イベント時</option><option value="5" ${alertMin===5?'selected':''}>5分前</option><option value="10" ${alertMin===10?'selected':''}>10分前</option><option value="15" ${alertMin===15?'selected':''}>15分前</option><option value="30" ${alertMin===30?'selected':''}>30分前</option><option value="60" ${alertMin===60?'selected':''}>1時間前</option></select>
    </div>
    <div class="field"><label>繰り返し</label>
      <select id="ep-rec-type">
        <option value="">なし</option><option value="daily" ${recType==='daily'?'selected':''}>毎日</option><option value="weekly" ${recType==='weekly'?'selected':''}>毎週</option><option value="monthly" ${recType==='monthly'?'selected':''}>毎月</option><option value="yearly" ${recType==='yearly'?'selected':''}>毎年</option>
      </select>
      <div id="ep-rec-opts" style="${recType?'':'display:none;'}margin-top:4px;">
        <label style="font-size:11px;">間隔: <input id="ep-rec-interval" type="number" min="1" value="${rec.interval||1}" style="width:50px;"></label>
        <label style="font-size:11px;margin-left:8px;">終了日: <input id="ep-rec-end" type="date" value="${rec.endDate||''}"></label>
        <div id="ep-rec-days" style="margin-top:4px;font-size:11px;${recType==='weekly'?'':'display:none;'}">
          ${['日','月','火','水','木','金','土'].map((d,i)=>`<label style="margin-right:4px;"><input type="checkbox" class="ep-rec-dow" value="${i}" ${(rec.daysOfWeek||[]).includes(i)?'checked':''}> ${d}</label>`).join('')}
        </div>
      </div>
    </div>
    <div class="field"><label>カレンダー</label><input id="ep-calid" value="${esc(calId)}" placeholder="default"></div>
    ${_calendarUserFields('ep', ev)}
    <div class="btn-row" style="margin-top:12px;">
      ${isNew?'':`<button class="danger" id="ep-delete">削除</button>`}
      <button id="ep-cancel">キャンセル</button>
      <button class="primary" id="ep-save">${isNew?'作成':'更新'}</button>
    </div>
  </div>`;
  // 繰り返しタイプ切替
  panel.querySelector('#ep-rec-type').addEventListener('change', function(){
    panel.querySelector('#ep-rec-opts').style.display=this.value?'':'none';
    panel.querySelector('#ep-rec-days').style.display=this.value==='weekly'?'':'none';
  });
  const colorSwatch = panel.querySelector('#ep-color');
  bindColorSwatch(colorSwatch, () => getColorSwatchValue(colorSwatch, color || ''), (nextColor) => {
    setColorSwatchValue(colorSwatch, nextColor || '#569cd6');
  });
  _populateCalendarEventUserControls(panel, 'ep', ev);
  // 終日トグル
  panel.querySelector('#ep-allday').onchange=function(){const d=this.checked;['ep-start','ep-end'].forEach(id=>{const el=panel.querySelector('#'+id);el.disabled=d;el.style.opacity=d?'0.4':'1';});};
  // 保存
  panel.querySelector('#ep-save').addEventListener('click', async()=>{
    const t=panel.querySelector('#ep-title').value.trim()||'無題イベント';
    const sRaw=panel.querySelector('#ep-start').value,enRaw=panel.querySelector('#ep-end').value||sRaw;
    const c=getColorSwatchValue(colorSwatch, color || ''),lc=panel.querySelector('#ep-location').value;
    const u=panel.querySelector('#ep-url').value,d=panel.querySelector('#ep-desc').value;
    const ad=panel.querySelector('#ep-allday').checked;
    const s=_calendarEventInputApiValue(sRaw,ad),en=_calendarEventInputApiValue(enRaw,ad);
    const al=parseInt(panel.querySelector('#ep-alert').value);
    const ci=panel.querySelector('#ep-calid').value||'default';
    const creator=panel.querySelector('#ep-creator')?.value||_getUser();
    const members=_collectCalendarEventMembers(panel,'ep',creator);
    let recStr='';
    const rt=panel.querySelector('#ep-rec-type').value;
    if(rt){const r={type:rt,interval:parseInt(panel.querySelector('#ep-rec-interval').value)||1,endDate:panel.querySelector('#ep-rec-end').value||''};if(rt==='weekly')r.daysOfWeek=[...panel.querySelectorAll('.ep-rec-dow:checked')].map(cb=>parseInt(cb.value));recStr=JSON.stringify(r);}
    _calPushUndo(isNew?'イベント作成':'イベント編集');
    try{
      if(isNew) await apiPost('/calendar-db/events',{db_path:dbPath,title:t,start:s,end:en,color:c,location:lc,url:u,description:d,all_day:ad,alert_minutes:al,calendar_id:ci,creator,members,recurrence:recStr});
      else {
        await apiPut('/calendar-db/events/'+encodeURIComponent(ev.name),{db_path:dbPath,start:s,end:en,color:c,location:lc,url:u,description:d,all_day:ad,alert_minutes:al,calendar_id:ci,creator,members,recurrence:recStr,title:t});
        await _calendarNotifyEventSaved(ev, { ...ev, name: t, start: s, end: en, allDay: ad, color: c, location: lc, url: u, description: d, alertMinutes: al, calendarId: ci, creator, members, recurrence: recStr });
      }
      overlay.remove();await _refreshCalendarDb(dbPath);
    }catch{showStatus('保存に失敗',true);}
  });
  panel.querySelector('#ep-cancel').addEventListener('click', ()=>{overlay.remove();});
  if(!isNew) panel.querySelector('#ep-delete').addEventListener('click', async()=>{if(!await cfConfirm(ev.name+' を削除しますか？'))return;_calPushUndo('イベント削除');try{await apiDelete('/calendar-db/events/'+encodeURIComponent(ev.name)+'?db_path='+encodeURIComponent(dbPath));overlay.remove();await _refreshCalendarDb(dbPath);}catch{showStatus('削除に失敗',true);}});
}
function _recParse(ev){try{return ev?.recurrence?(typeof ev.recurrence==='string'?JSON.parse(ev.recurrence):ev.recurrence):{};}catch{return {};}}

/* ==============================
   ToDoモーダル（完全版）
   ============================== */
function _openTaskModal(dbPath, task, defaultStatus) {
  const isNew=!task;
  const o=document.createElement('div');o.className='modal-overlay';
  o.innerHTML=`<div class="modal" style="${_calendarModalSizeStyle(450)}">
    <h3>${isNew?'新規ToDo':'ToDo編集'}</h3>
    <div class="field"><label>タイトル</label><input id="tk-title" value="${esc(task?.name||'')}"></div>
    <div style="display:flex;gap:8px;">
      <div class="field" style="flex:1;"><label>ステータス</label><select id="tk-status">
        ${[['backlog','バックログ'],['todo','未着手'],['in_progress','進行中'],['review','レビュー'],['done','完了']].map(([v,l])=>`<option value="${v}" ${(task?.description?.match(/status:(\w+)/)?.[1]||defaultStatus||'todo')===v?'selected':''}>${l}</option>`).join('')}
      </select></div>
      <div class="field" style="flex:1;"><label>優先度</label><select id="tk-priority">
        ${[['low','低'],['medium','中'],['high','高'],['urgent','緊急']].map(([v,l])=>`<option value="${v}" ${(task?.description?.match(/priority:(\w+)/)?.[1]||'medium')===v?'selected':''}>${l}</option>`).join('')}
      </select></div>
    </div>
    <div style="display:flex;gap:8px;">
      <div class="field" style="flex:1;"><label>期限</label><input id="tk-due" type="date" value="${task?.end?_dateStr(task.end):(task?.start?_dateStr(task.start):'')}"></div>
      <div class="field" style="flex:1;"><label>担当者</label><input id="tk-assignee" value="${esc(task?.calendarId||'')}"></div>
    </div>
    <div class="field"><label>説明</label><textarea id="tk-desc" rows="3">${esc(task?.description?.replace(/status:\w+\s*/g,'').replace(/priority:\w+\s*/g,'').trim()||'')}</textarea></div>
    <div class="btn-row">
      ${isNew?'':`<button class="danger" id="tk-delete">削除</button>`}
      <button data-action="this.closest('.modal-overlay').remove()">キャンセル</button>
      <button class="primary" id="tk-save">${isNew?'作成':'更新'}</button>
    </div>
  </div>`;
  document.body.appendChild(o);
  o.querySelector('#tk-save').addEventListener('click', async()=>{
    const title=o.querySelector('#tk-title').value.trim()||'無題タスク';
    const status=o.querySelector('#tk-status').value;
    const priority=o.querySelector('#tk-priority').value;
    const due=o.querySelector('#tk-due').value;
    const assignee=o.querySelector('#tk-assignee').value;
    const desc=o.querySelector('#tk-desc').value;
    const fullDesc=`status:${status} priority:${priority} ${desc}`.trim();
    _calPushUndo(isNew?'ToDo作成':'ToDo編集');
    try{
      const fallbackDate = task?.start ? _dateStr(task.start) : _dateStr(new Date());
      const taskDate = due || fallbackDate;
      const color = _calendarTaskStatusColor(status);
      if(isNew) await apiPost('/calendar-db/events',{db_path:dbPath,title,start:taskDate,end:taskDate,description:fullDesc,calendar_id:assignee||'default',color});
      else {
        await apiPut('/calendar-db/events/'+encodeURIComponent(task.name),{db_path:dbPath,description:fullDesc,calendar_id:assignee||'default',title,start:taskDate,end:taskDate,color});
        await _calendarNotifyEventSaved(task, { ...task, name: title, description: fullDesc, calendarId: assignee || 'default', start: taskDate, end: taskDate, color });
      }
      o.remove();
      await _refreshCalendarDb(dbPath);
    }catch{showStatus('保存に失敗',true);}
  });
  if(!isNew) o.querySelector('#tk-delete').addEventListener('click', async()=>{if(!await cfConfirm('このToDoを削除しますか？'))return;o.remove();_calPushUndo('ToDo削除');try{await apiDelete('/calendar-db/events/'+encodeURIComponent(task.name)+'?db_path='+encodeURIComponent(dbPath));await _refreshCalendarDb(dbPath);}catch{}});
  setTimeout(()=>o.querySelector('#tk-title').focus(),50);
}

/* ==============================
   ToDoリスト
   ============================== */
function _renderTaskBoard(container, dbPath, events) {
  const statuses=[{key:'backlog',label:'バックログ',color:'var(--fg2)'},{key:'todo',label:'未着手',color:'#569cd6'},{key:'in_progress',label:'進行中',color:'#d19a66'},{key:'review',label:'レビュー',color:'#c678dd'},{key:'done',label:'完了',color:'#98c379'}];
  const board=document.createElement('div');board.style.cssText='display:flex;gap:8px;overflow-x:auto;padding:8px 0;flex:1;';
  statuses.forEach(s=>{
    const col=document.createElement('div');col.style.cssText='min-width:180px;flex:1;background:var(--bg2);border:1px solid var(--border);border-radius:4px;display:flex;flex-direction:column;';
    const taskEvs=events.filter(ev=>(ev.description||'').includes('status:'+s.key));
    const hdr=document.createElement('div');hdr.style.cssText='padding:6px 8px;font-size:12px;font-weight:bold;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;';
    hdr.innerHTML=`<span style="color:${s.color};">${s.label}</span><span style="font-size:10px;color:var(--fg2);">${taskEvs.length}</span>`;
    col.appendChild(hdr);
    const body=document.createElement('div');body.style.cssText='flex:1;padding:4px;overflow-y:auto;min-height:100px;';
    body.addEventListener('dragover',e=>{e.preventDefault();body.style.background='rgba(86,156,214,0.08)';});
    body.addEventListener('dragleave',()=>{body.style.background='';});
    body.addEventListener('drop',async e=>{e.preventDefault();body.style.background='';let data;try{data=JSON.parse(e.dataTransfer.getData('text/plain'));}catch{return;}if(!data||!data.name)return;
      _calPushUndo('タスク移動');
      const ev=events.find(x=>x.name===data.name);const oldDesc=(ev?.description||'').replace(/status:\w+/,'status:'+s.key);
      try{await apiPut('/calendar-db/events/'+encodeURIComponent(data.name),{db_path:dbPath,description:oldDesc,color:_calendarTaskStatusColor(s.key)});await _refreshCalendarDb(dbPath);}catch{};
    });
    taskEvs.forEach(ev=>{
      const card=document.createElement('div');
      const priority=(ev.description||'').match(/priority:(\w+)/)?.[1]||'medium';
      const prioColors={urgent:'#e06c75',high:'#d19a66',medium:'#569cd6',low:'var(--fg2)'};
      card.style.cssText=`background:var(--bg3);border:1px solid var(--border);border-radius:4px;padding:6px;margin:4px 0;cursor:pointer;font-size:11px;border-left:3px solid ${prioColors[priority]||'#569cd6'};`;
      card.draggable=true;
      card.addEventListener('dragstart',e2=>{e2.dataTransfer.setData('text/plain',JSON.stringify({name:ev.name,file:ev.file}));card.style.opacity='0.4';});
      card.addEventListener('dragend',()=>{card.style.opacity='';});
      const titleDiv=document.createElement('div');titleDiv.style.fontWeight='bold';titleDiv.textContent=ev.name;
      card.appendChild(titleDiv);
      // メタ行
      const meta=document.createElement('div');meta.style.cssText='font-size:10px;color:var(--fg2);margin-top:2px;display:flex;gap:6px;';
      meta.innerHTML=`<span style="color:${prioColors[priority]}">${priority}</span>`;
      if(ev.end&&!isNaN(ev.end.getTime())) meta.innerHTML+=`<span>〆${_dateStr(ev.end).substring(5,10)}</span>`;
      if(ev.calendarId&&ev.calendarId!=='default') meta.innerHTML+=`<span>${esc(ev.calendarId)}</span>`;
      card.appendChild(meta);
      card.addEventListener('click', ()=>_openTaskModal(dbPath,ev));
      body.appendChild(card);
    });
    const addBtn=document.createElement('div');addBtn.style.cssText='padding:4px;text-align:center;color:var(--fg2);font-size:11px;cursor:pointer;';
    addBtn.textContent='+ 追加';addBtn.addEventListener('click', ()=>_openTaskModal(dbPath,null,s.key));
    body.appendChild(addBtn);
    col.appendChild(body);board.appendChild(col);
  });
  container.appendChild(board);
}

/* ==============================
   シフト表（予定 + 実績 2行、打刻パネル）
   ============================== */
function _renderShiftView(container, dbPath, events) {
  const curDate=getCalendarDate(dbPath);
  const y=curDate.getFullYear(),m=curDate.getMonth();
  const daysInMonth=new Date(y,m+1,0).getDate();
  const dayNames=_getDayNames();
  const todayStr=_dateStr(new Date());
  // 打刻パネル
  const clockPanel=document.createElement('div');
  clockPanel.style.cssText='display:flex;gap:8px;align-items:center;margin-bottom:8px;padding:4px 8px;background:var(--bg2);border:1px solid var(--border);border-radius:4px;font-size:12px;';
  clockPanel.innerHTML=`<span style="font-weight:bold;">打刻:</span>
    <button class="tl-nav-btn" data-action="_clockAction('clock_in')">出勤</button>
    <button class="tl-nav-btn" data-action="_clockAction('clock_out')">退勤</button>
    <button class="tl-nav-btn" data-action="_clockAction('break_start')">休憩開始</button>
    <button class="tl-nav-btn" data-action="_clockAction('break_end')">休憩終了</button>
    <span id="clock-status" style="color:var(--fg2);"></span>`;
  container.appendChild(clockPanel);
  _updateClockStatus();

  const users=[...new Set([_getUser(), ...events.map(e=>e.calendarId||'default')].map(name => String(name || '').trim()).filter(Boolean))];
  if (!users.length) users.push('default');
  const eventOverlapsDay = (ev, ds) => {
    const start = new Date(ev.start); start.setHours(0,0,0,0);
    const end = new Date(ev.end || ev.start); end.setHours(0,0,0,0);
    const day = _parseCalendarDateValue(ds);
    return start <= day && day <= end;
  };
  const table=document.createElement('div');table.style.cssText='overflow-x:auto;';
  let html='<table style="border-collapse:collapse;font-size:10px;width:max-content;">';
  html+='<tr><th style="border:1px solid var(--border);padding:2px 4px;background:var(--bg3);position:sticky;left:0;z-index:2;min-width:80px;">ユーザー</th>';
  for(let d=1;d<=daysInMonth;d++){const ds=`${y}-${_p2(m+1)}-${_p2(d)}`;const dow=new Date(y,m,d).getDay();const isToday=ds===todayStr;const isWe=dow===0||dow===6;
    html+=`<th style="border:1px solid var(--border);padding:2px 4px;background:${isToday?'var(--accent)':isWe?'var(--bg4)':'var(--bg3)'};color:${isToday?'var(--ui-fg-strong)':'var(--fg2)'};min-width:36px;text-align:center;">${d}<br>${['日','月','火','水','木','金','土'][dow]}</th>`;}
  html+='</tr>';
  users.forEach(user=>{
    // 予定行
    html+=`<tr><td style="border:1px solid var(--border);padding:2px 6px;background:var(--bg2);font-weight:bold;position:sticky;left:0;z-index:1;white-space:nowrap;">${esc(user)}<br><span style="font-size:9px;color:var(--fg2);">予定</span></td>`;
    for(let d=1;d<=daysInMonth;d++){const ds=`${y}-${_p2(m+1)}-${_p2(d)}`;
      // user==='default' はマッピングのない（calendarId 未設定）のイベントのみ拾う。
      // 以前の `user==='default'` ショートカットは全ユーザーの予定を default 行にも重複表示してしまっていた。
      const dayEvs=events.filter(ev=>{
        const cid=ev.calendarId||'default';
        return cid===user && eventOverlapsDay(ev, ds);
      });
      const isWe=new Date(y,m,d).getDay()===0||new Date(y,m,d).getDay()===6;
      let content='',bg=isWe?'var(--bg4)':'';
      if(dayEvs.length>0){content=dayEvs.map(ev=>ev.allDay?lucide('circle',8):`${_p2(ev.start.getHours())}:${_p2(ev.start.getMinutes())}-${_p2(ev.end.getHours())}:${_p2(ev.end.getMinutes())}`).join('<br>');bg=_calendarSafeTintColor(dayEvs[0].color);}
      html+=`<td style="border:1px solid var(--border);padding:1px 2px;text-align:center;cursor:pointer;${bg?'background:'+bg+';':''}" data-cal-shift-date="${ds}" data-cal-shift-user="${esc(user)}">${content}</td>`;
    }
    html+='</tr>';
    // 実績行（簡易 — 打刻データはAPIから取得する必要があるが、現時点ではイベントデータのみ）
    html+=`<tr><td style="border:1px solid var(--border);padding:2px 6px;background:var(--bg);position:sticky;left:0;z-index:1;"><span style="font-size:9px;color:var(--fg2);">実績</span></td>`;
    for(let d=1;d<=daysInMonth;d++){html+=`<td style="border:1px solid var(--border);padding:1px 2px;text-align:center;font-size:9px;color:var(--fg2);"></td>`;}
    html+='</tr>';
  });
  // 合計行
  html+='<tr><td style="border:1px solid var(--border);padding:2px 6px;background:var(--bg3);font-weight:bold;position:sticky;left:0;z-index:1;">合計</td>';
  for(let d=1;d<=daysInMonth;d++){const ds=`${y}-${_p2(m+1)}-${_p2(d)}`;const count=events.filter(ev=>eventOverlapsDay(ev, ds)).length;
    html+=`<td style="border:1px solid var(--border);padding:1px 2px;text-align:center;font-size:9px;background:var(--bg3);">${count||''}</td>`;}
  html+='</tr></table>';
  table.innerHTML=html;
  table.querySelectorAll('[data-cal-shift-date]').forEach(cell => {
    cell.addEventListener('dblclick', () => {
      const day = _parseCalendarDateValue(cell.dataset.calShiftDate);
      const start = new Date(day);
      start.setHours(9,0,0,0);
      const end = new Date(day);
      end.setHours(18,0,0,0);
      _openEventEditPanel(dbPath, null, start, end, false, cell.dataset.calShiftUser || 'default');
    });
  });
  container.appendChild(table);
}

/* ==============================
   打刻
   ============================== */
async function _clockAction(type) {
  try{await apiPost('/cal/time',{type,user:_getUser(),timestamp:_toCalendarInputValue(new Date())});
    const labels={clock_in:'出勤しました',clock_out:'退勤しました',break_start:'休憩開始',break_end:'休憩終了'};
    showStatus(labels[type]||type);_updateClockStatus();
  }catch{showStatus('打刻に失敗',true);}
}
async function _updateClockStatus() {
  // v5.0: CalendarComponent内の.gb-cal-clock-status-textも探す
  const el=document.getElementById('clock-status') || document.querySelector('.gb-cal-clock-status-text');if(!el)return;
  try{const entries=await apiFetch('/cal/time?user='+encodeURIComponent(_getUser())+'&date_from='+_dateStr(new Date()));
    const last=entries[entries.length-1];if(!last){el.textContent='未出勤';return;}
    const labels={clock_in:'出勤中',clock_out:'退勤済み',break_start:'休憩中',break_end:'勤務中'};
    const parsed = _parseCalendarDateValue(last.timestamp || '');
    const timeText = _calendarTimeLabel(parsed) || (last.timestamp||'').substring(11,16);
    el.textContent=(labels[last.type]||last.type)+' '+timeText;
  }catch{el.textContent='';}
}

/* ==============================
   ミニカレンダー
   ============================== */
function _renderMiniCalendar(sidebar,dbPath,events) {
  const curDate=getCalendarDate(dbPath);const y=curDate.getFullYear(),m=curDate.getMonth();
  const box=document.createElement('div');box.style.cssText='background:var(--bg2);border:1px solid var(--border);border-radius:4px;padding:6px;';
  const hdr=document.createElement('div');hdr.style.cssText='display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;';
  hdr.innerHTML=`<button class="tl-nav-btn" type="button" data-e2e-id="calendar-mini-prev-month" aria-label="前の月" title="前の月" style="padding:0 4px;">${lucide('chevronLeft', 12)}</button><span style="font-size:11px;font-weight:bold;">${y}年${m+1}月</span><button class="tl-nav-btn" type="button" data-e2e-id="calendar-mini-next-month" aria-label="次の月" title="次の月" style="padding:0 4px;">${lucide('chevronRight', 12)}</button>`;
  hdr.children[0].addEventListener('click', ()=>{setCalendarDate(dbPath,_addCalendarMonthsClamped(getCalendarDate(dbPath),-1));_rerenderCalendarDb(dbPath);});
  hdr.children[2].addEventListener('click', ()=>{setCalendarDate(dbPath,_addCalendarMonthsClamped(getCalendarDate(dbPath),1));_rerenderCalendarDb(dbPath);});
  box.appendChild(hdr);
  const grid=document.createElement('div');grid.style.cssText='display:grid;grid-template-columns:repeat(7,1fr);gap:0;text-align:center;';
  _getDayNames().forEach(dn=>{const h=document.createElement('div');h.style.cssText='font-size:9px;color:var(--fg2);padding:1px;';h.textContent=dn;grid.appendChild(h);});
  const firstDay=(new Date(y,m,1).getDay()-_calStartDay+7)%7;
  const daysInMonth=new Date(y,m+1,0).getDate();
  const todayStr=_dateStr(new Date()),selStr=_dateStr(curDate);
  for(let i=0;i<firstDay;i++){grid.appendChild(document.createElement('div'));}
  for(let d=1;d<=daysInMonth;d++){
    const ds=`${y}-${_p2(m+1)}-${_p2(d)}`;const el=document.createElement('div');
    el.style.cssText='font-size:10px;padding:2px;cursor:pointer;border-radius:3px;';
    if(ds===todayStr)el.style.cssText+='color:var(--accent);font-weight:bold;';
    if(ds===selStr)el.style.cssText+='background:var(--accent);color:var(--ui-fg-strong);';
    const hasEv=events.some(ev=>{
      const s=new Date(ev.start);s.setHours(0,0,0,0);
      const e=new Date(ev.end||ev.start);e.setHours(0,0,0,0);
      const day=new Date(y,m,d);day.setHours(0,0,0,0);
      return s<=day&&day<=e;
    });
    el.textContent=d;if(hasEv&&ds!==selStr)el.style.cssText+='text-decoration:underline;';
    el.addEventListener('click', ()=>{setCalendarDate(dbPath,_parseCalendarDateValue(ds));_rerenderCalendarDb(dbPath);});
    grid.appendChild(el);
  }
  box.appendChild(grid);
  if (sidebar) sidebar.appendChild(box);
  return box;
}

/* ==============================
   本日のイベント + タスク
   ============================== */
function _renderTodayWidget(sidebar,dbPath,events) {
  const mappedDb = !!_calRenderState.info?.isMappedDb;
  const today=new Date();today.setHours(0,0,0,0);
  const todayEvs=events.filter(ev=>{const s=new Date(ev.start);s.setHours(0,0,0,0);const e=new Date(ev.end);e.setHours(0,0,0,0);return today>=s&&today<=e;});
  // 未完了タスク（期限が今日以前 or ステータスがdone/backlog以外）
  const activeTasks=events.filter(ev=>_isTask(ev)&&_taskStatus(ev)!=='done'&&_taskStatus(ev)!=='backlog');
  const todayTasks=activeTasks.filter(ev=>{const s=new Date(ev.start);s.setHours(0,0,0,0);return s<=today;});

  // 2026-04-17: detail-panel-section-unification-plan.md に基づき .gb-section.gb-section--detail でくくる
  const box=document.createElement('div');
  // イベントセクション
  const evSection=document.createElement('section');evSection.className='gb-section gb-section--detail';
  const evHdr=document.createElement('div');evHdr.className='gb-section-title';
  evHdr.textContent=`今日のイベント (${todayEvs.filter(e=>!_isTask(e)).length})`;evSection.appendChild(evHdr);
  const pureEvents=todayEvs.filter(e=>!_isTask(e));
  if(!pureEvents.length){const e=document.createElement('div');e.style.cssText='font-size:10px;color:var(--fg2);';e.textContent='イベントなし';evSection.appendChild(e);}
  else pureEvents.forEach(ev=>{const el=document.createElement('div');el.style.cssText='font-size:10px;padding:2px 4px;margin:2px 0;border-radius:3px;cursor:pointer;color:#fff;';el.style.background=ev.color;
    const timeStr=ev.allDay?'終日':`${_p2(ev.start.getHours())}:${_p2(ev.start.getMinutes())}`;
    el.textContent=`${timeStr} ${ev.name}`;el.addEventListener('click', ()=>{if(ev._mapped&&typeof _openMappedCalendarEventPanel==='function'){_openMappedCalendarEventPanel(dbPath,ev,el);return;}_showCalendarEventDetailPanel(dbPath,ev);});evSection.appendChild(el);});
  box.appendChild(evSection);
  // タスクセクション
  if(todayTasks.length>0){
    const tkSection=document.createElement('section');tkSection.className='gb-section gb-section--detail';
    const tkHdr=document.createElement('div');tkHdr.className='gb-section-title';
    tkHdr.textContent=`ToDo (${todayTasks.length})`;tkSection.appendChild(tkHdr);
    todayTasks.slice(0,10).forEach(ev=>{
      const el=document.createElement('div');el.style.cssText='font-size:10px;padding:2px 4px;margin:2px 0;cursor:pointer;display:flex;align-items:center;gap:4px;';
      const prioColors={urgent:'var(--red)',high:'var(--orange)',medium:'var(--blue)',low:'var(--fg2)'};
      const p=_taskPriority(ev);
      el.innerHTML=`<span style="color:${prioColors[p]||'var(--fg2)'};font-weight:bold;">${(p[0]||'M').toUpperCase()}</span> ${esc(ev.name)}`;
      el.addEventListener('click', ()=>{if(mappedDb&&ev._mapped&&typeof _openMappedCalendarEventPanel==='function'){_openMappedCalendarEventPanel(dbPath,ev,el);return;}_openTaskModal(dbPath,ev);});tkSection.appendChild(el);
    });
    box.appendChild(tkSection);
  }
  if (sidebar) sidebar.appendChild(box);
  return box;
}

/* ==============================
   カレンダーリスト（フィルタ付き）
   ============================== */
let _calVisibleIds = null;
let _calKnownIds = null;
function _renderCalendarList(sidebar,dbPath,events) {
  const calIds=[...new Set(events.map(e=>e.calendarId||'default'))];
  if(calIds.length<=1) return;
  if(!_calVisibleIds) _calVisibleIds=new Set(calIds);
  const box=document.createElement('div');box.style.cssText='background:var(--bg2);border:1px solid var(--border);border-radius:4px;padding:6px;';
  const hdr=document.createElement('div');hdr.style.cssText='font-size:11px;font-weight:bold;margin-bottom:4px;';hdr.textContent='カレンダー';box.appendChild(hdr);
  calIds.forEach(cid=>{
    const el=document.createElement('label');el.style.cssText='display:flex;align-items:center;gap:4px;font-size:10px;padding:2px 0;cursor:pointer;';
    const cb=document.createElement('input');cb.type='checkbox';cb.checked=_calVisibleIds.has(cid);
    cb.onchange=()=>{if(cb.checked)_calVisibleIds.add(cid);else _calVisibleIds.delete(cid);_rerenderCalendarDb(dbPath);};
    const dot=document.createElement('span');dot.style.cssText='width:8px;height:8px;border-radius:50%;flex-shrink:0;';
    const evOfCal=events.find(e=>e.calendarId===cid);dot.style.background=evOfCal?evOfCal.color:'#569cd6';
    el.appendChild(cb);el.appendChild(dot);el.appendChild(document.createTextNode(cid));box.appendChild(el);
  });
  sidebar.appendChild(box);
}

/* ==============================
   アラームチェッカー
   ============================== */
function _startAlarmChecker(dbPath,events) {
  if(_calAlarmInterval) clearInterval(_calAlarmInterval);
  const check=()=>{
    const now=Date.now();
    events.forEach(ev=>{
      if(ev.alertMinutes<0) return;
      const alertTime=ev.start.getTime()-ev.alertMinutes*60000;
      const key=ev.name+'_'+alertTime;
      if(_calAlertedIds.has(key)) return;
      // 過去24時間以内に発生すべきだった通知も発火（120秒窓を逃した場合の補償）
      if(now>=alertTime && now<ev.start.getTime()+86400000){
        _calAlertedIds.add(key);
        _persistAlertedIds();
        if('Notification' in window && Notification.permission==='granted') new Notification('Meldex カレンダー',{body:ev.name+'\n'+_calendarTimeLabel(ev.start),icon:'/Meldex_icon.png'});
        showStatus('🔔 '+ev.name);
      }
    });
  };
  check();
  _calAlarmInterval=setInterval(check,60000);
}

/* ==============================
   スケジュールテンプレート
   ============================== */
const _dayLabels = ['日','月','火','水','木','金','土'];

async function _showTemplateModal(dbPath) {
  let templates = [];
  try { templates = await apiFetch('/cal/schedule-templates?user=' + encodeURIComponent(_getUser())); } catch {}
  const o = document.createElement('div'); o.className = 'modal-overlay';
  let html = `<div class="modal" style="${_calendarModalSizeStyle(600)}"><h3>週間テンプレート</h3>`;
  html += '<div id="tmpl-list">';
  if (!templates.length) html += '<div style="color:var(--fg2);font-size:12px;padding:8px;">テンプレートがありません</div>';
  templates.forEach(t => {
    html += `<div style="border:1px solid var(--border);border-radius:4px;padding:8px;margin-bottom:8px;">`;
    html += `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">`;
    html += `<strong>${esc(t.name)}</strong><div>`;
    html += `<button data-action="edit" data-tid="${esc(t.id)}" style="font-size:11px;padding:2px 8px;margin-right:4px;">編集</button>`;
    html += `<button data-action="delete" data-tid="${esc(t.id)}" style="font-size:11px;padding:2px 8px;color:var(--red);margin-right:4px;">削除</button>`;
    html += `<button data-action="generate" data-tid="${esc(t.id)}" style="font-size:11px;padding:2px 8px;background:var(--accent);color:var(--ui-fg-strong);border:none;border-radius:3px;cursor:pointer;">一括生成</button>`;
    html += '</div></div>';
    (t.entries || []).forEach(e => {
      const endTime = _addMinutes(e.startTime || '09:00', e.duration || 60);
      html += `<div style="font-size:11px;color:var(--fg2);padding:1px 0;">${_dayLabels[e.dayOfWeek]} ${e.startTime}〜${endTime} ${esc(e.title || '')}</div>`;
    });
    html += '</div>';
  });
  html += '</div>';
  html += '<div class="btn-row"><button id="tmpl-create">新規テンプレート</button><button data-action="this.closest(\'.modal-overlay\').remove()">閉じる</button></div>';
  html += '</div>';
  o.innerHTML = html;
  document.body.appendChild(o);

  // イベントハンドラ
  o.querySelectorAll('[data-action="edit"]').forEach(btn => btn.addEventListener('click', () => { o.remove(); _editTemplate(dbPath, btn.dataset.tid); }));
  o.querySelectorAll('[data-action="delete"]').forEach(btn => btn.addEventListener('click', async () => {
    const target = templates.find(t => String(t.id) === String(btn.dataset.tid));
    const name = target?.name || 'テンプレート';
    if (!await cfConfirm(`${name} を削除しますか？`)) return;
    try { await apiDelete('/cal/schedule-templates/' + btn.dataset.tid); } catch {}
    o.remove(); _showTemplateModal(dbPath);
  }));
  o.querySelectorAll('[data-action="generate"]').forEach(btn => btn.addEventListener('click', () => _generateFromTemplate(dbPath, btn.dataset.tid, templates, o)));
  o.querySelector('#tmpl-create').addEventListener('click', async () => {
    let idx = 1, name = '無題';
    const names = templates.map(t => t.name);
    while (names.includes(name)) { idx++; name = '無題' + idx; }
    try {
      const res = await apiPost('/cal/schedule-templates', { name, entries: [], user: _getUser() });
      o.remove(); _editTemplate(dbPath, res.id);
    } catch { showStatus('作成に失敗', true); }
  });
}

function _addMinutes(timeStr, minutes) {
  const [h, m] = (timeStr || '09:00').split(':').map(Number);
  const total = h * 60 + m + (minutes || 0);
  return _p2(Math.floor(total / 60) % 24) + ':' + _p2(total % 60);
}

async function _editTemplate(dbPath, tid) {
  let templates = [];
  try { templates = await apiFetch('/cal/schedule-templates?user=' + encodeURIComponent(_getUser())); } catch {}
  const t = templates.find(x => x.id === tid);
  if (!t) return;

  const o = document.createElement('div'); o.className = 'modal-overlay';
  let entriesHtml = '';
  (t.entries || []).forEach(e => { entriesHtml += _templateEntryRow(e); });

  o.innerHTML = `<div class="modal" style="${_calendarModalSizeStyle(550)}">
    <h3>テンプレート編集: ${esc(t.name)}</h3>
    <div class="field"><label>名前</label><input id="tmpl-name" type="text" value="${esc(t.name)}"></div>
    <div style="font-size:12px;color:var(--fg2);margin-bottom:4px;">エントリ（1週間分）</div>
    <div id="tmpl-entries">${entriesHtml}</div>
    <button id="tmpl-add-entry" style="font-size:12px;padding:2px 8px;margin:4px 0;">+ エントリ追加</button>
    <div class="btn-row">
      <button id="tmpl-cancel">キャンセル</button>
      <button class="primary" id="tmpl-save">保存</button>
    </div>
  </div>`;
  document.body.appendChild(o);
  o.querySelector('#tmpl-add-entry').addEventListener('click', () => { o.querySelector('#tmpl-entries').insertAdjacentHTML('beforeend', _templateEntryRow({})); });
  o.querySelector('#tmpl-cancel').addEventListener('click', () => { o.remove(); _showTemplateModal(dbPath); });
  o.querySelector('#tmpl-save').addEventListener('click', async () => {
    const name = o.querySelector('#tmpl-name').value.trim() || '無題';
    const entries = [];
    o.querySelectorAll('#tmpl-entries .tmpl-entry').forEach(row => {
      entries.push({
        dayOfWeek: parseInt(row.querySelector('[data-field="dayOfWeek"]').value),
        startTime: row.querySelector('[data-field="startTime"]').value,
        duration: parseInt(row.querySelector('[data-field="duration"]').value) || 60,
        title: row.querySelector('[data-field="title"]').value.trim(),
      });
    });
    try { await apiPut('/cal/schedule-templates/' + tid, { name, entries }); showStatus('テンプレートを保存しました'); } catch { showStatus('保存に失敗', true); }
    o.remove(); _showTemplateModal(dbPath);
  });
}

function _templateEntryRow(entry) {
  return `<div class="tmpl-entry" style="display:flex;gap:4px;align-items:center;margin-bottom:4px;font-size:12px;">
    <select data-field="dayOfWeek" class="gb-select gb-select-sm">
      ${_dayLabels.map((d,i) => `<option value="${i}" ${(entry?.dayOfWeek??0)===i?'selected':''}>${d}</option>`).join('')}
    </select>
    <input type="time" data-field="startTime" value="${entry?.startTime||'09:00'}" style="padding:2px;background:var(--bg);color:var(--fg);border:1px solid var(--border);border-radius:3px;">
    <input type="number" data-field="duration" value="${entry?.duration||60}" min="5" step="5" style="width:60px;padding:2px;background:var(--bg);color:var(--fg);border:1px solid var(--border);border-radius:3px;" title="分">
    <span style="color:var(--fg2);">分</span>
    <input type="text" data-field="title" value="${esc(entry?.title||'')}" placeholder="タイトル" style="flex:1;padding:2px 4px;background:var(--bg);color:var(--fg);border:1px solid var(--border);border-radius:3px;">
    <button data-action="this.closest('.tmpl-entry').remove()" style="background:none;border:none;color:var(--red);cursor:pointer;display:flex;align-items:center;">${lucide('x', 14)}</button>
  </div>`;
}

async function _generateFromTemplate(dbPath, tid, templates, modalEl) {
  const t = templates.find(x => x.id === tid);
  if (!t || !t.entries?.length) { showStatus('エントリがありません', true); return; }
  const weeks = parseInt(await cfPrompt('何週間分生成しますか？', '4')) || 0;
  if (weeks <= 0) return;
  const curDate = getCalendarDate(dbPath);
  const startDate = _weekStart(curDate);
  let count = 0;
  _calPushUndo('テンプレート一括生成');
  for (let w = 0; w < weeks; w++) {
    for (const entry of t.entries) {
      const d = new Date(startDate);
      const dayOffset = (entry.dayOfWeek - _calStartDay + 7) % 7;
      d.setDate(d.getDate() + w * 7 + dayOffset);
      const [h, m] = (entry.startTime || '09:00').split(':').map(Number);
      d.setHours(h, m, 0, 0);
      const endD = new Date(d.getTime() + (entry.duration || 60) * 60000);
      try {
        await apiPost('/calendar-db/events', {
          db_path: dbPath, title: entry.title || '無題',
          start: _toCalendarApiValue(d, false), end: _toCalendarApiValue(endD, false),
          creator: _getUser(), members: [],
        });
        count++;
      } catch {}
    }
  }
  if (modalEl) modalEl.remove();
  await _refreshCalendarDb(dbPath);
  showStatus(`${count}件のイベントを生成しました`);
}

/* ==============================
   同期モーダル（Google Calendar + iCal + CSV + テンプレート）
   ============================== */
function _showSyncModal(dbPath) {
  const o = document.createElement('div'); o.className = 'modal-overlay';
  o.innerHTML = `<div class="modal" style="${_calendarModalSizeStyle(500, null, { forceHeight: true })}">
    <h3>カレンダー同期・ツール</h3>

    <div style="padding:10px;background:var(--bg);border:1px solid var(--border);border-radius:4px;margin-bottom:10px;">
      <div style="font-size:13px;font-weight:bold;margin-bottom:8px;">Google Calendar</div>
      <div id="sync-google-status" style="font-size:12px;color:var(--fg2);margin-bottom:8px;">確認中...</div>
      <div id="sync-google-auth" style="display:none;">
        <div class="field"><label>Client ID</label><input id="sync-gcal-id" type="text" placeholder="Google Cloud Consoleで取得"></div>
        <div class="field"><label>Client Secret</label><input id="sync-gcal-secret" type="password"></div>
        <button id="sync-gcal-auth-btn" style="font-size:12px;padding:4px 12px;background:var(--accent);color:var(--ui-fg-strong);border:none;border-radius:4px;cursor:pointer;">Google認証開始</button>
      </div>
      <div id="sync-google-actions" style="display:none;gap:4px;">
        <button id="sync-gcal-pull" style="font-size:12px;padding:4px 12px;">← Googleから取得</button>
        <button id="sync-gcal-push" style="font-size:12px;padding:4px 12px;">→ Googleに送信</button>
      </div>
    </div>

    <div style="padding:10px;background:var(--bg);border:1px solid var(--border);border-radius:4px;margin-bottom:10px;">
      <div style="font-size:13px;font-weight:bold;margin-bottom:8px;">iCal / .ics</div>
      <div style="display:flex;gap:4px;flex-wrap:wrap;">
        <button id="sync-ical-import" style="font-size:12px;padding:4px 12px;">.icsインポート</button>
        <button id="sync-ical-export" style="font-size:12px;padding:4px 12px;">.icsエクスポート</button>
      </div>
      <div style="font-size:11px;color:var(--fg2);margin-top:4px;">iPhone・Outlook・Nextcloud等と互換</div>
    </div>

    <div style="padding:10px;background:var(--bg);border:1px solid var(--border);border-radius:4px;margin-bottom:10px;">
      <div style="font-size:13px;font-weight:bold;margin-bottom:8px;">打刻CSVエクスポート</div>
      <div style="font-size:11px;color:var(--fg2);margin-bottom:6px;">予定ではなく、出勤・退勤などの打刻データをCSV出力</div>
      <div style="display:flex;gap:4px;align-items:center;flex-wrap:wrap;margin-bottom:4px;">
        <label style="font-size:11px;">開始: <input id="csv-from" type="date" style="padding:2px;font-size:11px;background:var(--bg);color:var(--fg);border:1px solid var(--border);border-radius:3px;"></label>
        <label style="font-size:11px;">終了: <input id="csv-to" type="date" style="padding:2px;font-size:11px;background:var(--bg);color:var(--fg);border:1px solid var(--border);border-radius:3px;"></label>
      </div>
      <div style="display:flex;gap:4px;flex-wrap:wrap;">
        <button id="csv-generic" style="font-size:12px;padding:4px 12px;">汎用CSV</button>
        <button id="csv-smaregi" style="font-size:12px;padding:4px 12px;">スマレジ形式</button>
        <button id="csv-mf" style="font-size:12px;padding:4px 12px;">マネーフォワード形式</button>
      </div>
    </div>

    <div style="padding:10px;background:var(--bg);border:1px solid var(--border);border-radius:4px;margin-bottom:10px;">
      <div style="font-size:13px;font-weight:bold;margin-bottom:8px;">週間テンプレート</div>
      <button id="sync-templates" style="font-size:12px;padding:4px 12px;">テンプレート管理</button>
    </div>

    <div style="padding:10px;background:var(--bg);border:1px solid var(--border);border-radius:4px;margin-bottom:10px;">
      <div style="font-size:13px;font-weight:bold;margin-bottom:8px;">CalDAV</div>
      <div style="font-size:11px;color:var(--fg2);margin-bottom:6px;">CalDAVサーバーとの双方向同期</div>
      <div style="display:flex;gap:4px;flex-wrap:wrap;">
        <button id="sync-caldav-push" style="font-size:12px;padding:4px 12px;">→ CalDAVに送信</button>
        <button id="sync-caldav-pull" style="font-size:12px;padding:4px 12px;">← CalDAVから取得</button>
      </div>
    </div>

    <div style="padding:10px;background:var(--bg);border:1px solid var(--border);border-radius:4px;margin-bottom:10px;">
      <div style="font-size:13px;font-weight:bold;margin-bottom:8px;">旧データ移行</div>
      <div style="font-size:11px;color:var(--fg2);margin-bottom:6px;">旧カレンダーデータを新形式に変換</div>
      <button id="sync-migrate" style="font-size:12px;padding:4px 12px;">マイグレーション実行</button>
    </div>

    <div class="btn-row"><button data-action="this.closest('.modal-overlay').remove()">閉じる</button></div>
  </div>`;
  document.body.appendChild(o);

  // Google Calendar ステータス確認
