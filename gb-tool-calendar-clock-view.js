/* ==============================
   gb-tool-calendar-clock-view.js: analog clock calendar views
   ============================== */

(() => {
  if (typeof CalendarComponent === 'undefined') return;

  const SIZE = 400;
  const CX = SIZE / 2;
  const CY = SIZE / 2;
  const OUTER_R = 178;
  const EVENT_OUTER_R = 154;
  const EVENT_INNER_R = 74;
  const CLOCK12_AM_OUTER_R = 112;
  const CLOCK12_PM_INNER_R = 118;
  const CLOCK12_HALF_THRESHOLD_R = (CLOCK12_AM_OUTER_R + CLOCK12_PM_INNER_R) / 2;

  function _clockEsc(value) {
    return typeof esc === 'function' ? esc(value) : String(value ?? '').replace(/[&<>"']/g, ch => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[ch]);
  }

  function _clockDate(value) {
    const d = value ? new Date(value) : null;
    return d && !Number.isNaN(d.getTime()) ? d : null;
  }

  function _clockPoint(angleDeg, radius) {
    const rad = (angleDeg - 90) * Math.PI / 180;
    return { x: CX + radius * Math.cos(rad), y: CY + radius * Math.sin(rad) };
  }

  function _clockDonutPath(startAngle, endAngle, outerR, innerR) {
    const span = Math.max(0, endAngle - startAngle);
    if (span >= 359.5) {
      return [
        `M ${CX} ${CY - outerR}`,
        `A ${outerR} ${outerR} 0 1 1 ${CX} ${CY + outerR}`,
        `A ${outerR} ${outerR} 0 1 1 ${CX} ${CY - outerR}`,
        `M ${CX} ${CY - innerR}`,
        `A ${innerR} ${innerR} 0 1 0 ${CX} ${CY + innerR}`,
        `A ${innerR} ${innerR} 0 1 0 ${CX} ${CY - innerR}`,
      ].join(' ');
    }
    const large = span > 180 ? 1 : 0;
    const so = _clockPoint(startAngle, outerR);
    const eo = _clockPoint(endAngle, outerR);
    const si = _clockPoint(startAngle, innerR);
    const ei = _clockPoint(endAngle, innerR);
    return [
      `M ${so.x} ${so.y}`,
      `A ${outerR} ${outerR} 0 ${large} 1 ${eo.x} ${eo.y}`,
      `L ${ei.x} ${ei.y}`,
      `A ${innerR} ${innerR} 0 ${large} 0 ${si.x} ${si.y}`,
      'Z',
    ].join(' ');
  }

  function _clockDateAtMinutes(dateStr, minutes) {
    const d = new Date(dateStr + 'T00:00:00');
    d.setMinutes(Math.max(0, Math.min(1439, minutes)));
    return d;
  }

  function _clockMinutesOfDay(date) {
    if (!date || Number.isNaN(date.getTime())) return 0;
    return date.getHours() * 60 + date.getMinutes() + date.getSeconds() / 60 + date.getMilliseconds() / 60000;
  }

  function _clockEventTitle(ev) {
    const start = String(ev.start || '').substring(11, 16);
    const end = String(ev.end || '').substring(11, 16);
    return `${ev.title || '無題'} ${start}${end ? ' - ' + end : ''}`;
  }

  function _clockSameDate(a, b) {
    return a.getFullYear() === b.getFullYear()
      && a.getMonth() === b.getMonth()
      && a.getDate() === b.getDate();
  }

  const baseRender = CalendarComponent.prototype._render;
  const baseDeactivate = CalendarComponent.prototype.deactivate;
  const baseDestroy = CalendarComponent.prototype.destroy;

  CalendarComponent.prototype._isAnalogClockView = function() {
    return this._view === 'clock12' || this._view === 'clock24';
  };

  CalendarComponent.prototype._render = function() {
    if (!this._isAnalogClockView()) {
      this._clearAnalogClockTimer?.();
      return baseRender.call(this);
    }
    ++this._renderSeq;
    const y = this._date.getFullYear();
    const m = this._date.getMonth() + 1;
    const d = this._date.getDate();
    const mode = this._view === 'clock24' ? 24 : 12;
    if (this._titleEl) this._titleEl.textContent = `${y}年${m}月${d}日 アナログ時計（${mode}時間）`;
    this._renderAnalogClockView(mode);
    this._clearNowLineTimer?.();
    if (this._contentEl && typeof CommentBadges !== 'undefined' && typeof CommentBadges.refreshCalendar === 'function') {
      try { CommentBadges.refreshCalendar(this._contentEl); } catch (_) {}
    }
  };

  CalendarComponent.prototype.deactivate = function() {
    this._clearAnalogClockTimer?.();
    baseDeactivate.call(this);
  };

  CalendarComponent.prototype.destroy = function() {
    this._clearAnalogClockTimer?.();
    baseDestroy.call(this);
  };

  CalendarComponent.prototype._clockTicksSvg = function(mode) {
    let html = '';
    for (let i = 0; i < 60; i++) {
      const major = i % 5 === 0;
      const p1 = _clockPoint(i * 6, major ? 163 : 170);
      const p2 = _clockPoint(i * 6, OUTER_R);
      html += `<line class="gb-cal-clock-tick${major ? ' major' : ''}" x1="${p1.x.toFixed(2)}" y1="${p1.y.toFixed(2)}" x2="${p2.x.toFixed(2)}" y2="${p2.y.toFixed(2)}"></line>`;
    }
    if (mode === 12) {
      for (let h = 1; h <= 12; h++) {
        const p = _clockPoint(h * 30, 141);
        html += `<text class="gb-cal-clock-label" x="${p.x.toFixed(2)}" y="${p.y.toFixed(2)}">${h}</text>`;
      }
      return html;
    }
    for (let h = 0; h < 24; h++) {
      const p = _clockPoint(h * 15, h % 2 === 0 ? 141 : 129);
      html += `<text class="gb-cal-clock-label gb-cal-clock-label-24" x="${p.x.toFixed(2)}" y="${p.y.toFixed(2)}">${h}</text>`;
    }
    return html;
  };

  CalendarComponent.prototype._clockEventIntervals = function(ev, dateStr, mode) {
    const dayStart = new Date(dateStr + 'T00:00:00');
    const dayEnd = new Date(dayStart.getTime());
    dayEnd.setDate(dayEnd.getDate() + 1);
    const rawStart = _clockDate(ev.start) || dayStart;
    const rawEnd = _clockDate(ev.end) || new Date(rawStart.getTime() + 60 * 60000);
    const start = rawStart < dayStart ? dayStart : rawStart;
    const end = rawEnd > dayEnd ? dayEnd : rawEnd;
    if (end <= start) return [];
    const startMin = rawStart < dayStart ? 0 : Math.max(0, Math.floor(_clockMinutesOfDay(start)));
    const endMin = rawEnd > dayEnd ? 1440 : Math.min(1440, Math.ceil(_clockMinutesOfDay(end)));
    if (ev.all_day || endMin - startMin >= 1439) {
      return mode === 24 ? [{ start: 0, end: 1440, half: 0 }] : [{ start: 0, end: 720, half: 0 }, { start: 0, end: 720, half: 1 }];
    }
    if (mode === 24) return [{ start: startMin, end: endMin }];
    const intervals = [];
    [[0, 720], [720, 1440]].forEach(([from, to]) => {
      const s = Math.max(startMin, from);
      const e = Math.min(endMin, to);
      if (e > s) intervals.push({ start: s - from, end: e - from, half: from >= 720 ? 1 : 0 });
    });
    return intervals;
  };

  CalendarComponent.prototype._clockEventSlicesSvg = function(mode, dateStr) {
    const period = mode === 24 ? 1440 : 720;
    const events = (this._events || []).filter(ev => {
      if (!this._isCalVisible(ev)) return false;
      if (typeof this._eventIntersectsDay === 'function') return this._eventIntersectsDay(ev, dateStr);
      return String(ev.start || '').startsWith(dateStr);
    });
    const slices = [];
    events.forEach((ev, eventIndex) => {
      const color = this._sanitizeEventColor ? this._sanitizeEventColor(ev.color) : (ev.color || '#569cd6');
      this._clockEventIntervals(ev, dateStr, mode).forEach((interval, intervalIndex) => {
        const start = Math.max(0, Math.min(period, interval.start));
        const end = Math.min(period, Math.max(start + 4, interval.end));
        slices.push({ ev, eventIndex, intervalIndex, color, start, end, half: interval.half || 0 });
      });
    });
    const laneGroups = new Map();
    slices
      .slice()
      .sort((a, b) => (a.half - b.half) || (a.start - b.start) || (a.end - b.end))
      .forEach(slice => {
        const key = mode === 24 ? 'full' : String(slice.half);
        const group = laneGroups.get(key) || { ends: [], count: 0 };
        let lane = group.ends.findIndex(end => end <= slice.start);
        if (lane < 0) lane = group.ends.length;
        group.ends[lane] = slice.end;
        group.count = Math.max(group.count, lane + 1);
        slice.lane = lane;
        laneGroups.set(key, group);
      });
    let html = '';
    slices.forEach(slice => {
        const startAngle = (slice.start / period) * 360;
        const endAngle = Math.min(360, (slice.end / period) * 360);
        const key = mode === 24 ? 'full' : String(slice.half);
        const laneCount = Math.max(1, laneGroups.get(key)?.count || 1);
        const outerBase = mode === 24 ? EVENT_OUTER_R : (slice.half ? EVENT_OUTER_R : CLOCK12_AM_OUTER_R);
        const innerBase = mode === 24 ? EVENT_INNER_R : (slice.half ? CLOCK12_PM_INNER_R : EVENT_INNER_R);
        const band = Math.max(4, (outerBase - innerBase) / laneCount);
        const outer = outerBase - slice.lane * band;
        const inner = Math.max(innerBase, outer - Math.max(3, band - 2));
        const path = _clockDonutPath(startAngle, endAngle, outer, inner);
        html += `<path class="gb-cal-clock-event-slice" data-event-id="${_clockEsc(slice.ev.id)}" data-calendar-id="${_clockEsc(slice.ev.calendar_id || '_calendar')}" d="${path}" fill="${_clockEsc(slice.color)}" fill-rule="evenodd"><title>${_clockEsc(_clockEventTitle(slice.ev))}</title></path>`;
        void slice.eventIndex;
        void slice.intervalIndex;
    });
    return html;
  };

  CalendarComponent.prototype._renderAnalogClockView = function(mode) {
    if (!this._contentEl) return;
    const dateStr = this._localDateStr(this._date);
    const selected = this._selectedCalendar?.();
    this._contentEl.innerHTML = `
      <div class="gb-cal-clock-view" data-clock-mode="${mode}">
        <div class="gb-cal-clock-view-meta">
          <span>${_clockEsc(dateStr)}</span>
          <span>選択中: ${_clockEsc(selected?.name || 'なし')}</span>
        </div>
        <div class="gb-cal-clock-stage">
          <svg class="gb-cal-clock-svg" viewBox="0 0 ${SIZE} ${SIZE}" role="img" aria-label="アナログ時計 ${mode}時間">
            <circle class="gb-cal-clock-face" cx="${CX}" cy="${CY}" r="${OUTER_R}"></circle>
            <g class="gb-cal-clock-events">${this._clockEventSlicesSvg(mode, dateStr)}</g>
            <g class="gb-cal-clock-ticks">${this._clockTicksSvg(mode)}</g>
            <line class="gb-cal-clock-hand gb-cal-clock-hour" data-clock-hand="hour" x1="${CX}" y1="${CY}" x2="${CX}" y2="${mode === 24 ? 112 : 102}"></line>
            <line class="gb-cal-clock-hand gb-cal-clock-minute" data-clock-hand="minute" x1="${CX}" y1="${CY}" x2="${CX}" y2="65"></line>
            <line class="gb-cal-clock-hand gb-cal-clock-second" data-clock-hand="second" x1="${CX}" y1="${CY + 18}" x2="${CX}" y2="54"></line>
            <circle class="gb-cal-clock-pin" cx="${CX}" cy="${CY}" r="5"></circle>
          </svg>
        </div>
      </div>`;
    this._contentEl.querySelectorAll('.gb-cal-clock-event-slice[data-event-id]').forEach(slice => {
      slice.addEventListener('click', (event) => {
        event.stopPropagation();
        this._openEventInPanel(slice.dataset.eventId);
      });
    });
    this._contentEl.querySelector('.gb-cal-clock-svg')?.addEventListener('click', (event) => {
      if (event.target.closest?.('.gb-cal-clock-event-slice')) return;
      const startMin = this._clockMinutesFromPointer(event, mode, dateStr);
      const endMin = Math.min(1439, startMin + 60);
      this._openEventInPanel(null, this._localDateTimeStr(_clockDateAtMinutes(dateStr, startMin)), this._localDateTimeStr(_clockDateAtMinutes(dateStr, endMin)), false);
    });
    this._syncAnalogClockTimer(mode);
  };

  CalendarComponent.prototype._clockMinutesFromPointer = function(event, mode, dateStr) {
    const svg = event.currentTarget;
    const rect = svg.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / Math.max(1, rect.width)) * SIZE - CX;
    const y = ((event.clientY - rect.top) / Math.max(1, rect.height)) * SIZE - CY;
    const radius = Math.sqrt(x * x + y * y);
    let angle = Math.atan2(y, x) * 180 / Math.PI + 90;
    if (angle < 0) angle += 360;
    const period = mode === 24 ? 1440 : 720;
    let minutes = Math.round((angle / 360) * period / 15) * 15;
    minutes = ((minutes % period) + period) % period;
    if (mode === 12) {
      minutes += radius >= CLOCK12_HALF_THRESHOLD_R ? 720 : 0;
    }
    return Math.max(0, Math.min(1439, minutes));
  };

  CalendarComponent.prototype._updateAnalogClockHands = function(mode) {
    const root = this._contentEl?.querySelector?.('.gb-cal-clock-svg');
    if (!root) return;
    const now = new Date();
    const hourAngle = mode === 24
      ? (now.getHours() + now.getMinutes() / 60 + now.getSeconds() / 3600) * 15
      : ((now.getHours() % 12) + now.getMinutes() / 60 + now.getSeconds() / 3600) * 30;
    const minuteAngle = (now.getMinutes() + now.getSeconds() / 60) * 6;
    const secondAngle = now.getSeconds() * 6;
    root.querySelector('[data-clock-hand="hour"]')?.setAttribute('transform', `rotate(${hourAngle} ${CX} ${CY})`);
    root.querySelector('[data-clock-hand="minute"]')?.setAttribute('transform', `rotate(${minuteAngle} ${CX} ${CY})`);
    root.querySelector('[data-clock-hand="second"]')?.setAttribute('transform', `rotate(${secondAngle} ${CX} ${CY})`);
  };

  CalendarComponent.prototype._syncAnalogClockTimer = function(mode) {
    this._updateAnalogClockHands(mode);
    if (this._analogClockTimer) clearInterval(this._analogClockTimer);
    this._analogClockTimer = setInterval(() => this._updateAnalogClockHands(mode), 1000);
  };

  CalendarComponent.prototype._clearAnalogClockTimer = function() {
    if (this._analogClockTimer) clearInterval(this._analogClockTimer);
    this._analogClockTimer = null;
  };
})();
