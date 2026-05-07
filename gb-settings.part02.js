/* gb-settings.part02.js */
/* ==============================
   カスタムテーマ（完全版 — タブ式統一UI）
   ============================== */
const COLOR_SETTINGS_KEY = 'editor-theme';
const THEME_COLOR_SET_THEME_KEY = '_theme-color-set';
const THEME_OS_ACCENT_THEME_KEY = '_theme-use-os-accent';
const THEME_COLOR_SLOT_SETTINGS_KEY = 'meldex-theme-color-slot-settings';
const THEME_COLOR_SLOT_SETTINGS_THEME_KEY = '_theme-color-slot-settings';
const THEME_COLOR_EXTRA_SLOT_SETTINGS_KEY = 'meldex-theme-color-extra-slot-settings';
const THEME_COLOR_EXTRA_SLOT_SETTINGS_THEME_KEY = '_theme-color-extra-slot-settings';
const STANDARD_PALETTE_THEME_KEY = '_standard-palette-adjust';
const STANDARD_PALETTE_ADJUST_STORAGE_KEY = 'meldex-standard-palette-adjust';
const THEME_UI_CUSTOM_COLOR_PREFIX = 'color:';
const THEME_STYLE_LEFT_ACCENT_WIDTH = '6px';
const THEME_STYLE_UNDERLINE_WIDTH = '2px';
const SETTINGS_THEME_COMMON_BODY_BG_KEY = '--content-bg';
const SETTINGS_THEME_COMMON_BODY_BG_LINKED_KEYS = Object.freeze([
  '--page-text-bg',
  '--sn2-page-bg',
  '--db-row-bg',
  '--db-entity-bg',
  '--bd-bg',
]);
const COMMON_THEME_SURFACE_STYLE_KEYS = new Set(['--page-text-bg', '--sn2-page-bg', '--db-row-bg', '--fv-panel-bg', '--cal-content-bg', '--preview-bg', '--detail-bg', '--chat-bg', '--timer-bg', '--history-bg', '--annotation-bg', '--search-bg', '--version-bg']);
const COMMON_THEME_SCROLLBAR_STYLE_KEYS = new Set(['--cal-scroll-thumb', '--cal-scroll-thumb-hover']);

// getCssVar, rgbToHex は meldex-core.js で定義済み

// PALETTE_COLORS, PALETTE_BG_COLORS は meldex-core.js で定義済み

// カスタムカラー管理・calcBgColor・parseColorToHexAlpha・hexAlphaToRgba は gb-color-palette.js に統合済み

function _runSettingsWithoutLocalStorageHistory(fn) {
  if (typeof window === 'undefined') return typeof fn === 'function' ? fn() : undefined;
  window.__meldexSuppressLocalStorageSettingsHistory = Number(window.__meldexSuppressLocalStorageSettingsHistory || 0) + 1;
  try {
    return typeof fn === 'function' ? fn() : undefined;
  } finally {
    window.__meldexSuppressLocalStorageSettingsHistory = Math.max(0, Number(window.__meldexSuppressLocalStorageSettingsHistory || 0) - 1);
  }
}

// スウォッチ+不透明度から背景色を更新
function updateBgFromSwatchAlpha(key) {
  const swatch = document.querySelector(`.cs-swatch[data-key="${key}"]`);
  const slider = document.querySelector(`.cs-alpha[data-key="${key}"]`);
  if (!swatch || !slider) return;
  const hex = swatch.dataset.hex || '#000000';
  const alpha = parseFloat(slider.value) / 100;
  const val = hexAlphaToRgba(hex, alpha);
  setColorSetting(key, val);
  setColorSwatchValue(swatch, val);
}

function syncCsSwatches(root) {
  (root || document).querySelectorAll('.cs-swatch[data-key]').forEach((swatch) => {
    const key = swatch.dataset.key;
    if (!key) return;
    const color = getCssVar(key);
    setColorSwatchValue(swatch, color);
    if (swatch.dataset.hex !== undefined) {
      swatch.dataset.hex = parseColorToHexAlpha(color).hex;
    }
  });
}

