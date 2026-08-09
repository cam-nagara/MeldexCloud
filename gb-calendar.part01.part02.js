        el.addEventListener('dragend',()=>{el.style.opacity='';});
      }
      el.addEventListener('click', e2=>{e2.stopPropagation();if(ev._mapped&&typeof _openMappedCalendarEventPanel==='function'){_openMappedCalendarEventPanel(dbPath,ev,el);return;}_showCalendarEventDetailPanel(dbPath,ev);});
      cell.appendChild(el);
    });
    if(dayEvs.length>3){const more=document.createElement('div');more.className='cal-month-more';more.textContent=`+${dayEvs.length-3}`;cell.appendChild(more);}
    if (canEditDates) {
      cell.addEventListener('dragover',e2=>{e2.preventDefault();cell.style.background='rgba(86,156,214,0.15)';});
      cell.addEventListener('dragleave',()=>{cell.style.background='';});
      // 月ビューの drop: ターゲットセルは 00:00。_handleEventDrop 側で元の時刻を復元する
      cell.addEventListener('drop',e2=>{e2.preventDefault();cell.style.background='';_handleEventDrop(dbPath,e2,cellDate,{preserveTime:true});});
    }
    if (canCreateEvents) {
      _bindCalendarCellAddButton(cell, () => _quickCreateCalendarEvent(dbPath, { start: new Date(cellDate), end: new Date(cellDate), allDay: true }));
      cell.addEventListener('pointerdown', (e2) => {
        if (e2.button !== 0) return;
        if (e2.target.closest('.cal-month-event, .cal-month-more, .cal-cell-quick-add')) return;
        dragState = { startToken: cell.dataset.date, endToken: cell.dataset.date, moved: false };
        applyRangePreview(dragState.startToken, dragState.endToken);
      });
      cell.addEventListener('pointerenter', () => {
        if (!dragState) return;
        if (dragState.endToken !== cell.dataset.date) dragState.moved = true;
        dragState.endToken = cell.dataset.date;
        applyRangePreview(dragState.startToken, dragState.endToken);
      });
      cell.addEventListener('pointerup', async () => {
        if (!dragState) return;
        const current = dragState;
        dragState = null;
        clearRangePreview();
        if (!current.moved) return;
        const [startRange, endRange] = _sortCalendarRange(_parseCalendarDateValue(current.startToken), _parseCalendarDateValue(current.endToken));
        await _quickCreateCalendarEvent(dbPath, { start: startRange, end: endRange, allDay: true });
      });
    }
    grid.appendChild(cell); d.setDate(d.getDate()+1);
  }
  if (window._calMonthPointerUp) document.removeEventListener('pointerup', window._calMonthPointerUp);
  window._calMonthPointerUp = () => {
    if (!dragState) return;
    dragState = null;
    clearRangePreview();
  };
  document.addEventListener('pointerup', window._calMonthPointerUp);
  main.appendChild(grid); wrapper.appendChild(main);
  const sidebar=document.createElement('div'); sidebar.style.cssText='width:200px;flex-shrink:0;display:flex;flex-direction:column;gap:8px;';
  _renderCalendarList(sidebar,dbPath,_calRenderState.allEvents || events);
  if (sidebar.childElementCount > 0) wrapper.appendChild(sidebar);
  container.appendChild(wrapper);
}

/* ==============================
   週表示（ピクセル精度位置 + リサイズ + ドラッグ作成）
   ============================== */
const _HOUR_PX = 40;

