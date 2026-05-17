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
  };

  global.MeldexThemeManager = api;
  migrateStoredThemeColorSet();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => applyDefaultTheme(getDefaultThemeId(), { silent: true, preserveStoredThemeUi: true, skipHistory: true }), { once: true });
  } else {
    applyDefaultTheme(getDefaultThemeId(), { silent: true, preserveStoredThemeUi: true, skipHistory: true });
  }
})(window);
