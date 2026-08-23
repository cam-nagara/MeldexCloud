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
    const singleAccentPolicy = getThemeAccentPolicy().kind === 'system-or-default';
    const singleAccentText = singleAccentPolicy ? getAccentTextColor(getEffectiveThemeAccent()) : '';
    THEME_UI_TARGETS.forEach(target => {
      _themeUiStatesForTarget(target).forEach(state => {
        const selector = _themeUiStateSelector(target.id, state.id);
        _themeUiPropsForTarget(target, state.id).forEach(prop => {
          const value = config[target.id]?.[state.id]?.[prop.id];
          const backgroundValue = config[target.id]?.[state.id]?.bg;
          const autoForegroundOnAccent = singleAccentPolicy
            && prop.id === 'fg'
            && THEME_UI_AUTO_VALUES.has(_normalizeThemeUiValue(value))
            && _normalizeThemeUiValue(backgroundValue) !== THEME_UI_VALUE_NONE;
          const colorCss = autoForegroundOnAccent
            ? singleAccentText
            : _themeUiColorCss(value, autoTone, { rootVars: !!target?.vars });
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
      return (r * 0.299 + g * 0.587 + b * 0.114) > 150;
    };
    const fallback = (key, sourceKey, value) => {
      if (next[key]) return;
      next[key] = next[sourceKey] || value;
    };
    if (!next['--ui-font']) next['--ui-font'] = 'inherit';
    fallback('--ui-fg-default', '--fg', '#d4d4d4');
    fallback('--ui-bg-control', '--bg3', '#2d2d2d');
    fallback('--ui-bg-control-hover', '--bg4', '#3e3e3e');
    if (!next['--ui-bg-control-active']) next['--ui-bg-control-active'] = 'color-mix(in srgb, var(--accent) 18%, var(--bg3))';
    fallback('--ui-popup-bg', '--bg2', '#252525');
    fallback('--ui-accent', '--accent', '#569cd6');
    if (!next['--accent-bg']) next['--accent-bg'] = 'color-mix(in srgb, var(--accent) 12%, transparent)';
    if (!next['--ui-text-bg']) next['--ui-text-bg'] = 'transparent';
    fallback('--ui-header-fg', '--fg2', '#969696');
    fallback('--ui-header-bg', '--bg3', '#2d2d2d');
    fallback('--ui-header-font', '--ui-font', 'inherit');
    fallback('--ui-toolbar-fg', '--fg', '#d4d4d4');
    fallback('--ui-toolbar-bg', '--bg2', '#252525');
    fallback('--ui-toolbar-font', '--ui-font', 'inherit');
    fallback('--ui-muted-font', '--ui-font', 'inherit');
    fallback('--ui-hover-fg', '--fg', '#d4d4d4');
    fallback('--ui-hover-bg', '--bg4', '#3e3e3e');
    fallback('--content-bg', '--bg', '#1e1e1e');
    fallback('--ui-tooltip-bg', '--ui-popup-bg', '#252525');
    fallback('--ui-tooltip-fg', '--fg', '#d4d4d4');
    fallback('--ui-tooltip-border', '--border', '#333333');
    fallback('--ui-scrollbar-track-bg', '--bg2', '#252525');
    fallback('--ui-scrollbar-thumb-bg', '--bg4', '#3e3e3e');
    fallback('--ui-scrollbar-thumb-hover-bg', '--fg2', '#969696');
    fallback('--ui-pane-tabbar-bg', '--bg2', '#252525');
    fallback('--ui-pane-tab-active-bg', '--bg', '#1e1e1e');
    fallback('--ui-panelset-tabbar-bg', '--ui-pane-tabbar-bg', '#252525');
    fallback('--ui-collapsed-tabbar-bg', '--ui-pane-tabbar-bg', '#252525');
    fallback('--ui-dockbar-bg', '--ui-pane-tabbar-bg', '#252525');
    fallback('--ui-inner-tabbar-bg', '--bg2', '#252525');
    fallback('--ui-inner-tabbar-border', '--border', '#333333');
    if (!next['--ui-inner-tabbar-border-width']) next['--ui-inner-tabbar-border-width'] = '1px';
    fallback('--ui-inner-tab-fg', '--fg2', '#969696');
    if (!next['--ui-inner-tab-bg']) next['--ui-inner-tab-bg'] = 'transparent';
    fallback('--ui-inner-tab-hover-fg', '--ui-hover-fg', '#d4d4d4');
    fallback('--ui-inner-tab-hover-bg', '--ui-hover-bg', '#3e3e3e');
    fallback('--ui-inner-tab-active-fg', '--accent', '#569cd6');
    if (!next['--ui-inner-tab-active-bg-alpha']) next['--ui-inner-tab-active-bg-alpha'] = '14%';
    if (!next['--ui-inner-tab-active-bg']) next['--ui-inner-tab-active-bg'] = 'color-mix(in srgb, var(--ui-inner-tab-active-fg) var(--ui-inner-tab-active-bg-alpha), transparent)';
    fallback('--ui-inner-tab-active-underline', '--ui-inner-tab-active-fg', '#569cd6');
    if (!next['--ui-inner-tab-height']) next['--ui-inner-tab-height'] = '28px';
    if (!next['--ui-inner-tab-padding-x']) next['--ui-inner-tab-padding-x'] = '12px';
    fallback('--ui-inner-tab-font', '--ui-font', 'inherit');
    if (!next['--ui-inner-tab-font-size']) next['--ui-inner-tab-font-size'] = '12px';
    if (!next['--ui-inner-tab-font-weight']) next['--ui-inner-tab-font-weight'] = '500';
    if (!next['--ui-inner-tab-active-font-weight']) next['--ui-inner-tab-active-font-weight'] = '600';
    if (!next['--ui-inner-tab-underline-width']) next['--ui-inner-tab-underline-width'] = '2px';
    if (!next['--ui-fg-strong']) next['--ui-fg-strong'] = '#ffffff';
    fallback('--ui-selection-fg', '--fg', '#ffffff');
    fallback('--ui-selection-bg', '--selection', '#264f78');
    fallback('--ui-range-fill-bg', '--accent', '#569cd6');
    fallback('--ui-range-track-bg', '--border', '#333333');
    fallback('--editor-caret-color', '--accent', '#569cd6');
    if (!next['--editor-caret-width']) next['--editor-caret-width'] = '2px';
    fallback('--db-th-fg', '--fg2', '#969696');
    fallback('--db-th-bg', '--bg3', '#2d2d2d');
    fallback('--db-entity-fg', '--fg', '#d4d4d4');
    fallback('--db-entity-bg', '--content-bg', '#1e1e1e');
    fallback('--db-cell-fg', '--fg', '#d4d4d4');
    if (!next['--db-cell-bg']) next['--db-cell-bg'] = 'transparent';
    fallback('--db-th-font', '--ui-font', 'inherit');
    fallback('--db-entity-font', '--ui-font', 'inherit');
    fallback('--db-cell-font', '--ui-font', 'inherit');
    fallback('--db-active-color', '--editor-caret-color', '#569cd6');
    fallback('--db-active-width', '--editor-caret-width', '2px');
    fallback('--db-status-adopted-color', '--green', '#6a9955');
    fallback('--db-msr-badge-1-bg', '--blue', '#6fa8dc');
    fallback('--db-msr-badge-2-bg', '--green', '#6a9955');
    fallback('--db-msr-badge-3-bg', '--orange', '#ce9178');
    fallback('--db-msr-badge-4-bg', '--red', '#f44747');
    fallback('--db-row-bg', '--content-bg', '#1e1e1e');
    fallback('--db-header-bg', '--db-th-bg', '#2d2d2d');
    fallback('--db-grid-border', '--border', '#333333');
    fallback('--db-border-color', '--db-grid-border', '#333333');
    fallback('--db-selection-color', '--ui-selection-bg', '#264f78');
    fallback('--db-selection-fg', '--ui-selection-fg', '#ffffff');
    fallback('--page-text-bg', '--content-bg', '#252525');
    fallback('--page-link-fg', '--accent2', '#4ec9b0');
    if (!next['--page-link-bg']) next['--page-link-bg'] = 'transparent';
    fallback('--page-link-accent-color', '--page-link-fg', '#4ec9b0');
    fallback('--page-hr-color', '--border', '#333333');
    fallback('--page-quote-border', '--border', '#333333');
    if (!next['--page-quote-bg']) next['--page-quote-bg'] = isLightSurface() ? 'rgba(47,52,64,0.05)' : 'rgba(255,255,255,0.04)';
    if (!next['--page-h2-indent']) next['--page-h2-indent'] = '8px';
    if (!next['--page-h3-indent']) next['--page-h3-indent'] = '16px';
    if (!next['--page-h4-indent']) next['--page-h4-indent'] = '24px';
    if (!next['--page-h5-indent']) next['--page-h5-indent'] = '32px';
    if (!next['--page-h6-indent']) next['--page-h6-indent'] = '40px';
    fallback('--page-table-header-fg', '--page-text-fg', '#d4d4d4');
    fallback('--page-table-header-bg', '--bg3', '#2d2d2d');
    fallback('--page-table-cell-fg', '--page-text-fg', '#d4d4d4');
    if (!next['--page-table-cell-bg']) next['--page-table-cell-bg'] = 'transparent';
    fallback('--page-table-border-color', '--border', '#333333');
    fallback('--page-table-row-hover-bg', '--bg2', '#252525');
    fallback('--page-table-row-hover-fg', '--page-table-cell-fg', '#d4d4d4');
    if (!next['--page-table-border-width']) next['--page-table-border-width'] = '1px';
    if (!next['--page-table-cell-padding-y']) next['--page-table-cell-padding-y'] = '6px';
    if (!next['--page-table-cell-padding-x']) next['--page-table-cell-padding-x'] = '10px';
    if (!next['--page-table-margin-y']) next['--page-table-margin-y'] = '8px';
    if (!next['--page-table-font-size']) next['--page-table-font-size'] = '13px';
    fallback('--page-table-control-fg', '--fg2', '#969696');
    fallback('--page-table-control-bg', '--bg2', '#252525');
    fallback('--page-table-control-border', '--border', '#333333');
    fallback('--page-table-control-hover-fg', '--fg', '#d4d4d4');
    fallback('--page-table-control-hover-bg', '--bg3', '#2d2d2d');
    fallback('--page-table-control-hover-border', '--page-table-control-border', '#333333');
    if (!next['--page-table-control-border-width']) next['--page-table-control-border-width'] = '1px';
    if (!next['--page-table-control-radius']) next['--page-table-control-radius'] = '999px';
    fallback('--page-table-toolbar-fg', '--fg', '#d4d4d4');
    fallback('--page-table-toolbar-bg', '--bg2', '#252525');
    fallback('--page-table-toolbar-border', '--border', '#333333');
    fallback('--page-table-toolbar-button-bg', '--bg3', '#2d2d2d');
    fallback('--page-table-toolbar-button-border', '--border', '#333333');
    fallback('--page-table-toolbar-button-hover-bg', '--bg4', '#3e3e3e');
    fallback('--page-table-toolbar-hover-fg', '--fg', '#d4d4d4');
    if (!next['--page-table-toolbar-border-width']) next['--page-table-toolbar-border-width'] = '1px';
    if (!next['--page-table-toolbar-button-border-width']) next['--page-table-toolbar-button-border-width'] = '1px';
    if (!next['--page-table-toolbar-radius']) next['--page-table-toolbar-radius'] = '4px';
    if (!next['--page-table-toolbar-button-radius']) next['--page-table-toolbar-button-radius'] = '2px';
    fallback('--page-cell-edit-outline-color', '--accent', '#569cd6');
    if (!next['--page-cell-edit-outline-width']) next['--page-cell-edit-outline-width'] = '2px';
    fallback('--page-callout-fg', '--page-text-fg', '#d4d4d4');
    fallback('--page-callout-bg', '--bg3', '#2d2d2d');
    fallback('--page-callout-border', '--border', '#333333');
    if (!next['--page-callout-border-width']) next['--page-callout-border-width'] = '1px';
    if (!next['--page-callout-radius']) next['--page-callout-radius'] = '6px';
    if (!next['--page-callout-gap']) next['--page-callout-gap'] = '10px';
    if (!next['--page-callout-padding-y']) next['--page-callout-padding-y'] = '12px';
    if (!next['--page-callout-padding-x']) next['--page-callout-padding-x'] = '14px';
    if (!next['--page-callout-margin-y']) next['--page-callout-margin-y'] = '8px';
    fallback('--page-callout-icon-fg', '--page-callout-fg', '#d4d4d4');
    fallback('--page-callout-body-fg', '--page-callout-fg', '#d4d4d4');
    if (!next['--page-callout-info-bg']) next['--page-callout-info-bg'] = 'rgba(56,152,236,0.1)';
    if (!next['--page-callout-info-border']) next['--page-callout-info-border'] = 'rgba(56,152,236,0.3)';
    if (!next['--page-callout-warning-bg']) next['--page-callout-warning-bg'] = 'rgba(236,180,56,0.1)';
    if (!next['--page-callout-warning-border']) next['--page-callout-warning-border'] = 'rgba(236,180,56,0.3)';
    if (!next['--page-callout-danger-bg']) next['--page-callout-danger-bg'] = 'rgba(236,56,56,0.1)';
    if (!next['--page-callout-danger-border']) next['--page-callout-danger-border'] = 'rgba(236,56,56,0.3)';
    if (!next['--page-callout-success-bg']) next['--page-callout-success-bg'] = 'rgba(56,180,80,0.1)';
    if (!next['--page-callout-success-border']) next['--page-callout-success-border'] = 'rgba(56,180,80,0.3)';
    fallback('--page-copy-button-fg', '--fg2', '#969696');
    fallback('--page-copy-button-bg', '--bg3', '#2d2d2d');
    fallback('--page-copy-button-border', '--border', '#333333');
    fallback('--page-copy-button-hover-bg', '--bg4', '#3e3e3e');
    fallback('--page-copy-button-hover-fg', '--fg', '#d4d4d4');
    if (!next['--page-copy-button-border-width']) next['--page-copy-button-border-width'] = '1px';
    if (!next['--page-copy-button-radius']) next['--page-copy-button-radius'] = '4px';
    if (!next['--page-copy-button-opacity']) next['--page-copy-button-opacity'] = '0.7';
    fallback('--page-quote-cite-fg', '--fg2', '#969696');
    fallback('--page-quote-cite-link-fg', '--accent', '#569cd6');
    if (!next['--page-quote-cite-opacity']) next['--page-quote-cite-opacity'] = '0.6';
    if (!next['--page-quote-cite-hover-opacity']) next['--page-quote-cite-hover-opacity'] = '1';
    fallback('--page-link-hover-bg', '--bg3', '#2d2d2d');
    if (!next['--page-link-hover-radius']) next['--page-link-hover-radius'] = '2px';
    fallback('--page-code-block-border', '--border', '#333333');
    if (!next['--page-code-block-border-width']) next['--page-code-block-border-width'] = '1px';
    if (!next['--page-code-block-radius']) next['--page-code-block-radius'] = '4px';
    fallback('--page-kbd-fg', '--fg', '#d4d4d4');
    fallback('--page-kbd-bg', '--bg3', '#2d2d2d');
    fallback('--page-kbd-border', '--border', '#333333');
    if (!next['--page-kbd-border-width']) next['--page-kbd-border-width'] = '1px';
    if (!next['--page-kbd-border-bottom-width']) next['--page-kbd-border-bottom-width'] = '2px';
    if (!next['--page-kbd-radius']) next['--page-kbd-radius'] = '4px';
    fallback('--page-kbd-shadow', '--border', '#333333');
    if (!next['--page-details-bg']) next['--page-details-bg'] = 'transparent';
    fallback('--page-details-border', '--border', '#333333');
    fallback('--page-details-summary-fg', '--fg', '#d4d4d4');
    fallback('--page-details-summary-bg', '--bg2', '#252525');
    fallback('--page-details-summary-hover-fg', '--fg', '#d4d4d4');
    fallback('--page-details-summary-hover-bg', '--bg3', '#2d2d2d');
    fallback('--page-details-open-border', '--page-details-border', '#333333');
    if (!next['--page-details-border-width']) next['--page-details-border-width'] = '1px';
    if (!next['--page-details-open-border-width']) next['--page-details-open-border-width'] = '1px';
    if (!next['--page-details-radius']) next['--page-details-radius'] = '4px';
    fallback('--page-heading-icon-fg', '--accent', '#569cd6');
    if (!next['--page-heading-icon-opacity']) next['--page-heading-icon-opacity'] = '0.8';
    fallback('--page-drag-guide-color', '--accent', '#569cd6');
    if (!next['--page-drag-guide-width']) next['--page-drag-guide-width'] = '2px';
    if (!next['--page-dragging-opacity']) next['--page-dragging-opacity'] = '0.4';
    fallback('--page-selection-color', '--ui-selection-bg', '#264f78');
    fallback('--page-selection-fg', '--ui-selection-fg', '#ffffff');
    fallback('--page-caret-color', '--editor-caret-color', '#569cd6');
    fallback('--page-caret-width', '--editor-caret-width', '2px');
    if (!next['--page-margin-x']) next['--page-margin-x'] = '50px';
    if (!next['--page-content-max-width']) next['--page-content-max-width'] = '1200px';
    fallback('--fv-item-bg', '--bg2', '#252525');
    fallback('--fv-item-fg', '--fg', '#d4d4d4');
    if (!next['--fv-item-border']) next['--fv-item-border'] = 'transparent';
    fallback('--fv-item-hover-fg', '--fv-item-fg', '#d4d4d4');
    fallback('--fv-item-hover-bg', '--ui-hover-bg', '#3e3e3e');
    fallback('--fv-item-hover-border', '--fg2', '#969696');
    fallback('--fv-item-selected-bg', '--ui-selection-bg', '#264f78');
    fallback('--fv-item-selected-fg', '--ui-selection-fg', '#ffffff');
    fallback('--fv-item-selected-border', '--accent', '#569cd6');
    fallback('--fv-meta-fg', '--fg2', '#969696');
    fallback('--fv-icon-fg', '--fg2', '#969696');
    fallback('--fv-panel-bg', '--content-bg', '#1e1e1e');
    fallback('--fv-font-family', '--ui-font', 'inherit');
    fallback('--sn2-page-bg', '--content-bg', '#1e1e1e');
    fallback('--sn2-border-color', '--border', '#333333');
    if (!next['--sn2-border-width']) next['--sn2-border-width'] = '1px';
    fallback('--sn2-base-text-color', '--fg', '#d4d4d4');
    fallback('--sn2-base-text-font-family', '--ui-font', 'inherit');
    if (!next['--sn2-base-text-bold']) next['--sn2-base-text-bold'] = 'normal';
    if (!next['--sn2-base-text-italic']) next['--sn2-base-text-italic'] = 'normal';
    if (!next['--sn2-base-text-font-size']) next['--sn2-base-text-font-size'] = '13px';
    fallback('--sn2-spread-border-color', '--sn2-border-color', '#333333');
    if (!next['--sn2-spread-border-width']) next['--sn2-spread-border-width'] = '2px';
    fallback('--sn2-hover-bg', '--ui-hover-bg', '#3e3e3e');
    fallback('--sn2-selection-color', '--ui-selection-bg', '#264f78');
    fallback('--sn2-selection-fg', '--ui-selection-fg', '#ffffff');
    fallback('--sn2-drag-select-color', '--ui-selection-bg', '#264f78');
    fallback('--sn2-drop-color', '--blue', '#4a90d9');
    if (!next['--sn2-drop-width']) next['--sn2-drop-width'] = '2px';
    fallback('--sn2-caret-color', '--editor-caret-color', '#569cd6');
    fallback('--sn2-caret-width', '--editor-caret-width', '2px');
    fallback('--bd-bg', '--content-bg', '#1e1e1e');
    if (!next['--bd-shadow-color']) next['--bd-shadow-color'] = 'rgba(0,0,0,0.25)';
    fallback('--bd-default-font-family', '--ui-font', 'inherit');
    fallback('--bd-selection-color', '--ui-selection-bg', '#264f78');
    fallback('--bd-selection-fg', '--ui-selection-fg', '#ffffff');
    fallback('--bd-caret-color', '--editor-caret-color', '#569cd6');
    fallback('--bd-caret-width', '--editor-caret-width', '2px');
    fallback('--bd-select-rect-color', '--accent', '#569cd6');
    fallback('--bd-group-color', '--accent', '#569cd6');
    fallback('--bd-anchor-color', '--accent', '#569cd6');
    fallback('--bd-link-type-icon-color', '--fg', '#d4d4d4');
    fallback('--cal-bg', '--bg', '#1e1e1e');
    fallback('--cal-fg', '--fg', '#d4d4d4');
    fallback('--cal-font-family', '--ui-font', 'inherit');
    fallback('--cal-toolbar-bg', '--ui-toolbar-bg', '#252525');
    fallback('--cal-toolbar-fg', '--ui-toolbar-fg', '#d4d4d4');
    fallback('--cal-sidebar-bg', '--bg2', '#252525');
    fallback('--cal-sidebar-fg', '--fg', '#d4d4d4');
    fallback('--cal-content-bg', '--content-bg', '#1e1e1e');
    fallback('--cal-panel-bg', '--bg2', '#252525');
    fallback('--cal-panel-fg', '--fg', '#d4d4d4');
    fallback('--cal-header-bg', '--bg3', '#2d2d2d');
    fallback('--cal-header-fg', '--fg2', '#969696');
    fallback('--cal-saturday-fg', '--blue', '#6a9ad1');
    fallback('--cal-sunday-fg', '--red', '#d1696a');
    fallback('--cal-cell-bg', '--content-bg', '#1e1e1e');
    fallback('--cal-cell-hover-bg', '--ui-hover-bg', '#3e3e3e');
    fallback('--cal-cell-hover-fg', '--ui-hover-fg', '#d4d4d4');
    fallback('--cal-today-bg', '--ui-selection-bg', '#264f78');
    fallback('--cal-today-fg', '--ui-selection-fg', '#ffffff');
    fallback('--cal-grid-line', '--border', '#333333');
    fallback('--cal-time-fg', '--fg2', '#969696');
    fallback('--cal-event-bg', '--ui-accent', '#2563eb');
    fallback('--cal-event-fg', '--ui-fg-strong', '#ffffff');
    fallback('--cal-event-border', '--border', 'rgba(0,0,0,0.25)');
    if (!next['--cal-event-create-gap']) next['--cal-event-create-gap'] = '18px';
    fallback('--cal-task-column-bg', '--bg2', '#252525');
    fallback('--cal-task-header-bg', '--bg3', '#2d2d2d');
    fallback('--cal-task-bg', '--content-bg', '#1e1e1e');
    fallback('--cal-task-fg', '--fg', '#d4d4d4');
    fallback('--cal-task-border', '--border', '#333333');
    fallback('--cal-task-priority-urgent-bg', '--red', '#f44747');
    fallback('--cal-task-priority-high-bg', '--orange', '#ce9178');
    fallback('--cal-task-priority-medium-bg', '--blue', '#6fa8dc');
    fallback('--cal-clock-bg', '--bg3', '#2d2d2d');
    fallback('--cal-clock-fg', '--fg', '#d4d4d4');
    fallback('--cal-mini-selected-bg', '--ui-accent', '#2563eb');
    fallback('--cal-mini-selected-fg', '--ui-fg-strong', '#ffffff');
    fallback('--cal-accent', '--ui-accent', '#2563eb');
    fallback('--cal-accent-fg', '--ui-fg-strong', '#ffffff');
    fallback('--cal-now-line-color', '--red', '#f44747');
    fallback('--cal-input-bg', '--content-bg', '#1e1e1e');
    fallback('--cal-input-fg', '--fg', '#d4d4d4');
    fallback('--cal-control-bg', '--bg3', '#2d2d2d');
    fallback('--cal-control-fg', '--fg', '#d4d4d4');
    fallback('--cal-control-border', '--border', '#333333');
    fallback('--cal-muted-fg', '--fg2', '#969696');
    fallback('--cal-scroll-thumb', '--ui-scrollbar-thumb-bg', '#3e3e3e');
    fallback('--cal-scroll-thumb-hover', '--ui-scrollbar-thumb-hover-bg', '#969696');
    fallback('--cal-avatar-bg', '--bg3', '#2d2d2d');
    fallback('--outliner-bg', '--bg2', '#252525');
    fallback('--outliner-fg', '--fg', '#d4d4d4');
    fallback('--outliner-muted-fg', '--fg2', '#969696');
    fallback('--outliner-section-bg', '--ui-header-bg', '#2d2d2d');
    fallback('--outliner-section-fg', '--ui-header-fg', '#969696');
    fallback('--outliner-item-bg', '--bg2', '#252525');
    fallback('--outliner-item-fg', '--fg', '#d4d4d4');
    fallback('--outliner-item-hover-bg', '--ui-hover-bg', '#3e3e3e');
    fallback('--outliner-item-hover-fg', '--ui-hover-fg', '#d4d4d4');
    fallback('--outliner-item-selected-bg', '--ui-selection-bg', '#264f78');
    fallback('--outliner-item-selected-fg', '--ui-selection-fg', '#ffffff');
    fallback('--outliner-border', '--border', '#333333');
    fallback('--outliner-accent', '--accent', '#569cd6');
    fallback('--preview-bg', '--content-bg', '#1e1e1e');
    fallback('--preview-card-bg', '--bg2', '#252525');
    fallback('--preview-fg', '--fg', '#d4d4d4');
    fallback('--preview-muted-fg', '--fg2', '#969696');
    fallback('--preview-border', '--border', '#333333');
    fallback('--preview-hover-bg', '--ui-hover-bg', '#3e3e3e');
    fallback('--preview-accent', '--accent', '#569cd6');
    fallback('--detail-bg', '--content-bg', '#1e1e1e');
    fallback('--detail-panel-bg', '--bg', '#1e1e1e');
    fallback('--detail-fg', '--fg', '#d4d4d4');
    fallback('--detail-muted-fg', '--fg2', '#969696');
    fallback('--detail-border', '--border', '#333333');
    fallback('--detail-hover-bg', '--ui-hover-bg', '#3e3e3e');
    fallback('--detail-active-bg', '--ui-selection-bg', '#264f78');
    fallback('--detail-active-fg', '--ui-selection-fg', '#ffffff');
    fallback('--detail-accent', '--accent', '#569cd6');
    fallback('--chat-bg', '--content-bg', '#1e1e1e');
    fallback('--chat-panel-bg', '--bg2', '#252525');
    fallback('--chat-message-bg', '--bg3', '#2d2d2d');
    fallback('--chat-input-bg', '--content-bg', '#1e1e1e');
    fallback('--chat-input-fg', '--fg', '#d4d4d4');
    fallback('--chat-fg', '--fg', '#d4d4d4');
    fallback('--chat-muted-fg', '--fg2', '#969696');
    fallback('--chat-border', '--border', '#333333');
    fallback('--chat-hover-bg', '--ui-hover-bg', '#3e3e3e');
    fallback('--chat-active-bg', '--ui-accent', '#2563eb');
    fallback('--chat-active-fg', '--ui-fg-strong', '#ffffff');
    fallback('--chat-accent', '--accent', '#569cd6');
    fallback('--timer-bg', '--content-bg', '#1e1e1e');
    fallback('--timer-panel-bg', '--bg2', '#252525');
    fallback('--timer-display-bg', '--content-bg', '#1e1e1e');
    fallback('--timer-fg', '--fg', '#d4d4d4');
    fallback('--timer-muted-fg', '--fg2', '#969696');
    fallback('--timer-border', '--border', '#333333');
    fallback('--timer-hover-bg', '--ui-hover-bg', '#3e3e3e');
    fallback('--timer-active-bg', '--ui-accent', '#2563eb');
    fallback('--timer-active-fg', '--ui-fg-strong', '#ffffff');
    fallback('--timer-accent', '--accent', '#569cd6');
    fallback('--history-bg', '--content-bg', '#1e1e1e');
    fallback('--history-row-bg', '--bg2', '#252525');
    fallback('--history-fg', '--fg', '#d4d4d4');
    fallback('--history-muted-fg', '--fg2', '#969696');
    fallback('--history-border', '--border', '#333333');
    fallback('--history-hover-bg', '--ui-hover-bg', '#3e3e3e');
    fallback('--history-active-bg', '--ui-selection-bg', '#264f78');
    fallback('--history-active-fg', '--ui-selection-fg', '#ffffff');
    fallback('--history-accent', '--accent', '#569cd6');
    fallback('--annotation-bg', '--content-bg', '#1e1e1e');
    fallback('--annotation-card-bg', '--bg2', '#252525');
    fallback('--annotation-fg', '--fg', '#d4d4d4');
    fallback('--annotation-muted-fg', '--fg2', '#969696');
    fallback('--annotation-border', '--border', '#333333');
    fallback('--annotation-hover-bg', '--ui-hover-bg', '#3e3e3e');
    fallback('--annotation-note-bg', '--orange', '#c48080');
    if (!next['--annotation-note-fg']) {
      const noteBg = normalizeThemeColor(next['--annotation-note-bg'] || '');
      next['--annotation-note-fg'] = noteBg && isLightSurface() ? '#ffffff' : '#1e1e1e';
    }
    fallback('--annotation-accent', '--accent', '#569cd6');
    fallback('--search-bg', '--content-bg', '#1e1e1e');
    fallback('--search-panel-bg', '--bg2', '#252525');
    fallback('--search-fg', '--fg', '#d4d4d4');
    fallback('--search-muted-fg', '--fg2', '#969696');
    fallback('--search-border', '--border', '#333333');
    fallback('--search-hover-bg', '--ui-hover-bg', '#3e3e3e');
    fallback('--search-active-bg', '--ui-selection-bg', '#264f78');
    fallback('--search-active-fg', '--ui-selection-fg', '#ffffff');
    fallback('--search-accent', '--accent', '#569cd6');
    fallback('--version-bg', '--content-bg', '#1e1e1e');
    fallback('--version-row-bg', '--bg2', '#252525');
    fallback('--version-fg', '--fg', '#d4d4d4');
    fallback('--version-muted-fg', '--fg2', '#969696');
    fallback('--version-border', '--border', '#333333');
    fallback('--version-hover-bg', '--ui-hover-bg', '#3e3e3e');
    fallback('--version-active-bg', '--ui-accent', '#2563eb');
    fallback('--version-active-fg', '--ui-fg-strong', '#ffffff');
    fallback('--version-accent', '--accent', '#569cd6');
    return next;
  }

  function applyThemeToDocument(themeDef, options = {}) {
    if (!themeDef) return;
    const root = document.documentElement;
    trackExistingThemeVars(root);
    const cssVars = withDerivedUiStyleVars(themeDef.ui?.cssVars || {});
    const computed = getComputedStyle(root);
    Object.entries(cssVars).forEach(([key, value]) => {
      const next = String(value || '').trim();
      if (!next) return;
      const cur = root.style.getPropertyValue(key).trim() || computed.getPropertyValue(key).trim();
      if (cur !== next) root.style.setProperty(key, next);
      _appliedThemeVarKeys.add(key);
    });
    [..._appliedThemeVarKeys].forEach(key => {
      if (Object.prototype.hasOwnProperty.call(cssVars, key)) return;
      if (root.style.getPropertyValue(key)) root.style.removeProperty(key);
      _appliedThemeVarKeys.delete(key);
    });
    if (root.dataset) root.dataset.meldexThemeId = themeDef.id || '';
    root.classList.toggle('light-theme', isThemeLight(themeDef));
    const preservePresetAccent = getThemeAccentPolicy(themeDef).kind === 'system-or-default';
    const osAccentEnabled = applyThemeOsAccentSettingFromTheme(themeDef, {
      preserveStored: preservePresetAccent || options.preserveStoredThemeUi === true || options.preserveStoredOsAccent === true,
    });
    applyThemeStandardPaletteAdjustFromTheme(themeDef, { preserveStored: options.preserveStoredThemeUi === true || options.preserveStoredStandardPalette === true });
    applyOsAccentColorSetting(osAccentEnabled, { restorePrevious: false, themeDef });
    applyThemeUiSettingsFromTheme(themeDef, { preserveStored: options.preserveStoredThemeUi === true });
    applyPaletteTargets(themeDef);
    applyThemeColorSlotSettingsFromTheme(themeDef, { preserveStored: options.preserveStoredThemeUi === true || options.preserveStoredColorSlots === true });
    applyThemeColorExtraSlotSettingsFromTheme(themeDef, { preserveStored: options.preserveStoredThemeUi === true || options.preserveStoredColorSlots === true });
  }

  function applyDefaultTheme(id, options = {}) {
    const before = _captureThemeSettingsStorage(THEME_SETTINGS_HISTORY_KEYS);
    const stored = _withThemeSettingsHistorySuppressed(() => {
      const nextId = setDefaultThemeId(id, { skipHistory: true });
      const shouldResetColorSet = options.resetThemeColorSet === true || (!options.silent && options.resetThemeColorSet !== false);
      if (shouldResetColorSet) {
        cancelThemeColorSetCommit();
        try { localStorage.removeItem(THEME_COLOR_SET_KEY); } catch {}
      }
      const nextThemeDef = getThemeById(nextId);
      applyThemeToDocument(nextThemeDef, options);
      return nextId;
    });
    const themeDef = getThemeById(stored);
    _pushThemeSettingsHistory('設定: テーマ切替', before, THEME_SETTINGS_HISTORY_KEYS, themeDef.name || stored, options);
    scheduleBoardRender();
    global.dispatchEvent(new CustomEvent('meldex-theme-change', { detail: { themeId: stored, resolvedThemeId: themeDef.id } }));
    if (!options.silent && typeof global.showStatus === 'function') global.showStatus(`テーマ「${themeDef.name}」を適用しました`);
    return themeDef;
  }

  function getActiveBoardTheme(board) {
    return getThemeById(board?.themeId || getDefaultThemeId());
  }

  function boardUsesDocumentTheme(board) {
    return !String(board?.themeId || '').trim();
  }

  function applyBoardThemeCssVars(board, canvas, world, themeDef) {
    if (!canvas) return;
    const vars = themeDef?.ui?.cssVars || {};
    const fileStyle = board?._fileStyle && typeof board._fileStyle === 'object' ? board._fileStyle : {};
    const hasFileVar = key => Object.prototype.hasOwnProperty.call(fileStyle, key);
    const prevKeys = canvas.__meldexBoardThemeVarKeys instanceof Set ? canvas.__meldexBoardThemeVarKeys : new Set();
    prevKeys.forEach(key => {
      if (key === '--bd-theme-font-family') {
        canvas.style.removeProperty(key);
        if (world) world.style.removeProperty(key);
      } else if (!hasFileVar(key)) {
        canvas.style.removeProperty(key);
      }
    });
    const nextKeys = new Set();
    if (boardUsesDocumentTheme(board)) {
      canvas.__meldexBoardThemeVarKeys = nextKeys;
      return;
    }
    Object.entries(vars).forEach(([key, value]) => {
      if (!key.startsWith('--bd-') || value === undefined || value === null || value === '') return;
      if (key === '--bd-default-font-family') {
        if (hasFileVar(key)) return;
        const normalized = typeof global.normalizeFontFamilyValue === 'function'
          ? global.normalizeFontFamilyValue(value)
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
      if (options.preserveStored !== true || localStorage.getItem(THEME_UI_APPLICATIONS_KEY) == null) {
        localStorage.setItem(THEME_UI_APPLICATIONS_KEY, JSON.stringify(applications));
        wroteApplications = true;
      }
    } catch {}
    try {
