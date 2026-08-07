/* gb-detail-panel.part02.js */
// 行ラベル（例: "タイトル"）と field.label（例: "タイトル 色"）から短いラベルを返す。
// 行プレフィックスが一致したら除去、なければそのまま。
function _fsShortLabel(field, rowLabel) {
  if (!rowLabel) return field.label;
  if (field.label === rowLabel) return '';
  if (field.label.startsWith(rowLabel + ' ')) return field.label.slice(rowLabel.length + 1);
  if (field.label.startsWith(rowLabel)) {
    const short = field.label.slice(rowLabel.length).trimStart().replace(/^[をの]\s*/, '');
    return short || field.label;
  }
  return field.label;
}

function _fsBuildFieldInline(field, adapter, rowLabel) {
  // toggle は B/I or テキスト付きボタンで内蔵記号があるため、外側ラベルを付けない
  // checkbox は <input type="checkbox"> にラベルを付けた一体コンポーネントを返す
  if (field.type === 'toggle' || field.type === 'checkbox') {
    return _fsBuildControl(field, adapter, rowLabel);
  }
  // color / select / number / text / pxtext は短いラベル付きグループにまとめる
  const group = document.createElement('span');
  group.className = 'gb-fmt-popup-group';
  const label = document.createElement('span');
  label.className = 'gb-fmt-label';
  label.textContent = _fsShortLabel(field, rowLabel);
  if (field.label !== rowLabel) group.appendChild(label);
  group.appendChild(_fsBuildControl(field, adapter, rowLabel));
  if (field.type === 'number' && field.unit) {
    const unit = document.createElement('span');
    unit.className = 'gb-fmt-label';
    unit.textContent = field.unit;
    group.appendChild(unit);
  }
  return group;
}

function _fsBuildRowPreview(rowData, adapter) {
  const fields = rowData?.fields || [];
  const findBy = (test) => fields.find(test);
  const fontField = findBy(f => f.preview === 'fontSample' || f.key === '--bd-default-font-family');
  const fontSizeField = findBy(f => /font-size$/i.test(f.key || f.cssVar || '') || /FontSize$/i.test(f.key || ''));
  const fgField = findBy(f => f.type === 'color' && /(?:fg|color)$/i.test(f.key || '') && !/bg|border|grid|selection|caret|shadow/i.test(f.key || ''));
  const bgField = findBy(f => f.type === 'color' && /bg/i.test(f.key || ''));
  const lineField = findBy(f => f.type === 'color' && /border|grid|hr|active|shadow/i.test(f.key || ''));
  const boldField = findBy(f => f.type === 'toggle' && f.on === 'bold');
  const italicField = findBy(f => f.type === 'toggle' && f.on === 'italic');
  const sample = document.createElement('span');
  sample.className = 'cs-row-preview';
  sample.textContent = fontField ? 'あア A1 - 今日は快晴' : (lineField && !fgField && !bgField ? '━━' : (rowData.label || 'Aa1'));
  if (fontField) sample.dataset.previewKind = 'font';
  const fg = fgField ? _fsReadFieldValue(fgField, adapter) : '';
  const bg = bgField ? _fsReadFieldValue(bgField, adapter) : '';
  const line = lineField ? _fsReadFieldValue(lineField, adapter) : '';
  const bold = boldField ? _fsReadFieldValue(boldField, adapter) : '';
  const italic = italicField ? _fsReadFieldValue(italicField, adapter) : '';
  const fontFamily = fontField ? _fsNormalizeFieldValue(fontField, _fsReadFieldValue(fontField, adapter)) : '';
  const previewSize = typeof STYLE_PREVIEW_FONT_SIZES !== 'undefined'
    ? (STYLE_PREVIEW_FONT_SIZES[rowData.label] || STYLE_PREVIEW_FONT_SIZES['見出し ' + rowData.label] || '')
    : '';
  const fontSize = fontSizeField ? _fsReadFieldValue(fontSizeField, adapter) : previewSize;
  sample.style.background = bg || 'var(--bg)';
  sample.style.color = fg || line || 'var(--fg)';
  if (line) sample.style.borderBottom = '3px solid ' + line;
  if (bold === 'bold') sample.style.fontWeight = 'bold';
  if (italic === 'italic') sample.style.fontStyle = 'italic';
  if (fontSize) sample.style.fontSize = /^\d+(\.\d+)?$/.test(String(fontSize)) ? fontSize + 'px' : String(fontSize);
  if (fontField) sample.style.fontFamily = fontFamily || 'var(--bd-default-font-family, var(--bd-theme-font-family, var(--ui-font, inherit)))';
  return sample;
}

