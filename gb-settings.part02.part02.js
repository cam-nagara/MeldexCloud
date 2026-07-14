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
    const swatches = getStandardPaletteSwatches(adjust, { themeSlots: false }).filter(swatch => swatch.row === 3).map(swatch => swatch.color);
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

function renderSettingsThemePaletteEditor(options = {}) {
  const editorId = options.id || 'settings-theme-palette-editor';
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
  const containers = root?.matches?.('[data-theme-palette-matrix]')
    ? [root]
    : Array.from(root?.querySelectorAll?.('[data-theme-palette-matrix]') || []);
  if (!containers.length) return;
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
  containers.forEach(container => {
    container.innerHTML = '';
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