// セクション別 カスタムテーマの項目定義
const UI_STYLE_SECTIONS = {
  '共通': [
    { label: '共通本文背景色', bg:'--content-bg', text:'本文背景' },
    { label: 'アプリ基礎背景色', bg:'--bg', text:'アプリ基礎' },
    { label: 'サブ背景色', bg:'--bg2', text:'パネル背景' },
    { label: '強調背景色', bg:'--bg3', text:'ダイアログ/ホバー領域背景' },
    { label: 'ポップアップ', bg:'--ui-popup-bg', text:'ポップアップ背景' },
    { label: 'ツールチップ', fg:'--ui-tooltip-fg', bg:'--ui-tooltip-bg', text:'ツールチップ' },
    { label: 'ツールチップ枠線', line:'--ui-tooltip-border', text:'━━' },
    { label: 'スクロールバー背景', bg:'--ui-scrollbar-track-bg', text:'スクロール背景' },
    { label: 'スクロールバーつまみ', bg:'--ui-scrollbar-thumb-bg', text:'スクロールバー' },
    { label: 'スクロールバーホバー', bg:'--ui-scrollbar-thumb-hover-bg', text:'スクロールバーホバー' },
    { label: 'パネルタブバー', bg:'--ui-pane-tabbar-bg', text:'タブバー' },
    { label: 'パネルタブ選択背景', bg:'--ui-pane-tab-active-bg', text:'選択タブ' },
    { label: '折りたたみ/ドックバー', bg:'--ui-collapsed-tabbar-bg', text:'折りたたみ' },
    { label: 'ボタン', fg:'--ui-fg-default', bg:'--ui-bg-control', text:'ボタン' },
    { label: 'ボタンホバー', fg:'--ui-hover-fg', bg:'--ui-bg-control-hover', text:'ホバー' },
    { label: 'ボタン選択', fg:'--ui-fg-strong', bg:'--ui-accent', text:'選択' },
    { label: '通常文字', fg:'--fg', bg:'--ui-text-bg', bold:'--ui-text-bold', italic:'--ui-text-italic', fontSize:'--ui-text-font-size', text:'通常テキスト', font:'--ui-font' },
    { label: 'サブテキスト', fg:'--fg2', bold:'--ui-muted-bold', italic:'--ui-muted-italic', fontSize:'--ui-muted-font-size', text:'サブテキスト', font:'--ui-muted-font' },
    { label: 'ヘッダー', fg:'--ui-header-fg', bg:'--ui-header-bg', text:'ヘッダー', font:'--ui-header-font' },
    { label: 'ツールバー', fg:'--ui-toolbar-fg', bg:'--ui-toolbar-bg', text:'ツールバー', font:'--ui-toolbar-font' },
    { label: 'ホバー', fg:'--ui-hover-fg', bg:'--ui-hover-bg', text:'ホバー' },
    { label: 'パネル内タブバー', bg:'--ui-inner-tabbar-bg', line:'--ui-inner-tabbar-border', width:'--ui-inner-tabbar-border-width', text:'タブバー' },
    { label: 'パネル内タブ 通常', fg:'--ui-inner-tab-fg', bg:'--ui-inner-tab-bg', bold:'--ui-inner-tab-font-weight', fontSize:'--ui-inner-tab-font-size', text:'タブ', font:'--ui-inner-tab-font' },
    { label: 'パネル内タブ ホバー', fg:'--ui-inner-tab-hover-fg', bg:'--ui-inner-tab-hover-bg', text:'ホバー' },
    { label: 'パネル内タブ 選択', fg:'--ui-inner-tab-active-fg', bg:'--ui-inner-tab-active-bg', bold:'--ui-inner-tab-active-font-weight', line:'--ui-inner-tab-active-underline', width:'--ui-inner-tab-underline-width', text:'選択中' },
    { label: 'パネル内タブ 選択背景濃度', numbers:[{ label:'濃度', key:'--ui-inner-tab-active-bg-alpha', min:0, max:100, step:1, unit:'%', slider:true, fallback:14 }], text:'14%' },
    { label: 'パネル内タブ サイズ', numbers:[{ label:'高さ', key:'--ui-inner-tab-height', min:18, max:56, step:1, unit:'px', fallback:28 }, { label:'左右余白', key:'--ui-inner-tab-padding-x', min:0, max:40, step:1, unit:'px', fallback:12 }], text:'タブ' },
    { label: '強調文字', fg:'--ui-fg-strong', previewBg:'--ui-accent', text:'強調文字' },
    { label: 'スライダー', previewType:'slider', fg:'--ui-range-fill-bg', fgLabel:'塗り', bg:'--ui-range-track-bg', bgLabel:'残り', text:'スライダー' },
    { label: 'アクセント', fg:'--accent', bg:'--accent-bg', text:'アクセント' },
    { label: 'リンク', fg:'--accent2', text:'リンク色' },
    { label: 'ボーダー', line:'--border', text:'━━' },
    { label: 'カーソル', fg:'--editor-caret-color', width:'--editor-caret-width', text:'┃' },
    { label: 'フォーカス枠', line:'--a11y-focus-ring', text:'━━' },
    { label: '選択', fg:'--ui-selection-fg', bg:'--ui-selection-bg', text:'選択行' },
    { label: 'エラー・警告', fg:'--red', text:'エラー' },
  ],
  'フォルダ': [
    { label: 'カード', fg:'--fv-item-fg', bg:'--fv-item-bg', text:'フォルダカード', font:'--fv-font-family' },
    { label: 'カード枠線', line:'--fv-item-border', text:'━━' },
    { label: 'ホバー', fg:'--fv-item-hover-fg', bg:'--fv-item-hover-bg', line:'--fv-item-hover-border', text:'ホバー' },
    { label: '選択', fg:'--fv-item-selected-fg', bg:'--fv-item-selected-bg', line:'--fv-item-selected-border', text:'選択中' },
    { label: 'メタ情報', fg:'--fv-meta-fg', bg:null, text:'更新日時' },
    { label: 'アイコン', fg:'--fv-icon-fg', bg:null, text:'アイコン' },
  ],
  'ノート': [
    { label: 'タイトル', fg:'--page-title-fg', bold:'--page-title-bold', italic:'--page-title-italic', bg:'--page-title-bg', text:'ページタイトル', font:'--page-title-font' },
    { label: '見出し H1', fg:'--page-h1-fg', bold:'--page-h1-bold', italic:'--page-h1-italic', bg:'--page-h1-bg', text:'見出し1', font:'--page-h1-font' },
    { label: '見出し H2', fg:'--page-h2-fg', bold:'--page-h2-bold', italic:'--page-h2-italic', bg:'--page-h2-bg', text:'見出し2', font:'--page-h2-font' },
    { label: '見出し H3', fg:'--page-h3-fg', bold:'--page-h3-bold', italic:'--page-h3-italic', bg:'--page-h3-bg', text:'見出し3', font:'--page-h3-font' },
    { label: '見出し H4', fg:'--page-h4-fg', bold:'--page-h4-bold', italic:'--page-h4-italic', bg:'--page-h4-bg', text:'見出し4', font:'--page-h4-font' },
    { label: '見出し H5', fg:'--page-h5-fg', bold:'--page-h5-bold', italic:'--page-h5-italic', bg:'--page-h5-bg', text:'見出し5', font:'--page-h5-font' },
    { label: '見出し H6', fg:'--page-h6-fg', bold:'--page-h6-bold', italic:'--page-h6-italic', bg:'--page-h6-bg', text:'見出し6', font:'--page-h6-font' },
    { label: '本文', fg:'--page-text-fg', bold:'--page-text-bold', italic:'--page-text-italic', text:'本文テキスト', font:'--page-text-font' },
    { label: '引用ブロック', fg:'--page-quote-fg', bold:'--page-quote-bold', italic:'--page-quote-italic', bg:'--page-quote-bg', text:'引用テキスト', bgType:'rgba' },
    { label: '引用線', line:'--page-quote-border', text:'━━' },
  ],
  'シナリオ': [
    { label: '基本テキスト', fg:'--sn2-base-text-color', bold:'--sn2-base-text-bold', italic:'--sn2-base-text-italic', fontSize:'--sn2-base-text-font-size', font:'--sn2-base-text-font-family', text:'基本テキスト' },
    { label: '枠線', line:'--sn2-border-color', width:'--sn2-border-width', text:'━━' },
    { label: '見開き区切り', line:'--sn2-spread-border-color', width:'--sn2-spread-border-width', text:'━━' },
    { label: 'ホバー', bg:'--sn2-hover-bg', text:'ホバー' },
    { label: 'テキスト選択', fg:'--sn2-selection-fg', bg:'--sn2-selection-color', text:'選択テキスト' },
    { label: 'ドラッグ選択', bg:'--sn2-drag-select-color', text:'ドラッグ選択' },
    { label: 'ドロップ', line:'--sn2-drop-color', width:'--sn2-drop-width', text:'━━' },
    { label: 'カーソル', fg:'--sn2-caret-color', width:'--sn2-caret-width', text:'┃' },
    { label: 'ルビ', numbers:[
      { label:'サイズ',   key:'--sn2-ruby-size',   min:0.3, max:1.5, step:0.05, unit:'em', fallback:0.5 },
      { label:'オフセット', key:'--sn2-ruby-offset', min:-8, max:8,   step:1,    unit:'px', fallback:0 },
    ], text:'ルビ' },
  ],
  'シート': [
    { label: 'ヘッダー', fg:'--db-th-fg', bold:'--db-th-bold', italic:'--db-th-italic', bg:'--db-th-bg', text:'プロパティ名', font:'--db-th-font' },
    { label: 'エントリ列', fg:'--db-entity-fg', bold:'--db-entity-bold', italic:'--db-entity-italic', bg:'--db-entity-bg', text:'キャラ名', font:'--db-entity-font' },
    { label: 'セル', fg:'--db-cell-fg', bold:'--db-cell-bold', italic:'--db-cell-italic', bg:'--db-cell-bg', text:'候補値テキスト', bgType:'rgba', font:'--db-cell-font' },
    { label: '選択', fg:'--db-selection-fg', bg:'--db-selection-color', text:'選択セル' },
    { label: 'アクティブセル枠', line:'--db-active-color', width:'--db-active-width', text:'━━' },
    { label: 'テーブル罫線', line:'--db-grid-border', toggle:'--db-show-grid', toggleOn:'1px', toggleOff:'0px', text:'━━' },
    { label: '採用ステータス', bg:'--db-status-adopted-color', text:'採用ステータス色' },
    { label: 'ソースバッジ 1', bg:'--db-msr-badge-1-bg', text:'1' },
    { label: 'ソースバッジ 2', bg:'--db-msr-badge-2-bg', text:'2' },
    { label: 'ソースバッジ 3', bg:'--db-msr-badge-3-bg', text:'3' },
    { label: 'ソースバッジ 4', bg:'--db-msr-badge-4-bg', text:'4' },
  ],
  'ボード': [
    { label: 'ボード背景', bg:'--bd-bg', text:'ボード背景' },
    { label: '影', bg:'--bd-shadow-color', text:'カードの影' },
    { label: '標準フォント', font:'--bd-default-font-family', text:'カードテキスト' },
    { label: '選択', fg:'--bd-selection-fg', bg:'--bd-selection-color', text:'選択テキスト' },
    { label: '矩形選択', bg:'--bd-select-rect-color', text:'矩形選択' },
    { label: 'グループ', line:'--bd-group-color', text:'━━' },
    { label: 'アンカー', line:'--bd-anchor-color', text:'━━' },
    { label: 'カーソル', fg:'--bd-caret-color', width:'--bd-caret-width', text:'┃' },
    { label: 'カード隙間', numbers:[
      { label:'同階層', key:'--bd-gap-siblings', min:0, max:400, step:1, unit:'px', fallback:10 },
      { label:'階層間',  key:'--bd-gap-levels',  min:0, max:600, step:1, unit:'px', fallback:30 },
    ], text:'隙間' },
  ],
  'カレンダー': [
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
    { label: 'アクセント', fg: '--cal-accent-fg', bg: '--cal-accent', text: '選択' },
    { label: 'タスク列', bg: '--cal-task-column-bg', text: '列' },
    { label: 'タスク見出し', fg: '--cal-task-fg', bg: '--cal-task-header-bg', text: '見出し' },
    { label: 'タスク', fg: '--cal-task-fg', bg: '--cal-task-bg', line: '--cal-task-border', text: 'タスク' },
    { label: '優先度: 緊急', bg: '--cal-task-priority-urgent-bg', text: '緊急' },
    { label: '優先度: 高', bg: '--cal-task-priority-high-bg', text: '高' },
    { label: '優先度: 中', bg: '--cal-task-priority-medium-bg', text: '中' },
    { label: '打刻', fg: '--cal-clock-fg', bg: '--cal-clock-bg', text: '打刻' },
    { label: 'ミニカレンダー選択', fg: '--cal-mini-selected-fg', bg: '--cal-mini-selected-bg', text: '選択日' },
  ],
  'フォルダツリー': [
    { label: 'パネル', fg:'--outliner-fg', bg:'--outliner-bg', line:'--outliner-border', text:'フォルダツリー' },
    { label: '見出し', fg:'--outliner-section-fg', bg:'--outliner-section-bg', text:'見出し' },
    { label: '項目', fg:'--outliner-item-fg', bg:'--outliner-item-bg', text:'項目' },
    { label: '項目ホバー', fg:'--outliner-item-hover-fg', bg:'--outliner-item-hover-bg', text:'ホバー' },
    { label: '項目選択', fg:'--outliner-item-selected-fg', bg:'--outliner-item-selected-bg', text:'選択中' },
    { label: '補助表示', fg:'--outliner-muted-fg', text:'補助' },
    { label: 'ドラッグ/アクセント', line:'--outliner-accent', text:'━━' },
  ],
  'ビューワー': [
    { label: 'パネル', fg:'--preview-fg', line:'--preview-border', text:'ビューワー' },
    { label: 'カード背景', bg:'--preview-card-bg', text:'カード' },
    { label: '本文', fg:'--preview-fg', text:'本文' },
    { label: '補助表示', fg:'--preview-muted-fg', text:'パス' },
    { label: 'ホバー', bg:'--preview-hover-bg', text:'ホバー' },
    { label: 'アクセント', line:'--preview-accent', text:'━━' },
  ],
  'オプション': [
    { label: 'パネル', fg:'--detail-fg', line:'--detail-border', text:'オプション' },
    { label: 'セクション背景', bg:'--detail-panel-bg', text:'セクション' },
    { label: '補助表示', fg:'--detail-muted-fg', text:'補助' },
    { label: 'ホバー', bg:'--detail-hover-bg', text:'ホバー' },
    { label: '選択', fg:'--detail-active-fg', bg:'--detail-active-bg', text:'選択中' },
    { label: 'アクセント', line:'--detail-accent', text:'━━' },
  ],
  'チャット': [
    { label: 'パネル', fg:'--chat-fg', line:'--chat-border', text:'チャット' },
    { label: 'ツール領域', bg:'--chat-panel-bg', text:'ツール' },
    { label: 'メッセージ', fg:'--chat-fg', bg:'--chat-message-bg', text:'メッセージ' },
    { label: '入力欄', fg:'--chat-input-fg', bg:'--chat-input-bg', text:'入力欄' },
    { label: '補助表示', fg:'--chat-muted-fg', text:'補助' },
    { label: 'ホバー', bg:'--chat-hover-bg', text:'ホバー' },
    { label: '選択/送信', fg:'--chat-active-fg', bg:'--chat-active-bg', line:'--chat-accent', text:'送信' },
  ],
  'タイマー': [
    { label: 'パネル', fg:'--timer-fg', line:'--timer-border', text:'タイマー' },
    { label: '設定パネル', bg:'--timer-panel-bg', text:'設定' },
    { label: '表示部', bg:'--timer-display-bg', text:'00:05:00' },
    { label: '補助表示', fg:'--timer-muted-fg', text:'補助' },
    { label: 'ホバー', bg:'--timer-hover-bg', text:'ホバー' },
    { label: '実行中/操作', fg:'--timer-active-fg', bg:'--timer-active-bg', line:'--timer-accent', text:'開始' },
  ],
  'ヒストリー': [
    { label: 'パネル', fg:'--history-fg', line:'--history-border', text:'ヒストリー' },
    { label: '行背景', bg:'--history-row-bg', text:'履歴行' },
    { label: '補助表示', fg:'--history-muted-fg', text:'時刻' },
    { label: 'ホバー', bg:'--history-hover-bg', text:'ホバー' },
    { label: '強調', fg:'--history-active-fg', bg:'--history-active-bg', line:'--history-accent', text:'強調' },
  ],
  '注釈': [
    { label: 'パネル', fg:'--annotation-fg', line:'--annotation-border', text:'注釈' },
    { label: 'カード背景', bg:'--annotation-card-bg', text:'カード' },
    { label: '補助表示', fg:'--annotation-muted-fg', text:'補助' },
    { label: 'ホバー', bg:'--annotation-hover-bg', text:'ホバー' },
    { label: '付箋', fg:'--annotation-note-fg', bg:'--annotation-note-bg', text:'付箋' },
    { label: 'ツール/アクセント', line:'--annotation-accent', text:'━━' },
  ],
  '検索': [
    { label: 'パネル', fg:'--search-fg', line:'--search-border', text:'検索' },
    { label: '結果背景', bg:'--search-panel-bg', text:'結果' },
    { label: '補助表示', fg:'--search-muted-fg', text:'補助' },
    { label: 'ホバー', bg:'--search-hover-bg', text:'ホバー' },
    { label: '選択/アクセント', fg:'--search-active-fg', bg:'--search-active-bg', line:'--search-accent', text:'選択' },
  ],
  'バージョン管理': [
    { label: 'パネル', fg:'--version-fg', line:'--version-border', text:'バージョン管理' },
    { label: '行背景', bg:'--version-row-bg', text:'バージョン' },
    { label: '補助表示', fg:'--version-muted-fg', text:'時刻' },
    { label: 'ホバー', bg:'--version-hover-bg', text:'ホバー' },
    { label: '保存/復元', fg:'--version-active-fg', bg:'--version-active-bg', line:'--version-accent', text:'保存' },
  ],
  '補助パネル': [
    { label: 'フォルダツリー', fg:'--outliner-fg', bg:'--outliner-bg', line:'--outliner-border', text:'フォルダツリー' },
    { label: 'フォルダツリー項目', fg:'--outliner-item-fg', bg:'--outliner-item-bg', text:'項目' },
    { label: 'ビューワー', fg:'--preview-fg', line:'--preview-border', text:'ビューワー' },
    { label: 'ビューワーカード', bg:'--preview-card-bg', text:'カード' },
    { label: 'オプション', fg:'--detail-fg', line:'--detail-border', text:'オプション' },
    { label: 'チャット本文', fg:'--chat-fg', line:'--chat-border', text:'チャット' },
    { label: 'チャット入力', fg:'--chat-input-fg', bg:'--chat-input-bg', text:'入力欄' },
    { label: 'タイマー', fg:'--timer-fg', line:'--timer-border', text:'タイマー' },
    { label: 'ヒストリー', fg:'--history-fg', line:'--history-border', text:'ヒストリー' },
    { label: '注釈', fg:'--annotation-fg', line:'--annotation-border', text:'注釈' },
    { label: '検索', fg:'--search-fg', line:'--search-border', text:'検索' },
    { label: 'バージョン管理', fg:'--version-fg', line:'--version-border', text:'バージョン管理' },
    { label: '補助パネルアクセント', line:'--preview-accent', text:'━━' },
  ],
};

