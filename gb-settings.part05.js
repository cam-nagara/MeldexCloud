/* gb-settings.part05.js: appearance tab theme editor integration */

function _settingsThemeMenuButton() {
  const icon = typeof lucide === 'function' ? lucide('moreHorizontal', 16) : '…';
  return `<button type="button" class="bd-detail-style-action settings-theme-preset-menu-button" data-action="openSettingsThemeMenu(this)" data-e2e-id="settings-theme-preset-menu" title="テーマプリセットの操作" aria-label="テーマプリセットの操作" aria-haspopup="menu" aria-expanded="false">${icon}</button>`;
}

function openSettingsThemeMenu(anchor) {
  document.querySelectorAll('.settings-theme-preset-menu').forEach(menu => menu.remove());
  if (!anchor) return;
  const custom = _settingsThemeIsCustom();
  const menu = document.createElement('div');
  menu.className = 'gb-context-menu settings-theme-preset-menu';
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', 'テーマプリセットの操作');
  const actions = [
    ['plus', '追加', 'create', () => settingsThemeCreate(), false],
    ['copy', '複製', 'duplicate', () => settingsThemeDuplicate(), false],
    ['pencil', 'リネーム', 'rename', () => settingsThemeRename(), !custom],
    ['refreshCw', '更新', 'update', () => settingsThemeReset(), false],
    ['save', '保存', 'save', () => settingsThemeSave(), !custom],
    ['trash2', '削除', 'delete', () => settingsThemeDelete(), !custom],
  ];
  let dismiss = null;
  const close = () => {
    menu.remove();
    anchor.setAttribute('aria-expanded', 'false');
    if (dismiss) {
      document.removeEventListener('pointerdown', dismiss, true);
      document.removeEventListener('keydown', dismiss, true);
    }
  };
  actions.forEach(([iconName, label, action, run, disabled]) => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'gb-context-menu-item' + (action === 'delete' ? ' danger' : '');
    item.dataset.settingsThemeAction = action;
    item.dataset.e2eId = `settings-theme-preset-action-${action}`;
    item.setAttribute('role', 'menuitem');
    item.disabled = !!disabled;
    item.innerHTML = `${typeof lucide === 'function' ? lucide(iconName, 14) : ''}<span>${label}</span>`;
    item.addEventListener('click', async () => {
      if (item.disabled) return;
      close();
      await run();
    });
    menu.appendChild(item);
  });
  document.body.appendChild(menu);
  anchor.setAttribute('aria-expanded', 'true');
  if (typeof positionPopup === 'function') {
    positionPopup(menu, anchor.getBoundingClientRect(), { prefer: 'below', gap: 4 });
  } else {
    const rect = anchor.getBoundingClientRect();
    menu.style.position = 'fixed';
    menu.style.left = `${Math.max(4, rect.right - menu.offsetWidth)}px`;
    menu.style.top = `${rect.bottom + 4}px`;
  }
  dismiss = event => {
    if (event.type === 'keydown' && event.key !== 'Escape') return;
    if (event.type === 'pointerdown' && (menu.contains(event.target) || anchor.contains(event.target))) return;
    if (event.type === 'keydown') event.preventDefault();
    close();
  };
  setTimeout(() => {
    if (!menu.isConnected) return;
    document.addEventListener('pointerdown', dismiss, true);
    document.addEventListener('keydown', dismiss, true);
    menu.querySelector('button:not(:disabled)')?.focus();
  }, 0);
}

function _settingsThemeCommonFontValue() {
  const raw = document.documentElement.style.getPropertyValue('--ui-font')
    || getComputedStyle(document.documentElement).getPropertyValue('--ui-font')
    || '';
  return typeof normalizeFontFamilyValue === 'function' ? normalizeFontFamilyValue(raw) : raw.trim();
}

function _renderSettingsThemeCommonFontSection() {
  const options = typeof getUIFontOptions === 'function' ? getUIFontOptions() : '';
  return `<section class="gb-section gb-section--boxed settings-theme-font-section" data-settings-view="font">
    <div class="gb-section-title">共通フォント</div>
    <label class="gb-field-row">
      <span class="gb-label">フォント:</span>
      <select id="modal-font-family" class="gb-select" data-onchange="settingsThemeCommonFontChanged(this.value)" style="max-width:220px;">${options}</select>
    </label>
  </section>`;
}

const SETTINGS_THEME_DETAIL_STYLE_GROUPS = Object.freeze({
  surface: [
    ['共通', ['共通本文背景色', 'アプリ基礎背景色', 'サブ背景色', '強調背景色', 'ポップアップ', 'パネルタブバー', 'パネルタブ選択背景', '折りたたみ/ドックバー', 'パネル内タブバー', 'パネル内タブ 通常', 'パネル内タブ 選択']],
    ['フォルダ', ['カード', 'カード枠線']],
    ['ノート', ['引用ブロック']],
    ['シート', ['ヘッダー', 'エントリ列', 'セル']],
    ['ボード', ['ボード背景']],
    ['スケジュール', ['全体', 'ツールバー', 'サイドバー', 'コンテンツ', '右サイドバー', 'セル']],
    ['補助パネル', ['フォルダツリー', 'ビューワーカード', 'チャット入力']],
  ],
  text: [
    ['共通', ['通常文字', 'サブテキスト', 'ヘッダー', 'ツールバー', '強調文字', 'リンク', 'エラー・警告']],
    ['ノート', ['タイトル', '見出し H1', '見出し H2', '見出し H3', '見出し H4', '見出し H5', '見出し H6', '本文', '引用ブロック']],
    ['シナリオ', ['基本テキスト']],
    ['シート', ['ヘッダー', 'エントリ列', 'セル']],
    ['スケジュール', ['見出し', '土曜', '日曜', '時刻', '補助表示']],
    ['補助パネル', ['チャット本文']],
  ],
  state: [
    ['共通', ['ボタン', 'ボタンホバー', 'ボタン選択', 'ホバー', '選択', 'カーソル', 'フォーカス枠', 'スライダー']],
    ['フォルダ', ['ホバー', '選択']],
    ['シナリオ', ['ホバー', 'テキスト選択', 'ドラッグ選択', 'ドロップ', 'カーソル']],
    ['シート', ['選択', 'アクティブセル枠']],
    ['ボード', ['選択', '矩形選択', 'カーソル']],
    ['スケジュール', ['セルホバー', '今日', 'イベント', '現在時刻バー', '入力欄', '操作ボタン', 'アクセント', 'ミニカレンダー選択']],
    ['補助パネル', ['補助パネルアクセント']],
  ],
  ornament: [
    ['共通', ['ツールチップ', 'ツールチップ枠線', 'スクロールバー背景', 'スクロールバーつまみ', 'スクロールバーホバー', 'パネル内タブ 選択背景濃度', 'パネル内タブ サイズ', 'アクセント', 'ボーダー']],
    ['ノート', ['引用線']],
    ['シナリオ', ['枠線', '見開き区切り', 'ルビ']],
    ['シート', ['テーブル罫線', '採用ステータス', 'ソースバッジ 1', 'ソースバッジ 2', 'ソースバッジ 3', 'ソースバッジ 4']],
    ['ボード', ['影', 'グループ', 'アンカー', 'カード隙間']],
    ['スケジュール', ['罫線', 'イベント配置', 'ToDo列', 'ToDo見出し', 'ToDo', '優先度: 緊急', '優先度: 高', '優先度: 中', '打刻']],
  ],
});

function _settingsThemeDetailRows(section, labels) {
  const wanted = new Set(labels || []);
  return (UI_STYLE_SECTIONS?.[section] || []).filter(def => wanted.has(String(def?.label || '')));
}

function _renderSettingsThemeDetailStyleGroups(groupId) {
  const groups = SETTINGS_THEME_DETAIL_STYLE_GROUPS[groupId] || [];
  return groups.map(([section, labels]) => {
    const rows = _settingsThemeDetailRows(section, labels);
    if (!rows.length) return '';
    return _settingsThemeSubsection(section, rows.map(def => renderStyleRow(def)).join(''));
  }).join('');
}

function _settingsThemeAccentState() {
  const manager = typeof MeldexThemeManager !== 'undefined' ? MeldexThemeManager : null;
  const theme = _settingsThemeCurrent();
  const policy = manager?.getThemeAccentPolicy?.(theme) || { kind: 'theme-palette', defaultColor: '' };
  const useOs = !!manager?.getUseOsAccentColor?.();
  const palette = manager?.getThemeColorSet?.(theme, { ignoreOsAccent: true }) || [];
  const fallback = policy.defaultColor || palette[0] || '#569cd6';
  const current = (getCssVar('--ui-accent') || getCssVar('--accent') || fallback).trim();
  const osColor = String(manager?.getOsAccentColor?.() || '').trim();
  const usesDefault = current.toLowerCase() === String(fallback).trim().toLowerCase();
  return {
    mode: useOs ? 'os' : (usesDefault ? 'default' : 'custom'),
    color: useOs && osColor ? osColor : current,
    defaultColor: fallback,
  };
}

function renderSettingsThemeAccentEditor() {
  const state = _settingsThemeAccentState();
  return `<div class="gb-field-row settings-theme-accent-row" data-settings-theme-accent="1">
    <label class="gb-label" for="settings-theme-accent-mode">アクセントカラー</label>
    <span class="settings-theme-accent-control">
      <select id="settings-theme-accent-mode" class="gb-select" data-e2e-id="settings-theme-accent-mode" data-onchange="settingsThemeAccentModeChanged(this)">
        <option value="os"${state.mode === 'os' ? ' selected' : ''}>OSアクセント</option>
        <option value="default"${state.mode === 'default' ? ' selected' : ''}>既定のアクセント</option>
        <option value="custom"${state.mode === 'custom' ? ' selected' : ''}>指定カラー</option>
      </select>
      <button type="button" class="gb-color-swatch settings-theme-accent-swatch" data-e2e-id="settings-theme-accent-swatch" data-settings-theme-accent-swatch style="background:${esc(state.color)}" title="共通カラーパレットから選択" data-action="settingsThemeChooseAccentColor(this)"></button>
    </span>
    ${fieldHelp('選択、フォーカス、タブ下線、左アクセントバーなどに共通で使います', { e2eId: 'settings-theme-accent-help' })}
  </div>`;
}

function _settingsThemeSyncAccentSwatch() {
  const color = _settingsThemeAccentState().color;
  document.querySelectorAll('[data-settings-theme-accent-swatch]').forEach(swatch => {
    swatch.style.background = color;
    swatch.setAttribute('aria-label', `アクセントカラー ${color}`);
  });
}

if (typeof window !== 'undefined' && !window.__settingsThemeAccentSwatchBound) {
  window.__settingsThemeAccentSwatchBound = true;
  window.addEventListener('meldex-theme-os-accent-change', () => _settingsThemeSyncAccentSwatch());
}

function _settingsThemeApplyAccentColor(color) {
  const value = String(color || '').trim();
  if (!/^#[0-9a-f]{6}$/i.test(value)) return false;
  const root = document.documentElement;
  const keys = typeof MeldexThemeManager !== 'undefined'
    ? MeldexThemeManager.THEME_OS_ACCENT_STYLE_KEYS || []
    : ['--accent', '--accent2', '--blue', '--ui-accent'];
  const textKeys = typeof MeldexThemeManager !== 'undefined'
    ? MeldexThemeManager.THEME_OS_ACCENT_TEXT_STYLE_KEYS || []
    : ['--ui-selection-fg', '--ui-accent-fg'];
  const textColor = typeof MeldexThemeManager?.getAccentTextColor === 'function'
    ? MeldexThemeManager.getAccentTextColor(value)
    : '#ffffff';
  keys.forEach(key => root.style.setProperty(key, value.toLowerCase()));
  textKeys.forEach(key => root.style.setProperty(key, textColor));
  root.style.setProperty('--ui-accent', value.toLowerCase());
  if (typeof _settingsThemeMarkDirty === 'function') _settingsThemeMarkDirty();
  if (typeof refreshSettingsThemePreview === 'function') refreshSettingsThemePreview();
  document.querySelectorAll('[data-settings-theme-accent-swatch]').forEach(swatch => { swatch.style.background = value; });
  return true;
}

function settingsThemeAccentModeChanged(select) {
  if (!select || typeof MeldexThemeManager === 'undefined') return;
  if (_settingsThemeIsReadonlyElement(select)) {
    _settingsThemePromptDuplicateForEdit();
    const state = _settingsThemeAccentState();
    select.value = state.mode;
    return;
  }
  const mode = select.value;
  if (mode === 'os') {
    MeldexThemeManager.setUseOsAccentColor(true);
  } else {
    MeldexThemeManager.setUseOsAccentColor(false);
    const state = _settingsThemeAccentState();
    if (mode === 'default') _settingsThemeApplyAccentColor(state.defaultColor);
    else settingsThemeChooseAccentColor(select);
  }
  _settingsThemeSyncAccentSwatch();
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => _settingsThemeSyncAccentSwatch());
  if (typeof _settingsThemeMarkDirty === 'function') _settingsThemeMarkDirty();
}

function settingsThemeChooseAccentColor(anchor) {
  if (!anchor || typeof openColorPalette !== 'function') return;
  if (_settingsThemeIsReadonlyElement(anchor)) {
    _settingsThemePromptDuplicateForEdit();
    return;
  }
  const current = _settingsThemeAccentState().color;
  openColorPalette(anchor, current, color => {
    if (typeof MeldexThemeManager !== 'undefined' && MeldexThemeManager.getUseOsAccentColor?.()) {
      MeldexThemeManager.setUseOsAccentColor(false);
    }
    if (!_settingsThemeApplyAccentColor(color)) return;
    const select = document.getElementById('settings-theme-accent-mode');
    if (select) select.value = 'custom';
  });
}

const SETTINGS_THEME_PREVIEW_APPS = Object.freeze([
  ['folder', 'フォルダ'], ['note', 'ノート'], ['scriptnote', 'シナリオ'], ['sheet', 'シート'],
  ['board', 'ボード'], ['calendar', 'スケジュール'], ['aux', '補助パネル'], ['popup', 'ポップアップ'],
]);

const SETTINGS_THEME_PREVIEW_SECTION_MAP = Object.freeze({
  folder: Object.freeze(['フォルダ']),
  note: Object.freeze(['ノート']),
  scriptnote: Object.freeze(['シナリオ']),
  sheet: Object.freeze(['シート']),
  board: Object.freeze(['ボード']),
  calendar: Object.freeze(['スケジュール']),
  aux: Object.freeze(['フォルダツリー', 'ビューワー', 'オプション', 'チャット', 'ヒストリー', 'アノテート', '検索', 'バージョン管理']),
  popup: Object.freeze(['共通']),
});

const SETTINGS_THEME_PREVIEW_APP_SURFACES = Object.freeze({
  folder: Object.freeze({ bg: '--fv-panel-bg', fg: '--fv-item-fg' }),
  note: Object.freeze({ bg: '--page-text-bg', fg: '--page-text-fg' }),
  scriptnote: Object.freeze({ bg: '--sn2-page-bg', fg: '--sn2-base-text-color' }),
  sheet: Object.freeze({ bg: '--db-row-bg', fg: '--db-cell-fg' }),
  board: Object.freeze({ bg: '--bd-bg', fg: '--bd-link-type-icon-color' }),
  calendar: Object.freeze({ bg: '--cal-content-bg', fg: '--cal-fg' }),
  aux: Object.freeze({ bg: '--preview-bg', fg: '--preview-fg' }),
  popup: Object.freeze({ bg: '--ui-popup-bg', fg: '--fg' }),
});

