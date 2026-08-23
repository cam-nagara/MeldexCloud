/* gb-settings.part03.js */
function openSettingsThemeExtraSlotPopup(anchor, row, col, root) {
  if (!anchor || !Number.isInteger(row) || !Number.isInteger(col)) return;
  if (typeof closeColorPalette === 'function') closeColorPalette();
  closeSettingsThemeColorSlotPopup();
  const panelRoot = root || anchor.closest?.('#settings-theme-palette-editor') || document;
  const currentColor = anchor.dataset.color || '#888888';
  let hsb = typeof _hexToHsb === 'function' ? _hexToHsb(currentColor) : { h: 0, s: 50, b: 90 };

  const popup = document.createElement('div');
  popup.className = 'gb-palette gb-palette-popup cs-theme-color-slot-popup';

  const title = document.createElement('div');
  title.className = 'gb-palette-section-heading';
  const rowLabel = row === 1 ? 'グレー' : row === 2 ? '自動（明）' : '自動（暗）';
  title.textContent = `${rowLabel} ${col + 1}`;
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
  const currentSlotColor = () => typeof _hsbToHex === 'function' ? _hsbToHex(hsb.h, hsb.s, hsb.b) : (picker.value || '#888888');
  const refreshPreview = () => {
    const c = currentSlotColor();
    picker.value = c;
    preview.style.background = c;
    preview.title = c;
  };
  const writeOverride = () => {
    const c = currentSlotColor();
    const next = getThemeColorExtraSlotSettings();
    next[`${row}-${col}`] = c;
    saveThemeColorExtraSlotSettings(next);
    _settingsThemePaletteMatrixRender(panelRoot);
    if (typeof _settingsThemeMarkDirty === 'function') _settingsThemeMarkDirty();
    refreshPreview();
  };
  const hSlider = _settingsThemeSlotSlider('色相', 0, 360, hsb.h, value => { hsb.h = value; writeOverride(); });
  const sSlider = _settingsThemeSlotSlider('彩度', 0, 100, hsb.s, value => { hsb.s = value; writeOverride(); });
  const bSlider = _settingsThemeSlotSlider('明度', 0, 100, hsb.b, value => { hsb.b = value; writeOverride(); });
  sliderSection.append(hSlider.row, sSlider.row, bSlider.row);
  popup.appendChild(sliderSection);

  const optionRow = document.createElement('div');
  optionRow.className = 'cs-theme-color-slot-options';
  const resetBtn = document.createElement('button');
  resetBtn.type = 'button';
  resetBtn.className = 'gb-btn-close';
  resetBtn.textContent = '自動に戻す';
  resetBtn.addEventListener('click', () => {
    const next = getThemeColorExtraSlotSettings();
    delete next[`${row}-${col}`];
    saveThemeColorExtraSlotSettings(next);
    _settingsThemePaletteMatrixRender(panelRoot);
    if (typeof _settingsThemeMarkDirty === 'function') _settingsThemeMarkDirty();
    closeSettingsThemeColorSlotPopup();
  });
  optionRow.appendChild(resetBtn);
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
    refreshPreview();
  };
  picker.addEventListener('input', () => {
    if (typeof _hexToHsb === 'function') hsb = _hexToHsb(picker.value);
    syncControls();
    writeOverride();
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

function _bindSettingsThemePaletteEditor(root) {
  if (!root || typeof getStandardPaletteAdjust !== 'function') return;
  _settingsThemePaletteMatrixRender(root);
  _settingsThemePaletteSyncSliders(root);

  const onAdjust = (key, value) => {
    if (_settingsThemeIsReadonlyElement(root)) {
      _settingsThemePromptDuplicateForEdit();
      _settingsThemePaletteSyncSliders(root);
      return;
    }
    const adjust = getStandardPaletteAdjust();
    adjust[key] = parseInt(value, 10);
    setStandardPaletteAdjust(adjust);
    _settingsThemePaletteMatrixRender(root);
    _settingsThemePaletteSyncSliders(root);
    _syncThemeColorSetFromPalette();
    if (typeof _settingsThemeMarkDirty === 'function') _settingsThemeMarkDirty();
  };

  root.querySelectorAll('[data-theme-palette-slider]').forEach(slider => {
    slider.addEventListener('input', () => {
      const key = slider.dataset.themePaletteSlider;
      onAdjust(key, slider.value);
    });
  });
  root.querySelectorAll('[data-theme-palette-slider-num]').forEach(num => {
    num.addEventListener('change', () => {
      const key = num.dataset.themePaletteSliderNum;
      onAdjust(key, num.value);
    });
  });
  if (!root._settingsThemePaletteSlotClickBound) {
    root._settingsThemePaletteSlotClickBound = true;
    root.addEventListener('click', ev => {
      const slotBtn = ev.target?.closest?.('[data-theme-palette-slot]');
      if (slotBtn && root.contains(slotBtn)) {
        if (_settingsThemeIsReadonlyElement(slotBtn)) {
          _settingsThemePromptDuplicateForEdit();
          return;
        }
        openSettingsThemeColorSlotPopup(slotBtn, parseInt(slotBtn.dataset.themePaletteSlot, 10), root);
        return;
      }
      const extraBtn = ev.target?.closest?.('[data-theme-palette-extra-slot]');
      if (extraBtn && root.contains(extraBtn)) {
        if (_settingsThemeIsReadonlyElement(extraBtn)) {
          _settingsThemePromptDuplicateForEdit();
          return;
        }
        const [row, col] = String(extraBtn.dataset.themePaletteExtraSlot || '').split('-').map(n => parseInt(n, 10));
        if (Number.isInteger(row) && Number.isInteger(col)) {
          openSettingsThemeExtraSlotPopup(extraBtn, row, col, root);
        }
      }
    });
  }
  root.querySelector('[data-theme-palette-reset]')?.addEventListener('click', () => {
    if (_settingsThemeIsReadonlyElement(root)) {
      _settingsThemePromptDuplicateForEdit();
      return;
    }
    if (typeof resetStandardPaletteAdjust === 'function') resetStandardPaletteAdjust();
    _settingsThemePaletteMatrixRender(root);
    _settingsThemePaletteSyncSliders(root);
    _syncThemeColorSetFromPalette();
    if (typeof _settingsThemeMarkDirty === 'function') _settingsThemeMarkDirty();
  });
}

function bindThemeColorSetEditor(root) {
  if (!root || typeof MeldexThemeManager === 'undefined' || typeof MeldexThemeManager.setThemeColorSet !== 'function') return;
  const scopedFilePanel = root.closest?.('[data-file-theme-panel]');
  if (scopedFilePanel?.dataset?.fileThemePanel) return;
  _bindSettingsThemePaletteEditor(root);
  root.querySelectorAll('[data-theme-color-slot]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (_settingsThemeIsReadonlyElement(btn)) {
        _settingsThemePromptDuplicateForEdit();
        return;
      }
      const index = parseInt(btn.dataset.themeColorSlot, 10);
      openSettingsThemeColorSlotPopup(btn, index, root);
    });
  });
  root.querySelector('[data-theme-color-reset]')?.addEventListener('click', () => {
    if (_settingsThemeIsReadonlyElement(root)) {
      _settingsThemePromptDuplicateForEdit();
      return;
    }
    const next = typeof MeldexThemeManager.resetThemeColorSet === 'function' ? MeldexThemeManager.resetThemeColorSet() : null;
    if (typeof _settingsThemeMarkDirty === 'function') _settingsThemeMarkDirty();
    syncThemeColorSetSwatches(root, next);
    if (typeof refreshSettingsThemeStylePreviews === 'function') refreshSettingsThemeStylePreviews(root);
  });
  root.querySelector('[data-theme-os-accent-toggle]')?.addEventListener('click', () => {
    if (_settingsThemeIsReadonlyElement(root)) {
      _settingsThemePromptDuplicateForEdit();
      return;
    }
    const current = typeof MeldexThemeManager.getUseOsAccentColor === 'function' ? MeldexThemeManager.getUseOsAccentColor() : false;
    if (typeof MeldexThemeManager.setUseOsAccentColor === 'function') {
      MeldexThemeManager.setUseOsAccentColor(!current);
    }
    if (typeof _settingsThemeMarkDirty === 'function') _settingsThemeMarkDirty();
    if (root.closest?.('#settings-theme-editor') && typeof _refreshSettingsThemePanel === 'function') {
      _refreshSettingsThemePanel();
      return;
    }
    syncThemeOsAccentToggle(root);
    syncCsSwatches(root);
    syncThemeColorSetSwatches(root);
  });
}