const CS_TAB_NAMES = Object.keys(UI_STYLE_SECTIONS);
const COMMON_INTEGRATED_APP_STYLE_KEYS = new Set([
  ...COMMON_THEME_SURFACE_STYLE_KEYS,
  ...COMMON_THEME_SCROLLBAR_STYLE_KEYS,
  '--fv-item-border', '--fv-item-hover-bg', '--fv-item-selected-fg', '--fv-item-selected-bg',
  '--page-link-fg', '--page-link-bold', '--page-link-italic',
  '--page-hr-color', '--page-quote-border',
  '--page-selection-fg', '--page-selection-color', '--page-caret-color', '--page-caret-width',
  '--sn2-border-color', '--sn2-border-width', '--sn2-spread-border-color', '--sn2-spread-border-width',
  '--sn2-hover-bg', '--sn2-selection-fg', '--sn2-selection-color', '--sn2-caret-color', '--sn2-caret-width',
  '--db-border-color', '--db-selection-fg', '--db-selection-color',
  '--db-active-color', '--db-active-width', '--db-grid-border', '--db-show-grid',
  '--bd-selection-fg', '--bd-selection-color', '--bd-caret-color', '--bd-caret-width',
]);

function _styleBaseKeyForExtras(d) {
  if (!d || d.line || /カーソル|選択|背景|ボーダー|枠線|罫線|区切り|引用線/.test(d.label || '')) return '';
  const source = d.base || d.fg || d.bg || d.font || '';
  if (!source || !String(source).startsWith('--')) return '';
  const base = String(source)
    .replace(/-(?:fg|color|bg|font|bold|italic|font-size)$/i, '')
    .replace(/-text$/i, '-text');
  return base === '--' || !/^--[a-z0-9]/i.test(base) ? '' : base;
}

function _extraStyleKeys(d) {
  const base = _styleBaseKeyForExtras(d);
  if (!base) return [];
  return [
    d.bg || `${base}-bg`,
    d.font || `${base}-font`,
    d.fontSize || `${base}-font-size`,
    d.stroke || `${base}-stroke-color`,
    d.strokeWidth || `${base}-stroke-width`,
    d.leftAccent || `${base}-left-accent`,
    d.underline || `${base}-underline`,
    d.accent || `${base}-accent-color`,
  ].filter(Boolean);
}

function normalizeStyleSettingValue(key, value) {
  const raw = String(value == null ? '' : value).trim();
  if (!raw) return raw;
  const name = String(key || '');
  if (/-left-accent$/i.test(name) && raw === '3px') return THEME_STYLE_LEFT_ACCENT_WIDTH;
  if (/-underline$/i.test(name) && raw.toLowerCase() === 'underline') return THEME_STYLE_UNDERLINE_WIDTH;
  return raw;
}

function settingsThemeStyleSettingTargetKeys(key) {
  const target = String(key || '').trim();
  if (target === SETTINGS_THEME_COMMON_BODY_BG_KEY) {
    return [SETTINGS_THEME_COMMON_BODY_BG_KEY, ...SETTINGS_THEME_COMMON_BODY_BG_LINKED_KEYS];
  }
  if (target === '--ui-accent') {
    return ['--ui-accent', '--accent'];
  }
  return target ? [target] : [];
}

function applySettingsThemeStyleSetting(key, value, options = {}) {
  const targetKeys = settingsThemeStyleSettingTargetKeys(key);
  const raw = String(value == null ? '' : value).trim();
  targetKeys.forEach(targetKey => {
    const next = normalizeStyleSettingValue(targetKey, raw);
    if (next) document.documentElement.style.setProperty(targetKey, next);
    else document.documentElement.style.removeProperty(targetKey);
  });
  if (targetKeys.includes('--bd-bg') && typeof _bdApplyCurrentBoardBackground === 'function') {
    _bdApplyCurrentBoardBackground();
  }
  if (options.markDirty !== false && typeof _settingsThemeMarkDirty === 'function') {
    _settingsThemeMarkDirty();
  }
  return raw;
}

function getAllStyleKeys() {
  const keys = new Set();
  for (const defs of Object.values(UI_STYLE_SECTIONS)) {
    defs.forEach(d => {
      if(d.fg) keys.add(d.fg); if(d.bg) keys.add(d.bg);
      if(d.bold) keys.add(d.bold); if(d.italic) keys.add(d.italic);
      if(d.line) keys.add(d.line); if(d.toggle) keys.add(d.toggle);
      if(d.width) keys.add(d.width); if(d.font) keys.add(d.font);
      if(d.fontSize) keys.add(d.fontSize);
      if(Array.isArray(d.numbers)) d.numbers.forEach(n => { if(n?.key) keys.add(n.key); });
      _extraStyleKeys(d).forEach(k => keys.add(k));
    });
  }
  keys.add('--page-margin-x');
  keys.add('--page-content-max-width');
  // ボード固有設定（UI_STYLE_SECTIONS では表現しきれないキー）
  keys.add('--bd-shadow');
  keys.add('--bd-bg-image');
  keys.add('--bd-bg-image-fit');
  keys.add('--bd-bg-image-scale');
  keys.add('--bd-auto-align');
  return [...keys];
}

function loadColorSettings() {
  try {
    const saved = localStorage.getItem(COLOR_SETTINGS_KEY);
    let appliedThemeColorSet = false;
    const themeColorSetKey = typeof MeldexThemeManager !== 'undefined' ? MeldexThemeManager.THEME_COLOR_SET_KEY : '';
    const osAccentKey = typeof MeldexThemeManager !== 'undefined' ? MeldexThemeManager.THEME_OS_ACCENT_KEY : '';
    const storedThemeColorSet = themeColorSetKey ? localStorage.getItem(themeColorSetKey) : null;
    const storedOsAccent = osAccentKey ? localStorage.getItem(osAccentKey) : null;
    const storedThemeColorSlots = localStorage.getItem(THEME_COLOR_SLOT_SETTINGS_KEY);
    const storedThemeColorExtraSlots = localStorage.getItem(THEME_COLOR_EXTRA_SLOT_SETTINGS_KEY);
    const storedStandardPaletteAdjust = localStorage.getItem(STANDARD_PALETTE_ADJUST_STORAGE_KEY);
    if (saved) {
      const s = JSON.parse(saved);
      for (const [k, v] of Object.entries(s)) {
        if (COMMON_INTEGRATED_APP_STYLE_KEYS.has(k)) continue;
        if (k.startsWith('--')) applySettingsThemeStyleSetting(k, normalizeStyleSettingValue(k, v), { markDirty: false });
      }
      if (!storedThemeColorSet && Object.prototype.hasOwnProperty.call(s, THEME_COLOR_SET_THEME_KEY) && typeof MeldexThemeManager !== 'undefined' && typeof MeldexThemeManager.setThemeColorSet === 'function') {
        _runSettingsWithoutLocalStorageHistory(() => {
          MeldexThemeManager.setThemeColorSet(s[THEME_COLOR_SET_THEME_KEY], { save: true });
        });
        appliedThemeColorSet = true;
      }
      if (!storedThemeColorSlots && Object.prototype.hasOwnProperty.call(s, THEME_COLOR_SLOT_SETTINGS_THEME_KEY)) {
        saveThemeColorSlotSettings(s[THEME_COLOR_SLOT_SETTINGS_THEME_KEY], { skipHistory: true });
      }
      if (!storedThemeColorExtraSlots && Object.prototype.hasOwnProperty.call(s, THEME_COLOR_EXTRA_SLOT_SETTINGS_THEME_KEY)) {
        saveThemeColorExtraSlotSettings(s[THEME_COLOR_EXTRA_SLOT_SETTINGS_THEME_KEY], { skipHistory: true });
      }
      if (!storedStandardPaletteAdjust && Object.prototype.hasOwnProperty.call(s, STANDARD_PALETTE_THEME_KEY) && typeof setStandardPaletteAdjust === 'function') {
        _runSettingsWithoutLocalStorageHistory(() => {
          setStandardPaletteAdjust(s[STANDARD_PALETTE_THEME_KEY]);
        });
      }
      if (storedOsAccent == null && Object.prototype.hasOwnProperty.call(s, THEME_OS_ACCENT_THEME_KEY) && typeof MeldexThemeManager !== 'undefined' && typeof MeldexThemeManager.setUseOsAccentColor === 'function') {
        MeldexThemeManager.setUseOsAccentColor(!!s[THEME_OS_ACCENT_THEME_KEY], { skipHistory: true });
      }
    }
    if (storedOsAccent != null && typeof MeldexThemeManager !== 'undefined' && typeof MeldexThemeManager.setUseOsAccentColor === 'function') {
      MeldexThemeManager.setUseOsAccentColor(storedOsAccent === '1', { skipHistory: true });
    }
    if (!appliedThemeColorSet && typeof MeldexThemeManager !== 'undefined' && typeof MeldexThemeManager.setThemeColorSet === 'function') {
      if (storedThemeColorSet) MeldexThemeManager.setThemeColorSet(JSON.parse(storedThemeColorSet), { save: true, skipHistory: true });
    }
    if (localStorage.getItem(THEME_COLOR_SLOT_SETTINGS_KEY) && typeof _syncThemeColorSetFromPalette === 'function') _syncThemeColorSetFromPalette();
  } catch {}
}

function saveColorSettings() {
  const s = {};
  for (const k of getAllStyleKeys()) {
    if (COMMON_INTEGRATED_APP_STYLE_KEYS.has(k)) continue;
    const v = document.documentElement.style.getPropertyValue(k);
    if (v) s[k] = v;
  }
  if (typeof MeldexThemeManager !== 'undefined' && typeof MeldexThemeManager.getThemeColorSet === 'function') {
    const useOsAccent = typeof MeldexThemeManager.getUseOsAccentColor === 'function'
      ? MeldexThemeManager.getUseOsAccentColor()
      : false;
    if (!useOsAccent) s[THEME_COLOR_SET_THEME_KEY] = MeldexThemeManager.getThemeColorSet();
    s[THEME_OS_ACCENT_THEME_KEY] = useOsAccent;
  }
  const colorSlots = getThemeColorSlotSettings();
  if (colorSlots.some(Boolean)) s[THEME_COLOR_SLOT_SETTINGS_THEME_KEY] = colorSlots;
  const extraSlots = getThemeColorExtraSlotSettings();
  if (Object.keys(extraSlots).length) s[THEME_COLOR_EXTRA_SLOT_SETTINGS_THEME_KEY] = extraSlots;
  if (typeof getStandardPaletteAdjust === 'function') s[STANDARD_PALETTE_THEME_KEY] = getStandardPaletteAdjust();
  try { localStorage.setItem(COLOR_SETTINGS_KEY, JSON.stringify(s)); } catch {}
  // テーマの明暗に応じてcolor-schemeを切替（スピナー等のブラウザUIに影響）
  updateColorScheme();
}

function updateColorScheme() {
  const bg = getCssVar('--bg') || '#1e1e1e';
  const r = parseInt(bg.slice(1,3),16)||0, g = parseInt(bg.slice(3,5),16)||0, b = parseInt(bg.slice(5,7),16)||0;
  const isLight = (r*0.299 + g*0.587 + b*0.114) > 128;
  document.documentElement.classList.toggle('light-theme', isLight);
}

// テーマの明暗に応じたキャラ色パレットを生成
function getRelativeLuminance(hex) {
  if (!hex || !hex.startsWith('#')) return 0;
  const r = parseInt(hex.slice(1,3),16)/255, g = parseInt(hex.slice(3,5),16)/255, b = parseInt(hex.slice(5,7),16)/255;
  const srgb = c => c <= 0.03928 ? c/12.92 : Math.pow((c+0.055)/1.055, 2.4);
  return 0.2126*srgb(r) + 0.7152*srgb(g) + 0.0722*srgb(b);
}

