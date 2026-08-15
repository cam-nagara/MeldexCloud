/* ==============================
   gb-tool-calendar-options.js: Calendar option compatibility facade
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


  window.MeldexCalendarOptions = {
    EVENT_EDGE_MINUTES,
    DEFAULT_EVENT_COLOR,
    CALENDAR_SETTINGS_SCOPE,
    CALENDAR_DETAIL_TABS,
    _calEsc,
    _calIcon,
    _calCssEscape,
    _calKeyboardFromEditableTarget,
    _calLocalInputValue,
    _calLocalDateInputValue,
    _calSetEventDateInputMode,
  };
})();