function _closeThemeUiPickers(root, exceptWrap) {
  (root || document).querySelectorAll('.cs-theme-ui-picker-wrap').forEach(wrap => {
    if (exceptWrap && wrap === exceptWrap) return;
    const menu = wrap.querySelector('[data-theme-ui-menu]');
    const btn = wrap.querySelector('[data-theme-ui-picker]');
    wrap.classList.remove('cs-theme-ui-picker-wrap--open-up');
    if (menu) {
      menu.hidden = true;
      menu.style.removeProperty('--theme-ui-picker-menu-max-height');
    }
    if (btn) btn.setAttribute('aria-expanded', 'false');
  });
}

function _themeUiPickerBoundaryRect(wrap) {
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
  const bounds = { top: 0, bottom: viewportHeight };
  let node = wrap?.parentElement;
  while (node && node !== document.body && node !== document.documentElement) {
    const style = window.getComputedStyle ? window.getComputedStyle(node) : null;
    const overflow = style ? `${style.overflowY} ${style.overflow}` : '';
    if (/(auto|scroll|hidden|clip)/.test(overflow)) {
      const rect = node.getBoundingClientRect();
      if (rect.height > 0) {
        bounds.top = Math.max(bounds.top, rect.top);
        bounds.bottom = Math.min(bounds.bottom, rect.bottom);
      }
    }
    node = node.parentElement;
  }
  return bounds;
}

function _positionThemeUiPickerMenu(wrap, menu) {
  if (!wrap || !menu) return;
  wrap.classList.remove('cs-theme-ui-picker-wrap--open-up');
  menu.style.removeProperty('--theme-ui-picker-menu-max-height');
  const trigger = wrap.querySelector('[data-theme-ui-picker]') || wrap;
  const rect = trigger.getBoundingClientRect();
  const bounds = _themeUiPickerBoundaryRect(wrap);
  const gap = 6;
  const maxHeight = 220;
  const minUsableHeight = 96;
  const below = Math.max(0, bounds.bottom - rect.bottom - gap);
  const above = Math.max(0, rect.top - bounds.top - gap);
  const openUp = below < minUsableHeight && above > below;
  const available = openUp ? above : below;
  if (openUp) wrap.classList.add('cs-theme-ui-picker-wrap--open-up');
  if (available > 0) {
    menu.style.setProperty('--theme-ui-picker-menu-max-height', `${Math.max(64, Math.min(maxHeight, available))}px`);
  }
}

function _syncThemeUiPicker(wrap, value) {
  if (!wrap) return;
  const select = wrap.querySelector('[data-theme-ui-setting]');
  _syncThemeUiNativeSelect(select, value);
  _syncThemeUiCustomOption(wrap, value);
  const btn = wrap.querySelector('[data-theme-ui-picker]');
  if (btn) btn.innerHTML = _themeUiPickerContent(value);
  wrap.querySelectorAll('[data-theme-ui-option-value]').forEach(opt => {
    opt.setAttribute('aria-selected', String(opt.dataset.themeUiOptionValue || '') === String(value || 'none') ? 'true' : 'false');
  });
}

function _syncThemeUiNativeSelect(select, value) {
  if (!select) return;
  const current = String(value || 'none');
  select.querySelectorAll('option[data-theme-ui-custom-option]').forEach(opt => {
    if (opt.value !== current) opt.remove();
  });
  if (_themeUiCustomColor(current) && !Array.from(select.options).some(opt => opt.value === current)) {
    const opt = document.createElement('option');
    opt.value = current;
    opt.textContent = '指定カラー';
    opt.dataset.themeUiCustomOption = '1';
    select.appendChild(opt);
  }
  select.value = current;
}

function _syncThemeUiCustomOption(wrap, value) {
  const opt = wrap?.querySelector?.('[data-theme-ui-custom-color]');
  if (!opt) return;
  const color = _themeUiCustomColor(value) || '#ef4444';
  const nextValue = _themeUiCustomValue(color);
  opt.dataset.themeUiOptionValue = nextValue;
  opt.title = `カラーパレットから指定: ${color}`;
  const swatch = opt.querySelector('.cs-theme-ui-option-swatch');
  if (swatch) swatch.style.background = color;
}

