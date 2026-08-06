/* gb-board-immersive.js: ボードの端展開、固定表示、空状態ガイドを全画面で共有する。 */
(function (root) {
  'use strict';

  const instances = new Map();
  const STORAGE_PREFIX = 'meldex-board-chrome-mode-v1:';
  const CLOSE_DELAY = 520;
  let nextInstanceId = 0;

  function storageGet(key, fallback) {
    try { return localStorage.getItem(key) || fallback; } catch { return fallback; }
  }

  function storageSet(key, value) {
    try { localStorage.setItem(key, value); } catch { /* 保存不可時は現在の画面だけへ適用する。 */ }
  }

  function boardState() {
    if (root.bd && Array.isArray(root.bd.nodes)) return root.bd;
    try {
      if (typeof bd !== 'undefined' && bd && Array.isArray(bd.nodes)) return bd;
    } catch { /* global lexical binding が無い画面。 */ }
    return null;
  }

  function isActiveRoot(boardRoot) {
    if (boardRoot.id === 'board-canvas-root') return true;
    if (typeof bdGetActiveBoardRoot === 'function') {
      try { return bdGetActiveBoardRoot() === boardRoot; } catch { return false; }
    }
    return boardRoot.offsetParent !== null && document.body?.dataset?.csvSheetMode !== '1';
  }

  function createSensor(edge, reveal, identity) {
    const sensor = document.createElement('div');
    sensor.className = 'bd-edge-sensor';
    sensor.dataset.edge = edge;
    const handle = document.createElement('button');
    handle.type = 'button';
    handle.className = 'bd-edge-handle';
    handle.dataset.e2eId = `board-${identity}-chrome-reveal-${edge}`;
    handle.setAttribute('aria-label', edge === 'top'
      ? '上端ツールバーを開く'
      : edge === 'bottom' ? '下端ツールバーを開く' : '右サイドバーを開く');
    handle.title = handle.getAttribute('aria-label');
    handle.addEventListener('click', event => {
      event.stopPropagation();
      reveal(edge, true);
    });
    handle.addEventListener('focus', () => reveal(edge, true));
    sensor.addEventListener('pointerenter', () => reveal(edge, true));
    sensor.appendChild(handle);
    return sensor;
  }

  function createPin(edge, instance) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'tb-icon-btn bd-toolbar-btn bd-toolbar-icon-btn bd-chrome-pin';
    button.dataset.chromeEdge = edge;
    button.dataset.e2eId = `board-${instance.identity}-chrome-pin-${edge}`;
    button.innerHTML = typeof lucide === 'function' ? lucide('pin', 14) : '📌';
    button.addEventListener('click', event => {
      event.stopPropagation();
      const next = instance.modes[edge] === 'pinned' ? 'auto' : 'pinned';
      setMode(instance, edge, next);
    });
    syncPin(button, instance.modes[edge]);
    return button;
  }

  function syncPin(button, mode) {
    const pinned = mode === 'pinned';
    button.title = pinned ? '自動的に隠す' : '固定表示';
    button.setAttribute('aria-label', button.title);
    button.setAttribute('aria-pressed', pinned ? 'true' : 'false');
  }

  function addPins(instance) {
    ['top', 'bottom'].forEach(edge => {
      const toolbar = instance.root.querySelector(`[data-bd-role="toolbar-${edge}"]`);
      if (toolbar && !toolbar.querySelector(`[data-chrome-edge="${edge}"]`)) {
        toolbar.appendChild(createPin(edge, instance));
      }
    });
    if (instance.rightPanel && !instance.rightPanel.querySelector('[data-chrome-edge="right"]')) {
      const pin = createPin('right', instance);
      pin.style.position = 'absolute';
      pin.style.top = '5px';
      pin.style.right = '6px';
      pin.style.zIndex = '5';
      // 集中表示の absolute/fixed 指定をインライン style で上書きしない。
      // ピンの基準は各モードの共有CSSが定義する。
      instance.rightPanel.style.removeProperty('position');
      instance.rightPanel.appendChild(pin);
    }
  }

  function setMode(instance, edge, mode) {
    instance.modes[edge] = mode === 'pinned' ? 'pinned' : 'auto';
    storageSet(STORAGE_PREFIX + instance.kind + ':' + edge, instance.modes[edge]);
    apply(instance);
  }

  function apply(instance) {
    const rootElement = instance.root;
    rootElement.classList.toggle('bd-chrome-top-pinned', instance.modes.top === 'pinned');
    rootElement.classList.toggle('bd-chrome-bottom-pinned', instance.modes.bottom === 'pinned');
    if (instance.shell) {
      instance.shell.classList.toggle('bd-chrome-right-pinned', instance.modes.right === 'pinned');
      instance.shell.classList.remove('bsa-hide-top-toolbar', 'bsa-hide-bottom-toolbar');
      if (instance.modes.right === 'pinned') instance.shell.classList.remove('bsa-options-collapsed');
    } else if (isActiveRoot(instance.root)) {
      document.body.dataset.boardRightPinned = instance.modes.right === 'pinned' ? '1' : '0';
    }
    rootElement.querySelectorAll('[data-chrome-edge]').forEach(button => {
      syncPin(button, instance.modes[button.dataset.chromeEdge]);
    });
    instance.rightPanel?.querySelectorAll('[data-chrome-edge]').forEach(button => {
      syncPin(button, instance.modes[button.dataset.chromeEdge]);
    });
    if (instance.modes.top === 'pinned') rootElement.classList.add('bd-chrome-top-open');
    if (instance.modes.bottom === 'pinned') rootElement.classList.add('bd-chrome-bottom-open');
    if (instance.modes.right === 'pinned') reveal(instance, 'right', true);
  }

  function panelContainsFocus(instance, edge) {
    const target = edge === 'top'
      ? instance.root.querySelector('[data-bd-role="toolbar-top"]')
      : edge === 'bottom'
        ? instance.root.querySelector('[data-bd-role="toolbar-bottom"]')
        : instance.rightPanel;
    return !!target?.contains(document.activeElement);
  }

  function interactionLocked(instance) {
    return instance.locks.size > 0
      || document.body.classList.contains('bsa-resizing-sidebar')
      || !!document.querySelector('.gb-context-menu, .bd-style-picker-menu, [role="menu"][aria-expanded="true"]');
  }

  function reveal(instance, edge, keep) {
    if (!isActiveRoot(instance.root)) return;
    clearTimeout(instance.timers[edge]);
    if (edge === 'top') instance.root.classList.add('bd-chrome-top-open');
    else if (edge === 'bottom') instance.root.classList.add('bd-chrome-bottom-open');
    else if (instance.shell) {
      instance.shell.classList.add('bd-chrome-right-open');
      instance.shell.classList.remove('bsa-options-collapsed');
    } else {
      document.body.dataset.boardRightOpen = '1';
    }
    if (!keep) scheduleClose(instance, edge);
  }

  function hide(instance, edge, force) {
    if (instance.modes[edge] === 'pinned'
        || (!force && (interactionLocked(instance) || panelContainsFocus(instance, edge)))) {
      scheduleClose(instance, edge);
      return;
    }
    if (edge === 'top') instance.root.classList.remove('bd-chrome-top-open');
    else if (edge === 'bottom') instance.root.classList.remove('bd-chrome-bottom-open');
    else if (instance.shell) {
      instance.shell.classList.remove('bd-chrome-right-open');
      instance.shell.classList.add('bsa-options-collapsed');
    } else {
      document.body.dataset.boardRightOpen = '0';
    }
  }

  function scheduleClose(instance, edge) {
    clearTimeout(instance.timers[edge]);
    instance.timers[edge] = setTimeout(() => hide(instance, edge), CLOSE_DELAY);
  }

  function bindPanelLifetime(instance, edge, element) {
    if (!element) return;
    element.addEventListener('pointerenter', () => reveal(instance, edge, true));
    element.addEventListener('pointerleave', () => scheduleClose(instance, edge));
    element.addEventListener('focusin', () => reveal(instance, edge, true));
    element.addEventListener('focusout', () => scheduleClose(instance, edge));
  }

  function pointerMove(instance, event) {
    if (!isActiveRoot(instance.root) || event.pointerType === 'touch') return;
    const rect = instance.host.getBoundingClientRect();
    if (event.clientY - rect.top <= 10) reveal(instance, 'top', false);
    if (rect.bottom - event.clientY <= 10) reveal(instance, 'bottom', false);
    if (rect.right - event.clientX <= 12) reveal(instance, 'right', false);
  }

  function pointerDown(instance, event) {
    const rect = instance.host.getBoundingClientRect();
    instance.swipe = {
      x: event.clientX,
      y: event.clientY,
      top: event.clientY - rect.top <= 22,
      bottom: rect.bottom - event.clientY <= 22,
      right: rect.right - event.clientX <= 22,
    };
    if (event.target.closest?.('[role="separator"], input, textarea, [contenteditable="true"]')) {
      instance.locks.add(`pointer:${event.pointerId}`);
    }
    if (event.pointerType === 'touch') {
      const insideChrome = event.target.closest?.(
        '[data-bd-role="toolbar-top"], [data-bd-role="toolbar-bottom"], .bd-edge-sensor, #board-right-sidebar, #right-panel'
      );
      if (!insideChrome) ['top', 'bottom', 'right'].forEach(edge => hide(instance, edge, true));
    }
  }

  function pointerUp(instance, event) {
    instance.locks.delete(`pointer:${event.pointerId}`);
    const start = instance.swipe;
    instance.swipe = null;
    if (!start || event.pointerType !== 'touch') return;
    if (start.top && event.clientY - start.y > 28) reveal(instance, 'top', true);
    if (start.bottom && start.y - event.clientY > 28) reveal(instance, 'bottom', true);
    if (start.right && start.x - event.clientX > 28) reveal(instance, 'right', true);
  }

  function hasPersistentContent(instance) {
    const current = boardState();
    if (current && isActiveRoot(instance.root)) {
      if ((current.nodes?.length || 0) > 0 || (current.connections?.length || 0) > 0) return true;
      if (current.backgroundImage || current.background?.image || current._fileStyle?.board?.backgroundImage) return true;
    }
    const nodeContainer = instance.root.querySelector('[data-bd-role="nodes"]');
    if (nodeContainer?.children.length) return true;
    const annotationLayer = document.getElementById('ann-layer');
    if (annotationLayer?.children.length) return true;
    const canvas = instance.root.querySelector('[data-bd-role="canvas"]');
    const background = canvas ? getComputedStyle(canvas).backgroundImage : 'none';
    return /url\(/i.test(background || '');
  }

  function updateGuide(instance) {
    if (!instance.guide) return;
    instance.guide.hidden = hasPersistentContent(instance);
  }

  function activate(instance) {
    const active = isActiveRoot(instance.root);
    instance.host.classList.toggle('bd-board-active', active);
    if (!instance.shell && active) {
      document.body.dataset.boardViewActive = '1';
      document.body.dataset.boardRightPinned = instance.modes.right === 'pinned' ? '1' : '0';
    } else if (!instance.shell && document.body.dataset.boardViewActive === '1') {
      const anyOther = Array.from(instances.values()).some(item => item !== instance && !item.shell && isActiveRoot(item.root));
      if (!anyOther) {
        delete document.body.dataset.boardViewActive;
        delete document.body.dataset.boardRightOpen;
        delete document.body.dataset.boardRightPinned;
      }
    }
    updateGuide(instance);
  }

  function attach(boardRoot) {
    if (!boardRoot || instances.has(boardRoot) || !boardRoot.querySelector('[data-bd-role="canvas"]')) return null;
    const standalone = boardRoot.id === 'board-canvas-root';
    const shell = standalone ? document.getElementById('board-standalone-shell') : null;
    const host = shell || boardRoot;
    const rightPanel = standalone ? document.getElementById('board-right-sidebar') : document.getElementById('right-panel');
    const kind = standalone ? 'standalone' : 'main';
    const identity = boardRoot.id
      || boardRoot.closest('.gb-pane')?.dataset?.paneId
      || `instance-${++nextInstanceId}`;
    const instance = {
      root: boardRoot,
      shell,
      host,
      rightPanel,
      kind,
      identity,
      modes: {
        top: storageGet(STORAGE_PREFIX + kind + ':top', 'auto'),
        bottom: storageGet(STORAGE_PREFIX + kind + ':bottom', 'auto'),
        right: storageGet(STORAGE_PREFIX + kind + ':right', 'auto'),
      },
      timers: {},
      locks: new Set(),
      swipe: null,
      guide: null,
    };
    instances.set(boardRoot, instance);
    boardRoot.classList.add('bd-immersive-root');
    shell?.classList.add('bd-immersive-shell');
    ['top', 'bottom', 'right'].forEach(edge => {
      const sensor = createSensor(edge, (target, keep) => reveal(instance, target, keep), identity);
      host.appendChild(sensor);
    });
    const canvas = boardRoot.querySelector('[data-bd-role="canvas"]');
    const guide = document.createElement('div');
    guide.className = 'bd-empty-guide';
    guide.setAttribute('aria-hidden', 'true');
    guide.innerHTML = '<div>ダブルクリックでカードを追加</div><div>ブラウザやフォルダーから画像をドラッグ＆ドロップ</div>';
    canvas.appendChild(guide);
    instance.guide = guide;
    addPins(instance);
    boardRoot.querySelector('[data-bd-action="detail"]')?.addEventListener('click', () => {
      setTimeout(() => reveal(instance, 'right', true), 0);
    });
    bindPanelLifetime(instance, 'top', boardRoot.querySelector('[data-bd-role="toolbar-top"]'));
    bindPanelLifetime(instance, 'bottom', boardRoot.querySelector('[data-bd-role="toolbar-bottom"]'));
    bindPanelLifetime(instance, 'right', rightPanel);
    host.addEventListener('pointermove', event => pointerMove(instance, event), { passive: true });
    host.addEventListener('pointerdown', event => pointerDown(instance, event), true);
    host.addEventListener('pointerup', event => pointerUp(instance, event), true);
    host.addEventListener('pointercancel', event => {
      instance.locks.delete(`pointer:${event.pointerId}`);
      instance.swipe = null;
    }, true);
    host.addEventListener('dragstart', () => { instance.locks.add('drag'); }, true);
    host.addEventListener('dragend', () => { instance.locks.delete('drag'); }, true);
    host.addEventListener('drop', () => { instance.locks.delete('drag'); }, true);
    host.addEventListener('compositionstart', () => { instance.locks.add('composition'); }, true);
    host.addEventListener('compositionend', () => { instance.locks.delete('composition'); }, true);
    new MutationObserver(() => updateGuide(instance)).observe(
      boardRoot.querySelector('[data-bd-role="nodes"]') || canvas,
      { childList: true, subtree: true }
    );
    apply(instance);
    activate(instance);
    return instance;
  }

  function scan() {
    document.querySelectorAll('.gb-canvas-root, #board-canvas-root').forEach(attach);
    instances.forEach(activate);
  }

  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    instances.forEach(instance => {
      if (!isActiveRoot(instance.root)) return;
      ['top', 'bottom', 'right'].forEach(edge => hide(instance, edge));
    });
  });
  new MutationObserver(scan).observe(document.documentElement, { childList: true, subtree: true });
  setInterval(scan, 350);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', scan, { once: true });
  else scan();

  root.MeldexBoardImmersive = Object.freeze({
    attach,
    scan,
    updateEmptyGuide() { instances.forEach(updateGuide); },
    reveal(edge) {
      instances.forEach(instance => {
        if (isActiveRoot(instance.root)) reveal(instance, edge, true);
      });
    },
    hide(edge, force) {
      instances.forEach(instance => {
        if (isActiveRoot(instance.root)) hide(instance, edge, !!force);
      });
    },
    getMode(edge) {
      const instance = Array.from(instances.values()).find(item => isActiveRoot(item.root));
      return instance?.modes?.[edge] || 'auto';
    },
    setMode(edge, mode) {
      instances.forEach(instance => {
        if (isActiveRoot(instance.root)) setMode(instance, edge, mode);
      });
    },
  });
})(typeof window !== 'undefined' ? window : globalThis);