const SETTINGS_THEME_PREVIEW_APP_SURFACE_TARGETS = Object.freeze({
  folder: 'surface-folder',
  note: 'surface-note',
  scriptnote: 'surface-scriptnote',
  sheet: 'surface-sheet',
  board: 'surface-board',
  calendar: 'surface-calendar',
  aux: 'surface-preview',
  popup: 'surface-popup',
});

const SETTINGS_THEME_PREVIEW_SIDE_SURFACES = Object.freeze({
  options: Object.freeze({ bg: '--detail-bg', targetId: 'surface-detail' }),
  viewer: Object.freeze({ bg: '--preview-bg', targetId: 'surface-preview' }),
  subpanel: Object.freeze({ bg: '--outliner-bg', targetId: 'surface-outliner' }),
  properties: Object.freeze({ bg: '--detail-bg', targetId: 'surface-detail' }),
  tags: Object.freeze({ bg: '--detail-bg', targetId: 'surface-detail' }),
  backlinks: Object.freeze({ bg: '--detail-bg', targetId: 'surface-detail' }),
  annotation: Object.freeze({ bg: '--annotation-bg', targetId: 'surface-annotation' }),
  theme: Object.freeze({ bg: '--detail-bg', targetId: 'surface-detail' }),
  history: Object.freeze({ bg: '--history-bg', targetId: 'surface-history' }),
  version: Object.freeze({ bg: '--version-bg', targetId: 'surface-version' }),
  chat: Object.freeze({ bg: '--chat-bg', targetId: 'surface-chat' }),
  memo: Object.freeze({ bg: '--detail-bg', targetId: 'surface-detail' }),
});

const SETTINGS_THEME_STATE_KEYS = Object.freeze({
  folder: Object.freeze({ bg: '--fv-item-bg', fg: '--fv-item-fg', border: '--fv-item-border', accent: '--fv-item-selected-border', hoverBg: '--fv-item-hover-bg', hoverFg: '--fv-item-hover-fg', selectedBg: '--fv-item-selected-bg', selectedFg: '--fv-item-selected-fg' }),
  sheet: Object.freeze({ bg: '--db-row-bg', fg: '--db-cell-fg', border: '--db-grid-border', accent: '--db-active-color', hoverBg: '--db-cell-bg', hoverFg: '--db-th-fg', selectedBg: '--db-selection-color', selectedFg: '--db-selection-fg' }),
  scriptnote: Object.freeze({ bg: '--sn2-page-bg', fg: '--sn2-base-text-color', border: '--sn2-border-color', accent: '--sn2-selection-color', hoverBg: '--sn2-hover-bg', hoverFg: '--sn2-base-text-color', selectedBg: '--sn2-selection-color', selectedFg: '--sn2-selection-fg' }),
  note: Object.freeze({ bg: '--page-text-bg', fg: '--page-text-fg', border: '--page-table-border-color', accent: '--page-selection-color', hoverBg: '--page-table-row-hover-bg', hoverFg: '--page-table-row-hover-fg', selectedBg: '--page-selection-color', selectedFg: '--page-selection-fg' }),
  board: Object.freeze({ bg: '--bd-bg', fg: '--bd-link-type-icon-color', border: '--bd-group-color', accent: '--bd-selection-color', hoverBg: '--bd-selection-color', hoverFg: '--bd-selection-fg', selectedBg: '--bd-selection-color', selectedFg: '--bd-selection-fg' }),
  calendar: Object.freeze({ bg: '--cal-content-bg', fg: '--cal-fg', border: '--cal-grid-line', accent: '--cal-today-bg', hoverBg: '--cal-cell-hover-bg', hoverFg: '--cal-cell-hover-fg', selectedBg: '--cal-today-bg', selectedFg: '--cal-today-fg' }),
  aux: Object.freeze({ bg: '--preview-bg', fg: '--preview-fg', border: '--preview-border', accent: '--preview-hover-bg', hoverBg: '--preview-hover-bg', hoverFg: '--preview-fg', selectedBg: '--preview-card-bg', selectedFg: '--preview-fg' }),
  popup: Object.freeze({ bg: '--ui-popup-bg', fg: '--fg', border: '--ui-border', accent: '--ui-accent', hoverBg: '--ui-hover-bg', hoverFg: '--ui-hover-fg', selectedBg: '--bg3', selectedFg: '--ui-accent-fg' }),
});

const SETTINGS_THEME_STATE_SECTIONS = Object.freeze([
  Object.freeze(['basic-surfaces', '基本の面']),
  Object.freeze(['text', '文字']),
  Object.freeze(['sequence-color', '連番配色']),
  Object.freeze(['ornaments', '装飾']),
  Object.freeze(['operation-states', '操作状態']),
]);
const SETTINGS_THEME_STATES = Object.freeze(['default', 'hover', 'focus', 'selected']);
let _settingsThemePreviewAppId = 'note';
let _settingsThemePreviewLeftRailId = 'note';
let _settingsThemePreviewRightRailId = 'theme';

function _settingsThemeStateKeys(config, section, state) {
  if (state === 'focus') {
    const normalKey = section === 'sequence-color' ? '--theme-palette-0'
      : section === 'text' ? config.fg
        : section === 'ornaments' ? config.border
          : config.bg;
    return { normalKey, key: config.accent, property: 'outlineColor' };
  }
  if (section === 'sequence-color') {
    const paletteIndex = state === 'hover' ? 1 : state === 'selected' ? 3 : 0;
    return { normalKey: '--theme-palette-0', key: `--theme-palette-${paletteIndex}`, property: 'backgroundColor' };
  }
  if (section === 'text') {
    const key = state === 'hover' ? config.hoverFg : state === 'selected' ? config.selectedFg : config.fg;
    return { normalKey: config.fg, key, property: 'color' };
  }
  if (section === 'ornaments') {
    const key = state === 'hover' || state === 'selected' ? config.accent : config.border;
    return { normalKey: config.border, key, property: 'borderBottomColor' };
  }
  const key = state === 'hover' ? config.hoverBg : state === 'selected' ? config.selectedBg : config.bg;
  return { normalKey: config.bg, key, property: 'backgroundColor' };
}

function settingsThemeStateCoverageManifest() {
  return SETTINGS_THEME_PREVIEW_APPS.flatMap(([appId, appLabel]) => {
    const config = SETTINGS_THEME_STATE_KEYS[appId];
    return SETTINGS_THEME_STATE_SECTIONS.flatMap(([coverageSection, sectionLabel]) =>
      SETTINGS_THEME_STATES.map(state => {
        const source = _settingsThemeStateKeys(config, coverageSection, state);
        return {
          id: `theme-state/${appId}/${coverageSection}/${state}`,
          appId,
          appLabel,
          coverageSection,
          sectionLabel,
          state,
          normalKey: source.normalKey,
          key: source.key,
          property: source.property,
          effectKey: state === 'focus' ? config.accent : source.key,
        };
      })
    );
  });
}

function _settingsThemeStateTarget(entry) {
  const config = SETTINGS_THEME_STATE_KEYS[entry.appId];
  const label = { default: '通常', hover: 'ホバー', focus: '焦点', selected: '選択' }[entry.state];
  const accessibleLabel = entry.state === 'focus' ? 'フォーカス' : label;
  const style = [
    `--theme-state-base-bg:var(${config.bg})`,
    `--theme-state-base-fg:var(${config.fg})`,
    `--theme-state-base-border:var(${config.border})`,
    `--theme-state-normal-source:var(${entry.normalKey})`,
    `--theme-state-source:var(${entry.key})`,
    `--theme-state-focus:var(${config.accent})`,
    `--a11y-focus-ring:var(${config.accent})`,
  ].join(';');
  return `<button type="button" class="settings-theme-state-sample" data-e2e-id="settings-${esc(entry.id)}" data-theme-state-id="${esc(entry.id)}" data-theme-state-section="${esc(entry.coverageSection)}" data-theme-state="${esc(entry.state)}" aria-label="${esc(accessibleLabel)}" title="${esc(accessibleLabel)}" aria-pressed="false" style="${esc(style)}">${esc(label)}</button>`;
}

function _settingsThemeStateMatrix(appId) {
  const entries = settingsThemeStateCoverageManifest().filter(item => item.appId === appId);
  const rows = SETTINGS_THEME_STATE_SECTIONS.map(([section, label]) => {
    const targets = entries.filter(item => item.coverageSection === section).map(_settingsThemeStateTarget).join('');
    return `<div class="settings-theme-state-row" data-theme-state-row="${esc(section)}"><span>${esc(label)}</span>${targets}</div>`;
  }).join('');
  return `<section class="settings-theme-preview-group settings-theme-state-matrix" data-theme-state-matrix="1"><h3>状態プレビュー</h3>${rows}</section>`;
}

const SETTINGS_THEME_PREVIEW_SAMPLE_SPECS = Object.freeze({
  folder: Object.freeze([
    ['card', 'フォルダ', 'カード'], ['border', 'フォルダ', 'カード枠線'],
    ['hover', 'フォルダ', 'ホバー'], ['selected', 'フォルダ', '選択'],
    ['meta', 'フォルダ', 'メタ情報'], ['icon', 'フォルダ', 'アイコン'],
  ]),
  note: Object.freeze([
    ['title', 'ノート', 'タイトル'], ['h1', 'ノート', '見出し H1'], ['h2', 'ノート', '見出し H2'],
    ['h3', 'ノート', '見出し H3'], ['h4', 'ノート', '見出し H4'], ['h5', 'ノート', '見出し H5'],
    ['h6', 'ノート', '見出し H6'], ['heading-icon', 'ノート', '見出しアイコン不透明度'],
    ['paragraph', 'ノート', '本文'], ['bullet-list', 'ノート', '本文'], ['number-list', 'ノート', '本文'],
    ['task-list', 'ノート', '本文'], ['link', '共通', 'リンク'], ['quote', 'ノート', '引用ブロック'],
    ['quote-cite', 'ノート', '引用元'], ['callout-icon', 'ノート', 'コールアウトアイコン'],
    ['callout-body', 'ノート', 'コールアウト本文'], ['table-header', 'ノート', '表 見出し'],
    ['table-cell', 'ノート', '表 セル'], ['table-control', 'ノート', '表 追加ボタン'],
    ['code', 'ノート', 'コードブロック形状'], ['copy', 'ノート', 'コピーボタン'],
    ['kbd', 'ノート', 'キーボード表記'], ['details', 'ノート', '開閉ブロック見出し'],
  ]),
  scriptnote: Object.freeze([
    ['scene', 'シナリオ', '基本テキスト'], ['action', 'シナリオ', '基本テキスト'],
    ['dialogue', 'シナリオ', '基本テキスト'], ['hover', 'シナリオ', 'ホバー'],
    ['selection', 'シナリオ', 'テキスト選択'], ['ruby', 'シナリオ', 'ルビ'],
  ]),
  sheet: Object.freeze([
    ['header-name', 'シート', 'ヘッダー'], ['header-status', 'シート', 'ヘッダー'],
    ['entity', 'シート', 'エントリ列'], ['cell', 'シート', 'セル'], ['selected', 'シート', '選択'],
    ['active', 'シート', 'アクティブセル枠'], ['status', 'シート', '採用ステータス'],
    ['badge-1', 'シート', 'ソースバッジ 1'], ['badge-2', 'シート', 'ソースバッジ 2'],
  ]),
  board: Object.freeze([
    ['canvas', 'ボード', 'ボード背景'], ['card', 'ボード', '標準フォント'],
    ['selected', 'ボード', '選択'], ['group', 'ボード', 'グループ'],
    ['link', 'ボード', 'リンク種別'], ['anchor', 'ボード', 'アンカー'], ['gap', 'ボード', 'カード隙間'],
  ]),
  calendar: Object.freeze([
    ['toolbar', 'スケジュール', 'ツールバー'], ['header', 'スケジュール', '見出し'],
    ['saturday', 'スケジュール', '土曜'], ['sunday', 'スケジュール', '日曜'],
    ['cell', 'スケジュール', 'セル'], ['today', 'スケジュール', '今日'],
    ['time', 'スケジュール', '時刻'], ['event', 'スケジュール', 'イベント'],
    ['todo', 'スケジュール', 'ToDo'], ['control', 'スケジュール', '操作ボタン'],
  ]),
  aux: Object.freeze([
    ['tree', 'フォルダツリー', 'パネル'], ['viewer', 'ビューワー', 'カード背景'],
    ['options', 'オプション', 'セクション背景'], ['chat-message', 'チャット', 'メッセージ'],
    ['chat-input', 'チャット', '入力欄'],
    ['history', 'ヒストリー', '行背景'], ['annotation', 'アノテート', 'カード背景'],
    ['version', 'バージョン管理', '行背景'],
  ]),
  popup: Object.freeze([
    ['surface', '共通', 'ポップアップ'], ['menu', '共通', 'ボタン'], ['menu-hover', '共通', 'ボタンホバー'],
    ['menu-selected', '共通', 'ボタン選択'], ['tooltip', '共通', 'ツールチップ'],
    ['input', '共通', '通常文字'], ['link', '共通', 'リンク'], ['slider', '共通', 'スライダー'],
  ]),
});

function _settingsThemePreviewSample(appId, sampleId, section, label, text, className = '') {
  return _settingsThemePreviewTarget(section, label, text, className, `${appId}/${sampleId}`);
}

function _settingsThemePreviewSampleMarkup(appId, sampleId, section, label, markup, className = '') {
  return _settingsThemePreviewTargetMarkup(section, label, markup, className, `${appId}/${sampleId}`);
}

function _settingsThemePreviewElement(appId, sampleId, section, label, tagName, content, className = '', options = {}) {
  const allowedTags = new Set(['a', 'article', 'blockquote', 'code', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'kbd', 'li', 'pre', 'span', 'summary', 'td', 'th']);
  const tag = allowedTags.has(tagName) ? tagName : 'div';
  const def = (UI_STYLE_SECTIONS?.[section] || []).find(item => item.label === label);
  const style = def ? _settingsThemePreviewStyle(def) : '';
  const stableId = `${appId}/${sampleId}`;
  const actionTitle = `${label}（クリックで書式設定）`;
  const markup = options.markup === true ? content : esc(content || label);
  const themeUiTarget = _settingsThemePreviewThemeUiTarget(stableId, section, label);
  const themeUiState = /選択/.test(label || '') ? 'selected' : (/ホバー/.test(label || '') ? 'hover' : 'normal');
  const themeUiAttrs = themeUiTarget
    ? ` data-theme-ui-target-id="${esc(themeUiTarget)}" data-theme-ui-state-id="${esc(themeUiState)}"`
    : '';
  return `<${tag} class="settings-theme-preview-hotspot ${className}" tabindex="0" role="button" data-e2e-id="${esc(`settings-theme-preview-${stableId}`)}" data-style-id="${esc(stableId)}" data-style-section="${esc(section)}" data-style-label="${esc(label)}"${themeUiAttrs} data-action="openStylePreviewPopup(this)" title="${esc(actionTitle)}" aria-label="${esc(actionTitle)}" style="${esc(style)}">${markup}</${tag}>`;
}

