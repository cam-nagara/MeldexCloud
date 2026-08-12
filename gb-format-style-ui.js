/* gb-format-style-ui.js: preview-first format controls for theme/style tabs */
(function () {
  'use strict';

  const PAGE_BG = 'var(--page-bg, var(--bg))';
  const LINE_RE = /border|grid|hr|active|spread|drop|group|anchor|枠線|罫線|区切り|引用線|グループ|アンカー|線|太さ/i;
  const CARET_RE = /caret|cursor|カーソル/i;
  const BG_RE = /bg|background|背景|selection|選択/i;
  const TEXT_RE = /fg|textColor|baseTextColor|文字|本文|リンク|タイトル|見出し|セル|ヘッダー|エントリ|メタ|アイコン/i;
  const STYLE_LEFT_ACCENT_WIDTH = '6px';
  const STYLE_UNDERLINE_WIDTH = '2px';
  const SETTINGS_GENERATED_STYLE_BASE_RE = /^--(?:page-(?:title|text|h[1-6]|quote|quote-cite|link)|db-(?:th|entity|cell))$/;
  let _settingsStyleRowSeq = 0;
  const _settingsStyleDefs = new Map();

  function _e(value) {
    if (typeof esc === 'function') return esc(value);
    return String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[ch]));
  }

  function _e2eId(...parts) {
    return parts
      .map(part => String(part == null ? '' : part).trim().replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, ''))
      .filter(Boolean)
      .join('-');
  }

  function _e2eFallbackText(value) {
    const text = String(value == null ? '' : value).trim();
    if (!text) return '';
    const ascii = text.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
    if (ascii) return ascii;
    return Array.from(text).map(ch => ch.charCodeAt(0).toString(16)).join('-');
  }

  function _cssVar(key) {
    if (!key) return '';
    if (typeof getCssVar === 'function') return getCssVar(key);
    return getComputedStyle(document.documentElement).getPropertyValue(key).trim();
  }

  function _isTransparent(value) {
    const v = String(value || '').replace(/\s+/g, '').toLowerCase();
    return !v || v === 'transparent' || v === 'rgba(0,0,0,0)' || v === 'rgba(0,0,0,0.0)';
  }

  function _pxNumber(value, fallback) {
    const m = String(value == null ? '' : value).match(/-?\d+(\.\d+)?/);
    return m ? parseFloat(m[0]) : (fallback == null ? '' : fallback);
  }

  function _previewFontSize(label) {
    if (typeof STYLE_PREVIEW_FONT_SIZES === 'undefined') return null;
    const key = String(label || '');
    return STYLE_PREVIEW_FONT_SIZES[key] || STYLE_PREVIEW_FONT_SIZES[`見出し ${key}`] || null;
  }

  function _setRootStyle(key, value) {
    if (!key) return;
    const v = value == null ? '' : String(value);
    if (v) document.documentElement.style.setProperty(key, v);
    else document.documentElement.style.removeProperty(key);
    if (typeof _settingsThemeMarkDirty === 'function') _settingsThemeMarkDirty();
  }

  function _setThemeStyle(key, value) {
    if (!key) return;
    if (value == null || value === '') {
      _setRootStyle(key, '');
      if (typeof updateCsSwatch === 'function') updateCsSwatch(key, '');
      return;
    }
    if (key.includes('font') && typeof setThemeFontSetting === 'function') {
      setThemeFontSetting(key, value || '');
    } else if (typeof setColorSetting === 'function') {
      setColorSetting(key, value || '');
    } else {
      _setRootStyle(key, value);
    }
    if (typeof updateCsSwatch === 'function') updateCsSwatch(key, value || '');
  }

  function _styleBaseKey(key) {
    const raw = String(key || '').trim();
    if (!raw.startsWith('--')) return '';
    const stripped = raw
      .replace(/-(?:fg|color|bg|font|bold|italic|font-size|stroke-color|stroke-width|left-accent|underline|accent-color)$/i, '');
    // '--fg' → '--' のように意味のあるベース名が抽出できなかった場合は空扱い
    // （仮想キー `---bg` 等を作って共通変数 `--bg` と衝突させないため）
    if (stripped === '--' || !/^--[a-z0-9]/i.test(stripped)) return '';
    return stripped;
  }

  function _settingsBase(def) {
    if (!def || def.line || CARET_RE.test(def.label || '') || /選択|背景|ボーダー|枠線|罫線|区切り|引用線/.test(def.label || '')) return '';
    return _styleBaseKey(def.base || def.fg || def.font || def.bold || def.italic || def.bg || '');
  }

  function _settingsKey(def, prop, suffix) {
    if (def?.[prop]) return def[prop];
    const base = _settingsBase(def);
    return base && SETTINGS_GENERATED_STYLE_BASE_RE.test(base) ? `${base}${suffix}` : '';
  }

  function _activeFlag(value) {
    const v = String(value == null ? '' : value).trim().toLowerCase();
    if (/^0(?:\.0+)?(?:px|em|rem|%)?$/.test(v)) return false;
    return !!v && v !== '0' && v !== 'none' && v !== 'normal' && v !== 'false';
  }

  function _defByLabel(label) {
    for (const list of Object.values(UI_STYLE_SECTIONS || {})) {
      const found = list.find(item => item.label === label);
      if (found) return found;
    }
    return null;
  }

  function _registerSettingsDef(def) {
    const id = `settings-style-${++_settingsStyleRowSeq}`;
    _settingsStyleDefs.set(id, def);
    return id;
  }

  function _defByPreview(previewEl) {
    const stateId = previewEl?.dataset?.themeStateId || '';
    if (stateId && typeof window.settingsThemeStateCoverageManifest === 'function') {
      const entry = window.settingsThemeStateCoverageManifest().find(item => item.id === stateId);
      if (entry) {
        return {
          label: entry.sectionLabel,
          ...(entry.property === 'backgroundColor' ? { bg: entry.key }
            : entry.property === 'color' ? { fg: entry.key }
              : { line: entry.key }),
          __themeStateEntry: entry,
        };
      }
    }
    const id = previewEl?.dataset?.styleId || '';
    const registered = id && _settingsStyleDefs.get(id);
    if (registered) return registered;
    const section = previewEl?.dataset?.styleSection || '';
    const label = previewEl?.dataset?.styleLabel || '';
    if (section && label) {
      const exact = (UI_STYLE_SECTIONS?.[section] || []).find(item => item.label === label);
      if (exact) return exact;
    }
    return _defByLabel(label);
  }

  function _isBgOnlySettingsDef(def) {
    return !!(def && def.bg && !def.fg && !def.bold && !def.italic && !def.font && !def.fontSize && !def.line && !def.width);
  }

  function _swatchBackgroundValue(key) {
    const value = _cssVar(key);
    return _isTransparent(value) ? 'transparent' : value;
  }

  // 透過値を示すためのチェッカー柄（背景色 bg-only スウォッチで使用）。
  // 2レイヤーのチェッカーは position/size を個別プロパティで指定する方が確実。
  const _CHECKER_BG_IMAGE =
    'linear-gradient(45deg,#666 25%,transparent 25%,transparent 75%,#666 75%),' +
    'linear-gradient(45deg,#666 25%,transparent 25%,transparent 75%,#666 75%)';
  const _CHECKER_BG_SIZE = '6px 6px';
  const _CHECKER_BG_POSITION = '0 0,3px 3px';
  const _CHECKER_BG_INLINE_STYLE = `background-image:${_CHECKER_BG_IMAGE};background-size:${_CHECKER_BG_SIZE};background-position:${_CHECKER_BG_POSITION}`;

  function _applyBgOnlySwatchBackground(swatchEl, key) {
    const value = _cssVar(key);
    if (_isTransparent(value)) {
      swatchEl.style.background = '';
      swatchEl.style.backgroundImage = _CHECKER_BG_IMAGE;
      swatchEl.style.backgroundSize = _CHECKER_BG_SIZE;
      swatchEl.style.backgroundPosition = _CHECKER_BG_POSITION;
    } else {
      swatchEl.style.backgroundImage = '';
      swatchEl.style.backgroundSize = '';
      swatchEl.style.backgroundPosition = '';
      swatchEl.style.background = value;
    }
  }

  function _styleBgColorWithPreservedAlpha(def, currentValue, color) {
    const next = color || '';
    if (def?.bgType !== 'rgba') return next;
    if (!next || next === 'transparent' || !/^#[0-9a-f]{3,6}$/i.test(next)) return next;
    const parsed = typeof parseColorToHexAlpha === 'function' ? parseColorToHexAlpha(currentValue) : null;
    const alpha = Number.isFinite(parsed?.alpha) ? parsed.alpha : 1;
    if (alpha > 0 && alpha < 1 && typeof hexAlphaToRgba === 'function') {
      return hexAlphaToRgba(next, alpha);
    }
    return next;
  }

  function _mapSettingsDef(def) {
    const map = {};
    const fields = [];
    const isCaret = CARET_RE.test(def.label || '');
    const isLine = !!def.line && !def.fg && !def.bg;
    const add = (prop, key, fieldName) => {
      if (!key || map[prop]) return;
      map[prop] = key;
      fields.push(fieldName || prop);
    };
    if (def.fg) {
      const prop = isCaret ? 'caretColor' : 'textColor';
      add(prop, def.fg);
    }
    if (def.bg) add('bgColor', def.bg);
    if (!isCaret && !isLine) {
      // 明示的に定義されたフィールドを優先追加。
      // ベースキーが抽出できない行（--fg のように共通変数のみの行）では
      // _settingsKey が '' を返すため、仮想フィールドは add() で自動スキップされる。
      add('fontSize', _settingsKey(def, 'fontSize', '-font-size'));
      add('fontFamily', _settingsKey(def, 'font', '-font'));
      add('fontWeight', _settingsKey(def, 'bold', '-bold'), 'bold');
      add('fontStyle', _settingsKey(def, 'italic', '-italic'), 'italic');
      add('textStrokeColor', _settingsKey(def, 'stroke', '-stroke-color'));
      add('textStrokeWidth', _settingsKey(def, 'strokeWidth', '-stroke-width'));
      add('leftAccent', _settingsKey(def, 'leftAccent', '-left-accent'));
      add('underline', _settingsKey(def, 'underline', '-underline'));
      // 背景色仮想フィールドは def に bg プロパティが明示されていないときだけ生成する
      // （bg: null は「背景色コントロールを出さない」という明示的指定）
      if (!map.bgColor && !Object.prototype.hasOwnProperty.call(def || {}, 'bg')) {
        add('bgColor', _settingsKey(def, 'bg', '-bg'));
      }
    }
    if (def.line) add('borderColor', def.line);
    if (def.width) {
      const prop = isCaret ? 'caretWidth' : 'borderWidth';
      add(prop, def.width);
    }
    return { map, fields: [...new Set(fields)] };
  }

  function _settingsValues(def, map) {
    return {
      textColor: map.textColor ? _cssVar(map.textColor) : '',
      bgColor: map.bgColor ? _cssVar(map.bgColor) : '',
      fontWeight: map.fontWeight && _cssVar(map.fontWeight) === 'bold' ? 'bold' : '',
      fontStyle: map.fontStyle && _cssVar(map.fontStyle) === 'italic' ? 'italic' : '',
      fontSize: map.fontSize ? _pxNumber(_cssVar(map.fontSize), _previewFontSize(def.label) || '') : '',
      fontFamily: map.fontFamily ? _cssVar(map.fontFamily) : '',
      textStrokeColor: map.textStrokeColor ? _cssVar(map.textStrokeColor) : '',
      textStrokeWidth: map.textStrokeWidth ? _pxNumber(_cssVar(map.textStrokeWidth), 0) : '',
      leftAccent: map.leftAccent ? _activeFlag(_cssVar(map.leftAccent)) : false,
      underline: map.underline ? _activeFlag(_cssVar(map.underline)) : false,
      accentColor: map.accentColor ? _cssVar(map.accentColor) : '',
      borderColor: map.borderColor ? _cssVar(map.borderColor) : '',
      borderWidth: map.borderWidth ? _pxNumber(_cssVar(map.borderWidth), 1) : '',
      caretColor: map.caretColor ? _cssVar(map.caretColor) : '',
      caretWidth: map.caretWidth ? _pxNumber(_cssVar(map.caretWidth), 2) : '',
    };
  }

  function _settingsPreviewStyle(def) {
    const { map } = _mapSettingsDef(def);
    const values = _settingsValues(def, map);
    const isCaret = CARET_RE.test(def.label || '');
    const bg = map.bgColor && !_isTransparent(values.bgColor) ? `var(${map.bgColor})` : PAGE_BG;
    const fg = map.textColor ? `var(${map.textColor})` : def.line ? `var(${def.line})` : 'var(--fg)';
    const lineWidth = map.borderWidth ? `var(${map.borderWidth})` : '3px';
    const fallbackAccent = map.borderColor ? `var(${map.borderColor})` : fg;
    const accent = map.accentColor ? `var(${map.accentColor}, ${fallbackAccent})` : fallbackAccent;
    const parts = [
      `background:${bg}`,
      `color:${fg}`,
    ];
    if (map.fontWeight) parts.push(`font-weight:var(${map.fontWeight})`);
    if (map.fontStyle) parts.push(`font-style:var(${map.fontStyle})`);
    if (map.fontSize) parts.push(`font-size:var(${map.fontSize})`, 'line-height:1.3');
    if (map.fontFamily) parts.push(`font-family:var(${map.fontFamily}, inherit)`);
    if (map.textStrokeColor) parts.push(`-webkit-text-stroke-color:var(${map.textStrokeColor})`, `-webkit-text-stroke-width:var(${map.textStrokeWidth || '--_zero'}, 0px)`, 'paint-order:stroke fill');
    if (values.leftAccent) parts.push(`box-shadow:-${STYLE_LEFT_ACCENT_WIDTH} 0 0 0 ${accent}`, `padding-left:${STYLE_LEFT_ACCENT_WIDTH}`);
    if (values.underline) parts.push(`border-bottom:${STYLE_UNDERLINE_WIDTH} solid ${accent}`);
    if (def.line) parts.push(`border-bottom:${lineWidth} solid var(${def.line})`);
    if (isCaret) {
      const caretColor = `var(${map.caretColor || '--editor-caret-color'})`;
      const caretWidth = `var(${map.caretWidth || '--editor-caret-width'}, 2px)`;
      parts.push(
        'color:transparent',
        'font-size:0',
        'min-height:26px',
        `background-image:linear-gradient(${caretColor}, ${caretColor})`,
        'background-repeat:no-repeat',
        'background-position:center',
        `background-size:${caretWidth} calc(100% - 10px)`
      );
    }
    const previewSize = _previewFontSize(def.label);
    if (previewSize && !isCaret) parts.push(`font-size:${previewSize}px`, 'line-height:1.3');
    return parts.join(';');
  }

  function _settingsPreviewStyleForRender(def) {
    if (typeof window._settingsThemePreviewStyle === 'function') {
      return window._settingsThemePreviewStyle(def);
    }
    return _settingsPreviewStyle(def);
  }

  function _refreshSettingsPreviewElement(previewEl, def) {
    if (!previewEl?.setAttribute || !def) return;
    previewEl.setAttribute('style', _settingsPreviewStyleForRender(def));
  }

  function _settingsPreviewE2eId(def, styleId = '') {
    const numberKeys = Array.isArray(def?.numbers) ? def.numbers.map(item => item?.key || '').filter(Boolean).join('_') : '';
    return _e2eId(
      'settings-theme-style-preview',
      def?.fg,
      def?.bg,
      def?.line,
      def?.font,
      def?.bold,
      def?.italic,
      def?.fontSize,
      def?.width,
      numberKeys,
      styleId || _e2eFallbackText(def?.label || def?.text)
    );
  }

  function _numberSpecValue(spec) {
    const fallback = spec?.fallback ?? spec?.value ?? spec?.min ?? 0;
    return _pxNumber(_cssVar(spec?.key), fallback);
  }

  function _numberAttr(name, value) {
    return value == null ? '' : ` ${name}="${_e(value)}"`;
  }

  function _renderNumberSpec(spec) {
    const key = spec?.key || '';
    if (!key) return '';
    const value = _numberSpecValue(spec);
    const unit = spec.unit || '';
    const controlId = _e2eId('settings-theme-number', key);
    const label = spec.label || key || '数値';
    const labelAttrs = `aria-label="${_e(label)}" title="${_e(label)}"`;
    const common = [
      `data-number-key="${_e(key)}"`,
      `data-unit="${_e(unit)}"`,
      _numberAttr('min', spec.min).trim(),
      _numberAttr('max', spec.max).trim(),
      _numberAttr('step', spec.step ?? 1).trim(),
    ].filter(Boolean).join(' ');
    const range = spec.slider ? `<input type="range" class="cs-alpha cs-number-range" value="${_e(value)}" ${common} ${labelAttrs} data-e2e-id="${_e(controlId + '-range')}" data-oninput="setNumericStyleSetting(this)">` : '';
    return `<div class="cs-row-group cs-row-group--number">
      <span class="cs-row-group-label">${_e(spec.label || '')}</span>
      ${range}
      <input type="number" class="cs-width-input cs-number-input" value="${_e(value)}" ${common} ${labelAttrs} data-e2e-id="${_e(controlId + '-input')}" data-oninput="setNumericStyleSetting(this)" data-onchange="setNumericStyleSetting(this)">
      <span class="cs-number-unit">${_e(unit)}</span>
    </div>`;
  }

  function renderStyleRowUnified(def) {
    if (Array.isArray(def.numbers) && def.numbers.length) {
      const previewText = def.text || def.label || '数値';
      const previewStyle = /選択背景/.test(def.label || '')
        ? 'background:var(--ui-inner-tab-active-bg);color:var(--ui-inner-tab-active-fg);'
        : 'background:var(--ui-inner-tab-bg);color:var(--ui-inner-tab-fg);';
      return `<div class="cs-row">
      <span class="cs-row-label">${_e(def.label)}</span>
      <span class="cs-row-preview" data-e2e-id="${_e(_settingsPreviewE2eId(def))}" data-style-preview-label="${_e(def.label || '')}" style="${_e(previewStyle)}">${_e(previewText)}</span>
      ${def.numbers.map(_renderNumberSpec).join('')}
    </div>`;
    }
    if (_isBgOnlySettingsDef(def)) {
      const styleId = _registerSettingsDef(def);
      const raw = _cssVar(def.bg);
      const bgStyle = _isTransparent(raw) ? _CHECKER_BG_INLINE_STYLE : `background:${raw}`;
      const label = def.label || '背景色';
      return `<div class="cs-row">
      <span class="cs-row-label">${_e(def.label)}</span>
      <button type="button" class="gb-fmt-swatch-bg cs-row-bg-swatch" data-e2e-id="${_e(_e2eId('settings-theme-bg-swatch', def.bg || styleId))}" data-style-id="${_e(styleId)}" data-style-label="${_e(def.label)}" data-style-bg-key="${_e(def.bg)}" data-style-bg-type="${_e(def.bgType || '')}" data-action="openStyleBgOnlyPalette(this)" aria-label="${_e(label)}の色を変更" title="クリックで色を変更" style="${_e(bgStyle)}"></button>
    </div>`;
    }
    if (def.previewType === 'slider') {
      const styleId = _registerSettingsDef(def);
      const label = def.label || 'スライダー';
      // プレビュー専用なのでスライダー本体はドラッグ不可にし、ラッパーで書式ポップアップを開く。
      // --gb-range-fill-pct を 50% に固定してプレビュー中央に fill / track 両色が見えるようにする
      return `<div class="cs-row">
      <span class="cs-row-label">${_e(def.label)}</span>
      <span class="cs-row-preview cs-row-preview--slider cs-row-preview--clickable" data-e2e-id="${_e(_settingsPreviewE2eId(def, styleId))}" data-style-preview-label="${_e(def.label || '')}" data-style-id="${_e(styleId)}" data-style-label="${_e(def.label)}" data-action="openStylePreviewPopup(this)" tabindex="0" role="button" aria-label="${_e(label)}の書式設定" title="クリックで書式設定" style="display:inline-flex;align-items:center;padding:4px 8px;min-width:120px;">
        <input type="range" min="0" max="100" value="50" data-e2e-id="${_e(_e2eId('settings-theme-preview-range', styleId))}" tabindex="-1" aria-hidden="true" style="--gb-range-fill-pct:50%;width:100%;pointer-events:none;" />
      </span>
    </div>`;
    }
    const mapping = _mapSettingsDef(def);
    const clickable = mapping.fields.length > 0;
    const styleId = clickable ? _registerSettingsDef(def) : '';
    const attrs = clickable
      ? ` data-e2e-id="${_e(_settingsPreviewE2eId(def, styleId))}" data-style-preview-label="${_e(def.label || '')}" data-style-id="${_e(styleId)}" data-style-label="${_e(def.label)}" data-action="openStylePreviewPopup(this)" tabindex="0" role="button" aria-label="${_e(def.label || 'スタイル')}の書式設定" title="クリックで書式設定"`
      : ` data-e2e-id="${_e(_settingsPreviewE2eId(def, styleId))}" data-style-preview-label="${_e(def.label || '')}"`;
    const isCaret = CARET_RE.test(def.label || '');
    const cls = 'cs-row-preview' + (clickable ? ' cs-row-preview--clickable' : '') + (def.line ? ' cs-row-preview--line' : '') + (isCaret ? ' cs-row-preview--caret' : '');
    const previewText = isCaret ? '\u00a0' : (def.text || def.label || 'Aa1');
    return `<div class="cs-row">
      <span class="cs-row-label">${_e(def.label)}</span>
      <span class="${cls}"${attrs} style="${_e(_settingsPreviewStyleForRender(def))}">${_e(previewText)}</span>
    </div>`;
  }

  function openStylePreviewPopupUnified(previewEl) {
    const popupOpen = window.openFormatPopup
      || (typeof openFormatPopup === 'function' ? openFormatPopup : null);
    if (!previewEl || typeof popupOpen !== 'function') return;
    if (typeof _settingsThemeIsReadonlyElement === 'function' && _settingsThemeIsReadonlyElement(previewEl)) {
      if (typeof _settingsThemePromptDuplicateForEdit === 'function') _settingsThemePromptDuplicateForEdit();
      return;
    }
    const def = _defByPreview(previewEl);
    if (!def) return;
    const { map, fields } = _mapSettingsDef(def);
    if (!fields.length) return;
    const stateEntry = def.__themeStateEntry || null;
    const stateTargetKeys = stateEntry && typeof settingsThemeStyleSettingTargetKeys === 'function'
      ? settingsThemeStyleSettingTargetKeys(stateEntry.key)
      : (stateEntry ? [stateEntry.key] : []);
    const stateStylesBefore = stateTargetKeys.map(key => ({
      key,
      value: document.documentElement.style.getPropertyValue(key),
      priority: document.documentElement.style.getPropertyPriority(key),
    }));
    const statePreviewStylesBefore = stateEntry ? ['--theme-state-source', '--theme-state-focus', '--a11y-focus-ring'].map(key => ({
      key,
      value: previewEl.style.getPropertyValue(key),
      priority: previewEl.style.getPropertyPriority(key),
    })) : [];
    const stateInlineBefore = stateEntry ? document.documentElement.style.getPropertyValue(stateEntry.key) : '';
    const stateDirtyBefore = stateEntry && typeof _settingsThemeIsDirty === 'function' ? _settingsThemeIsDirty() : null;
    const syncStateAccentSwatches = (color = '') => {
      if (!stateTargetKeys.includes('--ui-accent')) return;
      const accent = color || getComputedStyle(document.documentElement).getPropertyValue('--ui-accent').trim();
      document.querySelectorAll('[data-settings-theme-accent-swatch]').forEach(swatch => {
        swatch.style.background = accent;
      });
    };
    let stateEditCancelled = false;
    const cancelStateEdit = () => {
      if (!stateEntry || stateEditCancelled) return;
      stateEditCancelled = true;
      stateStylesBefore.forEach(({ key, value, priority }) => {
        if (value) document.documentElement.style.setProperty(key, value, priority);
        else document.documentElement.style.removeProperty(key);
        if (typeof updateCsSwatch === 'function') updateCsSwatch(key, value);
      });
      statePreviewStylesBefore.forEach(({ key, value, priority }) => {
        if (value) previewEl.style.setProperty(key, value, priority);
        else previewEl.style.removeProperty(key);
      });
      syncStateAccentSwatches();
      if (typeof _settingsThemeSetDirty === 'function') _settingsThemeSetDirty(stateDirtyBefore);
      previewEl.classList.remove('is-selected');
      previewEl.setAttribute('aria-pressed', 'false');
      openedPopup?._gbFmtCleanup?.();
      openedPopup?.remove();
      previewEl.focus({ preventScroll: true });
    };
    if (stateEntry?.state === 'selected') {
      const selected = !previewEl.classList.contains('is-selected');
      previewEl.classList.toggle('is-selected', selected);
      previewEl.setAttribute('aria-pressed', selected ? 'true' : 'false');
    }
    let openedPopup = null;
    openedPopup = popupOpen(previewEl, {
      fields,
      values: _settingsValues(def, map),
      bgColorType: def.bgType || '',
      onChange(prop, value) {
        const stateKey = stateEntry && ({
          textColor: map.textColor,
          bgColor: map.bgColor,
          borderColor: map.borderColor,
        })[prop];
        if (stateKey) {
          if (typeof applySettingsThemeStyleSetting === 'function') {
            applySettingsThemeStyleSetting(stateKey, value || '');
          } else {
            _setRootStyle(stateKey, value || '');
          }
          if (typeof updateCsSwatch === 'function') updateCsSwatch(stateKey, value || '');
          syncStateAccentSwatches(value || '');
          const resolvedStateValue = value || _cssVar(stateKey) || '';
          previewEl.style.setProperty('--theme-state-source', resolvedStateValue);
          if (stateEntry.state === 'focus') {
            previewEl.style.setProperty('--theme-state-focus', resolvedStateValue);
            previewEl.style.setProperty('--a11y-focus-ring', resolvedStateValue);
          }
          return;
        }
        if (prop === 'textColor' && map.textColor) _setThemeStyle(map.textColor, value || '');
        else if (prop === 'bgColor' && map.bgColor) _setThemeStyle(map.bgColor, _styleBgColorWithPreservedAlpha(def, _cssVar(map.bgColor), value));
        else if (prop === 'fontWeight' && map.fontWeight) _setThemeStyle(map.fontWeight, value === 'bold' ? 'bold' : 'normal');
        else if (prop === 'fontStyle' && map.fontStyle) _setThemeStyle(map.fontStyle, value === 'italic' ? 'italic' : 'normal');
        else if (prop === 'fontSize' && map.fontSize) _setThemeStyle(map.fontSize, value == null ? '' : value + 'px');
        else if (prop === 'fontFamily' && map.fontFamily) _setThemeStyle(map.fontFamily, value || '');
        else if (prop === 'textStrokeColor' && map.textStrokeColor) _setThemeStyle(map.textStrokeColor, value || '');
        else if (prop === 'textStrokeWidth' && map.textStrokeWidth) _setThemeStyle(map.textStrokeWidth, value == null ? '' : value + 'px');
        else if (prop === 'leftAccent' && map.leftAccent) _setThemeStyle(map.leftAccent, value ? STYLE_LEFT_ACCENT_WIDTH : '');
        else if (prop === 'underline' && map.underline) _setThemeStyle(map.underline, value ? STYLE_UNDERLINE_WIDTH : '');
        else if (prop === 'borderColor' && map.borderColor) _setThemeStyle(map.borderColor, value || '');
        else if (prop === 'borderWidth' && map.borderWidth) _setThemeStyle(map.borderWidth, value == null ? '' : value + 'px');
        else if (prop === 'caretColor' && map.caretColor) _setThemeStyle(map.caretColor, value || '');
        else if (prop === 'caretWidth' && map.caretWidth) _setThemeStyle(map.caretWidth, value == null ? '' : value + 'px');
        if (stateEntry && typeof refreshSettingsThemePreview === 'function') refreshSettingsThemePreview();
        else _refreshSettingsPreviewElement(previewEl, def);
      },
      ...(stateEntry ? {
        closeOnEscape: false,
        closeOnOutside: false,
        footerActions: {
          commands: [],
          closeLabel: '取消',
          onClose: cancelStateEdit,
        },
      } : {}),
    });
    if (stateEntry && openedPopup) {
      const escapeCancelHandler = (event) => {
        if (event.key !== 'Escape' || document.querySelector('.gb-palette-popup')) return;
        event.preventDefault();
        event.stopPropagation();
        cancelStateEdit();
      };
      const previousCleanup = openedPopup._gbFmtCleanup;
      openedPopup._gbFmtCleanup = () => {
        document.removeEventListener('keydown', escapeCancelHandler, true);
        previousCleanup?.();
      };
      document.addEventListener('keydown', escapeCancelHandler, true);
    }
  }

  function openStyleBgOnlyPaletteUnified(swatchEl) {
    if (!swatchEl || typeof openColorPalette !== 'function') return;
    if (typeof _settingsThemeIsReadonlyElement === 'function' && _settingsThemeIsReadonlyElement(swatchEl)) {
      if (typeof _settingsThemePromptDuplicateForEdit === 'function') _settingsThemePromptDuplicateForEdit();
      return;
    }
    const key = swatchEl.dataset.styleBgKey || '';
    if (!key) return;
    const def = _defByPreview(swatchEl) || { bgType: swatchEl.dataset.styleBgType || '' };
    const currentValue = _cssVar(key);
    openColorPalette(swatchEl, currentValue, (color) => {
      _setThemeStyle(key, _styleBgColorWithPreservedAlpha(def, currentValue, color));
      _applyBgOnlySwatchBackground(swatchEl, key);
    });
  }

  function _fieldText(field) {
    return `${field?.key || ''} ${field?.cssVar || ''} ${field?.label || ''}`;
  }

  function _fieldKeyText(field) {
    return `${field?.key || ''} ${field?.cssVar || ''}`;
  }

  function _isExplicitFgField(field) {
    return /(^|[-_])fg(?=$|[-_\s])|text-fg|textColor|baseTextColor/i.test(_fieldKeyText(field));
  }

  function _findField(fields, test) {
    return fields.find(field => field && test(field));
  }

  function _isTextColorField(field) {
    const t = _fieldText(field);
    return field.type === 'color' && !LINE_RE.test(t) && !CARET_RE.test(t)
      && (_isExplicitFgField(field) || (TEXT_RE.test(t) && !BG_RE.test(t)));
  }

  function _isBgField(field) {
    const t = _fieldText(field);
    return field.type === 'color' && BG_RE.test(t) && !_isExplicitFgField(field) && !LINE_RE.test(t) && !CARET_RE.test(t);
  }

  function _isLineField(field) {
    return field.type === 'color' && LINE_RE.test(_fieldText(field)) && !CARET_RE.test(_fieldText(field));
  }

  function _isCaretField(field) {
    return field.type === 'color' && CARET_RE.test(_fieldText(field));
  }

  function _isWidthField(field) {
    const t = _fieldText(field);
    return (field.type === 'pxtext' || field.type === 'number' || field.type === 'toggle')
      && LINE_RE.test(t) && !CARET_RE.test(t) && !/lineHeight|行間|letter|字間|ruby|ルビ|wrap|折り返し/i.test(t);
  }

  function _isFontSizeField(field) {
    const t = _fieldText(field);
    return field.type === 'number' && /fontSize|フォントサイズ|サイズ/i.test(t) && !/ruby|ルビ|offset|オフセット/i.test(t);
  }

  function _fileFieldCssKey(field) {
    const key = String(field?.cssVar || field?.key || '').trim();
    return key.startsWith('--') ? key : '';
  }

  function _fileFieldIdentity(field) {
    return field?.key || field?.cssVar || field?.label || field?.type || '';
  }

  function _filePreviewE2eId(rowData) {
    const fieldIds = (rowData?.fields || []).map(_fileFieldIdentity).filter(Boolean).join('-');
    return _e2eId('file-style-preview', rowData?.label || '', fieldIds || 'row');
  }

  function _fileRowBase(fields) {
    const source = fields.map(_fileFieldCssKey).find(key => /-(?:fg|color|font|bold|italic|bg)$/i.test(key))
      || fields.map(_fileFieldCssKey).find(Boolean);
    return _styleBaseKey(source);
  }

  function _virtualFileField(base, suffix, label, type, extra) {
    if (!base) return null;
    return Object.assign({ key: `${base}${suffix}`, label, type, virtual: true }, extra || {});
  }

  function _supportsGeneratedFileStyleBase(base) {
    return SETTINGS_GENERATED_STYLE_BASE_RE.test(String(base || ''));
  }

  function _isStrokeColorField(field) {
    return field.type === 'color' && /stroke|フチ|縁/i.test(_fieldText(field)) && !/width|幅/i.test(_fieldText(field));
  }

  function _isStrokeWidthField(field) {
    return (field.type === 'pxtext' || field.type === 'number') && /stroke|フチ|縁/i.test(_fieldText(field));
  }

  function _isLeftAccentField(field) {
    return (field.type === 'toggle' || field.type === 'checkbox') && /leftAccent|left-accent|左アクセント/i.test(_fieldText(field));
  }

  function _isUnderlineField(field) {
    return (field.type === 'toggle' || field.type === 'checkbox') && /underline|下線/i.test(_fieldText(field));
  }

  function _isAccentColorField(field) {
    const text = _fieldText(field);
    return field.type === 'color' && /accent|アクセント/i.test(text) && !/left|左/i.test(text);
  }

  function _mapFileRow(rowData) {
    const fields = rowData?.fields || [];
    const map = {};
    const popupFields = [];
    const add = (prop, field) => {
      if (field && !map[prop]) {
        map[prop] = field;
        popupFields.push(prop);
      }
    };
    add('textColor', _findField(fields, _isTextColorField));
    add('bgColor', _findField(fields, _isBgField));
    add('fontWeight', _findField(fields, f => f.type === 'toggle' && f.on === 'bold'));
    add('fontStyle', _findField(fields, f => f.type === 'toggle' && f.on === 'italic'));
    add('fontSize', _findField(fields, _isFontSizeField));
    add('fontFamily', _findField(fields, f => f.type === 'select' && (f.preview === 'fontSample' || /font|フォント/i.test(_fieldText(f)))));
    add('borderColor', _findField(fields, _isLineField));
    add('borderWidth', _findField(fields, _isWidthField));
    add('caretColor', _findField(fields, _isCaretField));
    add('caretWidth', _findField(fields, f => (f.type === 'pxtext' || f.type === 'number') && CARET_RE.test(_fieldText(f))));
    if (map.borderColor && !map.borderWidth) add('borderWidth', _findField(fields, f => f.type === 'toggle' && f.on && f.off !== undefined));
    if (!popupFields.length && fields.length === 1 && fields[0]?.type === 'color') add('textColor', fields[0]);
    const base = _fileRowBase(fields);
    const hasTextStyle = base && !map.caretColor && !((map.borderColor || map.borderWidth) && !map.textColor && !map.bgColor && !map.fontFamily)
      && (map.textColor || map.bgColor || map.fontWeight || map.fontStyle || map.fontSize || map.fontFamily);
    const supportsGeneratedTextStyle = hasTextStyle && _supportsGeneratedFileStyleBase(base);
    if (hasTextStyle) {
      add('fontSize', _findField(fields, _isFontSizeField) || (supportsGeneratedTextStyle ? _virtualFileField(base, '-font-size', 'フォントサイズ', 'pxtext') : null));
      add('fontFamily', map.fontFamily || (supportsGeneratedTextStyle ? _virtualFileField(base, '-font', 'フォント', 'select', {
        options: typeof getFontFamilyOptions === 'function' ? getFontFamilyOptions : undefined,
        normalize: typeof normalizeFontFamilyValue === 'function' ? normalizeFontFamilyValue : undefined,
        preview: 'fontSample',
      }) : null));
      add('fontWeight', map.fontWeight || (supportsGeneratedTextStyle ? _virtualFileField(base, '-bold', '太字', 'toggle', { on: 'bold', off: 'normal' }) : null), 'bold');
      add('fontStyle', map.fontStyle || (supportsGeneratedTextStyle ? _virtualFileField(base, '-italic', '斜体', 'toggle', { on: 'italic', off: 'normal' }) : null), 'italic');
      add('bgColor', map.bgColor || (supportsGeneratedTextStyle ? _virtualFileField(base, '-bg', '背景色', 'color') : null));
      add('textStrokeColor', _findField(fields, _isStrokeColorField) || (supportsGeneratedTextStyle ? _virtualFileField(base, '-stroke-color', '文字フチ色', 'color') : null));
      add('textStrokeWidth', _findField(fields, _isStrokeWidthField) || (supportsGeneratedTextStyle ? _virtualFileField(base, '-stroke-width', '文字フチ幅', 'pxtext') : null));
      add('leftAccent', _findField(fields, _isLeftAccentField) || (supportsGeneratedTextStyle ? _virtualFileField(base, '-left-accent', '左アクセントバー', 'toggle', { on: STYLE_LEFT_ACCENT_WIDTH, off: '' }) : null));
      add('underline', _findField(fields, _isUnderlineField) || (supportsGeneratedTextStyle ? _virtualFileField(base, '-underline', '行の下線', 'toggle', { on: STYLE_UNDERLINE_WIDTH, off: '' }) : null));
      add('accentColor', _findField(fields, _isAccentColorField) || (supportsGeneratedTextStyle ? _virtualFileField(base, '-accent-color', 'アクセントカラー', 'color') : null));
    }
    return { map, fields: [...new Set(popupFields.map(prop => prop === 'fontWeight' ? 'bold' : prop === 'fontStyle' ? 'italic' : prop))] };
  }

  function getFileThemePreviewMappedFields(rowData) {
    const seen = new Set();
    return Object.values(_mapFileRow(rowData).map)
      .filter(Boolean)
      .filter(field => {
        const id = field.key || field.cssVar || field.label || '';
        if (!id || seen.has(id)) return false;
        seen.add(id);
        return true;
      });
  }

  function _fileRowPopupable(rowData) {
    const fields = rowData?.fields || [];
    if (!fields.length) return false;
    if (fields.some(f => f.type === 'boardBgImage' || f.type === 'boardBgFit' || f.type === 'checkbox' || f.type === 'themeId')) return false;
    return _mapFileRow(rowData).fields.length > 0;
  }

  function _expandFileRow(rowData) {
    const fields = rowData?.fields || [];
    if (fields.length <= 1) return [rowData];
    const mapped = new Set(Object.values(_mapFileRow(rowData).map).filter(Boolean));
    const unsupported = fields.filter(field => !mapped.has(field));
    return unsupported.length ? fields.map(field => ({ label: field.label, fields: [field], preview: rowData.preview })) : [rowData];
  }

  function _readFile(field, adapter) {
    return field && adapter && typeof _fsReadFieldValue === 'function' ? _fsReadFieldValue(field, adapter) : '';
  }

  function _fileValues(rowData, adapter, map) {
    return {
      textColor: _readFile(map.textColor, adapter),
      bgColor: _readFile(map.bgColor, adapter),
      fontWeight: _readFile(map.fontWeight, adapter) === 'bold' ? 'bold' : '',
      fontStyle: _readFile(map.fontStyle, adapter) === 'italic' ? 'italic' : '',
      fontSize: _pxNumber(_readFile(map.fontSize, adapter), _previewFontSize(rowData.label) || ''),
      fontFamily: _readFile(map.fontFamily, adapter),
      textStrokeColor: _readFile(map.textStrokeColor, adapter),
      textStrokeWidth: _pxNumber(_readFile(map.textStrokeWidth, adapter), 0),
      leftAccent: _activeFlag(_readFile(map.leftAccent, adapter)),
      underline: _activeFlag(_readFile(map.underline, adapter)),
      accentColor: _readFile(map.accentColor, adapter),
      borderColor: _readFile(map.borderColor, adapter),
      borderWidth: _pxNumber(_readFile(map.borderWidth, adapter), ''),
      caretColor: _readFile(map.caretColor, adapter),
      caretWidth: _pxNumber(_readFile(map.caretWidth, adapter), ''),
    };
  }

  function _filePreview(rowData, adapter) {
    const { map } = _mapFileRow(rowData);
    const values = _fileValues(rowData, adapter, map);
    const el = document.createElement('span');
    const isCaret = !!map.caretColor;
    const lineOnly = !isCaret && (map.borderColor || map.caretColor) && !map.textColor && !map.bgColor && !map.fontFamily;
    const label = _rowLabel(rowData) || rowData.label || '書式';
    el.className = 'cs-row-preview cs-row-preview--clickable' + (lineOnly ? ' cs-row-preview--line' : '') + (isCaret ? ' cs-row-preview--caret' : '');
    el.tabIndex = 0;
    el.role = 'button';
    el.title = 'クリックで書式設定';
    el.setAttribute('aria-label', `${label}の書式設定`);
    el.dataset.e2eId = _filePreviewE2eId(rowData);
    el.dataset.stylePreviewLabel = _rowLabel(rowData) || rowData.label || '';
    el.textContent = isCaret ? '\u00a0' : (lineOnly ? '━━' : (rowData.label || 'Aa1'));
    el.style.background = _isTransparent(values.bgColor) ? PAGE_BG : values.bgColor;
    el.style.color = values.textColor || values.borderColor || values.caretColor || 'var(--fg)';
    if (values.fontWeight === 'bold') el.style.fontWeight = 'bold';
    if (values.fontStyle === 'italic') el.style.fontStyle = 'italic';
    const previewSize = values.fontSize || _previewFontSize(rowData.label);
    if (previewSize) el.style.fontSize = previewSize + 'px';
    if (values.fontFamily) el.style.fontFamily = values.fontFamily;
    if (values.textStrokeColor) {
      el.style.webkitTextStrokeColor = values.textStrokeColor;
      el.style.webkitTextStrokeWidth = (values.textStrokeWidth || 0) + 'px';
      el.style.paintOrder = 'stroke fill';
    }
    const accent = values.accentColor || values.borderColor || values.textColor || 'var(--accent)';
    if (values.leftAccent) {
      el.style.boxShadow = `-${STYLE_LEFT_ACCENT_WIDTH} 0 0 0 ${accent}`;
      el.style.paddingLeft = STYLE_LEFT_ACCENT_WIDTH;
    }
    if (values.underline) {
      el.style.borderBottom = `${STYLE_UNDERLINE_WIDTH} solid ${accent}`;
    }
    if (values.borderColor) el.style.borderBottom = `${values.borderWidth || 3}px solid ${values.borderColor}`;
    if (isCaret) {
      const caretColor = values.caretColor || 'var(--editor-caret-color)';
      const caretWidth = values.caretWidth || 2;
      el.style.color = 'transparent';
      el.style.fontSize = '0';
      el.style.minHeight = '26px';
      el.style.backgroundImage = `linear-gradient(${caretColor}, ${caretColor})`;
      el.style.backgroundRepeat = 'no-repeat';
      el.style.backgroundPosition = 'center';
      el.style.backgroundSize = `${caretWidth}px calc(100% - 10px)`;
    }
    el.addEventListener('click', () => _openFileStylePopup(el, rowData, adapter));
    el.addEventListener('keydown', ev => {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        _openFileStylePopup(el, rowData, adapter);
      }
    });
    return el;
  }

  function _rawForField(field, prop, value) {
    if (value == null || value === '') return '';
    if (field.type === 'toggle') {
      if (prop === 'fontWeight') return value === 'bold' ? field.on : field.off;
      if (prop === 'fontStyle') return value === 'italic' ? field.on : field.off;
      return value ? field.on : field.off;
    }
    if (field.type === 'pxtext') return String(value).match(/px|em|rem|%$/) ? String(value) : value + 'px';
    return value;
  }

  function _setFileField(field, prop, value, adapter) {
    if (!field || !adapter) return;
    const raw = _rawForField(field, prop, value);
    const normalized = typeof _fsNormalizeFieldValue === 'function' ? _fsNormalizeFieldValue(field, raw) : raw;
    adapter.set(field, normalized || '');
    adapter.applyCss(field, normalized || '');
  }

  function _replaceFilePreview(anchorEl, rowData, adapter) {
    const next = _filePreview(rowData, adapter);
    if (anchorEl?.isConnected) anchorEl.replaceWith(next);
    return next;
  }

  function _openFileStylePopup(anchorEl, rowData, adapter) {
    if (!anchorEl || !adapter || typeof openFormatPopup !== 'function') return;
    const { map, fields } = _mapFileRow(rowData);
    if (!fields.length) return;
    openFormatPopup(anchorEl, {
      fields,
      values: _fileValues(rowData, adapter, map),
      onChange(prop, value) {
        const key = prop === 'bold' ? 'fontWeight'
          : prop === 'italic' ? 'fontStyle'
          : prop;
        _setFileField(map[key], key, value, adapter);
        anchorEl = _replaceFilePreview(anchorEl, rowData, adapter);
      },
      onReset: () => {
        Object.entries(map).forEach(([prop, field]) => _setFileField(field, prop, '', adapter));
        anchorEl = _replaceFilePreview(anchorEl, rowData, adapter);
      },
    });
  }

  function _rowLabel(rowData) {
    if (rowData.label) return rowData.label;
    const labels = (rowData.fields || []).map(f => f?.label).filter(Boolean);
    return labels.length ? labels.join(' / ') : '';
  }

  function renderFileStyleTabUnified(ctx) {
    const rpDetail = document.getElementById('rp-detail');
    if (rpDetail && typeof _ensureDetailTabShell === 'function') _ensureDetailTabShell(rpDetail);
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
    hdr.textContent = '対象: ' + (ctxLabel || '-');
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
        section.rows
          .filter(row => row && Array.isArray(row.fields) && row.fields.length)
          .flatMap(rowData => _expandFileRow(rowData))
          .forEach(rowData => {
          const row = document.createElement('div');
          row.className = 'gb-fmt-popup-row gb-fmt-popup-row--wrap';
          row._fsRowData = rowData;
          row._fsAdapter = adapter;
          const labelText = _rowLabel(rowData);
          if (labelText) {
            const groupLabel = document.createElement('span');
            groupLabel.className = 'gb-fmt-label gb-fmt-label--group';
            groupLabel.textContent = labelText;
            row.appendChild(groupLabel);
          }
          if (rowData.preview !== false && _fileRowPopupable(rowData)) {
            row.appendChild(_filePreview(rowData, adapter));
          } else {
            rowData.fields.forEach(field => row.appendChild(_fsBuildFieldInline(field, adapter, rowData.label)));
          }
          sec.appendChild(row);
        });
        wrap.appendChild(sec);
      });
    }

    el.appendChild(wrap);
    _fsBindThemePanel(el, ctx);
    if (typeof replaceIcons === 'function') replaceIcons();
  }

  window.renderStyleRow = renderStyleRowUnified;
  window.openStylePreviewPopup = openStylePreviewPopupUnified;
  window.getSettingsThemePreviewMappedFields = def => _mapSettingsDef(def).fields;
  window.openStyleBgOnlyPalette = openStyleBgOnlyPaletteUnified;
  window.renderFileStyleTab = renderFileStyleTabUnified;
  window.getFileThemePreviewMappedFields = getFileThemePreviewMappedFields;
})();
