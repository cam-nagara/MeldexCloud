    id: bdId(),
    from: fromId || '',
    to: toId || '',
    label: nextOpts.label || '',
    styleRef: styleId || '',
  };
  if (!conn.from && nextOpts.fromPoint) conn.fromPoint = bdNormalizeConnectionPoint(nextOpts.fromPoint);
  if (!conn.to && nextOpts.toPoint) conn.toPoint = bdNormalizeConnectionPoint(nextOpts.toPoint);
  if (nextOpts.arrow !== undefined) conn.arrow = nextOpts.arrow;
  if (nextOpts.style !== undefined) conn.style = nextOpts.style;
  if (nextOpts.color !== undefined) conn.color = nextOpts.color;
  if (nextOpts.hidden) conn.hidden = true;
  if (nextOpts.pathType !== undefined) conn.pathType = nextOpts.pathType === 'free-bezier' ? 'curve'
    : nextOpts.pathType === 'orthogonal-curve' ? 'orthogonal'
    : nextOpts.pathType === 'orthogonal' ? 'orthogonal'
    : nextOpts.pathType === 'straight' ? 'straight' : 'curve';
  else if (nextOpts.straight !== undefined) conn.pathType = nextOpts.straight ? 'straight' : 'curve';
  if (nextOpts.width !== undefined) conn.width = nextOpts.width;
  return conn;
}

function bdCreateConnection(fromId, toId, opts) {
  // v0.5.333: 自己ループ (fromId === toId) も許可。
  // 自己ループは形状別既定経路 (曲線: 左上象限ループ / 直角線: L 字 2 段迂回) で描画される。
  const draft = { from: fromId || '', to: toId || '', fromPoint: opts?.fromPoint, toPoint: opts?.toPoint };
  if (!bdConnectionHasEndpoint(draft, 'from') || !bdConnectionHasEndpoint(draft, 'to')) return null;
  // v0.5.250: 同じカードペア間の複数ラインを許可 (相関図用)。
  // 以前は (from,to) or (to,from) が存在すると null を返していた制約を撤去。
  const conn = bdCreateConnectionWithStyle(fromId, toId, opts);
  bd.connections.push(conn);
  if (typeof bdMarkConnectionDirty === 'function') bdMarkConnectionDirty(conn.id, 'create-connection');
  else if (typeof bdDrawConns === 'function') bdDrawConns({ connIds: [conn.id], reason: 'create-connection' });
  if (typeof bdDirty === 'function') bdDirty();
  return conn;
}

function bdMarkerIconHtml(marker, size) {
  const nextSize = size || 12;
  const color = marker?.color || 'currentColor';
  const box = `width="${nextSize}" height="${nextSize}" viewBox="0 0 24 24"`;
  // カスタム描画の図形は r=7 程度で viewBox の半分強しか占めないため、
  // ステータスドット (14x14 べた塗り) と視覚サイズを揃えるべく scale 1.6 を
  // 中心 (12,12) まわりに掛けて shape を viewBox ほぼ一杯まで引き延ばす
  // (matrix: e = f = 12*(1-1.6) = -7.2)。
  const wrap = (inner) => `<svg ${box} fill="none" xmlns="http://www.w3.org/2000/svg"><g transform="matrix(1.6 0 0 1.6 -7.2 -7.2)">${inner}</g></svg>`;
  switch (marker?.icon) {
    case 'circle':
      return wrap(`<circle cx="12" cy="12" r="7" fill="${_bdEscAttr(color)}" stroke="${_bdEscAttr(color)}" stroke-width="2"/>`);
    case 'square':
      return wrap(`<rect x="5" y="5" width="14" height="14" rx="2" fill="${_bdEscAttr(color)}" stroke="${_bdEscAttr(color)}" stroke-width="2"/>`);
    case 'checkSquare':
      return wrap(`<rect x="4.5" y="4.5" width="15" height="15" rx="2" fill="${_bdEscAttr(color)}" stroke="${_bdEscAttr(color)}" stroke-width="2"/><path d="M8 12.5L11 15.5L16.5 9.5" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>`);
    case 'flag':
      return wrap(`<path d="M6 4V20" stroke="${_bdEscAttr(color)}" stroke-width="2" stroke-linecap="round"/><path d="M7 5H17L14 10L17 15H7Z" fill="${_bdEscAttr(color)}" stroke="${_bdEscAttr(color)}" stroke-width="2" stroke-linejoin="round"/>`);
    case 'star':
      return wrap(`<path d="M12 4L14.5 9.2L20 10L16 14L17.2 19.5L12 16.5L6.8 19.5L8 14L4 10L9.5 9.2Z" fill="${_bdEscAttr(color)}" stroke="${_bdEscAttr(color)}" stroke-width="2" stroke-linejoin="round"/>`);
    case 'lightbulb':
      return wrap(`<path d="M9 17H15" stroke="${_bdEscAttr(color)}" stroke-width="2" stroke-linecap="round"/><path d="M10 20H14" stroke="${_bdEscAttr(color)}" stroke-width="2" stroke-linecap="round"/><path d="M8 10A4 4 0 1 1 16 10C16 11.8 14.8 13 13.8 14.2C13.2 14.9 13 15.4 13 16H11C11 15.4 10.8 14.9 10.2 14.2C9.2 13 8 11.8 8 10Z" fill="${_bdEscAttr(color)}" stroke="${_bdEscAttr(color)}" stroke-width="2" stroke-linejoin="round"/>`);
    case 'alertTriangle':
      return wrap(`<path d="M12 4L20 19H4Z" fill="${_bdEscAttr(color)}" stroke="${_bdEscAttr(color)}" stroke-width="2" stroke-linejoin="round"/><path d="M12 9V13" stroke="#fff" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="16.5" r="1.2" fill="#fff"/>`);
    case 'helpCircle':
      // helpCircle は r=9 で既にエッジ付近のため、scale 1.6 だとクリップが大きくなる。
      // scale 無しで描画し (他マーカーと同等の視覚サイズになる)。
      return `<svg ${box} fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="11" fill="${_bdEscAttr(color)}" stroke="${_bdEscAttr(color)}" stroke-width="2"/><path d="M9.5 9.5A2.7 2.7 0 0 1 12 8C13.6 8 14.8 9 14.8 10.5C14.8 11.5 14.3 12.1 13.4 12.7C12.6 13.2 12.2 13.7 12.2 14.5" stroke="#fff" stroke-width="2" stroke-linecap="round"/><circle cx="12.2" cy="17.3" r="1" fill="#fff"/></svg>`;
    default:
      return typeof lucide === 'function'
        ? lucide(marker?.icon || 'circle', nextSize).replace(/fill="none"/g, `fill="${_bdEscAttr(color)}"`)
        : (typeof lucide === 'function' ? lucide('circleDot', nextSize) : '●');
  }
}