function _settingsThemePreviewActualSurface(appId) {
  const sample = (id, section, label, text, className = '') =>
    _settingsThemePreviewSample(appId, id, section, label, text, className);
  const sampleMarkup = (id, section, label, markup, className = '') =>
    _settingsThemePreviewSampleMarkup(appId, id, section, label, markup, className);
  const icon = (name, size = 16) => typeof lucide === 'function' ? lucide(name, size) : '';
  if (appId === 'folder') {
    const folderItem = (id, label, name, type, state = '') => _settingsThemePreviewElement(
      appId, id, 'フォルダ', label, 'article',
      `<input class="fv-check" type="checkbox" disabled aria-hidden="true"><div class="fv-thumb"><span class="fv-icon">${icon(type, 28)}</span></div><div class="fv-name">${esc(name)}</div><div class="fv-meta"><span class="fv-meta-item">今日 14:32</span></div>`,
      `fv-item ${state}`.trim(), { markup: true },
    );
    return `<section class="settings-theme-preview-folder-view grid-layout" data-settings-theme-folder-grid aria-label="フォルダ">
      ${folderItem('card', 'カード', '企画', 'folder')}
      ${folderItem('border', 'カード枠線', '資料', 'files')}
      ${folderItem('hover', 'ホバー', '制作中', 'fileClock', 'is-hover')}
      ${folderItem('selected', '選択', '第1話.md', 'fileText', 'selected')}
      <div class="settings-theme-folder-meta-row">${_settingsThemePreviewElement(appId, 'icon', 'フォルダ', 'アイコン', 'span', icon('folderOpen', 18), 'fv-icon', { markup: true })}${_settingsThemePreviewElement(appId, 'meta', 'フォルダ', 'メタ情報', 'span', '4項目 · 今日更新', 'fv-meta')}</div>
    </section>`;
  }
  if (appId === 'note') {
    const toolButton = (id, iconName, label, selected = false) => `<button type="button" class="tb-icon-btn${selected ? ' active' : ''}"${_settingsThemePreviewInteractiveAttributes(`chrome/toolbar/note/${id}`, '共通', selected ? 'ボタン選択' : 'ボタン')} title="${esc(`${label}／クリックで書式設定`)}" aria-label="${esc(`${label}の書式設定`)}"><span class="ico ico-${esc(iconName)}" aria-hidden="true">${icon(iconName, 16)}</span></button>`;
    return `<section class="settings-theme-preview-note-frame" aria-label="ノート">
    <div class="gb-toolbar settings-theme-preview-note-toolbar" role="toolbar" aria-label="ノートツールバー">
      ${toolButton('menu', 'menu', 'メニュー')}${toolButton('folder-tree', 'folderTree', 'フォルダツリー')}
      <span class="tb-file-title tb-file-title--input settings-theme-preview-hotspot" tabindex="0" role="button"${_settingsThemePreviewInteractiveAttributes('chrome/toolbar/note/title', '共通', '通常文字')} title="ファイル名／クリックで書式設定" aria-label="ファイル名の書式設定">テーマプレビュー.md</span>
      <span class="sep" aria-hidden="true"></span>
      ${toolButton('toc', 'listCollapse', '目次', true)}${toolButton('vertical', 'kanban', '縦書き')}${toolButton('indent', 'indentIncrease', '見出しインデント')}${toolButton('links', 'externalLink', '関連リンク')}${toolButton('comments', 'messageSquare', 'コメント')}
      <span class="sep" aria-hidden="true"></span>
      ${toolButton('undo', 'undo2', '元に戻す')}${toolButton('redo', 'redo2', 'やり直し')}
      <span class="settings-theme-preview-toolbar-spacer"></span>
      ${toolButton('refresh', 'refreshCw', '再読み込み')}${toolButton('search', 'search', '検索')}${toolButton('options', 'slidersHorizontal', 'オプション')}
    </div>
    <div class="note-editor-body settings-theme-preview-note-body">
      <nav class="settings-theme-preview-note-toc" aria-label="目次"><strong>目次</strong><a>見出し 1</a><a>見出し 2</a><a>見出し 3</a></nav>
      <article data-settings-theme-note-content aria-label="ノート本文">
        <div class="settings-theme-note-title-row">${_settingsThemePreviewElement(appId, 'heading-icon', 'ノート', '見出しアイコン不透明度', 'span', icon('pilcrow', 16), 'heading-icon', { markup: true })}${_settingsThemePreviewElement(appId, 'title', 'ノート', 'タイトル', 'div', 'ページタイトル', 'note-title')}</div>
        ${_settingsThemePreviewElement(appId, 'h1', 'ノート', '見出し H1', 'h1', '見出し 1')}
        ${_settingsThemePreviewElement(appId, 'h2', 'ノート', '見出し H2', 'h2', '見出し 2')}
        ${_settingsThemePreviewElement(appId, 'h3', 'ノート', '見出し H3', 'h3', '見出し 3')}
        ${_settingsThemePreviewElement(appId, 'h4', 'ノート', '見出し H4', 'h4', '見出し 4')}
        ${_settingsThemePreviewElement(appId, 'h5', 'ノート', '見出し H5', 'h5', '見出し 5')}
        ${_settingsThemePreviewElement(appId, 'h6', 'ノート', '見出し H6', 'h6', '見出し 6')}
        ${_settingsThemePreviewElement(appId, 'paragraph', 'ノート', '本文', 'div', '本文の段落です。クリックすると実際のノート本文と同じ書式設定を変更できます。')}
        <ul><li>${_settingsThemePreviewElement(appId, 'bullet-list', 'ノート', '本文', 'span', '箇条書きリスト')}</li></ul>
        <ol><li>${_settingsThemePreviewElement(appId, 'number-list', 'ノート', '本文', 'span', '番号付きリスト')}</li></ol>
        <ul class="task-list"><li><input type="checkbox" checked disabled aria-hidden="true">${_settingsThemePreviewElement(appId, 'task-list', 'ノート', '本文', 'span', 'タスクリスト')}</li></ul>
        <p>${_settingsThemePreviewElement(appId, 'link', '共通', 'リンク', 'span', '関連ページへのリンク', 'auto-link')} ${_settingsThemePreviewElement(appId, 'kbd', 'ノート', 'キーボード表記', 'kbd', 'Ctrl + K')}</p>
        ${_settingsThemePreviewElement(appId, 'quote', 'ノート', '引用ブロック', 'blockquote', `${esc('引用ブロックの本文')}${_settingsThemePreviewElement(appId, 'quote-cite', 'ノート', '引用元', 'span', '— 引用元', 'settings-theme-note-quote-cite')}`, '', { markup: true })}
        <aside class="callout-block callout-info">${_settingsThemePreviewElement(appId, 'callout-icon', 'ノート', 'コールアウトアイコン', 'span', icon('info', 16), 'callout-icon', { markup: true })}${_settingsThemePreviewElement(appId, 'callout-body', 'ノート', 'コールアウト本文', 'div', '重要な情報をまとめるコールアウトです。', 'callout-body')}</aside>
        <table><thead><tr>${_settingsThemePreviewElement(appId, 'table-header', 'ノート', '表 見出し', 'th', '項目')}<th>状態</th></tr></thead><tbody><tr>${_settingsThemePreviewElement(appId, 'table-cell', 'ノート', '表 セル', 'td', '原稿')}<td>進行中</td></tr></tbody></table>
        ${_settingsThemePreviewElement(appId, 'table-control', 'ノート', '表 追加ボタン', 'div', '+ 行を追加', 'table-add-row')}
        <pre>${_settingsThemePreviewElement(appId, 'code', 'ノート', 'コードブロック形状', 'code', 'const theme = "Meldex";')}${_settingsThemePreviewElement(appId, 'copy', 'ノート', 'コピーボタン', 'span', 'Copy', 'copy-code-btn')}</pre>
        <details open>${_settingsThemePreviewElement(appId, 'details', 'ノート', '開閉ブロック見出し', 'summary', '詳細を表示', 'settings-theme-preview-summary')}<p>折りたたみブロックの本文</p></details>
      </article>
    </div>
  </section>`;
  }
  if (appId === 'scriptnote') {
    const row = (id, label, kind, role, text, state = '') => `<div class="sn2-row ${state}" data-kind="${esc(kind)}">
      <div class="sn2-handle"><input class="sn2-row-check" type="checkbox" disabled aria-hidden="true"><span>⠿</span></div>
      <div class="sn2-gutter">${id === 'scene' ? '1' : ''}</div><div class="sn2-gutter sn2-gutter2">${id === 'dialogue' ? '2' : ''}</div>
      <button type="button" class="sn2-role-btn" data-e2e-id="settings-theme-preview-script-role-${esc(id)}" tabindex="-1" aria-hidden="true">${esc(role)}</button>
      ${_settingsThemePreviewElement(appId, id, 'シナリオ', label, 'div', text, 'sn2-text')}
      <div class="sn2-row-spacer"></div>
    </div>`;
    return `<section class="sn2-editor settings-theme-preview-script" aria-label="シナリオ本文">
      <div class="sn2-scroll">${row('scene', '基本テキスト', 'heading', '見出し', '書斎・夜')}${row('action', '基本テキスト', 'action', 'ト書き', '机の上で通知ランプが点滅している。')}${row('dialogue', '基本テキスト', 'dialogue', '人物A', '「これでテーマが揃った」')}${row('hover', 'ホバー', 'dialogue', '人物B', 'カット 12', 'is-hover')}${row('selection', 'テキスト選択', 'dialogue', '人物A', '選択中の台詞', 'is-selected')}${row('ruby', 'ルビ', 'dialogue', '人物B', '台詞（せりふ）')}</div>
    </section>`;
  }
  if (appId === 'sheet') return `<section class="settings-theme-preview-sheet-view" aria-label="シート">
    <div class="db-view-tabs"><button type="button" class="db-view-tab active"${_settingsThemePreviewInteractiveAttributes('chrome/sheet/view/table', '共通', 'パネル内タブ 選択')} title="テーブル／クリックで書式設定">テーブル</button><button type="button" class="db-view-tab"${_settingsThemePreviewInteractiveAttributes('chrome/sheet/view/tree', '共通', 'パネル内タブ 通常')} title="ツリー／クリックで書式設定">ツリー</button></div>
    <table class="pivot-table"><thead><tr>${_settingsThemePreviewElement(appId, 'header-name', 'シート', 'ヘッダー', 'th', 'トピック名')}${_settingsThemePreviewElement(appId, 'header-status', 'シート', 'ヘッダー', 'th', '状態')}</tr></thead><tbody>
      <tr>${_settingsThemePreviewElement(appId, 'entity', 'シート', 'エントリ列', 'td', '第1話', 'entity-name-label')}${_settingsThemePreviewElement(appId, 'cell', 'シート', 'セル', 'td', '初稿', 'db-cell')}</tr>
      <tr class="selected">${_settingsThemePreviewElement(appId, 'selected', 'シート', '選択', 'td', '第2話', 'entity-name-label selected')}${_settingsThemePreviewElement(appId, 'active', 'シート', 'アクティブセル枠', 'td', '編集中', 'db-cell active-cell')}</tr>
      <tr><td>${_settingsThemePreviewElement(appId, 'status', 'シート', '採用ステータス', 'span', '採用', 'db-status-badge')}</td><td><span class="settings-theme-sheet-badges">${_settingsThemePreviewElement(appId, 'badge-1', 'シート', 'ソースバッジ 1', 'span', '1', 'source-badge')}${_settingsThemePreviewElement(appId, 'badge-2', 'シート', 'ソースバッジ 2', 'span', '2', 'source-badge')}</span></td></tr>
    </tbody></table>
  </section>`;
  if (appId === 'board') return `<section class="settings-theme-preview-board-canvas" data-bd-role="canvas" aria-label="ボード">
    ${_settingsThemePreviewElement(appId, 'canvas', 'ボード', 'ボード背景', 'span', 'ボードキャンバス', 'settings-theme-board-canvas-label')}
    <div class="settings-theme-board-group" data-bd-group-color>${_settingsThemePreviewElement(appId, 'group', 'ボード', 'グループ', 'span', '第1幕', 'settings-theme-board-group-label')}
      ${_settingsThemePreviewElement(appId, 'card', 'ボード', '標準フォント', 'article', '<span class="bd-text">導入</span>', 'bd-node settings-theme-board-node', { markup: true })}
      ${_settingsThemePreviewElement(appId, 'selected', 'ボード', '選択', 'article', '<span class="bd-text">転換点</span>', 'bd-node bd-selected settings-theme-board-node settings-theme-board-node--selected', { markup: true })}
      ${_settingsThemePreviewElement(appId, 'gap', 'ボード', 'カード隙間', 'article', '<span class="bd-text">結末</span>', 'bd-node settings-theme-board-node settings-theme-board-node--last', { markup: true })}
      <div class="settings-theme-board-connection" aria-hidden="true"><span></span>${_settingsThemePreviewElement(appId, 'anchor', 'ボード', 'アンカー', 'span', icon('circleDot', 16), 'bd-anchor', { markup: true })}${_settingsThemePreviewElement(appId, 'link', 'ボード', 'リンク種別', 'span', icon('arrowRight', 18), 'bd-conn-label', { markup: true })}</div>
    </div>
  </section>`;
  if (appId === 'calendar') return `<section class="gb-cal-root settings-theme-preview-calendar" aria-label="スケジュール">
    <div class="gb-toolbar-cal" role="toolbar" aria-label="スケジュール">${_settingsThemePreviewElement(appId, 'toolbar', 'スケジュール', 'ツールバー', 'span', '2026年 8月', 'gb-cal-toolbar-title')}<div class="gb-cal-toolbar-actions">${_settingsThemePreviewElement(appId, 'control', 'スケジュール', '操作ボタン', 'span', '今日', 'tb-icon-btn')}</div></div>
    <div class="cal-month-grid settings-theme-calendar-grid">${_settingsThemePreviewElement(appId, 'header', 'スケジュール', '見出し', 'div', '金', 'gb-cal-weekday')}${_settingsThemePreviewElement(appId, 'saturday', 'スケジュール', '土曜', 'div', '土', 'gb-cal-weekday saturday')}${_settingsThemePreviewElement(appId, 'sunday', 'スケジュール', '日曜', 'div', '日', 'gb-cal-weekday sunday')}
      ${_settingsThemePreviewElement(appId, 'cell', 'スケジュール', 'セル', 'div', '<span class="gb-cal-day-num">28</span>', 'gb-cal-day', { markup: true })}
      ${_settingsThemePreviewElement(appId, 'today', 'スケジュール', '今日', 'div', '<span class="gb-cal-day-num">29</span>', 'gb-cal-day gb-cal-today', { markup: true })}
      <div class="gb-cal-day"><span class="gb-cal-day-num">30</span></div>
    </div>
    <div class="settings-theme-calendar-agenda">${_settingsThemePreviewElement(appId, 'time', 'スケジュール', '時刻', 'span', '13:00', 'gb-cal-week-time')}${_settingsThemePreviewElement(appId, 'event', 'スケジュール', 'イベント', 'div', '<span class="gb-cal-event-title">レビュー</span>', 'gb-cal-day-event', { markup: true })}<label class="settings-theme-calendar-todo-row"><input type="checkbox" disabled aria-hidden="true">${_settingsThemePreviewElement(appId, 'todo', 'スケジュール', 'ToDo', 'span', '公開準備', 'gb-cal-all-day-task')}</label></div>
  </section>`;
  if (appId === 'aux') return `<section class="settings-theme-preview-actual settings-theme-preview-aux-actual" aria-label="補助パネル一覧">
    ${sampleMarkup('tree', 'フォルダツリー', 'パネル', `${icon('chevronDown', 14)}<span>フォルダツリー</span>`, 'settings-theme-aux-panel')}${sample('viewer', 'ビューワー', 'カード背景', '画像プレビュー', 'settings-theme-aux-panel')}
    ${sample('options', 'オプション', 'セクション背景', 'オプション', 'settings-theme-aux-panel')}${sample('chat-message', 'チャット', 'メッセージ', '確認しました。', 'settings-theme-aux-panel')}
    ${sample('chat-input', 'チャット', '入力欄', 'メッセージを入力…', 'settings-theme-aux-panel')}
    ${sample('history', 'ヒストリー', '行背景', 'テーマを変更', 'settings-theme-aux-panel')}${sample('annotation', 'アノテート', 'カード背景', 'コメント 1件', 'settings-theme-aux-panel')}${sample('version', 'バージョン管理', '行背景', 'v12 · 14:32', 'settings-theme-aux-panel')}
  </section>`;
  return `<section class="settings-theme-preview-actual settings-theme-preview-popup-actual" aria-label="ポップアップと操作部品">
    <div class="settings-theme-popup-card">${sample('surface', '共通', 'ポップアップ', '操作メニュー', 'settings-theme-popup-title')}${sample('menu', '共通', 'ボタン', '開く', 'settings-theme-popup-item')}${sample('menu-hover', '共通', 'ボタンホバー', '名前を変更', 'settings-theme-popup-item is-hover')}${sample('menu-selected', '共通', 'ボタン選択', '選択中', 'settings-theme-popup-item is-selected')}</div>
    ${sample('tooltip', '共通', 'ツールチップ', 'ツールチップ', 'settings-theme-popup-tooltip')}${sample('input', '共通', '通常文字', '入力フィールド', 'settings-theme-popup-input')}${sample('link', '共通', 'リンク', '詳細を開く', 'settings-theme-popup-link')}${sampleMarkup('slider', '共通', 'スライダー', '<input type="range" min="0" max="100" value="36" disabled aria-hidden="true">', 'settings-theme-popup-slider')}
  </section>`;
}

