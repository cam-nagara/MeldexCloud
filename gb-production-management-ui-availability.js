/* gb-production-management-ui-availability.js: shared production write availability */
(function() {
  'use strict';

  const WRITE_SELECTOR = '[data-production-write-action="1"]';
  const FORM_SELECTOR = 'form[data-production-write-form="1"]';
  const DRAG_SELECTOR = '[data-production-write-drag="1"]';
  const FORM_FIELD_SELECTOR = 'input, select, textarea, [contenteditable="true"]';
  let observer = null;
  let syncPending = false;
  let lastSignature = '';
  const disabledStates = new WeakMap();
  const titleStates = new WeakMap();
  const draggableStates = new WeakMap();

  function current() {
    if (typeof document === 'undefined') return { blocked: false, reason: '', kind: '' };
    const dataset = document.body?.dataset || {};
    if (dataset.cloudReadonly === '1') {
      return { blocked: true, reason: '閲覧専用モードでは変更できません', kind: 'readonly' };
    }
    if (dataset.cloudQuotaBlocked === '1') {
      return { blocked: true, reason: 'Dropboxの空き容量が不足しているため変更できません', kind: 'quota' };
    }
    return { blocked: false, reason: '', kind: '' };
  }

  function notify(reason) {
    if (typeof window.showStatus === 'function') window.showStatus(reason, true);
  }

  function ensureWritable(options = {}) {
    const availability = current();
    if (!availability.blocked) return true;
    if (options.notify !== false) notify(availability.reason);
    return false;
  }

  function rememberAttribute(element, name, dataName) {
    if (element.dataset[dataName] !== undefined) return;
    const value = element.getAttribute(name);
    element.dataset[dataName] = value === null ? '__missing__' : value;
  }

  function restoreAttribute(element, name, dataName) {
    const value = element.dataset[dataName];
    if (value === undefined) return;
    if (value === '__missing__') element.removeAttribute(name);
    else element.setAttribute(name, value);
    delete element.dataset[dataName];
  }

  function findPropertyDescriptor(element, name) {
    let target = element;
    while (target) {
      const descriptor = Object.getOwnPropertyDescriptor(target, name);
      if (descriptor) return { owner: target, descriptor };
      target = Object.getPrototypeOf(target);
    }
    return null;
  }

  function installDisabledState(element) {
    if (!element || !('disabled' in element)) return null;
    const existing = disabledStates.get(element);
    if (existing) return existing;
    const found = findPropertyDescriptor(element, 'disabled');
    let rawValue = !!element.disabled;
    const readNative = found?.descriptor?.get
      ? () => !!found.descriptor.get.call(element)
      : () => rawValue;
    const writeNative = found?.descriptor?.set
      ? value => found.descriptor.set.call(element, !!value)
      : value => { rawValue = !!value; };
    const state = {
      intrinsicDisabled: readNative(),
      readNative,
      writeNative,
    };
    try {
      Object.defineProperty(element, 'disabled', {
        configurable: true,
        enumerable: found?.descriptor?.enumerable ?? true,
        get: readNative,
        set(value) {
          state.intrinsicDisabled = !!value;
          const desired = current().blocked ? true : state.intrinsicDisabled;
          if (readNative() !== desired) writeNative(desired);
        },
      });
    } catch {
      return null;
    }
    disabledStates.set(element, state);
    return state;
  }

  function syncDisabled(element, blocked) {
    const state = installDisabledState(element);
    if (!state) return;
    const desired = blocked ? true : state.intrinsicDisabled;
    if (state.readNative() !== desired) state.writeNative(desired);
  }

  function installTitleState(element) {
    if (!element || !('title' in element)) return null;
    const existing = titleStates.get(element);
    if (existing) return existing;
    const found = findPropertyDescriptor(element, 'title');
    let rawValue = String(element.title || '');
    const readNative = found?.descriptor?.get
      ? () => String(found.descriptor.get.call(element) || '')
      : () => rawValue;
    const writeNative = found?.descriptor?.set
      ? value => found.descriptor.set.call(element, String(value || ''))
      : value => { rawValue = String(value || ''); };
    const state = {
      intrinsicTitle: readNative(),
      readNative,
      writeNative,
    };
    try {
      Object.defineProperty(element, 'title', {
        configurable: true,
        enumerable: found?.descriptor?.enumerable ?? true,
        get: readNative,
        set(value) {
          state.intrinsicTitle = String(value || '');
          const availability = current();
          const desired = availability.blocked ? availability.reason : state.intrinsicTitle;
          if (readNative() !== desired) writeNative(desired);
        },
      });
    } catch {
      return null;
    }
    titleStates.set(element, state);
    return state;
  }

  function syncTitle(element, availability) {
    const state = installTitleState(element);
    if (!state) return;
    const desired = availability.blocked ? availability.reason : state.intrinsicTitle;
    if (state.readNative() !== desired) state.writeNative(desired);
  }

  function installDraggableState(element) {
    if (!element || !('draggable' in element)) return null;
    const existing = draggableStates.get(element);
    if (existing) return existing;
    const found = findPropertyDescriptor(element, 'draggable');
    let rawValue = !!element.draggable;
    const readNative = found?.descriptor?.get
      ? () => !!found.descriptor.get.call(element)
      : () => rawValue;
    const writeNative = found?.descriptor?.set
      ? value => found.descriptor.set.call(element, !!value)
      : value => { rawValue = !!value; };
    const state = {
      intrinsicDraggable: readNative(),
      readNative,
      writeNative,
    };
    try {
      Object.defineProperty(element, 'draggable', {
        configurable: true,
        enumerable: found?.descriptor?.enumerable ?? true,
        get: readNative,
        set(value) {
          state.intrinsicDraggable = !!value;
          const desired = current().blocked ? false : state.intrinsicDraggable;
          if (readNative() !== desired) writeNative(desired);
        },
      });
    } catch {
      return null;
    }
    draggableStates.set(element, state);
    return state;
  }

  function syncDragControl(element, availability = current()) {
    const state = installDraggableState(element);
    if (!state) return;
    const desired = availability.blocked ? false : state.intrinsicDraggable;
    if (state.readNative() !== desired) state.writeNative(desired);
    element.dataset.productionWriteBlocked = availability.blocked ? availability.kind : '';
    if (!availability.blocked) delete element.dataset.productionWriteBlocked;
  }

  function syncControl(element, availability = current()) {
    if (!element) return;
    if (availability.blocked) {
      rememberAttribute(element, 'aria-disabled', 'productionAvailabilityAriaDisabled');
      syncDisabled(element, true);
      if (element.getAttribute('aria-disabled') !== 'true') element.setAttribute('aria-disabled', 'true');
      syncTitle(element, availability);
      element.dataset.productionWriteBlocked = availability.kind;
      return;
    }
    syncDisabled(element, false);
    syncTitle(element, availability);
    restoreAttribute(element, 'aria-disabled', 'productionAvailabilityAriaDisabled');
    delete element.dataset.productionWriteBlocked;
  }

  function matchingElements(root, selector) {
    if (!root) return [];
    const elements = [];
    if (root.matches?.(selector)) elements.push(root);
    root.querySelectorAll?.(selector)?.forEach(element => elements.push(element));
    return elements;
  }

  function sync(root = (typeof document !== 'undefined' ? document : null)) {
    const availability = current();
    matchingElements(root, FORM_SELECTOR).forEach(form => {
      form.querySelectorAll?.(FORM_FIELD_SELECTOR)?.forEach(markWriteControl);
    });
    matchingElements(root, WRITE_SELECTOR).forEach(element => syncControl(element, availability));
    matchingElements(root, DRAG_SELECTOR).forEach(element => syncDragControl(element, availability));
    const signature = `${availability.kind}:${availability.reason}`;
    if (signature === lastSignature) return availability;
    lastSignature = signature;
    if (typeof document !== 'undefined' && typeof CustomEvent === 'function') {
      document.dispatchEvent?.(new CustomEvent('meldex:production-write-availability-changed', {
        detail: availability,
      }));
    }
    return availability;
  }

  function blockEventWhenUnavailable(event) {
    if (ensureWritable()) return;
    event.preventDefault();
    event.stopImmediatePropagation?.();
    event.stopPropagation();
  }

  function markWriteControl(element) {
    if (!element) return element;
    element.dataset.productionWriteAction = '1';
    if (element.dataset.productionWriteGuardBound !== '1') {
      element.dataset.productionWriteGuardBound = '1';
      element.addEventListener('click', blockEventWhenUnavailable, true);
    }
    syncControl(element);
    return element;
  }

  function markWriteForm(form) {
    if (!form) return form;
    form.dataset.productionWriteForm = '1';
    if (form.dataset.productionWriteGuardBound !== '1') {
      form.dataset.productionWriteGuardBound = '1';
      form.addEventListener('submit', blockEventWhenUnavailable, true);
    }
    form.querySelectorAll?.(FORM_FIELD_SELECTOR)?.forEach(markWriteControl);
    return form;
  }

  function markWriteDrag(element) {
    if (!element) return element;
    element.dataset.productionWriteDrag = '1';
    if (element.dataset.productionWriteDragGuardBound !== '1') {
      element.dataset.productionWriteDragGuardBound = '1';
      element.addEventListener('dragstart', blockEventWhenUnavailable, true);
    }
    syncDragControl(element);
    return element;
  }

  function scheduleSync() {
    if (syncPending) return;
    syncPending = true;
    const enqueue = typeof queueMicrotask === 'function' ? queueMicrotask : callback => Promise.resolve().then(callback);
    enqueue(() => {
      syncPending = false;
      sync(document);
    });
  }

  function install() {
    if (typeof document === 'undefined') return;
    if (observer || !document.body || typeof MutationObserver !== 'function') {
      sync(document);
      return;
    }
    observer = new MutationObserver(scheduleSync);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-cloud-readonly', 'data-cloud-quota-blocked', 'disabled'],
    });
    sync(document);
  }

  window.MeldexProductionUiAvailability = Object.freeze({
    current,
    ensureWritable,
    markWriteControl,
    markWriteForm,
    markWriteDrag,
    sync,
    writeSelector: WRITE_SELECTOR,
    writeFormSelector: FORM_SELECTOR,
    writeDragSelector: DRAG_SELECTOR,
  });

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
    else install();
  }
})();