function _syncThemeUiAutoToneControls(root, tone) {
  const next = tone || _themeUiAutoTone();
  (root || document).querySelectorAll('.cs-theme-ui-grid').forEach(grid => {
    grid.style.setProperty('--theme-ui-auto-light-base', `${100 - next.light}%`);
    grid.style.setProperty('--theme-ui-auto-light-percent', `${next.light}%`);
    grid.style.setProperty('--theme-ui-auto-dark-base', `${100 - next.dark}%`);
    grid.style.setProperty('--theme-ui-auto-dark-percent', `${next.dark}%`);
  });
  ['light', 'dark'].forEach(kind => {
    (root || document).querySelectorAll(`[data-theme-ui-auto-tone="${kind}"]`).forEach(input => { input.value = String(next[kind]); globalThis.GBUI?.refreshRangeFill?.(input); });
    (root || document).querySelectorAll(`[data-theme-ui-auto-tone-input="${kind}"]`).forEach(input => { input.value = String(next[kind]); });
    (root || document).querySelectorAll(`[data-theme-ui-auto-tone-value="${kind}"]`).forEach(el => { el.textContent = `${next[kind]}%`; });
  });
}

function bindThemeUiAutoToneControls(root) {
  if (!root || typeof MeldexThemeManager === 'undefined' || typeof MeldexThemeManager.setThemeUiAutoTone !== 'function') return;
  const apply = (kind, raw) => {
    const next = MeldexThemeManager.setThemeUiAutoTone(kind, raw);
    if (typeof _settingsThemeMarkDirty === 'function') _settingsThemeMarkDirty();
    _syncThemeUiAutoToneControls(root, next);
    if (typeof refreshSettingsThemeStylePreviews === 'function') refreshSettingsThemeStylePreviews(root);
  };
  root.querySelectorAll('[data-theme-ui-auto-tone]').forEach(input => {
    input.addEventListener('input', () => apply(input.dataset.themeUiAutoTone, input.value));
  });
  root.querySelectorAll('[data-theme-ui-auto-tone-input]').forEach(input => {
    input.addEventListener('change', () => apply(input.dataset.themeUiAutoToneInput, input.value));
  });
  _syncThemeUiAutoToneControls(root);
}

function bindThemeUiApplicationEditor(root) {
  if (!root || typeof MeldexThemeManager === 'undefined') return;
  bindThemeUiAutoToneControls(root);
  root.querySelectorAll('[data-theme-ui-setting]').forEach(select => {
    select.addEventListener('change', () => {
      const [targetId, stateId, propId] = String(select.dataset.themeUiSetting || '').split('|');
      if (typeof MeldexThemeManager.setThemeUiApplication === 'function') {
        MeldexThemeManager.setThemeUiApplication(targetId, stateId, propId, select.value);
      }
      if (typeof _settingsThemeMarkDirty === 'function') _settingsThemeMarkDirty();
      _syncThemeUiPicker(select.closest('.cs-theme-ui-picker-wrap'), select.value);
      if (typeof refreshSettingsThemeStylePreviews === 'function') {
        refreshSettingsThemeStylePreviews(select.closest('[data-settings-theme-style-panel]') || root);
      }
    });
  });
  root.querySelectorAll('[data-theme-ui-picker]').forEach(btn => {
    const wrap = btn.closest('.cs-theme-ui-picker-wrap');
    const select = wrap?.querySelector('[data-theme-ui-setting]');
    const applyPickerValue = value => {
      if (!select) return;
      _syncThemeUiNativeSelect(select, value);
      select.dispatchEvent(new Event('change', { bubbles: true }));
    };
    if (typeof bindMeldexDropdownKeySwitch === 'function') {
      bindMeldexDropdownKeySwitch(btn, {
        getItems: () => Array.from(wrap?.querySelectorAll('[data-theme-ui-option-value]:not([data-theme-ui-custom-color])') || [])
          .map(option => ({ value: option.dataset.themeUiOptionValue || 'none', option })),
        getCurrentValue: () => select?.value || 'none',
        onSelect: item => applyPickerValue(item.value),
        getFreshTrigger: () => wrap?.querySelector('[data-theme-ui-picker]'),
      });
    }
    btn.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const menu = wrap?.querySelector('[data-theme-ui-menu]');
      if (!wrap || !menu) return;
      const opening = menu.hidden;
      _closeThemeUiPickers(root, opening ? wrap : null);
      menu.hidden = !opening;
      btn.setAttribute('aria-expanded', opening ? 'true' : 'false');
      if (opening) _positionThemeUiPickerMenu(wrap, menu);
    });
    btn.addEventListener('keydown', (ev) => {
      if (!['Enter', ' ', 'ArrowDown'].includes(ev.key)) return;
      ev.preventDefault();
      btn.click();
      const first = btn.closest('.cs-theme-ui-picker-wrap')?.querySelector('[data-theme-ui-option-value]');
      first?.focus?.();
    });
  });
  root.querySelectorAll('[data-theme-ui-option-value]').forEach(opt => {
    opt.addEventListener('click', (ev) => {
      ev.preventDefault();
      const wrap = opt.closest('.cs-theme-ui-picker-wrap');
      const select = wrap?.querySelector('[data-theme-ui-setting]');
      if (!select) return;
      const applyValue = value => {
        _syncThemeUiNativeSelect(select, value);
        select.dispatchEvent(new Event('change', { bubbles: true }));
      };
      if (opt.dataset.themeUiCustomColor === '1') {
        const current = _themeUiCustomColor(select.value) || _themeUiCustomColor(opt.dataset.themeUiOptionValue) || '#ef4444';
        _closeThemeUiPickers(root);
        if (typeof openColorPalette === 'function') {
          const anchor = wrap.querySelector('[data-theme-ui-picker]') || opt;
          openColorPalette(anchor, current, color => {
            const custom = _themeUiCustomValue(color);
            if (custom) applyValue(custom);
          });
        } else {
          applyValue(_themeUiCustomValue(current) || 'none');
        }
        return;
      }
      applyValue(opt.dataset.themeUiOptionValue || 'none');
      _closeThemeUiPickers(root);
      if (typeof focusMeldexDropdownTrigger === 'function') focusMeldexDropdownTrigger(() => wrap.querySelector('[data-theme-ui-picker]'));
    });
    opt.addEventListener('keydown', (ev) => {
      if (!['Enter', ' '].includes(ev.key)) return;
      ev.preventDefault();
      opt.click();
    });
  });
  if (!root._themeUiPickerDismissBound) {
    root._themeUiPickerDismissBound = true;
    root.addEventListener('click', ev => {
      if (ev.target?.closest?.('.cs-theme-ui-picker-wrap')) return;
      _closeThemeUiPickers(root);
    });
  }
  root.querySelector('[data-theme-ui-reset]')?.addEventListener('click', () => {
    if (typeof MeldexThemeManager.resetThemeUiAutoTone === 'function') MeldexThemeManager.resetThemeUiAutoTone();
    const grid = root.querySelector('.cs-theme-ui-grid');
    const targetIds = String(grid?.dataset?.themeUiTargetIds || '').split(',').map(v => v.trim()).filter(Boolean);
    if (targetIds.length && typeof MeldexThemeManager.resetThemeUiApplicationTargets === 'function') {
      MeldexThemeManager.resetThemeUiApplicationTargets(targetIds);
    } else if (typeof MeldexThemeManager.resetThemeUiApplications === 'function') {
      MeldexThemeManager.resetThemeUiApplications();
    }
    if (typeof _settingsThemeMarkDirty === 'function') _settingsThemeMarkDirty();
    const settingsPanel = root.closest('.settings-panel');
    const panel = settingsPanel || root;
    if (settingsPanel && typeof _refreshSettingsThemePanel === 'function') _refreshSettingsThemePanel();
    else {
      panel.querySelectorAll('[data-theme-ui-setting]').forEach(select => {
        select.value = 'none';
        _syncThemeUiPicker(select.closest('.cs-theme-ui-picker-wrap'), select.value);
      });
      _syncThemeUiAutoToneControls(panel);
      if (typeof refreshSettingsThemeStylePreviews === 'function') refreshSettingsThemeStylePreviews(panel);
    }
  });
}