function settingsThemePreviewManifest() {
  return SETTINGS_THEME_PREVIEW_APPS.flatMap(([appId, appLabel]) =>
    (SETTINGS_THEME_PREVIEW_SAMPLE_SPECS[appId] || []).map(([sampleId, section, label]) => {
        const index = (UI_STYLE_SECTIONS?.[section] || []).findIndex(def => def?.label === label);
        const def = index >= 0 ? UI_STYLE_SECTIONS[section][index] : null;
        if (!def) return null;
        const popupFields = typeof _settingsThemePreviewPopupFields === 'function'
          ? _settingsThemePreviewPopupFields(def)
          : [];
        return {
          id: `${appId}/${sampleId}`,
          appId,
          appLabel,
          section,
          index,
          label: def.label,
          state: _settingsThemePreviewStateClass(def.label) || 'default',
          popupFields,
          configurableKeys: [
            def.fg, def.bg, def.bold, def.italic, def.font, def.fontSize,
            def.line, def.width, def.stroke, def.strokeWidth,
            ...(Array.isArray(def.numbers) ? def.numbers.map(item => item?.key) : []),
          ].filter(Boolean),
        };
      }).filter(Boolean)
  );
}

function _settingsThemePreviewTarget(section, label, text, className = '', manifestId = '') {
  const def = (UI_STYLE_SECTIONS?.[section] || []).find(item => item.label === label);
  const style = def ? _settingsThemePreviewStyle(def) : '';
  const stableId = manifestId || `${section}/${label}`;
  const e2eId = `settings-theme-preview-${stableId}`;
  const actionTitle = `${label}（クリックで書式設定）`;
  return `<button type="button" class="settings-theme-preview-target ${className}" data-e2e-id="${esc(e2eId)}" data-style-id="${esc(stableId)}" data-style-section="${esc(section)}" data-style-label="${esc(label)}" data-action="openStylePreviewPopup(this)" title="${esc(actionTitle)}" aria-label="${esc(actionTitle)}" style="${esc(style)}">${esc(text || label)}</button>`;
}

function _settingsThemePreviewStateClass(label) {
  const value = String(label || '');
  if (/ホバー/.test(value)) return 'is-hover';
  if (/選択|今日|強調|実行中|保存\/復元|送信/.test(value)) return 'is-selected';
  return '';
}

function _settingsThemePreviewSurfaceAttributes(stableId, label, bgKey, targetId) {
  const actionTitle = `${label}（空白部分をクリックして背景色を設定）`;
  return ` data-e2e-id="${esc(`settings-theme-preview-${stableId}`)}" data-style-id="${esc(stableId)}" data-style-label="${esc(label)}" data-style-bg-key="${esc(bgKey)}" data-theme-ui-target-id="${esc(targetId)}" data-theme-ui-state-id="normal" data-style-preview-native="1" data-action="openStylePreviewPopup(this)" title="${esc(actionTitle)}"`;
}

function _settingsThemePreviewMain(appId) {
  const surface = SETTINGS_THEME_PREVIEW_APP_SURFACES[appId] || SETTINGS_THEME_PREVIEW_APP_SURFACES.note;
  const targetId = SETTINGS_THEME_PREVIEW_APP_SURFACE_TARGETS[appId] || SETTINGS_THEME_PREVIEW_APP_SURFACE_TARGETS.note;
  return `<div class="settings-theme-preview-all settings-theme-preview-panel-surface" data-style-preview-app="${esc(appId)}" data-style-preview-app-surface="1"${_settingsThemePreviewSurfaceAttributes(`surface/main/${appId}`, `${SETTINGS_THEME_PREVIEW_APPS.find(([id]) => id === appId)?.[1] || 'メイン'}パネルの背景`, surface.bg, targetId)} style="background:var(${esc(surface.bg)});color:var(${esc(surface.fg)});">${_settingsThemePreviewActualSurface(appId)}</div>`;
}

function _settingsThemePreviewTargetMarkup(section, label, markup, className = '', manifestId = '') {
  const def = (UI_STYLE_SECTIONS?.[section] || []).find(item => item.label === label);
  const style = def ? _settingsThemePreviewStyle(def) : '';
  const stableId = manifestId || `${section}/${label}`;
  const e2eId = `settings-theme-preview-${stableId}`;
  const actionTitle = `${label}（クリックで書式設定）`;
  return `<button type="button" class="settings-theme-preview-target ${className}" data-e2e-id="${esc(e2eId)}" data-style-id="${esc(stableId)}" data-style-section="${esc(section)}" data-style-label="${esc(label)}" data-action="openStylePreviewPopup(this)" title="${esc(actionTitle)}" aria-label="${esc(actionTitle)}" style="${esc(style)}">${markup}</button>`;
}

const SETTINGS_THEME_PREVIEW_LEFT_RAIL = Object.freeze([
  ['folder', 'フォルダ', 'folder'], ['note', 'ノート', 'page'], ['scriptnote', 'シナリオ', 'bookOpenText'],
  ['sheet', 'シート', 'db'], ['board', 'ボード', 'presentation'], ['calendar', 'スケジュール', 'calendar'],
]);

const SETTINGS_THEME_PREVIEW_RIGHT_RAIL = Object.freeze([
  ['options', 'オプション', 'slidersHorizontal'], ['viewer', 'ビューワー', 'tvMinimal'],
  ['subpanel', 'サブパネル', 'panelRightDashed'], ['properties', 'プロパティ', 'info'],
  ['tags', 'タグ', 'tag'], ['backlinks', 'バックリンク', 'fileSymlink'],
  ['annotation', 'アノテート', 'squarePen'], ['theme', 'テーマ', 'palette'],
  ['history', 'ヒストリー', 'history'], ['version', 'バージョン管理', 'gitBranch'],
  ['chat', 'チャット', 'messagesSquare'], ['memo', 'クイックメモ', 'notebookPen'],
]);

function _settingsThemePreviewThemeUiTarget(stableId, section, label) {
  const id = String(stableId || '');
  if (/^folder\/(card|border|hover|selected)$/.test(id)) return 'folder-panel-folder';
  if (id.startsWith('chrome/rail/')) return 'collapse-button';
  if (id.startsWith('chrome/pane/tab/')) return 'panel-tab';
  if (id.startsWith('chrome/sheet/view/')) return 'inner-tab';
  if (id.startsWith('chrome/tree/heading/')) return 'folder-section';
  if (id.startsWith('chrome/tree/item/') || id.startsWith('chrome/tree/selected/')) return 'folder-tree-folder';
  if (id === 'chrome/tree/panel') return 'surface-outliner';
  if (section === '共通' && /ボタン/.test(label || '')) return 'button';
  return '';
}

function _settingsThemePreviewInteractiveAttributes(stableId, section, label, action = 'openStylePreviewPopup(this)') {
  const themeUiTarget = _settingsThemePreviewThemeUiTarget(stableId, section, label);
  const themeUiState = /選択/.test(label || '') ? 'selected' : (/ホバー/.test(label || '') ? 'hover' : 'normal');
  const themeUiAttrs = themeUiTarget
    ? ` data-theme-ui-target-id="${esc(themeUiTarget)}" data-theme-ui-state-id="${esc(themeUiState)}"`
    : '';
  return ` data-e2e-id="${esc(`settings-theme-preview-${stableId}`)}" data-style-id="${esc(stableId)}" data-style-section="${esc(section)}" data-style-label="${esc(label)}" data-style-preview-native="1"${themeUiAttrs} data-action="${esc(action)}"`;
}

const SETTINGS_THEME_PREVIEW_MAIN_TABS = Object.freeze({
  folder: ['フォルダ', 'folder'],
  note: ['テーマプレビュー.md', 'page'],
  scriptnote: ['第一話.scriptnote', 'bookOpenText'],
  sheet: ['制作管理', 'db'],
  board: ['ボード', 'presentation'],
  calendar: ['スケジュール', 'calendar'],
  aux: ['補助パネル', 'panelRightDashed'],
  popup: ['ポップアップ', 'panelTop'],
});

function _settingsThemePreviewPaneTabs(paneId, label, iconName, options = {}) {
  const tabAttrs = _settingsThemePreviewInteractiveAttributes(`chrome/pane/tab/${paneId}`, '共通', 'パネル内タブ 選択');
  const navButton = (direction, icon, text) => `<button type="button" class="gb-pane-nav-btn" aria-disabled="true"${_settingsThemePreviewInteractiveAttributes(`chrome/pane/nav/${paneId}/${direction}`, '共通', 'ボタン')} title="${esc(`${text}／クリックで書式設定`)}" aria-label="${esc(`${text}ボタンの書式設定`)}">${lucide(icon, 18)}</button>`;
  const more = options.more ? `<button type="button" class="gb-tab-more"${_settingsThemePreviewInteractiveAttributes(`chrome/pane/more/${paneId}`, '共通', 'ボタン')} title="タブメニュー／クリックで書式設定" aria-label="タブメニューボタンの書式設定">${lucide('ellipsis', 14)}</button>` : '';
  const add = options.add ? `<button type="button" class="gb-pane-btn gb-pane-add-tab"${_settingsThemePreviewInteractiveAttributes(`chrome/pane/add/${paneId}`, '共通', 'ボタン')} title="タブを追加／クリックで書式設定" aria-label="タブ追加ボタンの書式設定">${lucide('plus', 16)}</button>` : '';
  return `<div class="gb-pane-tabs settings-theme-preview-pane-tabs" role="tablist" aria-label="${esc(`${label}のタブ`)}">
    <span class="gb-pane-nav-ctrls">${navButton('back', 'arrowLeft', '戻る')}${navButton('forward', 'arrowRight', '進む')}</span>
    <div class="gb-pane-tabs-scroll"><div class="gb-tab active settings-theme-preview-hotspot" role="tab" aria-selected="true" tabindex="0"${tabAttrs} title="${esc(`${label}／クリックで書式設定`)}"><span class="gb-tab-icon">${lucide(iconName, 14)}</span><span class="gb-tab-label">${esc(label)}</span>${more}</div></div>
    ${add}
  </div>`;
}

function _settingsThemePreviewMainPane(appId) {
  const [label, iconName] = SETTINGS_THEME_PREVIEW_MAIN_TABS[appId] || SETTINGS_THEME_PREVIEW_MAIN_TABS.note;
  return `${_settingsThemePreviewPaneTabs(`main/${appId}`, label, iconName, { more: true, add: true })}${_settingsThemePreviewMain(appId)}`;
}

function _settingsThemePreviewSetRailStyleState(button, active) {
  if (!button) return;
  button.dataset.styleSection = '共通';
  button.dataset.styleLabel = active ? 'ボタン選択' : 'ボタン';
  button.dataset.themeUiTargetId = 'collapse-button';
  button.dataset.themeUiStateId = active ? 'selected' : 'normal';
}

function _settingsThemePreviewRailButton(side, id, label, iconName, activeId) {
  const icon = typeof lucide === 'function' ? lucide(iconName, side === 'left' ? 20 : 18) : '';
  const separator = ['subpanel', 'theme', 'version'].includes(id) ? ' gb-rail-separator-after' : '';
  const paletteIndex = side === 'left' ? Math.max(0, SETTINGS_THEME_PREVIEW_LEFT_RAIL.findIndex(([railId]) => railId === id)) : '';
  const active = id === activeId;
  const styleAttrs = _settingsThemePreviewInteractiveAttributes(
    `chrome/rail/${side}/${id}`,
    '共通',
    active ? 'ボタン選択' : 'ボタン',
    `settingsThemePreviewRailChanged('${side}','${id}',this)`,
  );
  return `<button type="button" class="gb-dock-icon${side === 'left' ? ' gb-dock-rail-app' : ''}${active ? ' active' : ''}${separator}"${side === 'left' ? ` data-theme-rail-palette-index="${paletteIndex}"` : ''} data-preview-rail-side="${esc(side)}" data-preview-rail-id="${esc(id)}"${styleAttrs} title="${esc(`${label}／クリックで書式設定`)}" aria-label="${esc(label)}" aria-pressed="${active ? 'true' : 'false'}">${icon}</button>`;
}