function _fsResolveSections(ctx, spec) {
  const byKey = Object.fromEntries([...spec.display, ...spec.editOps].map(field => [field.key, field]));
  const pick = (keys) => keys.map(key => byKey[key]).filter(Boolean);

  if (ctx === 'folder') {
    return [
      {
        title: '書式設定',
        rows: [
          { label: 'カード', fields: pick(['--fv-item-fg', '--fv-item-bg', '--fv-font-family']) },
          { label: 'カード枠線', fields: pick(['--fv-item-border']) },
          { label: 'ホバー', fields: pick(['--fv-item-hover-bg']) },
          { label: '選択', fields: pick(['--fv-item-selected-fg', '--fv-item-selected-bg']) },
          { label: 'メタ情報', fields: pick(['--fv-meta-fg']) },
          { label: 'アイコン', fields: pick(['--fv-icon-fg']) },
        ],
      },
    ];
  }

  if (ctx === 'scriptnote') {
    return [
      {
        title: '書式設定',
        rows: [
          { label: '基本テキスト', fields: pick(['baseTextColor', 'baseTextFontFamily', 'baseTextBold', 'baseTextItalic', 'baseTextFontSize']) },
          { label: '枠線', fields: pick(['borderColor', 'borderWidth']) },
          { label: '見開き区切り', fields: pick(['spreadBorderColor', 'spreadBorderWidth']) },
          { label: 'ホバー', fields: pick(['hoverBgColor']) },
          { label: 'テキスト選択', fields: pick(['selectionTextColor', 'selectionColor']) },
          { label: 'ドラッグ選択', fields: pick(['dragSelectColor']) },
          { label: 'ドロップ', fields: pick(['dropIndicatorColor', 'dropIndicatorWidth']) },
          { label: 'カーソル', fields: pick(['caretColor', 'caretWidth']) },
        ],
      },
      {
        title: 'レイアウト',
        rows: [
          { label: '行間', fields: pick(['baseTextLineHeightH', 'baseTextLineHeightV']) },
          { label: '字間', fields: pick(['baseTextLetterSpacingH', 'baseTextLetterSpacingV']) },
          { label: 'ルビ', fields: pick(['rubyFontSize', 'rubyOffset']) },
          { label: '折り返し', fields: pick(['wrapMode']) },
        ],
      },
    ];
  }

  if (ctx === 'page') {
    return [
      {
        title: '書式設定',
        rows: [
          { label: 'タイトル', fields: pick(['--page-title-fg', '--page-title-bg', '--page-title-bold', '--page-title-italic', '--page-title-font']) },
          { label: '見出し H1', fields: pick(['--page-h1-fg', '--page-h1-bg', '--page-h1-bold', '--page-h1-italic', '--page-h1-font']) },
          { label: '見出し H2', fields: pick(['--page-h2-fg', '--page-h2-bg', '--page-h2-bold', '--page-h2-italic', '--page-h2-font']) },
          { label: '見出し H3', fields: pick(['--page-h3-fg', '--page-h3-bg', '--page-h3-bold', '--page-h3-italic', '--page-h3-font']) },
          { label: '見出し H4', fields: pick(['--page-h4-fg', '--page-h4-bg', '--page-h4-bold', '--page-h4-italic', '--page-h4-font']) },
          { label: '見出し H5', fields: pick(['--page-h5-fg', '--page-h5-bg', '--page-h5-bold', '--page-h5-italic', '--page-h5-font']) },
          { label: '見出し H6', fields: pick(['--page-h6-fg', '--page-h6-bg', '--page-h6-bold', '--page-h6-italic', '--page-h6-font']) },
          { label: '本文',     fields: pick(['--page-text-fg', '--page-text-bold', '--page-text-italic', '--page-text-font']) },
          { label: 'リンク',   fields: pick(['--page-link-fg', '--page-link-bold', '--page-link-italic']) },
          { label: '引用ブロック', fields: pick(['--page-quote-fg', '--page-quote-bg', '--page-quote-bold', '--page-quote-italic']) },
          { label: '区切り線', fields: pick(['--page-hr-color']) },
          { label: '引用線', fields: pick(['--page-quote-border']) },
          { label: 'テキスト選択', fields: pick(['--page-selection-fg', '--page-selection-color']) },
          { label: 'カーソル', fields: pick(['--page-caret-color', '--page-caret-width']) },
        ],
      },
      {
        title: 'レイアウト',
        rows: [
          { label: '左右余白', fields: pick(['--page-margin-x']), preview: false },
          { label: '内容最大幅', fields: pick(['--page-content-max-width']), preview: false },
        ],
      },
    ];
  }

  if (ctx === 'db') {
    return [
      {
        title: '書式設定',
        rows: [
          { label: '全体',         fields: pick(['--db-header-bg', '--db-border-color']) },
          { label: '選択', fields: pick(['--db-selection-fg', '--db-selection-color']) },
          { label: 'ヘッダー',     fields: pick(['--db-th-fg', '--db-th-bg', '--db-th-bold', '--db-th-italic', '--db-th-font']) },
          { label: 'エントリ列',   fields: pick(['--db-entity-fg', '--db-entity-bg', '--db-entity-bold', '--db-entity-italic', '--db-entity-font']) },
          { label: 'セル',         fields: pick(['--db-cell-fg', '--db-cell-bg', '--db-cell-bold', '--db-cell-italic', '--db-cell-font']) },
          { label: 'アクティブセル枠', fields: pick(['--db-active-color', '--db-active-width']) },
          { label: 'テーブル罫線', fields: pick(['--db-grid-border', '--db-show-grid']) },
        ],
      },
    ];
  }

  if (ctx === 'board') {
    return [
      {
        title: '書式設定',
        rows: [
          { label: 'ボード背景', fields: pick(['--bd-bg', '__bd-bg-reset']), preview: false },
          { label: '影', fields: pick(['--bd-shadow', '--bd-shadow-color']) },
          { label: '標準フォント', fields: pick(['--bd-default-font-family']) },
          { label: '選択',     fields: pick(['--bd-selection-fg', '--bd-selection-color']) },
          { label: '矩形選択', fields: pick(['--bd-select-rect-color']) },
          { label: 'グループ', fields: pick(['--bd-group-color']) },
          { label: 'アンカー', fields: pick(['--bd-anchor-color']) },
          { label: 'リンク', fields: pick(['--bd-link-type-icon-color']) },
          { label: 'カーソル', fields: pick(['--bd-caret-color', '--bd-caret-width']) },
        ],
      },
      {
        title: '背景画像',
        rows: [
          { label: '背景画像', fields: pick(['--bd-bg-image']) },
          { label: '画像表示', fields: pick(['--bd-bg-image-fit']) },
        ],
      },
      {
        title: 'レイアウト',
        rows: [
          { label: '隙間',     fields: pick(['--bd-gap-siblings', '--bd-gap-levels']) },
          { label: '整列',     fields: pick(['--bd-auto-align']) },
        ],
      },
    ];
  }

  // フォールバック: 1 フィールド = 1 行
  return [
    { title: '書式設定', rows: spec.display.map(f => ({ fields: [f] })) },
    { title: '編集操作', rows: spec.editOps.map(f => ({ fields: [f] })) },
  ];
}

function _fsThemeIdField(ctx) {
  return { key: ctx === 'scriptnote' ? 'themeId' : '__themeId', label: 'テーマ', type: 'themeId' };
}

function _fsOsAccentKey() {
  return typeof _FILE_STYLE_USE_OS_ACCENT_KEY !== 'undefined' ? _FILE_STYLE_USE_OS_ACCENT_KEY : '__useOsAccentColor';
}

function _fsUseOsAccentField() {
  return { key: _fsOsAccentKey(), label: 'OSアクセント', type: 'toggle' };
}

function _fsUseOsAccent(ctx, adapter) {
  const source = adapter || _fsGetAdapter(ctx);
  const value = source?.get?.(_fsUseOsAccentField());
  return value === true || value === 1 || value === '1' || value === 'true';
}