function syncThemeUiApplicationSelectors(root) {
  if (!root || typeof MeldexThemeManager === 'undefined' || typeof MeldexThemeManager.getThemeUiApplications !== 'function') return;
  const cfg = MeldexThemeManager.getThemeUiApplications();
  root.querySelectorAll('[data-theme-ui-setting]').forEach(select => {
    const [targetId, stateId, propId] = String(select.dataset.themeUiSetting || '').split('|');
    const value = cfg?.[targetId]?.[stateId]?.[propId] || 'none';
    _syncThemeUiNativeSelect(select, value);
    _syncThemeUiPicker(select.closest('.cs-theme-ui-picker-wrap'), value);
  });
  _syncThemeUiAutoToneControls(root);
}

function openColorSettings() {
  document.querySelector('.modal-overlay')?.remove();
  if (typeof showSettingsModal === 'function') {
    showSettingsModal({ panel: 'テーマ' });
    return;
  }
  if (typeof showStatus === 'function') showStatus('設定ダイアログを初期化できませんでした', true);
}

function switchCsTab(btn, name) {
  // パレットを閉じる
  closeColorPalette();
  // タブボタン切替 (gb-inner-tab-active クラス、旧インライン style は防御的にクリア)
  btn.closest('.modal').querySelectorAll('.cs-tab').forEach(t => {
    t.classList.remove('active');
    t.classList.remove('gb-inner-tab-active');
    t.style.background = '';
    t.style.color = '';
    t.style.borderBottomColor = '';
  });
  btn.classList.add('active');
  btn.classList.add('gb-inner-tab-active');
  // コンテンツ切替 (hidden 属性)
  btn.closest('.modal').querySelectorAll('.cs-tab-content').forEach(c => {
    c.hidden = c.dataset.tab !== name;
    c.style.display = '';
  });
}

function openCsPalette(swatchEl, key) {
  if (_settingsThemeIsReadonlyElement(swatchEl)) {
    _settingsThemePromptDuplicateForEdit();
    return;
  }
  openColorPalette(swatchEl, getCssVar(key), (color) => {
    setColorSetting(key, color);
    updateCsSwatch(key, color);
  });
}

// プレビュークリックでカラー設定タブの行に対応する書式ポップアップを開く。
// シナリオエディタのタイプ管理ポップアップと同パターン（openFormatPopup を流用）。
function _settingsThemePreviewPopupFields(def) {
  if (!def) return [];
  if (typeof globalThis.getSettingsThemePreviewMappedFields === 'function') {
    return globalThis.getSettingsThemePreviewMappedFields(def);
  }
  const fields = [];
  const isCaret = /カーソル/.test(String(def.label || ''));
  if (def.fg) fields.push(isCaret ? 'caretColor' : 'textColor');
  if (def.bg) fields.push('bgColor');
  if (def.bold) fields.push('bold');
  if (def.italic) fields.push('italic');
  if (def.fontSize) fields.push('fontSize');
  if (def.font) fields.push('fontFamily');
  const strokeKey = _settingsThemePreviewExtraKey(def, 'stroke', '-stroke-color');
  const strokeWidthKey = _settingsThemePreviewExtraKey(def, 'strokeWidth', '-stroke-width');
  if (strokeKey) fields.push('textStrokeColor');
  if (strokeWidthKey) fields.push('textStrokeWidth');
  if (def.line) fields.push('borderColor');
  if (def.width) fields.push(isCaret ? 'caretWidth' : 'borderWidth');
  if (_settingsThemePreviewExtraKey(def, 'leftAccent', '-left-accent')) fields.push('leftAccent');
  if (_settingsThemePreviewExtraKey(def, 'underline', '-underline')) fields.push('underline');
  return [...new Set(fields)];
}