function _settingsThemePreviewTree() {
  const treeRow = (label, iconName, options = {}) => `<div class="tree-node${options.child ? ' settings-theme-tree-child' : ''}"><div class="tree-node-row settings-theme-preview-hotspot ${options.folder ? 'folder-row' : 'file-row'}${options.selected ? ' selected active' : ''}" role="treeitem" tabindex="0"${options.folder ? ' aria-expanded="true"' : ''}${_settingsThemePreviewInteractiveAttributes(`chrome/tree/${options.selected ? 'selected' : 'item'}/${label}`, 'フォルダツリー', options.selected ? '項目選択' : '項目')} title="${esc(`${label}／クリックで書式設定`)}">
    <span class="tree-toggle${options.folder ? ' expanded' : ''}">${options.folder ? lucide('chevronRight', 13) : ''}</span>
    <span class="tree-icon">${lucide(iconName, 15)}</span><span class="tree-label">${esc(label)}</span>
  </div></div>`;
  const sectionHeader = (id, label, expanded = false) => `<div class="sidebar-section-header settings-theme-preview-hotspot" role="button" tabindex="0"${_settingsThemePreviewInteractiveAttributes(`chrome/tree/heading/${id}`, 'フォルダツリー', '見出し')} title="${esc(`${label}／クリックで書式設定`)}"><span class="sidebar-section-toggle${expanded ? ' expanded' : ''}">${lucide('chevronRight', 13)}</span><span class="sidebar-section-label">${esc(label)}</span></div>`;
  return `<div class="gb-tool-outliner settings-theme-preview-outliner settings-theme-preview-panel-surface" data-settings-theme-outliner data-settings-theme-preview-tree-content="folder"${_settingsThemePreviewSurfaceAttributes('surface/tree', 'フォルダツリーパネルの背景', '--outliner-bg', 'surface-outliner')}>
    <div class="settings-theme-outliner-search"><button type="button" class="tb-icon-btn"${_settingsThemePreviewInteractiveAttributes('chrome/tree/search', '共通', 'ボタン')} tabindex="-1" aria-label="検索の書式設定" title="検索／クリックで書式設定">${lucide('search', 15)}</button><span>エントリも検索</span><button type="button" class="tb-icon-btn"${_settingsThemePreviewInteractiveAttributes('chrome/tree/filter', '共通', 'ボタン')} tabindex="-1" aria-label="絞り込みの書式設定" title="絞り込み／クリックで書式設定">${lucide('filter', 15)}</button></div>
    ${sectionHeader('recent', '最近使った項目')}
    ${sectionHeader('favorites', 'お気に入り')}
    ${sectionHeader('source', 'ソースフォルダ', true)}
    <div class="sidebar-section-body" role="tree" aria-label="ソースフォルダ">
      ${treeRow('Meldex プロジェクト', 'folderOpen', { folder: true })}
      <div class="tree-children">${treeRow('原稿', 'folderOpen', { folder: true, child: true })}${treeRow('第一話.md', 'fileText', { child: true, selected: true })}${treeRow('資料', 'folder', { folder: true, child: true })}</div>
    </div>
  </div>`;
}

function _settingsThemePreviewSide(panelId) {
  const panels = {
    options: ['オプション', '表示', '編集', 'ファイル情報'],
    viewer: ['ビューワー', 'ページプレビュー', '100%', '前へ　次へ'],
    subpanel: ['サブパネル', 'フォルダツリー', 'ビューワー', 'チャット'],
    properties: ['プロパティ', '種類　ノート', '更新　今日 14:32', '文字数　1,248'],
    tags: ['タグ', '# 重要', '# 第1話', '+ タグを追加'],
    backlinks: ['バックリンク', '企画メモ.md', '第2話.md', '2件の参照'],
    annotation: ['アノテート', 'コメント 1件', '選択範囲を確認', '解決済みにする'],
    theme: ['テーマ', 'ダーク', '共通パレット', 'アクセントカラー'],
    history: ['ヒストリー', '14:32 テーマを変更', '14:28 見出しを編集', '元に戻す'],
    version: ['バージョン管理', 'v12 現在', 'v11 今日 14:20', '復元ポイントを作成'],
    chat: ['チャット', '確認しました。', '修正箇所を共有します。', 'メッセージを入力…'],
    memo: ['クイックメモ', '次回確認すること', '・見出しの余白', 'メモを追加…'],
  };
  const rows = panels[panelId] || panels.options;
  const surface = SETTINGS_THEME_PREVIEW_SIDE_SURFACES[panelId] || SETTINGS_THEME_PREVIEW_SIDE_SURFACES.options;
  const palette = panelId === 'theme' ? '<div class="settings-theme-side-swatches"><i></i><i></i><i></i><i></i></div>' : '';
  return `<div class="settings-theme-preview-side-panel settings-theme-preview-panel-surface" data-settings-theme-preview-side-content="${esc(panelId)}"${_settingsThemePreviewSurfaceAttributes(`surface/side/${panelId}`, `${rows[0]}パネルの背景`, surface.bg, surface.targetId)} style="background:var(${esc(surface.bg)});">
    <div class="gb-panel-header"><div class="gb-panel-title">${esc(rows[0])}</div></div>
    <div class="gb-panel-body gb-panel-body-scroll gb-panel-body-padded">${palette}
      ${rows.slice(1).map((row, index) => `<button type="button" class="gb-btn${index === 0 ? ' active' : ''}"${_settingsThemePreviewInteractiveAttributes(`chrome/side/${panelId}/${index}`, '共通', index === 0 ? 'ボタン選択' : 'ボタン')} tabindex="-1" aria-label="${esc(row)}の書式設定" title="${esc(`${row}／クリックで書式設定`)}">${esc(row)}</button>`).join('')}
    </div>
  </div>`;
}

function _settingsThemePreviewSidePane(panelId) {
  const [, label = 'オプション', iconName = 'slidersHorizontal'] = SETTINGS_THEME_PREVIEW_RIGHT_RAIL.find(([id]) => id === panelId) || [];
  return `${_settingsThemePreviewPaneTabs(`side/${panelId}`, label, iconName)}${_settingsThemePreviewSide(panelId)}`;
}

function _settingsThemePreviewRail(side, activeId) {
  const isLeft = side === 'left';
  const rail = isLeft ? SETTINGS_THEME_PREVIEW_LEFT_RAIL : SETTINGS_THEME_PREVIEW_RIGHT_RAIL;
  const bottomIds = new Set(['chat', 'memo']);
  const topButtons = rail.filter(([id]) => isLeft || !bottomIds.has(id));
  const bottomButtons = isLeft ? [] : rail.filter(([id]) => bottomIds.has(id));
  const toggleIcon = lucide(isLeft ? 'panelLeftClose' : 'panelRightClose', 18);
  return `<aside class="settings-theme-preview-rail settings-theme-preview-rail--${side} settings-theme-preview-panel-surface gb-dock-bar gb-dock-bar-fixed gb-dock-bar-${side}" aria-label="${isLeft ? 'アプリ切替' : '補助パネル切替'}"${_settingsThemePreviewSurfaceAttributes(`surface/rail/${side}`, `${isLeft ? '左' : '右'}レールの背景`, '--ui-dockbar-bg', 'surface-dock')}>
    <div class="gb-rail-shell-top"><button type="button" class="gb-dock-icon gb-dock-rail-toggle" data-preview-panel-toggle="${side}"${_settingsThemePreviewInteractiveAttributes(`chrome/rail/${side}/toggle`, '共通', 'ボタン', `settingsThemePreviewPanelToggle('${side}',this)`)} title="${isLeft ? '左サイドバー' : '右サイドバー'}を閉じる／クリックで書式設定" aria-label="${isLeft ? '左サイドバー' : '右サイドバー'}を閉じる" aria-expanded="true">${toggleIcon}</button><div class="gb-dock-rail-separator"></div></div>
    <div class="gb-rail-shell-scroll">${topButtons.map(([id, label, icon]) => _settingsThemePreviewRailButton(side, id, label, icon, activeId)).join('')}</div>
    <div class="gb-rail-shell-bottom">${bottomButtons.map(([id, label, icon]) => _settingsThemePreviewRailButton(side, id, label, icon, activeId)).join('')}</div>
  </aside>`;
}

function renderSettingsThemePreview(appId = 'note') {
  const leftId = SETTINGS_THEME_PREVIEW_LEFT_RAIL.some(([id]) => id === appId) ? appId : _settingsThemePreviewLeftRailId;
  _settingsThemePreviewLeftRailId = leftId;
  const options = SETTINGS_THEME_PREVIEW_APPS.map(([id, label]) => `<option value="${id}"${id === appId ? ' selected' : ''}>${label}</option>`).join('');
  return `<section class="gb-section gb-section--boxed settings-theme-preview" data-settings-theme-preview="1">
    <div class="settings-theme-preview-toolbar">
      <div class="gb-section-title">プレビュー</div>
      <div class="settings-theme-preview-toolbar-actions">
        <select class="gb-select" data-e2e-id="settings-theme-preview-app" data-settings-theme-preview-select data-onchange="settingsThemePreviewAppChanged(this.value)">${options}</select>
        <button type="button" class="gb-btn settings-theme-preview-details-btn" aria-expanded="false" data-action="settingsThemeToggleDetails(this)">詳細設定を開く</button>
      </div>
    </div>
    <div class="settings-theme-preview-shell">
      ${_settingsThemePreviewRail('left', leftId)}
      <aside class="settings-theme-preview-tree" data-settings-theme-preview-tree>${_settingsThemePreviewPaneTabs('tree', 'フォルダツリー', 'folderTree')}${_settingsThemePreviewTree()}</aside>
      <main class="settings-theme-preview-main" data-settings-theme-preview-main>${_settingsThemePreviewMainPane(appId)}</main>
      <aside class="settings-theme-preview-side" data-settings-theme-preview-side>${_settingsThemePreviewSidePane(_settingsThemePreviewRightRailId)}</aside>
      ${_settingsThemePreviewRail('right', _settingsThemePreviewRightRailId)}
    </div>
  </section>`;
}

function _activeSettingsThemePreviewRoot() {
  const roots = [...document.querySelectorAll('[data-settings-theme-preview]')];
  return roots.find(root => {
    const panel = root.closest('.settings-panel[data-panel="テーマ"]');
    return panel && !panel.hidden && getComputedStyle(panel).display !== 'none';
  }) || roots[0] || null;
}

const SETTINGS_THEME_PREVIEW_SHARED_SELECTOR_MAP = Object.freeze([
  ['#page-content', '[data-settings-theme-note-content]'],
  ['#folder-grid', '[data-settings-theme-folder-grid]'],
  ['#sidebar', '[data-settings-theme-outliner]'],
]);

function _settingsThemePreviewAliasSelector(selectorText) {
  return String(selectorText || '').split(',').map(selector => selector.trim()).flatMap(selector => {
    const matches = SETTINGS_THEME_PREVIEW_SHARED_SELECTOR_MAP.filter(([source]) => selector.includes(source));
    if (!matches.length) return [];
    let mapped = selector;
    matches.forEach(([source, target]) => { mapped = mapped.split(source).join(target); });
    return [mapped];
  }).join(',');
}

function _settingsThemePreviewSharedRuleText(rule) {
  if (!rule) return '';
  if (rule.type === 1 && rule.selectorText) {
    const selector = _settingsThemePreviewAliasSelector(rule.selectorText);
    return selector ? `${selector}{${rule.style?.cssText || ''}}` : '';
  }
  let childRules = null;
  try { childRules = rule.cssRules ? [...rule.cssRules] : null; } catch { childRules = null; }
  if (!childRules?.length) return '';
  const inner = childRules.map(_settingsThemePreviewSharedRuleText).filter(Boolean).join('\n');
  if (!inner) return '';
  const cssText = String(rule.cssText || '');
  const brace = cssText.indexOf('{');
  const prefix = brace >= 0 ? cssText.slice(0, brace).trim() : '';
  return prefix ? `${prefix}{${inner}}` : inner;
}

function _settingsThemePreviewEnsureSharedStyles(root) {
  if (!root || root.querySelector('[data-settings-theme-shared-styles]')) return;
  const chunks = [];
  [...document.styleSheets].forEach(sheet => {
    let rules = null;
    try { rules = sheet.cssRules ? [...sheet.cssRules] : null; } catch { rules = null; }
    if (rules?.length) chunks.push(...rules.map(_settingsThemePreviewSharedRuleText).filter(Boolean));
  });
  const style = document.createElement('style');
  style.dataset.settingsThemeSharedStyles = '1';
  style.textContent = chunks.join('\n');
  root.prepend(style);
}

function _bindSettingsThemePreviewHotspots(root) {
  root?.querySelectorAll?.('.settings-theme-preview-hotspot').forEach(target => {
    if (target.dataset.settingsThemeHotspotBound === '1') return;
    target.dataset.settingsThemeHotspotBound = '1';
    target.addEventListener('keydown', event => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      event.stopPropagation();
      window.openStylePreviewPopup?.(target);
    });
  });
}

function settingsThemePreviewPanelToggle(side, previewTarget = null) {
  if (!['left', 'right'].includes(side)) return;
  const root = _activeSettingsThemePreviewRoot();
  if (!root) return;
  const className = `settings-theme-preview-${side}-collapsed`;
  const collapsed = root.classList.toggle(className);
  const button = root.querySelector(`[data-preview-panel-toggle="${side}"]`);
  if (!button) return;
  const sideLabel = side === 'left' ? '左サイドバー' : '右サイドバー';
  const label = `${sideLabel}を${collapsed ? '開く' : '閉じる'}`;
  button.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
  button.setAttribute('aria-label', label);
  button.title = label;
  button.innerHTML = lucide(side === 'left'
    ? (collapsed ? 'panelLeftOpen' : 'panelLeftClose')
    : (collapsed ? 'panelRightOpen' : 'panelRightClose'), 18);
  if (previewTarget) window.openStylePreviewPopup?.(previewTarget);
}

function settingsThemePreviewAppChanged(appId) {
  const root = _activeSettingsThemePreviewRoot();
  const main = root?.querySelector('[data-settings-theme-preview-main]');
  if (!main) return;
  _settingsThemePreviewAppId = appId;
  const select = root.querySelector('[data-settings-theme-preview-select]');
  if (select && [...select.options].some(option => option.value === appId)) select.value = appId;
  main.innerHTML = _settingsThemePreviewMainPane(appId);
  _bindSettingsThemePreviewHotspots(main);
  root.dataset.settingsThemePreviewApp = appId;
  const panel = root.closest('.settings-panel[data-panel="テーマ"]');
  if (panel) panel.dataset.settingsThemePreviewApp = appId;
  const stateCoverage = panel?.querySelector('[data-settings-theme-state-coverage]');
  if (stateCoverage) {
    stateCoverage.innerHTML = _settingsThemeStateMatrix(appId);
    _bindSettingsThemeStateTargets(stateCoverage);
  }
  if (SETTINGS_THEME_PREVIEW_LEFT_RAIL.some(([id]) => id === appId)) {
    _settingsThemePreviewLeftRailId = appId;
  }
  root.querySelectorAll('[data-preview-rail-side="left"]').forEach(btn => {
    const active = btn.dataset.previewRailId === _settingsThemePreviewLeftRailId;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    _settingsThemePreviewSetRailStyleState(btn, active);
  });
}

function settingsThemePreviewRailChanged(side, id, previewTarget = null) {
  const root = _activeSettingsThemePreviewRoot();
  if (!root) return;
  if (side === 'left') {
    if (!SETTINGS_THEME_PREVIEW_LEFT_RAIL.some(([railId]) => railId === id)) return;
    _settingsThemePreviewLeftRailId = id;
    settingsThemePreviewAppChanged(id);
  } else {
    if (!SETTINGS_THEME_PREVIEW_RIGHT_RAIL.some(([railId]) => railId === id)) return;
    _settingsThemePreviewRightRailId = id;
    const sidePanel = root.querySelector('[data-settings-theme-preview-side]');
    if (sidePanel) {
      sidePanel.innerHTML = _settingsThemePreviewSidePane(id);
      _bindSettingsThemePreviewHotspots(sidePanel);
    }
  }
  root.querySelectorAll(`[data-preview-rail-side="${side}"]`).forEach(btn => {
    const active = btn.dataset.previewRailId === id;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    _settingsThemePreviewSetRailStyleState(btn, active);
  });
  if (previewTarget) window.openStylePreviewPopup?.(previewTarget);
}