function _renderWeek(container, dbPath, events) {
  const canEditDates = !!_calRenderState.info?.canEditDates;
  const canCreateEvents = !!_calRenderState.info?.canCreateEvents;
  const curDate=getCalendarDate(dbPath), ws=_weekStart(curDate);
  const dayNames=_getDayNames();
  const grid=document.createElement('div'); grid.className='cal-week-grid';
  grid.style.gridTemplateColumns=`50px repeat(7, 1fr)`;
  // ヘッダー
  const corner=document.createElement('div'); corner.className='cal-week-corner'; grid.appendChild(corner);
  const dayDates=[];
  for(let di=0;di<7;di++){const dd=new Date(ws);dd.setDate(dd.getDate()+di);dayDates.push(dd);const h=document.createElement('div');h.className='cal-week-header';h.textContent=`${dayNames[di]} ${dd.getDate()}`;grid.appendChild(h);}

  // 時間行 + イベントカラム
  let dragState=null;
  for(let hour=0;hour<24;hour++){
    const tl=document.createElement('div');tl.className='cal-week-time';tl.textContent=`${hour}:00`;tl.style.height=_HOUR_PX+'px';grid.appendChild(tl);
    for(let di=0;di<7;di++){
      const cell=document.createElement('div');cell.className='cal-week-cell';cell.style.height=_HOUR_PX+'px';cell.style.position='relative';
      const cd=new Date(dayDates[di]);cd.setHours(hour,0,0,0);
      cell.dataset.date=_dateStr(cd);cell.dataset.hour=hour;
      // イベントカード（ピクセル精度位置。日またぎイベントは各日の先頭セルに描画）
      const cellDay=cd.toDateString();
      const cellDayDate0=new Date(cd);cellDayDate0.setHours(0,0,0,0);
      const cellEvents=events.filter(ev=>{
        if(!_calendarEventOccursOnDay(ev,cellDayDate0)) return false;
        if(ev.allDay) return hour===0;
        return Math.floor(_calendarEventSegmentHours(ev,cellDayDate0).start)===hour;
      });
      const overlapLayouts=_calendarEventOverlapLayouts(cellEvents,cellDayDate0);
      cellEvents.forEach(ev=>{
        const segment=_calendarEventSegmentHours(ev,cellDayDate0);
        const card=_createWeekEventCard(dbPath,ev,segment.start,segment.end,cellDayDate0,overlapLayouts.get(ev));
        cell.appendChild(card);
      });
      // ドラッグ作成
      if (canCreateEvents) {
        _bindCalendarCellAddButton(cell, () => {
          const s = new Date(cd);
          const e = new Date(cd);
          e.setHours(e.getHours() + 1);
          return _quickCreateCalendarEvent(dbPath, { start: s, end: e, allDay: false });
        });
        cell.addEventListener('pointerdown',e=>{if(e.button!==0||e.target.closest('.cal-day-event, .cal-cell-quick-add'))return;e.preventDefault();dragState={startDate:cell.dataset.date,startHour:hour,pv:null,moved:false};document.body.style.userSelect='none';const pv=document.createElement('div');pv.className='cal-day-event cal-drag-preview';pv.style.cssText=`position:absolute;left:0;right:0;top:0;height:${_HOUR_PX}px;background:var(--accent);opacity:0.6;pointer-events:none;z-index:5;`;pv.textContent=`${hour}:00–${hour+1}:00`;cell.appendChild(pv);dragState.pv=pv;});
        cell.addEventListener('pointermove',()=>{if(!dragState||cell.dataset.date!==dragState.startDate)return;const minH=Math.min(dragState.startHour,hour),maxH=Math.max(dragState.startHour,hour)+1;if(hour!==dragState.startHour)dragState.moved=true;if(dragState.pv)dragState.pv.remove();const anchor=grid.querySelector(`.cal-week-cell[data-date="${dragState.startDate}"][data-hour="${minH}"]`);if(anchor){const pv=document.createElement('div');pv.className='cal-day-event cal-drag-preview';pv.style.cssText=`position:absolute;left:0;right:0;top:0;height:${(maxH-minH)*_HOUR_PX}px;background:var(--accent);opacity:0.6;pointer-events:none;z-index:5;`;pv.textContent=`${minH}:00–${maxH}:00`;anchor.appendChild(pv);dragState.pv=pv;}});
        cell.addEventListener('pointerup',async()=>{if(!dragState)return;const current=dragState;if(current.pv)current.pv.remove();dragState=null;document.body.style.userSelect='';if(!current.moved)return;const endH=hour+1;const minH=Math.min(current.startHour,endH-1),maxH=Math.max(current.startHour+1,endH);const ds=current.startDate;const s=new Date(ds+'T'+_p2(minH)+':00:00'),e=new Date(ds+'T'+_p2(maxH)+':00:00');await _quickCreateCalendarEvent(dbPath,{start:s,end:e,allDay:false});});
      }
      if (canEditDates) {
        cell.addEventListener('dragover',e2=>{e2.preventDefault();cell.style.background='rgba(86,156,214,0.15)';});
        cell.addEventListener('dragleave',()=>{cell.style.background='';});
        cell.addEventListener('drop',e2=>{e2.preventDefault();cell.style.background='';_handleEventDrop(dbPath,e2,cd);});
      }
      grid.appendChild(cell);
    }
  }
  // dragState cleanup（前回リスナーを除去してからリスナー登録）
  if (window._calWeekMouseupHandler) document.removeEventListener('pointerup', window._calWeekMouseupHandler);
  window._calWeekMouseupHandler = () => { if(dragState){if(dragState.pv)dragState.pv.remove();dragState=null;document.body.style.userSelect='';} };
  document.addEventListener('pointerup', window._calWeekMouseupHandler);
  container.appendChild(grid);
}