let _bdStylePickerMenu = null;
let _bdStylePickerCloseHandler = null;
let _bdStylePickerAnchor = null;

function bdCloseStylePicker(options) {
  const focusTarget = options?.focusTarget || null;
  const anchor = _bdStylePickerAnchor;
  if (anchor?.setAttribute) anchor.setAttribute('aria-expanded', 'false');
  _bdStylePickerMenu?.remove();
  _bdStylePickerMenu = null;
  _bdStylePickerAnchor = null;
  if (_bdStylePickerCloseHandler) {
    document.removeEventListener('pointerdown', _bdStylePickerCloseHandler);
    _bdStylePickerCloseHandler = null;
  }
  if (focusTarget && typeof focusMeldexDropdownTrigger === 'function') focusMeldexDropdownTrigger(focusTarget);
}

function _bdStylePickerPreview(kind, style) {
  return _bdStylePickerLargePreviewHtml(kind, style);
}

function _bdToolbarRoot() {
  return (typeof bdGetActiveBoardRoot === 'function' ? bdGetActiveBoardRoot() : null)
    || document.querySelector('.gb-canvas-root')
    || document;
}

function _bdToolbarControl(root, controlName, fallbackId) {
  const scope = root || _bdToolbarRoot();
  return scope?.querySelector?.(`[data-bd-control="${controlName}"]`)
    || scope?.querySelector?.(`[id^="${fallbackId}"]`)
    || document.getElementById(fallbackId)
    || document.querySelector(`[data-bd-control="${controlName}"]`);
}