function refreshSettingsThemePreview() {
  const root = _activeSettingsThemePreviewRoot();
  if (!root) return;
  _settingsThemeSyncAccentSwatch();
  const appId = root.querySelector('[data-settings-theme-preview-select]')?.value
    || root.dataset.settingsThemePreviewApp
    || _settingsThemePreviewAppId;
  const main = root.querySelector('[data-settings-theme-preview-main]');
  if (main) {
    main.innerHTML = _settingsThemePreviewMainPane(appId);
    _bindSettingsThemePreviewHotspots(main);
  }
  root.querySelectorAll('[data-style-section][data-style-label]').forEach(target => {
    if (target.dataset.stylePreviewNative === '1') return;
    const section = target.dataset.styleSection;
    const label = target.dataset.styleLabel;
    const def = (UI_STYLE_SECTIONS?.[section] || []).find(item => item.label === label);
    if (def) target.setAttribute('style', _settingsThemePreviewStyle(def));
  });
  root.querySelectorAll('[data-preview-rail-side]').forEach(btn => {
    const side = btn.dataset.previewRailSide;
    const activeId = side === 'left' ? _settingsThemePreviewLeftRailId : _settingsThemePreviewRightRailId;
    const active = btn.dataset.previewRailId === activeId;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    _settingsThemePreviewSetRailStyleState(btn, active);
  });
  _settingsThemePreviewEnsureSharedStyles(root);
}

function _bindSettingsThemeStateTargets(root) {
  root?.querySelectorAll?.('[data-theme-state-id]').forEach(target => {
    if (target.dataset.themeStateBound === '1') return;
    target.dataset.themeStateBound = '1';
    target.addEventListener('click', event => {
      event.stopPropagation();
      const preview = target.closest('[data-settings-theme-preview], [data-settings-theme-workspace]');
      const targetId = target.dataset.themeStateId;
      if (!preview || !targetId || preview.dataset.themeStatePopupPending === targetId) return;
      preview.dataset.themeStatePopupPending = targetId;
      setTimeout(() => {
        const currentTarget = [...preview.querySelectorAll('[data-theme-state-id]')]
          .find(candidate => candidate.dataset.themeStateId === targetId);
        delete preview.dataset.themeStatePopupPending;
        if (preview.isConnected && currentTarget?.isConnected && !document.querySelector('.gb-fmt-popup')) {
          window.openStylePreviewPopup?.(currentTarget);
        }
      }, 0);
    });
  });
}

function settingsThemeToggleDetails(button) {
  const details = button?.closest?.('.settings-theme-workspace')?.querySelector?.('[data-settings-theme-details]');
  if (!details) return;
  details.hidden = !details.hidden;
  button.setAttribute('aria-expanded', details.hidden ? 'false' : 'true');
  const label = details.hidden ? '詳細設定を開く' : '詳細設定を閉じる';
  button.textContent = label;
  button.setAttribute('aria-label', label);
}

function renderSettingsAppearancePanel(currentTheme, options = {}) {
  const themeOptions = typeof MeldexThemeManager !== 'undefined'
    ? MeldexThemeManager.themeOptionsHtml(currentTheme)
    : Object.keys(THEME_PRESETS).map(n => '<option value="' + esc(n) + '"' + (n === currentTheme ? ' selected' : '') + '>' + esc(n) + '</option>').join('');
  return `<div class="settings-theme-workspace" data-settings-theme-workspace="1">
    <section class="gb-section gb-section--boxed" data-settings-view="theme" data-settings-theme-summary="1">
      <div class="gb-section-title">${lucide('palette', 14)} テーマ</div>
      <div class="gb-field-row" style="align-items:center;">
        <select id="modal-theme-preset" data-onchange="settingsThemeSelect(this.value)" class="gb-select" style="flex:1;min-width:180px;">
          ${themeOptions}
        </select>
        ${_settingsThemeMenuButton()}
      </div>
    </section>
    <section class="gb-section gb-section--boxed settings-theme-controls" data-settings-view="theme">
      <div class="gb-section-title">共通カラーパレット</div>
      ${typeof renderSettingsThemePaletteEditor === 'function' ? renderSettingsThemePaletteEditor({ id: 'settings-theme-palette-editor' }) : renderThemeColorSetEditor(null, { hideLabel: true })}
      ${renderSettingsThemeAccentEditor()}
    </section>
    <div class="settings-theme-details" data-settings-theme-details hidden>
    <section class="gb-section gb-section--boxed" data-settings-view="theme" data-settings-theme-apply-editor="1">
      <div class="gb-section-title">自動色の強さ</div>
      ${typeof renderThemeUiAutoToneControls === 'function' ? renderThemeUiAutoToneControls() : ''}
    </section>
    <!-- 「テーマカラーの自動適用設定」の対象別ピッカーは、下の「アプリ別テーマ」タブ群
         （共通/フォルダ/ノート/シナリオ/シート/ボード/スケジュール/補助パネル）で
         全ターゲットを重複なく網羅している。以前はここに全ターゲット横断の一覧を
         フィルタなしで別途表示しており、アプリ別タブと同じ data-e2e-id を持つ行が
         同時に2つ描画されていた（2026-08-05 v0.7.151でテーマ詳細設定ダイアログを
         サブタブへ統合した際、旧「連番配色」タブと旧「アプリ別」タブが排他表示
         ではなくなり重複が顕在化。2026-08-13 バグ報告で確認・削除）。 -->
    <section class="gb-section gb-section--boxed" data-settings-view="theme">
      <div class="gb-section-title">基本の面</div>
      ${_renderSettingsThemeDetailStyleGroups('surface')}
    </section>
    ${_renderSettingsThemeCommonFontSection()}
    <section class="gb-section gb-section--boxed" data-settings-view="theme">
      <div class="gb-section-title">文字</div>
      ${_renderSettingsThemeDetailStyleGroups('text')}
    </section>
    <section class="gb-section gb-section--boxed" data-settings-view="theme">
      <div class="gb-section-title">操作状態</div>
      ${_renderSettingsThemeDetailStyleGroups('state')}
    </section>
    <div class="settings-theme-state-coverage-panel" data-settings-theme-state-coverage>
      ${_settingsThemeStateMatrix(options.previewApp || 'note')}
    </div>
    <section class="gb-section gb-section--boxed" data-settings-view="theme">
      <div class="gb-section-title">装飾</div>
      ${_renderSettingsThemeDetailStyleGroups('ornament')}
    </section>
    <section class="gb-section gb-section--boxed" data-settings-view="theme">
      <div class="gb-section-title">アプリ別テーマ</div>
      ${renderSettingsThemeEditor(options.activeStyleTab, {
        deferStyleRows: options.deferStyleRows,
        renderedStyleTab: options.renderedStyleTab,
      })}
    </section></div>
    ${renderSettingsThemePreview(options.previewApp || 'note')}
  </div>`;
}

function ensureSettingsThemePanel(panel, options = {}) {
  const root = panel?.matches?.('.settings-panel[data-panel="テーマ"]')
    ? panel
    : panel?.querySelector?.('.settings-panel[data-panel="テーマ"]');
  if (!root) return;
  const selectedId = options.selectedId || root.dataset.settingsThemeSelectedId || _settingsThemeCurrentId();
  const previewApp = options.previewApp
    || root.dataset.settingsThemePreviewApp
    || root.querySelector?.('[data-settings-theme-preview-select]')?.value
    || _settingsThemePreviewAppId;
  const activeStyleTab = options.activeStyleTab || root.dataset.settingsThemeActiveStyleTab || _settingsThemeActiveStyleTab(root);
  const hasRenderedStyleTab = Object.prototype.hasOwnProperty.call(options, 'renderedStyleTab');
  const renderedStyleTab = hasRenderedStyleTab
    ? String(options.renderedStyleTab || '')
    : (root.querySelector?.('[data-settings-theme-style-panel][data-settings-theme-style-rendered="1"]')?.dataset?.settingsThemeStylePanel || '');
  const hasDeferStyleRows = Object.prototype.hasOwnProperty.call(options, 'deferStyleRows');
  const deferStyleRows = options.deferStyleRows === true
    || (!hasDeferStyleRows && root.dataset.settingsThemeRendered !== '1' && !renderedStyleTab);
  if (options.force !== true && root.dataset.settingsThemeRendered === '1' && root.querySelector('[data-settings-theme-summary="1"]')) {
    const preview = root.querySelector('[data-settings-theme-preview]');
    _settingsThemePreviewEnsureSharedStyles(preview);
    _bindSettingsThemePreviewHotspots(preview);
    return;
  }
  root.innerHTML = renderSettingsAppearancePanel(selectedId, {
    activeStyleTab,
    deferStyleRows,
    renderedStyleTab,
    previewApp,
  });
  root.dataset.settingsThemeRendered = '1';
  root.dataset.settingsThemeSelectedId = selectedId || '';
  root.dataset.settingsThemeActiveStyleTab = activeStyleTab || '';
  root.dataset.settingsThemePreviewApp = previewApp;
  bindSettingsThemePanel(root);
  if (typeof replaceIcons === 'function') replaceIcons(root);
  const preview = root.querySelector('[data-settings-theme-preview]');
  _settingsThemePreviewEnsureSharedStyles(preview);
  _bindSettingsThemePreviewHotspots(preview);
  _settingsThemeReapplyNavigationView(root);
}

// 再描画で innerHTML を差し替えた後、選択中サブタブの表示フィルタを掛け直す
// （force 再描画時は全セクションが可視状態で吐き出されるため）
function _settingsThemeReapplyNavigationView(panel) {
  const modal = panel?.closest?.('.settings-modal')
    || document.querySelector('.modal-overlay[data-settings-modal="1"] .settings-modal');
  if (!modal || typeof _applySettingsNavigationView !== 'function' || typeof resolveSettingsNavigationTarget !== 'function') return;
  if ((modal.dataset.settingsActiveTabId || '') !== 'テーマ') return;
  const target = resolveSettingsNavigationTarget('テーマ', { pageId: modal.dataset.settingsActivePageId || '' });
  _applySettingsNavigationView(modal, target);
}

function _settingsThemeCurrentId() {
  if (typeof MeldexThemeManager !== 'undefined' && typeof MeldexThemeManager.getDefaultThemeId === 'function') {
    return MeldexThemeManager.getDefaultThemeId();
  }
  return detectCurrentTheme();
}

function _settingsThemeCurrent() {
  if (typeof MeldexThemeManager === 'undefined') return null;
  return MeldexThemeManager.getThemeById(_settingsThemeCurrentId());
}

function _settingsThemeIsCustom(id) {
  if (typeof MeldexThemeManager === 'undefined') return false;
  const themeId = id || _settingsThemeCurrentId();
  return MeldexThemeManager.getCustomThemes().some(t => t.id === themeId);
}

const SETTINGS_THEME_STYLE_TABS = [
  '共通', 'フォルダ', 'ノート', 'シナリオ', 'シート', 'ボード', 'スケジュール',
  '補助パネル',
];
const SETTINGS_THEME_STYLE_AUTO_TARGETS = {
  'フォルダ': ['surface-folder', 'style-folder', 'folder-panel-folder'],
  'ノート': ['surface-note', 'style-note', 'note-heading', 'note-toc-item'],
  'シナリオ': ['surface-scriptnote', 'style-scriptnote', 'scriptnote-type-dialogue', 'scriptnote-type-action', 'scriptnote-type-heading', 'scriptnote-type-summary', 'scriptnote-type-break'],
  'シート': ['surface-sheet', 'style-sheet'],
  'ボード': ['surface-board', 'style-board'],
  'スケジュール': ['surface-calendar', 'style-calendar'],
  '補助パネル': ['surface-outliner', 'surface-preview', 'surface-detail', 'surface-chat', 'surface-history', 'surface-annotation', 'surface-search', 'surface-version', 'style-outliner', 'folder-tree-folder', 'style-preview', 'style-detail', 'style-chat', 'style-history', 'style-annotation', 'style-search', 'style-version'],
};

function _settingsThemeStyleTabNames() {
  return SETTINGS_THEME_STYLE_TABS.filter(name => Array.isArray(UI_STYLE_SECTIONS?.[name]));
}

function _settingsThemeSubsection(title, body) {
  if (!body) return '';
  return `<section class="gb-section gb-section--detail settings-theme-subsection">
    <div class="gb-section-title">${esc(title)}</div>
    ${body}
  </section>`;
}

function _settingsThemePxValue(key, fallback) {
  const raw = getCssVar(key) || fallback || '';
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : parseFloat(fallback) || 0;
}

function _renderSettingsThemeNoteLayoutRows() {
  const margin = _settingsThemePxValue('--page-margin-x', '50px');
  const maxWidth = _settingsThemePxValue('--page-content-max-width', '1200px');
  return _settingsThemeSubsection('レイアウト', `<label class="gb-field-row settings-theme-note-layout-row">
    <span class="gb-label">余白 ${fieldHelp('本文の行の左右に空ける余白です。横書きでは左右、縦書きでは上下に効きます', { e2eId: 'settings-theme-note-padding-help' })}</span>
    <input id="settings-note-margin-x" type="number" min="0" max="300" step="1" class="gb-input-sm settings-theme-note-margin-input" value="${esc(margin)}" data-onchange="settingsThemeNoteMarginChanged(this.value)">
    <span class="gb-label">px</span>
  </label>
  <label class="gb-field-row settings-theme-note-layout-row">
    <span class="gb-label">内容最大幅</span>
    <input id="settings-note-content-max-width" type="number" min="480" max="3200" step="10" class="gb-input-sm settings-theme-note-width-input" value="${esc(maxWidth)}" data-onchange="settingsThemeNoteContentMaxWidthChanged(this.value)">
    <span class="gb-label">px</span>
  </label>`);
}

function _renderSettingsThemeStyleAutoRows(name) {
  const targetIds = SETTINGS_THEME_STYLE_AUTO_TARGETS[name];
  if (!targetIds) return '';
  return _settingsThemeSubsection('テーマカラーの自動適用設定', renderThemeUiApplicationEditor({ hideLabel: true, targetIds, showReset: false }));
}

// 共通タブと重複するため、個別パネルタブから除外するラベル
const _COMMON_DUPLICATE_STYLE_LABELS = new Set(['カーソル', 'ホバー', '選択', 'テキスト選択']);

function _filterCommonDuplicates(defs, name) {
  if (!Array.isArray(defs)) return [];
  if (name === '共通') return defs;
  return defs.filter(d => !_COMMON_DUPLICATE_STYLE_LABELS.has(String(d?.label || '').trim()));
}

