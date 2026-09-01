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
const THEME_STYLE_LEFT_ACCENT_WIDTH = '2px';
const THEME_STYLE_UNDERLINE_WIDTH = '2px';
const SETTINGS_THEME_COMMON_BODY_BG_KEY = '--content-bg';
const SETTINGS_THEME_COMMON_BODY_BG_LINKED_KEYS = Object.freeze([
  '--page-text-bg',
  '--sn2-page-bg',
  '--db-row-bg',
  '--db-entity-bg',
  '--bd-bg',
]);
const COMMON_THEME_SURFACE_STYLE_KEYS = new Set(['--page-text-bg', '--sn2-page-bg', '--db-row-bg', '--fv-panel-bg', '--cal-content-bg', '--preview-bg', '--detail-bg', '--chat-bg', '--history-bg', '--annotation-bg', '--search-bg', '--version-bg']);
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
    { label: 'ボタン', fg:'--ui-button-fg', bg:'--ui-button-bg', line:'--ui-button-border', width:'--ui-button-border-width', leftAccent:'--ui-button-left-accent', underline:'--ui-button-underline', accent:'--ui-button-accent-color', bold:'--ui-button-font-weight', italic:'--ui-button-font-style', fontSize:'--ui-button-font-size', font:'--ui-button-font', lineHeight:'--ui-button-line-height', text:'ボタン' },
    { label: 'ボタンホバー', fg:'--ui-button-hover-fg', bg:'--ui-button-hover-bg', line:'--ui-button-hover-border', width:'--ui-button-hover-border-width', leftAccent:'--ui-button-hover-left-accent', underline:'--ui-button-hover-underline', accent:'--ui-button-hover-accent-color', bold:'--ui-button-hover-font-weight', italic:'--ui-button-hover-font-style', fontSize:'--ui-button-hover-font-size', font:'--ui-button-hover-font', lineHeight:'--ui-button-hover-line-height', text:'ホバー' },
    { label: 'ボタン選択', fg:'--ui-button-active-fg', bg:'--ui-button-active-bg', line:'--ui-button-active-border', width:'--ui-button-active-border-width', leftAccent:'--ui-button-active-left-accent', underline:'--ui-button-active-underline', accent:'--ui-button-active-accent-color', bold:'--ui-button-active-font-weight', italic:'--ui-button-active-font-style', fontSize:'--ui-button-active-font-size', font:'--ui-button-active-font', lineHeight:'--ui-button-active-line-height', text:'選択' },
    { label: '通常文字', fg:'--fg', bg:'--ui-text-bg', bold:'--ui-text-bold', italic:'--ui-text-italic', fontSize:'--ui-text-font-size', text:'通常テキスト', font:'--ui-font' },
    { label: 'サブテキスト', fg:'--fg2', bold:'--ui-muted-bold', italic:'--ui-muted-italic', fontSize:'--ui-muted-font-size', text:'サブテキスト', font:'--ui-muted-font' },
    { label: 'ヘッダー', fg:'--ui-header-fg', bg:'--ui-header-bg', text:'ヘッダー', font:'--ui-header-font' },
    { label: 'ツールバー', fg:'--ui-toolbar-fg', bg:'--ui-toolbar-bg', text:'ツールバー', font:'--ui-toolbar-font' },
    { label: 'ホバー', fg:'--ui-hover-fg', bg:'--ui-hover-bg', text:'ホバー' },
    { label: 'パネル内タブバー', bg:'--ui-inner-tabbar-bg', line:'--ui-inner-tabbar-border', width:'--ui-inner-tabbar-border-width', text:'タブバー' },
    { label: 'パネル内タブ 通常', fg:'--ui-inner-tab-fg', bg:'--ui-inner-tab-bg', line:'--ui-inner-tab-border', width:'--ui-inner-tab-border-width', leftAccent:'--ui-inner-tab-left-accent', underline:'--ui-inner-tab-underline', accent:'--ui-inner-tab-accent-color', bold:'--ui-inner-tab-font-weight', italic:'--ui-inner-tab-font-style', fontSize:'--ui-inner-tab-font-size', text:'タブ', font:'--ui-inner-tab-font', lineHeight:'--ui-inner-tab-line-height' },
    { label: 'パネル内タブ ホバー', fg:'--ui-inner-tab-hover-fg', bg:'--ui-inner-tab-hover-bg', line:'--ui-inner-tab-hover-border', width:'--ui-inner-tab-hover-border-width', leftAccent:'--ui-inner-tab-hover-left-accent', underline:'--ui-inner-tab-hover-underline', accent:'--ui-inner-tab-hover-accent-color', bold:'--ui-inner-tab-hover-font-weight', italic:'--ui-inner-tab-hover-font-style', fontSize:'--ui-inner-tab-hover-font-size', font:'--ui-inner-tab-hover-font', lineHeight:'--ui-inner-tab-hover-line-height', text:'ホバー' },
    { label: 'パネル内タブ 選択', fg:'--ui-inner-tab-active-fg', bg:'--ui-inner-tab-active-bg', line:'--ui-inner-tab-active-border', width:'--ui-inner-tab-active-border-width', leftAccent:'--ui-inner-tab-active-left-accent', underline:'--ui-inner-tab-active-underline-width', accent:'--ui-inner-tab-active-underline', bold:'--ui-inner-tab-active-font-weight', italic:'--ui-inner-tab-active-font-style', fontSize:'--ui-inner-tab-active-font-size', font:'--ui-inner-tab-active-font', lineHeight:'--ui-inner-tab-active-line-height', text:'選択中' },
    { label: 'パネル内タブ 選択背景濃度', numbers:[{ label:'濃度', key:'--ui-inner-tab-active-bg-alpha', min:0, max:100, step:1, unit:'%', slider:true, fallback:14 }], text:'14%' },
    { label: 'パネル内タブ サイズ', numbers:[{ label:'高さ', key:'--ui-inner-tab-height', min:18, max:56, step:1, unit:'px', fallback:28 }, { label:'左右余白', key:'--ui-inner-tab-padding-x', min:0, max:40, step:1, unit:'px', fallback:12 }], text:'タブ' },
    { label: '強調文字', fg:'--ui-accent-fg', previewBg:'--ui-accent', text:'強調文字' },
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
    { label: '見出し H1', fg:'--page-h1-fg', bold:'--page-h1-bold', italic:'--page-h1-italic', bg:'--page-h1-bg', text:'見出し1', font:'--page-h1-font', lineHeight:'--page-h1-line-height', popupNumbers:[{ label:'見出し前', key:'--page-h1-space-before', min:0, max:96, step:1, unit:'px', fallback:16 }, { label:'本文まで', key:'--page-h1-space-after', min:0, max:64, step:1, unit:'px', fallback:6 }] },
    { label: '見出し H2', fg:'--page-h2-fg', bold:'--page-h2-bold', italic:'--page-h2-italic', bg:'--page-h2-bg', text:'見出し2', font:'--page-h2-font', lineHeight:'--page-h2-line-height', popupNumbers:[{ label:'見出し前', key:'--page-h2-space-before', min:0, max:96, step:1, unit:'px', fallback:14 }, { label:'本文まで', key:'--page-h2-space-after', min:0, max:64, step:1, unit:'px', fallback:4 }] },
    { label: '見出し H3', fg:'--page-h3-fg', bold:'--page-h3-bold', italic:'--page-h3-italic', bg:'--page-h3-bg', text:'見出し3', font:'--page-h3-font', lineHeight:'--page-h3-line-height', popupNumbers:[{ label:'見出し前', key:'--page-h3-space-before', min:0, max:96, step:1, unit:'px', fallback:12 }, { label:'本文まで', key:'--page-h3-space-after', min:0, max:64, step:1, unit:'px', fallback:4 }] },
    { label: '見出し H4', fg:'--page-h4-fg', bold:'--page-h4-bold', italic:'--page-h4-italic', bg:'--page-h4-bg', text:'見出し4', font:'--page-h4-font', lineHeight:'--page-h4-line-height', popupNumbers:[{ label:'見出し前', key:'--page-h4-space-before', min:0, max:96, step:1, unit:'px', fallback:10 }, { label:'本文まで', key:'--page-h4-space-after', min:0, max:64, step:1, unit:'px', fallback:3 }] },
    { label: '見出し H5', fg:'--page-h5-fg', bold:'--page-h5-bold', italic:'--page-h5-italic', bg:'--page-h5-bg', text:'見出し5', font:'--page-h5-font', lineHeight:'--page-h5-line-height', popupNumbers:[{ label:'見出し前', key:'--page-h5-space-before', min:0, max:96, step:1, unit:'px', fallback:8 }, { label:'本文まで', key:'--page-h5-space-after', min:0, max:64, step:1, unit:'px', fallback:3 }] },
    { label: '見出し H6', fg:'--page-h6-fg', bold:'--page-h6-bold', italic:'--page-h6-italic', bg:'--page-h6-bg', text:'見出し6', font:'--page-h6-font', lineHeight:'--page-h6-line-height', popupNumbers:[{ label:'見出し前', key:'--page-h6-space-before', min:0, max:96, step:1, unit:'px', fallback:6 }, { label:'本文まで', key:'--page-h6-space-after', min:0, max:64, step:1, unit:'px', fallback:2 }] },
    { label: '本文', fg:'--page-text-fg', bold:'--page-text-bold', italic:'--page-text-italic', text:'本文テキスト', font:'--page-text-font', lineHeight:'--page-text-line-height' },
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
    { label: 'ルビ', type: 'rubyPresentationDefaults', text: 'ルビ' },
  ],
  'シート': [
    { label: 'ヘッダー', fg:'--db-th-fg', bold:'--db-th-bold', italic:'--db-th-italic', bg:'--db-th-bg', text:'列名', font:'--db-th-font' },
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
    { label: 'リンク種別', fg:'--bd-link-type-icon-color', text:'▣' },
    { label: 'カーソル', fg:'--bd-caret-color', width:'--bd-caret-width', text:'┃' },
    { label: 'カード隙間', numbers:[
      { label:'同階層', key:'--bd-gap-siblings', min:0, max:400, step:1, unit:'px', fallback:10 },
      { label:'階層間',  key:'--bd-gap-levels',  min:0, max:600, step:1, unit:'px', fallback:50 },
    ], text:'隙間' },
  ],
  'スケジュール': [
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
  ],
  'フォルダツリー': [
    { label: 'パネル', fg:'--outliner-fg', bg:'--outliner-bg', line:'--outliner-border', text:'フォルダツリー' },
    { label: '見出し', fg:'--outliner-section-fg', bg:'--outliner-section-bg', lineHeight:'--outliner-section-line-height', text:'見出し' },
    { label: '項目', fg:'--outliner-item-fg', bg:'--outliner-item-bg', lineHeight:'--outliner-item-line-height', text:'項目' },
    { label: '項目ホバー', fg:'--outliner-item-hover-fg', bg:'--outliner-item-hover-bg', line:'--outliner-item-hover-outline-color', width:'--outliner-item-hover-outline-width', lineStyle:'--outliner-item-hover-outline-style', lineHeight:'--outliner-item-hover-line-height', text:'ホバー' },
    { label: '項目選択', fg:'--outliner-item-selected-fg', bg:'--outliner-item-selected-bg', line:'--outliner-item-selected-outline-color', width:'--outliner-item-selected-outline-width', lineStyle:'--outliner-item-selected-outline-style', lineHeight:'--outliner-item-selected-line-height', text:'選択中' },
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
  'ヒストリー': [
    { label: 'パネル', fg:'--history-fg', line:'--history-border', text:'ヒストリー' },
    { label: '行背景', bg:'--history-row-bg', text:'履歴行' },
    { label: '補助表示', fg:'--history-muted-fg', text:'時刻' },
    { label: 'ホバー', bg:'--history-hover-bg', text:'ホバー' },
    { label: '強調', fg:'--history-active-fg', bg:'--history-active-bg', line:'--history-accent', text:'強調' },
  ],
  'アノテート': [
    { label: 'パネル', fg:'--annotation-fg', line:'--annotation-border', text:'アノテート' },
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
    { label: 'フォルダツリー項目', fg:'--outliner-item-fg', bg:'--outliner-item-bg', lineHeight:'--outliner-item-line-height', text:'項目' },
    { label: 'ビューワー', fg:'--preview-fg', line:'--preview-border', text:'ビューワー' },
    { label: 'ビューワーカード', bg:'--preview-card-bg', text:'カード' },
    { label: 'オプション', fg:'--detail-fg', line:'--detail-border', text:'オプション' },
    { label: 'チャット本文', fg:'--chat-fg', line:'--chat-border', text:'チャット' },
    { label: 'チャット入力', fg:'--chat-input-fg', bg:'--chat-input-bg', text:'入力欄' },
    { label: 'ヒストリー', fg:'--history-fg', line:'--history-border', text:'ヒストリー' },
    { label: 'アノテート', fg:'--annotation-fg', line:'--annotation-border', text:'アノテート' },
    { label: '検索', fg:'--search-fg', line:'--search-border', text:'検索' },
    { label: 'バージョン管理', fg:'--version-fg', line:'--version-border', text:'バージョン管理' },
    { label: '補助パネルアクセント', line:'--preview-accent', text:'━━' },
  ],
};

