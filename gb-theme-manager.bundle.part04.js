          : String(value || '').trim();
        if (!normalized) return;
        canvas.style.setProperty('--bd-theme-font-family', normalized);
        if (world) world.style.setProperty('--bd-theme-font-family', normalized);
        nextKeys.add('--bd-theme-font-family');
        return;
      }
      if (hasFileVar(key)) return;
      canvas.style.setProperty(key, String(value));
      nextKeys.add(key);
    });
    canvas.__meldexBoardThemeVarKeys = nextKeys;
  }

  function applyBoardThemeRuntime(board, canvasEl, worldEl) {
    const themeDef = getActiveBoardTheme(board);
    const canvas = canvasEl || document.getElementById('bd-canvas');
    const world = worldEl || document.getElementById('bd-world');
    applyBoardThemeCssVars(board, canvas, world, themeDef);
    if (canvas) {
      const fileStyle = board?._fileStyle && typeof board._fileStyle === 'object' ? board._fileStyle : {};
      const fileStyleBg = String(fileStyle['--bd-bg'] || '').trim();
      const documentBg = typeof global.getCssVar === 'function' ? (global.getCssVar('--bd-bg') || '').trim() : '';
      const bg = fileStyleBg || (boardUsesDocumentTheme(board)
        ? (documentBg || themeDef?.board?.backgroundColor || '')
        : (themeDef?.ui?.cssVars?.['--bd-bg'] || themeDef?.board?.backgroundColor || ''));
      if (typeof global.bdApplyCanvasBackground === 'function') {
        global.bdApplyCanvasBackground(canvas, bg);
      } else {
        canvas.style.background = board?._bgColor || bg;
      }
      canvas.style.setProperty('--bd-theme-line-color', themeDef?.board?.lineColor || '');
    }
    if (world) world.style.filter = themeDef?.board?.globalFilter || '';
    // ファイル固有値が未設定のキーは、テーマ変数を bd プロパティに再同期する
    // （bd._showShadow / bd.autoAlign は JS 側で参照されるため、CSS 変数の追従だけでは不十分）
    if (board) {
      const readBoardThemeVar = (key) => {
        const themed = !boardUsesDocumentTheme(board) && themeDef?.ui?.cssVars?.[key];
        if (themed !== undefined && themed !== null && themed !== false && themed !== '') return String(themed).trim();
        const local = canvas?.style?.getPropertyValue?.(key)?.trim();
        if (local) return local;
        return typeof global.getCssVar === 'function' ? (global.getCssVar(key) || '').trim() : '';
      };
      const fs = board._fileStyle && typeof board._fileStyle === 'object' ? board._fileStyle : null;
      if (!fs || fs['--bd-shadow'] === undefined) {
        const t = readBoardThemeVar('--bd-shadow');
        if (t !== '') {
          board._showShadow = t !== '0';
          if (canvas) canvas.classList.toggle('bd-shadow-on', !!board._showShadow);
        }
      }
      if (!fs || fs['--bd-auto-align'] === undefined) {
        const t = readBoardThemeVar('--bd-auto-align');
        if (t !== '') board.autoAlign = t !== '0';
      }
    }
  }

  function setBoardTheme(board, id) {
    if (!board) return;
    const nextThemeId = _normalizeThemeIdWithPromotedCustom(id) || '';
    if (String(board.themeId || '') === nextThemeId) {
      applyBoardThemeRuntime(board);
      return false;
    }
    if (typeof global.bdPushUndo === 'function') global.bdPushUndo();
    board.themeId = nextThemeId;
    applyBoardThemeRuntime(board);
    if (typeof global.bdRender === 'function' && isBoardRenderReady(board)) global.bdRender();
    if (typeof global.bdDirty === 'function') global.bdDirty();
    const themeDef = getActiveBoardTheme(board);
    if (typeof global.showStatus === 'function') global.showStatus(board.themeId ? `ボードテーマ「${themeDef.name}」を適用しました` : 'ボードテーマをアプリ設定に戻しました');
    return true;
  }

  function themeOptionsHtml(currentId, options = {}) {
    const current = _normalizeThemeIdWithPromotedCustom(currentId || '');
    const includeSystem = options.includeSystem !== false;
    let html = includeSystem ? `<option value="OSに合わせる"${current === 'OSに合わせる' ? ' selected' : ''}>OSに合わせる</option>` : '';
    const resolvedCurrent = current === 'OSに合わせる' ? current : resolveThemeId(current);
    html += getAllThemes().map(t => `<option value="${escAttr(t.id)}"${t.id === resolvedCurrent || t.id === current ? ' selected' : ''}>${escHtml(t.name)}</option>`).join('');
    // Keep a legacy file's current choice visible without offering retired starters to new files.
    if (!getAllThemes().some(theme => theme.id === current)) {
      const legacy = getCustomThemes().find(theme => theme.id === current);
      if (legacy) html += `<option value="${escAttr(legacy.id)}" selected>${escHtml(legacy.name)}（旧テーマ）</option>`;
    }
    return html;
  }

  function escHtml(value) {
    return MeldexEscape.html(value);
  }

  function escAttr(value) {
    return MeldexEscape.attr(value);
  }

  function collectCurrentCssVars() {
    const keys = new Set(Object.keys(DARK_VARS).concat(Object.keys(LIGHT_VARS)));
    if (typeof global.getAllStyleKeys === 'function') global.getAllStyleKeys().forEach(k => keys.add(k));
    const cssVars = {};
    keys.forEach(k => {
      const v = document.documentElement.style.getPropertyValue(k) || getComputedStyle(document.documentElement).getPropertyValue(k);
      if (v) cssVars[k] = v.trim();
    });
    return cssVars;
  }

  function newCustomThemeId(prefix = 'custom') {
    return prefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
  }

  function setThemeColorSetOnTheme(themeDef, colorSet) {
    const next = normalizeThemeColorSet(colorSet, resolveThemeColorSet(themeDef));
    themeDef.themeColorSet = next;
    themeDef[THEME_COLOR_SET_THEME_KEY] = next;
    themeDef.ui = themeDef.ui || {};
    themeDef.ui.themeColorSet = next;
    themeDef.ui[THEME_COLOR_SET_THEME_KEY] = next;
    themeDef.ui.colorSet = next;
    themeDef.ui.palette = next;
    if (themeDef.board?.coloringRule) {
      themeDef.board.coloringRule.palette = next;
      themeDef.board.coloringRule.colorPalette = next;
    }
    return next;
  }

  function setThemeColorSlotSettingsOnTheme(themeDef, slots) {
    if (!themeDef) return null;
    themeDef.ui = themeDef.ui || {};
    const compact = compactThemeColorSlotSettings(slots);
    if (compact) themeDef.ui.themeColorSlotSettings = compact;
    else delete themeDef.ui.themeColorSlotSettings;
    return compact;
  }

  function setThemeColorExtraSlotSettingsOnTheme(themeDef, slots) {
    if (!themeDef) return null;
    themeDef.ui = themeDef.ui || {};
    const compact = compactThemeColorExtraSlotSettings(slots);
    if (compact) themeDef.ui.themeColorExtraSlotSettings = compact;
    else delete themeDef.ui.themeColorExtraSlotSettings;
    return compact;
  }

  function setThemeOsAccentOnTheme(themeDef, enabled) {
    if (!themeDef) return false;
    themeDef.ui = themeDef.ui || {};
    themeDef.ui.useOsAccentColor = normalizeThemeOsAccentSetting(enabled);
    return themeDef.ui.useOsAccentColor;
  }

  function setThemeStandardPaletteAdjustOnTheme(themeDef, adjust) {
    if (!themeDef) return null;
    themeDef.ui = themeDef.ui || {};
    const next = adjust == null ? null : normalizeThemeStandardPaletteAdjust(adjust);
    if (next) themeDef.ui.standardPaletteAdjust = next;
    else delete themeDef.ui.standardPaletteAdjust;
    return next;
  }

  function setThemeUiSettingsOnTheme(themeDef, applications, autoTone) {
    themeDef.ui = themeDef.ui || {};
    themeDef.ui.themeUiApplications = normalizeThemeUiApplications(applications);
    themeDef.ui.themeUiAutoTone = normalizeThemeUiAutoTone(autoTone);
    return themeDef.ui;
  }

  function applyThemeOsAccentSettingFromTheme(themeDef, options = {}) {
    const stored = getUseOsAccentColor();
    const next = themeOsAccentFromTheme(themeDef, null);
    const enabled = next == null && options.preserveStored === true
      ? stored
      : normalizeThemeOsAccentSetting(next, false);
    try { localStorage.setItem(THEME_OS_ACCENT_KEY, enabled ? '1' : '0'); } catch {}
    return enabled;
  }

  function applyThemeStandardPaletteAdjustFromTheme(themeDef, options = {}) {
    if (typeof global.setStandardPaletteAdjust !== 'function') return null;
    const fallback = options.preserveStored === true && typeof global.getStandardPaletteAdjust === 'function'
      ? global.getStandardPaletteAdjust()
      : null;
    const next = themeStandardPaletteAdjustFromTheme(themeDef, fallback);
    return global.setStandardPaletteAdjust(next || normalizeThemeStandardPaletteAdjust(null));
  }

  function applyThemeColorSlotSettingsFromTheme(themeDef, options = {}) {
    let slots = themeColorSlotSettingsFromTheme(themeDef, null);
    let hasStored = false;
    try { hasStored = localStorage.getItem(THEME_COLOR_SLOT_SETTINGS_KEY) != null; } catch {}
    if (options.preserveStored === true && hasStored) {
      slots = compactThemeColorSlotSettings(readStoredThemeColorSlotSettings());
    }
    if (slots) {
      writeStoredThemeColorSlotSettings(slots);
      if (typeof global.computeThemeColorSetFromSlots === 'function') {
        const next = global.computeThemeColorSetFromSlots(undefined, slots);
        if (Array.isArray(next) && next.length) {
          setThemeColorSet(next, { save: true, immediateTargets: true });
          return next;
        }
      }
    } else if (options.preserveStored !== true) {
      writeStoredThemeColorSlotSettings(null);
    }
    return null;
  }

  function applyThemeColorExtraSlotSettingsFromTheme(themeDef, options = {}) {
    let slots = themeColorExtraSlotSettingsFromTheme(themeDef, null);
    let hasStored = false;
    try { hasStored = localStorage.getItem(THEME_COLOR_EXTRA_SLOT_SETTINGS_KEY) != null; } catch {}
    if (options.preserveStored === true && hasStored) {
      slots = compactThemeColorExtraSlotSettings(readStoredThemeColorExtraSlotSettings());
    }
    if (slots) {
      writeStoredThemeColorExtraSlotSettings(slots);
      return slots;
    }
    if (options.preserveStored !== true) {
      writeStoredThemeColorExtraSlotSettings(null);
    }
    return null;
  }

  function applyThemeUiSettingsFromTheme(themeDef, options = {}) {
    const ui = themeDef?.ui || {};
    const applications = normalizeThemeUiApplications(ui.themeUiApplications);
    const autoTone = normalizeThemeUiAutoTone(ui.themeUiAutoTone);
    let wroteApplications = false;
    let wroteAutoTone = false;
    try {
      const raw = localStorage.getItem(THEME_UI_APPLICATIONS_KEY);
      if (options.preserveStored !== true || raw == null) {
        localStorage.setItem(THEME_UI_APPLICATIONS_KEY, _encodeThemeUiApplications(applications));
        wroteApplications = true;
      } else {
        const stored = JSON.parse(raw);
        if (stored?._defaultsVersion !== THEME_UI_DEFAULTS_VERSION) {
          const resolved = resolveSavedThemeUiApplications(themeDef, stored);
          const encoded = JSON.parse(_encodeThemeUiApplications(resolved));
          // Keep the exact pre-repair value for recovery, even if an old
          // explicit choice happens to equal the entire former shipped preset.
          if (JSON.stringify(normalizeThemeUiApplications(stored)) !== JSON.stringify(resolved)) {
            encoded._previousDefaults = stored;
          } else if (stored?._previousDefaults) encoded._previousDefaults = stored._previousDefaults;
          localStorage.setItem(THEME_UI_APPLICATIONS_KEY,
            JSON.stringify(encoded));
          wroteApplications = true;
        }
      }
    } catch {}
    try {
      if (options.preserveStored !== true || localStorage.getItem(THEME_UI_AUTO_TONE_KEY) == null) {
        localStorage.setItem(THEME_UI_AUTO_TONE_KEY, JSON.stringify(autoTone));
        wroteAutoTone = true;
      }
    } catch {}
    // 書き込みがあったら CSS rules を再生成してランタイムへ反映 (以前は localStorage のみ
    // 更新されて `meldex-theme-ui-applications-style` が古い状態のままだった)
    if (wroteApplications || wroteAutoTone) {
      const effectiveApplications = getThemeUiApplications();
      applyThemeUiApplications(effectiveApplications, { forceTargets: true });
      if (wroteApplications && typeof dispatchThemeUiApplicationsChange === 'function') {
        dispatchThemeUiApplicationsChange({ applications: effectiveApplications, fromTheme: true });
      }
      if (wroteAutoTone && typeof dispatchThemeUiAutoToneChange === 'function') {
        dispatchThemeUiAutoToneChange({ tone: autoTone, fromTheme: true });
      }
    }
  }

  function resolveSavedThemeUiApplications(themeDef, stored) {
    const applications = normalizeThemeUiApplications(themeDef?.ui?.themeUiApplications);
    if (!stored || !Object.keys(stored).length) return applications;
    const normalized = normalizeThemeUiApplications(stored);
    if (stored._defaultsVersion === THEME_UI_DEFAULTS_VERSION || themeDef?.builtIn !== true) return normalized;
    // 組み込みテーマの選択中のタブは、v0.7.621 より前は「塗らない・白文字」、v0.7.621〜v0.7.895 は
    // 「アクセント色で塗る」、v0.7.899〜v0.7.926 は「塗らない・下線は自動（タブごとに順番の色）」、
    // 今は「塗らない・白文字・下線はアクセント色一色」（2026-11-28）。
    // 旧標準と全項目が一致する保存値だけを今の標準へ合わせ直し、1項目でも違えば利用者の選択として残す。
    // 以前の v0.7.817 は、塗らないタブの保存値を塗る標準へ移しており、利用者の見た目を書き換えていた。
    const filledTabs = _filledTabsSelectedForBuiltIn(themeDef?.id) || {};
    const sequentialTabs = _sequentialTabsSelectedForBuiltIn(themeDef?.id) || {};
    const tabVariants = [null];
    if (Object.keys(filledTabs).length) {
      tabVariants.push(filledTabs, Object.fromEntries(Object.entries(filledTabs)
        .map(([id, selected]) => [id, { ...selected, bg: THEME_UI_VALUE_NONE }])));
    }
    if (Object.keys(sequentialTabs).length) tabVariants.push(sequentialTabs);
    const withTabs = (cfg, variant) => {
      const next = clone(cfg);
      for (const [id, selected] of Object.entries(variant || {})) {
        if (next[id]) next[id].selected = clone(selected);
      }
      return next;
    };
    // 版4・版5で保存した値は利用者の保存として扱い、その版の標準そのままの形だけを合わせ直す
    // （版4＝塗る標準、版5＝下線が自動＝順番の色の標準）。
    if (stored._defaultsVersion === 4 || stored._defaultsVersion === 5) {
      const former = stored._defaultsVersion === 4 ? filledTabs : sequentialTabs;
      return Object.keys(former).length
        && JSON.stringify(normalized) === JSON.stringify(withTabs(applications, former)) ? applications : normalized;
    }
    const previous = clone(applications);
    previous['folder-panel-folder'].selected.bg = THEME_UI_VALUE_AUTO;
    // Shipped defaults also used white selected text and an unshaded rail.
    // v3 stamped that snapshot unchanged, so a version number alone cannot
    // prove it was repaired. Match the complete former preset, never individual
    // auto-color fields (which may be genuine user choices).
    const whiteTextDefaults = clone(previous);
    whiteTextDefaults['collapse-button'].selected.bg = 'var:--ui-accent';
    const formerBases = [previous, whiteTextDefaults];
    // v1/v2 could stamp the original sequential defaults without upgrading them.
    // Treat that exact snapshot like the unversioned original; a current save
    // (including an intentional auto-color choice) is still returned above.
    if (stored._defaultsVersion == null || [1, 2].includes(stored._defaultsVersion)) {
      const oldTreeDefaults = clone(previous);
      oldTreeDefaults['folder-tree-folder'].selected.bg = THEME_UI_VALUE_AUTO;
      const treeOnlyDefaults = clone(applications);
      treeOnlyDefaults['folder-tree-folder'].selected.bg = THEME_UI_VALUE_AUTO;
      formerBases.push(oldTreeDefaults, treeOnlyDefaults);
    }
    const legacyDefaults = formerBases.flatMap(base => tabVariants.map(variant => withTabs(base, variant)));
    // 今の標準のうち、選択中のタブだけが旧標準の形（v0.7.621〜v0.7.895 の塗り、またはその前の白文字）。
    tabVariants.slice(1).forEach(variant => legacyDefaults.push(withTabs(applications, variant)));
    if (stored._defaultsVersion == null || [1, 2].includes(stored._defaultsVersion)) legacyDefaults.push(_defaultThemeUiApplications());
    // Only exact former builtin defaults migrate. Explicit current auto colors
    // and customized legacy applications retain their original values.
    return legacyDefaults.some(legacy => JSON.stringify(normalized) === JSON.stringify(legacy))
      ? applications : normalized;
  }

  function normalizeCustomThemePayload(themeDef, fallbackName) {
    const src = themeDef && typeof themeDef === 'object' ? clone(themeDef) : {};
    const topLevelCssVars = {};
    Object.entries(src).forEach(([key, value]) => {
      if (key.startsWith('--') && value) topLevelCssVars[key] = value;
    });
    const base = getThemeById(src.defaultThemeId || src.id || getDefaultThemeId());
    const next = {
      ...base,
      ...src,
      id: src.id && !String(src.id).startsWith('builtin-') ? String(src.id) : newCustomThemeId('custom'),
      name: String(src.name || fallbackName || 'カスタムテーマ').trim() || 'カスタムテーマ',
      builtIn: false,
      ui: {
        ...(base.ui || {}),
        ...(src.ui || {}),
        cssVars: { ...(base.ui?.cssVars || {}), ...(src.ui?.cssVars || {}), ...topLevelCssVars },
        themeUiApplications: normalizeThemeUiApplications(src.themeUiApplications || src.ui?.themeUiApplications || base.ui?.themeUiApplications),
        themeUiAutoTone: normalizeThemeUiAutoTone(src.themeUiAutoTone || src.ui?.themeUiAutoTone || base.ui?.themeUiAutoTone),
      },
      board: { ...(base.board || {}), ...(src.board || {}) },
    };
    setThemeColorSetOnTheme(next, rawThemeColorSetFromTheme(src) || base.ui?.colorSet);
    setThemeColorSlotSettingsOnTheme(next, themeColorSlotSettingsFromTheme(src, base.ui?.themeColorSlotSettings));
    setThemeColorExtraSlotSettingsOnTheme(next, themeColorExtraSlotSettingsFromTheme(src, base.ui?.themeColorExtraSlotSettings));
    setThemeOsAccentOnTheme(next, themeOsAccentFromTheme(src, base.ui?.useOsAccentColor));
    setThemeStandardPaletteAdjustOnTheme(next, themeStandardPaletteAdjustFromTheme(src, base.ui?.standardPaletteAdjust));
    return next;
  }

  function createCustomThemeFromCurrent(name) {
    const label = String(name || '').trim();
    if (!label) return null;
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
    const normalized = _normalizeThemeIdWithPromotedCustom(id);
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
    const normalized = _normalizeThemeIdWithPromotedCustom(id);
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
    const normalized = _normalizeThemeIdWithPromotedCustom(id);
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
    getThemeStyleVars: themeDef => withDerivedUiStyleVars(themeDef?.ui?.cssVars || {}),
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
    resolveThemeUiColor: (value, index = 0) => _themeUiColorCss(value, getThemeUiAutoTone(), { paletteIndex: index }),
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

// ---- スマホの上端（時刻・電波の表示の裏）の色（2026-11-27 利用者報告「画面の上の端に黒いグラデがかかる」） ----
// iPhone は上端を、ページの指定する上端の色（theme-color）か、上端に固定された帯の色で塗る。上端の色を濃い黒に
// 固定していたため、アプリの帯と違う色が上から薄くなるグラデーションに見えていた（ライトでは白い帯の上に黒い帯）。
// 画面のいちばん上にある帯の背景色を読み、上端の色の指定と、上端に固定した帯（各ページのCSSの body::before）へ渡す。
(function (global) {
  'use strict';
  if (typeof document === 'undefined' || global.MeldexTopEdgeColor) return;
  let queued = false;
  const clear = color => !color || color === 'transparent' || /^rgba\([^)]*,\s*0\)$/.test(color);
  function topColor() {
    const x = Math.round((global.innerWidth || 0) / 2);
    for (let node = document.elementFromPoint?.(x, 1); node && node !== document.documentElement; node = node.parentElement) {
      const color = getComputedStyle(node).backgroundColor;
      if (!clear(color)) return color;
    }
    for (const node of [document.body, document.documentElement]) {
      const color = node ? getComputedStyle(node).backgroundColor : '';
      if (!clear(color)) return color;
    }
    return '';
  }
  function sync() {
    queued = false;
    const color = topColor();
    if (!color) return;
    const root = document.documentElement;
    // 同じ値なら書かない（監視のある画面で無駄な変更通知を出さない）。
    if (root.style.getPropertyValue('--meldex-top-edge-bg') !== color) root.style.setProperty('--meldex-top-edge-bg', color);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta && meta.getAttribute('content') !== color) meta.setAttribute('content', color);
  }
  function schedule() {
    if (queued) return;
    queued = true;
    // 非表示の画面では描画フレームが来ないことがあるため、タイマーでまとめる。
    setTimeout(sync, 60);
  }
  ['meldex-theme-change', 'resize', 'orientationchange', 'pageshow', 'load'].forEach(name => global.addEventListener(name, schedule));
  document.addEventListener('meldex-cloud-mobile-viewport', schedule);
  document.addEventListener('visibilitychange', schedule);
  // 画面の切替（フォルダツリーの画面・ダイアログ等）で上端の帯が変わる。操作の後に1回だけ読み直す。
  document.addEventListener('pointerup', () => setTimeout(schedule, 300), true);
  // 操作を伴わない画面の切替（読み込み後に開くパネル等）にも追従する。上端の帯が出る狭い画面で、表示中だけ。
  // 読むのは上端の1点だけで、色が変わった時しか書かない。
  setInterval(() => {
    if (document.visibilityState === 'visible' && (global.innerWidth || 0) <= 1024) schedule();
  }, 1500);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', schedule, { once: true });
  else schedule();
  global.MeldexTopEdgeColor = { sync: schedule, color: topColor };
})(window);
