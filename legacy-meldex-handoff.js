(function () {
  'use strict';

  const script = document.currentScript;
  const openType = String(script?.dataset?.openType || '').trim();
  const source = new URLSearchParams(window.location.search || '');
  const path = String(source.get('path') || source.get('open') || '').trim();
  const label = String(source.get('label') || '').trim();
  const target = new URL('../../Meldex.html', window.location.href);
  target.searchParams.set('single', '1');
  if (openType) target.searchParams.set('open', openType);
  if (path) target.searchParams.set('path', path);
  if (label) target.searchParams.set('label', label);

  const link = document.querySelector('[data-meldex-legacy-handoff]');
  if (link) link.href = target.href;
  if (path && openType) window.location.replace(target.href);
})();