function generateThemedPalette(isDark) {
  // 1段目: 白→黒のグレー段階（7色、透明色の後に並ぶ）
  const grays = ['#ffffff','#e6e6e6','#b3b3b3','#808080','#4d4d4d','#1a1a1a','#000000'];
  // 虹色の基本色相（赤→紫、8色）
  const hues = [0, 25, 50, 100, 160, 210, 260, 300];
  const colors = [...grays], bg = [];
  const rows = isDark
    ? [{s:40,l:65},{s:45,l:45},{s:40,l:35}]  // ダーク系: 明→中→暗
    : [{s:50,l:55},{s:55,l:45},{s:50,l:35}];  // ライト系: 中→やや暗→暗
  const bgRows = isDark
    ? [{s:20,l:28},{s:20,l:22},{s:18,l:18}]
    : [{s:15,l:80},{s:15,l:70},{s:12,l:60}];

  for (const row of rows) {
    for (const h of hues) {
      colors.push(hslToHex(h, row.s, row.l));
    }
  }
  for (const row of bgRows) {
    for (const h of hues) {
      bg.push(hslToHex(h, row.s, row.l));
    }
  }
  return { colors, bg };
}

function hslToHex(h, s, l) {
  s /= 100; l /= 100;
  const a = s * Math.min(l, 1-l);
  const f = n => { const k = (n + h/30) % 12; return l - a * Math.max(-1, Math.min(k-3, 9-k, 1)); };
  return '#' + [f(0),f(8),f(4)].map(v => Math.round(v*255).toString(16).padStart(2,'0')).join('');
}

// プレビューを実際の見出しサイズで表示するためのマップ（ノートタブ用）
const STYLE_PREVIEW_FONT_SIZES = {
  'タイトル': 28,
  '見出し H1': 24,
  '見出し H2': 20,
  '見出し H3': 16,
  '見出し H4': 16,
  '見出し H5': 14,
  '見出し H6': 13,
};

function _settingsThemePreviewAutoTargetForRow(d) {
  const label = String(d?.label || '').trim();
  const heading = label.match(/^見出し H([1-6])$/);
  if (heading) return { targetId: 'note-heading', index: parseInt(heading[1], 10) - 1 };
  if (/目次/.test(label)) return { targetId: 'note-toc-item', index: 0 };
  if (label === 'カード' && (d?.fg === '--fv-item-fg' || d?.bg === '--fv-item-bg')) {
    return { targetId: 'folder-panel-folder', index: 0 };
  }
  if (label === '項目' && (d?.fg === '--outliner-item-fg' || d?.bg === '--outliner-item-bg')) {
    return { targetId: 'folder-tree-folder', index: 0 };
  }
  return null;
}

function _settingsThemePreviewAutoMixCss(toneColor, amount, slotIndex, fallbackColor) {
  const percent = Math.max(0, Math.min(100, parseInt(amount ?? 30, 10) || 0));
  return `color-mix(in srgb, var(--theme-palette-${slotIndex}, ${fallbackColor}) ${100 - percent}%, ${toneColor} ${percent}%)`;
}

function _settingsThemePreviewAutoColor(value, sequentialIndex) {
  const normalized = String(value == null ? 'none' : value).trim();
  if (!normalized || normalized === 'none') return '';
  const colors = getCurrentThemeColorSet();
  const paletteLength = Math.max(1, colors.length || 0);
  const seqIndex = Math.max(0, parseInt(sequentialIndex, 10) || 0) % paletteLength;
  const seqFallback = colors[seqIndex] || colors[0] || '#ef4444';
  if (normalized === 'auto') return `var(--theme-palette-${seqIndex}, ${seqFallback})`;
  if (normalized === 'auto-light') return _settingsThemePreviewAutoMixCss('white', _themeUiAutoTone()?.light, seqIndex, seqFallback);
  if (normalized === 'auto-dark') return _settingsThemePreviewAutoMixCss('black', _themeUiAutoTone()?.dark, seqIndex, seqFallback);
  if (normalized === 'os-accent') return 'var(--theme-os-accent, AccentColor)';
  const custom = _themeUiCustomColor(normalized);
  if (custom) return custom;
  const paletteIndex = parseInt(normalized, 10);
  if (Number.isInteger(paletteIndex) && paletteIndex >= 0) {
    const fallback = colors[paletteIndex % paletteLength] || seqFallback;
    return `var(--theme-palette-${paletteIndex}, ${fallback})`;
  }
  return '';
}

function _settingsThemePreviewAutoStyleForRow(d) {
  const target = _settingsThemePreviewAutoTargetForRow(d);
  if (!target || typeof MeldexThemeManager === 'undefined' || typeof MeldexThemeManager.getThemeUiApplications !== 'function') {
    return {};
  }
  const normal = MeldexThemeManager.getThemeUiApplications()?.[target.targetId]?.normal || {};
  return {
    fg: _settingsThemePreviewAutoColor(normal.fg, target.index),
    bg: _settingsThemePreviewAutoColor(normal.bg, target.index),
    underline: _settingsThemePreviewAutoColor(normal.underline, target.index),
  };
}

function _settingsThemePreviewExtraKey(d, prop, suffix) {
  if (d?.[prop]) return d[prop];
  const base = _styleBaseKeyForExtras(d);
  return base ? `${base}${suffix}` : '';
}

function _settingsThemePreviewActiveFlag(value) {
  const v = String(value == null ? '' : value).trim().toLowerCase();
  if (/^0(?:\.0+)?(?:px|em|rem|%)?$/.test(v)) return false;
  return !!v && v !== '0' && v !== 'none' && v !== 'normal' && v !== 'false';
}

function _settingsThemePreviewStyle(d) {
  if (Array.isArray(d?.numbers) && d.numbers.length) {
    return /選択背景/.test(d.label || '')
      ? 'background:var(--ui-inner-tab-active-bg);color:var(--ui-inner-tab-active-fg);'
      : 'background:var(--ui-inner-tab-bg);color:var(--ui-inner-tab-fg);';
  }
  const autoStyle = _settingsThemePreviewAutoStyleForRow(d);
  const pvBg = autoStyle.bg || (d.previewBg ? `var(${d.previewBg})` : (d.bg ? `var(${d.bg})` : 'var(--bg)'));
  const pvFg = autoStyle.fg || (d.fg ? `var(${d.fg})` : d.line ? `var(${d.line})` : 'var(--fg)');
  const strokeKey = _settingsThemePreviewExtraKey(d, 'stroke', '-stroke-color');
  const strokeWidthKey = _settingsThemePreviewExtraKey(d, 'strokeWidth', '-stroke-width');
  const leftAccentKey = _settingsThemePreviewExtraKey(d, 'leftAccent', '-left-accent');
  const underlineKey = _settingsThemePreviewExtraKey(d, 'underline', '-underline');
  const accentKey = _settingsThemePreviewExtraKey(d, 'accent', '-accent-color');
  const hasLeftAccent = leftAccentKey && _settingsThemePreviewActiveFlag(getCssVar(leftAccentKey));
  const hasUnderline = underlineKey && _settingsThemePreviewActiveFlag(getCssVar(underlineKey));
  const lineWidth = d.width ? `var(${d.width}, 3px)` : '3px';
  const autoAccent = autoStyle.underline || '';
  const fallbackAccent = d.line ? `var(${d.line})` : pvFg;
  const accent = accentKey ? `var(${accentKey}, ${autoAccent || fallbackAccent})` : (autoAccent || fallbackAccent);
  const shadows = [];
  const parts = [
    `background:${pvBg}`,
    `color:${pvFg}`,
  ];
  if (d.bold) parts.push(`font-weight:var(${d.bold})`);
  if (d.italic) parts.push(`font-style:var(${d.italic})`);
  if (autoAccent && d.line) {
    parts.push(`border-bottom:${lineWidth} solid ${autoAccent}`);
  } else if (d.line) {
    parts.push(`border-bottom:${lineWidth} solid var(${d.line})`);
  }
  if (d.font) parts.push(`font-family:var(${d.font}, inherit)`);
  if (strokeKey || strokeWidthKey) {
    parts.push(
      `-webkit-text-stroke-color:${strokeKey ? `var(${strokeKey})` : 'transparent'}`,
      `-webkit-text-stroke-width:${strokeWidthKey ? `var(${strokeWidthKey}, 0px)` : '0px'}`,
      'paint-order:stroke fill'
    );
  }
  if (hasLeftAccent) {
    shadows.push(`-${THEME_STYLE_LEFT_ACCENT_WIDTH} 0 0 0 ${accent}`);
    parts.push(`padding-left:${THEME_STYLE_LEFT_ACCENT_WIDTH}`);
  }
  if (hasUnderline) {
    parts.push(`border-bottom:${THEME_STYLE_UNDERLINE_WIDTH} solid ${accent}`);
  }
  if (shadows.length) parts.push(`box-shadow:${shadows.join(',')}`);
  const previewSize = STYLE_PREVIEW_FONT_SIZES[d.label];
  if (d.fontSize) parts.push(`font-size:var(${d.fontSize}${previewSize ? `, ${previewSize}px` : ''})`, 'line-height:1.3');
  else if (previewSize) parts.push(`font-size:${previewSize}px`, 'line-height:1.3');
  return `${parts.join(';')};`;
}

function _settingsThemeStylePreviewPanels(root) {
  const base = root || document;
  const direct = base?.closest?.('[data-settings-theme-style-panel]');
  if (direct) return [direct];
  const panels = Array.from(base?.querySelectorAll?.('[data-settings-theme-style-panel]') || []);
  const rendered = panels.filter(panel => panel.dataset?.settingsThemeStyleRendered !== '0');
  if (rendered.length) return rendered;
  const visible = panels.filter(panel => !panel.hidden);
  if (visible.length) return visible;
  return base?.matches?.('[data-settings-theme-style-panel]') ? [base] : [];
}

function _refreshSettingsThemeStylePreviewPanel(panel) {
  if (!panel || !panel.querySelectorAll) return;
  const panelName = panel.dataset?.settingsThemeStylePanel || '';
  const rawDefs = UI_STYLE_SECTIONS?.[panelName] || [];
  const defs = typeof _filterCommonDuplicates === 'function'
    ? _filterCommonDuplicates(rawDefs, panelName)
    : rawDefs;
  panel.querySelectorAll('.cs-row-preview[data-style-preview-label]').forEach(preview => {
    const label = preview.dataset.stylePreviewLabel || '';
    const def = defs.find(item => String(item?.label || '') === label);
    if (def) preview.setAttribute('style', _settingsThemePreviewStyle(def));
  });
}

function refreshSettingsThemeStylePreviews(root) {
  _settingsThemeStylePreviewPanels(root).forEach(_refreshSettingsThemeStylePreviewPanel);
}

function _bindSettingsThemeStylePreviewRefreshEvents() {
  if (typeof window === 'undefined' || window.__settingsThemeStylePreviewRefreshBound) return;
  window.__settingsThemeStylePreviewRefreshBound = true;
  const refreshOpenEditor = () => {
    const editor = document.getElementById('settings-theme-editor');
    if (editor && typeof refreshSettingsThemeStylePreviews === 'function') {
      refreshSettingsThemeStylePreviews(editor);
    }
  };
  window.addEventListener('meldex-theme-ui-applications-change', refreshOpenEditor);
  window.addEventListener('meldex-theme-ui-auto-tone-change', refreshOpenEditor);
  window.addEventListener('meldex-theme-color-set-change', refreshOpenEditor);
  window.addEventListener('meldex-theme-change', refreshOpenEditor);
}

_bindSettingsThemeStylePreviewRefreshEvents();

function _settingsThemeE2eId(...parts) {
  return parts
    .map(part => String(part == null ? '' : part).trim().replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, ''))
    .filter(Boolean)
    .join('-');
}

function _settingsThemeE2eFallbackText(value) {
  const text = String(value == null ? '' : value).trim();
  if (!text) return '';
  const ascii = text.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  if (ascii) return ascii;
  return Array.from(text).map(ch => ch.charCodeAt(0).toString(16)).join('-');
}

