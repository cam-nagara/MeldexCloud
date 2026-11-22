/* Shared compact search + filter toolbar. Consumers supply filter definitions. */
(function (global) {
  'use strict';
  let active = null;
  function closePopup(restore = true) {
    if (!active) return;
    const { popup, anchor, outside, keydown } = active;
    active = null;
    document.removeEventListener('pointerdown', outside, true);
    document.removeEventListener('keydown', keydown, true);
    popup.remove(); anchor.setAttribute('aria-expanded', 'false');
    if (restore && anchor.isConnected) anchor.focus({ preventScroll: true });
  }
  function openPopup(anchor, title, content) {
    closePopup(false);
    const popup = document.createElement('div');
    popup.className = 'gb-context-menu gb-search-filter-popup';
    popup.dataset.uiComponent = 'filter-popup';
    popup.setAttribute('role', 'dialog'); popup.setAttribute('aria-label', title);
    popup.append(content); document.body.append(popup);
    anchor.setAttribute('aria-expanded', 'true');
    const outside = event => { if (!popup.contains(event.target) && !anchor.contains(event.target)) closePopup(false); };
    const keydown = event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); closePopup(); }
      else if (event.key === 'Tab' && typeof gbCyclePopupFocus === 'function') { event.preventDefault(); gbCyclePopupFocus(popup, event.shiftKey); }
    };
    active = { popup, anchor, outside, keydown };
    global.attachMeldexDropdownCloseButton(popup, { trigger: anchor, close: () => closePopup() });
    positionPopup(popup, anchor.getBoundingClientRect(), { prefer: 'below' });
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', keydown, true);
    popup.querySelector('input, select, button')?.focus();
    return popup;
  }

  function create(options = {}) {
    const el = document.createElement('div'); el.className = 'gb-search-filter-row gb-toolbar';
    el.dataset.uiComponent = 'search-filter-row';
    const input = document.createElement('input'); input.type = 'search'; input.className = 'tb-input gb-search-filter-input';
    input.placeholder = options.placeholder || 'ワード検索'; input.setAttribute('aria-label', options.label || input.placeholder);
    const controls = document.createElement('div'); controls.className = 'gb-search-filter-buttons';
    const actions = document.createElement('div'); actions.className = 'gb-search-filter-actions';
    input.dataset.toolbarOverflowPriority='1';actions.dataset.toolbarOverflowPriority='1';
    el.append(input, controls, actions);
    let value = { query: '', filters: {} };
    const buttons = new Map();
    const notify = (emit = true) => {
      buttons.forEach((button, id) => {
        const current = value.filters[id];
        const enabled = typeof current === 'object' ? !!(current?.from || current?.to) : !!current;
        button.classList.toggle('active', enabled); button.setAttribute('aria-pressed', String(enabled));
      });
      if(emit) options.onChange?.(structuredClone(value));
    };
    input.addEventListener('input', event => { if (event.isComposing) return; value.query = input.value; notify(); });
    input.addEventListener('compositionend', () => { value.query = input.value; notify(); });
    function showFilter(def, anchor) {
      const content = document.createElement('div'); content.className = 'gb-search-filter-fields';
      const add = (label, type, initial, change) => {
        const wrap = document.createElement('label'); wrap.textContent = label;
        const field = document.createElement(type === 'select' ? 'select' : 'input');
        if (type !== 'select') field.type = type;
        field.className = type === 'select' ? 'gb-select' : 'gb-input'; field.setAttribute('aria-label', label);
        if (type === 'select') {
          const items = typeof def.options === 'function' ? def.options() : def.options || [];
          [{value:'',label:'すべて'}, ...items].forEach(item => {
            const option = document.createElement('option'); option.value = typeof item === 'string' ? item : item.value;
            option.textContent = typeof item === 'string' ? item : item.label; field.append(option);
          });
        }
        field.value = initial || ''; field.addEventListener(type === 'select' ? 'change' : 'input', () => { change(field.value); notify(); });
        wrap.append(field); content.append(wrap);
      };
      if (def.type === 'date-range') {
        const dates = { ...(value.filters[def.id] || {}) };
        add('開始日', 'date', dates.from, v => { dates.from = v; value.filters[def.id] = { ...dates }; });
        add('終了日', 'date', dates.to, v => { dates.to = v; value.filters[def.id] = { ...dates }; });
      } else add(def.label, def.type === 'text' ? 'text' : 'select', value.filters[def.id], v => { value.filters[def.id] = v; });
      openPopup(anchor, def.label, content);
    }
    (options.filters || []).forEach(def => {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'tb-icon-btn';
      button.setAttribute('aria-label', def.label); button.setAttribute('data-tooltip', def.label);
      button.setAttribute('aria-haspopup', 'dialog'); button.setAttribute('aria-expanded', 'false'); button.setAttribute('aria-pressed', 'false');
      button.innerHTML = typeof lucide === 'function' ? lucide(def.icon || 'filter', 16) : def.label;
      button.onclick = () => active?.anchor === button ? closePopup() : showFilter(def, button);
      controls.append(button); buttons.set(def.id, button);
    });
    return { el, input, actions, getValue: () => structuredClone(value),
      setValue(next, emit = false) { value = { query: next?.query || '', filters: { ...(next?.filters || {}) } }; input.value = value.query; notify(emit); },
      destroy() { if (active && el.contains(active.anchor)) closePopup(false); el.remove(); },
    };
  }
  global.MeldexSearchFilterRow = Object.freeze({ create });
  global.MeldexFilterPopup = Object.freeze({ open: openPopup, close: closePopup });
})(window);