function _fsSetUseOsAccent(ctx, enabled) {
  const adapter = _fsGetAdapter(ctx);
  if (!adapter) return false;
  adapter.set(_fsUseOsAccentField(), enabled ? '1' : '');
  return true;
}

function fileThemeToggleOsAccent(ctx) {
  const adapter = _fsGetAdapter(ctx);
  const next = !_fsUseOsAccent(ctx, adapter);
  if (!_fsSetUseOsAccent(ctx, next)) return;
  const finish = () => {
    _fsApplyCurrentStyleRuntime(ctx);
    renderFileStyleTab(ctx);
  };
  if (next && typeof MeldexThemeManager !== 'undefined' && typeof MeldexThemeManager.refreshOsAccentColor === 'function') {
    MeldexThemeManager.refreshOsAccentColor().finally(finish);
  } else {
    finish();
  }
}

function _fsCurrentThemeId(ctx, adapter) {
  const style = _fsGetStyleForContext(ctx) || {};
  const styleThemeId = style?.[_fsThemeIdField(ctx).key] || style?.themeId || '';
  if (_fsIsLocalCustomThemeId(styleThemeId)) return styleThemeId;
  if (ctx === 'board' && typeof bd !== 'undefined') return bd.themeId || styleThemeId || '';
  const value = adapter?.get?.(_fsThemeIdField(ctx));
  return String(value || '');
}

function _fsThemeOptionsHtml(currentId, ctx) {
  const cur = String(currentId || '');
  const inherit = `<option value=""${cur ? '' : ' selected'}>アプリ設定に従う</option>`;
  const localCustom = _fsIsLocalCustomThemeId(cur)
    ? `<option value="${esc(_fsLocalCustomThemeId())}" selected>${esc(_fsGetLocalCustomThemeName(ctx))}</option>`
    : '';
  if (typeof MeldexThemeManager === 'undefined' || typeof MeldexThemeManager.themeOptionsHtml !== 'function') {
    return inherit + localCustom;
  }
  return inherit + localCustom + MeldexThemeManager.themeOptionsHtml(cur || '__file-theme-inherit__', { includeSystem: true });
}

function _fsThemeAction(iconName, fallback, label, action, ctx, danger) {
  const icon = typeof lucide === 'function' ? lucide(iconName, 14) : fallback;
  return `<button type="button" class="bd-detail-style-action${danger ? ' bd-detail-style-action--danger' : ''}" data-fs-theme-action="${esc(action)}" data-e2e-id="file-style-theme-action-${esc(ctx)}-${esc(action)}" title="${esc(label)}" aria-label="${esc(label)}">${icon}</button>`;
}

function _fsRunThemeAction(ctx, action) {
  const handlers = {
    create: fileThemeCreate,
    duplicate: fileThemeDuplicate,
    rename: fileThemeRename,
    reset: fileThemeReset,
    save: fileThemeSave,
    delete: fileThemeDelete,
  };
  const handler = handlers[action];
  if (typeof handler !== 'function') return;
  try {
    const result = handler(ctx);
    if (result && typeof result.catch === 'function') {
      result.catch(error => {
        console.error(error);
        if (typeof showStatus === 'function') showStatus('テーマ操作に失敗しました', true);
      });
    }
  } catch (error) {
    console.error(error);
    if (typeof showStatus === 'function') showStatus('テーマ操作に失敗しました', true);
  }
}

function _fsThemePanelId(ctx) {
  return ctx === 'folder' ? 'folder-view'
    : ctx === 'page' ? 'page-content'
    : ctx === 'board' ? 'bd-canvas'
    : ctx === 'db' ? 'db-view-container'
    : '';
}

function _fsApplyCurrentStyleRuntime(ctx) {
  const style = _fsGetStyleForContext(ctx);
  if (ctx === 'scriptnote') {
    const ed = _getScriptNoteEditorForFileStyle?.();
    if (typeof ed?._render === 'function') ed._render();
    return;
  }
  const panelId = _fsThemePanelId(ctx);
  if (panelId && typeof clearFileStyleForPanel === 'function') clearFileStyleForPanel(panelId);
  if (panelId && typeof applyFileStyleToPanel === 'function') applyFileStyleToPanel(style, panelId);
  if (ctx === 'board') {
    if (typeof bdLoadBoardBackgroundFromStyle === 'function') bdLoadBoardBackgroundFromStyle();
    if (typeof MeldexThemeManager !== 'undefined' && typeof MeldexThemeManager.applyBoardThemeRuntime === 'function' && typeof bd !== 'undefined') {
      MeldexThemeManager.applyBoardThemeRuntime(bd);
    }
    if (typeof bdRender === 'function') bdRender();
  }
}

function _fsThemeVarsForCurrent(ctx, adapter) {
  const id = _fsCurrentThemeId(ctx, adapter);
  if (_fsIsLocalCustomThemeId(id)) {
    const style = _fsGetStyleForContext(ctx) || {};
    const vars = {};
    Object.entries(style).forEach(([key, value]) => {
      if (String(key).startsWith('--') && value !== undefined && value !== null && value !== '') vars[key] = value;
    });
    if (_fsUseOsAccent(ctx, adapter) && typeof _applyFileStyleOsAccentVars === 'function') {
      _applyFileStyleOsAccentVars(vars);
      const colors = typeof MeldexThemeManager !== 'undefined' && typeof MeldexThemeManager.getOsAccentThemeColorSet === 'function'
        ? MeldexThemeManager.getOsAccentThemeColorSet()
        : [];
      if (Array.isArray(colors) && colors.length) {
        for (let i = 0; i < 10; i += 1) vars[`--theme-palette-${i}`] = colors[i % colors.length];
      } else {
        for (let i = 0; i < 10; i += 1) vars[`--theme-palette-${i}`] = 'var(--theme-os-accent, AccentColor)';
      }
    }
    return vars;
  }
  const vars = (id && typeof MeldexThemeManager !== 'undefined' && typeof MeldexThemeManager.getThemeById === 'function')
    ? { ...(MeldexThemeManager.getThemeById(id)?.ui?.cssVars || {}) }
    : {};
  if (_fsUseOsAccent(ctx, adapter) && typeof _applyFileStyleOsAccentVars === 'function') _applyFileStyleOsAccentVars(vars);
  return vars;
}

function _fsThemeColorSetKey(ctx, id) {
  return `${ctx}:${id || '__inherit__'}`;
}

