        if (!color) return null;
        _osAccentRuntimeColor = color.toLowerCase();
        if (getUseOsAccentColor()) {
          applyOsAccentColorSetting(true, { skipNativeRefresh: true });
          global.dispatchEvent(new CustomEvent('meldex-theme-os-accent-change', { detail: { enabled: true, color: _osAccentRuntimeColor } }));
          global.dispatchEvent(new CustomEvent('meldex-theme-color-set-change', { detail: { colorSet: [_osAccentRuntimeColor] } }));
        }
        return color;
      })
      .catch(() => null);
  }

  function getOsAccentColor() {
    return hasOsAccentRuntimeColor() ? _osAccentRuntimeColor : '';
  }

  function getOsAccentTextColor() {
    const color = getOsAccentColor();
    if (!color) return 'AccentColorText';
    const r = parseInt(color.slice(1, 3), 16);
    const g = parseInt(color.slice(3, 5), 16);
    const b = parseInt(color.slice(5, 7), 16);
    return (r * 0.299 + g * 0.587 + b * 0.114) > 150 ? '#000000' : '#ffffff';
  }

  function getOsAccentThemeColorSet() {
    return [hasOsAccentRuntimeColor() ? getOsAccentColor() : THEME_OS_ACCENT_CSS];
  }

  function _effectiveThemeColorSet(colors, fallback) {
    if (getUseOsAccentColor()) return getOsAccentThemeColorSet();
    return normalizeThemeColorSet(colors, fallback || RAINBOW_PALETTE);
  }

  function _isOsAccentStyleValue(value) {
    const v = String(value || '').replace(/\s+/g, '').toLowerCase();
    return v === 'accentcolor'
      || v === 'accentcolortext'
      || v === THEME_OS_ACCENT_CSS.replace(/\s+/g, '').toLowerCase()
      || v === THEME_OS_ACCENT_TEXT_CSS.replace(/\s+/g, '').toLowerCase();
  }

  function _rememberBeforeOsAccent(root, key) {
    const current = root.style.getPropertyValue(key).trim();
    if (!_osAccentPreviousStyleValues.has(key) || !_isOsAccentStyleValue(current)) {
      _osAccentPreviousStyleValues.set(key, current || null);
    }
  }

  function _restoreBeforeOsAccent(root, key) {
    if (!_osAccentPreviousStyleValues.has(key)) {
      if (_isOsAccentStyleValue(root.style.getPropertyValue(key))) root.style.removeProperty(key);
      return;
    }
    const previous = _osAccentPreviousStyleValues.get(key);
    if (previous) root.style.setProperty(key, previous);
    else root.style.removeProperty(key);
  }

  function _clearOsAccentStyleValue(root, key) {
    if (_isOsAccentStyleValue(root.style.getPropertyValue(key))) root.style.removeProperty(key);
  }

  function applyOsAccentColorSetting(enabled = getUseOsAccentColor(), options = {}) {
    const root = document.documentElement;
    if (enabled && options.skipNativeRefresh !== true) refreshOsAccentColor();
    root.style.setProperty('--theme-os-accent', hasOsAccentRuntimeColor() ? getOsAccentColor() : 'AccentColor');
    root.style.setProperty('--theme-os-accent-text', getOsAccentTextColor());
    THEME_OS_ACCENT_STYLE_KEYS.forEach(key => {
      if (enabled) {
        _rememberBeforeOsAccent(root, key);
        root.style.setProperty(key, THEME_OS_ACCENT_CSS);
      } else if (options.restorePrevious === false) {
        _clearOsAccentStyleValue(root, key);
      } else {
        _restoreBeforeOsAccent(root, key);
      }
    });
    THEME_OS_ACCENT_TEXT_STYLE_KEYS.forEach(key => {
      if (enabled) {
        _rememberBeforeOsAccent(root, key);
        root.style.setProperty(key, THEME_OS_ACCENT_TEXT_CSS);
      } else if (options.restorePrevious === false) {
        _clearOsAccentStyleValue(root, key);
      } else {
        _restoreBeforeOsAccent(root, key);
      }
    });
    if (!enabled) _osAccentPreviousStyleValues.clear();
    if (enabled) {
      _activeThemeColorSet = paintThemeColorSet(getOsAccentThemeColorSet());
      if (typeof global.syncThemeColorSetSwatches === 'function') global.syncThemeColorSetSwatches(document, getOsAccentThemeColorSet());
    } else {
      _activeThemeColorSet = paintThemeColorSet(readStoredThemeColorSet() || resolveThemeColorSet(getThemeById(getDefaultThemeId())));
    }
    applyThemeUiApplications(getThemeUiApplications(), { forceTargets: true });
  }

  function setUseOsAccentColor(enabled) {
    const options = arguments[1] || {};
    const next = !!enabled;
    const before = _captureThemeSettingsStorage([THEME_OS_ACCENT_KEY]);
    try {
      localStorage.setItem(THEME_OS_ACCENT_KEY, next ? '1' : '0');
    } catch {}
    _pushThemeSettingsHistory('設定: OSアクセントカラー変更', before, [THEME_OS_ACCENT_KEY], next ? '有効' : '無効', options);
    applyOsAccentColorSetting(next);
    global.dispatchEvent(new CustomEvent('meldex-theme-os-accent-change', { detail: { enabled: next } }));
    return next;
  }

  function theme(id, name, vars, board, palette, options = {}) {
    const colorSet = normalizeThemeColorSet(palette, RAINBOW_PALETTE);
    const standardPaletteAdjust = themeStandardPaletteAdjustFromTheme({ ui: { standardPaletteAdjust: options.standardPaletteAdjust } }, null);
    const coloringRule = board.coloringRule
      ? { ...board.coloringRule, palette: colorSet, colorPalette: normalizeThemeColorSet(board.coloringRule.colorPalette || colorSet, colorSet) }
      : { enabled: false, palette: colorSet, colorPalette: colorSet };
    const ui = {
      cssVars: vars,
      themeColorSet: colorSet,
      colorSet,
      palette: colorSet,
      themeUiApplications: _defaultThemeUiApplications(),
      themeUiAutoTone: normalizeThemeUiAutoTone(null),
    };
    if (standardPaletteAdjust) {
      ui.standardPaletteAdjust = standardPaletteAdjust;
      ui[STANDARD_PALETTE_THEME_KEY] = standardPaletteAdjust;
    }
    return {
      id,
      name,
      builtIn: true,
      themeColorSet: colorSet,
      ui,
      board: {
        backgroundColor: board.bg,
        nodeBgColor: board.node,
        nodeTextColor: board.fg,
        nodeBorderColor: board.border || board.accent,
        nodeBorderWidth: board.borderWidth ?? 0,
        lineColor: board.accent,
        globalFilter: board.filter || '',
        coloringRule,
      },
    };
  }

  const BUILT_IN_THEMES = [
    theme('builtin-dark', 'ダーク', DARK_VARS, { bg: '#1e1e1e', node: '#3e3e3e', fg: '#d4d4d4', accent: '#569cd6', border: '#555555' }, DARK_THEME_COLOR_SET),
    theme('builtin-light', 'ライト', LIGHT_VARS, { bg: '#ffffff', node: '#f0f0f0', fg: '#333333', accent: '#2563eb', border: '#c0c0c0' }, LIGHT_THEME_COLOR_SET, { standardPaletteAdjust: LIGHT_STANDARD_PALETTE_ADJUST }),
    theme('builtin-pastel', 'パステル', PASTEL_VARS, { bg: '#ffffff', node: '#f6f7f9', fg: '#2f3440', accent: '#9b59b6', border: '#d8dee8' }, PASTEL_THEME_COLOR_SET, { standardPaletteAdjust: PASTEL_STANDARD_PALETTE_ADJUST }),
    theme('builtin-earth', 'アースカラー', EARTH_VARS, { bg: '#0f1110', node: '#242824', fg: '#d9ddd8', accent: '#6fa85a', border: '#343a35' }, EARTH_THEME_COLOR_SET, { standardPaletteAdjust: EARTH_STANDARD_PALETTE_ADJUST }),
  ];

  function _promotedInitialThemeIdFromName(name) {
    const label = _themeNameKey(name);
    return INITIAL_BUILTIN_THEME_NAME_MAP[label] || '';
  }

  function _readRawCustomThemes() {
    try {
      const parsed = JSON.parse(localStorage.getItem(CUSTOM_THEMES_KEY) || '[]');
      return Array.isArray(parsed) ? parsed.filter(t => t && t.id && t.name) : [];
    } catch {
      return [];
    }
  }

  function _readPromotedInitialThemeSources() {
    try {
      const parsed = JSON.parse(localStorage.getItem(PROMOTED_INITIAL_THEMES_KEY) || '[]');
      if (!Array.isArray(parsed)) return [];
      return parsed.map(entry => {
        const theme = entry?.theme && entry.theme.id && entry.theme.name ? entry.theme : entry;
        const targetId = entry?.targetId || _promotedInitialThemeIdFromName(theme?.name);
        return targetId && theme?.id && theme?.name ? { targetId, theme } : null;
      }).filter(Boolean);
    } catch {
      return [];
    }
  }

  function _writePromotedInitialThemeSources(entries) {
    const byTarget = new Map();
    (entries || []).forEach(entry => {
      if (!entry?.targetId || !entry?.theme?.id || !entry?.theme?.name || byTarget.has(entry.targetId)) return;
      byTarget.set(entry.targetId, { targetId: entry.targetId, theme: entry.theme });
    });
    const next = INITIAL_BUILTIN_THEME_TARGETS.map(target => byTarget.get(target.id)).filter(Boolean);
    if (next.length) {
      localStorage.setItem(PROMOTED_INITIAL_THEMES_KEY, JSON.stringify(next));
    }
  }

  function _promotedInitialThemeSourcesByTarget(rawThemes = _readRawCustomThemes()) {
    const byTarget = new Map();
    _readPromotedInitialThemeSources().forEach(entry => {
      if (entry.targetId && entry.theme) byTarget.set(entry.targetId, entry.theme);
    });
    if (!_initialCustomThemeCleanupVersionApplied()) {
      (rawThemes || []).forEach(theme => {
        const targetId = _promotedInitialThemeIdFromName(theme?.name);
        if (targetId && !byTarget.has(targetId)) byTarget.set(targetId, theme);
      });
    }
    return byTarget;
  }

  function _initialCustomThemeCleanupVersionApplied() {
    try {
      return localStorage.getItem(THEME_CUSTOM_CLEANUP_VERSION_KEY) === THEME_CUSTOM_CLEANUP_VERSION;
    } catch {
      return false;
    }
  }

  function _isObsoleteInitialCustomTheme(theme, options = {}) {
    if (options.force !== true && _initialCustomThemeCleanupVersionApplied()) return false;
    const label = _themeNameKey(theme?.name);
    return !!_promotedInitialThemeIdFromName(theme?.name) || OBSOLETE_INITIAL_CUSTOM_THEME_NAME_KEYS.has(label);
  }

  function _promotedInitialThemeIdFromCustomId(id) {
    const rawId = String(id || '');
    if (!rawId) return '';
    const promotedSource = _readPromotedInitialThemeSources().find(entry => String(entry.theme?.id || '') === rawId);
    if (promotedSource) return promotedSource.targetId;
    if (_initialCustomThemeCleanupVersionApplied()) return '';
    const item = _readRawCustomThemes().find(t => String(t.id || '') === rawId);
    return item ? _promotedInitialThemeIdFromName(item.name) : '';
  }

  function _isKnownDefaultThemeId(id) {
    const rawId = String(id || '');
    if (!rawId || rawId === 'OSに合わせる') return true;
    if (BUILT_IN_THEMES.some(t => t.id === rawId)) return true;
    return _readRawCustomThemes().some(t => String(t.id || '') === rawId && !_isObsoleteInitialCustomTheme(t));
  }

  function _normalizeDefaultThemeId(id) {
    const next = _normalizeThemeIdWithPromotedCustom(id) || 'builtin-dark';
    return _isKnownDefaultThemeId(next) ? next : 'builtin-dark';
  }

  function _normalizeThemeIdWithPromotedCustom(id) {
    return _promotedInitialThemeIdFromCustomId(id) || normalizeThemeId(id) || '';
  }

  function _initialBuiltinTargetFromId(id) {
    const rawId = String(id || '');
    return INITIAL_BUILTIN_THEME_TARGETS.find(target => target.id === rawId) || null;
  }

  function _fallbackPromotedInitialThemeSource(targetId) {
    const target = _initialBuiltinTargetFromId(targetId);
    if (!target) return null;
    const base = BUILT_IN_THEMES.find(themeDef => themeDef.id === target.id) || {};
    const next = clone(base);
    next.id = `promoted-source-${target.id}`;
    next.name = target.customName || target.name;
    next.builtIn = false;
    next.ui = { ...(base.ui || {}) };
    next.board = { ...(base.board || {}) };
    return next;
  }

  function _updatePromotedInitialThemeSource(targetId, updater) {
    const target = _initialBuiltinTargetFromId(targetId);
    if (!target) return null;
    const sourceByTarget = _promotedInitialThemeSourcesByTarget();
    const current = sourceByTarget.get(target.id) || _fallbackPromotedInitialThemeSource(target.id);
    if (!current) return null;
    const next = clone(current);
    next.id = next.id || `promoted-source-${target.id}`;
    next.name = next.name || target.customName || target.name;
    next.ui = { ...(next.ui || {}) };
    if (typeof updater === 'function') updater(next);
    sourceByTarget.set(target.id, next);
    _writePromotedInitialThemeSources(Array.from(sourceByTarget, ([storedTargetId, theme]) => ({ targetId: storedTargetId, theme })));
    return next;
  }

  function _mergeActiveThemeSettingsIntoInitialSource(sourceByTarget, targetId) {
    const target = _initialBuiltinTargetFromId(targetId);
    if (!target) return;
    const current = clone(sourceByTarget.get(target.id) || _fallbackPromotedInitialThemeSource(target.id));
    if (!current) return;
    current.ui = { ...(current.ui || {}) };

    const storedPalette = readStoredThemeColorSet();
    if (storedPalette) {
      current.themeColorSet = storedPalette;
      current[THEME_COLOR_SET_THEME_KEY] = storedPalette;
      current.ui.themeColorSet = storedPalette;
      current.ui[THEME_COLOR_SET_THEME_KEY] = storedPalette;
      current.ui.colorSet = storedPalette;
      current.ui.palette = storedPalette;
    }

    const slotSettings = compactThemeColorSlotSettings(readStoredThemeColorSlotSettings());
    if (slotSettings) {
      current.ui.themeColorSlotSettings = slotSettings;
      current.ui[THEME_COLOR_SLOT_SETTINGS_THEME_KEY] = slotSettings;
    }
    const extraSlotSettings = compactThemeColorExtraSlotSettings(readStoredThemeColorExtraSlotSettings());
    if (extraSlotSettings) {
      current.ui.themeColorExtraSlotSettings = extraSlotSettings;
      current.ui[THEME_COLOR_EXTRA_SLOT_SETTINGS_THEME_KEY] = extraSlotSettings;
    }
    try {
      const rawAdjust = localStorage.getItem(STANDARD_PALETTE_ADJUST_STORAGE_KEY);
      if (rawAdjust != null) current.ui.standardPaletteAdjust = normalizeThemeStandardPaletteAdjust(JSON.parse(rawAdjust));
    } catch {}
    try {
      const rawOsAccent = localStorage.getItem(THEME_OS_ACCENT_KEY);
      if (rawOsAccent != null) current.ui.useOsAccentColor = normalizeThemeOsAccentSetting(rawOsAccent);
    } catch {}

    sourceByTarget.set(target.id, current);
  }

  function _promotedInitialThemeTargetForStoredId(id, sourceByTarget) {
    const promoted = _promotedInitialThemeIdFromCustomId(id)
      || _promotedInitialThemeIdFromName(id);
    if (promoted) return promoted;
    const target = _initialBuiltinTargetFromId(id);
    return target && sourceByTarget.has(target.id) ? target.id : '';
  }

  function _ensureInitialCustomThemeCleanup() {
    if (_initialThemeCleanupDone || _initialThemeCleanupRunning || typeof localStorage === 'undefined') return;
    _initialThemeCleanupRunning = true;
    try {
      const rawThemes = _readRawCustomThemes();
      const sourceByTarget = _promotedInitialThemeSourcesByTarget(rawThemes);

      const storedDefault = localStorage.getItem(DEFAULT_THEME_KEY) || '';
      const storedEditorTheme = localStorage.getItem('editor-theme-name') || '';
      const promotedDefault = _promotedInitialThemeTargetForStoredId(storedDefault, sourceByTarget)
        || _promotedInitialThemeTargetForStoredId(storedEditorTheme, sourceByTarget);

      if (promotedDefault) _mergeActiveThemeSettingsIntoInitialSource(sourceByTarget, promotedDefault);
      if (sourceByTarget.size) {
        _writePromotedInitialThemeSources(Array.from(sourceByTarget, ([targetId, theme]) => ({ targetId, theme })));
      }

      const nextThemes = rawThemes.filter(theme => !_isObsoleteInitialCustomTheme(theme, { force: true }));
      const hasCleanupVersion = localStorage.getItem(THEME_CUSTOM_CLEANUP_VERSION_KEY) === THEME_CUSTOM_CLEANUP_VERSION;
      if (!hasCleanupVersion || nextThemes.length !== rawThemes.length) {
        localStorage.setItem(CUSTOM_THEMES_KEY, JSON.stringify(nextThemes));
        localStorage.setItem(THEME_CUSTOM_CLEANUP_VERSION_KEY, THEME_CUSTOM_CLEANUP_VERSION);
      }
      if (promotedDefault) {
        localStorage.setItem(DEFAULT_THEME_KEY, promotedDefault);
        localStorage.setItem('editor-theme-name', promotedDefault);
      }
    } catch {
      // Cleanup is best-effort; theme accessors still fall back to baked-in defaults.
    } finally {
      _initialThemeCleanupRunning = false;
      _initialThemeCleanupDone = true;
    }
  }

  function _promoteCustomInitialTheme(src, target, base) {
    const next = {
      ...clone(base),
      ...clone(src),
      id: target.id,
      name: target.name,
      builtIn: true,
      ui: {
        ...(base.ui || {}),
        ...(src.ui || {}),
        cssVars: { ...(base.ui?.cssVars || {}), ...(src.ui?.cssVars || {}) },
        themeUiApplications: normalizeThemeUiApplications(src.ui?.themeUiApplications || src.themeUiApplications || base.ui?.themeUiApplications),
        themeUiAutoTone: normalizeThemeUiAutoTone(src.ui?.themeUiAutoTone || src.themeUiAutoTone || base.ui?.themeUiAutoTone),
      },
      board: { ...(base.board || {}), ...(src.board || {}) },
    };
    const colorSet = normalizeThemeColorSet(rawThemeColorSetFromTheme(src) || base.ui?.colorSet, base.ui?.colorSet || RAINBOW_PALETTE);
    next.themeColorSet = colorSet;
    next[THEME_COLOR_SET_THEME_KEY] = colorSet;
    next.ui.themeColorSet = colorSet;
    next.ui[THEME_COLOR_SET_THEME_KEY] = colorSet;
    next.ui.colorSet = colorSet;
    next.ui.palette = colorSet;
    return next;
  }

  function _promotedInitialBuiltInThemes() {
    _ensureInitialCustomThemeCleanup();
    const sourceByTarget = _promotedInitialThemeSourcesByTarget();
    if (!sourceByTarget.size) return BUILT_IN_THEMES;
    return BUILT_IN_THEMES.map(base => {
      const target = INITIAL_BUILTIN_THEME_TARGETS.find(item => item.id === base.id);
      if (!target) return base;
      const src = sourceByTarget.get(target.id);
      return src ? _promoteCustomInitialTheme(src, target, base) : base;
    });
  }

  function normalizeThemeId(id) {
    if (global.MeldexThemeMigration?.normalizeThemeId) return global.MeldexThemeMigration.normalizeThemeId(id);
    return id || '';
  }

  function resolveThemeId(id) {
    const normalized = _normalizeThemeIdWithPromotedCustom(id || getDefaultThemeId());
    if (normalized === 'OSに合わせる') {
      return global.matchMedia?.('(prefers-color-scheme: dark)')?.matches ? 'builtin-dark' : 'builtin-light';
    }
    return normalized || 'builtin-dark';
  }

  function getBuiltInThemes() {
    return clone(_promotedInitialBuiltInThemes());
  }

  function getCustomThemes() {
    _ensureInitialCustomThemeCleanup();
    return _readRawCustomThemes().filter(t => t && t.id && t.name);
  }

  function saveCustomThemes(themes, options = {}) {
    const before = _captureThemeSettingsStorage([CUSTOM_THEMES_KEY]);
    _ensureInitialCustomThemeCleanup();
    const nextThemes = (themes || []).filter(t => t && t.id && t.name);
    localStorage.setItem(CUSTOM_THEMES_KEY, JSON.stringify(nextThemes));
    _pushThemeSettingsHistory('設定: カスタムテーマ変更', before, [CUSTOM_THEMES_KEY], options.detail || '', options);
  }

  function getAllThemes() {
    return [...getBuiltInThemes(), ...getCustomThemes()];
  }

  function getThemeById(id) {
    const resolved = resolveThemeId(id);
    const themes = getAllThemes();
    return clone(themes.find(t => t.id === resolved) || themes[0] || BUILT_IN_THEMES[0]);
  }

  function getDefaultThemeId() {
    _ensureInitialCustomThemeCleanup();
    const migrated = global.MeldexThemeMigration?.migrateEditorThemeStorage?.(DEFAULT_THEME_KEY) || '';
    const stored = localStorage.getItem(DEFAULT_THEME_KEY) || migrated || 'builtin-dark';
    const next = _normalizeDefaultThemeId(stored);
    if (stored && next !== stored) {
      try { localStorage.setItem(DEFAULT_THEME_KEY, next); } catch {}
    }
    return next;
  }

  function setDefaultThemeId(id, options = {}) {
    const next = _normalizeDefaultThemeId(id);
    const before = _captureThemeSettingsStorage([DEFAULT_THEME_KEY, 'editor-theme-name']);
    localStorage.setItem(DEFAULT_THEME_KEY, next);
    localStorage.setItem('editor-theme-name', next);
    _pushThemeSettingsHistory('設定: テーマ切替', before, [DEFAULT_THEME_KEY, 'editor-theme-name'], next, options);
    return next;
  }

  function collectKnownThemeVarKeys() {
    const keys = new Set(Object.keys(DARK_VARS).concat(
      Object.keys(LIGHT_VARS),
      Object.keys(PASTEL_VARS),
      Object.keys(EARTH_VARS),
      Object.keys(GIRLY_VARS)
    ));
    COMMON_INTEGRATED_APP_STYLE_KEYS.forEach(k => keys.add(k));
    if (typeof global.getAllStyleKeys === 'function') global.getAllStyleKeys().forEach(k => keys.add(k));
    return keys;
  }

  function trackExistingThemeVars(root) {
    if (_trackedExistingThemeVars) return;
    _trackedExistingThemeVars = true;
    collectKnownThemeVarKeys().forEach(key => {
      if (root.style.getPropertyValue(key)) _appliedThemeVarKeys.add(key);
    });
  }

  function clearKnownThemeVars() {
    const root = document.documentElement;
    collectKnownThemeVarKeys().forEach(k => root.style.removeProperty(k));
    _appliedThemeVarKeys.clear();
  }

  function invalidatePaletteTargetCache() {
    _paletteTargetCache = null;
    if (!_activeThemeColorSet) return;
    if (_paletteBindRaf) return;
    const requestFrame = global.requestAnimationFrame || (fn => setTimeout(fn, 16));
    _paletteBindRaf = requestFrame(() => {
      _paletteBindRaf = 0;
      if (_activeThemeColorSet) bindPaletteTargets(_activeThemeColorSet);
    });
  }

  function ensurePaletteObserver() {
    if (_paletteObserver || typeof MutationObserver === 'undefined') return;
    if (!document.body) {
      if (!_paletteObserverWaiting && typeof global.addEventListener === 'function') {
        _paletteObserverWaiting = true;
        global.addEventListener('DOMContentLoaded', () => {
          _paletteObserverWaiting = false;
          ensurePaletteObserver();
          invalidatePaletteTargetCache();
        }, { once: true });
      }
      return;
    }
    if (global.GBMutationBus) {
      _paletteObserver = global.GBMutationBus.subscribe('theme-palette-targets', {
        filter: (mutation) => paletteMutationTouchesTargets([mutation]),
        callback: handlePaletteDomMutations,
        throttle: 50,
      });
    } else {
      _paletteObserver = new MutationObserver(handlePaletteDomMutations);
      _paletteObserver.observe(document.body, { childList: true, subtree: true });
    }
  }

  function paletteMutationTouchesTargets(mutations) {
    for (const mutation of mutations || []) {
      const nodes = [...(mutation.addedNodes || []), ...(mutation.removedNodes || [])];
      if (nodes.some(paletteNodeTouchesTarget)) return true;
    }
    return false;
  }

  function paletteNodeTouchesTarget(node) {
    if (!node || node.nodeType !== 1) return false;
    if (paletteNodeIsBoardRenderMutation(node)) return false;
    return PALETTE_TARGET_SPECS.some(([selector]) => {
      try {
        return node.matches?.(selector) || !!node.querySelector?.(selector);
      } catch {
        return true;
      }
    });
  }

  function paletteNodeIsBoardRenderMutation(node) {
    const role = node.getAttribute?.('data-bd-role') || '';
    if (role === 'nodes' || role === 'svg' || role === 'resize-layer') return true;
    if (node.classList?.contains('bd-node') || node.classList?.contains('bd-conn-label')) return true;
    if (node.dataset?.connId || node.dataset?.bdNodeId) return true;
    if (node.closest?.('[data-bd-role="nodes"], [data-bd-role="svg"], [data-bd-role="resize-layer"]')) return true;
    if (node.ownerSVGElement?.getAttribute?.('data-bd-role') === 'svg') return true;
    return false;
  }

  function handlePaletteDomMutations(mutations) {
    if (paletteMutationTouchesTargets(mutations)) invalidatePaletteTargetCache();
  }

  function collectPaletteTargets(options = {}) {
    if (!options.force && _paletteTargetCache) return _paletteTargetCache;
    ensurePaletteObserver();
    const targets = [];
    PALETTE_TARGET_SPECS.forEach(([selector, target]) => {
      document.querySelectorAll(selector).forEach((el, index) => {
        targets.push({ el, index, target });
      });
    });
    _paletteTargetCache = targets;
    return targets;
  }

  function bindPaletteTargets(palette, options = {}) {
    const colorSet = _effectiveThemeColorSet(palette, RAINBOW_PALETTE);
    collectPaletteTargets({ force: options.force === true }).forEach(({ el, index, target }) => {
      const normalizedTarget = target === 'pane-tab' || target === 'panelset-tab'
        ? 'panel-tab'
        : (target === 'detail-tab' ? 'inner-tab' : target);
      el.dataset.themePaletteTarget = normalizedTarget;
      el.dataset.themePaletteIndex = String(index % colorSet.length);
    });
    if (options.apply === false) return;
    applyThemeUiApplications(null, { bindTargets: false });
  }

  function ensureThemeUiPaletteTargets(options = {}) {
    if (options.bindTargets === false) return;
    const palette = _activeThemeColorSet
      || readStoredThemeColorSet()
      || resolveThemeColorSet(getThemeById(getDefaultThemeId()));
    if (!palette) return;
    _activeThemeColorSet = _effectiveThemeColorSet(palette, RAINBOW_PALETTE);
    bindPaletteTargets(_activeThemeColorSet, { apply: false, force: options.forceTargets === true });
  }

  function paintThemeColorSet(colors, options = {}) {
    ensurePaletteRuntimeStyle();
    const palette = _effectiveThemeColorSet(colors, RAINBOW_PALETTE);
    const root = document.documentElement;
    for (let i = 0; i < 10; i += 1) {
      const key = `--theme-palette-${i}`;
      const value = palette[i % palette.length];
      if (root.style.getPropertyValue(key).trim() !== value) root.style.setProperty(key, value);
    }
    if (options.bindTargets !== false) bindPaletteTargets(palette);
    else applyThemeUiApplications(null, { bindTargets: false });
    return palette;
  }

  function applyPaletteTargets(themeDef) {
    const themePalette = resolveThemeColorSet(themeDef);
    const storedPalette = readStoredThemeColorSet();
    const palette = paintThemeColorSet(storedPalette || themePalette);
    _activeThemeColorSet = palette;
    if (storedPalette && themeColorSetsEqual(storedPalette, themePalette)) {
      try { localStorage.removeItem(THEME_COLOR_SET_KEY); } catch {}
    }
  }

  function getThemeColorSet(themeDef, options = {}) {
    if (options.ignoreOsAccent !== true && getUseOsAccentColor()) return getOsAccentThemeColorSet().slice();
    const activePalette = options.ignoreOsAccent === true && getUseOsAccentColor() ? null : _activeThemeColorSet;
    const palette = themeDef
      ? resolveThemeColorSet(themeDef)
      : (readStoredThemeColorSet() || activePalette || resolveThemeColorSet(getThemeById(getDefaultThemeId())));
    return palette.slice();
  }

  function setThemeColorSet(colors, options = {}) {
    const next = normalizeThemeColorSet(colors, getThemeColorSet());
    const commitOptions = {
      ...options,
      skipHistory: options.skipHistory === true || _themeSettingsHistorySuppressed(options),
    };
    if (options.save !== false) {
      scheduleThemeColorSetCommit(next, commitOptions);
    }
    const applied = options.apply !== false ? paintThemeColorSet(next, { bindTargets: options.bindTargets !== false && options.immediateTargets === true }) : next;
    _activeThemeColorSet = applied.slice();
    if (options.save === false) {
      if (options.bindTargets !== false) bindPaletteTargets(next);
      if (options.renderBoard !== false) scheduleBoardRender();
      global.dispatchEvent(new CustomEvent('meldex-theme-color-set-change', { detail: { colorSet: next } }));
    }
    return next;
  }

  function scheduleThemeColorSetCommit(colors, options = {}) {
    cancelThemeColorSetCommit();
    const token = ++_themeColorSetCommitToken;
    const scheduledThemeId = getDefaultThemeId();
    _themeColorSetCommitTimer = setTimeout(() => {
      if (token !== _themeColorSetCommitToken) return;
      _themeColorSetCommitTimer = 0;
      if (options.save !== false && getDefaultThemeId() !== scheduledThemeId) return;
      const before = _captureThemeSettingsStorage([THEME_COLOR_SET_KEY]);
      if (options.save !== false) {
        try { localStorage.setItem(THEME_COLOR_SET_KEY, JSON.stringify(colors)); } catch {}
      }
      _pushThemeSettingsHistory('設定: テーマカラーセット変更', before, [THEME_COLOR_SET_KEY], '', options);
      if (options.bindTargets !== false) bindPaletteTargets(colors);
      if (options.renderBoard !== false) scheduleBoardRender();
      global.dispatchEvent(new CustomEvent('meldex-theme-color-set-change', { detail: { colorSet: colors } }));
    }, options.delay == null ? 120 : Math.max(0, options.delay));
  }

  function cancelThemeColorSetCommit() {
    clearTimeout(_themeColorSetCommitTimer);
    _themeColorSetCommitTimer = 0;
    _themeColorSetCommitToken += 1;
  }

  function resetThemeColorSet(options = {}) {
    return setThemeColorSet(resolveThemeColorSet(getThemeById(getDefaultThemeId())), options);
  }