function bdOpenStylePicker(kind, anchorEl, options) {
  if (!anchorEl) return;
  if (_bdStylePickerMenu) {
    if (_bdStylePickerAnchor === anchorEl) {
      bdCloseStylePicker();
      return;
    }
    bdCloseStylePicker();
  }
  bdEnsureBoardUiState();
  const opts = options || {};
  const styles = kind === 'card' ? bd.cardStyles : bd.lineStyles;
  const activeId = opts.currentId !== undefined ? opts.currentId : (kind === 'card' ? bd.activeCardStyle : bd.activeLineStyle);
  const menu = document.createElement('div');
  menu.className = 'ab-dropdown tool-menu-dropdown bd-style-picker-menu';
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', kind === 'card' ? 'カードスタイル' : 'ラインスタイル');
  menu.innerHTML = styles.map(style => `
    <button type="button" class="bd-style-picker-item${style.id === activeId ? ' active' : ''}" role="menuitemradio" aria-checked="${style.id === activeId ? 'true' : 'false'}" aria-label="${_bdEscAttr(style.name)}" data-bd-style-pick="${_bdEscAttr(style.id)}">
      <span class="bd-style-picker-preview">${_bdStylePickerPreview(kind, style)}</span>
      <span class="bd-style-picker-label">${esc(style.name)}</span>
    </button>`).join('');
  document.body.appendChild(menu);
  _bdStylePickerMenu = menu;
  _bdStylePickerAnchor = anchorEl;
  anchorEl.setAttribute('aria-haspopup', 'menu');
  anchorEl.setAttribute('aria-expanded', 'true');
  const rect = anchorEl.getBoundingClientRect();
  if (typeof positionPopup === 'function') {
    positionPopup(menu, rect, { prefer: 'below', gap: 4 });
  } else {
    { const z = _getZoom(); menu.style.left = (rect.left / z) + 'px'; menu.style.top = (rect.bottom / z + 4) + 'px'; }
    if (typeof clampPopupToViewport === 'function') clampPopupToViewport(menu);
  }
  const getFreshTrigger = () => (typeof opts.refreshAnchor === 'function' ? opts.refreshAnchor() : null) || (anchorEl.isConnected ? anchorEl : null);
  const applyPick = (styleId, closeMenu) => {
    opts.currentId = styleId;
    if (typeof opts.onPick === 'function') opts.onPick(styleId);
    else if (kind === 'card') bd.activeCardStyle = styleId;
    else bd.activeLineStyle = styleId;
    bdRefreshBoardToolbar();
    if (closeMenu) bdCloseStylePicker({ focusTarget: getFreshTrigger });
    if (typeof opts.onAfterPick === 'function') opts.onAfterPick(styleId);
    if (typeof bindMeldexDropdownKeySwitch === 'function') bindStyleKeySwitch(getFreshTrigger());
    if (typeof focusMeldexDropdownTrigger === 'function') focusMeldexDropdownTrigger(getFreshTrigger());
    showStatus(`${kind === 'card' ? 'カード' : 'ライン'}スタイルを選択: ${styles.find(style => style.id === styleId)?.name || ''}`);
  };
  const bindStyleKeySwitch = trigger => {
    if (typeof bindMeldexDropdownKeySwitch !== 'function' || !trigger) return;
    bindMeldexDropdownKeySwitch(trigger, {
      getItems: () => (kind === 'card' ? bd.cardStyles : bd.lineStyles).map(style => ({ value: style.id, style })),
      getCurrentValue: () => opts.currentId || (kind === 'card' ? bd.activeCardStyle : bd.activeLineStyle),
      onSelect: item => applyPick(item.value, false),
      getFreshTrigger,
    });
  };
  bindStyleKeySwitch(anchorEl);
  menu.querySelectorAll('[data-bd-style-pick]').forEach(btn => {
    btn.addEventListener('click', () => applyPick(btn.dataset.bdStylePick || '', true));
  });
  menu.addEventListener('keydown', event => {
    const items = [...menu.querySelectorAll('[data-bd-style-pick]')];
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      bdCloseStylePicker({ focusTarget: getFreshTrigger });
      return;
    }
    if (!items.length) return;
    const currentIndex = items.indexOf(document.activeElement);
    let nextIndex = currentIndex;
    if (event.key === 'ArrowDown') nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % items.length;
    else if (event.key === 'ArrowUp') nextIndex = currentIndex < 0 ? items.length - 1 : (currentIndex - 1 + items.length) % items.length;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = items.length - 1;
    else return;
    event.preventDefault();
    items[nextIndex]?.focus();
  });
  requestAnimationFrame(() => {
    if (!_bdStylePickerMenu) return;
    const current = menu.querySelector('[aria-checked="true"]') || menu.querySelector('[data-bd-style-pick]');
    current?.focus?.();
  });
  setTimeout(() => {
    _bdStylePickerCloseHandler = event => {
      if (_bdStylePickerMenu && !_bdStylePickerMenu.contains(event.target) && !anchorEl.contains(event.target)) {
        bdCloseStylePicker();
      }
    };
    document.addEventListener('pointerdown', _bdStylePickerCloseHandler);
  }, 0);
}

function bdRefreshBoardToolbar(root) {
  bdEnsureBoardUiState();
  const toolbarRoot = root || _bdToolbarRoot();
  const cardStyle = bdGetCardStyleById(bd.activeCardStyle);
  const lineStyle = bdGetLineStyleById(bd.activeLineStyle);

  const cardPreview = _bdToolbarControl(toolbarRoot, 'card-style-preview', 'bd-card-style-preview');
  if (cardPreview) cardPreview.innerHTML = _bdCardStylePreviewHtml(cardStyle);
  const cardStyleBtn = _bdToolbarControl(toolbarRoot, 'card-style-select', 'bd-card-style-select');
  if (cardStyleBtn) cardStyleBtn.title = `カードスタイル: ${cardStyle?.name || ''}`.trim();
  const linePreview = _bdToolbarControl(toolbarRoot, 'line-style-preview', 'bd-line-style-preview');
  if (linePreview) linePreview.innerHTML = _bdLineStylePreviewHtml(lineStyle);
  const lineStyleBtn = _bdToolbarControl(toolbarRoot, 'line-style-select', 'bd-line-style-select');
  if (lineStyleBtn) lineStyleBtn.title = `ラインスタイル: ${lineStyle?.name || ''}`.trim();

  toolbarRoot.querySelectorAll?.('.bd-tool-btn[data-bd-tool]')?.forEach(btn => {
    btn.classList.toggle('active', bd.tool === btn.dataset.bdTool);
  });

  const onlyOnWhenTrueKeys = ['highlightParentChildGroups'];
  const hiddenCount = Object.entries(bd.displayFilters)
    .filter(([key, value]) => !onlyOnWhenTrueKeys.includes(key) && value === false)
    .length
    + onlyOnWhenTrueKeys.reduce((acc, key) => acc + (bd.displayFilters[key] === true ? 1 : 0), 0);
  const badge = _bdToolbarControl(toolbarRoot, 'filter-badge', 'bd-filter-badge');
  if (badge) {
    badge.style.display = hiddenCount ? '' : 'none';
    badge.textContent = hiddenCount ? String(hiddenCount) : '';
  }

  const canvas = (typeof bdGetBoardElement === 'function')
    ? bdGetBoardElement('canvas', toolbarRoot)
    : document.getElementById('bd-canvas');
  if (canvas) {
    canvas.dataset.bdTool = bd.tool || 'select';
    canvas.classList.toggle('bd-tool-add-card', bd.tool === 'add-card');
    canvas.classList.toggle('bd-tool-add-line', bd.tool === 'add-line');
    canvas.classList.toggle('bd-tool-erase', bd.tool === 'erase');
  }
}