function _fsThemeStandardPaletteAdjust(themeDef) {
  const ui = themeDef?.ui || {};
  const raw = Object.prototype.hasOwnProperty.call(ui, 'standardPaletteAdjust') ? ui.standardPaletteAdjust
    : Object.prototype.hasOwnProperty.call(themeDef || {}, 'standardPaletteAdjust') ? themeDef.standardPaletteAdjust
    : Object.prototype.hasOwnProperty.call(ui, '_standard-palette-adjust') ? ui['_standard-palette-adjust']
    : Object.prototype.hasOwnProperty.call(themeDef || {}, '_standard-palette-adjust') ? themeDef['_standard-palette-adjust']
    : null;
  if (typeof MeldexThemeManager !== 'undefined' && typeof MeldexThemeManager.normalizeThemeStandardPaletteAdjust === 'function') {
    return MeldexThemeManager.normalizeThemeStandardPaletteAdjust(raw);
  }
  return raw;
}

function _fsThemeColorSlots(themeDef) {
  const ui = themeDef?.ui || {};
  return themeDef?.themeColorSlotSettings
    || ui.themeColorSlotSettings
    || themeDef?.['_theme-color-slot-settings']
    || ui['_theme-color-slot-settings']
    || null;
}

function _fsComputedThemeColorSet(themeDef) {
  if (!themeDef || typeof computeThemeColorSetFromSlots !== 'function') return null;
  const shouldUseGeneratedPalette = !!themeDef.builtIn
    || Object.prototype.hasOwnProperty.call(themeDef?.ui || {}, 'standardPaletteAdjust')
    || Object.prototype.hasOwnProperty.call(themeDef || {}, 'standardPaletteAdjust')
    || Object.prototype.hasOwnProperty.call(themeDef?.ui || {}, '_standard-palette-adjust')
    || Object.prototype.hasOwnProperty.call(themeDef || {}, '_standard-palette-adjust')
    || !!_fsThemeColorSlots(themeDef);
  if (!shouldUseGeneratedPalette) return null;
  const colors = computeThemeColorSetFromSlots(_fsThemeStandardPaletteAdjust(themeDef), _fsThemeColorSlots(themeDef));
  return Array.isArray(colors) && colors.length ? colors.slice() : null;
}

function _fsThemeColorSetForCurrent(ctx, adapter) {
  if (typeof MeldexThemeManager === 'undefined' || typeof MeldexThemeManager.getThemeColorSet !== 'function') return null;
  const style = _fsGetStyleForContext(ctx) || {};
  if (_fsIsLocalCustomThemeStyle(style) && !_fsUseOsAccent(ctx, adapter)) {
    return _fsLocalCustomPaletteFromStyle(style) || MeldexThemeManager.getThemeColorSet(undefined, { ignoreOsAccent: true });
  }
  if (_fsUseOsAccent(ctx, adapter)) {
    const colors = typeof MeldexThemeManager.getOsAccentThemeColorSet === 'function' ? MeldexThemeManager.getOsAccentThemeColorSet() : [];
    return Array.isArray(colors) && colors.length ? colors.slice() : ['var(--theme-os-accent, AccentColor)'];
  }
  const id = _fsCurrentThemeId(ctx, adapter);
  const pending = _fsPendingThemeColorSets[_fsThemeColorSetKey(ctx, id)];
  if (pending) return pending.slice();
  const defaultId = typeof MeldexThemeManager.getDefaultThemeId === 'function' ? MeldexThemeManager.getDefaultThemeId() : '';
  if (!id || (defaultId && id === defaultId)) {
    return MeldexThemeManager.getThemeColorSet(undefined, { ignoreOsAccent: true });
  }
  if (typeof MeldexThemeManager.getThemeById === 'function') {
    const themeDef = MeldexThemeManager.getThemeById(id);
    return _fsComputedThemeColorSet(themeDef) || MeldexThemeManager.getThemeColorSet(themeDef, { ignoreOsAccent: true });
  }
  return MeldexThemeManager.getThemeColorSet(undefined, { ignoreOsAccent: true });
}

function _fsLocalCustomThemeId() {
  return typeof _FILE_STYLE_LOCAL_CUSTOM_THEME_ID !== 'undefined'
    ? _FILE_STYLE_LOCAL_CUSTOM_THEME_ID
    : '__fileCustomTheme';
}

function _fsLocalCustomThemeNameKey() {
  return typeof _FILE_STYLE_LOCAL_CUSTOM_THEME_NAME_KEY !== 'undefined'
    ? _FILE_STYLE_LOCAL_CUSTOM_THEME_NAME_KEY
    : '__themeName';
}

function _fsLocalCustomThemeSourceKey() {
  return typeof _FILE_STYLE_LOCAL_CUSTOM_THEME_SOURCE_KEY !== 'undefined'
    ? _FILE_STYLE_LOCAL_CUSTOM_THEME_SOURCE_KEY
    : '__themeSourceId';
}

function _fsIsLocalCustomThemeId(id) {
  return String(id || '') === _fsLocalCustomThemeId();
}

function _fsGetLocalCustomThemeName(ctx) {
  const style = _fsGetStyleForContext(ctx) || {};
  return String(style[_fsLocalCustomThemeNameKey()] || 'カスタムテーマ').trim() || 'カスタムテーマ';
}

function _fsIsLocalCustomThemeStyle(style) {
  return _fsIsLocalCustomThemeId(style?.[_fsThemeIdField('').key] || style?.themeId || '');
}

function _fsLocalCustomPaletteFromStyle(style) {
  const colors = [];
  for (let i = 0; i < 10; i += 1) {
    const value = style?.[`--theme-palette-${i}`];
    if (value !== undefined && value !== null && value !== '') colors.push(String(value));
  }
  return colors.length ? colors : null;
}

function _fsThemeColorSetForThemeId(sourceId) {
  if (typeof MeldexThemeManager === 'undefined' || typeof MeldexThemeManager.getThemeColorSet !== 'function') return null;
  const themeDef = typeof MeldexThemeManager.getThemeById === 'function'
    ? MeldexThemeManager.getThemeById(sourceId || MeldexThemeManager.getDefaultThemeId?.())
    : null;
  if (!themeDef) return MeldexThemeManager.getThemeColorSet(undefined, { ignoreOsAccent: true });
  return _fsComputedThemeColorSet(themeDef) || MeldexThemeManager.getThemeColorSet(themeDef, { ignoreOsAccent: true });
}

