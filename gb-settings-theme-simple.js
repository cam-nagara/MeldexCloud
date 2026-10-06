/* Bulk color and decoration controls for the shared UI; uses the existing theme save/cancel contract. */
let _settingsThemeSimpleMode = (() => {
  try { return localStorage.getItem('meldex-settings-theme-mode') === 'simple' ? 'simple' : 'detail'; }
  catch { return 'detail'; }
})();
const SETTINGS_SIMPLE_THEME_BASE_KEYS = Object.freeze([
  '--bg', '--bg2', '--bg3', '--bg4', '--fg', '--fg2', '--border', '--selection', '--accent', '--accent2',
  '--ui-bg-app', '--ui-bg-panel', '--ui-bg-surface', '--ui-border', '--ui-border-strong', '--ui-popup-border', '--ui-fg-muted', '--ui-fg-strong',
  ...['background', 'surface', 'control', 'text', 'muted', 'border', 'hover', 'selected', 'selectedText', 'accent'].map(id => `--simple-theme-${id}`),
  '--page-link-hover-fg', '--ui-accent', '--ui-panelset-tabbar-bg',
  '--ui-bg-control', '--ui-bg-control-hover', '--ui-bg-control-active', '--ui-fg-default', '--ui-control-active-fg', '--link-fg',
]);
const SETTINGS_SIMPLE_THEME_FIELDS = Object.freeze([
  { id: 'background', label: '全体の背景色', key: '--bg', fallback: '#0b0d10' },
  { id: 'surface', label: 'パネル・ダイアログ・ポップアップの背景色', key: '--ui-popup-bg', fallback: '#181c22' },
  { id: 'control', label: 'ボタン・入力欄・通常タブ・項目の背景色', key: '--ui-button-bg', fallback: '#242a32' },
  { id: 'text', label: '通常の文字・アイコン色', key: '--fg', fallback: '#d4d4d4' },
  { id: 'muted', label: '補助文字・補助アイコン色', key: '--fg2', fallback: '#969696' },
  { id: 'border', label: '枠線・罫線・区切り線の色', key: '--border', fallback: '#2b323b' },
  { id: 'hover', label: 'ホバー時の背景色', key: '--ui-hover-bg', fallback: '#242a32' },
  { id: 'selected', label: '選択中・アクティブ状態の背景色', key: '--ui-selection-bg', fallback: '#264f78' },
  { id: 'selectedText', label: '選択中・アクティブ状態の文字・アイコン色', key: '--ui-selection-fg', fallback: '#ffffff' },
  { id: 'accent', label: 'アクセント色', key: '--ui-accent', fallback: '#569cd6' },
]);

function settingsThemeSyncSimpleModeVisibility(root) {
  settingsThemeSetSimpleMode(_settingsThemeSimpleMode, root);
}

