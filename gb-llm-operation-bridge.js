/* gb-llm-operation-bridge.js: LLMからMeldex UIを安全に操作するためのクライアント側ブリッジ */
(function () {
  'use strict';

  const CLIENT_TOOL_NAMES = new Set(['llm_list_ui_controls', 'llm_ui_action', 'configure_form_view']);
  const CONTROL_SELECTOR = [
    '[data-action]',
    '[data-onchange]',
    '[data-oninput]',
    '[onclick]',
    'a[href]',
    'button',
    'input',
    'select',
    'textarea',
    'summary',
    '[contenteditable="true"]',
    '[tabindex]',
    '[role="button"]',
    '[role="menuitem"]',
    '[role="checkbox"]',
    '[role="switch"]',
    '[role="radio"]',
    '[role="option"]',
    '[role="tab"]',
  ].join(',');
  const PATH_DATA_KEYS = [
    'path',
    'targetPath',
    'filePath',
    'folderPath',
    'itemPath',
    'dbPath',
    'sourcePath',
    'versionPath',
    'scenarioPath',
    'boardPath',
    'entityPath',
  ];
  let _nextControlId = 1;

  function _truncate(text, max = 120) {
    const value = String(text || '').replace(/\s+/g, ' ').trim();
    return value.length > max ? value.slice(0, max - 1) + '...' : value;
  }

  function _cssEscape(value) {
    const text = String(value || '');
    if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(text);
    return text.replace(/[^a-zA-Z0-9_-]/g, ch => '\\' + ch.charCodeAt(0).toString(16) + ' ');
  }

  function _attrValue(value) {
    return String(value || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }

  function _uniqueSelector(selector, element) {
    if (!selector || !element) return '';
    try {
      const found = document.querySelectorAll(selector);
      return found.length === 1 && found[0] === element ? selector : '';
    } catch {
      return '';
    }
  }

  function _stableSelector(element) {
    if (!element || element.nodeType !== 1) return '';
    const id = element.getAttribute('id');
    if (id) {
      const selector = '#' + _cssEscape(id);
      if (_uniqueSelector(selector, element)) return selector;
    }
    const e2e = element.getAttribute('data-e2e-id') || element.getAttribute('data-testid');
    if (e2e) {
      const selector = `[data-e2e-id="${_attrValue(e2e)}"],[data-testid="${_attrValue(e2e)}"]`;
      try {
        const found = Array.from(document.querySelectorAll(selector));
        if (found.length === 1 && found[0] === element) return selector;
      } catch {}
    }
    const action = element.getAttribute('data-action');
    if (action) {
      const selector = `[data-action="${_attrValue(action)}"]`;
      if (_uniqueSelector(selector, element)) return selector;
    }
    const name = element.getAttribute('name');
    if (name) {
      const selector = `${element.tagName.toLowerCase()}[name="${_attrValue(name)}"]`;
      if (_uniqueSelector(selector, element)) return selector;
    }
    if (!element.dataset.llmOpId) {
      element.dataset.llmOpId = 'llm-op-' + _nextControlId++;
    }
    return `[data-llm-op-id="${_attrValue(element.dataset.llmOpId)}"]`;
  }

  function _isVisible(element) {
    if (!element || !document.documentElement.contains(element)) return false;
    if (element.closest('#legacy-views,.gb-legacy-snapshot-host,[data-gb-snapshot="true"],[aria-hidden="true"],[inert]')) return false;
    const style = window.getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function _labelFromAssociatedLabel(element) {
    const id = element?.getAttribute?.('id');
    if (!id) return '';
    try {
      const label = document.querySelector(`label[for="${_attrValue(id)}"]`);
      return _truncate(label?.textContent || '');
    } catch {
      return '';
    }
  }

  function _elementLabel(element) {
    if (!element) return '';
    const attrs = ['aria-label', 'title', 'data-e2e-label', 'data-label', 'placeholder', 'name', 'value'];
    for (const attr of attrs) {
      const value = _truncate(element.getAttribute(attr) || '');
      if (value) return value;
    }
    const associated = _labelFromAssociatedLabel(element);
    if (associated) return associated;
    const text = _truncate(element.textContent || '');
    if (text) return text;
    const action = _truncate(element.getAttribute('data-action') || element.getAttribute('data-onchange') || element.getAttribute('data-oninput') || '');
    if (action) return action;
    return element.getAttribute('id') || element.tagName.toLowerCase();
  }

  function _controlKind(element) {
    const tag = element.tagName.toLowerCase();
    if (tag === 'input') return (element.getAttribute('type') || 'text').toLowerCase();
    if (tag === 'select' || tag === 'textarea' || tag === 'button') return tag;
    if (element.isContentEditable) return 'contenteditable';
    return element.getAttribute('role') || tag;
  }

  function _operationsFor(element) {
    const tag = element.tagName.toLowerCase();
    const type = _controlKind(element);
    const ops = new Set();
    if (tag === 'select') ops.add('set_value');
    if (tag === 'textarea' || element.isContentEditable) ops.add('set_value');
    if (tag === 'input') {
      if (['checkbox', 'radio'].includes(type)) {
        ops.add('set_checked');
        ops.add('toggle');
      } else {
        ops.add('set_value');
      }
    }
    if (element.hasAttribute('data-action') || element.hasAttribute('onclick') || tag === 'button' || tag === 'a' || tag === 'summary' || ['button', 'menuitem', 'tab', 'option'].includes(type)) ops.add('click');
    if (['checkbox', 'switch', 'radio'].includes(element.getAttribute('role') || '')) {
      ops.add('set_checked');
      ops.add('toggle');
    }
    ops.add('focus');
    return Array.from(ops);
  }

  function _controlValue(element) {
    const tag = element.tagName.toLowerCase();
    const type = _controlKind(element);
    if (tag === 'select' && element.multiple) {
      return Array.from(element.selectedOptions || []).map(option => option.value);
    }
    if (tag === 'input' && ['checkbox', 'radio'].includes(type)) return element.checked;
    if ('value' in element) return String(element.value ?? '');
    if (element.isContentEditable) return element.textContent || '';
    return '';
  }

  function _describeControl(element) {
    const selector = _stableSelector(element);
    const tag = element.tagName.toLowerCase();
    const type = _controlKind(element);
    return {
      id: element.dataset.llmOpId || element.id || '',
      selector,
      label: _elementLabel(element),
      tag,
      type,
      role: element.getAttribute('role') || '',
      value: _controlValue(element),
      checked: typeof element.checked === 'boolean' ? element.checked : undefined,
      disabled: !!(element.disabled || element.getAttribute('aria-disabled') === 'true'),
      visible: _isVisible(element),
      action: element.getAttribute('data-action') || '',
      operations: _operationsFor(element),
      path: _firstPathForElement(element),
    };
  }

  function _matchesQuery(descriptor, query) {
    const q = String(query || '').trim().toLowerCase();
    if (!q) return true;
    const haystack = [
      descriptor.label,
      descriptor.selector,
      descriptor.type,
      descriptor.role,
      descriptor.action,
      descriptor.path,
      String(descriptor.value || ''),
    ].join(' ').toLowerCase();
    return haystack.includes(q);
  }

  function _toBool(value, fallback = false) {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;
    const text = String(value ?? '').trim().toLowerCase();
    if (!text) return fallback;
    if (['1', 'true', 'yes', 'on', 'checked', '有効'].includes(text)) return true;
    if (['0', 'false', 'no', 'off', 'unchecked', '無効'].includes(text)) return false;
    return fallback;
  }

  function listControls(options = {}) {
    const includeHidden = _toBool(options.include_hidden ?? options.includeHidden, false);
    const query = options.query || '';
    const limit = Math.max(1, Math.min(300, Number(options.limit || 120) || 120));
    const seen = new Set();
    const controls = [];
    for (const element of Array.from(document.querySelectorAll(CONTROL_SELECTOR))) {
      if (!element || seen.has(element)) continue;
      seen.add(element);
      if (!includeHidden && !_isVisible(element)) continue;
      const descriptor = _describeControl(element);
      if (!_matchesQuery(descriptor, query)) continue;
      controls.push(descriptor);
      if (controls.length >= limit) break;
    }
    return { ok: true, count: controls.length, controls };
  }

  function _resolveElement(selectorOrId) {
    const raw = String(selectorOrId || '').trim();
    if (!raw) return null;
    const selectors = [];
    if (raw.startsWith('#') || raw.startsWith('.') || raw.startsWith('[') || raw.includes(' ') || raw.includes('>') || raw.includes(':')) {
      selectors.push(raw);
    }
    selectors.push(`[data-llm-op-id="${_attrValue(raw)}"]`);
    selectors.push('#' + _cssEscape(raw));
    selectors.push(`[data-e2e-id="${_attrValue(raw)}"]`);
    selectors.push(`[data-testid="${_attrValue(raw)}"]`);
    for (const selector of selectors) {
      try {
        const element = document.querySelector(selector);
        if (element) return element;
      } catch {}
    }
    const q = raw.toLowerCase();
    return Array.from(document.querySelectorAll(CONTROL_SELECTOR)).find(element => {
      const label = _elementLabel(element).toLowerCase();
      return label && label.includes(q);
    }) || null;
  }

  function _normalizePath(path) {
    return String(path || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '').trim();
  }

  function _candidatePathsFromDataset(element) {
    const paths = [];
    let node = element;
    let guard = 0;
    while (node && node.nodeType === 1 && guard++ < 8) {
      for (const key of PATH_DATA_KEYS) {
        const value = node.dataset?.[key];
        if (value) paths.push(value);
      }
      node = node.parentElement;
    }
    return paths;
  }

  function _candidatePathsFromArgs(args) {
    const paths = [];
    for (const key of PATH_DATA_KEYS) {
      const value = args?.[key];
      if (value) paths.push(value);
    }
    if (args?.path) paths.push(args.path);
    return paths;
  }

  function _firstPathForElement(element) {
    return _normalizePath(_candidatePathsFromDataset(element)[0] || '');
  }

  function _requireUnlocked(element, args) {
    if (typeof isItemLocked !== 'function') return;
    const paths = [..._candidatePathsFromArgs(args), ..._candidatePathsFromDataset(element)]
      .map(_normalizePath)
      .filter(Boolean);
    const lockedPath = [...new Set(paths)].find(path => {
      try { return isItemLocked(path); } catch { return false; }
    });
    if (!lockedPath) return;
    const reason = typeof getItemLockReason === 'function' ? getItemLockReason(lockedPath) : '';
    throw new Error(reason ? `編集ロック中のため操作できません（${lockedPath}: ${reason}）` : `編集ロック中のため操作できません（${lockedPath}）`);
  }

  function _captureLocalStorageAll() {
    const keys = [];
    try {
      for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i);
        if (key) keys.push(key);
      }
    } catch {}
    const storage = {};
    keys.sort().forEach(key => {
      try { storage[key] = localStorage.getItem(key); } catch { storage[key] = null; }
    });
    return { keys, storage };
  }

  function _storageChangedKeys(before, after) {
    const keys = new Set([...(before?.keys || []), ...(after?.keys || [])]);
    return Array.from(keys).filter(key => (before?.storage || {})[key] !== (after?.storage || {})[key]);
  }

  function _storageForKeys(snapshot, keys) {
    const storage = {};
    keys.forEach(key => {
      storage[key] = Object.prototype.hasOwnProperty.call(snapshot?.storage || {}, key)
        ? snapshot.storage[key]
        : null;
    });
    return { keys: keys.slice(), storage };
  }

  function _captureControlState(element) {
    if (!element) return null;
    return {
      selector: _stableSelector(element),
      value: _controlValue(element),
      checked: typeof element.checked === 'boolean' ? element.checked : undefined,
      ariaChecked: element.getAttribute('aria-checked'),
      text: element.isContentEditable ? element.textContent || '' : undefined,
    };
  }

  function _dispatchInputEvents(element) {
    if (!element) return;
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function _applyControlState(snapshot) {
    if (!snapshot?.selector) return;
    const element = _resolveElement(snapshot.selector);
    if (!element) return;
    const tag = element.tagName.toLowerCase();
    if (typeof snapshot.checked === 'boolean' && 'checked' in element) {
      element.checked = snapshot.checked;
    }
    if (snapshot.ariaChecked !== null && snapshot.ariaChecked !== undefined) {
      element.setAttribute('aria-checked', snapshot.ariaChecked);
    }
    if (element.isContentEditable && typeof snapshot.text === 'string') {
      element.textContent = snapshot.text;
    } else if (tag === 'select' && Array.isArray(snapshot.value)) {
      Array.from(element.options || []).forEach(option => {
        option.selected = snapshot.value.includes(option.value);
      });
    } else if ('value' in element && typeof snapshot.value !== 'boolean') {
      element.value = String(snapshot.value ?? '');
    }
    _dispatchInputEvents(element);
  }

  function _afterRestore(keys) {
    try {
      window.dispatchEvent(new CustomEvent('meldex-llm-operation-restored', { detail: { keys: keys || [] } }));
    } catch {}
    if (typeof renderHistoryList === 'function') renderHistoryList();
    if (typeof renderHistoryPanel === 'function') renderHistoryPanel();
  }

  function _restoreOperationSnapshot(snapshot) {
    const keys = snapshot?.localStorage?.keys || [];
    window.__meldexSuppressLocalStorageSettingsHistory = Number(window.__meldexSuppressLocalStorageSettingsHistory || 0) + 1;
    try {
      if (keys.length && typeof restoreLocalStorageSettings === 'function') {
        restoreLocalStorageSettings(snapshot.localStorage, restoredKeys => _afterRestore(restoredKeys));
      } else if (snapshot?.localStorage?.storage) {
        keys.forEach(key => {
          const value = snapshot.localStorage.storage[key];
          if (value === null || value === undefined) localStorage.removeItem(key);
          else localStorage.setItem(key, value);
        });
        _afterRestore(keys);
      }
      _applyControlState(snapshot?.control);
    } finally {
      window.__meldexSuppressLocalStorageSettingsHistory = Math.max(0, Number(window.__meldexSuppressLocalStorageSettingsHistory || 0) - 1);
    }
  }

  function _snapshotChanged(before, after, changedKeys) {
    if (changedKeys.length) return true;
    try {
      return JSON.stringify(before?.control || null) !== JSON.stringify(after?.control || null);
    } catch {
      return true;
    }
  }

  function _pushOperationHistory(label, before, after, changedKeys, detail) {
    if (typeof historyPush !== 'function') return false;
    if (!_snapshotChanged(before, after, changedKeys)) return false;
    const beforeSnapshot = {
      localStorage: _storageForKeys(before.localStorage, changedKeys),
      control: before.control,
    };
    const afterSnapshot = {
      localStorage: _storageForKeys(after.localStorage, changedKeys),
      control: after.control,
    };
    const scope = (typeof _historyActiveScope !== 'undefined') ? _historyActiveScope : '';
    historyPush(
      label || 'LLM操作',
      () => _restoreOperationSnapshot(beforeSnapshot),
      () => _restoreOperationSnapshot(afterSnapshot),
      scope,
      detail || ''
    );
    return true;
  }

  function _nextFrame() {
    return new Promise(resolve => requestAnimationFrame(() => resolve()));
  }

  async function _withSuppressedSettingsHistory(fn) {
    window.__meldexSuppressLocalStorageSettingsHistory = Number(window.__meldexSuppressLocalStorageSettingsHistory || 0) + 1;
    try {
      return await fn();
    } finally {
      window.__meldexSuppressLocalStorageSettingsHistory = Math.max(0, Number(window.__meldexSuppressLocalStorageSettingsHistory || 0) - 1);
    }
  }

  function _setSelectValue(element, rawValue) {
    const value = String(rawValue ?? '');
    const optionByValue = Array.from(element.options || []).find(option => option.value === value);
    const optionByText = Array.from(element.options || []).find(option => (option.textContent || '').trim() === value);
    element.value = (optionByValue || optionByText)?.value ?? value;
  }

  function _performDomAction(element, args) {
    const action = String(args.action || '').trim().toLowerCase();
    if (action === 'click') {
      element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
      return;
    }
    if (action === 'contextmenu') {
      const rect = element.getBoundingClientRect();
      element.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        view: window,
        clientX: rect.left + Math.min(12, Math.max(1, rect.width / 2)),
        clientY: rect.top + Math.min(12, Math.max(1, rect.height / 2)),
      }));
      return;
    }
    if (action === 'focus') {
      element.focus();
      return;
    }
    if (action === 'set_checked' || action === 'toggle') {
      const next = action === 'toggle'
        ? !(element.checked || element.getAttribute('aria-checked') === 'true')
        : _toBool(args.checked ?? args.value, true);
      if ('checked' in element) element.checked = next;
      element.setAttribute('aria-checked', next ? 'true' : 'false');
      _dispatchInputEvents(element);
      return;
    }
    if (action === 'set_value' || action === 'select' || action === 'input_text') {
      if (element.tagName.toLowerCase() === 'select') _setSelectValue(element, args.value);
      else if (element.isContentEditable) element.textContent = String(args.value ?? '');
      else if ('value' in element) element.value = String(args.value ?? '');
      else element.textContent = String(args.value ?? '');
      _dispatchInputEvents(element);
      return;
    }
    throw new Error('未対応のUI操作です: ' + (args.action || ''));
  }

  async function uiAction(args = {}) {
    const selector = args.selector || args.id || args.label || '';
    const element = _resolveElement(selector);
    if (!element) throw new Error('UI要素が見つかりません: ' + selector);
    if (element.disabled || element.getAttribute('aria-disabled') === 'true') throw new Error('UI要素が無効です: ' + _elementLabel(element));
    _requireUnlocked(element, args);

    const before = {
      localStorage: _captureLocalStorageAll(),
      control: _captureControlState(element),
    };
    const descriptor = _describeControl(element);
    await _withSuppressedSettingsHistory(async () => {
      _performDomAction(element, args);
      await _nextFrame();
      await _nextFrame();
    });
    const after = {
      localStorage: _captureLocalStorageAll(),
      control: _captureControlState(_resolveElement(descriptor.selector) || element),
    };
    const changedKeys = _storageChangedKeys(before.localStorage, after.localStorage);
    const historyPushed = _pushOperationHistory(
      'LLM操作: ' + (descriptor.label || descriptor.selector),
      before,
      after,
      changedKeys,
      `${args.action || ''} ${descriptor.selector || ''}`.trim()
    );
    const result = {
      ok: true,
      action: args.action || '',
      selector: descriptor.selector,
      label: descriptor.label,
      value: _controlValue(_resolveElement(descriptor.selector) || element),
      history: historyPushed,
      changed_keys: changedKeys,
      visible: _isVisible(_resolveElement(descriptor.selector) || element),
    };
    if (typeof showStatus === 'function') showStatus(historyPushed ? 'LLM操作を実行しました（Undo可能）' : 'LLM操作を実行しました');
    return result;
  }

  function _stringArray(value) {
    if (Array.isArray(value)) return value.map(v => String(v || '').trim()).filter(Boolean);
    if (typeof value === 'string') return value.split(/[,、\n]/).map(v => v.trim()).filter(Boolean);
    return [];
  }

  function _plainStringMap(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const result = {};
    Object.keys(value).forEach(key => {
      const k = String(key || '').trim();
      if (!k) return;
      result[k] = String(value[key] ?? '');
    });
    return result;
  }

  async function _loadPropertyTypesForForm(dbPath) {
    try {
      if (typeof state !== 'undefined' && state.currentDbPath === dbPath && typeof getPropertyTypes === 'function') {
        return getPropertyTypes(dbPath) || {};
      }
    } catch {}
    try {
      if (typeof apiFetch === 'function') {
        const meta = await apiFetch('/db-metadata?path=' + encodeURIComponent(dbPath));
        return meta?.property_types || {};
      }
    } catch {}
    return {};
  }

  function _dbViewConfigStorageKeyForBridge(dbPath) {
    if (typeof getDbViewConfigStorageKey === 'function') return getDbViewConfigStorageKey(dbPath);
    return 'dbViewConfig:' + (dbPath || '');
  }

  function _readDbViewConfigForBridge(dbPath) {
    if (typeof getDbViewConfig === 'function') return getDbViewConfig(dbPath) || {};
    try { return JSON.parse(localStorage.getItem(_dbViewConfigStorageKeyForBridge(dbPath)) || '{}') || {}; } catch { return {}; }
  }

  function _writeDbViewConfigForBridge(dbPath, cfg) {
    localStorage.setItem(_dbViewConfigStorageKeyForBridge(dbPath), JSON.stringify(cfg || {}));
  }

  async function configureFormView(args = {}) {
    const dbPath = _normalizePath(args.db_path || args.dbPath || args.path || '');
    if (!dbPath) throw new Error('db_path は必須です');
    const fields = _stringArray(args.fields);
    if (!fields.length) throw new Error('fields は1件以上必要です');
    const required = _stringArray(args.required).filter(prop => fields.includes(prop));
    const propTypes = await _loadPropertyTypesForForm(dbPath);
    const viewName = String(args.view_name || args.viewName || 'フォーム').trim() || 'フォーム';
    const current = _readDbViewConfigForBridge(dbPath);
    const views = Array.isArray(current.savedViews) ? current.savedViews.slice() : [];
    const getViewFormConfig = (view) => view?.typeSpecific?.form?.formConfig || view?.formConfig || null;
    const existingIdx = views.findIndex(view => {
      const cfg = getViewFormConfig(view);
      return view && view.viewMode === 'form' && (view.name === viewName || cfg?.id === args.id);
    });
    const previous = existingIdx >= 0 ? views[existingIdx] : null;
    const previousForm = getViewFormConfig(previous);
    const formConfig = {
      ...(previousForm || {}),
      id: String(args.id || previousForm?.id || ('form_' + Date.now())),
      fields,
      required,
      descriptions: _plainStringMap(args.descriptions),
      placeholders: _plainStringMap(args.placeholders),
      labels: _plainStringMap(args.labels),
      submitLabel: String(args.submit_label || args.submitLabel || previousForm?.submitLabel || '送信'),
      successMessage: String(args.success_message || args.successMessage || previousForm?.successMessage || '送信しました'),
      headerTitle: String(args.title || args.headerTitle || previousForm?.headerTitle || ''),
      headerDescription: String(args.description || args.headerDescription || previousForm?.headerDescription || ''),
      mode: String(args.mode || previousForm?.mode || 'edit') === 'answer' ? 'answer' : 'edit',
    };
    const entityNameProp = String(args.entity_name_property || args.entityNameProperty || previousForm?.entityNameProp || '').trim();
    if (entityNameProp) formConfig.entityNameProp = entityNameProp;
    const normalized = typeof normalizeDbFormConfig === 'function'
      ? normalizeDbFormConfig(formConfig, fields, propTypes)
      : formConfig;

    const before = { localStorage: _captureLocalStorageAll(), control: null };
    await _withSuppressedSettingsHistory(async () => {
      const next = _readDbViewConfigForBridge(dbPath);
      const nextViews = Array.isArray(next.savedViews) ? next.savedViews.slice() : [];
      const idx = existingIdx >= 0 ? existingIdx : nextViews.length;
      const baseView = nextViews[idx]
        || (typeof _makeDbViewStateFromCurrent === 'function' ? _makeDbViewStateFromCurrent(dbPath, 'form', viewName) : {});
      if (!baseView.typeSpecific || typeof baseView.typeSpecific !== 'object' || Array.isArray(baseView.typeSpecific)) baseView.typeSpecific = {};
      if (!baseView.typeSpecific.form || typeof baseView.typeSpecific.form !== 'object' || Array.isArray(baseView.typeSpecific.form)) baseView.typeSpecific.form = {};
      baseView.name = viewName;
      baseView.viewMode = 'form';
      baseView.typeSpecific.form.formConfig = normalized;
      nextViews[idx] = baseView;
      next.savedViews = nextViews;
      next.currentViewIdx = idx;
      _writeDbViewConfigForBridge(dbPath, next);
      if (typeof state !== 'undefined' && state.currentDbPath === dbPath) {
        try {
          if (typeof showView === 'function') showView('form');
          if (typeof renderDbViewTabs === 'function') renderDbViewTabs();
          if (typeof renderDbFormView === 'function') renderDbFormView();
        } catch {}
      }
      await _nextFrame();
    });
    const after = { localStorage: _captureLocalStorageAll(), control: null };
    const changedKeys = _storageChangedKeys(before.localStorage, after.localStorage);
    const historyPushed = _pushOperationHistory('LLM操作: フォームビュー設定', before, after, changedKeys, dbPath);
    if (typeof showStatus === 'function') showStatus(historyPushed ? 'フォームビューを設定しました（Undo可能）' : 'フォームビューを設定しました');
    return {
      ok: true,
      db_path: dbPath,
      view_name: viewName,
      fields: normalized.fields || fields,
      required: normalized.required || required,
      current_view_mode: 'form',
      history: historyPushed,
      changed_keys: changedKeys,
    };
  }

  async function handleClientToolRequest(payload = {}) {
    const name = String(payload.name || '').trim();
    const args = payload.args || {};
    if (!CLIENT_TOOL_NAMES.has(name)) {
      return { ok: false, error: '未知のクライアント側ツールです: ' + name };
    }
    try {
      if (name === 'llm_list_ui_controls') return listControls(args);
      if (name === 'llm_ui_action') return await uiAction(args);
      if (name === 'configure_form_view') return await configureFormView(args);
    } catch (error) {
      return { ok: false, error: error?.message || String(error) };
    }
    return { ok: false, error: '未実装のクライアント側ツールです: ' + name };
  }

  function promptSummary() {
    const result = listControls({ include_hidden: false, limit: 40 });
    if (!result.controls.length) return '';
    const lines = result.controls.map(control => {
      const ops = (control.operations || []).join('/');
      return `- ${control.label || control.selector} | selector=${control.selector} | type=${control.type} | ops=${ops}`;
    });
    return [
      '## 現在画面でLLM操作可能なUI候補',
      'UI操作が必要な場合は llm_list_ui_controls で候補を確認し、llm_ui_action で selector と action を指定してください。',
      ...lines,
    ].join('\n');
  }

  window.GBMeldexLlmOperations = {
    listControls,
    uiAction,
    configureFormView,
    handleClientToolRequest,
    promptSummary,
    isClientTool(name) {
      return CLIENT_TOOL_NAMES.has(String(name || ''));
    },
  };
})();
