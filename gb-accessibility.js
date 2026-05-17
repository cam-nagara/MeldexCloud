/* Meldex accessibility helpers. */
(function() {
  'use strict';

  const ROOT = document.documentElement;
  const STORAGE = {
    highContrast: 'meldex-a11y-high-contrast',
    reducedMotion: 'meldex-a11y-reduced-motion',
    colorblindSafe: 'meldex-a11y-colorblind-safe',
    browserWarningDismissed: 'meldex-a11y-browser-warning-dismissed',
  };

  function _matches(query) {
    try { return !!window.matchMedia?.(query)?.matches; } catch { return false; }
  }

  function _storageValue(key) {
    try {
      const value = localStorage.getItem(key);
      if (value === '1') return true;
      if (value === '0') return false;
    } catch {}
    return null;
  }

  function _storageFlag(key) {
    return _storageValue(key) === true;
  }

  function _setStorageFlag(key, enabled) {
    try {
      localStorage.setItem(key, enabled ? '1' : '0');
    } catch {}
  }

  function _preferenceEnabled(name) {
    if (name === 'highContrast') {
      const stored = _storageValue(STORAGE.highContrast);
      return stored === null ? _matches('(prefers-contrast: more)') : stored;
    }
    if (name === 'reducedMotion') {
      const stored = _storageValue(STORAGE.reducedMotion);
      return stored === null ? _matches('(prefers-reduced-motion: reduce)') : stored;
    }
    if (name === 'colorblindSafe') return _storageFlag(STORAGE.colorblindSafe);
    return false;
  }

  function applyPreferences() {
    const highContrast = _preferenceEnabled('highContrast');
    const reducedMotion = _preferenceEnabled('reducedMotion');
    const colorblindSafe = _preferenceEnabled('colorblindSafe');
    ROOT.classList.toggle('meldex-high-contrast', highContrast);
    ROOT.classList.toggle('meldex-reduced-motion', reducedMotion);
    ROOT.classList.toggle('meldex-colorblind-safe', colorblindSafe);
    ROOT.dataset.a11yHighContrast = highContrast ? '1' : '0';
    ROOT.dataset.a11yReducedMotion = reducedMotion ? '1' : '0';
  }

  function setPreference(name, enabled) {
    if (name === 'highContrast') _setStorageFlag(STORAGE.highContrast, enabled);
    else if (name === 'reducedMotion') _setStorageFlag(STORAGE.reducedMotion, enabled);
    else if (name === 'colorblindSafe') _setStorageFlag(STORAGE.colorblindSafe, enabled);
    applyPreferences();
  }

  function _cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(value);
    return String(value || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }

  function _labelFromElement(el) {
    const byAria = el.getAttribute('aria-label') || el.getAttribute('aria-labelledby');
    if (byAria) return '';
    if (el.id) {
      const label = document.querySelector(`label[for="${_cssEscape(el.id)}"]`);
      if (label && label.textContent.trim()) return '';
    }
    const title = el.getAttribute('title') || el.getAttribute('data-gb-native-title');
    if (title && title.trim()) return title.trim();
    const placeholder = el.getAttribute('placeholder');
    if (placeholder && placeholder.trim()) return placeholder.trim();
    const text = el.textContent?.trim();
    if (text) return text.replace(/\s+/g, ' ').slice(0, 80);
    const action = el.getAttribute('data-action') || '';
    if (action) return action.replace(/\(.*$/, '').replace(/^_+/, '').trim();
    return '';
  }

  function ensureControlLabels(root) {
    const scope = root || document;
    const selector = 'input, select, textarea, button, [role="button"], [tabindex]';
    const controls = [];
    if (scope.nodeType === 1 && scope.matches?.(selector)) controls.push(scope);
    scope.querySelectorAll?.(selector).forEach(el => controls.push(el));
    controls.forEach(el => {
      if (el.disabled || el.hidden || el.getAttribute('aria-hidden') === 'true') return;
      const label = _labelFromElement(el);
      if (label) el.setAttribute('aria-label', label);
    });
  }

  function ensureLiveRegions() {
    const status = document.getElementById('status-bar');
    if (status) {
      status.setAttribute('role', 'status');
      status.setAttribute('aria-live', 'polite');
      status.setAttribute('aria-atomic', 'true');
    }
    const msg = document.getElementById('sb-msg');
    if (msg) {
      if (status && status.contains(msg)) {
        msg.removeAttribute('role');
        msg.removeAttribute('aria-live');
        msg.removeAttribute('aria-atomic');
      } else {
        msg.setAttribute('role', 'status');
        msg.setAttribute('aria-live', 'polite');
        msg.setAttribute('aria-atomic', 'true');
      }
    }
    const warn = document.getElementById('sb-warn');
    if (warn) {
      warn.setAttribute('role', 'alert');
      warn.setAttribute('aria-live', 'assertive');
    }
    document.querySelectorAll('#chat-usage-banner, #export-to-db-status, #fsb-count').forEach(el => {
      el.setAttribute('aria-live', 'polite');
      el.setAttribute('aria-atomic', 'true');
    });
  }

  function _browserSupport() {
    const ua = navigator.userAgent || '';
    const rules = [
      { name: 'Chrome', pattern: /Chrome\/(\d+)/, min: 110 },
      { name: 'Edge', pattern: /Edg\/(\d+)/, min: 110 },
      { name: 'Firefox', pattern: /Firefox\/(\d+)/, min: 110 },
      { name: 'Safari', pattern: /Version\/(\d+).*Safari/, min: 16 },
    ];
    const matched = rules.find(rule => rule.pattern.test(ua));
    if (!matched) return { ok: true, known: false };
    const version = Number(ua.match(matched.pattern)?.[1] || 0);
    return { ok: version >= matched.min, known: true, name: matched.name, version, min: matched.min };
  }

  function showBrowserWarningIfNeeded() {
    const support = _browserSupport();
    if (support.ok) return;
    if (_storageFlag(STORAGE.browserWarningDismissed)) return;
    if (document.getElementById('meldex-browser-warning')) return;
    const bar = document.createElement('div');
    bar.id = 'meldex-browser-warning';
    bar.className = 'meldex-browser-warning';
    bar.setAttribute('role', 'alert');
    bar.setAttribute('aria-live', 'assertive');
    bar.textContent = `${support.name} ${support.version} は推奨環境外です。${support.name} ${support.min} 以降での利用を推奨します。`;
    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = '閉じる';
    close.addEventListener('click', () => {
      _setStorageFlag(STORAGE.browserWarningDismissed, true);
      bar.remove();
    });
    bar.appendChild(close);
    document.body.appendChild(bar);
  }

  function refresh(root) {
    applyPreferences();
    ensureLiveRegions();
    ensureControlLabels(root || document);
    showBrowserWarningIfNeeded();
  }

  function installMutationObserver() {
    const observer = new MutationObserver(records => {
      for (const record of records) {
        record.addedNodes?.forEach(node => {
          if (node.nodeType === 1) ensureControlLabels(node);
        });
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  applyPreferences();
  window.matchMedia?.('(prefers-contrast: more)')?.addEventListener?.('change', applyPreferences);
  window.matchMedia?.('(prefers-reduced-motion: reduce)')?.addEventListener?.('change', applyPreferences);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      refresh(document);
      installMutationObserver();
    }, { once: true });
  } else {
    refresh(document);
    installMutationObserver();
  }

  window.MeldexAccessibility = {
    STORAGE,
    applyPreferences,
    setPreference,
    refresh,
    ensureControlLabels,
    ensureLiveRegions,
    browserSupport: _browserSupport,
    isPreferenceEnabled: _preferenceEnabled,
    isReducedMotion: () => ROOT.classList.contains('meldex-reduced-motion'),
  };
})();
