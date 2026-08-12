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
  let _osAccentRuntimeAvailable = null;
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
      selected: { fg: '--ui-accent-fg', bg: ['--ui-accent', '--ui-bg-control-active', '--accent'] },
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
  const BUILTIN_ACCENT_POLICIES = Object.freeze({
    'builtin-dark': Object.freeze({ kind: 'system-or-default', defaultColor: '#569cd6' }),
    'builtin-light': Object.freeze({ kind: 'system-or-default', defaultColor: '#0055aa' }),
  });
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
    '--accent', '--accent2', '--blue', '--ui-accent', '--link-fg', '--ui-range-fill-bg', '--editor-caret-color',
    '--ui-inner-tab-active-fg', '--ui-inner-tab-active-underline',
    '--selection', '--ui-selection-bg',
    '--sn2-drop-color', '--sn2-drag-select-color',
    '--bd-select-rect-color', '--bd-group-color', '--bd-anchor-color',
    '--cal-accent', '--cal-mini-selected-bg', '--cal-now-line-color',
  ]);
  const THEME_OS_ACCENT_TEXT_STYLE_KEYS = Object.freeze([
    '--ui-selection-fg', '--ui-accent-fg',
    '--cal-accent-fg', '--cal-mini-selected-fg',
    '--chat-active-fg', '--timer-active-fg', '--version-active-fg',
  ]);
  const THEME_UI_AUTO_TONE_DEFAULT = Object.freeze({ light: 30, dark: 30 });

  const DARK_VARS = {
    '--bg': '#0b0d10', '--bg2': '#111419', '--bg3': '#181c22', '--bg4': '#242a32',
    '--fg': '#d4d4d4', '--fg2': '#969696', '--accent': '#569cd6', '--accent2': '#4ec9b0',
    '--red': '#f44747', '--green': '#6a9955', '--orange': '#ce9178', '--blue': '#6fa8dc',
    '--border': '#2b323b', '--selection': '#264f78',
    '--link-fg': '#4da3ff',
    '--content-bg': '#0f1216',
    '--ui-tooltip-bg': '#181c22', '--ui-tooltip-fg': '#f2f2f2', '--ui-tooltip-border': '#3a424d',
    '--ui-scrollbar-track-bg': '#111419', '--ui-scrollbar-thumb-bg': '#242a32', '--ui-scrollbar-thumb-hover-bg': '#969696',
    '--ui-pane-tabbar-bg': '#111419', '--ui-pane-tab-active-bg': '#0b0d10',
    '--ui-panelset-tabbar-bg': '#111419', '--ui-collapsed-tabbar-bg': '#111419', '--ui-dockbar-bg': '#111419',
    '--ui-header-fg': '#969696', '--ui-header-bg': '#181c22',
    '--ui-toolbar-fg': '#d4d4d4', '--ui-toolbar-bg': '#111419',
    '--ui-hover-fg': '#d4d4d4', '--ui-hover-bg': '#242a32',
    '--ui-accent': '#569cd6',
    '--ui-fg-strong': '#ffffff',
    '--ui-selection-fg': '#ffffff', '--ui-selection-bg': '#264f78',
    '--ui-range-fill-bg': '#569cd6', '--ui-range-track-bg': '#2a2a2a',
    '--editor-caret-color': '#569cd6', '--editor-caret-width': '2px', '--a11y-focus-ring': THEME_OS_ACCENT_CSS,
    '--cal-event-bg': '#2563eb', '--cal-event-fg': '#ffffff',
    '--db-th-fg': '#969696', '--db-th-bg': '#181c22', '--db-entity-fg': '#d4d4d4', '--db-entity-bg': '#0b0d10',
    '--db-cell-fg': '#d4d4d4', '--db-grid-border': 'var(--border)', '--db-active-color': 'var(--editor-caret-color)',
    '--page-title-fg': '#d4d4d4', '--page-title-bg': 'transparent', '--page-h1-fg': 'var(--theme-palette-0, #569cd6)', '--page-h2-fg': 'var(--theme-palette-1, #4ec9b0)', '--page-h3-fg': 'var(--theme-palette-2, #dcdcaa)', '--page-h4-fg': 'var(--theme-palette-3, #6a9955)', '--page-h5-fg': 'var(--theme-palette-4, #ce9178)', '--page-h6-fg': 'var(--theme-palette-5, #6fa8dc)',
    '--page-h1-bg': 'transparent', '--page-h2-bg': 'transparent', '--page-h3-bg': 'transparent', '--page-h4-bg': 'transparent', '--page-h5-bg': 'transparent', '--page-h6-bg': 'transparent',
    '--page-text-fg': '#d4d4d4', '--page-text-bg': '#0f1216', '--page-link-fg': 'var(--link-fg)',
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
    '--cal-event-bg': '#2563eb', '--cal-event-fg': '#ffffff',
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