/* === gb-theme-manager.part02.js === */
/* gb-theme-manager.part02.js: split from gb-theme-manager.js */
  function _themeUiSlotColorCss(options = {}) {
    return options.rootVars === true
      ? 'var(--theme-palette-0,#569cd6)'
      : 'var(--theme-slot-color,var(--accent))';
  }

  function _themeUiAutoMixCss(toneColor, amount, options = {}) {
    const percent = _normalizeThemeUiTonePercent(amount, 30);
    return `color-mix(in srgb, ${_themeUiSlotColorCss(options)} ${100 - percent}%, ${toneColor} ${percent}%)`;
  }

  function _themeUiColorCss(value, autoTone, options = {}) {
    const normalized = _normalizeThemeUiValue(value);
    if (normalized === THEME_UI_VALUE_NONE) return '';
    if (normalized === THEME_UI_VALUE_AUTO) return _themeUiSlotColorCss(options);
    if (normalized === THEME_UI_VALUE_AUTO_LIGHT) return _themeUiAutoMixCss('white', autoTone?.light, options);
    if (normalized === THEME_UI_VALUE_AUTO_DARK) return _themeUiAutoMixCss('black', autoTone?.dark, options);
    if (normalized === THEME_UI_VALUE_OS_ACCENT) return THEME_OS_ACCENT_CSS;
    if (normalized.startsWith(THEME_UI_VALUE_COLOR_PREFIX)) return normalized.slice(THEME_UI_VALUE_COLOR_PREFIX.length);
    return `var(--theme-palette-${normalized},${_themeUiSlotColorCss(options)})`;
  }

  const THEME_UI_SELECTED_SELECTOR_SUFFIXES = Object.freeze([
    '.active',
    '.selected',
    '.gb-inner-tab-active',
    '.gb-panel-tab-active',
    '[aria-selected="true"]',
    '[data-selected="1"]',
  ]);

  function _themeUiSelectedSelectors(base) {
    return THEME_UI_SELECTED_SELECTOR_SUFFIXES.map(suffix => `${base}${suffix}`);
  }

  function _themeUiNormalSelector(base) {
    const selectedExclusions = THEME_UI_SELECTED_SELECTOR_SUFFIXES
      .map(suffix => `:not(${suffix})`)
      .join('');
    return `${base}:not(:hover)${selectedExclusions}`;
  }

  function _themeUiStateSelector(targetId, stateId) {
    const base = `[data-theme-palette-target="${targetId}"]`;
    if (stateId === 'hover') return `${base}:hover`;
    if (stateId === 'selected') {
      return _themeUiSelectedSelectors(base).join(',');
    }
    if (stateId === 'normal') return _themeUiNormalSelector(base);
    return base;
  }

  function _themeUiExpandChildSelector(selector, childSelector) {
    if (!childSelector) return selector;
    const bases = String(selector || '').split(',').map(item => item.trim()).filter(Boolean);
    const children = String(childSelector || '').split(',').map(item => item.trim()).filter(Boolean);
    if (!bases.length || !children.length) return selector;
    return bases.flatMap(base => [base, ...children.map(child => `${base} ${child}`)]).join(',');
  }

  function _themeUiVarRule(target, stateId, propId, colorCss) {
    const raw = target?.vars?.[stateId]?.[propId];
    const keys = Array.isArray(raw) ? raw : (raw ? [raw] : []);
    const declarations = keys
      .filter(key => /^--[a-z0-9-]+$/i.test(String(key || '')))
      .map(key => `${key}:${colorCss}!important`)
      .join(';');
    return declarations ? `:root{${declarations}}` : '';
  }

  function _themeUiNoteHeadingAccentRule(selector, colorCss) {
    const levels = ['title', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'];
    const declarations = levels.map(level => `--page-${level}-accent-color:${colorCss}!important`).join(';');
    return `${selector}{${declarations}}`;
  }

  function _themeUiRuleForProp(selector, target, stateId, propId, colorCss) {
    if (!selector || !colorCss) return '';
    if (target?.vars) return _themeUiVarRule(target, stateId, propId, colorCss);
    selector = _themeUiExpandChildSelector(selector, target?.childSelector);
    const targetId = target?.id || '';
    if (propId === 'fg') {
      return `${selector}{color:${colorCss}!important}${selector} svg{stroke:${colorCss}!important}`;
    }
    if (propId === 'bg') {
      return `${selector}{background:${colorCss}!important}`;
    }
    if (propId === 'underline') {
      if (targetId === 'section-bar') {
        return `${selector}{border-left-color:${colorCss}!important}`;
      }
      if (targetId === 'note-heading') {
        return _themeUiNoteHeadingAccentRule(selector, colorCss);
      }
      if (targetId !== 'panel-tab' && targetId !== 'inner-tab') {
        return `${selector}{border-color:${colorCss}!important}`;
      }
      return `${selector}{border-bottom-color:${colorCss}!important}`;
    }
    return '';
  }

  function applyThemeUiApplications(cfg, options = {}) {
    ensurePaletteRuntimeStyle();
    ensureThemeUiPaletteTargets(options);
    const config = normalizeThemeUiApplications(cfg || getThemeUiApplications());
    let style = document.getElementById('meldex-theme-ui-applications-style');
    if (!style) {
      style = document.createElement('style');
      style.id = 'meldex-theme-ui-applications-style';
      document.head.appendChild(style);
    }
    const rules = [];
    const autoTone = getThemeUiAutoTone();
    THEME_UI_TARGETS.forEach(target => {
      _themeUiStatesForTarget(target).forEach(state => {
        const selector = _themeUiStateSelector(target.id, state.id);
        _themeUiPropsForTarget(target, state.id).forEach(prop => {
          const colorCss = _themeUiColorCss(config[target.id]?.[state.id]?.[prop.id], autoTone, { rootVars: !!target?.vars });
          const rule = _themeUiRuleForProp(selector, target, state.id, prop.id, colorCss);
          if (rule) rules.push(rule);
        });
      });
    });
    const css = rules.join('\n');
    if (_themeUiApplicationsCss !== css || style.textContent !== css) {
      _themeUiApplicationsCss = css;
      style.textContent = css;
    }
  }

  function ensurePaletteRuntimeStyle() {
    if (document.getElementById('meldex-theme-palette-style')) return;
    const style = document.createElement('style');
    style.id = 'meldex-theme-palette-style';
    style.textContent = `
[data-theme-palette-index="0"]{--theme-slot-color:var(--theme-palette-0)}
[data-theme-palette-index="1"]{--theme-slot-color:var(--theme-palette-1)}
[data-theme-palette-index="2"]{--theme-slot-color:var(--theme-palette-2)}
[data-theme-palette-index="3"]{--theme-slot-color:var(--theme-palette-3)}
[data-theme-palette-index="4"]{--theme-slot-color:var(--theme-palette-4)}
[data-theme-palette-index="5"]{--theme-slot-color:var(--theme-palette-5)}
[data-theme-palette-index="6"]{--theme-slot-color:var(--theme-palette-6)}
[data-theme-palette-index="7"]{--theme-slot-color:var(--theme-palette-7)}
[data-theme-palette-index="8"]{--theme-slot-color:var(--theme-palette-8)}
[data-theme-palette-index="9"]{--theme-slot-color:var(--theme-palette-9)}
`;
    document.head.appendChild(style);
  }

  function getBoardState() {
    try {
      if (typeof bd !== 'undefined') return bd;
    } catch {}
    return global.bd || null;
  }

  function isBoardRenderReady(board) {
    if (!board || !board.path || typeof document === 'undefined') return false;
    const root = (typeof global.bdGetActiveBoardRoot === 'function') ? global.bdGetActiveBoardRoot() : null;
    const canvas = (typeof global.bdGetBoardElement === 'function')
      ? global.bdGetBoardElement('canvas', root)
      : document.getElementById('bd-canvas');
    const nodes = (typeof global.bdGetBoardElement === 'function')
      ? global.bdGetBoardElement('nodes', root)
      : document.getElementById('bd-nodes');
    if (!canvas || !nodes || !canvas.isConnected || !nodes.isConnected) return false;
    if (typeof getComputedStyle === 'function') {
      let el = canvas;
      let guard = 0;
      while (el && el !== document.body && guard < 8) {
        const style = getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        el = el.parentElement;
        guard += 1;
      }
    }
    return true;
  }

  function scheduleBoardRender() {
    const board = getBoardState();
    if (!isBoardRenderReady(board)) return;
    const render = (typeof global.bdRender === 'function') ? global.bdRender : (typeof bdRender === 'function' ? bdRender : null);
    if (typeof render !== 'function') return;
    const token = ++_boardRenderToken;
    const requestFrame = global.requestAnimationFrame || (fn => setTimeout(fn, 16));
    requestFrame(() => {
      if (token !== _boardRenderToken) return;
      if (!isBoardRenderReady(board)) return;
      render();
    });
  }

  function isThemeLight(themeDef) {
    const bg = themeDef?.ui?.cssVars?.['--bg'] || themeDef?.board?.backgroundColor || '';
    const hex = normalizeThemeColor(bg);
    if (!hex) return themeDef?.id === 'builtin-light' || themeDef?.id === 'builtin-pastel';
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return (r * 0.299 + g * 0.587 + b * 0.114) > 150;
  }

  function normalizeThemeStyleVarValue(key, value) {
    const raw = String(value == null ? '' : value).trim();
    if (!raw) return raw;
    const name = String(key || '');
    if (/-left-accent$/i.test(name) && raw === '3px') return '6px';
    if (/-underline$/i.test(name) && raw.toLowerCase() === 'underline') return '2px';
    return raw;
  }

  function withDerivedUiStyleVars(vars) {
    const next = { ...(vars || {}) };
    Object.keys(next).forEach(key => { next[key] = normalizeThemeStyleVarValue(key, next[key]); });
    const isLightSurface = () => {
      const hex = normalizeThemeColor(next['--content-bg'] || next['--bg'] || '');
      if (!hex) return false;
      const r = parseInt(hex.slice(1, 3), 16);
      const g = parseInt(hex.slice(3, 5), 16);
      const b = parseInt(hex.slice(5, 7), 16);
