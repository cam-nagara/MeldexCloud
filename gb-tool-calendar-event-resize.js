/* ==============================
   gb-tool-calendar-event-resize.js: Event resize and detail form routing override
   ============================== */

(() => {
  if (typeof CalendarComponent === 'undefined' || !window.MeldexCalendarOptions) return;
  const {
    EVENT_EDGE_MINUTES,
    _calCssEscape,
    _calFindCalendarComponent,
  } = window.MeldexCalendarOptions;

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