function bdOpenToolbarStylePicker(kind, btn) {
  if (!btn) return;
  const isLine = kind === 'line';
  bdOpenStylePicker(isLine ? 'line' : 'card', btn, {
    currentId: isLine ? bd.activeLineStyle : bd.activeCardStyle,
    onPick(styleId) {
      if (!isLine) {
        if (typeof bdAreAllCardsSelected === 'function' && bdAreAllCardsSelected()) {
          bdPushUndo();
          _bdAssignCardStyleToNodes([...bd.selected], styleId);
        } else {
          bd.activeCardStyle = styleId || '';
        }
        return;
      }
      if (typeof bdAreAllLinesSelected === 'function' && bdAreAllLinesSelected()) {
        bdPushUndo();
        _bdAssignLineStyleToConnections(typeof bdGetSelectedConnectionIds === 'function' ? bdGetSelectedConnectionIds() : [], styleId);
      } else {
        bd.activeLineStyle = styleId || '';
      }
    },
    onAfterPick() {
      if (isLine) bdDrawConns();
      else bdRender();
      bdDirty();
      if (typeof bdRefreshSelectionDetails === 'function') bdRefreshSelectionDetails(true);
    },
  });
}

function _bdBindToolbarStylePickerTriggers(root) {
  root.querySelectorAll('[data-bd-action="pick-card-style"], [data-bd-action="pick-line-style"]').forEach(trigger => {
    if (trigger.dataset.bdStylePickerDirect === '1') return;
    trigger.dataset.bdStylePickerDirect = '1';
    trigger.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation?.();
      bdOpenToolbarStylePicker(trigger.dataset.bdAction === 'pick-line-style' ? 'line' : 'card', trigger);
    }, true);
  });
}

function bdSetTool(tool) {
  bdEnsureBoardUiState();
  bd.tool = bd.tool === tool ? 'select' : tool;
  if (bd.tool !== 'add-line') {
    bd.connecting = null;
    bd._connLabel = '';
    bd._connOrigin = null;
  }
  bdRefreshBoardToolbar();
  if (bd.tool === 'select') showStatus('選択ツール');
  else if (bd.tool === 'add-card') showStatus('カード追加ツール');
  else if (bd.tool === 'add-line') showStatus('ライン追加ツール');
  else if (bd.tool === 'erase') showStatus('消しゴムツール');
}

function _bdUpdateBoardTabMeta(oldPath, newPath, newLabel) {
  if (typeof GBLayout === 'undefined' || typeof GBLayout.getAllPanes !== 'function') return;
  let changed = false;
  GBLayout.getAllPanes(GBLayout.root).forEach(pane => {
    (pane.tabs || []).forEach(tab => {
      if (tab.type !== 'board' || tab.path !== oldPath) return;
      tab.path = newPath;
      tab.label = newLabel;
      tab.state = Object.assign({}, tab.state || {}, { boardPath: newPath, label: newLabel });
      changed = true;
    });
  });
  if (changed) {
    GBLayout.render();
    GBLayout.saveLayout();
  }
}

async function _bdRenameBoardFile(newName) {
  const oldPath = bd.path || (typeof state !== 'undefined' ? state.currentBoardPath : '') || '';
  const nextName = String(newName || '').trim();
  if (!oldPath || !nextName) return false;
  const currentName = (oldPath.split('/').pop() || '').replace(/\.[^.]+$/i, '');
  if (nextName === currentName) return true;
  const res = await apiPost('/outliner/rename', { old_path: oldPath, new_name: nextName, type: 'board' });
  const newPath = String(res?.new_path || '').trim();
  if (!newPath) throw new Error('リネーム結果が不正です');
  if (typeof _renameTreeNode === 'function') _renameTreeNode(oldPath, newPath, nextName, res?.file_id);
  bd.path = newPath;
  if (typeof state !== 'undefined') state.currentBoardPath = newPath;
  const titleEl = _bdToolbarControl(_bdToolbarRoot(), 'title', 'bd-title');
  if (titleEl) titleEl.textContent = nextName;
  window.MeldexFileLockBadge?.apply?.(titleEl, newPath);
  if (typeof saveLastView === 'function') saveLastView({ type: 'board', label: nextName, path: newPath });
  _bdUpdateBoardTabMeta(oldPath, newPath, nextName);
  if (typeof handleRelocateResponse === 'function') handleRelocateResponse(res);
  return true;
}

function _bdStartInlineBoardTitleEdit(titleEl) {
  if (!titleEl || titleEl.dataset.bdEditing === '1') return;
  const currentText = titleEl.textContent.trim() || (bd.path ? bd.path.split('/').pop().replace(/\.[^.]+$/i, '') : '無題');
  titleEl.dataset.bdEditing = '1';
  const input = document.createElement('input');
  input.type = 'text';
  input.value = currentText;
  input.className = 'tb-file-title--input';
  input.style.cssText = 'width:100%;box-sizing:border-box;padding:0 var(--ui-space-3);border:1px solid var(--ui-accent);border-radius:var(--ui-radius-xs);background:var(--ui-bg-app);color:inherit;font:inherit;height:var(--ui-h-xs);outline:none;';
  titleEl.textContent = '';
  titleEl.appendChild(input);
  input.focus();
  input.select();
  let finished = false;
  const finish = async (commit) => {
    if (finished) return;
    finished = true;
    titleEl.dataset.bdEditing = '0';
    const draft = input.value.trim();
    titleEl.textContent = currentText;
    if (!commit) return;
    if (!draft) {
      showStatus('ボード名が空です', true);
      return;
    }
    try {
      await _bdRenameBoardFile(draft);
      titleEl.textContent = draft;
      showStatus('ボード名を変更しました');
    } catch (e) {
      titleEl.textContent = currentText;
      showStatus('ボード名の変更に失敗: ' + (e?.message || ''), true);
    }
  };
  input.addEventListener('keydown', event => {
    event.stopPropagation();
    if (event.key === 'Enter') {
      event.preventDefault();
      finish(true);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      finish(false);
    }
  });
  input.addEventListener('blur', () => { finish(true); });
}

