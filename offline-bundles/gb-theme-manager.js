/* gb-theme-manager.part01.js: split from gb-theme-manager.js */
/* gb-theme-manager.js: unified application and board themes */
(function (global) {
  'use strict';

  const DEFAULT_THEME_KEY = 'meldex-default-theme-id';
  const CUSTOM_THEMES_KEY = 'meldex-custom-themes';
  const PROMOTED_INITIAL_THEMES_KEY = 'meldex-promoted-initial-theme-sources';
  const THEME_CUSTOM_CLEANUP_VERSION_KEY = 'meldex-custom-theme-cleanup-version';
  const THEME_CUSTOM_CLEANUP_VERSION = '2026-04-initial-builtins-v3';
  const THEME_COLOR_SET_KEY = 'meldex-theme-color-set';
  const THEME_COLOR_SET_THEME_KEY = '_theme-color-set';
  const THEME_COLOR_SLOT_SETTINGS_KEY = 'meldex-theme-color-slot-settings';
  const THEME_COLOR_SLOT_SETTINGS_THEME_KEY = '_theme-color-slot-settings';
  const THEME_COLOR_EXTRA_SLOT_SETTINGS_KEY = 'meldex-theme-color-extra-slot-settings';
  const THEME_COLOR_EXTRA_SLOT_SETTINGS_THEME_KEY = '_theme-color-extra-slot-settings';
  const THEME_OS_ACCENT_THEME_KEY = '_theme-use-os-accent';
  const STANDARD_PALETTE_THEME_KEY = '_standard-palette-adjust';
  const STANDARD_PALETTE_ADJUST_STORAGE_KEY = 'meldex-standard-palette-adjust';
  const THEME_UI_APPLICATIONS_KEY = 'meldex-theme-ui-applications';
  const THEME_UI_AUTO_TONE_KEY = 'meldex-theme-ui-auto-tone';
  const THEME_COLOR_SET_SIZE = 8;
  const DARK_THEME_COLOR_SET = ['#7fb3ff', '#8fd18d', '#f3d26b', '#f28b82', '#caa6ff', '#77d7d0', '#ff9fc7', '#d0d0d0'];
  const LIGHT_THEME_COLOR_SET = ['#1d4ed8', '#047857', '#b45309', '#166534', '#6d28d9', '#be123c', '#0f766e', '#475569'];
  const PASTEL_THEME_COLOR_SET = ['#7c3aed', '#0f766e', '#b45309', '#be123c', '#2563eb', '#6d28d9', '#047857', '#4b5563'];
  const EARTH_THEME_COLOR_SET = ['#a7d28a', '#d2b07a', '#c99a6a', '#91c789', '#8fb9cc', '#d88978', '#b6c083', '#c7c7a6'];
  const LIGHT_STANDARD_PALETTE_ADJUST = Object.freeze({ hueStart: 0, hueEnd: 320, saturation: 70, brightness: 20, contrast: 50 });
  const PASTEL_STANDARD_PALETTE_ADJUST = Object.freeze({ hueStart: 0, hueEnd: 320, saturation: 30, brightness: 30, contrast: 50 });
  const EARTH_STANDARD_PALETTE_ADJUST = Object.freeze({ hueStart: 0, hueEnd: 130, saturation: 50, brightness: 0, contrast: 50 });
  const GIRLY_THEME_COLOR_SET = ['#c01878', '#b050b0', '#ffc0d8', '#ff80b0', '#ffb060', '#ffd0e0', '#d080a0', '#a04080'];
  const RAINBOW_PALETTE = ['#ff0000', '#ff7f00', '#ffff00', '#00ff00', '#00ffff', '#0000ff', '#8b00ff', '#ff00ff'];
  const GRAYSCALE_THEME_COLOR_SET = ['#1a1a1a', '#2e2e2e', '#555555', '#787878', '#9e9e9e', '#c0c0c0', '#e0e0e0', '#f5f5f5'];
  function _themeNameKey(name) {
    return String(name || '').replace(/\s+/g, '').trim();
  }

  const INITIAL_BUILTIN_THEME_TARGETS = Object.freeze([
    { id: 'builtin-dark', name: 'ダーク', customName: 'ダークカスタム', legacyNames: ['ダーク カスタム'] },
    { id: 'builtin-light', name: 'ライト', customName: 'ライトカスタム', legacyNames: ['ライト カスタム'] },
    { id: 'builtin-pastel', name: 'パステル', customName: 'パステルカスタム', legacyNames: ['パステル カスタム'] },
    { id: 'builtin-earth', name: 'アースカラー', customName: 'アースカラーカスタム', legacyNames: ['アースカラー カスタム'] },
  ]);
  const INITIAL_BUILTIN_THEME_NAME_MAP = Object.freeze(
    INITIAL_BUILTIN_THEME_TARGETS.reduce((acc, item) => {
      [item.name, item.customName, ...(item.legacyNames || [])].forEach(name => {
        acc[_themeNameKey(name)] = item.id;
      });
      return acc;
    }, {})
  );
  const OBSOLETE_INITIAL_CUSTOM_THEME_NAME_KEYS = Object.freeze(new Set([
    'テストテーマ',
    '旧テーマカラー',
    'ネイビー',
    'ネイビーカスタム',
    'ネイビー カスタム',
    'セピア',
    'セピアカスタム',
    'セピア カスタム',
    'フォレスト',
    'フォレストカスタム',
    'フォレスト カスタム',
    'ローズ',
    'ローズカスタム',
    'ローズ カスタム',
    'ガーリー',
    'ガーリーカスタム',
    'ガーリー カスタム',
    'グレースケール',
    'グレースケールカスタム',
    'グレースケール カスタム',
    'レインボーブランチ',
    'レインボー',
    'レインボーカスタム',
    'レインボー カスタム',
    'ゲーミング',
    'ゲーミングカスタム',
    'ゲーミング カスタム',
  ].map(_themeNameKey)));
  let _initialThemeCleanupDone = false;
  let _initialThemeCleanupRunning = false;
  let _activeThemeColorSet = null;
  let _paletteTargetCache = null;
  let _paletteObserver = null;
  let _paletteObserverWaiting = false;
  let _paletteBindRaf = 0;
  let _themeColorSetCommitTimer = 0;
  let _themeColorSetCommitToken = 0;
  let _boardRenderToken = 0;
  let _themeUiApplicationsCss = '';
  const _osAccentPreviousStyleValues = new Map();
  let _osAccentRuntimeColor = '';
  const _appliedThemeVarKeys = new Set();
  let _trackedExistingThemeVars = false;
  const THEME_UI_PROP_FG = 'fg';
  const THEME_UI_PROP_BG = 'bg';
  const THEME_UI_PROP_ACCENT = 'underline';
  const THEME_UI_STATE_NORMAL = 'normal';
  const THEME_UI_STATE_HOVER = 'hover';
  const THEME_UI_STATE_SELECTED = 'selected';
  const BUTTON_UI_PROPS = Object.freeze([THEME_UI_PROP_FG, THEME_UI_PROP_BG]);
  const BUTTON_UI_STATES = Object.freeze([THEME_UI_STATE_NORMAL, THEME_UI_STATE_HOVER, THEME_UI_STATE_SELECTED]);
  const TAB_UI_PROPS = Object.freeze([THEME_UI_PROP_FG, THEME_UI_PROP_BG, THEME_UI_PROP_ACCENT]);
  const SIMPLE_UI_STATES = Object.freeze([THEME_UI_STATE_NORMAL, THEME_UI_STATE_HOVER]);
  const STYLE_TARGET_PROPS = Object.freeze([THEME_UI_PROP_FG, THEME_UI_PROP_BG, THEME_UI_PROP_ACCENT]);
  const STYLE_TARGET_STATES = BUTTON_UI_STATES;
  const STYLE_TARGET_PROP_LABELS = Object.freeze({ fg: '文字', bg: '背景色', underline: '線/アクセント色' });
  const APP_STYLE_UI_TARGETS = Object.freeze([
    { id: 'style-folder', group: 'style', app: 'フォルダ', label: 'フォルダ', props: STYLE_TARGET_PROPS, states: STYLE_TARGET_STATES, propLabels: STYLE_TARGET_PROP_LABELS, vars: {
      normal: { fg: '--fv-item-fg', bg: '--fv-item-bg', underline: '--fv-item-border' },
      hover: { fg: '--fv-item-hover-fg', bg: '--fv-item-hover-bg', underline: '--fv-item-hover-border' },
      selected: { fg: '--fv-item-selected-fg', bg: '--fv-item-selected-bg', underline: '--fv-item-selected-border' },
    } },
    { id: 'style-note', group: 'style', app: 'ノート', label: 'ノート', props: STYLE_TARGET_PROPS, states: STYLE_TARGET_STATES, propLabels: STYLE_TARGET_PROP_LABELS, stateLabels: { hover: 'リンク', selected: '選択/カーソル' }, vars: {
      normal: { fg: '--page-text-fg', underline: ['--page-hr-color', '--page-quote-border', '--page-table-border-color', '--page-table-control-border', '--page-table-toolbar-border', '--page-callout-border', '--page-callout-info-border', '--page-callout-warning-border', '--page-callout-danger-border', '--page-callout-success-border', '--page-copy-button-border', '--page-code-block-border', '--page-kbd-border', '--page-details-border', '--page-details-open-border', '--page-heading-icon-fg', '--page-drag-guide-color'] },
      hover: { fg: ['--page-link-fg', '--page-table-control-hover-fg', '--page-table-toolbar-hover-fg', '--page-copy-button-hover-fg'], bg: ['--page-link-bg', '--page-link-hover-bg', '--page-table-row-hover-bg', '--page-table-control-hover-bg', '--page-table-toolbar-button-hover-bg', '--page-copy-button-hover-bg', '--page-details-summary-hover-bg'], underline: ['--page-link-accent-color', '--page-table-control-hover-border'] },
      selected: { fg: '--page-selection-fg', bg: '--page-selection-color', underline: ['--page-caret-color', '--page-cell-edit-outline-color'] },
    } },
    { id: 'style-scriptnote', group: 'style', app: 'シナリオ', label: 'シナリオ', props: STYLE_TARGET_PROPS, states: STYLE_TARGET_STATES, propLabels: STYLE_TARGET_PROP_LABELS, stateLabels: { selected: '選択/カーソル' }, vars: {
      normal: { fg: '--sn2-base-text-color', underline: '--sn2-border-color' },
      hover: { bg: '--sn2-hover-bg', underline: '--sn2-drop-color' },
      selected: { fg: '--sn2-selection-fg', bg: '--sn2-selection-color', underline: '--sn2-caret-color' },
    } },
    { id: 'style-sheet', group: 'style', app: 'シート', label: 'シート', props: STYLE_TARGET_PROPS, states: STYLE_TARGET_STATES, propLabels: STYLE_TARGET_PROP_LABELS, stateLabels: { normal: 'セル', hover: 'ヘッダー', selected: '選択/アクティブ' }, vars: {
      normal: { fg: '--db-cell-fg', bg: '--db-cell-bg', underline: '--db-grid-border' },
      hover: { fg: '--db-th-fg', bg: '--db-th-bg', underline: '--db-border-color' },
      selected: { fg: '--db-selection-fg', bg: '--db-selection-color', underline: '--db-active-color' },
    } },
    { id: 'style-board', group: 'style', app: 'ボード', label: 'ボード', props: STYLE_TARGET_PROPS, states: STYLE_TARGET_STATES, propLabels: STYLE_TARGET_PROP_LABELS, stateLabels: { normal: 'ボード', hover: '矩形/アンカー', selected: '選択/カーソル' }, vars: {
      normal: { bg: '--bd-bg', underline: '--bd-group-color' },
      hover: { bg: '--bd-select-rect-color', underline: '--bd-anchor-color' },
      selected: { fg: '--bd-selection-fg', bg: '--bd-selection-color', underline: '--bd-caret-color' },
    } },
    { id: 'style-calendar', group: 'style', app: 'スケジュール', label: 'スケジュール', props: STYLE_TARGET_PROPS, states: STYLE_TARGET_STATES, propLabels: STYLE_TARGET_PROP_LABELS, stateLabels: { selected: '今日/選択' }, vars: {
      normal: { fg: '--cal-fg', bg: '--cal-bg', underline: '--cal-grid-line' },
      hover: { fg: '--cal-cell-hover-fg', bg: '--cal-cell-hover-bg' },
      selected: { fg: '--cal-today-fg', bg: '--cal-today-bg', underline: '--cal-now-line-color' },
    } },
    { id: 'style-outliner', group: 'style', app: 'フォルダツリー', label: 'フォルダツリー', props: STYLE_TARGET_PROPS, states: STYLE_TARGET_STATES, propLabels: STYLE_TARGET_PROP_LABELS, stateLabels: { normal: '項目', selected: '選択/ドラッグ' }, vars: {
      normal: { fg: '--outliner-item-fg', bg: '--outliner-item-bg', underline: '--outliner-border' },
      hover: { fg: '--outliner-item-hover-fg', bg: '--outliner-item-hover-bg' },
      selected: { fg: '--outliner-item-selected-fg', bg: '--outliner-item-selected-bg', underline: '--outliner-accent' },
    } },
    { id: 'style-preview', group: 'style', app: 'ビューワー', label: 'ビューワー', props: STYLE_TARGET_PROPS, states: STYLE_TARGET_STATES, propLabels: STYLE_TARGET_PROP_LABELS, stateLabels: { normal: 'カード', selected: 'アクセント' }, vars: {
      normal: { fg: '--preview-fg', underline: '--preview-border' },
      hover: { fg: '--preview-muted-fg', bg: '--preview-hover-bg' },
      selected: { bg: '--preview-card-bg', underline: '--preview-accent' },
    } },
    { id: 'style-detail', group: 'style', app: 'オプション', label: 'オプション', props: STYLE_TARGET_PROPS, states: STYLE_TARGET_STATES, propLabels: STYLE_TARGET_PROP_LABELS, stateLabels: { normal: 'パネル', selected: '選択/アクセント' }, vars: {
      normal: { fg: '--detail-fg', underline: '--detail-border' },
      hover: { bg: '--detail-hover-bg' },
      selected: { fg: '--detail-active-fg', bg: '--detail-active-bg', underline: '--detail-accent' },
    } },
    { id: 'style-chat', group: 'style', app: 'チャット', label: 'チャット', props: STYLE_TARGET_PROPS, states: STYLE_TARGET_STATES, propLabels: STYLE_TARGET_PROP_LABELS, stateLabels: { normal: 'パネル', hover: 'メッセージ', selected: 'タブ/送信' }, vars: {
      normal: { fg: '--chat-fg', underline: '--chat-border' },
      hover: { fg: '--chat-muted-fg', bg: '--chat-message-bg' },
      selected: { fg: '--chat-active-fg', bg: '--chat-active-bg', underline: '--chat-accent' },
    } },
    { id: 'style-timer', group: 'style', app: 'タイマー', label: 'タイマー', props: STYLE_TARGET_PROPS, states: STYLE_TARGET_STATES, propLabels: STYLE_TARGET_PROP_LABELS, stateLabels: { normal: 'パネル', hover: 'リスト', selected: '実行中/操作' }, vars: {
      normal: { fg: '--timer-fg', underline: '--timer-border' },
      hover: { fg: '--timer-muted-fg', bg: '--timer-hover-bg' },
      selected: { fg: '--timer-active-fg', bg: '--timer-active-bg', underline: '--timer-accent' },
    } },
    { id: 'style-history', group: 'style', app: 'ヒストリー', label: 'ヒストリー', props: STYLE_TARGET_PROPS, states: STYLE_TARGET_STATES, propLabels: STYLE_TARGET_PROP_LABELS, stateLabels: { normal: '行', selected: '強調' }, vars: {
      normal: { fg: '--history-fg', underline: '--history-border' },
      hover: { bg: '--history-hover-bg' },
      selected: { fg: '--history-active-fg', bg: '--history-active-bg', underline: '--history-accent' },
    } },
    { id: 'style-annotation', group: 'style', app: '注釈', label: '注釈', props: STYLE_TARGET_PROPS, states: STYLE_TARGET_STATES, propLabels: STYLE_TARGET_PROP_LABELS, stateLabels: { normal: 'パネル', hover: 'カード', selected: '付箋/ツール' }, vars: {
      normal: { fg: '--annotation-fg', underline: '--annotation-border' },
      hover: { bg: '--annotation-hover-bg' },
      selected: { fg: '--annotation-note-fg', bg: '--annotation-note-bg', underline: '--annotation-accent' },
    } },
    { id: 'style-search', group: 'style', app: '検索', label: '検索', props: STYLE_TARGET_PROPS, states: STYLE_TARGET_STATES, propLabels: STYLE_TARGET_PROP_LABELS, stateLabels: { normal: 'パネル', selected: '結果/アクセント' }, vars: {
      normal: { fg: '--search-fg', underline: '--search-border' },
      hover: { bg: '--search-hover-bg' },
      selected: { fg: '--search-active-fg', bg: '--search-active-bg', underline: '--search-accent' },
    } },
    { id: 'style-version', group: 'style', app: 'バージョン管理', label: 'バージョン管理', props: STYLE_TARGET_PROPS, states: STYLE_TARGET_STATES, propLabels: STYLE_TARGET_PROP_LABELS, stateLabels: { normal: '行', selected: '保存/復元' }, vars: {
      normal: { fg: '--version-fg', underline: '--version-border' },
      hover: { bg: '--version-hover-bg' },
      selected: { fg: '--version-active-fg', bg: '--version-active-bg', underline: '--version-accent' },
    } },
  ]);
  const SEQUENTIAL_STYLE_UI_TARGETS = Object.freeze([
    { id: 'folder-tree-folder', group: 'style', app: 'フォルダツリー', label: 'フォルダツリーのフォルダ', props: STYLE_TARGET_PROPS, states: STYLE_TARGET_STATES, propLabels: STYLE_TARGET_PROP_LABELS, stateLabels: { normal: 'フォルダ', selected: '選択/ドラッグ' } },
    { id: 'folder-panel-folder', group: 'style', app: 'フォルダ', label: 'フォルダパネルのフォルダ', props: STYLE_TARGET_PROPS, states: STYLE_TARGET_STATES, propLabels: STYLE_TARGET_PROP_LABELS, stateLabels: { normal: 'フォルダ', selected: '選択' } },
    { id: 'note-heading', group: 'style', app: 'ノート', label: 'ノート見出し', props: STYLE_TARGET_PROPS, states: SIMPLE_UI_STATES, propLabels: STYLE_TARGET_PROP_LABELS },
    { id: 'note-toc-item', group: 'style', app: 'ノート', label: '目次項目', props: BUTTON_UI_PROPS, states: SIMPLE_UI_STATES },
    { id: 'scriptnote-type-dialogue', group: 'style', app: 'シナリオ', label: 'タイプ管理: 台詞', props: STYLE_TARGET_PROPS, states: SIMPLE_UI_STATES, propLabels: STYLE_TARGET_PROP_LABELS, childSelector: '.sn2-detail-cell-input, .sn2-detail-cell-label, .sn2-detail-cell-preview' },
    { id: 'scriptnote-type-action', group: 'style', app: 'シナリオ', label: 'タイプ管理: ト書き', props: STYLE_TARGET_PROPS, states: SIMPLE_UI_STATES, propLabels: STYLE_TARGET_PROP_LABELS, childSelector: '.sn2-detail-cell-input, .sn2-detail-cell-label, .sn2-detail-cell-preview' },
    { id: 'scriptnote-type-heading', group: 'style', app: 'シナリオ', label: 'タイプ管理: 見出し', props: STYLE_TARGET_PROPS, states: SIMPLE_UI_STATES, propLabels: STYLE_TARGET_PROP_LABELS, childSelector: '.sn2-detail-cell-input, .sn2-detail-cell-label, .sn2-detail-cell-preview' },
    { id: 'scriptnote-type-summary', group: 'style', app: 'シナリオ', label: 'タイプ管理: プロット', props: STYLE_TARGET_PROPS, states: SIMPLE_UI_STATES, propLabels: STYLE_TARGET_PROP_LABELS, childSelector: '.sn2-detail-cell-input, .sn2-detail-cell-label, .sn2-detail-cell-preview' },
    { id: 'scriptnote-type-break', group: 'style', app: 'シナリオ', label: 'タイプ管理: 区切り', props: STYLE_TARGET_PROPS, states: SIMPLE_UI_STATES, propLabels: STYLE_TARGET_PROP_LABELS, childSelector: '.sn2-detail-cell-input, .sn2-detail-cell-label, .sn2-detail-cell-preview' },
  ]);
  const THEME_UI_TARGETS = Object.freeze([
    { id: 'left-chrome', group: 'ui', label: '左クロームのボタン', props: BUTTON_UI_PROPS, states: BUTTON_UI_STATES },
    { id: 'button', group: 'ui', label: '共通ボタン', props: BUTTON_UI_PROPS, states: BUTTON_UI_STATES, vars: {
      normal: { fg: '--ui-fg-default', bg: '--ui-bg-control' },
      hover: { fg: '--ui-hover-fg', bg: '--ui-bg-control-hover' },
      selected: { fg: '--ui-fg-strong', bg: ['--ui-accent', '--ui-bg-control-active', '--accent'] },
    } },
    { id: 'panel-tab', group: 'ui', label: 'パネルタブ', props: TAB_UI_PROPS, states: BUTTON_UI_STATES },
    { id: 'inner-tab', group: 'ui', label: 'パネル内タブ', props: TAB_UI_PROPS, states: BUTTON_UI_STATES },
    { id: 'collapse-button', group: 'ui', label: '折りたたみバーのボタン', props: BUTTON_UI_PROPS, states: BUTTON_UI_STATES },
    { id: 'folder-section', group: 'ui', label: 'フォルダツリーの見出し', props: BUTTON_UI_PROPS, states: SIMPLE_UI_STATES },
    { id: 'folder', group: 'ui', label: 'フォルダツリー項目', props: BUTTON_UI_PROPS, states: BUTTON_UI_STATES },
    { id: 'section-bar', group: 'ui', label: 'パネル内セクション', props: TAB_UI_PROPS, states: Object.freeze([THEME_UI_STATE_NORMAL]), propLabels: { underline: '左アクセント色' } },
    ...APP_STYLE_UI_TARGETS,
    ...SEQUENTIAL_STYLE_UI_TARGETS,
  ]);
  const THEME_UI_STATES = Object.freeze([
    { id: THEME_UI_STATE_NORMAL, label: '通常時' },
    { id: THEME_UI_STATE_HOVER, label: 'ホバー時' },
    { id: THEME_UI_STATE_SELECTED, label: '選択時' },
  ]);
  const THEME_UI_PROPS = Object.freeze([
    { id: THEME_UI_PROP_FG, label: 'アイコン＆テキスト' },
    { id: THEME_UI_PROP_BG, label: '背景色' },
    { id: THEME_UI_PROP_ACCENT, label: '線/アクセント色' },
  ]);
  const PALETTE_TARGET_SPECS = Object.freeze([
    ['.left-chrome-command-trigger, .left-chrome-user, .left-chrome-help, .left-chrome-trash, .left-chrome-settings, .left-chrome-floating-btn', 'left-chrome'],
    ['.gb-pane-tabs > .gb-pane-tabs-scroll > .gb-tab', 'pane-tab'],
    ['#detail-tab-bar .gb-inner-tab, #detail-tab-bar .detail-tab, .gb-tabbar .gb-inner-tab, .gb-tabbar .detail-tab, .cs-tab', 'detail-tab'],
    ['.gb-panelset-tabbar > button, .gb-panelset-tabbar > .gb-panel-tab', 'panelset-tab'],
    ['.gb-split-collapsed-icon, .gb-split-expand-btn, .gb-dock-icon, .gb-pane-collapsed > .gb-pane-tabs .gb-tab, .gb-pane-collapse', 'collapse-button'],
    ['.sidebar-section-header, .sidebar-header', 'folder-section'],
    ['.tree-node-row:not([data-item-type="folder"]), .sidebar-section-body .fav-item, .sidebar-item', 'folder'],
    ['.tree-node-row[data-item-type="folder"]', 'folder-tree-folder'],
    ['#folder-grid .fv-item[data-item-type="folder"]', 'folder-panel-folder'],
    ['#page-content h1, #page-content h2, #page-content h3, #page-content h4, #page-content h5, #page-content h6, #entity-freetext h1, #entity-freetext h2, #entity-freetext h3, #entity-freetext h4, #entity-freetext h5, #entity-freetext h6, #dp-editable h1, #dp-editable h2, #dp-editable h3, #dp-editable h4, #dp-editable h5, #dp-editable h6', 'note-heading'],
    ['#note-toc .note-toc-item', 'note-toc-item'],
    ['.sn2-detail-item[data-kind="dialogue"]', 'scriptnote-type-dialogue'],
    ['.sn2-detail-item[data-kind="action"]', 'scriptnote-type-action'],
    ['.sn2-detail-item[data-kind="heading"]', 'scriptnote-type-heading'],
    ['.sn2-detail-item[data-kind="summary"]', 'scriptnote-type-summary'],
    ['.sn2-detail-item[data-kind="break"]', 'scriptnote-type-break'],
    ['.gb-section-title, .bd-detail-section-title', 'section-bar'],
  ]);
  const THEME_UI_VALUE_NONE = 'none';
  const THEME_UI_VALUE_AUTO = 'auto';
  const THEME_UI_VALUE_AUTO_LIGHT = 'auto-light';
  const THEME_UI_VALUE_AUTO_DARK = 'auto-dark';
  const THEME_UI_VALUE_OS_ACCENT = 'os-accent';
  const THEME_UI_VALUE_COLOR_PREFIX = 'color:';
  const THEME_UI_AUTO_VALUES = new Set([THEME_UI_VALUE_AUTO, THEME_UI_VALUE_AUTO_LIGHT, THEME_UI_VALUE_AUTO_DARK]);
  const THEME_OS_ACCENT_KEY = 'meldex-theme-use-os-accent';
  const THEME_OS_ACCENT_CSS = 'var(--theme-os-accent, AccentColor)';
  const THEME_OS_ACCENT_TEXT_CSS = 'var(--theme-os-accent-text, AccentColorText)';
  const COMMON_INTEGRATED_APP_STYLE_KEYS = Object.freeze([
    '--page-text-bg', '--sn2-page-bg', '--db-row-bg', '--fv-panel-bg',
    '--cal-content-bg', '--preview-bg', '--detail-bg', '--chat-bg',
    '--timer-bg', '--history-bg', '--annotation-bg', '--search-bg',
    '--version-bg',
    '--cal-scroll-thumb', '--cal-scroll-thumb-hover',
    '--fv-item-border', '--fv-item-hover-bg', '--fv-item-selected-fg', '--fv-item-selected-bg',
    '--link-fg', '--page-link-fg', '--page-link-bold', '--page-link-italic',
    '--page-hr-color', '--page-quote-border',
    '--page-selection-fg', '--page-selection-color', '--page-caret-color', '--page-caret-width',
    '--sn2-border-color', '--sn2-border-width', '--sn2-spread-border-color', '--sn2-spread-border-width',
    '--sn2-hover-bg', '--sn2-selection-fg', '--sn2-selection-color', '--sn2-caret-color', '--sn2-caret-width',
    '--db-border-color', '--db-selection-fg', '--db-selection-color',
    '--db-active-color', '--db-active-width', '--db-grid-border', '--db-show-grid',
    '--bd-selection-fg', '--bd-selection-color', '--bd-caret-color', '--bd-caret-width',
    '--bd-link-type-icon-color',
  ]);
  const COMMON_INTEGRATED_APP_STYLE_KEY_SET = new Set(COMMON_INTEGRATED_APP_STYLE_KEYS);
  const THEME_OS_ACCENT_STYLE_KEYS = Object.freeze([
    '--accent', '--accent2', '--blue', '--ui-range-fill-bg', '--editor-caret-color',
    '--ui-inner-tab-active-fg', '--ui-inner-tab-active-underline',
    '--selection', '--ui-selection-bg',
    '--sn2-drop-color', '--sn2-drag-select-color',
    '--bd-select-rect-color', '--bd-group-color', '--bd-anchor-color',
    '--cal-accent', '--cal-today-fg', '--cal-mini-selected-bg', '--cal-now-line-color',
  ]);
  const THEME_OS_ACCENT_TEXT_STYLE_KEYS = Object.freeze([
    '--ui-selection-fg',
  ]);
  const THEME_UI_AUTO_TONE_DEFAULT = Object.freeze({ light: 30, dark: 30 });

  const DARK_VARS = {
    '--bg': '#1e1e1e', '--bg2': '#252525', '--bg3': '#2d2d2d', '--bg4': '#3e3e3e',
    '--fg': '#d4d4d4', '--fg2': '#969696', '--accent': '#569cd6', '--accent2': '#4ec9b0',
    '--red': '#f44747', '--green': '#6a9955', '--orange': '#ce9178', '--blue': '#6fa8dc',
    '--border': '#333333', '--selection': '#264f78',
    '--link-fg': '#4da3ff',
    '--content-bg': '#252525',
    '--ui-tooltip-bg': '#2d2d2d', '--ui-tooltip-fg': '#f2f2f2', '--ui-tooltip-border': '#555555',
    '--ui-scrollbar-track-bg': '#252525', '--ui-scrollbar-thumb-bg': '#3e3e3e', '--ui-scrollbar-thumb-hover-bg': '#969696',
    '--ui-pane-tabbar-bg': '#252525', '--ui-pane-tab-active-bg': '#1e1e1e',
    '--ui-panelset-tabbar-bg': '#252525', '--ui-collapsed-tabbar-bg': '#252525', '--ui-dockbar-bg': '#252525',
    '--ui-header-fg': '#969696', '--ui-header-bg': '#2d2d2d',
    '--ui-toolbar-fg': '#d4d4d4', '--ui-toolbar-bg': '#252525',
    '--ui-hover-fg': '#d4d4d4', '--ui-hover-bg': '#3e3e3e',
    '--ui-accent': '#2563eb',
    '--ui-fg-strong': '#ffffff',
    '--ui-selection-fg': '#ffffff', '--ui-selection-bg': '#264f78',
    '--ui-range-fill-bg': '#569cd6', '--ui-range-track-bg': '#2a2a2a',
    '--editor-caret-color': '#569cd6', '--editor-caret-width': '2px', '--a11y-focus-ring': THEME_OS_ACCENT_CSS,
    '--db-th-fg': '#969696', '--db-th-bg': '#2d2d2d', '--db-entity-fg': '#d4d4d4', '--db-entity-bg': '#1e1e1e',
    '--db-cell-fg': '#d4d4d4', '--db-grid-border': 'var(--border)', '--db-active-color': 'var(--editor-caret-color)',
    '--page-title-fg': '#d4d4d4', '--page-title-bg': 'transparent', '--page-h1-fg': 'var(--theme-palette-0, #569cd6)', '--page-h2-fg': 'var(--theme-palette-1, #4ec9b0)', '--page-h3-fg': 'var(--theme-palette-2, #dcdcaa)', '--page-h4-fg': 'var(--theme-palette-3, #6a9955)', '--page-h5-fg': 'var(--theme-palette-4, #ce9178)', '--page-h6-fg': 'var(--theme-palette-5, #6fa8dc)',
    '--page-h1-bg': 'transparent', '--page-h2-bg': 'transparent', '--page-h3-bg': 'transparent', '--page-h4-bg': 'transparent', '--page-h5-bg': 'transparent', '--page-h6-bg': 'transparent',
    '--page-text-fg': '#d4d4d4', '--page-text-bg': '#252525', '--page-link-fg': 'var(--link-fg)',
    '--page-hr-color': 'var(--border)', '--page-quote-fg': '#969696', '--page-quote-border': 'var(--border)',
  };
  const LIGHT_VARS = {
    '--bg': '#ffffff', '--bg2': '#f5f5f5', '--bg3': '#ebebeb', '--bg4': '#d4d4d4',
    '--fg': '#1e1e1e', '--fg2': '#555555', '--accent': '#0055aa', '--accent2': '#007050',
    '--red': '#c62828', '--green': '#2e7d32', '--orange': '#c2410c', '--blue': '#1565c0',
    '--border': '#c0c0c0', '--selection': '#bbdefb',
    '--link-fg': '#0b57d0',
    '--content-bg': '#ffffff',
    '--ui-tooltip-bg': '#ffffff', '--ui-tooltip-fg': '#1e1e1e', '--ui-tooltip-border': '#9aa4b2',
    '--ui-scrollbar-track-bg': '#f5f5f5', '--ui-scrollbar-thumb-bg': '#d4d4d4', '--ui-scrollbar-thumb-hover-bg': '#8a8f98',
    '--ui-pane-tabbar-bg': '#f5f5f5', '--ui-pane-tab-active-bg': '#ffffff',
    '--ui-panelset-tabbar-bg': '#f5f5f5', '--ui-collapsed-tabbar-bg': '#f5f5f5', '--ui-dockbar-bg': '#f5f5f5',
    '--ui-header-fg': '#555555', '--ui-header-bg': '#ebebeb',
    '--ui-toolbar-fg': '#1e1e1e', '--ui-toolbar-bg': '#f5f5f5',
    '--ui-hover-fg': '#1e1e1e', '--ui-hover-bg': '#d4d4d4',
    '--ui-fg-strong': '#ffffff',
    '--ui-selection-fg': '#1e1e1e', '--ui-selection-bg': '#bbdefb',
    '--ui-range-fill-bg': '#0055aa', '--ui-range-track-bg': '#d6d6d6',
    '--editor-caret-color': '#0055aa', '--editor-caret-width': '2px', '--a11y-focus-ring': THEME_OS_ACCENT_CSS,
    '--db-th-fg': '#555555', '--db-th-bg': '#ebebeb', '--db-entity-fg': '#1e1e1e', '--db-entity-bg': '#ffffff',
    '--db-cell-fg': '#1e1e1e', '--db-grid-border': 'var(--border)', '--db-active-color': 'var(--editor-caret-color)',
    '--page-title-fg': '#1e1e1e', '--page-title-bg': 'transparent', '--page-h1-fg': 'var(--theme-palette-0, #0055aa)', '--page-h2-fg': 'var(--theme-palette-1, #007050)', '--page-h3-fg': 'var(--theme-palette-2, #b45309)', '--page-h4-fg': 'var(--theme-palette-3, #2e7d32)', '--page-h5-fg': 'var(--theme-palette-4, #1565c0)', '--page-h6-fg': 'var(--theme-palette-5, #7c3aed)',
    '--page-h1-bg': 'transparent', '--page-h2-bg': 'transparent', '--page-h3-bg': 'transparent', '--page-h4-bg': 'transparent', '--page-h5-bg': 'transparent', '--page-h6-bg': 'transparent',
    '--page-text-fg': '#1e1e1e', '--page-text-bg': '#ffffff', '--page-link-fg': 'var(--link-fg)',
    '--page-hr-color': 'var(--border)', '--page-quote-fg': '#555555', '--page-quote-border': 'var(--border)',
  };
  const PASTEL_VARS = {
    '--bg': '#ffffff', '--bg2': '#f6f7f9', '--bg3': '#eef1f5', '--bg4': '#dce3ec',
    '--fg': '#2f3440', '--fg2': '#5b6475', '--accent': '#8e44ad', '--accent2': '#0f766e',
    '--red': '#be123c', '--green': '#2f855a', '--orange': '#b45309', '--blue': '#2563eb',
    '--border': '#d8dee8', '--selection': '#eadcff',
    '--link-fg': '#3b5bdb',
    '--content-bg': '#ffffff',
    '--ui-tooltip-bg': '#ffffff', '--ui-tooltip-fg': '#2f3440', '--ui-tooltip-border': '#c7cfdb',
    '--ui-scrollbar-track-bg': '#f6f7f9', '--ui-scrollbar-thumb-bg': '#cdd6e1', '--ui-scrollbar-thumb-hover-bg': '#9aa6b7',
    '--ui-pane-tabbar-bg': '#f6f7f9', '--ui-pane-tab-active-bg': '#ffffff',
    '--ui-panelset-tabbar-bg': '#f6f7f9', '--ui-collapsed-tabbar-bg': '#f6f7f9', '--ui-dockbar-bg': '#f6f7f9',
    '--ui-header-fg': '#5b6475', '--ui-header-bg': '#eef1f5',
    '--ui-toolbar-fg': '#2f3440', '--ui-toolbar-bg': '#f6f7f9',
    '--ui-hover-fg': '#2f3440', '--ui-hover-bg': '#eef1f5',
    '--ui-fg-strong': '#ffffff',
    '--ui-selection-fg': '#2f3440', '--ui-selection-bg': '#eadcff',
    '--ui-range-fill-bg': '#8e44ad', '--ui-range-track-bg': '#e4e8f0',
    '--editor-caret-color': '#8e44ad', '--editor-caret-width': '2px',
    '--db-th-fg': '#5b6475', '--db-th-bg': '#eef1f5', '--db-entity-fg': '#2f3440', '--db-entity-bg': '#ffffff',
    '--db-cell-fg': '#2f3440', '--db-grid-border': 'var(--border)', '--db-active-color': 'var(--editor-caret-color)',
    '--page-title-fg': '#2f3440', '--page-title-bg': 'transparent', '--page-h1-fg': 'var(--theme-palette-0, #9b59b6)', '--page-h2-fg': 'var(--theme-palette-1, #1abc9c)', '--page-h3-fg': 'var(--theme-palette-2, #f39c12)', '--page-h4-fg': 'var(--theme-palette-3, #e74c3c)', '--page-h5-fg': 'var(--theme-palette-4, #3498db)', '--page-h6-fg': 'var(--theme-palette-5, #7f8c8d)',
    '--page-h1-bg': 'transparent', '--page-h2-bg': 'transparent', '--page-h3-bg': 'transparent', '--page-h4-bg': 'transparent', '--page-h5-bg': 'transparent', '--page-h6-bg': 'transparent',
    '--page-text-fg': '#2f3440', '--page-text-bg': '#ffffff', '--page-link-fg': 'var(--link-fg)',
    '--page-hr-color': 'var(--border)', '--page-quote-fg': '#5b6475', '--page-quote-border': 'var(--border)',
  };
  const EARTH_VARS = {
    '--bg': '#0f1110', '--bg2': '#181b19', '--bg3': '#242824', '--bg4': '#333a34',
    '--fg': '#d9ddd8', '--fg2': '#aab3aa', '--accent': '#6fa85a', '--accent2': '#8dbf70',
    '--red': '#d06050', '--green': '#90b870', '--orange': '#b88a4a', '--blue': '#6898b0',
    '--border': '#343a35', '--selection': '#2d472b',
    '--link-fg': '#5fb0e8',
    '--content-bg': '#101210',
    '--ui-tooltip-bg': '#242824', '--ui-tooltip-fg': '#f2f6f1', '--ui-tooltip-border': '#465044',
    '--ui-scrollbar-track-bg': '#181b19', '--ui-scrollbar-thumb-bg': '#333a34', '--ui-scrollbar-thumb-hover-bg': '#657064',
    '--ui-pane-tabbar-bg': '#181b19', '--ui-pane-tab-active-bg': '#101210',
    '--ui-panelset-tabbar-bg': '#181b19', '--ui-collapsed-tabbar-bg': '#181b19', '--ui-dockbar-bg': '#181b19',
    '--ui-header-fg': '#aab3aa', '--ui-header-bg': '#242824',
    '--ui-toolbar-fg': '#d9ddd8', '--ui-toolbar-bg': '#181b19',
    '--ui-hover-fg': '#d9ddd8', '--ui-hover-bg': '#333a34',
    '--ui-accent': '#4f7f3b',
    '--ui-fg-strong': '#ffffff',
    '--ui-selection-fg': '#f2f6f1', '--ui-selection-bg': '#2d472b',
    '--ui-range-fill-bg': '#6fa85a', '--ui-range-track-bg': '#252b26',
    '--editor-caret-color': '#6fa85a', '--editor-caret-width': '2px',
    '--db-th-fg': '#aab3aa', '--db-th-bg': '#242824', '--db-entity-fg': '#d9ddd8', '--db-entity-bg': '#101210',
    '--db-cell-fg': '#d9ddd8', '--db-grid-border': 'var(--border)', '--db-active-color': 'var(--editor-caret-color)',
    '--page-title-fg': '#d9ddd8', '--page-title-bg': 'transparent', '--page-h1-fg': 'var(--theme-palette-0, #6fa85a)', '--page-h2-fg': 'var(--theme-palette-1, #8dbf70)', '--page-h3-fg': 'var(--theme-palette-2, #b88a4a)', '--page-h4-fg': 'var(--theme-palette-3, #90b870)', '--page-h5-fg': 'var(--theme-palette-4, #6898b0)', '--page-h6-fg': 'var(--theme-palette-5, #d06050)',
    '--page-h1-bg': 'transparent', '--page-h2-bg': 'transparent', '--page-h3-bg': 'transparent', '--page-h4-bg': 'transparent', '--page-h5-bg': 'transparent', '--page-h6-bg': 'transparent',
    '--page-text-fg': '#d9ddd8', '--page-text-bg': '#101210', '--page-link-fg': 'var(--link-fg)',
    '--page-hr-color': 'var(--border)', '--page-quote-fg': '#aab3aa', '--page-quote-border': 'var(--border)',
  };
  const GIRLY_VARS = {
    '--bg': '#fff0f5', '--bg2': '#ffe8f0', '--bg3': '#ffdce8', '--bg4': '#ffc8d8',
    '--fg': '#3a1828', '--fg2': '#704060', '--accent': '#c01878', '--accent2': '#b050b0',
    '--red': '#d01070', '--green': '#2a8a50', '--orange': '#d06030', '--blue': '#4070c0',
    '--border': '#e8a0c0', '--selection': '#ffb6c1',
    '--link-fg': '#3f6fd1',
    '--ui-header-fg': '#704060', '--ui-header-bg': '#ffdce8',
    '--ui-toolbar-fg': '#3a1828', '--ui-toolbar-bg': '#ffe8f0',
    '--ui-hover-fg': '#3a1828', '--ui-hover-bg': '#ffc8d8',
    '--ui-fg-strong': '#ffffff',
    '--ui-selection-fg': '#3a1828', '--ui-selection-bg': '#ffb6c1',
    '--ui-range-fill-bg': '#c01878', '--ui-range-track-bg': '#e8a0c0',
    '--editor-caret-color': '#c01878', '--editor-caret-width': '2px',
    '--db-th-fg': '#704060', '--db-th-bg': '#ffdce8', '--db-entity-fg': '#3a1828', '--db-entity-bg': '#fff0f5',
    '--db-cell-fg': '#3a1828', '--db-grid-border': 'var(--border)', '--db-active-color': 'var(--editor-caret-color)',
    '--page-title-fg': '#3a1828', '--page-title-bg': 'transparent', '--page-h1-fg': 'var(--theme-palette-0, #c01878)', '--page-h2-fg': 'var(--theme-palette-1, #b050b0)', '--page-h3-fg': 'var(--theme-palette-2, #d06030)', '--page-h4-fg': 'var(--theme-palette-3, #2a8a50)', '--page-h5-fg': 'var(--theme-palette-4, #4070c0)', '--page-h6-fg': 'var(--theme-palette-5, #d01070)',
    '--page-h1-bg': 'transparent', '--page-h2-bg': 'transparent', '--page-h3-bg': 'transparent', '--page-h4-bg': 'transparent', '--page-h5-bg': 'transparent', '--page-h6-bg': 'transparent',
    '--page-text-fg': '#3a1828', '--page-text-bg': '#ffe8f0', '--page-link-fg': 'var(--link-fg)',
    '--page-hr-color': 'var(--border)', '--page-quote-fg': '#704060', '--page-quote-border': 'var(--border)',
  };

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function normalizeThemeColor(color) {
    if (typeof color !== 'string') return '';
    const raw = color.trim();
    const short = raw.match(/^#([0-9a-f]{3})$/i);
    if (short) return '#' + short[1].split('').map(ch => ch + ch).join('').toLowerCase();
    const full = raw.match(/^#([0-9a-f]{6})$/i);
    return full ? ('#' + full[1].toLowerCase()) : '';
  }

  function normalizeThemeColorSet(colors, fallback) {
    const src = Array.isArray(colors) ? colors : [];
    const base = Array.isArray(fallback) && fallback.length ? fallback : RAINBOW_PALETTE;
    const out = [];
    for (let i = 0; i < THEME_COLOR_SET_SIZE; i += 1) {
      out.push(normalizeThemeColor(src[i]) || normalizeThemeColor(base[i % base.length]) || RAINBOW_PALETTE[i % RAINBOW_PALETTE.length]);
    }
    return out;
  }

  function rawThemeColorSetFromTheme(themeDef) {
    const ui = themeDef?.ui || {};
    return themeDef?.themeColorSet
      || ui.themeColorSet
      || themeDef?.[THEME_COLOR_SET_THEME_KEY]
      || ui[THEME_COLOR_SET_THEME_KEY]
      || ui.colorSet
      || ui.palette
      || null;
  }

  function computedThemeColorSetFromThemeSlots(themeDef) {
    if (typeof global.computeThemeColorSetFromSlots !== 'function') return null;
    const slots = themeColorSlotSettingsFromTheme(themeDef, null);
    if (!slots) return null;
    const adjust = themeStandardPaletteAdjustFromTheme(themeDef, null);
    const next = global.computeThemeColorSetFromSlots(adjust, slots);
    return Array.isArray(next) && next.length ? next : null;
  }

  function resolveThemeColorSet(themeDef) {
    return normalizeThemeColorSet(rawThemeColorSetFromTheme(themeDef) || computedThemeColorSetFromThemeSlots(themeDef), RAINBOW_PALETTE);
  }

  function readStoredThemeColorSet() {
    try {
      const parsed = JSON.parse(localStorage.getItem(THEME_COLOR_SET_KEY) || 'null');
      return Array.isArray(parsed) ? normalizeThemeColorSet(parsed, RAINBOW_PALETTE) : null;
    } catch {
      return null;
    }
  }

  function themeColorSetsEqual(a, b) {
    const left = normalizeThemeColorSet(a, RAINBOW_PALETTE);
    const right = normalizeThemeColorSet(b, RAINBOW_PALETTE);
    return left.every((color, index) => color === right[index]);
  }

  function normalizeThemeColorSlotSettings(raw) {
    const src = Array.isArray(raw) ? raw : (Array.isArray(raw?.slots) ? raw.slots : []);
    const out = [];
    for (let i = 0; i < THEME_COLOR_SET_SIZE; i += 1) {
      const item = src[i];
      const color = normalizeThemeColor(typeof item === 'string' ? item : item?.color);
      out.push(color ? { color, applyAdjust: item?.applyAdjust !== false } : null);
    }
    return out;
  }

  function compactThemeColorSlotSettings(raw) {
    const next = normalizeThemeColorSlotSettings(raw);
    return next.some(Boolean)
      ? next.map(slot => slot ? { color: slot.color, applyAdjust: slot.applyAdjust !== false } : null)
      : null;
  }

  function readStoredThemeColorSlotSettings() {
    try {
      return normalizeThemeColorSlotSettings(JSON.parse(localStorage.getItem(THEME_COLOR_SLOT_SETTINGS_KEY) || 'null'));
    } catch {
      return normalizeThemeColorSlotSettings(null);
    }
  }

  function readCurrentThemeColorSlotSettings() {
    if (typeof global.getThemeColorSlotSettings === 'function') {
      return normalizeThemeColorSlotSettings(global.getThemeColorSlotSettings());
    }
    return readStoredThemeColorSlotSettings();
  }

  function writeStoredThemeColorSlotSettings(slots) {
    const compact = compactThemeColorSlotSettings(slots);
    if (typeof global.saveThemeColorSlotSettings === 'function') {
      return normalizeThemeColorSlotSettings(global.saveThemeColorSlotSettings(compact || []));
    }
    try {
      if (compact) localStorage.setItem(THEME_COLOR_SLOT_SETTINGS_KEY, JSON.stringify(compact));
      else localStorage.removeItem(THEME_COLOR_SLOT_SETTINGS_KEY);
    } catch {}
    return normalizeThemeColorSlotSettings(compact);
  }

  function themeColorSlotSettingsFromTheme(themeDef, fallback) {
    const ui = themeDef?.ui || {};
    return compactThemeColorSlotSettings(
      themeDef?.themeColorSlotSettings
      || ui.themeColorSlotSettings
      || themeDef?.[THEME_COLOR_SLOT_SETTINGS_THEME_KEY]
      || ui[THEME_COLOR_SLOT_SETTINGS_THEME_KEY]
      || fallback
    );
  }

  function normalizeThemeColorExtraSlotSettings(raw) {
    const out = {};
    if (!raw || typeof raw !== 'object') return out;
    for (const [key, value] of Object.entries(raw)) {
      if (!/^[124]-[0-7]$/.test(key)) continue;
      if (key === '1-0') continue;
      const color = normalizeThemeColor(typeof value === 'string' ? value : value?.color);
      if (color) out[key] = color;
    }
    return out;
  }

  function compactThemeColorExtraSlotSettings(raw) {
    const next = normalizeThemeColorExtraSlotSettings(raw);
    return Object.keys(next).length ? next : null;
  }

  function readStoredThemeColorExtraSlotSettings() {
    try {
      return normalizeThemeColorExtraSlotSettings(JSON.parse(localStorage.getItem(THEME_COLOR_EXTRA_SLOT_SETTINGS_KEY) || 'null'));
    } catch {
      return {};
    }
  }

  function readCurrentThemeColorExtraSlotSettings() {
    if (typeof global.getThemeColorExtraSlotSettings === 'function') {
      return normalizeThemeColorExtraSlotSettings(global.getThemeColorExtraSlotSettings());
    }
    return readStoredThemeColorExtraSlotSettings();
  }

  function writeStoredThemeColorExtraSlotSettings(slots) {
    const compact = compactThemeColorExtraSlotSettings(slots);
    if (typeof global.saveThemeColorExtraSlotSettings === 'function') {
      return normalizeThemeColorExtraSlotSettings(global.saveThemeColorExtraSlotSettings(compact || {}));
    }
    try {
      if (compact) localStorage.setItem(THEME_COLOR_EXTRA_SLOT_SETTINGS_KEY, JSON.stringify(compact));
      else localStorage.removeItem(THEME_COLOR_EXTRA_SLOT_SETTINGS_KEY);
    } catch {}
    return normalizeThemeColorExtraSlotSettings(compact);
  }

  function themeColorExtraSlotSettingsFromTheme(themeDef, fallback) {
    const ui = themeDef?.ui || {};
    return compactThemeColorExtraSlotSettings(
      themeDef?.themeColorExtraSlotSettings
      || ui.themeColorExtraSlotSettings
      || themeDef?.[THEME_COLOR_EXTRA_SLOT_SETTINGS_THEME_KEY]
      || ui[THEME_COLOR_EXTRA_SLOT_SETTINGS_THEME_KEY]
      || fallback
    );
  }

  function _hasThemeOwn(obj, key) {
    return !!obj && Object.prototype.hasOwnProperty.call(obj, key);
  }

  function normalizeThemeOsAccentSetting(value, fallback = false) {
    if (value === true || value === '1' || value === 1 || value === 'true') return true;
    if (value === false || value === '0' || value === 0 || value === 'false') return false;
    return !!fallback;
  }

  function themeOsAccentFromTheme(themeDef, fallback) {
    const ui = themeDef?.ui || {};
    if (_hasThemeOwn(ui, 'useOsAccentColor')) return normalizeThemeOsAccentSetting(ui.useOsAccentColor, fallback);
    if (_hasThemeOwn(themeDef, 'useOsAccentColor')) return normalizeThemeOsAccentSetting(themeDef.useOsAccentColor, fallback);
    if (_hasThemeOwn(ui, THEME_OS_ACCENT_THEME_KEY)) return normalizeThemeOsAccentSetting(ui[THEME_OS_ACCENT_THEME_KEY], fallback);
    if (_hasThemeOwn(themeDef, THEME_OS_ACCENT_THEME_KEY)) return normalizeThemeOsAccentSetting(themeDef[THEME_OS_ACCENT_THEME_KEY], fallback);
    return fallback;
  }

  function normalizeThemeStandardPaletteAdjust(raw) {
    if (typeof global.normalizeStandardPaletteAdjust === 'function') return global.normalizeStandardPaletteAdjust(raw);
    const src = raw && typeof raw === 'object' ? raw : {};
    const clamp = (value, min, max, fallback) => {
      const num = Number(value);
      return Number.isFinite(num) ? Math.max(min, Math.min(max, Math.round(num))) : fallback;
    };
    return {
      hueStart: clamp(src.hueStart, -360, 360, 0),
      hueEnd: clamp(src.hueEnd, -360, 360, 320),
      saturation: clamp(src.saturation, 0, 100, 50),
      brightness: clamp(src.brightness, -100, 100, 0),
      contrast: clamp(src.contrast, 0, 100, 50),
    };
  }

  function themeStandardPaletteAdjustFromTheme(themeDef, fallback) {
    const ui = themeDef?.ui || {};
    let raw;
    if (_hasThemeOwn(ui, 'standardPaletteAdjust')) raw = ui.standardPaletteAdjust;
    else if (_hasThemeOwn(themeDef, 'standardPaletteAdjust')) raw = themeDef.standardPaletteAdjust;
    else if (_hasThemeOwn(ui, STANDARD_PALETTE_THEME_KEY)) raw = ui[STANDARD_PALETTE_THEME_KEY];
    else if (_hasThemeOwn(themeDef, STANDARD_PALETTE_THEME_KEY)) raw = themeDef[STANDARD_PALETTE_THEME_KEY];
    else raw = fallback;
    return raw == null ? null : normalizeThemeStandardPaletteAdjust(raw);
  }

  function _emptyThemeUiApplications() {
    const cfg = {};
    THEME_UI_TARGETS.forEach(target => {
      cfg[target.id] = {};
      THEME_UI_STATES.forEach(state => {
        cfg[target.id][state.id] = {};
        THEME_UI_PROPS.forEach(prop => {
          cfg[target.id][state.id][prop.id] = THEME_UI_VALUE_NONE;
        });
      });
    });
    return cfg;
  }

  function _defaultThemeUiApplications() {
    const cfg = _emptyThemeUiApplications();
    cfg['left-chrome'].selected.bg = THEME_UI_VALUE_AUTO;
    cfg.button.selected.bg = THEME_UI_VALUE_AUTO;
    cfg['panel-tab'].selected.underline = THEME_UI_VALUE_AUTO;
    cfg['inner-tab'].selected.underline = THEME_UI_VALUE_AUTO;
    cfg['collapse-button'].selected.bg = THEME_UI_VALUE_AUTO;
    cfg.folder.selected.bg = THEME_UI_VALUE_AUTO;
    cfg['folder-tree-folder'].selected.bg = THEME_UI_VALUE_AUTO;
    cfg['folder-panel-folder'].selected.bg = THEME_UI_VALUE_AUTO;
    cfg['section-bar'].normal.underline = THEME_UI_VALUE_AUTO;
    return cfg;
  }

  function _themeUiPropsForTarget(target, stateId) {
    let ids = Array.isArray(target?.props) ? target.props : THEME_UI_PROPS.map(prop => prop.id);
    if (target?.vars && stateId && target.vars[stateId]) {
      const available = new Set(Object.keys(target.vars[stateId] || {}));
      ids = ids.filter(id => available.has(id));
    }
    return THEME_UI_PROPS.filter(prop => ids.includes(prop.id));
  }

  function _themeUiStatesForTarget(target) {
    const ids = Array.isArray(target?.states) ? target.states : THEME_UI_STATES.map(state => state.id);
    return THEME_UI_STATES.filter(state => ids.includes(state.id));
  }

  function _normalizeThemeUiValue(value) {
    const raw = String(value ?? THEME_UI_VALUE_NONE).trim();
    if (THEME_UI_AUTO_VALUES.has(raw)) return raw;
    if (raw === THEME_UI_VALUE_OS_ACCENT) return THEME_UI_VALUE_OS_ACCENT;
    if (raw === THEME_UI_VALUE_NONE || raw === '') return THEME_UI_VALUE_NONE;
    if (raw.startsWith(THEME_UI_VALUE_COLOR_PREFIX) || raw.startsWith('#')) {
      const color = normalizeThemeColor(raw.startsWith(THEME_UI_VALUE_COLOR_PREFIX) ? raw.slice(THEME_UI_VALUE_COLOR_PREFIX.length) : raw);
      return color ? THEME_UI_VALUE_COLOR_PREFIX + color : THEME_UI_VALUE_NONE;
    }
    const index = parseInt(raw, 10);
    return Number.isInteger(index) && index >= 0 && index < THEME_COLOR_SET_SIZE
      ? String(index)
      : THEME_UI_VALUE_NONE;
  }

  function _normalizeThemeUiTonePercent(value, fallback) {
    const parsed = Number(value);
    const base = Number.isFinite(parsed) ? parsed : fallback;
    return Math.max(0, Math.min(100, Math.round(base)));
  }

  function normalizeThemeUiAutoTone(raw) {
    const src = raw && typeof raw === 'object' ? raw : {};
    return {
      light: _normalizeThemeUiTonePercent(src.light, THEME_UI_AUTO_TONE_DEFAULT.light),
      dark: _normalizeThemeUiTonePercent(src.dark, THEME_UI_AUTO_TONE_DEFAULT.dark),
    };
  }

  function getThemeUiAutoTone() {
    try {
      return normalizeThemeUiAutoTone(JSON.parse(localStorage.getItem(THEME_UI_AUTO_TONE_KEY) || 'null'));
    } catch {
      return normalizeThemeUiAutoTone(null);
    }
  }

  function dispatchThemeUiApplicationsChange(detail = {}) {
    try {
      global.dispatchEvent(new CustomEvent('meldex-theme-ui-applications-change', { detail }));
    } catch {}
  }

  function dispatchThemeUiAutoToneChange(detail = {}) {
    try {
      global.dispatchEvent(new CustomEvent('meldex-theme-ui-auto-tone-change', { detail }));
    } catch {}
  }

  const THEME_SETTINGS_HISTORY_KEYS = [
    DEFAULT_THEME_KEY,
    'editor-theme-name',
    CUSTOM_THEMES_KEY,
    THEME_COLOR_SET_KEY,
    THEME_COLOR_SLOT_SETTINGS_KEY,
    THEME_COLOR_EXTRA_SLOT_SETTINGS_KEY,
    STANDARD_PALETTE_ADJUST_STORAGE_KEY,
    THEME_OS_ACCENT_KEY,
    THEME_UI_APPLICATIONS_KEY,
    THEME_UI_AUTO_TONE_KEY,
  ];

  let _themeSettingsHistoryBatchDepth = 0;

  function _themeSettingsHistorySuppressed(options = {}) {
    return options.skipHistory === true
      || _themeSettingsHistoryBatchDepth > 0
      || (typeof global.isLocalStorageSettingsHistorySuppressed === 'function'
        && global.isLocalStorageSettingsHistorySuppressed());
  }

  function _withThemeSettingsHistorySuppressed(fn) {
    _themeSettingsHistoryBatchDepth += 1;
    global.__meldexSuppressLocalStorageSettingsHistory = Number(global.__meldexSuppressLocalStorageSettingsHistory || 0) + 1;
    try {
      return fn();
    } finally {
      _themeSettingsHistoryBatchDepth -= 1;
      global.__meldexSuppressLocalStorageSettingsHistory = Math.max(0, Number(global.__meldexSuppressLocalStorageSettingsHistory || 0) - 1);
    }
  }

  function _captureThemeSettingsStorage(keys = THEME_SETTINGS_HISTORY_KEYS) {
    return typeof global.captureLocalStorageSettings === 'function'
      ? global.captureLocalStorageSettings(keys)
      : null;
  }

  function _refreshThemeSettingsAfterHistory(keys) {
    const changed = new Set(keys || THEME_SETTINGS_HISTORY_KEYS);
    if (changed.has(DEFAULT_THEME_KEY) || changed.has('editor-theme-name') || changed.has(CUSTOM_THEMES_KEY)) {
      const themeDef = getThemeById(getDefaultThemeId());
      _withThemeSettingsHistorySuppressed(() => applyThemeToDocument(themeDef, { preserveStoredThemeUi: true }));
      scheduleBoardRender();
      global.dispatchEvent(new CustomEvent('meldex-theme-change', { detail: { themeId: getDefaultThemeId(), resolvedThemeId: themeDef.id } }));
    }
    if (changed.has(THEME_COLOR_SET_KEY) || changed.has(THEME_COLOR_SLOT_SETTINGS_KEY) || changed.has(THEME_COLOR_EXTRA_SLOT_SETTINGS_KEY) || changed.has(STANDARD_PALETTE_ADJUST_STORAGE_KEY)) {
      const stored = readStoredThemeColorSet() || resolveThemeColorSet(getThemeById(getDefaultThemeId()));
      _activeThemeColorSet = paintThemeColorSet(stored, { bindTargets: true });
      if (typeof global.syncThemeColorSetSwatches === 'function') global.syncThemeColorSetSwatches(document, _activeThemeColorSet);
      global.dispatchEvent(new CustomEvent('meldex-theme-color-set-change', { detail: { colorSet: _activeThemeColorSet } }));
    }
    if (changed.has(THEME_OS_ACCENT_KEY)) {
      applyOsAccentColorSetting(getUseOsAccentColor(), { restorePrevious: false });
      global.dispatchEvent(new CustomEvent('meldex-theme-os-accent-change', { detail: { enabled: getUseOsAccentColor() } }));
    }
    if (changed.has(THEME_UI_APPLICATIONS_KEY) || changed.has(THEME_UI_AUTO_TONE_KEY)) {
      const apps = getThemeUiApplications();
      const tone = getThemeUiAutoTone();
      applyThemeUiApplications(apps, { forceTargets: true });
      dispatchThemeUiApplicationsChange({ applications: apps, fromHistory: true });
      dispatchThemeUiAutoToneChange({ tone, fromHistory: true });
    }
    if (typeof global._refreshSettingsThemePanel === 'function') global._refreshSettingsThemePanel();
  }

  function _pushThemeSettingsHistory(label, beforeSnapshot, keys, detail, options = {}) {
    if (!beforeSnapshot || _themeSettingsHistorySuppressed(options)) return false;
    if (typeof global.pushLocalStorageSettingsHistory !== 'function') return false;
    return global.pushLocalStorageSettingsHistory(
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

  function refreshOsAccentColor() {
    if (typeof fetch !== 'function') return Promise.resolve(null);
    const apiBase = typeof API_BASE === 'string' ? API_BASE : '/api';
    return fetch(apiBase + '/os-accent-color', { cache: 'no-store' })
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        const color = /^#[0-9a-f]{6}$/i.test(String(data?.color || '')) ? data.color : '';
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
    const osAccentEnabled = applyThemeOsAccentSettingFromTheme(themeDef, { preserveStored: options.preserveStoredThemeUi === true || options.preserveStoredOsAccent === true });
    applyThemeStandardPaletteAdjustFromTheme(themeDef, { preserveStored: options.preserveStoredThemeUi === true || options.preserveStoredStandardPalette === true });
    applyOsAccentColorSetting(osAccentEnabled, { restorePrevious: false });
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
    return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  }

  function escAttr(value) {
    return escHtml(value);
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
      if (options.preserveStored !== true || localStorage.getItem(THEME_UI_AUTO_TONE_KEY) == null) {
        localStorage.setItem(THEME_UI_AUTO_TONE_KEY, JSON.stringify(autoTone));
        wroteAutoTone = true;
      }
    } catch {}
    // 書き込みがあったら CSS rules を再生成してランタイムへ反映 (以前は localStorage のみ
    // 更新されて `meldex-theme-ui-applications-style` が古い状態のままだった)
    if (wroteApplications || wroteAutoTone) {
      applyThemeUiApplications(applications, { forceTargets: true });
      if (wroteApplications && typeof dispatchThemeUiApplicationsChange === 'function') {
        dispatchThemeUiApplicationsChange({ applications, fromTheme: true });
      }
      if (wroteAutoTone && typeof dispatchThemeUiAutoToneChange === 'function') {
        dispatchThemeUiAutoToneChange({ tone: autoTone, fromTheme: true });
      }
    }
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