function settingsThemeSimpleSelections() {
  return Object.fromEntries(SETTINGS_SIMPLE_THEME_FIELDS.map(field => {
    const stored = getCssVar(`--simple-theme-${field.id}`).trim();
    const matchesCurrent = document.documentElement.style.getPropertyValue(field.key).trim() === _settingsSimpleResolve(stored);
    const hex = parseColorToHexAlpha(getCssVar(field.key)).hex;
    return [field.id, /^(?:none|os-accent|auto(?:-light|-dark)?|auto-rows:[1-4](?:,[1-4])*|[0-7]|color:#[0-9a-f]{6})$/i.test(stored) && matchesCurrent
      ? stored : `color:${/^#[0-9a-f]{6}$/i.test(hex || '') ? hex : field.fallback}`];
  }));
}

function _settingsSimpleResolve(value) {
  const single = { auto: 3, 'auto-light': 2, 'auto-dark': 4 }[value]
    || (/^auto-rows:[234](?:,[1-4])*$/.test(value) ? Number(value.slice(10, 11)) : 0);
  if (!single) return MeldexThemeManager.resolveThemeUiColor(value) || 'transparent';
  const color = 'var(--theme-palette-0, #569cd6)';
  if (single === 3) return color;
  const amount = `var(--theme-ui-auto-${single === 2 ? 'light' : 'dark'}-percent, 30%)`;
  return `color-mix(in srgb, ${color} calc(100% - ${amount}), ${single === 2 ? 'white' : 'black'} ${amount})`;
}

function settingsThemeSimpleValues() {
  return Object.fromEntries(Object.entries(settingsThemeSimpleSelections()).map(([id, value]) => [id, _settingsSimpleResolve(value)]));
}

function renderSettingsSimpleThemeEditor() {
  const colors = settingsThemeSimpleValues();
  return `<section class="gb-section gb-section--boxed" data-settings-simple-theme data-settings-view="theme" hidden>
    <div class="gb-section-title">一括設定</div>
    <div class="gb-section-desc">変更した色・装飾だけを対応するUIへ一括適用します。適用後もプレビューから個別に編集できます。</div>
    <div class="settings-simple-theme-grid">
    ${SETTINGS_SIMPLE_THEME_FIELDS.map(field => `<div class="gb-field-row" data-simple-theme-item="${field.id}">
      <span class="cs-row-label">${esc(field.label)}</span>
      <button type="button" class="cs-swatch" data-e2e-id="settings-simple-theme-color-${field.id}" data-simple-theme-color="${field.id}" aria-label="${esc(field.label)}を設定" title="${esc(field.label)}" style="background:${colors[field.id]}"></button>
    </div>`).join('')}
    </div>
    <div class="gb-field-row"><span class="cs-row-label">装飾</span><button type="button" class="gb-btn" data-settings-bulk-decoration data-e2e-id="settings-theme-bulk-decoration">装飾を一括設定…</button></div>
  </section>`;
}

function settingsThemeSetSimpleMode(mode, root) {
  _settingsThemeSimpleMode = mode === 'simple' ? 'simple' : 'detail';
  try { localStorage.setItem('meldex-settings-theme-mode', _settingsThemeSimpleMode); } catch {}
  const workspace = root?.closest?.('[data-settings-theme-workspace]') || root?.querySelector?.('[data-settings-theme-workspace]') || document.querySelector('[data-settings-theme-workspace]');
  if (!workspace) return;
  const simple = true;
  workspace.querySelector('[data-settings-simple-theme]').hidden = !simple;
  workspace.querySelectorAll('[data-simple-theme-detail]').forEach(el => {
    el.hidden = simple;
  });
  workspace.querySelectorAll('[data-simple-theme-mode]').forEach(button => {
    const selected = button.dataset.simpleThemeMode === _settingsThemeSimpleMode;
    button.setAttribute('aria-selected', String(selected));
    button.tabIndex = selected ? 0 : -1;
    button.classList.toggle('gb-inner-tab-active', selected);
  });
  syncSettingsSimpleThemeSwatches(workspace);
}

// Resolve semantic roles from the actual property definitions, not a parallel list of apps.
function _settingsSimpleThemeRole(key, prop = '', label = '') {
  if (key.startsWith('--simple-theme-')) return '';
  const baseRoles = { '--bg': 'background', '--bg2': 'surface', '--bg3': 'control', '--bg4': 'hover', '--fg': 'text', '--fg2': 'muted', '--selection': 'selected' };
  if (baseRoles[key]) return baseRoles[key];
  if (/(?:shadow|saturday|sunday)/i.test(key)) return 'semantic';
  if (/(?:font|line-height|width|height|padding|margin|radius|opacity|alpha|space|enabled|image|shadow|align|show-grid)/i.test(key)) return '';
  if (/^--(?:red|green|orange|blue)$/.test(key) || /(?:error|warning|danger|success|status|badge|priority|weekend|holiday)/i.test(key + ' ' + label)) return 'semantic';
  if (/(?:selection|selected|select-rect|drag-select|today|active|checked|adopted)/i.test(key)) return prop === 'fg' || /(?:-fg|-text-color)$/.test(key) ? 'selectedText' : prop === 'bg' || (!prop && /(?:-bg|selection-color)$/.test(key)) ? 'selected' : 'accent';
  if (/^--page-link(?:-hover)?-bg$/.test(key)) return 'transparent';
  if (/link/.test(key) && prop === 'bg') return /hover/.test(key) ? 'hover' : 'control';
  if (/(?:accent|link|caret|focus|drop|range-fill|now-line)/i.test(key)) return prop === 'bg' ? 'accent' : /(?:-fg)$/.test(key) && /accent/.test(key) ? 'selectedText' : 'accent';
  if (/(?:-width|-size|-opacity|-radius|-style|-weight)$/.test(key)) return '';
  if (prop === 'line' || prop === 'stroke' || /(?:border|separator|grid)/i.test(key)) return 'border';
  if (/(?:hover)/i.test(key)) return prop === 'fg' || /-fg$/.test(key) ? 'text' : 'hover';
  if (/(?:muted|meta|secondary|subtext|placeholder)/i.test(key)) return 'muted';
  if (prop === 'fg' || /(?:-fg|-text-color)$/.test(key)) return 'text';
  if (prop === 'bg' || /-bg$/.test(key)) return /(?:panel|modal|popup|tooltip|toolbar|header|tabbar|dockbar|content|page-text-bg|sn2-page-bg|outliner-bg|preview-bg|detail-bg|chat-bg|history-bg|annotation-bg|search-bg|version-bg|bd-bg|cal-content-bg|db-row-bg)/i.test(key) ? 'surface' : 'control';
  return '';
}

function settingsThemeBuildSimpleStyles(colors, definitions, targets, base) {
  const styles = {};
  const selectedText = colors.selectedText;
  const values = { ...colors, transparent: 'transparent' };
  const assign = (key, prop, label) => {
    if (!key) return;
    const role = _settingsSimpleThemeRole(key, prop, label);
    if (values[role]) styles[key] = values[role];
  };
  Object.keys(base || {}).forEach(key => assign(key));
  for (const defs of Object.values(definitions)) for (const def of defs) {
    for (const prop of ['fg', 'bg', 'line', 'stroke', 'accent']) assign(def[prop], prop, def.label);

  }
  for (const target of targets) for (const [state, props] of Object.entries(target.vars || {})) {
    for (const [prop, raw] of Object.entries(props)) for (const key of [raw].flat()) {
      if (_settingsSimpleThemeRole(key, prop, '') === 'semantic') continue;
      assign(key, prop === 'underline' ? 'line' : prop);
    }
  }
  Object.assign(styles, {
    '--bg': colors.background, '--bg2': colors.surface, '--bg3': colors.control, '--bg4': colors.hover,
    '--fg': colors.text, '--fg2': colors.muted, '--border': colors.border,
    '--accent': colors.accent, '--accent2': colors.accent, '--ui-accent': colors.accent,
    '--ui-accent-fg': selectedText, '--ui-selection-fg': selectedText, '--ui-selection-bg': colors.selected,
    '--selection': colors.selected, '--ui-hover-bg': colors.hover, '--ui-button-bg': colors.control,
    '--ui-popup-bg': colors.surface, '--ui-modal-bg': colors.surface, '--content-bg': colors.surface,
    '--ui-bg-control': colors.control, '--ui-bg-control-hover': colors.hover, '--ui-bg-control-active': colors.selected,
    '--ui-bg-app': colors.background, '--ui-bg-panel': colors.surface, '--ui-bg-surface': colors.surface,
    '--ui-border': colors.border, '--ui-border-strong': colors.border, '--ui-popup-border': colors.border,
    '--ui-fg-muted': colors.muted, '--ui-fg-strong': colors.text,
    '--ui-fg-default': colors.text, '--ui-control-active-fg': selectedText, '--link-fg': colors.accent,
    '--page-link-fg': colors.accent, '--page-link-hover-fg': colors.accent,
    '--editor-caret-color': colors.accent, '--a11y-focus-ring': colors.accent,
    '--ui-range-fill-bg': colors.accent, '--ui-range-track-bg': colors.control,
  });
  return styles;
}

function settingsThemeSimpleDecorationStyles(dark) {
  const decoration = /(?:font|bold|italic|line-height|line-style|stroke-(?:color|width)|left-accent|underline|width|height|radius|padding|margin|opacity|indent|space-before|space-after|gap|shadow|spacing|tracking|align)/i;
  return Object.fromEntries(getAllStyleKeys().filter(key => !key.startsWith('--simple-theme-') && decoration.test(key))
    .map(key => [key, dark.ui.cssVars[key] || '']));
}

// Explicit bulk edits remain independent of the palette's shared accent control.
function settingsThemeExplicitColorKeys() {
  const root = document.documentElement;
  const roles = Object.fromEntries(SETTINGS_SIMPLE_THEME_FIELDS.map(field => [field.id, field.id]));
  const edited = new Set(['selected', 'selectedText', 'accent'].filter(id =>
    root.style.getPropertyValue(`--simple-theme-${id}`).trim()));
  if (!edited.size) return new Set();
  const base = Object.assign(Object.fromEntries(getAllStyleKeys().map(key => [key, ''])), MeldexThemeManager.getThemeById('builtin-dark').ui.cssVars);
  const mapping = settingsThemeBuildSimpleStyles(roles, UI_STYLE_SECTIONS, MeldexThemeManager.THEME_UI_TARGETS, base);
  return new Set(Object.entries(mapping).filter(([,role]) => edited.has(role)).map(([key]) => key));
}

function settingsThemeApplySimpleColors(overrides = {}) {
  const selections = { ...settingsThemeSimpleSelections() };
  for (const [id, value] of Object.entries(overrides)) {
    if (!(id in selections)) return false;
    selections[id] = /^#[0-9a-f]{6}$/i.test(value) ? `color:${value}` : value;
  }
  if (Object.values(selections).some(value => !/^(?:none|os-accent|auto(?:-light|-dark)?|auto-rows:[1-4](?:,[1-4])*|[0-7]|color:#[0-9a-f]{6})$/i.test(value))) return false;
  const colors = Object.fromEntries(Object.entries(selections).map(([id, value]) => [id, _settingsSimpleResolve(value)]));
  const manager = MeldexThemeManager;
  const changed = new Set(Object.keys(overrides));
  if (!changed.size) return true;
  const roles = Object.fromEntries(SETTINGS_SIMPLE_THEME_FIELDS.map(field => [field.id, field.id]));
  const base = Object.assign(Object.fromEntries(getAllStyleKeys().map(key => [key, ''])), manager.getThemeById('builtin-dark').ui.cssVars);
  const styleRoles = settingsThemeBuildSimpleStyles(roles, UI_STYLE_SECTIONS, manager.THEME_UI_TARGETS, base);
  // Inline links keep the surrounding surface instead of taking the control background.
  const changedBackground = changed.has('control') || changed.has('hover');
  const styles = Object.fromEntries(Object.entries(styleRoles)
    .filter(([, role]) => changed.has(role) || role === 'transparent' && changedBackground)
    .map(([key, role]) => [key, role === 'transparent' ? 'transparent' : colors[role]]));
  const root = document.documentElement;
  const apps = manager.getThemeUiApplications();
  for (const target of manager.THEME_UI_TARGETS) for (const state of target.states) {
    for (const prop of target.props) {
      if (!(prop in (apps[target.id]?.[state] || {}))) continue;
      const rawKeys = target.vars?.[state]?.[prop];
      const role = prop === 'fg' ? (state === 'selected' ? 'selectedText' : 'text')
        : prop === 'bg' ? (state === 'selected' ? 'selected' : state === 'hover' ? 'hover' : 'control')
        : state === 'selected' ? 'accent' : 'border';
      if (target.vars ? ![rawKeys].flat().some(key => changed.has(styleRoles[key])) : !changed.has(role)) continue;
      apps[target.id][state][prop] = target.vars ? 'none'
        : prop === 'fg' ? selections[state === 'selected' ? 'selectedText' : 'text']
        : prop === 'bg' ? selections[state === 'selected' ? 'selected' : state === 'hover' ? 'hover' : 'control']
        : selections[state === 'selected' ? 'accent' : 'border'];
    }
  }
  _runSettingsWithoutLocalStorageHistory(() => {
    manager.saveThemeUiApplications(apps, { skipHistory: true });
    Object.entries(styles).forEach(([key, value]) => root.style.setProperty(key, value));
    for (const id of changed) root.style.setProperty(`--simple-theme-${id}`, selections[id]);
  });
  if (Object.prototype.hasOwnProperty.call(styles, '--bd-bg') && typeof _bdApplyCurrentBoardBackground === 'function') {
    _bdApplyCurrentBoardBackground();
  }
  _settingsThemeMarkDirty();
  refreshSettingsThemePreview();
  syncSettingsSimpleThemeSwatches(document);
  return true;
}

function syncSettingsSimpleThemeSwatches(root) {
  const values = settingsThemeSimpleValues();
  root.querySelectorAll('[data-simple-theme-color]').forEach(button => { button.style.background = values[button.dataset.simpleThemeColor]; });

}

// Reuse the detail popup's property map, including its registered generated keys.
// Only the property explicitly changed here is written; colors and unrelated decorations remain intact.
function settingsThemeBulkDecorationKeys(prop) {
  return [...new Set(Object.values(UI_STYLE_SECTIONS).flatMap(defs => defs.flatMap(def => {
    const map = window.getSettingsThemePreviewPropertyMap(def);
    return map[prop] ? [map[prop]] : [];
  })))];
}

function settingsThemeApplyBulkDecoration(prop, value) {
  const supported = ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'textStrokeColor', 'textStrokeWidth', 'leftAccent', 'underline', 'borderWidth', 'borderStyle', 'lineHeight'];
  if (!supported.includes(prop)) return false;
  let css = value == null ? '' : String(value);
  if (['fontSize', 'textStrokeWidth', 'borderWidth'].includes(prop)) {
    if (value != null && (!Number.isFinite(Number(value)) || Number(value) < 0)) return false;
    css = value == null ? '' : `${Number(value)}px`;
  } else if (prop === 'fontWeight') css = value === 'bold' ? 'bold' : 'normal';
  else if (prop === 'fontStyle') css = value === 'italic' ? 'italic' : 'normal';
  else if (prop === 'leftAccent') css = value ? THEME_STYLE_LEFT_ACCENT_WIDTH : '0px';
  else if (prop === 'underline') css = value ? THEME_STYLE_UNDERLINE_WIDTH : '0px';
  else if (prop === 'lineHeight') {
    if (!Number.isFinite(Number(value)) || Number(value) < 50 || Number(value) > 400) return false;
    css = `${Number(value)}%`;
  } else if (prop === 'borderStyle' && !['none', 'solid', 'dotted', 'dashed'].includes(css)) return false;
  const keys = settingsThemeBulkDecorationKeys(prop);
  _runSettingsWithoutLocalStorageHistory(() => keys.forEach(key => applySettingsThemeStyleSetting(key, css)));
  _settingsThemeMarkDirty();
  refreshSettingsThemePreview();
  return true;
}

function settingsThemeOpenBulkDecoration(button) {
  if (_settingsThemeIsReadonlyElement(button)) { _settingsThemePromptDuplicateForEdit(); return; }
  const extra = document.createElement('label');
  extra.className = 'gb-field-row';
  extra.innerHTML = '行間 <input type="number" class="gb-input" min="50" max="400" step="1" placeholder="個別" aria-label="行間を一括設定" data-e2e-id="settings-theme-bulk-line-height"> %';
  extra.querySelector('input').addEventListener('change', event => {
    if (event.target.value) settingsThemeApplyBulkDecoration('lineHeight', Number(event.target.value));
  });
  const hint = document.createElement('div');
  hint.className = 'gb-section-desc';
  hint.textContent = '操作した装飾だけを、対応する全要素へ適用します。';
  const values = {};
  for (const prop of ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'textStrokeColor', 'textStrokeWidth', 'leftAccent', 'underline', 'borderWidth', 'borderStyle', 'lineHeight']) {
    const distinct = [...new Set(settingsThemeBulkDecorationKeys(prop).map(key => getCssVar(key).trim()))];
    if (distinct.length !== 1) continue;
    const raw = distinct[0];
    values[prop] = ['fontSize', 'textStrokeWidth', 'borderWidth'].includes(prop) ? (raw ? parseFloat(raw) : null)
      : ['leftAccent', 'underline'].includes(prop) ? parseFloat(raw) > 0 : raw;
    if (prop === 'lineHeight' && raw.endsWith('%')) extra.querySelector('input').value = parseFloat(raw);
  }
  openFormatPopup(button, {
    extraRowTop: [hint],
    fields: ['fontFamily', 'fontSize', 'bold', 'italic', 'textStrokeColor', 'textStrokeWidth', 'leftAccent', 'underline', 'borderWidth', 'borderStyle'],
    values,
    extraRow2: [extra],
    onChange: (prop, value) => settingsThemeApplyBulkDecoration(prop, value),
  });
}

function bindSettingsSimpleThemeEditor(root) {
  const workspace = root.querySelector('[data-settings-theme-workspace]');
  if (!workspace || workspace.dataset.simpleThemeBound === '1') return;
  workspace.dataset.simpleThemeBound = '1';
  workspace.querySelector('[data-settings-bulk-decoration]')?.addEventListener('click', event => settingsThemeOpenBulkDecoration(event.currentTarget));
  root.querySelectorAll('[data-simple-theme-mode]').forEach(button => {
    button.addEventListener('click', () => settingsThemeSetSimpleMode(button.dataset.simpleThemeMode, root));
    button.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      settingsThemeSetSimpleMode(event.key === 'Home' ? 'simple' : event.key === 'End' ? 'detail' : _settingsThemeSimpleMode === 'simple' ? 'detail' : 'simple', root);
      root.querySelector('[data-simple-theme-mode][aria-selected="true"]').focus();
    });
  });
  root.querySelectorAll('[data-simple-theme-color]').forEach(button => button.addEventListener('click', () => {
    if (_settingsThemeIsReadonlyElement(button)) { _settingsThemePromptDuplicateForEdit(); return; }
    const id = button.dataset.simpleThemeColor;
    const apply = value => settingsThemeApplySimpleColors({ [id]: value });
    const rows = () => {
      const value = settingsThemeSimpleSelections()[id];
      return value.startsWith('auto-rows:') ? value.slice(10).split(',').map(Number)
        : { auto: [3], 'auto-light': [2], 'auto-dark': [4] }[value] || [];
    };
    openColorPalette(button, settingsThemeSimpleValues()[id], (color, metadata) => {
      if (metadata?.osAccentTone === 'base') apply('os-accent');
      else if (metadata?.preset?.row === 3 && metadata.preset.themeSlot) apply(String(metadata.preset.index));
      else if (color === 'transparent') apply('none');
      else { const hex = parseColorToHexAlpha(color).hex; if (/^#[0-9a-f]{6}$/i.test(hex || '')) apply(`color:${hex}`); }
    }, { themeUi: {
      getRows: rows,
      onRowsChange: selected => apply(selected.length ? `auto-rows:${selected.join(',')}` : 'none'),
      getTone: () => MeldexThemeManager.getThemeUiAutoTone(),
      onToneChange: (kind, value) => { MeldexThemeManager.setThemeUiAutoTone(kind, value); _settingsThemeMarkDirty(); },
    } });
  }));
  settingsThemeSetSimpleMode(_settingsThemeSimpleMode, root);
}

// These markers describe the editor choice only. Colors are ordinary theme CSS vars
// and application settings; theme and palette events must never reapply grouped edits.
function settingsThemeRefreshSimpleReferences() {
  syncSettingsSimpleThemeSwatches(document);
}
for (const event of ['meldex-theme-change', 'meldex-theme-color-set-change', 'meldex-theme-os-accent-change', 'meldex-theme-ui-auto-tone-change', 'meldex-theme-ui-applications-change']) {
  window.addEventListener(event, settingsThemeRefreshSimpleReferences);
}

// Seed ordinary editable themes once, without changing the selected theme or live colors.
const SETTINGS_SIMPLE_PRESETS_SEEDED_KEY = 'meldex-simple-theme-presets-seeded-v1';
function settingsThemeBuildSimplePreset(source, dark) {
  const vars = source.ui.cssVars;
  const colors = {
    background: vars['--bg'], surface: vars['--content-bg'] || vars['--bg2'], control: vars['--bg3'],
    text: vars['--fg'], muted: vars['--fg2'], border: vars['--border'],
    hover: vars['--ui-hover-bg'] || vars['--bg4'], selected: vars['--ui-selection-bg'] || vars['--selection'],
    selectedText: vars['--ui-selection-fg'] || vars['--fg'], accent: vars['--ui-accent'] || vars['--accent'],
  };
  const theme = JSON.parse(JSON.stringify(dark));
  theme.id = `custom-simple-${source.id.replace(/^builtin-/, '')}`;
  theme.name = `${source.name}（シンプル）`;
  theme.builtIn = false;
  const base = Object.assign(Object.fromEntries(getAllStyleKeys().map(key => [key, ''])), dark.ui.cssVars);
  theme.ui.cssVars = { ...dark.ui.cssVars, ...settingsThemeBuildSimpleStyles(colors, UI_STYLE_SECTIONS, MeldexThemeManager.THEME_UI_TARGETS, base) };
  for (const [key, value] of Object.entries(settingsThemeSimpleDecorationStyles(dark))) {
    if (value) theme.ui.cssVars[key] = value; else delete theme.ui.cssVars[key];
  }
  for (const [id, color] of Object.entries(colors)) theme.ui.cssVars[`--simple-theme-${id}`] = `color:${color}`;
  theme.ui.useOsAccentColor = false;
  theme.ui['_theme-use-os-accent'] = false;
  theme['_theme-use-os-accent'] = false;
  const applications = theme.ui.themeUiApplications = {};
  for (const target of MeldexThemeManager.THEME_UI_TARGETS) {
    applications[target.id] = {};
    for (const state of target.states) {
      applications[target.id][state] = {};
      for (const prop of target.props) {
        const role = prop === 'fg' ? (state === 'selected' ? 'selectedText' : 'text')
          : prop === 'bg' ? (state === 'selected' ? 'selected' : state === 'hover' ? 'hover' : 'control')
          : state === 'selected' ? 'accent' : 'border';
        applications[target.id][state][prop] = target.vars ? 'none' : `color:${colors[role]}`;
      }
    }
  }
  return theme;
}

function settingsThemeEnsureInitialSimplePresets() {
  if (typeof MeldexThemeManager === 'undefined') return false;
  const manager = MeldexThemeManager;
  if (!manager.THEME_SETTINGS_KEYS.includes(SETTINGS_SIMPLE_PRESETS_SEEDED_KEY)) manager.THEME_SETTINGS_KEYS.push(SETTINGS_SIMPLE_PRESETS_SEEDED_KEY);
  try {
    if (localStorage.getItem(SETTINGS_SIMPLE_PRESETS_SEEDED_KEY) === '1') return true;
    // A malformed saved list must be preserved, not replaced with the seed themes.
    const raw = localStorage.getItem(manager.CUSTOM_THEMES_KEY);
    if (raw != null && !Array.isArray(JSON.parse(raw))) return false;
    const existing = manager.getCustomThemes();
    const dark = manager.getThemeById('builtin-dark');
    const presets = ['dark', 'light', 'pastel', 'earth'].map(id => settingsThemeBuildSimplePreset(manager.getThemeById(`builtin-${id}`), dark));
    const additions = presets.filter(theme => !existing.some(item => item.id === theme.id));
    if (additions.length) manager.saveCustomThemes([...existing, ...additions], { skipHistory: true });
    localStorage.setItem(SETTINGS_SIMPLE_PRESETS_SEEDED_KEY, '1');
    return true;
  } catch {
    return false;
  }
}