function bdInitBoardShell(root) {
  if (!root || root.dataset.bdShellReady === '1') return;
  root.dataset.bdShellReady = '1';
  _bdBindToolbarStylePickerTriggers(root);
  root.addEventListener('click', event => {
    const btn = event.target.closest('[data-bd-action],[data-bd-tool]');
    if (!btn || !root.contains(btn)) return;
    if (!['pick-card-style', 'pick-line-style'].includes(btn.dataset.bdAction || '')) bdCloseStylePicker();
    if (btn.dataset.bdTool) {
      bdSetTool(btn.dataset.bdTool);
      return;
    }
    switch (btn.dataset.bdAction) {
      case 'undo':
        if (typeof bdUndo === 'function') bdUndo();
        break;
      case 'redo':
        if (typeof bdRedo === 'function') bdRedo();
        break;
      case 'zoom-in':
        bdZoom(0.1);
        break;
      case 'zoom-out':
        bdZoom(-0.1);
        break;
      case 'zoom-100':
        bd.zoom = 1;
        bdTransform();
        break;
      case 'fit':
        bdFitAll();
        break;
      case 'zoom-select':
        if (typeof bdShowZoomMenu === 'function') bdShowZoomMenu(btn);
        break;
      case 'reset-rotation':
        bdResetRotation();
        break;
      case 'bg-color':
        if (typeof bdPickBoardBackgroundColor === 'function') {
          bdPickBoardBackgroundColor(btn);
        } else if (typeof openColorPalette === 'function') {
          openColorPalette(btn, bd._bgColor || '', color => {
            bd._bgColor = color || '';
            const canvas = document.getElementById('bd-canvas');
            if (canvas) canvas.style.background = color || 'var(--bg)';
            const swatch = document.getElementById('bd-bg-swatch');
            if (swatch) setColorSwatchValue(swatch, color || '');
            if (typeof bdDirty === 'function') bdDirty();
            if (typeof bdMarkExtrasDirty === 'function') {
              bdMarkExtrasDirty({ minimap: true, boardUi: true }, 'bg-color');
              if (typeof bdScheduleBoardUpdates === 'function') bdScheduleBoardUpdates();
            }
          });
        }
        break;
      case 'manage-card-styles':
        bdOpenCardStyleManager();
        break;
      case 'pick-card-style':
        bdOpenToolbarStylePicker('card', btn);
        break;
      case 'manage-line-styles':
        bdOpenLineStyleManager();
        break;
      case 'pick-line-style':
        bdOpenToolbarStylePicker('line', btn);
        break;
      case 'find-replace':
        if (typeof bdOpenFindBar === 'function') bdOpenFindBar('replace');
        break;
      case 'reload':
        if (typeof reloadCurrentOpenFile === 'function') reloadCurrentOpenFile(event);
        else if (typeof bd !== 'undefined' && bd.path && typeof bdOpenBoard === 'function') bdOpenBoard(bd.label || '', bd.path);
        break;
      case 'detail':
        if (window.MeldexBoardStandalone?.toggleOptionsPanel) {
          window.MeldexBoardStandalone.toggleOptionsPanel();
          if (typeof bdRefreshSelectionDetails === 'function') bdRefreshSelectionDetails(true);
          break;
        }
        try {
          if (typeof toggleOptionPanel === 'function') toggleOptionPanel();
          else if (typeof toggleDetailPanel === 'function') toggleDetailPanel();
        } catch {}
        if (typeof bdRefreshSelectionDetails === 'function') bdRefreshSelectionDetails(true);
        break;
      case 'filters':
        bdOpenFilterMenu(btn);
        break;
    }
  });
  _bdToolbarControl(root, 'zoom-slider', 'bd-zoom-slider')?.addEventListener('input', function onZoomInput() {
    bd.zoom = this.value / 100;
    bdTransform();
  });
  _bdToolbarControl(root, 'rot-slider', 'bd-rot-slider')?.addEventListener('input', function onRotationInput() {
    bd.rotation = +this.value;
    bdTransform();
  });
  const canvasEl = root.querySelector('[data-bd-role="canvas"]');
  const worldEl = root.querySelector('[data-bd-role="world"]') || document.getElementById('bd-world');
  if (typeof bdApplyBoardFileStyleAndTheme === 'function') {
    bdApplyBoardFileStyleAndTheme(canvasEl, worldEl);
  } else if (typeof bdApplyCanvasBackground === 'function') {
    bdApplyCanvasBackground(canvasEl);
  }
  const titleEl = _bdToolbarControl(root, 'title', 'bd-title');
  if (titleEl) {
    titleEl.title = 'ダブルクリックでファイル名を変更';
    titleEl.addEventListener('dblclick', event => {
      event.preventDefault();
      event.stopPropagation();
      _bdStartInlineBoardTitleEdit(titleEl);
    });
  }
  bdRefreshBoardToolbar(root);
}