function openStylePreviewPopup(previewEl) {
  const popupOpen = globalThis.openFormatPopup;
  if (!previewEl || typeof popupOpen !== 'function') return;
  if (_settingsThemeIsReadonlyElement(previewEl)) {
    _settingsThemePromptDuplicateForEdit();
    return;
  }
  const label = previewEl.dataset.styleLabel;
  const section = previewEl.dataset.styleSection || '';
  if (!label) return;
  let def = null;
  const lists = section && UI_STYLE_SECTIONS[section]
    ? [UI_STYLE_SECTIONS[section]]
    : Object.values(UI_STYLE_SECTIONS);
  for (const list of lists) {
    const found = list.find(item => item.label === label);
    if (found) { def = found; break; }
  }
  if (!def) return;
  const fields = _settingsThemePreviewPopupFields(def);
  const isCaret = /カーソル/.test(String(def.label || ''));
  const strokeKey = _settingsThemePreviewExtraKey(def, 'stroke', '-stroke-color');
  const strokeWidthKey = _settingsThemePreviewExtraKey(def, 'strokeWidth', '-stroke-width');
  const leftAccentKey = _settingsThemePreviewExtraKey(def, 'leftAccent', '-left-accent');
  const underlineKey = _settingsThemePreviewExtraKey(def, 'underline', '-underline');
  const values = {
    textColor: def.fg && !isCaret ? getCssVar(def.fg) : '',
    bgColor: def.bg ? getCssVar(def.bg) : '',
    fontWeight: def.bold && getCssVar(def.bold) === 'bold' ? 'bold' : '',
    fontStyle: def.italic && getCssVar(def.italic) === 'italic' ? 'italic' : '',
    fontSize: def.fontSize ? parseFloat(getCssVar(def.fontSize)) || '' : '',
    fontFamily: def.font ? getCssVar(def.font) : '',
    textStrokeColor: strokeKey ? getCssVar(strokeKey) : '',
    textStrokeWidth: strokeWidthKey ? parseFloat(getCssVar(strokeWidthKey)) || 0 : 0,
    borderColor: def.line ? getCssVar(def.line) : '',
    borderWidth: def.width && !isCaret ? parseFloat(getCssVar(def.width)) || 0 : 0,
    caretColor: def.fg && isCaret ? getCssVar(def.fg) : '',
    caretWidth: def.width && isCaret ? parseFloat(getCssVar(def.width)) || 0 : 0,
    leftAccent: leftAccentKey ? _settingsThemePreviewActiveFlag(getCssVar(leftAccentKey)) : false,
    underline: underlineKey ? _settingsThemePreviewActiveFlag(getCssVar(underlineKey)) : false,
  };
  popupOpen(previewEl, {
    fields,
    values,
    onChange(prop, value) {
      if (prop === 'textColor' && def.fg) {
        setColorSetting(def.fg, value);
        updateCsSwatch(def.fg, value);
      } else if (prop === 'bgColor' && def.bg) {
        setColorSetting(def.bg, value);
        updateCsSwatch(def.bg, value);
      } else if (prop === 'fontWeight' && def.bold) {
        setColorSetting(def.bold, value === 'bold' ? 'bold' : 'normal');
        const btn = document.querySelector(`.cs-toggle[data-key="${def.bold}"]`);
        if (btn) btn.classList.toggle('active', value === 'bold');
      } else if (prop === 'fontStyle' && def.italic) {
        setColorSetting(def.italic, value === 'italic' ? 'italic' : 'normal');
        const btn = document.querySelector(`.cs-toggle[data-key="${def.italic}"]`);
        if (btn) btn.classList.toggle('active', value === 'italic');
      } else if (prop === 'fontSize' && def.fontSize) {
        setColorSetting(def.fontSize, `${Math.max(1, Number(value) || 1)}px`);
      } else if (prop === 'fontFamily' && def.font) {
        setColorSetting(def.font, value || 'inherit');
      } else if (prop === 'textStrokeColor' && strokeKey) {
        setColorSetting(strokeKey, value);
      } else if (prop === 'textStrokeWidth' && strokeWidthKey) {
        setColorSetting(strokeWidthKey, `${Math.max(0, Number(value) || 0)}px`);
      } else if (prop === 'borderColor' && def.line) {
        setColorSetting(def.line, value);
      } else if (prop === 'borderWidth' && def.width && !isCaret) {
        setColorSetting(def.width, `${Math.max(0, Number(value) || 0)}px`);
      } else if (prop === 'caretColor' && def.fg && isCaret) {
        setColorSetting(def.fg, value);
      } else if (prop === 'caretWidth' && def.width && isCaret) {
        setColorSetting(def.width, `${Math.max(0, Number(value) || 0)}px`);
      } else if (prop === 'leftAccent' && leftAccentKey) {
        setColorSetting(leftAccentKey, value ? THEME_STYLE_LEFT_ACCENT_WIDTH : '0');
      } else if (prop === 'underline' && underlineKey) {
        setColorSetting(underlineKey, value ? THEME_STYLE_UNDERLINE_WIDTH : '0');
      }
      if (typeof refreshSettingsThemePreview === 'function') refreshSettingsThemePreview();
    },
    onReset() {
      [
        def.fg, def.bg, def.bold, def.italic, def.fontSize, def.font,
        def.line, def.width, strokeKey, strokeWidthKey, leftAccentKey, underlineKey,
      ].filter(Boolean)
        .forEach(key => document.documentElement.style.removeProperty(key));
      if (typeof _settingsThemeMarkDirty === 'function') _settingsThemeMarkDirty();
      if (typeof refreshSettingsThemePreview === 'function') refreshSettingsThemePreview();
    },
  });
}

function openCsPaletteRgba(swatchEl, key) {
  if (_settingsThemeIsReadonlyElement(swatchEl)) {
    _settingsThemePromptDuplicateForEdit();
    return;
  }
  const curHex = swatchEl.dataset.hex || '#000000';
  const slider = document.querySelector(`.cs-alpha[data-key="${key}"]`);
  const curAlpha = slider ? parseFloat(slider.value) / 100 : 1;
  const curColor = hexAlphaToRgba(curHex, curAlpha);
  // パレットはα非対応になったため純hexか'transparent'を返す。αは外部スライダーで維持する。
  openColorPalette(swatchEl, curColor, (color) => {
    const sw = document.querySelector(`.cs-swatch[data-key="${key}"]`);
    const sl = document.querySelector(`.cs-alpha[data-key="${key}"]`);
    if (color === 'transparent') {
      if (sl) { sl.value = 0; globalThis.GBUI?.refreshRangeFill?.(sl); if (sl.nextElementSibling) sl.nextElementSibling.textContent = '0%'; }
      if (sw) setColorSwatchValue(sw, 'transparent');
      setColorSetting(key, 'transparent');
    } else {
      if (sw) sw.dataset.hex = color;
      updateBgFromSwatchAlpha(key);
    }
  });
}

function updateCsSwatch(key, color) {
  const keys = typeof settingsThemeStyleSettingTargetKeys === 'function'
    ? settingsThemeStyleSettingTargetKeys(key)
    : [key];
  keys.forEach(targetKey => {
    document.querySelectorAll(`.cs-swatch[data-key="${targetKey}"]`).forEach(swatch => {
      setColorSwatchValue(swatch, color);
    });
  });
}

