(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MeldexDbCardInlineEditor = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const READ_ONLY_TYPES = new Set(['formula', 'rollup', 'created', 'modified', 'created-time', 'modified-time']);
  const DELEGATED_TYPES = new Set([
    'select', 'multi-select', 'status', 'relation', 'multi-relation', 'link', 'multi-link', 'image',
    'user', 'multi-user', 'common-tags',
  ]);

  function isReadOnlyColumn(config) {
    const cfg = config || {};
    return cfg.readOnly === true || READ_ONLY_TYPES.has(String(cfg.type || 'text'))
      || ['created', 'modified', 'modified_by'].includes(String(cfg.source || ''));
  }

  function defaultValidate(type, value) {
    const text = String(value == null ? '' : value).trim();
    if (type === 'number' && text && !Number.isFinite(Number(text))) return '数値を入力してください';
    if (type === 'date' && text && !/^\d{4}-\d{2}-\d{2}$/.test(text)) return '日付を入力してください';
    if (type === 'time' && text && !/^\d{2}:\d{2}(?::\d{2})?$/.test(text)) return '時刻を入力してください';
    return '';
  }

  function createInlineEditController(options) {
    const opts = options || {};
    const type = String(opts.type || 'text').replace(/_/g, '-');
    const state = {
      phase: 'idle', composing: false, originalValue: opts.initialValue, draftValue: opts.initialValue,
      lastError: '',
    };

    const emit = () => {
      if (typeof opts.onState === 'function') opts.onState({ ...state });
    };
    const render = (value, metadata) => {
      if (typeof opts.render === 'function') opts.render(value, metadata || {});
    };
    const report = (message) => {
      state.lastError = String(message || '');
      if (state.lastError && typeof opts.onError === 'function') opts.onError(state.lastError);
    };

    function begin() {
      if (state.phase !== 'idle' || isReadOnlyColumn({ ...opts, type })) return false;
      if (typeof opts.canEdit === 'function' && opts.canEdit() !== true) return false;
      state.phase = 'editing';
      state.draftValue = state.originalValue;
      state.lastError = '';
      emit();
      return true;
    }

    function setDraft(value) {
      if (state.phase !== 'editing') return;
      state.draftValue = value;
      emit();
    }

    function compositionStart() { state.composing = true; emit(); }
    function compositionEnd(value) { state.composing = false; if (value !== undefined) state.draftValue = value; emit(); }

    function cancel() {
      if (state.phase === 'idle') return false;
      state.phase = 'idle';
      state.composing = false;
      state.draftValue = state.originalValue;
      state.lastError = '';
      render(state.originalValue, { cancelled: true });
      emit();
      return true;
    }

    async function commit(reason) {
      if (state.phase !== 'editing' || state.composing) return { committed: false, reason: 'not-ready' };
      const validator = typeof opts.validate === 'function' ? opts.validate : value => defaultValidate(type, value);
      const validation = await validator(state.draftValue, { type, reason });
      const message = validation === false ? '入力内容を確認してください'
        : typeof validation === 'string' ? validation : validation && validation.message;
      if (message) {
        report(message);
        emit();
        return { committed: false, reason: 'invalid', error: message };
      }
      const oldValue = state.originalValue;
      const newValue = state.draftValue;
      if (same(oldValue, newValue)) {
        state.phase = 'idle';
        report('');
        render(oldValue, { unchanged: true });
        emit();
        return { committed: false, reason: 'unchanged' };
      }
      state.phase = 'saving';
      report('');
      render(newValue, { optimistic: true });
      emit();
      try {
        if (typeof opts.save !== 'function') throw new Error('保存処理を利用できません');
        const result = await opts.save(newValue, { oldValue, reason });
        state.originalValue = newValue;
        state.draftValue = newValue;
        state.phase = 'idle';
        if (typeof opts.pushUndo === 'function') {
          opts.pushUndo({ oldValue, newValue, result, undo: () => opts.save(oldValue, { oldValue: newValue, undo: true }), redo: () => opts.save(newValue, { oldValue, redo: true }) });
        }
        render(newValue, { saved: true, result });
        emit();
        return { committed: true, result };
      } catch (error) {
        state.phase = 'idle';
        state.draftValue = oldValue;
        render(oldValue, { rollback: true, error });
        if (typeof opts.rollback === 'function') await opts.rollback(oldValue, error);
        report(error && error.message || error || '保存に失敗しました');
        emit();
        return { committed: false, reason: 'save-failed', error };
      }
    }

    function handleKey(event) {
      const key = event && event.key;
      if (state.composing || (event && (event.isComposing || event.keyCode === 229))) return 'composing';
      if (key === 'Escape') { cancel(); return 'cancel'; }
      if (key === 'Enter' && !(event && event.shiftKey)) return 'commit';
      return 'continue';
    }

    return Object.freeze({ begin, cancel, commit, compositionEnd, compositionStart, handleKey, setDraft, state });
  }

  function attach(host, options) {
    if (!host || typeof host.addEventListener !== 'function') return null;
    const opts = options || {};
    const type = String(opts.type || 'text').replace(/_/g, '-');
    const readOnly = isReadOnlyColumn({ ...(opts.propertyConfig || {}), type, readOnly: opts.readOnly });
    host.classList.add('db-card-inline-editor-host');
    host.dataset.readOnly = readOnly ? 'true' : 'false';
    if (readOnly) return { readOnly: true, destroy() {} };

    let input = null;
    let errorElement = null;
    const render = typeof opts.render === 'function' ? opts.render : value => { host.textContent = display(value); };
    const controller = createInlineEditController({
      ...opts, type,
      render(value, metadata) {
        if (input && metadata && !metadata.optimistic) { input.remove(); input = null; }
        host.classList.toggle('is-editing', controller.state.phase === 'editing');
        render(value, metadata);
      },
      onError(message) {
        if (typeof opts.onError === 'function') opts.onError(message);
        if (!errorElement || !errorElement.isConnected) {
          errorElement = document.createElement('div');
          errorElement.className = 'db-card-inline-editor-error';
          host.appendChild(errorElement);
        }
        errorElement.textContent = message;
      },
    });

    const stopCardAction = event => {
      if (controller.state.phase !== 'idle' || event.type === 'click') {
        event.stopPropagation();
        if (event.type === 'dragstart') event.preventDefault();
      }
    };
    host.addEventListener('pointerdown', stopCardAction);
    host.addEventListener('dragstart', stopCardAction);

    const begin = event => {
      if (event) { event.preventDefault(); event.stopPropagation(); }
      if (DELEGATED_TYPES.has(type) && typeof opts.mountTypedEditor === 'function') {
        if (typeof opts.canEdit === 'function' && opts.canEdit() !== true) return;
        host.classList.add('is-editing');
        opts.mountTypedEditor(host, { stopCardAction });
        return;
      }
      if (type === 'checkbox') {
        if (!controller.begin()) return;
        controller.setDraft(!toBoolean(controller.state.originalValue) ? 'true' : 'false');
        controller.commit('toggle');
        return;
      }
      if (!controller.begin()) return;
      input = document.createElement('input');
      input.className = 'db-card-inline-editor-input';
      input.type = ['number', 'date', 'time'].includes(type) ? type : 'text';
      input.value = String(controller.state.draftValue == null ? '' : controller.state.draftValue);
      input.setAttribute('aria-label', opts.ariaLabel || opts.propertyName || 'カードの値');
      host.replaceChildren(input);
      host.classList.add('is-editing');
      input.addEventListener('input', () => controller.setDraft(input.value));
      input.addEventListener('compositionstart', controller.compositionStart);
      input.addEventListener('compositionend', () => controller.compositionEnd(input.value));
      input.addEventListener('keydown', async keyEvent => {
        const action = controller.handleKey(keyEvent);
        if (action === 'commit') { keyEvent.preventDefault(); keyEvent.stopPropagation(); await controller.commit('enter'); }
        if (action === 'cancel') { keyEvent.preventDefault(); keyEvent.stopPropagation(); }
      });
      input.addEventListener('blur', async () => {
        const result = await controller.commit('blur');
        if (result.reason === 'invalid' && input && input.isConnected) input.focus();
      });
      input.focus({ preventScroll: true });
      input.select();
    };
    host.addEventListener('click', begin);
    host.addEventListener('keydown', event => {
      if (event.key === 'Enter' && controller.state.phase === 'idle') begin(event);
    });
    if (!host.hasAttribute('tabindex')) host.tabIndex = 0;

    return {
      controller,
      destroy() {
        host.removeEventListener('click', begin);
        host.removeEventListener('pointerdown', stopCardAction);
        host.removeEventListener('dragstart', stopCardAction);
      },
    };
  }

  function same(left, right) { return JSON.stringify(left) === JSON.stringify(right); }
  function display(value) { return value == null || value === '' ? '—' : String(value); }
  function toBoolean(value) { return value === true || ['true', 'はい', '1', 'yes'].includes(String(value).toLowerCase()); }

  return Object.freeze({ DELEGATED_TYPES: Object.freeze([...DELEGATED_TYPES]), READ_ONLY_TYPES: Object.freeze([...READ_ONLY_TYPES]), attach, createInlineEditController, defaultValidate, isReadOnlyColumn });
});
