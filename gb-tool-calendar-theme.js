/* ==============================
   gb-tool-calendar-theme.js: Calendar theme integration
   ============================== */

(() => {
  if (typeof window === 'undefined') return;

  const CALENDAR_STYLE_KEY = 'gb:calendar-panel-style';
  const CALENDAR_THEME_TAB = 'スケジュール';
  const CALENDAR_CTX = 'calendar';

  const CALENDAR_STYLE_ROWS = [
    { label: '全体', fg: '--cal-fg', bg: '--cal-bg', text: 'スケジュール', font: '--cal-font-family' },
    { label: 'ツールバー', fg: '--cal-toolbar-fg', bg: '--cal-toolbar-bg', text: 'ツールバー' },
    { label: 'サイドバー', fg: '--cal-sidebar-fg', bg: '--cal-sidebar-bg', text: 'サイドバー' },
    { label: 'コンテンツ', fg: '--cal-fg', text: 'スケジュール面' },
    { label: '右サイドバー', fg: '--cal-panel-fg', bg: '--cal-panel-bg', text: 'オプション' },
    { label: '見出し', fg: '--cal-header-fg', bg: '--cal-header-bg', text: '曜日見出し' },
    { label: '土曜', fg: '--cal-saturday-fg', text: '土' },
    { label: '日曜', fg: '--cal-sunday-fg', text: '日' },
    { label: 'セル', fg: '--cal-fg', bg: '--cal-cell-bg', text: '予定セル' },
    { label: 'セルホバー', fg: '--cal-cell-hover-fg', bg: '--cal-cell-hover-bg', text: 'ホバー' },
    { label: '今日', fg: '--cal-today-fg', bg: '--cal-today-bg', text: '今日' },
    { label: '時刻', fg: '--cal-time-fg', text: '13:00' },
    { label: '罫線', line: '--cal-grid-line', text: '━━' },
    { label: 'イベント', fg: '--cal-event-fg', bg: '--cal-event-bg', line: '--cal-event-border', text: 'イベント' },
    { label: '勤務シフト', fg: '--cal-event-fg', bg: '--cal-shift-work-bg', text: '勤務' },
    { label: '休憩シフト', fg: '--cal-event-fg', bg: '--cal-shift-break-bg', text: '休憩' },
    { label: 'イベント配置', numbers: [{ label: '右余白', key: '--cal-event-create-gap', min: 0, max: 80, step: 1, unit: 'px', fallback: 18 }], text: '18px' },
    { label: '現在時刻バー', fg: '--cal-now-line-color', text: '━━' },
    { label: '入力欄', fg: '--cal-input-fg', bg: '--cal-input-bg', text: '入力欄' },
    { label: '操作ボタン', fg: '--cal-control-fg', bg: '--cal-control-bg', line: '--cal-control-border', text: 'ボタン' },
    { label: '補助表示', fg: '--cal-muted-fg', bg: '--cal-avatar-bg', text: '補助表示' },
    { label: 'アクセント', fg: '--cal-accent-fg', bg: '--cal-accent', text: '選択' },
    { label: 'ToDo列', bg: '--cal-task-column-bg', text: '列' },
    { label: 'ToDo見出し', fg: '--cal-task-fg', bg: '--cal-task-header-bg', text: '見出し' },
    { label: 'ToDo', fg: '--cal-task-fg', bg: '--cal-task-bg', line: '--cal-task-border', text: 'ToDo' },
    { label: '優先度: 緊急', bg: '--cal-task-priority-urgent-bg', text: '緊急' },
    { label: '優先度: 高', bg: '--cal-task-priority-high-bg', text: '高' },
    { label: '優先度: 中', bg: '--cal-task-priority-medium-bg', text: '中' },
    { label: '打刻', fg: '--cal-clock-fg', bg: '--cal-clock-bg', text: '打刻' },
    { label: 'ミニカレンダー選択', fg: '--cal-mini-selected-fg', bg: '--cal-mini-selected-bg', text: '選択日' },
  ];

  const CALENDAR_FS_FIELDS = {
    display: [
      { key: '--cal-bg', label: '全体背景', type: 'color' },
      { key: '--cal-fg', label: '全体文字', type: 'color' },
      { key: '--cal-font-family', label: 'フォント', type: 'select', options: getFontFamilyOptions, normalize: normalizeFontFamilyValue, preview: 'fontSample' },
      { key: '--cal-toolbar-bg', label: 'ツールバー背景', type: 'color' },
      { key: '--cal-toolbar-fg', label: 'ツールバー文字', type: 'color' },
      { key: '--cal-sidebar-bg', label: 'サイドバー背景', type: 'color' },
      { key: '--cal-sidebar-fg', label: 'サイドバー文字', type: 'color' },
      { key: '--cal-panel-bg', label: 'パネル背景', type: 'color' },
      { key: '--cal-panel-fg', label: 'パネル文字', type: 'color' },
      { key: '--cal-header-bg', label: '見出し背景', type: 'color' },
      { key: '--cal-header-fg', label: '見出し文字', type: 'color' },
      { key: '--cal-saturday-fg', label: '土曜文字', type: 'color' },
      { key: '--cal-sunday-fg', label: '日曜文字', type: 'color' },
      { key: '--cal-cell-bg', label: 'セル背景', type: 'color' },
      { key: '--cal-cell-hover-bg', label: 'セルホバー背景', type: 'color' },
      { key: '--cal-cell-hover-fg', label: 'セルホバー文字', type: 'color' },
      { key: '--cal-today-bg', label: '今日背景', type: 'color' },
      { key: '--cal-today-fg', label: '今日文字', type: 'color' },
      { key: '--cal-grid-line', label: '罫線', type: 'color' },
      { key: '--cal-time-fg', label: '時刻文字', type: 'color' },
      { key: '--cal-event-bg', label: 'イベント背景', type: 'color' },
      { key: '--cal-event-fg', label: 'イベント文字', type: 'color' },
      { key: '--cal-event-border', label: 'イベント枠線', type: 'color' },
      { key: '--cal-shift-work-bg', label: '勤務シフト背景', type: 'color' },
      { key: '--cal-shift-break-bg', label: '休憩シフト背景', type: 'color' },
      { key: '--cal-event-create-gap', label: 'イベント右余白', type: 'pxtext' },
      { key: '--cal-task-column-bg', label: 'ToDo列背景', type: 'color' },
      { key: '--cal-task-header-bg', label: 'ToDo見出し背景', type: 'color' },
      { key: '--cal-task-bg', label: 'ToDo背景', type: 'color' },
      { key: '--cal-task-fg', label: 'ToDo文字', type: 'color' },
      { key: '--cal-task-border', label: 'ToDo枠線', type: 'color' },
      { key: '--cal-task-priority-urgent-bg', label: '優先度: 緊急 背景', type: 'color' },
      { key: '--cal-task-priority-high-bg', label: '優先度: 高 背景', type: 'color' },
      { key: '--cal-task-priority-medium-bg', label: '優先度: 中 背景', type: 'color' },
      { key: '--cal-clock-bg', label: '打刻背景', type: 'color' },
      { key: '--cal-clock-fg', label: '打刻文字', type: 'color' },
      { key: '--cal-mini-selected-bg', label: 'ミニカレンダー選択背景', type: 'color' },
      { key: '--cal-mini-selected-fg', label: 'ミニカレンダー選択文字', type: 'color' },
    ],
    editOps: [
      { key: '--cal-accent', label: 'アクセント', type: 'color' },
      { key: '--cal-accent-fg', label: 'アクセント上の文字', type: 'color' },
      { key: '--cal-now-line-color', label: '現在時刻バー', type: 'color' },
      { key: '--cal-input-bg', label: '入力背景', type: 'color' },
      { key: '--cal-input-fg', label: '入力文字', type: 'color' },
      { key: '--cal-control-bg', label: '操作ボタン背景', type: 'color' },
      { key: '--cal-control-fg', label: '操作ボタン文字', type: 'color' },
      { key: '--cal-control-border', label: '操作ボタン枠線', type: 'color' },
      { key: '--cal-muted-fg', label: '補助文字', type: 'color' },
      { key: '--cal-avatar-bg', label: 'ユーザーアイコン背景', type: 'color' },
    ],
  };

  const CALENDAR_FIELD_KEYS = new Set([
    '__themeId',
    '__themeName',
    '__themeSourceId',
    '__useOsAccentColor',
    ...CALENDAR_FS_FIELDS.display.map(field => field.key),
    ...CALENDAR_FS_FIELDS.editOps.map(field => field.key),
  ]);
  for (let i = 0; i < 10; i += 1) CALENDAR_FIELD_KEYS.add(`--theme-palette-${i}`);

  function _calKnownFieldKeys() {
    const keys = new Set(CALENDAR_FIELD_KEYS);
    if (typeof getFileThemePreviewMappedFields === 'function' && typeof _fsResolveSections === 'function') {
      const spec = (typeof _FS_FIELDS !== 'undefined' && _FS_FIELDS[CALENDAR_CTX]) || CALENDAR_FS_FIELDS;
      _fsResolveSections(CALENDAR_CTX, spec).forEach(section => {
        (section.rows || []).forEach(row => {
          if (!row || row.preview === false) return;
          getFileThemePreviewMappedFields(row).forEach(field => {
            const key = String(field?.key || field?.cssVar || '').trim();
            if (key === '__themeId' || key === '__themeName' || key === '__themeSourceId' || key === '__useOsAccentColor' || key.startsWith('--cal-') || key.startsWith('--theme-palette-')) keys.add(key);
          });
        });
      });
    }
    return keys;
  }

  function _calReadStyle() {
    try {
      const parsed = JSON.parse(localStorage.getItem(CALENDAR_STYLE_KEY) || '{}');
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }

  function _calIsLocalCustomThemeId(id) {
    return String(id || '') === (typeof _FILE_STYLE_LOCAL_CUSTOM_THEME_ID !== 'undefined' ? _FILE_STYLE_LOCAL_CUSTOM_THEME_ID : '__fileCustomTheme');
  }

  function _calNormalizeFieldValue(field, value) {
    let raw = value;
    if (field?.type === 'pxtext' && raw !== null && raw !== undefined && raw !== '') {
      raw = String(raw).trim();
      if (raw && !/(px|em|rem|%)$/i.test(raw)) raw += 'px';
    }
    return typeof _fsNormalizeFieldValue === 'function' ? _fsNormalizeFieldValue(field, raw) : raw;
  }

  function _calPaletteVars(themeDef) {
    const vars = {};
    if (typeof MeldexThemeManager !== 'undefined' && typeof MeldexThemeManager.getThemeColorSet === 'function') {
      const colors = MeldexThemeManager.getThemeColorSet(themeDef, { ignoreOsAccent: true });
      if (Array.isArray(colors) && colors.length) {
        for (let i = 0; i < 10; i += 1) vars[`--theme-palette-${i}`] = colors[i % colors.length];
      }
    }
    return vars;
  }

  function _calDerivedThemeVars(vars) {
    const next = { ...(vars || {}) };
    const fallback = (key, sources, value) => {
      if (next[key]) return;
      for (const source of sources) {
        if (next[source]) {
          next[key] = next[source];
          return;
        }
      }
      if (value !== undefined) next[key] = value;
    };
    fallback('--ui-accent', ['--accent'], '#2563eb');
    fallback('--ui-fg-strong', ['--fg'], '#ffffff');
    fallback('--ui-toolbar-bg', ['--bg2', '--bg'], '#252525');
    fallback('--ui-toolbar-fg', ['--fg'], '#d4d4d4');
    fallback('--ui-hover-bg', ['--bg4', '--bg3'], '#3e3e3e');
    fallback('--ui-hover-fg', ['--fg'], '#d4d4d4');
    fallback('--ui-selection-bg', ['--accent', '--ui-accent'], '#264f78');
    fallback('--ui-selection-fg', ['--ui-fg-strong', '--fg'], '#ffffff');
    fallback('--cal-bg', ['--bg'], '#1e1e1e');
    fallback('--cal-fg', ['--fg'], '#d4d4d4');
    fallback('--cal-font-family', ['--ui-font'], 'inherit');
    fallback('--cal-toolbar-bg', ['--ui-toolbar-bg', '--bg2'], '#252525');
    fallback('--cal-toolbar-fg', ['--ui-toolbar-fg', '--fg'], '#d4d4d4');
    fallback('--cal-sidebar-bg', ['--bg2'], '#252525');
    fallback('--cal-sidebar-fg', ['--fg'], '#d4d4d4');
    fallback('--cal-content-bg', ['--content-bg', '--bg'], '#1e1e1e');
    fallback('--cal-panel-bg', ['--bg2'], '#252525');
    fallback('--cal-panel-fg', ['--fg'], '#d4d4d4');
    fallback('--cal-header-bg', ['--bg3', '--bg2'], '#2d2d2d');
    fallback('--cal-header-fg', ['--fg2', '--fg'], '#969696');
    fallback('--cal-saturday-fg', ['--blue'], '#6a9ad1');
    fallback('--cal-sunday-fg', ['--red'], '#d1696a');
    fallback('--cal-cell-bg', ['--content-bg', '--bg'], '#1e1e1e');
    fallback('--cal-cell-hover-bg', ['--ui-hover-bg', '--bg4'], '#3e3e3e');
    fallback('--cal-cell-hover-fg', ['--ui-hover-fg', '--fg'], '#d4d4d4');
    fallback('--cal-today-bg', ['--ui-selection-bg', '--accent'], '#264f78');
    fallback('--cal-today-fg', ['--ui-selection-fg', '--ui-fg-strong'], '#ffffff');
    fallback('--cal-grid-line', ['--border'], '#333333');
    fallback('--cal-time-fg', ['--fg2'], '#969696');
    fallback('--cal-event-bg', ['--ui-accent', '--accent'], '#2563eb');
    fallback('--cal-event-fg', ['--ui-fg-strong', '--fg'], '#ffffff');
    fallback('--cal-event-border', ['--border'], 'rgba(0,0,0,0.25)');
    fallback('--cal-shift-work-bg', ['--orange'], '#d19a66');
    fallback('--cal-shift-break-bg', ['--blue'], '#6a9ad1');
    fallback('--cal-event-create-gap', [], '18px');
    fallback('--cal-task-column-bg', ['--bg2'], '#252525');
    fallback('--cal-task-header-bg', ['--bg3', '--bg2'], '#2d2d2d');
    fallback('--cal-task-bg', ['--content-bg', '--bg'], '#1e1e1e');
    fallback('--cal-task-fg', ['--fg'], '#d4d4d4');
    fallback('--cal-task-border', ['--border'], '#333333');
    fallback('--cal-task-priority-urgent-bg', ['--red'], '#f44747');
    fallback('--cal-task-priority-high-bg', ['--orange'], '#ce9178');
    fallback('--cal-task-priority-medium-bg', ['--blue'], '#6fa8dc');
    fallback('--cal-clock-bg', ['--bg3', '--bg2'], '#2d2d2d');
    fallback('--cal-clock-fg', ['--fg'], '#d4d4d4');
    fallback('--cal-mini-selected-bg', ['--ui-accent', '--accent'], '#2563eb');
    fallback('--cal-mini-selected-fg', ['--ui-fg-strong', '--fg'], '#ffffff');
    fallback('--cal-accent', ['--ui-accent', '--accent'], '#2563eb');
    fallback('--cal-accent-fg', ['--ui-fg-strong', '--fg'], '#ffffff');
    fallback('--cal-now-line-color', ['--red'], '#f44747');
    fallback('--cal-input-bg', ['--content-bg', '--bg'], '#1e1e1e');
    fallback('--cal-input-fg', ['--fg'], '#d4d4d4');
    fallback('--cal-control-bg', ['--bg3', '--bg2'], '#2d2d2d');
    fallback('--cal-control-fg', ['--fg'], '#d4d4d4');
    fallback('--cal-control-border', ['--border'], '#333333');
    fallback('--cal-muted-fg', ['--fg2'], '#969696');
    fallback('--cal-avatar-bg', ['--bg3', '--bg2'], '#2d2d2d');
    return next;
  }

  function _calWriteStyle(style) {
    const clean = {};
    const knownKeys = _calKnownFieldKeys();
    Object.entries(style || {}).forEach(([key, value]) => {
      if (!knownKeys.has(key)) return;
      if (value === null || value === undefined || value === '') return;
      clean[key] = value;
    });
    try {
      if (Object.keys(clean).length) localStorage.setItem(CALENDAR_STYLE_KEY, JSON.stringify(clean));
      else localStorage.removeItem(CALENDAR_STYLE_KEY);
    } catch {}
    return clean;
  }

  function _calThemeVars(style) {
    const id = String(style?.__themeId || '');
    if (_calIsLocalCustomThemeId(id)) return {};
    if (!id || typeof MeldexThemeManager === 'undefined' || typeof MeldexThemeManager.getThemeById !== 'function') return {};
    const themeDef = MeldexThemeManager.getThemeById(id);
    const vars = { ..._calDerivedThemeVars(themeDef?.ui?.cssVars || {}), ..._calPaletteVars(themeDef) };
    ['--cal-content-bg', '--cal-scroll-thumb', '--cal-scroll-thumb-hover'].forEach(key => { delete vars[key]; });
    return vars;
  }

  function _calLocalCustomStyleFromThemeId(id) {
    const sourceId = String(id || '');
    if (!sourceId || _calIsLocalCustomThemeId(sourceId) || typeof MeldexThemeManager === 'undefined' || typeof MeldexThemeManager.getThemeById !== 'function') return null;
    const themeDef = MeldexThemeManager.getThemeById(sourceId);
    const vars = {
      ..._calDerivedThemeVars(themeDef?.ui?.cssVars || {}),
      ..._calPaletteVars(themeDef),
      __themeId: typeof _FILE_STYLE_LOCAL_CUSTOM_THEME_ID !== 'undefined' ? _FILE_STYLE_LOCAL_CUSTOM_THEME_ID : '__fileCustomTheme',
      __themeName: String(themeDef?.name || 'カスタムテーマ'),
      __themeSourceId: sourceId,
    };
    ['--cal-content-bg', '--cal-scroll-thumb', '--cal-scroll-thumb-hover'].forEach(key => { delete vars[key]; });
    return vars;
  }

  function _calAppliedVars(style) {
    const saved = style || _calReadStyle();
    const vars = { ..._calThemeVars(saved), ...saved };
    if ((saved?.__useOsAccentColor === true || saved?.__useOsAccentColor === '1') && typeof _applyFileStyleOsAccentVars === 'function') {
      _applyFileStyleOsAccentVars(vars);
    }
    const out = {};
    Object.entries(vars).forEach(([key, value]) => {
      if (key === '__themeId') return;
      // --theme-palette-* を body に適用するとアプリ全体のパレット参照（タブ色分け等）を
      // スケジュール側の設定で覆い隠してしまうため、body 適用対象から除外する（保存は維持）
      if (!String(key).startsWith('--cal-') && key !== '--theme-os-accent' && key !== '--theme-os-accent-text') return;
      if (key === '--cal-content-bg' || key === '--cal-scroll-thumb' || key === '--cal-scroll-thumb-hover') return;
      if (value !== null && value !== undefined && value !== '') out[key] = value;
    });
    return out;
  }

  function applyCalendarPanelStyle(style) {
    const root = document.body || document.documentElement;
    const next = _calAppliedVars(style);
    if (root.__meldexCalendarStyleVarKeys) {
      root.__meldexCalendarStyleVarKeys.forEach(key => root.style.removeProperty(key));
    }
    const keys = Object.keys(next);
    keys.forEach(key => root.style.setProperty(key, next[key]));
    root.__meldexCalendarStyleVarKeys = keys;
  }

  function _calGetAdapter() {
    return {
      kind: CALENDAR_CTX,
      ctx: CALENDAR_CTX,
      get(field) {
        return _calReadStyle()[field.key];
      },
      saveStyle(style) {
        applyCalendarPanelStyle(_calWriteStyle(style || {}));
      },
      set(field, val) {
        if (typeof _fsEnsureLocalCustomThemeBeforeFieldSet === 'function') {
          _fsEnsureLocalCustomThemeBeforeFieldSet(CALENDAR_CTX, field, this);
        }
        const normalized = _calNormalizeFieldValue(field, val);
        const next = { ..._calReadStyle() };
        if (normalized === null || normalized === undefined || normalized === '') delete next[field.key];
        else next[field.key] = normalized;
        applyCalendarPanelStyle(_calWriteStyle(next));
      },
      applyCss() {
        applyCalendarPanelStyle();
      },
      refresh() {
        applyCalendarPanelStyle();
      },
    };
  }

  function _calCollectSaveVars() {
    const style = _calReadStyle();
    const vars = {};
    _calKnownFieldKeys().forEach(key => {
      if (!String(key).startsWith('--cal-') && !String(key).startsWith('--theme-palette-')) return;
      const value = style[key];
      if (value !== undefined && value !== null && value !== '') vars[key] = value;
    });
    return vars;
  }

  function _calActiveComponent() {
    if (typeof GBLayout === 'undefined' || typeof GBTabs === 'undefined' || typeof getComponentInstance !== 'function') return null;
    const activeTab = GBTabs.getActiveTab?.(GBLayout.activePane);
    if (activeTab?.type !== CALENDAR_CTX) return null;
    const comp = getComponentInstance(activeTab.id);
    return comp instanceof CalendarComponent ? comp : null;
  }

  function _calIsActiveContext() {
    if (typeof CalendarComponent === 'undefined') return false;
    return !!_calActiveComponent();
  }

  function _calRenderFileStyleTab() {
    if (typeof showFileStyleTab === 'function') showFileStyleTab(true);
    if (typeof renderFileStyleTab === 'function') renderFileStyleTab(CALENDAR_CTX);
  }

  function _calInstallThemeDefinitions() {
    if (typeof UI_STYLE_SECTIONS !== 'undefined') {
      UI_STYLE_SECTIONS[CALENDAR_THEME_TAB] = CALENDAR_STYLE_ROWS;
    }
    if (typeof SETTINGS_THEME_STYLE_TABS !== 'undefined' && Array.isArray(SETTINGS_THEME_STYLE_TABS) && !SETTINGS_THEME_STYLE_TABS.includes(CALENDAR_THEME_TAB)) {
      const idx = SETTINGS_THEME_STYLE_TABS.indexOf('ボード');
      SETTINGS_THEME_STYLE_TABS.splice(idx >= 0 ? idx : SETTINGS_THEME_STYLE_TABS.length, 0, CALENDAR_THEME_TAB);
    }
    if (typeof _FS_FIELDS !== 'undefined') {
      _FS_FIELDS[CALENDAR_CTX] = CALENDAR_FS_FIELDS;
    }
  }

  function _calInstallDetailHooks() {
    if (typeof _fsGetStyleForContext === 'function') {
      const original = _fsGetStyleForContext;
      _fsGetStyleForContext = function(ctx) {
        if (ctx === CALENDAR_CTX) return _calReadStyle();
        return original(ctx);
      };
    }

    if (typeof _fsGetAdapter === 'function') {
      const original = _fsGetAdapter;
      _fsGetAdapter = function(ctx) {
        if (ctx === CALENDAR_CTX) return _calGetAdapter();
        return original(ctx);
      };
    }

    if (typeof _fsApplyCurrentStyleRuntime === 'function') {
      const original = _fsApplyCurrentStyleRuntime;
      _fsApplyCurrentStyleRuntime = function(ctx) {
        if (ctx === CALENDAR_CTX) {
          applyCalendarPanelStyle();
          return;
        }
        original(ctx);
      };
    }

    if (typeof _fsCollectThemeSaveVars === 'function') {
      const original = _fsCollectThemeSaveVars;
      _fsCollectThemeSaveVars = function(ctx) {
        if (ctx === CALENDAR_CTX) return _calCollectSaveVars();
        return original(ctx);
      };
    }

    if (typeof _fsResolveSections === 'function') {
      const original = _fsResolveSections;
      _fsResolveSections = function(ctx, spec) {
        if (ctx !== CALENDAR_CTX) return original(ctx, spec);
        const fields = Object.fromEntries([...(spec.display || []), ...(spec.editOps || [])].map(field => [field.key, field]));
        const pick = keys => keys.map(key => fields[key]).filter(Boolean);
        return [
          {
            title: '書式設定',
            rows: [
              { label: '全体', fields: pick(['--cal-fg', '--cal-bg', '--cal-font-family']) },
              { label: 'ツールバー', fields: pick(['--cal-toolbar-fg', '--cal-toolbar-bg']) },
              { label: 'サイドバー', fields: pick(['--cal-sidebar-fg', '--cal-sidebar-bg']) },
              { label: 'コンテンツ', fields: pick(['--cal-fg']) },
              { label: '右サイドバー', fields: pick(['--cal-panel-fg', '--cal-panel-bg']) },
              { label: '見出し', fields: pick(['--cal-header-fg', '--cal-header-bg']) },
              { label: '土日文字', fields: pick(['--cal-saturday-fg', '--cal-sunday-fg']) },
              { label: 'セル', fields: pick(['--cal-cell-bg']) },
              { label: 'セルホバー', fields: pick(['--cal-cell-hover-fg', '--cal-cell-hover-bg']) },
              { label: '今日', fields: pick(['--cal-today-fg', '--cal-today-bg']) },
              { label: '時刻', fields: pick(['--cal-time-fg']) },
              { label: '罫線', fields: pick(['--cal-grid-line']) },
              { label: 'イベント', fields: pick(['--cal-event-fg', '--cal-event-bg', '--cal-event-border']) },
              { label: 'シフト', fields: pick(['--cal-shift-work-bg', '--cal-shift-break-bg']) },
              { label: 'イベント配置', fields: pick(['--cal-event-create-gap']) },
              { label: '現在時刻バー', fields: pick(['--cal-now-line-color']) },
              { label: '入力欄', fields: pick(['--cal-input-fg', '--cal-input-bg']) },
              { label: '操作ボタン', fields: pick(['--cal-control-fg', '--cal-control-bg', '--cal-control-border']) },
              { label: '補助表示', fields: pick(['--cal-muted-fg', '--cal-avatar-bg']) },
              { label: 'アクセント', fields: pick(['--cal-accent', '--cal-accent-fg']) },
              { label: 'ToDo列', fields: pick(['--cal-task-column-bg', '--cal-task-header-bg']) },
              { label: 'ToDo', fields: pick(['--cal-task-fg', '--cal-task-bg', '--cal-task-border']) },
              { label: 'ToDo優先度', fields: pick(['--cal-task-priority-urgent-bg', '--cal-task-priority-high-bg', '--cal-task-priority-medium-bg']) },
              { label: '打刻', fields: pick(['--cal-clock-fg', '--cal-clock-bg']) },
              { label: 'ミニカレンダー選択', fields: pick(['--cal-mini-selected-fg', '--cal-mini-selected-bg']) },
            ],
          },
        ];
      };
    }

    if (typeof renderFileStyleTab === 'function') {
      const original = renderFileStyleTab;
      renderFileStyleTab = function(ctx, hostEl) {
        original(ctx, hostEl);
        if (ctx !== CALENDAR_CTX) return;
        const el = hostEl || document.getElementById('detail-tab-file-style');
        el?.setAttribute('data-calendar-style', '1');
        const desc = el?.querySelector?.('.gb-section-desc');
        if (desc) desc.textContent = '対象: スケジュール';
        applyCalendarPanelStyle();
      };
    }

    if (typeof fileThemeSelect === 'function') {
      const original = fileThemeSelect;
      fileThemeSelect = function(ctx, id) {
        if (ctx !== CALENDAR_CTX) {
          original(ctx, id);
          return;
        }
        const adapter = typeof _fsGetAdapter === 'function' ? _fsGetAdapter(CALENDAR_CTX) : _calGetAdapter();
        if (!adapter) return;
        const nextId = String(id || '');
        if (!nextId) {
          if (typeof _fsPersistStyleViaAdapter === 'function') _fsPersistStyleViaAdapter(CALENDAR_CTX, adapter, null, { label: 'テーマ解除' });
          else adapter.saveStyle?.(null);
          applyCalendarPanelStyle();
          _calRenderFileStyleTab();
          return;
        }
        const nextStyle = _calLocalCustomStyleFromThemeId(nextId);
        if (!nextStyle) return;
        if (typeof _fsPersistStyleViaAdapter === 'function') _fsPersistStyleViaAdapter(CALENDAR_CTX, adapter, nextStyle, { label: 'テーマ変更' });
        else adapter.saveStyle?.(nextStyle);
        applyCalendarPanelStyle();
        _calRenderFileStyleTab();
      };
    }

    if (typeof fileThemeReset === 'function') {
      const original = fileThemeReset;
      fileThemeReset = function(ctx) {
        if (ctx !== CALENDAR_CTX) {
          original(ctx);
          return;
        }
        const id = _calReadStyle().__themeId || '';
        _calWriteStyle(id && !_calIsLocalCustomThemeId(id) ? { __themeId: id } : {});
        applyCalendarPanelStyle();
        _calRenderFileStyleTab();
        if (typeof showStatus === 'function') showStatus('デフォルトに戻しました');
      };
    }

    if (typeof _getCurrentFileStyleContext === 'function') {
      const original = _getCurrentFileStyleContext;
      _getCurrentFileStyleContext = function() {
        if (_calIsActiveContext()) return CALENDAR_CTX;
        return original();
      };
    }
  }

  function _calInstallCalendarHooks() {
    if (typeof CalendarComponent === 'undefined') return;

    CalendarComponent.prototype._syncDetailPanel = function() {
      const detailEl = typeof _resolveDetailEl === 'function' ? _resolveDetailEl() : document.getElementById('rp-detail');
      if (!detailEl) return;
      detailEl.style.display = '';
      if (typeof _ensureDetailTabShell === 'function') _ensureDetailTabShell(detailEl);
      if (typeof showNoteTabs === 'function') showNoteTabs(false);
      if (typeof showDbTabs === 'function') showDbTabs(false);
      if (typeof showBoardTabs === 'function') showBoardTabs(false);
      if (typeof hideBoardNoteTab === 'function') hideBoardNoteTab();
      if (typeof hideScriptnoteDetailTabs === 'function') hideScriptnoteDetailTabs();
      if (typeof showCalendarDetailTabs === 'function') showCalendarDetailTabs(true);
      if (typeof showPublishDetailTab === 'function') showPublishDetailTab(true);
      _calRenderFileStyleTab();
      if (typeof switchDetailTab === 'function') {
        const active = detailEl.querySelector('.detail-tab.gb-inner-tab-active')?.dataset?.detailTab || '';
        if (!['calendar-today', 'calendar-settings', 'calendar-production', 'file-style'].includes(active)) switchDetailTab('file-style');
      }
    };

    const originalRender = CalendarComponent.prototype._render;
    if (typeof originalRender === 'function' && !originalRender.__calendarThemeHooked) {
      const wrapped = function(...args) {
        const ret = originalRender.apply(this, args);
        applyCalendarPanelStyle();
        return ret;
      };
      wrapped.__calendarThemeHooked = true;
      CalendarComponent.prototype._render = wrapped;
    }
  }

  _calInstallThemeDefinitions();
  _calInstallDetailHooks();
  _calInstallCalendarHooks();
  applyCalendarPanelStyle();

  window.applyCalendarPanelStyle = applyCalendarPanelStyle;
  window.readCalendarPanelStyle = _calReadStyle;

  window.addEventListener('meldex-theme-change', () => applyCalendarPanelStyle());
  window.addEventListener('meldex-theme-os-accent-change', () => applyCalendarPanelStyle());
})();
