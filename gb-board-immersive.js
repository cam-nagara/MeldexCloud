/* gb-board-immersive.js: ボードの端展開、固定表示、空状態ガイドを全画面で共有する。 */
(function (root) {
  'use strict';

  const instances = new Map();
  const STORAGE_PREFIX = 'meldex-board-chrome-mode-v1:';
  const LEGACY_STANDALONE_TOOLBAR_KEYS = {
    top: 'meldex-board-toolbar-top-hidden',
    bottom: 'meldex-board-toolbar-bottom-hidden',
  };
  const CLOSE_DELAY = 520;
  const EDGE_SENSOR_FALLBACK_PX = 28;
  // pointerdown時点のスワイプ開始判定用の端ゾーン（論理px）。edgeSensorSizeより
  // やや狭く、タッチスワイプの起点をエッジ付近に限定する目的の固定値。
  const SWIPE_EDGE_FALLBACK_PX = 22;
  // 上下のツールバーは初期状態で出したままにする。隠したい人は
  // キャンバスの右クリックメニュー (「上端/下端ツールバーを常時表示」) で切り替える。
  // 右サイドバーは従来通り、必要なときだけ端から開く。
  const DEFAULT_MODES = { top: 'pinned', bottom: 'pinned', right: 'auto' };
  let nextInstanceId = 0;

  function storageGet(key, fallback) {
    try { return localStorage.getItem(key) || fallback; } catch { return fallback; }
  }

  function storedMode(kind, edge) {
    const current = storageGet(STORAGE_PREFIX + kind + ':' + edge, '');
    if (current === 'auto' || current === 'pinned') return current;
    if (kind === 'standalone' && LEGACY_STANDALONE_TOOLBAR_KEYS[edge]) {
      const legacy = storageGet(LEGACY_STANDALONE_TOOLBAR_KEYS[edge], '');
      if (legacy === '0') return 'pinned';
      if (legacy === '1') return 'auto';
    }
    return DEFAULT_MODES[edge] || 'auto';
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
    sensor.addEventListener('pointerenter', () => reveal(edge, true, 'sensor'));
    sensor.addEventListener('pointerleave', () => reveal(edge, false, 'sensor'));
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
    if (instance.shell && instance.rightPanel && !instance.rightPanel.querySelector('[data-chrome-edge="right"]')) {
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
    if (instance.kind === 'standalone' && LEGACY_STANDALONE_TOOLBAR_KEYS[edge]) {
      storageSet(LEGACY_STANDALONE_TOOLBAR_KEYS[edge], instance.modes[edge] === 'pinned' ? '0' : '1');
    }
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
      || !!document.querySelector('.gb-context-menu, .bd-style-picker-menu, .bd-style-manager-popup, [role="menu"][aria-expanded="true"]');
  }

  function edgeSensorSize(instance) {
    const raw = getComputedStyle(instance.root).getPropertyValue('--bd-edge-sensor-size');
    const value = Number.parseFloat(raw);
    return Number.isFinite(value) && value > 0 ? value : EDGE_SENSOR_FALLBACK_PX;
  }

  // getBoundingClientRect() / event.clientX・clientY は表示倍率（CSS zoom）適用後の
  // 実座標を返すが、--bd-edge-sensor-size 等のCSS寸法値は倍率適用前の論理px値のまま。
  // 距離をpxで直接比較すると、倍率100%以外では判定ゾーンの実寸が意図とズレる
  // （例: 150%表示だと28pxの指定が実質18.7px相当でしか反応しない）。
  // 比較は必ず実座標側へ揃えるため、CSS寸法値には倍率を掛けてから比較する。
  function currentUiZoom() {
    return typeof _getZoom === 'function' ? _getZoom() : 1;
  }

  function pointerRevealSuppressed(instance, event) {
    if (instance.locks.size > 0 || document.querySelector('dialog[open], [role="dialog"][aria-modal="true"], .gb-modal.open, .modal.open, .modal.show')) return true;
    return !!event.target.closest?.('input, textarea, [contenteditable="true"], .bd-node.dragging, .dragging');
  }

  function edgeHeld(instance, edge) {
    const presence = instance.presence[edge];
    return !!(presence?.sensor || presence?.panel || presence?.pointer);
  }

  function setEdgePresence(instance, edge, source, active) {
    if (source && instance.presence[edge]) instance.presence[edge][source] = !!active;
  }

  function reveal(instance, edge, keep, source) {
    if (!isActiveRoot(instance.root)) return;
    setEdgePresence(instance, edge, source, keep);
    clearTimeout(instance.timers[edge]);
    if (edge === 'top') instance.root.classList.add('bd-chrome-top-open');
    else if (edge === 'bottom') instance.root.classList.add('bd-chrome-bottom-open');
    else if (instance.shell) {
      instance.shell.classList.add('bd-chrome-right-open');
      instance.shell.classList.remove('bsa-options-collapsed');
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
    }
  }

  function scheduleClose(instance, edge) {
    clearTimeout(instance.timers[edge]);
    if (edgeHeld(instance, edge)) return;
    instance.timers[edge] = setTimeout(() => hide(instance, edge), CLOSE_DELAY);
  }

  function bindPanelLifetime(instance, edge, element) {
    if (!element) return;
    element.addEventListener('pointerenter', () => reveal(instance, edge, true, 'panel'));
    element.addEventListener('pointerleave', () => {
      setEdgePresence(instance, edge, 'panel', false);
      scheduleClose(instance, edge);
    });
    element.addEventListener('focusin', () => reveal(instance, edge, true));
    element.addEventListener('focusout', () => scheduleClose(instance, edge));
  }

  function pointerMove(instance, event) {
    if (!isActiveRoot(instance.root) || event.pointerType === 'touch') return;
    if (pointerRevealSuppressed(instance, event)) {
      ['top', 'bottom', 'right'].forEach(edge => {
        const wasNear = !!instance.presence[edge].pointer;
        setEdgePresence(instance, edge, 'pointer', false);
        if (wasNear) scheduleClose(instance, edge);
      });
      return;
    }
    const rect = instance.host.getBoundingClientRect();
    const sensorSize = edgeSensorSize(instance) * currentUiZoom();
    const near = {
      top: event.clientY - rect.top <= sensorSize,
      bottom: rect.bottom - event.clientY <= sensorSize,
      right: !!instance.shell && rect.right - event.clientX <= sensorSize,
    };
    ['top', 'bottom', 'right'].forEach(edge => {
      const wasNear = !!instance.presence[edge].pointer;
      setEdgePresence(instance, edge, 'pointer', near[edge]);
      if (near[edge]) reveal(instance, edge, true);
      else if (wasNear) scheduleClose(instance, edge);
    });
  }

  function pointerDown(instance, event) {
    const rect = instance.host.getBoundingClientRect();
    const swipeEdgeSize = SWIPE_EDGE_FALLBACK_PX * currentUiZoom();
    instance.swipe = {
      x: event.clientX,
      y: event.clientY,
      top: event.clientY - rect.top <= swipeEdgeSize,
      bottom: rect.bottom - event.clientY <= swipeEdgeSize,
      right: !!instance.shell && rect.right - event.clientX <= swipeEdgeSize,
    };
    if (event.target.closest?.('[role="separator"], input, textarea, [contenteditable="true"]')) {
      instance.locks.add(`pointer:${event.pointerId}`);
    }
    if (event.pointerType === 'touch') {
      const insideChrome = event.target.closest?.(
        '[data-bd-role="toolbar-top"], [data-bd-role="toolbar-bottom"], .bd-edge-sensor, #board-right-sidebar, #right-panel'
      );
      if (!insideChrome) ['top', 'bottom'].concat(instance.shell ? ['right'] : []).forEach(edge => hide(instance, edge, true));
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

  // 新規作成直後のボードは、ファイル名の見出しから作られたルートカードを 1 枚だけ持つ。
  // 利用者から見ればこれは「まだ何も作っていない」状態なので、空状態の案内を出す対象に含める。
  // 本文の追記・画像・リンク・ライン・グループのいずれかが付いた時点で「中身あり」に切り替わる。
  function looksUntouched(state) {
    const nodes = Array.isArray(state?.nodes) ? state.nodes : [];
    if (!nodes.length) return true;
    if (nodes.length > 1) return false;
    if ((state.connections?.length || 0) > 0 || (state.groups?.length || 0) > 0) return false;
    const only = nodes[0] || {};
    if (only.img || only.link || only.note || only.parent) return false;
    return !String(only.text || '').includes('\n');
  }

  function hasPersistentContent(instance) {
    const current = boardState();
    const stateReadable = !!current && isActiveRoot(instance.root);
    if (stateReadable) {
      if (!looksUntouched(current)) return true;
      if (current.backgroundImage || current.background?.image || current._fileStyle?.board?.backgroundImage) return true;
    } else {
      const nodeContainer = instance.root.querySelector('[data-bd-role="nodes"]');
      if (nodeContainer?.children.length) return true;
    }
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
    updateGuide(instance);
  }

  function attach(boardRoot) {
    if (!boardRoot || instances.has(boardRoot) || !boardRoot.querySelector('[data-bd-role="canvas"]')) return null;
    const standalone = boardRoot.id === 'board-canvas-root';
    const shell = standalone ? document.getElementById('board-standalone-shell') : null;
    const host = shell || boardRoot;
    const rightPanel = standalone ? document.getElementById('board-right-sidebar') : null;
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
        top: storedMode(kind, 'top'),
        bottom: storedMode(kind, 'bottom'),
        right: storedMode(kind, 'right'),
      },
      timers: {},
      presence: {
        top: { sensor: false, panel: false, pointer: false },
        bottom: { sensor: false, panel: false, pointer: false },
        right: { sensor: false, panel: false, pointer: false },
      },
      locks: new Set(),
      swipe: null,
      guide: null,
    };
    instances.set(boardRoot, instance);
    boardRoot.classList.add('bd-immersive-root');
    shell?.classList.add('bd-immersive-shell');
    ['top', 'bottom'].concat(shell ? ['right'] : []).forEach(edge => {
      const sensor = createSensor(edge, (target, keep, source) => reveal(instance, target, keep, source), identity);
      host.appendChild(sensor);
    });
    const canvas = boardRoot.querySelector('[data-bd-role="canvas"]');
    const guide = document.createElement('div');
    guide.className = 'bd-empty-guide';
    guide.setAttribute('aria-hidden', 'true');
    guide.dataset.e2eId = `board-${identity}-empty-guide`;
    guide.innerHTML = '<div class="bd-empty-guide-title">ダブルクリックでカードを追加</div>'
      + '<div class="bd-empty-guide-hint">ブラウザやフォルダーから画像をドラッグ＆ドロップ</div>'
      + '<div class="bd-empty-guide-hint">カードを選んで Tab で子カードを追加</div>';
    canvas.appendChild(guide);
    instance.guide = guide;
    addPins(instance);
    if (shell) {
      boardRoot.querySelector('[data-bd-action="detail"]')?.addEventListener('click', () => {
        setTimeout(() => reveal(instance, 'right', true), 0);
      });
    }
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