function _fsStyleStorageKeyForField(ctx, field) {
  if (!field) return '';
  if (ctx === 'scriptnote') return field.key || '';
  return _fsThemeVarKeyForField(field) || field.key || '';
}

function _fsReadSourceThemeVar(sourceTheme, key, useDocumentValue) {
  const sourceVars = sourceTheme?.ui?.cssVars || {};
  if (useDocumentValue && typeof document !== 'undefined' && typeof getComputedStyle === 'function') {
    const root = document.documentElement;
    const value = (root?.style?.getPropertyValue?.(key) || getComputedStyle(root).getPropertyValue(key) || '').trim();
    if (value) return value;
  }
  const value = sourceVars[key];
  return value !== undefined && value !== null && value !== '' ? String(value) : '';
}

function _fsBuildLocalCustomThemeStyle(ctx, options = {}) {
  const adapter = options.adapter || _fsGetAdapter(ctx);
  const current = _fsGetStyleForContext(ctx) || {};
  const defaultThemeId = typeof MeldexThemeManager !== 'undefined' && typeof MeldexThemeManager.getDefaultThemeId === 'function'
    ? MeldexThemeManager.getDefaultThemeId()
    : '';
  const currentThemeId = _fsCurrentThemeId(ctx, adapter);
  const explicitSource = options.sourceId !== undefined && !_fsIsLocalCustomThemeId(options.sourceId);
  let sourceId = explicitSource
    ? String(options.sourceId || '')
    : String(current[_fsLocalCustomThemeSourceKey()] || currentThemeId || defaultThemeId || '');
  if (_fsIsLocalCustomThemeId(sourceId)) sourceId = defaultThemeId;
  const useDocumentSourceValues = !explicitSource && !String(currentThemeId || '').trim();
  const sourceTheme = typeof MeldexThemeManager !== 'undefined' && typeof MeldexThemeManager.getThemeById === 'function'
    ? MeldexThemeManager.getThemeById(sourceId || defaultThemeId)
    : null;
  const next = {};
  Object.keys(sourceTheme?.ui?.cssVars || {}).forEach(key => {
    if (!key.startsWith('--')) return;
    const value = _fsReadSourceThemeVar(sourceTheme, key, useDocumentSourceValues);
    if (value) next[key] = value;
  });
  _fsRenderableThemeFields(ctx).forEach(field => {
    const key = _fsStyleStorageKeyForField(ctx, field);
    if (!key || key === _fsThemeIdField(ctx).key) return;
    let value = '';
    if (explicitSource && key.startsWith('--')) {
      value = _fsReadSourceThemeVar(sourceTheme, key, false);
    }
    if (!value) value = _fsReadFieldValue(field, adapter);
    if (!value && !useDocumentSourceValues && key.startsWith('--')) value = _fsReadSourceThemeVar(sourceTheme, key, false);
    if (value !== undefined && value !== null && value !== '') next[key] = value;
  });
  const colorSet = explicitSource ? _fsThemeColorSetForThemeId(sourceId) : _fsThemeColorSetForCurrent(ctx, adapter);
  if (Array.isArray(colorSet) && colorSet.length) {
    for (let i = 0; i < 10; i += 1) next[`--theme-palette-${i}`] = colorSet[i % colorSet.length];
  }
  next[_fsThemeIdField(ctx).key] = _fsLocalCustomThemeId();
  next[_fsLocalCustomThemeNameKey()] = String(options.name || current[_fsLocalCustomThemeNameKey()] || 'カスタムテーマ').trim() || 'カスタムテーマ';
  if (sourceId) next[_fsLocalCustomThemeSourceKey()] = sourceId;
  return next;
}

function _fsPersistStyleViaAdapter(ctx, adapter, style, options = {}) {
  if (!options.skipHistory && typeof _fsApplyStyleWithHistory === 'function') {
    return _fsApplyStyleWithHistory(ctx, adapter, style, options.label || '書式設定変更', options.detail || '');
  }
  if (typeof _fsPersistStyleDirect === 'function') {
    return _fsPersistStyleDirect(ctx, adapter, style, options);
  }
  if (adapter && typeof adapter.saveStyle === 'function') return adapter.saveStyle(style, options);
  return _fsSaveStyleForContext(ctx, style);
}

function _fsEnsureLocalCustomThemeBeforeFieldSet(ctx, field, adapter, options = {}) {
  const key = field?.key || '';
  if (!options.force && (key === _fsThemeIdField(ctx).key || key === 'themeId' || key === _fsLocalCustomThemeNameKey() || key === _fsLocalCustomThemeSourceKey())) {
    return _fsGetStyleForContext(ctx) || {};
  }
  const current = _fsGetStyleForContext(ctx) || {};
  if (!options.force && _fsIsLocalCustomThemeStyle(current)) return current;
  const source = adapter || _fsGetAdapter(ctx);
  if (!source) return current;
  const next = _fsBuildLocalCustomThemeStyle(ctx, { ...options, adapter: source });
  if (ctx === 'board' && typeof bd !== 'undefined') bd.themeId = '';
  _fsPersistStyleViaAdapter(ctx, source, next, { skipHistory: !!options.skipHistory, skipUndo: !!options.skipUndo });
  return next;
}

function _fsRenderableThemeFields(ctx) {
  const spec = _FS_FIELDS[ctx] || { display: [], editOps: [] };
  const fields = [];
  const seen = new Set();
  const addField = (field) => {
    const id = field?.key || field?.cssVar || field?.label || '';
    if (!id || seen.has(id)) return;
    seen.add(id);
    fields.push(field);
  };
  [...(spec.display || []), ...(spec.editOps || [])].forEach(addField);
  if (typeof getFileThemePreviewMappedFields === 'function') {
    _fsResolveSections(ctx, spec).forEach(section => {
      (section.rows || []).forEach(row => {
        if (!row || row.preview === false) return;
        getFileThemePreviewMappedFields(row).forEach(addField);
      });
    });
  }
  return fields;
}

function _fsThemeVarKeyForField(field) {
  const key = String(field?.key || '').trim();
  if (key.startsWith('--')) return key;
  const cssVar = String(field?.cssVar || '').trim();
  return cssVar.startsWith('--') ? cssVar : '';
}