function _bdColorSwatchStyle(value) {
  const next = _bdSafeDetailCssColor(value, '');
  if (!next) {
    return 'background:linear-gradient(45deg, rgba(148,163,184,0.38) 25%, transparent 25%, transparent 75%, rgba(148,163,184,0.38) 75%),linear-gradient(45deg, rgba(148,163,184,0.38) 25%, transparent 25%, transparent 75%, rgba(148,163,184,0.38) 75%);background-size:8px 8px;background-position:0 0,4px 4px;';
  }
  return `background:${_bdEscAttr(next)};`;
}

function _bdSafeDetailCssColor(value, fallback = '') {
  if (typeof _bdPresetSafeCssColor === 'function') return _bdPresetSafeCssColor(value, fallback);
  const raw = String(value == null ? '' : value).trim();
  if (!raw) return fallback;
  if (raw.length > 120 || /[<>{};\\]/.test(raw) || /url\s*\(|expression\s*\(|@/i.test(raw)) return fallback;
  if (/^#[0-9a-f]{3,8}$/i.test(raw)) return raw;
  if (/^(?:rgba?|hsla?)\([0-9a-z\s.,%/+:-]+\)$/i.test(raw)) return raw;
  if (/^var\(--[A-Za-z0-9_-]+(?:\s*,\s*(?:#[0-9a-f]{3,8}|[A-Za-z]+|(?:rgba?|hsla?)\([0-9a-z\s.,%/+:-]+\)))?\)$/i.test(raw)) return raw;
  if (/^(?:transparent|currentColor|Canvas|CanvasText|AccentColor|AccentColorText)$/i.test(raw)) return raw;
  return /^[A-Za-z]+$/.test(raw) ? raw : fallback;
}

function _bdColorFieldHtml(label, field, value, buttonAttr, resetAttr) {
  const nextValue = String(value || '').trim();
  const safeValue = _bdSafeDetailCssColor(nextValue, '');
  const isTextColor = field === 'textColor';
  const isStrokeColor = field === 'textStrokeColor';
  const iconSvg = isTextColor ? (typeof lucide === 'function' ? lucide('type', 14) : 'T')
    : isStrokeColor ? (typeof lucide === 'function' ? lucide('typeOutline', 14) : 'T')
    : '';
  const gbFmtClass = (isTextColor || isStrokeColor) ? 'gb-fmt-swatch-fg' : 'gb-fmt-swatch-bg';
  const styleStr = (isTextColor || isStrokeColor)
    ? `color:${_bdEscAttr(safeValue || 'var(--fg)')};`
    : _bdColorSwatchStyle(nextValue);
  return `<label class="bd-detail-field"><span>${esc(label)}</span><span class="bd-detail-swatch-row"><button type="button" class="bd-color-swatch gb-fmt-swatch ${gbFmtClass}${nextValue ? ' is-set' : ''}" style="${styleStr}" ${buttonAttr}="${_bdEscAttr(field)}" title="${esc(label)}">${iconSvg}</button><button type="button" class="gb-fmt-reset bd-detail-reset-btn" ${resetAttr}="${_bdEscAttr(field)}" ${nextValue ? '' : 'disabled'}>リセット</button></span></label>`;
}

function _bdRangeFieldHtml(label, field, value, min, max, step, attrName) {
  const attr = attrName || 'data-bd-field';
  const nextValue = Number.isFinite(+value) ? +value : 0;
  return `<label class="bd-detail-field bd-detail-field-range"><span>${esc(label)}</span><span class="bd-detail-range"><input type="range" min="${_bdEscAttr(min)}" max="${_bdEscAttr(max)}" step="${_bdEscAttr(step)}" value="${_bdEscAttr(nextValue)}" ${attr}="${_bdEscAttr(field)}" data-bd-sync-key="${_bdEscAttr(field)}" data-e2e-id="bd-range-${_bdEscAttr(field)}-slider" aria-label="${_bdEscAttr(`${label} スライダー`)}"><input type="number" min="${_bdEscAttr(min)}" max="${_bdEscAttr(max)}" step="${_bdEscAttr(step)}" value="${_bdEscAttr(nextValue)}" ${attr}="${_bdEscAttr(field)}" data-bd-sync-key="${_bdEscAttr(field)}" data-e2e-id="bd-range-${_bdEscAttr(field)}-number" aria-label="${_bdEscAttr(`${label} 数値`)}"></span></label>`;
}

function _bdDetailStyleTriggerHtml(kind, styleId, attrName) {
  const style = kind === 'card' ? bdGetCardStyleById(styleId) : bdGetLineStyleById(styleId);
  // ドロップダウンのアイテムプレビューと同じ HTML を使用（サイズも揃える）
  const preview = _bdStylePickerLargePreviewHtml(kind, style);
  return `<button type="button" class="bd-detail-style-trigger" ${attrName}="${_bdEscAttr(style?.id || '')}"><span class="bd-detail-style-trigger-preview bd-style-picker-preview">${preview}</span><span class="bd-detail-style-trigger-label">${esc(style?.name || '')}</span><span class="bd-style-picker-caret">${lucide('chevronDown', 10)}</span></button>`;
}

function _bdStyleSummaryHtml(kind, style) {
  if (!style) return '';
  if (kind === 'card') {
    return `<div class="bd-style-summary-card">
      <div class="bd-style-summary-grid">
        <div><span>背景</span><span class="bd-inline-swatch gb-color-swatch gb-color-swatch--inline" style="${_bdColorSwatchStyle(style.bgColor || '')}"></span></div>
        <div><span>文字</span><span class="bd-inline-swatch gb-color-swatch gb-color-swatch--inline" style="${_bdColorSwatchStyle(style.textColor || '')}"></span></div>
        <div><span>文字フチ</span><span class="bd-inline-swatch gb-color-swatch gb-color-swatch--inline" style="${_bdColorSwatchStyle(style.textStrokeColor || '')}"></span></div>
        <div><span>枠線</span><span class="bd-inline-swatch gb-color-swatch gb-color-swatch--inline" style="${_bdColorSwatchStyle(style.borderColor || '')}"></span></div>
        <div><span>フチ幅</span><span>${Math.max(0, +style.textStrokeWidth || 0)}px</span></div>
        <div><span>太さ</span><span>${Math.max(0, +style.borderWidth || 0)}px</span></div>
        <div><span>角丸</span><span>${Math.max(0, +style.borderRadius || 0)}px</span></div>
        <div><span>文字</span><span>${Math.max(8, +style.fontSize || 13)}px${style.fontBold ? ' / 太字' : ''}${style.fontItalic ? ' / 斜体' : ''}</span></div>
      </div>
    </div>`;
  }
  return `<div class="bd-style-summary-card">
    <div class="bd-style-summary-grid">
      <div><span>色</span><span class="bd-inline-swatch gb-color-swatch gb-color-swatch--inline" style="${_bdColorSwatchStyle(style.color || '')}"></span></div>
      <div><span>太さ</span><span>${Math.max(0, +style.width || 0)}px</span></div>
      <div><span>ライン種</span><span>${style.style === 'dashed' ? '破線' : '実線'}</span></div>
      <div><span>矢印</span><span>${style.arrow === 'both' ? '双方向' : style.arrow === 'start' ? '逆方向' : style.arrow === 'end' ? '順方向' : 'なし'}</span></div>
      <div><span>形状</span><span>${(style.pathType === 'orthogonal' || style.pathType === 'orthogonal-curve') ? '直角線' : style.pathType === 'straight' ? '直線' : '曲線'}</span></div>
    </div>
  </div>`;
}

function _bdSyncRangeInputs(root, fieldAttr) {
  const attr = fieldAttr || 'data-bd-field';
  root.querySelectorAll(`[${attr}][data-bd-sync-key]`).forEach(input => {
    input.addEventListener('input', () => {
      const field = input.getAttribute(attr);
      const syncKey = input.dataset.bdSyncKey;
      root.querySelectorAll(`[${attr}="${field}"][data-bd-sync-key="${syncKey}"]`).forEach(other => {
        if (other !== input) {
          other.value = input.value;
          globalThis.GBUI?.refreshRangeFill?.(other);
        }
      });
    });
  });
}

function _bdAssignCardStyleToNodes(nodeIds, styleId) {
  const ids = [...new Set((nodeIds || []).filter(Boolean))];
  if (!ids.length) return false;
  ids.forEach(nodeId => {
    const node = bd.nodes.find(item => item.id === nodeId);
    if (!node) return;
    if (typeof bdSetNodeCardStyleRef === 'function') bdSetNodeCardStyleRef(node, styleId, { clearOverrides: true });
    else {
      node.cardStyle = styleId || '';
      bdClearCardStyleOverrides(node);
      if (styleId) node._userCardStyle = true;
      else delete node._userCardStyle;
    }
  });
  if (styleId) bd.activeCardStyle = styleId;
  return true;
}

function _bdAssignLineStyleToConnections(connIds, styleId) {
  const ids = [...new Set((connIds || []).filter(Boolean))];
  if (!ids.length) return false;
  ids.forEach(connId => {
    const conn = typeof bdGetConnectionById === 'function' ? bdGetConnectionById(connId) : null;
    if (!conn) return;
    conn.styleRef = styleId || '';
    bdClearConnectionStyleOverrides(conn);
  });
  if (styleId) bd.activeLineStyle = styleId;
  return true;
}

function _bdSelectionSummaryHtml() {
  const nodeCount = bd.selected.size;
  const connIds = typeof bdGetSelectedConnectionIds === 'function' ? bdGetSelectedConnectionIds() : [];
  const connCount = connIds.length;
  if (!nodeCount && !connCount) return '';
  const hintParts = [];
  if (nodeCount) hintParts.push(`${nodeCount} 件のカード`);
  if (connCount) hintParts.push(`${connCount} 本のライン`);
  const cardStyle = bdGetCardStyleById(bd.activeCardStyle);
  const lineStyle = bdGetLineStyleById(bd.activeLineStyle);
  return `
    <div class="bd-detail-panel" data-bd-detail-root="selection">
      <div class="bd-detail-heading">複数選択</div>
      <div class="bd-detail-hint">${hintParts.join(' / ')} が選択されています。</div>
      ${nodeCount ? `<div class="bd-detail-section">
        <div class="bd-detail-section-title">カード一括変更</div>
        <label class="bd-detail-field bd-detail-field-wide"><span>カードスタイル</span>${_bdDetailStyleTriggerHtml('card', bd.activeCardStyle, 'data-bd-selection-card-style-pick')}</label>
        <div class="bd-detail-field bd-detail-field-wide"><span>スタイル</span>${_bdStyleSummaryHtml('card', cardStyle)}</div>
      </div>` : ''}
      ${connCount ? `<div class="bd-detail-section">
        <div class="bd-detail-section-title">ライン一括変更</div>
        <label class="bd-detail-field bd-detail-field-wide"><span>ラインスタイル</span>${_bdDetailStyleTriggerHtml('line', bd.activeLineStyle, 'data-bd-selection-line-style-pick')}</label>
        <div class="bd-style-summary-card"><div class="bd-style-editor-fields bd-style-editor-fields--fmt" data-bd-selection-line-style-fields></div></div>
      </div>` : ''}
    </div>`;
}

const _BD_MARKER_CATEGORY_LABELS = {
  priority: '優先度',
  flag: 'フラグ',
};
function _bdMarkerSelectHtml(node, category, markers) {
  const current = node.markers?.[category];
  const options = [`<option value="">なし</option>`].concat(
    markers.map((marker, index) => `<option value="${index}" ${current === index ? 'selected' : ''}>${esc(marker.label)}</option>`),
  );
  const label = _BD_MARKER_CATEGORY_LABELS[category] || category;
  return `<label class="bd-detail-field"><span>${esc(label)}</span><select data-bd-field="marker:${_bdEscAttr(category)}">${options.join('')}</select></label>`;
}

function _bdNodeCheckboxValue(node) {
  if (node.checked === true) return 'true';
  if (node.checked === false) return 'false';
  return '';
}

function _bdNodeStatusOptions(node) {
  const names = typeof bdStatusNames === 'function' ? bdStatusNames() : [''];
  return names
    .map(status => `<option value="${_bdEscAttr(status)}" ${node.status === status ? 'selected' : ''}>${esc(status || 'なし')}</option>`)
    .join('');
}

function _bdShapeOptions(node) {
  const currentShape = (node && node.id && typeof bdGetNodeStyle === 'function')
    ? (bdGetNodeStyle(node)?.shape || node.shape || 'rect')
    : ((node && node.shape) || 'rect');
  const shapes = (typeof BD_SHAPES !== 'undefined' ? BD_SHAPES : ['rect']).map(shape => ({
    value: shape,
    label: (typeof BD_SHAPE_LABELS !== 'undefined' && BD_SHAPE_LABELS[shape]) || shape,
  }));
  return shapes
    .map(shape => `<option value="${_bdEscAttr(shape.value)}" ${currentShape === shape.value ? 'selected' : ''}>${esc(shape.label)}</option>`)
    .join('');
}

function _bdStructureOptions(node) {
  // 構造 '' (未設定) は「親に従う」= ルートカードに設定された構造を継承する意味。
  // ルートカードで '' のままなら自動レイアウトが掛からない (= 従来の「自由配置」相当)。
  const entries = _bdStructureEntries();
  return entries
    .map(entry => `<option value="${_bdEscAttr(entry.key)}" ${String(node.structure || '') === entry.key ? 'selected' : ''}>${esc(entry.label)}</option>`)
    .join('');
}

function _bdStructureEntries() {
  return [{ key: '', label: '親に従う' }].concat(
    Object.entries(typeof BD_STRUCTURES !== 'undefined' ? BD_STRUCTURES : {}).map(([key, label]) => ({ key, label })),
  );
}

function _bdStructureLabel(node) {
  const current = String(node?.structure || '');
  const entry = _bdStructureEntries().find(item => item.key === current);
  return entry?.label || current || '親に従う';
}

function _bdStructureHintHtml(node) {
  const label = _bdStructureLabel(node);
  const hasOwnStructure = !!String(node?.structure || '');
  const body = hasOwnStructure
    ? `このカード以下のサブツリーに「${esc(label)}」を適用します。親カードの構造には従いません。`
    : '親カードがある場合は親の構造を継承します。親がないカード、または親側にも設定がない場合は自由配置です。';
  return `<div class="bd-detail-hint bd-detail-structure-hint"><div class="bd-detail-hint-current">現在の選択: ${esc(label)} ${fieldHelp(body, { e2eId: 'bd-structure-help' })}</div></div>`;
}

function _bdCardStyleOptions(node) {
  bdEnsureBoardUiState();
  return bd.cardStyles
    .map(style => `<option value="${_bdEscAttr(style.id)}" ${node.cardStyle === style.id ? 'selected' : ''}>${esc(style.name)}</option>`)
    .join('');
}

let _bdLastNodeDetailPanels = null;

// 現在 active な詳細タブを、新しい選択でも引き継げる形に解決する。
// - file-style / backlinks はボード全般で常に利用可能なので、選択タイプに関わらず保持する
// - supportable に含まれるときはそのまま保持
// - 該当しない場合は fallback (既定: file-style = テーマ)
function _bdResolveCurrentBoardTab(supportable, fallback) {
  const cur = (typeof _currentDetailTab !== 'undefined') ? _currentDetailTab : null;
  if (cur === 'file-style' || cur === 'backlinks') return cur;
  if (Array.isArray(supportable) && supportable.includes(cur)) return cur;
  return fallback || 'file-style';
}

function _bdNodePanelHtml(node, title, sections) {
  return `
