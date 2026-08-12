/* gb-settings.part05.js: appearance tab theme editor integration */

function _settingsThemeAction(iconName, fallback, label, action, danger) {
  const icon = typeof lucide === 'function' ? lucide(iconName, 14) : fallback;
  return `<button type="button" class="bd-detail-style-action${danger ? ' bd-detail-style-action--danger' : ''}" data-action="${action}" title="${esc(label)}" aria-label="${esc(label)}">${icon}</button>`;
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
    ['補助パネル', ['チャット本文', 'タイマー']],
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
  const usesDefault = current.toLowerCase() === String(fallback).trim().toLowerCase();
  return {
    mode: useOs ? 'os' : (usesDefault ? 'default' : 'custom'),
    color: current,
    defaultColor: fallback,
  };
}

function renderSettingsThemeAccentEditor() {
  const state = _settingsThemeAccentState();
  return `<div class="gb-field-row settings-theme-accent-row" data-settings-theme-accent="1">
    <label class="gb-label" for="settings-theme-accent-mode">アクセントカラー</label>
    <select id="settings-theme-accent-mode" class="gb-select" data-e2e-id="settings-theme-accent-mode" data-onchange="settingsThemeAccentModeChanged(this)">
      <option value="os"${state.mode === 'os' ? ' selected' : ''}>OSアクセント</option>
      <option value="default"${state.mode === 'default' ? ' selected' : ''}>既定のアクセント</option>
      <option value="custom"${state.mode === 'custom' ? ' selected' : ''}>指定カラー</option>
    </select>
    <button type="button" class="gb-color-swatch settings-theme-accent-swatch" data-e2e-id="settings-theme-accent-swatch" data-settings-theme-accent-swatch style="background:${esc(state.color)}" title="共通カラーパレットから選択" data-action="settingsThemeChooseAccentColor(this)"></button>
    ${fieldHelp('選択、フォーカス、タブ下線、左アクセントバーなどに共通で使います', { e2eId: 'settings-theme-accent-help' })}
  </div>`;
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
  aux: Object.freeze(['フォルダツリー', 'ビューワー', 'オプション', 'チャット', 'タイマー', 'ヒストリー', '注釈', '検索', 'バージョン管理']),
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

function settingsThemePreviewManifest() {
  return SETTINGS_THEME_PREVIEW_APPS.flatMap(([appId, appLabel]) =>
    (SETTINGS_THEME_PREVIEW_SECTION_MAP[appId] || []).flatMap(section =>
      (UI_STYLE_SECTIONS?.[section] || []).map((def, index) => {
        const popupFields = typeof _settingsThemePreviewPopupFields === 'function'
          ? _settingsThemePreviewPopupFields(def)
          : [];
        return {
          id: `${appId}/${section}/${index}/${def.label}`,
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
      })
    )
  );
}

function _settingsThemePreviewTarget(section, label, text, className = '', manifestId = '') {
  const def = (UI_STYLE_SECTIONS?.[section] || []).find(item => item.label === label);
  const style = def ? _settingsThemePreviewStyle(def) : '';
  const stableId = manifestId || `${section}/${label}`;
  const e2eId = `settings-theme-preview-${stableId}`;
  return `<button type="button" class="settings-theme-preview-target ${className}" data-e2e-id="${esc(e2eId)}" data-style-id="${esc(stableId)}" data-style-section="${esc(section)}" data-style-label="${esc(label)}" data-action="openStylePreviewPopup(this)" style="${esc(style)}">${esc(text || label)}</button>`;
}

function _settingsThemePreviewStateClass(label) {
  const value = String(label || '');
  if (/ホバー/.test(value)) return 'is-hover';
  if (/選択|今日|強調|実行中|保存\/復元|送信/.test(value)) return 'is-selected';
  return '';
}

function _settingsThemePreviewMain(appId) {
  const entries = settingsThemePreviewManifest().filter(item => item.appId === appId);
  const sections = (SETTINGS_THEME_PREVIEW_SECTION_MAP[appId] || []).map(section => {
    const targets = entries.filter(item => item.section === section).map(item => {
      const def = UI_STYLE_SECTIONS[item.section][item.index];
      return _settingsThemePreviewTarget(
        item.section,
        item.label,
        def?.text || item.label,
        _settingsThemePreviewStateClass(item.label),
        item.id,
      );
    }).join('');
    return `<section class="settings-theme-preview-group" data-style-preview-section="${esc(section)}"><h3>${esc(section)}</h3><div class="settings-theme-preview-list">${targets}</div></section>`;
  }).join('');
  const surface = SETTINGS_THEME_PREVIEW_APP_SURFACES[appId] || SETTINGS_THEME_PREVIEW_APP_SURFACES.note;
  return `<div class="settings-theme-preview-all" data-style-preview-app="${esc(appId)}" data-style-preview-app-surface="1" style="background:var(${esc(surface.bg)});color:var(${esc(surface.fg)});">${_settingsThemeStateMatrix(appId)}${sections}</div>`;
}

function renderSettingsThemePreview(appId = 'note') {
  const options = SETTINGS_THEME_PREVIEW_APPS.map(([id, label]) => `<option value="${id}"${id === appId ? ' selected' : ''}>${label}</option>`).join('');
  return `<section class="gb-section gb-section--boxed settings-theme-preview" data-settings-theme-preview="1">
    <div class="settings-theme-preview-toolbar"><div class="gb-section-title">プレビュー</div><select class="gb-select" data-e2e-id="settings-theme-preview-app" data-settings-theme-preview-select data-onchange="settingsThemePreviewAppChanged(this.value)">${options}</select></div>
    <div class="settings-theme-preview-shell">
      <aside class="settings-theme-preview-rail">${_settingsThemePreviewTarget('共通', 'アクセント', '◆', '', 'chrome-left/common/accent')}</aside>
      <aside class="settings-theme-preview-tree">${_settingsThemePreviewTarget('フォルダ', 'カード', 'フォルダ', '', 'chrome-tree/folder/card')}<span>作品</span><span>資料</span></aside>
      <main class="settings-theme-preview-main" data-settings-theme-preview-main>${_settingsThemePreviewMain(appId)}</main>
      <aside class="settings-theme-preview-side">${_settingsThemePreviewTarget('補助パネル', 'フォルダツリー', 'オプション', '', 'chrome-side/aux/folder-tree')}<span>プロパティ</span></aside>
      <aside class="settings-theme-preview-rail">${_settingsThemePreviewTarget('共通', 'アクセント', '●', '', 'chrome-right/common/accent')}</aside>
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

function settingsThemePreviewAppChanged(appId) {
  const root = _activeSettingsThemePreviewRoot();
  const main = root?.querySelector('[data-settings-theme-preview-main]');
  if (!main) return;
  _settingsThemePreviewAppId = appId;
  const select = root.querySelector('[data-settings-theme-preview-select]');
  if (select && [...select.options].some(option => option.value === appId)) select.value = appId;
  main.innerHTML = _settingsThemePreviewMain(appId);
  _bindSettingsThemeStateTargets(main);
  root.dataset.settingsThemePreviewApp = appId;
  const panel = root.closest('.settings-panel[data-panel="テーマ"]');
  if (panel) panel.dataset.settingsThemePreviewApp = appId;
}

function refreshSettingsThemePreview() {
  const root = _activeSettingsThemePreviewRoot();
  if (!root) return;
  const appId = root.querySelector('[data-settings-theme-preview-select]')?.value
    || root.dataset.settingsThemePreviewApp
    || _settingsThemePreviewAppId;
  const main = root.querySelector('[data-settings-theme-preview-main]');
  if (main) {
    main.innerHTML = _settingsThemePreviewMain(appId);
    _bindSettingsThemeStateTargets(main);
  }
  root.querySelectorAll('[data-style-section][data-style-label]').forEach(target => {
    const section = target.dataset.styleSection;
    const label = target.dataset.styleLabel;
    const def = (UI_STYLE_SECTIONS?.[section] || []).find(item => item.label === label);
    if (def) target.setAttribute('style', _settingsThemePreviewStyle(def));
  });
}

function _bindSettingsThemeStateTargets(root) {
  root?.querySelectorAll?.('[data-theme-state-id]').forEach(target => {
    if (target.dataset.themeStateBound === '1') return;
    target.dataset.themeStateBound = '1';
    target.addEventListener('click', event => {
      event.stopPropagation();
      const preview = target.closest('[data-settings-theme-preview]');
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
  button.textContent = details.hidden ? '詳細設定を開く' : '詳細設定を閉じる';
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
        <span class="bd-detail-style-row" style="width:auto;flex:0 0 auto;">
          ${_settingsThemeAction('plus', '+', '新規カスタムテーマを作成', 'settingsThemeCreate()')}
          ${_settingsThemeAction('copy', '複製', '選択中テーマを複製', 'settingsThemeDuplicate()')}
          ${_settingsThemeAction('pencil', '名前', 'テーマ名を変更', 'settingsThemeRename()')}
          ${_settingsThemeAction('rotateCcw', '戻す', 'デフォルトに戻す', 'settingsThemeReset()')}
          ${_settingsThemeAction('save', '保存', 'デフォルトとして保存', 'settingsThemeSave()')}
          ${_settingsThemeAction('trash2', '削除', 'カスタムテーマを削除', 'settingsThemeDelete()', true)}
          ${_settingsThemeAction(typeof uiTransferIconName === 'function' ? uiTransferIconName('import') : 'download', '読込', 'テーマをインポート', 'settingsThemeImport()')}
          ${_settingsThemeAction(typeof uiTransferIconName === 'function' ? uiTransferIconName('export') : 'upload', '保存', 'テーマをエクスポート', 'settingsThemeExport()')}
        </span>
      </div>
    </section>
    <section class="gb-section gb-section--boxed settings-theme-controls" data-settings-view="theme">
      <div class="gb-section-title">テーマカラー</div>
      ${typeof renderSettingsThemePaletteEditor === 'function' ? renderSettingsThemePaletteEditor({ id: 'settings-theme-palette-editor' }) : renderThemeColorSetEditor(null, { hideLabel: true })}
      ${renderSettingsThemeAccentEditor()}
    </section>
    <div class="settings-theme-detail-toggle-row"><button type="button" class="gb-btn" aria-expanded="false" data-action="settingsThemeToggleDetails(this)">詳細設定を開く</button></div>
    <div class="settings-theme-details" data-settings-theme-details hidden>
    <section class="gb-section gb-section--boxed" data-settings-view="theme" data-settings-theme-apply-editor="1">
      <div class="gb-section-title">自動色の強さ</div>
      ${typeof renderThemeUiAutoToneControls === 'function' ? renderThemeUiAutoToneControls() : ''}
    </section>
    <section class="gb-section gb-section--boxed" data-settings-view="theme" data-settings-theme-apply-editor="1">
      <div class="gb-section-title">テーマカラーの自動適用設定</div>
      ${renderThemeUiApplicationEditor({ hideLabel: true })}
    </section>
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
  if (options.force !== true && root.dataset.settingsThemeRendered === '1' && root.querySelector('[data-settings-theme-summary="1"]')) return;
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
  'フォルダ': ['style-folder', 'folder-panel-folder'],
  'ノート': ['style-note', 'note-heading', 'note-toc-item'],
  'シナリオ': ['style-scriptnote', 'scriptnote-type-dialogue', 'scriptnote-type-action', 'scriptnote-type-heading', 'scriptnote-type-summary', 'scriptnote-type-break'],
  'シート': ['style-sheet'],
  'ボード': ['style-board'],
  'スケジュール': ['style-calendar'],
  '補助パネル': ['style-outliner', 'folder-tree-folder', 'style-preview', 'style-detail', 'style-chat', 'style-timer', 'style-history', 'style-annotation', 'style-search', 'style-version'],
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
  _settingsThemeRefreshActionStates(panel);
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

function _settingsThemeRefreshActionStates(root) {
  const custom = _settingsThemeIsCustom();
  // data-action は「探すための目印」として読むだけで、値を差し込んで書き出してはいない。
  // ただしセレクタ文字列へのテンプレート補間は静的検査（js-template-data-handler）に
  // 引っかかるため、属性値の比較で同じことをする。
  const setDisabled = (action, disabled) => {
    (root || document).querySelectorAll('[data-action]').forEach(btn => {
      if (btn.getAttribute('data-action') === action) btn.disabled = disabled;
    });
  };
  setDisabled('settingsThemeRename()', !custom);
  setDisabled('settingsThemeSave()', !custom);
  setDisabled('settingsThemeDelete()', !custom);
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
