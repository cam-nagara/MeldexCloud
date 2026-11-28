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
    ['download', 'テーマを読み込む', 'import', () => settingsThemeImport(), false],
    ['upload', 'テーマを書き出す', 'export', () => settingsThemeExport(), false],
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
    ['共通', ['共通本文背景色', 'アプリ基礎背景色', 'サブ背景色', '強調背景色', 'ポップアップ', 'ダイアログ', 'パネルタブバー', 'パネルタブ選択背景', '折りたたみ/ドックバー', 'パネル内タブバー', 'パネル内タブ 通常', 'パネル内タブ 選択']],
    ['フォルダ', ['カード', 'カード枠線']],
    ['ノート', ['引用ブロック']],
    ['シート', ['ヘッダー', 'トピック列', 'セル']],
    ['ボード', ['ボード背景']],
    ['スケジュール', ['全体', 'ツールバー', 'サイドバー', 'コンテンツ', '右サイドバー', 'セル']],
    ['補助パネル', ['フォルダツリー', 'ビューワーカード', 'チャット入力']],
  ],
  text: [
    ['共通', ['通常文字', 'サブテキスト', 'ヘッダー', 'ツールバー', '強調文字', 'リンク', 'エラー・警告']],
    ['ノート', ['タイトル', '見出し H1', '見出し H2', '見出し H3', '見出し H4', '見出し H5', '見出し H6', '本文', '引用ブロック']],
    ['シナリオ', ['基本テキスト']],
    ['シート', ['ヘッダー', 'トピック列', 'セル']],
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
        <option value="default"${state.mode === 'default' ? ' selected' : ''}>既定の色</option>
        <option value="custom"${state.mode === 'custom' ? ' selected' : ''}>指定カラー</option>
      </select>
      <button type="button" class="gb-color-swatch settings-theme-accent-swatch" data-e2e-id="settings-theme-accent-swatch" data-settings-theme-accent-swatch style="background:${esc(state.color)}" title="共通カラーパレットから選択" data-action="settingsThemeChooseAccentColor(this)"></button>
    </span>
    ${fieldHelp('本体・クイックメモ・Web Clipperの共通色。保存後に反映します。', { e2eId: 'settings-theme-accent-help' })}
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
  const explicitKeys = typeof settingsThemeExplicitColorKeys === 'function' ? settingsThemeExplicitColorKeys() : new Set();
  keys.forEach(key => { if (!explicitKeys.has(key)) root.style.setProperty(key, value.toLowerCase()); });
  // アクセントの変更で、別途設定した選択文字やボタン文字の色を上書きしない。
  // This control explicitly edits the accent, including a previous bulk accent.
  for (const key of ['--accent', '--accent2', '--blue', '--ui-accent']) root.style.setProperty(key, value.toLowerCase());
  if (root.style.getPropertyValue('--simple-theme-accent')) root.style.setProperty('--simple-theme-accent', `color:${value.toLowerCase()}`);
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

// A compact selector replaces the window replica. Keep the canonical definitions and
// shared format popup: no parallel property schema or theme migration is needed.
function settingsThemeIndividualEntries() {
  const entries = Object.entries(UI_STYLE_SECTIONS).flatMap(([section, defs]) =>
    defs.map((def, index) => ({ id: `style/${section}/${index}`, section, label: def.label, def }))
      .filter(entry => !(entry.section === '共通' && entry.label === 'アクセント')));
  for (const target of MeldexThemeManager.THEME_UI_TARGETS || []) {
    entries.push({ id: `target/${target.id}`, section: '状態別配色', label: target.label, targetId: target.id });
  }
  return entries;
}

function settingsThemeIndividualManifest() {
  return settingsThemeIndividualEntries().map(entry => {
    const keys = new Set();
    const add = value => [value].flat().forEach(key => { if (typeof key === 'string' && key.startsWith('--')) keys.add(key); });
    if (entry.def) {
      Object.values(getSettingsThemePreviewPropertyMap(entry.def)).forEach(add);
      for (const prop of ['toggle', 'lineHeight']) add(entry.def[prop]);
      for (const spec of [...(entry.def.numbers || []), ...(entry.def.popupNumbers || [])]) add(spec.key);
    } else {
      const target = MeldexThemeManager.THEME_UI_TARGETS.find(item => item.id === entry.targetId);
      for (const states of [target.vars, target.formatVars])
        for (const props of Object.values(states || {})) Object.values(props).forEach(add);
    }
    if (entry.section === 'ノート') ['--page-margin-x', '--page-content-max-width'].forEach(add);
    if (entry.section === 'ボード') ['--bd-shadow', '--bd-auto-align', '--bd-bg-image', '--bd-bg-image-fit', '--bd-bg-image-scale'].forEach(add);
    return { id: entry.id, section: entry.section, label: entry.label, targetId: entry.targetId || '', keys: [...keys].sort() };
  });
}

function renderSettingsThemeIndividualEditor() {
  const groups = new Map();
  for (const entry of settingsThemeIndividualEntries()) {
    if (!groups.has(entry.section)) groups.set(entry.section, []);
    groups.get(entry.section).push(`<option value="${esc(entry.id)}">${esc(entry.label)}</option>`);
  }
  return `<section class="gb-section gb-section--boxed" data-settings-view="theme" data-settings-theme-individual>
    <div class="gb-section-title">個別設定 ${fieldHelp('一括設定で変更しない色・数値・表示や、状態ごとの配色を設定します。', { e2eId: 'settings-theme-individual-help' })}</div>
    <div class="gb-field-row settings-theme-individual-row">
      <select class="gb-select" aria-label="個別設定する項目" data-e2e-id="settings-theme-individual-select" data-settings-theme-individual-select>${[...groups].map(([group, items]) => `<optgroup label="${esc(group)}">${items.join('')}</optgroup>`).join('')}</select>
      <button type="button" class="gb-btn" data-e2e-id="settings-theme-individual-open" data-settings-theme-individual-open title="選んだ項目を設定">設定…</button>
    </div>
  </section>`;
}

function settingsThemeOpenIndividual(button) {
  const root = button.closest('[data-settings-theme-individual]');
  const entry = settingsThemeIndividualEntries().find(item => item.id === root.querySelector('select').value);
  if (!entry) return;
  // Remove state from the previous selection before opening the shared popup.
  for (const key of ['styleSection', 'styleLabel', 'themeUiTargetId', 'themeUiStateId', 'themeUiEditStateId']) delete button.dataset[key];
  button.dataset.styleLabel = entry.label;
  if (entry.targetId) {
    button.dataset.themeUiTargetId = entry.targetId;
    button.dataset.themeUiStateId = 'normal';
  } else button.dataset.styleSection = entry.section;
  button.dataset.settingsThemeIndividualId = entry.id;
  openStylePreviewPopup(button);
}

// Shared popup extension for settings that are not format/color properties.
function settingsThemePreviewExtraControls(def, anchor) {
  if (!anchor.closest('[data-settings-theme-individual]')) return null;
  const root = document.createElement('div');
  root.className = 'settings-theme-individual-extras';
  root.dataset.settingsThemePopupExtras = '1';
  const section = anchor.dataset.styleSection;
  let html = def.type === 'rubyPresentationDefaults' ? MeldexRubySettingsUI.globalSettingsHtml({ scope: def.scope }) : '';
  if (section === 'ノート') html += _renderSettingsThemeNoteLayoutRows();
  if (section === 'ボード') html += _renderSettingsThemeBoardExtras();
  if (def.toggle) html += `<label class="gb-field-row"><span>${esc(def.label)}の表示</span><input type="checkbox" data-settings-theme-popup-toggle="${esc(def.toggle)}"${/^0(?:px)?$/.test(getCssVar(def.toggle)) ? '' : ' checked'}></label>`;
  root.innerHTML = html;
  root.querySelector('[data-settings-theme-popup-toggle]')?.addEventListener('change', event => {
    applySettingsThemeStyleSetting(def.toggle, event.target.checked ? (def.toggleOn || '1') : (def.toggleOff || '0'));
    _settingsThemeMarkDirty();
  });
  return root;
}

// Existing theme callers use this notification after a draft change.
function refreshSettingsThemePreview() {
  syncSettingsSimpleThemeSwatches(document);
  _settingsThemeSyncAccentSwatch();
}

function renderSettingsAppearancePanel(currentTheme, options = {}) {
  const themeOptions = typeof MeldexThemeManager !== 'undefined'
    ? MeldexThemeManager.themeOptionsHtml(currentTheme)
    : Object.keys(THEME_PRESETS).map(n => '<option value="' + esc(n) + '"' + (n === currentTheme ? ' selected' : '') + '>' + esc(n) + '</option>').join('');
  return `<div class="settings-theme-workspace" data-settings-theme-workspace="1">
    <section class="gb-section gb-section--boxed" data-settings-view="theme" data-settings-theme-summary="1">
      <div class="gb-section-title">${lucide('palette', 14)} テーマ</div>
      <div class="gb-field-row" style="align-items:center;">
        <select id="modal-theme-preset" data-onchange="settingsThemeSelect(this.value)" class="gb-select gb-select-column">
          ${themeOptions}
        </select>
        ${_settingsThemeMenuButton()}
      </div>
    </section>
    <section class="gb-section gb-section--boxed settings-theme-controls" data-settings-view="theme">
      <div class="gb-section-title">共通カラーパレット</div>
      ${typeof renderSettingsThemePaletteEditor === 'function' ? renderSettingsThemePaletteEditor({ id: 'settings-theme-palette-editor', leftFooter: renderSettingsThemeAccentEditor() }) : renderThemeColorSetEditor(null, { hideLabel: true })}
    </section>
    ${renderSettingsSimpleThemeEditor()}
    ${renderSettingsThemeIndividualEditor()}
  </div>`;
}

function ensureSettingsThemePanel(panel, options = {}) {
  const root = panel?.matches?.('.settings-panel[data-panel="テーマ"]')
    ? panel
    : panel?.querySelector?.('.settings-panel[data-panel="テーマ"]');
  if (!root) return;
  const selectedId = options.selectedId || root.dataset.settingsThemeSelectedId || _settingsThemeCurrentId();
  const activeStyleTab = options.activeStyleTab || root.dataset.settingsThemeActiveStyleTab || _settingsThemeActiveStyleTab(root);
  const hasRenderedStyleTab = Object.prototype.hasOwnProperty.call(options, 'renderedStyleTab');
  const renderedStyleTab = hasRenderedStyleTab
    ? String(options.renderedStyleTab || '')
    : (root.querySelector?.('[data-settings-theme-style-panel][data-settings-theme-style-rendered="1"]')?.dataset?.settingsThemeStylePanel || '');
  const hasDeferStyleRows = Object.prototype.hasOwnProperty.call(options, 'deferStyleRows');
  const deferStyleRows = options.deferStyleRows === true
    || (!hasDeferStyleRows && root.dataset.settingsThemeRendered !== '1' && !renderedStyleTab);
  if (options.force !== true && root.dataset.settingsThemeRendered === '1' && root.querySelector('[data-settings-theme-summary="1"]')) {
    return;
  }
  root.innerHTML = renderSettingsAppearancePanel(selectedId, {
    activeStyleTab,
    deferStyleRows,
    renderedStyleTab,
  });
  root.dataset.settingsThemeRendered = '1';
  root.dataset.settingsThemeSelectedId = selectedId || '';
  root.dataset.settingsThemeActiveStyleTab = activeStyleTab || '';
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

function _settingsThemeCollapsedSubsection(title, body) {
  if (!body) return '';
  return `<details class="gb-section gb-section--detail settings-theme-subsection settings-theme-subsection--collapsed">
    <summary class="gb-section-title">${esc(title)}</summary>
    ${body}
  </details>`;
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
  return _settingsThemeCollapsedSubsection('テーマカラーの自動適用設定', renderThemeUiApplicationEditor({ hideLabel: true, targetIds, showReset: false }));
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
    return _settingsThemeCollapsedSubsection('テーマカラーの自動適用設定', renderThemeUiApplicationEditor({ hideLabel: true, group: 'ui' }))
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
  // Runtime already paints the canvas background along with the theme vars.
  if (typeof bd !== 'undefined' && typeof MeldexThemeManager !== 'undefined' && typeof MeldexThemeManager.applyBoardThemeRuntime === 'function') {
    const canvas = typeof bdGetBoardElement === 'function' ? bdGetBoardElement('canvas') : document.getElementById('bd-canvas');
    const world = typeof bdGetBoardElement === 'function' ? bdGetBoardElement('world') : document.getElementById('bd-world');
    MeldexThemeManager.applyBoardThemeRuntime(bd, canvas, world);
  } else if (typeof _bdApplyCurrentBoardBackground === 'function') _bdApplyCurrentBoardBackground();
}

function settingsThemeBoardToggleShadow(input) {
  if (_settingsThemeBoardReadonlyCheck(input)) { input.checked = !input.checked; return; }
  // '1'/'0' の2値で保存（saveColorSettings は空文字を保存しないため）。
  // bd._fileStyle 側は '1'/'' を使う既存仕様に注意。どちらも on=真、それ以外=偽で評価される。
  _settingsThemeBoardSetVar('--bd-shadow', input.checked ? '1' : '0');
}

function settingsThemeBoardToggleAutoAlign(input) {
  if (_settingsThemeBoardReadonlyCheck(input)) { input.checked = !input.checked; return; }
  _settingsThemeBoardSetVar('--bd-auto-align', input.checked ? '1' : '0');
}

function settingsThemeBoardSetBgFit(value) {
  const allowed = ['contain', 'cover', 'auto', 'repeat', 'world'];
  const next = allowed.includes(value) ? value : 'contain';
  _settingsThemeBoardSetVar('--bd-bg-image-fit', next);
  // スケール行の表示切替
  const panel = _settingsThemeBoardControlsRoot();
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
  const panel = _settingsThemeBoardControlsRoot();
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
      const overlay = document.querySelector('[data-e2e-id="settings-dialog-overlay"]');
      if (overlay?.__settingsMaintenanceBusy || overlay?.getAttribute('aria-busy') === 'true') { input.remove(); return; }
      const boardPath = bd.path;
      const previousImage = document.documentElement.style.getPropertyValue('--bd-bg-image');
      const previousDirty = !!window._settingsThemeDirty;
      const roots = [...new Set([overlay, panel?.closest?.('[role="dialog"]') || panel].filter(Boolean))];
      const controls = [...new Set(roots.flatMap(root => [...root.querySelectorAll('input, select, textarea, button')]))];
      const disabled = controls.map(control => control.disabled);
      if (overlay) overlay.__settingsMaintenanceBusy = true;
      controls.forEach(control => { control.disabled = true; });
      let previewUrl = '', uploadedUrl = '';
      if (typeof showStatus === 'function') showStatus('背景画像を読み込んでいます...');
      try {
        const reader = new FileReader();
        const dataUrl = await new Promise((resolve, reject) => {
          reader.onload = e => resolve(e.target.result);
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(file);
        });
        if (bd.path !== boardPath || panel && !panel.isConnected) throw new Error('背景画像の設定先が変わりました');
        // The draft previews local bytes immediately; settings cannot commit
        // until the durable image path replaces these temporary bytes.
        // A raw data URI contains a semicolon and is not a valid unquoted
        // custom-property value. A scoped object URL is safe for this draft.
        previewUrl = URL.createObjectURL(file);
        _settingsThemeBoardSetVar('--bd-bg-image', previewUrl);
        // Let the selected image reach the screen before upload bookkeeping
        // and its workspace refreshes can consume the next frame.
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const dir = (() => {
          const p = String(boardPath || '');
          const i = p.lastIndexOf('/');
          return i >= 0 ? p.substring(0, i) : '';
        })();
        const res = await apiFetch('/upload-file?path=' + encodeURIComponent(dir), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ data: dataUrl, filename: file.name || 'background.png' }),
        });
        if (!res?.ok || !res.path) throw new Error('upload failed');
        if (bd.path !== boardPath || panel && !panel.isConnected) throw new Error('背景画像の設定先が変わりました');
        uploadedUrl = window.MeldexResourceUrl?.fileRaw?.(res.path)
          || API_BASE + '/file-raw?path=' + encodeURIComponent(res.path);
        _settingsThemeBoardSetVar('--bd-bg-image', uploadedUrl);
        // パネル再描画
        _settingsThemeRefreshBoardExtras();
        if (typeof showStatus === 'function') showStatus('背景画像を設定しました');
      } catch {
        const current = document.documentElement.style.getPropertyValue('--bd-bg-image');
        if (previewUrl && (current === previewUrl || uploadedUrl && current === uploadedUrl)) {
          _settingsThemeBoardSetVar('--bd-bg-image', previousImage);
          if (typeof _settingsThemeSetDirty === 'function') _settingsThemeSetDirty(previousDirty);
        }
        if (typeof showStatus === 'function') showStatus('背景画像の設定に失敗しました', true);
      } finally {
        controls.forEach((control, index) => { control.disabled = disabled[index]; });
        if (overlay) overlay.__settingsMaintenanceBusy = false;
        if (previewUrl) URL.revokeObjectURL(previewUrl);
      }
    }
    input.remove();
  });
  document.body.appendChild(input);
  input.click();
}