// 2026-08-12: 「バランス黒」パレット計画（2026-08-09/08-10）より前の builtin-dark 既定値。
// gb-theme-manager.part01.part02.js の同名テーブル（STALE_BUILTIN_PALETTE_CSS_VARS）と対になる
// 参照値で、意図的に複製している（両ファイルとも編集対象が限定されているため）。
// editor-theme（COLOR_SETTINGS_KEY）は saveColorSettings() 実行時点の全キーをまるごと保存する
// ため、ユーザーが1色も編集していなくても「当時のデフォルト値」がそのまま入り込み、
// loadColorSettings() が無条件に再適用してテーマ管理側の新しい既定値を覆い隠してしまう。
// ここに載っている値と完全一致するキーだけを「未編集」とみなして保存データから取り除き、
// 1色でも異なれば必ずユーザー編集として残す。
const STALE_BUILTIN_DARK_BACKGROUND_CSS_VARS = Object.freeze({
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
});

function _normalizeStaleColorCompareValue(value) {
  const raw = String(value == null ? '' : value).trim().toLowerCase();
  const short = raw.match(/^#([0-9a-f]{3})$/);
  if (short) return '#' + short[1].split('').map(ch => ch + ch).join('');
  return raw;
}

// editor-theme に保存された「背景系キー」が、当時のbuilt-inデフォルトをそのまま写しただけの
// 値かどうかを判定し、そうであればsettingsから取り除く（=テーマ管理側の解決結果を優先させる）。
// 現在の既定テーマが builtin-dark 系でない場合は対象外（別テーマの意図的な色を誤って消さない）。
function _pruneStaleBuiltinBackgroundColorSettings(settings) {
  if (!settings || typeof settings !== 'object') return false;
  let currentThemeId = '';
  try {
    // getThemeById() は引数なしで現在の既定テーマ（「OSに合わせる」の解決結果も含む）を返す。
    // 生の保存値（getDefaultThemeId()）だけを見ると「OSに合わせる」でダーク相当になっている
    // ケースを取りこぼすため、こちらを使う。
    currentThemeId = typeof MeldexThemeManager !== 'undefined' && typeof MeldexThemeManager.getThemeById === 'function'
      ? (MeldexThemeManager.getThemeById()?.id || '')
      : '';
  } catch {
    currentThemeId = '';
  }
  if (currentThemeId !== 'builtin-dark') return false;
  let pruned = false;
  Object.keys(STALE_BUILTIN_DARK_BACKGROUND_CSS_VARS).forEach(key => {
    if (!Object.prototype.hasOwnProperty.call(settings, key)) return;
    if (_normalizeStaleColorCompareValue(settings[key]) === STALE_BUILTIN_DARK_BACKGROUND_CSS_VARS[key]) {
      delete settings[key];
      pruned = true;
    }
  });
  return pruned;
}

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
    d.lineHeight,
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
      if(d.lineStyle) keys.add(d.lineStyle);
      if(d.fontSize) keys.add(d.fontSize);
      if(d.lineHeight) keys.add(d.lineHeight);
      if(Array.isArray(d.numbers)) d.numbers.forEach(n => { if(n?.key) keys.add(n.key); });
      if(Array.isArray(d.popupNumbers)) d.popupNumbers.forEach(n => { if(n?.key) keys.add(n.key); });
      _extraStyleKeys(d).forEach(k => keys.add(k));
    });
  }
  keys.add('--page-margin-x');
  keys.add('--page-content-max-width');
  [
    '--ui-pane-tab-line-height', '--ui-pane-tab-hover-line-height', '--ui-pane-tab-active-line-height',
    '--ui-dock-button-line-height', '--ui-dock-button-hover-line-height', '--ui-dock-button-active-line-height',
  ].forEach(key => keys.add(key));
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
      if (_pruneStaleBuiltinBackgroundColorSettings(s)) {
        try { localStorage.setItem(COLOR_SETTINGS_KEY, JSON.stringify(s)); } catch {}
      }
      for (const [k, v] of Object.entries(s)) {
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
  try {
    localStorage.setItem(COLOR_SETTINGS_KEY, JSON.stringify(s));
  } catch (err) {
    console.warn('テーマ設定の保存に失敗:', err);
    if (typeof showStatus === 'function') showStatus('テーマ設定を保存できませんでした', true);
    return false;
  }
  // テーマの明暗に応じてcolor-schemeを切替（スピナー等のブラウザUIに影響）
  updateColorScheme();
  return true;
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

const SETTINGS_THEME_PREVIEW_AUTO_VAR_TARGETS = Object.freeze({
  '--fv-item-fg': { targetId: 'folder-panel-folder', stateId: 'normal', index: 0 },
  '--fv-item-bg': { targetId: 'folder-panel-folder', stateId: 'normal', index: 0 },
  '--fv-item-border': { targetId: 'folder-panel-folder', stateId: 'normal', index: 0 },
  '--fv-item-hover-fg': { targetId: 'folder-panel-folder', stateId: 'hover', index: 0 },
  '--fv-item-hover-bg': { targetId: 'folder-panel-folder', stateId: 'hover', index: 0 },
  '--fv-item-hover-border': { targetId: 'folder-panel-folder', stateId: 'hover', index: 0 },
  '--fv-item-selected-fg': { targetId: 'folder-panel-folder', stateId: 'selected', index: 0 },
  '--fv-item-selected-bg': { targetId: 'folder-panel-folder', stateId: 'selected', index: 0 },
  '--fv-item-selected-border': { targetId: 'folder-panel-folder', stateId: 'selected', index: 0 },
  '--outliner-item-fg': { targetId: 'folder-tree-folder', stateId: 'normal', index: 0 },
  '--outliner-item-bg': { targetId: 'folder-tree-folder', stateId: 'normal', index: 0 },
  '--outliner-item-hover-fg': { targetId: 'folder-tree-folder', stateId: 'hover', index: 0 },
  '--outliner-item-hover-bg': { targetId: 'folder-tree-folder', stateId: 'hover', index: 0 },
  '--outliner-item-selected-fg': { targetId: 'folder-tree-folder', stateId: 'selected', index: 0 },
  '--outliner-item-selected-bg': { targetId: 'folder-tree-folder', stateId: 'selected', index: 0 },
  '--outliner-accent': { targetId: 'folder-tree-folder', stateId: 'selected', index: 0 },
});

function _settingsThemePreviewRowKeys(d) {
  return [d?.fg, d?.bg, d?.line]
    .map(key => String(key || '').trim())
    .filter(Boolean);
}

function _settingsThemePreviewAutoTargetFromKnownVars(keys) {
  for (const key of keys || []) {
    const hit = SETTINGS_THEME_PREVIEW_AUTO_VAR_TARGETS[key];
    if (hit) return { ...hit };
  }
  return null;
}

function _settingsThemePreviewAutoTargetFromThemeVars(keys) {
  if (!keys?.length || typeof MeldexThemeManager === 'undefined' || !Array.isArray(MeldexThemeManager.THEME_UI_TARGETS)) {
    return null;
  }
  const rowKeys = new Set(keys);
  for (const target of MeldexThemeManager.THEME_UI_TARGETS) {
    if (!target?.vars) continue;
    for (const stateId of ['normal', 'hover', 'selected']) {
      const vars = target.vars[stateId] || {};
      const stateKeys = Object.values(vars).flatMap(value => Array.isArray(value) ? value : [value]).filter(Boolean);
      if (stateKeys.some(key => rowKeys.has(key))) {
        return { targetId: target.id, stateId, index: 0 };
      }
    }
  }
  return null;
}

function _settingsThemePreviewAutoTargetForRow(d) {
  const label = String(d?.label || '').trim();
  const heading = label.match(/^見出し H([1-6])$/);
  if (heading) return { targetId: 'note-heading', stateId: 'normal', index: parseInt(heading[1], 10) - 1 };
  if (/目次/.test(label)) return { targetId: 'note-toc-item', stateId: 'normal', index: 0 };
  const keys = _settingsThemePreviewRowKeys(d);
  return _settingsThemePreviewAutoTargetFromKnownVars(keys)
    || _settingsThemePreviewAutoTargetFromThemeVars(keys);
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
  const stateId = target.stateId || 'normal';
  const state = MeldexThemeManager.getThemeUiApplications()?.[target.targetId]?.[stateId] || {};
  return {
    fg: _settingsThemePreviewAutoColor(state.fg, target.index),
    bg: _settingsThemePreviewAutoColor(state.bg, target.index),
    underline: _settingsThemePreviewAutoColor(state.underline, target.index),
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
    parts.push(`border-left:${THEME_STYLE_LEFT_ACCENT_WIDTH} solid var(--ui-accent, ${accent})`);
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

function _settingsThemeSwatchStyle(value, fallback) {
  const raw = String(value || fallback || 'transparent').trim() || 'transparent';
  return `background:${esc(raw)};`;
}

function _settingsThemeWidthControl(widthKey, label) {
  const curW = getCssVar(widthKey);
  const value = parseInt(curW, 10) || 1;
  return `<div class="cs-row-group">
    <span class="cs-row-group-label">${esc(label || '太さ')}</span>
    <input type="number" min="0" max="10" step="1" value="${esc(value)}" data-e2e-id="${esc(_settingsThemeE2eId('settings-theme-line-width', widthKey))}" data-key="${esc(widthKey)}" class="cs-width-input"
      data-onchange="document.documentElement.style.setProperty(this.dataset.key, this.value+'px');if(typeof _settingsThemeMarkDirty==='function')_settingsThemeMarkDirty()">px</div>`;
}

// 行レンダリング（全タブ共通）
function renderStyleRow(d) {
  if (d?.type === 'rubyPresentationDefaults' && typeof MeldexRubySettingsUI !== 'undefined') {
    return MeldexRubySettingsUI.globalSettingsHtml();
  }
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
      const controlLabel = n.label || d.label || n.key || '数値';
      const labelAttrs = `aria-label="${esc(controlLabel)}" title="${esc(controlLabel)}"`;
      const range = n.slider ? `<input type="range" class="cs-alpha cs-number-range" value="${esc(value)}" ${attrs} ${labelAttrs} data-e2e-id="${esc(controlId + '-range')}" data-oninput="setNumericStyleSetting(this)">` : '';
      return `<div class="cs-row-group cs-row-group--number">
        <span class="cs-row-group-label">${esc(n.label || '')}</span>
        ${range}
        <input type="number" class="cs-width-input cs-number-input" value="${esc(value)}" ${attrs} ${labelAttrs} data-e2e-id="${esc(controlId + '-input')}" data-oninput="setNumericStyleSetting(this)" data-onchange="setNumericStyleSetting(this)">
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
      <span class="cs-row-label">${esc(d.label)}</span>
      <div class="cs-swatch" style="${_settingsThemeSwatchStyle(swatchValue)}"
        data-e2e-id="${esc(_settingsThemeE2eId('settings-theme-swatch', d.bg))}" data-key="${esc(d.bg)}" data-action="openCsPalette(this,'${d.bg}')"></div>
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
    <span class="cs-row-label">${esc(d.label)}</span>
    <span class="${previewClass}"${previewAttrs} style="${esc(previewStyle)}">${esc(d.text || d.label || '')}</span>`;

  // 線色タイプ
  if (d.line) {
    const hex = lineVal.startsWith('#') ? lineVal : rgbToHex(lineVal);
    row += `<div class="cs-row-group">
      <span class="cs-row-group-label">線色</span>
      <div class="cs-swatch" style="${_settingsThemeSwatchStyle(hex)}"
        data-e2e-id="${esc(_settingsThemeE2eId('settings-theme-swatch', d.line))}" data-key="${esc(d.line)}" data-action="openCsPalette(this,'${d.line}')"></div>
    </div>`;
    if (d.toggle) {
      const isOn = getCssVar(d.toggle) !== d.toggleOff;
      row += `<button class="cs-toggle${isOn?' active':''}" data-e2e-id="${esc(_settingsThemeE2eId('settings-theme-toggle-line', d.toggle))}" data-key="${esc(d.toggle)}" data-on="${esc(d.toggleOn)}" data-off="${esc(d.toggleOff)}" data-action="toggleLineVisibility(this)">表示</button>`;
    }
    if (d.width) {
      row += _settingsThemeWidthControl(d.width, '太さ');
    }
  }

  // 文字色スウォッチ
  if (d.fg) {
    const hex = fgVal.startsWith('#') ? fgVal : rgbToHex(fgVal);
    row += `<div class="cs-row-group">
      <span class="cs-row-group-label">${esc(d.fgLabel || '文字')}</span>
      <div class="cs-swatch" style="${_settingsThemeSwatchStyle(hex)}"
        data-e2e-id="${esc(_settingsThemeE2eId('settings-theme-swatch', d.fg))}" data-key="${esc(d.fg)}" data-action="openCsPalette(this,'${d.fg}')"></div>
    </div>`;
  }

  // 太字トグル
  if (d.bold) {
    const isB = boldVal === 'bold';
    row += `<button class="cs-toggle cs-toggle-bold${isB?' active':''}" data-e2e-id="${esc(_settingsThemeE2eId('settings-theme-bold', d.bold))}" data-key="${esc(d.bold)}" data-val="bold" data-action="toggleCsStyle(this)">B</button>`;
  }

  // 斜体トグル
  if (d.italic) {
    const isI = italicVal === 'italic';
    row += `<button class="cs-toggle cs-toggle-italic${isI?' active':''}" data-e2e-id="${esc(_settingsThemeE2eId('settings-theme-italic', d.italic))}" data-key="${esc(d.italic)}" data-val="italic" data-action="toggleCsStyle(this)">I</button>`;
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

  if (d.width && !d.line) {
    row += _settingsThemeWidthControl(d.width, '太さ');
  }

  // 背景色スウォッチ
  if (d.bg) {
    if (d.bgType === 'rgba') {
      // スウォッチ + 不透明度スライダー（rgba/transparent対応）
      const { hex: bgHex, alpha: bgAlpha } = parseColorToHexAlpha(bgVal);
      const pct = Math.round(bgAlpha * 100);
      row += `<div class="cs-row-group">
        <span class="cs-row-group-label">背景</span>
        <div class="cs-swatch" style="${_settingsThemeSwatchStyle(bgVal)}"
          data-e2e-id="${esc(_settingsThemeE2eId('settings-theme-swatch', d.bg))}" data-key="${esc(d.bg)}" data-hex="${esc(bgHex)}" data-rgba="1" data-action="openCsPaletteRgba(this,'${d.bg}')"></div>
        <input type="range" min="0" max="100" value="${pct}" class="cs-alpha" data-e2e-id="${esc(_settingsThemeE2eId('settings-theme-alpha', d.bg))}" data-key="${d.bg}"
          data-oninput="this.nextElementSibling.textContent=this.value+'%';updateBgFromSwatchAlpha('${d.bg}')">
        <span class="cs-alpha-val">${pct}%</span>
      </div>`;
    } else {
      const hex = bgVal.startsWith('#') ? bgVal : rgbToHex(bgVal);
      row += `<div class="cs-row-group">
      <span class="cs-row-group-label">${esc(d.bgLabel || '背景')}</span>
      <div class="cs-swatch" style="${_settingsThemeSwatchStyle(hex)}"
          data-e2e-id="${esc(_settingsThemeE2eId('settings-theme-swatch', d.bg))}" data-key="${esc(d.bg)}" data-action="openCsPalette(this,'${d.bg}')"></div>
      </div>`;
    }
