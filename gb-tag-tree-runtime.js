/* 大規模タグ辞書の段階描画と、ソース単位の軽量な表示状態。 */
(function () {
  'use strict';

  const INITIAL_RENDER_LIMIT = 300;
  const RENDER_BATCH_SIZE = 300;
  const MAX_SCOPE_STATES = 6;
  const scopeStates = new Map();
  const metrics = [];

  function normalizedScopeKey(value) {
    return String(value || '__default__')
      .trim()
      .replace(/\\/g, '/')
      .replace(/\/+$/g, '')
      .toLocaleLowerCase('ja') || '__default__';
  }

  function scopeState(scopeKey) {
    const key = normalizedScopeKey(scopeKey);
    let state = scopeStates.get(key);
    if (!state) {
      state = {
        key,
        renderLimit: INITIAL_RENDER_LIMIT,
        lastUsedAt: Date.now(),
      };
      scopeStates.set(key, state);
    } else {
      state.lastUsedAt = Date.now();
      scopeStates.delete(key);
      scopeStates.set(key, state);
    }
    while (scopeStates.size > MAX_SCOPE_STATES) {
      scopeStates.delete(scopeStates.keys().next().value);
    }
    return state;
  }

  function resetRenderLimit(scopeKey) {
    const state = scopeState(scopeKey);
    state.renderLimit = INITIAL_RENDER_LIMIT;
    return state.renderLimit;
  }

  function increaseRenderLimit(scopeKey) {
    const state = scopeState(scopeKey);
    state.renderLimit += RENDER_BATCH_SIZE;
    return state.renderLimit;
  }

  function createBudget(scopeKey, totalTags) {
    const state = scopeState(scopeKey);
    return {
      scopeKey: state.key,
      limit: state.renderLimit,
      total: Math.max(0, Number(totalTags || 0)),
      rendered: 0,
      skipped: 0,
    };
  }

  function takeTag(budget) {
    if (!budget || budget.rendered >= budget.limit) {
      if (budget) budget.skipped += 1;
      return false;
    }
    budget.rendered += 1;
    return true;
  }

  function createLoadMoreButton(budget, onLoadMore) {
    if (!budget || budget.rendered >= budget.total) return null;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'gb-btn gb-btn-sm gb-btn-quiet gb-tag-tree-load-more';
    button.dataset.e2eId = 'tag-management-load-more';
    button.style.cssText = 'width:100%;min-height:44px;margin:6px 0;';
    button.textContent = `さらに表示（${budget.rendered.toLocaleString('ja-JP')} / ${budget.total.toLocaleString('ja-JP')}件）`;
    button.setAttribute(
      'aria-label',
      `タグをさらに表示。現在${budget.rendered.toLocaleString('ja-JP')}件、全${budget.total.toLocaleString('ja-JP')}件`,
    );
    button.addEventListener('click', () => {
      increaseRenderLimit(budget.scopeKey);
      if (typeof onLoadMore === 'function') onLoadMore();
    });
    return button;
  }

  function now() {
    return typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now();
  }

  function replaceDynamic(host, build, label) {
    if (!host || typeof build !== 'function') return null;
    const startedAt = now();
    const fragment = build();
    host.replaceChildren(fragment);
    const durationMs = Math.max(0, now() - startedAt);
    const entry = {
      label: String(label || 'tag-tree'),
      durationMs,
      childCount: host.childElementCount,
      recordedAt: Date.now(),
    };
    metrics.push(entry);
    if (metrics.length > 40) metrics.splice(0, metrics.length - 40);
    try {
      window.dispatchEvent(new CustomEvent('meldex:tag-tree-render-measured', {
        detail: { ...entry },
      }));
    } catch (_) {
      // CustomEventを利用できない埋め込み環境でも描画は継続する。
    }
    return entry;
  }

  function getMetrics() {
    return metrics.map(item => ({ ...item }));
  }

  window.MeldexTagTreeRuntime = {
    INITIAL_RENDER_LIMIT,
    RENDER_BATCH_SIZE,
    MAX_SCOPE_STATES,
    normalizedScopeKey,
    scopeState,
    resetRenderLimit,
    increaseRenderLimit,
    createBudget,
    takeTag,
    createLoadMoreButton,
    replaceDynamic,
    getMetrics,
  };
})();
