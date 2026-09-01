      label,
      beforeSnapshot,
      _captureThemeSettingsStorage(keys),
      detail || '',
      _refreshThemeSettingsAfterHistory
    );
  }

  function saveThemeUiAutoTone(tone, options = {}) {
    const next = normalizeThemeUiAutoTone(tone);
    const before = _captureThemeSettingsStorage([THEME_UI_AUTO_TONE_KEY]);
    try { localStorage.setItem(THEME_UI_AUTO_TONE_KEY, JSON.stringify(next)); } catch {}
    _pushThemeSettingsHistory('設定: テーマ自動トーン変更', before, [THEME_UI_AUTO_TONE_KEY], '', options);
    applyThemeUiApplications(getThemeUiApplications());
    dispatchThemeUiAutoToneChange({ tone: next });
    return next;
  }

  function setThemeUiAutoTone(kind, value, options = {}) {
    const key = kind === 'dark' ? 'dark' : 'light';
    const current = getThemeUiAutoTone();
    current[key] = _normalizeThemeUiTonePercent(value, THEME_UI_AUTO_TONE_DEFAULT[key]);
    return saveThemeUiAutoTone(current, options);
  }

  function resetThemeUiAutoTone(options = {}) {
    const before = _captureThemeSettingsStorage([THEME_UI_AUTO_TONE_KEY]);
    try { localStorage.removeItem(THEME_UI_AUTO_TONE_KEY); } catch {}
    _pushThemeSettingsHistory('設定: テーマ自動トーンリセット', before, [THEME_UI_AUTO_TONE_KEY], '', options);
    const next = normalizeThemeUiAutoTone(null);
    applyThemeUiApplications(getThemeUiApplications());
    dispatchThemeUiAutoToneChange({ tone: next, reset: true });
    return next;
  }

  function normalizeThemeUiApplications(raw) {
    const base = _defaultThemeUiApplications();
    const src = raw && typeof raw === 'object' ? raw : {};
    THEME_UI_TARGETS.forEach(target => {
      THEME_UI_STATES.forEach(state => {
        THEME_UI_PROPS.forEach(prop => {
          const value = src?.[target.id]?.[state.id]?.[prop.id];
          if (value !== undefined) base[target.id][state.id][prop.id] = _normalizeThemeUiValue(value);
        });
      });
    });
    const legacySectionBar = src?.['section-bar']?.selected?.underline;
    const nextSectionBar = src?.['section-bar']?.normal?.underline;
    if (legacySectionBar !== undefined && nextSectionBar === undefined) {
      base['section-bar'].normal.underline = _normalizeThemeUiValue(legacySectionBar);
    }
    return base;
  }

  function getThemeUiApplications() {
    try {
      return normalizeThemeUiApplications(JSON.parse(localStorage.getItem(THEME_UI_APPLICATIONS_KEY) || 'null'));
    } catch {
      return normalizeThemeUiApplications(null);
    }
  }

  function saveThemeUiApplications(cfg, options = {}) {
    const next = normalizeThemeUiApplications(cfg);
    const before = _captureThemeSettingsStorage([THEME_UI_APPLICATIONS_KEY]);
    try { localStorage.setItem(THEME_UI_APPLICATIONS_KEY, JSON.stringify(next)); } catch {}
    _pushThemeSettingsHistory('設定: テーマ自動適用変更', before, [THEME_UI_APPLICATIONS_KEY], '', options);
    applyThemeUiApplications(next, { forceTargets: true });
    dispatchThemeUiApplicationsChange({ applications: next });
    return next;
  }

  function setThemeUiApplication(targetId, stateId, propId, value, options = {}) {
    const cfg = getThemeUiApplications();
    if (!cfg[targetId] || !cfg[targetId][stateId] || !(propId in cfg[targetId][stateId])) return cfg;
    cfg[targetId][stateId][propId] = _normalizeThemeUiValue(value);
    return saveThemeUiApplications(cfg, options);
  }

  function resetThemeUiApplications(options = {}) {
    const cfg = _defaultThemeUiApplications();
    const before = _captureThemeSettingsStorage([THEME_UI_APPLICATIONS_KEY]);
    try { localStorage.removeItem(THEME_UI_APPLICATIONS_KEY); } catch {}
    _pushThemeSettingsHistory('設定: テーマ自動適用リセット', before, [THEME_UI_APPLICATIONS_KEY], '', options);
    applyThemeUiApplications(cfg, { forceTargets: true });
    dispatchThemeUiApplicationsChange({ applications: cfg, reset: true });
    return cfg;
  }

  function resetThemeUiApplicationTargets(targetIds) {
    const options = arguments[1] || {};
    const ids = new Set((Array.isArray(targetIds) ? targetIds : [targetIds]).map(id => String(id || '')).filter(Boolean));
    if (!ids.size) return resetThemeUiApplications(options);
    const cfg = getThemeUiApplications();
    const defaults = _defaultThemeUiApplications();
    ids.forEach(id => {
      if (!cfg[id] || !defaults[id]) return;
      cfg[id] = clone(defaults[id]);
    });
    return saveThemeUiApplications(cfg, options);
  }

  function getUseOsAccentColor() {
    try { return localStorage.getItem(THEME_OS_ACCENT_KEY) === '1'; } catch { return false; }
  }

  function hasOsAccentRuntimeColor() {
    return /^#[0-9a-f]{6}$/i.test(_osAccentRuntimeColor);
  }

  function supportsNativeOsAccentColor() {
    try {
      return typeof CSS !== 'undefined'
        && typeof CSS.supports === 'function'
        && CSS.supports('color', 'AccentColor')
        && CSS.supports('color', 'AccentColorText');
    } catch {
      return false;
    }
  }

  function refreshOsAccentColor() {
    if (typeof fetch !== 'function') {
      _osAccentRuntimeAvailable = false;
      _osAccentRuntimeColor = '';
      if (getUseOsAccentColor()) applyOsAccentColorSetting(true, { skipNativeRefresh: true });
      return Promise.resolve(null);
    }
    const apiBase = typeof API_BASE === 'string' ? API_BASE : '/api';
    return fetch(apiBase + '/os-accent-color', { cache: 'no-store' })
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        const color = data?.available === true && /^#[0-9a-f]{6}$/i.test(String(data?.color || '')) ? data.color : '';
        if (!color) {
          _osAccentRuntimeAvailable = false;
          _osAccentRuntimeColor = '';
          if (getUseOsAccentColor()) applyOsAccentColorSetting(true, { skipNativeRefresh: true });
          return null;
        }
        _osAccentRuntimeAvailable = true;
        _osAccentRuntimeColor = color.toLowerCase();
        if (getUseOsAccentColor()) {
          applyOsAccentColorSetting(true, { skipNativeRefresh: true });
          global.dispatchEvent(new CustomEvent('meldex-theme-os-accent-change', { detail: { enabled: true, color: _osAccentRuntimeColor } }));
          global.dispatchEvent(new CustomEvent('meldex-theme-color-set-change', { detail: { colorSet: [_osAccentRuntimeColor] } }));
        }
        return color;
      })
      .catch(() => {
        _osAccentRuntimeAvailable = false;
        _osAccentRuntimeColor = '';
        if (getUseOsAccentColor()) applyOsAccentColorSetting(true, { skipNativeRefresh: true });
        return null;
      });
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
    return (r * 0.299 + g * 0.587 + b * 0.114) > 140 ? '#000000' : '#ffffff';
  }

  function getOsAccentThemeColorSet() {
    return [hasOsAccentRuntimeColor() ? getOsAccentColor() : THEME_OS_ACCENT_CSS];
  }

  function getThemeAccentPolicy(themeOrId) {
    const rawId = typeof themeOrId === 'string'
      ? themeOrId
      : (themeOrId?.id || getDefaultThemeId());
    const resolvedId = resolveThemeId(rawId);
    const preset = BUILTIN_ACCENT_POLICIES[resolvedId];
    return preset ? { ...preset } : { kind: 'theme-palette', defaultColor: '' };
  }

  function getEffectiveThemeAccent(themeOrId, options = {}) {
    const policy = getThemeAccentPolicy(themeOrId);
    if (policy.kind !== 'system-or-default') return '';
    if (options.ignoreOsAccent !== true && getUseOsAccentColor()) {
      if (_osAccentRuntimeAvailable === false && !supportsNativeOsAccentColor()) return policy.defaultColor;
      return hasOsAccentRuntimeColor() ? getOsAccentColor() : THEME_OS_ACCENT_CSS;
    }
    return policy.defaultColor;
  }

  function _effectiveThemeColorSet(colors, fallback, themeDef) {
    // OS／既定アクセントはボタンや選択線などのアクセント対象だけへ適用する。
    // パレット全体を1色へ畳むと、見出し・階層・系列色まで同じアクセント色になる。
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
    const themeDef = options.themeDef || getThemeById(getDefaultThemeId());
    const policy = getThemeAccentPolicy(themeDef);
    const useAvailableOsAccent = policy.kind === 'system-or-default'
      && enabled
      && (_osAccentRuntimeAvailable !== false || supportsNativeOsAccentColor());
    const effectiveAccent = policy.kind === 'system-or-default'
      ? getEffectiveThemeAccent(themeDef, { ignoreOsAccent: !enabled })
      : '';
    if (enabled && options.skipNativeRefresh !== true) refreshOsAccentColor();
    const shouldApplyAccent = useAvailableOsAccent || !!effectiveAccent;
    const appliedAccent = useAvailableOsAccent
      ? (hasOsAccentRuntimeColor() ? getOsAccentColor() : THEME_OS_ACCENT_CSS)
      : effectiveAccent;
    root.style.setProperty('--theme-os-accent', useAvailableOsAccent
      ? (hasOsAccentRuntimeColor() ? getOsAccentColor() : 'AccentColor')
      : (effectiveAccent || policy.defaultColor || 'AccentColor'));
    root.style.setProperty('--theme-os-accent-text', useAvailableOsAccent
      ? getOsAccentTextColor()
      : getAccentTextColor(effectiveAccent));
    THEME_OS_ACCENT_STYLE_KEYS.forEach(key => {
      if (shouldApplyAccent) {
        _rememberBeforeOsAccent(root, key);
        root.style.setProperty(key, appliedAccent);
      } else if (options.restorePrevious === false) {
        _clearOsAccentStyleValue(root, key);
      } else {
        _restoreBeforeOsAccent(root, key);
      }
    });
    THEME_OS_ACCENT_TEXT_STYLE_KEYS.forEach(key => {
      if (shouldApplyAccent) {
        _rememberBeforeOsAccent(root, key);
        root.style.setProperty(key, useAvailableOsAccent ? THEME_OS_ACCENT_TEXT_CSS : getAccentTextColor(effectiveAccent));
      } else if (options.restorePrevious === false) {
        _clearOsAccentStyleValue(root, key);
      } else {
        _restoreBeforeOsAccent(root, key);
      }
    });
    if (!shouldApplyAccent) _osAccentPreviousStyleValues.clear();
    if (shouldApplyAccent) {
      const accentSet = [appliedAccent];
      _activeThemeColorSet = paintThemeColorSet(accentSet, { themeDef });
      if (typeof global.syncThemeColorSetSwatches === 'function') global.syncThemeColorSetSwatches(document, accentSet);
    } else {
      _activeThemeColorSet = paintThemeColorSet(readStoredThemeColorSet() || resolveThemeColorSet(getThemeById(getDefaultThemeId())));
    }
    applyThemeUiApplications(getThemeUiApplications(), { forceTargets: true });
  }

  function getAccentTextColor(color) {
    if (!/^#[0-9a-f]{6}$/i.test(String(color || ''))) return THEME_OS_ACCENT_TEXT_CSS;
    const value = String(color);
    const r = parseInt(value.slice(1, 3), 16);
    const g = parseInt(value.slice(3, 5), 16);
    const b = parseInt(value.slice(5, 7), 16);
    return (r * 0.299 + g * 0.587 + b * 0.114) > 140 ? '#000000' : '#ffffff';
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
    theme('builtin-dark', 'ダーク', DARK_VARS, { bg: '#0b0d10', node: '#242a32', fg: '#d4d4d4', accent: '#569cd6', border: '#3a424d' }, DARK_THEME_COLOR_SET),
    theme('builtin-light', 'ライト', LIGHT_VARS, { bg: '#ffffff', node: '#f0f0f0', fg: '#333333', accent: '#2563eb', border: '#c0c0c0' }, LIGHT_THEME_COLOR_SET, { standardPaletteAdjust: LIGHT_STANDARD_PALETTE_ADJUST }),
    theme('builtin-pastel', 'パステル', PASTEL_VARS, { bg: '#ffffff', node: '#f6f7f9', fg: '#2f3440', accent: '#9b59b6', border: '#d8dee8' }, PASTEL_THEME_COLOR_SET, { standardPaletteAdjust: PASTEL_STANDARD_PALETTE_ADJUST }),
    theme('builtin-earth', 'アースカラー', EARTH_VARS, { bg: '#0f1110', node: '#242824', fg: '#d9ddd8', accent: '#6fa85a', border: '#343a35' }, EARTH_THEME_COLOR_SET, { standardPaletteAdjust: EARTH_STANDARD_PALETTE_ADJUST }),
  ];

  function _promotedInitialThemeIdFromName(name) {
    const label = _themeNameKey(name);
    return INITIAL_BUILTIN_THEME_NAME_MAP[label] || '';
  }

  // 2026-08-12: 「バランス黒」パレット計画（2026-08-09/08-10, DARK_VARS/board更新）より前の
  // builtin-dark 既定値。既存プロファイルの「初回カスタムテーマ整理」機構が、旧デフォルトの
  // まるごとスナップショットを「ユーザーが編集した値」と区別できずに永続昇格させてしまい、
  // 新パレットが常に隠される不具合（app/docs 参照）を修正するためだけに使う参照値。
  // ここに載っている値と完全一致するキーだけを「未編集（当時のデフォルトそのまま）」とみなして
  // 昇格対象から除外する。1色でもこの値と異なれば、必ずユーザー編集として残す
  // （normalizeThemeColor で正規化した後の小文字6桁hexで比較するため、大文字/短縮表記の
  // 保存値も正しく判定できる）。
  const STALE_BUILTIN_PALETTE_CSS_VARS = Object.freeze({
    'builtin-dark': Object.freeze({
      '--bg': '#1e1e1e', '--bg2': '#252525', '--bg3': '#2d2d2d', '--bg4': '#3e3e3e',
      '--border': '#333333',
      '--content-bg': '#252525',
      '--ui-tooltip-bg': '#2d2d2d', '--ui-tooltip-border': '#555555',
      '--ui-scrollbar-track-bg': '#252525', '--ui-scrollbar-thumb-bg': '#3e3e3e',
      '--ui-pane-tabbar-bg': '#252525', '--ui-pane-tab-active-bg': '#1e1e1e',
      '--ui-panelset-tabbar-bg': '#252525', '--ui-collapsed-tabbar-bg': '#252525', '--ui-dockbar-bg': '#252525',
      '--ui-header-bg': '#2d2d2d',
      '--ui-toolbar-bg': '#252525',
      '--ui-hover-bg': '#3e3e3e',
      '--ui-accent': '#2563eb',
      '--db-th-bg': '#2d2d2d', '--db-entity-bg': '#1e1e1e',
      '--page-text-bg': '#252525',
    }),
  });
  const STALE_BUILTIN_PALETTE_BOARD_VARS = Object.freeze({
    'builtin-dark': Object.freeze({
      backgroundColor: '#1e1e1e', nodeBgColor: '#3e3e3e', nodeBorderColor: '#555555',
    }),
  });

  function _stripStaleBuiltinPaletteValues(theme, targetId) {
    if (!theme || !targetId) return theme;
    const staleCssVars = STALE_BUILTIN_PALETTE_CSS_VARS[targetId];
    if (staleCssVars && theme.ui && theme.ui.cssVars) {
      Object.keys(staleCssVars).forEach(key => {
        if (normalizeThemeColor(theme.ui.cssVars[key]) === staleCssVars[key]) delete theme.ui.cssVars[key];
      });
    }
    const staleBoard = STALE_BUILTIN_PALETTE_BOARD_VARS[targetId];
    if (staleBoard && theme.board) {
      Object.keys(staleBoard).forEach(key => {
        if (normalizeThemeColor(theme.board[key]) === staleBoard[key]) delete theme.board[key];
      });
    }
    return theme;
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
      sourceByTarget.forEach((theme, targetId) => _stripStaleBuiltinPaletteValues(theme, targetId));
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
    // src はここでしか消費されない使い捨てのパース結果（呼び出し元を参照）なので、
    // 破壊的に古いデフォルト値だけを除去してから合成してよい。これにより、
    // 書き戻し（_ensureInitialCustomThemeCleanup）を経由しない読み出し経路でも
    // 新しいデフォルトが必ず反映される。
    _stripStaleBuiltinPaletteValues(src, target && target.id);
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
    const palette = _effectiveThemeColorSet(colors, RAINBOW_PALETTE, options.themeDef);
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
    const palette = paintThemeColorSet(storedPalette || themePalette, { themeDef });
    _activeThemeColorSet = palette;
    if (storedPalette && themeColorSetsEqual(storedPalette, themePalette)) {
      try { localStorage.removeItem(THEME_COLOR_SET_KEY); } catch {}
    }
  }

  function getThemeColorSet(themeDef, options = {}) {
    const activePalette = _activeThemeColorSet;
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