function _fsCollectThemeSaveVars(ctx) {
  const adapter = _fsGetAdapter(ctx);
  const vars = {};
  _fsRenderableThemeFields(ctx).forEach(field => {
    const themeKey = _fsThemeVarKeyForField(field);
    if (!themeKey) return;
    const value = adapter?.get ? adapter.get(field) : undefined;
    if (value !== undefined && value !== null && value !== '') vars[themeKey] = value;
  });
  return vars;
}

function _fsRenderThemeControlSection(ctx, adapter) {
  const current = _fsCurrentThemeId(ctx, adapter);
  const colorSet = _fsThemeColorSetForCurrent(ctx, adapter);
  const useOsAccent = _fsUseOsAccent(ctx, adapter);
  const osAccentColor = typeof MeldexThemeManager !== 'undefined' && typeof MeldexThemeManager.getOsAccentColor === 'function'
    ? MeldexThemeManager.getOsAccentColor()
    : '';
  return `
    <section class="gb-section gb-section--boxed fs-theme-management" data-file-theme-panel="${esc(ctx)}">
      <div class="gb-section-title">${typeof lucide === 'function' ? lucide('palette', 14) : ''} テーマ</div>
      <div class="gb-field-row fs-theme-row">
        <select class="gb-select fs-theme-select" data-fs-theme-select data-e2e-id="file-style-theme-select-${esc(ctx)}" aria-label="テーマ">
          ${_fsThemeOptionsHtml(current, ctx)}
        </select>
        <span class="bd-detail-style-row fs-theme-actions">
          ${_fsThemeAction('plus', '+', '新規カスタムテーマを作成', 'create', ctx)}
          ${_fsThemeAction('copy', '複製', '選択中テーマを複製', 'duplicate', ctx)}
          ${_fsThemeAction('pencil', '名前', 'テーマ名を変更', 'rename', ctx)}
          ${_fsThemeAction('rotateCcw', '戻す', 'デフォルトに戻す', 'reset', ctx)}
          ${_fsThemeAction('save', '保存', 'デフォルトとして保存', 'save', ctx)}
          ${_fsThemeAction('trash2', '削除', 'カスタムテーマを削除', 'delete', ctx, true)}
        </span>
      </div>
      ${typeof renderThemeColorSetEditor === 'function' ? renderThemeColorSetEditor(colorSet, { osAccent: useOsAccent, osAccentColor }) : ''}
    </section>`;
}

function _fsBindThemePanel(root, ctx) {
  if (!root) return;
  const section = root.querySelector('.fs-theme-management');
  if (!section) return;
  const adapter = _fsGetAdapter(ctx);
  if (typeof syncThemeColorSetSwatches === 'function') syncThemeColorSetSwatches(section, _fsThemeColorSetForCurrent(ctx, adapter));
  const select = section.querySelector('[data-fs-theme-select]');
  select?.addEventListener('change', () => fileThemeSelect(ctx, select.value));
  section.querySelectorAll('[data-fs-theme-action]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.disabled) return;
      _fsRunThemeAction(ctx, btn.dataset.fsThemeAction || '');
    });
  });
  _fsBindThemeColorSetEditor(section, ctx);
  _fsRefreshThemeActionStates(root, ctx);
  _fsEnsureThemePanelGlobalSync();
}

let _fsThemePanelGlobalSyncBound = false;
function _fsEnsureThemePanelGlobalSync() {
  if (_fsThemePanelGlobalSyncBound || typeof window === 'undefined') return;
  _fsThemePanelGlobalSyncBound = true;
  const refresh = () => {
    if (typeof syncThemeColorSetSwatches !== 'function') return;
    document.querySelectorAll('.fs-theme-management[data-file-theme-panel]').forEach(section => {
      const ctx = section.getAttribute('data-file-theme-panel') || '';
      if (!ctx) return;
      const adapter = _fsGetAdapter(ctx);
      syncThemeColorSetSwatches(section, _fsThemeColorSetForCurrent(ctx, adapter));
    });
  };
  window.addEventListener('meldex-theme-color-set-change', refresh);
  window.addEventListener('meldex-theme-change', refresh);
}

function _fsBindThemeColorSetEditor(root, ctx) {
  if (!root || typeof MeldexThemeManager === 'undefined') return;
  const adapter = _fsGetAdapter(ctx);
  const id = _fsCurrentThemeId(ctx, adapter);
  const key = _fsThemeColorSetKey(ctx, id);
  const isLocalCustom = _fsIsLocalCustomThemeId(id);
  const isCustom = isLocalCustom || !!(id && MeldexThemeManager.getCustomThemes().some(t => t.id === id));
  const currentColors = () => _fsPendingThemeColorSets[key]?.slice() || _fsThemeColorSetForCurrent(ctx, adapter) || [];
  const saveLocalPalette = (colors) => {
    const current = _fsGetStyleForContext(ctx) || {};
    const source = _fsIsLocalCustomThemeStyle(current)
      ? current
      : _fsBuildLocalCustomThemeStyle(ctx, { adapter, force: true });
    const next = { ...(source || _fsGetStyleForContext(ctx) || {}) };
    const normalized = typeof MeldexThemeManager.normalizeThemeColorSet === 'function'
      ? MeldexThemeManager.normalizeThemeColorSet(colors, currentColors())
      : colors;
    if (!Array.isArray(normalized) || !normalized.length) return;
    for (let i = 0; i < 10; i += 1) next[`--theme-palette-${i}`] = normalized[i % normalized.length];
    next[_fsThemeIdField(ctx).key] = _fsLocalCustomThemeId();
    next[_fsLocalCustomThemeNameKey()] = next[_fsLocalCustomThemeNameKey()] || 'カスタムテーマ';
    _fsPersistStyleViaAdapter(ctx, adapter, next, { label: 'テーマカラー変更' });
    _fsApplyCurrentStyleRuntime(ctx);
    renderFileStyleTab(ctx);
  };
  root.querySelector('[data-theme-os-accent-toggle]')?.addEventListener('click', () => {
    fileThemeToggleOsAccent(ctx);
  });
  root.querySelectorAll('[data-theme-color-slot]').forEach(btn => {
    btn.addEventListener('click', () => {
      const index = parseInt(btn.dataset.themeColorSlot, 10);
      const colors = currentColors();
      openColorPalette(btn, colors[index] || colors[0] || '#ef4444', color => {
        if (!color || color === 'transparent') return;
        const next = currentColors();
        next[index] = color;
        if (!id || !isCustom || isLocalCustom) {
          saveLocalPalette(next);
          return;
        }
        _fsPendingThemeColorSets[key] = next;
        if (typeof syncThemeColorSetSwatches === 'function') syncThemeColorSetSwatches(root, next);
      });
    });
  });
  root.querySelector('[data-theme-color-reset]')?.addEventListener('click', () => {
    if (!id || !isCustom || isLocalCustom) {
      const sourceId = (_fsGetStyleForContext(ctx) || {})[_fsLocalCustomThemeSourceKey()] || MeldexThemeManager.getDefaultThemeId?.();
      const colors = _fsThemeColorSetForThemeId(sourceId);
      if (Array.isArray(colors) && colors.length) saveLocalPalette(colors);
      return;
    }
    delete _fsPendingThemeColorSets[key];
    if (typeof syncThemeColorSetSwatches === 'function') syncThemeColorSetSwatches(root, _fsThemeColorSetForCurrent(ctx, adapter));
  });
}