function toggleLineVisibility(btn) {
  if (_settingsThemeIsReadonlyElement(btn)) {
    _settingsThemePromptDuplicateForEdit();
    return;
  }
  const key = btn.dataset.key;
  const onVal = btn.dataset.on;
  const offVal = btn.dataset.off;
  const cur = getCssVar(key);
  const isOn = cur !== offVal;
  document.documentElement.style.setProperty(key, isOn ? offVal : onVal);
  if (typeof _settingsThemeMarkDirty === 'function') _settingsThemeMarkDirty();
  btn.classList.toggle('active', !isOn);
  // 旧経路が残したインライン style をクリア (CSS の .cs-toggle.active を効かせる)
  btn.style.background = '';
  btn.style.color = '';
}

function toggleCsStyle(btn) {
  if (_settingsThemeIsReadonlyElement(btn)) {
    _settingsThemePromptDuplicateForEdit();
    return;
  }
  const key = btn.dataset.key;
  const val = btn.dataset.val;
  const cur = getCssVar(key);
  const isActive = cur === val;
  document.documentElement.style.setProperty(key, isActive ? 'normal' : val);
  if (typeof _settingsThemeMarkDirty === 'function') _settingsThemeMarkDirty();
  btn.classList.toggle('active', !isActive);
  btn.style.background = '';
  btn.style.color = '';
}

function setColorSetting(key, color) {
  const value = typeof normalizeStyleSettingValue === 'function' ? normalizeStyleSettingValue(key, color) : color;
  if (typeof applySettingsThemeStyleSetting === 'function') {
    applySettingsThemeStyleSetting(key, value);
    return;
  }
  if (value) document.documentElement.style.setProperty(key, value);
  else document.documentElement.style.removeProperty(key);
  if (typeof _settingsThemeMarkDirty === 'function') _settingsThemeMarkDirty();
}

function setThemeFontSetting(key, value) {
  setColorSetting(key, value || '');
  if (key === '--ui-font') {
    const uiFont = document.getElementById('modal-font-family');
    if (uiFont) uiFont.value = value || '';
  }
}

function _styleNumericValueFromCss(key, fallback) {
  const raw = typeof getCssVar === 'function' ? getCssVar(key) : '';
  const m = String(raw || '').match(/-?\d+(?:\.\d+)?/);
  if (m) return parseFloat(m[0]);
  return fallback;
}

function _styleNumericFormat(value) {
  if (!Number.isFinite(value)) return '';
  const rounded = Math.round(value * 1000) / 1000;
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}

function syncNumericStyleSettingInputs(key, value) {
  if (!key) return;
  const next = value == null ? _styleNumericValueFromCss(key, '') : value;
  const display = next === '' ? '' : _styleNumericFormat(Number(next));
  document.querySelectorAll('[data-number-key]').forEach(input => {
    if (input.dataset.numberKey !== key) return;
    input.value = display;
    if (input.type === 'range') globalThis.GBUI?.refreshRangeFill?.(input);
  });
}

function setNumericStyleSetting(input) {
  if (!input) return;
  if (_settingsThemeIsReadonlyElement(input)) {
    _settingsThemePromptDuplicateForEdit();
    syncNumericStyleSettingInputs(input.dataset.numberKey || input.dataset.key || '');
    return;
  }
  const key = input.dataset.numberKey || input.dataset.key || '';
  if (!key.startsWith('--')) return;
  const min = input.min === '' ? NaN : parseFloat(input.min);
  const max = input.max === '' ? NaN : parseFloat(input.max);
  let value = parseFloat(input.value);
  if (!Number.isFinite(value)) {
    syncNumericStyleSettingInputs(key);
    return;
  }
  if (Number.isFinite(min)) value = Math.max(min, value);
  if (Number.isFinite(max)) value = Math.min(max, value);
  const formatted = _styleNumericFormat(value);
  document.documentElement.style.setProperty(key, formatted + (input.dataset.unit || ''));
  syncNumericStyleSettingInputs(key, value);
  if (typeof _settingsThemeMarkDirty === 'function') _settingsThemeMarkDirty();
  // ボードのレイアウト関連キーはファイル固有値が未設定のとき即時再レイアウト
  if ((key === '--bd-gap-siblings' || key === '--bd-gap-levels')
    && typeof bd !== 'undefined'
    && (!bd._fileStyle || bd._fileStyle[key] === undefined)
    && typeof _bdRelayoutAllStructureTrees === 'function') {
    _bdRelayoutAllStructureTrees();
  }
}

function _settingsColorHistoryKeys() {
  const keys = [
    COLOR_SETTINGS_KEY,
    'editor-theme-name',
    THEME_COLOR_SLOT_SETTINGS_KEY,
    THEME_COLOR_EXTRA_SLOT_SETTINGS_KEY,
    STANDARD_PALETTE_ADJUST_STORAGE_KEY,
  ];
  if (typeof GB_CUSTOM_COLORS_KEY !== 'undefined') keys.push(GB_CUSTOM_COLORS_KEY);
  if (typeof MeldexThemeManager !== 'undefined') {
    [
      MeldexThemeManager.DEFAULT_THEME_KEY,
      MeldexThemeManager.CUSTOM_THEMES_KEY,
      MeldexThemeManager.THEME_COLOR_SET_KEY,
      MeldexThemeManager.THEME_OS_ACCENT_KEY,
      MeldexThemeManager.THEME_UI_APPLICATIONS_KEY,
      MeldexThemeManager.THEME_UI_AUTO_TONE_KEY,
    ].forEach(key => { if (key) keys.push(key); });
  }
  return [...new Set(keys)];
}

function _refreshSettingsColorAfterHistory() {
  if (typeof loadColorSettings === 'function') loadColorSettings();
  if (typeof updateColorScheme === 'function') updateColorScheme();
  const root = document.getElementById('settings-theme-editor') || document;
  if (typeof syncCsSwatches === 'function') syncCsSwatches(root);
  if (typeof syncThemeColorSetSwatches === 'function') syncThemeColorSetSwatches(root);
  if (typeof refreshSettingsThemeStylePreviews === 'function') refreshSettingsThemeStylePreviews(root);
}

