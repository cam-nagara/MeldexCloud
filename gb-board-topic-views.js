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

  function normalizeDocument(document, idFactory) {
    const result = clone(document || {});
    result.boardViews = Array.isArray(result.boardViews) ? result.boardViews : [];
    result.relationSets = Array.isArray(result.relationSets) ? result.relationSets : [];
    if (!result.boardViews.length) {
      const makeId = idFactory || (() => defaultIdFactory('board-view'));
      result.boardViews.push(newView(makeId('board-view'), '既定ビュー'));
    }
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
    return result;
  }

  function addView(document, options) {
    const settings = options || {};
    const makeId = settings.idFactory || (() => defaultIdFactory('board-view'));
    const result = normalizeDocument(document, makeId);
    const view = newView(makeId('board-view'), settings.name || `ビュー ${result.boardViews.length + 1}`);
    result.boardViews.push(view);
    return { document: result, activeBoardViewId: view.boardViewId, boardView: clone(view) };
  }

  function renameView(document, boardViewId, name) {
    const result = normalizeDocument(document);
    const view = result.boardViews.find((item) => idOf(item) === boardViewId);
    if (!view) throw new RangeError('BoardView was not found');
    const nextName = String(name || '').trim();
    if (!nextName) throw new TypeError('BoardView name is required');
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
    if (result.boardViews.length === 1) throw new Error('少なくとも1件のボードビューが必要です');
    const index = result.boardViews.findIndex((item) => idOf(item) === boardViewId);
    if (index < 0) throw new RangeError('BoardView was not found');
    const [removed] = result.boardViews.splice(index, 1);
    const active = activeBoardViewId === boardViewId
      ? result.boardViews[Math.min(index, result.boardViews.length - 1)].boardViewId
      : activeBoardViewId;
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
    duplicate.name = settings.name || `${source.name} のコピー`;
    if (source.relationSetId && settings.shareRelationSet !== true) {
      const relationId = makeId('relation-set');
      const relation = copyRelationSet(result, source.relationSetId, relationId);
      if (relation) duplicate.relationSetId = relation.relationSetId;
    }
    result.boardViews.splice(index + 1, 0, duplicate);
    return { document: result, activeBoardViewId: duplicate.boardViewId, boardView: clone(duplicate) };
  }

  function createController(options) {
    const settings = options || {};
    if (typeof settings.getDocument !== 'function' || typeof settings.setDocument !== 'function') {
      throw new TypeError('getDocument and setDocument are required');
    }
    const commit = (label, operation) => {
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
    root.className = 'bd-topic-view-controls';
    root.dataset.bdTopicViewControls = '1';
    const select = document.createElement('select');
    select.setAttribute('aria-label', 'ボードビュー');
    select.dataset.bdTopicViewControl = 'view-select';
    select.dataset.bdAction = 'topic-view-select';
    const refresh = () => {
      const doc = normalizeDocument(settings.getDocument());
      select.replaceChildren(...doc.boardViews.map((view) => {
        const option = document.createElement('option');
        option.value = view.boardViewId; option.textContent = view.name;
        option.selected = view.boardViewId === settings.getActiveBoardViewId();
        return option;
      }));
    };
    select.addEventListener('change', () => settings.setActiveBoardViewId(select.value));
    root.appendChild(select);
    const actions = [['add', '＋', '追加', () => controller.add()],
      ['duplicate', '複製', '複製', () => controller.duplicate(select.value)],
      ['delete', '削除', '削除', () => controller.remove(select.value, select.value)]];
    actions.forEach(([actionId, text, label, run]) => {
      const button = document.createElement('button');
      button.type = 'button'; button.textContent = text; button.setAttribute('aria-label', label);
      button.dataset.bdTopicViewAction = actionId;
      button.dataset.bdAction = `topic-view-${actionId}`;
      button.className = text === '＋' ? '' : 'bd-topic-view-wide-action';
      button.addEventListener('click', () => { run(); refresh(); }); root.appendChild(button);
    });
    const overflow = document.createElement('details'); overflow.className = 'bd-topic-view-overflow';
    const summary = document.createElement('summary'); summary.textContent = '•••';
    summary.setAttribute('aria-label', 'ボードビュー操作'); overflow.appendChild(summary);
    const menu = document.createElement('div'); menu.className = 'bd-topic-view-overflow-menu';
    actions.slice(1).forEach(([actionId, text, label, run]) => {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = text;
      button.dataset.bdTopicViewAction = `${actionId}-compact`;
      button.dataset.bdAction = `topic-view-${actionId}-compact`;
      button.setAttribute('aria-label', label); button.addEventListener('click', () => {
        run(); overflow.open = false; refresh();
      }); menu.appendChild(button);
    });
    overflow.appendChild(menu); root.appendChild(overflow);
    refresh(); container.appendChild(root);
    return { root, refresh };
  }

  global.MeldexBoardTopicViews = Object.freeze({
    normalizeDocument, addView, renameView, reorderView, removeView, duplicateView,
    captureViewState, applyViewState, createController, attachToolbar,
  });
}(typeof globalThis !== 'undefined' ? globalThis : window));
