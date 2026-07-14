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
  const CLOCK_EVENT_EDGE_MINUTES = 15;
  const CLOCK_DEFAULT_EVENT_MINUTES = 60;
  const CLOCK_DRAG_PX_THRESHOLD = 4;
  const CLOCK_EVENT_CARD_MIN_WIDTH = 8;
  const CLOCK_EVENT_CARD_LANE_OFFSET = 6;
  const CLOCK_EVENT_CHECK_SIZE = 8;

  function _clockEsc(value) {
    return typeof esc === 'function' ? esc(value) : String(value ?? '').replace(/[&<>"']/g, ch => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[ch]);
  }

  function _clockDate(value) {
    if (!value) return null;
    const raw = String(value);
    // 日付のみの値はUTCではなくローカル日付として解釈する（月/週ビューの解釈と揃える）
    const d = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? new Date(raw + 'T00:00:00') : new Date(raw);
    return d && !Number.isNaN(d.getTime()) ? d : null;
  }

  function _clockPoint(angleDeg, radius) {
    const rad = (angleDeg - 90) * Math.PI / 180;
    return { x: CX + radius * Math.cos(rad), y: CY + radius * Math.sin(rad) };
  }

  function _clockSvgRelativePoint(svg, clientX, clientY) {
    const rect = svg.getBoundingClientRect();
    const x = ((clientX - rect.left) / Math.max(1, rect.width)) * SIZE - CX;
    const y = ((clientY - rect.top) / Math.max(1, rect.height)) * SIZE - CY;
    return { x, y, radius: Math.sqrt(x * x + y * y) };
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

  function _clockRoundedDonutPath(startAngle, endAngle, outerR, innerR, cornerRadius) {
    const span = Math.max(0, endAngle - startAngle);
    if (span <= 0 || span >= 359.5 || outerR <= innerR) return _clockDonutPath(startAngle, endAngle, outerR, innerR);
    const width = outerR - innerR;
    const spanArc = span * Math.PI / 180 * innerR;
    const radius = Math.max(0, Math.min(cornerRadius || 0, width / 2, spanArc / 3));
    if (radius < 0.5) return _clockDonutPath(startAngle, endAngle, outerR, innerR);
    const outerOffset = Math.min(span * 0.42, radius / outerR * 180 / Math.PI);
    const innerOffset = Math.min(span * 0.42, radius / innerR * 180 / Math.PI);
    const outerSpan = Math.max(0.1, span - outerOffset * 2);
    const innerSpan = Math.max(0.1, span - innerOffset * 2);
    const so0 = _clockPoint(startAngle, outerR - radius);
    const soCorner = _clockPoint(startAngle, outerR);
    const so1 = _clockPoint(startAngle + outerOffset, outerR);
    const eo1 = _clockPoint(endAngle - outerOffset, outerR);
    const eoCorner = _clockPoint(endAngle, outerR);
    const eo0 = _clockPoint(endAngle, outerR - radius);
    const ei0 = _clockPoint(endAngle, innerR + radius);
    const eiCorner = _clockPoint(endAngle, innerR);
    const ei1 = _clockPoint(endAngle - innerOffset, innerR);
    const si1 = _clockPoint(startAngle + innerOffset, innerR);
    const siCorner = _clockPoint(startAngle, innerR);
    const si0 = _clockPoint(startAngle, innerR + radius);
    return [
      `M ${so0.x.toFixed(2)} ${so0.y.toFixed(2)}`,
      `Q ${soCorner.x.toFixed(2)} ${soCorner.y.toFixed(2)} ${so1.x.toFixed(2)} ${so1.y.toFixed(2)}`,
      `A ${outerR.toFixed(2)} ${outerR.toFixed(2)} 0 ${outerSpan > 180 ? 1 : 0} 1 ${eo1.x.toFixed(2)} ${eo1.y.toFixed(2)}`,
      `Q ${eoCorner.x.toFixed(2)} ${eoCorner.y.toFixed(2)} ${eo0.x.toFixed(2)} ${eo0.y.toFixed(2)}`,
      `L ${ei0.x.toFixed(2)} ${ei0.y.toFixed(2)}`,
      `Q ${eiCorner.x.toFixed(2)} ${eiCorner.y.toFixed(2)} ${ei1.x.toFixed(2)} ${ei1.y.toFixed(2)}`,
      `A ${innerR.toFixed(2)} ${innerR.toFixed(2)} 0 ${innerSpan > 180 ? 1 : 0} 0 ${si1.x.toFixed(2)} ${si1.y.toFixed(2)}`,
      `Q ${siCorner.x.toFixed(2)} ${siCorner.y.toFixed(2)} ${si0.x.toFixed(2)} ${si0.y.toFixed(2)}`,
      'Z',
    ].join(' ');
  }

  function _clockArcPath(startAngle, endAngle, radius) {
    const span = Math.max(0.1, Math.min(359.5, endAngle - startAngle));
    const large = span > 180 ? 1 : 0;
    const start = _clockPoint(startAngle, radius);
    const end = _clockPoint(startAngle + span, radius);
    return `M ${start.x.toFixed(2)} ${start.y.toFixed(2)} A ${radius.toFixed(2)} ${radius.toFixed(2)} 0 ${large} 1 ${end.x.toFixed(2)} ${end.y.toFixed(2)}`;
  }

  function _clockRadialPath(angle, innerR, outerR) {
    const inner = _clockPoint(angle, innerR);
    const outer = _clockPoint(angle, outerR);
    return `M ${inner.x.toFixed(2)} ${inner.y.toFixed(2)} L ${outer.x.toFixed(2)} ${outer.y.toFixed(2)}`;
  }

  function _clockClamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function _clockSnapMinutes(minutes) {
    return _clockClamp(Math.round(minutes / CLOCK_EVENT_EDGE_MINUTES) * CLOCK_EVENT_EDGE_MINUTES, 0, 1440);
  }

  function _clockDateAtMinutes(dateStr, minutes) {
    const d = new Date(dateStr + 'T00:00:00');
    d.setMinutes(_clockClamp(minutes, 0, 1440));
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

  function _clockShortText(value, maxChars) {
    const text = String(value || '').trim() || '無題';
    if (text.length <= maxChars) return text;
    return text.slice(0, Math.max(1, maxChars - 1)) + '…';
  }

  function _clockPrimaryUserName(component, ev) {
    const names = typeof component._eventUserNames === 'function' ? component._eventUserNames(ev) : [];
    return names[0] || '';
  }

  function _clockAvatarUrl(name) {
    return window.MeldexDataAccess?.team?.avatarUrl?.(name || 'anonymous', {}) || ('/api/team/avatar/' + encodeURIComponent(name || 'anonymous') + '?t=0');
  }

  function _clockAvatarInitial(name) {
    return (String(name || '?').trim().charAt(0).toUpperCase() || '?');
  }

  function _clockStableIdSuffix(value, fallback) {
    const raw = String(value ?? fallback ?? '').trim();
    const normalized = raw.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64);
    return normalized || String(fallback || 'item');
  }

  function _clockDateLabel(date) {
    const days = ['日', '月', '火', '水', '木', '金', '土'];
    return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日（${days[date.getDay()]}）`;
  }

  function _clockAssignEventSliceLanes(slices, mode) {
    const groups = new Map();
    (slices || []).forEach(slice => {
      const key = 'full';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(slice);
    });
    groups.forEach(items => {
      let cluster = [];
      let clusterEnd = -1;
      const flush = () => {
        if (!cluster.length) return;
        const laneEnds = [];
        cluster.forEach(item => {
          let lane = laneEnds.findIndex(end => end <= item.start);
          if (lane < 0) lane = laneEnds.length;
          laneEnds[lane] = item.end;
          item.lane = lane;
        });
        const laneCount = Math.max(1, laneEnds.length);
        cluster.forEach(item => { item.laneCount = laneCount; });
        cluster = [];
        clusterEnd = -1;
      };
      items
        .slice()
        .sort((a, b) => (a.start - b.start) || (a.end - b.end))
        .forEach(item => {
          if (!cluster.length || item.start < clusterEnd) {
            cluster.push(item);
            clusterEnd = Math.max(clusterEnd, item.end);
          } else {
            flush();
            cluster.push(item);
            clusterEnd = item.end;
          }
        });
      flush();
    });
  }

  function _clockSameDate(a, b) {
    return a.getFullYear() === b.getFullYear()
      && a.getMonth() === b.getMonth()
      && a.getDate() === b.getDate();
  }

  function _clockRangeFromMinutes(startMin, endMin, defaultDuration = CLOCK_DEFAULT_EVENT_MINUTES, mode = 24) {
    let start = _clockClamp(_clockSnapMinutes(startMin), 0, 1440 - CLOCK_EVENT_EDGE_MINUTES);
    let end = _clockSnapMinutes(endMin);
    if (start >= 1080 && (end === 0 || (mode === 12 && end === 720))) end = 1440;
    if (end === start) {
      end = _clockClamp(start + defaultDuration, CLOCK_EVENT_EDGE_MINUTES, 1440);
    } else if (end < start) {
      [start, end] = [end, start];
    }
    if (end <= start) end = _clockClamp(start + CLOCK_EVENT_EDGE_MINUTES, CLOCK_EVENT_EDGE_MINUTES, 1440);
    return { start, end };
  }

  function _clockRangeIntervalsForMode(startMin, endMin, mode) {
    if (mode === 24) return [{ start: startMin, end: endMin, half: 0, period: 1440 }];
    const intervals = [];
    [[0, 720], [720, 1440]].forEach(([from, to]) => {
      const start = Math.max(startMin, from);
      const end = Math.min(endMin, to);
      if (end > start) intervals.push({ start: start - from, end: end - from, half: from >= 720 ? 1 : 0, period: 720 });
    });
    return intervals;
  }

  const baseRender = CalendarComponent.prototype._render;
  const baseDeactivate = CalendarComponent.prototype.deactivate;
  const baseDestroy = CalendarComponent.prototype.destroy;

  CalendarComponent.prototype._isAnalogClockView = function() {
    return this._view === 'clock12' || this._view === 'clock24';
  };

  CalendarComponent.prototype._clockActiveHalf = function() {
    return this._clock12Half === 1 ? 1 : 0;
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
    if (mode === 24) {
      for (let i = 0; i < 48; i++) {
        const major = i % 2 === 0;
        const p1 = _clockPoint(i * 7.5, major ? 162 : 170);
        const p2 = _clockPoint(i * 7.5, OUTER_R);
        html += `<line class="gb-cal-clock-tick gb-cal-clock-tick-24${major ? ' major' : ''}" x1="${p1.x.toFixed(2)}" y1="${p1.y.toFixed(2)}" x2="${p2.x.toFixed(2)}" y2="${p2.y.toFixed(2)}"></line>`;
      }
      for (let h = 0; h < 24; h++) {
        const p = _clockPoint(h * 15, 141);
        html += `<text class="gb-cal-clock-label gb-cal-clock-label-24" x="${p.x.toFixed(2)}" y="${p.y.toFixed(2)}">${h}</text>`;
      }
      return html;
    }
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
    return html;
  };

  CalendarComponent.prototype._clockEventIntervals = function(ev, dateStr, mode) {
    const dayStart = new Date(dateStr + 'T00:00:00');
    const dayEnd = new Date(dayStart.getTime());
    dayEnd.setDate(dayEnd.getDate() + 1);
    const rawStart = _clockDate(ev.start) || dayStart;
    const rawEnd = _clockDate(ev.end) || new Date(rawStart.getTime() + 60 * 60000);
    // 終日イベントは start==end の日付のみ形式になるため、空判定（end<=start）より先に処理する
    if (ev.all_day) {
      return mode === 24 ? [{ start: 0, end: 1440, half: 0 }] : [{ start: 0, end: 720, half: 0 }, { start: 0, end: 720, half: 1 }];
    }
    const start = rawStart < dayStart ? dayStart : rawStart;
    const end = rawEnd > dayEnd ? dayEnd : rawEnd;
    if (end <= start) return [];
    const startMin = rawStart < dayStart ? 0 : Math.max(0, Math.floor(_clockMinutesOfDay(start)));
    const endMin = rawEnd >= dayEnd ? 1440 : Math.min(1440, Math.ceil(_clockMinutesOfDay(end)));
    if (endMin - startMin >= 1439) {
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

  CalendarComponent.prototype._clockEventSlices = function(mode, dateStr) {
    const period = mode === 24 ? 1440 : 720;
    const activeHalf = mode === 12 ? this._clockActiveHalf() : null;
    const events = (this._events || []).filter(ev => {
      if (!this._isCalVisible(ev)) return false;
      if (typeof this._eventIntersectsDay === 'function') return this._eventIntersectsDay(ev, dateStr);
      return String(ev.start || '').startsWith(dateStr);
    });
    const slices = [];
    events.forEach((ev, eventIndex) => {
      const color = this._sanitizeEventColor ? this._sanitizeEventColor(ev.color) : (ev.color || '#569cd6');
      this._clockEventIntervals(ev, dateStr, mode).forEach((interval, intervalIndex) => {
        if (mode === 12 && interval.half !== activeHalf) return;
        const start = Math.max(0, Math.min(period, interval.start));
        const end = Math.min(period, Math.max(start + 4, interval.end));
        slices.push({ ev, eventIndex, intervalIndex, color, start, end, half: interval.half || 0 });
      });
    });
    _clockAssignEventSliceLanes(slices, mode);
    slices.forEach(slice => {
        const startAngle = (slice.start / period) * 360;
        const endAngle = Math.min(360, (slice.end / period) * 360);
        const laneCount = Math.max(1, slice.laneCount || 1);
        const localLane = _clockClamp(slice.lane || 0, 0, laneCount - 1);
        const outerBase = EVENT_OUTER_R;
        const innerBase = EVENT_INNER_R;
        const usableWidth = Math.max(CLOCK_EVENT_CARD_MIN_WIDTH, outerBase - innerBase - 2);
        const laneOffset = laneCount > 1 ? Math.min(CLOCK_EVENT_CARD_LANE_OFFSET, Math.max(4, usableWidth * 0.14)) : 0;
        const outerReserve = localLane * laneOffset;
        const innerReserve = Math.max(0, laneCount - localLane - 1) * laneOffset;
        const inner = innerBase + 1 + innerReserve;
        const outer = Math.max(inner + CLOCK_EVENT_CARD_MIN_WIDTH, outerBase - 1 - outerReserve);
        const midRadius = (outer + inner) / 2;
        slice.period = period;
        slice.thickness = outer - inner;
        slice.outer = outer;
        slice.inner = inner;
        slice.path = _clockRoundedDonutPath(startAngle, endAngle, slice.outer, slice.inner, Math.min(3, slice.thickness / 3));
        slice.midAngle = ((slice.start + slice.end) / 2 / period) * 360;
        slice.midRadius = midRadius;
        slice.startAngle = startAngle;
        slice.endAngle = endAngle;
        void slice.eventIndex;
        void slice.intervalIndex;
    });
    return slices;
  };

  CalendarComponent.prototype._clockEventSlicesSvg = function(mode, dateStr) {
    let html = '';
    this._clockEventSlices(mode, dateStr)
      .slice()
      .sort((a, b) => (a.half - b.half) || (a.lane - b.lane) || (a.start - b.start) || (a.end - b.end))
      .forEach((slice, index) => {
      const clipId = `gb-cal-clock-clip-${String(slice.ev.id || index).replace(/[^a-zA-Z0-9_-]/g, '-')}-${index}`;
      const titlePathId = `${clipId}-title`;
      const avatarClipId = `${clipId}-avatar`;
      const userName = _clockPrimaryUserName(this, slice.ev);
      const avatarMaxRadius = Math.min(5.2, Math.max(2.4, (slice.thickness - 2) / 2));
      const avatarRadius = userName ? _clockClamp(slice.thickness * 0.18, 2.4, avatarMaxRadius) : 0;
      const avatarAnglePad = avatarRadius ? (avatarRadius / Math.max(1, slice.midRadius)) * 180 / Math.PI + 1.4 : 0;
      const selectAnglePad = (6 / Math.max(1, slice.midRadius)) * 180 / Math.PI + 1.4;
      const avatarAngle = avatarRadius ? Math.max(slice.startAngle + selectAnglePad + 0.5, slice.endAngle - avatarAnglePad) : slice.endAngle;
      const arcLength = Math.max(0, (slice.endAngle - slice.startAngle) / 360 * 2 * Math.PI * slice.midRadius);
      const titleChars = _clockClamp(Math.floor((arcLength - (avatarRadius ? 20 : 12)) / 3.7), 3, 34);
      const title = _clockShortText(slice.ev?.title || '無題', titleChars);
      const titleRadius = _clockClamp(slice.midRadius, slice.inner + 4, slice.outer - 4);
      const selectPoint = _clockPoint(Math.min(slice.endAngle - 0.5, slice.startAngle + selectAnglePad), Math.max(slice.inner + 7, slice.outer - 7));
      const avatarPoint = avatarRadius ? _clockPoint(avatarAngle, Math.min(slice.outer - avatarRadius - 2, slice.inner + avatarRadius + 2)) : null;
      const eventE2eId = `calendar-clock-event-${_clockStableIdSuffix(slice.ev?.id, index)}-${index}`;
      html += `<g class="gb-cal-clock-event" data-e2e-id="${_clockEsc(eventE2eId)}" data-clock-event-id="${_clockEsc(slice.ev.id)}" data-calendar-id="${_clockEsc(slice.ev.calendar_id || '_calendar')}" data-clock-start-min="${_clockEsc(slice.start)}" data-clock-end-min="${_clockEsc(slice.end)}" role="button" tabindex="0" aria-label="${_clockEsc(_clockEventTitle(slice.ev))}">`;
      html += `<clipPath id="${_clockEsc(clipId)}"><path d="${slice.path}"></path></clipPath>`;
      if (avatarPoint) html += `<clipPath id="${_clockEsc(avatarClipId)}"><circle cx="${avatarPoint.x.toFixed(2)}" cy="${avatarPoint.y.toFixed(2)}" r="${avatarRadius.toFixed(2)}"></circle></clipPath>`;
      html += `<path id="${_clockEsc(titlePathId)}" class="gb-cal-clock-event-label-path" d="${_clockArcPath(slice.startAngle + selectAnglePad * 1.8, Math.max(slice.startAngle + selectAnglePad * 2.2, slice.endAngle - avatarAnglePad * 2), titleRadius)}"></path>`;
      html += `<path class="gb-cal-clock-event-slice" data-e2e-id="${_clockEsc(eventE2eId)}-slice" d="${slice.path}" fill="${_clockEsc(slice.color)}" fill-rule="evenodd" data-event-id="${_clockEsc(slice.ev.id)}" data-calendar-id="${_clockEsc(slice.ev.calendar_id || '_calendar')}" data-clock-card-width="${slice.thickness.toFixed(2)}"><title>${_clockEsc(_clockEventTitle(slice.ev))}</title></path>`;
      html += `<g class="gb-cal-clock-event-text" clip-path="url(#${_clockEsc(clipId)})"><text class="gb-cal-clock-event-label"><textPath href="#${_clockEsc(titlePathId)}" startOffset="50%" text-anchor="middle">${_clockEsc(title)}</textPath></text>`;
      if (avatarPoint) html += `<g class="gb-cal-clock-event-avatar" data-clock-avatar-position="end-center" transform="translate(${avatarPoint.x.toFixed(2)} ${avatarPoint.y.toFixed(2)})"><circle class="gb-cal-clock-event-avatar-bg" r="${avatarRadius.toFixed(2)}"></circle><text class="gb-cal-clock-event-avatar-initial" y="0.25">${_clockEsc(_clockAvatarInitial(userName))}</text><image href="${_clockEsc(_clockAvatarUrl(userName))}" x="${(-avatarRadius).toFixed(2)}" y="${(-avatarRadius).toFixed(2)}" width="${(avatarRadius * 2).toFixed(2)}" height="${(avatarRadius * 2).toFixed(2)}" clip-path="url(#${_clockEsc(avatarClipId)})"></image></g>`;
      html += `</g>`;
      html += `<g class="gb-cal-clock-select-check" data-e2e-id="${_clockEsc(eventE2eId)}-select" data-clock-select="1" data-clock-select-position="start-outer" role="checkbox" aria-label="選択" aria-checked="false" transform="translate(${(selectPoint.x - CLOCK_EVENT_CHECK_SIZE / 2).toFixed(2)} ${(selectPoint.y - CLOCK_EVENT_CHECK_SIZE / 2).toFixed(2)})"><rect class="gb-cal-clock-select-box" width="${CLOCK_EVENT_CHECK_SIZE}" height="${CLOCK_EVENT_CHECK_SIZE}" rx="1.5"></rect><path class="gb-cal-clock-select-mark" d="M2 4.1 L3.5 5.6 L6.2 2.5"></path></g>`;
      html += `<path class="gb-cal-clock-resize-edge start" data-e2e-id="${_clockEsc(eventE2eId)}-resize-start" data-clock-resize="start" d="${_clockRadialPath(slice.startAngle, slice.inner, slice.outer)}"></path>`;
      html += `<path class="gb-cal-clock-resize-edge end" data-e2e-id="${_clockEsc(eventE2eId)}-resize-end" data-clock-resize="end" d="${_clockRadialPath(slice.endAngle, slice.inner, slice.outer)}"></path>`;
      html += `</g>`;
    });
    return html;
  };

  CalendarComponent.prototype._renderAnalogClockView = function(mode) {
    if (!this._contentEl) return;
    const dateStr = this._localDateStr(this._date);
    const selected = this._selectedCalendar?.();
    const dateLabel = _clockDateLabel(this._date);
    const activeHalf = this._clockActiveHalf();
    const halfToggle = mode === 12 ? `
          <div class="gb-cal-clock-half-toggle" data-e2e-id="calendar-clock-half-toggle" role="group" aria-label="午前午後切替">
            <button type="button" data-e2e-id="calendar-clock-half-am" data-clock-half="0" aria-label="午前を表示" aria-pressed="${activeHalf === 0 ? 'true' : 'false'}">午前</button>
            <button type="button" data-e2e-id="calendar-clock-half-pm" data-clock-half="1" aria-label="午後を表示" aria-pressed="${activeHalf === 1 ? 'true' : 'false'}">午後</button>
          </div>` : '';
    this._contentEl.innerHTML = `
      <div class="gb-cal-clock-view" data-e2e-id="calendar-clock-view" data-clock-mode="${mode}">
        <div class="gb-cal-clock-view-meta">
          <span>${_clockEsc(dateStr)}</span>
          <span>選択中: ${_clockEsc(selected?.name || 'なし')}</span>
        </div>
        <div class="gb-cal-clock-stage" data-e2e-id="calendar-clock-stage">
          ${halfToggle}
          <svg class="gb-cal-clock-svg" data-e2e-id="calendar-clock-create-surface" viewBox="0 0 ${SIZE} ${SIZE}" role="img" aria-label="アナログ時計 ${mode}時間。空いている時間をドラッグして予定を作成">
            <circle class="gb-cal-clock-face" cx="${CX}" cy="${CY}" r="${OUTER_R}"></circle>
            <text class="gb-cal-clock-date-label" x="24" y="34">${_clockEsc(dateLabel)}</text>
            <g class="gb-cal-clock-events">${this._clockEventSlicesSvg(mode, dateStr)}</g>
            <g class="gb-cal-clock-preview"></g>
            <g class="gb-cal-clock-ticks">${this._clockTicksSvg(mode)}</g>
            <line class="gb-cal-clock-hand gb-cal-clock-hour" data-clock-hand="hour" x1="${CX}" y1="${CY}" x2="${CX}" y2="${mode === 24 ? 112 : 102}"></line>
            <line class="gb-cal-clock-hand gb-cal-clock-minute" data-clock-hand="minute" x1="${CX}" y1="${CY}" x2="${CX}" y2="65"></line>
            <line class="gb-cal-clock-hand gb-cal-clock-second" data-clock-hand="second" x1="${CX}" y1="${CY + 18}" x2="${CX}" y2="54"></line>
            <circle class="gb-cal-clock-pin" cx="${CX}" cy="${CY}" r="5"></circle>
          </svg>
          <div class="gb-cal-clock-hover-card" data-e2e-id="calendar-clock-hover-card" hidden></div>
        </div>
      </div>`;
    this._bindAnalogClockInteractions(mode, dateStr);
    this._syncAnalogClockSelectionDom();
    this._syncAnalogClockTimer(mode);
  };

  CalendarComponent.prototype._bindAnalogClockInteractions = function(mode, dateStr) {
    const root = this._contentEl;
    if (!root) return;
    root.querySelectorAll('[data-clock-half]').forEach(button => {
      button.addEventListener('pointerdown', event => event.stopPropagation());
      button.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        this._clock12Half = button.dataset.clockHalf === '1' ? 1 : 0;
        this._hideClockHoverCard();
        this._render();
      });
    });
    root.querySelectorAll('.gb-cal-clock-event[data-clock-event-id]').forEach(item => {
      const eventId = item.dataset.clockEventId || '';
      const ev = (this._events || []).find(entry => entry.id === eventId);
      item.addEventListener('click', (event) => {
        if (this._clockSuppressCardClickUntil && Date.now() < this._clockSuppressCardClickUntil) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        if (event.target.closest?.('[data-clock-resize]')) return;
        event.preventDefault();
        event.stopPropagation();
        if (event.target.closest?.('[data-clock-select]')) {
          this._toggleEventSelection?.(eventId);
          this._syncAnalogClockSelectionDom();
          return;
        }
        if (event.shiftKey) this._selectAnalogClockEventRange(eventId);
        else if (event.ctrlKey || event.metaKey) this._toggleEventSelection?.(eventId);
        else {
          this._setSelectedEvents?.([eventId], eventId);
          this._openEventInPanel(eventId);
        }
        this._syncAnalogClockSelectionDom();
      });
      item.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        this._setSelectedEvents?.([eventId], eventId);
        this._syncAnalogClockSelectionDom();
        this._openEventInPanel(eventId);
      });
      item.addEventListener('pointerenter', (event) => {
        if (ev) this._showClockHoverCard(event, ev);
      });
      item.addEventListener('pointermove', (event) => {
        if (ev) this._showClockHoverCard(event, ev);
      });
      item.addEventListener('pointerleave', () => this._hideClockHoverCard());
      item.addEventListener('pointerdown', (event) => {
        if (event.target.closest?.('[data-clock-select], [data-clock-resize]')) return;
        this._hideClockHoverCard();
        this._startAnalogClockMove(event, item, mode, dateStr);
      });
      item.querySelectorAll('[data-clock-resize]').forEach(handle => {
        handle.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
        });
        handle.addEventListener('pointerdown', (event) => {
          this._hideClockHoverCard();
          this._startAnalogClockResize(event, item, mode, dateStr, handle.dataset.clockResize);
        });
      });
    });
    this._bindAnalogClockOutsideClear(root.querySelector('.gb-cal-clock-stage'));
    this._bindAnalogClockCreateDrag(root.querySelector('.gb-cal-clock-svg'), mode, dateStr);
  };

  CalendarComponent.prototype._bindAnalogClockOutsideClear = function(stage) {
    const svg = stage?.querySelector?.('.gb-cal-clock-svg');
    if (!stage || !svg) return;
    stage.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || event.target.closest?.('.gb-cal-clock-event')) return;
      const outsideSvg = !svg.contains(event.target);
      const point = _clockSvgRelativePoint(svg, event.clientX, event.clientY);
      if (!outsideSvg && point.radius <= OUTER_R) return;
      this._setSelectedEvents?.([], '');
      this._syncAnalogClockSelectionDom();
      this._hideClockHoverCard();
    });
  };

  CalendarComponent.prototype._analogClockRenderedEventIds = function() {
    const ids = [];
    this._contentEl?.querySelectorAll?.('.gb-cal-clock-event[data-clock-event-id]').forEach(item => {
      const id = item.dataset.clockEventId || '';
      if (id && !ids.includes(id)) ids.push(id);
    });
    return ids;
  };

  CalendarComponent.prototype._selectAnalogClockEventRange = function(id) {
    const order = this._analogClockRenderedEventIds();
    const anchor = this._lastSelectedEventId || id;
    const a = order.indexOf(anchor), b = order.indexOf(id);
    if (a < 0 || b < 0) {
      this._setSelectedEvents?.([id], id);
      return;
    }
    const [from, to] = a < b ? [a, b] : [b, a];
    this._setSelectedEvents?.(order.slice(from, to + 1), id);
  };

  CalendarComponent.prototype._syncAnalogClockSelectionDom = function() {
    const sel = typeof this._eventSelection === 'function' ? this._eventSelection() : new Set();
    this._contentEl?.classList?.toggle?.('gb-cal-has-event-selection', sel.size > 0);
    this._contentEl?.querySelectorAll?.('.gb-cal-clock-event[data-clock-event-id]').forEach(item => {
      const selected = sel.has(item.dataset.clockEventId || '');
      item.classList.toggle('gb-cal-clock-event-selected', selected);
      const check = item.querySelector(':scope > .gb-cal-clock-select-check');
      if (check) check.setAttribute('aria-checked', selected ? 'true' : 'false');
    });
  };

  CalendarComponent.prototype._showClockHoverCard = function(event, ev) {
    const tip = this._contentEl?.querySelector?.('.gb-cal-clock-hover-card');
    const stage = this._contentEl?.querySelector?.('.gb-cal-clock-stage');
    if (!tip || !stage) return;
    const rect = stage.getBoundingClientRect();
    const start = String(ev.start || '').substring(11, 16);
    const end = String(ev.end || '').substring(11, 16);
    const timeLabel = `${start}${end ? ' - ' + end : ''}`;
    tip.innerHTML = `<div class="gb-cal-clock-hover-title">${_clockEsc(ev.title || '無題')}</div><div class="gb-cal-clock-hover-meta">${_clockEsc(timeLabel)}</div>`;
    tip.hidden = false;
    const left = _clockClamp(event.clientX - rect.left + 10, 6, Math.max(6, rect.width - 210));
    const top = _clockClamp(event.clientY - rect.top + 10, 6, Math.max(6, rect.height - 56));
    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
  };

  CalendarComponent.prototype._hideClockHoverCard = function() {
    const tip = this._contentEl?.querySelector?.('.gb-cal-clock-hover-card');
    if (tip) tip.hidden = true;
  };

  CalendarComponent.prototype._clockMinutesFromPointer = function(event, mode, dateStr) {
    void dateStr;
    return this._clockMinutesFromClient(event.clientX, event.clientY, mode);
  };

  CalendarComponent.prototype._clockMinutesFromClient = function(clientX, clientY, mode) {
    const svg = this._contentEl?.querySelector?.('.gb-cal-clock-svg');
    if (!svg) return 0;
    const { x, y } = _clockSvgRelativePoint(svg, clientX, clientY);
    let angle = Math.atan2(y, x) * 180 / Math.PI + 90;
    if (angle < 0) angle += 360;
    const period = mode === 24 ? 1440 : 720;
    let minutes = Math.round((angle / 360) * period / 15) * 15;
    minutes = ((minutes % period) + period) % period;
    if (mode === 12) {
      minutes += this._clockActiveHalf() * 720;
    }
    return Math.max(0, Math.min(1439, minutes));
  };

  CalendarComponent.prototype._clockEditableRangeForEvent = function(ev, dateStr) {
    const dayStart = new Date(dateStr + 'T00:00:00');
    const dayEnd = new Date(dayStart.getTime());
    dayEnd.setDate(dayEnd.getDate() + 1);
    const rawStart = _clockDate(ev?.start) || dayStart;
    const rawEnd = _clockDate(ev?.end) || new Date(rawStart.getTime() + CLOCK_DEFAULT_EVENT_MINUTES * 60000);
    const start = rawStart < dayStart ? dayStart : rawStart;
    const end = rawEnd > dayEnd ? dayEnd : rawEnd;
    if (ev?.all_day || rawEnd - rawStart >= 1439 * 60000) {
      return { start: 0, end: 1440, rawStart, rawEnd };
    }
    const startMin = _clockClamp(Math.floor(_clockMinutesOfDay(start)), 0, 1439);
    // 翌日0:00で終わるイベントは _clockMinutesOfDay が 0 を返すため、表示側（_clockEventIntervals）と同じ 1440 補正を行う
    const endMin = rawEnd >= dayEnd ? 1440 : _clockClamp(Math.ceil(_clockMinutesOfDay(end)), startMin + CLOCK_EVENT_EDGE_MINUTES, 1440);
    return { start: startMin, end: endMin, rawStart, rawEnd };
  };

  CalendarComponent.prototype._setClockRangePreview = function(mode, startMin, endMin, variant = 'create') {
    const preview = this._contentEl?.querySelector?.('.gb-cal-clock-preview');
    if (!preview) return;
    const ranges = _clockRangeIntervalsForMode(startMin, endMin, mode);
    preview.innerHTML = ranges.map(range => {
      const outer = EVENT_OUTER_R;
      const inner = EVENT_INNER_R;
      const startAngle = (range.start / range.period) * 360;
      const endAngle = (range.end / range.period) * 360;
      const path = _clockDonutPath(startAngle, endAngle, outer, inner);
      return `<path class="gb-cal-clock-selection-preview ${variant}" d="${path}" fill-rule="evenodd"></path>`;
    }).join('');
  };

  CalendarComponent.prototype._clearClockRangePreview = function() {
    const preview = this._contentEl?.querySelector?.('.gb-cal-clock-preview');
    if (preview) preview.innerHTML = '';
  };

  CalendarComponent.prototype._bindAnalogClockCreateDrag = function(svg, mode, dateStr) {
    if (!svg) return;
    let drag = null;
    const cleanup = () => {
      if (!drag) return;
      try { svg.releasePointerCapture(drag.pointerId); } catch (_) {}
      document.body.style.userSelect = '';
      this._clearClockRangePreview();
      drag = null;
    };
    const finish = () => {
      if (!drag) return;
      const current = drag;
      cleanup();
      const range = _clockRangeFromMinutes(current.startMin, current.endMin, CLOCK_DEFAULT_EVENT_MINUTES, mode);
      this._openEventInPanel(null, this._localDateTimeStr(_clockDateAtMinutes(dateStr, range.start)), this._localDateTimeStr(_clockDateAtMinutes(dateStr, range.end)), false);
    };
    svg.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || event.target.closest?.('.gb-cal-clock-event, .gb-cal-clock-event-slice')) return;
      if (_clockSvgRelativePoint(svg, event.clientX, event.clientY).radius > OUTER_R) return;
      event.preventDefault();
      const startMin = this._clockMinutesFromPointer(event, mode, dateStr);
      drag = { startMin, endMin: startMin, x: event.clientX, y: event.clientY, pointerId: event.pointerId };
      if (event.isTrusted !== false) {
        try { svg.setPointerCapture(event.pointerId); } catch (_) {}
      }
      document.body.style.userSelect = 'none';
      this._setClockRangePreview(mode, startMin, Math.min(1440, startMin + CLOCK_DEFAULT_EVENT_MINUTES), 'create');
    });
    svg.addEventListener('pointermove', (event) => {
      if (!drag) return;
      event.preventDefault();
      drag.endMin = this._clockMinutesFromPointer(event, mode, dateStr);
      const range = _clockRangeFromMinutes(drag.startMin, drag.endMin, CLOCK_DEFAULT_EVENT_MINUTES, mode);
      this._setClockRangePreview(mode, range.start, range.end, 'create');
    });
    svg.addEventListener('pointerup', (event) => {
      if (!drag) return;
      event.preventDefault();
      finish();
    });
    svg.addEventListener('pointercancel', cleanup);
    svg.addEventListener('lostpointercapture', cleanup);
  };

  CalendarComponent.prototype._commitAnalogClockEventChange = function(eventId, patch, label) {
    const before = this._snapshotEventLocal?.(eventId);
    this._pushUndo?.(label);
    this._applyEventLocal?.(eventId, patch);
    this._setSelectedEvents?.([eventId], eventId);
    this._render();
    apiPut('/cal/events/' + eventId, patch)
      .then(() => this._loadEvents())
      .then(() => this._render())
      .catch(() => {
        if (before) this._restoreEventLocal?.(before);
        this._render();
        this._showStatus?.(label + 'に失敗', true);
      });
  };

  CalendarComponent.prototype._startAnalogClockMove = function(event, card, mode, dateStr) {
    if (event.button !== 0) return;
    const eventId = card.dataset.eventId || card.dataset.clockEventId || '';
    const ev = (this._events || []).find(item => item.id === eventId);
    if (!ev || (typeof _calRecurringInteractionBlocked === 'function' && _calRecurringInteractionBlocked(this, ev))) return;
    event.preventDefault();
    event.stopPropagation();
    const range = this._clockEditableRangeForEvent(ev, dateStr);
    const rawDuration = range.end - range.start;
    const duration = ev.all_day || rawDuration >= 1439 ? CLOCK_DEFAULT_EVENT_MINUTES : _clockClamp(rawDuration, CLOCK_EVENT_EDGE_MINUTES, 1440);
    const downMin = this._clockMinutesFromClient(event.clientX, event.clientY, mode);
    const pointerOffset = _clockClamp(downMin - range.start, 0, Math.max(0, duration - CLOCK_EVENT_EDGE_MINUTES));
    const startX = event.clientX;
    const startY = event.clientY;
    let nextStart = range.start;
    let moved = false;
    document.body.style.userSelect = 'none';
    card.style.touchAction = 'none';
    const updatePreview = (clientX, clientY) => {
      const pointerMin = this._clockMinutesFromClient(clientX, clientY, mode);
      nextStart = _clockSnapMinutes(pointerMin - pointerOffset);
      nextStart = _clockClamp(nextStart, 0, Math.max(0, 1440 - duration));
      this._setClockRangePreview(mode, nextStart, nextStart + duration, 'move');
    };
    const onMove = (moveEvent) => {
      if (Math.abs(moveEvent.clientX - startX) >= CLOCK_DRAG_PX_THRESHOLD || Math.abs(moveEvent.clientY - startY) >= CLOCK_DRAG_PX_THRESHOLD) moved = true;
      updatePreview(moveEvent.clientX, moveEvent.clientY);
    };
    const cleanup = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onCancel);
      document.body.style.userSelect = '';
      card.style.touchAction = '';
      this._clearClockRangePreview();
    };
    const onCancel = () => {
      cleanup();
    };
    const onUp = () => {
      cleanup();
      if (!moved || nextStart === range.start) return;
      this._clockSuppressCardClickUntil = Date.now() + 300;
      const deltaMin = nextStart - range.start;
      // 跨日・複数日イベントは表示日内に切り詰めず、実際の開始/終了へ同じ移動量を適用する
      // （終日イベントの時間指定化は従来どおり）
      const patch = !ev.all_day && range.rawStart instanceof Date && range.rawEnd instanceof Date
        ? {
            start: this._localDateTimeStr(new Date(range.rawStart.getTime() + deltaMin * 60000)),
            end: this._localDateTimeStr(new Date(range.rawEnd.getTime() + deltaMin * 60000)),
            all_day: 0,
          }
        : {
            start: this._localDateTimeStr(_clockDateAtMinutes(dateStr, nextStart)),
            end: this._localDateTimeStr(_clockDateAtMinutes(dateStr, nextStart + duration)),
            all_day: 0,
          };
      this._commitAnalogClockEventChange(eventId, patch, 'イベント移動');
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onCancel);
  };

  CalendarComponent.prototype._startAnalogClockResize = function(event, card, mode, dateStr, edge) {
    if (event.button !== 0) return;
    const eventId = card.dataset.eventId || card.dataset.clockEventId || '';
    const ev = (this._events || []).find(item => item.id === eventId);
    if (!ev || (typeof _calRecurringInteractionBlocked === 'function' && _calRecurringInteractionBlocked(this, ev))) return;
    event.preventDefault();
    event.stopPropagation();
    const range = this._clockEditableRangeForEvent(ev, dateStr);
    let nextStart = range.start;
    let nextEnd = range.end;
    let moved = false;
    document.body.style.userSelect = 'none';
    card.style.touchAction = 'none';
    const updatePreview = (clientX, clientY) => {
      let pointerMin = this._clockMinutesFromClient(clientX, clientY, mode);
      if (edge === 'end' && range.end === 1440 && (pointerMin === 0 || (mode === 12 && pointerMin === 720))) pointerMin = 1440;
      else if (edge === 'end' && pointerMin < nextStart) {
        // 通常イベントの終端を文字盤上端まで延ばした場合の補正（24:00／半日境界として扱う）
        if (pointerMin === 0) pointerMin = mode === 12 ? 720 : 1440;
        else if (mode === 12 && pointerMin === 720) pointerMin = 1440;
      }
      if (edge === 'start') {
        nextStart = _clockClamp(_clockSnapMinutes(pointerMin), 0, nextEnd - CLOCK_EVENT_EDGE_MINUTES);
      } else {
        nextEnd = _clockClamp(_clockSnapMinutes(pointerMin), nextStart + CLOCK_EVENT_EDGE_MINUTES, 1440);
      }
      this._setClockRangePreview(mode, nextStart, nextEnd, 'resize');
    };
    const startX = event.clientX;
    const startY = event.clientY;
    const onMove = (moveEvent) => {
      if (Math.abs(moveEvent.clientX - startX) >= CLOCK_DRAG_PX_THRESHOLD || Math.abs(moveEvent.clientY - startY) >= CLOCK_DRAG_PX_THRESHOLD) moved = true;
      updatePreview(moveEvent.clientX, moveEvent.clientY);
    };
    const cleanup = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onCancel);
      document.body.style.userSelect = '';
      card.style.touchAction = '';
      this._clearClockRangePreview();
    };
    const onCancel = () => {
      cleanup();
    };
    const onUp = () => {
      cleanup();
      if (!moved || (nextStart === range.start && nextEnd === range.end)) return;
      this._clockSuppressCardClickUntil = Date.now() + 300;
      const patch = edge === 'start'
        ? { start: this._localDateTimeStr(_clockDateAtMinutes(dateStr, nextStart)), all_day: 0 }
        : { end: this._localDateTimeStr(_clockDateAtMinutes(dateStr, nextEnd)), all_day: 0 };
      this._commitAnalogClockEventChange(eventId, patch, 'イベントリサイズ');
    };
    this._setClockRangePreview(mode, nextStart, nextEnd, 'resize');
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onCancel);
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