function _settingsThemePreviewE2eId(d) {
  const numberKeys = Array.isArray(d?.numbers) ? d.numbers.map(item => item?.key || '').filter(Boolean).join('_') : '';
  return _settingsThemeE2eId(
    'settings-theme-style-preview',
    d?.fg,
    d?.bg,
    d?.line,
    d?.font,
    d?.bold,
    d?.italic,
    d?.fontSize,
    d?.width,
    numberKeys,
    _settingsThemeE2eFallbackText(d?.label || d?.text)
  );
}

// 行レンダリング（全タブ共通）
function renderStyleRow(d) {
  const fgVal = d.fg ? getCssVar(d.fg) : '';
  const bgVal = d.bg ? getCssVar(d.bg) : '';
  const lineVal = d.line ? getCssVar(d.line) : '';
  const boldVal = d.bold ? getCssVar(d.bold) : '';
  const italicVal = d.italic ? getCssVar(d.italic) : '';
  const isBgOnly = !!(d.bg && !d.fg && !d.bold && !d.italic && !d.font && !d.fontSize && !d.line && !d.width);

  if (Array.isArray(d.numbers) && d.numbers.length) {
    const previewStyle = _settingsThemePreviewStyle(d);
    const controls = d.numbers.map(n => {
      const raw = getCssVar(n.key);
      const m = String(raw || '').match(/-?\d+(?:\.\d+)?/);
      const value = m ? parseFloat(m[0]) : (n.fallback ?? n.value ?? n.min ?? 0);
      const unit = n.unit || '';
      const attrs = `data-number-key="${esc(n.key)}" data-unit="${esc(unit)}" min="${esc(n.min ?? '')}" max="${esc(n.max ?? '')}" step="${esc(n.step ?? 1)}"`;
      const controlId = _settingsThemeE2eId('settings-theme-number', n.key);
      const range = n.slider ? `<input type="range" class="cs-alpha cs-number-range" value="${esc(value)}" ${attrs} data-e2e-id="${esc(controlId + '-range')}" data-oninput="setNumericStyleSetting(this)">` : '';
      return `<div class="cs-row-group cs-row-group--number">
        <span class="cs-row-group-label">${esc(n.label || '')}</span>
        ${range}
        <input type="number" class="cs-width-input cs-number-input" value="${esc(value)}" ${attrs} data-e2e-id="${esc(controlId + '-input')}" data-oninput="setNumericStyleSetting(this)" data-onchange="setNumericStyleSetting(this)">
        <span class="cs-number-unit">${esc(unit)}</span>
      </div>`;
    }).join('');
    const previewId = _settingsThemePreviewE2eId(d);
    return `<div class="cs-row">
      <span class="cs-row-label">${esc(d.label)}</span>
      <span class="cs-row-preview" data-e2e-id="${esc(previewId)}" data-style-preview-label="${esc(d.label || '')}" style="${esc(previewStyle)}">${esc(d.text || d.label || '数値')}</span>
      ${controls}
    </div>`;
  }

  if (isBgOnly) {
    const swatchValue = bgVal || 'transparent';
    return `<div class="cs-row">
      <span class="cs-row-label">${d.label}</span>
      <div class="cs-swatch" style="background:${swatchValue};"
        data-e2e-id="${esc(_settingsThemeE2eId('settings-theme-swatch', d.bg))}" data-key="${d.bg}" data-action="openCsPalette(this,'${d.bg}')"></div>
    </div>`;
  }

  const previewStyle = _settingsThemePreviewStyle(d);

  // 文字スタイル系の行（fg+bold+italic を持つ）はクリックで書式ポップアップを開けるようにする
  const isStyleRow = !!(d.fg && d.bold && d.italic);
  const previewLabelAttr = ` data-style-preview-label="${esc(d.label || '')}"`;
  const previewId = _settingsThemePreviewE2eId(d);
  const previewAttrs = isStyleRow
    ? `${previewLabelAttr} data-e2e-id="${esc(previewId)}" data-style-label="${esc(d.label)}" data-action="openStylePreviewPopup(this)" tabindex="0" role="button" title="クリックで書式設定"`
    : `${previewLabelAttr} data-e2e-id="${esc(previewId)}"`;
  const previewClass = isStyleRow ? 'cs-row-preview cs-row-preview--clickable' : 'cs-row-preview';

  let row = `<div class="cs-row">
    <span class="cs-row-label">${d.label}</span>
    <span class="${previewClass}"${previewAttrs} style="${esc(previewStyle)}">${d.text}</span>`;

  // 線色タイプ
  if (d.line) {
    const hex = lineVal.startsWith('#') ? lineVal : rgbToHex(lineVal);
    row += `<div class="cs-row-group">
      <span class="cs-row-group-label">線色</span>
      <div class="cs-swatch" style="background:${hex};"
        data-e2e-id="${esc(_settingsThemeE2eId('settings-theme-swatch', d.line))}" data-key="${d.line}" data-action="openCsPalette(this,'${d.line}')"></div>
    </div>`;
    if (d.toggle) {
      const isOn = getCssVar(d.toggle) !== d.toggleOff;
      row += `<button class="cs-toggle${isOn?' active':''}" data-e2e-id="${esc(_settingsThemeE2eId('settings-theme-toggle-line', d.toggle))}" data-key="${d.toggle}" data-on="${d.toggleOn}" data-off="${d.toggleOff}" data-action="toggleLineVisibility(this)">表示</button>`;
    }
    if (d.width) {
      const curW = getCssVar(d.width);
      row += `<div class="cs-row-group">
        <span class="cs-row-group-label">太さ</span>
        <input type="number" min="0" max="10" step="1" value="${parseInt(curW)||1}" data-e2e-id="${esc(_settingsThemeE2eId('settings-theme-line-width', d.width))}" data-key="${d.width}" class="cs-width-input"
          data-onchange="document.documentElement.style.setProperty(this.dataset.key, this.value+'px');if(typeof _settingsThemeMarkDirty==='function')_settingsThemeMarkDirty()">px</div>`;
    }
    row += '</div>';
    return row;
  }

  // 文字色スウォッチ
  if (d.fg) {
    const hex = fgVal.startsWith('#') ? fgVal : rgbToHex(fgVal);
    row += `<div class="cs-row-group">
      <span class="cs-row-group-label">${d.fgLabel || '文字'}</span>
      <div class="cs-swatch" style="background:${hex};"
        data-e2e-id="${esc(_settingsThemeE2eId('settings-theme-swatch', d.fg))}" data-key="${d.fg}" data-action="openCsPalette(this,'${d.fg}')"></div>
    </div>`;
  }

  // 太字トグル
  if (d.bold) {
    const isB = boldVal === 'bold';
    row += `<button class="cs-toggle cs-toggle-bold${isB?' active':''}" data-e2e-id="${esc(_settingsThemeE2eId('settings-theme-bold', d.bold))}" data-key="${d.bold}" data-val="bold" data-action="toggleCsStyle(this)">B</button>`;
  }

  // 斜体トグル
  if (d.italic) {
    const isI = italicVal === 'italic';
    row += `<button class="cs-toggle cs-toggle-italic${isI?' active':''}" data-e2e-id="${esc(_settingsThemeE2eId('settings-theme-italic', d.italic))}" data-key="${d.italic}" data-val="italic" data-action="toggleCsStyle(this)">I</button>`;
  }

  if (d.font) {
    const fontVal = getCssVar(d.font);
    row += `<div class="cs-row-group">
      <span class="cs-row-group-label">フォント</span>
      <select class="gb-select gb-select-sm cs-font-select" data-e2e-id="${esc(_settingsThemeE2eId('settings-theme-font', d.font))}" data-key="${d.font}"
        data-onchange="setThemeFontSetting(this.dataset.key, this.value)">
        ${typeof getFontFamilyOptions === 'function' ? getFontFamilyOptions(fontVal) : ''}
      </select>
    </div>`;
  }

  // 背景色スウォッチ
  if (d.bg) {
    if (d.bgType === 'rgba') {
      // スウォッチ + 不透明度スライダー（rgba/transparent対応）
      const { hex: bgHex, alpha: bgAlpha } = parseColorToHexAlpha(bgVal);
      const pct = Math.round(bgAlpha * 100);
      row += `<div class="cs-row-group">
        <span class="cs-row-group-label">背景</span>
        <div class="cs-swatch" style="background:${bgVal};"
          data-e2e-id="${esc(_settingsThemeE2eId('settings-theme-swatch', d.bg))}" data-key="${d.bg}" data-hex="${bgHex}" data-rgba="1" data-action="openCsPaletteRgba(this,'${d.bg}')"></div>
        <input type="range" min="0" max="100" value="${pct}" class="cs-alpha" data-e2e-id="${esc(_settingsThemeE2eId('settings-theme-alpha', d.bg))}" data-key="${d.bg}"
          data-oninput="this.nextElementSibling.textContent=this.value+'%';updateBgFromSwatchAlpha('${d.bg}')">
        <span class="cs-alpha-val">${pct}%</span>
      </div>`;
    } else {
      const hex = bgVal.startsWith('#') ? bgVal : rgbToHex(bgVal);
      row += `<div class="cs-row-group">
      <span class="cs-row-group-label">${d.bgLabel || '背景'}</span>
      <div class="cs-swatch" style="background:${hex};"
          data-e2e-id="${esc(_settingsThemeE2eId('settings-theme-swatch', d.bg))}" data-key="${d.bg}" data-action="openCsPalette(this,'${d.bg}')"></div>
      </div>`;
    }
  }

  row += '</div>';
  return row;
}

function getCurrentThemeColorSet() {
  if (typeof MeldexThemeManager !== 'undefined' && typeof MeldexThemeManager.getThemeColorSet === 'function') {
    return MeldexThemeManager.getThemeColorSet();
  }
  return ['#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899'];
}

function normalizeThemeColorSlotSettings(raw) {
  const src = Array.isArray(raw) ? raw : (Array.isArray(raw?.slots) ? raw.slots : []);
  const out = [];
  for (let i = 0; i < 8; i += 1) {
    const item = src[i];
    const color = _themeUiNormalizeHexColor(typeof item === 'string' ? item : item?.color);
    out.push(color ? { color, applyAdjust: item?.applyAdjust !== false } : null);
  }
  return out;
}

function getThemeColorSlotSettings() {
  try {
    return normalizeThemeColorSlotSettings(JSON.parse(localStorage.getItem(THEME_COLOR_SLOT_SETTINGS_KEY) || 'null'));
  } catch {
    return normalizeThemeColorSlotSettings(null);
  }
}

function _refreshThemePaletteSettingsAfterHistory() {
  const nextPalette = typeof _syncThemeColorSetFromPalette === 'function'
    ? _syncThemeColorSetFromPalette()
    : getCurrentThemeColorSet();
  const root = document.getElementById('settings-theme-editor') || document;
  if (typeof _settingsThemePaletteMatrixRender === 'function') _settingsThemePaletteMatrixRender(root);
  if (typeof syncThemeColorSetSwatches === 'function') syncThemeColorSetSwatches(root, nextPalette);
  if (typeof refreshSettingsThemeStylePreviews === 'function') refreshSettingsThemeStylePreviews(root);
}

function saveThemeColorSlotSettings(slots, options) {
  const next = normalizeThemeColorSlotSettings(slots);
  const opts = options || {};
  const compact = next.map(slot => slot ? { color: slot.color, applyAdjust: slot.applyAdjust !== false } : null);
  const before = (typeof captureLocalStorageSettings === 'function')
    ? captureLocalStorageSettings([THEME_COLOR_SLOT_SETTINGS_KEY])
    : null;
  try {
    if (compact.some(Boolean)) localStorage.setItem(THEME_COLOR_SLOT_SETTINGS_KEY, JSON.stringify(compact));
    else localStorage.removeItem(THEME_COLOR_SLOT_SETTINGS_KEY);
  } catch {}
  if (before && opts.skipHistory !== true && typeof pushLocalStorageSettingsHistory === 'function') {
    pushLocalStorageSettingsHistory(
      '設定: テーマカラースロット変更',
      before,
      captureLocalStorageSettings([THEME_COLOR_SLOT_SETTINGS_KEY]),
      '',
      _refreshThemePaletteSettingsAfterHistory
    );
  }
  return next;
}

