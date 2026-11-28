// Audit-P2 H-7: view_lock 情報。
// state.view と getAnnotationTarget() から (view_key, kind, getState) を合成する。
function _getActiveViewLockInfo() {
  if (typeof ViewLock === 'undefined' || typeof state === 'undefined') return null;
  const viewName = (typeof _getAnnotationViewName === 'function') ? _getAnnotationViewName() : state.view;
  const target = (typeof getAnnotationTarget === 'function') ? getAnnotationTarget() : '';
  if (!target) return null;
  const kindMap = {
    page: 'page', entity: 'page',
    database: 'db', pivot: 'db', tree: 'db', gallery: 'db', kanban: 'db', timeline: 'db',
    chart: 'db', graph: 'db', form: 'db',
    scriptnote: 'scriptnote', calendar: 'calendar',
    media: 'media', folder: 'folder',
    compare: 'compare',
  };
  const kind = kindMap[viewName];
  if (!kind || !ViewLock.isSupported(kind)) return null;
  const chosen = window.GBAnnotationSurfaces?.enabled() ? window.GBAnnotationSurfaces.target() : null;
  const paneEl = chosen?.host || document.querySelector('.gb-pane-active');
  const paneId = chosen?.id || paneEl?.id || paneEl?.dataset?.paneId || '';
  const vk = ViewLock.viewKey(target, paneId);
  if (!vk) return null;
  const getState = () => {
    const sc = chosen?.host.querySelector('[data-editor-local-id=page-content],#page-content,.sn2-scroll,.pivot-view') || ((typeof _getScrollContainerForView === 'function') ? _getScrollContainerForView(viewName) : null);
    const out = { view: viewName };
    if (sc) { out.scrollX = sc.scrollLeft; out.scrollY = sc.scrollTop; }
    return out;
  };
  return { viewKey: vk, kind, getState };
}

async function _maybeEngageViewLockForStroke() {
  // 表示ロックは既定OFF。ユーザーがロックアイコンを押した時点でのみ固定する。
  // 描画開始時の自動ロックや確認ダイアログは出さない。
  return true;
}

function _annotationScrollbarHitTest(clientX, clientY) {
  const sc = _annScrollContainer;
  if (!sc || typeof sc.getBoundingClientRect !== 'function') return false;
  const rect = sc.getBoundingClientRect();
  if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) return false;
  const vertical = sc.scrollHeight > sc.clientHeight;
  const horizontal = sc.scrollWidth > sc.clientWidth;
  const zoom = (typeof _annotationUiZoom === 'function') ? _annotationUiZoom() : 1;
  const gutterX = Math.max(12, Math.min(24, (sc.offsetWidth || 0) - (sc.clientWidth || 0) || 17)) * zoom;
  const gutterY = Math.max(12, Math.min(24, (sc.offsetHeight || 0) - (sc.clientHeight || 0) || 17)) * zoom;
  if (vertical && clientX >= rect.right - gutterX) return true;
  if (horizontal && clientY >= rect.bottom - gutterY) return true;
  return false;
}

function _updateAnnotationOverlayScrollPassthrough(clientX, clientY) {
  const overlay = document.getElementById('ann-overlay');
  if (!overlay || !overlay.classList.contains('active')) return;
  overlay.classList.toggle('ann-scrollbar-passthrough', _annotationScrollbarHitTest(clientX, clientY));
}

function _routeAnnotationWheelToScrollContainer(event) {
  if (typeof ann === 'undefined' || !ann.active || !_annScrollContainer) return;
  if (event.ctrlKey || _isIframeView(_getAnnotationViewName())) return;
  const sc = _annScrollContainer;
  const canScrollY = sc.scrollHeight > sc.clientHeight;
  const canScrollX = sc.scrollWidth > sc.clientWidth;
  if (!canScrollY && !canScrollX) return;
  const line = 16;
  const page = Math.max(1, sc.clientHeight || 1);
  const unit = event.deltaMode === 1 ? line : (event.deltaMode === 2 ? page : 1);
  const horizontalDelta = event.deltaX + (event.shiftKey ? event.deltaY : 0);
  const verticalDelta = event.shiftKey && canScrollX ? 0 : event.deltaY;
  if (canScrollX) sc.scrollLeft += horizontalDelta * unit;
  if (canScrollY) sc.scrollTop += verticalDelta * unit;
  event.preventDefault();
  event.stopPropagation();
}

document.addEventListener('pointermove', (event) => {
  if (typeof ann === 'undefined' || !ann.active || ann.drawing) return;
  _updateAnnotationOverlayScrollPassthrough(event.clientX, event.clientY);
}, { passive: true });

function _annotationRectDataFromPoints(points) {
  const first = points?.[0] || [0, 0];
  const last = points?.[points.length - 1] || first;
  const x1 = Number(first[0]) || 0, y1 = Number(first[1]) || 0;
  const x2 = Number(last[0]) || 0, y2 = Number(last[1]) || 0;
  return { x: Math.min(x1, x2), y: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) };
}