function _renderSettingsThemeBoardExtras() {
  const shadowRaw = (getCssVar('--bd-shadow') || '').trim();
  const shadowOn = shadowRaw !== '' && shadowRaw !== '0';
  const autoAlignRaw = (getCssVar('--bd-auto-align') || '').trim();
  // defaultOn: 値未設定時はオン扱い
  const autoAlignOn = autoAlignRaw !== '0';
  const fitRaw = (getCssVar('--bd-bg-image-fit') || '').trim() || 'contain';
  const fits = [
    ['contain', '全体表示'],
    ['cover', '埋める'],
    ['auto', '原寸'],
    ['repeat', 'タイル'],
    ['world', 'ボード連動'],
  ];
  const imageRaw = (getCssVar('--bd-bg-image') || '').trim();
  // /file-raw?path=... 形式なら path クエリをデコード、通常のパスなら末尾セグメントを取り出す
  const imageName = (() => {
    if (!imageRaw) return '';
    const match = imageRaw.match(/[?&]path=([^&]+)/);
    let decoded = match ? match[1] : imageRaw;
    try { decoded = decodeURIComponent(decoded); } catch {}
    return decoded.split(/[\\/]/).pop() || decoded;
  })();
  const scaleRaw = (getCssVar('--bd-bg-image-scale') || '').trim();
  const scaleVal = Number.isFinite(parseFloat(scaleRaw)) && parseFloat(scaleRaw) > 0 ? parseFloat(scaleRaw) : 1;
  const fitOptions = fits.map(([v, lbl]) =>
    `<option value="${esc(v)}"${v === fitRaw ? ' selected' : ''}>${esc(lbl)}</option>`).join('');
  const body = `
    <label class="gb-field-row">
      <span class="gb-label" style="min-width:100px;">影</span>
      <input type="checkbox" data-onchange="settingsThemeBoardToggleShadow(this)"${shadowOn ? ' checked' : ''}>
    </label>
    <label class="gb-field-row">
      <span class="gb-label" style="min-width:100px;">自動整列</span>
      <input type="checkbox" data-onchange="settingsThemeBoardToggleAutoAlign(this)"${autoAlignOn ? ' checked' : ''}>
    </label>
    <div class="gb-field-row" style="align-items:center;gap:6px;flex-wrap:wrap;">
      <span class="gb-label" style="min-width:100px;">背景画像</span>
      <button type="button" class="bd-detail-style-action" data-action="settingsThemeBoardChooseBgImage()" title="画像を選択">選択</button>
      <button type="button" class="bd-detail-style-action bd-detail-style-action--danger" data-action="settingsThemeBoardClearBgImage()" title="背景画像をクリア"${imageRaw ? '' : ' disabled'}>クリア</button>
      <span class="gb-section-desc" style="flex:1;min-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${esc(imageRaw)}">${esc(imageName || '（未設定）')}</span>
    </div>
    <label class="gb-field-row">
      <span class="gb-label" style="min-width:100px;">画像表示</span>
      <select class="gb-select" data-onchange="settingsThemeBoardSetBgFit(this.value)" style="max-width:180px;">
        ${fitOptions}
      </select>
    </label>
    <label class="gb-field-row"${fitRaw === 'world' ? '' : ' hidden'}>
      <span class="gb-label" style="min-width:100px;">画像スケール</span>
      <input type="number" min="0.05" max="20" step="0.05" class="gb-input-sm" value="${esc(scaleVal)}" data-onchange="settingsThemeBoardSetBgScale(this.value)">
    </label>`;
  const html = _settingsThemeSubsection('ボード固有設定', body);
  // 再描画時に特定セクションを識別できるようマーカー属性を付ける
  return html.replace('<section class="gb-section gb-section--detail settings-theme-subsection"',
    '<section class="gb-section gb-section--detail settings-theme-subsection" data-settings-theme-board-extras="1"');
}

function _renderSettingsThemeStyleRows(name) {
  const defs = _filterCommonDuplicates(UI_STYLE_SECTIONS?.[name] || [], name);
  const styleRows = defs.map(d => renderStyleRow(d)).join('');
  const styleSection = _settingsThemeSubsection('書式設定', styleRows);
  if (name === '共通') {
    return _settingsThemeSubsection('テーマカラーの自動適用設定', renderThemeUiApplicationEditor({ hideLabel: true, group: 'ui' }))
      + styleSection;
  }
  const autoRows = _renderSettingsThemeStyleAutoRows(name);
  if (name === 'ノート') return autoRows + _renderSettingsThemeNoteLayoutRows() + styleSection;
  if (name === 'ボード') return autoRows + styleSection + _renderSettingsThemeBoardExtras();
  return autoRows + styleSection;
}

// ----- ボード固有設定のハンドラ（テーマタブ） -----
function _settingsThemeBoardReadonlyCheck(el) {
  if (typeof _settingsThemeIsReadonlyElement === 'function' && _settingsThemeIsReadonlyElement(el)) {
    if (typeof _settingsThemePromptDuplicateForEdit === 'function') _settingsThemePromptDuplicateForEdit();
    return true;
  }
  return false;
}

function _settingsThemeBoardSetVar(key, value) {
  if (value == null || value === '') document.documentElement.style.removeProperty(key);
  else document.documentElement.style.setProperty(key, String(value));
  if (typeof _settingsThemeMarkDirty === 'function') _settingsThemeMarkDirty();
  if (typeof _bdApplyCurrentBoardBackground === 'function') _bdApplyCurrentBoardBackground();
}

function settingsThemeBoardToggleShadow(input) {
  if (_settingsThemeBoardReadonlyCheck(input)) { input.checked = !input.checked; return; }
  // '1'/'0' の2値で保存（saveColorSettings は空文字を保存しないため）。
  // bd._fileStyle 側は '1'/'' を使う既存仕様に注意。どちらも on=真、それ以外=偽で評価される。
  _settingsThemeBoardSetVar('--bd-shadow', input.checked ? '1' : '0');
  // キャンバスの bd-shadow-on クラスは bd._showShadow から付けられる。
  // ファイル側で明示指定 (キーが存在) されている場合はファイルを優先、未指定のみテーマ追従。
  if (typeof bd !== 'undefined' && (!bd._fileStyle || bd._fileStyle['--bd-shadow'] === undefined)) {
    bd._showShadow = !!input.checked;
    const canvas = document.getElementById('bd-canvas');
    if (canvas) canvas.classList.toggle('bd-shadow-on', !!input.checked);
  }
}

function settingsThemeBoardToggleAutoAlign(input) {
  if (_settingsThemeBoardReadonlyCheck(input)) { input.checked = !input.checked; return; }
  _settingsThemeBoardSetVar('--bd-auto-align', input.checked ? '1' : '0');
  // ファイル側が未設定のときはテーマに追従させる
  if (typeof bd !== 'undefined' && (!bd._fileStyle || bd._fileStyle['--bd-auto-align'] === undefined)) {
    bd.autoAlign = !!input.checked;
    if (bd.autoAlign && typeof _bdRelayoutAllStructureTrees === 'function') _bdRelayoutAllStructureTrees();
  }
}

function settingsThemeBoardSetBgFit(value) {
  const allowed = ['contain', 'cover', 'auto', 'repeat', 'world'];
  const next = allowed.includes(value) ? value : 'contain';
  _settingsThemeBoardSetVar('--bd-bg-image-fit', next);
  // スケール行の表示切替
  const panel = document.querySelector('[data-settings-theme-style-panel="ボード"]');
  if (panel) {
    const scaleRow = panel.querySelector('input[data-onchange^="settingsThemeBoardSetBgScale"]')?.closest('.gb-field-row');
    if (scaleRow) scaleRow.hidden = next !== 'world';
  }
}

function settingsThemeBoardSetBgScale(value) {
  const n = parseFloat(value);
  if (!Number.isFinite(n) || n <= 0) return;
  const clamped = Math.max(0.05, Math.min(20, n));
  _settingsThemeBoardSetVar('--bd-bg-image-scale', String(clamped));
}

function _settingsThemeIsImageFile(file) {
  if (!file) return false;
  const type = String(file.type || '').toLowerCase();
  if (type.startsWith('image/')) return true;
  return /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(String(file.name || ''));
}

function settingsThemeBoardChooseBgImage() {
  const panel = document.querySelector('[data-settings-theme-style-panel="ボード"]');
  if (panel && _settingsThemeBoardReadonlyCheck(panel)) return;
  if (typeof bd === 'undefined' || !bd?.path) {
    if (typeof showStatus === 'function') showStatus('ボードを開いてから背景画像を設定してください', true);
    return;
  }
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.style.display = 'none';
  input.addEventListener('change', async () => {
    const file = input.files && input.files[0];
    if (file) {
      if (!_settingsThemeIsImageFile(file)) {
        if (typeof showStatus === 'function') showStatus('画像ファイルを選択してください', true);
        input.remove();
        return;
      }
      try {
        const reader = new FileReader();
        const dataUrl = await new Promise((resolve, reject) => {
          reader.onload = e => resolve(e.target.result);
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(file);
        });
        const dir = (() => {
          const p = String(bd.path || '');
          const i = p.lastIndexOf('/');
          return i >= 0 ? p.substring(0, i) : '';
        })();
        const res = await apiFetch('/upload-file?path=' + encodeURIComponent(dir), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ data: dataUrl, filename: file.name || 'background.png' }),
        });
        if (!res?.ok || !res.path) throw new Error('upload failed');
        const url = API_BASE + '/file-raw?path=' + encodeURIComponent(res.path);
        _settingsThemeBoardSetVar('--bd-bg-image', url);
        // パネル再描画
        _settingsThemeRefreshBoardExtras();
        if (typeof showStatus === 'function') showStatus('背景画像を設定しました');
      } catch {
        if (typeof showStatus === 'function') showStatus('背景画像の設定に失敗しました', true);
      }
    }
    input.remove();
  });
  document.body.appendChild(input);
  input.click();
}

function settingsThemeBoardClearBgImage() {
  const panel = document.querySelector('[data-settings-theme-style-panel="ボード"]');
  if (panel && _settingsThemeBoardReadonlyCheck(panel)) return;
  _settingsThemeBoardSetVar('--bd-bg-image', '');
  _settingsThemeBoardSetVar('--bd-bg-image-scale', '');
  _settingsThemeRefreshBoardExtras();
}

function _settingsThemeRefreshBoardExtras() {
  const panel = document.querySelector('[data-settings-theme-style-panel="ボード"]');
  if (!panel) return;
  const section = panel.querySelector('[data-settings-theme-board-extras="1"]');
  if (!section) return;
  const next = _renderSettingsThemeBoardExtras();
  const tmp = document.createElement('div');
  tmp.innerHTML = next;
  const replacement = tmp.firstElementChild;
  if (replacement) section.replaceWith(replacement);
}

function _settingsThemeStylePanelPlaceholder(name) {
  return `<div class="gb-section-desc" data-settings-theme-style-placeholder="1">${esc(name)} の設定は対象を切り替えた時に読み込みます。</div>`;
}

function _renderSettingsThemeStyleTabs(activeStyleTab, options = {}) {
  const names = _settingsThemeStyleTabNames();
  const activeName = names.includes(activeStyleTab) ? activeStyleTab : names[0];
  const renderedStyleTab = activeName;
  const optionsHtml = names.map(name =>
    `<option value="${esc(name)}"${name === activeName ? ' selected' : ''}>${esc(name)}</option>`
  ).join('');
  const panels = names.map((name, idx) => `
    <div data-settings-theme-style-panel="${esc(name)}" data-settings-theme-style-rendered="${name === renderedStyleTab ? '1' : '0'}"${name === activeName ? '' : ' hidden'}>
      ${name === renderedStyleTab ? _renderSettingsThemeStyleRows(name) : (name === activeName ? _settingsThemeStylePanelPlaceholder(name) : '')}
    </div>`).join('');
  return `<label class="gb-field-row settings-theme-style-selector" style="align-items:center;margin-bottom:8px;">
    <span class="gb-label">対象:</span>
    <select class="gb-select" data-settings-theme-style-select data-onchange="switchSettingsThemeStyleTab(this)" style="max-width:240px;">${optionsHtml}</select>
  </label>${panels}`;
}

function renderSettingsThemeEditor(activeStyleTab, options = {}) {
  const theme = _settingsThemeCurrent();
  const builtIn = !!theme && !_settingsThemeIsCustom(theme.id);
  const rows = _renderSettingsThemeStyleTabs(activeStyleTab, options);
  return `<div id="settings-theme-editor" data-readonly="0" data-builtin="${builtIn ? '1' : '0'}" data-theme-id="${esc(theme?.id || '')}">${rows}</div>`;
}