function _createWeekEventCard(dbPath, ev, startH, endH, segmentDate, overlapLayout) {
  const canEditDates = !!_calRenderState.info?.canEditDates;
  const eventCanEditDates = canEditDates && !ev._recurrenceInstance;
  const segmentStartDate = new Date(segmentDate || ev.start);
  segmentStartDate.setHours(0,0,0,0);
  const laneCount = Math.max(1, overlapLayout?.lanes || 1);
  const lane = Math.max(0, Math.min(laneCount - 1, overlapLayout?.lane || 0));
  const laneCss = laneCount > 1
    ? `left:calc(${(lane / laneCount) * 100}% + 1px);right:auto;width:calc(${100 / laneCount}% - 2px);`
    : 'left:1px;right:1px;';
  const el=document.createElement('div');el.className='cal-day-event';
  el.style.cssText=`position:absolute;${laneCss}top:${(startH%1)*_HOUR_PX}px;height:${Math.max(10,(endH-startH)*_HOUR_PX)}px;background:${ev.color};z-index:3;overflow:hidden;`;
  el.innerHTML=`<span class="cal-event-title">${esc(ev.name)}</span>${_calendarEventAvatarsHtml(ev, 14)}`;el.title=`${ev.name}\n${_calendarTimeLabel(ev.start)}–${_calendarTimeLabel(ev.end)}`;
  el.draggable=eventCanEditDates;
  if (eventCanEditDates) {
    el.addEventListener('dragstart',e=>{e.dataTransfer.setData('text/plain',JSON.stringify(_calendarDragPayloadForEvent(ev)));el.style.opacity='0.4';});
    el.addEventListener('dragend',()=>{el.style.opacity='';});
  }
  el.addEventListener('click', e=>{e.stopPropagation();if(ev._mapped&&typeof _openMappedCalendarEventPanel==='function'){_openMappedCalendarEventPanel(dbPath,ev,el);return;}_showCalendarEventDetailPanel(dbPath,ev);});
  if (!eventCanEditDates || (ev._mapped && !ev._mappedSupportsEnd)) return el;
  const commitResize = async (newStart, newEnd) => {
    if (ev._mapped && typeof _saveMappedCalendarDates === 'function') {
      try {
        await _saveMappedCalendarDates(dbPath, ev, newStart, newEnd, { preserveMissingEndIfZeroDuration: true });
        showStatus('日時を更新しました');
      } catch (err) {
        showStatus('リサイズに失敗', true);
      }
      return;
    }
    _calPushUndo('リサイズ');
    await apiPut('/calendar-db/events/'+encodeURIComponent(ev.name),{
      db_path:dbPath,
      start:_toCalendarApiValue(newStart, false),
      end:_toCalendarApiValue(newEnd, false)
    });
    await _calendarNotifyEventSaved(ev, {
      ...ev,
      start: _toCalendarApiValue(newStart, false),
      end: _toCalendarApiValue(newEnd, false),
      allDay: false,
    });
    await _refreshCalendarDb(dbPath);
  };
  // リサイズハンドル（下）
  const resBot=document.createElement('div');resBot.className='cal-event-resize-handle cal-event-resize-bottom';resBot.style.cssText='position:absolute;bottom:0;left:0;right:0;height:6px;cursor:ns-resize;';
  resBot.onpointerdown=e2=>{e2.stopPropagation();e2.preventDefault();el.style.touchAction='none';const sy=e2.clientY,sh=el.offsetHeight;document.body.style.userSelect='none';
    const onMove=e3=>{el.style.height=Math.max(10,sh+e3.clientY-sy)+'px';};
    const onUp=async()=>{document.removeEventListener('pointermove',onMove);document.removeEventListener('pointerup',onUp);document.body.style.userSelect='';el.style.touchAction='';
      let newEndH=_snapQuarterHour(startH+el.offsetHeight/_HOUR_PX);if(newEndH<0)newEndH=0;if(newEndH>24)newEndH=24;
      // newEnd は元の ev.end の日付部分を起点にして時刻だけ差し替える（multi-day イベントの日境界を保つ）
      const endDayBase=new Date(ev.end);endDayBase.setHours(0,0,0,0);
      const newEnd=_hourToDate(endDayBase, newEndH);
      try {
        await commitResize(new Date(ev.start), newEnd);
      } catch (err) {
        showStatus('リサイズに失敗', true);
      }
    };document.addEventListener('pointermove',onMove);document.addEventListener('pointerup',onUp);};
  el.appendChild(resBot);
  // リサイズハンドル（上）
  const resTop=document.createElement('div');resTop.className='cal-event-resize-handle cal-event-resize-top';resTop.style.cssText='position:absolute;top:0;left:0;right:0;height:6px;cursor:ns-resize;';
  resTop.onpointerdown=e2=>{e2.stopPropagation();e2.preventDefault();el.style.touchAction='none';const sy=e2.clientY,origTop=parseFloat(el.style.top),origH=el.offsetHeight;document.body.style.userSelect='none';
    const onMove=e3=>{const dy=Math.min(e3.clientY-sy, origH-10);el.style.top=(origTop+dy)+'px';el.style.height=Math.max(10,origH-dy)+'px';};
    const onUp=async()=>{document.removeEventListener('pointermove',onMove);document.removeEventListener('pointerup',onUp);document.body.style.userSelect='';el.style.touchAction='';
      const topDelta=(parseFloat(el.style.top)-origTop)/_HOUR_PX;
      let newStartH=_snapQuarterHour(startH+topDelta);if(newStartH<0)newStartH=0;if(newStartH>24)newStartH=24;
      // newStart は元の ev.start の日付部分を起点にして時刻だけ差し替える
      const startDayBase=new Date(ev.start);startDayBase.setHours(0,0,0,0);
      const newStart=_hourToDate(startDayBase, newStartH);
      try {
        await commitResize(newStart, new Date(ev.end));
      } catch (err) {
        showStatus('リサイズに失敗', true);
      }
    };document.addEventListener('pointermove',onMove);document.addEventListener('pointerup',onUp);};
  el.appendChild(resTop);
  return el;
}