function _updateRectFillEl(rect, data, color, opacity, preview) {
  const x = Number(data?.x) || 0, y = Number(data?.y) || 0;
  rect.setAttribute('x', x);
  rect.setAttribute('y', y);
  rect.setAttribute('width', Math.max(1, Number(data?.width) || 0));
  rect.setAttribute('height', Math.max(1, Number(data?.height) || 0));
  rect.setAttribute('fill', color);
  const normalizedOpacity = _normalizeAnnotationOpacity(opacity, 1);
  rect.setAttribute('fill-opacity', String(typeof _annotationFillOpacity === 'function' ? _annotationFillOpacity(data, normalizedOpacity, preview) : normalizedOpacity * (preview ? 0.2 : 0.4)));
  rect.setAttribute('stroke', color);
  rect.setAttribute('stroke-width', '1');
  rect.setAttribute('stroke-opacity', String(normalizedOpacity));
  if (preview) rect.setAttribute('stroke-dasharray', '4,4');
  else rect.removeAttribute('stroke-dasharray');
  return rect;
}

function _createRectFillEl(data, color, opacity, preview) {
  return _updateRectFillEl(document.createElementNS(_annSvgNS, 'rect'), data, color, opacity, preview);
}

function _annotationEllipseDataFromPoints(points) {
  const rect = _annotationRectDataFromPoints(points);
  return { cx: rect.x + rect.width / 2, cy: rect.y + rect.height / 2, rx: rect.width / 2, ry: rect.height / 2 };
}

function _updateAnnotationShapeEl(el, type, data, color, opacity, preview) {
  const normalizedOpacity = _normalizeAnnotationOpacity(opacity, 1);
  const outlined = type === 'rect-line' || type === 'ellipse-line';
  if (type.startsWith('ellipse')) {
    el.setAttribute('cx', Number(data?.cx) || 0);
    el.setAttribute('cy', Number(data?.cy) || 0);
    el.setAttribute('rx', Math.max(1, Number(data?.rx) || 0));
    el.setAttribute('ry', Math.max(1, Number(data?.ry) || 0));
  } else {
    el.setAttribute('x', Number(data?.x) || 0);
    el.setAttribute('y', Number(data?.y) || 0);
    el.setAttribute('width', Math.max(1, Number(data?.width) || 0));
    el.setAttribute('height', Math.max(1, Number(data?.height) || 0));
  }
  el.setAttribute('fill', outlined ? 'none' : color);
  el.setAttribute('fill-opacity', outlined ? '0' : String(typeof _annotationFillOpacity === 'function' ? _annotationFillOpacity(data, normalizedOpacity, preview) : normalizedOpacity * (preview ? 0.2 : 0.4)));
  el.setAttribute('stroke', color);
  el.setAttribute('stroke-width', String(Math.max(1, Number(data?.lineWidth) || ann.widths?.pen || 3)));
  el.setAttribute('stroke-opacity', String(normalizedOpacity));
  if (preview) el.setAttribute('stroke-dasharray', '4,4'); else el.removeAttribute('stroke-dasharray');
  return el;
}

function _createAnnotationShapeEl(type, data, color, opacity, preview) {
  const tag = type.startsWith('ellipse') ? 'ellipse' : 'rect';
  return _updateAnnotationShapeEl(document.createElementNS(_annSvgNS, tag), type, data, color, opacity, preview);
}

annOverlay?.addEventListener('wheel', _routeAnnotationWheelToScrollContainer, { passive: false });

annOverlay.addEventListener('pointerdown', async (e) => {
  if (!ann.active) return;
  if (ann.drawing) return;
  if (e.button != null && e.button !== 0) return;
  if (typeof _annotationScrollbarHitTest === 'function' && _annotationScrollbarHitTest(e.clientX, e.clientY)) {
    if (typeof _updateAnnotationOverlayScrollPassthrough === 'function') {
      _updateAnnotationOverlayScrollPassthrough(e.clientX, e.clientY);
    }
    return;
  }
  _preventAnnotationPointerDefault(e);
  if (ann.tool === 'sticky') {
    // Audit-P2 H-7: 付箋も表示状態を変えるとズレる → 誘導対象
    const ok = await _maybeEngageViewLockForStroke();
    if (!ok) return;
    createNote(e.clientX, e.clientY, 'sticky');
    return;
  }
  if (ann.tool === 'eraser') {
    await eraseAtPoint(e.clientX, e.clientY);
    return;
  }
  _resetAnnotationStrokeState();
  ann.drawing = true;
  ann.strokeReady = false;
  ann.strokeEndRequested = false;
  ann.currentPointerId = e.pointerId;
  ann.currentPath = [_annotationPointFromEvent(e)];
  ann.currentPressures = [e.pressure || 0.5];
  try { annOverlay.setPointerCapture(e.pointerId); } catch (_) {}
  // 表示ロックは自動では有効化しない。ロック中は別途 ViewLock の操作ガードだけが働く。
  const ok = await _maybeEngageViewLockForStroke();
  if (ann.currentPointerId !== e.pointerId) return;
  if (!ok) {
    _resetAnnotationStrokeState();
    return;
  }
  ann.strokeReady = true;
  _renderAnnotationPreview();
  if (ann.strokeEndRequested) _finishAnnotationStroke();
});