// 拡張スロット: 行1・2・4 (行3は themeColorSlotSettings) の個別色上書き。
// 形式: { "1-1": "#rrggbb", "2-0": "#rrggbb", "4-7": "#rrggbb", ... }
// キー: `${row}-${col}` (row 1/2/4, col 0-7)。行1 col 0 は透明固定のため保存しない。
function normalizeThemeColorExtraSlotSettings(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [key, value] of Object.entries(raw)) {
    if (!/^[124]-[0-7]$/.test(key)) continue;
    if (key === '1-0') continue;
    const color = _themeUiNormalizeHexColor(typeof value === 'string' ? value : value?.color);
    if (color) out[key] = color;
  }
  return out;
}

function getThemeColorExtraSlotSettings() {
  try {
    return normalizeThemeColorExtraSlotSettings(JSON.parse(localStorage.getItem(THEME_COLOR_EXTRA_SLOT_SETTINGS_KEY) || 'null'));
  } catch {
    return {};
  }
}

function saveThemeColorExtraSlotSettings(slots, options) {
  const next = normalizeThemeColorExtraSlotSettings(slots);
  const opts = options || {};
  const before = (typeof captureLocalStorageSettings === 'function')
    ? captureLocalStorageSettings([THEME_COLOR_EXTRA_SLOT_SETTINGS_KEY])
    : null;
  try {
    if (Object.keys(next).length) localStorage.setItem(THEME_COLOR_EXTRA_SLOT_SETTINGS_KEY, JSON.stringify(next));
    else localStorage.removeItem(THEME_COLOR_EXTRA_SLOT_SETTINGS_KEY);
  } catch {}
  if (before && opts.skipHistory !== true && typeof pushLocalStorageSettingsHistory === 'function') {
    pushLocalStorageSettingsHistory(
      '設定: テーマカラー拡張スロット変更',
      before,
      captureLocalStorageSettings([THEME_COLOR_EXTRA_SLOT_SETTINGS_KEY]),
      '',
      _refreshThemePaletteSettingsAfterHistory
    );
  }
  return next;
}

function _getExtraSlotOverride(row, col) {
  const key = `${row}-${col}`;
  if (key === '1-0') return null;
  const slots = getThemeColorExtraSlotSettings();
  return slots[key] || null;
}

function _settingsThemeGeneratedColorSet(adjust) {
  if (typeof getStandardPaletteSwatches === 'function') {
    const swatches = getStandardPaletteSwatches(adjust).filter(swatch => swatch.row === 3).map(swatch => swatch.color);
    if (swatches.length) return swatches.slice(0, 8);
  }
  return getCurrentThemeColorSet().slice(0, 8);
}

function computeThemeColorSetFromSlots(adjust, slots) {
  const fallbackAdjust = typeof getStandardPaletteAdjust === 'function' ? getStandardPaletteAdjust() : null;
  const currentAdjust = typeof normalizeStandardPaletteAdjust === 'function'
    ? normalizeStandardPaletteAdjust(adjust || fallbackAdjust)
    : (adjust || {});
  const generated = _settingsThemeGeneratedColorSet(currentAdjust);
  const slotSettings = normalizeThemeColorSlotSettings(slots || getThemeColorSlotSettings());
  return generated.map((color, index) => {
    const slot = slotSettings[index];
    if (!slot) return color;
    if (slot.applyAdjust === false || typeof adjustStandardPaletteColor !== 'function') return slot.color;
    return adjustStandardPaletteColor(slot.color, currentAdjust);
  });
}

function renderSettingsThemePaletteEditor() {
  const editorId = 'settings-theme-palette-editor';
  const rowsHtml = `<div class="cs-theme-palette-matrix" data-theme-palette-matrix></div>`;
  const slider = (key, label, min, max) => `
    <label class="cs-theme-palette-slider-row" data-theme-palette-slider-row="${key}">
      <span class="cs-theme-palette-slider-label">${esc(label)}</span>
      <input type="range" min="${min}" max="${max}" step="1" data-e2e-id="settings-theme-palette-slider-${key}" data-theme-palette-slider="${key}">
      <input type="number" min="${min}" max="${max}" step="1" class="gb-input-sm cs-theme-palette-slider-num" data-e2e-id="settings-theme-palette-slider-num-${key}" data-theme-palette-slider-num="${key}">
    </label>`;
  const osAccent = typeof MeldexThemeManager !== 'undefined' && typeof MeldexThemeManager.getUseOsAccentColor === 'function'
    ? MeldexThemeManager.getUseOsAccentColor()
    : false;
  const actionsHtml = `<div class="cs-theme-palette-slider-actions">
    <button type="button" class="cs-toggle${osAccent ? ' active' : ''}" data-e2e-id="settings-theme-palette-os-accent-toggle" data-theme-os-accent-toggle title="リンク色・スライダー・カーソルなどの基本アクセント色をOSのアクセントカラーに合わせる">OSアクセント</button>
    <button type="button" class="cs-toggle" data-e2e-id="settings-theme-palette-reset" data-theme-palette-reset title="色相・彩度・明度・明暗比の調整値をリセット">調整をリセット</button>
  </div>`;
  const slidersHtml = `<div class="cs-theme-palette-sliders">
    ${slider('hueStart', '色相 始', '-360', '360')}
    ${slider('hueEnd', '色相 終', '-360', '360')}
    ${slider('saturation', '彩度', '0', '100')}
    ${slider('brightness', '明度', '-100', '100')}
    ${slider('contrast', '明暗比', '0', '100')}
    ${actionsHtml}
  </div>`;
  return `<div id="${editorId}" class="cs-theme-palette-editor">
    ${rowsHtml}
    ${slidersHtml}
  </div>`;
}

function renderThemeColorSetEditor(colorsOverride, options = {}) {
  const hasScopedOsAccent = Object.prototype.hasOwnProperty.call(options || {}, 'osAccent');
  const osAccent = hasScopedOsAccent
    ? !!options.osAccent
    : (typeof MeldexThemeManager !== 'undefined' && typeof MeldexThemeManager.getUseOsAccentColor === 'function'
    ? MeldexThemeManager.getUseOsAccentColor()
    : false);
  const osAccentColor = Object.prototype.hasOwnProperty.call(options || {}, 'osAccentColor')
    ? options.osAccentColor
    : (typeof MeldexThemeManager !== 'undefined' && typeof MeldexThemeManager.getOsAccentColor === 'function'
    ? MeldexThemeManager.getOsAccentColor()
    : 'var(--theme-os-accent, AccentColor)');
  const osAccentSwatchColor = osAccentColor || (Array.isArray(colorsOverride) && colorsOverride[0]) || 'var(--theme-os-accent, AccentColor)';
  const osAccentSwatchTitle = osAccentColor ? `OSアクセント: ${osAccentColor}` : 'OSアクセント: 取得待ち';
  const colors = osAccent
    ? [osAccentSwatchColor]
    : (Array.isArray(colorsOverride) ? colorsOverride : getCurrentThemeColorSet());
  const swatches = osAccent
    ? `<button type="button" class="cs-swatch cs-theme-color-swatch cs-theme-color-swatch--os" data-e2e-id="settings-theme-color-os-swatch" data-theme-os-accent-swatch title="${esc(osAccentSwatchTitle)}" style="background:${esc(colors[0])};"></button>`
    : colors.map((color, index) => (
      `<button type="button" class="cs-swatch cs-theme-color-swatch" data-e2e-id="settings-theme-color-slot-${index}" data-theme-color-slot="${index}" title="テーマカラー ${index + 1}" style="background:${esc(color)};"></button>`
    )).join('');
  const label = options.hideLabel ? '' : '<span class="cs-row-label">テーマカラー</span>';
  return `<div class="cs-row cs-theme-color-set-row">
    ${label}
    <div class="cs-row-group cs-theme-color-set">${swatches}</div>
    <button type="button" class="cs-toggle${osAccent ? ' active' : ''}" data-e2e-id="settings-theme-color-os-accent-toggle" data-theme-os-accent-toggle title="リンク色・スライダー・カーソルなどの基本アクセント色をOSのアクセントカラーに合わせる">OSアクセント</button>
    ${osAccent ? '' : '<button type="button" class="cs-toggle" data-e2e-id="settings-theme-color-reset" data-theme-color-reset>既定</button>'}
  </div>`;
}