function _captureSettingsColorHistory() {
  return typeof captureLocalStorageSettings === 'function'
    ? captureLocalStorageSettings(_settingsColorHistoryKeys())
    : null;
}

function _pushSettingsColorHistory(label, beforeSnapshot, detail) {
  if (!beforeSnapshot || typeof pushLocalStorageSettingsHistory !== 'function') return false;
  return pushLocalStorageSettingsHistory(
    label,
    beforeSnapshot,
    _captureSettingsColorHistory(),
    detail || '',
    _refreshSettingsColorAfterHistory
  );
}

function applyColorSettings() {
  const before = _captureSettingsColorHistory();
  if (saveColorSettings() === false) return;
  localStorage.removeItem('editor-theme-name');
  if (typeof MeldexThemeManager !== 'undefined') localStorage.removeItem(MeldexThemeManager.DEFAULT_THEME_KEY);
  _pushSettingsColorHistory('設定: 色設定を適用', before);
  document.querySelector('.modal-overlay').remove();
  showStatus('色設定を適用しました');
}

async function saveCurrentAsCustomTheme() {
  if (typeof MeldexThemeManager === 'undefined' || typeof MeldexThemeManager.createCustomThemeFromCurrent !== 'function') {
    showStatus('テーマシステムを初期化できませんでした', true);
    return;
  }
  const name = await cfPrompt('カスタムテーマ名', 'カスタムテーマ');
  if (name === null) return;
  const theme = MeldexThemeManager.createCustomThemeFromCurrent(name);
  if (!theme) {
    showStatus('テーマ名を入力してください', true);
    return;
  }
  MeldexThemeManager.applyDefaultTheme(theme.id, { silent: true });
  if (saveColorSettings() === false) return;
  document.querySelector('.modal-overlay')?.remove();
  openColorSettings();
  showStatus('カスタムテーマを作成しました');
}

async function deleteCurrentCustomTheme() {
  if (typeof MeldexThemeManager === 'undefined' || typeof MeldexThemeManager.deleteCustomTheme !== 'function') {
    showStatus('テーマシステムを初期化できませんでした', true);
    return;
  }
  const id = MeldexThemeManager.getDefaultThemeId();
  const theme = MeldexThemeManager.getCustomThemes().find(t => t.id === id);
  if (!theme) {
    showStatus('削除できるカスタムテーマが選択されていません', true);
    return;
  }
  if (!await cfConfirm('カスタムテーマ「' + theme.name + '」を削除しますか？')) return;
  MeldexThemeManager.deleteCustomTheme(id);
  MeldexThemeManager.applyDefaultTheme('builtin-dark', { silent: true, resetThemeColorSet: true });
  document.querySelector('.modal-overlay')?.remove();
  openColorSettings();
  showStatus('カスタムテーマを削除しました');
}

function exportEditorTheme() {
  const theme = { _type: 'editor-theme', _version: 3 };
  for (const k of getAllStyleKeys()) {
    const v = document.documentElement.style.getPropertyValue(k);
    if (v) theme[k] = v;
  }
  for (const k of getAllStyleKeys()) {
    if (!theme[k]) { const v = getCssVar(k); if (v) theme[k] = v; }
  }
  theme['_custom-colors'] = getCustomColors();
  if (typeof MeldexThemeManager !== 'undefined' && typeof MeldexThemeManager.getThemeColorSet === 'function') {
    theme[THEME_COLOR_SET_THEME_KEY] = MeldexThemeManager.getThemeColorSet();
    const colorSlots = getThemeColorSlotSettings();
    if (colorSlots.some(Boolean)) theme[THEME_COLOR_SLOT_SETTINGS_THEME_KEY] = colorSlots;
    const extraSlots = getThemeColorExtraSlotSettings();
    if (Object.keys(extraSlots).length) theme[THEME_COLOR_EXTRA_SLOT_SETTINGS_THEME_KEY] = extraSlots;
    if (typeof getStandardPaletteAdjust === 'function') theme[STANDARD_PALETTE_THEME_KEY] = getStandardPaletteAdjust();
    if (typeof MeldexThemeManager.getUseOsAccentColor === 'function') {
      theme[THEME_OS_ACCENT_THEME_KEY] = MeldexThemeManager.getUseOsAccentColor();
    }
    if (typeof MeldexThemeManager.getThemeUiApplications === 'function' && MeldexThemeManager.THEME_UI_APPLICATIONS_KEY) {
      theme[MeldexThemeManager.THEME_UI_APPLICATIONS_KEY] = MeldexThemeManager.getThemeUiApplications();
    }
    if (typeof MeldexThemeManager.getThemeUiAutoTone === 'function' && MeldexThemeManager.THEME_UI_AUTO_TONE_KEY) {
      theme[MeldexThemeManager.THEME_UI_AUTO_TONE_KEY] = MeldexThemeManager.getThemeUiAutoTone();
    }
  }
  if (typeof MeldexThemeManager !== 'undefined') {
    theme.defaultThemeId = MeldexThemeManager.getDefaultThemeId();
    theme.customThemes = MeldexThemeManager.getCustomThemes();
    if (typeof bd !== 'undefined') theme.activeBoardThemeId = bd.themeId || '';
  }

  if (typeof MeldexExportSave === 'undefined' || typeof MeldexExportSave.saveText !== 'function') {
    showStatus('保存ダイアログを初期化できませんでした', true);
    return;
  }
  MeldexExportSave.saveText(JSON.stringify(theme, null, 2), {
    filename: 'Meldex_テーマ.json',
    extension: '.json',
    dialogTitle: 'テーマとして保存',
    filetypes: [['JSONファイル', '*.json'], ['すべてのファイル', '*.*']],
    okMessage: 'テーマを保存しました',
    errorMessage: 'テーマの保存に失敗しました',
  });
}