function settingsThemeBoardClearBgImage() {
  const panel = _settingsThemeBoardControlsRoot();
  if (panel && _settingsThemeBoardReadonlyCheck(panel)) return;
  _settingsThemeBoardSetVar('--bd-bg-image', '');
  _settingsThemeBoardSetVar('--bd-bg-image-scale', '');
  _settingsThemeRefreshBoardExtras();
}

function _settingsThemeBoardControlsRoot() {
  return document.querySelector('[data-settings-theme-popup-extras]')
    || document.querySelector('[data-settings-theme-style-panel="ボード"]');
}

function _settingsThemeRefreshBoardExtras() {
  const panel = _settingsThemeBoardControlsRoot();
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
  bindSettingsSimpleThemeEditor(panel);
  panel.querySelector('[data-settings-theme-individual-open]')?.addEventListener('click', event => settingsThemeOpenIndividual(event.currentTarget));
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
  settingsThemeSetSimpleMode('detail');
  const pageId = 'theme';
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

async function _persistSettingsThemeImmediately() {
  if (typeof saveColorSettings === 'function' && saveColorSettings() === false) return false;
  if (typeof _saveUiConfigToServer === 'function') {
    try { await _saveUiConfigToServer(); }
    catch (error) {
      console.warn('テーマの永続保存に失敗:', error);
      if (typeof showStatus === 'function') showStatus('テーマを保存先へ書き込めませんでした', true);
      return false;
    }
  }
  return true;
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
  if (!opts.deferPersistence && !await _persistSettingsThemeImmediately()) return false;
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

async function settingsThemeSave(options = {}) {
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
  if (!opts.deferPersistence && !await _persistSettingsThemeImmediately()) return false;
  if (typeof _settingsThemeSetDirty === 'function') _settingsThemeSetDirty(false);
  if (!opts.skipRefresh) _refreshSettingsThemePanel(saved.id);
  if (!opts.silent) showStatus('デフォルトとして保存しました', false, { showSaveDialog: true });
  return true;
}

async function settingsThemeSaveFromSettingsDialog(options = {}) {
  const opts = options && typeof options === 'object' ? options : {};
  if (typeof _settingsThemeIsDirty === 'function' && !_settingsThemeIsDirty()) return true;
  if (typeof MeldexThemeManager === 'undefined') return true;
  if (_settingsThemeIsCustom()) return settingsThemeSave({ silent: true, skipRefresh: !!opts.skipRefresh, deferPersistence: !!opts.deferPersistence });
  const current = _settingsThemeCurrent();
  const created = await settingsThemeCreate({
    silent: true,
    skipRefresh: !!opts.skipRefresh,
    deferPersistence: !!opts.deferPersistence,
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
