(function () {
  'use strict';

  let frame = 0;
  let lastWidth = -1;
  let lastHeight = -1;

  function notify(width, height) {
    if (width === lastWidth && height === lastHeight) return;
    lastWidth = width;
    lastHeight = height;
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      window.dispatchEvent(new CustomEvent('viewer-layout-resize', {
        detail: { width: lastWidth, height: lastHeight },
      }));
    });
  }

  function observe() {
    const display = document.getElementById('display');
    if (!display) return;
    const report = () => notify(display.clientWidth, display.clientHeight);
    if (typeof ResizeObserver === 'function') {
      const observer = new ResizeObserver(entries => {
        const size = entries[0]?.contentRect;
        notify(Math.round(size?.width || display.clientWidth), Math.round(size?.height || display.clientHeight));
      });
      observer.observe(display);
      window.addEventListener('pagehide', () => observer.disconnect(), { once: true });
    }
    window.addEventListener('resize', report, { passive: true });
    report();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', observe, { once: true });
  else observe();
})();
