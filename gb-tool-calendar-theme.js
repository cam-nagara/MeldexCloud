/* ==============================
   gb-tool-calendar-theme.js: Calendar theme integration
   ============================== */

(() => {
  if (typeof window === 'undefined') return;

  const CALENDAR_STYLE_KEY = 'gb:calendar-panel-style';
  const CALENDAR_THEME_TAB = 'カレンダー';
  const CALENDAR_CTX = 'calendar';

  const CALENDAR_STYLE_ROWS = [
    { label: '全体', fg: '--cal-fg', bg: '--cal-bg', text: 'カレンダー', font: '--cal-font-family' },
    { label: 'ツールバー', fg: '--cal-toolbar-fg', bg: '--cal-toolbar-bg', text: 'ツールバー' },
    { label: 'サイドバー', fg: '--cal-sidebar-fg', bg: '--cal-sidebar-bg', text: 'サイドバー' },
    { label: 'コンテンツ', fg: '--cal-fg', text: 'カレンダー面' },
    { label: '右パネル', fg: '--cal-panel-fg', bg: '--cal-panel-bg', text: 'オプション' },
    { label: '見出し', fg: '--cal-header-fg', bg: '--cal-header-bg', text: '曜日見出し' },
    { label: '土曜', fg: '--cal-saturday-fg', text: '土' },
    { label: '日曜', fg: '--cal-sunday-fg', text: '日' },
    { label: 'セル', fg: '--cal-fg', bg: '--cal-cell-bg', text: '予定セル' },
    { label: 'セルホバー', fg: '--cal-cell-hover-fg', bg: '--cal-cell-hover-bg', text: 'ホバー' },
    { label: '今日', fg: '--cal-today-fg', bg: '--cal-today-bg', text: '今日' },
    { label: '時刻', fg: '--cal-time-fg', text: '13:00' },
    { label: '罫線', line: '--cal-grid-line', text: '━━' },
    { label: 'イベント', fg: '--cal-event-fg', bg: '--cal-event-bg', line: '--cal-event-border', text: 'イベント' },
    { label: 'イベント配置', numbers: [{ label: '右余白', key: '--cal-event-create-gap', min: 0, max: 80, step: 1, unit: 'px', fallback: 18 }], text: '18px' },
    { label: '現在時刻バー', fg: '--cal-now-line-color', text: '━━' },
    { label: '入力欄', fg: '--cal-input-fg', bg: '--cal-input-bg', text: '入力欄' },
    { label: '操作ボタン', fg: '--cal-control-fg', bg: '--cal-control-bg', line: '--cal-control-border', text: 'ボタン' },
    { label: '補助表示', fg: '--cal-muted-fg', bg: '--cal-avatar-bg', text: '補助表示' },
    { label: 'アクセント', fg: '--cal-accent', bg: '--cal-accent-fg', text: '選択' },
    { label: 'タスク列', bg: '--cal-task-column-bg', text: '列' },
    { label: 'タスク見出し', fg: '--cal-task-fg', bg: '--cal-task-header-bg', text: '見出し' },
    { label: 'タスク', fg: '--cal-task-fg', bg: '--cal-task-bg', line: '--cal-task-border', text: 'タスク' },
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
      { key: '--cal-event-create-gap', label: 'イベント右余白', type: 'pxtext' },
      { key: '--cal-task-column-bg', label: 'タスク列背景', type: 'color' },
      { key: '--cal-task-header-bg', label: 'タスク見出し背景', type: 'color' },
      { key: '--cal-task-bg', label: 'タスク背景', type: 'color' },
      { key: '--cal-task-fg', label: 'タスク文字', type: 'color' },
      { key: '--cal-task-border', label: 'タスク枠線', type: 'color' },
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
    if (id === '__fileCustomTheme') return {};
    if (!id || typeof MeldexThemeManager === 'undefined' || typeof MeldexThemeManager.getThemeById !== 'function') return {};
    const vars = { ...(MeldexThemeManager.getThemeById(id)?.ui?.cssVars || {}) };
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
      if (key === '__themeId' || !String(key).startsWith('--cal-')) return;
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
        const next = { ..._calReadStyle() };
        if (val === null || val === undefined || val === '') delete next[field.key];
        else next[field.key] = val;
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
      if (!String(key).startsWith('--cal-')) return;
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
              { label: '右パネル', fields: pick(['--cal-panel-fg', '--cal-panel-bg']) },
              { label: '見出し', fields: pick(['--cal-header-fg', '--cal-header-bg']) },
              { label: '土日文字', fields: pick(['--cal-saturday-fg', '--cal-sunday-fg']) },
              { label: 'セル', fields: pick(['--cal-cell-bg']) },
              { label: 'セルホバー', fields: pick(['--cal-cell-hover-fg', '--cal-cell-hover-bg']) },
              { label: '今日', fields: pick(['--cal-today-fg', '--cal-today-bg']) },
              { label: '時刻', fields: pick(['--cal-time-fg']) },
              { label: '罫線', fields: pick(['--cal-grid-line']) },
              { label: 'イベント', fields: pick(['--cal-event-fg', '--cal-event-bg', '--cal-event-border']) },
              { label: 'イベント配置', fields: pick(['--cal-event-create-gap']) },
              { label: '現在時刻バー', fields: pick(['--cal-now-line-color']) },
              { label: '入力欄', fields: pick(['--cal-input-fg', '--cal-input-bg']) },
              { label: '操作ボタン', fields: pick(['--cal-control-fg', '--cal-control-bg', '--cal-control-border']) },
              { label: '補助表示', fields: pick(['--cal-muted-fg', '--cal-avatar-bg']) },
              { label: 'アクセント', fields: pick(['--cal-accent', '--cal-accent-fg']) },
              { label: 'タスク列', fields: pick(['--cal-task-column-bg', '--cal-task-header-bg']) },
              { label: 'タスク', fields: pick(['--cal-task-fg', '--cal-task-bg', '--cal-task-border']) },
              { label: '打刻', fields: pick(['--cal-clock-fg', '--cal-clock-bg']) },
              { label: 'ミニカレンダー選択', fields: pick(['--cal-mini-selected-fg', '--cal-mini-selected-bg']) },
            ],
          },
        ];
      };
    }

    if (typeof renderFileStyleTab === 'function') {
      const original = renderFileStyleTab;
      renderFileStyleTab = function(ctx) {
        original(ctx);
        if (ctx !== CALENDAR_CTX) return;
        const el = document.getElementById('detail-tab-file-style');
        el?.setAttribute('data-calendar-style', '1');
        const desc = el?.querySelector?.('.gb-section-desc');
        if (desc) desc.textContent = '対象: カレンダー';
        applyCalendarPanelStyle();
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
        _calWriteStyle(id ? { __themeId: id } : {});
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
        if (!['calendar-today', 'file-style'].includes(active)) switchDetailTab('file-style');
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
