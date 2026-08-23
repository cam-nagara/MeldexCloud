/* gb-mutation-bus.js: shared body MutationObserver bus */
(function (global) {
  const subscribers = new Map();
  let observer = null;
  let startPending = false;

  function _canObserve() {
    return typeof MutationObserver !== 'undefined' && typeof document !== 'undefined' && !!document.body;
  }

  function _requestStart() {
    if (observer || startPending) return;
    if (_canObserve()) {
      _start();
      return;
    }
    if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
      startPending = true;
      document.addEventListener('DOMContentLoaded', () => {
        startPending = false;
        _start();
      }, { once: true });
    }
  }

  function _start() {
    if (observer || !_canObserve()) return;
    observer = new MutationObserver(_dispatch);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true,
    });
  }

  function _stopIfIdle() {
    if (subscribers.size || !observer) return;
    observer.disconnect();
    observer = null;
  }

  function _matches(sub, mutation) {
    if (typeof sub.filter !== 'function') return true;
    try { return !!sub.filter(mutation); } catch { return true; }
  }

  function _run(sub, mutations) {
    try { sub.callback(mutations); } catch (error) {
      try { console.warn('[GBMutationBus] subscriber failed:', sub.id, error); } catch {}
    }
  }

  function _dispatch(mutations) {
    if (!subscribers.size) return;
    const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    subscribers.forEach((sub) => {
      if (typeof sub.callback !== 'function') return;
      const relevant = mutations.filter((mutation) => _matches(sub, mutation));
      if (!relevant.length) return;
      const throttle = Math.max(0, Number(sub.throttle) || 0);
      if (!throttle) {
        _run(sub, relevant);
        return;
      }
      sub.pending = (sub.pending || []).concat(relevant);
      const elapsed = now - (sub.lastRun || 0);
      if (elapsed >= throttle && !sub.timer) {
        const pending = sub.pending.splice(0);
        sub.lastRun = now;
        _run(sub, pending);
        return;
      }
      if (sub.timer) return;
      sub.timer = setTimeout(() => {
        sub.timer = 0;
        sub.lastRun = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
        const pending = sub.pending.splice(0);
        if (pending.length && subscribers.get(sub.id) === sub) _run(sub, pending);
      }, Math.max(1, throttle - elapsed));
    });
  }

  function subscribe(id, options) {
    const key = id || ('sub-' + Math.random().toString(36).slice(2));
    unsubscribe(key);
    const sub = {
      id: key,
      filter: options?.filter || null,
      callback: options?.callback,
      throttle: options?.throttle || 0,
      lastRun: 0,
      timer: 0,
      pending: [],
    };
    subscribers.set(key, sub);
    _requestStart();
    return { id: key, disconnect: () => unsubscribe(key) };
  }

  function unsubscribe(id) {
    const sub = subscribers.get(id);
    if (sub?.timer) clearTimeout(sub.timer);
    subscribers.delete(id);
    _stopIfIdle();
  }

  global.GBMutationBus = {
    subscribe,
    unsubscribe,
    getSubscriberCount: () => subscribers.size,
  };
})(window);