/* ==============================
   日表示
   ============================== */
function _renderDay(container, dbPath, events) {
  const canEditDates = !!_calRenderState.info?.canEditDates;
  const canCreateEvents = !!_calRenderState.info?.canCreateEvents;
  const curDate=getCalendarDate(dbPath);
  const grid=document.createElement('div');grid.className='cal-day-grid';
  let dragState = null;
  for(let hour=0;hour<24;hour++){
    const tl=document.createElement('div');tl.className='cal-day-time';tl.style.height=_HOUR_PX+'px';tl.textContent=`${hour}:00`;grid.appendChild(tl);
    const cell=document.createElement('div');cell.className='cal-day-cell';cell.style.cssText=`height:${_HOUR_PX}px;position:relative;`;
    cell.dataset.hour = hour;
    const dayStart = new Date(curDate);
    dayStart.setHours(0,0,0,0);
    const cellEvents=events.filter(ev=>{
      if(!_calendarEventOccursOnDay(ev,dayStart))return false;
      if(ev.allDay)return hour===0;
      return Math.floor(_calendarEventSegmentHours(ev,dayStart).start)===hour;
    });
    const overlapLayouts=_calendarEventOverlapLayouts(cellEvents,dayStart);
    cellEvents.forEach(ev=>{
      const segment=_calendarEventSegmentHours(ev,dayStart);
      const card=_createWeekEventCard(dbPath,ev,segment.start,segment.end,dayStart,overlapLayouts.get(ev));
      cell.appendChild(card);
    });
    if (canCreateEvents) {
      _bindCalendarCellAddButton(cell, () => {
        const s = new Date(curDate);
        s.setHours(hour, 0, 0, 0);
        const e = new Date(s);
        e.setHours(hour + 1);
        return _quickCreateCalendarEvent(dbPath, { start: s, end: e, allDay: false });
      });
      cell.addEventListener('pointerdown', (e) => {
        if (e.button !== 0 || e.target.closest('.cal-day-event, .cal-cell-quick-add')) return;
        e.preventDefault();
        dragState = { startHour: hour, pv: null, moved: false };
        document.body.style.userSelect = 'none';
        const pv = document.createElement('div');
        pv.className = 'cal-day-event cal-drag-preview';
        pv.style.cssText = `position:absolute;left:0;right:0;top:0;height:${_HOUR_PX}px;background:var(--accent);opacity:0.6;pointer-events:none;z-index:5;`;
        pv.textContent = `${hour}:00–${hour+1}:00`;
        cell.appendChild(pv);
        dragState.pv = pv;
      });
      cell.addEventListener('pointermove', () => {
        if (!dragState) return;
        const minH = Math.min(dragState.startHour, hour);
        const maxH = Math.max(dragState.startHour, hour) + 1;
        if (hour !== dragState.startHour) dragState.moved = true;
        if (dragState.pv) dragState.pv.remove();
        const anchor = grid.querySelector(`.cal-day-cell[data-hour="${minH}"]`);
        if (!anchor) return;
        const pv = document.createElement('div');
        pv.className = 'cal-day-event cal-drag-preview';
        pv.style.cssText = `position:absolute;left:0;right:0;top:0;height:${(maxH-minH)*_HOUR_PX}px;background:var(--accent);opacity:0.6;pointer-events:none;z-index:5;`;
        pv.textContent = `${minH}:00–${maxH}:00`;
        anchor.appendChild(pv);
        dragState.pv = pv;
      });
      cell.addEventListener('pointerup', async () => {
        if (!dragState) return;
        const current = dragState;
        if (current.pv) current.pv.remove();
        dragState = null;
        document.body.style.userSelect = '';
        if (!current.moved) return;
        const endH = hour + 1;
        const minH = Math.min(current.startHour, endH - 1);
        const maxH = Math.max(current.startHour + 1, endH);
        const s = new Date(curDate);
        s.setHours(minH, 0, 0, 0);
        const e = new Date(curDate);
        e.setHours(maxH, 0, 0, 0);
        await _quickCreateCalendarEvent(dbPath, { start: s, end: e, allDay: false });
      });
    }
    if (canEditDates) {
      cell.addEventListener('dragover',e=>{e.preventDefault();cell.style.background='rgba(86,156,214,0.15)';});
      cell.addEventListener('dragleave',()=>{cell.style.background='';});
      cell.addEventListener('drop',e=>{e.preventDefault();cell.style.background='';const cd=new Date(curDate);cd.setHours(hour,0,0,0);_handleEventDrop(dbPath,e,cd);});
    }
    grid.appendChild(cell);
  }
  if (window._calDayPointerUp) document.removeEventListener('pointerup', window._calDayPointerUp);
  window._calDayPointerUp = () => {
    if (!dragState) return;
    if (dragState.pv) dragState.pv.remove();
    dragState = null;
    document.body.style.userSelect = '';
  };
  document.addEventListener('pointerup', window._calDayPointerUp);
  container.appendChild(grid);
}

/* ==============================
   D&D移動
   ============================== */
async function _handleEventDrop(dbPath,e,targetDate,opts) {
  let data; try{data=JSON.parse(e.dataTransfer.getData('text/plain'));}catch{return;}
  if(!data||!data.name) return;
  if(data.recurrenceInstance){
    showStatus('繰り返し予定の個別回は、元の予定を開いて変更してください。', true);
    return;
  }
  const duration=Number.isFinite(data.duration)?data.duration:3600000;
  const newStart=new Date(targetDate);
  // 月ビュー等では targetDate が 00:00 になるので、allDay でなければ元イベントの時/分を復元する
  if (opts && opts.preserveTime && !data.allDay && Number.isFinite(data.origHour)) {
    newStart.setHours(data.origHour, Number.isFinite(data.origMinute) ? data.origMinute : 0, 0, 0);
  }
  const newEnd=new Date(newStart.getTime()+duration);
  if (data.mapped && typeof _saveMappedCalendarDates === 'function') {
