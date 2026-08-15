    const source = getThemeById(getDefaultThemeId());
    const colorSet = getThemeColorSet(null, { ignoreOsAccent: true });
    const useOsAccentColor = getUseOsAccentColor();
    const standardPaletteAdjust = typeof global.getStandardPaletteAdjust === 'function'
      ? global.getStandardPaletteAdjust()
      : null;
    const next = {
      id: newCustomThemeId('custom'),
      name: label,
      builtIn: false,
      ui: {
        cssVars: collectCurrentCssVars(),
        themeColorSet: colorSet,
        colorSet,
        palette: colorSet,
        useOsAccentColor,
        standardPaletteAdjust,
        themeUiApplications: getThemeUiApplications(),
        themeUiAutoTone: getThemeUiAutoTone(),
      },
      board: clone(source.board || {}),
    };
    setThemeColorSetOnTheme(next, next.ui.colorSet);
    setThemeColorSlotSettingsOnTheme(next, readCurrentThemeColorSlotSettings());
    setThemeColorExtraSlotSettingsOnTheme(next, readCurrentThemeColorExtraSlotSettings());
    setThemeOsAccentOnTheme(next, useOsAccentColor);
    setThemeStandardPaletteAdjustOnTheme(next, standardPaletteAdjust);
    setThemeUiSettingsOnTheme(next, next.ui.themeUiApplications, next.ui.themeUiAutoTone);
    const list = getCustomThemes();
    list.push(next);
    saveCustomThemes(list);
    return clone(next);
  }

  function createCustomThemeFromTheme(sourceId, name) {
    const source = getThemeById(sourceId || getDefaultThemeId());
    const label = String(name || '').trim() || `${source.name} のコピー`;
    const next = normalizeCustomThemePayload(source, label);
    next.id = newCustomThemeId('custom');
    next.name = label;
    const list = getCustomThemes();
    list.push(next);
    saveCustomThemes(list);
    return clone(next);
  }

  function updateCustomThemeFromCurrent(id, name) {
    const normalized = normalizeThemeId(id);
    const list = getCustomThemes();
    const index = list.findIndex(t => t.id === normalized);
    if (index < 0) return null;
    const current = list[index];
    current.name = String(name || current.name || 'カスタムテーマ').trim();
    current.builtIn = false;
    current.ui = {
      ...(current.ui || {}),
      cssVars: collectCurrentCssVars(),
      useOsAccentColor: getUseOsAccentColor(),
      standardPaletteAdjust: typeof global.getStandardPaletteAdjust === 'function' ? global.getStandardPaletteAdjust() : null,
      themeUiApplications: getThemeUiApplications(),
      themeUiAutoTone: getThemeUiAutoTone(),
    };
    setThemeColorSetOnTheme(current, getThemeColorSet(null, { ignoreOsAccent: true }));
    setThemeColorSlotSettingsOnTheme(current, readCurrentThemeColorSlotSettings());
    setThemeColorExtraSlotSettingsOnTheme(current, readCurrentThemeColorExtraSlotSettings());
    setThemeOsAccentOnTheme(current, current.ui.useOsAccentColor);
    setThemeStandardPaletteAdjustOnTheme(current, current.ui.standardPaletteAdjust);
    setThemeUiSettingsOnTheme(current, current.ui.themeUiApplications, current.ui.themeUiAutoTone);
    list[index] = current;
    saveCustomThemes(list);
    return clone(current);
  }

  function renameCustomTheme(id, name) {
    const label = String(name || '').trim();
    if (!label) return null;
    const normalized = normalizeThemeId(id);
    const list = getCustomThemes();
    const item = list.find(t => t.id === normalized);
    if (!item) return null;
    item.name = label;
    saveCustomThemes(list);
    return clone(item);
  }

  function importCustomTheme(themeDef, fallbackName) {
    const imported = normalizeCustomThemePayload(themeDef?.theme || themeDef, fallbackName);
    const list = getCustomThemes();
    const usedIds = new Set(list.map(t => String(t.id || '')));
    if (usedIds.has(String(imported.id || ''))) imported.id = newCustomThemeId('custom-import');
    const usedNames = new Set(list.map(t => String(t.name || '')));
    const baseName = String(imported.name || fallbackName || 'カスタムテーマ').trim() || 'カスタムテーマ';
    let nextName = baseName;
    let suffix = 0;
    while (usedNames.has(nextName)) {
      suffix += 1;
      nextName = suffix === 1 ? `${baseName} コピー` : `${baseName} コピー ${suffix}`;
    }
    imported.name = nextName;
    list.push(imported);
    saveCustomThemes(list);
    return clone(imported);
  }

  function deleteCustomTheme(id) {
    const normalized = normalizeThemeId(id);
    const list = getCustomThemes();
    const next = list.filter(t => t.id !== normalized);
    if (next.length === list.length) return false;
    saveCustomThemes(next);
    if (getDefaultThemeId() === normalized) setDefaultThemeId('builtin-dark');
    return true;
  }

  function getBoardThemeColorSet(board) {
    if (!board?.themeId) return getThemeColorSet();
    return resolveThemeColorSet(getActiveBoardTheme(board));
  }

  function getBuiltinRainbowPalette() {
    return normalizeThemeColorSet(null, RAINBOW_PALETTE);
  }

  function getRainbowPalette(board) {
    return getBoardThemeColorSet(board);
  }

  function migrateStoredThemeColorSet() {
    const storedPalette = readStoredThemeColorSet();
    if (!storedPalette) return;
    const currentId = getDefaultThemeId();
    const currentTheme = getThemeById(currentId);
    if (themeColorSetsEqual(storedPalette, resolveThemeColorSet(currentTheme))) {
      cancelThemeColorSetCommit();
      try { localStorage.removeItem(THEME_COLOR_SET_KEY); } catch {}
      return;
    }
    const customThemes = getCustomThemes();
    const custom = customThemes.find(t => t.id === currentId);
    if (custom) {
      setThemeColorSetOnTheme(custom, storedPalette);
      saveCustomThemes(customThemes);
      cancelThemeColorSetCommit();
      try { localStorage.removeItem(THEME_COLOR_SET_KEY); } catch {}
      return;
    }
    const promotedSources = _promotedInitialThemeSourcesByTarget();
    if (_initialBuiltinTargetFromId(currentId) && promotedSources.has(currentId)) {
      _updatePromotedInitialThemeSource(currentId, theme => setThemeColorSetOnTheme(theme, storedPalette));
      cancelThemeColorSetCommit();
      try { localStorage.removeItem(THEME_COLOR_SET_KEY); } catch {}
      return;
    }
    const next = normalizeCustomThemePayload(currentTheme, '旧テーマカラー');
    next.id = newCustomThemeId('custom-legacy-palette');
    next.name = '旧テーマカラー';
    setThemeColorSetOnTheme(next, storedPalette);
    customThemes.push(next);
    saveCustomThemes(customThemes);
    setDefaultThemeId(next.id);
    cancelThemeColorSetCommit();
    try { localStorage.removeItem(THEME_COLOR_SET_KEY); } catch {}
  }

  const api = {
    DEFAULT_THEME_KEY,
    CUSTOM_THEMES_KEY,
    THEME_COLOR_SET_KEY,
    THEME_COLOR_SLOT_SETTINGS_KEY,
    THEME_OS_ACCENT_THEME_KEY,
    STANDARD_PALETTE_THEME_KEY,
    STANDARD_PALETTE_ADJUST_STORAGE_KEY,
    THEME_UI_APPLICATIONS_KEY,
    THEME_UI_AUTO_TONE_KEY,
    THEME_OS_ACCENT_KEY,
    THEME_OS_ACCENT_STYLE_KEYS,
    THEME_OS_ACCENT_TEXT_STYLE_KEYS,
    THEME_UI_TARGETS,
    THEME_UI_STATES,
    THEME_UI_PROPS,
    getBuiltInThemes,
    getCustomThemes,
    saveCustomThemes,
    getAllThemes,
    getThemeById,
    getDefaultThemeId,
    setDefaultThemeId,
    applyThemeToDocument,
    applyDefaultTheme,
    applyPaletteTargets,
    getThemeColorSet,
    getThemeAccentPolicy,
    getEffectiveThemeAccent,
    setThemeColorSet,
    resetThemeColorSet,
    getThemeUiApplications,
    saveThemeUiApplications,
    setThemeUiApplication,
    resetThemeUiApplicationTargets,
    resetThemeUiApplications,
    normalizeThemeUiAutoTone,
    getThemeUiAutoTone,
    saveThemeUiAutoTone,
    setThemeUiAutoTone,
    resetThemeUiAutoTone,
    getUseOsAccentColor,
    getOsAccentColor,
    getOsAccentTextColor,
    getAccentTextColor,
    supportsNativeOsAccentColor,
    getOsAccentThemeColorSet,
    refreshOsAccentColor,
    setUseOsAccentColor,
    applyOsAccentColorSetting,
    applyThemeUiApplications,
    normalizeThemeColorSlotSettings,
    setThemeColorSlotSettingsOnTheme,
    applyThemeColorSlotSettingsFromTheme,
    setThemeColorExtraSlotSettingsOnTheme,
    applyThemeColorExtraSlotSettingsFromTheme,
    normalizeThemeOsAccentSetting,
    setThemeOsAccentOnTheme,
    applyThemeOsAccentSettingFromTheme,
    normalizeThemeStandardPaletteAdjust,
    setThemeStandardPaletteAdjustOnTheme,
    applyThemeStandardPaletteAdjustFromTheme,
    normalizeThemeColorSet,
    getBoardThemeColorSet,
    getActiveBoardTheme,
    applyBoardThemeRuntime,
    setBoardTheme,
    themeOptionsHtml,
    createCustomThemeFromCurrent,
    createCustomThemeFromTheme,
    updateCustomThemeFromCurrent,
    renameCustomTheme,
    importCustomTheme,
    deleteCustomTheme,
    getBuiltinRainbowPalette,
    getRainbowPalette,
    // テーマの状態を丸ごと持ち運ぶための入口（gb-theme-sync.js が使う）。
    // 保存キーの一覧と、外から書き換えられたあとの再適用をここへ集約しておかないと、
    // 持ち出し・同期のたびに対象キーの取りこぼしが起きる。
    THEME_SETTINGS_KEYS: THEME_SETTINGS_HISTORY_KEYS,
    refreshThemeSettingsAfterExternalChange: _refreshThemeSettingsAfterHistory,
  };

  global.MeldexThemeManager = api;
  migrateStoredThemeColorSet();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => applyDefaultTheme(getDefaultThemeId(), { silent: true, preserveStoredThemeUi: true, skipHistory: true }), { once: true });
  } else {
    applyDefaultTheme(getDefaultThemeId(), { silent: true, preserveStoredThemeUi: true, skipHistory: true });
  }
})(window);
