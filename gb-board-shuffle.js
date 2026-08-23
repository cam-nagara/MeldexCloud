/* Deterministic, coordinate-only KJ shuffle planner for BoardView topics. */
(function initMeldexBoardShuffle(global) {
  'use strict';

  function clone(value) {
    if (Array.isArray(value)) return value.map(clone);
    if (!value || typeof value !== 'object') return value;
    const result = {};
    Object.keys(value).forEach((key) => { result[key] = clone(value[key]); });
    return result;
  }

  function refKey(value) {
    const ref = value?.topicRef || value;
    return JSON.stringify([String(ref?.sourceId || ''), String(ref?.topicId || '')]);
  }

  function seedNumber(value) {
    const text = String(value ?? 'meldex-board-shuffle');
    let hash = 2166136261;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index); hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0 || 0x9e3779b9;
  }

  function randomFactory(seed) {
    let state = seedNumber(seed);
    return () => {
      state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
      return (state >>> 0) / 4294967296;
    };
  }

  function boundsOf(items, padding) {
    if (!items.length) return { x: 0, y: 0, width: 800, height: 600 };
    const left = Math.min(...items.map((item) => Number(item.x) || 0));
    const top = Math.min(...items.map((item) => Number(item.y) || 0));
    const right = Math.max(...items.map((item) => (Number(item.x) || 0) + (Number(item.w) || 160)));
    const bottom = Math.max(...items.map((item) => (Number(item.y) || 0) + (Number(item.h) || 80)));
    return { x: left - padding, y: top - padding,
      width: right - left + padding * 2, height: bottom - top + padding * 2 };
  }

  function intersects(first, second, gap) {
    return first.x < second.x + second.w + gap && first.x + first.w + gap > second.x
      && first.y < second.y + second.h + gap && first.y + first.h + gap > second.y;
  }

  function targetItems(items, selectedKeys) {
    const eligible = items.filter((item) => item.editable !== false && !item.locked && !item.hidden);
    const selected = eligible.filter((item) => selectedKeys.has(refKey(item)));
    return selected.length >= 2 ? selected : eligible.filter((item) => item.visible !== false);
  }

  function candidate(item, area, random) {
    const maxX = Math.max(0, area.width - item.w);
    const maxY = Math.max(0, area.height - item.h);
    return {
      x: area.x + Math.round(random() * maxX),
      y: area.y + Math.round(random() * maxY),
      w: item.w,
      h: item.h,
    };
  }

  function expandArea(area, item, gap) {
    const result = { ...area };
    if (result.width <= result.height) result.width += item.w + gap;
    else result.height += item.h + gap;
    return result;
  }

  function placeItems(targets, obstacles, initialArea, random, gap) {
    let area = { ...initialArea };
    const occupied = obstacles.map((item) => ({ x: item.x, y: item.y, w: item.w, h: item.h }));
    const positions = new Map();
    const sorted = [...targets].sort((a, b) => (b.w * b.h) - (a.w * a.h) || refKey(a).localeCompare(refKey(b)));
    sorted.forEach((item) => {
      let placed = null;
      while (!placed) {
        for (let attempt = 0; attempt < 160; attempt += 1) {
          const next = candidate(item, area, random);
          if (!occupied.some((other) => intersects(next, other, gap))) { placed = next; break; }
        }
        if (!placed) area = expandArea(area, item, gap);
      }
      occupied.push(placed);
      positions.set(refKey(item), { x: placed.x, y: placed.y });
    });
    return { positions, area };
  }

  function normalizeItems(values) {
    return (Array.isArray(values) ? values : []).map((value) => ({
      ...clone(value),
      w: Math.max(1, Number(value.w) || 160),
      h: Math.max(1, Number(value.h) || 80),
      x: Number(value.x) || 0,
      y: Number(value.y) || 0,
    }));
  }

  function planShuffle(options) {
    const settings = options || {};
    const items = normalizeItems(settings.items);
    const selected = new Set((settings.selectedTopicRefs || []).map(refKey));
    const targets = targetItems(items, selected);
    if (targets.length < 2) return { changed: false, seed: settings.seed, items, movedTopicRefs: [] };
    const targetKeys = new Set(targets.map(refKey));
    const obstacles = items.filter((item) => !targetKeys.has(refKey(item)) && !item.hidden);
    const padding = Math.max(0, Number(settings.padding) || 24);
    const gap = Math.max(0, Number(settings.gap) || 16);
    const initialArea = clone(settings.area || boundsOf(targets, padding));
    const seed = settings.seed ?? `shuffle-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const placement = placeItems(targets, obstacles, initialArea, randomFactory(seed), gap);
    const output = items.map((item) => {
      const position = placement.positions.get(refKey(item));
      return position ? { ...item, x: position.x, y: position.y } : item;
    });
    return {
      changed: true,
      seed,
      before: items,
      items: output,
      movedTopicRefs: targets.map((item) => clone(item.topicRef)),
      initialArea,
      expandedArea: placement.area,
    };
  }

  function applyToBoardView(boardView, plan) {
    if (!plan?.changed) return clone(boardView);
    const result = clone(boardView || {});
    result.positionsByTopicRef = clone(result.positionsByTopicRef || {});
    plan.items.forEach((item) => {
      const key = refKey(item);
      const current = result.positionsByTopicRef[key];
      if (current && plan.movedTopicRefs.some((ref) => refKey(ref) === key)) {
        result.positionsByTopicRef[key] = { ...current, x: item.x, y: item.y };
      }
    });
    result.lastShuffleSeed = plan.seed;
    return result;
  }

  function undoRecord(plan) {
    if (!plan?.changed) return null;
    const pick = (items) => Object.fromEntries(items.map((item) => [refKey(item), { x: item.x, y: item.y }]));
    return { seed: plan.seed, before: pick(plan.before), after: pick(plan.items) };
  }

  function applyUndoRecord(boardView, record, direction) {
    const result = clone(boardView || {});
    const positions = direction === 'redo' ? record.after : record.before;
    result.positionsByTopicRef = clone(result.positionsByTopicRef || {});
    Object.entries(positions || {}).forEach(([key, point]) => {
      if (result.positionsByTopicRef[key]) result.positionsByTopicRef[key] = {
        ...result.positionsByTopicRef[key], x: point.x, y: point.y,
      };
    });
    result.lastShuffleSeed = record.seed;
    return result;
  }

  function attachShuffleAction(container, onShuffle) {
    if (!container?.appendChild || typeof onShuffle !== 'function') return null;
    const button = document.createElement('button'); button.type = 'button';
    button.textContent = 'シャッフル'; button.className = 'bd-board-shuffle-action bd-topic-view-wide-action';
    button.dataset.bdTopicViewAction = 'shuffle';
    button.dataset.bdAction = 'topic-view-shuffle';
    button.setAttribute('aria-label', 'トピックを重ならないようにシャッフル');
    button.addEventListener('click', () => onShuffle()); container.appendChild(button);
    const overflow = container.querySelector?.('.bd-topic-view-overflow-menu');
    if (overflow) {
      const compact = button.cloneNode(true); compact.className = 'bd-board-shuffle-overflow-action';
      compact.dataset.bdTopicViewAction = 'shuffle-compact';
      compact.dataset.bdAction = 'topic-view-shuffle-compact';
      compact.addEventListener('click', () => onShuffle()); overflow.appendChild(compact);
    }
    return button;
  }

  global.MeldexBoardShuffle = Object.freeze({
    refKey, planShuffle, applyToBoardView, undoRecord, applyUndoRecord, attachShuffleAction,
  });
}(typeof globalThis !== 'undefined' ? globalThis : window));