function _themeUiNormalizeHexColor(color) {
  const raw = String(color == null ? '' : color).trim();
  const short = raw.match(/^#([0-9a-f]{3})$/i);
  if (short) return '#' + short[1].split('').map(ch => ch + ch).join('').toLowerCase();
  const full = raw.match(/^#([0-9a-f]{6})$/i);
  return full ? '#' + full[1].toLowerCase() : '';
}

function _themeUiCustomValue(color) {
  const hex = _themeUiNormalizeHexColor(color);
  return hex ? THEME_UI_CUSTOM_COLOR_PREFIX + hex : '';
}

function _themeUiCustomColor(value) {
  const raw = String(value == null ? '' : value).trim();
  if (raw.startsWith(THEME_UI_CUSTOM_COLOR_PREFIX)) return _themeUiNormalizeHexColor(raw.slice(THEME_UI_CUSTOM_COLOR_PREFIX.length));
  return _themeUiNormalizeHexColor(raw);
}

function _themeUiSelectOptions(value) {
  const items = _themeUiOptionItems(value);
  const current = String(value || 'none');
  return items.map(item => {
    if (item.group) return `<option value="" disabled>${esc(item.label)}</option>`;
    const customAttr = item.custom ? ' data-theme-ui-custom-option="1"' : '';
    return `<option value="${esc(item.value)}"${current === String(item.value) ? ' selected' : ''}${customAttr}>${esc(item.label)}</option>`;
  }).join('');
}

function _themeUiAutoTone() {
  if (typeof MeldexThemeManager !== 'undefined' && typeof MeldexThemeManager.getThemeUiAutoTone === 'function') {
    return MeldexThemeManager.getThemeUiAutoTone();
  }
  return { light: 30, dark: 30 };
}

function _themeUiAutoToneVars(tone) {
  const light = Math.max(0, Math.min(100, parseInt(tone?.light ?? 30, 10) || 0));
  const dark = Math.max(0, Math.min(100, parseInt(tone?.dark ?? 30, 10) || 0));
  return `--theme-ui-auto-light-base:${100 - light}%;--theme-ui-auto-light-percent:${light}%;--theme-ui-auto-dark-base:${100 - dark}%;--theme-ui-auto-dark-percent:${dark}%;`;
}

function _themeUiAutoSwatch(kind) {
  if (kind === 'light') return 'color-mix(in srgb, var(--theme-slot-color,var(--accent)) var(--theme-ui-auto-light-base,70%), white var(--theme-ui-auto-light-percent,30%))';
  if (kind === 'dark') return 'color-mix(in srgb, var(--theme-slot-color,var(--accent)) var(--theme-ui-auto-dark-base,70%), black var(--theme-ui-auto-dark-percent,30%))';
  return 'var(--theme-slot-color,var(--accent))';
}

function _themeUiOptionItems(value) {
  const colors = getCurrentThemeColorSet();
  const osAccent = typeof MeldexThemeManager !== 'undefined' && typeof MeldexThemeManager.getUseOsAccentColor === 'function'
    ? MeldexThemeManager.getUseOsAccentColor()
    : false;
  const customColor = _themeUiCustomColor(value) || '#ef4444';
  const items = [
    { value: 'none', label: 'なし', swatch: '' },
    { value: 'auto', label: '自動', swatch: _themeUiAutoSwatch('auto') },
    { value: 'auto-light', label: '自動（明）', swatch: _themeUiAutoSwatch('light') },
    { value: 'auto-dark', label: '自動（暗）', swatch: _themeUiAutoSwatch('dark') },
    { value: 'os-accent', label: 'OSアクセント', swatch: 'var(--theme-os-accent, AccentColor)', title: 'OSのアクセントカラー' },
    { value: _themeUiCustomValue(customColor), label: '指定カラー', swatch: customColor, title: 'カラーパレットから指定', custom: true },
  ];
  if (osAccent) return items;
  items.push({ group: true, label: 'テーマカラー' });
  colors.forEach((color, index) => {
    items.push({
      value: String(index),
      label: `テーマ${index + 1}`,
      swatch: `var(--theme-palette-${index}, ${color})`,
      title: color,
    });
  });
  return items;
}

function _themeUiOptionForValue(value) {
  const current = String(value || 'none');
  const items = _themeUiOptionItems(current);
  const osAccent = typeof MeldexThemeManager !== 'undefined' && typeof MeldexThemeManager.getUseOsAccentColor === 'function'
    ? MeldexThemeManager.getUseOsAccentColor()
    : false;
  if (osAccent && /^\d+$/.test(current)) return items.find(item => !item.group && item.value === 'os-accent') || items.find(item => !item.group);
  return items.find(item => !item.group && item.value === current) || items.find(item => !item.group);
}

function _themeUiSwatchHtml(item) {
  if (!item?.swatch) return '<span class="cs-theme-ui-option-swatch cs-theme-ui-option-swatch--none"></span>';
  return `<span class="cs-theme-ui-option-swatch" style="background:${esc(item.swatch)};"></span>`;
}

function _themeUiPickerContent(value) {
  const item = _themeUiOptionForValue(value);
  return `<span class="cs-theme-ui-picker-main">${_themeUiSwatchHtml(item)}<span class="cs-theme-ui-picker-label">${esc(item.label)}</span></span><span class="cs-theme-ui-picker-arrow">▼</span>`;
}

function _themeUiE2eId(...parts) {
  return parts
    .map(part => String(part == null ? '' : part).trim().replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, ''))
    .filter(Boolean)
    .join('-');
}

function _renderThemeUiPicker(target, state, prop, value) {
  const propLabel = target?.propLabels?.[prop.id] || prop.label;
  const stateLabel = target?.stateLabels?.[state.id] || state.label;
  const label = `${target.label} ${stateLabel} ${propLabel}`;
  const baseId = _themeUiE2eId(target.id, state.id, prop.id);
  const items = _themeUiOptionItems(value);
  const options = items.map(item => item.group
    ? `<div class="cs-theme-ui-option-group" role="presentation">${esc(item.label)}</div>`
    : `<button type="button" class="cs-theme-ui-option" role="option" data-e2e-id="${esc(_themeUiE2eId('theme-ui-option', baseId, item.value))}" data-theme-ui-option-value="${esc(item.value)}"${item.custom ? ' data-theme-ui-custom-color="1"' : ''} aria-selected="${String(item.value) === String(value)}" title="${esc(item.title || item.label)}">${_themeUiSwatchHtml(item)}<span>${esc(item.label)}</span></button>`
  ).join('');
  return `<div class="cs-theme-ui-picker-wrap">
    <select class="gb-select cs-theme-ui-select cs-theme-ui-native" data-e2e-id="${esc(_themeUiE2eId('theme-ui-native', baseId))}" data-theme-ui-setting="${esc(target.id)}|${esc(state.id)}|${esc(prop.id)}" aria-label="${esc(label)}" tabindex="-1">${_themeUiSelectOptions(value)}</select>
    <button type="button" class="cs-theme-ui-picker" data-e2e-id="${esc(_themeUiE2eId('theme-ui-picker', baseId))}" data-theme-ui-picker aria-haspopup="listbox" aria-expanded="false" title="${esc(label)}">${_themeUiPickerContent(value)}</button>
    <div class="cs-theme-ui-picker-menu" data-theme-ui-menu role="listbox" hidden>${options}</div>
  </div>`;
}

function renderThemeUiAutoToneControls() {
  const tone = _themeUiAutoTone();
  const control = (kind, label, value) => `<label class="cs-theme-ui-tone-control">
    <span>${label}</span>
    <input type="range" min="0" max="100" step="1" value="${value}" data-e2e-id="theme-ui-auto-tone-${kind}" data-theme-ui-auto-tone="${kind}">
    <input type="number" min="0" max="100" step="1" value="${value}" class="gb-input-sm cs-theme-ui-tone-number" data-e2e-id="theme-ui-auto-tone-input-${kind}" data-theme-ui-auto-tone-input="${kind}">
    <span class="cs-theme-ui-tone-value" data-theme-ui-auto-tone-value="${kind}">${value}%</span>
  </label>`;
  return `<div class="cs-theme-ui-tone-controls">
    ${control('light', '自動（明）', tone.light)}
    ${control('dark', '自動（暗）', tone.dark)}
  </div>`;
}

function _themeUiTargetHasPropForState(target, stateId, propId) {
  if (!target?.vars) return !Array.isArray(target?.props) || target.props.includes(propId);
  return Object.prototype.hasOwnProperty.call(target.vars?.[stateId] || {}, propId);
}

function _themeUiPropsForRenderTarget(target, props) {
  const baseIds = Array.isArray(target?.props) ? target.props : props.map(prop => prop.id);
  if (!target?.vars) return props.filter(prop => baseIds.includes(prop.id));
  const ids = new Set();
  Object.values(target.vars || {}).forEach(vars => {
    Object.keys(vars || {}).forEach(id => { if (baseIds.includes(id)) ids.add(id); });
  });
  return props.filter(prop => ids.has(prop.id));
}

function renderThemeUiApplicationEditor(options = {}) {
  if (typeof MeldexThemeManager === 'undefined') return '';
  const targetIds = Array.isArray(options.targetIds) ? new Set(options.targetIds) : null;
  const targetGroup = options.group || '';
  const targets = (MeldexThemeManager.THEME_UI_TARGETS || []).filter(target => {
    if (targetIds) return targetIds.has(target.id);
    if (targetGroup) return target.group === targetGroup;
    return true;
  });
  const states = MeldexThemeManager.THEME_UI_STATES || [];
  const props = MeldexThemeManager.THEME_UI_PROPS || [];
  const cfg = typeof MeldexThemeManager.getThemeUiApplications === 'function'
    ? MeldexThemeManager.getThemeUiApplications()
    : {};
  const groups = targets.map(target => {
    const targetProps = _themeUiPropsForRenderTarget(target, props);
    const targetStates = Array.isArray(target.states) ? states.filter(state => target.states.includes(state.id)) : states;
    const rowStyle = `--theme-ui-prop-count:${targetProps.length};`;
    const header = `<div class="cs-theme-ui-row cs-theme-ui-row--header" style="${esc(rowStyle)}">
      <span class="cs-theme-ui-state"></span>
      ${targetProps.map(prop => `<span class="cs-theme-ui-column-label">${esc(target.propLabels?.[prop.id] || prop.label)}</span>`).join('')}
    </div>`;
    const rows = targetStates.map(state => {
      const selects = targetProps.map(prop => {
        if (!_themeUiTargetHasPropForState(target, state.id, prop.id)) return '<span class="cs-theme-ui-empty"></span>';
        const value = cfg?.[target.id]?.[state.id]?.[prop.id] || 'none';
        return _renderThemeUiPicker(target, state, prop, value);
      }).join('');
      return `<div class="cs-theme-ui-row" style="${esc(rowStyle)}"><span class="cs-theme-ui-state">${esc(target.stateLabels?.[state.id] || state.label)}</span>${selects}</div>`;
    }).join('');
    return `<details class="cs-theme-ui-target"><summary>${esc(target.label)}</summary>${header}${rows}</details>`;
  }).join('');
  const label = options.hideLabel ? '' : '<span class="cs-row-label">テーマカラーの自動適用設定</span>';
  const targetIdAttr = targets.map(target => target.id).join(',');
  const resetScope = targetGroup ? `group-${targetGroup}` : (targetIdAttr || 'all');
  const reset = options.showReset === false ? '' : `<button type="button" class="cs-toggle" data-e2e-id="${esc(_themeUiE2eId('theme-ui-reset', resetScope))}" data-theme-ui-reset>適用設定を既定に戻す</button>`;
  return `<div class="cs-row cs-theme-ui-editor">
    ${label}
    <div class="cs-theme-ui-grid" data-theme-ui-target-ids="${esc(targetIdAttr)}" style="${esc(_themeUiAutoToneVars(_themeUiAutoTone()))}">
      ${groups}
      ${reset}
    </div>
  </div>`;
}

function syncThemeColorSetSwatches(root, colors) {
  const palette = Array.isArray(colors) ? colors : getCurrentThemeColorSet();
  const osAccentColor = typeof MeldexThemeManager !== 'undefined' && typeof MeldexThemeManager.getOsAccentColor === 'function'
    ? MeldexThemeManager.getOsAccentColor()
    : 'var(--theme-os-accent, AccentColor)';
  (root || document).querySelectorAll('[data-theme-os-accent-swatch]').forEach(btn => {
    btn.style.background = osAccentColor || 'transparent';
    btn.title = osAccentColor ? `OSアクセント: ${osAccentColor}` : 'OSアクセント: 取得待ち';
  });
  (root || document).querySelectorAll('[data-theme-color-slot]').forEach(btn => {
    const index = parseInt(btn.dataset.themeColorSlot, 10);
    const color = palette[index] || palette[0] || '#ef4444';
    btn.style.background = color;
    btn.title = `テーマカラー ${index + 1}: ${color}`;
  });
}

function syncThemeOsAccentToggle(root) {
  const enabled = typeof MeldexThemeManager !== 'undefined' && typeof MeldexThemeManager.getUseOsAccentColor === 'function'
    ? MeldexThemeManager.getUseOsAccentColor()
    : false;
  (root || document).querySelectorAll('[data-theme-os-accent-toggle]').forEach(btn => {
    btn.classList.toggle('active', enabled);
    btn.setAttribute('aria-pressed', enabled ? 'true' : 'false');
  });
}

function _settingsThemePaletteMatrixRender(root) {
  const container = root?.querySelector?.('[data-theme-palette-matrix]');
  if (!container) return;
  container.innerHTML = '';
  const adjust = typeof getStandardPaletteAdjust === 'function' ? getStandardPaletteAdjust() : null;
  const swatches = typeof getStandardPaletteSwatches === 'function' ? getStandardPaletteSwatches(adjust) : [];
  const themeColors = computeThemeColorSetFromSlots(adjust);
  const slotSettings = getThemeColorSlotSettings();
  const extraSlots = getThemeColorExtraSlotSettings();
  const rowDefs = [
    { row: 1, label: '' },
    { row: 2, label: '自動（明）' },
    { row: 3, label: 'テーマカラー' },
    { row: 4, label: '自動（暗）' },
  ];
  rowDefs.forEach(def => {
    const items = def.row === 3
      ? themeColors.map((color, index) => ({ color, title: color, row: 3, index, themeSlot: true }))
      : swatches.filter(s => s.row === def.row);
    if (def.row !== 1 && !items.length) return;
    const rowEl = document.createElement('div');
    rowEl.className = 'cs-theme-palette-row';
    const labelEl = document.createElement('span');
    labelEl.className = 'cs-theme-palette-row-label';
    labelEl.textContent = def.label;
    rowEl.appendChild(labelEl);
    const swatchesEl = document.createElement('div');
    swatchesEl.className = 'cs-theme-palette-row-swatches';
    if (def.row === 1) {
      const transBtn = document.createElement('button');
      transBtn.type = 'button';
      transBtn.className = 'cs-theme-palette-swatch is-transparent';
      transBtn.dataset.color = 'transparent';
      transBtn.dataset.e2eId = 'settings-theme-palette-row-1-col-0';
      transBtn.dataset.paletteRow = '1';
      transBtn.dataset.paletteCol = '0';
      transBtn.title = '透明';
      swatchesEl.appendChild(transBtn);
    }
    items.forEach((info) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'cs-theme-palette-swatch';
      btn.dataset.paletteRow = String(def.row);
      if (info.themeSlot) {
        // 行3: 既存のテーマカラースロット (0-7)
        const slot = slotSettings[info.index];
        btn.dataset.themePaletteSlot = String(info.index);
        btn.dataset.paletteCol = String(info.index);
        btn.dataset.e2eId = `settings-theme-palette-row-3-slot-${info.index}`;
        btn.dataset.color = info.color;
        btn.classList.toggle('is-custom', !!slot);
        btn.classList.toggle('is-adjust-disabled', !!slot && slot.applyAdjust === false);
        btn.title = `テーマカラー ${info.index + 1}: ${info.color}${slot ? (slot.applyAdjust === false ? ' / 色調整なし' : ' / 色調整あり') : ''}`;
        btn.style.background = info.color;
      } else {
        // 行1・2・4: 拡張スロット (色上書きのみ)
        // getStandardPaletteSwatches で行1/2/4 は info.index を持つ (行1 は col=1..7, 行2/4 は 0..7)
        const actualCol = Number.isInteger(info.index) ? info.index : 0;
        const override = _getExtraSlotOverride(def.row, actualCol);
        const displayColor = override || info.color;
        btn.dataset.paletteCol = String(actualCol);
        btn.dataset.themePaletteExtraSlot = `${def.row}-${actualCol}`;
        btn.dataset.e2eId = `settings-theme-palette-row-${def.row}-col-${actualCol}`;
        btn.dataset.color = displayColor;
        btn.classList.toggle('is-custom', !!override);
        btn.title = `${info.title || info.color}${override ? ` / カスタム: ${override}` : ''}`;
        btn.style.background = displayColor;
      }
      swatchesEl.appendChild(btn);
    });
    rowEl.appendChild(swatchesEl);
    container.appendChild(rowEl);
  });
}