annOverlay.addEventListener('pointermove', (e) => {
  if (!ann.drawing) return;
  if (ann.currentPointerId !== e.pointerId) return;
  _preventAnnotationPointerDefault(e);
  _appendAnnotationCoalescedStrokePoints(e);
  _renderAnnotationPreview();
});

annOverlay.addEventListener('pointerup', (e) => {
  if (!ann.drawing) return;
  if (ann.currentPointerId !== e.pointerId) return;
  _preventAnnotationPointerDefault(e);
  _appendAnnotationCoalescedStrokePoints(e);
  ann.strokeEndRequested = true;
  try { annOverlay.releasePointerCapture(e.pointerId); } catch (_) {}
  if (ann.strokeReady) _finishAnnotationStroke();
});

annOverlay.addEventListener('pointercancel', (e) => {
  if (!ann.drawing) return;
  if (ann.currentPointerId !== e.pointerId) return;
  _preventAnnotationPointerDefault(e);
  try { annOverlay.releasePointerCapture(e.pointerId); } catch (_) {}
  _resetAnnotationStrokeState();
});

if (typeof _initTrayAnnotationHost === 'function') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => _initTrayAnnotationHost(), { once: true });
  } else {
    _initTrayAnnotationHost();
  }
}
/* One menu, independent drawing and reload state for every visible surface. */
window.GBAnnotationSurfaces = (() => {
  const surfaces = new Map();
  let selected = null, scheduled = false, revealRevision = 0;
  let clearing = false;
  const enabled = () => typeof GBLayout !== 'undefined' && !!document.getElementById('main-area') && !_isTrayAnnotationHost();
  const isOpen = () => enabled() && ann.active;
  const scope = s => 'annotation:' + _normalizeAnnotationTargetPath(s.path) + '#' + s.id;
  // 文書全体を書き換える操作（PDFのページ編集）の履歴。ページごとのscopeに積むと、編集後にページが
  // 変わった時に取り消せなくなるため、同じ画面の文書単位のscopeに積み、取り消し・やり直しでは新しい方を選ぶ。
  const documentScope = s => 'annotation-doc:' + _normalizeAnnotationTargetPath(String(s.sourcePath || s.path || '').replace(/#page=\d+$/i, '')) + '#' + s.id;
  const stackTop = (key, direction) => {
    const stack = typeof _getStack === 'function' ? _getStack(key)?.[direction] : null;
    return stack?.length ? stack[stack.length - 1].id : null;
  };
  function activeScope(s, direction) {
    const page = scope(s), whole = documentScope(s);
    const pageTop = stackTop(page, direction), wholeTop = stackTop(whole, direction);
    if (wholeTop == null) return page;
    if (pageTop == null) return whole;
    // 取り消しは後に積んだ方から。やり直しは後に取り消した方（先に積んだ方）から。
    return direction === 'undo' ? (wholeTop > pageTop ? whole : page) : (wholeTop < pageTop ? whole : page);
  }
  const samePath = (a, b) => typeof _rpAnnotationPathsMatch === 'function'
    ? _rpAnnotationPathsMatch(a, b) : _normalizeAnnotationTargetPath(a) === _normalizeAnnotationTargetPath(b);
  function select(s) {
    if (!s || !s.host.isConnected) return;
    const changed = selected !== s;
    selected = s;
    ann.targetPath = s.path;
    document.querySelectorAll('[data-annotation-selected]').forEach(el => el.removeAttribute('data-annotation-selected'));
    if (isOpen()) s.host.dataset.annotationSelected = 'true';
    if (changed && isOpen()) {
      _refreshAnnFloatingViewLockButton({ force: true });
      if (typeof updateUndoRedoButtonStates === 'function') updateUndoRedoButtonStates();
    }
    if (changed && typeof _syncLegacyRightPanelTargetHeaders === 'function') {
      _syncLegacyRightPanelTargetHeaders();
      if (document.getElementById('rp-annotation')?.classList.contains('active') && typeof loadRpAnnotationList === 'function') void loadRpAnnotationList();
    }
  }
  function stateFor(s) {
    return { type: 'ann-set-state', active: ann.active && !s.readOnly, tool: ann.tool,
      color: ann.color, opacity: ann.opacity, widths: ann.widths, targetPath: s.path, visible: _overlayVisible };
  }
  function send(s) {
    const msg = stateFor(s);
    if (!s.iframe) s.bridge.handleMessage({ type: 'ann-set-opacity', opacity: ann.opacity });
    if (s.iframe) {
      s.iframe.contentWindow?.postMessage({ ...msg, type: 'viewer-ann-set-state', sharedToolbar: true }, location.origin);
    } else {
      s.bridge.handleMessage(msg);
      s.bridge.handleMessage({ type: 'ann-set-visibility', visible: _overlayVisible });
    }
  }
  async function reload(s) {
    if (s.iframe) {
      // 遷移中のsandbox文書は同一URLでもまだ不透明なoriginを持つ。load後の同期に任せる。
      try { return s.iframe.contentWindow?.MeldexViewerAnnotations?.load?.(); }
      catch (error) { if (error.name === 'SecurityError') return; throw error; }
    }
    if (s.bridge.hasPendingWrites?.()) return;
    const seq = ++s.loadSeq, mutation = s.mutation;
    try {
      const items = await apiFetch(_annotationTargetFetchUrl(s.path));
      if (seq !== s.loadSeq || mutation !== s.mutation || surfaces.get(s.id) !== s || s.bridge.ann.drawing || s.bridge.hasPendingWrites?.()) return;
      // A pending save must never be overwritten by an older read.
      if (s.bridge.layer.querySelector('[data-ann-client-id]:not([data-ann-id])')) return;
      s.bridge.handleMessage({ type: 'ann-load', items });
      window.GBAnnotationHighlights?.render(s, items);
    } catch (error) { showStatus('アノテートを読み込めませんでした', true); }
  }
  function broadcast() {
    for (const s of surfaces.values()) send(s);
    document.querySelectorAll('.gb-dock-rail-annotate').forEach(btn => {
      btn.classList.toggle('active', ann.active);
      btn.setAttribute('aria-pressed', String(ann.active));
      btn.setAttribute('aria-expanded', String(ann.active));
    });
    if (selected) select(selected);
    if (typeof updateUndoRedoButtonStates === 'function') updateUndoRedoButtonStates();
  }
  function visible(host) {
    if (!host?.isConnected) return false;
    const rect = host.getBoundingClientRect();
    return rect.width > 1 && rect.height > 1 && getComputedStyle(host).visibility !== 'hidden';
  }
  function dispose(s) {
    window.GBAnnotationHighlights?.dispose(s);
    s.highlightPending?.forEach(reservation => reservation.cancel());
    if (s.iframe && s.onLoad) s.iframe.removeEventListener('load', s.onLoad);
    s.bridge?.dispose?.();
    s.host.removeAttribute('data-annotation-selected');
  }
  function candidates() {
    const out = [];
    for (const [id, info] of Object.entries(typeof GBLayout !== 'undefined' ? GBLayout.paneMap || {} : {})) {
      const node = info.node || GBLayout.findNode?.(GBLayout.root, id)?.node;
      const tab = node?.tabs?.[node.activeTabIndex];
      if (tab?.type === 'form-app') {
        const app = typeof getComponentInstance === 'function' ? getComponentInstance(tab.id) : null;
        if (!app?.surface?.isConnected || app.path !== tab.path) continue;
      }
      // 対象外のフォルダ等では寸法を読まない。大量カードの追加直後に不要な全体配置を確定させない。
      if (tab && _ANNOTATION_TARGET_VIEW_TYPES.has(tab.type) && visible(info.contentEl)) {
        out.push({ id, host: info.contentEl, tab });
      }
    }
    const host = document.getElementById('gb-subpanel-content');
    const tab = typeof GBSubPanel !== 'undefined' && GBSubPanel.isOpen() ? GBSubPanel.getCurrentTarget() : null;
    if (tab && !out.some(s => s.host === host) && visible(host)) out.push({ id: 'gb-subpanel-inner-pane', host, tab });
    return out;
  }
  function sync() {
    if (!enabled()) return;
    const live = new Set();
    for (const { id, host, tab } of candidates()) {
      const path = tab.path || tab.state?.pagePath || tab.state?.dbPath || tab.state?.scenarioPath || tab.state?.entityPath || tab.state?.boardPath || (tab.type === 'calendar' ? 'calendar:panel' : '');
      if (!path || tab.type === 'map') continue;
      const iframe = ['html', 'media'].includes(tab.type)
        ? [...host.querySelectorAll('iframe')].find(frame => window._gbIsTrustedInternalViewerUrl?.(frame.getAttribute('src') || '')) : undefined;
      if ((tab.type === 'html' || tab.type === 'media') && !iframe) continue;
      live.add(id);
      let s = surfaces.get(id);
      if (s && (s.host !== host || s.sourcePath !== path || s.type !== tab.type || !s.iframe && !s.bridge.svg.isConnected || s.iframe !== iframe)) {
        dispose(s); surfaces.delete(id); s = null;
      }
      if (!s) {
        s = { id, host, path, sourcePath: path, tab, type: tab.type, iframe, loadSeq: 0, mutation: 0,
          readOnly: tab.readOnly || tab.state?.readOnly || tab.state?.writeBlocked || tab.state?.access === 'viewer' || document.body.dataset.cloudReadonly === '1' || document.body.dataset.cloudQuotaBlocked === '1' };
        if (!iframe) {
          const canvas = tab.type === 'board' ? host.querySelector('[data-bd-role=canvas],#bd-canvas') : null;
          s.bridge = initIframeMarkup(canvas || host, { localSurface: true,
            scrollContainer: host.querySelector('[data-editor-local-id=page-content],#page-content,.sn2-scroll,#pivot-view,.gb-cal-content'), historyScope: () => scope(s),
            onPointer: () => { select(s); s.mutation++; }, onMutation: () => { s.mutation++; } });
          s.bridge.svg.removeAttribute('id'); s.bridge.layer.removeAttribute('id');
          s.bridge.svg.dataset.annotationSurface = id;
          s.bridge.svg.style.zIndex = '50'; s.bridge.notesLayer.style.zIndex = '51';
          s.bridge.svg.style.overflow = 'hidden';
        }
        if (iframe) { s.onLoad = () => send(s); iframe.addEventListener('load', s.onLoad); }
        surfaces.set(id, s);
        send(s); void reload(s);
      } else {
        s.tab = tab;
        const blocked = !!(tab.readOnly || tab.state?.readOnly || tab.state?.writeBlocked || tab.state?.access === 'viewer' || document.body.dataset.cloudReadonly === '1' || document.body.dataset.cloudQuotaBlocked === '1');
        if (!!s.readOnly !== blocked) { s.readOnly = blocked; send(s); }
      }
    }
    for (const [id, s] of surfaces) {
      if (live.has(id)) continue;
      dispose(s); surfaces.delete(id);
    }
    if (!selected || surfaces.get(selected.id) !== selected) select(surfaces.values().next().value);
    if (selected && !surfaces.has(selected.id)) selected = null;
    document.getElementById('btn-tb-annotation')?.setAttribute('hidden', '');
    document.querySelectorAll('.annotation-fab-mirror').forEach(el => el.remove());
    const legacy = document.getElementById('ann-overlay');
    if (legacy) legacy.style.display = 'none';
  }
  function fromElement(el) {
    const matches = [...surfaces.values()].filter(s => s.host.contains(el));
    return matches.find(s => !matches.some(other => other !== s && s.host.contains(other.host)))
      || [...surfaces.values()].find(s => s.host.closest('.gb-pane,.cloud-mobile-side-drawer')?.contains(el));
  }
  function toggle(source) {
    sync();
    if (ann.active) return close();
    const target = fromElement(source || document.activeElement) || selected || surfaces.values().next().value;
    if (!target || target.readOnly) { showStatus('この画面ではアノテートを編集できません', true); return false; }
    ann.active = true;
    select(target);
    const toolbar = document.getElementById('ann-toolbar');
    _positionFloatingToolbar(toolbar, document.querySelector('.gb-dock-rail-annotate'));
    toolbar.classList.add('visible'); document.body.classList.add('ann-toolbar-active');
    _refreshAnnFloatingViewLockButton({ force: true });
    broadcast(); scheduleHighlightSync(); return true;
  }
  function close() {
    ann.active = false;
    document.getElementById('ann-toolbar')?.classList.remove('visible');
    document.body.classList.remove('ann-toolbar-active');
    document.querySelectorAll('[data-annotation-selected]').forEach(el => el.removeAttribute('data-annotation-selected'));
    broadcast(); return true;
  }
  async function navigateHistory(direction) {
    const s = selected;
    if (!s) return false;
    await s.bridge?.flush?.();
    return direction === 'undo' ? historyUndo(activeScope(s, 'undo')) : historyRedo(activeScope(s, 'redo'));
  }
  async function clear() {
    const s = selected;
    if (!s || s.readOnly || clearing) return false;
    if (s.iframe) { return s.iframe.contentWindow.MeldexViewerAnnotationScene?.clearAll({ confirmed: true }); }
    const button = document.querySelector('#ann-toolbar [data-action="annClear()"]');
    clearing = true;
    if (button) { button.disabled = true; button.setAttribute('aria-busy', 'true'); }
    showStatus('アノテートを削除しています...');
    try {
      await s.bridge.flush();
      let before;
      try { before = await apiFetch(_annotationTargetFetchUrl(s.path)); }
      catch { showStatus('アノテートを読み込めませんでした', true); return false; }
      const rows = before.filter(item => !['comment', 'note', 'sticky'].includes(item.type) || _isStandaloneAnnotationNoteItem(item, _parseAnnotationData(item)));
      // Every row shares one durable store revision. Concurrent deletes can
      // conflict with each other; retain partial history while saving in order.
      const deleted = [];
      for (const item of rows) {
        try { await apiDelete('/annotations/' + encodeURIComponent(item.id)); deleted.push(item); }
        catch { /* Report the incomplete batch after preserving its history. */ }
      }
      _pushAnnotationBatchHistory('アノテート: 全削除', deleted, [], s.path, scope(s));
      s.mutation++; await reload(s);
      if (deleted.length !== rows.length) { showStatus('アノテートを一部削除できませんでした', true); return false; }
      showStatus('アノテートを全削除しました');
      return true;
    } finally {
      clearing = false;
      if (button) { button.disabled = false; button.removeAttribute('aria-busy'); }
    }
  }
  const observe = () => {
    new MutationObserver(() => {
      if (scheduled || !enabled()) return;
      scheduled = true;
      requestAnimationFrame(() => { scheduled = false; sync(); });
    }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-cloud-readonly', 'data-cloud-quota-blocked'] });
    sync();
  };
  // 描いた線・塗りの上の右クリック: 共通メニューの「色...」から共通カラーパレット（不透明度つき）で色を変える。
  function strokeAt(s, clientX, clientY) {
    if (!s || s.iframe || !s.bridge?.layer || s.bridge.svg.style.visibility === 'hidden') return null;
    const layer = s.bridge.layer, ctm = layer.getScreenCTM?.();
    if (!ctm) return null;
    const point = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
    const tolerance = 6 / (Math.hypot(ctm.a, ctm.b) || 1);
    for (const el of [...layer.querySelectorAll('[data-ann-id]')].reverse()) {
      if (el.classList.contains('ann-preview')) continue;
      const parts = el.matches('path,polygon,rect,ellipse') ? [el] : [...el.querySelectorAll('path,polygon,rect,ellipse')];
      if (parts.some(part => _coreAnnotationElementHit(part, point.x, point.y, tolerance))) return el;
    }
    return null;
  }
  // 本文側の右クリックメニュー（document で受ける）より先に判定するため window の捕捉段階で受ける。
  window.addEventListener('contextmenu', e => {
    if (!enabled() || e.defaultPrevented) return;
    const s = fromElement(e.target);
    if (!s || s.readOnly) return;
    const el = strokeAt(s, e.clientX, e.clientY);
    if (!el || !window.MeldexContextMenuUI?.openAt) return;
    e.preventDefault(); e.stopImmediatePropagation();
    select(s);
    const x = e.clientX, y = e.clientY;
    window.MeldexContextMenuUI.openAt({ x, y, ariaLabel: 'アノテート', items: [
      { label: '色...', ariaLabel: '色...', icon: 'palette', e2eId: 'annotation-stroke-recolor',
        action: () => void window.GBAnnotationRecolor.open({ id: el.dataset.annId, targetPath: s.path, scope: window.GBAnnotationRecolor.currentScope(),
          anchor: window.GBAnnotationRecolor.anchorAt(x, y), preview: row => _paintAnnotationRecolorPreview(el, row),
          refresh: () => { s.mutation++; void reload(s); } }) },
    ] });
  }, true);
  // ツールバーの「ハイライト」: 選んでいる文字に付ける（描画ツールではない）。ノート等の本文の選択か、
  // ビューワー（PDFの文字層・OCRの認識結果）の選択がある時だけ押せる。無い時は理由をツールチップで示す。
  const HIGHLIGHT_NO_TEXT = 'ハイライトは選択した文字に付けます。文字を選んでから押してください（文字の無い画像やスキャンしたPDFには、マーキングの矩形塗りを使います）';
  function highlightTarget() {
    const context = window.GBAnnotationHighlights?.capture?.();
    if (context) return { context };
    if (selected?.iframe && selected.hasText && !selected.readOnly) return { frame: selected };
    return null;
  }
  function syncHighlightButton() {
    const button = document.getElementById('ann-highlight-selection');
    if (!button || !enabled()) return;
    const ready = ann.active && !!highlightTarget();
    if (button.getAttribute('aria-disabled') !== String(!ready)) button.setAttribute('aria-disabled', String(!ready));
    button.classList.toggle('disabled', !ready);
    const title = ready ? 'ハイライト — 選んだ文字にツールバーの色でハイライトを付けます' : HIGHLIGHT_NO_TEXT;
    if (button.title !== title) button.title = title;
  }
  let highlightSyncTimer = 0;
  const scheduleHighlightSync = () => { clearTimeout(highlightSyncTimer); highlightSyncTimer = setTimeout(syncHighlightButton, 80); };
  document.addEventListener('selectionchange', () => { if (ann.active) scheduleHighlightSync(); });
  document.addEventListener('pointerdown', e => {
    if (e.target.closest?.('#ann-highlight-selection')) e.preventDefault(); // 押しても文字の選択を外さない
  }, true);
  document.addEventListener('click', e => {
    const button = e.target.closest?.('#ann-highlight-selection');
    if (!button) return;
    e.preventDefault();
    const target = button.getAttribute('aria-disabled') === 'true' ? null : highlightTarget();
    if (!target) { showStatus(HIGHLIGHT_NO_TEXT, true); return; }
    if (target.context) void window.GBAnnotationHighlights.create(target.context, ann.color);
    else {
      try { target.frame.iframe.contentWindow?.MeldexViewerHighlights?.highlightTextSelection?.(ann.color); }
      catch { showStatus('ハイライトを付けられませんでした', true); }
    }
    scheduleHighlightSync();
  });
  document.addEventListener('pointerdown', e => { if (e.target.closest?.('[data-undo-button],[data-redo-button]')) return; const s = fromElement(e.target); if (s) select(s); }, true);
  document.addEventListener('focusin', e => { if (e.target.closest?.('[data-undo-button],[data-redo-button]')) return; const s = fromElement(e.target); if (s) select(s); }, true);
  document.addEventListener('keydown', e => {
    if (!enabled() || e.key.toLowerCase() !== 'a' || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || e.target.closest?.('input,textarea,[contenteditable=true],[contenteditable=plaintext-only]')) return;
    e.preventDefault(); toggle(e.target);
  });
  window.addEventListener('message', e => {
    if (e.origin !== location.origin || !enabled()) return;
    const s = [...surfaces.values()].find(item => item.iframe?.contentWindow === e.source);
    if (!s) return;
    if (e.data?.type === 'viewer-ann-highlight-pending' && e.data.requestId) {
      if (e.data.targetPath) s.path = String(e.data.targetPath);
      select(s);
      s.highlightPending ||= new Map();
      if (!s.highlightPending.has(e.data.requestId)) s.highlightPending.set(e.data.requestId,
        historyReserve('アノテート: 範囲ハイライト', scope({ ...s, path: e.data.targetPath || s.path }), e.data.targetPath || s.path));
    }
    if (e.data?.type === 'viewer-ann-open-menu') {
      if (e.data.targetPath) s.path = String(e.data.targetPath);
      select(s); if (!ann.active) toggle(s.host); else broadcast();
    }
    if (e.data?.type === 'viewer-ann-text-selection') {
      s.hasText = !!e.data.hasText;
      if (s.hasText) select(s);
      scheduleHighlightSync();
    }
    if (['viewer-ann-pointer-target', 'viewer-ann-state-changed'].includes(e.data?.type)) {
      const pathChanged = e.data.targetPath && s.path !== String(e.data.targetPath);
      if (e.data.targetPath) s.path = String(e.data.targetPath);
      if (pathChanged) send(s);
      if (e.data.type === 'viewer-ann-pointer-target' || selected === s) select(s);
    }
    if (e.data?.type === 'viewer-ann-save-result') {
      const msg = e.data;
      const reservation = s.highlightPending?.get(msg.highlightRequestId);
      if (msg.highlightRequestId) s.highlightPending?.delete(msg.highlightRequestId);
      if (msg.ok && msg.history) {
        const path = msg.targetPath || s.path;
        const batch = Array.isArray(msg.history.beforeRows) || Array.isArray(msg.history.afterRows);
        const push = () => batch
          ? _pushAnnotationBatchHistory('アノテート: 全削除', msg.history.beforeRows, msg.history.afterRows, path, reservation?.entry.scope || scope({ ...s, path }))
          : _pushAnnotationHistory('アノテート: ビューワー', msg.history.before, msg.history.after, path, reservation?.entry.scope || scope({ ...s, path }));
        if (reservation) reservation.capture(push); else push();
      }
      else reservation?.cancel();
      _handleViewerAnnotationSaveResult(msg, { recordHistory: false });
      if (msg.ok && typeof loadRpAnnotationList === 'function') void loadRpAnnotationList();
    }
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', observe, { once: true }); else observe();
  return { enabled, isOpen, sync, toggle, close, broadcast, clear, syncHighlightButton,
    usesHistory: () => isOpen() || !!selected?.iframe,
    forElement: fromElement,
    captureTargets: () => { sync(); return [...surfaces.values()]; },
    async reveal(item) {
      const revision = ++revealRevision, deadline = performance.now() + 60000;
      const path = item.target_ref?.file || item.target_path;
      if (!path) return false;
      const documentPath = path.replace(/(\.pdf)#page=\d+$/i, '$1');
      const same = value => samePath(value, path);
      sync();
      const sceneHas = s => { try { return !!s.iframe?.contentWindow?.MeldexViewerAnnotationScene?.findSceneByPath?.(path); } catch { return false; } };
      const find = () => [selected, ...surfaces.values()].filter(Boolean).find(s => same(s.path)
        || s.iframe && samePath(s.sourcePath, documentPath)
        || sceneHas(s));
      let s = find();
      if (!s) {
        if (selected?.id === 'gb-subpanel-inner-pane' && window.GBSubPanel) {
          await openLinkedPathInRightSidebar(documentPath, documentPath.split(/[\\/]/).pop(), { sourceEl: document.activeElement });
        } else {
          if (selected?.id && GBLayout.paneMap[selected.id]) GBLayout.setActivePane(selected.id);
          if (/\.(?:pdf|epub|png|jpe?g|gif|webp|bmp)$/i.test(documentPath)) openMedia(documentPath.split(/[\\/]/).pop(), documentPath, /\.(?:pdf|epub)$/i.test(documentPath) ? 'pdf' : 'image');
          else await jumpToAnnotation(documentPath);
        }
        while (performance.now() < deadline) {
          if (revision !== revealRevision) return true;
          sync(); s = find(); if (s) break;
          await new Promise(resolve => setTimeout(resolve, 25));
        }
      }
      if (!s) { showStatus('アノテートの対象を開けませんでした', true); return true; }
      select(s);
      if (item.type === 'screenshot-source' && item.target_kind === 'none') return true;
      if (s.iframe) {
        const viewer = s.iframe.contentWindow;
        while (performance.now() < deadline) {
          if (revision !== revealRevision || !s.host.isConnected) return true;
          // 開いた直後のビューワーは読み込み中の文書（別origin扱い）の間があり、参照すると例外になる。待って再試行する。
          try { if (viewer?.MeldexViewerHighlights?.reveal(item)) return true; }
          catch (error) { if (error?.name !== 'SecurityError') throw error; }
          await new Promise(resolve => setTimeout(resolve, 25));
        }
        showStatus('アノテートの位置が見つかりませんでした', true); return true;
      }
      if (item.type === 'highlight') {
        if (window.GBAnnotationHighlights?.reveal(s, item)) return true;
        await reload(s);
        if (!window.GBAnnotationHighlights?.reveal(s, item)) showStatus('ハイライトの位置が見つかりませんでした', true);
        return true;
      }
      const ref = item.target_ref || {}, cont = ref.container || {}, esc = CSS.escape;
      const line = ref.lineId || cont.id;
      let target = s.host.querySelector(`[data-ann-id="${esc(String(item.id || ''))}"],[data-cmt-id="${esc(String(item.id || ''))}"]`);
      if (!target && line) target = s.host.querySelector(`._nl-id[data-line-id="${esc(line)}"]`)?.parentElement || s.host.querySelector(`.sn2-row[data-row-id="${esc(line)}"]`);
      if (!target && (ref.entryId || cont.entryId)) target = s.host.querySelector(`tr[data-entity-name="${esc(ref.entryId || cont.entryId)}"] td[data-prop-name="${esc(ref.colId || cont.colId || '')}"]`);
      if (!target && (ref.cardId || cont.kind === 'board_card')) target = s.host.querySelector(`.bd-node[data-card-id="${esc(ref.cardId || cont.id)}"]`);
      const center = typeof _rpAnnotationCenter === 'function' ? _rpAnnotationCenter(item) : null;
      const sc = s.bridge?.options?.scrollContainer || s.host;
      if (center) {
        sc.scrollTo({ top: Math.max(0, center.y - sc.clientHeight / 2), left: Math.max(0, center.x - sc.clientWidth / 2), behavior: 'instant' });
        if (target) { const previous = target.style.filter; target.style.filter = 'drop-shadow(0 0 4px var(--accent))'; setTimeout(() => { target.style.filter = previous; }, 1200); }
        return true;
      }
      if (target && typeof _flashRpCommentTarget === 'function') { _flashRpCommentTarget(target); return true; }
      return item.target_kind === 'none';
    },
    reloadTarget(path) { return Promise.all([...surfaces.values()]
      .filter(s => !path || samePath(s.path, path)
        || s.iframe?.contentWindow?.MeldexViewerAnnotationScene?.findSceneByPath?.(path)).map(reload)); },
    describe: () => [...surfaces.values()].map(s => ({ id: s.id, path: s.path, type: s.type, embedded: !!s.iframe, host: s.host.id })),
    historyScope: (surface = selected) => surface ? scope(surface) : '',
    target: () => selected,
    historyScopeFor: (direction, surface = selected) => surface ? activeScope(surface, direction === 'redo' ? 'redo' : 'undo') : '',
    documentHistoryScope: (surface = selected) => surface ? documentScope(surface) : '',
    undo: () => navigateHistory('undo'),
    redo: () => navigateHistory('redo'),
  };
})();

/* 描いた後の色の変更。共通カラーパレットを開き、選んでいる間は見た目だけ変え、閉じた時に1回保存して
   元に戻す／やり直し・ヒストリーへ1件残す。以前のマーカーと塗りは、この時に色の不透明度で描く形へ移す。 */
window.GBAnnotationRecolor = (() => {
  // ハイライトの追加と同じ履歴の置き場（アノテートツールを開いている時はその画面、閉じている時は開いている本文）
  const currentScope = () => {
    if (window.GBAnnotationSurfaces?.usesHistory?.()) return window.GBAnnotationSurfaces.historyScope();
    return window.GBEditorHost?.get()?.historyScope?.() ?? (typeof _historyActiveScope !== 'undefined' ? _historyActiveScope : '');
  };
  const anchorAt = (x, y) => ({ getBoundingClientRect: () => ({ left: x, right: x, top: y, bottom: y, width: 0, height: 0, x, y }) });
  async function open({ id, targetPath, scope = currentScope(), anchor, preview, refresh, label = 'アノテート: 色' }) {
    let before = null;
    try { before = await _fetchAnnotationHistoryRow(id); } catch {}
    if (!before) { showStatus('アノテートが見つかりません', true); return false; }
    if (typeof openColorPalette !== 'function') return false;
    const initial = _annotationRecolorInitialColor(before);
    let picked = '';
    return new Promise(resolve => {
      openColorPalette(anchor, initial, color => {
        if (!color || color === 'transparent') return;
        picked = color;
        preview?.({ ...before, ..._annotationRecolorUpdate(before, color) });
      }, { allowTransparent: false, onClose: async () => {
        if (!picked || picked === initial) { refresh?.(); resolve(false); return; }
        const path = targetPath || before.target_path;
        const reservation = typeof historyReserve === 'function' ? historyReserve(label, scope, path) : null;
        try {
          const update = _annotationRecolorUpdate(before, picked);
          const result = await apiPut('/annotations/' + encodeURIComponent(id), { ...update, expected_modified: before.modified });
          const modified = result?.modified || before.modified;
          const after = { ...before, ...update, modified, modified_at: modified };
          if (reservation) reservation.capture(() => _pushAnnotationHistory(label, before, after, path, scope));
          else _pushAnnotationHistory(label, before, after, path, scope);
          resolve(true);
        } catch (error) {
          reservation?.cancel();
          showStatus('アノテートの色を保存できませんでした: ' + (error?.message || error), true);
          resolve(false);
        } finally {
          refresh?.();
          if (typeof loadRpAnnotationList === 'function') void loadRpAnnotationList();
        }
      } });
    });
  }
  return { open, anchorAt, currentScope };
})();
