/* Multiple-instance, visibility-bounded host for embedded sheet/board views. */
(function (global) {
  'use strict';

  const RESOURCE_TOOL_TYPES = Object.freeze({ sheet: 'db', board: 'board' });

  function _registerCapabilities() {
    if (typeof global.registerToolCapability !== 'function') return;
    global.registerToolCapability('db', 'embeddable', true);
    global.registerToolCapability('board', 'embeddable', true);
  }

  function _componentIsEmbeddable(toolType) {
    if (typeof global.getToolCapability !== 'function') return toolType === 'db' || toolType === 'board';
    return global.getToolCapability(toolType, 'embeddable');
  }

  function _defaultFactory(type, paneId, tabId, options) {
    return typeof global.createToolComponent === 'function'
      ? global.createToolComponent(type, paneId, tabId, options)
      : null;
  }

  function _apiPath(block) {
    return '/topic-views/' + encodeURIComponent(block.documentId)
      + '/views/' + encodeURIComponent(block.viewId) + '/snapshot';
  }

  function _statusForError(error) {
    const status = Number(error?.status || error?.response?.status || 0);
    if (status === 403) return 'denied';
    if (status === 404) return 'missing';
    if (status === 409) return 'conflict';
    if (global.navigator?.onLine === false || status === 0) return 'offline';
    return 'error';
  }

  async function _defaultLoadView(block, options) {
    if (typeof global.apiFetch !== 'function') {
      return { status: 'offline', readOnly: true, reason: 'ビューの読み込みAPIへ接続できません' };
    }
    try {
      const payload = await global.apiFetch(_apiPath(block), {
        silentError: true,
        signal: options?.signal,
      });
      const permission = String(payload?.permission || '');
      const readOnly = !!payload?.readOnly || permission === 'read-only';
      return {
        status: 'ready', readOnly,
        reason: readOnly ? 'このビューは読み取り専用です' : '', snapshot: payload,
        dbPath: block.dbPath || block.legacyPath || '',
        boardPath: block.boardPath || block.legacyPath || '',
      };
    } catch (error) {
      return {
        status: _statusForError(error), readOnly: true,
        reason: String(error?.message || 'ビューを読み込めませんでした'),
      };
    }
  }

  function _defaultSubscribe(_block, callback) {
    if (typeof global.addEventListener !== 'function') return null;
    const offline = () => callback({ status: 'offline', reason: 'ソースへ接続できません' });
    const online = () => callback({ status: 'ready', reconnect: true });
    global.addEventListener('offline', offline);
    global.addEventListener('online', online);
    return () => {
      global.removeEventListener('offline', offline);
      global.removeEventListener('online', online);
    };
  }

  function _abortController() {
    return typeof AbortController === 'function'
      ? new AbortController()
      : { signal: { aborted: false }, abort() { this.signal.aborted = true; } };
  }

  class TopicViewHost {
    constructor(options) {
      const opts = options || {};
      this.componentFactory = opts.componentFactory || _defaultFactory;
      this.loadView = opts.loadView || _defaultLoadView;
      this.subscribe = opts.subscribe || _defaultSubscribe;
      this.onStatus = opts.onStatus || null;
      this.root = opts.root || null;
      this.entries = [];
      this.byBlockId = new Map();
      this.preferredBoardBlockId = null;
      this.destroyed = false;
      this._observer = this._createObserver(opts.IntersectionObserver || global.IntersectionObserver);
      _registerCapabilities();
    }

    _createObserver(ObserverClass) {
      if (typeof ObserverClass !== 'function') return null;
      return new ObserverClass((changes) => {
        changes.forEach((change) => {
          const blockId = change.target?.dataset?.meldexEmbedRuntimeId
            || change.target?.dataset?.meldexEmbedBlockId;
          const entry = blockId ? this.byBlockId.get(blockId) : null;
          if (entry) entry.visible = !!change.isIntersecting;
        });
        this._reconcile();
      }, { root: this.root, threshold: 0.01 });
    }

    register(block, container, options) {
      if (this.destroyed) throw new Error('TopicViewHost is destroyed');
      const runtimeBlockId = String(options?.runtimeBlockId || block?.blockId || '');
      if (!block || !block.blockId || !runtimeBlockId || this.byBlockId.has(runtimeBlockId)) {
        throw new Error('embedded blockId must be unique');
      }
      if (!container || typeof container.appendChild !== 'function') {
        throw new Error('embedded view container is required');
      }
      const mountPoint = (options && options.mountPoint) || container;
      container.dataset.meldexEmbedBlockId = block.blockId;
      container.dataset.meldexEmbedRuntimeId = runtimeBlockId;
      const entry = {
        block,
        runtimeBlockId,
        container,
        mountPoint,
        visible: false,
        mounted: false,
        mounting: false,
        component: null,
        savedState: null,
        abortController: null,
        unsubscribe: null,
        listeners: [],
        hostListeners: [],
        boardActive: false,
        generation: 0,
      };
      this.entries.push(entry);
      this.byBlockId.set(runtimeBlockId, entry);
      this._bindHostSelection(entry);
      if (this._observer) this._observer.observe(container);
      else {
        entry.visible = this.entries.length === 1;
        this._reconcile();
      }
      return () => this.unregister(runtimeBlockId);
    }

    unregister(blockId) {
      const entry = this.byBlockId.get(blockId);
      if (!entry) return false;
      if (this._observer) this._observer.unobserve(entry.container);
      this._unmount(entry);
      this._releaseHostListeners(entry);
      this.byBlockId.delete(blockId);
      this.entries = this.entries.filter((item) => item !== entry);
      this._reconcile();
      return true;
    }

    replaceBlock(blockId, nextBlock) {
      const entry = this.byBlockId.get(blockId);
      if (!entry || !nextBlock || nextBlock.blockId !== entry.block.blockId) return false;
      this._unmount(entry);
      this._releaseHostListeners(entry);
      entry.block = nextBlock;
      this._bindHostSelection(entry);
      this._reconcile();
      return true;
    }

    _wantedEntries() {
      const wanted = new Set();
      this.entries.forEach((entry, index) => {
        if (!entry.visible) return;
        wanted.add(entry);
        if (index > 0) wanted.add(this.entries[index - 1]);
        if (index + 1 < this.entries.length) wanted.add(this.entries[index + 1]);
      });
      // CanvasComponent currently owns the legacy global `bd` runtime.  Keep
      // exactly one embedded Board live while allowing all nearby Sheets to
      // stay warm; a pointer press transfers that single Board runtime.
      const visibleBoards = this.entries.filter(entry => entry.visible
        && entry.block.resourceType === 'board');
      const preferred = visibleBoards.find(entry => entry.runtimeBlockId === this.preferredBoardBlockId);
      const selectedBoard = preferred || visibleBoards[0] || null;
      for (const entry of Array.from(wanted)) {
        if (entry.block.resourceType === 'board') wanted.delete(entry);
      }
      if (selectedBoard) {
        this.preferredBoardBlockId = selectedBoard.runtimeBlockId;
        wanted.add(selectedBoard);
      }
      return wanted;
    }

    _reconcile() {
      if (this.destroyed) return;
      const wanted = this._wantedEntries();
      // Release the global Board runtime before mounting its successor.
      this.entries.forEach((entry) => {
        if (!wanted.has(entry)) this._unmount(entry);
      });
      this.entries.forEach((entry) => { if (wanted.has(entry)) this._mount(entry); });
    }

    _bindHostSelection(entry) {
      if (entry.block.resourceType !== 'board') return;
      const prefer = () => {
        if (this.preferredBoardBlockId === entry.runtimeBlockId) return;
        this.preferredBoardBlockId = entry.runtimeBlockId;
        this._reconcile();
      };
      entry.container.addEventListener('pointerdown', prefer);
      entry.hostListeners.push(['pointerdown', prefer, false]);
    }

    _releaseHostListeners(entry) {
      entry.hostListeners.forEach(([type, listener, capture]) => {
        entry.container.removeEventListener(type, listener, !!capture);
      });
      entry.hostListeners = [];
    }

    async _mount(entry) {
      if (entry.mounted || entry.mounting || this.destroyed) return;
      const toolType = RESOURCE_TOOL_TYPES[entry.block.resourceType];
      if (!toolType || !_componentIsEmbeddable(toolType)) {
        this._status(entry, 'unsupported', 'この種類のビューは埋め込み表示できません');
        return;
      }
      entry.mounting = true;
      entry.generation += 1;
      const generation = entry.generation;
      const controller = _abortController();
      entry.abortController = controller;
      this._status(entry, 'loading', 'ビューを読み込んでいます');
      try {
        const loaded = await this.loadView(entry.block, { signal: controller.signal });
        if (this.destroyed || generation !== entry.generation || controller.signal.aborted) return;
        const status = loaded && loaded.status ? loaded.status : 'ready';
        const reason = loaded && loaded.reason ? String(loaded.reason) : '';
        if (status !== 'ready' && !(loaded && loaded.snapshot)) {
          this._status(entry, status, reason || 'ビューを読み込めませんでした');
          return;
        }
        const readOnly = entry.block.display.interaction === 'read-only'
          || !!(loaded && loaded.readOnly)
          || status !== 'ready';
        const options = {
          embedded: true,
          blockId: entry.runtimeBlockId,
          persistedBlockId: entry.block.blockId,
          sourceId: entry.block.sourceId,
          documentId: entry.block.documentId,
          viewId: entry.block.viewId,
          undoScope: 'embed:' + entry.runtimeBlockId + ':' + entry.block.viewId,
          interaction: readOnly ? 'read-only' : 'editable',
          snapshot: loaded && loaded.snapshot,
          dbPath: (loaded && loaded.dbPath) || entry.block.dbPath || entry.block.legacyPath || '',
          boardPath: (loaded && loaded.boardPath) || entry.block.boardPath || entry.block.legacyPath || '',
          signal: controller.signal,
        };
        const paneId = 'embed:' + entry.runtimeBlockId;
        const tabId = paneId + ':' + entry.block.viewId;
        const component = this.componentFactory(toolType, paneId, tabId, options);
        if (!component || typeof component.mount !== 'function') {
          throw new Error('埋め込み用コンポーネントを作成できません');
        }
        entry.component = component;
        if (entry.savedState && typeof component.restoreState === 'function') {
          component.restoreState(entry.savedState);
        }
        component.state = Object.assign({}, component.state || {}, options);
        component.mount(entry.mountPoint);
        if (typeof component.activate === 'function') component.activate();
        entry.mounted = true;
        this._bindInteraction(entry);
        if (readOnly) this._bindReadOnly(entry);
        if (typeof this.subscribe === 'function') {
          const release = this.subscribe(entry.block, (event) => this._onUpdate(entry, event), options);
          if (typeof release === 'function') entry.unsubscribe = release;
        }
        this._status(entry, readOnly ? status === 'ready' ? 'read-only' : status : 'ready', reason);
      } catch (error) {
        if (!controller.signal.aborted) this._status(entry, 'error', String(error.message || error));
        this._releaseRuntime(entry, { preserveState: false });
      } finally {
        if (generation === entry.generation) entry.mounting = false;
      }
    }

    _bindInteraction(entry) {
      if (entry.block.resourceType !== 'board') return;
      const activate = () => {
        entry.boardActive = true;
        entry.container.dataset.boardInteractionActive = 'true';
      };
      const wheel = (event) => {
        const mode = (event.ctrlKey || event.metaKey) ? 'zoom' : 'pan';
        event.meldexEmbedWheelMode = mode;
        const detail = { mode, deltaX: event.deltaX || 0, deltaY: event.deltaY || 0 };
        if (typeof entry.component?.onEmbeddedWheel === 'function') {
          event.preventDefault();
          event.stopImmediatePropagation();
          entry.component.onEmbeddedWheel(detail, event);
        }
        if (typeof CustomEvent === 'function') {
          entry.container.dispatchEvent(new CustomEvent('meldex-embed-board-wheel', { detail }));
        }
      };
      entry.container.addEventListener('pointerdown', activate);
      entry.container.addEventListener('wheel', wheel, { passive: false, capture: true });
      entry.listeners.push(['pointerdown', activate], ['wheel', wheel, true]);
    }

    _bindReadOnly(entry) {
      entry.container.dataset.embedReadOnly = 'true';
      const stopWrite = (event) => { event.preventDefault(); event.stopImmediatePropagation(); };
      const keydown = (event) => {
        const navigation = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown', 'Tab', 'Escape']);
        if (!navigation.has(event.key) && !(event.ctrlKey || event.metaKey) && !event.altKey) stopWrite(event);
      };
      const pointerdown = (event) => {
        if (event.target?.closest?.('button,input,select,textarea,[contenteditable="true"],[data-bd-node-id],.bd-node')) stopWrite(event);
      };
      ['beforeinput', 'paste', 'drop'].forEach((type) => {
        entry.container.addEventListener(type, stopWrite, true);
        entry.listeners.push([type, stopWrite, true]);
      });
      entry.container.addEventListener('keydown', keydown, true);
      entry.container.addEventListener('pointerdown', pointerdown, true);
      entry.listeners.push(['keydown', keydown, true], ['pointerdown', pointerdown, true]);
    }

    _onUpdate(entry, event) {
      if (!entry.mounted || !entry.component) return;
      if (event?.reconnect) {
        this.refresh(entry.runtimeBlockId);
        return;
      }
      if (event && event.status && event.status !== 'ready') {
        this._status(entry, event.status, event.reason || '同期状態を確認してください');
      }
      if (typeof entry.component.onEmbeddedViewUpdate === 'function') {
        entry.component.onEmbeddedViewUpdate(event);
      }
    }

    _unmount(entry) {
      if (!entry.mounted && !entry.mounting && !entry.component && !entry.abortController) return;
      entry.generation += 1;
      this._releaseRuntime(entry, { preserveState: true });
      entry.mounting = false;
      entry.mounted = false;
      entry.boardActive = false;
      delete entry.container.dataset.boardInteractionActive;
      this._status(entry, 'sleeping', '画面外のビューを一時停止しています');
    }

    _releaseRuntime(entry, options) {
      if (entry.abortController) entry.abortController.abort();
      entry.abortController = null;
      if (entry.unsubscribe) entry.unsubscribe();
      entry.unsubscribe = null;
      entry.listeners.forEach(([type, listener, capture]) => entry.container.removeEventListener(type, listener, !!capture));
      entry.listeners = [];
      delete entry.container.dataset.embedReadOnly;
      if (entry.component) {
        if (options.preserveState && typeof entry.component.getState === 'function') {
          entry.savedState = entry.component.getState();
        }
        if (typeof entry.component.deactivate === 'function') entry.component.deactivate();
        if (typeof entry.component.destroy === 'function') entry.component.destroy();
      }
      entry.component = null;
      entry.mounted = false;
    }

    _status(entry, status, reason) {
      entry.container.dataset.embedStatus = status;
      if (typeof this.onStatus === 'function') this.onStatus(entry.block, status, reason || '', entry.container);
    }

    setVisibilityForTest(blockId, visible) {
      const entry = this.byBlockId.get(blockId);
      if (!entry) return false;
      entry.visible = !!visible;
      this._reconcile();
      return true;
    }

    refresh(blockId) {
      const selected = blockId ? [this.byBlockId.get(blockId)].filter(Boolean) : this.entries.slice();
      selected.forEach((entry) => {
        const visible = entry.visible;
        this._unmount(entry);
        entry.visible = visible;
      });
      this._reconcile();
      return selected.length;
    }

    destroy() {
      if (this.destroyed) return;
      this.destroyed = true;
      if (this._observer) this._observer.disconnect();
      this.entries.slice().forEach((entry) => {
        this._unmount(entry);
        this._releaseHostListeners(entry);
      });
      this.entries = [];
      this.byBlockId.clear();
    }
  }

  const api = { TopicViewHost, RESOURCE_TOOL_TYPES, loadView: _defaultLoadView,
    subscribe: _defaultSubscribe, statusForError: _statusForError };
  global.MeldexTopicViewHost = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