function _settingsThemePaletteSyncSliders(root) {
  if (!root) return;
  const adjust = typeof getStandardPaletteAdjust === 'function' ? getStandardPaletteAdjust() : {};
  ['hueStart', 'hueEnd', 'saturation', 'brightness', 'contrast'].forEach(key => {
    const value = adjust[key];
    const slider = root.querySelector(`[data-theme-palette-slider="${key}"]`);
    const num = root.querySelector(`[data-theme-palette-slider-num="${key}"]`);
    if (slider) slider.value = String(value);
    if (num) num.value = String(value);
  });
  if (globalThis.GBUI && typeof globalThis.GBUI.refreshRangeFills === 'function') {
    globalThis.GBUI.refreshRangeFills(root);
  }
}

function _syncThemeColorSetFromPalette() {
  if (typeof getStandardPaletteAdjust !== 'function' || typeof getStandardPaletteSwatches !== 'function') return;
  if (typeof MeldexThemeManager === 'undefined' || typeof MeldexThemeManager.setThemeColorSet !== 'function') return;
  const adjust = getStandardPaletteAdjust();
  const next = computeThemeColorSetFromSlots(adjust);
  try { MeldexThemeManager.setThemeColorSet(next, { save: true, skipHistory: true }); } catch {}
  // 明暗比はテーマカラーの自動（明）/（暗）トーンにも反映する
  if (typeof MeldexThemeManager.setThemeUiAutoTone === 'function') {
    try {
      MeldexThemeManager.setThemeUiAutoTone('light', adjust.contrast, { skipHistory: true });
      MeldexThemeManager.setThemeUiAutoTone('dark', adjust.contrast, { skipHistory: true });
    } catch {}
  }
  const themeEditor = typeof document !== 'undefined' ? document.getElementById('settings-theme-editor') : null;
  if (themeEditor && typeof refreshSettingsThemeStylePreviews === 'function') {
    refreshSettingsThemeStylePreviews(themeEditor);
  }
  return next;
}

let _settingsThemeColorSlotPopup = null;
let _settingsThemeColorSlotOutsideHandler = null;

function closeSettingsThemeColorSlotPopup() {
  if (_settingsThemeColorSlotPopup) {
    _settingsThemeColorSlotPopup.remove();
    _settingsThemeColorSlotPopup = null;
  }
  if (_settingsThemeColorSlotOutsideHandler) {
    document.removeEventListener('pointerdown', _settingsThemeColorSlotOutsideHandler, true);
    _settingsThemeColorSlotOutsideHandler = null;
  }
}

function _settingsThemePositionColorSlotPopup(popup, anchor) {
  if (typeof positionPopup === 'function') {
    positionPopup(popup, anchor.getBoundingClientRect());
    return;
  }
  const rect = anchor.getBoundingClientRect();
  const z = (typeof _getZoom === 'function') ? _getZoom() : 1;
  popup.style.left = `${rect.left / z}px`;
  popup.style.top = `${(rect.bottom / z) + 4}px`;
}

function _settingsThemeSlotSlider(labelText, min, max, value, onChange) {
  const row = document.createElement('div');
  row.className = 'gb-palette-slider-row';
  const label = document.createElement('label');
  label.textContent = labelText;
  const slider = document.createElement('input');
  slider.type = 'range';
  slider.min = String(min);
  slider.max = String(max);
  slider.value = String(value);
  const number = document.createElement('input');
  number.type = 'number';
  number.className = 'gb-slider-val';
  number.min = String(min);
  number.max = String(max);
  number.value = String(value);
  const apply = (raw, notify = true) => {
    const next = Math.max(min, Math.min(max, parseInt(raw, 10) || 0));
    slider.value = String(next);
    number.value = String(next);
    globalThis.GBUI?.refreshRangeFill?.(slider);
    if (notify) onChange(next);
  };
  slider.addEventListener('input', () => apply(slider.value));
  number.addEventListener('change', () => apply(number.value));
  row.append(label, slider, number);
  return { row, slider, number, apply };
}

function openSettingsThemeColorSlotPopup(anchor, index, root) {
  if (!anchor || !Number.isInteger(index) || index < 0) return;
  if (typeof closeColorPalette === 'function') closeColorPalette();
  closeSettingsThemeColorSlotPopup();
  const panelRoot = root || anchor.closest?.('#settings-theme-palette-editor') || document;
  const slots = getThemeColorSlotSettings();
  const palette = computeThemeColorSetFromSlots();
  const slot = slots[index];
  let applyAdjust = slot ? slot.applyAdjust !== false : true;
  let hsb = typeof _hexToHsb === 'function'
    ? _hexToHsb(slot?.color || palette[index] || '#ef4444')
    : { h: 0, s: 50, b: 90 };

  const popup = document.createElement('div');
  popup.className = 'gb-palette gb-palette-popup cs-theme-color-slot-popup';

  const title = document.createElement('div');
  title.className = 'gb-palette-section-heading';
  title.textContent = `テーマカラー ${index + 1}`;
  popup.appendChild(title);

  const pickerRow = document.createElement('div');
  pickerRow.className = 'gb-palette-picker-row';
  const picker = document.createElement('input');
  picker.type = 'color';
  picker.title = '色を選択';
  const preview = document.createElement('span');
  preview.className = 'cs-theme-color-slot-preview';
  pickerRow.append(picker, preview);
  popup.appendChild(pickerRow);

  const sliderSection = document.createElement('div');
  sliderSection.className = 'gb-palette-sliders';
  const currentSlotColor = () => typeof _hsbToHex === 'function' ? _hsbToHex(hsb.h, hsb.s, hsb.b) : (picker.value || '#ef4444');
  const currentEffectiveSlotColor = () => {
    const color = currentSlotColor();
    const adjust = typeof getStandardPaletteAdjust === 'function' ? getStandardPaletteAdjust() : null;
    return applyAdjust && typeof adjustStandardPaletteColor === 'function'
      ? adjustStandardPaletteColor(color, adjust)
      : color;
  };
  const refreshSlotPreview = () => {
    const color = currentSlotColor();
    const effective = currentEffectiveSlotColor();
    picker.value = color;
    preview.style.background = effective;
    preview.title = applyAdjust ? `${color} → ${effective}` : color;
  };
  const writeSlot = () => {
    const color = currentSlotColor();
    const nextSlots = getThemeColorSlotSettings();
    nextSlots[index] = { color, applyAdjust };
    saveThemeColorSlotSettings(nextSlots);
    const nextPalette = _syncThemeColorSetFromPalette() || computeThemeColorSetFromSlots();
    _settingsThemePaletteMatrixRender(panelRoot);
    syncThemeColorSetSwatches(panelRoot, nextPalette);
    if (typeof _settingsThemeMarkDirty === 'function') _settingsThemeMarkDirty();
    refreshSlotPreview();
  };
  const onSlider = () => writeSlot();
  const hSlider = _settingsThemeSlotSlider('色相', 0, 360, hsb.h, value => { hsb.h = value; onSlider(); });
  const sSlider = _settingsThemeSlotSlider('彩度', 0, 100, hsb.s, value => { hsb.s = value; onSlider(); });
  const bSlider = _settingsThemeSlotSlider('明度', 0, 100, hsb.b, value => { hsb.b = value; onSlider(); });
  sliderSection.append(hSlider.row, sSlider.row, bSlider.row);
  popup.appendChild(sliderSection);

  const optionRow = document.createElement('div');
  optionRow.className = 'cs-theme-color-slot-options';
  const applyLabel = document.createElement('label');
  const applyInput = document.createElement('input');
  applyInput.type = 'checkbox';
  applyInput.checked = applyAdjust;
  applyLabel.append(applyInput, document.createTextNode(' 色調整を反映'));
  applyInput.addEventListener('change', () => {
    applyAdjust = applyInput.checked;
    writeSlot();
  });
  const resetBtn = document.createElement('button');
  resetBtn.type = 'button';
  resetBtn.className = 'gb-btn-close';
  resetBtn.textContent = '自動に戻す';
  resetBtn.addEventListener('click', () => {
    const nextSlots = getThemeColorSlotSettings();
    nextSlots[index] = null;
    saveThemeColorSlotSettings(nextSlots);
    const nextPalette = _syncThemeColorSetFromPalette() || computeThemeColorSetFromSlots();
    _settingsThemePaletteMatrixRender(panelRoot);
    syncThemeColorSetSwatches(panelRoot, nextPalette);
    if (typeof _settingsThemeMarkDirty === 'function') _settingsThemeMarkDirty();
    closeSettingsThemeColorSlotPopup();
  });
  optionRow.append(applyLabel, resetBtn);
  popup.appendChild(optionRow);

  if (typeof attachMeldexDropdownCloseButton === 'function') {
    attachMeldexDropdownCloseButton(popup, {
      trigger: anchor,
      close: closeSettingsThemeColorSlotPopup,
      rowClassName: 'gb-palette-close-row',
      className: 'gb-btn-close meldex-dropdown-close-btn',
    });
  } else {
    const closeRow = document.createElement('div');
    closeRow.className = 'gb-palette-close-row';
    const closeBtn = document.createElement('button');
    closeBtn.className = 'gb-btn-close';
    closeBtn.type = 'button';
    closeBtn.textContent = '閉じる';
    closeBtn.addEventListener('click', closeSettingsThemeColorSlotPopup);
    closeRow.appendChild(closeBtn);
    popup.appendChild(closeRow);
  }

  const syncControls = () => {
    hSlider.apply(hsb.h, false);
    sSlider.apply(hsb.s, false);
    bSlider.apply(hsb.b, false);
    refreshSlotPreview();
  };
  picker.addEventListener('input', () => {
    if (typeof _hexToHsb === 'function') hsb = _hexToHsb(picker.value);
    syncControls();
    writeSlot();
  });

  document.body.appendChild(popup);
  _settingsThemeColorSlotPopup = popup;
  syncControls();
  _settingsThemePositionColorSlotPopup(popup, anchor);
  _settingsThemeColorSlotOutsideHandler = ev => {
    if (_settingsThemeColorSlotPopup && !_settingsThemeColorSlotPopup.contains(ev.target) && ev.target !== anchor) {
      closeSettingsThemeColorSlotPopup();
    }
  };
  setTimeout(() => document.addEventListener('pointerdown', _settingsThemeColorSlotOutsideHandler, true), 0);
}