function _fsRefreshThemeActionStates(root, ctx) {
  const adapter = _fsGetAdapter(ctx);
  const id = _fsCurrentThemeId(ctx, adapter);
  const isCustom = _fsIsLocalCustomThemeId(id) || !!(id && typeof MeldexThemeManager !== 'undefined' && MeldexThemeManager.getCustomThemes().some(t => t.id === id));
  ['rename', 'save', 'delete'].forEach(action => {
    (root || document).querySelectorAll(`[data-fs-theme-action="${action}"]`).forEach(btn => { btn.disabled = !isCustom; });
  });
}

function fileThemeSelect(ctx, id) {
  const adapter = _fsGetAdapter(ctx);
  if (!adapter) return;
  const nextId = String(id || '');
  if (!nextId) {
    if (ctx === 'board' && typeof bd !== 'undefined') bd.themeId = '';
    _fsPersistStyleViaAdapter(ctx, adapter, null, { label: 'テーマ解除' });
    _fsApplyCurrentStyleRuntime(ctx);
    renderFileStyleTab(ctx);
    return;
  }
  if (_fsIsLocalCustomThemeId(nextId)) return;
  _fsEnsureLocalCustomThemeBeforeFieldSet(ctx, _fsThemeIdField(ctx), adapter, { force: true, sourceId: nextId, name: 'カスタムテーマ' });
  _fsApplyCurrentStyleRuntime(ctx);
  renderFileStyleTab(ctx);
}

async function fileThemeCreate(ctx) {
  const name = await cfPrompt('カスタムテーマ名', 'カスタムテーマ');
  if (name === null) return;
  const label = String(name || '').trim();
  if (!label) { showStatus('テーマ名を入力してください', true); return; }
  const adapter = _fsGetAdapter(ctx);
  _fsEnsureLocalCustomThemeBeforeFieldSet(ctx, _fsThemeIdField(ctx), adapter, { force: true, name: label });
  _fsApplyCurrentStyleRuntime(ctx);
  renderFileStyleTab(ctx);
  showStatus('カスタムテーマを作成しました');
}

async function fileThemeDuplicate(ctx) {
  if (typeof MeldexThemeManager === 'undefined') return;
  const adapter = _fsGetAdapter(ctx);
  const sourceId = _fsCurrentThemeId(ctx, adapter) || MeldexThemeManager.getDefaultThemeId();
  const name = await cfPrompt('複製後のテーマ名', 'カスタムテーマ');
  if (name === null) return;
  _fsEnsureLocalCustomThemeBeforeFieldSet(ctx, _fsThemeIdField(ctx), adapter, { force: true, sourceId, name: String(name || '').trim() || 'カスタムテーマ' });
  _fsApplyCurrentStyleRuntime(ctx);
  renderFileStyleTab(ctx);
  showStatus('カスタムテーマを複製しました');
}

async function fileThemeRename(ctx) {
  if (typeof MeldexThemeManager === 'undefined') return;
  const adapter = _fsGetAdapter(ctx);
  const id = _fsCurrentThemeId(ctx, adapter);
  if (_fsIsLocalCustomThemeId(id)) {
    const name = await cfPrompt('テーマ名', _fsGetLocalCustomThemeName(ctx));
    if (name === null) return;
    const label = String(name || '').trim();
    if (!label) { showStatus('テーマ名を入力してください', true); return; }
    const next = { ...(_fsGetStyleForContext(ctx) || {}) };
    next[_fsLocalCustomThemeNameKey()] = label;
    _fsPersistStyleViaAdapter(ctx, adapter, next, { label: 'テーマ名変更' });
    renderFileStyleTab(ctx);
    return;
  }
  const theme = MeldexThemeManager.getCustomThemes().find(t => t.id === id);
  if (!theme) { showStatus('組み込みテーマは名前を変更できません', true); return; }
  const name = await cfPrompt('テーマ名', theme.name);
  if (name === null) return;
  const renamed = MeldexThemeManager.renameCustomTheme(id, name);
  if (!renamed) { showStatus('テーマ名を入力してください', true); return; }
  renderFileStyleTab(ctx);
}

function fileThemeReset(ctx) {
  const adapter = _fsGetAdapter(ctx);
  if (!adapter) return;
  const id = _fsCurrentThemeId(ctx, adapter);
  if (_fsIsLocalCustomThemeId(id)) {
    fileThemeSelect(ctx, '');
    showStatus('デフォルトに戻しました');
    return;
  }
  if (ctx === 'board' && typeof bd !== 'undefined') {
    _fsPersistStyleViaAdapter(ctx, adapter, null, { label: 'テーマリセット' });
  } else if (ctx === 'scriptnote') {
    _fsPersistStyleViaAdapter(ctx, adapter, id ? { [_fsThemeIdField(ctx).key]: id } : null, { label: 'テーマリセット' });
  } else {
    _fsPersistStyleViaAdapter(ctx, adapter, id ? { [_fsThemeIdField(ctx).key]: id } : null, { label: 'テーマリセット' });
  }
  if (ctx !== 'scriptnote') {
    const panelId = _fsThemePanelId(ctx);
    if (panelId && typeof clearFileStyleForPanel === 'function') clearFileStyleForPanel(panelId);
  }
  _fsApplyCurrentStyleRuntime(ctx);
  renderFileStyleTab(ctx);
  showStatus('デフォルトに戻しました');
}