function switchSettingsThemeStyleTab(btn) {
  const editor = btn?.closest?.('#settings-theme-editor');
  const name = btn?.dataset?.settingsThemeStyleTabBtn || btn?.value || '';
  if (!editor || !name) return;
  const select = editor.querySelector('[data-settings-theme-style-select]');
  if (select && select.value !== name) select.value = name;
  editor.querySelectorAll('[data-settings-theme-style-tab-btn]').forEach(tab => {
    const active = tab.dataset.settingsThemeStyleTabBtn === name;
    tab.classList.toggle('gb-inner-tab-active', active);
    tab.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  let activePanel = null;
  editor.querySelectorAll('[data-settings-theme-style-panel]').forEach(panel => {
    const active = panel.dataset.settingsThemeStylePanel === name;
    panel.hidden = !active;
    if (active) activePanel = panel;
  });
  if (activePanel && activePanel.dataset.settingsThemeStyleRendered !== '1') {
    activePanel.innerHTML = _renderSettingsThemeStyleRows(name);
    activePanel.dataset.settingsThemeStyleRendered = '1';
    _bindSettingsThemeStylePanel(activePanel);
    if (typeof replaceIcons === 'function') replaceIcons(activePanel);
  }
  const themePanel = editor.closest('.settings-panel[data-panel="テーマ"]');
  if (themePanel) themePanel.dataset.settingsThemeActiveStyleTab = name;
}

function _bindSettingsThemeStylePanel(root) {
  if (!root || root.dataset.settingsThemeStyleBound === '1') return;
  if (root.querySelector?.('[data-settings-theme-style-placeholder="1"]')) return;
  if (root.dataset.settingsThemeStyleRendered === '0') return;
  root.dataset.settingsThemeStyleBound = '1';
  syncCsSwatches(root);
  syncThemeUiApplicationSelectors(root);
  bindThemeUiApplicationEditor(root);
}

function bindSettingsThemePanel(root) {
  const panel = root || document;
  const editor = panel.querySelector?.('#settings-theme-editor');
  const activeStylePanel = editor?.querySelector?.('[data-settings-theme-style-panel]:not([hidden])');
  _bindSettingsThemeStateTargets(panel);
  // 書式行（基本の面/文字/操作状態/装飾）がエディタ外にも並ぶため panel 全体を同期する
  syncCsSwatches(panel);
  syncThemeColorSetSwatches(panel);
  if (typeof syncThemeOsAccentToggle === 'function') syncThemeOsAccentToggle(panel);
  // テーマカラーセクションはテーマ設定エディタの外側にあるため panel 単位でバインドする
  bindThemeColorSetEditor(panel);
  // 自動色の強さ・自動適用設定のセクションのみ限定バインド
  // （アプリ別エディタ内の同種行は _bindSettingsThemeStylePanel が遅延バインドするため二重登録を避ける）
  panel.querySelectorAll?.('[data-settings-theme-apply-editor="1"]').forEach(section => {
    if (typeof bindThemeUiApplicationEditor === 'function') bindThemeUiApplicationEditor(section);
  });
  if (activeStylePanel) _bindSettingsThemeStylePanel(activeStylePanel);
  if (typeof syncThemeUiApplicationSelectors === 'function') syncThemeUiApplicationSelectors(panel);
  globalThis.GBUI?.refreshRangeFills?.(panel);
}

// 旧「テーマ詳細設定」ダイアログの互換入口。設定ダイアログのテーマタブ内サブタブへ誘導する
const _SETTINGS_THEME_DETAIL_PAGE_MAP = Object.freeze({
  surface: 'color',
  text: 'font',
  state: 'state',
  ornament: 'state',
  sequence: 'color',
  apps: 'apps',
});

function openSettingsThemeDetailDialog(activeTab) {
  const pageId = _SETTINGS_THEME_DETAIL_PAGE_MAP[activeTab] || 'theme';
  const modal = document.querySelector('.modal-overlay[data-settings-modal="1"] .settings-modal');
  if (modal && typeof _openSettingsSection === 'function') {
    _openSettingsSection('テーマ', modal, { pageId });
    return;
  }
  if (typeof showSettingsModal === 'function') showSettingsModal({ panel: 'テーマ', pageId });
}

function settingsThemeApplyCommonFont(value, options = {}) {
  if (value == null) return _settingsThemeCommonFontValue();
  const family = typeof normalizeFontFamilyValue === 'function' ? normalizeFontFamilyValue(value) : String(value || '').trim();
  const current = _settingsThemeCommonFontValue();
  if (current === family) return family;
  if (family) document.documentElement.style.setProperty('--ui-font', family);
  else document.documentElement.style.removeProperty('--ui-font');
  const uiFont = document.getElementById('modal-font-family');
  if (uiFont) uiFont.value = family;
  try { loadGoogleFontForUI(family); } catch {}
  if (options.markDirty !== false && typeof _settingsThemeMarkDirty === 'function') _settingsThemeMarkDirty();
  return family;
}

function settingsThemeCommonFontChanged(value) {
  settingsThemeApplyCommonFont(value);
}

function settingsThemeNoteMarginChanged(value) {
  let px = parseFloat(value);
  if (!Number.isFinite(px)) px = 50;
  px = Math.max(0, Math.min(300, px));
  document.documentElement.style.setProperty('--page-margin-x', px + 'px');
  if (typeof applyNoteMargin === 'function') applyNoteMargin();
  if (typeof _settingsThemeMarkDirty === 'function') _settingsThemeMarkDirty();
  const input = document.getElementById('settings-note-margin-x');
  if (input) input.value = String(px);
}

function settingsThemeNoteContentMaxWidthChanged(value) {
  const px = typeof _clampNoteContentMaxWidth === 'function'
    ? _clampNoteContentMaxWidth(value)
    : Math.max(480, Math.min(3200, parseFloat(value) || 1200));
  document.documentElement.style.setProperty('--page-content-max-width', px + 'px');
  if (typeof applyNoteContentMaxWidth === 'function') applyNoteContentMaxWidth(px);
  if (typeof _settingsThemeMarkDirty === 'function') _settingsThemeMarkDirty();
  const input = document.getElementById('settings-note-content-max-width');
  if (input) input.value = String(px);
}

function _settingsThemeRun(message, fn) {
  try {
    return fn();
  } catch (err) {
    console.warn('[settings theme]', message, err);
    showStatus(message + (err?.message ? ': ' + err.message : ''), true);
    return undefined;
  }
}

function _settingsThemeActiveStyleTab(root) {
  const select = (root || document).querySelector?.('[data-settings-theme-style-select]');
  if (select?.value) return select.value;
  const active = (root || document).querySelector?.('[data-settings-theme-style-tab-btn].gb-inner-tab-active');
  return active?.dataset?.settingsThemeStyleTabBtn || '';
}

function _refreshSettingsThemePanel(selectedId, options = {}) {
  const panel = document.querySelector('.settings-panel[data-panel="テーマ"]') || document.querySelector('.settings-panel[data-panel="外観"]');
  if (!panel) return;
  const activeStyleTab = options.activeStyleTab || panel.dataset.settingsThemeActiveStyleTab || _settingsThemeActiveStyleTab(panel);
  const activePanel = Array.from(panel.querySelectorAll?.('[data-settings-theme-style-panel]') || [])
    .find(candidate => candidate.dataset.settingsThemeStylePanel === activeStyleTab);
  const activeRendered = activePanel?.dataset?.settingsThemeStyleRendered === '1';
  ensureSettingsThemePanel(panel, {
    force: true,
    selectedId: selectedId || _settingsThemeCurrentId(),
    activeStyleTab,
    deferStyleRows: !activeRendered,
    renderedStyleTab: activeRendered ? activeStyleTab : '',
  });
}

function _settingsThemeIsReadonlyElement(el) {
  const editor = el?.closest?.('#settings-theme-editor') || document.querySelector('#settings-theme-editor');
  return editor?.dataset.readonly === '1';
}

async function _settingsThemePromptDuplicateForEdit() {
  if (!await cfConfirm('組み込みテーマには上書き保存できません。複製して保存しますか？')) return null;
  return settingsThemeDuplicate(true);
}

function settingsThemeSelect(id) {
  if (!id) return;
  const activeStyleTab = _settingsThemeActiveStyleTab(document);
  applyThemePreset(id);
  if (typeof _settingsThemeSetDirty === 'function') _settingsThemeSetDirty(false);
  _refreshSettingsThemePanel(id, { activeStyleTab });
}

async function settingsThemeCreate(options = {}) {
  if (typeof MeldexThemeManager === 'undefined') return false;
  const opts = options && typeof options === 'object' ? options : {};
  const name = await cfPrompt('カスタムテーマ名', opts.defaultName || 'カスタムテーマ');
  if (name === null) return false;
  const theme = _settingsThemeRun('カスタムテーマを作成できませんでした', () => MeldexThemeManager.createCustomThemeFromCurrent(name));
  if (theme === undefined) return false;
  if (!theme) { showStatus('テーマ名を入力してください', true); return false; }
  MeldexThemeManager.applyDefaultTheme(theme.id, { silent: true, resetThemeColorSet: false });
  if (typeof _settingsThemeSetDirty === 'function') _settingsThemeSetDirty(false);
  if (!opts.skipRefresh) _refreshSettingsThemePanel(theme.id);
  if (!opts.silent) showStatus('カスタムテーマを作成しました');
  return theme;
}

async function settingsThemeDuplicate(autoName) {
  if (typeof MeldexThemeManager === 'undefined') return null;
  const source = _settingsThemeCurrent();
  if (!source) return null;
  let name = `${source.name} コピー`;
  if (!autoName) {
    const input = await cfPrompt('複製後のテーマ名', name);
    if (input === null) return null;
    name = input;
  }
  const theme = _settingsThemeRun('カスタムテーマを複製できませんでした', () => MeldexThemeManager.createCustomThemeFromTheme(source.id, name));
  if (!theme) return null;
  MeldexThemeManager.applyDefaultTheme(theme.id, { silent: true, resetThemeColorSet: false });
  if (typeof _settingsThemeSetDirty === 'function') _settingsThemeSetDirty(false);
  _refreshSettingsThemePanel(theme.id);
  showStatus('カスタムテーマを複製しました');
  return theme;
}

async function settingsThemeRename() {
  if (typeof MeldexThemeManager === 'undefined') return;
  const id = _settingsThemeCurrentId();
  const theme = MeldexThemeManager.getCustomThemes().find(t => t.id === id);
  if (!theme) { showStatus('組み込みテーマは名前を変更できません', true); return; }
  const name = await cfPrompt('テーマ名', theme.name);
  if (name === null) return;
  const renamed = _settingsThemeRun('テーマ名を変更できませんでした', () => MeldexThemeManager.renameCustomTheme(id, name));
  if (renamed === undefined) return;
  if (!renamed) { showStatus('テーマ名を入力してください', true); return; }
  _refreshSettingsThemePanel(renamed.id);
}

function settingsThemeReset() {
  if (typeof MeldexThemeManager === 'undefined') return;
  const id = _settingsThemeCurrentId();
  if (typeof THEME_COLOR_SLOT_SETTINGS_KEY !== 'undefined') localStorage.removeItem(THEME_COLOR_SLOT_SETTINGS_KEY);
  if (typeof THEME_COLOR_EXTRA_SLOT_SETTINGS_KEY !== 'undefined') localStorage.removeItem(THEME_COLOR_EXTRA_SLOT_SETTINGS_KEY);
  MeldexThemeManager.applyDefaultTheme(id, { silent: true, resetThemeColorSet: true });
  if (typeof _settingsThemeSetDirty === 'function') _settingsThemeSetDirty(false);
  _refreshSettingsThemePanel(id);
  showStatus('デフォルトに戻しました');
}

function settingsThemeSave(options = {}) {
  if (typeof MeldexThemeManager === 'undefined') return false;
  const opts = options && typeof options === 'object' ? options : {};
  const id = _settingsThemeCurrentId();
  if (!_settingsThemeIsCustom(id)) {
    showStatus('組み込みテーマはデフォルトとして保存できません。新規カスタムテーマを作成してください', true);
    return false;
  }
  const saved = _settingsThemeRun('デフォルトとして保存できませんでした', () => MeldexThemeManager.updateCustomThemeFromCurrent(id));
  if (saved === undefined) return false;
  if (!saved) { showStatus('デフォルトとして保存できませんでした', true); return false; }
  try { localStorage.removeItem(MeldexThemeManager.THEME_COLOR_SET_KEY); } catch {}
  if (typeof _settingsThemeSetDirty === 'function') _settingsThemeSetDirty(false);
  if (!opts.skipRefresh) _refreshSettingsThemePanel(saved.id);
  if (!opts.silent) showStatus('デフォルトとして保存しました', false, { showSaveDialog: true });
  return true;
}

async function settingsThemeSaveFromSettingsDialog(options = {}) {
  const opts = options && typeof options === 'object' ? options : {};
  if (typeof _settingsThemeIsDirty === 'function' && !_settingsThemeIsDirty()) return true;
  if (typeof MeldexThemeManager === 'undefined') return true;
  if (_settingsThemeIsCustom()) return settingsThemeSave({ silent: true, skipRefresh: !!opts.skipRefresh });
  const current = _settingsThemeCurrent();
  const created = await settingsThemeCreate({
    silent: true,
    skipRefresh: !!opts.skipRefresh,
    defaultName: `${current?.name || 'テーマ'} カスタム`,
  });
  return !!created;
}

async function settingsThemeDelete() {
  if (typeof MeldexThemeManager === 'undefined') return;
  const id = _settingsThemeCurrentId();
  const theme = MeldexThemeManager.getCustomThemes().find(t => t.id === id);
  if (!theme) { showStatus('削除できるカスタムテーマが選択されていません', true); return; }
  if (!await cfConfirm('カスタムテーマ「' + theme.name + '」を削除しますか？')) return;
  if (!_settingsThemeRun('カスタムテーマを削除できませんでした', () => MeldexThemeManager.deleteCustomTheme(id))) return;
  MeldexThemeManager.applyDefaultTheme('builtin-dark', { silent: true, resetThemeColorSet: true });
  if (typeof _settingsThemeSetDirty === 'function') _settingsThemeSetDirty(false);
  _refreshSettingsThemePanel('builtin-dark');
  showStatus('カスタムテーマを削除しました');
}

function settingsThemeExport() {
  if (typeof MeldexThemeManager === 'undefined') return;
  const theme = MeldexThemeManager.getThemeById(_settingsThemeCurrentId());
  const payload = { _type: 'meldex-theme', _version: 5, theme };
  if (typeof MeldexThemeManager.getUseOsAccentColor === 'function') {
    payload.useOsAccentColor = MeldexThemeManager.getUseOsAccentColor();
    if (typeof MeldexThemeManager.setThemeOsAccentOnTheme === 'function') {
      MeldexThemeManager.setThemeOsAccentOnTheme(theme, payload.useOsAccentColor);
    }
  }
  if (typeof getStandardPaletteAdjust === 'function' && typeof MeldexThemeManager.setThemeStandardPaletteAdjustOnTheme === 'function') {
    MeldexThemeManager.setThemeStandardPaletteAdjustOnTheme(theme, getStandardPaletteAdjust());
  }
  if (typeof getThemeColorSlotSettings === 'function' && typeof MeldexThemeManager.setThemeColorSlotSettingsOnTheme === 'function') {
    MeldexThemeManager.setThemeColorSlotSettingsOnTheme(theme, getThemeColorSlotSettings());
  }
  if (typeof getThemeColorExtraSlotSettings === 'function' && typeof MeldexThemeManager.setThemeColorExtraSlotSettingsOnTheme === 'function') {
    MeldexThemeManager.setThemeColorExtraSlotSettingsOnTheme(theme, getThemeColorExtraSlotSettings());
  }
  if (typeof MeldexExportSave === 'undefined' || typeof MeldexExportSave.saveText !== 'function') {
    showStatus('保存ダイアログを初期化できませんでした', true);
    return;
  }
  MeldexExportSave.saveText(JSON.stringify(payload, null, 2), {
    filename: _settingsThemeExportFilename(theme),
    extension: '.json',
    dialogTitle: 'テーマとして保存',
    filetypes: [['JSONファイル', '*.json'], ['すべてのファイル', '*.*']],
    okMessage: 'テーマを保存しました',
    errorMessage: 'テーマの保存に失敗しました',
  });
}

function _settingsThemeExportFilename(theme) {
  const raw = String(theme?.name || theme?.id || 'テーマ').trim() || 'テーマ';
  const safe = raw.replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, '_').slice(0, 80) || 'テーマ';
  return `Meldex_${safe}_テーマ.json`;
}

function _settingsThemeImportPayload(payload) {
  if (typeof MeldexThemeManager === 'undefined') return null;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  if (payload._type !== 'meldex-theme') return null;
  let imported = null;
  const importThemes = Array.isArray(payload.customThemes) ? payload.customThemes : [payload.theme];
  const validThemes = importThemes.filter(_settingsThemeLooksLikeTheme);
  if (!validThemes.length || validThemes.length !== importThemes.length) return null;
  const withPayloadSettings = theme => {
    if (!theme || typeof theme !== 'object') return theme;
    const next = { ...theme, ui: { ...(theme.ui || {}) } };
    if (Object.prototype.hasOwnProperty.call(payload || {}, 'useOsAccentColor')) {
      next.ui.useOsAccentColor = !!payload.useOsAccentColor;
    }
    return next;
  };
  if (Object.prototype.hasOwnProperty.call(payload || {}, 'useOsAccentColor') && typeof MeldexThemeManager.setUseOsAccentColor === 'function') {
    MeldexThemeManager.setUseOsAccentColor(!!payload.useOsAccentColor);
  }
  validThemes.forEach(theme => { imported = MeldexThemeManager.importCustomTheme(withPayloadSettings(theme)); });
  if (imported) {
    MeldexThemeManager.applyDefaultTheme(imported.id, { silent: true, resetThemeColorSet: false });
    if (typeof _settingsThemeSetDirty === 'function') _settingsThemeSetDirty(false);
  }
  return imported;
}

function _settingsThemeLooksLikeTheme(theme) {
  if (!theme || typeof theme !== 'object' || Array.isArray(theme)) return false;
  const hasName = typeof theme.name === 'string' && theme.name.trim();
  const hasId = typeof theme.id === 'string' && theme.id.trim();
  const hasUi = theme.ui && typeof theme.ui === 'object' && !Array.isArray(theme.ui);
  const hasCssVars = theme.cssVars && typeof theme.cssVars === 'object' && !Array.isArray(theme.cssVars);
  const hasColorSet = Array.isArray(theme.themeColorSet);
  const hasColorSlots = Array.isArray(theme.themeColorSlotSettings);
  return !!((hasName || hasId) && (hasUi || hasCssVars || hasColorSet || hasColorSlots));
}

function settingsThemeImport() {
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = '.json,application/json';
  inp.onchange = (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = (ev) => {
      try {
        const imported = _settingsThemeImportPayload(JSON.parse(ev.target.result));
        if (!imported) throw new Error('テーマが見つかりません');
        _refreshSettingsThemePanel(imported.id);
        showStatus('テーマを読み込みました');
      } catch (err) {
        showStatus('テーマ読み込み失敗: ' + err.message, true);
      }
    };
    r.readAsText(f, 'UTF-8');
  };
  inp.click();
}