function importEditorTheme() {
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = '.json';
  inp.onchange = (e) => {
    const f = e.target.files[0]; if (!f) return;
    const r = new FileReader();
    r.onload = (ev) => {
      try {
        const theme = JSON.parse(ev.target.result);
        const hasThemeColorSet = Object.prototype.hasOwnProperty.call(theme, THEME_COLOR_SET_THEME_KEY);
        for (const [k, v] of Object.entries(theme)) {
          if (!k.startsWith('--')) continue;
          if (typeof applySettingsThemeStyleSetting === 'function') {
            applySettingsThemeStyleSetting(k, v, { markDirty: false });
          } else {
            document.documentElement.style.setProperty(k, v);
          }
        }
        if (theme['_custom-colors'] && Array.isArray(theme['_custom-colors'])) {
          try { localStorage.setItem(GB_CUSTOM_COLORS_KEY, JSON.stringify(theme['_custom-colors'])); } catch {}
        }
        if (Object.prototype.hasOwnProperty.call(theme, THEME_COLOR_SLOT_SETTINGS_THEME_KEY)) {
          saveThemeColorSlotSettings(theme[THEME_COLOR_SLOT_SETTINGS_THEME_KEY]);
        }
        if (Object.prototype.hasOwnProperty.call(theme, THEME_COLOR_EXTRA_SLOT_SETTINGS_THEME_KEY)) {
          saveThemeColorExtraSlotSettings(theme[THEME_COLOR_EXTRA_SLOT_SETTINGS_THEME_KEY]);
        }
        if (Object.prototype.hasOwnProperty.call(theme, STANDARD_PALETTE_THEME_KEY) && typeof setStandardPaletteAdjust === 'function') {
          setStandardPaletteAdjust(theme[STANDARD_PALETTE_THEME_KEY]);
        }
        if (typeof MeldexThemeManager !== 'undefined') {
          if (Array.isArray(theme.customThemes)) MeldexThemeManager.saveCustomThemes(theme.customThemes);
          if (theme.defaultThemeId) MeldexThemeManager.applyDefaultTheme(theme.defaultThemeId, { silent: true });
        }
        if (hasThemeColorSet && typeof MeldexThemeManager !== 'undefined' && typeof MeldexThemeManager.setThemeColorSet === 'function') {
          MeldexThemeManager.setThemeColorSet(theme[THEME_COLOR_SET_THEME_KEY], { save: true });
        } else if (Object.prototype.hasOwnProperty.call(theme, THEME_COLOR_SLOT_SETTINGS_THEME_KEY) && typeof _syncThemeColorSetFromPalette === 'function') {
          _syncThemeColorSetFromPalette();
        }
        if (Object.prototype.hasOwnProperty.call(theme, THEME_OS_ACCENT_THEME_KEY) && typeof MeldexThemeManager !== 'undefined' && typeof MeldexThemeManager.setUseOsAccentColor === 'function') {
          MeldexThemeManager.setUseOsAccentColor(!!theme[THEME_OS_ACCENT_THEME_KEY]);
        }
        if (typeof MeldexThemeManager !== 'undefined' && MeldexThemeManager.THEME_UI_APPLICATIONS_KEY
          && Object.prototype.hasOwnProperty.call(theme, MeldexThemeManager.THEME_UI_APPLICATIONS_KEY)
          && typeof MeldexThemeManager.saveThemeUiApplications === 'function') {
          MeldexThemeManager.saveThemeUiApplications(theme[MeldexThemeManager.THEME_UI_APPLICATIONS_KEY], { skipHistory: true });
        }
        if (typeof MeldexThemeManager !== 'undefined' && MeldexThemeManager.THEME_UI_AUTO_TONE_KEY
          && Object.prototype.hasOwnProperty.call(theme, MeldexThemeManager.THEME_UI_AUTO_TONE_KEY)
          && typeof MeldexThemeManager.saveThemeUiAutoTone === 'function') {
          MeldexThemeManager.saveThemeUiAutoTone(theme[MeldexThemeManager.THEME_UI_AUTO_TONE_KEY], { skipHistory: true });
        }
        if (saveColorSettings() === false) return;
        showStatus('テーマを読み込みました');
        document.querySelector('.modal-overlay')?.remove();
        openColorSettings();
      } catch (err) { showStatus('テーマ読み込み失敗: ' + err.message, true); }
    };
    r.readAsText(f, 'UTF-8');
  };
  inp.click();
}

async function resetColorSettings() {
  if (!await cfConfirm('カスタムテーマをデフォルトに戻しますか？')) return;
  const before = _captureSettingsColorHistory();
  for (const k of getAllStyleKeys()) document.documentElement.style.removeProperty(k);
  localStorage.removeItem(COLOR_SETTINGS_KEY);
  localStorage.removeItem('editor-theme-name');
  localStorage.removeItem(THEME_COLOR_SLOT_SETTINGS_KEY);
  localStorage.removeItem(THEME_COLOR_EXTRA_SLOT_SETTINGS_KEY);
  localStorage.removeItem(STANDARD_PALETTE_ADJUST_STORAGE_KEY);
  if (typeof resetStandardPaletteAdjust === 'function') resetStandardPaletteAdjust({ skipHistory: true });
  if (typeof MeldexThemeManager !== 'undefined') localStorage.removeItem(MeldexThemeManager.DEFAULT_THEME_KEY);
  if (typeof MeldexThemeManager !== 'undefined') localStorage.removeItem(MeldexThemeManager.THEME_OS_ACCENT_KEY);
  if (typeof MeldexThemeManager !== 'undefined' && typeof MeldexThemeManager.resetThemeColorSet === 'function') MeldexThemeManager.resetThemeColorSet({ skipHistory: true });
  if (typeof MeldexThemeManager !== 'undefined' && typeof MeldexThemeManager.resetThemeUiApplications === 'function') MeldexThemeManager.resetThemeUiApplications({ skipHistory: true });
  else if (typeof MeldexThemeManager !== 'undefined' && MeldexThemeManager.THEME_UI_APPLICATIONS_KEY) localStorage.removeItem(MeldexThemeManager.THEME_UI_APPLICATIONS_KEY);
  if (typeof MeldexThemeManager !== 'undefined' && typeof MeldexThemeManager.resetThemeUiAutoTone === 'function') MeldexThemeManager.resetThemeUiAutoTone({ skipHistory: true });
  else if (typeof MeldexThemeManager !== 'undefined' && MeldexThemeManager.THEME_UI_AUTO_TONE_KEY) localStorage.removeItem(MeldexThemeManager.THEME_UI_AUTO_TONE_KEY);
  _pushSettingsColorHistory('設定: 色設定リセット', before);
  showStatus('色設定をリセットしました');
  document.querySelector('.modal-overlay').remove();
}

// ユーザー管理（ソースフォルダ別チーム表示）は廃止し、正本「スタッフ管理シート」
// ベースの表示（_renderStaffRegistrySettings、gb-settings.part03.part02.js）へ
// 統合した（ユーザーアカウント一元管理 計画書 Phase 1、2026-07-19）。