function _fsResetBoardRuntimeFileStyle() {
  if (typeof bd === 'undefined') return;
  bd._bgColor = '';
  bd._bgImage = '';
  bd._bgImageFit = '';
  bd._bgImageScale = 1;
  bd.gapSiblings = null;
  bd.gapLevels = null;
  bd.autoAlign = true;
  bd._showShadow = false;
  if (typeof bdApplyCanvasBackground === 'function') {
    const fallback = (typeof MeldexThemeManager !== 'undefined' && typeof MeldexThemeManager.getActiveBoardTheme === 'function')
      ? MeldexThemeManager.getActiveBoardTheme(bd)?.board?.backgroundColor || ''
      : '';
    bdApplyCanvasBackground(null, fallback);
  }
  if (typeof bdApplyBoardFontVariables === 'function') bdApplyBoardFontVariables();
  if (typeof bdScheduleFontStyleMapUpdate === 'function') bdScheduleFontStyleMapUpdate();
}

function fileThemeSave(ctx) {
  if (typeof MeldexThemeManager === 'undefined') return;
  const adapter = _fsGetAdapter(ctx);
  const id = _fsCurrentThemeId(ctx, adapter);
  if (_fsIsLocalCustomThemeId(id)) {
    showStatus('カスタムテーマはファイル内に保存済みです', false, { showSaveDialog: true });
    return;
  }
  const list = MeldexThemeManager.getCustomThemes();
  const index = list.findIndex(t => t.id === id);
  if (index < 0) { showStatus('組み込みテーマはデフォルトとして保存できません。新規カスタムテーマを作成してください', true); return; }
  const theme = list[index];
  theme.ui = theme.ui || {};
  theme.ui.cssVars = { ...(theme.ui.cssVars || {}), ..._fsCollectThemeSaveVars(ctx) };
  const colorKey = _fsThemeColorSetKey(ctx, id);
  if (_fsPendingThemeColorSets[colorKey] && typeof MeldexThemeManager.normalizeThemeColorSet === 'function') {
    const colorSet = MeldexThemeManager.normalizeThemeColorSet(_fsPendingThemeColorSets[colorKey], theme.ui.colorSet);
    theme.themeColorSet = colorSet;
    theme.ui.themeColorSet = colorSet;
    theme.ui.colorSet = colorSet;
    theme.ui.palette = colorSet;
    delete _fsPendingThemeColorSets[colorKey];
  }
  MeldexThemeManager.saveCustomThemes(list);
  showStatus('デフォルトとして保存しました', false, { showSaveDialog: true });
}

async function fileThemeDelete(ctx) {
  if (typeof MeldexThemeManager === 'undefined') return;
  const adapter = _fsGetAdapter(ctx);
  const id = _fsCurrentThemeId(ctx, adapter);
  if (_fsIsLocalCustomThemeId(id)) {
    if (!await cfConfirm('ファイル内のカスタムテーマを削除して、アプリ設定に戻しますか？')) return;
    fileThemeSelect(ctx, '');
    showStatus('カスタムテーマを削除しました');
    return;
  }
  const theme = MeldexThemeManager.getCustomThemes().find(t => t.id === id);
  if (!theme) { showStatus('削除できるカスタムテーマが選択されていません', true); return; }
  if (!await cfConfirm('カスタムテーマ「' + theme.name + '」を削除しますか？')) return;
  delete _fsPendingThemeColorSets[_fsThemeColorSetKey(ctx, id)];
  MeldexThemeManager.deleteCustomTheme(id);
  fileThemeSelect(ctx, '');
  showStatus('カスタムテーマを削除しました');
}

// ctx: 'folder' | 'page' | 'db' | 'scriptnote' | 'board' | 'calendar'
function renderFileStyleTab(ctx) {
  const rpDetail = document.getElementById('rp-detail');
  if (rpDetail) _ensureDetailTabShell(rpDetail);
  const el = document.getElementById('detail-tab-file-style');
  if (!el) return;
  el.dataset.fileStyleContext = ctx || '';
  if (ctx !== 'calendar') el.removeAttribute('data-calendar-style');
  const ctxLabel = { folder: 'フォルダ', page: 'ノート', db: 'シート', scriptnote: 'シナリオ', board: 'ボード', calendar: 'カレンダー' }[ctx] || '';
  const spec = _FS_FIELDS[ctx] || { display: [], editOps: [] };
  const adapter = _fsGetAdapter(ctx);
  el.innerHTML = '';

  const wrap = document.createElement('div');
  wrap.style.cssText = 'padding:var(--ui-space-4);display:flex;flex-direction:column;gap:var(--ui-space-4);';
  const hdr = document.createElement('div');
  hdr.className = 'gb-section-desc';
  hdr.textContent = '対象: ' + (ctxLabel || '—');
  wrap.appendChild(hdr);

  if (!adapter) {
    const empty = document.createElement('div');
    empty.className = 'gb-section-desc';
    empty.textContent = '対象エディタがアクティブではありません';
    wrap.appendChild(empty);
  } else {
    wrap.insertAdjacentHTML('beforeend', _fsRenderThemeControlSection(ctx, adapter));
    _fsResolveSections(ctx, spec).forEach(section => {
      const sec = document.createElement('section');
      sec.className = 'gb-section gb-section--detail';
      const title = document.createElement('h4');
      title.className = 'gb-section-title';
      title.textContent = section.title;
      sec.appendChild(title);
      section.rows.filter(row => row && Array.isArray(row.fields) && row.fields.length).forEach(rowData => {
        const row = document.createElement('div');
        row.className = 'gb-fmt-popup-row gb-fmt-popup-row--wrap';
        row._fsRowData = rowData;
        row._fsAdapter = adapter;
        if (rowData.label) {
          const groupLabel = document.createElement('span');
          groupLabel.className = 'gb-fmt-label gb-fmt-label--group';
          groupLabel.textContent = rowData.label;
          row.appendChild(groupLabel);
        }
        if (ctx !== 'scriptnote' && rowData.preview !== false) row.appendChild(_fsBuildRowPreview(rowData, adapter));
        rowData.fields.forEach(field => row.appendChild(_fsBuildFieldInline(field, adapter, rowData.label)));
        sec.appendChild(row);
      });
      wrap.appendChild(sec);
    });
  }

  el.appendChild(wrap);
  _fsBindThemePanel(el, ctx);
