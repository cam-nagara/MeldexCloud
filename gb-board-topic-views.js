/* Multiple BoardView state, history, and lightweight toolbar controls. */
(function initMeldexBoardTopicViews(global) {
  'use strict';

  function clone(value) {
    if (Array.isArray(value)) return value.map(clone);
    if (!value || typeof value !== 'object') return value;
    const result = {};
    Object.keys(value).forEach((key) => { result[key] = clone(value[key]); });
    return result;
  }

  function idOf(view) {
    return String(view?.boardViewId || view?.viewId || '');
  }

  function defaultIdFactory(prefix) {
    if (global.crypto?.randomUUID) return `${prefix}-${global.crypto.randomUUID()}`;
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
  }

  function newView(viewId, name) {
    return {
      boardViewId: viewId,
      name: name || 'ボードビュー',
      relationSetId: null,
      positionsByTopicRef: {},
      groups: [],
      lines: [],
      hiddenTopicRefs: [],
      collapsedTopicRefs: [],
      styleOverrides: {},
      camera: { pan: { x: 0, y: 0 }, zoom: 1, rotation: 0 },
    };
  }

  function uniqueViewName(document, requested, excludeViewId) {
    const base = String(requested || 'ボードビュー').trim() || 'ボードビュー';
    const used = new Set((document.boardViews || [])
      .filter(view => idOf(view) !== excludeViewId)
      .map(view => String(view.name || '').trim()));
    if (!used.has(base)) return base;
    let index = 2;
    while (used.has(`${base} ${index}`)) index += 1;
    return `${base} ${index}`;
  }

  function normalizeDocument(document, idFactory) {
    const result = clone(document || {});
    result.boardViews = Array.isArray(result.boardViews) ? result.boardViews : [];
    result.sheetViews = Array.isArray(result.sheetViews) ? result.sheetViews : [];
    result.relationSets = Array.isArray(result.relationSets) ? result.relationSets : [];
    result.boardViews = result.boardViews.map((view, index) => {
      const next = clone(view || {});
      next.boardViewId = idOf(next) || `board-view-${index + 1}`;
      next.name = String(next.name || (index ? `ビュー ${index + 1}` : '既定ビュー'));
      ['groups', 'lines', 'hiddenTopicRefs', 'collapsedTopicRefs'].forEach((key) => {
        if (!Array.isArray(next[key])) next[key] = [];
      });
      if (!next.positionsByTopicRef || typeof next.positionsByTopicRef !== 'object') {
        next.positionsByTopicRef = {};
      }
      return next;
    });
    result.sheetViews = result.sheetViews.map((view, index) => {
      const next = clone(view || {});
      next.viewId = String(next.viewId || next.sheetViewId || `sheet-view-${index + 1}`);
      next.name = String(next.name || (index ? `シート ${index + 1}` : 'テーブル'));
      next.viewMode = String(next.viewMode || 'pivot');
      if (!Array.isArray(next.columns)) next.columns = [];
      return next;
    });
    const available = new Map([
      ...result.sheetViews.map(view => [`sheet:${view.viewId}`, { surface: 'sheet', viewId: view.viewId }]),
      ...result.boardViews.map(view => [`board:${view.boardViewId}`, { surface: 'board', viewId: view.boardViewId }]),
    ]);
    const seen = new Set();
    result.viewOrder = (Array.isArray(result.viewOrder) ? result.viewOrder : []).flatMap(ref => {
      const key = `${ref?.surface}:${String(ref?.viewId || '')}`;
      if (seen.has(key) || !available.has(key)) return [];
      seen.add(key); return [clone(available.get(key))];
    });
    available.forEach((ref, key) => { if (!seen.has(key)) result.viewOrder.push(clone(ref)); });
    const active = result.viewOrder.find(ref => ref.surface === result.activeViewRef?.surface
      && ref.viewId === String(result.activeViewRef?.viewId || ''))
      || result.viewOrder.find(ref => ref.surface === 'board' && ref.viewId === result.activeBoardViewId)
      || result.viewOrder[0] || null;
    result.activeViewRef = active ? clone(active) : null;
    result.activeBoardViewId = active?.surface === 'board'
      ? active.viewId : (result.boardViews.some(view => view.boardViewId === result.activeBoardViewId) ? result.activeBoardViewId : result.boardViews[0]?.boardViewId || null);
    result.activeSheetViewId = active?.surface === 'sheet'
      ? active.viewId : (result.sheetViews.some(view => view.viewId === result.activeSheetViewId) ? result.activeSheetViewId : result.sheetViews[0]?.viewId || null);
    return result;
  }

  function orderedViews(document) {
    const result = normalizeDocument(document);
    return result.viewOrder.map(ref => {
      const view = ref.surface === 'board'
        ? result.boardViews.find(item => item.boardViewId === ref.viewId)
        : result.sheetViews.find(item => item.viewId === ref.viewId);
      return view ? { ...clone(ref), view: clone(view), name: view.name, viewMode: view.viewMode || ref.surface } : null;
    }).filter(Boolean);
  }

  function addView(document, options) {
    const settings = options || {};
    const makeId = settings.idFactory || (() => defaultIdFactory('board-view'));
    const result = normalizeDocument(document, makeId);
    const view = newView(makeId('board-view'), uniqueViewName(
      result, settings.name || `ビュー ${result.boardViews.length + 1}`,
    ));
    result.boardViews.push(view);
    result.viewOrder.push({ surface: 'board', viewId: view.boardViewId });
    result.activeViewRef = { surface: 'board', viewId: view.boardViewId };
    result.activeBoardViewId = view.boardViewId;
    return { document: result, activeBoardViewId: view.boardViewId, boardView: clone(view) };
  }

  function addSheetView(document, options) {
    const settings = options || {};
    const makeId = settings.idFactory || (() => defaultIdFactory('sheet-view'));
    const result = normalizeDocument(document, makeId);
    const id = makeId('sheet-view');
    const baseName = String(settings.name || (settings.viewMode === 'tree' ? 'ツリー' : 'テーブル'));
    const used = new Set(result.sheetViews.map(view => view.name));
    let name = baseName; let suffix = 2;
    while (used.has(name)) { name = `${baseName} ${suffix}`; suffix += 1; }
    const view = { viewId: id, name, viewMode: settings.viewMode || 'pivot', columns: clone(settings.columns || []) };
    result.sheetViews.push(view);
    result.viewOrder.push({ surface: 'sheet', viewId: id });
    result.activeSheetViewId = id; result.activeViewRef = { surface: 'sheet', viewId: id };
    return { document: result, activeViewRef: clone(result.activeViewRef), sheetView: clone(view) };
  }

  function findMixedView(document, ref) {
    const result = normalizeDocument(document);
    const id = String(ref?.viewId || '');
    const list = ref?.surface === 'board' ? result.boardViews : result.sheetViews;
    const view = list.find(item => (ref?.surface === 'board' ? item.boardViewId : item.viewId) === id);
    return { document: result, view, list };
  }

  function renameMixedView(document, ref, name) {
    const { document: result, view, list } = findMixedView(document, ref);
    if (!view) throw new RangeError('View was not found');
    const nextName = String(name || '').trim();
    if (!nextName) throw new TypeError('View name is required');
    if (list.some(item => item !== view && String(item.name || '').trim() === nextName)) throw new Error('同じ名前のビューがあります');
    view.name = nextName; return result;
  }

  function reorderMixedView(document, ref, toIndex) {
    const result = normalizeDocument(document);
    const from = result.viewOrder.findIndex(item => item.surface === ref?.surface && item.viewId === String(ref?.viewId || ''));
    if (from < 0 || !Number.isInteger(toIndex) || toIndex < 0 || toIndex >= result.viewOrder.length) throw new RangeError('View reorder index is invalid');
    const [item] = result.viewOrder.splice(from, 1); result.viewOrder.splice(toIndex, 0, item); return result;
  }

  function removeMixedView(document, ref) {
    const result = normalizeDocument(document);
    const id = String(ref?.viewId || '');
    const orderIndex = result.viewOrder.findIndex(item => item.surface === ref?.surface && item.viewId === id);
    if (orderIndex < 0) throw new RangeError('View was not found');
    if (ref.surface === 'board') result.boardViews = result.boardViews.filter(view => view.boardViewId !== id);
    else result.sheetViews = result.sheetViews.filter(view => view.viewId !== id);
    const [removedRef] = result.viewOrder.splice(orderIndex, 1);
    const activeViewRef = result.activeViewRef?.surface === ref.surface && result.activeViewRef?.viewId === id
      ? clone(result.viewOrder[Math.min(orderIndex, result.viewOrder.length - 1)] || null) : clone(result.activeViewRef);
    result.activeViewRef = activeViewRef;
    if (ref.surface === 'board' && result.activeBoardViewId === id) result.activeBoardViewId = result.boardViews[0]?.boardViewId || null;
    if (ref.surface === 'sheet' && result.activeSheetViewId === id) result.activeSheetViewId = result.sheetViews[0]?.viewId || null;
    return { document: result, activeViewRef, removedViewRef: removedRef };
  }

  function duplicateMixedView(document, ref, options) {
    const settings = options || {};
    if (ref?.surface === 'board') {
      const duplicated = duplicateView(document, ref.viewId, settings);
      duplicated.document.viewOrder = normalizeDocument(duplicated.document).viewOrder;
      const sourceIndex = duplicated.document.viewOrder.findIndex(item => item.surface === 'board' && item.viewId === ref.viewId);
      duplicated.document.viewOrder = duplicated.document.viewOrder.filter(item => item.surface !== 'board' || item.viewId !== duplicated.activeBoardViewId);
      duplicated.document.viewOrder.splice(sourceIndex + 1, 0, { surface: 'board', viewId: duplicated.activeBoardViewId });
      duplicated.document.activeViewRef = { surface: 'board', viewId: duplicated.activeBoardViewId };
      return { ...duplicated, activeViewRef: clone(duplicated.document.activeViewRef) };
    }
    const { document: result, view } = findMixedView(document, ref);
    if (!view) throw new RangeError('View was not found');
    const makeId = settings.idFactory || (() => defaultIdFactory('sheet-view'));
    const duplicate = { ...clone(view), viewId: makeId('sheet-view'), name: `${view.name} のコピー` };
    result.sheetViews.push(duplicate);
    const sourceIndex = result.viewOrder.findIndex(item => item.surface === 'sheet' && item.viewId === ref.viewId);
    result.viewOrder.splice(sourceIndex + 1, 0, { surface: 'sheet', viewId: duplicate.viewId });
    result.activeSheetViewId = duplicate.viewId; result.activeViewRef = { surface: 'sheet', viewId: duplicate.viewId };
    return { document: result, activeViewRef: clone(result.activeViewRef), sheetView: clone(duplicate) };
  }

  function renameView(document, boardViewId, name) {
    const result = normalizeDocument(document);
    const view = result.boardViews.find((item) => idOf(item) === boardViewId);
    if (!view) throw new RangeError('BoardView was not found');
    const nextName = String(name || '').trim();
    if (!nextName) throw new TypeError('BoardView name is required');
    if (result.boardViews.some(item => idOf(item) !== boardViewId
      && String(item.name || '').trim() === nextName)) {
      throw new TypeError('同じ名前のボードビューがあります');
    }
    view.name = nextName;
    return result;
  }

  function reorderView(document, boardViewId, toIndex) {
    const result = normalizeDocument(document);
    const fromIndex = result.boardViews.findIndex((item) => idOf(item) === boardViewId);
    if (fromIndex < 0) throw new RangeError('BoardView was not found');
    if (!Number.isInteger(toIndex) || toIndex < 0 || toIndex >= result.boardViews.length) {
      throw new RangeError('BoardView reorder index is invalid');
    }
    const [view] = result.boardViews.splice(fromIndex, 1);
    result.boardViews.splice(toIndex, 0, view);
    return result;
  }

  function removeView(document, boardViewId, activeBoardViewId) {
    const result = normalizeDocument(document);
    const index = result.boardViews.findIndex((item) => idOf(item) === boardViewId);
    if (index < 0) throw new RangeError('BoardView was not found');
    const currentActiveBoardViewId = activeBoardViewId === undefined
      ? result.activeBoardViewId
      : activeBoardViewId;
    const [removed] = result.boardViews.splice(index, 1);
    result.viewOrder = result.viewOrder.filter(ref => ref.surface !== 'board' || ref.viewId !== boardViewId);
    const active = currentActiveBoardViewId === boardViewId
      ? result.boardViews[Math.min(index, result.boardViews.length - 1)]?.boardViewId || null
      : currentActiveBoardViewId;
    result.activeBoardViewId = active;
    if (result.activeViewRef?.surface === 'board' && result.activeViewRef.viewId === boardViewId) {
      result.activeViewRef = result.viewOrder[Math.min(index, result.viewOrder.length - 1)] || null;
    }
    return { document: result, activeBoardViewId: active, removedBoardView: removed };
  }

  function copyRelationSet(document, relationSetId, newId) {
    const source = document.relationSets.find((item) => item?.relationSetId === relationSetId);
    if (!source) return null;
    const relation = clone(source);
    relation.relationSetId = newId;
    relation.name = `${source.name || '構造'} のコピー`;
    relation.revision = 0;
    document.relationSets.push(relation);
    return relation;
  }

  function duplicateView(document, boardViewId, options) {
    const settings = options || {};
    const makeId = settings.idFactory || ((prefix) => defaultIdFactory(prefix));
    const result = normalizeDocument(document, makeId);
    const index = result.boardViews.findIndex((item) => idOf(item) === boardViewId);
    if (index < 0) throw new RangeError('BoardView was not found');
    const source = result.boardViews[index];
    const duplicate = clone(source);
    duplicate.boardViewId = makeId('board-view');
    duplicate.name = uniqueViewName(result, settings.name || `${source.name} のコピー`, duplicate.boardViewId);
    if (source.relationSetId && settings.shareRelationSet !== true) {
      const relationId = makeId('relation-set');
      const relation = copyRelationSet(result, source.relationSetId, relationId);
      if (relation) duplicate.relationSetId = relation.relationSetId;
    }
    result.boardViews.splice(index + 1, 0, duplicate);
    result.viewOrder.push({ surface: 'board', viewId: duplicate.boardViewId });
    result.activeViewRef = { surface: 'board', viewId: duplicate.boardViewId };
    return { document: result, activeBoardViewId: duplicate.boardViewId, boardView: clone(duplicate) };
  }

  function createController(options) {
    const settings = options || {};
    if (typeof settings.getDocument !== 'function' || typeof settings.setDocument !== 'function') {
      throw new TypeError('getDocument and setDocument are required');
    }
    const commit = (label, operation) => {
      if (settings.readOnly === true) return { ok: false, reason: 'read-only' };
      const before = clone(settings.getDocument());
      const result = operation(before);
      const next = result?.document || result;
      if (typeof settings.pushUndo === 'function') settings.pushUndo(label, before, clone(next));
      settings.setDocument(next);
      if (typeof settings.onChange === 'function') settings.onChange(clone(next), result);
      return result;
    };
    return Object.freeze({
      add: (value) => commit('ボードビューを追加', (doc) => addView(doc, value)),
      rename: (id, name) => commit('ボードビュー名を変更', (doc) => renameView(doc, id, name)),
      reorder: (id, index) => commit('ボードビューを並べ替え', (doc) => reorderView(doc, id, index)),
      remove: (id, activeId) => commit('ボードビューを削除', (doc) => removeView(doc, id, activeId)),
      duplicate: (id, value) => commit('ボードビューを複製', (doc) => duplicateView(doc, id, value)),
      addSheet: (value) => commit('シートビューを追加', (doc) => addSheetView(doc, value)),
      renameMixed: (ref, name) => commit('ビュー名を変更', (doc) => renameMixedView(doc, ref, name)),
      reorderMixed: (ref, index) => commit('ビューを並べ替え', (doc) => reorderMixedView(doc, ref, index)),
      removeMixed: (ref) => commit('ビューを削除', (doc) => removeMixedView(doc, ref)),
      duplicateMixed: (ref, value) => commit('ビューを複製', (doc) => duplicateMixedView(doc, ref, value)),
    });
  }

  function topicRefKey(value) {
    const ref = value?.topicRef || value;
    return JSON.stringify([String(ref?.sourceId || ''), String(ref?.topicId || '')]);
  }

  function captureViewState(boardView, runtimeState) {
    const result = clone(boardView || newView('board-view-1', '既定ビュー'));
    result.positionsByTopicRef = clone(result.positionsByTopicRef || {});
    (Array.isArray(runtimeState?.nodes) ? runtimeState.nodes : []).forEach((node) => {
      if (!node?.topicRef) return;
      const key = topicRefKey(node.topicRef);
      const previous = result.positionsByTopicRef[key] || { topicRef: clone(node.topicRef) };
      result.positionsByTopicRef[key] = {
        ...previous, topicRef: clone(node.topicRef),
        x: Number(node.x) || 0, y: Number(node.y) || 0,
        w: Number.isFinite(+node.w) ? +node.w : 160,
        h: Number.isFinite(+node.h) ? +node.h : 0,
      };
    });
    ['groups', 'lines', 'hiddenTopicRefs', 'collapsedTopicRefs', 'styleOverrides', 'camera']
      .forEach((key) => {
        if (runtimeState && Object.prototype.hasOwnProperty.call(runtimeState, key)) {
          result[key] = clone(runtimeState[key]);
        }
      });
    return result;
  }

  function applyViewState(boardView, runtimeState) {
    const view = clone(boardView || {});
    const result = clone(runtimeState || {});
    const positions = view.positionsByTopicRef || {};
    result.nodes = (Array.isArray(result.nodes) ? result.nodes : []).map((node) => {
      const position = node?.topicRef ? positions[topicRefKey(node.topicRef)] : null;
      if (!position) return node;
      const next = { ...node, x: position.x, y: position.y };
      if (Number.isFinite(+position.w)) next.w = +position.w;
      if (Number.isFinite(+position.h)) next.h = +position.h;
      return next;
    });
    ['groups', 'lines', 'hiddenTopicRefs', 'collapsedTopicRefs', 'styleOverrides', 'camera']
      .forEach((key) => { result[key] = clone(view[key] ?? result[key]); });
    result.activeBoardViewId = idOf(view);
    return result;
  }

  function attachToolbar(container, controller, options) {
    if (!container?.appendChild || !controller) return null;
    const settings = options || {};
    const root = document.createElement('div');
    root.className = 'bd-topic-view-controls db-view-switcher db-main-view-switcher';
    root.dataset.bdTopicViewControls = '1';
    root.dataset.e2eId = 'board-common-view-tabs';
    root.setAttribute('aria-label', 'シートとボードのビュー');
    const tabs = document.createElement('div');
    tabs.className = 'view-tabs db-view-tabs bd-common-view-tabs';
    tabs.setAttribute('role', 'tablist');
    tabs.setAttribute('aria-label', 'シートとボードのビュー');
    const select = document.createElement('select');
    select.className = 'tb-select db-view-select';
    select.dataset.e2eId = 'board-common-view-select';
    select.setAttribute('aria-label', 'ビュー切替');
    select.title = 'ビュー切替';
    root.appendChild(tabs);
    root.appendChild(select);
    const activeRef = () => {
      const doc = normalizeDocument(settings.getDocument());
      return settings.getActiveViewRef?.() || doc.activeViewRef
        || (settings.getActiveBoardViewId?.() ? { surface: 'board', viewId: settings.getActiveBoardViewId() } : null);
    };
    const activate = (ref) => {
      if (settings.setActiveViewRef) settings.setActiveViewRef(clone(ref));
      else if (ref.surface === 'board') settings.setActiveBoardViewId?.(ref.viewId);
    };
    const iconHtml = (surface, viewMode) => {
      const icons = {
        board: 'presentation', pivot: 'table', tree: 'listTree', gallery: 'layoutGrid',
        kanban: 'columns', calendar: 'calendar', timeline: 'clock', gantt: 'ganttChart', chart: 'barChart2',
        graph: 'gitBranch', form: 'clipboardList',
      };
      const icon = surface === 'board' ? icons.board : (icons[viewMode] || icons.pivot);
      return typeof global.lucide === 'function' ? global.lucide(icon, 12) : '';
    };
    const beginRename = (tab, ref, name) => {
      if (settings.readOnly) return;
      const input = document.createElement('input'); input.type = 'text'; input.value = name;
      input.className = 'bd-topic-view-rename-input'; input.setAttribute('aria-label', 'ビュー名');
      const finish = cancelled => {
        if (!input.isConnected) return;
        if (!cancelled && input.value.trim() && input.value.trim() !== name) {
          try { controller.renameMixed(ref, input.value.trim()); }
          catch (error) { global.showStatus?.(error?.message || 'ビュー名を変更できません', true); }
        }
        refresh();
      };
      input.addEventListener('keydown', event => {
        if (event.key === 'Enter') finish(false);
        else if (event.key === 'Escape') finish(true);
      });
      input.addEventListener('blur', () => finish(false));
      tab.replaceChildren(input); input.focus?.(); input.select?.();
    };
    const refresh = () => {
      const doc = normalizeDocument(settings.getDocument());
      const current = activeRef();
      tabs.replaceChildren();
      select.replaceChildren();
      const ordered = orderedViews(doc);
      if (!ordered.length) {
        const empty = document.createElement('span'); empty.className = 'bd-common-view-empty';
        empty.textContent = 'ビューがありません。＋から表示を追加してください'; tabs.appendChild(empty);
      }
      ordered.forEach((entry, index) => {
        const ref = { surface: entry.surface, viewId: entry.viewId };
        const refToken = `${ref.surface}-${String(ref.viewId).replace(/[^a-zA-Z0-9_-]+/g, '-')}`;
        const tab = document.createElement('div'); tab.className = 'view-tab bd-common-view-tab';
        tab.dataset.viewSurface = ref.surface; tab.dataset.viewId = ref.viewId;
        tab.dataset.e2eId = `board-common-view-tab-${refToken}`;
        tab.draggable = settings.readOnly !== true; tab.setAttribute('role', 'tab');
        const selected = current?.surface === ref.surface && current?.viewId === ref.viewId;
        tab.classList?.toggle?.('active', selected); tab.setAttribute('aria-selected', String(selected));
        const option = document.createElement('option'); option.value = String(index);
        option.textContent = String(entry.name || (ref.surface === 'board' ? 'ボード' : 'シート'));
        option.selected = selected; select.appendChild(option);
        const label = document.createElement('button'); label.type = 'button'; label.className = 'view-tab-label';
        label.dataset.e2eId = `board-common-view-label-${refToken}`;
        label.innerHTML = iconHtml(ref.surface, entry.viewMode);
        const labelText = document.createElement('span');
        labelText.textContent = String(entry.name || (ref.surface === 'board' ? 'ボード' : 'シート'));
        label.appendChild(labelText);
        label.disabled = false; label.addEventListener('click', () => activate(ref));
        label.addEventListener('dblclick', event => { event.preventDefault(); beginRename(tab, ref, entry.name); });
        const menu = document.createElement('details'); menu.className = 'bd-topic-view-overflow bd-common-view-menu';
        menu.dataset.e2eId = `board-common-view-menu-${refToken}`;
        const summary = document.createElement('summary'); summary.className = 'view-tab-more';
        summary.innerHTML = typeof global.lucide === 'function' ? global.lucide('moreHorizontal', 14) : '…';
        summary.dataset.e2eId = `board-common-view-menu-trigger-${refToken}`;
        summary.setAttribute('aria-label', `${entry.name}のビュー操作`); menu.appendChild(summary);
        const panel = document.createElement('div'); panel.className = 'bd-topic-view-overflow-menu'; menu.appendChild(panel);
        const action = (text, run, disabled, actionId, refreshAfter = true) => {
          const button = document.createElement('button'); button.type = 'button'; button.textContent = text;
          button.dataset.bdTopicViewMutation = actionId;
          button.dataset.e2eId = `board-common-view-${actionId}-${refToken}`;
          button.disabled = settings.readOnly === true || !!disabled;
          button.addEventListener('click', async () => {
            await run(); menu.open = false;
            if (refreshAfter) refresh();
          }); panel.appendChild(button);
        };
        action('名前変更', () => beginRename(tab, ref, entry.name), false, 'rename', false);
        action('複製', () => controller.duplicateMixed(ref), false, 'duplicate');
        action('左へ移動', () => controller.reorderMixed(ref, index - 1), index <= 0, 'previous');
        action('右へ移動', () => controller.reorderMixed(ref, index + 1), index >= ordered.length - 1, 'next');
        action('削除', async () => {
          const confirmed = typeof global.cfConfirm === 'function'
            ? await global.cfConfirm(`「${entry.name}」を削除します。トピック本体は残り、このビュー固有の配置・ライン・グループ・表示設定だけが削除されます。`)
            : false;
          if (confirmed) controller.removeMixed(ref);
        }, false, 'delete');
        let longPress = 0;
        label.addEventListener('contextmenu', event => { event.preventDefault(); menu.open = true; });
        label.addEventListener('pointerdown', () => { longPress = setTimeout(() => { menu.open = true; }, 550); });
        ['pointerup', 'pointercancel', 'pointerleave'].forEach(type => label.addEventListener(type, () => clearTimeout(longPress)));
        tab.addEventListener('dragstart', event => event.dataTransfer?.setData('text/meldex-view-ref', JSON.stringify(ref)));
        tab.addEventListener('dragover', event => { if (!settings.readOnly) event.preventDefault(); });
        tab.addEventListener('drop', event => {
          if (settings.readOnly) return; event.preventDefault();
          try { controller.reorderMixed(JSON.parse(event.dataTransfer?.getData('text/meldex-view-ref') || '{}'), index); }
          catch {} refresh();
        });
        tab.appendChild(label); tab.appendChild(menu); tabs.appendChild(tab);
      });
      const add = document.createElement('details'); add.className = 'bd-topic-view-overflow bd-common-view-add';
      add.dataset.e2eId = 'board-common-view-add-menu';
      const addSummary = document.createElement('summary'); addSummary.className = 'view-tab-add tb-icon-btn';
      addSummary.innerHTML = typeof global.lucide === 'function' ? global.lucide('plus', 16) : '＋';
      addSummary.dataset.e2eId = 'board-common-view-add-trigger';
      addSummary.setAttribute('aria-label', 'ビューを追加'); add.appendChild(addSummary);
      const addMenu = document.createElement('div'); addMenu.className = 'bd-topic-view-overflow-menu'; add.appendChild(addMenu);
      [['board', 'ボード', () => controller.add()], ['pivot', 'テーブル', () => controller.addSheet({ viewMode: 'pivot', name: 'テーブル' })],
        ['tree', 'ツリー', () => controller.addSheet({ viewMode: 'tree', name: 'ツリー' })]].forEach(([kind, text, run]) => {
        const button = document.createElement('button'); button.type = 'button'; button.disabled = settings.readOnly === true;
        button.dataset.bdTopicViewMutation = `add-${kind}`;
        button.dataset.e2eId = `board-common-view-add-${kind}`;
        button.dataset.viewKind = kind; button.innerHTML = `${iconHtml(kind === 'board' ? 'board' : 'sheet', kind)} ${text}`;
        button.addEventListener('click', () => { run(); add.open = false; refresh(); }); addMenu.appendChild(button);
      });
      tabs.appendChild(add);
    };
    select.addEventListener('change', () => {
      const entry = orderedViews(normalizeDocument(settings.getDocument()))[Number(select.value)];
      if (!entry) return;
      activate({ surface: entry.surface, viewId: entry.viewId });
    });
    refresh(); container.appendChild(root);
    return { root, refresh };
  }

  global.MeldexBoardTopicViews = Object.freeze({
    normalizeDocument, addView, renameView, reorderView, removeView, duplicateView,
    orderedViews, addSheetView, renameMixedView, reorderMixedView, removeMixedView, duplicateMixedView,
    captureViewState, applyViewState, createController, attachToolbar,
  });
}(typeof globalThis !== 'undefined' ? globalThis : window));
